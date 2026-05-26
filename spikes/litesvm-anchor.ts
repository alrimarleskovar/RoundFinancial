/**
 * SEV-012 port — increment 1b: run a real anchor instruction through
 * LiteSVM 1.1.0 via a CUSTOM minimal provider (no anchor-litesvm).
 *
 * Why custom: anchor-litesvm 0.2.1 pins `@coral-xyz/anchor ^0.31.1` +
 * `litesvm ^0.3.3`, incompatible with this repo's anchor 0.30.1 and with
 * the SBFv2-capable litesvm 1.1.0. So we don't use it. Instead we lean on
 * the fact that litesvm 1.x's `sendTransaction` accepts a web3.js v1
 * `Transaction` (the earlier "value.split" issue was only on the pubkey
 * args of `airdrop`/`addProgramFromFile`, which want base58 strings).
 *
 * A minimal anchor Provider needs `publicKey`, `wallet`, and
 * `sendAndConfirm(tx, signers)` — anchor's `.rpc()` delegates to that.
 * We build the tx, set blockhash/feePayer, sign, and hand it to
 * `svm.sendTransaction`. If reputation `ping` runs, the anchor-over-
 * litesvm-1.1.0 foundation is proven and we build up to a join_pool
 * round-trip (increment 2) that exercises the mpl_core CPI.
 *
 * Standalone spike (spikes/ is outside the CI + tsconfig globs).
 *
 * ## Prerequisites
 *
 *   # anchor-litesvm must NOT be installed (it forces litesvm 0.3.x):
 *   pnpm remove anchor-litesvm 2>/dev/null || true
 *   pnpm add -D -w litesvm@^1.1.0
 *   pnpm add -D -w @solana/transactions@6.9.0   # v1→v2 tx bridge (match litesvm)
 *   anchor build                       # target/idl + target/deploy
 *   pnpm tsx spikes/litesvm-anchor.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

const REP_IDL_PATH = resolve(process.cwd(), "target", "idl", "roundfi_reputation.json");
const REP_SO_PATH = resolve(process.cwd(), "target", "deploy", "roundfi_reputation.so");

function hr(title: string): void {
  console.log(`\n━━━ ${title} ━━━`);
}

async function main(): Promise<void> {
  hr("SEV-012 port — increment 1b: custom provider × litesvm 1.1.0 × ping");

  for (const [label, p] of [
    ["reputation IDL", REP_IDL_PATH],
    ["reputation .so", REP_SO_PATH],
  ] as const) {
    if (!existsSync(p)) {
      console.error(`\n✗ ${label} not found at ${p}\n  Run 'anchor build' first.\n`);
      process.exit(2);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idl: any = JSON.parse(readFileSync(REP_IDL_PATH, "utf-8"));
  const programIdStr: string = idl.address;
  console.log(`reputation program id (from IDL): ${programIdStr}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let LiteSVM: new () => any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ LiteSVM } = (await import("litesvm")) as unknown as { LiteSVM: new () => any });
  } catch (e) {
    console.error(
      `\n✗ import litesvm failed: ${(e as Error)?.message ?? e}\n` +
        `  Ensure litesvm 1.x is installed and anchor-litesvm is NOT (it pins litesvm 0.3.x):\n` +
        `    pnpm remove anchor-litesvm; pnpm add -D -w litesvm@^1.1.0\n`,
    );
    process.exit(2);
  }

  hr("1. boot LiteSVM + load reputation .so");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svm: any = new LiteSVM();
  svm.addProgramFromFile(programIdStr, REP_SO_PATH); // id as base58 string (proven form)
  console.log("✓ reputation program loaded");

  hr("2. build a minimal custom anchor Provider over litesvm");
  const payer = Keypair.generate();
  // airdrop wants the address as a base58 string (proven form).
  svm.airdrop(payer.publicKey.toBase58(), 100_000_000_000n);
  console.log(`✓ payer funded: ${payer.publicKey.toBase58()}`);

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

  // Connection shim: anchor's program.account.X.fetch() calls
  // connection.getAccountInfo[AndContext]; map litesvm's v2 account shape
  // (owner = `programAddress`, data → bytes) → v1 AccountInfo.
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
      owner: new PublicKey(a.owner ?? a.programAddress),
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
  };

  const provider = {
    connection,
    publicKey: payer.publicKey,
    wallet,
    // anchor's .rpc() delegates here.
    sendAndConfirm: async (tx: Transaction, signers: Keypair[] = []) => {
      console.log("  · setting blockhash/feePayer + signing (v1)");
      tx.recentBlockhash = svm.latestBlockhash();
      tx.feePayer = payer.publicKey;
      tx.sign(payer, ...signers);

      // litesvm 1.x sendTransaction wants a web3.js-v2 (kit) transaction
      // (it runs `assertIsFullySignedTransaction` on a v2-shaped object).
      // The wire format is SHARED between v1 and v2, so the bridge is one
      // step: serialize the fully-signed legacy tx → decode into a v2
      // transaction → hand THAT to litesvm.
      const wire = tx.serialize(); // fully-signed legacy wire bytes
      // @solana/transactions is litesvm's own (transitive) dep — pnpm's
      // isolated store won't expose it to a bare import from here, so it
      // must be a DIRECT devDep (pin 6.9.0 to match litesvm). Try the bare
      // specifier, then the explicit subpath the resolver suggests.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let txMod: any;
      try {
        txMod = await import("@solana/transactions");
      } catch {
        try {
          txMod = await import("@solana/transactions/dist/index.node.cjs");
        } catch (e) {
          throw new Error(
            `cannot import @solana/transactions — add it directly: ` +
              `pnpm add -D -w @solana/transactions@6.9.0 (err: ${(e as Error)?.message ?? e})`,
          );
        }
      }
      const decoderFactory = txMod.getTransactionDecoder ?? txMod.getTransactionCodec;
      if (typeof decoderFactory !== "function") {
        throw new Error(
          `no getTransactionDecoder in @solana/transactions exports: ${Object.keys(txMod).join(", ")}`,
        );
      }
      const decoder = decoderFactory();
      const v2tx = typeof decoder.decode === "function" ? decoder.decode(wire) : decoder(wire);
      console.log("  · decoded v1→v2 tx; signatures:", Object.keys(v2tx.signatures ?? {}).length);

      const res = svm.sendTransaction(v2tx);
      console.log(`  sendTransaction(v2) → ${(res as any)?.constructor?.name ?? typeof res}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = res as any;
      const maybeErr = r && typeof r.err === "function" ? r.err() : null;
      if (maybeErr) {
        throw new Error(`litesvm tx failed: ${JSON.stringify(maybeErr)} logs=${r.logs?.()}`);
      }
      const sig = tx.signatures?.[0]?.signature;
      return sig ? Buffer.from(sig).toString("base64") : "ok";
    },
  };

  hr("3. run reputation `ping` through anchor over litesvm");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const program = new anchor.Program(idl, provider as any);
  try {
    const sig = await program.methods.ping().accounts({ signer: payer.publicKey }).rpc();
    console.log(`✓ ping executed — sig: ${sig}`);
  } catch (e) {
    console.error(`\n✗ ping failed: ${(e as Error)?.message ?? e}`);
    console.error("\n--- full stack (shows whether it's litesvm or anchor) ---");
    console.error((e as Error)?.stack ?? e);
    console.error(
      `\n  Paste everything above; the marker lines pinpoint whether it died\n` +
        `  in tx-build (anchor), in svm.sendTransaction (litesvm tx contract),\n` +
        `  or in result handling.\n`,
    );
    process.exit(1);
  }

  hr("4. read path — initialize_reputation + fetch via the Connection shim");
  try {
    const repId = new PublicKey(programIdStr);
    const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("rep-config")], repId);
    await program.methods
      .initializeReputation({
        roundfiCoreProgram: payer.publicKey, // frozen at init; not validated against a loaded program
        passportAttestationAuthority: new PublicKey("gatem74V238djXdzWnJf94Wo1DcnuGkfijbf3AuBhfs"),
        passportNetwork: new PublicKey("ignREusXmGrscGNUesoU9mxfds9AiYTezUKex2PsZV6"),
      })
      .accounts({
        authority: payer.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  ✓ initialize_reputation executed (PDA created)");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg: any = await (program.account as any).reputationConfig.fetch(configPda);
    console.log(`  ✓ fetched ReputationConfig.authority = ${cfg.authority.toBase58()}`);
    if (cfg.authority.toBase58() !== payer.publicKey.toBase58()) {
      throw new Error("authority mismatch — read path returned wrong/garbled data");
    }
    console.log("  ✓ read path round-trips correctly (shim → anchor deserialize)");
  } catch (e) {
    console.error(`\n✗ read-path step failed: ${(e as Error)?.message ?? e}`);
    console.error("\n--- full stack ---");
    console.error((e as Error)?.stack ?? e);
    console.error(
      `\n  This isolates the Connection shim (getAccountInfo v2→v1) or the\n` +
        `  initialize_reputation arg/account names. Paste it and I'll adjust.\n`,
    );
    process.exit(1);
  }

  hr("VERDICT");
  console.log(
    "✅ anchor-over-litesvm-1.1.0 FOUNDATION + READ PATH WORK via a custom\n" +
      "   provider — instruction send (sendAndConfirm + v1→v2 bridge) AND\n" +
      "   account fetch (Connection shim v2→v1) both validated on anchor 0.30.1,\n" +
      "   no anchor-litesvm. Next (increment 2b): load mpl_core.so + SPL token,\n" +
      "   drive a single join_pool round-trip, confirm the CreateV2 CPI executes\n" +
      "   (the SEV-012 gold standard). Then promote to tests/_harness/litesvm.ts.\n",
  );
}

main().catch((e) => {
  console.error("\n✗ spike crashed:", e);
  process.exit(1);
});
