"use client";

// /admin/ops/events — the "black-box recorder": filterable, paginated view
// of the normalized events table, with CSV/JSON export of the current slice
// (the product asset; auth + audit-logged server-side). behavioral.ts timing
// via the shared TimingPill. Staleness surfaced (events is batch-projected).

import { useState } from "react";

import { useApi } from "@/lib/admin/useApi";
import { useTheme } from "@/lib/theme";
import {
  agoLabel,
  Empty,
  fmtDuration,
  MonoLabel,
  Section,
  TimingPill,
} from "@/components/adminops/ui";
import { shortAddr } from "@/lib/wallet";

interface EventRow {
  txSig: string;
  eventType: string;
  subjectWallet: string;
  poolPda: string;
  cycle: number;
  onChainTsUnix: number;
  deltaSeconds: number | null;
  graceUsed: boolean;
}
interface EventsResponse {
  rows: EventRow[];
  total: number;
  limit: number;
  offset: number;
  indexer: { lastProjectionUnix: number | null };
  servedAtUnix: number;
}

interface Filters {
  eventType: string;
  timing: string;
  poolPda: string;
  subjectWallet: string;
  from: string; // yyyy-mm-dd
  to: string;
}
const EMPTY: Filters = {
  eventType: "",
  timing: "",
  poolPda: "",
  subjectWallet: "",
  from: "",
  to: "",
};

function dateToUnix(d: string, endOfDay: boolean): number | null {
  if (!d) return null;
  const ms = Date.parse(`${d}T${endOfDay ? "23:59:59" : "00:00:00"}Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function buildQuery(f: Filters, extra: Record<string, string | number>): string {
  const p = new URLSearchParams();
  if (f.eventType) p.set("eventType", f.eventType);
  if (f.timing) p.set("timing", f.timing);
  if (f.poolPda.trim()) p.set("poolPda", f.poolPda.trim());
  if (f.subjectWallet.trim()) p.set("subjectWallet", f.subjectWallet.trim());
  const from = dateToUnix(f.from, false);
  const to = dateToUnix(f.to, true);
  if (from != null) p.set("fromUnix", String(from));
  if (to != null) p.set("toUnix", String(to));
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
}

const TH: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: "uppercase",
  padding: "0 12px 10px",
};
const PAGE = 50;

export default function EventsPage() {
  const { tokens } = useTheme();
  const [form, setForm] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [offset, setOffset] = useState(0);

  const qs = buildQuery(applied, { limit: PAGE, offset });
  const { data, loading, error } = useApi<EventsResponse>(`/api/admin/events?${qs}`);

  const input: React.CSSProperties = {
    background: tokens.surface2,
    border: `1px solid ${tokens.border}`,
    borderRadius: 8,
    color: tokens.text,
    fontSize: 13,
    padding: "7px 10px",
  };
  const td: React.CSSProperties = {
    padding: "10px 12px",
    borderTop: `1px solid ${tokens.border}`,
    fontSize: 13,
    color: tokens.text,
    fontVariantNumeric: "tabular-nums",
  };
  const btn = (primary: boolean): React.CSSProperties => ({
    padding: "7px 14px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    border: primary ? "none" : `1px solid ${tokens.border}`,
    background: primary ? tokens.green : "transparent",
    color: primary ? tokens.bg : tokens.text2,
  });

  const apply = () => {
    setApplied(form);
    setOffset(0);
  };
  const exportUrl = (format: "csv" | "json") =>
    `/api/admin/events/export?${buildQuery(applied, { format })}`;

  return (
    <Section
      title="Eventos"
      note={
        data
          ? `${data.total} eventos · projeção ${agoLabel(data.indexer.lastProjectionUnix)}`
          : "black-box recorder"
      }
    >
      {/* Filters */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 14,
          alignItems: "center",
        }}
      >
        <select
          value={form.eventType}
          onChange={(e) => setForm({ ...form, eventType: e.target.value })}
          style={input}
        >
          <option value="">tipo: todos</option>
          <option value="Contribute">Contribute</option>
          <option value="Claim">Claim</option>
          <option value="Default">Default</option>
        </select>
        <select
          value={form.timing}
          onChange={(e) => setForm({ ...form, timing: e.target.value })}
          style={input}
        >
          <option value="">timing: todos</option>
          <option value="on_time">em dia</option>
          <option value="grace">grace</option>
          <option value="late">atrasado</option>
        </select>
        <input
          placeholder="pool pda"
          value={form.poolPda}
          onChange={(e) => setForm({ ...form, poolPda: e.target.value })}
          style={{ ...input, width: 150 }}
        />
        <input
          placeholder="wallet"
          value={form.subjectWallet}
          onChange={(e) => setForm({ ...form, subjectWallet: e.target.value })}
          style={{ ...input, width: 150 }}
        />
        <input
          type="date"
          value={form.from}
          onChange={(e) => setForm({ ...form, from: e.target.value })}
          style={input}
        />
        <input
          type="date"
          value={form.to}
          onChange={(e) => setForm({ ...form, to: e.target.value })}
          style={input}
        />
        <button type="button" onClick={apply} style={btn(true)}>
          Aplicar
        </button>
        <button
          type="button"
          onClick={() => {
            setForm(EMPTY);
            setApplied(EMPTY);
            setOffset(0);
          }}
          style={btn(false)}
        >
          Limpar
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => window.open(exportUrl("csv"), "_blank")}
          style={btn(false)}
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => window.open(exportUrl("json"), "_blank")}
          style={btn(false)}
        >
          Export JSON
        </button>
      </div>

      {loading ? (
        <div style={{ color: tokens.muted, fontSize: 13 }}>carregando…</div>
      ) : error || !data ? (
        <Empty>Não foi possível carregar os eventos ({error ?? "sem dados"}).</Empty>
      ) : data.rows.length === 0 ? (
        <Empty>Nenhum evento para este filtro.</Empty>
      ) : (
        <>
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
                  <th style={{ ...TH, paddingLeft: 16 }}>Quando</th>
                  <th style={TH}>Evento</th>
                  <th style={TH}>Sujeito</th>
                  <th style={TH}>Pool</th>
                  <th style={TH}>Ciclo</th>
                  <th style={TH}>Timing</th>
                  <th style={TH}>Delta</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((e) => (
                  <tr key={`${e.txSig}-${e.eventType}`}>
                    <td style={{ ...td, paddingLeft: 16, color: tokens.muted, fontSize: 12 }}>
                      {agoLabel(e.onChainTsUnix)}
                    </td>
                    <td style={td}>{e.eventType}</td>
                    <td style={td}>
                      <MonoLabel>{shortAddr(e.subjectWallet, 5, 5)}</MonoLabel>
                    </td>
                    <td style={td}>
                      <MonoLabel>{shortAddr(e.poolPda, 4, 4)}</MonoLabel>
                    </td>
                    <td style={td}>{e.cycle}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 12,
              fontSize: 12,
              color: tokens.muted,
            }}
          >
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
              style={{ ...btn(false), opacity: offset === 0 ? 0.4 : 1 }}
            >
              ← anterior
            </button>
            <span>
              {offset + 1}–{Math.min(offset + PAGE, data.total)} de {data.total}
            </span>
            <button
              type="button"
              disabled={offset + PAGE >= data.total}
              onClick={() => setOffset(offset + PAGE)}
              style={{ ...btn(false), opacity: offset + PAGE >= data.total ? 0.4 : 1 }}
            >
              próximo →
            </button>
          </div>
        </>
      )}
    </Section>
  );
}
