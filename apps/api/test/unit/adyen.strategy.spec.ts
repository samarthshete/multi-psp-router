import { AdyenStrategy } from "../../src/payments/strategies/adyen.strategy";

function createCheckoutClientMock() {
  return {
    paymentsApi: {
      payments: jest.fn()
    },
    modificationsApi: {
      captureAuthorisedPayment: jest.fn()
    }
  };
}

describe("AdyenStrategy subscription operations", () => {
  const previousMerchantAccount = process.env.ADYEN_MERCHANT_ACCOUNT;
  const previousDemoMode = process.env.DEMO_MODE;

  beforeEach(() => {
    process.env.ADYEN_MERCHANT_ACCOUNT = "TestMerchant";
    process.env.DEMO_MODE = "";
  });

  afterAll(() => {
    process.env.ADYEN_MERCHANT_ACCOUNT = previousMerchantAccount;
    process.env.DEMO_MODE = previousDemoMode;
  });

  it("starts a subscription with Ecommerce recurring setup fields", async () => {
    const checkout = createCheckoutClientMock();
    checkout.paymentsApi.payments.mockResolvedValue({
      pspReference: "adyen_sub_start",
      resultCode: "Authorised"
    });
    const strategy = new AdyenStrategy(checkout as never);

    await expect(
      strategy.startSubscription({
        amount: 2500,
        currency: "EUR",
        customer: {
          id: "cus-local",
          providerCustomerId: "shopper-1"
        },
        paymentMethodTokenId: "adyen-token",
        cadence: "monthly",
        idempotencyKey: "idem-start",
        metadata: {
          subscriptionId: "sub-1"
        }
      })
    ).resolves.toMatchObject({
      provider: "ADYEN",
      externalRef: "adyen_sub_start",
      status: "active",
      paymentMethodTokenId: "adyen-token"
    });
    expect(checkout.paymentsApi.payments).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantAccount: "TestMerchant",
        paymentMethod: {
          storedPaymentMethodId: "adyen-token"
        },
        recurringProcessingModel: "Subscription",
        reference: "subscription:sub-1",
        shopperInteraction: "Ecommerce",
        shopperReference: "shopper-1",
        storePaymentMethod: true
      }),
      {
        idempotencyKey: "idem-start"
      }
    );
  });

  it("renews a subscription with ContAuth recurring fields", async () => {
    const checkout = createCheckoutClientMock();
    checkout.paymentsApi.payments.mockResolvedValue({
      pspReference: "adyen_sub_renew",
      resultCode: "Authorised"
    });
    const strategy = new AdyenStrategy(checkout as never);

    await expect(
      strategy.renewSubscription({
        amount: 2500,
        currency: "EUR",
        subscriptionExternalRef: "adyen_sub_start",
        customer: {
          id: "cus-local",
          providerCustomerId: "shopper-1"
        },
        paymentMethodTokenId: "adyen-token",
        idempotencyKey: "idem-renew",
        metadata: {
          subscriptionChargeId: "charge-1"
        }
      })
    ).resolves.toMatchObject({
      provider: "ADYEN",
      externalRef: "adyen_sub_renew",
      succeeded: true
    });
    expect(checkout.paymentsApi.payments).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethod: {
          storedPaymentMethodId: "adyen-token"
        },
        recurringProcessingModel: "Subscription",
        reference: "subscription_charge:charge-1",
        shopperInteraction: "ContAuth",
        shopperReference: "shopper-1"
      }),
      {
        idempotencyKey: "idem-renew"
      }
    );
  });

  it("normalizes subscription references from Adyen merchantReference", () => {
    const strategy = new AdyenStrategy();
    const payload = {
      notificationItems: [
        {
          NotificationRequestItem: {
            eventCode: "AUTHORISATION",
            eventDate: "2026-06-07T12:00:00.000Z",
            merchantReference: "subscription_charge:charge-1",
            originalReference: "adyen_sub_start",
            pspReference: "adyen_sub_renew",
            success: "true"
          }
        }
      ]
    };
    const result = strategy.normalizeWebhook({
      provider: "ADYEN",
      signatureValid: true,
      dedupeKey: strategy.getDedupeKeyForPayload(payload),
      payload,
      receivedAt: new Date("2026-06-07T12:00:00.000Z")
    });

    expect(result).toEqual([
      expect.objectContaining({
        provider: "ADYEN",
        type: "SUBSCRIPTION_RENEWED",
        subscriptionChargeId: "charge-1",
        externalRef: "adyen_sub_renew"
      })
    ]);
  });

  it("returns canned subscription references in replay mode without credentials", async () => {
    process.env.DEMO_MODE = "adyen_replay";
    const strategy = new AdyenStrategy();

    await expect(
      strategy.startSubscription({
        amount: 2500,
        currency: "EUR",
        customer: {
          id: "cus-local"
        },
        paymentMethodTokenId: "adyen-token",
        cadence: "monthly",
        idempotencyKey: "idem-start"
      })
    ).resolves.toMatchObject({
      provider: "ADYEN",
      externalRef: expect.stringMatching(/^demo_sub_start_/),
      status: "active"
    });

    await expect(
      strategy.renewSubscription({
        amount: 2500,
        currency: "EUR",
        subscriptionExternalRef: "demo_sub_start_123",
        customer: {
          id: "cus-local"
        },
        paymentMethodTokenId: "adyen-token",
        idempotencyKey: "idem-renew"
      })
    ).resolves.toMatchObject({
      provider: "ADYEN",
      externalRef: expect.stringMatching(/^demo_sub_renew_/),
      succeeded: true
    });
  });
});
