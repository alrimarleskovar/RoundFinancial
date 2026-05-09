# RoundFi · English Documentation

Strategic + technical documentation for the RoundFi protocol, in English. The Portuguese counterpart lives at [`../pt/`](../pt/).

Files are numbered (`00-`–`11-`) to match the cross-references inside each PDF (e.g. when the Devnet Status doc says "see `04-behavioral-reputation-score.md`", the corresponding file here is `04-behavioral-reputation-score.pdf`).

Read in this order — entry points first, then technical foundation, then commercial layers, then operational concerns, then proof + meta.

## 1. Entry points

| File                                                   | Topic                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| [`01-roundfi-overview.pdf`](./01-roundfi-overview.pdf) | Project overview — the 60-second pitch in document form          |
| [`10-user-guide.pdf`](./10-user-guide.pdf)             | End-user onboarding guide — how to use the protocol step by step |

## 2. Technical foundation

| File                                                                         | Topic                                                                                    |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`02-technical-whitepaper.pdf`](./02-technical-whitepaper.pdf)               | Protocol whitepaper — source of truth for protocol mechanics                             |
| [`03-architecture-spec.pdf`](./03-architecture-spec.pdf)                     | Program topology, account model, instruction surface, PDA conventions, reputation design |
| [`04-behavioral-reputation-score.pdf`](./04-behavioral-reputation-score.pdf) | Reputation ladder (50/30/10), score generation mechanism, attestation schemas            |
| [`05-stress-lab-economic-model.pdf`](./05-stress-lab-economic-model.pdf)     | L1 actuarial simulator, Triple Shield invariants, solvency proofs                        |
| [`11-devnet-status-and-proof.pdf`](./11-devnet-status-and-proof.pdf)         | Devnet deployment status + Solscan receipts + Triple Shield enforcement evidence         |

## 3. Commercial layers

| File                                                                     | Topic                                                                                                 |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [`06-market-and-gtm.pdf`](./06-market-and-gtm.pdf)                       | Market sizing, ICP, go-to-market motion                                                               |
| [`07-business-model-b2b-oracle.pdf`](./07-business-model-b2b-oracle.pdf) | 3-phase revenue model + B2B reputation API endgame                                                    |
| [`08-competitive-analysis.pdf`](./08-competitive-analysis.pdf)           | Honest positioning vs Aave, Kamino, Maple, TrueFi, Goldfinch, Credix, RociFi, ARCx, Spectral, WeTrust |

## 4. Operational

| File                                                         | Topic                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| [`09-risk-and-compliance.pdf`](./09-risk-and-compliance.pdf) | Risk taxonomy, regulatory framing, compliance posture |

## 5. Meta

| File                                                         | Topic                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| [`00-documentation-index.pdf`](./00-documentation-index.pdf) | Formal strategic index document — canonical map of the doc package |

---

## Companion technical docs (root `docs/`)

The following live one level up because they're working developer references rather than strategic positioning:

- [`../architecture.md`](../architecture.md) — canonical architecture spec (markdown, kept in sync with `03-architecture-spec.pdf` above)
- [`../devnet-deployment.md`](../devnet-deployment.md) — devnet program IDs + transaction register
- [`../status.md`](../status.md) — shipped vs roadmap status register
- [`../security/self-audit.md`](../security/self-audit.md) — internal audit + threat model
- [`../yield-and-guarantee-fund.md`](../yield-and-guarantee-fund.md) — Yield Cascade math
- [`../pitch-alignment.md`](../pitch-alignment.md) — narrative ↔ implementation crosswalk

## Companion Portuguese docs

[`../pt/`](../pt/) ships the original Portuguese strategy docs (whitepaper, escada-reputacao, plano-b2b, plano-expansao, valvula-escape, viabilidade-tecnica, guia-usuario). They remain the source of truth for stakeholders who prefer Portuguese.
