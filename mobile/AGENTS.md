# Expo SDK 54 (App Store / Play Store Expo Go compatible)

This project targets **Expo SDK 54** — the version the public App Store /
Play Store build of Expo Go supports (as of May 2026, Expo Go is pinned
to SDK 54; SDK 55 is in Apple review and SDK 56 is TestFlight-only).

The `create-expo-app` default gave us SDK 56, which the public Expo Go
**refuses** ("project is incompatible with this version of Expo Go").
We downgraded to 54 so the app runs on a stock Expo Go install — no
TestFlight, no `eas go`, no Apple Developer Program needed.

Before adding any Expo / React Native package, pin it to the SDK 54
version: run `npx expo install <pkg>` (NOT `pnpm add`) so Expo resolves
the SDK-54-correct version. Read the versioned docs at
https://docs.expo.dev/versions/v54.0.0/ when in doubt.

If you ever bump the SDK, re-check what the public Expo Go supports
first — moving ahead of it breaks the scan-the-QR workflow.
