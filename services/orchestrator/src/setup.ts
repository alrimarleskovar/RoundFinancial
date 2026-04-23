/**
 * Demo setup helpers.
 *
 * These wrap the one-off plumbing that precedes any pool lifecycle:
 *
 *   - create a throwaway USDC-like SPL mint (6 decimals) — the
 *     orchestrator never talks to real devnet USDC,
 *   - airdrop SOL to every keypair that will sign transactions,
 *   - initialize the reputation program + per-wallet profiles (the
 *     SDK's `contribute`/`claimPayout`/`settleDefault` actions assume
 *     these exist),
 *   - initialize the protocol config (idempotent),
 *   - fund each member's USDC ATA up to a target balance.
 *
 * All helpers are synchronous-style (single tx each), deterministic,
 * and emit one `action.ok` event per effect so the demo log stays
 * readable.
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo as splMintTo,
} from "@solana/spl-token";
import { Program } from "@coral-xyz/anchor";

import {
  FEES,
  initializeProtocol,
  protocolConfigPda,
  reputationConfigPda,
  reputationProfilePda,
} from "@roundfi/sdk";
import type { AnyIdl, RoundFiClient } from "@roundfi/sdk";

import type { EventSink } from "./events.js";
import { now } from "./events.js";

// ─── Constants ───────────────────────────────────────────────────────

export const USDC_DECIMALS = 6;
export const USDC_UNIT = 10n ** BigInt(USDC_DECIMALS);

/** Helper: 5 USDC ⇒ 5_000_000 base units. */
export function usdc(whole: number | bigint): bigint {
  return (typeof whole === "bigint" ? whole : BigInt(whole)) * USDC_UNIT;
}

/** Localnet placeholder for the Civic gateway — unused by the demo flow. */
const LOCALNET_CIVIC_GATEWAY = new PublicKey(
  "gatem74V238djXdzWnJf94Wo1DcnuGkfijbf3AuBhfs",
);
const LOCALNET_CIVIC_NETWORK = new PublicKey(
  "ignREusXmGrscGNUesoU9mxfds9AiYTezUKex2PsZV6",
);

// Anchor's Program<AnyIdl>.methods.<ix> is typed as possibly undefined
// because AnyIdl carries no instruction schema. Runtime IDL provides
// the real methods — this helper lets call sites stay readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function m(program: Program<AnyIdl>): any {
  return program.methods;
}

// ─── Member descriptors ──────────────────────────────────────────────

export interface DemoMember {
  /** Display name for logs (e.g. "Maria"). */
  name: string;
  wallet: Keypair;
  reputationLevel: 1 | 2 | 3;
  /** Slot index this member will claim at pool creation time. */
  slotIndex: number;
}

export interface BuildMembersArgs {
  names: string[];
  /** Defaults to L1 for everyone — keeps the demo math predictable. */
  reputationLevels?: (1 | 2 | 3)[];
}

/**
 * Build a fresh set of DemoMember records. Slot indices are assigned
 * in the same order as `names` (slot 0 = names[0], etc.).
 */
export function buildMembers(args: BuildMembersArgs): DemoMember[] {
  return args.names.map((name, i) => ({
    name,
    wallet: Keypair.generate(),
    reputationLevel: args.reputationLevels?.[i] ?? 1,
    slotIndex: i,
  }));
}

// ─── SOL airdrop ─────────────────────────────────────────────────────

/**
 * Airdrop `lamports` to each wallet, waiting for confirmation after
 * each request. Localnet/devnet only. Emits one event per airdrop.
 */
export async function airdropSol(
  connection: Connection,
  wallets: PublicKey[],
  lamports: number,
  sink: EventSink,
): Promise<void> {
  for (const w of wallets) {
    const sig = await connection.requestAirdrop(w, lamports);
    const latest = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      { signature: sig, ...latest },
      "confirmed",
    );
    sink({
      kind: "action.ok",
      action: "airdropSol",
      detail: `airdropped ${lamports / LAMPORTS_PER_SOL} SOL → ${w.toBase58().slice(0, 8)}…`,
      signature: sig,
      at: now(),
    });
  }
}

// ─── USDC mint ───────────────────────────────────────────────────────

export async function createDemoUsdcMint(
  connection: Connection,
  payer: Keypair,
  sink: EventSink,
): Promise<PublicKey> {
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    payer.publicKey,
    USDC_DECIMALS,
    undefined,
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
  );
  sink({
    kind: "action.ok",
    action: "createDemoUsdcMint",
    detail: `created demo USDC mint ${mint.toBase58().slice(0, 8)}… (6 decimals)`,
    at: now(),
  });
  return mint;
}

/**
 * Ensure `owner` has at least `amount` USDC (base units) in their ATA.
 * Mints only the shortfall. Returns the ATA pubkey.
 */
export async function fundMemberUsdc(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint,
): Promise<PublicKey> {
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner,
    true,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const current = await getAccount(connection, ata.address, "confirmed", TOKEN_PROGRAM_ID);
  if (current.amount < amount) {
    await splMintTo(
      connection,
      payer,
      mint,
      ata.address,
      payer,
      amount - current.amount,
      [],
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID,
    );
  }
  return ata.address;
}

/** Bulk-fund members, emitting one event per member. */
export async function fundMembers(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  members: DemoMember[],
  amountEach: bigint,
  sink: EventSink,
): Promise<void> {
  for (const mbr of members) {
    await fundMemberUsdc(connection, payer, mint, mbr.wallet.publicKey, amountEach);
    sink({
      kind: "action.ok",
      action: "fundMemberUsdc",
      actor: mbr.name,
      detail: `funded ${mbr.name}'s wallet with ${amountEach / USDC_UNIT} USDC`,
      at: now(),
    });
  }
}

/** Ensure the treasury ATA exists and is owned by `treasuryOwner`. */
export async function ensureTreasuryAta(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  treasuryOwner: PublicKey,
): Promise<PublicKey> {
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    treasuryOwner,
    true,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata.address;
}

// ─── Protocol / reputation init ─────────────────────────────────────

export interface EnsureProtocolArgs {
  authority: Keypair;
  usdcMint: PublicKey;
  treasury: PublicKey;
}

/**
 * Idempotent: initialize ProtocolConfig if it doesn't exist yet. Uses
 * the canonical fee schedule from `@roundfi/sdk/constants`.
 */
export async function ensureProtocolInitialized(
  client: RoundFiClient,
  args: EnsureProtocolArgs,
  sink: EventSink,
): Promise<PublicKey> {
  const [config] = protocolConfigPda(client.ids.core);
  const existing = await client.connection.getAccountInfo(config, "confirmed");
  if (existing) {
    sink({
      kind: "action.skip",
      action: "initializeProtocol",
      reason: `ProtocolConfig already exists at ${config.toBase58().slice(0, 8)}…`,
      at: now(),
    });
    return config;
  }

  const res = await initializeProtocol(client, {
    authority:        args.authority,
    usdcMint:         args.usdcMint,
    treasury:         args.treasury,
    feeBpsYield:      FEES.yieldFeeBps,
    feeBpsCycleL1:    FEES.cycleFeeL1Bps,
    feeBpsCycleL2:    FEES.cycleFeeL2Bps,
    feeBpsCycleL3:    FEES.cycleFeeL3Bps,
    guaranteeFundBps: FEES.guaranteeFundBps,
  });
  sink({
    kind: "action.ok",
    action: "initializeProtocol",
    signature: res.signature,
    detail: `ProtocolConfig initialized at ${config.toBase58().slice(0, 8)}…`,
    at: now(),
  });
  return config;
}

/**
 * Idempotent: initialize the reputation singleton ConfigOnce. Subsequent
 * calls short-circuit.
 */
export async function ensureReputationInitialized(
  client: RoundFiClient,
  authority: Keypair,
  sink: EventSink,
): Promise<PublicKey> {
  const [config] = reputationConfigPda(client.ids.reputation);
  const existing = await client.connection.getAccountInfo(config, "confirmed");
  if (existing) {
    sink({
      kind: "action.skip",
      action: "initializeReputation",
      reason: `ReputationConfig already exists at ${config.toBase58().slice(0, 8)}…`,
      at: now(),
    });
    return config;
  }

  const sig = await m(client.programs.reputation)
    .initializeReputation({
      roundfiCoreProgram:  client.ids.core,
      civicGatewayProgram: LOCALNET_CIVIC_GATEWAY,
      civicNetwork:        LOCALNET_CIVIC_NETWORK,
    })
    .accounts({
      authority:     authority.publicKey,
      config,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  sink({
    kind: "action.ok",
    action: "initializeReputation",
    signature: sig,
    detail: `ReputationConfig initialized at ${config.toBase58().slice(0, 8)}…`,
    at: now(),
  });
  return config;
}

/**
 * Idempotent per-wallet profile init. The on-chain core→reputation CPIs
 * for Payment/Late/Default/CycleComplete require an existing profile
 * account; the orchestrator initializes every member's profile before
 * joining the pool.
 */
export async function ensureReputationProfile(
  client: RoundFiClient,
  payer: Keypair,
  subject: PublicKey,
): Promise<PublicKey> {
  const [profile] = reputationProfilePda(client.ids.reputation, subject);
  const existing = await client.connection.getAccountInfo(profile, "confirmed");
  if (existing) return profile;

  await m(client.programs.reputation)
    .initProfile(subject)
    .accounts({
      payer:         payer.publicKey,
      profile,
      systemProgram: SystemProgram.programId,
    })
    .signers([payer])
    .rpc();
  return profile;
}

/** Init profiles for every demo member. Idempotent. */
export async function ensureMemberProfiles(
  client: RoundFiClient,
  payer: Keypair,
  members: DemoMember[],
  sink: EventSink,
): Promise<void> {
  for (const mbr of members) {
    await ensureReputationProfile(client, payer, mbr.wallet.publicKey);
    sink({
      kind: "action.ok",
      action: "initProfile",
      actor: mbr.name,
      detail: `reputation profile ready for ${mbr.name}`,
      at: now(),
    });
  }
}
