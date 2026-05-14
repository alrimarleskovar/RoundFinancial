# ADR 0001 — Apache 2.0 license

**Status:** ✅ Accepted
**Date:** ~2026-03 (project inception)
**Decision-makers:** Founders
**Related:** [`LICENSE`](../../LICENSE)

## Context

Choosing an open-source license affects:

1. **Adoption** — who can integrate with the codebase commercially
2. **B2B Phase 3 thesis** — neobanks and DeFi protocols need a license that lets them integrate the SDK + API without legal review friction
3. **Audit / compliance burden** — copyleft licenses (AGPL) trigger reciprocity requirements that conflict with B2B subscriber contracts
4. **Defensive patent posture** — RoundFi's Triple Shield + cascade math could theoretically be patentable; we need explicit patent grants from contributors
5. **Ecosystem fit** — Solana ecosystem is overwhelmingly Apache 2.0 + MIT (no major project uses AGPL)

## Decision

**We will license RoundFi under Apache License 2.0.**

Applies to all repo content unless a file's own header specifies otherwise.

## Consequences

- ✅ B2B subscribers (neobanks, DeFi protocols) can integrate the SDK without legal-review delays
- ✅ Explicit patent grant from contributors (Apache §3) protects the project from contributor-held patents
- ✅ Matches the rest of the Solana ecosystem (Anchor, mpl-core, SAS, Kamino are all Apache 2.0)
- ✅ Compatible with downstream MIT projects (Apache → MIT is allowed)
- ⚠️ Forks can be closed-source — we don't get reciprocity
- ⚠️ Trademark protection is separate (Apache 2.0 doesn't grant "RoundFi" usage; would need a separate trademark)

## Alternatives considered

### MIT

Simpler text, more permissive. **Rejected** because: no patent-grant clause. Contributors retaining patents could theoretically sue downstream integrators of their own contributions.

### AGPL-3.0

Strong copyleft — any network-deployed modification must release source. **Rejected** because: kills the B2B Phase 3 thesis. Neobanks subscribing to the oracle would either have to open-source their internal credit-decision systems or accept a separate commercial license. Both block adoption.

### BSL (Business Source License)

Source-available with a delayed open-source date (e.g., 4 years). **Rejected** because: the Solana audit firm ecosystem expects standard OSI licenses; BSL adds review friction with no real protection (the protocol's value is the network effect on attestations, not the source code).

### Dual-licensed Apache 2.0 + MIT

Convention in the Rust ecosystem. **Considered** but rejected: dual-licensing complicates contributor agreements (must consent to both) and is overkill — Apache 2.0 alone covers our needs and matches Solana convention.

## References

- License file: [`LICENSE`](../../LICENSE)
- Apache 2.0 text: https://www.apache.org/licenses/LICENSE-2.0
- Solana ecosystem license survey (informal, May 2026): Anchor / mpl-core / SAS / Kamino all Apache 2.0
