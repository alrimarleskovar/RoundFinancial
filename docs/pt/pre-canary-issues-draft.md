# Draft das Issues Pré-Canary

**Para uso pós-reunião de decisões.** Yvina copia/cola cada bloco no GitHub Issues do repo `alrimarleskovar/RoundFinancial`, preenche `Owner` + `Deadline` com o decidido na reunião.

Label sugerido pra todas: `pre-canary-blocker` (criar uma vez antes de criar as issues).

---

## Issue 1 — Schema do indexer com campos brutos pra score

**Title:** `[pre-canary] Schema do indexer: adicionar paid_at, due_at, delta_seconds, grace_used, default_reason`

**Body:**

Doc fundacional §5 marca essa decisão como **irrecuperável**. Se indexer só armazena status binário, 70 dias de dados da Fase 1 perdem valor pro produto final (score).

### Estado atual

Verificado em `services/indexer/prisma/schema.prisma`:

- `ContributeEvent` — tem `slotIndex`, falta `cycle`, `blockTime`, e calculados (`due_at`, `delta_seconds`, `grace_used`)
- `ClaimEvent` — tem `cycle`, `blockTime`. Falta calculados.
- `DefaultEvent` — tem `cycle`, `blockTime`. Falta `default_reason`.

### O que fazer

1. Adicionar campos no Prisma schema (migration)
2. Atualizar handler do indexer pra calcular `due_at = pool.startedAt + cycle * cycleDuration`, `delta_seconds = blockTime - due_at`, `grace_used = delta_seconds > cycleDuration / 2`
3. Decidir `default_reason`:
   - **(A)** Calculado off-chain (heurística: `blockTime - graceDeadline > X seconds → 'infra_outage'`, senão `'missed_payment'`)
   - **(B)** Capturado on-chain (requer mudança em `settle_default.rs` pra incluir o motivo)

### Reasoning

Reviewer apontou que `default_reason` não é só integridade operacional — é **contestabilidade do score** no framework de CRA/FCRA. Sem ele on-chain ou determinístico, usuário não pode disputar score negativo causado por outage do crank.

### Critério de aceitação

- [ ] Schema com 6 campos brutos commitado
- [ ] Migration rodada em devnet generation atual (ou nova generation se for redeploy)
- [ ] 1 ciclo de teste em devnet local mostra os campos populados corretamente
- [ ] Decisão sobre `default_reason` registrada como ADR ou comment no PR

**Owner:** ___________
**Deadline:** ___________
**Bloqueia:** Dia 3-5 do critical path (indexer apontado pros novos IDs)

---

## Issue 2 — Data layer mode: interno vs exportável

**Title:** `[pre-canary] Decisão arquitetural: data layer interno-only vs exportável via CPI`

**Body:**

Doc fundacional §2 marca "Não decidir o data layer (interno vs. exportável) antes do start do Canary" como **biggest strategic mistake**. Afeta schema da Issue #1.

### Opções

- **(A) Interno-only.** Indexer armazena agregados/derivados. Sem CPI exportável. Score fica dentro do RoundFi.
- **(B) Exportável via CPI.** Indexer armazena eventos brutos verificáveis. Pool completion vira oracle consumível. Implementa "highest-upside opportunity" do §2.
- **(C) Híbrido (API HTTPS).** Exportável read-only via API com KYC RoundFi.

### Consequências por opção

- (A) regulatoriamente mais simples, mata upside descrito como tese central
- (B) é o caminho do produto fundacional, exige opinion letter FCRA antes de qualquer post público
- (C) meio-termo, provavelmente não satisfaz nem upside nem simplicidade

### Critério de aceitação

- [ ] Decisão registrada como novo ADR (`0009-data-layer-mode.md` ou número que sobrar pós-merge #401)
- [ ] Schema da Issue #1 reflete a decisão
- [ ] Se (B): opinion letter FCRA prevista no plano (Issue #6)

**Owner:** ___________
**Deadline:** ___________
**Bloqueia:** Issue #1 (schema final), Issue #6 (mapeamento regulatório)

---

## Issue 3 — Persona dos 7 newbies + pergunta-filtro no formulário

**Title:** `[pre-canary] Formulário de aplicação dos 7 newbies da Fase 1: pergunta-filtro de persona`

**Body:**

Doc fundacional §9 P0 — se os 7 vierem de crypto-native Twitter, Fase 1 mede crypto-natives. **TAM real** (per §2 dimensão 2) é diáspora/imigrante com ROSCA informal + autônomo/PME sem histórico bancário.

### Pergunta-filtro proposta pelo fundacional

> "Você já enfrentou dificuldade de acessar crédito, alugar imóvel ou comprovar renda nos últimos 12 meses?"

Filtra persona-alvo sem verificação formal.

### Risco regulatório

Descrever critério em termos de "dificuldade de crédito" pode ser interpretado como segmentação de credit-stressed consumers. **Validar com opinion letter (Issue #6) antes de publicar formulário.**

### Critério de aceitação

- [ ] Texto exato do formulário escrito
- [ ] Validação da pergunta com opinion letter regulatório
- [ ] Canal de distribuição decidido (Discord da RoundFi? Twitter? Grupos Telegram da diáspora?)
- [ ] Critério explícito de seleção dos 7 a partir das aplicações

**Owner:** ___________ (provavelmente Yvina)
**Deadline:** ___________
**Bloqueia:** Dia 11-13 do critical path (não bloqueia Canary, bloqueia Fase 1)

---

## Issue 4 — Wyoming LLC filing + registered agent

**Title:** `[pre-canary] Wyoming LLC: filing + registered agent`

**Body:**

Doc fundacional §3 — IP dos smart contracts precisa de dono legal antes de mainnet. Filing leva 2-5 dias, **pode rodar em paralelo Dia 1-2**, não bloqueia técnico.

### Opções

- **(A) Auto-filing online** ($100-200 + $100-200/ano registered agent). Yvina ou Caio organizer. **Recomendado pelo fundacional.**
- **(B) Via advogado** ($500-1500 extra, inclui revisão operating agreement). Combina com opinion letter.
- **(C) BVI + Wyoming combo** ($1500-3000). Overkill pre-Série A.

### Operating agreement

Sai como P2 (antes da Fase 1, não antes do Canary). LLC vazia é OK pro Canary.

### Critério de aceitação

- [ ] Filing submetido (state of Wyoming)
- [ ] Registered agent contratado
- [ ] Comprovante anexado a esta issue
- [ ] EIN obtido se relevante pra abrir conta de banco

**Owner:** ___________ (provavelmente Yvina como signing organizer)
**Deadline:** ___________
**Bloqueia:** Não bloqueia Canary. Bloqueia mainnet deploy.

---

## Issue 5 — v0.6 do plano (absorvendo fundacional)

**Title:** `[pre-canary] Pre-ceremony beta proposta v0.6: absorver fundacional`

**Body:**

v0.5.3 está estrategicamente incompleta (não articula produto = score). v0.6 absorve fundacional como premissa estratégica + os gaps identificados.

### Escopo de v0.6

1. Nova §3 "Premissa estratégica" no topo: "Produto final = score, ROSCA é instrumento de coleta"
2. §7 (validação) expandido com schema do indexer como item P0 explícito
3. §9 nova: crank com SLA + fallback + `default_reason` distinção
4. §10 Pré-Fase 0: adicionar Wyoming LLC + opinion letter FCRA
5. §10 Pré-Fase 1: pergunta-filtro nos newbies
6. §13 (critérios go/no-go mainnet) incluir grace per-pool on-chain como bloqueador explícito
7. Nova § sobre palavras-gatilho regulatórias proibidas em material público

### Importante

**v0.6 documenta decisões já tomadas, não é o processo de tomar decisões.** Issues #1-4 + #6 precisam estar em andamento antes de v0.6 ser escrita.

### Critério de aceitação

- [ ] PR novo aberto com `docs/pt/pre-ceremony-beta-proposta-v0.6.md` (não emenda do #400)
- [ ] v0.5.3 marcada como "obsoleta — substituída por v0.6"
- [ ] Histórico de versões atualizado

**Owner:** ___________
**Deadline:** ___________
**Bloqueia:** Não bloqueia Dia 1-5 do critical path. Bloqueia coordenação ops a partir do Dia 5.

---

## Issue 6 — Mapeamento regulatório + Opinion letter FCRA

**Title:** `[pre-canary] Mapeamento regulatório: opinion letter de crypto/FCRA antes do post público pré-Fase 1`

**Body:**

Doc fundacional §3 — com produto = score exportável pra decisões de crédito, risco principal não é CIS/money transmission. É **Consumer Reporting Agency (FCRA nos EUA), LGPD + Marco Open Finance (Brasil), GDPR + PSD2 (Europa).**

### Trigger regulatório

Palavras a evitar em material público antes da opinion letter:

- "usado para decisões de crédito"
- "credit score"
- "creditworthiness"
- "yield combinado com pooling de fundos"
- "guaranteed" em qualquer contexto financeiro

### Custo + tempo

- Opinion letter de advogado crypto-especializado: $2.000-5.000
- Tempo: 1-2 semanas

### Critério de aceitação

- [ ] Advogado contratado (lista de candidatos avaliados)
- [ ] Escopo do opinion letter definido (FCRA + LGPD mínimo; GDPR se time mira Europa)
- [ ] Opinion letter recebido
- [ ] Material público pré-Fase 1 (post + landing) revisado contra a opinion letter

**Owner:** ___________ (provavelmente Yvina ou Caio)
**Deadline:** ___________ (antes da Fase 1, não antes do Canary)
**Bloqueia:** Post público pré-Fase 1 (que recruta os 7 newbies da Issue #3)

---

## Issue 7 — Cranker production-grade

**Title:** `[pre-canary] CRÍTICO: Cranker production-grade com SLA + default_reason distinction`

**Body:**

Achado de verificação de infra (ver `docs/pt/pre-canary-verificacao-infra.md` §2): `services/orchestrator` é **demo-first driver**, não cranker de produção. Comment explícito no código: "the orchestrator never calls `settle_default`".

Doc fundacional §11 marca crank sem resiliência como **biggest weakness**: "Uma janela de downtime > grace period gera defaults involuntários on-chain que são incorrigíveis para fins de score."

### O que precisa

- Polling on-chain a cada 30-60s
- Chamar `settle_default` automaticamente quando `now > pool.nextCycleAt + GRACE_PERIOD_SECS`
- SLA documentado: max downtime aceitável (sugestão: 1h pre-mainnet, 5min mainnet)
- Mecanismo de distinção `default_reason`: infra (cranker offline) vs payment (membro não pagou)
- Monitoring + alertas externos (PagerDuty / Healthcheck.io / Pingdom)

### Opções de implementação

- **(A) Estender `services/orchestrator` atual** (~2-3 dias eng)
- **(B) Cranker novo from scratch** (~3-5 dias eng)
- **(C) Squads-style multisig com membros disparando manualmente** — não viável pra 48h cycle do Canary

### Critério de aceitação

- [ ] Cranker rodando em devnet com restart automático (systemd, pm2, ou Docker)
- [ ] Healthcheck endpoint que externalo monitor pode bater
- [ ] Alerta configurado pra Discord/Telegram do time se healthcheck falhar > 5min
- [ ] Documentação no `services/orchestrator/README.md` sobre SLA e fallback

**Owner:** ___________ (provavelmente Alrimar)
**Deadline:** ___________
**Bloqueia:** Dia 3-5 do critical path (configurar cranker pra 48h)

---

## Issue 8 — Script de mint de USDC devnet pros testers

**Title:** `[pre-canary] scripts/devnet/mint-usdc-testers.ts — distribuir USDC devnet pros 10 testers`

**Body:**

Achado de verificação de infra: `scripts/devnet/airdrop.ts` só dá SOL (max 5/request, faucet cap). Pra dar USDC devnet pros testers, precisa script novo OU usar faucet público (Circle / Solana).

### O que precisa

Script TypeScript que:

1. Usa mint authority do USDC mock devnet do RoundFi
2. Mint X USDC pra cada wallet de tester (X = aporte × ciclos × buffer)
   - Canary: 10 USDC × 10 ciclos × 1.5 = 150 USDC
   - Semanal: 50 USDC × 10 ciclos × 1.5 = 750 USDC
3. Idempotente (não mintar de novo se saldo > threshold)
4. Aceita lista de wallets via arquivo ou argv

### Tempo estimado

30-60 min eng.

### Critério de aceitação

- [ ] `scripts/devnet/mint-usdc-testers.ts` commitado
- [ ] `package.json` script `devnet:mint-testers` adicionado
- [ ] Teste com 1 wallet em devnet local mostra saldo correto
- [ ] Idempotência verificada (rodar 2x não muda saldo se já está > threshold)

**Owner:** ___________
**Deadline:** ___________
**Bloqueia:** Dia 11-13 do critical path (distribuir USDC pros testers selecionados)

---

## Issue 9 — Discord bot de auto-tracking de mensagens

**Title:** `[pre-canary] Discord bot pra logar mensagens por usuário (dependência da fórmula composite-score dos vets)`

**Body:**

§10 D2 da v0.5.3: seleção dos 3 vets da Fase 1 usa `(on_time_rate × 0.6) + (discord_messages_normalized × 0.4)`. **Sem bot logando desde dia 1 do Canary, `discord_messages_normalized` é teatro.**

### Achado de verificação de infra

`grep -rln "discord|telegram.*bot" services/ scripts/` retorna zero. Nada implementado.

### Opções

- **(A) Bot existente free tier:** Statbot, MEE6 (free tier), Carl-bot. ~30min setup.
- **(B) Bot custom Node.js/Python** com discord.js. ~2-4h.
- **(C) Descartar a fórmula** e usar só on-time rate pra ranquear vets. Simplifica mas perde sinal de engajamento social.

### Decisão dependente

Se (A) ou (B): bot precisa estar **ativo desde o ciclo 1 do Canary**. Setup tem que estar feito no Dia 11-13.

Se (C): a fórmula muda na proposta v0.6 (Issue #5). Documentar como decisão tomada.

### Critério de aceitação

- [ ] Decisão registrada (A/B/C)
- [ ] Se A/B: bot ativo no servidor Discord/Telegram do beta, logando contagem por usuário
- [ ] Se C: §10 D2 atualizado em v0.6 com fórmula simplificada

**Owner:** ___________
**Deadline:** ___________
**Bloqueia:** Seleção dos 3 vets (Dia 11-13 da Pré-Fase 1, fim do Canary)

---

## Issue 10 — Push notification infra

**Title:** `[pre-canary] Push notification infra (OneSignal ou fallback email/Discord manual)`

**Body:**

Achado de verificação de infra: zero implementação de push notif no código-fonte (só artefatos de build do Next.js).

§2 do fundacional lista "push notifications úteis vs. ruído" como variável observada. **Sem infra, variável não é observável.**

### Opções

- **(A) OneSignal free tier** (até 10k MAU). ~1 dia eng (SDK + backend endpoint).
- **(B) Email diário automático** via Resend.com (free até 3000 emails/mês). ~3-4h eng.
- **(C) Discord manual disparado pela Yvina.** Zero eng. Pior UX.

### Recomendação

(A) pra Fase 1, (B) ou (C) aceitável pra Canary (cycle 48h pode esperar 24h até email diário).

### Critério de aceitação

- [ ] Decisão registrada
- [ ] Se (A): SDK integrado no app, endpoint backend implementado, 1 teste end-to-end com tester real
- [ ] Se (B): cron job + template de email funcionando
- [ ] Se (C): Yvina confirma compromisso de disparar manualmente a cada ciclo durante Canary

**Owner:** ___________
**Deadline:** ___________
**Bloqueia:** Variável observada do §2 (não bloqueia start)

---

## Pós-criação das 10 issues

Yvina (ou quem assumir o follow-up de 1h pós-reunião):

1. Criar label `pre-canary-blocker` no repo se não existe
2. Aplicar label nas 10 issues
3. Criar milestone "Pre-Canary Day 15 GO" com deadline = data alvo do start
4. Linkar issues no PR #400 (comentário com lista de checkboxes)
5. Agendar follow-up de 15min em 7 dias pra status check
