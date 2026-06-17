"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

import { DeskKpi } from "@/components/home/DeskKpi";
import { HomeHero } from "@/components/home/HomeHero";
import { Activity } from "@/components/home/Activity";
import { PayInstallmentModal } from "@/components/modals/PayInstallmentModal";
import { SellShareModal } from "@/components/modals/SellShareModal";
import { TopBar } from "@/components/layout/TopBar";
import { useI18n, type Lang } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { ACTIVE_GROUPS, type ActiveGroup } from "@/data/groups";
import type { NftPosition, Tone } from "@/data/carteira";

// /home-v2 — CANDIDATE dashboard redesign, staged for the team to review
// alongside the current /home.
//
// Rendered at its OWN route, OUTSIDE the (app) route group, so the live
// /home stays untouched. It renders the SAME shared <TopBar /> as every
// (app) route — so the header (size + chrome) is identical when navigating
// in and out of v2 — then its own bento body + footer. All providers
// (Session, i18n, theme, wallet) come from the root ClientProviders, so the
// shared components work here standalone.
//
// Page copy lives in a LOCAL STRINGS map (not the shared dict) to keep the
// candidate self-contained; it ports to DICT when v2 graduates to /home.

type V2Strings = Record<string, string>;

const STRINGS: Record<Lang, V2Strings> = {
  pt: {
    "kpi.balance": "Saldo Protegido",
    "kpi.receivable": "À Receber",
    "kpi.collateral": "Colateral Exigido",
    "passport.tier": "Nível de Reputação",
    "tier.1": "Iniciante",
    "tier.2": "Comprovado",
    "tier.3": "Veterano",
    "tier.4": "Elite",
    "cycles.title": "Meus Ciclos de Crédito Ativos",
    "cycles.escrow": "Escrow Verificado",
    "cycles.empty.title": "Nenhum ciclo de crédito ativo ainda.",
    "cycles.empty.cta": "Buscar grupos",
    "card.quota": "Cota de Crédito",
    "card.progress": "Progresso do Ciclo",
    "card.due": "Vencimento",
    "card.pay": "Pagar",
    "card.sell": "Vender",
  },
  en: {
    "kpi.balance": "Protected Balance",
    "kpi.receivable": "Receivable",
    "kpi.collateral": "Required Collateral",
    "passport.tier": "Reputation Tier",
    "tier.1": "Beginner",
    "tier.2": "Proven",
    "tier.3": "Veteran",
    "tier.4": "Elite",
    "cycles.title": "My Active Credit Cycles",
    "cycles.escrow": "Escrow Verified",
    "cycles.empty.title": "No active credit cycles yet.",
    "cycles.empty.cta": "Browse groups",
    "card.quota": "Credit Quota",
    "card.progress": "Cycle Progress",
    "card.due": "Due Date",
    "card.pay": "Pay",
    "card.sell": "Sell",
  },
};

function tr(lang: Lang, key: string): string {
  return STRINGS[lang]?.[key] ?? STRINGS.pt[key] ?? key;
}

// SAS reputation ladder — 4 tiers on a 0-1000 score scale (mirrors the
// thresholds in lib/session.tsx). Drives the passport's tier label + the
// progress bar's boundary ticks so both map correctly up to tier 4.
const PASSPORT_MAX_SCORE = 1000;
const PASSPORT_TIERS = [
  { level: 1, min: 0 },
  { level: 2, min: 500 },
  { level: 3, min: 750 },
  { level: 4, min: 950 },
];

// Per-group accent colors (mirrors the tone palette the /home GroupRow uses).
const TONE_HEX: Record<Tone, string> = {
  g: "#14F195",
  t: "#00C8FF",
  p: "#9945FF",
  a: "#FFB547",
  r: "#FF5656",
};

// Next-installment due date from a group's "days until" offset, formatted
// DD/Mon in the active locale (e.g. "17/Jun" / "17/Jun").
function dueLabel(daysUntil: number, lang: Lang): string {
  const d = new Date(Date.now() + daysUntil * 86_400_000);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d
    .toLocaleDateString(lang === "pt" ? "pt-BR" : "en-US", { month: "short" })
    .replace(".", "");
  return `${day}/${mon.charAt(0).toUpperCase()}${mon.slice(1)}`;
}

// ─── COMPONENTE SAS PASSPORT ULTRA CHAMATIVO (AGORA É UM BOTÃO) ────────────
function CompactPassport({
  score,
  passportId,
  theme,
  lang,
}: {
  score: number;
  passportId: string;
  theme: string;
  lang: Lang;
}) {
  // Highest tier whose threshold the score clears (1-4), and the fill % on
  // the 0-PASSPORT_MAX_SCORE scale — keeps the label + bar in sync.
  const tier = [...PASSPORT_TIERS].reverse().find((t) => score >= t.min) ?? PASSPORT_TIERS[0];
  const pct = Math.max(0, Math.min(100, (score / PASSPORT_MAX_SCORE) * 100));
  return (
    <Link
      href="/reputacao"
      className={`relative group overflow-hidden border p-4 sm:p-5 rounded-2xl h-full w-full flex flex-col justify-between transition-all duration-500 hover:scale-[1.02] cursor-pointer block ${
        theme === "light"
          ? "bg-white border-black/10 shadow-lg"
          : "bg-[#0C1018] border-white/10 shadow-[0_0_30px_rgba(153,69,255,0.15)]"
      }`}
    >
      {/* Efeito de Brilho Animado no Fundo */}
      <div className="absolute -top-10 -left-10 w-32 h-32 bg-[#9945FF] opacity-20 blur-[60px] animate-pulse pointer-events-none"></div>
      <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-[#14F195] opacity-10 blur-[60px] animate-pulse pointer-events-none"></div>

      {/* Reflexo de Luz (Shine Effect) */}
      <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 pointer-events-none"></div>

      <div className="flex items-center justify-between relative z-10 mb-2">
        <div className="flex flex-col">
          <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r from-[#9945FF] to-[#14F195]">
            SAS Digital Passport
          </span>
          <span className="text-[7px] sm:text-[8px] text-gray-500 font-mono">ID: {passportId}</span>
        </div>
        <div className="w-2.5 h-2.5 rounded-full bg-[#14F195] shadow-[0_0_10px_#14F195] animate-pulse"></div>
      </div>

      <div className="flex items-end gap-2 my-auto relative z-10">
        <span
          className={`text-5xl sm:text-[3.375rem] font-black italic tracking-tighter transition-colors ${theme === "light" ? "text-black" : "text-white"}`}
        >
          {score}
        </span>
        <div className="flex flex-col">
          <span className="text-[9px] sm:text-[10px] text-[#14F195] font-black italic leading-none">
            TRUSTED
          </span>
          <span className="text-[9px] sm:text-[10px] text-gray-500 font-bold italic">SCORE</span>
        </div>
      </div>

      <div className="mt-2 relative z-10">
        <div className="flex justify-between text-[7px] sm:text-[8px] mb-1 font-bold text-gray-500 uppercase">
          <span>{tr(lang, "passport.tier")}</span>
          <span className="text-[#9945FF]">
            Tier {tier.level} / {tr(lang, `tier.${tier.level}`)}
          </span>
        </div>
        <div className="relative w-full bg-white/5 h-1.5 rounded-full overflow-hidden border border-white/5">
          <div
            className="bg-gradient-to-r from-[#9945FF] via-[#14F195] to-[#9945FF] h-full bg-[length:200%_auto] animate-gradient-x"
            style={{ width: `${pct}%` }}
          ></div>
          {/* Tier boundary ticks (T2 / T3 / T4) so the 4-tier scale reads
              correctly across the bar. */}
          {PASSPORT_TIERS.slice(1).map((tt) => (
            <span
              key={tt.level}
              className="absolute top-0 bottom-0 w-px bg-white/25"
              style={{ left: `${(tt.min / PASSPORT_MAX_SCORE) * 100}%` }}
            />
          ))}
        </div>
      </div>
    </Link>
  );
}

// ─── CARD DE GRUPO (VÁLVULA DE ESCAPE) ───────────────────────────
function GroupCard({
  g,
  month,
  theme,
  lang,
}: {
  g: ActiveGroup;
  month: number;
  theme: string;
  lang: Lang;
}) {
  const [payOpen, setPayOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const dueDate = dueLabel(g.nextDue, lang);
  const tone = TONE_HEX[g.tone];
  // The user's cota in this cycle, shaped for the escape-valve sell flow.
  // Face value = the prize; SellShareModal applies the discount slider on top.
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
      className={`border p-4 rounded-xl flex items-center justify-between gap-4 transition-all w-full ${theme === "light" ? "bg-white border-black/5 shadow-sm" : "bg-white/5 border-white/10 hover:bg-white/[0.08]"}`}
    >
      <div className="flex items-center gap-3 min-w-[150px]">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base"
          style={{ background: `${tone}1A`, border: `1px solid ${tone}40` }}
        >
          {g.emoji}
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[9px] text-gray-500 uppercase font-bold tracking-tight">
            {tr(lang, "card.quota")}
          </span>
          <h4
            className={`text-xs font-bold truncate ${theme === "light" ? "text-[#2A2E38]" : "text-white"}`}
          >
            {g.name}
          </h4>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-1 hidden sm:flex">
        <div className="flex justify-between text-[9px] font-mono">
          <span className="text-gray-400">{tr(lang, "card.progress")}</span>
          <span className="font-bold" style={{ color: tone }}>
            {month}/{g.total}
          </span>
        </div>
        <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
          <div
            className="h-full"
            style={{ background: tone, width: `${(month / g.total) * 100}%` }}
          ></div>
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <div className="text-right flex flex-col">
          <span className="text-[8px] text-gray-500 uppercase">{tr(lang, "card.due")}</span>
          <span
            className={`text-[10px] font-mono font-bold ${theme === "light" ? "text-[#2A2E38]" : "text-white"}`}
          >
            {dueDate}
          </span>
        </div>

        <div className="flex gap-2">
          {/* PAGAR → opens the real PayInstallmentModal (mock / on-chain). */}
          <button
            onClick={() => setPayOpen(true)}
            className="rounded-xl bg-gradient-to-b from-[#14F195] to-[#0FCB7E] px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#04130D] [font-family:var(--font-dm-sans)] shadow-[0_4px_14px_rgba(20,241,149,0.28)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_22px_rgba(20,241,149,0.45)] active:translate-y-0 active:scale-[0.98]"
          >
            {tr(lang, "card.pay")}
          </button>
          {/* VENDER → opens the real SellShareModal (escape valve). */}
          <button
            onClick={() => setSellOpen(true)}
            className="rounded-xl border border-[#FF7A7A]/25 bg-[#FF7A7A]/[0.08] px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#FF9090] [font-family:var(--font-dm-sans)] transition-all duration-200 hover:border-[#FF7A7A]/45 hover:bg-[#FF7A7A]/15 hover:text-[#FFB0B0] active:scale-[0.98]"
          >
            {tr(lang, "card.sell")}
          </button>
        </div>
      </div>

      <PayInstallmentModal group={g} open={payOpen} onClose={() => setPayOpen(false)} />
      <SellShareModal position={sellPosition} open={sellOpen} onClose={() => setSellOpen(false)} />
    </div>
  );
}

export default function HomeV2Page() {
  const { lang, fmtMoney } = useI18n();
  const { user, monthsPaidByGroup, claimedGroups } = useSession();

  // Theme is locked to dark — the page bg stays the brand ground color.
  // (The ☀️/🌙 screen-tint chip was removed; the global app theme owns
  // the shared TopBar controls below.)
  const [theme] = useState("dark");
  const [liveBalance, setLiveBalance] = useState(user.balance + user.yield);

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveBalance((prev) => prev + Math.random() * 0.005);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const tx = (key: string) => tr(lang, key);

  // Shared props for the three KPI cards: white-outline hover that lingers
  // ~200ms before fading, plus a larger title (label 9px -> 12px).
  const kpiHover = {
    hoverBorderColor: "rgba(255,255,255,0.6)",
    hoverReturnDelayMs: 200,
    labelSize: 12,
  };

  // "À Receber" = prizes of active cycles you haven't been drawn for /
  // claimed yet — the credit still coming to you.
  const receivable = ACTIVE_GROUPS.filter(
    (g) => g.status !== "drawn" && !claimedGroups.includes(g.name),
  ).reduce((sum, g) => sum + g.prize, 0);

  return (
    <div
      className={`min-h-screen flex flex-col transition-colors duration-500 ${theme === "light" ? "bg-[#F5F1EA] text-[#2A2E38]" : "bg-[#06090F] text-[#EEF0F8]"}`}
    >
      {/* Same shared TopBar every other dashboard route renders — guarantees
          an identical header (size + chrome) when navigating in/out of v2. */}
      <TopBar />

      <main className="flex-1 p-4 md:p-8 max-w-6xl mx-auto w-full flex flex-col gap-8 animate-in fade-in duration-700">
        <HomeHero />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 auto-rows-fr items-stretch">
          <div className="h-full w-full [&>div]:h-full [&>div]:w-full">
            <DeskKpi
              label={tx("kpi.balance")}
              value={fmtMoney(liveBalance)}
              numericValue={liveBalance}
              delta=""
              tone="g"
              href="/carteira"
              {...kpiHover}
            />
          </div>
          <div className="h-full w-full [&>div]:h-full [&>div]:w-full">
            <DeskKpi
              label={tx("kpi.receivable")}
              value={fmtMoney(receivable)}
              numericValue={receivable}
              delta=""
              tone="p"
              {...kpiHover}
            />
          </div>
          <div className="h-full w-full [&>div]:h-full [&>div]:w-full">
            <DeskKpi
              label={tx("kpi.collateral")}
              value={`${user.colateralPct}%`}
              numericValue={user.colateralPct}
              delta=""
              tone="a"
              {...kpiHover}
            />
          </div>
          <div className="h-full w-full">
            <CompactPassport
              score={user.score}
              passportId={user.walletShort}
              theme={theme}
              lang={lang}
            />
          </div>
        </div>

        <div
          className={`p-8 rounded-[2.5rem] border transition-all duration-300 delay-200 ease-out hover:delay-0 hover:duration-200 hover:-translate-y-0.5 ${theme === "light" ? "bg-white border-black/5 shadow-md hover:border-black/30" : "bg-white/[0.02] border-white/5 shadow-2xl hover:border-white/40"}`}
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500">
              {tx("cycles.title")}
            </h3>
            <span className="text-[10px] text-[#14F195] bg-[#14F195]/10 px-3 py-1 rounded-full font-mono font-black uppercase border border-[#14F195]/20">
              {tx("cycles.escrow")}
            </span>
          </div>

          {ACTIVE_GROUPS.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <div className="text-3xl opacity-70">🪙</div>
              <p className="text-sm text-gray-400">{tx("cycles.empty.title")}</p>
              <Link
                href="/grupos"
                className="rounded-xl border border-[#14F195]/30 bg-[#14F195]/10 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-[#14F195] transition-all hover:bg-[#14F195]/20"
              >
                {tx("cycles.empty.cta")}
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {ACTIVE_GROUPS.map((g) => {
                // Live month overlay — advances as installments are paid this
                // session (same pattern as the real /home GroupRow).
                const month = Math.min(g.total, g.month + (monthsPaidByGroup[g.name] ?? 0));
                return <GroupCard key={g.id} g={g} month={month} theme={theme} lang={lang} />;
              })}
            </div>
          )}
        </div>

        <div
          className={`p-8 rounded-[2.5rem] border transition-all duration-300 delay-200 ease-out hover:delay-0 hover:duration-200 hover:-translate-y-0.5 ${theme === "light" ? "bg-white border-black/5 hover:border-black/30" : "bg-white/[0.01] border-white/5 hover:border-white/40"}`}
        >
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500 mb-6 flex items-center gap-3">
            <span className="flex h-2 w-2 rounded-full bg-[#14F195] shadow-[0_0_8px_#14F195]"></span>
            Protocol Live Activity
          </h3>
          <Activity />
        </div>
      </main>

      <footer className="p-10 text-center text-[10px] text-gray-500 uppercase font-black tracking-[0.3em] border-t border-white/5 mt-auto">
        © 2026 RoundFi Protocol · Built on Solana
      </footer>

      <style jsx global>{`
        @keyframes gradient-x {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
        .animate-gradient-x {
          animation: gradient-x 3s ease infinite;
        }
        ::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(20, 241, 149, 0.1);
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}
