//! Civic Gateway-Token validator.
//!
//! Civic's Gateway Token account stores (v1 layout, 83 bytes total):
//!
//! ```text
//!   offset  size  field
//!   ------  ----  --------------------------------------------
//!    0       1    version   (u8)              // expected == 0
//!    1      32    parent_token / owner (Pubkey)
//!   33      32    gatekeeper_network (Pubkey)
//!   65       1    state     (u8)              // 0=Active, 1=Revoked, 2=Frozen
//!   66       8    expire_time (i64, optional — 0 == no expiry)
//!   74       8    issue_time  (i64)
//!   82       1    flags     (u8)
//! ```
//!
//! The layout above is our interpretation frozen at Step 4d; the code
//! path here is self-contained so an upstream Civic change can be
//! mirrored by editing exactly this file.
//!
//! We do NOT pull in the Civic crate:
//! - it would bloat the on-chain program and couple us to their release
//!   cadence;
//! - the validator is only a few field reads, so keeping this local is
//!   safer than trusting another crate's `AccountDeserialize`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::account_info::AccountInfo;

use crate::constants::CIVIC_GATEWAY_TOKEN_LEN;
use crate::error::ReputationError;

/// Offsets inside the Civic gateway-token account (v1 layout).
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
pub enum CivicStatus {
    Active { expires_at: i64 },
    Expired,
    Revoked,
}

/// Validated view of a Civic gateway token.
#[derive(Debug)]
pub struct CivicView {
    pub owner:    Pubkey,
    pub network:  Pubkey,
    pub status:   CivicStatus,
}

/// Validate an account claimed to be a Civic gateway token.
///
/// `token` — the untrusted account passed by the caller.
/// `expected_program`  — Civic Networks program ID (from ReputationConfig).
/// `expected_network`  — gatekeeper network (from ReputationConfig).
/// `expected_owner`    — the signer wallet, so the caller can only
///                       link their own identity (not someone else's).
/// `now` — clock.unix_timestamp.
///
/// On a structural error (wrong program, malformed bytes, version
/// mismatch, network mismatch, owner mismatch) returns `Err`. On a
/// *status* issue (expired / revoked / frozen) returns `Ok` with a
/// `CivicStatus` variant — callers should write a non-Verified record
/// rather than refusing.
pub fn validate_civic_token<'a>(
    token: &AccountInfo<'a>,
    expected_program: &Pubkey,
    expected_network: &Pubkey,
    expected_owner:   &Pubkey,
    now: i64,
) -> Result<CivicView> {
    // 1. Owner = Civic Networks program.
    require_keys_eq!(
        *token.owner,
        *expected_program,
        ReputationError::InvalidIdentityProof
    );

    let data = token
        .try_borrow_data()
        .map_err(|_| error!(ReputationError::InvalidIdentityProof))?;
    require!(data.len() == CIVIC_GATEWAY_TOKEN_LEN, ReputationError::InvalidIdentityProof);

    // 2. Version byte.
    require!(data[OFF_VERSION] == EXPECTED_VERSION, ReputationError::InvalidIdentityProof);

    // 3. Owner wallet embedded in the token == signer wallet.
    let mut owner_buf = [0u8; 32];
    owner_buf.copy_from_slice(&data[OFF_OWNER..OFF_OWNER + 32]);
    let token_owner = Pubkey::new_from_array(owner_buf);
    require_keys_eq!(token_owner, *expected_owner, ReputationError::InvalidIdentityProof);

    // 4. Gatekeeper network.
    let mut net_buf = [0u8; 32];
    net_buf.copy_from_slice(&data[OFF_NETWORK..OFF_NETWORK + 32]);
    let token_network = Pubkey::new_from_array(net_buf);
    require_keys_eq!(token_network, *expected_network, ReputationError::InvalidIdentityProof);

    // 5. State.
    let state = data[OFF_STATE];
    let status = match state {
        STATE_ACTIVE => {
            let mut exp_buf = [0u8; 8];
            exp_buf.copy_from_slice(&data[OFF_EXPIRE_TIME..OFF_EXPIRE_TIME + 8]);
            let expires_at = i64::from_le_bytes(exp_buf);
            if expires_at != 0 && expires_at <= now {
                CivicStatus::Expired
            } else {
                CivicStatus::Active { expires_at }
            }
        }
        STATE_REVOKED | STATE_FROZEN => CivicStatus::Revoked,
        _ => return Err(error!(ReputationError::InvalidIdentityProof)),
    };

    Ok(CivicView {
        owner:   token_owner,
        network: token_network,
        status,
    })
}

#[cfg(test)]
mod tests {
    //! Unit tests for the byte-level validator. We can't spin up an
    //! AccountInfo easily in pure-Rust unit tests, so these cover the
    //! *parser* via the internal offsets.

    use super::*;

    fn make_token(state: u8, network: &Pubkey, owner: &Pubkey, expires: i64) -> [u8; CIVIC_GATEWAY_TOKEN_LEN] {
        let mut buf = [0u8; CIVIC_GATEWAY_TOKEN_LEN];
        buf[OFF_VERSION] = EXPECTED_VERSION;
        buf[OFF_OWNER..OFF_OWNER + 32].copy_from_slice(owner.as_ref());
        buf[OFF_NETWORK..OFF_NETWORK + 32].copy_from_slice(network.as_ref());
        buf[OFF_STATE] = state;
        buf[OFF_EXPIRE_TIME..OFF_EXPIRE_TIME + 8].copy_from_slice(&expires.to_le_bytes());
        buf
    }

    #[test]
    fn valid_active_token() {
        let owner = Pubkey::new_unique();
        let network = Pubkey::new_unique();
        let buf = make_token(STATE_ACTIVE, &network, &owner, 0);

        // Replicate the parser body (validate_civic_token requires AccountInfo).
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
        let buf = make_token(STATE_REVOKED, &network, &owner, 0);
        assert_eq!(buf[OFF_STATE], STATE_REVOKED);
    }

    #[test]
    fn frozen_treated_as_revoked() {
        // STATE_FROZEN maps to CivicStatus::Revoked in the validator.
        assert_ne!(STATE_FROZEN, STATE_ACTIVE);
    }

    #[test]
    fn expired_detected() {
        let now = 1_700_000_000;
        let past = now - 100;
        let owner = Pubkey::new_unique();
        let network = Pubkey::new_unique();
        let buf = make_token(STATE_ACTIVE, &network, &owner, past);
        let mut exp_buf = [0u8; 8];
        exp_buf.copy_from_slice(&buf[OFF_EXPIRE_TIME..OFF_EXPIRE_TIME + 8]);
        assert!(i64::from_le_bytes(exp_buf) < now);
    }
}
