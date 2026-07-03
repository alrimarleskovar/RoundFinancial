"use client";

// /grupos — catalog of ROSCA groups. Graduated from the /grupos-v2 candidate.
//
// Wired to the live session: the catalog is the same CatalogGroup[] built from
// ACTIVE ∪ DISCOVER (∪ any Demo Studio preset); the eligibility badge / level
// gate / "faltam N pontos" all read useSession() (user.level / score /
// nextLevel). Every CTA is real and devnet-aware:
//   - "Entrar no grupo" → JoinGroupModal, which fires an on-chain join_pool()
//     when the group points at a Forming devnet pool (e.g. Piloto · Pool 4)
//     and falls back to the mock flow otherwise — it also owns the locked-state
//     explainer for groups above the viewer's tier.
//   - joined cards → "Ver detalhes" → GroupDetailsModal.
//   - contemplated demo slots → "Receber" → ClaimPayoutModal.
//   - "Abrir novo ciclo" → NewCycleModal.
// Cards on a devnet pool also surface an on-chain explorer link. Every string
// flows through i18n so the TopBar PT/EN + BRL/USDC toggle drives this screen.
//
// The four top chips drive the sort and "Mais filtros" expands a panel
// (nível / categoria / prêmio / duração / disponibilidade) that filters the
// grid live. The card footer (prêmio·parcela + bar + CTA) is pinned to the
// bottom so it aligns across cards regardless of description length.

import { useMemo, useState } from "react";
import Link from "next/link";

import { useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import { Icons } from "@/components/brand/icons";
import { GroupDetailsModal } from "@/components/grupos/GroupDetailsModal";
import { NewCycleModal } from "@/components/grupos/NewCycleModal";
import { ClaimPayoutModal } from "@/components/modals/ClaimPayoutModal";
import { CrankPayoutModal } from "@/components/modals/CrankPayoutModal";
import { JoinGroupModal } from "@/components/modals/JoinGroupModal";
import { ACTIVE_GROUPS, DISCOVER_GROUPS, type ActiveGroup, type GroupLevel } from "@/data/groups";
import { DEVNET_POOLS, GRACE_PERIOD_SECS } from "@/lib/devnet";
import {
  CATEGORY_KEYS,
  fromActive,
  fromDiscover,
  type Category,
  type CatalogGroup,
} from "@/lib/groups";
import { USDC_RATE, useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useWallet } from "@/lib/wallet";
import { useMyDevnetPositions } from "@/lib/useMyDevnetPositions";
import { usePool, usePoolMembers } from "@/lib/usePool";

const TONE_HEX: Record<string, string> = {
  g: "#14F195",
  t: "#00C8FF",
  p: "#9945FF",
  a: "#FFB547",
  r: "#FF5656",
};

type Sort = "relevant" | "popular" | "prize-high" | "installment-low";
type LevelFilter = "all" | GroupLevel;
type CategoryFilter = "all" | Category;
type Budget = "all" | "lt15" | "15to30" | "gt30";
type Duration = "all" | "short" | "mid" | "long";

// [sort key, emoji glyph, i18n key] — emoji stays in code, label translates.
const SORTS: ReadonlyArray<readonly [Sort, string, string]> = [
  ["relevant", "⭐", "groupsV2.sort.relevant"],
  ["popular", "🔥", "groupsV2.sort.popular"],
  ["prize-high", "🏆", "groupsV2.sort.prizeHigh"],
  ["installment-low", "⚡", "groupsV2.sort.installmentLow"],
];

// Group name → description i18n key (bilingual copy lives in the dict).
function descKeyFor(name: string): string {
  if (name.includes("PME")) return "groupsV2.desc.pme";
  if (name.includes("Intercâmbio")) return "groupsV2.desc.intercambio";
  if (name.includes("Veteranos")) return "groupsV2.desc.veteranos";
  if (name.includes("Moto")) return "groupsV2.desc.moto";
  if (name.includes("Casa")) return "groupsV2.desc.casa";
  if (name.includes("Dev")) return "groupsV2.desc.dev";
  if (name.includes("Piloto")) return "groupsV2.desc.piloto";
  return "groupsV2.desc.default";
}

// CatalogGroup → ActiveGroup adapter for the ClaimPayoutModal mock path (it
// only needs name / prize / month / total / emoji; the rest get sane defaults).
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

function Chip({
  active,
  onClick,
  children,
  tone = "#14F195",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3.5 py-2 text-xs font-bold transition ${
        active ? "" : "border-white/[0.08] bg-white/[0.035] text-gray-300 hover:border-white/20"
      }`}
      style={
        active ? { borderColor: `${tone}80`, background: `${tone}1a`, color: tone } : undefined
      }
    >
      {children}
    </button>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <span className="w-28 shrink-0 text-[11px] font-black uppercase tracking-[0.12em] text-gray-500">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// A single catalog card. Owns its modal state (join / details) and reads the
// live session so the eligibility badge, level gate and points-gap CTA are real.
function GroupCard({ group }: { group: CatalogGroup }) {
  const { t, fmtMoney } = useI18n();
  const { user, joinedGroupNames, claimedGroups, demoActive } = useSession();
  const { explorerAddr } = useWallet();
  const adapter = useAdapterWallet();
  const [joinOpen, setJoinOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [processOpen, setProcessOpen] = useState(false);

  const tone = TONE_HEX[group.tone] ?? "#14F195";
  // Live on-chain fill for devnet-linked cards (members_joined / target +
  // Forming status). Fixtures keep their static numbers; the "pool1" arg is
  // inert when there's no devnetPool. This is what shows a real "1/5" + a
  // "Formando · faltam 4" chip instead of a stale fixture count.
  const live = usePool(group.devnetPool ?? "pool1");
  const lp = group.devnetPool && live.status === "ok" && live.pool ? live.pool : null;
  // Live roster for devnet-linked cards — used to detect "it's your turn to
  // receive" (the connected wallet holds the slot whose index === current_cycle).
  // Membership is read from CHAIN here, not the session `isJoined` flag, because a
  // pool joined in a previous session won't be in `joinedGroupNames`.
  const membersRes = usePoolMembers(group.devnetPool ?? "pool1", 30_000, !!group.devnetPool);
  const connectedWallet = adapter.publicKey;
  // The connected wallet's live Member record for this pool (read from chain).
  const myMember = useMemo(() => {
    if (!group.devnetPool || !connectedWallet || membersRes.status !== "ok") return null;
    return membersRes.members.find((m) => m.wallet.equals(connectedWallet)) ?? null;
  }, [group.devnetPool, connectedWallet, membersRes]);
  const filled = lp ? lp.membersJoined : group.filled;
  const total = lp ? lp.membersTarget : group.total;
  const forming = lp ? lp.status === "forming" : false;
  // Every cycle drawn + claimed → the pool is finished on-chain
  // (claim_payout sets PoolStatus::Completed on the last cycle).
  const completed = lp ? lp.status === "completed" : false;
  const pct = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;
  const devnetMeta = group.devnetPool ? DEVNET_POOLS[group.devnetPool] : null;
  // Duration label that respects the REAL on-chain cycle length. `group.months`
  // is actually the cycle count; the prior label assumed 1 cycle = 1 month, so
  // "Pool Rápida · Devnet 2d" (2-day cycle, 5 cycles ≈ 10 days) wrongly showed
  // "5 meses". Use the live pool's `cycleDurationSec` when available; fixtures
  // (no live pool) keep the monthly assumption.
  const cycleDays = lp ? Math.max(1, Math.round(Number(lp.cycleDurationSec) / 86_400)) : 30;
  const isMonthlyCycle = cycleDays >= 28;
  const durLabel = isMonthlyCycle
    ? t("groupsV2.card.months", { n: group.months })
    : t("groupsV2.card.days", { n: group.months * cycleDays });
  const durShort = isMonthlyCycle ? `${group.months}m` : `${group.months * cycleDays}d`;
  // Joined = static fixture flag OR runtime session membership (JOIN_GROUP) OR a
  // real on-chain Member record. The on-chain check matters because a pool joined
  // in a PAST session isn't in joinedGroupNames — without it the card wrongly
  // offers "Entrar" to someone who is already a member (e.g. right after they
  // claimed, when claimReadyChain has gone false).
  const isJoined = group.joined || joinedGroupNames.includes(group.name) || !!myMember;
  // Level gate mirrors roundfi-core::join_pool — block before paying gas.
  const locked = !isJoined && group.level > user.level;
  // Same gap the JoinGroupModal locked card shows: score → next tier.
  const pointsNeeded = Math.max(0, user.nextLevel - user.score);
  // Demo claim (mock mode): the user holds the contemplated slot and hasn't
  // claimed yet this session.
  const claimReadyDemo = isJoined && !!group.contemplated && !claimedGroups.includes(group.name);
  // Real on-chain claim surfacing — the MISSING HALF of the cycle: the cycle only
  // advances when the slot whose index === current_cycle claims its payout. When
  // the connected wallet (myMember, above) holds that slot, show a real "Receber"
  // that fires claim_payout(cycle) in chain mode (memberRecord/pool/seedKey).
  const claimReadyChain =
    !demoActive &&
    !!lp &&
    lp.status === "active" &&
    !!myMember &&
    !myMember.defaulted &&
    !myMember.paidOut &&
    myMember.slotIndex === lp.currentCycle;
  const claimPrizeBrl =
    claimReadyChain && lp ? (Number(lp.creditAmount) / 1e6) * USDC_RATE : group.prize;

  // "Awaiting processing" (SEV-051 liveness) — the group is stuck: the
  // contemplated member (slot === current_cycle) never claimed and their
  // self-claim grace (next_cycle_at + GRACE_PERIOD_SECS) has elapsed, so the
  // cycle can't advance for anyone. This surfaces the permissionless
  // crank_payout as a plain "Processar ciclo" affordance — hiding the
  // admin/cranker concept from the member. Not shown to the contemplated
  // member themselves (they get the "Receber" claim button above instead).
  const contemplatedMember = useMemo(() => {
    if (!lp || lp.status !== "active" || membersRes.status !== "ok") return null;
    if (lp.currentCycle >= lp.cyclesTotal) return null;
    return membersRes.members.find((m) => m.slotIndex === lp.currentCycle) ?? null;
  }, [lp, membersRes]);
  const graceElapsed =
    !!lp && Math.floor(Date.now() / 1000) >= Number(lp.nextCycleAt) + Number(GRACE_PERIOD_SECS);
  const needsProcessing =
    !demoActive &&
    !!contemplatedMember &&
    !contemplatedMember.paidOut &&
    !contemplatedMember.defaulted &&
    graceElapsed &&
    !claimReadyChain;

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-[#0C111A]/95 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] transition-all duration-300 hover:-translate-y-1 hover:border-white/20">
      <div
        className="absolute -right-10 -top-12 h-28 w-28 rounded-full opacity-20 blur-[55px]"
        style={{ background: tone }}
      />

      {/* top — emoji + eligibility badge */}
      <div className="mb-6 flex items-start justify-between">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl text-2xl"
          style={{
            background: `${tone}1A`,
            border: `1px solid ${tone}45`,
            boxShadow: `0 0 28px ${tone}16`,
          }}
        >
          {group.emoji}
        </div>

        {locked ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#9945FF]/30 bg-[#9945FF]/10 px-3 py-1 text-[11px] font-bold text-[#B782FF]">
            <Icons.lock size={12} stroke="currentColor" sw={2} />{" "}
            {t("groupsV2.card.requires", { lv: group.level })}
          </span>
        ) : completed && isJoined ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#00C8FF]/25 bg-[#00C8FF]/10 px-3 py-1 text-[11px] font-bold text-[#00C8FF]">
            <Icons.check size={13} stroke="currentColor" sw={2.6} />{" "}
            {t("groupsV2.card.participated")}
          </span>
        ) : isJoined ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#14F195]/25 bg-[#14F195]/10 px-3 py-1 text-[11px] font-bold text-[#14F195]">
            <Icons.check size={13} stroke="currentColor" sw={2.6} /> {t("groupsV2.card.joined")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#14F195]/25 bg-[#14F195]/10 px-3 py-1 text-[11px] font-bold text-[#14F195]">
            <Icons.check size={13} stroke="currentColor" sw={2.6} /> {t("groupsV2.card.compatible")}
          </span>
        )}
      </div>

      <div className="mb-2 flex items-end gap-2">
        <h3 className="text-2xl font-black tracking-[-0.04em] text-white">{group.name}</h3>
        <span className="mb-1 text-sm font-black" style={{ color: tone }}>
          {durLabel}
        </span>
      </div>

      <p className="mb-3 text-sm leading-relaxed text-gray-400">{t(descKeyFor(group.name))}</p>

      <div className="text-sm text-gray-500">
        {t("groupsV2.card.spots", { dur: durShort, f: filled, t: total })}
      </div>

      {/* devnet pools surface their on-chain address + live fill status */}
      {devnetMeta && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={explorerAddr(devnetMeta.pda.toBase58())}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={`Pool deployed on Solana devnet: ${devnetMeta.pda.toBase58()}`}
            className="inline-flex w-fit items-center gap-1.5 rounded-md border border-[#14F195]/40 bg-[#14F195]/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#14F195] transition hover:bg-[#14F195]/20"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#14F195]" /> on-chain · devnet
          </a>
          {lp && (
            <span
              className="inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em]"
              style={
                needsProcessing
                  ? { borderColor: "#FFB54766", background: "#FFB5471a", color: "#FFB547" }
                  : completed
                    ? { borderColor: "#00C8FF66", background: "#00C8FF1a", color: "#00C8FF" }
                    : forming
                      ? { borderColor: "#FFB54766", background: "#FFB5471a", color: "#FFB547" }
                      : { borderColor: "#14F19566", background: "#14F1951a", color: "#14F195" }
              }
            >
              {needsProcessing
                ? t("groupsV2.card.processing.badge")
                : completed
                  ? t("groupsV2.card.completed")
                  : forming
                    ? t("groupsV2.card.forming", {
                        f: filled,
                        t: total,
                        r: Math.max(0, total - filled),
                      })
                    : t("groupsV2.card.active")}
            </span>
          )}
        </div>
      )}

      {/* footer — pinned to the bottom so it aligns across cards */}
      <div className="mt-auto pt-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
              {t("home.meta.prize")}
            </p>
            <p className="text-2xl font-black tracking-[-0.04em] text-white">
              {fmtMoney(group.prize, { noCents: true })}
            </p>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
              {t("home.installment")}
            </p>
            <p className="text-2xl font-black tracking-[-0.04em] text-white">
              {fmtMoney(group.installment, { noCents: true })}
            </p>
          </div>
        </div>

        <div className="my-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, background: tone, boxShadow: `0 0 18px ${tone}55` }}
          />
        </div>

        {/* Liveness (SEV-051): the contemplated member never claimed and their
            grace elapsed → the cycle is stuck. Surface the permissionless
            crank_payout as a plain "Processar ciclo" affordance. */}
        {needsProcessing && (
          <div className="mb-3 rounded-xl border border-[#FFB547]/30 bg-[#FFB547]/10 p-3">
            <p className="text-xs font-black text-[#FFB547]">
              {t("groupsV2.card.processing.title")}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400">
              {t("groupsV2.card.processing.body")}
            </p>
            <button
              type="button"
              onClick={() => setProcessOpen(true)}
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#FFB547] px-4 py-2.5 text-xs font-black uppercase tracking-wide text-[#1A1200] transition hover:brightness-110"
            >
              {t("groupsV2.card.processing.cta")}
            </button>
          </div>
        )}

        {claimReadyChain || claimReadyDemo ? (
          <button
            type="button"
            onClick={() => setClaimOpen(true)}
            title={t("home.featured.claimTooltip")}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#9945FF] to-[#00C8FF] px-4 py-3 text-sm font-black text-white shadow-[0_10px_30px_rgba(153,69,255,0.25)] transition hover:scale-[1.01]"
          >
            <Icons.ticket size={14} stroke="currentColor" sw={2} />{" "}
            {t("home.featured.claimReceive")}{" "}
            {fmtMoney(claimReadyChain ? claimPrizeBrl : group.prize, { noCents: true })}
          </button>
        ) : locked ? (
          <button
            type="button"
            onClick={() => setJoinOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm font-bold text-gray-400 transition hover:border-white/20 hover:text-gray-300"
          >
            <Icons.lock size={14} stroke="currentColor" sw={2} />{" "}
            {t("groupsV2.card.cta.locked", { pts: pointsNeeded, lv: group.level })}
          </button>
        ) : isJoined ? (
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm font-bold text-white transition hover:border-white/20"
          >
            {t("groups.card.cta.view")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setJoinOpen(true)}
            className="w-full rounded-xl bg-gradient-to-r from-[#14F195] to-[#00C8FF] px-4 py-3 text-sm font-black text-[#03130D] shadow-[0_10px_30px_rgba(20,241,149,0.18)] transition hover:scale-[1.01]"
          >
            {t("groups.card.cta.join")}
          </button>
        )}
      </div>

      {joinOpen && (
        <JoinGroupModal group={group} open={joinOpen} onClose={() => setJoinOpen(false)} />
      )}
      <GroupDetailsModal group={group} open={detailsOpen} onClose={() => setDetailsOpen(false)} />
      {(claimReadyChain || claimReadyDemo) && (
        <ClaimPayoutModal
          group={catalogGroupToActiveGroup(group)}
          open={claimOpen}
          onClose={() => setClaimOpen(false)}
          {...(claimReadyChain && lp && myMember && group.devnetPool
            ? { memberRecord: myMember, pool: lp, seedKey: group.devnetPool }
            : {})}
        />
      )}
      {/* Mount only while open — the modal runs its own usePool/usePoolMembers,
          so mounting it on `needsProcessing` alone would double-poll the chain
          for every stuck card. `processOpen` stays true through the success
          screen (cleared only by the user), so nothing flashes/unmounts. */}
      {group.devnetPool && processOpen && (
        <CrankPayoutModal
          open={processOpen}
          onClose={() => setProcessOpen(false)}
          initialPool={group.devnetPool}
          lockPool
          onSuccess={() => {
            void live.refresh();
            void membersRes.refresh();
          }}
        />
      )}
    </article>
  );
}

export default function GruposPage() {
  const { t, fmtMoneyThreshold } = useI18n();
  const { user, demoGroup, demoActive } = useSession();

  const [sort, setSort] = useState<Sort>("relevant");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [budget, setBudget] = useState<Budget>("all");
  const [duration, setDuration] = useState<Duration>("all");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlyAccessible, setOnlyAccessible] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [newCycleOpen, setNewCycleOpen] = useState(false);

  // The connected wallet's REAL on-chain memberships across the devnet pools
  // (empty for a fresh wallet). In real mode these are the ONLY "joined"
  // groups; the static ACTIVE_GROUPS fixtures (e.g. "Renovação MEI") are
  // demo-only, so a fresh wallet no longer shows them as participating.
  const realPositions = useMyDevnetPositions();
  const joinedOnChainGroups = useMemo<ActiveGroup[]>(() => {
    // Demo mode renders the ACTIVE_GROUPS fixtures, so skip their pools to
    // avoid dups; real mode surfaces every genuine on-chain cota.
    const skip = new Set(demoActive ? ACTIVE_GROUPS.map((g) => g.devnetPool).filter(Boolean) : []);
    const seen = new Set<string>();
    const out: ActiveGroup[] = [];
    for (const pos of realPositions) {
      if (!pos.devnetPool || skip.has(pos.devnetPool) || seen.has(pos.devnetPool)) continue;
      const d = DISCOVER_GROUPS.find((g) => g.devnetPool === pos.devnetPool);
      if (!d) continue;
      seen.add(pos.devnetPool);
      out.push({
        id: `onchain-${d.id}`,
        name: d.name,
        emoji: d.emoji,
        tone: d.tone,
        prize: d.prize,
        month: pos.month,
        total: d.months,
        status: "paying",
        nextDue: 7,
        progress: d.months > 0 ? pos.month / d.months : 0,
        members: d.total,
        draw: "",
        installment: d.installment,
        level: d.level,
        devnetPool: d.devnetPool,
      });
    }
    return out;
  }, [realPositions, demoActive]);

  // Catalog: MY groups (demo fixtures only in demo mode; otherwise my real
  // on-chain cotas) ∪ the joinable DISCOVER catalog (minus anything I've
  // already joined, so it doesn't appear twice) ∪ any Demo Studio preset.
  const enriched: CatalogGroup[] = useMemo(() => {
    const mine: ActiveGroup[] = [...(demoActive ? ACTIVE_GROUPS : []), ...joinedOnChainGroups];
    const joinedPools = new Set(mine.map((g) => g.devnetPool).filter(Boolean));
    const discover = DISCOVER_GROUPS
      // Real mode → only genuine on-chain pools are joinable. The static
      // fixtures (PME, Intercâmbio, Veteranos VIP, Moto Delivery) are demo-only
      // pitch cards; a real tester clicking them fell into a fake mock "join".
      // Hide them unless the Demo Studio is active, so friends only ever join
      // pools that actually exist on devnet (pool4, pool7).
      .filter((g) => demoActive || !!g.devnetPool)
      .filter((g) => !g.devnetPool || !joinedPools.has(g.devnetPool));
    const base: CatalogGroup[] = [...mine.map(fromActive), ...discover.map(fromDiscover)];
    if (demoGroup && !base.some((g) => g.id === demoGroup.id)) {
      return [fromActive(demoGroup), ...base];
    }
    return base;
  }, [demoActive, joinedOnChainGroups, demoGroup]);

  const compatibleCount = enriched.filter((g) => g.level <= user.level).length;

  const filtered = useMemo(() => {
    let rows = enriched;
    if (level !== "all") rows = rows.filter((g) => g.level === level);
    if (category !== "all") rows = rows.filter((g) => g.category === category);
    if (budget !== "all") {
      rows = rows.filter((g) =>
        budget === "lt15"
          ? g.prize < 15000
          : budget === "15to30"
            ? g.prize >= 15000 && g.prize < 30000
            : g.prize >= 30000,
      );
    }
    if (duration !== "all") {
      rows = rows.filter((g) =>
        duration === "short" ? g.months <= 6 : duration === "mid" ? g.months <= 12 : g.months > 12,
      );
    }
    if (onlyOpen) rows = rows.filter((g) => g.filled < g.total);
    if (onlyAccessible) rows = rows.filter((g) => g.level <= user.level);
    if (sort === "popular")
      rows = [...rows].sort((a, b) => b.filled / b.total - a.filled / a.total);
    if (sort === "prize-high") rows = [...rows].sort((a, b) => b.prize - a.prize);
    if (sort === "installment-low") rows = [...rows].sort((a, b) => a.installment - b.installment);
    return rows;
  }, [enriched, sort, level, category, budget, duration, onlyOpen, onlyAccessible, user.level]);

  const activeCount =
    [level, category, budget, duration].filter((x) => x !== "all").length +
    (onlyOpen ? 1 : 0) +
    (onlyAccessible ? 1 : 0);

  const clearAll = () => {
    setLevel("all");
    setCategory("all");
    setBudget("all");
    setDuration("all");
    setOnlyOpen(false);
    setOnlyAccessible(false);
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 text-white animate-in fade-in duration-700 md:gap-7 md:px-8 md:py-8">
      {/* header */}
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-6">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.24em] text-[#14F195] md:mb-3 md:text-[12px]">
            <span className="h-2 w-2 rounded-full bg-[#14F195] shadow-[0_0_12px_#14F195]" />{" "}
            {t("groupsV2.badge")}
          </div>
          <h1 className="text-3xl font-black tracking-[-0.05em] [font-family:var(--font-syne),sans-serif] md:text-6xl">
            {t("groups.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-400 md:mt-3 md:text-base">
            {t("groupsV2.subtitle")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 md:mt-5 md:gap-3">
            <span className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm text-gray-300">
              <Icons.people size={15} stroke="currentColor" />{" "}
              {t("groupsV2.stat.available", { n: enriched.length })}
            </span>
            <span className="inline-flex items-center gap-2 rounded-xl border border-[#14F195]/15 bg-[#14F195]/[0.06] px-4 py-2 text-sm text-gray-300">
              <Icons.check size={15} stroke="#14F195" sw={2.4} />{" "}
              {t("groupsV2.stat.compatible", { n: compatibleCount })}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setNewCycleOpen(true)}
          className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-[#14F195]/30 bg-[#14F195]/[0.08] px-4 py-2.5 text-[13px] font-bold text-[#14F195] transition hover:bg-[#14F195]/[0.14] md:self-auto md:rounded-2xl md:border-0 md:bg-gradient-to-r md:from-[#14F195] md:to-[#00C8FF] md:px-7 md:py-4 md:text-sm md:font-black md:text-[#03130D] md:shadow-[0_12px_36px_rgba(20,241,149,0.22)] md:hover:scale-[1.01]"
        >
          <Icons.plus size={16} stroke="currentColor" sw={2.6} /> {t("groups.newCycle")}
        </button>
      </section>

      {/* filter bar */}
      <section className="rounded-[1.5rem] border border-white/[0.08] bg-[#0B1018]/90 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.25)]">
        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:overflow-visible">
          <div className="flex shrink-0 gap-2 lg:flex-wrap lg:gap-3 lg:shrink">
            {SORTS.map(([key, glyph, labelKey]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSort(key)}
                className={`shrink-0 whitespace-nowrap rounded-xl border px-4 py-2.5 text-[13px] font-bold transition lg:px-5 lg:py-3 lg:text-sm ${
                  sort === key
                    ? "border-[#14F195]/50 bg-[#14F195]/10 text-[#14F195] shadow-[0_0_22px_rgba(20,241,149,0.12)]"
                    : "border-white/[0.08] bg-white/[0.035] text-gray-300 hover:border-white/20"
                }`}
              >
                {glyph} {t(labelKey)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border px-4 py-2.5 text-[13px] font-bold transition lg:px-5 lg:py-3 lg:text-sm ${
              showFilters || activeCount > 0
                ? "border-[#14F195]/40 bg-[#14F195]/[0.08] text-[#14F195]"
                : "border-white/[0.08] bg-white/[0.035] text-gray-300 hover:border-white/20"
            }`}
          >
            {t("groupsV2.moreFilters")}
            {activeCount > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#14F195] px-1 text-[11px] font-black text-[#03130D]">
                {activeCount}
              </span>
            )}
            <span className={`transition-transform ${showFilters ? "rotate-180" : ""}`}>
              <Icons.arrow size={14} stroke="currentColor" sw={2.4} style={{ rotate: "90deg" }} />
            </span>
          </button>
        </div>

        {/* expandable panel */}
        {showFilters && (
          <div className="mt-4 flex flex-col gap-4 border-t border-white/[0.07] pt-4">
            <FilterRow label={t("groups.filter.level")}>
              <Chip active={level === "all"} onClick={() => setLevel("all")}>
                {t("groups.chip.all")}
              </Chip>
              <Chip active={level === 1} onClick={() => setLevel(1)}>
                {t("groupsV2.lvl", { n: 1 })}
              </Chip>
              <Chip active={level === 2} onClick={() => setLevel(2)}>
                {t("groupsV2.lvl", { n: 2 })}
              </Chip>
              <Chip active={level === 3} tone="#9945FF" onClick={() => setLevel(3)}>
                {t("groupsV2.lvl", { n: 3 })}
              </Chip>
              <Chip active={level === 4} tone="#9945FF" onClick={() => setLevel(4)}>
                {t("groupsV2.lvl", { n: 4 })}
              </Chip>
            </FilterRow>

            <FilterRow label={t("groups.filter.category")}>
              <Chip active={category === "all"} onClick={() => setCategory("all")}>
                {t("groups.chip.all")}
              </Chip>
              {CATEGORY_KEYS.map((k) => (
                <Chip key={k} active={category === k} onClick={() => setCategory(k)}>
                  {t(`cat.${k}`)}
                </Chip>
              ))}
            </FilterRow>

            <FilterRow label={t("groups.filter.prize")}>
              <Chip active={budget === "all"} onClick={() => setBudget("all")}>
                {t("groups.chip.any")}
              </Chip>
              <Chip active={budget === "lt15"} onClick={() => setBudget("lt15")}>
                {t("groups.chip.lt15", { v: fmtMoneyThreshold(15000) })}
              </Chip>
              <Chip active={budget === "15to30"} onClick={() => setBudget("15to30")}>
                {t("groups.chip.15to30", {
                  a: fmtMoneyThreshold(15000),
                  b: fmtMoneyThreshold(30000),
                })}
              </Chip>
              <Chip active={budget === "gt30"} onClick={() => setBudget("gt30")}>
                {t("groups.chip.gt30", { v: fmtMoneyThreshold(30000) })}
              </Chip>
            </FilterRow>

            <FilterRow label={t("groups.filter.duration")}>
              <Chip active={duration === "all"} onClick={() => setDuration("all")}>
                {t("groups.chip.any")}
              </Chip>
              <Chip active={duration === "short"} onClick={() => setDuration("short")}>
                {t("groups.chip.lt6")}
              </Chip>
              <Chip active={duration === "mid"} onClick={() => setDuration("mid")}>
                {t("groups.chip.7to12")}
              </Chip>
              <Chip active={duration === "long"} onClick={() => setDuration("long")}>
                {t("groups.chip.gt12")}
              </Chip>
            </FilterRow>

            <FilterRow label={t("groups.filter.avail")}>
              <Chip active={onlyOpen} onClick={() => setOnlyOpen((v) => !v)}>
                {t("groupsV2.chip.onlyOpen")}
              </Chip>
              <Chip active={onlyAccessible} onClick={() => setOnlyAccessible((v) => !v)}>
                {t("groupsV2.chip.onlyCompatible")}
              </Chip>
            </FilterRow>

            <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3 text-[11px]">
              <span className="font-mono text-gray-400">
                {t("groups.ofN", {
                  n: filtered.length,
                  total: enriched.length,
                  c: activeCount,
                  s: activeCount > 1 ? "s" : "",
                })}
              </span>
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="inline-flex items-center gap-1 font-bold text-[#00C8FF] hover:text-[#14F195]"
                >
                  <Icons.close size={12} stroke="currentColor" sw={2.4} /> {t("groups.clear")}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* grid */}
      {filtered.length === 0 ? (
        <section className="flex flex-col items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] py-16 text-center">
          <span className="text-4xl opacity-70">🔍</span>
          <p className="text-base text-gray-400">{t("groups.empty.title")}</p>
          <button
            type="button"
            onClick={clearAll}
            className="rounded-xl border border-[#14F195]/30 bg-[#14F195]/10 px-5 py-2.5 text-sm font-bold text-[#14F195] transition hover:bg-[#14F195]/20"
          >
            {t("groups.clear")}
          </button>
        </section>
      ) : (
        <section className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </section>
      )}

      {/* footer note */}
      <section className="flex flex-col gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 text-sm text-gray-400 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-gray-300">
            <Icons.info size={16} stroke="currentColor" sw={1.8} />
          </span>
          <span>{t("groupsV2.footer.note")}</span>
        </div>
        <Link
          href="/reputacao"
          className="font-bold text-[#14F195] transition-colors hover:text-[#00C8FF]"
        >
          {t("groupsV2.footer.link")} →
        </Link>
      </section>

      <NewCycleModal open={newCycleOpen} onClose={() => setNewCycleOpen(false)} />
    </main>
  );
}
