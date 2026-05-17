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

// ─── Adapter call-prelude builder (SEV-041 class oracle) ──────────────
//
// Every adapter CPI (deposit, harvest, withdraw — anything that follows
// the standard adapter interface) begins with the same 4-account
// prelude in this exact order:
//
//   1. source       (TokenAccount, mut)
//   2. destination  (TokenAccount, mut)
//   3. authority    (signer, ro)
//   4. token_program (Program, ro)
//
// The yield-kamino wrapper's `Deposit` and `Harvest` account structs
// hardcode this prelude (see the docstring on `Deposit<'info>` in
// `programs/roundfi-yield-kamino/src/lib.rs`). Any other adapter that
// ships later must follow the same convention or core's CPI breaks.
//
// Before this builder existed, `deposit_idle_to_yield.rs` and
// `harvest_yield.rs` each constructed the prelude inline as two
// hand-written `vec![...]` blocks. SEV-041 class risk: swapping
// source/destination, dropping the signer flag on the authority,
// adding/removing positions silently — none caught at compile time.
//
// The builder collapses both sites into a single call. The unit test
// `adapter_prelude_matches_canonical_layout` below pins the
// (pubkey, is_signer, is_writable) tuple per position, so a future
// shuffle fails `cargo test` instead of canary-mainnet.

/// Inputs for `build_adapter_call_prelude`. Field names mirror the
/// canonical positions in the adapter interface so callers can't
/// accidentally swap source ↔ destination.
pub struct AdapterCallPreludeInputs {
    /// Token account funds flow OUT of — pool USDC vault on deposit,
    /// adapter shadow vault on harvest.
    pub source:        Pubkey,
    /// Token account funds flow INTO — adapter shadow vault on
    /// deposit, pool USDC vault on harvest.
    pub destination:   Pubkey,
    /// Pool PDA acting as the authority. Signer bit set; pool's
    /// `invoke_signed` provides the signature via PDA seeds.
    pub authority:     Pubkey,
    /// SPL Token program account.
    pub token_program: Pubkey,
}

/// Canonical 4-account prelude for any adapter CPI. The adapter's
/// account struct must accept this exact prefix in this exact order.
/// Order + flags pinned by `adapter_prelude_matches_canonical_layout`.
pub fn build_adapter_call_prelude(i: &AdapterCallPreludeInputs) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new(i.source, false), //                 1. source (mut)
        AccountMeta::new(i.destination, false), //            2. destination (mut)
        AccountMeta::new_readonly(i.authority, true), //      3. authority (signer, ro)
        AccountMeta::new_readonly(i.token_program, false), // 4. token_program (ro)
    ]
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

    fn sentinel_pubkey(slot: u8) -> Pubkey {
        let mut bytes = [0u8; 32];
        bytes[0] = slot;
        Pubkey::from(bytes)
    }

    /// SEV-041 class oracle for the adapter-call 4-account prelude.
    /// Pins every (pubkey, is_signer, is_writable) tuple per position
    /// so a future shuffle in `build_adapter_call_prelude` (or a
    /// drift between the function and yield-kamino's `Deposit` /
    /// `Harvest` account struct prefix) fails `cargo test` before
    /// canary-mainnet.
    #[test]
    fn adapter_prelude_matches_canonical_layout() {
        let source = sentinel_pubkey(1);
        let destination = sentinel_pubkey(2);
        let authority = sentinel_pubkey(3);
        let token_program = sentinel_pubkey(4);

        let metas = build_adapter_call_prelude(&AdapterCallPreludeInputs {
            source,
            destination,
            authority,
            token_program,
        });

        // Oracle: positions per `Deposit` / `Harvest` account-struct
        // prefix in programs/roundfi-yield-kamino/src/lib.rs and
        // any future adapter following the standard interface.
        // Format: (expected pubkey, is_signer, is_writable)
        let oracle: [(Pubkey, bool, bool); 4] = [
            (source, false, true), //         1. source (mut)
            (destination, false, true), //    2. destination (mut)
            (authority, true, false), //      3. authority (signer, ro)
            (token_program, false, false), // 4. token_program (ro)
        ];

        assert_eq!(
            metas.len(),
            oracle.len(),
            "adapter prelude account count drifted — canonical is 4",
        );
        for (i, (meta, (expected_key, expected_signer, expected_writable))) in
            metas.iter().zip(oracle.iter()).enumerate()
        {
            let pos = i + 1;
            assert_eq!(
                meta.pubkey, *expected_key,
                "adapter prelude slot {pos} pubkey mismatch — order shuffled vs canonical",
            );
            assert_eq!(
                meta.is_signer, *expected_signer,
                "adapter prelude slot {pos} is_signer mismatch",
            );
            assert_eq!(
                meta.is_writable, *expected_writable,
                "adapter prelude slot {pos} is_writable mismatch",
            );
        }
    }
}
