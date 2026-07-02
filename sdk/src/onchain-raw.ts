/**
 * Raw on-chain account decoders — IDL-free path for clients.
 *
 * The Anchor SDK's `program.account.<name>.fetch()` requires a
 * generated IDL. This SDK is IDL-free by design (ADR 0002), so
 * front-end + scripts that need to read on-chain state import this
 * module instead — it does the same Borsh-style decode by hand using
 * the field offsets from `programs/roundfi-core/src/state/pool.rs`
 * and `state/member.rs`.
 *
 * The shapes returned here mirror `reads.ts::PoolView` and `MemberView`
 * field-for-field, so any consumer can later swap from this raw path
 * back to the IDL-based fetch with no call-site changes.
 *
 * Layout snapshots (after the 8-byte Anchor discriminator). Source of
 * truth: programs/roundfi-core/src/state/pool.rs and member.rs.
 */

import { Connection, PublicKey } from "@solana/web3.js";

import {
  ATTESTATION_PAYLOAD_LEN,
  type BehavioralPayload,
  decodeBehavioralPayload,
} from "./behavioralPayload.js";
import { identityPda, poolPda as derivePoolPda, reputationProfilePda } from "./pda.js";

// ─── Pool offsets (declaration-order Borsh, no padding) ────────────────
//
//   off  8: authority           Pubkey  (32)
//   off 40: seed_id             u64     ( 8)
//   off 48: usdc_mint           Pubkey  (32)
//   off 80: yield_adapter       Pubkey  (32)
//   off 112: members_target     u8      ( 1)
//   off 113: installment_amount u64     ( 8)
//   off 121: credit_amount      u64     ( 8)
//   off 129: cycles_total       u8      ( 1)
//   off 130: cycle_duration     i64     ( 8)
//   off 138: seed_draw_bps      u16     ( 2)
//   off 140: solidarity_bps     u16     ( 2)
//   off 142: escrow_release_bps u16     ( 2)
//   off 144: members_joined     u8      ( 1)
//   off 145: status             u8      ( 1)
//   off 146: started_at         i64     ( 8)
//   off 154: current_cycle      u8      ( 1)
//   off 155: next_cycle_at      i64     ( 8)
//   off 163: total_contributed  u64     ( 8)
//   off 171: total_paid_out     u64     ( 8)
//   off 179: solidarity_balance u64     ( 8)
//   off 187: escrow_balance     u64     ( 8)
//   off 195: yield_accrued      u64     ( 8)
//   off 203: guarantee_fund_balance     u64 (8)
//   off 211: total_protocol_fee_accrued u64 (8)
//   off 219: yield_principal_deposited  u64 (8)
//   off 227: defaulted_members  u8      ( 1)
//   off 228: lp_distribution_balance    u64 (8)
//   off 236: slots_bitmap       [u8; 8] ( 8)

// Re-uses the PoolStatusName from reads.ts (same enum, exported from
// there as the shared type). Kept here as a local alias for clarity.
type LocalPoolStatusName = "forming" | "active" | "completed" | "liquidated" | "closed";

export interface RawPoolView {
  address: PublicKey;
  authority: PublicKey;
  seedId: bigint;
  usdcMint: PublicKey;
  yieldAdapter: PublicKey;
  membersTarget: number;
  installmentAmount: bigint;
  creditAmount: bigint;
  cyclesTotal: number;
  cycleDurationSec: bigint;
  seedDrawBps: number;
  solidarityBps: number;
  escrowReleaseBps: number;
  membersJoined: number;
  status: LocalPoolStatusName;
  startedAt: bigint;
  currentCycle: number;
  nextCycleAt: bigint;
  totalContributed: bigint;
  totalPaidOut: bigint;
  solidarityBalance: bigint;
  escrowBalance: bigint;
  yieldAccrued: bigint;
  guaranteeFundBalance: bigint;
  totalProtocolFeeAccrued: bigint;
  yieldPrincipalDeposited: bigint;
  defaultedMembers: number;
  lpDistributionBalance: bigint;
  occupiedSlots: number[];
}

const STATUS_NAMES: LocalPoolStatusName[] = [
  "forming",
  "active",
  "completed",
  "liquidated",
  "closed", // Adevar Labs SEV-005 — terminal post-close_pool state
];

/** Decode a Pool account's raw bytes into the shared view shape. */
export function decodePoolRaw(address: PublicKey, data: Buffer): RawPoolView {
  // Slot bitmap → array of occupied slot indices (0..63).
  const bitmap = data.subarray(236, 244);
  const occupiedSlots: number[] = [];
  for (let byte = 0; byte < bitmap.length; byte++) {
    for (let bit = 0; bit < 8; bit++) {
      if ((bitmap[byte]! & (1 << bit)) !== 0) occupiedSlots.push(byte * 8 + bit);
    }
  }
  const statusByte = data.readUInt8(145);
  return {
    address,
    authority: new PublicKey(data.subarray(8, 40)),
    seedId: data.readBigUInt64LE(40),
    usdcMint: new PublicKey(data.subarray(48, 80)),
    yieldAdapter: new PublicKey(data.subarray(80, 112)),
    membersTarget: data.readUInt8(112),
    installmentAmount: data.readBigUInt64LE(113),
    creditAmount: data.readBigUInt64LE(121),
    cyclesTotal: data.readUInt8(129),
    cycleDurationSec: data.readBigInt64LE(130),
    seedDrawBps: data.readUInt16LE(138),
    solidarityBps: data.readUInt16LE(140),
    escrowReleaseBps: data.readUInt16LE(142),
    membersJoined: data.readUInt8(144),
    status: STATUS_NAMES[statusByte] ?? "forming",
    startedAt: data.readBigInt64LE(146),
    currentCycle: data.readUInt8(154),
    nextCycleAt: data.readBigInt64LE(155),
    totalContributed: data.readBigUInt64LE(163),
    totalPaidOut: data.readBigUInt64LE(171),
    solidarityBalance: data.readBigUInt64LE(179),
    escrowBalance: data.readBigUInt64LE(187),
    yieldAccrued: data.readBigUInt64LE(195),
    guaranteeFundBalance: data.readBigUInt64LE(203),
    totalProtocolFeeAccrued: data.readBigUInt64LE(211),
    yieldPrincipalDeposited: data.readBigUInt64LE(219),
    defaultedMembers: data.readUInt8(227),
    lpDistributionBalance: data.readBigUInt64LE(228),
    occupiedSlots,
  };
}

/**
 * Fetch + decode a Pool account by its PDA. Returns null when the
 * account does not exist (so callers can render a "no pool" state
 * without an exception).
 */
export async function fetchPoolRaw(
  connection: Connection,
  address: PublicKey,
): Promise<RawPoolView | null> {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) return null;
  return decodePoolRaw(address, info.data);
}

/**
 * Convenience wrapper: derive the pool PDA from (coreProgram, authority,
 * seedId) and fetch it in one call.
 */
export async function fetchPoolBySeed(
  connection: Connection,
  coreProgram: PublicKey,
  authority: PublicKey,
  seedId: bigint,
): Promise<RawPoolView | null> {
  const [pda] = derivePoolPda(coreProgram, authority, seedId);
  return fetchPoolRaw(connection, pda);
}

// ─── Member offsets (declaration-order Borsh, no padding) ──────────────
//
//   off   8: pool                       Pubkey  (32)
//   off  40: wallet                     Pubkey  (32)
//   off  72: nft_asset                  Pubkey  (32)
//   off 104: slot_index                 u8      ( 1)
//   off 105: reputation_level           u8      ( 1)
//   off 106: stake_bps                  u16     ( 2)
//   off 108: stake_deposited            u64     ( 8)
//   off 116: contributions_paid         u8      ( 1)
//   off 117: total_contributed          u64     ( 8)
//   off 125: total_received             u64     ( 8)
//   off 133: escrow_balance             u64     ( 8)
//   off 141: on_time_count              u16     ( 2)
//   off 143: late_count                 u16     ( 2)
//   off 145: defaulted                  bool    ( 1)
//   off 146: paid_out                   bool    ( 1)
//   off 147: last_released_checkpoint   u8      ( 1)
//   off 148: joined_at                  i64     ( 8)
//   off 156: stake_deposited_initial    u64     ( 8)
//   off 164: total_escrow_deposited     u64     ( 8)
//   off 172: last_transferred_at        i64     ( 8)
//   off 180: bump                       u8      ( 1)
//
// Total size = 187 bytes (matches `Member::SIZE` in member.rs after
// the +6 reserved-padding tail).

const MEMBER_ACCOUNT_SIZE = 187;

export interface RawMemberView {
  address: PublicKey;
  pool: PublicKey;
  wallet: PublicKey;
  nftAsset: PublicKey;
  slotIndex: number;
  reputationLevel: number;
  stakeBps: number;
  stakeDeposited: bigint;
  contributionsPaid: number;
  totalContributed: bigint;
  totalReceived: bigint;
  escrowBalance: bigint;
  onTimeCount: number;
  lateCount: number;
  defaulted: boolean;
  paidOut: boolean;
  lastReleasedCheckpoint: number;
  joinedAt: bigint;
  stakeDepositedInitial: bigint;
  totalEscrowDeposited: bigint;
  lastTransferredAt: bigint;
}

/** Decode a Member account's raw bytes into the shared view shape. */
export function decodeMemberRaw(address: PublicKey, data: Buffer): RawMemberView {
  return {
    address,
    pool: new PublicKey(data.subarray(8, 40)),
    wallet: new PublicKey(data.subarray(40, 72)),
    nftAsset: new PublicKey(data.subarray(72, 104)),
    slotIndex: data.readUInt8(104),
    reputationLevel: data.readUInt8(105),
    stakeBps: data.readUInt16LE(106),
    stakeDeposited: data.readBigUInt64LE(108),
    contributionsPaid: data.readUInt8(116),
    totalContributed: data.readBigUInt64LE(117),
    totalReceived: data.readBigUInt64LE(125),
    escrowBalance: data.readBigUInt64LE(133),
    onTimeCount: data.readUInt16LE(141),
    lateCount: data.readUInt16LE(143),
    defaulted: data.readUInt8(145) !== 0,
    paidOut: data.readUInt8(146) !== 0,
    lastReleasedCheckpoint: data.readUInt8(147),
    joinedAt: data.readBigInt64LE(148),
    stakeDepositedInitial: data.readBigUInt64LE(156),
    totalEscrowDeposited: data.readBigUInt64LE(164),
    lastTransferredAt: data.readBigInt64LE(172),
  };
}

/**
 * Enumerate every Member account that points at `poolAddress`. Uses
 * `getProgramAccounts` with a dataSize filter (187B) plus a memcmp on
 * the pool field (offset 8). Sorted by `slotIndex` ascending so callers
 * get a deterministic display order.
 *
 * Note: `getProgramAccounts` is unindexed on most public RPCs and can
 * be slow / rate-limited. Suitable for low-frequency reads (e.g. a
 * 30s-refresh roster card); not for hot paths.
 */
export async function fetchPoolMembers(
  connection: Connection,
  coreProgram: PublicKey,
  poolAddress: PublicKey,
): Promise<RawMemberView[]> {
  const accounts = await connection.getProgramAccounts(coreProgram, {
    commitment: "confirmed",
    filters: [
      { dataSize: MEMBER_ACCOUNT_SIZE },
      { memcmp: { offset: 8, bytes: poolAddress.toBase58() } },
    ],
  });
  const members = accounts.map(({ pubkey, account }) =>
    decodeMemberRaw(pubkey, account.data as Buffer),
  );
  members.sort((a, b) => a.slotIndex - b.slotIndex);
  return members;
}

// ─── EscapeValveListing offsets (declaration-order Borsh, no padding) ──
//
//   off   8: pool          Pubkey (32)
//   off  40: seller        Pubkey (32)
//   off  72: slot_index    u8     ( 1)
//   off  73: price_usdc    u64    ( 8)
//   off  81: status        u8     ( 1)   // 0=Active, 1=Filled, 2=Cancelled, 3=Pending
//   off  82: listed_at     i64    ( 8)
//   off  90: bump          u8     ( 1)
//   off  91: commit_hash   [u8;32]( 32)  // #232 — commit-reveal hash
//   off 123: buyable_after i64    ( 8)   // #232 — cooldown end
//
// Total size = 139 bytes (matches `EscapeValveListing::SIZE` in
// listing.rs after the +8 reserved-padding tail).

const LISTING_ACCOUNT_SIZE = 139;

export type LocalListingStatus = "active" | "filled" | "cancelled" | "pending";

// Index matches EscapeValveStatus repr in `state/listing.rs`:
// Active=0, Filled=1, Cancelled=2, Pending=3.
const LISTING_STATUS: LocalListingStatus[] = ["active", "filled", "cancelled", "pending"];

export interface RawListingView {
  address: PublicKey;
  pool: PublicKey;
  seller: PublicKey;
  slotIndex: number;
  priceUsdc: bigint;
  status: LocalListingStatus;
  listedAt: bigint;
  /// #232 — commit-reveal additions. `commitHash` is all-zero for
  /// legacy single-step listings. `buyableAfter` equals `listedAt`
  /// for legacy listings (no cooldown) and `revealTs + 30s` for
  /// commit-revealed listings.
  commitHash: Buffer;
  buyableAfter: bigint;
}

/** Decode an EscapeValveListing account's raw bytes into a view. */
export function decodeListingRaw(address: PublicKey, data: Buffer): RawListingView {
  const statusByte = data.readUInt8(81);
  return {
    address,
    pool: new PublicKey(data.subarray(8, 40)),
    seller: new PublicKey(data.subarray(40, 72)),
    slotIndex: data.readUInt8(72),
    priceUsdc: data.readBigUInt64LE(73),
    status: LISTING_STATUS[statusByte] ?? "active",
    listedAt: data.readBigInt64LE(82),
    commitHash: Buffer.from(data.subarray(91, 123)),
    buyableAfter: data.readBigInt64LE(123),
  };
}

/**
 * Fetch + decode a listing account by its PDA. Returns null if the
 * listing was already filled / cancelled (closed from chain) so
 * front-ends can render a "no longer available" state cleanly.
 */
export async function fetchListingRaw(
  connection: Connection,
  address: PublicKey,
): Promise<RawListingView | null> {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) return null;
  return decodeListingRaw(address, info.data);
}

/**
 * Enumerate every active listing under a given pool. Uses
 * `getProgramAccounts` with a dataSize filter (99B) plus a memcmp on
 * the `pool` field at offset 8. Active-only filter applied client-side
 * since memcmp against status would conflict with the same-offset
 * query optimization.
 */
export async function fetchActivePoolListings(
  connection: Connection,
  coreProgram: PublicKey,
  poolAddress: PublicKey,
): Promise<RawListingView[]> {
  const accounts = await connection.getProgramAccounts(coreProgram, {
    commitment: "confirmed",
    filters: [
      { dataSize: LISTING_ACCOUNT_SIZE },
      { memcmp: { offset: 8, bytes: poolAddress.toBase58() } },
    ],
  });
  return accounts
    .map(({ pubkey, account }) => decodeListingRaw(pubkey, account.data as Buffer))
    .filter((l) => l.status === "active")
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

// ─── ReputationProfile (roundfi-reputation) ──────────────────────────────
//
// IDL-free decode of the per-wallet on-chain score. Source of truth:
// programs/roundfi-reputation/src/state/profile.rs. Layout after the
// 8-byte Anchor discriminator:
//   off  8: wallet                 Pubkey (32)
//   off 40: level                  u8     ( 1)
//   off 41: cycles_completed       u32    ( 4)
//   off 45: on_time_payments       u32    ( 4)
//   off 49: late_payments          u32    ( 4)
//   off 53: defaults               u32    ( 4)
//   off 57: total_participated     u32    ( 4)
//   off 61: score                  u64    ( 8)
//   off 69: last_cycle_complete_at i64    ( 8)
//   off 77: first_seen_at          i64    ( 8)
//   off 85: last_updated_at        i64    ( 8)
//   off 93: bump                   u8     ( 1)
//   off 94: last_admin_attest_at   i64    ( 8)
//   off102: _padding               [u8;7] ( 7)  → size 8 + 105 = 113

export interface RawReputationProfile {
  address: PublicKey;
  wallet: PublicKey;
  level: number;
  cyclesCompleted: number;
  onTimePayments: number;
  latePayments: number;
  defaults: number;
  totalParticipated: number;
  score: bigint;
  firstSeenAt: bigint;
  lastUpdatedAt: bigint;
}

export function decodeReputationProfileRaw(address: PublicKey, data: Buffer): RawReputationProfile {
  return {
    address,
    wallet: new PublicKey(data.subarray(8, 40)),
    level: data.readUInt8(40),
    cyclesCompleted: data.readUInt32LE(41),
    onTimePayments: data.readUInt32LE(45),
    latePayments: data.readUInt32LE(49),
    defaults: data.readUInt32LE(53),
    totalParticipated: data.readUInt32LE(57),
    score: data.readBigUInt64LE(61),
    firstSeenAt: data.readBigInt64LE(77),
    lastUpdatedAt: data.readBigInt64LE(85),
  };
}

/**
 * Fetch a wallet's on-chain ReputationProfile. Returns null when the
 * account does not exist — which the program treats as a fresh wallet
 * (level 1, score 0), so callers should render that default, not an error.
 */
export async function fetchReputationProfileRaw(
  connection: Connection,
  reputationProgram: PublicKey,
  wallet: PublicKey,
): Promise<RawReputationProfile | null> {
  const [address] = reputationProfilePda(reputationProgram, wallet);
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) return null;
  return decodeReputationProfileRaw(address, info.data as Buffer);
}

// ─── IdentityRecord (roundfi-reputation) ─────────────────────────────────
//
// IDL-free decode of the per-wallet identity/PoP snapshot. Source of truth:
// programs/roundfi-reputation/src/state/identity.rs. Layout after the
// 8-byte Anchor discriminator:
//   off  8: wallet         Pubkey  (32)
//   off 40: provider       u8      ( 1)  // 0=None 1=Sas 2=HumanPassport
//   off 41: status         u8      ( 1)  // 0=Unverified 1=Verified 2=Expired 3=Revoked
//   off 42: verified_at    i64     ( 8)
//   off 50: expires_at     i64     ( 8)  // 0 ≡ never
//   off 58: gateway_token  Pubkey  (32)
//   off 90: bump           u8      ( 1)
//   off 91: _padding       [u8;13] (13)  → size 8 + 96 = 104

export interface RawIdentityRecord {
  address: PublicKey;
  wallet: PublicKey;
  provider: number;
  status: number;
  verifiedAt: bigint;
  /** 0 ≡ never expires; else unix seconds. */
  expiresAt: bigint;
  gatewayToken: PublicKey;
}

export function decodeIdentityRecordRaw(address: PublicKey, data: Buffer): RawIdentityRecord {
  return {
    address,
    wallet: new PublicKey(data.subarray(8, 40)),
    provider: data.readUInt8(40),
    status: data.readUInt8(41),
    verifiedAt: data.readBigInt64LE(42),
    expiresAt: data.readBigInt64LE(50),
    gatewayToken: new PublicKey(data.subarray(58, 90)),
  };
}

/**
 * Fetch a wallet's on-chain IdentityRecord (Human Passport / PoP). Returns
 * null when the account does not exist — which the program treats as
 * Unverified, so callers should render the not-verified state, not an error.
 */
export async function fetchIdentityRecordRaw(
  connection: Connection,
  reputationProgram: PublicKey,
  wallet: PublicKey,
): Promise<RawIdentityRecord | null> {
  const [address] = identityPda(reputationProgram, wallet);
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) return null;
  return decodeIdentityRecordRaw(address, info.data as Buffer);
}

// ─── Attestation offsets (declaration-order Borsh, no padding) ─────────
//
// Source of truth: programs/roundfi-reputation/src/state/attestation.rs.
// LEN = 8 (disc) + 32 + 32 + 2 + 8 + 96 + 8 + 1 + 1 + 1 + 13 = 202.
//
//   off   8: issuer             Pubkey   (32)  pool PDA or authority
//   off  40: subject            Pubkey   (32)  wallet described
//   off  72: schema_id          u16      ( 2)
//   off  74: nonce              u64      ( 8)  (cycle << 32) | slot_index
//   off  82: payload            [u8; 96] (96)  BehavioralPayload (v5.2)
//   off 178: issued_at          i64      ( 8)
//   off 186: revoked            bool     ( 1)
//   off 187: bump               u8       ( 1)
//   off 188: verified_at_attest bool     ( 1)
//   off 189: neutralized        bool     ( 1)  // SEV-A2 (pool-complete in cooldown)
//   off 190: _padding           [u8; 12] (12)
const ATTESTATION_PAYLOAD_OFFSET = 82;
export const ATTESTATION_LEN = 202;

export interface RawAttestation {
  address: PublicKey;
  issuer: PublicKey;
  subject: PublicKey;
  schemaId: number;
  nonce: bigint;
  /** cycle = nonce >> 32 (the high 32 bits). */
  cycle: number;
  /** slotIndex = nonce & 0xffffffff (the low 32 bits). */
  slotIndex: number;
  issuedAt: bigint;
  revoked: boolean;
  verifiedAtAttest: boolean;
  /**
   * SEV-A2 — set when a `SCHEMA_POOL_COMPLETE` attestation was recorded but
   * its score bonus was NOT applied (issued inside the completion cooldown).
   * A score replay MUST treat a neutralized pool-complete as a 0-point event.
   */
  neutralized: boolean;
  /** Raw 96-byte payload, exactly as stored on-chain. */
  payloadRaw: Buffer;
  /**
   * Structured v5.2 BehavioralPayload, or `null` for a legacy zero
   * payload (pre-v5.2 attestation) / an unknown future version. Decoded
   * via the canonical {@link decodeBehavioralPayload} so it can never
   * disagree with the on-chain Rust codec.
   */
  payload: BehavioralPayload | null;
}

/**
 * IDL-free decoder for an Attestation account. The 96-byte payload is
 * surfaced both raw (`payloadRaw`, for audit-trail byte diffing) and
 * decoded (`payload`, the structured v5.2 view). `nonce` is split into
 * its `(cycle, slotIndex)` components — the same packing core uses at
 * the emit sites (`nonce = (cycle << 32) | slot_index`).
 */
export function decodeAttestationRaw(address: PublicKey, data: Buffer): RawAttestation {
  // Guard a truncated / mis-typed account: every field below reads a FIXED
  // offset (up to `verifiedAtAttest` @ 188), so a short buffer would throw an
  // opaque `RangeError`. Fail loud + specific instead. Callers memcmp-filter by
  // discriminator, so this only fires on a genuinely malformed account (e.g.
  // mid-realloc). Robustness — INFO-score-1.
  if (data.length < ATTESTATION_LEN) {
    throw new Error(
      `decodeAttestationRaw: account ${address.toBase58()} is ${data.length} bytes, ` +
        `expected >= ${ATTESTATION_LEN} (not a complete Attestation)`,
    );
  }
  const nonce = data.readBigUInt64LE(74);
  const payloadRaw = Buffer.from(
    data.subarray(ATTESTATION_PAYLOAD_OFFSET, ATTESTATION_PAYLOAD_OFFSET + ATTESTATION_PAYLOAD_LEN),
  );
  return {
    address,
    issuer: new PublicKey(data.subarray(8, 40)),
    subject: new PublicKey(data.subarray(40, 72)),
    schemaId: data.readUInt16LE(72),
    nonce,
    cycle: Number(nonce >> 32n),
    slotIndex: Number(nonce & 0xffffffffn),
    issuedAt: data.readBigInt64LE(178),
    revoked: data.readUInt8(186) === 1,
    verifiedAtAttest: data.readUInt8(188) === 1,
    neutralized: data.readUInt8(189) === 1,
    payloadRaw,
    payload: decodeBehavioralPayload(payloadRaw),
  };
}

/**
 * Enumerate every Attestation whose `subject` is `wallet` — the wallet's full
 * on-chain scoring history. Uses `getProgramAccounts` with a dataSize filter
 * plus a memcmp on the subject field (offset 40). Sorted by `issuedAt`
 * ascending so a score replay steps through events in the order the program
 * applied them.
 *
 * Note: `getProgramAccounts` is unindexed on most public RPCs and can be
 * slow / rate-limited — suitable for a low-frequency read (the /insights
 * 30s-refresh curve), not a hot path.
 */
export async function fetchAttestationsForSubject(
  connection: Connection,
  reputationProgram: PublicKey,
  wallet: PublicKey,
): Promise<RawAttestation[]> {
  const accounts = await connection.getProgramAccounts(reputationProgram, {
    commitment: "confirmed",
    filters: [{ dataSize: ATTESTATION_LEN }, { memcmp: { offset: 40, bytes: wallet.toBase58() } }],
  });
  const atts = accounts.map(({ pubkey, account }) =>
    decodeAttestationRaw(pubkey, account.data as Buffer),
  );
  atts.sort((a, b) => Number(a.issuedAt - b.issuedAt));
  return atts;
}
