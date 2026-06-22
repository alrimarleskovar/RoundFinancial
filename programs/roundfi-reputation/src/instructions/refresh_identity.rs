//! `refresh_identity` — permissionless re-read of a Human Passport
//! attestation account.
//!
//! Anyone may call — there's no harm, since the only possible outcomes
//! are:
//!   - attestation still Active & unexpired → no-op (timestamp updated)
//!   - attestation Expired / Revoked / Frozen → status flipped
//! A stale `Verified` record is a soft-security issue (it lets an
//! unverified wallet enjoy the sybil-hint bonus), so making refresh
//! cost-free and open to indexers is load-bearing.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::identity::{validate_passport_attestation, PassportStatus};
use crate::state::{
    IdentityGateConfig, IdentityProvider, IdentityRecord, IdentityStatus, ReputationConfig,
    ReputationProfile,
};

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
        constraint = identity.provider == IdentityProvider::HumanPassport as u8
            @ ReputationError::UnauthorizedProvider,
    )]
    pub identity: Account<'info, IdentityRecord>,

    /// SEV-E: identity-gate policy (singleton, REQUIRED so the floor can't be
    /// bypassed by omitting the account — mirrors `promote_level`). Supplies
    /// `required_min_level` for the demotion below. With `required_min_level
    /// == 0` only the elite hard floor (L4) bites.
    #[account(
        seeds = [SEED_IDENTITY_GATE],
        bump = identity_gate.bump,
    )]
    pub identity_gate: Account<'info, IdentityGateConfig>,

    /// SEV-E: the subject's reputation profile. Optional — `None` when the
    /// wallet verified identity but never built a profile (no pool joined yet);
    /// there is then no stored level to demote. When present and this refresh
    /// leaves the subject unverified, its `level` is re-capped to the identity
    /// floor so a later `join_pool` can't consume a stale identity-backed tier.
    #[account(
        mut,
        seeds = [SEED_PROFILE, subject.key().as_ref()],
        bump,
    )]
    pub profile: Option<Account<'info, ReputationProfile>>,

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

    let view = validate_passport_attestation(
        &ctx.accounts.gateway_token.to_account_info(),
        &cfg.passport_attestation_authority,
        &cfg.passport_network,
        &ctx.accounts.subject.key(),
        now,
    );

    match view {
        Ok(v) => match v.status {
            PassportStatus::Active { expires_at } => {
                rec.status = IdentityStatus::Verified as u8;
                rec.verified_at = now;
                rec.expires_at = expires_at;
            }
            PassportStatus::Expired => {
                rec.status = IdentityStatus::Expired as u8;
            }
            PassportStatus::Revoked => {
                rec.status = IdentityStatus::Revoked as u8;
            }
        },
        Err(e) => {
            // Adevar Labs SEV-028 fix: log the underlying error
            // before flipping to Revoked. Previously the error was
            // discarded as `Err(_)` — operators / monitoring couldn't
            // distinguish between "user was actually revoked" and
            // "bridge service had a config drift" (e.g. network
            // pubkey mismatch, layout shift, owner spoof attempt).
            // Both ended up flipping the record to Revoked silently.
            //
            // Now: emit the error code via msg! so off-chain monitors
            // can alert on structural failures vs. genuine revocations.
            // Behavior unchanged — Revoked is still the conservative
            // outcome; the diff is observability.
            msg!(
                "roundfi-reputation: refresh_identity validation failed subject={} reason={:?} — flipping Revoked",
                rec.wallet, e,
            );
            rec.status = IdentityStatus::Revoked as u8;
        }
    };

    msg!(
        "roundfi-reputation: refresh_identity subject={} status={}",
        rec.wallet, rec.status,
    );

    // SEV-E: keep `profile.level` honest with the identity floor. If this
    // refresh leaves the subject NOT verified (expired / revoked / structural
    // failure → Revoked), re-apply the identity cap to the stored level so a
    // later `join_pool` can't consume a stale identity-backed tier. `core`
    // reads `profile.level` but MUST NOT read the IdentityRecord (the boundary
    // in `state/identity.rs`), so the snapshot has to be corrected on this
    // side. Profile is optional — a verified wallet that never joined a pool
    // has no level to demote.
    if !ctx.accounts.identity.is_verified(now) {
        if let Some(profile) = ctx.accounts.profile.as_mut() {
            let floor = ctx.accounts.identity_gate.required_min_level;
            if profile.demote_to_identity_floor(floor, now) {
                msg!(
                    "roundfi-reputation: refresh_identity identity-floor demotion subject={} level={}",
                    profile.wallet,
                    profile.level,
                );
            }
        }
    }

    Ok(())
}
