/**
 * Classify an error from an on-chain action into operational buckets,
 * so the crank knows whether to retry silently (INFRA) or escalate
 * (LOGIC). Without this split every error gets the same treatment and
 * an on-chain constraint violation looks identical to an RPC blip.
 *
 * The classification is deliberately string-pattern based on the error
 * message — this is the lowest-friction way that works across the
 * Anchor / web3.js / node:fetch error surface (each lib throws a
 * different Error subclass). When a new pattern surfaces in prod logs,
 * add it here with a comment naming the prod incident.
 */

export type ErrorKind = "INFRA" | "LOGIC" | "UNKNOWN";

/**
 * Returns:
 *   - INFRA:  network / RPC / blockhash / timeout — retry on next tick
 *   - LOGIC:  on-chain custom error / Anchor constraint — needs eng
 *   - UNKNOWN: catch-all; surfaces in alert so we can extend the rules
 */
export function classifyError(err: unknown): ErrorKind {
  const msg = errorMessage(err).toLowerCase();

  // ── INFRA: retry-safe network/blockchain ephemera ──────────────────
  if (
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("fetch failed") ||
    msg.includes("network request failed") ||
    msg.includes("socket hang up") ||
    msg.includes("blockhash not found") ||
    msg.includes("transaction was not confirmed") ||
    msg.includes("node is behind") ||
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("503")
  ) {
    return "INFRA";
  }

  // ── LOGIC: on-chain rejection — retry does NOT help ───────────────
  if (
    msg.includes("custom program error") ||
    msg.includes("anchorerror") ||
    msg.includes("error code:") ||
    msg.includes("constraint") ||
    msg.includes("simulation failed") ||
    msg.includes("instruction error") ||
    // Common roundfi-core / reputation guards (already audited surface)
    msg.includes("graceperiodnotelapsed") ||
    msg.includes("membernotbehind") ||
    msg.includes("wrongcycle") ||
    msg.includes("poolnotactive") ||
    msg.includes("alreadycontributed") ||
    msg.includes("cooldownactive")
  ) {
    return "LOGIC";
  }

  return "UNKNOWN";
}

/** Defensive: error objects can be anything thrown — incl. null / undefined. */
function errorMessage(err: unknown): string {
  if (err == null) return "";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    // JSON.stringify can return undefined (e.g. for symbols); fall back.
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}
