# RoundFi · English Documentation

Strategic + technical documentation for the RoundFi protocol, in English. The Portuguese counterpart lives at [`../pt/`](../pt/).

| File                                                                                             | Topic                                                                                                             |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [`architecture-spec.pdf`](./architecture-spec.pdf)                                               | Program topology, account model, instruction surface, PDA conventions, reputation design                          |
| [`devnet-status-and-proof.pdf`](./devnet-status-and-proof.pdf)                                   | Devnet deployment status + Solscan receipts + Triple Shield enforcement evidence                                  |
| [`behavioral-reputation-score.pdf`](./behavioral-reputation-score.pdf)                           | Reputation ladder (50/30/10), score generation mechanism, attestation schemas                                     |
| [`business-model-and-b2b-reputation-oracle.pdf`](./business-model-and-b2b-reputation-oracle.pdf) | 3-phase revenue model + B2B reputation API endgame                                                                |
| [`competitive-analysis.pdf`](./competitive-analysis.pdf)                                         | Honest competitive positioning vs Aave, Kamino, Maple, TrueFi, Goldfinch, Credix, RociFi, ARCx, Spectral, WeTrust |

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
