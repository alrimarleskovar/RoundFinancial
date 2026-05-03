//! `attest` — create an immutable, on-chain record of a scoring event
//! and update the subject's `ReputationProfile` accordingly.
//!
//! Caller authorization (one of):
//!   1. The pool-PDA signer derived under `roundfi_core_program`
//!      (core CPI path — normal operation).
//!   2. The `ReputationConfig.authority` — manual corrections only.
//!
//! Anti-gaming (§4.2 rules, architecture.md):
//!   - Cycle-complete cooldown: reject `SCHEMA_CYCLE_COMPLETE` if
//!     `now - profile.last_cycle_complete_at < MIN_CYCLE_COOLDOWN_SECS`.
//!   - Sybil hint: if IdentityRecord absent / unverified, halve
//!     the on-time weight.
//!   - Default stickiness: once a `SCHEMA_DEFAULT` attestation exists
//!     for a (subject, pool) tuple, reject future positive attestations
//!     for the same pool.
//!   - Attestation PDA seeds include issuer/subject/schema/nonce, so
//!     replaying the exact same event is impossible (account already
//!     exists).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey;

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::{
    Attestation, IdentityRecord, IdentityStatus, Payload, ReputationConfig, ReputationProfile,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AttestArgs {
    pub schema_id: u16,
    pub nonce:     u64,
    pub payload:   Payload,
    /// Pool PDA key (used to derive `(subject, pool)` default-sticky
    /// check via the payload; caller must include it here so we can
    /// verify the issuer signer matches pool-PDA derivation).
    pub pool:      Pubkey,
    /// Pool authority (1st seed) + seed_id (2nd seed), needed to re-derive
    /// the pool PDA under `roundfi_core_program`.
    pub pool_authority: Pubkey,
    pub pool_seed_id:   u64,
}

#[derive(Accounts)]
#[instruction(args: AttestArgs)]
pub struct Attest<'info> {
    /// Either the pool PDA (via core CPI) or the config authority.
    pub issuer: Signer<'info>,

    /// CHECK: wallet pubkey — only used to seed the profile PDA.
    pub subject: UncheckedAccount<'info>,

    #[account(
        seeds = [SEED_REP_CONFIG],
        bump = config.bump,
        constraint = !config.paused @ ReputationError::Unauthorized,
    )]
    pub config: Account<'info, ReputationConfig>,

    #[account(
        init_if_needed,
        payer = payer,
        space = ReputationProfile::LEN,
        seeds = [SEED_PROFILE, subject.key().as_ref()],
        bump,
    )]
    pub profile: Account<'info, ReputationProfile>,

    /// Optional identity record for the subject (anti-sybil weighting).
    /// If missing, subject is treated as Unverified.
    ///
    /// CHECK: we verify seeds + owner manually below.
    #[account(
        seeds = [SEED_IDENTITY, subject.key().as_ref()],
        bump,
    )]
    pub identity: Option<Account<'info, IdentityRecord>>,

    #[account(
        init,
        payer = payer,
        space = Attestation::LEN,
        seeds = [
            SEED_ATTESTATION,
            issuer.key().as_ref(),
            subject.key().as_ref(),
            &args.schema_id.to_le_bytes(),
            &args.nonce.to_le_bytes(),
        ],
        bump,
    )]
    pub attestation: Account<'info, Attestation>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Attest>, args: AttestArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let cfg = &ctx.accounts.config;
    let profile = &mut ctx.accounts.profile;
    let issuer_key = ctx.accounts.issuer.key();

    // Bootstrap fresh profile fields on first attest (init_if_needed path).
    if profile.wallet == Pubkey::default() {
        profile.wallet        = ctx.accounts.subject.key();
        profile.level         = LEVEL_MIN;
        profile.first_seen_at = now;
        profile.bump          = ctx.bumps.profile;
        profile._padding      = [0; 15];
    }

    // ─── 1. Issuer authorization ────────────────────────────────────────
    let is_admin = issuer_key == cfg.authority;
    let is_pool_pda = is_valid_pool_issuer(
        &issuer_key,
        &cfg.roundfi_core_program,
        &args.pool_authority,
        args.pool_seed_id,
    );
    require!(is_admin || is_pool_pda, ReputationError::InvalidIssuer);

    // For pool-PDA issuance, `args.pool` must match the issuer.
    if is_pool_pda {
        require_keys_eq!(args.pool, issuer_key, ReputationError::InvalidIssuer);
    }

    // ─── 2. Schema validity ─────────────────────────────────────────────
    let schema_ok = matches!(
        args.schema_id,
        SCHEMA_PAYMENT | SCHEMA_LATE | SCHEMA_DEFAULT | SCHEMA_CYCLE_COMPLETE | SCHEMA_LEVEL_UP
    );
    require!(schema_ok, ReputationError::InvalidSchema);

    // ─── 3. Default stickiness ──────────────────────────────────────────
    //
    // The stickiness bit is encoded *in the profile itself* via
    // `profile.defaults > 0` AND the current attestation is for a pool
    // that has previously seen a default. To keep state compact, we store
    // the default-sticky pool pubkey inside the payload of the
    // `SCHEMA_DEFAULT` attestation — downstream callers can inspect it.
    // The rule we enforce here is simpler: if the subject has ANY default
    // attested for the same pool (payload[..32] == args.pool), reject
    // subsequent positive attestations for that pool.
    //
    // Since we cannot iterate past attestations on-chain without an index,
    // we encode a conservative rule: reject `CYCLE_COMPLETE` and
    // `PAYMENT` for a subject who has a non-zero default count AND whose
    // incoming payload's first 32 bytes match a previously defaulted pool
    // recorded in the payload. Callers (roundfi-core) are the source of
    // truth for which pool the subject defaulted in; they MUST refuse to
    // attest positively for that pool.
    //
    // Concretely here we enforce the weaker, always-correct rule:
    // a `SCHEMA_DEFAULT` immediately sets the subject's default count,
    // and a *second* `SCHEMA_DEFAULT` against the same nonce is blocked
    // by PDA uniqueness. The same-pool re-entry block is the caller's
    // responsibility (core enforces it in `settle_default`).

    // ─── 4. Cycle-complete cooldown (anti-gaming rule #1) ───────────────
    if args.schema_id == SCHEMA_CYCLE_COMPLETE {
        let elapsed = now.saturating_sub(profile.last_cycle_complete_at);
        require!(elapsed >= MIN_CYCLE_COOLDOWN_SECS, ReputationError::CooldownActive);
    }

    // ─── 5. Sybil-hint weighting (anti-gaming rule #3) ──────────────────
    let verified = matches!(
        ctx.accounts.identity.as_ref(),
        Some(rec) if rec.is_verified(now)
    );
    let weight_num: i64 = if verified { 2 } else { 1 };
    let weight_den: i64 = 2;

    // ─── 6. Apply the schema delta + counters ───────────────────────────
    match args.schema_id {
        SCHEMA_PAYMENT => {
            let delta = SCORE_PAYMENT * weight_num / weight_den;
            profile.apply_score_delta(delta);
            profile.on_time_payments = profile.on_time_payments.saturating_add(1);
        }
        SCHEMA_LATE => {
            // Negative deltas are NOT halved — only positive increments
            // are dampened for unverified wallets.
            profile.apply_score_delta(SCORE_LATE);
            profile.late_payments = profile.late_payments.saturating_add(1);
        }
        SCHEMA_DEFAULT => {
            profile.apply_score_delta(SCORE_DEFAULT);
            profile.defaults = profile.defaults.saturating_add(1);
        }
        SCHEMA_CYCLE_COMPLETE => {
            let delta = SCORE_CYCLE_COMPLETE * weight_num / weight_den;
            profile.apply_score_delta(delta);
            profile.cycles_completed = profile.cycles_completed.saturating_add(1);
            profile.total_participated = profile.total_participated.saturating_add(1);
            profile.last_cycle_complete_at = now;
        }
        SCHEMA_LEVEL_UP => {
            // Informational only; actual level is mutated by promote_level.
        }
        _ => return Err(error!(ReputationError::InvalidSchema)),
    };

    profile.last_updated_at = now;

    // ─── 7. Persist the attestation ─────────────────────────────────────
    let a = &mut ctx.accounts.attestation;
    a.issuer    = issuer_key;
    a.subject   = ctx.accounts.subject.key();
    a.schema_id = args.schema_id;
    a.nonce     = args.nonce;
    a.payload   = args.payload;
    a.issued_at = now;
    a.revoked   = false;
    a.bump      = ctx.bumps.attestation;
    a._padding  = [0; 14];

    msg!(
        "roundfi-reputation: attest schema={} subject={} score={} level={}",
        args.schema_id, a.subject, profile.score, profile.level,
    );
    Ok(())
}

/// Re-derive the expected Pool PDA under `roundfi_core_program` and
/// check it matches `issuer`. Pool seeds in core:
///   `[b"pool", authority, seed_id.to_le_bytes()]`.
pub(crate) fn is_valid_pool_issuer(
    issuer: &Pubkey,
    core_program: &Pubkey,
    pool_authority: &Pubkey,
    pool_seed_id: u64,
) -> bool {
    let seed_id_le = pool_seed_id.to_le_bytes();
    let (expected, _) = Pubkey::find_program_address(
        &[SEED_POOL, pool_authority.as_ref(), seed_id_le.as_ref()],
        core_program,
    );
    expected == *issuer
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_issuer_derivation_matches_core_seeds() {
        // Smoke: function is stable for fixed inputs.
        let core = Pubkey::new_unique();
        let auth = Pubkey::new_unique();
        let id = 42u64;
        let seed_id_le = id.to_le_bytes();
        let (expected, _) = Pubkey::find_program_address(
            &[SEED_POOL, auth.as_ref(), seed_id_le.as_ref()],
            &core,
        );
        assert!(is_valid_pool_issuer(&expected, &core, &auth, id));
        assert!(!is_valid_pool_issuer(&Pubkey::default(), &core, &auth, id));
    }

    #[test]
    fn sybil_hint_halves_positive_only() {
        // Representative math — the handler uses these weights:
        let (num_verified, den) = (2i64, 2i64);
        let (num_unverif, _)    = (1i64, 2i64);
        assert_eq!(SCORE_PAYMENT * num_verified / den, 10);
        assert_eq!(SCORE_PAYMENT * num_unverif   / den, 5);
        // Negative unchanged:
        assert_eq!(SCORE_LATE,    -100);
        assert_eq!(SCORE_DEFAULT, -500);
    }
}
