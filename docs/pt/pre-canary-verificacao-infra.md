# Relatório de Verificação de Infra — Pre-Canary

**Data:** 2026-05-22
**Autor:** Claude (investigação read-only do repo)
**Para:** Time RoundFi (input da reunião de decisões)
**Status:** descobertas que mudam premissas da pauta de reunião

---

## TL;DR — 3 achados que mudam a reunião

1. **Indexer NÃO captura `paid_at`/`due_at` hoje.** Schema atual armazena `blockTime` (quando a tx foi minerada), mas não o "due_at" calculado, nem `delta_seconds`, nem `grace_used`. **Decisão 1 da pauta não é "decisão" — é mudança real de schema com migration.**

2. **NÃO existe cranker de produção.** O `services/orchestrator` é demo-first driver, lê literalmente "the orchestrator never calls settle_default — a missed contribution is logged as member.missed". Cranker real é build cost não-orçado e confirma a "biggest weakness" do fundacional (§3 — crank sem design de resiliência).

3. **Sem script de USDC mint pra testers.** `scripts/devnet/airdrop.ts` só dá SOL. Pra dar USDC devnet aos 10 testers do Canary, precisa script novo (ou usar mint authority manualmente). ~50 LoC, mas precisa estar pronto antes de Dia 11 do critical path.

---

## 1. Schema do indexer — estado atual

Confirmado em `services/indexer/prisma/schema.prisma`.

### O que já existe

**`ContributeEvent`:**
- `txSignature`, `poolId`, `memberId`
- `contributorWallet` (nullable, SEV-014 fix)
- `slotIndex`
- ❌ **Sem `cycle`** (precisa derivar de `pool.currentCycle` no momento — pode ter race condition)
- ❌ **Sem `blockTime` no que olhei** (vou re-conferir mas suspeito que está fora)
- ❌ **Sem `paid_at`, `due_at`, `delta_seconds`, `grace_used`**

**`ClaimEvent`:**
- `txSignature`, `poolId`, `memberId`
- `recipientWallet` (nullable, SEV-014)
- `cycle` ✅
- `slotIndex`
- `amountPaid`
- `blockTime` ✅ (BigInt, Unix seconds)
- `slot` (Solana slot, não pool slot)

**`DefaultEvent`:**
- Tem breakdown da seizure (Triple Shield)
- `cycle`, `slotIndex`
- `blockTime` ✅
- ❌ **Sem `default_reason`** (motivo do default — infra vs payment vs voluntary)

### O que falta pra suportar score como produto

Comparando com fundacional §9 P0:

| Campo necessário | Existe? | Onde |
|---|---|---|
| `paid_at` (timestamp exato do pagamento) | 🟡 Indireto via `blockTime` no Claim, ausente no Contribute | Adicionar `blockTime` no `ContributeEvent` se já não existe |
| `due_at` (calculado: `pool.startedAt + cycle * cycleDuration`) | ❌ Não | Calcular no indexer e persistir, OU calcular on-the-fly nos consumers |
| `delta_seconds` (paid_at − due_at) | ❌ Não | Idem |
| `grace_used` (pagou dentro de cycle/2 ou dentro do grace?) | ❌ Não | Calcular e persistir |
| `slot_position` (1-10 do pool) | ✅ `slotIndex` | OK |
| `cycle_number` (1-10) | 🟡 Falta em Contribute, tem em Claim/Default | Adicionar em Contribute |
| `default_reason` | ❌ Não | Novo campo no `DefaultEvent`, requer instruction change on-chain OR derivação off-chain |

### Implicação pra Decisão 1 da reunião

A pauta original tratava como "decisão de 2h". **Não é.** Decisão de schema é 2h, mas implementação requer:

- 2-4h pra adicionar campos no Prisma schema + migration
- 2-4h pra atualizar indexer event handler (`services/indexer/src/`) pra calcular `due_at`, `delta_seconds`, `grace_used` no momento do evento
- Decisão arquitetural sobre `default_reason`: calculado off-chain (heurística: `blockTime - graceDeadline > X → infra`) ou capturado on-chain (requer nova instruction)

**Estimativa realista:** 1-2 dias de eng (não 2h) entre decisão e indexer rodando com novo schema. Cabe no Dia 3-5 do critical path se começar imediatamente pós-reunião.

---

## 2. Cranker de produção — não existe

### O que existe

`services/orchestrator` (~9 arquivos em src/). Package.json descreve como:

> *"RoundFi lifecycle orchestrator — **deterministic, demo-first driver** for pool creation, cycles, defaults, and close."*

`runCycle.ts` (driver de ciclos) tem comment explícito:

> *"the orchestrator never calls `settle_default` — a missed contribution is logged as `member.missed` with a note that on-chain settlement would fire after the 7-day grace window (handled separately by the bankrun edge test, **not reachable on a fresh localnet**)."*

Tradução: **orchestrator é pra demos e edge tests, não pra rodar pool em devnet contínuo por 20 dias.**

### O que falta pra Canary

Cranker de produção precisa:

- **Polling do estado on-chain** a cada ~30-60s pra detectar ciclos que precisam avançar
- **Chamar `settle_default` automaticamente** quando `now > pool.nextCycleAt + GRACE_PERIOD_SECS`
- **SLA documentado:** se cranker fica offline > grace, defaults involuntários são registrados on-chain → score destruído (fundacional §11 CRÍTICO)
- **Distinção `default_reason`:** infra (cranker offline) vs payment (membro não pagou). Hoje impossível distinguir post-fato.
- **Monitoring + alertas:** PagerDuty/healthcheck externo apontando se cranker stopou.

### Implicação pra critical path

A v0.5.3 §10 listou "Cranker rodando + configurado pra 48h" como **bloqueador P1**. Realidade: **cranker precisa ser construído**, não só configurado.

Estimativa: 3-5 dias de eng pra cranker production-grade com SLA. **Mesma ordem de grandeza do backend de referral.** Pode paralelizar.

**Risco se for skipped:** doc fundacional §11 (Crank downtime em mainnet — CRÍTICO): "Uma janela de downtime > grace period gera defaults involuntários on-chain que são incorrigíveis para fins de score." Em devnet com USDC mintado isso é só perda de dado de teste; em mainnet com produto = score é destruição de produto.

---

## 3. USDC devnet pra testers

### O que existe

`scripts/devnet/airdrop.ts` — só dá SOL (max 5 SOL/request, faucet cap). Não cobre USDC.

### O que falta

Script `scripts/devnet/mint-usdc-testers.ts` que:

1. Usa a mint authority do USDC mock devnet do RoundFi
2. Mint X USDC pra cada wallet de tester (X = 10 USDC × 10 ciclos × 1.5 buffer = 150 USDC pra Canary; 500 USDC × 1.5 = 750 pra Semanal)
3. Idempotente (não mintar de novo se já tem saldo > threshold)

Trabalho estimado: 30-60 min. **Trivial, mas precisa estar pronto antes de Dia 11 do critical path.**

### Alternativa

Faucet público de USDC devnet (Circle ou Solana faucet) — verificar se está operacional e tem rate limit aceitável. Se sim, dispensa o script.

---

## 4. Push notifications — ausente

`grep -rln "onesignal|push.*notif|fcm|firebase" services/ app/src/` retorna **zero hits** em código-fonte (só artefatos de build do Next.js, irrelevantes).

### Implicação

§2 do fundacional lista "push notifications úteis vs. ruído" como variável observada. **Sem infra, variável não é observável.**

Build cost real:

- Setup OneSignal free tier (até 10k MAU grátis): ~2h
- SDK no app frontend: ~3-4h
- Endpoint backend pra disparar notif por evento (pool.nextCycleAt approaching): ~3-4h
- Validar com 10 testers que recebem: ~1h

**Total: ~1 dia eng.** Pode rodar em paralelo com cranker/backend.

### Alternativa low-effort

Se push notif é P2 (não bloqueador), substituir por:
- Email diário automático com status do pool (Resend.com ~$0/mo até 3000 emails)
- Discord notif manual disparada pela Yvina no canal dedicado

Ambos são piores em UX (push é mais imediato) mas viáveis pro Canary. Push notif vira P1 pra Fase 1.

---

## 5. Discord bot — ausente

`grep -rln "discord|telegram.*bot|tg.*bot" services/ scripts/` retorna **zero hits**.

### Implicação

§10 D2 da v0.5.3 (composite score dos vets): `discord_messages_normalized` depende de **logging desde dia 1 do Canary**. Sem bot, não tem dado.

Build cost: instalar bot existente (Statbot, MEE6 free tier, ou Carl-bot) que conta mensagens por usuário, ou rodar um bot Python/Node simples com discord.js. ~2-4h.

**Decisão pendente:** comprar/setup OFC (off-chain) ou descartar a fórmula e usar só on-time rate pra ranquear vets?

---

## 6. Recomendações concretas pra reunião

Resumo do que muda na pauta original:

| Decisão | Tempo estimado original | Tempo real necessário |
|---|---|---|
| #1 Schema indexer | 2h | 2h decisão + 1-2 dias implementação |
| #2 Data layer mode | 30min | 30min decisão + impacto em #1 |
| #3 Persona newbies | 15min | 15min |
| #4 Wyoming LLC | 15min | 15min decisão + 2-5d filing |
| #5 v0.6 | 15min | 15min decisão + 3-5d redação |

**Adições à pauta:**

- **#6 Cranker production-grade:** quem constrói (Alrimar provável), quando, SLA mínimo aceitável. Decisão de 15min, build de 3-5d.
- **#7 USDC mint script:** quem escreve, quando. Decisão de 5min, build de 30-60min.
- **#8 Push notification:** OneSignal vs email vs Discord-manual no Canary? Decisão de 10min.
- **#9 Discord message bot:** instalar Statbot/MEE6 free tier ou descartar fórmula composite score?

Reunião sai de 5 decisões em 30min pra **9 decisões em ~50min**. Vale ajustar a agenda.

---

## 7. O que estou fazendo enquanto vocês discutem

Em paralelo, sem depender da reunião:

- ✅ **B: este relatório** (concluído)
- 🟡 **D: draft das 5 (agora 9) issues** — em progresso
- 🟡 **A: PR do feature-gate do pinning test** — em progresso
- 🟡 **C: fuzz fixtures Canary** — em progresso

Todos os 4 são entregáveis seguros (não dependem de decisões pendentes).

---

## 8. Risco que este relatório expõe

V0.5.3 tratava infra como "checklist de configuração". Realidade: **2 itens são build, não configuração.** Cranker (3-5 dias) e indexer extensions (1-2 dias) precisam estar orçados no critical path.

**Estimativa atualizada do critical path:** 2-3 semanas vira **3-4 semanas** se cranker for build novo. Se for adaptação do orchestrator atual, pode caber em 2-3 semanas com pressão.

**Decisão pra reunião:** orchestrator atual é base aceitável pra estender em "cranker production-grade", ou é descartado e cranker é built from scratch?
