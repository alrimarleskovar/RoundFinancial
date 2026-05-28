/**
 * Anchor account discriminator helper (ADR 0009 follow-up). Lives in its
 * own module so it is importable by tests WITHOUT triggering backfill.ts's
 * top-level `main()` / env check.
 *
 * Discriminator = sha256("account:<Name>")[..8] — the same 8 bytes Anchor
 * prepends to every account. Used as a `memcmp` filter at offset 0 in
 * getProgramAccounts, which (unlike a dataSize filter) survives struct
 * layout edits: it only changes if the account's type *name* changes.
 */

import { createHash } from "node:crypto";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Minimal base58 encoder (no bs58 dependency) for the 8-byte discriminator. */
export function base58(bytes: Uint8Array): string {
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  let out = "";
  while (x > 0n) {
    out = B58[Number(x % 58n)] + out;
    x /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) out = "1" + out;
    else break;
  }
  return out;
}

export function accountDiscriminatorBase58(accountName: string): string {
  const hash = createHash("sha256").update(`account:${accountName}`).digest();
  return base58(hash.subarray(0, 8));
}
