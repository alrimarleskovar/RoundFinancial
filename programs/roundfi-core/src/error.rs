use anchor_lang::prelude::*;

#[error_code]
pub enum RoundfiError {
    #[msg("Stake below required amount for this reputation level")]
    InsufficientStake,
    #[msg("Pool has reached members_target")]
    PoolFull,
    #[msg("Pool is not in Forming state")]
    PoolNotForming,
    #[msg("Pool is not in Active state")]
    PoolNotActive,
    #[msg("Pool is Completed or Liquidated")]
    PoolClosed,
    #[msg("Wallet already has a Member account for this pool")]
    AlreadyJoined,
    #[msg("Caller is not a member of this pool")]
    NotAMember,
    #[msg("Cycle index does not match pool.current_cycle")]
    WrongCycle,
    #[msg("next_cycle_at not yet reached")]
    CycleNotReady,
    #[msg("Member already contributed for this cycle")]
    AlreadyContributed,
    #[msg("Caller is not the slot owner for this cycle")]
    NotYourPayoutSlot,
    #[msg("Escrow release schedule not yet vested")]
    EscrowLocked,
    #[msg("Nothing to release from escrow")]
    EscrowNothingToRelease,
    #[msg("Member has defaulted")]
    DefaultedMember,
    #[msg("Seed Draw invariant would be violated")]
    SeedDrawShortfall,
    #[msg("Solidarity accounting overflow")]
    SolidarityOverflow,
    #[msg("Yield adapter program mismatch or not whitelisted")]
    InvalidYieldAdapter,
    #[msg("Pool's yield_adapter does not match passed program")]
    YieldAdapterMismatch,
    #[msg("Yield waterfall underflow or reordering detected")]
    WaterfallUnderflow,
    #[msg("Attestation schema does not match expected")]
    AttestationSchemaMismatch,
    #[msg("Reputation score underflow")]
    ReputationUnderflow,
    #[msg("Reputation level must be 1, 2, or 3")]
    InvalidReputationLevel,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Caller is not authorized")]
    Unauthorized,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Token mint does not match the expected USDC mint")]
    InvalidMint,
    #[msg("NFT asset does not match Member.nft_asset")]
    InvalidNftAsset,
    #[msg("Position is not listed on the escape valve")]
    EscapeValveNotListed,
    #[msg("Escape valve price mismatch")]
    EscapeValvePriceMismatch,
    #[msg("Slot is already taken")]
    SlotTaken,
    #[msg("Slot index out of range")]
    InvalidSlot,
    #[msg("Bps value must be <= 10_000 (or <= 50_000 for guarantee fund)")]
    InvalidBps,
    #[msg("members_target must be in 1..=MAX_MEMBERS")]
    InvalidMembersTarget,
    #[msg("cycle_duration below minimum")]
    InvalidCycleDuration,
    #[msg("Amount must be non-zero")]
    InvalidAmount,
    #[msg("Pool parameters are inconsistent")]
    InvalidPoolParams,
    #[msg("Metadata URI exceeds MAX_URI_LEN")]
    MetadataUriTooLong,
    #[msg("Metadata URI scheme not allowed (must be https://, ipfs://, or ar://)")]
    MetadataUriInvalidScheme,
    // ─── Step 4c ────────────────────────────────────────────────────────
    #[msg("Grace period not yet elapsed — default cannot be settled")]
    GracePeriodNotElapsed,
    #[msg("Member is current on contributions — default not applicable")]
    MemberNotBehind,
    #[msg("Debt/collateral invariant would be violated: D/D_init > C/C_init")]
    DebtCollateralViolation,
    #[msg("Yield adapter returned a nonsensical balance delta")]
    YieldAdapterBalanceMismatch,
    #[msg("Waterfall bucket computation did not conserve total")]
    WaterfallNotConserved,
    #[msg("Listing price must be non-zero")]
    InvalidListingPrice,
    #[msg("Listing is not active")]
    ListingNotActive,
    #[msg("Buyer already holds a Member account for this pool")]
    BuyerAlreadyMember,
    #[msg("Pool is not in Completed state")]
    PoolNotCompleted,
    #[msg("Protocol config field is immutable after initialization")]
    ImmutableConfigField,
    #[msg("Treasury is permanently locked — `lock_treasury()` was called")]
    TreasuryLocked,
    #[msg("No pending treasury rotation to commit or cancel")]
    NoPendingTreasuryChange,
    #[msg("Treasury rotation timelock has not yet elapsed")]
    TreasuryTimelockActive,
    #[msg("A treasury rotation is already pending — cancel it first")]
    TreasuryProposalAlreadyPending,
    #[msg("Post-CPI verification: asset owner is not the buyer after transfer")]
    AssetTransferIncomplete,
    #[msg("Post-CPI verification: asset is not frozen after re-freeze step")]
    AssetNotRefrozen,
    #[msg("Harvest realized yield is below the caller's slippage threshold")]
    HarvestSlippageExceeded,
    #[msg("Pool has outstanding defaults — cannot close")]
    OutstandingDefaults,
    #[msg("Yield adapter not configured for this pool")]
    YieldAdapterNotConfigured,
    // ─── Step 4e ────────────────────────────────────────────────────────
    #[msg("roundfi-reputation CPI failed — the attestation was rejected by the target program")]
    ReputationCpiFailed,
    #[msg("Passed reputation program does not match config.reputation_program")]
    ReputationProgramMismatch,
    #[msg("Asserted reputation_level does not match the on-chain ReputationProfile")]
    ReputationLevelMismatch,
    // ─── TVL caps (canary safety, items 4.2 + 4.3 of MAINNET_READINESS) ──
    #[msg("Pool max committed flow (credit_amount × cycles_total) exceeds config.max_pool_tvl_usdc")]
    PoolTvlCapExceeded,
    #[msg("Protocol-wide committed TVL would exceed config.max_protocol_tvl_usdc")]
    ProtocolTvlCapExceeded,
    // ─── Adapter allowlist governance (item 9 of post-#311 review) ─────
    #[msg("approved_yield_adapter is permanently locked — `lock_approved_yield_adapter()` was called")]
    AdapterAllowlistLocked,
}
