# 03 · PR Log — every shipped change in order

Concrete velocity evidence. 37 PRs merged into `main`, every one through the same Claude Code session running on top of `solana.new`. Listed in chronological order with the actual title (verifiable on GitHub).

| # | Title | Theme |
|---|---|---|
| 1 | feat: RoundFi Desktop front-end + repo cleanup | Caminho A · prototype import |
| 2 | feat(prototype): Phantom + devnet faucet integration | Caminho A · real wallet |
| 3 | feat(app): B.1 — Next.js migration shell (theme + i18n + wallet + brand) | Caminho B · foundation |
| 4 | feat(app): B.2.a — Carteira shell + Visão geral tab (native Next.js) | Caminho B · carteira |
| 5 | chore(prototype): drop the macOS ChromeWindow simulation | UX cleanup |
| 6 | feat(app): B.2.b+c — Carteira Posições + Transações tabs | Caminho B · carteira |
| 7 | feat(app): B.2.d — Carteira Conexões tab (Phantom real + mocks) | Caminho B · carteira |
| 8 | feat(app): B.3.a — Home hero + KPIs + featured round + Seus grupos | Caminho B · home |
| 9 | feat(app): B.3.b — Home right column (Passport / Shield / Activity) | Caminho B · home |
| 10 | feat(app): B.4 — Grupos catalog with multi-facet filters | Caminho B · catalog |
| 11 | feat(app): B.5.a — Reputação (SAS passport + levels + bonds) | Caminho B · reputation |
| 12 | feat(app): public landing page on / with wallet-gated dashboard redirect | Landing v1 |
| 13 | chore(landing): sticky header with blurred backdrop | Landing polish |
| 14 | fix(app): redirect to landing on wallet disconnect | Wallet UX bug |
| 15 | feat(app): B.5.b — Mercado secundário | Caminho B · market |
| 16 | docs: refresh README to match the merged front-end | Docs sync |
| 17 | fix(faucet): always expose the hosted Solana faucet + log raw error | Devnet UX |
| 18 | fix(wallet): swallow balance fetch failures silently | Devnet UX |
| 19 | feat(app): B.5.c — Insights (score evolution + factors + next steps) | Caminho B · insights |
| 20 | feat(app): Round 1 — favicon + dev-only tweaks panel | Polish — Round 1 |
| 21 | feat(app): Round 2 — page transitions with selectable mode | Polish — Round 2 |
| 22 | fix(landing): unbreak the sticky header | CSS bug fix |
| 23 | feat(app): Round 3 — functional modals (Entrar / Pagar / Vender) | Interactive · modals |
| 24 | feat(theme): Phase 1 — neon default + terminal sidebar + network pulse + wallet glow | Aesthetic · phase 1 |
| 25 | feat(theme): Phase 2 — glassmorphism on every dashboard surface | Aesthetic · phase 2 |
| 26 | feat(theme): Phase 3 — animated counters + terminal Activity feed | Aesthetic · phase 3 |
| 27 | feat(theme): Phase 4 — Bento grid + radial Score ring | Aesthetic · phase 4 |
| 28 | feat(orchestrator): Round 4 — live SessionProvider drives balance / score / Activity | Live state |
| 29 | feat(landing): re-skin to Neon palette + glass + amplified X CTA | Landing · neon |
| 30 | feat(landing): full PT/EN i18n + restore "Siga nosso X" label | Landing · i18n |
| 31 | feat(landing): use in-code SVG logo (transparent, kills white halo) | Brand vector |
| 32 | feat(brand): vectorize the favicon (icon.png → icon.svg) | Brand vector |
| 33 | feat(landing): pulsing glows on CTAs + flowing title gradient | Landing · life |
| 34 | feat(landing): wrapper-driven button glow + data-stream behind hero | Landing · life |
| 35 | docs: refresh README with the post-B aesthetic + interactive layer | Docs sync |
| 36 | fix(landing): simulator Select Wallet renders as a long bar | CSS bug fix |
| 37 | feat(landing): center simulator CTA + life on the comparison table | Landing polish |

**38 (this bundle)** — `docs(grant): Superteam Agentic Engineering response files` — the deliverable you're reading.

## How to read this list

- **Every line is a real merged PR** with a structured body — open any one to see plan / commits / test plan / out-of-scope.
- **Themes group naturally** — `Caminho A` (port the design), `Caminho B` (rebuild as Next.js), `Polish/Aesthetic Phases` (visual upscale), `Landing` (public face).
- **Bug fixes share equal billing with features** — the discipline doesn't bend just because something's a one-line CSS patch.

## A note on cadence

37 PRs over the course of the project's active lifetime. Not every day, not every week — bursts of agentic sessions where the loop runs cleanly. The point isn't "37 in a fixed time window"; it's that **every single one is shippable**, scoped, and reviewable.

For comparison: traditional solo dev cadence on a side project often has either (a) one giant PR every two weeks that nobody can review, or (b) 200 messy commits to main. This is neither.

---

Next: [`04_GRANT_USE.md`](./04_GRANT_USE.md) — what the $200 actually buys.
