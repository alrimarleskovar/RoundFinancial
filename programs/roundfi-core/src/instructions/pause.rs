//! `pause(paused)` — authority-only emergency stop.
//!
//! When paused (`config.paused = true`), user-facing instructions that
//! move funds or mutate pool state short-circuit with `ProtocolPaused`:
//!   create_pool, join_pool, contribute, claim_payout, release_escrow,
//!   deposit_idle_to_yield, harvest_yield, escape_valve_list,
//!   escape_valve_buy.
//!
//! Crucially, `settle_default` intentionally BYPASSES the pause flag
//! (see its handler). A paused protocol must never create a path where
//! funds can be locked indefinitely — defaults must still be settleable.
//!
//! Separated from `update_protocol_config` so a read of the program's
//! IDL immediately tells an auditor "this is the emergency-stop lever".

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PauseArgs {
    pub paused: bool,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = authority.key() == config.authority @ RoundfiError::Unauthorized,
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<Pause>, args: PauseArgs) -> Result<()> {
    let cfg = &mut ctx.accounts.config;
    cfg.paused = args.paused;
    msg!("roundfi-core: pause set paused={}", args.paused);
    Ok(())
}
