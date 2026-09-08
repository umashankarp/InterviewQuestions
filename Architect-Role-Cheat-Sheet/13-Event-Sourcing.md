# 13. Event Sourcing — 26 Questions (Answered)

> **Method:** the pattern is defined from the **Azure Architecture Center — Event Sourcing pattern** (quoted verbatim, including its Problems-and-considerations list), with **Microsoft Learn's .NET microservices e-book** for the DDD/aggregate vocabulary, **Martin Fowler** for the original formulations, the **Apache Kafka documentation** for the log-vs-event-store comparison, and **AWS Prescriptive Guidance** for the cloud implementation. Then the architect-level analysis: what it costs, when it is wrong, and how a payments platform actually uses it. Builds on **Module 7 (EDA)** and **Module 12 Q11–Q12**. Links in **References**.

---

## Q1. What is Event Sourcing?

**Per the Azure Architecture Center:** *"Instead of storing only the current state of the data in a relational database, store the full series of actions taken on an object in an append-only store. The store acts as the system of record that you can use to materialize the domain objects."*

And the pattern page opens with an unusually blunt warning that is worth quoting because it demonstrates you have read the source rather than a blog post:

> *"Event sourcing is a complex pattern that introduces significant trade-offs. It changes how you store data, handle concurrency, evolve schemas, and query state. It's costly to migrate to or from an event sourcing solution, and after you adopt the pattern, it constrains future design decisions... For most systems and most parts of a system, traditional data management is sufficient."*

**The mechanism:**

```
CRUD:            accounts { id: A1, balance: 150 }     ← UPDATE destroys the previous value

Event-sourced:   stream "account-A1"
                   v1  AccountOpened   { currency: GBP }
                   v2  MoneyDeposited  { amount: 200 }
                   v3  MoneyWithdrawn  { amount:  50 }
                 current state = fold(events) = balance 150   ← derived, fully explained
```

**The two problems the docs say CRUD has at load, and which this addresses:**
- **Write contention** — *"updates require read-modify-write cycles with row-level locking, [so] concurrent writes to the same entity degrade performance."* Append-only writes have no such lock.
- **Auditability** — *"CRUD systems only store the latest state of the data. If you don't implement an auditing mechanism... you lose data history."*

**The core rules:**
1. Events are **immutable facts in the past tense** — `SeatsReserved`, `PaymentAuthorised`. Never `ReservePayment`; that is a command.
2. The store is **append-only**. Nothing is ever updated or deleted (Q17).
3. **Current state is derived** by replaying the stream (Q7).
4. Events capture **intent**, not just resulting state — see Q15 and the docs' event-design guidance.
5. Queries go through **projections/materialised views**, because you cannot ad-hoc query a stream (Q8).

**The critical design point the documentation makes about event design, and it is the one that separates a good implementation from a useless one:** *"an event that records 'two seats were reserved' is more valuable than an event that records 'remaining seats changed to 42'. The first event tells you what happened. The second event only tells you the resulting state. State-focused events reduce the event store to a change log that has no business meaning."*

---

## Q2. Event Sourcing vs Event-Driven Architecture?

They share the word "event" and almost nothing else. Conflating them is the most common error in this topic.

| | **Event Sourcing** | **Event-Driven Architecture** |
|---|---|---|
| **Concern** | **Persistence** — how one service stores its state | **Integration** — how services communicate |
| Scope | **Inside** a service/bounded context | **Between** services |
| Events are | The **source of truth**; the system of record | **Notifications** about something that happened |
| Event granularity | Fine-grained **domain** events (`SeatsReserved`) | Coarser **integration** events (`OrderPlaced`) |
| Retention | **Forever** — deleting one destroys the record | Bounded — hours to days, or until consumed |
| Consumers | The aggregate itself, plus projections | Other services |
| Can exist without the other? | **Yes** — you can event-source a service that publishes nothing | **Yes** — most event-driven systems use CRUD storage |

**The clearest way to say it:** *Event Sourcing is a storage pattern; EDA is a communication pattern.* A service can be event-sourced internally and expose a plain REST API. A platform can be entirely event-driven with every service storing state in a normal relational database.

**Where they meet — and this is the nuance that earns credit:** an event-sourced service naturally has events to publish, so it is a convenient EDA participant. But the docs warn against publishing your internal events directly: *"the event sourcing events are typically low level, and it might be necessary to generate specific integration events instead."*

That distinction matters enormously in practice:

| | **Domain event** (internal) | **Integration event** (published) |
|---|---|---|
| Audience | This aggregate and its projections | Other services |
| Coupling | Free to change with the domain | **A public contract** — versioned, backward-compatible |
| Granularity | Fine (`SeatsReserved`, `SeatsReleased`) | Coarse (`BookingConfirmed`) |
| Content | Whatever the domain needs | Deliberately curated |

If you publish raw domain events, **every internal refactor becomes a breaking change for every consumer** — you have coupled other teams to your aggregate's internals. The correct shape is: event-source internally, and publish a separate, curated, versioned integration event via the **transactional outbox** (Module 4 Q22).

---

## Q3. What is an Event Store?

An **event store** is the append-only database that holds event streams and serves as the **system of record**. Per the docs: *"The events persist in an event store that serves as the system of record, or the authoritative data source, about the current state of the data."*

**What it must provide:**

| Capability | Why |
|---|---|
| **Append to a stream** | The only write operation |
| **Read a stream by entity ID**, ordered, from a given version | Rehydration (Q5) |
| **Optimistic concurrency on append** (expected version) | Prevents lost updates (Q19–Q20) |
| **Read all events**, ordered, from a position | Building and rebuilding projections (Q14) |
| **Subscriptions / change feed** | Pushing new events to projections and integration |
| **Snapshots** (or the ability to store them) | Performance for long streams (Q11) |
| **Durability and immutability** | It is the record; losing an event is losing the truth |

**A minimal relational schema — worth being able to sketch, because it shows you understand the mechanics rather than just the concept:**

```sql
CREATE TABLE events (
    global_position  BIGSERIAL PRIMARY KEY,          -- total order, for projections
    stream_id        TEXT        NOT NULL,           -- e.g. 'payment-9f3a…'
    version          INT         NOT NULL,           -- per-stream sequence, from 1
    event_type       TEXT        NOT NULL,           -- 'PaymentAuthorised'
    event_version    INT         NOT NULL DEFAULT 1, -- schema version (Q15)
    data             JSONB       NOT NULL,
    metadata         JSONB       NOT NULL,           -- correlation/causation id, user, timestamp
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_stream_version UNIQUE (stream_id, version)   -- ← THE concurrency control
);
CREATE INDEX ix_events_stream ON events (stream_id, version);
```
The **unique constraint on `(stream_id, version)`** is the entire optimistic-concurrency mechanism: two concurrent appends at the same expected version, and the database rejects one (Q20).

**Store options, per the documentation:** *"An event store can be a purpose-built database designed for append-only eventstreams or a general-purpose relational or document database with an append-only table. Purpose-built event stores provide built-in support for tasks like reading a stream by entity, optimistic concurrency, and snapshots. Relational databases are familiar and widely available but require you to build those behaviors yourself."*

| Option | Notes |
|---|---|
| **PostgreSQL / SQL Server** with the table above | Familiar, ACID, operationally boring, easy to back up. **My default** unless volume demands otherwise |
| **EventStoreDB (Kurrent)** | Purpose-built: streams, subscriptions, projections, concurrency |
| **Marten** (.NET, on PostgreSQL) | Event store + document projections in one library; excellent .NET fit |
| **DynamoDB** | `PK = streamId`, `SK = version`, conditional write for concurrency; huge scale, plus Streams for projections |
| **Axon, Eventuate, Wolverine** | Framework-level event sourcing |

And the warning the docs give explicitly: *"Don't confuse an event store with an eventstream message broker. Message brokers such as Apache Kafka typically lack per-entity stream queries and optimistic concurrency."* (Q21–Q22.)

**Critically, note that partitioning is natural:** *"Because each entity has its own independent eventstream, event stores partition naturally by entity ID, which simplifies horizontal scaling or sharding."*

---

## Q4. What is an Aggregate?

An **aggregate** is a DDD concept: a **cluster of domain objects treated as a single unit for data changes**, with one entity designated the **aggregate root** — the only object outside code may hold a reference to, and through which all modifications pass.

**Per Microsoft Learn's .NET microservices guidance**, the aggregate root enforces the **invariants** of the whole cluster; external code may only reference the root, and the root is responsible for keeping every rule inside the boundary true.

**In Event Sourcing, the aggregate is doubly important because it defines three things at once:**

| The aggregate boundary is the unit of… | Meaning |
|---|---|
| **Consistency** | All invariants inside it are enforced **transactionally**. Across aggregates: eventual consistency and sagas |
| **The event stream** | One aggregate instance = one stream (`payment-9f3a…`). This is why stream design *is* aggregate design |
| **Concurrency control** | Optimistic concurrency is per stream, i.e. per aggregate (Q19) |

**A minimal event-sourced aggregate in C#:**

```csharp
public sealed class Payment
{
    private readonly List<object> _uncommitted = [];
    public PaymentId Id { get; private set; } = default!;
    public Money Amount { get; private set; } = Money.Zero;
    public PaymentStatus Status { get; private set; }
    public int Version { get; private set; }            // last applied stream version

    // ── Behaviour: validate the invariant, then RAISE an event (never mutate directly)
    public void Capture(Money amount)
    {
        if (Status != PaymentStatus.Authorised)
            throw new DomainException("Only an authorised payment can be captured.");
        if (amount > Amount)
            throw new DomainException("Capture cannot exceed the authorised amount.");

        Raise(new PaymentCaptured(Id, amount, DateTimeOffset.UtcNow));
    }

    // ── Apply: the ONLY place state changes. Must be pure and never throw.
    private void Apply(object e)
    {
        switch (e)
        {
            case PaymentAuthorised a: Id = a.Id; Amount = a.Amount; Status = PaymentStatus.Authorised; break;
            case PaymentCaptured:     Status = PaymentStatus.Captured;  break;
            case PaymentRefunded:     Status = PaymentStatus.Refunded;  break;
        }
        Version++;
    }

    private void Raise(object e) { Apply(e); _uncommitted.Add(e); }
    public IReadOnlyList<object> Uncommitted => _uncommitted;

    public static Payment Rehydrate(IEnumerable<object> history)
    {
        var p = new Payment();
        foreach (var e in history) p.Apply(e);   // no validation on replay
        return p;
    }
}
```

**The two rules that make this work, and both are commonly violated:**
1. **`Apply` never validates and never throws.** History is fact; it already happened. Validation belongs in the command method *before* the event is raised. If `Apply` can throw, a schema change or an old event can make an aggregate permanently unloadable.
2. **Keep aggregates small.** A large aggregate means a long stream, expensive rehydration, and a wide concurrency-conflict surface. If two operations never need to be transactionally consistent, they belong in **different** aggregates coordinated by a saga (Module 4 Q18).

---

## Q5. What is Aggregate rehydration?

**Per the docs:** *"Applications derive the current state of an entity by replaying all the events in its stream. This process is known as rehydration. It can occur on demand when the application handles a request."*

**The sequence, which is also the command-handling sequence:**

```
1. Command arrives:            CapturePayment(id, amount)
2. Load the stream:            SELECT * FROM events WHERE stream_id='payment-9f3a' ORDER BY version
3. Fold:                       aggregate = events.Aggregate(new Payment(), (a,e) => a.Apply(e))
4. Execute business logic:     aggregate.Capture(amount)   ← validates the invariant, raises the event
5. Append with expected version: INSERT … version = 4  (fails if someone else appended)
6. Publish / project
```

```csharp
public async Task Handle(CapturePayment cmd, CancellationToken ct)
{
    var (history, version) = await _store.ReadStreamAsync($"payment-{cmd.Id}", ct);
    var payment = Payment.Rehydrate(history);          // steps 2–3

    payment.Capture(cmd.Amount);                        // step 4

    await _store.AppendAsync($"payment-{cmd.Id}",
        payment.Uncommitted, expectedVersion: version, ct);   // step 5 — concurrency check
}
```

**Its cost, and why it is usually acceptable:** rehydration is `O(number of events in the stream)`. For a payment with 5–20 events this is a single indexed read of a handful of rows and a fold — microseconds, and cheaper than the equivalent multi-table relational load. For a long-lived aggregate — an account open for ten years with 200,000 events — it becomes a genuine problem, which is what **snapshots** exist to solve (Q11).

**Optimisations, in order of preference:**
1. **Design small, short-lived aggregates.** The best fix is not needing it. Close streams at natural boundaries: an `account-A1-2026` stream per year rather than one forever; a payment stream that ends when the payment settles.
2. **Snapshots** every N events (Q11).
3. **Cache the rehydrated aggregate** in memory keyed by ID and version — safe because the version check on append still protects correctness. This is what an actor model (Orleans, Akka) gives you naturally, and it makes rehydration a non-issue for hot aggregates.

**The important reassurance to give a panel:** rehydration is a **write-path** cost, not a read-path one. Queries go to projections (Q8) and never rehydrate. Since writes are typically a small fraction of traffic, the cost lands where there is the most headroom.

---

## Q6. What is an event stream?

An **event stream** is the **ordered, append-only sequence of events belonging to one aggregate instance**. Per the docs: *"Each entity in an event-sourced system has its own eventstream, which is the ordered sequence of events that records every change to that entity."*

```
stream: "payment-9f3a2c"
 ┌────┬───────────────────────┬──────────────────────────────────┐
 │ v1 │ PaymentInitiated      │ { amount: 4999, currency: "GBP" }│
 │ v2 │ FraudCheckPassed      │ { score: 12 }                    │
 │ v3 │ PaymentAuthorised     │ { authCode: "A7X2", provider…}   │
 │ v4 │ PaymentCaptured       │ { amount: 4999 }                 │
 │ v5 │ PaymentSettled        │ { settlementDate: "2026-09-09" } │
 └────┴───────────────────────┴──────────────────────────────────┘
```

**Two orderings exist and the distinction matters:**

| Ordering | Guarantee | Used for |
|---|---|---|
| **Per-stream `version`** | **Strictly ordered, gapless**, starting at 1 | Rehydration; optimistic concurrency |
| **Global position** | A total order across all streams | Projections and subscriptions reading "everything since position X" |

Per-stream ordering is a hard guarantee — it must be, or state is wrong. Global ordering is a convenience for projections and, in a distributed store, may be approximate; a projection must therefore be **idempotent** and track its position, not assume perfect global order.

**Stream naming and design** — this is the design decision, and it is the same decision as aggregate design:
- `<aggregate-type>-<id>`: `payment-9f3a2c`, `account-GB12ABCD`.
- **One stream per aggregate instance.** Not one per type (that stream would be infinite and useless for rehydration), not one per event type.
- **Bound the lifetime** where the domain allows. An account that lives forever produces an unbounded stream; a common technique is a **closing event** plus a new stream (`account-A1-2027` opening with `PeriodOpened { balance }`), which caps rehydration cost permanently and matches how accounting periods actually work.

**Event metadata that every event should carry** — and this is the part that makes an event store operationally useful rather than merely correct:
```json
{
  "eventId":      "…",              // for consumer idempotency
  "correlationId":"…",              // the whole business transaction, across services
  "causationId":  "…",              // the specific message that caused THIS event
  "userId":       "…", 
  "occurredAt":   "2026-09-08T10:14:22Z",
  "schemaVersion": 2
}
```
`correlationId` and `causationId` together let you reconstruct the full causal chain of a business transaction across services — which is exactly what an incident review and a regulator both ask for.

---

## Q7. How do you calculate current state?

**By folding the event stream through a pure `Apply` function** — a left fold from the initial state:

```
state = events.Aggregate(initialState, (acc, e) => Apply(acc, e))
```

```csharp
var balance = events.Aggregate(Money.Zero, (acc, e) => e switch
{
    MoneyDeposited d  => acc + d.Amount,
    MoneyWithdrawn w  => acc - w.Amount,
    InterestApplied i => acc + i.Amount,
    _                 => acc                     // events that don't affect balance
});
```

**Three places state is calculated, and they are different code paths with different rules:**

| Where | How | Used for |
|---|---|---|
| **Write side — rehydration** | Fold the full stream (or snapshot + tail) into the aggregate | Enforcing invariants before appending a new event |
| **Read side — projection** | Fold events **incrementally** into a stored read model as they arrive | Serving queries (Q8) |
| **Ad hoc — replay to a point in time** | Fold only events up to a timestamp or version | *"What was this balance on 30 June?"* — audit, dispute, regulatory |

That third one is Event Sourcing's signature capability, and it is worth stating explicitly: **temporal queries are free**, because the data required to answer them was never discarded. In a CRUD system the answer does not exist at any price.

**The rules for `Apply`, restated because they are load-bearing:**
- **Pure**: no I/O, no clock, no random, no calls to other services. Same events in → same state out, always. If `Apply` calls an external service, replay is no longer deterministic and your event store no longer reconstructs the truth.
- **Total**: it must handle every event type it might encounter, including old versions (via upcasting — Q16) and unknown ones (ignore rather than throw).
- **Non-validating**: history cannot be rejected (Q4).

**Performance:** for the write side, snapshots bound the cost (Q11). For the read side, **never** fold on demand to answer a query — that is what projections are for, and doing it on demand is the single most common performance mistake in an event-sourced system.

---

## Q8. What is a projection?

**Per the docs:** *"Applications typically implement materialized views because it's costly to read and replay events. Materialized views are read-only projections of the event store that are optimized for querying."*

A **projection** is a process that consumes events, in order, and maintains a derived **read model** shaped for a specific query.

```
                        ┌──▶ Projection: payment_summary ──▶ PostgreSQL table
Event store ──stream──▶ ├──▶ Projection: merchant_daily   ──▶ pre-aggregated totals
(source of truth)       ├──▶ Projection: search_index     ──▶ OpenSearch
                        └──▶ Projection: fraud_features   ──▶ Redis / feature store
```

```csharp
// A projection handler: incremental, idempotent, and it tracks its position
public async Task On(PaymentCaptured e, long position, CancellationToken ct)
{
    await _db.ExecuteAsync("""
        INSERT INTO payment_summary (payment_id, status, captured_amount, updated_at)
        VALUES (@Id, 'Captured', @Amount, @At)
        ON CONFLICT (payment_id) DO UPDATE
          SET status = 'Captured', captured_amount = @Amount, updated_at = @At
        """, new { e.Id, e.Amount, At = e.OccurredAt });

    await _checkpoints.SaveAsync("payment_summary", position, ct);   // ← essential
}
```

**Properties a projection must have:**

| Property | Why |
|---|---|
| **Idempotent** | Delivery is at-least-once; the docs list idempotency as a requirement: *"Event handlers must be idempotent so processing a duplicate event doesn't change the outcome."* Use upserts or track the last processed sequence per stream |
| **Checkpointed** | It must record its position so it can resume after a restart, and so lag is measurable |
| **Rebuildable** | Delete and replay from position 0 must reproduce it exactly (Q14) |
| **Disposable** | A read model is **derived data**, never a source of truth. Losing one is an inconvenience, not a data loss |
| **Ordered per stream** | Applying `PaymentCaptured` before `PaymentAuthorised` corrupts the model |

**Two kinds worth distinguishing:**
- **Inline/synchronous** — updated in the same transaction as the append. Strongly consistent, but couples write availability to projection availability and doesn't scale to many projections.
- **Asynchronous** (the normal case) — a subscriber updates the read model shortly after. **Eventually consistent**, independently scalable, and each projection can fail and be rebuilt without affecting writes.

**The mental model to state:** a projection is a **cache of a query, derived from the log, that you can always regenerate**. That regenerability is what makes read-model design low-risk: you can add a new projection tomorrow, over five years of history, without touching the write side — which is a capability no CRUD system has.

---

## Q9. Why do you need read models?

Because **you cannot query an event store**. The docs are explicit: *"There's no standard approach or existing mechanisms, such as SQL queries, for reading events to obtain information. The only data that you can extract is a stream of events by using an event identifier as the criteria."*

**The problem, concretely.** "Show all payments over £1,000 for merchant M that failed fraud checks last week" cannot be answered from an event store — that would mean loading every stream, folding each one, and filtering in memory. Over millions of streams that is not slow, it is impossible.

**Read models solve four separate problems:**

| Problem | How a read model fixes it |
|---|---|
| **Queryability** | Real indexes, `WHERE`, `JOIN`, `ORDER BY`, aggregation — in whatever store suits |
| **Performance** | One indexed row read vs replaying thousands of events. Orders of magnitude |
| **Shape** | Each model is built for one query, so no compromise model serving everything badly |
| **Scale** | Reads scale independently and cannot slow the write path (Module 12 Q9) |

**Multiple, purpose-built models over the same events is the point, not a compromise:**

| Read model | Store | Serves |
|---|---|---|
| `payment_summary` | PostgreSQL | The payment-detail screen |
| `merchant_daily_totals` | PostgreSQL (pre-aggregated) | Merchant dashboards |
| `payment_search` | OpenSearch | Operations full-text search |
| `balance_by_account` | Redis | Hot balance reads |
| `regulatory_extract` | S3 + Athena | Reporting and analytics |

Each is **independently rebuildable, independently scalable, and independently disposable**. Adding a sixth next quarter requires no change to the write model at all — you replay history into a new projection. That is the capability that pays for the pattern's complexity.

**The trade-off to state plainly:** every read model is **eventually consistent**. The docs: *"The system is only eventually consistent when it creates materialized views or generates projections of data by replaying events... Ensure that your customers understand that data is eventually consistent."* In practice the lag is milliseconds to seconds, but it is not zero, and the UX must account for it — for example, by rendering the result of the command the user just issued rather than re-querying a projection that may not have caught up.

---

## Q10. How does Event Sourcing work with CQRS?

They fit together so naturally that they are frequently confused — but each is usable alone (Module 12 Q8, Q11). Per the docs: *"Event sourcing is commonly combined with the CQRS pattern by performing the data management tasks in response to the events and by materializing views from the stored events. Use this combination to independently scale reads and writes because append-only event ingestion and query-optimized projections operate separately."*

```
                    WRITE SIDE                              READ SIDE
  Command ──▶ Command handler                         Query ──▶ Read model
                 │                                                ▲
                 │ 1. rehydrate from stream                       │
                 ▼                                                │
             Aggregate ── raises events ──▶ EVENT STORE ──────────┘
             (invariants)                   (source of truth)   projections
                                                  │
                                                  └──▶ outbox ──▶ integration events
```

**Why the fit is so good:** CQRS's hardest practical question is *"how do the read models stay in sync with the write model?"* Options are dual writes (broken), CDC (works, but couples you to the schema), or... publishing events. Event Sourcing means **the events already exist as first-class, ordered, durable facts** — the synchronisation mechanism is the storage mechanism. Nothing extra to build, nothing to drift.

**The division of responsibility:**

| | **Write side** | **Read side** |
|---|---|---|
| Model | Aggregates enforcing invariants | Flat, denormalised DTOs |
| Store | Event store | Any store, per query |
| Consistency | **Strong** within an aggregate | **Eventual** |
| Scaling | By aggregate/stream partitioning | Independently, per model |
| Optimised for | Correctness | Query performance |

**Three implementation details that matter:**

1. **Don't couple them synchronously by default.** Updating projections inline with the append makes writes fail when a projection fails. Async subscription with checkpointing is the normal design.
2. **Handle read-your-own-writes explicitly.** After a command, the user's next read may hit a stale projection. Options: return the result from the command, poll with a version token until the projection catches up, or read that one query from the write side. Choose deliberately and per screen; in a payments UI, "I paid and nothing changed" is a support ticket.
3. **Monitor projection lag as a first-class SLO.** Lag is the direct measure of how stale your entire read surface is. Alert on the trend.

**The honest framing:** ES+CQRS together is the **highest-complexity, highest-capability** combination in this catalogue. It buys a complete audit trail, temporal queries, independently optimised read models and replayable history. It costs event versioning, projection infrastructure, eventual consistency and a steep team learning curve. Apply it to the **core domain** — the ledger, the payment lifecycle — and use plain CRUD everywhere else, exactly as the documentation advises: *"Event sourcing doesn't have to be an all-or-nothing decision for your entire system."*

---

## Q11. What are snapshots?

**Per the docs:** *"A snapshot is a serialized representation of the entity's state at a specific point in its eventstream. To rehydrate the entity, load the most recent snapshot and replay only the events that occur after it, rather than replaying the entire stream from the beginning."*

```
stream: account-A1   (187,432 events)

WITHOUT snapshot:  replay ALL 187,432 events            → seconds; unacceptable
WITH snapshot:     load snapshot @ v187,000 (1 read)
                   replay events 187,001 → 187,432       → 432 events; milliseconds
```

```csharp
public sealed record AccountSnapshot(string StreamId, int Version, Money Balance, AccountStatus Status);

public async Task<Account> LoadAsync(string streamId, CancellationToken ct)
{
    var snap = await _snapshots.GetLatestAsync(streamId, ct);
    var from = snap?.Version ?? 0;
    var tail = await _store.ReadStreamAsync(streamId, fromVersion: from + 1, ct);

    var account = snap is null ? new Account() : Account.FromSnapshot(snap);
    foreach (var e in tail) account.Apply(e);
    return account;
}
```

**Design decisions:**
- **Frequency.** The docs: *"When you choose a snapshot frequency, balance the storage cost of snapshots against the time saved during rehydration."* Every N events (100–1,000 is typical) or on a time interval. Take it **asynchronously**, off the command path, so snapshotting never slows a write.
- **Keep the latest few**, not all — they are regenerable.
- **Snapshots are versioned too.** When the aggregate's shape changes, old snapshots may not deserialise. Store a snapshot schema version and, on mismatch, **discard the snapshot and replay from zero**. That is always safe, and it is the reason the next point holds.

**The rule the documentation states and which candidates most often get wrong:**

> *"Snapshots are an optimization, not a replacement for the eventstream. The eventstream remains the source of truth, and you can regenerate snapshots from it at any time."*

You must be able to **delete every snapshot** and have the system work — slower, but correct. If deleting snapshots breaks the system, they have become a second source of truth and you have lost the pattern's central guarantee. Test this: a rebuild-from-zero drill belongs in your runbook alongside the projection rebuild (Q14).

---

## Q12. Why are snapshots needed?

**Because rehydration cost grows linearly with stream length, and some streams grow without bound.**

**The arithmetic that makes the case:**

| Stream length | Events to replay | Rehydration time (rough) | Verdict |
|---|---|---|---|
| 10 | 10 | < 1 ms | Fine — no snapshot needed |
| 1,000 | 1,000 | ~5–20 ms | Noticeable on a hot write path |
| 100,000 | 100,000 | **~1–5 s** | Unusable |
| 1,000,000 | 1,000,000 | **tens of seconds** | The service is down |

And this cost is paid on **every command** against that aggregate, so a busy long-lived aggregate degrades continuously. Worse, the degradation is **gradual and invisible in testing** — a test database has short streams, so the system passes every test and slowly dies in production over months. That characteristic (silent, gradual, load-correlated) is exactly the anti-pattern profile the Azure catalogue describes.

**Snapshots turn `O(stream length)` into `O(events since snapshot)`** — a constant bounded by your snapshot interval.

**But the better answer is to question the stream length first**, and saying this marks a stronger candidate:

1. **Is the aggregate too big?** A 200,000-event stream often means the aggregate boundary is wrong — it is accumulating things that don't share invariants. Splitting it is a better fix than snapshotting it.
2. **Can the stream be closed?** Most long-lived business entities have natural periods. An account can emit `AccountingPeriodClosed { closingBalance }` and start a new stream — a domain-meaningful snapshot that also matches how the business already thinks. This is usually the most elegant answer and it is worth proposing before the technical one.
3. **Is the aggregate genuinely long-lived and unbounded?** Then snapshot it.

**When snapshots are definitely needed:** long-lived financial accounts, positions, insurance policies, IoT device state, and any aggregate with high write frequency over years.
**When they are not:** short-lived process aggregates — a payment, an order, a booking — which have tens of events and a natural end. Adding snapshots there is complexity with no payoff.

---

## Q13. What happens if a projection fails?

**Nothing is lost** — and that is the pattern's most valuable operational property. The event store is the source of truth; a projection is derived data. A failed projection means **stale reads**, not corrupted state.

**Failure modes and the correct response to each:**

| Failure | Symptom | Response |
|---|---|---|
| **Transient** (DB timeout, network) | Lag briefly rises | Retry with backoff and jitter; it self-heals |
| **Poison event** — a handler throws on one specific event | Projection **stops at that position**; lag grows without bound | Fix the handler and resume, or route the event to a DLQ/quarantine and continue. **Never silently skip it** — that leaves the model permanently wrong |
| **Projection bug** — it processed events but computed the wrong result | Read model is wrong; **no error anywhere** | Fix the code and **rebuild** (Q14). This is the case snapshots and rebuilds exist for |
| **Read store lost** (dropped table, corrupted index, deleted cluster) | Model gone | **Rebuild from position 0** |
| **Slow projection** — it cannot keep up with the event rate | Lag grows steadily | Batch writes, parallelise by stream (preserving per-stream order), or scale the read store |

**The critical design decision: stop, or skip?** When a projection hits an event it cannot process, it must **halt at that position** rather than skip ahead. Skipping produces a read model that is quietly, permanently wrong with no error — the worst possible outcome in a financial system. Halting produces stale data with a loud alarm, which is recoverable. Make halting the default and quarantining an explicit, logged decision.

**What you must have in place before this happens:**
- **Checkpoint per projection**, persisted, so it resumes exactly where it stopped.
- **Lag metric and alert** per projection — this is the primary health signal. Alert on the trend, not an absolute number.
- **A tested rebuild procedure** (Q14) — untested rebuilds fail at exactly the moment you need them.
- **Idempotent handlers**, so replaying overlapping events after a crash is harmless.
- **Isolation between projections.** One projection failing must not stop the others; each has its own subscription and checkpoint.

**Degradation strategy:** if a critical read model is stale, decide in advance what the application does — serve stale with a "last updated" indicator, fall back to reading the write side for that specific query, or fail the query explicitly. In a payments UI, showing a **stale balance with no indication** is worse than showing an error, because the user acts on it.

---

## Q14. How do you rebuild a projection?

Rebuilding is a **routine operation**, not an emergency one — you will do it whenever you fix a projection bug, change a read-model shape, or add a new read model over historical data. It must be practised.

**The procedure:**

```
1. Create a NEW read model (versioned name):  payment_summary_v3
2. Reset a checkpoint for it to position 0
3. Replay the ENTIRE event store from the beginning into it
4. Monitor progress; verify correctness against a sample and against the old model
5. Atomically switch reads to v3  (a view, an alias, or a config flag)
6. Keep v2 for a rollback window, then drop it
```

**Why build a new model rather than truncating the existing one:** the old model keeps serving traffic throughout the rebuild. Truncate-and-replay means an outage for however long the replay takes — which for millions of events is not a few seconds. The blue/green shape here is the same one you use for deployments, and for the same reason.

```csharp
public async Task RebuildAsync(string projection, CancellationToken ct)
{
    await _readStore.CreateAsync($"{projection}_v3", ct);
    long position = 0;
    while (!ct.IsCancellationRequested)
    {
        var batch = await _store.ReadAllAsync(from: position, count: 5_000, ct);
        if (batch.Count == 0) break;
        await _handler.ApplyBatchAsync($"{projection}_v3", batch, ct);   // batch the writes
        position = batch[^1].GlobalPosition;
        await _checkpoints.SaveAsync($"{projection}_v3", position, ct);
    }
}
```

**Making it fast enough to be practical:**
- **Batch the writes** — one round trip per 1,000–5,000 events, not per event. This is usually a 10–50× difference and is the single biggest factor.
- **Parallelise by stream** where the model permits (per-stream order must hold; cross-stream order usually need not).
- **Disable indexes during the bulk load**, rebuild them after.
- **Read from a replica** of the event store so the rebuild doesn't compete with production writes.
- **Skip events the projection ignores** with a server-side type filter.

**Catching up to live:** after the historical replay, the projection continues from its checkpoint into the live subscription. Because handlers are idempotent, a small overlap is harmless — which is why idempotency (Q8) is what makes rebuilds safe.

**Operational discipline that turns this from theory into capability:**
- **Measure and publish the full-rebuild time.** "It takes 40 minutes to rebuild every projection from 5 years of history" is a number your incident commander needs *before* the incident.
- **Rebuild in a non-production environment regularly**, ideally in CI on a sample, so a change that breaks replay is caught by the pull request.
- **Version projection names** so rollback is a config change.
- If full rebuild time becomes unacceptable, **archive or fold old events** into a period-closing event (Q12) rather than accepting an unbounded replay.

---

## Q15. How do you version events?

**Events are permanent, so their schemas are a permanent obligation.** An event written today must be readable in ten years — the docs put it plainly: *"The event store is the permanent source of information, so you should never update the event data."* This is the single largest ongoing cost of the pattern and the question separates people who have run an event-sourced system from people who have read about one.

**The four strategies the documentation names, and they compose:**

| Strategy | How | Handles |
|---|---|---|
| **Tolerant deserialization** | *"Design event consumers to ignore unknown fields and use default values for missing fields."* | **Additive, non-breaking** changes — a new optional field. Costs nothing, handles most cases |
| **Event versioning** | *"Include a version identifier in each event, either as metadata in the event envelope or as part of the event type name."* Consumers select handling logic by version | Breaking changes, with explicit branching |
| **Upcasting** | *"Register transformation functions that convert older event schemas to the current schema during deserialization."* Chain them so application code only handles the latest version | Breaking changes, **cleanly** — the store stays immutable |
| **In-place migration** | Rewrite historical events in the store | The docs: *"breaks immutability and should be a last resort because it undermines the audit trail"* |

**Upcasting is the technique to know**, because it gives you a clean codebase without violating immutability:

```csharp
// v1 stored:  { "amount": 4999 }                 (implicitly GBP)
// v2 current: { "amount": 4999, "currency": "GBP" }
public sealed class PaymentAuthorisedUpcaster : IUpcaster
{
    public int FromVersion => 1;
    public JsonNode Upcast(JsonNode v1)
    {
        v1["currency"] ??= "GBP";     // the historical implicit default
        return v1;                     // now shaped as v2
    }
}
// Chain v1→v2→v3 so the aggregate's Apply() only ever sees the current shape.
```

**Naming conventions:** either put the version in the type name (`PaymentAuthorised_v2`) or in envelope metadata (`schemaVersion: 2`). Metadata is cleaner — the type name stays stable and readable, and the upcaster pipeline keys off the number.

**The rules that keep this manageable:**
1. **Prefer additive changes.** Add optional fields; never rename, never change a type, never repurpose a field's meaning. A silently repurposed field is unrecoverable because old and new events look identical.
2. **A genuinely breaking change is a new event type**, not a new version of the old one. `PaymentAuthorised` → `PaymentAuthorisedWithFx`, with the aggregate handling both forever.
3. **Never delete an event type from the code.** Even if nothing emits it any more, history contains it and `Apply` must still handle it.
4. **Test replay against real historical events** in CI — a fixture of every event version ever emitted, replayed on every build. This is the regression test that makes versioning safe, and almost nobody has it.
5. **Design events well the first time** — capture intent, not state (Q1), and include the data a future reader needs. A poorly designed event is a permanent liability.

---

## Q16. How do you handle schema evolution?

Q15 covers event-payload versioning; schema evolution is the broader problem of the whole system changing while immutable history stays fixed. Four surfaces evolve, each with a different answer:

**1. Event payload schema** — tolerant deserialisation, versioning, upcasting (Q15). The docs note the real difficulty: *"if a bug produces incorrect events, those events persist in the store. Fixing the bug in application code doesn't fix the historical events, so you might also need compensating events or upcasters to handle the bad data during replay."*

**2. Aggregate shape.** The aggregate's in-memory model changes freely — it is derived, not stored. What must not break is `Apply`: it must remain **total** over every event version in history. Practically: keep old `case` branches, add new ones, never remove. And discard incompatible snapshots rather than trying to migrate them (Q11).

**3. Read models.** These are the easy case, and it is worth saying so: read models are **derived and disposable**, so schema evolution is just **rebuild with the new shape** (Q14). No migration script, no backfill, no downtime if you use the versioned blue/green rebuild. This is one of Event Sourcing's genuine day-to-day benefits.

**4. Integration events** (published to other services). These are a **public contract** and must follow normal contract-evolution rules: additive-only within a version, a new topic or a version field for breaking changes, a schema registry with compatibility enforcement (Module 7), and a deprecation window with consumer migration. **Never let internal event evolution force a contract change on other teams** — which is precisely why domain events and integration events must be separate types (Q2).

**A worked example — splitting a field:**

```
v1: PaymentAuthorised { amount: 4999 }                        // minor units, GBP assumed
v2: PaymentAuthorised { amount: 4999, currency: "GBP" }       // additive → tolerant read + upcaster
v3: PaymentAuthorised { money: { amount: 4999, currency: "GBP" } }   // structural → upcaster v2→v3
```
Old events stay untouched. The upcaster chain presents v3 to `Apply`. The read models are rebuilt to expose whatever shape the API needs. No history is rewritten, and the audit trail is intact.

**Governance that makes this sustainable in a bank:**
- **An event catalogue** — every event type, every version, its owner, its consumers.
- **Schema compatibility checks in CI** — a build fails if a change is not backward-compatible.
- **A replay regression test** over historical fixtures.
- **An explicit deprecation policy** for integration events, with a stated notice period.

**And the strategic point:** the cost of schema evolution scales with the number of event types and the length of history. **Fewer, well-designed, intent-revealing events age far better than many fine-grained ones.** Event design is a long-term commitment — that is the real reason the documentation warns that the pattern *"constrains future design decisions."*

---

## Q17. Can historical events be modified?

**No. Never.** This is the pattern's foundational constraint, not a convention. Per the docs: *"The event store is the permanent source of information, so you should never update the event data. The only way to update an entity or undo a change is to add a compensating event to the event store."*

**Why immutability is non-negotiable:**
1. **It is the audit trail.** A mutable audit trail is not an audit trail. In a regulated environment (SOX, MiFID II, FINRA record-keeping), the ability to alter history destroys the control's entire value — and the control is often the reason you chose the pattern.
2. **Events are statements of historical fact.** `PaymentAuthorised` on 3 September either happened or it did not. You cannot un-happen it; you can only record a subsequent fact.
3. **Determinism.** Every projection, snapshot and rebuild is a function of the event stream. Change an event and every derived artefact silently becomes inconsistent with everything computed before the change — including reports already filed.
4. **Concurrency and ordering** depend on stable, gapless per-stream versions.

**What you do instead — a compensating event.** The docs: *"A compensating event is a new event that reverses or corrects the effect of a previous event. For example, a `ReservationCanceled` event compensates for a prior `SeatsReserved` event. The original event remains in the stream, and the compensating event records that it was undone."*

```
v3  PaymentCaptured        { amount: 4999 }        ← wrong; should have been 4,899
v4  PaymentAmountCorrected { from: 4999, to: 4899,
                             reason: "Operator entry error, ticket OPS-1421",
                             correctedBy: "u.pandey", approvedBy: "…" }
```
Both events remain. The current state is correct, **and the correction itself is auditable** — who changed it, when, why, and who approved it. That is a strictly better outcome than an `UPDATE`, and it is exactly what an auditor wants to see. This is also why financial systems have always worked this way: **you do not erase a ledger entry, you post a reversal**.

**The narrow, exceptional cases where the store is touched:**
- **GDPR erasure** (Q18) — handled by crypto-shredding, not deletion.
- **In-place migration** during a major schema change — which the docs call a **last resort** that *"undermines the audit trail"*. If you do it, do it as a controlled, approved, logged migration with the original preserved.

**The design consequence to state:** because events are permanent, an **event is a more serious artefact than a database row**. Review event definitions the way you review a public API contract, because that is what they are — a contract with your own future, for the life of the system.

---

## Q18. How do you correct bad historical data?

Not by editing history (Q17), but by **appending corrections** — with the technique chosen according to what went wrong.

**Case 1 — a business mistake (the data was recorded as intended, but the intent was wrong).**
Append a **compensating or correcting event** with full context:
```
v7  RefundIssued           { amount: 5000 }
v8  RefundCorrected        { from: 5000, to: 4500, reason: "…", ticket: "…", approvedBy: "…" }
```
This is the normal path and it should be a first-class, modelled part of the domain — a `PaymentAdjusted` or `LedgerEntryReversed` event, with its own authorisation rules, not an ad-hoc fix. In a bank, corrections have their own approval workflow; the event should carry that evidence.

**Case 2 — a software bug produced wrong events.**
Both the events and everything derived from them are wrong. The sequence:
1. **Fix the code** and deploy, so no further bad events are produced.
2. **Quantify the blast radius** — which streams, which period, how many.
3. **Append correcting events** for the affected streams, generated by a reviewed, audited script that itself emits a record of what it did.
4. **Rebuild the projections** (Q14) so read models reflect the corrections.
5. If the events are unreadable rather than merely wrong, an **upcaster** can normalise them at read time — which fixes derived state without touching the store.

**Case 3 — a projection bug (the events are correct; the read model is wrong).** The easiest case, and worth calling out because candidates often assume the worst: the source of truth was never damaged. **Fix the handler and rebuild.** No compensating events, no data loss, no audit implications.

**Case 4 — GDPR / right-to-be-forgotten**, where immutability and law genuinely conflict. The docs give two approaches:
- **Keep personal data outside the event store** and reference it by identifier: *"This approach allows deletion to occur independently without affecting the eventstream."* This is the cleaner design and should be chosen up front — events carry a `customerRef`, and the PII lives in a separate store that supports deletion.
- **Crypto-shredding** where separation isn't possible: *"Encrypt personal data in events by using a per-subject key. Delete the key to render the data unrecoverable while leaving the event structure intact."* The docs also note the cost: *"This approach adds encryption overhead on every read and write and requires robust key management."*

**The governance wrapper for any correction in a financial system:** a ticket, a documented reason, four-eyes approval, a dry run against a copy, the correction script itself version-controlled and reviewed, correction events carrying `correctedBy`/`approvedBy`/`reason`, projections rebuilt and reconciled, and the whole thing evidenced for audit. **The correction is itself a business event with a business process** — which is exactly the mindset an event-sourced system makes natural and a CRUD system makes optional.

---

## Q19. What is optimistic concurrency?

**Optimistic concurrency control** assumes conflicts are rare: instead of locking, you **read a version, do the work, and on write assert the version has not changed**. If it has, the write is rejected and the caller retries.

**Per the docs**, this is exactly how event stores prevent lost updates: *"Event stores address this scenario by using optimistic concurrency control and reject an append if the stream changed since it was read. Upon rejection, the handler reloads the entity, reevaluates, and retries."*

**The problem it solves — and note this is a correctness problem, not a performance one:**

```
Handler A: read stream (version 5) → sees 5 seats free → decides to reserve 3
Handler B: read stream (version 5) → sees 5 seats free → decides to reserve 4
Both append.  Without a version check: 7 seats reserved out of 5.
```
The docs describe precisely this: *"each handler sees five remaining seats, and both handlers can accept a reservation."*

**The mechanism:**

```
Handler A: append expectedVersion = 5 → succeeds, stream is now at 6
Handler B: append expectedVersion = 5 → REJECTED (stream is at 6)
           → reload (now sees 2 seats free) → re-evaluate → reject or retry
```
Implemented by the unique constraint on `(stream_id, version)` (Q3), a DynamoDB conditional write, or the store's native `expectedVersion` parameter.

**Optimistic vs pessimistic:**

| | **Optimistic** | **Pessimistic** |
|---|---|---|
| Assumes | Conflicts are **rare** | Conflicts are **likely** |
| Mechanism | Version check at write | Lock at read |
| Cost when no conflict | **Nothing** | Lock acquisition, held for the whole operation |
| Cost when conflict | Retry the whole operation | Waiting |
| Deadlock possible | **No** | Yes |
| Scales to distributed | **Yes** | Poorly — distributed locks are a design smell |
| Right for | High-read, low-contention (most systems) | Genuinely high-contention hot rows |

**Why it is the natural fit for Event Sourcing:** appends are the only write, they are single-row inserts, and the version is already an intrinsic part of the model. There is nothing to lock, and no read-modify-write cycle to protect — which is precisely the write-contention problem the docs cite as a CRUD limitation.

**The retry rule that matters:** on conflict you must **reload and re-evaluate the business decision**, not blindly re-append. The second reservation might now be invalid. Retrying the *append* is wrong; retrying the *command* is right. Bound the retries (3 is typical) and surface a clear conflict error beyond that.

---

## Q20. How do you prevent concurrent aggregate updates?

**Within one aggregate — the version check on append.** That is the whole mechanism (Q19), and it is sufficient because the aggregate is the consistency boundary (Q4).

```csharp
public async Task<Result> Handle(CapturePayment cmd, CancellationToken ct)
{
    for (var attempt = 0; attempt < 3; attempt++)
    {
        var (history, version) = await _store.ReadStreamAsync($"payment-{cmd.Id}", ct);
        var payment = Payment.Rehydrate(history);

        payment.Capture(cmd.Amount);            // re-evaluated on every attempt

        try
        {
            await _store.AppendAsync($"payment-{cmd.Id}", payment.Uncommitted, version, ct);
            return Result.Ok();
        }
        catch (ConcurrencyException) { /* someone else appended — reload and re-decide */ }
    }
    return Result.Conflict("Concurrent modification; please retry.");
}
```

**Reducing conflicts rather than handling them, in order of preference:**

1. **Design the aggregate small and the stream hot-spot-free.** Most concurrency conflicts are a symptom of an aggregate that is too coarse — a `Merchant` aggregate that every payment touches will conflict constantly, whereas a per-`Payment` aggregate rarely will. **This is the real fix and it is a modelling decision, not a technical one.**
2. **Make commands additive where the domain allows.** `SeatsReserved { count: 2 }` composes; `RemainingSeatsSet { 42 }` does not. Intent-based events (Q1) conflict far less than state-based ones — this is another payoff of the docs' event-design guidance.
3. **Serialise per aggregate at the transport layer.** Partition the command queue by aggregate ID (Kafka key = stream ID, or SQS FIFO `MessageGroupId` = aggregate ID) so commands for one aggregate are processed by one consumer, in order. This eliminates most conflicts before they reach the store and is the standard high-throughput answer.
4. **Single-writer per aggregate** via an actor model — Orleans grains or Akka actors keyed by aggregate ID. The aggregate stays in memory, commands queue against it, and conflicts vanish entirely. Costs a distributed runtime; buys the strongest guarantee and removes rehydration cost too.

**Across aggregates, there is no locking — and this is the important architectural point.** The docs: *"Optimistic concurrency control prevents conflicting writes to the same eventstream, but the application must still handle conflicts that span multiple entities... Design the system to reconcile these situations, such as by advising the customer or by creating a back order."*

So a business operation spanning several aggregates is **eventually consistent** and coordinated by a **saga with compensations** (Module 4 Q18–Q21) — never by a distributed transaction. If you find yourself needing atomicity across two aggregates, that is strong evidence the boundary is wrong and they should be one aggregate — or that the business rule can tolerate compensation, which it usually can. In payments, that is exactly how it works in reality: you do not lock the merchant and the customer and the ledger; you authorise, then capture, then settle, with reversals available at each step.

---

## Q21. Event Store vs Kafka?

The documentation is unusually direct about this, and quoting it is the fastest way to answer:

> *"Don't confuse an event store with an eventstream message broker. Message brokers such as Apache Kafka typically lack per-entity stream queries and optimistic concurrency. They work well as a distribution layer to fan out events to projections and external consumers, but they aren't a substitute for an event store."*

| | **Event Store** | **Apache Kafka** |
|---|---|---|
| Purpose | **System of record** for aggregate state | **Distribution** of events between systems |
| Unit | **Stream per entity** (millions of small streams) | **Topic with partitions** (few topics, many keys) |
| Read pattern | *"Give me all events for `payment-9f3a`, from version 12"* | *"Give me the next records from partition 4"* |
| **Per-entity query** | **Native and indexed** | **Not supported** — you would scan the partition |
| **Optimistic concurrency** | **Native** (`expectedVersion`) | **None** — no conditional append |
| Retention | **Forever** — it is the truth | Configurable; compaction keeps only the latest per key |
| Ordering | Strict per stream, plus a global position | Strict **per partition** |
| Consumers | Subscriptions with checkpoints, replay from position | Consumer groups with offsets, replay within retention |
| Throughput | High, but not Kafka-scale | **Very high** — millions/s |

**The two capabilities Kafka structurally lacks for this job:**

1. **Per-entity stream reads.** Rehydration needs *"all events for payment-9f3a, in order."* In Kafka, those events are interleaved with millions of others in a partition. Reading them means consuming the partition from the beginning and filtering — which is `O(all events)` per command. That is not an optimisation problem; it is the wrong data structure for the access pattern.
2. **Conditional append.** There is no "append only if the stream is still at version 5." Kafka's idempotent producer de-duplicates retries; it does not implement optimistic concurrency (Q19). Without it, two handlers can both write conflicting decisions and nothing detects it.

**What Kafka is genuinely excellent at here — and the right architecture uses both:**

```
Command ──▶ Aggregate ──▶ EVENT STORE (truth, concurrency, per-stream reads)
                              │
                              └── outbox ──▶ KAFKA ──┬──▶ projection: payment_summary
                                                     ├──▶ projection: search index
                                                     ├──▶ fraud service
                                                     └──▶ analytics / data lake
```
The event store owns correctness; Kafka owns distribution, fan-out, replay for consumers, and integration with the wider platform. That is the standard production shape and the answer I would give.

---

## Q22. Can Kafka be used as an Event Store?

**Technically yes, in narrow circumstances; architecturally it is usually the wrong choice — and being able to say exactly *why*, rather than just "no", is what the question tests.**

**What people have in mind when they propose it:** Kafka is durable, ordered per partition, replayable, and with `retention.ms=-1` and log compaction it can hold data indefinitely. Those properties are real.

**What breaks:**

| Requirement | Kafka's answer | Verdict |
|---|---|---|
| **Read one aggregate's stream** | Consume the whole partition and filter | **Fatal** — rehydration becomes `O(topic)` per command |
| **Optimistic concurrency** | None | **Fatal** — no protection against conflicting writes (Q19) |
| **Millions of small streams** | A topic per aggregate is impossible (partition/metadata limits); a partition per aggregate likewise | **Fatal** |
| **Log compaction as a shortcut** | Keeps the **latest value per key** and deletes the rest | **It destroys history** — which is the entire point of Event Sourcing |
| **Retention forever** | Achievable, and the cost is real | Manageable |
| **Ordering** | Per partition only | Fine **if** you key by aggregate ID |
| **Replay for projections** | Excellent | Genuinely good |

**The workarounds people attempt, and why each fails:**
- *"Key by aggregate ID so ordering holds."* Ordering is fine; **reading one key's history still requires scanning the partition**, and you still have no conditional append.
- *"Keep a compacted topic for current state."* Now the compacted topic is the source of truth and you have a key-value store, not an event store — the history you were preserving has been deleted.
- *"Maintain an in-memory index of offsets per aggregate."* You have started building an event store. Finish the thought and use one.
- *"Use Kafka Streams state stores."* Useful for stream processing; still not per-entity historical reads with concurrency control.

**Where using Kafka alone *is* defensible:** high-volume, append-only telemetry or audit streams where you never need to rehydrate a single entity to enforce an invariant — an audit log, a market-data tape, an IoT ingest pipeline. That is event **streaming**, not event **sourcing**, and calling it by the right name avoids the confusion entirely.

**The recommendation:** use a **purpose-built event store or a relational append-only table** for the source of truth, and **Kafka for distribution** (Q21). Both together, with a transactional outbox between them, is the shape that gets built in practice — and it is also the answer the Azure documentation points to when it says brokers *"work well as a distribution layer... but they aren't a substitute for an event store."*

---

## Q23. Event Sourcing advantages?

Taken from the Azure Architecture Center's stated **pattern advantages**, then extended.

**1. Write throughput and no lock contention.** Per the docs: *"Events are immutable, and you can store them by using an append-only operation... Write throughput improves, especially for the presentation layer, because append-only writes avoid the row-level lock contention that update-in-place systems create."* There is no read-modify-write cycle, so concurrent writers do not block each other.

**2. A complete, inherent audit trail.** *"Append-only event storage provides an audit trail that applications can use to monitor actions taken against a data store."* Crucially, it **cannot drift from reality**, because it *is* reality — unlike an audit table, which can be bypassed, disabled or written incorrectly. For SOX, MiFID II and FINRA record-keeping this is the difference between a control you assert and one you can demonstrate.

**3. Temporal queries and state reconstruction.** *"It can regenerate the current state as materialized views or projections by replaying the events at any time, and it can help test and debug the system."* "What was this position at 16:00 on Tuesday?" is a replay, and it is also how you reproduce a bug exactly.

**4. Events carry business meaning.** *"Events typically have meaning for a domain expert, whereas object-relational impedance mismatch can make complex database tables hard to understand. Tables are artificial constructs that represent the current state of the system, not the events that occur."* `PaymentAuthorised` is a sentence a compliance officer understands; `payments.status = 3` is not.

**5. Conflict avoidance with explicit resolution.** Optimistic concurrency on the stream rejects conflicting appends rather than silently losing an update (Q19–Q20).

**6. Decoupling and extensibility.** *"The command handlers raise events, and tasks perform operations in response to those events. This decoupling of the tasks from the events provides flexibility and extensibility. Tasks know about the type of event and the event data, but not about the operation that triggers the event."* New consumers are added without touching the producer.

**7. The one the documentation implies but is worth stating explicitly — you can answer future questions with past data.** A CRUD `UPDATE` destroys information you did not know you would need. In 2029 the business asks "how many customers changed address within 30 days of a chargeback?" — in an event-sourced system that is a new projection over existing events; in a CRUD system the data no longer exists at any price. **This is the advantage that compounds over the life of the system**, and it is the one most often left out of an answer.

**8. Free, correct read-model evolution.** Read models are derived, so changing their shape is a rebuild rather than a migration script and a backfill (Q14).

**9. Debugging by replay.** Reproduce the exact sequence that produced a defect, in a test, deterministically — the `given-when-then` style the docs describe: *"Set up past events, issue a command, and assert on the new events produced. This given-when-then approach tests business logic without databases, queues, or projections."*

---

## Q24. Event Sourcing disadvantages?

Straight from the documentation's **Problems and considerations**, which is the most honest list available and worth using as the answer's spine.

| Disadvantage | What the docs say / what it means in practice |
|---|---|
| **Eventual consistency** | *"The system is only eventually consistent when it creates materialized views... Ensure that your customers understand that data is eventually consistent."* Every read model lags; read-your-own-writes must be designed for |
| **No ad-hoc querying** | *"There's no standard approach or existing mechanisms, such as SQL queries, for reading events."* Every query needs a projection built in advance — including the ones ops will want at 3 a.m. during an incident |
| **Permanent versioning burden** | Events live forever, so their schemas must be readable forever: tolerant deserialisation, versioning, upcasters, and a replay regression suite (Q15–Q16) |
| **Bugs are permanent** | *"If a bug produces incorrect events, those events persist in the store. Fixing the bug in application code doesn't fix the historical events."* Correcting requires compensating events or upcasters — a real, audited operation (Q18) |
| **Event ordering complexity** | Multi-threaded and multi-instance writers make per-entity ordering something you must actively guarantee |
| **Rehydration cost on long streams** | Requires snapshots, stream closing, or caching (Q11–Q12) |
| **Idempotency is mandatory** | *"Event delivery to consumers is typically at least once... Without idempotency, projections drift from the event stream and side effects such as payments or notifications trigger more than once."* |
| **Circular logic risk** | *"Be mindful of scenarios in which the processing of one event requires the creation of one or more new events. This sequence can result in an infinite loop."* |
| **Larger testing surface** | Given-when-then for the domain, **plus** integration tests for projections, idempotency and schema evolution — *"which adds testing surface compared to CRUD systems."* |
| **GDPR conflict** | *"The append-only, immutable nature of an event store conflicts with data protection regulations that require deletion of personal data."* Requires PII separation or crypto-shredding, with key management (Q18) |
| **Storage growth** | Every change, forever. Manageable, but a real cost line and a real backup/restore-time consideration |
| **Steep team learning curve** | The docs list "teams without event-driven experience" as a reason **not** to use the pattern |
| **It constrains the future** | *"It's costly to migrate to or from an event sourcing solution, and after you adopt the pattern, it constrains future design decisions in the parts of the system that use it."* |

**The operational reality behind that list:** you are committing to owning projection infrastructure (checkpoints, lag monitoring, rebuild tooling, poison-event handling), an event catalogue with governance, a replay regression suite, and snapshot management — none of which existed in the CRUD version of the system. That is a platform, and it needs an owner.

**The honest summary I would give a panel:** *"The costs are front-loaded and permanent; the benefits compound over time and are largest in domains where history is the business record. That is why I would apply it to the ledger and the payment lifecycle, and use CRUD for customer profiles and configuration."*

---

## Q25. When should you use Event Sourcing?

**Per the documentation, use it when:**
- *"You want to capture intent, purpose, or reason in the data"* — e.g. customer changes modelled as `MovedHome`, `ClosedAccount`, `Deceased` rather than an `UPDATE`.
- *"You must minimize or completely avoid conflicting updates to data."*
- *"You want to record events that occur, to replay them to restore the state of a system, to roll back changes, or to keep a history and audit log."*
- *"The application already uses events as a natural feature of its operation"* — so the marginal cost is low.
- *"You need to decouple the process of inputting or updating data from the tasks required to apply these actions."*
- *"You want the flexibility to change the format of materialized models and entity data if requirements change."*
- You use CQRS and eventual consistency is acceptable.

**Per the documentation, it might not be suitable when:**
- *"Systems have straightforward CRUD operations that don't require auditability, replay, or historical reconstruction of state."*
- *"Prototypes, minimum viable products (MVPs), or systems have short expected lifespans. The upfront investment in event design, schema evolution strategy, and projection infrastructure rarely yield a return."*
- *"Systems require consistency and real-time updates to the views of the data."*
- *"Domains in which data is mostly static or for reference, such as lookup tables or catalogs."*
- *"Teams don't have experience in event-driven architectures... Adopting it without the foundational knowledge increases the risk of antipatterns that are costly to reverse."*

**My decision test, in three questions:**

1. **Is the history itself valuable to the business?** Not "would it be nice to have" — would someone pay for the ability to answer questions about how state got here, or is it required by a regulator? If no, stop; use CRUD and publish integration events.
2. **Is the domain rich in intent?** Are there meaningful, distinct business actions (`AuthorisationDeclined`, `ChargebackRaised`, `SettlementReconciled`), or is every change "the user edited a field"? Event Sourcing over a domain with no intent produces a change log with no business meaning — precisely what the docs warn against.
3. **Can the team and the organisation sustain it?** Projection infrastructure, event governance, replay testing, and on-call people who understand it — for the life of the system, not just the project.

Three yeses: use it. Any no: use CRUD with domain events published for integration, which gives you loose coupling and a decent audit trail at a fraction of the cost.

**And the guidance the documentation gives that I would repeat verbatim in an interview:**

> *"Event sourcing doesn't have to be an all-or-nothing decision for your entire system. Apply it selectively to the parts of your system that it benefits the most, such as a payment ledger or order-processing pipeline. Use traditional CRUD for parts when the complexity isn't justified, such as user profile management or application configuration."*

**Where it genuinely fits in financial services:** ledgers and account balances, payment and order lifecycles, trading and position keeping, insurance policy lifecycles, regulatory-reporting sources, and anything with a dispute or chargeback process. **Where it does not:** customer profiles, merchant configuration, reference data, feature flags, CMS content, notification preferences.

---

## Q26. How would you design an Event-Sourced payment system?

The full design, and the framing matters: **a payment system's hard problem is correctness and auditability, not throughput.** Most real payment platforms peak in the hundreds of TPS. Every decision below optimises for "every money movement is explicable, idempotent, and reconcilable" — with Event Sourcing applied only where that pays.

### 1. Scope and what is event-sourced

| Bounded context | Storage | Why |
|---|---|---|
| **Payment lifecycle** | **Event-sourced** | Rich intent, dispute-prone, regulated, history is the record |
| **Ledger** | **Event-sourced** (append-only double-entry) | Double-entry bookkeeping *is* event sourcing; corrections are reversals, never edits |
| Merchant/customer profile | **CRUD** + published integration events | No value in the history; GDPR erasure is required |
| Reference data (BIN ranges, FX rates, country rules) | **CRUD** with effective-dating | Static-ish; effective dates give the temporal answer cheaply |
| Fraud decisions | **Event-sourced** (append-only decision log) | Must be explicable to a regulator and to the customer |

### 2. Aggregates and streams

```
Payment aggregate — stream "payment-{id}", short-lived, ends at settlement
  PaymentInitiated → FraudCheckPassed | FraudCheckFailed → PaymentAuthorised
    → PaymentCaptured → PaymentSettled
    (branches: AuthorisationDeclined, PaymentVoided, RefundIssued, ChargebackRaised, ChargebackResolved)

LedgerAccount aggregate — stream "ledger-{accountId}-{yyyyMM}", closed monthly
  PeriodOpened { openingBalance } → EntryPosted … → PeriodClosed { closingBalance }
```
**Two deliberate decisions here:**
- **The payment stream is short-lived** (10–30 events) and ends, so rehydration is trivial and **no snapshots are needed** (Q12).
- **The ledger stream is closed monthly** with a `PeriodOpened` carrying the opening balance — a domain-meaningful snapshot that bounds rehydration permanently and matches how accounting already works.

### 3. Event design — intent, not state

```csharp
// ✓ Intent: explains what happened and why
public sealed record PaymentAuthorised(
    PaymentId Id, Money Amount, string AuthorisationCode, string Provider,
    string ProviderReference, DateTimeOffset OccurredAt);

public sealed record AuthorisationDeclined(
    PaymentId Id, DeclineReason Reason, string ProviderCode, DateTimeOffset OccurredAt);

// ✗ State-focused: a change log with no business meaning
public sealed record PaymentStatusChanged(PaymentId Id, int NewStatus);
```
Every event carries envelope metadata: `eventId`, `correlationId`, `causationId`, `userId`/`systemId`, `occurredAt`, `schemaVersion` (Q6). **Money is `{ amount: long (minor units), currency: string }` — never a floating-point type**, and stored as an integer or a string, never a `double`.

### 4. Storage

- **Event store: PostgreSQL (Aurora)**, the append-only table from Q3, with `UNIQUE (stream_id, version)` doing the optimistic concurrency. Chosen over a purpose-built store because it is ACID, boring, backed up by the same tooling as everything else, and every DBA in the bank already understands it — the same reasoning the *Designing a Payment System* case study applies to choosing a relational database.
- **Multi-AZ, PITR, cross-Region read replica** for DR; the event store's RPO target is effectively zero because losing an event is losing the record.
- **Encryption** with a customer-managed KMS key; PII kept out of events by reference, with **crypto-shredding** as the fallback for the fields that cannot be separated (Q18).

### 5. Commands, concurrency and idempotency

```
POST /payments   Idempotency-Key: 8f3a-…
```
- The **idempotency key** is stored in DynamoDB with a TTL, mapping key → `paymentId` + response. A repeat returns the original response without re-executing (Module 4 Q24–Q25). This is non-negotiable: without it, a client retry is a double charge.
- **Commands are partitioned by `paymentId`** on the command queue so one aggregate is handled by one consumer, in order — which removes most concurrency conflicts before they reach the store (Q20).
- **Optimistic concurrency** on append handles the rest, with a bounded reload-and-re-decide retry.

### 6. Integration — outbox, not direct publishing

```
BEGIN
  INSERT INTO events   (…)      -- the domain events
  INSERT INTO outbox   (…)      -- the curated INTEGRATION events
COMMIT
   │
   └─▶ relay ─▶ Kafka/MSK ─▶ projections · fraud · notifications · ledger · analytics
```
The append and the outbox insert are **one transaction**, so there is no dual-write problem (Module 4 Q22). **Integration events are separate, curated, versioned types** — never raw domain events (Q2), so internal refactors never break other teams.

### 7. Projections

| Read model | Store | Purpose |
|---|---|---|
| `payment_summary` | PostgreSQL | Payment detail screen, ops lookup |
| `merchant_daily_totals` | PostgreSQL (pre-aggregated) | Merchant dashboard |
| `payment_search` | OpenSearch | Ops full-text search |
| `settlement_extract` | S3 (Parquet) | Daily reconciliation and regulatory reporting |
| `balance_by_account` | Redis | Hot balance reads (never authoritative) |

Each is **idempotent, checkpointed, independently rebuildable and monitored for lag** (Q8, Q13, Q14). Rebuild time for the full history is measured, published and drilled.

### 8. The cross-service workflow

Payment → fraud → provider → ledger spans several aggregates and services, so it is a **saga with compensations**, not a transaction (Module 4 Q18–Q21): authorise → capture → post to ledger, with `PaymentVoided` / `RefundIssued` / `LedgerEntryReversed` as the compensating actions. **Compensation is not rollback** — a reversal is itself a recorded business fact, which is exactly what an event-sourced ledger models naturally.

### 9. Reconciliation — mandatory, and the step most designs omit

Every night, the provider's **settlement file** is the external source of truth. The `settlement_extract` projection is compared against it, and breaks are classified: **auto-resolvable** (timing differences), **manual** (amount mismatches, queued for an operator), and **investigate** (missing on either side, escalated). Reconciliation is required **even when the provider claims idempotency** — this is the discipline that catches the failures no amount of application-level correctness prevents, and a fintech panel will look for it specifically.

### 10. Consistency and UX

- **Authorisation decisions read the write side** — never a projection. A stale fraud or balance read is a financial error.
- **Dashboards and search read projections** and tolerate seconds of lag, with a visible "last updated" indicator.
- After a command, the UI **renders the command's own result** rather than re-querying a projection (Q10).

### 11. Observability, security and operations

- **Correlation ID** propagated end to end and stamped on every event and log line; `causationId` gives the full causal chain for any incident or dispute.
- **Business metrics alongside technical ones**: authorisation rate, decline reasons by code, settlement lag, **reconciliation break count**, projection lag per model.
- **IAM roles per workload**, KMS CMKs per data domain, TLS/mTLS everywhere, PCI scope minimised by tokenising PAN so card data never enters the event store.
- **Runbooks with measured timings** for: rebuild a projection, replay after a bug, take/restore a backup, and correct historical data under four-eyes approval.

### 12. What I would deliberately not do

- **Not use Kafka as the event store** (Q21–Q22) — no per-stream reads, no conditional append. Kafka is the distribution layer.
- **Not event-source the whole platform** — profiles, merchant config and reference data stay CRUD, per the documentation's own advice.
- **Not publish domain events as integration contracts.**
- **Not skip the reconciliation process** because the design "guarantees" correctness. In payments, the reconciliation is the guarantee.

**The closing framing:** every money movement is an **immutable, attributable, explicable fact**; every externally-triggered operation is **idempotent**; every derived view is **rebuildable**; and everything is **reconciled against an outside source of truth**. Event Sourcing is not chosen here for throughput — it is chosen because those four properties are what a payment system is actually required to have, and this pattern gives you them by construction rather than by discipline.

---

## References — official documentation

| Topic | Source |
|---|---|
| Azure Architecture Center — Event Sourcing pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing |
| Azure Architecture Center — CQRS pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs |
| Azure Architecture Center — Materialized View pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view |
| Azure Architecture Center — Idempotent Consumer pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/idempotent-consumer |
| Azure Architecture Center — Compensating Transaction pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction |
| Azure Architecture Center — Saga pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/saga |
| Azure Architecture Center — Cloud design patterns catalogue | https://learn.microsoft.com/en-us/azure/architecture/patterns/ |
| Microsoft Learn — .NET microservices: DDD & CQRS patterns | https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ |
| Microsoft Learn — designing a DDD-oriented microservice (aggregates) | https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice |
| Microsoft Learn — domain events: design and implementation | https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/domain-events-design-implementation |
| Microsoft Learn — integration events | https://learn.microsoft.com/en-us/dotnet/architecture/microservices/multi-container-microservice-net-applications/integration-event-based-microservice-communications |
| Microsoft Learn — EF Core concurrency tokens (optimistic concurrency) | https://learn.microsoft.com/en-us/ef/core/saving/concurrency |
| Martin Fowler — Event Sourcing | https://martinfowler.com/eaaDev/EventSourcing.html |
| Martin Fowler — CQRS | https://martinfowler.com/bliki/CQRS.html |
| Martin Fowler — Domain Event | https://martinfowler.com/eaaDev/DomainEvent.html |
| Apache Kafka — design and log semantics | https://kafka.apache.org/documentation/#design |
| Apache Kafka — log compaction | https://kafka.apache.org/documentation/#compaction |
| Apache Kafka — message delivery semantics | https://kafka.apache.org/documentation/#semantics |
| AWS Prescriptive Guidance — Event sourcing pattern | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/event-sourcing.html |
| AWS Prescriptive Guidance — Transactional outbox pattern | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html |
| AWS — DynamoDB conditional writes (optimistic concurrency) | https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html#WorkingWithItems.ConditionalUpdate |
| AWS — DynamoDB Streams (change capture for projections) | https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html |
| EventStoreDB (Kurrent) documentation | https://developers.eventstore.com/ |
| Marten — event store for .NET on PostgreSQL | https://martendb.io/events/ |

---

**Previous:** [12 — Architecture Patterns](./12-Architecture-Patterns.md) | **Next:** [14 — CQRS, Saga, Outbox & Idempotency](./14-CQRS-Saga-Outbox-Idempotency.md)
