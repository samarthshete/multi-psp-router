import { Module } from "@nestjs/common";
import { IdempotencyModule } from "../idempotency/idempotency.module";
import { PaymentsModule } from "../payments/payments.module";
import { SubscriptionsController } from "./subscriptions.controller";

@Module({
  imports: [IdempotencyModule, PaymentsModule],
  controllers: [SubscriptionsController]
})
export class SubscriptionsModule {}
