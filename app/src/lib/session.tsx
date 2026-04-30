"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { USER as USER_INITIAL, type User, type NftPosition } from "@/data/carteira";
import type { ActiveGroup } from "@/data/groups";
import type { CatalogGroup } from "@/lib/groups";

// In-memory session orchestrator. Mutates user-level state in
// response to dashboard actions (pay installment, join group,
// sell share) and emits a stream of events the Activity feed
// renders as a terminal log.
//
// Replaces static USER fixture reads with useSession().user so
// numbers change live when modals submit. Hooks into the same
// data shape as data/carteira.ts so swapping fixtures for an
// on-chain indexer later is a single-file change.

export type SessionEventKind =
  | "payment"
  | "yield"
  | "sale"
  | "purchase"
  | "attestation"
  | "join";

export interface SessionEvent {
  id: string;
  kind: SessionEventKind;
  ts: number;        // unix ms
  txid: string;      // synthesized e.g. "tx_4xR9…k9Fn"
  op: string;        // "payment.send" / "yield.claim" / "secondary.market"
  amountBrl: number; // 0 for non-money events
  target: string;    // "escrow.usdc" / "kamino.vault" / "@petrus" / "civic.pass"
  attestPts?: number; // only present for kind === "attestation"
}

export interface SessionState {
  user: User;
  events: SessionEvent[];
  /** Offer ids the user has bought on the secondary market in this
   *  session. OffersTable filters by this to mark rows as purchased. */
  purchasedOfferIds: string[];
}

type Action =
  | { type: "PAY_INSTALLMENT"; group: ActiveGroup }
  | { type: "JOIN_GROUP"; group: CatalogGroup }
  | { type: "SELL_SHARE"; position: NftPosition; askPrice: number; discountPct: number }
  | { type: "BUY_SHARE"; offerId: string; group: string; price: number; face: number }
  | { type: "YIELD_TICK"; amount: number; source: string }
  | { type: "PUSH_EVENT"; event: SessionEvent };

// ── Helpers ────────────────────────────────────────────────
function makeTxid(): string {
  // Looks roughly like a Solana base58 prefix/suffix
  const alpha = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNPQRSTUVWXYZ123456789";
  const pick = (n: number) =>
    Array.from({ length: n }, () => alpha[Math.floor(Math.random() * alpha.length)]).join("");
  return `tx_${pick(4)}…${pick(4)}`;
}

function makeId(): string {
  return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const INITIAL_EVENTS: SessionEvent[] = [
  { id: "e0a", kind: "payment",     ts: Date.now() - 18 * 60 * 60 * 1000, txid: "tx_4xR9…k9Fn", op: "payment.send",     amountBrl: -892.4, target: "escrow.usdc" },
  { id: "e0b", kind: "yield",       ts: Date.now() - 60 * 60 * 60 * 1000, txid: "tx_8mP2…aQ7L", op: "yield.claim",      amountBrl: +52.3,  target: "kamino.vault" },
  { id: "e0c", kind: "sale",        ts: Date.now() - 5 * 24 * 60 * 60 * 1000, txid: "tx_2vK7…hN4T", op: "secondary.market", amountBrl: +1890,  target: "@petrus" },
  { id: "e0d", kind: "attestation", ts: Date.now() - 6 * 24 * 60 * 60 * 1000, txid: "tx_6wB3…pX1Z", op: "sas.attestation", amountBrl: 0,      target: "civic.pass", attestPts: 18 },
];

const INITIAL_STATE: SessionState = {
  user: { ...USER_INITIAL },
  events: INITIAL_EVENTS,
  purchasedOfferIds: [],
};

function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case "PAY_INSTALLMENT": {
      const amount = action.group.installment;
      const ev: SessionEvent = {
        id: makeId(),
        kind: "payment",
        ts: Date.now(),
        txid: makeTxid(),
        op: "payment.send",
        amountBrl: -amount,
        target: "escrow.usdc",
      };
      // Each installment also mints a SAS attestation worth +6 pts
      const att: SessionEvent = {
        id: makeId(),
        kind: "attestation",
        ts: Date.now() + 1,
        txid: makeTxid(),
        op: "sas.attestation",
        amountBrl: 0,
        target: "civic.pass",
        attestPts: 6,
      };
      return {
        ...state,
        user: {
          ...state.user,
          balance: state.user.balance - amount,
          score: state.user.score + 6,
          scoreDelta: state.user.scoreDelta + 6,
        },
        events: [att, ev, ...state.events],
      };
    }
    case "JOIN_GROUP": {
      // 1.5% protocol fee on the first installment
      const fee = action.group.installment * 0.015;
      const ev: SessionEvent = {
        id: makeId(),
        kind: "join",
        ts: Date.now(),
        txid: makeTxid(),
        op: "pool.join",
        amountBrl: -fee,
        target: action.group.name,
      };
      return {
        ...state,
        user: { ...state.user, balance: state.user.balance - fee },
        events: [ev, ...state.events],
      };
    }
    case "SELL_SHARE": {
      const ev: SessionEvent = {
        id: makeId(),
        kind: "sale",
        ts: Date.now(),
        txid: makeTxid(),
        op: "secondary.market",
        amountBrl: action.askPrice,
        target: `share_${action.position.num}`,
      };
      return {
        ...state,
        user: { ...state.user, balance: state.user.balance + action.askPrice },
        events: [ev, ...state.events],
      };
    }
    case "BUY_SHARE": {
      // Buying a quota on the secondary market: balance drops by
      // ask price, an event hits the ledger, and the offer id is
      // tracked so the OffersTable can mark the row as purchased.
      const ev: SessionEvent = {
        id: makeId(),
        kind: "purchase",
        ts: Date.now(),
        txid: makeTxid(),
        op: "secondary.market",
        amountBrl: -action.price,
        target: action.group,
      };
      return {
        ...state,
        user: { ...state.user, balance: state.user.balance - action.price },
        events: [ev, ...state.events],
        purchasedOfferIds: [...state.purchasedOfferIds, action.offerId],
      };
    }
    case "YIELD_TICK": {
      const ev: SessionEvent = {
        id: makeId(),
        kind: "yield",
        ts: Date.now(),
        txid: makeTxid(),
        op: "yield.claim",
        amountBrl: action.amount,
        target: action.source,
      };
      return {
        ...state,
        user: {
          ...state.user,
          balance: state.user.balance + action.amount,
          yield: state.user.yield + action.amount,
        },
        events: [ev, ...state.events],
      };
    }
    case "PUSH_EVENT":
      return { ...state, events: [action.event, ...state.events] };
    default:
      return state;
  }
}

// ── Context ────────────────────────────────────────────────
interface SessionContextValue {
  user: User;
  events: SessionEvent[];
  purchasedOfferIds: string[];
  payInstallment: (group: ActiveGroup) => void;
  joinGroup: (group: CatalogGroup) => void;
  sellShare: (
    position: NftPosition,
    askPrice: number,
    discountPct: number,
  ) => void;
  buyShare: (offerId: string, group: string, price: number, face: number) => void;
  pushYield: (amount: number, source?: string) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  children,
  yieldTickMs = 35_000,
}: {
  children: ReactNode;
  yieldTickMs?: number;
}) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // Ambient yield ticker: every yieldTickMs, credit a small random
  // amount so the dashboard feels alive. Disabled by passing 0 or a
  // negative value.
  const tickRef = useRef<number | null>(null);
  useEffect(() => {
    if (yieldTickMs <= 0) return;
    tickRef.current = window.setInterval(() => {
      const amount = +(0.4 + Math.random() * 1.2).toFixed(2); // R$ 0.40-1.60
      dispatch({ type: "YIELD_TICK", amount, source: "kamino.vault" });
    }, yieldTickMs);
    return () => {
      if (tickRef.current != null) window.clearInterval(tickRef.current);
    };
  }, [yieldTickMs]);

  const payInstallment = useCallback(
    (group: ActiveGroup) => dispatch({ type: "PAY_INSTALLMENT", group }),
    [],
  );
  const joinGroup = useCallback(
    (group: CatalogGroup) => dispatch({ type: "JOIN_GROUP", group }),
    [],
  );
  const sellShare = useCallback(
    (position: NftPosition, askPrice: number, discountPct: number) =>
      dispatch({ type: "SELL_SHARE", position, askPrice, discountPct }),
    [],
  );
  const buyShare = useCallback(
    (offerId: string, group: string, price: number, face: number) =>
      dispatch({ type: "BUY_SHARE", offerId, group, price, face }),
    [],
  );
  const pushYield = useCallback(
    (amount: number, source: string = "kamino.vault") =>
      dispatch({ type: "YIELD_TICK", amount, source }),
    [],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      user: state.user,
      events: state.events,
      purchasedOfferIds: state.purchasedOfferIds,
      payInstallment,
      joinGroup,
      sellShare,
      buyShare,
      pushYield,
    }),
    [state, payInstallment, joinGroup, sellShare, buyShare, pushYield],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession() must be used within <SessionProvider>");
  return v;
}
