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
import type { Connection } from "@solana/web3.js";

import {
  confirmOrThrow,
  summarizeSimError,
  TransactionSimulationError,
} from "../app/src/lib/simulateTx";

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

describe("frontend — confirmOrThrow (post-send confirmation guard)", () => {
  // Minimal Connection stub — confirmOrThrow only touches confirmTransaction +
  // getTransaction, so `as unknown as Connection` keeps the test off the full
  // RPC surface.
  function mockConnection(opts: {
    err: unknown;
    logs?: string[] | null;
    getTxThrows?: boolean;
  }): Connection {
    return {
      confirmTransaction: async () => ({ context: { slot: 0 }, value: { err: opts.err } }),
      getTransaction: async () => {
        if (opts.getTxThrows) throw new Error("rpc down");
        if (opts.logs === null) return null;
        return { meta: { logMessages: opts.logs ?? [] } };
      },
    } as unknown as Connection;
  }

  it("returns the signature when the tx confirmed with no error", async () => {
    const sig = await confirmOrThrow(mockConnection({ err: null }), "SiG", "bh", 100);
    expect(sig).to.equal("SiG");
  });

  it("throws when the tx confirmed WITH an on-chain error — the false-success gap", async () => {
    // A revert that lands AFTER a passing pre-sign simulation. confirmTransaction
    // would resolve (err set, not thrown); the sender used to ignore it and
    // report success. The logs from the failed tx are attached so the modal
    // classifier can key off the error NAME (MemberNotBehind) even though the
    // distilled #[msg] misleads ("member is current").
    const conn = mockConnection({
      err: { InstructionError: [0, { Custom: 6085 }] },
      logs: [
        "Program log: Instruction: EscapeValveList",
        "Program log: AnchorError. Error Code: MemberNotBehind. Error Number: 6085. Error Message: Member is current on contributions — default not applicable.",
      ],
    });
    let thrown: unknown;
    try {
      await confirmOrThrow(conn, "SiG", "bh", 100);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.be.instanceOf(TransactionSimulationError);
    const err = thrown as TransactionSimulationError;
    expect(err.logs.join("\n")).to.contain("MemberNotBehind");
    expect(err.err).to.deep.equal({ InstructionError: [0, { Custom: 6085 }] });
  });

  it("still throws (with empty logs) when fetching the failed tx's logs itself fails", async () => {
    const conn = mockConnection({ err: { Custom: 1 }, getTxThrows: true });
    let thrown: unknown;
    try {
      await confirmOrThrow(conn, "SiG", "bh", 100);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.be.instanceOf(TransactionSimulationError);
    expect((thrown as TransactionSimulationError).logs).to.deep.equal([]);
  });
});
