"use client";

import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Network identity pill shown in the top bar: connected → "SOLANA_DEVNET"
// (green, pulsing dot), disconnected → "PHANTOM_OFFLINE" (muted). Extracted
// from TopBar so the same badge can be reused verbatim by the /home-v2
// candidate header — guaranteeing the two stay identical instead of
// drifting copies. Caller passes `connected` (it already has the wallet
// view); the badge reads theme tokens + the i18n label itself.

export function NetworkBadge({ connected }: { connected: boolean }) {
  const { tokens } = useTheme();
  const t = useT();
  const netLabel = connected ? t("top.network.devnet") : t("top.network.offline");
  const netDotColor = connected ? tokens.green : tokens.muted;

  return (
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
  );
}
