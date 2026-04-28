"use client";

// Slow vertical scroll of synthesized on-chain operations behind
// the hero. Mono font, very low opacity, masked at the top + bottom
// edges so it fades in/out instead of clipping hard. The content
// is duplicated 2x and translated -50% over 60s for a seamless loop.

const LINES = [
  "tx_4xR9…k9Fn  payment.send       -892.40 USDC   escrow.usdc",
  "tx_8mP2…aQ7L  yield.claim        +52.30 USDC    kamino.vault",
  "tx_2vK7…hN4T  secondary.market   +1890.00 USDC  @petrus",
  "tx_6wB3…pX1Z  sas.attestation    +18 pts        civic.pass",
  "tx_9hT4…mW2K  pool.join          -22.50 USDC    renovacao_mei",
  "tx_5kF8…aL3R  yield.claim        +41.05 USDC    kamino.vault",
  "tx_3pN6…vQ7H  payment.send       -892.40 USDC   escrow.usdc",
  "tx_1dS9…cE4M  sas.attestation    +6 pts         civic.pass",
  "tx_7yU2…rB5V  secondary.market   +1640.00 USDC  @intercambio",
  "tx_8jX1…fC9T  yield.claim        +73.18 USDC    kamino.vault",
  "tx_4nM7…hW6K  pool.draw          +10000.00 USDC seed_winner",
  "tx_2zL8…oP3Q  payment.send       -620.00 USDC   escrow.usdc",
  "tx_6gR5…bN8H  sas.attestation    +24 pts        veteran_track",
  "tx_5tV2…iY7L  pool.join          -16.50 USDC    dev_setup_6m",
  "tx_9wB4…sM2D  yield.claim        +88.42 USDC    kamino.vault",
  "tx_3aF7…uK1G  secondary.market   +1200.00 USDC  @reforma",
  "tx_1cQ9…eN6W  payment.send       -2140.00 USDC  escrow.usdc",
  "tx_8mZ3…tH5J  sas.attestation    +12 pts        civic.pass",
];

export function DataStream() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 overflow-hidden pointer-events-none z-0"
      style={{
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent, rgba(0,0,0,0.7) 25%, rgba(0,0,0,0.7) 75%, transparent)",
        maskImage:
          "linear-gradient(to bottom, transparent, rgba(0,0,0,0.7) 25%, rgba(0,0,0,0.7) 75%, transparent)",
      }}
    >
      <div
        className="rfi-stream font-mono text-[10px] md:text-xs text-[#14F195] flex flex-col gap-2 px-4 md:px-12"
        style={{ opacity: 0.07 }}
      >
        {[...LINES, ...LINES].map((line, i) => (
          <span key={i} className="whitespace-nowrap">
            <span className="text-[#9945FF]/80">{">"}</span> {line}
          </span>
        ))}
      </div>
    </div>
  );
}
