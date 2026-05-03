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

    // ─── Treasury rotation safety (audit hardening) ────────────────────
    /// One-way kill switch. Once `true`, `treasury` is permanently
    /// frozen — `propose_new_treasury` rejects further proposals.
    /// Authority can call `lock_treasury()` after deployment when
    /// confident the treasury wallet is final, getting full
    /// immutability ON TOP of the time-lock.
    pub treasury_locked:        bool,
    /// Pending treasury rotation. `Pubkey::default()` (all-zero) when
    /// no rotation is queued. Set by `propose_new_treasury`, cleared
    /// by `cancel_new_treasury` or finalized by `commit_new_treasury`.
    pub pending_treasury:       Pubkey,
    /// Earliest unix-ts at which `commit_new_treasury` may execute.
    /// `0` when no rotation is pending. Equals `now + TREASURY_TIMELOCK_SECS`
    /// at the moment of proposal. Gives users a public window to
    /// detect a malicious authority and migrate before the swap.
    pub pending_treasury_eta:   i64,
}

impl ProtocolConfig {
    // disc(8) + 6*Pubkey(32) + 5*u16(2) + 2*bool(1) + u8(1)
    //  + Pubkey(32) for pending_treasury + i64(8) for eta
    //  + 64 byte tail-padding (was 64 in v0.1; pre-rotation fields
    //    consume 41 bytes → leaves 23 bytes of forward-compat slack).
    pub const SIZE: usize =
        8                        // anchor disc
        + (32 * 6)               // 6 base Pubkeys
        + (2 * 5)                // 5 fee/bps u16s
        + 1                      // paused
        + 1                      // bump
        + 1                      // treasury_locked
        + 32                     // pending_treasury
        + 8                      // pending_treasury_eta
        + 64;                    // forward-compat padding
}
