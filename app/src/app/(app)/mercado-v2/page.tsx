"use client";

// /mercado-v2 — VISUAL-FIRST preview of the team's new Mercado secundário design.
//
// Lives inside the (app) route group so it inherits the DeskShell TopBar +
// shared dark ground; the real /mercado and main stay untouched until this
// graduates. Self-contained mock data (as the design shipped it). The tab
// (Comprar / Vender) and the category filter are functional client-side;
// emoji glyphs are swapped for the project's stroke icon set + a couple of
// local glyphs (play / search).
//
// Visual-only on the on-chain side: "Comprar" / "Garantir agora" are static —
// the re-wire pass connects them to the real buy/escape-valve modals + market
// data, then it graduates onto /mercado.

import { useMemo, useState } from "react";

import { Icons } from "@/components/brand/icons";

type MarketOffer = {
  id: string;
  num: string;
  group: string;
  month: number;
  total: number;
  face: number;
  price: number;
  disc: number;
};

const MARKET_OFFERS: MarketOffer[] = [
  {
    id: "m1",
    num: "02",
    group: "Intercâmbio 2026",
    month: 2,
    total: 12,
    face: 1640,
    price: 1440,
    disc: 12.2,
  },
  {
    id: "m2",
    num: "05",
    group: "Renovação MEI",
    month: 4,
    total: 12,
    face: 892,
    price: 812,
    disc: 9.0,
  },
  {
    id: "m3",
    num: "11",
    group: "PME · Capital de Giro",
    month: 7,
    total: 18,
    face: 1520,
    price: 1320,
    disc: 13.2,
  },
  {
    id: "m4",
    num: "04",
    group: "Dev Setup · 6m",
    month: 3,
    total: 6,
    face: 1840,
    price: 1620,
    disc: 12.0,
  },
  {
    id: "m5",
    num: "08",
    group: "Reforma Casa",
    month: 5,
    total: 24,
    face: 1200,
    price: 1092,
    disc: 9.0,
  },
  {
    id: "m6",
    num: "14",
    group: "Enxoval · 6m",
    month: 4,
    total: 6,
    face: 740,
    price: 680,
    disc: 8.1,
  },
];

const FEATURED_OFFER = {
  id: "featured-1",
  group: "Dev Setup · cota #04",
  monthsLeft: 4,
  sellerScore: 712,
  face: 1840,
  price: 1620,
  effectiveDiscount: 12,
  fillPct: 88,
  apyEquivalent: 7.8,
};

const categories = ["Todas", "PME", "Casa", "Dev", "Pessoal", "Delivery"];

// Category → stroke icon + accent (replaces the design's emoji glyphs).
const CAT_ICON: Record<string, string> = {
  PME: "trend",
  Casa: "home",
  Dev: "cubes",
  Delivery: "bolt",
  Pessoal: "spark",
};
const CAT_COLOR: Record<string, string> = {
  PME: "#14F195",
  Casa: "#00C8FF",
  Dev: "#9945FF",
  Delivery: "#FFB547",
  Pessoal: "#FF5BAA",
};

const fmtBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);

const categoryFor = (offer: MarketOffer) => {
  const name = offer.group.toLowerCase();
  if (name.includes("pme")) return "PME";
  if (name.includes("casa") || name.includes("reforma")) return "Casa";
  if (name.includes("dev")) return "Dev";
  if (name.includes("delivery") || name.includes("enxoval")) return "Delivery";
  return "Pessoal";
};

const apyFor = (offer: MarketOffer) => Number((6.4 + offer.disc / 8).toFixed(1));

function PlayIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.4v13.2l11-6.6z" />
    </svg>
  );
}

function SearchIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function MiniStat({
  label,
  value,
  helper,
  tone = "green",
}: {
  label: string;
  value: string;
  helper: string;
  tone?: "green" | "cyan" | "purple" | "amber";
}) {
  const toneClass = {
    green: "text-[#14F195]",
    cyan: "text-[#00C8FF]",
    purple: "text-[#9945FF]",
    amber: "text-[#FFB547]",
  }[tone];

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.18)] transition hover:-translate-y-0.5 hover:border-white/[0.16]">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className="mt-4 text-3xl font-black tracking-tight text-white">{value}</div>
      <div className={`mt-2 text-sm font-bold ${toneClass}`}>{helper}</div>
    </div>
  );
}

function OfferRow({ offer }: { offer: MarketOffer }) {
  const economy = offer.face - offer.price;
  const apy = apyFor(offer);
  const cat = categoryFor(offer);
  const color = CAT_COLOR[cat] ?? "#14F195";
  const Ic = Icons[CAT_ICON[cat] ?? "spark"];

  return (
    <div className="grid grid-cols-[1.6fr_0.55fr_0.75fr_0.8fr_0.65fr_0.7fr] items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.035] p-4 transition hover:border-[#14F195]/30 hover:bg-white/[0.055]">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border"
          style={{ background: `${color}14`, borderColor: `${color}33` }}
        >
          {Ic ? <Ic size={20} stroke={color} sw={2} /> : null}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-extrabold text-white">{offer.group}</div>
          <div className="mt-0.5 text-xs text-slate-500">Cota #{offer.num}</div>
        </div>
      </div>
      <div>
        <div className="text-sm font-bold text-white">{offer.total - offer.month}m</div>
        <div className="text-xs text-slate-500">
          {offer.month}/{offer.total}
        </div>
      </div>
      <div>
        <div className="inline-flex rounded-lg bg-[#14F195]/10 px-2.5 py-1 text-sm font-black text-[#14F195]">
          -{offer.disc.toFixed(1).replace(".0", "")}%
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">vs nominal</div>
      </div>
      <div>
        <div className="text-sm font-black text-white">{fmtBRL(economy)}</div>
        <div className="text-xs text-slate-500">economia</div>
      </div>
      <div>
        <div className="text-sm font-black text-white">{apy}%</div>
        <div className="text-xs text-slate-500">a.a.</div>
      </div>
      <button className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-bold text-white transition hover:border-[#14F195]/50 hover:bg-[#14F195]/10 hover:text-[#14F195]">
        Comprar
      </button>
    </div>
  );
}

function FeaturedOfferCard() {
  const economy = FEATURED_OFFER.face - FEATURED_OFFER.price;
  return (
    <aside className="rounded-[2rem] border border-[#9945FF]/35 bg-[radial-gradient(circle_at_25%_0%,rgba(153,69,255,0.22),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.025))] p-7 shadow-[0_0_70px_rgba(153,69,255,0.12)]">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#C084FC]">
        ◆ Oportunidade em destaque
      </div>
      <h2 className="mt-6 text-2xl font-black tracking-tight text-white">{FEATURED_OFFER.group}</h2>
      <p className="mt-2 text-sm text-slate-400">Desconto elevado e alta demanda por essa cota.</p>

      <div className="mt-8 rounded-2xl border border-white/[0.08] bg-black/[0.18] p-5">
        <div className="flex items-center justify-between text-xs uppercase tracking-[0.13em] text-slate-500">
          <span>Valor original</span>
          <span className="rounded-lg bg-[#14F195]/10 px-2 py-1 font-black text-[#14F195]">
            -{FEATURED_OFFER.effectiveDiscount}% de desconto
          </span>
        </div>
        <div className="mt-2 text-xl font-bold text-slate-500 line-through decoration-slate-600">
          {fmtBRL(FEATURED_OFFER.face)}
        </div>

        <div className="mt-6 text-xs uppercase tracking-[0.13em] text-slate-500">
          Valor com desconto
        </div>
        <div className="mt-1 text-4xl font-black tracking-tight text-white">
          {fmtBRL(FEATURED_OFFER.price)}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.13em] text-slate-500">Economia</div>
            <div className="mt-1 text-lg font-black text-[#14F195]">{fmtBRL(economy)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.13em] text-slate-500">Taxa P2P</div>
            <div className="mt-1 text-lg font-black text-[#14F195]">
              {FEATURED_OFFER.apyEquivalent}% a.a.
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.13em] text-slate-500">Prazo restante</div>
            <div className="mt-1 text-lg font-black text-white">
              {FEATURED_OFFER.monthsLeft} meses
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.13em] text-slate-500">Score vendedor</div>
            <div className="mt-1 text-lg font-black text-white">{FEATURED_OFFER.sellerScore}</div>
          </div>
        </div>
      </div>

      <button className="mt-6 w-full rounded-2xl bg-gradient-to-r from-[#9945FF] to-[#00C8FF] px-5 py-4 text-sm font-black text-white shadow-[0_10px_35px_rgba(0,200,255,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_45px_rgba(0,200,255,0.34)]">
        Garantir agora
      </button>
    </aside>
  );
}

function HowItWorks() {
  const steps: ReadonlyArray<readonly [string, string, string]> = [
    ["eye", "Encontre uma cota", "Veja cotas disponíveis com desconto."],
    ["shield", "Analise os detalhes", "Confira prazo, desconto, taxa P2P e parcelas restantes."],
    ["wallet", "Garanta sua cota", "Pague com segurança e assuma a posição na rosca."],
    ["trend", "Continue recebendo", "Siga o ciclo normalmente e receba ao final do período."],
  ];

  return (
    <section className="rounded-[2rem] border border-white/[0.07] bg-white/[0.025] p-7">
      <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
        Como funciona o mercado secundário
      </h3>
      <div className="mt-8 grid gap-6 md:grid-cols-4">
        {steps.map(([icon, title, desc], index) => {
          const Ic = Icons[icon];
          return (
            <div key={title} className="relative">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#14F195]/20 bg-[#14F195]/[0.08] text-[#14F195]">
                {Ic ? <Ic size={20} stroke="#14F195" sw={1.9} /> : index + 1}
              </div>
              <div className="text-base font-black text-white">{title}</div>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function MercadoV2Page() {
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [category, setCategory] = useState("Todas");

  const offers = useMemo(() => {
    return MARKET_OFFERS.filter(
      (offer) => category === "Todas" || categoryFor(offer) === category,
    ).sort((a, b) => b.disc - a.disc);
  }, [category]);

  const avgEconomy =
    MARKET_OFFERS.reduce((sum, offer) => sum + (offer.face - offer.price), 0) /
    MARKET_OFFERS.length;
  const avgApy =
    MARKET_OFFERS.reduce((sum, offer) => sum + apyFor(offer), 0) / MARKET_OFFERS.length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-8 text-white animate-in fade-in duration-700 md:px-8">
      <header className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-[#14F195]">
            ◆ Mercado secundário
          </div>
          <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-[-0.045em] text-white [font-family:var(--font-syne),sans-serif] md:text-5xl">
            Compre posições com desconto
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            Adquira cotas de grupos pagando até 45% abaixo do valor nominal.
          </p>
        </div>
        <button className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#14F195]/25 bg-[#14F195]/[0.08] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#14F195]/[0.14]">
          <span className="text-[#14F195]">
            <PlayIcon />
          </span>
          Como funciona
        </button>
      </header>

      <div className="flex w-fit rounded-2xl border border-white/[0.07] bg-white/[0.035] p-1">
        <button
          onClick={() => setTab("buy")}
          className={`rounded-xl px-5 py-3 text-sm font-black transition ${tab === "buy" ? "bg-[#14F195]/[0.14] text-[#14F195] shadow-[0_0_24px_rgba(20,241,149,0.14)]" : "text-slate-400 hover:text-white"}`}
        >
          Comprar cotas
        </button>
        <button
          onClick={() => setTab("sell")}
          className={`rounded-xl px-5 py-3 text-sm font-black transition ${tab === "sell" ? "bg-[#14F195]/[0.14] text-[#14F195]" : "text-slate-400 hover:text-white"}`}
        >
          Vender cotas
        </button>
      </div>

      {tab === "sell" ? (
        <section className="flex flex-col items-center rounded-[2rem] border border-white/[0.07] bg-white/[0.025] p-10 text-center">
          <span className="text-[#14F195]">
            <Icons.ticket size={40} stroke="currentColor" sw={1.6} />
          </span>
          <h2 className="mt-5 text-2xl font-black text-white">Suas cotas à venda</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">
            Aqui entra a lista de posições do usuário e o fluxo de venda. O layout de compra já está
            pronto para plugar os componentes depois.
          </p>
        </section>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <MiniStat
              label="Descontos médios"
              value={`até ${Math.round(Math.max(...MARKET_OFFERS.map((o) => o.disc)))}%`}
              helper="sobre o valor nominal"
            />
            <MiniStat
              label="Cotas disponíveis"
              value={`${MARKET_OFFERS.length * 4 + 3}`}
              helper="em aberto"
              tone="cyan"
            />
            <MiniStat
              label="Economia média"
              value={fmtBRL(avgEconomy)}
              helper="por cota"
              tone="amber"
            />
            <MiniStat
              label="Taxa média P2P"
              value={`${avgApy.toFixed(1).replace(".", ",")}%`}
              helper="a.a. estimado"
              tone="purple"
            />
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.6fr_0.9fr]">
            <div className="rounded-[2rem] border border-white/[0.07] bg-white/[0.025] p-3 md:p-5">
              <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap gap-2">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setCategory(cat)}
                      className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide transition ${category === cat ? "bg-[#14F195]/[0.14] text-[#14F195]" : "bg-white/[0.04] text-slate-400 hover:text-white"}`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <button
                  className="flex items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-slate-300 transition hover:text-white"
                  aria-label="Buscar"
                >
                  <SearchIcon size={16} />
                </button>
              </div>

              <div className="hidden grid-cols-[1.6fr_0.55fr_0.75fr_0.8fr_0.65fr_0.7fr] gap-3 px-4 pb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-600 md:grid">
                <span>Grupo</span>
                <span>Prazo</span>
                <span>Desconto</span>
                <span>Economia</span>
                <span>Taxa P2P</span>
                <span>Disponível</span>
              </div>

              <div className="flex flex-col gap-2">
                {offers.map((offer) => (
                  <OfferRow key={offer.id} offer={offer} />
                ))}
              </div>

              <button className="mx-auto mt-5 flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-5 py-3 text-sm font-bold text-slate-300 transition hover:border-white/[0.18] hover:text-white">
                Ver mais oportunidades
                <Icons.arrow size={14} stroke="currentColor" sw={2.4} style={{ rotate: "90deg" }} />
              </button>
            </div>

            <div className="flex flex-col gap-5">
              <FeaturedOfferCard />

              <div className="rounded-[2rem] border border-white/[0.07] bg-white/[0.025] p-6">
                <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-[#14F195]">
                  Por que comprar aqui?
                </h3>
                <ul className="mt-5 space-y-3 text-sm text-slate-300">
                  {[
                    "Descontos reais de outros participantes",
                    "Mesmo nível de segurança do grupo original",
                    "Você assume o lugar do vendedor na rosca",
                    "Rentabilidade P2P acima da média",
                    "Processo seguro com garantia RoundFi",
                  ].map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-0.5 text-[#14F195]">
                        <Icons.check size={15} stroke="currentColor" sw={2.6} />
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <HowItWorks />

          <footer className="flex flex-col gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 text-sm text-slate-400 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-[#14F195]">
                <Icons.shield size={16} stroke="currentColor" sw={1.8} />
              </span>
              Ambiente 100% seguro · Todas as transações são protegidas pela RoundFi
            </div>
            <button className="font-bold text-[#14F195] transition-colors hover:text-[#00C8FF]">
              Saiba mais sobre segurança →
            </button>
          </footer>
        </>
      )}
    </main>
  );
}
