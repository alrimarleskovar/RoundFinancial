use anchor_lang::prelude::*;

/// A SEALED free bid for one contemplation cycle (ADR 0012 Fase 3 —
/// lance livre). PDA seeds: `[b"bid", pool, cycle, bidder]`.
///
/// One envelope per (pool, cycle, bidder): a second `place_bid_commit`
/// for the same cycle collides on Anchor's `init` rather than
/// overwriting a sealed commitment — nobody gets to re-seal after
/// watching the room.
///
/// **What is actually sealed.** Only `commit_hash` exists until the
/// reveal window opens; `amount` and `parcels` stay 0. Since bidding
/// CLOSES before revealing OPENS (`place_bid_commit` requires
/// `clock < pool.next_cycle_at`, `place_bid_reveal` requires
/// `clock >= next_cycle_at`), a bidder who watches other envelopes open
/// can no longer commit — and cannot change the amount they already
/// sealed. That temporal split is the whole anti-snipe property; it
/// replaces the Fase 2 posture where a late embedded bid could simply
/// outbid whatever it saw.
///
/// **No funds live here.** The reveal pays the bid straight into the
/// pool's normal vaults through `split_installment`, exactly as
/// `contribute` does, and the swap is Fase 2's. So there is no bid
/// vault, no refund path and no settlement step to audit: a losing
/// reveal simply REVERTS (the bidder keeps their USDC), and a winning
/// one has already become the bidder's own prepaid installments.
#[account]
#[derive(Default)]
pub struct Bid {
    pub pool:        Pubkey,
    pub bidder:      Pubkey,
    /// The contemplation cycle this envelope competes for. Part of the
    /// PDA seeds, so a bid can never be replayed into another cycle.
    pub cycle:       u8,
    /// `sha256(amount.to_le_bytes() || salt.to_le_bytes() || bidder)`.
    /// The bidder is INSIDE the pre-image (unlike the #232 listing
    /// commit) so a copied hash can't be revealed from another wallet.
    pub commit_hash: [u8; 32],
    /// USDC actually bid — 0 until revealed.
    pub amount:      u64,
    /// Installments the bid bought (`amount / installment_amount`) —
    /// 0 until revealed.
    pub parcels:     u8,
    /// `BidState`.
    pub state:       u8,
    pub committed_at: i64,
    pub bump:        u8,
    pub _padding:    [u8; 7],
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum BidState {
    /// Envelope sealed; amount unknown to everyone but the bidder.
    Committed = 0,
    /// Opened and paid. Terminal — one reveal per commit.
    Revealed  = 1,
}

impl Bid {
    pub const SIZE: usize =
          8                    // anchor discriminator
        + 32 + 32              // pool, bidder
        + 1                    // cycle
        + 32                   // commit_hash
        + 8                    // amount
        + 1 + 1                // parcels, state
        + 8                    // committed_at
        + 1                    // bump
        + 7;                   // padding
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_matches_field_layout() {
        // 8 + 64 + 1 + 32 + 8 + 2 + 8 + 1 + 7
        assert_eq!(Bid::SIZE, 131);
    }

    #[test]
    fn state_discriminants_are_stable() {
        // Persisted as a raw byte — renumbering would silently reclassify
        // every envelope already on chain.
        assert_eq!(BidState::Committed as u8, 0);
        assert_eq!(BidState::Revealed as u8, 1);
    }

    #[test]
    fn default_bid_reads_as_committed_with_no_funds() {
        let b = Bid::default();
        assert_eq!(b.state, BidState::Committed as u8);
        assert_eq!(b.amount, 0);
        assert_eq!(b.parcels, 0);
    }
}
