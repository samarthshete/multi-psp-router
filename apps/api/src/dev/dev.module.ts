import { Module } from "@nestjs/common";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { DevController } from "./dev.controller";

@Module({
  imports: [WebhooksModule],
  controllers: [DevController]
})
export class DevModule {}
