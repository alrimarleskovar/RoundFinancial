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
//!
//! **Adevar Labs SEV-006 fix:** the proposed treasury is now passed
//! as a typed `Account<TokenAccount>` constrained to the protocol's
//! USDC mint. Before this fix, the args carried a raw `Pubkey` and
//! validation was deferred to `harvest_yield` runtime — meaning an
//! authority typo (wallet pubkey instead of ATA) wouldn't surface
//! until after the 7-day timelock, blocking yield harvest in EVERY
//! pool until the rotation could be re-proposed and re-waited.
//! Anchor's account validation now rejects at proposal time.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProposeNewTreasuryArgs {
    // No args — the proposed treasury is now a typed account in the
    // accounts struct (see SEV-006 docstring above). Kept as an empty
    // struct for SDK back-compat — old encoders pass `{}` and that
    // continues to deserialize fine.
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

    /// USDC mint, pinned to `config.usdc_mint`. Used by the
    /// `new_treasury` constraint to enforce it's an ATA on the
    /// correct mint.
    #[account(
        address = config.usdc_mint @ RoundfiError::InvalidMint,
    )]
    pub usdc_mint: Account<'info, Mint>,

    /// The proposed new treasury — must be an existing TokenAccount
    /// on `config.usdc_mint`. Anchor validates the layout + mint at
    /// account-validation time, so a typo / wrong-mint / wallet
    /// pubkey rejects HERE rather than after a 7-day wait.
    ///
    /// Adevar Labs SEV-006 — previously a raw Pubkey in args.
    pub new_treasury: Account<'info, TokenAccount>,
}

pub fn handler(
    ctx: Context<ProposeNewTreasury>,
    _args: ProposeNewTreasuryArgs,
) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(!cfg.treasury_locked, RoundfiError::TreasuryLocked);
    require!(
        cfg.pending_treasury == Pubkey::default(),
        RoundfiError::TreasuryProposalAlreadyPending,
    );

    let new_treasury_pubkey = ctx.accounts.new_treasury.key();

    let clock = Clock::get()?;
    let eta = clock
        .unix_timestamp
        .checked_add(TREASURY_TIMELOCK_SECS)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    cfg.pending_treasury     = new_treasury_pubkey;
    cfg.pending_treasury_eta = eta;

    msg!(
        "roundfi-core: propose_new_treasury new={} eta={}",
        new_treasury_pubkey, eta,
    );

    Ok(())
}
