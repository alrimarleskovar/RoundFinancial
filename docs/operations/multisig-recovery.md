# Multisig Recovery Runbook

> **Scope:** what to do _after_ the Squads multisig owns the protocol — the
> failure-and-recovery side of the ledger. Three procedures: **(R1) signer key
> loss / compromise**, **(R2) planned signer rotation**, and **(R3)
> emergency pause via the multisig**. This is the recovery companion to the
> setup-and-ceremony docs.
>
> **Read first / companions:**
>
> - [`squads-multisig-procedure.md`](./squads-multisig-procedure.md) — the one-time
>   bootstrap that _creates_ the multisig and rotates authority into it. This doc
>   assumes that ceremony already happened.
> - [`key-rotation.md`](./key-rotation.md) — the three on-chain key surfaces
>   (protocol authority, treasury, upgrade authority) and their timelock/one-way
>   semantics. Recovery here operates _through_ those same instructions.
> - [`emergency-response.md`](./emergency-response.md) — the `pause` kill-switch
>   decision tree. §R3 below is the multisig-specific execution of it.
> - [`incident-template.md`](./incident-template.md) — the write-up for any event
>   that triggers R1 or R3.

---

## Threat model recap

After the mainnet ceremony, the protocol's two most sensitive surfaces —
`ProtocolConfig.authority` and the upgrade authority on all 4 programs — are held
by a **3-of-5 Squads v4 vault PDA**, not a single keypair. The recovery posture
therefore changes shape:

| Failure                       | Pre-multisig (single key) | Post-multisig (3-of-5)                                                                              |
| ----------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| One signer key lost           | Total loss of authority   | **Survivable** — 4 signers remain, still ≥ threshold                                                |
| One signer key compromised    | Total compromise          | **Survivable** — attacker has 1 of 3 needed signatures                                              |
| Two signer keys lost          | —                         | **Survivable** — 3 signers remain = exactly threshold                                               |
| Three signer keys lost        | —                         | **Authority unrecoverable** (see R1 §"Below threshold")                                             |
| Three signer keys compromised | —                         | **Protocol captured** (see `squads-multisig-procedure.md` §"Squads multisig is itself compromised") |

The whole point of 3-of-5 is that the first two columns of bad outcomes become
_recoverable operations_ instead of _terminal events_. The procedures below are
how you exercise that recoverability — and the hard limits where it runs out.

> **Single source of truth for member keys.** Every procedure here depends on
> knowing the current member set + threshold. That is recorded canonically in
> the mainnet equivalent of `docs/devnet-deployment.md` (the "protocol multisig"
> block — multisig PDA, vault PDA, 5 member pubkeys, threshold). If that record
> and the on-chain multisig account ever disagree, **the on-chain account
> wins** — decode it with the Squads SDK / UI before acting.

---

## R1 — Signer key loss or compromise

A member's hardware wallet is lost, stolen, destroyed, or its seed is suspected
exposed. The multisig itself is fine; you are removing one corner of it before
the loss compounds.

### Step 0 — Triage: lost vs compromised

|            | **Lost** (no longer have it)    | **Compromised** (someone else might)                     |
| ---------- | ------------------------------- | -------------------------------------------------------- |
| Urgency    | Days — you're still ≥ threshold | **Hours** — attacker may try to coordinate to threshold  |
| First move | Schedule R1 rotation            | Assess whether R3 (emergency pause) is warranted _first_ |
| Risk       | Erosion of redundancy           | Active capture attempt                                   |

If **compromised**, before anything else answer: _could the attacker reach the
3-of-5 threshold?_ With one compromised key they need two more cooperating (or
also-compromised) members. If there's any plausibility of that — e.g. a
correlated breach (shared device vendor, shared cloud backup, phishing campaign
hitting multiple members) — treat it as a capture attempt and go to **R3** to
pause first, then rotate.

### Step 1 — Confirm you are still at or above threshold

Decode the live multisig account and count the _usable_ (not-lost,
not-compromised) members against the threshold.

```
usable_members ≥ threshold   →  proceed with R1 (remove + replace the bad key)
usable_members <  threshold  →  STOP — see "Below threshold" at the end of R1
```

For 3-of-5: losing 1 leaves 4 usable (fine), losing 2 leaves 3 usable (exactly
threshold — fix urgently, you have zero slack), losing 3 drops you below.

### Step 2 — Replace the member via a Squads config transaction

Squads member changes are themselves multisig proposals — they require the
_current_ threshold of _remaining_ signers to approve. Via
[app.squads.so](https://app.squads.so) (mainnet), connect a healthy member's
hardware wallet:

1. **Settings → Members → Remove** the lost/compromised member's pubkey.
2. **Settings → Members → Add** the replacement member's pubkey (a _freshly
   generated_ hardware-wallet key, never one previously used by the protocol).
3. Keep the **threshold unchanged** (3). Squads bundles remove+add into one
   config transaction so the multisig never transiently drops to 4 members at a
   3 threshold mid-flight — but verify the proposed config preview shows
   `5 members, threshold 3` before approving.
4. Collect approvals from the remaining healthy members until threshold is met;
   the last approver executes.

> **Why not just remove and run 4-of-5?** You can, temporarily, but it lowers
> redundancy — a 3-of-4 (if you also drop the threshold) or a 3-of-4-member set
> means the _next_ loss is closer to terminal. Restore to 5 members promptly.

### Step 3 — If the compromised key still had on-chain authority delegations

Removing a member from the Squads multisig does **not** by itself rotate the
underlying on-chain authority — the vault PDA address is unchanged, so the
protocol/upgrade authority _stays valid and uncompromised_ (it was never the
member key; it was always the vault PDA). This is the key property: **rotating a
member is cheap and does not touch `ProtocolConfig.authority`.**

The expensive on-chain rotations (`propose_new_authority` → 7-day wait →
`commit_new_authority`, and `set-upgrade-authority` ×4) are only needed if the
**vault PDA itself** must change — i.e. R1's "Below threshold" terminal case or a
full-multisig compromise, not a single-member swap. Do **not** run them for a
routine single-key R1.

### Step 4 — Document + disclose

1. File an incident report ([`incident-template.md`](./incident-template.md))
   even for a clean lost-key case — the audit trail matters.
2. Update the canonical member-key record (the `docs/devnet-deployment.md`
   mainnet equivalent): strike the old pubkey, add the new one, note the date +
   tx signature of the config change.
3. **Compromise only:** assess whether public disclosure is warranted. A single
   removed-before-threshold key with no fund movement is typically an internal
   note; a near-miss capture attempt belongs in a SECURITY.md-channel
   disclosure.

### Below threshold — when you've lost 3 of 5

If usable members drop below threshold, the multisig **cannot approve anything,
including its own member changes.** The vault PDA is frozen: no authority ix, no
upgrades, no member recovery from inside Squads. This is the terminal case the
3-of-5 design is meant to make very unlikely (it requires 3 independent,
simultaneous losses).

There is no on-chain recovery. The protocol's authority surfaces are stuck at the
last-good state — which means **funds are not stolen, but the protocol can no
longer be governed or upgraded.** Practical posture:

- **Treasury** continues routing to whatever `treasury` was last set to (still
  recoverable if that ATA's owner keys survive — see `key-rotation.md` §(b)).
- **No pause possible** — if an incident occurs while frozen-below-threshold,
  there is no kill-switch. This is the worst-case argument for **never letting
  the set sit at exactly 3 usable members** (one loss from terminal).
- **Operational continuation** requires deploying replacement programs under a
  _new_ authority and migrating state — effectively a relaunch, not a recovery.

The only real defense is prevention: dispersed custody (no two members sharing
device vendor / location / backup provider), and treating "down to 3 usable
members" as a **drop-everything restore-to-5 event**, not a someday task.

---

## R2 — Planned signer rotation

Routine, non-incident rotation: a team member departs, a board seat changes, or
you're upgrading a member's custody (software → hardware, or hardware refresh).
Mechanically identical to R1 Step 2, but unhurried and pre-announced.

1. **Generate the new member's key offline** on its target hardware wallet.
   Never reuse a key that previously held any protocol role.
2. **Pre-announce** in the out-of-band member channel (not public) with the
   incoming pubkey so every signer can verify it before approving.
3. **Propose the config change** (remove departing, add incoming, threshold
   unchanged) per R1 Step 2. The departing member's approval is **not** required
   — the _remaining_ signers reach threshold without them. Run the rotation
   _before_ the departing member's access is revoked elsewhere so you keep
   maximum healthy signers during the approval window, but the rotation itself
   doesn't depend on their cooperation.
4. **Verify** the post-change multisig account shows the new member set +
   unchanged threshold; record it in the canonical key ledger.
5. **No on-chain authority rotation needed** — same reasoning as R1 Step 3, the
   vault PDA is unchanged.

> **Changing the threshold (e.g. 3-of-5 → 4-of-7):** this is also a Squads
> config transaction, approved at the _current_ threshold. Raise member count
> first (so the new members exist), then raise the threshold in the same or a
> follow-up config tx. Never lower a threshold and add members in a way that
> transiently weakens the security bound — preview the bundled config before
> approving.

---

## R3 — Emergency pause via the multisig

The kill-switch when authority is the Squads vault PDA. This is the
multisig-execution detail behind [`emergency-response.md`](./emergency-response.md)
— consult that doc's decision tree for _whether_ to pause; this is _how_, under
the latency tax that multisig adds to the single most time-sensitive lever.

### The latency problem

Pre-multisig, `pause()` was one signature — sub-second. Post-multisig it needs
**3-of-5 approvals collected and one execution tx**, which is as slow as your
slowest-to-respond second-and-third signer. For an exploit that drains funds in
seconds, this gap matters.

### Execution

1. **Any member proposes** a `pause()` instruction on `roundfi-core` from the
   vault PDA via the Squads UI (or SDK — see below for a pre-staged path).
2. **Members approve** until the threshold is met. Broadcast the proposal link
   through the out-of-band emergency channel; do not wait for people to notice
   it in the UI.
3. **Last approver executes.** The `paused` flag flips; all fund-movement ix
   begin rejecting with `ProtocolPaused` (see `emergency-response.md` for the
   exact blocked-vs-allowed matrix — `settle_default` and read-only stay open by
   design).
4. **Verify:** `solana account <ProtocolConfig-PDA> --output json` → decode
   `paused == true`.
5. **Unpause** is the same flow in reverse, once the incident is resolved — also
   a 3-of-5 proposal. There is no fast-path for unpause and that's correct:
   resuming fund movement should never be a unilateral act.

### Mitigating pause latency — break-glass sub-multisig

The open design decision tracked in issue #266: hold the **pause authority** on a
_separate, lower-threshold_ security-council multisig (e.g. 2-of-3) while keeping
**treasury + upgrade authority** on the full 3-of-5. This trades a smaller
blast-radius surface (pause only freezes; it can't move funds or ship code) for a
faster kill-switch.

- **If adopted:** the security council can pause in 2 signatures, but cannot
  unpause-then-drain (unpause + any fund movement still needs the full 3-of-5
  authority for everything except the pause toggle itself). Document the council
  member set in the same canonical key ledger, kept distinct from the main
  multisig members.
- **If not adopted:** accept the 3-of-5 pause latency and compensate with
  pre-staged proposals — keep a `pause()` proposal ready-to-approve, or a
  signed-offline-but-unsubmitted path, so the only emergency-time cost is
  collecting approvals, not constructing the tx.

This doc does not decide between the two; it documents both so whichever the team
picks at the ceremony has a written recovery path. Record the decision (and the
council member set, if any) in the canonical key ledger and link it back to
issue #266.

---

## Quick reference — which procedure?

```
A signer key is gone / maybe-exposed
  ├─ Could an attacker reach threshold?  → R3 (pause) FIRST, then R1
  ├─ Still ≥ threshold usable members?   → R1 (remove + replace member)
  └─ Below threshold (lost 3 of 5)?      → R1 "Below threshold" (terminal; relaunch)

A signer is leaving / custody upgrade (no incident)
  └─ R2 (planned rotation)

Funds draining / exploit in progress
  └─ R3 (emergency pause) — see emergency-response.md decision tree
```

---

## References

- [`squads-multisig-procedure.md`](./squads-multisig-procedure.md) — multisig
  bootstrap + authority rotation into the vault (the setup this recovers)
- [`squads-mainnet-ceremony-checklist.md`](./squads-mainnet-ceremony-checklist.md)
  — day-of ceremony checklist
- [`key-rotation.md`](./key-rotation.md) — the three on-chain key surfaces +
  their timelock semantics
- [`emergency-response.md`](./emergency-response.md) — pause decision tree (R3 is
  its multisig execution)
- [`incident-template.md`](./incident-template.md) — incident write-up
- [Squads v4 docs](https://docs.squads.so/main/) — member-management + proposal
  UI flows
- [Issue #266](https://github.com/alrimarleskovar/RoundFinancial/issues/266) —
  multisig migration tracking (this doc ships its `multisig-recovery.md`
  acceptance item)
