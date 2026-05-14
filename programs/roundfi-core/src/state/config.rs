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

    // ─── TVL caps (mainnet canary safety, items 4.2 + 4.3 of MAINNET_READINESS) ───
    /// Maximum TVL allowed for a single pool, in USDC base units.
    /// Enforced at `init_pool_vaults` against the pool's max committed
    /// flow = `credit_amount * cycles_total`. A pool is the discrete
    /// unit of trust — capping per-pool bounds blast radius if a
    /// single pool turns adversarial.
    ///
    /// `0` means **disabled** (no cap) for back-compat with existing
    /// devnet pools. Mainnet canary plan sets a low value (e.g. $5)
    /// and ramps via `update_protocol_config` as canary data justifies.
    pub max_pool_tvl_usdc:        u64,
    /// Maximum TVL allowed across all pools combined, in USDC base
    /// units. Enforced at `init_pool_vaults` against
    /// `committed_protocol_tvl_usdc + new_pool_committed`. Caps the
    /// protocol's total exposure during canary roll-out.
    ///
    /// `0` means **disabled** (no cap). Mainnet canary plan starts at
    /// a small bound (e.g. $5–50) and ramps in 4 waves per the plan
    /// in `docs/operations/mainnet-canary-plan.md` §7.
    pub max_protocol_tvl_usdc:    u64,
    /// Running total of committed TVL across active pools.
    ///   - Incremented at `init_pool_vaults` by
    ///     `credit_amount * cycles_total` of the new pool.
    ///   - Decremented at `close_pool` by the same amount when the
    ///     pool reaches Completed/Liquidated.
    /// This is "max possible flow" not "current outstanding". The
    /// conservative bound is what canary safety asks for.
    pub committed_protocol_tvl_usdc: u64,
}

impl ProtocolConfig {
    // disc(8) + 6*Pubkey(32) + 5*u16(2) + 2*bool(1) + u8(1)
    //  + Pubkey(32) for pending_treasury + i64(8) for eta
    //  + 3*u64(8) for TVL caps (max_pool, max_protocol, committed)
    //  + 64 byte tail-padding. TVL caps consume 24 of the existing
    //    forward-compat slack — there were 23 bytes of margin in v0.1
    //    so we grow the padding total to keep ≥24 bytes free for next
    //    field additions.
    pub const SIZE: usize =
        8                        // anchor disc
        + (32 * 6)               // 6 base Pubkeys
        + (2 * 5)                // 5 fee/bps u16s
        + 1                      // paused
        + 1                      // bump
        + 1                      // treasury_locked
        + 32                     // pending_treasury
        + 8                      // pending_treasury_eta
        + 8                      // max_pool_tvl_usdc
        + 8                      // max_protocol_tvl_usdc
        + 8                      // committed_protocol_tvl_usdc
        + 64;                    // forward-compat padding (was 64; TVL fields claimed dedicated space above)
}
