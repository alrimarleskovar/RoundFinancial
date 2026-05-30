//! `propose_new_authority(new_authority)` — authority-only.
//!
//! Step 1 of the protocol-authority rotation flow (mirror of the
//! treasury rotation pattern from PR #122). Used at the mainnet
//! Squads ceremony to hand the deployer key over to the multisig
//! vault PDA, and for any subsequent Squads-A → Squads-B rotation.
//!
//!   propose → wait `TREASURY_TIMELOCK_SECS` (7d) → commit
//!
//! Stages a new authority pubkey on `config.pending_authority` and
//! sets `config.pending_authority_eta = now + TREASURY_TIMELOCK_SECS`.
//! Live `config.authority` is NOT touched here — `commit_new_authority`
//! does the swap once the eta has elapsed.
//!
//! Rejected when:
//!   - A proposal is already pending (caller must
//!     `cancel_new_authority` first to avoid silent overwrites of
//!     the eta — same guard as the treasury propose handler)
//!
//! No `lock_authority` precondition: authority rotation must remain
//! possible even after the Squads vault is in place, so a compromised
//! multisig can be rotated to a fresh one without redeploying the
//! program. See `state/config.rs` docstring on `pending_authority`.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProposeNewAuthorityArgs {
    pub new_authority: Pubkey,
}

#[derive(Accounts)]
pub struct ProposeNewAuthority<'info> {
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
    ctx: Context<ProposeNewAuthority>,
    args: ProposeNewAuthorityArgs,
) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(
        cfg.pending_authority == Pubkey::default(),
        RoundfiError::AuthorityProposalAlreadyPending,
    );
    // Adevar Labs SEV-036 — reject Pubkey::default() as new_authority.
    // Without this guard, calling propose with Pubkey::default() sets
    // `pending_authority_eta = now + 7d` while leaving
    // `pending_authority == Pubkey::default()` (the "no proposal in
    // flight" sentinel). Effect: a zombie pending state where the
    // cancel/commit handlers can both refuse with confusing errors,
    // and the next legitimate propose succeeds (because the sentinel
    // check above passes) — but the eta is now from the zombie call,
    // not the new one. Self-healing but UX-confusing. Reject the
    // default sentinel as `new_authority` so the proposal never
    // enters the zombie state.
    require!(
        args.new_authority != Pubkey::default(),
        RoundfiError::Unauthorized,
    );

    let clock = Clock::get()?;
    let eta = clock
        .unix_timestamp
        .checked_add(TREASURY_TIMELOCK_SECS)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    cfg.pending_authority     = args.new_authority;
    cfg.pending_authority_eta = eta;

    msg!(
        "roundfi-core: propose_new_authority new={} eta={}",
        args.new_authority, eta,
    );

    Ok(())
}
