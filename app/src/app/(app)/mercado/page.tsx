"use client";

// /mercado — secondary market for NFT shares ("válvula de escape").
// Graduated from the /mercado-v2 candidate, now on real data.
//
// Buy side reads the shared @/data/market fixtures (MARKET_OFFERS +
// FEATURED_OFFER); sell side reads the live session — your real holdings
// (NFT_POSITIONS ∪ session.acquiredPositions) minus anything already listed,
// plus a "Minhas listagens" section over session.listings with cancel via
// ListingDetailsModal. Every money CTA opens the real modal and persists
// through the session (→ /carteira):
//   - "Comprar" / "Garantir agora" → BuyOfferModal → buyShare()
//   - "Vender" / "Listar agora"    → SellPositionModal → sellShare()
//   - a listing row                → ListingDetailsModal → cancelListing()
// "Como funciona" / "Saiba mais" smooth-scroll to the steps section. Every
// string flows through i18n (marketV2.* + shared market.* atoms) and money
// through fmtMoney, so the TopBar PT/EN + BRL/USDC toggle drives this screen.

import { useMemo, useState } from "react";

import { Icons } from "@/components/brand/icons";
import { BuyOfferModal, type BuyOfferTarget } from "@/components/mercado/BuyOfferModal";
import { ListingDetailsModal } from "@/components/mercado/ListingDetailsModal";
import { SellPositionModal } from "@/components/mercado/SellPositionModal";
import { NFT_POSITIONS, type NftPosition, type Tone } from "@/data/carteira";
import { FEATURED_OFFER, MARKET_OFFERS, type MarketOffer } from "@/data/market";
import { useI18n, useT } from "@/lib/i18n";
import { useSession, type ActiveListing } from "@/lib/session";
import { useDevnetListings } from "@/lib/useDevnetListings";

// Category filter keys (internal) + their i18n label keys.
const categories = ["Todas", "PME", "Casa", "Dev", "Pessoal", "Delivery"];
const CAT_LABEL_KEY: Record<string, string> = {
  Todas: "marketV2.cat.all",
  PME: "marketV2.cat.pme",
  Casa: "marketV2.cat.casa",
  Dev: "marketV2.cat.dev",
  Pessoal: "marketV2.cat.pessoal",
  Delivery: "marketV2.cat.delivery",
};

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

// [icon, titleKey, descKey] — emoji-free; the copy resolves through i18n.
type StepTuple = readonly [icon: string, titleKey: string, descKey: string];

const BUY_STEPS: ReadonlyArray<StepTuple> = [
  ["eye", "marketV2.step.buy.1.t", "marketV2.step.buy.1.d"],
  ["shield", "marketV2.step.buy.2.t", "marketV2.step.buy.2.d"],
  ["wallet", "marketV2.step.buy.3.t", "marketV2.step.buy.3.d"],
  ["trend", "marketV2.step.buy.4.t", "marketV2.step.buy.4.d"],
];

const SELL_STEPS: ReadonlyArray<StepTuple> = [
  ["ticket", "marketV2.step.sell.1.t", "marketV2.step.sell.1.d"],
  ["scales", "marketV2.step.sell.2.t", "marketV2.step.sell.2.d"],
  ["send", "marketV2.step.sell.3.t", "marketV2.step.sell.3.d"],
  ["wallet", "marketV2.step.sell.4.t", "marketV2.step.sell.4.d"],
];

const WHY_BUY = [
  "marketV2.whyBuy.1",
  "marketV2.whyBuy.2",
  "marketV2.whyBuy.3",
  "marketV2.whyBuy.4",
  "marketV2.secureProcess",
];
const WHY_SELL = [
  "marketV2.whySell.1",
  "marketV2.whySell.2",
  "marketV2.whySell.3",
  "marketV2.whySell.4",
  "marketV2.secureProcess",
];

const categoryFor = (group: string) => {
  const name = group.toLowerCase();
  if (name.includes("pme")) return "PME";
  if (name.includes("casa") || name.includes("reforma")) return "Casa";
  if (name.includes("dev")) return "Dev";
  if (name.includes("delivery") || name.includes("enxoval")) return "Delivery";
  return "Pessoal";
};

const apyFor = (offer: MarketOffer) => Number((6.4 + offer.disc / 8).toFixed(1));

// Suggested resale discount for a holding — scales with the term still ahead
// (more cycle left → a touch deeper discount). The seller still sets the final
// price in the modal; this is just the card's hint.
const suggestedDiscFor = (pos: NftPosition) =>
  Math.max(5, Math.round(((pos.total - pos.month) / pos.total) * 12));

// category → Tone letter (drives the modal accent + the carteira position color
// once a buy lands in the session).
const CAT_TONE: Record<string, Tone> = {
  PME: "g",
  Casa: "t",
  Dev: "p",
  Delivery: "a",
  Pessoal: "r",
};
const toneFor = (group: string): Tone => CAT_TONE[categoryFor(group)] ?? "g";

// Adapter: a market offer → the shape BuyOfferModal consumes, so confirming a
// purchase flows through the session (→ /carteira).
function offerToBuyTarget(offer: MarketOffer): BuyOfferTarget {
  return {
    id: offer.id,
    group: offer.group,
    detail: `#${offer.num} · ${offer.month}/${offer.total}`,
    face: offer.face,
    price: offer.price,
    discount: offer.disc,
    num: offer.num,
    month: offer.month,
    total: offer.total,
    tone: toneFor(offer.group),
    // Forwarded for real on-chain listings → drives escape_valve_buy; undefined
    // on demo fixtures (simulated buy).
    onchain: offer.onchain,
  };
}

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

// Colored category well shared by buy + sell rows.
function CatIcon({ group, size = 20 }: { group: string; size?: number }) {
  const cat = categoryFor(group);
  const color = CAT_COLOR[cat] ?? "#14F195";
  const Ic = Icons[CAT_ICON[cat] ?? "spark"];
  return (
    <div
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border"
      style={{ background: `${color}14`, borderColor: `${color}33` }}
    >
      {Ic ? <Ic size={size} stroke={color} sw={2} /> : null}
    </div>
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

function OfferRow({
  offer,
  onBuy,
  purchased,
}: {
  offer: MarketOffer;
  onBuy: (target: BuyOfferTarget) => void;
  purchased: boolean;
}) {
  const { t, fmtMoney } = useI18n();
  const economy = offer.face - offer.price;
  const apy = apyFor(offer);
  return (
    <div className="grid min-w-[600px] grid-cols-[1.6fr_0.55fr_0.75fr_0.8fr_0.65fr_0.7fr] items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.035] p-4 transition hover:border-[#14F195]/30 hover:bg-white/[0.055]">
      <div className="flex min-w-0 items-center gap-3">
        <CatIcon group={offer.group} />
        <div className="min-w-0">
          <div className="truncate text-sm font-extrabold text-white">{offer.group}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {t("marketV2.row.share", { num: offer.num })}
          </div>
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
        <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
          {t("marketV2.row.vsFace")}
        </div>
      </div>
      <div>
        <div className="text-sm font-black text-white">{fmtMoney(economy, { noCents: true })}</div>
        <div className="text-xs text-slate-500">{t("marketV2.row.economy")}</div>
      </div>
      <div>
        <div className="text-sm font-black text-white">{apy}%</div>
        <div className="text-xs text-slate-500">{t("marketV2.row.perYear")}</div>
      </div>
      {purchased ? (
        <span className="inline-flex items-center justify-center rounded-xl border border-[#14F195]/40 bg-[#14F195]/10 px-4 py-2 text-xs font-black text-[#14F195]">
          {t("marketV2.cta.bought")}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onBuy(offerToBuyTarget(offer))}
          className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-bold text-white transition hover:-translate-y-0.5 hover:border-[#14F195]/50 hover:bg-[#14F195]/10 hover:text-[#14F195]"
        >
          {t("marketV2.cta.buy")}
        </button>
      )}
    </div>
  );
}

function SellRow({ pos, onSell }: { pos: NftPosition; onSell: (position: NftPosition) => void }) {
  const { t, fmtMoney } = useI18n();
  const disc = suggestedDiscFor(pos);
  const sellPrice = Math.round(pos.value * (1 - disc / 100));
  return (
    <div className="grid min-w-[520px] grid-cols-[1.7fr_0.6fr_0.85fr_0.95fr_0.7fr] items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.035] p-4 transition hover:border-[#14F195]/30 hover:bg-white/[0.055]">
      <div className="flex min-w-0 items-center gap-3">
        <CatIcon group={pos.group} />
        <div className="min-w-0">
          <div className="truncate text-sm font-extrabold text-white">{pos.group}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {t("marketV2.row.share", { num: pos.num })}
          </div>
        </div>
      </div>
      <div>
        <div className="text-sm font-bold text-white">{pos.total - pos.month}m</div>
        <div className="text-xs text-slate-500">
          {pos.month}/{pos.total}
        </div>
      </div>
      <div>
        <div className="text-sm font-black text-white">
          {fmtMoney(pos.value, { noCents: true })}
        </div>
        <div className="text-xs text-slate-500">{t("marketV2.row.faceValue")}</div>
      </div>
      <div>
        <div className="text-sm font-black text-[#14F195]">
          {fmtMoney(sellPrice, { noCents: true })}
        </div>
        <div className="text-xs text-slate-500">{t("marketV2.row.suggested", { n: disc })}</div>
      </div>
      <button
        type="button"
        onClick={() => onSell(pos)}
        className="rounded-xl bg-gradient-to-r from-[#14F195] to-[#00C8FF] px-4 py-2 text-xs font-black text-[#03130D] transition hover:scale-[1.02] hover:brightness-110"
      >
        {t("marketV2.cta.sell")}
      </button>
    </div>
  );
}

// One row in "Minhas listagens" — opens the listing detail (with cancel).
function ListingRow({
  listing,
  onOpen,
}: {
  listing: ActiveListing;
  onOpen: (l: ActiveListing) => void;
}) {
  const { t, fmtMoney } = useI18n();
  const p = listing.position;
  return (
    <button
      type="button"
      onClick={() => onOpen(listing)}
      className="grid min-w-[460px] grid-cols-[1.7fr_0.9fr_0.9fr_0.6fr] items-center gap-3 rounded-2xl border border-[#14F195]/25 bg-[#14F195]/[0.06] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#14F195]/50"
    >
      <div className="flex min-w-0 items-center gap-3">
        <CatIcon group={p.group} />
        <div className="min-w-0">
          <div className="truncate text-sm font-extrabold text-white">{p.group}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {t("marketV2.row.share", { num: p.num })}
          </div>
        </div>
      </div>
      <div>
        <div className="text-sm font-black text-white">
          {fmtMoney(listing.askPrice, { noCents: true })}
        </div>
        <div className="text-xs text-slate-500">{t("marketV2.resalePrice")}</div>
      </div>
      <div>
        <div className="text-sm font-black text-[#14F195]">
          {listing.discountPct > 0
            ? `−${listing.discountPct.toFixed(0)}%`
            : t("market.listings.facePrice")}
        </div>
        <div className="text-xs text-slate-500">{t("marketV2.col.discount")}</div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="rounded-full bg-[#14F195]/10 px-2.5 py-1 text-[10px] font-black uppercase text-[#14F195]">
          {t("market.listings.statusActive")}
        </span>
        <Icons.arrow size={14} stroke="currentColor" sw={2} />
      </div>
    </button>
  );
}

function FeaturedOfferCard({ onBuy }: { onBuy: (target: BuyOfferTarget) => void }) {
  const { t, fmtMoney } = useI18n();
  const economy = FEATURED_OFFER.face - FEATURED_OFFER.price;
  return (
    <aside className="rounded-[2rem] border border-[#9945FF]/35 bg-[radial-gradient(circle_at_25%_0%,rgba(153,69,255,0.22),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.025))] p-7 shadow-[0_0_70px_rgba(153,69,255,0.12)]">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#C084FC]">
        ◆ {t("marketV2.featBuy.badge")}
      </div>
      <h2 className="mt-6 text-2xl font-black tracking-tight text-white">{FEATURED_OFFER.group}</h2>
      <p className="mt-2 text-sm text-slate-400">{t("marketV2.featBuy.subtitle")}</p>

      <div className="mt-8 rounded-2xl border border-white/[0.08] bg-black/[0.18] p-5">
        <div className="flex items-center justify-between text-xs uppercase tracking-[0.13em] text-slate-500">
          <span>{t("marketV2.feat.original")}</span>
          <span className="rounded-lg bg-[#14F195]/10 px-2 py-1 font-black text-[#14F195]">
            {t("marketV2.feat.discountOff", { n: FEATURED_OFFER.effectiveDiscount })}
          </span>
        </div>
        <div className="mt-2 text-xl font-bold text-slate-500 line-through decoration-slate-600">
          {fmtMoney(FEATURED_OFFER.face, { noCents: true })}
        </div>

        <div className="mt-6 text-xs uppercase tracking-[0.13em] text-slate-500">
          {t("marketV2.feat.discounted")}
        </div>
        <div className="mt-1 text-4xl font-black tracking-tight text-white">
          {fmtMoney(FEATURED_OFFER.price, { noCents: true })}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.13em] text-slate-500">
              {t("marketV2.economy")}
            </div>
            <div className="mt-1 text-lg font-black text-[#14F195]">
              {fmtMoney(economy, { noCents: true })}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.13em] text-slate-500">
              {t("marketV2.p2p")}
            </div>
            <div className="mt-1 text-lg font-black text-[#14F195]">
              {t("marketV2.feat.perYear", { n: FEATURED_OFFER.apyEquivalent })}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.13em] text-slate-500">
              {t("marketV2.termLeft")}
            </div>
            <div className="mt-1 text-lg font-black text-white">
              {t("marketV2.months", { n: FEATURED_OFFER.monthsLeft })}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.13em] text-slate-500">
              {t("marketV2.feat.sellerScore")}
            </div>
            <div className="mt-1 text-lg font-black text-white">{FEATURED_OFFER.sellerScore}</div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          onBuy({
            id: FEATURED_OFFER.id,
            group: FEATURED_OFFER.group,
            detail: t("marketV2.months", { n: FEATURED_OFFER.monthsLeft }),
            face: FEATURED_OFFER.face,
            price: FEATURED_OFFER.price,
            discount: FEATURED_OFFER.effectiveDiscount,
            tone: "p",
          })
        }
        className="mt-6 w-full rounded-2xl bg-gradient-to-r from-[#9945FF] to-[#00C8FF] px-5 py-4 text-sm font-black text-white shadow-[0_10px_35px_rgba(0,200,255,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_45px_rgba(0,200,255,0.34)]"
      >
        {t("marketV2.cta.secure")}
      </button>
    </aside>
  );
}

function FeaturedSellCard({
  positions,
  onSell,
}: {
  positions: NftPosition[];
  onSell: (position: NftPosition) => void;
}) {
  const { t, fmtMoney } = useI18n();
  const best = [...positions].sort((a, b) => b.value - a.value)[0]!;
  const disc = suggestedDiscFor(best);
  const sellPrice = Math.round(best.value * (1 - disc / 100));
  return (
    <aside className="rounded-[2rem] border border-[#14F195]/35 bg-[radial-gradient(circle_at_25%_0%,rgba(20,241,149,0.18),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.025))] p-7 shadow-[0_0_70px_rgba(20,241,149,0.12)]">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#14F195]">
        ◆ {t("marketV2.featSell.badge")}
      </div>
      <h2 className="mt-6 text-2xl font-black tracking-tight text-white">{best.group}</h2>
      <p className="mt-2 text-sm text-slate-400">{t("marketV2.featSell.subtitle")}</p>

      <div className="mt-8 rounded-2xl border border-white/[0.08] bg-black/[0.18] p-5">
        <div className="flex items-center justify-between text-xs uppercase tracking-[0.13em] text-slate-500">
          <span>{t("marketV2.faceValue")}</span>
          <span className="rounded-lg bg-[#14F195]/10 px-2 py-1 font-black text-[#14F195]">
            {t("marketV2.row.suggested", { n: disc })}
          </span>
        </div>
        <div className="mt-2 text-xl font-bold text-slate-500 line-through decoration-slate-600">
          {fmtMoney(best.value, { noCents: true })}
        </div>

        <div className="mt-6 text-xs uppercase tracking-[0.13em] text-slate-500">
          {t("marketV2.resalePrice")}
        </div>
        <div className="mt-1 text-4xl font-black tracking-tight text-white">
          {fmtMoney(sellPrice, { noCents: true })}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.13em] text-slate-500">
              {t("marketV2.featSell.youReceive")}
            </div>
            <div className="mt-1 text-lg font-black text-[#14F195]">
              {fmtMoney(sellPrice, { noCents: true })}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.13em] text-slate-500">
              {t("marketV2.termLeft")}
            </div>
            <div className="mt-1 text-lg font-black text-white">
              {t("marketV2.months", { n: best.total - best.month })}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.13em] text-slate-500">
              {t("marketV2.featSell.share")}
            </div>
            <div className="mt-1 text-lg font-black text-white">#{best.num}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.13em] text-slate-500">
              {t("marketV2.featSell.progress")}
            </div>
            <div className="mt-1 text-lg font-black text-white">
              {best.month}/{best.total}
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onSell(best)}
        className="mt-6 w-full rounded-2xl bg-gradient-to-r from-[#14F195] to-[#00C8FF] px-5 py-4 text-sm font-black text-[#03130D] shadow-[0_10px_35px_rgba(20,241,149,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_45px_rgba(20,241,149,0.34)]"
      >
        {t("marketV2.cta.list")}
      </button>
    </aside>
  );
}

function WhyCard({ titleKey, itemKeys }: { titleKey: string; itemKeys: readonly string[] }) {
  const t = useT();
  return (
    <div className="rounded-[2rem] border border-white/[0.07] bg-white/[0.025] p-6">
      <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-[#14F195]">
        {t(titleKey)}
      </h3>
      <ul className="mt-5 space-y-3 text-sm text-slate-300">
        {itemKeys.map((key) => (
          <li key={key} className="flex gap-3">
            <span className="mt-0.5 text-[#14F195]">
              <Icons.check size={15} stroke="currentColor" sw={2.6} />
            </span>
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HowItWorks({
  id,
  titleKey,
  steps,
}: {
  id?: string;
  titleKey: string;
  steps: ReadonlyArray<StepTuple>;
}) {
  const t = useT();
  return (
    <section id={id} className="rounded-[2rem] border border-white/[0.07] bg-white/[0.025] p-7">
      <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
        {t(titleKey)}
      </h3>
      <div className="mt-8 grid gap-6 md:grid-cols-4">
        {steps.map(([icon, stepTitleKey, descKey], index) => {
          const Ic = Icons[icon];
          return (
            <div key={stepTitleKey} className="relative">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-xs font-black text-slate-300">
                  {index + 1}
                </span>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#14F195]/20 bg-[#14F195]/[0.08] text-[#14F195]">
                  {Ic ? <Ic size={20} stroke="#14F195" sw={1.9} /> : null}
                </span>
              </div>
              <div className="text-base font-black text-white">{t(stepTitleKey)}</div>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{t(descKey)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function MercadoPage() {
  const { t, fmtMoney, lang } = useI18n();
  const {
    buyShare,
    sellShare,
    cancelListing,
    listings,
    acquiredPositions,
    purchasedOfferIds,
    demoActive,
  } = useSession();
  // Real (non-demo) secondary market: live on-chain escape-valve listings,
  // scanned only when NOT in demo so demo sessions skip the getProgramAccounts.
  const liveListings = useDevnetListings(!demoActive);
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [category, setCategory] = useState("Todas");
  const [buying, setBuying] = useState<BuyOfferTarget | null>(null);
  const [selling, setSelling] = useState<NftPosition | null>(null);
  const [openListing, setOpenListing] = useState<ActiveListing | null>(null);
  const purchasedSet = new Set(purchasedOfferIds);

  // Locale-aware one-decimal percentage (PT comma / EN dot).
  const pct1 = (n: number) => n.toFixed(1).replace(".", lang === "pt" ? "," : ".");

  // "Como funciona" / "Saiba mais" jump to the steps section.
  const scrollToHow = () =>
    document.getElementById("mv2-how")?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Buy side: demo shows the pitch fixtures; a real (non-demo) wallet sees the
  // genuine on-chain escape-valve listings (useDevnetListings) — never the
  // fixtures, which a tester once mistook for real cotas. An empty real market
  // (no one has listed yet) falls through to the honest empty state below.
  const offers = useMemo(() => {
    const source = demoActive ? MARKET_OFFERS : liveListings.offers;
    return source
      .filter((offer) => category === "Todas" || categoryFor(offer.group) === category)
      .sort((a, b) => b.disc - a.disc);
  }, [category, demoActive, liveListings.offers]);

  // Sell side = holdings minus anything already listed this session. Demo
  // shows the fixture cotas as sellable; a real wallet only its genuine
  // holdings acquired this session (real on-chain cotas are sold from
  // /carteira). A fresh wallet has nothing to sell here.
  const available = useMemo(() => {
    const listed = new Set(listings.map((l) => l.position.id));
    return [...(demoActive ? NFT_POSITIONS : []), ...acquiredPositions].filter(
      (p) => !listed.has(p.id),
    );
  }, [listings, acquiredPositions, demoActive]);

  // KPIs reflect what's actually for sale: the fixtures in demo, the real
  // on-chain listings otherwise — so the header never advertises a market that
  // isn't there.
  const statOffers = demoActive ? MARKET_OFFERS : liveListings.offers;
  const avgEconomy = statOffers.length
    ? statOffers.reduce((sum, offer) => sum + (offer.face - offer.price), 0) / statOffers.length
    : 0;
  const avgApy = statOffers.length
    ? statOffers.reduce((sum, offer) => sum + apyFor(offer), 0) / statOffers.length
    : 0;

  const myFaceTotal = available.reduce((sum, p) => sum + p.value, 0);
  const myResaleTotal = available.reduce(
    (sum, p) => sum + Math.round(p.value * (1 - suggestedDiscFor(p) / 100)),
    0,
  );
  const myAvgDisc = available.length
    ? available.reduce((sum, p) => sum + suggestedDiscFor(p), 0) / available.length
    : 0;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-8 text-white animate-in fade-in duration-700 md:px-8">
      <header className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-[#14F195]">
            ◆ {t("marketV2.badge")}
          </div>
          <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-[-0.045em] text-white [font-family:var(--font-syne),sans-serif] md:text-5xl">
            {tab === "buy" ? t("marketV2.title.buy") : t("marketV2.title.sell")}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            {tab === "buy" ? t("marketV2.subtitle.buy") : t("marketV2.subtitle.sell")}
          </p>
        </div>
        <button
          type="button"
          onClick={scrollToHow}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#14F195]/25 bg-[#14F195]/[0.08] px-5 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:border-[#14F195]/50 hover:bg-[#14F195]/[0.16]"
        >
          <span className="text-[#14F195]">
            <PlayIcon />
          </span>
          {t("marketV2.howItWorks")}
        </button>
      </header>

      <div className="flex w-fit rounded-2xl border border-white/[0.07] bg-white/[0.035] p-1">
        <button
          type="button"
          onClick={() => setTab("buy")}
          className={`rounded-xl px-5 py-3 text-sm font-black transition ${tab === "buy" ? "bg-[#14F195]/[0.14] text-[#14F195] shadow-[0_0_24px_rgba(20,241,149,0.14)]" : "text-slate-400 hover:bg-white/[0.06] hover:text-white"}`}
        >
          {t("marketV2.tab.buy")}
        </button>
        <button
          type="button"
          onClick={() => setTab("sell")}
          className={`rounded-xl px-5 py-3 text-sm font-black transition ${tab === "sell" ? "bg-[#14F195]/[0.14] text-[#14F195] shadow-[0_0_24px_rgba(20,241,149,0.14)]" : "text-slate-400 hover:bg-white/[0.06] hover:text-white"}`}
        >
          {t("marketV2.tab.sell")}
        </button>
      </div>

      {tab === "sell" ? (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <MiniStat
              label={t("marketV2.yourShares")}
              value={`${available.length}`}
              helper={t("marketV2.kpi.count.helper")}
            />
            <MiniStat
              label={t("marketV2.faceValue")}
              value={fmtMoney(myFaceTotal, { noCents: true })}
              helper={t("marketV2.kpi.face.helper")}
              tone="cyan"
            />
            <MiniStat
              label={t("marketV2.resalePrice")}
              value={fmtMoney(myResaleTotal, { noCents: true })}
              helper={t("marketV2.kpi.resale.helper")}
              tone="amber"
            />
            <MiniStat
              label={t("marketV2.kpi.disc2.label")}
              value={`${pct1(myAvgDisc)}%`}
              helper={t("marketV2.kpi.disc2.helper")}
              tone="purple"
            />
          </section>

          {/* active listings — with cancel via ListingDetailsModal */}
          {listings.length > 0 && (
            <section className="rounded-[2rem] border border-white/[0.07] bg-white/[0.025] p-3 md:p-5">
              <div className="mb-3 flex items-center justify-between px-4 pt-2">
                <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[#14F195]">
                  {t("market.listings.title")}
                </span>
                <span className="text-xs text-slate-500">
                  {t("market.listings.count", { n: listings.length })}
                </span>
              </div>
              <div className="flex flex-col gap-2 overflow-x-auto">
                {listings.map((l) => (
                  <ListingRow key={l.id} listing={l} onOpen={setOpenListing} />
                ))}
              </div>
            </section>
          )}

          <section className="grid gap-6 lg:grid-cols-[1.6fr_0.9fr]">
            <div className="rounded-[2rem] border border-white/[0.07] bg-white/[0.025] p-3 md:p-5">
              <div className="mb-3 px-4 pt-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                {t("marketV2.yourShares")}
              </div>
              {available.length === 0 ? (
                <div className="m-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center text-sm text-slate-400">
                  {t("market.sellList.allListed")}
                </div>
              ) : (
                <>
                  <div className="hidden grid-cols-[1.7fr_0.6fr_0.85fr_0.95fr_0.7fr] gap-3 px-4 pb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-600 md:grid">
                    <span>{t("marketV2.col.group")}</span>
                    <span>{t("marketV2.col.term")}</span>
                    <span>{t("marketV2.faceValue")}</span>
                    <span>{t("marketV2.col.resale")}</span>
                    <span>{t("marketV2.col.action")}</span>
                  </div>
                  <div className="flex flex-col gap-2 overflow-x-auto">
                    {available.map((pos) => (
                      <SellRow key={pos.id} pos={pos} onSell={setSelling} />
                    ))}
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={scrollToHow}
                className="mx-auto mt-5 flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-5 py-3 text-sm font-bold text-slate-300 transition hover:border-white/[0.18] hover:text-white"
              >
                {t("marketV2.cta.seeAll")}
                <Icons.arrow size={14} stroke="currentColor" sw={2.4} style={{ rotate: "90deg" }} />
              </button>
            </div>

            <div className="flex flex-col gap-5">
              {available.length > 0 && (
                <FeaturedSellCard positions={available} onSell={setSelling} />
              )}
              <WhyCard titleKey="marketV2.whySell.title" itemKeys={WHY_SELL} />
            </div>
          </section>

          <HowItWorks id="mv2-how" titleKey="marketV2.how.sell.title" steps={SELL_STEPS} />

          <footer className="flex flex-col gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 text-sm text-slate-400 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-[#14F195]">
                <Icons.shield size={16} stroke="currentColor" sw={1.8} />
              </span>
              {t("marketV2.footer.secure")}
            </div>
            <button
              type="button"
              onClick={scrollToHow}
              className="font-bold text-[#14F195] transition-colors hover:text-[#00C8FF]"
            >
              {t("marketV2.footer.learnMore")} →
            </button>
          </footer>
        </>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <MiniStat
              label={t("marketV2.kpi.disc.label")}
              value={t("marketV2.kpi.disc.value", {
                n: statOffers.length ? Math.round(Math.max(...statOffers.map((o) => o.disc))) : 0,
              })}
              helper={t("marketV2.kpi.disc.helper")}
            />
            <MiniStat
              label={t("marketV2.kpi.available.label")}
              value={`${demoActive ? MARKET_OFFERS.length * 4 + 3 : offers.length}`}
              helper={t("marketV2.kpi.available.helper")}
              tone="cyan"
            />
            <MiniStat
              label={t("marketV2.kpi.economy.label")}
              value={fmtMoney(avgEconomy, { noCents: true })}
              helper={t("marketV2.kpi.economy.helper")}
              tone="amber"
            />
            <MiniStat
              label={t("marketV2.kpi.p2p.label")}
              value={`${pct1(avgApy)}%`}
              helper={t("marketV2.kpi.p2p.helper")}
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
                      type="button"
                      onClick={() => setCategory(cat)}
                      className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide transition ${category === cat ? "bg-[#14F195]/[0.14] text-[#14F195]" : "bg-white/[0.04] text-slate-400 hover:bg-[#14F195]/[0.08] hover:text-[#14F195]"}`}
                    >
                      {t(CAT_LABEL_KEY[cat] ?? cat)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="flex items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-slate-300 transition hover:text-white"
                  aria-label={t("marketV2.search")}
                >
                  <SearchIcon size={16} />
                </button>
              </div>

              <div className="hidden grid-cols-[1.6fr_0.55fr_0.75fr_0.8fr_0.65fr_0.7fr] gap-3 px-4 pb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-600 md:grid">
                <span>{t("marketV2.col.group")}</span>
                <span>{t("marketV2.col.term")}</span>
                <span>{t("marketV2.col.discount")}</span>
                <span>{t("marketV2.economy")}</span>
                <span>{t("marketV2.p2p")}</span>
                <span>{t("marketV2.col.available")}</span>
              </div>

              <div className="flex flex-col gap-2 overflow-x-auto">
                {offers.length === 0 ? (
                  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-5 py-12 text-center text-sm leading-relaxed text-slate-400">
                    {t("marketV2.empty")}
                  </div>
                ) : (
                  offers.map((offer) => (
                    <OfferRow
                      key={offer.id}
                      offer={offer}
                      onBuy={setBuying}
                      purchased={purchasedSet.has(offer.id)}
                    />
                  ))
                )}
              </div>

              {offers.length > 0 && (
                <button
                  type="button"
                  onClick={scrollToHow}
                  className="mx-auto mt-5 flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-5 py-3 text-sm font-bold text-slate-300 transition hover:border-white/[0.18] hover:text-white"
                >
                  {t("marketV2.cta.seeMore")}
                  <Icons.arrow
                    size={14}
                    stroke="currentColor"
                    sw={2.4}
                    style={{ rotate: "90deg" }}
                  />
                </button>
              )}
            </div>

            <div className="flex flex-col gap-5">
              {demoActive && <FeaturedOfferCard onBuy={setBuying} />}
              <WhyCard titleKey="marketV2.whyBuy.title" itemKeys={WHY_BUY} />
            </div>
          </section>

          <HowItWorks id="mv2-how" titleKey="marketV2.how.buy.title" steps={BUY_STEPS} />

          <footer className="flex flex-col gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 text-sm text-slate-400 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-[#14F195]">
                <Icons.shield size={16} stroke="currentColor" sw={1.8} />
              </span>
              {t("marketV2.footer.secure")}
            </div>
            <button
              type="button"
              onClick={scrollToHow}
              className="font-bold text-[#14F195] transition-colors hover:text-[#00C8FF]"
            >
              {t("marketV2.footer.learnMore")} →
            </button>
          </footer>
        </>
      )}

      <BuyOfferModal
        target={buying}
        open={buying !== null}
        onClose={() => setBuying(null)}
        onPurchased={(target) =>
          buyShare({
            offerId: target.id,
            group: target.group,
            price: target.price,
            face: target.face,
            num: target.num,
            month: target.month,
            total: target.total,
            tone: target.tone,
          })
        }
      />
      <SellPositionModal
        position={selling}
        open={selling !== null}
        onClose={() => setSelling(null)}
        onListed={({ position, askPrice, discountPct }) =>
          sellShare(position, askPrice, discountPct)
        }
      />
      <ListingDetailsModal
        listing={openListing}
        open={openListing !== null}
        onClose={() => setOpenListing(null)}
        onCancel={(listingId) => cancelListing(listingId)}
      />
    </main>
  );
}
