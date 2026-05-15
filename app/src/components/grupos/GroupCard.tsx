"use client";

import { useState } from "react";

import { MonoLabel, RFIPill } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { GroupDetailsModal } from "@/components/grupos/GroupDetailsModal";
import { ClaimPayoutModal } from "@/components/modals/ClaimPayoutModal";
import { JoinGroupModal } from "@/components/modals/JoinGroupModal";
import type { ActiveGroup } from "@/data/groups";
import { DEVNET_POOLS } from "@/lib/devnet";
import type { CatalogGroup } from "@/lib/groups";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";
import { useWallet } from "@/lib/wallet";

// Single card in the Grupos catalog grid. Renders a locked state
// when `g.level > user.level` so a Lv2 user can't accidentally
// open the join flow on a Lv3 group. The modal still opens but
// shows the locked state — explaining the gap and pointing at
// `/insights` for the path to the next tier.

// CatalogGroup → ActiveGroup adapter for the ClaimPayoutModal mock
// path. The modal's chain mode reads everything from on-chain views;
// mock mode only needs `name`, `prize`, `month`, `total`, `emoji` —
// the rest are filled with reasonable defaults.
function catalogGroupToActiveGroup(g: CatalogGroup): ActiveGroup {
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    tone: g.tone,
    prize: g.prize,
    month: 1,
    total: g.months,
    status: "drawn",
    nextDue: 0,
    progress: 0,
    members: g.total,
    draw: "ganho neste ciclo",
    installment: g.installment,
    level: g.level,
    contemplated: g.contemplated,
  };
}

export function GroupCard({ g }: { g: CatalogGroup }) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoney } = useI18n();
  const { user, joinedGroupNames, claimedGroups } = useSession();
  const { explorerAddr } = useWallet();
  const [joinOpen, setJoinOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const devnetMeta = g.devnetPool ? DEVNET_POOLS[g.devnetPool] : null;

  // Joined state overlays: static `g.joined` OR runtime session
  // membership (set by JOIN_GROUP and BUY_SHARE actions).
  const isJoined = g.joined || joinedGroupNames.includes(g.name);
  // Level gate: protocol enforces tier eligibility on-chain via
  // `roundfi-core::join_pool` (M2 of the grant roadmap). UI mirrors
  // the rule so users see the block before paying gas.
  const locked = !isJoined && g.level > user.level;
  // Claim eligibility (Demo Studio mock-mode): the user has been
  // flagged as the contemplated slot AND hasn't yet claimed in this
  // session. The on-chain claim path lives in FeaturedGroup —
  // GroupCard only handles the demo flow.
  const claimReadyDemo = isJoined && !!g.contemplated && !claimedGroups.includes(g.name);

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
        {isJoined ? (
          <RFIPill tone="g">{t("groups.card.joined")}</RFIPill>
        ) : locked ? (
          <RFIPill tone="n">{t("groups.card.requiresLevel", { lv: g.level })}</RFIPill>
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
        {devnetMeta ? (
          <a
            href={explorerAddr(devnetMeta.pda.toBase58())}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 8,
              padding: "3px 8px",
              borderRadius: 6,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              fontSize: 9,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: tokens.green,
              background: `${tokens.green}1a`,
              border: `1px solid ${tokens.green}55`,
              textDecoration: "none",
            }}
            title={`Pool deployed on Solana devnet: ${devnetMeta.pda.toBase58()}`}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: tokens.green,
              }}
            />
            on-chain · devnet
          </a>
        ) : null}
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
      {claimReadyDemo ? (
        <button
          type="button"
          onClick={() => setClaimOpen(true)}
          style={{
            padding: "10px 14px",
            borderRadius: 11,
            border: "none",
            background: `linear-gradient(135deg, ${tokens.purple}, ${tokens.teal})`,
            color: tokens.text,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
            boxShadow: `0 6px 18px ${tokens.purple}55`,
          }}
          title={t("home.featured.claimTooltip")}
        >
          <Icons.ticket size={13} stroke={tokens.text} sw={2} />
          {t("home.featured.claimReceive")} {fmtMoney(g.prize, { noCents: true })}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            if (isJoined) setDetailsOpen(true);
            else setJoinOpen(true); // join modal handles its own locked-state explainer
          }}
          style={{
            padding: "10px 14px",
            borderRadius: 11,
            border: locked ? `1px solid ${tokens.borderStr}` : `1px solid ${tokens.borderStr}`,
            background: isJoined
              ? tokens.fillSoft
              : locked
                ? tokens.fillMed
                : `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`,
            color: isJoined ? tokens.text : locked ? tokens.text2 : tokens.bgDeep,
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
          {isJoined
            ? t("groups.card.cta.view")
            : locked
              ? t("groups.card.cta.locked", { lv: g.level })
              : t("groups.card.cta.join")}
        </button>
      )}
      <JoinGroupModal group={g} open={joinOpen} onClose={() => setJoinOpen(false)} />
      <GroupDetailsModal group={g} open={detailsOpen} onClose={() => setDetailsOpen(false)} />
      {claimReadyDemo ? (
        <ClaimPayoutModal
          group={catalogGroupToActiveGroup(g)}
          open={claimOpen}
          onClose={() => setClaimOpen(false)}
        />
      ) : null}
    </div>
  );
}
