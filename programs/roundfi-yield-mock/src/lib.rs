//! RoundFi Yield Adapter — mock implementation.
//!
//! Devnet default. Exposes the same instruction discriminators and
//! `YieldVaultState` layout as `roundfi-yield-kamino`; accrual is
//! simulated off a configurable APY so pool lifecycles can be tested
//! end-to-end without depending on Kamino's Mainnet reserves.
//!
//! Business logic lands in Step 4; this is the devnet scaffold.

use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111");

#[program]
pub mod roundfi_yield_mock {
    use super::*;

    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("roundfi-yield-mock: scaffold alive");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping<'info> {
    pub signer: Signer<'info>,
}
