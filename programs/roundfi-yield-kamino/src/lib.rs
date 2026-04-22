//! RoundFi Yield Adapter — Kamino implementation.
//!
//! Mainnet replacement for `roundfi-yield-mock`. Must preserve the same
//! instruction discriminators and `YieldVaultState` account layout so
//! `roundfi-core` can swap adapters by pointing `Pool.yield_adapter`
//! at a different program without redeploying.
//!
//! Real Kamino CPI logic lands in a later phase — this file is a
//! placeholder so Anchor builds, tests and docs reference a stable ID.

use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111");

#[program]
pub mod roundfi_yield_kamino {
    use super::*;

    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("roundfi-yield-kamino: placeholder — Kamino CPI not yet wired");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping<'info> {
    pub signer: Signer<'info>,
}
