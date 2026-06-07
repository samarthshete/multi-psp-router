import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { DevModule } from "./dev/dev.module";
import { EventsModule } from "./events/events.module";
import { HealthModule } from "./health/health.module";
import { IdempotencyModule } from "./idempotency/idempotency.module";
import { PaymentsModule } from "./payments/payments.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    IdempotencyModule,
    PaymentsModule,
    SubscriptionsModule,
    WebhooksModule,
    EventsModule,
    DevModule
  ],
  controllers: [AppController],
  providers: []
})
export class AppModule {}
