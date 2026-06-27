-- CreateTable
CREATE TABLE "email_sent_log" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_sent_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_sent_log_wallet_idx" ON "email_sent_log"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "email_sent_log_wallet_kind_dedupeKey_key" ON "email_sent_log"("wallet", "kind", "dedupeKey");
