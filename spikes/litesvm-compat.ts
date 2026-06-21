/**
 * SEV-012 port — increment 2b-step2: the SPL-JS path through a litesvm
 * Connection shim (port of bankrun_compat's shim).
 *
 * The join_pool harness reuses the existing helpers (createUsdcMint /
 * fundUsdc / createPool / joinMembers), which drive @solana/spl-token's
 * `createMint`/`mintTo` through `env.connection`. Those use the
 * Connection send path (getLatestBlockhash → sendRawTransaction →
 * confirmTransaction) + getMinimumBalanceForRentExemption. This spike
 * ports that shim onto litesvm 1.1.0 (using the proven primitives:
 * setAccount/getAccount kit shape + v1→v2 tx bridge) and proves
 * `createMint` executes — i.e. the SPL Token program runs and the JS
 * helper path works. That's the last unknown before the full join_pool
 * round-trip.
 *
 * Standalone spike. Prereqs:
 *   pnpm add -D -w litesvm@^1.1.0 @solana/transactions@6.9.0
 *   pnpm tsx spikes/litesvm-compat.ts
 */

import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { createMint, getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";

function hr(t: string): void {
  console.log(`\n━━━ ${t} ━━━`);
}

async function main(): Promise<void> {
  hr("SEV-012 port — increment 2b-step2: SPL path via litesvm Connection shim");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let LiteSVM: new () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txMod: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ LiteSVM } = (await import("litesvm")) as unknown as { LiteSVM: new () => any });
    txMod = await import("@solana/transactions").catch(
      () => import("@solana/transactions/dist/index.node.cjs"),
    );
  } catch (e) {
    console.error(`\n✗ import failed: ${(e as Error)?.message ?? e}\n`);
    process.exit(2);
  }
  const txDecoder = (txMod.getTransactionDecoder ?? txMod.getTransactionCodec)();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svm: any = new LiteSVM();

  const payer = Keypair.generate();
  svm.airdrop(payer.publicKey.toBase58(), 1_000_000_000_000n);
  console.log(`payer: ${payer.publicKey.toBase58()}`);

  // ── Connection shim (port of bankrun_compat) ──
  // Routes the @solana/spl-token JS path through litesvm. Only the
  // methods createMint/mintTo actually call are implemented.
  // web3.js sendAndConfirmTransaction calls connection.sendTransaction(tx,
  // signers) expecting the connection to set the blockhash + sign. So the
  // shim does that (mirrors the provider's sendAndConfirm), then bridges
  // v1→v2 and hands to litesvm.
  const sendV1 = (tx: Transaction, signers: Keypair[]): string => {
    tx.recentBlockhash = svm.latestBlockhash();
    if (!tx.feePayer) tx.feePayer = signers[0]?.publicKey ?? payer.publicKey;
    if (signers.length) tx.sign(...signers);
    const wire = tx.serialize();
    const v2 = txDecoder.decode(wire);
    const res = svm.sendTransaction(v2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = res as any;
    if (r && typeof r.err === "function" && r.err()) {
      throw new Error(`litesvm tx failed: ${JSON.stringify(r.err())} logs=${r.logs?.()}`);
    }
    const sig = tx.signatures?.[0]?.signature;
    return sig ? bs58encode(sig) : "litesvm-sig";
  };

  const shim = {
    rpcEndpoint: "litesvm",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getAccountInfo: async (pk: PublicKey): Promise<any> => {
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
    },
    getMinimumBalanceForRentExemption: async (span: number): Promise<number> =>
      Number(svm.minimumBalanceForRentExemption(BigInt(span))),
    getLatestBlockhash: async () => ({
      blockhash: svm.latestBlockhash(),
      lastValidBlockHeight: 0,
    }),
    getLatestBlockhashAndContext: async () => ({
      context: { slot: 0 },
      value: { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 0 },
    }),
    getRecentBlockhash: async () => ({
      blockhash: svm.latestBlockhash(),
      feeCalculator: { lamportsPerSignature: 5000 },
    }),
    getSlot: async () => 0,
    // sendRawTransaction receives a fully-signed serialized legacy tx.
    sendRawTransaction: async (raw: Uint8Array | Buffer): Promise<string> => {
      const v2 = txDecoder.decode(raw instanceof Buffer ? new Uint8Array(raw) : raw);
      const res = svm.sendTransaction(v2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = res as any;
      if (r && typeof r.err === "function" && r.err()) {
        throw new Error(`litesvm tx failed: ${JSON.stringify(r.err())} logs=${r.logs?.()}`);
      }
      return "litesvm-sig";
    },
    sendTransaction: async (
      tx: Transaction | VersionedTransaction,
      signers: Keypair[] = [],
    ): Promise<string> => {
      if (tx instanceof Transaction) return sendV1(tx, signers);
      // versioned: already signed; encode + send
      const res = svm.sendTransaction(tx);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = res as any;
      if (r && typeof r.err === "function" && r.err())
        throw new Error("litesvm versioned tx failed");
      return "litesvm-sig";
    },
    confirmTransaction: async () => ({ context: { slot: 0 }, value: { err: null } }),
  };

  hr("1. createMint through the shim (exercises SPL Token program + JS path)");
  const connection = shim as unknown as Connection;
  let mint: PublicKey;
  try {
    mint = await createMint(connection, payer, payer.publicKey, null, 6);
    console.log(`✓ createMint executed — mint: ${mint.toBase58()}`);
  } catch (e) {
    console.error(`\n✗ createMint failed: ${(e as Error)?.message ?? e}`);
    console.error((e as Error)?.stack ?? e);
    console.error(
      `\n  If it's 'unsupported program id' for the SPL Token program, litesvm\n` +
        `  needs it loaded (it may not be built-in). Paste this and I'll add the load.\n`,
    );
    process.exit(1);
  }

  hr("2. read the mint back via getMint (uses the shim getAccountInfo)");
  try {
    const info = await getMint(connection, mint);
    console.log(`✓ getMint: decimals=${info.decimals}, supply=${info.supply}`);
    if (info.decimals !== 6) throw new Error("decimals mismatch");
  } catch (e) {
    console.error(`\n✗ getMint failed: ${(e as Error)?.message ?? e}`);
    process.exit(1);
  }

  hr("VERDICT");
  console.log(
    "✅ SPL-JS PATH WORKS through the litesvm Connection shim — createMint\n" +
      "   executed (SPL Token program runs) and getMint round-trips. The\n" +
      "   existing createUsdcMint/fundUsdc/createPool/joinMembers helpers can\n" +
      "   now run on a litesvm Env. Next: assemble the Env + load mpl_core,\n" +
      "   run join_pool, confirm the CreateV2 CPI (the gold standard).\n",
  );
  void TOKEN_PROGRAM_ID;
}

// Minimal base58 (avoid extra dep) for signature display only.
function bs58encode(bytes: Uint8Array): string {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) {
    s = A[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) s = "1" + s;
    else break;
  }
  return s || "1";
}

main().catch((e) => {
  console.error("\n✗ spike crashed:", e);
  process.exit(1);
});
