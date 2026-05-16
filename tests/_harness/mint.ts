/**
 * USDC mint fixture.
 *
 * Tests MUST NOT depend on the real devnet USDC mint — we want full
 * control over supply and authority. Each spec (or shared fixture)
 * creates a fresh 6-decimal "USDC" mint owned by the harness payer.
 *
 * Helpers:
 *   createUsdcMint(env)      — returns the mint pubkey
 *   ensureAta(env, mint, owner) — get-or-create ATA, returns pubkey
 *   mintTo(env, mint, dest, amount) — mint USDC base units to `dest`
 *   fundUsdc(env, mint, owner, amount) — idempotent "give this wallet N USDC"
 */

import { PublicKey, Keypair, Signer } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo as splMintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import type { Env } from "./env.js";

export const USDC_DECIMALS = 6;

/** Base units per whole USDC (1 USDC = 1_000_000 base units). */
export const USDC_UNIT = 10n ** BigInt(USDC_DECIMALS);

/** Convert whole USDC to base units: `usdc(5)` ⇒ `5_000_000n`. */
export function usdc(whole: number | bigint): bigint {
  return (typeof whole === "bigint" ? whole : BigInt(whole)) * USDC_UNIT;
}

/**
 * Get (or create) the harness USDC mint.
 *
 * Idempotent across mocha runs against the same validator: if a
 * `ProtocolConfig` PDA already exists on chain, we reuse its
 * `usdc_mint` instead of minting a fresh one. This lets specs that
 * each call `createUsdcMint()` then `initializeProtocol(env, {
 * usdcMint })` cooperate on a non-reset validator — without this,
 * every spec after the first hits `InvalidMint` (6025) at
 * `create_pool` because the chain config holds the previous spec's
 * mint.
 *
 * Mint authority is `env.payer`. Since the validator+wallet pair is
 * stable across runs (same `~/.config/solana/id.json` keypair), the
 * payer can keep minting against the persisted mint — `fundUsdc` and
 * friends work identically pre- and post-reuse.
 *
 * First call (cold): mints a new 6-decimal USDC-like token, returns
 *   the pubkey. Spec then passes it to `initializeProtocol`, which
 *   writes it into `ProtocolConfig`.
 * Subsequent calls (warm): reads `ProtocolConfig.usdc_mint` off
 *   chain, returns that.
 *
 * Pass `{ forceFresh: true }` to bypass the reuse — useful for
 * specs that need a SECOND, unrelated mint to exercise wrong-mint
 * negative paths (`InvalidMint` guards etc.). The fresh mint is
 * NOT written to ProtocolConfig, so it never participates in the
 * canonical reuse cycle.
 */
export async function createUsdcMint(
  env: Env,
  opts: { forceFresh?: boolean } = {},
): Promise<PublicKey> {
  if (!opts.forceFresh) {
    // Lazy import to dodge the circular `protocol.ts ← mint.ts` cycle
    // — `protocol.ts` imports `ensureAta` from here.
    const { configPda } = await import("./pda.js");
    const config = configPda(env);
    const existing = await env.connection.getAccountInfo(config, "confirmed");
    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const decoded = (await (env.programs.core.account as any).protocolConfig.fetch(config)) as {
        usdcMint: PublicKey;
      };
      return decoded.usdcMint;
    }
  }
  return createMint(
    env.connection,
    env.payer,
    env.payer.publicKey, // mint authority
    env.payer.publicKey, // freeze authority (unused, but set)
    USDC_DECIMALS,
    undefined,
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
  );
}

/** Get or create an ATA for `owner`. Returns the ATA pubkey. */
export async function ensureAta(
  env: Env,
  mint: PublicKey,
  owner: PublicKey,
  payer: Signer = env.payer,
): Promise<PublicKey> {
  const account = await getOrCreateAssociatedTokenAccount(
    env.connection,
    payer,
    mint,
    owner,
    true, // allowOwnerOffCurve — some owners are PDAs
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return account.address;
}

/** Mint `amount` base units to `dest` (an ATA, not a wallet). */
export async function mintToAta(
  env: Env,
  mint: PublicKey,
  dest: PublicKey,
  amount: bigint,
): Promise<void> {
  await splMintTo(
    env.connection,
    env.payer,
    mint,
    dest,
    env.payer, // mint authority (= payer, by createUsdcMint)
    amount,
    [],
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
  );
}

/**
 * Idempotent: ensure `owner` has at least `amount` USDC (base units)
 * in their ATA. Mints the shortfall. Returns the ATA pubkey.
 */
export async function fundUsdc(
  env: Env,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint,
): Promise<PublicKey> {
  const ata = await ensureAta(env, mint, owner);
  const acct = await getAccount(env.connection, ata, "confirmed", TOKEN_PROGRAM_ID);
  if (acct.amount < amount) {
    await mintToAta(env, mint, ata, amount - acct.amount);
  }
  return ata;
}

/** Read current token balance (base units) for an ATA. */
export async function balanceOf(env: Env, ata: PublicKey): Promise<bigint> {
  const acct = await getAccount(env.connection, ata, "confirmed", TOKEN_PROGRAM_ID);
  return acct.amount;
}

/**
 * Bulk-fund many members in one helper call. Returns a map of
 * wallet-pubkey → ATA-pubkey for later assertion lookups.
 */
export async function fundMany(
  env: Env,
  mint: PublicKey,
  wallets: (PublicKey | Keypair)[],
  amount: bigint,
): Promise<Map<string, PublicKey>> {
  const out = new Map<string, PublicKey>();
  for (const w of wallets) {
    const pk = w instanceof Keypair ? w.publicKey : w;
    const ata = await fundUsdc(env, mint, pk, amount);
    out.set(pk.toBase58(), ata);
  }
  return out;
}
