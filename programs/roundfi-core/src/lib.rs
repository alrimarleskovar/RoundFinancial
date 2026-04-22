//! RoundFi Core program.
//!
//! Owns the ROSCA pool state machine, adaptive escrow, solidarity vault,
//! seed-draw invariant, yield routing and position-NFT orchestration.
//!
//! Business logic lands in Step 4; this is the devnet scaffold.

use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111");

#[program]
pub mod roundfi_core {
    use super::*;

    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("roundfi-core: scaffold alive");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping<'info> {
    pub signer: Signer<'info>,
}
