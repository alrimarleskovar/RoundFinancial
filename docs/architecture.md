# RoundFi — Architecture Specification

**Version:** 0.5 (2026-04-22 — Step 4f: narrative alignment + `get_profile` read path + stress-test script)
**Status:** Implementation in progress — Step 4f (pre-Step-5)

This document is the single source of truth for RoundFi's on-chain and off-chain architecture. Every subsequent implementation step must conform to what is written here, or amend this document first.

> **Pitch alignment.** For the authoritative mapping between product-narrative claims and on-chain behavior (shield names, solvency framing, the "up to 10× capital advancement" wording, roadmap vs. shipped product), see [pitch-alignment.md](./pitch-alignment.md). For the yield waterfall + Guarantee Fund deep-dive, see [yield-and-guarantee-fund.md](./yield-and-guarantee-fund.md).

---

## 1. Design Goals & Non-Goals

**Goals**
- Production-ready, hackathon-grade protocol on **Solana Devnet** with a clean **Mainnet migration path**.
- Enforce all product invariants (Triple Shield, 50-30-10 ladder, seed draw 91.6%, 1% solidarity, yield waterfall) directly on-chain — off-chain services may read/present, never gate.
- **Losses are bounded and the protocol remains solvent by construction.** The D/C invariant (per-member, in `settle_default`) and the Seed-Draw invariant (per-pool, in `claim_payout`) together bound per-transaction loss to the defaulter's own posted collateral, and guarantee the pool retains ≥91.6% of max-month-1 collections at cycle 0. No profit claim is made under stress; solvency is the claim.
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
    pub wallet:                    Pubkey,
    pub level:                     u8,     // 1..=3
    pub cycles_completed:          u32,
    pub on_time_payments:          u32,
    pub late_payments:             u32,
    pub defaults:                  u32,
    pub total_participated:        u32,    // lifetime pools joined (unique)
    pub score:                     u64,    // derived; updated via attestations
    pub last_cycle_complete_at:    i64,    // anti-gaming cooldown stamp (Step 4d)
    pub first_seen_at:             i64,
    pub last_updated_at:           i64,
    pub bump:                      u8,
}
```

Step 4d extends this struct with `total_participated` and `last_cycle_complete_at`. Absence of a profile is treated as score=0, level=1 (default unverified).

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
| `harvest_yield()` | crank | Pool (M), yield adapter CPI, treasury ATA (M), pool_usdc_vault (M) | Pulls yield, splits per waterfall in strict order: **(1) Guarantee Fund top-up → (2) Protocol fee 20% → (3) Good-faith bonus → (4) Remaining to participants**. No step skippable or reorderable. |
| `close_pool()` | authority (S) | Pool (M), vaults (M) | After all cycles completed; sweeps residuals; emits CycleComplete attestations for all members |

### 4.2 `roundfi-reputation`

| Instruction | Caller | Effect |
|---|---|---|
| `initialize_reputation(cfg)` | authority (S) | One-time singleton init of `ReputationConfig` — stores `roundfi_core_program` and the Civic network pubkey. |
| `init_profile(wallet)` | anyone (S) | Creates `ReputationProfile` for a wallet. Permissionless bootstrap. |
| `attest(schema_id, nonce, payload)` | authorized issuer (S) | Creates `Attestation`; updates `ReputationProfile.score` and counters according to schema. Rejects unwhitelisted issuers and cooldown violations. |
| `revoke(attestation)` | issuer (S) | Marks revoked; recomputes score. |
| `promote_level(wallet)` | anyone (S) | Permissionless — re-reads the score and applies the threshold rule. Advances `level` 1→2 or 2→3; no admin override. |
| `link_civic_identity(gateway_token)` | user (S) | Validates Civic gateway-token account against the Civic Networks program and writes `IdentityRecord { provider: Civic, status: Verified }`. Untrusted-provider checks enforced. |
| `refresh_identity()` | anyone (S) | Re-reads the gateway token and flips status to `Expired` / `Revoked` when appropriate. No privileged access; anyone can refresh any profile. |
| `unlink_identity()` | user (S) | Owner-only removal — frees the `IdentityRecord`. |

**Authorized issuers** = whitelist stored in `ReputationConfig`, initialized with `roundfi-core`'s program ID. On Mainnet, the whitelist is replaced by signed SAS issuance. The core program CPIs into `attest()` inside `contribute` / `claim_payout` / `settle_default`; every CPI is checked against the stored program id (program-id guard).

**Anti-gaming rules (locked Step 4d):**

1. **Cycle-complete cooldown.** A `CycleComplete` attestation for a given subject is rejected when `clock.unix_timestamp < profile.last_cycle_complete_at + MIN_CYCLE_COOLDOWN_SECS`. Default `MIN_CYCLE_COOLDOWN_SECS = 518_400` (60 % of a 10-day cycle). Prevents a sybil farm spinning up fake pools that all "complete" in one slot.
2. **Same-issuer / same-subject rate limit.** Per schema, an issuer may only attest once per cooldown window. Enforced by the attestation PDA seeds `[b"attestation", issuer, subject, schema_id, nonce]` *plus* an on-chain time check against `profile.last_updated_at`.
3. **Sybil hint.** If `IdentityRecord.status == Verified`, on-time increments are applied at full weight; if Unverified/Expired/Revoked, on-time weight is **halved** (integer arithmetic: `delta / 2`). Defaults are never reduced — this rule only dampens positive signals.
4. **Default stickiness.** Once a `Default` attestation lands with `schema_id == SCHEMA_DEFAULT` for a `(subject, pool)` tuple, subsequent `CycleComplete` attestations for that same pool are rejected. Recovery is deferred (post-4d).
5. **Permissionless promotion.** `promote_level` re-reads the score and applies the threshold. No admin can bypass; no admin can demote either — level is monotonic up except via `Default` attestations that drop the score below a threshold.

**Score arithmetic (v1):**
- `+10` per `Payment` (on-time)
- `+50` per `CycleComplete` (halved to `+25` if unverified)
- `-100` per `Late`
- `-500` per `Default`
- Saturating, no underflow below 0.
- Level thresholds: `L1 = 0`, `L2 = 500`, `L3 = 2_000`. Permissionless `promote_level` advances a profile to the highest level whose threshold ≤ score.

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

### 4.5 Step 4c mechanics — defaults, escape valve, yield (added v0.3 — 2026-04-22)

#### 4.5.0 Triple Shield — canonical mapping (added v0.5 — 2026-04-22)

The product narrative refers to a "Triple Shield" security architecture. The canonical mapping below — authoritative from v0.5 forward — matches the shipping code in [settle_default.rs](../programs/roundfi-core/src/instructions/settle_default.rs). Any deck, demo, or copy that uses a different ordering is out of sync and must be corrected against this table.

| # | Name (pitch) | Code primitive | Role on default | Funded from |
|---|--------------|------------------|------------------|--------------|
| **Shield 1** | **Solidarity Vault** | `solidarity_vault` PDA | **Seized first**, up to the missed installment | 1% of every contribution (`solidarity_bps = 100`) |
| **Shield 2** | **Member Stake + Escrow** | `member.escrow_balance` + `member.stake_deposited` | Seized second and third; capped by the **D/C invariant** (`D_rem × C_init ≤ C_after × D_init`) | The defaulting member's own collateral |
| **Shield 3** | **Guarantee Fund** | `pool.guarantee_fund_balance` (earmark inside `pool_usdc_vault`) | **Not drawn in v1** — earmarked to block payout drain. v2 adds a catastrophic-loss draw path. | Yield harvest (step 1 of the waterfall) |

**Framing in narrative.** "Losses are bounded and the protocol remains solvent by construction" is the only solvency claim approved for v1. The "10× leverage" slogan is to be phrased as "**up to 10× capital advancement based on reputation tier**" — this distinguishes the ROSCA rotation mechanic from DeFi margin-leverage. The "Serasa da Web3 / on-chain behavior oracle" pitch is roadmap, not shipped; the `get_profile` instruction (§4.2, added in Step 4f) is the foundation layer.

See [pitch-alignment.md](./pitch-alignment.md) for the full pitch ↔ code cross-reference and the per-phrase revision table, and [yield-and-guarantee-fund.md](./yield-and-guarantee-fund.md) for a detailed explainer of the yield waterfall and the Guarantee Fund's v1 vs. v2 roles.

This section freezes the behavior contracts for the Step 4c instructions. Any change here requires a new architecture version AND a migration plan for pools on Devnet.

#### 4.5.1 `settle_default(member)` — 7-day grace + D/C invariant

- **Precondition:** `clock.unix_timestamp >= pool.next_cycle_at + GRACE_PERIOD_SECS` where `GRACE_PERIOD_SECS = 7 days = 604_800` (protocol constant, not per-pool).
- **Precondition:** `member.contributions_paid < pool.current_cycle` — the member is genuinely behind.
- **Debt/Collateral invariant (#2 strengthened).** Let
  - `D_initial = pool.credit_amount` (full debt at payout)
  - `D_remaining = D_initial - member.total_contributed_toward_debt()` (scheduled installments not yet paid)
  - `C_initial = member.stake_deposited_initial + member.total_escrow_deposited`
  - `C_remaining = member.stake_deposited + member.escrow_balance`

  The seizure amount must satisfy `D_remaining * C_initial <= C_remaining_after_seizure * D_initial` (cross-multiplied, no division). If the invariant cannot hold, the handler seizes *less* rather than violating it.
- **Order of operations:**
  1. Flag `member.defaulted = true` (atomic with seizure — state never half-set).
  2. Seize from solidarity vault first (up to remaining installments covered), then from member escrow, then from member stake.
  3. Route seized funds to `pool_usdc_vault` so remaining members are not out-of-pocket.
  4. Emit a `DefaultSettled` msg! log with per-bucket amounts and the final D/C ratio.
- **No indefinite locks:** after `settle_default`, the pool can always advance its cycle — a defaulted member no longer blocks `claim_payout` for their slot (payout for that slot is funded by seized stake + solidarity).
- **Irreversibility:** `member.defaulted` can never transition back to `false`. The escape valve cannot be listed for a defaulted member.

#### 4.5.2 Escape Valve — `escape_valve_list` + `escape_valve_buy`

- **Purpose:** Provide a non-default exit for members who cannot continue, without breaking the pool.
- **Listing preconditions (`escape_valve_list`):**
  - `!member.defaulted`
  - `member.contributions_paid == pool.current_cycle` (member is fully current; cannot offload an overdue obligation)
  - `!member.paid_out` OR pool is not yet at that member's slot (i.e., listing is most useful pre-payout; post-payout listings are permitted but have limited utility)
  - Price is denominated in USDC and stored in an `EscapeValveListing` account at PDA `[b"listing", pool, slot_index]`.
- **Buy preconditions (`escape_valve_buy`):**
  - Listing exists and is `Active`.
  - Buyer has no existing `Member` PDA for this pool (one-wallet-per-pool).
  - Buyer pays the listed price in USDC directly to seller (protocol takes **no fee in Step 4c** — reserved for future).
- **Atomic re-anchor:** Because `Member` PDA seeds include `wallet`, the transfer uses a **close-old / create-new** pattern:
  1. Snapshot old Member state (slot_index, contributions_paid, escrow_balance, on_time_count, late_count, stake_deposited, nft_asset, reputation_level, stake_bps).
  2. Close old Member PDA; rent returns to seller.
  3. Create new Member PDA at `[b"member", pool, buyer]`; populate with snapshot except `wallet` and `joined_at`.
  4. Transfer NFT asset ownership to buyer via Metaplex Core CPI (escrow-frozen remains, it's soulbound to the *position* not the wallet).
  5. Close the listing account; rent returns to seller.
- **Irrelevant to invariants:** The escape valve does NOT change pool totals (`total_contributed`, `solidarity_balance`, `escrow_balance`) — only the wallet pointer moves.

#### 4.5.3 Yield adapter — adapter-is-untrusted contract

- **Validation on every CPI:**
  - `require!(ctx.accounts.yield_adapter.key() == pool.yield_adapter, YieldAdapterMismatch)`.
  - All adapter-side accounts are passed through `remaining_accounts`; core never assumes PDA layout.
- **Balance-based verification (never trust return values):**
  - Before `deposit`/`withdraw`/`harvest`, snapshot the affected token account amounts.
  - After the CPI, reload accounts and compute the *actual* delta.
  - Use the actual delta — never the requested amount — for subsequent accounting.
- **Failure modes:**
  - Adapter reverts → core reverts (normal behavior).
  - Adapter returns less than requested → core accepts the lower amount and logs it; waterfall proceeds on the smaller yield.
  - Adapter returns more than requested → core accepts the bonus and routes it per waterfall (no free money is lost, no buckets are exceeded).
- **Isolation:** `pool_usdc_vault` is separate from `yield_vault`. Core never gives the adapter direct authority over `pool_usdc_vault`.

#### 4.5.4 Admin — `update_protocol_config` + `pause`

- **`pause(paused: bool)`** — authority-only. When paused, all user-facing instructions short-circuit with `ProtocolPaused`. Read paths and `settle_default` remain available (pause must not trap funds).
- **`update_protocol_config(patch)`** — authority-only. Only mutable fields: `fee_bps_yield`, `fee_bps_cycle_l*`, `guarantee_fund_bps`, `treasury`. Identity-critical fields (`usdc_mint`, `metaplex_core`, `authority`, `reputation_program`) are **frozen** post-initialization.

### 4.6 Step 4d mechanics — reputation + identity (added v0.4 — 2026-04-22)

This section freezes the behavior contracts for the Step 4d instructions that live in the `roundfi-reputation` program.

#### 4.6.1 Program boundary with `roundfi-core`

- `ReputationConfig` stores `roundfi_core_program: Pubkey` at init time. This is **frozen** — no admin path can rotate it.
- Every write-path instruction that can be triggered by core CPI (`attest`, `revoke`) validates the *caller program id* via `anchor_lang::solana_program::sysvar::instructions` introspection OR via a PDA signer check: core passes the `Pool` PDA as the issuer signer, and `attest` computes `Pubkey::find_program_address(...)` with `roundfi_core_program` and requires a match.
- Non-whitelisted programs are rejected with `InvalidIssuer`. Direct wallet-signed `attest` calls are only allowed from the `ReputationConfig.authority` (used for manual corrections in Step 9 forward).

#### 4.6.2 Identity validator — untrusted provider contract

`link_civic_identity` accepts an arbitrary account claimed to be a Civic gateway token. The validator:

1. Verifies the account's **owner** equals the Civic Networks program ID stored in `ReputationConfig`.
2. Deserializes the gateway-token layout (Civic's 83-byte state struct) from raw account data — no Anchor `Account<'info, T>` trust, since the program does not own that type.
3. Checks: `state == Active`, `expires_at == 0 || expires_at > clock.unix_timestamp`, `owner_wallet == signer.key()`.
4. Checks the token's *gatekeeper network* matches `ReputationConfig.civic_network`.
5. On success, writes `IdentityRecord { provider: Civic, status: Verified, verified_at: clock.unix_timestamp, expires_at, gateway_token: token.key(), bump }`.

Any deserialization error, owner mismatch, or state flag mismatch rejects with `InvalidIdentityProof` — never a silent downgrade.

`refresh_identity()` is permissionless (anyone can refresh anyone's record). It re-runs the validator; if the token now fails validation, the record's status is flipped to `Expired` / `Revoked`. This path lets indexers keep the on-chain state fresh without privileged crank authority.

#### 4.6.3 Attestation issuance flow (core → reputation)

When `roundfi-core` finalizes a contribution / claim / default, it CPIs into `roundfi-reputation::attest` with:

- `issuer` = pool PDA (signed via core's program).
- `subject` = member wallet.
- `schema_id` = one of `SCHEMA_PAYMENT = 1`, `SCHEMA_LATE = 2`, `SCHEMA_DEFAULT = 3`, `SCHEMA_CYCLE_COMPLETE = 4`, `SCHEMA_LEVEL_UP = 5`.
- `nonce` = `(pool.current_cycle as u64) << 32 | slot_index as u64` — deterministic, prevents double-attesting the same event.
- `payload` = 96-byte struct: `{ pool, cycle, installment_amount, on_time_bonus_bps, identity_hint }`.

The reputation program:
- Derives the expected pool-issuer PDA from `(roundfi_core_program, b"pool", pool_authority, seed_id_le)` and **requires the signer to match**.
- Applies the schema's delta to `ReputationProfile.score` with saturating math.
- Checks anti-gaming rules (§4.2 #1–#4) before committing.
- For `SCHEMA_CYCLE_COMPLETE`: updates `last_cycle_complete_at` and `total_participated` + `cycles_completed`.
- For `SCHEMA_DEFAULT`: flips an internal `(subject, pool)` default-sticky bit.

`promote_level` is a **read-only** re-computation: anyone may call it, the program re-reads the score, picks the highest threshold tier, and writes the new level. No admin override, no demotion path — defaults reduce the *score*, and the next `promote_level` call naturally settles the level if it drops.

#### 4.6.4 Non-breaking guarantee

Step 4d does NOT alter any instruction in `roundfi-core`'s storage layout. The existing `join_pool` still reads `ReputationProfile` for the stake-bps snapshot; the new identity record is an **optional** side-car that `join_pool` continues to ignore. If the reputation program is not yet deployed, `join_pool` treats `level = 1` (the same behavior it has today).

---

## 5. Critical On-chain Invariants

These are enforced by assertions inside instruction handlers. A test per invariant is mandatory in Step 5.

1. **Seed Draw 91.6%** — at the end of Month 1 (cycle 0 payout), `pool_usdc_vault.balance + escrow_vault.balance >= 0.916 * (members_target * installment_amount)`.
2. **Debt-faster-than-collateral** — for any member holding both outstanding debt *D* and escrowed collateral *C*, after any `release_escrow`, the new state must satisfy `D / D_initial <= C / C_initial` (escrow releases lag debt paydown).
3. **Solidarity conservation** — `sum(solidarity_in) == sum(good_faith_out) + solidarity_balance` across the life of a pool.
4. **Yield waterfall order** — `harvest_yield` must pay in this strict order (revised in v0.3 for Step 4c):
   1. **Guarantee Fund top-up** up to `guarantee_fund_bps` × cumulative protocol fees (default 150%). GF is topped up FIRST so the pool's shock absorber is funded before any fee skimming.
   2. **Protocol fee** — 20% of the *remaining* yield (after GF top-up) is transferred to `treasury`.
   3. **Good-faith bonus** — configurable share of the remaining yield is routed to the solidarity vault for distribution to on-time members via `distribute_good_faith_bonus`.
   4. **Participants** — the residual is credited to `pool_usdc_vault` for pro-rata distribution (effectively reducing future installments or topping up payouts).

   The handler must enforce `gf + fee + bonus + participants == harvested` and reject any reordering. If the yield adapter returns less than requested, the handler uses the actual post-CPI delta — never the requested amount.
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

`roundfi-reputation`: `InvalidSchema, InvalidIssuer, AttestationRevoked, LevelThresholdNotMet, CooldownActive, DefaultSticky, InvalidIdentityProof, IdentityExpired, IdentityAlreadyLinked, ProfileNotFound, ReputationUnderflow, UnauthorizedProvider`.

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
| IdentityRecord | reputation | `[b"identity", wallet]` |
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
