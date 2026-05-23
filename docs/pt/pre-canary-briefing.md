# Briefing Pré-Reunião Canary — 1 página

**Leitura:** ~3 min · **Reunião:** ~50 min · **Output esperado:** 9 decisões com owner + deadline + artefato

---

## Estado em uma frase

PR #401 (treasury ADR 0008) mergeou hoje, destravando numeração futura. Doc da proposta v0.5.3 e infra do critical path estão prontos no PR #400. **Falta só este time bater martelo nas 9 decisões pra começar Dia 1-2 do critical path (~2-3 semanas até start do Canary).**

---

## As 9 decisões — visão rápida

### Originais da pauta (5)

| # | Decisão | Trade-off central | Recomendação |
|---|---|---|---|
| **1** | Schema do indexer | 6 campos brutos (sem `default_reason`) vs 7 campos (com) vs 8 (com `pool_state_hash`) | **(B) 7 campos com `default_reason`** — contestabilidade do score FCRA |
| **2** | Data layer mode | Interno-only vs exportável via CPI vs API HTTPS | **(B) Exportável** — caminho do produto fundacional, exige opinion letter FCRA |
| **3** | Persona dos 7 newbies | Sem filtro / soft filter / pergunta-filtro do fundacional | **(C) Pergunta fundacional** — "Você já enfrentou dificuldade de acessar crédito…" |
| **4** | Wyoming LLC | Auto-filing online / via advogado / BVI combo | **(A) Auto-filing** — $200-400, 2-5d, Yvina organizer |
| **5** | v0.6 da proposta | Eu escrevo first-draft / skip / pós-Canary | **(A) First-draft** depois das 4 decisões acima registradas |

### Adicionadas pelo relatório de infra (4)

| # | Decisão | Realidade | Recomendação |
|---|---|---|---|
| **6** | Cranker production-grade | Não existe (orchestrator é demo-first). 3-5d eng | **Owner: Alrimar.** Estender orchestrator OU rebuild. SLA: max 1h downtime pré-mainnet. |
| **7** | USDC mint script pros testers | Só `airdrop.ts` (SOL). 30-60min eng | **Owner: Alrimar/Caio.** Build `scripts/devnet/mint-usdc-testers.ts` |
| **8** | Push notification | Não implementado (zero hits). 3 opções: OneSignal (~1d) / email diário / Discord manual | **OneSignal pra Fase 1.** Pra Canary: aceitar email/Discord manual |
| **9** | Discord bot auto-tracking | Não implementado. Fórmula min-max do §10 D2 (selecao de vets) depende disso | **(A) Statbot/MEE6 free tier** — ~30min setup |

---

## O que NÃO está na pauta (não desperdiçar tempo)

- ✅ Nomeações (lead eng, fuzz owner, on-call) — já mapeadas: Alrimar/Gabriel/Yvina/Caio
- ✅ Label `sev-low-deadline-canary` — 1 clique do Yvina
- ✅ Capacidade ops — Yvina confirmou primary on-call

---

## Regras da reunião

1. **30 min era pra 5 decisões.** Realista pra 9 = **~50 min.** Já alocar.
2. Cada item tem **3 opções pré-formuladas.** Decidir entre as 3, não inventar 4ª.
3. **Output obrigatório:** nome do owner + deadline + artefato (GitHub issue, ADR, PR).
4. Se item empacar em 5 min → owner leva pra decisão off-line em ≤48h. Não trava reunião.
5. **Sem "vamos pensar mais".** Decisão pode ser ruim, mas não pode ser ausente.

---

## Pós-reunião (1h, Yvina)

- [ ] Postar ata no canal interno (1 linha por decisão)
- [ ] Criar 9 issues no GitHub com label `pre-canary-blocker` (texto pronto em `docs/pt/pre-canary-issues-draft.md`)
- [ ] Atualizar checklist §10 do PR #400
- [ ] Agendar follow-up 15 min em 7 dias pra status check

---

## Risco se não decidir tudo amanhã

| Item adiado | Custo |
|---|---|
| #1 Schema indexer | **Irrecuperável após Dia 1 do Canary.** Sem `paid_at` desde início, 70d de dados da Fase 1 perdem valor pro produto = score |
| #6 Cranker | Sem cranker, ciclo não avança no Dia 15. Beta morre no Dia 1 |
| #2 Data layer mode | Afeta schema do #1. Decisão tardia = retrabalho do indexer |
| Outros | Atraso de 1-7 dias por decisão, mas reversíveis |

**Conclusão:** itens #1, #2, #6 são bloqueadores não-negociáveis. Outros podem virar GitHub issue com 24-48h pra decidir off-line se faltar tempo.

---

## Materiais de apoio na reunião

| Doc | Pra que |
|---|---|
| `docs/pt/pre-canary-pauta-decisoes.md` | 5 decisões originais com contexto + opções |
| `docs/pt/pre-canary-verificacao-infra.md` | Achados que adicionaram 4 decisões + impacto técnico |
| `docs/pt/pre-canary-issues-draft.md` | 10 issues prontas pra colar pós-reunião |
| `docs/pt/pre-ceremony-beta-proposta.md` §13 | Decisões abertas listadas |
| `docs/pitch/pre-canary-decisoes-slides.html` | Slides 1-por-decisão pra estruturar a call |
