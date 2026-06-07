import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { PaymentsModule } from "../payments/payments.module";
import { WebhookIngestionService } from "./webhook-ingestion.service";
import { WebhookNormalizationService } from "./webhook-normalization.service";
import { WebhooksController } from "./webhooks.controller";

@Module({
  imports: [EventsModule, PaymentsModule],
  controllers: [WebhooksController],
  providers: [WebhookIngestionService, WebhookNormalizationService],
  exports: [WebhookIngestionService, WebhookNormalizationService]
})
export class WebhooksModule {}
