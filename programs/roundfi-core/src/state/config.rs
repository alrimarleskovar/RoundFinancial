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

    // ─── Yield adapter allowlist (mainnet canary safety, item 4.4) ────
    /// Pinned yield-adapter program ID. If non-default, `create_pool`
    /// rejects any `args.yield_adapter` that doesn't match this value.
    ///
    /// `Pubkey::default()` (all-zero) **disables** the allowlist —
    /// pools may point at any executable program. This is the devnet
    /// default; mainnet canary sets this to the deployed
    /// `roundfi-yield-kamino` program ID before the first pool is
    /// created, locking the canary's yield-adapter surface.
    ///
    /// Mutable via `update_protocol_config` so canary rampup can
    /// rotate (e.g. mock → kamino → kamino-v2). Distinct from
    /// `default_yield_adapter` above, which is informational metadata
    /// that's frozen at init.
    pub approved_yield_adapter: Pubkey,
    /// One-way kill switch for the adapter allowlist. Mirrors
    /// `treasury_locked` (#122) — once `true`, the
    /// `approved_yield_adapter` Pubkey is permanently frozen:
    /// `update_protocol_config` rejects further changes with
    /// `AdapterAllowlistLocked`. Authority calls
    /// `lock_approved_yield_adapter()` post-canary when confident
    /// the production yield-adapter program ID is final. Idempotent
    /// (calling twice is a no-op, not an error).
    pub approved_yield_adapter_locked: bool,

    // ─── #232: commit-reveal MEV mitigation for escape_valve_list ─────
    /// Gates the legacy single-step `escape_valve_list` path.
    /// When `true`, the legacy ix rejects with `CommitRevealRequired`
    /// and sellers must use `escape_valve_list_commit` +
    /// `escape_valve_list_reveal` (which apply the
    /// `REVEAL_COOLDOWN_SECS` anti-snipe window). When `false`, both
    /// paths coexist and the legacy listing is immediately buyable
    /// (`buyable_after = listed_at`).
    ///
    /// Mainnet flip path: authority sets to `true` after the canary
    /// validates the commit-reveal UX. Devnet stays `false` so demo
    /// flows keep their single-step ergonomics. Mutable via
    /// `update_protocol_config`; no lock-flag because flipping back
    /// to permissive is a recoverable operator decision (not a
    /// trust-surface change).
    pub commit_reveal_required: bool,

    // ─── Adevar Labs SEV-003 fix — yield waterfall policy ─────────────
    /// Share of the post-fee-and-GF residual that routes to LPs /
    /// Anjos de Liquidez. **Authoritative protocol policy** — was
    /// previously caller-controlled via `HarvestYieldArgs.lp_share_bps`,
    /// which let any permissionless cranker rotate the LP/participant
    /// split arbitrarily per call. The harvest_yield handler now
    /// reads this field and ignores the args value (the args field
    /// is retained for SDK back-compat but deprecated).
    ///
    /// Default initialized to `DEFAULT_LP_SHARE_BPS` (6_500 = 65%) per
    /// the whitepaper. Mutable via `update_protocol_config` (capped
    /// at MAX_BPS = 10_000). No lock-flag — LP economics may need
    /// adjustment over time as canary-driven calibration progresses.
    pub lp_share_bps: u16,

    // ─── Protocol-authority rotation (mainnet Squads ceremony, #3.6) ──
    /// Pending authority rotation. `Pubkey::default()` (all-zero) when
    /// no rotation is queued. Set by `propose_new_authority`, cleared
    /// by `cancel_new_authority` or finalized by `commit_new_authority`.
    /// Mirrors the treasury rotation pattern (#122): authority signs
    /// the propose, anyone can crank the commit after the timelock —
    /// so the rotation eventually completes even if the old authority
    /// key goes offline mid-window.
    ///
    /// Use case: bootstrap deployer → Squads multisig vault PDA at
    /// mainnet ceremony time. Once the vault is the authority, ongoing
    /// rotations (Squads-A → Squads-B) flow through the same instructions.
    pub pending_authority:       Pubkey,
    /// Earliest unix-ts at which `commit_new_authority` may execute.
    /// `0` when no rotation is pending. Equals
    /// `now + TREASURY_TIMELOCK_SECS` (7d) at the moment of proposal —
    /// the same window the treasury rotation uses, since authority is
    /// at least as sensitive a surface (authority controls treasury,
    /// fees, pause, allowlists, the whole config).
    ///
    /// No `authority_locked` kill-switch counterpart: locking authority
    /// permanently would break future Squads-A → Squads-B rotations
    /// (e.g. if a member key is compromised and the multisig needs to
    /// re-form with new members). Treasury has lock_treasury because
    /// "freeze the fee sink forever" is a coherent end-state; authority
    /// has no equivalent end-state.
    pub pending_authority_eta:   i64,
}

impl ProtocolConfig {
    // disc(8) + 6*Pubkey(32) + 5*u16(2) + 2*bool(1) + u8(1)
    //  + Pubkey(32) for pending_treasury + i64(8) for eta
    //  + 3*u64(8) for TVL caps (items 4.2 + 4.3 of MAINNET_READINESS)
    //  + Pubkey(32) for approved_yield_adapter (item 4.4)
    //  + 1 byte for approved_yield_adapter_locked (governance hardening)
    //  + 1 byte for commit_reveal_required (#232)
    //  + 32 bytes for pending_authority + 8 bytes for eta (Squads ceremony, #3.6)
    //  + 2 bytes for lp_share_bps (Adevar Labs SEV-003 fix)
    //  + 28 byte tail-padding.
    //
    // Note: SEV-003 consumed 2 of the 30 forward-compat pad bytes
    // (lp_share_bps as u16). 28 bytes remain for future additions.
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
        + 32                     // approved_yield_adapter
        + 1                      // approved_yield_adapter_locked
        + 1                      // commit_reveal_required (#232)
        + 32                     // pending_authority (#3.6 Squads ceremony)
        + 8                      // pending_authority_eta
        + 2                      // lp_share_bps (Adevar SEV-003)
        + 28;                    // forward-compat padding (was 30)
}
