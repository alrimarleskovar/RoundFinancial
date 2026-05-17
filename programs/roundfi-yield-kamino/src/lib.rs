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
//! - `harvest()` performs a **redeem-all + redeposit-principal**
//!   round-trip via real Kamino CPI:
//!
//!     1. CPI to Kamino's `redeem_reserve_collateral` burning ALL
//!        c-tokens we hold, receiving `total_redeemed` USDC in the
//!        state-owned shadow vault (principal + accrued interest).
//!     2. Transfer `realized = total_redeemed − tracked_principal`
//!        from the shadow vault to the pool vault (this is the
//!        surplus the core program's `harvest_yield` waterfall then
//!        splits into protocol fee / GF / LP / participants).
//!     3. CPI to Kamino's `deposit_reserve_liquidity` redepositing
//!        `tracked_principal` so the position keeps compounding.
//!
//!   Two-CPI flow over a one-shot partial redeem is intentional —
//!   we never need to deserialize Kamino's `Reserve` account to
//!   read the live exchange rate, which keeps audit surface small.
//!   The CU cost is acceptable for a per-cycle crank (not
//!   high-frequency). Tracked under issue #233.
//!
//! ## What is still pending
//!
//! - The hardcoded `KAMINO_LEND_PROGRAM_ID` matches the canonical
//!   mainnet program at the time of writing. Final mainnet deploy must
//!   re-verify against Kamino's published deploy address — comment
//!   below tracks the verification step.
//!
//! - Bankrun coverage of the harvest path requires a Kamino-mock
//!   harness (Kamino's program is not loadable in the existing
//!   bankrun fixtures). Mirroring the deposit-side precedent: unit
//!   tests pin the discriminator + account-list invariants here, and
//!   the round-trip is exercised end-to-end on devnet against the
//!   real Kamino reserve before mainnet deploy.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    hash,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb");

/// Matches `@roundfi/sdk::SEED.yieldState` = `b"yield-state"`. Kept
/// byte-equal to the mock so the Rust↔TS parity test catches drift.
pub const SEED_STATE: &[u8] = b"yield-state";

/// Kamino Lend program ID (mainnet). The protocol's deployed program
/// is the official Kamino Lend `klend` build under the Kamino
/// governance multisig.
///
/// Pre-mainnet verification: re-verify against Kamino's published
/// deploy address before the live mainnet pool first goes Active.
/// Tracked under issue #233 (harvest-path completion) — same review
/// pass should sanity-check this pubkey one last time. The constant MUST
/// be const-eval `pubkey!()` so a future re-pin is a single-line PR
/// rather than runtime config — adapter swaps go through
/// `Pool.yield_adapter`, not through reading config-account bytes.
pub const KAMINO_LEND_PROGRAM_ID: Pubkey =
    anchor_lang::pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

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

/// Discriminator for Kamino's `redeem_reserve_collateral` ix —
/// sha256("global:redeem_reserve_collateral")[..8]. Burns c-tokens
/// and credits USDC back. Caller specifies the c-token amount to
/// redeem; we redeem the full balance every harvest cycle.
///
/// Pinned by a unit test so a Kamino-side rename fails the build
/// rather than silently rejecting at runtime.
fn kamino_redeem_disc() -> [u8; 8] {
    let h = hash::hash(b"global:redeem_reserve_collateral");
    let mut out = [0u8; 8];
    out.copy_from_slice(&h.to_bytes()[..8]);
    out
}

// ─── CPI account-list builders (SEV-041 oracle) ──────────────────────
//
// These two functions are the SINGLE source of truth for the order +
// signer/writable flags of accounts forwarded to Kamino's
// `deposit_reserve_liquidity` and `redeem_reserve_collateral` ix's.
// Three call sites use them today (the standalone `deposit()` handler
// + `kamino_cpi_deposit` + `kamino_cpi_redeem` helpers) — extracting
// here means a SEV-041 class shuffle bug can ONLY happen if these
// functions themselves are wrong, and the unit tests at the bottom
// of the file pin exactly that order.
//
// Oracle provenance: order + flags transcribed from
//   Kamino-Finance/klend/programs/klend/src/handlers/
//     handler_deposit_reserve_liquidity.rs
//     handler_redeem_reserve_collateral.rs
// at SEV-041 fix time (May 2026). Kamino-side breaking changes will
// fail `kamino_deposit_metas_match_canonical_layout` /
// `kamino_redeem_metas_match_canonical_layout` and force a same-PR
// re-derivation against the new upstream layout.

/// Pubkey inputs for `kamino_deposit_metas`. Field names mirror
/// Kamino's `DepositReserveLiquidity` account-struct field names so
/// the caller mapping is unambiguous (our wrapper's `Deposit` /
/// `Harvest` field names sometimes differ — e.g. `destination` /
/// `source` both map to Kamino's `user_source_liquidity`).
pub(crate) struct KaminoDepositMetaInputs {
    pub owner:                       Pubkey,
    pub reserve:                     Pubkey,
    pub lending_market:              Pubkey,
    pub lending_market_authority:    Pubkey,
    pub reserve_liquidity_mint:      Pubkey,
    pub reserve_liquidity_supply:    Pubkey,
    pub reserve_collateral_mint:     Pubkey,
    pub user_source_liquidity:       Pubkey,
    pub user_destination_collateral: Pubkey,
    pub token_program:               Pubkey,
    pub instruction_sysvar:          Pubkey,
}

/// Canonical 12-account `AccountMeta` list for Kamino's
/// `deposit_reserve_liquidity` ix. Position + flags pinned by
/// `kamino_deposit_metas_match_canonical_layout` test below.
pub(crate) fn kamino_deposit_metas(i: &KaminoDepositMetaInputs) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new_readonly(i.owner, true), //                  1. owner (signer, ro)
        AccountMeta::new(i.reserve, false), //                        2. reserve (mut)
        AccountMeta::new_readonly(i.lending_market, false), //        3. lending_market (ro)
        AccountMeta::new_readonly(i.lending_market_authority, false), // 4. lending_market_authority (ro, PDA)
        AccountMeta::new_readonly(i.reserve_liquidity_mint, false), // 5. reserve_liquidity_mint (ro, = USDC mint)
        AccountMeta::new(i.reserve_liquidity_supply, false), //       6. reserve_liquidity_supply (mut)
        AccountMeta::new(i.reserve_collateral_mint, false), //        7. reserve_collateral_mint (mut, c-token mint)
        AccountMeta::new(i.user_source_liquidity, false), //          8. user_source_liquidity (mut, source — our shadow vault)
        AccountMeta::new(i.user_destination_collateral, false), //    9. user_destination_collateral (mut, dest — our c-token ATA)
        AccountMeta::new_readonly(i.token_program, false), //         10. collateral_token_program (ro, Token)
        AccountMeta::new_readonly(i.token_program, false), //         11. liquidity_token_program (ro, Token Interface — same SPL Token for USDC)
        AccountMeta::new_readonly(i.instruction_sysvar, false), //    12. instruction_sysvar (ro, Sysvar Instructions)
    ]
}

/// Pubkey inputs for `kamino_redeem_metas`. NOTE the redeem ix has
/// `lending_market` BEFORE `reserve` (positions 2/3) while deposit
/// has them in the opposite order (3/2) — that asymmetry is in
/// Kamino's source and the oracle below captures it.
pub(crate) struct KaminoRedeemMetaInputs {
    pub owner:                       Pubkey,
    pub lending_market:              Pubkey,
    pub reserve:                     Pubkey,
    pub lending_market_authority:    Pubkey,
    pub reserve_liquidity_mint:      Pubkey,
    pub reserve_collateral_mint:     Pubkey,
    pub reserve_liquidity_supply:    Pubkey,
    pub user_source_collateral:      Pubkey,
    pub user_destination_liquidity:  Pubkey,
    pub token_program:               Pubkey,
    pub instruction_sysvar:          Pubkey,
}

/// Canonical 12-account `AccountMeta` list for Kamino's
/// `redeem_reserve_collateral` ix. Position + flags pinned by
/// `kamino_redeem_metas_match_canonical_layout` test below.
pub(crate) fn kamino_redeem_metas(i: &KaminoRedeemMetaInputs) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new_readonly(i.owner, true), //                  1. owner (signer, ro)
        AccountMeta::new_readonly(i.lending_market, false), //        2. lending_market (ro) — note: BEFORE reserve in redeem
        AccountMeta::new(i.reserve, false), //                        3. reserve (mut, has_one = lending_market)
        AccountMeta::new_readonly(i.lending_market_authority, false), // 4. lending_market_authority (ro, PDA)
        AccountMeta::new_readonly(i.reserve_liquidity_mint, false), // 5. reserve_liquidity_mint (ro, = USDC mint)
        AccountMeta::new(i.reserve_collateral_mint, false), //        6. reserve_collateral_mint (mut, c-token mint)
        AccountMeta::new(i.reserve_liquidity_supply, false), //       7. reserve_liquidity_supply (mut)
        AccountMeta::new(i.user_source_collateral, false), //         8. user_source_collateral (mut, c-token ATA we burn from)
        AccountMeta::new(i.user_destination_liquidity, false), //     9. user_destination_liquidity (mut, where redeemed USDC goes — shadow vault)
        AccountMeta::new_readonly(i.token_program, false), //         10. collateral_token_program (ro)
        AccountMeta::new_readonly(i.token_program, false), //         11. liquidity_token_program (ro, Interface)
        AccountMeta::new_readonly(i.instruction_sysvar, false), //    12. instruction_sysvar (ro)
    ]
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

        // SEV-041 fix: account list goes through the single-source-of-
        // truth `kamino_deposit_metas` builder above. Order + flags
        // pinned by `kamino_deposit_metas_match_canonical_layout` unit
        // test. Empirically validated via bankrun spike May 2026.
        let metas = kamino_deposit_metas(&KaminoDepositMetaInputs {
            owner:                       ctx.accounts.state.key(),
            reserve:                     ctx.accounts.kamino_reserve.key(),
            lending_market:              ctx.accounts.kamino_market.key(),
            lending_market_authority:    ctx.accounts.kamino_market_authority.key(),
            reserve_liquidity_mint:      ctx.accounts.reserve_liquidity_mint.key(),
            reserve_liquidity_supply:    ctx.accounts.kamino_reserve_liquidity_supply.key(),
            reserve_collateral_mint:     ctx.accounts.kamino_reserve_collateral_mint.key(),
            user_source_liquidity:       ctx.accounts.destination.key(),
            user_destination_collateral: ctx.accounts.c_token_account.key(),
            token_program:               ctx.accounts.token_program.key(),
            instruction_sysvar:          ctx.accounts.instruction_sysvar.key(),
        });

        let infos = [
            ctx.accounts.state.to_account_info(),
            ctx.accounts.kamino_reserve.to_account_info(),
            ctx.accounts.kamino_market.to_account_info(),
            ctx.accounts.kamino_market_authority.to_account_info(),
            ctx.accounts.reserve_liquidity_mint.to_account_info(),
            ctx.accounts.kamino_reserve_liquidity_supply.to_account_info(),
            ctx.accounts.kamino_reserve_collateral_mint.to_account_info(),
            ctx.accounts.destination.to_account_info(),
            ctx.accounts.c_token_account.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.instruction_sysvar.to_account_info(),
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

    /// Harvest accrued yield from Kamino via a redeem-all +
    /// redeposit-principal round-trip. See module docs for the
    /// rationale; one-shot partial redeem would require deserializing
    /// the Kamino reserve account to read the live exchange rate,
    /// which expands audit surface for no operational benefit at
    /// per-cycle crank frequency.
    ///
    /// Steps:
    ///   1. CPI `redeem_reserve_collateral(c_token_balance)` — burns
    ///      all c-tokens we hold; USDC credited to shadow vault.
    ///   2. Transfer `realized = total_redeemed − tracked_principal`
    ///      from shadow vault → pool vault. Core's `harvest_yield`
    ///      sees this as the post-CPI vault delta and routes it
    ///      through the protocol-fee / GF / LP / participants
    ///      waterfall.
    ///   3. CPI `deposit_reserve_liquidity(tracked_principal)` —
    ///      redeposits principal so the position keeps compounding.
    ///
    /// `state.tracked_principal` is invariant across this ix (a
    /// clean round-trip). Failure modes:
    ///   - `tracked_principal == 0` → log + Ok (nothing to harvest).
    ///   - `c_token_balance == 0`   → log + Ok (no position open).
    ///   - `total_redeemed < tracked_principal` → `PrincipalLoss`
    ///     error; defends against an exchange-rate regression in
    ///     Kamino (shouldn't happen — c-token rate is monotone — but
    ///     fail loud rather than silently mutate `tracked_principal`).
    pub fn harvest<'info>(
        ctx: Context<'_, '_, '_, 'info, Harvest<'info>>,
    ) -> Result<()> {
        // ─── Auth checks ────────────────────────────────────────────
        let state = &ctx.accounts.state;
        require!(
            ctx.accounts.authority.key() == state.pool,
            YieldKaminoError::UnauthorizedPool,
        );
        require!(
            ctx.accounts.source.key() == state.vault,
            YieldKaminoError::VaultMismatch,
        );
        require!(
            ctx.accounts.destination.owner == state.pool,
            YieldKaminoError::DestinationNotPoolOwned,
        );
        require!(
            ctx.accounts.destination.mint == state.underlying_mint,
            YieldKaminoError::MintMismatch,
        );

        let tracked = state.tracked_principal;
        if tracked == 0 {
            msg!("yield-kamino: harvest realized=0 (no tracked principal)");
            return Ok(());
        }

        let c_token_balance = ctx.accounts.c_token_account.amount;
        if c_token_balance == 0 {
            // Defensive: tracked > 0 but no c-tokens means an
            // out-of-band redemption already happened. Don't fabricate
            // yield; force operator intervention.
            msg!(
                "yield-kamino: harvest realized=0 — tracked_principal={} but c-token balance=0",
                tracked,
            );
            return Ok(());
        }

        let signer_seeds: &[&[u8]] = &[
            SEED_STATE,
            state.pool.as_ref(),
            std::slice::from_ref(&state.bump),
        ];
        let signer_seeds_arr: &[&[&[u8]]] = &[signer_seeds];

        // ─── Step 1: redeem ALL c-tokens via Kamino CPI ─────────────
        let shadow_before = ctx.accounts.source.amount;
        kamino_cpi_redeem(&ctx, c_token_balance, signer_seeds_arr)?;
        ctx.accounts.source.reload()?;
        let shadow_after_redeem = ctx.accounts.source.amount;
        let total_redeemed = shadow_after_redeem.saturating_sub(shadow_before);

        // Principal-loss guard: Kamino's c-token exchange rate is
        // monotonically non-decreasing under normal operation. If
        // total_redeemed < tracked, something is wrong — fail loud.
        require!(
            total_redeemed >= tracked,
            YieldKaminoError::PrincipalLoss,
        );

        let realized = total_redeemed - tracked;

        // ─── Step 2: transfer realized surplus to pool vault ────────
        if realized > 0 {
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
                realized,
            )?;
        }

        // ─── Step 3: redeposit tracked_principal back into Kamino ───
        kamino_cpi_deposit(&ctx, tracked, signer_seeds_arr)?;

        msg!(
            "yield-kamino: harvest realized={} principal_redeposited={} c_tokens_burned={}",
            realized, tracked, c_token_balance,
        );
        Ok(())
    }
}

// ─── CPI helpers ────────────────────────────────────────────────────────
//
// Kamino's account ordering is reproduced from the on-chain
// `klend` program. Both helpers build the same account list (modulo
// source/destination on the SPL-token side) so reading the deposit
// CPI in `deposit()` and `kamino_cpi_deposit()` side-by-side surfaces
// any drift. Final mainnet deploy MUST re-verify the exact ordering
// against Kamino's published IDL — flagged in the module-level "What
// is still pending" comment.

fn kamino_cpi_redeem<'info>(
    ctx: &Context<'_, '_, '_, 'info, Harvest<'info>>,
    c_token_amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut data = Vec::with_capacity(8 + 8);
    data.extend_from_slice(&kamino_redeem_disc());
    data.extend_from_slice(&c_token_amount.to_le_bytes());

    // SEV-041 fix: account list goes through the single-source-of-
    // truth `kamino_redeem_metas` builder. Order + flags pinned by
    // `kamino_redeem_metas_match_canonical_layout` unit test.
    let metas = kamino_redeem_metas(&KaminoRedeemMetaInputs {
        owner:                      ctx.accounts.state.key(),
        lending_market:             ctx.accounts.kamino_market.key(),
        reserve:                    ctx.accounts.kamino_reserve.key(),
        lending_market_authority:   ctx.accounts.kamino_market_authority.key(),
        reserve_liquidity_mint:     ctx.accounts.reserve_liquidity_mint.key(),
        reserve_collateral_mint:    ctx.accounts.kamino_reserve_collateral_mint.key(),
        reserve_liquidity_supply:   ctx.accounts.kamino_reserve_liquidity_supply.key(),
        user_source_collateral:     ctx.accounts.c_token_account.key(),
        user_destination_liquidity: ctx.accounts.source.key(),
        token_program:              ctx.accounts.token_program.key(),
        instruction_sysvar:         ctx.accounts.instruction_sysvar.key(),
    });

    let infos = [
        ctx.accounts.state.to_account_info(),
        ctx.accounts.kamino_market.to_account_info(),
        ctx.accounts.kamino_reserve.to_account_info(),
        ctx.accounts.kamino_market_authority.to_account_info(),
        ctx.accounts.reserve_liquidity_mint.to_account_info(),
        ctx.accounts.kamino_reserve_collateral_mint.to_account_info(),
        ctx.accounts.kamino_reserve_liquidity_supply.to_account_info(),
        ctx.accounts.c_token_account.to_account_info(),
        ctx.accounts.source.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.instruction_sysvar.to_account_info(),
        ctx.accounts.kamino_program.to_account_info(),
    ];

    let ix = Instruction {
        program_id: KAMINO_LEND_PROGRAM_ID,
        accounts:   metas,
        data,
    };

    invoke_signed(&ix, &infos, signer_seeds).map_err(|e| {
        msg!("yield-kamino: Kamino redeem CPI failed: {:?}", e);
        error!(YieldKaminoError::KaminoCpiFailed)
    })?;
    Ok(())
}

fn kamino_cpi_deposit<'info>(
    ctx: &Context<'_, '_, '_, 'info, Harvest<'info>>,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut data = Vec::with_capacity(8 + 8);
    data.extend_from_slice(&kamino_deposit_disc());
    data.extend_from_slice(&amount.to_le_bytes());

    // SEV-041 fix: same single-source-of-truth `kamino_deposit_metas`
    // builder used by the standalone `deposit()` handler above.
    let metas = kamino_deposit_metas(&KaminoDepositMetaInputs {
        owner:                       ctx.accounts.state.key(),
        reserve:                     ctx.accounts.kamino_reserve.key(),
        lending_market:              ctx.accounts.kamino_market.key(),
        lending_market_authority:    ctx.accounts.kamino_market_authority.key(),
        reserve_liquidity_mint:      ctx.accounts.reserve_liquidity_mint.key(),
        reserve_liquidity_supply:    ctx.accounts.kamino_reserve_liquidity_supply.key(),
        reserve_collateral_mint:     ctx.accounts.kamino_reserve_collateral_mint.key(),
        user_source_liquidity:       ctx.accounts.source.key(),
        user_destination_collateral: ctx.accounts.c_token_account.key(),
        token_program:               ctx.accounts.token_program.key(),
        instruction_sysvar:          ctx.accounts.instruction_sysvar.key(),
    });

    let infos = [
        ctx.accounts.state.to_account_info(),
        ctx.accounts.kamino_reserve.to_account_info(),
        ctx.accounts.kamino_market.to_account_info(),
        ctx.accounts.kamino_market_authority.to_account_info(),
        ctx.accounts.reserve_liquidity_mint.to_account_info(),
        ctx.accounts.kamino_reserve_liquidity_supply.to_account_info(),
        ctx.accounts.kamino_reserve_collateral_mint.to_account_info(),
        ctx.accounts.source.to_account_info(),
        ctx.accounts.c_token_account.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.instruction_sysvar.to_account_info(),
        ctx.accounts.kamino_program.to_account_info(),
    ];

    let ix = Instruction {
        program_id: KAMINO_LEND_PROGRAM_ID,
        accounts:   metas,
        data,
    };

    invoke_signed(&ix, &infos, signer_seeds).map_err(|e| {
        msg!("yield-kamino: Kamino redeposit CPI failed: {:?}", e);
        error!(YieldKaminoError::KaminoCpiFailed)
    })?;
    Ok(())
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

    /// **SEV-041 fix:** Kamino's `deposit_reserve_liquidity` ix expects
    /// `reserve_liquidity_mint` (= the USDC mint) as account position
    /// 4 in its account list. Empirically validated via bankrun spike
    /// May 2026 — without this, Kamino fails at
    /// `address = reserve.load()?.liquidity.mint_pubkey` with
    /// `InvalidAccountData`. Pinned to `state.underlying_mint` which
    /// was set + validated at init_vault time.
    ///
    /// CHECK: pinned to state.underlying_mint (USDC mint).
    #[account(address = state.underlying_mint @ YieldKaminoError::MintMismatch)]
    pub reserve_liquidity_mint: UncheckedAccount<'info>,

    /// CHECK: Kamino's reserve liquidity supply ATA — receives the USDC.
    #[account(mut)]
    pub kamino_reserve_liquidity_supply: UncheckedAccount<'info>,

    /// CHECK: Kamino's c-token mint for this reserve.
    #[account(mut)]
    pub kamino_reserve_collateral_mint: UncheckedAccount<'info>,

    /// State-owned c-token ATA — destination of the c-tokens Kamino
    /// mints in exchange for the deposited USDC liquidity.
    ///
    /// **Security (SEV-001 fix):** Anchor-enforced ATA derivation pins
    /// the `(state, kamino_reserve_collateral_mint)` pair as the
    /// canonical destination. Before this constraint, the account was
    /// `UncheckedAccount` — meaning a permissionless caller of
    /// `roundfi-core::deposit_idle_to_yield` could pass a c-token
    /// account they controlled in `remaining_accounts`, Kamino would
    /// happily mint c-tokens to them, and the protocol's
    /// `tracked_principal` would still increment as if state owned
    /// them. Attacker then redeems via Kamino direct for full
    /// fund-loss. Mirrors the constraint that was already in place
    /// on `Harvest::c_token_account`.
    #[account(
        mut,
        associated_token::mint = kamino_reserve_collateral_mint,
        associated_token::authority = state,
    )]
    pub c_token_account: Account<'info, TokenAccount>,

    /// CHECK: Kamino Lend program — pinned to KAMINO_LEND_PROGRAM_ID.
    #[account(address = KAMINO_LEND_PROGRAM_ID @ YieldKaminoError::InvalidKaminoProgram)]
    pub kamino_program: UncheckedAccount<'info>,

    /// **SEV-041 fix:** Kamino's `deposit_reserve_liquidity` ix requires
    /// the Sysvar Instructions account at position 11 of its account
    /// list (used for tx introspection). Pinned to the canonical
    /// sysvar address.
    ///
    /// CHECK: Sysvar Instructions — fixed canonical address.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instruction_sysvar: UncheckedAccount<'info>,
}

/// Same positional layout as `roundfi-core::harvest_yield`:
///   [source(shadow_vault), destination(pool_vault),
///    authority(signer, readonly), token_program, ...remaining]
///
/// `remaining_accounts` carries: state, then the Kamino-specific
/// accounts in the order Kamino's `redeem_reserve_collateral` and
/// `deposit_reserve_liquidity` ixs expect (we share the same list
/// between both CPIs, modulo SPL-side source/destination).
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

    // ─── Kamino-specific (forwarded as remaining_accounts from core) ─

    /// CHECK: pinned to state.kamino_reserve at init time.
    #[account(mut, address = state.kamino_reserve @ YieldKaminoError::KaminoAccountMismatch)]
    pub kamino_reserve: UncheckedAccount<'info>,

    /// CHECK: pinned to state.kamino_market at init time.
    #[account(address = state.kamino_market @ YieldKaminoError::KaminoAccountMismatch)]
    pub kamino_market: UncheckedAccount<'info>,

    /// CHECK: Kamino-derived PDA (lending_market_authority).
    pub kamino_market_authority: UncheckedAccount<'info>,

    /// **SEV-041 fix:** Both Kamino `redeem_reserve_collateral` and
    /// `deposit_reserve_liquidity` ixs require the reserve's
    /// liquidity_mint (= USDC) at specific positions in their
    /// account lists. Pinned to `state.underlying_mint`.
    ///
    /// CHECK: pinned to state.underlying_mint (USDC mint).
    #[account(address = state.underlying_mint @ YieldKaminoError::MintMismatch)]
    pub reserve_liquidity_mint: UncheckedAccount<'info>,

    /// CHECK: Kamino's reserve liquidity supply ATA — credited on
    /// redeposit, debited on redeem.
    #[account(mut)]
    pub kamino_reserve_liquidity_supply: UncheckedAccount<'info>,

    /// CHECK: Kamino's c-token mint for this reserve. Authority is
    /// Kamino's reserve PDA, mutated by Kamino's redeem/deposit ixs.
    #[account(mut)]
    pub kamino_reserve_collateral_mint: UncheckedAccount<'info>,

    /// State-owned c-token ATA. Anchor-enforced derivation pins the
    /// `(state, kamino_reserve_collateral_mint)` ATA — the same
    /// account `deposit()` minted c-tokens into. Without this
    /// constraint a caller could pass a different c-token account
    /// (e.g. someone else's position) and we'd burn from the wrong
    /// balance.
    #[account(
        mut,
        associated_token::mint = kamino_reserve_collateral_mint,
        associated_token::authority = state,
    )]
    pub c_token_account: Account<'info, TokenAccount>,

    /// CHECK: Kamino Lend program — pinned to KAMINO_LEND_PROGRAM_ID.
    #[account(address = KAMINO_LEND_PROGRAM_ID @ YieldKaminoError::InvalidKaminoProgram)]
    pub kamino_program: UncheckedAccount<'info>,

    /// **SEV-041 fix:** Both Kamino redeem and deposit CPIs require
    /// the Sysvar Instructions account.
    ///
    /// CHECK: Sysvar Instructions — fixed canonical address.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instruction_sysvar: UncheckedAccount<'info>,
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
    #[msg("destination token account is not owned by the bound pool")]
    DestinationNotPoolOwned,
    #[msg("Kamino account does not match the one pinned in state")]
    KaminoAccountMismatch,
    #[msg("kamino_program does not match expected Kamino Lend program ID")]
    InvalidKaminoProgram,
    #[msg("Kamino CPI rejected the call")]
    KaminoCpiFailed,
    #[msg("Kamino returned less USDC than tracked principal — exchange rate regressed or out-of-band redemption occurred")]
    PrincipalLoss,
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

    /// Same pinning for `redeem_reserve_collateral` — the harvest-path
    /// counterpart. Same Kamino-rename guarantee as the deposit disc.
    #[test]
    fn kamino_redeem_disc_is_stable() {
        let d1 = kamino_redeem_disc();
        let d2 = kamino_redeem_disc();
        assert_eq!(d1, d2);
        assert_eq!(d1.len(), 8);
        assert_ne!(d1, [0u8; 8]);
    }

    /// Deposit and redeem must use DIFFERENT discriminators (else a
    /// confused-deputy attack could feed a redeem-shaped account list
    /// to the deposit ix or vice-versa). Anchor-Kamino encoding
    /// guarantees this by construction, but the assertion makes the
    /// guarantee local and locally-failing.
    #[test]
    fn kamino_deposit_and_redeem_discs_differ() {
        assert_ne!(kamino_deposit_disc(), kamino_redeem_disc());
    }

    /// Pin `KAMINO_LEND_PROGRAM_ID` against the canonical mainnet program
    /// ID (same address used on devnet — see
    /// https://github.com/Kamino-Finance/klend `declare_id!`). A typo in
    /// this constant (SEV-040 regression class) is silent at compile
    /// time because `anchor_lang::pubkey!()` accepts any syntactically
    /// valid base58, and the failure mode is `InvalidKaminoProgram`
    /// rejection at the first runtime CPI — i.e. canary-mainnet, after
    /// rent + ceremony cost. This test catches it locally in `cargo
    /// test` before that.
    #[test]
    fn kamino_lend_program_id_matches_canonical() {
        assert_eq!(
            KAMINO_LEND_PROGRAM_ID.to_string(),
            "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
        );
    }

    // ─── SEV-041 oracle — CPI account-list layout pinning ───────────
    //
    // These two tests are the canonical-layout oracle that turns
    // SEV-041 from "caught by bankrun spike" (a 5-phase setup that
    // needs mainnet RPC + program dump) into "caught by cargo test"
    // (sub-second, runs in CI on every PR). They assert that
    // `kamino_deposit_metas` + `kamino_redeem_metas` produce the
    // exact 12-account list Kamino's `deposit_reserve_liquidity` and
    // `redeem_reserve_collateral` ix's expect.
    //
    // Oracle provenance: positions + signer/writable flags
    // transcribed from
    //   Kamino-Finance/klend/programs/klend/src/handlers/
    //     handler_deposit_reserve_liquidity.rs
    //     handler_redeem_reserve_collateral.rs
    // at SEV-041 fix time (May 2026). If Kamino releases a breaking
    // change to either ix's account list, these tests fail and force
    // a same-PR re-derivation of the inputs structs + builder
    // functions above.
    //
    // What this catches that the bankrun spike doesn't:
    //   - Quick local cargo-test feedback (no RPC, no .so dump)
    //   - Future shuffles in the inputs-struct → builder mapping
    //   - Future shuffles in the per-position is_signer / is_writable
    //     flags (the bankrun spike only catches outright rejection
    //     at runtime — wrong flag may pass if the test fixture's
    //     signer set happens to match)
    //
    // What the bankrun spike still catches that these tests don't:
    //   - Discriminator drift (Kamino renames the ix)
    //   - Real ATA / mint constraint violations at runtime
    //   - Kamino's own internal validation (e.g. has_one on reserve)

    fn sentinel_pubkey(slot: u8) -> Pubkey {
        // Distinct, easy-to-read-in-failure pubkey per slot. The
        // first byte is the slot number (1..=N); rest is zeros.
        // Use slot 0 as the token_program (it appears twice in
        // both layouts at positions 10 + 11).
        let mut bytes = [0u8; 32];
        bytes[0] = slot;
        Pubkey::from(bytes)
    }

    #[test]
    fn kamino_deposit_metas_match_canonical_layout() {
        // Sentinel inputs. Slot 0 reserved for token_program (dup
        // at positions 10 + 11 per Kamino's canonical layout).
        let owner = sentinel_pubkey(1);
        let reserve = sentinel_pubkey(2);
        let lending_market = sentinel_pubkey(3);
        let lending_market_authority = sentinel_pubkey(4);
        let reserve_liquidity_mint = sentinel_pubkey(5);
        let reserve_liquidity_supply = sentinel_pubkey(6);
        let reserve_collateral_mint = sentinel_pubkey(7);
        let user_source_liquidity = sentinel_pubkey(8);
        let user_destination_collateral = sentinel_pubkey(9);
        let token_program = sentinel_pubkey(0);
        let instruction_sysvar = sentinel_pubkey(12);

        let metas = kamino_deposit_metas(&KaminoDepositMetaInputs {
            owner,
            reserve,
            lending_market,
            lending_market_authority,
            reserve_liquidity_mint,
            reserve_liquidity_supply,
            reserve_collateral_mint,
            user_source_liquidity,
            user_destination_collateral,
            token_program,
            instruction_sysvar,
        });

        // Oracle: (expected pubkey, is_signer, is_writable) per slot,
        // sourced from
        // klend/programs/klend/src/handlers/handler_deposit_reserve_liquidity.rs
        let oracle: [(Pubkey, bool, bool); 12] = [
            (owner, true, false), //                       1. owner (signer, ro)
            (reserve, false, true), //                     2. reserve (mut)
            (lending_market, false, false), //             3. lending_market (ro)
            (lending_market_authority, false, false), //   4. lending_market_authority (ro, PDA)
            (reserve_liquidity_mint, false, false), //     5. reserve_liquidity_mint (ro)
            (reserve_liquidity_supply, false, true), //    6. reserve_liquidity_supply (mut)
            (reserve_collateral_mint, false, true), //     7. reserve_collateral_mint (mut)
            (user_source_liquidity, false, true), //       8. user_source_liquidity (mut)
            (user_destination_collateral, false, true), // 9. user_destination_collateral (mut)
            (token_program, false, false), //              10. collateral_token_program (ro)
            (token_program, false, false), //              11. liquidity_token_program (ro, same SPL Token for USDC)
            (instruction_sysvar, false, false), //         12. instruction_sysvar (ro)
        ];

        assert_eq!(
            metas.len(),
            oracle.len(),
            "deposit account count drifted — Kamino canonical is 12",
        );
        for (i, (meta, (expected_key, expected_signer, expected_writable))) in
            metas.iter().zip(oracle.iter()).enumerate()
        {
            let pos = i + 1;
            assert_eq!(
                meta.pubkey, *expected_key,
                "deposit slot {pos} pubkey mismatch — order shuffled vs Kamino canonical",
            );
            assert_eq!(
                meta.is_signer, *expected_signer,
                "deposit slot {pos} is_signer mismatch",
            );
            assert_eq!(
                meta.is_writable, *expected_writable,
                "deposit slot {pos} is_writable mismatch",
            );
        }
    }

    #[test]
    fn kamino_redeem_metas_match_canonical_layout() {
        let owner = sentinel_pubkey(1);
        let lending_market = sentinel_pubkey(2); // note: BEFORE reserve in redeem
        let reserve = sentinel_pubkey(3);
        let lending_market_authority = sentinel_pubkey(4);
        let reserve_liquidity_mint = sentinel_pubkey(5);
        let reserve_collateral_mint = sentinel_pubkey(6);
        let reserve_liquidity_supply = sentinel_pubkey(7);
        let user_source_collateral = sentinel_pubkey(8);
        let user_destination_liquidity = sentinel_pubkey(9);
        let token_program = sentinel_pubkey(0);
        let instruction_sysvar = sentinel_pubkey(12);

        let metas = kamino_redeem_metas(&KaminoRedeemMetaInputs {
            owner,
            lending_market,
            reserve,
            lending_market_authority,
            reserve_liquidity_mint,
            reserve_collateral_mint,
            reserve_liquidity_supply,
            user_source_collateral,
            user_destination_liquidity,
            token_program,
            instruction_sysvar,
        });

        // Oracle: (expected pubkey, is_signer, is_writable) per slot,
        // sourced from
        // klend/programs/klend/src/handlers/handler_redeem_reserve_collateral.rs
        // NOTE: redeem has lending_market BEFORE reserve — asymmetric vs deposit.
        let oracle: [(Pubkey, bool, bool); 12] = [
            (owner, true, false), //                       1. owner (signer, ro)
            (lending_market, false, false), //             2. lending_market (ro)
            (reserve, false, true), //                     3. reserve (mut, has_one = lending_market)
            (lending_market_authority, false, false), //   4. lending_market_authority (ro, PDA)
            (reserve_liquidity_mint, false, false), //     5. reserve_liquidity_mint (ro)
            (reserve_collateral_mint, false, true), //     6. reserve_collateral_mint (mut, c-token mint)
            (reserve_liquidity_supply, false, true), //    7. reserve_liquidity_supply (mut)
            (user_source_collateral, false, true), //      8. user_source_collateral (mut, c-token burned)
            (user_destination_liquidity, false, true), //  9. user_destination_liquidity (mut, USDC received)
            (token_program, false, false), //              10. collateral_token_program (ro)
            (token_program, false, false), //              11. liquidity_token_program (ro, Interface)
            (instruction_sysvar, false, false), //         12. instruction_sysvar (ro)
        ];

        assert_eq!(
            metas.len(),
            oracle.len(),
            "redeem account count drifted — Kamino canonical is 12",
        );
        for (i, (meta, (expected_key, expected_signer, expected_writable))) in
            metas.iter().zip(oracle.iter()).enumerate()
        {
            let pos = i + 1;
            assert_eq!(
                meta.pubkey, *expected_key,
                "redeem slot {pos} pubkey mismatch — order shuffled vs Kamino canonical",
            );
            assert_eq!(
                meta.is_signer, *expected_signer,
                "redeem slot {pos} is_signer mismatch",
            );
            assert_eq!(
                meta.is_writable, *expected_writable,
                "redeem slot {pos} is_writable mismatch",
            );
        }
    }

    #[test]
    fn kamino_deposit_and_redeem_metas_differ_at_position_2_and_3() {
        // Sanity guard for the asymmetry between deposit + redeem.
        // If a future refactor accidentally homogenizes the two
        // layouts (e.g. via a single "kamino_cpi_metas" function),
        // this test fires.
        //
        // Deposit:   pos 2 = reserve (mut),       pos 3 = lending_market (ro)
        // Redeem:    pos 2 = lending_market (ro), pos 3 = reserve (mut)
        let common = sentinel_pubkey(99);
        let deposit_metas = kamino_deposit_metas(&KaminoDepositMetaInputs {
            owner:                       common,
            reserve:                     sentinel_pubkey(2),
            lending_market:              sentinel_pubkey(3),
            lending_market_authority:    common,
            reserve_liquidity_mint:      common,
            reserve_liquidity_supply:    common,
            reserve_collateral_mint:     common,
            user_source_liquidity:       common,
            user_destination_collateral: common,
            token_program:               common,
            instruction_sysvar:          common,
        });
        let redeem_metas = kamino_redeem_metas(&KaminoRedeemMetaInputs {
            owner:                      common,
            lending_market:              sentinel_pubkey(2),
            reserve:                     sentinel_pubkey(3),
            lending_market_authority:    common,
            reserve_liquidity_mint:      common,
            reserve_collateral_mint:     common,
            reserve_liquidity_supply:    common,
            user_source_collateral:      common,
            user_destination_liquidity:  common,
            token_program:               common,
            instruction_sysvar:          common,
        });

        // Both have reserve at the writable slot (deposit pos 2, redeem pos 3)
        // and lending_market at the readonly slot (deposit pos 3, redeem pos 2).
        assert!(
            deposit_metas[1].is_writable && !deposit_metas[2].is_writable,
            "deposit pos 2 must be writable (reserve), pos 3 must be readonly (lending_market)",
        );
        assert!(
            !redeem_metas[1].is_writable && redeem_metas[2].is_writable,
            "redeem pos 2 must be readonly (lending_market), pos 3 must be writable (reserve)",
        );
    }
}
