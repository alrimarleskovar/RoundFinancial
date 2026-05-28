-- CreateEnum
CREATE TYPE "PoolStatus" AS ENUM ('Forming', 'Active', 'Completed', 'Liquidated', 'Closed');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('Contribute', 'Claim', 'Default');

-- CreateEnum
CREATE TYPE "DefaultReason" AS ENUM ('SolvencyGuardTriggered', 'MissedDeadline', 'InsufficientStake', 'EscapeValveLeavingDefault', 'Other');

-- CreateEnum
CREATE TYPE "DefaultReasonProvenance" AS ENUM ('Inferred');

-- CreateTable
CREATE TABLE "pools" (
    "id" TEXT NOT NULL,
    "pda" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "seedId" BIGINT NOT NULL,
    "usdcMint" TEXT NOT NULL,
    "yieldAdapter" TEXT NOT NULL,
    "membersTarget" INTEGER NOT NULL,
    "installmentAmount" BIGINT NOT NULL,
    "creditAmount" BIGINT NOT NULL,
    "cyclesTotal" INTEGER NOT NULL,
    "cycleDurationSec" BIGINT NOT NULL,
    "seedDrawBps" INTEGER NOT NULL,
    "solidarityBps" INTEGER NOT NULL,
    "escrowReleaseBps" INTEGER NOT NULL,
    "membersJoined" INTEGER NOT NULL,
    "status" "PoolStatus" NOT NULL,
    "startedAt" BIGINT,
    "currentCycle" INTEGER NOT NULL,
    "nextCycleAt" BIGINT,
    "totalContributed" BIGINT NOT NULL,
    "totalPaidOut" BIGINT NOT NULL,
    "solidarityBalance" BIGINT NOT NULL,
    "escrowBalance" BIGINT NOT NULL,
    "yieldAccrued" BIGINT NOT NULL,
    "guaranteeFundBalance" BIGINT NOT NULL,
    "totalProtocolFeeAccrued" BIGINT NOT NULL,
    "yieldPrincipalDeposited" BIGINT NOT NULL,
    "defaultedMembers" INTEGER NOT NULL,
    "slotsBitmapHex" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "pda" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "nftAsset" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "reputationLevel" INTEGER NOT NULL,
    "stakeBps" INTEGER NOT NULL,
    "stakeDeposited" BIGINT NOT NULL,
    "contributionsPaid" INTEGER NOT NULL,
    "totalContributed" BIGINT NOT NULL,
    "totalReceived" BIGINT NOT NULL,
    "escrowBalance" BIGINT NOT NULL,
    "onTimeCount" INTEGER NOT NULL,
    "lateCount" INTEGER NOT NULL,
    "defaulted" BOOLEAN NOT NULL,
    "paidOut" BOOLEAN NOT NULL,
    "lastReleasedCheckpoint" INTEGER NOT NULL,
    "joinedAt" BIGINT NOT NULL,
    "stakeDepositedInitial" BIGINT NOT NULL,
    "totalEscrowDeposited" BIGINT NOT NULL,
    "lastTransferredAt" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attestations" (
    "id" TEXT NOT NULL,
    "pda" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "schemaId" INTEGER NOT NULL,
    "nonce" BIGINT NOT NULL,
    "memberId" TEXT,
    "payload" TEXT,
    "mintedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txSignature" TEXT NOT NULL,

    CONSTRAINT "attestations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribute_events" (
    "id" TEXT NOT NULL,
    "txSignature" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "contributorWallet" TEXT,
    "cycle" INTEGER NOT NULL,
    "schemaId" INTEGER NOT NULL,
    "installment" BIGINT NOT NULL,
    "solidarityAmt" BIGINT NOT NULL,
    "escrowAmt" BIGINT NOT NULL,
    "poolFloatAmt" BIGINT NOT NULL,
    "slotIndex" INTEGER NOT NULL DEFAULT 0,
    "onTime" BOOLEAN NOT NULL,
    "blockTime" BIGINT NOT NULL,
    "slot" BIGINT NOT NULL,
    "orphaned" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "contribute_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_events" (
    "id" TEXT NOT NULL,
    "txSignature" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "recipientWallet" TEXT,
    "cycle" INTEGER NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "amountPaid" BIGINT NOT NULL,
    "blockTime" BIGINT NOT NULL,
    "slot" BIGINT NOT NULL,
    "orphaned" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "claim_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "default_events" (
    "id" TEXT NOT NULL,
    "txSignature" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "defaultedWallet" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "seizedSolidarity" BIGINT NOT NULL,
    "seizedEscrow" BIGINT NOT NULL,
    "seizedStake" BIGINT NOT NULL,
    "dInit" BIGINT NOT NULL,
    "dRem" BIGINT NOT NULL,
    "cInit" BIGINT NOT NULL,
    "cAfter" BIGINT NOT NULL,
    "blockTime" BIGINT NOT NULL,
    "slot" BIGINT NOT NULL,
    "orphaned" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "default_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indexer_cursors" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "lastSlot" BIGINT NOT NULL,
    "lastSig" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexer_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backfill_runs" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "poolsTouched" INTEGER NOT NULL DEFAULT 0,
    "membersTouched" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "backfill_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "txSig" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "subjectWallet" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "poolPda" TEXT NOT NULL,
    "memberId" TEXT,
    "cycle" INTEGER NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "slotNumber" BIGINT NOT NULL,
    "onChainTs" BIGINT NOT NULL,
    "dueTs" BIGINT,
    "deltaSeconds" INTEGER,
    "graceUsed" BOOLEAN NOT NULL DEFAULT false,
    "defaultReason" "DefaultReason",
    "defaultReasonProvenance" "DefaultReasonProvenance",
    "details" JSONB NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pools_pda_key" ON "pools"("pda");

-- CreateIndex
CREATE INDEX "pools_authority_idx" ON "pools"("authority");

-- CreateIndex
CREATE UNIQUE INDEX "members_pda_key" ON "members"("pda");

-- CreateIndex
CREATE INDEX "members_wallet_idx" ON "members"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "members_poolId_slotIndex_key" ON "members"("poolId", "slotIndex");

-- CreateIndex
CREATE UNIQUE INDEX "attestations_pda_key" ON "attestations"("pda");

-- CreateIndex
CREATE INDEX "attestations_subject_schemaId_idx" ON "attestations"("subject", "schemaId");

-- CreateIndex
CREATE UNIQUE INDEX "contribute_events_txSignature_key" ON "contribute_events"("txSignature");

-- CreateIndex
CREATE INDEX "contribute_events_poolId_cycle_idx" ON "contribute_events"("poolId", "cycle");

-- CreateIndex
CREATE INDEX "contribute_events_orphaned_slot_idx" ON "contribute_events"("orphaned", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "claim_events_txSignature_key" ON "claim_events"("txSignature");

-- CreateIndex
CREATE INDEX "claim_events_poolId_cycle_idx" ON "claim_events"("poolId", "cycle");

-- CreateIndex
CREATE INDEX "claim_events_orphaned_slot_idx" ON "claim_events"("orphaned", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "default_events_txSignature_key" ON "default_events"("txSignature");

-- CreateIndex
CREATE INDEX "default_events_poolId_slotIndex_idx" ON "default_events"("poolId", "slotIndex");

-- CreateIndex
CREATE INDEX "default_events_orphaned_slot_idx" ON "default_events"("orphaned", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "indexer_cursors_programId_key" ON "indexer_cursors"("programId");

-- CreateIndex
CREATE INDEX "backfill_runs_startedAt_idx" ON "backfill_runs"("startedAt");

-- CreateIndex
CREATE INDEX "backfill_runs_programId_startedAt_idx" ON "backfill_runs"("programId", "startedAt");

-- CreateIndex
CREATE INDEX "events_poolId_cycle_idx" ON "events"("poolId", "cycle");

-- CreateIndex
CREATE INDEX "events_subjectWallet_idx" ON "events"("subjectWallet");

-- CreateIndex
CREATE INDEX "events_eventType_idx" ON "events"("eventType");

-- CreateIndex
CREATE INDEX "events_slotNumber_idx" ON "events"("slotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "events_txSig_eventType_key" ON "events"("txSig", "eventType");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribute_events" ADD CONSTRAINT "contribute_events_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribute_events" ADD CONSTRAINT "contribute_events_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "default_events" ADD CONSTRAINT "default_events_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
