//! `update_protocol_config(patch)` — authority-only config updates.
//!
//! Only mutable fields here: `fee_bps_yield`, `fee_bps_cycle_l1/l2/l3`,
//! `guarantee_fund_bps`.
//!
//! Frozen (InstructionError::ImmutableConfigField on attempt):
//!   authority, usdc_mint, metaplex_core, default_yield_adapter,
//!   reputation_program, bump, paused.
//!
//! `paused` has its own dedicated instruction (`pause`) to keep the
//! security-critical emergency-stop path separate from the rates/fees
//! admin path.
//!
//! `treasury` was removed from this surface in the audit-hardening
//! pass. Treasury rotations now go through a dedicated 3-step flow
//! (`propose_new_treasury` → `commit_new_treasury` after a 7-day
//! time-lock) plus the optional `lock_treasury` one-way kill switch.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateProtocolConfigArgs {
    pub new_fee_bps_yield:       Option<u16>,
    pub new_fee_bps_cycle_l1:    Option<u16>,
    pub new_fee_bps_cycle_l2:    Option<u16>,
    pub new_fee_bps_cycle_l3:    Option<u16>,
    pub new_guarantee_fund_bps:  Option<u16>,
}

#[derive(Accounts)]
pub struct UpdateProtocolConfig<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = authority.key() == config.authority @ RoundfiError::Unauthorized,
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<UpdateProtocolConfig>, args: UpdateProtocolConfigArgs) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    if let Some(bps) = args.new_fee_bps_yield {
        require!(bps <= MAX_BPS, RoundfiError::InvalidBps);
        cfg.fee_bps_yield = bps;
    }
    if let Some(bps) = args.new_fee_bps_cycle_l1 {
        require!(bps <= MAX_BPS, RoundfiError::InvalidBps);
        cfg.fee_bps_cycle_l1 = bps;
    }
    if let Some(bps) = args.new_fee_bps_cycle_l2 {
        require!(bps <= MAX_BPS, RoundfiError::InvalidBps);
        cfg.fee_bps_cycle_l2 = bps;
    }
    if let Some(bps) = args.new_fee_bps_cycle_l3 {
        require!(bps <= MAX_BPS, RoundfiError::InvalidBps);
        cfg.fee_bps_cycle_l3 = bps;
    }
    if let Some(bps) = args.new_guarantee_fund_bps {
        // GF bps can exceed 10_000 (default 15_000 = 150%) — cap at 50_000
        // so a runaway value can't overflow the cap math.
        require!(bps <= 50_000, RoundfiError::InvalidBps);
        cfg.guarantee_fund_bps = bps;
    }

    msg!(
        "roundfi-core: update_protocol_config fee_yield={} gf_bps={}",
        cfg.fee_bps_yield, cfg.guarantee_fund_bps,
    );

    Ok(())
}
