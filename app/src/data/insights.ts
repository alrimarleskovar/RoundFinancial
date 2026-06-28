// Behavioral signals + recommendations for the Insights screen.
// Ported from prototype/components/desktop-more.jsx (DeskInsights).

import type { Tone } from "@/data/carteira";

export type FactorKey = "punctuality" | "anticipation" | "consistency" | "engagement" | "diversity";

export interface BehaviorFactor {
  key: FactorKey;
  value: number; // 0-100
  tone: Tone;
}

export const FACTORS: BehaviorFactor[] = [
  { key: "punctuality", value: 96, tone: "g" },
  { key: "anticipation", value: 78, tone: "t" },
  { key: "consistency", value: 64, tone: "p" },
  { key: "engagement", value: 52, tone: "a" },
  { key: "diversity", value: 40, tone: "r" },
];

export type RecommendationKey = "anticipate" | "diversify" | "complete";

export interface ScoreRecommendation {
  key: RecommendationKey;
  pts: number;
  tone: Tone;
}

export const RECOMMENDATIONS: ScoreRecommendation[] = [
  { key: "anticipate", pts: 24, tone: "g" },
  { key: "diversify", pts: 18, tone: "t" },
  { key: "complete", pts: 42, tone: "p" },
];

// Synthetic 7-month score curve (relative coords on a 0-220 SVG).
// Each entry is a (x, y) pair in viewBox space; the chart renders
// straight-line segments between them.
export const SCORE_CURVE: ReadonlyArray<readonly [number, number]> = [
  [0, 190],
  [50, 180],
  [100, 170],
  [150, 150],
  [200, 160],
  [250, 130],
  [300, 120],
  [350, 110],
  [400, 90],
  [450, 85],
  [500, 70],
  [550, 60],
  [600, 50],
];

// 12-month abbreviations (index = JS Date.getMonth(), 0–11) used to build the
// chart's x-axis relative to TODAY so the labels never go stale.
const MONTH_ABBR_PT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];
const MONTH_ABBR_EN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// The synthetic demo curve spans this many months; the x-axis caps here too.
const CURVE_MONTH_SPAN = 7;

/**
 * The last `n` month labels ending at the CURRENT month (most recent last) —
 * e.g. evaluated in June: ["…", "Mai", "Jun"]. Derived from today's date so a
 * "1M" view always lands on the current month instead of a label hardcoded
 * months ago that silently drifts out of date. `n` is clamped to [1, 12].
 */
export function scoreMonths(n: number, lang: "pt" | "en"): string[] {
  const names = lang === "pt" ? MONTH_ABBR_PT : MONTH_ABBR_EN;
  const count = Math.max(1, Math.min(12, n));
  const cur = new Date().getMonth();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(names[(((cur - i) % 12) + 12) % 12]!);
  return out;
}

// Time-range pill on the chart header.
export type ScoreRange = "1M" | "3M" | "6M" | "12M";
export const SCORE_RANGES: ScoreRange[] = ["1M", "3M", "6M", "12M"];
export const DEFAULT_RANGE: ScoreRange = "6M";

// Months back per range. 12M caps at the dataset's total — the
// synthetic curve covers ~7 months, so 12M shows everything.
export const RANGE_MONTHS: Record<ScoreRange, number> = {
  "1M": 1,
  "3M": 3,
  "6M": 6,
  "12M": 7,
};

/**
 * Returns the slice of (x, y) curve points to render for `range`,
 * with x-coordinates rescaled to fill the original viewBox width
 * (0..600). 1M shows ~2 points stretched edge-to-edge; 12M shows
 * the full curve unchanged.
 */
export function curveForRange(range: ScoreRange): ReadonlyArray<readonly [number, number]> {
  const months = RANGE_MONTHS[range];
  const totalMonths = CURVE_MONTH_SPAN;
  const fraction = months / totalMonths;
  const totalPoints = SCORE_CURVE.length;
  const sliceCount = Math.max(2, Math.ceil(totalPoints * fraction));
  const slice = SCORE_CURVE.slice(totalPoints - sliceCount);

  // Rescale x so the slice fills the viewBox.
  const firstX = slice[0]![0];
  const lastX = slice[slice.length - 1]![0];
  const span = lastX - firstX || 1;
  return slice.map(([x, y]) => [((x - firstX) / span) * 600, y] as const);
}

// ─── Real (on-chain) insights ────────────────────────────────────────────────
// The factor breakdown + score curve above are demo fixtures. The helpers below
// derive the REAL versions for a connected wallet straight from the on-chain
// ReputationProfile counters + payment timestamps, so /insights shows actual
// behaviour instead of a fabricated pitch. All pure (no React / RPC) so they're
// unit-tested; the RPC wiring lives in lib/useScoreInsights.ts.

/** The subset of the on-chain ReputationProfile the factor math needs. */
export interface RepCounters {
  exists: boolean;
  onTimePayments: number;
  latePayments: number;
  defaults: number;
  cyclesCompleted: number;
  totalParticipated: number;
}

export type FactorStatus = "excellent" | "good" | "developing" | "improve";

/** Map a 0–100 factor value to the same status ladder the fixtures use. */
export function factorStatusKey(value: number): FactorStatus {
  if (value >= 85) return "excellent";
  if (value >= 65) return "good";
  if (value >= 45) return "developing";
  return "improve";
}

export interface RealFactor extends BehaviorFactor {
  statusKey: FactorStatus;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Real behavioural factors from the on-chain reputation counters. Only factors
 * with a genuine signal are returned (a wallet that never joined a pool gets an
 * empty list → the panel shows its empty-state). NB: "anticipation" (paying
 * EARLY) is intentionally omitted — the program tracks on-time vs late, not how
 * early, so there's no honest source for it yet.
 */
export function computeRealFactors(r: RepCounters): RealFactor[] {
  if (!r.exists || r.totalParticipated <= 0) return [];
  const out: RealFactor[] = [];
  const totalPayments = r.onTimePayments + r.latePayments;
  const push = (key: FactorKey, value: number, tone: Tone) =>
    out.push({ key, value, tone, statusKey: factorStatusKey(value) });

  // Punctuality — the protocol's own on-time rate. Needs ≥1 payment to exist.
  if (totalPayments > 0)
    push("punctuality", clampPct((100 * r.onTimePayments) / totalPayments), "g");
  // Consistency — honoring commitments: full marks minus a heavy hit per
  // default and a smaller one per late payment.
  push("consistency", clampPct(100 - r.defaults * 50 - r.latePayments * 15), "p");
  // Engagement — activity volume (payments + completed cycles weigh double);
  // ~12 payments saturates it.
  push("engagement", clampPct((totalPayments + r.cyclesCompleted * 2) * 8), "a");
  // Diversity — breadth of participation; 4+ pools saturates it.
  push("diversity", clampPct(r.totalParticipated * 25), "t");
  return out;
}

export interface ScorePoint {
  /** Unix ms of the event. */
  t: number;
  score: number;
}

// On-chain SCORE_PAYMENT (programs/roundfi-reputation/src/constants.rs): each
// contribute moves the score by +10.
const SCORE_PER_PAYMENT = 10;

/**
 * Reconstruct a score-over-time curve from the real payment timestamps,
 * anchored so the LAST point equals the wallet's true current on-chain score.
 * Each payment steps the score up; the start point is the score that many
 * payments ago. Pool-completion bonuses / late penalties aren't separately
 * placed — they fold into the baseline so the ENDPOINT is always exact (and the
 * step size degrades gracefully to currentScore/N if penalties pushed the
 * implied start below zero). Returns [] with no payments (→ chart empty-state).
 */
export function reconstructScoreHistory(
  currentScore: number,
  paymentTimesMs: ReadonlyArray<number>,
  startTimeMs: number,
): ScorePoint[] {
  const n = paymentTimesMs.length;
  if (n === 0) return [];
  const sorted = [...paymentTimesMs].sort((a, b) => a - b);
  const start = Math.max(0, currentScore - SCORE_PER_PAYMENT * n);
  const step = (currentScore - start) / n; // = 10 normally; smaller if penalties
  const pts: ScorePoint[] = [{ t: Math.min(startTimeMs || sorted[0]!, sorted[0]!), score: start }];
  sorted.forEach((t, i) => pts.push({ t, score: Math.round(start + step * (i + 1)) }));
  return pts;
}

export interface ScoreScale {
  yMin: number;
  yMax: number;
}

/**
 * A score→y window fitted tightly to the curve (plus padding), so even a small
 * low-score climb is clearly visible — the fixed 500/750/950 guide layout, or
 * forcing a far-off tier target into view, would bury a sub-500 wallet's
 * movement at the bottom. Tier guides are drawn only where a threshold actually
 * falls inside this window; the goal otherwise lives in a caption.
 */
export function scoreScale(points: ReadonlyArray<ScorePoint>): ScoreScale {
  const scores = points.map((p) => p.score);
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  const pad = Math.max(20, (hi - lo) * 0.25);
  return { yMin: Math.max(0, lo - pad), yMax: hi + pad };
}

/** "26 jun" / "Jun 26" — a short day+month label for the real chart's axis. */
export function formatDayMon(ms: number, lang: "pt" | "en"): string {
  const d = new Date(ms);
  const mon = (lang === "pt" ? MONTH_ABBR_PT : MONTH_ABBR_EN)[d.getMonth()] ?? "";
  return lang === "pt" ? `${d.getDate()} ${mon}` : `${mon} ${d.getDate()}`;
}
