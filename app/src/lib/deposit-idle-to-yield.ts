/**
 * IDL-free encoder + sender for the `roundfi-core::deposit_idle_to_yield`
 * instruction. Permissionless crank — anyone can dispatch it.
 *
 * `deposit_idle_to_yield` moves USDC from the pool's vault into the
 * configured yield adapter (Kamino on mainnet, mock on devnet). The
 * adapter's deposit CPI is dispatched from inside the handler; the
 * adapter program ID + adapter-side vault must be passed as accounts.
 *
 * Pre-conditions:
 *   - pool.status == Active,
 *   - pool.yield_adapter != Pubkey::default(),
 *   - pool_usdc_vault.amount >= amount (caller may pass less if
 *     they want partial deposit; adapter may cap further).
 *
 * Failure modes:
 *   - `PoolNotActive` — pool not in Active state
 *   - `YieldAdapterNotConfigured` — pool.yield_adapter is default
 *   - `ProtocolPaused` — emergency pause active
 *   - Adapter-side rejections surface via the CPI error code
 */

import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { protocolConfigPda } from "@roundfi/sdk/pda";

import { DEVNET_PROGRAM_IDS, DEVNET_USDC_MINT } from "./devnet";

// sha256("global:deposit_idle_to_yield")[:8] = de6af157e6a4128f
const DEPOSIT_IDLE_DISCRIMINATOR = Buffer.from([0xde, 0x6a, 0xf1, 0x57, 0xe6, 0xa4, 0x12, 0x8f]);

export interface BuildDepositIdleToYieldIxArgs {
  /** Pool PDA. */
  pool: PublicKey;
  /** Crank wallet — anyone can dispatch; pays the tx fee. */
  caller: PublicKey;
  /** USDC base units to move into the adapter (6 decimals). */
  amount: bigint | number;
  /** Adapter-side vault holding deposited principal. Authority is
   *  adapter-controlled; the program reads its balance pre/post-CPI
   *  to record the realized delta. */
  yieldVault: PublicKey;
  /** Adapter program ID — must match `pool.yield_adapter`. */
  yieldAdapterProgram: PublicKey;
}

/**
 * Build the raw `deposit_idle_to_yield(amount)` instruction.
 *
 * Account order MUST match `DepositIdleToYield<'info>` in
 * `programs/roundfi-core/src/instructions/deposit_idle_to_yield.rs`
 * (7 explicit accounts + remaining_accounts the adapter consumes).
 *
 * **Note on remaining_accounts:** Kamino-side deposit CPI consumes a
 * variable list of reserve / obligation / liquidity-mint accounts that
 * the adapter program forwards via `remaining_accounts`. This encoder
 * exposes only the 7 explicit accounts; the modal layer must extend
 * `keys[]` with adapter-specific accounts before signing. For the mock
 * adapter (`roundfi-yield-mock`), remaining_accounts is empty.
 */
export function buildDepositIdleToYieldIx(
  args: BuildDepositIdleToYieldIxArgs,
): TransactionInstruction {
  const core = DEVNET_PROGRAM_IDS.core;
  const usdcMint = DEVNET_USDC_MINT;

  const [config] = protocolConfigPda(core);
  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, args.pool, true);

  // [discriminator (8) | amount (u64 LE = 8)] = 16 bytes total.
  const amountBuf = Buffer.alloc(8);
  const amountBig = typeof args.amount === "bigint" ? args.amount : BigInt(args.amount);
  amountBuf.writeBigUInt64LE(amountBig, 0);
  const data = Buffer.concat([DEPOSIT_IDLE_DISCRIMINATOR, amountBuf]);

  return new TransactionInstruction({
    programId: core,
    data,
    keys: [
      { pubkey: args.caller, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: args.pool, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },
      { pubkey: args.yieldVault, isSigner: false, isWritable: true },
      { pubkey: args.yieldAdapterProgram, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

export interface SendDepositIdleToYieldArgs extends BuildDepositIdleToYieldIxArgs {
  connection: Connection;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
  /** Adapter-specific remaining_accounts (empty for mock adapter, full
   *  reserve/obligation list for real Kamino). Appended to keys[] after
   *  the 8 explicit accounts. */
  remainingAccounts?: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
}

export async function sendDepositIdleToYield(args: SendDepositIdleToYieldArgs): Promise<string> {
  const ix = buildDepositIdleToYieldIx(args);
  if (args.remainingAccounts && args.remainingAccounts.length > 0) {
    ix.keys.push(...args.remainingAccounts);
  }
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.caller;

  const signature = await args.sendTransaction(tx, args.connection);
  await args.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}
