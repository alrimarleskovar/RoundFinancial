# Procedimento de Aborto Mid-Flight — Pre-Ceremony Beta

**Documento operacional executável durante as fases 0 e 1 do beta.**
**Referência:** §9.2 da proposta v0.5.3 (`docs/pt/pre-ceremony-beta-proposta.md`)
**Rubrica de severidade:** `docs/security/internal-audit-findings.md`
**Label Low SEV:** `sev-low-deadline-canary` — spec em `docs/pt/pre-canary-label-spec.md`
**Data:** 2026-05-21 (criado) · 2026-05-23 (cross-refs adicionados)

> **⚠️ Escopo:** este doc cobre o caso **DURANTE** o Canary ou Fase 1 (tester real dentro do pool, USDC mintado, comunicação ≤24h obrigatória). Para SEV detectado no **smoke test pré-start (Dia 13-14 do critical path)**, usar `docs/pt/pre-ceremony-beta-flow-sev-smoke-test.md` — mesma rubrica, mas zero comunicação externa devida e fricção de abortar é baixa.

---

## 1. Quando ativar este procedimento

Trigger automático: **qualquer SEV ≥ Medium** descoberto durante uma fase ativa (Canary ou Semanal).

Fontes possíveis de descoberta:
- Fuzz roda em loop e acha novo crash → SEV
- Tester reporta comportamento estranho via canal dedicado → triagem produz SEV
- Indexer detecta anomalia (lag persistente, valores impossíveis) → SEV
- Gabriel (security) acha bug em revisão paralela → SEV
- Auditoria externa eventual → SEV

**Não é trigger:**
- Tester com dúvida de UX (vai pro flow de suporte normal, não para)
- Crank lag transitório (< 5 min) → monitoring, não aborto
- Tester individual atrasando pagamento → flow de default normal, não aborto

---

## 2. Sequência de ações (em ordem)

### Passo 1 — Pausar o pool (qualquer pessoa do time, sem deliberação)

Ação imediata, ≤15 min após detecção:

- [ ] Lead eng (Alrimar) é avisado via Discord/Telegram + ping direto
- [ ] Cranker pausado (não processa novos `contribute` / `claim_payout`)
- [ ] Status no canal de testers: **"Pool pausado, investigação em andamento. Mais info em até 24h."**

**Comando do cranker:** TBD — confirmar com Alrimar/Gabriel o flag/env var pra pausar sem desligar.

### Passo 2 — Classificar severidade (rubrica, NÃO opinião)

Quem detectou consulta `docs/security/internal-audit-findings.md` e classifica:

- **Critical / High / Medium** → procede com Passo 3
- **Low** → cria issue no GitHub com label `sev-low-deadline-canary`, deadline ≤ 30d, despausa pool. **Não bloqueia fase.**
- **Info** → nota mental, registra em backlog se relevante. **Não bloqueia, não cria issue.**

**Regra de separação de poderes (v0.5.3):**
Quem detectou o SEV não classifica severidade. Outra pessoa do time aplica a rubrica. Se houver dúvida entre dois níveis, **escala pro nível mais alto** (conservador).

### Passo 3 — Lead eng decide ação (só pra SEV ≥ Medium)

**Quem decide:** Alrimar (lead eng). Não é votação.

**Opções:**

**(A) Fix + redeploy + retomar pool do mesmo ponto**

Critérios:
- Fix preserva estado on-chain do pool (membros, slots, contribuições já feitas)
- Fix passa fuzz com fixture da fase atual (1M iter × 6 targets, ou subset se pressão de tempo)
- Smoke test em devnet local com 10 wallets simuladas reproduz cenário anterior

Tempo típico: 1-3 dias dependendo da complexidade.

**(B) Abortar fase, reiniciar pós-fix**

Critérios:
- Fix muda estado do programa (account migration, novos campos)
- Membros perdem progresso, precisa re-onboard
- Refund: devnet USDC é mintado, distribuído de novo

Tempo típico: 5-10 dias dependendo do fix.

**(C) Continuar sem fix (raro)**

Apenas se SEV se prova ser falso positivo após investigação. Documentar por que era falso positivo.

### Passo 4 — Comunicar aos testers (≤ 24h após Passo 1)

Mensagem no canal dedicado, escrita pelo primary on-call (Yvina) com inputs do lead eng:

```
Time RoundFi aqui.

Pausamos o pool no ciclo X em [DATA] após [BREVE DESCRIÇÃO sem detalhe técnico].

Severidade classificada: [Critical/High/Medium].

Plano:
[ ] Opção A: Vamos corrigir e retomar o pool do mesmo ponto.
[ ] Opção B: Vamos abortar esta fase e reiniciar pós-fix.
[ ] Opção C: Era falso positivo, retomando.

Próximo update: [DATA, máximo 7d].

Dúvidas: respondam aqui ou DM @yvina.
```

**Não usar:**
- Linguagem técnica (`stake_bps`, `CPI`, `account migration`)
- Pedido de desculpas exagerado (mina credibilidade do beta)
- Promessa de retomada antes de fix validado

---

## 3. Tabela de decisão rápida

| Cenário | Severidade típica | Ação |
|---|---|---|
| Pagamento de tester não está sendo registrado | Medium-High | Pausar, investigar, provavelmente Opção A |
| Stake de membro foi consumido errado em default | High-Critical | Pausar, refund de stake, Opção B se afeta integridade |
| Cranker para de processar (não erro de código, só infra) | — | Restart cranker, não é aborto. Se persistir > 30 min, vira Medium. |
| Indexer reporta valor impossível (negative balance, count maior que members_target) | Critical | Pausar IMEDIATO, Opção B quase certa |
| Fuzz mid-fase acha crash em fixture diferente da atual | Low-Medium | Cria issue, deadline, segue. Reavalia se fixture atual é afetada. |
| Tester reporta "não consigo pagar" mas é problema de wallet/conexão | — | Suporte normal, não é SEV |

---

## 4. Comunicação interna (time)

Canal interno (Discord privado dos founders + Gabriel) recebe:

- Detecção imediata: quem detectou, onde, screenshot/logs
- Classificação de severidade: aplicada por quem NÃO detectou, com referência à rubrica
- Decisão de ação: lead eng, em texto, com justificativa
- Status updates: cada 24h até resolução

---

## 5. Documentação pós-evento

Após qualquer aborto (Opção B), criar:

- Issue no GitHub com label `canary-incident` (criar label se não existir)
- Postmortem em `docs/security/incidents/YYYY-MM-DD-resumo-curto.md`
- Update no relatório consolidado pós-beta (§10 Pós-beta da proposta)

Para Opções A (fix + retomada), documentação é mais leve: 1 commit message bem escrito + 1 comentário no PR é suficiente.

---

## 6. Anti-patterns a evitar

- ❌ **Lead eng decide severidade por conta própria.** Quebra separação de poderes (§9.2). Se a rubrica não cobre o caso, escalar pra Gabriel ou Caio aplicar.
- ❌ **Comunicar aos testers antes de classificar severidade.** Causa pânico desnecessário se vira Low.
- ❌ **Despausar pool sem smoke test.** Smoke test é cheap (~30 min). Despausar prematuro arrisca segundo incidente.
- ❌ **Promessa de timeline sem confirmar com lead eng.** Yvina (on-call) não promete prazo de fix sem Alrimar confirmar.
- ❌ **Hide do time interno.** Founders + Gabriel sabem de tudo, sempre. Sem silos.

---

## 7. Lista de verificação operacional (uso no momento do incidente)

Cópia rápida pra imprimir/fixar:

```
[ ] T+0:00  Detecção. Quem, onde, screenshot.
[ ] T+0:05  Avisar Alrimar (lead eng) via ping direto.
[ ] T+0:15  Pool pausado. Mensagem holding aos testers.
[ ] T+0:30  Classificação de severidade (não pela mesma pessoa que detectou).
[ ] T+2:00  Lead eng decide ação (A/B/C).
[ ] T+24:00 Comunicação detalhada aos testers, no canal dedicado.
[ ] T+xd    Resolução: smoke test passa, pool despausado OU fase reiniciada.
[ ] T+xd+1  Postmortem documentado (se Opção B) ou commit + PR (se Opção A).
```
