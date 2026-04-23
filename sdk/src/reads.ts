/**
 * Read helpers — pure, stateless accessors over on-chain state.
 *
 * Raw `program.account.<name>.fetch(...)` calls return objects with
 * BN instances (u64 / i64) and PublicKey values. This module:
 *
 *   - wraps those fetches in typed functions that return `*View`
 *     objects using native bigint + JS number + enum strings, so the
 *     UI never has to import BN or switch on u8 enums,
 *   - adds derived helpers (`memberStatus`, `computePoolHealth`) that
 *     encode the business rules the frontend would otherwise have to
 *     re-derive,
 *   - exposes a plain `listPoolMembers` that uses Anchor's built-in
 *     memcmp filter against the Member.pool field — no custom indexer
 *     required for a single-pool view.
 *
 * All functions are stateless and side-effect-free; callers compose
 * them as they please.
 */

import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import { POOL_STATUS, STAKE_BPS_BY_LEVEL } from "./constants.js";
import {
  escrowVaultAuthorityPda,
  memberPda,
  protocolConfigPda,
  solidarityVaultAuthorityPda,
  yieldVaultAuthorityPda,
} from "./pda.js";
import type { RoundFiClient } from "./client.js";

// ─── Normalization helpers ───────────────────────────────────────────

function bn(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  // Anchor's u64/i64 deserializers return BN (or BN-like) objects.
  // `instanceof BN` is unreliable across resolution paths, so we just
  // coerce via String() — BN.toString() returns the decimal digits.
  if (v !== null && typeof v === "object") {
    const asObj = v as { toString?: () => string };
    if (typeof asObj.toString === "function") {
      return BigInt(asObj.toString());
    }
  }
  throw new Error(`bn: cannot coerce ${typeof v} to bigint`);
}

function u8(v: unknown): number {
  if (typeof v === "number") return v;
  return Number(bn(v));
}

// ─── View types ──────────────────────────────────────────────────────

export type PoolStatusName = "Forming" | "Active" | "Completed" | "Liquidated";

export interface ProtocolConfigView {
  address: PublicKey;
  authority: PublicKey;
  treasury: PublicKey;
  usdcMint: PublicKey;
  metaplexCore: PublicKey;
  defaultYieldAdapter: PublicKey;
  reputationProgram: PublicKey;
  feeBpsYield: number;
  feeBpsCycleL1: number;
  feeBpsCycleL2: number;
  feeBpsCycleL3: number;
  guaranteeFundBps: number;
  paused: boolean;
}

export interface PoolView {
  address: PublicKey;
  authority: PublicKey;
  seedId: bigint;
  usdcMint: PublicKey;
  yieldAdapter: PublicKey;
  membersTarget: number;
  installmentAmount: bigint;
  creditAmount: bigint;
  cyclesTotal: number;
  cycleDurationSec: bigint;
  seedDrawBps: number;
  solidarityBps: number;
  escrowReleaseBps: number;
  membersJoined: number;
  status: PoolStatusName;
  startedAt: bigint;
  currentCycle: number;
  nextCycleAt: bigint;
  totalContributed: bigint;
  totalPaidOut: bigint;
  solidarityBalance: bigint;
  escrowBalance: bigint;
  yieldAccrued: bigint;
  guaranteeFundBalance: bigint;
  totalProtocolFeeAccrued: bigint;
  yieldPrincipalDeposited: bigint;
  defaultedMembers: number;
  /** 0-based slot indices that are currently occupied. */
  occupiedSlots: number[];
}

export interface MemberView {
  address: PublicKey;
  pool: PublicKey;
  wallet: PublicKey;
  nftAsset: PublicKey;
  slotIndex: number;
  reputationLevel: number;
  stakeBps: number;
  stakeDeposited: bigint;
  stakeDepositedInitial: bigint;
  totalEscrowDeposited: bigint;
  escrowBalance: bigint;
  contributionsPaid: number;
  totalContributed: bigint;
  totalReceived: bigint;
  onTimeCount: number;
  lateCount: number;
  defaulted: boolean;
  paidOut: boolean;
  lastReleasedCheckpoint: number;
  joinedAt: bigint;
  lastTransferredAt: bigint;
}

export type MemberLifecycleStatus =
  | "forming"     // pool hasn't activated yet
  | "current"     // contributions_paid >= current_cycle (or not-yet-due)
  | "late"        // contributions_paid < current_cycle, still within grace
  | "paid_out"    // already received credit
  | "defaulted";  // settle_default fired

/** Coarse label for `computePoolHealth().state`. */
export type PoolHealthState =
  | "forming"
  | "healthy"
  | "stressed"   // 1-10% default rate
  | "distressed" // >10% default rate
  | "completed"
  | "liquidated";

export interface PoolHealth {
  state: PoolHealthState;
  defaultRate: number;      // 0..1
  /** Fraction of total scheduled contributions collected so far (0..1). */
  collectionProgress: number;
  totalScheduledContributions: bigint;
  totalContributed: bigint;
  totalPaidOut: bigint;
}

// ─── Raw fetchers ────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

async function fetchRawProtocolConfig(
  client: RoundFiClient,
  address: PublicKey,
): Promise<Record<string, unknown>> {
  return (await (client.programs.core.account as any).protocolConfig.fetch(
    address,
  )) as Record<string, unknown>;
}

async function fetchRawPool(
  client: RoundFiClient,
  address: PublicKey,
): Promise<Record<string, unknown>> {
  return (await (client.programs.core.account as any).pool.fetch(
    address,
  )) as Record<string, unknown>;
}

async function fetchRawMember(
  client: RoundFiClient,
  address: PublicKey,
): Promise<Record<string, unknown>> {
  return (await (client.programs.core.account as any).member.fetch(
    address,
  )) as Record<string, unknown>;
}

// ─── Normalizers ─────────────────────────────────────────────────────

function statusName(raw: number): PoolStatusName {
  switch (raw) {
    case POOL_STATUS.Forming:    return "Forming";
    case POOL_STATUS.Active:     return "Active";
    case POOL_STATUS.Completed:  return "Completed";
    case POOL_STATUS.Liquidated: return "Liquidated";
    default:
      throw new Error(`Unknown pool status: ${raw}`);
  }
}

function occupiedSlotsFromBitmap(bitmap: unknown): number[] {
  // Anchor decodes `[u8; 8]` as either number[] or Buffer-like; handle both.
  const bytes: number[] = Array.isArray(bitmap)
    ? (bitmap as number[]).map((v) => Number(v))
    : Array.from(bitmap as ArrayLike<number>);
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]! & 0xff;
    for (let b = 0; b < 8; b++) {
      if ((byte & (1 << b)) !== 0) out.push(i * 8 + b);
    }
  }
  return out;
}

function normalizeProtocolConfig(
  address: PublicKey,
  raw: Record<string, unknown>,
): ProtocolConfigView {
  return {
    address,
    authority:           raw.authority as PublicKey,
    treasury:            raw.treasury as PublicKey,
    usdcMint:            raw.usdcMint as PublicKey,
    metaplexCore:        raw.metaplexCore as PublicKey,
    defaultYieldAdapter: raw.defaultYieldAdapter as PublicKey,
    reputationProgram:   raw.reputationProgram as PublicKey,
    feeBpsYield:         u8(raw.feeBpsYield),
    feeBpsCycleL1:       u8(raw.feeBpsCycleL1),
    feeBpsCycleL2:       u8(raw.feeBpsCycleL2),
    feeBpsCycleL3:       u8(raw.feeBpsCycleL3),
    guaranteeFundBps:    u8(raw.guaranteeFundBps),
    paused:              Boolean(raw.paused),
  };
}

function normalizePool(address: PublicKey, raw: Record<string, unknown>): PoolView {
  return {
    address,
    authority:               raw.authority as PublicKey,
    seedId:                  bn(raw.seedId),
    usdcMint:                raw.usdcMint as PublicKey,
    yieldAdapter:            raw.yieldAdapter as PublicKey,
    membersTarget:           u8(raw.membersTarget),
    installmentAmount:       bn(raw.installmentAmount),
    creditAmount:            bn(raw.creditAmount),
    cyclesTotal:             u8(raw.cyclesTotal),
    cycleDurationSec:        bn(raw.cycleDuration),
    seedDrawBps:             u8(raw.seedDrawBps),
    solidarityBps:           u8(raw.solidarityBps),
    escrowReleaseBps:        u8(raw.escrowReleaseBps),
    membersJoined:           u8(raw.membersJoined),
    status:                  statusName(u8(raw.status)),
    startedAt:               bn(raw.startedAt),
    currentCycle:            u8(raw.currentCycle),
    nextCycleAt:             bn(raw.nextCycleAt),
    totalContributed:        bn(raw.totalContributed),
    totalPaidOut:            bn(raw.totalPaidOut),
    solidarityBalance:       bn(raw.solidarityBalance),
    escrowBalance:           bn(raw.escrowBalance),
    yieldAccrued:            bn(raw.yieldAccrued),
    guaranteeFundBalance:    bn(raw.guaranteeFundBalance),
    totalProtocolFeeAccrued: bn(raw.totalProtocolFeeAccrued),
    yieldPrincipalDeposited: bn(raw.yieldPrincipalDeposited),
    defaultedMembers:        u8(raw.defaultedMembers),
    occupiedSlots:           occupiedSlotsFromBitmap(raw.slotsBitmap),
  };
}

function normalizeMember(address: PublicKey, raw: Record<string, unknown>): MemberView {
  return {
    address,
    pool:                   raw.pool as PublicKey,
    wallet:                 raw.wallet as PublicKey,
    nftAsset:               raw.nftAsset as PublicKey,
    slotIndex:              u8(raw.slotIndex),
    reputationLevel:        u8(raw.reputationLevel),
    stakeBps:               u8(raw.stakeBps),
    stakeDeposited:         bn(raw.stakeDeposited),
    stakeDepositedInitial:  bn(raw.stakeDepositedInitial),
    totalEscrowDeposited:   bn(raw.totalEscrowDeposited),
    escrowBalance:          bn(raw.escrowBalance),
    contributionsPaid:      u8(raw.contributionsPaid),
    totalContributed:       bn(raw.totalContributed),
    totalReceived:          bn(raw.totalReceived),
    onTimeCount:            u8(raw.onTimeCount),
    lateCount:              u8(raw.lateCount),
    defaulted:              Boolean(raw.defaulted),
    paidOut:                Boolean(raw.paidOut),
    lastReleasedCheckpoint: u8(raw.lastReleasedCheckpoint),
    joinedAt:               bn(raw.joinedAt),
    lastTransferredAt:      bn(raw.lastTransferredAt),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Public fetchers ─────────────────────────────────────────────────

export async function fetchProtocolConfig(
  client: RoundFiClient,
): Promise<ProtocolConfigView | null> {
  const [address] = protocolConfigPda(client.ids.core);
  const info = await client.connection.getAccountInfo(address, "confirmed");
  if (!info) return null;
  const raw = await fetchRawProtocolConfig(client, address);
  return normalizeProtocolConfig(address, raw);
}

export async function fetchPool(
  client: RoundFiClient,
  address: PublicKey,
): Promise<PoolView | null> {
  const info = await client.connection.getAccountInfo(address, "confirmed");
  if (!info) return null;
  const raw = await fetchRawPool(client, address);
  return normalizePool(address, raw);
}

export async function fetchMember(
  client: RoundFiClient,
  address: PublicKey,
): Promise<MemberView | null> {
  const info = await client.connection.getAccountInfo(address, "confirmed");
  if (!info) return null;
  const raw = await fetchRawMember(client, address);
  return normalizeMember(address, raw);
}

/**
 * Fetch a member by (pool, wallet) without the caller having to derive
 * the PDA themselves. Returns null if the member hasn't joined yet.
 */
export async function fetchMemberByWallet(
  client: RoundFiClient,
  pool: PublicKey,
  wallet: PublicKey,
): Promise<MemberView | null> {
  const [address] = memberPda(client.ids.core, pool, wallet);
  return fetchMember(client, address);
}

/**
 * Return every Member account for a given pool, filtered server-side
 * via Anchor's memcmp on the `pool` field (first 32 bytes after the
 * 8-byte discriminator). No full-scan — cheap to call repeatedly.
 */
export async function listPoolMembers(
  client: RoundFiClient,
  pool: PublicKey,
): Promise<MemberView[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = await (client.programs.core.account as any).member.all([
    { memcmp: { offset: 8, bytes: pool.toBase58() } },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return accounts.map((entry: any) =>
    normalizeMember(entry.publicKey as PublicKey, entry.account as Record<string, unknown>),
  );
}

/** All four pool vault ATAs — handy for balance reads or UI display. */
export function poolVaults(client: RoundFiClient, pool: PublicKey, usdcMint: PublicKey): {
  poolUsdcVault: PublicKey;
  escrowVault: PublicKey;
  solidarityVault: PublicKey;
  yieldVault: PublicKey;
} {
  const [escrowAuth]     = escrowVaultAuthorityPda(client.ids.core, pool);
  const [solidarityAuth] = solidarityVaultAuthorityPda(client.ids.core, pool);
  const [yieldAuth]      = yieldVaultAuthorityPda(client.ids.core, pool);
  return {
    poolUsdcVault:   getAssociatedTokenAddressSync(usdcMint, pool, true),
    escrowVault:     getAssociatedTokenAddressSync(usdcMint, escrowAuth, true),
    solidarityVault: getAssociatedTokenAddressSync(usdcMint, solidarityAuth, true),
    yieldVault:      getAssociatedTokenAddressSync(usdcMint, yieldAuth, true),
  };
}

/** Read an SPL token account balance. Returns 0n if the ATA doesn't exist. */
export async function fetchTokenBalance(
  client: RoundFiClient,
  ata: PublicKey,
): Promise<bigint> {
  const info = await client.connection.getAccountInfo(ata, "confirmed");
  if (!info) return 0n;
  try {
    const res = await client.connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(res.value.amount);
  } catch {
    return 0n;
  }
}

// ─── Derived helpers ─────────────────────────────────────────────────

/**
 * Expected stake (in base units) for a given credit amount + reputation level,
 * per the STAKE_BPS_BY_LEVEL table. Useful for pre-join UX.
 */
export function expectedStake(creditAmount: bigint, level: 1 | 2 | 3): bigint {
  const bps = BigInt(STAKE_BPS_BY_LEVEL[level]);
  return (creditAmount * bps) / 10_000n;
}

/** Lifecycle label for a single member, relative to the pool state. */
export function memberStatus(member: MemberView, pool: PoolView): MemberLifecycleStatus {
  if (member.defaulted)             return "defaulted";
  if (member.paidOut)               return "paid_out";
  if (pool.status === "Forming")    return "forming";
  if (member.contributionsPaid >= pool.currentCycle) return "current";
  return "late";
}

/**
 * Pool-level health summary. `collectionProgress` is the fraction of
 * the *scheduled* contribution total that has actually landed in the
 * pool vault — a leading indicator that complements `defaultRate`.
 */
export function computePoolHealth(pool: PoolView): PoolHealth {
  const totalScheduled =
    pool.installmentAmount *
    BigInt(pool.cyclesTotal) *
    BigInt(pool.membersTarget);

  const collectionProgress = totalScheduled === 0n
    ? 0
    : Number((pool.totalContributed * 10_000n) / totalScheduled) / 10_000;

  const defaultRate = pool.membersTarget === 0
    ? 0
    : pool.defaultedMembers / pool.membersTarget;

  let state: PoolHealthState;
  if (pool.status === "Forming")         state = "forming";
  else if (pool.status === "Completed")  state = "completed";
  else if (pool.status === "Liquidated") state = "liquidated";
  else if (defaultRate > 0.10)           state = "distressed";
  else if (defaultRate > 0)              state = "stressed";
  else                                   state = "healthy";

  return {
    state,
    defaultRate,
    collectionProgress,
    totalScheduledContributions: totalScheduled,
    totalContributed: pool.totalContributed,
    totalPaidOut: pool.totalPaidOut,
  };
}
