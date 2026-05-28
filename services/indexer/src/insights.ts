/**
 * Insights v0 analytical primitives (ADR 0010).
 *
 * Four PRE-DEFINED views — retention by level, default predictor, L1→L2→L3
 * progression, behavioral improvement — each with a documented sample-size
 * gate. We never render an analytic number below the threshold (no fishing
 * for a story in 9 wallets).
 *
 * All timing semantics flow from `sdk/src/behavioral.ts`: on-time is
 * `delta_seconds ≤ 0`, grace is `grace_used = true`. The Insights surface
 * is a re-aggregation of the existing event/member tables — it never
 * re-derives "on time" — so the admin can never tell a different story
 * than the chain.
 *
 * 95% CIs are Wilson score (honest near 0 and 1; Wald would lie there).
 */

import type { PrismaClient } from "@prisma/client";

/** Per-view thresholds — pinned in ADR 0010 §2. Any change is an
 *  amendment, not a feature flag. Lowering them requires explicit
 *  justification (defense against p-hacking). */
export const INSIGHTS_THRESHOLDS = {
  /** Retention by level: N ≥ 30 distinct members PER cohort (L1, L2, L3). */
  retentionPerCohort: 30,
  /** Default predictor: N ≥ 100 distinct wallets total. */
  predictorTotalWallets: 100,
  /** Progression: N ≥ 50 distinct wallets with ≥ 1 completed pool. */
  progressionEligibleWallets: 50,
  /** Improvement: N ≥ 30 distinct wallets with ≥ 3 pool memberships. */
  improvementEligibleWallets: 30,
} as const;

/** `insufficient` is non-negotiable: API serves null metrics, UI shows
 *  progress toward the threshold instead of a number. `preliminary` is
 *  N ∈ [T, 2T). `significant` is N ≥ 2T. */
export type SampleStatus = "insufficient" | "preliminary" | "significant";

/** Classify a sample of size `n` against the view's threshold. */
export function classifySample(n: number, threshold: number): SampleStatus {
  if (n < threshold) return "insufficient";
  if (n < threshold * 2) return "preliminary";
  return "significant";
}

/** 95% Wilson score interval for a proportion `successes / n`, returned
 *  as `[loBps, hiBps]` (basis points to match the rest of the admin
 *  surface). Honest near 0 and 1 — Wald would yield bounds outside
 *  [0,1] there. `null` when `n = 0`. */
export function wilson95Bps(successes: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const halfwidth = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const lo = Math.max(0, center - halfwidth);
  const hi = Math.min(1, center + halfwidth);
  return [Math.round(lo * 10_000), Math.round(hi * 10_000)];
}

function rateBps(num: number, denom: number): number | null {
  return denom > 0 ? Math.round((num / denom) * 10_000) : null;
}

// ── 1. Retention by level ──────────────────────────────────────────────

export interface RetentionCohort {
  level: 1 | 2 | 3;
  n: number;
  status: SampleStatus;
  /** Null when status === "insufficient". */
  completedShareBps: number | null;
  /** 95% Wilson CI in bps. Null when status === "insufficient" or n = 0. */
  completedCi95Bps: [number, number] | null;
  defaultedShareBps: number | null;
  defaultedCi95Bps: [number, number] | null;
}

export interface RetentionView {
  threshold: number;
  cohorts: RetentionCohort[];
}

export async function retentionByLevel(prisma: PrismaClient): Promise<RetentionView> {
  const members = await prisma.member.findMany({
    select: { reputationLevel: true, paidOut: true, defaulted: true },
  });
  const tally: Record<1 | 2 | 3, { n: number; completed: number; defaulted: number }> = {
    1: { n: 0, completed: 0, defaulted: 0 },
    2: { n: 0, completed: 0, defaulted: 0 },
    3: { n: 0, completed: 0, defaulted: 0 },
  };
  for (const m of members) {
    // Member.reputationLevel is the on-chain snapshot the program wrote at
    // join time (programs/roundfi-core/src/instructions/join_pool.rs ::
    // derive_trusted_reputation_level). When the wallet has no
    // ReputationProfile PDA yet, the program defaults to L1 — so an
    // unhydrated reputation surface still surfaces every member as L1 here
    // (consistent with the IDL-free reader). 0 is mapped to L1 too as
    // belt-and-suspenders against any future "level unset" sentinel; >3 to
    // L3. Indexer never reads ReputationProfile directly; the L1 default
    // is documented in ADR 0010 §4 as a follow-up to hydrate that PDA.
    const lv = (m.reputationLevel <= 1 ? 1 : m.reputationLevel >= 3 ? 3 : 2) as 1 | 2 | 3;
    tally[lv].n += 1;
    if (m.paidOut) tally[lv].completed += 1;
    if (m.defaulted) tally[lv].defaulted += 1;
  }
  const threshold = INSIGHTS_THRESHOLDS.retentionPerCohort;
  const cohorts: RetentionCohort[] = ([1, 2, 3] as const).map((lv) => {
    const t = tally[lv];
    const status = classifySample(t.n, threshold);
    const cleared = status !== "insufficient";
    return {
      level: lv,
      n: t.n,
      status,
      completedShareBps: cleared ? rateBps(t.completed, t.n) : null,
      completedCi95Bps: cleared ? wilson95Bps(t.completed, t.n) : null,
      defaultedShareBps: cleared ? rateBps(t.defaulted, t.n) : null,
      defaultedCi95Bps: cleared ? wilson95Bps(t.defaulted, t.n) : null,
    };
  });
  return { threshold, cohorts };
}

// ── 2. Default predictor (cohort comparison, no ML) ────────────────────

export interface PredictorBucket {
  /** Pre-defined feature key — see ADR 0010 §3.2. Adding a new key is an
   *  amendment, not a feature; this enum is the discipline against
   *  p-hacking. */
  feature: "late_gte_1" | "grace_used_gte_1" | "late_gte_2";
  withFeature: number;
  withFeatureDefaultRateBps: number | null;
  withFeatureCi95Bps: [number, number] | null;
  withoutFeature: number;
  withoutFeatureDefaultRateBps: number | null;
  withoutFeatureCi95Bps: [number, number] | null;
}

export interface PredictorView {
  threshold: number;
  totalWallets: number;
  status: SampleStatus;
  /** Overall default rate across all observed wallets (baseline for the
   *  chart). Null when status === "insufficient". */
  overallDefaultRateBps: number | null;
  /** Empty array when status === "insufficient". */
  buckets: PredictorBucket[];
}

interface WalletAgg {
  late: number;
  grace: number;
  defaulted: boolean;
}

export async function defaultPredictor(prisma: PrismaClient): Promise<PredictorView> {
  // Wallets are sampled from the `Member` table so a wallet with no
  // events (joined, never contributed, never defaulted) still counts as
  // a no-feature observation — otherwise the denominator becomes whoever
  // contributed, which biases the no-feature cohort.
  const [members, events] = await Promise.all([
    prisma.member.findMany({ select: { wallet: true, defaulted: true } }),
    prisma.event.findMany({
      where: { eventType: { in: ["Contribute", "Default"] } },
      select: { subjectWallet: true, eventType: true, deltaSeconds: true, graceUsed: true },
    }),
  ]);
  const byWallet = new Map<string, WalletAgg>();
  for (const m of members) {
    const a = byWallet.get(m.wallet) ?? { late: 0, grace: 0, defaulted: false };
    if (m.defaulted) a.defaulted = true;
    byWallet.set(m.wallet, a);
  }
  for (const e of events) {
    const a = byWallet.get(e.subjectWallet) ?? { late: 0, grace: 0, defaulted: false };
    if (e.eventType === "Default") {
      a.defaulted = true;
    } else if (e.eventType === "Contribute" && e.deltaSeconds != null && e.deltaSeconds > 0) {
      a.late += 1;
      if (e.graceUsed) a.grace += 1;
    }
    byWallet.set(e.subjectWallet, a);
  }
  const totalWallets = byWallet.size;
  const threshold = INSIGHTS_THRESHOLDS.predictorTotalWallets;
  const status = classifySample(totalWallets, threshold);
  if (status === "insufficient") {
    return { threshold, totalWallets, status, overallDefaultRateBps: null, buckets: [] };
  }
  const wallets = [...byWallet.values()];
  const overallDefaultRateBps = rateBps(wallets.filter((a) => a.defaulted).length, wallets.length);
  const make = (
    feature: PredictorBucket["feature"],
    has: (a: WalletAgg) => boolean,
  ): PredictorBucket => {
    const yes = wallets.filter(has);
    const no = wallets.filter((a) => !has(a));
    const yesDef = yes.filter((a) => a.defaulted).length;
    const noDef = no.filter((a) => a.defaulted).length;
    return {
      feature,
      withFeature: yes.length,
      withFeatureDefaultRateBps: rateBps(yesDef, yes.length),
      withFeatureCi95Bps: wilson95Bps(yesDef, yes.length),
      withoutFeature: no.length,
      withoutFeatureDefaultRateBps: rateBps(noDef, no.length),
      withoutFeatureCi95Bps: wilson95Bps(noDef, no.length),
    };
  };
  const buckets: PredictorBucket[] = [
    make("late_gte_1", (a) => a.late >= 1),
    make("grace_used_gte_1", (a) => a.grace >= 1),
    make("late_gte_2", (a) => a.late >= 2),
  ];
  return { threshold, totalWallets, status, overallDefaultRateBps, buckets };
}

// ── 3. L1→L2→L3 progression ────────────────────────────────────────────

export interface ProgressionView {
  threshold: number;
  /** Distinct wallets with ≥ 1 completed pool (`Member.paidOut = true`). */
  eligibleWallets: number;
  status: SampleStatus;
  /** Share that ever reached `Member.reputationLevel ≥ 2` (bps). */
  reachedL2ShareBps: number | null;
  reachedL2Ci95Bps: [number, number] | null;
  reachedL3ShareBps: number | null;
  reachedL3Ci95Bps: [number, number] | null;
  /** Mean memberships before the first L2 (or L3) snapshot, 1 decimal. */
  avgPoolsToL2: number | null;
  avgPoolsToL3: number | null;
}

export async function progression(prisma: PrismaClient): Promise<ProgressionView> {
  const members = await prisma.member.findMany({
    select: { wallet: true, reputationLevel: true, paidOut: true, joinedAt: true },
    orderBy: { joinedAt: "asc" },
  });
  interface W {
    hasCompleted: boolean;
    levels: number[];
  }
  const byWallet = new Map<string, W>();
  for (const m of members) {
    const w = byWallet.get(m.wallet) ?? { hasCompleted: false, levels: [] };
    w.levels.push(m.reputationLevel);
    if (m.paidOut) w.hasCompleted = true;
    byWallet.set(m.wallet, w);
  }
  const eligible = [...byWallet.values()].filter((w) => w.hasCompleted);
  const eligibleWallets = eligible.length;
  const threshold = INSIGHTS_THRESHOLDS.progressionEligibleWallets;
  const status = classifySample(eligibleWallets, threshold);
  if (status === "insufficient") {
    return {
      threshold,
      eligibleWallets,
      status,
      reachedL2ShareBps: null,
      reachedL2Ci95Bps: null,
      reachedL3ShareBps: null,
      reachedL3Ci95Bps: null,
      avgPoolsToL2: null,
      avgPoolsToL3: null,
    };
  }
  const reachedL2 = eligible.filter((w) => w.levels.some((lv) => lv >= 2));
  const reachedL3 = eligible.filter((w) => w.levels.some((lv) => lv >= 3));
  const meanPoolsToReach = (level: number): number | null => {
    const reached = eligible.filter((w) => w.levels.some((lv) => lv >= level));
    if (reached.length === 0) return null;
    let sum = 0;
    for (const w of reached) {
      const idx = w.levels.findIndex((lv) => lv >= level);
      sum += idx + 1; // 1-indexed: "1 pool to L2" means the first join was already L2
    }
    return Math.round((sum / reached.length) * 10) / 10;
  };
  return {
    threshold,
    eligibleWallets,
    status,
    reachedL2ShareBps: rateBps(reachedL2.length, eligibleWallets),
    reachedL2Ci95Bps: wilson95Bps(reachedL2.length, eligibleWallets),
    reachedL3ShareBps: rateBps(reachedL3.length, eligibleWallets),
    reachedL3Ci95Bps: wilson95Bps(reachedL3.length, eligibleWallets),
    avgPoolsToL2: meanPoolsToReach(2),
    avgPoolsToL3: meanPoolsToReach(3),
  };
}

// ── 4. Behavioral improvement (on-time rate by pool ordinal) ───────────

export interface ImprovementOrdinalBucket {
  /** 1 = first pool joined, 2 = second, "3+" collapsed to 3. */
  ordinal: 1 | 2 | 3;
  /** Distinct eligible wallets contributing to this ordinal. */
  walletsAtOrdinal: number;
  onTimeRateBps: number | null;
}

export interface ImprovementView {
  threshold: number;
  eligibleWallets: number;
  status: SampleStatus;
  buckets: ImprovementOrdinalBucket[];
}

export async function behavioralImprovement(prisma: PrismaClient): Promise<ImprovementView> {
  const members = await prisma.member.findMany({
    select: {
      wallet: true,
      joinedAt: true,
      onTimeCount: true,
      lateCount: true,
      contributionsPaid: true,
    },
    orderBy: { joinedAt: "asc" },
  });
  type M = (typeof members)[number];
  const byWallet = new Map<string, M[]>();
  for (const m of members) {
    const arr = byWallet.get(m.wallet) ?? [];
    arr.push(m);
    byWallet.set(m.wallet, arr);
  }
  const eligible = [...byWallet.values()].filter((arr) => arr.length >= 3);
  const eligibleWallets = eligible.length;
  const threshold = INSIGHTS_THRESHOLDS.improvementEligibleWallets;
  const status = classifySample(eligibleWallets, threshold);
  // Always compute walletsAtOrdinal (transparent counter even when
  // insufficient) — the rate is gated. Three buckets only: 1st, 2nd, 3rd+.
  const buckets: ImprovementOrdinalBucket[] = ([1, 2, 3] as const).map((ord) => {
    let onTime = 0;
    let total = 0;
    let walletsAtOrdinal = 0;
    for (const arr of eligible) {
      const idx = ord === 3 ? arr.length - 1 : ord - 1;
      // Bucket 3 = "3rd+ pool"; we take the LAST membership as the
      // farthest-along signal. For 1/2 take the exact ordinal.
      if (ord === 3 && arr.length < 3) continue;
      if (ord !== 3 && idx >= arr.length) continue;
      const m = arr[idx];
      if (!m) continue;
      onTime += m.onTimeCount;
      total += m.lateCount + m.onTimeCount;
      walletsAtOrdinal += 1;
    }
    return {
      ordinal: ord,
      walletsAtOrdinal,
      onTimeRateBps: status === "insufficient" ? null : rateBps(onTime, total),
    };
  });
  return { threshold, eligibleWallets, status, buckets };
}

// ── Top-level entry point ──────────────────────────────────────────────

export interface InsightsResponse {
  retention: RetentionView;
  predictor: PredictorView;
  progression: ProgressionView;
  improvement: ImprovementView;
}

export async function getInsights(prisma: PrismaClient): Promise<InsightsResponse> {
  const [retention, predictor, progressionV, improvement] = await Promise.all([
    retentionByLevel(prisma),
    defaultPredictor(prisma),
    progression(prisma),
    behavioralImprovement(prisma),
  ]);
  return { retention, predictor, progression: progressionV, improvement };
}
