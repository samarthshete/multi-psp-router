import { createHash } from "node:crypto";
import authorisationFail from "../../../../scripts/fixtures/adyen/authorisation-fail.json";
import authorisationSuccess from "../../../../scripts/fixtures/adyen/authorisation-success.json";
import captureSuccess from "../../../../scripts/fixtures/adyen/capture-success.json";
import { AdyenStrategy } from "../../src/payments/strategies/adyen.strategy";

function verified(payload: typeof authorisationSuccess, dedupeKey: string) {
  return {
    provider: "ADYEN" as const,
    signatureValid: true,
    dedupeKey,
    payload,
    receivedAt: new Date("2026-06-07T12:00:00.000Z")
  };
}

describe("AdyenStrategy webhook normalization", () => {
  it("normalizes AUTHORISATION success as PAYMENT_AUTHORIZED", () => {
    const strategy = new AdyenStrategy();
    const dedupeKey = strategy.getDedupeKeyForPayload(authorisationSuccess);

    expect(
      strategy.normalizeWebhook(verified(authorisationSuccess, dedupeKey))
    ).toEqual([
      expect.objectContaining({
        provider: "ADYEN",
        type: "PAYMENT_AUTHORIZED",
        externalRef: "adyen_auth_success_psp"
      })
    ]);
    expect(dedupeKey).toBe(expectedDedupeKey(authorisationSuccess));
  });

  it("normalizes AUTHORISATION failure as PAYMENT_FAILED", () => {
    const strategy = new AdyenStrategy();
    const dedupeKey = strategy.getDedupeKeyForPayload(authorisationFail);

    expect(
      strategy.normalizeWebhook(verified(authorisationFail, dedupeKey))
    ).toEqual([
      expect.objectContaining({
        provider: "ADYEN",
        type: "PAYMENT_FAILED",
        externalRef: "adyen_auth_fail_psp"
      })
    ]);
    expect(dedupeKey).toBe(expectedDedupeKey(authorisationFail));
  });

  it("normalizes CAPTURE success as PAYMENT_CAPTURED", () => {
    const strategy = new AdyenStrategy();
    const dedupeKey = strategy.getDedupeKeyForPayload(captureSuccess);

    expect(
      strategy.normalizeWebhook(verified(captureSuccess, dedupeKey))
    ).toEqual([
      expect.objectContaining({
        provider: "ADYEN",
        type: "PAYMENT_CAPTURED",
        externalRef: "adyen_capture_success_psp"
      })
    ]);
    expect(dedupeKey).toBe(expectedDedupeKey(captureSuccess));
  });

  it("returns demo references without credentials in replay mode", async () => {
    const previousDemoMode = process.env.DEMO_MODE;
    process.env.DEMO_MODE = "adyen_replay";

    try {
      const strategy = new AdyenStrategy();

      await expect(
        strategy.createAuthHold({
          amount: 1000,
          currency: "EUR",
          idempotencyKey: "idem-auth",
          metadata: {
            paymentOrderId: "po-demo"
          }
        })
      ).resolves.toMatchObject({
        provider: "ADYEN",
        externalRef: expect.stringMatching(/^demo_auth_/),
        authorized: true
      });

      await expect(
        strategy.capturePayment({
          amount: 1000,
          currency: "EUR",
          externalRef: "demo_auth_123",
          idempotencyKey: "idem-capture"
        })
      ).resolves.toMatchObject({
        provider: "ADYEN",
        externalRef: expect.stringMatching(/^demo_capture_/),
        captured: true
      });
    } finally {
      process.env.DEMO_MODE = previousDemoMode;
    }
  });
});

function expectedDedupeKey(payload: typeof authorisationSuccess): string {
  const item = payload.notificationItems[0].NotificationRequestItem;

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
