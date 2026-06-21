"use client";

// /reputacao — the SAS Passport screen. Graduated from the /reputacao-v2
// candidate.
//
// Lives inside the (app) route group (DeskShell TopBar + shared dark ground).
// This page is about CURRENT REPUTATION (the SAS Passport); /insights keeps
// explaining how behaviour builds the score.
//
// Wired to the live session + the shared SAS ladder: the score / delta / level
// / progress read useSession() (user.score, scoreDelta, level, nextLevel) and
// the passport lib (tierForScore); the levels panel, benefits and next-level
// perks derive from @/data/score LEVELS (collateral / leverage per tier);
// attestations + the trajectory summary read SAS_BONDS / SAS_TOTAL_*. Every
// string flows through i18n (rep.* namespace + shared score.*/level.* atoms).
//
// Local stroke glyphs cover the icons the shared set lacks; the score uses the
// design's Geist Mono; the hero gauge reuses the insights-v2 gradient ring.

import { useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";

import { Icons } from "@/components/brand/icons";
import type { Tone } from "@/data/carteira";
import { LEVELS, SAS_BONDS, SAS_TOTAL_CYCLES, SAS_TOTAL_INSTALLMENTS } from "@/data/score";
import { useI18n, useT } from "@/lib/i18n";
import { tierForScore } from "@/lib/passport";
import { useSession } from "@/lib/session";

const MONO = "[font-family:var(--font-geist-mono),var(--font-jetbrains-mono),monospace]";

const C = {
  green: "#14F195",
  teal: "#00C8FF",
  purple: "#9945FF",
  amber: "#FFB547",
  red: "#FF3B8D",
} as const;

const LEVEL_COLOR: Record<number, string> = { 1: C.amber, 2: C.teal, 3: C.green, 4: C.purple };
const levelNameKey = (lv: number) =>
  lv === 1
    ? "level.beginner"
    : lv === 2
      ? "level.provenName"
      : lv === 3
        ? "level.veteran"
        : "level.elite";
const toneColor = (tone: Tone) =>
  tone === "g"
    ? C.green
    : tone === "t"
      ? C.teal
      : tone === "p"
        ? C.purple
        : tone === "a"
          ? C.amber
          : C.red;
const BOND_ICON: Record<Tone, string> = {
  p: "cubes",
  g: "briefcase",
  t: "home",
  a: "code",
  r: "shield",
};

// Local stroke glyphs for the icons the shared set lacks (crown / calendar /
// trophy / star / store / briefcase / code).
const GLYPHS: Record<string, ReactNode> = {
  crown: <path d="M4 18h16M5 18l-1.6-9 5 4L12 6l3.6 7 5-4L19 18" />,
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2.2" />
      <path d="M4 9.5h16M8.5 3.2v3.4M15.5 3.2v3.4" />
      <path d="M9 14.4l1.7 1.7 3.6-3.6" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v4a4 4 0 0 1-8 0z" />
      <path d="M8 5.2H5.4v1A2.6 2.6 0 0 0 8 8.8" />
      <path d="M16 5.2h2.6v1A2.6 2.6 0 0 1 16 8.8" />
      <path d="M12 12v3M9 19.5h6M9.8 19.5l.5-4M14.2 19.5l-.5-4" />
    </>
  ),
  star: (
    <path
      d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 16.9l-5.2 2.73.99-5.8L3.58 9.72l5.82-.85z"
      fill="currentColor"
      stroke="none"
    />
  ),
  store: (
    <>
      <path d="M4 9.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5" />
      <path d="M3 9.5l1.6-4.5h14.8L21 9.5a2.4 2.4 0 0 1-4.5 1 2.4 2.4 0 0 1-4.5 0 2.4 2.4 0 0 1-4.5 0A2.4 2.4 0 0 1 3 9.5z" />
      <path d="M9.5 20v-5h5v5" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2" />
      <path d="M8 7.5V5.5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12.5h18" />
    </>
  ),
  code: <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />,
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

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-[1.75rem] border border-white/10 bg-[#0B111A]/80 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl ${className}`}
    >
      {children}
    </section>
  );
}

// Accent hover for the card-like rows: a subtle lift + tone-colored border,
// reverting to the className border on leave. Pair with a `transition`.
function cardHover(color: string) {
  return {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      e.currentTarget.style.borderColor = `${color}66`;
      e.currentTarget.style.transform = "translateY(-2px)";
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      e.currentTarget.style.borderColor = "";
      e.currentTarget.style.transform = "translateY(0)";
    },
  };
}

function MonoTitle({ children, color = "#14F195" }: { children: ReactNode; color?: string }) {
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

// Narrative milestones — no clean event source, so kept as i18n fixtures.
const TIMELINE: Array<{ tKey: string; dKey: string; pts: string; color: string }> = [
  { tKey: "rep.timeline.1.t", dKey: "rep.timeline.1.d", pts: "+48 pts", color: C.green },
  { tKey: "rep.timeline.2.t", dKey: "rep.timeline.2.d", pts: "+68 pts", color: C.teal },
  { tKey: "rep.timeline.3.t", dKey: "rep.timeline.3.d", pts: "+25 pts", color: C.purple },
  { tKey: "rep.timeline.4.t", dKey: "rep.timeline.4.d", pts: "+18 pts", color: C.amber },
];

// ── blocks ───────────────────────────────────────────────────────────────

function PassportHero() {
  const { t } = useI18n();
  const { user } = useSession();
  const tier = tierForScore(user.score);
  const floor = tier.min;
  const next = user.nextLevel;
  const atTop = user.level >= 4;
  const pct = atTop
    ? 100
    : Math.max(0, Math.min(100, ((user.score - floor) / (next - floor)) * 100));
  const pointsToNext = Math.max(0, next - user.score);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(user.walletShort);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // older browsers / missing permissions — silently no-op
    }
  };

  return (
    <Card className="group relative flex flex-col overflow-hidden p-6 transition-transform duration-500 hover:scale-[1.01] md:p-8">
      {/* ambient glows */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-[#00C8FF]/15 blur-[80px]" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-[#14F195]/10 blur-[90px]" />
      {/* mirrored shine sweep on hover — same effect as the home SAS passport */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-tr from-transparent via-white/5 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />

      {/* header row */}
      <div className="relative z-10 mb-7 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="h-9 w-9 animate-spin rounded-full border-4 border-[#00C8FF]/80 border-t-transparent [animation-duration:6s]" />
          <div>
            <div className="text-[12px] font-black uppercase tracking-[0.22em] text-[#7FFFE0]">
              {t("rep.badge")}
            </div>
            <div className={`mt-0.5 text-[10px] text-white/40 ${MONO}`}>{t("rep.cardSub")}</div>
          </div>
        </div>
        <span
          className={`hidden text-[10px] uppercase tracking-[0.14em] text-white/40 sm:block ${MONO}`}
        >
          {t("rep.address")} {user.walletShort}
        </span>
      </div>

      {/* score + gauge ring */}
      <div className="relative z-10 grid items-center gap-6 lg:grid-cols-[1fr_auto]">
        <div>
          <div
            className={`text-[11px] font-black uppercase tracking-[0.22em] text-[#14F195] ${MONO}`}
          >
            {t("score.cardLabel")}
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-4">
            <div
              className={`text-[84px] font-black leading-[0.82] tracking-[-0.07em] text-white md:text-[104px] ${MONO}`}
            >
              {user.score}
            </div>
            <div className="mb-3">
              <div className="text-2xl font-black text-[#14F195]">+{user.scoreDelta}</div>
              <div className="text-xs text-white/45">{t("rep.sinceLast")}</div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="rounded-xl border border-[#00C8FF]/25 bg-[#00C8FF]/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-[#55DFFF]">
              {t("rep.levelN", { n: user.level })}
            </span>
            <span className="rounded-xl border border-[#14F195]/25 bg-[#14F195]/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-[#14F195]">
              {t(levelNameKey(user.level))}
            </span>
          </div>
        </div>

        <div
          className="relative mx-auto h-[184px] w-[184px] shrink-0"
          style={{ filter: "drop-shadow(0 0 24px rgba(20,241,149,0.16))" }}
        >
          <svg viewBox="0 0 120 120" className="h-full w-full">
            <defs>
              <linearGradient id="repRing" x1="0" y1="0.5" x2="1" y2="0.5">
                <stop offset="0%" stopColor="#14F195" />
                <stop offset="50%" stopColor="#00C8FF" />
                <stop offset="100%" stopColor="#9945FF" />
              </linearGradient>
            </defs>
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="9"
            />
            <path
              d="M24.65 95.35 A50 50 0 1 1 85 103.3"
              fill="none"
              stroke="url(#repRing)"
              strokeWidth="9"
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <svg
              width="60"
              height="60"
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
            <span
              className={`text-[10px] font-bold uppercase tracking-[0.18em] text-white/45 ${MONO}`}
            >
              {t("rep.levelN", { n: user.level })}
            </span>
          </div>
        </div>
      </div>

      {/* progress to next level */}
      <div className="relative z-10 mt-6">
        <div className="mb-2 flex items-center justify-between text-xs text-white/55">
          <span>{atTop ? t("rep.maxTier") : t("rep.toNext", { n: pointsToNext })}</span>
          <span className={MONO}>{atTop ? user.score : `${user.score} / ${next}`}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#14F195] via-[#00C8FF] to-[#9945FF]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className={`mt-2 flex justify-between text-[10px] uppercase text-white/35 ${MONO}`}>
          <span>{t("rep.levelMark", { min: floor, n: user.level })}</span>
          <span>
            {atTop ? t("rep.maxMark") : t("rep.levelMark", { min: next, n: user.level + 1 })}
          </span>
        </div>
      </div>

      {/* identity row */}
      <div className="relative z-10 mt-6 flex items-center justify-between gap-4 border-t border-white/[0.08] pt-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#14F195]/30 to-[#9945FF]/30 text-sm font-black text-white ring-1 ring-white/15">
            {user.name
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div>
            <div className="text-sm font-bold text-white">{user.name}</div>
            <div className={`text-[11px] text-white/45 ${MONO}`}>{user.handle}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={copy}
          title={t("score.walletCopy")}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white/60 transition-colors hover:border-[#14F195]/40 hover:text-[#14F195]"
        >
          <span className={MONO}>SAS ID {user.walletShort}</span>
          {copied ? (
            <Icons.check size={13} stroke="#14F195" sw={2.4} />
          ) : (
            <Icons.copy size={13} stroke="currentColor" sw={1.8} />
          )}
        </button>
      </div>
    </Card>
  );
}

function LevelsPanel() {
  const { t } = useI18n();
  const { user } = useSession();
  const pointsToNext = Math.max(0, user.nextLevel - user.score);
  const nextTier = LEVELS.find((l) => l.lv === user.level + 1);

  return (
    <Card className="flex flex-col p-5 md:p-6">
      <div className="flex items-center gap-2">
        <MonoTitle>{t("rep.levelsTitle")}</MonoTitle>
        <Icons.info size={13} stroke="#14F195" sw={1.8} />
      </div>
      <div className="mt-5 flex flex-col gap-3">
        {LEVELS.map((l) => {
          const isCurrent = l.lv === user.level;
          const isUnlocked = l.lv <= user.level;
          const color = LEVEL_COLOR[l.lv];
          return (
            <div
              key={l.lv}
              {...cardHover(color)}
              className={`flex items-center gap-4 rounded-2xl border p-4 transition ${
                isCurrent
                  ? "border-[#00C8FF]/50 bg-[#00C8FF]/[0.08]"
                  : "border-white/[0.08] bg-white/[0.025]"
              }`}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-black"
                style={{ color, border: `1px solid ${color}55`, background: `${color}16` }}
              >
                {l.lv}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-white">
                  {t(levelNameKey(l.lv))}
                  {l.vip && <span className="text-[#14F195]"> ✦ VIP</span>}
                  {isCurrent && <span className="text-[#14F195]"> {t("rep.youInline")}</span>}
                </div>
                <div className={`mt-0.5 text-[11px] text-white/45 ${MONO}`}>
                  {t("score.lvDetail", { c: l.colat, l: l.lev })}
                </div>
              </div>
              {isUnlocked ? (
                <Icons.check size={18} stroke="#14F195" sw={2.2} />
              ) : (
                <Icons.lock size={17} stroke="rgba(255,255,255,0.35)" />
              )}
            </div>
          );
        })}
      </div>

      {/* próximo nível — folded into the levels panel (print) */}
      {nextTier && (
        <div className="mt-5 rounded-2xl border border-[#14F195]/15 bg-[#14F195]/[0.05] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div
                className={`text-[10px] font-black uppercase tracking-[0.18em] text-white/40 ${MONO}`}
              >
                {t("rep.nextLevel")}
              </div>
              <div className="mt-1 text-base font-black text-white">
                {t(levelNameKey(nextTier.lv))}
              </div>
              <div className="text-xs text-white/45">
                {t("rep.pointsToGo", { n: pointsToNext })}
              </div>
            </div>
            <Link
              href="/insights"
              className="shrink-0 rounded-xl border border-[#14F195]/30 bg-[#14F195]/10 px-4 py-2.5 text-xs font-bold text-[#14F195] transition-colors hover:bg-[#14F195]/20"
            >
              {t("rep.viewBenefits")}
            </Link>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#14F195] to-[#00C8FF]"
              style={{
                width: `${Math.max(0, Math.min(100, ((user.score - tierForScore(user.score).min) / (user.nextLevel - tierForScore(user.score).min)) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function BenefitsPanel() {
  const { t } = useI18n();
  const { user } = useSession();
  const cur = LEVELS.find((l) => l.lv === user.level) ?? LEVELS[0];
  const benefits = [
    {
      icon: "shield",
      value: `${cur.colat}%`,
      title: t("rep.benefit.collateral"),
      desc: t("rep.benefit.collateralDesc"),
      color: C.green,
    },
    {
      icon: "trend",
      value: `${cur.lev}x`,
      title: t("rep.benefit.leverage"),
      desc: t("rep.benefit.leverageDesc"),
      color: C.teal,
    },
    {
      icon: "store",
      value: t("rep.benefit.accessValue"),
      title: t("rep.benefit.market"),
      desc: t("rep.benefit.marketDesc"),
      color: C.purple,
    },
    {
      icon: "star",
      value: t("rep.benefit.activeValue"),
      title: t("rep.benefit.passport"),
      desc: t("rep.benefit.passportDesc"),
      color: C.amber,
    },
  ];
  return (
    <Card className="p-5 md:p-6">
      <MonoTitle>{t("rep.benefits.title")}</MonoTitle>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {benefits.map((b) => (
          <div
            key={b.title}
            {...cardHover(b.color)}
            className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 transition"
          >
            <div
              className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: `${b.color}16`, border: `1px solid ${b.color}40` }}
            >
              <Glyph name={b.icon} color={b.color} size={19} sw={1.9} />
            </div>
            <div className="text-xl font-black" style={{ color: b.color }}>
              {b.value}
            </div>
            <div className="mt-0.5 text-sm font-bold text-white/85">{b.title}</div>
            <div className="mt-1.5 text-[11px] leading-relaxed text-white/42">{b.desc}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function NextLevelPanel() {
  const { t } = useI18n();
  const { user } = useSession();
  const nextTier = LEVELS.find((l) => l.lv === user.level + 1);

  if (!nextTier) {
    return (
      <Card className="flex flex-col items-start gap-3 p-5 md:p-6">
        <MonoTitle>{t("rep.maxTier")}</MonoTitle>
        <p className="text-sm leading-relaxed text-white/55">{t("rep.maxTierBody")}</p>
      </Card>
    );
  }

  const perks = [
    {
      icon: "shield",
      title: t("rep.nextPerk.colat", { c: nextTier.colat }),
      desc: t("rep.nextPerk.colatDesc"),
      color: C.green,
    },
    {
      icon: "trend",
      title: t("rep.nextPerk.lev", { l: nextTier.lev }),
      desc: t("rep.nextPerk.levDesc"),
      color: C.teal,
    },
    {
      icon: "crown",
      title: t("rep.nextPerk.priority"),
      desc: t("rep.nextPerk.priorityDesc"),
      color: C.purple,
    },
  ];

  return (
    <Card className="flex flex-col p-5 md:p-6">
      <MonoTitle>{t("rep.nextPanel.title", { name: t(levelNameKey(nextTier.lv)) })}</MonoTitle>
      <div className="mt-5 flex flex-col gap-3">
        {perks.map((p) => (
          <div
            key={p.title}
            {...cardHover(p.color)}
            className="flex items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5 transition"
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: `${p.color}16`, border: `1px solid ${p.color}40` }}
            >
              <Glyph name={p.icon} color={p.color} size={19} sw={1.9} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-white">{p.title}</div>
              <div className="text-[11px] text-white/45">{p.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <Link
        href="/insights"
        className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-sm font-bold text-white/75 transition-colors hover:border-[#14F195]/40 hover:text-[#14F195]"
      >
        {t("rep.viewAllBenefits")}
        <Icons.arrow size={15} stroke="currentColor" sw={2} />
      </Link>
    </Card>
  );
}

function TrajectorySummary() {
  const { t } = useI18n();
  const summary = [
    {
      icon: "calendar",
      value: `${SAS_TOTAL_INSTALLMENTS}`,
      label: t("rep.summary.installments"),
      sub: t("rep.summary.installmentsSub"),
      color: C.green,
    },
    {
      icon: "check",
      value: `${SAS_TOTAL_CYCLES}`,
      label: t("rep.summary.cycles"),
      sub: t("rep.summary.cyclesSub"),
      color: C.teal,
    },
    {
      icon: "trophy",
      value: `${SAS_BONDS.length}`,
      label: t("rep.summary.attestations"),
      sub: t("rep.summary.attestationsSub"),
      color: C.purple,
    },
    {
      icon: "shield",
      value: "0",
      label: t("rep.summary.defaults"),
      sub: t("rep.summary.defaultsSub"),
      color: C.amber,
    },
  ];
  return (
    <Card className="p-5 md:p-6">
      <MonoTitle>{t("rep.summary.title")}</MonoTitle>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {summary.map((s) => (
          <div
            key={s.label}
            {...cardHover(s.color)}
            className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 transition"
          >
            <div
              className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: `${s.color}16`, border: `1px solid ${s.color}40` }}
            >
              <Glyph name={s.icon} color={s.color} size={20} sw={1.9} />
            </div>
            <div className="text-3xl font-black tracking-[-0.04em] text-white">{s.value}</div>
            <div className="mt-1 text-sm font-bold text-white/80">{s.label}</div>
            <div className="mt-0.5 text-[11px] text-white/42">{s.sub}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Timeline() {
  const { t } = useI18n();
  return (
    <Card className="flex h-full flex-col p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <MonoTitle>{t("rep.timeline.title")}</MonoTitle>
        <Link
          href="/carteira"
          className="text-xs font-bold text-[#14F195] transition-colors hover:text-white"
        >
          {t("rep.timeline.viewHistory")} →
        </Link>
      </div>
      <div className="relative mt-6 flex-1">
        <div className="absolute bottom-3 left-[15px] top-3 w-px bg-white/10" />
        <div className="flex h-full flex-col justify-between gap-5">
          {TIMELINE.map((item) => (
            <div key={item.tKey} className="relative flex items-start gap-4">
              <div
                className="relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ background: `${item.color}1c`, border: `1px solid ${item.color}55` }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: item.color, boxShadow: `0 0 10px ${item.color}` }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-bold text-white">{t(item.tKey)}</div>
                  <span
                    className="shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-black"
                    style={{
                      color: item.color,
                      borderColor: `${item.color}33`,
                      background: `${item.color}12`,
                    }}
                  >
                    {item.pts}
                  </span>
                </div>
                <div className="mt-0.5 text-[12px] text-white/45">{t(item.dKey)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Attestations() {
  const { t } = useI18n();
  return (
    <Card className="flex h-full flex-col p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <MonoTitle>{t("rep.attest.title")}</MonoTitle>
        <span className="text-xs text-white/45">
          {t("score.bondAttest", { n: SAS_BONDS.length })}
        </span>
      </div>
      <div className="mt-5 flex flex-1 flex-col gap-3">
        {SAS_BONDS.map((b) => {
          const color = toneColor(b.tone);
          return (
            <div
              key={b.id}
              {...cardHover(color)}
              className="flex items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5 transition"
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{ background: `${color}16`, border: `1px solid ${color}40` }}
              >
                <Glyph name={BOND_ICON[b.tone]} color={color} size={20} sw={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-white">{b.cycle}</div>
                <div className={`mt-0.5 text-[11px] text-white/40 ${MONO}`}>
                  {t("rep.role.borrower")} · {t("rep.attest.installments", { n: b.installments })}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
                    b.status === "active"
                      ? "bg-[#14F195]/10 text-[#14F195]"
                      : "bg-[#00C8FF]/10 text-[#00C8FF]"
                  }`}
                >
                  {b.status === "active" ? t("score.bondActive") : t("score.bondClosed")}
                </span>
                <span className={`text-[10px] text-white/35 ${MONO}`}>{b.date}</span>
              </div>
            </div>
          );
        })}
      </div>
      <Link
        href="/carteira"
        className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/75 transition-colors hover:border-[#14F195]/40 hover:text-[#14F195]"
      >
        {t("rep.viewAllAttest")}
        <Icons.arrow size={15} stroke="currentColor" sw={2} />
      </Link>
    </Card>
  );
}

function OnChainFooter() {
  const { t } = useI18n();
  return (
    <Card className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-6">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
          <Icons.lock size={22} stroke="#14F195" sw={1.8} />
        </div>
        <div>
          <div className="text-sm font-bold text-white">{t("rep.footer.title")}</div>
          <div className="mt-1 text-[13px] text-white/45">{t("rep.footer.body")}</div>
        </div>
      </div>
      <Link
        href="/carteira"
        className="inline-flex items-center gap-2 self-start text-sm font-bold text-[#14F195] transition-colors hover:text-white md:self-auto"
      >
        {t("rep.footer.viewTx")}
        <Icons.arrow size={15} stroke="currentColor" sw={2} />
      </Link>
    </Card>
  );
}

export default function ReputacaoPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 font-sans text-white animate-in fade-in duration-700 md:p-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <MonoTitle>{t("rep.badge")}</MonoTitle>
          <h1 className="mt-4 text-4xl font-black tracking-[-0.05em] text-white [font-family:var(--font-syne),sans-serif] md:text-5xl">
            {t("score.title")}
          </h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-white/60">
            {t("rep.subtitle")}
          </p>
        </div>
        <Link
          href="/insights"
          className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-[#14F195]/25 bg-[#14F195]/[0.06] px-5 py-3 text-sm font-bold text-[#14F195] transition-colors hover:bg-[#14F195]/[0.12]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
          {t("rep.understand")}
        </Link>
      </header>

      <main className="flex flex-col gap-6">
        <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
          <PassportHero />
          <LevelsPanel />
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
          <BenefitsPanel />
          <NextLevelPanel />
        </div>

        <TrajectorySummary />

        <div className="grid gap-6 lg:grid-cols-2">
          <Timeline />
          <Attestations />
        </div>

        <OnChainFooter />
      </main>
    </div>
  );
}
