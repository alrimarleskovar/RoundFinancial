"use client";

// /admin/ops — Canary home. Protocol + indexer health, STRUCTURAL only.
// Behavioral aggregates stay gated until the on-devnet exact-value smoke
// (ADR 0009 #5) — we render a "gated" note, never a fake number.

import { useApi } from "@/lib/admin/useApi";
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
  const { data, loading, error } = useApi<CanaryResponse>("/api/admin/canary");

  if (loading) return <div style={{ color: tokens.muted, fontSize: 13 }}>carregando…</div>;
  if (error || !data)
    return <Empty>Não foi possível carregar o overview ({error ?? "sem dados"}).</Empty>;

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
      <Section title="Saúde do protocolo">
        {o.pools.total === 0 ? (
          <Empty>Nenhum pool indexado ainda. (devnet — dado real escasso é esperado.)</Empty>
        ) : (
          <div style={grid}>
            <StatCard label="Pools" value={o.pools.total} sub={byStatusSub || "—"} />
            <StatCard
              label="Em risco"
              value={o.pools.atRisk}
              sub="pools com ≥1 default on-chain"
              tone={o.pools.atRisk === 0 ? "muted" : "default"}
            />
            <StatCard label="Usuários" value={o.members.total} sub="members indexados" />
            <StatCard
              label="Eventos"
              value={o.events.contribute + o.events.claim + o.events.default}
              sub={`${o.events.contribute} contrib · ${o.events.claim} payout · ${o.events.default} default`}
            />
          </div>
        )}
      </Section>

      <Section
        title="Comportamento agregado"
        note={`${b.timedContributions} contribuições com prazo · derivado de events`}
      >
        {b.timedContributions === 0 ? (
          <Empty>Sem contribuições com prazo ainda (rode backfill:events + project-events).</Empty>
        ) : (
          <div style={grid}>
            <StatCard
              label="Em dia"
              value={b.onTimeRateBps == null ? "—" : `${(b.onTimeRateBps / 100).toFixed(1)}%`}
              sub={`${b.onTime} de ${b.timedContributions}`}
            />
            <StatCard
              label="Atrasados"
              value={b.late}
              sub={`${b.graceUsed} dentro do grace`}
              tone={b.late === 0 ? "muted" : "default"}
            />
            <StatCard
              label="Atraso médio"
              value={fmtDuration(b.avgDelaySecondsLate)}
              sub="média dos atrasados"
            />
            <StatCard
              label="Defaults"
              value={b.defaults}
              sub="settle_default on-chain"
              tone={b.defaults === 0 ? "muted" : "default"}
            />
          </div>
        )}
      </Section>

      <Section
        title="Saúde do indexer"
        note={`events até ${agoLabel(ix.lastProjectionUnix)} · servido ${agoLabel(data.servedAtUnix)}`}
      >
        <div style={grid}>
          <StatCard
            label="Lag (slots)"
            value={ix.slotsBehind == null ? "—" : ix.slotsBehind}
            sub={
              ix.slotsBehind == null ? "cluster slot indisponível" : `último slot ${ix.lastSlot}`
            }
            tone={ix.slotsBehind == null || ix.slotsBehind > 64 ? "default" : "muted"}
          />
          <StatCard label="Última atualização" value={agoLabel(ix.lastUpdateUnix)} />
          <StatCard
            label="Backfill"
            value={ix.lastBackfill?.status ?? "—"}
            sub={ix.lastBackfill ? agoLabel(ix.lastBackfill.startedAtUnix) : "nunca rodou"}
          />
          <StatCard
            label="Projeção events"
            value={ix.projectedEventCount}
            sub={`atualizada ${agoLabel(ix.lastProjectionUnix)}`}
          />
          <StatCard
            label="Não-resolvidos"
            value={sum(ix.unresolved)}
            sub="aguardando reconciliação"
            tone={sum(ix.unresolved) === 0 ? "muted" : "default"}
          />
          <StatCard
            label="Órfãos"
            value={sum(ix.orphaned)}
            sub="tx não finalizou (fora do canon)"
            tone={sum(ix.orphaned) === 0 ? "muted" : "default"}
          />
        </div>
      </Section>
    </div>
  );
}
