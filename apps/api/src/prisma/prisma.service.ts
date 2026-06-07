import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@router/db";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      datasources: process.env.DIRECT_URL
        ? {
            db: {
              url: process.env.DIRECT_URL
            }
          }
        : undefined
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
