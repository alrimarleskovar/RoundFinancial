"use client";

import { useSearchParams, usePathname } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { PositionsList } from "@/components/carteira/PositionsList";
import { ReceiveModal } from "@/components/carteira/ReceiveModal";
import { SendModal } from "@/components/carteira/SendModal";
import { TransactionsList } from "@/components/carteira/TransactionsList";
import { WalletConnections } from "@/components/carteira/WalletConnections";
import { WalletOverview } from "@/components/carteira/WalletOverview";
import { useConnections } from "@/lib/connections";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";
import { useWallet } from "@/lib/wallet";

type Tab = "overview" | "positions" | "transactions" | "connections";
const ALL_TABS: Tab[] = ["overview", "positions", "transactions", "connections"];

function isTab(v: string | null): v is Tab {
  return ALL_TABS.includes((v ?? "") as Tab);
}

function CarteiraContent() {
  const { tokens } = useTheme();
  const { t } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const wallet = useWallet();
  const conns = useConnections();
  const isMobile = useIsMobile();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  // Phones: the tab strip scrolls horizontally (the four tabs don't fit at
  // once), so center the active tab on mount — otherwise a deep-link/refresh on
  // ?tab=connections lands with "Connections" clipped off the right edge.
  const scrollActiveTabIntoView = useCallback((node: HTMLButtonElement | null) => {
    node?.scrollIntoView({ block: "nearest", inline: "center" });
  }, []);

  // Tab state is LOCAL (source of truth), seeded once from the URL — NOT
  // re-derived from useSearchParams every render and pushed through
  // router.replace. On the statically-prerendered production page, Next 16
  // silently DROPS a query-only router.replace when the page hydrated with a
  // non-default ?tab= already in the URL (a deep-link or refresh on
  // ?tab=connections — exactly where the email-alerts card lives). That froze
  // the tab at its initial value: clicks fired but the URL/state never updated.
  // Driving the tab locally + mirroring the URL via history.replaceState fixes
  // the deep-link/refresh case and keeps the page static.
  const initialRaw = params.get("tab");
  const [tab, setTabState] = useState<Tab>(() => (isTab(initialRaw) ? initialRaw : "overview"));

  const setTab = (next: Tab) => {
    setTabState(next);
    // Mirror to the URL for shareability + refresh-survival, WITHOUT the App
    // Router (whose query-only replace is the broken path on this static page).
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `${pathname}?tab=${next}`);
    }
  };

  // Connections badge: 1 (Phantom real) + N mocks marked 'connected'.
  const totalConns = 5;
  const connectedConns =
    (wallet.status === "connected" ? 1 : 0) +
    Object.values(conns.state).filter((r) => r.status === "connected").length;

  const btnSoft = useMemo(
    () => ({
      padding: "10px 14px",
      borderRadius: 10,
      cursor: "pointer",
      background: tokens.fillSoft,
      border: `1px solid ${tokens.border}`,
      color: tokens.text,
      fontSize: 12,
      fontWeight: 600,
      fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
      transition: "transform 180ms ease, border-color 180ms ease",
    }),
    [tokens],
  );
  const btnPrimary = useMemo(
    () => ({
      padding: "10px 14px",
      borderRadius: 10,
      cursor: "pointer",
      background: `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`,
      border: "none",
      color: "#fff",
      fontSize: 12,
      fontWeight: 700,
      fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
      transition: "transform 180ms ease, box-shadow 180ms ease",
    }),
    [tokens],
  );

  return (
    <div style={{ padding: isMobile ? 16 : 32 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <MonoLabel color={tokens.green}>{t("wallet.badge")}</MonoLabel>
          <div
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 32,
              fontWeight: 800,
              color: tokens.text,
              letterSpacing: "-0.03em",
              marginTop: 4,
            }}
          >
            {t("wallet.title")}
          </div>
          <div style={{ fontSize: 13, color: tokens.text2, marginTop: 4 }}>
            {t("conn.keys.body").split(".")[0]}.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            style={btnSoft}
            onClick={() => setReceiveOpen(true)}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.borderColor = `${tokens.green}66`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.borderColor = tokens.border;
            }}
          >
            {t("wallet.receive")}
          </button>
          <button
            type="button"
            style={btnPrimary}
            onClick={() => setSendOpen(true)}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = `0 8px 20px ${tokens.green}40`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            {t("wallet.send")}
          </button>
        </div>
      </div>

      {/* Tabs — scroll horizontally on phones (the four labels don't fit at
          once) instead of clipping the rightmost tab off the edge. */}
      <div
        className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          marginTop: 24,
          display: "flex",
          gap: 2,
          borderBottom: `1px solid ${tokens.border}`,
          overflowX: "auto",
        }}
      >
        {ALL_TABS.map((id) => {
          const labels: Record<Tab, string> = {
            overview: t("wallet.tab.overview"),
            positions: t("wallet.tab.positions"),
            transactions: t("wallet.tab.transactions"),
            connections: t("wallet.tab.connections"),
          };
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              ref={active ? scrollActiveTabIntoView : undefined}
              onClick={() => setTab(id)}
              style={{
                flexShrink: 0,
                padding: "12px 18px",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: active ? tokens.text : tokens.text2,
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                borderBottom: `2px solid ${active ? tokens.green : "transparent"}`,
                marginBottom: -1,
                display: "flex",
                alignItems: "center",
                whiteSpace: "nowrap",
                gap: 6,
              }}
            >
              {labels[id]}
              {id === "connections" && (
                <span
                  style={{
                    fontSize: 9,
                    padding: "2px 6px",
                    borderRadius: 999,
                    background: `${tokens.green}22`,
                    color: tokens.green,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontWeight: 600,
                  }}
                >
                  {connectedConns}/{totalConns}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "overview" && <WalletOverview onSeeAllTx={() => setTab("transactions")} />}
      {tab === "positions" && (
        <div style={{ marginTop: 20 }}>
          <PositionsList />
        </div>
      )}
      {tab === "transactions" && (
        <div style={{ marginTop: 20 }}>
          <TransactionsList />
        </div>
      )}
      {tab === "connections" && <WalletConnections />}

      <ReceiveModal open={receiveOpen} onClose={() => setReceiveOpen(false)} />
      <SendModal open={sendOpen} onClose={() => setSendOpen(false)} />
    </div>
  );
}

export default function CarteiraPage() {
  return (
    <Suspense fallback={null}>
      <CarteiraContent />
    </Suspense>
  );
}
