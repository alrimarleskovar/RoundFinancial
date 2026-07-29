"use client";

/**
 * Compact group card for phones (Caio's mobile redesign, 2026-07-29).
 *
 * Presentation-only sibling of the full `GroupCard`: both read
 * `useGroupChainState` and both open `GroupCardModals`, so they cannot
 * disagree about whether a member may claim, crank, draw or bid.
 *
 * That split is deliberate. The redesign package shipped this card with
 * only `detailsOpen` / `joinOpen` state, and its page rendered it at
 * EVERY breakpoint — adopting it verbatim would have silently removed
 * Receber (`claim_payout`), Processar ciclo (`crank_payout`, the SEV-051
 * liveness escape hatch), Sortear ordem (`finalize_draw`) and both lance
 * panels from the whole product. The layout here is his; the affordance
 * strip is the part that had to come back.
 *
 * The strip is ordered by urgency, and at most one action shows at a
 * time: a phone card that stacks five CTAs is the "desktop comprimido"
 * problem the redesign set out to fix.
 */

import { useState } from "react";

import { Icons } from "@/components/brand/icons";
import { GroupCardModals, type GroupCardModalFlags } from "@/components/grupos/GroupCardModals";
import type { ActiveGroup } from "@/data/groups";
import type { CatalogGroup } from "@/lib/groups";
import { useI18n } from "@/lib/i18n";
import { useGroupChainState } from "@/lib/useGroupChainState";

export type GroupsTab = "available" | "mine" | "completed";

const TONE_HEX: Record<string, string> = {
  g: "#14F195",
  t: "#00C8FF",
  p: "#9945FF",
  a: "#FFB547",
  r: "#FF5656",
};

export function CompactGroupCard({
  group,
  mode,
  activeGroup,
}: {
  group: CatalogGroup;
  mode: GroupsTab;
  activeGroup?: ActiveGroup;
}) {
  const { t, fmtMoney } = useI18n();
  const chain = useGroupChainState(group);
  const [flags, setFlags] = useState<GroupCardModalFlags>({
    join: false,
    details: false,
    claim: false,
    process: false,
    bid: false,
    prepay: false,
    freeBid: false,
  });
  const open = (k: keyof GroupCardModalFlags) => setFlags((f) => ({ ...f, [k]: true }));
  const close = (k: keyof GroupCardModalFlags) => setFlags((f) => ({ ...f, [k]: false }));

  const tone = TONE_HEX[group.tone] ?? "#14F195";
  const vacancies = Math.max(0, chain.total - chain.filled);
  const isDraw = chain.lp ? chain.myDrawnCycle !== null || /sorteio/i.test(group.name) : false;
  const currentCycle = activeGroup?.month ?? 1;
  const nextDue = activeGroup?.nextDue ?? 7;

  // ── The one action this card leads with ────────────────────────────
  // Urgency order: the group is BLOCKED (needs a draw / needs cranking)
  // before anything a single member gains from. Money the member can take
  // (Receber) outranks money they'd spend (lance).
  const action: null | { key: keyof GroupCardModalFlags | "draw"; label: string; tone: string } =
    chain.drawPending
      ? { key: "draw", label: t("groupsV2.card.draw.cta"), tone: "#9945FF" }
      : chain.needsProcessing
        ? { key: "process", label: t("groupsV2.card.processing.cta"), tone: "#FFB547" }
        : chain.claimReadyChain || chain.claimReadyDemo
          ? { key: "claim", label: t("home.featured.claimReceive"), tone: "#14F195" }
          : chain.freeBidOpen && chain.freeBid.status !== "sealed"
            ? {
                key: "freeBid",
                label:
                  chain.freeBid.status === "canReveal"
                    ? t("groupsV2.card.freeBid.ctaOpen")
                    : t("groupsV2.card.freeBid.ctaSeal"),
                tone: "#00C8FF",
              }
            : chain.lanceOpen && chain.lance.status === "ready"
              ? { key: "bid", label: t("groupsV2.card.lance.cta"), tone: "#9945FF" }
              : null;

  // A sealed envelope has NO action — the program rejects a second commit
  // on `init`, so a button here could only produce a revert.
  const sealedNote = chain.freeBidOpen && chain.freeBid.status === "sealed";

  return (
    <>
      <article className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0C111A]/95 p-4 shadow-[0_14px_44px_rgba(0,0,0,0.22)]">
        <div
          className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full opacity-[0.12] blur-3xl"
          style={{ background: tone }}
        />

        <div className="relative flex items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
            style={{ background: `${tone}14`, border: `1px solid ${tone}32` }}
          >
            {group.emoji}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[15px] font-bold leading-tight tracking-[-0.025em] text-white">
                {group.name}
              </h3>
              <span
                className="shrink-0 rounded-md px-2 py-1 text-[8px] font-black uppercase tracking-[0.1em]"
                style={{ background: `${tone}14`, color: tone }}
              >
                {isDraw ? t("groupsV2.compact.byDraw") : t("groupsV2.compact.byOrder")}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-white/40">
              {mode === "mine"
                ? t("groupsV2.compact.cycleOf", { c: currentCycle, t: group.months })
                : t("groupsV2.compact.termLevel", { d: chain.durShort, lv: group.level })}
            </p>
            {/* The drawn turn is the single fact a sorteio member checks
                most — keep it on the card, not behind "Ver detalhes". */}
            {chain.myDrawnCycle !== null && !chain.completed && (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-[#9945FF]/40 bg-[#9945FF]/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-[#B782FF]">
                🎲{" "}
                {t("groupsV2.card.draw.yourCycle", { n: chain.myDrawnCycle + 1, t: chain.total })}
              </span>
            )}
          </div>
        </div>

        {mode === "available" ? (
          <div className="relative mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/[0.06] pt-4">
            <div>
              <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-white/35">
                {t("home.installment")}
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {fmtMoney(group.installment, { noCents: true })}
              </p>
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-white/35">
                {t("home.meta.prize")}
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {fmtMoney(group.prize, { noCents: true })}
              </p>
            </div>
            <div className="col-span-2 flex items-center justify-between text-[10px]">
              <span className="text-white/45">
                {t("groupsV2.compact.vacancies", { n: vacancies })}
              </span>
              <span className="font-semibold" style={{ color: tone }}>
                {chain.filled}/{chain.total}
              </span>
            </div>
          </div>
        ) : mode === "mine" ? (
          <div className="relative mt-4 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-4">
            <div className="rounded-xl bg-white/[0.035] p-3">
              <p className="text-[8px] uppercase tracking-[0.12em] text-white/35">
                {t("home.meta.next")}
              </p>
              <p className="mt-1 text-[13px] font-semibold text-white">
                {t("mhome.days", { n: nextDue })}
              </p>
              <p className="mt-0.5 text-[9px] text-white/45">
                {fmtMoney(group.installment, { noCents: true })}
              </p>
            </div>
            <div className="rounded-xl bg-[#00F59B]/[0.05] p-3">
              <p className="text-[8px] uppercase tracking-[0.12em] text-white/35">
                {t("mhome.nextAction")}
              </p>
              <p className="mt-1 text-[13px] font-semibold text-[#00F59B]">
                {action ? action.label : t("home.payInstallment")}
              </p>
              <p className="mt-0.5 text-[9px] text-white/45">{t("groupsV2.card.active")}</p>
            </div>
          </div>
        ) : (
          <div className="relative mt-4 flex items-center justify-between rounded-xl border-t border-white/[0.06] bg-white/[0.025] p-3">
            <div>
              <p className="text-[8px] uppercase tracking-[0.12em] text-white/35">
                {t("groupsV2.compact.result")}
              </p>
              <p className="mt-1 text-[13px] font-semibold text-white">
                {t("groupsV2.compact.finished")}
              </p>
            </div>
            <span className="rounded-lg border border-[#23D9FF]/20 bg-[#23D9FF]/10 px-2.5 py-1.5 text-[9px] font-bold text-[#23D9FF]">
              {t("groupsV2.card.completed")}
            </span>
          </div>
        )}

        {/* ── Affordance strip ──────────────────────────────────────── */}
        {sealedNote && (
          <p className="relative mt-3 rounded-lg border border-[#00C8FF]/25 bg-[#00C8FF]/[0.07] px-3 py-2 text-[10px] leading-snug text-[#7BEAFF]">
            🔒{" "}
            {t("groupsV2.card.freeBid.sealed", {
              h: Math.max(1, Math.round(chain.freeBid.secondsLeft / 3600)),
            })}
          </p>
        )}
        {chain.drawError && (
          <p className="relative mt-2 max-h-16 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px] leading-relaxed text-[#FF5656]">
            {chain.drawError}
          </p>
        )}

        {action ? (
          <button
            type="button"
            onClick={() => (action.key === "draw" ? void chain.handleDraw() : open(action.key))}
            disabled={action.key === "draw" && chain.drawSubmitting}
            className="relative mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[11px] font-black text-[#03130D] transition active:scale-[0.99] disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${action.tone}, #00C8FF)` }}
          >
            {action.key === "draw" && chain.drawSubmitting
              ? t("groupsV2.card.draw.drawing")
              : action.label}
          </button>
        ) : chain.locked ? (
          <button
            type="button"
            onClick={() => open("join")}
            className="relative mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-[11px] font-bold text-gray-400"
          >
            <Icons.lock size={12} stroke="currentColor" sw={2} />{" "}
            {t("groupsV2.card.cta.locked", { pts: chain.pointsNeeded, lv: group.level })}
          </button>
        ) : mode === "available" && chain.joinable && !chain.isJoined ? (
          <button
            type="button"
            onClick={() => open("join")}
            className="relative mt-3 flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#14F195] to-[#00C8FF] px-4 py-3 text-[11px] font-black text-[#03130D] transition active:scale-[0.99]"
          >
            {t("groups.card.cta.join")}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => open("details")}
          className={`relative mt-2 flex w-full items-center justify-center rounded-xl px-4 py-3 text-[11px] font-black transition active:scale-[0.99] ${
            action
              ? "border border-white/[0.1] bg-white/[0.04] text-white hover:border-[#00F59B]/35"
              : mode === "mine"
                ? "bg-gradient-to-r from-[#00F59B] to-[#23D9FF] text-[#03130D]"
                : "border border-white/[0.1] bg-white/[0.04] text-white hover:border-[#00F59B]/35"
          }`}
        >
          {mode === "mine"
            ? t("groupsV2.compact.follow")
            : mode === "completed"
              ? t("groupsV2.compact.history")
              : t("groups.card.cta.view")}
        </button>
      </article>

      <GroupCardModals
        group={group}
        chain={chain}
        flags={flags}
        onClose={close}
        detailsJoined={mode !== "available"}
        {...(mode === "available"
          ? {
              onDetailsJoin: () => {
                close("details");
                open("join");
              },
            }
          : {})}
      />
    </>
  );
}
