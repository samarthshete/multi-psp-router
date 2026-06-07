import { Injectable } from "@nestjs/common";
import type {
  AuthHoldInput,
  AuthHoldResult,
  CaptureInput,
  CaptureResult,
  PaymentProvider,
  PaymentProviderStrategy,
  RenewSubscriptionInput,
  RenewSubscriptionResult,
  StartSubscriptionInput,
  StartSubscriptionResult
} from "@router/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AdyenStrategy } from "./strategies/adyen.strategy";
import { StripeStrategy } from "./strategies/stripe.strategy";

export type PaymentRouteInput = {
  paymentOrderId: string;
  amount: number;
  currency: string;
  providerOverride?: PaymentProvider;
};

export type PaymentRouteResult = {
  provider: PaymentProvider;
  reason: string;
  strategy: RoutedPaymentStrategy;
};

export type RoutedPaymentStrategy = PaymentProviderStrategy & {
  createAuthHold(input: AuthHoldInput): Promise<AuthHoldResult>;
  capturePayment(input: CaptureInput): Promise<CaptureResult>;
  startSubscription(
    input: StartSubscriptionInput
  ): Promise<StartSubscriptionResult>;
  renewSubscription(
    input: RenewSubscriptionInput
  ): Promise<RenewSubscriptionResult>;
};

@Injectable()
export class PaymentRouterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeStrategy: StripeStrategy,
    private readonly adyenStrategy: AdyenStrategy
  ) {}

  async route(input: PaymentRouteInput): Promise<PaymentRouteResult> {
    const provider = this.chooseProvider(input);
    const reason = this.getReason(input, provider);
    const strategy = this.getStrategyForProvider(provider);

    await this.prisma.routingDecision.create({
      data: {
        paymentOrderId: input.paymentOrderId,
        chosenProvider: provider,
        reason,
        ruleSnapshot: {
          amount: input.amount,
          currency: input.currency,
          providerOverride: input.providerOverride ?? null
        }
      }
    });

    return {
      provider,
      reason,
      strategy
    };
  }

  private chooseProvider(input: PaymentRouteInput): PaymentProvider {
    if (input.providerOverride) {
      return input.providerOverride;
    }

    if (input.currency.toUpperCase() === "EUR") {
      return "ADYEN";
    }

    return "STRIPE";
  }

  private getReason(
    input: PaymentRouteInput,
    provider: PaymentProvider
  ): string {
    if (input.providerOverride) {
      return `Provider override selected ${provider}`;
    }

    if (provider === "ADYEN") {
      return "EUR currency routed to ADYEN";
    }

    return `${input.currency.toUpperCase()} currency routed to STRIPE`;
  }

  getStrategyForProvider(provider: PaymentProvider): RoutedPaymentStrategy {
    return provider === "ADYEN" ? this.adyenStrategy : this.stripeStrategy;
  }
}
