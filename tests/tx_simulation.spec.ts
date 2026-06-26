/**
 * Simulate-before-sign — pre-sign dry-run guard (frontend checklist §2.2).
 *
 * `simulateOrThrow` itself is I/O (it hits the RPC), so it's exercised
 * end-to-end by the devnet/e2e lanes. What we pin here is the pure
 * distillation logic that turns a failed `simulateTransaction` response
 * into a one-line, user-facing reason — the string the fund-movement
 * modals show when they refuse to let the user sign a doomed tx.
 */

import { expect } from "chai";

import { summarizeSimError, TransactionSimulationError } from "../app/src/lib/simulateTx";

describe("frontend — summarizeSimError (pre-sign simulation reason)", () => {
  it("extracts Anchor's 'Error Message:' line (the friendliest reason)", () => {
    const logs = [
      "Program log: Instruction: Contribute",
      "Program log: AnchorError caused by account: pool. Error Code: PoolNotActive. Error Number: 6005. Error Message: Pool is not active.",
      "Program failed to complete",
    ];
    expect(summarizeSimError({ InstructionError: [0, { Custom: 6005 }] }, logs)).to.equal(
      "Pool is not active",
    );
  });

  it("falls back to the last Program log line when there's no Anchor message", () => {
    const logs = [
      "Program log: Instruction: Contribute",
      "Program log: insufficient funds for the transfer",
    ];
    expect(summarizeSimError({ InstructionError: [0, "Custom"] }, logs)).to.equal(
      "insufficient funds for the transfer",
    );
  });

  it("falls back to the structured err when no useful logs are present", () => {
    const out = summarizeSimError({ InstructionError: [0, { Custom: 1 }] }, []);
    expect(out).to.contain("Transaction would fail on-chain");
    expect(out).to.contain("Custom");
  });

  it("returns a generic reason when nothing is available", () => {
    expect(summarizeSimError(null, [])).to.equal("Transaction would fail on-chain");
  });

  it("skips the Anchor 'Instruction:' breadcrumb and surfaces the runtime failure", () => {
    // Non-Anchor revert (mpl-core CPI / CU exhaustion): the only "Program log:"
    // line is the handler-entry breadcrumb; the real reason is the runtime line,
    // which is NOT prefixed "Program log:".
    const logs = [
      "Program log: Instruction: JoinPool",
      "Program CoREcdk1nbBDnYU3iZkjbPNQNyUVMVjTLeUfJSf1 acE invoke [1]",
      "Program 11111111111111111111111111111111 failed: custom program error: 0x1771",
    ];
    const out = summarizeSimError({ InstructionError: [0, { Custom: 6001 }] }, logs);
    expect(out).to.not.contain("Instruction: JoinPool");
    expect(out).to.contain("custom program error: 0x1771");
  });

  it("falls through to the structured err when the only program log is the breadcrumb", () => {
    const out = summarizeSimError({ InstructionError: [0, "ProgramFailedToComplete"] }, [
      "Program log: Instruction: JoinPool",
    ]);
    expect(out).to.not.contain("Instruction: JoinPool");
    expect(out).to.contain("ProgramFailedToComplete");
  });
});

describe("frontend — TransactionSimulationError", () => {
  it("carries the structured err + logs for the modal to render", () => {
    const e = new TransactionSimulationError("boom", { Custom: 6001 }, ["Program log: x"]);
    expect(e.name).to.equal("TransactionSimulationError");
    expect(e.message).to.equal("boom");
    expect(e.logs).to.deep.equal(["Program log: x"]);
    expect(e.err).to.deep.equal({ Custom: 6001 });
    expect(e instanceof Error).to.equal(true);
  });
});
