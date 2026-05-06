"use client";

import { toast } from "sonner";
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

import { USER as USER_INITIAL, type User, type NftPosition, type Tone } from "@/data/carteira";
import type { ActiveGroup } from "@/data/groups";
import type { CatalogGroup } from "@/lib/groups";

// ActiveGroup is re-exported so the AdminClient can import it without
// reaching into @/data/groups directly.
export type { ActiveGroup } from "@/data/groups";

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
  | "join"
  | "levelup";

export interface SessionEvent {
  id: string;
  kind: SessionEventKind;
  ts: number; // unix ms
  txid: string; // synthesized e.g. "tx_4xR9…k9Fn"
  op: string; // "payment.send" / "yield.claim" / "secondary.market"
  amountBrl: number; // 0 for non-money events
  target: string; // "escrow.usdc" / "kamino.vault" / "@petrus" / "civic.pass"
  attestPts?: number; // only present for kind === "attestation"
}

export interface SessionState {
  user: User;
  events: SessionEvent[];
  /** Offer ids the user has bought on the secondary market in this
   *  session. OffersTable filters by this to mark rows as purchased. */
  purchasedOfferIds: string[];
  /** NFT positions the user has acquired through the secondary market
   *  in this session. Synthesized from the BuyOfferTarget at purchase
   *  time so /carteira's PositionsList can show them alongside the
   *  static fixture without a separate fetch. */
  acquiredPositions: NftPosition[];
  /** Group names the user has joined (via either the join flow OR a
   *  secondary-market purchase in /mercado). GroupCard overlays this
   *  onto its static `g.joined` flag so the catalog reflects state
   *  across tabs. Indexed by name since both flows share that key. */
  joinedGroupNames: string[];
  /** Extra months paid this session, keyed by group name. FeaturedGroup
   *  + GroupRow overlay this onto the static fixture so the dial advances
   *  when the user pays an installment (capped at the group's total). */
  monthsPaidByGroup: Record<string, number>;
  /** When the admin Demo Studio applies a preset to the live session,
   *  it ships a synthetic ActiveGroup (carta + months + currentMonth +
   *  contemplated state). FeaturedGroup checks this first and falls back
   *  to ACTIVE_GROUPS[0] when null. Cleared by reset() / next preset. */
  demoGroup: ActiveGroup | null;
  /** Active escape-valve listings the user has put up on /mercado.
   *  Single source of truth: SellShareModal (/carteira) + SellPositionModal
   *  (/mercado) both write here, and SellPositionsList + PositionsList
   *  both read it. Persists across navigations within a session. */
  listings: ActiveListing[];
}

/** Mirrors `ActiveListing` in components/mercado/ListingDetailsModal.
 *  Owned here now so both modals + both list views share one source. */
export interface ActiveListing {
  id: string;
  position: NftPosition;
  askPrice: number;
  discountPct: number;
  listedAt: number;
  expiresAt: number;
}

const SLASHING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// SAS reputation tiers. Score thresholds match the demo fixtures —
// lvl 2 is "Comprovado" at 500+, lvl 3 is "Veterano" at 750+. Each
// tier also drives the collateral % + leverage multiplier shown on
// the home KPI ("seu colat. ativo · 3.3x leverage"); the LEVELS data
// fixture mirrors these for the /reputacao ladder copy.
const LEVEL_TABLE: ReadonlyArray<{
  min: number;
  level: 1 | 2 | 3;
  label: string;
  next: number;
  colat: number;
  lev: number;
}> = [
  { min: 0, level: 1, label: "Iniciante", next: 500, colat: 50, lev: 2 },
  { min: 500, level: 2, label: "Comprovado", next: 750, colat: 30, lev: 3.3 },
  { min: 750, level: 3, label: "Veterano", next: 999, colat: 10, lev: 10 },
];

function computeLevel(score: number): {
  level: 1 | 2 | 3;
  label: string;
  next: number;
  colat: number;
  lev: number;
} {
  // Walk the table top-down so the highest-qualifying tier wins.
  for (let i = LEVEL_TABLE.length - 1; i >= 0; i--) {
    const tier = LEVEL_TABLE[i]!;
    if (score >= tier.min)
      return {
        level: tier.level,
        label: tier.label,
        next: tier.next,
        colat: tier.colat,
        lev: tier.lev,
      };
  }
  const fallback = LEVEL_TABLE[0]!;
  return {
    level: fallback.level,
    label: fallback.label,
    next: fallback.next,
    colat: fallback.colat,
    lev: fallback.lev,
  };
}

type Action =
  | { type: "PAY_INSTALLMENT"; group: ActiveGroup }
  | { type: "JOIN_GROUP"; group: CatalogGroup }
  | { type: "SELL_SHARE"; position: NftPosition; askPrice: number; discountPct: number }
  | { type: "CANCEL_LISTING"; listingId: string }
  | {
      type: "BUY_SHARE";
      offerId: string;
      group: string;
      price: number;
      face: number;
      /** Optional NFT-position metadata so /carteira can render the
       *  bought cota natively. Comes from the underlying MarketOffer
       *  via BuyOfferTarget (OffersTable enriches it). FeaturedOffer
       *  may omit some fields — the reducer falls back to defaults. */
      num?: string;
      month?: number;
      total?: number;
      tone?: Tone;
    }
  | { type: "YIELD_TICK"; amount: number; source: string }
  | { type: "HARVEST_YIELD" }
  | { type: "PUSH_EVENT"; event: SessionEvent }
  | {
      type: "LOAD_FROM_DEMO";
      userPatch: Partial<User>;
      groupName?: string;
      demoGroup?: ActiveGroup;
      tag: string;
    };

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
  {
    id: "e0a",
    kind: "payment",
    ts: Date.now() - 18 * 60 * 60 * 1000,
    txid: "tx_4xR9…k9Fn",
    op: "payment.send",
    amountBrl: -892.4,
    target: "escrow.usdc",
  },
  {
    id: "e0b",
    kind: "yield",
    ts: Date.now() - 60 * 60 * 60 * 1000,
    txid: "tx_8mP2…aQ7L",
    op: "yield.claim",
    amountBrl: +52.3,
    target: "kamino.vault",
  },
  {
    id: "e0c",
    kind: "sale",
    ts: Date.now() - 5 * 24 * 60 * 60 * 1000,
    txid: "tx_2vK7…hN4T",
    op: "secondary.market",
    amountBrl: +1890,
    target: "@petrus",
  },
  {
    id: "e0d",
    kind: "attestation",
    ts: Date.now() - 6 * 24 * 60 * 60 * 1000,
    txid: "tx_6wB3…pX1Z",
    op: "sas.attestation",
    amountBrl: 0,
    target: "civic.pass",
    attestPts: 18,
  },
];

const INITIAL_STATE: SessionState = {
  user: { ...USER_INITIAL },
  events: INITIAL_EVENTS,
  purchasedOfferIds: [],
  acquiredPositions: [],
  joinedGroupNames: [],
  monthsPaidByGroup: {},
  demoGroup: null,
  listings: [],
};

function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case "PAY_INSTALLMENT": {
      const amount = action.group.installment;
      // Defensive guards — the modal already disables submit in both
      // cases, but we no-op here too so the reducer can be trusted from
      // any future caller (admin tools, scripted demo flows, etc.).
      const prevPaid = state.monthsPaidByGroup[action.group.name] ?? 0;
      const cycleMaxPaid = Math.max(0, action.group.total - action.group.month);
      if (prevPaid >= cycleMaxPaid) return state; // cycle already fully funded
      if (state.user.balance < amount) return state; // would go negative

      const newScore = state.user.score + 6;
      const tier = computeLevel(newScore);
      const leveledUp = tier.level > state.user.level;

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

      // Levelup event sits at the head of the feed when the score
      // crosses a threshold so the toast useEffect picks it up first.
      const events: SessionEvent[] = leveledUp
        ? [
            {
              id: makeId(),
              kind: "levelup",
              ts: Date.now() + 2,
              txid: makeTxid(),
              op: "sas.levelup",
              amountBrl: 0,
              target: tier.label,
            },
            att,
            ev,
            ...state.events,
          ]
        : [att, ev, ...state.events];

      return {
        ...state,
        user: {
          ...state.user,
          balance: state.user.balance - amount,
          score: newScore,
          scoreDelta: state.user.scoreDelta + 6,
          level: tier.level,
          levelLabel: tier.label,
          nextLevel: tier.next,
          colateralPct: tier.colat,
          leverageX: tier.lev,
        },
        events,
        monthsPaidByGroup: {
          ...state.monthsPaidByGroup,
          [action.group.name]: prevPaid + 1,
        },
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
        joinedGroupNames: state.joinedGroupNames.includes(action.group.name)
          ? state.joinedGroupNames
          : [...state.joinedGroupNames, action.group.name],
      };
    }
    case "SELL_SHARE": {
      // Listing a share on the secondary market is NOT an instant sale —
      // the seller's balance only moves when a buyer actually takes the
      // listing (handled by BUY_SHARE on the buyer side). Idempotent on
      // position id: re-listing the same NFT replaces the prior listing.
      const now = Date.now();
      const listing: ActiveListing = {
        id: `l-${now}-${action.position.id}`,
        position: action.position,
        askPrice: action.askPrice,
        discountPct: action.discountPct,
        listedAt: now,
        expiresAt: now + SLASHING_WINDOW_MS,
      };
      const ev: SessionEvent = {
        id: makeId(),
        kind: "sale",
        ts: now,
        txid: makeTxid(),
        op: "secondary.market",
        amountBrl: action.askPrice,
        target: `share_${action.position.num}`,
      };
      return {
        ...state,
        events: [ev, ...state.events],
        listings: [...state.listings.filter((l) => l.position.id !== action.position.id), listing],
      };
    }
    case "CANCEL_LISTING": {
      // No event emitted — cancellation is a local UX action with no
      // economic side-effect. Just removes the listing.
      return {
        ...state,
        listings: state.listings.filter((l) => l.id !== action.listingId),
      };
    }
    case "BUY_SHARE": {
      // Buying a quota on the secondary market: balance drops by
      // ask price, an event hits the ledger, the offer id is tracked
      // so OffersTable can mark the row as purchased, AND a synthetic
      // NftPosition is appended to acquiredPositions so /carteira's
      // PositionsList shows the new cota alongside fixture positions.
      const ev: SessionEvent = {
        id: makeId(),
        kind: "purchase",
        ts: Date.now(),
        txid: makeTxid(),
        op: "secondary.market",
        amountBrl: -action.price,
        target: action.group,
      };
      // Buying a share on the mercado also enrols the user in the
      // origin group — match by name so the catalog reflects it.
      const groupName = action.group.split(" · ")[0] ?? action.group;
      // Synthesize an NftPosition. Falls back to safe defaults when the
      // caller (e.g. FeaturedOffer) doesn't have the full breakdown.
      const acquired: NftPosition = {
        id: action.offerId,
        num: action.num ?? "??",
        group: action.group,
        tone: action.tone ?? "t",
        month: action.month ?? 1,
        total: action.total ?? 12,
        exp: "—",
        value: action.face,
        yieldPct:
          action.face > 0 ? +(((action.face - action.price) / action.price) * 100).toFixed(1) : 0,
      };
      return {
        ...state,
        user: { ...state.user, balance: state.user.balance - action.price },
        events: [ev, ...state.events],
        purchasedOfferIds: [...state.purchasedOfferIds, action.offerId],
        acquiredPositions: state.acquiredPositions.some((p) => p.id === acquired.id)
          ? state.acquiredPositions
          : [...state.acquiredPositions, acquired],
        joinedGroupNames: state.joinedGroupNames.includes(groupName)
          ? state.joinedGroupNames
          : [...state.joinedGroupNames, groupName],
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
    case "LOAD_FROM_DEMO": {
      // Demo Studio → real session bridge. Overlays user fields the
      // boss configured in /admin onto the production session and
      // (optionally) marks a group as joined so /grupos reflects it.
      // Pushes a single "synced from demo" event so the activity log
      // shows the boundary.
      const ev: SessionEvent = {
        id: makeId(),
        kind: "join",
        ts: Date.now(),
        txid: makeTxid(),
        op: "demo.sync",
        amountBrl: 0,
        target: action.tag,
      };
      const joinedAdd =
        action.groupName && !state.joinedGroupNames.includes(action.groupName)
          ? [...state.joinedGroupNames, action.groupName]
          : state.joinedGroupNames;
      // Always derive level/levelLabel/nextLevel from the patched score
      // — that's the source of truth. Admin-side level chips are UI
      // hints; the threshold table makes (score, level) consistent.
      const patchedUser = { ...state.user, ...action.userPatch };
      const tier = computeLevel(patchedUser.score);
      const leveledUp = tier.level > state.user.level;
      // If the admin patch crosses a tier (e.g. score 850 from a
      // current lvl 2), surface the same celebratory levelup event +
      // toast that the normal pay-installment flow emits, so the demo
      // studio path mirrors live play visually.
      const events: SessionEvent[] = leveledUp
        ? [
            {
              id: makeId(),
              kind: "levelup",
              ts: Date.now() + 1,
              txid: makeTxid(),
              op: "sas.levelup",
              amountBrl: 0,
              target: tier.label,
            },
            ev,
            ...state.events,
          ]
        : [ev, ...state.events];
      return {
        ...state,
        user: {
          ...patchedUser,
          level: tier.level,
          levelLabel: tier.label,
          nextLevel: tier.next,
          colateralPct: tier.colat,
          leverageX: tier.lev,
        },
        events,
        joinedGroupNames: joinedAdd,
        demoGroup: action.demoGroup ?? state.demoGroup,
      };
    }
    case "HARVEST_YIELD": {
      // Claim accrued Kamino yield: balance += yield, yield → 0,
      // ledger picks up a positive yield-claim event. Side-effect
      // free if user.yield is already 0 (still emits a 0 event so
      // the UI shows the action ran).
      const amount = state.user.yield;
      const ev: SessionEvent = {
        id: makeId(),
        kind: "yield",
        ts: Date.now(),
        txid: makeTxid(),
        op: "yield.harvest",
        amountBrl: amount,
        target: "kamino.vault",
      };
      return {
        ...state,
        user: {
          ...state.user,
          balance: state.user.balance + amount,
          yield: 0,
        },
        events: [ev, ...state.events],
      };
    }
    default:
      return state;
  }
}

// ── Context ────────────────────────────────────────────────
interface SessionContextValue {
  user: User;
  events: SessionEvent[];
  purchasedOfferIds: string[];
  acquiredPositions: NftPosition[];
  joinedGroupNames: string[];
  monthsPaidByGroup: Record<string, number>;
  demoGroup: ActiveGroup | null;
  listings: ActiveListing[];
  payInstallment: (group: ActiveGroup) => void;
  joinGroup: (group: CatalogGroup) => void;
  sellShare: (position: NftPosition, askPrice: number, discountPct: number) => void;
  cancelListing: (listingId: string) => void;
  buyShare: (target: {
    offerId: string;
    group: string;
    price: number;
    face: number;
    num?: string;
    month?: number;
    total?: number;
    tone?: Tone;
  }) => void;
  pushYield: (amount: number, source?: string) => void;
  harvestYield: () => void;
  loadFromDemo: (
    userPatch: Partial<User>,
    groupName: string | undefined,
    tag: string,
    demoGroup?: ActiveGroup,
  ) => void;
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

  // ─── Toast on every new SessionEvent ──────────────────────────────
  // Reducer stays pure — toast firing lives here in a useEffect that
  // watches the events array. We track the most-recently-toasted
  // event id in a ref so re-renders triggered by other state slices
  // (theme flip, palette swap, currency toggle) don't re-fire.
  // Skip ambient yield ticks + attestation pings (they'd be noisy);
  // user-initiated actions only.
  const lastToastedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const latest = state.events[0];
    if (!latest) return;
    if (latest.id === lastToastedIdRef.current) return;
    lastToastedIdRef.current = latest.id;
    // Only toast user-initiated events. Yield ticks + attestation
    // pings happen automatically and would spam the UI.
    if (latest.kind === "yield" || latest.kind === "attestation") return;

    // Levelup gets a longer, celebratory toast. The reducer placed it
    // at the head of the feed, so it fires before the underlying
    // payment toast on the same tick.
    if (latest.kind === "levelup") {
      toast.success(`Subiu de nível: ${latest.target}`, {
        description: "Novos grupos desbloqueados na aba Grupos.",
        duration: 6000,
      });
      return;
    }

    const messages: Record<string, { title: string; sub?: string }> = {
      payment: {
        title: "Pagamento confirmado",
        sub: latest.target ? `Parcela · ${latest.target}` : undefined,
      },
      join: {
        title: "Entrada confirmada",
        sub: latest.target ? `Você entrou em ${latest.target}` : undefined,
      },
      sale: {
        title: "Venda registrada",
        sub: latest.target ? `Cota · ${latest.target}` : undefined,
      },
      purchase: {
        title: "Compra confirmada",
        sub: latest.target ? `Cota · ${latest.target}` : undefined,
      },
    };
    const msg = messages[latest.kind];
    if (msg) {
      toast.success(msg.title, {
        description: msg.sub,
        duration: 3500,
      });
    }
  }, [state.events]);

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
  const cancelListing = useCallback(
    (listingId: string) => dispatch({ type: "CANCEL_LISTING", listingId }),
    [],
  );
  const buyShare = useCallback(
    (target: {
      offerId: string;
      group: string;
      price: number;
      face: number;
      num?: string;
      month?: number;
      total?: number;
      tone?: Tone;
    }) => dispatch({ type: "BUY_SHARE", ...target }),
    [],
  );
  const pushYield = useCallback(
    (amount: number, source: string = "kamino.vault") =>
      dispatch({ type: "YIELD_TICK", amount, source }),
    [],
  );
  const harvestYield = useCallback(() => dispatch({ type: "HARVEST_YIELD" }), []);
  const loadFromDemo = useCallback(
    (
      userPatch: Partial<User>,
      groupName: string | undefined,
      tag: string,
      demoGroup?: ActiveGroup,
    ) => dispatch({ type: "LOAD_FROM_DEMO", userPatch, groupName, demoGroup, tag }),
    [],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      user: state.user,
      events: state.events,
      purchasedOfferIds: state.purchasedOfferIds,
      acquiredPositions: state.acquiredPositions,
      joinedGroupNames: state.joinedGroupNames,
      monthsPaidByGroup: state.monthsPaidByGroup,
      demoGroup: state.demoGroup,
      listings: state.listings,
      payInstallment,
      joinGroup,
      sellShare,
      cancelListing,
      buyShare,
      pushYield,
      harvestYield,
      loadFromDemo,
    }),
    [
      state,
      payInstallment,
      joinGroup,
      sellShare,
      cancelListing,
      buyShare,
      pushYield,
      harvestYield,
      loadFromDemo,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession() must be used within <SessionProvider>");
  return v;
}
