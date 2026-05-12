//! RoundFi Yield Adapter — minimum-viable mock.
//!
//! Exposes the three instructions `roundfi-core` expects from any yield
//! adapter:
//!   * `deposit(amount)` — pool_vault → yield_vault (authority: pool PDA
//!     passed through as signer; we do not sign here).
//!   * `harvest()` — yield_vault → pool_vault for whatever is above the
//!     tracked principal (authority: our state PDA, which owns the
//!     vault ATA).
//!
//! Scope is intentionally Option-C minimal (see Step 5c decision):
//!   * no APY, no time-based accrual — pre-fund the vault from tests and
//!     `harvest` will return the surplus;
//!   * one PDA per pool (`state`), which doubles as the vault authority;
//!   * every call is bound to the owning `pool` (set at `init_vault`),
//!     so a stray caller cannot drain the vault by impersonation.
//!
//! The Kamino adapter (out of scope for Step 5c) will ship behind the
//! same discriminator + account order and therefore be a drop-in
//! replacement.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ");

/// Matches `@roundfi/sdk::SEED.yieldState` = `b"yield-state"`.
/// Keep this string-identical to the TS constant — the Rust↔TS parity
/// test in `tests/parity.spec.ts` will flag drift.
pub const SEED_STATE: &[u8] = b"yield-state";

#[program]
pub mod roundfi_yield_mock {
    use super::*;

    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("roundfi-yield-mock: scaffold alive");
        Ok(())
    }

    /// One-time setup per pool: allocate the state PDA and its
    /// state-owned vault ATA. Must be called before any `deposit` /
    /// `harvest` from `roundfi-core` targeting this pool.
    pub fn init_vault(ctx: Context<InitVault>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.pool              = ctx.accounts.pool.key();
        state.underlying_mint   = ctx.accounts.mint.key();
        state.vault             = ctx.accounts.vault.key();
        state.tracked_principal = 0;
        state.bump              = ctx.bumps.state;
        msg!(
            "yield-mock: init_vault pool={} mint={} vault={}",
            state.pool, state.underlying_mint, state.vault,
        );
        Ok(())
    }

    /// Receive `amount` tokens from `source` into our `vault`. The
    /// SPL transfer is authorized by the pool PDA whose signature is
    /// propagated from the parent `invoke_signed` in core.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, YieldMockError::ZeroAmount);

        let state = &ctx.accounts.state;
        require!(
            ctx.accounts.authority.key() == state.pool,
            YieldMockError::UnauthorizedPool,
        );
        require!(
            ctx.accounts.destination.key() == state.vault,
            YieldMockError::VaultMismatch,
        );
        require!(
            ctx.accounts.source.mint == state.underlying_mint,
            YieldMockError::MintMismatch,
        );
        require!(
            ctx.accounts.destination.mint == state.underlying_mint,
            YieldMockError::MintMismatch,
        );

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

        let state = &mut ctx.accounts.state;
        state.tracked_principal = state
            .tracked_principal
            .checked_add(amount)
            .ok_or(error!(YieldMockError::Overflow))?;

        msg!(
            "yield-mock: deposit amount={} principal_now={}",
            amount, state.tracked_principal,
        );
        Ok(())
    }

    /// Send `source.amount - tracked_principal` back to `destination`.
    /// Principal stays in the vault; only the pre-funded surplus flows
    /// out. The state PDA (vault authority) signs the transfer.
    ///
    /// `destination.owner` must equal the bound `pool` — prevents a
    /// stray caller from routing yield to an arbitrary token account.
    pub fn harvest(ctx: Context<Harvest>) -> Result<()> {
        let state = &ctx.accounts.state;
        require!(
            ctx.accounts.authority.key() == state.pool,
            YieldMockError::UnauthorizedPool,
        );
        require!(
            ctx.accounts.source.key() == state.vault,
            YieldMockError::VaultMismatch,
        );
        require!(
            ctx.accounts.destination.owner == state.pool,
            YieldMockError::DestinationNotPoolOwned,
        );
        require!(
            ctx.accounts.destination.mint == state.underlying_mint,
            YieldMockError::MintMismatch,
        );

        let source_amount = ctx.accounts.source.amount;
        let tracked       = state.tracked_principal;
        let yield_amount  = source_amount.saturating_sub(tracked);

        if yield_amount == 0 {
            msg!(
                "yield-mock: harvest realized=0 principal_kept={}",
                tracked,
            );
            return Ok(());
        }

        let state_pool = state.pool;
        let state_bump = state.bump;
        let signer_seeds: &[&[u8]] = &[
            SEED_STATE,
            state_pool.as_ref(),
            std::slice::from_ref(&state_bump),
        ];
        let signer_seeds_arr: &[&[&[u8]]] = &[signer_seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.source.to_account_info(),
                    to:        ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.state.to_account_info(),
                },
                signer_seeds_arr,
            ),
            yield_amount,
        )?;

        msg!(
            "yield-mock: harvest realized={} principal_kept={}",
            yield_amount, tracked,
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

    /// CHECK: Opaque — used as PDA seed and stored as `state.pool`.
    /// Anchor does not deserialize pool state here; that is core's job.
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
/// AccountMeta layout:
///   [source, destination, authority(signer, readonly), token_program,
///    ...remaining]
///
/// `remaining_accounts` on the core RPC carries `state` as the first
/// (and only) extra — it arrives here in the 5th position.
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub source: Account<'info, TokenAccount>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    /// Pool PDA; signer bit set by the parent program's `invoke_signed`.
    /// CHECK: Signer presence is all we need; pubkey is validated
    /// against `state.pool` inside the handler.
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,

    #[account(
        mut,
        seeds = [SEED_STATE, state.pool.as_ref()],
        bump = state.bump,
    )]
    pub state: Account<'info, YieldVaultState>,
}

/// Same positional layout as `roundfi-core::harvest_yield`:
///   [source(yield_vault), destination(pool_vault),
///    authority(signer, readonly), token_program, ...remaining]
#[derive(Accounts)]
pub struct Harvest<'info> {
    #[account(mut)]
    pub source: Account<'info, TokenAccount>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    /// CHECK: Pool PDA; signed by parent invoker. Pubkey validated
    /// against `state.pool`.
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
    /// Pubkey of the owning pool (from `roundfi-core`). Only this key,
    /// acting as signer, may call `deposit` / `harvest` against us.
    pub pool:              Pubkey,
    /// USDC mint (or whatever the pool settled on).
    pub underlying_mint:   Pubkey,
    /// Our own vault ATA (authority = this state PDA).
    pub vault:             Pubkey,
    /// Sum of deposited principal. Reduced by harvest only if the
    /// caller asks — not implemented in the minimum-viable mock, so
    /// this monotonically increases.
    pub tracked_principal: u64,
    pub bump:              u8,
}

impl YieldVaultState {
    pub const SIZE: usize =
          8      // anchor discriminator
        + 32     // pool
        + 32     // underlying_mint
        + 32     // vault
        + 8      // tracked_principal
        + 1      // bump
        + 15;    // padding reserved for future fields (APY, last_accrual_ts, ...)
}

// ─── Errors ─────────────────────────────────────────────────────────────

#[error_code]
pub enum YieldMockError {
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
    #[msg("destination token account is not owned by the bound pool")]
    DestinationNotPoolOwned,
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// The mock's state-PDA seed MUST stay byte-equal to the SDK constant;
    /// any drift makes `yieldVaultStatePda()` from TS fail to match the
    /// PDA the program derives. `tests/parity.spec.ts` enforces this at
    /// CI time, but checking here gives a local fast-fail as well.
    #[test]
    fn seed_state_is_yield_state_literal() {
        assert_eq!(SEED_STATE, b"yield-state");
    }

    /// Anchor-allocated size must be at least discriminator + fields.
    /// If a future refactor adds a field without growing SIZE, on-chain
    /// allocation will silently truncate — catch it here.
    #[test]
    fn yield_vault_state_size_accommodates_all_fields() {
        let minimum_bytes =
              8            // discriminator
            + 32 + 32 + 32 // pubkeys
            + 8            // tracked_principal
            + 1;           // bump
        assert!(
            YieldVaultState::SIZE >= minimum_bytes,
            "SIZE={} is below minimum={}",
            YieldVaultState::SIZE, minimum_bytes,
        );
    }
}
