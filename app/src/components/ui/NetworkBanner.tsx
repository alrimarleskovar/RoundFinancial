"use client";

import { useConnection } from "@solana/wallet-adapter-react";

import { Icons } from "@/components/brand/icons";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { classifyEndpoint, type Cluster } from "@/lib/networkClassify";

// Re-export so existing call-sites (and tests that import via the
// component path) keep working. The actual implementation lives in
// `networkClassify.ts` — see SEV-045 comment there.
export { classifyEndpoint };
export type { Cluster };

// NetworkBanner — top-of-page strip identifying the active Solana
// cluster. Mitigates devnet→mainnet confusion (item 4.6 of
// MAINNET_READINESS.md):
//
//   - LOCALNET   — soft hint, teal. Local validator only.
//   - DEVNET     — strong hint, amber. Test funds only, no real money.
//   - MAINNET    — LOUD red alert. Real funds in play, every signed
//                  tx is irreversible. SEV-045: previously hidden on
//                  mainnet ("training to ignore") — flipped to ALWAYS
//                  visible because the canary-plan threat model is
//                  "user thinks they're on devnet but RPC is mainnet,"
//                  in which case mainnet IS the surprise. Visibility
//                  on the happy path is the entire point.
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

export function NetworkBanner() {
  const { tokens } = useTheme();
  const t = useT();
  const { connection } = useConnection();
  const url = connection.rpcEndpoint;
  const cluster = classifyEndpoint(url);

  // SEV-045: mainnet was previously hidden ("training to ignore"
  // argument). Flipped — banner now ALWAYS renders, mainnet variant
  // uses the same LOUD red palette as unknown so users cannot
  // accidentally sign a real-funds tx thinking they're on devnet.

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
    mainnet: {
      bg: `${tokens.red}1A`,
      border: tokens.red,
      fg: tokens.red,
      iconStroke: tokens.red,
      role: "alert" as const,
      borderWidth: 2,
      labelKey: "network.banner.mainnet",
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
        // Loud variants (mainnet, unknown) get extra padding + size
        // so they read as "stop and check" not "FYI". Localnet/devnet
        // stay slim FYI strips.
        padding: cluster === "unknown" || cluster === "mainnet" ? "10px 16px" : "6px 12px",
        background: palette.bg,
        borderBottom: `${palette.borderWidth}px solid ${palette.border}`,
        color: palette.fg,
        fontSize: cluster === "unknown" || cluster === "mainnet" ? 12 : 11,
        fontWeight: cluster === "unknown" || cluster === "mainnet" ? 700 : 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
      }}
    >
      <Icons.info
        size={cluster === "unknown" || cluster === "mainnet" ? 14 : 12}
        stroke={palette.iconStroke}
      />
      <span>{t(palette.labelKey, { url })}</span>
    </div>
  );
}
