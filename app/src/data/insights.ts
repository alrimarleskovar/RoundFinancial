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
