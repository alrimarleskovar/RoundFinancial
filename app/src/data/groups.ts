// ROSCA group fixtures. Used by Home (Seus grupos) and the Grupos screen
// catalog. Ported from prototype/components/screens-home.jsx.

import type { Tone } from "@/data/carteira";

export type GroupStatus = "paying" | "drawn";

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
