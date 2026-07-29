"use client";

/**
 * The modal stack a group card can open, in one component.
 *
 * Companion to `useGroupChainState`: that hook is the single source of
 * truth for *whether* an affordance is available, this component is the
 * single source of truth for *what happens when you tap it*. The two
 * card layouts (full desktop card + compact mobile card) then differ only
 * in presentation — which is the whole point of keeping two of them.
 *
 * Each card still owns its own open/close flags: those are presentation
 * state, and a shared hook for them would re-render both cards on a
 * purely visual toggle.
 */

import { ClaimPayoutModal } from "@/components/modals/ClaimPayoutModal";
import { CrankPayoutModal } from "@/components/modals/CrankPayoutModal";
import { FreeBidModal } from "@/components/modals/FreeBidModal";
import { JoinGroupModal } from "@/components/modals/JoinGroupModal";
import { PayInstallmentModal } from "@/components/modals/PayInstallmentModal";
import { PlaceBidModal } from "@/components/modals/PlaceBidModal";
import { GroupDetailsModal } from "@/components/grupos/GroupDetailsModal";
import { catalogGroupToActiveGroup, type CatalogGroup } from "@/lib/groups";
import { isSorteioPool } from "@/lib/sorteio";
import type { GroupChainState } from "@/lib/useGroupChainState";

export interface GroupCardModalFlags {
  join: boolean;
  details: boolean;
  claim: boolean;
  process: boolean;
  /** ADR 0012 Fase 2 — embedded bid. */
  bid: boolean;
  /** ADR 0012 Fase 1 — prepay, reached from the "needs more depth" panel. */
  prepay: boolean;
  /** ADR 0012 Fase 3 — sealed free bid (seal + open). */
  freeBid: boolean;
}

export interface GroupCardModalsProps {
  group: CatalogGroup;
  chain: GroupChainState;
  flags: GroupCardModalFlags;
  onClose: (key: keyof GroupCardModalFlags) => void;
  /** Details modal: render as a member's view (compact card's tabs know this). */
  detailsJoined?: boolean;
  /** Details modal: offer "join" inline (compact card's available tab). */
  onDetailsJoin?: () => void;
}

export function GroupCardModals({
  group,
  chain,
  flags,
  onClose,
  detailsJoined,
  onDetailsJoin,
}: GroupCardModalsProps) {
  const { lp, myMember, claimReadyChain, claimReadyDemo, drawPda, lance, freeBid } = chain;
  const activeGroup = catalogGroupToActiveGroup(group);

  return (
    <>
      {flags.join && (
        <JoinGroupModal group={group} open={flags.join} onClose={() => onClose("join")} />
      )}
      <GroupDetailsModal
        group={group}
        open={flags.details}
        onClose={() => onClose("details")}
        {...(detailsJoined !== undefined ? { joined: detailsJoined } : {})}
        {...(onDetailsJoin ? { onJoin: onDetailsJoin } : {})}
      />
      {(claimReadyChain || claimReadyDemo) && (
        <ClaimPayoutModal
          group={activeGroup}
          open={flags.claim}
          onClose={() => onClose("claim")}
          {...(claimReadyChain && lp && myMember && group.devnetPool
            ? {
                memberRecord: myMember,
                pool: lp,
                seedKey: group.devnetPool,
                // Sorteio pools: claim_payout needs the DrawResult as a
                // remaining account (claimReadyChain implies it exists).
                ...(isSorteioPool(lp) && drawPda ? { drawResult: drawPda } : {}),
              }
            : {})}
        />
      )}
      {/* Every modal below mounts only while open: each runs its own
          usePool/usePoolMembers, so mounting on the affordance flag alone
          would double-poll the chain for every card on screen. */}
      {group.devnetPool && flags.bid && (
        <PlaceBidModal
          group={activeGroup}
          open={flags.bid}
          onClose={() => onClose("bid")}
          view={lance}
          seedKey={group.devnetPool}
          // The swap lives in the DrawResult, so THAT's the read that has to
          // refresh — otherwise the card keeps showing the old drawn cycle
          // and the Receber gate stays closed.
          onSuccess={chain.refreshAll}
        />
      )}
      {group.devnetPool && flags.freeBid && lp && myMember && (
        <FreeBidModal
          group={activeGroup}
          open={flags.freeBid}
          onClose={() => onClose("freeBid")}
          view={freeBid}
          seedKey={group.devnetPool}
          installmentAmount={lp.installmentAmount}
          cyclesTotal={lp.cyclesTotal}
          contributionsPaid={myMember.contributionsPaid}
          slotIndex={myMember.slotIndex}
          bid={chain.bid}
          // The envelope, the swapped order and the member's installment
          // count all move on a reveal — refresh every one of them.
          onSuccess={chain.refreshAll}
        />
      )}
      {group.devnetPool && flags.prepay && (
        <PayInstallmentModal
          group={activeGroup}
          open={flags.prepay}
          onClose={() => onClose("prepay")}
          onSuccess={chain.refreshAll}
        />
      )}
      {group.devnetPool && flags.process && (
        <CrankPayoutModal
          open={flags.process}
          onClose={() => onClose("process")}
          initialPool={group.devnetPool}
          lockPool
          onSuccess={chain.refreshAll}
        />
      )}
    </>
  );
}
