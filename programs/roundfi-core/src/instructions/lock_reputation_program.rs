//! `lock_reputation_program()` — one-way confirmation that the protocol
//! shipped with reputation wired up.
//!
//! `reputation_program` is set once at `initialize_protocol` and is
//! **immutable** thereafter (`update_protocol_config.rs` lists it as
//! frozen). The threat closed here is **deployer error at init**: a
//! mainnet operator who passes `Pubkey::default()` for the reputation
//! program slot accidentally ships a "no-reputation" protocol that
//! marketing materials still describe as reputation-bearing. Every
//! `contribute` / `claim_payout` would then silently skip the
//! reputation CPI (the `config.reputation_program != Pubkey::default()`
//! guard in those handlers).
//!
//! After init, the authority calls `lock_reputation_program()`. The ix
//! **refuses** to fire when `reputation_program == Pubkey::default()`
//! — so a lock on-chain proves the live deployment has a real
//! reputation program. Once locked:
//!
//!   - The flag `reputation_program_locked = true` is durable evidence
//!     to any observer (Solscan, indexer, partners) that the protocol
//!     is not running in no-reputation mode.
//!   - Even authority cannot reverse the flag (no
//!     `unlock_reputation_program` counterpart). Idempotent: calling
//!     twice is a no-op, not an error.
//!
//! Mirrors `lock_treasury()` / `lock_approved_yield_adapter()` in
//! shape; the `reputation_program != default()` precondition is the
//! novel part — it makes the lock itself a *positive assertion*, not
//! just a freeze.
//!
//! Partner review MEDIUM #2 (2026-06-12). Devnet / bankrun init paths
//! that intentionally use `Pubkey::default()` for the test harness
//! never call this ix and keep working under the skip-path semantics.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(Accounts)]
pub struct LockReputationProgram<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = authority.key() == config.authority @ RoundfiError::Unauthorized,
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<LockReputationProgram>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    // Idempotent. Calling twice is a no-op.
    if cfg.reputation_program_locked {
        msg!("roundfi-core: lock_reputation_program already locked — no-op");
        return Ok(());
    }

    // The critical invariant: refuse to lock when the reputation
    // program slot is the zero pubkey. A lock under this state would
    // be a *false* assertion — it would freeze the no-reputation
    // configuration on-chain forever. Reject loudly so the operator
    // knows their `initialize_protocol` was misconfigured.
    require!(
        cfg.reputation_program != Pubkey::default(),
        RoundfiError::ReputationProgramMismatch,
    );

    cfg.reputation_program_locked = true;
    msg!(
        "roundfi-core: lock_reputation_program reputation_program={} permanently confirmed",
        cfg.reputation_program,
    );

    Ok(())
}
