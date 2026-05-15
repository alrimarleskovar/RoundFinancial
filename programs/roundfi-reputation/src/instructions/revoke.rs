//! `revoke` — marks an attestation revoked and *reverses* its score
//! delta so the profile stays consistent.
//!
//! Authorization: only the original issuer may revoke their own
//! attestation (checked on stored `attestation.issuer == signer`).
//! The config authority is NOT automatically allowed to revoke —
//! this preserves the "no admin override" property of the ladder.
//!
//! **Adevar Labs SEV-008 fix:** the score-reversal weight is read
//! from `attestation.verified_at_attest` (stored at attest time),
//! not from the subject's CURRENT identity status. Without this,
//! a subject who passed unverified → verified between attest and
//! revoke would have their score over-reversed: apply with
//! weight 1/2, revoke with weight 2/2 → score goes negative.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::{Attestation, ReputationProfile};

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

    // Adevar Labs SEV-008 fix: identity account removed — revoke uses
    // the at-attest-time verified flag stored on the attestation
    // itself, not the current identity status. The account was kept
    // optional before this fix but never reliably; removing it
    // simplifies the call site.

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

    // Adevar Labs SEV-008 fix: read at-attest-time verified flag
    // from the attestation itself, NOT from the subject's current
    // identity. This guarantees apply + revoke is exactly zero-sum
    // regardless of identity-status changes between the two ix.
    let verified = att.verified_at_attest;
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
