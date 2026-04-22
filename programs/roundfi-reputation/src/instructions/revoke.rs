//! `revoke` — marks an attestation revoked and *reverses* its score
//! delta so the profile stays consistent.
//!
//! Authorization: only the original issuer may revoke their own
//! attestation (checked on stored `attestation.issuer == signer`).
//! The config authority is NOT automatically allowed to revoke —
//! this preserves the "no admin override" property of the ladder.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::{Attestation, IdentityRecord, ReputationProfile};

#[derive(Accounts)]
pub struct Revoke<'info> {
    pub issuer: Signer<'info>,

    /// CHECK: only used to seed the profile PDA.
    pub subject: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_PROFILE, subject.key().as_ref()],
        bump = profile.bump,
    )]
    pub profile: Account<'info, ReputationProfile>,

    #[account(
        seeds = [SEED_IDENTITY, subject.key().as_ref()],
        bump,
    )]
    pub identity: Option<Account<'info, IdentityRecord>>,

    #[account(
        mut,
        seeds = [
            SEED_ATTESTATION,
            attestation.issuer.as_ref(),
            attestation.subject.as_ref(),
            &attestation.schema_id.to_le_bytes(),
            &attestation.nonce.to_le_bytes(),
        ],
        bump = attestation.bump,
        constraint = attestation.issuer == issuer.key() @ ReputationError::InvalidIssuer,
        constraint = attestation.subject == subject.key() @ ReputationError::InvalidIssuer,
        constraint = !attestation.revoked @ ReputationError::AttestationRevoked,
    )]
    pub attestation: Account<'info, Attestation>,
}

pub fn handler(ctx: Context<Revoke>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let profile = &mut ctx.accounts.profile;
    let att = &mut ctx.accounts.attestation;

    let verified = matches!(
        ctx.accounts.identity.as_ref(),
        Some(rec) if rec.is_verified(now)
    );
    let weight_num: i64 = if verified { 2 } else { 1 };
    let weight_den: i64 = 2;

    // Reverse the delta that `attest` applied. Symmetry with attest.rs.
    match att.schema_id {
        SCHEMA_PAYMENT => {
            let delta = SCORE_PAYMENT * weight_num / weight_den;
            profile.apply_score_delta(-delta);
            profile.on_time_payments = profile.on_time_payments.saturating_sub(1);
        }
        SCHEMA_LATE => {
            profile.apply_score_delta(-SCORE_LATE);
            profile.late_payments = profile.late_payments.saturating_sub(1);
        }
        SCHEMA_DEFAULT => {
            profile.apply_score_delta(-SCORE_DEFAULT);
            profile.defaults = profile.defaults.saturating_sub(1);
        }
        SCHEMA_CYCLE_COMPLETE => {
            let delta = SCORE_CYCLE_COMPLETE * weight_num / weight_den;
            profile.apply_score_delta(-delta);
            profile.cycles_completed = profile.cycles_completed.saturating_sub(1);
            profile.total_participated = profile.total_participated.saturating_sub(1);
            // Do NOT reset last_cycle_complete_at — that's an anti-gaming
            // lockout, not a score component. Resetting it would let a
            // malicious issuer circumvent the cooldown.
        }
        SCHEMA_LEVEL_UP => {}
        _ => return Err(error!(ReputationError::InvalidSchema)),
    };

    att.revoked = true;
    profile.last_updated_at = now;

    msg!(
        "roundfi-reputation: revoke schema={} subject={} new_score={}",
        att.schema_id, att.subject, profile.score,
    );
    Ok(())
}
