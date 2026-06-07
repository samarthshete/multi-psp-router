-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('STRIPE', 'ADYEN');

-- CreateEnum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('CREATED', 'AUTH_PENDING', 'AUTHORIZED', 'CAPTURE_PENDING', 'CAPTURED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('REQUESTED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('SETUP_PENDING', 'ACTIVE', 'RENEWAL_PENDING', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "SubscriptionChargeStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SubscriptionChargeKind" AS ENUM ('CIT', 'MIT');

-- CreateEnum
CREATE TYPE "NormalizedEventType" AS ENUM ('PAYMENT_AUTHORIZED', 'PAYMENT_CAPTURED', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'PAYMENT_CAPTURE_FAILED', 'TOKEN_CREATED', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_PAYMENT_FAILED', 'DISPUTE_OPENED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "stripeCustomerId" TEXT,
    "adyenShopperReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethodToken" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "tokenId" TEXT NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentMethodToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "provider" "Provider" NOT NULL,
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'CREATED',
    "externalRef" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "paymentOrderId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "provider" "Provider" NOT NULL,
    "externalRef" TEXT,
    "status" "PaymentOrderStatus" NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capture" (
    "id" TEXT NOT NULL,
    "paymentOrderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "CaptureStatus" NOT NULL DEFAULT 'REQUESTED',
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Capture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentMethodTokenId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'SETUP_PENDING',
    "cadence" TEXT NOT NULL DEFAULT 'monthly',
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionCharge" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "kind" "SubscriptionChargeKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "SubscriptionChargeStatus" NOT NULL DEFAULT 'PENDING',
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PspOperation" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "internalEntityType" TEXT NOT NULL,
    "internalEntityId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseRef" TEXT,
    "responseBody" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PspOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "RawWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalizedPaymentEvent" (
    "id" TEXT NOT NULL,
    "rawWebhookId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "type" "NormalizedEventType" NOT NULL,
    "paymentOrderId" TEXT,
    "subscriptionId" TEXT,
    "subscriptionChargeId" TEXT,
    "externalRef" TEXT,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NormalizedPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "responseBody" JSONB,
    "responseStatus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingDecision" (
    "id" TEXT NOT NULL,
    "paymentOrderId" TEXT NOT NULL,
    "chosenProvider" "Provider" NOT NULL,
    "reason" TEXT NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_stripeCustomerId_key" ON "Customer"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_adyenShopperReference_key" ON "Customer"("adyenShopperReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethodToken_provider_tokenId_key" ON "PaymentMethodToken"("provider", "tokenId");

-- CreateIndex
CREATE INDEX "PaymentOrder_status_idx" ON "PaymentOrder"("status");

-- CreateIndex
CREATE INDEX "PaymentOrder_externalRef_idx" ON "PaymentOrder"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_paymentOrderId_attemptNumber_key" ON "PaymentAttempt"("paymentOrderId", "attemptNumber");

-- CreateIndex
CREATE INDEX "SubscriptionCharge_subscriptionId_status_idx" ON "SubscriptionCharge"("subscriptionId", "status");

-- CreateIndex
CREATE INDEX "PspOperation_internalEntityType_internalEntityId_idx" ON "PspOperation"("internalEntityType", "internalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "PspOperation_provider_idempotencyKey_key" ON "PspOperation"("provider", "idempotencyKey");

-- CreateIndex
CREATE INDEX "RawWebhookEvent_processed_receivedAt_idx" ON "RawWebhookEvent"("processed", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawWebhookEvent_provider_dedupeKey_key" ON "RawWebhookEvent"("provider", "dedupeKey");

-- CreateIndex
CREATE INDEX "NormalizedPaymentEvent_paymentOrderId_idx" ON "NormalizedPaymentEvent"("paymentOrderId");

-- CreateIndex
CREATE INDEX "NormalizedPaymentEvent_subscriptionId_idx" ON "NormalizedPaymentEvent"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "NormalizedPaymentEvent_rawWebhookId_type_key" ON "NormalizedPaymentEvent"("rawWebhookId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingDecision_paymentOrderId_key" ON "RoutingDecision"("paymentOrderId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "PaymentMethodToken" ADD CONSTRAINT "PaymentMethodToken_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paymentOrderId_fkey" FOREIGN KEY ("paymentOrderId") REFERENCES "PaymentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capture" ADD CONSTRAINT "Capture_paymentOrderId_fkey" FOREIGN KEY ("paymentOrderId") REFERENCES "PaymentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_paymentMethodTokenId_fkey" FOREIGN KEY ("paymentMethodTokenId") REFERENCES "PaymentMethodToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCharge" ADD CONSTRAINT "SubscriptionCharge_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedPaymentEvent" ADD CONSTRAINT "NormalizedPaymentEvent_rawWebhookId_fkey" FOREIGN KEY ("rawWebhookId") REFERENCES "RawWebhookEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedPaymentEvent" ADD CONSTRAINT "NormalizedPaymentEvent_paymentOrderId_fkey" FOREIGN KEY ("paymentOrderId") REFERENCES "PaymentOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingDecision" ADD CONSTRAINT "RoutingDecision_paymentOrderId_fkey" FOREIGN KEY ("paymentOrderId") REFERENCES "PaymentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
