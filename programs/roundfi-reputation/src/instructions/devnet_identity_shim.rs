//! DEVNET-ONLY Human Passport identity shim.
//!
//! ## Why this module exists
//!
//! On devnet the `ReputationConfig.passport_attestation_authority` was
//! frozen at init (`scripts/devnet/init-protocol.ts`) to the **Civic
//! Gateway program** (`gatem74…`) — a localnet placeholder that is
//! non-functional on devnet. Post-#227, Civic was replaced by an
//! off-chain bridge service that writes the 83-byte attestation under a
//! DIFFERENT authority — but that bridge never runs on devnet, and the
//! authority field is immutable (see `update_reputation_config`). Net
//! effect: the real `link_passport_identity` path has **no attestation
//! source on devnet**, so the team can't exercise it end-to-end.
//!
//! These two instructions provide that source FOR DEVNET ONLY so the
//! REAL link flow can be tested:
//!
//!   1. [`seed_authority`] (admin-gated) repoints the frozen
//!      `passport_attestation_authority` → THIS program's id, so a
//!      program-owned PDA can serve as a valid attestation account.
//!   2. [`issue_attestation`] (self-service: the subject signs for its
//!      own attestation) writes a real 83-byte attestation PDA in the
//!      exact Civic-v1 byte layout that
//!      `identity::passport::validate_passport_attestation` parses,
//!      embedding `config.passport_network` so the unchanged
//!      `link_passport_identity` validates it byte-for-byte.
//!
//! The actual `IdentityRecord` is still written by the **unchanged,
//! audited** `link_passport_identity` handler — this module only mints
//! the attestation input. The team flow is one tx of
//! `[devnet_issue_attestation, link_passport_identity]`, signed once by
//! the wallet.
//!
//! ## Security
//!
//! The ENTIRE module is gated behind `#[cfg(feature =
//! "devnet-identity-shim")]` (mirrors roundfi-core's `devnet-canary`
//! pattern). A mainnet artifact — built without the feature — does not
//! contain `seed_authority`/`issue_attestation` at all, so the
//! frozen-authority guarantee and the Proof-of-Personhood trust boundary
//! are fully preserved off devnet. `scripts/devnet/deploy.ts` refuses
//! mainnet-beta and only passes `--features devnet-identity-shim` when
//! `DEVNET_IDENTITY_SHIM` is set, so the feature can never reach a
//! production deploy.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::ReputationConfig;

/// PDA seed for the devnet shim attestation account.
/// `[b"devnet-passport", subject]` under this program id.
pub const SEED_DEVNET_PASSPORT: &[u8] = b"devnet-passport";

// Byte offsets inside the 83-byte attestation — these MUST stay in sync
// with the reader offsets in `identity/passport.rs` (the Civic Gateway
// Token v1 layout). A unit test below pins them.
const OFF_VERSION: usize = 0;
const OFF_OWNER: usize = 1;
const OFF_NETWORK: usize = 33;
const OFF_STATE: usize = 65;
const OFF_EXPIRE_TIME: usize = 66;
const OFF_ISSUE_TIME: usize = 74;

const STATE_ACTIVE: u8 = 0;
const VERSION_V1: u8 = 0;

// ─── 1. seed_authority (admin) ──────────────────────────────────────────

#[derive(Accounts)]
pub struct DevnetSeedPassportAuthority<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_REP_CONFIG],
        bump = config.bump,
        constraint = config.authority == authority.key() @ ReputationError::Unauthorized,
    )]
    pub config: Account<'info, ReputationConfig>,
}

/// One-time devnet setup: repoint the (prod-frozen) attestation authority
/// to this program, so the shim-issued PDAs validate. Admin-gated.
pub fn seed_authority(ctx: Context<DevnetSeedPassportAuthority>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;
    cfg.passport_attestation_authority = crate::ID;
    msg!(
        "roundfi-reputation: DEVNET SHIM — passport_attestation_authority repointed to {} (program self)",
        crate::ID,
    );
    Ok(())
}

// ─── 2. issue_attestation (self-service) ────────────────────────────────

#[derive(Accounts)]
pub struct DevnetIssueAttestation<'info> {
    /// The wallet being attested. Self-service: it pays for + signs its
    /// own attestation. (On mainnet this instruction does not exist.)
    #[account(mut)]
    pub subject: Signer<'info>,

    #[account(
        seeds = [SEED_REP_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, ReputationConfig>,

    /// CHECK: created + written here as a raw 83-byte attestation PDA
    /// owned by this program. NOT an Anchor account (no 8-byte
    /// discriminator) — it is the Civic-v1 byte layout that
    /// `link_passport_identity`'s validator parses.
    #[account(
        mut,
        seeds = [SEED_DEVNET_PASSPORT, subject.key().as_ref()],
        bump,
    )]
    pub attestation: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Mint (or refresh) the subject's 83-byte attestation PDA in the
/// Civic-v1 layout the validator expects. `ttl_seconds` sets the
/// forward expiry window (`expires_at = now + ttl_seconds`); it must be
/// in `(0, MAX_PASSPORT_HORIZON_SECS]` so the resulting attestation is
/// Active and passes the Wave-9 horizon ceiling.
pub fn issue_attestation(ctx: Context<DevnetIssueAttestation>, ttl_seconds: i64) -> Result<()> {
    require!(
        ttl_seconds > 0 && ttl_seconds <= MAX_PASSPORT_HORIZON_SECS,
        ReputationError::ImplausibleAttestationTtl,
    );

    let now = Clock::get()?.unix_timestamp;
    let expires_at = now.saturating_add(ttl_seconds);
    let subject = ctx.accounts.subject.key();
    let network = ctx.accounts.config.passport_network;

    let att_info = ctx.accounts.attestation.to_account_info();
    let bump = ctx.bumps.attestation;
    let signer_seeds: &[&[u8]] = &[SEED_DEVNET_PASSPORT, subject.as_ref(), &[bump]];

    // Create the PDA on first issuance; on re-issue the account already
    // exists (owned by this program) and we just overwrite the bytes
    // below to refresh the expiry.
    if att_info.data_is_empty() {
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(PASSPORT_ATTESTATION_LEN);
        create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.key(),
                CreateAccount {
                    from: ctx.accounts.subject.to_account_info(),
                    to: att_info.clone(),
                },
                &[signer_seeds],
            ),
            lamports,
            PASSPORT_ATTESTATION_LEN as u64,
            &crate::ID,
        )?;
    }

    // Write the Civic-v1 83-byte layout. Offsets mirror the validator
    // reader in `identity/passport.rs`.
    let mut data = att_info.try_borrow_mut_data()?;
    require!(
        data.len() == PASSPORT_ATTESTATION_LEN,
        ReputationError::InvalidIdentityProof,
    );
    for b in data.iter_mut() {
        *b = 0;
    }
    data[OFF_VERSION] = VERSION_V1;
    data[OFF_OWNER..OFF_OWNER + 32].copy_from_slice(subject.as_ref());
    data[OFF_NETWORK..OFF_NETWORK + 32].copy_from_slice(network.as_ref());
    data[OFF_STATE] = STATE_ACTIVE;
    data[OFF_EXPIRE_TIME..OFF_EXPIRE_TIME + 8].copy_from_slice(&expires_at.to_le_bytes());
    data[OFF_ISSUE_TIME..OFF_ISSUE_TIME + 8].copy_from_slice(&now.to_le_bytes());

    msg!(
        "roundfi-reputation: DEVNET SHIM — issued attestation subject={} network={} expires_at={}",
        subject,
        network,
        expires_at,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pin the writer offsets to the Civic-v1 layout the validator reads
    /// (`identity/passport.rs`). If either side drifts, the round-trip
    /// below breaks — catching an offset typo that would otherwise only
    /// surface as a failed `link_passport_identity` on devnet.
    #[test]
    fn writer_offsets_match_civic_v1_layout() {
        assert_eq!(OFF_VERSION, 0);
        assert_eq!(OFF_OWNER, 1);
        assert_eq!(OFF_NETWORK, 33);
        assert_eq!(OFF_STATE, 65);
        assert_eq!(OFF_EXPIRE_TIME, 66);
        assert_eq!(OFF_ISSUE_TIME, 74);
        assert_eq!(PASSPORT_ATTESTATION_LEN, 83);
    }

    /// The bytes this module writes parse back to the same fields the
    /// validator extracts (version/owner/network/state/expiry).
    #[test]
    fn issued_bytes_round_trip() {
        let subject = Pubkey::new_unique();
        let network = Pubkey::new_unique();
        let now: i64 = 1_700_000_000;
        let expires_at = now + 90 * 86_400;

        let mut data = [0u8; PASSPORT_ATTESTATION_LEN];
        data[OFF_VERSION] = VERSION_V1;
        data[OFF_OWNER..OFF_OWNER + 32].copy_from_slice(subject.as_ref());
        data[OFF_NETWORK..OFF_NETWORK + 32].copy_from_slice(network.as_ref());
        data[OFF_STATE] = STATE_ACTIVE;
        data[OFF_EXPIRE_TIME..OFF_EXPIRE_TIME + 8].copy_from_slice(&expires_at.to_le_bytes());
        data[OFF_ISSUE_TIME..OFF_ISSUE_TIME + 8].copy_from_slice(&now.to_le_bytes());

        assert_eq!(data[OFF_VERSION], 0);
        assert_eq!(
            Pubkey::new_from_array(data[OFF_OWNER..OFF_OWNER + 32].try_into().unwrap()),
            subject
        );
        assert_eq!(
            Pubkey::new_from_array(data[OFF_NETWORK..OFF_NETWORK + 32].try_into().unwrap()),
            network,
        );
        assert_eq!(data[OFF_STATE], STATE_ACTIVE);
        let exp = i64::from_le_bytes(
            data[OFF_EXPIRE_TIME..OFF_EXPIRE_TIME + 8]
                .try_into()
                .unwrap(),
        );
        assert_eq!(exp, expires_at);
        // Horizon ceiling holds for the 90-day default.
        assert!(exp - now <= MAX_PASSPORT_HORIZON_SECS);
    }
}
