use anchor_lang::prelude::*;

use crate::constants::{MAX_MEMBERS, SEED_DRAW_RESULT};
use crate::error::RoundfiError;

/// Result of a pool's payout-order draw (sorteio ordering policy).
/// PDA seeds: `[b"draw-result", pool]` — one per pool, minted exactly
/// once: normally by the ACTIVATING `join_pool` (auto-draw — the last
/// joiner's tx draws the order atomically), else by the permissionless
/// `finalize_draw` backstop. The `init`-style collision on the PDA makes
/// the two paths mutually exclusive.
///
/// `order[seat] == cycle` — the member holding arrival-seat `seat`
/// (their immutable `member.slot_index`) is contemplated in payout
/// cycle `cycle`. `roundfi_math::draw_slot_order` guarantees the first
/// `members_target` entries form a bijection over `0..members_target`,
/// so every cycle has exactly one recipient and nobody receives twice.
///
/// Seat identity NEVER changes: the position NFT, its
/// `position_authority` freeze/transfer delegate, and escape-valve
/// listings all stay keyed by `slot_index`. Only the *timing* question
/// ("which cycle does this seat receive in?") routes through this
/// account — which is what lets the escape valve sell a sorteio seat
/// with its drawn turn attached, unchanged.
#[account]
pub struct DrawResult {
    /// Pool this draw belongs to (redundant with the PDA seeds; kept for
    /// direct-read ergonomics off-chain).
    pub pool: Pubkey,
    /// Entropy the permutation was derived from (auditability: anyone
    /// can re-run `draw_slot_order(seed, n)` and check `order`).
    /// v1-canary: sha256(pool ‖ slot ‖ unix_timestamp ‖ members) at
    /// finalize time — grindable at the margin by the finalize caller;
    /// a VRF-bound seed replaces this before mainnet (ADR pool_v2).
    pub seed: [u8; 32],
    /// seat → payout cycle. Only `order[..members_target]` is
    /// meaningful; the tail stays zero.
    pub order: [u8; MAX_MEMBERS as usize],
    /// Snapshot of `pool.members_target` at draw time — bounds `order`.
    pub members_target: u8,
    pub bump: u8,
}

impl DrawResult {
    pub const SIZE: usize = 8      // anchor discriminator
        + 32                       // pool
        + 32                       // seed
        + MAX_MEMBERS as usize     // order (64)
        + 1                        // members_target
        + 1                        // bump
        + 6;                       // padding

    /// Payout cycle for a given arrival seat.
    #[inline]
    pub fn cycle_for_seat(&self, seat: u8) -> Result<u8> {
        require!(seat < self.members_target, RoundfiError::InvalidSlot);
        Ok(self.order[seat as usize])
    }

    /// Load + fully verify a `DrawResult` passed via `remaining_accounts`.
    ///
    /// The draw account rides in `remaining_accounts` (not the declared
    /// struct) so ArrivalOrder pools keep their exact pre-sorteio call
    /// shape — no account-count ABI change for every existing pool,
    /// encoder, and script (the 15→16 crank migration of SEV-053 showed
    /// how expensive that coupling is). Because remaining accounts skip
    /// Anchor's constraint layer, this loader re-does ALL of it:
    ///   1. owner == this program;
    ///   2. address == the canonical `[b"draw-result", pool]` PDA (an
    ///      attacker-crafted account at a different address is rejected
    ///      even if its bytes decode);
    ///   3. discriminator + borsh via `try_deserialize` (rejects any
    ///      other account type owned by this program);
    ///   4. recorded pool matches (belt-and-braces with 2).
    pub fn load_verified(info: &AccountInfo<'_>, pool: &Pubkey) -> Result<DrawResult> {
        require!(info.owner == &crate::ID, RoundfiError::InvalidDrawAccount);
        let (expected, _bump) =
            Pubkey::find_program_address(&[SEED_DRAW_RESULT, pool.as_ref()], &crate::ID);
        require!(info.key == &expected, RoundfiError::InvalidDrawAccount);
        let data = info.try_borrow_data()?;
        let draw = DrawResult::try_deserialize(&mut &data[..])?;
        require!(&draw.pool == pool, RoundfiError::InvalidDrawAccount);
        Ok(draw)
    }
}

/// Policy-aware contemplation check shared by `claim_payout`,
/// `crank_payout` and `skip_defaulted_payout`.
///
/// ArrivalOrder: seat IS the cycle (`slot_index == cycle`, unchanged).
/// Sorteio: the cycle for this seat comes from the pool's `DrawResult`,
/// which the caller must append as the FIRST remaining account; a
/// sorteio pool whose draw hasn't been finalized (or whose caller
/// omitted the account) fails with `DrawRequired` — payouts are
/// unreachable until the draw exists, never silently arrival-ordered.
pub fn contemplated_cycle_for_seat(
    ordering_policy: u8,
    seat: u8,
    pool: &Pubkey,
    remaining: &[AccountInfo<'_>],
) -> Result<u8> {
    if ordering_policy == crate::constants::ORDERING_SORTEIO {
        let info = remaining.first().ok_or(error!(RoundfiError::DrawRequired))?;
        let draw = DrawResult::load_verified(info, pool)?;
        draw.cycle_for_seat(seat)
    } else {
        Ok(seat)
    }
}
