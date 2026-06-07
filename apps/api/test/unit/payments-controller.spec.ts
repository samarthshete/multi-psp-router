jest.mock("../../src/prisma/prisma.service", () => ({
  PrismaService: class PrismaService {}
}));

import { HttpException, HttpStatus } from "@nestjs/common";
import { IdempotencyService } from "../../src/idempotency/idempotency.service";
import { PaymentsController } from "../../src/payments/payments.controller";
import { PaymentRouterService } from "../../src/payments/payment-router.service";
import { AdyenStrategy } from "../../src/payments/strategies/adyen.strategy";
import { StripeStrategy } from "../../src/payments/strategies/stripe.strategy";
import type { PrismaService } from "../../src/prisma/prisma.service";

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

function createPrismaMock() {
  return {
    idempotencyRecord: {
      findUnique: jest.fn(() => Promise.resolve(null)),
      create: jest.fn(() =>
        Promise.resolve({
          id: "idem-1"
        })
      ),
      update: jest.fn(() => Promise.resolve({}))
    },
    paymentOrder: {
      create: jest.fn(() =>
        Promise.resolve({
          id: "po-1"
        })
      ),
      update: jest.fn(() => Promise.resolve({})),
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: "po-1",
          amount: 1000,
          currency: "USD",
          provider: "STRIPE",
          externalRef: "pi_123"
        })
      )
    },
    paymentAttempt: {
      create: jest.fn(() =>
        Promise.resolve({
          id: "attempt-1"
        })
      ),
      update: jest.fn(() => Promise.resolve({}))
    },
    pspOperation: {
      create: jest.fn(() =>
        Promise.resolve({
          id: "psp-op-1"
        })
      ),
      update: jest.fn(() => Promise.resolve({}))
    },
    routingDecision: {
      create: jest.fn(() => Promise.resolve({}))
    },
    capture: {
      create: jest.fn(() =>
        Promise.resolve({
          id: "capture-1"
        })
      ),
      update: jest.fn()
    }
  } as unknown as PrismaService;
}

function createController(stripeClient = createStripeClientMock()) {
  const prisma = createPrismaMock();
  const stripeStrategy = new StripeStrategy(stripeClient as never);
  const router = new PaymentRouterService(
    prisma,
    stripeStrategy,
    new AdyenStrategy()
  );
  const idempotency = new IdempotencyService(prisma);
  const controller = new PaymentsController(prisma, idempotency, router);

  return {
    controller,
    prisma,
    router,
    stripeClient
  };
}

describe("PaymentsController", () => {
  it("creates an auth hold through Stripe and persists local payment rows", async () => {
    const { controller, prisma, stripeClient } = createController();
    stripeClient.paymentIntents.create.mockResolvedValue({
      id: "pi_123",
      status: "requires_capture"
    });

    await expect(
      controller.createAuthHold(
        {
          amount: 1000,
          currency: "USD",
          paymentMethodId: "pm_card_visa"
        },
        "idem-auth"
      )
    ).resolves.toEqual({
      paymentOrderId: "po-1",
      provider: "STRIPE",
      status: "AUTH_PENDING",
      externalRef: "pi_123",
      replayed: false
    });

    expect(stripeClient.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1000,
        currency: "usd",
        payment_method: "pm_card_visa",
        capture_method: "manual",
        confirm: true
      }),
      {
        idempotencyKey: "idem-auth"
      }
    );
    expect(prisma.paymentOrder.create).toHaveBeenCalled();
    expect(prisma.paymentAttempt.create).toHaveBeenCalled();
    expect(prisma.pspOperation.create).toHaveBeenCalled();
    expect(prisma.routingDecision.create).toHaveBeenCalled();
  });

  it("marks local auth hold rows failed and returns 502 on Stripe failure", async () => {
    const { controller, prisma, stripeClient } = createController();
    stripeClient.paymentIntents.create.mockRejectedValue(new Error("stripe down"));

    try {
      await controller.createAuthHold(
        {
          amount: 1000,
          currency: "USD",
          paymentMethodId: "pm_card_visa"
        },
        "idem-auth-fail"
      );
      fail("Expected createAuthHold to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    }

    expect(prisma.paymentOrder.update).toHaveBeenCalledWith({
      where: {
        id: "po-1"
      },
      data: {
        status: "FAILED"
      }
    });
    expect(prisma.paymentAttempt.update).toHaveBeenCalledWith({
      where: {
        id: "attempt-1"
      },
      data: {
        status: "FAILED",
        errorMessage: "stripe down"
      }
    });
  });

  it("captures a Stripe payment and moves the order to CAPTURE_PENDING", async () => {
    const { controller, prisma, stripeClient } = createController();
    stripeClient.paymentIntents.capture.mockResolvedValue({
      id: "pi_123",
      status: "succeeded"
    });

    await expect(
      controller.capturePayment("po-1", { amount: 1000 }, "idem-capture")
    ).resolves.toEqual({
      paymentOrderId: "po-1",
      captureId: "capture-1",
      provider: "STRIPE",
      status: "CAPTURE_PENDING",
      externalRef: "pi_123",
      replayed: false
    });

    expect(stripeClient.paymentIntents.capture).toHaveBeenCalledWith(
      "pi_123",
      expect.objectContaining({
        amount_to_capture: 1000
      }),
      {
        idempotencyKey: "idem-capture"
      }
    );
    expect(prisma.capture.create).toHaveBeenCalledWith({
      data: {
        paymentOrderId: "po-1",
        amount: 1000,
        status: "REQUESTED"
      }
    });
    expect(prisma.paymentOrder.update).toHaveBeenCalledWith({
      where: {
        id: "po-1"
      },
      data: {
        status: "CAPTURE_PENDING"
      }
    });
  });

  it("marks local capture rows failed and returns 502 on Stripe capture failure", async () => {
    const { controller, prisma, stripeClient } = createController();
    stripeClient.paymentIntents.capture.mockRejectedValue(new Error("stripe capture down"));

    try {
      await controller.capturePayment("po-1", { amount: 1000 }, "idem-capture-fail");
      fail("Expected capturePayment to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    }

    expect(prisma.capture.update).toHaveBeenCalledWith({
      where: {
        id: "capture-1"
      },
      data: {
        status: "FAILED"
      }
    });
    expect(prisma.paymentOrder.update).toHaveBeenCalledWith({
      where: {
        id: "po-1"
      },
      data: {
        status: "FAILED"
      }
    });
  });
});
