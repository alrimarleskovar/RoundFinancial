"use client";

// /admin/ops/pools/[pda] — pool detail. Structural state + on-chain member
// counters (indexer DB) + LIVE RPC snapshot cross-check + the per-cycle
// BEHAVIORAL timeline (events-derived; gate #5 cleared 2026-05-27).

import Link from "next/link";
import { useParams } from "next/navigation";

import { useApi } from "@/lib/admin/useApi";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import {
  agoLabel,
  Empty,
  fmtDuration,
  formatUsdc,
  HealthPill,
  MonoLabel,
  Pill,
  Section,
  StatCard,
  StatusPill,
  tableHeadStyles,
  TimingPill,
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
  totalContributed: string;
  totalPaidOut: string;
  health: "healthy" | "at_risk" | "distressed";
  updatedAtUnix: number;
}
interface MemberRow {
  wallet: string;
  slotIndex: number;
  reputationLevel: number;
  contributionsPaid: number;
  onTimeCount: number;
  lateCount: number;
  defaulted: boolean;
  paidOut: boolean;
}
interface TimelineEntry {
  txSig: string;
  eventType: string;
  subjectWallet: string;
  cycle: number;
  deltaSeconds: number | null;
  graceUsed: boolean;
  defaultReason: string | null;
  defaultReasonProvenance: string | null;
}
interface LiveSnapshot {
  status: string;
  currentCycle: number;
  membersJoined: number;
  defaultedMembers: number;
}
interface DetailResponse {
  pool: PoolRow;
  members: MemberRow[];
  timeline: TimelineEntry[];
  live: LiveSnapshot | null;
  indexer: { lastUpdateUnix: number | null; lastProjectionUnix: number | null };
  servedAtUnix: number;
}

export default function PoolDetailPage() {
  const { tokens } = useTheme();
  const t = useT();
  const TH = tableHeadStyles(tokens);
  const params = useParams<{ pda: string }>();
  const pda = params.pda;
  const { data, loading, error, status } = useApi<DetailResponse>(`/api/admin/pools/${pda}`);
  const ago = (u: number | null) => t("adminops.ago", { v: agoLabel(u) });

  if (loading)
    return <div style={{ color: tokens.muted, fontSize: 13 }}>{t("adminops.loading")}</div>;
  if (status === 404) return <Empty>{t("adminops.pool.notFound")}</Empty>;
  if (error || !data) return <Empty>{t("adminops.pool.err", { err: error ?? "—" })}</Empty>;

  const { pool: p, members, timeline, live } = data;
  const grid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
  } as const;
  const td: React.CSSProperties = {
    padding: "10px 12px",
    borderTop: `1px solid ${tokens.border}`,
    fontSize: 13,
    color: tokens.text,
    fontVariantNumeric: "tabular-nums",
  };
  const cmp = (a: unknown, b: unknown) =>
    a === b ? t("adminops.pool.eqIndexer") : t("adminops.pool.neIndexer");

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/admin/ops/pools"
          style={{ fontSize: 12, color: tokens.muted, textDecoration: "none" }}
        >
          {t("adminops.pool.back")}
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
          <MonoLabel>{shortAddr(p.pda, 8, 8)}</MonoLabel>
          <StatusPill status={p.status} />
          <HealthPill health={p.health} />
        </div>
      </div>

      <Section
        title={t("adminops.pool.state")}
        note={t("adminops.pool.stateNote", { ago: ago(p.updatedAtUnix) })}
      >
        <div style={grid}>
          <StatCard label={t("adminops.col.cycle")} value={`${p.currentCycle}/${p.cyclesTotal}`} />
          <StatCard
            label={t("adminops.col.members")}
            value={`${p.membersJoined}/${p.membersTarget}`}
          />
          <StatCard
            label={t("adminops.col.defaults")}
            value={p.defaultedMembers}
            tone={p.defaultedMembers === 0 ? "muted" : "default"}
          />
          <StatCard
            label={t("adminops.pool.contributed")}
            value={formatUsdc(p.totalContributed)}
            sub={t("adminops.pool.usdcUnits")}
          />
          <StatCard
            label={t("adminops.pool.paid")}
            value={formatUsdc(p.totalPaidOut)}
            sub={t("adminops.pool.usdcUnits")}
          />
        </div>
      </Section>

      <Section title={t("adminops.pool.rpc")} note={t("adminops.pool.rpcNote")}>
        {live == null ? (
          <Empty>{t("adminops.pool.rpcUnavailable")}</Empty>
        ) : (
          <div style={grid}>
            <StatCard
              label={t("adminops.pool.statusLive")}
              value={live.status}
              sub={cmp(live.status.toLowerCase(), p.status.toLowerCase())}
              tone={live.status.toLowerCase() === p.status.toLowerCase() ? "muted" : "default"}
            />
            <StatCard
              label={t("adminops.pool.cycleLive")}
              value={live.currentCycle}
              sub={
                live.currentCycle === p.currentCycle
                  ? t("adminops.pool.eqIndexer")
                  : t("adminops.pool.indexerVal", { v: p.currentCycle })
              }
              tone={live.currentCycle === p.currentCycle ? "muted" : "default"}
            />
            <StatCard
              label={t("adminops.pool.defaultsLive")}
              value={live.defaultedMembers}
              sub={
                live.defaultedMembers === p.defaultedMembers
                  ? t("adminops.pool.eqIndexer")
                  : t("adminops.pool.indexerVal", { v: p.defaultedMembers })
              }
              tone={live.defaultedMembers === p.defaultedMembers ? "muted" : "default"}
            />
          </div>
        )}
      </Section>

      <Section title={t("adminops.col.members")} note={t("adminops.pool.membersNote")}>
        {members.length === 0 ? (
          <Empty>{t("adminops.pool.membersEmpty")}</Empty>
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
                  <th style={{ ...TH.cell, paddingLeft: 16 }}>{t("adminops.col.slot")}</th>
                  <th style={TH.cell}>{t("adminops.col.wallet")}</th>
                  <th style={TH.cell}>{t("adminops.col.level")}</th>
                  <th style={TH.cell}>{t("adminops.col.paid")}</th>
                  <th style={TH.cell}>{t("adminops.col.onTime")}</th>
                  <th style={TH.cell}>{t("adminops.col.late")}</th>
                  <th style={TH.cell}>{t("adminops.col.state")}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.slotIndex}>
                    <td style={{ ...td, paddingLeft: 16 }}>{m.slotIndex}</td>
                    <td style={td}>
                      <MonoLabel>{shortAddr(m.wallet, 5, 5)}</MonoLabel>
                    </td>
                    <td style={td}>L{m.reputationLevel}</td>
                    <td style={td}>{m.contributionsPaid}</td>
                    <td style={{ ...td, color: tokens.green }}>{m.onTimeCount}</td>
                    <td style={{ ...td, color: m.lateCount > 0 ? tokens.amber : tokens.muted }}>
                      {m.lateCount}
                    </td>
                    <td style={td}>
                      {m.defaulted ? (
                        <Pill text={t("adminops.member.default")} color={tokens.red} />
                      ) : m.paidOut ? (
                        <Pill text={t("adminops.member.contemplated")} color={tokens.teal} />
                      ) : (
                        <Pill text={t("adminops.member.active")} color={tokens.green} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title={t("adminops.pool.timeline")}
        note={t("adminops.pool.timelineNote", { ago: ago(data.indexer.lastProjectionUnix) })}
      >
        {timeline.length === 0 ? (
          <Empty>{t("adminops.pool.timelineEmpty")}</Empty>
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
                  <th style={{ ...TH.cell, paddingLeft: 16 }}>{t("adminops.col.cycle")}</th>
                  <th style={TH.cell}>{t("adminops.col.event")}</th>
                  <th style={TH.cell}>{t("adminops.col.subject")}</th>
                  <th style={TH.cell}>{t("adminops.col.timing")}</th>
                  <th style={TH.cell}>{t("adminops.col.delta")}</th>
                  <th style={TH.cell}>{t("adminops.col.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((e) => (
                  <tr key={`${e.txSig}-${e.eventType}`}>
                    <td style={{ ...td, paddingLeft: 16 }}>{e.cycle}</td>
                    <td style={td}>{e.eventType}</td>
                    <td style={td}>
                      <MonoLabel>{shortAddr(e.subjectWallet, 5, 5)}</MonoLabel>
                    </td>
                    <td style={td}>
                      <TimingPill
                        eventType={e.eventType}
                        deltaSeconds={e.deltaSeconds}
                        graceUsed={e.graceUsed}
                      />
                    </td>
                    <td style={{ ...td, color: tokens.muted }}>
                      {e.deltaSeconds == null
                        ? "—"
                        : e.deltaSeconds <= 0
                          ? `−${fmtDuration(-e.deltaSeconds)}`
                          : `+${fmtDuration(e.deltaSeconds)}`}
                    </td>
                    <td style={{ ...td, color: tokens.muted, fontSize: 12 }}>
                      {e.defaultReason
                        ? `${e.defaultReason} (${e.defaultReasonProvenance?.toLowerCase() ?? "inferred"})`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
