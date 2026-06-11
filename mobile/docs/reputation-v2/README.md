# Reputation v5.2 — source documents

> **Status:** received from product 2026-06-09. **Not yet authorized for implementation.**

This folder holds the v5.2 reputation spec package the team brought. They live
under `mobile/docs/` because the mobile app is the most downstream consumer of
the eventual on-chain shape — but the impact is repo-wide (programs, SDK,
indexer, docs).

## Files

| #   | File                         | What's inside                                                                                                                                                                                                                           |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | `01-proposal.md`             | The original conceptual proposal — design rationale, 4 layers / 4 levels / 6 categories / FrictionProof, Rust schemas.                                                                                                                  |
| 02  | `02-delta-today-vs-v52.html` | Interactive comparison page (open in browser): "today vs v5.2" across technical / product / risk / no-change axes.                                                                                                                      |
| 03  | `03-spec.md`                 | **Technical implementation spec.** Names 3 blocking bugs (aritmetic in `reliability()`, undeclared `count` in `punctuality()`, undefined `ORACLE_WHITELIST`), phased rollout plan, "argument to the team" for staying under the freeze. |
| 04  | `04-revisao-de-risco.md`     | **Risk review.** Critical — argues v5.2 is "the right spec for the second problem before the first one is solved." Calls out 5 untested premises, regulatory exposure (BCB / LGPD / Bureau de crédito), cold-start gap.                 |
| 05  | `05-decisoes-pendentes.md`   | **5 decisions the team must make** before a single line of Rust ships: score v1 vs v5.2 vs hybrid · 3 levels vs 4 · Switchboard oracle choice · BadFaith attester · upgrade vs redeploy of `roundfi-reputation`.                        |

Original `.docx` binaries are kept alongside the extracted `.md` for full-fidelity
review (formatting / tables / styles). The `.md` versions are what you should
edit-track in git.

## Reading order

1. **04-revisao-de-risco** first. The Risk Review reframes everything — if those
   premises hold, the rest matters; if not, the spec is premature.
2. **05-decisoes-pendentes** second. The 5 decisions gate everything downstream.
3. **01-proposal** third. The design itself, once you've calibrated to where it
   sits in the priority stack.
4. **03-spec** fourth. The "how" — assumes the "should we" is answered.
5. **02-delta** as a visual companion to any of the above.

## What the mobile layer needs

See `../../ROADMAP.md` § "Pending refactor — reputation levels (v5.2)" for the
mobile touchpoint inventory. **Short version:**

- The mobile is the **last** consumer in the chain (on-chain → SDK → app/mobile).
- We cannot start implementing v5.2 in `mobile/` before the upstream pieces
  land (programs + SDK + Prisma migration).
- But we **can** design the v5.2 Profile / Member-row UI ahead of time and stage
  it behind a feature flag, so when the SDK exposes the new shape we have a
  ready-to-wire surface.

## Authorization status

- [x] Team has resolved Decisão 1 (score architecture) — **chose Hybrid** (2026-06-09; see `06-team-decisions.md`)
- [x] Team has resolved Decisão 2 (level ladder) — **chose 4 levels** with stakes 50/25/10/3% (2026-06-09)
- [ ] Team has resolved Decisão 3 (Switchboard oracle / `ORACLE_WHITELIST`)
- [ ] Team has resolved Decisão 4 (BadFaith attester)
- [ ] Team has resolved Decisão 5 (upgrade vs redeploy of `roundfi-reputation`)
- [x] Bugs in `reliability()` and `punctuality()` have a fix PR — **deferred under Hybrid** (those functions never run until v5.2 weights are calibrated)
- [ ] `ORACLE_WHITELIST` design exists — deferred under Hybrid
- [ ] Risk Review has been discussed (regulatory + cold-start) — still owed
- [ ] Legal opinion on Brazilian ROSCA classification obtained — still owed
- [ ] Mobile work authorized — **decided: WAIT for upstream (Caminho 2, 2026-06-09)**. No mobile reputation code until the unblock trigger in `06-team-decisions.md` is met.

## Open issues

- [#450](https://github.com/alrimarleskovar/roundfinancial/issues/450) — VOLUNTARY_EXIT satisfied by construction (ready to close)
- [#451](https://github.com/alrimarleskovar/roundfinancial/issues/451) — cleanup of dead `EscapeValveLeavingDefault` enum value
