# RoundFi — Architecture Specification

**Version:** 0.2 (2026-04-22 — adds §4.4 Identity Layer; non-breaking to v0.1)
**Status:** Implementation in progress — Step 4b

This document is the single source of truth for RoundFi's on-chain and off-chain architecture. Every subsequent implementation step must conform to what is written here, or amend this document first.

---

## 1. Design Goals & Non-Goals

**Goals**
- Production-ready, hackathon-grade protocol on **Solana Devnet** with a clean **Mainnet migration path**.
- Enforce all product invariants (Triple Shield, 50-30-10 ladder, seed draw 91.6%, 1% solidarity, yield waterfall) directly on-chain — off-chain services may read/present, never gate.
- Abstract volatile dependencies (**SAS**, **Kamino**) behind stable program interfaces so they can be swapped without changing the core contract.
- Every account address is a deterministic PDA → SDK and indexer work without on-chain account discovery heuristics.

**Non-goals (this phase)**
- KYC / Proof-of-Personhood (Civic, Fractal) — skipped, wallet-only identity.
- Governance / token. No `$RFI` token this phase; revenue accrues to `treasury` account.
- L2 / cross-chain bridging.
- Fiat on-ramp — assume user already holds USDC.

---

## 2. Program Topology

The protocol consists of **3 programs + Metaplex Core CPI**:

```
                ┌────────────────────────────────────────┐
                │         roundfi-core (Anchor)          │
                │  pools · members · escrow · solidarity │
                │  seed draw · yield routing · payouts   │
                └──────┬───────────────┬──────────┬──────┘
                       │ CPI           │ CPI      │ CPI
                       ▼               ▼          ▼
         ┌──────────────────┐  ┌──────────────┐  ┌─────────────────┐
         │ roundfi-         │  │ Metaplex     │  │ yield-adapter   │
         │ reputation       │  │ Core         │  │ (interface)     │
         │ (SAS-compatible) │  │ (NFT assets) │  │                 │
         └──────────────────┘  └──────────────┘  └────────┬────────┘
                                                          │ impl
                                                ┌─────────┴──────────┐
                                                │                    │
                                         roundfi-yield-mock   roundfi-yield-kamino
                                         (Devnet default)     (Mainnet default)
```

**Rationale for this split:**
- `roundfi-core` contains the *pool state machine*; keeping escrow + solidarity vault inside core avoids brittle 3-way CPIs on hot paths (`contribute`, `claim_payout`).
- `roundfi-reputation` is separate because (a) it exposes a SAS-compatible read surface to 3rd parties (B2B score API), (b) it will be re-implemented to CPI into the official Solana Attestation Service on Mainnet — isolating this keeps that migration surgical.
- `yield-adapter` is a **program-level trait**: two distinct programs (`yield-mock`, `yield-kamino`) that share the exact same instruction discriminators and account layouts. `PoolConfig.yield_adapter: Pubkey` dictates which one core CPIs into. No compile-time coupling.
- Metaplex Core is used directly via CPI for the position NFT — no custom NFT program needed.

---

## 3. Account Model

All accounts are PDAs derived from the seeds below. Numeric amounts are `u64` in **base units of USDC** (6 decimals) unless noted.

### 3.1 `ProtocolConfig` (singleton)
Seeds: `[b"config"]`

```rust
pub struct ProtocolConfig {
    pub authority:           Pubkey,    // multisig recommended on mainnet
    pub treasury:            Pubkey,    // USDC ATA receiving protocol fee
    pub usdc_mint:           Pubkey,
    pub metaplex_core:       Pubkey,
    pub default_yield_adapter: Pubkey,  // mock (devnet) or kamino (mainnet)
    pub reputation_program:  Pubkey,
    pub fee_bps_yield:       u16,       // 2000 = 20%
    pub fee_bps_cycle_l1:    u16,       // 200 = 2%
    pub fee_bps_cycle_l2:    u16,       // 100 = 1%
    pub fee_bps_cycle_l3:    u16,       // 0   = 0% (Veteran exempt)
    pub guarantee_fund_bps:  u16,       // 15000 = 150% of protocol yield (waterfall)
    pub paused:              bool,
    pub bump:                u8,
}
```

### 3.2 `Pool`
Seeds: `[b"pool", authority, seed_id_le_bytes]`

```rust
pub struct Pool {
    pub authority:          Pubkey,   // pool creator (can be protocol admin)
    pub seed_id:            u64,      // unique per authority
    pub usdc_mint:          Pubkey,
    pub yield_adapter:      Pubkey,   // snapshot at creation

    // Product params (all immutable after creation)
    pub members_target:     u8,       // 24
    pub installment_amount: u64,      // 416_000_000 (416 USDC)
    pub credit_amount:      u64,      // 10_000_000_000 (10,000 USDC)
    pub cycles_total:       u8,       // 24
    pub cycle_duration:     i64,      // seconds (2_592_000 = 30 days)
    pub seed_draw_bps:      u16,      // 9160 = 91.6%
    pub solidarity_bps:     u16,      // 100 = 1%
    pub escrow_release_bps: u16,      // e.g. 2500 = 25% per cycle milestone

    // Runtime state
    pub members_joined:     u8,
    pub status:             PoolStatus,  // Forming | Active | Completed | Liquidated
    pub started_at:         i64,
    pub current_cycle:      u8,
    pub next_cycle_at:      i64,
    pub total_contributed:  u64,
    pub total_paid_out:     u64,
    pub solidarity_balance: u64,
    pub escrow_balance:     u64,
    pub yield_accrued:      u64,

    pub bump:               u8,
}
```

**Associated token accounts** (all are ATAs of the `Pool` PDA authority):
- `pool_usdc_vault`    — holds live contribution float
- `escrow_vault`       — holds locked rewards (PDA seeds `[b"escrow", pool]`)
- `solidarity_vault`   — holds 1% collections (PDA seeds `[b"solidarity", pool]`)
- `yield_vault`        — holds in-flight funds deposited to yield adapter (PDA seeds `[b"yield", pool]`)

### 3.3 `Member`
Seeds: `[b"member", pool, wallet]`

```rust
pub struct Member {
    pub pool:                Pubkey,
    pub wallet:              Pubkey,
    pub nft_asset:           Pubkey,   // Metaplex Core asset
    pub slot_index:          u8,       // 0..members_target-1 → determines payout cycle
    pub reputation_level:    u8,       // 1 | 2 | 3 (snapshot at join)
    pub stake_bps:           u16,      // 5000 | 3000 | 1000
    pub stake_deposited:     u64,
    pub contributions_paid:  u8,
    pub total_contributed:   u64,
    pub total_received:      u64,
    pub escrow_balance:      u64,
    pub on_time_count:       u16,
    pub late_count:          u16,
    pub defaulted:           bool,
    pub joined_at:           i64,
    pub bump:                u8,
}
```

### 3.4 `ReputationProfile` (program: `roundfi-reputation`)
Seeds: `[b"reputation", wallet]`

```rust
pub struct ReputationProfile {
    pub wallet:            Pubkey,
    pub level:             u8,
    pub cycles_completed:  u32,
    pub on_time_payments:  u32,
    pub late_payments:     u32,
    pub defaults:          u32,
    pub score:             u64,   // derived; updated via attestations
    pub first_seen_at:     i64,
    pub last_updated_at:   i64,
    pub bump:              u8,
}
```

### 3.5 `Attestation` (program: `roundfi-reputation`)
Seeds: `[b"attestation", issuer, subject, schema_id_le, nonce_le]`

```rust
pub struct Attestation {
    pub issuer:      Pubkey,     // program or authority that issued
    pub subject:     Pubkey,     // wallet being attested about
    pub schema_id:   u16,        // 1=Payment 2=Late 3=Default 4=CycleComplete 5=LevelUp
    pub nonce:       u64,
    pub payload:     [u8; 96],   // schema-specific; fixed size for account rent predictability
    pub issued_at:   i64,
    pub revoked:     bool,
    pub bump:        u8,
}
```
*Mainnet migration:* this same struct maps 1-to-1 onto the official SAS schema shape — the program ID changes, layout does not.

### 3.6 Yield adapter accounts
Both `yield-mock` and `yield-kamino` expose an identical `YieldVaultState`:

```rust
pub struct YieldVaultState {
    pub owner:          Pubkey,   // the pool PDA
    pub principal:      u64,
    pub last_harvest_at: i64,
    pub accrued_yield:  u64,
    pub bump:           u8,
}
```

---

## 4. Instruction Surface

### 4.1 `roundfi-core`

| Instruction | Caller | Key accounts (signer = S, mut = M) | Effect |
|---|---|---|---|
| `initialize_protocol(cfg)` | authority (S) | ProtocolConfig (M), treasury, usdc_mint | One-time singleton init |
| `update_protocol_config(patch)` | authority (S) | ProtocolConfig (M) | Admin knobs (fees, pause) |
| `create_pool(seed_id, params)` | authority (S) | Pool (M), vaults (M), yield_adapter | Opens a Forming pool |
| `join_pool(slot_hint?)` | user (S) | Pool (M), Member (M), NFT asset (M), stake_src (M), reputation_profile | Deposits stake, mints position NFT, assigns slot; transitions to Active when `members_joined == members_target` |
| `contribute(cycle)` | user (S) | Pool (M), Member (M), member_src (M), pool_usdc_vault (M), solidarity_vault (M), escrow_vault (M) | Collects `installment_amount`, routes 1% to solidarity, escrow_release_bps to escrow, remainder to pool_usdc_vault; emits Payment attestation via CPI |
| `claim_payout(cycle)` | user (S) | Pool (M), Member (M), member_dst (M), pool_usdc_vault (M), yield_vault (M) | Releases `credit_amount` to member at slot_index == cycle; updates NFT metadata via Core CPI |
| `release_escrow(cycle_checkpoint)` | user (S) | Pool, Member (M), escrow_vault (M), member_dst (M) | Releases vested escrow portion if member is on-time through checkpoint |
| `distribute_good_faith_bonus(cycle)` | crank | Pool (M), solidarity_vault (M), members | Splits solidarity balance among on-time members of the cycle |
| `settle_default(member)` | crank | Pool (M), Member (M), vaults (M) | Executes stake seizure; emits Default attestation |
| `escape_valve_list(price)` | member (S) | Pool, Member (M), NFT asset (M) | Lists position for sale (on-chain bid book) |
| `escape_valve_buy(member)` | buyer (S) | Pool (M), Member (M old → new wallet), NFT asset (M), buyer_src (M), seller_dst (M) | Transfers NFT + Member PDA re-anchors to buyer; emits reputation transfer attestation |
| `deposit_idle_to_yield(amount)` | crank | Pool (M), pool_usdc_vault (M), yield_vault (M), yield_adapter CPI | Moves idle float into yield adapter |
| `harvest_yield()` | crank | Pool (M), yield adapter CPI, treasury ATA (M), pool_usdc_vault (M) | Pulls yield, splits per waterfall (Protocol 20% → Guarantee Fund 150% → LPs → Participants) |
| `close_pool()` | authority (S) | Pool (M), vaults (M) | After all cycles completed; sweeps residuals; emits CycleComplete attestations for all members |

### 4.2 `roundfi-reputation`

| Instruction | Caller | Effect |
|---|---|---|
| `init_profile(wallet)` | anyone (S) | Creates `ReputationProfile` for a wallet |
| `attest(schema_id, nonce, payload)` | authorized issuer (S) | Creates `Attestation`; updates `ReputationProfile.score` and `level` according to schema |
| `revoke(attestation)` | issuer (S) | Marks revoked; recomputes score |
| `promote_level(wallet)` | anyone (S) | Permissionless — verifies threshold met from on-chain score, advances `level` 1→2 or 2→3 |

**Authorized issuers** = whitelist stored in `ProtocolConfig`-like `ReputationConfig`, initialized with `roundfi-core` program's `Pool` PDA derivation authority. On Mainnet this whitelist is replaced by signed SAS issuance.

### 4.3 `yield-adapter` interface (shared by mock + kamino)

| Instruction | Caller | Effect |
|---|---|---|
| `init_vault(owner)` | core CPI | Opens `YieldVaultState` owned by pool |
| `deposit(amount)` | core CPI | Transfers USDC in; principal += amount |
| `withdraw(amount)` | core CPI | Transfers USDC out; principal -= amount |
| `harvest()` | core CPI, returns yield_amount | Realizes accrued yield and transfers it to `destination` ATA |

**Mock implementation:** accrual is `principal * mock_apy_bps * elapsed_secs / seconds_per_year / 10_000`, computed lazily at harvest time. `mock_apy_bps` is set to 650 (6.5%) by default, configurable per-vault for scenario testing.

**Kamino implementation:** thin wrapper that CPIs into Kamino Lend's `deposit_reserve_liquidity` / `redeem_reserve_collateral` / `refresh_reserve`. The wrapper normalizes cToken ↔ liquidity math back to USDC before returning, so the core program sees the same interface regardless of cluster.

### 4.4 Identity Layer (added v0.2 — 2026-04-22)

**Design principle: optional + modular.** Identity is never a gate for `join_pool`; it's an enrichment signal that the reputation program and the B2B score API can opt into. Providers are plugged in without program-upgrade:

```
                        ┌──────────────────────────────────────┐
                        │      roundfi-reputation (Anchor)     │
                        └──────────────┬───────────────────────┘
                                       │ reads (CPI or account)
             ┌─────────────────────────┼─────────────────────────┐
             ▼                         ▼                         ▼
   ┌──────────────────┐   ┌────────────────────────┐   ┌──────────────────┐
   │ IdentityProvider │   │ IdentityProvider       │   │ IdentityProvider │
   │ = SAS            │   │ = Civic Pass (Gateway) │   │ = <future…>      │
   │ (in-house Dev,   │   │ (optional, opt-in)     │   │                  │
   │  official Main)  │   │                        │   │                  │
   └──────────────────┘   └────────────────────────┘   └──────────────────┘
```

**Accounts (added in Step 4d — does not alter Step 4a accounts):**

```rust
/// Per-wallet identity snapshot. PDA: [b"identity", wallet].
/// Created lazily; absence implies IdentityStatus::Unverified.
pub struct IdentityRecord {
    pub wallet:         Pubkey,
    pub provider:       u8,          // IdentityProvider enum
    pub status:         u8,          // IdentityStatus enum
    pub verified_at:    i64,
    pub expires_at:     i64,         // 0 = never
    pub gateway_token:  Pubkey,      // Civic gateway-token account; default when provider != Civic
    pub bump:           u8,
}

#[repr(u8)] pub enum IdentityProvider { None=0, Sas=1, Civic=2 /* 3..=255 reserved */ }
#[repr(u8)] pub enum IdentityStatus   { Unverified=0, Verified=1, Expired=2, Revoked=3 }
```

**Instructions (roundfi-reputation, Step 4d):**
- `link_civic_identity(gateway_token)` — validates a Civic Gateway Token account against the Civic Networks program; sets `IdentityRecord { provider: Civic, status: Verified, expires_at }`.
- `refresh_identity()` — re-reads the gateway token; marks `Expired` if Civic revoked it.
- `unlink_identity()` — user-initiated removal.
- `attest(...)` — unchanged SAS-compatible issuance; when an `IdentityRecord` exists for the subject, the attestation `payload` embeds the provider+status as a read-only hint to indexers.

**Rules (non-breaking by construction):**
1. **Never a gate.** `join_pool` does NOT read `IdentityRecord`. Reputation-level logic (`promote_level`, stake bps snapshot) continues to derive from on-chain behavior alone.
2. **Additive only.** Absence of an `IdentityRecord` is indistinguishable from `IdentityStatus::Unverified` — no existing wallet is affected when this layer ships.
3. **Scoring hint, not auth.** The B2B score API MAY weigh verified identities higher; the on-chain protocol MUST not.
4. **Provider-agnostic.** Civic is the first non-SAS provider; the `provider: u8` enum reserves codes for future additions (WorldID, Sumsub-on-chain, etc.) with no account migration needed.

**Mainnet migration:** `IdentityRecord` layout is stable across Devnet/Mainnet. Civic's Gateway Program ID is identical across clusters; only the Civic Network pubkey (e.g. `uniqueness`, `kyc`) changes via env config.

---

## 5. Critical On-chain Invariants

These are enforced by assertions inside instruction handlers. A test per invariant is mandatory in Step 5.

1. **Seed Draw 91.6%** — at the end of Month 1 (cycle 0 payout), `pool_usdc_vault.balance + escrow_vault.balance >= 0.916 * (members_target * installment_amount)`.
2. **Debt-faster-than-collateral** — for any member holding both outstanding debt *D* and escrowed collateral *C*, after any `release_escrow`, the new state must satisfy `D / D_initial <= C / C_initial` (escrow releases lag debt paydown).
3. **Solidarity conservation** — `sum(solidarity_in) == sum(good_faith_out) + solidarity_balance` across the life of a pool.
4. **Yield waterfall order** — `harvest_yield` must pay in order: Protocol 20% → Guarantee Fund fill-up to 150% of protocol fee → LP Angels share → Participants pro-rata. No step may underflow or reorder.
5. **Stake bps by level** — `Member.stake_bps` is snapshotted at `join_pool` from current `ReputationProfile.level`, and never changes mid-cycle.
6. **Slot monotonicity** — each `claim_payout(cycle)` must be called exactly once per cycle by exactly one `Member.slot_index == cycle`.
7. **NFT mirrors state** — after any state transition, the NFT's on-chain attributes (contributions_paid, defaulted, level) must match the `Member` PDA. Enforced by updating both in the same instruction.

---

## 6. Error Taxonomy

Defined in `roundfi-core/src/error.rs`:

```
InsufficientStake, PoolFull, PoolNotForming, PoolNotActive, PoolClosed,
AlreadyJoined, NotAMember, WrongCycle, CycleNotReady, AlreadyContributed,
NotYourPayoutSlot, EscrowLocked, EscrowNothingToRelease,
DefaultedMember, SeedDrawShortfall, SolidarityOverflow,
InvalidYieldAdapter, YieldAdapterMismatch, WaterfallUnderflow,
AttestationSchemaMismatch, ReputationUnderflow, InvalidReputationLevel,
MathOverflow, Unauthorized, ProtocolPaused, InvalidMint, InvalidNftAsset,
EscapeValveNotListed, EscapeValvePriceMismatch
```

`roundfi-reputation`: `InvalidSchema, InvalidIssuer, AttestationRevoked, LevelThresholdNotMet`.

`yield-adapter`: `InsufficientLiquidity, AdapterPaused, HarvestTooSoon`.

---

## 7. PDA Seeds — Authoritative List

| Account | Program | Seeds |
|---|---|---|
| ProtocolConfig | core | `[b"config"]` |
| Pool | core | `[b"pool", authority, seed_id.to_le_bytes()]` |
| Member | core | `[b"member", pool, wallet]` |
| escrow_vault authority | core | `[b"escrow", pool]` |
| solidarity_vault authority | core | `[b"solidarity", pool]` |
| yield_vault authority | core | `[b"yield", pool]` |
| position_authority | core | `[b"position", pool, slot_index.to_le_bytes()]` |
| ReputationProfile | reputation | `[b"reputation", wallet]` |
| ReputationConfig | reputation | `[b"rep-config"]` |
| Attestation | reputation | `[b"attestation", issuer, subject, schema_id.to_le_bytes(), nonce.to_le_bytes()]` |
| YieldVaultState | yield-* | `[b"yield-state", owner]` |

---

## 8. Off-chain Architecture

### 8.1 `backend/`

```
backend/
├── packages/
│   ├── indexer/        # Helius webhooks + websocket fallback → Postgres event store
│   ├── api/            # Fastify HTTP API
│   ├── crank/          # scheduled `harvest_yield`, `distribute_good_faith_bonus`, `settle_default`
│   └── shared/         # program SDK re-exports, config loader, Prisma client
├── prisma/
│   └── schema.prisma   # pools, members, contributions, attestations, reputation_profiles
└── docker-compose.yml  # Postgres + Redis + adminer
```

**API endpoints (v1):**
- `GET /pools` — list, filter by status/level
- `GET /pools/:id` — pool detail with member roster
- `POST /pools/:id/tx/join` — returns partially-signed TX
- `POST /pools/:id/tx/contribute` — returns partially-signed TX
- `GET /members/:wallet` — all memberships
- `GET /reputation/:wallet` — SAS-compatible JSON (`{ level, score, attestations: [...] }`)
- `GET /attestations/:subject` — raw on-chain attestations
- `POST /b2b/score` — **API-key-gated** (enterprise SAS score API; stub in hackathon)
- `GET /healthz` · `GET /metrics` (prometheus)

**Crank service:** runs three jobs on cron:
- `harvest_yield` per active pool — every 6h
- `distribute_good_faith_bonus` — at end of each cycle (`now >= pool.next_cycle_at`)
- `settle_default` — grace-period check, 7 days after missed contribution

The crank authority wallet holds minimal SOL and is a **dedicated keypair** (not the protocol authority). Key is loaded from env path on Devnet, from GCP KMS on Mainnet.

### 8.2 `app/` (frontend)

Next.js 15 App Router, Server Components for reads, Client Components for wallet interactions.

**Routes:**
- `/` — landing (hero aligned with pitch)
- `/pools` — browse pools (Forming + Active)
- `/pools/new` — create pool wizard (authority-gated in hackathon; public after Mainnet)
- `/pools/[id]` — pool detail, contribute, claim, escape-valve listing
- `/dashboard` — "my pools", upcoming installments, reputation, earnings
- `/profile/[wallet]` — public credit identity page (reputation + attestations)
- `/escape-valve` — open marketplace for NFT positions
- `/docs` — MDX-rendered docs (mirrors `/docs/*` in repo)

**Key libs:**
- `@solana/wallet-adapter-react` + `@solana/wallet-adapter-react-ui`
- `@coral-xyz/anchor` (client)
- `@solana/kit` (modern tx building)
- TanStack Query (on-chain data caching)
- `zustand` (UI state)
- `shadcn/ui` + Tailwind
- `@metaplex-foundation/mpl-core` (NFT reads)

---

## 9. Configuration Strategy

`config/clusters.ts` is the only place env vars are read. Everything else imports from it.

`.env.example`:
```
# ─── Cluster ─────────────────────────────
SOLANA_CLUSTER=devnet               # devnet | mainnet-beta | localnet
SOLANA_RPC_URL=https://api.devnet.solana.com
HELIUS_API_KEY=

# ─── Program IDs (set after deploy) ──────
ROUNDFI_CORE_PROGRAM_ID=
ROUNDFI_REPUTATION_PROGRAM_ID=
ROUNDFI_YIELD_MOCK_PROGRAM_ID=
ROUNDFI_YIELD_KAMINO_PROGRAM_ID=

# ─── Fixed (non-secret) ──────────────────
METAPLEX_CORE_PROGRAM_ID=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
USDC_MINT_DEVNET=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
USDC_MINT_MAINNET=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# ─── Backend ─────────────────────────────
DATABASE_URL=postgres://roundfi:roundfi@localhost:5432/roundfi
REDIS_URL=redis://localhost:6379
CRANK_KEYPAIR_PATH=./keypairs/crank.json
IRYS_NODE_URL=https://devnet.irys.xyz
IRYS_FUNDER_KEYPAIR_PATH=./keypairs/irys.json
B2B_API_KEY_SALT=

# ─── Frontend ────────────────────────────
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_RPC_URL=
NEXT_PUBLIC_CORE_PROGRAM_ID=
```

**Rule:** no program IDs are hardcoded in Rust or TS. IDs are loaded from env. Anchor's `declare_id!` macro uses a constant generated by the deploy script (see Step 3 plan).

---

## 10. Security Model (Step-2 summary, full audit in Step 9)

| Threat | Mitigation |
|---|---|
| Signer spoofing | All mut accounts verified against PDA derivation with expected seeds |
| Re-entrancy via CPI | Core program uses `invoke_signed` only; no callbacks; state writes precede CPIs |
| Arithmetic overflow | `checked_*` on all financial math; custom `MathOverflow` error |
| Default griefing | `settle_default` requires `now >= member.next_due + grace_period` (7d) |
| NFT impersonation | Member PDA stores `nft_asset` pubkey; every mutation checks `nft_asset == passed_asset` |
| Yield adapter swap attack | `PoolConfig.yield_adapter` is immutable after pool creation — can't be hot-swapped to a malicious program |
| Reputation inflation | Attestations are idempotent per `(issuer, subject, schema, nonce)` PDA — duplicates fail |
| Waterfall rounding drift | Use bps math with floor; residuals accumulate in `solidarity_balance` |
| Admin capture | ProtocolConfig.authority is a multisig on Mainnet (Squads V4) |

---

## 11. Testing Strategy (detail in Step 5)

- **Unit (Rust):** pure-math modules — `math::waterfall`, `math::escrow_vesting`, `math::reputation_score`
- **Integration (TS + bankrun):** Anchor tests against a local bankrun validator
  - Happy path: 24-member full 24-cycle lifecycle, all on-time
  - Default in mid-cycle → settle_default → seize stake → default attestation
  - Escape valve: distressed member lists → buyer purchases → NFT transfers → Member re-anchors → reputation re-anchored
  - Waterfall: harvest with varying yield, assert bps splits across 10 randomized scenarios
  - Seed draw invariant: property-based test across a range of pool sizes
- **Fuzz:** `cargo-fuzz` on entry points for `contribute`, `claim_payout`, `harvest_yield`
- **E2E (Playwright):** frontend smoke tests against local-validator
- **CI:** GitHub Actions — `anchor build && anchor test && pnpm -r test`

---

## 12. Mainnet Migration Plan (Step 11 deliverable)

Already de-risked by Step 2 decisions:
1. `roundfi-yield-kamino` replaces `roundfi-yield-mock` (same interface). Authority calls `update_protocol_config({ default_yield_adapter })`.
2. `roundfi-reputation` is reimplemented against the official SAS program (same `Attestation` schema). Program-upgrade authority redeploys; existing `ReputationProfile` accounts migrate in-place.
3. `USDC_MINT` env swap to Mainnet USDC.
4. `authority` of `ProtocolConfig` is handed off from the deploy keypair to a **Squads V4** multisig.
5. Program upgrade authority handed to multisig.
6. `IRYS_NODE_URL` swap from `devnet.irys.xyz` to `node1.irys.xyz`.

No client/SDK rebuild required — IDL is unchanged.

---

## 13. Proposed Repo Structure (finalized)

```
RoundFinancial/
├── Anchor.toml
├── Cargo.toml                    # workspace
├── package.json                  # pnpm workspaces root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
├── .gitignore
├── README.md
│
├── programs/
│   ├── roundfi-core/
│   │   ├── Cargo.toml
│   │   └── src/{lib.rs,state/*.rs,instructions/*.rs,error.rs,math/*.rs}
│   ├── roundfi-reputation/
│   ├── roundfi-yield-mock/
│   └── roundfi-yield-kamino/     # scaffold only; impl in a later phase
│
├── sdk/                          # @roundfi/sdk
│   └── src/{client.ts,pool.ts,member.ts,reputation.ts,generated/*}
│
├── backend/
│   ├── packages/{indexer,api,crank,shared}/
│   ├── prisma/schema.prisma
│   └── docker-compose.yml
│
├── app/                          # Next.js 15
│   ├── src/app/{...routes}/
│   ├── src/components/
│   └── src/lib/{anchor,wallet,api}.ts
│
├── scripts/
│   ├── devnet/{airdrop.ts,deploy.ts,init-protocol.ts,seed-pool.ts}
│   ├── mainnet/{deploy.ts,migrate.ts,handoff-multisig.ts}
│   └── nft/{upload-metadata.ts}
│
├── tests/
│   └── integration/{happy-path.test.ts,default.test.ts,escape-valve.test.ts,waterfall.test.ts}
│
├── config/
│   ├── clusters.ts
│   └── program-ids.json          # generated after deploy
│
├── docs/
│   ├── architecture.md           # THIS FILE
│   ├── programs/{core,reputation,yield}.md
│   ├── backend.md
│   ├── frontend.md
│   ├── devnet-setup.md           # Step 3 output
│   └── mainnet-migration.md      # Step 11 output
│
└── keypairs/                     # gitignored; only .gitkeep committed
```

---

## 14. What Changes vs. Step 1 Proposal

- **Collapsed from 5 programs to 3** (core absorbs escrow + solidarity; NFT handled via Metaplex Core CPI, not a custom program). Reason: hackathon ROI — fewer CPI round-trips, fewer deploy scripts, same security surface.
- **Added ProtocolConfig singleton** — Step 1 implied fee knobs but didn't place them.
- **Introduced explicit `escrow_release_bps`** — needed to enforce invariant #2.
- **Pinned PDA seeds** — Step 1 left them informal.
- **Locked yield-adapter pattern as two interchangeable programs**, not one program with a runtime flag. Reason: audit clarity.

---

*End of Architecture Spec v0.1.*
