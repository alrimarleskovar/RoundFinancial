//! RoundFi Core program.
//!
//! Owns the ROSCA pool state machine, adaptive escrow, solidarity vault,
//! seed-draw invariant, yield routing and position-NFT orchestration.
//!
//! Step 4a scope: ProtocolConfig, Pool, Member + `initialize_protocol`,
//! `create_pool`, `join_pool`. Contribute/claim/escrow land in 4b;
//! yield + default + close in 4c.

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
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
