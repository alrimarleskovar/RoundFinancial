//! `commit_new_authority()` — finalizes a pending protocol-authority
//! rotation.
//!
//! Runs after `propose_new_authority` and the `TREASURY_TIMELOCK_SECS`
//! window has elapsed. Atomically:
//!
//!   1. Validate `now >= pending_authority_eta`
//!   2. `config.authority = config.pending_authority`
//!   3. Clear `pending_authority` + `pending_authority_eta`
//!
//! Anyone can call this — the gating is the timelock and the fact
//! that only the current authority could have proposed it. Letting
//! any caller commit means the rotation eventually fires even if the
//! authority key is offline, as long as the proposal exists.
//!
//! Mirrors the `commit_new_treasury` pattern (PR #122). At the
//! mainnet Squads ceremony this is the ix that finally hands the
//! authority over to the multisig vault PDA — the 7-day public
//! window between propose and commit is the auditor-facing assurance
//! that no surprise authority rotations happen.
//!
//! Rejected when:
//!   - No proposal is pending
//!   - Timelock window not yet elapsed

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(Accounts)]
pub struct CommitNewAuthority<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// Anyone can crank — no signer/authority constraint. Gate is the
    /// timelock + the prior `propose_new_authority` signed by the
    /// then-current authority.
    pub caller: Signer<'info>,
}

pub fn handler(ctx: Context<CommitNewAuthority>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(
        cfg.pending_authority != Pubkey::default(),
        RoundfiError::NoPendingAuthorityChange,
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= cfg.pending_authority_eta,
        RoundfiError::AuthorityTimelockActive,
    );

    let old = cfg.authority;
    let new = cfg.pending_authority;

    cfg.authority             = new;
    cfg.pending_authority     = Pubkey::default();
    cfg.pending_authority_eta = 0;

    msg!(
        "roundfi-core: commit_new_authority old={} new={}",
        old, new,
    );

    Ok(())
}
