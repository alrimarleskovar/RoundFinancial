//! `commit_new_treasury()` — finalizes a pending treasury rotation.
//!
//! Runs after `propose_new_treasury` and the `TREASURY_TIMELOCK_SECS`
//! window has elapsed. Atomically:
//!
//!   1. Validate `now >= pending_treasury_eta`
//!   2. `config.treasury = config.pending_treasury`
//!   3. Clear `pending_treasury` + `pending_treasury_eta`
//!
//! Anyone can call this — the gating is the timelock and the fact
//! that only `authority` could have proposed it. Letting any caller
//! commit means the rotation eventually fires even if the authority
//! key is offline, as long as the proposal exists.
//!
//! Rejected when:
//!   - No proposal is pending
//!   - Timelock window not yet elapsed
//!
//! `treasury_locked` does NOT block commit — if a proposal was made
//! and accepted before lock, it can still finalize. (Locking AFTER
//! a proposal is essentially: lock the current treasury but accept
//! the in-flight rotation; if you want to abort, call cancel first.)

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(Accounts)]
pub struct CommitNewTreasury<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// Anyone can crank — no signer/authority constraint.
    pub caller: Signer<'info>,
}

pub fn handler(ctx: Context<CommitNewTreasury>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(
        cfg.pending_treasury != Pubkey::default(),
        RoundfiError::NoPendingTreasuryChange,
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= cfg.pending_treasury_eta,
        RoundfiError::TreasuryTimelockActive,
    );

    let old = cfg.treasury;
    let new = cfg.pending_treasury;

    cfg.treasury             = new;
    cfg.pending_treasury     = Pubkey::default();
    cfg.pending_treasury_eta = 0;

    msg!(
        "roundfi-core: commit_new_treasury old={} new={}",
        old, new,
    );

    Ok(())
}
