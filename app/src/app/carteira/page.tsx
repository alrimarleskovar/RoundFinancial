"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Suspense, useMemo } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { PositionsList } from "@/components/carteira/PositionsList";
import { TransactionsList } from "@/components/carteira/TransactionsList";
import { WalletConnections } from "@/components/carteira/WalletConnections";
import { WalletOverview } from "@/components/carteira/WalletOverview";
import { DeskShell } from "@/components/layout/DeskShell";
import { useConnections } from "@/lib/connections";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { useWallet } from "@/lib/wallet";

type Tab = "overview" | "positions" | "transactions" | "connections";
const ALL_TABS: Tab[] = ["overview", "positions", "transactions", "connections"];

function isTab(v: string | null): v is Tab {
  return ALL_TABS.includes((v ?? "") as Tab);
}

function CarteiraContent() {
  const { tokens } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wallet = useWallet();
  const conns = useConnections();

  const raw = params.get("tab");
  const tab: Tab = isTab(raw) ? raw : "overview";

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params.toString());
    p.set("tab", next);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
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
    }),
    [tokens],
  );

  return (
    <div style={{ padding: 32 }}>
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
          <button type="button" style={btnSoft}>{t("wallet.receive")}</button>
          <button type="button" style={btnPrimary}>{t("wallet.send")}</button>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          marginTop: 24,
          display: "flex",
          gap: 2,
          borderBottom: `1px solid ${tokens.border}`,
        }}
      >
        {ALL_TABS.map((id) => {
          const labels: Record<Tab, string> = {
            overview:     t("wallet.tab.overview"),
            positions:    t("wallet.tab.positions"),
            transactions: t("wallet.tab.transactions"),
            connections:  t("wallet.tab.connections"),
          };
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              style={{
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
                    fontFamily:
                      "var(--font-jetbrains-mono), JetBrains Mono, monospace",
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

      {tab === "overview" && <WalletOverview />}
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
    </div>
  );
}

export default function CarteiraPage() {
  return (
    <DeskShell>
      <Suspense fallback={null}>
        <CarteiraContent />
      </Suspense>
    </DeskShell>
  );
}
