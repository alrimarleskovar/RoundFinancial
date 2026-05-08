"use client";

import { MonoLabel } from "@/components/brand/brand";
import {
  LEVEL_PARAMS,
  type FrameMetrics,
  type GroupLevel,
  type GroupMaturity,
} from "@/lib/stressLab";
import { useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Triple Shield card — surfaces the whitepaper's three structural
// shields directly in /lab so jurors can map the math they see
// (audit panel buckets) back to the protocol narrative.
//
// Canonical mapping from docs/architecture.md §4.5.0:
//   • Shield 1 = Sorteio Semente — cycle 1 retains ~91.6% of capital
//                 (claim_payout.rs cycle==1 special case)
//   • Shield 2 = Escrow Adaptativo + Stake — reputation-tier payout/
//                 escrow/stake split (LEVEL_PARAMS: Lv1 50/50/50/5m,
//                 Lv2 30/45/55/4m, Lv3 10/35/65/3m)
//   • Shield 3 = Cofre Solidário + Cascata de Yield — 1% solidarity
//                 + Kamino yield waterfall (admin fee → Guarantee
//                 Fund capped at 150% × credit → 65% LPs → 35%
//                 participants)
//
// Values reactive to current frame; before Run, shows static target
// rule descriptions.

interface Props {
  metrics: FrameMetrics;
  level: GroupLevel;
  maturity: GroupMaturity;
  finished: boolean;
}

function fmtUsdc(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function TripleShieldCard({ metrics, level, maturity, finished }: Props) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();

  const params = LEVEL_PARAMS[level];
  const releaseMo = maturity === "mature" ? params.releaseMonthsMature : params.releaseMonths;

  // Shield 2 split — show the 3 numbers from the level params: stake
  // / payout / escrow. payoutPct and escrowPct come from
  // LEVEL_PARAMS as floats; stake is already %.
  const payoutPct = Math.round((1 - params.escrowPct) * 100 - params.stakePct);
  const escrowPct = Math.round(params.escrowPct * 100);

  return (
    <div
      style={{
        ...glass,
        padding: 18,
        borderRadius: 18,
        marginBottom: 12,
        border: `1px solid ${tokens.purple}33`,
      }}
    >
      <MonoLabel size={9} color={tokens.purple}>
        ◆ {t("lab.shields.title")}
      </MonoLabel>

      {/* Shield 1 — Seed Draw */}
      <Row
        index={1}
        title={t("lab.shields.s1.title")}
        rule={t("lab.shields.s1.rule")}
        valueLabel={t("lab.shields.s1.target")}
        valueRight="91.6%"
        accent={tokens.green}
        muted={tokens.muted}
        text={tokens.text}
        text2={tokens.text2}
        active={finished}
      />

      {/* Shield 2 — Adaptive Escrow + Stake */}
      <Row
        index={2}
        title={t("lab.shields.s2.title")}
        rule={t("lab.shields.s2.rule", {
          stake: params.stakePct,
          payout: payoutPct,
          escrow: escrowPct,
          months: releaseMo,
        })}
        valueLabel={t("lab.shields.s2.outstanding")}
        valueRight={`$${fmtUsdc(metrics.outstandingEscrow)}`}
        accent={tokens.teal}
        muted={tokens.muted}
        text={tokens.text}
        text2={tokens.text2}
        active={finished}
      />

      {/* Shield 3 — Solidarity + Guarantee */}
      <Row
        index={3}
        title={t("lab.shields.s3.title")}
        rule={t("lab.shields.s3.rule")}
        valueLabel={t("lab.shields.s3.buckets")}
        valueRight={`$${fmtUsdc(metrics.solidarityVault)} + $${fmtUsdc(metrics.guaranteeFund)} / $${fmtUsdc(metrics.guaranteeFundCap)}`}
        accent={tokens.amber}
        muted={tokens.muted}
        text={tokens.text}
        text2={tokens.text2}
        active={finished}
        last
      />
    </div>
  );
}

interface RowProps {
  index: 1 | 2 | 3;
  title: string;
  rule: string;
  valueLabel: string;
  valueRight: string;
  accent: string;
  muted: string;
  text: string;
  text2: string;
  active: boolean;
  last?: boolean;
}

function Row({
  index,
  title,
  rule,
  valueLabel,
  valueRight,
  accent,
  muted,
  text,
  text2,
  active,
  last,
}: RowProps) {
  return (
    <div
      style={{
        marginTop: 12,
        paddingBottom: last ? 0 : 12,
        borderBottom: last ? "none" : `1px solid ${muted}22`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 9,
            fontWeight: 700,
            color: accent,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            padding: "2px 6px",
            borderRadius: 4,
            background: `${accent}1A`,
            border: `1px solid ${accent}44`,
          }}
        >
          ◆ ESCUDO {index}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: text }}>{title}</span>
      </div>
      <div
        style={{
          fontSize: 10,
          color: text2,
          lineHeight: 1.5,
          marginLeft: 2,
          marginBottom: 6,
        }}
      >
        {rule}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: 10,
        }}
      >
        <span style={{ color: muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {valueLabel}
        </span>
        <span style={{ color: active ? accent : muted, fontWeight: 700 }}>{valueRight}</span>
      </div>
    </div>
  );
}
