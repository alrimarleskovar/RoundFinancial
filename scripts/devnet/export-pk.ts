/**
 * Export a Solana CLI-format keypair (64-byte JSON array) as a base58
 * string for Phantom / Solflare wallet imports.
 *
 * Usage:
 *   pnpm devnet:export-pk keypairs/member-3.json
 *
 * Phantom's "Import Private Key" expects base58 of the **full 64-byte
 * secret key** (32-byte ed25519 seed + 32-byte public key concatenated,
 * the same bytes the CLI stores). It rejects the raw JSON array, hex,
 * and 32-byte-only encodings — mismatches surface as "Invalid private
 * key format" with no further hint.
 *
 * Output is the base58 string only — copy + paste straight into
 * Phantom. No newline trailing.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Keypair } from "@solana/web3.js";

// Inlined Base58 encoder (Bitcoin alphabet) so this script doesn't
// need a `bs58` direct dep. Mirrors the algorithm used by every Solana
// wallet — counts leading zero-bytes (each → "1"), runs base-256 → base-58
// conversion via repeated division on the BigInt of the byte array,
// returns the prefix-padded result.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros++;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    const r = Number(n % 58n);
    out = ALPHABET[r]! + out;
    n /= 58n;
  }
  return ALPHABET[0]!.repeat(leadingZeros) + out;
}

const path = process.argv[2];
if (!path) {
  console.error("Usage: tsx scripts/devnet/export-pk.ts <keypair.json>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(resolve(path), "utf-8"));
if (!Array.isArray(raw) || raw.length !== 64) {
  console.error(`Expected a 64-byte JSON array, got length=${raw.length}`);
  process.exit(1);
}

const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
process.stdout.write(base58Encode(kp.secretKey));
