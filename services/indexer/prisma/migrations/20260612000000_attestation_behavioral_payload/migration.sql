-- Reputation v5.2 Hybrid (Phase C.2b): structured BehavioralPayload
-- columns on the attestations table. All nullable / defaulted so the
-- migration is non-destructive on an existing store — rows ingested
-- before v5.2 keep payload = NULL and decode to classification
-- "unspecified" (payloadVersion NULL) when the backfill re-reads them.

-- AlterTable
ALTER TABLE "attestations" ADD COLUMN "payloadVersion" INTEGER;
ALTER TABLE "attestations" ADD COLUMN "classification" TEXT;
ALTER TABLE "attestations" ADD COLUMN "cycle" INTEGER;
ALTER TABLE "attestations" ADD COLUMN "slotIndex" INTEGER;
ALTER TABLE "attestations" ADD COLUMN "groupSize" INTEGER;
ALTER TABLE "attestations" ADD COLUMN "parcelsPaid" INTEGER;
ALTER TABLE "attestations" ADD COLUMN "deltaSeconds" BIGINT;
ALTER TABLE "attestations" ADD COLUMN "amount" BIGINT;
ALTER TABLE "attestations" ADD COLUMN "issuedAt" BIGINT;
ALTER TABLE "attestations" ADD COLUMN "revoked" BOOLEAN NOT NULL DEFAULT false;

-- The account-scan backfill (getProgramAccounts) does not know the tx
-- that created each PDA, so txSignature becomes nullable. No existing
-- rows are written to this table yet, so this is a no-op on data.
ALTER TABLE "attestations" ALTER COLUMN "txSignature" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "attestations_subject_classification_idx" ON "attestations" ("subject", "classification");

-- AlterTable: record the attestation pass in the backfill-run health row.
ALTER TABLE "backfill_runs" ADD COLUMN "attestationsTouched" INTEGER NOT NULL DEFAULT 0;
