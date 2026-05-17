pub mod attest;
pub mod cancel_new_reputation_authority;
pub mod commit_new_reputation_authority;
pub mod get_profile;
pub mod init_profile;
pub mod initialize_reputation;
pub mod link_passport_identity;
pub mod promote_level;
pub mod propose_new_reputation_authority;
pub mod refresh_identity;
pub mod revoke;
pub mod unlink_identity;
pub mod update_reputation_config;

// Each handler module re-exports its `handler` fn + Accounts struct +
// Args struct. The `handler` glob collision is benign — lib.rs always
// calls handlers via fully-qualified paths (`instructions::attest::
// handler`, etc.) and SDK consumers access handlers via Anchor's
// IDL-driven dispatch, not by this re-export. The Accounts / Args
// structs are what these globs are actually for.
#[allow(ambiguous_glob_reexports)]
mod reexports {
    pub use super::attest::*;
    pub use super::cancel_new_reputation_authority::*;
    pub use super::commit_new_reputation_authority::*;
    pub use super::get_profile::*;
    pub use super::init_profile::*;
    pub use super::initialize_reputation::*;
    pub use super::link_passport_identity::*;
    pub use super::promote_level::*;
    pub use super::propose_new_reputation_authority::*;
    pub use super::refresh_identity::*;
    pub use super::revoke::*;
    pub use super::unlink_identity::*;
    pub use super::update_reputation_config::*;
}
pub use reexports::*;
