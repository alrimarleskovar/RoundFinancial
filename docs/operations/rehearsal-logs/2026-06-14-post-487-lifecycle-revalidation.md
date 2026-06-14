# Post-#487 lifecycle re-validation on devnet (2026-06-14)

**Context.** The Agave 3.x / anchor 1.0 / mpl-core 0.12 migration (#487) was
deployed to devnet via an **in-place upgrade** (same program IDs, v5.2 state
preserved). This log records the on-chain re-exercise of the protocol's
instruction surface against the **migrated bytecode** — proving it runs
end-to-end post-migration, not just in CI (litesvm/bankrun) and not just
`join_pool`.

Run by the operator on WSL, **zero faucet** — low-budget geometry
(`MEMBERS_TARGET=2`, `CYCLES_TOTAL=2`, `credit=4`, `installment=3`) funded from
the deployer's carry-over balance, recycled via the rent-reclaim + vault drain.
No client changes were needed for any instruction: the IDL-free encoders
matched the migrated programs byte-for-byte.

**Programs (unchanged by the in-place upgrade):**

| Program              | ID                                             |
| -------------------- | ---------------------------------------------- |
| roundfi-core         | `8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw` |
| roundfi-reputation   | `Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2` |
| roundfi-yield-mock   | `GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ` |
| roundfi-yield-kamino | `74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb` |

## 15 instructions confirmed on-chain

### Pool 50 — happy ROSCA: `Forming → Active → Completed → Closed → reclaimed`

PDA `4R2FrGdbCdceskUxa3zHJsXWB3NKayW8WABYh93nJEo1` · members `member-0/1` (reused)

| Instruction          | Signature                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `create_pool`        | `3T1pXTo8HFvo1E4Cwb2THDYMRzbuay87yLyQDjidrFve7QEctrcRJpo7ZmqFC4L7H21BAx7oaU5bNh6xYS6WAhUt` |
| `init_pool_vaults`   | `5yVpwSVQzfaajvKY7jsKUTBMcr6FQvYXqanYgYmoKf3iPbbHcxGadNemgzvmUg2ioRWiFsp6HpRea3ra6pBZFnb`  |
| `join_pool` (slot 0) | `3WQuxpxFd2yzimbtAcaw7jPvQDh7aRRZJV5RgQ2dZBREqtwn2Gufk4HcoASqN89gR1LteCtTTdLKXmut2rAkWo9n` |
| `join_pool` (slot 1) | `7t56HCLKACoSFi4nLJzM237VBdofh8WmeVHWdBDodxc8g5R7L6Ds9bjv3WxANH8BsMw6xFcz8MEYCh8X4pnhu7e`  |
| `contribute` (c0 s0) | `4odSUfhGKifrsEJz4SqSJMVPrNc7xbDRKSjvxTWVuBmLhsy5nVUjPSmFVoEbvK2fEuwcH2yZ6ce7qDuZp6jUbpZf` |
| `contribute` (c0 s1) | `2e9AnUDiRe2H9615tb8ii1i8jsXhPxPyEi3Uye9ibRy8UkpQZE7kvM1wZRw3B1FKpMV8yGe6Pvry8aofEpyRHRsQ` |
| `claim_payout(0)`    | `21M1EhPdRpK6VnRpTvHkBrcv9YbyD2jYttVPUta6CKszSt3sxCezAyH8uQZoXSKDNjuEeQVxyCuPkRghvTcbuyET` |
| `claim_payout(1)`    | `KTkXqVYruXeFqx4mna4atfAR33aUnyBE8RzZgQBTaktxwYN7nZJi2h6fhUd8Y52YTqYYTCVM96wz11ckNHSDReF`  |
| `close_pool`         | `5Fa2e3dGNdkCrDQVqLfUUB1WGsb2sy4bqTsc1iRADfLcXCZyVgrwZbKnkvdTLwmx2XSJ16fHsTpjTZj4gBXB6UA4` |
| `close_member` (s0)  | `3QDEqVHvGAmDd7F4je5FznGbKVTWEvNNg7i64SYVoKY4cKW8KnMSsBttAaFDdyaoxV3HgwoBrUxsjvysSLffCPba` |
| `close_member` (s1)  | `3zXtRdvvmhrUFhU2CFPUH8M3yMU7v3eApWhffZkjGykVqWucskUuMhVUiH9ah2ng8TU4Bn2cw8F3aSnhPvGUtKQ1` |
| `close_pool_vaults`  | `4GhmDBDdX7Nn5jn73qqoH5hamm3zNLb2smrJ2xZSgFooGVfYBTSBLyZomQT2Pz2nmnDMDKjrdXf5PYmV9JVtwNHS` |

Net SOL flowed **back** to the operator (`18.1177 → 18.1285`, +0.0108 after
fees) — the SEV-039 rent-reclaim ceremony closing the lifecycle.

### Pool 51 — Active: yield cascade + escape valve + escrow release + commit-reveal

PDA `FUkHoxHdrCxHJXzBGJpzniunSAurBzoJrEKYME4Siy58` · members `member-20/21` (fresh)

| Instruction                     | Signature                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `create_pool`                   | `2BMRdRB5K1RpkHyrPDJ1aN8EdpgSjM2AGz3wTm3pvLZBpLwPTvKwBuZqaMBmSR8ZExFyAMLcqpJatBTppbXEzrtX` |
| `init_pool_vaults`              | `3u2iVJpxYhXDSLdYxFtrxphsUcAHmWhvfofrEaKiAgWueFsT8ZaPBjxZZhWCZoAK1buMBZuPPxPLFgTSnLUYEnxd` |
| `join_pool` (slot 0)            | `3owk4JEVsUsG7dAhfHCjGWREAGFKkVRji6fKmksZXSbPStH4E4Qy1jRtEJP27JbASRrGozryArkicwqVPMrmu4Tz` |
| `join_pool` (slot 1)            | `4uGAvMExPVufyXwZZgMP4UZ1jRqmG56aUvghJBK4eVQMqz1NbERyx8rcnhzKDidBhRwFJ2EDTAR4i9BDETFESu2A` |
| `contribute` (c0 s0)            | `XJak7vCAMgxioCU4SGE9AfwBtCWGE5fkKPDmyeRJjq8XVMQsJMsVmSR4pThkvLJcaH5HLz4gPXUk2S9qBDPfeCE`  |
| `contribute` (c0 s1)            | `5kP4ADB35Rxun72gWqmE2pUEUjAEdjkHJsyUSy5Ki53ZFzuz7xx1ZwpASWZMY2L3ZHgsrvf4bXgsrb3QrrZ4DWPa` |
| `deposit_idle_to_yield(4)`      | `5WHohJKo1Rb5JzDxEACS3sRHWJ8DLBVHhTpGyEGjWnmzYTt2UqB3RUJ1P8dVe6Ftnef3taGg8HmiZbmHGCoZXemj` |
| `harvest_yield`                 | `buz2pB2mQQEsFtUBsyRZA1V5yi4Ls1NcKP1PbE9oTmW2v2AnXRNh9MeirrYnWVQpYwuSJtnSzA8P5e9XQJknkXX`  |
| `escape_valve_list` (s1)        | `xN6wZLWs5Vda8qqaR6233imuewSkZ6rVVYQdRkKC2AFG1ZJrnzA22bNt5o3KqrSxMVyuqUUgcmoQae118LWiTLv`  |
| `escape_valve_buy` (s1)         | `qcZbpFxpnoZJwqLZBZghGJJL2T3Q57f91L5Xa9GjMkoSMjVvgFQvsQ7GUSAy3pfLmCANU3R4ndtD1cuAodqjBM1`  |
| `release_escrow(1)` (s0)        | `33qRRWqw67KP1s51coDYMbsFVg1MjkyRt67kNc1rGSJoD596ayzBmyA3wkuQy5bqSes5m4qz7pZzAtRGWDfsAAzB` |
| `escape_valve_list_commit` (s0) | `5vZ9D1FBGS9P4rz2dq6GUcscmWvhraDAtXV3BDsL8eSBSbToXHuxhenHt4QDWSkzE5sQ1yCfZGNd4brxnpdBQ3yH` |
| `escape_valve_list_reveal` (s0) | `4K3W8GbNqhByzZ6eRJwuhWRk1cb5SuwZqsP272AQAt8bEMfXyp9TjyqH4jMRpAbre5G89WCYmNohn7cFo2G2p2pu` |
| `escape_valve_buy` (s0, c-r)    | `3WDVHdQo4VwhXZ4gHmQyCaEDTj9cYLkKAG3kZS1disfsn3d34stkEWx5FF7oKaxRm1wn7iNnsLBdVFZUsQz3BNES` |

Highlights on the migrated bytecode:

- **Yield waterfall** realized 0.50 USDC: protocol fee 0.10 → treasury, residual
  +0.40 → `pool_usdc_vault`; the slippage floor (`min_realized=0.495`, tol 100bps)
  held against the live on-chain surplus.
- **`escape_valve_buy`** carried the seller's Member-PDA snapshot to the buyer +
  thawed → transferred → re-froze the position NFT (3 mpl-core CPIs) atomically.
- **Commit-reveal anti-MEV**: `commit` stored only `SHA-256(price ‖ salt)` (price
  `0` on-chain); `reveal` matched the hash byte-for-byte and armed
  `buyable_after = now + 30s`; the buy succeeded only past that window (inside it
  reverts `ListingNotBuyableYet`).

## `settle_default` — armed, grace-gated (run after the window)

Pool 45 `Hg9AkTCgNRNbVZqtZrHZpQbCuFeJnxDxhrJjUcW5TjZ9` is armed: slot 2
(`member-22`) never contributed → `contributions_paid = 0 < current_cycle = 1`
(behind). `settle_default` needs `now ≥ next_cycle_at + GRACE_PERIOD_SECS`; with
`next_cycle_at` at 2026-06-14 22:27 UTC, the window opens **2026-06-15 22:27 UTC**
(canary, GRACE=1d) or **2026-06-21 22:27 UTC** (7-day build). Replay:

```bash
export POOL_SEED_ID=45 MEMBER_INDEX_OFFSET=20
GRACE_PERIOD_SECS=86400 DEFAULT_SLOT_INDEX=2 pnpm devnet:seed-default
```

`settle_default` is independently covered by the `litesvm`/`bankrun` CI lanes
(clock-warp past the grace window) on the migrated bytecode.

## Note — reputation cooldown (not a migration regression)

Pool 50's cycle-1 `POOL_COMPLETE` attestation reverted `CooldownActive (6004)` —
the SEV-047 anti-farming gate firing on **reused** wallets (`member-0/1` carry
prior-pool schema-4 attestations). Pool 51 used **fresh** wallets
(`MEMBER_INDEX_OFFSET=20`) and the attestations landed clean. Core fund-movement
instructions were unaffected (the cycle-0 contributions + both claims landed).

## Verdict

The **#487-migrated bytecode runs the full RoundFi protocol on-chain on devnet**
— 13 core + 2 anti-MEV instructions confirmed (15 total), with `settle_default`
armed and CI-proven. Combined with the green CI lanes and the in-place upgrade
that preserved v5.2 state, the Agave 3.x / anchor 1.0 / mpl-core 0.12 migration
is validated end-to-end.
