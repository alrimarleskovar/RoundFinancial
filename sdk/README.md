# `@roundfi/sdk`

> ## ⚠️ PRE-MAINNET ALPHA — DEVNET ONLY
>
> - **Version:** `0.1.0-alpha.0` (npm `@alpha` tag)
> - **Cluster:** **Solana Devnet only.** No mainnet program IDs ship until 1.0.
> - **Audit:** External third-party audit is **pending** (tracked under [`MAINNET_READINESS.md`](https://github.com/alrimarleskovar/RoundFinancial/blob/main/MAINNET_READINESS.md) §1.6/§1.7). **Do not move real value through this SDK.**
> - **Stability:** Breaking changes allowed in any minor (`0.x.y`) release. Pin exact versions if you depend on the surface.
> - **Production use:** **Not supported.** This SDK targets the RoundFi devnet deployment for developer integration testing only.
>
> The 1.0 release is gated on: external audit clear + treasury multi-sig migration + Agave 2.x toolchain + legal counsel sign-off. Track [`MAINNET_READINESS.md`](https://github.com/alrimarleskovar/RoundFinancial/blob/main/MAINNET_READINESS.md) for live status.

TypeScript SDK for [RoundFi](https://github.com/alrimarleskovar/RoundFinancial) — behavioral-credit infrastructure on Solana.

Provides PDA derivation, IDL-free transaction encoders, on-chain account decoders, and the stress-lab actuarial simulator.

## Install

```bash
npm install @roundfi/sdk@alpha
# or
pnpm add @roundfi/sdk@alpha
# or
yarn add @roundfi/sdk@alpha
```

⚠️ **Pre-mainnet alpha.** Breaking changes allowed in minor versions until 1.0 (mainnet GA).

## Quick start

```typescript
import { PublicKey } from "@solana/web3.js";
import { poolPda, memberPda, decodePoolRaw } from "@roundfi/sdk";

const coreProgram = new PublicKey("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw");
const authority = new PublicKey("...");
const seedId = 1n; // u64

// Derive the Pool PDA
const [pool] = poolPda(coreProgram, authority, seedId);

// Read + decode a Pool account (IDL-free raw layout)
const account = await connection.getAccountInfo(pool);
const poolView = decodePoolRaw(pool, account.data as Buffer);
console.log(poolView.currentCycle, poolView.totalContributed);
```

## Exports

| Subpath                    | What                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `@roundfi/sdk`             | Barrel — everything below                                                                                                            |
| `@roundfi/sdk/constants`   | `MAX_BPS`, fee schedule, SAS schema IDs                                                                                              |
| `@roundfi/sdk/pda`         | 18 PDA derivation functions (incl. `drawResultPda`, `bidPda`)                                                                        |
| `@roundfi/sdk/client`      | High-level TypeScript client                                                                                                         |
| `@roundfi/sdk/actions`     | Typed instruction builders                                                                                                           |
| `@roundfi/sdk/reads`       | Account fetch + decode helpers                                                                                                       |
| `@roundfi/sdk/onchain-raw` | 8 IDL-free account decoders — `Pool`, `Member`, `Listing`, `DrawResult`, `Bid`, `ReputationProfile`, `IdentityRecord`, `Attestation` |
| `@roundfi/sdk/stressLab`   | Pure-TS actuarial simulator                                                                                                          |
| `@roundfi/sdk/events`      | `LifecycleEvent` discriminated union                                                                                                 |
| `@roundfi/sdk/lance`       | Sealed free-bid envelope — `freeBidCommitHash`, `bidEnvelopeMessage`, `saltFromSignature`, `recoverBidParcels`                       |

### `@roundfi/sdk/lance` — the sealed bid envelope

Helpers for the ADR 0012 Fase 3 free bid. Browser-safe by construction: hashing goes
through `@noble/hashes`, never `node:crypto`, so the module can sit in the barrel
without breaking a bundler.

```ts
import {
  freeBidCommitHash,
  bidEnvelopeMessage,
  saltFromSignature,
  recoverBidParcels,
} from "@roundfi/sdk/lance";

// The salt is derived from a wallet signature over a canonical per-(pool, cycle)
// message. ed25519 signing is deterministic (RFC 8032), so the same wallet always
// recovers the same salt — losing localStorage cannot strand a sealed bid.
const salt = saltFromSignature(await wallet.signMessage(bidEnvelopeMessage(pool, cycle)));
const commitHash = freeBidCommitHash(amount, salt, bidder);

// ...and the amount is recovered by scanning K against the on-chain commit hash.
const parcels = recoverBidParcels(onChainCommitHash, salt, bidder, installmentAmount, maxParcels);
```

The commit hash is `sha256` over a **48-byte** preimage — `amount_le ‖ salt_le ‖ bidder`
— and is pinned byte-for-byte against the Rust implementation by
`tests/lance_livre_hash.spec.ts`.

## Programs

The SDK targets these on-chain programs (devnet):

| Program                | Program ID                                     |
| ---------------------- | ---------------------------------------------- |
| `roundfi-core`         | `8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw` |
| `roundfi-reputation`   | `Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2` |
| `roundfi-yield-kamino` | `74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb` |
| `roundfi-yield-mock`   | `GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ` |

Mainnet program IDs land at 1.0 (mainnet GA).

## Verified-build attestation

Each deployed program carries an on-chain [`OtterSec verify-build`](https://github.com/otter-sec/solana-verify) PDA binding bytecode hash → GitHub commit. 30-second CLI verification:

```bash
solana-verify -u devnet get-program-pda \
  --program-id 8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw \
  --signer 64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm
```

Full attestation details: [`docs/verified-build.md`](https://github.com/alrimarleskovar/RoundFinancial/blob/main/docs/verified-build.md).

## Stress lab

The SDK includes a pure-TypeScript actuarial simulator (`stressLab`) that's also the **reference implementation** for the Rust on-chain program. 16 named scenario presets cover pool-size × tier × default-position × yield-extreme dimensions:

```typescript
import { runSimulation, PRESETS } from "@roundfi/sdk/stressLab";

const preset = PRESETS.tripleVeteranDefault;
const frames = runSimulation(preset.config, preset.matrix);
console.log(frames[frames.length - 1].metrics.poolBalance);
```

57 economic-parity tests run against these presets — see [`docs/stress-lab.md`](https://github.com/alrimarleskovar/RoundFinancial/blob/main/docs/stress-lab.md).

## Security

This SDK is part of the RoundFi audit perimeter. Disclosure: see [`SECURITY.md`](https://github.com/alrimarleskovar/RoundFinancial/blob/main/SECURITY.md).

For full security posture documentation: [`docs/security/README.md`](https://github.com/alrimarleskovar/RoundFinancial/blob/main/docs/security/README.md) (20 docs, ~2 hour first-pass).

## Versioning

| Version range   | Status                                                                       |
| --------------- | ---------------------------------------------------------------------------- |
| `0.x` (current) | Pre-mainnet alpha. Breaking changes allowed in minor releases. Tag: `@alpha` |
| `1.0+` (future) | Mainnet GA. Strict semver. Tag: `@latest`                                    |

## License

Apache 2.0 — see [`LICENSE`](https://github.com/alrimarleskovar/RoundFinancial/blob/main/LICENSE).

## Contributing

See [`CONTRIBUTING.md`](https://github.com/alrimarleskovar/RoundFinancial/blob/main/CONTRIBUTING.md) in the monorepo.

## Repository

Monorepo: https://github.com/alrimarleskovar/RoundFinancial

The SDK lives at `sdk/` and is published from there. Issues, PRs, and discussions go to the monorepo.

---

**Built for Solana.** Behavioral credit is the bait; on-chain reputation is the product.
