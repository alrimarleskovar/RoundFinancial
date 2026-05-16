/**
 * `BankrunEnvCompat` — bankrun env shaped to satisfy the same `Env`
 * interface that `tests/_harness/env.ts` exposes.
 *
 * **Why this exists.** The existing harness helpers (`createPool`,
 * `joinMembers`, `contribute`, `claimPayout`, `releaseEscrow`,
 * `fundUsdc`, `createUsdcMint`, `balanceOf`, `ensureAta`, …) are all
 * typed against the localnet `Env`. They use `env.connection` for
 * SPL-token operations (`createMint`, `mintTo`, `getAccount`) and for
 * idempotency checks (`getAccountInfo`). `BankrunProvider.connection`
 * is a `BankrunConnectionProxy` that implements only 3 methods
 * (`getAccountInfo`, `getAccountInfoAndContext`,
 * `getMinimumBalanceForRentExemption`). Anything else throws.
 *
 * This adapter wraps `BankrunEnv` and adds the missing Connection
 * surface so that any helper written for `Env` works against the
 * bankrun runtime without modification. The shim routes blockhash,
 * transaction send, and confirmation through `BanksClient`.
 *
 * **What's stubbed and why.** Bankrun has no fees, no leader schedule,
 * no actual finality — so airdrops are emulated by direct
 * `context.setAccount` lamport bumps, and `confirmTransaction`
 * always returns success (banksClient.processTransaction is already
 * synchronous and either succeeds or throws). Methods that have no
 * meaningful bankrun analogue (`getRecentPerformanceSamples`, slot
 * leadership, etc.) throw with a clear "unsupported in bankrun" so a
 * helper that depends on them surfaces the gap immediately rather
 * than silently returning empty data.
 *
 * **Use.**
 *
 *   import { setupBankrunEnvCompat } from "./_harness/bankrun_compat";
 *   const env = await setupBankrunEnvCompat();
 *   // env now satisfies the Env interface — pass it to any helper.
 *
 *   // Bankrun-specific clock warp still available:
 *   await setBankrunUnixTs(env.context, futureTimestamp);
 *
 * Helpers that hit a non-shimmed Connection method will throw with a
 * pointer back to this file; extend the shim there.
 */

import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  AccountInfo,
  Commitment,
  ConfirmedTransactionMeta,
  Connection,
  Keypair,
  PublicKey,
  RpcResponseAndContext,
  SignatureResult,
  SimulatedTransactionResponse,
  Transaction,
  TransactionSignature,
  VersionedTransaction,
} from "@solana/web3.js";
import { BankrunProvider } from "anchor-bankrun";
import { BanksClient, ProgramTestContext } from "solana-bankrun";

import type { Env } from "./env.js";
import { setupBankrunEnv, type BankrunEnv } from "./bankrun.js";

/**
 * `BankrunEnvCompat` extends `BankrunEnv` with the `connection` field
 * required by `Env`. Programs and provider are re-typed where the
 * cast is sound (the BankrunProvider satisfies the `Provider` interface
 * Anchor's `Program` actually needs).
 */
export interface BankrunEnvCompat extends Env {
  /** Bankrun-specific runtime context — exposed for `setBankrunUnixTs` etc. */
  readonly context: ProgramTestContext;
}

/**
 * Bootstrap a bankrun env that satisfies the `Env` interface.
 *
 * Returns an object that you can pass to ANY harness helper typed
 * against `Env` — `createPool`, `joinMembers`, `contribute`, etc.
 * Behind the scenes, calls route through `BanksClient` instead of an
 * RPC connection, so clock-warpable specs (`setBankrunUnixTs`) become
 * possible without losing the helper layer.
 */
export async function setupBankrunEnvCompat(): Promise<BankrunEnvCompat> {
  const bankrunEnv = await setupBankrunEnv();
  return wrapBankrunEnv(bankrunEnv);
}

function wrapBankrunEnv(bankrunEnv: BankrunEnv): BankrunEnvCompat {
  const connection = new BankrunConnectionShim(
    bankrunEnv.context.banksClient,
    bankrunEnv.context,
  ) as unknown as Connection;

  // BankrunProvider implements the Anchor Provider interface but isn't
  // an AnchorProvider class instance. Cast is sound for every helper
  // path we exercise (`.methods.X.rpc()`, `.account.Y.fetch()`).
  const provider = bankrunEnv.provider as unknown as AnchorProvider;

  // Re-bind programs so each has the shimmed provider — keeps
  // `program.methods.foo(...).rpc()` and `program.account.bar.fetch()`
  // routing through bankrun's BanksClient end-to-end.
  const reboundPrograms = {
    core: new Program(bankrunEnv.programs.core.idl, provider),
    reputation: new Program(bankrunEnv.programs.reputation.idl, provider),
    yieldMock: new Program(bankrunEnv.programs.yieldMock.idl, provider),
  };

  return {
    connection,
    provider,
    payer: bankrunEnv.payer,
    programs: reboundPrograms,
    ids: bankrunEnv.ids,
    context: bankrunEnv.context,
  };
}

/**
 * Connection-over-BanksClient shim.
 *
 * Implements the subset of `Connection` the harness helpers actually
 * use. Everything routes through `BanksClient` — no real RPC traffic.
 *
 * Method-by-method status:
 *   - getAccountInfo / getAccountInfoAndContext: ✓ (returns null on
 *     missing, NOT throws — matches @solana/web3.js semantics)
 *   - getBalance: ✓ (lamports from getAccountInfo)
 *   - getMinimumBalanceForRentExemption: ✓ (via banksClient.getRent)
 *   - getLatestBlockhash / getLatestBlockhashAndContext: ✓
 *   - sendRawTransaction / sendTransaction: ✓ (processTransaction)
 *   - confirmTransaction: ✓ (no-op success — bankrun is synchronous)
 *   - simulateTransaction: ✓ (banksClient.simulateTransaction)
 *   - requestAirdrop: ✓ (direct setAccount lamport bump)
 *   - getSlot: ✓ (banksClient.getSlot)
 *   - getRecentBlockhash (legacy): ✓ — delegates to getLatestBlockhash
 *
 * Everything else throws `Unsupported in bankrun: <method>` so a
 * caller that depends on a non-shimmed method surfaces the gap
 * immediately rather than silently breaking.
 */
class BankrunConnectionShim {
  // BanksClient handle + context for setAccount during airdrops.
  constructor(
    private banksClient: BanksClient,
    private context: ProgramTestContext,
  ) {}

  /** Connection-compat: rpcEndpoint is read by some Anchor internals. */
  get rpcEndpoint(): string {
    return "bankrun://in-memory";
  }

  /** Returns null when the account doesn't exist, matching web3.js. */
  async getAccountInfo(
    publicKey: PublicKey,
    _commitment?: Commitment,
  ): Promise<AccountInfo<Buffer> | null> {
    const info = await this.banksClient.getAccount(publicKey);
    if (!info) return null;
    return {
      executable: info.executable,
      owner: new PublicKey(info.owner),
      lamports: Number(info.lamports),
      data: Buffer.from(info.data),
      rentEpoch: Number(info.rentEpoch),
    };
  }

  async getAccountInfoAndContext(
    publicKey: PublicKey,
    _commitment?: Commitment,
  ): Promise<RpcResponseAndContext<AccountInfo<Buffer> | null>> {
    const slot = Number(await this.banksClient.getSlot());
    const value = await this.getAccountInfo(publicKey);
    return { context: { slot }, value };
  }

  async getBalance(publicKey: PublicKey, _commitment?: Commitment): Promise<number> {
    const info = await this.getAccountInfo(publicKey);
    return info?.lamports ?? 0;
  }

  async getMinimumBalanceForRentExemption(
    dataLength: number,
    _commitment?: Commitment,
  ): Promise<number> {
    const rent = await this.banksClient.getRent();
    return Number(rent.minimumBalance(BigInt(dataLength)));
  }

  async getLatestBlockhash(_commitment?: Commitment): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const res = await this.banksClient.getLatestBlockhash();
    if (!res) throw new Error("bankrun: getLatestBlockhash returned null");
    const [blockhash, lastValid] = res;
    return { blockhash, lastValidBlockHeight: Number(lastValid) };
  }

  async getLatestBlockhashAndContext(
    _commitment?: Commitment,
  ): Promise<RpcResponseAndContext<{ blockhash: string; lastValidBlockHeight: number }>> {
    const slot = Number(await this.banksClient.getSlot());
    const value = await this.getLatestBlockhash();
    return { context: { slot }, value };
  }

  /** Legacy API used by some older spl-token paths. */
  async getRecentBlockhash(): Promise<{
    blockhash: string;
    feeCalculator: { lamportsPerSignature: number };
  }> {
    const { blockhash } = await this.getLatestBlockhash();
    return { blockhash, feeCalculator: { lamportsPerSignature: 5000 } };
  }

  async getSlot(_commitment?: Commitment): Promise<number> {
    return Number(await this.banksClient.getSlot());
  }

  async sendRawTransaction(
    rawTransaction: Buffer | Uint8Array | number[],
    _options?: unknown,
  ): Promise<TransactionSignature> {
    // Reconstruct the tx so banksClient can introspect it. processTransaction
    // accepts a Transaction or a VersionedTransaction; we always send legacy.
    const buf = Buffer.isBuffer(rawTransaction)
      ? rawTransaction
      : Buffer.from(rawTransaction as Uint8Array);
    const tx = Transaction.from(buf);
    const meta = await this.banksClient.processTransaction(tx);
    void meta;
    // Use the first signature as the synthetic "signature" return value.
    return tx.signature ? tx.signature.toString("base64") : "bankrun-tx";
  }

  /**
   * `Connection.sendTransaction` semantics: for a legacy Transaction
   * without nonceInfo, the real Connection fetches the latest
   * blockhash, sets it on the tx, signs with the provided signers,
   * then sends. We mirror that here so spl-token / generic
   * sendAndConfirmTransaction callers work transparently.
   *
   * VersionedTransaction is expected to come fully formed (already
   * signed + has a blockhash) — bypass the prep and just process.
   */
  async sendTransaction(
    transaction: Transaction | VersionedTransaction,
    signersOrOptions?: unknown,
    _options?: unknown,
  ): Promise<TransactionSignature> {
    if (transaction instanceof Transaction) {
      const signers = Array.isArray(signersOrOptions)
        ? (signersOrOptions as Array<{ publicKey: PublicKey; secretKey: Uint8Array }>)
        : [];
      if (!transaction.recentBlockhash) {
        const { blockhash } = await this.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
      }
      if (!transaction.feePayer && signers.length > 0) {
        transaction.feePayer = signers[0]!.publicKey;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (signers.length > 0) transaction.sign(...(signers as any));
      await this.banksClient.processTransaction(transaction);
      return transaction.signature ? transaction.signature.toString("base64") : "bankrun-tx";
    }
    // VersionedTransaction: assume caller already prepped it.
    await this.banksClient.processTransaction(transaction);
    return "bankrun-tx";
  }

  async simulateTransaction(
    transaction: Transaction | VersionedTransaction,
    _signersOrConfig?: unknown,
    _includeAccounts?: unknown,
  ): Promise<RpcResponseAndContext<SimulatedTransactionResponse>> {
    const meta = await this.banksClient.simulateTransaction(transaction as Transaction);
    const slot = Number(await this.banksClient.getSlot());
    const logs = meta.meta?.logMessages ?? [];
    const err = meta.result ? { Custom: meta.result } : null;
    return {
      context: { slot },
      value: {
        err,
        logs,
        accounts: null,
        unitsConsumed: meta.meta?.computeUnitsConsumed ? Number(meta.meta.computeUnitsConsumed) : 0,
        returnData: null,
      } as SimulatedTransactionResponse,
    };
  }

  /**
   * `confirmTransaction` is a no-op in bankrun — `processTransaction`
   * is synchronous and either succeeds or throws. Returning success
   * here matches the web3.js shape so callers can `.then(...)` it.
   */
  async confirmTransaction(
    _signatureOrStrategy: unknown,
    _commitment?: Commitment,
  ): Promise<RpcResponseAndContext<SignatureResult>> {
    const slot = Number(await this.banksClient.getSlot());
    return { context: { slot }, value: { err: null } };
  }

  /**
   * Bankrun airdrop — bump the recipient's lamports via setAccount.
   * Returns a placeholder signature string for compat with web3.js.
   */
  async requestAirdrop(to: PublicKey, lamports: number): Promise<TransactionSignature> {
    const existing = await this.banksClient.getAccount(to);
    const currentLamports = existing ? Number(existing.lamports) : 0;
    const owner = existing
      ? new PublicKey(existing.owner)
      : new PublicKey("11111111111111111111111111111111");
    const data: Uint8Array = existing ? new Uint8Array(existing.data) : new Uint8Array(0);
    const rentEpoch = existing ? Number(existing.rentEpoch) : 0;
    const executable = existing ? existing.executable : false;
    this.context.setAccount(to, {
      lamports: currentLamports + lamports,
      data,
      owner,
      executable,
      rentEpoch,
    });
    return "bankrun-airdrop";
  }

  /**
   * Other Connection methods throw with a clear "unsupported" message
   * so callers find the gap quickly. Extend BankrunConnectionShim above
   * when a new method becomes needed.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [name: string]: any;
}

// Provide a meaningful prototype guard for the bracket-indexed catch-all
// so unrecognised methods fail loudly instead of returning `undefined`.
Object.setPrototypeOf(
  BankrunConnectionShim.prototype,
  new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "string" && !prop.startsWith("__")) {
          return () => {
            throw new Error(
              `Unsupported in bankrun connection shim: ${String(prop)}. ` +
                `Extend tests/_harness/bankrun_compat.ts:BankrunConnectionShim ` +
                `to add this method, routing it through banksClient.`,
            );
          };
        }
        return undefined;
      },
    },
  ),
);

// Re-export the bankrun-specific clock warp helper for spec
// convenience — keeps imports symmetric with `setupEnv` / `resetEnv`
// from the localnet harness.
export { setBankrunUnixTs } from "./bankrun.js";
