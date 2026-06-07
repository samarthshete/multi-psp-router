import { Inject, Injectable, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { hmacValidator } from "@adyen/api-library";
import type {
  AuthHoldInput,
  AuthHoldResult,
  CaptureInput,
  CaptureResult,
  NormalizedEventType,
  NormalizedPaymentEvent,
  PaymentProvider,
  PaymentProviderStrategy,
  ProviderCapabilities,
  RenewSubscriptionInput,
  RenewSubscriptionResult,
  StartSubscriptionInput,
  StartSubscriptionResult,
  VerifiedWebhook
} from "@router/shared";

export const ADYEN_CHECKOUT_CLIENT = Symbol("ADYEN_CHECKOUT_CLIENT");

type AdyenPaymentResponse = {
  pspReference?: string;
  resultCode?: string;
};

type AdyenCaptureResponse = {
  pspReference?: string;
  status?: string;
};

export type AdyenCheckoutClient = {
  paymentsApi: {
    payments(
      request: Record<string, unknown>,
      options: { idempotencyKey: string }
    ): Promise<AdyenPaymentResponse>;
  };
  modificationsApi: {
    captureAuthorisedPayment(
      pspReference: string,
      request: Record<string, unknown>,
      options: { idempotencyKey: string }
    ): Promise<AdyenCaptureResponse>;
  };
};

type AdyenNotificationRequestItem = {
  additionalData?: Record<string, string | undefined>;
  amount?: {
    value?: number;
    currency?: string;
  };
  eventCode: string;
  eventDate: string;
  merchantAccountCode?: string;
  merchantReference?: string;
  originalReference?: string;
  pspReference: string;
  success: string | boolean;
};

type AdyenNotificationPayload = {
  notificationItems: Array<{
    NotificationRequestItem: AdyenNotificationRequestItem;
  }>;
};

@Injectable()
export class AdyenStrategy implements PaymentProviderStrategy {
  readonly provider: PaymentProvider = "ADYEN";

  constructor(
    @Optional()
    @Inject(ADYEN_CHECKOUT_CLIENT)
    private readonly checkoutClient?: AdyenCheckoutClient
  ) {}

  getCapabilities(): ProviderCapabilities {
    return {
      supportsManualCapture: true,
      supportsTokenization: true,
      supportsSubscriptions: true,
      supportedCurrencies: ["EUR", "USD"]
    };
  }

  async createAuthHold(input: AuthHoldInput): Promise<AuthHoldResult> {
    if (this.isReplayMode()) {
      const externalRef = this.demoReference("auth", input.idempotencyKey);
      console.warn(
        "DEMO_MODE=adyen_replay active; returning canned Adyen auth hold response."
      );

      return {
        provider: this.provider,
        externalRef,
        status: "authorized",
        authorized: true,
        rawProviderResponse: {
          pspReference: externalRef,
          resultCode: "Authorised",
          demoMode: true
        },
        raw: {
          pspReference: externalRef,
          resultCode: "Authorised",
          demoMode: true
        }
      };
    }

    const response = await this.requireCheckoutClient().paymentsApi.payments(
      {
        amount: {
          currency: this.getCurrency(input).toUpperCase(),
          value: this.getAmount(input)
        },
        captureDelayHours: -1,
        merchantAccount: this.requireEnv("ADYEN_MERCHANT_ACCOUNT"),
        paymentMethod: {
          storedPaymentMethodId: this.getPaymentMethodHandle(input.paymentMethod)
        },
        reference: this.getPaymentOrderId(input),
        shopperReference: this.getShopperReference(input)
      },
      {
        idempotencyKey: input.idempotencyKey
      }
    );

    return {
      provider: this.provider,
      externalRef: response.pspReference ?? "",
      status: response.resultCode === "Authorised" ? "authorized" : "failed",
      authorized: response.resultCode === "Authorised",
      rawProviderResponse: response,
      raw: response
    };
  }

  async capturePayment(input: CaptureInput): Promise<CaptureResult> {
    if (this.isReplayMode()) {
      const externalRef = this.demoReference("capture", input.idempotencyKey);
      console.warn(
        "DEMO_MODE=adyen_replay active; returning canned Adyen capture response."
      );

      return {
        provider: this.provider,
        externalRef,
        status: "captured",
        captured: true,
        rawProviderResponse: {
          pspReference: externalRef,
          status: "received",
          demoMode: true
        },
        raw: {
          pspReference: externalRef,
          status: "received",
          demoMode: true
        }
      };
    }

    const response =
      await this.requireCheckoutClient().modificationsApi.captureAuthorisedPayment(
        input.externalRef,
        {
          amount: {
            currency: this.getCurrency(input).toUpperCase(),
            value: this.getAmount(input)
          },
          merchantAccount: this.requireEnv("ADYEN_MERCHANT_ACCOUNT"),
          reference: String(input.metadata?.paymentOrderId ?? input.externalRef)
        },
        {
          idempotencyKey: input.idempotencyKey
        }
      );

    return {
      provider: this.provider,
      externalRef: response.pspReference ?? input.externalRef,
      status: response.status === "received" ? "captured" : "pending",
      captured: response.status === "received",
      rawProviderResponse: response,
      raw: response
    };
  }

  async startSubscription(
    input: StartSubscriptionInput
  ): Promise<StartSubscriptionResult> {
    if (this.isReplayMode()) {
      const externalRef = this.demoReference("sub_start", input.idempotencyKey);
      console.warn(
        "DEMO_MODE=adyen_replay active; returning canned Adyen subscription start response."
      );

      return {
        provider: this.provider,
        externalRef,
        status: "active",
        storedPaymentMethodId: input.paymentMethodTokenId,
        paymentMethodTokenId: input.paymentMethodTokenId,
        rawProviderResponse: {
          pspReference: externalRef,
          resultCode: "Authorised",
          demoMode: true
        },
        raw: {
          pspReference: externalRef,
          resultCode: "Authorised",
          demoMode: true
        }
      };
    }

    const response = await this.requireCheckoutClient().paymentsApi.payments(
      {
        amount: {
          currency: this.getCurrency(input).toUpperCase(),
          value: this.getAmount(input)
        },
        merchantAccount: this.requireEnv("ADYEN_MERCHANT_ACCOUNT"),
        paymentMethod: {
          storedPaymentMethodId: this.getSubscriptionPaymentMethod(input)
        },
        recurringProcessingModel: "Subscription",
        reference: `subscription:${String(input.metadata?.subscriptionId ?? input.idempotencyKey)}`,
        shopperInteraction: "Ecommerce",
        shopperReference: this.getShopperReference(input),
        storePaymentMethod: true
      },
      {
        idempotencyKey: input.idempotencyKey
      }
    );

    return {
      provider: this.provider,
      externalRef: response.pspReference ?? "",
      status: response.resultCode === "Authorised" ? "active" : "setup_pending",
      storedPaymentMethodId: this.getSubscriptionPaymentMethod(input),
      paymentMethodTokenId: this.getSubscriptionPaymentMethod(input),
      rawProviderResponse: response,
      raw: response
    };
  }

  async renewSubscription(
    input: RenewSubscriptionInput
  ): Promise<RenewSubscriptionResult> {
    if (this.isReplayMode()) {
      const externalRef = this.demoReference("sub_renew", input.idempotencyKey);
      console.warn(
        "DEMO_MODE=adyen_replay active; returning canned Adyen subscription renewal response."
      );

      return {
        provider: this.provider,
        externalRef,
        status: "succeeded",
        succeeded: true,
        rawProviderResponse: {
          pspReference: externalRef,
          resultCode: "Authorised",
          demoMode: true
        },
        raw: {
          pspReference: externalRef,
          resultCode: "Authorised",
          demoMode: true
        }
      };
    }

    const response = await this.requireCheckoutClient().paymentsApi.payments(
      {
        amount: {
          currency: this.getCurrency(input).toUpperCase(),
          value: this.getAmount(input)
        },
        merchantAccount: this.requireEnv("ADYEN_MERCHANT_ACCOUNT"),
        paymentMethod: {
          storedPaymentMethodId: input.paymentMethodTokenId ?? input.storedPaymentMethodId
        },
        recurringProcessingModel: "Subscription",
        reference: `subscription_charge:${String(input.metadata?.subscriptionChargeId ?? input.idempotencyKey)}`,
        shopperInteraction: "ContAuth",
        shopperReference: this.getShopperReference({
          customer: input.customer
        })
      },
      {
        idempotencyKey: input.idempotencyKey
      }
    );

    return {
      provider: this.provider,
      externalRef: response.pspReference ?? "",
      status: response.resultCode === "Authorised" ? "succeeded" : "pending",
      succeeded: response.resultCode === "Authorised",
      rawProviderResponse: response,
      raw: response
    };
  }

  async verifyWebhookSignature(
    rawBody: Buffer,
    _headers: Record<string, string>
  ): Promise<VerifiedWebhook> {
    const payload = JSON.parse(
      rawBody.toString("utf8")
    ) as AdyenNotificationPayload;
    const hmacKey = this.requireEnv("ADYEN_HMAC_KEY");
    const validator = new hmacValidator();
    const signatureValid = payload.notificationItems.every((container) =>
      validator.validateHMAC(
        container.NotificationRequestItem as never,
        hmacKey
      )
    );
    const firstItem = payload.notificationItems[0]?.NotificationRequestItem;

    if (!firstItem) {
      throw new Error("Adyen webhook payload has no notification items");
    }

    return {
      provider: this.provider,
      signatureValid,
      dedupeKey: this.getDedupeKey(firstItem),
      payload,
      receivedAt: new Date()
    };
  }

  normalizeWebhook(verified: VerifiedWebhook): NormalizedPaymentEvent[] {
    const payload = verified.payload as AdyenNotificationPayload;
    const items = payload.notificationItems.map(
      (container) => container.NotificationRequestItem
    );

    if (items.length === 0) {
      throw new Error("Adyen webhook payload has no notification items");
    }

    return items.map((item) => ({
      provider: this.provider,
      type: this.normalizeEventType(item),
      subscriptionId: this.getSubscriptionId(item),
      subscriptionChargeId: this.getSubscriptionChargeId(item),
      externalRef: item.pspReference,
      payload: item,
      occurredAt: new Date(item.eventDate)
    }));
  }

  /**
   * Public helper so tests and replay tooling can compute the dedupe key for a
   * raw Adyen notification payload without going through signature verification.
   */
  getDedupeKeyForPayload(payload: AdyenNotificationPayload): string {
    const firstItem = payload.notificationItems[0]?.NotificationRequestItem;

    if (!firstItem) {
      throw new Error("Adyen webhook payload has no notification items");
    }

    return this.getDedupeKey(firstItem);
  }

  private normalizeEventType(item: AdyenNotificationRequestItem): NormalizedEventType {
    const success = this.isSuccess(item.success);

    if (item.merchantReference?.startsWith("subscription_charge:")) {
      return success ? "SUBSCRIPTION_RENEWED" : "SUBSCRIPTION_PAYMENT_FAILED";
    }

    if (item.merchantReference?.startsWith("subscription:")) {
      return success ? "SUBSCRIPTION_CREATED" : "SUBSCRIPTION_PAYMENT_FAILED";
    }

    switch (item.eventCode) {
      case "AUTHORISATION":
        return success ? "PAYMENT_AUTHORIZED" : "PAYMENT_FAILED";
      case "CAPTURE":
        return success ? "PAYMENT_CAPTURED" : "PAYMENT_CAPTURE_FAILED";
      case "CAPTURE_FAILED":
        return "PAYMENT_CAPTURE_FAILED";
      case "RECURRING_CONTRACT":
        return success ? "TOKEN_CREATED" : "UNKNOWN";
      case "REFUND":
      case "REFUND_FAILED":
        return "UNKNOWN";
      case "CHARGEBACK":
      case "NOTIFICATION_OF_CHARGEBACK":
        return "DISPUTE_OPENED";
      default:
        return "UNKNOWN";
    }
  }

  private getDedupeKey(item: AdyenNotificationRequestItem): string {
    return createHash("sha256")
      .update(
        [
          item.eventCode,
          item.pspReference,
          item.originalReference ?? "",
          String(item.success),
          item.eventDate
        ].join(":")
      )
      .digest("hex");
  }

  private getPaymentOrderId(input: AuthHoldInput): string {
    return String(input.metadata?.paymentOrderId ?? input.idempotencyKey);
  }

  private getSubscriptionId(
    item: AdyenNotificationRequestItem
  ): string | undefined {
    if (item.merchantReference?.startsWith("subscription:")) {
      return item.merchantReference.slice("subscription:".length);
    }

    return undefined;
  }

  private getSubscriptionChargeId(
    item: AdyenNotificationRequestItem
  ): string | undefined {
    if (item.merchantReference?.startsWith("subscription_charge:")) {
      return item.merchantReference.slice("subscription_charge:".length);
    }

    return undefined;
  }

  private getShopperReference(input: {
    customer?: { providerCustomerId?: string; id?: string; email?: string };
  }): string {
    return (
      input.customer?.providerCustomerId ??
      input.customer?.id ??
      input.customer?.email ??
      "guest-shopper"
    );
  }

  private requireCheckoutClient(): AdyenCheckoutClient {
    if (!this.checkoutClient) {
      throw new Error("Adyen checkout client is not configured");
    }

    return this.checkoutClient;
  }

  private requireEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
      throw new Error(`${name} is not configured`);
    }

    return value;
  }

  private isReplayMode(): boolean {
    return process.env.DEMO_MODE === "adyen_replay";
  }

  private demoReference(prefix: string, idempotencyKey: string): string {
    return `demo_${prefix}_${createHash("sha256")
      .update(idempotencyKey)
      .digest("hex")
      .slice(0, 12)}`;
  }

  private isSuccess(success: string | boolean): boolean {
    return success === true || success === "true";
  }

  private getAmount(input: { amount?: number; money?: { amount: number } }) {
    return input.amount ?? input.money?.amount ?? 0;
  }

  private getCurrency(input: { currency?: string; money?: { currency: string } }) {
    return input.currency ?? input.money?.currency ?? "EUR";
  }

  private getPaymentMethodHandle(paymentMethod?: {
    tokenId?: string;
    handle?: string;
  }) {
    return paymentMethod?.tokenId ?? paymentMethod?.handle;
  }

  private getSubscriptionPaymentMethod(input: {
    paymentMethodTokenId?: string;
    paymentMethod?: {
      handle?: string;
      tokenId?: string;
    };
  }) {
    return input.paymentMethodTokenId ?? this.getPaymentMethodHandle(input.paymentMethod);
  }
}
