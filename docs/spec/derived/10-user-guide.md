---
title: "RoundFi — User Guide"
subtitle: "How to join a savings circle, pay each cycle, and climb the levels"
author: "RoundFi"
date: "2026-06-23"
lang: "en"
...

> **Derived document.** This is a derivation of [`docs/spec/MASTER-SPEC.md`](../MASTER-SPEC.md)
> (§4 Protocol, §5 Reputation engine), translated into plain language for pool
> members. The Master Spec is the single source of truth; if a number here
> disagrees with it, the Master Spec wins. This guide deliberately contains no
> technical internals — just what you need to use RoundFi well.

## 1. What RoundFi is (in plain terms)

A RoundFi pool is a **savings circle**. A small, fixed group of people each put in
the same amount on a regular schedule — call it your **contribution**. Each round,
**one member receives the whole pot** (we call it your **payout**). The circle
keeps going until **everyone has had their turn**, and then it closes.

If you have ever been in a _consórcio_, a _junta_, a _tanda_, a _susu_, or a
_chama_, you already know how this works. The only difference is that RoundFi runs
it on rails that make every payment **permanent and provable** — which means the
good history you build here doesn't disappear when the circle ends. It becomes a
**reputation you keep and carry forward**, and that reputation is what eventually
lowers your cost of borrowing.

The single most important idea in this whole guide:

> **Receiving your payout is not what earns you reputation. Paying your share all
> the way to the end of the circle is.**

Everything below is built around that one principle.

## 2. How to join a circle

When you join a pool, you do two things:

1. **Claim your spot.** A pool has a fixed number of spots and a fixed number of
   rounds — one round per member, so **everyone gets exactly one turn**. The
   circle only starts once the last spot is filled.

2. **Put down a refundable deposit.** To join, you leave a **deposit** that is
   sized by your **level** (see §6). Think of it as a security deposit, not a fee:
   it is **your money**, held aside, and you get it back over time as you pay on
   schedule. A brand-new member at the lowest level puts down the largest deposit
   (half the size of the payout they can draw); a member at the top level puts
   down a much smaller one. **Climbing the levels is how you shrink that deposit.**

Once every spot is filled, the circle becomes active and the rounds begin.

## 3. How to pay each cycle

Each round (a **cycle**), every member makes their regular **contribution**. A
small part of each contribution is set aside for two safety buffers that protect
the circle — a tiny shared **reserve** and your own **deposit pot** — and the rest
goes into the pot that pays out that round. You don't have to manage any of this;
it happens automatically when you pay.

One member draws the **payout** each cycle. The circle moves to the next round
**when that round's payout is claimed** — so the circle advances as members take
their turns, not by a stopwatch. The clock matters for **one** thing only: deciding
whether your payment was **on time** or **late**.

**You keep paying your contribution every cycle, including after you have already
received your own payout.** This is the heart of it. Receiving the pot early is a
benefit, not the finish line — your job is to keep paying your share until the
circle is complete.

## 4. On time vs. late

Every cycle has a due time. How your payment lands is what builds — or damages —
your reputation:

- **On time** — you pay by the deadline. This is the good case: it earns
  reputation and steadily releases your deposit back to you (see §5).

- **A little early, or right on time** — treated as the best case. If you tend to
  pay a few days ahead, your **punctuality** stands at its highest.

- **Late** — you pay after the deadline. A late payment **costs** you: it sets
  your reputation back noticeably, and it **freezes your deposit** — none of it is
  released back to you until you are paying on time again.

There is a small **grace allowance** for honest timing wobble: a payment that is
**under an hour late** is treated as on time. This is just to absorb clock and
network jitter — it is **not** a license to pay a day late.

The system is intentionally **slow to reward and quick to penalize**, because that
is how trust works in real life. A single late payment undoes the credit of
several on-time ones. The lesson is simple: **pay on time, every time.**

## 5. Your deposit comes back as you pay

Your join deposit is not gone — it is **refundable, and it returns to you in
steps** as you build a record of on-time payments. Each time you reach another
on-time milestone, **another slice of your deposit is released back to you.**

The mirror of this is what keeps the circle safe: if you pay **late**, your
deposit **stays locked** and stops being released until you are current again.
Pay on time and your money flows back to you; fall behind and it stays put as a
guarantee to the other members. That is the deal — **discipline is rewarded,
delinquency is held as collateral.**

## 6. The four levels, and how to climb them

RoundFi has a four-rung ladder. Your level decides how large a deposit you must
put down to join a circle — and **climbing it is the whole reward.**

| Level | Name       | Your join deposit | What it takes to reach it                                   |
| ----- | ---------- | ----------------- | ----------------------------------------------------------- |
| L1    | Iniciante  | 50% of the payout | Where everyone starts.                                      |
| L2    | —          | 25% of the payout | A reputation score of 500 **and** 2 completed circles.      |
| L3    | Veteran    | 10% of the payout | A score of 2,000 **and** 3 completed circles.               |
| L4    | Elite      | 3% of the payout  | A score of 5,000 **and** 8 completed circles, plus a verified identity. |

Going from the bottom rung to the top takes the deposit you must lock from **half
the payout down to just 3% of it** — you free up almost all of that capital. That
is the prize the ladder exists to give you.

### 6.1 You need both: points *and* completed circles

Notice that every level above the first has **two** requirements you must meet at
the same time:

1. **A reputation score.** You earn points by paying on time (a steady **+10**
   each on-time payment) and, most of all, by **completing a circle** (a **+50**
   when you pay your final installment of a pool). Paying late **subtracts 100**,
   and a default **subtracts 500**.

2. **A count of completed circles.** This is the requirement you **cannot rush.**
   It only goes up when you pay a circle **all the way through to the end** — and
   each completed circle is only counted after a **30-day cooldown** since the
   last one. You cannot stack up completions by running many tiny circles at once;
   they are spaced out by a real-world clock. This is what makes a high level
   **mean** something: it represents months — and at Elite, years — of honest
   history that no shortcut can manufacture.

### 6.2 Completing the circle is what counts — not getting paid

This is worth repeating because it surprises people:

> **Receiving your payout earns you no reputation at all. It is score-neutral.**
> The reward — the points and the credit toward your next level — only lands when
> you pay your **last** contribution and the circle finishes.

In other words, the system specifically waits to see that you **kept paying after
you already got your money.** That is the behavior that proves you are
trustworthy, so that is the behavior that gets rewarded.

### 6.3 Moving up

Climbing a level is **automatic in the sense that it's permissionless** — once you
meet both requirements for the next rung, your level can be advanced. The top
level, **Elite**, additionally **always requires a verified identity**, no
exceptions. Lower levels may or may not require identity depending on the
circle's settings.

## 7. What happens if you miss a payment

RoundFi treats falling behind as a **last resort, not a tripwire.** If you miss a
cycle's contribution, you are not instantly penalized — there is a **grace
window** (around a week) during which you can still catch up and make things
right. **Catching up within that window is always the goal.**

If the grace window passes and you still have not paid, the circle has to protect
the member who is owed the pot that round. To do that, it draws on your buffers in
this order:

1. First, the **shared reserve** covers what it can.
2. Then, your **own deposit** is used to cover the rest.
3. Finally, if needed, the remainder of your **join deposit** is drawn.

This is the moment your refundable deposit stops being yours — it is what the
deposit was always there to guarantee. A missed payment that reaches this point is
recorded as a **default**, which is the heaviest mark against your reputation: it
**wipes your score to zero** and **drops your level immediately**, so you cannot
slip into the next circle at a cheaper deposit. Rebuilding from there is possible,
but it is the slowest road back.

The takeaway: if you are going to be short, **pay within the grace window.** And
if you genuinely cannot continue, you have a cleaner exit — described next.

## 8. How to exit early — sell your spot

Sometimes life changes and you cannot finish a circle. RoundFi gives you a way out
that doesn't trigger a default: you can **sell your spot** to someone else (this is
the **Escape Valve**, a secondary market for positions).

When you sell, the buyer takes over your spot **exactly as it stands** — the same
remaining turns, the same future contributions still owed, and the state of your
deposit. In return, you receive the price you agreed on, and you walk away cleanly.

A few things to understand before you sell or buy:

- **Your reputation stays with you.** Selling your spot transfers the **spot and
  its remaining obligations** — it does **not** transfer your score or your level.
  Those belong to **you**, the person, and they go with you to your next circle. A
  buyer brings their own reputation; you keep yours.

- **If you are buying a spot, look closely at what you are taking on.** You inherit
  whatever payments that spot still owes. Buying a spot that is halfway through
  means you are signing up for the rest of its contributions — make sure the price
  reflects that.

- **Prices can be hidden until the sale is locked in.** To stop opportunists from
  jumping in front of a freshly-posted price, a seller can list a spot with the
  price **sealed**, then reveal it; for a short cooling-off moment after the
  reveal, the sale is reserved for the intended buyer. If you have arranged a sale
  privately, this protects your deal.

Selling your spot is the **honest exit** — far better for your reputation than
simply stopping payments and defaulting.

## 9. The short version

- **Join** a circle by claiming a spot and leaving a **refundable deposit** sized
  by your level.
- **Pay your contribution every cycle** — including after you've received your own
  payout.
- **Pay on time.** On time earns reputation and releases your deposit back to you
  in steps; late sets you back and freezes your deposit.
- **Climb the levels** by building a score **and** completing circles over real
  time — and remember that **finishing a circle**, not getting paid, is what
  counts.
- **If you fall behind, catch up inside the grace window.** A default is the
  heaviest penalty and wipes your score.
- **If you must leave, sell your spot** instead of defaulting — your reputation
  stays with you either way.

Build the history. It's yours to keep, and it's what makes your next circle — and
eventually your borrowing beyond RoundFi — cheaper.

---

_Cross-references: the bigger picture of what RoundFi is and why it exists →
[`01-roundfi-overview`](./01-roundfi-overview.md); how your reputation, levels,
and metrics are built → [`04-behavioral-reputation-score`](./04-behavioral-reputation-score.md).
The full source of truth is MASTER-SPEC §4 and §5._
