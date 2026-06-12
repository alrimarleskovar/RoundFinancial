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
  skipDefaultedPayout,
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
  /** Optional hook run immediately BEFORE each `settle_default` (Phase 1),
   *  with the (0-indexed) cycle + defaulter slot. Used by the litesvm
   *  parity scenarios to warp the clock past the 7-day grace window
   *  (`settle_default` requires `clock >= next_cycle_at + GRACE_PERIOD_SECS`).
   *  Default: no-op (bankrun/localnet healthy path unaffected). */
  beforeSettle?: (cycle: number, slot: number) => Promise<void>;
  /** Optional hook run immediately AFTER each `settle_default`. The litesvm
   *  scenarios use it to RESTORE the clock that `beforeSettle` warped past
   *  the grace window — otherwise every later `contribute` is on-chain LATE
   *  (clock > next_cycle_at), which makes the program write a SCHEMA_LATE
   *  attestation whose PDA the on-time-PAYMENT harness path doesn't match. */
  afterSettle?: (cycle: number, slot: number) => Promise<void>;
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
  // Pass-3 (Caio HIGH, 2026-06-12): tracks each row's contribution
  // count so we can flag the LAST contribution (the one that triggers
  // POOL_COMPLETE on-chain) — the helper needs `isFinalInstallment` so
  // the attestation PDA derives with `SCHEMA_POOL_COMPLETE` instead of
  // `SCHEMA_PAYMENT`. Otherwise Anchor rejects with ConstraintSeeds.
  const contributionsPaid = new Array<number>(N).fill(0);
  const cyclesTotal = N;

  for (let cycle = 0; cycle < N; cycle++) {
    const summary: CycleSummary = {
      cycle,
      contributed: [],
      defaultedNewly: [],
      exitedNewly: [],
      recipient: null,
    };

    // ─── Phase 1: settle_default for members now BEHIND ─────────────
    // On-chain `settle_default` requires `member.contributions_paid <
    // pool.current_cycle` (MemberNotBehind) AND `args.cycle ==
    // current_cycle`. A member who skips cycle j (cell X) is NOT yet
    // behind during cycle j — they only become behind once the cycle-j
    // claim advances current_cycle to j+1. So we settle on the cycle
    // AFTER the first skipped cycle, with args.cycle == this loop cycle
    // (== on-chain current_cycle). Verified shape: edge_grace_default
    // settles with contributions_paid=1, current_cycle=2, args.cycle=2.
    for (let m = 0; m < N; m++) {
      if (defaulted.has(m) || exited.has(m)) continue;
      if (cycle === 0) continue; // nobody is behind before a cycle advances
      if (matrix[m]![cycle - 1] !== "X") continue; // didn't skip the prior cycle
      if (opts.beforeSettle) await opts.beforeSettle(cycle, m);
      await settleDefault(env, { pool, defaulter: members[m]!, cycle });
      if (opts.afterSettle) await opts.afterSettle(cycle, m);
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
      const isFinalInstallment = contributionsPaid[m]! + 1 === cyclesTotal;
      await contribute(env, {
        pool,
        member: members[m]!,
        cycle,
        isFinalInstallment,
      });
      contributionsPaid[m]! += 1;
      summary.contributed.push(m);
    }

    // ─── Phase 4: advance the cycle ─────────────────────────────────
    // The contemplated slot for cycle `cycle` is slot `cycle` (claim_payout
    // enforces slot_index == cycle). If that member defaulted PRE-
    // contemplation, claim_payout is blocked (it requires !defaulted) and the
    // pool would lock — advance permissionlessly via skip_defaulted_payout
    // (no payout; forfeited pot stays in the float). Otherwise the C-cell
    // member claims normally.
    if (defaulted.has(cycle)) {
      await skipDefaultedPayout(env, { pool, defaulter: members[cycle]!, cycle });
    } else {
      let recipientRow: number | null = null;
      for (let m = 0; m < N; m++) {
        if (matrix[m]![cycle] === "C") {
          if (defaulted.has(m) || exited.has(m)) continue;
          recipientRow = m;
          break;
        }
      }
      if (recipientRow !== null) {
        await claimPayout(env, { pool, member: members[recipientRow]!, cycle });
        summary.recipient = recipientRow;
      }
    }

    summaries.push(summary);
  }

  return summaries;
}
