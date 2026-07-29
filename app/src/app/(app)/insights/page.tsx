"use client";

// /insights — behavioral signals + score evolution. Graduated from the
// /insights-v2 candidate: the score hero reads the live session (useSession +
// the passport ladder) and every string flows through i18n, so the PT/EN
// toggle works here. Behaviour signals + the score curve come from the shared
// @/data/insights fixtures. Lives in the (app) route group (DeskShell nav).

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { Icons } from "@/components/brand/icons";
import { liftHover } from "@/lib/hoverLift";
import {
  DEFAULT_RANGE,
  FACTORS,
  RANGE_MONTHS,
  RECOMMENDATIONS,
  SCORE_RANGES,
  curveForRange,
  formatDayMon,
  formatDayTime,
  niceScoreTicks,
  scoreMonths,
  scoreScale,
  type BehaviorFactor,
  type FactorStatus,
  type RealFactor,
  type ScorePoint,
  type ScoreRange,
} from "@/data/insights";
import { useI18n } from "@/lib/i18n";
import { PASSPORT_TIERS, TIER_KEYS, tierForScore } from "@/lib/passport";
import { useMyDevnetPositions } from "@/lib/useMyDevnetPositions";
import { useScoreInsights, type ScoreInsights } from "@/lib/useScoreInsights";
import { useSession } from "@/lib/session";
import { ACTIVE_GROUPS, DISCOVER_GROUPS } from "@/data/groups";
import type { NftPosition, Tone } from "@/data/carteira";

const TONE_HEX: Record<Tone, string> = {
  g: "#14F195",
  t: "#00C8FF",
  p: "#9945FF",
  a: "#FFB547",
  r: "#FF3B8D",
};

const MONO = "[font-family:var(--font-geist-mono),var(--font-jetbrains-mono),monospace]";

// Local stroke glyphs to match the design print (the shared Icons set lacks
// calendar / stopwatch / target / grid / trophy / star). Visual-first — these
// can be promoted to @/components/brand/icons at graduation if reused.
const GLYPHS: Record<string, ReactNode> = {
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
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2.2" />
      <path d="M4 9.5h16M8.5 3.2v3.4M15.5 3.2v3.4" />
      <path d="M9 14.4l1.7 1.7 3.6-3.6" />
    </>
  ),
  stopwatch: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9.2v4l2.6 1.6M9.6 2.6h4.8M12 2.6V5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.4" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  grid: (
    <>
      <rect x="5" y="5" width="5.5" height="5.5" rx="1.2" />
      <rect x="13.5" y="5" width="5.5" height="5.5" rx="1.2" />
      <rect x="5" y="13.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="5.5" height="5.5" rx="1.2" />
    </>
  ),
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
};

// Renders a local GLYPH by name, falling back to the shared Icons set.
function Glyph({
  name,
  color,
  size = 22,
  sw = 1.8,
}: {
  name: string;
  color: string;
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

// Per-factor metadata; all copy (label / desc / long / tip) lives in the i18n
// dict keyed by the factor key, so the PT/EN toggle drives it.
const FACTOR_META: Record<BehaviorFactor["key"], { icon: string; statusKey: string }> = {
  punctuality: { icon: "calendar", statusKey: "excellent" },
  anticipation: { icon: "stopwatch", statusKey: "good" },
  consistency: { icon: "target", statusKey: "developing" },
  engagement: { icon: "people", statusKey: "improve" },
  diversity: { icon: "grid", statusKey: "developing" },
};

// Per-recommendation metadata; label + CTA copy live in the i18n dict.
const REC_META: Record<string, { icon: string; href: string }> = {
  anticipate: { icon: "star", href: "/" },
  diversify: { icon: "people", href: "/grupos" },
  complete: { icon: "trophy", href: "/" },
};

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-white/[0.08] bg-[#0B111A]/80 shadow-[0_12px_38px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-all duration-300 hover:border-[#14F195]/25 lg:rounded-[1.75rem] lg:shadow-[0_24px_80px_rgba(0,0,0,0.35)] lg:hover:-translate-y-0.5 lg:hover:shadow-[0_28px_90px_rgba(0,0,0,0.4),0_0_44px_rgba(20,241,149,0.09)] ${className}`}
    >
      {children}
    </section>
  );
}

function MonoTitle({ children, color = "#14F195" }: { children: React.ReactNode; color?: string }) {
  return (
    <div
      className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.18em] lg:text-[11px] lg:tracking-[0.22em]"
      style={{ color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 12px ${color}` }}
      />
      {children}
    </div>
  );
}

function MobileInsightDisclosure({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-2xl border border-white/[0.07] bg-white/[0.025]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between p-3">
        <div>
          <p className="text-[13px] font-semibold text-white">{title}</p>
          <p className="mt-1 text-[10px] text-gray-500">{summary}</p>
        </div>
        <span className="text-lg text-[#14F195] transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className="space-y-2 border-t border-white/[0.06] p-2">{children}</div>
    </details>
  );
}

function ScoreHero() {
  const { t } = useI18n();
  const { user } = useSession();
  const score = user.score;
  const tier = tierForScore(score);
  const nextTier = PASSPORT_TIERS.find((tt) => tt.min > score);
  const nextMin = nextTier ? nextTier.min : score;
  const toNext = nextTier ? nextTier.min - score : 0;
  const pct = nextTier
    ? Math.max(4, Math.min(100, Math.round(((score - tier.min) / (nextMin - tier.min)) * 100)))
    : 100;
  const levelName = t(TIER_KEYS[tier.level]);
  const nextLevelName = nextTier ? t(TIER_KEYS[nextTier.level]) : levelName;
  const percentile = 72; // static — no population data on devnet yet

  return (
    <Card className="group relative overflow-hidden p-3.5 lg:p-8">
      {/* ambient glows */}
      <div className="absolute -left-20 -top-24 h-64 w-64 rounded-full bg-[#14F195]/10 blur-[80px]" />
      <div className="absolute -bottom-20 -right-16 h-64 w-64 rounded-full bg-[#9945FF]/10 blur-[80px]" />
      {/* mirrored shine sweep on hover — same effect as the home SAS passport */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-tr from-transparent via-white/5 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />

      {/* info affordance, top-right. The button is a 44×44 touch target (icon
          stays 18px, centered) so it clears the iOS/Material minimum on phones
          — at right-2/top-2 the icon still lands in the same corner as before. */}
      <button
        type="button"
        aria-label={t("insightsv2.hero.aboutAria")}
        className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
      >
        <Icons.info size={18} stroke="currentColor" sw={1.8} />
      </button>

      <div className="relative grid grid-cols-[auto_1fr] items-center gap-3 lg:gap-8">
        {/* left — gradient gauge ring + score */}
        <div className="flex items-center gap-2.5 lg:gap-7">
          <div
            className="relative h-[72px] w-[72px] shrink-0 lg:h-[132px] lg:w-[132px]"
            style={{ filter: "drop-shadow(0 0 22px rgba(20,241,149,0.16))" }}
          >
            <svg viewBox="0 0 120 120" className="h-full w-full">
              <defs>
                <linearGradient id="rfiRing" x1="0" y1="0.5" x2="1" y2="0.5">
                  <stop offset="0%" stopColor="#14F195" />
                  <stop offset="50%" stopColor="#00C8FF" />
                  <stop offset="100%" stopColor="#9945FF" />
                </linearGradient>
              </defs>
              {/* faint full track */}
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="9"
              />
              {/* Gradient arc filled to the score's progress within its tier
                  (pathLength=100 normalizes the ~270° arc so dasharray ∝ pct). */}
              <path
                d="M24.65 95.35 A50 50 0 1 1 85 103.3"
                fill="none"
                stroke="url(#rfiRing)"
                strokeWidth="9"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray={`${pct} ${100 - pct}`}
              />
            </svg>
            {/* shield + check, centered */}
            <div className="absolute inset-0 flex items-center justify-center">
              <svg
                width="46"
                height="46"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#14F195"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2l8 3v7c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5z" />
                <path d="M8.5 12l2.4 2.4L15.6 9.6" />
              </svg>
            </div>
          </div>
          <div>
            <div
              className={`text-[2.35rem] font-black leading-[0.85] tracking-[-0.07em] text-white lg:text-[5.5rem] ${MONO}`}
            >
              {score}
            </div>
            <div className="mt-1 text-[10px] font-semibold text-[#14F195] lg:mt-2 lg:text-2xl">
              {t("insightsv2.hero.points")}
            </div>
          </div>
        </div>

        {/* right — level + progress */}
        <div className="border-white/10 lg:border-l lg:pl-10">
          <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#14F195] lg:text-sm lg:tracking-[0.18em]">
            {t("insightsv2.hero.level", { n: tier.level, name: levelName })}
          </div>
          <div className="mt-1 text-[9px] text-gray-300 lg:mt-3 lg:text-base">
            {toNext > 0 ? t("insightsv2.hero.toNext", { n: toNext }) : t("insightsv2.hero.atMax")}
          </div>
          {toNext > 0 && (
            <div className="mt-1 text-xs font-bold text-[#9945FF] lg:text-xl">{nextLevelName}</div>
          )}
          <div className="mt-2 flex items-center gap-2 lg:mt-7 lg:gap-4">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06] lg:h-2.5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#14F195] via-[#00C8FF] to-[#9945FF]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`shrink-0 text-[8px] text-gray-300 lg:text-sm ${MONO}`}>
              {score} / {nextMin}
            </span>
          </div>
        </div>
      </div>

      {/* bottom — percentile, centered across the card */}
      <div className="relative mt-7 hidden items-center justify-center gap-3 lg:flex">
        <span className="text-sm text-gray-400">{t("insightsv2.hero.betterThan")}</span>
        <span className="inline-flex items-center gap-2 rounded-full border border-[#14F195]/25 bg-[#14F195]/10 px-4 py-1.5 text-sm font-bold text-[#14F195]">
          <Icons.people size={15} stroke="#14F195" sw={2} />
          {t("insightsv2.hero.percentile", { n: percentile })}
        </span>
      </div>
    </Card>
  );
}

interface RecCard {
  key: string;
  pts: number;
  icon: string;
  color: string;
  label: string;
  cta: string;
  href: string;
}

// Friendly pool name for a devnet position (the on-chain view only carries the
// seed id) — falls back to the position's generic label.
function poolName(p: NftPosition): string {
  // Real catalog only — never the demo fixtures, so a real pool3 cota does not
  // borrow the "Renovação MEI" pitch name; falls back to the on-chain label.
  return DISCOVER_GROUPS.find((g) => g.devnetPool === p.devnetPool)?.name ?? p.group;
}

function RecommendationCards() {
  const { t } = useI18n();
  const { demoActive } = useSession();
  // Real, achievable next-steps for a real wallet, derived from its on-chain
  // cotas — the ONLY actions that actually move the score: pay on time
  // (+10 SCORE_PAYMENT), complete a pool (+50 SCORE_POOL_COMPLETE), and join
  // more pools. Demo keeps the fixture cards for the pitch; the Factors panel +
  // Score chart already gate to empty for a real wallet the same way, so the
  // recommendations were the last fixture leak here.
  const positions = useMyDevnetPositions();
  const realCards = useMemo<RecCard[]>(() => {
    const out: RecCard[] = [];
    // Featured real pools only — drop demo-twinned pools (pool3 ↔ "Renovação
    // MEI") so recommendations match what /grupos surfaces, never a pitch name.
    const demoPools = new Set(ACTIVE_GROUPS.map((g) => g.devnetPool).filter(Boolean));
    const eligible = positions.filter((p) => !p.devnetPool || !demoPools.has(p.devnetPool));
    // Pools with installments still to pay (contributionsPaid < cycles ≈ target).
    const payable = eligible.filter((p) => p.month < p.total);
    // 1. Pay on time — the pool whose next installment is due soonest.
    const due = [...payable].sort((a, b) => (a.nextDueDays ?? 999) - (b.nextDueDays ?? 999))[0];
    if (due) {
      out.push({
        key: "real-pay",
        pts: 10,
        icon: "calendar",
        color: TONE_HEX.g,
        label: t("insightsv2.next.real.pay", { pool: poolName(due) }),
        cta: t("insightsv2.next.real.pay.cta"),
        href: "/",
      });
    }
    // 2. Complete a pool — the one closest to done (biggest paid fraction).
    const toComplete = [...payable].sort((a, b) => b.month / b.total - a.month / a.total)[0];
    if (toComplete) {
      out.push({
        key: "real-complete",
        pts: 50,
        icon: "trophy",
        color: TONE_HEX.p,
        label: t("insightsv2.next.real.complete", {
          pool: poolName(toComplete),
          n: toComplete.total - toComplete.month,
        }),
        cta: t("insightsv2.next.real.complete.cta"),
        href: "/",
      });
    }
    // 3. Join another real group — /grupos lists the actually-available pools.
    out.push({
      key: "real-join",
      pts: 10,
      icon: "people",
      color: TONE_HEX.t,
      label: eligible.length ? t("insightsv2.next.real.join") : t("insightsv2.next.real.joinFirst"),
      cta: t("insightsv2.next.real.join.cta"),
      href: "/grupos",
    });
    return out;
  }, [positions, t]);

  const cards: RecCard[] = demoActive
    ? RECOMMENDATIONS.map((rec) => ({
        key: rec.key,
        pts: rec.pts,
        icon: REC_META[rec.key].icon,
        color: TONE_HEX[rec.tone],
        label: t(`insightsv2.next.${rec.key}.label`),
        cta: t(`insightsv2.next.${rec.key}.cta`),
        href: REC_META[rec.key].href,
      }))
    : realCards;

  if (cards.length === 0) return null;

  return (
    <Card className="p-3 lg:p-5">
      <MonoTitle>{t("insightsv2.next.title")}</MonoTitle>
      <div className="mt-3 grid gap-2 lg:mt-5 lg:grid-cols-3 lg:gap-4">
        {cards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-all duration-300 hover:border-white/25 lg:rounded-2xl lg:p-5 lg:hover:-translate-y-0.5"
          >
            <div
              className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-20 blur-3xl"
              style={{ backgroundColor: card.color }}
            />
            {/* icon + points share the top row (per the print) */}
            <div className="relative flex items-center gap-3">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full lg:h-11 lg:w-11"
                style={{ backgroundColor: `${card.color}1f`, border: `1px solid ${card.color}33` }}
              >
                <Glyph name={card.icon} color={card.color} size={22} sw={1.9} />
              </div>
              <div
                className={`text-xl font-black tracking-[-0.05em] lg:text-3xl ${MONO}`}
                style={{ color: card.color }}
              >
                {t("insightsv2.pts", { n: card.pts })}
              </div>
            </div>
            {/* min-height keeps the CTAs aligned across the three cards */}
            <div className="relative mt-2 text-[12px] font-semibold leading-snug text-white lg:mt-4 lg:min-h-[44px] lg:text-base">
              {card.label}
            </div>
            <div
              className="relative mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-[10px] font-black text-[#06110D] lg:mt-5 lg:rounded-xl lg:px-4 lg:py-3 lg:text-sm"
              style={{
                background: `linear-gradient(135deg, ${card.color}, ${card.color === TONE_HEX.g ? "#00C8FF" : card.color})`,
              }}
            >
              {card.cta}
              <span className="transition-transform group-hover:translate-x-1">
                <Icons.arrow size={16} stroke="#06110D" sw={2.4} />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function FactorRow({ factor, statusKey }: { factor: BehaviorFactor; statusKey?: FactorStatus }) {
  const { t } = useI18n();
  const meta = FACTOR_META[factor.key];
  const color = TONE_HEX[factor.tone];
  const [open, setOpen] = useState(false);
  const label = t(`insights.factor.${factor.key}.label`);
  // Real factors carry a status derived from their live value; demo fixtures
  // fall back to the per-factor static status.
  const status = t(`insightsv2.status.${statusKey ?? meta.statusKey}`);
  return (
    <div
      className="rounded-xl border border-white/10 bg-white/[0.025] p-3 transition-all duration-200 lg:rounded-2xl lg:px-4 lg:py-4"
      {...liftHover(color, "rgba(255,255,255,0.1)")}
    >
      {/* header — the whole row toggles the detail */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 text-left lg:gap-4"
      >
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl lg:h-12 lg:w-12 lg:rounded-2xl"
          style={{ backgroundColor: `${color}1c`, border: `1px solid ${color}3a` }}
        >
          <Glyph name={meta.icon} color={color} size={22} sw={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold text-white lg:text-base">{label}</div>
          <div className="truncate text-[9px] text-gray-400 lg:text-sm">
            {t(`insightsv2.factor.${factor.key}.desc`)}
          </div>
        </div>
        <div className="hidden h-2 flex-[1.25] overflow-hidden rounded-full bg-white/5 lg:block">
          <div
            className="h-full rounded-full"
            style={{
              width: `${factor.value}%`,
              backgroundColor: color,
              boxShadow: `0 0 18px ${color}55`,
            }}
          />
        </div>
        <div
          className={`w-10 text-right text-xl font-black tracking-[-0.06em] lg:w-14 lg:text-3xl ${MONO}`}
          style={{ color }}
        >
          {factor.value}
        </div>
        <div className="hidden w-28 text-sm font-semibold lg:block" style={{ color }}>
          {status}
        </div>
        <span
          className="shrink-0 text-gray-500 transition-transform duration-300"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <Glyph name="chevronDown" color="currentColor" size={18} sw={2} />
        </span>
      </button>

      {/* expandable detail — what the signal measures + how to improve it */}
      <div
        className={`grid transition-all duration-300 ${
          open ? "mt-4 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-white/10 pt-4">
            {/* on small screens the status/value hide in the header — show them here */}
            <div className="mb-3 flex items-center gap-2 lg:hidden">
              <span className="text-sm font-semibold" style={{ color }}>
                {status}
              </span>
              <span className="text-xs text-gray-500">· {factor.value}/100</span>
            </div>
            <p className="text-sm leading-relaxed text-gray-400">
              {t(`insightsv2.factor.${factor.key}.long`)}
            </p>
            <div
              className="mt-3 flex items-start gap-2.5 rounded-xl border px-3.5 py-3"
              style={{ borderColor: `${color}33`, background: `${color}12` }}
            >
              <span className="mt-0.5 shrink-0">
                <Glyph name="spark" color={color} size={16} sw={1.9} />
              </span>
              <p className="text-[13px] leading-relaxed text-white/80">
                <span className="font-bold" style={{ color }}>
                  {t("insightsv2.factors.improve")}
                </span>
                {t(`insightsv2.factor.${factor.key}.tip`)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FactorsPanel({ insights }: { insights: ScoreInsights }) {
  const { t } = useI18n();
  const { demoActive } = useSession();
  // Demo keeps the fixture breakdown for the pitch; a real wallet gets factors
  // computed from its on-chain reputation counters (empty until it has signal).
  const factors = demoActive ? FACTORS : insights.factors;
  const loading = !demoActive && insights.status === "loading";
  return (
    <Card className="p-3 lg:p-5">
      <div className="flex items-center gap-2">
        <MonoTitle>{t("insightsv2.factors.title")}</MonoTitle>
        <Icons.info size={14} stroke="#14F195" sw={1.8} />
      </div>
      <div className="mt-3 grid gap-2 lg:mt-5 lg:gap-3">
        {factors.length > 0 ? (
          factors.map((factor) => (
            <FactorRow
              key={factor.key}
              factor={factor}
              statusKey={demoActive ? undefined : (factor as RealFactor).statusKey}
            />
          ))
        ) : loading ? (
          <p className="px-1 text-sm leading-relaxed text-gray-400">{t("insightsv2.loading")}</p>
        ) : (
          <p className="px-1 text-sm leading-relaxed text-gray-400">
            {t("insightsv2.factors.empty")}
          </p>
        )}
      </div>
    </Card>
  );
}

// Demo (pitch) chart: the synthetic climbing curve + fixed tier guides. Only
// rendered in demo mode, so the curve is always present.
function DemoScoreChart() {
  const { lang, t } = useI18n();
  const [range, setRange] = useState<ScoreRange>(DEFAULT_RANGE);
  const points = curveForRange(range);
  const hasCurve = points.length > 0;
  // Month labels derived from today's date, so "1M" always ends on the current
  // month instead of the old hardcoded "…Abr" that drifted out of date.
  const months = scoreMonths(RANGE_MONTHS[range], lang);
  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `0,220 ${line} 600,220`;
  const lastPoint = points[points.length - 1];
  // The dot shares the full-bleed plot area (inset-0), so the exact curve-end
  // percentage lands it on the line. A clamp keeps it ~8px inside the rounded
  // box so the glow isn't clipped at the right edge.
  const dotLeft = lastPoint ? (lastPoint[0] / 600) * 100 : 100;
  const dotTop = lastPoint ? (lastPoint[1] / 220) * 100 : 0;

  return (
    <Card className="p-3 lg:p-7">
      <div className="flex items-center justify-between gap-4">
        <MonoTitle>{t("insightsv2.chart.title")}</MonoTitle>
        <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5 lg:rounded-2xl lg:p-1">
          {SCORE_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1.5 text-[9px] font-bold transition-all lg:rounded-xl lg:px-4 lg:py-2 lg:text-xs ${range === r ? "bg-[#14F195] text-[#04130D]" : "text-gray-400 hover:text-white"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-3 h-[210px] overflow-hidden rounded-xl border border-white/[0.06] bg-[#070B11] lg:mt-7 lg:h-[340px] lg:rounded-2xl">
        {/* tier guides — behind the curve, spanning the full box width */}
        <div className="pointer-events-none absolute inset-x-0 top-[20%] border-t border-dashed border-[#9945FF]/45" />
        <div className="pointer-events-none absolute inset-x-0 top-[48%] border-t border-dashed border-[#14F195]/40" />
        <div className="pointer-events-none absolute inset-x-0 top-[76%] border-t border-dashed border-[#00C8FF]/35" />

        {/* plot area — full-bleed so the fill + line reach every edge of the
            box; the end dot shares this same coordinate space */}
        <div className="absolute inset-0">
          {hasCurve ? (
            <>
              <svg
                viewBox="0 0 600 220"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
              >
                <defs>
                  <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14F195" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#14F195" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <polygon points={area} fill="url(#scoreFill)" />
                <polyline
                  points={line}
                  fill="none"
                  stroke="#14F195"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {lastPoint && (
                <div
                  className="absolute z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#14F195]"
                  style={{
                    left: `clamp(8px, ${dotLeft}%, calc(100% - 8px))`,
                    top: `clamp(8px, ${dotTop}%, calc(100% - 8px))`,
                    boxShadow: "0 0 16px 5px rgba(20,241,149,0.5)",
                  }}
                />
              )}
            </>
          ) : (
            <div className="absolute inset-0 z-10 flex items-center justify-center px-10 text-center">
              <p className="max-w-sm text-sm leading-relaxed text-gray-400">
                {t("insightsv2.chart.empty")}
              </p>
            </div>
          )}
        </div>

        {/* tier labels — on top, the bg chip masks the dashed line behind */}
        <span
          className={`absolute left-5 top-[20%] z-10 -translate-y-1/2 bg-[#070B11] pr-3 text-[11px] leading-none text-[#9945FF] ${MONO}`}
        >
          {t("insightsv2.tier.lv4")}
        </span>
        <span
          className={`absolute left-5 top-[48%] z-10 -translate-y-1/2 bg-[#070B11] pr-3 text-[11px] leading-none text-[#14F195] ${MONO}`}
        >
          {t("insightsv2.tier.lv3")}
        </span>
        <span
          className={`absolute left-5 top-[76%] z-10 -translate-y-1/2 bg-[#070B11] pr-3 text-[11px] leading-none text-[#00C8FF] ${MONO}`}
        >
          {t("insightsv2.tier.lv2")}
        </span>

        {/* month axis — aligned to the full-bleed curve. Hidden without a curve
            so an empty real-mode plot doesn't show months implying data. */}
        {hasCurve && (
          <div className="absolute inset-x-2 bottom-2 flex justify-between text-[9px] text-gray-500 lg:bottom-3 lg:text-xs">
            {months.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// Real chart: the wallet's actual score trajectory, reconstructed from on-chain
// payment timestamps and anchored to its true current score. Auto-scales to the
// curve so even a small low-score climb is visible; tier guides appear only
// where a threshold lands in view, and the next-tier goal is a caption.
function RealScoreChart({ insights }: { insights: ScoreInsights }) {
  const { lang, t } = useI18n();
  const { history, currentScore, status } = insights;
  const hasCurve = history.length >= 2;
  // Which vertex's tooltip is open (hover on desktop, tap on mobile).
  const [active, setActive] = useState<number | null>(null);

  const nextTier = PASSPORT_TIERS.find((tt) => tt.min > currentScore);
  const { yMin, yMax } = useMemo(
    () => (hasCurve ? scoreScale(history) : { yMin: 0, yMax: 1 }),
    [history, hasCurve],
  );

  const geom = useMemo(() => {
    if (!hasCurve) return null;
    const n = history.length;
    const ySpan = yMax - yMin || 1;
    // Inset the plot so the curve + end dot / labels clear the rounded box
    // edges. X is spaced PER EVENT (not linear in time): on devnet every
    // payment lands within days of the join, so a time axis piled them all at
    // the right edge (the long flat line in the report). Even spacing gives
    // each step its own room, turning the curve into a legible staircase; the
    // real dates live under each vertex + in the tooltip.
    const PAD_X = 26;
    const PAD_Y = 20;
    const xOf = (i: number) => PAD_X + (n === 1 ? 0.5 : i / (n - 1)) * (600 - 2 * PAD_X);
    const yOf = (s: number) => PAD_Y + (1 - (s - yMin) / ySpan) * (220 - 2 * PAD_Y);
    const coords = history.map((p, i) => {
      const x = xOf(i);
      const y = yOf(p.score);
      return { i, p, x, y, xPct: (x / 600) * 100, yPct: (y / 220) * 100 };
    });
    const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
    const first = coords[0]!;
    const last = coords[coords.length - 1]!;
    // Tier thresholds that fall inside the visible window get a guide line.
    const guides = PASSPORT_TIERS.filter((tt) => tt.min > yMin && tt.min < yMax).map((tt) => ({
      level: tt.level,
      min: tt.min,
      topPct: (yOf(tt.min) / 220) * 100,
      name: t(TIER_KEYS[tt.level]),
    }));
    // Round score gridlines spanning the window — gives the Y-axis a real scale
    // even when no tier guide is in view (a sub-tier wallet). Drop any tick that
    // would land on a tier guide so the two labels don't stack.
    const yTicks = niceScoreTicks(yMin, yMax)
      .filter((v) => !guides.some((g) => Math.abs(g.min - v) < ySpan * 0.06))
      .map((value) => ({ value, topPct: (yOf(value) / 220) * 100 }));
    // Thin the x-axis date labels + delta chips when there are many events so
    // they don't overlap; always keep the first + last vertex labelled.
    const labelEvery = n <= 7 ? 1 : Math.ceil(n / 6);
    const showChips = n <= 24;
    return {
      coords,
      line,
      area: `${first.x},220 ${line} ${last.x},220`,
      last,
      guides,
      yTicks,
      labelEvery,
      showChips,
    };
  }, [hasCurve, history, yMin, yMax, t]);

  // Map an event kind → its i18n base key; the tooltip appends the pool when
  // known. Covers the full on-chain scoring set (payment / late / default /
  // pool-complete) so a dip reads as clearly as a climb.
  const KIND_KEY: Record<string, string> = {
    join: "insightsv2.chart.ev.join",
    payment: "insightsv2.chart.ev.payment",
    late: "insightsv2.chart.ev.late",
    default: "insightsv2.chart.ev.default",
    cycle: "insightsv2.chart.ev.cycle",
    neglect: "insightsv2.chart.ev.neglect",
  };
  const reasonFor = (p: ScorePoint) => {
    const base = KIND_KEY[p.kind ?? "payment"] ?? "insightsv2.chart.ev.payment";
    return p.poolName && p.kind !== "join"
      ? `${t(base)} · ${p.poolName}`
      : p.kind === "join" && p.poolName
        ? t("insightsv2.chart.ev.joinPool", { pool: p.poolName })
        : t(base);
  };
  // Signed, coloured delta label ("+10" green / "−100" red) — an increase reads
  // green, a late/default penalty reads red.
  const fmtDelta = (d: number) => (d > 0 ? `+${d}` : `${d}`);

  return (
    <Card className="p-3 lg:p-7">
      <div className="flex items-center justify-between gap-4">
        <MonoTitle>{t("insightsv2.chart.title")}</MonoTitle>
        {hasCurve && (
          <span className={`text-xs text-gray-400 ${MONO}`}>
            {nextTier
              ? t("insightsv2.chart.toNext", {
                  n: nextTier.min - currentScore,
                  tier: t(TIER_KEYS[nextTier.level]),
                })
              : t("insightsv2.chart.max")}
          </span>
        )}
      </div>
      <div
        className="relative mt-3 h-[210px] overflow-hidden rounded-xl border border-white/[0.06] bg-[#070B11] lg:mt-7 lg:h-[340px] lg:rounded-2xl"
        onMouseLeave={() => setActive(null)}
      >
        {hasCurve && geom ? (
          <>
            {/* neutral score gridlines — drawn first, so tier guides + the curve
                render on top of them */}
            {geom.yTicks.map((tk) => (
              <div
                key={`grid-${tk.value}`}
                className="pointer-events-none absolute inset-x-0 border-t border-white/[0.05]"
                style={{ top: `${tk.topPct}%` }}
              />
            ))}
            {geom.guides.map((g) => (
              <div
                key={g.level}
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[#14F195]/35"
                style={{ top: `${g.topPct}%` }}
              />
            ))}
            <div className="absolute inset-0">
              <svg
                viewBox="0 0 600 220"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
              >
                <defs>
                  <linearGradient id="scoreFillReal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14F195" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#14F195" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <polygon points={geom.area} fill="url(#scoreFillReal)" />
                <polyline
                  points={geom.line}
                  fill="none"
                  stroke="#14F195"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              {/* Per-vertex markers — one dot per real on-chain event. Hover
                  (or tap on mobile) opens the tooltip explaining the step. */}
              {geom.coords.map((c) => {
                const isLast = c.i === geom.coords.length - 1;
                const on = active === c.i;
                return (
                  <button
                    key={`dot-${c.i}`}
                    type="button"
                    aria-label={reasonFor(c.p)}
                    className="absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none"
                    style={{
                      left: `clamp(6px, ${c.xPct}%, calc(100% - 6px))`,
                      top: `clamp(6px, ${c.yPct}%, calc(100% - 6px))`,
                    }}
                    onMouseEnter={() => setActive(c.i)}
                    onFocus={() => setActive(c.i)}
                    onClick={() => setActive((prev) => (prev === c.i ? null : c.i))}
                  >
                    <span
                      className="block rounded-full transition-all"
                      style={{
                        width: on || isLast ? 12 : 8,
                        height: on || isLast ? 12 : 8,
                        // A penalty vertex (late / default → negative step) reads
                        // red; a climb reads green.
                        backgroundColor: (c.p.delta ?? 0) < 0 ? "#FF3B8D" : "#14F195",
                        boxShadow:
                          on || isLast
                            ? `0 0 16px 5px ${(c.p.delta ?? 0) < 0 ? "rgba(255,59,141,0.5)" : "rgba(20,241,149,0.5)"}`
                            : "0 0 0 3px rgba(7,11,17,1)",
                      }}
                    />
                  </button>
                );
              })}

              {/* Always-visible delta chip above each step vertex — the user
                  reads how much each event moved the score without hovering.
                  "+10" green for a climb, "−100" red for a late/default penalty.
                  Skipped on the baseline (delta 0) and when crowded. */}
              {geom.showChips &&
                geom.coords.map((c) => {
                  const d = c.p.delta ?? 0;
                  if (c.i === 0 || d === 0) return null;
                  const down = d < 0;
                  return (
                    <div
                      key={`chip-${c.i}`}
                      className={`pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none ${MONO}`}
                      style={{
                        left: `clamp(16px, ${c.xPct}%, calc(100% - 16px))`,
                        top: `calc(clamp(6px, ${c.yPct}%, calc(100% - 6px)) - 10px)`,
                        color: down ? "#FF3B8D" : "#14F195",
                        borderColor: down ? "rgba(255,59,141,0.25)" : "rgba(20,241,149,0.25)",
                        backgroundColor: down ? "#210A16" : "#0A1F17",
                      }}
                    >
                      {fmtDelta(d)}
                    </div>
                  );
                })}

              {/* current-score badge pinned just left of the end dot — ties the
                  line's tip to the wallet's real on-chain score */}
              <div
                className={`pointer-events-none absolute z-30 rounded-md border border-[#14F195]/30 bg-[#0A1F17] px-1.5 py-0.5 text-[11px] font-bold leading-none text-[#14F195] ${MONO}`}
                style={{
                  left: `clamp(8px, ${geom.last.xPct}%, calc(100% - 8px))`,
                  top: `clamp(8px, ${geom.last.yPct}%, calc(100% - 8px))`,
                  transform: "translate(calc(-100% - 12px), -50%)",
                }}
              >
                {currentScore}
              </div>

              {/* Tooltip for the active vertex — the WHY behind the step:
                  reason, exact timestamp, and score before → after. */}
              {active != null && geom.coords[active]
                ? (() => {
                    const c = geom.coords[active]!;
                    const prev = active > 0 ? history[active - 1]! : null;
                    const below = c.yPct < 34; // flip under the dot near the top edge
                    return (
                      <div
                        className={`pointer-events-none absolute z-40 w-max max-w-[220px] -translate-x-1/2 rounded-lg border border-white/10 bg-[#0A1017] px-3 py-2 shadow-xl ${MONO}`}
                        style={{
                          left: `clamp(96px, ${c.xPct}%, calc(100% - 96px))`,
                          top: below
                            ? `calc(clamp(6px, ${c.yPct}%, calc(100% - 6px)) + 16px)`
                            : `calc(clamp(6px, ${c.yPct}%, calc(100% - 6px)) - 16px)`,
                          transform: below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
                        }}
                      >
                        <div className="text-[12px] font-bold leading-tight text-white">
                          {reasonFor(c.p)}
                        </div>
                        <div className="mt-1 text-[10px] leading-none text-gray-400">
                          {formatDayTime(c.p.t, lang)}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] leading-none">
                          {prev ? (
                            <>
                              <span className="text-gray-500">{prev.score}</span>
                              <span className="text-gray-600">→</span>
                              <span className="font-bold text-[#14F195]">{c.p.score}</span>
                              {(c.p.delta ?? 0) !== 0 && (
                                <span
                                  className="ml-1 font-bold"
                                  style={{ color: (c.p.delta ?? 0) < 0 ? "#FF3B8D" : "#14F195" }}
                                >
                                  {fmtDelta(c.p.delta ?? 0)}
                                </span>
                              )}
                              <span className="ml-0.5 text-gray-500">pts</span>
                            </>
                          ) : (
                            <span className="text-[#14F195]">
                              {t("insightsv2.chart.ev.start", { score: c.p.score })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()
                : null}
            </div>

            {/* Y-axis score labels — neutral, the bg chip masks the gridline behind */}
            {geom.yTicks.map((tk) => (
              <span
                key={`lbl-${tk.value}`}
                className={`pointer-events-none absolute left-5 z-10 -translate-y-1/2 bg-[#070B11] pr-2 text-[10px] leading-none text-gray-500 ${MONO}`}
                style={{ top: `${tk.topPct}%` }}
              >
                {tk.value}
              </span>
            ))}
            {geom.guides.map((g) => (
              <span
                key={g.level}
                className={`pointer-events-none absolute left-5 z-10 -translate-y-1/2 bg-[#070B11] pr-3 text-[11px] leading-none text-[#14F195] ${MONO}`}
                style={{ top: `${g.topPct}%` }}
              >
                {g.name} • {g.min}
              </span>
            ))}
            {/* Y-axis title */}
            <span
              className={`pointer-events-none absolute left-4 top-3 z-10 text-[9px] uppercase tracking-[0.2em] text-gray-600 ${MONO}`}
            >
              {t("insightsv2.chart.yAxis")}
            </span>

            {/* X-axis: a date tick under each event vertex (thinned when many)
                — the "subdivisões do eixo x" so each step is anchored to a real
                date instead of only the first/last endpoints. */}
            {geom.coords.map((c) => {
              const show =
                c.i === 0 || c.i === geom.coords.length - 1 || c.i % geom.labelEvery === 0;
              return show ? (
                <span
                  key={`x-${c.i}`}
                  className={`pointer-events-none absolute bottom-2 z-10 -translate-x-1/2 text-[10px] leading-none text-gray-500 ${MONO}`}
                  style={{ left: `clamp(18px, ${c.xPct}%, calc(100% - 18px))` }}
                >
                  {formatDayMon(c.p.t, lang)}
                </span>
              ) : null;
            })}
          </>
        ) : (
          <div className="absolute inset-0 z-10 flex items-center justify-center px-10 text-center">
            <p className="max-w-sm text-sm leading-relaxed text-gray-400">
              {status === "loading" ? t("insightsv2.loading") : t("insightsv2.chart.empty")}
            </p>
          </div>
        )}
      </div>
      {hasCurve && (
        <p className={`mt-3 text-center text-[11px] text-gray-500 ${MONO}`}>
          {t("insightsv2.chart.hint")}
        </p>
      )}
    </Card>
  );
}

// Demo → the pitch fixture chart; real wallet → its actual on-chain trajectory.
function ScoreChart({ insights }: { insights: ScoreInsights }) {
  const { demoActive } = useSession();
  return demoActive ? <DemoScoreChart /> : <RealScoreChart insights={insights} />;
}

const MOBILE_MISSIONS = [
  { label: "Pague 2 parcelas no prazo", reward: "+20 pts", progress: "0/2", tone: "#14F195" },
  { label: "Complete um ciclo", reward: "+50 pts", progress: "0/1", tone: "#9945FF" },
  { label: "Entre em um novo grupo", reward: "+10 pts", progress: "0/1", tone: "#00C8FF" },
];

function MobileMissions() {
  return (
    <MobileInsightDisclosure title="Missões" summary="Objetivos simples para evoluir">
      <div className="space-y-2">
        {MOBILE_MISSIONS.map((mission) => (
          <div
            key={mission.label}
            className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3"
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ color: mission.tone, backgroundColor: `${mission.tone}14` }}
            >
              <Glyph name="target" color="currentColor" size={15} sw={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-white">{mission.label}</p>
              <p className="mt-0.5 text-[9px] text-gray-500">{mission.progress}</p>
            </div>
            <span className={`text-[10px] font-black ${MONO}`} style={{ color: mission.tone }}>
              {mission.reward}
            </span>
          </div>
        ))}
      </div>
    </MobileInsightDisclosure>
  );
}

function MobileScoreExplanation() {
  return (
    <MobileInsightDisclosure
      title="Como seu score funciona"
      summary="Critérios, pesos e atualização do Passport"
    >
      <div className="space-y-2 px-1 pb-1 text-[10px] leading-relaxed text-gray-400">
        <p>Pagamentos pontuais e ciclos concluídos aumentam sua reputação.</p>
        <p>Atrasos e inadimplência reduzem o score e podem limitar o acesso a novos grupos.</p>
        <p>O histórico é atualizado com os eventos registrados no seu Passport on-chain.</p>
      </div>
    </MobileInsightDisclosure>
  );
}

export default function InsightsPage() {
  const { t } = useI18n();
  // Real on-chain factors + score curve, read once and shared by both panels
  // (demo mode ignores it and renders the fixtures).
  const insights = useScoreInsights();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-3 font-sans text-white animate-in fade-in duration-700 lg:gap-6 lg:p-8">
      <header className="flex items-end justify-between gap-6">
        <div>
          <MonoTitle>{t("insightsv2.badge")}</MonoTitle>
          <h1 className="mt-1.5 text-lg font-black tracking-[-0.04em] text-white [font-family:var(--font-syne),sans-serif] lg:mt-4 lg:text-5xl lg:tracking-[-0.05em]">
            <span className="lg:hidden">Insights do seu score</span>
            <span className="hidden lg:inline">{t("insights.title")}</span>
          </h1>
          <p className="mt-3 hidden text-base text-gray-400 lg:block">{t("insights.subtitle")}</p>
        </div>
      </header>

      <main className="flex flex-col gap-3 lg:hidden">
        <ScoreHero />
        <ScoreChart insights={insights} />
        <MobileInsightDisclosure
          title="Principais fatores"
          summary="O que aumentou ou reduziu seu score"
          defaultOpen
        >
          <FactorsPanel insights={insights} />
        </MobileInsightDisclosure>
        <MobileInsightDisclosure
          title="Ações recomendadas"
          summary="Prioridades para aumentar seu score"
        >
          <RecommendationCards />
        </MobileInsightDisclosure>
        <MobileMissions />
        <MobileScoreExplanation />
      </main>

      <main className="hidden flex-col gap-6 lg:flex">
        <ScoreHero />
        <ScoreChart insights={insights} />
        <FactorsPanel insights={insights} />
        <RecommendationCards />
      </main>
    </div>
  );
}
