"use client";

import { useEffect, useMemo, useState } from "react";

import { CrankPayoutModal } from "@/components/modals/CrankPayoutModal";
import { SettleDefaultCrankModal } from "@/components/modals/SettleDefaultCrankModal";
import { GRACE_PERIOD_SECS, type DevnetPoolKey } from "@/lib/devnet";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { usePoolRadar, type PoolRadarEntry, type PoolRadarStatus } from "@/lib/usePoolRadar";

// /admin/cranker — operator surface for the two permissionless liveness
// cranks (settle_default + crank_payout). Both instructions are callable by
// ANYONE on-chain; this page just makes the workflow ergonomic. NOT linked
// from the public nav — operators reach it via direct URL.
//
// The page leads with a plain-language explanation (who can run this, and the
// difference between the two actions), then a "pool radar" that scans every
// devnet pool at once so the operator sees where action is needed without
// opening each pool one by one, and finally the two modals that do the work.

const MONO = "var(--font-jetbrains-mono), JetBrains Mono, monospace";
const SYNE = "var(--font-syne), system-ui, sans-serif";

/** Format a seconds countdown into a compact human string (6d 23h / 45m 12s). */
function formatCountdown(secs: number): string {
  if (secs <= 0) return "";
  const d = Math.floor(secs / 86_400);
  const h = Math.floor((secs % 86_400) / 3_600);
  const m = Math.floor((secs % 3_600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function CrankerPage() {
  const { tokens } = useTheme();
  const t = useT();

  // Modals — each remembers which pool the radar pre-targeted it at.
  const [settleOpen, setSettleOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [settlePool, setSettlePool] = useState<DevnetPoolKey | undefined>(undefined);
  const [payoutPool, setPayoutPool] = useState<DevnetPoolKey | undefined>(undefined);

  const openSettle = (pool?: DevnetPoolKey) => {
    setSettlePool(pool);
    setSettleOpen(true);
  };
  const openPayout = (pool?: DevnetPoolKey) => {
    setPayoutPool(pool);
    setPayoutOpen(true);
  };

  const card: React.CSSProperties = {
    padding: 20,
    borderRadius: 16,
    background: tokens.fillSoft,
    border: `1px solid ${tokens.border}`,
    marginBottom: 16,
  };
  const h2: React.CSSProperties = {
    fontSize: 15,
    fontWeight: 700,
    margin: "0 0 8px",
    color: tokens.text,
    fontFamily: SYNE,
  };
  const body: React.CSSProperties = {
    fontSize: 13,
    color: tokens.muted,
    lineHeight: 1.65,
    margin: 0,
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: tokens.bg,
        color: tokens.text,
        padding: "48px 24px",
        fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, margin: "0 0 12px", fontFamily: SYNE }}>
            {t("admin.cranker.title")}
          </h1>
          <p style={{ ...body, fontSize: 14 }}>{t("admin.cranker.intro")}</p>
        </div>

        {/* Who can run this */}
        <div style={card}>
          <h2 style={h2}>{t("admin.cranker.who.title")}</h2>
          <p style={body}>{t("admin.cranker.who.body")}</p>
        </div>

        {/* The two actions, side by side */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ ...card, flex: 1, minWidth: 260, marginBottom: 0 }}>
            <h2 style={h2}>{t("admin.cranker.settle.title")}</h2>
            <p style={body}>{t("admin.cranker.settle.body")}</p>
          </div>
          <div style={{ ...card, flex: 1, minWidth: 260, marginBottom: 0 }}>
            <h2 style={h2}>{t("admin.cranker.payout.title")}</h2>
            <p style={body}>{t("admin.cranker.payout.body")}</p>
          </div>
        </div>

        {/* What's the difference */}
        <div
          style={{
            ...card,
            background: `${tokens.green}0D`,
            border: `1px solid ${tokens.green}33`,
          }}
        >
          <h2 style={h2}>{t("admin.cranker.diff.title")}</h2>
          <p style={body}>{t("admin.cranker.diff.body")}</p>
        </div>

        {/* Pool radar — scan every pool at once */}
        <PoolRadar openSettle={openSettle} openPayout={openPayout} />

        {/* Manual entry points (pick the pool inside the modal) */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
          <button
            type="button"
            onClick={() => openSettle(undefined)}
            style={{
              padding: "14px 22px",
              borderRadius: 12,
              background: tokens.green,
              color: tokens.bg,
              border: "none",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
              fontFamily: SYNE,
              letterSpacing: 0.4,
              textTransform: "uppercase",
            }}
          >
            {t("admin.cranker.openSettle")}
          </button>
          <button
            type="button"
            onClick={() => openPayout(undefined)}
            style={{
              padding: "14px 22px",
              borderRadius: 12,
              background: "transparent",
              color: tokens.green,
              border: `1px solid ${tokens.green}`,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
              fontFamily: SYNE,
              letterSpacing: 0.4,
              textTransform: "uppercase",
            }}
          >
            {t("admin.cranker.openPayout")}
          </button>
        </div>

        <SettleDefaultCrankModal
          open={settleOpen}
          onClose={() => setSettleOpen(false)}
          initialPool={settlePool}
        />
        <CrankPayoutModal
          open={payoutOpen}
          onClose={() => setPayoutOpen(false)}
          initialPool={payoutPool}
        />
      </div>
    </main>
  );
}

/**
 * PoolRadar — live scan of every devnet pool, flagging which need a crank.
 * `usePoolRadar` does the (30s) fetch; this component ticks a 1s clock to keep
 * the grace countdowns smooth and derives eligibility against the shared
 * `GRACE_PERIOD_SECS`, exactly like the two modals.
 */
function PoolRadar({
  openSettle,
  openPayout,
}: {
  openSettle: (pool?: DevnetPoolKey) => void;
  openPayout: (pool?: DevnetPoolKey) => void;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const { entries, loading } = usePoolRadar();
  const [onlyActionable, setOnlyActionable] = useState(false);
  const [now, setNow] = useState<bigint>(BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => {
    const id = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => clearInterval(id);
  }, []);

  // Derive per-pool action state against the ticking clock.
  const rows = useMemo(() => {
    return entries.map((e) => {
      const graceRemaining =
        e.nextCycleAt != null ? Number(e.nextCycleAt + GRACE_PERIOD_SECS - now) : 0;
      const needsPayout = e.payoutTarget != null;
      const needsSettle = e.settleCandidates > 0;
      return {
        entry: e,
        graceRemaining,
        needsPayout,
        needsSettle,
        payoutReady: needsPayout && graceRemaining <= 0,
        settleReady: needsSettle && graceRemaining <= 0,
        actionable: needsPayout || needsSettle,
      };
    });
  }, [entries, now]);

  const visible = onlyActionable ? rows.filter((r) => r.actionable) : rows;

  const statusLabel = (s: PoolRadarStatus | null): string => {
    switch (s) {
      case "active":
        return t("admin.cranker.radar.status.active");
      case "forming":
        return t("admin.cranker.radar.status.forming");
      case "completed":
      case "liquidated":
      case "closed":
        return t("admin.cranker.radar.status.completed");
      default:
        return "—";
    }
  };
  const poolName = (key: DevnetPoolKey): string =>
    t(`home.devnet.${key}.label`).split("·")[0].trim();

  const readyChip = (
    <span style={{ color: tokens.green, fontWeight: 700 }}>{t("admin.cranker.radar.ready")}</span>
  );
  const graceChip = (secs: number) => (
    <span style={{ color: tokens.muted }}>
      {t("admin.cranker.radar.graceIn")} {formatCountdown(secs)}
    </span>
  );

  return (
    <div
      style={{
        padding: 20,
        borderRadius: 16,
        background: tokens.fillSoft,
        border: `1px solid ${tokens.border}`,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px", fontFamily: SYNE }}>
            {t("admin.cranker.radar.title")}
          </h2>
          <p style={{ fontSize: 12, color: tokens.muted, margin: 0, lineHeight: 1.5 }}>
            {t("admin.cranker.radar.subtitle")}
          </p>
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: tokens.muted,
            cursor: "pointer",
            userSelect: "none",
            whiteSpace: "nowrap",
          }}
        >
          <input
            type="checkbox"
            checked={onlyActionable}
            onChange={(ev) => setOnlyActionable(ev.target.checked)}
            style={{ accentColor: tokens.green }}
          />
          {t("admin.cranker.radar.onlyActionable")}
        </label>
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: tokens.muted, fontFamily: MONO, padding: "8px 0" }}>
          {t("admin.cranker.radar.scanning")}
        </div>
      ) : visible.length === 0 ? (
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            background: tokens.bg,
            border: `1px dashed ${tokens.border}`,
            fontSize: 12,
            color: tokens.muted,
            textAlign: "center",
          }}
        >
          {t("admin.cranker.radar.allClear")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.map((r) => {
            const e: PoolRadarEntry = r.entry;
            return (
              <div
                key={e.key}
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: tokens.bg,
                  border: `1px solid ${r.actionable ? `${tokens.green}44` : tokens.border}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 180 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      color: tokens.text,
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {poolName(e.key)}
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: MONO,
                        color: e.status === "active" ? tokens.green : tokens.muted,
                        border: `1px solid ${
                          e.status === "active" ? `${tokens.green}55` : tokens.border
                        }`,
                        borderRadius: 6,
                        padding: "1px 6px",
                      }}
                    >
                      {statusLabel(e.status)}
                    </span>
                  </div>
                  <div
                    style={{ fontSize: 11, color: tokens.muted, fontFamily: MONO, marginTop: 4 }}
                  >
                    {!e.ok ? (
                      t("admin.cranker.radar.rpcDown")
                    ) : e.currentCycle != null && e.cyclesTotal != null ? (
                      <>
                        {t("admin.cranker.radar.cycle")} {e.currentCycle + 1}/{e.cyclesTotal}
                        {" · "}
                        {r.needsPayout ? (
                          <>
                            {t("admin.cranker.radar.needsPayout")}{" "}
                            {r.payoutReady ? readyChip : graceChip(r.graceRemaining)}
                          </>
                        ) : r.needsSettle ? (
                          <>
                            {t("admin.cranker.radar.needsSettle")}{" "}
                            {r.settleReady ? readyChip : graceChip(r.graceRemaining)}
                          </>
                        ) : (
                          <span style={{ color: tokens.muted }}>
                            {t("admin.cranker.radar.nothing")}
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  {r.needsPayout && (
                    <button
                      type="button"
                      onClick={() => openPayout(e.key)}
                      style={radarBtn(tokens, r.payoutReady)}
                    >
                      {t("admin.cranker.radar.act.payout")}
                    </button>
                  )}
                  {r.needsSettle && (
                    <button
                      type="button"
                      onClick={() => openSettle(e.key)}
                      style={radarBtn(tokens, r.settleReady)}
                    >
                      {t("admin.cranker.radar.act.settle")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Radar row action button — solid green when ready, ghost while in grace. */
function radarBtn(
  tokens: ReturnType<typeof useTheme>["tokens"],
  ready: boolean,
): React.CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 10,
    background: ready ? tokens.green : "transparent",
    color: ready ? tokens.bg : tokens.green,
    border: `1px solid ${tokens.green}`,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
    fontFamily: SYNE,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  };
}
