// On-chain reads for mobile — IDL-free path.
//
// Mobile deliberately does NOT build the full Anchor `RoundFiClient`
// (that needs the generated IDLs bundled into the app, which the
// `--no-idl` toolchain doesn't ship). Instead we go straight to
// `getProgramAccounts` + the SDK's hand-written `decodePoolRaw`, the
// same IDL-free decoder the web app and indexer use. This keeps the
// mobile bundle small and the read path identical to web.
//
// Read-only by design: no Keypair, no signing, no wallet here. That
// belongs to a later phase (wallet-connect). Everything in this file
// is a plain RPC GET.

import { Connection, PublicKey } from "@solana/web3.js";

import {
  decodePoolRaw,
  fetchPoolMembers as sdkFetchPoolMembers,
  fetchPoolRaw,
  fetchReputationProfileRaw,
  type RawMemberView,
  type RawPoolView,
  type RawReputationProfile,
} from "@roundfi/sdk/onchain-raw";

// Canonical devnet RoundFi core program id (mirrors HomeScreen +
// app/src/lib/devnet.ts:14). Hard-coded so mobile never imports from
// app/ — the two apps stay decoupled.
export const DEVNET_CORE_PROGRAM_ID = new PublicKey("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw");

/** Reputation program (devnet) — mirrors app/src/lib/devnet.ts:15. */
export const DEVNET_REPUTATION_PROGRAM_ID = new PublicKey(
  "Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2",
);

/** Devnet USDC mint used by the RoundFi devnet deployment — mirrors
 *  app/src/lib/devnet.ts:22. Not real circle-USDC; a 6-decimal test mint. */
export const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

/** SPL Token program (token v1). Same constant the SDK + app use. */
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** Associated Token Account program. */
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// Public devnet RPC. Fine for low-frequency read-only mobile use; a
// real deployment would point at a paid endpoint via app config.
const DEVNET_RPC_URL = "https://api.devnet.solana.com";

// Pool account's 8-byte Anchor discriminator, base58-encoded for the
// memcmp filter. Computed once via:
//   sha256("account:Pool")[0..8]  →  hex f19a6d0411b16dbc
//   bs58.encode(...)              →  hQrXeCntzbV
// Discriminator-filtered (not dataSize) so it survives Pool struct
// growth — same rationale as services/indexer/src/discriminator.ts.
const POOL_DISCRIMINATOR_B58 = "hQrXeCntzbV";

let connection: Connection | null = null;

/** Lazily-created singleton devnet connection. */
export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(DEVNET_RPC_URL, "confirmed");
  }
  return connection;
}

/**
 * Enumerate every Pool account owned by the core program, decoded into
 * the shared `RawPoolView` shape. Sorted newest-first (highest
 * startedAt), mirroring the web app's `listAllPools`.
 */
export async function listPools(): Promise<RawPoolView[]> {
  const conn = getConnection();
  const accounts = await conn.getProgramAccounts(DEVNET_CORE_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: POOL_DISCRIMINATOR_B58 } }],
  });

  const pools = accounts.map(({ pubkey, account }) =>
    decodePoolRaw(pubkey, account.data as Buffer),
  );

  return pools.sort((a, b) => {
    if (a.startedAt !== b.startedAt) return Number(b.startedAt - a.startedAt);
    return a.address.toBase58().localeCompare(b.address.toBase58());
  });
}

/**
 * Fetch a single Pool by its address. Returns null when the account
 * doesn't exist (deep-link to a closed/wrong address renders an empty
 * state instead of throwing).
 */
export async function fetchPool(address: PublicKey | string): Promise<RawPoolView | null> {
  const pk = typeof address === "string" ? new PublicKey(address) : address;
  return fetchPoolRaw(getConnection(), pk);
}

/**
 * Fetch every Member account belonging to `poolAddress`, sorted by
 * slot index (deterministic roster order). Read-only — same
 * getProgramAccounts path the web roster card uses.
 */
export async function fetchMembers(poolAddress: PublicKey | string): Promise<RawMemberView[]> {
  const pk = typeof poolAddress === "string" ? new PublicKey(poolAddress) : poolAddress;
  return sdkFetchPoolMembers(getConnection(), DEVNET_CORE_PROGRAM_ID, pk);
}

/**
 * Parse a base58 string into a PublicKey, returning null on any
 * malformed input. UI screens use this to validate user-pasted
 * wallet addresses without throwing.
 */
export function parseAddress(input: string): PublicKey | null {
  try {
    return new PublicKey(input.trim());
  } catch {
    return null;
  }
}

/** SOL balance in **lamports** (1 SOL = 1e9 lamports). */
export async function fetchSolBalance(wallet: PublicKey | string): Promise<bigint> {
  const pk = typeof wallet === "string" ? new PublicKey(wallet) : wallet;
  const lamports = await getConnection().getBalance(pk, "confirmed");
  return BigInt(lamports);
}

/**
 * USDC balance on the wallet's Associated Token Account (devnet mint).
 * Returns 0n when the ATA doesn't exist yet (treated as zero balance,
 * not an error — matches the web app's behavior).
 */
export async function fetchUsdcBalance(wallet: PublicKey | string): Promise<bigint> {
  const pk = typeof wallet === "string" ? new PublicKey(wallet) : wallet;
  const ata = deriveAta(pk, DEVNET_USDC_MINT);
  try {
    const info = await getConnection().getTokenAccountBalance(ata, "confirmed");
    return BigInt(info.value.amount);
  } catch {
    // ATA doesn't exist — Solana RPC throws on getTokenAccountBalance
    // for a missing account. Treat as zero (the canonical web-app
    // semantics for "wallet hasn't been funded yet").
    return 0n;
  }
}

/**
 * Fetch a wallet's on-chain reputation profile. Returns null when the
 * profile account hasn't been initialized yet — callers should render
 * a "fresh wallet" default (level 1, score 0), not an error.
 */
export async function fetchReputation(
  wallet: PublicKey | string,
): Promise<RawReputationProfile | null> {
  const pk = typeof wallet === "string" ? new PublicKey(wallet) : wallet;
  return fetchReputationProfileRaw(getConnection(), DEVNET_REPUTATION_PROGRAM_ID, pk);
}

/**
 * Derive the Associated Token Account for (owner, mint). Inlined here
 * so mobile doesn't need to pull in `@solana/spl-token` (which carries
 * a sizable RN-incompatible transitive surface). The seed shape is the
 * canonical ATA derivation: [owner, tokenProgram, mint] PDA'd against
 * the ATA program. Matches `getAssociatedTokenAddressSync(mint, owner)`.
 */
function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

// ─── Formatting helpers ──────────────────────────────────────────────

const USDC_DECIMALS = 6n;
const USDC_UNIT = 10n ** USDC_DECIMALS;

/** base units → "12.50" (2 decimal places, no symbol). */
export function formatUsdc(baseUnits: bigint): string {
  const whole = baseUnits / USDC_UNIT;
  const cents = ((baseUnits % USDC_UNIT) * 100n) / USDC_UNIT;
  return `${whole}.${cents.toString().padStart(2, "0")}`;
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** lamports → "1.2345" (4 decimal places). Wallets typically see SOL
 *  amounts < 10 — 4 places balances readability with usefulness. */
export function formatSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = ((lamports % LAMPORTS_PER_SOL) * 10_000n) / LAMPORTS_PER_SOL;
  return `${whole}.${frac.toString().padStart(4, "0")}`;
}

/** Title-case the raw status enum for display. */
export function statusLabel(status: RawPoolView["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** bps → percent string. 500 → "5%", 1250 → "12.5%". */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/** seconds (bigint) → compact "2d" / "48h" / "30m" / "90s". */
export function formatDuration(secs: bigint): string {
  const s = Number(secs);
  if (s === 0) return "—";
  if (s % 86400 === 0) return `${s / 86400}d`;
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60}m`;
  return `${s}s`;
}

/**
 * epoch seconds (bigint) → "2026-05-30 14:22 UTC", or "—" when unset.
 * UTC (not device TZ) so a protocol-state view reads the same on any
 * phone — the chain timestamps are UTC.
 */
export function formatTimestamp(epochSecs: bigint): string {
  if (epochSecs === 0n) return "—";
  const iso = new Date(Number(epochSecs) * 1000).toISOString();
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** reputation level → "L1".."L3" (or "L?(n)" for an unexpected value). */
export function reputationLabel(level: number): string {
  return level >= 1 && level <= 3 ? `L${level}` : `L?(${level})`;
}
