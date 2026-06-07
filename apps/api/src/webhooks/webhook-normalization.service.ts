import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@router/db";
import type { VerifiedWebhook } from "@router/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AdyenStrategy } from "../payments/strategies/adyen.strategy";
import { StripeStrategy } from "../payments/strategies/stripe.strategy";
import { EventLedgerService } from "../events/event-ledger.service";

@Injectable()
export class WebhookNormalizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeStrategy: StripeStrategy,
    private readonly adyenStrategy: AdyenStrategy,
    private readonly ledger: EventLedgerService
  ) {}

  async processOne(rawId: string) {
    const raw = await this.prisma.rawWebhookEvent.findUnique({
      where: {
        id: rawId
      }
    });

    if (!raw) {
      throw new NotFoundException("Raw webhook event not found");
    }

    const verified: VerifiedWebhook = {
      provider: raw.provider,
      signatureValid: raw.signatureValid,
      dedupeKey: raw.dedupeKey,
      payload: raw.payload,
      receivedAt: raw.receivedAt
    };
    const normalizedEvents =
      raw.provider === "STRIPE"
        ? this.stripeStrategy.normalizeWebhook(verified)
        : this.adyenStrategy.normalizeWebhook(verified);
    const events = [];

    for (const event of normalizedEvents) {
      const saved = await this.prisma.normalizedPaymentEvent.upsert({
        where: {
          rawWebhookId_type: {
            rawWebhookId: raw.id,
            type: event.type
          }
        },
        create: {
          rawWebhookId: raw.id,
          provider: event.provider,
          type: event.type,
          paymentOrderId: event.paymentOrderId,
          subscriptionId: event.subscriptionId,
          subscriptionChargeId: event.subscriptionChargeId,
          externalRef: event.externalRef,
          payload: event.payload as Prisma.InputJsonValue,
          occurredAt: event.occurredAt
        },
        update: {
          externalRef: event.externalRef,
          payload: event.payload as Prisma.InputJsonValue,
          occurredAt: event.occurredAt
        }
      });

      await this.ledger.apply(saved);
      events.push(saved);
    }

    await this.prisma.rawWebhookEvent.update({
      where: {
        id: raw.id
      },
      data: {
        processed: true,
        processedAt: new Date(),
        errorMessage: null
      }
    });

    return {
      rawWebhookEventId: raw.id,
      normalizedEvents: events.length
    };
  }

  async processPending(limit = 100) {
    const pending = await this.prisma.rawWebhookEvent.findMany({
      where: {
        processed: false
      },
      orderBy: {
        receivedAt: "asc"
      },
      take: limit
    });
    const results = [];

    for (const raw of pending) {
      try {
        results.push(await this.processOne(raw.id));
      } catch (error) {
        await this.prisma.rawWebhookEvent.update({
          where: {
            id: raw.id
          },
          data: {
            errorMessage:
              error instanceof Error ? error.message : "Webhook processing failed"
          }
        });
      }
    }

    return {
      processed: results.length,
      results
    };
  }
}
