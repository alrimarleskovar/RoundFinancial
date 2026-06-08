// Metro bundler config for the pnpm monorepo.
//
// Default Metro only watches files inside its project root, so without
// `watchFolders` it won't see edits in `../sdk` (the @roundfi/sdk
// workspace dep). And without `nodeModulesPaths` the resolver fails to
// find pnpm-hoisted modules that live in the workspace root
// `node_modules/.pnpm/`.
//
// Reference: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// 1. Watch the workspace root so edits in ../sdk trigger HMR.
config.watchFolders = [workspaceRoot];

// 2. Let the resolver look up node_modules from both this package and
//    the workspace root (pnpm hoists most deps there).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// 3. Disable hierarchical lookups outside the workspace — keeps the
//    bundler from accidentally walking past `workspaceRoot`.
config.resolver.disableHierarchicalLookup = true;

// 4. NodeNext-style `.js` imports → TypeScript sources. The SDK is
//    written with `import "./pda.js"` even though the file is
//    `./pda.ts` (TypeScript ESM convention: emit-target extension in
//    source so the compiled .js Just Works). Web bundlers and tsc
//    both resolve this. Metro doesn't, by default — it takes the
//    literal `.js` and fails. We intercept those requests and retry
//    against the .ts/.tsx counterpart before falling back.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith(".js") && (moduleName.startsWith(".") || moduleName.startsWith("/"))) {
    const stripped = moduleName.slice(0, -3);
    try {
      return context.resolveRequest(context, stripped, platform);
    } catch {
      // Fall through to the original behavior; some `.js` imports are
      // genuine .js files (e.g. polyfills).
    }
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
