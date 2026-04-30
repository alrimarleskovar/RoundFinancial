"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

import { SegToggle } from "@/components/layout/SegToggle";
import { RFILogoMark } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { DataStream } from "@/components/landing/DataStream";
import { useI18n, useT } from "@/lib/i18n";

// Marketing landing for RoundFi. Renders before the user connects a
// wallet; once `connected` flips true (from Phantom/Solflare/Backpack
// via wallet-adapter), redirects to /home.
//
// Visual identity: Neon palette (#06090F + #14F195 green + #9945FF
// purple + #00C8FF teal accent) — matches the dashboard family.
//
// Text is fully i18n'd via the same context the dashboard uses; the
// PT/EN segmented toggle in the sticky header flips both the landing
// copy and the dashboard once the user connects.

export default function LandingPage() {
  const { connected } = useWallet();
  const router = useRouter();
  const t = useT();
  const i18n = useI18n();
  const [mounted, setMounted] = useState(false);

  // Simulator state
  const [simAmount, setSimAmount] = useState(10000);
  const [simMonths, setSimMonths] = useState(24);
  const apy = 0.065;

  // FAQ accordion + waitlist state
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (connected) router.push("/home");
  }, [connected, router]);

  if (!mounted) return <div className="min-h-screen bg-[#06090F]" />;

  if (connected) {
    return (
      <div className="min-h-screen bg-[#06090F] flex items-center justify-center">
        <div className="text-[#14F195] animate-pulse font-bold tracking-widest uppercase">
          {t("landing.loading")}
        </div>
      </div>
    );
  }

  const finalBalance = simAmount + simAmount * apy * (simMonths / 12);
  const yieldEarned = simAmount * apy * (simMonths / 12);

  return (
    <main className="flex min-h-screen flex-col bg-[#06090F] text-white font-sans relative">
      {/* Background glows */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-20%] w-[300px] md:w-[600px] h-[300px] md:h-[600px] bg-[#9945FF] opacity-10 blur-[80px] md:blur-[120px]" />
        <div className="absolute bottom-[20%] right-[-20%] w-[250px] md:w-[500px] h-[250px] md:h-[500px] bg-[#14F195] opacity-10 blur-[80px] md:blur-[120px]" />
      </div>

      {/* Header (sticky, full-width tinted bar with blurred backdrop) */}
      <div className="sticky top-0 z-50 bg-[#06090F]/80 backdrop-blur-md border-b border-white/5">
        <header className="flex justify-between items-center p-4 md:p-6 max-w-7xl w-full mx-auto gap-2">
          <div className="cursor-pointer transition-transform hover:scale-105 shrink-0 flex items-center h-12 md:h-16">
            <RFILogoMark size={56} style={{ width: "auto", height: "100%" }} />
          </div>
          <nav className="hidden lg:flex gap-8 text-sm font-semibold text-gray-400 uppercase tracking-widest">
            {(
              [
                ["#simulator", t("landing.nav.simulator")],
                ["#compare",   t("landing.nav.advantages")],
                ["#cofi",      t("landing.nav.cofi")],
                ["#security",  t("landing.nav.security")],
                ["#",          t("landing.nav.docs")],
                ["#",          t("landing.nav.audit")],
              ] as const
            ).map(([href, label]) => (
              <a
                key={label}
                href={href}
                className="relative hover:text-white transition-colors after:content-[''] after:absolute after:left-0 after:-bottom-1 after:h-px after:w-0 after:bg-gradient-to-r after:from-[#14F195] after:to-[#00C8FF] after:transition-all after:duration-300 hover:after:w-full"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2 md:gap-3">
            <SegToggle
              value={i18n.lang}
              onChange={i18n.setLang}
              options={[
                { v: "pt", l: "PT" },
                { v: "en", l: "EN" },
              ]}
            />
            <div className="scale-75 md:scale-100 origin-right">
              <span
                className="rfi-btn-glow-wrap green inline-flex"
                style={{ borderRadius: 12 }}
              >
                <WalletMultiButton
                  style={{
                    backgroundColor: "#14F195",
                    color: "#06090F",
                    borderRadius: "12px",
                    fontWeight: "bold",
                  }}
                />
              </span>
            </div>
          </div>
        </header>
      </div>

      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center pt-10 md:pt-20 pb-20 md:pb-32 px-4 md:px-6 text-center w-full">
        <DataStream />
        <div className="relative z-10 w-full flex flex-col items-center">
        <div className="inline-flex items-center gap-2 bg-[#14F195]/10 border border-[#14F195]/20 text-[#14F195] px-3 md:px-4 py-1.5 md:py-2 rounded-full text-[10px] md:text-xs font-bold mb-6 md:mb-8">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#14F195] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#14F195]" />
          </span>
          {t("landing.hero.live")}
        </div>

        <h1 className="text-4xl md:text-7xl font-black leading-tight md:leading-none mb-6 md:mb-8 max-w-4xl tracking-tight">
          {t("landing.hero.title1")} <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#14F195] via-[#00C8FF] to-[#9945FF] bg-[length:200%_auto] drop-shadow-[0_0_24px_rgba(20,241,149,0.25)] rfi-gradient-flow">
            {t("landing.hero.title2")}
          </span>
        </h1>

        <p className="text-sm md:text-xl text-gray-400 max-w-3xl mb-8 md:mb-12 font-light leading-relaxed px-2">
          {t("landing.hero.body").split(t("landing.hero.cofi"))[0]}
          <span className="text-white font-bold">{t("landing.hero.cofi")}</span>
          {t("landing.hero.body").split(t("landing.hero.cofi"))[1]}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 md:gap-4 w-full sm:w-auto">
          <div className="w-full sm:w-auto flex justify-center">
            <span
              className="rfi-btn-glow-wrap purple inline-flex"
              style={{ borderRadius: 16 }}
            >
              <WalletMultiButton
                style={{
                  height: "50px",
                  padding: "0 30px",
                  fontSize: "1rem",
                  borderRadius: "16px",
                  backgroundColor: "#9945FF",
                  color: "#fff",
                }}
              />
            </span>
          </div>
          <a
            href="https://x.com/roundfinancesol"
            target="_blank"
            rel="noopener noreferrer"
            className="h-[50px] px-8 rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-md font-bold flex items-center justify-center hover:bg-white/[0.08] hover:border-[#14F195]/60 hover:shadow-[0_0_24px_rgba(20,241,149,0.25)] hover:scale-[1.03] transition-all duration-300 gap-2 text-sm w-full sm:w-auto tracking-wide"
          >
            <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            {t("landing.hero.x")}
          </a>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 w-full max-w-5xl border-t border-white/[0.08] pt-10 md:pt-12 mt-16 md:mt-20">
          <div>
            <p className="text-gray-500 text-[10px] md:text-sm font-bold uppercase tracking-wider mb-1 md:mb-2">
              {t("landing.metric.tvl")}
            </p>
            <p className="text-xl md:text-4xl font-bold">$1,245,800</p>
          </div>
          <div>
            <p className="text-gray-500 text-[10px] md:text-sm font-bold uppercase tracking-wider mb-1 md:mb-2">
              {t("landing.metric.pools")}
            </p>
            <p className="text-xl md:text-4xl font-bold">14</p>
          </div>
          <div>
            <p className="text-gray-500 text-[10px] md:text-sm font-bold uppercase tracking-wider mb-1 md:mb-2">
              {t("landing.metric.apy")}
            </p>
            <p className="text-xl md:text-4xl font-bold text-[#14F195]">~ 6.5%</p>
          </div>
          <div>
            <p className="text-gray-500 text-[10px] md:text-sm font-bold uppercase tracking-wider mb-1 md:mb-2">
              {t("landing.metric.fee")}
            </p>
            <p className="text-xl md:text-4xl font-bold text-[#9945FF]">1.5%</p>
          </div>
        </div>
        </div>
      </section>

      {/* CoFi · Next Paradigm */}
      <section
        id="cofi"
        className="w-full mx-auto px-4 md:px-6 py-20 md:py-32 max-w-7xl z-10 text-center relative"
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#14F195] opacity-5 blur-[150px] pointer-events-none" />
        <div className="inline-block bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-xs font-mono text-gray-400 mb-6 uppercase tracking-widest">
          {t("landing.cofi.eyebrow")}
        </div>
        <h2 className="text-4xl md:text-6xl font-black mb-6 tracking-tight">
          {t("landing.cofi.title1")} <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#14F195] to-[#9945FF]">
            {t("landing.cofi.title2")}
          </span>
        </h2>
        <p className="text-gray-400 max-w-2xl mx-auto text-lg mb-12">
          {t("landing.cofi.body")}
        </p>

        <div className="flex flex-col sm:flex-row justify-center gap-4 mb-16 relative z-10">
          <span className="rfi-btn-glow-wrap green inline-flex" style={{ borderRadius: 16 }}>
            <WalletMultiButton
              style={{
                backgroundColor: "#14F195",
                color: "#06090F",
                borderRadius: "16px",
                fontWeight: 900,
                padding: "0 32px",
                height: "50px",
              }}
            >
              {t("landing.cofi.cta1")}
            </WalletMultiButton>
          </span>
          <a
            href="https://github.com/alrimarleskovar/RoundFinancial/tree/main/grant"
            target="_blank"
            rel="noopener noreferrer"
            className="h-[50px] px-8 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors font-bold text-sm flex items-center justify-center"
          >
            {t("landing.cofi.cta2")}
          </a>
        </div>

        {/* Dashboard mockup (CSS-only, no external image) */}
        <div className="relative mx-auto w-full max-w-5xl h-[300px] md:h-[450px] bg-gradient-to-b from-[#0C1018] to-transparent border-t border-x border-white/10 rounded-t-[2.5rem] shadow-[0_-20px_50px_rgba(20,241,149,0.05)] overflow-hidden">
          {/* Subtle dotted-grid pattern via radial gradient */}
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />
          <div className="absolute top-0 left-0 w-full h-12 bg-white/[0.02] border-b border-white/5 flex items-center px-6 gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/50" />
            <div className="w-3 h-3 rounded-full bg-amber-500/50" />
            <div className="w-3 h-3 rounded-full bg-green-500/50" />
            <div className="mx-auto w-48 h-6 bg-black/40 rounded-full border border-white/5" />
          </div>
          <div className="p-8 mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 opacity-80">
            <div className="h-32 bg-white/5 rounded-2xl border border-white/10" />
            <div className="h-32 bg-white/5 rounded-2xl border border-white/10" />
            <div className="h-32 bg-white/5 rounded-2xl border border-white/10" />
            <div className="h-48 md:col-span-2 bg-[#14F195]/5 border border-[#14F195]/20 rounded-2xl" />
            <div className="h-48 bg-[#9945FF]/5 border border-[#9945FF]/20 rounded-2xl" />
          </div>
        </div>
      </section>

      {/* Security · Solvent by Construction */}
      <section
        id="security"
        className="w-full mx-auto px-4 md:px-6 py-20 md:py-24 max-w-6xl border-t border-white/[0.06] z-10"
      >
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-black mb-4 tracking-tight">
            {t("landing.security.title1")}{" "}
            <span className="text-[#14F195]">{t("landing.security.title2")}</span>
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto text-base">
            {t("landing.security.body")}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(
            [
              { key: "semente",  Icon: Icons.lock,   color: "#14F195" },
              { key: "escrow",   Icon: Icons.scales, color: "#4A9EFF" },
              { key: "valve",    Icon: Icons.ticket, color: "#FFD23F" },
              { key: "slashing", Icon: Icons.bolt,   color: "#FF4D4F" },
              { key: "triplo",  Icon: Icons.shield,  color: "#9945FF" },
              { key: "silos",   Icon: Icons.cubes,   color: "#E0E0E0" },
            ] as const
          ).map((c) => (
            <div
              key={c.key}
              className="p-8 rounded-[2rem] transition-colors"
              style={{
                background: `linear-gradient(180deg, ${c.color}0D 0%, rgba(255,255,255,0.02) 60%)`,
                border: `1px solid ${c.color}40`,
                boxShadow: `inset 0 1px 0 ${c.color}1A, 0 0 0 1px ${c.color}10`,
              }}
            >
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center mb-6"
                style={{
                  background: `${c.color}1F`,
                  border: `1px solid ${c.color}55`,
                  color: c.color,
                  boxShadow: `0 0 28px ${c.color}33`,
                }}
              >
                <c.Icon size={26} stroke={c.color} sw={1.8} />
              </div>
              <h3 className="text-xl font-bold mb-2">
                {t(`landing.security.card.${c.key}.title`)}
              </h3>
              <p className="text-gray-400 text-sm">
                {t(`landing.security.card.${c.key}.desc`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Simulator */}
      <section
        id="simulator"
        className="w-full mx-auto px-4 md:px-6 py-16 md:py-24 border-t border-white/[0.06] z-10 max-w-6xl"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 md:gap-20 items-center">
          <div className="text-center lg:text-left">
            <h2 className="text-3xl md:text-5xl font-bold mb-4 md:mb-6">
              {t("landing.sim.title1")} <br />
              <span className="text-[#14F195]">{t("landing.sim.title2")}</span>
            </h2>
            <p className="text-gray-400 text-sm md:text-lg mb-8 md:mb-10">
              {t("landing.sim.body").split(t("landing.sim.cofi"))[0]}
              <span className="text-white font-bold">{t("landing.sim.cofi")}</span>
              {t("landing.sim.body").split(t("landing.sim.cofi"))[1]}
            </p>

            <div className="space-y-6 md:space-y-8 bg-white/[0.03] backdrop-blur-xl p-6 md:p-10 rounded-[24px] md:rounded-3xl border border-white/[0.08]">
              <div>
                <label className="text-[10px] md:text-sm text-gray-500 uppercase font-bold mb-3 md:mb-4 block text-left">
                  {t("landing.sim.amount")}
                </label>
                <input
                  type="range"
                  min="1000"
                  max="100000"
                  step="1000"
                  value={simAmount}
                  onChange={(e) => setSimAmount(Number(e.target.value))}
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-[#14F195]"
                />
                <div className="flex justify-between mt-2 md:mt-4">
                  <span className="text-xl md:text-2xl font-bold">
                    ${simAmount.toLocaleString()}
                  </span>
                  <span className="text-xs md:text-sm text-gray-500 flex items-end">
                    {t("landing.sim.amountMax")}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-[10px] md:text-sm text-gray-500 uppercase font-bold mb-3 md:mb-4 block text-left">
                  {t("landing.sim.months")}
                </label>
                <input
                  type="range"
                  min="6"
                  max="60"
                  step="6"
                  value={simMonths}
                  onChange={(e) => setSimMonths(Number(e.target.value))}
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-[#9945FF]"
                />
                <div className="flex justify-between mt-2 md:mt-4">
                  <span className="text-xl md:text-2xl font-bold">
                    {simMonths} {t("landing.sim.monthsLabel")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Simulator chart */}
          <div className="bg-gradient-to-br from-[#14F195]/30 via-white/[0.06] to-[#9945FF]/30 p-0.5 md:p-1 rounded-[32px] md:rounded-[40px] shadow-2xl shadow-[#14F195]/15">
            <div className="bg-[#06090F]/85 backdrop-blur-xl rounded-[30px] md:rounded-[38px] p-8 md:p-12 text-center border border-white/[0.06]">
              <p className="text-gray-500 uppercase tracking-widest text-[10px] md:text-xs font-bold mb-2 md:mb-4">
                {t("landing.sim.result")}
              </p>
              <h3 className="text-4xl md:text-6xl font-black text-white mb-2 truncate">
                ${finalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </h3>
              <p className="text-[#14F195] font-bold text-base md:text-xl mb-8 md:mb-10">
                + ${yieldEarned.toLocaleString(undefined, { maximumFractionDigits: 0 })}{" "}
                {t("landing.sim.yieldSuffix")}
              </p>

              <div className="flex items-end justify-center gap-2 md:gap-3 h-24 md:h-32 mb-8 md:mb-10">
                <div className="w-8 md:w-12 bg-gray-800 rounded-t-lg h-[40%]" />
                <div className="w-8 md:w-12 bg-gray-700 rounded-t-lg h-[50%]" />
                <div className="w-8 md:w-12 bg-gray-600 rounded-t-lg h-[65%]" />
                <div className="w-8 md:w-12 bg-[#14F195] rounded-t-lg h-[100%] shadow-[0_0_20px_rgba(20,241,149,0.5)]" />
              </div>

              <div className="flex justify-center">
                <span
                  className="rfi-btn-glow-wrap green inline-flex"
                  style={{ borderRadius: 16 }}
                >
                  <WalletMultiButton
                    style={{
                      backgroundColor: "#14F195",
                      color: "#06090F",
                      padding: "0 32px",
                      fontWeight: "bold",
                      borderRadius: "16px",
                      height: "54px",
                      fontSize: "1rem",
                    }}
                  />
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section
        id="compare"
        className="w-full mx-auto px-4 md:px-6 py-16 md:py-24 max-w-6xl z-10"
      >
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">
          {t("landing.cmp.title1")}{" "}
          <span className="text-[#9945FF]">{t("landing.cmp.title2")}</span>
        </h2>
        <p className="text-gray-400 text-center max-w-2xl mx-auto mb-10 md:mb-16 text-sm md:text-base">
          {t("landing.cmp.body")}
        </p>

        <div className="flex flex-col md:flex-row gap-0 border border-white/[0.08] rounded-[24px] md:rounded-[32px] overflow-hidden bg-white/[0.03] backdrop-blur-xl w-full">
          <div className="p-6 md:p-10 border-b md:border-b-0 md:border-r border-white/[0.06] flex-1">
            <p className="text-gray-500 font-bold mb-6 uppercase text-[10px] md:text-xs tracking-widest text-center md:text-left">
              {t("landing.cmp.compare")}
            </p>
            <ul className="space-y-4 md:space-y-8 text-gray-400 font-medium text-xs md:text-sm">
              {(
                [
                  ["fee", "fee"],
                  ["yield", "yield"],
                  ["scoring", "scoring"],
                  ["liquidity", "liquidity"],
                  ["custody", "custody"],
                ] as const
              ).map(([key]) => (
                <li
                  key={key}
                  className="h-auto md:h-8 flex items-center justify-between md:justify-start gap-1"
                >
                  <span className="md:hidden font-bold">
                    {t(`landing.cmp.row.${key}.short`)}
                  </span>
                  <span className="md:block hidden">
                    {t(`landing.cmp.row.${key}.label`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="p-6 md:p-10 border-b md:border-b-0 md:border-r border-white/[0.06] bg-white/[0.02] flex-1">
            <p className="text-gray-400 font-bold mb-6 uppercase text-[10px] md:text-xs tracking-widest text-center md:text-left">
              {t("landing.cmp.legacy")}
            </p>
            <ul className="space-y-2 md:space-y-4 text-gray-300 font-medium text-xs md:text-sm text-center md:text-left">
              {(
                [
                  ["fee.legacy", true],
                  ["yield.legacy", true],
                  ["scoring.legacy", false],
                  ["liquidity.legacy", false],
                  ["custody.legacy", false],
                ] as const
              ).map(([key, redText]) => (
                <li
                  key={key}
                  className={`h-auto md:h-9 flex items-center justify-center md:justify-start gap-2 px-2 -mx-2 py-1.5 rounded transition-colors hover:bg-white/[0.04] ${
                    redText ? "text-red-400" : ""
                  }`}
                >
                  <svg
                    className="w-3.5 h-3.5 shrink-0 text-red-400/70"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                  <span>{t(`landing.cmp.row.${key}`)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="p-6 md:p-10 bg-gradient-to-b from-[#14F195]/10 to-transparent relative border-t-4 md:border-t-0 md:border-l-4 border-[#14F195] flex-1 shadow-[inset_0_0_60px_rgba(20,241,149,0.08)]">
            <div className="absolute top-2 right-2 md:top-4 md:right-6 bg-[#14F195] text-[#06090F] text-[8px] md:text-[10px] font-black px-2 py-1 rounded tracking-widest animate-pulse shadow-[0_0_16px_rgba(20,241,149,0.5)]">
              COFI
            </div>
            <p className="text-[#14F195] font-bold mb-6 uppercase text-[10px] md:text-xs tracking-widest text-center md:text-left">
              {t("landing.cmp.cofi")}
            </p>
            <ul className="space-y-2 md:space-y-4 text-white font-bold text-xs md:text-sm text-center md:text-left">
              {(
                [
                  ["fee.cofi", false],
                  ["yield.cofi", true],
                  ["scoring.cofi", false],
                  ["liquidity.cofi", false],
                  ["custody.cofi", false],
                ] as const
              ).map(([key, greenText]) => (
                <li
                  key={key}
                  className={`h-auto md:h-9 flex items-center justify-center md:justify-start gap-2 px-2 -mx-2 py-1.5 rounded transition-colors hover:bg-[#14F195]/[0.06] ${
                    greenText ? "text-[#14F195]" : ""
                  }`}
                >
                  <svg
                    className="w-3.5 h-3.5 shrink-0 text-[#14F195]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 12l5 5L20 6" />
                  </svg>
                  <span>{t(`landing.cmp.row.${key}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="w-full mx-auto px-4 md:px-6 py-20 md:py-32 max-w-4xl border-t border-white/[0.06] z-10">
        <h2 className="text-3xl md:text-5xl font-black text-center mb-12">
          {t("landing.faq.title1")}{" "}
          <span className="text-[#9945FF]">{t("landing.faq.title2")}</span>
        </h2>

        <div className="space-y-4">
          {([1, 2, 3, 4, 5] as const).map((n, index) => (
            <div key={n} className="border-b border-white/10 overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenFaq(openFaq === index ? null : index)}
                className="w-full flex justify-between items-center py-6 text-left hover:text-[#14F195] transition-colors"
              >
                <span className="text-base md:text-lg font-bold">
                  {t(`landing.faq.q${n}`)}
                </span>
                <span className="text-2xl text-gray-500 font-light shrink-0 ml-4">
                  {openFaq === index ? "−" : "+"}
                </span>
              </button>
              <div
                className={`transition-all duration-300 ease-in-out ${
                  openFaq === index
                    ? "max-h-96 opacity-100 mb-6"
                    : "max-h-0 opacity-0"
                }`}
              >
                <p className="text-gray-400 text-sm md:text-base leading-relaxed pr-4 md:pr-8">
                  {t(`landing.faq.a${n}`)}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center">
          <a
            href="https://github.com/alrimarleskovar/RoundFinancial/tree/main/grant"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#14F195] font-bold hover:underline transition-all"
          >
            {t("landing.faq.docsLink")}
          </a>
        </div>
      </section>

      {/* Waitlist */}
      <section className="w-full mx-auto px-4 md:px-6 py-12 md:py-16 max-w-6xl z-10">
        <div className="bg-white/5 border border-white/10 rounded-[2rem] p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="text-center md:text-left">
            <h3 className="text-2xl md:text-3xl font-bold mb-2">
              {t("landing.waitlist.title")}
            </h3>
            <p className="text-gray-400">{t("landing.waitlist.body")}</p>
          </div>
          {waitlistSubmitted ? (
            <div className="flex items-center gap-3 px-6 py-4 rounded-2xl bg-[#14F195]/10 border border-[#14F195]/30 text-[#14F195] font-bold">
              <span className="text-xl">✓</span>
              {t("landing.waitlist.success")}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (waitlistEmail.trim().length > 3) {
                  // Demo-only: no backend wiring yet. Stores nothing,
                  // shows confirmation feedback. Real waitlist hooks in
                  // post-M3 (devnet launch).
                  setWaitlistSubmitted(true);
                }
              }}
              className="flex w-full md:w-auto bg-black/50 rounded-2xl p-2 border border-white/10 focus-within:border-[#14F195] transition-colors"
            >
              <input
                type="email"
                required
                value={waitlistEmail}
                onChange={(e) => setWaitlistEmail(e.target.value)}
                placeholder={t("landing.waitlist.placeholder")}
                className="bg-transparent border-none outline-none text-white px-4 py-3 w-full md:w-64"
              />
              <button
                type="submit"
                className="bg-[#14F195] text-black font-bold px-6 py-3 rounded-xl hover:scale-105 transition-transform whitespace-nowrap"
              >
                {t("landing.waitlist.cta")} →
              </button>
            </form>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-white/[0.06] pt-16 md:pt-20 pb-8 md:pb-10 bg-black/20">
        <div className="max-w-7xl w-full mx-auto px-6 md:px-10 grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-12 mb-10 md:mb-20 text-center md:text-left">
          <div className="col-span-1 md:col-span-2 flex flex-col items-center md:items-start">
            <div className="mb-4 md:mb-6 h-16 flex items-center grayscale opacity-50 hover:grayscale-0 hover:opacity-100 transition-all">
              <RFILogoMark size={56} style={{ width: "auto", height: "100%" }} />
            </div>
            <p className="text-gray-500 max-w-sm leading-relaxed text-xs md:text-sm">
              {t("landing.footer.tagline").split(t("landing.footer.tagline.cofi"))[0]}
              <span className="text-gray-400">{t("landing.footer.tagline.cofi")}</span>
              {t("landing.footer.tagline").split(t("landing.footer.tagline.cofi"))[1]}
            </p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-4 md:mb-6 text-sm md:text-base">
              {t("landing.footer.protocol")}
            </h4>
            <ul className="text-gray-500 space-y-3 md:space-y-4 text-xs md:text-sm">
              <li><a href="#" className="hover:text-white transition-colors">{t("landing.footer.link.savings")}</a></li>
              <li><a href="#" className="hover:text-white transition-colors">{t("landing.footer.link.score")}</a></li>
              <li><a href="#" className="hover:text-white transition-colors">{t("landing.footer.link.audit")}</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold mb-4 md:mb-6 text-sm md:text-base">
              {t("landing.footer.community")}
            </h4>
            <ul className="text-gray-500 space-y-3 md:space-y-4 text-xs md:text-sm">
              <li>
                <a
                  href="https://x.com/roundfinancesol"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#14F195] transition-colors inline-flex items-center gap-2"
                >
                  <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  {t("landing.footer.link.twitter")}
                </a>
              </li>
              <li><a href="#" className="hover:text-white transition-colors">{t("landing.footer.link.discord")}</a></li>
              <li><a href="#" className="hover:text-white transition-colors">{t("landing.footer.link.github")}</a></li>
            </ul>
          </div>
        </div>
        <div className="text-center text-gray-600 text-[8px] md:text-xs tracking-widest border-t border-white/[0.06] pt-6 md:pt-10 uppercase px-4">
          {t("landing.footer.copyright")}
        </div>
      </footer>
    </main>
  );
}
