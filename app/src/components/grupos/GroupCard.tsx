"use client";

import { useState } from "react";

import { MonoLabel, RFIPill } from "@/components/brand/brand";
import { JoinGroupModal } from "@/components/modals/JoinGroupModal";
import type { CatalogGroup } from "@/lib/groups";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Single card in the Grupos catalog grid.

export function GroupCard({ g }: { g: CatalogGroup }) {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney } = useI18n();
  const [joinOpen, setJoinOpen] = useState(false);

  const tc = ((): string => {
    switch (g.tone) {
      case "g": return tokens.green;
      case "t": return tokens.teal;
      case "p": return tokens.purple;
      case "a": return tokens.amber;
      case "r": return tokens.red;
    }
  })();

  const fillPct = (g.filled / g.total) * 100;

  return (
    <div
      style={{
        background: tokens.surface1,
        border: `1px solid ${tokens.border}`,
        borderRadius: 18,
        padding: 18,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, ${tc}, transparent)`,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: `${tc}1A`,
            border: `1px solid ${tc}4D`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
          }}
        >
          {g.emoji}
        </div>
        {g.joined ? (
          <RFIPill tone="g">{t("groups.card.joined")}</RFIPill>
        ) : g.level === 3 ? (
          <RFIPill tone="p">{t("groups.card.vip")}</RFIPill>
        ) : (
          <RFIPill tone="n">{t("groups.card.nv1")}</RFIPill>
        )}
      </div>
      <div>
        <div
          style={{
            fontFamily: "var(--font-syne), Syne",
            fontSize: 18,
            fontWeight: 700,
            color: tokens.text,
            letterSpacing: "-0.02em",
          }}
        >
          {g.name}
        </div>
        <div
          style={{
            fontSize: 11,
            color: tokens.muted,
            marginTop: 4,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {g.months}m · {t("groups.card.spots", { f: g.filled, t: g.total })}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <div>
          <MonoLabel size={9}>{t("home.meta.prize")}</MonoLabel>
          <div
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 20,
              fontWeight: 700,
              color: tokens.text,
              marginTop: 4,
            }}
          >
            {fmtMoney(g.prize, { noCents: true })}
          </div>
        </div>
        <div>
          <MonoLabel size={9}>{t("home.installment")}</MonoLabel>
          <div
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 20,
              fontWeight: 700,
              color: tokens.text,
              marginTop: 4,
            }}
          >
            {fmtMoney(g.installment, { noCents: true })}
          </div>
        </div>
      </div>
      <div
        style={{
          height: 4,
          background: tokens.fillMed,
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${fillPct}%`,
            height: "100%",
            background: tc,
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          if (!g.joined) setJoinOpen(true);
        }}
        style={{
          padding: "10px 14px",
          borderRadius: 11,
          border: `1px solid ${tokens.borderStr}`,
          background: g.joined
            ? tokens.fillSoft
            : `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`,
          color: g.joined ? tokens.text : tokens.bgDeep,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
        }}
      >
        {g.joined ? t("groups.card.cta.view") : t("groups.card.cta.join")}
      </button>
      <JoinGroupModal
        group={g}
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
      />
    </div>
  );
}
