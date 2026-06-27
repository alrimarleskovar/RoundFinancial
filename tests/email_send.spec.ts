/**
 * Email send primitives (PR3a) — the 3 templates render correctly in PT/EN and
 * the adapter selector is env-driven + safe-by-default. Pure (no DB / no
 * network — the noop adapter never calls fetch, the resend adapter isn't
 * invoked), so it runs in the normal mocha+tsx suite.
 */

import { expect } from "chai";

import {
  dueDateEmail,
  poolStartedEmail,
  newGroupEmail,
  type DueDateData,
  type PoolStartedData,
  type NewGroupData,
} from "../services/indexer/src/email/templates.js";
import {
  getEmailAdapter,
  noopEmailAdapter,
  resendEmailAdapter,
} from "../services/indexer/src/email/adapter.js";

const COMMON = {
  email: "alice@example.com",
  walletShort: "81u3…bchNy",
  logoUrl: "https://roundfi.vercel.app/email-logo.png",
  unsubUrl: "https://roundfi.vercel.app/unsubscribe?token=abc",
};

describe("email templates — due-date reminder", () => {
  const base: DueDateData = {
    ...COMMON,
    groupName: "Pool Rápida · Devnet",
    installmentBrl: "R$ 6,00",
    dueDate: "29 jun 2026",
    days: 2,
    payUrl: "https://roundfi.vercel.app/grupos",
  };

  it("renders PT subject + body + links + fields", () => {
    const r = dueDateEmail(base, "pt");
    expect(r.subject).to.contain("vence em 2 dias");
    expect(r.subject).to.contain(base.groupName);
    expect(r.html).to.contain(COMMON.logoUrl);
    expect(r.html).to.contain(base.payUrl);
    expect(r.html).to.contain(COMMON.unsubUrl);
    expect(r.html).to.contain(base.installmentBrl);
    expect(r.html).to.contain("Pagar parcela");
  });

  it("renders EN with the right copy + singular day", () => {
    const r = dueDateEmail({ ...base, days: 1 }, "en");
    expect(r.subject).to.contain("due in 1 day");
    expect(r.html).to.contain("Pay installment");
  });

  it("HTML-escapes the group name (no injection from on-chain text)", () => {
    const r = dueDateEmail({ ...base, groupName: 'Evil<script>"x"' }, "pt");
    expect(r.html).to.not.contain("<script>");
    expect(r.html).to.contain("Evil&lt;script&gt;");
  });
});

describe("email templates — pool started", () => {
  const base: PoolStartedData = {
    ...COMMON,
    groupName: "Pool Rápida · Devnet",
    membersTarget: 5,
    firstDueDate: "29 jun 2026",
    installmentBrl: "R$ 6,00",
    groupUrl: "https://roundfi.vercel.app/grupos",
  };

  it("PT announces the start + 5/5 + CTA", () => {
    const r = poolStartedEmail(base, "pt");
    expect(r.subject).to.contain("Seu grupo começou");
    expect(r.html).to.contain("5 / 5");
    expect(r.html).to.contain("Ver meu grupo");
    expect(r.html).to.contain(base.groupUrl);
  });

  it("EN variant", () => {
    const r = poolStartedEmail(base, "en");
    expect(r.subject).to.contain("Your group has started");
    expect(r.html).to.contain("View my group");
  });
});

describe("email templates — new group for level", () => {
  const base: NewGroupData = {
    ...COMMON,
    groupName: "Renovação MEI · 12m",
    levelLabel: "Comprovado",
    slotsFilled: 3,
    slotsTotal: 5,
    collateralPct: 25,
    groupUrl: "https://roundfi.vercel.app/grupos",
  };

  it("PT recommends by level + shows spots/collateral", () => {
    const r = newGroupEmail(base, "pt");
    expect(r.subject).to.contain("grupo do seu nível");
    expect(r.html).to.contain("Comprovado");
    expect(r.html).to.contain("3 / 5");
    expect(r.html).to.contain("25%");
    expect(r.html).to.contain("Ver grupo");
  });

  it("EN variant", () => {
    const r = newGroupEmail(base, "en");
    expect(r.subject).to.contain("for your level just opened");
    expect(r.html).to.contain("View group");
  });
});

describe("email adapter — env-driven selection (safe by default)", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.RESEND_API_KEY;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved;
  });

  it("defaults to noop when RESEND_API_KEY is unset", () => {
    delete process.env.RESEND_API_KEY;
    expect(getEmailAdapter().name).to.equal("noop");
  });

  it("selects resend when RESEND_API_KEY is set", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    expect(getEmailAdapter().name).to.equal("resend");
  });

  it("noop send returns ok without sending", async () => {
    const r = await noopEmailAdapter.send({ to: "a@b.co", subject: "x", html: "<p>x</p>" });
    expect(r.ok).to.equal(true);
    expect(r.id).to.equal("noop");
  });

  it("resend adapter is constructable (not invoked here)", () => {
    const a = resendEmailAdapter("re_x", "RoundFi <a@b.co>");
    expect(a.name).to.equal("resend");
  });
});
