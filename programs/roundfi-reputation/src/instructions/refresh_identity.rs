//! `refresh_identity` — permissionless re-read of a Civic gateway token.
//!
//! Anyone may call — there's no harm, since the only possible outcomes
//! are:
//!   - token still Active & unexpired → no-op (timestamp updated)
//!   - token Expired / Revoked / Frozen → status flipped accordingly
//! A stale `Verified` record is a soft-security issue (it lets an
//! unverified wallet enjoy the sybil-hint bonus), so making refresh
//! cost-free and open to indexers is load-bearing.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::identity::{validate_civic_token, CivicStatus};
use crate::state::{IdentityProvider, IdentityRecord, IdentityStatus, ReputationConfig};

#[derive(Accounts)]
pub struct RefreshIdentity<'info> {
    /// CHECK: only used to seed the identity PDA.
    pub subject: UncheckedAccount<'info>,

    #[account(
        seeds = [SEED_REP_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, ReputationConfig>,

    #[account(
        mut,
        seeds = [SEED_IDENTITY, subject.key().as_ref()],
        bump = identity.bump,
        constraint = identity.provider == IdentityProvider::Civic as u8
            @ ReputationError::UnauthorizedProvider,
    )]
    pub identity: Account<'info, IdentityRecord>,

    /// CHECK: untrusted — validated byte-by-byte.
    pub gateway_token: UncheckedAccount<'info>,

    pub caller: Signer<'info>,
}

pub fn handler(ctx: Context<RefreshIdentity>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let cfg = &ctx.accounts.config;
    let rec = &mut ctx.accounts.identity;

    // The gateway token passed in must be the one we previously linked;
    // otherwise a refresher could substitute a different Active token
    // for an unrelated wallet and artificially extend the verification.
    require_keys_eq!(
        rec.gateway_token,
        ctx.accounts.gateway_token.key(),
        ReputationError::InvalidIdentityProof
    );

    let view = validate_civic_token(
        &ctx.accounts.gateway_token.to_account_info(),
        &cfg.civic_gateway_program,
        &cfg.civic_network,
        &ctx.accounts.subject.key(),
        now,
    );

    match view {
        Ok(v) => match v.status {
            CivicStatus::Active { expires_at } => {
                rec.status = IdentityStatus::Verified as u8;
                rec.verified_at = now;
                rec.expires_at = expires_at;
            }
            CivicStatus::Expired => {
                rec.status = IdentityStatus::Expired as u8;
            }
            CivicStatus::Revoked => {
                rec.status = IdentityStatus::Revoked as u8;
            }
        },
        Err(_) => {
            // Structural failure (e.g. Civic program revoked the account
            // or layout changed). Mark Revoked conservatively rather
            // than propagating the error — we don't want a torn state
            // where an indexer can never reach the failure path.
            rec.status = IdentityStatus::Revoked as u8;
        }
    };

    msg!(
        "roundfi-reputation: refresh_identity subject={} status={}",
        rec.wallet, rec.status,
    );
    Ok(())
}
