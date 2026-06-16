"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

import { DeskKpi } from "@/components/home/DeskKpi";
import { HomeHero } from "@/components/home/HomeHero";
import { Activity } from "@/components/home/Activity";
import { RFILogoMark } from "@/components/brand/brand";
import { useI18n, type Currency, type Lang } from "@/lib/i18n";
import { useSession } from "@/lib/session";

// /home-v2 — CANDIDATE dashboard redesign, staged for approval.
//
// This is the "segunda sessão de teste" the operator asked for: the
// proposed new /home model rendered at its OWN route so the live /home
// stays untouched. If approved, this becomes /home — note that the real
// /home lives inside the (app) route group under DeskShell, so the swap
// means either moving /home out of (app) or stripping this page's
// self-contained header/footer to sit inside DeskShell.
//
// Mounted OUTSIDE (app) deliberately: the design ships its own header +
// footer + theme/lang/currency toggles, so it must NOT inherit the
// DeskShell SideNav (which would double the chrome). All providers
// (Session, i18n, theme, wallet) come from the root ClientProviders, so
// useSession() / useI18n() / WalletMultiButton work here standalone.
//
// Refinement round 1 (toward graduating to /home):
//   - real brand logo (RFILogoMark) instead of the placeholder square;
//   - PT/EN toggle wired to the real i18n context (setLang) — drives this
//     page's own copy via the local STRINGS map below AND the shared
//     dict that HomeHero / Activity already read, so the whole page flips;
//   - R$/USDC toggle wired to setCurrency — fmtMoney() reformats live.
// Copy lives in a LOCAL STRINGS map (not the shared dict) to keep the
// candidate self-contained; it ports to DICT when v2 becomes /home.

type V2Strings = Record<string, string>;

const STRINGS: Record<Lang, V2Strings> = {
  pt: {
    "nav.home": "Início",
    "nav.groups": "Buscar Grupos",
    "nav.market": "Mercado",
    "nav.insights": "Insights",
    "nav.wallet": "Carteira",
    "kpi.balance": "Saldo Protegido",
    "kpi.receivable": "À Receber",
    "kpi.collateral": "Colateral Exigido",
    "passport.tier": "Nível de Reputação",
    "passport.tierValue": "Tier 3 / Veterano",
    "cycles.title": "Meus Ciclos de Crédito Ativos",
    "cycles.escrow": "Escrow Verificado",
    "card.quota": "Cota de Crédito",
    "card.progress": "Progresso do Ciclo",
    "card.due": "Vencimento",
    "card.pay": "Pagar",
    "card.sell": "Vender",
  },
  en: {
    "nav.home": "Home",
    "nav.groups": "Find Groups",
    "nav.market": "Market",
    "nav.insights": "Insights",
    "nav.wallet": "Wallet",
    "kpi.balance": "Protected Balance",
    "kpi.receivable": "Receivable",
    "kpi.collateral": "Required Collateral",
    "passport.tier": "Reputation Tier",
    "passport.tierValue": "Tier 3 / Veteran",
    "cycles.title": "My Active Credit Cycles",
    "cycles.escrow": "Escrow Verified",
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

// ─── COMPONENTE DE TOGGLE (IDIOMA / MOEDA) ─────────────────────────────────
function SegToggle({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="flex p-0.5 bg-white/5 border border-white/10 rounded-lg shadow-inner">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`px-3 py-1.5 rounded-md text-[9px] font-black transition-all uppercase tracking-wider ${
            value === o.v
              ? "bg-[#14F195] text-black shadow-[0_0_10px_rgba(20,241,149,0.2)]"
              : "text-gray-500 hover:text-white hover:bg-white/5"
          }`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

// ─── COMPONENTE SAS PASSPORT ULTRA CHAMATIVO (AGORA É UM BOTÃO) ────────────
function CompactPassport({ score, theme, lang }: { score: number; theme: string; lang: Lang }) {
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
          <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r from-[#9945FF] to-[#14F195]">
            SAS Digital Passport
          </span>
          <span className="text-[7px] sm:text-[8px] text-gray-500 font-mono">ID: RND-882-SAS</span>
        </div>
        <div className="w-2.5 h-2.5 rounded-full bg-[#14F195] shadow-[0_0_10px_#14F195] animate-pulse"></div>
      </div>

      <div className="flex items-baseline gap-2 my-auto relative z-10">
        <span
          className={`text-3xl sm:text-4xl font-black italic tracking-tighter transition-colors ${theme === "light" ? "text-black" : "text-white"}`}
        >
          {score}
        </span>
        <div className="flex flex-col">
          <span className="text-[9px] sm:text-[10px] text-[#14F195] font-black leading-none">
            TRUSTED
          </span>
          <span className="text-[9px] sm:text-[10px] text-gray-500 font-bold">SCORE</span>
        </div>
      </div>

      <div className="mt-2 relative z-10">
        <div className="flex justify-between text-[7px] sm:text-[8px] mb-1 font-bold text-gray-500 uppercase">
          <span>{tr(lang, "passport.tier")}</span>
          <span className="text-[#9945FF]">{tr(lang, "passport.tierValue")}</span>
        </div>
        <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden border border-white/5">
          <div
            className="bg-gradient-to-r from-[#9945FF] via-[#14F195] to-[#9945FF] h-full bg-[length:200%_auto] animate-gradient-x"
            style={{ width: `${(score / 1000) * 100}%` }}
          ></div>
        </div>
      </div>
    </Link>
  );
}

// ─── CARD DE GRUPO (VÁLVULA DE ESCAPE) ───────────────────────────
function GroupCard({
  name,
  progress,
  total,
  dueDate,
  theme,
  lang,
}: {
  name: string;
  progress: number;
  total: number;
  dueDate: string;
  theme: string;
  lang: Lang;
}) {
  return (
    <div
      className={`border p-4 rounded-xl flex items-center justify-between gap-4 transition-all w-full ${theme === "light" ? "bg-white border-black/5 shadow-sm" : "bg-white/5 border-white/10 hover:bg-white/[0.08]"}`}
    >
      <div className="flex flex-col gap-0.5 min-w-[140px]">
        <span className="text-[9px] text-gray-500 uppercase font-bold tracking-tight">
          {tr(lang, "card.quota")}
        </span>
        <h4
          className={`text-xs font-bold truncate ${theme === "light" ? "text-[#2A2E38]" : "text-white"}`}
        >
          {name}
        </h4>
      </div>

      <div className="flex-1 flex flex-col gap-1 hidden sm:flex">
        <div className="flex justify-between text-[9px] font-mono">
          <span className="text-gray-400">{tr(lang, "card.progress")}</span>
          <span className="text-[#14F195] font-bold">
            {progress}/{total}
          </span>
        </div>
        <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-[#14F195] h-full"
            style={{ width: `${(progress / total) * 100}%` }}
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
          {/* PAGAR — primary CTA: green gradient fill, soft lift on hover */}
          <button className="rounded-xl bg-gradient-to-b from-[#14F195] to-[#0FCB7E] px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#04130D] [font-family:var(--font-dm-sans)] shadow-[0_4px_14px_rgba(20,241,149,0.28)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_22px_rgba(20,241,149,0.45)] active:translate-y-0 active:scale-[0.98]">
            {tr(lang, "card.pay")}
          </button>
          {/* VENDER — secondary action: soft coral outline, gentle hover */}
          <button className="rounded-xl border border-[#FF7A7A]/25 bg-[#FF7A7A]/[0.08] px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#FF9090] [font-family:var(--font-dm-sans)] transition-all duration-200 hover:border-[#FF7A7A]/45 hover:bg-[#FF7A7A]/15 hover:text-[#FFB0B0] active:scale-[0.98]">
            {tr(lang, "card.sell")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function HomeV2Page() {
  const pathname = usePathname();
  const { lang, currency, setLang, setCurrency, fmtMoney } = useI18n();
  const { user } = useSession();

  const [theme, setTheme] = useState("dark");
  const [liveBalance, setLiveBalance] = useState(user.balance + user.yield);

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveBalance((prev) => prev + Math.random() * 0.005);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const tx = (key: string) => tr(lang, key);

  return (
    <div
      className={`min-h-screen flex flex-col transition-colors duration-500 ${theme === "light" ? "bg-[#F5F1EA] text-[#2A2E38]" : "bg-[#06090F] text-[#EEF0F8]"}`}
    >
      <header
        className={`sticky top-0 z-50 h-20 border-b backdrop-blur-xl px-6 md:px-12 flex items-center ${theme === "light" ? "bg-white/80 border-black/5 shadow-sm" : "bg-[#06090F]/80 border-white/10"}`}
      >
        <Link href="/" className="flex items-center gap-3 shrink-0">
          <RFILogoMark size={32} />
          <h1 className="text-xl font-black italic tracking-tighter hidden sm:block uppercase">
            Round<span className="text-[#14F195]">Fi</span>
          </h1>
        </Link>

        <nav className="flex-1 flex justify-center">
          <div className="flex items-center gap-3 bg-white/5 p-1.5 rounded-2xl border border-white/10 shadow-inner">
            {[
              { id: "home", href: "/" },
              { id: "groups", href: "/grupos" },
              { id: "market", href: "/mercado" },
              { id: "insights", href: "/insights" },
              { id: "wallet", href: "/carteira" },
            ].map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className={`px-6 py-2.5 rounded-xl text-[11px] font-black transition-all uppercase tracking-wider ${
                  pathname === item.href
                    ? "bg-[#14F195] text-black shadow-[0_0_20px_rgba(20,241,149,0.3)]"
                    : "text-gray-400 hover:text-white hover:bg-white/10"
                }`}
              >
                {tx(`nav.${item.id}`)}
              </Link>
            ))}
          </div>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {/* Toggles de Idioma e Moeda — ligados ao contexto i18n real */}
          <div className="hidden xl:flex items-center gap-2">
            <SegToggle
              value={lang}
              onChange={(v) => setLang(v as Lang)}
              options={[
                { v: "pt", l: "PT" },
                { v: "en", l: "EN" },
              ]}
            />
            <SegToggle
              value={currency}
              onChange={(v) => setCurrency(v as Currency)}
              options={[
                { v: "BRL", l: "R$" },
                { v: "USDC", l: "$" },
              ]}
            />
          </div>

          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-sm transition-all active:scale-95"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          <WalletMultiButton
            style={{
              backgroundColor: "#14F195",
              color: "#000",
              borderRadius: "12px",
              fontWeight: "900",
              fontSize: "11px",
              height: "44px",
              padding: "0 24px",
              boxShadow: "0 0 20px rgba(20,241,149,0.2)",
            }}
          />
        </div>
      </header>

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
            />
          </div>
          <div className="h-full w-full [&>div]:h-full [&>div]:w-full">
            <DeskKpi
              label={tx("kpi.receivable")}
              value={fmtMoney(12500)}
              numericValue={12500}
              delta=""
              tone="p"
            />
          </div>
          <div className="h-full w-full [&>div]:h-full [&>div]:w-full">
            <DeskKpi
              label={tx("kpi.collateral")}
              value={`${user.colateralPct}%`}
              numericValue={user.colateralPct}
              delta=""
              tone="a"
            />
          </div>
          <div className="h-full w-full">
            <CompactPassport score={user.score} theme={theme} lang={lang} />
          </div>
        </div>

        <div
          className={`p-8 rounded-[2.5rem] border transition-colors ${theme === "light" ? "bg-white border-black/5 shadow-md" : "bg-white/[0.02] border-white/5 shadow-2xl"}`}
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500">
              {tx("cycles.title")}
            </h3>
            <span className="text-[10px] text-[#14F195] bg-[#14F195]/10 px-3 py-1 rounded-full font-mono font-black uppercase border border-[#14F195]/20">
              {tx("cycles.escrow")}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <GroupCard
              name="Expansão M5 Aço Design"
              progress={4}
              total={12}
              dueDate="12/Mai"
              theme={theme}
              lang={lang}
            />
            <GroupCard
              name="Reserva CoFi Protegida"
              progress={1}
              total={24}
              dueDate="18/Mai"
              theme={theme}
              lang={lang}
            />
          </div>
        </div>

        <div
          className={`p-8 rounded-[2.5rem] border transition-colors ${theme === "light" ? "bg-white border-black/5" : "bg-white/[0.01] border-white/5"}`}
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
