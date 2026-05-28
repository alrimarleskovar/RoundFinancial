/**
 * Sign-In-With-Solana (SIWS) — message construction + server-side
 * signature verification for the admin console (ADR 0009 §1).
 *
 * The gate lives on the ENDPOINTS, not the UI: every protected
 * `/api/admin/**` route verifies a session that can only be minted after
 * this ed25519 check passes against the admin allowlist. Hiding a screen
 * does not count.
 *
 * No new dependency: ed25519 verification uses Node's built-in `crypto`
 * (route handlers run on the Node runtime). A raw 32-byte Solana public
 * key is wrapped in its DER SubjectPublicKeyInfo envelope so
 * `crypto.verify` accepts it. The base58 pubkey is decoded via
 * `@solana/web3.js` `PublicKey` (already an app dependency).
 */

import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

/** Default domain shown in the signed message; override per-deploy via env. */
export const DEFAULT_ADMIN_DOMAIN = "admin.roundfi";

export interface SignInMessageParts {
  domain: string;
  /** base58 Solana address being authenticated. */
  pubkey: string;
  /** Opaque random challenge (hex), bound to the challenge token. */
  nonce: string;
  /** Issued-at, epoch milliseconds. Rendered as ISO in the message. */
  issuedAt: number;
}

/**
 * Canonical, deterministic message the wallet signs. The server
 * reconstructs this byte-for-byte from the challenge it issued, so the
 * client cannot smuggle a different statement past verification.
 */
export function buildSignInMessage(parts: SignInMessageParts): string {
  const issuedAtIso = new Date(parts.issuedAt).toISOString();
  return [
    `${parts.domain} wants you to sign in with your Solana account:`,
    parts.pubkey,
    "",
    "RoundFi admin console access (read-only operational data).",
    "",
    `Nonce: ${parts.nonce}`,
    `Issued At: ${issuedAtIso}`,
  ].join("\n");
}

// DER SubjectPublicKeyInfo prefix for an ed25519 public key (RFC 8410).
// 0x30 0x2a SEQUENCE(42) | 0x30 0x05 AlgId | 0x06 0x03 0x2b 0x65 0x70 OID
// | 0x03 0x21 0x00 BIT STRING(33), then the 32 raw key bytes.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function rawEd25519PublicKeyToKeyObject(raw: Uint8Array) {
  if (raw.length !== 32) {
    throw new Error(`ed25519 public key must be 32 bytes, got ${raw.length}`);
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(raw)]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

/**
 * Verify that `signature` is a valid ed25519 signature of `message` by
 * `pubkeyBase58`. Returns false (never throws) on any malformed input so
 * the route handler can answer a uniform 401 without leaking which part
 * failed.
 */
export function verifySignInSignature(
  pubkeyBase58: string,
  message: string,
  signature: Uint8Array,
): boolean {
  try {
    if (signature.length !== 64) return false;
    const raw = new PublicKey(pubkeyBase58).toBytes();
    const keyObject = rawEd25519PublicKeyToKeyObject(raw);
    return cryptoVerify(null, Buffer.from(message, "utf8"), keyObject, Buffer.from(signature));
  } catch {
    return false;
  }
}
