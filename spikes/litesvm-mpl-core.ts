/**
 * SEV-012 viability spike — does LiteSVM load the SBFv2 `mpl_core.so`
 * that `solana-bankrun` (solana-program-test 1.18) cannot?
 *
 * ## Why this exists
 *
 * SEV-012 (bankrun-in-CI) has two distinct blockers:
 *   1. compile-time — the borsh-version conflict on the full
 *      anchor 0.31 + solana 3.x + mpl-core 0.12 bump (#230).
 *   2. RUNTIME — `solana-bankrun`'s `solana-program-test 1.18` only
 *      reads eBPF / SBFv1 (arch 0xf7). The current mainnet `mpl_core.so`
 *      is SBFv2 (arch 0x107), so `startAnchor` panics with garbled
 *      bytes when it tries to load it. This is why every spec that CPIs
 *      into Metaplex Core (`join_pool`, `escape_valve_buy` → lifecycle,
 *      economic_parity, edge_grace_default) cannot run under bankrun.
 *
 * LiteSVM (Anza's in-process SVM) tracks current Agave and should load
 * SBFv2 binaries. If it does, the RUNTIME blocker dissolves and we can
 * migrate the mpl-core-dependent specs off bankrun onto LiteSVM with
 * **zero production-code change** (it's a test-harness swap, full
 * fidelity — the real `mpl_core.so` executes).
 *
 * This script is the cheapest decisive experiment for that question.
 * It is intentionally a STANDALONE spike (not under `tests/` or in the
 * mocha/typecheck globs) so it touches neither CI nor the shared
 * package manifest until we've confirmed LiteSVM installs and its API
 * matches what's written here.
 *
 * ## Prerequisites (run on a machine with the Solana toolchain)
 *
 *   1. Add the dependency:
 *        pnpm add -D litesvm
 *   2. Dump the current mainnet Metaplex Core program:
 *        solana program dump -u mainnet-beta \
 *          CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d \
 *          target/deploy/mpl_core.so
 *   3. Run:
 *        pnpm tsx spikes/litesvm-mpl-core.ts
 *
 * ## How to read the result
 *
 *   - "✅ SEV-012 RUNTIME BLOCKER CLEARED" → LiteSVM loaded + recognised
 *     the SBFv2 binary. Proceed to port one mpl-core spec onto a LiteSVM
 *     harness (next increment), then migrate the lane.
 *   - A panic / load error → capture the exact message. Either the
 *     LiteSVM version/API differs (adjust the calls flagged below) or
 *     LiteSVM has the same SBF-arch limitation (then pivot to the #230
 *     full-bump path).
 *
 * NOTE: the LiteSVM JS API below is written from the documented stable
 * surface. If a call name differs in the installed version, the error
 * print will name it — adjust and re-run. The API surface used is tiny
 * on purpose: constructor, addProgramFromFile, getAccount, airdrop,
 * getBalance.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { PublicKey } from "@solana/web3.js";

// Metaplex Core — same program ID on every cluster (mirrors
// tests/_harness/bankrun.ts:METAPLEX_CORE_ID).
const MPL_CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const MPL_CORE_SO = resolve(process.cwd(), "target", "deploy", "mpl_core.so");

function hr(title: string): void {
  console.log(`\n━━━ ${title} ━━━`);
}

async function main(): Promise<void> {
  hr("SEV-012 spike — LiteSVM × SBFv2 mpl_core.so");

  if (!existsSync(MPL_CORE_SO)) {
    console.error(
      `\n✗ mpl_core.so not found at ${MPL_CORE_SO}\n` +
        `  Dump it first:\n` +
        `    solana program dump -u mainnet-beta ${MPL_CORE_ID.toBase58()} ${MPL_CORE_SO}\n`,
    );
    process.exit(2);
  }

  // Dynamic import so a missing `litesvm` dep produces a clear message
  // instead of a top-level module-resolution crash.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let LiteSVM: new () => any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ LiteSVM } = (await import("litesvm")) as unknown as { LiteSVM: new () => any });
  } catch (e) {
    console.error(
      `\n✗ could not import "litesvm" — install it first: pnpm add -D litesvm\n` +
        `  underlying error: ${(e as Error)?.message ?? e}\n`,
    );
    process.exit(2);
  }

  hr("1. boot LiteSVM");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svm: any = new LiteSVM();
  console.log("✓ LiteSVM constructed");

  // Self-diagnostic: print the real method surface of the installed
  // version so any API drift is visible immediately (the 1.1.0 binding
  // differs from what the first cut assumed). This turns blind iteration
  // into one informed pass.
  hr("API surface (installed litesvm)");
  try {
    const proto = Object.getPrototypeOf(svm);
    const methods = Object.getOwnPropertyNames(proto)
      .filter((n) => n !== "constructor")
      .sort();
    console.log(methods.join(", "));
  } catch (e) {
    console.log(`(could not introspect: ${(e as Error)?.message ?? e})`);
  }

  hr("2. load the SBFv2 mpl_core.so — THE decisive check");
  // Try the documented name first, then known aliases across versions.
  const loadFns = ["addProgramFromFile", "add_program_from_file"] as const;
  let loaded = false;
  let lastErr: unknown = null;
  for (const fn of loadFns) {
    if (typeof svm[fn] !== "function") continue;
    try {
      svm[fn](MPL_CORE_ID, MPL_CORE_SO);
      console.log(`✓ ${fn}(...) did not throw`);
      loaded = true;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!loaded) {
    console.error(
      `\n✗ LiteSVM did not load mpl_core.so via ${loadFns.join(" / ")}.\n` +
        `  last error: ${(lastErr as Error)?.message ?? lastErr ?? "(no load fn found — see API surface above)"}\n` +
        `  If it's an SBF-arch error, LiteSVM shares bankrun's limitation →\n` +
        `  SEV-012 runtime blocker NOT cleared; pivot to the #230 full bump.\n` +
        `  If it's a missing-method error, tell me the method list above and I'll fix the call.\n`,
    );
    process.exit(1);
  }

  hr("3. verify the program is registered + executable");
  // getAccount return shape varies by version — print it raw so field
  // names (executable / data) are visible, then assert defensively.
  let acct: { executable?: boolean; data?: Uint8Array } | null = null;
  if (typeof svm.getAccount === "function") {
    acct = svm.getAccount(MPL_CORE_ID);
  } else if (typeof svm.get_account === "function") {
    acct = svm.get_account(MPL_CORE_ID);
  }
  console.log("getAccount(mpl_core) →", acct ? Object.keys(acct) : acct);
  if (acct && acct.executable) {
    console.log(`✓ mpl_core present + executable (data ${acct.data?.length ?? "?"} bytes)`);
  } else {
    console.log(
      "⚠ could not confirm executable via getAccount (load above already didn't throw, " +
        "which is the primary signal). Inspect the printed keys/shape.",
    );
  }

  hr("VERDICT");
  console.log(
    "✅ SEV-012 RUNTIME BLOCKER LIKELY CLEARED — LiteSVM accepted the SBFv2\n" +
      "   mpl_core.so that bankrun (solana-program-test 1.18) panics on.\n" +
      "   Next increment: port one mpl-core-dependent spec (smallest: a\n" +
      "   single join_pool round-trip) onto a LiteSVM harness and confirm\n" +
      "   the CreateV2 CPI EXECUTES (load-success here is necessary; an\n" +
      "   executed CPI is the gold standard). Then migrate the lane.\n",
  );
}

main().catch((e) => {
  console.error("\n✗ spike crashed:", e);
  process.exit(1);
});
