/**
 * Initialize the singleton ProtocolConfig + ReputationConfig accounts on
 * the configured cluster. Idempotent: reuses an existing PDA if already
 * initialized (and prints the existing config).
 *
 * Manual instruction encoding (no Anchor SDK runtime). Anchor 0.30.1
 * IDL gen is broken on Rust 1.95 + proc-macro2 1.0.106 (the
 * `Span::source_file()` API was removed from stable proc-macro2), so we
 * build instructions by hand:
 *
 *   discriminator = sha256("global:" + ix_name)[0..8]
 *   args          = borsh-encoded args
 *   accounts      = [{ pubkey, isSigner, isWritable }, …]
 *
 * Once the toolchain unblock lands (anchor 0.31+ has the source_file
 * fix), this script can be rewritten to use the SDK's
 * `initializeProtocol()` wrapper from `sdk/src/actions.ts`.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ACCOUNT_SIZE,
} from "@solana/spl-token";

import { loadCluster, requireProgram } from "../../config/clusters.js";

// Default fee schedule mirrors `programs/roundfi-core/src/constants.rs`.
const DEFAULT_FEE_BPS_YIELD = 2_000;
const DEFAULT_FEE_BPS_CYCLE_L1 = 200;
const DEFAULT_FEE_BPS_CYCLE_L2 = 100;
const DEFAULT_FEE_BPS_CYCLE_L3 = 0;
const DEFAULT_GUARANTEE_FUND_BPS = 15_000;

// Localnet placeholder values — civic gateway / network are
// non-functional on devnet but pinned by `initialize_reputation`. Same
// constants as `tests/_harness/reputation.ts`.
const CIVIC_GATEWAY_PROGRAM = new PublicKey("gatem74V238djXdzWnJf94Wo1DcnuGkfijbf3AuBhfs");
const CIVIC_NETWORK = new PublicKey("ignREusXmGrscGNUesoU9mxfds9AiYTezUKex2PsZV6");

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) {
    throw new Error(`keypair not found at ${path}`);
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

function anchorIxDiscriminator(name: string): Buffer {
  // Anchor convention: first 8 bytes of sha256("global:<ix_name>")
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function encodeU16LE(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return buf;
}

async function ensureTreasuryAta(
  connection: Connection,
  payer: Keypair,
  usdcMint: PublicKey,
): Promise<{ ata: PublicKey; created: boolean; signature?: string }> {
  const ata = getAssociatedTokenAddressSync(usdcMint, payer.publicKey);
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (info && info.data.length === ACCOUNT_SIZE) {
    return { ata, created: false };
  }
  console.log(`→ creating treasury ATA ${ata.toBase58()}`);
  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey, // payer
      ata, // ata
      payer.publicKey, // owner
      usdcMint, // mint
    ),
  );
  const signature = await connection.sendTransaction(tx, [payer], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");
  return { ata, created: true, signature };
}

async function callInitializeProtocol(
  connection: Connection,
  authority: Keypair,
  coreProgram: PublicKey,
  reputationProgram: PublicKey,
  yieldAdapter: PublicKey,
  metaplexCore: PublicKey,
  usdcMint: PublicKey,
  treasury: PublicKey,
): Promise<{ signature: string; configPda: PublicKey } | { skipped: true; configPda: PublicKey }> {
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);

  const existing = await connection.getAccountInfo(configPda, "confirmed");
  if (existing) {
    console.log(`→ ProtocolConfig already initialized at ${configPda.toBase58()} — skipping`);
    return { skipped: true, configPda };
  }

  // ix.data = [discriminator (8) | u16 × 5 (10)] = 18 bytes
  const data = Buffer.concat([
    anchorIxDiscriminator("initialize_protocol"),
    encodeU16LE(DEFAULT_FEE_BPS_YIELD),
    encodeU16LE(DEFAULT_FEE_BPS_CYCLE_L1),
    encodeU16LE(DEFAULT_FEE_BPS_CYCLE_L2),
    encodeU16LE(DEFAULT_FEE_BPS_CYCLE_L3),
    encodeU16LE(DEFAULT_GUARANTEE_FUND_BPS),
  ]);

  // Account list — order MUST match `InitializeProtocol` in
  // programs/roundfi-core/src/instructions/initialize_protocol.rs:
  //   1. authority           (signer, mut)
  //   2. config              (PDA, mut, init)
  //   3. usdc_mint           (read)
  //   4. treasury            (read; constraint = token::mint = usdc_mint)
  //   5. metaplex_core       (read; address = mpl_core::ID)
  //   6. default_yield_adapter (read; executable)
  //   7. reputation_program  (read; executable)
  //   8. system_program      (read)
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: treasury, isSigner: false, isWritable: false },
      { pubkey: metaplexCore, isSigner: false, isWritable: false },
      { pubkey: yieldAdapter, isSigner: false, isWritable: false },
      { pubkey: reputationProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const signature = await connection.sendTransaction(tx, [authority], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");
  return { signature, configPda };
}

async function callInitializeReputation(
  connection: Connection,
  authority: Keypair,
  reputationProgram: PublicKey,
  coreProgram: PublicKey,
): Promise<{ signature: string; configPda: PublicKey } | { skipped: true; configPda: PublicKey }> {
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rep-config")],
    reputationProgram,
  );

  const existing = await connection.getAccountInfo(configPda, "confirmed");
  if (existing) {
    console.log(`→ ReputationConfig already initialized at ${configPda.toBase58()} — skipping`);
    return { skipped: true, configPda };
  }

  // ix.data = [discriminator (8) | Pubkey × 3 (96)] = 104 bytes
  const data = Buffer.concat([
    anchorIxDiscriminator("initialize_reputation"),
    coreProgram.toBuffer(),
    CIVIC_GATEWAY_PROGRAM.toBuffer(),
    CIVIC_NETWORK.toBuffer(),
  ]);

  // Accounts (mirrors `InitializeReputation`):
  //   1. authority      (signer, mut)
  //   2. config         (PDA, mut, init)
  //   3. system_program (read)
  const ix = new TransactionInstruction({
    programId: reputationProgram,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const signature = await connection.sendTransaction(tx, [authority], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");
  return { signature, configPda };
}

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi init-protocol → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);

  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to initialize on mainnet — use a deliberate process.");
  }

  const coreProgram = requireProgram(cluster, "core");
  const reputationProgram = requireProgram(cluster, "reputation");
  const yieldAdapter = requireProgram(cluster, "yieldMock"); // devnet uses mock
  const metaplexCore = cluster.metaplexCore;
  const usdcMint = cluster.usdcMint;

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  const authority = loadKeypair(walletPath);

  console.log(`→ Cluster        : ${cluster.name}`);
  console.log(`→ Authority      : ${authority.publicKey.toBase58()}`);
  console.log(`→ Core program   : ${coreProgram.toBase58()}`);
  console.log(`→ Reputation prog: ${reputationProgram.toBase58()}`);
  console.log(`→ Yield adapter  : ${yieldAdapter.toBase58()}`);
  console.log(`→ Metaplex Core  : ${metaplexCore.toBase58()}`);
  console.log(`→ USDC mint      : ${usdcMint.toBase58()}\n`);

  const connection = new Connection(cluster.rpcUrl, "confirmed");

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`→ Authority balance: ${(balance / 1e9).toFixed(4)} SOL\n`);
  if (balance < 0.05 * 1e9) {
    throw new Error(
      `Insufficient SOL on authority (${authority.publicKey.toBase58()}). ` +
        `Need ≥ 0.05 SOL for the two singleton inits.`,
    );
  }

  // 1) Treasury ATA — protocol fees land here.
  const treasury = await ensureTreasuryAta(connection, authority, usdcMint);
  if (treasury.created) {
    console.log(`✓ treasury ATA created (${treasury.ata.toBase58()}) tx ${treasury.signature}\n`);
  } else {
    console.log(`✓ treasury ATA already exists (${treasury.ata.toBase58()})\n`);
  }

  // 2) initialize_protocol
  console.log(`→ calling roundfi_core.initialize_protocol(...)`);
  const protoResult = await callInitializeProtocol(
    connection,
    authority,
    coreProgram,
    reputationProgram,
    yieldAdapter,
    metaplexCore,
    usdcMint,
    treasury.ata,
  );
  if ("skipped" in protoResult) {
    console.log(`  config PDA: ${protoResult.configPda.toBase58()} (existing)\n`);
  } else {
    console.log(`✓ initialize_protocol confirmed`);
    console.log(`  config PDA: ${protoResult.configPda.toBase58()}`);
    console.log(`  signature : ${protoResult.signature}\n`);
  }

  // 3) initialize_reputation
  console.log(`→ calling roundfi_reputation.initialize_reputation(...)`);
  const repResult = await callInitializeReputation(
    connection,
    authority,
    reputationProgram,
    coreProgram,
  );
  if ("skipped" in repResult) {
    console.log(`  config PDA: ${repResult.configPda.toBase58()} (existing)\n`);
  } else {
    console.log(`✓ initialize_reputation confirmed`);
    console.log(`  config PDA: ${repResult.configPda.toBase58()}`);
    console.log(`  signature : ${repResult.signature}\n`);
  }

  console.log(`━━━ done ━━━\n`);
  console.log(`Solscan (devnet):`);
  console.log(`  https://solscan.io/account/${coreProgram.toBase58()}?cluster=devnet`);
  console.log(`  https://solscan.io/account/${reputationProgram.toBase58()}?cluster=devnet`);
  if (!("skipped" in protoResult)) {
    console.log(`  https://solscan.io/tx/${protoResult.signature}?cluster=devnet`);
  }
  if (!("skipped" in repResult)) {
    console.log(`  https://solscan.io/tx/${repResult.signature}?cluster=devnet`);
  }
  console.log("");
}

// Re-exports referenced for legibility — silences unused-import lint.
void TOKEN_PROGRAM_ID;
void ASSOCIATED_TOKEN_PROGRAM_ID;

main().catch((e) => {
  console.error("\n✗ init-protocol failed:");
  console.error(e);
  process.exit(1);
});
