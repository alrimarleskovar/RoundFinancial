/**
 * Raw on-chain account decoders — IDL-free path for clients.
 *
 * The Anchor SDK's `program.account.<name>.fetch()` requires a
 * generated IDL. Our build chain currently ships with `--no-idl`
 * (the toolchain bump in `init-protocol.ts` blocks IDL gen), so
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

import { poolPda as derivePoolPda } from "./pda.js";

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
type LocalPoolStatusName = "forming" | "active" | "completed" | "liquidated";

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

const STATUS_NAMES: LocalPoolStatusName[] = ["forming", "active", "completed", "liquidated"];

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
