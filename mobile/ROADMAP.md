# RoundFi Mobile — Roadmap

> Companion doc to track where the mobile app is, where it's going, and
> known refactors waiting for input. Lives in `mobile/` so it stays
> with the surface it describes; not part of `FREEZE.md`'s exception
> ledger because the mobile is still in `claude/friendly-carson-50EIx`
> (no `main` merges yet).

## Where we are — current state

**Branch:** `claude/friendly-carson-50EIx`
**Last commit at write time:** `acf6699` (bento overview + Syne typography)

### Phases shipped

| Phase                | Surface                                                                                                                                | Status                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 0 — Scaffold         | Expo SDK 54 (pinned for public Expo Go), npm (decoupled from pnpm workspace), `@roundfi/sdk` via `file:../sdk`                         | ✅ on device                   |
| 1 — Navigation       | Bottom-tabs + ThemeProvider + 4 placeholder screens                                                                                    | ✅ on device                   |
| 2 — On-chain reads   | `listPools` / `fetchPool` / `fetchMembers` / `fetchSolBalance` / `fetchUsdcBalance` / `fetchReputation`, all IDL-free via SDK decoders | ✅ on device                   |
| 2.1 — Pools polish   | Search filter (client-side), Pool detail with Copy/Share pills                                                                         | ✅ on device                   |
| 2.2 — Shared wallet  | `WalletContext` with AsyncStorage persistence; Wallet ↔ Profile auto-sync                                                              | ✅ on device                   |
| 2.3 — Vector icons   | `@expo/vector-icons` Ionicons per tab (replaced default ▼ glyphs)                                                                      | ✅ on device                   |
| 2.4 — Bento overview | Home reshaped as 2x2 KPI grid + horizontal devnet rail; Syne / JetBrains Mono typography unified across all screens                    | ⏳ pending device verification |

### Surface inventory (commit `acf6699`)

```
mobile/
├── App.tsx                              # ThemeProvider → WalletProvider → SafeArea → RootNavigator
├── index.ts                             # Buffer polyfill via require() (hoisting-safe)
├── metro.config.js                      # .js → .ts resolver (NodeNext SDK imports)
├── src/
│   ├── lib/
│   │   └── chain.ts                     # All RPC + aggregateProtocol + formatters
│   ├── navigation/
│   │   ├── RootNavigator.tsx            # Bottom tabs (Home / Pools / Wallet / Profile)
│   │   └── PoolsStack.tsx               # Pools → PoolDetail native-stack
│   ├── screens/
│   │   ├── HomeScreen.tsx               # Bento overview (Hero + KPI 2x2 + devnet rail)
│   │   ├── PoolsScreen.tsx              # Live list + search filter
│   │   ├── PoolDetailScreen.tsx         # Terms / Progress / Vaults / Members + Copy/Share
│   │   ├── WalletScreen.tsx             # SOL + USDC balances (shared address)
│   │   ├── ProfileScreen.tsx            # On-chain reputation (shared address)
│   │   └── PlaceholderScreen.tsx        # Generic fallback (unused after 2.0)
│   ├── state/
│   │   └── WalletContext.tsx            # Shared address + AsyncStorage persistence
│   └── theme/
│       ├── tokens.ts                    # Colors + FONT constants
│       └── ThemeProvider.tsx            # neon ↔ soft palette
```

### Known constraints

- **Expo Go SDK 54** — moving ahead of public Expo Go breaks the QR workflow. See `mobile/AGENTS.md`.
- **npm, not pnpm** — Metro needs flat `node_modules`. See `mobile/AGENTS.md`.
- **WSL networking** — devs on WSL2 need a portproxy from Windows → WSL for the iPhone to reach the Metro server. Not a code problem; documented in the chat history (the `wsl --shutdown` mistake that lost paralel sessions is the canonical "don't do this").

## Next steps — discussed, not yet started

These are the candidates we surfaced during the build. None are
authorized yet; pick when ready.

### Polish-tier (still within Expo Go)

- **Persist palette** — extend `WalletContext`'s AsyncStorage pattern to also store the active palette. ~15 min. Means cold-open restores both wallet AND theme.
- **Global palette toggle** — today only the Home Hero has it. Move to `headerRight` on every tab OR add a Settings tab. ~30 min.
- **Pool detail: deep-linkable** — currently a stack push from the list. Add Expo Linking config so `roundfi://pool/<addr>` opens directly. Useful for the Share button.
- **Activity feed on Home** — bottom row of the desktop `/home` has an `Activity` terminal stream. Mobile equivalent: a vertical list of recent on-chain events. Needs an indexer connection (or websocket subscribe to logs).
- **Empty/error skeletons** — replace `ActivityIndicator` with shimmer placeholders for the bento. Optional polish.

### Capability-tier (requires leaving Expo Go)

These need a **development build** via `eas build --profile development`,
which is a step change (different install flow, longer build cycles,
no more "scan QR from public Expo Go"). Worth doing when there's a
concrete product reason — not just "wallet-connect because we can".

- **Phase 3a — Wallet adapter (read-only)** — connect Phantom mobile via deep link OR Mobile Wallet Adapter (Android-first, iOS support immature). Stores the pubkey; no signing yet. Replaces the manual "paste a wallet" flow.
- **Phase 3b — Sign transactions** — pay installment, contribute, claim payout. Needs Phase 3a + the SDK's `actions.ts` exposed mobile-friendly. **High blast-radius** — this is where the freeze actually applies.
- **Phase 4 — Push notifications** — cycle deadlines, grace warnings, settle events. Needs Expo Push + an indexer-side projector. Useful for the canary launch.

### Visual-tier (toward desktop parity)

Pulled from the desktop `/home` dashboard inventory (commit history):

- **`HomeHero` greeting** — "Bom dia, {firstName}" + 2 CTAs. Requires a `useSession` analog on mobile.
- **`DeskKpi` CountUp animation** — animated number transitions on KPI value changes. ~1 evening of work with `react-native-reanimated`.
- **`TripleShield` card** — the "Stake + Solidarity + Guarantee Fund" visualization. Static layout work.
- **`PassportMini` radial score** — the circular score chart on the right of the desktop bento. Needs `react-native-svg` for the radial.
- **Glass surfaces** — desktop uses `backdropFilter` (CSS only). Mobile equivalent is `expo-blur`'s `<BlurView>`. Adds bundle size; only worth it if we go all-in on the look.

## Pending refactor — reputation (Hybrid + 4 levels)

**Status:** spec received 2026-06-09. Team chose **Hybrid path + 4 levels** on
the same day. Decisions 3-5 still open. **Mobile implementation not yet
authorized** — see `mobile/docs/reputation-v2/06-team-decisions.md` for the
full decision log.

**TL;DR of what changed vs the original v5.2 evaluation:**

- `RawReputationProfile.level: u8` shape stays — mobile does not break.
- `BehavioralEvent` is additive (new account type), no breaking decoder change.
- Score is computed off-chain in the indexer (v1-style weights, provisional).
- L4 Elite is added to the ladder (stakes 50/25/10/3%) — L2 changes from 30 → 25%.
- No `query_score` CPI / FrictionProof / Score Reader Program in the canary.

The full v5.2 "mobile touchpoints" inventory below is **still relevant for the
post-canary refactor**, but the canary-scope mobile delta is much smaller:
just the 4-tier label/color extension.

### The change is much larger than "rename levels"

The spec is a full reputation-system rewrite. Mobile is the **last** layer to
move; we can't start until upstream (programs + SDK + Prisma migration) is in.

| Layer                | Today                                                                                  | v5.2                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Levels               | 3 (L1/L2/L3, stakes 50/30/10%)                                                         | 4 (L1/L2/L3/L4 — Iniciante/Comprovado/Veterano/Elite, stakes 50/25/10/3%)                                                                                                                                               |
| Event categories     | 3 (`PAYMENT_MISSED` / `INFRA_FAILURE` / `VOLUNTARY_EXIT`)                              | 6 deterministic + 5 lifecycle (`PaymentOnTime`, `PaymentEarly`, `FrictionOperational`, `FrictionTemporal`, `LateBehavioral`, `TemporaryIncapacity`, `Default`, `BadFaith`, `CycleComplete`, `PoolComplete`, `Recovery`) |
| Score storage        | Aggregated counters on `ReputationProfile` (`on_time_count`, `late_count`, `defaults`) | Append-only `BehavioralEvent` per cycle (delta_seconds, classification, FrictionProof, sealed_at)                                                                                                                       |
| Score metrics        | Implicit / non-auditable                                                               | 4 pure functions: `reliability()`, `punctuality()`, `commitment()`, `recovery()` with weights in `constants.rs`                                                                                                         |
| FrictionProof        | Doesn't exist                                                                          | 4 on-chain variants (oracle / failed-tx / outage window / governance-attested) with 7d submission window                                                                                                                |
| External consumption | Doesn't exist as CPI                                                                   | `query_score()` permissionless read returning `ScoreSummary { tier, reliability, punctuality, is_stale }`                                                                                                               |

### Mobile touchpoints when v5.2 lands

| File                                                   | Today                                                       | After v5.2                                                                                                                                                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/chain.ts` → `reputationLabel(level)`          | Returns `"L1"`/`"L2"`/`"L3"`                                | Returns `"L1 Iniciante"` … `"L4 Elite"`; level range `1..4`                                                                                                                                                                                                         |
| `src/lib/chain.ts` → `fetchReputation()`               | Decodes `RawReputationProfile` (counter-based)              | Decode the new shape: `BehavioralEvent[]` per wallet + `ReputationMetrics { reliability, punctuality, commitment, recovery }` + `TierAssignment { tier, constants_version, is_stale }`. Probably one fetch returns aggregated view, separate one for event history. |
| `src/screens/ProfileScreen.tsx` → big number           | Single "L1 / score 0" display                               | 4-metric breakdown (reliability % / punctuality % / commitment % / recovery %), tier badge with name, "missing for next tier" line, FrictionProof submission CTA per pending event                                                                                  |
| `src/screens/ProfileScreen.tsx` → fresh wallet default | `level=1, score=0n`                                         | Likely still L1, but the metrics shape is different (all 0s? null? "no data yet"?) — needs decision                                                                                                                                                                 |
| `src/screens/PoolDetailScreen.tsx` → MemberRow         | Shows L1/L2/L3 chip                                         | Show L1..L4 with the right color/name. Maybe also surface reliability % per member.                                                                                                                                                                                 |
| **External**: `sdk/src/onchain-raw.ts`                 | `RawReputationProfile` 113-byte account, level u8, counters | Full schema replacement: `BehavioralEvent`, `ReputationMetrics`, `TierAssignment` PDAs; legacy `RawReputationProfile` deprecated.                                                                                                                                   |

### New surfaces v5.2 enables (mobile-relevant)

- **Behavioral log screen** — visually show the user the append-only stream of events that compose their score. Each row: cycle, classification, delta_seconds, FrictionProof status. **High value for trust** — "you can see exactly what's in your record."
- **FrictionProof submission flow** — if an event was classified `LateBehavioral` because of a network outage, surface a CTA to attach proof (`FailedTransaction` tx hash, oracle slot, etc.) within the 7-day window. **Requires Phase 3b (signing) to actually submit.**
- **"Next tier" coach** — given the resolve_tier function is pure, mobile can render exactly which thresholds are missing (e.g. "need 2 more completed pools + reliability ≥85 for Veterano").
- **`query_score` consumer preview** — show the user what a B2B partner would see when calling `query_score(wallet)`. Makes the "verifiable history" pitch tangible.

### Pre-emptive checklist (before any mobile work starts)

Upstream — out of mobile's hands:

- [ ] Team has resolved the 5 decisions in `docs/reputation-v2/05-decisoes-pendentes.md`
- [ ] Spec's 3 blocking bugs fixed (reliability arithmetic, punctuality compile, ORACLE_WHITELIST defined)
- [ ] Risk Review's regulatory pieces have a path (BCB / LGPD / ROSCA classification)
- [ ] `architecture.md` PR landed with the chosen decisions
- [ ] `programs/roundfi-reputation` upgraded or redeployed
- [ ] `sdk/src/onchain-raw.ts` updated to decode the new accounts
- [ ] Prisma migration `MissReason → EventClassification` applied
- [ ] `services/orchestrator` (crank) sequences `settle_default → record_event` atomically

Mobile-side (when authorized):

- [ ] `chain.ts` updated to fetch the new shape (probably new functions, keep old ones during transition)
- [ ] `tokens.ts` gets per-tier colors / labels (L1..L4)
- [ ] `ProfileScreen.tsx` rebuilt around 4-metric breakdown + missing requirements
- [ ] `PoolDetailScreen.tsx` MemberRow updated for 4-tier display
- [ ] (Optional) Behavioral log screen scaffolded
- [ ] (Optional) FrictionProof submission flow — depends on Phase 3b
- [ ] (Optional) `query_score` preview surface
- [ ] Migration UX: existing devnet wallets with old `RawReputationProfile` need a fallback render until they're migrated

### Risk-review summary (read before deciding scope)

The Risk Review (`04-revisao-de-risco.md`) is direct: **implementing v5.2
without real users is "optimizing the second problem before the first is
solved."** The Decisões Pendentes doc proposes a docs-only first PR amending
`architecture.md` before any Rust. Both align — the mobile layer should
follow that order, not get ahead of it.

What this means for the mobile branch (`claude/friendly-carson-50EIx`):

- **No code changes here on v5.2 grounds until upstream is decided.** The
  current mobile shape (`L1/L2/L3`, counter-based) keeps working against
  the current `roundfi-reputation` program.
- **The doc package is the contribution for now.** When the team picks a
  decision path, the touchpoint inventory above tells us exactly where mobile
  diverges, and we can stage a `claude/mobile-reputation-v52` branch from
  this one without losing the existing surface.

### Touchpoints

| File                                                            | What it does today                                                                                 | What likely changes                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/chain.ts` → `reputationLabel(level: number)`           | Returns `"L1"` / `"L2"` / `"L3"` for `1..3`, `"L?(n)"` otherwise                                   | Label scheme + range; may become more than 3 levels, may carry sub-tiers                                                                      |
| `src/screens/ProfileScreen.tsx` → `ProfileCards`                | Renders `reputationLabel(p?.level ?? 1)` as the big display number + `(p?.score ?? 0n)` next to it | Default for missing profile (`?? 1`) — may not be "L1" anymore in the new model. Score formula / scale may change.                            |
| `src/screens/PoolDetailScreen.tsx` → `MemberRow`                | Calls `reputationLabel(member.reputationLevel)` for the per-member L1/L2/L3 chip                   | Same label rename + possibly a different visual treatment (badge color per level?)                                                            |
| **External**: `sdk/src/onchain-raw.ts` → `RawReputationProfile` | The decoded shape. Type changes here propagate to mobile via `file:../sdk`.                        | If the on-chain account adds fields (sub-tier, multipliers, attestation history), the decoder gains them and mobile may want to surface them. |

### Pre-emptive checklist (before applying the new model)

- [ ] Confirm the new label set — strings like `"L1"`..`"L3"` or something different (e.g. `"Bronze"`/`"Silver"`/`"Gold"`, named tiers, or no caps)
- [ ] Confirm the "fresh wallet default" — today: level=1, score=0n. The doc may redefine what an uninitialized profile means.
- [ ] Confirm score scale — today: `bigint`, rendered as `.toString()`. May become a normalized 0-1000 range, a percentile, or a multi-component score.
- [ ] Confirm per-level visual treatment — color, icon, badge style. Today everything is `tokens.green` regardless of level.
- [ ] Confirm if member-row badges should also change (Pool detail roster).
- [ ] Check SDK breaking changes — if `RawReputationProfile` gains fields, `fetchReputation()` in `chain.ts` needs no change (still returns the shape), but the screens that consume it do.
- [ ] Backwards compatibility — on-chain accounts written under the old model still exist on devnet. Decoder must handle both, OR we wipe devnet, OR there's a migration path.

### When you bring the documents

- Drop them into `mobile/docs/reputation-v2/` (creating that folder is fine)
- Reference them in this section
- Open a fresh branch off `claude/friendly-carson-50EIx` so the audit trail of the migration is isolated
- This section will get a "DONE → see PR #N" line when the work lands

## Audit-trail conventions

- All mobile commits live on `claude/friendly-carson-50EIx`. No PR to `main` is open — intentional while the freeze decision is pending.
- Each phase ships as a single commit; multi-commit work fixes the previous commit (rare).
- AGENTS.md is the constraint contract (SDK 54, npm, no pnpm). This roadmap is the **work** contract.
