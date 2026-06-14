/**
 * Bankrun test harness — minimal surface for specs that need a
 * clock-warpable environment (e.g. the 7-day `settle_default`
 * grace window on `tests/edge_grace_default.spec.ts`).
 *
 * solana-test-validator's clock cannot be warped by an arbitrary
 * amount, which makes the post-grace leg of `settle_default`
 * impossible to exercise end-to-end there. `solana-bankrun` ships
 * `ProgramTestContext::setClock`, so we use it for Step 5f's
 * grace-period test and only that test — everything else keeps
 * using the standard `setupEnv()` against localnet.
 *
 * Guardrails:
 *   - NO on-chain code sees bankrun. The core program is identical.
 *   - NO feature flags. Bankrun only affects the harness.
 *   - We seed state via `setAccount` rather than routing through
 *     `join_pool` (which CPIs into Metaplex Core). Metaplex isn't
 *     loaded in the bankrun workspace, so we bypass it by writing
 *     Pool / Member / ProtocolConfig directly via the Anchor coder,
 *     and write SPL Token / Mint accounts via `AccountLayout.encode`
 *     / `MintLayout.encode`.
 *   - Setting `config.reputation_program = Pubkey::default()` makes
 *     `settle_default` skip its reputation CPI — that branch is
 *     already covered by Rust unit + 5a→5e integration tests.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  AccountInfoBytes,
  AddedProgram,
  Clock,
  ProgramTestContext,
  startAnchor,
} from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  AccountState,
  MINT_SIZE,
  MintLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Env shape ────────────────────────────────────────────────────────

type AnyIdl = anchor.Idl;

export interface BankrunEnv {
  context: ProgramTestContext;
  provider: BankrunProvider;
  payer: Keypair;
  programs: {
    core: Program<AnyIdl>;
    reputation: Program<AnyIdl>;
    yieldMock: Program<AnyIdl>;
    yieldKamino: Program<AnyIdl>;
  };
  ids: {
    core: PublicKey;
    reputation: PublicKey;
    yieldMock: PublicKey;
    yieldKamino: PublicKey;
  };
}

function loadIdl(name: string): AnyIdl {
  const path = resolve(process.cwd(), "target", "idl", `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `IDL not found: ${path}. Run 'anchor build' (without --no-idl) before ` +
        `bankrun tests — anchor 1.0 emits target/idl/*.json natively for all ` +
        `4 programs (the #319 anchor-syn patch workaround was retired in #487).`,
    );
  }
  return JSON.parse(readFileSync(path, "utf-8")) as AnyIdl;
}

/**
 * Boot a bankrun `ProgramTestContext` with all workspace programs
 * pre-deployed, wrap it in an Anchor `BankrunProvider`, and return
 * typed `Program` handles for every program we normally interact
 * with. Mirrors `setupEnv()` but backed by bankrun instead of
 * localnet.
 */
/** Metaplex Core program ID. Same on every cluster. */
const METAPLEX_CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

/**
 * Kamino Lend program ID. Same on mainnet and devnet
 * (per Kamino-Finance/klend `declare_id!`). MUST match the constant
 * pinned in `programs/roundfi-yield-kamino/src/lib.rs` —
 * `KAMINO_LEND_PROGRAM_ID`. Cross-checked by SEV-040.
 */
export const KAMINO_LEND_PROGRAM_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

/**
 * Ensure mpl_core.so is loaded into the bankrun env.
 *
 * Specs that go through `join_pool` / `escape_valve_buy` CPI into
 * Metaplex Core for FreezeDelegate + TransferDelegate plugin ops on
 * the position NFT. Without mpl_core in the bankrun program registry,
 * those CPIs trip "Unsupported program id" — exactly the failure mode
 * SEV-012 / #319 has been tracking for the bankrun-in-CI lane.
 *
 * **Status (May 2026)**: this loader resolves the "Unsupported program
 * id" trip for mpl_core specifically. Validated locally that bankrun
 * accepts the mainnet-cloned binary and registers it under
 * `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`. The
 * `edge_grace_default*` specs still fail with a downstream "incorrect
 * program id for instruction" error — **diagnosed as a spec-level bug,
 * not a harness one**: those specs pass `env.ids.reputation` (the
 * reputation program's executable address) as a placeholder for
 * optional reputation accounts (e.g. `reputationConfig`, `attestation`)
 * via the `settleAccounts()` helper. The settle_default handler skips
 * the reputation CPI at runtime when `config.reputation_program ==
 * Pubkey::default()`, but Anchor's `Account<T>` ownership-check runs
 * BEFORE the handler — so the program-executable-as-account placeholder
 * fails validation with "incorrect program id". Was previously masked
 * by the mpl_core "Unsupported program id" trip; surfaces post-loader.
 * Tracked as a separate spec-fix follow-up (the on-chain accounts struct
 * would need `Option<Account<T>>` to accept the placeholder pattern, or
 * the spec needs uninitialized PDAs at the canonical seed addresses).
 *
 * mpl_core.so is NOT committed to the repo (~1MB binary). Convention:
 * `target/deploy/mpl_core.so` populated via:
 *
 *   solana program dump -u mainnet-beta \
 *     CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d \
 *     target/deploy/mpl_core.so
 *
 * Returns the `AddedProgram` entry to pass to `startAnchor`, or
 * `null` if the .so is missing (warning printed). Specs that depend
 * on mpl_core then fail loudly at the first CPI with the standard
 * "Unsupported program id" — same as before this loader, but at
 * least the warning here points to the fix.
 */
function maybeLoadMplCore(): AddedProgram | null {
  const path = resolve(process.cwd(), "target", "deploy", "mpl_core.so");
  if (!existsSync(path)) {
    console.warn(
      "[bankrun] mpl_core.so missing at target/deploy/mpl_core.so — " +
        "specs that CPI into Metaplex Core (join_pool, escape_valve_buy) " +
        "will fail with 'Unsupported program id'. Download with:\n" +
        `  solana program dump -u mainnet-beta ${METAPLEX_CORE_ID.toBase58()} target/deploy/mpl_core.so`,
    );
    return null;
  }
  return { name: "mpl_core", programId: METAPLEX_CORE_ID };
}

/**
 * Ensure klend.so (Kamino Lend) is loaded into the bankrun env.
 *
 * Specs that exercise `roundfi-yield-kamino` end-to-end need Kamino's
 * program bytecode loadable so the deposit/harvest CPIs resolve. This
 * is the Kamino-side counterpart to `maybeLoadMplCore` — same pattern,
 * same shape, just a different protocol.
 *
 * **Goal:** validate the CPI mechanics — discriminator computed by
 * `kamino_deposit_disc()` / `kamino_redeem_disc()` matches what Kamino
 * actually decodes, plus account ordering matches Kamino's interface.
 * Without loading klend.so the failure mode is 'Unsupported program
 * id' before any CPI fires; with it loaded, real failures (wrong
 * discriminator, wrong account list) surface with Kamino's own error
 * codes.
 *
 * **Status (May 2026)**: scaffolded as part of the Kamino bankrun-clone
 * spike. The discovery phase of this spike already caught SEV-040
 * (typo in `KAMINO_LEND_PROGRAM_ID`); the spike itself validates the
 * remaining mechanics layers (discriminator + account ordering).
 *
 * Known caveats (may surface during spike execution):
 * 1. Kamino reserves require Scope oracle accounts populated. A
 *    snapshot of a mainnet reserve gives initial state, but Kamino's
 *    pre-CPI account validation may panic if the oracle account
 *    timestamps are stale relative to bankrun's clock.
 * 2. Kamino's reserve PDA may have nested account dependencies
 *    (cascade-clone needed) — collateral mint, liquidity supply ATA,
 *    fee receiver ATA, etc.
 * 3. Bankrun may reject Kamino bytecode for the same upstream reason
 *    mpl_core was problematic until #319 (see SEV-012). If so, fail
 *    loud with a clear pointer to the workaround.
 *
 * klend.so is NOT committed to the repo (~1MB binary). Convention:
 * `target/deploy/klend.so` populated via:
 *
 *   solana program dump -u mainnet-beta \
 *     KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD \
 *     target/deploy/klend.so
 *
 * Returns the `AddedProgram` entry to pass to `startAnchor`, or
 * `null` if the .so is missing (warning printed).
 */
function maybeLoadKaminoLend(): AddedProgram | null {
  const path = resolve(process.cwd(), "target", "deploy", "klend.so");
  if (!existsSync(path)) {
    console.warn(
      "[bankrun] klend.so missing at target/deploy/klend.so — " +
        "specs that CPI into Kamino Lend (kamino_cpi_deposit, " +
        "kamino_cpi_harvest) will fail with 'Unsupported program id'. " +
        "Download with:\n" +
        `  solana program dump -u mainnet-beta ${KAMINO_LEND_PROGRAM_ID.toBase58()} target/deploy/klend.so`,
    );
    return null;
  }
  return { name: "klend", programId: KAMINO_LEND_PROGRAM_ID };
}

export interface BankrunSetupOptions {
  /**
   * Whether to load mpl_core.so into the test env. Default `true` —
   * back-compat with existing specs that route through `join_pool` /
   * `escape_valve_buy` (Metaplex Core CPI for FreezeDelegate +
   * TransferDelegate plugin ops).
   *
   * **Set to `false`** for specs that don't need Metaplex Core (e.g.
   * the Kamino bankrun spike). Reason: Metaplex deployed a newer
   * SBFv2-arch (0x107) build of mpl_core to mainnet; `solana program
   * dump` returns that newer format. solana-program-test 1.18.0
   * (used by bankrun) only reads eBPF/SBFv1 (0xf7), so loading the
   * current mainnet mpl_core.so panics with garbled bytes
   * (`<�h9` in the panic message — the arch byte being mis-decoded
   * as a program name). Specs that don't touch Metaplex Core can
   * sidestep this entirely — same upstream-compat surface as
   * SEV-012, just on a different external dep.
   */
  loadMplCore?: boolean;
  /**
   * Whether to load klend.so (Kamino Lend) into the test env. Default
   * `false` — only specs that CPI into Kamino need it. When true and
   * the .so is missing, the loader prints a warning and silently
   * proceeds (specs then fail with 'Unsupported program id' at the
   * first CPI — same shape as the mpl_core absence path).
   */
  loadKaminoLend?: boolean;
}

export async function setupBankrunEnv(options: BankrunSetupOptions = {}): Promise<BankrunEnv> {
  // startAnchor reads Anchor.toml at `path` and deploys every
  // program under [programs.localnet] from target/deploy/. Extras
  // (mpl_core, klend) get loaded by their `name` from the same dir.
  const { loadMplCore = true, loadKaminoLend = false } = options;

  const extras: AddedProgram[] = [];
  if (loadMplCore) {
    const mplCore = maybeLoadMplCore();
    if (mplCore) extras.push(mplCore);
  }
  if (loadKaminoLend) {
    const klend = maybeLoadKaminoLend();
    if (klend) extras.push(klend);
  }

  const context = await startAnchor("./", extras, []);
  const provider = new BankrunProvider(context);
  anchor.setProvider(provider);

  const coreIdl = loadIdl("roundfi_core");
  const reputationIdl = loadIdl("roundfi_reputation");
  const yieldMockIdl = loadIdl("roundfi_yield_mock");
  const yieldKaminoIdl = loadIdl("roundfi_yield_kamino");

  const core = new Program(coreIdl, provider);
  const reputation = new Program(reputationIdl, provider);
  const yieldMock = new Program(yieldMockIdl, provider);
  const yieldKamino = new Program(yieldKaminoIdl, provider);

  return {
    context,
    provider,
    payer: context.payer,
    programs: { core, reputation, yieldMock, yieldKamino },
    ids: {
      core: core.programId,
      reputation: reputation.programId,
      yieldMock: yieldMock.programId,
      yieldKamino: yieldKamino.programId,
    },
  };
}

// ─── Clock warping ────────────────────────────────────────────────────

/**
 * Overwrite `clock.unix_timestamp` on the bankrun chain, leaving
 * the slot/epoch fields at their current values. Every on-chain
 * `Clock::get()?` call afterwards observes the new timestamp.
 */
export async function setBankrunUnixTs(context: ProgramTestContext, unixTs: bigint): Promise<void> {
  const current = await context.banksClient.getClock();
  context.setClock(
    new Clock(
      current.slot,
      current.epochStartTimestamp,
      current.epoch,
      current.leaderScheduleEpoch,
      unixTs,
    ),
  );
}

// ─── Account seeding ─────────────────────────────────────────────────

/** Enough lamports to keep any account we write rent-exempt. */
const FAT_LAMPORTS = 10_000_000_000n;

function makeAccountInfo(
  owner: PublicKey,
  data: Buffer,
  lamports: bigint = FAT_LAMPORTS,
): AccountInfoBytes {
  return {
    lamports: Number(lamports),
    data: new Uint8Array(data),
    owner,
    executable: false,
    rentEpoch: 0,
  };
}

/**
 * Seed an SPL Token `Mint` account at `address` with the given
 * decimals and authorities. `supply` is optional — it's not read
 * by anything the grace-period spec cares about.
 */
export function writeMintAccount(
  context: ProgramTestContext,
  address: PublicKey,
  opts: {
    mintAuthority: PublicKey;
    decimals?: number;
    supply?: bigint;
    freezeAuthority?: PublicKey | null;
  },
): void {
  const data = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority: opts.mintAuthority,
      supply: opts.supply ?? 0n,
      decimals: opts.decimals ?? 6,
      isInitialized: true,
      freezeAuthorityOption: opts.freezeAuthority ? 1 : 0,
      freezeAuthority: opts.freezeAuthority ?? PublicKey.default,
    },
    data,
  );
  context.setAccount(address, makeAccountInfo(TOKEN_PROGRAM_ID, data));
}

/**
 * Seed an SPL Token account at `address` holding `amount` units
 * of `mint`, owned by `owner`. The account is written as
 * `Initialized` — this is what every Anchor `TokenAccount`
 * constraint expects. Use the ATA address (derived via
 * `getAssociatedTokenAddressSync(mint, owner, true)`) for Anchor
 * `associated_token::...` constraints to resolve correctly.
 */
export function writeTokenAccount(
  context: ProgramTestContext,
  address: PublicKey,
  opts: {
    mint: PublicKey;
    owner: PublicKey;
    amount: bigint;
  },
): void {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint: opts.mint,
      owner: opts.owner,
      amount: opts.amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: AccountState.Initialized,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  context.setAccount(address, makeAccountInfo(TOKEN_PROGRAM_ID, data));
}

/**
 * Seed an Anchor-owned account at `address` using the program's
 * own borsh coder. `accountName` must match a top-level account
 * type in the program IDL (e.g. "Pool", "Member", "ProtocolConfig").
 * The 8-byte discriminator is prepended automatically.
 *
 * The `owner` defaults to the program ID; pass it explicitly when
 * seeding an account under a different program (rare).
 */
export async function writeAnchorAccount<T>(
  context: ProgramTestContext,
  program: Program<AnyIdl>,
  accountName: string,
  address: PublicKey,
  data: T,
  owner: PublicKey = program.programId,
): Promise<void> {
  const encoded: Buffer = await program.coder.accounts.encode(accountName, data);
  context.setAccount(address, makeAccountInfo(owner, encoded));
}

// ─── Convenience re-exports ──────────────────────────────────────────
export { Clock } from "solana-bankrun";
