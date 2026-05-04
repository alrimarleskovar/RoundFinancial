/**
 * Matrix → on-chain driver for the L1 ↔ L2 parity test.
 *
 * Translates a `MatrixCell[][]` matrix from `@roundfi/sdk/stressLab`
 * (the same data shape that drives `runSimulation()`) into the ordered
 * sequence of `roundfi-core` instruction calls that produce the same
 * economic outcome on-chain. The whole point: replace the cherry-picked
 * lifecycle.spec scenario with a *matrix-equivalent* on-chain run, so
 * the assertions in `economic_parity.spec.ts` can compare per-member
 * outcomes side-by-side.
 *
 * Cell semantics (mirrors stressLab.ts):
 *   "P" — paid: member contributes the cycle's installment
 *   "C" — contemplated AND paid: member contributes; ALSO claims the
 *         payout at the end of the cycle (default-diagonal: row m
 *         contemplates at column m, but the driver keeps it generic)
 *   "X" — defaulted: settle_default once on the first cycle this cell
 *         appears for the row; subsequent X cells in the same row are
 *         no-ops (already defaulted)
 *   "E" — exited (escape valve): seller lists, fresh-keypair buyer buys
 *         on the first cycle this cell appears for the row; subsequent
 *         E cells in the same row are no-ops (position transferred)
 *
 * Order within a cycle (matches `lifecycle.spec.ts`):
 *   1. settle_default for every newly-X member
 *   2. escape_valve_list + escape_valve_buy for every newly-E member
 *   3. contribute for every still-active member with cell P or C
 *   4. claim_payout for the member whose cell is C in this column
 *
 * Healthy preset note: the matrix has no X or E cells, so phases 1–2
 * are no-ops. Driver still walks them for forward-compat with the
 * Pre-default / Post-default / Cascade presets that follow in later PRs.
 */

import { Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { MatrixCell } from "@roundfi/sdk/stressLab";

import type { Env } from "./env.js";
import type { PoolHandle, MemberHandle } from "./pool.js";
import {
  contribute,
  claimPayout,
  settleDefault,
  escapeValveList,
  escapeValveBuy,
} from "./actions.js";
import { fundUsdc } from "./mint.js";
import { ensureFunded } from "./airdrop.js";

// ─── Per-cycle phase result (handy for assertions) ────────────────────

export interface CycleSummary {
  cycle: number;
  contributed: number[]; // slot indices that paid this cycle
  defaultedNewly: number[]; // slot indices that became X this cycle
  exitedNewly: number[]; // slot indices that became E this cycle
  recipient: number | null; // slot index that claimed payout, or null
}

export interface DriveOpts {
  env: Env;
  pool: PoolHandle;
  members: MemberHandle[];
  matrix: MatrixCell[][];
  /** USDC price for E-cell escape-valve transfers. Defaults to 50% of
   *  pool.creditAmount — irrelevant for Healthy (no E cells) but plumbed
   *  for the post-default suites. */
  escapeValvePriceUsdc?: bigint;
}

/**
 * Run the full simulation matrix end-to-end against `roundfi-core`.
 * Returns a summary per cycle so the spec can do its own deltas.
 *
 * Caller must have already initialized the protocol + created an Active
 * pool + joined `members.length` members. After this returns, every
 * cycle's contributions + payouts have landed; the pool is in
 * `Completed` status. The spec then handles `release_escrow` per member
 * and `close_pool`.
 */
export async function driveMatrix(opts: DriveOpts): Promise<CycleSummary[]> {
  const { env, pool, members, matrix } = opts;
  const N = members.length;
  if (matrix.length !== N) {
    throw new Error(`driveMatrix: matrix has ${matrix.length} rows but pool has ${N} members`);
  }
  if (matrix.some((row) => row.length !== N)) {
    throw new Error(`driveMatrix: matrix is not ${N}×${N}`);
  }

  const summaries: CycleSummary[] = [];

  // Active state per row. Once a member becomes defaulted/exited they
  // stay that way for the rest of the run — matches on-chain semantics
  // (`member.defaulted` is a one-way flip; escape transfers Member PDA
  // ownership and closes the seller's record).
  const defaulted = new Set<number>();
  const exited = new Set<number>();

  for (let cycle = 0; cycle < N; cycle++) {
    const summary: CycleSummary = {
      cycle,
      contributed: [],
      defaultedNewly: [],
      exitedNewly: [],
      recipient: null,
    };

    // ─── Phase 1: settle_default for newly-X members ────────────────
    for (let m = 0; m < N; m++) {
      if (defaulted.has(m) || exited.has(m)) continue;
      if (matrix[m]![cycle] !== "X") continue;
      await settleDefault(env, {
        pool,
        defaulter: members[m]!,
        cycle,
      });
      defaulted.add(m);
      summary.defaultedNewly.push(m);
    }

    // ─── Phase 2: escape_valve_list + buy for newly-E members ───────
    for (let m = 0; m < N; m++) {
      if (defaulted.has(m) || exited.has(m)) continue;
      if (matrix[m]![cycle] !== "E") continue;

      const seller = members[m]!;
      const buyer = Keypair.generate();
      await ensureFunded(env, [buyer], 1);

      const priceUsdc = opts.escapeValvePriceUsdc ?? pool.creditAmount / 2n;

      // Pre-fund the buyer's USDC ATA so the buy transfer can settle.
      const buyerUsdc = await fundUsdc(env, pool.usdcMint, buyer.publicKey, priceUsdc);
      const sellerUsdc = getAssociatedTokenAddressSync(pool.usdcMint, seller.wallet.publicKey);

      const { listing } = await escapeValveList(env, {
        pool,
        seller,
        priceUsdc,
      });
      await escapeValveBuy(env, {
        pool,
        seller,
        buyer,
        buyerUsdc,
        sellerUsdc,
        priceUsdc,
        listing,
      });
      exited.add(m);
      summary.exitedNewly.push(m);
    }

    // ─── Phase 3: contribute for every still-active member ──────────
    for (let m = 0; m < N; m++) {
      if (defaulted.has(m) || exited.has(m)) continue;
      const cell = matrix[m]![cycle];
      if (cell !== "P" && cell !== "C") continue;
      await contribute(env, {
        pool,
        member: members[m]!,
        cycle,
      });
      summary.contributed.push(m);
    }

    // ─── Phase 4: claim_payout for the C-cell row in this column ────
    let recipientRow: number | null = null;
    for (let m = 0; m < N; m++) {
      if (matrix[m]![cycle] === "C") {
        if (defaulted.has(m) || exited.has(m)) continue;
        recipientRow = m;
        break;
      }
    }
    if (recipientRow !== null) {
      await claimPayout(env, {
        pool,
        member: members[recipientRow]!,
        cycle,
      });
      summary.recipient = recipientRow;
    }

    summaries.push(summary);
  }

  return summaries;
}
