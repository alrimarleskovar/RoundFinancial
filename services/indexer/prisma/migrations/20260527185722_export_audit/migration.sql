-- CreateTable
CREATE TABLE "export_audit" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_audit_createdAt_idx" ON "export_audit"("createdAt");

-- CreateIndex
CREATE INDEX "export_audit_actor_idx" ON "export_audit"("actor");
