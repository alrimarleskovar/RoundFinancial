//! RoundFi Reputation program.
//!
//! SAS-compatible attestation service and reputation-ladder arithmetic.
//! Its account layout is intentionally a 1-to-1 mirror of the official
//! Solana Attestation Service schema so Mainnet migration is a program-ID
//! swap, not a data migration.
//!
//! Business logic lands in Step 4; this is the devnet scaffold.

use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111");

#[program]
pub mod roundfi_reputation {
    use super::*;

    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("roundfi-reputation: scaffold alive");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping<'info> {
    pub signer: Signer<'info>,
}
