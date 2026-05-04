/**
 * Pure-read indexer helpers.
 *
 * Design constraints (Step 6c):
 *   - no database, no cache, no write-ahead log,
 *   - no websocket subscriptions — polling only,
 *   - every snapshot is built top-down from on-chain accounts using
 *     the SDK's `@roundfi/sdk/reads` primitives,
 *   - one call returns *everything* the frontend needs to render a
 *     pool view (or the whole protocol) — no follow-up round trips.
 *
 * The aggregate types below are the frontend's canonical input shape;
 * the Next.js app reads them and maps them to UI state without any
 * further transformation.
 */

import { PublicKey } from "@solana/web3.js";

import {
  computePoolHealth,
  fetchProtocolConfig,
  fetchTokenBalance,
  listPoolMembers,
  memberStatus,
  poolVaults,
  fetchPool,
} from "@roundfi/sdk";
import type {
  MemberLifecycleStatus,
  MemberView,
  PoolHealth,
  PoolView,
  ProtocolConfigView,
  RoundFiClient,
} from "@roundfi/sdk";

// ─── Snapshot types ──────────────────────────────────────────────────

export interface VaultBalance {
  address: PublicKey;
  balance: bigint;
}

export interface PoolSnapshotVaults {
  poolUsdcVault: VaultBalance;
  escrowVault: VaultBalance;
  solidarityVault: VaultBalance;
  yieldVault: VaultBalance;
}

export interface MemberSummary {
  address: PublicKey;
  wallet: PublicKey;
  slotIndex: number;
  reputationLevel: number;
  status: MemberLifecycleStatus;
  contributionsPaid: number;
  totalContributed: bigint;
  totalReceived: bigint;
  stakeDeposited: bigint;
  escrowBalance: bigint;
  defaulted: boolean;
  paidOut: boolean;
}

export interface PoolComputed {
  poolHealth: PoolHealth;
  currentCycle: number;
  totalCycles: number;
  remainingCycles: number;
  /** Sum of all four vault balances — the pool's total on-chain value. */
  totalValue: bigint;
  defaultsCount: number;
  paidOutCount: number;
  /** Slot indices that still have to claim their payout. */
  pendingPayouts: number[];
}

export interface PoolSnapshot {
  pool: PoolView;
  members: MemberSummary[];
  vaults: PoolSnapshotVaults;
  computed: PoolComputed;
  /** Snapshot epoch-ms — set by the indexer, not on-chain. */
  at: number;
}

export interface ProtocolStats {
  totalPools: number;
  formingPools: number;
  activePools: number;
  completedPools: number;
  liquidatedPools: number;
  totalMembers: number;
  totalValueLocked: bigint;
  totalContributed: bigint;
  totalPaidOut: bigint;
  totalDefaults: number;
}

export interface ProtocolSnapshot {
  config: ProtocolConfigView | null;
  pools: PoolSnapshot[];
  stats: ProtocolStats;
  at: number;
}

// ─── Internals ───────────────────────────────────────────────────────

function memberToSummary(m: MemberView, status: MemberLifecycleStatus): MemberSummary {
  return {
    address: m.address,
    wallet: m.wallet,
    slotIndex: m.slotIndex,
    reputationLevel: m.reputationLevel,
    status,
    contributionsPaid: m.contributionsPaid,
    totalContributed: m.totalContributed,
    totalReceived: m.totalReceived,
    stakeDeposited: m.stakeDeposited,
    escrowBalance: m.escrowBalance,
    defaulted: m.defaulted,
    paidOut: m.paidOut,
  };
}

function computePendingPayouts(members: MemberView[]): number[] {
  return members
    .filter((m) => !m.paidOut && !m.defaulted)
    .map((m) => m.slotIndex)
    .sort((a, b) => a - b);
}

// ─── getPoolSnapshot ─────────────────────────────────────────────────

/**
 * One-shot aggregate for a single pool. Returns `null` if the pool
 * account doesn't exist (e.g. wrong address, closed in a hypothetical
 * future where we reclaim rent).
 *
 * Does NOT throw on partial failure — member fetches are server-side
 * filtered and should always succeed if the pool does; vault balances
 * default to 0n if the ATA hasn't been initialized yet.
 */
export async function getPoolSnapshot(
  client: RoundFiClient,
  poolAddress: PublicKey,
): Promise<PoolSnapshot | null> {
  const pool = await fetchPool(client, poolAddress);
  if (!pool) return null;

  const [rawMembers, vaultAtas] = await Promise.all([
    listPoolMembers(client, poolAddress),
    Promise.resolve(poolVaults(client, poolAddress, pool.usdcMint)),
  ]);

  const members = [...rawMembers]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((m) => memberToSummary(m, memberStatus(m, pool)));

  const [poolUsdcBal, escrowBal, solidarityBal, yieldBal] = await Promise.all([
    fetchTokenBalance(client, vaultAtas.poolUsdcVault),
    fetchTokenBalance(client, vaultAtas.escrowVault),
    fetchTokenBalance(client, vaultAtas.solidarityVault),
    fetchTokenBalance(client, vaultAtas.yieldVault),
  ]);

  const vaults: PoolSnapshotVaults = {
    poolUsdcVault: { address: vaultAtas.poolUsdcVault, balance: poolUsdcBal },
    escrowVault: { address: vaultAtas.escrowVault, balance: escrowBal },
    solidarityVault: { address: vaultAtas.solidarityVault, balance: solidarityBal },
    yieldVault: { address: vaultAtas.yieldVault, balance: yieldBal },
  };

  const totalValue = poolUsdcBal + escrowBal + solidarityBal + yieldBal;

  const computed: PoolComputed = {
    poolHealth: computePoolHealth(pool),
    currentCycle: pool.currentCycle,
    totalCycles: pool.cyclesTotal,
    remainingCycles: Math.max(pool.cyclesTotal - pool.currentCycle, 0),
    totalValue,
    defaultsCount: pool.defaultedMembers,
    paidOutCount: members.filter((m) => m.paidOut).length,
    pendingPayouts: computePendingPayouts(rawMembers),
  };

  return { pool, members, vaults, computed, at: Date.now() };
}

// ─── listAllPools + getProtocolSnapshot ──────────────────────────────

/**
 * Enumerate every Pool account owned by the core program. Uses Anchor's
 * `pool.all()` (getProgramAccounts under the hood). Safe for the demo
 * because we expect a handful of pools at most; a real deployment
 * would want a pagination/filter strategy.
 */
export async function listAllPools(client: RoundFiClient): Promise<PoolView[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = await (client.programs.core.account as any).pool.all();
  const pools: PoolView[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const entry of accounts as any[]) {
    const pk = entry.publicKey as PublicKey;
    const p = await fetchPool(client, pk); // re-normalize via reads.ts
    if (p) pools.push(p);
  }
  return pools.sort((a, b) => {
    // Stable-sort: newest (highest startedAt) first, fallback by address.
    if (a.startedAt !== b.startedAt) return Number(b.startedAt - a.startedAt);
    return a.address.toBase58().localeCompare(b.address.toBase58());
  });
}

/**
 * One-shot protocol-wide aggregate. Fetches the protocol config, every
 * pool, and each pool's snapshot (members + vault balances) in a single
 * call. No caching — each invocation hits RPC.
 */
export async function getProtocolSnapshot(client: RoundFiClient): Promise<ProtocolSnapshot> {
  const [config, pools] = await Promise.all([fetchProtocolConfig(client), listAllPools(client)]);

  const snapshots = await Promise.all(pools.map((p) => getPoolSnapshot(client, p.address)));
  const poolSnapshots = snapshots.filter((s): s is PoolSnapshot => s !== null);

  const stats: ProtocolStats = {
    totalPools: poolSnapshots.length,
    formingPools: poolSnapshots.filter((s) => s.pool.status === "Forming").length,
    activePools: poolSnapshots.filter((s) => s.pool.status === "Active").length,
    completedPools: poolSnapshots.filter((s) => s.pool.status === "Completed").length,
    liquidatedPools: poolSnapshots.filter((s) => s.pool.status === "Liquidated").length,
    totalMembers: poolSnapshots.reduce((n, s) => n + s.members.length, 0),
    totalValueLocked: poolSnapshots.reduce((n, s) => n + s.computed.totalValue, 0n),
    totalContributed: poolSnapshots.reduce((n, s) => n + s.pool.totalContributed, 0n),
    totalPaidOut: poolSnapshots.reduce((n, s) => n + s.pool.totalPaidOut, 0n),
    totalDefaults: poolSnapshots.reduce((n, s) => n + s.computed.defaultsCount, 0),
  };

  return { config, pools: poolSnapshots, stats, at: Date.now() };
}

// ─── Polling subscriptions ───────────────────────────────────────────

export interface SubscribePoolSnapshotOptions {
  /** Polling interval in milliseconds. Defaults to 5000 (5s). */
  intervalMs?: number;
  /** Called on every successful poll. */
  onSnapshot: (snapshot: PoolSnapshot) => void;
  /** Called if a poll fails. The subscription continues on the next tick. */
  onError?: (err: unknown) => void;
  /**
   * If true (default), fires one snapshot immediately before starting
   * the interval. Set false to defer the first poll by `intervalMs`.
   */
  immediate?: boolean;
}

export interface SubscribeProtocolSnapshotOptions {
  intervalMs?: number;
  onSnapshot: (snapshot: ProtocolSnapshot) => void;
  onError?: (err: unknown) => void;
  immediate?: boolean;
}

/** Return type of all `subscribe*` helpers — call it to stop polling. */
export type Unsubscribe = () => void;

/**
 * Poll `getPoolSnapshot(client, pool)` on an interval. Caller receives
 * an unsubscribe function — invoking it clears the interval AND prevents
 * any in-flight `Promise` from reporting back (avoids "setState on
 * unmounted component" in React).
 *
 * Overlapping polls are suppressed: if a previous fetch is still in
 * flight when the next tick fires, the tick is skipped.
 */
export function subscribePoolSnapshot(
  client: RoundFiClient,
  poolAddress: PublicKey,
  opts: SubscribePoolSnapshotOptions,
): Unsubscribe {
  const interval = Math.max(opts.intervalMs ?? 5_000, 250);
  let stopped = false;
  let inflight = false;

  const runOnce = async (): Promise<void> => {
    if (stopped || inflight) return;
    inflight = true;
    try {
      const snap = await getPoolSnapshot(client, poolAddress);
      if (stopped) return;
      if (snap) opts.onSnapshot(snap);
    } catch (err) {
      if (stopped) return;
      opts.onError?.(err);
    } finally {
      inflight = false;
    }
  };

  if (opts.immediate !== false) {
    // Fire immediately, but don't await — the returned unsubscribe
    // should always resolve synchronously.
    void runOnce();
  }

  const handle: ReturnType<typeof setInterval> = setInterval(() => {
    void runOnce();
  }, interval);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}

/** Polling subscription variant for the whole-protocol snapshot. */
export function subscribeProtocolSnapshot(
  client: RoundFiClient,
  opts: SubscribeProtocolSnapshotOptions,
): Unsubscribe {
  const interval = Math.max(opts.intervalMs ?? 5_000, 250);
  let stopped = false;
  let inflight = false;

  const runOnce = async (): Promise<void> => {
    if (stopped || inflight) return;
    inflight = true;
    try {
      const snap = await getProtocolSnapshot(client);
      if (stopped) return;
      opts.onSnapshot(snap);
    } catch (err) {
      if (stopped) return;
      opts.onError?.(err);
    } finally {
      inflight = false;
    }
  };

  if (opts.immediate !== false) {
    void runOnce();
  }

  const handle: ReturnType<typeof setInterval> = setInterval(() => {
    void runOnce();
  }, interval);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
