/**
 * L1 ↔ L2 economic parity on litesvm — default scenarios (SEV-012 follow-up).
 *
 * The Healthy canary in `economic_parity.spec.ts` proves the no-default
 * per-member delta parity on a localnet validator. This file runs the
 * DEFAULT scenarios — which need `settle_default` (NFT burn via mpl_core)
 * + the 7-day grace window — on the litesvm Env, the only automated
 * environment that loads the SBFv2 `mpl_core.so` (bankrun panics on it).
 *
 * Comparison shape (same as the canary): each member's on-chain net USDC
 * delta from join→close must match L1's `received − stakePaid −
 * installmentsPaid` within an integer epsilon. For a pre-contemplation
 * defaulter that net is `−(stake + installments-paid-before-default)` on
 * both sides — the protocol seizes exactly what L1 books as `retained`.
 *
 * Grace handling: `driveMatrix`'s `beforeSettle` hook warps the litesvm
 * clock past `next_cycle_at + GRACE_PERIOD_SECS` right before each
 * `settle_default`. `contribute` accepts late payments (it only bumps a
 * non-monetary `late_count`), so the forward warp does not perturb the
 * economics of the cycles that follow.
 *
 * Skips cleanly (like litesvm_join_pool.spec.ts) when the IDL/.so/
 * mpl_core.so artifacts are absent, so it is a no-op outside the litesvm
 * CI lane.
 */

import { expect } from "chai";
import type { PublicKey } from "@solana/web3.js";

import { PRESETS, runSimulation } from "@roundfi/sdk/stressLab";

const GRACE_PERIOD_SECS = 604_800n; // 7 days — protocol constant (settle_default.rs)
const EPSILON = 1_000_000n; // 1 USDC base unit
// litesvm's clock doesn't auto-advance; anchor it to a real epoch so the
// reputation CYCLE_COMPLETE cooldown (now − last) passes on the first
// attestation. Kept BELOW every next_cycle_at so contributes stay on-time
// (a late contribute writes SCHEMA_LATE, whose PDA the harness's on-time
// PAYMENT path doesn't match). The grace warp is restored back to this.
const BASE_TS = 1_750_000_000n;

describe("L1↔L2 parity (litesvm) — Pre-default preset", function () {
  this.timeout(180_000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let env: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let members: any[];
  let onChainDeltas: bigint[];
  let l1Net: bigint[];
  const defaulterSlot = 4; // PRESETS.preDefault defaults member at row 4

  before(async function () {
    // ─── Skip cleanly if litesvm artifacts are missing ───────────────
    let setupLitesvmEnv: typeof import("./_harness/litesvm.js").setupLitesvmEnv;
    let setLitesvmUnixTs: typeof import("./_harness/litesvm.js").setLitesvmUnixTs;
    try {
      ({ setupLitesvmEnv, setLitesvmUnixTs } = await import("./_harness/litesvm.js"));
      env = await setupLitesvmEnv();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `litesvm parity (pre-default): setup failed (${(e as Error).message ?? String(e)}). ` +
          `Needs 'anchor build' + target/deploy/mpl_core.so — skipping.`,
      );
      this.skip();
    }

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
      fetchMember,
      fundUsdc,
      balanceOf,
    } = harness;

    // ─── Build the env: preDefault MATRIX at Iniciante (Lv1) ─────────
    // Fresh on-chain ReputationProfiles are level 1 (the canonical
    // "fresh wallet = Iniciante"); promoting to Lv2 needs score+cycle
    // thresholds, out of scope for a parity fixture. So run the
    // pre-contemplation-default matrix at Iniciante (50% stake). The
    // parity claim (on-chain net delta == L1 net) holds at any level.
    const N = 12;
    const L1_CONFIG = {
      level: "Iniciante" as const,
      members: N,
      creditAmountUsdc: 12_000,
      kaminoApy: 6.5,
      yieldFeePct: 20,
      installmentUsdc: 1_500,
    };
    // ECO-002: the zero-sum installment (credit/members = $1000) fails the
    // on-chain Seed-Draw viability guard (members×inst×(1−solidarity−escrow)
    // = 12×1000×0.74 = 8880 < 12000 credit). Use a viable INDEPENDENT
    // installment and run L1 with the same value via installmentUsdc, so the
    // two sides are comparable. 12×1500×0.74 = 13320 ≥ 12000. ✓
    const INSTALLMENT_USDC = 1_500; // whole USDC (independent installment)
    const installmentUsdc = BigInt(INSTALLMENT_USDC) * 1_000_000n;
    const creditAmountUsdc = 12_000n * 1_000_000n;

    // litesvm's genesis clock starts at unix_timestamp ~0, which trips the
    // reputation CYCLE_COMPLETE cooldown on the FIRST attestation
    // (`now − last_cycle_complete_at(0) < MIN_CYCLE_COOLDOWN_SECS`). Real
    // validators/bankrun start at a real epoch (~1.7e9) so they never hit
    // this. Anchor the litesvm clock to a realistic base before any pool
    // timestamps are set; the grace warp later adds +7d on top.
    await setLitesvmUnixTs(env.svm, BASE_TS);

    const usdcMint = await createUsdcMint(env);
    await initializeProtocol(env, { usdcMint });
    // settle_default CPIs into reputation::attest (writes the SCHEMA_DEFAULT
    // attestation) because config.reputation_program is the real program —
    // so the reputation config must exist (the profile is init_if_needed by
    // the attest CPI). join_pool only READS the profile (level-1 default if
    // absent), which is why litesvm_join_pool.spec.ts doesn't need this.
    await initializeReputation(env, { coreProgram: env.ids.core });
    const authority = keypairFromSeed("predefault-parity-authority");
    await ensureFunded(env, [authority], 5);

    const pool = await createPool(env, {
      authority,
      usdcMint,
      membersTarget: N,
      installmentAmount: installmentUsdc,
      creditAmount: creditAmountUsdc,
      cyclesTotal: N,
      // MIN_CYCLE_DURATION on-chain is 86_400 (1 day, SEV-023). litesvm
      // clock is warped explicitly, so the wall-clock duration is irrelevant.
      cycleDurationSec: 86_400,
    });

    // Pre-fund every wallet with the full position (N×installment + stake)
    // so the join→close delta is exactly (received − stake − installments).
    const stakeUsdc = (creditAmountUsdc * 5_000n) / 10_000n; // Iniciante = 50%
    const totalPerMember = BigInt(N) * installmentUsdc + stakeUsdc;

    const wallets = memberKeypairs(N, "predefault-parity");
    const memberAtas: PublicKey[] = [];
    for (const w of wallets) {
      memberAtas.push(await fundUsdc(env, usdcMint, w.publicKey, totalPerMember));
    }

    const before = await Promise.all(memberAtas.map((ata) => balanceOf(env, ata)));

    members = await joinMembers(
      env,
      pool,
      wallets.map((w) => ({ member: w, reputationLevel: 1 as const })),
    );

    // ─── Drive the matrix; warp past grace before each settle_default ─
    await driveMatrix({
      env,
      pool,
      members,
      matrix: PRESETS.preDefault.matrix,
      // Warp just past the 7-day grace so settle_default is allowed…
      beforeSettle: async () => {
        const p = await fetchPool(env, pool.pool);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (p as any).nextCycleAt ?? (p as any).next_cycle_at;
        const nextCycleAt = BigInt(raw.toString());
        await setLitesvmUnixTs(env.svm, nextCycleAt + GRACE_PERIOD_SECS + 60n);
      },
      // …then restore the base clock so subsequent contributes stay on-time.
      afterSettle: async () => {
        await setLitesvmUnixTs(env.svm, BASE_TS);
      },
    });

    // Non-defaulted members release escrow; the defaulter is already settled.
    for (let i = 0; i < members.length; i++) {
      if (i === defaulterSlot) continue;
      await releaseEscrow(env, { pool, member: members[i]!, checkpoint: N });
    }
    // TEMP diagnostic: pool escrow tallies + per-member escrow/stake at close.
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (await fetchPool(env, pool.pool)) as any;
      // eslint-disable-next-line no-console
      console.log("CLOSE-DEBUG pool", {
        escrowBalance: String(p.escrowBalance ?? p.escrow_balance),
        defaultedEscrowLocked: String(p.defaultedEscrowLocked ?? p.defaulted_escrow_locked),
        defaultedMembers: String(p.defaultedMembers ?? p.defaulted_members),
      });
      for (let i = 0; i < members.length; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = (await fetchMember(env, members[i]!.member)) as any;
        // eslint-disable-next-line no-console
        console.log(
          `CLOSE-DEBUG mem ${i}`,
          "escrow=" + String(m.escrowBalance ?? m.escrow_balance),
          "stake=" + String(m.stakeDeposited ?? m.stake_deposited),
          "defaulted=" + String(m.defaulted),
        );
      }
    }
    // close_pool should now succeed for a defaulted pool (SEV-050).
    await closePool(env, { pool });

    const after = await Promise.all(members.map((m) => balanceOf(env, m.memberUsdc)));
    onChainDeltas = before.map((b, i) => after[i]! - b);

    // ─── L1 reference on the same preset ─────────────────────────────
    // L1 books a member's net as `received − stakePaid − installmentsPaid`,
    // but its per-cycle drip leaves late-contemplated members' residual stake
    // (and any un-dripped escrow) as a tracked OBLIGATION rather than a
    // disbursement — exactly what on-chain `release_escrow` pays out at the
    // final checkpoint. So the on-chain net reconciles to L1's net PLUS those
    // tracked-but-unreleased obligations. For an ok member that simplifies to
    // `credit − installmentsPaid` (the owed stake + escrow cancel the booking).
    // For the defaulter, L1's net already equals the seized position (owed=0).
    // This reconciles L1↔L2 without changing the conservation-correct L1 model.
    const creditWhole = 12_000;
    const frames = runSimulation(L1_CONFIG, PRESETS.preDefault.matrix);
    const final = frames[frames.length - 1]!;
    l1Net = final.ledgerSnapshot.map((row) => {
      const base = row.received - row.stakePaid - row.installmentsPaid;
      let owed = 0;
      if (row.status === "ok") {
        const creditReceived = row.received - row.stakeRefunded;
        owed =
          Math.max(0, row.stakePaid - row.stakeRefunded) +
          Math.max(0, creditWhole - creditReceived);
      }
      return BigInt(Math.round((base + owed) * 1_000_000));
    });
  });

  it("every member's on-chain net reconciles to L1 net + tracked obligations", function () {
    for (let i = 0; i < members.length; i++) {
      const onChain = onChainDeltas[i]!;
      const l1 = l1Net[i]!;
      const drift = onChain > l1 ? onChain - l1 : l1 - onChain;
      expect(
        drift <= EPSILON,
        `slot ${i} drift > 1 USDC: l1=${l1} onChain=${onChain} drift=${drift}`,
      ).to.equal(true);
    }
  });

  it("the defaulter's seized position equals L1 retained (negative net)", function () {
    // Pre-contemplation default → L1 books retained = stake + installments
    // paid before default; the defaulter's net is therefore negative and
    // equal in magnitude. Cross-check the slot explicitly.
    const onChain = onChainDeltas[defaulterSlot]!;
    const l1 = l1Net[defaulterSlot]!;
    expect(l1 < 0n, "L1 books a negative net for the defaulter").to.equal(true);
    const drift = onChain > l1 ? onChain - l1 : l1 - onChain;
    expect(drift <= EPSILON, `defaulter drift > 1 USDC: l1=${l1} onChain=${onChain}`).to.equal(
      true,
    );
  });
});
