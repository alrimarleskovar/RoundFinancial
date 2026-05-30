"use client";

// /admin/ops/users — indexed wallets with a behavioral summary. Identity =
// wallet (per-wallet on-chain reputation; no cross-wallet linking). Rows
// link to the behavioral profile. Filtering is client-side over the full
// /api/admin/users payload (devnet volume is small; the UX cost is finding
// a wallet, not transferring the set). Promote to server-side paging in a
// separate PR when volume justifies it.

import { useState } from "react";
import Link from "next/link";

import { useApi } from "@/lib/admin/useApi";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import {
  agoLabel,
  Empty,
  MonoLabel,
  Pill,
  RefreshBar,
  Section,
  tableHeadStyles,
} from "@/components/adminops/ui";
import { shortAddr } from "@/lib/wallet";

interface UserRow {
  wallet: string;
  pools: number;
  level: number;
  timedContributions: number;
  onTime: number;
  onTimeRateBps: number | null;
  defaults: number;
}
interface UsersResponse {
  users: UserRow[];
  indexer: { lastUpdateUnix: number | null; lastProjectionUnix: number | null };
  servedAtUnix: number;
}

interface Filters {
  level: string;
  wallet: string;
  poolsMin: string;
  poolsMax: string;
  defaultsMin: string;
  defaultsMax: string;
  onTimeMin: string; // percent (0-100)
  onTimeMax: string; // percent (0-100)
}
const EMPTY: Filters = {
  level: "",
  wallet: "",
  poolsMin: "",
  poolsMax: "",
  defaultsMin: "",
  defaultsMax: "",
  onTimeMin: "",
  onTimeMax: "",
};

/** Parse a numeric filter input → number, or null when blank/invalid (= no bound). */
function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function inRange(v: number, min: number | null, max: number | null): boolean {
  if (min != null && v < min) return false;
  if (max != null && v > max) return false;
  return true;
}

function matchesFilters(u: UserRow, f: Filters): boolean {
  if (f.level && String(u.level) !== f.level) return false;
  const q = f.wallet.trim().toLowerCase();
  if (q && !u.wallet.toLowerCase().includes(q)) return false;
  if (!inRange(u.pools, numOrNull(f.poolsMin), numOrNull(f.poolsMax))) return false;
  if (!inRange(u.defaults, numOrNull(f.defaultsMin), numOrNull(f.defaultsMax))) return false;
  // On-time rate is stored in bps; filter inputs are percent. A null rate
  // means "no contributions with a due date yet" — included only when no
  // bound is set; excluded the moment the user defines a range (it's "no
  // data", not "0%").
  const otMin = numOrNull(f.onTimeMin);
  const otMax = numOrNull(f.onTimeMax);
  if (otMin != null || otMax != null) {
    if (u.onTimeRateBps == null) return false;
    if (!inRange(u.onTimeRateBps / 100, otMin, otMax)) return false;
  }
  return true;
}

function isAnyApplied(f: Filters): boolean {
  return Object.values(f).some((v) => v.trim() !== "");
}

export default function UsersPage() {
  const { tokens } = useTheme();
  const t = useT();
  const TH = tableHeadStyles(tokens);
  const [form, setForm] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const { data, loading, error, reload } = useApi<UsersResponse>("/api/admin/users");
  const ago = (u: number | null) => t("adminops.ago", { v: agoLabel(u) });

  if (loading && !data)
    return <div style={{ color: tokens.muted, fontSize: 13 }}>{t("adminops.loading")}</div>;
  if (error || !data) return <Empty>{t("adminops.users.err", { err: error ?? "—" })}</Empty>;

  const td: React.CSSProperties = {
    padding: "12px",
    borderTop: `1px solid ${tokens.border}`,
    fontSize: 13,
    color: tokens.text,
    fontVariantNumeric: "tabular-nums",
  };
  const input: React.CSSProperties = {
    background: tokens.surface2,
    border: `1px solid ${tokens.border}`,
    borderRadius: 8,
    color: tokens.text,
    fontSize: 13,
    padding: "7px 10px",
  };
  const numInput: React.CSSProperties = { ...input, width: 96 };
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

  const anyApplied = isAnyApplied(applied);
  const rows = anyApplied ? data.users.filter((u) => matchesFilters(u, applied)) : data.users;

  const note = anyApplied
    ? t("adminops.users.noteFiltered", {
        n: rows.length,
        total: data.users.length,
        ago: ago(data.indexer.lastProjectionUnix),
      })
    : t("adminops.users.note", {
        n: data.users.length,
        ago: ago(data.indexer.lastProjectionUnix),
      });

  return (
    <>
      <RefreshBar
        cadenceSeconds={null}
        servedAtUnix={data.servedAtUnix}
        onReload={reload}
        loading={loading}
      />
      <Section
        title={t("adminops.users.title")}
        note={note}
        tooltip={t("adminops.tip.users.title")}
      >
        {data.users.length === 0 ? (
          <Empty>{t("adminops.users.empty")}</Empty>
        ) : (
          <>
            {/* Filters — client-side over the full payload */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 18,
                alignItems: "center",
              }}
            >
              <select
                value={form.level}
                onChange={(e) => setForm({ ...form, level: e.target.value })}
                style={input}
              >
                <option value="">{t("adminops.economy.levelAll")}</option>
                <option value="1">L1</option>
                <option value="2">L2</option>
                <option value="3">L3</option>
              </select>
              <input
                value={form.wallet}
                onChange={(e) => setForm({ ...form, wallet: e.target.value })}
                placeholder={t("adminops.users.f.wallet")}
                style={{ ...input, width: 200 }}
              />
              <input
                type="number"
                value={form.poolsMin}
                onChange={(e) => setForm({ ...form, poolsMin: e.target.value })}
                placeholder={t("adminops.users.f.poolsMin")}
                style={numInput}
              />
              <input
                type="number"
                value={form.poolsMax}
                onChange={(e) => setForm({ ...form, poolsMax: e.target.value })}
                placeholder={t("adminops.users.f.poolsMax")}
                style={numInput}
              />
              <input
                type="number"
                value={form.defaultsMin}
                onChange={(e) => setForm({ ...form, defaultsMin: e.target.value })}
                placeholder={t("adminops.users.f.defaultsMin")}
                style={numInput}
              />
              <input
                type="number"
                value={form.defaultsMax}
                onChange={(e) => setForm({ ...form, defaultsMax: e.target.value })}
                placeholder={t("adminops.users.f.defaultsMax")}
                style={numInput}
              />
              <input
                type="number"
                value={form.onTimeMin}
                onChange={(e) => setForm({ ...form, onTimeMin: e.target.value })}
                placeholder={t("adminops.users.f.onTimeMin")}
                style={numInput}
              />
              <input
                type="number"
                value={form.onTimeMax}
                onChange={(e) => setForm({ ...form, onTimeMax: e.target.value })}
                placeholder={t("adminops.users.f.onTimeMax")}
                style={numInput}
              />
              <button type="button" onClick={() => setApplied(form)} style={btn(true)}>
                {t("adminops.events.apply")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm(EMPTY);
                  setApplied(EMPTY);
                }}
                style={btn(false)}
              >
                {t("adminops.events.clear")}
              </button>
            </div>

            {rows.length === 0 ? (
              <Empty>{t("adminops.users.emptyFiltered")}</Empty>
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
                      <th style={{ ...TH.cell, paddingLeft: 16 }}>{t("adminops.col.wallet")}</th>
                      <th style={TH.cell}>{t("adminops.col.level")}</th>
                      <th style={TH.cell}>{t("adminops.col.pools")}</th>
                      <th style={TH.cell}>{t("adminops.col.onTime")}</th>
                      <th style={TH.cell}>{t("adminops.col.defaults")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u) => (
                      <tr key={u.wallet}>
                        <td style={{ ...td, paddingLeft: 16 }}>
                          <Link
                            href={`/admin/ops/users/${u.wallet}`}
                            style={{ color: tokens.text, textDecoration: "none" }}
                          >
                            <MonoLabel>{shortAddr(u.wallet, 6, 6)}</MonoLabel>
                          </Link>
                        </td>
                        <td style={td}>
                          <span style={{ color: tokens.muted }}>L</span>
                          {u.level}
                        </td>
                        <td style={td}>{u.pools}</td>
                        <td style={td}>
                          {u.onTimeRateBps == null ? (
                            <span style={{ color: tokens.muted }}>—</span>
                          ) : (
                            <>
                              {(u.onTimeRateBps / 100).toFixed(0)}%
                              <span style={{ color: tokens.muted, fontSize: 12 }}>
                                {" "}
                                ({u.onTime}/{u.timedContributions})
                              </span>
                            </>
                          )}
                        </td>
                        <td style={td}>
                          {u.defaults > 0 ? (
                            <Pill text={String(u.defaults)} color={tokens.red} />
                          ) : (
                            <span style={{ color: tokens.muted }}>0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Section>
    </>
  );
}
