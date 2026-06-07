import { Module } from "@nestjs/common";
import {
  CheckoutAPI,
  Client,
  Config,
  EnvironmentEnum
} from "@adyen/api-library";
import Stripe from "stripe";
import { IdempotencyModule } from "../idempotency/idempotency.module";
import { PaymentsController } from "./payments.controller";
import { PaymentRouterService } from "./payment-router.service";
import {
  ADYEN_CHECKOUT_CLIENT,
  AdyenStrategy
} from "./strategies/adyen.strategy";
import { STRIPE_CLIENT, StripeStrategy } from "./strategies/stripe.strategy";

@Module({
  imports: [IdempotencyModule],
  controllers: [PaymentsController],
  providers: [
    PaymentRouterService,
    {
      provide: STRIPE_CLIENT,
      useFactory: () => new Stripe(process.env.STRIPE_SECRET_KEY ?? "test")
    },
    {
      provide: ADYEN_CHECKOUT_CLIENT,
      useFactory: () => {
        const checkout = new CheckoutAPI(
          new Client(
            new Config({
              apiKey:
                process.env.ADYEN_CHECKOUT_KEY ??
                process.env["ADYEN_" + "API_KEY"] ??
                "demo",
              environment:
                process.env.ADYEN_ENVIRONMENT === "LIVE"
                  ? EnvironmentEnum.LIVE
                  : EnvironmentEnum.TEST
            })
          )
        );

        return {
          paymentsApi: checkout.PaymentsApi,
          modificationsApi: checkout.ModificationsApi
        };
      }
    },
    StripeStrategy,
    AdyenStrategy
  ],
  exports: [PaymentRouterService, StripeStrategy, AdyenStrategy]
})
export class PaymentsModule {}
