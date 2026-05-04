"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import type { WalletView } from "@/lib/wallet";

// Devnet SOL faucet + Circle USDC faucet link, rendered inside the
// expanded Phantom card when the wallet is connected. Port of the
// inline PhantomFaucet from prototype/components/desktop-more.jsx.

export function PhantomFaucet({ wallet, tc }: { wallet: WalletView; tc: string }) {
  const { tokens } = useTheme();
  const t = useT();
  const busy = wallet.airdropping;
  const err = wallet.lastError;
  const sig = wallet.lastTxSig;
  const rateLimited = err === "rate_limited" || err === "airdrop_limit";

  return (
    <div
      style={{
        marginTop: 16,
        padding: 14,
        borderRadius: 12,
        background: tokens.fillSoft,
        border: `1px solid ${tokens.border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <MonoLabel color={tc} size={9}>
            {t("wallet.faucet.title")}
          </MonoLabel>
          <div
            style={{
              fontSize: 11,
              color: tokens.text2,
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            {t("wallet.faucet.sub")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              wallet.airdrop();
            }}
            disabled={busy}
            style={{
              padding: "8px 14px",
              borderRadius: 9,
              cursor: busy ? "default" : "pointer",
              border: "none",
              background: `linear-gradient(135deg, ${tc}, ${tokens.teal})`,
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              opacity: busy ? 0.7 : 1,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {busy && (
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderTopColor: "#fff",
                  animation: "rfi-spin 0.7s linear infinite",
                  display: "inline-block",
                }}
              />
            )}
            {busy ? t("wallet.faucet.busy") : t("wallet.faucet.btn")}
          </button>
          {/* Always-visible hosted faucet fallback. The public devnet
              RPC is heavily rate-limited; this is the reliable path. */}
          <a
            href={`https://faucet.solana.com/?address=${wallet.publicKey ?? ""}&cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: "8px 12px",
              borderRadius: 9,
              background: "transparent",
              border: `1px solid ${tokens.border}`,
              color: tokens.text2,
              fontSize: 11,
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
              fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
            }}
          >
            {t("wallet.faucet.hostedCTA")} ↗
          </a>
        </div>
      </div>

      {/* Success: last airdrop signature */}
      {sig && !busy && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 8,
            background: `${tokens.green}1A`,
            border: `1px solid ${tokens.green}4D`,
            fontSize: 11,
            color: tokens.green,
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <Icons.check size={12} stroke={tokens.green} sw={2} />
          <span>{t("wallet.faucet.ok")}</span>
          <a
            href={wallet.explorerTx(sig)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: tokens.green,
              fontWeight: 600,
              textDecoration: "underline",
            }}
          >
            {t("wallet.faucet.viewTx")}
          </a>
        </div>
      )}

      {/* Rate-limit banner */}
      {rateLimited && !busy && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 8,
            background: `${tokens.amber}1A`,
            border: `1px solid ${tokens.amber}4D`,
            fontSize: 11,
            color: tokens.amber,
            lineHeight: 1.5,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <Icons.info size={12} stroke={tokens.amber} />
            <span style={{ flex: 1 }}>{t("wallet.faucet.rate")}</span>
          </div>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {(
              [
                { href: "https://faucet.solana.com", l: "faucet.solana.com" },
                { href: "https://www.helius.dev/faucet", l: "helius.dev/faucet" },
                { href: "https://faucet.quicknode.com/solana/devnet", l: "quicknode.com" },
              ] as const
            ).map((alt) => (
              <a
                key={alt.href}
                href={alt.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: `${tokens.amber}1F`,
                  border: `1px solid ${tokens.amber}55`,
                  color: tokens.amber,
                  fontWeight: 600,
                  textDecoration: "none",
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  fontSize: 10,
                }}
              >
                {alt.l} ↗
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Generic airdrop failure */}
      {err &&
        !rateLimited &&
        err !== "user_rejected" &&
        err !== "phantom_not_installed" &&
        !busy && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background: `${tokens.red}1A`,
              border: `1px solid ${tokens.red}4D`,
              fontSize: 11,
              color: tokens.red,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Icons.info size={12} stroke={tokens.red} />
            <span>{t("wallet.faucet.failed", { msg: err })}</span>
          </div>
        )}

      {/* USDC devnet hint */}
      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: `1px dashed ${tokens.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              color: tokens.text,
              fontWeight: 600,
            }}
          >
            {t("wallet.faucet.usdcTitle")}
          </div>
          <div
            style={{
              fontSize: 10,
              color: tokens.muted,
              marginTop: 2,
              lineHeight: 1.5,
            }}
          >
            {t("wallet.faucet.usdcSub")}
          </div>
        </div>
        <a
          href="https://faucet.circle.com/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            background: "transparent",
            border: `1px solid ${tokens.border}`,
            color: tokens.text,
            fontSize: 11,
            fontWeight: 600,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
          }}
        >
          {t("wallet.faucet.usdcCTA")} →
        </a>
      </div>
    </div>
  );
}
