use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::{Member, Pool, PoolStatus, ProtocolConfig};

/// Reclaim a finalized pool's per-member rent (SEV-039, partial).
///
/// `close_pool` is a pure terminal-state transition and leaves the Pool PDA,
/// the Member PDAs, and the four vault ATAs allocated — their rent stays
/// locked (SEV-039, Informational). This instruction closes ONE Member PDA
/// after the pool is `Closed`, returning its rent to the member's wallet. It's
/// the tractable bulk of SEV-039 (N member PDAs); draining + closing the
/// vault ATAs and the Pool PDA is a larger multi-tx ceremony tracked
/// separately. Permissioned to the pool/protocol authority (or the member
/// themselves) so cleanup can be cranked without griefing.
#[derive(Accounts)]
pub struct CloseMember<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
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
    msg!(
        "roundfi-core: close_member pool={} member={} slot={} (rent reclaimed to member)",
        ctx.accounts.pool.key(),
        ctx.accounts.member_wallet.key(),
        ctx.accounts.member.slot_index,
    );
    Ok(())
}
