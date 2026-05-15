//! `lock_approved_yield_adapter()` — one-way kill switch for the
//! yield-adapter allowlist pin.
//!
//! After the team is confident the deployed yield-adapter program ID
//! pinned in `config.approved_yield_adapter` is permanent, the authority
//! calls this to set `config.approved_yield_adapter_locked = true`.
//! Once true:
//!
//!   - `update_protocol_config` rejects `new_approved_yield_adapter`
//!     with `AdapterAllowlistLocked`
//!   - Even authority cannot reverse the flag (no `unlock` counterpart)
//!   - The pinned adapter Pubkey is permanently frozen
//!
//! Mirrors `lock_treasury()` (PR #122) — same design intent:
//! lock-flag as the post-deployment hardening when no further rotations
//! are anticipated. The earlier mutability (via `update_protocol_config`)
//! exists for canary rampup; the lock-flag is the production hardening
//! once the canary justifies pinning.
//!
//! Closes (part of) item 9 from the post-#311 external review:
//! "allowlist mutable por authority precisa governança".

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(Accounts)]
pub struct LockApprovedYieldAdapter<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = authority.key() == config.authority @ RoundfiError::Unauthorized,
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<LockApprovedYieldAdapter>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    // Idempotent. Calling twice is a no-op, not an error.
    if cfg.approved_yield_adapter_locked {
        msg!("roundfi-core: lock_approved_yield_adapter already locked — no-op");
        return Ok(());
    }

    cfg.approved_yield_adapter_locked = true;
    msg!(
        "roundfi-core: lock_approved_yield_adapter adapter={} permanently frozen",
        cfg.approved_yield_adapter,
    );

    Ok(())
}
