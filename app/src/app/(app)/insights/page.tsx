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
      className={`rounded-[1.75rem] border border-white/10 bg-[#0B111A]/80 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-[#14F195]/25 hover:shadow-[0_28px_90px_rgba(0,0,0,0.4),0_0_44px_rgba(20,241,149,0.09)] ${className}`}
    >
      {children}
    </section>
  );
}

function MonoTitle({ children, color = "#14F195" }: { children: React.ReactNode; color?: string }) {
  return (
    <div
      className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em]"
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
    <Card className="group relative overflow-hidden p-7 md:p-8">
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

      <div className="relative grid items-center gap-8 md:grid-cols-[auto_1fr]">
        {/* left — gradient gauge ring + score */}
        <div className="flex items-center gap-7">
          <div
            className="relative h-[132px] w-[132px] shrink-0"
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
              className={`text-[5.5rem] font-black leading-[0.85] tracking-[-0.07em] text-white ${MONO}`}
            >
              {score}
            </div>
            <div className="mt-2 text-2xl font-semibold text-[#14F195]">
              {t("insightsv2.hero.points")}
            </div>
          </div>
        </div>

        {/* right — level + progress */}
        <div className="border-white/10 md:border-l md:pl-10">
          <div className="text-sm font-black uppercase tracking-[0.18em] text-[#14F195]">
            {t("insightsv2.hero.level", { n: tier.level, name: levelName })}
          </div>
          <div className="mt-3 text-base text-gray-300">
            {toNext > 0 ? t("insightsv2.hero.toNext", { n: toNext }) : t("insightsv2.hero.atMax")}
          </div>
          {toNext > 0 && (
            <div className="mt-1 text-xl font-bold text-[#9945FF]">{nextLevelName}</div>
          )}
          <div className="mt-7 flex items-center gap-4">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#14F195] via-[#00C8FF] to-[#9945FF]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`shrink-0 text-sm text-gray-300 ${MONO}`}>
              {score} / {nextMin}
            </span>
          </div>
        </div>
      </div>

      {/* bottom — percentile, centered across the card */}
      <div className="relative mt-7 flex items-center justify-center gap-3">
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
  return (
    [...ACTIVE_GROUPS, ...DISCOVER_GROUPS].find((g) => g.devnetPool === p.devnetPool)?.name ??
    p.group
  );
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
    // Pools with installments still to pay (contributionsPaid < cycles ≈ target).
    const payable = positions.filter((p) => p.month < p.total);
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
      label: positions.length
        ? t("insightsv2.next.real.join")
        : t("insightsv2.next.real.joinFirst"),
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
    <Card className="p-4 md:p-5">
      <MonoTitle>{t("insightsv2.next.title")}</MonoTitle>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/25"
          >
            <div
              className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-20 blur-3xl"
              style={{ backgroundColor: card.color }}
            />
            {/* icon + points share the top row (per the print) */}
            <div className="relative flex items-center gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: `${card.color}1f`, border: `1px solid ${card.color}33` }}
              >
                <Glyph name={card.icon} color={card.color} size={22} sw={1.9} />
              </div>
              <div
                className={`text-3xl font-black tracking-[-0.05em] ${MONO}`}
                style={{ color: card.color }}
              >
                {t("insightsv2.pts", { n: card.pts })}
              </div>
            </div>
            {/* min-height keeps the CTAs aligned across the three cards */}
            <div className="relative mt-4 min-h-[44px] text-base font-semibold leading-snug text-white">
              {card.label}
            </div>
            <div
              className="relative mt-5 flex items-center justify-between rounded-xl px-4 py-3 text-sm font-black text-[#06110D]"
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
      className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-4 transition-all duration-200"
      {...liftHover(color, "rgba(255,255,255,0.1)")}
    >
      {/* header — the whole row toggles the detail */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 text-left"
      >
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `${color}1c`, border: `1px solid ${color}3a` }}
        >
          <Glyph name={meta.icon} color={color} size={22} sw={2} />
        </div>
        <div className="min-w-[150px] flex-1">
          <div className="text-base font-bold text-white">{label}</div>
          <div className="text-sm text-gray-400">{t(`insightsv2.factor.${factor.key}.desc`)}</div>
        </div>
        <div className="hidden h-2 flex-[1.25] overflow-hidden rounded-full bg-white/5 md:block">
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
          className={`w-14 text-right text-3xl font-black tracking-[-0.06em] ${MONO}`}
          style={{ color }}
        >
          {factor.value}
        </div>
        <div className="hidden w-28 text-sm font-semibold md:block" style={{ color }}>
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
            <div className="mb-3 flex items-center gap-2 md:hidden">
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
    <Card className="p-4 md:p-5">
      <div className="flex items-center gap-2">
        <MonoTitle>{t("insightsv2.factors.title")}</MonoTitle>
        <Icons.info size={14} stroke="#14F195" sw={1.8} />
      </div>
      <div className="mt-5 grid gap-3">
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
    <Card className="p-5 md:p-7">
      <div className="flex items-center justify-between gap-4">
        <MonoTitle>{t("insightsv2.chart.title")}</MonoTitle>
        <div className="flex rounded-2xl border border-white/10 bg-white/[0.03] p-1">
          {SCORE_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${range === r ? "bg-[#14F195] text-[#04130D]" : "text-gray-400 hover:text-white"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-7 h-[340px] overflow-hidden rounded-2xl border border-white/[0.06] bg-[#070B11]">
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
          <div className="absolute inset-x-2 bottom-3 flex justify-between text-xs text-gray-500">
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

  const nextTier = PASSPORT_TIERS.find((tt) => tt.min > currentScore);
  const { yMin, yMax } = useMemo(
    () => (hasCurve ? scoreScale(history) : { yMin: 0, yMax: 1 }),
    [history, hasCurve],
  );

  const geom = useMemo(() => {
    if (!hasCurve) return null;
    const t0 = history[0]!.t;
    const tEnd = history[history.length - 1]!.t;
    const tSpan = tEnd - t0 || 1;
    const ySpan = yMax - yMin || 1;
    // Inset the plot so the curve + end dot clear the rounded box edges — and
    // so the dot lands exactly on the line tip instead of being clamped ~8px
    // inward of a full-bleed right edge (the "bolinha deslocada").
    const PAD_X = 18;
    const PAD_Y = 16;
    const xOf = (tt: number) => PAD_X + ((tt - t0) / tSpan) * (600 - 2 * PAD_X);
    const yOf = (s: number) => PAD_Y + (1 - (s - yMin) / ySpan) * (220 - 2 * PAD_Y);
    const coords = history.map((p) => [xOf(p.t), yOf(p.score)] as const);
    const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
    const last = coords[coords.length - 1]!;
    const first = coords[0]!;
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
    return { t0, tEnd, line, area: `${first[0]},220 ${line} ${last[0]},220`, last, guides, yTicks };
  }, [hasCurve, history, yMin, yMax, t]);

  return (
    <Card className="p-5 md:p-7">
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
      <div className="relative mt-7 h-[340px] overflow-hidden rounded-2xl border border-white/[0.06] bg-[#070B11]">
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
              <div
                className="absolute z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#14F195]"
                style={{
                  left: `clamp(8px, ${(geom.last[0] / 600) * 100}%, calc(100% - 8px))`,
                  top: `clamp(8px, ${(geom.last[1] / 220) * 100}%, calc(100% - 8px))`,
                  boxShadow: "0 0 16px 5px rgba(20,241,149,0.5)",
                }}
              />
              {/* current-score badge pinned just left of the end dot — ties the
                  line's tip to the wallet's real on-chain score */}
              <div
                className={`absolute z-30 rounded-md border border-[#14F195]/30 bg-[#0A1F17] px-1.5 py-0.5 text-[11px] font-bold leading-none text-[#14F195] ${MONO}`}
                style={{
                  left: `clamp(8px, ${(geom.last[0] / 600) * 100}%, calc(100% - 8px))`,
                  top: `clamp(8px, ${(geom.last[1] / 220) * 100}%, calc(100% - 8px))`,
                  transform: "translate(calc(-100% - 10px), -50%)",
                }}
              >
                {currentScore}
              </div>
            </div>
            {/* Y-axis score labels — neutral, the bg chip masks the gridline behind */}
            {geom.yTicks.map((tk) => (
              <span
                key={`lbl-${tk.value}`}
                className={`absolute left-5 z-10 -translate-y-1/2 bg-[#070B11] pr-2 text-[10px] leading-none text-gray-500 ${MONO}`}
                style={{ top: `${tk.topPct}%` }}
              >
                {tk.value}
              </span>
            ))}
            {geom.guides.map((g) => (
              <span
                key={g.level}
                className={`absolute left-5 z-10 -translate-y-1/2 bg-[#070B11] pr-3 text-[11px] leading-none text-[#14F195] ${MONO}`}
                style={{ top: `${g.topPct}%` }}
              >
                {g.name} • {g.min}
              </span>
            ))}
            {/* Y-axis title */}
            <span
              className={`absolute left-4 top-3 z-10 text-[9px] uppercase tracking-[0.2em] text-gray-600 ${MONO}`}
            >
              {t("insightsv2.chart.yAxis")}
            </span>
            <div className="absolute inset-x-4 bottom-3 flex justify-between text-xs text-gray-500">
              <span>{formatDayMon(geom.t0, lang)}</span>
              <span>{formatDayMon(geom.tEnd, lang)}</span>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 z-10 flex items-center justify-center px-10 text-center">
            <p className="max-w-sm text-sm leading-relaxed text-gray-400">
              {status === "loading" ? t("insightsv2.loading") : t("insightsv2.chart.empty")}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

// Demo → the pitch fixture chart; real wallet → its actual on-chain trajectory.
function ScoreChart({ insights }: { insights: ScoreInsights }) {
  const { demoActive } = useSession();
  return demoActive ? <DemoScoreChart /> : <RealScoreChart insights={insights} />;
}

export default function InsightsPage() {
  const { t } = useI18n();
  // Real on-chain factors + score curve, read once and shared by both panels
  // (demo mode ignores it and renders the fixtures).
  const insights = useScoreInsights();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 font-sans text-white animate-in fade-in duration-700 md:p-8">
      <header className="flex items-end justify-between gap-6">
        <div>
          <MonoTitle>{t("insightsv2.badge")}</MonoTitle>
          <h1 className="mt-4 text-4xl font-black tracking-[-0.05em] text-white [font-family:var(--font-syne),sans-serif] md:text-5xl">
            {t("insights.title")}
          </h1>
          <p className="mt-3 text-base text-gray-400">{t("insights.subtitle")}</p>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <ScoreHero />
        <RecommendationCards />
        <FactorsPanel insights={insights} />
        <ScoreChart insights={insights} />
      </main>
    </div>
  );
}
