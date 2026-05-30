//! `migrate_reputation_config` — authority-gated in-place migration of the
//! `ReputationConfig` singleton to the current struct layout.
//!
//! **Why this exists.** `ReputationConfig` grew over time (notably the
//! Adevar SEV-021 authority-rotation fields `pending_authority` +
//! `pending_authority_eta`, which exceeded the original reserved padding
//! and bumped `LEN`). Anchor sizes accounts at *create* time, so a
//! `ReputationConfig` PDA created by an older program build is smaller
//! than the current struct — every instruction that loads it as
//! `Account<ReputationConfig>` then fails with `AccountDidNotDeserialize`
//! (0xbbb). There was no in-place migration path, so a layout drift
//! bricked the singleton until a full re-init.
//!
//! This instruction reallocs the account up to the current `LEN` and
//! lets the runtime zero-init the grown region. That is exactly the
//! correct end state: the first 138 bytes (discriminator + 4 Pubkeys +
//! `paused` + `bump`) are byte-identical across the layouts and are
//! preserved untouched; the appended `pending_authority` (Pubkey) and
//! `pending_authority_eta` (i64) read back as `Pubkey::default()` / `0`
//! — the canonical "no rotation pending" state.
//!
//! **Why `UncheckedAccount`.** We CANNOT take the config as
//! `Account<ReputationConfig>`: Anchor would try to deserialize the
//! (too-short) account during account validation and revert with
//! `AccountDidNotDeserialize` before this handler ever runs. So we take
//! it raw and validate owner + PDA + authority by bytes.
//!
//! Idempotent: a no-op (and `Ok`) once the account is already at `LEN`.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::ReputationConfig;

#[derive(Accounts)]
pub struct MigrateReputationConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: validated by raw bytes in the handler. We deliberately do
    /// NOT use `Account<ReputationConfig>` — the stored layout may
    /// predate the current struct, so Anchor's deserialize would revert
    /// with `AccountDidNotDeserialize` before the handler runs. Owner,
    /// PDA seeds, and the stored authority are all checked manually.
    #[account(mut, seeds = [SEED_REP_CONFIG], bump)]
    pub config: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MigrateReputationConfig>) -> Result<()> {
    let info = ctx.accounts.config.to_account_info();

    // 1) Must be a ReputationConfig owned by THIS program.
    require_keys_eq!(*info.owner, crate::ID, ReputationError::Unauthorized);

    // 2) Authority gate by raw bytes — `authority: Pubkey` is the first
    //    field after the 8-byte discriminator, so it sits at [8..40] in
    //    every layout this singleton has ever had.
    {
        let data = info.try_borrow_data()?;
        require!(data.len() >= 40, ReputationError::Unauthorized);
        let stored_authority = Pubkey::try_from(&data[8..40])
            .map_err(|_| error!(ReputationError::Unauthorized))?;
        require_keys_eq!(
            stored_authority,
            ctx.accounts.authority.key(),
            ReputationError::Unauthorized,
        );
    } // drop the borrow before realloc

    let target = ReputationConfig::LEN;
    let current = info.data_len();

    // Already at (or somehow beyond) the current layout — nothing to do.
    // We only ever grow; realloc-down is never attempted.
    if current >= target {
        msg!("roundfi-reputation: migrate_reputation_config no-op (len={} >= LEN={})", current, target);
        return Ok(());
    }

    // 3) Top up rent for the larger account, then grow (zero-init).
    let rent = Rent::get()?;
    let needed = rent.minimum_balance(target);
    let have = info.lamports();
    if needed > have {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: info.clone(),
                },
            ),
            needed - have,
        )?;
    }

    info.realloc(target, true)?;

    msg!(
        "roundfi-reputation: migrate_reputation_config {} -> {} bytes (authority={})",
        current,
        target,
        ctx.accounts.authority.key(),
    );
    Ok(())
}
