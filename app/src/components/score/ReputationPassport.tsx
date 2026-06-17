"use client";

import { useEffect, useState } from "react";

import { MonoLabel, RFILogoMark, RFIPill } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { CountUp } from "@/components/ui/CountUp";
import { useT } from "@/lib/i18n";
import {
  PASSPORT_TIERS,
  PASSPORT_MAX_SCORE,
  TIER_KEYS,
  tierForScore,
  scorePct,
} from "@/lib/passport";
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
  const tier = tierForScore(user.score);
  const pct = scorePct(user.score);
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
      className="group transition-transform duration-500 hover:scale-[1.01]"
      style={{
        borderRadius: 22,
        padding: 28,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: `linear-gradient(155deg, ${tokens.navy} 0%, ${tokens.bgDeep} 60%, ${tokens.navyDeep})`,
        border: `1px solid ${tokens.borderStr}`,
        minHeight: 400,
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
      {/* Mirrored shine sweep on hover — same effect as the home SAS passport. */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-tr from-transparent via-white/5 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
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

        {/* Score + bar sit together, dropped toward the lower half of the
            card via this auto top-margin (the header stays pinned up top). */}
        <div style={{ marginTop: "auto" }}>
          <MonoLabel size={12}>{t("score.cardLabel")}</MonoLabel>
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

        {/* Reputation tier bar — same 0-1000, four-tier scale and animated
            gradient as the home SAS passport, blown up for this detail card.
            Kept tight under the score (the score block carries the auto push). */}
        <div
          style={{
            marginTop: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: tokens.muted,
          }}
        >
          <span>{t("home.passport.tierLabel")}</span>
          <span style={{ color: tokens.purple, fontWeight: 700 }}>
            Tier {tier.level} / {t(TIER_KEYS[tier.level])}
          </span>
        </div>
        <div
          style={{
            marginTop: 8,
            height: 8,
            background: tokens.fillMed,
            borderRadius: 999,
            overflow: "hidden",
            position: "relative",
            border: `1px solid ${tokens.border}`,
          }}
        >
          <div
            className="animate-gradient-x"
            style={{
              width: `${pct}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${tokens.purple}, ${tokens.green}, ${tokens.purple})`,
              backgroundSize: "200% auto",
            }}
          />
          {PASSPORT_TIERS.slice(1).map((tt) => (
            <span
              key={tt.level}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${(tt.min / PASSPORT_MAX_SCORE) * 100}%`,
                width: 1,
                background: "rgba(255,255,255,0.25)",
              }}
            />
          ))}
        </div>
        {/* Four-tier legend — the tier the score currently sits in lights up. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 10,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {PASSPORT_TIERS.map((tt) => (
            <span
              key={tt.level}
              style={{
                color: tt.level === tier.level ? tokens.green : tokens.muted,
                fontWeight: tt.level === tier.level ? 700 : 400,
              }}
            >
              {t(TIER_KEYS[tt.level])}
            </span>
          ))}
        </div>

        <div
          style={{
            marginTop: 16,
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
          <RFIPill tone={user.level === 3 ? "p" : user.level === 2 ? "g" : "a"}>
            {user.level === 3 ? "✦ " : ""}
            {t("score.lvPill", { n: user.level, name: user.levelLabel })}
          </RFIPill>
        </div>
      </div>
    </div>
  );
}
