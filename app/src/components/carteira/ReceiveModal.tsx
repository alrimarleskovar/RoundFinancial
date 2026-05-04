"use client";

import { useEffect, useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { useWallet } from "@/lib/wallet";

// Receive modal — shows the connected wallet address (or the
// session placeholder if no Phantom is connected) with a click-to-
// copy affordance + a QR-style block. Network badge anchors the
// address to Solana devnet so the user sees where to send funds.

export function ReceiveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tokens } = useTheme();
  const t = useT();
  const { user } = useSession();
  const wallet = useWallet();
  const [copied, setCopied] = useState(false);

  // Prefer the real connected pubkey when Phantom is hooked in;
  // fall back to the session placeholder so the modal is never
  // empty in demo mode.
  const address =
    wallet.status === "connected" && wallet.publicKey ? wallet.publicKey : user.walletShort;

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // older browsers / missing permissions — silent
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("modal.receive.title")}
      subtitle={t("modal.receive.subtitle")}
      width={460}
    >
      {/* Network badge */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          borderRadius: 999,
          background: `${tokens.green}14`,
          border: `1px solid ${tokens.green}33`,
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: 10,
          color: tokens.green,
          letterSpacing: "0.08em",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: tokens.green,
            display: "inline-block",
          }}
        />
        SOLANA · DEVNET
      </div>

      {/* QR placeholder */}
      <div
        style={{
          marginTop: 14,
          aspectRatio: "1 / 1",
          maxWidth: 200,
          marginInline: "auto",
          borderRadius: 14,
          background: `repeating-linear-gradient(45deg, ${tokens.fillSoft} 0, ${tokens.fillSoft} 6px, ${tokens.fillMed} 6px, ${tokens.fillMed} 12px)`,
          border: `1px solid ${tokens.borderStr}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: tokens.muted,
          flexDirection: "column",
          gap: 6,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            letterSpacing: "0.12em",
          }}
        >
          QR · DEMO
        </span>
        <span
          style={{
            fontSize: 9,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            color: tokens.muted,
          }}
        >
          M3 wires real QR
        </span>
      </div>

      {/* Address row */}
      <button
        type="button"
        onClick={copy}
        style={{
          marginTop: 16,
          width: "100%",
          padding: 14,
          borderRadius: 12,
          background: tokens.fillSoft,
          border: `1px solid ${copied ? tokens.green + "55" : tokens.border}`,
          color: copied ? tokens.green : tokens.text,
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          transition: "all 180ms ease",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            textAlign: "left",
          }}
        >
          {address}
        </span>
        {copied ? (
          <Icons.check size={16} stroke={tokens.green} sw={2.4} />
        ) : (
          <Icons.copy size={15} stroke={tokens.muted} />
        )}
      </button>
      {copied && (
        <div
          style={{
            marginTop: 6,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 10,
            color: tokens.green,
            letterSpacing: "0.08em",
            textAlign: "center",
          }}
        >
          {t("modal.receive.copied")}
        </div>
      )}

      {/* Demo callout */}
      <div
        style={{
          marginTop: 14,
          padding: "10px 12px",
          borderRadius: 10,
          background: `${tokens.amber}14`,
          border: `1px solid ${tokens.amber}33`,
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
        }}
      >
        <MonoLabel size={9} color={tokens.amber}>
          {t("modal.receive.demoBadge")}
        </MonoLabel>
        <span style={{ fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
          {t("modal.receive.demoBody")}
        </span>
      </div>

      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: 18,
          width: "100%",
          padding: 11,
          borderRadius: 11,
          background: tokens.fillMed,
          color: tokens.text,
          border: `1px solid ${tokens.borderStr}`,
          fontWeight: 600,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
        }}
      >
        {t("modal.receive.close")}
      </button>
    </Modal>
  );
}
