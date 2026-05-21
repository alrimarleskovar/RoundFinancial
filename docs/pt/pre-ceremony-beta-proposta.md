# Pre-Ceremony Beta — Proposta de Design (v0.3)

**Status:** rascunho para discussão de time
**Versão:** 0.3 — Genesis Canary adicionado como fase 0; objetivos reframados por fase
**Data alvo de decisão:** TBD
**Mudanças vs. v0.2:** ver §12

---

## 1. Decisão de produto

**Beta em devnet primeiro, dividido em duas fases sequenciais:**

| Fase | Nome | Cadência | Aporte | O que testa |
|---|---|---|---|---|
| **0** | Genesis Canary | 48h por ciclo | 10 USDC | Operação, UX, dinâmica social, indexer, crank — **não testa hábito** |
| **1** | Pre-Ceremony Semanal | 7 dias por ciclo | 50 USDC | Hábito de pagamento recorrente, retenção, defaults em cadência realista |

Mainnet beta é fase 2, fora do escopo deste doc — depende dos dados das fases 0 e 1 + smoke + Squads + audit.

**Por que duas fases:** ciclos curtos comprimem o ciclo de observação operacional (defaults aparecem em dias, bugs de crank em horas) mas **não testam hábito**. Hábito só é testável com cadência que cabe na vida do usuário. Separar permite que cada fase responda a perguntas claras, sem misturar artefatos do setup com sinal real.

---

## 2. Objetivos por fase

### Fase 0 — Genesis Canary

**Pergunta central:** O produto funciona operacionalmente e a dinâmica social é coerente?

Variáveis sob observação:

1. **UX:** onboarding flow, clareza dos eventos de ciclo, fluxo de pagamento, percepção de progresso.
2. **Operação:** crank reliability sob cadência alta, indexer latência, push notifications acertadas vs. ruído.
3. **Dinâmica social:** como o grupo reage quando alguém atrasa? Pressão de pares emerge naturalmente? Discord/Telegram funcionam como canal de coordenação?
4. **Confiança:** testers entendem o que está acontecendo a cada ciclo? Transparência dos eventos on-chain é suficiente ou precisa de abstração na UI?
5. **Mecânica de default:** o flow de default é compreendido? Stake recovery comunica corretamente?

**O que Fase 0 NÃO valida:**

- Taxa de default real (em devnet com USDC mintado, default não dói — números serão artificialmente altos).
- Adesão de longo prazo (20 dias não testa hábito).
- Viabilidade econômica do pool (capital simbólico).

### Fase 1 — Pre-Ceremony Semanal

**Pergunta central:** Usuários mantêm pagamento recorrente em cadência realista?

Variáveis sob observação (adicionalmente às de Fase 0):

1. **Retenção semanal:** on-time payment rate ciclo a ciclo, decay ao longo das 10 semanas.
2. **Defaults reais:** posição no slot vs. probabilidade de default; correlação com engajamento social.
3. **Comportamento de referral:** convidados pagam tão consistentemente quanto convidadores?

---

## 3. Parâmetros por fase

### Fase 0 — Genesis Canary

| Parâmetro | Valor | Comentário |
|---|---|---|
| Denominação | USDC (devnet, mintado) | Valor é simbólico — ver §4 |
| Aporte por ciclo | **10 USDC** | Faixa 5-15 USDC; valor é cosmético, não econômico |
| `cycle_duration` | **172 800s (48h)** | 2× o piso `MIN_CYCLE_DURATION` |
| Membros por pool | 10 | |
| `cycles_total` | 10 | Pool inteiro em ~20 dias |
| Payout por slot | 100 USDC | |
| Yield strategy | `roundfi-yield-mock` | yield = 0, fluxo CPI preservado |
| Grace period | **24 horas** | Metade do ciclo |
| Stake (nível 1) | 50% (default) | |

### Fase 1 — Pre-Ceremony Semanal

| Parâmetro | Valor | Comentário |
|---|---|---|
| Denominação | USDC (devnet, mintado) | |
| Aporte por ciclo | **50 USDC** | Mesmo número da v0.2 |
| `cycle_duration` | **604 800s (7d)** | |
| Membros por pool | 10 | |
| `cycles_total` | 10 | Pool inteiro em ~70 dias |
| Payout por slot | 500 USDC | |
| Yield strategy | `roundfi-yield-mock` | |
| Grace period | **48 horas** | |
| Stake (nível 1) | 50% (default) | |

**Wall-clock total até completar Fase 1:** ~20 dias (Canary) + ~7 dias análise + ~70 dias (semanal) ≈ **3 meses** do start do Canary até dados completos da Fase 1.

---

## 4. Caveats sobre interpretação de dados (devnet)

**Importante para qualquer leitura dos dados pós-beta:**

### 4.1 Valor é cosmético em devnet

Tester com 10 USDC mintado se comporta **idêntico** a tester com 500 USDC mintado em devnet — é dinheiro de Monopoly. Aporte baixo (5-15 USDC) é escolhido por:

- UI mostra números realistas em vez de absurdos durante demo.
- Reduz "ansiedade visual" do tester.
- **Não reduz fricção financeira real** porque não há fricção financeira em devnet.

### 4.2 Taxa de default do Canary não é preditiva

Em devnet com aporte simbólico, dar calote não dói. Defaults serão **artificialmente altos** comparados ao que ocorreria em mainnet. Conclusões válidas:

- ✅ "O mecanismo de detecção de default funciona em X horas após miss" — válido.
- ✅ "Stake recovery executa corretamente" — válido.
- ✅ "Reação social ao default no Discord segue padrão Y" — válido.
- ❌ "Taxa de default esperada em produção é X%" — inválido. Devnet ≠ mainnet.

### 4.3 Hábito só é testado na Fase 1

Ciclo de 48h é **stress test operacional**, não hábito. Apenas a Fase 1 (7 dias) gera dados sobre aderência recorrente humana.

**Esses caveats devem estar visíveis em qualquer apresentação dos dados pro time ou stakeholders externos.**

---

## 5. Escala

**Cada fase começa com 1 pool de 10.** Critérios de escalar para pools paralelos:

- Fase 0 → +2 pools paralelos na semana 2 (do Canary) se: zero falhas de crank, indexer lag < 30s, on-time rate > 70% (threshold baixo dado que default não dói).
- Fase 1 → +2 pools paralelos na semana 4 (da Semanal) se: on-time rate > 90% nos ciclos 1-3, zero defaults.

Sem critério atendido = manter 1 pool, investigar, ajustar.

---

## 6. Mudanças técnicas necessárias

### 6.1 Pool params — nada a fazer no core

Confirmado em `programs/roundfi-core/src/state/pool.rs:16-20`: `members_target`, `installment_amount`, `cycles_total`, `cycle_duration` já per-pool. Configurar os params da §3 é chamada de `create_pool`.

### 6.2 Yield strategy

Apontar pool para `programs/roundfi-yield-mock` (já existe, drop-in com o adapter Kamino conforme header do crate). Pré-fundar `yield_vault` com zero surplus. Resultado: yield = 0, fluxo CPI preservado, Seed Draw exercitado sem drift econômico.

### 6.3 Grace period override

**Action item bloqueador:** confirmar com SDK owner se `CRANK_DEFAULTS.defaultGraceSec` em `sdk/src/constants.ts` é overrideable per-pool ou global. Precisa de override per-pool para suportar grace de 24h (Canary) e 48h (Fase 1) em pools distintos.

Se não é overrideable, **essa é a única mudança real de código** — adicionar parametrização per-pool.

---

## 7. Validação obrigatória antes de cada fase

### 7.1 Antes da Fase 0 (Genesis Canary)

Fuzz com **fixture do Canary** nos targets de `crates/math/fuzz/fuzz_targets/`:

```
installment = 10_000_000  (10 USDC)
cycle_duration = 172_800  (48h)
cycles_total = 10
members_target = 10
stake_bps = 5000
yield_apy = 0
```

Targets obrigatórios: `seed_draw.rs`, `cascade.rs`, `dc_invariant.rs`, `waterfall.rs`. **1M iterações cada.** Bloqueia start do Canary.

### 7.2 Antes da Fase 1 (Pre-Ceremony Semanal)

Fuzz com **fixture da Semanal**:

```
installment = 50_000_000  (50 USDC)
cycle_duration = 604_800  (7d)
cycles_total = 10
members_target = 10
stake_bps = 5000
yield_apy = 0
```

Mesmos targets. Bloqueia start da Fase 1.

**Sem esses passos, qualquer afirmação sobre cobertura de default em cada fase é especulação.**

---

## 8. Sistema de referral — off-chain (inalterado da v0.2)

Aplicação consistente em ambas as fases:

- DB do indexer com tabela `referrals` (schema na v0.2 §6.2).
- Admin attest manual para os primeiros 10 testers de cada fase.
- Cap de 3 convidados ativos por wallet.
- XP do convidado: +50 no join. XP do convidador: +20 por ciclo completo do convidado (vesting natural).
- Default do convidado: -500 (existente on-chain) + -100 no convidador (off-chain ledger).
- Auto-referral bloqueado.
- ADR de migração on-chain pós-audit pendente (ver §11).

**Observação para Canary:** com ciclos de 48h, o vesting do convidador acelera para 10 dias completos = 100 XP vestados em ~2,5 semanas. Não muda nada na lógica — só nota mental de que numbers crescem mais rápido em cadência alta.

---

## 9. Riscos e mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| Conclusões erradas sobre default rate em produção | **Alta** | §4 explícito em todas as apresentações dos dados |
| Crank/indexer não aguenta cadência 48h | Alta | Fuzz §7.1 + smoke test antes do Canary |
| Default em slot inicial inviabiliza pool | Média (validar via fuzz) | Bloqueado por §7 fuzz fixture de cada fase |
| Centralização off-chain do referral contradiz narrativa | Média | Comunicação explícita + ADR de migração on-chain |
| Tester abandona após 2-3 ciclos do Canary (fadiga) | Média | Sinal válido — mostra que cadência alta tem custo. Documentar como aprendizado. |
| Grace 24h é agressivo demais no Canary | Baixa | Reverter para 48h se on-time rate < 60% no ciclo 1 |

---

## 10. Checklist de implementação

### Pré-Fase 0

- [ ] Confirmar grace period overrideable per-pool no SDK
- [ ] Backend de referral off-chain implementado (DB + admin attest dashboard)
- [ ] **Fuzz fixture Canary nos 4 targets, 1M iterações cada — bloqueia start**
- [ ] Smoke test em devnet local com 10 wallets simuladas

### Fase 0 — Genesis Canary (~20 dias wall-clock)

- [ ] Seleção dos 10 testers do Canary
- [ ] Termo de participação (experimento devnet, valor simbólico, fadiga esperada)
- [ ] Canal dedicado (Discord/Telegram)
- [ ] Métricas tracking: on-time rate, crank lag, indexer latência, NPS qualitativo, observação social
- [ ] Análise pós-Canary: o que mudar antes da Fase 1?

### Pré-Fase 1

- [ ] Ajustes de UX/operação identificados no Canary
- [ ] **Fuzz fixture Semanal nos 4 targets — bloqueia start**

### Fase 1 — Pre-Ceremony Semanal (~70 dias wall-clock)

- [ ] Seleção dos 10 testers da Semanal (pode incluir veteranos do Canary + novos)
- [ ] Termo atualizado
- [ ] Métricas: on-time rate semanal, defaults, retenção, XP de referral, NPS

### Pós-beta

- [ ] Relatório consolidado com dados das duas fases + caveats §4
- [ ] ADR de migração referral on-chain (§11)
- [ ] Decisão sobre mainnet beta pós-audit

---

## 11. ADR pendente — Migração de referral off-chain para on-chain

Inalterado da v0.2. Após beta:

- Novo ADR em `docs/adr/0008-referral-on-chain-migration.md`
- Schema final de `Member.inviter` + counters
- Path de migração: instrução administrativa "bootstrap reputation" com snapshot off-chain → freeze → emissão on-chain → unfreeze

---

## 12. O que mudou de v0.2 para v0.3

Feedback do time:

| Ponto v0.2 → v0.3 |
|---|
| Estrutura virou 2 fases: Genesis Canary (48h, 10 USDC, foco operacional/social) → Pre-Ceremony Semanal (7d, 50 USDC, foco hábito) |
| §2 reframado: objetivos por fase, com pergunta central clara para cada |
| §4 nova: caveats explícitos sobre interpretação de dados em devnet (valor cosmético, default rate não preditiva, hábito só na Fase 1) |
| §5 escala: critérios diferentes por fase (threshold mais baixo no Canary porque default simbólico não dói) |
| §7 fuzz: duas fixtures, uma por fase, ambas bloqueadoras |
| §8 referral: nota sobre vesting acelerado em cadência alta |
| §10 checklist: organizado por fase com gates de validação entre elas |

**v0.2 está obsoleta. Substituída por esta v0.3.**

---

## 13. Perguntas abertas remanescentes

1. **Threshold de on-time rate pro Canary** (atual: 70%) é o nível certo, dado que default não dói em devnet?
2. **Composição dos 10 testers da Fase 1** — mesmos 10 do Canary, ou rotação parcial pra ter sinal de "primeira experiência"?
3. **Comunicação externa do beta** — público (anúncio na comunidade) ou privado (founders + indicados)?
4. **Owner do fuzz** — quem na equipe rola as fixtures?
5. **Critério de aborto inter-fase** — se Canary tem on-time rate < X%, aborta Fase 1 ou ajusta e prossegue?
