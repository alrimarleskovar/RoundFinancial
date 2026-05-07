/**
 * On-chain log parser for RoundFi.
 *
 * The roundfi-core program emits structured `msg!` lines for every
 * mutating ix — see `programs/roundfi-core/src/instructions/*.rs`.
 * Examples:
 *
 *   "Program log: roundfi-core: contribute cycle=1 member=DC5D...
 *      installment=10000000 solidarity=100000 escrow=2500000
 *      pool_float=7400000 on_time=false"
 *
 *   "Program log: roundfi-core: claim_payout cycle=0 slot=0
 *      recipient=DC5D... amount=30000000 next_cycle=1"
 *
 *   "Program log: roundfi-core: settle_default cycle=1 member=4sLS...
 *      seized_total=200000 solidarity=200000 escrow=0 stake=0
 *      d_rem=30000000 c_init=30000000 c_after=30000000"
 *
 * This module parses those lines into typed events without needing
 * the IDL — symmetric to how `sdk/src/onchain-raw.ts` decodes
 * accounts. When IDL gen unblocks (Anchor 0.31+), we can swap to
 * `program.coder.events.decode(...)` against `Program.addEventListener`.
 *
 * We intentionally parse logs (not Anchor events) because:
 *   - the program already emits human-readable summaries for ops,
 *   - log parsing is forward-compatible with new fields (we ignore
 *     unknown `key=value` pairs gracefully),
 *   - it works without the IDL (which is the whole point).
 */

const PREFIX_CONTRIBUTE = "Program log: roundfi-core: contribute";
const PREFIX_CLAIM = "Program log: roundfi-core: claim_payout";
const PREFIX_DEFAULT = "Program log: roundfi-core: settle_default";

export type CoreEvent = ContributeEventLog | ClaimEventLog | SettleDefaultEventLog;

export interface ContributeEventLog {
  kind: "contribute";
  cycle: number;
  member: string;
  installment: bigint;
  solidarityAmt: bigint;
  escrowAmt: bigint;
  poolFloatAmt: bigint;
  onTime: boolean;
}

export interface ClaimEventLog {
  kind: "claim";
  cycle: number;
  slotIndex: number;
  recipient: string;
  amount: bigint;
  nextCycle: number | null;
}

export interface SettleDefaultEventLog {
  kind: "settle_default";
  cycle: number;
  member: string;
  seizedTotal: bigint;
  seizedSolidarity: bigint;
  seizedEscrow: bigint;
  seizedStake: bigint;
  dInit: bigint;
  dRem: bigint;
  cInit: bigint;
  cAfter: bigint;
}

/**
 * Parse a single program-log line. Returns null when the line
 * doesn't match any recognized event prefix — caller drops the line.
 */
export function parseLogLine(line: string): CoreEvent | null {
  if (line.startsWith(PREFIX_CONTRIBUTE)) return parseContribute(line);
  if (line.startsWith(PREFIX_CLAIM)) return parseClaim(line);
  if (line.startsWith(PREFIX_DEFAULT)) return parseSettleDefault(line);
  return null;
}

/**
 * Extract every recognized event from a tx's `meta.logMessages` array.
 * One tx can emit multiple events (e.g. claim_payout that also
 * touches a default member), so this returns a list.
 */
export function parseLogMessages(logs: readonly string[]): CoreEvent[] {
  const out: CoreEvent[] = [];
  for (const line of logs) {
    const evt = parseLogLine(line);
    if (evt) out.push(evt);
  }
  return out;
}

// ─── Internal: log-line parsers ──────────────────────────────────────

function parseKeyValue(line: string): Map<string, string> {
  // Strip the program-prefix; keep the trailing key=value pairs.
  const pairs = new Map<string, string>();
  for (const tok of line.split(/\s+/)) {
    const eq = tok.indexOf("=");
    if (eq <= 0) continue;
    pairs.set(tok.slice(0, eq), tok.slice(eq + 1));
  }
  return pairs;
}

function readBigInt(map: Map<string, string>, key: string): bigint {
  const v = map.get(key);
  if (v === undefined) throw new Error(`missing key in log: ${key}`);
  return BigInt(v);
}

function readNumber(map: Map<string, string>, key: string): number {
  const v = map.get(key);
  if (v === undefined) throw new Error(`missing key in log: ${key}`);
  return Number(v);
}

function readString(map: Map<string, string>, key: string): string {
  const v = map.get(key);
  if (v === undefined) throw new Error(`missing key in log: ${key}`);
  return v;
}

function parseContribute(line: string): ContributeEventLog {
  const kv = parseKeyValue(line);
  return {
    kind: "contribute",
    cycle: readNumber(kv, "cycle"),
    member: readString(kv, "member"),
    installment: readBigInt(kv, "installment"),
    solidarityAmt: readBigInt(kv, "solidarity"),
    escrowAmt: readBigInt(kv, "escrow"),
    poolFloatAmt: readBigInt(kv, "pool_float"),
    onTime: readString(kv, "on_time") === "true",
  };
}

function parseClaim(line: string): ClaimEventLog {
  const kv = parseKeyValue(line);
  return {
    kind: "claim",
    cycle: readNumber(kv, "cycle"),
    slotIndex: readNumber(kv, "slot"),
    recipient: readString(kv, "recipient"),
    amount: readBigInt(kv, "amount"),
    nextCycle: kv.has("next_cycle") ? readNumber(kv, "next_cycle") : null,
  };
}

function parseSettleDefault(line: string): SettleDefaultEventLog {
  const kv = parseKeyValue(line);
  return {
    kind: "settle_default",
    cycle: readNumber(kv, "cycle"),
    member: readString(kv, "member"),
    seizedTotal: readBigInt(kv, "seized_total"),
    seizedSolidarity: readBigInt(kv, "solidarity"),
    seizedEscrow: readBigInt(kv, "escrow"),
    seizedStake: readBigInt(kv, "stake"),
    dInit: kv.has("d_init") ? readBigInt(kv, "d_init") : 0n,
    dRem: readBigInt(kv, "d_rem"),
    cInit: readBigInt(kv, "c_init"),
    cAfter: readBigInt(kv, "c_after"),
  };
}
