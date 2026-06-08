import { Inject, Injectable } from "@nestjs/common";
import type {
  AuthHoldInput,
  AuthHoldResult,
  CaptureInput,
  CaptureResult,
  NormalizedPaymentEvent,
  NormalizedEventType,
  PaymentProvider,
  PaymentProviderStrategy,
  ProviderCapabilities,
  RenewSubscriptionInput,
  RenewSubscriptionResult,
  StartSubscriptionInput,
  StartSubscriptionResult,
  VerifiedWebhook
} from "@router/shared";

export const STRIPE_CLIENT = Symbol("STRIPE_CLIENT");

type StripePaymentIntent = {
  id: string;
  status: string;
  customer?: string | null;
  payment_method?: string | { id?: string } | null;
};

type StripeWebhookEvent = {
  id: string;
  type: string;
  created: number;
  data: {
    object: {
      id?: string;
      metadata?: Record<string, string | undefined>;
    };
  };
};

type StripeClient = {
  paymentIntents: {
    create(
      params: Record<string, unknown>,
      options: { idempotencyKey: string }
    ): Promise<StripePaymentIntent>;
    capture(
      paymentIntent: string,
      params: Record<string, unknown>,
      options: { idempotencyKey: string }
    ): Promise<StripePaymentIntent>;
  };
  webhooks: {
    constructEvent(
      rawBody: Buffer,
      sigHeader: string,
      secret: string
    ): StripeWebhookEvent;
  };
};

@Injectable()
export class StripeStrategy implements PaymentProviderStrategy {
  readonly provider: PaymentProvider = "STRIPE";

  constructor(@Inject(STRIPE_CLIENT) private readonly stripe: StripeClient) {}

  getCapabilities(): ProviderCapabilities {
    return {
      supportsManualCapture: true,
      supportsTokenization: true,
      supportsSubscriptions: true,
      supportedCurrencies: ["USD", "EUR"]
    };
  }

  async createAuthHold(input: AuthHoldInput): Promise<AuthHoldResult> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: this.getAmount(input),
        currency: this.getCurrency(input).toLowerCase(),
        payment_method: this.getPaymentMethodHandle(input.paymentMethod),
        payment_method_types: ["card"],
        capture_method: "manual",
        confirm: true,
        metadata: this.toStripeMetadata(input.metadata)
      },
      {
        idempotencyKey: input.idempotencyKey
      }
    );

    return {
      provider: this.provider,
      externalRef: intent.id,
      status: intent.status === "requires_capture" ? "authorized" : "failed",
      authorized: intent.status === "requires_capture",
      rawProviderResponse: intent,
      raw: intent
    };
  }

  async capturePayment(input: CaptureInput): Promise<CaptureResult> {
    const intent = await this.stripe.paymentIntents.capture(
      input.externalRef,
      {
        amount_to_capture: this.getAmount(input),
        metadata: this.toStripeMetadata(input.metadata)
      },
      {
        idempotencyKey: input.idempotencyKey
      }
    );

    return {
      provider: this.provider,
      externalRef: intent.id,
      status: intent.status === "succeeded" ? "captured" : "pending",
      captured: intent.status === "succeeded",
      rawProviderResponse: intent,
      raw: intent
    };
  }

  async startSubscription(
    input: StartSubscriptionInput
  ): Promise<StartSubscriptionResult> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: this.getAmount(input),
        currency: this.getCurrency(input).toLowerCase(),
        customer: input.customer?.providerCustomerId ?? input.customerExternalRef,
        payment_method: input.paymentMethodTokenId ?? input.paymentMethod?.handle,
        payment_method_types: ["card"],
        confirm: true,
        setup_future_usage: "off_session",
        metadata: this.toStripeMetadata(input.metadata)
      },
      {
        idempotencyKey: input.idempotencyKey
      }
    );

    return {
      provider: this.provider,
      externalRef: intent.id,
      status: intent.status === "succeeded" ? "active" : "setup_pending",
      storedPaymentMethodId: this.getPaymentMethodId(intent),
      paymentMethodTokenId: this.getPaymentMethodId(intent),
      rawProviderResponse: intent,
      raw: intent
    };
  }

  async renewSubscription(
    input: RenewSubscriptionInput
  ): Promise<RenewSubscriptionResult> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: this.getAmount(input),
        currency: this.getCurrency(input).toLowerCase(),
        customer: input.customer?.providerCustomerId,
        payment_method: input.paymentMethodTokenId ?? input.storedPaymentMethodId,
        payment_method_types: ["card"],
        off_session: true,
        confirm: true,
        metadata: this.toStripeMetadata(input.metadata)
      },
      {
        idempotencyKey: input.idempotencyKey
      }
    );

    return {
      provider: this.provider,
      externalRef: intent.id,
      status: intent.status === "succeeded" ? "succeeded" : "pending",
      succeeded: intent.status === "succeeded",
      rawProviderResponse: intent,
      raw: intent
    };
  }

  async verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<VerifiedWebhook> {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
    }

    const sigHeader = headers["stripe-signature"];

    if (!sigHeader) {
      throw new Error("Stripe webhook signature is missing");
    }

    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      sigHeader,
      webhookSecret
    );

    return {
      provider: this.provider,
      signatureValid: true,
      dedupeKey: event.id,
      payload: event,
      receivedAt: new Date()
    };
  }

  normalizeWebhook(verified: VerifiedWebhook): NormalizedPaymentEvent[] {
    const event = verified.payload as StripeWebhookEvent;
    const eventObject = event.data.object as { id?: string };
    const metadata = event.data.object.metadata ?? {};
    const normalizedType = this.normalizeEventType(event.type, metadata);

    return [
      {
        provider: this.provider,
        type: normalizedType,
        externalRef: eventObject.id,
        subscriptionId: metadata.subscriptionId,
        subscriptionChargeId: metadata.subscriptionChargeId,
        payload: event,
        occurredAt: new Date(event.created * 1000)
      }
    ];
  }

  private normalizeEventType(
    eventType: string,
    metadata: Record<string, string | undefined> = {}
  ): NormalizedEventType {
    if (metadata.subscriptionChargeKind === "MIT") {
      if (eventType === "payment_intent.succeeded") {
        return "SUBSCRIPTION_RENEWED";
      }

      if (eventType === "payment_intent.payment_failed") {
        return "SUBSCRIPTION_PAYMENT_FAILED";
      }
    }

    if (metadata.subscriptionChargeKind === "CIT") {
      if (eventType === "payment_intent.succeeded") {
        return "SUBSCRIPTION_CREATED";
      }

      if (eventType === "payment_intent.payment_failed") {
        return "SUBSCRIPTION_PAYMENT_FAILED";
      }
    }

    switch (eventType) {
      case "payment_intent.amount_capturable_updated":
        return "PAYMENT_AUTHORIZED";
      case "charge.captured":
        return "PAYMENT_CAPTURED";
      case "payment_intent.succeeded":
        return "PAYMENT_SUCCEEDED";
      case "payment_intent.payment_failed":
        return "PAYMENT_FAILED";
      case "charge.refund.updated":
      case "charge.refunded":
        return "PAYMENT_CAPTURE_FAILED";
      case "payment_method.attached":
      case "setup_intent.succeeded":
        return "TOKEN_CREATED";
      case "customer.subscription.created":
        return "SUBSCRIPTION_CREATED";
      case "invoice.payment_succeeded":
        return "SUBSCRIPTION_RENEWED";
      case "invoice.payment_failed":
        return "SUBSCRIPTION_PAYMENT_FAILED";
      case "charge.dispute.created":
        return "DISPUTE_OPENED";
      default:
        return "UNKNOWN";
    }
  }

  private toStripeMetadata(metadata?: Record<string, unknown>) {
    if (!metadata) {
      return undefined;
    }

    return Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, String(value)])
    );
  }

  private getPaymentMethodId(intent: StripePaymentIntent): string | undefined {
    if (typeof intent.payment_method === "string") {
      return intent.payment_method;
    }

    return intent.payment_method?.id;
  }

  private getAmount(input: { amount?: number; money?: { amount: number } }) {
    return input.amount ?? input.money?.amount ?? 0;
  }

  private getCurrency(input: { currency?: string; money?: { currency: string } }) {
    return input.currency ?? input.money?.currency ?? "USD";
  }

  private getPaymentMethodHandle(paymentMethod?: {
    tokenId?: string;
    handle?: string;
  }) {
    return paymentMethod?.tokenId ?? paymentMethod?.handle;
  }
}
