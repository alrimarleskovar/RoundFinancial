/**
 * Pure selection + formatting helpers for the email notifier (notify.ts).
 *
 * No DB, no RPC, no network — these are the deterministic bits that turn raw
 * on-chain numbers into the display-ready strings the templates expect, so they
 * can be unit-tested in the mocha+tsx lane (notify.ts itself needs Postgres +
 * an RPC and is exercised by the operator, not CI).
 */

import { STAKE_BPS_BY_LEVEL } from "@roundfi/sdk";

export type Lang = "pt" | "en";

// BRL per USDC — mirrors app/src/lib/i18n-dict.ts `USDC_RATE`. Kept as a local
// constant because the indexer can't import the front-end.
export const USDC_RATE = 5.5;

const PT_MONTHS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
const EN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// level → label (the v5.2 ladder). Matches app/src/data/score.ts LEVELS.
const LEVEL_LABELS: Record<number, string> = {
  1: "Iniciante",
  2: "Comprovado",
  3: "Veterano",
  4: "Elite",
};

/** USDC base units (6-dp bigint) → "R$ X.XXX,XX" (pt-BR grouping + comma decimal). */
export function formatBrl(usdcBaseUnits: bigint): string {
  const brl = (Number(usdcBaseUnits) / 1e6) * USDC_RATE;
  return (
    "R$ " + brl.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** Unix seconds → "29 jun 2026" (pt) / "Jun 29, 2026" (en). UTC, deterministic
 *  (no locale/TZ dependence) so it renders identically wherever the cron runs. */
export function formatDate(unixSec: number | bigint, lang: Lang): string {
  const d = new Date(Number(unixSec) * 1000);
  const day = d.getUTCDate();
  const mon = (lang === "pt" ? PT_MONTHS : EN_MONTHS)[d.getUTCMonth()] ?? "";
  const year = d.getUTCFullYear();
  return lang === "pt" ? `${day} ${mon} ${year}` : `${mon} ${day}, ${year}`;
}

/** "81u3…bchNy" — first 4 + last 4 of a base58 address. */
export function shortWallet(addr: string): string {
  return addr.length <= 10 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** Whole days until `dueSec` from `nowSec`, min 1 (a due-in-<24h reminder still
 *  reads "1 dia"). Returns null when the deadline already passed (not a
 *  "due in X days" case — that's a late/default situation). */
export function daysUntil(nowSec: number, dueSec: number): number | null {
  const diff = dueSec - nowSec;
  if (diff <= 0) return null;
  return Math.max(1, Math.ceil(diff / 86_400));
}

/** Human label for an on-chain reputation level (1–4); falls back to Iniciante. */
export function levelLabel(level: number): string {
  return LEVEL_LABELS[level] ?? LEVEL_LABELS[1]!;
}

/** Collateral % a wallet of this level posts on join (STAKE_BPS_BY_LEVEL ÷ 100). */
export function collateralPctForLevel(level: number): number {
  const table = STAKE_BPS_BY_LEVEL as Record<number, number>;
  const bps = table[level] ?? table[1]!;
  return Math.round(bps / 100);
}
