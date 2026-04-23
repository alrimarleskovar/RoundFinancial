/**
 * In-browser mock driver for the first frontend version.
 *
 * Emits the exact same `LifecycleEvent` discriminated union that the
 * real `@roundfi/orchestrator` emits, so Step 8 can swap this out for
 * an SSE stream off a server route without touching the UI components.
 *
 * Economics mirror the demo 4×4 pool:
 *   - 4 members, 4 cycles
 *   - installment = 1000 USDC, credit = 2000 USDC
 *   - solidarity bps = 1% (10), escrow bps = 25% (2500), pool_float = 74%
 *   - stake = 50% of credit at L1 = 1000 USDC per member
 * The numbers you see ticking up in the UI match the on-chain path exactly.
 */

import type { LifecycleEvent } from "@roundfi/orchestrator";

export interface MockConfig {
  memberNames: string[];
  cyclesTotal: number;
  installmentAmount: bigint;
  creditAmount: bigint;
  /** If set, member at this slot skips contribution during this cycle. */
  defaultScenario?: { memberSlotIndex: number; atCycle: number };
  /** Delay between emitted events (ms). Defaults to 350. */
  stepDelayMs?: number;
}

export interface MockHandle {
  /** Stop the in-flight simulation. Safe to call repeatedly. */
  cancel: () => void;
}

const USDC_UNIT = 1_000_000n;
const SOLIDARITY_BPS = 100n;       // 1% to solidarity vault
const ESCROW_BPS     = 2_500n;     // 25% to escrow
// pool_float = 10_000 - solidarity - escrow = 74%

function stakePerMemberL1(credit: bigint): bigint {
  return (credit * 5_000n) / 10_000n;
}

function solidarityPerInstallment(installment: bigint): bigint {
  return (installment * SOLIDARITY_BPS) / 10_000n;
}
function escrowPerInstallment(installment: bigint): bigint {
  return (installment * ESCROW_BPS) / 10_000n;
}
function poolFloatPerInstallment(installment: bigint): bigint {
  return installment - solidarityPerInstallment(installment) - escrowPerInstallment(installment);
}

function nowFn(): number {
  return Date.now();
}

/**
 * Run the mock demo. Calls `onEvent` for every LifecycleEvent emitted
 * and resolves when the demo completes (or is cancelled).
 */
export function runMockDemo(
  config: MockConfig,
  onEvent: (event: LifecycleEvent) => void,
): MockHandle {
  const stepDelay = config.stepDelayMs ?? 350;
  let cancelled = false;
  const emitted: LifecycleEvent[] = [];

  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;
  const startedAt = nowFn();

  const emit = (e: LifecycleEvent) => {
    if (cancelled) return;
    emitted.push(e);
    if (e.kind === "action.ok") okCount += 1;
    else if (e.kind === "action.skip") skipCount += 1;
    else if (e.kind === "action.fail") failCount += 1;
    onEvent(e);
  };

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const id = setTimeout(() => resolve(), ms);
      // attach to cancellation: if cancelled, resolve early so the
      // async flow can break out on its next `if (cancelled)` check.
      const check = setInterval(() => {
        if (cancelled) {
          clearTimeout(id);
          clearInterval(check);
          resolve();
        }
      }, 50);
      setTimeout(() => clearInterval(check), ms + 10);
    });

  const run = async () => {
    const members = config.memberNames.map((name, i) => ({ name, slotIndex: i }));
    const stake = stakePerMemberL1(config.creditAmount);

    // ── setup ─────────────────────────────────────────────────────
    emit({ kind: "phase.start", phase: "setup", label: "Setup", at: nowFn() });
    await wait(stepDelay);
    emit({
      kind: "action.ok",
      action: "createDemoUsdcMint",
      detail: "created demo USDC mint (simulated)",
      at: nowFn(),
    });
    for (const m of members) {
      if (cancelled) return;
      await wait(stepDelay * 0.6);
      emit({
        kind: "action.ok",
        action: "fundMemberUsdc",
        actor: m.name,
        detail: `funded ${m.name}'s wallet`,
        at: nowFn(),
      });
    }
    emit({
      kind: "phase.end",
      phase: "setup",
      label: "Setup",
      at: nowFn(),
      elapsedMs: 0,
    });

    // ── protocol init ─────────────────────────────────────────────
    emit({
      kind: "phase.start",
      phase: "protocol_init",
      label: "Protocol initialization",
      at: nowFn(),
    });
    await wait(stepDelay);
    emit({
      kind: "action.ok",
      action: "initializeProtocol",
      detail: "ProtocolConfig ready",
      at: nowFn(),
    });
    await wait(stepDelay);
    emit({
      kind: "action.ok",
      action: "initializeReputation",
      detail: "ReputationConfig ready",
      at: nowFn(),
    });
    emit({
      kind: "phase.end",
      phase: "protocol_init",
      label: "Protocol initialization",
      at: nowFn(),
      elapsedMs: 0,
    });

    // ── pool create ───────────────────────────────────────────────
    emit({
      kind: "phase.start",
      phase: "pool_create",
      label: "Pool creation",
      at: nowFn(),
    });
    await wait(stepDelay);
    emit({
      kind: "action.ok",
      action: "createPool",
      detail:
        `Created pool (${members.length} members × ${config.cyclesTotal} cycles, ` +
        `installment=${config.installmentAmount / USDC_UNIT} USDC, ` +
        `credit=${config.creditAmount / USDC_UNIT} USDC)`,
      at: nowFn(),
    });
    emit({
      kind: "phase.end",
      phase: "pool_create",
      label: "Pool creation",
      at: nowFn(),
      elapsedMs: 0,
    });

    // ── join ──────────────────────────────────────────────────────
    emit({
      kind: "phase.start",
      phase: "members_join",
      label: "Members joining",
      at: nowFn(),
    });
    for (const m of members) {
      if (cancelled) return;
      await wait(stepDelay);
      emit({
        kind: "member.joined",
        actor: m.name,
        slotIndex: m.slotIndex,
        reputationLevel: 1,
        memberPda: `mock-pda-${m.slotIndex}`,
        wallet: `mock-wallet-${m.slotIndex}`,
        stakeDeposited: stake,
        at: nowFn(),
      });
    }
    emit({
      kind: "phase.end",
      phase: "members_join",
      label: "Members joining",
      at: nowFn(),
      elapsedMs: 0,
    });

    // ── cycles ────────────────────────────────────────────────────
    let totalContributed = 0n;
    let totalPaidOut = 0n;
    let solidarityBalance = 0n;
    let escrowBalance = members.reduce((acc) => acc + stake, 0n); // stakes held in escrow
    let defaults = 0;
    // poolUsdcVaultBalance: stakes are held in escrow (separate vault),
    // pool vault starts at 0.
    let poolUsdcVault = 0n;

    emit({
      kind: "phase.start",
      phase: "cycles",
      label: `Running ${config.cyclesTotal} cycles`,
      at: nowFn(),
    });

    for (let c = 0; c < config.cyclesTotal; c++) {
      if (cancelled) return;
      emit({
        kind: "phase.start",
        phase: "cycle",
        label: `Cycle ${c}`,
        at: nowFn(),
      });

      const isDefaultCycle =
        config.defaultScenario !== undefined &&
        config.defaultScenario.atCycle === c;
      const defaulterSlot = isDefaultCycle
        ? config.defaultScenario!.memberSlotIndex
        : -1;

      if (isDefaultCycle) {
        emit({
          kind: "action.ok",
          action: "simulateDefault",
          actor: members[defaulterSlot]?.name,
          detail:
            `Scenario: ${members[defaulterSlot]?.name} (slot ${defaulterSlot}) ` +
            `will skip contribution for cycle ${c}`,
          at: nowFn(),
        });
        await wait(stepDelay);
      }

      // contribute phase
      for (const m of members) {
        if (cancelled) return;
        await wait(stepDelay);
        if (m.slotIndex === defaulterSlot) {
          emit({
            kind: "member.missed",
            actor: m.name,
            slotIndex: m.slotIndex,
            cycle: c,
            note: "orchestrator skipped contribution (simulated default)",
            at: nowFn(),
          });
          continue;
        }
        totalContributed += config.installmentAmount;
        solidarityBalance += solidarityPerInstallment(config.installmentAmount);
        escrowBalance += escrowPerInstallment(config.installmentAmount);
        poolUsdcVault += poolFloatPerInstallment(config.installmentAmount);

        emit({
          kind: "member.contributed",
          actor: m.name,
          slotIndex: m.slotIndex,
          cycle: c,
          amount: config.installmentAmount,
          onTime: true,
          at: nowFn(),
        });
      }

      // claim phase — slot owner for this cycle claims
      const claimant = members.find((x) => x.slotIndex === c);
      if (claimant) {
        await wait(stepDelay);
        // On-chain, claim pays creditAmount to the slot owner. In the
        // demo we don't check pool_float coverage — that's covered by
        // on-chain assertions; here we just mirror the effect.
        poolUsdcVault -= config.creditAmount;
        totalPaidOut += config.creditAmount;
        emit({
          kind: "payout.executed",
          actor: claimant.name,
          slotIndex: claimant.slotIndex,
          cycle: c,
          amount: config.creditAmount,
          at: nowFn(),
        });
      }

      // if this cycle saw a default, bump the pool's defaulted counter
      // at the *end* of the cycle — mimics the on-chain semantics where
      // settle_default would flip the flag after the grace period.
      if (isDefaultCycle) defaults += 1;

      // snapshot
      await wait(stepDelay * 0.4);
      emit({
        kind: "pool.snapshot",
        cycle: c,
        status: c + 1 >= config.cyclesTotal ? "Completed" : "Active",
        totalContributed,
        totalPaidOut,
        solidarityBalance,
        escrowBalance,
        defaultedMembers: defaults,
        poolUsdcVaultBalance: poolUsdcVault < 0n ? 0n : poolUsdcVault,
        at: nowFn(),
      });

      emit({
        kind: "phase.end",
        phase: "cycle",
        label: `Cycle ${c}`,
        at: nowFn(),
        elapsedMs: 0,
      });
    }

    emit({
      kind: "phase.end",
      phase: "cycles",
      label: `Running ${config.cyclesTotal} cycles`,
      at: nowFn(),
      elapsedMs: 0,
    });

    // ── close ─────────────────────────────────────────────────────
    emit({
      kind: "phase.start",
      phase: "pool_close",
      label: "Pool close",
      at: nowFn(),
    });
    await wait(stepDelay);
    emit({
      kind: "action.ok",
      action: "closePool",
      detail: "pool finalized",
      at: nowFn(),
    });
    emit({
      kind: "phase.end",
      phase: "pool_close",
      label: "Pool close",
      at: nowFn(),
      elapsedMs: 0,
    });

    // ── summary ───────────────────────────────────────────────────
    const notes: string[] = [];
    if (config.defaultScenario) {
      notes.push(
        `Default scenario: ${members[config.defaultScenario.memberSlotIndex]?.name} ` +
        `skipped cycle ${config.defaultScenario.atCycle}. Full economic recovery is ` +
        `validated in the bankrun edge suite.`,
      );
    }
    notes.push("Pool closed cleanly.");

    const finishedAt = nowFn();
    emit({
      kind: "summary",
      totalEvents: emitted.length,
      okCount,
      skipCount,
      failCount,
      startedAt,
      finishedAt,
      elapsedMs: finishedAt - startedAt,
      notes,
    });
  };

  // Fire-and-forget
  void run().catch(() => {
    // swallow — cancellation races aren't reported to the UI
  });

  return {
    cancel: () => {
      cancelled = true;
    },
  };
}
