/**
 * Reputation score assembly (reputation v5.2 Hybrid, Phase C.3.3).
 *
 * Joins the persisted attestations for a subject (C.2b) into the
 * proposal's metrics (C.3.2) and shapes the public response.
 *
 * Split in two so the deterministic half is unit-testable without a DB:
 *   - `scoreFromSignals` — PURE: behavioral history → score summary.
 *   - `loadSubjectScore` — loads a subject's non-revoked attestations
 *     from Postgres, maps them to signals, calls `scoreFromSignals`.
 *     DB-backed → operator-run (same posture as `insights.spec.ts`).
 *
 * `formula_versao` is `"v1-provisional"` on every response: the weights
 * are NOT published as canonical (`06-team-decisions.md`, decisão 1).
 * `commitment` + `recovery` are surfaced as `null` with an explicit
 * `pending` list — the canary does not compute them yet, and a missing
 * field must read as "not computed", never as "zero".
 */

import type { PrismaClient } from "@prisma/client";

import { type EventClassification, classificationPolarity } from "./behavioralClassification.js";
import { type BehavioralSignal, punctuality, reliability } from "./reputationMetrics.js";

export const FORMULA_VERSAO = "v1-provisional" as const;

/** The metrics the canary does NOT yet compute (proposal §6.3/§6.4). */
export const PENDING_METRICS = ["commitment", "recovery"] as const;

const KNOWN_CLASSES: ReadonlySet<EventClassification> = new Set<EventClassification>([
  "payment_early",
  "payment_on_time",
  "friction_temporal",
  "late_behavioral",
  "temporary_incapacity",
  "default",
  "pool_complete",
  "payout_claimed",
  "unspecified",
]);

/** Public score response shape. All metrics 0..100; `commitment` /
 *  `recovery` are `null` until the canary computes them. */
export interface ScoreSummary {
  subject: string;
  formula_versao: typeof FORMULA_VERSAO;
  reliability: number;
  punctuality: number;
  commitment: number | null;
  recovery: number | null;
  pending: readonly string[];
  /** Total non-revoked events considered. */
  event_count: number;
  /** Per-classification event tallies (audit / UI). */
  classification_counts: Record<string, number>;
  /** Net polarity tallies (UI sugar). */
  polarity_counts: { positive: number; neutral: number; negative: number };
}

/**
 * Pure: behavioral history (oldest-first) → score summary. Empty history
 * yields the honest fresh-wallet default — `reliability = 0` (no
 * evidence), `punctuality = 80` (neutral), all tallies zero.
 */
export function scoreFromSignals(
  subject: string,
  history: readonly BehavioralSignal[],
): ScoreSummary {
  const classification_counts: Record<string, number> = {};
  const polarity_counts = { positive: 0, neutral: 0, negative: 0 };
  for (const e of history) {
    classification_counts[e.classification] = (classification_counts[e.classification] ?? 0) + 1;
    polarity_counts[classificationPolarity(e.classification)] += 1;
  }

  return {
    subject,
    formula_versao: FORMULA_VERSAO,
    reliability: reliability(history),
    punctuality: punctuality(history),
    commitment: null,
    recovery: null,
    pending: PENDING_METRICS,
    event_count: history.length,
    classification_counts,
    polarity_counts,
  };
}

/**
 * Coerce a stored classification string to a known `EventClassification`.
 * Anything unrecognized (a future variant this build doesn't know) maps
 * to `"unspecified"` — it carries no reliability weight and no timing, so
 * it can't skew the metrics.
 */
function asEventClassification(s: string | null): EventClassification {
  return s !== null && KNOWN_CLASSES.has(s as EventClassification)
    ? (s as EventClassification)
    : "unspecified";
}

/**
 * Load a subject's non-revoked attestations from Postgres, oldest-first,
 * and compute the score. DB-backed (operator-run).
 *
 * Ordering: `(issuedAt, nonce)` ascending — `issuedAt` is the on-chain
 * mint time; `nonce = (cycle << 32) | slot` is the deterministic
 * tie-breaker so two events in the same second order stably.
 */
export async function loadSubjectScore(
  prisma: PrismaClient,
  subject: string,
): Promise<ScoreSummary> {
  const rows = await prisma.attestation.findMany({
    where: { subject, revoked: false },
    orderBy: [{ issuedAt: "asc" }, { nonce: "asc" }],
    select: { classification: true, deltaSeconds: true },
  });

  const history: BehavioralSignal[] = rows.map((r) => ({
    classification: asEventClassification(r.classification),
    deltaSeconds: r.deltaSeconds,
  }));

  return scoreFromSignals(subject, history);
}
