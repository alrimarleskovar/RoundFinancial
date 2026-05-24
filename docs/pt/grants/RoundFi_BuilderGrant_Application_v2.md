# RoundFi

## Solana Mobile Builder Grant Application

| | |
| :- | :- |
| **Programa** | Solana Mobile Builder Grants — em parceria com Colosseum |
| **Projeto** | RoundFi — ROSCA on-chain com behavioral credit score na Solana |
| **Repositório** | github.com/alrimarleskovar/RoundFinancial |
| **Categoria** | DeFi · Pagamentos · Crédito on-chain · Mobile-first |
| **Grant solicitado** | USD $10.000 |
| **Data** | Maio 2026 |
| **Versão** | v2 — atualizado 2026-05-24 com state real do código |

---

# 1. Resumo executivo

O RoundFi é um protocolo de poupança rotativa (ROSCA) on-chain construído na Solana, projetado para ser o primeiro produto DeFi mobile-first que transforma comportamento financeiro recorrente em reputação verificável on-chain.

A proposta central: usuários entram em pools de 10–24 membros, contribuem mensalmente em USDC, e a cada ciclo um membro recebe o pot completo — enquanto o capital aguarda distribuição gerando yield real de 4–7% APY via Kamino Finance. Cada pagamento on-chain alimenta o RoundScore, um histórico financeiro on-chain portável que abre acesso progressivo a pools com menor exigência de garantia.

O Solana Seeker é o canal de GTM ideal para o RoundFi: o público é on-chain nativo, o Seeker ID resolve o problema de identidade resistente a Sybil attacks, e o Seed Vault elimina a principal fricção de onboarding em protocolos DeFi. O RoundFi foi originado no ecossistema Colosseum e tem fit direto com o programa de grants da Solana Mobile.

**Estado atual (maio/2026):** 4 programas Anchor deployed em devnet · pre-audit interno completo com 47 findings catalogados e 13/13 Critical+High remediados · math foundation validada com ~9.85B fuzz inputs e 0 crashes · Kamino CPI estrutural validado contra mainnet-cloned state (17/17 testes passando). Time em transição final devnet → mainnet, com Genesis Canary planejado para 10 testers Seeker.

---

# 2. Problema que o RoundFi resolve

## 2.1 O paradoxo do crédito sub-colateralizado

A maioria dos protocolos DeFi de crédito (Aave, Maple, TrueFi) exige sobrecolateralização — e portanto serve exclusivamente quem já tem capital. Para os 1,4 bilhão de pessoas sem histórico de crédito formal, DeFi reproduz exatamente a exclusão do sistema bancário tradicional.

O problema não é ausência de capacidade de pagamento. É ausência de dados comportamentais verificáveis. ROSCAs existem há séculos como infraestrutura de crédito informal em LatAm, África e Sudeste Asiático precisamente porque criam esses dados: contribuições recorrentes com skin-in-the-game real, consequência financeira real, e ciclos repetíveis que geram histórico observável.

## 2.2 Por que nenhum DeFi protocol resolveu isso ainda

ROSCAs informais não geram dados on-chain verificáveis. O histórico existe, mas é opaco, não-portável e não-auditável. O RoundFi faz o que nenhum outro protocolo fez: coloca o mecanismo ROSCA inteiramente on-chain, transformando cada pagamento em uma attestation verificável que constrói histórico financeiro portável.

---

# 3. Solução técnica

## 3.1 Arquitetura do protocolo

O RoundFi é construído em Anchor 0.30 na Solana, com **4 programas Anchor** deployed em devnet:

- **roundfi-core (6,157 LoC):** gerencia o ciclo de vida dos pools — abertura, contribuições, Seed Draw on-chain, distribuição e encerramento de ciclos. Inclui Triple Shield invariants, escape valve secondary market, treasury timelock + lock.
- **roundfi-reputation (1,744 LoC):** registra attestations SAS-compatible de cada pagamento. Cada `paid_at` é dado bruto para o behavioral history, com `delta_seconds` (antecipação ou atraso) e `default_reason` (enum: SolvencyGuardTriggered / MissedDeadline / InsufficientStake / EscapeValveLeavingDefault / Other) garantindo contestabilidade.
- **roundfi-yield-kamino (754 LoC):** CPI para o Kamino Lend — `deposit_reserve_liquidity` (deposit path) + `redeem_reserve_collateral` (harvest path, redeem-all + redeposit-principal round-trip). **Production target.** CPI estrutural validado 2026-05-24 contra mainnet-cloned reserve state (17/17 tests passing).
- **roundfi-yield-mock (348 LoC):** test adapter exclusivamente devnet, nunca deployed para mainnet (out of scope da auditoria formal).

Total in-scope: ~8,655 LoC de Rust auditável.

## 3.2 Triple Shield — proteção do pool

- **Seed Draw:** retenção de 91,6% do capital no primeiro mês reduz risco de saída antecipada.
- **Adaptive Escrow:** garantia que diminui conforme histórico de pagamentos verificado: 50% → 30% → 10%. Recompensa comportamento progressivamente.
- **Solidarity Vault:** 1% de cada aporte vai para um fundo de garantia — distribui Good Faith Bonus para membros que pagaram em dia ao final do ciclo.

Cada shield é coberto por testes específicos em `tests/security_*.spec.ts` (53 security bankrun tests) + 6 cargo-fuzz targets sobre o crate `roundfi-math` (cobertura saturada no input space do corpus atual, 0 crashes em ~9.85B iterações cumulativas).

## 3.3 Escape Valve — liquidez para situações de distress

A posição de cada membro no pool é um NFT dinâmico (Metaplex Core). Um membro em dificuldade financeira pode vender sua posição no mercado secundário em vez de dar default — preservando a integridade do pool e criando um mecanismo de saída que ROSCAs tradicionais nunca tiveram.

## 3.4 RoundScore — o produto que emerge

Cada ciclo completo gera dados estruturados no indexer: on-time rate por ciclo, delta_seconds médio (comprometimento temporal), curva de risco por slot_position × cycle_number, e default_reason quando aplicável. Os dados ficam exportáveis via CPI conforme integration design publicado.

**Status honesto:** integração ativa com lending protocols externos é roadmap pós-mainnet beta. Conversas iniciais em andamento com Huma Finance (PayFi) e CREDO (score PDA), sem MoU formal ainda. O produto principal pré-parceria é a infraestrutura de dados — os parceiros vêm depois que houver Canary data real.

---

# 4. Fit com o ecossistema Solana Seeker

## 4.1 Por que o Seeker é o canal de GTM ideal

| Desafio do RoundFi | Como o Seeker resolve |
| :- | :- |
| Convencer usuários a depositar USDC em protocolo desconhecido | Usuário Seeker já tem autocustódia nativa via Seed Vault — a fricção de confiança é radicalmente menor |
| Resistência a Sybil attacks no behavioral score | Seeker ID vinculado a hardware — muito mais difícil de farmar que wallet anônima |
| Visibilidade de aquisição no lançamento | Solana dApp Store tem ~160 apps vs 3M+ no Google Play — visibilidade desproporcional |
| Incentivo para completar ciclos (retenção) | Cada pagamento RoundFi é uma tx on-chain que sobe o tier SKR do usuário no Seeker Season |
| Distribuição geográfica em mercados sub-bancarizados | Seeker vendido em 57 países — alto overlap com LatAm, SEA e África onde ROSCAs já existem informalmente |

## 4.2 SKR Season como motor de retenção nativo

O sistema de tiers SKR (Scout → Prospector → Vanguard → Luminary → Sovereign) recompensa atividade on-chain recorrente. Um usuário RoundFi em um pool de 12 membros com ciclos mensais gera ~12–14 transações on-chain por ciclo (12 contribuições + claim_payout + harvest_yield), todas de alto valor (USDC real, ~$200/membro) e com padrão orgânico recorrente — exatamente o tipo de atividade que os filtros anti-sybil da Seeker Season premiam vs farms de swaps baratos.

**Em 6 ciclos:** ~72–84 transações user-initiated + atividade indireta de pool que conta para o user (Seed Draws, settlements). Volume on-chain real do membro: ~$14.400 em contribuições + share proporcional do pot que recebe (~$2.400 no ciclo de contemplação).

Estimativa conservadora de tier atingível na Season 2: Vanguard → Luminary. **Caveat importante:** Solana Mobile ainda não publicou critérios exatos da Season 2, e o usuário típico tem outras atividades on-chain que somam para o tier. O RoundFi é multiplicador de tier, não o único driver.

---

# 5. Tração e validação (atualizado 2026-05-24)

| Indicador | Status atual |
| :- | :- |
| Smart contracts deployed | **4 programas em devnet**: roundfi-core (6,157 LoC) · roundfi-reputation (1,744 LoC) · roundfi-yield-kamino (754 LoC, **CPI validado contra mainnet-clone state**) · roundfi-yield-mock (348 LoC, devnet-only) |
| Cobertura de testes | **314+ testes** distribuídos em 25 spec files: 53 security-specific bankrun + 58 app-encoder structural + 7 bankrun round-trips + 10 canary-control negative + 36 audit-regression unit/proptest + 109 lifecycle/edge/parity + 24 frontend allowlist + 10 indexer JSON-shape + 7 mainnet-hardening |
| Math foundation | **6 cargo-fuzz targets** sobre `roundfi-math` — ~9.85B inputs cumulativos (503M historical + 600M re-validation 2026-05-24 + 8.75B overnight sweep), **0 crashes em todo o histórico**, coverage estável (saturação atingida no input space coberto pelo corpus atual) |
| Pre-audit interno | **5-pass red-team + 1 integration-testing wave + 9 follow-up waves** simulando metodologia de auditor externo — **47 findings catalogados, 43+ closed (Critical/High 13/13)**, 1 upstream-blocked (mpl-core/Anchor compat), 3 design-intentional. Tracker público: `docs/security/internal-audit-findings.md` |
| Treasury custody | **ADR-0008 mergeado**: Squads multisig 3-of-5 documentado como path de custody para mainnet (governance ready) |
| CD pipeline | **SEV-046 fechado**: `.github/workflows/{devnet,mainnet}-deploy.yml` live, rehearsal devnet 2026-05-19 green, Squads-approval gate documentado |
| Reproducible build | Attestation on-chain via `docs/verified-build.md` flow |
| Frontend | Next.js 15 web app live em `roundfinancial.vercel.app` — 17 static pages, mainnet network-confusion banner, mainnet wallet allowlist, frontend allowlist 24 tests |
| Indexer | Helius webhook listener + Prisma + PostgreSQL — observability scaffolding (Pass-14): structured JSON logs + `BackfillRun` cron health metric + 3 `/metrics` gauges |
| Canary planejado | **Genesis Canary**: 10 testers Seeker (validação UX + operacional, ciclos 48h, USDC simbólico) → **Pre-Ceremony Semanal**: 10 testers (3 vets do Canary + 7 newbies, ciclos 7d, USDC realista). Doc em `docs/pt/pre-ceremony-beta-proposta.md` v0.5.3 |
| Stack técnico | Rust + Anchor 0.30 · Node.js/Fastify · Next.js 15 · Helius webhooks · Prisma + PostgreSQL · Squads multisig · Civic → Human-Passport PoP (migration path) |
| Parceiros em conversa | Kamino Finance (CPI estrutural live, smoke devnet pendente) · Huma Finance (PayFi, conversas iniciais — sem MoU) · CREDO (score PDA design phase) |
| Origem do projeto | **Colosseum Hackathon 2026** — fit direto com o programa de grants Solana Mobile + Colosseum |

---

# 6. Roadmap para o dApp Store

| Fase | Entregável | Prazo |
| :- | :- | :- |
| 1 — Crank automático | Orchestrator em `services/orchestrator/` avança ciclos sem intervenção manual via Helius webhooks. Indexer schema com `paid_at` / `due_at` / `delta_seconds` / `grace_used` / `default_reason` ativo desde Dia 1 do Canary (irrecuperável se omitido) | Semanas 1–3 |
| 2 — Kamino devnet smoke | CPI estrutural já validado (17/17 contra mainnet-clone). Smoke devnet com clock real para validar accrual math em condições de produção. Yield waterfall: Protocol → Guarantee Fund → LP Angels → Participantes | Semanas 2–5 |
| 3 — Mainnet + Audit | Audit comunitário (Superteam tier ou similar pre-mainnet) dos 2 programas críticos (roundfi-core + roundfi-yield-kamino). Multisig Squads 3-of-5 via ADR-0008 já documentado. Fuzz floor já atingido (~9.85B inputs, 0 crashes). **Auditor externo formal (Adevar/Halborn/OtterSec/Sec3) em scoping para post-traction round** | Semanas 4–8 |
| 4 — dApp Store | **Mobile app via React Native + Mobile Wallet Adapter (MWA)** para integração profunda com Seed Vault (não PWA wrapper — PWA não acessa Seed Vault nativamente). Seeker ID como anchor de identidade no pool. Submissão ao Solana dApp Store. Canary com 10 testers Seeker reais | Semanas 7–10 |

**Decisão arquitetural — React Native vs PWA:** PWA → APK funciona para apps DeFi genéricos, mas **não acessa o Seed Vault nativamente**, que é exatamente o diferencial Seeker que o RoundFi precisa entregar. React Native + Mobile Wallet Adapter (`@solana-mobile/mobile-wallet-adapter-protocol-react-native`) é o caminho que preserva a promessa de "Seed Vault elimina fricção de onboarding".

---

# 7. Uso do grant ($10.000)

| Item | Valor | Justificativa |
| :- | :- | :- |
| **Audit comunitário pre-mainnet** (roundfi-core + roundfi-yield-kamino) | $5.000 | Tier comunitário (Superteam ou equivalente) suficiente para validação pre-Canary. Auditor externo formal (Adevar / Halborn / OtterSec / Sec3) é post-traction round — escopo + custo (~$30–50k) negociados após dados Canary. Pre-audit interno já fechou Critical/High 13/13 |
| **Infraestrutura mainnet** (RPC premium, indexer, orchestrator) | $2.500 | Helius RPC premium (off-chain reads + webhooks), servidor 24/7 para orchestrator/crank + indexer Prisma+PostgreSQL, monitoring stack |
| **Mobile app dev** (React Native + MWA integration + APK build pipeline) | $1.500 | Setup React Native + workspace no monorepo + Mobile Wallet Adapter integration + Seed Vault flows + EAS Build pipeline. Reusa SDK IDL-free existente |
| **Canary incentivos + custos USDC de teste** | $1.000 | Capital de seed para primeiros pools Canary com usuários Seeker reais (USDC devnet → bridge se necessário) |

---

# 8. Por que o RoundFi pertence ao Seeker

O ecossistema Seeker tem hoje ~150.000 usuários on-chain nativos em 57 países — com forte representação em mercados onde ROSCAs já existem como infraestrutura financeira informal. É o único canal de distribuição onde o RoundFi pode encontrar simultaneamente: usuários com autocustódia nativa, identidade verificável via Seeker ID, e motivação extrínseca para completar ciclos (SKR tiers).

O RoundFi não é um dApp DeFi genérico portado para mobile. É um protocolo cujo produto central — o behavioral history score — só tem valor com dados de identidade vinculados a hardware real e atividade recorrente. O Seeker é literalmente a infraestrutura que torna o produto possível na escala necessária.

O suporte de lançamento e a rede de distribuição da Solana Mobile são o complemento natural para um time técnico que já construiu a arquitetura certa (4 programas, 314+ testes, 9.85B fuzz inputs, pre-audit 47 findings com 13/13 Critical+High closed), agora em transição de devnet para mainnet.

---

# 9. Contato e links

| | |
| :- | :- |
| **Repositório GitHub** | github.com/alrimarleskovar/RoundFinancial |
| **Documentação técnica** | github.com/alrimarleskovar/RoundFinancial/blob/main/docs/architecture.md |
| **Audit scope** | github.com/alrimarleskovar/RoundFinancial/blob/main/AUDIT_SCOPE.md |
| **Internal audit tracker** | github.com/alrimarleskovar/RoundFinancial/blob/main/docs/security/internal-audit-findings.md |
| **Mainnet readiness** | github.com/alrimarleskovar/RoundFinancial/blob/main/MAINNET_READINESS.md |
| **Proposta beta v0.5.3** | github.com/alrimarleskovar/RoundFinancial/blob/main/docs/pt/pre-ceremony-beta-proposta.md |
| **Colosseum Hackathon** | Projeto submetido ao Colosseum Hackathon 2026 |
| **Discord Solana Mobile** | Disponível para demonstração técnica no canal #dapp-store |

---

*RoundFi — turning recurring savings into on-chain credit history, mobile-first on Seeker.*

---

## Changelog de revisão (v1 → v2)

Doc original (v1, semana de 2026-05-17) revisado em 2026-05-24 absorvendo:

1. **Programas:** 3 → **4** (acrescentado roundfi-yield-mock como devnet-only test adapter, conforme AUDIT_SCOPE)
2. **Kamino status:** "stub / em desenvolvimento" → **"CPI estrutural validado contra mainnet-clone state, 17/17 tests passing"** (PR #383 fechou SEV-040/041/042; bankrun spike Phase 2b green em 2026-05-24)
3. **Contradição PWA vs Seed Vault:** roadmap Fase 4 substituiu "PWA → APK" por **"React Native + Mobile Wallet Adapter"** — PWA wrapper não acessa Seed Vault nativamente, conflitando com a promessa central de "Seed Vault elimina fricção"
4. **Tração:** acrescentados números reais — pre-audit 47 SEVs (13/13 Critical+High closed), fuzz 9.85B cumulative, Squads multisig ADR-0008 mergeado, CD pipeline SEV-046 fechado, 314+ tests
5. **Yield range:** 5–8% → **4–7%** (alinhado com APY real Kamino USDC observado)
6. **Audit tier:** $5k explicitado como **audit comunitário pre-mainnet** (Superteam tier), auditor externo formal como post-traction round
7. **Canary numbers:** "10–20 usuários" → **10 + 10** (Genesis Canary + Pre-Ceremony Semanal, conforme proposta v0.5.3 §10)
8. **Huma Finance / CREDO:** "parceiros declarados" → **"conversas iniciais, sem MoU"** (downgrade honesto)
9. **Tagline final:** "Serasa da Web3" (Brasil-specific) → **"turning recurring savings into on-chain credit history, mobile-first on Seeker"** (universal)
10. **Math:** "~12 txs/ciclo" → **"12–14 txs/ciclo"** (incluindo claim_payout + harvest_yield)
