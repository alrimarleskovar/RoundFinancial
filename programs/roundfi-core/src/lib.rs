//! RoundFi Core program.
//!
//! Owns the ROSCA pool state machine, adaptive escrow, solidarity vault,
//! seed-draw invariant, yield routing and position-NFT orchestration.
//!
//! Step 4a scope: ProtocolConfig, Pool, Member + `initialize_protocol`,
//! `create_pool`, `join_pool`.
//! Step 4b scope: `contribute`, `claim_payout` (with seed-draw invariant),
//! `release_escrow` + pure-math `math::bps` and `math::escrow_vesting`
//! modules.
//! Step 4c scope: `deposit_idle_to_yield`, `harvest_yield` (strict
//! Fee→GF→LP→Participants waterfall, PDF-canonical v1.1), `settle_default`
//! (7-day grace + D/C invariant), `escape_valve_list` /
//! `escape_valve_buy` (close-old / create-new Member + real Metaplex
//! Core asset transfer via FreezeDelegate+TransferDelegate plugins),
//! `close_pool`, `update_protocol_config`, `pause` + `cpi::yield_adapter`
//! safe wrapper + `math::waterfall`.

use anchor_lang::prelude::*;

pub mod constants;
pub mod cpi;
pub mod error;
pub mod instructions;
pub mod math;
pub mod state;

pub use constants::*;
pub use error::RoundfiError;
pub use instructions::*;
pub use state::*;

declare_id!("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw");

#[program]
pub mod roundfi_core {
    use super::*;

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        args: InitializeProtocolArgs,
    ) -> Result<()> {
        instructions::initialize_protocol::handler(ctx, args)
    }

    pub fn create_pool(ctx: Context<CreatePool>, args: CreatePoolArgs) -> Result<()> {
        instructions::create_pool::handler(ctx, args)
    }

    /// Second half of pool creation — initializes the four USDC vault
    /// ATAs (pool/escrow/solidarity/yield) via sequential CPIs to the
    /// SPL Associated Token Program. Must be called after `create_pool`
    /// and before any `join_pool`. Idempotent.
    pub fn init_pool_vaults(ctx: Context<InitPoolVaults>) -> Result<()> {
        instructions::init_pool_vaults::handler(ctx)
    }

    pub fn join_pool(ctx: Context<JoinPool>, args: JoinPoolArgs) -> Result<()> {
        instructions::join_pool::handler(ctx, args)
    }

    pub fn contribute(ctx: Context<Contribute>, args: ContributeArgs) -> Result<()> {
        instructions::contribute::handler(ctx, args)
    }

    pub fn claim_payout(ctx: Context<ClaimPayout>, args: ClaimPayoutArgs) -> Result<()> {
        instructions::claim_payout::handler(ctx, args)
    }

    pub fn release_escrow(ctx: Context<ReleaseEscrow>, args: ReleaseEscrowArgs) -> Result<()> {
        instructions::release_escrow::handler(ctx, args)
    }

    pub fn deposit_idle_to_yield<'info>(
        ctx: Context<'_, '_, '_, 'info, DepositIdleToYield<'info>>,
        args: DepositIdleToYieldArgs,
    ) -> Result<()> {
        instructions::deposit_idle_to_yield::handler(ctx, args)
    }

    pub fn harvest_yield<'info>(
        ctx: Context<'_, '_, '_, 'info, HarvestYield<'info>>,
        args: HarvestYieldArgs,
    ) -> Result<()> {
        instructions::harvest_yield::handler(ctx, args)
    }

    pub fn settle_default(ctx: Context<SettleDefault>, args: SettleDefaultArgs) -> Result<()> {
        instructions::settle_default::handler(ctx, args)
    }

    pub fn escape_valve_list(ctx: Context<EscapeValveList>, args: EscapeValveListArgs) -> Result<()> {
        instructions::escape_valve_list::handler(ctx, args)
    }

    /// Commit-reveal step 1/2 (#232). Creates a listing in `Pending`
    /// status with only a hash of `(price || salt)` stored on chain —
    /// hides the price from searchers monitoring escape-valve flow.
    pub fn escape_valve_list_commit(
        ctx: Context<EscapeValveListCommit>,
        args: EscapeValveListCommitArgs,
    ) -> Result<()> {
        instructions::escape_valve_list_commit::handler(ctx, args)
    }

    /// Commit-reveal step 2/2 (#232). Validates the (price, salt)
    /// pair against the stored hash, transitions the listing to
    /// `Active`, and arms a `REVEAL_COOLDOWN_SECS` window before
    /// the listing becomes buyable.
    pub fn escape_valve_list_reveal(
        ctx: Context<EscapeValveListReveal>,
        args: EscapeValveListRevealArgs,
    ) -> Result<()> {
        instructions::escape_valve_list_reveal::handler(ctx, args)
    }

    pub fn escape_valve_buy(ctx: Context<EscapeValveBuy>, args: EscapeValveBuyArgs) -> Result<()> {
        instructions::escape_valve_buy::handler(ctx, args)
    }

    pub fn close_pool(ctx: Context<ClosePool>) -> Result<()> {
        instructions::close_pool::handler(ctx)
    }

    pub fn update_protocol_config(
        ctx: Context<UpdateProtocolConfig>,
        args: UpdateProtocolConfigArgs,
    ) -> Result<()> {
        instructions::update_protocol_config::handler(ctx, args)
    }

    /// Treasury rotation step 1/3 — stage a new treasury behind a
    /// `TREASURY_TIMELOCK_SECS` (7d) window. Reverts if locked or
    /// another proposal is already pending. Authority-only.
    pub fn propose_new_treasury(
        ctx: Context<ProposeNewTreasury>,
        args: ProposeNewTreasuryArgs,
    ) -> Result<()> {
        instructions::propose_new_treasury::handler(ctx, args)
    }

    /// Treasury rotation step 2/3 (optional) — abort a pending
    /// proposal before its eta. Authority-only.
    pub fn cancel_new_treasury(ctx: Context<CancelNewTreasury>) -> Result<()> {
        instructions::cancel_new_treasury::handler(ctx)
    }

    /// Treasury rotation step 3/3 — commit a pending proposal once
    /// its eta has passed. Anyone can crank (timelock is the gate).
    pub fn commit_new_treasury(ctx: Context<CommitNewTreasury>) -> Result<()> {
        instructions::commit_new_treasury::handler(ctx)
    }

    /// One-way kill switch — once called, treasury cannot be rotated
    /// again (existing pending proposals still commit). Authority-only.
    pub fn lock_treasury(ctx: Context<LockTreasury>) -> Result<()> {
        instructions::lock_treasury::handler(ctx)
    }

    /// Authority rotation step 1/3 — stage a new protocol authority
    /// behind a `TREASURY_TIMELOCK_SECS` (7d) window. Mirrors the
    /// treasury propose/commit pattern (#122). At mainnet Squads
    /// ceremony, this is the bootstrap from deployer → multisig
    /// vault PDA. Reverts if another proposal is already pending.
    /// Authority-only.
    pub fn propose_new_authority(
        ctx: Context<ProposeNewAuthority>,
        args: ProposeNewAuthorityArgs,
    ) -> Result<()> {
        instructions::propose_new_authority::handler(ctx, args)
    }

    /// Authority rotation step 2/3 (optional) — abort a pending
    /// authority proposal before its eta. Authority-only.
    pub fn cancel_new_authority(ctx: Context<CancelNewAuthority>) -> Result<()> {
        instructions::cancel_new_authority::handler(ctx)
    }

    /// Authority rotation step 3/3 — commit a pending authority
    /// proposal once its eta has passed. Anyone can crank (timelock
    /// is the gate). After commit, the new authority controls every
    /// authority-gated ix.
    pub fn commit_new_authority(ctx: Context<CommitNewAuthority>) -> Result<()> {
        instructions::commit_new_authority::handler(ctx)
    }

    /// One-way kill switch — once called, `approved_yield_adapter`
    /// cannot be changed (mirrors `lock_treasury` for the adapter
    /// allowlist). Authority-only, idempotent. Governance hardening
    /// for the canary-rampup → mainnet-pinned transition.
    pub fn lock_approved_yield_adapter(
        ctx: Context<LockApprovedYieldAdapter>,
    ) -> Result<()> {
        instructions::lock_approved_yield_adapter::handler(ctx)
    }

    pub fn pause(ctx: Context<Pause>, args: PauseArgs) -> Result<()> {
        instructions::pause::handler(ctx, args)
    }

    /// Dev-only smoke instruction; retained until Step 10 deprecates it.
    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("roundfi-core: ping");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping<'info> {
    pub signer: Signer<'info>,
}
