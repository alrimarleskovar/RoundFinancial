/** Helpers for rendering u64 USDC base units as human strings. */

const USDC_DECIMALS = 6;
const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS);

export function formatUsdc(amount: bigint, opts?: { suffix?: boolean }): string {
  const suffix = opts?.suffix ?? true;
  const whole = amount / USDC_SCALE;
  const frac = amount % USDC_SCALE;
  let out: string;
  if (frac === 0n) {
    out = whole.toString();
  } else {
    const fracStr = frac
      .toString()
      .padStart(USDC_DECIMALS, "0")
      .replace(/0+$/, "");
    out = `${whole.toString()}.${fracStr}`;
  }
  return suffix ? `${out} USDC` : out;
}

export function usdc(whole: number | bigint): bigint {
  return (typeof whole === "bigint" ? whole : BigInt(whole)) * USDC_SCALE;
}
