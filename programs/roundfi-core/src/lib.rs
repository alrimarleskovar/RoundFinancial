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
//! Step 4c: yield deposit/harvest, settle_default, escape valve, close.

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

declare_id!("11111111111111111111111111111111");

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
