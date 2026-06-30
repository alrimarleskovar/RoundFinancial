/**
 * Shared Prisma client for server-side consumers (ADR 0009 §3 — the admin
 * app reads the indexer's Postgres via the same client; the indexer
 * remains the DB owner). Exposed as `@roundfi/indexer/db`.
 *
 * Singleton on `globalThis` so Next.js dev hot-reload doesn't open a new
 * connection pool on every reload.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Build a PrismaClient wired to the node-postgres driver adapter.
 *
 * Prisma 7 is engine-less (the query path is a WASM compiler — there is no
 * Rust query-engine binary at runtime) and ships no built-in connector, so a
 * driver adapter is REQUIRED at runtime for PostgreSQL: a bare
 * `new PrismaClient()` still type-checks but throws on construction.
 * Centralized here so every entrypoint (server, backfill[-events],
 * reconciler, projector, seed) wires the same `DATABASE_URL` identically.
 */
export function makePrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — the indexer Prisma client needs a Postgres connection string.",
    );
  }
  return new PrismaClient({ adapter: new PrismaPg(connectionString) });
}

const globalForPrisma = globalThis as unknown as { __rfiIndexerPrisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  return (globalForPrisma.__rfiIndexerPrisma ??= makePrismaClient());
}

export type { PrismaClient } from "@prisma/client";
