import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post
} from "@nestjs/common";
import type { PaymentProvider } from "@router/shared";
import type { Prisma } from "@router/db";
import { hashRequest } from "../idempotency/idempotency.util";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { PrismaService } from "../prisma/prisma.service";
import { CapturePaymentDto } from "./dto/capture-payment.dto";
import { CreateAuthHoldDto } from "./dto/create-auth-hold.dto";
import { PaymentRouterService, RoutedPaymentStrategy } from "./payment-router.service";

type AuthHoldResponse = {
  paymentOrderId: string;
  provider: PaymentProvider;
  status: "AUTH_PENDING";
  externalRef: string;
};

type CaptureResponse = {
  paymentOrderId: string;
  captureId: string;
  provider: PaymentProvider;
  status: "CAPTURE_PENDING";
  externalRef: string;
};

@Controller("payments")
export class PaymentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly router: PaymentRouterService
  ) {}

  @Post("auth-hold")
  async createAuthHold(
    @Body() body: CreateAuthHoldDto,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const bodyHash = hashRequest(body);

    const result = await this.idempotency.runOnce(
      "api:create_auth_hold",
      key,
      bodyHash,
      async () => {
        const response = await this.createAuthHoldOnce(body, key, bodyHash);

        return {
          status: HttpStatus.OK,
          body: response
        };
      }
    );

    return {
      ...result.body,
      replayed: result.replayed
    };
  }

  @Post(":id/capture")
  async capturePayment(
    @Param("id") paymentOrderId: string,
    @Body() body: CapturePaymentDto,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const bodyHash = hashRequest({
      paymentOrderId,
      ...body
    });

    const result = await this.idempotency.runOnce(
      "api:capture_payment",
      key,
      bodyHash,
      async () => {
        const response = await this.capturePaymentOnce(paymentOrderId, body, key, bodyHash);

        return {
          status: HttpStatus.OK,
          body: response
        };
      }
    );

    return {
      ...result.body,
      replayed: result.replayed
    };
  }

  private async createAuthHoldOnce(
    body: CreateAuthHoldDto,
    idempotencyKey: string,
    requestHash: string
  ): Promise<AuthHoldResponse> {
    const provider = this.chooseInitialProvider(body.currency, body.providerOverride);
    const paymentOrder = await this.prisma.paymentOrder.create({
      data: {
        customerId: body.customerId,
        amount: body.amount,
        currency: body.currency.toUpperCase(),
        provider,
        status: "CREATED",
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue
      }
    });
    const route = await this.router.route({
      paymentOrderId: paymentOrder.id,
      amount: body.amount,
      currency: body.currency,
      providerOverride: body.providerOverride
    });
    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        paymentOrderId: paymentOrder.id,
        attemptNumber: 1,
        provider: route.provider,
        status: "AUTH_PENDING"
      }
    });
    const operation = await this.prisma.pspOperation.create({
      data: {
        provider: route.provider,
        operation: "create_auth_hold",
        idempotencyKey,
        internalEntityType: "PaymentOrder",
        internalEntityId: paymentOrder.id,
        requestHash
      }
    });

    try {
      const authHold = await route.strategy.createAuthHold({
        paymentOrderId: paymentOrder.id,
        amount: body.amount,
        currency: body.currency,
        paymentMethod: {
          handle: body.paymentMethodId,
          tokenId: body.paymentMethodId,
          type: route.provider === "STRIPE" ? "stripe_payment_method" : "adyen_state_data"
        },
        customer: body.customerId
          ? {
              id: body.customerId
            }
          : undefined,
        idempotencyKey,
        metadata: {
          ...(body.metadata ?? {}),
          paymentOrderId: paymentOrder.id
        }
      });

      await this.prisma.paymentOrder.update({
        where: {
          id: paymentOrder.id
        },
        data: {
          provider: route.provider,
          status: "AUTH_PENDING",
          externalRef: authHold.externalRef
        }
      });
      await this.prisma.paymentAttempt.update({
        where: {
          id: attempt.id
        },
        data: {
          externalRef: authHold.externalRef,
          status: "AUTH_PENDING"
        }
      });
      await this.prisma.pspOperation.update({
        where: {
          id: operation.id
        },
        data: {
          responseStatus: HttpStatus.OK,
          responseRef: authHold.externalRef,
          responseBody: authHold.raw as Prisma.InputJsonValue
        }
      });

      return {
        paymentOrderId: paymentOrder.id,
        provider: route.provider,
        status: "AUTH_PENDING",
        externalRef: authHold.externalRef
      };
    } catch (error) {
      await this.markAuthHoldFailed(paymentOrder.id, attempt.id, operation.id, error);
      throw new HttpException("PSP auth hold failed", HttpStatus.BAD_GATEWAY);
    }
  }

  private async capturePaymentOnce(
    paymentOrderId: string,
    body: CapturePaymentDto,
    idempotencyKey: string,
    requestHash: string
  ): Promise<CaptureResponse> {
    const paymentOrder = await this.prisma.paymentOrder.findUnique({
      where: {
        id: paymentOrderId
      }
    });

    if (!paymentOrder?.externalRef) {
      throw new HttpException("Payment order not found", HttpStatus.NOT_FOUND);
    }

    const capture = await this.prisma.capture.create({
      data: {
        paymentOrderId,
        amount: body.amount ?? paymentOrder.amount,
        status: "REQUESTED"
      }
    });
    const operation = await this.prisma.pspOperation.create({
      data: {
        provider: paymentOrder.provider,
        operation: "capture_payment",
        idempotencyKey,
        internalEntityType: "Capture",
        internalEntityId: capture.id,
        requestHash
      }
    });
    const strategy = this.router.getStrategyForProvider(paymentOrder.provider);

    try {
      const captureResult = await strategy.capturePayment({
        paymentOrderId,
        externalRef: paymentOrder.externalRef,
        amount: body.amount ?? paymentOrder.amount,
        currency: paymentOrder.currency,
        idempotencyKey,
        metadata: {
          ...(body.metadata ?? {}),
          paymentOrderId
        }
      });

      await this.prisma.capture.update({
        where: {
          id: capture.id
        },
        data: {
          externalRef: captureResult.externalRef,
          status: "REQUESTED"
        }
      });
      await this.prisma.paymentOrder.update({
        where: {
          id: paymentOrderId
        },
        data: {
          status: "CAPTURE_PENDING"
        }
      });
      await this.prisma.pspOperation.update({
        where: {
          id: operation.id
        },
        data: {
          responseStatus: HttpStatus.OK,
          responseRef: captureResult.externalRef,
          responseBody: captureResult.raw as Prisma.InputJsonValue
        }
      });

      return {
        paymentOrderId,
        captureId: capture.id,
        provider: paymentOrder.provider,
        status: "CAPTURE_PENDING",
        externalRef: captureResult.externalRef
      };
    } catch (error) {
      await this.markCaptureFailed(paymentOrderId, capture.id, operation.id, error);
      throw new HttpException("PSP capture failed", HttpStatus.BAD_GATEWAY);
    }
  }

  private requireIdempotencyKey(idempotencyKey?: string): string {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key header is required");
    }

    return idempotencyKey;
  }

  private chooseInitialProvider(
    currency: string,
    override?: PaymentProvider
  ): PaymentProvider {
    if (override) {
      return override;
    }

    return currency.toUpperCase() === "EUR" ? "ADYEN" : "STRIPE";
  }

  private async markAuthHoldFailed(
    paymentOrderId: string,
    attemptId: string,
    operationId: string,
    error: unknown
  ) {
    await this.prisma.paymentOrder.update({
      where: {
        id: paymentOrderId
      },
      data: {
        status: "FAILED"
      }
    });
    await this.prisma.paymentAttempt.update({
      where: {
        id: attemptId
      },
      data: {
        status: "FAILED",
        errorMessage: this.getErrorMessage(error)
      }
    });
    await this.prisma.pspOperation.update({
      where: {
        id: operationId
      },
      data: {
        responseStatus: HttpStatus.BAD_GATEWAY,
        error: this.getErrorMessage(error)
      }
    });
  }

  private async markCaptureFailed(
    paymentOrderId: string,
    captureId: string,
    operationId: string,
    error: unknown
  ) {
    await this.prisma.capture.update({
      where: {
        id: captureId
      },
      data: {
        status: "FAILED"
      }
    });
    await this.prisma.paymentOrder.update({
      where: {
        id: paymentOrderId
      },
      data: {
        status: "FAILED"
      }
    });
    await this.prisma.pspOperation.update({
      where: {
        id: operationId
      },
      data: {
        responseStatus: HttpStatus.BAD_GATEWAY,
        error: this.getErrorMessage(error)
      }
    });
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown PSP error";
  }
}
