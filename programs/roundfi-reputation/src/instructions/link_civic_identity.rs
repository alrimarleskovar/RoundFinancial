//! `link_civic_identity` — validate a Civic gateway token and create (or
//! update) the caller's `IdentityRecord` with `provider = Civic`.
//!
//! The validator in `identity::civic::validate_civic_token` is UNTRUSTED
//! by construction — we only write `Verified` when every structural
//! check passes. Expired / Revoked results write the corresponding
//! status (so indexers can see the reason), but NEVER `Verified`.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::identity::{validate_civic_token, CivicStatus};
use crate::state::{IdentityProvider, IdentityRecord, IdentityStatus, ReputationConfig};

#[derive(Accounts)]
pub struct LinkCivicIdentity<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,

    #[account(
        seeds = [SEED_REP_CONFIG],
        bump = config.bump,
        constraint = !config.paused @ ReputationError::Unauthorized,
    )]
    pub config: Account<'info, ReputationConfig>,

    #[account(
        init_if_needed,
        payer = wallet,
        space = IdentityRecord::LEN,
        seeds = [SEED_IDENTITY, wallet.key().as_ref()],
        bump,
    )]
    pub identity: Account<'info, IdentityRecord>,

    /// CHECK: untrusted — validated byte-by-byte below.
    pub gateway_token: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<LinkCivicIdentity>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let cfg = &ctx.accounts.config;

    let view = validate_civic_token(
        &ctx.accounts.gateway_token.to_account_info(),
        &cfg.civic_gateway_program,
        &cfg.civic_network,
        &ctx.accounts.wallet.key(),
        now,
    )?;

    // If an existing record already has Civic linked with the same token,
    // reject — force an explicit refresh/unlink cycle for clarity.
    let existing = &ctx.accounts.identity;
    if existing.provider == IdentityProvider::Civic as u8
        && existing.gateway_token == ctx.accounts.gateway_token.key()
        && existing.status == IdentityStatus::Verified as u8
    {
        return Err(error!(ReputationError::IdentityAlreadyLinked));
    }

    let rec = &mut ctx.accounts.identity;
    rec.wallet   = ctx.accounts.wallet.key();
    rec.provider = IdentityProvider::Civic as u8;
    rec.gateway_token = ctx.accounts.gateway_token.key();
    rec.bump     = ctx.bumps.identity;
    rec._padding = [0; 13];

    match view.status {
        CivicStatus::Active { expires_at } => {
            rec.status      = IdentityStatus::Verified as u8;
            rec.verified_at = now;
            rec.expires_at  = expires_at;
        }
        CivicStatus::Expired => {
            rec.status      = IdentityStatus::Expired as u8;
            rec.verified_at = 0;
            rec.expires_at  = 0;
        }
        CivicStatus::Revoked => {
            rec.status      = IdentityStatus::Revoked as u8;
            rec.verified_at = 0;
            rec.expires_at  = 0;
        }
    };

    msg!(
        "roundfi-reputation: link_civic wallet={} status={} token={}",
        rec.wallet, rec.status, rec.gateway_token,
    );
    Ok(())
}
