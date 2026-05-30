/**
 * Shared Prisma client for server-side consumers (ADR 0009 §3 — the admin
 * app reads the indexer's Postgres via the same client; the indexer
 * remains the DB owner). Exposed as `@roundfi/indexer/db`.
 *
 * Singleton on `globalThis` so Next.js dev hot-reload doesn't open a new
 * connection pool on every reload.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __rfiIndexerPrisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  return (globalForPrisma.__rfiIndexerPrisma ??= new PrismaClient());
}

export type { PrismaClient } from "@prisma/client";
