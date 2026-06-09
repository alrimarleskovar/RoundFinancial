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

## Pending refactor — reputation levels

**Status:** awaiting input from the user.
**Context (user's message, 2026-06-09):** _"teremos uma mudança nos levels de como esta implementado hoje para um melhor e mais auditavel"_ — they're bringing documents to specify the new model.

The current mobile surface assumes the legacy L1/L2/L3 shape exposed
by `@roundfi/sdk/onchain-raw`'s `RawReputationProfile.level: number`.
When the new spec lands, the following call sites need attention.

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
