pub mod cancel_new_authority;
pub mod cancel_new_fee_bps_yield;
pub mod cancel_new_treasury;
pub mod cancel_pending_listing;
pub mod claim_payout;
pub mod close_pool;
pub mod commit_new_authority;
pub mod commit_new_fee_bps_yield;
pub mod commit_new_treasury;
pub mod contribute;
pub mod create_pool;
pub mod deposit_idle_to_yield;
pub mod escape_valve_buy;
pub mod escape_valve_list;
pub mod escape_valve_list_commit;
pub mod escape_valve_list_reveal;
pub mod harvest_yield;
pub mod init_pool_vaults;
pub mod initialize_protocol;
pub mod join_pool;
pub mod lock_approved_yield_adapter;
pub mod lock_treasury;
pub mod pause;
pub mod propose_new_authority;
pub mod propose_new_fee_bps_yield;
pub mod propose_new_treasury;
pub mod release_escrow;
pub mod settle_default;
pub mod update_protocol_config;

// Each handler module re-exports its `handler` fn + Accounts struct +
// Args struct. The `handler` glob collision is benign — lib.rs always
// calls handlers via fully-qualified paths (`instructions::claim_payout::
// handler`, etc.) and SDK consumers access handlers via Anchor's
// IDL-driven dispatch, not by this re-export. The Accounts / Args
// structs are what these globs are actually for.
#[allow(ambiguous_glob_reexports)]
mod reexports {
    pub use super::cancel_new_authority::*;
    pub use super::cancel_new_fee_bps_yield::*;
    pub use super::cancel_new_treasury::*;
    pub use super::cancel_pending_listing::*;
    pub use super::claim_payout::*;
    pub use super::close_pool::*;
    pub use super::commit_new_authority::*;
    pub use super::commit_new_fee_bps_yield::*;
    pub use super::commit_new_treasury::*;
    pub use super::contribute::*;
    pub use super::create_pool::*;
    pub use super::deposit_idle_to_yield::*;
    pub use super::escape_valve_buy::*;
    pub use super::escape_valve_list::*;
    pub use super::escape_valve_list_commit::*;
    pub use super::escape_valve_list_reveal::*;
    pub use super::harvest_yield::*;
    pub use super::init_pool_vaults::*;
    pub use super::initialize_protocol::*;
    pub use super::join_pool::*;
    pub use super::lock_approved_yield_adapter::*;
    pub use super::lock_treasury::*;
    pub use super::pause::*;
    pub use super::propose_new_authority::*;
    pub use super::propose_new_fee_bps_yield::*;
    pub use super::propose_new_treasury::*;
    pub use super::release_escrow::*;
    pub use super::settle_default::*;
    pub use super::update_protocol_config::*;
}
pub use reexports::*;
