"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { RFILogoMark } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { NetworkBadge } from "@/components/layout/NetworkBadge";
import { TopBarPrefsMenu } from "@/components/layout/TopBarPrefsMenu";
import { WalletChip } from "@/components/layout/WalletChip";
import { PayInstallmentModal } from "@/components/modals/PayInstallmentModal";
import { SellShareModal } from "@/components/modals/SellShareModal";
import type { NftPosition, User } from "@/data/carteira";
import type { ActiveGroup } from "@/data/groups";
import type { SessionEvent } from "@/lib/session";
import { useI18n, type Lang } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";

const COLORS = {
  green: "#00F59B",
  cyan: "#23D9FF",
  purple: "#8A5CFF",
};

function Surface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#11151C]/90 shadow-[0_16px_48px_rgba(0,0,0,0.2)] backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

function CompactHeader() {
  const wallet = useWallet();
  const connected = wallet.status === "connected";

  // The shell's TopBar is hidden on /home below `lg` (TopBar.tsx), so this
  // header is the ONLY place a phone can reach the language/currency menu —
  // which is precisely what TopBarPrefsMenu exists for. Leaving it out left
  // the home screen showing money in a currency it gave no way to change.
  return (
    <header className="flex items-center justify-between gap-2 py-2">
      <RFILogoMark size={32} />

      <div className="flex shrink-0 items-center gap-1.5">
        <NetworkBadge connected={connected} compact />
        <TopBarPrefsMenu connected={connected} />
        <WalletChip wallet={wallet} compact />
      </div>
    </header>
  );
}

function ProtectedBalanceCard({ value, yieldValue }: { value: number; yieldValue: number }) {
  const { t, fmtMoney } = useI18n();
  return (
    <Surface className="min-h-[126px] p-4">
      <div className="absolute -right-10 -top-12 h-28 w-28 rounded-full bg-[#00F59B]/10 blur-3xl" />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#9CA3AF]">
            {t("mhome.protected")}
          </span>
          <Icons.shield size={16} stroke={COLORS.green} sw={1.8} />
        </div>
        <div className="mt-5">
          <p className="text-[22px] font-semibold leading-none tracking-[-0.05em] text-white">
            {fmtMoney(value)}
          </p>
          <p className="mt-2 text-[9px] text-[#9CA3AF]">
            <span className="text-[#00F59B]">+ {fmtMoney(yieldValue)}</span> {t("mhome.inYield")}
          </p>
        </div>
      </div>
    </Surface>
  );
}

function PassportGlanceCard({ user, demoActive }: { user: User; demoActive: boolean }) {
  const { t } = useI18n();
  const [info, setInfo] = useState(false);
  const score = Math.max(0, Math.min(100, Math.round(user.score / 10)));
  const label = t(user.score >= 500 ? "mhome.tier.trusted" : "mhome.tier.building");
  const passportId = user.walletShort || (demoActive ? "G8Z…EZF" : t("mhome.idPending"));

  return (
    <Link href="/reputacao" className="group block">
      <div className="relative min-h-[126px] overflow-hidden rounded-2xl bg-gradient-to-br from-[#00F59B]/75 via-[#23D9FF]/65 to-[#8A5CFF]/80 p-px shadow-[0_14px_38px_rgba(35,217,255,0.12)]">
        <div className="absolute -right-6 -top-8 h-28 w-28 rounded-full bg-[#8A5CFF]/40 blur-2xl" />
        <div className="absolute -bottom-10 -left-8 h-28 w-28 rounded-full bg-[#00F59B]/25 blur-2xl" />
        <div className="relative flex min-h-[124px] items-center justify-between gap-1 overflow-hidden rounded-[15px] bg-[linear-gradient(135deg,rgba(10,25,27,0.98),rgba(13,14,29,0.97))] p-3.5">
          <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(0,245,155,0.08),transparent_42%,rgba(138,92,255,0.12))]" />
          <div className="relative min-w-0 self-stretch">
            <span className="inline-flex items-center gap-1 rounded-full border border-[#23D9FF]/25 bg-[#23D9FF]/10 px-2 py-1 text-[7px] font-black uppercase tracking-[0.14em] text-[#7BEAFF]">
              <Icons.spark size={9} stroke="currentColor" sw={2} />
              {t("mhome.passport")}
            </span>
            {/* The tier badge used to occupy the screen's top-left — where the
                logo belongs. Reputation already lives on this card, so it
                moved here instead of being dropped. */}
            <p className="mt-2 truncate text-[8px] text-white/40">
              {t("mhome.tier", { n: user.level })} · ID {passportId}
            </p>
            <div className="mt-3">
              <p className="bg-gradient-to-r from-[#00F59B] to-[#23D9FF] bg-clip-text text-[12px] font-black uppercase tracking-[0.1em] text-transparent">
                {label}
              </p>
              <p className="mt-0.5 text-[7px] uppercase tracking-[0.12em] text-white/45">
                {t("mhome.passportSub")}
              </p>
            </div>
          </div>
          <div
            className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full p-[5px] shadow-[0_0_25px_rgba(0,245,155,0.16)] transition-transform duration-300 group-hover:scale-105"
            style={{
              background: `conic-gradient(${COLORS.green} 0 ${score * 0.55}%, ${COLORS.cyan} ${score * 0.75}% ${score * 0.9}%, ${COLORS.purple} ${score * 0.9}% ${score}%, rgba(255,255,255,0.08) ${score}% 100%)`,
            }}
          >
            <div className="flex h-full w-full flex-col items-center justify-center rounded-full border border-white/10 bg-[#080C13]">
              <strong className="text-[24px] font-semibold leading-none tracking-[-0.06em] text-white">
                {score}
              </strong>
              <span className="mt-1 text-[7px] font-bold uppercase tracking-[0.16em] text-[#23D9FF]">
                {t("mhome.score")}
              </span>
            </div>
          </div>
          <span className="absolute bottom-3 right-3 text-white/35">
            <Icons.arrow size={11} stroke="currentColor" sw={1.8} />
          </span>

          {/* The card is a Link, so the info affordance has to swallow the
              tap — otherwise "what is this?" would navigate to /reputacao,
              which is the one place someone who already understands it goes. */}
          <button
            type="button"
            aria-label={t("mhome.passportInfo.aria")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setInfo((v) => !v);
            }}
            className="absolute right-2 top-2 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-white/20 bg-white/10 text-[10px] font-black leading-none text-white/70 backdrop-blur-sm transition hover:bg-white/20 hover:text-white"
          >
            i
          </button>

          {info && (
            <div
              role="presentation"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setInfo(false);
              }}
              className="absolute inset-0 z-10 flex flex-col justify-center gap-1.5 rounded-[15px] bg-[#080C13]/95 p-3.5 backdrop-blur-sm"
            >
              <p className="text-[9px] font-black uppercase tracking-[0.14em] text-[#7BEAFF]">
                {t("mhome.passport")}
              </p>
              <p className="text-[10px] leading-snug text-white/70">{t("mhome.passportInfo")}</p>
              <p className="text-[8px] uppercase tracking-[0.12em] text-white/35">
                {t("mhome.passportInfo.dismiss")}
              </p>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function SmartAlert({ group }: { group?: ActiveGroup }) {
  const { t, fmtMoney } = useI18n();
  const [open, setOpen] = useState(false);

  if (!group || group.nextDue > 7) return null;

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border border-[#00F59B]/35 bg-[linear-gradient(105deg,rgba(0,245,155,0.12),rgba(17,21,28,0.96)_45%,rgba(35,217,255,0.08))] p-3.5 shadow-[0_12px_32px_rgba(0,245,155,0.07)]">
        <div className="absolute -left-6 top-1/2 h-20 w-20 -translate-y-1/2 rounded-full bg-[#00F59B]/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#00F59B]/20 bg-[#00F59B]/10 text-[#00F59B]">
            <Icons.bolt size={18} stroke="currentColor" sw={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[8px] font-black uppercase tracking-[0.17em] text-[#00F59B]">
              {t("mhome.nextAction")}
            </p>
            <p className="mt-1 text-[10px] leading-tight text-white/60">{t("mhome.dueIn")}</p>
            <p className="mt-0.5 text-[17px] font-semibold leading-none tracking-[-0.04em] text-white">
              {t("mhome.days", { n: group.nextDue })}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[8px] text-white/45">{t("mhome.installmentAmount")}</p>
            <p className="mt-0.5 text-[14px] font-semibold text-white">
              {fmtMoney(group.installment)}
            </p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-2 rounded-lg bg-gradient-to-r from-[#00F59B] to-[#23D9FF] px-3 py-2 text-[9px] font-black uppercase tracking-[0.08em] text-[#03110C] shadow-[0_6px_18px_rgba(0,245,155,0.18)] transition active:scale-95"
            >
              {t("mhome.payNow")}
            </button>
          </div>
        </div>
      </div>
      <PayInstallmentModal group={group} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function toSellPosition(group: ActiveGroup, month: number, lang: Lang): NftPosition {
  const monthsLeft = Math.max(0, group.total - month);
  return {
    id: group.id,
    num: group.id.replace(/\D/g, "").padStart(2, "0"),
    group: group.name,
    tone: group.tone,
    month,
    total: group.total,
    exp: new Date(Date.now() + monthsLeft * 30 * 86_400_000)
      .toLocaleDateString(lang === "pt" ? "pt-BR" : "en-US", { month: "short", year: "2-digit" })
      .replace(".", ""),
    value: group.prize,
    yieldPct: 0,
  };
}

function ActiveCycleCard({ group, month }: { group: ActiveGroup; month: number }) {
  const { t, lang } = useI18n();
  const [payOpen, setPayOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const progress = group.total > 0 ? (month / group.total) * 100 : 0;
  const sellPosition = useMemo(() => toSellPosition(group, month, lang), [group, month, lang]);

  return (
    <>
      <Surface className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#23D9FF]/15 bg-[#23D9FF]/[0.06] text-lg">
            {group.emoji}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-[#00F59B]">
                  {t("mhome.activeCycle")}
                </p>
                <h3 className="mt-1 truncate text-sm font-semibold text-white">{group.name}</h3>
              </div>
              <Link
                href="/grupos"
                aria-label={t("mhome.viewDetails", { g: group.name })}
                className="text-[#6B7280]"
              >
                <Icons.arrow size={17} stroke="currentColor" sw={1.7} />
              </Link>
            </div>

            <div className="mt-3 flex items-center justify-between text-[9px] text-[#9CA3AF]">
              <span>{t("mhome.installmentsOf", { m: month, t: group.total })}</span>
              <span>{t("mhome.members", { n: group.members })}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#00F59B] to-[#23D9FF]"
                style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-3">
          <button
            type="button"
            onClick={() => setPayOpen(true)}
            className="rounded-lg bg-[#00F59B] px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-[#03110C] transition active:scale-[0.98]"
          >
            {t("home.card.pay")}
          </button>
          <button
            type="button"
            onClick={() => setSellOpen(true)}
            className="rounded-lg border border-[#FF7A7A]/25 bg-transparent px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide text-[#C5CAD3] transition hover:border-[#FF7A7A]/50 hover:text-[#FF9090]"
          >
            {t("home.card.sell")}
          </button>
        </div>
      </Surface>

      <PayInstallmentModal group={group} open={payOpen} onClose={() => setPayOpen(false)} />
      <SellShareModal position={sellPosition} open={sellOpen} onClose={() => setSellOpen(false)} />
    </>
  );
}

function ActiveCycles({
  groups,
  monthsPaidByGroup,
}: {
  groups: ActiveGroup[];
  monthsPaidByGroup: Record<string, number>;
}) {
  const { t } = useI18n();
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-[-0.03em] text-white">
          {t("mhome.cyclesTitle")}
        </h2>
        <Link href="/grupos?tab=mine" className="text-[10px] font-semibold text-[#00F59B]">
          {t("mhome.seeAll")}
        </Link>
      </div>

      {groups.length ? (
        <div className="space-y-2.5">
          {groups.map((group) => {
            const month = Math.min(group.total, group.month + (monthsPaidByGroup[group.name] ?? 0));
            return <ActiveCycleCard key={group.id} group={group} month={month} />;
          })}
        </div>
      ) : (
        <Surface className="p-5 text-center">
          <p className="text-sm font-semibold text-white">{t("mhome.empty.title")}</p>
          <p className="mt-1 text-[10px] text-[#9CA3AF]">{t("mhome.empty.body")}</p>
          <Link
            href="/grupos"
            className="mt-4 inline-flex rounded-lg bg-[#00F59B] px-4 py-2 text-[10px] font-black uppercase text-[#03110C]"
          >
            {t("mhome.empty.cta")}
          </Link>
        </Surface>
      )}
    </section>
  );
}

function SecondaryMetrics({ cycleValue, collateral }: { cycleValue: number; collateral: number }) {
  const { t, fmtMoney } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Surface className="p-4">
        <div className="flex items-center justify-between">
          <Icons.wallet size={16} stroke={COLORS.purple} sw={1.8} />
          <span className="text-[8px] uppercase tracking-[0.12em] text-[#9CA3AF]">
            {t("mhome.cyclesLabel")}
          </span>
        </div>
        <p className="mt-5 text-[9px] uppercase tracking-[0.1em] text-[#9CA3AF]">
          {t("mhome.cyclesValue")}
        </p>
        <p className="mt-1 text-lg font-semibold tracking-tight text-white">
          {fmtMoney(cycleValue)}
        </p>
      </Surface>

      <Surface className="p-4">
        <div className="flex items-center justify-between">
          <Icons.shield size={16} stroke={COLORS.cyan} sw={1.8} />
          <span className="text-[8px] uppercase tracking-[0.12em] text-[#9CA3AF]">
            {t("mhome.tierLabel")}
          </span>
        </div>
        <p className="mt-5 text-[9px] uppercase tracking-[0.1em] text-[#9CA3AF]">
          {t("home.kpi.colat")}
        </p>
        <p className="mt-1 text-lg font-semibold tracking-tight text-white">{collateral}%</p>
      </Surface>
    </div>
  );
}

function NextAchievements({ events }: { events: SessionEvent[] }) {
  const { t } = useI18n();
  const paymentCount = events.filter((event) => event.kind === "payment").length;
  const items = [
    {
      icon: "check",
      title: t("mhome.mission.onTime"),
      reward: "+18 pts",
      progress: `${Math.min(paymentCount, 2)}/2`,
      pct: Math.min(100, (paymentCount / 2) * 100),
    },
    {
      icon: "groups",
      title: t("mhome.mission.join"),
      reward: "+24 pts",
      progress: "0/1",
      pct: 0,
    },
    {
      icon: "score",
      title: t("mhome.mission.cycle"),
      reward: "+42 pts",
      progress: "0/1",
      pct: 0,
    },
  ];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">{t("mhome.achievements")}</h2>
        <Link href="/insights" className="text-[10px] text-[#00F59B]">
          {t("mhome.seeAllF")}
        </Link>
      </div>
      <Surface className="divide-y divide-white/[0.06] px-4">
        {items.map((item) => {
          const Icon = Icons[item.icon] ?? Icons.spark;
          return (
            <div key={item.title} className="flex items-center gap-3 py-3.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#00F59B]/[0.07] text-[#00F59B]">
                <Icon size={15} stroke="currentColor" sw={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[11px] font-medium text-white">{item.title}</p>
                  <span className="shrink-0 text-[9px] font-semibold text-[#00F59B]">
                    {item.reward}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                    <div
                      className="h-full rounded-full bg-[#00F59B]"
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>
                  <span className="text-[8px] text-[#6B7280]">{item.progress}</span>
                </div>
              </div>
            </div>
          );
        })}
      </Surface>
    </section>
  );
}

export function MobileHome({
  user,
  events,
  groups,
  monthsPaidByGroup,
  lockedUsdc,
  demoActive,
}: {
  user: User;
  events: SessionEvent[];
  groups: ActiveGroup[];
  monthsPaidByGroup: Record<string, number>;
  lockedUsdc: number;
  demoActive: boolean;
}) {
  const firstGroup = useMemo(
    () => (groups.length ? [...groups].sort((a, b) => a.nextDue - b.nextDue)[0] : undefined),
    [groups],
  );
  const cycleValue = useMemo(
    () =>
      groups.reduce(
        (sum, group) =>
          sum +
          group.installment *
            Math.min(group.total, group.month + (monthsPaidByGroup[group.name] ?? 0)),
        0,
      ),
    [groups, monthsPaidByGroup],
  );
  const protectedBalance = lockedUsdc || cycleValue * 0.16;

  return (
    <main className="relative mx-auto w-full max-w-[520px] bg-[#05070B] px-4 pb-10 text-white lg:hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_10%_0%,rgba(0,245,155,0.06),transparent_42%),radial-gradient(circle_at_92%_12%,rgba(138,92,255,0.07),transparent_44%)]" />

      <div className="relative">
        <CompactHeader />

        <section className="mt-2 grid grid-cols-2 gap-3">
          <ProtectedBalanceCard value={protectedBalance} yieldValue={user.yield} />
          <PassportGlanceCard user={user} demoActive={demoActive} />
        </section>

        <div className="mt-3">
          <SmartAlert group={firstGroup} />
        </div>

        <div className="mt-5">
          <ActiveCycles groups={groups} monthsPaidByGroup={monthsPaidByGroup} />
        </div>

        <section className="mt-10 space-y-6">
          <SecondaryMetrics cycleValue={cycleValue} collateral={user.colateralPct} />
          <NextAchievements events={events} />
        </section>
      </div>
    </main>
  );
}
