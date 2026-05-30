use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeProtocolArgs {
    pub fee_bps_yield:      u16,
    pub fee_bps_cycle_l1:   u16,
    pub fee_bps_cycle_l2:   u16,
    pub fee_bps_cycle_l3:   u16,
    /// Guarantee Fund fill target, bps of protocol yield. May exceed 10_000 (default 15_000 = 150%).
    pub guarantee_fund_bps: u16,
}

impl Default for InitializeProtocolArgs {
    fn default() -> Self {
        Self {
            fee_bps_yield:      DEFAULT_FEE_BPS_YIELD,
            fee_bps_cycle_l1:   DEFAULT_FEE_BPS_CYCLE_L1,
            fee_bps_cycle_l2:   DEFAULT_FEE_BPS_CYCLE_L2,
            fee_bps_cycle_l3:   DEFAULT_FEE_BPS_CYCLE_L3,
            guarantee_fund_bps: DEFAULT_GUARANTEE_FUND_BPS,
        }
    }
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = ProtocolConfig::SIZE,
        seeds = [SEED_CONFIG],
        bump,
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub usdc_mint: Account<'info, Mint>,

    /// USDC token account receiving protocol fees; must be on the configured mint.
    #[account(token::mint = usdc_mint)]
    pub treasury: Account<'info, TokenAccount>,

    /// CHECK: Metaplex Core program — validated against the fixed program ID.
    #[account(address = mpl_core::ID @ RoundfiError::Unauthorized)]
    pub metaplex_core: UncheckedAccount<'info>,

    /// CHECK: Default yield adapter program. Must be executable; pubkey stored verbatim.
    #[account(executable)]
    pub default_yield_adapter: UncheckedAccount<'info>,

    /// CHECK: roundfi-reputation program. Must be executable; pubkey stored verbatim.
    #[account(executable)]
    pub reputation_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeProtocol>, args: InitializeProtocolArgs) -> Result<()> {
    // Adevar Labs SEV-024 fix: tightened from MAX_BPS to MAX_FEE_BPS_YIELD (30%).
    require!(args.fee_bps_yield    <= MAX_FEE_BPS_YIELD, RoundfiError::InvalidBps);
    require!(args.fee_bps_cycle_l1 <= MAX_BPS, RoundfiError::InvalidBps);
    require!(args.fee_bps_cycle_l2 <= MAX_BPS, RoundfiError::InvalidBps);
    require!(args.fee_bps_cycle_l3 <= MAX_BPS, RoundfiError::InvalidBps);
    // guarantee_fund_bps is expressed as bps of protocol yield → may exceed 10_000; cap at 50_000.
    require!(args.guarantee_fund_bps <= 50_000, RoundfiError::InvalidBps);

    let config = &mut ctx.accounts.config;
    config.authority             = ctx.accounts.authority.key();
    config.treasury              = ctx.accounts.treasury.key();
    config.usdc_mint             = ctx.accounts.usdc_mint.key();
    config.metaplex_core         = ctx.accounts.metaplex_core.key();
    config.default_yield_adapter = ctx.accounts.default_yield_adapter.key();
    config.reputation_program    = ctx.accounts.reputation_program.key();
    config.fee_bps_yield         = args.fee_bps_yield;
    config.fee_bps_cycle_l1      = args.fee_bps_cycle_l1;
    config.fee_bps_cycle_l2      = args.fee_bps_cycle_l2;
    config.fee_bps_cycle_l3      = args.fee_bps_cycle_l3;
    config.guarantee_fund_bps    = args.guarantee_fund_bps;
    config.paused                = false;
    config.bump                  = ctx.bumps.config;

    // Treasury rotation safety (audit hardening): start unlocked + no
    // pending proposal. Authority must explicitly run the propose →
    // commit dance to rotate, and may call `lock_treasury()` post-
    // deployment for one-way immutability.
    config.treasury_locked       = false;
    config.pending_treasury      = Pubkey::default();
    config.pending_treasury_eta  = 0;

    // TVL caps (mainnet canary safety, items 4.2 + 4.3): start disabled
    // (0 = no cap) so existing devnet flows keep working. Mainnet
    // authority sets canary values via `update_protocol_config` per the
    // rampup plan in docs/operations/mainnet-canary-plan.md.
    // `committed_protocol_tvl_usdc` always starts at 0; gets tracked
    // by init_pool_vaults / close_pool whether caps are enforced or not.
    config.max_pool_tvl_usdc          = 0;
    config.max_protocol_tvl_usdc      = 0;
    config.committed_protocol_tvl_usdc = 0;

    // Yield-adapter allowlist (item 4.4): start disabled
    // (Pubkey::default()) so existing devnet pools can keep pointing
    // at mock or kamino freely. Mainnet authority pins the canary
    // adapter via `update_protocol_config` post-deploy.
    config.approved_yield_adapter = Pubkey::default();
    // Adapter allowlist lock-flag (governance, item 9 of post-#311
    // review): starts unlocked; authority calls
    // `lock_approved_yield_adapter()` post-canary when the pinned
    // adapter is final. Mirrors `treasury_locked` (#122).
    config.approved_yield_adapter_locked = false;

    // Commit-reveal flag (#232): starts permissive so devnet single-
    // step `escape_valve_list` keeps working. Mainnet flips to `true`
    // via `update_protocol_config` after the canary validates the
    // commit-reveal UX.
    config.commit_reveal_required = false;

    // Protocol-authority rotation (Squads ceremony, #3.6): starts
    // empty. Authority calls `propose_new_authority` when ready to
    // hand off to the multisig vault PDA; permissionless
    // `commit_new_authority` finalizes after the 7-day timelock.
    config.pending_authority     = Pubkey::default();
    config.pending_authority_eta = 0;

    // Adevar Labs SEV-003 fix: LP/participant split is now authoritative
    // protocol policy, not caller-controlled. Initialized to the
    // whitepaper default (65% LP earmark / 35% participant prize);
    // mutable post-deploy via update_protocol_config as canary data
    // justifies.
    config.lp_share_bps = DEFAULT_LP_SHARE_BPS;

    // Adevar Labs SEV-024 follow-up — fee_bps_yield timelock pilot.
    // Starts empty (eta=0 is the "no pending change" sentinel).
    // Authority uses propose/cancel/commit to change fee_bps_yield with
    // a 1-day public window. Direct mutation via update_protocol_config
    // is rejected with DirectFeeBpsYieldMutationDisabled.
    config.pending_fee_bps_yield     = 0;
    config.pending_fee_bps_yield_eta = 0;

    msg!("roundfi-core: protocol initialized");
    Ok(())
}
