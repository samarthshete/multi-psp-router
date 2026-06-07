jest.mock("../../src/prisma/prisma.service", () => ({
  PrismaService: class PrismaService {}
}));

import { SubscriptionsController } from "../../src/subscriptions/subscriptions.controller";
import type { PrismaService } from "../../src/prisma/prisma.service";

function createPrismaMock() {
  return {
    customer: {
      create: jest.fn(() =>
        Promise.resolve({
          id: "cus-local",
          email: "buyer@example.com",
          stripeCustomerId: "cus_stripe",
          adyenShopperReference: null
        })
      ),
      findUnique: jest.fn()
    },
    paymentMethodToken: {
      upsert: jest.fn(() =>
        Promise.resolve({
          id: "pmt-local",
          customerId: "cus-local",
          provider: "STRIPE",
          tokenId: "pm_card_visa"
        })
      )
    },
    subscription: {
      create: jest.fn(() =>
        Promise.resolve({
          id: "sub-local",
          amount: 1500,
          currency: "USD",
          provider: "STRIPE"
        })
      ),
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: "sub-local",
          amount: 1500,
          currency: "USD",
          provider: "STRIPE",
          externalRef: "pi_start",
          customer: {
            id: "cus-local",
            email: "buyer@example.com",
            stripeCustomerId: "cus_stripe",
            adyenShopperReference: null
          },
          paymentMethodToken: {
            id: "pmt-local",
            tokenId: "pm_card_visa"
          }
        })
      ),
      update: jest.fn(() => Promise.resolve({}))
    },
    subscriptionCharge: {
      create: jest.fn(() =>
        Promise.resolve({
          id: "sub-charge-local"
        })
      ),
      update: jest.fn(() => Promise.resolve({}))
    },
    pspOperation: {
      create: jest.fn(() =>
        Promise.resolve({
          id: "psp-op"
        })
      ),
      update: jest.fn(() => Promise.resolve({}))
    }
  } as unknown as PrismaService;
}

function createController(strategy: {
  startSubscription?: jest.Mock;
  renewSubscription?: jest.Mock;
}) {
  const prisma = createPrismaMock();
  const idempotency = {
    runOnce: jest.fn(async (_scope, _key, _hash, handler) => ({
      ...(await handler()),
      replayed: false
    }))
  };
  const router = {
    getStrategyForProvider: jest.fn(() => strategy)
  };
  const controller = new SubscriptionsController(
    prisma,
    idempotency as never,
    router as never
  );

  return {
    controller,
    idempotency,
    prisma,
    router
  };
}

describe("SubscriptionsController", () => {
  it("starts a CIT subscription and activates it on PSP success", async () => {
    const strategy = {
      startSubscription: jest.fn(() =>
        Promise.resolve({
          provider: "STRIPE",
          externalRef: "pi_start",
          status: "ACTIVE",
          paymentMethodTokenId: "pm_card_visa",
          raw: {
            id: "pi_start"
          }
        })
      )
    };
    const { controller, prisma } = createController(strategy);

    await expect(
      controller.startSubscription(
        {
          amount: 1500,
          currency: "USD",
          paymentMethodId: "pm_card_visa",
          email: "buyer@example.com",
          providerCustomerId: "cus_stripe"
        },
        "idem-start"
      )
    ).resolves.toMatchObject({
      subscriptionId: "sub-local",
      subscriptionChargeId: "sub-charge-local",
      provider: "STRIPE",
      status: "ACTIVE",
      externalRef: "pi_start",
      replayed: false
    });
    expect(prisma.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "SETUP_PENDING"
      })
    });
    expect(prisma.subscriptionCharge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "CIT",
        status: "PENDING"
      })
    });
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: {
        id: "sub-local"
      },
      data: expect.objectContaining({
        status: "ACTIVE",
        externalRef: "pi_start"
      })
    });
    expect(prisma.subscriptionCharge.update).toHaveBeenCalledWith({
      where: {
        id: "sub-charge-local"
      },
      data: expect.objectContaining({
        status: "SUCCEEDED",
        externalRef: "pi_start"
      })
    });
  });

  it("renews a subscription with an MIT charge left pending for webhook settlement", async () => {
    const strategy = {
      renewSubscription: jest.fn(() =>
        Promise.resolve({
          provider: "STRIPE",
          externalRef: "pi_renew",
          succeeded: true,
          raw: {
            id: "pi_renew"
          }
        })
      )
    };
    const { controller, prisma } = createController(strategy);

    await expect(
      controller.renewSubscription("sub-local", {}, "idem-renew")
    ).resolves.toMatchObject({
      subscriptionId: "sub-local",
      subscriptionChargeId: "sub-charge-local",
      provider: "STRIPE",
      status: "PENDING",
      externalRef: "pi_renew",
      replayed: false
    });
    expect(prisma.subscriptionCharge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "MIT",
        status: "PENDING"
      })
    });
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: {
        id: "sub-local"
      },
      data: {
        status: "RENEWAL_PENDING"
      }
    });
    expect(prisma.subscriptionCharge.update).toHaveBeenCalledWith({
      where: {
        id: "sub-charge-local"
      },
      data: {
        externalRef: "pi_renew",
        status: "PENDING"
      }
    });
  });
});
