"use client";

import { useState } from "react";

import { MonoLabel, RFIPill } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { JoinGroupModal } from "@/components/modals/JoinGroupModal";
import type { CatalogGroup } from "@/lib/groups";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Single card in the Grupos catalog grid. Renders a locked state
// when `g.level > user.level` so a Lv2 user can't accidentally
// open the join flow on a Lv3 group. The modal still opens but
// shows the locked state — explaining the gap and pointing at
// `/insights` for the path to the next tier.

export function GroupCard({ g }: { g: CatalogGroup }) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoney } = useI18n();
  const { user } = useSession();
  const [joinOpen, setJoinOpen] = useState(false);

  // Level gate: protocol enforces tier eligibility on-chain via
  // `roundfi-core::join_pool` (M2 of the grant roadmap). UI mirrors
  // the rule so users see the block before paying gas.
  const locked = !g.joined && g.level > user.level;

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
        ...glass,
        borderRadius: 18,
        padding: 18,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        opacity: locked ? 0.72 : 1,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: locked
            ? `linear-gradient(90deg, ${tokens.muted}, transparent)`
            : `linear-gradient(90deg, ${tc}, transparent)`,
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
            position: "relative",
          }}
        >
          {g.emoji}
          {locked && (
            <div
              style={{
                position: "absolute",
                top: -6,
                right: -6,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: tokens.surface1,
                border: `1px solid ${tokens.borderStr}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: tokens.muted,
              }}
            >
              <Icons.lock size={11} stroke={tokens.muted} />
            </div>
          )}
        </div>
        {g.joined ? (
          <RFIPill tone="g">{t("groups.card.joined")}</RFIPill>
        ) : locked ? (
          <RFIPill tone="n">
            {t("groups.card.requiresLevel", { lv: g.level })}
          </RFIPill>
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
          border: locked
            ? `1px solid ${tokens.borderStr}`
            : `1px solid ${tokens.borderStr}`,
          background: g.joined
            ? tokens.fillSoft
            : locked
            ? tokens.fillMed
            : `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`,
          color: g.joined
            ? tokens.text
            : locked
            ? tokens.text2
            : tokens.bgDeep,
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
        {locked && <Icons.lock size={13} stroke="currentColor" />}
        {g.joined
          ? t("groups.card.cta.view")
          : locked
          ? t("groups.card.cta.locked", { lv: g.level })
          : t("groups.card.cta.join")}
      </button>
      <JoinGroupModal
        group={g}
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
      />
    </div>
  );
}
