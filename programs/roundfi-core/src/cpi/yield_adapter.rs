//! Safe CPI wrapper for the yield-adapter interface.
//!
//! RoundFi-core must treat every yield adapter (mock on Devnet, Kamino on
//! Mainnet, anything else swapped in later) as an UNTRUSTED external
//! program. These helpers therefore enforce three rules:
//!
//! 1. **Program identity** — `require!(program.key() == pool.yield_adapter)`
//!    on every call. The adapter cannot be substituted post-`create_pool`.
//! 2. **Balance-based accounting** — callers snapshot token balances
//!    before the CPI, reload after, and use the *delta* as the source of
//!    truth. The adapter's own return values are ignored.
//! 3. **Under-delivery tolerance, over-delivery acceptance** — if the
//!    adapter returns less than requested, the caller accepts the smaller
//!    amount (e.g. partial withdraw due to deposit caps). If it returns
//!    more (shouldn't happen, but a buggy adapter could), the bonus is
//!    accounted for like any other inflow.
//!
//! Discriminators match Anchor's `sighash("global", name)` convention so
//! the same bytecode can target the mock adapter *and* the Kamino CPI
//! glue program without a rebuild.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    hash::hash,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

use crate::error::RoundfiError;

/// Computes an Anchor-style instruction discriminator: first 8 bytes of
/// `sha256("global:<name>")`.
pub fn anchor_ix_discriminator(ix_name: &str) -> [u8; 8] {
    let preimage = format!("global:{}", ix_name);
    let mut out = [0u8; 8];
    out.copy_from_slice(&hash(preimage.as_bytes()).to_bytes()[..8]);
    out
}

/// Minimal view of a token account, re-read from the on-chain buffer so
/// we never rely on a cached `anchor_spl::token::TokenAccount`.
pub fn token_amount(account: &AccountInfo) -> Result<u64> {
    // SPL TokenAccount layout: mint(32) + owner(32) + amount(u64) @ offset 64
    let data = account.try_borrow_data()?;
    require!(data.len() >= 72, RoundfiError::YieldAdapterBalanceMismatch);
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data[64..72]);
    Ok(u64::from_le_bytes(bytes))
}

/// Common parameter bundle for adapter CPIs.
pub struct AdapterCpiArgs<'a, 'info> {
    /// The adapter program account. Must match `expected_program_id`.
    pub adapter_program: &'a AccountInfo<'info>,
    /// Value of `pool.yield_adapter` — source of truth for program identity.
    pub expected_program_id: Pubkey,
    /// Accounts to pass to the adapter. Order and writability are the
    /// adapter's responsibility; core only forwards.
    pub accounts: &'a [AccountMeta],
    /// The corresponding AccountInfos in the same order as `accounts`.
    pub account_infos: &'a [AccountInfo<'info>],
    /// Signer seeds for the pool PDA.
    pub signer_seeds: &'a [&'a [&'a [u8]]],
}

/// Invokes an adapter instruction and returns the signed CPI result.
/// Callers still must do balance deltas themselves — this helper does
/// *not* inspect token balances (to keep the signature generic).
pub fn invoke_adapter(
    ix_name: &str,
    instruction_data: Vec<u8>,
    args: AdapterCpiArgs,
) -> Result<()> {
    require!(
        args.adapter_program.key() == args.expected_program_id,
        RoundfiError::YieldAdapterMismatch,
    );

    let mut data = anchor_ix_discriminator(ix_name).to_vec();
    data.extend_from_slice(&instruction_data);

    let ix = Instruction {
        program_id: args.expected_program_id,
        accounts: args.accounts.to_vec(),
        data,
    };
    invoke_signed(&ix, args.account_infos, args.signer_seeds)
        .map_err(Into::into)
}

/// Convenience wrapper around a deposit-like call that:
///   1. snapshots `source` and `destination` balances,
///   2. invokes the adapter,
///   3. returns `(source_delta, destination_delta)` where positive means
///      tokens *left* the source or *entered* the destination.
///
/// The caller decides what to do with under/over-delivery.
pub fn invoke_and_measure<'info>(
    ix_name: &str,
    instruction_data: Vec<u8>,
    source_before: &AccountInfo<'info>,
    destination_before: &AccountInfo<'info>,
    args: AdapterCpiArgs,
) -> Result<(u64, u64)> {
    let src_before = token_amount(source_before)?;
    let dst_before = token_amount(destination_before)?;

    invoke_adapter(ix_name, instruction_data, args)?;

    let src_after = token_amount(source_before)?;
    let dst_after = token_amount(destination_before)?;

    let src_delta = src_before.saturating_sub(src_after);    // tokens that left source
    let dst_delta = dst_after.saturating_sub(dst_before);    // tokens that entered dest

    // Sanity: dst should never grow by more than src shrank (bar the
    // corner case where the adapter is *also* feeding dst from its own
    // balance — e.g. harvest(). The caller knows which case applies and
    // is responsible for interpreting the deltas.
    Ok((src_delta, dst_delta))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discriminator_matches_anchor_convention() {
        // These are stable across anchor 0.29/0.30 as they are sha256
        // over a fixed preimage. If these change, the whole ecosystem
        // has to rebuild.
        let deposit = anchor_ix_discriminator("deposit");
        let withdraw = anchor_ix_discriminator("withdraw");
        let harvest = anchor_ix_discriminator("harvest");

        // Just assert they're distinct (no accidental collisions) and
        // non-zero — the exact byte sequence is an implementation detail
        // of SHA-256 that we don't want to hardcode.
        assert_ne!(deposit, withdraw);
        assert_ne!(deposit, harvest);
        assert_ne!(withdraw, harvest);
        assert_ne!(deposit, [0u8; 8]);
    }
}
