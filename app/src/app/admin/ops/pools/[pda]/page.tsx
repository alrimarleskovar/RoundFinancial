"use client";

// /admin/ops/pools/[pda] — pool detail. Structural state + on-chain member
// counters (indexer DB) + LIVE RPC snapshot cross-check + the per-cycle
// BEHAVIORAL timeline (events-derived; gate #5 cleared 2026-05-27).

import Link from "next/link";
import { useParams } from "next/navigation";

import { useApi } from "@/lib/admin/useApi";
import { useTheme } from "@/lib/theme";
import {
  agoLabel,
  Empty,
  fmtDuration,
  HealthPill,
  MonoLabel,
  Pill,
  Section,
  StatCard,
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
  startedAtUnix: number | null;
  nextCycleAtUnix: number | null;
  totalContributed: string;
  totalPaidOut: string;
  solidarityBalance: string;
  escrowBalance: string;
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
  slotIndex: number;
  onChainTsUnix: number;
  dueTsUnix: number | null;
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

function TimingPill({ e }: { e: TimelineEntry }) {
  const { tokens } = useTheme();
  if (e.eventType === "Claim") return <Pill text="payout" color={tokens.teal} />;
  if (e.eventType === "Default") return <Pill text="default" color={tokens.red} />;
  // Contribute timing from delta_seconds + grace (behavioral.ts semantics).
  if (e.deltaSeconds == null) return <Pill text="—" color={tokens.muted} />;
  if (e.deltaSeconds <= 0) return <Pill text="em dia" color={tokens.green} />;
  if (e.graceUsed) return <Pill text="grace" color={tokens.amber} />;
  return <Pill text="atrasado" color={tokens.red} />;
}

const TH: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: "uppercase",
  padding: "0 12px 10px",
};

export default function PoolDetailPage() {
  const { tokens } = useTheme();
  const params = useParams<{ pda: string }>();
  const pda = params.pda;
  const { data, loading, error, status } = useApi<DetailResponse>(`/api/admin/pools/${pda}`);

  if (loading) return <div style={{ color: tokens.muted, fontSize: 13 }}>carregando…</div>;
  if (status === 404) return <Empty>Pool não encontrado no indexer.</Empty>;
  if (error || !data)
    return <Empty>Não foi possível carregar o pool ({error ?? "sem dados"}).</Empty>;

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

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/admin/ops/pools"
          style={{ fontSize: 12, color: tokens.muted, textDecoration: "none" }}
        >
          ← Pools
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
          <MonoLabel>{shortAddr(p.pda, 8, 8)}</MonoLabel>
          <StatusPill status={p.status} />
          <HealthPill health={p.health} />
        </div>
      </div>

      <Section title="Estado do pool" note={`indexer · atualizado ${agoLabel(p.updatedAtUnix)}`}>
        <div style={grid}>
          <StatCard label="Ciclo" value={`${p.currentCycle}/${p.cyclesTotal}`} />
          <StatCard label="Membros" value={`${p.membersJoined}/${p.membersTarget}`} />
          <StatCard
            label="Defaults"
            value={p.defaultedMembers}
            tone={p.defaultedMembers === 0 ? "muted" : "default"}
          />
          <StatCard label="Contribuído" value={p.totalContributed} sub="USDC base units" />
          <StatCard label="Pago" value={p.totalPaidOut} sub="USDC base units" />
        </div>
      </Section>

      <Section title="RPC ao vivo (cross-check)" note="estado on-chain fresco vs indexer">
        {live == null ? (
          <Empty>RPC indisponível — exibindo apenas o estado do indexer acima.</Empty>
        ) : (
          <div style={grid}>
            <StatCard
              label="Status (live)"
              value={live.status}
              sub={live.status.toLowerCase() === p.status.toLowerCase() ? "= indexer" : "≠ indexer"}
              tone={live.status.toLowerCase() === p.status.toLowerCase() ? "muted" : "default"}
            />
            <StatCard
              label="Ciclo (live)"
              value={live.currentCycle}
              sub={live.currentCycle === p.currentCycle ? "= indexer" : `indexer ${p.currentCycle}`}
              tone={live.currentCycle === p.currentCycle ? "muted" : "default"}
            />
            <StatCard
              label="Defaults (live)"
              value={live.defaultedMembers}
              sub={
                live.defaultedMembers === p.defaultedMembers
                  ? "= indexer"
                  : `indexer ${p.defaultedMembers}`
              }
              tone={live.defaultedMembers === p.defaultedMembers ? "muted" : "default"}
            />
          </div>
        )}
      </Section>

      <Section title="Membros" note="contadores on-chain (chain truth, via backfill)">
        {members.length === 0 ? (
          <Empty>Nenhum member indexado.</Empty>
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
                  <th style={{ ...TH, paddingLeft: 16 }}>Slot</th>
                  <th style={TH}>Wallet</th>
                  <th style={TH}>Nível</th>
                  <th style={TH}>Pagos</th>
                  <th style={TH}>Em dia</th>
                  <th style={TH}>Atrasos</th>
                  <th style={TH}>Estado</th>
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
                        <Pill text="default" color={tokens.red} />
                      ) : m.paidOut ? (
                        <Pill text="contemplado" color={tokens.teal} />
                      ) : (
                        <Pill text="ativo" color={tokens.green} />
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
        title="Timeline comportamental"
        note={`events · projeção ${agoLabel(data.indexer.lastProjectionUnix)}`}
      >
        {timeline.length === 0 ? (
          <Empty>Sem eventos resolvidos para este pool ainda.</Empty>
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
                  <th style={{ ...TH, paddingLeft: 16 }}>Ciclo</th>
                  <th style={TH}>Evento</th>
                  <th style={TH}>Sujeito</th>
                  <th style={TH}>Timing</th>
                  <th style={TH}>Delta</th>
                  <th style={TH}>Motivo</th>
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
                      <TimingPill e={e} />
                    </td>
                    <td style={{ ...td, color: tokens.muted }}>
                      {e.deltaSeconds == null
                        ? "—"
                        : e.deltaSeconds <= 0
                          ? `−${fmtDuration(-e.deltaSeconds)}`
                          : `+${fmtDuration(e.deltaSeconds)}`}
                    </td>
                    <td style={{ ...td, color: tokens.muted, fontSize: 12 }}>
                      {e.defaultReason ? (
                        <span>
                          {e.defaultReason}{" "}
                          <span style={{ color: tokens.amber }}>
                            ({e.defaultReasonProvenance?.toLowerCase() ?? "inferred"})
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
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
