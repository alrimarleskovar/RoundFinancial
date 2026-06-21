"use client";

// /admin/ops/economy — protocol-wide financial + risk + moat + health
// aggregates (ADR 0009). INSTRUMENTATION, not traction: a LOUD devnet banner
// makes clear these are test/seed numbers; the same panel measures mainnet.
// Direct sums/counts only — correlation is Insights (deferred). i18n chrome.

import { useState } from "react";

import { useApi } from "@/lib/admin/useApi";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import {
  agoLabel,
  Empty,
  formatInt,
  formatPct,
  formatUsdc,
  RefreshBar,
  Section,
  StatCard,
} from "@/components/adminops/ui";

interface Economy {
  capital: {
    committedCredit: string;
    custodied: string;
    contributed: string;
    paidOut: string;
    yieldAccrued: string;
    protocolFees: string;
    guaranteeFund: string;
    solidarity: string;
  };
  risk: {
    totalMembers: number;
    defaultedMembers: number;
    defaultRateBps: number | null;
    seizedTotal: string;
    defaultEvents: number;
  };
  moat: {
    levelDistribution: { l1: number; l2: number; l3: number; l4: number };
    distinctWallets: number;
    onTime: number;
    timedContributions: number;
    onTimeRateBps: number | null;
    repeatWallets: number;
    retentionBps: number | null;
  };
  health: {
    byStatus: Record<string, number>;
    totalPools: number;
    completionRateBps: number | null;
  };
  indexer: { lastProjectionUnix: number | null };
}
interface EconomyResponse {
  economy: Economy;
  servedAtUnix: number;
}

interface Filters {
  status: string;
  level: string;
  from: string;
  to: string;
}
const EMPTY: Filters = { status: "", level: "", from: "", to: "" };

function dateToUnix(d: string, endOfDay: boolean): number | null {
  if (!d) return null;
  const ms = Date.parse(`${d}T${endOfDay ? "23:59:59" : "00:00:00"}Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}
function buildQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.status) p.set("status", f.status);
  if (f.level) p.set("level", f.level);
  const from = dateToUnix(f.from, false);
  const to = dateToUnix(f.to, true);
  if (from != null) p.set("fromUnix", String(from));
  if (to != null) p.set("toUnix", String(to));
  return p.toString();
}
/** Integer-percent of a count vs total, for the level distribution display. */
const lvPct = (n: number, total: number) =>
  total > 0 ? `${Math.round((n / total) * 100)}%` : "0%";

export default function EconomyPage() {
  const { tokens } = useTheme();
  const t = useT();
  const [form, setForm] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const { data, loading, error, reload } = useApi<EconomyResponse>(
    `/api/admin/economy?${buildQuery(applied)}`,
  );
  const ago = (u: number | null) => t("adminops.ago", { v: agoLabel(u) });

  const grid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  } as const;
  const input: React.CSSProperties = {
    background: tokens.surface2,
    border: `1px solid ${tokens.border}`,
    borderRadius: 8,
    color: tokens.text,
    fontSize: 13,
    padding: "7px 10px",
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

  return (
    <div>
      <RefreshBar
        cadenceSeconds={null}
        servedAtUnix={data?.servedAtUnix ?? null}
        onReload={reload}
        loading={loading}
      />
      {/* LOUD devnet banner — instrumentation, not traction. */}
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
        {t("adminops.economy.banner")}
      </div>

      {/* Filters */}
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
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
          style={input}
        >
          <option value="">{t("adminops.economy.statusAll")}</option>
          <option value="Forming">Forming</option>
          <option value="Active">Active</option>
          <option value="Completed">Completed</option>
          <option value="Liquidated">Liquidated</option>
          <option value="Closed">Closed</option>
        </select>
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

      {loading ? (
        <div style={{ color: tokens.muted, fontSize: 13 }}>{t("adminops.loading")}</div>
      ) : error || !data ? (
        <Empty>{t("adminops.economy.err", { err: error ?? "—" })}</Empty>
      ) : (
        (() => {
          const e = data.economy;
          return (
            <>
              <Section
                title={t("adminops.economy.capital")}
                note={t("adminops.economy.note", { ago: ago(e.indexer.lastProjectionUnix) })}
                tooltip={t("adminops.tip.economy.capital")}
              >
                <div style={grid}>
                  <StatCard
                    label={t("adminops.economy.committedCredit")}
                    value={formatUsdc(e.capital.committedCredit)}
                    sub={t("adminops.economy.committedCreditSub")}
                    tooltip={t("adminops.tip.eco.committedCredit")}
                  />
                  <StatCard
                    label={t("adminops.economy.custodied")}
                    value={formatUsdc(e.capital.custodied)}
                    sub={t("adminops.economy.custodiedSub")}
                    tooltip={t("adminops.tip.eco.custodied")}
                  />
                  <StatCard
                    label={t("adminops.economy.contributed")}
                    value={formatUsdc(e.capital.contributed)}
                    sub={t("adminops.economy.usdcUnits")}
                    tooltip={t("adminops.tip.eco.contributed")}
                  />
                  <StatCard
                    label={t("adminops.economy.paidOut")}
                    value={formatUsdc(e.capital.paidOut)}
                    sub={t("adminops.economy.usdcUnits")}
                    tooltip={t("adminops.tip.eco.paidOut")}
                  />
                  <StatCard
                    label={t("adminops.economy.yield")}
                    value={formatUsdc(e.capital.yieldAccrued)}
                    sub={t("adminops.economy.yieldSub")}
                    tooltip={t("adminops.tip.eco.yield")}
                  />
                  <StatCard
                    label={t("adminops.economy.fees")}
                    value={formatUsdc(e.capital.protocolFees)}
                    sub={t("adminops.economy.feesSub")}
                    tooltip={t("adminops.tip.eco.fees")}
                  />
                  <StatCard
                    label={t("adminops.economy.guaranteeFund")}
                    value={formatUsdc(e.capital.guaranteeFund)}
                    sub={t("adminops.economy.usdcUnits")}
                    tooltip={t("adminops.tip.eco.guaranteeFund")}
                  />
                  <StatCard
                    label={t("adminops.economy.solidarity")}
                    value={formatUsdc(e.capital.solidarity)}
                    sub={t("adminops.economy.usdcUnits")}
                    tooltip={t("adminops.tip.eco.solidarity")}
                  />
                </div>
              </Section>

              <Section title={t("adminops.economy.risk")} tooltip={t("adminops.tip.economy.risk")}>
                <div style={grid}>
                  <StatCard
                    label={t("adminops.economy.defaultRate")}
                    value={formatPct(e.risk.defaultRateBps)}
                    sub={t("adminops.economy.defaultRateSub", {
                      d: e.risk.defaultedMembers,
                      n: e.risk.totalMembers,
                    })}
                    tone={e.risk.defaultedMembers === 0 ? "muted" : "default"}
                    tooltip={t("adminops.tip.eco.defaultRate")}
                  />
                  <StatCard
                    label={t("adminops.economy.seized")}
                    value={formatUsdc(e.risk.seizedTotal)}
                    sub={t("adminops.economy.seizedSub")}
                    tooltip={t("adminops.tip.eco.seized")}
                  />
                  <StatCard
                    label={t("adminops.economy.defaultEvents")}
                    value={e.risk.defaultEvents}
                    tone={e.risk.defaultEvents === 0 ? "muted" : "default"}
                    tooltip={t("adminops.tip.eco.defaultEvents")}
                  />
                </div>
              </Section>

              <Section title={t("adminops.economy.moat")} tooltip={t("adminops.tip.economy.moat")}>
                <div style={grid}>
                  <StatCard
                    label={t("adminops.economy.levelDist")}
                    value={
                      e.moat.distinctWallets === 0
                        ? "—"
                        : `L1 ${lvPct(e.moat.levelDistribution.l1, e.moat.distinctWallets)} · L2 ${lvPct(e.moat.levelDistribution.l2, e.moat.distinctWallets)} · L3 ${lvPct(e.moat.levelDistribution.l3, e.moat.distinctWallets)} · L4 ${lvPct(e.moat.levelDistribution.l4, e.moat.distinctWallets)}`
                    }
                    sub={`${formatInt(e.moat.levelDistribution.l1)} / ${formatInt(e.moat.levelDistribution.l2)} / ${formatInt(e.moat.levelDistribution.l3)} / ${formatInt(e.moat.levelDistribution.l4)} · ${t("adminops.economy.levelDistSub")}`}
                    tooltip={t("adminops.tip.eco.levelDist")}
                  />
                  <StatCard
                    label={t("adminops.economy.onTimeAgg")}
                    value={formatPct(e.moat.onTimeRateBps)}
                    sub={t("adminops.economy.onTimeAggSub", {
                      ot: e.moat.onTime,
                      total: e.moat.timedContributions,
                    })}
                    tooltip={t("adminops.tip.eco.onTimeAgg")}
                  />
                  <StatCard
                    label={t("adminops.economy.retention")}
                    value={formatPct(e.moat.retentionBps)}
                    sub={t("adminops.economy.retentionSub", {
                      r: e.moat.repeatWallets,
                      n: e.moat.distinctWallets,
                    })}
                    tooltip={t("adminops.tip.eco.retention")}
                  />
                </div>
                {e.moat.distinctWallets > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      height: 8,
                      marginTop: 12,
                      borderRadius: 999,
                      overflow: "hidden",
                      background: tokens.fillSoft,
                    }}
                  >
                    {(
                      [
                        ["l1", tokens.muted],
                        ["l2", tokens.teal],
                        ["l3", tokens.green],
                      ] as const
                    ).map(([k, c]) => {
                      const n = e.moat.levelDistribution[k];
                      const w = (n / e.moat.distinctWallets) * 100;
                      return w > 0 ? (
                        <div
                          key={k}
                          title={`${k.toUpperCase()} ${n}`}
                          style={{ width: `${w}%`, background: c }}
                        />
                      ) : null;
                    })}
                  </div>
                ) : null}
              </Section>

              <Section
                title={t("adminops.economy.health")}
                tooltip={t("adminops.tip.economy.health")}
              >
                <div style={grid}>
                  <StatCard
                    label={t("adminops.economy.completion")}
                    value={formatPct(e.health.completionRateBps)}
                    sub={t("adminops.economy.completionSub")}
                    tooltip={t("adminops.tip.eco.completion")}
                  />
                  {(["Forming", "Active", "Completed", "Liquidated", "Closed"] as const).map(
                    (s) => (
                      <StatCard
                        key={s}
                        label={s}
                        value={e.health.byStatus[s] ?? 0}
                        tone={(e.health.byStatus[s] ?? 0) === 0 ? "muted" : "default"}
                      />
                    ),
                  )}
                </div>
              </Section>
            </>
          );
        })()
      )}
    </div>
  );
}
