"use client";

// /home — the dashboard. Graduated from the /home-v2 candidate.
//
// Action-first hero (next installment + a modern gradient countdown ring), four
// EXPANDABLE metric tiles (tap the affordance → sparkline / donut / collateral
// slider / tier bar), the active credit cycles, then "Próximas conquistas".
//
// Wiring is real: useSession drives the figures; "Pagar agora" / the card
// Pagar/Vender open the Pay+Sell modals; the cycles list merges the connected
// wallet's live on-chain devnet memberships (useMyDevnetPositions) on top of
// the session's active groups, so a real join_pool() surfaces here. Every
// string flows through i18n (homeV2.* + shared home.* atoms). The chart figures
// inside the expanded panels remain the design's illustrative values.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { Icons } from "@/components/brand/icons";
import { PayInstallmentModal } from "@/components/modals/PayInstallmentModal";
import { SellShareModal } from "@/components/modals/SellShareModal";
import { ACTIVE_GROUPS, DISCOVER_GROUPS, type ActiveGroup } from "@/data/groups";
import type { NftPosition, Tone } from "@/data/carteira";
import { cardHover } from "@/lib/hoverLift";
import { useI18n, type Lang } from "@/lib/i18n";
import {
  PASSPORT_TIERS,
  PASSPORT_MAX_SCORE,
  TIER_KEYS,
  tierForScore,
  scorePct,
} from "@/lib/passport";
import { useSession } from "@/lib/session";
import { useMyDevnetPositions } from "@/lib/useMyDevnetPositions";

const TONE_HEX: Record<Tone, string> = {
  g: "#14F195",
  t: "#00C8FF",
  p: "#9945FF",
  a: "#FFB547",
  r: "#FF5656",
};

type ExpandKey = "protected" | "cycles" | "collateral" | "passport" | null;

// Local stroke glyphs for the icons the shared set lacks (chevrons / pie /
// calendar / stopwatch / star / trophy). Visual-first — promote to
// @/components/brand/icons at graduation if reused elsewhere.
const GLYPHS: Record<string, ReactNode> = {
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  pie: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9h9" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2.2" />
      <path d="M4 9.5h16M8.5 3.2v3.4M15.5 3.2v3.4" />
    </>
  ),
  stopwatch: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9.2v4l2.6 1.6M9.6 2.6h4.8M12 2.6V5" />
    </>
  ),
  star: (
    <path
      d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 16.9l-5.2 2.73.99-5.8L3.58 9.72l5.82-.85z"
      fill="currentColor"
      stroke="none"
    />
  ),
  trophy: (
    <>
      <path d="M8 4h8v4a4 4 0 0 1-8 0z" />
      <path d="M8 5.2H5.4v1A2.6 2.6 0 0 0 8 8.8" />
      <path d="M16 5.2h2.6v1A2.6 2.6 0 0 1 16 8.8" />
      <path d="M12 12v3M9 19.5h6M9.8 19.5l.5-4M14.2 19.5l-.5-4" />
    </>
  ),
};

// Renders a local GLYPH by name, falling back to the shared Icons set.
function Glyph({
  name,
  color = "currentColor",
  size = 18,
  sw = 1.8,
}: {
  name: string;
  color?: string;
  size?: number;
  sw?: number;
}) {
  const g = GLYPHS[name];
  if (!g) {
    const Ic = Icons[name];
    return Ic ? <Ic size={size} stroke={color} sw={sw} /> : null;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color }}
    >
      {g}
    </svg>
  );
}

// Next-installment due date from a "days until" offset, DD/Mon.
function dueLabel(daysUntil: number, lang: Lang): string {
  const d = new Date(Date.now() + daysUntil * 86_400_000);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d
    .toLocaleDateString(lang === "pt" ? "pt-BR" : "en-US", { month: "short" })
    .replace(".", "");
  return `${day}/${mon.charAt(0).toUpperCase()}${mon.slice(1)}`;
}

// ── action hero ──────────────────────────────────────────────────────────

function ActionHero({
  nextDue,
  installment,
  daysUntil,
  dueDay,
  dueMon,
  payGroup,
}: {
  nextDue: string;
  installment: string;
  daysUntil: number;
  dueDay: string;
  dueMon: string;
  payGroup: ActiveGroup | undefined;
}) {
  const { t } = useI18n();
  const [payOpen, setPayOpen] = useState(false);
  // Ring fills as the due date approaches (fewer days left → more complete).
  const ringPct = Math.max(8, Math.min(100, Math.round((1 - daysUntil / 30) * 100)));
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white/[0.08] bg-[#071018] p-5 shadow-[0_0_45px_rgba(20,241,149,0.08)] sm:p-7">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#14F195]/10 blur-[80px]" />
      <div className="pointer-events-none absolute -left-24 bottom-0 h-64 w-64 rounded-full bg-[#00C8FF]/[0.08] blur-[80px]" />

      <div className="relative z-10 grid gap-6 lg:grid-cols-[1.05fr_0.8fr_1fr] lg:items-center">
        {/* left — the action */}
        <div>
          <div className="mb-4 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-[#14F195]">
            <span className="h-2 w-2 rounded-full bg-[#14F195] shadow-[0_0_10px_#14F195]" />
            {t("homeV2.hero.badge")}
          </div>
          <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
            {t("homeV2.hero.dueIn")}
          </h2>
          <div className="mt-1 text-4xl font-black tracking-tight text-[#14F195] sm:text-5xl">
            {t("homeV2.hero.daysCount", { n: daysUntil })}
          </div>
          <p className="mt-5 text-sm text-gray-400">{t("homeV2.hero.amountLabel")}</p>
          <div className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">
            {installment}
          </div>
          <button
            type="button"
            onClick={() => setPayOpen(true)}
            disabled={!payGroup}
            className="mt-6 inline-flex w-full max-w-[280px] items-center justify-between rounded-2xl bg-gradient-to-r from-[#14F195] to-[#00C8FF] px-6 py-4 text-sm font-black text-[#04130D] shadow-[0_8px_32px_rgba(20,241,149,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(20,241,149,0.36)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("homeV2.hero.payNow")}
            <Glyph name="chevronRight" color="#04130D" size={18} sw={2.4} />
          </button>
        </div>

        {/* center — modern countdown ring (same gauge language as /insights & /reputacao) */}
        <div className="relative flex items-center justify-center py-2">
          <div className="pointer-events-none absolute h-[210px] w-[210px] rounded-full bg-[radial-gradient(circle,rgba(20,241,149,0.16),transparent_62%)]" />
          <div
            className="relative h-[196px] w-[196px]"
            style={{ filter: "drop-shadow(0 0 16px rgba(20,241,149,0.22))" }}
          >
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
              <defs>
                <linearGradient id="cdRing" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#14F195" />
                  <stop offset="55%" stopColor="#00C8FF" />
                  <stop offset="100%" stopColor="#9945FF" />
                </linearGradient>
              </defs>
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="rgba(255,255,255,0.07)"
                strokeWidth="10"
              />
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="url(#cdRing)"
                strokeWidth="10"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray={`${ringPct} ${100 - ringPct}`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[11px] font-black uppercase tracking-[0.28em] text-[#14F195]">
                {dueMon}
              </span>
              <span className="text-[3.25rem] font-black leading-none tracking-tighter text-white [font-variant-numeric:tabular-nums]">
                {dueDay}
              </span>
              <span className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">
                {t("home.card.due")}
              </span>
            </div>
          </div>
        </div>

        {/* right — the facts */}
        <div className="grid gap-2.5 rounded-3xl border border-white/10 bg-black/20 p-3 backdrop-blur">
          <HeroFact icon="calendar" title={t("home.card.due")} value={nextDue} />
          <HeroFact
            icon="stopwatch"
            title={t("homeV2.hero.daysLeft")}
            value={t("homeV2.hero.daysCount", { n: daysUntil })}
          />
          <HeroFact
            icon="shield"
            title={t("homeV2.hero.keepScore")}
            value={t("homeV2.hero.avoidFees")}
          />
        </div>
      </div>

      {payGroup ? (
        <PayInstallmentModal group={payGroup} open={payOpen} onClose={() => setPayOpen(false)} />
      ) : null}
    </section>
  );
}

// Top greeting strip (the redesign export dropped this; the target print
// keeps it). Time-aware salutation + the two primary CTAs — Pagar parcela
// opens the real installment modal, Entrar em grupo bridges to /grupos.
function Greeting({
  firstName,
  payGroup,
}: {
  firstName: string;
  payGroup: ActiveGroup | undefined;
}) {
  const { t } = useI18n();
  const [payOpen, setPayOpen] = useState(false);
  const hour = new Date().getHours();
  const salutation =
    hour < 12
      ? t("homeV2.greeting.morning")
      : hour < 18
        ? t("homeV2.greeting.afternoon")
        : t("homeV2.greeting.evening");
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-3xl font-black tracking-[-0.03em] text-white [font-family:var(--font-syne),sans-serif] sm:text-4xl">
          {salutation}, {firstName} <span className="align-middle">👋</span>
        </h1>
        <p className="mt-2 text-sm text-gray-400">{t("homeV2.greeting.sub")}</p>
      </div>
      <div className="flex shrink-0 gap-2.5">
        <button
          type="button"
          onClick={() => setPayOpen(true)}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#14F195] to-[#00C8FF] px-5 py-3 text-sm font-black text-[#04130D] shadow-[0_8px_28px_rgba(20,241,149,0.25)] transition hover:-translate-y-0.5"
        >
          <Icons.send size={16} stroke="#04130D" sw={1.9} />
          {t("homeV2.cta.payInstallment")}
        </button>
        <Link
          href="/grupos"
          className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] bg-white/[0.04] px-5 py-3 text-sm font-bold text-white transition hover:border-white/30"
        >
          <Icons.plus size={16} stroke="currentColor" sw={2} />
          {t("homeV2.cta.joinGroup")}
        </Link>
      </div>
      {payGroup ? (
        <PayInstallmentModal group={payGroup} open={payOpen} onClose={() => setPayOpen(false)} />
      ) : null}
    </div>
  );
}

// Shown in place of the pay-installment hero when the connected wallet has no
// active cycle (a fresh wallet in real mode). No fabricated installment — just
// the onboarding CTA into /grupos.
function NoCycleHero() {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white/[0.08] bg-[#071018] p-7 shadow-[0_0_45px_rgba(20,241,149,0.08)]">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#14F195]/10 blur-[80px]" />
      <div className="relative z-10 flex flex-col items-center gap-4 py-8 text-center">
        <Glyph name="ticket" color="#14F195" size={34} sw={1.6} />
        <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
          {t("home.cycles.empty.title")}
        </h2>
        <p className="max-w-md text-sm text-gray-400">{t("homeV2.greeting.sub")}</p>
        <Link
          href="/grupos"
          className="mt-1 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#14F195] to-[#00C8FF] px-6 py-3.5 text-sm font-black text-[#04130D] shadow-[0_8px_28px_rgba(20,241,149,0.25)] transition hover:-translate-y-0.5"
        >
          {t("home.cycles.empty.cta")}
          <Glyph name="chevronRight" color="#04130D" size={18} sw={2.4} />
        </Link>
      </div>
    </section>
  );
}

function HeroFact({ icon, title, value }: { icon: string; title: string; value: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-white/5 bg-white/[0.035] p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#14F195]/20 bg-[#14F195]/10">
        <Glyph name={icon} color="#14F195" size={19} sw={1.9} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400">{title}</p>
        <p className="mt-0.5 truncate text-sm font-bold text-white">{value}</p>
      </div>
    </div>
  );
}

// ── expandable metric tile ───────────────────────────────────────────────

function ExpandableMetricCard({
  id,
  expanded,
  onToggle,
  tone,
  title,
  value,
  subtitle,
  icon,
  children,
}: {
  id: ExpandKey;
  expanded: boolean;
  onToggle: (id: ExpandKey) => void;
  tone: string;
  title: string;
  value: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <article
      className={`group relative h-full overflow-hidden rounded-2xl border p-5 transition-all duration-300 ${
        expanded
          ? "border-white/25 bg-white/[0.06] shadow-[0_0_34px_rgba(255,255,255,0.07)]"
          : "border-white/10 bg-white/[0.035] hover:border-white/20"
      }`}
    >
      <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: tone }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-4 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-gray-400">
            {title}
          </div>
          <div className="text-3xl font-black tracking-tight text-white sm:text-4xl">{value}</div>
          {subtitle ? <p className="mt-3 text-sm text-gray-400">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => onToggle(expanded ? null : id)}
          className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-2 text-gray-400 transition hover:border-white/25 hover:text-white"
          aria-label={expanded ? t("homeV2.collapse") : t("homeV2.expand")}
        >
          {expanded ? (
            <Glyph name="chevronDown" color="currentColor" size={17} sw={2} />
          ) : (
            (icon ?? <Icons.eye size={17} stroke="currentColor" sw={1.8} />)
          )}
        </button>
      </div>

      <div
        className={`grid transition-all duration-300 ${
          expanded ? "mt-5 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </article>
  );
}

function ProtectedDetails({
  liveBalance,
  demoActive,
}: {
  liveBalance: number;
  demoActive: boolean;
}) {
  const { t, fmtMoney } = useI18n();
  // Real wallet: the card's hero is now the LOCKED collateral + escrow (what's
  // genuinely "protected" on-chain). The expanded panel surfaces the free
  // wallet balance + the (not-yet-credited) yield, honestly.
  if (!demoActive) {
    return (
      <div className="space-y-3 border-t border-white/10 pt-4">
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">{t("homeV2.protected.walletLabel")}</span>
          <span className="font-bold text-gray-300">{fmtMoney(liveBalance)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">{t("homeV2.protected.realYieldLabel")}</span>
          <span className="font-bold text-gray-400">—</span>
        </div>
        <p className="text-[11px] leading-relaxed text-gray-500">
          {t("homeV2.protected.lockedNote")}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4 border-t border-white/10 pt-4">
      <div className="h-16 rounded-xl bg-[linear-gradient(180deg,rgba(20,241,149,0.28),rgba(20,241,149,0.02))] p-3">
        <svg viewBox="0 0 240 52" className="h-full w-full overflow-visible">
          <path
            d="M2 42 C35 24, 60 36, 92 20 S150 28, 178 14 S215 18, 238 4"
            fill="none"
            stroke="#14F195"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-gray-500">{t("homeV2.protected.accrued")}</p>
          <p className="mt-1 font-bold text-white">{fmtMoney(1587.76)}</p>
        </div>
        <div>
          <p className="text-gray-500">{t("homeV2.protected.avgYield")}</p>
          <p className="mt-1 font-bold text-[#00C8FF]">57 USDC</p>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-gray-500">
        {t("homeV2.protected.note", { v: fmtMoney(liveBalance) })}
      </p>
    </div>
  );
}

function CycleValueDetails({
  demoActive,
  activeCount,
}: {
  demoActive: boolean;
  activeCount: number;
}) {
  const { t } = useI18n();
  // Real wallet: the 62/23/15 split is a demo fixture. Show the real count of
  // active on-chain cotas + a jump into /grupos instead.
  if (!demoActive) {
    return (
      <div className="space-y-3 border-t border-white/10 pt-4">
        <p className="text-xs text-gray-400">
          {activeCount > 0
            ? t("homeV2.cycles.realCount", { n: activeCount })
            : t("homeV2.cycles.realEmpty")}
        </p>
        <Link
          href="/grupos"
          className="inline-flex items-center gap-2 text-xs font-bold text-[#14F195]"
        >
          {t("homeV2.seeDetails")} <Glyph name="chevronRight" color="#14F195" size={14} sw={2.2} />
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4 border-t border-white/10 pt-4">
      <div className="flex items-center gap-4">
        <div className="relative h-24 w-24 rounded-full bg-[conic-gradient(#14F195_0_62%,#00C8FF_62%_85%,#9945FF_85%_100%)]">
          <div className="absolute inset-4 rounded-full bg-[#0B0F16]" />
        </div>
        <div className="space-y-2 text-xs">
          <Legend color="#14F195" label={t("homeV2.cycles.ongoing")} value="62%" />
          <Legend color="#00C8FF" label={t("homeV2.cycles.waiting")} value="23%" />
          <Legend color="#9945FF" label={t("homeV2.cycles.closed")} value="15%" />
        </div>
      </div>
      <Link
        href="/grupos"
        className="inline-flex items-center gap-2 text-xs font-bold text-[#14F195]"
      >
        {t("homeV2.seeDetails")} <Glyph name="chevronRight" color="#14F195" size={14} sw={2.2} />
      </Link>
    </div>
  );
}

function CollateralDetails({ pct }: { pct: number }) {
  const { t } = useI18n();
  const left = Math.max(0, Math.min(100, ((pct - 20) / 30) * 100));
  return (
    <div className="space-y-4 border-t border-white/10 pt-4">
      <div className="relative h-3 rounded-full bg-white/10">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#14F195] via-[#00C8FF] to-[#9945FF]"
          style={{ width: "100%" }}
        />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white bg-[#0B0F16]"
          style={{ left: `${left}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-gray-400">
        <span>{t("homeV2.collateral.min")}</span>
        <span>{t("homeV2.collateral.max")}</span>
      </div>
      <Link
        href="/reputacao"
        className="inline-flex items-center gap-2 text-xs font-bold text-[#14F195]"
      >
        {t("homeV2.collateral.howReduce")}{" "}
        <Glyph name="chevronRight" color="#14F195" size={14} sw={2.2} />
      </Link>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-gray-400">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="font-mono font-bold text-white">{value}</span>
    </div>
  );
}

// Standout SAS passport tile — the glow / gradient label / italic score /
// animated tier bar from the original /home CompactPassport, kept expandable
// so it sits alongside the three metric cards but clearly carries more weight.
function PassportTile({
  score,
  passportId,
  expanded,
  onToggle,
}: {
  score: number;
  passportId: string;
  expanded: boolean;
  onToggle: (id: ExpandKey) => void;
}) {
  const { t } = useI18n();
  const tier = tierForScore(score);
  const pct = scorePct(score);
  const nextTier = PASSPORT_TIERS.find((tt) => tt.min > score);
  const toNext = nextTier ? nextTier.min - score : 0;

  return (
    <article
      className={`group relative h-full overflow-hidden rounded-2xl border p-5 transition-all duration-300 ${
        expanded
          ? "border-[#9945FF]/55 bg-[#9945FF]/[0.07] shadow-[0_0_40px_rgba(153,69,255,0.24)]"
          : "border-[#9945FF]/30 bg-[#0C1018] shadow-[0_0_30px_rgba(153,69,255,0.15)] hover:border-[#9945FF]/55"
      }`}
    >
      {/* signature passport glows + shine sweep */}
      <div className="pointer-events-none absolute -left-10 -top-10 h-32 w-32 animate-pulse rounded-full bg-[#9945FF] opacity-20 blur-[60px]" />
      <div className="pointer-events-none absolute -bottom-10 -right-10 h-32 w-32 animate-pulse rounded-full bg-[#14F195] opacity-10 blur-[60px]" />
      <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-tr from-transparent via-white/5 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />

      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="bg-gradient-to-r from-[#9945FF] to-[#14F195] bg-clip-text text-[11px] font-black uppercase tracking-[0.16em] text-transparent">
            {t("homeV2.passport.title")}
          </span>
          <div className="mt-0.5 font-mono text-[8px] text-gray-500">ID: {passportId}</div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(expanded ? null : "passport")}
          className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-2 text-gray-400 transition hover:border-white/25 hover:text-white"
          aria-label={expanded ? t("homeV2.collapse") : t("homeV2.expand")}
        >
          {expanded ? (
            <Glyph name="chevronDown" color="currentColor" size={17} sw={2} />
          ) : (
            <Icons.wallet size={17} stroke="currentColor" sw={1.9} />
          )}
        </button>
      </div>

      <div className="relative z-10 mt-3 flex items-end gap-2">
        <span className="text-[3.25rem] font-black italic leading-none tracking-tighter text-white">
          {score}
        </span>
        <div className="mb-1 flex flex-col">
          <span className="text-[10px] font-black italic leading-none text-[#14F195]">
            {t("homeV2.passport.trusted")}
          </span>
          <span className="text-[10px] font-bold italic text-gray-500">
            {t("homeV2.passport.scoreWord")}
          </span>
        </div>
      </div>

      <div className="relative z-10 mt-4">
        <div className="mb-1 flex justify-between text-[8px] font-bold uppercase text-gray-500">
          <span>{t("home.passport.tierLabel")}</span>
          <span className="text-[#9945FF]">
            Tier {tier.level} / {t(TIER_KEYS[tier.level])}
          </span>
        </div>
        <div className="relative h-1.5 w-full overflow-hidden rounded-full border border-white/5 bg-white/5">
          <div
            className="h-full animate-gradient-x bg-gradient-to-r from-[#9945FF] via-[#14F195] to-[#9945FF] bg-[length:200%_auto]"
            style={{ width: `${pct}%` }}
          />
          {PASSPORT_TIERS.slice(1).map((tt) => (
            <span
              key={tt.level}
              className="absolute bottom-0 top-0 w-px bg-white/25"
              style={{ left: `${(tt.min / PASSPORT_MAX_SCORE) * 100}%` }}
            />
          ))}
        </div>
      </div>

      {/* expand → next-level note + profile CTA */}
      <div
        className={`relative z-10 grid transition-all duration-300 ${
          expanded ? "mt-4 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 border-t border-white/10 pt-4">
            <p className="text-[11px] leading-relaxed text-gray-400">
              {toNext > 0 ? t("homeV2.passport.toNext", { n: toNext }) : t("homeV2.passport.max")}
            </p>
            <Link
              href="/reputacao"
              className="inline-flex items-center gap-2 text-xs font-bold text-[#14F195]"
            >
              {t("homeV2.passport.viewProfile")}{" "}
              <Glyph name="chevronRight" color="#14F195" size={14} sw={2.2} />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

// ── active credit cycle row ──────────────────────────────────────────────

function GroupCard({ g, month, theme }: { g: ActiveGroup; month: number; theme: string }) {
  const { t, lang } = useI18n();
  const [payOpen, setPayOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const dueDate = dueLabel(g.nextDue, lang);
  const tone = TONE_HEX[g.tone];
  const monthsLeft = Math.max(0, g.total - month);
  const sellPosition: NftPosition = {
    id: g.id,
    num: g.id.replace(/\D/g, "").padStart(2, "0"),
    group: g.name,
    tone: g.tone,
    month,
    total: g.total,
    exp: new Date(Date.now() + monthsLeft * 30 * 86_400_000)
      .toLocaleDateString(lang === "pt" ? "pt-BR" : "en-US", { month: "short", year: "2-digit" })
      .replace(".", ""),
    value: g.prize,
    yieldPct: 0,
  };

  return (
    <div
      className={`w-full rounded-2xl border border-transparent p-4 transition-all ${
        theme === "light" ? "bg-white shadow-sm" : "bg-white/[0.04]"
      }`}
      {...cardHover(tone)}
    >
      <div className="grid items-center gap-4 sm:grid-cols-[230px_1fr_90px_190px]">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg"
            style={{ background: `${tone}1A`, border: `1px solid ${tone}40` }}
          >
            {g.emoji}
          </div>
          <div className="min-w-0">
            <span className="text-[9px] font-bold uppercase tracking-wide text-gray-500">
              {t("home.card.quota")}
            </span>
            <h4
              className={`truncate text-sm font-bold ${theme === "light" ? "text-[#2A2E38]" : "text-white"}`}
            >
              {g.name}
            </h4>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between font-mono text-[10px]">
            <span className="text-gray-400">{t("home.card.progress")}</span>
            <span className="font-bold" style={{ color: tone }}>
              {month}/{g.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/7">
            <div
              className="h-full rounded-full"
              style={{ background: tone, width: `${(month / g.total) * 100}%` }}
            />
          </div>
        </div>

        <div className="text-right sm:text-left">
          <span className="text-[9px] uppercase text-gray-500">{t("home.card.due")}</span>
          <p
            className={`font-mono text-xs font-bold ${theme === "light" ? "text-[#2A2E38]" : "text-white"}`}
          >
            {dueDate}
          </p>
        </div>

        <div className="flex gap-2 sm:justify-end">
          <button
            onClick={() => setPayOpen(true)}
            className="rounded-xl bg-gradient-to-b from-[#14F195] to-[#0FCB7E] px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#04130D] shadow-[0_4px_14px_rgba(20,241,149,0.28)] transition hover:-translate-y-0.5"
          >
            {t("home.card.pay")}
          </button>
          <button
            onClick={() => setSellOpen(true)}
            className="rounded-xl border border-[#FF7A7A]/25 bg-[#FF7A7A]/[0.08] px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#FF9090] transition hover:border-[#FF7A7A]/45 hover:bg-[#FF7A7A]/15"
          >
            {t("home.card.sell")}
          </button>
        </div>
      </div>

      <PayInstallmentModal group={g} open={payOpen} onClose={() => setPayOpen(false)} />
      <SellShareModal position={sellPosition} open={sellOpen} onClose={() => setSellOpen(false)} />
    </div>
  );
}

function AchievementCard({
  icon,
  title,
  subtitle,
  progress,
  pct = 0,
}: {
  icon: string;
  title: string;
  subtitle: string;
  progress: string;
  pct?: number;
}) {
  return (
    <div
      {...cardHover("#14F195")}
      className="rounded-2xl border border-transparent bg-white/[0.035] p-5 transition"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#14F195]/10">
        <Glyph name={icon} color="#14F195" size={22} sw={1.9} />
      </div>
      <h4 className="font-bold text-white">{title}</h4>
      <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
      <div className="mt-5 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full bg-[#14F195]"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>
        <span className="font-mono text-xs text-gray-400">{progress}</span>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { t, fmtMoney } = useI18n();
  const { user, monthsPaidByGroup, claimedGroups, demoActive } = useSession();
  const theme = "dark";
  const [liveBalance, setLiveBalance] = useState(user.balance + user.yield);
  const [expanded, setExpanded] = useState<ExpandKey>(null);

  // Keep the hero balance synced to the real (bridge-updated) wallet balance.
  // The subtle "live" drift is demo-mode eye-candy only — a real wallet must
  // reflect the on-chain USDC balance, not creep upward from a fake ticker.
  useEffect(() => {
    setLiveBalance(user.balance + user.yield);
  }, [user.balance, user.yield]);
  useEffect(() => {
    if (!demoActive) return;
    const interval = setInterval(() => {
      setLiveBalance((prev) => prev + Math.random() * 0.005);
    }, 4000);
    return () => clearInterval(interval);
  }, [demoActive]);

  // Real on-chain memberships — the connected wallet's live cotas across the
  // devnet pools. Surface any that isn't already a static active card so a real
  // join_pool() shows up here as a live cycle (read from chain, not the session
  // mock). Empty for a fresh wallet.
  const realPositions = useMyDevnetPositions();
  // Total collateral (stake + escrow) locked across the wallet's live cotas —
  // committed to the protocol, not in the wallet. Surfaced in the "Saldo
  // protegido" tile so it reflects the full on-chain commitment.
  const lockedUsdc = useMemo(
    () => realPositions.reduce((s, p) => s + (p.locked ?? 0), 0),
    [realPositions],
  );
  const joinedOnChainGroups = useMemo<ActiveGroup[]>(() => {
    const activePools = new Set(ACTIVE_GROUPS.map((g) => g.devnetPool).filter(Boolean));
    const seen = new Set<string>();
    const out: ActiveGroup[] = [];
    for (const pos of realPositions) {
      if (!pos.devnetPool || activePools.has(pos.devnetPool) || seen.has(pos.devnetPool)) continue;
      const d = DISCOVER_GROUPS.find((g) => g.devnetPool === pos.devnetPool);
      if (!d) continue;
      seen.add(pos.devnetPool);
      out.push({
        id: `onchain-${d.id}`,
        name: d.name,
        emoji: d.emoji,
        tone: d.tone,
        prize: d.prize,
        month: pos.month,
        total: d.months,
        status: "paying",
        // Real on-chain due date (advances a full cycle the moment this
        // member pays) — not a hardcoded offset that sat frozen on the
        // first installment's date.
        nextDue: pos.nextDueDays ?? 7,
        progress: d.months > 0 ? pos.month / d.months : 0,
        members: d.total,
        draw: "",
        installment: d.installment,
        level: d.level,
        devnetPool: d.devnetPool,
      });
    }
    return out;
  }, [realPositions]);
  // Demo mode shows the fixture catalog of cycles for the pitch; a real wallet
  // shows ONLY its genuine on-chain cotas (empty for a fresh wallet).
  const cycleGroups = useMemo(
    () => (demoActive ? [...ACTIVE_GROUPS, ...joinedOnChainGroups] : joinedOnChainGroups),
    [demoActive, joinedOnChainGroups],
  );

  // "Próximas conquistas": real, achievable next steps derived from the
  // wallet's on-chain cotas — complete the closest pool (+50), pay the
  // soonest-due installment on time (+10, only if a different pool), join
  // another group (+10). Demo keeps the fixture cards (rendered inline below).
  const realAchievements = useMemo(() => {
    // Featured real pools only — the same demo-twin exclusion /grupos and the
    // cycle cards (joinedOnChainGroups) already apply. A position whose pool is
    // twinned by a demo fixture (pool3 ↔ the "Renovação MEI" pitch card) is
    // dropped here too, so an achievement never inherits a pitch name the rest
    // of real mode hides. Names resolve from the real catalog only.
    const demoPools = new Set(ACTIVE_GROUPS.map((g) => g.devnetPool).filter(Boolean));
    const eligible = realPositions.filter((p) => !p.devnetPool || !demoPools.has(p.devnetPool));
    const name = (p: NftPosition) =>
      DISCOVER_GROUPS.find((g) => g.devnetPool === p.devnetPool)?.name ?? p.group;
    const pct = (p: NftPosition) => (p.total > 0 ? Math.round((p.month / p.total) * 100) : 0);
    const payable = eligible.filter((p) => p.month < p.total);
    const out: { icon: string; title: string; points: number; progress: string; pct: number }[] =
      [];
    const closest = [...payable].sort((a, b) => b.month / b.total - a.month / a.total)[0];
    if (closest) {
      out.push({
        icon: "trophy",
        title: t("homeV2.achiev.real.complete", { pool: name(closest) }),
        points: 50,
        progress: `${closest.month}/${closest.total}`,
        pct: pct(closest),
      });
    }
    const due = [...payable].sort((a, b) => (a.nextDueDays ?? 999) - (b.nextDueDays ?? 999))[0];
    if (due && due.id !== closest?.id) {
      out.push({
        icon: "star",
        title: t("homeV2.achiev.real.pay", { pool: name(due) }),
        points: 10,
        progress: `${due.month}/${due.total}`,
        pct: pct(due),
      });
    }
    out.push({
      icon: "people",
      title: t("homeV2.achiev.real.join"),
      points: 10,
      progress: eligible.length ? String(eligible.length) : "0/1",
      pct: 0,
    });
    return out;
  }, [realPositions, t]);

  // "Próximas conquistas" receivable + the next-installment hero both derive
  // from the REAL cycle set, so a fresh wallet shows R$ 0 / no due installment
  // instead of the fixture's R$ 13.600 / R$ 892,40.
  const receivable = useMemo(
    () =>
      cycleGroups
        .filter((g) => g.status !== "drawn" && !claimedGroups.includes(g.name))
        .reduce((sum, g) => sum + g.prize, 0),
    [cycleGroups, claimedGroups],
  );

  const firstName = user.name.trim().split(" ")[0] || user.walletShort;
  // The hero pins the MOST URGENT cycle — the one whose next installment is
  // due soonest. Because a payment pushes that group's due date a full cycle
  // forward (useMyDevnetPositions), the hero then rotates to the next group
  // the user actually needs to pay, instead of staying stuck on the first
  // one they joined.
  const firstGroup = useMemo(
    () =>
      cycleGroups.length ? [...cycleGroups].sort((a, b) => a.nextDue - b.nextDue)[0] : undefined,
    [cycleGroups],
  );
  const daysUntil = firstGroup ? firstGroup.nextDue : 5;
  const installment = firstGroup ? fmtMoney(firstGroup.installment) : fmtMoney(0);
  // Real due date for the "Vencimento" fact (DD / Mon / YYYY); the calendar
  // shows the countdown (daysUntil) per the print.
  const dueDate = new Date(Date.now() + daysUntil * 86_400_000);
  const dd = String(dueDate.getDate()).padStart(2, "0");
  const monShort = dueDate.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  const monCap = monShort.charAt(0).toUpperCase() + monShort.slice(1);
  const nextDue = `${dd} / ${monCap} / ${dueDate.getFullYear()}`;

  return (
    <div className="mx-auto flex w-full max-w-6xl animate-in flex-col gap-6 p-4 font-sans fade-in duration-700 md:p-8">
      <Greeting firstName={firstName} payGroup={firstGroup} />

      {firstGroup ? (
        <ActionHero
          nextDue={nextDue}
          installment={installment}
          daysUntil={daysUntil}
          dueDay={dd}
          dueMon={monCap.toUpperCase()}
          payGroup={firstGroup}
        />
      ) : (
        <NoCycleHero />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ExpandableMetricCard
          id="protected"
          expanded={expanded === "protected"}
          onToggle={setExpanded}
          tone="#14F195"
          title={t("homeV2.metric.balance")}
          value={demoActive ? fmtMoney(liveBalance) : fmtMoney(lockedUsdc)}
          subtitle={
            demoActive ? t("homeV2.metric.balanceSub") : t("homeV2.metric.balanceSubLocked")
          }
          icon={<Icons.trend size={17} stroke="currentColor" sw={1.9} />}
        >
          <ProtectedDetails liveBalance={liveBalance} demoActive={demoActive} />
        </ExpandableMetricCard>

        <ExpandableMetricCard
          id="cycles"
          expanded={expanded === "cycles"}
          onToggle={setExpanded}
          tone="#9945FF"
          title={t("homeV2.metric.cycles")}
          value={fmtMoney(receivable)}
          subtitle={t("homeV2.metric.cyclesSub")}
          icon={<Glyph name="pie" color="currentColor" size={17} sw={1.9} />}
        >
          <CycleValueDetails demoActive={demoActive} activeCount={cycleGroups.length} />
        </ExpandableMetricCard>

        <ExpandableMetricCard
          id="collateral"
          expanded={expanded === "collateral"}
          onToggle={setExpanded}
          tone="#FFB547"
          title={t("homeV2.metric.collateral")}
          value={`${user.colateralPct}%`}
          subtitle={t("homeV2.metric.collateralSub")}
          icon={<Icons.shield size={17} stroke="currentColor" sw={1.9} />}
        >
          <CollateralDetails pct={user.colateralPct} />
        </ExpandableMetricCard>

        <PassportTile
          score={user.score}
          passportId={user.walletShort}
          expanded={expanded === "passport"}
          onToggle={setExpanded}
        />
      </div>

      <section className="rounded-[2rem] border border-white/[0.06] bg-white/[0.025] p-5 shadow-2xl sm:p-7">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-gray-500">
            {t("home.cycles.title")}
          </h3>
          <span className="rounded-full border border-[#14F195]/20 bg-[#14F195]/10 px-3 py-1 text-[10px] font-black uppercase text-[#14F195]">
            {t("home.cycles.escrow")}
          </span>
        </div>

        {cycleGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <Glyph name="ticket" color="#6B7280" size={30} sw={1.6} />
            <p className="text-sm text-gray-400">{t("home.cycles.empty.title")}</p>
            <Link
              href="/grupos"
              className="rounded-xl border border-[#14F195]/30 bg-[#14F195]/10 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-[#14F195] transition-all hover:bg-[#14F195]/20"
            >
              {t("home.cycles.empty.cta")}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {cycleGroups.map((g) => {
              const month = Math.min(g.total, g.month + (monthsPaidByGroup[g.name] ?? 0));
              return <GroupCard key={g.id} g={g} month={month} theme={theme} />;
            })}
          </div>
        )}
      </section>

      <section className="rounded-[2rem] border border-white/[0.06] bg-white/[0.025] p-5 sm:p-7">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-gray-500">
            {t("homeV2.achiev.title")}
          </h3>
          <Link href="/insights" className="text-xs font-bold text-gray-400 hover:text-white">
            {t("homeV2.achiev.seeAll")}
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {demoActive ? (
            <>
              <AchievementCard
                icon="star"
                title={t("homeV2.achiev.1.t")}
                subtitle={t("homeV2.achiev.earn", { n: 18 })}
                progress="0/2"
              />
              <AchievementCard
                icon="people"
                title={t("homeV2.achiev.2.t")}
                subtitle={t("homeV2.achiev.earn", { n: 24 })}
                progress="0/1"
              />
              <AchievementCard
                icon="trophy"
                title={t("homeV2.achiev.3.t")}
                subtitle={t("homeV2.achiev.earn", { n: 42 })}
                progress="0/1"
              />
            </>
          ) : (
            realAchievements.map((a) => (
              <AchievementCard
                key={a.title}
                icon={a.icon}
                title={a.title}
                subtitle={t("homeV2.achiev.earn", { n: a.points })}
                progress={a.progress}
                pct={a.pct}
              />
            ))
          )}
        </div>
      </section>

      <footer className="flex flex-col gap-3 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-2">
          <Icons.lock size={14} stroke="currentColor" sw={1.8} />
          {t("homeV2.footer.protected")}
        </span>
        <span className="inline-flex items-center gap-2 text-[#14F195]">
          <Icons.check size={14} stroke="#14F195" sw={2.2} />
          {t("homeV2.footer.audited")}
        </span>
      </footer>
    </div>
  );
}
