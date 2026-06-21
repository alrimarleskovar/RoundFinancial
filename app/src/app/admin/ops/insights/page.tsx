"use client";

// /admin/ops/insights — analytics v0 (ADR 0010). Four pre-defined views:
// retention by level, default predictor, L1→L4 progression, behavioral
// improvement. Every metric is gated behind a documented sample-size
// threshold — below it the chart still renders its axes/scaffold under a
// semi-transparent veil ("insufficient · n / threshold"), but NEVER a
// number. On devnet (9 members) every gate is below threshold; that's the
// expected screen. The same panel measures mainnet.

import type { ReactNode } from "react";

import { useApi } from "@/lib/admin/useApi";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Empty, formatPct, Pill, RefreshBar, Section } from "@/components/adminops/ui";
import {
  BarWithBaselineChart,
  FunnelChart,
  GroupedBarChart,
  LineChart,
  type GroupSpec,
} from "@/components/adminops/charts";

type SampleStatus = "insufficient" | "preliminary" | "significant";

interface RetentionCohort {
  level: 1 | 2 | 3 | 4;
  n: number;
  status: SampleStatus;
  completedShareBps: number | null;
  completedCi95Bps: [number, number] | null;
  defaultedShareBps: number | null;
  defaultedCi95Bps: [number, number] | null;
}
interface PredictorBucket {
  feature: "late_gte_1" | "grace_used_gte_1" | "late_gte_2";
  withFeature: number;
  withFeatureDefaultRateBps: number | null;
  withFeatureCi95Bps: [number, number] | null;
  withoutFeature: number;
  withoutFeatureDefaultRateBps: number | null;
  withoutFeatureCi95Bps: [number, number] | null;
}
interface InsightsResponse {
  insights: {
    retention: { threshold: number; cohorts: RetentionCohort[] };
    predictor: {
      threshold: number;
      totalWallets: number;
      status: SampleStatus;
      overallDefaultRateBps: number | null;
      buckets: PredictorBucket[];
    };
    progression: {
      threshold: number;
      eligibleWallets: number;
      status: SampleStatus;
      reachedL2ShareBps: number | null;
      reachedL2Ci95Bps: [number, number] | null;
      reachedL3ShareBps: number | null;
      reachedL3Ci95Bps: [number, number] | null;
      reachedL4ShareBps: number | null;
      reachedL4Ci95Bps: [number, number] | null;
      avgPoolsToL2: number | null;
      avgPoolsToL3: number | null;
      avgPoolsToL4: number | null;
    };
    improvement: {
      threshold: number;
      eligibleWallets: number;
      status: SampleStatus;
      buckets: { ordinal: 1 | 2 | 3; walletsAtOrdinal: number; onTimeRateBps: number | null }[];
    };
  };
  servedAtUnix: number;
}

function ciLabel(ci: [number, number] | null): string {
  return ci == null ? "—" : `${formatPct(ci[0])} – ${formatPct(ci[1])}`;
}

export default function InsightsPage() {
  const { tokens } = useTheme();
  const t = useT();
  const { data, loading, error, reload } = useApi<InsightsResponse>("/api/admin/insights");

  if (loading && !data)
    return <div style={{ color: tokens.muted, fontSize: 13 }}>{t("adminops.loading")}</div>;
  if (error || !data) return <Empty>{t("adminops.insights.err", { err: error ?? "—" })}</Empty>;

  const i = data.insights;

  function statusPill(status: SampleStatus) {
    if (status === "significant")
      return <Pill text={t("adminops.insights.status.significant")} color={tokens.green} />;
    if (status === "preliminary")
      return <Pill text={t("adminops.insights.status.preliminary")} color={tokens.amber} />;
    return <Pill text={t("adminops.insights.status.insufficient")} color={tokens.muted} />;
  }

  function Legend({
    entries,
    markerType = "swatch",
  }: {
    entries: { color: string; label: string }[];
    markerType?: "swatch" | "line";
  }) {
    return (
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          marginTop: 10,
          fontSize: 11,
          color: tokens.text2,
        }}
      >
        {entries.map((e, idx) => (
          <span key={idx} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {markerType === "line" ? (
              <span
                style={{
                  width: 14,
                  height: 2,
                  borderRadius: 1,
                  background: e.color,
                  display: "inline-block",
                }}
              />
            ) : (
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: e.color,
                  display: "inline-block",
                }}
              />
            )}
            {e.label}
          </span>
        ))}
      </div>
    );
  }

  // SVG <text> can't word-wrap, so the chart Veil only carries the short
  // "n / threshold" counter. Long localized descriptions render here in
  // HTML, directly below the chart, where they wrap inside the card.
  function InsufficientMsg({ text }: { text: string }) {
    return (
      <p
        style={{
          marginTop: 10,
          marginBottom: 0,
          fontSize: 12,
          color: tokens.muted,
          lineHeight: 1.5,
          maxWidth: 560,
          textAlign: "center",
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {text}
      </p>
    );
  }

  function MetricRow({ label, value }: { label: string; value: ReactNode }) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: tokens.text2,
          padding: "4px 0",
        }}
      >
        <span style={{ color: tokens.muted }}>{label}</span>
        <span style={{ color: tokens.text, fontFamily: "var(--font-geist-mono)" }}>{value}</span>
      </div>
    );
  }

  // ── RETENTION ────────────────────────────────────────────────────
  // Each cohort has its own threshold check; "insufficient" overlay is
  // applied per-chart by passing the per-cohort n vs the shared threshold.
  // We pass `n` per group so the chart can render a ghost bar + "n=0" tag
  // for empty cohorts (distinguishable from "no data") and a minimum-height
  // bar when the rate is a real-but-zero 0% (not invisible).
  const retentionGroups: GroupSpec[] = i.retention.cohorts.map((c) => ({
    label: `L${c.level}`,
    n: c.n,
    bars: [
      { valueBps: c.completedShareBps, color: tokens.green },
      { valueBps: c.defaultedShareBps, color: tokens.red },
    ],
  }));
  const retentionAllInsufficient = i.retention.cohorts.every((c) => c.status === "insufficient");
  const retentionTotalN = i.retention.cohorts.reduce((a, c) => a + c.n, 0);

  // ── PREDICTOR ───────────────────────────────────────────────────
  // One group per feature, two bars (with vs without). Group-level n is
  // the sum so the "entire feature has no wallets" edge ghost-bars; per-
  // bar zero rates are rescued by the chart's min-height fix.
  const predictorGroups: GroupSpec[] = i.predictor.buckets.map((b) => ({
    label: t(`adminops.insights.feature.${b.feature}`),
    n: b.withFeature + b.withoutFeature,
    bars: [
      { valueBps: b.withFeatureDefaultRateBps, color: tokens.red },
      { valueBps: b.withoutFeatureDefaultRateBps, color: tokens.teal },
    ],
  }));

  // ── PROGRESSION ─────────────────────────────────────────────────
  const progressionSteps =
    i.progression.status === "insufficient"
      ? [
          { label: "L1", valueBps: 10_000, color: tokens.muted },
          { label: "L2", valueBps: 10_000, color: tokens.teal },
          { label: "L3", valueBps: 10_000, color: tokens.green },
          { label: "L4", valueBps: 10_000, color: tokens.purple },
        ]
      : [
          { label: "L1", valueBps: 10_000, color: tokens.muted },
          { label: "L2", valueBps: i.progression.reachedL2ShareBps ?? 0, color: tokens.teal },
          { label: "L3", valueBps: i.progression.reachedL3ShareBps ?? 0, color: tokens.green },
          { label: "L4", valueBps: i.progression.reachedL4ShareBps ?? 0, color: tokens.purple },
        ];

  // ── IMPROVEMENT ─────────────────────────────────────────────────
  const improvementPoints = i.improvement.buckets.map((b) => ({
    label:
      b.ordinal === 3
        ? t("adminops.insights.ordinal.3plus")
        : b.ordinal === 2
          ? t("adminops.insights.ordinal.2")
          : t("adminops.insights.ordinal.1"),
    yBps: b.onTimeRateBps,
  }));

  const chartWrap: React.CSSProperties = {
    padding: "16px 18px",
    borderRadius: 12,
    background: tokens.surface1,
    border: `1px solid ${tokens.border}`,
  };

  return (
    <div>
      <RefreshBar
        cadenceSeconds={null}
        servedAtUnix={data.servedAtUnix}
        onReload={reload}
        loading={loading}
      />

      <div
        style={{
          padding: "12px 16px",
          marginBottom: 20,
          borderRadius: 12,
          background: `${tokens.amber}1A`,
          border: `1px solid ${tokens.amber}55`,
          color: tokens.amber,
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.5,
        }}
      >
        {t("adminops.insights.banner")}
      </div>

      {/* 1. RETENTION — grouped bar chart (completion + default per level) */}
      <Section
        title={t("adminops.insights.retention.title")}
        tooltip={t("adminops.tip.insights.retention")}
        note={statusPill(
          i.retention.cohorts.find((c) => c.status === "significant")
            ? "significant"
            : i.retention.cohorts.find((c) => c.status === "preliminary")
              ? "preliminary"
              : "insufficient",
        )}
      >
        <div style={chartWrap}>
          <GroupedBarChart
            groups={retentionGroups}
            insufficient={
              retentionAllInsufficient
                ? {
                    n: retentionTotalN,
                    threshold: i.retention.threshold * 3,
                    message: t("adminops.insights.insufficient.retention"),
                  }
                : undefined
            }
          />
          {retentionAllInsufficient ? (
            <InsufficientMsg text={t("adminops.insights.insufficient.retention")} />
          ) : null}
          <Legend
            entries={[
              { color: tokens.green, label: t("adminops.insights.completed") },
              { color: tokens.red, label: t("adminops.insights.defaulted") },
            ]}
          />
          <div style={{ marginTop: 12, display: "grid", gap: 4 }}>
            {i.retention.cohorts.map((c) => (
              <div
                key={c.level}
                style={{
                  display: "grid",
                  gridTemplateColumns: "60px 1fr 1fr 1fr",
                  fontSize: 12,
                  color: tokens.text2,
                  alignItems: "baseline",
                  padding: "4px 0",
                  borderTop: `1px solid ${tokens.border}`,
                }}
              >
                <span style={{ color: tokens.text, fontWeight: 700 }}>L{c.level}</span>
                <span>
                  {c.status === "insufficient" ? (
                    <span style={{ color: tokens.muted }}>
                      {t("adminops.insights.progress", { n: c.n, t: i.retention.threshold })}
                    </span>
                  ) : (
                    <>
                      {t("adminops.insights.completed")}:{" "}
                      <span style={{ color: tokens.text }}>{formatPct(c.completedShareBps)}</span>{" "}
                      <span style={{ color: tokens.muted }}>
                        {t("adminops.insights.ci95")} {ciLabel(c.completedCi95Bps)}
                      </span>
                    </>
                  )}
                </span>
                <span>
                  {c.status === "insufficient" ? null : (
                    <>
                      {t("adminops.insights.defaulted")}:{" "}
                      <span style={{ color: tokens.text }}>{formatPct(c.defaultedShareBps)}</span>{" "}
                      <span style={{ color: tokens.muted }}>
                        {t("adminops.insights.ci95")} {ciLabel(c.defaultedCi95Bps)}
                      </span>
                    </>
                  )}
                </span>
                <span style={{ color: tokens.muted, textAlign: "right" }}>
                  {t("adminops.insights.nMembers", { n: c.n })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* 2. PREDICTOR — bar chart (default rate per feature bucket) + baseline */}
      <Section
        title={t("adminops.insights.predictor.title")}
        tooltip={t("adminops.tip.insights.predictor")}
        note={statusPill(i.predictor.status)}
      >
        <div style={chartWrap}>
          <BarWithBaselineChart
            groups={predictorGroups}
            baselineBps={i.predictor.overallDefaultRateBps}
            baselineLabel={t("adminops.insights.baseline")}
            insufficient={
              i.predictor.status === "insufficient"
                ? {
                    n: i.predictor.totalWallets,
                    threshold: i.predictor.threshold,
                    message: t("adminops.insights.insufficient.predictor"),
                  }
                : undefined
            }
          />
          {i.predictor.status === "insufficient" ? (
            <InsufficientMsg text={t("adminops.insights.insufficient.predictor")} />
          ) : null}
          <Legend
            entries={[
              { color: tokens.red, label: t("adminops.insights.withFeatureLegend") },
              { color: tokens.teal, label: t("adminops.insights.withoutFeatureLegend") },
              { color: tokens.amber, label: t("adminops.insights.baseline") },
            ]}
          />
          {i.predictor.status !== "insufficient" ? (
            <div style={{ marginTop: 12, display: "grid", gap: 4 }}>
              {i.predictor.buckets.map((b) => (
                <div
                  key={b.feature}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    fontSize: 12,
                    color: tokens.text2,
                    padding: "4px 0",
                    borderTop: `1px solid ${tokens.border}`,
                  }}
                >
                  <span style={{ color: tokens.text, fontWeight: 600 }}>
                    {t(`adminops.insights.feature.${b.feature}`)}
                  </span>
                  <span>
                    {t("adminops.insights.withFeature", { n: b.withFeature })}:{" "}
                    <span style={{ color: tokens.text }}>
                      {formatPct(b.withFeatureDefaultRateBps)}
                    </span>{" "}
                    <span style={{ color: tokens.muted }}>{ciLabel(b.withFeatureCi95Bps)}</span>
                  </span>
                  <span>
                    {t("adminops.insights.withoutFeature", { n: b.withoutFeature })}:{" "}
                    <span style={{ color: tokens.text }}>
                      {formatPct(b.withoutFeatureDefaultRateBps)}
                    </span>{" "}
                    <span style={{ color: tokens.muted }}>{ciLabel(b.withoutFeatureCi95Bps)}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Section>

      {/* 3. PROGRESSION — funnel L1 → L2 → L3 */}
      <Section
        title={t("adminops.insights.progression.title")}
        tooltip={t("adminops.tip.insights.progression")}
        note={statusPill(i.progression.status)}
      >
        <div style={chartWrap}>
          <FunnelChart
            steps={progressionSteps}
            insufficient={
              i.progression.status === "insufficient"
                ? {
                    n: i.progression.eligibleWallets,
                    threshold: i.progression.threshold,
                    message: t("adminops.insights.insufficient.progression"),
                  }
                : undefined
            }
          />
          {i.progression.status === "insufficient" ? (
            <InsufficientMsg text={t("adminops.insights.insufficient.progression")} />
          ) : null}
          <Legend
            entries={[
              { color: tokens.muted, label: "L1" },
              { color: tokens.teal, label: "L2" },
              { color: tokens.green, label: "L3" },
            ]}
          />
          {i.progression.status !== "insufficient" ? (
            <div style={{ marginTop: 12 }}>
              <MetricRow
                label={t("adminops.insights.reachedL2")}
                value={
                  <>
                    {formatPct(i.progression.reachedL2ShareBps)}{" "}
                    <span style={{ color: tokens.muted }}>
                      {ciLabel(i.progression.reachedL2Ci95Bps)}
                    </span>
                  </>
                }
              />
              <MetricRow
                label={t("adminops.insights.reachedL3")}
                value={
                  <>
                    {formatPct(i.progression.reachedL3ShareBps)}{" "}
                    <span style={{ color: tokens.muted }}>
                      {ciLabel(i.progression.reachedL3Ci95Bps)}
                    </span>
                  </>
                }
              />
              <MetricRow
                label={t("adminops.insights.avgPoolsToL2")}
                value={i.progression.avgPoolsToL2 ?? "—"}
              />
              <MetricRow
                label={t("adminops.insights.avgPoolsToL3")}
                value={i.progression.avgPoolsToL3 ?? "—"}
              />
            </div>
          ) : null}
        </div>
      </Section>

      {/* 4. IMPROVEMENT — line chart of on-time rate by pool ordinal */}
      <Section
        title={t("adminops.insights.improvement.title")}
        tooltip={t("adminops.tip.insights.improvement")}
        note={statusPill(i.improvement.status)}
      >
        <div style={chartWrap}>
          <LineChart
            points={improvementPoints}
            color={tokens.green}
            insufficient={
              i.improvement.status === "insufficient"
                ? {
                    n: i.improvement.eligibleWallets,
                    threshold: i.improvement.threshold,
                    message: t("adminops.insights.insufficient.improvement"),
                  }
                : undefined
            }
          />
          {i.improvement.status === "insufficient" ? (
            <InsufficientMsg text={t("adminops.insights.insufficient.improvement")} />
          ) : null}
          <Legend
            entries={[{ color: tokens.green, label: t("adminops.insights.onTimeAxis") }]}
            markerType="line"
          />
          <div style={{ marginTop: 12, display: "grid", gap: 4 }}>
            {i.improvement.buckets.map((b) => (
              <MetricRow
                key={b.ordinal}
                label={
                  b.ordinal === 3
                    ? t("adminops.insights.ordinal.3plus")
                    : b.ordinal === 2
                      ? t("adminops.insights.ordinal.2")
                      : t("adminops.insights.ordinal.1")
                }
                value={
                  <>
                    {i.improvement.status === "insufficient"
                      ? t("adminops.insights.progress", {
                          n: i.improvement.eligibleWallets,
                          t: i.improvement.threshold,
                        })
                      : formatPct(b.onTimeRateBps)}{" "}
                    <span style={{ color: tokens.muted }}>
                      ({t("adminops.insights.nWallets", { n: b.walletsAtOrdinal })})
                    </span>
                  </>
                }
              />
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}
