# RoundFi — Front-End Security Checklist

> **Scope:** the Next.js app at `app/` — Wallet Adapter, RPC trust, transaction signing, phishing-resistance, devnet/mainnet confusion. **Explicitly out of scope of the on-chain audit** ([`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md) §"Out of scope") — this is a separate UX-security pass.
>
> **Why this doc exists:** the audit firm covers Rust + on-chain trust path. They do **not** sign transactions on behalf of users. A user can have all 8,341 LoC of on-chain code formally verified and still lose funds to a phishing site, a hijacked RPC, or a confused network switch. This is the checklist for that surface.

**Today's posture:** devnet only · `NetworkId = "localnet" | "devnet"` · single deployer key on programs · Phantom/Solflare/Backpack via standard-wallet auto-discovery · `autoConnect: true` · public Solana RPC (`clusterApiUrl("devnet")`).

**Mainnet GA dependency:** Cross-referenced from [`MAINNET_READINESS.md`](../../MAINNET_READINESS.md) §5 (off-chain surfaces). Hard gates marked ⛔.

---

## 1. Threat model

A user's loss surface on the RoundFi front-end:

| #   | Threat                                                   | Vector                                                                                                                             | Impact (mainnet)                                                |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| T1  | **Phishing site spoofs roundfi.app**                     | typo-squat domain serves identical-looking UI, asks user to sign `contribute` to attacker-controlled vault                         | Drain installment amount per signed tx                          |
| T2  | **Compromised RPC endpoint returns false state**         | hostile RPC says pool is "Active" when it's Closed; user signs `contribute` after cycle ended; tx still succeeds, funds locked     | User contribution lost (no refund mechanism)                    |
| T3  | **Devnet/mainnet confusion**                             | user signs mainnet tx thinking they're on devnet (or vice versa); real USDC moves on a test action                                 | Real funds drained at "test" UX                                 |
| T4  | **Wallet drainer hijacks `release_escrow` flow**         | malicious dApp prompts `setAuthority` or `Transfer` instead of `release_escrow`; user clicks through without reading               | Entire escrow vault drained for that pool                       |
| T5  | **Transaction-simulation tampering**                     | front-end displays "you will pay $50 USDC" but signs an ix that pays $5000                                                         | Slippage exploit; user signs wrong amount                       |
| T6  | **Connected wallet, idle session**                       | user walks away with `autoConnect: true`; attacker on the same machine signs a tx                                                  | Loss bounded to balance held in the connected wallet            |
| T7  | **Position NFT social engineering**                      | attacker convinces user to `escape_valve_list` their slot at attacker-favorable price; user thinks they're "transferring" the slot | Slot sold below market; reputation forfeit if pool is mid-cycle |
| T8  | **Claim race / front-running**                           | bot watches mempool for user's `claim_payout`, front-runs `escape_valve_buy` of a soon-to-be-paid slot                             | Out of scope for this doc — see `mev-front-running.md`          |
| T9  | **Indexer / read-path tampering**                        | front-end reads pool state from indexer (not chain); compromised indexer shows fake reputation score                               | Out of scope for this doc — see `indexer-threat-model.md`       |
| T10 | **Browser extension hijack (clipboard, page injection)** | malicious browser ext rewrites destination wallet on copy-paste, or injects fake "approve" prompt                                  | Funds sent to attacker address                                  |

The on-chain audit covers nothing in this table directly. It covers what the program does **after** a user signs — not what the front-end asks them to sign.

---

## 2. Hard mainnet blockers (⛔)

These **must** be true before any tx involving real USDC on mainnet.

### 2.1 Mainnet visual identification (T3)

- ⛔ `NetworkId` type extended to include `"mainnet-beta"` (today: `"localnet" | "devnet"` at [`app/src/lib/network.tsx:6`](../../app/src/lib/network.tsx))
- ⛔ **Persistent banner** at top of every page when on mainnet: red border, "MAINNET — REAL FUNDS" label, distinct from devnet (which should also be labeled, in a different color, but not as alarming)
- ⛔ **Wallet chip** shows `MAINNET` / `DEVNET` badge inline with address
- ⛔ **Every transactional modal** (PayInstallment, ClaimPayout, JoinPool, BuyOffer, SellPosition, ReleaseEscrow) displays current network in the confirm CTA: "Confirm (MAINNET)" vs "Confirm (DEVNET)"
- ⛔ **No silent network switch** — switching from devnet → mainnet must require an explicit re-connect of the wallet, not just dropdown toggle

### 2.2 RPC trust (T2)

- ⛔ **Mainnet endpoint is NOT public** — use Helius, Triton, or QuickNode with API key. Public RPC (`clusterApiUrl("mainnet-beta")`) is **rate-limited and unsafe** for production reads.
- ⛔ **Endpoint allow-list** in app config — user cannot point the app at an arbitrary endpoint via URL param or local storage.
- ⛔ **Read-write split** — reads can use a faster endpoint; writes (signed tx submission) go through a hardened endpoint with the user's wallet.
- ⛔ **Tx simulation pre-sign** — every transaction is `connection.simulateTransaction()` before showing the confirm modal. Failed simulation → block the user from signing.

### 2.3 Domain integrity (T1)

- ⛔ Production domain pinned in `next.config.js` `headers.Content-Security-Policy` (CSP)
- ⛔ `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- ⛔ DNSSEC + CAA records on the domain
- ⛔ App listed on Phantom / Solflare / Backpack dApp directories (so wallet shows "Verified" badge)
- ⛔ Subresource integrity (SRI) hashes on any external script (today: none used; verify no regressions)

### 2.4 Transaction confirmation pattern (T4, T5, T10)

- ⛔ **Tx preview modal** before wallet prompt, showing:
  - Instruction names (e.g., "contribute" not just "transfer USDC")
  - Net USDC flow ("You pay 50.00 USDC to Pool 'Pedreiros · 6-membros'")
  - Net SOL fee (rent + tx fee)
  - Counterparty: program ID + pool seed
- ⛔ **No blind-sign flow** — if the connected wallet doesn't support transaction simulation display, fall back to manual confirmation step
- ⛔ **Amount entry sanity check** — users typing `5000` when they meant `50.00` get a confirm step ("⚠ This is 100× your typical installment. Confirm?")
- ⛔ **Receive-vs-send mismatch warning** — if a `claim_payout` somehow has a non-zero outgoing amount, block the sign

### 2.5 Wallet adapter hardening (T6)

- ⛔ `autoConnect: false` on mainnet — user must explicitly connect each session (today: `autoConnect: true` at [`app/src/components/ClientProviders.tsx:25`](../../app/src/components/ClientProviders.tsx))
- ⛔ **Session idle timeout** — after 15 min idle on mainnet, prompt to re-confirm before any signed tx
- ⛔ **Tab close = disconnect** — on `beforeunload`, call `adapter.disconnect()` (mainnet only)

---

## 3. Recommended hardening (post-canary, pre-GA)

These improve posture but don't block canary smoke.

### 3.1 Hardware wallet path

- 🔵 Ledger / Trezor explicit support in the connect modal (today: works via standard-wallet adapter but no UX promotion)
- 🔵 Hardware-wallet-required toggle for high-value flows (≥$1k positions, treasury rotation viewing)

### 3.2 Phishing-resistant onboarding

- 🔵 **First-visit checklist** — "verify URL is roundfi.app", "verify Phantom shows roundfi.app as the connecting site", "never sign if address differs from your saved address"
- 🔵 **Bookmark prompt** on first connect (browsers can suggest, e.g., "Add bookmark" CTA inline with the wallet connect step)
- 🔵 **Saved address book** — when user pays an installment, remember the pool's USDC vault address; warn if a later tx targets a different address for "the same pool"

### 3.3 Defensive read patterns

- 🔵 **Dual-source reads** for high-stakes data (your balance, your slot, your level) — read from indexer (fast) but cross-check against on-chain (slow) before allowing a write. Mismatch → block + warn.
- 🔵 **Stale-data warning** — if indexer last-block-seen is more than 60 seconds behind RPC, banner "data may be stale; refresh"
- 🔵 **Pool freeze detection** — if pool is paused or closed on-chain but indexer hasn't caught up, block contributions client-side

### 3.4 Operational

- 🔵 **CSP report-only header** in production — collect violations for 30 days, then promote to enforcing
- 🔵 **Sentry / error monitoring** — surface unhandled signing errors, RPC timeouts, wallet adapter mismatches with PII scrubbing
- 🔵 **`/security` page** publicly describing this posture so users (and security researchers) can verify

---

## 4. Already shipped (counts toward posture)

| Item                                               | Where                                       | Notes                                                           |
| -------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| Network-aware Solana Explorer links                | `app/src/lib/wallet.tsx:166-173`            | `explorerTx` / `explorerAddr` use `cluster` param               |
| Network context separated from wallet adapter      | `app/src/lib/network.tsx`                   | Endpoint changes flow through React context; balance re-fetches |
| Standard-wallet auto-discovery                     | `app/src/components/ClientProviders.tsx:22` | No hardcoded wallet list — picks up any standard-spec wallet    |
| Devnet-only program IDs + USDC mint pinned in code | `app/src/lib/devnet.ts:13-22`               | Constants, not env-driven (no runtime injection vector)         |
| Confirm-modal loading states                       | All transactional modals (#151)             | Submit disabled + "Processando…" during 900–1500ms confirm      |
| Toast feedback on every signed action              | `sonner` + `session.tsx` `useEffect` (#150) | User sees confirmation of what just happened                    |
| Demo Studio badges                                 | `/admin` route                              | Visual indicator when in mock / demo mode (NOT same as devnet)  |
| Disconnect-redirect for protected routes           | `app/src/lib/useRedirectOnDisconnect.tsx`   | Routes gated by wallet connect kick to landing on disconnect    |

---

## 5. What this doc does **not** cover

- **On-chain trust path** — covered by the external audit + [`docs/security/self-audit.md`](./self-audit.md)
- **MEV / front-running of legit transactions** — covered by [`mev-front-running.md`](./mev-front-running.md) (planned)
- **Indexer reliability under reorg / replay** — covered by [`indexer-threat-model.md`](./indexer-threat-model.md) (planned)
- **Adversarial scenarios at the protocol level** (Sybil, ordering games) — covered by [`adversarial-threat-model.md`](./adversarial-threat-model.md)

## 6. Verification checklist for canary smoke

Before turning on mainnet canary, walk through this list with a fresh wallet that has never seen the app:

- [ ] Visit production URL; verify Phantom shows roundfi.app domain
- [ ] Wallet chip displays MAINNET badge in distinct color
- [ ] Top banner is visible without scrolling on home, grupos, carteira, mercado, reputacao
- [ ] Connect wallet → consent prompt is explicit ("Connect to roundfi.app on MAINNET")
- [ ] Try to sign `contribute` → wallet shows the program ID and the USDC amount
- [ ] Try to sign with an inflated amount (`5000` instead of `50`) → app shows warning
- [ ] Try to sign with the wallet on devnet but the app on mainnet → app blocks with clear error
- [ ] Disconnect → connected state clears immediately, balance hidden
- [ ] Idle 15 min while connected → next signed action requires re-confirm
- [ ] Refresh page → no autoConnect on mainnet
- [ ] Right-click "View page source" → no exposed RPC API keys, no hardcoded private keys, no secrets

If any checkbox fails, the canary launch is **blocked**.

---

_Last updated: May 2026. Cross-ref: [`MAINNET_READINESS.md`](../../MAINNET_READINESS.md) §5.3, [`SECURITY.md`](../../SECURITY.md), [`docs/security/self-audit.md`](./self-audit.md) §7._
