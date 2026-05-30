// Pure cluster classification from an RPC endpoint URL.
//
// Extracted from `NetworkBanner.tsx` so the underlying source-of-truth
// for "what cluster is this URL pointing at" can be unit-tested
// without instantiating the React component tree. Used by the banner
// (and by anything else that needs to classify the connection URL
// post-mount).
//
// SEV-045 — the classification IS the front-end's last-mile defense
// against an upstream-context lie ("useNetwork() says devnet, but the
// RPC actually points at mainnet"). Anything that can drift between
// the cluster the user thinks they're on and the cluster the wallet
// signs against must surface here.

export type Cluster = "localnet" | "devnet" | "mainnet" | "unknown";

/**
 * Classify a Solana RPC endpoint URL into a known cluster, or
 * "unknown" if no substring pattern matches.
 *
 * Substring matching is order-sensitive — most-specific first.
 * "mainnet" is a substring of "mainnet-beta", which both
 * `api.mainnet-beta.solana.com` and `mainnet.helius-rpc.com` carry,
 * so localnet/devnet checks come first.
 *
 * Triton, QuickNode, custom proxies — we cannot tell cluster from
 * URL alone. Default to UNKNOWN; the alerting downstream is the
 * defense ("can't classify → user must verify before signing").
 */
export function classifyEndpoint(url: string): Cluster {
  if (url.includes("127.0.0.1") || url.includes("localhost")) return "localnet";
  if (url.includes("devnet")) return "devnet";
  if (url.includes("mainnet")) return "mainnet";
  return "unknown";
}
