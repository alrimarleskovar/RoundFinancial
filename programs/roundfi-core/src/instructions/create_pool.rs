use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::math::pool_is_viable;
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

/// Creates the Pool PDA + records the three vault-authority bumps.
///
/// **Vault ATA initialization is handled in a separate `init_pool_vaults`
/// instruction.** Splitting them keeps stack frame depth manageable on
/// Solana 3.x (Agave): the original combined ix tripped
/// "Access violation in stack frame 5" because Anchor's `init` macro
/// validates all constraint paths recursively at the same frame depth,
/// and 5 simultaneous inits (Pool + 4 ATAs) overflow even with `Box<>`.
/// CPIs called from a handler don't accumulate stack — they push and pop
/// — so doing the 4 ATA creates sequentially in a follow-up handler is
/// stack-safe.
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
    pub usdc_mint: Box<Account<'info, anchor_spl::token::Mint>>,

    /// CHECK: Yield adapter program. Immutable after pool creation. Must be executable.
    #[account(executable)]
    pub yield_adapter: UncheckedAccount<'info>,

    /// CHECK: Escrow vault authority PDA. We derive its bump now; the actual
    /// USDC ATA gets created in `init_pool_vaults`.
    #[account(seeds = [SEED_ESCROW, pool.key().as_ref()], bump)]
    pub escrow_vault_authority: UncheckedAccount<'info>,

    /// CHECK: Solidarity vault authority PDA (same comment as escrow).
    #[account(seeds = [SEED_SOLIDARITY, pool.key().as_ref()], bump)]
    pub solidarity_vault_authority: UncheckedAccount<'info>,

    /// CHECK: Yield vault authority PDA (same comment as escrow).
    #[account(seeds = [SEED_YIELD, pool.key().as_ref()], bump)]
    pub yield_vault_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
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

    // ─── Adevar Labs SEV-031 — pool viability runtime guard ───────────
    //
    // **SEV-025 (W2)** fixed the protocol *defaults* to be viable
    // (`DEFAULT_INSTALLMENT_AMOUNT` 416 → 600 USDC) and added a test-
    // suite invariant pinning the math. But a pool authority can still
    // call `create_pool` with custom args that produce an inviable
    // pool: `members × installment × (1 − solidarity − escrow) < credit`.
    // Cycle 0 `claim_payout` then always fails the 91.6% Seed Draw
    // retention guard (`WaterfallUnderflow`), trapping member
    // contributions until the authority manually winds the pool down.
    //
    // **SEV-031 (W3)** asks for the same invariant the test pins to be
    // enforced at runtime — refuse to allocate the Pool PDA at all if
    // the math doesn't close. The check is identical in shape to the
    // unit test in `constants.rs::pool_defaults_match_product_spec`:
    //
    //   pool_float = members × installment × (1 − sol_bps − escrow_bps)
    //              / MAX_BPS
    //   require pool_float >= credit
    //
    // We use u128 intermediate to avoid overflow on legitimate large
    // pools (24 members × 1_000 USDC × 9_900 ≈ 2.4e11, well under
    // u128::MAX).
    //
    // Solidarity is a global constant (`SOLIDARITY_BPS`); escrow is
    // per-pool (`args.escrow_release_bps`). Both feed the same retention
    // formula. The check fails closed: if any term would underflow
    // (escrow + solidarity > MAX_BPS), the pool is trivially inviable
    // and we reject.
    // Delegates to `crates::math::pool_is_viable` so the invariant is
    // exercised by the math crate's unit tests AND by the on-chain
    // handler — same code path, no drift between the test fixture and
    // production logic. (The auditor's W3 process note about avoiding
    // duplicated financial math — SEV-026 — applies here too.)
    let viable = pool_is_viable(
        args.members_target,
        args.installment_amount,
        args.credit_amount,
        SOLIDARITY_BPS,
        args.escrow_release_bps,
    )?;
    require!(viable, RoundfiError::PoolNotViable);

    // ─── Yield-adapter allowlist (item 4.4 of MAINNET_READINESS) ─────
    //
    // When `config.approved_yield_adapter` is set (non-default), the
    // pool's chosen yield_adapter program MUST match. Default
    // (Pubkey::default()) disables the check — devnet back-compat.
    //
    // The `#[account(executable)]` constraint on `yield_adapter`
    // already guarantees the account is a program. This check adds
    // the protocol-level pin: even if a pool creator passes a valid
    // (executable) but unapproved program, the create reverts here
    // before any state is allocated.
    if ctx.accounts.config.approved_yield_adapter != Pubkey::default() {
        require!(
            ctx.accounts.yield_adapter.key() == ctx.accounts.config.approved_yield_adapter,
            RoundfiError::InvalidYieldAdapter,
        );
    }

    // ─── TVL cap fail-fast (items 4.2 + 4.3 of MAINNET_READINESS) ─────
    //
    // The authoritative TVL accounting lives in `init_pool_vaults`:
    // that's where `committed_protocol_tvl_usdc` is incremented and
    // the race-free reservation happens. But the cap CHECK belongs
    // here, BEFORE the Pool PDA is allocated, so a rejected pool
    // doesn't leak ~3kb of orphan rent on the authority's account.
    //
    // Without this fail-fast: `create_pool` allocates Pool PDA →
    // `init_pool_vaults` rejects on cap → Pool PDA stuck in Forming
    // status with no vaults (close_pool requires Completed, so the
    // PDA can never be closed). Reported by external review post #310.
    //
    // We do NOT increment `committed_protocol_tvl_usdc` here — that
    // stays in `init_pool_vaults` so the running total only grows
    // when vaults are actually allocated. Two consequences:
    //
    //   1. Authority can `create_pool` repeatedly with no committed-
    //      total bookkeeping side-effects — only the final
    //      `init_pool_vaults` call commits.
    //   2. Race between create + init: if Pool A creates, Pool B
    //      creates + inits (consuming headroom), Pool A inits → A's
    //      init_pool_vaults rejects on cap. Benign DoS — A's Pool PDA
    //      already exists but can be retried after a cap raise or
    //      another pool closes. This is acceptable.
    let pool_committed = (args.credit_amount as u128)
        .checked_mul(args.cycles_total as u128)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    let pool_committed: u64 = pool_committed
        .try_into()
        .map_err(|_| error!(RoundfiError::MathOverflow))?;

    if ctx.accounts.config.max_pool_tvl_usdc > 0 {
        require!(
            pool_committed <= ctx.accounts.config.max_pool_tvl_usdc,
            RoundfiError::PoolTvlCapExceeded,
        );
    }
    if ctx.accounts.config.max_protocol_tvl_usdc > 0 {
        let new_committed = ctx
            .accounts
            .config
            .committed_protocol_tvl_usdc
            .checked_add(pool_committed)
            .ok_or(error!(RoundfiError::MathOverflow))?;
        require!(
            new_committed <= ctx.accounts.config.max_protocol_tvl_usdc,
            RoundfiError::ProtocolTvlCapExceeded,
        );
    }

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
        "roundfi-core: pool created seed_id={} members_target={} (vaults pending init_pool_vaults)",
        args.seed_id,
        args.members_target,
    );
    Ok(())
}
