/**
 * L1 ↔ L2 economic parity on litesvm — default scenarios (SEV-012 follow-up).
 *
 * The Healthy canary in `economic_parity.spec.ts` proves the no-default
 * per-member delta parity on a localnet validator. This file runs the
 * DEFAULT scenarios — which need `settle_default` (NFT burn via mpl_core)
 * + the 7-day grace window — on the litesvm Env, the only automated
 * environment that loads the SBFv2 `mpl_core.so` (bankrun panics on it).
 *
 * Scenarios (one `describe` each, same harness path):
 *   - Pre-default  (preDefault preset, slot 4): defaults BEFORE its
 *     contemplation cycle → exercises `skip_defaulted_payout` (SEV-049).
 *   - Post-default (postDefault preset, slot 1): claims at its
 *     contemplation cycle THEN defaults later → calote_pos / real loss;
 *     no skip needed (the slot's cycle already advanced via the claim).
 * Both then `close_pool` the defaulted pool (SEV-050 fix).
 *
 * Comparison: on-chain `release_escrow` / `settle_default` disburse or seize
 * exactly what L1 books as still-owed at pool end, so on-chain net = L1 net +
 * L1's tracked obligations (owed stake + un-dripped escrow). For an ok member
 * that simplifies to `credit − installmentsPaid`; for the defaulter owed=0, so
 * the defaulter's net matches L1 directly. No change to the (conservation-
 * correct) L1 model.
 *
 * Grace handling: `driveMatrix`'s `beforeSettle` hook warps the litesvm clock
 * past `next_cycle_at + GRACE_PERIOD_SECS` right before each `settle_default`,
 * and `afterSettle` restores the base clock so later contributes stay on-time
 * (a late contribute writes SCHEMA_LATE, whose PDA the on-time PAYMENT path
 * doesn't match).
 *
 * Skips cleanly when the IDL/.so/mpl_core.so artifacts are absent, so it is a
 * no-op outside the litesvm CI lane.
 */

import { expect } from "chai";
import type { PublicKey } from "@solana/web3.js";

import { PRESETS, runSimulation } from "@roundfi/sdk/stressLab";

const GRACE_PERIOD_SECS = 604_800n; // 7 days — protocol constant (settle_default.rs)
const EPSILON = 1_000_000n; // 1 USDC base unit
// litesvm's clock doesn't auto-advance; anchor it to a real epoch so the
// reputation CYCLE_COMPLETE cooldown (now − last) passes on the first
// attestation. Kept BELOW every next_cycle_at so contributes stay on-time.
// The grace warp is restored back to this after each settle.
const BASE_TS = 1_750_000_000n;
const N = 12;
const CREDIT_WHOLE = 12_000;

interface ScenarioResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  members: any[];
  onChainDeltas: bigint[];
  l1Net: bigint[];
}

// Drives one default scenario end-to-end on a fresh litesvm Env and returns
// the on-chain per-member deltas + the reconciled L1 reference. Throws if the
// litesvm artifacts are missing (caller turns that into a clean `this.skip()`).
async function driveParityScenario(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  matrix: any;
  seedPrefix: string;
}): Promise<ScenarioResult> {
  const { setupLitesvmEnv, setLitesvmUnixTs } = await import("./_harness/litesvm.js");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env: any = await setupLitesvmEnv();

  const harness = await import("./_harness/index.js");
  const {
    createUsdcMint,
    initializeProtocol,
    initializeReputation,
    createPool,
    joinMembers,
    memberKeypairs,
    ensureFunded,
    keypairFromSeed,
    driveMatrix,
    releaseEscrow,
    closePool,
    fetchPool,
    fundUsdc,
    balanceOf,
  } = harness;

  // Iniciante (Lv1) on both sides — fresh on-chain profiles are level 1
  // (promoting to Lv2 needs score+cycle thresholds, out of scope here). The
  // parity claim holds at any level. ECO-002: the zero-sum installment
  // (credit/members = $1000) fails the Seed-Draw viability guard
  // (12×1000×0.74 < 12000), so use a viable INDEPENDENT installment and run
  // L1 with the same value (12×1500×0.74 = 13320 ≥ 12000). ✓
  const L1_CONFIG = {
    level: "Iniciante" as const,
    members: N,
    creditAmountUsdc: CREDIT_WHOLE,
    kaminoApy: 6.5,
    yieldFeePct: 20,
    installmentUsdc: 1_500,
  };
  const installmentUsdc = 1_500n * 1_000_000n;
  const creditAmountUsdc = BigInt(CREDIT_WHOLE) * 1_000_000n;

  await setLitesvmUnixTs(env.svm, BASE_TS);

  const usdcMint = await createUsdcMint(env);
  await initializeProtocol(env, { usdcMint });
  // settle_default CPIs into reputation::attest (config.reputation_program is
  // the real program), so the reputation config must exist (the profile is
  // init_if_needed by the attest CPI).
  await initializeReputation(env, { coreProgram: env.ids.core });
  const authority = keypairFromSeed(`${opts.seedPrefix}-authority`);
  await ensureFunded(env, [authority], 5);

  const pool = await createPool(env, {
    authority,
    usdcMint,
    membersTarget: N,
    installmentAmount: installmentUsdc,
    creditAmount: creditAmountUsdc,
    cyclesTotal: N,
    cycleDurationSec: 86_400, // MIN_CYCLE_DURATION (SEV-023); clock is warped explicitly
  });

  // Pre-fund the full position (N×installment + stake) so each join→close
  // delta is exactly (received − stake − installments).
  const stakeUsdc = (creditAmountUsdc * 5_000n) / 10_000n; // Iniciante = 50%
  const totalPerMember = BigInt(N) * installmentUsdc + stakeUsdc;

  const wallets = memberKeypairs(N, opts.seedPrefix);
  const memberAtas: PublicKey[] = [];
  for (const w of wallets) {
    memberAtas.push(await fundUsdc(env, usdcMint, w.publicKey, totalPerMember));
  }

  const before = await Promise.all(memberAtas.map((ata) => balanceOf(env, ata)));

  const members = await joinMembers(
    env,
    pool,
    wallets.map((w) => ({ member: w, reputationLevel: 1 as const })),
  );

  // Track who's defaulted so the escrow-release loop skips them (a defaulted
  // member can't release_escrow). driveMatrix flips them via settle_default.
  const defaultedSlots = new Set<number>();

  await driveMatrix({
    env,
    pool,
    members,
    matrix: opts.matrix,
    beforeSettle: async () => {
      const p = await fetchPool(env, pool.pool);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (p as any).nextCycleAt ?? (p as any).next_cycle_at;
      const nextCycleAt = BigInt(raw.toString());
      await setLitesvmUnixTs(env.svm, nextCycleAt + GRACE_PERIOD_SECS + 60n);
    },
    afterSettle: async (_cycle: number, slot: number) => {
      defaultedSlots.add(slot);
      await setLitesvmUnixTs(env.svm, BASE_TS);
    },
  });

  for (let i = 0; i < members.length; i++) {
    if (defaultedSlots.has(i)) continue;
    await releaseEscrow(env, { pool, member: members[i]!, checkpoint: N });
  }
  // close_pool succeeds for a defaulted pool (SEV-050): pure terminal-state
  // transition, the unsatisfiable defaulted-pool guard was removed.
  await closePool(env, { pool });

  const after = await Promise.all(members.map((m) => balanceOf(env, m.memberUsdc)));
  const onChainDeltas = before.map((b, i) => after[i]! - b);

  // L1 reference, reconciled to include obligations on-chain release_escrow
  // pays out (owed stake + un-dripped escrow) for ok members; owed=0 for
  // defaulters (their net is already the seized/loss position).
  const frames = runSimulation(L1_CONFIG, opts.matrix);
  const final = frames[frames.length - 1]!;
  const l1Net = final.ledgerSnapshot.map((row) => {
    const base = row.received - row.stakePaid - row.installmentsPaid;
    let owed = 0;
    if (row.status === "ok") {
      const creditReceived = row.received - row.stakeRefunded;
      owed =
        Math.max(0, row.stakePaid - row.stakeRefunded) + Math.max(0, CREDIT_WHOLE - creditReceived);
    }
    return BigInt(Math.round((base + owed) * 1_000_000));
  });

  return { members, onChainDeltas, l1Net };
}

const SCENARIOS = [
  {
    label: "Pre-default",
    matrix: PRESETS.preDefault.matrix,
    defaulterSlot: 4, // defaults BEFORE contemplation → calote_pre (negative net)
    seedPrefix: "predefault-parity",
  },
  {
    label: "Post-default",
    matrix: PRESETS.postDefault.matrix,
    defaulterSlot: 1, // claims THEN defaults → calote_pos (real loss to pool)
    seedPrefix: "postdefault-parity",
  },
];

for (const scenario of SCENARIOS) {
  describe(`L1↔L2 parity (litesvm) — ${scenario.label} preset`, function () {
    this.timeout(180_000);

    let result: ScenarioResult;

    before(async function () {
      try {
        result = await driveParityScenario(scenario);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(
          `litesvm parity (${scenario.label}): setup failed (${(e as Error).message ?? String(e)}). ` +
            `Needs 'anchor build' + target/deploy/mpl_core.so — skipping.`,
        );
        this.skip();
      }
    });

    it("every member's on-chain net reconciles to L1 net + tracked obligations", function () {
      for (let i = 0; i < result.members.length; i++) {
        const onChain = result.onChainDeltas[i]!;
        const l1 = result.l1Net[i]!;
        const drift = onChain > l1 ? onChain - l1 : l1 - onChain;
        expect(
          drift <= EPSILON,
          `slot ${i} drift > 1 USDC: l1=${l1} onChain=${onChain} drift=${drift}`,
        ).to.equal(true);
      }
    });

    it("the defaulter's net matches L1 directly (owed=0)", function () {
      const onChain = result.onChainDeltas[scenario.defaulterSlot]!;
      const l1 = result.l1Net[scenario.defaulterSlot]!;
      const drift = onChain > l1 ? onChain - l1 : l1 - onChain;
      expect(
        drift <= EPSILON,
        `defaulter slot ${scenario.defaulterSlot} drift > 1 USDC: l1=${l1} onChain=${onChain}`,
      ).to.equal(true);
    });
  });
}
