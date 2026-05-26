/**
 * SEV-012 port — increment 2b-final: full litesvm Env + the real harness
 * helper chain → join_pool (the CreateV2 CPI gold standard).
 *
 * Assembles a litesvm-backed `Env` (custom anchor Provider + v1→v2 tx
 * bridge + Connection shim, all proven in the prior spikes) with the 4
 * programs loaded (core, reputation, yield_mock, mpl_core; SPL Token +
 * ATA are built into litesvm), then drives the EXISTING helpers:
 *   createUsdcMint → initializeProtocol → createPool → joinMembers
 *
 * create_pool CPIs into mpl_core to mint the pool Collection NFT, and
 * join_pool CPIs CreateV2 for the member position NFT — so a green
 * createPool already proves the mpl_core CPI executes under litesvm
 * (the SEV-012 gold standard); joinMembers adds the position-NFT CPI.
 *
 * Standalone spike. Prereqs:
 *   pnpm add -D -w litesvm@^1.1.0 @solana/transactions@6.9.0
 *   anchor build                       # target/idl + target/deploy
 *   solana program dump -u mainnet-beta CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d target/deploy/mpl_core.so
 *   pnpm tsx spikes/litesvm-joinpool.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

const MPL_CORE_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const DEPLOY = (n: string) => resolve(process.cwd(), "target", "deploy", `${n}.so`);
const IDL = (n: string) => resolve(process.cwd(), "target", "idl", `${n}.json`);

function hr(t: string): void {
  console.log(`\n━━━ ${t} ━━━`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadIdl(n: string): any {
  const p = IDL(n);
  if (!existsSync(p)) {
    console.error(`\n✗ IDL missing: ${p} — run 'anchor build'.\n`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(p, "utf-8"));
}

async function main(): Promise<void> {
  hr("SEV-012 port — increment 2b-final: litesvm Env × join_pool");

  if (!existsSync(DEPLOY("mpl_core"))) {
    console.error(
      `\n✗ target/deploy/mpl_core.so missing. Dump it:\n` +
        `  solana program dump -u mainnet-beta ${MPL_CORE_ID} target/deploy/mpl_core.so\n`,
    );
    process.exit(2);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let LiteSVM: new () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txMod: any;
  ({ LiteSVM } = (await import("litesvm")) as unknown as { LiteSVM: new () => any });
  txMod = await import("@solana/transactions").catch(
    () => import("@solana/transactions/dist/index.node.cjs"),
  );
  const txDecoder = (txMod.getTransactionDecoder ?? txMod.getTransactionCodec)();

  hr("1. boot litesvm + load programs (core, reputation, yield_mock, mpl_core)");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svm: any = new LiteSVM();
  const coreIdl = loadIdl("roundfi_core");
  const repIdl = loadIdl("roundfi_reputation");
  const ymIdl = loadIdl("roundfi_yield_mock");
  svm.addProgramFromFile(coreIdl.address, DEPLOY("roundfi_core"));
  svm.addProgramFromFile(repIdl.address, DEPLOY("roundfi_reputation"));
  svm.addProgramFromFile(ymIdl.address, DEPLOY("roundfi_yield_mock"));
  svm.addProgramFromFile(MPL_CORE_ID, DEPLOY("mpl_core"));
  console.log("✓ programs loaded");

  const payer = Keypair.generate();
  svm.airdrop(payer.publicKey.toBase58(), 1_000_000_000_000n);

  // ── provider tx send (v1 → v2 bridge) ──
  const sendV1 = (tx: Transaction, signers: Keypair[]): string => {
    tx.recentBlockhash = svm.latestBlockhash();
    // Fee payer is the provider wallet (anchor's default); the extra
    // .signers([...]) are ADDITIONAL required signers. Signing with payer
    // when it isn't the fee payer / a required signer → "unknown signer".
    if (!tx.feePayer) tx.feePayer = payer.publicKey;
    const uniq = new Map<string, Keypair>();
    for (const s of [payer, ...signers]) uniq.set(s.publicKey.toBase58(), s);
    tx.sign(...uniq.values());
    const v2 = txDecoder.decode(tx.serialize());
    const res = svm.sendTransaction(v2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = res as any;
    if (r && typeof r.err === "function" && r.err()) {
      const err = r.err();
      // FailedTransactionMetadata keeps logs under .meta().logs().
      let logs: string[] = [];
      try {
        logs = r.meta?.().logs?.() ?? r.logs?.() ?? [];
      } catch {
        /* ignore */
      }
      // Print directly — anchor's translateError needs err.logs to parse
      // the program error, and otherwise swallows it to a bare Error.
      console.error(`\n  ⛔ on-chain tx FAILED: ${String(err)}`);
      if (logs.length) {
        console.error("  program logs:\n    " + logs.join("\n    "));
      } else {
        const proto = Object.getPrototypeOf(r);
        console.error(
          "  (no logs via meta().logs(); FailedTransactionMetadata API: " +
            Object.getOwnPropertyNames(proto).join(", ") +
            ")",
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e: any = new Error(`litesvm tx failed: ${String(err)}`);
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

  const shim = {
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
      const v2 = txDecoder.decode(raw instanceof Buffer ? new Uint8Array(raw) : raw);
      const res = svm.sendTransaction(v2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = res as any;
      if (r && typeof r.err === "function" && r.err())
        throw new Error(`litesvm raw tx failed: ${JSON.stringify(r.err())}`);
      return "litesvm-sig";
    },
    sendTransaction: async (tx: Transaction | VersionedTransaction, signers: Keypair[] = []) => {
      if (tx instanceof Transaction) return sendV1(tx, signers);
      const res = svm.sendTransaction(tx);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = res as any;
      if (r && typeof r.err === "function" && r.err())
        throw new Error("litesvm versioned tx failed");
      return "litesvm-sig";
    },
    confirmTransaction: async () => ({ context: { slot: 0 }, value: { err: null } }),
  };
  const connection = shim as unknown as Connection;

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
    sendAndConfirm: async (tx: Transaction, signers: Keypair[] = []) => sendV1(tx, signers),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mkProgram = (idl: any) => new anchor.Program(idl, provider as any);
  const env = {
    connection,
    provider: provider as unknown as anchor.AnchorProvider,
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
  console.log("✓ litesvm Env assembled");

  // ── run the real helper chain ──
  const h = await import("../tests/_harness/index.js");

  const step = async (name: string, fn: () => Promise<unknown>) => {
    hr(name);
    try {
      const r = await fn();
      console.log(`✓ ${name}`);
      return r;
    } catch (e) {
      console.error(`\n✗ ${name} FAILED: ${(e as Error)?.message ?? e}`);
      console.error((e as Error)?.stack ?? e);
      process.exit(1);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env_ = env as any;
  const usdcMint = (await step("2. createUsdcMint", () =>
    h.createUsdcMint(env_, { forceFresh: true }),
  )) as PublicKey;
  console.log(`   usdc mint: ${usdcMint.toBase58?.() ?? usdcMint}`);

  await step("3. initializeProtocol", () => h.initializeProtocol(env_, { usdcMint }));

  const authority = Keypair.generate();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool = (await step("4. createPool (CPIs mpl_core CreateV2 for the Collection)", () =>
    h.createPool(env_, { authority, usdcMint, membersTarget: 2 }),
  )) as any;
  console.log("   ✓✓ mpl_core CreateV2 CPI EXECUTED under litesvm (collection minted)");

  const member = Keypair.generate();
  await step("5. joinMembers (CPIs CreateV2 for the member position NFT)", () =>
    h.joinMembers(env_, pool, [{ member }]),
  );

  hr("VERDICT");
  console.log(
    "✅✅ SEV-012 GOLD STANDARD MET — the mpl_core CreateV2 CPI executes under\n" +
      "   litesvm on anchor 0.30.1 (create_pool collection + join_pool position\n" +
      "   NFT both ran). The full mpl_core-path harness works. Next: promote\n" +
      "   this Env into tests/_harness/litesvm.ts + port a real spec into a CI\n" +
      "   lane (litesvm has NO mpl_core SBFv2 limitation, unlike bankrun).\n",
  );
}

main().catch((e) => {
  console.error("\n✗ spike crashed:", e);
  process.exit(1);
});
