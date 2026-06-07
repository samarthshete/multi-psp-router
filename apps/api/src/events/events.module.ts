import { Module } from "@nestjs/common";
import type {
  NormalizedEventType,
  PaymentProviderStrategy
} from "@router/shared";
import { EventLedgerService } from "./event-ledger.service";

type SharedTypesSmokeTest = {
  eventType: NormalizedEventType;
  strategy: PaymentProviderStrategy;
};

void (undefined as SharedTypesSmokeTest | undefined);

@Module({
  providers: [EventLedgerService],
  exports: [EventLedgerService]
})
export class EventsModule {}
