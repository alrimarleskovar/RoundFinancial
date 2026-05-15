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
    /// Per-pool TVL cap, USDC base units. `Some(0)` disables the cap;
    /// `None` leaves the field unchanged. Used by the mainnet canary
    /// rampup — start tight, raise as canary data justifies.
    pub new_max_pool_tvl_usdc:        Option<u64>,
    /// Protocol-wide TVL cap, USDC base units. Same convention as
    /// `new_max_pool_tvl_usdc`.
    pub new_max_protocol_tvl_usdc:    Option<u64>,
    /// Yield-adapter allowlist pin (item 4.4 of MAINNET_READINESS).
    /// `Some(Pubkey::default())` disables the allowlist (back-compat).
    /// `Some(<program_id>)` requires `create_pool` to match.
    /// `None` leaves the field unchanged.
    pub new_approved_yield_adapter: Option<Pubkey>,
    /// Commit-reveal gate (#232). `Some(true)` disables the legacy
    /// single-step `escape_valve_list` path; `Some(false)` re-enables
    /// it. `None` leaves unchanged. Mainnet flips to `Some(true)`
    /// after canary validates the commit-reveal flow.
    pub new_commit_reveal_required: Option<bool>,
    /// Yield waterfall LP/participant split (Adevar Labs SEV-003 fix).
    /// `Some(bps)` updates `config.lp_share_bps` — the authoritative
    /// value harvest_yield reads (the args field there is now
    /// deprecated). Capped at MAX_BPS (10_000). `None` leaves unchanged.
    pub new_lp_share_bps: Option<u16>,
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

    if let Some(_bps) = args.new_fee_bps_yield {
        // Adevar Labs SEV-024 fix (W2): tightened the cap from MAX_BPS
        // (100%) to MAX_FEE_BPS_YIELD (30%).
        //
        // Adevar Labs SEV-024 follow-up (W3 Risk #4): direct mutation
        // of `fee_bps_yield` via `update_protocol_config` is **no longer
        // permitted**. Callers must use the
        // `propose_new_fee_bps_yield → commit_new_fee_bps_yield` flow,
        // which enforces a 1-day public window between proposal and
        // effective change. The 30% cap still applies (validated by the
        // propose handler).
        //
        // The `new_fee_bps_yield` field on `UpdateProtocolConfigArgs` is
        // retained for SDK back-compat (renaming would break callers'
        // type structs) but its presence is now an explicit error,
        // pointing the operator at the timelock-protected flow.
        return Err(error!(RoundfiError::DirectFeeBpsYieldMutationDisabled));
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
    if let Some(cap) = args.new_max_pool_tvl_usdc {
        // 0 disables the cap (back-compat / canary off-ramp). No upper
        // bound — protocol authority may pick any value. Default for
        // mainnet canary is a small number ($5 USDC = 5_000_000) per
        // the plan in docs/operations/mainnet-canary-plan.md.
        cfg.max_pool_tvl_usdc = cap;
    }
    if let Some(cap) = args.new_max_protocol_tvl_usdc {
        // 0 disables. Lowering this below the current
        // `committed_protocol_tvl_usdc` is allowed — it locks out NEW
        // pools but doesn't affect pools already in flight. The
        // running counter naturally rebases as pools close.
        cfg.max_protocol_tvl_usdc = cap;
    }
    if let Some(pubkey) = args.new_approved_yield_adapter {
        // Adevar Labs SEV-036 sweep (W5 follow-up) — reject
        // Pubkey::default() as a value. `Pubkey::default()` is the
        // sentinel for "allowlist disabled" (used at protocol init);
        // setting it via update_protocol_config post-init would
        // *re-open* a previously-tightened allowlist surface. The
        // allowlist is supposed to tighten over time
        // (post-canary → lock_approved_yield_adapter). If the
        // operator genuinely needs to revert to "no allowlist",
        // it's a redeploy decision, not an update call.
        require!(
            pubkey != Pubkey::default(),
            RoundfiError::InvalidYieldAdapter,
        );

        // Governance check: if the lock-flag is on, the adapter
        // allowlist is permanently frozen — reject loudly so the
        // operator notices their misuse rather than silently
        // discarding the change. Mirrors `treasury_locked` semantic
        // from #122 (which rejects propose_new_treasury) but with
        // a loud error instead of a quiet decline.
        require!(
            !cfg.approved_yield_adapter_locked,
            RoundfiError::AdapterAllowlistLocked,
        );

        // Audit trail: emit a dedicated msg! when the adapter
        // changes so an off-chain monitor (Helius webhook → indexer
        // → ops alerts) can flag every allowlist rotation. The
        // generic update_protocol_config log below carries the new
        // value; this line carries the OLD → NEW transition.
        if cfg.approved_yield_adapter != pubkey {
            msg!(
                "roundfi-core: approved_yield_adapter rotated old={} new={}",
                cfg.approved_yield_adapter, pubkey,
            );
        }

        // No further validation: a Pubkey is just 32 bytes, and
        // we can't verify it points at an executable program without
        // forwarding the account (which would bloat this admin ix).
        // create_pool will independently enforce
        // `args.yield_adapter.executable == true` via the existing
        // Anchor `#[account(executable)]` constraint, so the worst a
        // misconfigured allowlist can do is reject all pools — a
        // recoverable misconfiguration, not a fund-loss surface.
        cfg.approved_yield_adapter = pubkey;
    }
    if let Some(flag) = args.new_commit_reveal_required {
        // Audit trail: log the transition so off-chain monitors can
        // alert when ops toggles the gate. Mainnet expectation is a
        // one-way `false → true` flip post-canary; a reverse flip is
        // explicitly allowed (it's a recoverable UX choice, not a
        // trust-surface change) but should still be visible.
        if cfg.commit_reveal_required != flag {
            msg!(
                "roundfi-core: commit_reveal_required toggled old={} new={}",
                cfg.commit_reveal_required, flag,
            );
        }
        cfg.commit_reveal_required = flag;
    }
    if let Some(bps) = args.new_lp_share_bps {
        // Adevar Labs SEV-003 fix: lp_share_bps is now authoritative
        // protocol policy. The on-chain harvest_yield handler reads
        // from this field, NOT from caller-supplied args. Capped at
        // MAX_BPS (100%); same convention as fee_bps_yield etc.
        require!(bps <= MAX_BPS, RoundfiError::InvalidBps);
        if cfg.lp_share_bps != bps {
            msg!(
                "roundfi-core: lp_share_bps changed old={} new={}",
                cfg.lp_share_bps, bps,
            );
        }
        cfg.lp_share_bps = bps;
    }

    msg!(
        "roundfi-core: update_protocol_config fee_yield={} gf_bps={} max_pool_tvl={} max_protocol_tvl={} approved_adapter={} adapter_locked={} commit_reveal_required={} lp_share_bps={}",
        cfg.fee_bps_yield, cfg.guarantee_fund_bps,
        cfg.max_pool_tvl_usdc, cfg.max_protocol_tvl_usdc,
        cfg.approved_yield_adapter, cfg.approved_yield_adapter_locked,
        cfg.commit_reveal_required, cfg.lp_share_bps,
    );

    Ok(())
}
