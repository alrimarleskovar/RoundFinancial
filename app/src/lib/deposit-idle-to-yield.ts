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
import { simulateOrThrow } from "./simulateTx";

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
  /** Optional program ID override — for tests against a bankrun-deployed
   *  program set. Defaults to `DEVNET_PROGRAM_IDS`. */
  programIds?: { core: PublicKey };
  /** Optional USDC mint override — pairs with `programIds` for tests. */
  usdcMint?: PublicKey;
  /** Adapter-specific accounts forwarded to the adapter's deposit CPI via
   *  the instruction's `remaining_accounts`, appended after the 8 explicit
   *  accounts. The roundfi core handler passes everything past the 8th
   *  account straight through to the adapter in order, so this list must
   *  match what the adapter's `Deposit` accounts struct expects:
   *    - mock adapter (`roundfi-yield-mock`): `[state]` (the
   *      YieldVaultState PDA, seeds=[b"state", pool]).
   *    - Kamino adapter: the full reserve / obligation / liquidity-mint
   *      list its deposit CPI consumes.
   *  Defaults to empty — callers targeting a real adapter MUST supply it. */
  remainingAccounts?: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
}

/**
 * Build the raw `deposit_idle_to_yield(amount)` instruction.
 *
 * Account order MUST match `DepositIdleToYield<'info>` in
 * `programs/roundfi-core/src/instructions/deposit_idle_to_yield.rs`
 * (7 explicit accounts + remaining_accounts the adapter consumes).
 *
 * **Note on remaining_accounts:** the adapter's deposit CPI consumes a
 * variable list of accounts that the core handler forwards verbatim via
 * `remaining_accounts` (everything past the 8 explicit accounts). The
 * mock adapter needs exactly one — its `YieldVaultState` PDA; Kamino
 * needs the full reserve / obligation / liquidity-mint list. Pass them
 * via `args.remainingAccounts` (preferred) so a single call site builds
 * a complete instruction. They are appended after the 8 explicit
 * accounts; omitting them yields the bare 8-account form (only valid for
 * an adapter whose Deposit struct has no extra accounts).
 */
export function buildDepositIdleToYieldIx(
  args: BuildDepositIdleToYieldIxArgs,
): TransactionInstruction {
  const core = args.programIds?.core ?? DEVNET_PROGRAM_IDS.core;
  const usdcMint = args.usdcMint ?? DEVNET_USDC_MINT;

  const [config] = protocolConfigPda(core);
  const poolUsdcVault = getAssociatedTokenAddressSync(usdcMint, args.pool, true);

  // [discriminator (8) | amount (u64 LE = 8)] = 16 bytes total.
  const amountBuf = Buffer.alloc(8);
  const amountBig = typeof args.amount === "bigint" ? args.amount : BigInt(args.amount);
  amountBuf.writeBigUInt64LE(amountBig, 0);
  const data = Buffer.concat([DEPOSIT_IDLE_DISCRIMINATOR, amountBuf]);

  const keys = [
    { pubkey: args.caller, isSigner: true, isWritable: false },
    { pubkey: config, isSigner: false, isWritable: false },
    { pubkey: args.pool, isSigner: false, isWritable: true },
    { pubkey: usdcMint, isSigner: false, isWritable: false },
    { pubkey: poolUsdcVault, isSigner: false, isWritable: true },
    { pubkey: args.yieldVault, isSigner: false, isWritable: true },
    { pubkey: args.yieldAdapterProgram, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Adapter-specific accounts the core handler forwards to the adapter's
  // deposit CPI via remaining_accounts (e.g. the mock's YieldVaultState
  // PDA, or Kamino's reserve/obligation set). Appended after the 8
  // explicit accounts; empty by default.
  if (args.remainingAccounts && args.remainingAccounts.length > 0) {
    keys.push(...args.remainingAccounts);
  }

  return new TransactionInstruction({ programId: core, data, keys });
}

export interface SendDepositIdleToYieldArgs extends BuildDepositIdleToYieldIxArgs {
  connection: Connection;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
}

export async function sendDepositIdleToYield(args: SendDepositIdleToYieldArgs): Promise<string> {
  // `buildDepositIdleToYieldIx` already appends `args.remainingAccounts`
  // (the field is inherited from BuildDepositIdleToYieldIxArgs).
  const ix = buildDepositIdleToYieldIx(args);
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.caller;

  // Dry-run before the wallet signs — never sign a tx that will fail
  // on-chain (frontend-security checklist §2.2).
  await simulateOrThrow(args.connection, tx);

  const signature = await args.sendTransaction(tx, args.connection);
  await args.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}
