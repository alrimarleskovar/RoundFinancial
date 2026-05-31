# @roundfi/mobile

Fase 0 scaffold of the RoundFi mobile app — Expo SDK 56 + React Native 0.85 +
React 19. Lives inside the pnpm monorepo and consumes `@roundfi/sdk`
through a workspace dependency, so a single `pnpm install` at the repo
root wires everything up.

## What's here (Fase 0)

A single screen that derives the canonical `ProtocolConfig` PDA on
devnet via `@roundfi/sdk` and renders the base58 — enough to prove
that:

1. The workspace dep + Metro `watchFolders` glue resolves correctly.
2. The Solana polyfills loaded in `index.ts` are in place before
   `@solana/web3.js` runs (no `Buffer is undefined` / no missing
   `crypto.getRandomValues`).
3. The web app's `theme` tokens land on RN unchanged — the palette
   toggle proves the `ThemeProvider` Context wiring.

## What's NOT here (deferred)

- **Phantom mobile / Seed Vault Wallet** → Fase 2.
- **EAS Build / native builds** → Fase 3 (once an MWA wallet adapter
  test passes against emulator).
- **`glassSurfaceStyle` blur** → Fase 1, when the first card surface
  is built. The web helper uses `backdropFilter` (CSS-only); the RN
  equivalent is `expo-blur`'s `<BlurView>`.
- **Theme persistence** → Fase 1, candidate is `expo-secure-store`.

## Run it locally

```bash
# From the repo root (only once after pull):
pnpm install

# Start Metro + open in Expo Go on a phone or simulator:
pnpm --filter @roundfi/mobile start

# Or directly to a target:
pnpm --filter @roundfi/mobile android   # needs Android Studio emulator
pnpm --filter @roundfi/mobile ios       # needs Xcode (macOS only)
pnpm --filter @roundfi/mobile web       # browser preview (no native APIs)
```

Expected first render: a centered card with the base58 of
`8LV…QQjw`-derived ProtocolConfig PDA + bump, on the cream `soft`
palette. Tap "palette: soft" to flip to `neon`.

## Versions pinned by the template

- Expo SDK 56 (see `package.json`)
- React 19.2.3
- React Native 0.85.3
- TypeScript 6.0
- Node 22 (CI lane in `.github/workflows/mobile.yml`)

**⚠️ Expo HAS CHANGED** — see `AGENTS.md`. Check the versioned docs at
<https://docs.expo.dev/versions/v56.0.0/> before adding any Expo /
React Native package that wasn't already in the template.

## CI

`.github/workflows/mobile.yml` runs `typecheck` + `lint` + `test` only
when files inside `mobile/` (or its inputs: `sdk/`,
`pnpm-workspace.yaml`, `pnpm-lock.yaml`) change. The lane is currently
**advisory** (`continue-on-error: true`) — flip to required once Fase 1
ships a real component layer that exercises the surface.
