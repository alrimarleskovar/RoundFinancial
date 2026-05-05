"use client";

import Link from "next/link";
import { useEffect } from "react";

// Global error boundary. Catches any uncaught error thrown during
// render in any route segment (or its children) — without this file,
// Next 14 falls back to a stack trace in dev and a blank screen in
// prod. With it: branded recovery surface + a `reset()` button that
// the user can tap to retry the failing render.
//
// Must be a Client Component (Next requires `"use client"` on
// error.tsx — the file's exports include `reset` which is a closure
// over the route segment's render scope).
//
// `error.digest` is a stable hash Next attaches in production builds.
// Surfacing it lets a banca who hits a real bug paste the digest into
// an issue and we can grep server logs for it.

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Mirror to console for dev visibility. In production, Next
    // already wires the error to the runtime reporter; this is just
    // an extra safety net so a dev tab open during the demo can
    // see what blew up.
    // eslint-disable-next-line no-console
    console.error("[RoundFi] route error:", error);
  }, [error]);

  return (
    <main
      role="main"
      className="min-h-screen flex items-center justify-center bg-[#06090F] text-white font-sans relative overflow-hidden"
    >
      {/* Same ambient gradient signature as not-found / loading. */}
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
          className="font-black tracking-tight mb-6 leading-none select-none"
          style={{
            fontFamily: "var(--font-syne), Syne, sans-serif",
            fontSize: "clamp(80px, 18vw, 160px)",
            background: "linear-gradient(180deg, #9945FF 0%, #14F195 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            color: "transparent",
          }}
          aria-hidden="true"
        >
          ⚠
        </div>

        <h1
          className="text-2xl md:text-3xl font-bold mb-3 tracking-tight"
          style={{ fontFamily: "var(--font-syne), Syne, sans-serif" }}
        >
          Algo deu errado
        </h1>
        <p className="text-gray-400 text-sm md:text-base mb-1">
          Tropeçamos num erro inesperado. Não foi você — foi a gente.
        </p>
        <p className="text-gray-500 text-xs md:text-sm mb-8 italic">
          Something broke · this isn&apos;t your fault
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center h-[50px] px-8 rounded-2xl bg-[#14F195] text-[#06090F] font-black tracking-tight transition-transform hover:scale-[1.02]"
          >
            Tentar novamente
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center h-[50px] px-8 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors font-bold text-sm"
          >
            Voltar ao início
          </Link>
        </div>

        {error.digest && (
          <div
            className="text-[10px] tracking-[0.12em] uppercase text-gray-600 break-all"
            style={{
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            }}
          >
            ERROR ID · {error.digest}
          </div>
        )}
      </div>
    </main>
  );
}
