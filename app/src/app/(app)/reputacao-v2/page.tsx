"use client";

// /reputacao-v2 — VISUAL-FIRST preview of the team's new Reputação design.
//
// Lives inside the (app) route group so it inherits the DeskShell TopBar
// (the horizontal session nav) + the shared dark ground — the real
// /reputacao and main stay untouched until this graduates. Faithful to the
// provided ReputacaoPage_redesign.tsx and the target print: this page is
// about CURRENT REPUTATION (the SAS Passport), while /insights keeps
// explaining how behaviour builds the score.
//
// Polish pass vs. the raw export: emoji glyphs swapped for the project's
// stroke icon set (@/components/brand/icons) with a local glyph fallback;
// the score uses the design's Geist Mono; the hero gauge reuses the
// insights-v2 gradient ring; the horizontal 5-step journey + grid
// attestations from the export become the print's vertical timeline +
// attestation list, and "Próximo nível" folds into the levels panel.
//
// Still visual-only: every figure (684 / +18 / levels / attestations) is the
// design's static fixture — the re-wire pass connects them to
// useSession()/@/data/score + the passport lib, strings migrate to i18n,
// then it graduates onto /reputacao.

import { useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";

import { Icons } from "@/components/brand/icons";

const MONO = "[font-family:var(--font-geist-mono),var(--font-jetbrains-mono),monospace]";

const C = {
  green: "#14F195",
  teal: "#00C8FF",
  purple: "#9945FF",
  amber: "#FFB547",
  red: "#FF3B8D",
} as const;

// Local stroke glyphs for the icons the shared set lacks (crown / calendar /
// trophy / star / store / briefcase / code). Visual-first — promote to
// @/components/brand/icons at graduation if reused elsewhere.
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
// reverting to the className border on leave. Tailwind can't express a
// per-item dynamic border color, so the hover rides inline style — pair it
// with a `transition` (not `transition-colors`) so the transform animates too.
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

// ── fixtures (design's static values) ────────────────────────────────────

type LevelStatus = "done" | "current" | "locked";

const LEVELS: Array<{
  level: number;
  name: string;
  colat: string;
  lev: string;
  status: LevelStatus;
  color: string;
}> = [
  {
    level: 1,
    name: "Iniciante",
    colat: "50% colateral",
    lev: "2x alavancagem",
    status: "done",
    color: C.amber,
  },
  {
    level: 2,
    name: "Comprovado",
    colat: "25% colateral",
    lev: "4x alavancagem",
    status: "current",
    color: C.teal,
  },
  {
    level: 3,
    name: "Veterano",
    colat: "18% colateral",
    lev: "10x alavancagem",
    status: "locked",
    color: C.green,
  },
  {
    level: 4,
    name: "Elite + VIP",
    colat: "3% colateral",
    lev: "15x alavancagem",
    status: "locked",
    color: C.purple,
  },
];

const BENEFITS: Array<{ icon: string; value: string; title: string; desc: string; color: string }> =
  [
    {
      icon: "shield",
      value: "25%",
      title: "Colateral",
      desc: "Desconto atual sobre o valor nominal",
      color: C.green,
    },
    {
      icon: "trend",
      value: "4x",
      title: "Alavancagem",
      desc: "Multiplicador disponível nos grupos",
      color: C.teal,
    },
    {
      icon: "store",
      value: "Acesso",
      title: "Mercado Secundário",
      desc: "Compre posições com desconto",
      color: C.purple,
    },
    {
      icon: "star",
      value: "Ativo",
      title: "SAS Passport",
      desc: "Identidade on-chain verificada",
      color: C.amber,
    },
  ];

const NEXT_PERKS: Array<{ icon: string; title: string; desc: string; color: string }> = [
  { icon: "shield", title: "18% colateral", desc: "Mais desconto nos custos", color: C.green },
  {
    icon: "trend",
    title: "10x alavancagem",
    desc: "Mais capacidade para participar",
    color: C.teal,
  },
  {
    icon: "crown",
    title: "Prioridade em grupos",
    desc: "Acessa os mais disputados antes",
    color: C.purple,
  },
];

const SUMMARY: Array<{ icon: string; value: string; label: string; sub: string; color: string }> = [
  { icon: "calendar", value: "17", label: "Parcelas pagas", sub: "Sempre em dia", color: C.green },
  { icon: "check", value: "4", label: "Ciclos concluídos", sub: "100% finalizados", color: C.teal },
  {
    icon: "trophy",
    value: "7",
    label: "Attestations emitidos",
    sub: "Histórico financeiro e grupos",
    color: C.purple,
  },
  { icon: "shield", value: "0", label: "Defaults", sub: "Histórico limpo", color: C.amber },
];

const TIMELINE: Array<{ title: string; desc: string; pts: string; color: string }> = [
  {
    title: "Renovação MEI concluída",
    desc: "Ciclo dentro do esperado",
    pts: "+48 pts",
    color: C.green,
  },
  {
    title: "Subiu para Nível 2 · Comprovado",
    desc: "Alcançou 500 pontos de reputação",
    pts: "+68 pts",
    color: C.teal,
  },
  {
    title: "SAS Passport emitido",
    desc: "Identidade on-chain verificada",
    pts: "+25 pts",
    color: C.purple,
  },
  {
    title: "4 ciclos ativos",
    desc: "Participação paralela permitida",
    pts: "+18 pts",
    color: C.amber,
  },
];

const ATTESTATIONS: Array<{
  icon: string;
  title: string;
  role: string;
  address: string;
  date: string;
  status: "Ativo" | "Concluído";
  color: string;
}> = [
  {
    icon: "cubes",
    title: "Dev Setup • 6m",
    role: "Tomador",
    address: "0x8F3...A1b2",
    date: "Mar 2026",
    status: "Ativo",
    color: C.purple,
  },
  {
    icon: "home",
    title: "Freela Setup • 6m",
    role: "Tomador",
    address: "0x7C2...D9f1",
    date: "Dez 2025",
    status: "Concluído",
    color: C.teal,
  },
  {
    icon: "briefcase",
    title: "Renovação MEI • 12m",
    role: "Tomador",
    address: "0x3A1...B7c9",
    date: "Abr 2026",
    status: "Ativo",
    color: C.green,
  },
  {
    icon: "code",
    title: "Curso Rust • 6m",
    role: "Tomador",
    address: "0x9D2...E4f8",
    date: "Set 2025",
    status: "Concluído",
    color: C.amber,
  },
];

// ── blocks ───────────────────────────────────────────────────────────────

function PassportHero() {
  const score = 684;
  const next = 750;
  const floor = 500;
  const pct = ((score - floor) / (next - floor)) * 100;
  const sasId = "0xA7F3...kXPN";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sasId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // older browsers / missing permissions — silently no-op
    }
  };

  return (
    <Card className="relative flex flex-col overflow-hidden p-6 md:p-8">
      {/* ambient glows */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-[#00C8FF]/15 blur-[80px]" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-[#14F195]/10 blur-[90px]" />

      {/* header row */}
      <div className="relative z-10 mb-7 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="h-9 w-9 animate-spin rounded-full border-4 border-[#00C8FF]/80 border-t-transparent [animation-duration:6s]" />
          <div>
            <div className="text-[12px] font-black uppercase tracking-[0.22em] text-[#7FFFE0]">
              SAS Passport
            </div>
            <div className={`mt-0.5 text-[10px] text-white/40 ${MONO}`}>on-chain reputation</div>
          </div>
        </div>
        <span
          className={`hidden text-[10px] uppercase tracking-[0.14em] text-white/40 sm:block ${MONO}`}
        >
          Endereço {sasId}
        </span>
      </div>

      {/* core (score + gauge + progress) is vertically centered, so when the
          hero stretches to match the levels panel the slack splits evenly
          above and below instead of pooling into one empty band */}
      <div className="relative z-10 flex flex-1 flex-col justify-center gap-7">
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto]">
          <div>
            <div
              className={`text-[11px] font-black uppercase tracking-[0.22em] text-[#14F195] ${MONO}`}
            >
              Reputation Score
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-4">
              <div
                className={`text-[84px] font-black leading-[0.82] tracking-[-0.07em] text-white md:text-[104px] ${MONO}`}
              >
                {score}
              </div>
              <div className="mb-3">
                <div className="text-2xl font-black text-[#14F195]">+18</div>
                <div className="text-xs text-white/45">desde maio</div>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="rounded-xl border border-[#00C8FF]/25 bg-[#00C8FF]/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-[#55DFFF]">
                Nível 2
              </span>
              <span className="rounded-xl border border-[#14F195]/25 bg-[#14F195]/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-[#14F195]">
                Comprovado
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
                Nível 2
              </span>
            </div>
          </div>
        </div>

        {/* progress to next level */}
        <div className="relative z-10">
          <div className="mb-2 flex items-center justify-between text-xs text-white/55">
            <span>Faltam 66 pontos para o próximo nível</span>
            <span className={MONO}>
              {score} / {next}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#14F195] via-[#00C8FF] to-[#9945FF]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className={`mt-2 flex justify-between text-[10px] uppercase text-white/35 ${MONO}`}>
            <span>500 · Nível 2</span>
            <span>750 · Nível 3</span>
          </div>
        </div>
      </div>

      {/* identity row */}
      <div className="relative z-10 mt-6 flex items-center justify-between gap-4 border-t border-white/[0.08] pt-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#14F195]/30 to-[#9945FF]/30 text-sm font-black text-white ring-1 ring-white/15">
            ML
          </div>
          <div>
            <div className="text-sm font-bold text-white">Maria Luísa</div>
            <div className={`text-[11px] text-white/45 ${MONO}`}>@marialuisa.eth</div>
          </div>
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white/60 transition-colors hover:border-[#14F195]/40 hover:text-[#14F195]"
        >
          <span className={MONO}>SAS ID {sasId}</span>
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
  return (
    <Card className="flex h-full flex-col p-5 md:p-6">
      <div className="flex items-center gap-2">
        <MonoTitle>Níveis de reputação</MonoTitle>
        <Icons.info size={13} stroke="#14F195" sw={1.8} />
      </div>
      <div className="mt-5 flex flex-1 flex-col justify-between gap-3">
        {LEVELS.map((l) => (
          <div
            key={l.level}
            {...cardHover(l.color)}
            className={`flex items-center gap-4 rounded-2xl border p-4 transition ${
              l.status === "current"
                ? "border-[#00C8FF]/50 bg-[#00C8FF]/[0.08]"
                : "border-white/[0.08] bg-white/[0.025]"
            }`}
          >
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-black"
              style={{
                color: l.color,
                border: `1px solid ${l.color}55`,
                background: `${l.color}16`,
              }}
            >
              {l.level}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-white">
                {l.name}
                {l.status === "current" && <span className="text-[#14F195]"> • você</span>}
              </div>
              <div className={`mt-0.5 text-[11px] text-white/45 ${MONO}`}>
                {l.colat} · {l.lev}
              </div>
            </div>
            {l.status === "locked" ? (
              <Icons.lock size={17} stroke="rgba(255,255,255,0.35)" />
            ) : (
              <Icons.check size={18} stroke="#14F195" sw={2.2} />
            )}
          </div>
        ))}
      </div>

      {/* próximo nível — folded into the levels panel (print) */}
      <div className="mt-5 rounded-2xl border border-[#14F195]/15 bg-[#14F195]/[0.05] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div
              className={`text-[10px] font-black uppercase tracking-[0.18em] text-white/40 ${MONO}`}
            >
              Próximo nível
            </div>
            <div className="mt-1 text-base font-black text-white">Veterano</div>
            <div className="text-xs text-white/45">Faltam 66 pontos</div>
          </div>
          <Link
            href="/insights"
            className="shrink-0 rounded-xl border border-[#14F195]/30 bg-[#14F195]/10 px-4 py-2.5 text-xs font-bold text-[#14F195] transition-colors hover:bg-[#14F195]/20"
          >
            Ver benefícios
          </Link>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full w-[74%] rounded-full bg-gradient-to-r from-[#14F195] to-[#00C8FF]" />
        </div>
      </div>
    </Card>
  );
}

function BenefitsPanel() {
  return (
    <Card className="flex h-full flex-col p-5 md:p-6">
      <MonoTitle>Seus benefícios atuais</MonoTitle>
      {/* grid grows to fill the card so a stretched panel reads as taller cards
          (icon up top, figures down low) rather than an empty band below */}
      <div className="mt-5 grid flex-1 grid-cols-2 gap-3 md:grid-cols-4">
        {BENEFITS.map((b) => (
          <div
            key={b.title}
            {...cardHover(b.color)}
            className="flex h-full flex-col rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 transition"
          >
            <div
              className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: `${b.color}16`, border: `1px solid ${b.color}40` }}
            >
              <Glyph name={b.icon} color={b.color} size={19} sw={1.9} />
            </div>
            {/* stats bottom-align as one block so a stretched card reads as
                "icon up top, figures down low" rather than an empty base */}
            <div className="mt-auto">
              <div className="text-xl font-black" style={{ color: b.color }}>
                {b.value}
              </div>
              <div className="mt-0.5 text-sm font-bold text-white/85">{b.title}</div>
              <div className="mt-1.5 text-[11px] leading-relaxed text-white/42">{b.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function NextLevelPanel() {
  return (
    <Card className="flex h-full flex-col p-5 md:p-6">
      <MonoTitle>Ao chegar em Veterano</MonoTitle>
      <div className="mt-5 flex flex-1 flex-col gap-3">
        {NEXT_PERKS.map((p) => (
          <div
            key={p.title}
            {...cardHover(p.color)}
            className="flex flex-1 items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5 transition"
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
        Ver todos os benefícios
        <Icons.arrow size={15} stroke="currentColor" sw={2} />
      </Link>
    </Card>
  );
}

function TrajectorySummary() {
  return (
    <Card className="p-5 md:p-6">
      <MonoTitle>Resumo da sua trajetória SAS</MonoTitle>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {SUMMARY.map((s) => (
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
  return (
    <Card className="flex h-full flex-col p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <MonoTitle>Sua linha do tempo</MonoTitle>
        <Link
          href="/carteira"
          className="text-xs font-bold text-[#14F195] transition-colors hover:text-white"
        >
          Ver histórico →
        </Link>
      </div>
      <div className="relative mt-6 flex-1">
        <div className="absolute bottom-3 left-[15px] top-3 w-px bg-white/10" />
        <div className="flex h-full flex-col justify-between gap-5">
          {TIMELINE.map((item) => (
            <div key={item.title} className="relative flex items-start gap-4">
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
                  <div className="text-sm font-bold text-white">{item.title}</div>
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
                <div className="mt-0.5 text-[12px] text-white/45">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Attestations() {
  return (
    <Card className="flex h-full flex-col p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <MonoTitle>Atestados emitidos</MonoTitle>
        <span className="text-xs text-white/45">7 attestations</span>
      </div>
      <div className="mt-5 flex flex-1 flex-col gap-3">
        {ATTESTATIONS.map((a) => (
          <div
            key={a.title}
            {...cardHover(a.color)}
            className="flex items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5 transition"
          >
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
              style={{ background: `${a.color}16`, border: `1px solid ${a.color}40` }}
            >
              <Glyph name={a.icon} color={a.color} size={20} sw={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-white">{a.title}</div>
              <div className={`mt-0.5 text-[11px] text-white/40 ${MONO}`}>
                {a.role} · {a.address}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
                  a.status === "Ativo"
                    ? "bg-[#14F195]/10 text-[#14F195]"
                    : "bg-[#00C8FF]/10 text-[#00C8FF]"
                }`}
              >
                {a.status}
              </span>
              <span className={`text-[10px] text-white/35 ${MONO}`}>{a.date}</span>
            </div>
          </div>
        ))}
      </div>
      <Link
        href="/carteira"
        className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/75 transition-colors hover:border-[#14F195]/40 hover:text-[#14F195]"
      >
        Ver todos os atestados
        <Icons.arrow size={15} stroke="currentColor" sw={2} />
      </Link>
    </Card>
  );
}

function OnChainFooter() {
  return (
    <Card className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-6">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
          <Icons.lock size={22} stroke="#14F195" sw={1.8} />
        </div>
        <div>
          <div className="text-sm font-bold text-white">100% on-chain e auditável</div>
          <div className="mt-1 text-[13px] text-white/45">
            Todos os dados são imutáveis, auditáveis e registrados on-chain na Solana.
          </div>
        </div>
      </div>
      <Link
        href="/carteira"
        className="inline-flex items-center gap-2 self-start text-sm font-bold text-[#14F195] transition-colors hover:text-white md:self-auto"
      >
        Ver transações on-chain
        <Icons.arrow size={15} stroke="currentColor" sw={2} />
      </Link>
    </Card>
  );
}

export default function ReputacaoV2Page() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 font-sans text-white animate-in fade-in duration-700 md:p-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <MonoTitle>SAS Passport</MonoTitle>
          <h1 className="mt-4 text-4xl font-black tracking-[-0.05em] text-white [font-family:var(--font-syne),sans-serif] md:text-5xl">
            Reputação on-chain
          </h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-white/60">
            Sua reputação é registrada em blockchain e reflete seu histórico real no protocolo
            RoundFi.
          </p>
        </div>
        <Link
          href="/insights"
          className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-[#14F195]/25 bg-[#14F195]/[0.06] px-5 py-3 text-sm font-bold text-[#14F195] transition-colors hover:bg-[#14F195]/[0.12]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
          Entenda o SAS Passport
        </Link>
      </header>

      <main className="flex flex-col gap-6">
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <PassportHero />
          <LevelsPanel />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
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
