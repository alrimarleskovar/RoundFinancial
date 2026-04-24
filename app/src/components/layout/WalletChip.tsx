"use client";

import { useEffect, useRef, useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { MenuItem } from "@/components/layout/MenuItem";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { shortAddr, type WalletView } from "@/lib/wallet";

// Wallet chip: disconnected = gradient "Connect Phantom" button,
// connected = icon + short address + dropdown (copy / airdrop /
// explorer / disconnect). Port of the inline WalletChip from
// prototype/index.html.

export function WalletChip({ wallet }: { wallet: WalletView }) {
  const { tokens, isDark } = useTheme();
  const t = useT();
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const connected = wallet.status === "connected";
  const connecting = wallet.status === "connecting";

  if (!connected) {
    return (
      <button
        type="button"
        onClick={() =>
          wallet.isInstalled
            ? wallet.connect()
            : window.open("https://phantom.app/", "_blank", "noopener,noreferrer")
        }
        disabled={connecting}
        style={{
          padding: "8px 14px",
          borderRadius: 10,
          cursor: connecting ? "default" : "pointer",
          background: `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`,
          border: "none",
          color: isDark ? tokens.bgDeep : "#FFFFFF",
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          opacity: connecting ? 0.75 : 1,
        }}
      >
        {connecting && (
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              border: `2px solid ${
                isDark ? "rgba(2,5,11,0.3)" : "rgba(255,255,255,0.35)"
              }`,
              borderTopColor: isDark ? tokens.bgDeep : "#FFFFFF",
              animation: "rfi-spin 0.7s linear infinite",
              display: "inline-block",
            }}
          />
        )}
        {connecting
          ? t("top.connecting")
          : wallet.isInstalled
          ? t("top.connect")
          : t("conn.phantom.installCTA")}
      </button>
    );
  }

  const addr = wallet.publicKey ?? "";
  const onCopy = () => {
    navigator.clipboard?.writeText(addr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "6px 12px 6px 8px",
          borderRadius: 10,
          cursor: "pointer",
          background: tokens.fillSoft,
          border: `1px solid ${tokens.border}`,
          color: tokens.text,
          fontSize: 12,
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: `linear-gradient(135deg, ${tokens.purple}, ${tokens.teal})`,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
          }}
        >
          <Icons.wallet size={13} stroke="#fff" sw={2} />
        </span>
        <span
          style={{
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 11,
          }}
        >
          {shortAddr(addr, 4, 4)}
        </span>
        <span
          style={{
            color: tokens.muted,
            fontSize: 10,
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
            minWidth: 220,
            padding: 6,
            borderRadius: 12,
            background: tokens.surface1,
            border: `1px solid ${tokens.borderStr}`,
            boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              background: tokens.fillSoft,
              marginBottom: 4,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <MonoLabel size={9}>{t("conn.phantom.addr")}</MonoLabel>
            <span
              style={{
                fontFamily:
                  "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 11,
                color: tokens.text,
                wordBreak: "break-all",
              }}
            >
              {addr}
            </span>
            {wallet.balanceSol != null && (
              <span
                style={{
                  fontSize: 10,
                  color: tokens.muted,
                  marginTop: 2,
                }}
              >
                {wallet.balanceSol.toLocaleString(
                  lang === "pt" ? "pt-BR" : "en-US",
                  { minimumFractionDigits: 2, maximumFractionDigits: 4 },
                )}{" "}
                SOL · {wallet.network}
              </span>
            )}
          </div>
          <MenuItem
            icon={Icons.copy}
            label={copied ? t("wallet.menu.copied") : t("wallet.menu.copy")}
            onClick={onCopy}
          />
          <MenuItem
            icon={Icons.spark}
            label={t("wallet.menu.airdrop")}
            disabled={wallet.airdropping}
            onClick={() => {
              wallet.airdrop();
              setOpen(false);
            }}
          />
          <MenuItem
            icon={Icons.arrow}
            label={t("wallet.menu.explorer")}
            onClick={() => {
              window.open(
                wallet.explorerAddr(addr),
                "_blank",
                "noopener,noreferrer",
              );
              setOpen(false);
            }}
          />
          <div
            style={{
              height: 1,
              background: tokens.border,
              margin: "4px 6px",
            }}
          />
          <MenuItem
            icon={Icons.close}
            label={t("wallet.menu.disconnect")}
            tone="danger"
            onClick={() => {
              wallet.disconnect();
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
