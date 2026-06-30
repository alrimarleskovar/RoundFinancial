"use client";

import { useEffect, useRef, useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { NetworkBadge } from "@/components/layout/NetworkBadge";
import { SegToggle } from "@/components/layout/SegToggle";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Mobile/tablet (<lg) home for the PT/EN + R$/USDC toggles + network badge.
// The TopBar shows those inline only on `lg+` (`hidden lg:flex`), which left
// phones with NO way to switch language/currency or see the network. A compact
// "PT · R$" trigger opens a dropdown so those controls stay reachable below
// 1024px. Mirrors the WalletChip dropdown (click-outside + absolute popover in
// the sticky TopBar's z-50 stacking context).

export function TopBarPrefsMenu({ connected }: { connected: boolean }) {
  const { tokens } = useTheme();
  const t = useT();
  const i18n = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const currencySym = i18n.currency === "BRL" ? "R$" : "$";

  return (
    <div ref={ref} className="relative lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("top.prefs.label")}
        aria-expanded={open}
        style={{
          padding: "9px 11px",
          borderRadius: 10,
          cursor: "pointer",
          background: tokens.fillSoft,
          border: `1px solid ${tokens.border}`,
          color: tokens.text2,
          fontSize: 11,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          whiteSpace: "nowrap",
        }}
      >
        {i18n.lang.toUpperCase()} · {currencySym}
        <span
          style={{
            color: tokens.muted,
            fontSize: 9,
            transform: open ? "rotate(180deg)" : "rotate(0)",
            transition: "transform 180ms ease",
          }}
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 20,
            minWidth: 200,
            padding: 14,
            borderRadius: 12,
            background: tokens.surface1,
            border: `1px solid ${tokens.borderStr}`,
            boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <MonoLabel size={9}>{t("top.prefs.lang")}</MonoLabel>
            <SegToggle
              value={i18n.lang}
              onChange={i18n.setLang}
              options={[
                { v: "pt", l: "PT" },
                { v: "en", l: "EN" },
              ]}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <MonoLabel size={9}>{t("top.prefs.currency")}</MonoLabel>
            <SegToggle
              value={i18n.currency}
              onChange={i18n.setCurrency}
              options={[
                { v: "BRL", l: "R$" },
                { v: "USDC", l: "$" },
              ]}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <MonoLabel size={9}>{t("top.prefs.network")}</MonoLabel>
            <NetworkBadge connected={connected} />
          </div>
        </div>
      )}
    </div>
  );
}
