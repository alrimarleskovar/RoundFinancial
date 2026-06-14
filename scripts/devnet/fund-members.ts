/**
 * Fund member USDC ATAs from the deployer wallet — fallback when the
 * Circle devnet faucet (https://faucet.circle.com) blocks the request
 * with a bot-detection challenge. Bypasses the faucet entirely by
 * transferring USDC directly from the deployer.
 *
 * Honours the same env knobs as `seed-members.ts` and `seed-cycle.ts`:
 *   POOL_SEED_ID, MEMBERS_TARGET, CREDIT_AMOUNT_USDC,
 *   INSTALLMENT_AMOUNT_USDC, CYCLES_TOTAL, MEMBER_INDEX_OFFSET.
 *
 * Target per member = stake (50% of credit, Lv1) + CYCLES_TOTAL ×
 * INSTALLMENT_AMOUNT_USDC. With the v52-runbook defaults
 * (credit=30, install=21, cycles=2) that's 15 + 42 = 57 USDC each.
 *
 * Idempotent: if a member already has ≥ target, skip. If only partial,
 * top-up the deficit. Aborts cleanly if the deployer is short on USDC
 * with a clear error telling you how much extra to faucet to the
 * deployer (1 hit at faucet.circle.com on the deployer wallet covers
 * most realistic shortfalls).
 *
 * SOL top-up is also included — each member needs ~0.05 SOL for tx
 * fees + Member PDA rent + NFT asset rent during join_pool.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { loadCluster } from "../../config/clusters.js";

const CREDIT_AMOUNT_BASE = process.env.CREDIT_AMOUNT_USDC
  ? BigInt(Math.round(Number(process.env.CREDIT_AMOUNT_USDC) * 1e6))
  : 30_000_000n;
const STAKE_BPS_LV1 = 5_000n;
const STAKE_AMOUNT_BASE = (CREDIT_AMOUNT_BASE * STAKE_BPS_LV1) / 10_000n;

const INSTALLMENT_AMOUNT_BASE = process.env.INSTALLMENT_AMOUNT_USDC
  ? BigInt(Math.round(Number(process.env.INSTALLMENT_AMOUNT_USDC) * 1e6))
  : 15_000_000n;

const CYCLES_TOTAL = process.env.CYCLES_TOTAL ? BigInt(process.env.CYCLES_TOTAL) : 3n;
const MEMBER_COUNT = process.env.MEMBERS_TARGET ? Number(process.env.MEMBERS_TARGET) : 3;
const MEMBER_INDEX_OFFSET = process.env.MEMBER_INDEX_OFFSET
  ? Number(process.env.MEMBER_INDEX_OFFSET)
  : 0;

const TARGET_USDC_BASE = STAKE_AMOUNT_BASE + CYCLES_TOTAL * INSTALLMENT_AMOUNT_BASE;
const MEMBER_SOL_BUDGET_LAMPORTS = 50_000_000n; // 0.05 SOL

const KEYPAIRS_DIR = resolve(process.cwd(), "keypairs");

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) throw new Error(`keypair not found at ${path}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8"))));
}

function loadMember(slot: number): Keypair {
  const path = resolve(KEYPAIRS_DIR, `member-${slot + MEMBER_INDEX_OFFSET}.json`);
  return loadKeypair(path);
}

async function ataBalance(conn: Connection, mint: PublicKey, owner: PublicKey): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  try {
    const acct = await getAccount(conn, ata, "confirmed");
    return acct.amount;
  } catch {
    return 0n;
  }
}

async function main() {
  const cluster = loadCluster();
  console.log(`\n━━━ RoundFi fund-members → ${cluster.name} (${cluster.rpcUrl}) ━━━\n`);

  if (cluster.name === "mainnet-beta") {
    throw new Error("Refusing to fund on mainnet — this is a devnet helper.");
  }

  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  const deployer = loadKeypair(walletPath);
  const usdcMint = cluster.usdcMint;
  const conn = new Connection(cluster.rpcUrl, "confirmed");

  console.log(`→ Deployer     : ${deployer.publicKey.toBase58()}`);
  console.log(`→ USDC mint    : ${usdcMint.toBase58()}`);
  console.log(`→ Member count : ${MEMBER_COUNT}`);
  console.log(`→ Per-member target: ${(Number(TARGET_USDC_BASE) / 1e6).toFixed(2)} USDC`);
  console.log(
    `   = ${(Number(STAKE_AMOUNT_BASE) / 1e6).toFixed(2)} stake (Lv1) + ` +
      `${CYCLES_TOTAL} × ${(Number(INSTALLMENT_AMOUNT_BASE) / 1e6).toFixed(2)} installments\n`,
  );

  // 1. Snapshot deployer state.
  const deployerSol = BigInt(await conn.getBalance(deployer.publicKey));
  const deployerUsdc = await ataBalance(conn, usdcMint, deployer.publicKey);
  console.log(`Deployer balances:`);
  console.log(`  SOL : ${(Number(deployerSol) / 1e9).toFixed(4)}`);
  console.log(`  USDC: ${(Number(deployerUsdc) / 1e6).toFixed(2)}\n`);

  // 2. Compute deficits per member.
  type Deficit = { slot: number; member: Keypair; solDeficit: bigint; usdcDeficit: bigint };
  const deficits: Deficit[] = [];

  console.log(`Member balances + deficits:`);
  for (let slot = 0; slot < MEMBER_COUNT; slot++) {
    const member = loadMember(slot);
    const sol = BigInt(await conn.getBalance(member.publicKey));
    const usdc = await ataBalance(conn, usdcMint, member.publicKey);
    const solDeficit = sol >= MEMBER_SOL_BUDGET_LAMPORTS ? 0n : MEMBER_SOL_BUDGET_LAMPORTS - sol;
    const usdcDeficit = usdc >= TARGET_USDC_BASE ? 0n : TARGET_USDC_BASE - usdc;
    console.log(
      `  member ${slot}: ${member.publicKey.toBase58()}\n` +
        `    SOL  ${(Number(sol) / 1e9).toFixed(4)} (need ${(Number(MEMBER_SOL_BUDGET_LAMPORTS) / 1e9).toFixed(4)}) ` +
        `→ deficit ${(Number(solDeficit) / 1e9).toFixed(4)}\n` +
        `    USDC ${(Number(usdc) / 1e6).toFixed(2)} (need ${(Number(TARGET_USDC_BASE) / 1e6).toFixed(2)}) ` +
        `→ deficit ${(Number(usdcDeficit) / 1e6).toFixed(2)}`,
    );
    deficits.push({ slot, member, solDeficit, usdcDeficit });
  }

  const totalSolNeed = deficits.reduce((a, d) => a + d.solDeficit, 0n);
  const totalUsdcNeed = deficits.reduce((a, d) => a + d.usdcDeficit, 0n);

  if (totalSolNeed === 0n && totalUsdcNeed === 0n) {
    console.log(`\n✓ All members already fully funded. Nothing to do.\n`);
    return;
  }

  console.log(
    `\nTotal needed from deployer: ` +
      `${(Number(totalSolNeed) / 1e9).toFixed(4)} SOL + ` +
      `${(Number(totalUsdcNeed) / 1e6).toFixed(2)} USDC\n`,
  );

  // 3. Verify deployer can cover it (with 0.05 SOL safety margin for fees).
  if (deployerSol < totalSolNeed + 50_000_000n) {
    throw new Error(
      `Deployer SOL insufficient: has ${(Number(deployerSol) / 1e9).toFixed(4)}, ` +
        `needs ${(Number(totalSolNeed + 50_000_000n) / 1e9).toFixed(4)} (incl. fee margin). ` +
        `Run 'solana airdrop 2 ${deployer.publicKey.toBase58()} --url devnet' or use the SOL faucet.`,
    );
  }
  if (deployerUsdc < totalUsdcNeed) {
    const shortBy = totalUsdcNeed - deployerUsdc;
    throw new Error(
      `Deployer USDC insufficient: has ${(Number(deployerUsdc) / 1e6).toFixed(2)}, ` +
        `needs ${(Number(totalUsdcNeed) / 1e6).toFixed(2)} (short by ${(Number(shortBy) / 1e6).toFixed(2)}). ` +
        `Faucet the deployer at https://faucet.circle.com using ${deployer.publicKey.toBase58()} ` +
        `(${Math.ceil(Number(shortBy) / 10_000_000)} × 10-USDC hits), then re-run.`,
    );
  }

  // 4. Build a single transfer tx per member.
  const deployerUsdcAta = getAssociatedTokenAddressSync(usdcMint, deployer.publicKey);

  for (const d of deficits) {
    if (d.solDeficit === 0n && d.usdcDeficit === 0n) {
      console.log(`  ✓ member ${d.slot} already at target — skip`);
      continue;
    }
    const tx = new Transaction();

    if (d.solDeficit > 0n) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: deployer.publicKey,
          toPubkey: d.member.publicKey,
          lamports: d.solDeficit,
        }),
      );
    }

    if (d.usdcDeficit > 0n) {
      const memberAta = getAssociatedTokenAddressSync(usdcMint, d.member.publicKey);
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          deployer.publicKey,
          memberAta,
          d.member.publicKey,
          usdcMint,
        ),
        createTransferInstruction(
          deployerUsdcAta,
          memberAta,
          deployer.publicKey,
          d.usdcDeficit,
          [],
          TOKEN_PROGRAM_ID,
        ),
      );
    }

    const sig = await conn.sendTransaction(tx, [deployer], {
      preflightCommitment: "confirmed",
    });
    await conn.confirmTransaction(sig, "confirmed");
    console.log(
      `  ✓ member ${d.slot} funded ` +
        `(+${(Number(d.solDeficit) / 1e9).toFixed(4)} SOL, ` +
        `+${(Number(d.usdcDeficit) / 1e6).toFixed(2)} USDC) — sig ${sig}`,
    );
  }

  console.log(`\n✓ Funding complete. Re-run 'pnpm devnet:seed-members' to join the pool.\n`);
}

main().catch((err) => {
  console.error("\n✗ fund-members failed:");
  console.error(err);
  process.exit(1);
});
