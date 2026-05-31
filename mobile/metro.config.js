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

module.exports = config;
