import { StripeStrategy } from "../../src/payments/strategies/stripe.strategy";

function createStripeClientMock() {
  return {
    paymentIntents: {
      create: jest.fn(),
      capture: jest.fn()
    },
    webhooks: {
      constructEvent: jest.fn()
    }
  };
}

function verifiedStripe(payload: unknown, dedupeKey: string) {
  return {
    provider: "STRIPE" as const,
    signatureValid: true,
    dedupeKey,
    payload,
    receivedAt: new Date("2026-06-07T12:00:00.000Z")
  };
}

describe("StripeStrategy", () => {
  it("normalizes MIT success and failure webhooks using subscription metadata", () => {
    const strategy = new StripeStrategy(createStripeClientMock() as never);
    const succeeded = strategy.normalizeWebhook(
      verifiedStripe(
        {
          id: "evt_mit_succeeded",
          type: "payment_intent.succeeded",
          created: 1770000000,
          data: {
            object: {
              id: "pi_mit",
              metadata: {
                subscriptionId: "sub-1",
                subscriptionChargeId: "charge-1",
                subscriptionChargeKind: "MIT"
              }
            }
          }
        },
        "evt_mit_succeeded"
      )
    );
    const failed = strategy.normalizeWebhook(
      verifiedStripe(
        {
          id: "evt_mit_failed",
          type: "payment_intent.payment_failed",
          created: 1770000001,
          data: {
            object: {
              id: "pi_mit_failed",
              metadata: {
                subscriptionId: "sub-1",
                subscriptionChargeId: "charge-2",
                subscriptionChargeKind: "MIT"
              }
            }
          }
        },
        "evt_mit_failed"
      )
    );

    expect(succeeded).toEqual([
      expect.objectContaining({
        provider: "STRIPE",
        type: "SUBSCRIPTION_RENEWED",
        subscriptionId: "sub-1",
        subscriptionChargeId: "charge-1",
        externalRef: "pi_mit"
      })
    ]);
    expect(failed).toEqual([
      expect.objectContaining({
        type: "SUBSCRIPTION_PAYMENT_FAILED",
        subscriptionChargeId: "charge-2",
        externalRef: "pi_mit_failed"
      })
    ]);
  });

  it("normalizes CIT success as SUBSCRIPTION_CREATED", () => {
    const strategy = new StripeStrategy(createStripeClientMock() as never);

    expect(
      strategy.normalizeWebhook(
        verifiedStripe(
          {
            id: "evt_cit",
            type: "payment_intent.succeeded",
            created: 1770000000,
            data: {
              object: {
                id: "pi_cit",
                metadata: {
                  subscriptionId: "sub-setup",
                  subscriptionChargeId: "charge-cit",
                  subscriptionChargeKind: "CIT"
                }
              }
            }
          },
          "evt_cit"
        )
      )
    ).toEqual([
      expect.objectContaining({
        type: "SUBSCRIPTION_CREATED",
        subscriptionId: "sub-setup",
        subscriptionChargeId: "charge-cit"
      })
    ]);
  });

  it("starts a subscription with setup_future_usage off_session", async () => {
    const stripe = createStripeClientMock();
    stripe.paymentIntents.create.mockResolvedValue({
      id: "pi_start",
      status: "succeeded",
      payment_method: "pm_stored"
    });
    const strategy = new StripeStrategy(stripe as never);

    await expect(
      strategy.startSubscription({
        amount: 2500,
        currency: "USD",
        customer: {
          id: "cus-local",
          providerCustomerId: "cus_stripe"
        },
        paymentMethodTokenId: "pm_card_visa",
        cadence: "monthly",
        idempotencyKey: "idem-start",
        metadata: {
          subscriptionId: "sub-1"
        }
      })
    ).resolves.toMatchObject({
      provider: "STRIPE",
      externalRef: "pi_start",
      status: "active",
      paymentMethodTokenId: "pm_stored"
    });
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        currency: "usd",
        customer: "cus_stripe",
        payment_method: "pm_card_visa",
        confirm: true,
        setup_future_usage: "off_session"
      }),
      {
        idempotencyKey: "idem-start"
      }
    );
  });

  it("renews a subscription off-session with the stored payment method", async () => {
    const stripe = createStripeClientMock();
    stripe.paymentIntents.create.mockResolvedValue({
      id: "pi_renew",
      status: "succeeded"
    });
    const strategy = new StripeStrategy(stripe as never);

    await expect(
      strategy.renewSubscription({
        amount: 2500,
        currency: "USD",
        subscriptionExternalRef: "pi_start",
        customer: {
          id: "cus-local",
          providerCustomerId: "cus_stripe"
        },
        paymentMethodTokenId: "pm_stored",
        idempotencyKey: "idem-renew"
      })
    ).resolves.toMatchObject({
      provider: "STRIPE",
      externalRef: "pi_renew",
      succeeded: true
    });
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        currency: "usd",
        customer: "cus_stripe",
        payment_method: "pm_stored",
        off_session: true,
        confirm: true
      }),
      {
        idempotencyKey: "idem-renew"
      }
    );
  });
});
