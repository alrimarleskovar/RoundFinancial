/**
 * Admin allowlist (ADR 0009 §1). Authorization = the authenticated pubkey
 * is in the allowlist, which is seeded from:
 *   - `ProtocolConfig.authority` (the on-chain protocol owner), and
 *   - `ADMIN_ALLOWLIST` env (comma-separated base58 operator pubkeys).
 *
 * The pure `isAllowed` / `parseAllowlist` helpers take the inputs
 * explicitly so they are unit-testable; the on-chain authority fetch is a
 * separate, best-effort I/O step (see `resolveAllowlist`).
 */

export function parseAllowlist(envValue: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!envValue) return out;
  for (const raw of envValue.split(",")) {
    const pk = raw.trim();
    if (pk.length > 0) out.add(pk);
  }
  return out;
}

export function isAllowed(pubkey: string, allowlist: ReadonlySet<string>): boolean {
  return allowlist.has(pubkey);
}

/**
 * Assemble the effective allowlist: env operators ∪ on-chain authority.
 * The authority is best-effort — if the RPC read fails we fall back to the
 * env list and the caller logs a warning (the env list is the durable
 * floor; the authority is convenience so the owner is always allowed
 * without re-listing). At least one source must be non-empty or the
 * console is unreachable, which is the safe failure (fail-closed).
 */
export function buildAllowlist(args: {
  envValue: string | undefined;
  authority?: string | null;
}): Set<string> {
  const set = parseAllowlist(args.envValue);
  if (args.authority) set.add(args.authority);
  return set;
}
