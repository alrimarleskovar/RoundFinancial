"use client";

import { useSearchParams, usePathname } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { PositionsList } from "@/components/carteira/PositionsList";
import { ReceiveModal } from "@/components/carteira/ReceiveModal";
import { SendModal } from "@/components/carteira/SendModal";
import { TransactionsList } from "@/components/carteira/TransactionsList";
import { WalletConnections } from "@/components/carteira/WalletConnections";
import { WalletOverview } from "@/components/carteira/WalletOverview";
import { useConnections } from "@/lib/connections";
import { USDC_RATE, useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";
import { useMyDevnetPositions } from "@/lib/useMyDevnetPositions";
import { useUsdcBalance } from "@/lib/useUsdcBalance";
import { useWallet } from "@/lib/wallet";
import { WALLET_MOBILE_TYPE as WMT } from "@/lib/walletType";

type Tab = "overview" | "positions" | "transactions" | "connections";
const ALL_TABS: Tab[] = ["overview", "positions", "transactions", "connections"];

function isTab(v: string | null): v is Tab {
  return ALL_TABS.includes((v ?? "") as Tab);
}

function MobileWalletSummary({ onReceive, onSend }: { onReceive: () => void; onSend: () => void }) {
  const { fmtMoney } = useI18n();
  const { user, events, demoActive } = useSession();
  const usdc = useUsdcBalance();
  const positions = useMyDevnetPositions();
  const freeUsdc =
    usdc.status === "ok" && usdc.uiAmount !== null ? usdc.uiAmount : user.balance / USDC_RATE;
  const available = demoActive ? user.balance : freeUsdc * USDC_RATE;
  const locked = positions.reduce((sum, position) => sum + (position.locked ?? 0), 0) * USDC_RATE;
  const total = demoActive ? user.balance : available + locked;
  const mainPosition = positions[0];
  const latestEvent = events[0];

  return (
    <section className="relative mt-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-[linear-gradient(140deg,rgba(20,241,149,0.09),rgba(11,17,26,0.96)_45%,rgba(0,200,255,0.06))] p-4 shadow-[0_16px_44px_rgba(0,0,0,0.24)]">
      <div className="pointer-events-none absolute -right-10 -top-14 h-32 w-32 rounded-full bg-[#00C8FF]/12 blur-3xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-white/40">
            Saldo total
          </p>
          <p className="mt-1.5 text-[30px] font-bold leading-none tracking-[-0.05em] text-white">
            {fmtMoney(total)}
          </p>
          <p className="mt-2 text-[10px] text-white/45">
            Disponível agora{" "}
            <strong className="font-semibold text-[#14F195]">{fmtMoney(available)}</strong>
          </p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#14F195]/20 bg-[#14F195]/10">
          <Icons.wallet size={17} stroke="#14F195" sw={1.9} />
        </span>
      </div>

      <div className="relative mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onReceive}
          className="rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2.5 text-[10px] font-bold text-white"
        >
          Receber
        </button>
        <button
          type="button"
          onClick={onSend}
          className="rounded-xl bg-gradient-to-r from-[#14F195] to-[#00C8FF] px-3 py-2.5 text-[10px] font-black text-[#03130D]"
        >
          Enviar
        </button>
      </div>

      <div className="relative mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/15 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#9945FF]/10 text-[#B782FF]">
            {mainPosition ? (
              <Icons.ticket size={15} stroke="currentColor" sw={1.8} />
            ) : (
              <Icons.trend size={15} stroke="currentColor" sw={1.8} />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-[8px] font-black uppercase tracking-[0.12em] text-white/35">
              {mainPosition ? "Ativo principal" : "Última movimentação"}
            </p>
            <p className="mt-0.5 truncate text-[10px] font-semibold text-white">
              {mainPosition?.group ?? latestEvent?.target ?? "Nenhuma movimentação recente"}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-semibold text-white">
            {mainPosition
              ? fmtMoney(mainPosition.value)
              : latestEvent
                ? fmtMoney(latestEvent.amountBrl)
                : "—"}
          </p>
          {mainPosition && (
            <p className="mt-0.5 text-[8px] text-white/35">
              {mainPosition.month}/{mainPosition.total} parcelas
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function CarteiraContent() {
  const { tokens } = useTheme();
  const { t } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const wallet = useWallet();
  const conns = useConnections();
  const isMobile = useIsMobile(1024);
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
      fontSize: isMobile ? WMT.button : 12,
      fontWeight: 600,
      fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
      transition: "transform 180ms ease, border-color 180ms ease",
    }),
    [tokens, isMobile],
  );
  const btnPrimary = useMemo(
    () => ({
      padding: "10px 14px",
      borderRadius: 10,
      cursor: "pointer",
      background: `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`,
      border: "none",
      color: "#fff",
      fontSize: isMobile ? WMT.button : 12,
      fontWeight: 700,
      fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
      transition: "transform 180ms ease, box-shadow 180ms ease",
    }),
    [tokens, isMobile],
  );

  return (
    <div style={{ padding: isMobile ? "12px 16px 24px" : 32 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: isMobile ? "center" : "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <MonoLabel color={tokens.green}>{t("wallet.badge")}</MonoLabel>
          <div
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: isMobile ? 20 : 32,
              fontWeight: 800,
              color: tokens.text,
              letterSpacing: "-0.03em",
              marginTop: 4,
            }}
          >
            {isMobile ? "Carteira" : t("wallet.title")}
          </div>
          {!isMobile && (
            <div style={{ fontSize: 13, color: tokens.text2, marginTop: 4 }}>
              {t("conn.keys.body").split(".")[0]}.
            </div>
          )}
        </div>
        {!isMobile && (
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
        )}
      </div>

      {isMobile && tab === "overview" && (
        <MobileWalletSummary
          onReceive={() => setReceiveOpen(true)}
          onSend={() => setSendOpen(true)}
        />
      )}

      {/* Connections is the 4th tab in a strip that scrolls, so on a phone the
          screen everyone lands on never revealed it existed. Surfacing it here
          beats reordering the tabs — reordering only clips a different one. */}
      {isMobile && tab === "overview" && (
        <button
          type="button"
          onClick={() => setTab("connections")}
          style={{
            marginTop: 12,
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderRadius: 12,
            cursor: "pointer",
            background: tokens.fillSoft,
            border: `1px solid ${tokens.border}`,
            textAlign: "left",
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: WMT.body,
                fontWeight: 600,
                color: tokens.text,
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
              }}
            >
              {t("wallet.tab.connections")}
            </span>
            <span
              style={{
                display: "block",
                marginTop: 2,
                fontSize: WMT.micro,
                color: tokens.muted,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {t("wallet.connections.entry")}
            </span>
          </span>
          <span
            style={{
              flexShrink: 0,
              fontSize: WMT.micro,
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
          <span style={{ flexShrink: 0, color: tokens.muted, fontSize: 14 }}>→</span>
        </button>
      )}

      {/* Tabs — scroll horizontally on phones (the four labels don't fit at
          once) instead of clipping the rightmost tab off the edge. The strip
          also hides its scrollbar, which left "Conexões" not merely off-screen
          but with no hint that it existed at all; the right-edge fade below is
          that hint. */}
      <div style={{ position: "relative", marginTop: isMobile ? 14 : 24 }}>
        <div
          className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
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
                  padding: isMobile ? "10px 12px" : "12px 18px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: active ? tokens.text : tokens.text2,
                  fontSize: isMobile ? WMT.tabs : 13,
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
                      fontSize: isMobile ? WMT.micro : 9,
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
        {isMobile && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 1,
              width: 32,
              pointerEvents: "none",
              background: `linear-gradient(to right, ${tokens.bg}00, ${tokens.bg})`,
            }}
          />
        )}
      </div>

      {tab === "overview" && !isMobile && (
        <WalletOverview onSeeAllTx={() => setTab("transactions")} />
      )}
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
