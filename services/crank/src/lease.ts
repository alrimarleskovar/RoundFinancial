/**
 * Multi-instance lease — espelhando o padrão do
 * `services/indexer/src/reconciler.ts` (PR #431, Wave 9.2).
 *
 * Sob Railway o operador pode rodar 2+ réplicas (autoscale, blue-green
 * redeploy). Sem lease, os cranks competiriam pelo mesmo settle e
 * gastariam gas duplicado (pior: poderiam racear num replay já enviado
 * mas ainda não confirmado). O lease garante que UM crank-por-vez
 * processa cada tick: o vencedor renova `acquiredAt = now`, perdedores
 * pulam a tick e tentam de novo no próximo intervalo.
 *
 * Postgres é o coordenador (não Redis, não advisory locks): a tabela
 * `reconciler_lease` já existe no schema.prisma do indexer
 * (`@prisma/client` consome o mesmo DATABASE_URL). Reaproveitamos o
 * mesmo padrão de WHERE de update (`acquiredAt < cutoff`) — exatamente
 * um caller casa o WHERE e ganha o lease.
 *
 * IMPORTANTE: como o crank é opcional-multi-instância, o lease só é
 * exigido quando `CRANK_LEASE_ENABLED=true`. Em dev / single-instance
 * Railway o env var fica off e o loop roda sem checar nada. Isso evita
 * acoplamento forçado ao Postgres em ambientes simples.
 */

import { logger } from "./logger.js";

const LEASE_ID = "crank-main";
const LEASE_TTL_SECS = 90; // 1.5x do POLL_INTERVAL_MS padrão (60s)

function holderId(): string {
  const host = process.env.HOSTNAME ?? "unknown-host";
  return `crank/${host}:${process.pid}`;
}

export interface LeaseClient {
  /** Try to acquire / renew the lease. Returns true if THIS process holds it now. */
  tryAcquire(): Promise<boolean>;
  /** Optional: release the lease on graceful shutdown (best-effort). */
  release(): Promise<void>;
}

/**
 * Lease backed by the Prisma `reconciler_lease` row used by the indexer
 * — same WHERE/SET pattern, just a different row id (`crank-main`).
 *
 * Wired lazily so the crank doesn't pull in @prisma/client at import
 * time — useful for the lease-disabled path (dev / single replica).
 */
export async function createPostgresLease(): Promise<LeaseClient> {
  // Late import: avoids prisma generate friction in environments that
  // never enable the lease.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const holder = holderId();

  return {
    async tryAcquire(): Promise<boolean> {
      const now = new Date();
      const cutoff = new Date(now.getTime() - LEASE_TTL_SECS * 1000);

      // First, try to renew (we already hold it) — only matches if WE
      // are the current holder regardless of TTL.
      const renew = await prisma.reconcilerLease.updateMany({
        where: { id: LEASE_ID, holder },
        data: { acquiredAt: now },
      });
      if (renew.count === 1) return true;

      // Otherwise try to grab a stale lease.
      const grab = await prisma.reconcilerLease.updateMany({
        where: { id: LEASE_ID, acquiredAt: { lt: cutoff } },
        data: { acquiredAt: now, holder },
      });
      if (grab.count === 1) {
        logger.info({ event_type: "lease.acquired", holder }, "Crank lease acquired");
        return true;
      }

      // Bootstrap: row doesn't exist yet. Insert with our holder; if
      // another instance raced us, the unique constraint on id rejects
      // and we yield this tick.
      try {
        await prisma.reconcilerLease.create({
          data: { id: LEASE_ID, acquiredAt: now, holder },
        });
        logger.info({ event_type: "lease.bootstrapped", holder }, "Crank lease bootstrapped");
        return true;
      } catch {
        return false; // someone else inserted it first this tick
      }
    },

    async release(): Promise<void> {
      try {
        await prisma.reconcilerLease.updateMany({
          where: { id: LEASE_ID, holder },
          // Set acquiredAt far in the past so next caller's cutoff check
          // sees a stale lease immediately. Avoids deleting the row
          // (keeps audit trail of last holder).
          data: { acquiredAt: new Date(0) },
        });
        logger.info({ event_type: "lease.released", holder }, "Crank lease released (shutdown)");
      } catch (err) {
        // Best-effort: don't crash shutdown if the DB is down.
        logger.warn(
          {
            event_type: "lease.release_failed",
            holder,
            error: err instanceof Error ? err.message : String(err),
          },
          "Lease release failed during shutdown",
        );
      } finally {
        await prisma.$disconnect().catch(() => {});
      }
    },
  };
}

/** No-op lease for single-instance deployments. Always wins. */
export const noopLease: LeaseClient = {
  tryAcquire: async () => true,
  release: async () => {},
};
