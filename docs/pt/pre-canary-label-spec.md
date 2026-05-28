# Spec do Label `sev-low-deadline-canary`

**Item Dia 1-2 do critical path · §10 / §14.1 da proposta v0.5.3**

**Objetivo:** label do GitHub que materializa o gate "Low SEV não bloqueia Fase 1, mas exige fix-plan com assignee + due date".

---

## Para criar (Yvina, ≤30s)

GitHub → repo `alrimarleskovar/RoundFinancial` → `Issues` → `Labels` → `New label`.

| Campo | Valor |
|---|---|
| **Nome** | `sev-low-deadline-canary` |
| **Descrição** | `Low SEV with assignee + due date — gate per §14.1 of pre-ceremony beta proposta. Does NOT block Canary or Fase 1; missing fix-plan does.` |
| **Cor** | `#FBCA04` (yellow, mesmo hex das `good first issue` defaults — sinaliza "active triage", não "blocker") |

Atalho via URL direto:
```
https://github.com/alrimarleskovar/RoundFinancial/labels
```

---

## Cor — racional

| Cor | Quem usa | Por que NÃO aqui |
|---|---|---|
| Vermelho `#d93f0b` | Critical/High blockers | Sugere "para tudo" — Lows não param |
| Verde `#0e8a16` | OK / merged | Sugere já resolvido — Lows são pendentes |
| **Amarelo `#FBCA04`** | **Active triage** | **Correto:** "tem deadline, está em fila, não para o trem" |
| Cinza `#cccccc` | Triage / unlabeled | Muito passivo — Lows têm deadline obrigatório |

---

## Quando aplicar

Toda issue criada via fluxo do §14.1 (Low SEV não bloqueia gate, mas precisa de fix-plan) recebe este label **automaticamente** durante triagem. Critério:

- ✅ SEV severity = Low (per rubrica em `docs/security/internal-audit-findings.md`)
- ✅ Issue tem `assignee` setado
- ✅ Issue tem `due date` em milestone OU campo custom (max 30d da criação)
- ❌ Sem fix-plan? → não é Low qualified, escala pra Medium triage

---

## Quando remover

- Issue fechada (fix mergeado) → label permanece histórico, mas issue closed
- Reclassificada como Medium/High → trocar pra label de severity correspondente
- Deadline vencido sem PR → escala automática pra Medium (label trocado)

---

## Verificação pré-Fase 0 (item §10)

Comando pra validar o label existe + tem ≥1 issue de exemplo:

```bash
gh label list --repo alrimarleskovar/RoundFinancial | grep sev-low-deadline-canary
gh issue list --repo alrimarleskovar/RoundFinancial --label sev-low-deadline-canary --state open
```

Gate §10 passa quando:

- [ ] Label existe no repo
- [ ] Documentação (este doc) commitada em `docs/pt/`
- [ ] Referenciado no procedimento de aborto (`pre-ceremony-beta-procedimento-aborto.md` §2 Passo 2)

---

## Cross-refs

- Proposta v0.5.3 §5 (SEV gate) — define o gate
- Proposta v0.5.3 §10 (checklist Pré-Fase 0) — lista label como item
- Proposta v0.5.3 §14.1 — define formato do fix-plan
- `docs/security/internal-audit-findings.md` — rubrica de severidade
- `docs/pt/pre-ceremony-beta-procedimento-aborto.md` Passo 2 — invoca esta classificação
