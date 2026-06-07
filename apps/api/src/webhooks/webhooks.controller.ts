import { Body, Controller, Header, Headers, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { WebhookIngestionService } from "./webhook-ingestion.service";

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly ingestion: WebhookIngestionService) {}

  @Post("stripe")
  async ingestStripe(
    @Req() request: RawBodyRequest,
    @Headers("stripe-signature") stripeSignature?: string
  ) {
    const result = await this.ingestion.ingestStripe(
      request.rawBody,
      stripeSignature
    );

    if (result.duplicate) {
      return {
        duplicate: true
      };
    }

    return {
      received: true,
      rawWebhookEventId: result.rawWebhookEventId,
      processed: result.processed
    };
  }

  @Post("adyen")
  @Header("Content-Type", "text/plain")
  async ingestAdyen(@Req() request: RawBodyRequest, @Body() body: unknown) {
    await this.ingestion.ingestAdyen(request.rawBody, body);

    return "[accepted]";
  }
}
