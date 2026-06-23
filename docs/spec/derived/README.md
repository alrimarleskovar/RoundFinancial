# Derived documents — markdown sources

This directory holds the **markdown sources** for RoundFi's technical PDFs. They
are **derived from** [`../MASTER-SPEC.md`](../MASTER-SPEC.md), the single source
of truth, and rendered to `docs/en/*.pdf` by
[`scripts/docs/build-pdfs.sh`](../../../scripts/docs/build-pdfs.sh).

## Why this exists

Before this, the PDFs in `docs/en/` were committed as **opaque binaries** (#200)
with no markdown source and no generator — so every protocol decision (a changed
threshold, a new tier) silently left them stale, and there was no way to diff or
re-render them. The Master Spec was written to fix exactly that, per its own
maintenance rule:

> **When the protocol changes, this document changes first; the derived documents
> follow. One source of truth, N derivations — never N sources.**

This directory is the "N derivations" half: versioned, diffable, regenerable.

## The maintenance loop

1. **Protocol changes** (a constant, a schema, a tier) → update the code.
2. **`MASTER-SPEC.md` changes first** — it is pinned to the deployed source.
3. **Update the affected derived `.md`** here (each one cites the spec sections
   it derives from, so the blast radius is easy to find).
4. **Regenerate** the PDF(s): `pnpm docs:build-pdfs 04` (or no arg for all).
5. **Commit** the `.md` change _and_ the regenerated `.pdf` together.

A derived doc must **never** introduce a fact the Master Spec doesn't have. If you
need a new fact, add it to the spec first.

## Building

```bash
pnpm docs:build-pdfs          # render every NN-*.md → docs/en/NN-*.pdf
pnpm docs:build-pdfs 04       # render just the 04-* doc
```

Requirements: `pandoc` + a PDF engine. Default engine is **weasyprint**
(`pip install weasyprint`, best CSS fidelity); override with
`PDF_ENGINE=wkhtmltopdf` (or `xelatex`, `typst`, …) to whatever you have. The
shared print stylesheet is [`style.css`](./style.css) — edit it once, every doc
restyles.

## The technical doc set (scope)

These are the docs the Master Spec actually feeds (the protocol/technical half).
The commercial docs (`06-market-and-gtm`, `07-business-model-b2b-oracle`,
`08-competitive-analysis`) and the `00` index are **out of scope** here — they
draw on other sources and are not regenerated from the spec.

| Source (`.md`)                      | → PDF (`docs/en/`)                   | Derives from (MASTER-SPEC) | Status     |
| ----------------------------------- | ------------------------------------ | -------------------------- | ---------- |
| `01-roundfi-overview.md`            | `01-roundfi-overview.pdf`            | §1–3, §11                  | ⬜ pending |
| `02-technical-whitepaper.md`        | `02-technical-whitepaper.pdf`        | §3–4, §8                   | ⬜ pending |
| `03-architecture-spec.md`           | `03-architecture-spec.pdf`           | §4, §11                    | ⬜ pending |
| `04-behavioral-reputation-score.md` | `04-behavioral-reputation-score.pdf` | §5–6, §9                   | ✅ done    |
| `05-stress-lab-economic-model.md`   | `05-stress-lab-economic-model.pdf`   | §4.3–4.5, §8               | ⬜ pending |
| `09-risk-and-compliance.md`         | `09-risk-and-compliance.pdf`         | §9–10, §13                 | ⬜ pending |
| `10-user-guide.md`                  | `10-user-guide.pdf`                  | §4, §5 (no internals)      | ⬜ pending |
| `11-devnet-status-and-proof.md`     | `11-devnet-status-and-proof.pdf`     | §11                        | ⬜ pending |

As each `.md` lands, flip its row to ✅ and commit the rendered PDF alongside it.
