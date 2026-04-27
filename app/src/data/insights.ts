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

// Last 7 month labels for the x-axis of the chart.
export const SCORE_MONTHS_PT = ["Out", "Nov", "Dez", "Jan", "Fev", "Mar", "Abr"];
export const SCORE_MONTHS_EN = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];

// Time-range pill on the chart header. The active one is hardcoded
// to "6M" in the prototype; we honor that.
export type ScoreRange = "1M" | "3M" | "6M" | "12M";
export const SCORE_RANGES: ScoreRange[] = ["1M", "3M", "6M", "12M"];
export const DEFAULT_RANGE: ScoreRange = "6M";
