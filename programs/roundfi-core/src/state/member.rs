use anchor_lang::prelude::*;

/// Membership record. PDA seeds: `[b"member", pool, wallet]`.
#[account]
#[derive(Default)]
pub struct Member {
    pub pool:               Pubkey,
    pub wallet:             Pubkey,
    pub nft_asset:          Pubkey,   // Metaplex Core asset
    pub slot_index:         u8,       // 0..members_target-1 → determines payout cycle
    pub reputation_level:   u8,       // 1 | 2 | 3, snapshot at join
    pub stake_bps:          u16,      // 5000 | 3000 | 1000
    pub stake_deposited:    u64,
    pub contributions_paid: u8,
    pub total_contributed:  u64,
    pub total_received:     u64,
    pub escrow_balance:     u64,
    pub on_time_count:      u16,
    pub late_count:         u16,
    pub defaulted:          bool,
    pub paid_out:           bool,    // 4b: true after claim_payout transfers credit_amount
    pub last_released_checkpoint: u8, // 4b: highest checkpoint already released (0 = none)
    pub joined_at:          i64,
    // ─── Step 4c: default + escape-valve tracking ───────────────────────
    /// Stake at the moment of join_pool. Never mutated by contributions or
    /// escrow releases — used as `C_initial` in the D/C invariant.
    pub stake_deposited_initial: u64,
    /// Cumulative escrow deposited over the pool life (monotonic increments
    /// during contribute). Never decreased by release_escrow or seizure —
    /// the "escrow half" of `C_initial`.
    pub total_escrow_deposited:  u64,
    /// Timestamp the member was last re-anchored via escape_valve_buy.
    /// 0 = original buyer at join_pool.
    pub last_transferred_at:     i64,
    pub bump:               u8,
}

impl Member {
    pub const SIZE: usize =
          8                 // anchor discriminator
        + 32 * 3            // pool, wallet, nft_asset
        + 1 + 1 + 2         // slot, level, stake_bps
        + 8                 // stake_deposited
        + 1                 // contributions_paid
        + 8 + 8 + 8         // total_contributed, total_received, escrow_balance
        + 2 + 2             // on_time_count, late_count
        + 1                 // defaulted
        + 1 + 1             // paid_out, last_released_checkpoint (Step 4b)
        + 8                 // joined_at
        + 8 + 8 + 8         // 4c: stake_deposited_initial, total_escrow_deposited, last_transferred_at
        + 1                 // bump
        + 6;                // padding (was 14 in Step 4b — 24 bytes consumed by 4c, 8 retained for future)

    /// Scheduled debt remaining at a given pool cycle.
    /// D_initial = pool.credit_amount (the credit taken when it's the member's slot);
    /// D_remaining = (cycles_total - contributions_paid) * installment_amount.
    /// Used by settle_default to enforce the debt/collateral invariant.
    pub fn debt_initial(pool_credit_amount: u64) -> u64 {
        pool_credit_amount
    }

    pub fn debt_remaining(&self, cycles_total: u8, installment_amount: u64) -> u64 {
        let unpaid = (cycles_total as u64).saturating_sub(self.contributions_paid as u64);
        unpaid.saturating_mul(installment_amount)
    }

    /// Collateral initial = stake locked at join + total escrow ever deposited.
    pub fn collateral_initial(&self) -> u64 {
        self.stake_deposited_initial
            .saturating_add(self.total_escrow_deposited)
    }

    /// Collateral remaining = current stake + current escrow balance.
    pub fn collateral_remaining(&self) -> u64 {
        self.stake_deposited.saturating_add(self.escrow_balance)
    }
}
