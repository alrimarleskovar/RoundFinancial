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
  type RawMemberView,
  type RawPoolView,
} from "@roundfi/sdk/onchain-raw";

// Canonical devnet RoundFi core program id (mirrors HomeScreen +
// app/src/lib/devnet.ts:14). Hard-coded so mobile never imports from
// app/ — the two apps stay decoupled.
export const DEVNET_CORE_PROGRAM_ID = new PublicKey("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw");

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

// ─── Formatting helpers ──────────────────────────────────────────────

const USDC_DECIMALS = 6n;
const USDC_UNIT = 10n ** USDC_DECIMALS;

/** base units → "12.50" (2 decimal places, no symbol). */
export function formatUsdc(baseUnits: bigint): string {
  const whole = baseUnits / USDC_UNIT;
  const cents = ((baseUnits % USDC_UNIT) * 100n) / USDC_UNIT;
  return `${whole}.${cents.toString().padStart(2, "0")}`;
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
