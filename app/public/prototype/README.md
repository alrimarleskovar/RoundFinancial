# Prototype — legacy bundle, NOT served by the live app

> **⚠ Read me before screenshotting or quoting anything in this folder.**
>
> This directory holds the **original Figma-to-React handoff prototype**
> from before the production Next.js app under `app/src/` was built.
> Files here are **not deployed, not served, not imported** by any
> production route.
>
> **The live app lives in [`app/src/`](../../src/)** — that's what
> Vercel serves at <https://roundfinancial.vercel.app>.

## Why this directory exists

Reference material. The prototype proves the design system was
exercised end-to-end (typography, motion, layout, copy tone) before
the engineering team committed to building the production stack.

## Known staleness

Files in this directory **may contain references that no longer
match production**:

- **"Civic Pass"** — the prototype was authored before the Civic →
  Human Passport provider migration (#227, see also
  [`docs/security/passport-bridge-threat-model.md`](../../../docs/security/passport-bridge-threat-model.md)).
  The live app under `app/src/` has been updated to "Human Passport"
  in PR #355; this prototype was NOT updated, by deliberate scope
  decision (cost of refactoring legacy demo files >> value).
- **Copy / pricing / tier names** drifted in places — the prototype
  shows a snapshot from ~April 2026, not main HEAD.
- **Brazilian Portuguese translation** may use slightly different
  phrasing than the live i18n table.

If you need a screenshot of the current UI, use the **live app**,
not files from this directory.

## Listed in `.prettierignore`

Per the repo root `.prettierignore`:

> Legacy design handoff bundle (per README — original prototype, not
> served by the live app). Will get its own a11y + format pass if
> ever revived; not worth gating PRs on it today.

Same applies to content drift: a deliberate operational decision to
freeze the prototype until/unless it's revived as a marketing
landing or post-mortem reference.

## Tracker reference

Auditor's W5 #6 flagged this as a doc-only follow-up — adding this
README is the closure.
