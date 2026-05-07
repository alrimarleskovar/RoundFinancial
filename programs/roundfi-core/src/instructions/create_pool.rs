use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::{Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreatePoolArgs {
    pub seed_id:            u64,
    pub members_target:     u8,
    pub installment_amount: u64,
    pub credit_amount:      u64,
    pub cycles_total:       u8,
    pub cycle_duration:     i64,
    pub escrow_release_bps: u16,
}

impl CreatePoolArgs {
    pub fn with_defaults(seed_id: u64) -> Self {
        Self {
            seed_id,
            members_target:     DEFAULT_MEMBERS_TARGET,
            installment_amount: DEFAULT_INSTALLMENT_AMOUNT,
            credit_amount:      DEFAULT_CREDIT_AMOUNT,
            cycles_total:       DEFAULT_CYCLES_TOTAL,
            cycle_duration:     DEFAULT_CYCLE_DURATION,
            escrow_release_bps: DEFAULT_ESCROW_RELEASE_BPS,
        }
    }
}

#[derive(Accounts)]
#[instruction(args: CreatePoolArgs)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = !config.paused @ RoundfiError::ProtocolPaused,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    // `Box<Account<...>>` moves the freshly-allocated zero-buffer to the
    // heap instead of the stack. Without it, Solana 3.x's tighter stack
    // frame check ("Access violation in stack frame 5") trips during
    // the cascaded init of pool + 4 ATAs in this single instruction.
    #[account(
        init,
        payer = authority,
        space = Pool::SIZE,
        seeds = [SEED_POOL, authority.key().as_ref(), &args.seed_id.to_le_bytes()],
        bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        constraint = usdc_mint.key() == config.usdc_mint @ RoundfiError::InvalidMint,
    )]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: Yield adapter program. Immutable after pool creation. Must be executable.
    #[account(executable)]
    pub yield_adapter: UncheckedAccount<'info>,

    /// CHECK: Escrow vault authority PDA (seeds verified).
    #[account(seeds = [SEED_ESCROW, pool.key().as_ref()], bump)]
    pub escrow_vault_authority: UncheckedAccount<'info>,

    /// CHECK: Solidarity vault authority PDA (seeds verified).
    #[account(seeds = [SEED_SOLIDARITY, pool.key().as_ref()], bump)]
    pub solidarity_vault_authority: UncheckedAccount<'info>,

    /// CHECK: Yield vault authority PDA (seeds verified).
    #[account(seeds = [SEED_YIELD, pool.key().as_ref()], bump)]
    pub yield_vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool,
    )]
    pub pool_usdc_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = escrow_vault_authority,
    )]
    pub escrow_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = solidarity_vault_authority,
    )]
    pub solidarity_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = yield_vault_authority,
    )]
    pub yield_vault: Box<Account<'info, TokenAccount>>,

    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:           Program<'info, System>,
    pub rent:                     Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<CreatePool>, args: CreatePoolArgs) -> Result<()> {
    require!(
        args.members_target > 0 && args.members_target <= MAX_MEMBERS,
        RoundfiError::InvalidMembersTarget,
    );
    require!(args.installment_amount > 0, RoundfiError::InvalidAmount);
    require!(args.credit_amount      > 0, RoundfiError::InvalidAmount);
    require!(args.cycles_total       > 0, RoundfiError::InvalidPoolParams);
    require!(
        args.cycle_duration >= MIN_CYCLE_DURATION,
        RoundfiError::InvalidCycleDuration,
    );
    require!(args.escrow_release_bps <= MAX_BPS, RoundfiError::InvalidBps);

    // One payout per member per cycle → cycles_total must accommodate every slot.
    require!(
        args.cycles_total as u16 >= args.members_target as u16,
        RoundfiError::InvalidPoolParams,
    );

    let pool = &mut ctx.accounts.pool;

    pool.authority          = ctx.accounts.authority.key();
    pool.seed_id            = args.seed_id;
    pool.usdc_mint          = ctx.accounts.usdc_mint.key();
    pool.yield_adapter      = ctx.accounts.yield_adapter.key();

    pool.members_target     = args.members_target;
    pool.installment_amount = args.installment_amount;
    pool.credit_amount      = args.credit_amount;
    pool.cycles_total       = args.cycles_total;
    pool.cycle_duration     = args.cycle_duration;
    pool.seed_draw_bps      = SEED_DRAW_BPS;
    pool.solidarity_bps     = SOLIDARITY_BPS;
    pool.escrow_release_bps = args.escrow_release_bps;

    pool.members_joined     = 0;
    pool.status             = PoolStatus::Forming as u8;
    pool.started_at         = 0;
    pool.current_cycle      = 0;
    pool.next_cycle_at      = 0;
    pool.total_contributed  = 0;
    pool.total_paid_out     = 0;
    pool.solidarity_balance = 0;
    pool.escrow_balance     = 0;
    pool.yield_accrued      = 0;
    pool.slots_bitmap       = [0u8; 8];

    pool.bump                  = ctx.bumps.pool;
    pool.escrow_vault_bump     = ctx.bumps.escrow_vault_authority;
    pool.solidarity_vault_bump = ctx.bumps.solidarity_vault_authority;
    pool.yield_vault_bump      = ctx.bumps.yield_vault_authority;

    msg!(
        "roundfi-core: pool created seed_id={} members_target={}",
        args.seed_id,
        args.members_target,
    );
    Ok(())
}
