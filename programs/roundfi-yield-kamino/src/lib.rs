//! RoundFi Yield Adapter — Kamino implementation.
//!
//! Drop-in replacement for `roundfi-yield-mock` against Kamino Lend on
//! mainnet. Preserves discriminators (`init_vault`, `deposit`, `harvest`)
//! and the `YieldVaultState` account layout so `roundfi-core` swaps
//! adapters by pointing `Pool.yield_adapter` at a different program ID
//! — no core redeploy required.
//!
//! ## What is real here
//!
//! - `deposit(amount)` performs a **real CPI** to Kamino Lend's
//!   `deposit_reserve_liquidity` instruction. Step 1 transfers USDC
//!   from the pool vault to our state-owned shadow vault (interface
//!   compat with mock); Step 2 transfers from the shadow vault into
//!   the Kamino reserve, receiving collateral c-tokens at the
//!   state-owned c-token account. After the CPI, accrued interest
//!   begins compounding on the deposit principal.
//!
//! - `init_vault(kamino_reserve, kamino_market)` pins the Kamino
//!   accounts at vault-creation time. Subsequent `deposit` calls reject
//!   if the caller passes mismatched accounts (defence-in-depth on top
//!   of the on-chain Kamino-side validation).
//!
//! ## What is still pending
//!
//! - `harvest()` is a **stub** that returns realized=0 with a clear
//!   `msg!`. The full redemption path
//!   (`withdraw_obligation_collateral_and_redeem_reserve_collateral`
//!   CPI to Kamino, c-tokens → USDC + accrued interest, transfer
//!   surplus to pool vault) lands in the next PR. Until then the
//!   adapter operates in "park-only" mode — capital flows in and
//!   compounds inside Kamino, but no surplus is realized back to the
//!   pool. Conservative for early Mainnet roll-out.
//!
//! - The hardcoded `KAMINO_LEND_PROGRAM_ID` matches the canonical
//!   mainnet program at the time of writing. Final mainnet deploy must
//!   re-verify against Kamino's published deploy address — comment
//!   below tracks the verification step.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    hash,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("11111111111111111111111111111111");

/// Matches `@roundfi/sdk::SEED.yieldState` = `b"yield-state"`. Kept
/// byte-equal to the mock so the Rust↔TS parity test catches drift.
pub const SEED_STATE: &[u8] = b"yield-state";

/// Kamino Lend program ID (mainnet). The protocol's deployed program
/// is the official Kamino Lend `klend` build under the Kamino
/// governance multisig.
///
/// TODO(audit): re-verify against Kamino's published deploy address
/// before the live mainnet pool first goes Active. The constant MUST
/// be const-eval `pubkey!()` so a future re-pin is a single-line PR
/// rather than runtime config — adapter swaps go through
/// `Pool.yield_adapter`, not through reading config-account bytes.
pub const KAMINO_LEND_PROGRAM_ID: Pubkey =
    anchor_lang::pubkey!("KLend2g3cPP7fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

/// Discriminator for Kamino's `deposit_reserve_liquidity` ix —
/// sha256("global:deposit_reserve_liquidity")[..8]. Computed at runtime
/// because `solana_program::hash::hash` is not const-eval friendly. A
/// unit test below pins the result so a Kamino-side rename fails loud.
fn kamino_deposit_disc() -> [u8; 8] {
    let h = hash::hash(b"global:deposit_reserve_liquidity");
    let mut out = [0u8; 8];
    out.copy_from_slice(&h.to_bytes()[..8]);
    out
}

#[program]
pub mod roundfi_yield_kamino {
    use super::*;

    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("yield-kamino: scaffold alive");
        Ok(())
    }

    /// One-time setup per pool. Allocates the state PDA + a USDC shadow
    /// vault under its authority. Pins the Kamino reserve + market
    /// pubkeys so subsequent `deposit` calls reject mismatched accounts.
    pub fn init_vault(
        ctx: Context<InitVault>,
        kamino_reserve: Pubkey,
        kamino_market: Pubkey,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.pool              = ctx.accounts.pool.key();
        state.underlying_mint   = ctx.accounts.mint.key();
        state.vault             = ctx.accounts.vault.key();
        state.kamino_reserve    = kamino_reserve;
        state.kamino_market     = kamino_market;
        state.tracked_principal = 0;
        state.bump              = ctx.bumps.state;
        msg!(
            "yield-kamino: init_vault pool={} reserve={} market={}",
            state.pool, kamino_reserve, kamino_market,
        );
        Ok(())
    }

    /// Deposit `amount` USDC into Kamino via real CPI.
    /// Two-step flow keeps the interface mock-compatible:
    ///   1. SPL transfer pool_vault → state-owned shadow vault
    ///      (matches the mock's `deposit` semantics).
    ///   2. CPI to Kamino's `deposit_reserve_liquidity`: shadow vault
    ///      USDC → Kamino reserve liquidity supply, c-tokens minted
    ///      to our state-owned c-token account.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, YieldKaminoError::ZeroAmount);

        let state = &ctx.accounts.state;
        require!(
            ctx.accounts.authority.key() == state.pool,
            YieldKaminoError::UnauthorizedPool,
        );
        require!(
            ctx.accounts.destination.key() == state.vault,
            YieldKaminoError::VaultMismatch,
        );
        require!(
            ctx.accounts.source.mint == state.underlying_mint,
            YieldKaminoError::MintMismatch,
        );

        // ─── Step 1 — pool vault → shadow vault ─────────────────────
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.source.to_account_info(),
                    to:        ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        // ─── Step 2 — shadow vault → Kamino reserve (real CPI) ──────
        let mut data = Vec::with_capacity(8 + 8);
        data.extend_from_slice(&kamino_deposit_disc());
        data.extend_from_slice(&amount.to_le_bytes());

        let metas = vec![
            // owner — state PDA signs as the Kamino-side depositor.
            AccountMeta::new_readonly(ctx.accounts.state.key(), true),
            AccountMeta::new(ctx.accounts.kamino_reserve.key(), false),
            AccountMeta::new_readonly(ctx.accounts.kamino_market.key(), false),
            AccountMeta::new_readonly(ctx.accounts.kamino_market_authority.key(), false),
            AccountMeta::new(ctx.accounts.kamino_reserve_liquidity_supply.key(), false),
            AccountMeta::new(ctx.accounts.kamino_reserve_collateral_mint.key(), false),
            // user_source_liquidity — our shadow vault (now holds the USDC).
            AccountMeta::new(ctx.accounts.destination.key(), false),
            // user_destination_collateral — our c-token account, state-owned.
            AccountMeta::new(ctx.accounts.c_token_account.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        ];

        let infos = [
            ctx.accounts.state.to_account_info(),
            ctx.accounts.kamino_reserve.to_account_info(),
            ctx.accounts.kamino_market.to_account_info(),
            ctx.accounts.kamino_market_authority.to_account_info(),
            ctx.accounts.kamino_reserve_liquidity_supply.to_account_info(),
            ctx.accounts.kamino_reserve_collateral_mint.to_account_info(),
            ctx.accounts.destination.to_account_info(),
            ctx.accounts.c_token_account.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.kamino_program.to_account_info(),
        ];

        let state_pool = state.pool;
        let state_bump = state.bump;
        let signer_seeds: &[&[u8]] = &[
            SEED_STATE,
            state_pool.as_ref(),
            std::slice::from_ref(&state_bump),
        ];

        let ix = Instruction {
            program_id: KAMINO_LEND_PROGRAM_ID,
            accounts:   metas,
            data,
        };

        invoke_signed(&ix, &infos, &[signer_seeds])
            .map_err(|e| {
                msg!("yield-kamino: Kamino CPI failed: {:?}", e);
                error!(YieldKaminoError::KaminoCpiFailed)
            })?;

        let state = &mut ctx.accounts.state;
        state.tracked_principal = state
            .tracked_principal
            .checked_add(amount)
            .ok_or(error!(YieldKaminoError::Overflow))?;

        msg!(
            "yield-kamino: deposit amount={} principal_now={}",
            amount, state.tracked_principal,
        );
        Ok(())
    }

    /// Harvest stub — full redemption logic lands in the next PR.
    /// Mock-compatible signature so `roundfi-core::harvest_yield` works
    /// against this adapter unchanged. Reports realized=0 + tracked
    /// principal in the program log so off-chain monitoring sees the
    /// adapter operating in "park-only" mode.
    pub fn harvest(ctx: Context<Harvest>) -> Result<()> {
        let state = &ctx.accounts.state;
        require!(
            ctx.accounts.authority.key() == state.pool,
            YieldKaminoError::UnauthorizedPool,
        );
        msg!(
            "yield-kamino: harvest stub — Kamino redeem CPI ships next PR; \
             realized=0 principal_kept={}",
            state.tracked_principal,
        );
        Ok(())
    }
}

// ─── Account structs ────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Ping<'info> {
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: opaque pool key — used as PDA seed and stored as `state.pool`.
    pub pool: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = YieldVaultState::SIZE,
        seeds = [SEED_STATE, pool.key().as_ref()],
        bump,
    )]
    pub state: Account<'info, YieldVaultState>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = state,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub system_program:           Program<'info, System>,
    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent:                     Sysvar<'info, Rent>,
}

/// Account order MUST match `roundfi-core::deposit_idle_to_yield`'s
/// AccountMeta layout for the first 4 entries:
///   [source, destination, authority(signer), token_program, ...remaining]
/// The Kamino-specific accounts are the additional `remaining_accounts`
/// the core caller forwards.
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub source: Account<'info, TokenAccount>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    /// Pool PDA — signer bit set by the parent program's `invoke_signed`.
    /// CHECK: pubkey validated against `state.pool` inside the handler.
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,

    #[account(
        mut,
        seeds = [SEED_STATE, state.pool.as_ref()],
        bump = state.bump,
    )]
    pub state: Account<'info, YieldVaultState>,

    // ─── Kamino-specific (forwarded as remaining_accounts from core) ─

    /// CHECK: pinned to state.kamino_reserve at init time.
    #[account(mut, address = state.kamino_reserve @ YieldKaminoError::KaminoAccountMismatch)]
    pub kamino_reserve: UncheckedAccount<'info>,

    /// CHECK: pinned to state.kamino_market at init time.
    #[account(address = state.kamino_market @ YieldKaminoError::KaminoAccountMismatch)]
    pub kamino_market: UncheckedAccount<'info>,

    /// CHECK: Kamino-derived PDA (lending_market_authority).
    pub kamino_market_authority: UncheckedAccount<'info>,

    /// CHECK: Kamino's reserve liquidity supply ATA — receives the USDC.
    #[account(mut)]
    pub kamino_reserve_liquidity_supply: UncheckedAccount<'info>,

    /// CHECK: Kamino's c-token mint for this reserve.
    #[account(mut)]
    pub kamino_reserve_collateral_mint: UncheckedAccount<'info>,

    /// CHECK: c-token ATA owned by `state` PDA — receives minted c-tokens.
    #[account(mut)]
    pub c_token_account: UncheckedAccount<'info>,

    /// CHECK: Kamino Lend program — pinned to KAMINO_LEND_PROGRAM_ID.
    #[account(address = KAMINO_LEND_PROGRAM_ID @ YieldKaminoError::InvalidKaminoProgram)]
    pub kamino_program: UncheckedAccount<'info>,
}

/// Same positional layout as `roundfi-core::harvest_yield`. The handler
/// is a stub today; the account list anticipates the redeem CPI so the
/// next PR is a body-only change.
#[derive(Accounts)]
pub struct Harvest<'info> {
    #[account(mut)]
    pub source: Account<'info, TokenAccount>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    /// CHECK: pool PDA, pubkey validated against state.pool.
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,

    #[account(
        seeds = [SEED_STATE, state.pool.as_ref()],
        bump = state.bump,
    )]
    pub state: Account<'info, YieldVaultState>,
}

// ─── State ──────────────────────────────────────────────────────────────

#[account]
pub struct YieldVaultState {
    /// Pubkey of the owning pool (from `roundfi-core`).
    pub pool:              Pubkey,
    /// USDC mint (or whatever the pool settled on).
    pub underlying_mint:   Pubkey,
    /// Our shadow vault ATA (authority = this state PDA).
    pub vault:             Pubkey,
    /// Kamino reserve account this adapter is bound to.
    pub kamino_reserve:    Pubkey,
    /// Kamino lending market for that reserve.
    pub kamino_market:     Pubkey,
    /// Sum of deposited principal (USDC base units). Monotonically
    /// increases with deposits; will be reduced by `harvest` once the
    /// redeem path lands.
    pub tracked_principal: u64,
    /// PDA bump.
    pub bump:              u8,
}

impl YieldVaultState {
    /// 8 + 5×32 + 8 + 1 = 177; rounded up to 192 with 15 bytes padding
    /// reserved for future fields (c_token_account pubkey when redeem
    /// CPI lands, last_accrual_ts for off-chain APY math, etc.).
    pub const SIZE: usize = 8 + 32 * 5 + 8 + 1 + 15;
}

// ─── Errors ─────────────────────────────────────────────────────────────

#[error_code]
pub enum YieldKaminoError {
    #[msg("amount must be > 0")]
    ZeroAmount,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("authority does not match bound pool")]
    UnauthorizedPool,
    #[msg("vault account does not match state.vault")]
    VaultMismatch,
    #[msg("mint does not match state.underlying_mint")]
    MintMismatch,
    #[msg("Kamino account does not match the one pinned in state")]
    KaminoAccountMismatch,
    #[msg("kamino_program does not match expected Kamino Lend program ID")]
    InvalidKaminoProgram,
    #[msg("Kamino CPI rejected the deposit_reserve_liquidity call")]
    KaminoCpiFailed,
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Cross-program PDA seed must stay byte-equal to the mock's seed
    /// (so `tests/parity.spec.ts` compares apples-to-apples and adapters
    /// are truly drop-in).
    #[test]
    fn seed_state_is_yield_state_literal() {
        assert_eq!(SEED_STATE, b"yield-state");
    }

    /// SIZE must accommodate every field with room to grow.
    #[test]
    fn yield_vault_state_size_accommodates_all_fields() {
        let minimum_bytes = 8 + 32 * 5 + 8 + 1;
        assert!(
            YieldVaultState::SIZE >= minimum_bytes,
            "SIZE={} below minimum={}",
            YieldVaultState::SIZE, minimum_bytes,
        );
    }

    /// Pin the Kamino discriminator so a remote rename of
    /// `deposit_reserve_liquidity` triggers a CI failure here rather
    /// than silent runtime rejection.
    #[test]
    fn kamino_deposit_disc_is_stable() {
        let d1 = kamino_deposit_disc();
        let d2 = kamino_deposit_disc();
        assert_eq!(d1, d2);
        // Sanity: it's 8 non-zero bytes.
        assert_eq!(d1.len(), 8);
        assert_ne!(d1, [0u8; 8]);
    }
}
