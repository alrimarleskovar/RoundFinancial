/**
 * Squads rehearsal — submit `propose_new_authority(new_authority)`.
 *
 * Wraps the on-chain `propose_new_authority` instruction (PR #323) so
 * the devnet rehearsal can be run as a single command rather than via
 * raw Anchor SDK calls (which are blocked by the Anchor 0.31+ IDL-gen
 * issue tracked in PR #319). Uses the same manual-encoding pattern as
 * `init-protocol.ts`.
 *
 * Mainnet equivalent: this is the ix the deployer signs at the
 * ceremony to stage the Squads vault PDA on `config.pending_authority`.
 * After the 7-day timelock, anyone can call
 * `squads-rehearsal-commit-authority.ts` to finalize.
 *
 * Closes part of Fase B of the Squads ceremony preparation track.
 *
 * ## Usage
 *
 * ```bash
 * pnpm tsx scripts/devnet/squads-rehearsal-propose-authority.ts \
 *   --new-authority <pubkey>
 * ```
 *
 * The signer is loaded from `ANCHOR_WALLET` (or `~/.config/solana/id.json`)
 * — must match the current `config.authority` or the on-chain
 * `Unauthorized` constraint fires.
 *
 * Refuses to run on mainnet — mainnet ceremony goes through the Squads
 * web UI with hardware-wallet confirmation per the procedure doc.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { loadCluster, requireProgram } from "../../config/clusters.js";

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) {
    throw new Error(`keypair not found at ${path}`);
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")));
  return Keypair.fromSecretKey(secret);
}

function anchorIxDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

interface Args {
  newAuthority: PublicKey;
}

function parseArgs(argv: string[]): Args {
  let newAuthority: PublicKey | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--new-authority") {
      const v = argv[++i];
      if (!v) throw new Error("--new-authority requires a pubkey argument");
      newAuthority = new PublicKey(v);
    } else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown flag: ${a} (use --help to see options)`);
    }
  }
  if (!newAuthority) {
    throw new Error("--new-authority is required");
  }
  return { newAuthority };
}

function printUsage(): void {
  console.log(`
Squads rehearsal — propose new protocol authority

USAGE:
  pnpm tsx scripts/devnet/squads-rehearsal-propose-authority.ts \\
    --new-authority <pubkey>

OPTIONS:
  --new-authority <pk>  The Squads vault PDA (or test keypair pubkey
                        for a devnet rehearsal) that will become the
                        new config.authority after the 7-day timelock.
  --help, -h            Print this message

NOTE:
  The signer (ANCHOR_WALLET) must match the current config.authority.
  Run squads-rehearsal-verify.ts before + after to confirm state.
`);
}

async function main(): Promise<void> {
  const { newAuthority } = parseArgs(process.argv.slice(2));

  const cluster = loadCluster();
  console.log(`\n━━━ Squads rehearsal · propose → ${cluster.name} ━━━\n`);

  if (cluster.name === "mainnet-beta") {
    throw new Error(
      "Refusing to propose authority rotation on mainnet via this script. " +
        "Mainnet ceremony uses Squads web UI + hardware wallets per " +
        "docs/operations/squads-multisig-procedure.md.",
    );
  }

  const coreProgram = requireProgram(cluster, "core");
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], coreProgram);

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  const authority = loadKeypair(walletPath);

  console.log(`→ Cluster        : ${cluster.name}`);
  console.log(`→ Core program   : ${coreProgram.toBase58()}`);
  console.log(`→ Config PDA     : ${configPda.toBase58()}`);
  console.log(`→ Signer (auth.) : ${authority.publicKey.toBase58()}`);
  console.log(`→ New authority  : ${newAuthority.toBase58()}\n`);

  // ix.data = [discriminator (8) | Pubkey (32)] = 40 bytes
  const data = Buffer.concat([
    anchorIxDiscriminator("propose_new_authority"),
    newAuthority.toBuffer(),
  ]);

  // Account list mirrors `ProposeNewAuthority` in
  // programs/roundfi-core/src/instructions/propose_new_authority.rs:
  //   1. config    (PDA, mut, seeds=[b"config"]; constraint authority == config.authority)
  //   2. authority (signer)
  const ix = new TransactionInstruction({
    programId: coreProgram,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data,
  });

  const connection = new Connection(cluster.rpcUrl, "confirmed");
  const tx = new Transaction().add(ix);
  const signature = await connection.sendTransaction(tx, [authority], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");

  console.log(`✓ propose_new_authority confirmed`);
  console.log(`  signature : ${signature}`);
  if (cluster.name === "devnet") {
    console.log(`  solscan   : https://solscan.io/tx/${signature}?cluster=devnet`);
  }
  console.log("");
  console.log("Next:");
  console.log("  1. Wait 7d (TREASURY_TIMELOCK_SECS = 604_800).");
  console.log("  2. Run squads-rehearsal-commit-authority.ts to finalize.");
  console.log("  3. If you spot a typo or want to abort:");
  console.log("       squads-rehearsal-cancel-authority.ts");
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ squads-rehearsal-propose-authority failed:");
  console.error(e);
  process.exit(1);
});
