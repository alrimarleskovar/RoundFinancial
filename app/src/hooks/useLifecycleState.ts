"use client";

import { useReducer } from "react";

import type { LifecycleEvent } from "@roundfi/orchestrator";

/**
 * Derived UI state built from the LifecycleEvent stream. Same shape
 * whether the events come from the in-browser mock (Step 7) or the
 * real orchestrator over SSE (Step 8) — the UI doesn't care.
 */

export type MemberUiStatus =
  | "pending" // not joined yet
  | "current" // caught up on contributions
  | "late" // skipped a contribution this cycle
  | "paid_out" // already received credit
  | "defaulted"; // settle_default fired

export interface MemberUi {
  name: string;
  slotIndex: number;
  reputationLevel: number;
  stakeDeposited: bigint;
  contributionsPaid: number;
  totalContributed: bigint;
  totalReceived: bigint;
  status: MemberUiStatus;
}

export interface PoolUi {
  status: "idle" | "forming" | "Forming" | "Active" | "Completed" | "Liquidated";
  currentCycle: number;
  totalCycles: number;
  installmentAmount: bigint;
  creditAmount: bigint;
  totalContributed: bigint;
  totalPaidOut: bigint;
  solidarityBalance: bigint;
  escrowBalance: bigint;
  poolUsdcVaultBalance: bigint;
  defaultedMembers: number;
}

export interface PhaseUi {
  name: string;
  label: string;
  startedAt: number;
  done: boolean;
}

export interface LifecycleState {
  running: boolean;
  finished: boolean;
  events: LifecycleEvent[];
  pool: PoolUi;
  members: MemberUi[];
  currentPhase: PhaseUi | null;
  summary: Extract<LifecycleEvent, { kind: "summary" }> | null;
  stats: {
    okCount: number;
    skipCount: number;
    failCount: number;
  };
}

const INITIAL_POOL: PoolUi = {
  status: "idle",
  currentCycle: 0,
  totalCycles: 0,
  installmentAmount: 0n,
  creditAmount: 0n,
  totalContributed: 0n,
  totalPaidOut: 0n,
  solidarityBalance: 0n,
  escrowBalance: 0n,
  poolUsdcVaultBalance: 0n,
  defaultedMembers: 0,
};

export const INITIAL_STATE: LifecycleState = {
  running: false,
  finished: false,
  events: [],
  pool: INITIAL_POOL,
  members: [],
  currentPhase: null,
  summary: null,
  stats: { okCount: 0, skipCount: 0, failCount: 0 },
};

export type LifecycleAction =
  | {
      type: "reset";
      cyclesTotal: number;
      installment: bigint;
      credit: bigint;
      memberNames: string[];
    }
  | { type: "start" }
  | { type: "event"; event: LifecycleEvent }
  | { type: "finish" };

function applyEvent(state: LifecycleState, e: LifecycleEvent): LifecycleState {
  const events = [...state.events, e];
  let stats = state.stats;
  if (e.kind === "action.ok") stats = { ...stats, okCount: stats.okCount + 1 };
  else if (e.kind === "action.skip") stats = { ...stats, skipCount: stats.skipCount + 1 };
  else if (e.kind === "action.fail") stats = { ...stats, failCount: stats.failCount + 1 };

  switch (e.kind) {
    case "phase.start": {
      return {
        ...state,
        events,
        stats,
        currentPhase: {
          name: e.phase,
          label: e.label,
          startedAt: e.at,
          done: false,
        },
      };
    }
    case "phase.end": {
      return {
        ...state,
        events,
        stats,
        currentPhase:
          state.currentPhase?.name === e.phase
            ? { ...state.currentPhase, done: true }
            : state.currentPhase,
      };
    }
    case "member.joined": {
      const members = state.members.map((m) =>
        m.slotIndex === e.slotIndex
          ? {
              ...m,
              name: e.actor,
              reputationLevel: e.reputationLevel,
              stakeDeposited: e.stakeDeposited,
              status: "current" as MemberUiStatus,
            }
          : m,
      );
      return {
        ...state,
        events,
        stats,
        members,
        pool: { ...state.pool, status: "Active" },
      };
    }
    case "member.contributed": {
      const members: MemberUi[] = state.members.map((m) =>
        m.slotIndex === e.slotIndex
          ? {
              ...m,
              contributionsPaid: m.contributionsPaid + 1,
              totalContributed: m.totalContributed + e.amount,
              status: (m.status === "paid_out" ? "paid_out" : "current") as MemberUiStatus,
            }
          : m,
      );
      return { ...state, events, stats, members };
    }
    case "member.missed": {
      const members = state.members.map((m) =>
        m.slotIndex === e.slotIndex ? { ...m, status: "late" as MemberUiStatus } : m,
      );
      return { ...state, events, stats, members };
    }
    case "payout.executed": {
      const members = state.members.map((m) =>
        m.slotIndex === e.slotIndex
          ? {
              ...m,
              totalReceived: m.totalReceived + e.amount,
              status: "paid_out" as MemberUiStatus,
            }
          : m,
      );
      return {
        ...state,
        events,
        stats,
        members,
        pool: { ...state.pool, totalPaidOut: state.pool.totalPaidOut + e.amount },
      };
    }
    case "pool.snapshot": {
      const pool: PoolUi = {
        ...state.pool,
        currentCycle: e.cycle,
        totalContributed: e.totalContributed,
        totalPaidOut: e.totalPaidOut,
        solidarityBalance: e.solidarityBalance,
        escrowBalance: e.escrowBalance,
        defaultedMembers: e.defaultedMembers,
        poolUsdcVaultBalance: e.poolUsdcVaultBalance,
        status:
          e.status === "Forming" ||
          e.status === "Active" ||
          e.status === "Completed" ||
          e.status === "Liquidated"
            ? e.status
            : state.pool.status,
      };
      return { ...state, events, stats, pool };
    }
    case "summary": {
      return {
        ...state,
        events,
        stats,
        summary: e,
        finished: true,
        running: false,
      };
    }
    case "action.ok":
    case "action.skip":
    case "action.fail":
      return { ...state, events, stats };
  }
}

function reducer(state: LifecycleState, action: LifecycleAction): LifecycleState {
  switch (action.type) {
    case "reset":
      return {
        ...INITIAL_STATE,
        pool: {
          ...INITIAL_POOL,
          status: "forming",
          totalCycles: action.cyclesTotal,
          installmentAmount: action.installment,
          creditAmount: action.credit,
        },
        members: action.memberNames.map<MemberUi>((name, i) => ({
          name,
          slotIndex: i,
          reputationLevel: 1,
          stakeDeposited: 0n,
          contributionsPaid: 0,
          totalContributed: 0n,
          totalReceived: 0n,
          status: "pending",
        })),
      };
    case "start":
      return { ...state, running: true, finished: false };
    case "event":
      return applyEvent(state, action.event);
    case "finish":
      return { ...state, running: false, finished: true };
  }
}

export function useLifecycleState(): [LifecycleState, React.Dispatch<LifecycleAction>] {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  return [state, dispatch];
}
