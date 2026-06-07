import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { Prisma } from "@router/db";
import { PrismaService } from "../prisma/prisma.service";

type HandlerResult<T> = {
  status: number;
  body: T;
};

type RunOnceResult<T> = HandlerResult<T> & {
  replayed: boolean;
};

type IdempotencyRecordStatus = "IN_PROGRESS" | "COMPLETED" | "FAILED";

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async runOnce<T>(
    scope: string,
    key: string,
    bodyHash: string,
    handler: () => Promise<HandlerResult<T>>
  ): Promise<RunOnceResult<T>> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_key: {
          scope,
          key
        }
      }
    });

    if (existing) {
      if (existing.requestHash !== bodyHash) {
        throw new HttpException(
          "Idempotency-Key conflict",
          HttpStatus.CONFLICT
        );
      }

      if (existing.status === "IN_PROGRESS") {
        throw new HttpException(
          "Request still in progress",
          HttpStatus.CONFLICT
        );
      }

      if (existing.status === "COMPLETED") {
        return {
          status: existing.responseStatus ?? HttpStatus.OK,
          body: existing.responseBody as T,
          replayed: true
        };
      }
    }

    const record =
      existing ??
      (await this.createInProgressRecord(scope, key, bodyHash));

    try {
      const result = await handler();

      await this.prisma.idempotencyRecord.update({
        where: {
          id: record.id
        },
        data: {
          status: "COMPLETED" satisfies IdempotencyRecordStatus,
          responseStatus: result.status,
          responseBody: result.body as Prisma.InputJsonValue
        }
      });

      return {
        ...result,
        replayed: false
      };
    } catch (error) {
      await this.prisma.idempotencyRecord.update({
        where: {
          id: record.id
        },
        data: {
          status: "FAILED" satisfies IdempotencyRecordStatus
        }
      });

      throw error;
    }
  }

  private async createInProgressRecord(
    scope: string,
    key: string,
    requestHash: string
  ) {
    try {
      return await this.prisma.idempotencyRecord.create({
        data: {
          scope,
          key,
          requestHash,
          status: "IN_PROGRESS" satisfies IdempotencyRecordStatus
        }
      });
    } catch (error) {
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: {
          scope_key: {
            scope,
            key
          }
        }
      });

      if (existing?.requestHash === requestHash) {
        throw new HttpException(
          "Request still in progress",
          HttpStatus.CONFLICT
        );
      }

      if (existing) {
        throw new HttpException(
          "Idempotency-Key conflict",
          HttpStatus.CONFLICT
        );
      }

      throw error;
    }
  }
}
