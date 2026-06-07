jest.mock("../../src/prisma/prisma.service", () => ({
  PrismaService: class PrismaService {}
}));

import { PaymentRouterService } from "../../src/payments/payment-router.service";
import { AdyenStrategy } from "../../src/payments/strategies/adyen.strategy";
import { StripeStrategy } from "../../src/payments/strategies/stripe.strategy";
import type { PrismaService } from "../../src/prisma/prisma.service";

const stripeClient = {
  paymentIntents: {
    create: jest.fn(),
    capture: jest.fn()
  },
  webhooks: {
    constructEvent: jest.fn()
  }
};

function createPrismaMock() {
  return {
    routingDecision: {
      create: jest.fn(({ data }) =>
        Promise.resolve({
          id: "routing-decision-1",
          ...data
        })
      )
    }
  } as unknown as PrismaService;
}

describe("PaymentRouterService", () => {
  it("routes USD payments to Stripe", async () => {
    const prisma = createPrismaMock();
    const stripe = new StripeStrategy(stripeClient as never);
    const adyen = new AdyenStrategy();
    const service = new PaymentRouterService(prisma, stripe, adyen);

    await expect(
      service.route({
        paymentOrderId: "po-usd",
        amount: 1000,
        currency: "USD"
      })
    ).resolves.toMatchObject({
      provider: "STRIPE",
      strategy: stripe
    });
  });

  it("routes EUR payments to Adyen", async () => {
    const prisma = createPrismaMock();
    const stripe = new StripeStrategy(stripeClient as never);
    const adyen = new AdyenStrategy();
    const service = new PaymentRouterService(prisma, stripe, adyen);

    await expect(
      service.route({
        paymentOrderId: "po-eur",
        amount: 1000,
        currency: "EUR"
      })
    ).resolves.toMatchObject({
      provider: "ADYEN",
      strategy: adyen
    });
  });

  it("lets provider override win over currency rules", async () => {
    const prisma = createPrismaMock();
    const stripe = new StripeStrategy(stripeClient as never);
    const adyen = new AdyenStrategy();
    const service = new PaymentRouterService(prisma, stripe, adyen);

    await expect(
      service.route({
        paymentOrderId: "po-override",
        amount: 1000,
        currency: "EUR",
        providerOverride: "STRIPE"
      })
    ).resolves.toMatchObject({
      provider: "STRIPE",
      reason: "Provider override selected STRIPE",
      strategy: stripe
    });
  });

  it("writes a RoutingDecision row", async () => {
    const prisma = createPrismaMock();
    const service = new PaymentRouterService(
      prisma,
      new StripeStrategy(stripeClient as never),
      new AdyenStrategy()
    );

    await service.route({
      paymentOrderId: "po-decision",
      amount: 2500,
      currency: "EUR"
    });

    expect(prisma.routingDecision.create).toHaveBeenCalledWith({
      data: {
        paymentOrderId: "po-decision",
        chosenProvider: "ADYEN",
        reason: "EUR currency routed to ADYEN",
        ruleSnapshot: {
          amount: 2500,
          currency: "EUR",
          providerOverride: null
        }
      }
    });
  });
});
