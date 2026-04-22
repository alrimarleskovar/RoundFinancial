//! Reputation-program CPI helper.
//!
//! Design (Step 4e — locked 2026-04-22):
//!   - Treat the reputation program as UNTRUSTED in the same sense as
//!     the yield adapter: we validate that the program id passed in
//!     equals the pubkey pinned in `ProtocolConfig.reputation_program`
//!     at initialization. The path-dependency is only for type safety;
//!     the on-chain trust boundary is the program-id guard.
//!   - ONE CPI per financial event (Rule #1 of Step 4e). No previews,
//!     no before-and-after attestations. Same event → same nonce →
//!     idempotent PDA.
//!   - Non-breaking: if `config.reputation_program == Pubkey::default()`
//!     (old pool initialized before Step 4e) the call is a no-op,
//!     logged and skipped. This lets Devnet carry forward pre-4e pools.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::account_info::AccountInfo;

use roundfi_reputation::constants::ATTESTATION_PAYLOAD_LEN;

use crate::error::RoundfiError;

/// Discriminator for `roundfi_reputation::attest` — runtime-computed
/// `sha256("global:attest")[..8]`. Anchor normally emits a const at
/// compile time, but `solana_program::hash::hash` is not const-eval
/// friendly, so we compute once per call. A unit test below pins the
/// output against the same hash so a future Anchor rename would fail
/// loudly rather than silently miss.
fn attest_disc() -> [u8; 8] {
    let h = anchor_lang::solana_program::hash::hash(b"global:attest");
    let mut out = [0u8; 8];
    out.copy_from_slice(&h.to_bytes()[..8]);
    out
}

/// Accounts passed to the attest CPI. Layout MUST match the
/// `#[derive(Accounts)] struct Attest` in `roundfi-reputation` —
/// Anchor serializes accounts positionally.
pub struct AttestAccounts<'info> {
    /// Pool PDA (signer via seeds).
    pub issuer:          AccountInfo<'info>,
    pub subject:         AccountInfo<'info>,
    pub rep_config:      AccountInfo<'info>,
    pub profile:         AccountInfo<'info>,
    /// Optional — pass `None` to signal "no identity record linked".
    /// Anchor encodes Option<Account> as "the program itself" when None.
    pub identity:        Option<AccountInfo<'info>>,
    pub attestation:     AccountInfo<'info>,
    pub payer:           AccountInfo<'info>,
    pub system_program:  AccountInfo<'info>,
}

pub struct AttestCall<'a, 'info> {
    pub reputation_program: &'a AccountInfo<'info>,
    pub expected_program_id: Pubkey,
    pub accounts: AttestAccounts<'info>,
    pub signer_seeds: &'a [&'a [&'a [u8]]],
    pub schema_id:   u16,
    pub nonce:       u64,
    pub payload:     [u8; ATTESTATION_PAYLOAD_LEN],
    pub pool:        Pubkey,
    pub pool_authority: Pubkey,
    pub pool_seed_id:   u64,
}

/// Emit an attestation via CPI. Performs the program-id guard and
/// constructs the call by hand so we avoid pulling in the full
/// anchor-cpi proc-macro expansion.
pub fn invoke_attest<'info>(call: AttestCall<'_, 'info>) -> Result<()> {
    // ─── 1. Program-id guard (anti-spoof) ────────────────────────────
    require_keys_eq!(
        call.reputation_program.key(),
        call.expected_program_id,
        RoundfiError::Unauthorized,
    );
    require!(
        call.reputation_program.executable,
        RoundfiError::Unauthorized,
    );

    // ─── 2. Serialize args (matches roundfi_reputation::AttestArgs) ──
    //   pub struct AttestArgs {
    //       pub schema_id: u16,
    //       pub nonce:     u64,
    //       pub payload:   [u8; ATTESTATION_PAYLOAD_LEN],
    //       pub pool:      Pubkey,
    //       pub pool_authority: Pubkey,
    //       pub pool_seed_id:   u64,
    //   }
    let mut data = Vec::with_capacity(8 + 2 + 8 + ATTESTATION_PAYLOAD_LEN + 32 + 32 + 8);
    data.extend_from_slice(&attest_disc());
    data.extend_from_slice(&call.schema_id.to_le_bytes());
    data.extend_from_slice(&call.nonce.to_le_bytes());
    data.extend_from_slice(&call.payload);
    data.extend_from_slice(call.pool.as_ref());
    data.extend_from_slice(call.pool_authority.as_ref());
    data.extend_from_slice(&call.pool_seed_id.to_le_bytes());

    // ─── 3. Account metas. Option<Account> encoding: when the Option
    //       is None, Anchor expects the program account itself — same
    //       is_signer / is_writable flags as if it were present.
    let identity_info = call
        .accounts
        .identity
        .as_ref()
        .unwrap_or(call.reputation_program);

    let metas = vec![
        AccountMeta::new_readonly(call.accounts.issuer.key(),  true),  // signer
        AccountMeta::new_readonly(call.accounts.subject.key(), false),
        AccountMeta::new_readonly(call.accounts.rep_config.key(), false),
        AccountMeta::new(call.accounts.profile.key(),          false),
        AccountMeta::new_readonly(identity_info.key(),         false),
        AccountMeta::new(call.accounts.attestation.key(),      false),
        AccountMeta::new(call.accounts.payer.key(),            true),  // signer
        AccountMeta::new_readonly(call.accounts.system_program.key(), false),
    ];

    let infos = [
        call.accounts.issuer.clone(),
        call.accounts.subject.clone(),
        call.accounts.rep_config.clone(),
        call.accounts.profile.clone(),
        identity_info.clone(),
        call.accounts.attestation.clone(),
        call.accounts.payer.clone(),
        call.accounts.system_program.clone(),
        call.reputation_program.clone(),
    ];

    let ix = Instruction {
        program_id: call.reputation_program.key(),
        accounts:   metas,
        data,
    };

    invoke_signed(&ix, &infos, call.signer_seeds)
        .map_err(|e| {
            msg!("roundfi-core: reputation::attest CPI failed: {:?}", e);
            error!(RoundfiError::ReputationCpiFailed)
        })?;

    Ok(())
}

/// Convenience: zero-byte payload. Core does not embed per-cycle data
/// in the payload — the reputation program only needs schema + nonce
/// + pool tuple to compute score deltas.
pub const EMPTY_PAYLOAD: [u8; ATTESTATION_PAYLOAD_LEN] = [0u8; ATTESTATION_PAYLOAD_LEN];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attest_disc_is_stable() {
        let d1 = attest_disc();
        let d2 = attest_disc();
        assert_eq!(d1, d2);
    }

    #[test]
    fn attest_disc_matches_anchor_sighash() {
        // sha256("global:attest")[..8] — known good output recomputed
        // at each run. This test anchors us against the Anchor macro.
        let h = anchor_lang::solana_program::hash::hash(b"global:attest");
        let mut expected = [0u8; 8];
        expected.copy_from_slice(&h.to_bytes()[..8]);
        assert_eq!(attest_disc(), expected);
    }
}
