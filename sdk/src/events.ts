/**
 * Canonical RoundFi lifecycle events.
 *
 * Lives in @roundfi/sdk (not in services/orchestrator) because events
 * are the stable interface between every event *emitter* and every
 * event *consumer*. Today the orchestrator emits them; in M3 the
 * chain indexer + Anchor program logs become additional emitters.
 * Frontend, loggers, and replay harnesses are consumers.
 *
 * ─── STABILITY CONTRACT ──────────────────────────────────────────────
 * `LifecycleEvent` is a stable interface across the whole project.
 * Do not modify its shape (add/remove/rename fields, split/merge
 * variants) without updating BOTH sides in the same change:
 *   • consumers: app/src/lib/{mockDemo,realDemo}.ts,
 *     app/src/hooks/useLifecycleState.ts,
 *     app/src/components/EventsFeed.tsx
 *   • emitters:  services/orchestrator/src/{lifecycleDemo,runCycle,
 *     simulateDefault,setup,indexer}.ts (M3+: roundfi-core program logs)
 * Additive changes (new discriminator variants) are safer than
 * modifications — existing consumers then treat unknown variants as
 * inert. When in doubt, prefer adding a new `kind` over extending an
 * existing one.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Design goals:
 *   - every on-chain effect corresponds to exactly one event,
 *   - events are a discriminated union so callers (console logger,
 *     UI reducer, JSON log file) can switch on `kind` exhaustively,
 *   - no randomness, no retries, no hidden transitions — what the
 *     orchestrator does, it reports.
 *
 * Amounts are in USDC base units (u64, 6 decimals) as bigint.
 *
 * Transaction visibility: every `action.ok` emitted from an on-chain
 * call carries the confirmed tx `signature`. UI surfaces that field
 * directly in the events feed — no side channel needed.
 */

import type { PublicKey } from "@solana/web3.js";

// ─── Phase scaffolding ───────────────────────────────────────────────

export type PhaseName =
  | "setup"
  | "protocol_init"
  | "pool_create"
  | "members_join"
  | "cycles"
  | "cycle"
  | "escrow_release"
  | "pool_close"
  | "summary";

export interface PhaseStart {
  kind: "phase.start";
  phase: PhaseName;
  label: string;
  at: number; // Date.now() ms
}

export interface PhaseEnd {
  kind: "phase.end";
  phase: PhaseName;
  label: string;
  at: number;
  elapsedMs: number;
}

// ─── Generic action outcomes ─────────────────────────────────────────

export interface ActionOk {
  kind: "action.ok";
  action: string; // e.g. "contribute", "claimPayout"
  actor?: string; // human-readable name (e.g. "Maria")
  signature?: string; // tx signature when on-chain
  detail: string; // human-readable one-liner
  data?: Record<string, unknown>;
  at: number;
}

export interface ActionSkip {
  kind: "action.skip";
  action: string;
  actor?: string;
  reason: string;
  at: number;
}

export interface ActionFail {
  kind: "action.fail";
  action: string;
  actor?: string;
  error: string;
  at: number;
}

// ─── Domain-specific events (help downstream UIs) ────────────────────

export interface MemberJoined {
  kind: "member.joined";
  actor: string;
  slotIndex: number;
  reputationLevel: 1 | 2 | 3;
  memberPda: string;
  wallet: string;
  stakeDeposited: bigint;
  at: number;
}

export interface MemberContributed {
  kind: "member.contributed";
  actor: string;
  slotIndex: number;
  cycle: number;
  amount: bigint;
  onTime: boolean;
  at: number;
}

export interface MemberMissed {
  kind: "member.missed";
  actor: string;
  slotIndex: number;
  cycle: number;
  /** What happens next on-chain; the orchestrator never calls settle_default itself. */
  note: string;
  at: number;
}

export interface PayoutExecuted {
  kind: "payout.executed";
  actor: string;
  slotIndex: number;
  cycle: number;
  amount: bigint;
  at: number;
}

export interface PoolStateSnapshot {
  kind: "pool.snapshot";
  cycle: number;
  status: string; // PoolStatusName
  totalContributed: bigint;
  totalPaidOut: bigint;
  solidarityBalance: bigint;
  escrowBalance: bigint;
  defaultedMembers: number;
  poolUsdcVaultBalance: bigint;
  at: number;
}

export interface Summary {
  kind: "summary";
  totalEvents: number;
  okCount: number;
  skipCount: number;
  failCount: number;
  startedAt: number;
  finishedAt: number;
  elapsedMs: number;
  /** Optional free-form lines the demo wants to display at the end. */
  notes: string[];
}

// ─── Union + sink ────────────────────────────────────────────────────

export type LifecycleEvent =
  | PhaseStart
  | PhaseEnd
  | ActionOk
  | ActionSkip
  | ActionFail
  | MemberJoined
  | MemberContributed
  | MemberMissed
  | PayoutExecuted
  | PoolStateSnapshot
  | Summary;

/**
 * Sink callback. Multiple sinks can be combined with `multiSink([...])`.
 * Sinks must be synchronous — the orchestrator does not await them.
 */
export type EventSink = (event: LifecycleEvent) => void;

export function multiSink(sinks: EventSink[]): EventSink {
  return (event) => {
    for (const s of sinks) s(event);
  };
}

/** A no-op sink — useful for silent test runs. */
export const nullSink: EventSink = () => {};

// ─── Shared helpers ──────────────────────────────────────────────────

export function now(): number {
  return Date.now();
}

/** Shorten a Pubkey for log readability (first 4…last 4). */
export function shortPk(pk: PublicKey | string): string {
  const s = typeof pk === "string" ? pk : pk.toBase58();
  if (s.length <= 10) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
