"use client";

// /admin/ops/pools — structural pools table from the indexer DB. Rows link
// to the pool detail (structural + RPC-live + behavioral timeline).

import Link from "next/link";

import { useApi } from "@/lib/admin/useApi";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import {
  agoLabel,
  Empty,
  HealthPill,
  MonoLabel,
  RefreshBar,
  Section,
  StatusPill,
  tableHeadStyles,
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

export default function PoolsPage() {
  const { tokens } = useTheme();
  const t = useT();
  const TH = tableHeadStyles(tokens);
  const { data, loading, error, reload } = useApi<PoolsResponse>("/api/admin/pools", {
    intervalMs: 60_000,
  });
  const ago = (u: number | null) => t("adminops.ago", { v: agoLabel(u) });

  if (loading && !data)
    return <div style={{ color: tokens.muted, fontSize: 13 }}>{t("adminops.loading")}</div>;
  if (error || !data) return <Empty>{t("adminops.pools.err", { err: error ?? "—" })}</Empty>;

  const td: React.CSSProperties = {
    padding: "12px",
    borderTop: `1px solid ${tokens.border}`,
    fontSize: 13,
    color: tokens.text,
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <>
      <RefreshBar
        cadenceSeconds={60}
        servedAtUnix={data.servedAtUnix}
        onReload={reload}
        loading={loading}
      />
      <Section
        title={t("adminops.pools.title")}
        note={t("adminops.pools.note", {
          n: data.pools.length,
          ago: ago(data.indexer.lastUpdateUnix),
        })}
        tooltip={t("adminops.tip.pools.title")}
      >
        {data.pools.length === 0 ? (
          <Empty>{t("adminops.pools.empty")}</Empty>
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
                <tr style={TH.row}>
                  <th style={{ ...TH.cell, paddingLeft: 16 }}>{t("adminops.col.pool")}</th>
                  <th style={TH.cell}>{t("adminops.col.status")}</th>
                  <th style={TH.cell}>{t("adminops.col.cycle")}</th>
                  <th style={TH.cell}>{t("adminops.col.members")}</th>
                  <th style={TH.cell}>{t("adminops.col.defaults")}</th>
                  <th style={TH.cell}>{t("adminops.col.health")}</th>
                  <th style={TH.cell}>{t("adminops.col.updated")}</th>
                </tr>
              </thead>
              <tbody>
                {data.pools.map((p) => (
                  <tr key={p.pda}>
                    <td style={{ ...td, paddingLeft: 16 }}>
                      <Link
                        href={`/admin/ops/pools/${p.pda}`}
                        style={{ color: tokens.text, textDecoration: "none" }}
                      >
                        <MonoLabel>{shortAddr(p.pda, 6, 6)}</MonoLabel>
                      </Link>
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
                    <td
                      style={{ ...td, color: p.defaultedMembers > 0 ? tokens.red : tokens.muted }}
                    >
                      {p.defaultedMembers}
                    </td>
                    <td style={td}>
                      <HealthPill health={p.health} />
                    </td>
                    <td style={{ ...td, color: tokens.muted, fontSize: 12 }}>
                      {ago(p.updatedAtUnix)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
