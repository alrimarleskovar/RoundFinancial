/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
