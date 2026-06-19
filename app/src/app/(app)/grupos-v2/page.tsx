"use client";

// /grupos-v2 — VISUAL-FIRST preview of the team's new Grupos (catalog) design.
//
// Lives inside the (app) route group so it inherits the DeskShell TopBar +
// shared dark ground; the real /grupos and main stay untouched until this
// graduates. Faithful to the provided layout, reusing the existing
// ACTIVE_GROUPS / DISCOVER_GROUPS fixtures. Structural emoji glyphs (lock /
// check / people / info / plus) are swapped for the project's stroke icon set
// per the team's preference; group + filter emojis are kept as designed.
//
// Visual-only: the level gate / "faltam N pontos" / filters are the design's
// static values — the re-wire pass connects them to useSession() + the real
// JoinGroupModal, then strings migrate to i18n and it graduates onto /grupos.

import Link from "next/link";

import { Icons } from "@/components/brand/icons";
import { ACTIVE_GROUPS, DISCOVER_GROUPS, type DiscoverGroup } from "@/data/groups";

const TONE_HEX: Record<string, string> = {
  g: "#14F195",
  t: "#00C8FF",
  p: "#9945FF",
  a: "#FFB547",
  r: "#FF5656",
};

function brl(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

function descriptionFor(name: string) {
  if (name.includes("PME")) return "Capital de giro para pequenas e médias empresas.";
  if (name.includes("Intercâmbio"))
    return "Realize seu intercâmbio com tranquilidade e planejamento.";
  if (name.includes("Veteranos"))
    return "Grupo exclusivo para membros de alto nível e histórico comprovado.";
  if (name.includes("Moto")) return "Conquiste sua moto e potencialize seus ganhos.";
  if (name.includes("Casa")) return "Capital para entrada, reforma ou regularização do seu imóvel.";
  if (name.includes("Dev")) return "Equipamentos e ferramentas para desenvolvedores e criadores.";
  if (name.includes("Piloto"))
    return "Pool piloto on-chain na devnet — entre para exercer o fluxo real.";
  return "Capital para alcançar seu objetivo com planejamento.";
}

function GroupCard({ group, compatible = true }: { group: DiscoverGroup; compatible?: boolean }) {
  const tone = TONE_HEX[group.tone] ?? "#14F195";
  const pct = Math.min(100, Math.round((group.filled / group.total) * 100));
  const locked = group.level > 2;

  return (
    <article className="group relative overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-[#0C111A]/95 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] transition-all duration-300 hover:-translate-y-1 hover:border-white/20">
      <div
        className="absolute -right-10 -top-12 h-28 w-28 rounded-full opacity-20 blur-[55px]"
        style={{ background: tone }}
      />

      <div className="mb-7 flex items-start justify-between">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl text-2xl"
          style={{
            background: `${tone}1A`,
            border: `1px solid ${tone}45`,
            boxShadow: `0 0 28px ${tone}16`,
          }}
        >
          {group.emoji}
        </div>

        {locked ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#9945FF]/30 bg-[#9945FF]/10 px-3 py-1 text-[11px] font-bold text-[#B782FF]">
            <Icons.lock size={12} stroke="currentColor" sw={2} /> Requer Nv. {group.level}
          </span>
        ) : compatible ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#14F195]/25 bg-[#14F195]/10 px-3 py-1 text-[11px] font-bold text-[#14F195]">
            <Icons.check size={13} stroke="currentColor" sw={2.6} /> Compatível
          </span>
        ) : (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-bold text-gray-400">
            Nv. {group.level}+
          </span>
        )}
      </div>

      <div className="mb-3 flex items-end gap-2">
        <h3 className="text-2xl font-black tracking-[-0.04em] text-white">{group.name}</h3>
        <span className="mb-1 text-sm font-black" style={{ color: tone }}>
          {group.months} meses
        </span>
      </div>

      <p className="mb-3 text-sm leading-relaxed text-gray-400">{descriptionFor(group.name)}</p>

      <div className="mb-5 text-sm text-gray-500">
        {group.months}m • {group.filled}/{group.total} cotas
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div>
          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
            Prêmio
          </p>
          <p className="text-2xl font-black tracking-[-0.04em] text-white">{brl(group.prize)}</p>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
            Parcela
          </p>
          <p className="text-2xl font-black tracking-[-0.04em] text-white">
            {brl(group.installment)}
          </p>
        </div>
      </div>

      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: tone, boxShadow: `0 0 18px ${tone}55` }}
        />
      </div>

      {locked ? (
        <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm font-bold text-gray-400">
          <Icons.lock size={14} stroke="currentColor" sw={2} /> Faltam 66 pontos para Nv.{" "}
          {group.level}
        </button>
      ) : compatible ? (
        <button className="w-full rounded-xl bg-gradient-to-r from-[#14F195] to-[#00C8FF] px-4 py-3 text-sm font-black text-[#03130D] shadow-[0_10px_30px_rgba(20,241,149,0.18)] transition hover:scale-[1.01]">
          Entrar no grupo
        </button>
      ) : (
        <button className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm font-bold text-white">
          Ver detalhes
        </button>
      )}
    </article>
  );
}

export default function GruposV2Page() {
  const openGroups = [
    ...ACTIVE_GROUPS.map((g) => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      tone: g.tone,
      prize: g.prize,
      months: g.total,
      installment: g.installment,
      filled: g.members,
      total: g.total,
      level: g.level ?? 2,
    })),
    ...DISCOVER_GROUPS,
  ] as DiscoverGroup[];
  const compatibleCount = openGroups.filter((g) => g.level <= 2).length;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-4 py-8 text-white animate-in fade-in duration-700 md:px-8">
      {/* header */}
      <section className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.24em] text-[#14F195]">
            <span className="h-2 w-2 rounded-full bg-[#14F195] shadow-[0_0_12px_#14F195]" />{" "}
            Catálogo
          </div>
          <h1 className="text-4xl font-black tracking-[-0.05em] [font-family:var(--font-syne),sans-serif] md:text-6xl">
            Grupos disponíveis
          </h1>
          <p className="mt-3 max-w-2xl text-base text-gray-400">
            Encontre o grupo ideal para seus objetivos e evolua sua reputação.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm text-gray-300">
              <Icons.people size={15} stroke="currentColor" /> {openGroups.length} grupos
              disponíveis
            </span>
            <span className="inline-flex items-center gap-2 rounded-xl border border-[#14F195]/15 bg-[#14F195]/[0.06] px-4 py-2 text-sm text-gray-300">
              <Icons.check size={15} stroke="#14F195" sw={2.4} /> {compatibleCount} compatíveis com
              seu nível
            </span>
          </div>
        </div>

        <button className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#14F195] to-[#00C8FF] px-7 py-4 text-sm font-black text-[#03130D] shadow-[0_12px_36px_rgba(20,241,149,0.22)] transition hover:scale-[1.01]">
          <Icons.plus size={16} stroke="#03130D" sw={2.6} /> Abrir novo ciclo
        </button>
      </section>

      {/* filter bar */}
      <section className="rounded-[1.5rem] border border-white/[0.08] bg-[#0B1018]/90 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.25)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-3">
            {["⭐ Recomendados", "🔥 Populares", "🏆 Maior prêmio", "⚡ Menor parcela"].map(
              (label, i) => (
                <button
                  key={label}
                  className={`rounded-xl border px-5 py-3 text-sm font-bold transition ${
                    i === 0
                      ? "border-[#14F195]/50 bg-[#14F195]/10 text-[#14F195] shadow-[0_0_22px_rgba(20,241,149,0.12)]"
                      : "border-white/[0.08] bg-white/[0.035] text-gray-300 hover:border-white/20"
                  }`}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          <button className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-5 py-3 text-sm font-bold text-gray-300 hover:border-white/20">
            Mais filtros ▾
          </button>
        </div>
      </section>

      {/* grid */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {openGroups.map((group, index) => (
          <GroupCard key={`${group.id}-${index}`} group={group} compatible={group.level <= 2} />
        ))}
      </section>

      {/* footer note */}
      <section className="flex flex-col gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 text-sm text-gray-400 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-gray-300">
            <Icons.info size={16} stroke="currentColor" sw={1.8} />
          </span>
          <span>Sua reputação e nível de acesso determinam os grupos disponíveis para você.</span>
        </div>
        <Link
          href="/reputacao"
          className="font-bold text-[#14F195] transition-colors hover:text-[#00C8FF]"
        >
          Entenda como funciona →
        </Link>
      </section>
    </main>
  );
}
