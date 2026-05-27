//! `close_pool_vaults` — final step of the SEV-039 rent-reclaim ceremony.
//!
//! `close_pool` flips the pool to `Closed` but moves no funds and closes no
//! accounts; `close_member` reclaims each Member PDA's rent. This instruction
//! finishes the job: it drains every residual USDC balance out of the four
//! vaults into the protocol treasury, closes the four vault ATAs, and closes
//! the Pool PDA — returning all of that rent to `rent_recipient`.
//!
//! Ceremony order (operational):
//!   `close_pool` → `close_member` × N → `close_pool_vaults`
//!
//! The `members_joined == 0` guard enforces that order: `close_member`
//! decrements `members_joined` (repurposed post-close as the live open-Member
//! count), and this ix won't close the Pool PDA until it reaches 0. Closing the
//! Pool PDA first would make the `[b"member", pool, wallet]` seed unsatisfiable,
//! stranding every un-closed Member PDA's rent.
//!
//! Residual destination (founder decision, 2026-05-27): all vault residuals go
//! to `config.treasury`. A `Closed` pool has no remaining on-chain member claim
//! — every claim_payout / release_escrow / settle_default path is gated on
//! Active/Completed and a specific live member — so the residual (forfeited
//! pots, Cofre Solidário, GF / LP earmark, rounding dust) is protocol funds.
//! The treasury is itself governed by the 7-day rotation timelock + Squads
//! multisig, so this does not hand a hot key any new spending power.

use anchor_lang::prelude::*;
use anchor_spl::token::{
    self, close_account, CloseAccount, Mint, Token, TokenAccount, Transfer,
};

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::{Pool, PoolStatus, ProtocolConfig};

#[derive(Accounts)]
pub struct ClosePoolVaults<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    /// Receives the rent freed by closing the 4 vault ATAs + the Pool PDA.
    /// CHECK: lamport recipient only.
    #[account(mut)]
    pub rent_recipient: UncheckedAccount<'info>,

    /// Closed via Anchor `close = rent_recipient` AFTER the handler drains +
    /// closes the vaults (the handler still needs the live Pool PDA to sign the
    /// `pool_usdc_vault` transfer/close — it is the vault's token authority).
    #[account(
        mut,
        close = rent_recipient,
        seeds = [SEED_POOL, pool.authority.as_ref(), &pool.seed_id.to_le_bytes()],
        bump = pool.bump,
        constraint = pool.status == PoolStatus::Closed as u8 @ RoundfiError::PoolNotClosed,
        constraint = pool.members_joined == 0 @ RoundfiError::MembersStillOpen,
        constraint = (authority.key() == pool.authority || authority.key() == config.authority)
            @ RoundfiError::Unauthorized,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(constraint = usdc_mint.key() == pool.usdc_mint @ RoundfiError::InvalidMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// Drain destination — pinned to `config.treasury` (the treasury USDC token
    /// account set at `initialize_protocol`).
    #[account(
        mut,
        constraint = treasury_usdc.key() == config.treasury @ RoundfiError::Unauthorized,
        constraint = treasury_usdc.mint == pool.usdc_mint @ RoundfiError::InvalidMint,
    )]
    pub treasury_usdc: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA, seeds verified.
    #[account(seeds = [SEED_ESCROW, pool.key().as_ref()], bump = pool.escrow_vault_bump)]
    pub escrow_vault_authority: UncheckedAccount<'info>,

    /// CHECK: PDA, seeds verified.
    #[account(seeds = [SEED_SOLIDARITY, pool.key().as_ref()], bump = pool.solidarity_vault_bump)]
    pub solidarity_vault_authority: UncheckedAccount<'info>,

    /// CHECK: PDA, seeds verified.
    #[account(seeds = [SEED_YIELD, pool.key().as_ref()], bump = pool.yield_vault_bump)]
    pub yield_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool,
    )]
    pub pool_usdc_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = escrow_vault_authority,
    )]
    pub escrow_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = solidarity_vault_authority,
    )]
    pub solidarity_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = yield_vault_authority,
    )]
    pub yield_vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

/// Transfer the vault's full residual to treasury (if any), then close the ATA,
/// returning its rent to `rent_recipient`. `authority` is the vault's token
/// authority PDA; `signer_seeds` are its PDA seeds (incl. bump). Returns the
/// amount drained, for the summary log.
fn drain_and_close<'info>(
    token_program: &Program<'info, Token>,
    vault: &Account<'info, TokenAccount>,
    treasury: &Account<'info, TokenAccount>,
    authority: AccountInfo<'info>,
    rent_recipient: AccountInfo<'info>,
    signer_seeds: &[&[u8]],
) -> Result<u64> {
    let amount = vault.amount;
    if amount > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                Transfer {
                    from: vault.to_account_info(),
                    to: treasury.to_account_info(),
                    authority: authority.clone(),
                },
                &[signer_seeds],
            ),
            amount,
        )?;
    }
    close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        CloseAccount {
            account: vault.to_account_info(),
            destination: rent_recipient,
            authority,
        },
        &[signer_seeds],
    ))?;
    Ok(amount)
}

pub fn handler(ctx: Context<ClosePoolVaults>) -> Result<()> {
    let pool_key = ctx.accounts.pool.key();
    let authority_key = ctx.accounts.pool.authority;
    let seed_id_le = ctx.accounts.pool.seed_id.to_le_bytes();
    let pool_bump = ctx.accounts.pool.bump;
    let escrow_bump = ctx.accounts.pool.escrow_vault_bump;
    let solidarity_bump = ctx.accounts.pool.solidarity_vault_bump;
    let yield_bump = ctx.accounts.pool.yield_vault_bump;

    let pool_seeds: &[&[u8]] = &[
        SEED_POOL,
        authority_key.as_ref(),
        seed_id_le.as_ref(),
        std::slice::from_ref(&pool_bump),
    ];
    let escrow_seeds: &[&[u8]] =
        &[SEED_ESCROW, pool_key.as_ref(), std::slice::from_ref(&escrow_bump)];
    let solidarity_seeds: &[&[u8]] = &[
        SEED_SOLIDARITY,
        pool_key.as_ref(),
        std::slice::from_ref(&solidarity_bump),
    ];
    let yield_seeds: &[&[u8]] =
        &[SEED_YIELD, pool_key.as_ref(), std::slice::from_ref(&yield_bump)];

    let rent_recipient = ctx.accounts.rent_recipient.to_account_info();
    let token_program = &ctx.accounts.token_program;
    let treasury = &ctx.accounts.treasury_usdc;

    // pool_usdc_vault is owned by the Pool PDA itself.
    let drained_pool = drain_and_close(
        token_program,
        &ctx.accounts.pool_usdc_vault,
        treasury,
        ctx.accounts.pool.to_account_info(),
        rent_recipient.clone(),
        pool_seeds,
    )?;
    let drained_escrow = drain_and_close(
        token_program,
        &ctx.accounts.escrow_vault,
        treasury,
        ctx.accounts.escrow_vault_authority.to_account_info(),
        rent_recipient.clone(),
        escrow_seeds,
    )?;
    let drained_solidarity = drain_and_close(
        token_program,
        &ctx.accounts.solidarity_vault,
        treasury,
        ctx.accounts.solidarity_vault_authority.to_account_info(),
        rent_recipient.clone(),
        solidarity_seeds,
    )?;
    let drained_yield = drain_and_close(
        token_program,
        &ctx.accounts.yield_vault,
        treasury,
        ctx.accounts.yield_vault_authority.to_account_info(),
        rent_recipient.clone(),
        yield_seeds,
    )?;

    let total_drained = drained_pool
        .checked_add(drained_escrow)
        .and_then(|v| v.checked_add(drained_solidarity))
        .and_then(|v| v.checked_add(drained_yield))
        .ok_or(error!(RoundfiError::MathOverflow))?;

    // The Pool PDA is closed by Anchor's `close = rent_recipient` after this
    // handler returns (it was still needed above to sign the pool_usdc_vault
    // transfer/close as that ATA's token authority).
    msg!(
        "roundfi-core: close_pool_vaults pool={} drained_to_treasury={} (pool={} escrow={} solidarity={} yield={}) — 4 vault ATAs + Pool PDA closed",
        pool_key,
        total_drained,
        drained_pool,
        drained_escrow,
        drained_solidarity,
        drained_yield,
    );
    Ok(())
}
