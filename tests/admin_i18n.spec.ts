/**
 * i18n key-parity guard for the /admin/ops console (ADR 0009 i18n phase).
 * Every `adminops.*` key must exist in BOTH locales so the EN toggle never
 * falls back to PT (or a raw key) and PT never shows English. Catches a
 * missing translation in CI instead of leaking a string in the UI.
 */

import { expect } from "chai";

import { DICT } from "../app/src/lib/i18n-dict.js";

const adminKeys = (lang: "pt" | "en") =>
  Object.keys(DICT[lang]).filter((k) => k.startsWith("adminops."));

describe("admin/ops i18n — key parity (PT ↔ EN)", () => {
  it("has at least the full admin key set in PT", () => {
    expect(adminKeys("pt").length).to.be.greaterThan(80);
  });

  it("every adminops.* PT key exists in EN", () => {
    const en = new Set(adminKeys("en"));
    const missing = adminKeys("pt").filter((k) => !en.has(k));
    expect(missing, `EN missing: ${missing.join(", ")}`).to.deep.equal([]);
  });

  it("every adminops.* EN key exists in PT", () => {
    const pt = new Set(adminKeys("pt"));
    const missing = adminKeys("en").filter((k) => !pt.has(k));
    expect(missing, `PT missing: ${missing.join(", ")}`).to.deep.equal([]);
  });

  it("no adminops.* value is an empty string", () => {
    for (const lang of ["pt", "en"] as const) {
      for (const k of adminKeys(lang)) {
        expect(DICT[lang][k], `${lang} ${k}`).to.be.a("string").and.not.equal("");
      }
    }
  });
});
