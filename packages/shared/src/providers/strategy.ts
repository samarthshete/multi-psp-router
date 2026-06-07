import type {
  NormalizedPaymentEvent,
  PaymentProvider
} from "../events/normalized-event";

export type Money = {
  amount: number;
  currency: string;
};

export type ProviderCapabilities = {
  supportsManualCapture: boolean;
  supportsTokenization: boolean;
  supportsSubscriptions: boolean;
  supportedCurrencies: string[];
};

export type CustomerInput = {
  id?: string;
  email?: string;
  providerCustomerId?: string;
};

export type PaymentMethodHandle = {
  handle?: string;
  type?: "stripe_payment_method" | "adyen_state_data";
  tokenId?: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
};

export type AuthHoldInput = {
  paymentOrderId?: string;
  customerExternalRef?: string;
  money?: Money;
  amount?: number;
  currency?: string;
  customer?: CustomerInput;
  paymentMethod?: PaymentMethodHandle;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export type AuthHoldResult = {
  provider?: PaymentProvider;
  externalRef: string;
  status: "authorized" | "requires_action" | "failed";
  authorized?: boolean;
  rawProviderResponse: unknown;
  raw?: unknown;
};

export type CaptureInput = {
  paymentOrderId?: string;
  externalRef: string;
  money?: Money;
  amount?: number;
  currency?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export type CaptureResult = {
  provider?: PaymentProvider;
  externalRef: string;
  status: "captured" | "pending" | "failed";
  captured?: boolean;
  rawProviderResponse: unknown;
  raw?: unknown;
};

export type StartSubscriptionInput = {
  subscriptionId?: string;
  customerExternalRef?: string;
  customer?: CustomerInput;
  paymentMethod?: PaymentMethodHandle;
  paymentMethodTokenId?: string;
  money?: Money;
  amount?: number;
  currency?: string;
  cadence?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export type StartSubscriptionResult = {
  provider?: PaymentProvider;
  externalRef: string;
  storedPaymentMethodId?: string;
  paymentMethodTokenId?: string;
  initialChargeRef?: string;
  status: "active" | "setup_pending" | "failed";
  rawProviderResponse?: unknown;
  raw?: unknown;
};

export type RenewSubscriptionInput = {
  subscriptionId?: string;
  subscriptionChargeId?: string;
  subscriptionExternalRef?: string;
  customerExternalRef?: string;
  customer?: CustomerInput;
  storedPaymentMethodId?: string;
  paymentMethodTokenId?: string;
  money?: Money;
  amount?: number;
  currency?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export type RenewSubscriptionResult = {
  provider?: PaymentProvider;
  externalRef: string;
  status: "succeeded" | "pending" | "failed";
  succeeded?: boolean;
  rawProviderResponse: unknown;
  raw?: unknown;
};

export type VerifiedWebhook = {
  provider: PaymentProvider;
  signatureValid: boolean;
  dedupeKey: string;
  payload: unknown;
  receivedAt: Date;
};

export interface PaymentProviderStrategy {
  readonly provider: PaymentProvider;

  getCapabilities(): ProviderCapabilities;

  createAuthHold(input: AuthHoldInput): Promise<AuthHoldResult>;
  capturePayment(input: CaptureInput): Promise<CaptureResult>;

  startSubscription(
    input: StartSubscriptionInput
  ): Promise<StartSubscriptionResult>;
  renewSubscription(
    input: RenewSubscriptionInput
  ): Promise<RenewSubscriptionResult>;

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<VerifiedWebhook>;

  normalizeWebhook(verified: VerifiedWebhook): NormalizedPaymentEvent[];
}
