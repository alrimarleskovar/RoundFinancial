import { RFILogoMark } from "@/components/brand/brand";

// Global loading state. Next 14 app-router shows this whenever a
// route segment suspends — typed routes, dynamic data fetches, etc.
// Without this file, route transitions flash to a blank white screen
// for ~50-300ms; with it, the dark brand surface is held the whole
// way through.
//
// Server Component on purpose (zero JS shipped). The CSS animation
// runs entirely on the GPU via `animate-pulse`. The `RFILogoMark`
// import is a "use client" component — Next handles the boundary
// transparently when imported from a server-rendered page.

export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Carregando"
      className="min-h-screen flex items-center justify-center bg-[#06090F] relative overflow-hidden"
    >
      {/* Same ambient gradient blobs as the landing — keeps the brand
          surface continuous across loading → page transitions. */}
      <div
        aria-hidden="true"
        className="absolute top-[-15%] left-[-10%] w-[400px] md:w-[600px] h-[400px] md:h-[600px] bg-[#9945FF] opacity-[0.06] blur-[80px] md:blur-[120px] pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="absolute bottom-[-15%] right-[-10%] w-[300px] md:w-[500px] h-[300px] md:h-[500px] bg-[#14F195] opacity-[0.06] blur-[80px] md:blur-[120px] pointer-events-none"
      />

      <div className="flex flex-col items-center gap-6 relative z-10">
        <div className="animate-pulse">
          <RFILogoMark size={64} />
        </div>
        <span className="sr-only">Carregando…</span>
        <div
          className="text-[10px] tracking-[0.18em] uppercase text-gray-600"
          style={{
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
          aria-hidden="true"
        >
          ROUNDFI
        </div>
      </div>
    </div>
  );
}
