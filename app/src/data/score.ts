// SAS reputation fixtures: ladder levels + emitted attestation bonds.
// Ported from prototype/components/screens-home.jsx.

import type { Tone } from "@/data/carteira";

export interface ReputationLevel {
  lv: 1 | 2 | 3;
  name: string;
  colat: number; // % stake required
  lev: number;   // leverage multiplier
  unlocked: boolean;
  current?: boolean;
  vip?: boolean;
}

export const LEVELS: ReputationLevel[] = [
  { lv: 1, name: "Iniciante",  colat: 50, lev: 2,    unlocked: true },
  { lv: 2, name: "Comprovado", colat: 30, lev: 3.3,  unlocked: true, current: true },
  { lv: 3, name: "Veterano",   colat: 10, lev: 10,   unlocked: false, vip: true },
];

export type BondStatus = "active" | "completed";

export interface SasBond {
  id: string;
  cycle: string;
  date: string;
  installments: number;
  tone: Tone;
  status: BondStatus;
}

export const SAS_BONDS: SasBond[] = [
  { id: "b1", cycle: "Dev Setup · 6m",  date: "Mar 2026", installments: 3, tone: "p", status: "active" },
  { id: "b2", cycle: "Renovação MEI",   date: "Abr 2026", installments: 4, tone: "g", status: "active" },
  { id: "b3", cycle: "Freela Setup",    date: "Dez 2025", installments: 6, tone: "t", status: "completed" },
  { id: "b4", cycle: "Curso Rust",      date: "Set 2025", installments: 4, tone: "a", status: "completed" },
];

// Aggregated counts for the screen subtitle.
export const SAS_TOTAL_INSTALLMENTS = SAS_BONDS.reduce(
  (acc, b) => acc + b.installments,
  0,
);
export const SAS_TOTAL_CYCLES = SAS_BONDS.length;
