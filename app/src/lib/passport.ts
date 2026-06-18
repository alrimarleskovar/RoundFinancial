// Shared SAS reputation ladder — one 0-1000 score scale with four tiers
// (mirrors the thresholds in lib/session.tsx). Both the home SAS passport
// and the big /reputacao passport read from here, so their bars stay
// proportional to the same tier-4 scale instead of drifting apart.

export const PASSPORT_MAX_SCORE = 1000;

export const PASSPORT_TIERS = [
  { level: 1, min: 0 },
  { level: 2, min: 500 },
  { level: 3, min: 750 },
  { level: 4, min: 950 },
];

// Tier-name dict keys by level (reuses the shared level.* strings).
export const TIER_KEYS = ["", "level.beginner", "level.provenName", "level.veteran", "level.elite"];

// The tier a score currently sits in (the highest threshold it clears).
export function tierForScore(score: number): (typeof PASSPORT_TIERS)[number] {
  return [...PASSPORT_TIERS].reverse().find((t) => score >= t.min) ?? PASSPORT_TIERS[0];
}

// Score as a clamped 0-100% of the full tier-4 scale, for bar widths.
export function scorePct(score: number): number {
  return Math.max(0, Math.min(100, (score / PASSPORT_MAX_SCORE) * 100));
}
