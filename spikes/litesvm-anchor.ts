/**
 * SEV-012 port — increment 1: does `anchor-litesvm` run a real anchor
 * instruction through LiteSVM?
 *
 * The spike `litesvm-mpl-core.ts` already proved LiteSVM LOADS the SBFv2
 * `mpl_core.so` that bankrun can't. The next question, before investing
 * in a full join_pool harness, is whether the existing anchor-based
 * helpers (`program.methods.X().rpc()`) can run on LiteSVM at all — i.e.
 * does `anchor-litesvm`'s `LiteSVMProvider` work with this repo's
 * `@coral-xyz/anchor` 0.30.1?
 *
 * This runs the SIMPLEST anchor instruction in the repo — reputation
 * `ping` (just a signer, no other accounts, no mpl-core) — over a
 * LiteSVM-backed provider. If it works, the anchor-over-LiteSVM
 * foundation is solid and we build up to join_pool (increment 2). If
 * `anchor-litesvm` doesn't match anchor 0.30.1, we learn it cheaply.
 *
 * Standalone spike (under spikes/, outside CI globs) — no shared-manifest
 * or CI impact until the approach is proven.
 *
 * ## Prerequisites
 *
 *   pnpm add -D -w anchor-litesvm        # litesvm already installed
 *   anchor build                          # produces target/idl + target/deploy
 *   pnpm tsx spikes/litesvm-anchor.ts
 *
 * NOTE: the anchor-litesvm + LiteSVM API below is written from the
 * documented surface. The spike prints the anchor-litesvm exports and
 * the provider shape first, so any drift is visible in one pass —
 * paste the output and I'll finalize the calls.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as anchor from "@coral-xyz/anchor";

const REP_IDL_PATH = resolve(process.cwd(), "target", "idl", "roundfi_reputation.json");
const REP_SO_PATH = resolve(process.cwd(), "target", "deploy", "roundfi_reputation.so");

function hr(title: string): void {
  console.log(`\n━━━ ${title} ━━━`);
}

async function main(): Promise<void> {
  hr("SEV-012 port — increment 1: anchor-litesvm × ping");

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

  // ── imports ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let LiteSVM: new () => any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ LiteSVM } = (await import("litesvm")) as unknown as { LiteSVM: new () => any });
  } catch (e) {
    console.error(`\n✗ import litesvm failed: ${(e as Error)?.message ?? e}\n`);
    process.exit(2);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let anchorLitesvm: any;
  try {
    anchorLitesvm = await import("anchor-litesvm");
  } catch (e) {
    console.error(
      `\n✗ import anchor-litesvm failed — install it: pnpm add -D -w anchor-litesvm\n` +
        `  underlying error: ${(e as Error)?.message ?? e}\n`,
    );
    process.exit(2);
  }
  hr("anchor-litesvm exports");
  console.log(Object.keys(anchorLitesvm).join(", "));

  // ── boot + load reputation program ──
  hr("1. boot LiteSVM + load reputation .so");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svm: any = new LiteSVM();
  svm.addProgramFromFile(programIdStr, REP_SO_PATH); // id as base58 string (proven form)
  console.log("✓ reputation program loaded");

  // ── build the provider ──
  hr("2. construct LiteSVMProvider");
  const ProviderCtor =
    anchorLitesvm.LiteSVMProvider ?? anchorLitesvm.LiteSvmProvider ?? anchorLitesvm.default;
  if (typeof ProviderCtor !== "function") {
    console.error(
      "✗ could not find a LiteSVMProvider constructor in anchor-litesvm exports above — " +
        "tell me the export list and I'll adjust.",
    );
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider: any = new ProviderCtor(svm);
  console.log("provider keys:", Object.keys(provider));
  const walletPk = provider.wallet?.publicKey ?? provider.publicKey;
  console.log("provider wallet pubkey:", walletPk?.toBase58?.() ?? walletPk);

  // Fund the payer (litesvm airdrop wants the address as a base58 string).
  try {
    svm.airdrop(walletPk.toBase58(), 10_000_000_000n);
    console.log("✓ payer funded via airdrop");
  } catch (e) {
    console.log(`  airdrop note: ${(e as Error)?.message ?? e} (provider may self-fund)`);
  }

  // ── run ping ──
  hr("3. run reputation `ping` through anchor over LiteSVM");
  const program = new anchor.Program(idl, provider);
  try {
    const sig = await program.methods.ping().accounts({ signer: walletPk }).rpc();
    console.log(`✓ ping executed — signature: ${sig}`);
  } catch (e) {
    console.error(
      `\n✗ ping failed: ${(e as Error)?.message ?? e}\n` +
        `  If this is an anchor-litesvm provider/version mismatch, paste the\n` +
        `  error + the exports/keys printed above and I'll adjust the wiring.\n`,
    );
    process.exit(1);
  }

  hr("VERDICT");
  console.log(
    "✅ anchor-over-LiteSVM FOUNDATION WORKS — a real anchor instruction\n" +
      "   ran through LiteSVM. Next (increment 2): load mpl_core.so + drive a\n" +
      "   single join_pool round-trip and confirm the CreateV2 CPI executes.\n",
  );
}

main().catch((e) => {
  console.error("\n✗ spike crashed:", e);
  process.exit(1);
});
