//! `set_identity_gate` — authority-gated setter for the SEV-047 identity gate.
//!
//! `init_if_needed` creates the singleton `IdentityGateConfig` PDA on the first
//! call and updates `required_min_level` on subsequent calls. Authority is
//! re-checked against the LIVE `ReputationConfig.authority` every call, so an
//! authority rotation (propose/commit) is honored without touching this PDA.
//!
//! Default behaviour is OFF: until an authority calls this with a non-zero
//! `required_min_level`, no level requires identity — devnet / Canary are
//! unaffected. Enable (`required_min_level = 2` or `3`) only for mainnet.
//!
//! NOTE (deploy ordering): the gate is enforced in `promote_level`, which
//! loads this PDA. On a deployment where the PDA does not yet exist, run
//! `set_identity_gate` once (with `required_min_level = 0` to keep it off)
//! before relying on `promote_level`. Fresh deployments can call this as part
//! of protocol setup.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::{IdentityGateConfig, ReputationConfig};

#[derive(Accounts)]
pub struct SetIdentityGate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [SEED_REP_CONFIG],
        bump = config.bump,
        constraint = config.authority == authority.key() @ ReputationError::Unauthorized,
    )]
    pub config: Account<'info, ReputationConfig>,

    #[account(
        init_if_needed,
        payer = authority,
        space = IdentityGateConfig::LEN,
        seeds = [SEED_IDENTITY_GATE],
        bump,
    )]
    pub identity_gate: Account<'info, IdentityGateConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SetIdentityGate>, required_min_level: u8) -> Result<()> {
    // Valid values: 0 (disabled) or a real tier floor in 2..=LEVEL_MAX.
    // A floor of 1 would be nonsensical (it would cap unverified subjects
    // below LEVEL_MIN, since level 1 is the floor for everyone).
    require!(
        required_min_level == 0 || (2..=LEVEL_MAX).contains(&required_min_level),
        ReputationError::LevelThresholdNotMet,
    );

    let gate = &mut ctx.accounts.identity_gate;
    gate.authority = ctx.accounts.config.authority;
    gate.required_min_level = required_min_level;
    gate.bump = ctx.bumps.identity_gate;

    msg!(
        "roundfi-reputation: set_identity_gate authority={} required_min_level={}",
        gate.authority,
        required_min_level,
    );
    Ok(())
}
