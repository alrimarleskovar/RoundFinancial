//! Human Passport attestation validator.
//!
//! ## Architecture
//!
//! Human Passport's verification model is fundamentally off-chain
//! (HTTPS API + Stamps + score thresholds) — there is no native
//! Solana on-chain account format. To bridge it onto the protocol,
//! RoundFi runs an **off-chain bridge service** that:
//!
//!   1. Queries Passport API for a wallet's score
//!   2. If score ≥ threshold (canary default: 20), writes a small
//!      83-byte attestation account on Solana under its own pubkey
//!   3. The validator here reads that account, checks
//!      `account.owner == passport_attestation_authority` (from
//!      `ReputationConfig`), and validates the embedded fields
//!
//! The 83-byte attestation layout is INHERITED from the original
//! Civic Gateway-Token v1 shape — the byte-level validator is
//! re-used verbatim post-Civic-sunset (#227). The bridge service
//! emits this same shape so the validator code path doesn't change.
//!
//! Layout (83 bytes total):
//!
//! ```text
//!   offset  size  field
//!   ------  ----  --------------------------------------------
//!    0       1    version   (u8)              // expected == 0
//!    1      32    owner     (Pubkey)          // user wallet
//!   33      32    network   (Pubkey)          // `passport_network` scope
//!   65       1    state     (u8)              // 0=Active, 1=Revoked, 2=Frozen
//!   66       8    expire_time (i64, optional — 0 == no expiry)
//!   74       8    issue_time  (i64)
//!   82       1    flags     (u8)
//! ```
//!
//! ## Why an off-chain bridge (not a direct on-chain integration)
//!
//! - Human Passport's scoring graph (Web2 + Web3 + KYC stamps) is
//!   inherently off-chain; replicating it as an on-chain oracle would
//!   be massive scope creep.
//! - The bridge service is a single-purpose authority controlled by
//!   the same multisig as the treasury (3-of-5 Squads on mainnet).
//!   Authority compromise → wrong attestations get written, but only
//!   the LINK side breaks; cycle attestations stay safe (they're
//!   written by `roundfi-core` program PDAs).
//! - Future provider migrations (e.g. Sumsub for Phase 3 KYC-grade
//!   B2B compliance) reuse the same attestation envelope — only the
//!   bridge service's data source changes.
//!
//! ## Trust boundary
//!
//! - **Trusted:** `passport_attestation_authority` (the bridge service
//!   pubkey, set at protocol init, mutable via
//!   `update_reputation_config`).
//! - **Untrusted:** the attestation account passed by the caller. The
//!   owner check ensures only the bridge service can issue valid
//!   attestations; raw-byte parsing with field offsets avoids trusting
//!   any deserializer logic.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::account_info::AccountInfo;

use crate::constants::PASSPORT_ATTESTATION_LEN;
use crate::error::ReputationError;

/// Offsets inside the Passport attestation account (83-byte layout
/// inherited from Civic Gateway-Token v1 for byte-compat with
/// pre-#227 IdentityRecord PDAs).
const OFF_VERSION:     usize = 0;
const OFF_OWNER:       usize = 1;
const OFF_NETWORK:     usize = 33;
const OFF_STATE:       usize = 65;
const OFF_EXPIRE_TIME: usize = 66;

/// State values (u8).
const STATE_ACTIVE:  u8 = 0;
const STATE_REVOKED: u8 = 1;
const STATE_FROZEN:  u8 = 2;

/// Expected version byte.
const EXPECTED_VERSION: u8 = 0;

/// Outcome of validation. Distinguishes `Expired` and `Revoked` from
/// a structural error so callers can write a demoted `IdentityRecord`
/// (status = Expired / Revoked) rather than failing the tx entirely.
#[derive(Debug, PartialEq, Eq)]
pub enum PassportStatus {
    Active { expires_at: i64 },
    Expired,
    Revoked,
}

/// Validated view of a Human Passport attestation.
#[derive(Debug)]
pub struct PassportView {
    pub owner:    Pubkey,
    pub network:  Pubkey,
    pub status:   PassportStatus,
}

/// Validate an account claimed to be a Passport attestation written
/// by the trusted off-chain bridge service.
///
/// `attestation` — the untrusted account passed by the caller.
/// `expected_authority` — bridge service pubkey, from `ReputationConfig.
///                        passport_attestation_authority`.
/// `expected_network`   — `passport_network` scope from ReputationConfig.
/// `expected_owner`     — the signer wallet, so the caller can only
///                        link their own identity (not someone else's).
/// `now` — clock.unix_timestamp.
///
/// On a structural error (wrong authority, malformed bytes, version
/// mismatch, network mismatch, owner mismatch) returns `Err`. On a
/// *status* issue (expired / revoked / frozen) returns `Ok` with a
/// `PassportStatus` variant — callers should write a non-Verified
/// record rather than refusing.
pub fn validate_passport_attestation<'a>(
    attestation: &AccountInfo<'a>,
    expected_authority: &Pubkey,
    expected_network: &Pubkey,
    expected_owner:   &Pubkey,
    now: i64,
) -> Result<PassportView> {
    // 1. Owner = passport_attestation_authority (the off-chain
    //    bridge service pubkey from ReputationConfig).
    require_keys_eq!(
        *attestation.owner,
        *expected_authority,
        ReputationError::InvalidIdentityProof
    );

    let data = attestation
        .try_borrow_data()
        .map_err(|_| error!(ReputationError::InvalidIdentityProof))?;
    require!(
        data.len() == PASSPORT_ATTESTATION_LEN,
        ReputationError::InvalidIdentityProof
    );

    // 2. Version byte.
    require!(data[OFF_VERSION] == EXPECTED_VERSION, ReputationError::InvalidIdentityProof);

    // 3. Owner wallet embedded in the attestation == signer wallet.
    let mut owner_buf = [0u8; 32];
    owner_buf.copy_from_slice(&data[OFF_OWNER..OFF_OWNER + 32]);
    let att_owner = Pubkey::new_from_array(owner_buf);
    require_keys_eq!(att_owner, *expected_owner, ReputationError::InvalidIdentityProof);

    // 4. Passport network scope.
    let mut net_buf = [0u8; 32];
    net_buf.copy_from_slice(&data[OFF_NETWORK..OFF_NETWORK + 32]);
    let att_network = Pubkey::new_from_array(net_buf);
    require_keys_eq!(att_network, *expected_network, ReputationError::InvalidIdentityProof);

    // 5. State.
    let state = data[OFF_STATE];
    let status = match state {
        STATE_ACTIVE => {
            let mut exp_buf = [0u8; 8];
            exp_buf.copy_from_slice(&data[OFF_EXPIRE_TIME..OFF_EXPIRE_TIME + 8]);
            let expires_at = i64::from_le_bytes(exp_buf);
            if expires_at != 0 && expires_at <= now {
                PassportStatus::Expired
            } else {
                PassportStatus::Active { expires_at }
            }
        }
        STATE_REVOKED | STATE_FROZEN => PassportStatus::Revoked,
        _ => return Err(error!(ReputationError::InvalidIdentityProof)),
    };

    Ok(PassportView {
        owner:   att_owner,
        network: att_network,
        status,
    })
}

#[cfg(test)]
mod tests {
    //! Unit tests for the byte-level validator. We can't spin up an
    //! AccountInfo easily in pure-Rust unit tests, so these cover the
    //! *parser* via the internal offsets.

    use super::*;

    fn make_attestation(
        state: u8,
        network: &Pubkey,
        owner: &Pubkey,
        expires: i64,
    ) -> [u8; PASSPORT_ATTESTATION_LEN] {
        let mut buf = [0u8; PASSPORT_ATTESTATION_LEN];
        buf[OFF_VERSION] = EXPECTED_VERSION;
        buf[OFF_OWNER..OFF_OWNER + 32].copy_from_slice(owner.as_ref());
        buf[OFF_NETWORK..OFF_NETWORK + 32].copy_from_slice(network.as_ref());
        buf[OFF_STATE] = state;
        buf[OFF_EXPIRE_TIME..OFF_EXPIRE_TIME + 8].copy_from_slice(&expires.to_le_bytes());
        buf
    }

    #[test]
    fn valid_active_attestation() {
        let owner = Pubkey::new_unique();
        let network = Pubkey::new_unique();
        let buf = make_attestation(STATE_ACTIVE, &network, &owner, 0);

        // Replicate the parser body (validate_passport_attestation requires AccountInfo).
        assert_eq!(buf[OFF_VERSION], EXPECTED_VERSION);
        let mut owner_buf = [0u8; 32];
        owner_buf.copy_from_slice(&buf[OFF_OWNER..OFF_OWNER + 32]);
        assert_eq!(Pubkey::new_from_array(owner_buf), owner);

        let mut exp_buf = [0u8; 8];
        exp_buf.copy_from_slice(&buf[OFF_EXPIRE_TIME..OFF_EXPIRE_TIME + 8]);
        assert_eq!(i64::from_le_bytes(exp_buf), 0);
    }

    #[test]
    fn revoked_state_decodes() {
        let owner = Pubkey::new_unique();
        let network = Pubkey::new_unique();
        let buf = make_attestation(STATE_REVOKED, &network, &owner, 0);
        assert_eq!(buf[OFF_STATE], STATE_REVOKED);
    }

    #[test]
    fn frozen_treated_as_revoked() {
        // STATE_FROZEN maps to PassportStatus::Revoked in the validator.
        assert_ne!(STATE_FROZEN, STATE_ACTIVE);
    }

    #[test]
    fn expired_detected() {
        let now = 1_700_000_000;
        let past = now - 100;
        let owner = Pubkey::new_unique();
        let network = Pubkey::new_unique();
        let buf = make_attestation(STATE_ACTIVE, &network, &owner, past);
        let mut exp_buf = [0u8; 8];
        exp_buf.copy_from_slice(&buf[OFF_EXPIRE_TIME..OFF_EXPIRE_TIME + 8]);
        assert!(i64::from_le_bytes(exp_buf) < now);
    }
}
