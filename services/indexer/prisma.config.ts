/**
 * Prisma 7 config.
 *
 * Prisma 7 no longer accepts the connection `url` inside schema.prisma. The
 * RUNTIME connection is supplied by the node-postgres driver adapter (see
 * src/db.ts `makePrismaClient`). The Prisma CLI's migration / introspection
 * commands (`prisma migrate`, `prisma db pull`) read the URL from here
 * instead — `env()` resolves it at config-load time and throws a clear error
 * if DATABASE_URL is unset.
 *
 * Note: Prisma 7 no longer auto-loads `.env` for the CLI, so export
 * DATABASE_URL (or source your env file) before running `prisma migrate` /
 * `prisma db pull`.
 */
import { defineConfig } from "@prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Read lazily from the environment. NOT @prisma/config's `env()` helper —
    // that resolves eagerly at config-load and throws when DATABASE_URL is
    // unset, which would break `prisma generate` (CI runs it in postinstall
    // with no DATABASE_URL). Only the migration/introspection CLI actually
    // consumes this; the runtime client gets its connection from the pg
    // adapter in src/db.ts. Export DATABASE_URL before `prisma migrate`.
    url: process.env.DATABASE_URL,
  },
});
