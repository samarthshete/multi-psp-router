export const normalizedEventTypes = [
  "PAYMENT_AUTHORIZED",
  "PAYMENT_CAPTURED",
  "PAYMENT_SUCCEEDED",
  "PAYMENT_FAILED",
  "PAYMENT_CAPTURE_FAILED",
  "TOKEN_CREATED",
  "SUBSCRIPTION_CREATED",
  "SUBSCRIPTION_RENEWED",
  "SUBSCRIPTION_PAYMENT_FAILED",
  "DISPUTE_OPENED",
  "UNKNOWN"
] as const;

export type NormalizedEventType = (typeof normalizedEventTypes)[number];

export interface NormalizedPaymentEvent {
  provider: PaymentProvider;
  type: NormalizedEventType;
  externalRef?: string;
  paymentOrderId?: string;
  subscriptionId?: string;
  subscriptionChargeId?: string;
  payload: unknown;
  occurredAt: Date;
}

export type PaymentProvider = "STRIPE" | "ADYEN";
