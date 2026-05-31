// ─── Solana / web3.js polyfills (MUST come first) ──────────────────────
// React Native lacks `crypto.getRandomValues` (Keypair / nonce gen) and a
// `Buffer` global (web3.js account encoders + PDA seeds). Loading these
// before `registerRootComponent` guarantees the polyfills are installed
// before any module that imports `@solana/web3.js` or `@roundfi/sdk` runs.
// Pattern documented by Solana Mobile Stack:
//   https://docs.solanamobile.com/react-native/setup
//
// Note on tsconfig: `types: ["node"]` is enabled in `tsconfig.json` so
// the @roundfi/sdk Buffer signatures resolve at typecheck time. That
// pulls in `global.Buffer`'s Node typing — the runtime instance below
// is the RN polyfill, not Node's real Buffer.
import "react-native-get-random-values";
import { Buffer } from "@craftzdog/react-native-buffer";
if (typeof global.Buffer === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).Buffer = Buffer;
}

import { registerRootComponent } from "expo";

import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately.
registerRootComponent(App);
