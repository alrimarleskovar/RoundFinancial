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
    require!(args.fee_bps_yield    <= MAX_BPS, RoundfiError::InvalidBps);
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

    // TVL caps (mainnet canary safety): start disabled (0 = no cap)
    // so existing devnet flows keep working. Mainnet authority calls
    // `update_protocol_config` after deploy to set the canary values
    // per the rampup plan in docs/operations/mainnet-canary-plan.md.
    // `committed_protocol_tvl_usdc` always starts at 0; gets tracked
    // by init_pool_vaults / close_pool whether caps are enforced or not.
    config.max_pool_tvl_usdc          = 0;
    config.max_protocol_tvl_usdc      = 0;
    config.committed_protocol_tvl_usdc = 0;

    msg!("roundfi-core: protocol initialized");
    Ok(())
}
