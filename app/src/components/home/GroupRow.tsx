"use client";

import { useState } from "react";

import { Icons } from "@/components/brand/icons";
import { ClaimPayoutModal } from "@/components/modals/ClaimPayoutModal";
import { PayInstallmentModal } from "@/components/modals/PayInstallmentModal";
import type { ActiveGroup } from "@/data/groups";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Compact row for the "Seus grupos" list under the FeaturedGroup card.
// Whole row is clickable — opens PayInstallmentModal for this
// group's next installment. When the user is the contemplated slot
// (`contemplated === true` AND not yet claimed in this session),
// the row instead opens ClaimPayoutModal in mock mode and shows a
// purple "🏆 Receber" chip to disambiguate from past-drawn groups.

export function GroupRow({ g: baseG }: { g: ActiveGroup }) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoney } = useI18n();
  const { monthsPaidByGroup, claimedGroups } = useSession();
  // Same overlay pattern as FeaturedGroup — month advances live as the
  // user confirms payments this session.
  const paidExtra = monthsPaidByGroup[baseG.name] ?? 0;
  const month = Math.min(baseG.total, baseG.month + paidExtra);
  const g: ActiveGroup = { ...baseG, month, progress: month / baseG.total };
  const [payOpen, setPayOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);

  // Demo Studio mock-mode claim eligibility. Mirrors GroupCard +
  // FeaturedGroup detection so the same Receber CTA appears wherever
  // the contemplated group is rendered.
  const claimReadyDemo = !!g.contemplated && !claimedGroups.includes(g.name);
  // Past-drawn vs current-contemplated semantic split. `status === "drawn"`
  // by itself only says "user was drawn at SOME point" (could be past).
  // Combined with `contemplated === true` it means "current cycle".
  // Without contemplated, we surface "✓ Recebido" so users don't expect
  // a claim button on past drawings (the prize was already disbursed).
  const isPastDrawn = g.status === "drawn" && !claimReadyDemo;

  const tc = ((): string => {
    switch (g.tone) {
      case "g":
        return tokens.green;
      case "t":
        return tokens.teal;
      case "p":
        return tokens.purple;
      case "a":
        return tokens.amber;
      case "r":
        return tokens.red;
    }
  })();

  return (
    <button
      type="button"
      onClick={() => (claimReadyDemo ? setClaimOpen(true) : setPayOpen(true))}
      style={{
        ...glass,
        display: "grid",
        gridTemplateColumns: "40px 1fr auto auto auto",
        gap: 16,
        alignItems: "center",
        padding: 14,
        borderRadius: 14,
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "inherit",
        color: "inherit",
        width: "100%",
        transition: "transform 180ms ease, border-color 180ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateX(2px)";
        e.currentTarget.style.borderColor = `${tc}55`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateX(0)";
        e.currentTarget.style.borderColor = "";
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: `${tc}1A`,
          border: `1px solid ${tc}4D`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
        }}
      >
        {g.emoji}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>{g.name}</div>
        <div
          style={{
            fontSize: 10,
            color: tokens.muted,
            marginTop: 2,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {t("home.month")} {String(g.month).padStart(2, "0")} / {g.total}
          {claimReadyDemo && (
            <span
              style={{
                color: tokens.purple,
                marginLeft: 8,
                fontWeight: 700,
                letterSpacing: "0.06em",
              }}
            >
              🏆 SORTEADO · CLIQUE PARA RECEBER
            </span>
          )}
          {isPastDrawn && <span style={{ color: tokens.green, marginLeft: 8 }}>✓ Recebido</span>}
        </div>
      </div>
      <div
        style={{
          width: 140,
          height: 4,
          background: tokens.fillMed,
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${g.progress * 100}%`,
            height: "100%",
            background: tc,
          }}
        />
      </div>
      <div style={{ textAlign: "right" }}>
        <div
          style={{
            fontSize: 10,
            color: tokens.muted,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {claimReadyDemo ? "Prêmio" : t("home.installment")}
        </div>
        <div
          style={{
            fontFamily: "var(--font-syne), Syne",
            fontSize: 13,
            fontWeight: 700,
            color: claimReadyDemo ? tokens.purple : tokens.text,
          }}
        >
          {fmtMoney(claimReadyDemo ? g.prize : g.installment, { noCents: true })}
        </div>
      </div>
      <Icons.arrow size={16} stroke={claimReadyDemo ? tokens.purple : tokens.muted} />

      <PayInstallmentModal group={baseG} open={payOpen} onClose={() => setPayOpen(false)} />
      {claimReadyDemo ? (
        <ClaimPayoutModal group={baseG} open={claimOpen} onClose={() => setClaimOpen(false)} />
      ) : null}
    </button>
  );
}
