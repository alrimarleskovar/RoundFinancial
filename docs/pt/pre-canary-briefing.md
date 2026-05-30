# Briefing Pré-Reunião Canary — 1 página

**Leitura:** ~3 min · **Reunião:** ~45 min · **Output esperado:** 8 decisões com owner + deadline + artefato (+ 1 ack rápido)

---

## Estado em uma frase

PRs #401 (treasury ADR 0008) e #403 (Pass-18 judge readiness — 47 SEVs / 13-13 C+H no merge; **49 / 14-14 após o external-audit pass 2026-05-24** que trouxe SEV-047/048 / 300+ testes sincados) mergearam hoje. Doc da proposta v0.5.3 + 3 templates operacionais (procedimento aborto, termo participação, onboarding) + infra do critical path estão prontos no PR #400. **Falta só este time bater martelo nas 8 decisões pra começar Dia 1-2 do critical path (~2-3 semanas até start do Canary).**

---

## As 8 decisões + 1 ack — visão rápida

### Originais da pauta (5)

| # | Decisão | Trade-off central | Recomendação |
|---|---|---|---|
| **1** | Schema do indexer | 6 campos brutos (sem `default_reason`) vs **7 campos (6+`default_reason`)** vs 8 (com `pool_state_hash`) | **(B) 7 campos** — contestabilidade do score FCRA |
| **2** | Data layer mode | Interno-only vs exportável via CPI vs API HTTPS | **(B) Exportável** — caminho do produto fundacional, exige opinion letter FCRA |
| **3** | Persona dos 7 newbies | Sem filtro / soft filter / pergunta-filtro do fundacional | **(C) Pergunta fundacional** — "Você já enfrentou dificuldade de acessar crédito…" |
| **4** | Wyoming LLC | Auto-filing online / via advogado / BVI combo | **(A) Auto-filing** — $200-400, 2-5d, Yvina organizer |

### Adicionadas pelo relatório de infra (4)

| # | Decisão | Realidade | Recomendação |
|---|---|---|---|
| **5** | Cranker production-grade | Não existe (orchestrator é demo-first). 2-3d eng | **Owner: Alrimar.** Estender orchestrator. SLA: max 1h downtime pré-mainnet. |
| **6** | USDC mint script pros testers | Só `airdrop.ts` (SOL). 30-60min eng | **Owner: Caio** (desafoga Alrimar). Build `scripts/devnet/mint-usdc-testers.ts` |
| **7** | Push notification (2 camadas) | Não implementado. **Canary** (curto) ≠ **Fase 1** (longo, hábito) | **Canary: Discord/email manual (Yvina, 0 eng) · Fase 1: OneSignal (~1d eng, build pós-Canary)** |
| **8** | Discord bot auto-tracking | Não implementado. Fórmula min-max do §10 D2 (selecao de vets) depende disso | **(A) Statbot/MEE6 free tier** — ~30min setup. Confirmar rate limit pra 30 testers × 70d. |

### Ack rápido (não precisa de slot dedicado)

- **v0.6 da proposta** — Claude rascunha após reunião, Alrimar revisa. Não é decisão, é processo. 1 linha na ata.

---

## O que NÃO está na pauta (não desperdiçar tempo)

- ✅ Nomeações (lead eng, fuzz owner, on-call) — já mapeadas: Alrimar/Gabriel/Yvina/Caio
- ✅ Label `sev-low-deadline-canary` — 1 clique do Yvina
- ✅ Capacidade ops — Yvina confirmou primary on-call
- ✅ v0.6 da proposta — Claude rascunha, Alrimar revisa (ack rápido, não decisão)

## ⚠️ Risco operacional pra flagar na reunião

**Alrimar está sobrecarregado.** Tasks atribuídas/sugeridas:

- Decisão 5 (Cranker) — 2-3d eng focado
- Lead eng on-call durante 3 meses (Canary + Fase 1)
- Fuzz Canary fixture (6 targets × 1M iter + analisar findings)
- Revisar v0.6 que Claude rascunha

**Pergunta pra reunião:** se Alrimar afundar em algum item, qual é o backup? Decisão 6 (USDC mint script) já desviada pro Caio. Outras opções de descarga: Gabriel pode owner sub-tarefa do cranker (ex: healthcheck endpoint)?

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
- [ ] Criar 8 issues no GitHub com label `pre-canary-blocker` (texto pronto em `docs/pt/pre-canary-issues-draft.md`) + registrar v0.6 como follow-up de Claude
- [ ] Atualizar checklist §10 do PR #400
- [ ] Agendar follow-up 15 min em 7 dias pra status check

---

## Risco se não decidir tudo amanhã

| Item adiado | Custo |
|---|---|
| #1 Schema indexer | **Irrecuperável após Dia 1 do Canary.** Sem `paid_at` desde início, 70d de dados da Fase 1 perdem valor pro produto = score |
| #2 Data layer mode | Afeta schema do #1. Decisão tardia = retrabalho do indexer |
| #5 Cranker | Sem cranker, ciclo não avança no Dia 15. Beta morre no Dia 1 |
| Outros | Atraso de 1-7 dias por decisão, mas reversíveis |

**Conclusão:** itens #1, #2, #5 são bloqueadores não-negociáveis. Outros podem virar GitHub issue com 24-48h pra decidir off-line se faltar tempo.

---

## Materiais de apoio na reunião

| Doc | Pra que |
|---|---|
| `docs/pt/pre-canary-pauta-decisoes.md` | 5 decisões originais com contexto + opções |
| `docs/pt/pre-canary-verificacao-infra.md` | Achados que adicionaram 4 decisões + impacto técnico |
| `docs/pt/pre-canary-issues-draft.md` | 10 issues prontas pra colar pós-reunião |
| `docs/pt/pre-ceremony-beta-proposta.md` §13 | Decisões abertas listadas |
| `docs/pitch/pre-canary-decisoes-slides.html` | Slides 1-por-decisão pra estruturar a call |
