import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min
} from "class-validator";

export class CreateAuthHoldDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsString()
  currency!: string;

  @IsString()
  paymentMethodId!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsIn(["STRIPE", "ADYEN"])
  providerOverride?: "STRIPE" | "ADYEN";

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
