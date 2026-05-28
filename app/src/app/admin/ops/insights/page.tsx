"use client";

// /admin/ops/insights — analytics v0 (ADR 0010). Four pre-defined views:
// retention by level, default predictor, L1→L2→L3 progression, behavioral
// improvement. Every metric is gated behind a documented sample-size
// threshold — below it the panel shows progress, NEVER a number. On
// devnet (9 members) every gate is below threshold; that's the expected
// screen. The same panel measures mainnet.

import { useApi } from "@/lib/admin/useApi";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Empty, formatPct, Pill, RefreshBar, Section, StatCard } from "@/components/adminops/ui";

type SampleStatus = "insufficient" | "preliminary" | "significant";

interface RetentionCohort {
  level: 1 | 2 | 3;
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
      avgPoolsToL2: number | null;
      avgPoolsToL3: number | null;
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
  return ci == null ? "" : `${formatPct(ci[0])} – ${formatPct(ci[1])}`;
}

export default function InsightsPage() {
  const { tokens } = useTheme();
  const t = useT();
  const { data, loading, error, reload } = useApi<InsightsResponse>("/api/admin/insights");

  if (loading && !data)
    return <div style={{ color: tokens.muted, fontSize: 13 }}>{t("adminops.loading")}</div>;
  if (error || !data) return <Empty>{t("adminops.insights.err", { err: error ?? "—" })}</Empty>;

  const i = data.insights;
  const grid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  } as const;

  function statusPill(status: SampleStatus) {
    if (status === "significant")
      return <Pill text={t("adminops.insights.status.significant")} color={tokens.green} />;
    if (status === "preliminary")
      return <Pill text={t("adminops.insights.status.preliminary")} color={tokens.amber} />;
    return <Pill text={t("adminops.insights.status.insufficient")} color={tokens.muted} />;
  }

  function GateBar({ n, threshold }: { n: number; threshold: number }) {
    const pct = Math.min(100, Math.round((n / threshold) * 100));
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, color: tokens.muted, marginBottom: 4 }}>
          {t("adminops.insights.progress", { n, t: threshold })}
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 999,
            background: tokens.fillSoft,
            overflow: "hidden",
          }}
        >
          <div style={{ height: "100%", width: `${pct}%`, background: tokens.teal }} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <RefreshBar
        cadenceSeconds={null}
        servedAtUnix={data.servedAtUnix}
        onReload={reload}
        loading={loading}
      />

      {/* LOUD devnet banner — instrumentation, not insight. */}
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

      {/* 1. RETENTION BY LEVEL */}
      <Section
        title={t("adminops.insights.retention.title")}
        tooltip={t("adminops.tip.insights.retention")}
      >
        <div style={grid}>
          {i.retention.cohorts.map((c) => (
            <div
              key={c.level}
              style={{
                padding: "16px 18px",
                borderRadius: 12,
                background: tokens.surface1,
                border: `1px solid ${tokens.border}`,
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, color: tokens.text }}>L{c.level}</div>
                {statusPill(c.status)}
              </div>
              {c.status === "insufficient" ? (
                <GateBar n={c.n} threshold={i.retention.threshold} />
              ) : (
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        color: tokens.muted,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      {t("adminops.insights.completed")}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: tokens.text }}>
                      {formatPct(c.completedShareBps)}
                    </div>
                    <div style={{ fontSize: 11, color: tokens.muted }}>
                      {t("adminops.insights.ci95")} {ciLabel(c.completedCi95Bps)}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        color: tokens.muted,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      {t("adminops.insights.defaulted")}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: tokens.text }}>
                      {formatPct(c.defaultedShareBps)}
                    </div>
                    <div style={{ fontSize: 11, color: tokens.muted }}>
                      {t("adminops.insights.ci95")} {ciLabel(c.defaultedCi95Bps)}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: tokens.muted }}>
                    {t("adminops.insights.nMembers", { n: c.n })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* 2. DEFAULT PREDICTOR */}
      <Section
        title={t("adminops.insights.predictor.title")}
        note={
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            {statusPill(i.predictor.status)}
          </span>
        }
        tooltip={t("adminops.tip.insights.predictor")}
      >
        {i.predictor.status === "insufficient" ? (
          <div
            style={{
              padding: "16px 18px",
              border: `1px solid ${tokens.border}`,
              borderRadius: 12,
              background: tokens.surface1,
            }}
          >
            <div style={{ fontSize: 13, color: tokens.text2 }}>
              {t("adminops.insights.insufficient.predictor")}
            </div>
            <GateBar n={i.predictor.totalWallets} threshold={i.predictor.threshold} />
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {i.predictor.buckets.map((b) => (
              <div
                key={b.feature}
                style={{
                  padding: "14px 18px",
                  borderRadius: 12,
                  background: tokens.surface1,
                  border: `1px solid ${tokens.border}`,
                  display: "grid",
                  gridTemplateColumns: "minmax(200px, 1fr) 1fr 1fr",
                  gap: 16,
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>
                  {t(`adminops.insights.feature.${b.feature}`)}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: tokens.muted,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    {t("adminops.insights.withFeature", { n: b.withFeature })}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: tokens.text }}>
                    {formatPct(b.withFeatureDefaultRateBps)}
                  </div>
                  <div style={{ fontSize: 11, color: tokens.muted }}>
                    {t("adminops.insights.ci95")} {ciLabel(b.withFeatureCi95Bps)}
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: tokens.muted,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    {t("adminops.insights.withoutFeature", { n: b.withoutFeature })}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: tokens.text }}>
                    {formatPct(b.withoutFeatureDefaultRateBps)}
                  </div>
                  <div style={{ fontSize: 11, color: tokens.muted }}>
                    {t("adminops.insights.ci95")} {ciLabel(b.withoutFeatureCi95Bps)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 3. PROGRESSION L1→L2→L3 */}
      <Section
        title={t("adminops.insights.progression.title")}
        note={statusPill(i.progression.status)}
        tooltip={t("adminops.tip.insights.progression")}
      >
        {i.progression.status === "insufficient" ? (
          <div
            style={{
              padding: "16px 18px",
              border: `1px solid ${tokens.border}`,
              borderRadius: 12,
              background: tokens.surface1,
            }}
          >
            <div style={{ fontSize: 13, color: tokens.text2 }}>
              {t("adminops.insights.insufficient.progression")}
            </div>
            <GateBar n={i.progression.eligibleWallets} threshold={i.progression.threshold} />
          </div>
        ) : (
          <div style={grid}>
            <StatCard
              label={t("adminops.insights.reachedL2")}
              value={formatPct(i.progression.reachedL2ShareBps)}
              sub={`${t("adminops.insights.ci95")} ${ciLabel(i.progression.reachedL2Ci95Bps)}`}
            />
            <StatCard
              label={t("adminops.insights.reachedL3")}
              value={formatPct(i.progression.reachedL3ShareBps)}
              sub={`${t("adminops.insights.ci95")} ${ciLabel(i.progression.reachedL3Ci95Bps)}`}
            />
            <StatCard
              label={t("adminops.insights.avgPoolsToL2")}
              value={i.progression.avgPoolsToL2 ?? "—"}
              sub={t("adminops.insights.poolsMean")}
            />
            <StatCard
              label={t("adminops.insights.avgPoolsToL3")}
              value={i.progression.avgPoolsToL3 ?? "—"}
              sub={t("adminops.insights.poolsMean")}
            />
          </div>
        )}
      </Section>

      {/* 4. BEHAVIORAL IMPROVEMENT */}
      <Section
        title={t("adminops.insights.improvement.title")}
        note={statusPill(i.improvement.status)}
        tooltip={t("adminops.tip.insights.improvement")}
      >
        {i.improvement.status === "insufficient" ? (
          <div
            style={{
              padding: "16px 18px",
              border: `1px solid ${tokens.border}`,
              borderRadius: 12,
              background: tokens.surface1,
            }}
          >
            <div style={{ fontSize: 13, color: tokens.text2 }}>
              {t("adminops.insights.insufficient.improvement")}
            </div>
            <GateBar n={i.improvement.eligibleWallets} threshold={i.improvement.threshold} />
          </div>
        ) : (
          <div style={grid}>
            {i.improvement.buckets.map((b) => (
              <StatCard
                key={b.ordinal}
                label={
                  b.ordinal === 3
                    ? t("adminops.insights.ordinal.3plus")
                    : b.ordinal === 2
                      ? t("adminops.insights.ordinal.2")
                      : t("adminops.insights.ordinal.1")
                }
                value={formatPct(b.onTimeRateBps)}
                sub={t("adminops.insights.nWallets", { n: b.walletsAtOrdinal })}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
