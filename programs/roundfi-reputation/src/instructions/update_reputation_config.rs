//! `update_reputation_config` — admin patch for mutable fields.
//!
//! FROZEN fields: `roundfi_core_program`, `civic_gateway_program`.
//! Mutable:       `authority` (rotation), `civic_network`, `paused`.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::ReputationConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct UpdateReputationConfigArgs {
    pub new_authority:    Option<Pubkey>,
    pub new_civic_network: Option<Pubkey>,
    pub new_paused:       Option<bool>,
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
    if let Some(n) = args.new_civic_network {
        cfg.civic_network = n;
    }
    if let Some(p) = args.new_paused {
        cfg.paused = p;
    }

    msg!(
        "roundfi-reputation: config updated authority={} civic_net={} paused={}",
        cfg.authority, cfg.civic_network, cfg.paused,
    );
    Ok(())
}
