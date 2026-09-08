# 14. CQRS + Saga + Outbox + Idempotency — 20 Questions (Answered)

> **Method:** each pattern is defined from the **Azure Architecture Center — Cloud Design Patterns** (quoted verbatim) and **AWS Prescriptive Guidance — Cloud Design Patterns**, with **Microsoft Learn's .NET microservices e-book** for the implementation detail and **Debezium/AWS DMS** documentation for CDC. This module is deliberately the **integration** view: these four patterns are almost always deployed together, and the last two questions are about how they compose. Implementation depth for the individual patterns is in **Module 4 (Microservices)**, **Module 12 (Architecture Patterns)** and **Module 13 (Event Sourcing)** — cross-referenced rather than repeated. Links in **References**.

---

## Q1. What is CQRS?

**Per the Azure Architecture Center:** CQRS is *"Separate operations that read data from those that update data by using distinct interfaces."*

**Command Query Responsibility Segregation** (Greg Young, building on Bertrand Meyer's Command-Query Separation) splits the model that **changes** state from the model that **returns** state.

```
Command  ──▶ [ Write model ]  normalised, invariant-enforcing, ACID
   │                │
   │                └── events / projections
   ▼                          │
(no data returned,            ▼
 just success/failure)  [ Read model(s) ]  denormalised, one per query shape
                                ▲
Query ──────────────────────────┘   (no state change)
```

**The three levels** (Module 12 Q8), because "do you use CQRS?" is otherwise ambiguous:

| Level | Separation | Consistency cost |
|---|---|---|
| **1 — Code** | Separate command/query handlers; one model, one database | **None**. This is just good structure |
| **2 — Model** | Rich domain model for writes (EF Core), flat DTOs for reads (Dapper/SQL); **same database** | **None** — still one transactional store |
| **3 — Store** | Separate databases, synchronised by events | **Eventual consistency**, plus projection infrastructure |

Most "we do CQRS" claims mean level 1 or 2. **Level 3 is where the architecture decision lies.**

**In .NET, level 1–2 concretely:**
```csharp
// Command — changes state, returns nothing meaningful
public sealed record CapturePayment(PaymentId Id, Money Amount) : IRequest;

// Query — returns data, changes nothing; bypasses the ORM entirely
public sealed record GetPaymentSummary(PaymentId Id) : IRequest<PaymentSummaryDto>;

internal sealed class GetPaymentSummaryHandler(IDbConnection db)
    : IRequestHandler<GetPaymentSummary, PaymentSummaryDto>
{
    public Task<PaymentSummaryDto> Handle(GetPaymentSummary q, CancellationToken ct) =>
        db.QuerySingleAsync<PaymentSummaryDto>(
            "SELECT payment_id, status, amount, captured_at FROM payment_summary WHERE payment_id = @Id",
            new { q.Id });
}
```

**What CQRS is not:** it is not Event Sourcing (Module 13 Q10 — they pair naturally and are constantly conflated), it is not "two databases" by definition, and it is not a requirement of microservices.

---

## Q2. Command model vs Query model?

| | **Command (write) model** | **Query (read) model** |
|---|---|---|
| Purpose | **Change state correctly** | **Answer a question fast** |
| Optimised for | Invariants, consistency, concurrency control | Query shape, latency, throughput |
| Shape | **Normalised**, rich domain objects, aggregates, value objects | **Denormalised, flat**, one shape per screen or report |
| Behaviour | Rich — methods that enforce rules | **None** — DTOs with no logic |
| Validation | Full business-rule validation | Input validation only |
| Technology | EF Core, an event store, a domain model | Dapper, raw SQL, Redis, OpenSearch, a materialised view |
| Volume | Low (typically) | **High** (often 100:1) |
| Consistency | **Strong** within the aggregate | Eventual (level 3) or strong (levels 1–2) |
| Returns | Success/failure, an ID, maybe a version | **Data** |

**The design rules that follow:**

1. **Commands express intent, in the imperative, from the business's vocabulary.** `CapturePayment`, `ChangeShippingAddress` — not `UpdatePayment(dto)`. A task-based command tells you *why* the state changed, which is what makes auditing, event design and conflict resolution possible. A generic "save this object" command discards that information at the door.
2. **Commands can be rejected.** They are requests, not facts. (Events, by contrast, are facts and cannot be rejected — Module 13 Q1.)
3. **Queries never mutate.** No lazy initialisation with a side effect, no "record last accessed" write hidden in a read handler. Violating this makes reads unsafe to retry, cache or route to a replica.
4. **The read model needs no domain model.** Mapping a query result through a rich entity and back to a DTO is pure cost. Select straight into the DTO.
5. **One read model per query, not one shared read model.** The moment a read model serves five screens, it starts accumulating the same compromises the write model had.

**The .NET payoff worth naming:** the write side keeps EF Core, where change tracking, concurrency tokens and the unit of work earn their cost. The read side uses **Dapper or raw SQL**, avoiding tracking, materialisation and `Include` gymnastics entirely (Module 11 Q10, Q12). That alone — with no eventual consistency and no second database — solves a large share of real performance problems.

---

## Q3. Why separate read and write models?

Because the two workloads have genuinely different requirements, and a single model is a compromise that serves neither well.

| Force | Write side needs | Read side needs |
|---|---|---|
| **Data shape** | Normalised, no duplication, referential integrity | **Denormalised** — everything one screen needs, in one row |
| **Volume** | Low | Often 100–1000× higher |
| **Latency tolerance** | Some (correctness first) | Very little |
| **Consistency** | **Strong** — invariants must hold | Usually eventual is fine |
| **Scaling** | Vertical / partitioned | **Horizontal**, cached, replicated |
| **Store** | Relational, ACID | Whatever suits: relational, key-value, search, columnar |

**The concrete symptom that tells you the compromise has failed** — and this is the thing to describe, because it is what an interviewer recognises: a query that renders one screen has nine `Include`s, produces a 4,000-row cartesian result set for 12 logical rows, takes 800 ms, and cannot be optimised without denormalising the write model — which would break the invariants the write model exists to protect. You are stuck. CQRS unsticks you by refusing the premise that one model must do both.

**The four things separation buys:**

1. **Each side optimised independently.** The write model stays normalised and correct; the read model is exactly the shape the screen needs.
2. **Independent scaling.** Reads scale out, cache, and move to replicas without touching write integrity. **And read load can no longer slow the write path** — often the real motivation in a payments platform, where authorisation latency must not degrade because someone ran a dashboard.
3. **Different stores where justified.** Full-text search, graph traversal, time-series aggregation — none of which a normalised OLTP schema serves well.
4. **Clearer code.** Command handlers contain business rules; query handlers contain SQL. Neither contains both.

**And the honest counter-position, which a good answer includes:** for a CRUD domain the separation is overhead — two models, mapping between them, and (at level 3) an entire consistency problem you did not have. **Separate when the forces above actually diverge**; keep one model when they don't (Module 12 Q10).

---

## Q4. What is eventual consistency in CQRS?

At **level 3** (separate stores), the read model is updated **after** the write commits, so there is a window in which a query returns data that does not reflect the most recent write. That window is **eventual consistency**.

```
t=0.000  Command handler commits: payment status = Captured
t=0.001  Event published to the bus
t=0.030  Projection handler consumes it
t=0.045  Read model updated
         ─────────────────────────────
         For ~45 ms, a query returns "Authorised" — stale but not wrong-forever
```

Typical lag is **milliseconds to a few seconds**. It becomes minutes only when a projection is down or backed up — which is why **projection lag is a first-class SLO** (Module 13 Q13).

**The user-visible problem is read-your-own-writes:** the user submits a payment, is redirected to the detail page, and sees the *old* status. Technically correct, functionally a support ticket.

**The mitigations, in the order I would apply them:**

| Technique | How | When |
|---|---|---|
| **Return the result from the command** | The command handler returns the new state; the UI renders it rather than re-querying | **Default.** Simplest, fastest, no infrastructure |
| **Version/consistency token** | Command returns a version; the query waits (or polls briefly) until the projection reaches it | When the UI must re-query |
| **Read from the write side for that one query** | Route this specific query to the write store | For a small number of critical reads |
| **Optimistic UI** | Render the expected outcome immediately, reconcile on the next poll | Consumer UX |
| **Make it visible** | "Processing…", a spinner, a "last updated" timestamp | **Always** — honesty beats a wrong number |

**The rule for a financial system, stated firmly:** decide **per read** whether staleness is acceptable, and write it down.

- **Never eventually consistent:** authorisation decisions, available balance used to approve a transaction, fraud checks, limit checks. These read the **write side**. A stale balance that approves an overdraft is a financial loss, not a UX blemish.
- **Eventually consistent is fine:** dashboards, transaction history, search, reporting, analytics, notifications.

**And the point that reframes the objection:** eventual consistency is not introduced by CQRS — it already exists in almost every system. A read replica lags. A cache is stale. A downstream service has not processed your event yet. CQRS makes the lag **explicit, measurable and boundable** rather than accidental. That is an improvement, provided you actually measure it.

---

## Q5. What is Saga?

**Per the Azure Architecture Center:** the Saga pattern *"Manage[s] data consistency across microservices in distributed transaction scenarios."*

A **saga** is a sequence of **local transactions**, each in a single service, where each step publishes an event or message that triggers the next. If a step fails, previously completed steps are undone by **compensating transactions**.

```
Order        Payment        Inventory       Shipping
  │             │               │               │
  ├─ create ───▶│               │               │
  │             ├─ authorise ──▶│               │
  │             │               ├─ reserve ────▶│
  │             │               │               ├─ dispatch ✗ FAILS
  │             │               │◀── release ───┤     compensate
  │             │◀── refund ────┤                     compensate
  │◀─ cancel ───┤                                     compensate
```

**Why it exists:** with **database-per-service** (Module 12 Q20), a business operation spanning several services cannot be one ACID transaction. Two-phase commit is the textbook alternative and is rejected in practice because it requires a coordinator (a single point of failure), holds locks across services and network calls (destroying availability and throughput), is not supported by most cloud data stores, and violates service autonomy. Saga trades **atomicity** for **availability**, and accepts eventual consistency in exchange.

**The guarantees a saga does and does not give:**
- ✅ **Eventually, the system reaches a consistent state** — either all steps completed, or all completed steps were compensated.
- ❌ **No isolation.** Intermediate states are visible to other transactions. A concurrent reader may see an order that is "created" but whose payment is about to fail. This is the ACD-without-the-I property, and countermeasures (semantic locks, commutative updates, pessimistic view, re-read value) are how you manage it.

**Two coordination styles** — choreography and orchestration (Q6).

**Design rules:** every step must be **idempotent** (it will be retried), every step must have a **compensating action** (or be made the last, unrecoverable step), the saga's state must be **durable** so it survives a crash, and there must be a **timeout and a terminal failure path** for a step that never completes. Module 4 Q18–Q21 covers the implementation.

---

## Q6. Saga orchestration vs choreography?

**Per the Azure Architecture Center**, Choreography is *"Let individual services decide when and how a business operation is processed, instead of depending on a central orchestrator."* Orchestration puts that decision in one coordinator.

```
CHOREOGRAPHY — services react to each other's events            ORCHESTRATION — one coordinator
  Order ──OrderCreated──▶ Payment                                  ┌──────────────┐
  Payment ──PaymentAuthorised──▶ Inventory                         │ Saga         │
  Inventory ──StockReserved──▶ Shipping                            │ orchestrator │
  (no one knows the whole flow)                                    └──┬───┬───┬───┘
                                                                      ▼   ▼   ▼
                                                                  Payment Inv Ship
```

| | **Choreography** | **Orchestration** |
|---|---|---|
| Control | **Distributed** — each service knows only its own reaction | **Centralised** in the orchestrator |
| Coupling | Loose between services, but **coupled to event contracts** | Services are simple; orchestrator knows everyone |
| Visibility of the flow | **None in one place** — you reconstruct it from traces | **Explicit** — the workflow is readable code/definition |
| Adding a step | Add a subscriber; touch nothing else | Change the orchestrator |
| Debugging | **Hard** — "why did nothing happen?" requires tracing across services | **Easier** — inspect the saga's state |
| Compensation logic | Scattered across services | **Centralised and explicit** |
| Cyclic-dependency risk | **Real** — event loops are easy to create accidentally | Low |
| Single point of failure | None | The orchestrator (mitigate with a durable, replicated workflow engine) |
| Best for | **2–4 steps**, simple, stable flows | **5+ steps**, branching, timeouts, human approval, anything regulated |

**My default and the reasoning:** **orchestration for anything business-critical.** In a payments or settlement flow, someone will eventually ask "where is transaction X, and why hasn't it completed?" With choreography, the answer requires correlating traces across six services and hoping the events were logged. With orchestration, the saga instance **is** the answer — its state, its current step, its retry count, its timeout. That operability difference dominates the coupling argument in a regulated environment, and it is also what makes the flow auditable.

**Use choreography** for genuinely simple, stable, few-step flows, and where the extra service is unwelcome — for example, "order placed → send confirmation email" needs no orchestrator.

**Implementations:** **AWS Step Functions** (managed, visual, durable, with built-in retries/catch/timeouts — the standard AWS answer), **Temporal**, **MassTransit** state machines or **NServiceBus** sagas in .NET, or **Azure Durable Functions**. A hand-rolled orchestrator with a state table is fine for simple cases but you will eventually rebuild timeouts, retries and recovery — which is what these tools already are.

---

## Q7. How does Saga handle rollback?

**It doesn't — because it can't.** There is no distributed rollback; each local transaction has already **committed** in its own database and is visible to everyone. What a saga does instead is execute **compensating transactions**: new, forward-moving transactions whose business effect offsets the earlier ones.

**Per the Azure Architecture Center**, the Compensating Transaction pattern is *"Undo the work performed by a sequence of steps that collectively form an eventually consistent operation."*

```
Forward path                          Compensating path (reverse order)
1. OrderCreated            ◀────────  4'. OrderCancelled
2. PaymentAuthorised       ◀────────  3'. PaymentVoided / Refunded
3. StockReserved           ◀────────  2'. StockReleased
4. ShipmentRequested  ✗ FAILS         1'. (nothing to undo)
```

**Rules for compensation that matter in production:**

1. **Compensate in reverse order** of completion, so dependencies unwind correctly.
2. **Compensating actions must be idempotent** — they will be retried.
3. **Compensating actions must not fail** in a way that leaves the saga stuck. If one cannot succeed (the provider is down), retry with backoff, and after N attempts escalate to a **DLQ and a human**, with the saga parked in a `CompensationFailed` state. **Never silently give up.**
4. **Some steps are not compensatable**, and this drives ordering: an email cannot be unsent, a card cannot be un-charged without a refund that has its own fee, a physical dispatch cannot be recalled. **Order the saga so unrecoverable steps come last**, after everything that might fail has already succeeded — this is a design technique, not a limitation to complain about.
5. **A "pivot transaction"** is the point after which the saga can only go forward. Steps before it are compensatable (`retriable/compensatable`); steps after must be **retried until they succeed**. Identifying the pivot explicitly is what mature saga design looks like.
6. **Every compensation is itself a recorded business fact** — `PaymentRefunded`, `StockReleased` — with a reason. In a ledger, that is a reversal entry, not a deletion (Module 13 Q17).

**Failure taxonomy the saga must handle:** a step **fails deterministically** (compensate), a step **fails transiently** (retry, then compensate), a step **times out with an unknown outcome** (query the downstream for status — this is why idempotency keys and status endpoints matter — then decide), and **compensation fails** (escalate).

---

## Q8. Why isn't compensation the same as rollback?

Because a rollback is a **database mechanism that erases** uncommitted work, and compensation is a **business action that offsets** committed work. The difference is not pedantry — it changes what the system does, what users see, and what appears in the audit trail.

| | **Rollback (ACID)** | **Compensation (Saga)** |
|---|---|---|
| Level | Database transaction | **Business operation** |
| Timing | Before commit | **After commit** — the work is already done and visible |
| Visibility | Nobody ever saw the intermediate state | **Everyone saw it**; side effects may have occurred |
| Effect | State is **restored exactly** | State is **moved forward** to an offsetting position |
| Trace left | **None** — as if it never happened | **A permanent record of both actions** |
| Guaranteed? | Yes, by the database | **No** — compensation is itself an operation that can fail |
| Semantics | Perfect inverse | **Approximate** — usually not a perfect inverse |

**The concrete example that makes it land:**

```
Rollback:      BEGIN; debit £100; ✗ error; ROLLBACK;
               → The £100 was never debited. No customer ever saw it. No record exists.

Compensation:  Charge card £100 ✓ (customer's bank shows the charge; they get a notification)
               Shipping fails ✗
               Refund £100 ✓
               → The customer saw a charge and then a refund on their statement.
                 The money left and came back — possibly days apart.
                 Two entries exist forever. FX may have moved. A fee may have been incurred.
                 The customer may have called support in between.
```
The final balance is the same. **The experience, the record and the cost are not.**

**Why this matters architecturally:**

1. **Side effects cannot be undone.** Emails sent, webhooks delivered, downstream systems notified, a fraud model updated. Compensation offsets the *state*, not the *observations*.
2. **Compensation is not always exact.** Refunding a card may not return the FX conversion or the interchange fee. Releasing reserved stock may find someone else took it. "Undo" is an approximation negotiated with the business.
3. **Isolation is genuinely absent.** Another process can read and act on the intermediate state before compensation runs — this is the "no I in ACID" property of sagas, and it must be managed with semantic locks (an `IsPending` flag), commutative updates, or a re-read-and-verify at the point of use.
4. **The design consequence:** minimise the window and the visibility of intermediate states, order steps so the irreversible ones are last, and **make the compensating action a first-class, modelled business operation** with its own rules, authorisation and audit — not an afterthought called `UndoX()`.

**The sentence I would use:** *"Rollback restores the past; compensation writes a new future that happens to net out. In finance, that distinction is the difference between an entry that never existed and a reversal that a customer, an auditor and a regulator can all see."*

---

## Q9. What is the Outbox pattern?

**Per AWS Prescriptive Guidance:** the transactional outbox pattern is used *"to reliably publish messages or events as part of a database transaction"* — the service writes the message to an **outbox table in the same database, in the same transaction** as the state change, and a separate relay reads that table and publishes.

```
┌──────────── ONE ACID TRANSACTION ────────────┐
│  UPDATE payments SET status = 'Captured'     │
│  INSERT INTO outbox (id, type, payload, …)   │
└──────────────────────────────────────────────┘
                     │  committed atomically
                     ▼
        ┌── Relay (poller, or CDC on the outbox table) ──┐
        │  read unpublished rows → publish to Kafka/SNS  │
        │  mark published (or delete)                    │
        └────────────────────────────────────────────────┘
```

**A minimal outbox table:**
```sql
CREATE TABLE outbox (
    id             UUID PRIMARY KEY,
    aggregate_type TEXT        NOT NULL,
    aggregate_id   TEXT        NOT NULL,   -- becomes the partition key → ordering per aggregate
    event_type     TEXT        NOT NULL,
    payload        JSONB       NOT NULL,
    headers        JSONB       NOT NULL,   -- correlation/causation id, schema version
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ NULL
);
CREATE INDEX ix_outbox_unpublished ON outbox (occurred_at) WHERE published_at IS NULL;
```
The **filtered index on unpublished rows** keeps the poller's query fast even when the table holds millions of historical rows — and yes, you must prune published rows on a schedule, or the table becomes a performance problem of its own.

**Two relay implementations:**
- **Polling publisher** — a background service selects unpublished rows (`FOR UPDATE SKIP LOCKED` so multiple instances can share the work), publishes, marks them published. Simple, no extra infrastructure, adds polling latency (typically 100 ms–1 s).
- **Transaction-log tailing (CDC)** — Debezium or DMS reads the database log and publishes outbox inserts. Lower latency, no polling load, but adds a CDC pipeline to operate (Q11–Q12).

**Delivery semantics:** the outbox gives **at-least-once** publication. The relay can crash after publishing but before marking the row, so the message is published again. **This is why every consumer must be idempotent** (Q16) — the outbox solves atomicity, not duplication.

**In .NET**, MassTransit, NServiceBus, Wolverine and Brighter all provide an outbox; EF Core interceptors are the usual hand-rolled approach, collecting domain events during `SaveChanges` and inserting them in the same transaction.

---

## Q10. How does Outbox solve the dual-write problem?

**The dual-write problem:** a service must do two things that must both happen or neither — **write to its database** and **publish a message** — but they are in two different systems with no shared transaction. Any ordering fails:

```
Option A: commit DB, then publish            Option B: publish, then commit DB
  ✓ UPDATE payments … COMMIT                   ✓ publish PaymentCaptured
  ✗ CRASH before publish                       ✗ CRASH before commit
  → State changed, NOBODY was told.            → Everyone was told about a change
    Ledger never posts. Customer never            that never happened. Downstream
    notified. Silent, permanent divergence.       services act on a phantom event.
```
Both failure modes are silent and both corrupt the system. And the "obvious" fix — a distributed transaction across the database and the broker (XA/2PC) — is rejected for the reasons in Q5: coordinator failure, locks held across the network, poor throughput, and most cloud brokers (Kafka, SQS, SNS) simply do not support it.

**How the outbox eliminates it:** it converts two writes across two systems into **one write to one system**.

```
BEGIN
  UPDATE payments SET status = 'Captured' WHERE id = …;   -- the state change
  INSERT INTO outbox (…) VALUES (…);                      -- the intent to publish
COMMIT   ← atomic. Either BOTH happen or NEITHER does.
```
The publish is no longer part of the critical transaction; it is a **durable record of an intention**, stored transactionally with the state that justifies it. The relay then delivers it — retrying indefinitely if the broker is down, because the row is safely in the database.

**Walking the failure modes proves it:**

| Crash point | Outcome |
|---|---|
| Before commit | Neither the state change nor the outbox row exists. **Consistent.** |
| After commit, before relay reads | Row is there; relay publishes when it recovers. **Consistent, slightly delayed.** |
| After publish, before marking published | Relay republishes on restart → **duplicate**, handled by consumer idempotency. **Consistent.** |
| Broker down | Rows accumulate in the outbox; relay retries. **Consistent, delayed.** Monitor outbox depth as a lag metric |

**The trade-offs to state:** publication latency (polling interval, or CDC lag), an extra table with growth that must be pruned, at-least-once delivery requiring idempotent consumers, and — importantly — **ordering is only guaranteed if you enforce it**, by publishing in `occurred_at`/id order and partitioning the topic by `aggregate_id`.

**The alternative worth naming:** the **Listen-to-Yourself** pattern (publish first, then have the service consume its own event to write state) inverts the problem, and CDC on the *business* tables (Q12) avoids the outbox table entirely at the cost of coupling events to your schema.

---

## Q11. What is CDC?

**Change Data Capture** is a technique for observing and streaming **row-level changes** from a database, typically by reading its **transaction log** (the PostgreSQL WAL, the MySQL binlog, the SQL Server transaction log), and emitting each insert, update and delete as an event.

```
Application ──writes──▶ Database ──▶ transaction log (WAL / binlog)
                                          │
                                     CDC connector (Debezium, DMS, native)
                                          │
                                          ▼
                               Kafka / Kinesis / EventBridge
                                          │
                        ┌─────────────────┼─────────────────┐
                        ▼                 ▼                 ▼
                  read models        data lake         other services
```

**Two implementation styles:**

| Style | How | Trade-off |
|---|---|---|
| **Log-based** (Debezium, AWS DMS, DynamoDB Streams) | Reads the database's own transaction log | **No application change, no query load, captures every change including deletes, preserves order.** The right answer |
| **Query-based** (poll a `last_modified` column) | Periodic `SELECT … WHERE updated_at > @last` | Simple, but **misses deletes, misses intermediate states, adds query load**, and needs a reliable timestamp column |

**A log-based change event carries `before` and `after` images**, the operation type, the transaction ID and the log position — which is why it can drive an exact replica, not just a notification.

**What CDC is used for:**
- **Database replication and migration** — the original use case; AWS DMS is built on it.
- **Feeding data lakes and warehouses** without batch ETL windows.
- **Maintaining read models / search indexes / caches** in near real time.
- **Publishing the outbox table** (the strongest use — Q12).
- **Strangler-fig migrations**, keeping the legacy and new stores in sync during a cutover (Module 12 Q19).

**Operational realities to mention:** the connector must be highly available and **checkpointed** (it tracks a log position; losing it means a full snapshot re-read); a snapshot phase is needed for existing data before streaming begins; **log retention** must exceed the connector's maximum downtime or you lose changes irrecoverably; and schema changes propagate into the stream, so downstream consumers need a schema-evolution strategy.

---

## Q12. Outbox vs CDC?

They are complementary, not alternatives — and the strongest production design **uses CDC to publish the outbox**. But the question usually means "CDC on your business tables versus an outbox table", and there the distinction is sharp.

| | **Outbox (application-written events)** | **CDC on business tables** |
|---|---|---|
| What is published | **A designed business event** — `PaymentCaptured` with the fields you chose | **A row change** — `payments` row before/after |
| Semantics | **Business intent**, at the granularity you decide | **Data mutation**, at table granularity |
| Coupling | Consumers depend on your **event contract** | Consumers depend on your **database schema** ❗ |
| Schema change impact | Internal refactor is invisible to consumers | **A column rename breaks every consumer** |
| Application change needed | **Yes** — write to the outbox | **No** — transparent to the application |
| Multi-table operations | One event describes the whole business action | **N separate row events**, and consumers must reassemble them |
| Deletes | Modelled as a business event (`PaymentVoided`) | A raw `DELETE` with no reason attached |
| Ordering | Controlled by you (`aggregate_id` partition key) | Log order, per table |
| Legacy systems you cannot modify | Not possible | **The only option** |

**The decisive argument for the outbox:** CDC on business tables **publishes your database schema as a public API**. Every consumer now depends on your column names and table structure, so you cannot refactor without a cross-team migration — which is precisely the coupling that database-per-service exists to prevent (Module 12 Q20). It also loses intent: a row change from `status=3` to `status=5` does not say whether that was a capture, a void or an operator correction.

**When CDC on business tables is nonetheless right:** a **legacy system you cannot modify** (this is the main one — and it is common in banking), a data-lake/warehouse feed where raw replication is exactly what you want, and during a strangler migration where you need both stores in sync temporarily.

**The best-of-both design, and the one I would propose:**

```
Application ──ONE transaction──▶ [ business tables + outbox table ]
                                            │
                                    Debezium reads the WAL,
                                    filtered to the outbox table only
                                            │
                                            ▼
                                    Kafka (partitioned by aggregate_id)
```
You get the **outbox's semantics** (designed business events, no schema coupling, one event per business action) with **CDC's delivery** (no polling load, low latency, exactly the ordering of the log, and no relay service to write and operate). Debezium ships an **outbox event router** SMT specifically for this, which is a strong detail to name.

---

## Q13. What is idempotency?

**An operation is idempotent if performing it multiple times has the same effect as performing it once.** Per the Azure Architecture Center's Idempotent Consumer pattern: *"Handle duplicate message delivery so that processing a message multiple times has the same effect as processing it once."*

**Why it is mandatory in distributed systems, stated as the underlying truth:** you can never know whether a request you didn't get a response to was executed. A timeout means one of three things — the request never arrived, it arrived and failed, or **it arrived and succeeded but the response was lost**. The caller cannot distinguish them. So the caller retries, and the system must be safe under retry. **Idempotency is what makes at-least-once delivery survivable**, and at-least-once is the only delivery guarantee real infrastructure provides (Module 5).

**Naturally idempotent vs not:**

| Idempotent | Not idempotent |
|---|---|
| `SET balance = 100` | `balance = balance - 50` |
| `PUT /payments/{id}` with the full state | `POST /payments` creating a new resource each time |
| `DELETE /payments/{id}` | `POST /payments/{id}/refunds` |
| Inserting with a unique key (second insert fails harmlessly) | Blind `INSERT` |
| `HTTP GET`, `PUT`, `DELETE` (per RFC 9110) | `HTTP POST`, `PATCH` |

**Three ways to achieve it, in order of preference:**

1. **Design the operation to be naturally idempotent** — set absolute values rather than deltas; use a client-supplied ID so the resource identity is known before creation (`PUT /payments/{clientGeneratedId}`). Best, because nothing extra can go wrong.
2. **Deduplicate on a key** — an idempotency key or event ID, recorded and checked (Q14, Q16).
3. **Make the effect conditional on current state** — a state machine that only transitions `Authorised → Captured`, so a second capture is a no-op rather than a second charge. Very effective, and it doubles as a business rule.

**The financial framing that a fintech panel wants to hear:** in payments, a non-idempotent operation is not a technical defect — it is a **double charge**, a regulatory issue and a customer-trust event. Idempotency is therefore a **correctness requirement of the domain**, and it belongs in the API contract and the acceptance criteria, not in a list of engineering nice-to-haves.

---

## Q14. How do you implement an idempotency key?

The **client generates a unique key** per logical operation and sends it in a header; the server records the key with the outcome and returns the **stored** response on any repeat.

```
POST /payments HTTP/1.1
Idempotency-Key: 8f3a2c1e-4b7d-4e6f-9a1c-2d3e4f5a6b7c
Content-Type: application/json

{ "merchantId": "M-914", "amount": 4999, "currency": "GBP" }
```

**The server-side algorithm — and the states matter, because a naive two-state version has a race:**

```
1. Atomically INSERT the key with status = IN_PROGRESS.
     ├─ Insert succeeds → this is the first attempt. Proceed to step 2.
     └─ Insert fails (key exists) → look at the stored record:
          • COMPLETED   → return the stored response, verbatim, with the original status code
          • IN_PROGRESS → return 409 Conflict (or 425) — a retry arrived while the first
                          is still running. DO NOT execute a second time.
          • FAILED      → allow a retry, or return the stored error
2. Execute the operation.
3. In the SAME transaction as the business write, update the key row to COMPLETED
   and store the response body, status code and a fingerprint of the request.
```

```sql
CREATE TABLE idempotency_keys (
    key            TEXT PRIMARY KEY,
    request_hash   TEXT        NOT NULL,   -- detects key reuse with a DIFFERENT body
    status         TEXT        NOT NULL,   -- IN_PROGRESS | COMPLETED | FAILED
    response_code  INT         NULL,
    response_body  JSONB       NULL,
    resource_id    TEXT        NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL    -- TTL: 24h–7d is typical
);
```

**The details that separate a working implementation from a broken one:**

1. **Store the key in the same transaction as the business effect.** If they are separate, a crash between them leaves the key recorded with no payment, or a payment with no key. This is the same dual-write problem as Q10 and has the same answer: one transaction.
2. **The `IN_PROGRESS` state is essential.** Without it, two concurrent requests with the same key both see "not found" and both execute. Stripe's API behaves exactly this way — a concurrent duplicate gets an error rather than a second charge.
3. **Hash the request body.** If the same key arrives with a *different* body, that is a client bug: return **422**, do not silently return the first response. Otherwise a client that reuses keys gets wrong answers.
4. **Set a TTL.** Keys are not kept forever; 24 hours to 7 days is normal, and the window should exceed the client's maximum retry horizon. Publish it in your API docs.
5. **Store keys where writes are cheap and TTL is native** — DynamoDB with a TTL attribute is the natural AWS choice, and it removes the cleanup job.
6. **Scope the key** to the client/merchant so two tenants cannot collide.
7. **Return the same status code**, not just the same body — a repeat of a `201 Created` should return `201` with the original `Location`.

**In .NET**, implement this as middleware or an `IAsyncActionFilter` so it applies uniformly and no handler can forget it.

---

## Q15. How do you handle duplicate API requests?

Duplicates arrive from four sources, and the defence differs:

| Source | Example | Defence |
|---|---|---|
| **Client retry after a timeout** | The response was lost; the client resends | **Idempotency key** (Q14) |
| **User double-click / double-submit** | Two identical POSTs milliseconds apart | Idempotency key + a UI guard (disable the button) |
| **Infrastructure retry** | A load balancer, gateway or SDK retries automatically | Idempotency key |
| **Malicious replay** | An intercepted request re-sent | **Signature + timestamp + nonce** (Module 16) — idempotency alone is not a security control |

**The layered defence, outermost first:**

1. **Make the operation naturally idempotent where possible.** `PUT /payments/{clientGeneratedId}` needs no key at all — the resource identity is supplied by the client, so a repeat is an upsert. This is the cleanest design and worth proposing before reaching for infrastructure.
2. **Require an `Idempotency-Key` header on every state-changing endpoint** (Q14). Make it **mandatory** for payment operations — an optional idempotency key will be omitted by exactly the client whose retry causes the double charge.
3. **Enforce a business-level uniqueness constraint as a backstop.** A unique index on `(merchant_id, merchant_reference)` means that even if the idempotency layer fails, the *database* refuses the second payment. **Defence in depth: the constraint is the thing that cannot be bypassed by a bug in the middleware.**
4. **Use state machines.** A payment in `Captured` cannot be captured again — the second attempt is a no-op returning the existing state, not an error and not a second charge.
5. **Return the original response**, not a new one, so the client's retry is indistinguishable from success.

**What the client should do**, because idempotency is a two-sided contract and a good answer covers both: generate the key **once per logical operation** and reuse it across all retries of that operation (a new key per retry defeats the entire mechanism); retry only on 5xx, 429 and network errors, with exponential backoff and jitter; and treat a 409 as "the first attempt is still running — wait and poll", not as a failure.

**Document it.** The idempotency contract — header name, key format, TTL, behaviour on conflict, behaviour on body mismatch — belongs in the API specification. In a partner-facing payments API this is one of the most-read sections of the documentation.

---

## Q16. How do you handle duplicate events?

Messaging is **at-least-once** by design — Kafka, SQS and SNS all redeliver — so duplicates are not an edge case, they are normal operation. Per the Azure documentation on Event Sourcing: *"Event delivery to consumers is typically at least once, so consumers can receive the same event more than once. Event handlers must be idempotent so processing a duplicate event doesn't change the outcome."*

**Why duplicates happen:** the broker redelivers after a visibility timeout; the consumer crashes after processing but before committing the offset; a rebalance replays uncommitted messages; the producer retries after a lost ack; the outbox relay republishes (Q10).

**Four techniques, and the right one depends on the effect:**

| Technique | How | Best for |
|---|---|---|
| **1. Dedupe store on `eventId`** | Record processed event IDs; skip if seen | General purpose |
| **2. Idempotent effects** | Upsert, absolute set, `INSERT … ON CONFLICT DO NOTHING` | **Best — no bookkeeping at all** |
| **3. Version/sequence check** | Store the last processed version per stream; ignore anything ≤ it | Ordered, per-aggregate streams |
| **4. State-machine guard** | Only transition from the expected state | Workflow/saga steps |

```csharp
// Technique 1 + 2 combined, in one transaction — the standard implementation
public async Task Handle(PaymentCaptured e, CancellationToken ct)
{
    await using var tx = await _db.BeginTransactionAsync(ct);

    var inserted = await _db.ExecuteAsync(
        "INSERT INTO processed_events (event_id, handler, processed_at) VALUES (@Id, @H, now()) " +
        "ON CONFLICT (event_id, handler) DO NOTHING", new { e.EventId, H = nameof(PaymentCaptured) });

    if (inserted == 0) { await tx.CommitAsync(ct); return; }   // already handled — no-op

    await _ledger.PostAsync(e, ct);                            // the business effect
    await tx.CommitAsync(ct);                                  // ← atomic with the dedupe record
}
```
**The atomicity is the whole point.** If the dedupe record and the business effect are not committed together, a crash between them either double-processes or silently skips.

**Practical guidance:**
- **Dedupe per handler, not per event** — the same event legitimately goes to several consumers. The key is `(eventId, handlerName)`.
- **TTL the dedupe store.** Keep a window comfortably longer than the broker's maximum redelivery horizon (retention period, DLQ delay, replay window). DynamoDB with TTL, or a partitioned table with a retention job.
- **Technique 3 is the cheapest when it applies** — one `last_version` column per aggregate replaces an entire dedupe table, and it also enforces ordering.
- **Beware non-idempotent side effects hiding in the handler** — sending an email, calling a payment provider, publishing another event. Those need their own idempotency key downstream; deduping at the top of your handler does not protect a partner API you called before crashing.

---

## Q17. What happens if a consumer crashes after the DB commit?

**The message is redelivered and reprocessed** — because the offset/acknowledgement was not committed. This is the canonical at-least-once failure window, and it is exactly why idempotency is mandatory rather than optional.

```
1. Consumer receives the message
2. Business transaction COMMITS  ✓   ← the effect is durable
3. ✗ CRASH  (before acking / committing the offset)
4. Broker redelivers the message (visibility timeout expires, or the group rebalances)
5. A new consumer processes it AGAIN
   → Without idempotency: the ledger is posted twice. Real money, wrong.
   → With idempotency:    the dedupe check short-circuits. Correct.
```

**The window is unavoidable.** There is no ordering of "commit the business transaction" and "commit the offset" that eliminates it, because they are in two different systems — the same dual-write problem as Q9/Q10:

| Order | Failure |
|---|---|
| **Commit DB, then ack** | Crash between → **duplicate processing** (at-least-once) |
| **Ack, then commit DB** | Crash between → **lost message** (at-most-once) — far worse |

You choose your poison, and **at-least-once with idempotent processing is always the right choice** in a financial system: a duplicate you can detect and discard is infinitely preferable to a payment you silently never processed.

**How to make the window safe:**

1. **Dedupe record in the same transaction as the effect** (Q16). On redelivery, the insert conflicts and the handler no-ops. This closes the window completely from a correctness standpoint.
2. **Keep the transaction and the ack close together** to shrink the window — but never rely on that as the mechanism.
3. **Where the store supports it, commit the offset with the data.** Kafka transactions (`sendOffsetsToTransaction`) give exactly-once *within* Kafka for read-process-write pipelines. This does **not** extend to an external database — a common misconception worth correcting explicitly.
4. **Handle the poison-message case**: if the crash is caused by the message rather than coincidental, redelivery loops forever. Bound redeliveries and route to a **DLQ** after N attempts (Module 7).
5. **Watch for partial side effects.** If the handler committed the database write and *then* called a payment provider before crashing, reprocessing repeats the provider call — so that call needs its **own** idempotency key sent downstream (Q14). Idempotency has to be end-to-end, not just at your boundary.

**The framing:** the crash window cannot be removed, so **design for it instead of trying to eliminate it**. That is what "exactly-once business processing" actually means (Q18).

---

## Q18. How do you guarantee exactly-once business processing?

**You cannot guarantee exactly-once *delivery*** — it is impossible in an asynchronous network with failures (the Two Generals problem). What you can guarantee is **exactly-once *effect***, and stating that distinction precisely is the whole answer.

**The identity to state:**

```
exactly-once effect  =  at-least-once delivery  AND  at-most-once processing
                        └── retries ──┘             └── idempotency ──┘
```

- **At-least-once delivery** ensures nothing is lost: retries, durable queues, the outbox, acknowledgement after processing.
- **At-most-once processing** ensures nothing is applied twice: idempotency keys, dedupe stores, conditional state transitions, unique constraints.

Combine them and the *observable business outcome* is exactly once, even though the message may have been delivered five times.

**The full stack that delivers it, end to end:**

| Layer | Mechanism |
|---|---|
| **Client → API** | Client-generated **idempotency key**; retry with backoff and jitter |
| **API → database** | Key stored **in the same transaction** as the business effect (Q14) |
| **Database → broker** | **Transactional outbox** — no dual write (Q10) |
| **Broker** | At-least-once delivery; producer idempotence enabled |
| **Consumer** | **Dedupe on `eventId`, in the same transaction as the effect** (Q16) |
| **Consumer → external API** | A **downstream idempotency key**, so the provider dedupes too |
| **Cross-service workflow** | **Saga** with idempotent steps and idempotent compensations (Q5–Q7) |
| **End of day** | **Reconciliation** against an external source of truth |

**That last row is the one most candidates omit and the one a fintech panel is listening for.** Even with every mechanism above correct, you reconcile — because the guarantee holds only within the boundaries you control, and payments cross boundaries into systems whose behaviour you must verify rather than assume. The *Designing a Payment System* discipline is explicit that reconciliation against the provider's nightly settlement file is required **even when the provider claims idempotency**. Breaks are classified as auto-resolvable (timing), manual (amount mismatch) or investigate (missing on one side), and the process is a first-class part of the design, not an operations afterthought.

**Two scenarios worked through, which is how I would demonstrate it:**

*Double submit.* The user clicks Pay twice. Both requests carry the **same** idempotency key. The first inserts the key as `IN_PROGRESS` and proceeds; the second sees `IN_PROGRESS` and returns 409. The client polls and gets the original `201`. **One charge.**

*Response lost after the provider succeeded.* We call the provider, it authorises, the network drops the response. We time out and retry — with the **same key we sent originally**. The provider recognises it and returns the original authorisation rather than authorising again. **One charge.** If the provider had no idempotency support, we would instead query its status endpoint by our reference before retrying — and reconcile at end of day regardless.

**The honest closing statement:** *"Exactly-once is a property of the business outcome, achieved by combining reliable delivery with idempotent effects and verified by reconciliation. Anyone who claims exactly-once delivery from the infrastructure is describing something that does not exist."*

---

## Q19. How do CQRS + Saga + Outbox work together?

They solve four different parts of one problem — **doing distributed business operations correctly** — and in a real platform they compose into a single pipeline. Each covers a gap the others leave open.

| Pattern | The problem it owns |
|---|---|
| **CQRS** | Reads and writes have different needs; queries must not compromise the write model or slow it down |
| **Outbox** | The state change and the event must be atomic (no dual write) |
| **Saga** | A business operation spans services with no distributed transaction |
| **Idempotency** | Delivery is at-least-once, so effects must not repeat |

**The composed flow:**

```
 ① COMMAND ARRIVES
    POST /payments  Idempotency-Key: 8f3a…
         │
         ▼  ── idempotency check (Q14): first attempt? ───────────────┐
 ② WRITE SIDE (CQRS command model)                                    │
    ┌─────────────── ONE ACID TRANSACTION ──────────────────┐         │
    │  INSERT idempotency_keys (…, IN_PROGRESS → COMPLETED) │         │
    │  UPDATE payments SET status = 'Authorised'            │         │
    │  INSERT outbox (PaymentAuthorised, aggregate_id=…)    │ ← ③ OUTBOX
    └────────────────────────────────────────────────────────┘        │
         │ commit                                                     │
         ▼                                                            │
 ④ RELAY (poller or Debezium on the outbox) ──▶ Kafka ────────────────┘
         │        partitioned by aggregate_id → per-payment ordering
         ├──────────────▶ ⑤ SAGA ORCHESTRATOR
         │                    ├─ reserve funds     (idempotent, compensatable)
         │                    ├─ post to ledger    (idempotent, compensatable)
         │                    └─ notify merchant   (idempotent, LAST — not compensatable)
         │                    on failure → compensate in reverse (Q7)
         │
         └──────────────▶ ⑥ PROJECTIONS (CQRS read models)
                              payment_summary · merchant_totals · search · settlement extract
                              each: idempotent (⑦), checkpointed, rebuildable
```

**Reading the composition:**

- **② + ③ are one transaction.** This is the linchpin: the state change, the idempotency record and the event are committed together, so there is no window in which they disagree (Q10, Q14).
- **④ decouples publication from the request.** The API responds as soon as the transaction commits; delivery is the relay's problem, and a broker outage delays rather than loses.
- **⑤ and ⑥ are independent consumers of the same event.** The saga drives the workflow forward; the projections update the read side. Neither can block the other, and either can be replayed.
- **⑦ Idempotency appears at every hop** — API, consumer, saga step, downstream provider call. It is not one control, it is a property maintained end to end.
- **Ordering** is preserved per payment because the topic is keyed by `aggregate_id`.

**Where each failure lands:**

| Failure | Absorbed by |
|---|---|
| Client retries the API | Idempotency key → original response returned |
| Crash between DB write and publish | Outbox → relay publishes on recovery |
| Broker unavailable | Outbox → rows accumulate, relay retries; monitor outbox depth |
| Consumer crash after commit | Dedupe record → redelivery is a no-op (Q17) |
| A saga step fails | Compensation in reverse order (Q7) |
| A projection is buggy | Rebuild from the event log; write side untouched (Module 13 Q14) |
| Read model is stale | Bounded, measured lag; critical reads go to the write side (Q4) |

**And the honest note:** this composition is the **high-complexity, high-assurance** configuration. It is right for the payment and ledger path. It is not right for merchant profile management, and applying it uniformly across a platform is over-engineering — the same selective-application advice the Event Sourcing documentation gives (Module 13 Q25).

---

## Q20. Design a distributed order/payment workflow.

A complete design, using everything above. The scenario: **a customer places an order, we take payment, reserve stock, post to the ledger and arrange fulfilment**, across four services with separate databases.

### 1. Services and data ownership

| Service | Owns | Store |
|---|---|---|
| **Order** | Order lifecycle, line items | Aurora PostgreSQL |
| **Payment** | Authorisation, capture, refund, provider integration | Aurora PostgreSQL (event-sourced) |
| **Inventory** | Stock levels, reservations | Aurora PostgreSQL |
| **Ledger** | Double-entry accounting | Aurora PostgreSQL (append-only) |
| **Saga orchestrator** | Workflow state | AWS Step Functions (or a durable state table) |

**Database-per-service**, no shared tables, no cross-service joins (Module 12 Q20).

### 2. The happy path — orchestrated saga

```
① POST /orders   Idempotency-Key: <client-generated>
     Order service: INSERT order (status=Pending) + INSERT outbox(OrderPlaced)  [1 txn]
     → 202 Accepted { orderId, status: "Pending" }        ← honest about async

② Relay → Kafka(orders, key=orderId) → Step Functions starts the saga

③ ReserveStock       → Inventory   (idempotent on orderId; compensatable)
④ AuthorisePayment   → Payment     (idempotent key = orderId; compensatable via void)
⑤ CapturePayment     → Payment     ◀── PIVOT: after this, only go forward
⑥ PostToLedger       → Ledger      (idempotent on paymentId; retry until success)
⑦ ConfirmOrder       → Order       (idempotent; terminal)
⑧ NotifyCustomer     → Notification (idempotent; LAST — cannot be un-sent)
```

**The pivot at ⑤ is a deliberate design decision** (Q7): steps before it can be compensated cheaply; steps after it must be **retried until they succeed**, because capturing money and then failing to post it to the ledger is not something you fix by refunding — you fix it by completing the posting.

### 3. Compensation paths

| Failure at | Compensation, in reverse |
|---|---|
| ③ ReserveStock | Cancel the order. Nothing else has happened |
| ④ Authorise | `ReleaseStock` → `CancelOrder` |
| ⑤ Capture | `VoidAuthorisation` → `ReleaseStock` → `CancelOrder` |
| ⑥ Ledger | **No compensation** — retry with backoff; after N attempts, DLQ + alert + manual intervention. Money has moved; the record must catch up |
| ⑦/⑧ | Retry; never unwind a captured payment for a notification failure |

### 4. Idempotency at every hop

- **Client → Order API**: `Idempotency-Key` header, key stored in the same transaction as the order (Q14).
- **Saga → each service**: the saga passes `orderId` (or a step-scoped key) as the idempotency key, so a retried step is a no-op.
- **Payment → provider**: our own idempotency key sent downstream so the provider dedupes (Q18).
- **Every consumer**: dedupe on `eventId` in the same transaction as the effect (Q16).
- **Backstop**: unique constraints — `orders(client_reference)`, `payments(order_id)`, `ledger_entries(payment_id, leg)`. **The database refuses a duplicate even if every application-level control fails.**

### 5. Outbox everywhere

Every service that changes state and publishes an event does both **in one transaction** and lets a Debezium-filtered relay publish from the outbox table (Q12). No service ever calls the broker inside its business transaction.

### 6. CQRS read models

| Read model | Store | Serves |
|---|---|---|
| `order_status` | PostgreSQL | Customer order page |
| `order_search` | OpenSearch | Customer-service lookup |
| `merchant_daily` | PostgreSQL (aggregated) | Merchant dashboard |
| `settlement_extract` | S3 (Parquet) | Nightly reconciliation, regulatory reporting |

All eventually consistent, checkpointed, rebuildable — **except** the authorisation and limit checks, which read the **write side** because a stale balance is a financial error (Q4).

### 7. Consistency, UX and the intermediate state

- The API returns **202 Accepted with `status: Pending`** and a status URL. Do not pretend an eventually-consistent workflow is synchronous.
- The order page renders the saga's current step, so "Pending payment" is visible rather than confusing.
- **Semantic lock**: the order carries `status=Pending`, and no other process may act on a pending order — this is how you manage the saga's lack of isolation (Q5).

### 8. Failure handling and operations

- **Timeouts on every saga step**, with the "unknown outcome" path querying the downstream's status endpoint by our reference rather than blindly retrying.
- **Retries** with exponential backoff and jitter, at **one layer only** (the saga), with a retry budget — never nested retries at every hop (Module 11 Q27).
- **DLQ + alert** for terminal failures; a stuck saga is a business problem with an owner, not a silent state.
- **Correlation ID** propagated end to end; the saga instance ID is the answer to "where is order X?".
- **Metrics**: saga completion rate, per-step duration and failure rate, compensation rate, outbox depth, projection lag, DLQ depth, **and reconciliation breaks**.

### 9. Nightly reconciliation

The `settlement_extract` is compared against the payment provider's settlement file and against the ledger. Breaks are classified auto-resolvable / manual / investigate. **This runs regardless of how confident we are in the design** — it is the control that catches what the code cannot (Q18).

### 10. What I would deliberately not do

- **No two-phase commit** across services.
- **No synchronous chain** of HTTP calls through four services — one slow dependency would fail the whole order.
- **No choreography** for this flow: five steps with compensations and timeouts needs a visible, queryable state machine (Q6).
- **No shared database** "just for reporting" — reporting reads the projections and the data lake.

**The closing framing:** every step is **idempotent**, every state change is **atomic with its event**, every failure has either a **compensation or an escalation**, every read is explicitly classified as **strong or eventual**, and the whole thing is **reconciled against an external source of truth**. Those five properties are what make a distributed money-movement workflow trustworthy — the patterns are just the means of achieving them.

---

## References — official documentation

| Topic | Source |
|---|---|
| Azure Architecture Center — CQRS pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs |
| Azure Architecture Center — Saga pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/saga |
| Azure Architecture Center — Choreography pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/choreography |
| Azure Architecture Center — Compensating Transaction pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction |
| Azure Architecture Center — Idempotent Consumer pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/idempotent-consumer |
| Azure Architecture Center — Materialized View pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view |
| Azure Architecture Center — Event Sourcing pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing |
| Azure Architecture Center — Retry pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/retry |
| Azure Architecture Center — Cloud design patterns catalogue | https://learn.microsoft.com/en-us/azure/architecture/patterns/ |
| Microsoft Learn — .NET microservices: CQRS and DDD patterns | https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ |
| Microsoft Learn — implementing reads/queries in a CQRS microservice | https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/cqrs-microservice-reads |
| Microsoft Learn — integration events and the event bus | https://learn.microsoft.com/en-us/dotnet/architecture/microservices/multi-container-microservice-net-applications/integration-event-based-microservice-communications |
| Microsoft Learn — implementing idempotent message processing | https://learn.microsoft.com/en-us/dotnet/architecture/microservices/multi-container-microservice-net-applications/subscribe-events#designing-atomicity-and-resiliency-when-updating-the-database-and-publishing-to-the-event-bus |
| AWS Prescriptive Guidance — Transactional outbox pattern | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html |
| AWS Prescriptive Guidance — Saga pattern | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga.html |
| AWS Prescriptive Guidance — CQRS pattern | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/cqrs.html |
| AWS Prescriptive Guidance — Event sourcing pattern | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/event-sourcing.html |
| AWS — Step Functions (saga orchestration) | https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html |
| AWS — implementing the saga pattern with Step Functions | https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/saga-pattern.html |
| AWS — DynamoDB TTL (idempotency key expiry) | https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html |
| AWS Lambda Powertools — idempotency | https://docs.powertools.aws.dev/lambda/dotnet/utilities/idempotency/ |
| AWS Database Migration Service — CDC | https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Task.CDC.html |
| Debezium documentation | https://debezium.io/documentation/reference/stable/index.html |
| Debezium — outbox event router | https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html |
| Apache Kafka — message delivery semantics | https://kafka.apache.org/documentation/#semantics |
| Apache Kafka — transactions / exactly-once | https://kafka.apache.org/documentation/#semantics_exactly_once |
| RFC 9110 — HTTP semantics (idempotent methods) | https://www.rfc-editor.org/rfc/rfc9110#name-idempotent-methods |
| IETF draft — the Idempotency-Key HTTP header field | https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/ |
| Stripe API — idempotent requests | https://docs.stripe.com/api/idempotent_requests |
| microservices.io — Saga, Outbox, Idempotent Consumer patterns | https://microservices.io/patterns/data/saga.html |
| MassTransit — outbox and saga state machines | https://masstransit.io/documentation/patterns/saga |

---

**Previous:** [13 — Event Sourcing](./13-Event-Sourcing.md) | **Next:** [15 — Security](./15-Security.md)
