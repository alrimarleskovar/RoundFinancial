/**
 * poolStore (app/src/lib/poolStore.ts) — the shared 2-RPC-call sync loop
 * under usePool / usePoolMembers.
 *
 * Pinned here: `groupMembersByPool`, the pure client-side group-by that
 * replaced 7 per-pool memcmp scans with ONE program-wide member scan. If
 * the grouping drops or misroutes a member, a wallet's cota silently
 * vanishes from /home (exactly the class of bug #627 fixed) — so the
 * grouping semantics get their own spec:
 *   1. members route to the pool whose PDA matches `member.pool`;
 *   2. members of untracked pools (other seeds on the shared program —
 *      the batched scan sees EVERYTHING) are dropped, not misfiled;
 *   3. every tracked pool key exists in the result (empty array, never
 *      undefined) — consumers index without guards;
 *   4. slotIndex order from the SDK scan is preserved per pool.
 *
 * The store's localStorage seeding is exercised via the same stub the
 * poolCache spec installs (module reads it lazily per call).
 */

import { strict as assert } from "node:assert";
import { Keypair, PublicKey } from "@solana/web3.js";

// localStorage stub BEFORE importing the module graph (poolStore imports
// poolCache, which reads globalThis.localStorage lazily per call).
const backing = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, v),
  removeItem: (k: string) => void backing.delete(k),
};

import type { RawMemberView } from "@roundfi/sdk";

import { DEVNET_POOLS, type DevnetPoolKey } from "../app/src/lib/devnet";
import { groupMembersByPool } from "../app/src/lib/poolStore";

const POOL_KEYS = Object.keys(DEVNET_POOLS) as DevnetPoolKey[];

function pdaMap(): Record<DevnetPoolKey, string> {
  return Object.fromEntries(POOL_KEYS.map((k) => [k, DEVNET_POOLS[k].pda.toBase58()])) as Record<
    DevnetPoolKey,
    string
  >;
}

// Minimal RawMemberView factory — only the fields the group-by touches
// (pool routing + slotIndex ordering) get real values.
function member(pool: PublicKey, slotIndex: number): RawMemberView {
  return {
    address: Keypair.generate().publicKey,
    pool,
    wallet: Keypair.generate().publicKey,
    nftAsset: Keypair.generate().publicKey,
    slotIndex,
    reputationLevel: 1,
    stakeBps: 5000,
    stakeDeposited: 1_000_000n,
    contributionsPaid: 0,
    totalContributed: 0n,
    totalReceived: 0n,
    escrowBalance: 0n,
    onTimeCount: 0,
    lateCount: 0,
    defaulted: false,
    paidOut: false,
    lastReleasedCheckpoint: 0,
    joinedAt: 0n,
    stakeDepositedInitial: 1_000_000n,
    totalEscrowDeposited: 0n,
    lastTransferredAt: 0n,
  };
}

describe("poolStore — program-wide member scan grouped by pool", () => {
  it("routes members to the tracked pool whose PDA matches member.pool", () => {
    const p7 = DEVNET_POOLS.pool7.pda;
    const p9 = DEVNET_POOLS.pool9.pda;
    const grouped = groupMembersByPool(
      [member(p9, 0), member(p7, 0), member(p9, 2), member(p7, 4)],
      pdaMap(),
    );
    assert.equal(grouped.pool7.length, 2);
    assert.equal(grouped.pool9.length, 2);
    assert.ok(grouped.pool7.every((m) => m.pool.equals(p7)));
    assert.ok(grouped.pool9.every((m) => m.pool.equals(p9)));
  });

  it("drops members of pools the app doesn't track (never misfiles them)", () => {
    const foreignPool = Keypair.generate().publicKey; // e.g. CLI pool seed 10
    const grouped = groupMembersByPool(
      [member(foreignPool, 0), member(foreignPool, 1), member(DEVNET_POOLS.pool8.pda, 3)],
      pdaMap(),
    );
    const total = POOL_KEYS.reduce((n, k) => n + grouped[k].length, 0);
    assert.equal(total, 1, "only the tracked pool8 member survives");
    assert.equal(grouped.pool8[0]!.slotIndex, 3);
  });

  it("every tracked pool key is present (empty array, never undefined)", () => {
    const grouped = groupMembersByPool([], pdaMap());
    for (const k of POOL_KEYS) {
      assert.ok(Array.isArray(grouped[k]), `expected an array for ${k}`);
      assert.equal(grouped[k].length, 0);
    }
  });

  it("preserves the scan's slotIndex order within each pool", () => {
    const p8 = DEVNET_POOLS.pool8.pda;
    const grouped = groupMembersByPool([member(p8, 0), member(p8, 2), member(p8, 5)], pdaMap());
    assert.deepEqual(
      grouped.pool8.map((m) => m.slotIndex),
      [0, 2, 5],
    );
  });
});
