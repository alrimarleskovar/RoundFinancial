"use client";

/**
 * Off-chain v5.2 behavioral score panel (reputation v5.2 Hybrid, Phase
 * C.3.3 wired to the admin console).
 *
 * Fetches `GET /api/admin/users/[wallet]/reputation-score`, which calls
 * the indexer's `loadSubjectScore` (same Postgres handle, no extra HTTP
 * hop) and returns the `formula_versao`-tagged ScoreSummary unchanged.
 *
 * Three honesty hooks the UI must surface (per architecture.md §4.7 +
 * `06-team-decisions.md`):
 *   1. `v1-provisional` badge — weights are NOT canonical; calibrated
 *      against real data later. Without this label the metric reads as
 *      authoritative, which it isn't yet.
 *   2. Deferred metrics render as "Pending" pills (commitment / recovery)
 *      — never as "0", which would silently understate.
 *   3. A 503 from the route surfaces as "indexer unavailable", separable
 *      from a fresh wallet (200 with empty event_count).
 *
 * `useApi` (the existing same-origin hook) handles loading / 401 / 5xx.
 */

import { useApi } from "@/lib/admin/useApi";
import { useTheme } from "@/lib/theme";
import { MonoLabel, Pill, Section, StatCard } from "@/components/adminops/ui";

interface ScoreSummary {
  subject: string;
  formula_versao: string;
  reliability: number;
  punctuality: number;
  commitment: number | null;
  recovery: number | null;
  pending: string[];
  event_count: number;
  classification_counts: Record<string, number>;
  polarity_counts: { positive: number; neutral: number; negative: number };
}

interface Props {
  wallet: string;
}

const CLASS_LABEL: Record<string, string> = {
  payment_early: "Early",
  payment_on_time: "On time",
  friction_temporal: "Friction (≤2d)",
  late_behavioral: "Late (2–7d)",
  temporary_incapacity: "Late (>7d)",
  default: "Default",
  cycle_complete: "Cycle complete",
  unspecified: "Unspecified",
};

export function BehavioralScoreCard({ wallet }: Props) {
  const { tokens } = useTheme();
  const { data, loading, error, status } = useApi<ScoreSummary>(
    `/api/admin/users/${wallet}/reputation-score`,
  );

  return (
    <Section
      title="Behavioral score (off-chain, v5.2)"
      tooltip="Off-chain Reliability + Punctuality computed by the indexer from the on-chain BehavioralPayload. The score is intentionally NOT canonical — weights remain v1-provisional and will be calibrated against real cycle data before publication."
    >
      {loading ? (
        <div style={{ color: tokens.muted, padding: 4 }}>Loading…</div>
      ) : error || !data ? (
        <div style={{ color: tokens.danger, padding: 4 }}>
          {status === 503
            ? "Indexer unavailable — score will appear once the service is reachable."
            : `Score unavailable (${error ?? "unknown"})`}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Pill text={`formula ${data.formula_versao}`} color={tokens.muted} />
            <MonoLabel>
              {data.event_count} {data.event_count === 1 ? "event" : "events"}
            </MonoLabel>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            <StatCard
              label="Reliability"
              value={`${data.reliability}/100`}
              sub="Weighted average · last 50 events"
              tooltip="Reliability = (Σ weight × 100) / (count × 100), clamped 0–100. Weights from the proposal §6: on_time/early=100, friction_temporal=95, late_behavioral=70, temporary_incapacity=40, default=0. 0 ≡ no evidence (empty window)."
            />
            <StatCard
              label="Punctuality"
              value={`${data.punctuality}/100`}
              sub="Avg lateness mapped piecewise-linear"
              tooltip="Punctuality = piecewise-linear map of mean delta_seconds over the last 50 payment events. ≤−3d → 100, 0 → 80, +1d → 60, +7d → 30, ≥+30d → 0. 80 ≡ no payment data (neutral)."
            />
            <StatCard
              label="Commitment"
              value={<Pill text="Pending" color={tokens.muted} />}
              sub="Deferred · needs pool counts"
            />
            <StatCard
              label="Recovery"
              value={<Pill text="Pending" color={tokens.muted} />}
              sub="Deferred · needs recovery event"
            />
          </div>

          <div style={{ marginTop: 16 }}>
            <MonoLabel strong>Classification breakdown</MonoLabel>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {Object.entries(data.classification_counts)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => (
                  <div
                    key={k}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: tokens.surface1,
                      border: `1px solid ${tokens.border}`,
                      fontSize: 12,
                      color: tokens.text,
                    }}
                  >
                    {CLASS_LABEL[k] ?? k}: <strong>{n}</strong>
                  </div>
                ))}
              {data.event_count === 0 ? (
                <div style={{ color: tokens.muted, fontSize: 12 }}>
                  No attestations yet — fresh wallet defaults shown above.
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </Section>
  );
}
