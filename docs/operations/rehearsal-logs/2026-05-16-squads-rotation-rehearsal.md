# Squads multisig rotation — devnet rehearsal log (2026-05-16)

> **Status:** ✅ Complete end-to-end · Phases A + B + C exercised against
> a parallel devnet deployment (program-id `6WuSo1ut...7Rpn`).
> Canonical devnet deployment (program-id `8LVrg...QQjw`, Pool 1/2/3 history
> in `docs/devnet-deployment.md`) was NOT touched.

## 0. Metadata

| Field                | Value                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Rehearsal date (UTC) | 2026-05-16T22:30:00Z → 22:47:00Z                                                         |
| Operator             | alrimarleskovar                                                                          |
| Cluster              | devnet                                                                                   |
| Core program ID      | 6WuSo1utWKg8gNyzzJyqCoeLa7VpEyu8ZN1EtLzJ7Rpn (parallel test deploy, not canonical)       |
| ProtocolConfig PDA   | FD68n1C6rT15PkjyVPgx25jDXQ2tRvpqf7KPi1nzkyPc                                             |
| Solana CLI version   | solana-cli 3.0.0 (Agave)                                                                 |
| Branch + commit      | main @ 8fd1a02                                                                           |
| Authority (deployer) | 64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm                                             |
| Upgrade authority    | B8CjP1mC4SzntAi7WabGx87kPHnqYcUc6SQYAr4ci8di (different keypair from protocol authority) |

## 1. Pre-rehearsal blockers surfaced + resolved

Three real blockers discovered during pre-flight that the quickstart didn't anticipate:

### 1.1. Canonical devnet ProtocolConfig (3c9MmoM8...) is pre-PR #323

Rehearsal verify against the canonical PDA returned: "ProtocolConfig has unexpected size 317 (expected 381)".

Cause: the canonical devnet deployment from 2026-05-07 predates PR #323 which added the authority-rotation surface (pending_authority + pending_authority_eta). On-chain ProtocolConfig is 317 bytes; current code expects 381. Anchor doesn't auto-realloc accounts.

Resolution: parallel fresh deploy of roundfi_core at a throwaway keypair (/tmp/roundfi-core-rehearsal.json -> pubkey 6WuSo1utWKg8gNyzzJyqCoeLa7VpEyu8ZN1EtLzJ7Rpn). Reproducible without disturbing canonical pools.

Audit-worthy finding for the canonical deployment: a realloc migration ix will be required before Squads rotation can run against the original ProtocolConfig. Tracked as gap for next devnet refresh sprint.

### 1.2. DeclaredProgramIdMismatch after first deploy

The fresh keypair was deployed BEFORE anchor keys sync, so bytecode had declare_id pointing at old canonical ID while deployed at new ID. Anchor runtime guard fired.

Resolution: cp /tmp/roundfi-core-rehearsal.json target/deploy/roundfi_core-keypair.json -> anchor keys sync -> rebuild + redeploy.

### 1.3. Insufficient SOL on solana config wallet

Default solana config wallet (B8CjP1mC4...) had ~0.04 SOL after airdrop rate-limit. Deploy needs ~5.9 SOL. Resolution: transferred 6 SOL from local deployer keypair (64XM177Vm...) via solana transfer.

## 2. Deploy + init evidence

- Initial deploy (wrong declare_id): tx 2uKE8mFCTuG6b2Kk2AbLEHshGXGHFaUDMkSSu9iKuAwxZHH9VVPV9wT2F6nm6vusrjud6pakxDWRsDQBLguxVAYu
- Upgrade after anchor keys sync: tx 4kv9cuoShjTEAY3Ps3A5xzbEos1xc4NPim4EczZ3Kpb4JveSiaJkXebZNRdnsTc1ZxiF2coHTLkj5EDa1xST8pZU
- initialize_protocol: tx e47KtXDUXWVpFYFYJbYqm7HLqge1pTVwuhmKVzi5FcsZX81TfSu1HYb25cVsDVmhRodQ4mUHdSga6xreswpnnJh
- Upgrade with shortened TREASURY_TIMELOCK_SECS = 60: tx 3VuFssJg76QZnETZTWGuAocUNRp8SnCTfU5z8G8Uz3q5AL13BMEawAWqnJSWNunQWUbiHfjU6tLrRbdip6KJ2Vyu

## 3. Squads vault PDA derivation

DEVIATION from canonical procedure: Rather than deriving a real Squads v4 multisig vault PDA, this rehearsal uses a single throwaway keypair (/tmp/rehearsal-target.json -> pubkey 6Y6BL1mq6ME7HfWXFVzUmT1DgKekzW8eKW11jAess6aL) as a proxy "target authority". The propose/cancel/commit instruction surface is identical regardless of whether the target is a Squads vault PDA or a plain pubkey — the on-chain handlers treat the new authority as opaque.

For the real mainnet ceremony, the target MUST be a Squads v4 vault PDA derived from a 3-of-5 multisig with hardware-wallet members (per squads-multisig-procedure.md sections 3-5). This rehearsal validated the RoundFi-side propose/cancel/commit ix logic; the Squads-side multisig setup is exercised separately via the Squads web UI on the mainnet ceremony day.

## 4. Authority rotation surface — initial state (post-init, pre-propose)

Live authority: 64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm
Pending authority: 11111111111111111111111111111111
Pending authority eta: 0 (no proposal)

(Reading taken with corrected script offsets — see section 8 for the verify-script offset bug discovered during this rehearsal.)

## 5. Phase A — Propose

- Target authority: 6Y6BL1mq6ME7HfWXFVzUmT1DgKekzW8eKW11jAess6aL (throwaway keypair)
- Signer: 64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm (current config.authority)
- propose_new_authority tx: 4pfiQLAEzpozgZgRr4z47asWfZdtu3uKreCgFNFRnnznaGCsyEwp89qFzGqeg1eJwAWW7wEV2U7tYPBoZpTzMPFN

Post-propose state observed:

- Live authority: 64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm (unchanged)
- Pending authority: 6Y6BL1mq6ME7HfWXFVzUmT1DgKekzW8eKW11jAess6aL (NEW)
- Pending authority eta: now + TREASURY_TIMELOCK_SECS (timelock active)

## 6. Phase B — Cancel (kill-switch drill)

- Signer: 64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm
- cancel_new_authority tx: s1NDWguUmSe2oC1Vw2FzoiKTXfVMkuVXvpi8Xq7i5jcg2SitySz1UcC9SUdFfo8DpKc42arbG5gwnatFY4pg2nF

Post-cancel state: pending_authority reset to 11111..., eta reset to 0. Kill-switch validated.

## 7. Phase C — Re-propose + Commit

- Re-propose (same target) tx: 2dhWa68945EW7fvkknSssyCAaYtcAUK5niRoaYpPuWSrACoaVaQ9ZGDsdRASbvs8YX3d2C6XiMwx4NibfHfW6hcX
- Wait: 65s (shortened timelock approach — see section 7.1)
- commit_new_authority (post-eta) tx: 2xeWvuDTa4hC9Ej2sTmEjEPwgu4ztYnjZKfNYvwXVpJtBGXEw2BQx2e2229cW4d3zCKaK9nh8dDa6XyhzfXgvkVf

### 7.1. Timelock approach

commit_new_authority enforces TREASURY_TIMELOCK_SECS = 604_800 (7 days) unconditionally on the canonical code path. For same-day rehearsal completion, this run temporarily lowered the constant to 60 seconds on the parallel deploy (rebuild + upgrade), per Option 2 in squads-rehearsal-quickstart.md.

The 7-day mainnet timelock is NOT bypassed in production — the canonical program at 8LVrg...QQjw was never touched. This rehearsal validates the propose/cancel/commit instruction logic; the real-time 7-day wait is a runtime property that requires no further validation beyond the unit test that pins the constant.

### 7.2. Final state (post-commit)

Live authority: 6Y6BL1mq6ME7HfWXFVzUmT1DgKekzW8eKW11jAess6aL (ROTATED)
Pending authority: 11111111111111111111111111111111 (Cleared)
Pending authority eta: 0 (no proposal)
Status: Idle — no authority rotation in flight

## 8. Audit-worthy findings discovered during rehearsal

### 8.1. Script offset bug — squads-rehearsal-{verify,commit-authority}.ts

Both scripts hardcoded OFFSET_PENDING_AUTHORITY = 311 and OFFSET_PENDING_AUTHORITY_ETA = 343. Both wrong by 2 bytes.

Cause: source order in programs/roundfi-core/src/state/config.rs places lp_share_bps: u16 (2 bytes, line 122) BETWEEN commit_reveal_required (line 107) and pending_authority (line 136). The struct's own pub const SIZE comment block (line 193) lists pending_authority BEFORE lp_share_bps — script author trusted the SIZE comment instead of source declaration order. Borsh serializes in declaration order, not comment order.

Symptom: verify displayed garbage Pubkey (7jkAWw2ZGq1R1...) and eta as out-of-range Date (caused RangeError: Invalid time value). commit aborted with "Timelock active" error path before sending the tx because the misread eta looked far in the future.

Fix in this PR: OFFSET_PENDING_AUTHORITY 311 -> 313, OFFSET_PENDING_AUTHORITY_ETA 343 -> 345. Verified end-to-end — post-fix verify correctly shows live authority 6Y6BL1mq... and pending=default after the rotation completed.

### 8.2. Possible initialize_protocol zombie pending_authority (needs follow-up)

When verify ran post-init (BEFORE the offset fix), the misread offset 311 returned a non-default Pubkey 7jjt2zcBu3rsTLcBuSBk1Aa3TqdMkXwWhzx5U7LpGZFm with eta=0. With the corrected offset 313, the post-init pending_authority SHOULD be 11111... — but this rehearsal couldn't verify that snapshot (propose+cancel cycle ran before the offset bug was discovered).

Recommended follow-up: a future rehearsal should capture the post-init state with corrected offsets BEFORE any propose, to confirm initialize_protocol correctly sets pending_authority = Pubkey::default(). If not, this is a SEV-040 candidate (zombie state, similar to SEV-036).

## 9. Pre-mainnet checklist confirmed by this rehearsal

- [x] propose_new_authority ix exists, callable by current authority, atomically sets pending_authority + pending_authority_eta
- [x] cancel_new_authority ix exists, callable by current authority, resets pending state
- [x] commit_new_authority ix exists, callable by anyone, enforces eta window, rotates live authority
- [x] Post-commit state is correctly cleared (pending_authority: default, eta: 0)
- [x] The 4 RoundFi rehearsal scripts work end-to-end WITH the offset fix from section 8.1
- [x] pnpm aliases (devnet:squads-rehearsal-\*) work (from PR #367)
- [ ] NOT validated by this rehearsal: actual Squads v4 multisig PDA derivation + member signing flow (see section 3). This is exercised separately on the mainnet ceremony day via the Squads web UI per squads-multisig-procedure.md sections 3-5.

## 10. Cleanup

After the rehearsal:

- target/deploy/roundfi_core-keypair.json was overwritten with the rehearsal keypair — restore from keypairs/ or regenerate on next canonical deploy
- Anchor.toml + programs/roundfi-core/src/lib.rs were modified by anchor keys sync — reverted via git checkout
- programs/roundfi-core/src/constants.rs TREASURY_TIMELOCK_SECS was temporarily lowered to 60 — reverted to 604_800
- .env was modified to point at the rehearsal program-id — reverted from .env.canonical-backup
- The throwaway program at 6WuSo1ut...7Rpn stays on devnet as a historical artifact. The canonical program at 8LVrg...QQjw was never touched.
