"use client";

import { useEffect, useRef, useState } from "react";

import { Icons } from "@/components/brand/icons";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import type { WalletView } from "@/lib/wallet";

// Transient 5s auto-dismiss toast for unexpected wallet failures.
// Ignores user-cancelled + missing-provider (handled inline on the card).

const IGNORED = new Set(["user_rejected", "phantom_not_installed"]);

export function WalletErrorToast({ wallet }: { wallet: WalletView }) {
  const { tokens } = useTheme();
  const t = useT();
  const [visible, setVisible] = useState(false);
  const lastRef = useRef<string | null>(null);

  const err = wallet.lastError;
  const shouldShow = !!err && !IGNORED.has(err) && wallet.status !== "connecting";

  useEffect(() => {
    if (shouldShow && err !== lastRef.current) {
      lastRef.current = err;
      setVisible(true);
      const id = setTimeout(() => setVisible(false), 5000);
      return () => clearTimeout(id);
    }
  }, [err, shouldShow]);

  if (!visible || !err) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 50,
        padding: "10px 14px",
        borderRadius: 10,
        maxWidth: 320,
        background: tokens.surface1,
        border: `1px solid ${tokens.red}4D`,
        boxShadow: "0 12px 32px rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <Icons.info size={14} stroke={tokens.red} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: tokens.red,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            textTransform: "uppercase",
            letterSpacing: ".08em",
          }}
        >
          {t("wallet.error.title")}
        </div>
        <div
          style={{
            fontSize: 12,
            color: tokens.text,
            marginTop: 3,
            wordBreak: "break-word",
          }}
        >
          {err}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: tokens.muted,
          padding: 0,
        }}
      >
        <Icons.close size={12} stroke={tokens.muted} />
      </button>
    </div>
  );
}
