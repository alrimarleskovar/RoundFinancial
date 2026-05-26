/**
 * SEV-012 port — increment 2b-step1: account seeding via litesvm
 * `setAccount` (the litesvm analog of bankrun's writeMint/writeToken/
 * writeAnchorAccount).
 *
 * The full join_pool round-trip needs seeded state — USDC mint, member
 * ATAs, ProtocolConfig, Pool, Member — written directly via `setAccount`
 * (bankrun.ts does this to bypass the init instructions). litesvm 1.x is
 * web3.js-v2/kit-flavored, so its `setAccount` account shape differs from
 * bankrun's `AccountInfoBytes`. This spike pins that shape by seeding an
 * SPL Mint and reading it back, so the harness seeding can be written
 * against the proven contract.
 *
 * Standalone spike (spikes/ is outside CI + tsconfig globs).
 *
 * ## Prerequisites
 *   pnpm add -D -w litesvm@^1.1.0          # @solana/spl-token already a dep
 *   pnpm tsx spikes/litesvm-seed.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";

void anchor;

function hr(t: string): void {
  console.log(`\n━━━ ${t} ━━━`);
}

async function main(): Promise<void> {
  hr("SEV-012 port — increment 2b-step1: litesvm setAccount seeding");

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
  const svm: any = new LiteSVM();

  // Build a real SPL Mint blob (same encoder bankrun uses).
  const mint = Keypair.generate().publicKey;
  const mintAuthority = Keypair.generate().publicKey;
  const data = new Uint8Array(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority,
      supply: 0n,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  );

  hr("1. seed the Mint via setAccount — try v2 account shapes");
  // litesvm 1.x setAccount(address, account). Try the documented v2 shape
  // first, then variants, reporting which the binding accepts.
  const baseAccount = {
    executable: false,
    lamports: 10_000_000_000n,
    data,
    owner: TOKEN_PROGRAM_ID.toBase58(),
    rentEpoch: 0n,
    space: BigInt(MINT_SIZE),
  };
  const variants: Array<[string, unknown, unknown]> = [
    ["addr=string, account v2 (bigint lamports, owner string)", mint.toBase58(), baseAccount],
    [
      "addr=string, lamports number, owner string",
      mint.toBase58(),
      { ...baseAccount, lamports: Number(baseAccount.lamports), rentEpoch: 0 },
    ],
    ["addr=PublicKey, account v2", mint, baseAccount],
  ];
  let seeded = false;
  let lastErr: unknown = null;
  for (const [label, addr, acct] of variants) {
    try {
      svm.setAccount(addr, acct);
      console.log(`✓ setAccount accepted: ${label}`);
      seeded = true;
      break;
    } catch (e) {
      console.log(`  · ${label} → ${(e as Error)?.message ?? e}`);
      lastErr = e;
    }
  }
  if (!seeded) {
    console.error(
      `\n✗ setAccount rejected all shapes. last: ${(lastErr as Error)?.message ?? lastErr}`,
    );
    console.error("  Paste this — I'll adjust the account shape to litesvm 1.1.0's setAccount.\n");
    process.exit(1);
  }

  hr("2. read it back via getAccount");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a: any = svm.getAccount(mint.toBase58());
  console.log("getAccount keys:", a ? Object.keys(a) : a);
  const dataLen = a?.data?.length;
  const ownerStr = a?.owner ?? a?.programAddress;
  console.log(`  data length: ${dataLen} (expected ${MINT_SIZE})`);
  console.log(`  owner: ${ownerStr?.toString?.() ?? ownerStr}`);
  if (dataLen !== MINT_SIZE) {
    console.error("\n✗ seeded data length mismatch — setAccount didn't round-trip the blob.\n");
    process.exit(1);
  }

  hr("VERDICT");
  console.log(
    "✅ setAccount SEEDING WORKS — the harness can write Mint / Token /\n" +
      "   Anchor-coder accounts directly (bankrun.ts pattern) on litesvm.\n" +
      "   Next: load mpl_core + SPL Token programs, seed ProtocolConfig +\n" +
      "   Pool + Member + USDC mint + member ATA, then call join_pool and\n" +
      "   confirm the CreateV2 CPI executes (the SEV-012 gold standard).\n",
  );
}

main().catch((e) => {
  console.error("\n✗ spike crashed:", e);
  process.exit(1);
});
