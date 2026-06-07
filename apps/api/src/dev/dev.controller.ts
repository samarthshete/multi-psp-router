import { Body, Controller, Post } from "@nestjs/common";
import { IsString } from "class-validator";
import { WebhookNormalizationService } from "../webhooks/webhook-normalization.service";

class ReplayWebhookDto {
  @IsString()
  rawWebhookEventId!: string;
}

@Controller("dev")
export class DevController {
  constructor(private readonly normalization: WebhookNormalizationService) {}

  @Post("replay-webhook")
  replayWebhook(@Body() body: ReplayWebhookDto) {
    return this.normalization.processOne(body.rawWebhookEventId);
  }

  @Post("process-webhook-jobs")
  processWebhookJobs() {
    return this.normalization.processPending();
  }
}
