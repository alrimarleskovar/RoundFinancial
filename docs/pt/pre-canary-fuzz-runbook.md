# Runbook do Fuzz — Gate Pré-Canary

**Owner:** Gabriel (fuzz owner)
**Quando:** Dia 8-11 do critical path
**Bloqueia:** start do Canary (Dia 15)

---

## Correção a uma premissa minha

A proposta v0.5.3 falou em "fuzz fixture Canary com `installment=10e6`, `cycle=172_800`, etc". **Isso estava conceitualmente errado.** Os 6 fuzz targets em `crates/math/fuzz/fuzz_targets/` são **input-agnostic** — eles tomam os argumentos da função math diretamente (`d_init`, `c_init`, `missed`, `solidarity_available`, etc), não params de pool. Pool params são contexto que define a forma das inputs, mas não passam pelos targets.

**O que isso muda:** não há "fixture canary" pra criar. O gate é rodar o fuzz por tempo suficiente contra o corpus existente + corpus do scheduled lane + zero crashes.

---

## Comando exato pra rodar (cada target)

```bash
cd /home/user/RoundFinancial/crates/math/fuzz

# One-time setup (se ainda não fez)
rustup toolchain install nightly
cargo install cargo-fuzz --locked

# Rodar cada target por 30min (corresponde a 1 run do scheduled lane)
for t in cascade waterfall dc_invariant escrow_vesting bps seed_draw; do
  echo "=== Fuzzing $t for 30min ==="
  cargo +nightly fuzz run $t -- -max_total_time=1800
done
```

Total wall-clock: **~3 horas sequencial.** Pode paralelizar em 6 cores diferentes (cada target em um core) e baixar pra ~30min real.

---

## Critério de pass/fail

**PASS:**
- 6 targets completam sem crashes
- `crates/math/fuzz/artifacts/<target>/` vazio (sem `crash-*` files novos)
- Output ao final de cada run mostra "Done X runs in Y secs"

**FAIL:**
- Qualquer crash em artifacts → triagem obrigatória (ver §6 do README do fuzz)
- Crash conhecido (já em corpus) reaparece → bug regression, escala pro Alrimar

---

## Reuso do corpus weekly (recomendado)

O scheduled lane (`.github/workflows/fuzz-scheduled.yml`) já roda 30min/target/semana e mantém corpus evolutivo. Pra Canary, vale **baixar o corpus mais recente** antes do gate:

```bash
# Pull do scheduled lane mais recente
for t in cascade waterfall dc_invariant escrow_vesting bps seed_draw; do
  gh run download --name merged-corpus-$t -D /tmp/$t-corpus 2>/dev/null || echo "no scheduled corpus for $t yet"
  if [ -d /tmp/$t-corpus ]; then
    cp /tmp/$t-corpus/* crates/math/fuzz/corpus/$t/ 2>/dev/null
  fi
done

# Depois roda o fuzz com o corpus aumentado (mesmo comando)
```

**Por que vale:** corpus weekly tem mutations acumuladas que cobrem caminhos que o run de 30min sozinho talvez não atinja. Aumenta cobertura efetiva sem aumentar wall-clock.

---

## Gate pré-Fase 1 (entre Canary e Semanal)

Rodar **de novo** os 6 targets antes de Pré-Fase 1, com o corpus atualizado (que terá crescido durante o Canary). Mesmo comando. Mesma validação.

---

## O que NÃO é gate

Estes itens estavam na minha v0.5.3 mas confundo: **não bloqueiam start do Canary.**

- ❌ Fuzz com fixture específica de Canary — não existe esse modo
- ❌ Validação de cobertura de default em "diferentes posições de slot" — isso é teste integration (bankrun), não math fuzz
- ❌ Fuzz do timing grace × cycle_duration — math crate não consome grace (confirmado em §7 da proposta v0.5.3)

---

## Quando reportar

Após cada run completo:

- Status (pass/fail) no canal interno do time
- Tempo total + número de runs por target
- Se houver crash: paste do `cargo +nightly fuzz run <target> <crash-path>` reproduzindo

Se rodando 30min × 6 targets em paralelo em laptop local (6 cores), total ~30-45min. Em CI runner serial, ~3h. Decisão de onde rodar é do Gabriel.

---

## Anti-pattern a evitar

**❌ Não rodar fuzz local "rapidamente" (60s) e declarar gate fechado.** O lane de PR já faz isso a cada commit em `crates/math/**`. Pra gate pré-fase, vale tempo de mutação mais longo (30min/target mínimo). 60s pega regressões óbvias contra corpus existente; 30min descobre paths novos.

**❌ Não ignorar crashes "já conhecidos".** Se crash reaparece, o fix anterior não cobriu o caso real ou foi revertido. Triagem obrigatória.
