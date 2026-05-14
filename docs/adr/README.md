# Architecture Decision Records — RoundFi

> **What is an ADR?** A short doc capturing one architectural decision: the context, the choice, the consequences, and the alternatives considered. Format adapted from [Michael Nygard's original proposal](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
>
> **Why we have them.** Load-bearing decisions ("why Apache 2.0", "why hand-rolled SDK encoders") need to be searchable + reviewable + justified. Without ADRs, auditors get ad-hoc answers and contributors accidentally reverse intentional choices.

## Index

| #                                            | Status      | Title                                                      |
| -------------------------------------------- | ----------- | ---------------------------------------------------------- |
| [0001](./0001-license-apache-2-0.md)         | ✅ Accepted | Apache 2.0 license                                         |
| [0002](./0002-idl-free-sdk-encoders.md)      | ✅ Accepted | Hand-rolled IDL-free SDK encoders (vs Anchor IDL bindings) |
| [0003](./0003-mpl-core-position-nft.md)      | ✅ Accepted | `mpl-core` for position NFTs (vs custom token mint)        |
| [0004](./0004-extract-roundfi-math-crate.md) | ✅ Accepted | Extract `roundfi-math` as standalone workspace crate       |
| [0005](./0005-indexer-finality-gate.md)      | ✅ Accepted | Indexer reconciler finality gate at 32 slots               |

**Future ADRs land alongside their implementing PR.** PR author writes the ADR as part of the PR (template below).

## Status values

- 🟡 **Proposed** — drafted, under discussion, not yet committed
- ✅ **Accepted** — decision locked, code reflects it
- ❌ **Rejected** — drafted, considered, decided against (kept for historical record)
- ⚠️ **Deprecated** — was accepted, but the decision has been reversed by a newer ADR (link forward)
- 🔄 **Superseded** — replaced by a later ADR (link to successor)

## Naming convention

`NNNN-decision-slug.md`

- 4-digit zero-padded counter (`0001`, `0010`, `0100`)
- Kebab-case slug
- One file per decision — don't combine two decisions in one ADR
- Don't renumber on rejection — keep `0007` as a rejected ADR forever, slot `0008` is the next one

## Template

Copy this for new ADRs (`docs/adr/NNNN-your-decision.md`):

```markdown
# ADR NNNN — Your Decision Title

**Status:** 🟡 Proposed / ✅ Accepted / ❌ Rejected / ⚠️ Deprecated / 🔄 Superseded by [#XXXX](./XXXX-...)
**Date:** YYYY-MM-DD
**Decision-makers:** (names or roles)
**Related:** PR #NNN, Issue #NNN

## Context

What's the problem? What constraints / forces are in play? Why does this need a decision now?

Keep it focused — 2-4 paragraphs. If the context is multi-page, the ADR is probably actually a design doc.

## Decision

The choice, stated affirmatively. "We will X."

Don't hedge. The ADR records what was decided, not what was considered.

## Consequences

What becomes easier / harder as a result?

- ✅ Positive consequence 1
- ✅ Positive consequence 2
- ⚠️ Trade-off 1
- ❌ Negative consequence we accept

## Alternatives considered

What else was on the table?

### Alternative A

Why we didn't pick it.

### Alternative B

Why we didn't pick it.

## References

- Source code: `path/to/file.rs:NN-MM`
- Related ADR: [NNNN](./NNNN-...)
- External: [link](https://...)
```

## When to write an ADR

- ✅ Choosing between two libraries / runtimes / paradigms
- ✅ Adopting a non-obvious pattern (e.g., IDL-free encoders)
- ✅ Locking in a constraint that's hard to reverse later (license, account layout, dependency)
- ✅ Documenting a "we tried X and it didn't work" (rejected ADRs are valuable)

## When NOT to write an ADR

- ❌ Bug fixes — those land in the PR description
- ❌ Refactors that don't change architecture — also PR description
- ❌ Day-to-day code cleanup — comments + commit messages

## Maintenance

- Update the index above when a new ADR lands or status changes
- If an ADR gets superseded, **link forward** to the successor; don't delete or rewrite
- PR template (`.github/pull_request_template.md`) reminds authors to consider whether an ADR applies

## Related docs

- [`docs/architecture.md`](../architecture.md) — current architecture overview (synthesizes accepted ADRs)
- [`docs/security/`](../security/) — security-specific design docs (different from ADRs; those are reviewed by auditors)
- [`MAINNET_READINESS.md`](../../MAINNET_READINESS.md) — runtime decisions blocking mainnet

---

_Established: May 2026. Tracked via issue [#275](https://github.com/alrimarleskovar/RoundFinancial/issues/275)._
