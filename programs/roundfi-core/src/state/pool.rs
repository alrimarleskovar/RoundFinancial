use anchor_lang::prelude::*;

use crate::error::RoundfiError;

/// A ROSCA pool. PDA seeds: `[b"pool", authority, seed_id_le]`.
#[account]
#[derive(Default)]
pub struct Pool {
    // ─── Identity ───────────────────────────────────────────────────────
    pub authority:          Pubkey,   // pool creator
    pub seed_id:            u64,      // unique per authority
    pub usdc_mint:          Pubkey,
    pub yield_adapter:      Pubkey,   // snapshot at creation — immutable

    // ─── Product params (immutable after creation) ──────────────────────
    pub members_target:     u8,
    pub installment_amount: u64,
    pub credit_amount:      u64,
    pub cycles_total:       u8,
    pub cycle_duration:     i64,
    pub seed_draw_bps:      u16,
    pub solidarity_bps:     u16,
    pub escrow_release_bps: u16,

    // ─── Runtime state ──────────────────────────────────────────────────
    pub members_joined:     u8,
    pub status:             u8,       // PoolStatus
    pub started_at:         i64,
    pub current_cycle:      u8,
    pub next_cycle_at:      i64,
    pub total_contributed:  u64,
    pub total_paid_out:     u64,
    pub solidarity_balance: u64,
    pub escrow_balance:     u64,
    pub yield_accrued:      u64,

    /// Bitmap over MAX_MEMBERS=64 slots. Bit set ⇒ slot taken.
    pub slots_bitmap:       [u8; 8],

    // ─── Bumps ──────────────────────────────────────────────────────────
    pub bump:                  u8,
    pub escrow_vault_bump:     u8,
    pub solidarity_vault_bump: u8,
    pub yield_vault_bump:      u8,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PoolStatus {
    Forming    = 0,
    Active     = 1,
    Completed  = 2,
    Liquidated = 3,
}

impl Pool {
    pub const SIZE: usize =
          8                    // anchor discriminator
        + 32 + 8 + 32 + 32     // authority, seed_id, usdc_mint, yield_adapter
        + 1 + 8 + 8 + 1 + 8    // target, installment, credit, cycles, duration
        + 2 + 2 + 2            // seed_draw, solidarity, escrow_release bps
        + 1 + 1 + 8 + 1 + 8    // joined, status, started_at, current_cycle, next_cycle_at
        + 8 + 8 + 8 + 8 + 8    // contributed, paid_out, solidarity, escrow, yield
        + 8                    // slots_bitmap (64 bits = 8 bytes)
        + 4                    // four bumps
        + 32;                  // padding for future state fields

    #[inline]
    pub fn is_slot_taken(&self, slot: u8) -> bool {
        let idx = (slot / 8) as usize;
        if idx >= self.slots_bitmap.len() {
            return false;
        }
        (self.slots_bitmap[idx] & (1u8 << (slot % 8))) != 0
    }

    pub fn mark_slot_taken(&mut self, slot: u8) -> Result<()> {
        require!(slot < self.members_target, RoundfiError::InvalidSlot);
        require!(!self.is_slot_taken(slot), RoundfiError::SlotTaken);
        let idx = (slot / 8) as usize;
        self.slots_bitmap[idx] |= 1u8 << (slot % 8);
        Ok(())
    }

    pub fn next_free_slot(&self) -> Option<u8> {
        (0..self.members_target).find(|&i| !self.is_slot_taken(i))
    }
}
