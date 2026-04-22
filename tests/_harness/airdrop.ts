/**
 * SOL funding for test wallets.
 *
 * Localnet: `requestAirdrop` is unthrottled — this just hands out SOL
 * in parallel and confirms.
 *
 * Devnet: faucet-capped at 2 SOL/request; if a spec needs more, split
 * or fund from a pre-loaded treasury wallet instead. Tests on devnet
 * are rare — the primary target is localnet via `anchor test`.
 */

import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import type { Env } from "./env.js";

const DEFAULT_SOL = 10;

/**
 * Airdrop `amountSol` to one or more wallets. On localnet this is
 * fire-and-forget; on devnet the faucet may rate-limit.
 */
export async function airdrop(
  env: Env,
  wallets: PublicKey | PublicKey[],
  amountSol = DEFAULT_SOL,
): Promise<void> {
  const list = Array.isArray(wallets) ? wallets : [wallets];
  const lamports = amountSol * LAMPORTS_PER_SOL;
  const sigs = await Promise.all(
    list.map((w) => env.connection.requestAirdrop(w, lamports)),
  );
  await Promise.all(
    sigs.map((sig) => env.connection.confirmTransaction(sig, "confirmed")),
  );
}

/**
 * Fund wallets from the harness payer instead of the faucet.
 * Faster and doesn't hit faucet limits; useful for N>10 members.
 */
export async function fundFromPayer(
  env: Env,
  wallets: PublicKey | PublicKey[],
  amountSol = DEFAULT_SOL,
): Promise<void> {
  const list = Array.isArray(wallets) ? wallets : [wallets];
  const lamports = amountSol * LAMPORTS_PER_SOL;
  const tx = new Transaction();
  for (const to of list) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: env.payer.publicKey,
        toPubkey: to,
        lamports,
      }),
    );
  }
  await env.provider.sendAndConfirm(tx, [env.payer]);
}

/**
 * Ensure a list of keypairs each have at least `minSol`; tops them up
 * from the payer if they don't. Cheaper than unconditional airdrops
 * when the same specfile seeds multiple describe() blocks.
 */
export async function ensureFunded(
  env: Env,
  keypairs: Keypair[],
  minSol = 1,
): Promise<void> {
  const minLamports = minSol * LAMPORTS_PER_SOL;
  const balances = await Promise.all(
    keypairs.map((kp) => env.connection.getBalance(kp.publicKey)),
  );
  const underfunded = keypairs.filter((_, i) => (balances[i] ?? 0) < minLamports);
  if (underfunded.length === 0) return;
  await fundFromPayer(env, underfunded.map((kp) => kp.publicKey), minSol);
}
