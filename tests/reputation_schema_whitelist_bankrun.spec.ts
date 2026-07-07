/**
 * Schema-whitelist parity — every declared attestation schema id must clear
 * attest.rs's upfront validity gate (bankrun, no mpl_core).
 *
 * **The incident this pins (SEV-053 erratum, 2026-07-07).** Adding a new
 * schema touches THREE lists in `attest.rs`: the upfront schema-validity
 * whitelist (`schema_ok` — rejects with `InvalidSchema` before any state is
 * touched), the `is_score_changing` cooldown set, and the apply `match`. The
 * SCHEMA_CLAIM_NEGLECT (id 7) wave updated the last two and missed the
 * first — so the freshly deployed devnet reputation program rejected its own
 * schema and EVERY `crank_payout` reverted with `InvalidSchema` (0x1772) at
 * the second attest CPI. The regression spec that would have caught it was
 * orphaned from CI (bankrun `edge_*` glob runs in no lane — SEV-012).
 *
 * **What this spec guarantees.** For EVERY id declared in the SDK's
 * `ATTESTATION_SCHEMA` map — which `test:parity` pins 1:1 against the Rust
 * `SCHEMA_*` constants — an admin-direct attest against the REAL program
 * must succeed. The moment someone lands schema 8 in the constants but
 * forgets the whitelist, this lane goes red; no devnet deploy needed to
 * find out. A negative control asserts an UNDECLARED id is still rejected,
 * so the gate's existence itself is also pinned (the test cannot
 * false-pass against a program that stopped validating schemas).
 *
 * roundfi-reputation has no mpl-core CPI, so this boots with
 * `loadMplCore: false` — eligible for the CI `bankrun · no-mpl-core` lane
 * (same rationale as the SEV-047 gate spec). Fresh subject per schema keeps
 * the per-profile admin cooldown and DEFAULT stickiness from coupling the
 * cases; the +61s warp between attests clears MIN_ADMIN_ATTEST_COOLDOWN_SECS
 * deterministically.
 */

import { expect } from "chai";
import { describe, it, before } from "mocha";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk";

import {
  adminAttest,
  initProfile,
  initializeReputation,
  keypairFromSeed,
} from "./_harness/index.js";
import { setupBankrunEnvCompat, type BankrunEnvCompat } from "./_harness/bankrun_compat.js";
import { setBankrunUnixTs } from "./_harness/bankrun.js";

// Admin-direct cooldown is 60s (MIN_ADMIN_ATTEST_COOLDOWN_SECS); warp a hair
// past it before each attest. Base ts is well past the 30-day POOL_COMPLETE
// cooldown so each subject's FIRST PoolComplete (last_cycle_complete_at = 0)
// clears trivially.
const COOLDOWN_STEP = 61n;
let CLOCK = 1_910_000_000n; // ~2030, comfortably > the cooldown floors.

async function tick(env: BankrunEnvCompat): Promise<void> {
  CLOCK += COOLDOWN_STEP;
  await setBankrunUnixTs(env.context, CLOCK);
}

/** Declared ids, deduped — `CycleComplete` is a legacy alias of id 4. */
function declaredSchemas(): Array<{ name: string; id: number }> {
  const byId = new Map<number, string>();
  for (const [name, id] of Object.entries(ATTESTATION_SCHEMA)) {
    if (!byId.has(id)) byId.set(id, name);
  }
  return [...byId.entries()].map(([id, name]) => ({ name, id }));
}

describe("reputation — schema whitelist accepts every declared id (bankrun)", function () {
  this.timeout(120_000);

  let env: BankrunEnvCompat;

  before(async function () {
    env = await setupBankrunEnvCompat({ loadMplCore: false });
    await setBankrunUnixTs(env.context, CLOCK);
    await initializeReputation(env, { coreProgram: env.ids.core });
  });

  it("admin attest succeeds for every ATTESTATION_SCHEMA id (whitelist parity)", async function () {
    for (const { name, id } of declaredSchemas()) {
      const subject = keypairFromSeed(`schema-whitelist/${name}`);
      await initProfile(env, subject.publicKey);
      await tick(env);
      try {
        await adminAttest(env, {
          subject: subject.publicKey,
          schemaId: id,
          nonce: BigInt(0x0530_0000 + id),
        });
      } catch (e) {
        throw new Error(
          `ATTESTATION_SCHEMA.${name} (id ${id}) rejected by the on-chain schema ` +
            `whitelist — attest.rs's schema_ok gate is missing it (the SEV-053 ` +
            `erratum class). Underlying: ${(e as Error)?.message ?? e}`,
        );
      }
    }
  });

  it("negative control: an UNDECLARED id is still rejected with InvalidSchema", async function () {
    const subject = keypairFromSeed("schema-whitelist/negative-control");
    await initProfile(env, subject.publicKey);
    await tick(env);

    let err: unknown = null;
    try {
      await adminAttest(env, { subject: subject.publicKey, schemaId: 999, nonce: 0x0530_ffffn });
    } catch (e) {
      err = e;
    }
    expect(err, "id 999 must NOT clear the whitelist").to.not.equal(null);
    expect(
      String((err as Error)?.message ?? err),
      "rejected specifically by the schema gate (InvalidSchema 6002 / 0x1772)",
    ).to.match(/InvalidSchema|0x1772|6002/i);
  });
});
