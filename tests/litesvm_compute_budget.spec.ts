/**
 * Compute-unit budget lane — prices the protocol's hot instructions and
 * holds each one under the CU limit its **real sender** requests.
 *
 * ## Why this exists
 *
 * Before this spec there was no CU assertion anywhere in the repo. The
 * limits that do exist were hand-picked and never verified:
 *
 *   - `app/src/lib/join-pool.ts:219`        → 400_000
 *   - `app/src/lib/escape-valve-buy.ts:225` → 600_000
 *   - `sdk/src/actions.ts:350`              → 400_000
 *
 * Everything else — `contribute`, `claim_payout`, `crank_payout`,
 * `place_bid_*`, `finalize_draw`, `release_escrow`, `settle_default` —
 * ships on Solana's **200k default**. A pool that works today can start
 * failing after an added branch, on a user's wallet, with no test between
 * the change and the failure.
 *
 * Worse: the devnet seed scripts, tuned empirically against a live
 * cluster, ask for MORE than the app does for the same instruction —
 * `scripts/devnet/seed-members.ts:286` requests 600_000 for `join_pool`
 * where the app requests 400_000, and `scripts/devnet/seed-evbuy.ts:370`
 * requests 800_000 for `escape_valve_buy` where the app requests 600_000.
 * Both cannot be right. If the true cost sits between the two, the script
 * succeeds and the user's transaction fails.
 *
 * ## What is asserted
 *
 * Each measured instruction must fit its sender's limit **with headroom**
 * (`MIN_HEADROOM_BPS`). Fitting exactly is not good enough — the next
 * branch added to that handler is what pushes it over, and "it fit
 * yesterday" is not a property worth testing. The failure message names
 * the sender file to edit.
 *
 * The budgets below are NOT invented numbers: every one mirrors a limit
 * that already exists in the tree (or the 200k the runtime applies when
 * no limit is set). That keeps the lane honest — it measures reality
 * against what we already ship, not against a target someone guessed.
 *
 * ## Coverage — what this does NOT price yet
 *
 * The lifecycle below reaches `create_pool`, `join_pool`, `contribute`
 * and `claim_payout`. Deliberately not covered in this first cut, each
 * because it needs setup the others don't:
 *
 *   `escape_valve_list` / `escape_valve_buy` (commit-reveal + a second
 *   funded wallet), `place_bid_commit` / `place_bid_reveal` /
 *   `place_embedded_bid` (prepayment + clock warp into the reveal
 *   window), `crank_payout`, `settle_default` (grace-period warp),
 *   `release_escrow`, `harvest_yield`, `finalize_draw`.
 *
 * `escape_valve_buy` is the one to add next: it carries the largest
 * requested budget in the tree (600k app / 800k script) and the widest
 * disagreement about what it actually costs.
 *
 * Prereqs are the same as every litesvm spec (`anchor build` +
 * `mpl_core.so` dump); absent them the suite SKIPS rather than fails.
 */

import { expect } from "chai";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  claimPayout,
  contribute,
  createPool,
  createUsdcMint,
  fundUsdc,
  initializeProtocol,
  joinMembers,
} from "./_harness/index.js";
import { setupLitesvmEnv, type LitesvmEnv } from "./_harness/litesvm.js";

const ARTIFACTS = [
  "target/idl/roundfi_core.json",
  "target/deploy/roundfi_core.so",
  "target/deploy/mpl_core.so",
].map((p) => resolve(process.cwd(), p));

/**
 * The CU limit each instruction's real sender asks for, and where that
 * number lives. `200_000` is the runtime default applied when a sender
 * sets no `setComputeUnitLimit` — not a choice anyone made, which is
 * exactly why those rows matter most.
 */
const SENDER_LIMITS: Record<string, { units: number; source: string }> = {
  // No app sender — pool creation is script/admin-only today. Someone
  // already had to raise this above the 200k default, which is itself
  // evidence that the mpl-core CreateV2 CPI does not fit the default.
  create_pool: { units: 250_000, source: "scripts/devnet/seed-pool.ts" },
  join_pool: { units: 400_000, source: "app/src/lib/join-pool.ts:219" },
  // `app/src/lib/contribute.ts` and `claim-payout.ts` set no limit at
  // all, so these two ride the runtime default on every real user
  // transaction. They are the rows most worth watching.
  contribute: { units: 200_000, source: "app/src/lib/contribute.ts — no explicit limit" },
  claim_payout: { units: 200_000, source: "app/src/lib/claim-payout.ts — no explicit limit" },
};

/** Required margin under the sender's limit. 15% ≈ one added CPI. */
const MIN_HEADROOM_BPS = 1_500;

/** Pool geometry — smallest that reaches a real `claim_payout`. */
const MEMBERS = 2;
const CYCLES = 2;
const INSTALLMENT = 3_000_000n; // 3 USDC
const CREDIT = 4_000_000n; // 4 USDC
// Must be >= MIN_CYCLE_DURATION (constants.rs:216 — 86_400 = 1 day), else
// create_pool rejects with InvalidCycleDuration (6033) before any CU is
// measured. The devnet pools that ran on 60s/3600s cycles did so under a
// patched floor, not this build's.
const CYCLE_DURATION = 86_400;

interface Reading {
  ix: string;
  cu: number;
  limit: number;
  source: string;
}

describe("compute-unit budgets — every instruction fits the limit its sender requests", function () {
  this.timeout(180_000);

  let env: LitesvmEnv;
  let available = true;
  const readings: Reading[] = [];

  /**
   * Run `fn` and return the largest CU reading it produced.
   *
   * Helpers may submit more than one transaction (funding, ATA creation).
   * A system transfer costs ~150 CU and an SPL transfer ~4_500, while a
   * protocol instruction runs in the tens of thousands — so the maximum
   * isolates the instruction under test without this spec having to know
   * each helper's internal transaction count.
   */
  async function priceOf<T>(ix: string, fn: () => Promise<T>): Promise<T> {
    env.cu.reset();
    const out = await fn();
    const log = env.cu.log();
    expect(
      log.length,
      `${ix}: harness recorded no CU reading — is litesvm metering broken?`,
    ).to.be.greaterThan(0);
    const limit = SENDER_LIMITS[ix];
    expect(limit, `${ix}: no SENDER_LIMITS entry`).to.exist;
    readings.push({ ix, cu: Math.max(...log), limit: limit!.units, source: limit!.source });
    return out;
  }

  before(async function () {
    for (const p of ARTIFACTS) {
      if (!existsSync(p)) {
        console.warn(`\n[litesvm] SKIPPING CU budgets — missing ${p} (run 'anchor build').`);
        available = false;
        return;
      }
    }
    try {
      env = await setupLitesvmEnv();
    } catch (e) {
      console.warn(`\n[litesvm] SKIPPING CU budgets — setup failed: ${(e as Error)?.message ?? e}`);
      available = false;
    }
  });

  after(function () {
    if (readings.length === 0) return;
    const rows = readings.map((r) => {
      const headroomBps = Math.floor(((r.limit - r.cu) / r.limit) * 10_000);
      return {
        instruction: r.ix,
        cu: r.cu.toLocaleString("en-US"),
        limit: r.limit.toLocaleString("en-US"),
        headroom: `${(headroomBps / 100).toFixed(1)}%`,
      };
    });
    // The table is the point as much as the assertions: it is the first
    // CU measurement this repo has ever produced, and it is what a future
    // optimization pass gets judged against.
    console.log("\n  Compute units consumed (litesvm):");
    console.table(rows);
  });

  it("prices create_pool → join_pool → contribute → claim_payout and holds each under its sender's limit", async function () {
    if (!available) {
      this.skip();
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = env as any;
    const { Keypair } = await import("@solana/web3.js");

    const usdcMint = await createUsdcMint(e, { forceFresh: true });
    await initializeProtocol(e, { usdcMint });

    const authority = Keypair.generate();
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

    const a = Keypair.generate();
    const b = Keypair.generate();
    const funding = INSTALLMENT * BigInt(CYCLES) * 4n;
    await fundUsdc(e, usdcMint, a.publicKey, funding);
    await fundUsdc(e, usdcMint, b.publicKey, funding);

    // Priced on the FIRST member only. The last join activates the pool
    // (and on a sorteio pool would also carry the auto-draw), so pricing
    // it would conflate two different costs under one label.
    const [first] = await priceOf("join_pool", () =>
      joinMembers(e, pool, [{ member: a, reputationLevel: 1 }]),
    );
    const [second] = await joinMembers(e, pool, [{ member: b, reputationLevel: 1 }]);

    await priceOf("contribute", () => contribute(e, { pool, member: first!, cycle: 0 }));
    await contribute(e, { pool, member: second!, cycle: 0 });

    await priceOf("claim_payout", () => claimPayout(e, { pool, member: first!, cycle: 0 }));

    expect(readings.length, "all four instructions priced").to.equal(4);

    for (const r of readings) {
      const headroomBps = Math.floor(((r.limit - r.cu) / r.limit) * 10_000);
      expect(
        r.cu,
        `${r.ix} consumed ${r.cu.toLocaleString("en-US")} CU but its sender requests only ` +
          `${r.limit.toLocaleString("en-US")} (${r.source}). Raise the limit there, or cut the cost.`,
      ).to.be.at.most(r.limit);
      expect(
        headroomBps,
        `${r.ix} fits ${r.limit.toLocaleString("en-US")} CU with only ` +
          `${(headroomBps / 100).toFixed(1)}% headroom (need ${MIN_HEADROOM_BPS / 100}%). ` +
          `One added CPI pushes it over on a real wallet — raise the limit in ${r.source} ` +
          `or reduce the instruction's cost.`,
      ).to.be.at.least(MIN_HEADROOM_BPS);
    }
  });
});
