// Stress Lab — pure actuarial simulation engine.
// Mirrors what the on-chain roundfi-core program will compute, so the
// /lab route can validate the Triple Shield math against arbitrary
// default scenarios before contracts ship. M1 of the grant roadmap
// uses this module as the reference implementation; M2's Anchor
// programs will run parity tests against runSimulation() outputs.

// Canonical 3-tier ladder per data/score.ts and docs:
// Lv1 Iniciante (50% stake) → Lv2 Comprovado (30%) → Lv3 Veterano (10%, ✦ VIP).
// "VIP" is a visual badge on Lv3, not a separate level.
export type GroupLevel = "Iniciante" | "Comprovado" | "Veterano";
// Matrix cell semantics:
//   P = installment paid that cycle
//   C = contemplation (this row's contemplation cycle, exactly one per row)
//   X = default (calote) — installment unpaid + member exits with penalty
//   E = escape valve — member sells their NFT share on the secondary market.
//       No installment paid this cycle, member exits without penalty,
//       reputation preserved (whitepaper Slide 6 / Maria's case study).
//       Phase 1 lands the type + simulation handler; phase 2 wires the
//       buyer-takeover side and the toggleCell click flow.
export type MatrixCell = "P" | "C" | "X" | "E";
// Member final status:
//   ok          = paid in full, contemplated normally
//   calote_pre  = pre-contemplation default → protocol retains stake + paid installments
//   calote_pos  = post-contemplation default → protocol takes a real loss
//   exited      = sold the NFT share via Escape Valve → no penalty, no loss
export type MemberStatus = "ok" | "calote_pre" | "calote_pos" | "exited";

export interface MemberLedger {
  name: string;
  stakePaid: number;
  installmentsPaid: number;
  /**
   * Cumulative cash sent back to this member by the protocol —
   * upfront payout + escrow drips + stake refund cashback. Same
   * units as `installmentsPaid` so `received - stakePaid -
   * installmentsPaid` is the net position.
   */
  received: number;
  /**
   * Of `received`, how much is stake-refund cashback. Tracked
   * separately so the UI can render "credit released" vs "stake
   * coming back" as distinct rows in the per-member modal. Drip +
   * upfront amounts go to `received - stakeRefunded`.
   */
  stakeRefunded: number;
  status: MemberStatus;
  retained: number;     // protocol-favorable retention (drop-out / negative-loss)
  lossCaused: number;   // damage to the fund (calote pos-contemplação)
}

export interface FrameMetrics {
  collectedInstallments: number;
  kaminoNetYield: number;
  protocolFeeRevenue: number;
  /**
   * Gross cash sitting in the pool. Includes member stakes (which
   * are a *liability* — the protocol owes them back to ok members)
   * and any escrow that hasn't been released yet. By itself this
   * is NOT a solvency signal — see `netSolvency` for that.
   */
  poolBalance: number;
  paidOut: number;
  totalStake: number;
  totalRetained: number;
  totalLoss: number;
  /**
   * Sum of `(credit_owed − credit_received)` across all ok
   * contemplated members at end of cycle. Money the protocol still
   * owes as upfront/drips. At end of pool with healthy members
   * fully drained, this is 0.
   */
  outstandingEscrow: number;
  /**
   * Sum of `(stake − stakeRefunded)` across all ok members. Money
   * the protocol still owes as cashback. At end of pool with
   * healthy refund windows fully covered, this is 0.
   */
  outstandingStakeRefund: number;
  /**
   * Cofre Solidário — independent capital bucket fed by 1% of every
   * paid installment. Whitepaper-defined as the first line of
   * Escudo 3 protection. Earns no yield (segregated).
   */
  solidarityVault: number;
  /**
   * Fundo Garantido — independent capital bucket fed by the yield
   * waterfall after the protocol takes its admin fee. Capped at
   * 150% of one credit notional. Whitepaper-defined as the second
   * line of Escudo 3 protection. Earns no yield (segregated).
   */
  guaranteeFund: number;
  /**
   * 150% of credit. The cap on `guaranteeFund`. Surfaced as a metric
   * so the UI can render a fill bar.
   */
  guaranteeFundCap: number;
  /**
   * Yield distributed to LPs (Anjos de Liquidez) — the bigger
   * slice of the residual after admin fee + guarantee fund fill-up.
   * Already left the protocol's books.
   */
  lpDistribution: number;
  /**
   * Yield distributed to pool participants ("prêmio de paciência")
   * — the smaller slice of the residual. Pure upside for ok members
   * who completed cycles without drama. Already left the protocol's
   * books; counted toward "what the model produced" but not toward
   * solvency.
   */
  participantsDistribution: number;
  /**
   * `poolBalance − outstandingEscrow − outstandingStakeRefund`.
   * Net cash the protocol is sitting on after honoring every open
   * obligation to ok members. The SOLVENT/INSOLVENT verdict
   * derives from this — positive ≡ solvent.
   */
  netSolvency: number;
}

export interface StressLabFrame {
  cycle: number;
  metrics: FrameMetrics;
  ledgerSnapshot: MemberLedger[];
}

export type GroupMaturity = "immature" | "mature";

export interface LevelParams {
  stakePct: number;     // % of credit locked as initial stake
  upfrontPct: number;   // 0..1, share of credit released at contemplation
  escrowPct: number;    // 0..1, share retained in escrow
  /**
   * Months over which the escrow drips out in an *immature* group.
   * Default schedule before the protocol has trust-history with the
   * member's cohort.
   */
  releaseMonths: number;
  /**
   * Months over which the escrow drips out in a *mature* group.
   * Whitepaper-defined acceleration once the protocol can confirm
   * the cohort's reliability — 3/2/1 across Lv1/Lv2/Lv3.
   */
  releaseMonthsMature: number;
}

// Spec: 50/30/10 stake rule + adaptive escrow per level. Mature groups
// drip faster (3/2/1 vs 5/4/3) — selected via StressLabConfig.maturity.
export const LEVEL_PARAMS: Record<GroupLevel, LevelParams> = {
  Iniciante:  { stakePct: 50, upfrontPct: 0.5,  escrowPct: 0.5,  releaseMonths: 5, releaseMonthsMature: 3 },
  Comprovado: { stakePct: 30, upfrontPct: 0.45, escrowPct: 0.55, releaseMonths: 4, releaseMonthsMature: 2 },
  Veterano:   { stakePct: 10, upfrontPct: 0.35, escrowPct: 0.65, releaseMonths: 3, releaseMonthsMature: 1 },
};

export const ALL_NAMES = [
  "Ana", "Bruno", "Clara", "David", "Elena", "Fábio",
  "Gabi", "Hugo", "Igor", "Júlia", "Kaio", "Lara",
  "Malu", "Noah", "Olívia", "Pedro", "Quinn", "Ravi",
  "Sofia", "Theo", "Uma", "Vitor", "Wendy", "Xuxa",
];

export interface StressLabConfig {
  level: GroupLevel;
  members: number;
  /**
   * Total credit (carta) the contemplated member is entitled to,
   * in USDC. This is the primary input the lab UI exposes — the
   * monthly installment is *derived* as `creditAmountUsdc / members`
   * and the cycle count is locked at `members` (one cycle per
   * member, one contemplation per cycle).
   */
  creditAmountUsdc: number;
  kaminoApy: number;    // % annual
  yieldFeePct: number;  // % of yield kept by the protocol as admin fee
  memberNames?: string[];
  /**
   * Group maturity. Drives the escrow release schedule per
   * `LEVEL_PARAMS[level].releaseMonths` (immature) or
   * `releaseMonthsMature` (mature). Defaults to "immature".
   */
  maturity?: GroupMaturity;
}

// ── Matrix helpers ────────────────────────────────────────
export function defaultMatrix(N: number): MatrixCell[][] {
  return Array.from({ length: N }, (_, m) =>
    Array.from({ length: N }, (_, c) => (m === c ? "C" : "P")),
  );
}

// Row m, col c. Position-aware click semantics so the UI can
// reproduce every scenario the whitepaper describes — including the
// load-bearing one: a member contemplated at cycle c₀ who then
// defaults at cycle c₁ > c₀ (post-contemplation default, the case
// `runSimulation` flags as `calote_pos`).
//
// - P  before the row's existing C  →  promote to C (move the
//   contemplation here; clear the previous C in this row + any
//   conflicting C in the same column).
// - P  after the row's existing C   →  X (post-contemplation default
//   starting at this cycle; the C at c₀ is preserved). This is the
//   key fix: previously this path had to go through C, which
//   overwrote the existing contemplation.
// - P  with no C in this row        →  promote to C (first
//   contemplation; clear conflicting C in this column).
// - C                                →  P (cancel the row's
//   contemplation entirely; everything stays as P).
// - X                                →  P (revert from this cycle
//   onward, recovering the row's existing C if it sat before col).
export function toggleCell(
  matrix: MatrixCell[][],
  row: number,
  col: number,
): MatrixCell[][] {
  const N = matrix.length;
  const next = matrix.map((r) => [...r]);
  const current = next[row][col];
  const existingContemplationCol = next[row].findIndex((c) => c === "C");

  if (current === "X") {
    // Revert this cycle and everything after it back to P. Any C
    // sitting before `col` is preserved (X can't appear before its
    // own row's C — that's enforced by the other branches).
    for (let j = col; j < N; j++) next[row][j] = "P";
  } else if (current === "C") {
    // Cancel contemplation. Just turn the cell into P.
    next[row][col] = "P";
  } else if (
    existingContemplationCol >= 0 &&
    col > existingContemplationCol
  ) {
    // P after the existing C → cascade X from `col` onward.
    // Preserves the contemplation at existingContemplationCol so
    // `runSimulation` sees `monthContemplated > 0` and flags this
    // member as `calote_pos`.
    for (let j = col; j < N; j++) next[row][j] = "X";
  } else {
    // P before the row's C (or no C in this row): promote to C.
    // Clear any conflicting C in this column + any earlier C in
    // this row, then mark prior cells as P.
    for (let i = 0; i < N; i++) if (next[i][col] === "C") next[i][col] = "P";
    for (let j = 0; j < N; j++) if (next[row][j] === "C") next[row][j] = "P";
    next[row][col] = "C";
    for (let j = 0; j < col; j++) next[row][j] = "P";
  }

  return next;
}

// Mark a single cell as `E` (Escape Valve) or revert it back to `P`.
//
// Unlike toggleCell(), which is context-aware (P → C, C → P, etc.),
// the escape-valve toggle is intentional and explicit: the user is
// flagging "this member sells their position at this cycle". The
// simulator (`runSimulation`) flips the row's status to `exited` and
// skips downstream installments / escrow drips — no penalty, no loss.
//
// UX hookup: the StressLabClient binds this to Shift+click on a cell
// so power users can mark Escape Valve scenarios without breaking the
// regular toggle flow. Toggle semantics:
//
// - P → E   (mark this cycle as the escape moment)
// - C → E   (member was contemplated then sold the share — valid case)
// - X → E   (revert default and convert to clean exit)
// - E → P   (cancel the escape; row reverts to P from this cycle on)
export function toggleCellEscape(
  matrix: MatrixCell[][],
  row: number,
  col: number,
): MatrixCell[][] {
  const N = matrix.length;
  const next = matrix.map((r) => [...r]);
  const current = next[row][col];

  if (current === "E") {
    // Cancel escape. Revert this cell + downstream cycles to P, but
    // preserve any C that sits before col in the same row.
    for (let j = col; j < N; j++) next[row][j] = "P";
  } else {
    next[row][col] = "E";
  }

  return next;
}

// ── Simulation ─────────────────────────────────────────────
// Pre-calculates every cycle's frame so the UI can step through them
// without any further math (or animate at any speed).
export function runSimulation(
  config: StressLabConfig,
  matrix: MatrixCell[][],
): StressLabFrame[] {
  const N = config.members;
  // Credit (carta) is the primary input. Monthly installment is
  // derived: each of the N members contributes 1/N of the credit
  // per cycle, and there are exactly N cycles (one contemplation
  // per cycle per member).
  const credit = config.creditAmountUsdc;
  const inst = credit / N;
  const params = LEVEL_PARAMS[config.level];
  const stake = credit * (params.stakePct / 100);
  // Mature groups get the accelerated drip schedule (3/2/1 across
  // Lv1/Lv2/Lv3). Default is the immature schedule (5/4/3).
  const releaseMonths =
    config.maturity === "mature"
      ? params.releaseMonthsMature
      : params.releaseMonths;
  const apy = config.kaminoApy;
  const adminFee = config.yieldFeePct;

  const names = (config.memberNames ?? ALL_NAMES).slice(0, N);

  const ledger: MemberLedger[] = names.map((name) => ({
    name,
    stakePaid: stake,
    installmentsPaid: 0,
    received: 0,
    stakeRefunded: 0,
    status: "ok",
    retained: 0,
    lossCaused: 0,
  }));

  // Capital structure (Escudo 3, per whitepaper):
  //   - main float (totalPoolBalance): stake + 99% of installments −
  //     payouts. The deployable bag of cash that earns Kamino yield.
  //   - solidarity vault: 1% of every installment, segregated.
  //   - guarantee fund: filled by the yield waterfall, capped at
  //     150% of credit. Segregated.
  //   - lpDistribution: residual yield after the GF cap is hit.
  // Solvency adds the three protocol-controlled buckets together;
  // lpDistribution is already paid out and doesn't count.
  const SOLIDARITY_FEE_PCT = 0.01;
  const GUARANTEE_FUND_CAP = 1.5 * credit;
  // Yield-waterfall residual split: 65% LPs / 35% participants.
  // LPs (Anjos de Liquidez) provide external capital and earn the
  // bulk of the upside; participants get a "patience prize" carve-out.
  // Whitepaper-aligned ratio; would be a governance parameter on-chain.
  const LP_RESIDUAL_SHARE = 0.65;

  let totalPoolBalance = stake * N;
  let solidarityVault = 0;
  let guaranteeFund = 0;
  let lpDistribution = 0;
  let participantsDistribution = 0;
  let totalNetYield = 0;
  let totalProtocolFeeRevenue = 0;
  let totalInstallments = 0;
  let totalPaidOut = 0;
  let totalRetained = 0;
  let totalLoss = 0;

  const frames: StressLabFrame[] = [];

  for (let c = 1; c <= N; c++) {
    let cycleInstallments = 0;
    let cyclePaidOut = 0;

    for (let m = 0; m < N; m++) {
      const action = matrix[m][c - 1];

      // Find the cycle in which member m gets contemplated (if at all).
      let monthContemplated = -1;
      for (let i = 0; i < N; i++) {
        if (matrix[m][i] === "C") monthContemplated = i + 1;
      }

      // Hoisted: payout split for this member's contemplation. Both
      // the per-cycle payout block AND the X-action default-seizure
      // block read these. Computed once per (m, c) so future tweaks
      // happen in one place.
      const upfrontTotal =
        monthContemplated === 1 ? 2 * inst : credit * params.upfrontPct;
      const escrowTotal =
        monthContemplated === 1 ? credit - upfrontTotal : credit * params.escrowPct;
      const escrowPerMonth = escrowTotal / releaseMonths;
      const refundMonths = N - monthContemplated - releaseMonths;
      const refundPerMonth = refundMonths > 0 ? stake / refundMonths : 0;

      if (action === "P" || action === "C") {
        cycleInstallments += inst;
        ledger[m].installmentsPaid += inst;
      }

      if (
        monthContemplated > 0 &&
        monthContemplated <= c &&
        ledger[m].status === "ok" &&
        action !== "X" &&
        action !== "E"
      ) {
        // Whitepaper rule: the installment first unlocks that
        // month's escrow drip; once the escrow is fully drained,
        // the next installments unlock the stake refund (cashback).
        // Default at cycle c (action=X) skips the entire payout —
        // the X branch below then marks calote_pos so future cycles
        // also skip.
        let payoutThisMonth = 0;
        let refundThisMonth = 0;

        if (c === monthContemplated) {
          payoutThisMonth = upfrontTotal;
        } else if (
          c > monthContemplated &&
          c - monthContemplated <= releaseMonths
        ) {
          payoutThisMonth = escrowPerMonth;
        } else if (
          c > monthContemplated + releaseMonths &&
          refundPerMonth > 0
        ) {
          refundThisMonth = refundPerMonth;
        }

        if (payoutThisMonth > 0 || refundThisMonth > 0) {
          const total = payoutThisMonth + refundThisMonth;
          cyclePaidOut += total;
          ledger[m].received += total;
          ledger[m].stakeRefunded += refundThisMonth;
        }
      }

      if (action === "X" && ledger[m].status === "ok") {
        const paidSoFar = ledger[m].stakePaid + ledger[m].installmentsPaid;

        if (monthContemplated === -1 || c <= monthContemplated) {
          // Pre-contemplation default: protocol keeps everything.
          ledger[m].status = "calote_pre";
          ledger[m].retained = paidSoFar;
          totalRetained += paidSoFar;
        } else {
          // Post-contemplation default: TWO ledger entries flow at default
          // time, both real cashflows the whitepaper accounts for:
          //
          //   (a) lossCaused — net cash the member walked away with.
          //       received_so_far − paid_so_far. This is "damage" to the
          //       float because the cash already left the pool.
          //
          //   (b) retained — the seizure leg. At default, the protocol
          //       claws back the un-dripped escrow (the share of credit
          //       that was scheduled to drip in future cycles but never
          //       did) AND the un-refunded stake (the stake collateral
          //       that was earmarked to be returned to the member after
          //       all drips complete). Both of these are forfeit on
          //       default and offset the (a) loss in solvency math.
          //
          // Without this seizure leg, `totalRetained` would only count
          // the rare case of `received < paid`, which never happens for a
          // post-contemplation default by definition (the upfront alone
          // exceeds installments paid). The whitepaper's "Triple Veteran
          // Default produces 3 calotes + positive solvency" claim relies
          // on the seizure side cancelling the loss side.
          ledger[m].status = "calote_pos";
          const diff = ledger[m].received - paidSoFar;
          if (diff > 0) {
            ledger[m].lossCaused = diff;
            totalLoss += diff;
          }

          // Escrow seizure: full escrow minus the part already dripped
          // to the member pre-default. `received` aggregates upfront +
          // escrow drips + stake refund; subtracting upfront + the
          // tracked stake refund isolates how much escrow has dripped.
          const escrowDrippedToMember = Math.max(
            0,
            ledger[m].received - upfrontTotal - ledger[m].stakeRefunded,
          );
          const escrowSeized = Math.max(
            0,
            escrowTotal - escrowDrippedToMember,
          );

          // Stake seizure: any stake not yet refunded is forfeit. For the
          // canonical post-contemplation default (default before refund
          // window opens), this is the full stake.
          const stakeSeized = Math.max(0, stake - ledger[m].stakeRefunded);

          const totalSeized = escrowSeized + stakeSeized;
          ledger[m].retained = totalSeized;
          totalRetained += totalSeized;

          // If `diff <= 0` (i.e. member paid more than received — only
          // possible if they defaulted DURING the escrow drip phase
          // before fully recovering their upfront-equivalent), credit the
          // surplus to retained as well — same convention as before.
          if (diff <= 0) {
            ledger[m].retained += Math.abs(diff);
            totalRetained += Math.abs(diff);
          }
        }
      }

      if (action === "E" && ledger[m].status === "ok") {
        // Escape Valve: member sells the NFT share. They exit without
        // penalty; the protocol does NOT register a loss (a buyer
        // assumes the position in production). Phase 1 just locks the
        // member in `exited` state so their future installments and
        // escrow drips are skipped. Phase 2 wires the buyer-takeover
        // continuation into the same row's downstream cycles.
        ledger[m].status = "exited";
      }
    }

    totalInstallments += cycleInstallments;
    totalPaidOut += cyclePaidOut;
    // Installments split 99/1: 1% to Cofre Solidário, 99% stays in
    // the float to fund payouts and earn yield.
    const cycleSolidarityFeed = cycleInstallments * SOLIDARITY_FEE_PCT;
    solidarityVault += cycleSolidarityFeed;
    totalPoolBalance += cycleInstallments - cycleSolidarityFeed - cyclePaidOut;

    if (totalPoolBalance > 0) {
      const cycleGrossYield = (totalPoolBalance * (apy / 100)) / 12;
      const cycleProtocolFee = cycleGrossYield * (adminFee / 100);
      const cycleNetYield = cycleGrossYield - cycleProtocolFee;

      totalProtocolFeeRevenue += cycleProtocolFee;
      totalNetYield += cycleNetYield;

      // Yield waterfall (Escudo 3, second tier): fill the Guarantee
      // Fund up to its 150%-of-credit cap, then route the residual
      // to LPs/participants. The yield no longer reinforces the
      // float — it's diverted to segregated buckets so the
      // protocol's solvency math doesn't compound on user stakes.
      const gfGap = Math.max(0, GUARANTEE_FUND_CAP - guaranteeFund);
      const toGuaranteeFund = Math.min(cycleNetYield, gfGap);
      guaranteeFund += toGuaranteeFund;
      const residual = cycleNetYield - toGuaranteeFund;
      const toLp = residual * LP_RESIDUAL_SHARE;
      const toParticipants = residual - toLp;
      lpDistribution += toLp;
      participantsDistribution += toParticipants;
    }

    // ── Outstanding obligations to ok members ──
    // Stake refund pending: every ok member is owed `stake −
    // stakeRefunded`. Escrow pending: every ok contemplated
    // member is owed `credit − (received − stakeRefunded)`. The
    // simulator's verdict (SOLVENT vs INSOLVENT) uses
    // `poolBalance − these` so the headline doesn't hide a stake
    // liability behind gross cash.
    let outstandingStakeRefund = 0;
    let outstandingEscrow = 0;
    for (let m = 0; m < N; m++) {
      if (ledger[m].status !== "ok") continue;
      outstandingStakeRefund += stake - ledger[m].stakeRefunded;

      let monthContemplated = -1;
      for (let i = 0; i < N; i++) {
        if (matrix[m][i] === "C") monthContemplated = i + 1;
      }
      if (monthContemplated > 0) {
        const creditReceived = ledger[m].received - ledger[m].stakeRefunded;
        outstandingEscrow += Math.max(0, credit - creditReceived);
      }
    }
    // Net solvency now sums *all* protocol-controlled assets
    // (float + solidarity + guarantee fund) and subtracts the
    // outstanding obligations to ok members. lpDistribution is
    // already paid out and doesn't count.
    const netSolvency =
      totalPoolBalance +
      solidarityVault +
      guaranteeFund -
      outstandingEscrow -
      outstandingStakeRefund;

    frames.push({
      cycle: c,
      metrics: {
        collectedInstallments: totalInstallments,
        kaminoNetYield: totalNetYield,
        protocolFeeRevenue: totalProtocolFeeRevenue,
        poolBalance: totalPoolBalance,
        paidOut: totalPaidOut,
        totalStake: stake * N,
        totalRetained,
        totalLoss,
        outstandingEscrow,
        outstandingStakeRefund,
        solidarityVault,
        guaranteeFund,
        guaranteeFundCap: GUARANTEE_FUND_CAP,
        lpDistribution,
        participantsDistribution,
        netSolvency,
      },
      // Deep clone so future cycles can't retroactively mutate snapshots.
      ledgerSnapshot: ledger.map((l) => ({ ...l })),
    });
  }

  return frames;
}

export function emptyFrame(): StressLabFrame {
  return {
    cycle: 0,
    metrics: {
      collectedInstallments: 0,
      kaminoNetYield: 0,
      protocolFeeRevenue: 0,
      poolBalance: 0,
      paidOut: 0,
      totalStake: 0,
      totalRetained: 0,
      totalLoss: 0,
      outstandingEscrow: 0,
      outstandingStakeRefund: 0,
      solidarityVault: 0,
      guaranteeFund: 0,
      guaranteeFundCap: 0,
      lpDistribution: 0,
      participantsDistribution: 0,
      netSolvency: 0,
    },
    ledgerSnapshot: [],
  };
}

// ── Scenario presets ───────────────────────────────────────
// Canonical fixtures the /lab UI exposes as one-click scenarios.
// Same fixtures will drive the parity tests against roundfi-core
// in M1 — running each preset through runSimulation() and through
// the Anchor program must produce identical FrameMetrics.

export type PresetId =
  | "healthy"
  | "preDefault"
  | "postDefault"
  | "cascade"
  | "tripleVeteranDefault";

export interface ScenarioPreset {
  id: PresetId;
  config: Omit<StressLabConfig, "memberNames">;
  matrix: MatrixCell[][];
}

// Helper: starts from a default-diagonal matrix and applies X bursts.
// Each burst: row defaults from `cycle` onward (1-indexed cycle).
function withDefaults(
  N: number,
  defaults: Array<{ row: number; cycle: number }>,
): MatrixCell[][] {
  const m = defaultMatrix(N);
  for (const { row, cycle } of defaults) {
    for (let j = cycle - 1; j < N; j++) m[row][j] = "X";
  }
  return m;
}

const BASE_CONFIG = {
  // Lv2 Comprovado (30% stake) is the canonical mid-ladder default —
  // demonstrates the protocol's middle of the leverage curve without
  // committing to either extreme. Credit (carta) of 12,000 USDC over
  // 12 members → derived installment of 1,000 USDC/cycle.
  level: "Comprovado" as GroupLevel,
  members: 12,
  creditAmountUsdc: 12000,
  kaminoApy: 6.5,
  yieldFeePct: 20,
};

export const PRESETS: Record<PresetId, ScenarioPreset> = {
  healthy: {
    id: "healthy",
    config: BASE_CONFIG,
    matrix: defaultMatrix(12),
  },
  // Member 4 (Elena, would be C at cycle 5) drops out at cycle 3.
  // Pre-contemplation default → protocol retains stake + paid installments.
  preDefault: {
    id: "preDefault",
    config: BASE_CONFIG,
    matrix: withDefaults(12, [{ row: 4, cycle: 3 }]),
  },
  // Member 1 (Bruno, contemplated at cycle 2) defaults at cycle 5
  // after receiving the upfront. Protocol takes a real loss.
  postDefault: {
    id: "postDefault",
    config: BASE_CONFIG,
    matrix: withDefaults(12, [{ row: 1, cycle: 5 }]),
  },
  // Three rolling defaults — pre-contemplation cluster.
  cascade: {
    id: "cascade",
    config: BASE_CONFIG,
    matrix: withDefaults(12, [
      { row: 5, cycle: 4 },
      { row: 7, cycle: 5 },
      { row: 9, cycle: 6 },
    ]),
  },
  // Canonical whitepaper stress test: 24-member Veteran pool, $10k carta,
  // three contemplated members (cycles 2/3/4) default *after* receiving
  // their upfront. This is the scenario the pitch deck quotes:
  //   passivo bruto = 3 × $10,000 = -$30,000
  //   ↓ recovery via:
  //     escrow retained (65% × 3 × credit) = +$19,500
  //     stake slashed   (3 × 10% × credit) =  +$3,000
  //     cycle-1 cushion (Sorteio Semente)  =  +$9,152
  //     solidarity vault + yield           =  +$2,500
  //     net = +$4,152 (solvent by construction)
  // Used to verify the L1 simulator produces the canonical outcome.
  tripleVeteranDefault: {
    id: "tripleVeteranDefault",
    config: {
      level: "Veterano",
      members: 24,
      creditAmountUsdc: 10_000,
      kaminoApy: 6.5,
      yieldFeePct: 20,
    },
    // Members 1, 2, 3 are contemplated at cycles 2, 3, 4 respectively
    // (default diagonal: row m → C at column m). They default at the
    // cycle right after their upfront — the canonical "post-
    // contemplation default after receiving payout" scenario.
    matrix: withDefaults(24, [
      { row: 1, cycle: 3 },
      { row: 2, cycle: 4 },
      { row: 3, cycle: 5 },
    ]),
  },
};

export const PRESET_ORDER: PresetId[] = [
  "healthy",
  "preDefault",
  "postDefault",
  "cascade",
  "tripleVeteranDefault",
];
