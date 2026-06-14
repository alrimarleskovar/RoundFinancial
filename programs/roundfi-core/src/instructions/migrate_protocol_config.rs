//! `migrate_protocol_config` — one-shot account realloc to bring a
//! `ProtocolConfig` PDA created under an earlier struct layout up to the
//! current `ProtocolConfig::SIZE`.
//!
//! ## Why this exists
//!
//! Between v0.1 (devnet bootstrap, 2026-05) and v0.5 (this PR), the
//! `ProtocolConfig` struct grew by ~64 bytes — TVL caps, commit-reveal,
//! pending_authority + eta, lp_share_bps, pending_fee_bps_yield + eta,
//! forward-compat padding. The struct grew **append-only** (every new
//! field at the tail), but the existing on-chain singleton was never
//! reallocated. After redeploying the program with the new struct, every
//! ix that loads `ProtocolConfig` (the great majority — `create_pool`,
//! `contribute`, `claim_payout`, …) fails to deserialize with Anchor
//! error 3003.
//!
//! This handler is the **idempotent rescue**:
//!
//!   1. Length check — if already `ProtocolConfig::SIZE` (the current
//!      value), it's a no-op (returns Ok). Safe to call any number of
//!      times.
//!   2. Authority check — must be signed by the authority recorded in
//!      the existing config bytes (offset 0..32, immediately after the
//!      8-byte discriminator). Reads the bytes directly (the struct
//!      doesn't deserialize yet); the authority slot has not moved
//!      across the struct evolutions.
//!   3. Discriminator check — bytes 0..8 must equal the Anchor disc for
//!      `ProtocolConfig`, so this can't be aimed at an unrelated account.
//!   4. Realloc to `ProtocolConfig::SIZE` with `zero_init = true` — the
//!      new tail bytes are zeroed. For all the new u64/i64 fields, zero
//!      is the correct "uninitialized / no pending state" value. For
//!      `Pubkey` fields (pending_treasury, approved_yield_adapter,
//!      pending_authority) zero is `Pubkey::default()` which the program
//!      already treats as the "no pending / no pin" sentinel.
//!   5. Rent top-up — the authority pays the rent delta directly via a
//!      system transfer so the realloc'd account is rent-exempt at the
//!      larger size.
//!   6. `lp_share_bps` is the ONLY new field where zero is a bad default
//!      (it would route nothing of the LP-share waterfall to LPs).
//!      Writes `DEFAULT_LP_SHARE_BPS` directly to its offset
//!      (`@ 351 absolute` = post-disc offset 343).
//!
//! ## Scope
//!
//! Devnet rescue, not a mainnet-permitted ix. Mainnet's `ProtocolConfig`
//! is created fresh at v0.5 and never needs this. To prevent the
//! mainnet authority from accidentally calling it, the handler asserts
//! the authority signer matches the on-chain authority bytes (no other
//! gate is possible without deserializing the struct, which is exactly
//! what we can't do yet). The `devnet` cluster constraint is purely
//! operational (the script that calls it lives under `scripts/devnet/`).
//!
//! Removed in a follow-up wave once devnet is on v0.5 layout and the
//! script is archived.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use anchor_lang::Discriminator;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(Accounts)]
pub struct MigrateProtocolConfig<'info> {
    /// CHECK: cannot deserialize as `Account<ProtocolConfig>` because the
    /// on-chain account is at the OLD layout (smaller than the current
    /// `ProtocolConfig::SIZE`). We validate manually: discriminator,
    /// PDA seeds, owner == program, and authority bytes.
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump,
        owner = crate::ID,
    )]
    pub config: UncheckedAccount<'info>,

    /// Must match the authority slot in the existing config bytes.
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MigrateProtocolConfig>) -> Result<()> {
    let config_info = ctx.accounts.config.to_account_info();
    let cur_len = config_info.data_len();
    let target_len = ProtocolConfig::SIZE;

    // ─── Step 1: idempotency — already at target size ───────────────────
    if cur_len == target_len {
        msg!(
            "roundfi-core: migrate_protocol_config noop — already at target size {}",
            target_len,
        );
        return Ok(());
    }

    // Never shrink. (Future struct growth only.)
    require!(cur_len < target_len, RoundfiError::InvalidBps); // reuse generic err

    // ─── Step 2: discriminator + authority check on raw bytes ───────────
    {
        let data = config_info.try_borrow_data()?;
        require!(data.len() >= 8 + 32, RoundfiError::InvalidBps);

        // Anchor discriminator must match `ProtocolConfig` — protects
        // against the caller passing an unrelated account that happens to
        // sit at the same PDA seeds.
        require!(
            data[0..8] == ProtocolConfig::DISCRIMINATOR,
            RoundfiError::InvalidBps,
        );

        // authority: Pubkey @ post-disc offset 0 = absolute 8..40.
        // The struct grew append-only, so this offset has been stable
        // across every layout version.
        let on_chain_authority = Pubkey::new_from_array(
            data[8..40].try_into().map_err(|_| error!(RoundfiError::InvalidBps))?,
        );
        require_keys_eq!(
            on_chain_authority,
            ctx.accounts.authority.key(),
            RoundfiError::Unauthorized,
        );
    }

    // ─── Step 3: rent top-up for the realloc'd size ─────────────────────
    let rent = Rent::get()?;
    let new_min = rent.minimum_balance(target_len);
    let cur_lamports = config_info.lamports();
    if new_min > cur_lamports {
        let delta = new_min - cur_lamports;
        msg!(
            "roundfi-core: migrate_protocol_config rent top-up {} lamports for realloc {} -> {}",
            delta,
            cur_len,
            target_len,
        );
        invoke(
            &system_instruction::transfer(
                ctx.accounts.authority.key,
                config_info.key,
                delta,
            ),
            &[
                ctx.accounts.authority.to_account_info(),
                config_info.clone(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    }

    // ─── Step 4: grow to the new LEN ────────────────────────────────────
    // Anchor 1.0 / solana-account-info 3.x: `realloc(len, zero_init)` was
    // replaced by `resize(len)` (zero-init is implicit for growth).
    config_info.resize(target_len)?;

    // ─── Step 5: write the one field that needs a non-zero default ──────
    //
    // `lp_share_bps` (post-disc offset 343 = absolute 351) is a u16; zero
    // would mean "no LP share" and break the Yield Cascade waterfall.
    // Everything else in the new tail is correctly zero by default
    // (pending_treasury / pending_authority = Pubkey::default() = sentinel
    // "no proposal"; the etas = 0; TVL caps = 0 = disabled; pending fee
    // bps = 0 = no pending change; padding = 0).
    {
        let mut data = config_info.try_borrow_mut_data()?;
        let off = 8 + 343; // disc + post-disc offset
        let bytes = DEFAULT_LP_SHARE_BPS.to_le_bytes();
        data[off..off + 2].copy_from_slice(&bytes);
    }

    msg!(
        "roundfi-core: migrate_protocol_config done — realloc {} -> {}, lp_share_bps={}",
        cur_len,
        target_len,
        DEFAULT_LP_SHARE_BPS,
    );

    Ok(())
}
