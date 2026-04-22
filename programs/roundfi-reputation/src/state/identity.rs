//! `IdentityRecord` — optional, cached identity snapshot for a wallet.
//! PDA seeds: `[b"identity", wallet]`.
//!
//! Absence ≡ `IdentityStatus::Unverified`. The core program MUST NOT
//! read this account; it is a scoring hint for the B2B score API and
//! an input to the anti-sybil weight adjustment in `attest`.

use anchor_lang::prelude::*;

#[account]
#[derive(Debug)]
pub struct IdentityRecord {
    pub wallet: Pubkey,

    /// See `IdentityProvider` enum.
    pub provider: u8,

    /// See `IdentityStatus` enum.
    pub status: u8,

    pub verified_at: i64,

    /// 0 ≡ never expires; else unix seconds of expiry.
    pub expires_at: i64,

    /// Civic gateway-token account (when provider == Civic). Default
    /// pubkey for other providers.
    pub gateway_token: Pubkey,

    pub bump: u8,

    pub _padding: [u8; 13],
}

impl IdentityRecord {
    pub const LEN: usize =
        8 + 32 + 1 + 1 + 8 + 8 + 32 + 1 + 13;

    pub fn is_verified(&self, now: i64) -> bool {
        if self.status != IdentityStatus::Verified as u8 {
            return false;
        }
        self.expires_at == 0 || self.expires_at > now
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdentityProvider {
    None  = 0,
    Sas   = 1,
    Civic = 2,
    // 3..=255 reserved for future providers without an account migration.
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdentityStatus {
    Unverified = 0,
    Verified   = 1,
    Expired    = 2,
    Revoked    = 3,
}
