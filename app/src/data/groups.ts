// ROSCA group fixtures. Used by Home (Seus grupos) and the Grupos screen
// catalog. Ported from prototype/components/screens-home.jsx.

import type { Tone } from "@/data/carteira";
import type { DevnetPoolKey } from "@/lib/devnet";

export type GroupStatus = "paying" | "drawn";
export type GroupLevel = 1 | 2 | 3;

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
];
