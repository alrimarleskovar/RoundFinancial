"use client";

import { useReducer, useCallback, type Dispatch } from "react";

// Demo Studio state — fully isolated from the production session
// store. Powers /admin: lets the team configure a Maria-style
// scenario, advance through months, and trigger every dramatic
// action (contemplation, default, escape valve, yield) for video
// recording without polluting the regular /home flow.

export interface DemoUser {
  name: string;
  avatar: string; // initials (auto-derived if blank)
  level: 1 | 2 | 3;
  score: number;
  balance: number; // BRL
  yield: number; // BRL
}

export interface DemoGroup {
  carta: number; // credit letter face value (BRL)
  months: number; // total cycle length
  installment: number; // BRL/month — derived but editable
  contemplationMonth: number; // 1..months (when this user wins the prize)
  members: number;
  yieldApy: number; // % APY for ambient Kamino accrual
}

export type DemoEventKind =
  | "setup"
  | "monthAdvance"
  | "installment"
  | "contemplated"
  | "default"
  | "sale"
  | "yieldHarvest";

export interface DemoEvent {
  id: string;
  kind: DemoEventKind;
  ts: number; // ms
  label: string; // pre-formatted for the activity log
  amount: number; // BRL; positive = inflow, negative = outflow
}

export interface DemoState {
  user: DemoUser;
  group: DemoGroup;
  currentMonth: number; // 0 = pre-cycle; 1..months = cycle months
  contemplated: boolean;
  defaulted: boolean;
  exitedViaValve: boolean;
  monthsPaid: number; // count of installments paid this cycle
  events: DemoEvent[];
}

// Default scenario the boss spec'd: Maria, carta 10k, 12 months,
// contemplation in month 4, score 612 (Veterano-bound).
export const DEFAULT_DEMO_STATE: DemoState = {
  user: {
    name: "Maria Luísa",
    avatar: "ML",
    level: 2,
    score: 612,
    balance: 8420,
    yield: 0,
  },
  group: {
    carta: 10000,
    months: 12,
    installment: 833, // 10000/12 ≈ 833
    contemplationMonth: 4,
    members: 12,
    yieldApy: 6.8,
  },
  currentMonth: 0,
  contemplated: false,
  defaulted: false,
  exitedViaValve: false,
  monthsPaid: 0,
  events: [],
};

type Action =
  | { type: "SET_USER"; patch: Partial<DemoUser> }
  | { type: "SET_GROUP"; patch: Partial<DemoGroup> }
  | { type: "ADVANCE_MONTH" }
  | { type: "REWIND_MONTH" }
  | { type: "JUMP_TO_CONTEMPLATION" }
  | { type: "PAY_INSTALLMENT" }
  | { type: "CONTEMPLATE" }
  | { type: "DEFAULT" }
  | { type: "ESCAPE_VALVE" }
  | { type: "HARVEST_YIELD" }
  | { type: "RESET" }
  | { type: "LOAD_PRESET"; presetId: DemoPresetId };

// ── Presets ───────────────────────────────────────────────
// Pre-configured scenarios the boss can drop into the studio
// with one click. Each one sets up the user + group + cycle
// state so the demo starts from a meaningful moment.

export type DemoPresetId =
  | "default"
  | "mariaContemplated"
  | "mariaMidCycle"
  | "tripleDefault"
  | "escapeValve"
  | "veteranBig";

export interface DemoPreset {
  id: DemoPresetId;
  /** i18n key for the visible label. */
  labelKey: string;
  /** i18n key for the one-line description. */
  descriptionKey: string;
  /** Tone for the chip (token name). */
  tone: "green" | "teal" | "amber" | "red" | "purple";
  /** Initial state — merged on top of DEFAULT_DEMO_STATE. */
  state: Omit<DemoState, "events">;
}

export const DEMO_PRESETS: DemoPreset[] = [
  {
    id: "default",
    labelKey: "admin.preset.default.label",
    descriptionKey: "admin.preset.default.desc",
    tone: "teal",
    state: { ...DEFAULT_DEMO_STATE },
  },
  {
    id: "mariaContemplated",
    labelKey: "admin.preset.mariaContemplated.label",
    descriptionKey: "admin.preset.mariaContemplated.desc",
    tone: "green",
    state: {
      user: {
        name: "Maria Luísa",
        avatar: "ML",
        level: 2,
        score: 624,
        balance: 8420 + Math.round(10000 * 0.35) - 833 * 4,
        yield: 12.45,
      },
      group: {
        carta: 10000,
        months: 12,
        installment: 833,
        contemplationMonth: 4,
        members: 12,
        yieldApy: 6.8,
      },
      currentMonth: 4,
      contemplated: true,
      defaulted: false,
      exitedViaValve: false,
      monthsPaid: 4,
    },
  },
  {
    id: "mariaMidCycle",
    labelKey: "admin.preset.mariaMidCycle.label",
    descriptionKey: "admin.preset.mariaMidCycle.desc",
    tone: "purple",
    state: {
      user: {
        name: "Maria Luísa",
        avatar: "ML",
        level: 2,
        score: 678,
        balance: 8420 + Math.round(10000 * 0.35) - 833 * 8,
        yield: 38.2,
      },
      group: {
        carta: 10000,
        months: 12,
        installment: 833,
        contemplationMonth: 4,
        members: 12,
        yieldApy: 6.8,
      },
      currentMonth: 8,
      contemplated: true,
      defaulted: false,
      exitedViaValve: false,
      monthsPaid: 8,
    },
  },
  {
    id: "tripleDefault",
    labelKey: "admin.preset.tripleDefault.label",
    descriptionKey: "admin.preset.tripleDefault.desc",
    tone: "red",
    state: {
      user: {
        name: "Pedro Souza",
        avatar: "PS",
        level: 3,
        score: 720,
        balance: 24000,
        yield: 0,
      },
      group: {
        carta: 30000,
        months: 24,
        installment: 1250,
        contemplationMonth: 6,
        members: 24,
        yieldApy: 6.8,
      },
      currentMonth: 6,
      contemplated: true,
      defaulted: false,
      exitedViaValve: false,
      monthsPaid: 6,
    },
  },
  {
    id: "escapeValve",
    labelKey: "admin.preset.escapeValve.label",
    descriptionKey: "admin.preset.escapeValve.desc",
    tone: "amber",
    state: {
      user: {
        name: "João Andrade",
        avatar: "JA",
        level: 2,
        score: 540,
        balance: 4200,
        yield: 0,
      },
      group: {
        carta: 5000,
        months: 12,
        installment: 416,
        contemplationMonth: 6,
        members: 12,
        yieldApy: 6.8,
      },
      currentMonth: 8,
      contemplated: true,
      defaulted: false,
      exitedViaValve: false,
      monthsPaid: 7,
    },
  },
  {
    id: "veteranBig",
    labelKey: "admin.preset.veteranBig.label",
    descriptionKey: "admin.preset.veteranBig.desc",
    tone: "purple",
    state: {
      user: {
        name: "Carlos Rocha",
        avatar: "CR",
        level: 3,
        score: 850,
        balance: 42000,
        yield: 0,
      },
      group: {
        carta: 50000,
        months: 36,
        installment: 1389,
        contemplationMonth: 12,
        members: 36,
        yieldApy: 6.8,
      },
      currentMonth: 0,
      contemplated: false,
      defaulted: false,
      exitedViaValve: false,
      monthsPaid: 0,
    },
  },
];

function makeId(): string {
  return `de_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function pushEvent(
  state: DemoState,
  kind: DemoEventKind,
  label: string,
  amount: number,
): DemoEvent[] {
  return [{ id: makeId(), kind, ts: Date.now(), label, amount }, ...state.events];
}

function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case "SET_USER":
      return { ...state, user: { ...state.user, ...action.patch } };

    case "SET_GROUP": {
      const next = { ...state.group, ...action.patch };
      // Auto-recalc installment if carta or months changed and the
      // user didn't set installment explicitly in the same patch.
      if (
        ("carta" in action.patch || "months" in action.patch) &&
        !("installment" in action.patch)
      ) {
        next.installment = Math.round(next.carta / Math.max(1, next.months));
      }
      return { ...state, group: next };
    }

    case "ADVANCE_MONTH": {
      const next = Math.min(state.group.months, state.currentMonth + 1);
      const events = pushEvent(state, "monthAdvance", `Mês ${next}/${state.group.months}`, 0);
      // Ambient yield on group float: ~apy/12 of carta * monthsPaid
      const yieldGain =
        (state.group.yieldApy / 100 / 12) *
        state.group.carta *
        Math.max(0.1, state.monthsPaid / state.group.members);
      const yieldDelta = +yieldGain.toFixed(2);
      // Auto-contemplate on the configured month if not yet
      let contemplated = state.contemplated;
      let balance = state.user.balance;
      let extraEvents = events;
      if (!contemplated && next === state.group.contemplationMonth) {
        contemplated = true;
        // Adaptive Escrow: 35% upfront, 65% locked (released as
        // the user pays remaining installments). For demo clarity
        // we credit the 35% upfront slice to balance now.
        const upfront = Math.round(state.group.carta * 0.35);
        balance += upfront;
        extraEvents = pushEvent(
          { ...state, events },
          "contemplated",
          `Contemplação · ${state.user.name} recebe 35% (${upfront})`,
          upfront,
        );
      }
      return {
        ...state,
        currentMonth: next,
        contemplated,
        user: {
          ...state.user,
          balance,
          yield: state.user.yield + yieldDelta,
        },
        events: extraEvents,
      };
    }

    case "REWIND_MONTH":
      return {
        ...state,
        currentMonth: Math.max(0, state.currentMonth - 1),
      };

    case "JUMP_TO_CONTEMPLATION": {
      // Walk forward month-by-month until contemplation, accumulating
      // events naturally. Keeps the activity log honest for video.
      let cur: DemoState = state;
      while (!cur.contemplated && cur.currentMonth < cur.group.contemplationMonth) {
        cur = reducer(cur, { type: "ADVANCE_MONTH" });
      }
      return cur;
    }

    case "PAY_INSTALLMENT": {
      const amount = state.group.installment;
      return {
        ...state,
        user: {
          ...state.user,
          balance: state.user.balance - amount,
          score: state.user.score + 6, // SAS +6 per on-time payment
        },
        monthsPaid: state.monthsPaid + 1,
        events: pushEvent(
          state,
          "installment",
          `Parcela paga · mês ${state.currentMonth || 1}/${state.group.months}`,
          -amount,
        ),
      };
    }

    case "CONTEMPLATE": {
      if (state.contemplated) return state;
      const upfront = Math.round(state.group.carta * 0.35);
      return {
        ...state,
        contemplated: true,
        user: { ...state.user, balance: state.user.balance + upfront },
        events: pushEvent(
          state,
          "contemplated",
          `Contemplação manual · upfront ${upfront}`,
          upfront,
        ),
      };
    }

    case "DEFAULT": {
      // Slashing: stake (10% of carta for veterano) is seized; SAS
      // score plummets; user is flagged as defaulter.
      const stake = Math.round(state.group.carta * 0.1);
      return {
        ...state,
        defaulted: true,
        user: {
          ...state.user,
          balance: state.user.balance - stake,
          score: Math.max(0, state.user.score - 120),
        },
        events: pushEvent(
          state,
          "default",
          `CALOTE · stake ${stake} confiscado, score -120`,
          -stake,
        ),
      };
    }

    case "ESCAPE_VALVE": {
      // User exits before defaulting: sells the position at 88%
      // face value via secondary market. Score preserved.
      const ask = Math.round(state.group.carta * 0.88);
      return {
        ...state,
        exitedViaValve: true,
        user: { ...state.user, balance: state.user.balance + ask },
        events: pushEvent(state, "sale", `Válvula de Escape · cota vendida por ${ask} (-12%)`, ask),
      };
    }

    case "HARVEST_YIELD": {
      const amount = state.user.yield;
      if (amount <= 0) return state;
      return {
        ...state,
        user: {
          ...state.user,
          balance: state.user.balance + amount,
          yield: 0,
        },
        events: pushEvent(
          state,
          "yieldHarvest",
          `Yield Kamino sacado · ${amount.toFixed(2)}`,
          amount,
        ),
      };
    }

    case "RESET":
      return DEFAULT_DEMO_STATE;

    case "LOAD_PRESET": {
      const preset = DEMO_PRESETS.find((p) => p.id === action.presetId);
      if (!preset) return state;
      // Fresh events log on preset load — keeps the activity panel
      // honest. The preset's starting label hits as the first row.
      return {
        ...preset.state,
        events: [
          {
            id: makeId(),
            kind: "setup",
            ts: Date.now(),
            label: `Preset carregado · ${preset.id}`,
            amount: 0,
          },
        ],
      };
    }
  }
}

export interface DemoController {
  state: DemoState;
  dispatch: Dispatch<Action>;
  setUser: (patch: Partial<DemoUser>) => void;
  setGroup: (patch: Partial<DemoGroup>) => void;
  advanceMonth: () => void;
  rewindMonth: () => void;
  jumpToContemplation: () => void;
  payInstallment: () => void;
  contemplate: () => void;
  triggerDefault: () => void;
  escapeValve: () => void;
  harvestYield: () => void;
  reset: () => void;
  loadPreset: (id: DemoPresetId) => void;
}

export function useDemoState(): DemoController {
  const [state, dispatch] = useReducer(reducer, DEFAULT_DEMO_STATE);
  return {
    state,
    dispatch,
    setUser: useCallback((patch) => dispatch({ type: "SET_USER", patch }), []),
    setGroup: useCallback((patch) => dispatch({ type: "SET_GROUP", patch }), []),
    advanceMonth: useCallback(() => dispatch({ type: "ADVANCE_MONTH" }), []),
    rewindMonth: useCallback(() => dispatch({ type: "REWIND_MONTH" }), []),
    jumpToContemplation: useCallback(() => dispatch({ type: "JUMP_TO_CONTEMPLATION" }), []),
    payInstallment: useCallback(() => dispatch({ type: "PAY_INSTALLMENT" }), []),
    contemplate: useCallback(() => dispatch({ type: "CONTEMPLATE" }), []),
    triggerDefault: useCallback(() => dispatch({ type: "DEFAULT" }), []),
    escapeValve: useCallback(() => dispatch({ type: "ESCAPE_VALVE" }), []),
    harvestYield: useCallback(() => dispatch({ type: "HARVEST_YIELD" }), []),
    reset: useCallback(() => dispatch({ type: "RESET" }), []),
    loadPreset: useCallback(
      (id: DemoPresetId) => dispatch({ type: "LOAD_PRESET", presetId: id }),
      [],
    ),
  };
}
