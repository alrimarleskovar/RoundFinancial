/**
 * litesvm-backed `Env` — runs the mpl_core-path specs (join_pool /
 * escape_valve_buy → lifecycle, economic_parity, edge_grace_default)
 * that `solana-bankrun` cannot, because litesvm loads the current
 * mainnet SBFv2 `mpl_core.so` that `solana-program-test 1.18` panics on
 * (SEV-012). Validated end-to-end in `spikes/litesvm-*.ts`.
 *
 * **How it works.** litesvm 1.x is web3.js-v2/kit-native, while this repo
 * is on anchor 0.30.1 + web3.js v1. The bridge is a thin, one-point
 * conversion (no library-grade adapter):
 *   - a custom anchor `Provider` whose `sendAndConfirm` signs the v1
 *     `Transaction`, serializes it, and decodes the SHARED wire bytes
 *     into a v2 transaction via `@solana/transactions` `getTransactionDecoder`
 *     before handing it to `svm.sendTransaction`;
 *   - a Connection shim that maps litesvm's kit account shape
 *     (`programAddress`/`data`) → v1 `AccountInfo`, plus the SPL-JS send
 *     path (`getLatestBlockhash` → `sendTransaction`/`sendRawTransaction`
 *     → `confirmTransaction`, `getMinimumBalanceForRentExemption`,
 *     `requestAirdrop`) so `@solana/spl-token` helpers work.
 *
 * The returned object satisfies the `Env` interface, so every existing
 * harness helper (`createUsdcMint`, `initializeProtocol`, `createPool`,
 * `joinMembers`, …) runs unchanged.
 *
 * Requires `litesvm` + `@solana/transactions` (devDeps) and, on disk,
 * `target/idl/*.json` + `target/deploy/*.so` (`anchor build`) and
 * `target/deploy/mpl_core.so`
 * (`solana program dump -u mainnet-beta CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d target/deploy/mpl_core.so`).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

import type { Env } from "./env.js";

/** Metaplex Core — same address on every cluster. */
export const METAPLEX_CORE_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

export interface LitesvmEnv extends Env {
  /** The raw litesvm instance — for clock warp (`setClock`) etc. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly svm: any;
}

const DEPLOY = (n: string): string => resolve(process.cwd(), "target", "deploy", `${n}.so`);
const IDL = (n: string): string => resolve(process.cwd(), "target", "idl", `${n}.json`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadIdl(n: string): any {
  const p = IDL(n);
  if (!existsSync(p)) {
    throw new Error(`IDL not found: ${p}. Run 'anchor build' before the litesvm harness.`);
  }
  return JSON.parse(readFileSync(p, "utf-8"));
}

/**
 * Boot a litesvm `Env` with the 4 workspace programs + mpl_core loaded
 * (SPL Token + ATA are built into litesvm). The payer is funded with 1000
 * SOL. Pass it to any helper typed against `Env`.
 */
export async function setupLitesvmEnv(): Promise<LitesvmEnv> {
  if (!existsSync(DEPLOY("mpl_core"))) {
    throw new Error(
      `target/deploy/mpl_core.so missing. Dump it:\n` +
        `  solana program dump -u mainnet-beta ${METAPLEX_CORE_ID} target/deploy/mpl_core.so`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { LiteSVM } = (await import("litesvm")) as unknown as { LiteSVM: new () => any };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txMod: any = await import("@solana/transactions").catch(
    () => import("@solana/transactions/dist/index.node.cjs"),
  );
  const txDecoder = (txMod.getTransactionDecoder ?? txMod.getTransactionCodec)();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svm: any = new LiteSVM();

  const coreIdl = loadIdl("roundfi_core");
  const repIdl = loadIdl("roundfi_reputation");
  const ymIdl = loadIdl("roundfi_yield_mock");
  svm.addProgramFromFile(coreIdl.address, DEPLOY("roundfi_core"));
  svm.addProgramFromFile(repIdl.address, DEPLOY("roundfi_reputation"));
  svm.addProgramFromFile(ymIdl.address, DEPLOY("roundfi_yield_mock"));
  svm.addProgramFromFile(METAPLEX_CORE_ID, DEPLOY("mpl_core"));

  const payer = Keypair.generate();
  svm.airdrop(payer.publicKey.toBase58(), 1_000_000_000_000n);

  // Sign a v1 tx with the fee-payer + extra signers, then bridge v1→v2
  // and submit. litesvm 1.x's sendTransaction asserts a v2 (kit) tx; the
  // wire format is shared, so decode the signed legacy bytes into a v2 tx.
  const submit = (tx: Transaction, signers: Keypair[]): string => {
    tx.recentBlockhash = svm.latestBlockhash();
    if (!tx.feePayer) tx.feePayer = payer.publicKey;
    const uniq = new Map<string, Keypair>();
    for (const s of [payer, ...signers]) uniq.set(s.publicKey.toBase58(), s);
    tx.sign(...uniq.values());
    const res = svm.sendTransaction(txDecoder.decode(tx.serialize()));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = res as any;
    if (r && typeof r.err === "function" && r.err()) {
      let logs: string[] = [];
      try {
        logs = r.meta?.().logs?.() ?? [];
      } catch {
        /* ignore */
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e: any = new Error(`litesvm tx failed: ${String(r.err())}`);
      e.logs = logs;
      throw e;
    }
    return "litesvm-sig";
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getAccountInfo = async (pk: PublicKey): Promise<any> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let a: any;
    try {
      a = svm.getAccount(pk.toBase58());
    } catch {
      return null;
    }
    if (!a || a.exists === false || a.data == null) return null;
    return {
      data: Buffer.from(a.data),
      owner: new PublicKey(a.programAddress ?? a.owner),
      lamports: Number(a.lamports ?? 0),
      executable: !!a.executable,
      rentEpoch: Number(a.rentEpoch ?? 0),
    };
  };

  const connection = {
    rpcEndpoint: "litesvm",
    getAccountInfo,
    getAccountInfoAndContext: async (pk: PublicKey) => ({
      context: { slot: 0 },
      value: await getAccountInfo(pk),
    }),
    getMultipleAccountsInfo: async (pks: PublicKey[]) =>
      Promise.all(pks.map((pk) => getAccountInfo(pk))),
    getBalance: async (pk: PublicKey) => Number(svm.getBalance(pk.toBase58()) ?? 0),
    getMinimumBalanceForRentExemption: async (span: number) =>
      Number(svm.minimumBalanceForRentExemption(BigInt(span))),
    getLatestBlockhash: async () => ({ blockhash: svm.latestBlockhash(), lastValidBlockHeight: 0 }),
    getLatestBlockhashAndContext: async () => ({
      context: { slot: 0 },
      value: { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 0 },
    }),
    getRecentBlockhash: async () => ({
      blockhash: svm.latestBlockhash(),
      feeCalculator: { lamportsPerSignature: 5000 },
    }),
    getSlot: async () => 0,
    requestAirdrop: async (to: PublicKey, lamports: number) => {
      svm.airdrop(to.toBase58(), BigInt(lamports));
      return "litesvm-airdrop";
    },
    sendRawTransaction: async (raw: Uint8Array | Buffer) => {
      const res = svm.sendTransaction(
        txDecoder.decode(raw instanceof Buffer ? new Uint8Array(raw) : raw),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = res as any;
      if (r && typeof r.err === "function" && r.err())
        throw new Error(`litesvm raw tx failed: ${String(r.err())}`);
      return "litesvm-sig";
    },
    sendTransaction: async (tx: Transaction | VersionedTransaction, signers: Keypair[] = []) => {
      if (tx instanceof Transaction) return submit(tx, signers);
      const res = svm.sendTransaction(tx);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = res as any;
      if (r && typeof r.err === "function" && r.err())
        throw new Error("litesvm versioned tx failed");
      return "litesvm-sig";
    },
    confirmTransaction: async () => ({ context: { slot: 0 }, value: { err: null } }),
  } as unknown as Connection;

  const wallet = {
    publicKey: payer.publicKey,
    payer,
    signTransaction: async (tx: Transaction) => {
      tx.partialSign(payer);
      return tx;
    },
    signAllTransactions: async (txs: Transaction[]) => {
      txs.forEach((t) => t.partialSign(payer));
      return txs;
    },
  };
  const provider = {
    connection,
    publicKey: payer.publicKey,
    wallet,
    sendAndConfirm: async (tx: Transaction, signers: Keypair[] = []) => submit(tx, signers),
  } as unknown as anchor.AnchorProvider;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mkProgram = (idl: any) => new anchor.Program(idl, provider);

  return {
    svm,
    connection,
    provider,
    payer,
    programs: {
      core: mkProgram(coreIdl),
      reputation: mkProgram(repIdl),
      yieldMock: mkProgram(ymIdl),
    },
    ids: {
      core: new PublicKey(coreIdl.address),
      reputation: new PublicKey(repIdl.address),
      yieldMock: new PublicKey(ymIdl.address),
    },
  };
}
