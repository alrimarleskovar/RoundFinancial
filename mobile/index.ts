// ─── RN entry point — ALL CommonJS require(), NO ES imports ────────────
// Every `import` in a module is hoisted above all top-level statements,
// so we cannot mix `import App` with a runtime Buffer assignment and
// expect the assignment to run first. Using require() throughout keeps
// strict source order: the Buffer + crypto polyfills are installed on
// globalThis BEFORE App's import chain (→ @roundfi/sdk → @solana/web3.js)
// is evaluated. web3.js reads globalThis.Buffer at module-eval time, so
// this ordering is what prevents "Property 'Buffer' doesn't exist".
//
// (This file is the one place in the app where we deliberately avoid ES
// imports — everything else uses normal `import`.)
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
require("react-native-get-random-values");
const { Buffer } = require("buffer");
if (typeof (globalThis as any).Buffer === "undefined") {
  (globalThis as any).Buffer = Buffer;
}

const { registerRootComponent } = require("expo");
const App = require("./App").default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

// registerRootComponent calls AppRegistry.registerComponent('main', () => App).
registerRootComponent(App);
