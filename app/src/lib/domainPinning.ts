// Domain pinning — phishing-resistance check for issue #249 workstream 3.
//
// Addresses T1 from `docs/security/frontend-security-checklist.md §1`:
//   T1 — Phishing site spoofs roundfi.app
//   Vector: typo-squat domain serves identical-looking UI, asks user
//   to sign `contribute` to attacker-controlled vault.
//
// Implementation: at app startup, compare `window.location.hostname`
// against a curated allowlist of canonical domains. If the user is on
// an unknown domain (and not localhost-for-dev), render a persistent
// warning banner advising them to navigate to the canonical URL.
//
// Mainnet-strict mode: when network = mainnet-beta (future), the
// warning becomes a HARD BLOCK that prevents any signed-tx flow until
// the user navigates to a canonical domain. Today (devnet) it's a
// soft warning banner.

/**
 * Canonical production domains for RoundFi. Update this list when
 * deploying to a new domain (e.g., adding `roundfi.com` alongside the
 * Vercel preview URL). Subdomains of these are NOT auto-allowed —
 * an explicit entry must be added per-subdomain.
 */
export const CANONICAL_DOMAINS: ReadonlySet<string> = new Set([
  // Production
  "roundfinancial.vercel.app",
  // Localhost flavors (dev mode)
  "localhost",
  "127.0.0.1",
]);

/**
 * Vercel preview deployments use a predictable pattern:
 * `roundfinancial-git-<branch>-alrimarleskovars-projects.vercel.app`.
 * Allowed in non-mainnet contexts so the team can verify PRs against
 * preview URLs without the warning firing.
 */
const VERCEL_PREVIEW_PATTERN = /^roundfinancial-[a-z0-9-]+\.vercel\.app$/i;

export type DomainStatus =
  | { kind: "canonical" }
  | { kind: "preview"; hostname: string }
  | { kind: "unknown"; hostname: string };

/**
 * Classify the current hostname against the canonical-domains list.
 * Safe to call from SSR (returns `canonical` when `window` is undefined,
 * matching the SSR-renders-as-server-knows behavior; the banner only
 * appears post-hydration).
 */
export function classifyHostname(hostname?: string): DomainStatus {
  // SSR / Node — pretend canonical so hydration doesn't mismatch.
  if (typeof window === "undefined" && hostname === undefined) {
    return { kind: "canonical" };
  }
  const host = (hostname ?? window.location.hostname).toLowerCase();

  if (CANONICAL_DOMAINS.has(host)) {
    return { kind: "canonical" };
  }
  if (VERCEL_PREVIEW_PATTERN.test(host)) {
    return { kind: "preview", hostname: host };
  }
  return { kind: "unknown", hostname: host };
}

/**
 * Convenience boolean for "should we render the warning banner?"
 *
 * - canonical: no banner
 * - preview: optionally a soft "preview deployment" hint (not phishing-warning)
 * - unknown: warning banner — possible phishing
 */
export function shouldShowPhishingWarning(hostname?: string): boolean {
  return classifyHostname(hostname).kind === "unknown";
}
