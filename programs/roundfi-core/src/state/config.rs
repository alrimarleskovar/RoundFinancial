use anchor_lang::prelude::*;

/// Protocol-wide singleton configuration. PDA seeds: `[b"config"]`.
#[account]
#[derive(Default)]
pub struct ProtocolConfig {
    pub authority:             Pubkey,   // multisig on mainnet
    pub treasury:              Pubkey,   // USDC ATA receiving protocol fees
    pub usdc_mint:             Pubkey,
    pub metaplex_core:         Pubkey,
    pub default_yield_adapter: Pubkey,   // mock (devnet) / kamino (mainnet)
    pub reputation_program:    Pubkey,
    pub fee_bps_yield:         u16,      // 2000 = 20%
    pub fee_bps_cycle_l1:      u16,      // 200  = 2%
    pub fee_bps_cycle_l2:      u16,      // 100  = 1%
    pub fee_bps_cycle_l3:      u16,      // 0    = veteran exempt
    pub guarantee_fund_bps:    u16,      // 15000 = 150% of protocol yield
    pub paused:                bool,
    pub bump:                  u8,
}

impl ProtocolConfig {
    // disc(8) + 6*Pubkey(32) + 5*u16(2) + bool(1) + u8(1) + 64 padding
    pub const SIZE: usize = 8 + (32 * 6) + (2 * 5) + 1 + 1 + 64;
}
