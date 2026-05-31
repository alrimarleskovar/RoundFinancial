# @roundfi/mobile

Fase 0 scaffold of the RoundFi mobile app — Expo SDK 56 + React Native 0.85 +
React 19. Lives inside the pnpm monorepo and consumes `@roundfi/sdk`
through a workspace dependency, so a single `pnpm install` at the repo
root wires everything up.

## What's here (Fase 0 + Fase 1)

**Fase 0** (`d6c6151`) — base scaffold + 1 screen deriving the canonical
`ProtocolConfig` PDA via `@roundfi/sdk` and rendering its base58. Proves:

1. Workspace dep + Metro `watchFolders` glue resolves.
2. Solana polyfills in `index.ts` land before `@solana/web3.js` runs.
3. Web `theme` tokens (`PALETTES`) land on RN unchanged via the
   `ThemeProvider` Context.

**Fase 1** — bottom-tabs navigation with 4 screens, palette-aware nav
chrome (React Navigation v7 + `react-native-safe-area-context`):

| Tab     | Source                          | Content                                                  |
| ------- | ------------------------------- | -------------------------------------------------------- |
| Home    | `src/screens/HomeScreen.tsx`    | PDA derivation (Fase 0 screen, now scoped to a tab)      |
| Pools   | `src/screens/PoolsScreen.tsx`   | placeholder — Fase 2 wires indexer reads                 |
| Wallet  | `src/screens/WalletScreen.tsx`  | placeholder — Fase 2 (Phantom) / pre-Canary (Seed Vault) |
| Profile | `src/screens/ProfileScreen.tsx` | placeholder — Fase 2 reads roundfi-reputation            |

The 3 placeholders use a shared `PlaceholderScreen` so each tab file
stays trivial (one component, one title, one blurb) — the visual
target is the navigation + theme wiring, not content.

`App.tsx` orchestrates: `ThemeProvider → SafeAreaProvider → RootNavigator`.
The status bar color follows the palette via `ThemedStatusBar`.

## What's NOT here (deferred)

- **Phantom mobile / Seed Vault Wallet** → Fase 2.
- **EAS Build / native builds** → Fase 3.
- **`glassSurfaceStyle` blur** → Fase 1.5/2 (needs `expo-blur`'s
  `<BlurView>` since web's `backdropFilter` is CSS-only).
- **Theme persistence** → Fase 1.5 (candidate: `expo-secure-store`).
- **jest-expo + tests** → Fase 1.5 (deferred because the Expo 56 +
  RN 0.85 + jest-expo version matrix is fluid; risk a CI break for
  no real signal until a component layer worth testing exists).
- **Stack-inside-tab** (Pool detail / Member detail) → Fase 2 when
  detail screens land.

## Run it locally

> **mobile/ is a standalone project — uses `npm`, NOT pnpm, and is NOT a
> workspace member.** React Native / Metro require a truly flat
> `node_modules`. pnpm — even with `node-linker=hoisted` — keeps its
> `.pnpm/` store + partial symlinks, so a package's sibling deps (e.g.
> `react-native-get-random-values` → `fast-base64-decode`) go
> unresolved at bundle time. `npm` produces real flat resolution.
> mobile consumes the SDK via `@roundfi/sdk: file:../sdk`. The main
> monorepo stays on pnpm and is untouched.

```bash
cd mobile
npm install             # flat node_modules — do NOT use pnpm here

# Expo Go: scan the QR (phone on same Wi-Fi). On WSL, use --tunnel:
npx expo start --tunnel
#   then 'a' (Android emulator) / 'i' (iOS sim) / scan QR in Expo Go
```

Targets **Expo SDK 54** — the version the public App Store / Play Store
Expo Go supports (May 2026). Do NOT bump to 55/56: stock Expo Go
refuses them ("project is incompatible with this version of Expo Go").
See `AGENTS.md`.

Expected first render: bottom-tab bar (Home / Pools / Wallet / Profile),
Home showing the base58 of the `8LV…QQjw`-derived ProtocolConfig PDA +
bump on the cream `soft` palette. Tap "palette: soft" → flips to neon
(tab bar + header included).

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
