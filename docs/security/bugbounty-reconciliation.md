# Bug Bounty Hunt — Reconciliação Pós-Hardening

> **Status:** delta entre o relatório consolidado da Adevar Labs (3 rodadas, simulação interna) e o estado real do `main` em `2026-05-30`.
> **Propósito:** trazer o relatório à paridade com o trabalho que entrou via Ondas 1–4 do hardening (PRs #419 – #423 + doc Wave 4) e re-classificar os leads ainda abertos com base nos números reais.
> **Documento companheiro:** `docs/security/reputation-farming-roi.md` (modelo Wave 4).

---

## 1. O que o relatório acertou e onde está em paridade

Concordo com a estrutura, as conclusões e a maioria das classificações. Em particular:

- **Zero findings Critical/High pagáveis** — confere com a Onda 1 da nossa sessão (refutou a moldura on-chain da auditoria em Wave 1.3 e Wave 3).
- **D-i-D #1 / #2 / #3 fechados via #420 / #419 / #422** — todos identificados corretamente.
- **A observação de que o single-use foi movido para depois da verificação de assinatura** (`verify/route.ts` passo 3) corrige um griefing não-levantado. Foi proposital — a moldura está correta.
- **INFO-2 (race RC do limiter PG)** — está auto-documentado em `app/src/lib/admin/sharedStore.ts:122-127`. Aceitável.
- **INFO-3 (Passport bridge como off-chain trust)** — observação arquitetural correta.
- **Solicitação de expansão de escopo (SE-1/2/3)** — coincide exatamente com o que o time honestamente admitiu não ter auditado a fundo (orchestrator + indexer + bridge). É a próxima superfície de risco real para mainnet.

---

## 2. Três pontos onde o relatório está desatualizado

O relatório parece ter sido escrito **antes** das Ondas 3 e 4 da nossa sessão. Os deltas mudam a classificação de dois leads e a prioridade de uma observação.

### 2.1 LEAD-3 (Kamino) — mais fechado do que o relatório indica

**O que o relatório diz:** _"substancialmente fechado por leitura estática; resta verificação operacional do program-id."_

**O que falta:** a **Wave 3 (PR #423)** já mergeada em `main` adicionou três proteções que o relatório não cita:

| Camada    | O que mudou                                                                                                                                                                                                                            | Onde                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Off-chain | `computeHarvestFloor` no SDK + reescrita do crank devnet — antes o caller passava `min_realized_usdc = 0` e desligava o guard on-chain `realized >= min_realized_usdc`. Agora o floor vivo é o default; o opt-out é explícito.         | `sdk/src/yield.ts`, `scripts/devnet/seed-yield-harvest.ts` |
| On-chain  | **Teto de plausibilidade** `realized <= MAX_HARVEST_YIELD_MULTIPLE × tracked_principal` (1×). Complemento simétrico ao `PrincipalLoss`. Fail-loud + atomic rollback antes de mover fundos. ~25× margem sobre yield realista por ciclo. | `programs/roundfi-yield-kamino/src/lib.rs` `harvest()`     |
| On-chain  | **Pós-condição do redeposit**: após o redeposit CPI, reload + `require!(c_token_account.amount > 0)`. Evita `tracked_principal` virar phantom claim se o redeposit falhar silenciosamente.                                             | mesmo módulo                                               |

Validado em CI por `anchor · build` (SBF) + `bankrun · security_kamino_cpi`. **Classificação corrigida:** _"Fechado, exceto verificação operacional de `KAMINO_LEND_PROGRAM_ID` + par reserve/market contra deploy real Kamino mainnet."_ — o resíduo permanece, mas o vetor _adapter sub-reportando yield_ deixou de existir.

### 2.2 LEAD-1 (reputation farming) — já modelado, não indeterminado

**O que o relatório diz:** _"Indeterminada (econômica) — requer modelagem de ROI + execução."_

**O que falta:** a **Wave 4** entregou exatamente esse modelo em `docs/security/reputation-farming-roi.md` (255 linhas, fundamentado nas constantes on-chain reais com `file:line` em cada figura). As conclusões substantivas:

1. **O prêmio é fixo em ~4 000 USDC** (stake discount L1→L3 numa pool default de 10 000 USDC), **não escala** com N pools nem com tempo de farm. O relatório dá a entender que o impacto cresce — não cresce. É o produto marginal único.
2. **Há um piso wall-clock de ≥18 dias inquebrável**: SEV-047 obriga `cycles_completed ≥ 3`, e `cycles_completed` só sobe via `SCHEMA_CYCLE_COMPLETE`, que está sob cooldown de 6 dias **por wallet** (não por pool). Capital e paralelização não encurtam.
3. **A alternativa mais simples já captura exposição absoluta MAIOR** com zero custo de farm: defaultar no L1 numa pool comum captura ~5 000 USDC unbacked; defaultar no L3 captura ~9 000. **O produto marginal de farmar é estritamente os 4 000 — o delta entre os dois.**
4. **O wallet queima na saída** (`SCHEMA_DEFAULT` = −500 score + demote imediato), então o custo é per-exploit, não amortizado. Identidade nova começa em L1 e refarma do zero.
5. **Vira positivo só em pools de `credit_amount` grande**: o prêmio escala linear com `credit_amount`, o custo do farm não. Numa pool de 100 000 USDC o desconto é 40 000 — pode dominar o custo de farm. Esse é o regime que merece mitigação.

**Classificação corrigida:** _Low na configuração default (10k credit); Medium só em pools de high `credit_amount` reached via verified identity._ Mitigações recomendadas no doc Wave 4:

- **R1** (preferido): cap graduado de exposição por nível — neutraliza o regime §5.1 que é o único onde o farm paga;
- **R3**: forçar `required_min_level ≥ 3` no `set_identity_gate` — toggle operacional, sem código.

### 2.3 INFO-3 (Passport bridge) — intersecta LEAD-1 mais do que o relatório nota

O relatório enxerga a interseção mas para na observação. Concretizando o impacto:

O modelo da Wave 4 **depende** de R3 (identity gate) como chokepoint sybil para limitar o `weight_num/weight_den` halving (`attest.rs:230`). Se o bridge Passport cai e atacante forja `IdentityRecord.is_verified`:

- O halving de score deixa de aplicar → atacante vira "verified" → `SCORE_PAYMENT × 1` em vez de `× 0.5`.
- A fast-path PAYMENT-spam (Path B do modelo W4) chega a `score ≥ 2 000` em **metade do tempo**.
- O piso de 18 dias do `cycles_completed` permanece, mas o modelo deixa de ser dominado pelo score-floor e passa a ser dominado só pelo cycles-floor.

**Resultado:** com bridge Passport comprometido, a Wave 4 muda de _"Low na default config"_ para **_"Medium-High até em config default"_**. Isso eleva a auditoria do bridge na fila de SE-3 — não pode ficar como "observação".

---

## 3. Tabela de status reconciliada

| ID     | Tipo                     | Severidade                               | Status reconciliado                                                                                                                                              |
| ------ | ------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LEAD-1 | Reputation farming       | **Low (default) / Medium (high-credit)** | **Modelado** em `docs/security/reputation-farming-roi.md` (Wave 4). Mitigação concreta: R1 cap graduado + R3 identity gate. Sobe pra Medium-High se INFO-3 cair. |
| LEAD-2 | SIWS multi-instância     | —                                        | Fechado (#422).                                                                                                                                                  |
| LEAD-3 | Kamino unchecked         | —                                        | **Fechado** exceto verificação operacional de `KAMINO_LEND_PROGRAM_ID`. **Wave 3 (#423)** adicionou floor off-chain + teto on-chain + pós-condição redeposit.    |
| DID-1  | Rate-limit auth          | Info/Med-                                | Fechado (#420).                                                                                                                                                  |
| DID-2  | Webhook indexer          | Info/Med-                                | Fechado (#419).                                                                                                                                                  |
| DID-3  | SIWS in-memory           | Info/Med-                                | Fechado (#422).                                                                                                                                                  |
| INFO-1 | Bucket `"unknown"` do RL | Info                                     | Aberto — vale fix pequeno (warn loud em prod-like quando nenhum `X-Forwarded-For` for observado).                                                                |
| INFO-2 | Race RC do PG limiter    | Info                                     | Aceito, auto-documentado.                                                                                                                                        |
| INFO-3 | Passport bridge trust    | **Info → Med (eleva LEAD-1)**            | **Re-prioritizado:** intersecta LEAD-1 materialmente; entra em SE-3 como auditoria obrigatória, não opcional.                                                    |

---

## 4. Próximas ondas propostas

Ordenadas por leverage ÷ esforço.

| Onda  | Escopo                                                                                                                                                                                                                | Esforço   | Output                                                                                                            |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| **5** | _Este documento._ Reconcilia o relatório com o estado de `main`.                                                                                                                                                      | 1–2 h     | Doc-only PR (esta).                                                                                               |
| **6** | Fix INFO-1: warn loud em prod-like quando o rate-limiter está agrupando tudo em `"unknown"` (proxy header não está chegando).                                                                                         | 1–2 h     | PR pequeno com 2-3 testes no lane `js`.                                                                           |
| **7** | Verificação operacional do program-id Kamino + reserve canônica. Já documentado como pendente no próprio adapter.                                                                                                     | 2–3 h     | Script `scripts/mainnet/verify-kamino-pin.ts` + plug em `test:mainnet-hardening` + doc curto em `docs/security/`. |
| **8** | **SE-2 — orchestrator audit.** Custódia da chave do cranker; quem dispara `harvest`/`settle_default`/`release_escrow`; recovery story; rate-limit no cranker.                                                         | multi-dia | Threat model doc + PRs cirúrgicos de hardening.                                                                   |
| **9** | **SE-3 — indexer (paths não-webhook) + Passport bridge.** O webhook fechou na Wave 1.1; falta o reconciler/backfill confiar em quê + bridge Passport (multisig 3-de-5? rotação? TTL?). Fecha a interseção com LEAD-1. | multi-dia | Idem.                                                                                                             |

**Recomendação:** fazer 5 + 6 + 7 hoje (pequenos, fecham deltas conhecidos, destravam base sólida). As 8 e 9 são trabalho de auditoria real que merece sessão dedicada — não cabem em fila.

---

## 5. Como o relatório deve ser referenciado externamente

Mantendo o spirit da nota de cobertura original:

- **NÃO** é cobertura de bug bounty real, NEM da Immunefi/Code4rena/Sherlock.
- É **auto-avaliação interna** (Adevar Labs, simulação) + reconciliação pós-hardening (esta).
- O time fez sua parte de **dimensionamento honesto** (não inflou severidade, marcou D-i-D como não-pagável, pediu expansão de escopo) — esta reconciliação **não** afrouxa nada disso; apenas atualiza o registro pra refletir o que entrou em `main` depois das 3 rodadas.
