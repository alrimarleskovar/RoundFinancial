"use client";

import Link from "next/link";

import { MonoLabel } from "@/components/brand/brand";
import { USER } from "@/data/carteira";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// SAS Passport mini card — score hero + delta + progress bar.
// Click takes the user to the (still-iframe) Reputação screen.

export function PassportMini() {
  const { tokens } = useTheme();
  const t = useT();
  const pct = (USER.score / 850) * 100;

  return (
    <Link
      href="/reputacao"
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        style={{
          borderRadius: 18,
          padding: 20,
          position: "relative",
          overflow: "hidden",
          background: `linear-gradient(155deg, ${tokens.navy}, ${tokens.bgDeep})`,
          border: `1px solid ${tokens.borderStr}`,
          cursor: "pointer",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -20,
            right: -20,
            width: 120,
            height: 120,
            borderRadius: "50%",
            border: `16px solid ${tokens.green}1A`,
          }}
        />
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <MonoLabel color={tokens.green}>{t("home.passport")}</MonoLabel>
            <MonoLabel size={9}>{USER.walletShort}</MonoLabel>
          </div>
          <div
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 56,
              fontWeight: 800,
              color: tokens.text,
              letterSpacing: "-0.03em",
              marginTop: 14,
              lineHeight: 1,
            }}
          >
            {USER.score}
            <span
              style={{
                fontSize: 14,
                color: tokens.green,
                marginLeft: 10,
                fontFamily:
                  "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontWeight: 600,
              }}
            >
              +{USER.scoreDelta}
            </span>
          </div>
          <div
            style={{
              marginTop: 10,
              height: 5,
              background: tokens.fillMed,
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: `linear-gradient(90deg, ${tokens.green}, ${tokens.teal})`,
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 8,
              fontFamily:
                "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              fontSize: 9,
              color: tokens.muted,
            }}
          >
            <span>300</span>
            <span style={{ color: tokens.teal }}>{t("level.proven")}</span>
            <span>850</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
