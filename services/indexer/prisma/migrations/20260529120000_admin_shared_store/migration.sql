-- CreateTable
CREATE TABLE "admin_challenges" (
    "token" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_challenges_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "admin_rate_limit_hits" (
    "id" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "hitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_rate_limit_hits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_challenges_expiresAt_idx" ON "admin_challenges"("expiresAt");

-- CreateIndex
CREATE INDEX "admin_rate_limit_hits_bucketKey_hitAt_idx" ON "admin_rate_limit_hits"("bucketKey", "hitAt");
