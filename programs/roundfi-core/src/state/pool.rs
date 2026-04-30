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

    // ─── Step 4c: yield waterfall + default tracking ────────────────────
    /// Running tally of USDC currently held in the Guarantee Fund.
    /// Replenished in step 2 of the yield waterfall (after the protocol
    /// fee is taken on gross). Debited on default shortfall (v2).
    pub guarantee_fund_balance:  u64,
    /// Cumulative protocol fee transferred to treasury over pool life.
    /// GF top-up cap = `guarantee_fund_bps * total_protocol_fee_accrued / 10_000`.
    pub total_protocol_fee_accrued: u64,
    /// Principal currently deposited in the yield adapter (tracked locally,
    /// never trusted from adapter).
    pub yield_principal_deposited: u64,
    /// Count of members that have been settled as defaulted.
    pub defaulted_members: u8,
    /// Earmark of the LP / Anjos de Liquidez slice from step 3 of the
    /// yield waterfall. Funds remain in `pool_usdc_vault` (logical
    /// accounting like the Guarantee Fund) until LP withdrawal pathway
    /// ships in M3. Don't conflate with `solidarity_balance`, which is
    /// funded ONLY from the 1% das parcelas in `contribute()`.
    pub lp_distribution_balance: u64,

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
        + 8 + 8 + 8 + 1        // 4c: gf_balance, total_protocol_fee_accrued, yield_principal, defaulted_members
        + 8                    // 4c v1.1: lp_distribution_balance (new)
        + 8                    // slots_bitmap (64 bits = 8 bytes)
        + 4                    // four bumps
        + 7;                   // padding (carried from v0.1)

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

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_pool(target: u8) -> Pool {
        let mut p = Pool::default();
        p.members_target = target;
        p
    }

    // ─── Slot bitmap — basic operations ─────────────────────────────────

    #[test]
    fn fresh_pool_has_all_slots_free() {
        let p = fresh_pool(24);
        for i in 0..24 {
            assert!(!p.is_slot_taken(i), "slot {i} should be free");
        }
        assert_eq!(p.next_free_slot(), Some(0));
    }

    #[test]
    fn mark_slot_sets_exactly_that_bit() {
        let mut p = fresh_pool(24);
        p.mark_slot_taken(5).unwrap();
        assert!(p.is_slot_taken(5));
        for i in 0..24 {
            if i != 5 {
                assert!(!p.is_slot_taken(i), "slot {i} should still be free");
            }
        }
    }

    // ─── Slot monotonicity: no reuse, no regression (invariant #6) ──────

    #[test]
    fn mark_slot_twice_is_rejected() {
        let mut p = fresh_pool(24);
        p.mark_slot_taken(7).unwrap();
        // Second attempt MUST error — slot_index uniqueness is what
        // prevents double-payout collisions in claim_payout.
        assert!(p.mark_slot_taken(7).is_err());
    }

    #[test]
    fn mark_slot_out_of_range_rejected() {
        let mut p = fresh_pool(24);
        assert!(p.mark_slot_taken(24).is_err()); // == members_target
        assert!(p.mark_slot_taken(63).is_err()); // still under bitmap width
        assert!(p.mark_slot_taken(64).is_err()); // bitmap overflow
        assert!(p.mark_slot_taken(u8::MAX).is_err());
    }

    #[test]
    fn next_free_slot_advances_monotonically() {
        // Once a slot is taken, next_free_slot must never return it again,
        // regardless of how many more slots are taken elsewhere.
        let mut p = fresh_pool(10);
        let mut seen = Vec::new();
        for _ in 0..10 {
            let s = p.next_free_slot().expect("free slot expected");
            assert!(!seen.contains(&s), "next_free_slot returned {s} twice");
            p.mark_slot_taken(s).unwrap();
            seen.push(s);
        }
        assert_eq!(p.next_free_slot(), None);
        // Every slot [0, members_target) accounted for exactly once.
        seen.sort_unstable();
        assert_eq!(seen, (0..10u8).collect::<Vec<_>>());
    }

    #[test]
    fn next_free_slot_is_lowest_free_index() {
        // Takes slot 0, 2, 3 → next_free_slot = 1, then 4.
        let mut p = fresh_pool(10);
        p.mark_slot_taken(0).unwrap();
        p.mark_slot_taken(2).unwrap();
        p.mark_slot_taken(3).unwrap();
        assert_eq!(p.next_free_slot(), Some(1));
        p.mark_slot_taken(1).unwrap();
        assert_eq!(p.next_free_slot(), Some(4));
    }

    #[test]
    fn next_free_slot_none_when_full() {
        let mut p = fresh_pool(3);
        p.mark_slot_taken(0).unwrap();
        p.mark_slot_taken(1).unwrap();
        p.mark_slot_taken(2).unwrap();
        assert_eq!(p.next_free_slot(), None);
    }

    // ─── Bitmap spans every byte of the [u8; 8] array ───────────────────

    #[test]
    fn bitmap_covers_full_64_slot_width() {
        let mut p = fresh_pool(64);
        for i in 0..64 {
            p.mark_slot_taken(i).unwrap();
            assert!(p.is_slot_taken(i), "mark failed at {i}");
        }
        // Every byte should now be 0xFF.
        for (i, b) in p.slots_bitmap.iter().enumerate() {
            assert_eq!(*b, 0xFF, "byte {i} not fully set");
        }
        assert_eq!(p.next_free_slot(), None);
    }

    #[test]
    fn bitmap_cross_byte_boundary() {
        // Slots 7 and 8 live in different bytes — verify no bleed-over.
        let mut p = fresh_pool(16);
        p.mark_slot_taken(7).unwrap();
        assert!( p.is_slot_taken(7));
        assert!(!p.is_slot_taken(8));
        p.mark_slot_taken(8).unwrap();
        assert!(p.is_slot_taken(8));
        // Other byte still isolated.
        assert_eq!(p.slots_bitmap[0] & 0x7F, 0); // only bit 7 set in byte 0
        assert_eq!(p.slots_bitmap[1] & 0xFE, 0); // only bit 0 set in byte 1
    }

    #[test]
    fn is_slot_taken_out_of_bitmap_returns_false() {
        // The bitmap only covers 64 slots; querying beyond must not panic.
        let p = fresh_pool(24);
        assert!(!p.is_slot_taken(64));
        assert!(!p.is_slot_taken(100));
        assert!(!p.is_slot_taken(u8::MAX));
    }
}
