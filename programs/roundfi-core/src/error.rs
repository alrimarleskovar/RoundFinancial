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
}
