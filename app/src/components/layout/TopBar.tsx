"use client";

import { Icons } from "@/components/brand/icons";
import { SegToggle } from "@/components/layout/SegToggle";
import { WalletChip } from "@/components/layout/WalletChip";
import { WalletErrorToast } from "@/components/layout/WalletErrorToast";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { useWallet } from "@/lib/wallet";

// Sticky top bar used by every Carteira/Home/Grupos screen. Port of
// the inline DeskTopBar in prototype/index.html.

export function TopBar() {
  const { tokens, isDark } = useTheme();
  const t = useT();
  const i18n = useI18n();
  const wallet = useWallet();

  const connected = wallet.status === "connected";
  const netLabel = connected ? t("top.network.devnet") : t("top.network.offline");
  const netDotColor = connected ? tokens.green : tokens.muted;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: isDark ? "rgba(6,9,15,0.85)" : "rgba(245,241,234,0.85)",
        backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${tokens.border}`,
        padding: "14px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            borderRadius: 10,
            background: tokens.fillSoft,
            border: `1px solid ${tokens.border}`,
            width: 320,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={tokens.muted}
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            placeholder={t("top.search")}
            aria-label={t("top.search")}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: tokens.text,
              fontSize: 12,
              fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              fontSize: 10,
              color: tokens.muted,
              padding: "2px 6px",
              borderRadius: 4,
              background: tokens.fillMed,
            }}
          >
            ⌘K
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SegToggle
          value={i18n.lang}
          onChange={i18n.setLang}
          options={[
            { v: "pt", l: "PT" },
            { v: "en", l: "EN" },
          ]}
        />
        <SegToggle
          value={i18n.currency}
          onChange={i18n.setCurrency}
          options={[
            { v: "BRL", l: "R$" },
            { v: "USDC", l: "$" },
          ]}
        />

        <div
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            background: tokens.fillSoft,
            border: `1px solid ${connected ? `${tokens.green}33` : tokens.border}`,
            color: connected ? tokens.green : tokens.text2,
            fontSize: 10,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            display: "flex",
            alignItems: "center",
            gap: 8,
            userSelect: "none",
            letterSpacing: "0.12em",
            fontWeight: 600,
          }}
        >
          <span style={{ position: "relative", display: "inline-flex" }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: netDotColor,
                boxShadow: connected ? `0 0 8px ${netDotColor}` : "none",
                position: "relative",
                zIndex: 1,
              }}
            />
            {connected && (
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: netDotColor,
                  animation: "rfi-pulse 1.6s ease-in-out infinite",
                }}
              />
            )}
          </span>
          {netLabel}
        </div>

        <button
          type="button"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            cursor: "pointer",
            background: tokens.fillSoft,
            border: `1px solid ${tokens.border}`,
            color: tokens.text2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <Icons.bell size={16} stroke={tokens.text2} />
          <span
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: tokens.green,
              border: `2px solid ${tokens.bg}`,
            }}
          />
        </button>

        <WalletChip wallet={wallet} />
      </div>

      <WalletErrorToast wallet={wallet} />
    </div>
  );
}
