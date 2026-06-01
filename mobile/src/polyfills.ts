// Solana / web3.js polyfills for React Native. Imported FIRST from
// index.ts (before any module that pulls @solana/web3.js).
//
// Why a separate file: ES module imports are hoisted — they all run
// before any top-level statement in the importing module. If the
// `global.Buffer = …` assignment lived in index.ts alongside
// `import App from "./App"`, App's import chain (→ @roundfi/sdk →
// @solana/web3.js) would evaluate BEFORE the assignment ran, and
// web3.js would capture an undefined Buffer ("Property 'Buffer'
// doesn't exist" at runtime). Isolating the side-effecting polyfills
// in their own module guarantees they execute before App is imported,
// because index.ts imports this file on the line above App.
//
// - react-native-get-random-values: installs crypto.getRandomValues
//   (Keypair / nonce gen).
// - buffer: the pure-JS Buffer polyfill (web3.js encoders + PDA seeds).
//   Canonical Solana Mobile choice; no native peer deps.
import "react-native-get-random-values";
import { Buffer } from "buffer";

// Hermes has no Buffer global. Assign unconditionally — RN's global is
// the right object here (verified: web3.js reads globalThis.Buffer).
if (typeof globalThis.Buffer === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Buffer = Buffer;
}
