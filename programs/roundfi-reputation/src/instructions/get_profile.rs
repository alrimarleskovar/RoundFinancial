//! `get_profile` — public read-only view of a reputation profile.
//!
//! Step 4f addition. Materializes the "on-chain behavior oracle" claim
//! in code: a single canonical read surface that both off-chain
//! consumers (B2B score API, indexers, partner protocols) and on-chain
//! composers (future under-collateralized lending markets that price
//! risk against RoundFi scores) can target without having to know the
//! internal account layout.
//!
//! Two consumer modes:
//!   1. **Off-chain** — `simulateTransaction` against this instruction
//!      and parse the `ProfileSnapshot` event from the logs. The
//!      base64-encoded Borsh payload is stable across program upgrades
//!      as long as the event struct is (the `reserved` field provides
//!      room for additive changes).
//!   2. **On-chain** — a partner program CPIs into `get_profile` and
//!      reads the snapshot via `solana_program::program::get_return_data`.
//!      The handler serializes the same snapshot into return data, so
//!      composers never need to parse logs.
//!
//! Read-only: no state mutation, no score updates, no rent paid.
//! Safe to call from any wallet at any cadence.

use anchor_lang::prelude::*;

use crate::constants::SEED_PROFILE;
use crate::error::ReputationError;
use crate::state::{IdentityRecord, ReputationProfile};

/// Canonical read snapshot. Order and field names are part of the
/// public wire format — do not reorder; add new fields only by
/// consuming bytes from `reserved`.
#[event]
#[derive(Clone)]
pub struct ProfileSnapshot {
    pub wallet: Pubkey,

    // Score + level.
    pub level: u8,
    pub score: u64,

    // Lifetime counters.
    pub cycles_completed:   u32,
    pub on_time_payments:   u32,
    pub late_payments:      u32,
    pub defaults:           u32,
    pub total_participated: u32,

    // Time anchors.
    pub last_cycle_complete_at: i64,
    pub first_seen_at:          i64,
    pub last_updated_at:        i64,

    // Identity projection — zero/false when no IdentityRecord was
    // passed (caller signaled None via program-id sentinel).
    pub identity_provider:      u8,
    pub identity_status:        u8,
    pub identity_expires_at:    i64,
    pub identity_verified_now:  bool,

    /// Reserved for future schema additions without breaking
    /// consumers. Always zero in v1.
    pub reserved: [u8; 32],
}

#[derive(Accounts)]
pub struct GetProfile<'info> {
    /// The reputation profile being read.
    #[account(
        seeds = [SEED_PROFILE, profile.wallet.as_ref()],
        bump = profile.bump,
    )]
    pub profile: Account<'info, ReputationProfile>,

    /// CHECK: Optional `IdentityRecord`. Pass the reputation program
    /// id itself to signal "no identity linked" (same Anchor
    /// Option<Account> convention used by `attest`). When a real
    /// record is passed, the handler validates ownership (= this
    /// program) and that the record belongs to `profile.wallet`
    /// before reading any fields.
    pub identity_record: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<GetProfile>) -> Result<()> {
    let profile = &ctx.accounts.profile;
    let now = Clock::get()?.unix_timestamp;

    let (
        identity_provider,
        identity_status,
        identity_expires_at,
        identity_verified_now,
    ) = if ctx.accounts.identity_record.key() == crate::ID {
        // Sentinel — caller signaled "no identity linked".
        (0u8, 0u8, 0i64, false)
    } else {
        // `Account::try_from` validates BOTH the discriminator and
        // that the account is owned by this program, so a forged
        // `IdentityRecord`-looking account from another program can
        // never reach the field reads below.
        let info = ctx.accounts.identity_record.to_account_info();
        let ir: Account<IdentityRecord> = Account::try_from(&info)
            .map_err(|_| error!(ReputationError::ProfileNotFound))?;
        // Cross-check the record belongs to the profile's wallet —
        // otherwise a caller could pair any profile with any
        // identity record to forge a verified projection.
        require_keys_eq!(
            ir.wallet,
            profile.wallet,
            ReputationError::ProfileNotFound,
        );
        (
            ir.provider,
            ir.status,
            ir.expires_at,
            ir.is_verified(now),
        )
    };

    let snapshot = ProfileSnapshot {
        wallet:                 profile.wallet,
        level:                  profile.level,
        score:                  profile.score,
        cycles_completed:       profile.cycles_completed,
        on_time_payments:       profile.on_time_payments,
        late_payments:          profile.late_payments,
        defaults:               profile.defaults,
        total_participated:     profile.total_participated,
        last_cycle_complete_at: profile.last_cycle_complete_at,
        first_seen_at:          profile.first_seen_at,
        last_updated_at:        profile.last_updated_at,
        identity_provider,
        identity_status,
        identity_expires_at,
        identity_verified_now,
        reserved:               [0u8; 32],
    };

    // (1) On-chain composability — set return data so a partner
    //     program can read the snapshot via `get_return_data` after
    //     a CPI into this instruction.
    let bytes = snapshot.try_to_vec()?;
    anchor_lang::solana_program::program::set_return_data(&bytes);

    // (2) Off-chain consumers — emit the anchor event so indexers
    //     and `simulateTransaction` callers can parse the snapshot
    //     out of the log stream. `emit!` moves `snapshot`, so it
    //     goes last.
    emit!(snapshot);

    Ok(())
}
