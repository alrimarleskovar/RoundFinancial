//! `link_passport_identity` — validate a Human Passport attestation
//! (written by the off-chain bridge service) and create (or update)
//! the caller's `IdentityRecord` with `provider = HumanPassport`.
//!
//! The validator in `identity::passport::validate_passport_attestation`
//! is UNTRUSTED by construction — we only write `Verified` when every
//! structural check passes. Expired / Revoked results write the
//! corresponding status (so indexers can see the reason), but NEVER
//! `Verified`.
//!
//! Provider context: post-Civic-sunset (#227), Human Passport is the
//! Phase 1/canary PoP gate. The on-chain ix is byte-compatible with
//! the original `link_civic_identity` — only the bridge service
//! issuing the attestations changed. See `identity/passport.rs` for
//! the architecture rationale.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::identity::{validate_passport_attestation, PassportStatus};
use crate::state::{IdentityProvider, IdentityRecord, IdentityStatus, ReputationConfig};

#[derive(Accounts)]
pub struct LinkPassportIdentity<'info> {
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

    /// CHECK: untrusted — validated byte-by-byte below. Expected to be
    /// the 83-byte attestation account written by the off-chain bridge
    /// service under `config.passport_attestation_authority`.
    pub gateway_token: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<LinkPassportIdentity>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let cfg = &ctx.accounts.config;

    let view = validate_passport_attestation(
        &ctx.accounts.gateway_token.to_account_info(),
        &cfg.passport_attestation_authority,
        &cfg.passport_network,
        &ctx.accounts.wallet.key(),
        now,
    )?;

    // If an existing record already has HumanPassport linked with the
    // same attestation account, reject — force an explicit
    // refresh/unlink cycle for clarity.
    let existing = &ctx.accounts.identity;
    if existing.provider == IdentityProvider::HumanPassport as u8
        && existing.gateway_token == ctx.accounts.gateway_token.key()
        && existing.status == IdentityStatus::Verified as u8
    {
        return Err(error!(ReputationError::IdentityAlreadyLinked));
    }

    let rec = &mut ctx.accounts.identity;
    rec.wallet   = ctx.accounts.wallet.key();
    rec.provider = IdentityProvider::HumanPassport as u8;
    rec.gateway_token = ctx.accounts.gateway_token.key();
    rec.bump     = ctx.bumps.identity;
    rec._padding = [0; 13];

    match view.status {
        PassportStatus::Active { expires_at } => {
            rec.status      = IdentityStatus::Verified as u8;
            rec.verified_at = now;
            rec.expires_at  = expires_at;
        }
        PassportStatus::Expired => {
            rec.status      = IdentityStatus::Expired as u8;
            rec.verified_at = 0;
            rec.expires_at  = 0;
        }
        PassportStatus::Revoked => {
            rec.status      = IdentityStatus::Revoked as u8;
            rec.verified_at = 0;
            rec.expires_at  = 0;
        }
    };

    msg!(
        "roundfi-reputation: link_passport wallet={} status={} attestation={}",
        rec.wallet, rec.status, rec.gateway_token,
    );
    Ok(())
}
