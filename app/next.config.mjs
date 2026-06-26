// Security headers (frontend-security checklist §2.3).
//
// HSTS, framing, MIME-sniffing, referrer + permissions are ENFORCED —
// they can't break app functionality. The Content-Security-Policy ships
// in **Report-Only** first: a wallet dApp's `connect-src` surface (public
// RPCs, keyed Helius/Triton, the explorer, the indexer, wallet bridges,
// price feeds) is wide and partly env-driven, so a wrong *enforced* CSP
// would silently brick a fund-movement path on mainnet. Report-Only
// collects violation reports from real traffic; the flip to enforced CSP
// is a deliberate follow-up once the report stream is clean.
//
// connect-src mirrors rpcAllowlist.ts (api.{devnet,mainnet-beta}.solana.com
// + *.helius-rpc.com + *.rpcpool.com) plus the Solana explorer + ws.
const RPC_CONNECT_SRC = [
  "https://api.devnet.solana.com",
  "https://api.mainnet-beta.solana.com",
  "https://*.helius-rpc.com",
  "https://*.rpcpool.com",
  "https://explorer.solana.com",
  "wss://api.devnet.solana.com",
  "wss://api.mainnet-beta.solana.com",
  // web3.js opens a subscription WebSocket whose URL it DERIVES from the
  // active RPC by swapping the scheme (https->wss, http->ws, port +1) —
  // confirmTransaction() uses it on every fund-movement path. CSP source
  // expressions are scheme-specific, so the keyed RPCs and localnet need
  // their wss/ws forms listed too; otherwise these legitimate sockets are
  // flagged in the Report-Only stream (and would be blocked on enforce).
  "wss://*.helius-rpc.com",
  "wss://*.rpcpool.com",
  "http://127.0.0.1:8899",
  "ws://127.0.0.1:8900",
];

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; some Solana/wallet libs use
  // wasm/eval. 'unsafe-inline'/'unsafe-eval' are the pragmatic floor for a
  // dApp — tightening to nonces is tracked with the enforce flip.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${RPC_CONNECT_SRC.join(" ")}`,
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Apply the security headers to every route (pages + API + assets).
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // @roundfi/sdk, @roundfi/orchestrator, and @roundfi/indexer ship as
  // TypeScript source (workspace linked), so Next.js needs to transpile
  // them. The admin console imports @roundfi/indexer/{db,admin} (ADR 0009).
  transpilePackages: ["@roundfi/sdk", "@roundfi/orchestrator", "@roundfi/indexer"],
  // Prisma's client loads a native query engine that webpack must not
  // bundle — keep it external on the server (admin route handlers).
  serverExternalPackages: ["@prisma/client", "@prisma/engines", "prisma"],
  // NOTE: Next 16 defaults to Turbopack, but Turbopack does not yet support
  // `.js -> .ts/.tsx` extension aliasing (vercel/next.js#82945), which the
  // workspace packages' NodeNext-style `from "./foo.js"` imports require.
  // We therefore stay on the webpack builder (`next build/dev --webpack`,
  // see package.json scripts) until that gap is closed.
  webpack: (config, { isServer }) => {
    // The @roundfi/sdk and @roundfi/orchestrator packages ship as raw TS
    // with NodeNext-style imports (`from "./foo.js"`). Webpack needs this
    // alias so it resolves those specifiers to the actual .ts sources.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    // Stub node-only modules that Solana toolchain deps optionally require
    // but never actually hit in the browser runtime.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
        "pino-pretty": false,
        encoding: false,
      };
    }
    return config;
  },
};

export default nextConfig;
