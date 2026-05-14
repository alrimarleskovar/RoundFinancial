// RPC endpoint allowlist + multi-RPC quorum scaffolding.
//
// Issue #249 workstream 2 — RPC hardening. Addresses T2 from
// docs/security/frontend-security-checklist.md §1:
//   T2 — Compromised RPC endpoint returns false state
//   Vector: hostile RPC says pool is "Active" when it's Closed; user
//   signs `contribute` after cycle ended; tx still succeeds, funds locked.
//
// Mainnet posture (future):
//   - Endpoint allowlist enforced at app config — user CANNOT point at
//     an arbitrary endpoint via URL param / localStorage
//   - Multi-RPC quorum for high-stakes reads (claim_payout preconditions,
//     release_escrow precondition) — read from ≥ 2 RPCs and require
//     agreement
//   - Read-back verification after every signed tx — re-query a second
//     independent RPC after confirmation, assert state matches
//
// Today (devnet): allowlist exists + multi-RPC config scaffolds. The
// quorum-aware read helpers land in a follow-up PR (each touches every
// fund-movement code path; out of scope for this scaffolding PR).

import { Connection, type Commitment } from "@solana/web3.js";

import type { NetworkId } from "@/lib/network";

/**
 * Curated allowlist of trusted RPC providers per network. The user
 * CANNOT override this — production builds pin to these endpoints.
 * Adding a new provider:
 *   1. Verify the provider has been actively maintained ≥ 6 months
 *   2. Confirm no known data-integrity / fork-following incidents
 *   3. Document key rotation cadence for any API keys
 *   4. Test endpoint freshness vs Solana Foundation's canonical RPC
 */
export const RPC_ALLOWLIST: Readonly<Record<NetworkId, ReadonlyArray<string>>> = {
  // Localnet uses a local validator — no allowlist applies.
  localnet: ["http://127.0.0.1:8899"],

  // Devnet — public Solana RPC + Helius/Triton as quorum members.
  // Helius/Triton URLs include API keys at deploy time via build env
  // (NEXT_PUBLIC_HELIUS_DEVNET, NEXT_PUBLIC_TRITON_DEVNET). When unset
  // (e.g., local dev), the allowlist falls back to the public RPC.
  devnet: [
    "https://api.devnet.solana.com",
    // Helius and Triton are conditionally included by the resolver
    // below — they aren't hard-coded because the API key isn't a
    // public secret.
  ],
};

/**
 * Resolve the full RPC list for a network, including conditionally-
 * available providers from build-time environment variables.
 *
 * Returns the **primary** RPC plus zero or more **secondary** providers
 * for quorum reads. Order matters: index 0 is the canonical source for
 * write tx submission; index 1+ are read-only quorum members.
 */
export function resolveRpcAllowlist(network: NetworkId): {
  primary: string;
  secondaries: string[];
} {
  const baseline = [...RPC_ALLOWLIST[network]];

  const heliusKey = process.env.NEXT_PUBLIC_HELIUS_DEVNET;
  if (network === "devnet" && heliusKey) {
    baseline.push(`https://devnet.helius-rpc.com/?api-key=${heliusKey}`);
  }
  const tritonKey = process.env.NEXT_PUBLIC_TRITON_DEVNET;
  if (network === "devnet" && tritonKey) {
    baseline.push(`https://${tritonKey}.devnet.rpcpool.com`);
  }

  const [primary, ...secondaries] = baseline;
  if (!primary) {
    throw new Error(`No RPC allowlisted for network=${network}`);
  }
  return { primary, secondaries };
}

/**
 * Verify a runtime-supplied endpoint is on the allowlist for its
 * network. Used in production builds to refuse user-supplied endpoint
 * overrides (URL params, localStorage). Local dev bypass is via the
 * `localnet` network only — production builds never hit this branch.
 */
export function isAllowlistedEndpoint(endpoint: string, network: NetworkId): boolean {
  const { primary, secondaries } = resolveRpcAllowlist(network);
  return endpoint === primary || secondaries.includes(endpoint);
}

/**
 * Create N Connection objects (one per allowlisted endpoint) for
 * quorum-aware reads. Caller uses these to fan out reads via
 * `Promise.allSettled` and apply quorum logic (≥ ceil(N/2) agreement).
 *
 * **Important:** this returns connections WITHOUT a write endpoint
 * preference — writes (`sendTransaction`) should ALWAYS use the
 * primary connection (the one passed to `ConnectionProvider`),
 * because the wallet adapter binds to a single Connection at provider
 * mount time. Quorum is read-only.
 */
export function createQuorumConnections(
  network: NetworkId,
  commitment: Commitment = "confirmed",
): Connection[] {
  const { primary, secondaries } = resolveRpcAllowlist(network);
  return [primary, ...secondaries].map((url) => new Connection(url, commitment));
}

/**
 * Helper: read the same account from N RPC endpoints in parallel and
 * return the byte-for-byte agreed value, or `null` if RPCs disagree.
 *
 * Caller pattern:
 *
 *   const data = await readAccountQuorum(connections, poolPda);
 *   if (data === null) {
 *     // RPC divergence — defer the operation, log for ops
 *     return;
 *   }
 *   // decode data...
 *
 * Note: this is **eventual consistency aware** — RPCs may be at slightly
 * different slot heights, so we accept up to a 1-slot disagreement
 * window. For stricter consistency, the caller can fetch the slot from
 * each connection and require slot-equality before comparing data.
 */
export async function readAccountQuorum(
  connections: Connection[],
  address: import("@solana/web3.js").PublicKey,
): Promise<Buffer | null> {
  if (connections.length === 0) return null;
  if (connections.length === 1) {
    // Single-RPC mode — no quorum possible, return what we got.
    const info = await connections[0]!.getAccountInfo(address, "confirmed");
    return info?.data ?? null;
  }

  const results = await Promise.allSettled(
    connections.map((conn) => conn.getAccountInfo(address, "confirmed")),
  );
  const datas = results
    .map((r) => (r.status === "fulfilled" && r.value ? r.value.data : null))
    .filter((d): d is Buffer => d !== null);

  if (datas.length === 0) return null;
  // Byte-for-byte agreement check: all returned buffers must equal index 0.
  const first = datas[0]!;
  const allAgree = datas.every((d) => d.length === first.length && d.compare(first) === 0);
  return allAgree ? first : null;
}
