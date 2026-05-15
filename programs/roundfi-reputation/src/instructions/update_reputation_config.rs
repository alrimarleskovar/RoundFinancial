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

    if let Some(a) = args.new_authority {
        cfg.authority = a;
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
