# Pacote pra reunião Canary — lista de docs

**Reunião:** 2026-05-24 · ~45 min · 4 founders · output esperado: 8 issues GitHub + 1 ack registrado.

---

## Ordem de leitura sugerida — antes da call (~15 min total)

| Ordem | Doc | Tempo | Quem precisa ler |
|---|---|---|---|
| 1️⃣ | `docs/pt/pre-canary-briefing.md` | **3 min** | **Todos** — TL;DR das 8 decisões + ack |
| 2️⃣ | `docs/pitch/pre-canary-decisoes-slides.html` (abrir no browser) | 5 min skim | **Todos** — só skim, vão usar projetado na call |
| 3️⃣ | `docs/pt/pre-canary-pauta-decisoes.md` | 5 min | Quem quer contexto original das 5 decisões iniciais |
| 4️⃣ | `docs/pt/pre-canary-verificacao-infra.md` | 5 min | Alrimar — origem das 4 decisões novas (cranker, USDC mint, push, Discord) |
| 5️⃣ | `services/indexer/prisma/migrations/2026-05-canary-score-fields-options/README.md` | 5 min | Alrimar — quando chegar na Decisão 1 (schema), já tem opções pré-prontas |

---

## Durante a call

- **Projetar:** `pre-canary-decisoes-slides.html` (setas pra navegar)
- **Aberto pra consulta rápida:** `pre-canary-briefing.md`
- **Quem anota:** Yvina

---

## Pós-reunião — checklist pra Yvina (~1h)

1. Ata no canal interno (1 linha por decisão: owner + deadline + artefato)
2. Criar 8 issues GitHub usando textos prontos em `docs/pt/pre-canary-issues-draft.md`
3. Criar label `sev-low-deadline-canary` — instruções em `docs/pt/pre-canary-label-spec.md` (≤30s GitHub UI)
4. Atualizar checklist §10 do PR #400
5. Agendar follow-up 15 min em 7 dias

---

## Templates operacionais (Yvina aplica nas semanas seguintes)

| Doc | Quando usar |
|---|---|
| `docs/pt/pre-ceremony-beta-onboarding-testers.md` | Dia 11-13: enviar pros 10 testers Canary |
| `docs/pt/pre-ceremony-beta-termo-participacao.md` | Dia 11-13: tester aceita antes de entrar |
| `docs/pt/pre-ceremony-beta-procedimento-aborto.md` | Durante Canary/Fase 1: SEV ≥ Medium |
| `docs/pt/pre-ceremony-beta-flow-sev-smoke-test.md` | Dia 13-14: SEV no ensaio geral (gap pré-Dia 15) |

---

## Cross-refs úteis

- Proposta v0.5.3 (doc completo): `docs/pt/pre-ceremony-beta-proposta.md`
- Critical path §10: dentro da proposta, "Critical path do Pré-Fase 0"
- FREEZE.md: política de mudança durante o freeze + Active exceptions atualizadas até hoje
- Internal audit tracker: `docs/security/internal-audit-findings.md` (49 SEVs, 45+ closed; Critical/High 14/14)

---

## URLs GitHub (se preferir abrir no browser em vez de clonar)

```
https://github.com/alrimarleskovar/RoundFinancial/blob/claude/implement-roundfi-desktop-SRV6l/docs/pt/pre-canary-briefing.md
https://github.com/alrimarleskovar/RoundFinancial/blob/claude/implement-roundfi-desktop-SRV6l/docs/pt/pre-canary-pauta-decisoes.md
https://github.com/alrimarleskovar/RoundFinancial/blob/claude/implement-roundfi-desktop-SRV6l/docs/pt/pre-canary-verificacao-infra.md
https://github.com/alrimarleskovar/RoundFinancial/blob/claude/implement-roundfi-desktop-SRV6l/docs/pt/pre-canary-issues-draft.md
https://github.com/alrimarleskovar/RoundFinancial/blob/claude/implement-roundfi-desktop-SRV6l/docs/pt/pre-canary-label-spec.md
https://github.com/alrimarleskovar/RoundFinancial/tree/claude/implement-roundfi-desktop-SRV6l/services/indexer/prisma/migrations/2026-05-canary-score-fields-options
```

Pra os slides HTML, baixe e abra local (browser não renderiza HTML do GitHub raw):

```bash
curl -O https://raw.githubusercontent.com/alrimarleskovar/RoundFinancial/claude/implement-roundfi-desktop-SRV6l/docs/pitch/pre-canary-decisoes-slides.html
# OU clica em "Raw" no GitHub > Salvar como > abre no browser
```

---

## Estado do código local validado hoje (2026-05-24)

Pra compartilhar como confidence signal antes da reunião:

```
✅ Tests parity (Rust↔TS): 12/12
✅ Tests frontend allowlist: 24/24
✅ Lint (prettier): limpo
🟡 cargo audit: 2 vulns + 8 warnings — todos toolchain Solana (SEV-011 tracked)
✅ Fuzz baseline: 6 targets × 100M iter = 600M iter novos, 0 crashes,
   coverage estável. Cumulativo total ~9.85B inputs (503M histórico + 600M re-validação 2026-05-24 + 8.75B overnight sweep 2026-05-24; README atualizado).
✅ cargo build-sbf --workspace: 3 programs compilam, só warnings
   anchor-debug (SEV-012 upstream)
✅ pnpm app build: 17 static pages incluindo robots.txt + sitemap.xml
```

Nenhuma regressão. **Bloqueador pra Canary é decisão, não código.**
