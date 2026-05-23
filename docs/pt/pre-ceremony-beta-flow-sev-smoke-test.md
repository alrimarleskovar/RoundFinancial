# Flow: SEV detectado no Smoke Test "ensaio geral"

**Documento operacional executável durante o Dia 13-14 do critical path (smoke test pré-start).**
**Referência:** §10 da proposta v0.5.3 (`docs/pt/pre-ceremony-beta-proposta.md`)
**Trigger upstream:** Procedimento de aborto mid-flight (`pre-ceremony-beta-procedimento-aborto.md`) cobre **durante** o Canary/Fase 1; este doc cobre o **gap** entre Dia 13 (smoke geral) e Dia 15 (start). Janela de 48h.
**Data:** 2026-05-23

---

## 1. Por que precisa de doc separado

O procedimento de aborto mid-flight (§9.2) cobre o caso onde **testers reais já estão dentro do pool com USDC mintado** — alta fricção pra abortar, comunicação obrigatória ≤24h, classificação de severidade vira input pra "reembolsa ou continua".

O smoke test de Dia 13-14 é **pré-tester**: 10 wallets simuladas operadas pelos founders. Se um SEV aparece aqui:

- **Zero comunicação externa devida** — nenhum tester real foi convidado ainda
- **Fricção de abortar é baixa** — só ajustar e re-rodar
- **Mas:** decisão de "atrasar Dia 15" vs "ignorar achado e largar" precisa ser tomada com a mesma rubrica de severidade

Sem este flow, time pode ser tentado a "ignorar Low pra não atrasar start" — exatamente o anti-pattern que o procedimento de aborto evita durante o run. Doc separado fecha a porta dos fundos.

---

## 2. Quando ativar este flow

Trigger automático: **qualquer comportamento inesperado durante o ensaio geral de Dia 13-14**.

Fontes:

- Crank lag > 30 segundos em qualquer instrução
- Indexer reporta valor impossível (saldo negativo, ciclo fora de ordem)
- Wallet simulada falha em transação que deveria passar
- UI quebra (white screen, transaction signing loop)
- Fuzz roda em background e acha crash inédito enquanto smoke roda
- Tester founder reporta sensação de "isso não está certo"

**Não é trigger:**

- Tempo de carregamento de página ≥3s (vai pra issue de perf, não para)
- UX de copy de label ambíguo (vai pra polish backlog, não para)
- Wallet simulada perdendo sessão por timeout esperado (comportamento)

---

## 3. Sequência de ações

### Passo 1 — Parar o smoke test (qualquer founder, sem deliberação)

Quem detectou o achado:

```bash
# Para o cranker
pnpm orchestrator:stop

# Anota timestamp + descrição do achado
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) - $DESCRICAO" >> docs/operations/smoke-findings.md
```

**Não esperar lead eng ou time pra parar.** Smoke não tem terceiros, parar não custa nada.

### Passo 2 — Classificar severidade (rubrica, NÃO opinião)

Aplica a mesma rubrica de `docs/security/internal-audit-findings.md` que o procedimento de aborto usa. Cuidado com o vies de "está perto do Dia 15, vou classificar mais leve" — **a rubrica é a rubrica**.

Resultado vira input pro Passo 3:

| Severidade | Categoria típica em smoke |
|---|---|
| **Critical** | Fundo perdido / saldo inconsistente / transação assina sem authority esperado |
| **High** | Crank trava / settle_default não dispara quando deveria / claim_payout falha em condição válida |
| **Medium** | Indexer perde evento / valor truncado em UI / state on-chain ≠ state indexado |
| **Low** | UI quebra em edge case raro / mensagem de erro errada / lag de cranker ≤30s |
| **Info** | Polish UX / copy ambíguo / page load lento |

### Passo 3 — Lead eng decide ação (depende da severidade)

| Severidade | Ação automática |
|---|---|
| **Critical / High** | **Abortar start de Dia 15.** Fix obrigatório antes de re-rodar smoke. Re-agendar Dia 15 +N dias (N = tempo de fix + 24h de smoke novo). |
| **Medium** | **Lead eng decide:** fix + re-smoke (atrasa Dia 15) OU document como known issue + procedimento de mitigation OU postpone Fase 0. Decisão registrada em `docs/operations/smoke-findings.md`. |
| **Low** | **Cria GitHub issue com label `sev-low-deadline-canary`** (assignee + due date ≤30d). Não bloqueia Dia 15. Documenta no operations log. |
| **Info** | Cria issue normal sem deadline. Não bloqueia Dia 15. |

**Separação de poderes** (mesma regra do §9.2):

- Lead eng decide **ação** (abortar / fix-then-restart / known-issue)
- Lead eng **não decide** severidade — vem da rubrica
- Se rubrica diz Critical/High, gate dispara automaticamente — independente de quem detectou ou opinião do lead

### Passo 4 — Comunicação interna (≤2h)

Postar em canal interno do time (não testers — não existem ainda):

```
🟡 SMOKE TEST ACHADO - Dia <N>

Severidade: <Critical|High|Medium|Low|Info>
Descrição: <1-2 frases>
Componente: <core | reputation | yield-mock | indexer | cranker | UI>
Ação decidida: <abortar Dia 15 | fix + re-smoke | known-issue | label>
Owner: <nome>
Re-smoke ETA: <data ou N/A>

Detalhes: <link pra issue ou findings.md>
```

Sem comunicação externa devida — testers não foram convidados ainda. **Mas:** se o achado for Critical e Dia 15 for adiado >7 dias, considerar comunicar publicamente que "Genesis Canary atrasou por achado interno em smoke" (transparência pré-emptiva).

### Passo 5 — Re-smoke (se aplicável)

Após fix mergeado:

```bash
# Reset state devnet pros mocks
pnpm devnet:reset-mocks

# Re-rodar smoke do começo (NÃO continuar de onde parou)
pnpm smoke:full --cycles 1 --wallets 10
```

**Smoke completo** (não parcial) — mesmo que o fix seja "só nessa instrução". Outras coisas podem ter quebrado em cascata.

Re-smoke verde = volta pra timeline original, decisão se Dia 15 ainda bate ou desloca.

---

## 4. Anti-patterns a evitar

- ❌ **"É só smoke, vamos ignorar"** — esse pensamento é exatamente como SEV-040 / SEV-041 do Kamino-spike escaparam pré-tracker
- ❌ **Lead eng decidir severidade na hora** — a rubrica é externa por design, fecha COI
- ❌ **Forçar Dia 15 com Medium pendente** — Medium em smoke vira Critical em prod com 10x o blast radius (testers reais + USDC mintado + público observando)
- ❌ **Re-smoke parcial** — fix em uma instrução pode quebrar outra
- ❌ **Não documentar Low/Info** — gap de doc vira buraco no relatório pós-beta

---

## 5. Lista de verificação operacional

Durante o ensaio geral, ter este checklist visível:

- [ ] Cranker rodando (pnpm orchestrator)
- [ ] Indexer rodando + apontando pros novos program IDs
- [ ] 10 wallets simuladas preparadas (USDC mintado, ≥10 USDC cada)
- [ ] UI da app servindo localhost
- [ ] Discord channel `smoke-test-canary` criado (efêmero, deletado pós-smoke)
- [ ] `docs/operations/smoke-findings.md` criado e versionado
- [ ] Bookmark deste flow + procedimento de aborto + rubrica de severidade em todos os tabs do time

---

## 6. Critério de pass — Dia 15 START Canary

Smoke passa quando **todos** verdes:

- [ ] 1 ciclo completo de 48h simulado (compressão de clock no devnet — usa `bankrun_compat` shim conceitualmente, mas em devnet real)
- [ ] Todas as 10 wallets contribuíram, 1 wallet recebeu payout, 9 wallets restantes em pool
- [ ] Indexer captura 100% dos eventos (paid_at, due_at, delta_seconds, grace_used — depende da D1 da reunião)
- [ ] Crank operou sem intervenção manual durante 48h simulado
- [ ] Push notification (Discord/email/OneSignal — depende da D7 da reunião) disparou nos momentos certos
- [ ] Zero achados Critical/High/Medium não resolvidos
- [ ] Lows com label `sev-low-deadline-canary` + assignee + due date
- [ ] Re-deploy devnet verificado contra `MIN_CYCLE_DURATION` floor (`GRACE_PERIOD_SECS >= 86_400`)

Smoke verde → **Dia 15 está autorizado.** Convite dos 10 testers reais é disparado.

Smoke vermelho/amarelo → re-smoke obrigatório antes de qualquer convite.

---

## 7. Cross-refs

- `pre-ceremony-beta-procedimento-aborto.md` — durante o run (this é antes)
- `pre-ceremony-beta-proposta.md` §10 — checklist Dia 13-14
- `pre-ceremony-beta-proposta.md` §9.2 — separação de poderes
- `pre-canary-label-spec.md` — spec do label
- `docs/security/internal-audit-findings.md` — rubrica de severidade
- `docs/operations/smoke-findings.md` — log operacional (criado durante smoke)
