import Link from "next/link";

// Global 404 page. Catches any URL that doesn't match an app route
// (e.g. /group, /dashboard, /banca-typed-this-wrong) — Next 14
// resolves this file via the app-router's not-found convention.
//
// Server Component on purpose: no client state needed, ships zero JS,
// renders instantly even on cold cache. The neon palette mirrors the
// landing so the page feels like part of the brand instead of a
// browser-default error screen.

export default function NotFound() {
  return (
    <main
      className="min-h-screen flex items-center justify-center bg-[#06090F] text-white font-sans relative overflow-hidden"
      role="main"
    >
      {/* Ambient gradient blobs — same brand treatment as the landing. */}
      <div
        aria-hidden="true"
        className="absolute top-[-15%] left-[-10%] w-[400px] md:w-[600px] h-[400px] md:h-[600px] bg-[#9945FF] opacity-10 blur-[80px] md:blur-[120px] pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="absolute bottom-[-15%] right-[-10%] w-[300px] md:w-[500px] h-[300px] md:h-[500px] bg-[#14F195] opacity-10 blur-[80px] md:blur-[120px] pointer-events-none"
      />

      <div className="relative z-10 px-6 max-w-xl text-center">
        <div
          className="font-black tracking-tight mb-6 leading-none"
          style={{
            fontFamily: "var(--font-syne), Syne, sans-serif",
            fontSize: "clamp(96px, 22vw, 200px)",
            background: "linear-gradient(180deg, #14F195 0%, #9945FF 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          404
        </div>

        <h1
          className="text-2xl md:text-3xl font-bold mb-3 tracking-tight"
          style={{ fontFamily: "var(--font-syne), Syne, sans-serif" }}
        >
          Página fora do mapa
        </h1>
        <p className="text-gray-400 text-sm md:text-base mb-1">
          Esse caminho não existe no protocolo. Deve ter sido um typo ou um link antigo.
        </p>
        <p className="text-gray-500 text-xs md:text-sm mb-10 italic">
          Off the map · this route doesn&apos;t exist
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center h-[50px] px-8 rounded-2xl bg-[#14F195] text-[#06090F] font-black tracking-tight transition-transform hover:scale-[1.02]"
          >
            Voltar ao início
          </Link>
          <Link
            href="/home"
            className="inline-flex items-center justify-center h-[50px] px-8 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors font-bold text-sm"
          >
            Ir para o dashboard
          </Link>
        </div>

        <div
          className="mt-12 text-[10px] tracking-[0.18em] uppercase text-gray-600"
          style={{
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          ROUNDFI · COOPERATIVE CREDIT ON SOLANA
        </div>
      </div>
    </main>
  );
}
