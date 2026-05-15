//! `initialize_reputation` — one-time singleton init of `ReputationConfig`.
//!
//! Pins the FROZEN fields:
//!   - `roundfi_core_program`            (issuer program ID)
//!   - `passport_attestation_authority`  (off-chain bridge service pubkey)
//! Mutable later via `update_reputation_config`:
//!   - `authority`, `passport_network`, `paused`.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::state::ReputationConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeReputationArgs {
    pub roundfi_core_program:            Pubkey,
    /// Off-chain Human Passport bridge service pubkey. Field name
    /// matches `ReputationConfig.passport_attestation_authority`.
    pub passport_attestation_authority:  Pubkey,
    /// Passport network scope. Field name matches
    /// `ReputationConfig.passport_network`.
    pub passport_network:                Pubkey,
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
    cfg.authority                      = ctx.accounts.authority.key();
    cfg.roundfi_core_program           = args.roundfi_core_program;
    cfg.passport_attestation_authority = args.passport_attestation_authority;
    cfg.passport_network               = args.passport_network;
    cfg.paused                         = false;
    cfg.bump                           = ctx.bumps.config;
    // Adevar Labs SEV-021 — authority rotation starts empty.
    cfg.pending_authority              = Pubkey::default();
    cfg.pending_authority_eta          = 0;
    cfg._padding                       = [];

    msg!(
        "roundfi-reputation: initialized authority={} core={} passport_authority={} passport_net={}",
        cfg.authority,
        cfg.roundfi_core_program,
        cfg.passport_attestation_authority,
        cfg.passport_network,
    );
    Ok(())
}
