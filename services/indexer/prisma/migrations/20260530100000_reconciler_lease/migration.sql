-- CreateTable
CREATE TABLE "reconciler_leases" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "holder" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "reconciler_leases_pkey" PRIMARY KEY ("id")
);

-- Bootstrap the singleton row. acquiredAt is set far in the past
-- (epoch + 1s) so the first reconciler tick on any instance wins the
-- lease immediately on startup, regardless of leaseTtlSecs.
INSERT INTO "reconciler_leases" ("id", "acquiredAt", "holder")
VALUES ('main', '1970-01-01 00:00:01'::timestamp, '')
ON CONFLICT ("id") DO NOTHING;
