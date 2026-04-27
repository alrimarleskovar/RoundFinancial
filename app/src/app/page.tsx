"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

// Marketing landing for RoundFi. Renders before the user connects a
// wallet; once `connected` flips true (from Phantom/Solflare/Backpack
// via wallet-adapter), redirects to /home.
//
// Visual identity is intentionally distinct from the dashboard
// (dark navy + neon green + violet) — this is the public-facing page,
// the dashboard uses the soft/neon palettes.

export default function LandingPage() {
  const { connected } = useWallet();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  // Simulator state
  const [simAmount, setSimAmount] = useState(10000);
  const [simMonths, setSimMonths] = useState(24);
  const apy = 0.065;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (connected) router.push("/home");
  }, [connected, router]);

  if (!mounted) return <div className="min-h-screen bg-[#0B132B]" />;

  if (connected) {
    return (
      <div className="min-h-screen bg-[#0B132B] flex items-center justify-center">
        <div className="text-[#00FFA3] animate-pulse font-bold tracking-widest uppercase">
          Carregando RoundFi Dashboard...
        </div>
      </div>
    );
  }

  const finalBalance = simAmount + simAmount * apy * (simMonths / 12);
  const yieldEarned = simAmount * apy * (simMonths / 12);

  return (
    <main className="flex min-h-screen flex-col bg-[#0B132B] text-white font-sans relative overflow-x-hidden">
      {/* Background glows */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-20%] w-[300px] md:w-[600px] h-[300px] md:h-[600px] bg-[#8A2BE2] opacity-10 blur-[80px] md:blur-[120px]" />
        <div className="absolute bottom-[20%] right-[-20%] w-[250px] md:w-[500px] h-[250px] md:h-[500px] bg-[#00FFA3] opacity-10 blur-[80px] md:blur-[120px]" />
      </div>

      {/* Header */}
      <header className="flex justify-between items-center p-4 md:p-8 max-w-7xl w-full mx-auto z-50 gap-2">
        <div className="cursor-pointer transition-transform hover:scale-105 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="RoundFi Logo"
            className="h-12 md:h-16 w-auto object-contain"
          />
        </div>
        <nav className="hidden lg:flex gap-10 text-sm font-semibold text-gray-400 uppercase tracking-widest">
          <a href="#simulator" className="hover:text-white transition-colors">Simulador</a>
          <a href="#compare" className="hover:text-white transition-colors">Vantagens</a>
          <a href="#" className="hover:text-white transition-colors">Docs</a>
          <a href="#" className="hover:text-white transition-colors">Auditoria</a>
        </nav>
        <div className="scale-75 md:scale-100 origin-right">
          <WalletMultiButton
            style={{
              backgroundColor: "#00FFA3",
              color: "#0B132B",
              borderRadius: "12px",
              fontWeight: "bold",
            }}
          />
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center justify-center pt-10 md:pt-20 pb-20 md:pb-32 px-4 md:px-6 text-center z-10 w-full">
        <div className="inline-flex items-center gap-2 bg-[#00FFA3]/10 border border-[#00FFA3]/20 text-[#00FFA3] px-3 md:px-4 py-1.5 md:py-2 rounded-full text-[10px] md:text-xs font-bold mb-6 md:mb-8">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00FFA3] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00FFA3]" />
          </span>
          Protocolo CoFi Live na Solana Devnet
        </div>

        <h1 className="text-4xl md:text-7xl font-black leading-tight md:leading-none mb-6 md:mb-8 max-w-4xl tracking-tight">
          Colateral que rende. <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00FFA3] via-[#8A2BE2] to-[#00FFA3] bg-[length:200%_auto]">
            Crédito que expande.
          </span>
        </h1>

        <p className="text-sm md:text-xl text-gray-400 max-w-3xl mb-8 md:mb-12 font-light leading-relaxed px-2">
          O primeiro protocolo de{" "}
          <span className="text-white font-bold">Collaborative Finance (CoFi)</span> da Solana.
          Elimine as taxas de administração e veja seu dinheiro crescer enquanto aguarda sua contemplação.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 md:gap-4 w-full sm:w-auto">
          <div className="w-full sm:w-auto flex justify-center">
            <WalletMultiButton
              style={{
                height: "50px",
                padding: "0 30px",
                fontSize: "1rem",
                borderRadius: "16px",
                backgroundColor: "#8A2BE2",
                color: "#fff",
              }}
            />
          </div>
          <a
            href="https://x.com/RoundFinanceSol"
            target="_blank"
            rel="noopener noreferrer"
            className="h-[50px] px-8 rounded-2xl border border-gray-700 font-bold flex items-center justify-center hover:bg-white/10 transition-all gap-2 text-sm w-full sm:w-auto"
          >
            <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Siga nosso X
          </a>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 w-full max-w-5xl border-t border-gray-800 pt-10 md:pt-12 mt-16 md:mt-20">
          <div>
            <p className="text-gray-500 text-[10px] md:text-sm font-bold uppercase tracking-wider mb-1 md:mb-2">
              Total Value Locked
            </p>
            <p className="text-xl md:text-4xl font-bold">$1,245,800</p>
          </div>
          <div>
            <p className="text-gray-500 text-[10px] md:text-sm font-bold uppercase tracking-wider mb-1 md:mb-2">
              Pooled Capital Groups
            </p>
            <p className="text-xl md:text-4xl font-bold">14</p>
          </div>
          <div>
            <p className="text-gray-500 text-[10px] md:text-sm font-bold uppercase tracking-wider mb-1 md:mb-2">
              Base APY Estimado
            </p>
            <p className="text-xl md:text-4xl font-bold text-[#00FFA3]">~ 6.5%</p>
          </div>
          <div>
            <p className="text-gray-500 text-[10px] md:text-sm font-bold uppercase tracking-wider mb-1 md:mb-2">
              Taxa do Protocolo
            </p>
            <p className="text-xl md:text-4xl font-bold text-[#8A2BE2]">1.5%</p>
          </div>
        </div>
      </section>

      {/* Simulator */}
      <section
        id="simulator"
        className="w-full mx-auto px-4 md:px-6 py-16 md:py-24 border-t border-gray-900 z-10 max-w-6xl"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 md:gap-20 items-center">
          <div className="text-center lg:text-left">
            <h2 className="text-3xl md:text-5xl font-bold mb-4 md:mb-6">
              Simule seu <br />
              <span className="text-[#00FFA3]">Saldo Futuro</span>
            </h2>
            <p className="text-gray-400 text-sm md:text-lg mb-8 md:mb-10">
              Diferente de um consórcio comum onde seu dinheiro é corroído pela inflação, no modelo{" "}
              <span className="text-white font-bold">CoFi</span> seu colateral cresce enquanto você espera.
            </p>

            <div className="space-y-6 md:space-y-8 bg-[#1C2541]/40 p-6 md:p-10 rounded-[24px] md:rounded-3xl border border-gray-800 backdrop-blur-xl">
              <div>
                <label className="text-[10px] md:text-sm text-gray-500 uppercase font-bold mb-3 md:mb-4 block text-left">
                  Valor da Carta de Crédito (USDC)
                </label>
                <input
                  type="range"
                  min="1000"
                  max="100000"
                  step="1000"
                  value={simAmount}
                  onChange={(e) => setSimAmount(Number(e.target.value))}
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-[#00FFA3]"
                />
                <div className="flex justify-between mt-2 md:mt-4">
                  <span className="text-xl md:text-2xl font-bold">
                    ${simAmount.toLocaleString()}
                  </span>
                  <span className="text-xs md:text-sm text-gray-500 flex items-end">
                    Máx: $100k
                  </span>
                </div>
              </div>

              <div>
                <label className="text-[10px] md:text-sm text-gray-500 uppercase font-bold mb-3 md:mb-4 block text-left">
                  Prazo do Grupo (Meses)
                </label>
                <input
                  type="range"
                  min="6"
                  max="60"
                  step="6"
                  value={simMonths}
                  onChange={(e) => setSimMonths(Number(e.target.value))}
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-[#8A2BE2]"
                />
                <div className="flex justify-between mt-2 md:mt-4">
                  <span className="text-xl md:text-2xl font-bold">{simMonths} Meses</span>
                </div>
              </div>
            </div>
          </div>

          {/* Simulator chart */}
          <div className="bg-gradient-to-br from-[#1C2541] to-[#0B132B] p-0.5 md:p-1 rounded-[32px] md:rounded-[40px] shadow-2xl shadow-[#00FFA3]/5">
            <div className="bg-[#0B132B] rounded-[30px] md:rounded-[38px] p-8 md:p-12 text-center">
              <p className="text-gray-500 uppercase tracking-widest text-[10px] md:text-xs font-bold mb-2 md:mb-4">
                Saldo Final Estimado
              </p>
              <h3 className="text-4xl md:text-6xl font-black text-white mb-2 truncate">
                ${finalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </h3>
              <p className="text-[#00FFA3] font-bold text-base md:text-xl mb-8 md:mb-10">
                + ${yieldEarned.toLocaleString(undefined, { maximumFractionDigits: 0 })} em Yield
              </p>

              <div className="flex items-end justify-center gap-2 md:gap-3 h-24 md:h-32 mb-8 md:mb-10">
                <div className="w-8 md:w-12 bg-gray-800 rounded-t-lg h-[40%]" />
                <div className="w-8 md:w-12 bg-gray-700 rounded-t-lg h-[50%]" />
                <div className="w-8 md:w-12 bg-gray-600 rounded-t-lg h-[65%]" />
                <div className="w-8 md:w-12 bg-[#00FFA3] rounded-t-lg h-[100%] shadow-[0_0_20px_rgba(0,255,163,0.5)]" />
              </div>

              <div className="w-full flex justify-center">
                <WalletMultiButton
                  style={{
                    backgroundColor: "#00FFA3",
                    color: "#0B132B",
                    width: "100%",
                    justifyContent: "center",
                    fontWeight: "bold",
                    borderRadius: "16px",
                    height: "54px",
                  }}
                />
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
          A Evolução do <span className="text-[#8A2BE2]">Crédito Comunitário</span>
        </h2>
        <p className="text-gray-400 text-center max-w-2xl mx-auto mb-10 md:mb-16 text-sm md:text-base">
          Substituímos administradoras burocráticas por Smart Contracts e algoritmos de reputação comportamental.
        </p>

        <div className="flex flex-col md:flex-row gap-0 border border-gray-800 rounded-[24px] md:rounded-[32px] overflow-hidden bg-[#1C2541]/20 backdrop-blur-md w-full">
          <div className="p-6 md:p-10 border-b md:border-b-0 md:border-r border-gray-800 flex-1">
            <p className="text-gray-500 font-bold mb-6 uppercase text-[10px] md:text-xs tracking-widest text-center md:text-left">
              Comparativo
            </p>
            <ul className="space-y-4 md:space-y-8 text-gray-400 font-medium text-xs md:text-sm">
              <li className="h-auto md:h-8 flex items-center justify-between md:justify-start gap-1">
                <span className="md:hidden font-bold">Taxa ADM:</span>
                <span className="md:block hidden">Taxa de Administração</span>
              </li>
              <li className="h-auto md:h-8 flex items-center justify-between md:justify-start gap-1">
                <span className="md:hidden font-bold">Rendimento:</span>
                <span className="md:block hidden">Rendimento do Fundo</span>
              </li>
              <li className="h-auto md:h-8 flex items-center justify-between md:justify-start gap-1">
                <span className="md:hidden font-bold">Análise:</span>
                <span className="md:block hidden">Análise de Crédito</span>
              </li>
              <li className="h-auto md:h-8 flex items-center justify-between md:justify-start gap-1">
                <span className="md:hidden font-bold">Liquidez:</span>
                <span className="md:block hidden">Velocidade de Liquidez</span>
              </li>
              <li className="h-auto md:h-8 flex items-center justify-between md:justify-start gap-1">
                <span className="md:hidden font-bold">Custódia:</span>
                <span className="md:block hidden">Estrutura e Custódia</span>
              </li>
            </ul>
          </div>

          <div className="p-6 md:p-10 border-b md:border-b-0 md:border-r border-gray-800 bg-gray-900/40 flex-1">
            <p className="text-gray-400 font-bold mb-6 uppercase text-[10px] md:text-xs tracking-widest text-center md:text-left">
              Consórcio Tradicional
            </p>
            <ul className="space-y-4 md:space-y-8 text-gray-300 font-medium text-xs md:text-sm text-center md:text-left">
              <li className="h-auto md:h-8 flex items-center justify-center md:justify-start text-red-400">
                15% a 25% (Embutida)
              </li>
              <li className="h-auto md:h-8 flex items-center justify-center md:justify-start text-red-400">
                0% (Corroído)
              </li>
              <li className="h-auto md:h-8 flex items-center justify-center md:justify-start">
                Serasa / Burocracia
              </li>
              <li className="h-auto md:h-8 flex items-center justify-center md:justify-start">
                30 a 60 dias
              </li>
              <li className="h-auto md:h-8 flex items-center justify-center md:justify-start">
                Centralizada (Banco)
              </li>
            </ul>
          </div>

          <div className="p-6 md:p-10 bg-gradient-to-b from-[#00FFA3]/10 to-transparent relative border-t-4 md:border-t-0 md:border-l-4 border-[#00FFA3] flex-1">
            <div className="absolute top-2 right-2 md:top-4 md:right-6 bg-[#00FFA3] text-[#0B132B] text-[8px] md:text-[10px] font-black px-2 py-1 rounded tracking-widest">
              COFI
            </div>
            <p className="text-[#00FFA3] font-bold mb-6 uppercase text-[10px] md:text-xs tracking-widest text-center md:text-left">
              RoundFi Protocol
            </p>
            <ul className="space-y-4 md:space-y-8 text-white font-bold text-xs md:text-sm text-center md:text-left">
              <li className="h-auto md:h-8 flex items-center justify-center md:justify-start">
                1.5% (Taxa Justa)
              </li>
              <li className="h-auto md:h-8 flex items-center justify-center md:justify-start text-[#00FFA3]">
                ~6.5% APY Base
              </li>
              <li className="h-auto md:h-8 flex items-center justify-center md:justify-start">
                RoundFi Score
              </li>
              <li className="h-auto md:h-8 flex items-center justify-center md:justify-start">
                Instantânea (On-chain)
              </li>
              <li className="h-auto md:h-8 flex items-center justify-center md:justify-start">
                Decentralized Pool
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-gray-900 pt-16 md:pt-20 pb-8 md:pb-10 bg-black/20">
        <div className="max-w-7xl w-full mx-auto px-6 md:px-10 grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-12 mb-10 md:mb-20 text-center md:text-left">
          <div className="col-span-1 md:col-span-2 flex flex-col items-center md:items-start">
            <div className="mb-4 md:mb-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="RoundFi Logo"
                className="h-16 w-auto object-contain grayscale opacity-50 hover:grayscale-0 hover:opacity-100 transition-all"
              />
            </div>
            <p className="text-gray-500 max-w-sm leading-relaxed text-xs md:text-sm">
              O RoundFi é um protocolo de{" "}
              <span className="text-gray-400">Collaborative Finance (CoFi)</span> construído na Solana
              para redefinir a formação de capital.
            </p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-4 md:mb-6 text-sm md:text-base">Protocolo</h4>
            <ul className="text-gray-500 space-y-3 md:space-y-4 text-xs md:text-sm">
              <li><a href="#" className="hover:text-white transition-colors">Group Savings</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Reputation Score</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Segurança & Auditoria</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold mb-4 md:mb-6 text-sm md:text-base">Comunidade</h4>
            <ul className="text-gray-500 space-y-3 md:space-y-4 text-xs md:text-sm">
              <li>
                <a
                  href="https://x.com/RoundFinanceSol"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  Twitter / X
                </a>
              </li>
              <li><a href="#" className="hover:text-white transition-colors">Discord</a></li>
              <li><a href="#" className="hover:text-white transition-colors">GitHub</a></li>
            </ul>
          </div>
        </div>
        <div className="text-center text-gray-600 text-[8px] md:text-xs tracking-widest border-t border-gray-900 pt-6 md:pt-10 uppercase px-4">
          © 2026 ROUNDFI PROTOCOL. DECENTRALIZED POOLED CAPITAL. SOLANA DEVNET.
        </div>
      </footer>
    </main>
  );
}
