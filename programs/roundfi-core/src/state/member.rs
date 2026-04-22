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
        + 1                 // bump
        + 14;               // padding (was 16 in v0.1)
}
