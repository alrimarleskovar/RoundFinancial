//! `update_reputation_config` — admin patch for mutable fields.
//!
//! FROZEN fields: `roundfi_core_program`, `passport_attestation_authority`.
//! Mutable:       `authority` (rotation), `passport_network`, `paused`.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::ReputationConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct UpdateReputationConfigArgs {
    /// **DEPRECATED — ignored at the handler level (Adevar Labs SEV-021).**
    ///
    /// Was previously the only path to rotate `config.authority` —
    /// no timelock, no public window, single-tx irreversible attack
    /// if the key was compromised. Now the rotation flows through
    /// `propose_new_reputation_authority` → 7d wait →
    /// `commit_new_reputation_authority`, mirror of core's
    /// authority rotation (PR #323).
    ///
    /// The field is retained for SDK back-compat (old encoders pass
    /// `Option<Pubkey>` at this offset). The handler ignores any
    /// value passed here and emits a warning if non-None so a stale
    /// SDK is visible in monitoring.
    pub new_authority:         Option<Pubkey>,
    /// Passport "network" scope rotation. Mutable so canary rampup can
    /// switch e.g. `passport-staging` → `passport-prod` without a
    /// program upgrade.
    pub new_passport_network:  Option<Pubkey>,
    pub new_paused:            Option<bool>,
}

#[derive(Accounts)]
pub struct UpdateReputationConfig<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_REP_CONFIG],
        bump = config.bump,
        constraint = config.authority == authority.key() @ ReputationError::Unauthorized,
    )]
    pub config: Account<'info, ReputationConfig>,
}

pub fn handler(
    ctx: Context<UpdateReputationConfig>,
    args: UpdateReputationConfigArgs,
) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    if let Some(_a) = args.new_authority {
        // Adevar Labs SEV-021 fix: authority rotation is no longer
        // performed here. Use propose_new_reputation_authority +
        // commit_new_reputation_authority (timelocked) instead.
        // We ignore the passed value but log so a stale SDK call is
        // visible in monitoring.
        msg!(
            "roundfi-reputation: WARN update_reputation_config.new_authority is DEPRECATED — \
             use propose_new_reputation_authority (SEV-021); ignored",
        );
    }
    if let Some(n) = args.new_passport_network {
        cfg.passport_network = n;
    }
    if let Some(p) = args.new_paused {
        cfg.paused = p;
    }

    msg!(
        "roundfi-reputation: config updated authority={} passport_net={} paused={}",
        cfg.authority, cfg.passport_network, cfg.paused,
    );
    Ok(())
}
