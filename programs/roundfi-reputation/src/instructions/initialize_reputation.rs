//! `initialize_reputation` — one-time singleton init of `ReputationConfig`.
//!
//! Pins the FROZEN fields:
//!   - `roundfi_core_program`   (issuer program ID)
//!   - `civic_gateway_program`  (Civic Networks program ID)
//! Mutable later via `update_reputation_config`:
//!   - `authority`, `civic_network`, `paused`.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::state::ReputationConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeReputationArgs {
    pub roundfi_core_program:   Pubkey,
    pub civic_gateway_program:  Pubkey,
    pub civic_network:          Pubkey,
}

#[derive(Accounts)]
pub struct InitializeReputation<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = ReputationConfig::LEN,
        seeds = [SEED_REP_CONFIG],
        bump,
    )]
    pub config: Account<'info, ReputationConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeReputation>, args: InitializeReputationArgs) -> Result<()> {
    let cfg = &mut ctx.accounts.config;
    cfg.authority             = ctx.accounts.authority.key();
    cfg.roundfi_core_program  = args.roundfi_core_program;
    cfg.civic_gateway_program = args.civic_gateway_program;
    cfg.civic_network         = args.civic_network;
    cfg.paused                = false;
    cfg.bump                  = ctx.bumps.config;
    cfg._padding              = [0; 30];

    msg!(
        "roundfi-reputation: initialized authority={} core={} civic_prog={} civic_net={}",
        cfg.authority, cfg.roundfi_core_program, cfg.civic_gateway_program, cfg.civic_network,
    );
    Ok(())
}
