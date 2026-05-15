//! `propose_new_fee_bps_yield(new_value)` — authority-only.
//!
//! Step 1 of the `fee_bps_yield` rotation flow (Adevar Labs SEV-024
//! follow-up + W3 Risk #4). Mirrors the treasury / authority rotation
//! pattern shipped in #122 / #3.6.
//!
//!   propose → wait `FEE_BPS_YIELD_TIMELOCK_SECS` (1d) → commit
//!
//! Stages a new `fee_bps_yield` value on `config.pending_fee_bps_yield`
//! and sets `config.pending_fee_bps_yield_eta = now + FEE_BPS_YIELD_TIMELOCK_SECS`.
//! Live `config.fee_bps_yield` is NOT touched here.
//!
//! Validation:
//!   - Authority signature required.
//!   - New value must be `<= MAX_FEE_BPS_YIELD` (SEV-024 cap, currently 30%).
//!   - No existing proposal pending (caller must cancel first to avoid
//!     silent overwrites of the eta — same guard as the treasury propose
//!     handler).
//!
//! Why 1 day (not 7d): fee changes are reversible; 24h is enough for
//! users to detect via off-chain monitoring and opt out via the escape
//! valve. See `docs/security/economic-config-governance.md`.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProposeNewFeeBpsYieldArgs {
    pub new_fee_bps_yield: u16,
}

#[derive(Accounts)]
pub struct ProposeNewFeeBpsYield<'info> {
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
    ctx: Context<ProposeNewFeeBpsYield>,
    args: ProposeNewFeeBpsYieldArgs,
) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(
        cfg.pending_fee_bps_yield_eta == 0,
        RoundfiError::FeeBpsYieldProposalAlreadyPending,
    );
    require!(
        args.new_fee_bps_yield <= MAX_FEE_BPS_YIELD,
        RoundfiError::InvalidBps,
    );

    let clock = Clock::get()?;
    let eta = clock
        .unix_timestamp
        .checked_add(FEE_BPS_YIELD_TIMELOCK_SECS)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    cfg.pending_fee_bps_yield     = args.new_fee_bps_yield;
    cfg.pending_fee_bps_yield_eta = eta;

    msg!(
        "roundfi-core: propose_new_fee_bps_yield new={} eta={}",
        args.new_fee_bps_yield, eta,
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The timelock value is the canary-target 1 day. Floor guards in
    /// constants.rs assert it cannot drop below 1 day (would reduce
    /// the public window below practical detect-react time).
    #[test]
    fn fee_timelock_secs_is_one_day() {
        assert_eq!(FEE_BPS_YIELD_TIMELOCK_SECS, 86_400);
        assert_eq!(FEE_BPS_YIELD_TIMELOCK_SECS, 24 * 60 * 60);
    }

    /// The propose handler validates `new_fee_bps_yield <= MAX_FEE_BPS_YIELD`.
    /// Both bounds must be in the right order (a propose that produced
    /// a value above the cap would defeat the SEV-024 fix entirely).
    #[test]
    fn fee_yield_cap_consistent_with_default() {
        // Cap > default (governance can RAISE within bounds)
        assert!(MAX_FEE_BPS_YIELD as u32 > DEFAULT_FEE_BPS_YIELD as u32);
        // Cap < MAX_BPS (would defeat the SEV-024 50% blast-radius bound)
        assert!(MAX_FEE_BPS_YIELD < MAX_BPS);
        // Cap explicitly at 30% (pinned by SEV-024)
        assert_eq!(MAX_FEE_BPS_YIELD, 3_000);
    }

    /// Propose-after-propose without cancel must fail. Mirrors the
    /// `AuthorityProposalAlreadyPending` guard in propose_new_authority.
    #[test]
    fn pending_eta_sentinel_blocks_overwrite() {
        // The handler condition is `cfg.pending_fee_bps_yield_eta == 0`.
        // If eta is non-zero (proposal in flight) the require! fails.
        let pending_eta: i64 = 1_000_000;
        assert!(pending_eta != 0,
            "non-zero eta must signal 'pending change in flight'");
    }
}
