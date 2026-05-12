/**
 * Pause-rehearsal orchestrator — exercises the `pause` instruction
 * end-to-end on devnet with the authority keypair, confirms gates fire
 * for the 9 user-facing instructions, then unpauses cleanly.
 *
 * Closes (partially) #231 — operational hygiene for pre-mainnet.
 *
 * Procedure:
 *
 *   1. Pre-flight: load authority keypair, read ProtocolConfig PDA,
 *      confirm current paused=false (otherwise the drill is
 *      meaningless).
 *   2. Sign + send `pause(paused=true)` with the authority keypair.
 *   3. Verify on-chain: re-read ProtocolConfig, assert paused=true.
 *      Print the tx Signature + Solscan URL.
 *   4. Print the manual-verification checklist for the 9 gated
 *      instructions + the 1 ungated one. User attempts each via the
 *      app or the SDK seed scripts; the rehearsal logs the
 *      observation.
 *   5. Wait for user confirmation (Enter) to proceed.
 *   6. Sign + send `pause(paused=false)` to unpause.
 *   7. Verify paused=false. Print tx Signature + Solscan URL.
 *   8. Write a rehearsal log to docs/operations/rehearsal-logs/
 *      YYYY-MM-DD-pause.md with all the tx refs captured.
 *
 * Manual instruction encoding (no Anchor SDK runtime) — same pattern
 * as `init-protocol.ts`. Once Anchor 0.31+ unblocks IDL gen, this
 * can use `sdk/src/actions.ts` directly.
 *
 * Usage:
 *
 *   pnpm devnet:pause-rehearsal
 *
 * Env overrides:
 *
 *   SOLANA_WALLET=/path/to/authority.json   (default: solana config)
 *   ANCHOR_PROVIDER_URL=https://...         (default: devnet)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";

const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
const WALLET_PATH = process.env.SOLANA_WALLET ?? resolve(homedir(), ".config/solana/id.json");

const ROUNDFI_CORE_PROGRAM_ID = new PublicKey("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw");

const SEED_CONFIG = Buffer.from("config");

// Anchor convention: first 8 bytes of sha256("global:<ix_name>")
function anchorIxDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) {
    throw new Error(`Keypair not found at ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function readPausedFlag(connection: Connection, configPda: PublicKey): Promise<boolean> {
  const info = await connection.getAccountInfo(configPda, "confirmed");
  if (!info) throw new Error(`ProtocolConfig PDA ${configPda.toBase58()} not found`);
  // ProtocolConfig layout (offsets from anchor-discriminator end at byte 8):
  //   8        discriminator
  //   32       authority
  //   32       treasury
  //   32       usdc_mint
  //   32       metaplex_core
  //   32       default_yield_adapter
  //   32       reputation_program
  //   2 × 5    fee bps fields (yield, cycle_l1, cycle_l2, cycle_l3, gf)
  //   1        paused                          ← offset 8 + 32×6 + 2×5 = 210
  //   1        bump
  //   + tail   reserved fields
  return info.data[210] === 1;
}

function buildPauseIx(
  configPda: PublicKey,
  authority: PublicKey,
  paused: boolean,
): TransactionInstruction {
  // ix.data = [discriminator (8) | bool (1)] = 9 bytes
  const data = Buffer.concat([anchorIxDiscriminator("pause"), Buffer.from([paused ? 1 : 0])]);

  return new TransactionInstruction({
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    programId: ROUNDFI_CORE_PROGRAM_ID,
    data,
  });
}

async function sendPauseTx(
  connection: Connection,
  authority: Keypair,
  configPda: PublicKey,
  paused: boolean,
): Promise<string> {
  const ix = buildPauseIx(configPda, authority.publicKey, paused);
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = authority.publicKey;
  tx.sign(authority);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}

function solscanTxUrl(sig: string): string {
  return `https://solscan.io/tx/${sig}?cluster=devnet`;
}

async function promptContinue(prompt: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(prompt);
  rl.close();
}

async function main() {
  console.log("▶ Pause-rehearsal orchestrator (closes #231 partial)");
  console.log(`  RPC:    ${RPC_URL}`);
  console.log(`  Wallet: ${WALLET_PATH}`);
  console.log("");

  const connection = new Connection(RPC_URL, "confirmed");
  const authority = loadKeypair(WALLET_PATH);
  console.log(`  Authority: ${authority.publicKey.toBase58()}`);

  const [configPda] = PublicKey.findProgramAddressSync([SEED_CONFIG], ROUNDFI_CORE_PROGRAM_ID);
  console.log(`  Config PDA: ${configPda.toBase58()}`);

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`  Balance: ${(balance / 1e9).toFixed(4)} SOL`);
  if (balance < 1e7) {
    throw new Error("Authority balance too low (< 0.01 SOL). Top up before running.");
  }

  const pausedPre = await readPausedFlag(connection, configPda);
  console.log(`  Current paused state: ${pausedPre}`);
  if (pausedPre) {
    console.log("");
    console.log("⚠️  Protocol is ALREADY paused. Rehearsal aborted.");
    console.log("   If this is intentional (live incident response), use the");
    console.log("   emergency-response runbook directly, not this rehearsal.");
    process.exit(1);
  }

  console.log("");
  console.log("─── Step 1: PAUSE ─────────────────────────────────────────");
  await promptContinue("Press Enter to sign+send pause(true), or Ctrl-C to abort: ");
  const pauseSig = await sendPauseTx(connection, authority, configPda, true);
  console.log(`  ✓ tx: ${pauseSig}`);
  console.log(`     ${solscanTxUrl(pauseSig)}`);

  // Re-read + verify
  const pausedAfter = await readPausedFlag(connection, configPda);
  if (!pausedAfter) {
    throw new Error("PAUSE FAILED — paused flag still false after tx confirmation");
  }
  console.log("  ✓ ProtocolConfig.paused = true (verified on-chain)");

  console.log("");
  console.log("─── Step 2: MANUAL VERIFICATION ───────────────────────────");
  console.log("  Open the dApp or use SDK scripts to attempt EACH instruction.");
  console.log("  The 9 gated instructions should ALL fail with ProtocolPaused:");
  console.log("");
  const gated = [
    "create_pool",
    "join_pool",
    "contribute",
    "claim_payout",
    "release_escrow",
    "deposit_idle_to_yield",
    "harvest_yield",
    "escape_valve_list",
    "escape_valve_buy",
  ];
  for (const ix of gated) {
    console.log(`    [ ] ${ix.padEnd(24)} → expect: ProtocolPaused error`);
  }
  console.log("");
  console.log("  And settle_default should STILL work (deliberate carve-out):");
  console.log(`    [ ] settle_default            → expect: succeed (or fail downstream,`);
  console.log(`                                     but NOT with ProtocolPaused)`);
  console.log("");

  await promptContinue("Press Enter when manual verification is complete: ");

  console.log("");
  console.log("─── Step 3: UNPAUSE ───────────────────────────────────────");
  await promptContinue("Press Enter to sign+send pause(false), or Ctrl-C to leave paused: ");
  const unpauseSig = await sendPauseTx(connection, authority, configPda, false);
  console.log(`  ✓ tx: ${unpauseSig}`);
  console.log(`     ${solscanTxUrl(unpauseSig)}`);

  const pausedFinal = await readPausedFlag(connection, configPda);
  if (pausedFinal) {
    throw new Error("UNPAUSE FAILED — paused flag still true after tx confirmation");
  }
  console.log("  ✓ ProtocolConfig.paused = false (verified on-chain)");

  console.log("");
  console.log("─── Step 4: LOG ───────────────────────────────────────────");
  const logDir = resolve(process.cwd(), "docs/operations/rehearsal-logs");
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const logPath = resolve(logDir, `${stamp}-pause-rehearsal.md`);
  const body = `# Pause-rehearsal log — ${stamp}

> Generated by \`pnpm devnet:pause-rehearsal\`. Closes #231 partial.

## Result

✓ **Drill completed successfully.** Pause → manual gate verification → unpause cycle completed end-to-end on devnet.

## Environment

- **RPC:** ${RPC_URL}
- **Authority:** \`${authority.publicKey.toBase58()}\`
- **ProtocolConfig PDA:** \`${configPda.toBase58()}\`

## Transactions

- **Pause:** [\`${pauseSig}\`](${solscanTxUrl(pauseSig)})
- **Unpause:** [\`${unpauseSig}\`](${solscanTxUrl(unpauseSig)})

## Manual verification (filled in by operator)

Mark each row as ✓ (gate fired with ProtocolPaused), ✗ (no error or wrong error), or — (not attempted):

| Instruction | Expected | Observed |
|---|---|---|
| \`create_pool\` | ProtocolPaused | _ |
| \`join_pool\` | ProtocolPaused | _ |
| \`contribute\` | ProtocolPaused | _ |
| \`claim_payout\` | ProtocolPaused | _ |
| \`release_escrow\` | ProtocolPaused | _ |
| \`deposit_idle_to_yield\` | ProtocolPaused | _ |
| \`harvest_yield\` | ProtocolPaused | _ |
| \`escape_valve_list\` | ProtocolPaused | _ |
| \`escape_valve_buy\` | ProtocolPaused | _ |
| \`settle_default\` | NOT ProtocolPaused | _ |

## Notes

(Operator: fill in any anomalies observed during the drill. If anything other than ✓ on rows 1-9 or anything-but-ProtocolPaused on row 10, file a follow-up issue tagged \`security\` + cross-link this log.)
`;
  writeFileSync(logPath, body);
  console.log(`  ✓ log: ${logPath}`);
  console.log("");
  console.log("Drill complete. Commit the log + fill the verification table.");
}

main().catch((err) => {
  console.error("");
  console.error("✗ Drill failed:", err.message ?? err);
  console.error("");
  console.error("If pause fired but unpause did NOT, the protocol is STILL PAUSED.");
  console.error("Use emergency-response.md procedure to unpause manually.");
  process.exit(1);
});
