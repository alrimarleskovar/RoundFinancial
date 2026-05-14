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

| Subpath                  | What                                    |
| ------------------------ | --------------------------------------- |
| `@roundfi/sdk`           | Barrel — everything below               |
| `@roundfi/sdk/constants` | `MAX_BPS`, fee schedule, SAS schema IDs |
| `@roundfi/sdk/pda`       | 12 PDA derivation functions             |
| `@roundfi/sdk/client`    | High-level TypeScript client            |
| `@roundfi/sdk/actions`   | Typed instruction builders              |
| `@roundfi/sdk/reads`     | Account fetch + decode helpers          |
| `@roundfi/sdk/stressLab` | Pure-TS actuarial simulator             |
| `@roundfi/sdk/events`    | `LifecycleEvent` discriminated union    |

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

45 economic-parity tests run against these presets — see [`docs/stress-lab.md`](https://github.com/alrimarleskovar/RoundFinancial/blob/main/docs/stress-lab.md).

## Security

This SDK is part of the RoundFi audit perimeter. Disclosure: see [`SECURITY.md`](https://github.com/alrimarleskovar/RoundFinancial/blob/main/SECURITY.md).

For full security posture documentation: [`docs/security/README.md`](https://github.com/alrimarleskovar/RoundFinancial/blob/main/docs/security/README.md) (8 docs, ~2 hour first-pass).

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
