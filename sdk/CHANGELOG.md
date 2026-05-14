# `@roundfi/sdk` Changelog

All notable changes to the RoundFi SDK will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Semver: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0 policy:** breaking changes allowed in minor versions. The 1.0 release will be cut at mainnet GA.

---

## [Unreleased]

### Added

- (None yet.)

---

## [0.1.0-alpha.0] — 2026-05-14

**First alpha release** — published to npm under `@roundfi/sdk@alpha` to signal pre-mainnet status. Consumers should NOT use this in production; the SDK API surface is still settling.

### Added

- **PDA derivation helpers** — `protocolConfigPda`, `poolPda`, `memberPda`, `escrowVaultAuthorityPda`, `solidarityVaultAuthorityPda`, `yieldVaultAuthorityPda`, `positionAuthorityPda`, `listingPda`, `reputationProfilePda`, `reputationConfigPda`, `attestationPda`, `yieldVaultStatePda` (`src/pda.ts`).
- **Account decoders** (IDL-free, raw byte layout) — `decodePoolRaw`, `decodeMemberRaw` (`src/onchain-raw.ts`).
- **Stress-lab actuarial simulator** — `runSimulation()`, 16 named presets covering pool-size / tier-mix / default-position / yield-extreme dimensions (`src/stressLab.ts`).
- **Constants** — `MAX_BPS`, fee schedule, SAS schema IDs, etc. (`src/constants.ts`).
- **Type-safe action helpers** — high-level instruction builders (`src/actions.ts`).
- **Read helpers** — fetch + decode patterns for Pool / Member / Attestation accounts (`src/reads.ts`).
- **Lifecycle event types** — `LifecycleEvent` discriminated union for pool/member/attestation events (`src/events.ts`).
- **TypeScript client** — high-level interface bundling the above (`src/client.ts`).

### Verification

- 162 tests in the monorepo `tests/` use this SDK (parity, security, edge-case, economic-parity-L1 suites)
- 7 Rust ↔ TS constants/seeds parity tests pin the SDK to the on-chain layout

### Known limitations

- **No mainnet support yet** — the `app/src/lib/devnet.ts` constants are devnet-only; mainnet program IDs unset
- **API surface unstable** — additions + breaking changes expected in 0.x minor releases
- **No generated IDL client** — pending Anchor 0.31+ via the Agave 2.x migration ([roundfinancial#230](https://github.com/alrimarleskovar/RoundFinancial/issues/230))

### Cross-refs

- [roundfinancial#273](https://github.com/alrimarleskovar/RoundFinancial/issues/273) — release flow setup tracking
- Repository: https://github.com/alrimarleskovar/RoundFinancial
- Monorepo CHANGELOG: [`../../CHANGELOG.md`](../../CHANGELOG.md)

---

_Pre-1.0 versions are alpha-tagged on npm (`npm install @roundfi/sdk@alpha`). The default `latest` tag waits for 1.0 (mainnet GA)._
