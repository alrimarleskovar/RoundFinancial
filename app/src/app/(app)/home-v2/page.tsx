"use client";

// /home-v2 — VISUAL-FIRST preview of the team's new dashboard design.
//
// Lives inside the (app) route group so it inherits the DeskShell TopBar
// (the horizontal session nav) + the shared dark ground — the real /home and
// main stay untouched until this graduates. Faithful to the provided
// RoundFiHomePage_redesign.tsx + the target print.
//
// The headline change vs. /home: the four metric tiles are EXPANDABLE — tap
// the affordance and the card unfolds a chart (sparkline / donut / collateral
// slider / tier bar). Action-first hero up top, the active credit cycles
// (functional Pagar/Vender modals), then "Próximas conquistas".
//
// Polish pass vs. the raw export: the export's lucide-react icons (not a
// project dep) + emoji glyphs are swapped for the stroke icon set
// (@/components/brand/icons) with a local glyph fallback; the action hero
// gains the print's countdown calendar. Wiring is real (useSession /
// ACTIVE_GROUPS / the Pay+Sell modals all run client-side); only the chart
// figures inside the expanded panels are the design's illustrative values —
// the re-wire pass connects those + the on-chain membership surfacing from
// /home, then it graduates.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { Icons } from "@/components/brand/icons";
import { PayInstallmentModal } from "@/components/modals/PayInstallmentModal";
import { SellShareModal } from "@/components/modals/SellShareModal";
import { ACTIVE_GROUPS, type ActiveGroup } from "@/data/groups";
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

// A 3D tear-off calendar page showing the countdown (days remaining), the
// focal visual of the action hero per the print.
function CountdownCalendar({ day, mon }: { day: string; mon: string }) {
  return (
    <div className="relative -rotate-[5deg]">
      {/* binder rings */}
      <span className="absolute -top-2 left-5 z-10 h-4 w-2 rounded-full bg-gradient-to-b from-gray-200 to-gray-500 shadow-md" />
      <span className="absolute -top-2 right-5 z-10 h-4 w-2 rounded-full bg-gradient-to-b from-gray-200 to-gray-500 shadow-md" />
      <div className="h-32 w-28 overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(0,0,0,0.55)] ring-1 ring-black/10">
        <div className="flex h-9 items-center justify-center bg-gradient-to-r from-[#14F195] to-[#0FCB7E] text-[11px] font-black uppercase tracking-[0.2em] text-[#04130D]">
          {mon}
        </div>
        <div className="flex h-[calc(100%-2.25rem)] items-center justify-center text-[3.5rem] font-black leading-none text-[#0B0F16]">
          {day}
        </div>
      </div>
    </div>
  );
}

function ActionHero({
  nextDue,
  installment,
  daysUntil,
  dueMon,
}: {
  nextDue: string;
  installment: string;
  daysUntil: number;
  dueMon: string;
}) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-[#14F195]/35 bg-[#071018] p-5 shadow-[0_0_45px_rgba(20,241,149,0.08)] sm:p-7">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#14F195]/10 blur-[80px]" />
      <div className="pointer-events-none absolute -left-24 bottom-0 h-64 w-64 rounded-full bg-[#00C8FF]/[0.08] blur-[80px]" />

      <div className="relative z-10 grid gap-6 lg:grid-cols-[1.05fr_0.8fr_1fr] lg:items-center">
        {/* left — the action */}
        <div>
          <div className="mb-4 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-[#14F195]">
            <span className="h-2 w-2 rounded-full bg-[#14F195] shadow-[0_0_10px_#14F195]" />
            Próxima ação
          </div>
          <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
            Sua parcela vence em
          </h2>
          <div className="mt-1 text-4xl font-black tracking-tight text-[#14F195] sm:text-5xl">
            {daysUntil} dias
          </div>
          <p className="mt-5 text-sm text-gray-400">Valor da parcela</p>
          <div className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">
            {installment}
          </div>
          <button className="mt-6 inline-flex w-full max-w-[280px] items-center justify-between rounded-2xl bg-gradient-to-r from-[#14F195] to-[#00C8FF] px-6 py-4 text-sm font-black text-[#04130D] shadow-[0_8px_32px_rgba(20,241,149,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(20,241,149,0.36)]">
            Pagar agora
            <Glyph name="chevronRight" color="#04130D" size={18} sw={2.4} />
          </button>
        </div>

        {/* center — countdown calendar inside a glowing green arc */}
        <div className="relative flex items-center justify-center py-2">
          <svg
            viewBox="0 0 120 120"
            className="pointer-events-none absolute h-[210px] w-[210px]"
            style={{ filter: "drop-shadow(0 0 14px rgba(20,241,149,0.45))" }}
          >
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="#14F195"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="245 100"
              opacity="0.5"
              transform="rotate(130 60 60)"
            />
          </svg>
          <CountdownCalendar day={String(daysUntil)} mon={dueMon} />
        </div>

        {/* right — the facts */}
        <div className="grid gap-2.5 rounded-3xl border border-white/10 bg-black/20 p-3 backdrop-blur">
          <HeroFact icon="calendar" title="Vencimento" value={nextDue} />
          <HeroFact icon="stopwatch" title="Dias restantes" value={`${daysUntil} dias`} />
          <HeroFact icon="shield" title="Mantenha seu score" value="Evite juros e multas" />
        </div>
      </div>
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
  const [payOpen, setPayOpen] = useState(false);
  const hour = new Date().getHours();
  const salutation = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-3xl font-black tracking-[-0.03em] text-white [font-family:var(--font-syne),sans-serif] sm:text-4xl">
          {salutation}, {firstName} <span className="align-middle">👋</span>
        </h1>
        <p className="mt-2 text-sm text-gray-400">Vamos construir mais conquistas hoje.</p>
      </div>
      <div className="flex shrink-0 gap-2.5">
        <button
          type="button"
          onClick={() => setPayOpen(true)}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#14F195] to-[#00C8FF] px-5 py-3 text-sm font-black text-[#04130D] shadow-[0_8px_28px_rgba(20,241,149,0.25)] transition hover:-translate-y-0.5"
        >
          <Icons.send size={16} stroke="#04130D" sw={1.9} />
          Pagar parcela
        </button>
        <Link
          href="/grupos"
          className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] bg-white/[0.04] px-5 py-3 text-sm font-bold text-white transition hover:border-white/30"
        >
          <Icons.plus size={16} stroke="currentColor" sw={2} />
          Entrar em grupo
        </Link>
      </div>
      {payGroup ? (
        <PayInstallmentModal group={payGroup} open={payOpen} onClose={() => setPayOpen(false)} />
      ) : null}
    </div>
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
          aria-label={expanded ? "Recolher informações" : "Expandir informações"}
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

function ProtectedDetails({ liveBalance }: { liveBalance: number }) {
  const { fmtMoney } = useI18n();
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
          <p className="text-gray-500">Rendimento acumulado</p>
          <p className="mt-1 font-bold text-white">{fmtMoney(1587.76)}</p>
        </div>
        <div>
          <p className="text-gray-500">Yield médio</p>
          <p className="mt-1 font-bold text-[#00C8FF]">57 USDC</p>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-gray-500">
        Saldo atualizado em tempo real. Total atual: {fmtMoney(liveBalance)}.
      </p>
    </div>
  );
}

function CycleValueDetails() {
  return (
    <div className="space-y-4 border-t border-white/10 pt-4">
      <div className="flex items-center gap-4">
        <div className="relative h-24 w-24 rounded-full bg-[conic-gradient(#14F195_0_62%,#00C8FF_62%_85%,#9945FF_85%_100%)]">
          <div className="absolute inset-4 rounded-full bg-[#0B0F16]" />
        </div>
        <div className="space-y-2 text-xs">
          <Legend color="#14F195" label="Em andamento" value="62%" />
          <Legend color="#00C8FF" label="Aguardando" value="23%" />
          <Legend color="#9945FF" label="Encerrados" value="15%" />
        </div>
      </div>
      <Link
        href="/grupos"
        className="inline-flex items-center gap-2 text-xs font-bold text-[#14F195]"
      >
        Ver detalhes <Glyph name="chevronRight" color="#14F195" size={14} sw={2.2} />
      </Link>
    </div>
  );
}

function CollateralDetails({ pct }: { pct: number }) {
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
        <span>Mínimo 20%</span>
        <span>Máximo 50%</span>
      </div>
      <Link
        href="/reputacao"
        className="inline-flex items-center gap-2 text-xs font-bold text-[#14F195]"
      >
        Como reduzir colateral <Glyph name="chevronRight" color="#14F195" size={14} sw={2.2} />
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
            SAS Digital Passport
          </span>
          <div className="mt-0.5 font-mono text-[8px] text-gray-500">ID: {passportId}</div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(expanded ? null : "passport")}
          className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-2 text-gray-400 transition hover:border-white/25 hover:text-white"
          aria-label={expanded ? "Recolher informações" : "Expandir informações"}
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
          <span className="text-[10px] font-black italic leading-none text-[#14F195]">TRUSTED</span>
          <span className="text-[10px] font-bold italic text-gray-500">SCORE</span>
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
              {toNext > 0
                ? `Faltam ${toNext} pontos para o próximo nível.`
                : "Você está no nível máximo. Reputação on-chain auditável."}
            </p>
            <Link
              href="/reputacao"
              className="inline-flex items-center gap-2 text-xs font-bold text-[#14F195]"
            >
              Ver meu perfil <Glyph name="chevronRight" color="#14F195" size={14} sw={2.2} />
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
}: {
  icon: string;
  title: string;
  subtitle: string;
  progress: string;
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
        <div className="h-2 flex-1 rounded-full bg-white/[0.08]" />
        <span className="font-mono text-xs text-gray-400">{progress}</span>
      </div>
    </div>
  );
}

export default function HomeV2Page() {
  const { t, fmtMoney } = useI18n();
  const { user, monthsPaidByGroup, claimedGroups } = useSession();
  const theme = "dark";
  const [liveBalance, setLiveBalance] = useState(user.balance + user.yield);
  const [expanded, setExpanded] = useState<ExpandKey>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveBalance((prev) => prev + Math.random() * 0.005);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const receivable = useMemo(
    () =>
      ACTIVE_GROUPS.filter((g) => g.status !== "drawn" && !claimedGroups.includes(g.name)).reduce(
        (sum, g) => sum + g.prize,
        0,
      ),
    [claimedGroups],
  );

  const firstName = user.name.split(" ")[0];
  const firstGroup = ACTIVE_GROUPS[0];
  const daysUntil = firstGroup ? firstGroup.nextDue : 5;
  const installment = firstGroup ? fmtMoney(firstGroup.installment) : fmtMoney(892);
  // Real due date for the "Vencimento" fact (DD / Mon / YYYY); the calendar
  // shows the countdown (daysUntil) per the print.
  const dueDate = new Date(Date.now() + daysUntil * 86_400_000);
  const dd = String(dueDate.getDate()).padStart(2, "0");
  const monShort = dueDate.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  const monCap = monShort.charAt(0).toUpperCase() + monShort.slice(1);
  const nextDue = `${dd} / ${monCap} / ${dueDate.getFullYear()}`;
  const dueMon = monCap.toUpperCase();

  return (
    <div className="mx-auto flex w-full max-w-6xl animate-in flex-col gap-6 p-4 font-sans fade-in duration-700 md:p-8">
      <Greeting firstName={firstName} payGroup={firstGroup} />

      <ActionHero
        nextDue={nextDue}
        installment={installment}
        daysUntil={daysUntil}
        dueMon={dueMon}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ExpandableMetricCard
          id="protected"
          expanded={expanded === "protected"}
          onToggle={setExpanded}
          tone="#14F195"
          title="Saldo protegido"
          value={fmtMoney(liveBalance)}
          subtitle="Rendendo em escrow na Solana"
          icon={<Icons.trend size={17} stroke="currentColor" sw={1.9} />}
        >
          <ProtectedDetails liveBalance={liveBalance} />
        </ExpandableMetricCard>

        <ExpandableMetricCard
          id="cycles"
          expanded={expanded === "cycles"}
          onToggle={setExpanded}
          tone="#9945FF"
          title="Valor dos ciclos"
          value={fmtMoney(receivable)}
          subtitle="Capital total das cotas ativas"
          icon={<Glyph name="pie" color="currentColor" size={17} sw={1.9} />}
        >
          <CycleValueDetails />
        </ExpandableMetricCard>

        <ExpandableMetricCard
          id="collateral"
          expanded={expanded === "collateral"}
          onToggle={setExpanded}
          tone="#FFB547"
          title="Colateral atual"
          value={`${user.colateralPct}%`}
          subtitle="Sobre o valor da cota"
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

        {ACTIVE_GROUPS.length === 0 ? (
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
            {ACTIVE_GROUPS.map((g) => {
              const month = Math.min(g.total, g.month + (monthsPaidByGroup[g.name] ?? 0));
              return <GroupCard key={g.id} g={g} month={month} theme={theme} />;
            })}
          </div>
        )}
      </section>

      <section className="rounded-[2rem] border border-white/[0.06] bg-white/[0.025] p-5 sm:p-7">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-gray-500">
            Próximas conquistas
          </h3>
          <Link href="/insights" className="text-xs font-bold text-gray-400 hover:text-white">
            Ver todas
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <AchievementCard
            icon="star"
            title="Pague 2 parcelas no prazo"
            subtitle="Ganhe +18 pontos"
            progress="0/2"
          />
          <AchievementCard
            icon="people"
            title="Entre em um grupo PME"
            subtitle="Ganhe +24 pontos"
            progress="0/1"
          />
          <AchievementCard
            icon="trophy"
            title="Complete 1 ciclo"
            subtitle="Ganhe +42 pontos"
            progress="0/1"
          />
        </div>
      </section>

      <footer className="flex flex-col gap-3 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-2">
          <Icons.lock size={14} stroke="currentColor" sw={1.8} />
          Seus fundos estão protegidos em escrow e gerando yield na Solana.
        </span>
        <span className="inline-flex items-center gap-2 text-[#14F195]">
          <Icons.check size={14} stroke="#14F195" sw={2.2} />
          Auditado e verificado
        </span>
      </footer>
    </div>
  );
}
