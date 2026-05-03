//! `propose_new_treasury(new_treasury)` — authority-only.
//!
//! First step in the audit-hardened treasury rotation flow:
//!
//!   propose → wait `TREASURY_TIMELOCK_SECS` (7d) → commit
//!
//! Stages a new `treasury` pubkey on `config.pending_treasury` and
//! sets `config.pending_treasury_eta = now + TREASURY_TIMELOCK_SECS`.
//! Live `config.treasury` is NOT touched here — `commit_new_treasury`
//! does the swap once the eta has elapsed.
//!
//! Rejected when:
//!   - `config.treasury_locked == true` (one-way kill switch via
//!     `lock_treasury` was triggered)
//!   - A proposal is already pending (caller must `cancel_new_treasury`
//!     first to avoid silent overwrites of the eta)

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProposeNewTreasuryArgs {
    pub new_treasury: Pubkey,
}

#[derive(Accounts)]
pub struct ProposeNewTreasury<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = authority.key() == config.authority @ RoundfiError::Unauthorized,
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<ProposeNewTreasury>,
    args: ProposeNewTreasuryArgs,
) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(!cfg.treasury_locked, RoundfiError::TreasuryLocked);
    require!(
        cfg.pending_treasury == Pubkey::default(),
        RoundfiError::TreasuryProposalAlreadyPending,
    );

    let clock = Clock::get()?;
    let eta = clock
        .unix_timestamp
        .checked_add(TREASURY_TIMELOCK_SECS)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    cfg.pending_treasury     = args.new_treasury;
    cfg.pending_treasury_eta = eta;

    msg!(
        "roundfi-core: propose_new_treasury new={} eta={}",
        args.new_treasury, eta,
    );

    Ok(())
}
