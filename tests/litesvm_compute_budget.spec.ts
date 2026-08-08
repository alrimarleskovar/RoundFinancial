/**
 * Compute-unit measurement lane — prices the protocol's hot instructions.
 *
 * ## Why this exists
 *
 * There was no CU assertion anywhere in the repo, and the limits that do
 * exist were hand-picked and never verified:
 *
 *   - `app/src/lib/join-pool.ts:219`        → 400_000
 *   - `app/src/lib/escape-valve-buy.ts:225` → 600_000
 *   - `sdk/src/actions.ts:350`              → 400_000
 *
 * Everything else — `contribute`, `claim_payout`, `crank_payout`,
 * `place_bid_*`, `finalize_draw`, `release_escrow`, `settle_default` —
 * ships on Solana's **200k default**, because its sender sets no limit.
 *
 * Worse: the devnet seed scripts, tuned empirically against a live
 * cluster, ask for MORE than the app does for the same instruction.
 * `scripts/devnet/seed-members.ts:286` requests 600_000 for `join_pool`
 * where the app requests 400_000; `scripts/devnet/seed-evbuy.ts:370`
 * requests 800_000 for `escape_valve_buy` where the app requests 600_000.
 * Both cannot be right, and if the real cost sits between the two, the
 * script succeeds while the user's transaction fails.
 *
 * ## This is a MEASUREMENT pass, not a gate — yet
 *
 * It records CU and prints the table. It does **not** fail on a budget
 * overrun, because no one has seen these numbers yet and a threshold
 * picked before the first measurement would be a guess dressed as a test.
 * Once the numbers are known and the senders are corrected, the budget
 * assertion lands in a follow-up and this becomes a real regression gate.
 *
 * What it DOES fail on: producing no readings at all. A metering lane
 * that silently measures nothing is worse than no lane.
 *
 * Each step is priced independently and a failure is recorded rather than
 * thrown, so one broken step still leaves the earlier numbers on the
 * table instead of taking the whole run down with it.
 *
 * ## Coverage
 *
 * Reaches `create_pool`, `join_pool`, `contribute`, `claim_payout`.
 * NOT priced yet, each needing setup the others don't: `escape_valve_list`
 * / `escape_valve_buy` (commit-reveal + a second funded wallet),
 * `place_bid_commit` / `place_bid_reveal` / `place_embedded_bid`
 * (prepayment + clock warp into the reveal window), `crank_payout`,
 * `settle_default` (grace warp), `release_escrow`, `harvest_yield`,
 * `finalize_draw`. `escape_valve_buy` is the one to add next — largest
 * requested budget in the tree and the widest disagreement about its cost.
 *
 * Prereqs are the usual litesvm ones; absent them the suite SKIPS.
 */

import { expect } from "chai";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";

import {
  claimPayout,
  contribute,
  createPool,
  createUsdcMint,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinPool,
  keypairFromSeed,
  usdc,
} from "./_harness/index.js";
import { setLitesvmUnixTs, setupLitesvmEnv, type LitesvmEnv } from "./_harness/litesvm.js";

const ARTIFACTS = [
  "target/idl/roundfi_core.json",
  "target/idl/roundfi_reputation.json",
  "target/deploy/roundfi_core.so",
  "target/deploy/roundfi_reputation.so",
  "target/deploy/mpl_core.so",
].map((p) => resolve(process.cwd(), p));

/**
 * What each instruction's real sender asks for, and where that number
 * lives. Informational here — printed alongside the measurement so the
 * gap is visible — not asserted. `create_pool` has no app sender; someone
 * already raised it above the 200k default in the devnet script, which is
 * itself evidence the mpl-core CreateV2 CPI does not fit the default.
 */
const SENDER_LIMITS: Record<string, { units: number; source: string }> = {
  create_pool: { units: 250_000, source: "scripts/devnet/seed-pool.ts" },
  join_pool: { units: 400_000, source: "app/src/lib/join-pool.ts:219" },
  contribute: { units: 200_000, source: "app/src/lib/contribute.ts — no explicit limit" },
  claim_payout: { units: 200_000, source: "app/src/lib/claim-payout.ts — no explicit limit" },
};

// Geometry mirrored from litesvm_prepay_ahead.spec.ts, which drives the
// same 2-member / 2-cycle pool to a real claim_payout and passes. SEV-038
// forces cycles_total == members_target.
const MEMBERS = 2;
const CYCLES = 2;
const INSTALLMENT = usdc(1_000n);
const CREDIT = usdc(1_480n);
const STAKE = (CREDIT * 5_000n) / 10_000n; // Lv1 = 50%
const TOTAL_PER_MEMBER = BigInt(CYCLES) * INSTALLMENT + STAKE;
// Must be >= MIN_CYCLE_DURATION (constants.rs:216 — 86_400 = 1 day), else
// create_pool rejects with InvalidCycleDuration (6033).
const CYCLE_DURATION = 86_400;

// litesvm's clock does NOT auto-advance; anchor it below every
// next_cycle_at so each contribute lands on-time.
const BASE_TS = 1_750_000_000n;

interface Reading {
  ix: string;
  cu: number | null;
  error: string | null;
}

describe("compute-unit measurement (litesvm)", function () {
  this.timeout(180_000);

  let env: LitesvmEnv;
  let available = true;
  let usdcMint: PublicKey;
  const readings: Reading[] = [];

  /**
   * Run `fn`, record the largest CU reading it produced, and return its
   * result — or `null` if it threw, with the error kept for the report.
   *
   * Helpers may submit more than one transaction (SOL funding, stake
   * prefund, ATA creation). A system transfer costs ~150 CU and an SPL
   * transfer ~4_500, while a protocol instruction runs in the tens of
   * thousands — so the maximum isolates the instruction under test
   * without this spec tracking each helper's internal tx count.
   */
  async function priceOf<T>(ix: string, fn: () => Promise<T>): Promise<T | null> {
    env.cu.reset();
    try {
      const out = await fn();
      const log = env.cu.log();
      readings.push({ ix, cu: log.length > 0 ? Math.max(...log) : null, error: null });
      return out;
    } catch (err) {
      readings.push({ ix, cu: null, error: (err as Error)?.message ?? String(err) });
      return null;
    }
  }

  before(async function () {
    for (const p of ARTIFACTS) {
      if (!existsSync(p)) {
        console.warn(`\n[litesvm] SKIPPING CU measurement — missing ${p} (run 'anchor build').`);
        available = false;
        return;
      }
    }
    try {
      env = await setupLitesvmEnv();
      await setLitesvmUnixTs(env.svm, BASE_TS);
      usdcMint = await createUsdcMint(env, { forceFresh: true });
      await initializeProtocol(env, { usdcMint });
      // contribute CPIs into roundfi-reputation — without this its config
      // account is missing and the CPI fails AccountNotInitialized (3012).
      await initializeReputation(env, { coreProgram: env.ids.core });
    } catch (e) {
      console.warn(
        `\n[litesvm] SKIPPING CU measurement — setup failed: ${(e as Error)?.message ?? e}`,
      );
      available = false;
    }
  });

  after(function () {
    if (readings.length === 0) return;
    console.log("\n  ── Compute units consumed (litesvm) ──");
    console.table(
      readings.map((r) => {
        const limit = SENDER_LIMITS[r.ix];
        if (r.cu === null) {
          return {
            instruction: r.ix,
            cu: "FAILED",
            "sender asks": limit?.units.toLocaleString("en-US") ?? "—",
            headroom: "—",
          };
        }
        const headroom = limit ? ((limit.units - r.cu) / limit.units) * 100 : null;
        return {
          instruction: r.ix,
          cu: r.cu.toLocaleString("en-US"),
          "sender asks": limit?.units.toLocaleString("en-US") ?? "—",
          headroom: headroom === null ? "—" : `${headroom.toFixed(1)}%`,
        };
      }),
    );
    for (const r of readings) {
      if (r.error) console.log(`  ${r.ix} FAILED: ${r.error}`);
      if (r.cu !== null && SENDER_LIMITS[r.ix] && r.cu > SENDER_LIMITS[r.ix]!.units) {
        console.log(
          `  ⚠ ${r.ix} consumed ${r.cu.toLocaleString("en-US")} CU but ` +
            `${SENDER_LIMITS[r.ix]!.source} requests only ` +
            `${SENDER_LIMITS[r.ix]!.units.toLocaleString("en-US")}.`,
        );
      }
    }
    console.log("");
  });

  it("prices create_pool → join_pool → contribute → claim_payout", async function () {
    if (!available) {
      this.skip();
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = env as any;

    const authority = keypairFromSeed("cu-budget-auth");
    const a = keypairFromSeed("cu-budget-A");
    const b = keypairFromSeed("cu-budget-B");

    // litesvm-native airdrops (no tx → nothing to meter), matching the
    // prepay/cooldown specs.
    for (const kp of [authority, a, b]) {
      env.svm.airdrop(kp.publicKey.toBase58(), 100_000_000_000n);
    }

    const pool = await priceOf("create_pool", () =>
      createPool(e, {
        authority,
        usdcMint,
        membersTarget: MEMBERS,
        installmentAmount: INSTALLMENT,
        creditAmount: CREDIT,
        cyclesTotal: CYCLES,
        cycleDurationSec: CYCLE_DURATION,
      }),
    );

    if (pool) {
      await fundUsdc(e, usdcMint, a.publicKey, TOTAL_PER_MEMBER);
      await fundUsdc(e, usdcMint, b.publicKey, TOTAL_PER_MEMBER);

      // `joinPool` (singular), not `joinMembers`: the plural helper derives
      // each slot from its position in the slate, so two one-entry calls
      // both ask for slot 0 and the second reverts SlotTaken.
      //
      // Priced on the FIRST member only — the last join activates the pool
      // and would conflate two costs under one label.
      const first = await priceOf("join_pool", () =>
        joinPool(e, pool, { member: a, slotIndex: 0, reputationLevel: 1 }),
      );
      const second = await joinPool(e, pool, { member: b, slotIndex: 1, reputationLevel: 1 });

      if (first) {
        await priceOf("contribute", () => contribute(e, { pool, member: first, cycle: 0 }));
        await contribute(e, { pool, member: second, cycle: 0 });
        // ArrivalOrder pool: slot 0 is contemplated at cycle 0.
        await priceOf("claim_payout", () => claimPayout(e, { pool, member: first, cycle: 0 }));
      }
    }

    // The one hard failure: a metering lane that measures nothing is worse
    // than no lane, because it reads as coverage.
    const measured = readings.filter((r) => r.cu !== null);
    expect(
      measured.length,
      `no CU readings at all — the lane measured nothing. Failures: ` +
        readings.map((r) => `${r.ix}: ${r.error ?? "no reading"}`).join(" · "),
    ).to.be.greaterThan(0);
  });
});
