jest.mock("../../src/prisma/prisma.service", () => ({
  PrismaService: class PrismaService {}
}));

import { DevController } from "../../src/dev/dev.controller";
import { WebhookIngestionService } from "../../src/webhooks/webhook-ingestion.service";
import { WebhookNormalizationService } from "../../src/webhooks/webhook-normalization.service";
import { WebhooksController } from "../../src/webhooks/webhooks.controller";

function stripeStrategyMockWith(dedupeKey: string) {
  return {
    verifyWebhookSignature: jest.fn(() =>
      Promise.resolve({
        provider: "STRIPE",
        signatureValid: true,
        dedupeKey,
        payload: {
          id: dedupeKey,
          type: "payment_intent.amount_capturable_updated",
          created: 1770000000,
          data: {
            object: { id: "pi_x" }
          }
        },
        receivedAt: new Date("2026-06-07T12:00:00.000Z")
      })
    ),
    normalizeWebhook: jest.fn(() => [])
  };
}

describe("Webhook services", () => {
  it("returns duplicate=true when raw webhook insert hits P2002", async () => {
    const prisma = {
      rawWebhookEvent: {
        create: jest.fn(() => Promise.reject({ code: "P2002" }))
      }
    };
    const stripeStrategy = stripeStrategyMockWith("evt_duplicate");
    const service = new WebhookIngestionService(
      prisma as never,
      stripeStrategy as never,
      {} as never,
      {} as never
    );

    await expect(
      service.ingestStripe(Buffer.from("{}"), "stripe-signature")
    ).resolves.toEqual({
      duplicate: true
    });
  });

  it("persists raw webhooks without processing when mode is manual_drain", async () => {
    const previousMode = process.env.WEBHOOK_PROCESSING_MODE;
    process.env.WEBHOOK_PROCESSING_MODE = "manual_drain";
    const prisma = {
      rawWebhookEvent: {
        create: jest.fn(() =>
          Promise.resolve({
            id: "raw-manual"
          })
        )
      }
    };
    const stripeStrategy = stripeStrategyMockWith("evt_manual");
    const normalization = {
      processOne: jest.fn()
    };
    const service = new WebhookIngestionService(
      prisma as never,
      stripeStrategy as never,
      {} as never,
      normalization as never
    );

    try {
      await expect(
        service.ingestStripe(Buffer.from("{}"), "stripe-signature")
      ).resolves.toEqual({
        duplicate: false,
        rawWebhookEventId: "raw-manual",
        processed: false
      });
      expect(normalization.processOne).not.toHaveBeenCalled();
    } finally {
      process.env.WEBHOOK_PROCESSING_MODE = previousMode;
    }
  });

  it("processes raw webhooks inline when mode is inline", async () => {
    const previousMode = process.env.WEBHOOK_PROCESSING_MODE;
    process.env.WEBHOOK_PROCESSING_MODE = "inline";
    const prisma = {
      rawWebhookEvent: {
        create: jest.fn(() =>
          Promise.resolve({
            id: "raw-inline"
          })
        )
      }
    };
    const stripeStrategy = stripeStrategyMockWith("evt_inline");
    const normalization = {
      processOne: jest.fn(() => Promise.resolve({}))
    };
    const service = new WebhookIngestionService(
      prisma as never,
      stripeStrategy as never,
      {} as never,
      normalization as never
    );

    try {
      await expect(
        service.ingestStripe(Buffer.from("{}"), "stripe-signature")
      ).resolves.toEqual({
        duplicate: false,
        rawWebhookEventId: "raw-inline",
        processed: true
      });
      expect(normalization.processOne).toHaveBeenCalledWith("raw-inline");
    } finally {
      process.env.WEBHOOK_PROCESSING_MODE = previousMode;
    }
  });

  it("upserts normalized events and applies the event ledger", async () => {
    const raw = {
      id: "raw-1",
      provider: "STRIPE" as const,
      signatureValid: true,
      dedupeKey: "evt_1",
      receivedAt: new Date("2026-06-06T12:00:00.000Z"),
      payload: {
        id: "evt_1"
      }
    };
    const savedEvent = {
      id: "normalized-1",
      rawWebhookId: "raw-1",
      type: "PAYMENT_AUTHORIZED",
      externalRef: "pi_1"
    };
    const prisma = {
      rawWebhookEvent: {
        findUnique: jest.fn(() => Promise.resolve(raw)),
        update: jest.fn(() => Promise.resolve({}))
      },
      normalizedPaymentEvent: {
        upsert: jest.fn(() => Promise.resolve(savedEvent))
      }
    };
    const stripeStrategy = {
      normalizeWebhook: jest.fn(() => [
        {
          provider: "STRIPE",
          type: "PAYMENT_AUTHORIZED",
          externalRef: "pi_1",
          payload: raw.payload,
          occurredAt: new Date("2026-06-06T12:00:00.000Z")
        }
      ])
    };
    const ledger = {
      apply: jest.fn(() => Promise.resolve())
    };
    const service = new WebhookNormalizationService(
      prisma as never,
      stripeStrategy as never,
      {} as never,
      ledger as never
    );

    await expect(service.processOne("raw-1")).resolves.toEqual({
      rawWebhookEventId: "raw-1",
      normalizedEvents: 1
    });
    expect(prisma.normalizedPaymentEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          rawWebhookId_type: {
            rawWebhookId: "raw-1",
            type: "PAYMENT_AUTHORIZED"
          }
        }
      })
    );
    expect(ledger.apply).toHaveBeenCalledWith(savedEvent);
    expect(prisma.rawWebhookEvent.update).toHaveBeenCalledWith({
      where: {
        id: "raw-1"
      },
      data: expect.objectContaining({
        processed: true,
        errorMessage: null
      })
    });
  });

  it("replay endpoint processes one raw webhook event", async () => {
    const normalization = {
      processOne: jest.fn(() =>
        Promise.resolve({
          rawWebhookEventId: "raw-1",
          normalizedEvents: 1
        })
      )
    };
    const controller = new DevController(normalization as never);

    await expect(
      controller.replayWebhook({
        rawWebhookEventId: "raw-1"
      })
    ).resolves.toEqual({
      rawWebhookEventId: "raw-1",
      normalizedEvents: 1
    });
    expect(normalization.processOne).toHaveBeenCalledWith("raw-1");
  });

  it("Adyen webhook controller returns accepted even for duplicate raw events", async () => {
    const ingestion = {
      ingestAdyen: jest.fn(() =>
        Promise.resolve({
          duplicate: true
        })
      )
    };
    const controller = new WebhooksController(ingestion as never);
    const rawBody = Buffer.from(JSON.stringify({ notificationItems: [] }), "utf8");

    await expect(
      controller.ingestAdyen(
        { rawBody } as never,
        { notificationItems: [] }
      )
    ).resolves.toBe("[accepted]");
    expect(ingestion.ingestAdyen).toHaveBeenCalledWith(rawBody, {
      notificationItems: []
    });
  });
});
