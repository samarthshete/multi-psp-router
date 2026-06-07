import { Injectable } from "@nestjs/common";
import type { $Enums } from "@router/db";
import type { NormalizedEventType } from "@router/shared";
import { PrismaService } from "../prisma/prisma.service";

type LedgerEvent = {
  type: NormalizedEventType;
  paymentOrderId?: string | null;
  subscriptionId?: string | null;
  subscriptionChargeId?: string | null;
  externalRef?: string | null;
};

@Injectable()
export class EventLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(event: LedgerEvent): Promise<void> {
    switch (event.type) {
      case "PAYMENT_AUTHORIZED":
        await this.updatePaymentOrder(event, ["AUTH_PENDING"], "AUTHORIZED");
        return;
      case "PAYMENT_CAPTURED":
      case "PAYMENT_SUCCEEDED":
        await this.updatePaymentOrder(
          event,
          ["AUTH_PENDING", "AUTHORIZED", "CAPTURE_PENDING"],
          "CAPTURED"
        );
        await this.updateCapture(event, ["REQUESTED"], "SUCCEEDED");
        return;
      case "PAYMENT_FAILED":
        await this.updatePaymentOrder(
          event,
          ["CREATED", "AUTH_PENDING", "AUTHORIZED", "CAPTURE_PENDING"],
          "FAILED"
        );
        return;
      case "PAYMENT_CAPTURE_FAILED":
        await this.updatePaymentOrder(event, ["CAPTURE_PENDING"], "FAILED");
        await this.updateCapture(event, ["REQUESTED"], "FAILED");
        return;
      case "SUBSCRIPTION_CREATED":
        await this.updateSubscription(event, ["SETUP_PENDING"], "ACTIVE");
        return;
      case "SUBSCRIPTION_RENEWED":
        await this.updateSubscription(
          event,
          ["ACTIVE", "RENEWAL_PENDING", "PAST_DUE"],
          "ACTIVE"
        );
        await this.updateSubscriptionCharge(event, ["PENDING"], "SUCCEEDED");
        return;
      case "SUBSCRIPTION_PAYMENT_FAILED":
        await this.updateSubscription(
          event,
          ["ACTIVE", "RENEWAL_PENDING", "PAST_DUE"],
          "PAST_DUE"
        );
        await this.updateSubscriptionCharge(event, ["PENDING"], "FAILED");
        return;
      case "TOKEN_CREATED":
      case "DISPUTE_OPENED":
      case "UNKNOWN":
        return;
    }
  }

  private async updatePaymentOrder(
    event: LedgerEvent,
    fromStatuses: $Enums.PaymentOrderStatus[],
    toStatus: $Enums.PaymentOrderStatus
  ) {
    const identity = this.identityWhere(event.paymentOrderId, event.externalRef);

    if (!identity.length) {
      return;
    }

    await this.prisma.paymentOrder.updateMany({
      where: {
        OR: identity,
        status: {
          in: fromStatuses
        }
      },
      data: {
        status: toStatus
      }
    });
  }

  private async updateCapture(
    event: LedgerEvent,
    fromStatuses: $Enums.CaptureStatus[],
    toStatus: $Enums.CaptureStatus
  ) {
    const identity = this.identityWhere(undefined, event.externalRef);

    if (!identity.length) {
      return;
    }

    await this.prisma.capture.updateMany({
      where: {
        OR: identity,
        status: {
          in: fromStatuses
        }
      },
      data: {
        status: toStatus
      }
    });
  }

  private async updateSubscription(
    event: LedgerEvent,
    fromStatuses: $Enums.SubscriptionStatus[],
    toStatus: $Enums.SubscriptionStatus
  ) {
    const identity = this.identityWhere(event.subscriptionId, event.externalRef);

    if (!identity.length) {
      return;
    }

    await this.prisma.subscription.updateMany({
      where: {
        OR: identity,
        status: {
          in: fromStatuses
        }
      },
      data: {
        status: toStatus
      }
    });
  }

  private async updateSubscriptionCharge(
    event: LedgerEvent,
    fromStatuses: $Enums.SubscriptionChargeStatus[],
    toStatus: $Enums.SubscriptionChargeStatus
  ) {
    const identity = this.identityWhere(
      event.subscriptionChargeId,
      event.externalRef
    );

    if (!identity.length) {
      return;
    }

    await this.prisma.subscriptionCharge.updateMany({
      where: {
        OR: identity,
        status: {
          in: fromStatuses
        }
      },
      data: {
        status: toStatus
      }
    });
  }

  private identityWhere(id?: string | null, externalRef?: string | null) {
    return [
      ...(id ? [{ id }] : []),
      ...(externalRef ? [{ externalRef }] : [])
    ];
  }
}
