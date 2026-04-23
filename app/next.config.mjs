/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @roundfi/sdk and @roundfi/orchestrator ship as TypeScript source
  // (workspace linked), so Next.js needs to transpile them.
  transpilePackages: ["@roundfi/sdk", "@roundfi/orchestrator"],
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
