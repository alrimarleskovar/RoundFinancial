/**
 * Fetch the set of active pools the crank should consider this tick —
 * Gap 5 of the canary audit.
 *
 * Mirrors `services/orchestrator/src/indexer.ts:listAllPools` (PR #N/A,
 * pre-canary): Anchor's typed `pool.all()` decoder (via
 * `client.programs.core.account.pool.all()`) is the right tool here —
 * it goes through `getProgramAccounts` under the hood but uses the
 * 8-byte discriminator filter from the IDL, so it's robust to field
 * reordering inside the Pool struct. A hardcoded `memcmp` with a
 * field-offset would silently desync after any struct edit.
 *
 * We deliberately do NOT import from `@roundfi/orchestrator` (would pull
 * in the demo runCycle harness + its prisma deps the crank doesn't need).
 *
 * We still warn loud when the call returns zero pools, because the
 * audit's worst-case scenario (offsets wrong, silent zero) can still
 * manifest in different ways — e.g. wrong program id from a stale env
 * var, RPC pointed at the wrong cluster. A 0-pool result is rarely
 * benign in production; surface it instead of silently sleeping.
 */

import type { PublicKey } from "@solana/web3.js";
import type { PoolView, RoundFiClient } from "@roundfi/sdk";
import { fetchPool } from "@roundfi/sdk";

import { logger } from "./logger.js";

export async function fetchActivePools(client: RoundFiClient): Promise<PoolView[]> {
  const pools = await listAllPools(client);
  const active = pools.filter((p) => p.status === "Active");

  if (active.length === 0) {
    logger.warn(
      {
        event_type: "pools.empty",
        totalPools: pools.length,
        statuses: pools.map((p) => p.status),
      },
      "No active pools — verify program id + RPC cluster point at the right deployment",
    );
  }

  return active;
}

/**
 * Enumerate every Pool account owned by the core program. Anchor's
 * typed account decoder handles discriminator + IDL deserialization;
 * we re-normalize each via the SDK's `fetchPool` so the returned
 * `PoolView` shape matches the rest of the crank's expectations.
 *
 * `client.programs.core.account.pool.all` is `any`-shaped in the
 * generated client surface — the cast mirrors what indexer.ts does and
 * keeps us insulated from anchor-ts's surface drift.
 */
async function listAllPools(client: RoundFiClient): Promise<PoolView[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = (await (client.programs.core.account as any).pool.all()) as Array<{
    publicKey: PublicKey;
  }>;
  const pools: PoolView[] = [];
  for (const entry of accounts) {
    const p = await fetchPool(client, entry.publicKey);
    if (p) pools.push(p);
  }
  return pools;
}
