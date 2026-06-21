-- DropForeignKey
ALTER TABLE "claim_events" DROP CONSTRAINT "claim_events_memberId_fkey";

-- DropForeignKey
ALTER TABLE "claim_events" DROP CONSTRAINT "claim_events_poolId_fkey";

-- DropForeignKey
ALTER TABLE "contribute_events" DROP CONSTRAINT "contribute_events_memberId_fkey";

-- DropForeignKey
ALTER TABLE "contribute_events" DROP CONSTRAINT "contribute_events_poolId_fkey";

-- DropForeignKey
ALTER TABLE "default_events" DROP CONSTRAINT "default_events_poolId_fkey";

-- AlterTable
ALTER TABLE "claim_events" ALTER COLUMN "poolId" DROP NOT NULL,
ALTER COLUMN "memberId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "contribute_events" ALTER COLUMN "poolId" DROP NOT NULL,
ALTER COLUMN "memberId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "default_events" ALTER COLUMN "poolId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "contribute_events" ADD CONSTRAINT "contribute_events_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribute_events" ADD CONSTRAINT "contribute_events_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "default_events" ADD CONSTRAINT "default_events_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
