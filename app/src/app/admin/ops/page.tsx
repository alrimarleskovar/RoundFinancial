"use client";

// /admin/ops — Canary home. Protocol + indexer health + behavioral
// aggregates (ADR 0009; gate #5 cleared 2026-05-27). i18n via @/lib/i18n.

import { useApi } from "@/lib/admin/useApi";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { agoLabel, Empty, fmtDuration, Section, StatCard } from "@/components/adminops/ui";

interface IndexerHealth {
  lastSlot: string | null;
  lastUpdateUnix: number | null;
  slotsBehind: number | null;
  lastBackfill: { status: string; startedAtUnix: number; durationMs: number | null } | null;
  unresolved: { contribute: number; claim: number; default: number };
  orphaned: { contribute: number; claim: number; default: number };
  lastProjectionUnix: number | null;
  projectedEventCount: number;
}
interface Behavioral {
  timedContributions: number;
  onTime: number;
  late: number;
  graceUsed: number;
  onTimeRateBps: number | null;
  avgDelaySecondsLate: number | null;
  defaults: number;
}
interface CanaryResponse {
  overview: {
    pools: { total: number; byStatus: Record<string, number>; atRisk: number };
    members: { total: number };
    events: { contribute: number; claim: number; default: number };
    indexer: IndexerHealth;
  };
  behavioral: Behavioral;
  servedAtUnix: number;
}

function sum(o: { contribute: number; claim: number; default: number }): number {
  return o.contribute + o.claim + o.default;
}

export default function CanaryPage() {
  const { tokens } = useTheme();
  const t = useT();
  const { data, loading, error } = useApi<CanaryResponse>("/api/admin/canary");
  const ago = (u: number | null) => t("adminops.ago", { v: agoLabel(u) });

  if (loading)
    return <div style={{ color: tokens.muted, fontSize: 13 }}>{t("adminops.loading")}</div>;
  if (error || !data)
    return <Empty>{t("adminops.canary.empty.overview", { err: error ?? "—" })}</Empty>;

  const { overview: o } = data;
  const b = data.behavioral;
  const ix = o.indexer;
  const grid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  } as const;

  const byStatusSub = Object.entries(o.pools.byStatus)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s.toLowerCase()}`)
    .join(" · ");

  return (
    <div>
      <Section title={t("adminops.canary.protocolHealth")}>
        {o.pools.total === 0 ? (
          <Empty>{t("adminops.canary.empty.pools")}</Empty>
        ) : (
          <div style={grid}>
            <StatCard
              label={t("adminops.canary.card.pools")}
              value={o.pools.total}
              sub={byStatusSub || "—"}
            />
            <StatCard
              label={t("adminops.canary.card.atRisk")}
              value={o.pools.atRisk}
              sub={t("adminops.canary.card.atRiskSub")}
              tone={o.pools.atRisk === 0 ? "muted" : "default"}
            />
            <StatCard
              label={t("adminops.canary.card.users")}
              value={o.members.total}
              sub={t("adminops.canary.card.usersSub")}
            />
            <StatCard
              label={t("adminops.canary.card.events")}
              value={o.events.contribute + o.events.claim + o.events.default}
              sub={t("adminops.canary.card.eventsSub", {
                c: o.events.contribute,
                p: o.events.claim,
                d: o.events.default,
              })}
            />
          </div>
        )}
      </Section>

      <Section
        title={t("adminops.canary.behavioral")}
        note={t("adminops.canary.note.behavioral", { n: b.timedContributions })}
      >
        {b.timedContributions === 0 ? (
          <Empty>{t("adminops.canary.empty.behavioral")}</Empty>
        ) : (
          <div style={grid}>
            <StatCard
              label={t("adminops.canary.card.onTime")}
              value={b.onTimeRateBps == null ? "—" : `${(b.onTimeRateBps / 100).toFixed(1)}%`}
              sub={t("adminops.canary.card.onTimeSub", {
                ot: b.onTime,
                total: b.timedContributions,
              })}
            />
            <StatCard
              label={t("adminops.canary.card.late")}
              value={b.late}
              sub={t("adminops.canary.card.lateSub", { g: b.graceUsed })}
              tone={b.late === 0 ? "muted" : "default"}
            />
            <StatCard
              label={t("adminops.canary.card.avgDelay")}
              value={fmtDuration(b.avgDelaySecondsLate)}
              sub={t("adminops.canary.card.avgDelaySub")}
            />
            <StatCard
              label={t("adminops.canary.card.defaults")}
              value={b.defaults}
              sub={t("adminops.canary.card.defaultsSub")}
              tone={b.defaults === 0 ? "muted" : "default"}
            />
          </div>
        )}
      </Section>

      <Section
        title={t("adminops.canary.indexerHealth")}
        note={t("adminops.canary.note.events", {
          proj: ago(ix.lastProjectionUnix),
          served: ago(data.servedAtUnix),
        })}
      >
        <div style={grid}>
          <StatCard
            label={t("adminops.canary.card.lag")}
            value={ix.slotsBehind == null ? t("adminops.lagUnknown") : ix.slotsBehind}
            sub={
              ix.slotsBehind == null
                ? t("adminops.canary.card.lagUnknownSub")
                : t("adminops.canary.card.lagSlotSub", { s: ix.lastSlot ?? "—" })
            }
            tone={ix.slotsBehind == null || ix.slotsBehind > 64 ? "default" : "muted"}
          />
          <StatCard label={t("adminops.canary.card.lastUpdate")} value={ago(ix.lastUpdateUnix)} />
          <StatCard
            label={t("adminops.canary.card.backfill")}
            value={ix.lastBackfill?.status ?? "—"}
            sub={
              ix.lastBackfill
                ? ago(ix.lastBackfill.startedAtUnix)
                : t("adminops.canary.card.backfillNever")
            }
          />
          <StatCard
            label={t("adminops.canary.card.projection")}
            value={ix.projectedEventCount}
            sub={t("adminops.canary.card.projectionSub", { ago: ago(ix.lastProjectionUnix) })}
          />
          <StatCard
            label={t("adminops.canary.card.unresolved")}
            value={sum(ix.unresolved)}
            sub={t("adminops.canary.card.unresolvedSub")}
            tone={sum(ix.unresolved) === 0 ? "muted" : "default"}
          />
          <StatCard
            label={t("adminops.canary.card.orphaned")}
            value={sum(ix.orphaned)}
            sub={t("adminops.canary.card.orphanedSub")}
            tone={sum(ix.orphaned) === 0 ? "muted" : "default"}
          />
        </div>
      </Section>
    </div>
  );
}
