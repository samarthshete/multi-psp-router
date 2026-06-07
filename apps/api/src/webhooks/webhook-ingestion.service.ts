import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { PaymentProvider, VerifiedWebhook } from "@router/shared";
import type { Prisma } from "@router/db";
import { PrismaService } from "../prisma/prisma.service";
import { AdyenStrategy } from "../payments/strategies/adyen.strategy";
import { StripeStrategy } from "../payments/strategies/stripe.strategy";
import { WebhookNormalizationService } from "./webhook-normalization.service";

type IngestResult = {
  duplicate: boolean;
  rawWebhookEventId?: string;
  processed?: boolean;
};

@Injectable()
export class WebhookIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeStrategy: StripeStrategy,
    private readonly adyenStrategy: AdyenStrategy,
    private readonly normalization: WebhookNormalizationService
  ) {}

  async ingestStripe(
    rawBody: Buffer | undefined,
    sigHeader: string | undefined
  ): Promise<IngestResult> {
    if (!rawBody || !sigHeader) {
      throw new HttpException(
        "Stripe webhook raw body or signature is missing",
        HttpStatus.BAD_REQUEST
      );
    }

    const verified = await this.stripeStrategy.verifyWebhookSignature(rawBody, {
      "stripe-signature": sigHeader
    });

    return this.persistRaw(verified);
  }

  async ingestAdyen(
    rawBody: Buffer | undefined,
    body: unknown
  ): Promise<IngestResult> {
    const bufferBody = rawBody ?? Buffer.from(JSON.stringify(body ?? {}), "utf8");
    const verified = await this.adyenStrategy.verifyWebhookSignature(
      bufferBody,
      {}
    );

    return this.persistRaw(verified);
  }

  private async persistRaw(verified: VerifiedWebhook): Promise<IngestResult> {
    return this.persistRawInternal(
      verified.provider,
      verified.dedupeKey,
      verified.payload,
      verified.signatureValid
    );
  }

  private async persistRawInternal(
    provider: PaymentProvider,
    dedupeKey: string,
    payload: unknown,
    signatureValid: boolean
  ): Promise<IngestResult> {
    try {
      const raw = await this.prisma.rawWebhookEvent.create({
        data: {
          provider,
          dedupeKey,
          signatureValid,
          payload: payload as Prisma.InputJsonValue
        }
      });

      if (process.env.WEBHOOK_PROCESSING_MODE === "inline") {
        await this.normalization.processOne(raw.id);

        return {
          duplicate: false,
          rawWebhookEventId: raw.id,
          processed: true
        };
      }

      return {
        duplicate: false,
        rawWebhookEventId: raw.id,
        processed: false
      };
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        return {
          duplicate: true
        };
      }

      throw error;
    }
  }

  private isUniqueConstraint(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    );
  }
}
