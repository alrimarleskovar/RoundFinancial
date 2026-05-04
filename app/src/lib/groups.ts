// Group categorization + label table. Categorizes by name keywords;
// mirrors prototype/components/desktop.jsx's categorizeGroup().

import type { ActiveGroup, DiscoverGroup, GroupLevel } from "@/data/groups";

export type Category = "pme" | "vip" | "dev" | "delivery" | "estudo" | "casa" | "pessoal";

export const CATEGORY_KEYS: Category[] = [
  "pme",
  "vip",
  "dev",
  "delivery",
  "estudo",
  "casa",
  "pessoal",
];

export function categorizeGroup(g: { name: string }): Category {
  const n = g.name.toLowerCase();
  if (/\bmei\b|pme|capital/.test(n)) return "pme";
  if (/veteran|vip/.test(n)) return "vip";
  if (/dev|rust|curso|freela/.test(n)) return "dev";
  if (/moto|delivery/.test(n)) return "delivery";
  if (/intercâmbio|intercambio|estudo/.test(n)) return "estudo";
  if (/reforma|casa|enxoval/.test(n)) return "casa";
  return "pessoal";
}

// Unified row shape consumed by GroupCard + filter pipeline. Bridges
// ActiveGroup + DiscoverGroup so they can mix in one catalog list.
export interface CatalogGroup {
  id: string;
  name: string;
  emoji: string;
  tone: ActiveGroup["tone"];
  prize: number;
  months: number;
  installment: number;
  filled: number;
  total: number;
  level: GroupLevel;
  category: Category;
  joined: boolean;
}

export function fromActive(g: ActiveGroup): CatalogGroup {
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    tone: g.tone,
    prize: g.prize,
    months: g.total,
    installment: g.installment,
    filled: g.members,
    total: g.members,
    level: g.level ?? 2,
    category: categorizeGroup(g),
    joined: true,
  };
}

export function fromDiscover(g: DiscoverGroup): CatalogGroup {
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    tone: g.tone,
    prize: g.prize,
    months: g.months,
    installment: g.installment,
    filled: g.filled,
    total: g.total,
    level: g.level,
    category: categorizeGroup(g),
    joined: false,
  };
}
