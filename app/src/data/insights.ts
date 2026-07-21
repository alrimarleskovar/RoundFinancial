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

/** What moved the score at a given vertex. `join` is the score-0 baseline;
 *  the rest mirror the on-chain attestation schemas that carry a score delta. */
export type ScoreEventKind = "join" | "payment" | "late" | "default" | "cycle" | "neglect";

export interface ScorePoint {
  /** Unix ms of the event. */
  t: number;
  score: number;
  /** Reason behind this vertex — the baseline join, or a payment step. */
  kind?: ScoreEventKind;
  /** Pool name behind the event, when it can be resolved from the ledger. */
  poolName?: string;
  /** Score change vs the previous vertex (0 for the baseline/join). */
  delta?: number;
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

/**
 * Attach the REASON behind each reconstructed vertex so the chart can show WHY
 * the score moved at every step (the raw curve is just points). `history[0]` is
 * the baseline — the wallet's join, before any payment; `history[i>=1]` is the
 * score right after the i-th payment (payments in the SAME chronological order
 * `reconstructScoreHistory` stepped through, i.e. ascending time). `delta` is
 * the change vs the previous vertex. Pure — it never touches the (time, score)
 * math, only annotates — so the endpoint stays exactly the current score.
 */
export function annotateScoreHistory(
  history: ReadonlyArray<ScorePoint>,
  joinPool: string | null,
  paymentPools: ReadonlyArray<string | null>,
): ScorePoint[] {
  return history.map((p, i) => {
    if (i === 0) {
      return { ...p, kind: "join", delta: 0, ...(joinPool ? { poolName: joinPool } : {}) };
    }
    const pool = paymentPools[i - 1] ?? null;
    return {
      ...p,
      kind: "payment",
      delta: p.score - history[i - 1]!.score,
      ...(pool ? { poolName: pool } : {}),
    };
  });
}

// ─── True score timeline (on-chain attestation replay) ───────────────────────
// The reconstruction above INFERS a curve from payment timestamps + the current
// total (it spreads the score evenly, so it draws a straight line and can't
// show a late-payment dip or a +5 unverified step). The replay below is the
// HONEST version: it steps through the wallet's real Attestation records and
// applies the SAME score delta the reputation program applied at each one, so
// the shape — and the endpoint — match on-chain exactly.

// Score deltas — mirror programs/roundfi-reputation/src/constants.rs. A payment
// / pool-complete is HALVED when the subject wasn't identity-verified at attest
// time (SCORE_PAYMENT*num_unverif/den ⇒ 10→5, 50→25); negatives aren't weighted.
const SCORE = { payment: 10, poolComplete: 50, late: -100, default: -500, neglect: -100 } as const;
// Attestation schema ids — programs/roundfi-reputation/src/constants.rs.
const SCHEMA = { payment: 1, late: 2, default: 3, poolComplete: 4, neglect: 7 } as const;

/** The minimal Attestation shape a score replay needs (from decodeAttestationRaw). */
export interface ScoreAttestation {
  schemaId: number;
  /** Unix ms (the on-chain `issued_at`, seconds, ×1000 by the caller). */
  issuedAtMs: number;
  /** `verified_at_attest` — halves a positive payment / pool-complete delta. */
  verified: boolean;
  /** `neutralized` — a pool-complete recorded but not scored (SEV-A2) ⇒ 0. */
  neutralized: boolean;
  /** `revoked` — reversed on-chain, so it never contributes to the curve. */
  revoked: boolean;
  /** Pool name for the label, resolved from the issuer by the caller. */
  poolName?: string | null;
}

/** Exact score delta the reputation program applied for one attestation.
 *  Returns 0 for revoked / neutralized / non-scoring (level-up, unknown)
 *  records — i.e. anything that didn't move the score. */
export function scoreDeltaFor(a: ScoreAttestation): number {
  if (a.revoked) return 0;
  switch (a.schemaId) {
    case SCHEMA.payment:
      return a.verified ? SCORE.payment : Math.trunc(SCORE.payment / 2);
    case SCHEMA.late:
      return SCORE.late;
    case SCHEMA.default:
      return SCORE.default;
    case SCHEMA.poolComplete:
      if (a.neutralized) return 0;
      return a.verified ? SCORE.poolComplete : Math.trunc(SCORE.poolComplete / 2);
    case SCHEMA.neglect:
      // SEV-053 option B — crank-delivered payout the member never claimed.
      return SCORE.neglect;
    default:
      return 0; // SCHEMA_LEVEL_UP + any future informational schema
  }
}

const KIND_FOR_SCHEMA: Record<number, ScoreEventKind> = {
  [SCHEMA.payment]: "payment",
  [SCHEMA.late]: "late",
  [SCHEMA.default]: "default",
  [SCHEMA.poolComplete]: "cycle",
  [SCHEMA.neglect]: "neglect",
};

/**
 * Replay a wallet's attestations into the TRUE score-over-time curve. Steps
 * through the score-moving records in `issued_at` order, applying each exact
 * delta with the program's saturating-at-zero floor, so the endpoint equals
 * the on-chain `profile.score` by construction (no interpolation, no anchor
 * fudge). Seeds a score-0 baseline vertex at the first event so the climb from
 * zero is visible. Returns [] when there are no scoring events (→ empty-state).
 */
export function buildScoreTimeline(atts: ReadonlyArray<ScoreAttestation>): ScorePoint[] {
  const scoring = atts
    .filter((a) => scoreDeltaFor(a) !== 0)
    .slice()
    .sort((a, b) => a.issuedAtMs - b.issuedAtMs);
  if (scoring.length === 0) return [];
  const pts: ScorePoint[] = [{ t: scoring[0]!.issuedAtMs, score: 0, kind: "join", delta: 0 }];
  let score = 0;
  for (const a of scoring) {
    const raw = score + scoreDeltaFor(a);
    const next = Math.max(0, raw); // apply_score_delta saturates at 0
    const point: ScorePoint = {
      t: a.issuedAtMs,
      score: next,
      kind: KIND_FOR_SCHEMA[a.schemaId] ?? "payment",
      delta: next - score,
    };
    if (a.poolName) point.poolName = a.poolName;
    pts.push(point);
    score = next;
  }
  return pts;
}

/**
 * Choose which curve the /insights chart renders, given the live state of the
 * TRUE attestation replay (`useScoreTimeline`) and a lazily-built linear
 * reconstruction fallback. The ORDER is what keeps the fake straight line off
 * the screen:
 *
 *   1. Replay ready (≥2 vertices — includes an SWR-cached curve painted before
 *      revalidation) → use it. This is the honest per-event curve, with the real
 *      dips (late/default) and jumps (pool-complete) the reconstruction can't draw.
 *   2. Replay still LOADING → return [] so the chart shows its loading skeleton.
 *      We deliberately do NOT draw the reconstruction here: it interpolates the
 *      score evenly across payment timestamps, i.e. a straight ax+b line, and
 *      rendering it for the ~1–2 s until `getProgramAccounts` resolves is the
 *      "the chart went linear again" flash. Worse, `currentScore` is still 0
 *      mid-load, so it's a flat line pinned to the axis that then jumps. A brief
 *      skeleton is honest; a wrong line that snaps to the real one is not.
 *   3. Replay SETTLED but unavailable (`fallback` — getProgramAccounts failed
 *      with an empty cache) → best-effort reconstruction, so a wallet on a flaky
 *      RPC still sees an approximate climb instead of an empty box.
 *
 * `reconstruction` is a thunk so the (non-trivial) fallback curve is built only
 * when it's actually going to be shown — never during the loading path.
 */
export function selectScoreHistory(
  timelineStatus: "loading" | "ok" | "fallback",
  timelinePoints: ReadonlyArray<ScorePoint>,
  reconstruction: () => ScorePoint[],
): ScorePoint[] {
  if (timelinePoints.length >= 2) return timelinePoints.slice();
  if (timelineStatus === "loading") return [];
  return reconstruction();
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

/**
 * "Nice" round score values to label the chart's Y-axis across a [yMin, yMax]
 * window. Picks a 1/2/5×10^k step so the gridlines land on human numbers
 * (…20, 30, 40) instead of the padded scale's raw bounds. Ticks fall STRICTLY
 * inside the window (the padded top/bottom edges aren't labelled, so a tick
 * never collides with the plot border); returns [] for a degenerate span. This
 * is what gives the real chart a meaningful vertical axis even when the wallet's
 * score is far below the nearest tier guide (which would otherwise be off-screen
 * and leave the Y-axis blank).
 */
export function niceScoreTicks(yMin: number, yMax: number, maxTicks = 6): number[] {
  const span = yMax - yMin;
  if (!(span > 0) || maxTicks < 1) return [];
  const rawStep = span / maxTicks;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const unit = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = unit * mag;
  const out: number[] = [];
  for (let v = Math.ceil((yMin + 1e-9) / step) * step; v < yMax - 1e-9; v += step) {
    const r = Math.round(v);
    if (r > yMin && r < yMax && out[out.length - 1] !== r) out.push(r);
  }
  return out;
}

/** "26 jun" / "Jun 26" — a short day+month label for the real chart's axis. */
export function formatDayMon(ms: number, lang: "pt" | "en"): string {
  const d = new Date(ms);
  const mon = (lang === "pt" ? MONTH_ABBR_PT : MONTH_ABBR_EN)[d.getMonth()] ?? "";
  return lang === "pt" ? `${d.getDate()} ${mon}` : `${mon} ${d.getDate()}`;
}

/** "26 jun · 14:30" — day+month plus local clock, for the per-vertex tooltip.
 *  Same-day devnet payments share a date label on the axis, so the tooltip adds
 *  the time to disambiguate which payment a point is. */
export function formatDayTime(ms: number, lang: "pt" | "en"): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${formatDayMon(ms, lang)} · ${hh}:${mm}`;
}
