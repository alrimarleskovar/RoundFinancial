"use client";

import { useState } from "react";

import { SettleDefaultCrankModal } from "@/components/modals/SettleDefaultCrankModal";
import { useTheme } from "@/lib/theme";

// /admin/cranker — operator surface for the `settle_default` crank.
// Foundation under issue #291. Anyone can crank on-chain (the
// instruction is permissionless); this page makes the workflow
// ergonomic for the canary operator. NOT linked from the public nav.
//
// The page itself is intentionally bare: a single "Open" button that
// surfaces `SettleDefaultCrankModal`. The modal does the heavy lifting
// (pool selection, candidate filter, grace countdown, cascade preview,
// tx dispatch). Operators reach this page via direct URL.

export default function CrankerPage() {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: tokens.bg,
        color: tokens.text,
        padding: "48px 24px",
        fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 800,
              margin: 0,
              marginBottom: 12,
              fontFamily: "var(--font-syne), system-ui, sans-serif",
            }}
          >
            settle_default · cranker
          </h1>
          <p style={{ color: tokens.muted, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Operator surface for the permissionless settle_default instruction. Pick a pool, filter
            to eligible defaulters (members who missed the previous cycle AND whose grace period has
            elapsed), review the Triple Shield cascade preview, and dispatch.
          </p>
        </div>

        <div
          style={{
            padding: 20,
            borderRadius: 16,
            background: tokens.fillSoft,
            border: `1px solid ${tokens.border}`,
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 13, color: tokens.muted, lineHeight: 1.6 }}>
            <p style={{ marginTop: 0 }}>
              <strong style={{ color: tokens.text }}>What this does:</strong> dispatches{" "}
              <code>settle_default(cycle)</code> against a defaulter. The on-chain Triple Shield
              cascade then drains solidarity → escrow → stake (capped by the D/C invariant) until
              the missed installment is covered or all 3 sources are exhausted.
            </p>
            <p>
              <strong style={{ color: tokens.text }}>Who pays:</strong> the connected wallet pays
              for the SCHEMA_DEFAULT attestation init rent. The defaulted member does NOT sign —
              they're identified by wallet pubkey only.
            </p>
            <p style={{ marginBottom: 0 }}>
              <strong style={{ color: tokens.text }}>Failure modes:</strong>{" "}
              <code>SettleDefaultGracePeriodNotElapsed</code> (too early){" "}
              <code>AlreadyContributed</code> (member paid late but on time after all){" "}
              <code>AlreadyDefaulted</code> (re-settle blocked) <code>WrongCycle</code> (arg
              mismatch). The modal surfaces the program log in full if any fire.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            padding: "14px 24px",
            borderRadius: 12,
            background: tokens.green,
            color: tokens.bg,
            border: "none",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 14,
            fontFamily: "var(--font-syne), system-ui, sans-serif",
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          Open cranker
        </button>

        <SettleDefaultCrankModal open={open} onClose={() => setOpen(false)} />
      </div>
    </main>
  );
}
