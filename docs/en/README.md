# RoundFi · English Documentation

Strategic + technical documentation for the RoundFi protocol, in English. The Portuguese counterpart lives at [`../pt/`](../pt/).

Read in this order — entry point first, then technical foundation, then commercial layers, then operational concerns, then the meta-index.

## 1. Entry point

| File                             | Topic                                                   |
| -------------------------------- | ------------------------------------------------------- |
| [`overview.pdf`](./overview.pdf) | Project overview — the 60-second pitch in document form |

## 2. Technical foundation

| File                                                                       | Topic                                                                                    |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`architecture-spec.pdf`](./architecture-spec.pdf)                         | Program topology, account model, instruction surface, PDA conventions, reputation design |
| [`behavioral-reputation-score.pdf`](./behavioral-reputation-score.pdf)     | Reputation ladder (50/30/10), score generation mechanism, attestation schemas            |
| [`stress-lab-and-economic-model.pdf`](./stress-lab-and-economic-model.pdf) | L1 actuarial simulator, Triple Shield invariants, solvency proofs                        |
| [`devnet-status-and-proof.pdf`](./devnet-status-and-proof.pdf)             | Devnet deployment status + Solscan receipts + Triple Shield enforcement evidence         |

## 3. Commercial layers

| File                                                                                             | Topic                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [`business-model-and-b2b-reputation-oracle.pdf`](./business-model-and-b2b-reputation-oracle.pdf) | 3-phase revenue model + B2B reputation API endgame                                                    |
| [`market-and-gtm-strategy.pdf`](./market-and-gtm-strategy.pdf)                                   | Market sizing, ICP, go-to-market motion                                                               |
| [`competitive-analysis.pdf`](./competitive-analysis.pdf)                                         | Honest positioning vs Aave, Kamino, Maple, TrueFi, Goldfinch, Credix, RociFi, ARCx, Spectral, WeTrust |

## 4. Operational

| File                                                                           | Topic                                                 |
| ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| [`risks-regulation-and-compliance.pdf`](./risks-regulation-and-compliance.pdf) | Risk taxonomy, regulatory framing, compliance posture |

## 5. Meta

| File                                                   | Topic                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| [`documentation-index.pdf`](./documentation-index.pdf) | Formal strategic index document — canonical map of the doc package |

---

## Companion technical docs (root `docs/`)

The following live one level up because they're working developer references rather than strategic positioning:

- [`../architecture.md`](../architecture.md) — canonical architecture spec (markdown, kept in sync with `architecture-spec.pdf` above)
- [`../devnet-deployment.md`](../devnet-deployment.md) — devnet program IDs + transaction register
- [`../status.md`](../status.md) — shipped vs roadmap status register
- [`../security/self-audit.md`](../security/self-audit.md) — internal audit + threat model
- [`../yield-and-guarantee-fund.md`](../yield-and-guarantee-fund.md) — Yield Cascade math
- [`../pitch-alignment.md`](../pitch-alignment.md) — narrative ↔ implementation crosswalk

## Companion Portuguese docs

[`../pt/`](../pt/) ships the original Portuguese strategy docs (whitepaper, escada-reputacao, plano-b2b, plano-expansao, valvula-escape, viabilidade-tecnica, guia-usuario). They remain the source of truth for stakeholders who prefer Portuguese.
