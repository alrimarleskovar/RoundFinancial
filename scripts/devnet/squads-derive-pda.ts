/**
 * Squads v4 PDA-derivation utility for RoundFi pre-mainnet rehearsal.
 *
 * Squads v4 derives the multisig + vault PDA addresses deterministically
 * from a `create_key` pubkey + the Squads program ID. We need to know
 * these addresses BEFORE we transfer the upgrade authority on-chain
 * because:
 *
 *   - `solana program set-upgrade-authority` to a PDA is **one-way at
 *     the runtime level** — if you set the wrong address, the program is
 *     permanently locked under a key nobody controls.
 *   - The Squads UI shows the same addresses after multisig creation, so
 *     we compute them here independently to cross-check.
 *
 * The script does NOT submit any transactions — it only derives + prints.
 * Submitting the actual `solana program set-upgrade-authority` is a
 * separate, deliberate, hardware-wallet-confirmed step per the procedure
 * in `docs/operations/squads-multisig-procedure.md`.
 *
 * ## Usage
 *
 * ```bash
 * pnpm tsx scripts/devnet/squads-derive-pda.ts \
 *   --member <pubkey-1> \
 *   --member <pubkey-2> \
 *   --member <pubkey-3> \
 *   --threshold 2 \
 *   --create-key <create-key-pubkey>
 * ```
 *
 * `--create-key` is the unique seed pubkey Squads uses to derive the
 * multisig PDA. Each multisig has a different `create_key` so multiple
 * multisigs can coexist without colliding. In the Squads UI this is
 * auto-generated as a throwaway keypair at multisig-creation time;
 * record the pubkey from the UI and pass it here to reproduce the same
 * multisig address.
 *
 * `--threshold` and `--member` are echoed for clarity but do NOT affect
 * the PDA derivation (Squads' PDA seeds depend only on `create_key`).
 * They're sanity-printed so the operator can confirm the multisig's
 * member list / threshold against what they typed into the Squads UI.
 *
 * ## Squads v4 program ID
 *
 * Hard-coded below to the canonical mainnet deploy address. Same binary
 * is also deployed on devnet under the same program ID, so this script
 * works for both clusters without modification. **Re-verify against
 * Squads' published deploys page before mainnet ceremony.**
 *
 * See [Squads v4 deploys](https://github.com/Squads-Protocol/v4/blob/main/deploys.md).
 *
 * Closes (part of) items 3.6 + 3.7 of MAINNET_READINESS.md.
 */

import { PublicKey } from "@solana/web3.js";

// Squads v4 program ID — same on mainnet + devnet (Squads ships one
// binary). DO NOT change without explicit verification against the
// published deploys page. A re-pin pre-mainnet costs nothing.
const SQUADS_V4_PROGRAM_ID = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");

// Seed strings — Squads v4 uses these byte literals for PDA derivation.
// Cross-reference: https://github.com/Squads-Protocol/v4/blob/main/programs/squads_multisig_program/src/state/seeds.rs
const SEED_MULTISIG = Buffer.from("multisig");
const SEED_VAULT = Buffer.from("vault");

/** Derive a Squads v4 multisig account PDA from its create_key. */
function deriveMultisigPda(createKey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_MULTISIG, createKey.toBuffer()],
    SQUADS_V4_PROGRAM_ID,
  );
}

/** Derive a Squads v4 vault PDA at the given index for a multisig. */
function deriveVaultPda(multisig: PublicKey, vaultIndex: number = 0): [PublicKey, number] {
  const indexBuf = Buffer.alloc(1);
  indexBuf.writeUInt8(vaultIndex, 0);
  return PublicKey.findProgramAddressSync(
    [SEED_MULTISIG, multisig.toBuffer(), SEED_VAULT, indexBuf],
    SQUADS_V4_PROGRAM_ID,
  );
}

interface Args {
  members: PublicKey[];
  threshold: number;
  createKey: PublicKey;
  vaultIndex: number;
}

function parseArgs(argv: string[]): Args {
  const members: PublicKey[] = [];
  let threshold = 0;
  let createKey: PublicKey | null = null;
  let vaultIndex = 0;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--member": {
        const v = argv[++i];
        if (!v) throw new Error("--member requires a pubkey argument");
        members.push(new PublicKey(v));
        break;
      }
      case "--threshold": {
        const v = argv[++i];
        if (!v) throw new Error("--threshold requires a numeric argument");
        threshold = Number.parseInt(v, 10);
        if (!Number.isFinite(threshold) || threshold < 1) {
          throw new Error(`--threshold must be a positive integer (got: ${v})`);
        }
        break;
      }
      case "--create-key": {
        const v = argv[++i];
        if (!v) throw new Error("--create-key requires a pubkey argument");
        createKey = new PublicKey(v);
        break;
      }
      case "--vault-index": {
        const v = argv[++i];
        if (!v) throw new Error("--vault-index requires a numeric argument");
        vaultIndex = Number.parseInt(v, 10);
        if (!Number.isFinite(vaultIndex) || vaultIndex < 0 || vaultIndex > 255) {
          throw new Error(`--vault-index must be 0..=255 (got: ${v})`);
        }
        break;
      }
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown flag: ${a} (use --help to see options)`);
    }
  }

  if (members.length === 0) {
    throw new Error("at least one --member is required");
  }
  if (threshold === 0) {
    throw new Error("--threshold is required");
  }
  if (threshold > members.length) {
    throw new Error(`threshold (${threshold}) cannot exceed member count (${members.length})`);
  }
  if (!createKey) {
    throw new Error("--create-key is required");
  }

  return { members, threshold, createKey, vaultIndex };
}

function printUsage(): void {
  console.log(`
Squads v4 PDA derivation utility — RoundFi pre-mainnet rehearsal

USAGE:
  pnpm tsx scripts/devnet/squads-derive-pda.ts [options]

OPTIONS:
  --member <pubkey>      Multisig member pubkey (repeat for each member)
  --threshold <n>        Signature threshold (e.g. 3 for 3-of-5)
  --create-key <pubkey>  Unique create-key pubkey from Squads UI
  --vault-index <n>      Vault index to derive (default: 0)
  --help, -h             Print this message

EXAMPLE:
  pnpm tsx scripts/devnet/squads-derive-pda.ts \\
    --member 11111111111111111111111111111111 \\
    --member 22222222222222222222222222222222 \\
    --member 33333333333333333333333333333333 \\
    --threshold 2 \\
    --create-key AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA

Prints the deterministic Squads v4 multisig + vault PDA addresses.
NO transactions submitted — derivation only.

See docs/operations/squads-multisig-procedure.md for context.
`);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printUsage();
    process.exit(1);
  }

  const { members, threshold, createKey, vaultIndex } = parseArgs(argv);

  const [multisigPda, multisigBump] = deriveMultisigPda(createKey);
  const [vaultPda, vaultBump] = deriveVaultPda(multisigPda, vaultIndex);

  console.log("");
  console.log("━━━ Squads v4 PDA derivation ━━━");
  console.log("");
  console.log(`  Program ID    : ${SQUADS_V4_PROGRAM_ID.toBase58()}`);
  console.log(`  Members       : ${members.length}`);
  members.forEach((m, i) => console.log(`      [${i}]      : ${m.toBase58()}`));
  console.log(`  Threshold     : ${threshold}-of-${members.length}`);
  console.log(`  Create key    : ${createKey.toBase58()}`);
  console.log("");
  console.log("─── Derived addresses ─────────────────────────────────");
  console.log(`  Multisig PDA  : ${multisigPda.toBase58()}  (bump=${multisigBump})`);
  console.log(`  Vault PDA #${vaultIndex}  : ${vaultPda.toBase58()}  (bump=${vaultBump})`);
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("Cross-check the Vault PDA above against the address shown in the");
  console.log("Squads UI after multisig creation. If they DO NOT match, do not");
  console.log("proceed — your Squads v4 program ID or member-list ordering has");
  console.log("drifted from the canonical derivation.");
  console.log("");
  console.log("Once cross-checked, the Vault PDA is the address you'll pass to");
  console.log("`solana program set-upgrade-authority` and to the protocol's");
  console.log("`update_protocol_config { new_authority }` instruction per the");
  console.log("procedure in docs/operations/squads-multisig-procedure.md.");
  console.log("");
}

try {
  main();
} catch (err) {
  console.error(`\n✗ ${(err as Error).message}\n`);
  console.error("Run with --help for usage.\n");
  process.exit(1);
}
