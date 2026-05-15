"use client";

import { useConnection } from "@solana/wallet-adapter-react";

import { Icons } from "@/components/brand/icons";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// NetworkBanner — top-of-page strip identifying the active Solana
// cluster. Mitigates devnet→mainnet confusion (item 4.6 of
// MAINNET_READINESS.md):
//
//   - LOCALNET   — soft hint, blue. Local validator only.
//   - DEVNET     — strong hint, yellow. Test funds only, no real money.
//   - MAINNET    — green confirm. Real funds in play.
//   - UNKNOWN    — red alert. RPC URL doesn't match any known cluster
//                  pattern; could be a malicious RPC fronting wrong
//                  cluster. User should verify before signing.
//
// Source of truth is the **connection endpoint URL** read straight
// from `useConnection()`. This is the URL that txs actually go to —
// independent of the `useNetwork()` context (which a compromised
// upstream component could lie about). Substring-based classification
// is intentionally conservative: anything we can't confidently
// classify falls into UNKNOWN with the alert banner.
//
// Pairs with `PhishingBanner` (domain-pin guard) — different attack
// surface (domain vs RPC), same defense-in-depth philosophy.

type Cluster = "localnet" | "devnet" | "mainnet" | "unknown";

export function classifyEndpoint(url: string): Cluster {
  // Substring matching is order-sensitive — check most-specific first.
  // "mainnet" is a substring of "mainnet-beta", which both
  // `api.mainnet-beta.solana.com` and `mainnet.helius-rpc.com` carry.
  if (url.includes("127.0.0.1") || url.includes("localhost")) return "localnet";
  if (url.includes("devnet")) return "devnet";
  if (url.includes("mainnet")) return "mainnet";
  // Triton, QuickNode, custom proxies — we cannot tell cluster from
  // URL alone. Default to UNKNOWN with the alert banner; operator
  // must whitelist their RPC URL pattern explicitly when ready to
  // suppress the alert.
  return "unknown";
}

export function NetworkBanner() {
  const { tokens } = useTheme();
  const t = useT();
  const { connection } = useConnection();
  const url = connection.rpcEndpoint;
  const cluster = classifyEndpoint(url);

  // Mainnet is the "expected" production state; no banner needed there
  // — same UX rationale as canonical-domain on PhishingBanner. Showing
  // a banner on the happy path trains users to ignore it.
  if (cluster === "mainnet") return null;

  const palette = {
    localnet: {
      bg: `${tokens.teal}1A`,
      border: `${tokens.teal}55`,
      fg: tokens.teal,
      iconStroke: tokens.teal,
      role: "status" as const,
      borderWidth: 1,
      labelKey: "network.banner.localnet",
    },
    devnet: {
      bg: `${tokens.amber}1A`,
      border: `${tokens.amber}66`,
      fg: tokens.amber,
      iconStroke: tokens.amber,
      role: "status" as const,
      borderWidth: 1,
      labelKey: "network.banner.devnet",
    },
    unknown: {
      bg: `${tokens.red}1A`,
      border: tokens.red,
      fg: tokens.red,
      iconStroke: tokens.red,
      role: "alert" as const,
      borderWidth: 2,
      labelKey: "network.banner.unknown",
    },
  }[cluster];

  return (
    <div
      role={palette.role}
      style={{
        padding: cluster === "unknown" ? "10px 16px" : "6px 12px",
        background: palette.bg,
        borderBottom: `${palette.borderWidth}px solid ${palette.border}`,
        color: palette.fg,
        fontSize: cluster === "unknown" ? 12 : 11,
        fontWeight: cluster === "unknown" ? 700 : 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
      }}
    >
      <Icons.info size={cluster === "unknown" ? 14 : 12} stroke={palette.iconStroke} />
      <span>{t(palette.labelKey, { url })}</span>
    </div>
  );
}
