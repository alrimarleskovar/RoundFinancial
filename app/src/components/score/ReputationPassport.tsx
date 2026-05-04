"use client";

import { useEffect, useState } from "react";

import { MonoLabel, RFILogoMark, RFIPill } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { CountUp } from "@/components/ui/CountUp";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

// Big SAS passport card on /reputacao. Same data as the home
// PassportMini but blown up: 96pt Syne score + scale legend +
// user name + level pill. Wallet handle is click-to-copy — in
// production this would copy the real Solana pubkey, here it
// copies whatever's exposed via session.

export function ReputationPassport() {
  const { tokens } = useTheme();
  const t = useT();
  const { user } = useSession();
  const pct = (user.score / 850) * 100;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(id);
  }, [copied]);

  const copyWallet = async () => {
    try {
      await navigator.clipboard.writeText(user.walletShort);
      setCopied(true);
    } catch {
      // Older browsers / missing permissions — silently no-op.
    }
  };

  return (
    <div
      style={{
        borderRadius: 22,
        padding: 28,
        position: "relative",
        overflow: "hidden",
        background: `linear-gradient(155deg, ${tokens.navy} 0%, ${tokens.bgDeep} 60%, ${tokens.navyDeep})`,
        border: `1px solid ${tokens.borderStr}`,
        minHeight: 340,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -40,
          right: -40,
          width: 240,
          height: 240,
          borderRadius: "50%",
          border: `26px solid ${tokens.green}1A`,
          filter: "blur(2px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -60,
          left: -30,
          width: 180,
          height: 180,
          background: `radial-gradient(circle, rgba(0,200,255,0.15), transparent 70%)`,
        }}
      />
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <RFILogoMark size={36} />
          <div style={{ textAlign: "right" }}>
            <MonoLabel>{t("score.cardChain")}</MonoLabel>
            <button
              type="button"
              onClick={copyWallet}
              title={t("score.walletCopy")}
              style={{
                marginTop: 4,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 10,
                color: copied ? tokens.green : tokens.text2,
                transition: "color 180ms ease",
              }}
            >
              {user.walletShort}
              {copied ? (
                <Icons.check size={11} stroke={tokens.green} sw={2.4} />
              ) : (
                <Icons.copy size={11} stroke={tokens.muted} />
              )}
            </button>
            {copied && (
              <div
                style={{
                  marginTop: 2,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  fontSize: 9,
                  color: tokens.green,
                  letterSpacing: "0.08em",
                }}
              >
                {t("score.walletCopied")}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 44 }}>
          <MonoLabel size={10}>{t("score.cardLabel")}</MonoLabel>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              marginTop: 6,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-syne), Syne",
                fontSize: 96,
                fontWeight: 800,
                color: tokens.text,
                letterSpacing: "-0.04em",
                lineHeight: 1,
              }}
            >
              <CountUp
                value={user.score}
                format={(n) => Math.round(n).toString()}
                damping={26}
                stiffness={120}
              />
            </span>
            <span
              style={{
                fontSize: 18,
                color: tokens.green,
                fontWeight: 600,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              +{user.scoreDelta}
            </span>
          </div>
        </div>

        <div
          style={{
            marginTop: 24,
            height: 6,
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
            marginTop: 10,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 10,
            color: tokens.muted,
          }}
        >
          <span>{t("score.scaleLow")}</span>
          <span style={{ color: tokens.teal }}>{t("score.scaleMid")}</span>
          <span>{t("score.scaleHigh")}</span>
        </div>

        <div
          style={{
            marginTop: 24,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 13, color: tokens.text }}>{user.name}</div>
            <div
              style={{
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 10,
                color: tokens.muted,
                marginTop: 2,
              }}
            >
              {user.handle}
            </div>
          </div>
          <RFIPill tone="g">{t("score.lvPill", { n: user.level, name: user.levelLabel })}</RFIPill>
        </div>
      </div>
    </div>
  );
}
