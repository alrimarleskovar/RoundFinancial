-- CreateTable
CREATE TABLE "email_subscriptions" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "optedIn" BOOLEAN NOT NULL DEFAULT true,
    "lastToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_subscriptions_wallet_key" ON "email_subscriptions"("wallet");

-- CreateIndex
CREATE INDEX "email_subscriptions_email_idx" ON "email_subscriptions"("email");
