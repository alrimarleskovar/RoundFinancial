// Behavioral signals + recommendations for the Insights screen.
// Ported from prototype/components/desktop-more.jsx (DeskInsights).

import type { Tone } from "@/data/carteira";

export type FactorKey =
  | "punctuality"
  | "anticipation"
  | "consistency"
  | "engagement"
  | "diversity";

export interface BehaviorFactor {
  key: FactorKey;
  value: number; // 0-100
  tone: Tone;
}

export const FACTORS: BehaviorFactor[] = [
  { key: "punctuality",  value: 96, tone: "g" },
  { key: "anticipation", value: 78, tone: "t" },
  { key: "consistency",  value: 64, tone: "p" },
  { key: "engagement",   value: 52, tone: "a" },
  { key: "diversity",    value: 40, tone: "r" },
];

export type RecommendationKey = "anticipate" | "diversify" | "complete";

export interface ScoreRecommendation {
  key: RecommendationKey;
  pts: number;
  tone: Tone;
}

export const RECOMMENDATIONS: ScoreRecommendation[] = [
  { key: "anticipate", pts: 24, tone: "g" },
  { key: "diversify",  pts: 18, tone: "t" },
  { key: "complete",   pts: 42, tone: "p" },
];

// Synthetic 7-month score curve (relative coords on a 0-220 SVG).
// Each entry is a (x, y) pair in viewBox space; the chart renders
// straight-line segments between them.
export const SCORE_CURVE: ReadonlyArray<readonly [number, number]> = [
  [  0, 190],
  [ 50, 180],
  [100, 170],
  [150, 150],
  [200, 160],
  [250, 130],
  [300, 120],
  [350, 110],
  [400,  90],
  [450,  85],
  [500,  70],
  [550,  60],
  [600,  50],
];

// Last 7 month labels for the x-axis of the chart (most recent last).
export const SCORE_MONTHS_PT = ["Out", "Nov", "Dez", "Jan", "Fev", "Mar", "Abr"];
export const SCORE_MONTHS_EN = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];

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
export function curveForRange(
  range: ScoreRange,
): ReadonlyArray<readonly [number, number]> {
  const months = RANGE_MONTHS[range];
  const totalMonths = SCORE_MONTHS_PT.length;
  const fraction = months / totalMonths;
  const totalPoints = SCORE_CURVE.length;
  const sliceCount = Math.max(2, Math.ceil(totalPoints * fraction));
  const slice = SCORE_CURVE.slice(totalPoints - sliceCount);

  // Rescale x so the slice fills the viewBox.
  const firstX = slice[0]![0];
  const lastX = slice[slice.length - 1]![0];
  const span = lastX - firstX || 1;
  return slice.map(
    ([x, y]) => [((x - firstX) / span) * 600, y] as const,
  );
}

/**
 * Month labels to render under the chart for a given range. Always
 * returns labels aligned to the right edge (most recent month last).
 */
export function monthsForRange(
  range: ScoreRange,
  months: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const count = Math.min(RANGE_MONTHS[range], months.length);
  return months.slice(months.length - count);
}
