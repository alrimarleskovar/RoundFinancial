# Pre-Ceremony Beta — Proposta de Design (v0.5.3)

**Status:** rascunho para discussão de time
**Versão:** 0.5.3 — separação de poderes em §9.2 (severidade vem da rubrica, não do lead eng)
**Data alvo de decisão:** TBD
**Mudanças vs. v0.5.2:** ver §15

Todas as referências `arquivo:linha` desta versão foram confirmadas via grep direto.

---

## 1. Decisão de produto

Beta em devnet primeiro, dividido em duas fases sequenciais com **dois devnet generations distintos** (ver §6.3):

| Fase | Nome | Cadência | Aporte | Foco |
|---|---|---|---|---|
| **0** | Genesis Canary | 48h por ciclo | 10 USDC | Operação, UX, dinâmica social, indexer, crank — **não testa hábito** |
| **1** | Pre-Ceremony Semanal | 7 dias por ciclo | 50 USDC | Hábito de pagamento recorrente, retenção, defaults em cadência realista |

Mainnet beta é fase 2, fora do escopo deste doc — depende dos dados das fases 0 e 1 + smoke + Squads + audit + **grace per-pool on-chain (ver §12).**

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

### Regra de SEV gate (aplicada em todos os gates abaixo e em §10)

Padrão derivado de Mozilla/OWASP/Chromium, **endurecido para o gate de fase**: block-on-Critical/High/Medium, fix-plan-com-deadline-on-Low, ignore Info. O endurecimento de Medium (block em vez de deadline) reflete que o beta é pré-mainnet — Medium em produção web pode esperar, Medium pré-mainnet bloqueia.

```
SEV gate passa ⟺
  count(Critical + High + Medium abertos) == 0
  AND  todos os Low abertos têm fix-plan em tracker
       (issue com assignee + due date ≤ 30 dias)
  AND  Info ignorado (literalmente informacional)
```

Rubrica de severidade: `docs/security/internal-audit-findings.md`. Formato do fix-plan: GitHub issue com label `sev-low-deadline-canary`, assignee, due date em milestone. Gate passa quando issue tem assignee + due date — não exige resolução, exige plano.

Literal-zero (incluindo Low) foi descartado: mascara prioridades reais e cria fadiga em Lows que muitas vezes são style nits ou doc gaps.

### Fase 0 → +2 pools paralelos na semana 2

**Critérios primários (técnicos, todos obrigatórios):**

- Zero falhas de crank durante 2 semanas
- Indexer lag < 30s no p95
- **SEV gate passa** (regra acima)
- Zero relatos de UX confusion não-resolvidos

**Critérios secundários (sinal, não bloqueador):**

- On-time rate > 70% — usado como contexto, não como gate. Conforme §4.2, esse número é artefato do setup.

### Fase 1 → +2 pools paralelos na semana 4

**Critérios primários:**

- **SEV gate passa** do Canary (regra acima, §10 gate)
- Zero falhas de crank na Fase 1 até semana 4
- Indexer lag < 30s p95

**Critérios secundários:**

- **On-time rate estrito** > 90% nos ciclos 1-3. Definição: pagamento dentro de `cycle_duration / 2` (3,5 dias na Fase 1), não dentro do grace permissivo de 7d. Sem essa definição estrita, "on-time" inclui pagamento até 7d de atraso (per §4.5) e o número fica inflado.
- Zero defaults nos 3 primeiros ciclos

**Por que medir on-time estrito:** o sistema indexer registra `paid_at`, então a métrica é trivial de computar pós-fato. Em mainnet (com grace per-pool apertado em ~24-48h), o on-time real será mais perto do estrito do que do permissivo. Reportar ambos no relatório: bruto (signal positivo pro produto) e estrito (signal previsivo pro mainnet).

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
| Cap convidados ativos por wallet | n/a | **3 ativos (beta).** Decisão final (cap híbrido: `≤3 ativos AND ≤N lifetime` escalonado por reputation level) fica para ADR de migração on-chain pós-beta — decide com data, não vibes. Sybil em devnet é trivial farmar de qualquer jeito (USDC mintado, contas grátis); endurecimento real só faz sentido em mainnet. |

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

**Direção da redução de escopo — manter pool unit = 10, reduzir paralelismo:**

- Pool unit (10 membros) é **load-bearing pro design**: `members_target = cycles_total = 10`, fuzz fixtures pinadas em `members_target = 10`, default cascade calibrada (1 default em pool de 10 = 10% vs. 12.5% em pool de 8), waterfall denominador, stake share per member. Reduzir tamanho invalida comparação com mainnet (`MAX_MEMBERS = 64`).
- Paralelismo é **amplificador removível** — se ops capacity melhorar mid-flight, escalar de 1 para 3 pools é fácil. **Voltar de 8 → 10 membros mid-pool é impossível** sem re-formar membership.
- Signal cleanliness > signal quantity em beta pequeno: 10 trajetórias com dinâmica autêntica > 24 trajetórias com dinâmica atípica.
- Narrativa externa mais limpa: "1 pool de 10" é coerente; "3 pools de 8" exige explicação.

**Regra:** se ops capacity força redução, manter pool unit, sacrificar paralelismo.

### 9.2 Procedimento de aborto mid-flight

Cenário: SEV aparece no ciclo 4 do Canary (de 10). O que fazer?

**Política:**

- **Pausar o pool em curso** (não permitir novos `contribute`/`claim_payout` até decisão).
- **Trigger automático de pausa:** qualquer SEV ≥ Medium descoberto durante a fase.
- **Separação de poderes:** lead eng decide **ação** (pause / fix / abort), mas **não decide severidade**. Severidade vem da rubrica em `docs/security/internal-audit-findings.md`. Se rubrica classifica Critical/High/Medium, gate dispara automaticamente — independente de quem achou o SEV ou quem é o lead eng. Isso fecha o COI estrutural entre quem descobre o SEV (ex: security engineer) e quem decide aborto do trabalho que ele próprio empurrou.
- **Decisão técnica do lead eng**, não democrática. Opções:
  - (a) Fix + redeploy + retomar pool do mesmo ponto (se fix preserva estado).
  - (b) Abortar fase, refund devnet USDC (trivial, mintado), reiniciar fase pós-fix.
- **Comunicação aos testers:** dentro de 24h, no canal dedicado, com plano de retomada ou aborto.

Refunds em devnet são triviais (USDC mintado), mas o procedimento de comunicar testers e re-onboard precisa estar pré-escrito antes do start.

---

## 10. Checklist de implementação

### Pré-Fase 0 (gates de engenharia)

**Nomeações e ownership (P1):**

- [ ] Confirmar capacidade ops do time, **2+ pessoas em on-call rotation** (§9.1) — bloqueador
- [ ] **Lead eng nomeado** (pode ser mesma pessoa do fuzz owner) — bloqueador para §9.2 "decisão técnica do lead eng"
- [ ] **Owner do fuzz atribuído** (nome) — bloqueador para §7
- [ ] **Procedimento de aborto mid-flight pré-escrito** (§9.2) — bloqueador

**Setup de tracking e ferramentas (P1+P2):**

- [ ] **GitHub label `sev-low-deadline-canary` criada** no repo (referenciada pelo SEV gate §5) — 1 clique mas precisa existir antes
- [ ] **Discord/Telegram channel criado + bot de auto-tracking de mensagens** — composite score de §10 D2 requer `discord_messages` logado desde dia 1; sem bot, a fórmula min-max vira teatro
- [ ] **Push notification infra confirmada** (existe? envia? testers recebem?) — §2 lista push notifications como variável observada; sem infra, variável não é observável

**Build de software (P1):**

- [ ] Backend de referral off-chain implementado (DB + admin attest dashboard + `scripts/devnet/referral-cycle-attest.ts`)
- [ ] **Termo de participação escrito** (template) — pré-req para recrutar testers; não pode esperar até Fase 0 começar
- [ ] **Onboarding doc/script pra testers** — sem doc escrito, hand-holding manual = ops fatigue real (§9.1)

**Infra devnet (P1):**

- [ ] Redeploy devnet com `GRACE_PERIOD_SECS = 86_400` + pinning test gateado (§6.3)
- [ ] **Cranker rodando + configurado para `cycle_duration = 172_800`** — sem cranker ativo, ciclo não avança = beta morre no dia 1
- [ ] **Indexer apontado pros novos program IDs** do redeploy — IDs antigos = zero metrics
- [ ] **Tester wallet provisioning resolvido** — devnet USDC via faucet (validar que funciona) ou team mint + distribute

**Validação (P1+P2):**

- [ ] **Fuzz fixture Canary nos 6 targets, 1M iterações cada — bloqueia start**
- [ ] **Flow de "smoke test surfa SEV ≥ Medium" pré-escrito** — smoke existe pra achar problemas; se achar, re-spin Pré-Fase 0 inteiro ou só fix + re-smoke?
- [ ] Smoke test em devnet local com 10 wallets simuladas, 1 ciclo completo

### Fase 0 — Genesis Canary (~20 dias wall-clock)

- [ ] Seleção dos 10 testers (círculo founders, recrutamento direto)
- [ ] Termo de participação: experimento devnet, valor simbólico, fadiga esperada, dados sob caveats §4, **Canary é silent — sem posts públicos sobre o experimento durante a fase**
- [ ] Canal dedicado (Discord/Telegram)
- [ ] Métricas tracking: on-time rate, crank lag, indexer latência, observação social, NPS qualitativo
- [ ] Análise pós-Canary

### Pré-Fase 1 (gates de engenharia + recrutamento público)

**Gates de engenharia:**

- [ ] **SEV gate do Canary passa** (regra §5 — block on Critical/High/Medium, deadline ≤30d em Low)
- [ ] Ajustes de UX/operação identificados no Canary aplicados
- [ ] Redeploy devnet com `GRACE_PERIOD_SECS = 604_800` (volta ao default)
- [ ] **Fuzz fixture Semanal nos 6 targets, 1M iterações cada — bloqueia start**

**Seleção de testers (composição 3 vets + 7 newbies — §13 D2):**

- [ ] 3 vets selecionados via composite score do Canary: `(on_time_rate × 0.6) + (discord_messages_normalized × 0.4)`. Pegar top 5, escolher 3 dispostos a continuar.
  - **Normalização:** min-max em [0,1] sobre o universo do Canary (`x_norm = (x - min) / (max - min)`). `on_time_rate` já está em [0,1] (não precisa normalizar). `discord_messages` é min-max sobre o count total da fase.
  - **Tie-breaker:** se composite score empata, preferir tester com mais ciclos completos sem default. Se ainda empata, decisão do lead de produto.
- [ ] Landing page de application publicada (build cost ~3-5 dias marketing/ops)
- [ ] Post público "Genesis Canary learnings + Fase 1 aberta": anuncia learnings do Canary, abre application pros 7 newbies
- [ ] 7 newbies recrutados via apps externas — critério de filtro a definir (mínimo: wallet ativa em devnet há ≥7d, sem sinal de sybil)
- [ ] Slot allocation espalhada: **vets nos slots 1, 5, 9** (cada subgroup vive ambas as experiências — esperar e receber)

### Fase 1 — Pre-Ceremony Semanal (~70 dias wall-clock)

- [ ] Termo atualizado (inclui exposição pública via posts quinzenais; tester ciente do nome aparecer em comunicação externa, opt-out disponível)
- [ ] Cadência quinzenal de marker posts públicos durante Fase 1
- [ ] Métricas: on-time rate semanal, defaults, retenção, XP de referral, NPS
- [ ] **Segmentação obrigatória de metrics por subgroup (vets vs. newbies)** — relatório pós-Fase 1 separa as duas cohorts

### Pós-beta

- [ ] Relatório consolidado das duas fases com caveats §4 visíveis
- [ ] **ADR de migração referral on-chain** (§11)
- [ ] **ADR de grace per-pool on-chain** (§13) — pré-req do mainnet beta
- [ ] Decisão sobre mainnet beta pós-audit

### Critical path do Pré-Fase 0 (sequência recomendada)

Critical path ordenado por dependências reais. Premissa: 1-2 devs dedicados.

```
Dia 1-2  │ Nomeações: lead eng + fuzz owner + 2 on-call
         │ Confirmar ADR numbering (depende do merge da treasury branch)
         │ Criar label sev-low-deadline-canary (1 clique)
         │ Draft do procedimento de aborto (§9.2)
         │ Draft do flow "SEV no smoke test" (§10)
         │
Dia 3-5  │ Redeploy devnet com GRACE_PERIOD_SECS = 86_400
         │   ├── Pinning test gate (cfg feature)
         │   └── Smoke devnet 1 ciclo completo (canário do canário)
         │ Cranker apontado pra new generation + cycle 48h
         │ Indexer apontado pros novos program IDs
         │ Push notification infra validada
         │
Dia 5-8  │ ⚡ Bottleneck: Backend de referral
         │              (DB + dashboard + referral-cycle-attest.ts)
         │              ~3 dias eng sólidos
         │
Dia 8-11 │ ⚡ Bottleneck: Fuzz Canary fixture, 6 targets × 1M iter
         │              ~24-48h compute + análise de findings
         │
Dia 11-13│ Termo + onboarding doc + selecionar 10 testers (círculo founders)
         │ Tester wallet provisioning (USDC mint + distribute)
         │ Discord channel + bot de auto-tracking ativos
         │
Dia 13-14│ Smoke "ensaio geral" com 10 wallets simuladas, 1 ciclo
         │ — confirmar TODOS os items de §10 Pré-Fase 0 verdes
         │
Dia 15   │ START Canary
```

**Bottlenecks reais:**

1. **Backend de referral (~3 dias eng)** — item de software de maior peso. Pode paralelizar com redeploy se for genérico (não codifica program IDs). Se hardcoda IDs, ordem fica: redeploy → backend.
2. **Fuzz (~24-48h compute + análise)** — não é eng work, mas é wall-clock. Pode rodar em background enquanto backend é construído.
3. **ADR numbering** — depende do merge da branch `claude/setup-copilot-api-config-PuGXP`. **Não bloqueia execução do beta**, só a redação dos ADRs pós-beta.

**Sequência viável:**

- 1 dev dedicado: ~3 semanas até start
- 2 devs (paralelizando backend + infra devnet): ~2 semanas até start

**Não recomendado:** sobrepor mais de 2 bottlenecks simultaneamente. Riscos de qualidade > ganho de wall-clock.

---

## 11. ADR pendente — Migração de referral off-chain para on-chain

Inalterado. Após beta:

- Novo ADR a criar — **número 0009 confirmado** (ver nota de numeração atualizada em §12)
- Schema final de `Member.inviter` + counters
- Path de migração: instrução administrativa "bootstrap reputation" com snapshot off-chain → freeze → emissão on-chain → unfreeze

---

## 12. Dependência forward — grace per-pool on-chain (mainnet beta)

A Opção B (§6.3) resolve o beta atual via redeploy devnet, mas **não escala para mainnet**. Para mainnet beta, grace per-pool tem que ser on-chain real.

- Novo ADR a criar — **número 0010 confirmado** (ver nota de numeração atualizada abaixo)
- Mudanças: campo `grace_period: i64` em `Pool`, leitura em `settle_default`, arg em `create_pool`, preservar SEV-002 floor (`grace_period >= 86_400`), atualizar pinning test
- Tratado como SEV-equivalent: account migration ou versionamento de Pool, FREEZE exception, re-escopo de audit surface
- Custo estimado: 3-5 dias engenharia + ciclo de review

**Não é escopo do beta atual** — registrado aqui para que o mainnet beta não seja surpreendido.

**Nota sobre numeração de ADR (§11 e §12) — atualizada 2026-05-23:** confirmado via `git ls-tree -r origin/main -- docs/adr/` em 2026-05-23 — main agora contém ADRs `0001-0008`, sendo `0008-treasury-custody-squads-multisig.md` mergeada via PR #401 (2026-05-23, item 8 do FREEZE.md — governance ADR). Numeração desta proposta consolidada: **0009 = referral migration (§11)**, **0010 = grace per-pool (§12)**. Provisorialidade removida — numbers travados.

---

## 13. Decisões tomadas (resoluções das 5 perguntas abertas da v0.4.2)

Time fechou as 5 perguntas abertas em 2026-05-21. Cada decisão está incorporada ao corpo do doc (§5, §8, §9, §10) — esta seção preserva o rastro do raciocínio.

**D1 — SEV gate (era Q1): block Critical/High/Medium, deadline ≤30d em Low, ignore Info.**

Padrão Mozilla/OWASP/Chromium. Literal-zero foi descartado: Lows muitas vezes incluem style nits, doc gaps, coverage observations — bloquear Fase 1 por isso cria fadiga e mascara o que é Critical real. Trade-off honesto: Low permissive pode acumular dívida técnica; mitigação = deadline de 30d força clearing antes ou no decorrer da Fase 1. Regra completa em §5.

**D2 — Composição da Fase 1 (era Q2): 3 vets + 7 newbies, com critério mensurável e slot allocation espalhada.**

3 vets como âncoras sociais reduzem fricção de onboarding dos newbies e modelam comportamento esperado. 7 newbies como sinal de "first experience" sem 20 dias de muscle memory. Mantém amostra de 10 (não complica fuzz, não muda mechanics). Vets não-rotacionados vão para pool paralelo se §5 critérios baterem.

- Critério mensurável: composite score `(on_time_rate × 0.6) + (discord_messages_normalized × 0.4)`, top 5 → 3 dispostos a continuar
- Slot allocation: vets nos slots 1, 5, 9 — cada subgroup vive ambas as experiências (esperar + receber payout)
- Segmentação de metrics por subgroup é obrigatória no relatório (§10)

**D3 — Comunicação externa (era Q3): híbrido — Canary silent, Fase 1 semi-pública.**

Canary é silent (sem posts públicos durante) — stress test interno, alto risco de SEVs descobertos em devnet, blast radius limitado. Post público pré-Fase 1 anuncia "Genesis Canary learnings + Fase 1 aberta" e funciona como funil de recrutamento dos 7 newbies (resolve D2 e D3 simultaneamente — sem público, newbies vêm do círculo founders e o bias volta). Cadência quinzenal de marker posts durante Fase 1. Build cost: ~3-5 dias marketing/ops (não engenharia).

**D4 — Cap de referral (era Q4): 3 ativos no beta, cap híbrido decide com data via ADR de migração.**

Permite power-user genuíno (tester completa pool, slot libera, convida +1). Sybil em devnet é trivial farmar de qualquer jeito (USDC mintado, contas grátis) — endurecimento real só faz sentido em mainnet. Decisão final (`≤3 ativos AND ≤N lifetime` escalonado por reputation level) precisa de DATA do beta, não vibes. Se durante beta alguém farmar 30 referrals via rotação, isso é o sinal que justifica o cap híbrido no ADR.

**D5 — Direção de redução de escopo (era Q5): manter pool unit = 10, reduzir paralelismo.**

Pool unit é load-bearing pro design (fuzz fixtures pinadas em `members_target = 10`, default cascade calibrada em 10%, waterfall denominador, comparação com mainnet `MAX_MEMBERS = 64`). Paralelismo é amplificador removível — escalar +2 pools é fácil; voltar de 8→10 mid-pool é impossível sem re-formar membership. Signal cleanliness > signal quantity. Regra completa em §9.1.

---

## 14. Decisões finas remanescentes (não bloqueadores)

Itens de execução que valem registro explícito mas não bloqueiam start:

1. **Formato do fix-plan de Low SEV (§5):** GitHub issue com label `sev-low-deadline-canary` (label criada como item de §10 Pré-Fase 0), assignee, due date em milestone. Gate passa quando issue tem assignee + due date — não exige resolução.
2. **Critério de filtro dos newbies (§10 Pré-Fase 1):** wallet ativa em devnet há ≥7d, sem sinais óbvios de sybil. Time pode endurecer durante recrutamento.
3. **Opt-out de exposição pública (§10 Fase 1):** posts quinzenais mencionam testers — termo de participação inclui opção de aparecer anônimo ou opt-out completo.
4. **Slot allocation com vets em slots 1, 5, 9 (§10 Pré-Fase 1):** ordem fixa pré-decidida no protocolo, não negociada com testers. Comunicar como dado, não como escolha.

---

## 15. O que mudou de v0.5.2 para v0.5.3

| Ponto v0.5.2 → v0.5.3 |
|---|
| **§9.2 separação de poderes:** lead eng decide ação (pause / fix / abort), mas **não decide severidade**. Severidade vem da rubrica em `docs/security/internal-audit-findings.md`. Fecha COI estrutural entre quem descobre SEV e quem decide aborto. Trigger automático passa a ser independente do julgamento do lead. |

**Nota explícita:** este é o último patch de design previsto. v0.5.3 trava o doc. Próxima mudança vira execução (PRs do critical path em §10) ou nova versão do **produto**, não da doc.

**v0.5.2 está obsoleta. Substituída por esta v0.5.3.**

## 16. O que mudou de v0.5.1 para v0.5.2

| Ponto v0.5.1 → v0.5.2 |
|---|
| **§10 Pré-Fase 0 reestruturado em 5 grupos:** nomeações/ownership, setup de tracking, build de software, infra devnet, validação. 9 items operacionais adicionados que estavam implícitos em §2/§4 mas faltavam na checklist. |
| **Novos itens P1 (bloqueadores):** lead eng nomeado (§9.2 cita mas não nomeava), cranker rodando + configurado pra 48h (sem ele, ciclo não avança), indexer apontado pros novos program IDs (redeploy quebra IDs antigos), termo de participação escrito (pré-req para recrutar), tester wallet provisioning (faucet ou team mint). |
| **Novos itens P2 (não-blocker imediato, evita re-trabalho):** Discord bot de auto-tracking de mensagens (sem dados desde dia 1, fórmula min-max do §10 D2 vira teatro), push notification infra (§2 lista como variável observada), onboarding doc/script, flow de "SEV no smoke test" pré-escrito. |
| **Nova subseção §10 — Critical path do Pré-Fase 0:** sequência ordenada por dependências (Dia 1-15), com bottlenecks explícitos (backend referral ~3 dias eng, fuzz ~24-48h compute, ADR numbering depende de merge externo). Sequência viável: 2-3 semanas até start. |
| **Microcorreção de ordering:** backend de referral antes ou depois do redeploy depende de ser genérico vs. codificar program IDs. Critical path coloca redeploy primeiro por segurança; se backend for genérico, paraleliza. |

**v0.5.1 está obsoleta. Substituída por esta v0.5.2.**

## 17. O que mudou de v0.5 para v0.5.1

| Ponto v0.5 → v0.5.1 |
|---|
| **§5 inconsistência corrigida:** prosa dizia "block-on-Critical/High, deadline-on-Medium, backlog-on-Low" mas o gate formal era `count(Critical+High+Medium abertos) == 0`. Medium aparecia em dois lados (block e deadline). Prosa agora diz "endurecido para o gate de fase: block-on-Critical/High/Medium, fix-plan-com-deadline-on-Low, ignore Info" — alinha com o gate e justifica o endurecimento (beta é pré-mainnet). |
| **§5 Fase 1 critério secundário endurecido:** "on-time rate > 90%" virou "**on-time rate estrito** > 90%", definido como pagamento dentro de `cycle_duration / 2` (3,5d na Fase 1), não dentro do grace permissivo de 7d. Resolve a tensão com §4.5. Relatório reporta ambos (bruto + estrito). |
| **§10 Pré-Fase 0 novo item:** criar GitHub label `sev-low-deadline-canary` que o SEV gate de §5 referencia. 1 clique, mas precisa existir antes do gate ser avaliável. |
| **§10 Pré-Fase 1 spec de normalização:** `discord_messages_normalized` agora especificado como min-max em [0,1] sobre o universo do Canary. `on_time_rate` já está em [0,1]. Tie-breaker explícito (mais ciclos sem default → decisão do lead). |

## 18. O que mudou de v0.4.2 para v0.5

| Ponto v0.4.2 → v0.5 |
|---|
| §5 nova subseção: regra de SEV gate (Mozilla/OWASP/Chromium pattern) — block Critical/High/Medium, deadline ≤30d Low, ignore Info. Substitui "Zero SEVs (qualquer severity)" da v0.4.2 |
| §8.3 célula de cap reformulada: 3 ativos no beta, com nota explícita sobre cap híbrido (`≤3 ativos AND ≤N lifetime`) decidir via ADR pós-beta |
| §9.1 nova regra explícita: manter pool unit = 10, reduzir paralelismo se ops capacity força redução. Inclui justificativa técnica completa |
| §10 Fase 0: termo de participação inclui "Canary é silent — sem posts públicos durante" |
| §10 Pré-Fase 1 reformulado: composite score pra seleção dos 3 vets, landing page de application + post público pros 7 newbies, slot allocation em 1/5/9 |
| §10 Fase 1: cadência quinzenal de marker posts + segmentação obrigatória de metrics por subgroup |
| §13 reformulado: virou "Decisões tomadas" com 5 resoluções (D1-D5) preservando rastro do raciocínio |
| §14 nova: 4 decisões finas remanescentes (formato fix-plan, filtro newbies, opt-out público, comunicação do slot allocation) |
| Bugs preexistentes corrigidos: header dizia "v0.4" mas versão era 0.4.2; havia dois "## 14." duplicados; referência §13 na §1 era de fato §12 (grace per-pool) |

**v0.4.2 está obsoleta. Substituída por esta v0.5.**

## 19. O que mudou de v0.4.1 para v0.4.2

| Ponto v0.4.1 → v0.4.2 |
|---|
| §11 alinhado ao mesmo padrão flexível de §12 — número 0008 marcado como provisório com referência cruzada à nota de §12 |
| §12 nota de ADR atualizada com a confirmação do reviewer: ADR 0008 `treasury-custody-squads-multisig` existe em PR aberto na branch `claude/setup-copilot-api-config-PuGXP`. Quando mergear, esta proposta shifta para 0009 (referral) e 0010 (grace per-pool) |

## 20. O que mudou de v0.4 para v0.4.1

| Ponto v0.4 → v0.4.1 |
|---|
| §4.5 nova: caveat de que on-time rate da Fase 1 é lower bound, não diretamente comparável a mainnet (grace 7d = ciclo inteiro de cushion) |
| §7 honesty fix: removido `grace_period` dos fixtures porque math crate não consome (confirmado via `grep -rn "grace" crates/math/` = zero hits). Validação de timing fica para integration tests, não para math fuzz |
| §9.1 endurecido: "2+ pessoas em on-call rotation" em vez de "1+ pessoa dedicada" |
| §9.2 nova: procedimento de aborto mid-flight pré-escrito (pausa automática em SEV ≥ Medium, decisão técnica do lead eng, comunicação ≤24h) |
| §10 Pré-Fase 0: "Owner do fuzz atribuído" e "Procedimento de aborto pré-escrito" promovidos a checklist bloqueador |
| §13 Q4 ("Owner do fuzz") removido — virou checklist |
| §12 nota sobre ADR numbering: 0008/0009 provisoriamente reservados |

## Histórico de versões

- v0.5.3 (2026-05-21): §9.2 separação de poderes — severidade vem da rubrica, não do lead eng. **Último patch de design previsto.**
- v0.5.2 (2026-05-21): 9 items operacionais adicionados em §10 (Pré-Fase 0 reestruturado em 5 grupos) + nova subseção "Critical path" com sequência ordenada por dependências e bottlenecks explícitos.
- v0.5.1 (2026-05-21): fix de inconsistência da prosa §5 (Medium aparecia em dois lados) + on-time estrito definido + label criada na checklist + spec de normalização min-max.
- v0.5 (2026-05-21): fecha 5 decisões da §13 (SEV gate, composição 3+7, comunicação híbrida, cap 3 ativos, manter pool unit) + 4 detalhes de execução + correção de 3 bugs preexistentes.
- v0.4.2 (2026-05-21): consistência de ADR numbering entre §11 e §12.
- v0.4.1 (2026-05-21): honesty fix no fuzz, §4.5 lower bound, §9.2 aborto mid-flight, gates promovidos.
- v0.4: grace per-pool reformulado (Opção B), 6 fuzz targets, team fatigue, selection bias.
- v0.3: Genesis Canary como fase 0, caveats de devnet.
- v0.2: USDC, yield-mock, referral off-chain, fuzz fixture obrigatória.
- v0.1: rascunho inicial (obsoleto — assumiu pool params hardcoded incorretamente).
