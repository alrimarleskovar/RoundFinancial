/**
 * Prisma 7 config.
 *
 * Prisma 7 no longer accepts the connection `url` inside schema.prisma — the
 * RUNTIME connection is supplied by the node-postgres driver adapter (see
 * src/db.ts `makePrismaClient`). The Prisma CLI's migration / introspection
 * commands (`prisma migrate`, `prisma db pull`) read the URL from here.
 *
 * `import "dotenv/config"` restores the `.env` auto-loading that Prisma <7 did
 * implicitly (v7 dropped it): it populates process.env from services/indexer/
 * .env so the CLI sees DATABASE_URL without a manual export. The URL is read
 * lazily via process.env — NOT @prisma/config's `env()` helper, which resolves
 * eagerly and throws when DATABASE_URL is unset, which would break the CI
 * postinstall `prisma generate` (run with no DATABASE_URL).
 */
import "dotenv/config";

import { defineConfig } from "@prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
