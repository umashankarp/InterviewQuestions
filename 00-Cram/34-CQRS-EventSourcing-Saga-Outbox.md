# CQRS · Event Sourcing · Saga · Outbox — Cram Sheet

> Tier 1/2 · Source: `34-CQRS/` `35-Event-Sourcing/` `36-Saga/` `37-Outbox/` (8 modules, 4,548 lines) · Read: 15 min
> These four are taught and asked together. Know **which problem each one solves** — that is the question.

| Pattern | Problem it solves |
|---|---|
| **CQRS** | read and write models have genuinely different shapes |
| **Event Sourcing** | you need the full history, not just current state |
| **Saga** | a business transaction spans services and 2PC is unavailable |
| **Outbox** | atomically "save to the DB **and** publish an event" |

**CQRS does not require Event Sourcing. Event Sourcing does not require CQRS either, but high-volume or complex event-sourced reads commonly need projections/read models.** Keep the concepts separate — conflating them is the common mistake.

---

## 1. CQRS

- **The mismatch, formalised:** writes need normalisation and invariants; reads need denormalisation and joins already done. One model serving both compromises each.
- **Three levels, lightest to heaviest:**
  1. **Separate methods/models** in one class, one database. (Most teams should stop here.)
  2. **Separate read and write models** over the same database — e.g. Dapper for queries, EF Core for commands.
  3. **Separate read and write *stores***, synchronised by events. This is where eventual consistency enters.
- **Eventual consistency's concrete meaning at the projection layer:** a user writes, then immediately reads, and does not see their own change. Mitigations: return the new state from the command, read-your-writes routing for a short window, a version token the UI waits on, or simply designing the UI not to require it. **Name the staleness bound as a number** (e.g. p99 < 2s).
- **Idempotent projection is non-negotiable** — the projector will reprocess events (redelivery, replay, restart). Track the last processed position, or make the write naturally idempotent (upsert by key).
- **Projectors are independent consumer groups and must never depend on each other.** One slow projector must not block another.
- **Cross-read-model consistency is explicitly NOT guaranteed** — two read models can disagree momentarily. Say this out loud rather than being caught by it.
- **Read-model technology follows the query:** relational for ad-hoc/reporting, Redis for key lookup, OpenSearch for text, a document store for a whole-page view.
- **Snapshotting for fast rebuild** at scale; otherwise a rebuild of a large projection takes hours.
- **Backpressure risk:** one slow consumer's lag grows unboundedly — alert on it against retention.

---

## 2. Event Sourcing

- **State is not stored; the sequence of events is.** Current state = a left fold over the event stream. **Append-only, per-aggregate stream.**
- **Reconstruction:** `LoadFromHistory` — load events for the stream, apply each in order. Cost grows with stream length → **snapshots** (store state at version N, replay only events after it). Snapshot is an optimisation, **never a source of truth**.
- **Optimistic concurrency via expected stream version** — append with `expectedVersion`; a mismatch means someone else wrote, so reload and retry. This is how you get concurrency control without locks.
- **Event versioning / upcasting** — old events are immutable and must stay readable forever. Transform old shapes to new on read. **You can never "fix" a historical event** — you append a correcting one.
- **Performance shape: append-heavy writes (fast, sequential), replay-heavy reads (slow)** → which is exactly why it needs CQRS read models.
- **Benefits:** perfect audit trail, temporal queries ("what was the balance on 3 March?"), rebuild any projection, debug by replay. **This is why it fits regulated finance.**
- **Costs:** every developer must learn it, eventual consistency, schema evolution forever, GDPR **right-to-erasure conflicts with immutability** (mitigate with crypto-shredding — delete the key, not the event), and tooling is thinner.
- **Migration to ES (the capstone problem):** backfill historical events from non-event-sourced data → **dual-write period with two sources of truth, deliberately and temporarily** → reconcile continuously to detect divergence → feature-flagged reversible cutover → decommission. **The distinct new risk: backfill-derived history is a reconstruction, not a record** — be explicit that it is lower-fidelity evidence than events captured live.

---

## 3. Saga

- **Orchestration** — a central coordinator issues commands and tracks state. **The orchestrator's saga state is its own aggregate, persisted.** Visible, queryable, testable; it is a coupling point.
- **Choreography** — each service reacts to events. Loosely coupled; **the workflow exists nowhere** and nobody can answer "where is order 123?"
- **Use orchestration when anyone will ask for status** — which, for money movement, they always will.
- **Compensating transactions are semantic reversal, not perfect undo.** You do not un-charge a card; you issue a refund. You do not un-send an email; you send a correction. **"Undo the capture" is a red-flag answer.**
- **Idempotency is non-negotiable at every step *and* every compensation** — compensations get retried too.
- **Forward recovery (retry until it succeeds) vs backward recovery (compensate).** Choose per step: after the **pivot transaction** (the first irreversible one) you can usually only go forward.
- **Order compensations in reverse**, and test that a compensation failing is itself handled — that is the part candidates skip.
- **Saga timeout and liveness monitoring** — a saga stuck in a step forever is invisible without an explicit timeout and an alert on stalled instances.
- **At scale:** parallel branches (independence test + compensation ordering), sub-sagas, **in-flight saga-definition migration** (versions must run to completion on the definition they started with), and distributed tracing across steps.
- **Isolation is absent** — intermediate states are visible. Mitigate with **semantic locks** (a `PENDING` status) and commutative updates.

---

## 4. Outbox

- **The problem: the dual write.** Writing to the database and publishing to a broker are two operations; either can fail after the other succeeds, and no retry fixes it because you don't know which landed.
- **Table schema:** `Id (sequential) · AggregateType · AggregateId · EventType · Payload · OccurredAt · ProcessedAt · Attempts · Error`.
- **Write the business row and the outbox row in ONE local ACID transaction.** That is the entire trick.
- **Relay mechanisms:**
  | | Latency | Complexity |
  |---|---|---|
  | **Polling** | seconds (interval-bound) | low — but adds constant query load; use `UPDLOCK, READPAST` / `SKIP LOCKED` to let multiple relays run |
  | **CDC** (Debezium, SQL Server CDC, DynamoDB Streams) | ms | higher operational complexity, more infrastructure |
- **Guarantee is at-least-once → consumers must be idempotent.** The outbox makes the *local* part atomic; it does not make delivery exactly-once.
- **Ordering is per-stream (per aggregate), not global** — publish with a partition key of the aggregate id.
- **Table growth needs archival/pruning** or it becomes your largest table and the relay query degrades.
- **Poison message: never block the whole relay indefinitely.** Bounded attempts, then park it and continue.
- **Inbox pattern** is the mirror on the consumer side: record processed message ids in the same transaction as the effect.

---

## Top traps

1. Saying CQRS requires Event Sourcing.
2. Full three-level CQRS on a CRUD app.
3. A projector that isn't idempotent.
4. Not naming the staleness bound.
5. Treating a snapshot as the source of truth.
6. Editing or deleting a historical event.
7. "Undo the capture" instead of compensating.
8. Compensation that isn't idempotent, or whose own failure is unhandled.
9. Choreography for a workflow with a status question.
10. Publishing to a broker inside the business transaction (dual write) — or a poison message blocking the relay.

---

## Interview Q&A — Lead / Principal

### Q1 · Should we event-source this? *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"The team wants to event-source the whole platform. Your call."*

**Answer.** Not the whole platform — event sourcing is a **per-aggregate** decision, and applying it uniformly is how teams end up paying the cost everywhere and collecting the benefit nowhere. It earns its place where the **history is the requirement**, not a nice-to-have: a ledger, an order lifecycle, anything a regulator will ask you to reconstruct. For those, the audit trail is free and complete by construction, temporal queries work, and you can rebuild any projection. For a user-preferences table, it's pure cost.

The costs I'd put on the table before agreeing to any of it: every engineer joining has to learn it; eventual consistency becomes pervasive because reads need projections; **event schema evolution is forever** — you can never edit a historical event, only upcast on read; and GDPR right-to-erasure directly conflicts with immutability, which needs crypto-shredding — delete the key, not the event — decided up front rather than discovered.

So my answer is: pick the one or two aggregates where history is genuinely the product, do those properly, and leave the rest CRUD. And I'd separate the two concepts explicitly, because they get conflated — **CQRS doesn't require event sourcing** and is often worth doing alone; **event sourcing can serve simple reads by replaying streams, but complex or high-volume reads commonly justify CQRS-style projections**.

**Why it lands.** Scopes it per aggregate, names the four costs including GDPR, and separates CQRS from ES — the most common conflation in this area.
**✗ Weak answer.** "Yes, it gives us a full audit trail" with no cost or scope.
**↳ Follow-ups.** How do you handle a GDPR deletion request? What's your snapshot strategy at a million events?

---

### Q2 · The saga step that can't be compensated *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"Your saga has captured the payment, then inventory allocation fails. Now what?"*

**Answer.** You **compensate, you don't roll back** — and the distinction is the answer. There's no "undo the capture": the money moved, the provider has a record, and the customer has a statement line. What you do is issue a **refund**, which is a new forward transaction with its own identifier, its own failure modes and its own settlement timeline. Anyone who says "reverse the transaction" hasn't worked on payments.

The design consequence is the **pivot transaction** — the first irreversible step. Everything before it can be compensated; after it, recovery is forward-only. So the ordering rule is: push the pivot **as late as possible** in the saga. Here that means allocating inventory *before* capturing payment — authorise the card first, allocate, then capture. That single reordering removes most of the compensation problem, and proposing it rather than just handling the failure is the level signal.

Then the part that gets skipped: **compensations fail too**, and they get retried, so every compensation must be idempotent. A refund that fails needs its own retry, dead-letter path and eventually a human queue with an SLA — because at some point the correct answer is a person, and a saga with no manual path just silently strands orders. I'd also want a **timeout and liveness monitor** on the saga, since a step stuck forever is invisible without one.

**Why it lands.** Semantic reversal not undo, names the pivot and reorders to shrink it, and designs for compensation failure plus the manual path.
**✗ Weak answer.** "Roll back the transaction" or "call the payment service's undo endpoint."
**↳ Follow-ups.** What if the refund fails? How long before a stuck saga alerts?

---

### Q3 · Eventual consistency in the UI *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"We built a CQRS read model. Users complain they save something and it isn't there when the page reloads. Fix it."*

**Answer.** That's the projection lag being exposed to the user, and it's a design gap rather than a bug — the write went to the write model, the read came from a projection that hadn't caught up. Options, and I'd pick by cost. **Return the updated state from the command** so the UI renders it without re-reading — usually cleanest, removes a round trip, and solves the common case entirely. **Read-your-writes routing** — serve that session from the write model for a short window after a mutation. **A version token** the client passes so the read waits for the projection to reach it — correct, more machinery. Or **change the interaction** so it doesn't need immediacy: show the item as pending with an explicit state rather than pretending it's done.

Then the operational half: **name the staleness bound as a number** and monitor it — "p99 projection lag under 2 seconds" — because "eventually consistent" without a bound is the thing that's actually unacceptable, and an unbounded lag is how this becomes a support issue instead of a design choice. I'd alert on projection lag directly.

And the honest framing for the business: cross-read-model consistency is **explicitly not guaranteed** — two projections can disagree momentarily — so if some screen genuinely cannot tolerate that, it reads from the write model and we accept the load.

**Why it lands.** Four options with selection criteria, converts "eventual" into a monitored number, and states the cross-model guarantee that doesn't exist.
**✗ Weak answer.** "Add a delay/spinner on the client."
**↳ Follow-ups.** How do you measure projection lag? What if a projector falls hours behind?

---

### Q4 · Rebuilding a projection at scale *(Lead)* ⭐⭐⭐
**Asked as:** *"You found a bug in a projector. The event stream has 400 million events. How do you fix the read model?"*

**Answer.** The rebuild is the point of the architecture, so this should be routine rather than an incident — but at 400 million events it needs care. I'd build the corrected projection **alongside** the existing one into a new store, replaying from the beginning, while the old projection keeps serving reads. That keeps the system up and makes the cutover a routing change I can reverse.

Practicalities: the projector must be **idempotent** so a restart mid-replay is safe, and it should track its position so it can resume rather than start over. I'd replay at a controlled rate, because full-speed replay will saturate whatever the projection writes to. **Snapshots** cut the work if the projection supports them. And I'd validate before cutting over — reconcile the new projection against the old on the subset where they should agree, and against the write model on the records where they shouldn't, so I know the fix worked rather than assuming.

The part that bites: if the projector has **side effects** — sending emails, calling a downstream API — replay re-triggers all of them. So side effects must be separated from projection, or explicitly suppressed during replay. That's the thing people discover at 3am, and it's worth designing for before you need it.

**Why it lands.** Parallel build with reversible cutover, idempotency and rate control, validation before trusting, and the side-effect trap.
**✗ Weak answer.** "Truncate the read model and replay" — downtime, no validation, and fires every side effect.
**↳ Follow-ups.** How long does 400M events take, and does that matter? How do you validate the new projection?

---

### Quick-fire (30 seconds each)

- **"CQRS vs Event Sourcing?"** → Different problems that happen to pair well. CQRS separates the read model from the write model because they have different shapes; you can do it with one database and no events at all. Event Sourcing stores the sequence of events instead of current state, which makes reads expensive — which is *why* it effectively forces CQRS to give you queryable projections. So CQRS without ES is common and often right; ES without CQRS is usually a mistake.
- **"How do you publish an event when you save?"** → Not by calling the broker in the same method — that's a dual write, and if the publish fails after the commit there is no retry that can fix it because you don't know what landed. Instead the outbox: insert the business row and an outbox row in one local transaction, then a relay polls or CDCs the table and publishes, marking rows sent. That gives at-least-once delivery, so consumers dedupe on the event id.
- **"How do you roll back a distributed transaction?"** → You don't roll back, you compensate — semantic reversal, not undo. A captured payment becomes a refund; a reserved stock item becomes a release. I'd use an orchestrated saga so the state is persisted and queryable, make every step *and* every compensation idempotent because both get retried, and identify the pivot transaction — after the first irreversible step, recovery has to be forward-only.

---

**Go deeper:** `34-CQRS/`, `35-Event-Sourcing/`, `36-Saga/`, `37-Outbox/` · **Related:** [[18-Event-Driven-Architecture]], [[16-Distributed-Systems]], [[31-DDD]]
