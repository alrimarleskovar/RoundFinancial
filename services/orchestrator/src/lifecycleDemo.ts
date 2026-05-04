/**
 * End-to-end demo runner.
 *
 * `lifecycleDemo(config)` is the single entry point for a fully-formed
 * RoundFi protocol run. One invocation goes through:
 *
 *   1. setup      — USDC mint, SOL airdrop, fund members, profiles
 *   2. protocol   — idempotent initializeProtocol, initializeReputation
 *   3. pool       — createPool
 *   4. join       — each member joins in slot order
 *   5. cycles     — runCycle for every cycle [0..cyclesTotal),
 *                   with an optional default scenario
 *   6. close      — closePool (pool must be Completed)
 *
 * Every sub-step emits events through the supplied sink. The demo is
 * deterministic: with the same input config + same provider keys, the
 * sequence of on-chain calls is identical.
 *
 * IMPORTANT — scope boundaries:
 *   • The orchestrator never calls settle_default. That requires a
 *     7-day grace window warp, which only the bankrun edge test can
 *     perform. Missed contributions are logged as `member.missed`.
 *   • The orchestrator never calls release_escrow, deposit_idle_to_yield,
 *     or harvest_yield. Those are post-MVP demo beats.
 *   • The orchestrator does NOT try to recover from failures — any
 *     unhandled on-chain error aborts the demo and rethrows.
 */

import { Keypair, PublicKey } from "@solana/web3.js";

import {
  closePool,
  createPool,
  fetchPool,
  fetchTokenBalance,
  joinPool,
  poolVaults,
  FEES,
} from "@roundfi/sdk";
import type { PoolView, RoundFiClient } from "@roundfi/sdk";

import type { EventSink, LifecycleEvent } from "./events.js";
import { now } from "./events.js";
import { runCycle, type RunCycleResult } from "./runCycle.js";
import { simulateDefault } from "./simulateDefault.js";
import {
  airdropSol,
  buildMembers,
  createDemoUsdcMint,
  ensureMemberProfiles,
  ensureProtocolInitialized,
  ensureReputationInitialized,
  ensureTreasuryAta,
  fundMembers,
  usdc,
  type DemoMember,
} from "./setup.js";

// ─── Config ──────────────────────────────────────────────────────────

export interface PoolConfig {
  /** Ignored if `seedId` is provided, otherwise generated deterministically. */
  seedId?: bigint;
  /** Members to seat. Orchestrator seats every member; `membersTarget` = members.length. */
  memberNames: string[];
  /** Per-member reputation level. Defaults to L1 (50% stake). */
  reputationLevels?: (1 | 2 | 3)[];
  installmentAmount: bigint; // base units
  creditAmount: bigint; // base units
  cyclesTotal: number;
  cycleDurationSec: number;
  /** 0–10000 bps. Defaults to FEES.escrowReleaseBps (2500 = 25% per milestone). */
  escrowReleaseBps?: number;
}

export interface DefaultScenario {
  /** 0-based cycle index during which the default occurs. */
  atCycle: number;
  /** Slot index of the member that will miss. */
  memberSlotIndex: number;
}

export interface LifecycleDemoConfig {
  client: RoundFiClient;
  /** Signer that acts as protocol authority AND pool authority. */
  authority: Keypair;
  /**
   * If omitted, a fresh demo USDC mint is created for this run.
   * Pass an existing mint to reuse state across runs.
   */
  usdcMint?: PublicKey;
  /** If omitted, the authority's ATA on the demo mint is used. */
  treasury?: PublicKey;
  /**
   * If omitted, members are given enough USDC to cover all stakes +
   * all contributions with a small buffer.
   */
  memberFundingUsdc?: bigint;
  /** Airdrop target per wallet — defaults to 1 SOL. Pass 0 to skip. */
  airdropLamports?: number;
  pool: PoolConfig;
  /** Optional explicit default scenario. Leave undefined for the happy path. */
  defaultScenario?: DefaultScenario;
  sink: EventSink;
}

export interface LifecycleDemoResult {
  poolAddress: PublicKey;
  usdcMint: PublicKey;
  treasury: PublicKey;
  members: DemoMember[];
  cycles: RunCycleResult[];
  finalPool: PoolView | null;
  closed: boolean;
  /** Final vault balances at demo end — useful for UI / smoke-test assertions. */
  finalVaultBalances: {
    poolUsdcVault: bigint;
    escrowVault: bigint;
    solidarityVault: bigint;
    yieldVault: bigint;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function counter(): {
  wrap: EventSink;
  stats: { total: number; ok: number; skip: number; fail: number; started: number };
} {
  const stats = { total: 0, ok: 0, skip: 0, fail: 0, started: now() };
  const wrap: EventSink = (e: LifecycleEvent) => {
    stats.total += 1;
    if (e.kind === "action.ok") stats.ok += 1;
    if (e.kind === "action.skip") stats.skip += 1;
    if (e.kind === "action.fail") stats.fail += 1;
  };
  return { wrap, stats };
}

function both(a: EventSink, b: EventSink): EventSink {
  return (e) => {
    a(e);
    b(e);
  };
}

async function phase<T>(
  sink: EventSink,
  phaseName: Parameters<EventSink>[0] extends infer E
    ? E extends { kind: "phase.start"; phase: infer P }
      ? P
      : never
    : never,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const started = now();
  sink({ kind: "phase.start", phase: phaseName, label, at: started });
  const value = await fn();
  const finished = now();
  sink({
    kind: "phase.end",
    phase: phaseName,
    label,
    at: finished,
    elapsedMs: finished - started,
  });
  return value;
}

function computeDefaultFunding(cfg: PoolConfig): bigint {
  // Every member pays (installment × cyclesTotal) + max possible stake
  // (L1 = 50% of credit). A generous buffer absorbs rounding + solidarity.
  const installments = cfg.installmentAmount * BigInt(cfg.cyclesTotal);
  const maxStake = (cfg.creditAmount * 5_000n) / 10_000n;
  return installments + maxStake + usdc(10);
}

// ─── Main entry point ────────────────────────────────────────────────

export async function lifecycleDemo(config: LifecycleDemoConfig): Promise<LifecycleDemoResult> {
  const { client, authority } = config;
  const { wrap: counterSink, stats } = counter();
  const sink: EventSink = both(config.sink, counterSink);

  // ── 1. setup ────────────────────────────────────────────────────
  const setupResult = await phase(sink, "setup", "Setup", async () => {
    const airdropLamports = config.airdropLamports ?? 1_000_000_000; // 1 SOL
    const wallets: PublicKey[] = [authority.publicKey];
    const members = buildMembers({
      names: config.pool.memberNames,
      reputationLevels: config.pool.reputationLevels,
    });
    for (const m of members) wallets.push(m.wallet.publicKey);

    if (airdropLamports > 0) {
      await airdropSol(client.connection, wallets, airdropLamports, sink);
    }

    const usdcMint =
      config.usdcMint ?? (await createDemoUsdcMint(client.connection, authority, sink));

    const treasury =
      config.treasury ??
      (await ensureTreasuryAta(client.connection, authority, usdcMint, authority.publicKey));

    const funding = config.memberFundingUsdc ?? computeDefaultFunding(config.pool);
    await fundMembers(client.connection, authority, usdcMint, members, funding, sink);

    return { usdcMint, treasury, members };
  });
  const { usdcMint, treasury, members } = setupResult;

  // ── 2. protocol + reputation init ───────────────────────────────
  await phase(sink, "protocol_init", "Protocol initialization", async () => {
    await ensureProtocolInitialized(client, { authority, usdcMint, treasury }, sink);
    await ensureReputationInitialized(client, authority, sink);
    await ensureMemberProfiles(client, authority, members, sink);
  });

  // ── 3. pool create ──────────────────────────────────────────────
  const seedId = config.pool.seedId ?? BigInt(Date.now());
  const poolAddress = await phase(sink, "pool_create", "Pool creation", async () => {
    const res = await createPool(client, {
      authority,
      usdcMint,
      seedId,
      membersTarget: members.length,
      installmentAmount: config.pool.installmentAmount,
      creditAmount: config.pool.creditAmount,
      cyclesTotal: config.pool.cyclesTotal,
      cycleDurationSec: config.pool.cycleDurationSec,
      escrowReleaseBps: config.pool.escrowReleaseBps ?? FEES.escrowReleaseBps,
    });
    sink({
      kind: "action.ok",
      action: "createPool",
      signature: res.signature,
      detail:
        `created pool ${res.context.pool.toBase58().slice(0, 8)}… ` +
        `(${members.length} members × ${config.pool.cyclesTotal} cycles, ` +
        `installment=${config.pool.installmentAmount / 1_000_000n} USDC, ` +
        `credit=${config.pool.creditAmount / 1_000_000n} USDC)`,
      at: now(),
    });
    return res.context.pool;
  });

  // ── 4. members join ─────────────────────────────────────────────
  await phase(sink, "members_join", "Members joining", async () => {
    for (const mbr of members) {
      const res = await joinPool(client, {
        pool: poolAddress,
        usdcMint,
        memberWallet: mbr.wallet,
        slotIndex: mbr.slotIndex,
        reputationLevel: mbr.reputationLevel,
      });
      sink({
        kind: "member.joined",
        actor: mbr.name,
        slotIndex: mbr.slotIndex,
        reputationLevel: mbr.reputationLevel,
        memberPda: res.context.member.toBase58(),
        wallet: mbr.wallet.publicKey.toBase58(),
        stakeDeposited: 0n, // true amount set on-chain; not read back here for speed
        at: now(),
      });
      sink({
        kind: "action.ok",
        action: "joinPool",
        actor: mbr.name,
        signature: res.signature,
        detail: `${mbr.name} joined pool at slot ${mbr.slotIndex} (L${mbr.reputationLevel})`,
        at: now(),
      });
    }
  });

  // ── 5. cycles ───────────────────────────────────────────────────
  const cycles: RunCycleResult[] = await phase(
    sink,
    "cycles",
    `Running ${config.pool.cyclesTotal} cycles`,
    async () => {
      const results: RunCycleResult[] = [];
      for (let c = 0; c < config.pool.cyclesTotal; c++) {
        sink({
          kind: "phase.start",
          phase: "cycle",
          label: `Cycle ${c}`,
          at: now(),
        });
        const t0 = now();

        const isDefaultCycle =
          config.defaultScenario !== undefined && config.defaultScenario.atCycle === c;

        let result: RunCycleResult;
        if (isDefaultCycle && config.defaultScenario) {
          result = await simulateDefault({
            client,
            pool: poolAddress,
            usdcMint,
            members,
            atCycle: c,
            memberSlotIndex: config.defaultScenario.memberSlotIndex,
            sink,
          });
        } else {
          result = await runCycle({
            client,
            pool: poolAddress,
            usdcMint,
            members,
            cycle: c,
            sink,
          });
        }
        results.push(result);

        const t1 = now();
        sink({
          kind: "phase.end",
          phase: "cycle",
          label: `Cycle ${c}`,
          at: t1,
          elapsedMs: t1 - t0,
        });
      }
      return results;
    },
  );

  // ── 6. close ────────────────────────────────────────────────────
  let closed = false;
  let finalPool: PoolView | null = null;
  await phase(sink, "pool_close", "Pool close", async () => {
    finalPool = await fetchPool(client, poolAddress);
    if (!finalPool) {
      sink({
        kind: "action.skip",
        action: "closePool",
        reason: "pool account not found",
        at: now(),
      });
      return;
    }
    if (finalPool.status !== "Completed") {
      sink({
        kind: "action.skip",
        action: "closePool",
        reason:
          `pool status is ${finalPool.status}, on-chain close_pool requires ` +
          `Completed (last payout closes the round)`,
        at: now(),
      });
      return;
    }
    const res = await closePool(client, { authority, pool: poolAddress });
    sink({
      kind: "action.ok",
      action: "closePool",
      signature: res.signature,
      detail: `pool ${poolAddress.toBase58().slice(0, 8)}… finalized`,
      at: now(),
    });
    closed = true;
  });

  // ── 7. summary + final balances ─────────────────────────────────
  finalPool = await fetchPool(client, poolAddress);
  const vaults = poolVaults(client, poolAddress, usdcMint);
  const finalVaultBalances = {
    poolUsdcVault: await fetchTokenBalance(client, vaults.poolUsdcVault),
    escrowVault: await fetchTokenBalance(client, vaults.escrowVault),
    solidarityVault: await fetchTokenBalance(client, vaults.solidarityVault),
    yieldVault: await fetchTokenBalance(client, vaults.yieldVault),
  };

  const notes: string[] = [];
  if (config.defaultScenario) {
    const m = members.find((x) => x.slotIndex === config.defaultScenario!.memberSlotIndex);
    notes.push(
      `Default scenario: ${m?.name ?? "?"} skipped cycle ${config.defaultScenario.atCycle}. ` +
        `Full economic recovery is validated in the bankrun edge suite.`,
    );
  }
  if (closed) notes.push("Pool closed cleanly.");
  else notes.push("Pool not closed (status != Completed or error skipped close).");

  const finished = now();
  sink({
    kind: "summary",
    totalEvents: stats.total,
    okCount: stats.ok,
    skipCount: stats.skip,
    failCount: stats.fail,
    startedAt: stats.started,
    finishedAt: finished,
    elapsedMs: finished - stats.started,
    notes,
  });

  return {
    poolAddress,
    usdcMint,
    treasury,
    members,
    cycles,
    finalPool,
    closed,
    finalVaultBalances,
  };
}
