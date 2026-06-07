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
import { PaymentRouterService } from "../payments/payment-router.service";
import { PrismaService } from "../prisma/prisma.service";
import { RenewSubscriptionDto } from "./dto/renew-subscription.dto";
import { StartSubscriptionDto } from "./dto/start-subscription.dto";

type StartSubscriptionResponse = {
  subscriptionId: string;
  subscriptionChargeId: string;
  paymentMethodTokenId: string;
  provider: PaymentProvider;
  status: "ACTIVE";
  externalRef: string;
};

type RenewSubscriptionResponse = {
  subscriptionId: string;
  subscriptionChargeId: string;
  provider: PaymentProvider;
  status: "PENDING";
  externalRef: string;
};

@Controller("subscriptions")
export class SubscriptionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly router: PaymentRouterService
  ) {}

  @Post("start")
  async startSubscription(
    @Body() body: StartSubscriptionDto,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const bodyHash = hashRequest(body);
    const result = await this.idempotency.runOnce(
      "api:start_subscription",
      key,
      bodyHash,
      async () => ({
        status: HttpStatus.OK,
        body: await this.startSubscriptionOnce(body, key, bodyHash)
      })
    );

    return {
      ...result.body,
      replayed: result.replayed
    };
  }

  @Post(":id/renew")
  async renewSubscription(
    @Param("id") subscriptionId: string,
    @Body() body: RenewSubscriptionDto,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const bodyHash = hashRequest({
      subscriptionId,
      ...body
    });
    const result = await this.idempotency.runOnce(
      "api:renew_subscription",
      key,
      bodyHash,
      async () => ({
        status: HttpStatus.OK,
        body: await this.renewSubscriptionOnce(
          subscriptionId,
          body,
          key,
          bodyHash
        )
      })
    );

    return {
      ...result.body,
      replayed: result.replayed
    };
  }

  private async startSubscriptionOnce(
    body: StartSubscriptionDto,
    idempotencyKey: string,
    requestHash: string
  ): Promise<StartSubscriptionResponse> {
    const provider = this.chooseProvider(body.currency, body.providerOverride);
    const customer = await this.getOrCreateCustomer(body, provider);
    const paymentMethodToken = await this.prisma.paymentMethodToken.upsert({
      where: {
        provider_tokenId: {
          provider,
          tokenId: body.paymentMethodId
        }
      },
      create: {
        customerId: customer.id,
        provider,
        tokenId: body.paymentMethodId
      },
      update: {
        customerId: customer.id
      }
    });
    const subscription = await this.prisma.subscription.create({
      data: {
        customerId: customer.id,
        paymentMethodTokenId: paymentMethodToken.id,
        provider,
        status: "SETUP_PENDING",
        cadence: body.cadence ?? "monthly",
        amount: body.amount,
        currency: body.currency.toUpperCase()
      }
    });
    const charge = await this.prisma.subscriptionCharge.create({
      data: {
        subscriptionId: subscription.id,
        kind: "CIT",
        amount: body.amount,
        currency: body.currency.toUpperCase(),
        status: "PENDING"
      }
    });
    const operation = await this.prisma.pspOperation.create({
      data: {
        provider,
        operation: "start_subscription",
        idempotencyKey,
        internalEntityType: "Subscription",
        internalEntityId: subscription.id,
        requestHash
      }
    });
    const strategy = this.router.getStrategyForProvider(provider);

    try {
      const result = await strategy.startSubscription({
        subscriptionId: subscription.id,
        amount: body.amount,
        currency: body.currency,
        customer: {
          id: customer.id,
          email: customer.email ?? undefined,
          providerCustomerId: this.getProviderCustomerId(customer, provider)
        },
        paymentMethod: {
          handle: paymentMethodToken.tokenId,
          tokenId: paymentMethodToken.tokenId,
          type: provider === "STRIPE" ? "stripe_payment_method" : "adyen_state_data"
        },
        paymentMethodTokenId: paymentMethodToken.tokenId,
        cadence: body.cadence ?? "monthly",
        idempotencyKey,
        metadata: {
          ...(body.metadata ?? {}),
          subscriptionId: subscription.id,
          subscriptionChargeId: charge.id,
          subscriptionChargeKind: "CIT"
        }
      });
      const storedTokenId = result.paymentMethodTokenId ?? paymentMethodToken.tokenId;
      const activeToken =
        storedTokenId === paymentMethodToken.tokenId
          ? paymentMethodToken
          : await this.prisma.paymentMethodToken.upsert({
              where: {
                provider_tokenId: {
                  provider,
                  tokenId: storedTokenId
                }
              },
              create: {
                customerId: customer.id,
                provider,
                tokenId: storedTokenId
              },
              update: {
                customerId: customer.id
              }
            });

      await this.prisma.subscription.update({
        where: {
          id: subscription.id
        },
        data: {
          paymentMethodTokenId: activeToken.id,
          status: "ACTIVE",
          externalRef: result.externalRef
        }
      });
      await this.prisma.subscriptionCharge.update({
        where: {
          id: charge.id
        },
        data: {
          status: "SUCCEEDED",
          externalRef: result.externalRef
        }
      });
      await this.prisma.pspOperation.update({
        where: {
          id: operation.id
        },
        data: {
          responseStatus: HttpStatus.OK,
          responseRef: result.externalRef,
          responseBody: result.raw as Prisma.InputJsonValue
        }
      });

      return {
        subscriptionId: subscription.id,
        subscriptionChargeId: charge.id,
        paymentMethodTokenId: activeToken.id,
        provider,
        status: "ACTIVE",
        externalRef: result.externalRef
      };
    } catch (error) {
      await this.markStartFailed(subscription.id, charge.id, operation.id, error);
      throw new HttpException("PSP subscription start failed", HttpStatus.BAD_GATEWAY);
    }
  }

  private async renewSubscriptionOnce(
    subscriptionId: string,
    body: RenewSubscriptionDto,
    idempotencyKey: string,
    requestHash: string
  ): Promise<RenewSubscriptionResponse> {
    const subscription = await this.prisma.subscription.findUnique({
      where: {
        id: subscriptionId
      },
      include: {
        customer: true,
        paymentMethodToken: true
      }
    });

    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const amount = body.amount ?? subscription.amount;
    const charge = await this.prisma.subscriptionCharge.create({
      data: {
        subscriptionId,
        kind: "MIT",
        amount,
        currency: subscription.currency,
        status: "PENDING"
      }
    });
    const operation = await this.prisma.pspOperation.create({
      data: {
        provider: subscription.provider,
        operation: "renew_subscription",
        idempotencyKey,
        internalEntityType: "SubscriptionCharge",
        internalEntityId: charge.id,
        requestHash
      }
    });
    const strategy = this.router.getStrategyForProvider(subscription.provider);

    try {
      const result = await strategy.renewSubscription({
        subscriptionId,
        subscriptionChargeId: charge.id,
        amount,
        currency: subscription.currency,
        subscriptionExternalRef: subscription.externalRef ?? subscription.id,
        customer: {
          id: subscription.customer.id,
          email: subscription.customer.email ?? undefined,
          providerCustomerId: this.getProviderCustomerId(
            subscription.customer,
            subscription.provider
          )
        },
        paymentMethodTokenId: subscription.paymentMethodToken.tokenId,
        idempotencyKey,
        metadata: {
          ...(body.metadata ?? {}),
          subscriptionId,
          subscriptionChargeId: charge.id,
          subscriptionChargeKind: "MIT"
        }
      });

      await this.prisma.subscription.update({
        where: {
          id: subscriptionId
        },
        data: {
          status: "RENEWAL_PENDING"
        }
      });
      await this.prisma.subscriptionCharge.update({
        where: {
          id: charge.id
        },
        data: {
          externalRef: result.externalRef,
          status: "PENDING"
        }
      });
      await this.prisma.pspOperation.update({
        where: {
          id: operation.id
        },
        data: {
          responseStatus: HttpStatus.OK,
          responseRef: result.externalRef,
          responseBody: result.raw as Prisma.InputJsonValue
        }
      });

      return {
        subscriptionId,
        subscriptionChargeId: charge.id,
        provider: subscription.provider,
        status: "PENDING",
        externalRef: result.externalRef
      };
    } catch (error) {
      await this.markRenewFailed(subscriptionId, charge.id, operation.id, error);
      throw new HttpException("PSP subscription renewal failed", HttpStatus.BAD_GATEWAY);
    }
  }

  private async getOrCreateCustomer(
    body: StartSubscriptionDto,
    provider: PaymentProvider
  ) {
    if (body.customerId) {
      const existing = await this.prisma.customer.findUnique({
        where: {
          id: body.customerId
        }
      });

      if (existing) {
        return existing;
      }
    }

    return this.prisma.customer.create({
      data: {
        email: body.email,
        stripeCustomerId:
          provider === "STRIPE" ? body.providerCustomerId : undefined,
        adyenShopperReference:
          provider === "ADYEN" ? body.providerCustomerId : undefined
      }
    });
  }

  private chooseProvider(
    currency: string,
    override?: PaymentProvider
  ): PaymentProvider {
    if (override) {
      return override;
    }

    return currency.toUpperCase() === "EUR" ? "ADYEN" : "STRIPE";
  }

  private getProviderCustomerId(
    customer: {
      id: string;
      stripeCustomerId?: string | null;
      adyenShopperReference?: string | null;
    },
    provider: PaymentProvider
  ): string | undefined {
    return provider === "STRIPE"
      ? customer.stripeCustomerId ?? undefined
      : customer.adyenShopperReference ?? customer.id;
  }

  private async markStartFailed(
    subscriptionId: string,
    chargeId: string,
    operationId: string,
    error: unknown
  ) {
    await this.prisma.subscription.update({
      where: {
        id: subscriptionId
      },
      data: {
        status: "CANCELED"
      }
    });
    await this.prisma.subscriptionCharge.update({
      where: {
        id: chargeId
      },
      data: {
        status: "FAILED"
      }
    });
    await this.markOperationFailed(operationId, error);
  }

  private async markRenewFailed(
    subscriptionId: string,
    chargeId: string,
    operationId: string,
    error: unknown
  ) {
    await this.prisma.subscription.update({
      where: {
        id: subscriptionId
      },
      data: {
        status: "PAST_DUE"
      }
    });
    await this.prisma.subscriptionCharge.update({
      where: {
        id: chargeId
      },
      data: {
        status: "FAILED"
      }
    });
    await this.markOperationFailed(operationId, error);
  }

  private async markOperationFailed(operationId: string, error: unknown) {
    await this.prisma.pspOperation.update({
      where: {
        id: operationId
      },
      data: {
        responseStatus: HttpStatus.BAD_GATEWAY,
        error: error instanceof Error ? error.message : "Unknown PSP error"
      }
    });
  }

  private requireIdempotencyKey(idempotencyKey?: string): string {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key header is required");
    }

    return idempotencyKey;
  }
}
