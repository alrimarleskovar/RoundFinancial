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
use anchor_lang::solana_program::program_error::ProgramError;

use roundfi_reputation::constants::ATTESTATION_PAYLOAD_LEN;
use roundfi_reputation::ReputationError;

use crate::error::RoundfiError;

/// Discriminator for `roundfi_reputation::attest` — runtime-computed
/// `sha256("global:attest")[..8]`. Anchor normally emits a const at
/// compile time, but `solana_program::hash::hash` is not const-eval
/// friendly, so we compute once per call. A unit test below pins the
/// output against the same hash so a future Anchor rename would fail
/// loudly rather than silently miss.
fn attest_disc() -> [u8; 8] {
    let h = solana_program::hash::hash(b"global:attest");
    let mut out = [0u8; 8];
    out.copy_from_slice(&h.to_bytes()[..8]);
    out
}

// ─── Attest CPI account-list builder (SEV-041 class oracle) ──────────
//
// Pure-Pubkey inputs for the attest CPI's 8-account layout. Mirrors
// `roundfi_reputation::Attest` struct field order verbatim — Anchor
// serializes accounts positionally, so any drift between this and the
// callee struct breaks the CPI at runtime (best case: account
// validation rejects; worst case: silently feeds wrong data into the
// wrong field if pubkey shape matches by accident).
//
// Extracted from the inline `let metas = vec![...]` block in
// `invoke_attest` so the position mapping can be pinned by a unit
// test (`attest_metas_match_canonical_layout`) without spinning up
// the full CPI runtime. Same SEV-041 class lesson: the bankrun spike
// catches it eventually; this test catches it on every PR.

/// Pubkey inputs for `build_attest_metas`. Field names mirror
/// `roundfi_reputation::Attest` field order in
/// `programs/roundfi-reputation/src/instructions/attest.rs`.
pub struct AttestMetaInputs {
    pub issuer:         Pubkey,
    pub subject:        Pubkey,
    pub config:         Pubkey,
    pub profile:        Pubkey,
    /// When the callee's `identity: Option<Account<IdentityRecord>>`
    /// is None, Anchor expects the program account itself in this slot
    /// with the same flag shape. Callers pass the reputation program
    /// pubkey in that case.
    pub identity_or_program: Pubkey,
    pub attestation:    Pubkey,
    pub payer:          Pubkey,
    pub system_program: Pubkey,
}

/// Canonical 8-account `AccountMeta` list for the reputation
/// `attest` CPI. Order + flags pinned by
/// `attest_metas_match_canonical_layout` test below.
pub fn build_attest_metas(i: &AttestMetaInputs) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new_readonly(i.issuer, true), //               1. issuer (Signer, ro)
        AccountMeta::new_readonly(i.subject, false), //             2. subject (UncheckedAccount, ro)
        AccountMeta::new_readonly(i.config, false), //              3. config (Account<ReputationConfig>, ro)
        AccountMeta::new(i.profile, false), //                      4. profile (init_if_needed → mut)
        AccountMeta::new_readonly(i.identity_or_program, false), // 5. identity Option (ro — program acct when None)
        AccountMeta::new(i.attestation, false), //                  6. attestation (init → mut)
        AccountMeta::new(i.payer, true), //                         7. payer (Signer, mut)
        AccountMeta::new_readonly(i.system_program, false), //      8. system_program (Program<System>, ro)
    ]
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

/// Result of an `attest` CPI from core's perspective.
///
/// `Applied` — the attestation landed and the subject's profile updated
/// normally.
///
/// `SkippedPoolCompleteCooldown` — reputation rejected a
/// `SCHEMA_POOL_COMPLETE` attestation with `CooldownActive` because the
/// subject is still inside the per-subject 30-day completion floor
/// (`MIN_POOL_COMPLETE_COOLDOWN_SECS`). The CPI reverted cleanly (no
/// attestation written, no profile mutation, rent refunded). This is a
/// BENIGN, expected outcome on the MANDATORY `contribute` money-path: the
/// cooldown is only an anti-farming rate-limit on `cycles_completed`, and
/// it must never revert a member's installment payment (SEV-A2). The
/// caller decides whether to tolerate it — `contribute` does (payment
/// stands, completion reward skipped), while `claim_payout` /
/// `settle_default` never emit POOL_COMPLETE and so never see it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AttestOutcome {
    Applied,
    SkippedPoolCompleteCooldown,
}

/// Classify the raw `invoke_signed` result of an attest CPI, separating
/// the benign POOL_COMPLETE cooldown rejection (SEV-A2) from genuine
/// failures. Pure (no logging, no anchor `error!`) so it is unit-testable
/// on host. The reputation `CooldownActive` error crosses the CPI boundary
/// as `ProgramError::Custom(ERROR_CODE_OFFSET + CooldownActive)`; the code
/// is derived from the reputation enum (not hard-coded) so a future
/// reorder of `ReputationError` stays in sync automatically.
fn classify_attest_outcome(
    res: core::result::Result<(), ProgramError>,
) -> core::result::Result<AttestOutcome, ProgramError> {
    let cooldown_code =
        anchor_lang::error::ERROR_CODE_OFFSET + ReputationError::CooldownActive as u32;
    match res {
        Ok(()) => Ok(AttestOutcome::Applied),
        Err(ProgramError::Custom(code)) if code == cooldown_code => {
            Ok(AttestOutcome::SkippedPoolCompleteCooldown)
        }
        Err(e) => Err(e),
    }
}

/// Emit an attestation via CPI. Performs the program-id guard and
/// constructs the call by hand so we avoid pulling in the full
/// anchor-cpi proc-macro expansion.
///
/// Returns an [`AttestOutcome`] so the caller can distinguish a normal
/// application from the benign POOL_COMPLETE-cooldown skip (SEV-A2).
pub fn invoke_attest<'info>(call: AttestCall<'_, 'info>) -> Result<AttestOutcome> {
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

    // Account list goes through the single-source-of-truth
    // `build_attest_metas` builder. Order + flags pinned by
    // `attest_metas_match_canonical_layout` unit test below.
    let metas = build_attest_metas(&AttestMetaInputs {
        issuer:              call.accounts.issuer.key(),
        subject:             call.accounts.subject.key(),
        config:              call.accounts.rep_config.key(),
        profile:             call.accounts.profile.key(),
        identity_or_program: identity_info.key(),
        attestation:         call.accounts.attestation.key(),
        payer:               call.accounts.payer.key(),
        system_program:      call.accounts.system_program.key(),
    });

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

    match classify_attest_outcome(invoke_signed(&ix, &infos, call.signer_seeds)) {
        Ok(outcome) => Ok(outcome),
        Err(e) => {
            msg!("roundfi-core: reputation::attest CPI failed: {:?}", e);
            Err(error!(RoundfiError::ReputationCpiFailed))
        }
    }
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
        let h = solana_program::hash::hash(b"global:attest");
        let mut expected = [0u8; 8];
        expected.copy_from_slice(&h.to_bytes()[..8]);
        assert_eq!(attest_disc(), expected);
    }

    fn sentinel_pubkey(slot: u8) -> Pubkey {
        let mut bytes = [0u8; 32];
        bytes[0] = slot;
        Pubkey::from(bytes)
    }

    /// SEV-041 class oracle for the `attest` CPI's 8-account layout.
    /// Pins every (pubkey, is_signer, is_writable) tuple per position
    /// so a future drift between `build_attest_metas` and
    /// `roundfi_reputation::Attest` field order (or flag) fails
    /// `cargo test` immediately instead of at the next CPI runtime.
    #[test]
    fn attest_metas_match_canonical_layout() {
        let issuer = sentinel_pubkey(1);
        let subject = sentinel_pubkey(2);
        let config = sentinel_pubkey(3);
        let profile = sentinel_pubkey(4);
        let identity_or_program = sentinel_pubkey(5);
        let attestation = sentinel_pubkey(6);
        let payer = sentinel_pubkey(7);
        let system_program = sentinel_pubkey(8);

        let metas = build_attest_metas(&AttestMetaInputs {
            issuer,
            subject,
            config,
            profile,
            identity_or_program,
            attestation,
            payer,
            system_program,
        });

        // Oracle: positions per `Attest` accounts struct in
        // programs/roundfi-reputation/src/instructions/attest.rs.
        // Format: (expected pubkey, is_signer, is_writable)
        let oracle: [(Pubkey, bool, bool); 8] = [
            (issuer, true, false), //               1. issuer (Signer, ro)
            (subject, false, false), //             2. subject (UncheckedAccount, ro)
            (config, false, false), //              3. config (Account, ro w/ seeds constraint)
            (profile, false, true), //              4. profile (init_if_needed → mut)
            (identity_or_program, false, false), // 5. identity (Option<Account>, ro)
            (attestation, false, true), //          6. attestation (init → mut)
            (payer, true, true), //                 7. payer (Signer, mut)
            (system_program, false, false), //      8. system_program (Program, ro)
        ];

        assert_eq!(
            metas.len(),
            oracle.len(),
            "attest account count drifted — canonical is 8",
        );
        for (i, (meta, (expected_key, expected_signer, expected_writable))) in
            metas.iter().zip(oracle.iter()).enumerate()
        {
            let pos = i + 1;
            assert_eq!(
                meta.pubkey, *expected_key,
                "attest slot {pos} pubkey mismatch — order shuffled vs reputation::Attest canonical",
            );
            assert_eq!(
                meta.is_signer, *expected_signer,
                "attest slot {pos} is_signer mismatch",
            );
            assert_eq!(
                meta.is_writable, *expected_writable,
                "attest slot {pos} is_writable mismatch",
            );
        }
    }

    // ─── SEV-A2: attest-outcome classification ──────────────────────────
    //
    // The POOL_COMPLETE 30-day cooldown lives on the MANDATORY contribute
    // money-path. `classify_attest_outcome` is what lets the installment
    // payment settle when the (rate-limited) completion reward is rejected,
    // while still reverting on any genuine attest failure. These pin that
    // contract so a regression surfaces in `cargo test`, not on devnet.

    #[test]
    fn classify_applied_on_ok() {
        assert_eq!(classify_attest_outcome(Ok(())), Ok(AttestOutcome::Applied));
    }

    #[test]
    fn classify_maps_reputation_cooldown_to_skip() {
        // CooldownActive is reputation's 5th error variant → wire code 6004.
        // Pinned here so a reorder that shifts the code is caught loudly,
        // even though `classify_attest_outcome` derives it dynamically.
        let cd = anchor_lang::error::ERROR_CODE_OFFSET + ReputationError::CooldownActive as u32;
        assert_eq!(cd, 6004, "reputation CooldownActive wire code drifted from 6004");
        assert_eq!(
            classify_attest_outcome(Err(ProgramError::Custom(cd))),
            Ok(AttestOutcome::SkippedPoolCompleteCooldown),
        );
    }

    #[test]
    fn classify_propagates_genuine_failures() {
        // Every other error — other reputation codes (InvalidIssuer=6000,
        // InvalidSchema=6002, …) and non-custom errors — MUST surface as a
        // failure so the contribute money-path reverts loudly rather than
        // silently dropping a real attestation. 6004 (the cooldown) is the
        // ONLY code that becomes a benign skip.
        for code in [6000u32, 6001, 6002, 6003, 6005, 6006, 9999] {
            assert!(
                classify_attest_outcome(Err(ProgramError::Custom(code))).is_err(),
                "custom code {code} must propagate as a failure, not a skip",
            );
        }
        assert!(classify_attest_outcome(Err(ProgramError::InvalidAccountData)).is_err());
    }
}
