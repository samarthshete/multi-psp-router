import { IsInt, IsObject, IsOptional, Min } from "class-validator";

export class CapturePaymentDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
