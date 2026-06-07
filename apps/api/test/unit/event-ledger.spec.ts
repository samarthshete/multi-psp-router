jest.mock("../../src/prisma/prisma.service", () => ({
  PrismaService: class PrismaService {}
}));

import { EventLedgerService } from "../../src/events/event-ledger.service";

function createPrismaMock() {
  return {
    paymentOrder: {
      updateMany: jest.fn(() => Promise.resolve({ count: 1 }))
    },
    capture: {
      updateMany: jest.fn(() => Promise.resolve({ count: 1 }))
    },
    subscription: {
      updateMany: jest.fn(() => Promise.resolve({ count: 1 }))
    },
    subscriptionCharge: {
      updateMany: jest.fn(() => Promise.resolve({ count: 1 }))
    }
  };
}

describe("EventLedgerService", () => {
  it("authorizes only payment orders still waiting for authorization", async () => {
    const prisma = createPrismaMock();
    const service = new EventLedgerService(prisma as never);

    await service.apply({
      type: "PAYMENT_AUTHORIZED",
      paymentOrderId: "po-1",
      externalRef: "pi_1"
    });

    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            id: "po-1"
          },
          {
            externalRef: "pi_1"
          }
        ],
        status: {
          in: ["AUTH_PENDING"]
        }
      },
      data: {
        status: "AUTHORIZED"
      }
    });
  });

  it("captures payment orders and capture rows idempotently", async () => {
    const prisma = createPrismaMock();
    const service = new EventLedgerService(prisma as never);

    await service.apply({
      type: "PAYMENT_CAPTURED",
      paymentOrderId: "po-1",
      externalRef: "pi_1"
    });

    expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            id: "po-1"
          },
          {
            externalRef: "pi_1"
          }
        ],
        status: {
          in: ["AUTH_PENDING", "AUTHORIZED", "CAPTURE_PENDING"]
        }
      },
      data: {
        status: "CAPTURED"
      }
    });
    expect(prisma.capture.updateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            externalRef: "pi_1"
          }
        ],
        status: {
          in: ["REQUESTED"]
        }
      },
      data: {
        status: "SUCCEEDED"
      }
    });
  });

  it("settles renewed subscriptions and MIT charges only from pending states", async () => {
    const prisma = createPrismaMock();
    const service = new EventLedgerService(prisma as never);

    await service.apply({
      type: "SUBSCRIPTION_RENEWED",
      subscriptionId: "sub-1",
      subscriptionChargeId: "charge-1",
      externalRef: "pi_renew"
    });

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            id: "sub-1"
          },
          {
            externalRef: "pi_renew"
          }
        ],
        status: {
          in: ["ACTIVE", "RENEWAL_PENDING", "PAST_DUE"]
        }
      },
      data: {
        status: "ACTIVE"
      }
    });
    expect(prisma.subscriptionCharge.updateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            id: "charge-1"
          },
          {
            externalRef: "pi_renew"
          }
        ],
        status: {
          in: ["PENDING"]
        }
      },
      data: {
        status: "SUCCEEDED"
      }
    });
  });

  it("ignores events that do not identify a local entity", async () => {
    const prisma = createPrismaMock();
    const service = new EventLedgerService(prisma as never);

    await service.apply({
      type: "PAYMENT_AUTHORIZED"
    });

    expect(prisma.paymentOrder.updateMany).not.toHaveBeenCalled();
  });
});
