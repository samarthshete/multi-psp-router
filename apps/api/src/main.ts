import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json, raw, type NextFunction, type Request, type Response } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    rawBody: true
  });
  const corsOrigin = process.env.CORS_ORIGIN;

  app.use(
    ["/webhooks/stripe", "/webhooks/adyen"],
    raw({
      type: "*/*"
    }),
    (request: Request, _response: Response, next: NextFunction) => {
      const rawBody = Buffer.isBuffer(request.body)
        ? request.body
        : Buffer.from("");
      (request as typeof request & { rawBody?: Buffer }).rawBody = rawBody;

      try {
        request.body = rawBody.length
          ? JSON.parse(rawBody.toString("utf8"))
          : {};
      } catch {
        request.body = {};
      }

      next();
    }
  );
  app.use(json());

  app.useGlobalPipes(
    new ValidationPipe({
      forbidUnknownValues: false,
      transform: true,
      whitelist: true
    })
  );

  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(",").map((origin) => origin.trim()) : false
  });

  await app.listen(process.env.PORT ?? 3000, process.env.HOST ?? "0.0.0.0");
}

void bootstrap();
