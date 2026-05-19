// SEV-045 — `NetworkId` extracted from `network.tsx` so non-React
// modules (`rpcAllowlist.ts`, `walletAllowlist.ts`) AND Mocha tests at
// the workspace root can import the type without pulling in JSX
// compilation. The top-level `tsconfig.json` doesn't have JSX enabled
// (it scopes to tests + scripts), so any import path that transitively
// resolves to a `.tsx` file fails with TS6142 "'--jsx' is not set."
//
// `network.tsx` (the React context) now re-exports this type for
// back-compat with existing call-sites that import via `@/lib/network`.

export type NetworkId = "localnet" | "devnet" | "mainnet-beta";
