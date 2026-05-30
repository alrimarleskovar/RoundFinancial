use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::{Member, Pool, PoolStatus, ProtocolConfig};

/// Reclaim a finalized pool's per-member rent (SEV-039).
///
/// `close_pool` is a pure terminal-state transition and leaves the Pool PDA,
/// the Member PDAs, and the four vault ATAs allocated — their rent stays
/// locked. This instruction closes ONE Member PDA after the pool is `Closed`,
/// returning its rent to the member's wallet. Combined with `close_pool_vaults`
/// (drains the vaults to treasury + closes the 4 ATAs + the Pool PDA), it
/// completes the SEV-039 rent-reclaim ceremony: `close_pool` → `close_member`
/// × N → `close_pool_vaults`. Permissioned to the pool/protocol authority (or
/// the member themselves) so cleanup can be cranked without griefing.
///
/// Decrements `pool.members_joined` — repurposed post-close as the count of
/// still-open Member PDAs. `close_pool_vaults` requires it to reach 0 before it
/// closes the Pool PDA, so no Member PDA's rent is stranded (closing the Pool
/// PDA first would make the `pool` seed unsatisfiable here).
#[derive(Accounts)]
pub struct CloseMember<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        mut,
        seeds = [SEED_POOL, pool.authority.as_ref(), &pool.seed_id.to_le_bytes()],
        bump = pool.bump,
        // Only after the pool is terminally Closed — the member's lifecycle is
        // over, so its PDA is safe to reclaim.
        constraint = pool.status == PoolStatus::Closed as u8 @ RoundfiError::PoolNotClosed,
        constraint = (authority.key() == pool.authority
            || authority.key() == config.authority
            || authority.key() == member_wallet.key()) @ RoundfiError::Unauthorized,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// CHECK: the member's wallet — the Member-PDA seed AND the rent recipient.
    #[account(mut)]
    pub member_wallet: UncheckedAccount<'info>,

    // Anchor `close = member_wallet` returns the Member PDA's lamports to the
    // member's wallet and zeroes the account.
    #[account(
        mut,
        close = member_wallet,
        seeds = [SEED_MEMBER, pool.key().as_ref(), member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.wallet == member_wallet.key() @ RoundfiError::NotAMember,
    )]
    pub member: Box<Account<'info, Member>>,
}

pub fn handler(ctx: Context<CloseMember>) -> Result<()> {
    // Repurpose members_joined as the live open-Member-PDA count once the pool
    // is terminal. saturating_sub guards the (Anchor-impossible) double-close:
    // a second call on the same PDA fails the seeds/owner check, since the
    // account is already gone.
    let pool = &mut ctx.accounts.pool;
    pool.members_joined = pool.members_joined.saturating_sub(1);

    msg!(
        "roundfi-core: close_member pool={} member={} slot={} members_remaining={} (rent reclaimed to member)",
        pool.key(),
        ctx.accounts.member_wallet.key(),
        ctx.accounts.member.slot_index,
        pool.members_joined,
    );
    Ok(())
}
