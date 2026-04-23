/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @roundfi/sdk and @roundfi/orchestrator ship as TypeScript source
  // (workspace linked), so Next.js needs to transpile them.
  transpilePackages: ["@roundfi/sdk", "@roundfi/orchestrator"],
};

export default nextConfig;
