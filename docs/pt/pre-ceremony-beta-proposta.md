# Pre-Ceremony Beta — Proposta de Design (v0.4)

**Status:** rascunho para discussão de time
**Versão:** 0.4.1 — fixture honesty, caveat de Fase 1, gates promovidos a checklist
**Data alvo de decisão:** TBD
**Mudanças vs. v0.4:** ver §14

Todas as referências `arquivo:linha` desta versão foram confirmadas via grep direto.

---

## 1. Decisão de produto

Beta em devnet primeiro, dividido em duas fases sequenciais com **dois devnet generations distintos** (ver §6.3):

| Fase | Nome | Cadência | Aporte | Foco |
|---|---|---|---|---|
| **0** | Genesis Canary | 48h por ciclo | 10 USDC | Operação, UX, dinâmica social, indexer, crank — **não testa hábito** |
| **1** | Pre-Ceremony Semanal | 7 dias por ciclo | 50 USDC | Hábito de pagamento recorrente, retenção, defaults em cadência realista |

Mainnet beta é fase 2, fora do escopo deste doc — depende dos dados das fases 0 e 1 + smoke + Squads + audit + **grace per-pool on-chain (ver §13).**

---

## 2. Objetivos por fase

### Fase 0 — Genesis Canary

**Pergunta central:** O produto funciona operacionalmente e a dinâmica social é coerente?

Variáveis sob observação: UX (onboarding, clareza de eventos, percepção de progresso), operação (crank reliability em cadência alta, indexer latência, push notifications úteis vs. ruído), dinâmica social (reação do grupo a atrasos, pressão de pares, eficácia do canal de coordenação), confiança (testers entendem o que está acontecendo ciclo a ciclo), mecânica de default (flow compreendido, stake recovery comunicado).

**O que Fase 0 NÃO valida:**

- Taxa de default real (em devnet com USDC mintado, default não dói — números serão artificialmente altos).
- Adesão de longo prazo (20 dias wall-clock não testa hábito).
- Viabilidade econômica do pool (capital simbólico).

### Fase 1 — Pre-Ceremony Semanal

**Pergunta central:** Usuários mantêm pagamento recorrente em cadência realista?

Adicionalmente às variáveis da Fase 0: retenção semanal (on-time payment rate ciclo a ciclo, decay nas 10 semanas), defaults reais (posição no slot vs. probabilidade de default; correlação com engajamento social), comportamento de referral (convidados pagam tão consistentemente quanto convidadores).

---

## 3. Parâmetros por fase

### Fase 0 — Genesis Canary

| Parâmetro | Valor | Fonte / nota |
|---|---|---|
| Denominação | USDC (devnet, mintado) | Valor simbólico — ver §4 |
| Aporte por ciclo | 10 USDC (`10_000_000`) | Faixa 5-15 USDC; valor cosmético |
| `cycle_duration` | 172 800s (48h) | 2× `MIN_CYCLE_DURATION` (`programs/roundfi-core/src/constants.rs:135` = 86 400) |
| Membros por pool | 10 | |
| `cycles_total` | 10 | Pool inteiro em ~20 dias |
| Payout por slot | 100 USDC | |
| Yield strategy | `programs/roundfi-yield-mock` | yield = 0, fluxo CPI preservado |
| Grace period | **24h (= 86 400s)** | **No floor SEV-002 exato** — ver §6.3 |
| Stake (nível 1) | 50% (default) | |

### Fase 1 — Pre-Ceremony Semanal

| Parâmetro | Valor | Fonte / nota |
|---|---|---|
| Denominação | USDC (devnet, mintado) | |
| Aporte por ciclo | 50 USDC (`50_000_000`) | |
| `cycle_duration` | 604 800s (7d) | |
| Membros por pool | 10 | |
| `cycles_total` | 10 | Pool inteiro em ~70 dias |
| Payout por slot | 500 USDC | |
| Yield strategy | `programs/roundfi-yield-mock` | |
| Grace period | **7d (= 604 800s, default)** | Default global on-chain — ver §6.3 |
| Stake (nível 1) | 50% (default) | |

**Nota sobre grace na Fase 1:** com `cycle_duration = 7d` e `GRACE_PERIOD_SECS = 7d`, membro tem um ciclo inteiro de tolerância antes do default cravar. **UX não-ótima.** Aceito como custo da Opção B (§6.3) — solução real (grace per-pool) é pré-req do mainnet beta, não do beta atual.

**Wall-clock total:** ~20 dias (Canary) + ~7 dias análise + ~70 dias (Semanal) ≈ **3 meses**.

---

## 4. Caveats sobre interpretação de dados (devnet)

Esses caveats devem estar visíveis em qualquer apresentação dos dados pro time ou stakeholders externos.

### 4.1 Valor é cosmético em devnet

Tester com 10 USDC mintado se comporta idêntico a tester com 500 USDC mintado em devnet — dinheiro de Monopoly. Aporte baixo é escolhido por: UI realista durante demo, reduz ansiedade visual. **Não reduz fricção financeira real** porque não há fricção financeira em devnet.

### 4.2 Taxa de default do Canary não é preditiva

Em devnet com aporte simbólico, dar calote não dói. Defaults serão artificialmente altos comparados a mainnet. Conclusões válidas:

- ✅ "O mecanismo de detecção de default funciona em X horas após miss"
- ✅ "Stake recovery executa corretamente"
- ✅ "Reação social ao default no Discord segue padrão Y"
- ❌ "Taxa de default esperada em produção é X%"

### 4.3 Hábito só é testado na Fase 1

Ciclo de 48h é stress test operacional, não hábito. Apenas a Fase 1 (7 dias) gera dados sobre aderência recorrente humana.

### 4.4 Seleção dos testers enviesa Fase 1

Os primeiros 10 testers serão do círculo dos founders — alta engajamento, alta tolerância a fricção, viés "early adopter". Se a Fase 1 reusa parte desses testers (provável), o on-time rate da Fase 1 está enviesado pra cima.

Conclusão válida: ✅ "Power users mantêm pagamento semanal." Conclusão **inválida**: ❌ "Usuários em geral mantêm pagamento semanal." Esta segunda pergunta requer amostra externa, fora do escopo do beta atual.

### 4.5 Grace 7d na Fase 1 infla artificialmente o on-time rate

Na Fase 1, `cycle_duration = 7d` e `GRACE_PERIOD_SECS = 7d` significa que um membro pode pagar com até 7 dias de atraso e ainda contar como "em dia". Em mainnet, com grace per-pool apertado (provavelmente 24-48h), o mesmo comportamento marcaria default. Logo:

- ❌ Conclusão **inválida**: "On-time rate da Fase 1 é diretamente comparável ao on-time rate esperado em mainnet."
- ✅ Conclusão **válida**: "On-time rate da Fase 1 é **lower bound** do que ocorreria em mainnet — testers podem estar 'em dia' por terem 7d de cushion que não existirá em produção."

O on-time rate real (apertado) só pode ser medido em fase posterior, com grace per-pool implementado (ver §12).

---

## 5. Escala

Cada fase começa com 1 pool de 10. Critérios para escalar a pools paralelos:

### Fase 0 → +2 pools paralelos na semana 2

**Critérios primários (técnicos, todos obrigatórios):**

- Zero falhas de crank durante 2 semanas
- Indexer lag < 30s no p95
- Zero SEVs abertos (qualquer severity)
- Zero relatos de UX confusion não-resolvidos

**Critérios secundários (sinal, não bloqueador):**

- On-time rate > 70% — usado como contexto, não como gate. Conforme §4.2, esse número é artefato do setup.

### Fase 1 → +2 pools paralelos na semana 4

**Critérios primários:**

- Zero SEVs abertos do Canary (§10 gate)
- Zero falhas de crank na Fase 1 até semana 4
- Indexer lag < 30s p95

**Critérios secundários:**

- On-time rate > 90% nos ciclos 1-3 (aqui sim é sinal útil, porque cadência realista)
- Zero defaults nos 3 primeiros ciclos

---

## 6. Mudanças técnicas necessárias

### 6.1 Pool params — nada a fazer no core

Confirmado em `programs/roundfi-core/src/state/pool.rs:16-20`: `members_target`, `installment_amount`, `cycles_total`, `cycle_duration` já per-pool. Configurar os params da §3 é chamada de `create_pool`.

### 6.2 Yield strategy

Apontar pool para `programs/roundfi-yield-mock` (drop-in com o adapter Kamino conforme header do crate). Pré-fundar `yield_vault` com zero surplus. Resultado: yield = 0, fluxo CPI preservado, Seed Draw exercitado sem drift econômico.

### 6.3 Grace period — Opção B (redeploy devnet entre fases)

**Achado:** `GRACE_PERIOD_SECS = 604_800` em `programs/roundfi-core/src/constants.rs:49` é **constante global on-chain**, consumida em `programs/roundfi-core/src/instructions/settle_default.rs:166-167`. Pool state **não tem** campo `grace_period`. SDK `defaultGraceSec` em `sdk/src/constants.ts:103` é apenas scheduling do cranker, **independente** do que governa default on-chain.

**Implicação:** grace per-pool exige PR sério (account migration, settle_default update, create_pool arg, preserve SEV-002 floor, mexer pinning test). 3-5 dias + FREEZE exception. Fora do escopo do beta atual.

**Solução para o beta — Opção B:**

1. **Fase 0 (Canary):** redeploy devnet com `GRACE_PERIOD_SECS = 86_400` (24h, no floor SEV-002 exato).
2. **Pré-Fase 1:** redeploy devnet com `GRACE_PERIOD_SECS = 604_800` (volta ao default 7d).

**Ajustes obrigatórios para o redeploy do Canary:**

- Ajustar pinning test em `programs/roundfi-core/src/constants.rs:282-291` (`assert_eq!(GRACE_PERIOD_SECS, 604_800)` quebra). Opções: (a) gate com `#[cfg(feature = "devnet-canary")]` ou (b) feature-flag a const inteira.
- Preservar SEV-002 floor check em `constants.rs:364-369` — 86 400 ≥ 86 400 passa (no exato limite, sem margem).
- Custo total: ~0.5 dia engenharia + smoke devnet.

**Honestidade operacional:** cada fase é um devnet generation distinto. Testers da Fase 1 não interagem com pools da Fase 0. Esperado, dado phase gate explícito.

**Margem zero no floor:** se algum momento alguém propor grace < 24h no Canary, **não é viável** sem mexer também em `FLOOR_SECS`. Não fazer isso. SEV-002 existe por razão.

---

## 7. Validação obrigatória antes de cada fase — fuzz fixtures

`crates/math/fuzz/fuzz_targets/` tem 6 targets confirmados: `bps.rs`, `cascade.rs`, `dc_invariant.rs`, `escrow_vesting.rs`, `seed_draw.rs`, `waterfall.rs`. **Todos os 6 são gate**.

**Nota de honestidade:** `grace_period` **não entra nos fixtures** porque o math crate não o consome — grace é exclusivamente um timing gate em `programs/roundfi-core/src/instructions/settle_default.rs:166-167`, não em `crates/math/`. Confirmado via `grep -rn "grace" crates/math/` (zero hits). Listar `grace_period` aqui seria prometer cobertura que o fuzz não exercita. Validação do timing grace × cycle_duration × clock fica para integration tests (bankrun), não para o math fuzz.

### 7.1 Antes da Fase 0 (Genesis Canary)

```
installment = 10_000_000  (10 USDC)
cycle_duration = 172_800  (48h)
cycles_total = 10
members_target = 10
stake_bps = 5000
yield_apy = 0
```

1M iterações por target. **Bloqueia start do Canary.**

### 7.2 Antes da Fase 1 (Pre-Ceremony Semanal)

```
installment = 50_000_000  (50 USDC)
cycle_duration = 604_800  (7d)
cycles_total = 10
members_target = 10
stake_bps = 5000
yield_apy = 0
```

Mesmos 6 targets, 1M iterações. **Bloqueia start da Fase 1.**

---

## 8. Sistema de referral — off-chain

### 8.1 Decisão arquitetural

Pre-audit: referral em DB do indexer/backend, com admin attestation. Pós-audit: migração para on-chain via ADR separado (§11).

### 8.2 Schema

```
referrals (
  invitee_pubkey       PUBKEY PRIMARY KEY,
  inviter_pubkey       PUBKEY NOT NULL,
  pool_address         PUBKEY NOT NULL,
  joined_at            TIMESTAMP NOT NULL,
  cycles_paid          INT DEFAULT 0,
  defaulted            BOOLEAN DEFAULT FALSE,
  admin_attested_by    PUBKEY NOT NULL,
  attested_at          TIMESTAMP NOT NULL
);
```

### 8.3 Regras de XP

| Evento | XP convidado | XP convidador |
|---|---|---|
| Convidado joina o pool | +50 | 0 (vesting) |
| Convidado completa 1 ciclo | 0 | +20 |
| Convidado dá default | -500 (existente on-chain — `programs/roundfi-reputation/src/constants.rs:55`) | -100 (off-chain) |
| Cap convidados ativos por wallet | n/a | 3 |

### 8.4 Custo operacional — build cost listado

30 testers × Fase 0 (10 ciclos) = 30 join attests + ~300 cycle attests = **~330 admin txs por fase**. Devnet SOL = ~0.1 SOL (trivial), mas exige automação:

- **Build obrigatório:** `scripts/devnet/referral-cycle-attest.ts` — batch attest pós-fechamento de cada ciclo.
- **Dashboard interno:** founders aprovam join attests manualmente nos primeiros 10 testers.
- **Idempotência:** script tem que ser safe-to-rerun (chave única `(invitee, pool, cycle)`).

Sem o script, founders fazem 330 cliques por fase = não rola.

### 8.5 Nota para o Canary

Com ciclos de 48h, vesting do convidador acelera: 100 XP em ~2,5 semanas (em vez de ~10 semanas na Semanal). Não muda lógica, mas é dado relevante para análise.

---

## 9. Riscos e mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| Conclusões erradas sobre default rate em produção | Alta | §4 explícito em todas as apresentações |
| Crank/indexer não aguenta cadência 48h | Alta | Fuzz §7.1 + smoke test antes do Canary |
| Default em slot inicial inviabiliza pool | Média (validar via fuzz) | Bloqueado por §7 fuzz fixture |
| Centralização off-chain do referral contradiz narrativa | Média | Comunicação explícita + ADR de migração |
| **Team operational fatigue** | **Média** | Ver §9.1 — validar capacidade ops antes de start |
| Grace 24h no floor SEV-002 dá margem zero | Média | Aceito; documentar. Não baixar abaixo de 24h. |
| Tester abandona após 2-3 ciclos do Canary (fadiga) | Baixa | Sinal válido — fadiga em cadência alta é dado. Documentar como aprendizado, não como problema. |

### 9.1 Team operational fatigue

3 meses de Canary + Semanal sobrepostos, com escala potencial para até 3 pools paralelos = até **90 pessoas em onboarding/support sobrepostos**. A proposta v0.3 tratava como "1 team rodando 1 thing" — falha de planejamento.

**Validação obrigatória antes de start da Fase 0:**

- [ ] Time tem **2+ pessoas** cobrindo on-call rotation durante a janela do beta (3 meses + férias + doença + travel — 1 pessoa é SPOF garantido)
- [ ] Testers serão self-serve via app ou exigem hand-holding manual?
- [ ] Se hand-holding manual, capacidade ops do time limita N de testers — ajustar §5 critério de escala em consonância
- [ ] Crank monitoring é automated (alertas) ou requer human-in-loop?

Se respostas indicam capacidade < demanda, **reduzir escopo** (1 pool por fase, sem paralelismo) antes de start, não no meio.

### 9.2 Procedimento de aborto mid-flight

Cenário: SEV aparece no ciclo 4 do Canary (de 10). O que fazer?

**Política:**

- **Pausar o pool em curso** (não permitir novos `contribute`/`claim_payout` até decisão).
- **Decisão técnica do lead eng**, não democrática. Opções:
  - (a) Fix + redeploy + retomar pool do mesmo ponto (se fix preserva estado).
  - (b) Abortar fase, refund devnet USDC (trivial, mintado), reiniciar fase pós-fix.
- **Trigger automático de pausa:** qualquer SEV ≥ Medium descoberto durante a fase.
- **Comunicação aos testers:** dentro de 24h, no canal dedicado, com plano de retomada ou aborto.

Refunds em devnet são triviais (USDC mintado), mas o procedimento de comunicar testers e re-onboard precisa estar pré-escrito antes do start.

---

## 10. Checklist de implementação

### Pré-Fase 0 (gates de engenharia)

- [ ] Confirmar capacidade ops do time, **2+ pessoas em on-call rotation** (§9.1) — bloqueador
- [ ] **Owner do fuzz atribuído** (nome) — bloqueador para §7
- [ ] **Procedimento de aborto mid-flight pré-escrito** (§9.2) — bloqueador
- [ ] Backend de referral off-chain implementado (DB + admin attest dashboard + `scripts/devnet/referral-cycle-attest.ts`)
- [ ] Redeploy devnet com `GRACE_PERIOD_SECS = 86_400` + pinning test gateado (§6.3)
- [ ] **Fuzz fixture Canary nos 6 targets, 1M iterações cada — bloqueia start**
- [ ] Smoke test em devnet local com 10 wallets simuladas, 1 ciclo completo

### Fase 0 — Genesis Canary (~20 dias wall-clock)

- [ ] Seleção dos 10 testers
- [ ] Termo de participação (experimento devnet, valor simbólico, fadiga esperada, dados sob caveats §4)
- [ ] Canal dedicado (Discord/Telegram)
- [ ] Métricas tracking: on-time rate, crank lag, indexer latência, observação social, NPS qualitativo
- [ ] Análise pós-Canary

### Pré-Fase 1 (gates de engenharia)

- [ ] **Zero SEVs abertos do Canary** (gate técnico, não decisão de produto)
- [ ] Ajustes de UX/operação identificados no Canary aplicados
- [ ] Redeploy devnet com `GRACE_PERIOD_SECS = 604_800` (volta ao default)
- [ ] **Fuzz fixture Semanal nos 6 targets, 1M iterações cada — bloqueia start**

### Fase 1 — Pre-Ceremony Semanal (~70 dias wall-clock)

- [ ] Seleção dos 10 testers (composição definida — ver §13 Q2)
- [ ] Termo atualizado
- [ ] Métricas: on-time rate semanal, defaults, retenção, XP de referral, NPS

### Pós-beta

- [ ] Relatório consolidado das duas fases com caveats §4 visíveis
- [ ] **ADR de migração referral on-chain** (§11)
- [ ] **ADR de grace per-pool on-chain** (§13) — pré-req do mainnet beta
- [ ] Decisão sobre mainnet beta pós-audit

---

## 11. ADR pendente — Migração de referral off-chain para on-chain

Inalterado. Após beta:

- Novo ADR em `docs/adr/0008-referral-on-chain-migration.md`
- Schema final de `Member.inviter` + counters
- Path de migração: instrução administrativa "bootstrap reputation" com snapshot off-chain → freeze → emissão on-chain → unfreeze

---

## 12. Dependência forward — grace per-pool on-chain (mainnet beta)

A Opção B (§6.3) resolve o beta atual via redeploy devnet, mas **não escala para mainnet**. Para mainnet beta, grace per-pool tem que ser on-chain real.

- Novo ADR a criar (número depende da última ADR mergeada em main no momento da criação — ver nota abaixo)
- Mudanças: campo `grace_period: i64` em `Pool`, leitura em `settle_default`, arg em `create_pool`, preservar SEV-002 floor (`grace_period >= 86_400`), atualizar pinning test
- Tratado como SEV-equivalent: account migration ou versionamento de Pool, FREEZE exception, re-escopo de audit surface
- Custo estimado: 3-5 dias engenharia + ciclo de review

**Não é escopo do beta atual** — registrado aqui para que o mainnet beta não seja surpreendido.

**Nota sobre numeração de ADR (§11 e §12):** confirmado via `git ls-tree -r origin/main -- docs/adr/` em 2026-05-21 — última ADR em main é `0007-bankrun-compat-shim.md`. Os números 0008 (referral migration) e 0009 (grace per-pool) estão **provisoriamente reservados** nesta proposta, mas reviewer indicou que ADR 0008 (`treasury-custody-squads-multisig`) pode estar em PR aberto não-mergeado. **Antes de criar os ADRs, confirmar PRs abertos em `docs/adr/` e shiftar números conforme necessário.**

---

## 13. Perguntas abertas remanescentes

1. **§5 — Threshold de "zero SEVs do Canary":** literal zero, ou exclui Low/Info? Recomendo literal zero pré-mainnet.
2. **§10 — Composição dos 10 testers da Fase 1:** mesmos 10 do Canary, rotação parcial, ou totalmente novos? Trade-off: continuidade vs. sinal de "primeira experiência".
3. **Comunicação externa:** público (anúncio comunidade) ou privado (founders + indicados)?
4. **§8 — XP cap por convidador:** 3 ativos ou 3 totais lifetime?
5. **§9.1 — Critério de redução de escopo:** se ops capacity é limitada, reduzir N de testers ou reduzir N de pools?

**Notas:** Q4 ("Owner do fuzz") da v0.4 foi promovida a item de checklist em §10 (bloqueador, não open question).

---

## 14. O que mudou de v0.4 para v0.4.1

| Ponto v0.4 → v0.4.1 |
|---|
| §4.5 nova: caveat de que on-time rate da Fase 1 é lower bound, não diretamente comparável a mainnet (grace 7d = ciclo inteiro de cushion) |
| §7 honesty fix: removido `grace_period` dos fixtures porque math crate não consome (confirmado via `grep -rn "grace" crates/math/` = zero hits). Validação de timing fica para integration tests, não para math fuzz |
| §9.1 endurecido: "2+ pessoas em on-call rotation" em vez de "1+ pessoa dedicada" — 3 meses + férias/doença/travel = 1 pessoa é SPOF |
| §9.2 nova: procedimento de aborto mid-flight pré-escrito (pausa automática em SEV ≥ Medium, decisão técnica do lead eng, comunicação aos testers em ≤24h) |
| §10 Pré-Fase 0: "Owner do fuzz atribuído" e "Procedimento de aborto pré-escrito" promovidos a checklist bloqueador (eram open questions / não existiam) |
| §13 Q4 ("Owner do fuzz") removido — virou checklist |
| §12 nota sobre ADR numbering: 0008/0009 estão **provisoriamente reservados**. Antes de criar, confirmar PRs abertos em `docs/adr/` — reviewer indicou possível ADR 0008 em PR não-mergeado (não encontrado em `origin/main` via `git ls-tree` em 2026-05-21) |

**v0.4 está obsoleta. Substituída por esta v0.4.1.**

## Histórico de versões

- v0.4.1 (2026-05-21): honesty fix no fuzz, §4.5 lower bound, §9.2 aborto mid-flight, gates promovidos.
- v0.4: grace per-pool reformulado (Opção B), 6 fuzz targets, team fatigue, selection bias.
- v0.3: Genesis Canary como fase 0, caveats de devnet.
- v0.2: USDC, yield-mock, referral off-chain, fuzz fixture obrigatória.
- v0.1: rascunho inicial (obsoleto — assumiu pool params hardcoded incorretamente).
