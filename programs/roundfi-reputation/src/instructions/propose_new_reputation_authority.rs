//! `propose_new_reputation_authority(new_authority)` — authority-only.
//!
//! Adevar Labs SEV-021 fix. Step 1 of the reputation-program authority
//! rotation flow. Mirrors core's `propose_new_authority` (PR #323).
//!
//!   propose → wait `REPUTATION_AUTHORITY_TIMELOCK_SECS` (7d) → commit
//!
//! Stages a new authority pubkey on `config.pending_authority` and
//! sets `config.pending_authority_eta = now + 7d`. Live `config.authority`
//! is NOT touched here.
//!
//! Before this ix, `update_reputation_config { new_authority }` rotated
//! the authority directly with no timelock. A compromised key was a
//! single-tx irreversible attack — asymmetric with core's protection.
//! Now both core and reputation share the same 7-day window pattern.
//!
//! Rejected when:
//!   - A proposal is already pending (caller must
//!     `cancel_new_reputation_authority` first).

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::ReputationConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProposeNewReputationAuthorityArgs {
    pub new_authority: Pubkey,
}

#[derive(Accounts)]
pub struct ProposeNewReputationAuthority<'info> {
    #[account(
        mut,
        seeds = [SEED_REP_CONFIG],
        bump = config.bump,
        constraint = authority.key() == config.authority @ ReputationError::Unauthorized,
    )]
    pub config: Account<'info, ReputationConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<ProposeNewReputationAuthority>,
    args: ProposeNewReputationAuthorityArgs,
) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(
        cfg.pending_authority == Pubkey::default(),
        ReputationError::AuthorityProposalAlreadyPending,
    );

    let clock = Clock::get()?;
    let eta = clock
        .unix_timestamp
        .checked_add(REPUTATION_AUTHORITY_TIMELOCK_SECS)
        .ok_or(error!(ReputationError::MathOverflow))?;

    cfg.pending_authority     = args.new_authority;
    cfg.pending_authority_eta = eta;

    msg!(
        "roundfi-reputation: propose_new_authority new={} eta={}",
        args.new_authority, eta,
    );

    Ok(())
}
