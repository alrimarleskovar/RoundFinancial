// Polyfills MUST be the very first import — it installs Buffer +
// crypto.getRandomValues on the global before any module that imports
// @solana/web3.js / @roundfi/sdk is evaluated. Keeping it in its own
// module (rather than inline here) is what guarantees the ordering:
// ES import hoisting would otherwise run App's import chain before an
// inline `global.Buffer = …` statement. See src/polyfills.ts.
import "./src/polyfills";

import { registerRootComponent } from "expo";

import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately.
registerRootComponent(App);
