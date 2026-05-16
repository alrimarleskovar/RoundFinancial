# Auditoria Técnica e de Segurança — RoundFinancial (Pass 8 — fresh re-audit pós W5)
**Auditor:** Adevar Labs
**Data:** 2026-05-16
**Branch:** `claude/web3-security-audit-2CA0r` synced com origin/main
**HEAD efetivo:** `3e1593c` (sem novos commits desde Pass 7 + push)
**Confirmação operacional:** rodei `git fetch origin main` — sem deltas. Re-audit fresh-eyes do repo todo focando em **áreas pouco exploradas nos 7 passes anteriores**.

---

## Sumário Executivo

Auditoria criteriosa cobrindo:
1. Canary script (`scripts/mainnet/canary-flow.ts`) — hand-decoded ProtocolConfig offsets
2. SDK decoders (`sdk/src/onchain-raw.ts`) — Pool + Member offsets verification
3. SEV-036 sweep extensão para outros admin fields
4. Cross-program CPI auth (is_valid_pool_issuer)
5. `init_if_needed` safety
6. Race conditions cross-propose triplets (treasury/authority/rep-auth/fee-bps)
7. Lamport/rent attack vectors via `close = X` patterns
8. Numeric overflow / underflow / boundary conditions

**Resultado:** Nenhum novo finding de severidade Low+. Algumas observações Informational (asymmetric protections, defensive coding suggestions). **Protocolo permanece em estado release-ready para audit externa formal.**

---

## Verificações com diff-level confidence

### ✅ Canary script offsets — todos verificados

`scripts/mainnet/canary-flow.ts` hand-decodes 8 fields de `ProtocolConfig`:

| Field | Offset (script) | Calculated (Rust) | Status |
|-------|----------------|-------------------|--------|
| authority | 8 | 8 | ✓ |
| paused | 210 | 210 | ✓ |
| treasury_locked | 212 | 212 | ✓ |
| max_pool_tvl_usdc | 253 | 253 | ✓ |
| max_protocol_tvl_usdc | 261 | 261 | ✓ |
| approved_yield_adapter | 277 | 277 | ✓ |
| approved_yield_adapter_locked | 309 | 309 | ✓ |
| commit_reveal_required | 310 | 310 | ✓ |

Hand-traced manually. All correct.

### ✅ Pool + Member decoder offsets — verified

`sdk/src/onchain-raw.ts`:
- Pool: 28 offsets from 8 to 236 (slots_bitmap). All match `state/pool.rs` declaration order.
- Member: 21 offsets from 8 to 172. All match `state/member.rs`.
- `MEMBER_ACCOUNT_SIZE = 187` matches `Member::SIZE` exactly.
- `STATUS_NAMES` array includes `closed` at index 4 (post-SEV-035 fix).

### ✅ SEV-036 sweep correctness

- `update_protocol_config::new_approved_yield_adapter` — rejects `Pubkey::default()` ✓
- `update_reputation_config::new_passport_network` — rejects `Pubkey::default()` ✓
- `propose_new_treasury` — protected by `Account<TokenAccount>` constraint (Pubkey::default isn't a token account, Anchor rejects) ✓
- `passport_attestation_authority` — FROZEN after init (no setter) ✓

Sweep is comprehensive — all admin-settable Pubkey fields with sentinel value semantics have appropriate guards.

### ✅ is_valid_pool_issuer cryptographic soundness

```rust
let (expected, _) = Pubkey::find_program_address(
    &[SEED_POOL, pool_authority.as_ref(), seed_id_le.as_ref()],
    core_program,
);
expected == *issuer
```

PDA derivation is canonical (uses `find_program_address` not `create_program_address`). A signer cannot spoof another program's PDA because:
1. The seed-derived signer privilege is granted only by Solana runtime via `invoke_signed` from the program that owns the seed schema.
2. `core_program` is read from `cfg.roundfi_core_program` (FROZEN at reputation init).
3. Anchor's `Signer<'info>` constraint already requires signer privilege at the runtime layer.

Defense-in-depth: even if Solana's signer-privilege grant had a bug, the explicit derivation check rejects.

### ✅ init_if_needed paths safe

- `attest::profile` — seeds = `[SEED_PROFILE, subject]`, bootstrap via `profile.wallet == Pubkey::default()` check. Pre-created profile via `init_profile.rs` stores wallet at PDA-bound location; cannot be spoofed cross-wallet.
- `link_passport_identity::identity` — same pattern, seeds = `[SEED_IDENTITY, wallet]`.

### ✅ Propose/cancel/commit triplets independent

- Treasury rotation: `pending_treasury` + `pending_treasury_eta`
- Authority rotation: `pending_authority` + `pending_authority_eta`
- Reputation authority rotation: `pending_authority` + `pending_authority_eta` (in `ReputationConfig`)
- Fee bps yield rotation: `pending_fee_bps_yield` + `pending_fee_bps_yield_eta`

Each pair lives in independent state slots. Multiple proposals can be pending simultaneously without interference.

### ✅ Cycle duration overflow protection

All `next_cycle_at` calculations use `checked_add`. `MIN_CYCLE_DURATION = 86_400` rejects negative or sub-1-day values. Saturation tested in `crates/math/src/escrow_vesting.rs` proptests.

### ✅ Rent / lamport patterns

`close = X` directives in:
- `cancel_pending_listing` → rent to seller_wallet ✓
- `escape_valve_buy` → listing + old_member rent to seller_wallet ✓

No lamport-drain attack surface. Rent always returns to the original payer (or designated wallet, per Solana convention).

---

## Observações Informational (não-findings)

### Obs-A: Canary script offsets are magic numbers without compile-time link to Rust struct

`scripts/mainnet/canary-flow.ts` hardcodes offsets like `OFFSET_PAUSED = 210` and `OFFSET_MAX_POOL_TVL_USDC = 253`. These are correct today (verified manually) but vulnerable to silent drift if a future struct mutation adds a field before one of the read offsets.

**Defense suggestion:** add Rust-side compile-time assertions:
```rust
// In state/config.rs:
#[cfg(test)]
mod offset_pin {
    use super::*;
    use std::mem::offset_of;

    #[test]
    fn pin_offsets_for_canary_script() {
        // These offsets are hand-decoded in
        // scripts/mainnet/canary-flow.ts. If the struct layout
        // changes, the script silently reads garbage. Pin them.
        assert_eq!(offset_of!(ProtocolConfig, authority), 0);  // post-disc
        assert_eq!(offset_of!(ProtocolConfig, paused), 202);   // 210 - 8
        // ... etc
    }
}
```

(Note: `offset_of` is unstable on stable Rust, so this would need a workaround — e.g., construct a fake struct, compute pointer diff. Or document the offsets via const for human auditing.)

**Severity: Informational.** Pre-mainnet, this is operational hardening worth ~30 min of work.

### Obs-B: `fee_bps_cycle_l1/l2/l3` direct mutable but never consumed

The fields exist in `ProtocolConfig` and are updatable via `update_protocol_config` (with `MAX_BPS` cap), but **no on-chain handler reads them**. Searched all instruction files — zero use sites for `fee_bps_cycle_l1/l2/l3` post-write.

This is leftover config surface from a planned-but-not-implemented feature (per-cycle fee charged to members based on reputation level). The whitepaper mentions "2% L1, 1% L2, 0% L3" cycle fees, but the contract doesn't apply them anywhere.

**Severity: Informational.** Either implement the feature OR remove the unused config fields. As-is, an operator might think they're tuning live behavior when they're tuning dead config.

### Obs-C: `guarantee_fund_bps` direct mutable while `fee_bps_yield` has timelock

Asymmetric admin authority surfaces:
- `fee_bps_yield`: requires `propose → 1d timelock → commit` (SEV-024 + follow-up)
- `guarantee_fund_bps`: direct mutable via `update_protocol_config` (no timelock)

Both affect the yield waterfall. `guarantee_fund_bps` controls GF top-up cap (`gf_room = total_protocol_fee_accrued × guarantee_fund_bps / 10_000`). Setting it to 0 would disable GF top-up entirely (next harvests skip step 2 of the waterfall), affecting solvency on next default.

Admin can do this in one tx without public window.

**Severity: Informational** (admin-trust scope) but worth considering: either apply the timelock pattern to `guarantee_fund_bps` for consistency, OR document why it's intentionally different (e.g., "GF tightening is reversible in product semantics; fee changes affect revenue").

### Obs-D: `cycle_duration` has no upper bound

`require!(args.cycle_duration >= MIN_CYCLE_DURATION, ...)` catches negative and below-1-day values. But there's no upper cap. A pool authority could create `cycle_duration = i64::MAX / 2` — pool effectively never advances.

`checked_add(next_cycle_at, cycle_duration)` catches overflow. But pre-overflow, the pool is functionally dead.

**Severity: Informational.** Add `args.cycle_duration <= MAX_CYCLE_DURATION` (e.g., 1 year = 31_536_000) for sanity.

### Obs-E: `msg!` logs as state-change record vs Anchor `emit!` events

Important state transitions (propose/cancel/commit for treasury, authority, rep-auth, fee-bps) emit `msg!` logs only, not Anchor `emit!` events. The indexer's `decoder.ts` parses msg! lines.

`emit!` events would give structured Borsh-encoded log entries with type guarantees (vs. string parsing). For the formal audit firm, this is a nice-to-have hardening: a CHANGELOG OF EVERY ADMIN ACTION in machine-readable form would simplify their analysis.

**Severity: Informational.** Roadmap item — convert critical admin-action logs to `#[event]` types when bandwidth allows.

---

## Status cumulativo

**39 findings disclosed, 35 closed**, 1 upstream-blocked (SEV-012), 3 design-intentional (SEV-018/032/039). **0 open findings.**

Pass 8 yields 0 new severity Low+ findings. 5 Informational observations as roadmap input (Obs-A through Obs-E).

---

## Score Atualizado

| Dimensão | Pass 7 | **Pass 8** | Δ |
|----------|--------|------------|---|
| Arquitetura & Design | 7.5 | **7.5** | sem mudança |
| Qualidade de Código | 8.5 | **8.5** | sem mudança |
| Segurança | 8 | **8** | sem mudança — todos fund-loss vectors closed |
| Performance | 7 | **7** | sem mudança |
| Testes & QA | 8 | **8** | sem mudança |
| DevOps / CI | 7.5 | **7.5** | sem mudança |
| Documentação | 9.5 | **9.5** | sem mudança |
| **Score Final** | **7.8/10** | **7.8/10** | **0** |

Score estável. Os 5 Informational observations não mudam a posição.

---

## Recomendação Final (cumulativa, Pass 1-8)

> ✅ **Protocolo está PRONTO para audit externa formal.** O fluxo de pré-audit interno (W1-W5) fechou 35/39 findings. 8 passes adicionais (das auditorias incrementais) confirmaram que cada fix é correto e que nenhum criou regressão estrutural além das já catalogadas e fechadas (SEV-016 → SEV-029 → SEV-034 chain).

> 📋 **Recomendações para a formal engagement:**
> 1. Engagement scope: 1-2 weeks (per audit-readiness.md PR #352 framing)
> 2. Adversarial validation: external auditor tenta re-abrir 3 random Critical/High SEVs do public tracker
> 3. Deep-dive nas 5 high-leverage areas do audit-readiness.md
> 4. Final attestation against `programs/roundfi-core` + `programs/roundfi-reputation` + `programs/roundfi-yield-kamino`

> 📦 **Backlog opcional pre-mainnet (Informational):**
> - **Obs-A:** Pin ProtocolConfig offsets via compile-time assertions
> - **Obs-B:** Decide: implement cycle fees OR remove the unused config fields
> - **Obs-C:** Decide: apply timelock to `guarantee_fund_bps` OR document the asymmetry
> - **Obs-D:** Add `cycle_duration <= MAX_CYCLE_DURATION` upper bound
> - **Obs-E:** Convert critical admin `msg!` logs to `#[event]` for structured indexer parsing

---

## Notas finais

Esta foi a 8ª passada acumulada. **Não há mais zonas substanciais não-exploradas** nos componentes em-scope (core, reputation, yield-kamino, math crate, SDK encoders, parity tests, canary script). Próximas passadas só rendem retornos marginalmente decrescentes — o externo Adevar audit é o próximo step lógico para adversarial validation com olhos completamente novos.

A equipe está em estado mais limpo que muitas codebases que vi entrarem em audits formais. O internal pre-audit, o tracker público, o single-source-of-truth math crate, os negative regression tests, e a transparência sobre o chain SEV-016 → SEV-029 → SEV-034 demonstram engenharia disciplinada de safety.

---

_Pass 8 fechado em 2026-05-16._
_— Adevar Labs._
