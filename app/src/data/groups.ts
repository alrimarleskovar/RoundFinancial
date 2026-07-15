// ROSCA group fixtures. Used by Home (Seus grupos) and the Grupos screen
// catalog. Ported from prototype/components/screens-home.jsx.

import type { Tone } from "@/data/carteira";
import type { DevnetPoolKey } from "@/lib/devnet";

export type GroupStatus = "paying" | "drawn";
export type GroupLevel = 1 | 2 | 3 | 4;

export interface ActiveGroup {
  id: string;
  name: string;
  emoji: string;
  tone: Tone;
  prize: number; // BRL
  month: number; // current
  total: number; // total months
  status: GroupStatus;
  nextDue: number; // days until next installment
  progress: number; // 0..1
  members: number;
  draw: string; // human-friendly "em 5 dias" / "ganho no mês 6"
  installment: number; // BRL
  level?: GroupLevel; // implicit Lv2 when omitted
  // Optional link to a deployed devnet pool. When set, the catalog +
  // FeaturedGroup add an "on-chain" badge wired to Solscan. Pure
  // pointer — actual live state is fetched separately via usePool.
  devnetPool?: DevnetPoolKey;
  /**
   * The user is the contemplated slot for the current cycle and the
   * payout hasn't been claimed yet. Set by Demo Studio presets via
   * `LOAD_FROM_DEMO`. Surfaces a "Receber R$ X" CTA in FeaturedGroup
   * + GroupCard. Different semantics from `status === "drawn"` —
   * "drawn" means a past month, `contemplated` means *this* month is
   * yours and the claim is available.
   */
  contemplated?: boolean;
}

export const ACTIVE_GROUPS: ActiveGroup[] = [
  {
    id: "g1",
    name: "Renovação MEI · 12m",
    emoji: "💼",
    tone: "g",
    prize: 10000,
    month: 4,
    total: 12,
    status: "paying",
    nextDue: 5,
    progress: 0.33,
    members: 12,
    draw: "em 5 dias",
    installment: 892.4,
    // Pool 3 (active, 60s cycle, contribute() write path validated end-to-end
    // via Phantom) is the live on-chain twin of this card. Pool 2 is in a
    // contribute-locked state (all members paid cycle 0, claim_payout
    // blocked by SCHEMA_CYCLE_COMPLETE 6-day cooldown from pool 1), so
    // pool 3 is the only one currently driveable from the front-end. The
    // FeaturedGroup on /home overrides counters when available; cards in
    // /grupos surface the link via an "on-chain" badge.
    devnetPool: "pool3",
  },
  {
    id: "g2",
    name: "Casa Própria · 24m",
    emoji: "🏠",
    tone: "t",
    prize: 48000,
    month: 7,
    total: 24,
    status: "drawn",
    nextDue: 12,
    progress: 0.29,
    members: 24,
    draw: "ganho no mês 6",
    installment: 2140.0,
  },
  {
    id: "g3",
    name: "Dev Setup · 6m",
    emoji: "💻",
    tone: "p",
    prize: 3600,
    month: 2,
    total: 6,
    status: "paying",
    nextDue: 18,
    progress: 0.33,
    members: 6,
    draw: "em 18 dias",
    installment: 620.0,
  },
];

// Discover catalog (groups with open spots the user could join).
export interface DiscoverGroup {
  id: string;
  name: string;
  emoji: string;
  tone: Tone;
  prize: number;
  months: number;
  installment: number;
  filled: number;
  total: number;
  level: GroupLevel;
  // Optional link to a deployed devnet pool — when set, the catalog card
  // shows an "on-chain · devnet" badge and JoinGroupModal fires the real
  // join_pool instruction (instead of the mock) once the pool is Forming.
  devnetPool?: DevnetPoolKey;
}

export const DISCOVER_GROUPS: DiscoverGroup[] = [
  {
    id: "d1",
    name: "PME · Capital de Giro",
    emoji: "📈",
    tone: "g",
    prize: 25000,
    months: 18,
    installment: 1520,
    filled: 14,
    total: 18,
    level: 1,
  },
  {
    id: "d2",
    name: "Intercâmbio 2026",
    emoji: "🎓",
    tone: "t",
    prize: 18000,
    months: 12,
    installment: 1640,
    filled: 9,
    total: 12,
    level: 1,
  },
  {
    id: "d3",
    name: "Veteranos VIP",
    emoji: "✦",
    tone: "p",
    prize: 80000,
    months: 24,
    installment: 3660,
    filled: 19,
    total: 24,
    level: 3,
  },
  {
    id: "d4",
    name: "Moto Delivery",
    emoji: "🛵",
    tone: "a",
    prize: 12000,
    months: 12,
    installment: 1090,
    filled: 11,
    total: 12,
    level: 1,
  },
  // Live devnet join target. Sized to the on-chain pool4 params
  // (3 slots, 30 USDC credit, 15 USDC installment, 3 cycles — BRL display
  // at the 5.5 USDC rate). Lv1 so a fresh Phantom wallet (defaults to Lv1
  // on-chain) can actually join. Pointed at the deterministic pool4 PDA;
  // the real join_pool fires once `POOL_SEED_ID=4 pnpm devnet:seed` runs.
  {
    id: "d5",
    name: "Piloto Devnet · Pool 4",
    emoji: "🧪",
    tone: "t",
    prize: 165,
    months: 3,
    installment: 82.5,
    filled: 0,
    total: 3,
    level: 1,
    devnetPool: "pool4",
  },
  // Live devnet "fast pool" (pool7) — 5 slots / 5 cycles (3 teammates + 2
  // operator test wallets), TINY economics (2 USDC credit, 1 USDC installment
  // → 11 / 5.5 BRL at 5.5) so the ~33-USDC faucet can fund all 5 members for
  // the whole lifecycle (each needs only ~6 USDC; the Lv1 stake is 1 USDC).
  // 2-day cycle so the full on-time → late → default arc is testable in ~10
  // days. Lv1 so fresh Phantom wallets can join; real join_pool fires via
  // JoinGroupModal while it's Forming.
  {
    id: "d6",
    name: "Pool Rápida · Devnet 2d",
    emoji: "⚡",
    tone: "a",
    prize: 11,
    months: 5,
    installment: 5.5,
    filled: 0,
    total: 5,
    level: 1,
    devnetPool: "pool7",
  },
  // Live devnet SORTEIO pool (pool8, ADR pool_v2) — the first pool whose
  // payout order is NOT arrival order: when the 6 seats fill, anyone hits
  // "Sortear ordem" (permissionless finalize_draw) and the on-chain draw
  // assigns who receives in which cycle — auditable via the stored seed,
  // impossible to re-roll (single-shot PDA). 6 slots / 6 cycles, 2-day
  // cycle, tiny economics (4 USDC credit → 22 BRL prize, 1 USDC installment
  // → 5.50 BRL at the 5.5 display rate; Lv1 stake 2 USDC, each member needs
  // ~8 USDC total — one faucet hit). Lv1 so fresh Phantom wallets can join.
  {
    id: "d7",
    name: "Sorteio na Hora · 6 vagas",
    emoji: "🎲",
    tone: "p",
    prize: 22,
    months: 6,
    installment: 5.5,
    filled: 0,
    total: 6,
    level: 1,
    devnetPool: "pool8",
  },
];
