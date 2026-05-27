"use client";

// /admin/ops/pools — structural pools table from the indexer DB. The
// per-pool behavioral timeline (events-derived who-paid/late/defaulted) is
// a separate, gated increment that lands after the on-devnet smoke.

import { useApi } from "@/lib/admin/useApi";
import { useTheme } from "@/lib/theme";
import {
  agoLabel,
  Empty,
  HealthPill,
  MonoLabel,
  Section,
  StatusPill,
} from "@/components/adminops/ui";
import { shortAddr } from "@/lib/wallet";

interface PoolRow {
  pda: string;
  status: string;
  currentCycle: number;
  cyclesTotal: number;
  membersJoined: number;
  membersTarget: number;
  defaultedMembers: number;
  health: "healthy" | "at_risk" | "distressed";
  updatedAtUnix: number;
}
interface PoolsResponse {
  pools: PoolRow[];
  indexer: { lastProjectionUnix: number | null; lastUpdateUnix: number | null };
  servedAtUnix: number;
}

const TH: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: "uppercase",
  padding: "0 12px 10px",
};

export default function PoolsPage() {
  const { tokens } = useTheme();
  const { data, loading, error } = useApi<PoolsResponse>("/api/admin/pools");

  if (loading) return <div style={{ color: tokens.muted, fontSize: 13 }}>carregando…</div>;
  if (error || !data)
    return <Empty>Não foi possível carregar os pools ({error ?? "sem dados"}).</Empty>;

  const td: React.CSSProperties = {
    padding: "12px",
    borderTop: `1px solid ${tokens.border}`,
    fontSize: 13,
    color: tokens.text,
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <Section
      title="Pools"
      note={`${data.pools.length} indexados · estado estrutural até ${agoLabel(data.indexer.lastUpdateUnix)}`}
    >
      {data.pools.length === 0 ? (
        <Empty>Nenhum pool indexado ainda. (devnet — rode o backfill do indexer.)</Empty>
      ) : (
        <div
          style={{
            border: `1px solid ${tokens.border}`,
            borderRadius: 12,
            overflow: "hidden",
            background: tokens.surface1,
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: tokens.muted }}>
                <th style={{ ...TH, paddingLeft: 16 }}>Pool</th>
                <th style={TH}>Status</th>
                <th style={TH}>Ciclo</th>
                <th style={TH}>Membros</th>
                <th style={TH}>Defaults</th>
                <th style={TH}>Saúde</th>
                <th style={TH}>Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {data.pools.map((p) => (
                <tr key={p.pda}>
                  <td style={{ ...td, paddingLeft: 16 }}>
                    <MonoLabel>{shortAddr(p.pda, 6, 6)}</MonoLabel>
                  </td>
                  <td style={td}>
                    <StatusPill status={p.status} />
                  </td>
                  <td style={td}>
                    {p.currentCycle}
                    <span style={{ color: tokens.muted }}>/{p.cyclesTotal}</span>
                  </td>
                  <td style={td}>
                    {p.membersJoined}
                    <span style={{ color: tokens.muted }}>/{p.membersTarget}</span>
                  </td>
                  <td style={{ ...td, color: p.defaultedMembers > 0 ? tokens.red : tokens.muted }}>
                    {p.defaultedMembers}
                  </td>
                  <td style={td}>
                    <HealthPill health={p.health} />
                  </td>
                  <td style={{ ...td, color: tokens.muted, fontSize: 12 }}>
                    {agoLabel(p.updatedAtUnix)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
