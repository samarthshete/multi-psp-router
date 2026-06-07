import { HttpException, HttpStatus } from "@nestjs/common";
import { IdempotencyService } from "../../src/idempotency/idempotency.service";
import { hashRequest } from "../../src/idempotency/idempotency.util";
import type { PrismaService } from "../../src/prisma/prisma.service";

type RecordStatus = "IN_PROGRESS" | "COMPLETED" | "FAILED";

type FakeRecord = {
  id: string;
  scope: string;
  key: string;
  requestHash: string;
  status: RecordStatus;
  responseBody?: unknown;
  responseStatus?: number | null;
};

function createPrismaMock(records: FakeRecord[] = []) {
  return {
    idempotencyRecord: {
      findUnique: jest.fn(({ where }) => {
        const scopeKey = where.scope_key;
        const id = where.id;

        return Promise.resolve(
          records.find((record) =>
            id ? record.id === id : record.scope === scopeKey.scope && record.key === scopeKey.key
          ) ?? null
        );
      }),
      create: jest.fn(({ data }) => {
        const record = {
          id: `record-${records.length + 1}`,
          responseStatus: null,
          ...data
        };

        records.push(record);

        return Promise.resolve(record);
      }),
      update: jest.fn(({ where, data }) => {
        const record = records.find((entry) => entry.id === where.id);

        if (!record) {
          throw new Error("Record not found");
        }

        Object.assign(record, data);

        return Promise.resolve(record);
      })
    }
  } as unknown as PrismaService;
}

describe("IdempotencyService", () => {
  it("returns a cached response for the same key and same body hash", async () => {
    const bodyHash = hashRequest({ amount: 1000, currency: "USD" });
    const prisma = createPrismaMock([
      {
        id: "existing",
        scope: "payments",
        key: "idem-key",
        requestHash: bodyHash,
        status: "COMPLETED",
        responseStatus: HttpStatus.CREATED,
        responseBody: {
          id: "payment-1"
        }
      }
    ]);
    const service = new IdempotencyService(prisma);
    const handler = jest.fn();

    await expect(
      service.runOnce("payments", "idem-key", bodyHash, handler)
    ).resolves.toEqual({
      status: HttpStatus.CREATED,
      body: {
        id: "payment-1"
      },
      replayed: true
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("throws a 409 conflict for the same key with a different body hash", async () => {
    const prisma = createPrismaMock([
      {
        id: "existing",
        scope: "payments",
        key: "idem-key",
        requestHash: hashRequest({ amount: 1000 }),
        status: "COMPLETED",
        responseStatus: HttpStatus.OK,
        responseBody: {
          id: "payment-1"
        }
      }
    ]);
    const service = new IdempotencyService(prisma);

    await expectConflict(
      service.runOnce(
        "payments",
        "idem-key",
        hashRequest({ amount: 2000 }),
        jest.fn()
      ),
      "Idempotency-Key conflict"
    );
  });

  it("throws a 409 conflict while the same request is still in progress", async () => {
    const bodyHash = hashRequest({ amount: 1000 });
    const prisma = createPrismaMock([
      {
        id: "existing",
        scope: "payments",
        key: "idem-key",
        requestHash: bodyHash,
        status: "IN_PROGRESS"
      }
    ]);
    const service = new IdempotencyService(prisma);

    await expectConflict(
      service.runOnce("payments", "idem-key", bodyHash, jest.fn()),
      "Request still in progress"
    );
  });

  it("marks the record FAILED and rethrows when the handler fails", async () => {
    const prisma = createPrismaMock();
    const service = new IdempotencyService(prisma);
    const error = new Error("provider failed");

    await expect(
      service.runOnce("payments", "idem-key", hashRequest({ amount: 1000 }), async () => {
        throw error;
      })
    ).rejects.toThrow(error);

    expect(prisma.idempotencyRecord.update).toHaveBeenCalledWith({
      where: {
        id: "record-1"
      },
      data: {
        status: "FAILED"
      }
    });
  });
});

async function expectConflict(
  promise: Promise<unknown>,
  message: string
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(HttpException);
  await expect(promise).rejects.toMatchObject({
    message
  });

  try {
    await promise;
  } catch (error) {
    expect((error as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
  }
}
