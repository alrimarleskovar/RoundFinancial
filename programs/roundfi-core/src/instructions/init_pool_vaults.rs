//! `init_pool_vaults` — second half of pool creation.
//!
//! Anchor 0.30 + Solana 3.x can't `init` 5 PDAs (Pool + 4 ATAs) in a
//! single instruction without overflowing the per-frame stack ceiling
//! at depth 5 (the constraint validation is recursive). Boxing
//! everything in `CreatePool` was insufficient — see the `create_pool`
//! header.
//!
//! Workaround: split. `create_pool` allocates the Pool PDA + records
//! the three vault-authority bumps. This instruction creates the four
//! USDC vaults via SPL Associated Token Program CPIs called
//! sequentially from the handler, where each CPI pushes and pops its
//! own frame instead of accumulating like Anchor's `init` constraint
//! does.
//!
//! The end-state is identical to the pre-split `create_pool`:
//!   - pool_usdc_vault     ← ATA(USDC, pool PDA)         pool's settlement vault
//!   - escrow_vault        ← ATA(USDC, escrow_authority) member stake escrow
//!   - solidarity_vault    ← ATA(USDC, solidarity_authority) Cofre Solidário
//!   - yield_vault         ← ATA(USDC, yield_authority)  parked-USDC source
//!
//! Idempotent on retry — `create_idempotent` is a no-op if the ATA
//! already exists at the derived address.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::{create_idempotent, AssociatedToken, Create};
use anchor_spl::token::{Mint, Token};

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::Pool;

#[derive(Accounts)]
pub struct InitPoolVaults<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Pool created by `create_pool`. Bumps for the three vault
    /// authority PDAs are read from here so this ix doesn't have to
    /// re-derive them at compute cost.
    #[account(
        seeds = [SEED_POOL, pool.authority.as_ref(), &pool.seed_id.to_le_bytes()],
        bump = pool.bump,
        constraint = pool.authority == authority.key() @ RoundfiError::Unauthorized,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(constraint = usdc_mint.key() == pool.usdc_mint @ RoundfiError::InvalidMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA, seeds verified.
    #[account(seeds = [SEED_ESCROW, pool.key().as_ref()], bump = pool.escrow_vault_bump)]
    pub escrow_vault_authority: UncheckedAccount<'info>,

    /// CHECK: PDA, seeds verified.
    #[account(seeds = [SEED_SOLIDARITY, pool.key().as_ref()], bump = pool.solidarity_vault_bump)]
    pub solidarity_vault_authority: UncheckedAccount<'info>,

    /// CHECK: PDA, seeds verified.
    #[account(seeds = [SEED_YIELD, pool.key().as_ref()], bump = pool.yield_vault_bump)]
    pub yield_vault_authority: UncheckedAccount<'info>,

    /// CHECK: ATA address derived + validated by the spl_associated_token
    /// CPI inside the handler.
    #[account(mut)]
    pub pool_usdc_vault: UncheckedAccount<'info>,

    /// CHECK: ATA, see above.
    #[account(mut)]
    pub escrow_vault: UncheckedAccount<'info>,

    /// CHECK: ATA, see above.
    #[account(mut)]
    pub solidarity_vault: UncheckedAccount<'info>,

    /// CHECK: ATA, see above.
    #[account(mut)]
    pub yield_vault: UncheckedAccount<'info>,

    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:           Program<'info, System>,
}

pub fn handler(ctx: Context<InitPoolVaults>) -> Result<()> {
    // Each `create_idempotent` call is one CPI:
    //   handler frame → spl_associated_token frame → spl_token frame
    //   then pops back to handler frame before the next iteration.
    // Sequential calls share peak depth instead of stacking.

    create_idempotent(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        Create {
            payer:             ctx.accounts.authority.to_account_info(),
            associated_token:  ctx.accounts.pool_usdc_vault.to_account_info(),
            authority:         ctx.accounts.pool.to_account_info(),
            mint:              ctx.accounts.usdc_mint.to_account_info(),
            system_program:    ctx.accounts.system_program.to_account_info(),
            token_program:     ctx.accounts.token_program.to_account_info(),
        },
    ))?;

    create_idempotent(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        Create {
            payer:             ctx.accounts.authority.to_account_info(),
            associated_token:  ctx.accounts.escrow_vault.to_account_info(),
            authority:         ctx.accounts.escrow_vault_authority.to_account_info(),
            mint:              ctx.accounts.usdc_mint.to_account_info(),
            system_program:    ctx.accounts.system_program.to_account_info(),
            token_program:     ctx.accounts.token_program.to_account_info(),
        },
    ))?;

    create_idempotent(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        Create {
            payer:             ctx.accounts.authority.to_account_info(),
            associated_token:  ctx.accounts.solidarity_vault.to_account_info(),
            authority:         ctx.accounts.solidarity_vault_authority.to_account_info(),
            mint:              ctx.accounts.usdc_mint.to_account_info(),
            system_program:    ctx.accounts.system_program.to_account_info(),
            token_program:     ctx.accounts.token_program.to_account_info(),
        },
    ))?;

    create_idempotent(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        Create {
            payer:             ctx.accounts.authority.to_account_info(),
            associated_token:  ctx.accounts.yield_vault.to_account_info(),
            authority:         ctx.accounts.yield_vault_authority.to_account_info(),
            mint:              ctx.accounts.usdc_mint.to_account_info(),
            system_program:    ctx.accounts.system_program.to_account_info(),
            token_program:     ctx.accounts.token_program.to_account_info(),
        },
    ))?;

    msg!(
        "roundfi-core: init_pool_vaults pool={} (4 ATAs ready)",
        ctx.accounts.pool.key(),
    );
    Ok(())
}
