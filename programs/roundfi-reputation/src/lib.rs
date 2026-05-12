//! RoundFi Reputation program.
//!
//! SAS-compatible attestation service, permissionless reputation ladder,
//! and modular/optional identity layer (Civic Pass + future providers).
//!
//! Account layout mirrors the official Solana Attestation Service schema
//! so Mainnet migration is a program-ID swap, not a data migration.
//!
//! Step 4d scope (locked 2026-04-22):
//!   - `ReputationConfig`, `ReputationProfile`, `Attestation`,
//!     `IdentityRecord` state accounts.
//!   - `initialize_reputation`, `update_reputation_config`,
//!     `init_profile`, `attest`, `revoke`, `promote_level`,
//!     `link_civic_identity`, `refresh_identity`, `unlink_identity`
//!     instructions.
//!   - Anti-gaming rules: cycle-complete cooldown, sybil-hint halving,
//!     default stickiness, permissionless promotion.
//!   - Identity providers treated as UNTRUSTED — Civic gateway-token
//!     accounts are validated byte-by-byte with no reliance on the
//!     external program's Anchor traits.

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod identity;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use error::ReputationError;
pub use instructions::*;
pub use state::*;

declare_id!("Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2");

#[program]
pub mod roundfi_reputation {
    use super::*;

    pub fn initialize_reputation(
        ctx: Context<InitializeReputation>,
        args: InitializeReputationArgs,
    ) -> Result<()> {
        instructions::initialize_reputation::handler(ctx, args)
    }

    pub fn update_reputation_config(
        ctx: Context<UpdateReputationConfig>,
        args: UpdateReputationConfigArgs,
    ) -> Result<()> {
        instructions::update_reputation_config::handler(ctx, args)
    }

    pub fn init_profile(ctx: Context<InitProfile>, wallet: Pubkey) -> Result<()> {
        instructions::init_profile::handler(ctx, wallet)
    }

    pub fn attest(ctx: Context<Attest>, args: AttestArgs) -> Result<()> {
        instructions::attest::handler(ctx, args)
    }

    pub fn revoke(ctx: Context<Revoke>) -> Result<()> {
        instructions::revoke::handler(ctx)
    }

    pub fn promote_level(ctx: Context<PromoteLevel>) -> Result<()> {
        instructions::promote_level::handler(ctx)
    }

    pub fn link_civic_identity(ctx: Context<LinkCivicIdentity>) -> Result<()> {
        instructions::link_civic_identity::handler(ctx)
    }

    pub fn refresh_identity(ctx: Context<RefreshIdentity>) -> Result<()> {
        instructions::refresh_identity::handler(ctx)
    }

    pub fn unlink_identity(ctx: Context<UnlinkIdentity>) -> Result<()> {
        instructions::unlink_identity::handler(ctx)
    }

    /// Public read-only view (Step 4f). Returns a `ProfileSnapshot`
    /// via both an anchor event and `set_return_data`, so off-chain
    /// consumers (B2B score API, indexers) and on-chain composers
    /// (partner programs CPIing into this view) share one canonical
    /// read surface.
    pub fn get_profile(ctx: Context<GetProfile>) -> Result<()> {
        instructions::get_profile::handler(ctx)
    }

    /// Dev-only smoke instruction; retained until Step 10 deprecates it.
    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("roundfi-reputation: ping");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping<'info> {
    pub signer: Signer<'info>,
}
