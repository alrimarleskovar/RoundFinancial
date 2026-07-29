"use client";

/**
 * Every on-chain fact and affordance a group card needs, in one place.
 *
 * # Why this hook exists
 *
 * The mobile redesign (Caio, 2026-07-29) introduces a SECOND card
 * component — a compact one for phones alongside the full desktop card.
 * Two components rendering the same group is fine; two components each
 * deriving "can this member claim / crank / draw / bid?" from raw chain
 * reads is not. The redesign package itself demonstrated the failure
 * mode: its `CompactGroupCard` shipped with only `detailsOpen` /
 * `joinOpen` state, so adopting it as-is would have silently dropped
 * Receber (`claim_payout`), Processar ciclo (`crank_payout` — the
 * SEV-051 liveness escape hatch), Sortear ordem (`finalize_draw`) and
 * both lance panels from every viewport.
 *
 * So the state machine lives here and the cards only *present* it. A new
 * affordance added to this hook shows up in both cards or in neither —
 * it cannot exist in one and be missing from the other.
 *
 * # What stays OUT
 *
 * Modal open/close flags. Those are per-card UI state (the compact card
 * may open a sheet where the desktop card opens a dialog), they never
 * gate an on-chain action, and keeping them local avoids a shared hook
 * that re-renders both cards for a purely visual toggle.
 */

import { useCallback, useMemo, useState } from "react";
import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import type { RawBidView, RawMemberView, RawPoolView } from "@roundfi/sdk";

import type { CatalogGroup } from "@/lib/groups";
import { DEVNET_POOLS, GRACE_PERIOD_SECS } from "@/lib/devnet";
import { sendFinalizeDraw } from "@/lib/finalize-draw";
import { USDC_RATE, useI18n } from "@/lib/i18n";
import {
  freeBidView,
  lanceView,
  showsFreeBidPanel,
  showsLancePanel,
  type FreeBidView,
  type LanceView,
} from "@/lib/lance";
import { useSession } from "@/lib/session";
import { contemplatedSlotForCycle, drawnCycleForSlot, isSorteioPool, useDraw } from "@/lib/sorteio";
import { useBid } from "@/lib/useBid";
import { usePool, usePoolMembers } from "@/lib/usePool";

export interface GroupChainState {
  /** Live pool view, or null for fixture-only groups / failed reads. */
  lp: RawPoolView | null;
  /** The connected wallet's Member record for this pool (chain truth). */
  myMember: RawMemberView | null;
  /** The wallet's sealed free-bid envelope for the current cycle. */
  bid: RawBidView | null;

  // ─── Fill + status (chain when available, fixture otherwise) ────────
  filled: number;
  total: number;
  forming: boolean;
  completed: boolean;
  pct: number;
  devnetMeta: (typeof DEVNET_POOLS)[keyof typeof DEVNET_POOLS] | null;
  /** Duration label honouring the REAL cycle length, not "1 cycle = 1 month". */
  durLabel: string;
  durShort: string;

  // ─── Membership + eligibility ───────────────────────────────────────
  isJoined: boolean;
  joinable: boolean;
  locked: boolean;
  pointsNeeded: number;

  // ─── Affordances ────────────────────────────────────────────────────
  claimReadyDemo: boolean;
  claimReadyChain: boolean;
  claimPrizeBrl: number;
  /** SEV-051: the cycle is stuck and anyone may crank it. */
  needsProcessing: boolean;
  /** Full sorteio pool with no DrawResult — payouts are fail-closed. */
  drawPending: boolean;
  /** `order[my_seat]`; null pre-draw or on arrival pools. */
  myDrawnCycle: number | null;
  /** The pool's DrawResult PDA — payout encoders need it on sorteio pools. */
  drawPda: import("@solana/web3.js").PublicKey | null;
  /** ADR 0012 Fase 2 — embedded bid. */
  lance: LanceView;
  lanceOpen: boolean;
  /** ADR 0012 Fase 3 — sealed free bid. */
  freeBid: FreeBidView;
  freeBidOpen: boolean;

  // ─── Draw action ────────────────────────────────────────────────────
  drawSubmitting: boolean;
  drawError: string | null;
  handleDraw: () => Promise<void>;

  /** Re-read everything a landed transaction could have moved. */
  refreshAll: () => void;
  /** Just the draw + bid reads — cheap refresh after a swap. */
  refreshBidState: () => void;
}

export function useGroupChainState(group: CatalogGroup): GroupChainState {
  const { t } = useI18n();
  const { user, joinedGroupNames, claimedGroups, demoActive } = useSession();
  const adapter = useAdapterWallet();
  const { connection } = useConnection();

  // Live on-chain fill for devnet-linked cards. The "pool1" arg is inert
  // when there's no devnetPool — the hooks are gated by `enabled` below.
  const live = usePool(group.devnetPool ?? "pool1");
  const lp = group.devnetPool && live.status === "ok" && live.pool ? live.pool : null;
  // Sorteio pools only: the payout order lives in the DrawResult PDA.
  const drawRes = useDraw(group.devnetPool, lp);
  const membersRes = usePoolMembers(group.devnetPool ?? "pool1", 30_000, !!group.devnetPool);
  const connectedWallet = adapter.publicKey;

  // Membership is read from CHAIN, not the session flag: a pool joined in
  // a previous session isn't in `joinedGroupNames`.
  const myMember = useMemo(() => {
    if (!group.devnetPool || !connectedWallet || membersRes.status !== "ok") return null;
    return membersRes.members.find((m) => m.wallet.equals(connectedWallet)) ?? null;
  }, [group.devnetPool, connectedWallet, membersRes]);

  const filled = lp ? lp.membersJoined : group.filled;
  const total = lp ? lp.membersTarget : group.total;
  const forming = lp ? lp.status === "forming" : false;
  const completed = lp ? lp.status === "completed" : false;
  const pct = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;
  const devnetMeta = group.devnetPool ? DEVNET_POOLS[group.devnetPool] : null;

  // `group.months` is a CYCLE count, not months. A 2-day-cycle pool with 5
  // cycles is ~10 days, not "5 meses" — read the real duration when we have it.
  const cycleDays = lp ? Math.max(1, Math.round(Number(lp.cycleDurationSec) / 86_400)) : 30;
  const isMonthlyCycle = cycleDays >= 28;
  const durLabel = isMonthlyCycle
    ? t("groupsV2.card.months", { n: group.months })
    : t("groupsV2.card.days", { n: group.months * cycleDays });
  const durShort = isMonthlyCycle ? `${group.months}m` : `${group.months * cycleDays}d`;

  const isJoined = group.joined || joinedGroupNames.includes(group.name) || !!myMember;
  // Only a Forming pool with a free seat can actually be joined — offering
  // "Entrar" on a full/active/finished pool walks the user into a dead modal.
  const joinable = lp ? forming && filled < total : filled < total;
  const locked = !isJoined && group.level > user.level;
  const pointsNeeded = Math.max(0, user.nextLevel - user.score);

  const claimReadyDemo = isJoined && !!group.contemplated && !claimedGroups.includes(group.name);

  // The cycle only advances when the CONTEMPLATED seat claims. Arrival
  // pools: seat == current_cycle. Sorteio: whatever the DrawResult says —
  // and null while undrawn, mirroring the on-chain DrawRequired gate so
  // nobody is offered "Receber" before the draw.
  const contemplatedSlot = lp ? contemplatedSlotForCycle(lp, drawRes.draw, lp.currentCycle) : null;
  const claimReadyChain =
    !demoActive &&
    !!lp &&
    lp.status === "active" &&
    !!myMember &&
    !myMember.defaulted &&
    !myMember.paidOut &&
    contemplatedSlot !== null &&
    myMember.slotIndex === contemplatedSlot;
  const claimPrizeBrl =
    claimReadyChain && lp ? (Number(lp.creditAmount) / 1e6) * USDC_RATE : group.prize;

  // SEV-051 liveness: the contemplated member never claimed and their
  // self-claim grace elapsed, so the cycle can't advance for anyone.
  const contemplatedMember = useMemo(() => {
    if (!lp || lp.status !== "active" || membersRes.status !== "ok") return null;
    if (lp.currentCycle >= lp.cyclesTotal) return null;
    if (contemplatedSlot === null) return null;
    return membersRes.members.find((m) => m.slotIndex === contemplatedSlot) ?? null;
  }, [lp, membersRes, contemplatedSlot]);
  const graceElapsed =
    !!lp && Math.floor(Date.now() / 1000) >= Number(lp.nextCycleAt) + Number(GRACE_PERIOD_SECS);
  const needsProcessing =
    !demoActive &&
    !!contemplatedMember &&
    !contemplatedMember.paidOut &&
    !contemplatedMember.defaulted &&
    graceElapsed &&
    !claimReadyChain;

  const drawPending =
    !demoActive &&
    !!lp &&
    isSorteioPool(lp) &&
    lp.status === "active" &&
    drawRes.status === "ok" &&
    !drawRes.draw;
  const myDrawnCycle =
    lp && myMember && isSorteioPool(lp)
      ? drawnCycleForSlot(lp, drawRes.draw, myMember.slotIndex)
      : null;

  // ADR 0012 Fase 2 — the same depth arithmetic the program gates on, so a
  // panel never promises a bid that will revert.
  const lance = lanceView({
    isSorteio: isSorteioPool(lp),
    poolActive: !!lp && lp.status === "active",
    currentCycle: lp?.currentCycle ?? 0,
    cyclesTotal: lp?.cyclesTotal ?? 0,
    currentBidDepth: lp?.currentBidDepth ?? 0,
    myDrawnCycle,
    contributionsPaid: myMember?.contributionsPaid ?? null,
    defaulted: myMember?.defaulted ?? false,
    paidOut: myMember?.paidOut ?? false,
  });
  // Demo personas never bid: the swap is real on-chain state, so a mock
  // "success" would misrepresent the payout order.
  const lanceOpen = !demoActive && !!group.devnetPool && showsLancePanel(lance.status);

  // ADR 0012 Fase 3 — the sealed bid adds a TIME dimension.
  const bidRes = useBid(
    group.devnetPool,
    lp?.currentCycle ?? null,
    connectedWallet,
    !demoActive && !!myMember && isSorteioPool(lp),
  );
  const freeBid = freeBidView({
    isSorteio: isSorteioPool(lp),
    poolActive: !!lp && lp.status === "active",
    currentCycle: lp?.currentCycle ?? 0,
    cyclesTotal: lp?.cyclesTotal ?? 0,
    currentBidDepth: lp?.currentBidDepth ?? 0,
    myDrawnCycle,
    contributionsPaid: myMember?.contributionsPaid ?? null,
    defaulted: myMember?.defaulted ?? false,
    paidOut: myMember?.paidOut ?? false,
    nowSec: Math.floor(Date.now() / 1000),
    nextCycleAt: Number(lp?.nextCycleAt ?? 0),
    graceSecs: Number(GRACE_PERIOD_SECS),
    hasEnvelope: bidRes.hasEnvelope,
    envelopeRevealed: bidRes.revealed,
  });
  const freeBidOpen = !demoActive && !!group.devnetPool && showsFreeBidPanel(freeBid.status);

  const refreshAll = useCallback(() => {
    void live.refresh();
    void membersRes.refresh();
    void drawRes.refresh();
    void bidRes.refresh();
  }, [live, membersRes, drawRes, bidRes]);

  const refreshBidState = useCallback(() => {
    void drawRes.refresh();
    void bidRes.refresh();
  }, [drawRes, bidRes]);

  const [drawSubmitting, setDrawSubmitting] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  const handleDraw = useCallback(async () => {
    if (!group.devnetPool || !adapter.publicKey || !adapter.sendTransaction) {
      setDrawError(t("groupsV2.card.draw.noWallet"));
      return;
    }
    setDrawSubmitting(true);
    setDrawError(null);
    try {
      await sendFinalizeDraw({
        connection,
        sendTransaction: adapter.sendTransaction,
        pool: DEVNET_POOLS[group.devnetPool].pda,
        caller: adapter.publicKey,
      });
      // Eager re-read: the order chip + Receber gating go live immediately.
      void drawRes.refresh();
      void live.refresh();
      void membersRes.refresh();
    } catch (err) {
      const e = err as { message?: string; logs?: string[] };
      const blob = [e.message, ...(Array.isArray(e.logs) ? e.logs : [])].filter(Boolean).join("\n");
      // A parallel draw (someone else clicked first) collides on the PDA
      // init — that's success from the group's point of view: refresh.
      if (/already in use|AccountAlreadyInUse|custom program error: 0x0/i.test(blob)) {
        void drawRes.refresh();
      } else {
        setDrawError(blob || String(err));
      }
    }
    setDrawSubmitting(false);
  }, [group.devnetPool, adapter, connection, drawRes, live, membersRes, t]);

  return {
    lp,
    myMember,
    bid: bidRes.bid,
    filled,
    total,
    forming,
    completed,
    pct,
    devnetMeta,
    durLabel,
    durShort,
    isJoined,
    joinable,
    locked,
    pointsNeeded,
    claimReadyDemo,
    claimReadyChain,
    claimPrizeBrl,
    needsProcessing,
    drawPending,
    myDrawnCycle,
    drawPda: drawRes.drawPda,
    lance,
    lanceOpen,
    freeBid,
    freeBidOpen,
    drawSubmitting,
    drawError,
    handleDraw,
    refreshAll,
    refreshBidState,
  };
}
