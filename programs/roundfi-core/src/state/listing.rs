use anchor_lang::prelude::*;

/// Escape-valve listing for a specific slot. PDA: `[b"listing", pool, slot_index]`.
/// Created by `escape_valve_list`, consumed/closed by `escape_valve_buy` or
/// `escape_valve_cancel` (the latter lives in a later step).
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
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum EscapeValveStatus {
    Active   = 0,
    Filled   = 1,
    Cancelled = 2,
}

impl EscapeValveListing {
    // disc(8) + 2*Pubkey(64) + u8(1) + u64(8) + u8(1) + i64(8) + u8(1) + pad(8)
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 8 + 1 + 8 + 1 + 8;
}
