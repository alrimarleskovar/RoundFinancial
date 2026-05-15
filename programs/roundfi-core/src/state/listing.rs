use anchor_lang::prelude::*;

/// Escape-valve listing for a specific slot. PDA: `[b"listing", pool, slot_index]`.
///
/// Two creation paths:
///   1. **Legacy single-step** — `escape_valve_list(price)` creates the
///      listing directly in `Active` status. `commit_hash = [0;32]`,
///      `buyable_after = listed_at` (immediately buyable). Devnet UX
///      default; mainnet-gated by `config.commit_reveal_required`.
///   2. **Commit-reveal** (#232 MEV mitigation) —
///      `escape_valve_list_commit(commit_hash)` creates the listing in
///      `Pending` status with `price_usdc = 0` and the hash of
///      `(price || salt)` stored. The seller later calls
///      `escape_valve_list_reveal(price, salt)` to transition
///      `Pending → Active`; reveal sets `buyable_after = now +
///      REVEAL_COOLDOWN_SECS`, giving the legitimate buyer a fixed
///      window to land their buy tx before the now-public price can be
///      sniped by a searcher.
///
/// Consumed/closed by `escape_valve_buy` (which also enforces
/// `now >= buyable_after`).
#[account]
#[derive(Default)]
pub struct EscapeValveListing {
    pub pool:          Pubkey,
    pub seller:        Pubkey,     // the listing member's wallet
    pub slot_index:    u8,
    pub price_usdc:    u64,        // USDC base units buyer must pay seller
    pub status:        u8,         // EscapeValveStatus
    pub listed_at:     i64,
    pub bump:          u8,
    /// SHA-256(price.to_le_bytes() || salt.to_le_bytes()) for the
    /// commit-reveal path. `[0u8; 32]` for legacy single-step listings
    /// (sentinel — anything that *could* be a valid hash is fine here
    /// because the legacy path never enters the reveal handler).
    pub commit_hash:    [u8; 32],
    /// UNIX timestamp at which the listing becomes buyable.
    ///   - Legacy single-step: equals `listed_at` (no cooldown).
    ///   - Commit-reveal: equals `reveal_ts + REVEAL_COOLDOWN_SECS`.
    /// `escape_valve_buy` reverts with `ListingNotBuyableYet` while
    /// `now < buyable_after`.
    pub buyable_after:  i64,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum EscapeValveStatus {
    Active    = 0,
    Filled    = 1,
    Cancelled = 2,
    /// Listing committed (hash on chain) but not yet revealed. Cannot
    /// be bought. Cancellable by the seller (cancel flow lives outside
    /// the #232 scope but the variant is reserved for it).
    Pending   = 3,
}

impl EscapeValveListing {
    // disc(8) + 2*Pubkey(64) + u8(1) + u64(8) + u8(1) + i64(8) + u8(1)
    //   + commit_hash(32) + buyable_after(8) + pad(8)
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 8 + 1 + 8 + 1 + 32 + 8 + 8;
}
