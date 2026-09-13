> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: [[12-Database-Design]]

# SQL Server Interview Workbook — SQL Server & Microservices

This file covers how a relational SQL Server database behaves once it stops being "the database" for a monolith and becomes one service's private store in a distributed system — ownership boundaries, cross-service consistency, and the patterns (Outbox, CDC, CQRS, idempotency, reconciliation) that make a transactional database work safely alongside services it can no longer join against.

**Canonical sample schema used throughout this file:**

```sql
CREATE TABLE Customers (
    CustomerID   INT IDENTITY PRIMARY KEY,
    CustomerName VARCHAR(200) NOT NULL,
    Country      VARCHAR(100) NOT NULL
);

CREATE TABLE Orders (
    OrderID      INT IDENTITY PRIMARY KEY,
    CustomerID   INT NOT NULL,
    OrderDate    DATETIME2 NOT NULL,
    TotalAmount  DECIMAL(18,2) NOT NULL
);
```

---

### Q127. What is the database-per-service pattern, and what does it cost you operationally that a shared database doesn't?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Database-per-service means each microservice owns a private schema (ideally a private database/instance) that no other service touches directly. Other services never run a `SELECT` or `JOIN` against it — they only reach it through that service's API or its published events. It's the mechanism that actually makes a "service boundary" real, because a shared database is a shared mutable contract regardless of how cleanly you've drawn box-and-line diagrams on top of it.

**2. SQL Query**
```sql
-- OrdersService database — Orders schema is private to this service
CREATE DATABASE OrdersServiceDb;
GO
USE OrdersServiceDb;
GO
CREATE TABLE dbo.Orders (
    OrderID      INT IDENTITY PRIMARY KEY,
    CustomerID   INT NOT NULL,          -- foreign concept, NOT a physical FK to another service's DB
    OrderDate    DATETIME2 NOT NULL,
    TotalAmount  DECIMAL(18,2) NOT NULL,
    Status       VARCHAR(20) NOT NULL
);
-- No FOREIGN KEY to a Customers table in CustomerService's database —
-- that constraint cannot exist across database/instance boundaries in SQL Server.
```

**3. Explain the Query**
`CustomerID` is stored as a plain integer, not enforced by a `FOREIGN KEY` constraint, because SQL Server cannot enforce referential integrity across two separate databases (let alone two separate instances) transactionally. The OrdersService trusts that `CustomerID` was valid at the time the order was created (validated via a synchronous call or a cached local copy of customer data) rather than the database enforcing it.

**4. Sample Data**
`OrdersServiceDb.dbo.Orders`: `(1, 501, '2026-09-01', 249.99, 'CAPTURED')` — `CustomerID = 501` refers to a row that physically lives in `CustomerServiceDb`, a database this service cannot query.

**5. Expected Output**
N/A — this is a schema/architecture question, not a query-result question.

**6. Alternative Solutions**
- **Shared database, multiple services** — simplest to build, but couples every service to one schema's change cadence; rejected for anything beyond a small team (see Q128).
- **Database-per-service with a shared instance, separate schemas** — a common middle ground: one SQL Server instance, one schema (or database) per service, cross-schema queries blocked by permissions rather than physical separation. Cheaper to operate (one instance to patch/back up) while still preventing cross-service `JOIN`s.
- **Database-per-service with dedicated instances/servers** — full isolation, independent scaling and failure domains, but the most expensive to operate (N times the licensing, patching, backup, and DR work).
I prefer schema-per-service on a shared instance for small-to-mid-size estates, graduating specific services to dedicated instances only when they have distinct scaling, compliance, or blast-radius requirements (e.g., a payments ledger).

**7. Performance**
No cross-database `JOIN` means no query-optimizer statistics spanning services — every "join" becomes an application-level fan-out (call Service A, then call Service B with the IDs from A), which trades one fast SQL `JOIN` for N network round trips. This is the single biggest performance regression teams hit when they first split a monolith's database — mitigate with batched lookups (`WHERE Id IN (...)`) and caching, not by quietly re-adding a cross-service `JOIN`.

**8. Edge Cases**
- A `CustomerID` that was valid when the order was placed but is later deleted in `CustomerService` — the FK integrity guarantee is gone; you need either soft-deletes in the owning service or tolerance for "orphaned" foreign references in downstream services.
- Two services independently caching a duplicated slice of the same conceptual entity can silently disagree (see Q135 reconciliation).

**9. Production Scenario**
An OrdersService that used to `JOIN` against a shared `Customers` table for the shipping address, post-split, calls `CustomerService.GetShippingAddress(customerId)` at order-creation time and stores a denormalized copy of the address on the order row — because "the address at the time of the order" is actually the correct business semantic, not "the current address," which a live `JOIN` would have given you anyway.

**10. Interview Follow-ups**
- What happens when two services need the same reference data (e.g., both Orders and Billing need "customer country" for tax rules)?
- How do you handle a report that needs to join data owned by five different services?
- What's the difference between database-per-service and schema-per-service?
- How do you migrate a monolith's shared database into database-per-service without downtime?

**11. Follow-up Answers**
- Duplicate the reference data locally (denormalize) and keep it in sync via events (CDC/outbox from the owning service), accepting eventual consistency — don't call out synchronously on every read.
- Cross-service reporting moves out of OLTP entirely: a CQRS-style read model or a data warehouse/lakehouse fed by CDC from every service's database, queried with normal SQL there instead of in production OLTP databases.
- Schema-per-service still shares an instance (and its resource contention, patching cadence, and disaster-recovery boundary); database-per-service isolates all of that. Schema-per-service is a pragmatic first step, not the end state, for services with heavy or sensitive workloads.
- The strangler-fig pattern: introduce a new service that owns writes to a subset of tables first, keep the monolith reading a replicated/synced copy, migrate reads next, then physically move the tables — never a big-bang cutover.

**12. Common Mistakes**
Drawing "database-per-service" on an architecture diagram while leaving cross-service foreign keys and ad-hoc reporting queries against other services' tables in place — the diagram says microservices, the database says distributed monolith.

**13. Architect Insight**
A Staff engineer says "each service should own its data." A Principal/Architect says "each service owns its data, which means every place a `JOIN` used to buy you a consistency guarantee for free, something else — a compensating call, an event, or an accepted staleness window — has to buy it back, and that trade is what you're actually approving when you sign off on the split."

---

### Q128. What specifically breaks when multiple services share one database?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
A shared database turns the schema into a de facto public API that every consuming service depends on, but — unlike a versioned REST API — it has no contract, no versioning, and no way to know who's using which column. Any schema change (rename a column, tighten a constraint, add a `NOT NULL`) risks silently breaking a service you don't own and may not even know exists.

**2. SQL Query**
```sql
-- Service A owns this table conceptually, but Service B silently depends on it too
ALTER TABLE dbo.Orders ALTER COLUMN Status VARCHAR(10) NOT NULL; -- was VARCHAR(20)
-- Service B's stored value 'PENDING_REVIEW' (14 chars) now fails or truncates —
-- nothing in this ALTER statement tells you Service B exists.
```

**3. Explain the Query**
The `ALTER TABLE` statement is syntactically valid and succeeds against the schema in isolation. Its blast radius — every service that reads or writes `Orders.Status` — is invisible to SQL Server and to the engineer running the migration; only integration tests or production errors surface it, usually after deployment.

**4. Sample Data**
Before: `Orders.Status VARCHAR(20)` containing `'PENDING_REVIEW'`. After the narrowing `ALTER`, an `INSERT`/`UPDATE` from Service B using that value now throws `String or binary data would be truncated`.

**5. Expected Output**
A runtime error in a service that was never touched by the deploying team, discovered in production rather than in Service A's own test suite.

**6. Alternative Solutions**
- **Contract tests against a shared schema** — better than nothing, but only catches drift you remembered to write a test for; doesn't stop the next undocumented consumer.
- **Database views as a stable façade** — reduces coupling to physical table shape but still shares one transactional resource (locks, connection pool, IO) across every "service," so a runaway query in one still degrades all.
- **Split the database along service boundaries (Q127)** — the actual fix; I prefer this because it converts an implicit, unenforceable contract into an explicit, versionable one (an API), even though it costs more up front.

**7. Performance**
Beyond the coupling problem, a shared database is a shared resource: one service's badly-indexed report query, or a long-running transaction holding locks, degrades every other "service's" latency and throughput — there is no per-service resource isolation (CPU, memory grants, lock queues) inside one SQL Server instance and database.

**8. Edge Cases**
- Two services updating the same row concurrently with no shared understanding of the row's state machine can produce a value neither service's business logic ever intended to write.
- A migration that adds a `NOT NULL` column with no default breaks every other service's existing `INSERT` statements the instant it deploys, regardless of who wrote the migration.

**9. Production Scenario**
A "Reporting" job someone wrote three years ago runs a nightly `SELECT *` with no `WITH (NOLOCK)` against the live `Orders` table shared with the checkout service; during a Black-Friday-scale sale, the reporting job's read locks under a pessimistic isolation level start blocking checkout's writes, and nobody who owns checkout even knows the reporting job exists.

**10. Interview Follow-ups**
- If splitting the database isn't possible immediately, what's a lower-cost mitigation?
- How do you even discover all the hidden consumers of a shared database before attempting a migration?
- Is a shared *read replica* an acceptable middle ground?

**11. Follow-up Answers**
- Introduce database views/synonyms as an explicit façade, put every consumer behind them, and use `sys.dm_exec_sessions`/`sys.dm_exec_requests` combined with `Application Name` in connection strings to at least see who's connecting to what — a manual but necessary discovery step before any migration.
- Auditing tools (Extended Events sessions capturing object access, or SQL Server Audit) run for a few weeks to build a real dependency map before touching schema.
- A shared *read* replica for reporting is a reasonable compromise for read-only, latency-tolerant consumers — it still doesn't solve the "public schema as an API" coupling problem for writers.

**12. Common Mistakes**
Believing that splitting the *application* into microservices while leaving one shared database "for now" is a temporary, low-risk stepping stone — in practice it's the step that never gets undone, because unwinding a shared schema after N services depend on it is far harder than the original split would have been.

**13. Architect Insight**
The junior framing is "shared database = less duplication, more efficient." The architect framing is "duplication of *data* is cheap and recoverable; coupling of *services through an unversioned shared schema* is expensive and often irreversible — optimize against the second cost, not the first."

---

### Q129. Why are distributed transactions (two-phase commit / MSDTC) generally avoided across microservices at scale?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
Two-phase commit (2PC) via MSDTC gives you atomicity across two SQL Server instances, but it does so by holding locks on both databases for the entire duration of the coordinator's prepare/commit round trip — including while any *one* participant or the coordinator itself is down. In a distributed system where services scale independently, deploy independently, and fail independently, that synchronous, lock-holding coordination point becomes the availability ceiling for the whole transaction: the system is only as available as its least available participant, for as long as the slowest one takes to respond.

**2. SQL Query**
```sql
-- Coordinator sees this from Service A's perspective — MSDTC required
BEGIN DISTRIBUTED TRANSACTION;
    UPDATE OrdersServiceDb.dbo.Orders SET Status = 'CONFIRMED' WHERE OrderID = 1001;
    -- Linked server call to a second instance, e.g. InventoryServiceDb
    UPDATE [InventoryServer].InventoryServiceDb.dbo.Stock SET Quantity = Quantity - 1 WHERE ProductID = 55;
COMMIT TRANSACTION;
```

**3. Explain the Query**
`BEGIN DISTRIBUTED TRANSACTION` enlists MSDTC as the transaction coordinator. Both `UPDATE`s take and hold locks on their respective rows from the moment they execute until the coordinator has confirmed both participants voted "prepared" and issued the final `COMMIT` — meaning `Orders` and `Stock` rows stay locked for the full round-trip latency between two servers, not just for one server's local commit.

**4. Sample Data**
`OrdersServiceDb.dbo.Orders(1001, ..., 'PENDING')`, `InventoryServiceDb.dbo.Stock(55, Quantity=10)`.

**5. Expected Output**
On success: `Orders.Status = 'CONFIRMED'` and `Stock.Quantity = 9`, committed atomically. On coordinator/network failure mid-protocol: an **in-doubt transaction** — one or both participants left blocked, holding locks, until an administrator manually resolves it (`KILL '<UOW>' WITH DISTRIBUTED_TRAN` or via MSDTC's transaction list).

**6. Alternative Solutions**
- **2PC/MSDTC** — strong atomicity, but couples the *availability* of both services together and doesn't scale past a handful of tightly-coupled participants; also unsupported outright by many managed cloud databases.
- **Saga pattern (orchestrated or choreographed)** — each service commits its own local transaction independently, and a coordinator (or the events themselves) drives compensating actions if a later step fails; no distributed lock is ever held, at the cost of the system passing through visibly inconsistent intermediate states.
- **Transactional Outbox + eventual consistency (Q130)** — avoid the need for cross-service atomicity altogether by making each step "commit locally, publish reliably" and reconciling asynchronously.
I prefer Sagas with the Outbox pattern for anything beyond two participants: 2PC's blocking behavior is precisely the failure mode financial and e-commerce systems can least afford under load.

**7. Performance**
2PC transaction duration is bounded by the *slowest* participant plus network latency between them, and it holds row/page locks on every participant for that entire window — under load this multiplies blocking and dramatically reduces throughput compared to N independent local transactions.

**8. Edge Cases**
- Coordinator crash after sending `PREPARE` but before `COMMIT`/`ABORT` reaches all participants — the classic 2PC blocking problem; participants sit "in doubt," holding locks, until the coordinator recovers or an operator intervenes.
- Network partition between coordinator and one participant mid-transaction — that participant remains blocked indefinitely.
- Many managed database services (including some cloud SQL Server offerings) don't support MSDTC/distributed transactions at all, so the pattern doesn't even survive certain infrastructure choices.

**9. Production Scenario**
An order-and-inventory flow originally built as one 2PC transaction across two SQL Server instances was rearchitected into a Saga: OrdersService commits `PENDING` locally and publishes `OrderPlaced`; InventoryService reserves stock locally and publishes `StockReserved` or `StockUnavailable`; OrdersService reacts to the latter by moving the order to `CANCELLED` and publishing a compensating `OrderCancelled` event — every step is a fast, independent local transaction, and the "distributed transaction" is really a sequence of local ones stitched together by events.

**10. Interview Follow-ups**
- How does a Saga handle the case where a compensating action itself fails?
- What does "in-doubt transaction" mean operationally, and how do you resolve one in production?
- When, if ever, is 2PC still the right call?

**11. Follow-up Answers**
- Compensating actions must themselves be retried with backoff and eventually escalated to a dead-letter/manual-intervention queue if they keep failing — a compensation that can fail needs the same retry/idempotency discipline as the forward action (see Q134/Q143).
- Check `sys.dm_tran_distributed_transaction` / MSDTC's Component Services snap-in; an in-doubt transaction is manually committed or aborted by an operator based on which participants actually applied their local change — this is exactly the operational cost that makes teams avoid 2PC.
- 2PC remains defensible for a small, fixed number of tightly-coupled participants inside a single trust/failure domain with low latency between them (e.g., two databases in the same data center, both owned by the same team) — not across independently-deployed, independently-scaled microservices.

**12. Common Mistakes**
Reaching for `BEGIN DISTRIBUTED TRANSACTION` as a drop-in replacement for a local transaction the moment a second database enters the picture, without accounting for the availability coupling it introduces.

**13. Architect Insight**
A Staff engineer explains 2PC's mechanics correctly. A Principal/Architect explains why the *business* usually doesn't actually need atomicity across service boundaries — it needs *eventual correctness with a bounded, observable reconciliation window* — and picks the Saga because it matches what the business actually requires instead of over-delivering a stronger, more fragile guarantee.

---

### Q130. How do you implement the Transactional Outbox pattern with SQL Server?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
The Outbox pattern solves "how do I atomically commit a business change AND guarantee a message about it gets published" without a distributed transaction: you write the business row and an outbox row describing the event to publish in the *same local SQL Server transaction*, so they either both commit or both roll back. A separate process (CDC, or a polling publisher) then reads committed outbox rows and publishes them to the message broker, at-least-once, marking them processed afterward.

**2. SQL Query**
```sql
CREATE TABLE dbo.OutboxMessages (
    OutboxID      BIGINT IDENTITY PRIMARY KEY,
    AggregateType VARCHAR(100) NOT NULL,
    AggregateID   VARCHAR(100) NOT NULL,
    EventType     VARCHAR(100) NOT NULL,
    Payload       NVARCHAR(MAX) NOT NULL,     -- JSON event body
    CreatedAt     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ProcessedAt   DATETIME2 NULL
);

BEGIN TRANSACTION;
    UPDATE dbo.Orders SET Status = 'CONFIRMED' WHERE OrderID = 1001;

    INSERT INTO dbo.OutboxMessages (AggregateType, AggregateID, EventType, Payload)
    VALUES ('Order', '1001', 'OrderConfirmed',
            N'{"orderId":1001,"status":"CONFIRMED","confirmedAt":"2026-09-13T10:00:00Z"}');
COMMIT TRANSACTION;

-- Publisher process, polling (simplest variant):
SELECT TOP (100) OutboxID, EventType, Payload
FROM dbo.OutboxMessages
WHERE ProcessedAt IS NULL
ORDER BY OutboxID;
-- after successful publish to the broker:
UPDATE dbo.OutboxMessages SET ProcessedAt = SYSUTCDATETIME() WHERE OutboxID IN (/* published ids */);
```

**3. Explain the Query**
Both the business `UPDATE` and the outbox `INSERT` execute inside one `BEGIN TRANSACTION ... COMMIT` block, so SQL Server's own atomicity guarantee — not a distributed coordinator — is what ties them together: if the process crashes before `COMMIT`, neither row exists; if it crashes after, both do. The publisher's `SELECT ... WHERE ProcessedAt IS NULL` picks up anything committed-but-unpublished, including messages left behind by a publisher crash between reading and marking-processed, which is why the publish step must be idempotent downstream (see Q134).

**4. Sample Data**
`Orders(1001, ..., 'CONFIRMED')`, `OutboxMessages(55, 'Order', '1001', 'OrderConfirmed', '{...}', '2026-09-13T10:00:00', NULL)`.

**5. Expected Output**
After the publisher runs successfully: the same row with `ProcessedAt = '2026-09-13T10:00:05'`, and the `OrderConfirmed` event delivered to every downstream consumer at least once.

**6. Alternative Solutions**
- **Polling publisher (shown above)** — simple, works everywhere, but adds polling latency and load on the table; needs an index on `(ProcessedAt, OutboxID)` and a retention/cleanup job so the table doesn't grow unbounded.
- **CDC-based publisher (Q131)** — a log-reader process tails SQL Server's transaction log via Change Data Capture instead of polling, giving near-real-time delivery with far less query load; more moving parts to operate (CDC capture job, log reader).
- **Debezium-style log-tailing connector** — the industry-standard implementation of the CDC variant, purpose-built for exactly this Outbox-to-Kafka pipeline.
I prefer CDC/log-tailing for high-throughput services (lower latency, no polling overhead on the OLTP table) and a simple polling publisher for lower-volume services where operational simplicity wins.

**7. Performance**
A hot `OutboxMessages` table needs a filtered index (`WHERE ProcessedAt IS NULL`) so the publisher's poll stays a cheap seek even as the processed-history grows into millions of rows; a periodic job should archive or delete processed rows past a retention window (e.g., 7 days) to keep the table — and that filtered index — small.

**8. Edge Cases**
- Publisher crashes after publishing to the broker but before marking `ProcessedAt` — the message is republished on the next poll; downstream consumers must be idempotent (this is "at-least-once," not "exactly-once," delivery — see the exactly-once identity discussed in this repo's System Design material).
- The business transaction rolls back for an unrelated reason (e.g., a check constraint violation later in the same transaction) — the outbox `INSERT` rolls back with it, correctly producing *no* event, which is the entire point of doing both writes in one transaction.

**9. Production Scenario**
A payments service publishes `PaymentCaptured` events for downstream ledger posting and notification services exclusively through an Outbox table read by a Debezium connector into Kafka — this is what lets the payments team guarantee "if the capture is recorded, the event *will* eventually be delivered," without ever opening a distributed transaction against Kafka.

**10. Interview Follow-ups**
- How do you guarantee event ordering per aggregate when using a polling publisher?
- How do you clean up the outbox table without losing not-yet-published rows?
- What happens if the publisher process itself has multiple instances running concurrently?

**11. Follow-up Answers**
- Order by `OutboxID` (or a per-aggregate sequence) and publish/mark-processed in that order per `AggregateID`, or partition the downstream topic by `AggregateID` so ordering is preserved per aggregate even if global ordering isn't.
- Only delete rows where `ProcessedAt IS NOT NULL AND ProcessedAt < @retentionCutoff` — never delete unprocessed rows, and run the cleanup as a separate, low-priority batch job outside business-transaction hours.
- Use `UPDLOCK`/`READPAST` hints (`SELECT ... WITH (UPDLOCK, READPAST)`) or a claim-based design (`UPDATE TOP (100) ... SET ClaimedBy = @instanceId, ClaimedAt = ... OUTPUT ...`) so multiple publisher instances don't double-claim and double-publish the same rows.

**12. Common Mistakes**
Writing the business row and then calling the message broker directly in the same request, "and it's usually fine" — that's exactly the dual-write problem the Outbox pattern exists to eliminate: the two operations aren't atomic, so a crash between them silently drops the event or, worse, publishes an event for a write that then rolls back.

**13. Architect Insight**
The Staff-level answer implements the Outbox table correctly. The Principal/Architect-level answer also owns the *publisher's* failure modes — claim semantics under multiple instances, retention, ordering per aggregate, and the explicit acknowledgment that this buys at-least-once delivery, pushing the exactly-once burden onto idempotent consumers (Q134) rather than pretending the Outbox alone solves exactly-once.

---

### Q131. How does SQL Server's Change Data Capture (CDC) work, and how is it used for cross-service synchronization?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
CDC records `INSERT`/`UPDATE`/`DELETE` activity on tracked tables by reading the SQL Server transaction log — the same log that already exists for crash recovery — and populating change tables that mirror the source table's columns plus metadata (the operation type, the LSN, which columns changed). Downstream consumers query those change tables (or a tool like Debezium tails them) instead of the source table directly, which is what lets another service — or the Outbox publisher in Q130 — see every committed change without polling the business table itself.

**2. SQL Query**
```sql
-- One-time setup
EXEC sys.sp_cdc_enable_db;                      -- enable CDC at the database level
EXEC sys.sp_cdc_enable_table
    @source_schema = N'dbo',
    @source_name   = N'Orders',
    @role_name     = NULL,
    @supports_net_changes = 1;

-- Querying captured changes
DECLARE @from_lsn BINARY(10) = sys.fn_cdc_get_min_lsn('dbo_Orders');
DECLARE @to_lsn   BINARY(10) = sys.fn_cdc_get_max_lsn();

SELECT __$operation,   -- 1=delete, 2=insert, 3=update(before), 4=update(after)
       OrderID, Status, TotalAmount
FROM cdc.fn_cdc_get_all_changes_dbo_Orders(@from_lsn, @to_lsn, N'all');
```

**3. Explain the Query**
`sp_cdc_enable_db` provisions the `cdc` schema and its supporting jobs (a capture job that reads the log, a cleanup job that ages out old change data); `sp_cdc_enable_table` starts tracking `Orders` specifically, creating `cdc.dbo_Orders_CT` behind the scenes. `fn_cdc_get_all_changes_dbo_Orders` returns every net or all-column change between two log sequence numbers, with `__$operation` telling the consumer exactly what kind of change each row represents — `4` (the post-image of an update) is typically what a synchronization consumer cares about.

**4. Sample Data**
`Orders` row `(1001, 501, '2026-09-01', 249.99, 'PENDING')` updated to `Status = 'CONFIRMED'`.

**5. Expected Output**
`cdc.fn_cdc_get_all_changes_dbo_Orders` returns two rows for that update: `__$operation = 3` with `Status='PENDING'` (before-image) and `__$operation = 4` with `Status='CONFIRMED'` (after-image).

**6. Alternative Solutions**
- **Native SQL Server CDC (shown above)** — built-in, no extra infrastructure beyond SQL Server Agent, but ties you to polling the change functions or to a connector that understands SQL Server CDC's specific table shape.
- **Debezium SQL Server connector** — wraps native CDC and streams changes directly into Kafka with schema-aware serialization, widely used as the "log-tailing Outbox publisher" from Q130.
- **Triggers writing to an explicit Outbox table** — avoids CDC/log-reading infrastructure entirely by making the event-shape an explicit application concern (this is the pattern in Q130); less "automatic" but the event payload is exactly what the business meant, rather than a raw column diff.
I prefer explicit Outbox + CDC-as-transport (Debezium reading the Outbox table, not the business table) over CDC directly on business tables — CDC on the business table couples every downstream consumer to your internal schema shape, exactly the shared-database problem from Q128, just moved one layer down.

**7. Performance**
CDC reads the transaction log asynchronously via SQL Server Agent jobs, so it adds negligible overhead to the OLTP write path itself, but change tables and their supporting indexes do consume additional storage and I/O, and unbounded retention will grow `cdc.dbo_Orders_CT` indefinitely — configure the cleanup job's retention period deliberately.

**8. Edge Cases**
- CDC must be enabled (`sp_cdc_enable_db`/`sp_cdc_enable_table`) before the changes you care about occur — it does not retroactively capture history.
- If the SQL Server Agent capture job is stopped or falls behind, changes queue up in the transaction log, which can delay log truncation and grow the log file — CDC lag is an operational metric worth alerting on, not a "fire and forget" feature.
- Schema changes on a CDC-enabled table (adding/dropping columns) require re-evaluating the capture instance; naive `ALTER TABLE` can leave the change table out of sync with the source shape.

**9. Production Scenario**
A CDC capture instance on the `Orders` table (or, preferably, on the `OutboxMessages` table from Q130) feeds a Debezium connector that publishes to a Kafka topic consumed by a downstream `ReportingService`, which builds its own denormalized read model — this is the physical mechanism behind the CQRS read model discussed in Q133.

**10. Interview Follow-ups**
- Why prefer CDC on an Outbox table over CDC directly on business tables?
- What operational metric tells you CDC is falling behind?
- Does CDC replace the need for the Outbox pattern?

**11. Follow-up Answers**
- CDC-on-business-table exposes your internal column shape and every schema refactor as a breaking change to downstream consumers; CDC-on-Outbox exposes only the deliberately-designed event payload, keeping the internal schema free to evolve.
- Compare the capture job's latest processed LSN against the current max LSN (`sys.fn_cdc_get_max_lsn`), or monitor `sys.dm_cdc_log_scan_sessions`; a growing gap means the capture job is falling behind the write rate.
- No — CDC is a *transport/capture mechanism*; Outbox is the *pattern that guarantees the event was ever correctly written in the first place*. Using CDC to read directly off business tables without an Outbox still risks publishing partial/inconsistent state if a multi-table business transaction is only half-reflected in what CDC happens to have captured at query time.

**12. Common Mistakes**
Enabling CDC on every table "just in case" without a retention/cleanup plan, and without ever measuring capture-job lag — CDC becomes invisible technical debt that silently grows storage and eventually causes transaction-log growth issues.

**13. Architect Insight**
A Staff engineer knows CDC exists and can enable it. A Principal/Architect uses CDC as *infrastructure* underneath a deliberately-designed Outbox contract, so the event schema downstream services depend on is a first-class design artifact — not an accidental byproduct of whatever columns happen to be in the source table today.

---

### Q132. What does "eventual consistency" actually mean for a SQL-Server-backed service, and what are the practical implications?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Inside one SQL Server transaction you still get full ACID guarantees — that never changes. "Eventual consistency" describes what happens *between* services: Service A commits locally and publishes an event; Service B hasn't consumed it yet. For some window of time — milliseconds to, under backpressure, much longer — the two services' views of "the same" business fact disagree, and the system has to be designed so that window is safe (nothing reads B's stale view and makes an irreversible decision on it) and bounded (there's a way to detect and correct drift, per Q135).

**2. SQL Query**
```sql
-- OrdersService (source of truth for order status) — committed and consistent immediately
SELECT OrderID, Status FROM OrdersServiceDb.dbo.Orders WHERE OrderID = 1001;   -- 'CONFIRMED'

-- ReportingService's denormalized copy — consistent only as of its last consumed event
SELECT OrderID, Status FROM ReportingServiceDb.dbo.OrderSummary WHERE OrderID = 1001; -- may still show 'PENDING'
```

**3. Explain the Query**
Both queries are simple, fully consistent reads *within their own database* — SQL Server guarantees that. The inconsistency is not a database bug; it's the designed lag between "OrdersService committed the new status" and "ReportingService's event consumer processed the resulting message and applied it to its own table."

**4. Sample Data**
Event `OrderConfirmed{orderId:1001}` published at `10:00:00.000`, consumed and applied to `ReportingServiceDb.dbo.OrderSummary` at `10:00:00.850` — an 850ms consistency window under normal load.

**5. Expected Output**
A read against `ReportingServiceDb` between `10:00:00.000` and `10:00:00.850` returns stale (`'PENDING'`) data; after `10:00:00.850` it's correct.

**6. Alternative Solutions**
- **Accept the staleness window, document it** — appropriate for reporting/analytics/read-model use cases where "as of a few hundred ms/seconds ago" is fine.
- **Read-your-writes via the owning service** — for the specific case of "the user who just placed the order needs to see it confirmed," route that read back to OrdersService (the source of truth) rather than the eventually-consistent read model, at least for a short post-write window.
- **Synchronous cross-service call instead of eventing** — eliminates the staleness window entirely but reintroduces the availability coupling from Q129; only appropriate where the caller genuinely cannot tolerate any staleness and can accept the coupling.
I prefer read-your-writes routing for user-facing "did my action succeed" checks, and pure eventual consistency (with monitoring) for everything else — solving 100% of consistency cases synchronously defeats the purpose of splitting the services in the first place.

**7. Performance**
Eventual consistency is what *buys* the performance and availability benefits of the split: OrdersService's write path never blocks on ReportingService being available or fast, at the cost of ReportingService's reads occasionally lagging.

**8. Edge Cases**
- Consumer processes events out of order (network retries, competing consumer groups) — without a per-aggregate ordering guarantee (see Q130's ordering follow-up), a stale event can overwrite a newer state.
- A consumer that's down for an extended period accumulates a large backlog; when it recovers, the "eventual" window can stretch to minutes or hours — dashboards and alerting need to treat consumer lag as a first-class SLO, not an afterthought.

**9. Production Scenario**
A trading-desk risk dashboard built as a CQRS read model from trade-execution events is explicitly labeled "as of {last-updated timestamp}" in the UI, and a separate alert fires if consumer lag exceeds a defined threshold (e.g., 5 seconds) — making the eventual-consistency window an observable, bounded, and communicated property of the system rather than a silently-assumed one.

**10. Interview Follow-ups**
- How do you communicate an eventually-consistent read to an end user without confusing them?
- How do you test a system for eventual-consistency bugs?
- What's the difference between eventual consistency and "the database is inconsistent" (a bug)?

**11. Follow-up Answers**
- Show a "last updated" timestamp, a subtle "syncing" indicator, or route the specific read that needs freshness back to the source-of-truth service — never silently present stale data as if it were current with no signal.
- Inject artificial consumer lag/delay in a staging environment and verify the UI/business logic degrades gracefully rather than assuming zero lag; also test consumer restart/backlog-catch-up behavior explicitly.
- Eventual consistency is a *designed, bounded, self-correcting* lag between two independently-committed sources of truth; database inconsistency is an *unbounded, undetected* divergence with no reconciliation mechanism — the presence of Q135's reconciliation process is what turns the former into something safe.

**12. Common Mistakes**
Treating "eventually consistent" as a synonym for "we don't have to think about consistency" — every eventually-consistent design still needs an explicit answer for how large the window can get, what happens if a reader hits it, and how drift gets detected and corrected.

**13. Architect Insight**
The junior/Staff framing stops at "eventing means eventual consistency, that's fine." The Principal/Architect framing quantifies the window (p50/p99 consumer lag), decides per-use-case whether that window is acceptable, and builds the reconciliation safety net (Q135) for the cases where "eventually" isn't good enough on its own.

---

### Q133. How do you build a CQRS read model on top of SQL Server, and what staleness trade-off does it introduce?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
CQRS (Command Query Responsibility Segregation) separates the write model — normalized, transactional, optimized for correctness — from one or more read models: denormalized tables (often in a different database, sometimes even a different engine) shaped exactly like the queries that read them, populated asynchronously from the write model's events. The trade you're making explicitly is read performance and query simplicity in exchange for the read model being eventually consistent with the write model (Q132).

**2. SQL Query**
```sql
-- Write model (OrdersServiceDb) — normalized
-- Orders(OrderID, CustomerID, Status, TotalAmount), OrderItems(OrderItemID, OrderID, ProductID, Quantity)

-- Read model (ReportingServiceDb) — denormalized, shaped for one specific query pattern
CREATE TABLE dbo.CustomerOrderSummary (
    CustomerID       INT NOT NULL,
    CustomerName     VARCHAR(200) NOT NULL,
    TotalOrders      INT NOT NULL,
    LifetimeSpend    DECIMAL(18,2) NOT NULL,
    LastOrderDate    DATETIME2 NULL,
    LastUpdatedAt    DATETIME2 NOT NULL,
    PRIMARY KEY (CustomerID)
);

-- Populated/maintained by an event consumer reacting to OrderConfirmed events, e.g.:
UPDATE dbo.CustomerOrderSummary
SET TotalOrders = TotalOrders + 1,
    LifetimeSpend = LifetimeSpend + @OrderAmount,
    LastOrderDate = @OrderDate,
    LastUpdatedAt = SYSUTCDATETIME()
WHERE CustomerID = @CustomerID;
```

**3. Explain the Query**
The read model pre-computes what would otherwise require a `JOIN` across `Customers`, `Orders`, and an aggregation over `OrderItems` on every read; instead, an event consumer does that aggregation *once per event*, incrementally, and the read query becomes a single-row primary-key lookup — trading write-side (consumer) work and eventual consistency for near-zero read-side cost.

**4. Sample Data**
`OrderConfirmed{customerId:501, orderId:1001, amount:249.99, orderDate:'2026-09-13'}` consumed, updating `CustomerOrderSummary(501, 'Acme Corp', 12, 3199.88, '2026-09-13', '2026-09-13T10:00:00.850')`.

**5. Expected Output**
`SELECT * FROM CustomerOrderSummary WHERE CustomerID = 501` returns the pre-aggregated row instantly, without touching `Orders` or `OrderItems` at all.

**6. Alternative Solutions**
- **On-demand aggregation query against the write model** — always fully consistent, but the `JOIN`+`GROUP BY` cost is paid on every single read, which doesn't scale for high-read, low-latency dashboards.
- **Materialized/indexed view inside the same database** — SQL Server's `SCHEMABINDING` + `CREATE UNIQUE CLUSTERED INDEX` indexed views give you a similar "precomputed" benefit synchronously and transactionally, but only within one database, and with real restrictions on what expressions are allowed (no `COUNT(*)` without `COUNT_BIG`, no outer joins, etc.) — a good option when you don't need cross-service denormalization.
- **Full CQRS read model in a separate store (shown above)** — necessary when the read model spans multiple services' data or needs a different storage engine (e.g., Elasticsearch for search, Redis for a leaderboard); this is the only option that removes read load from the write-side database entirely.
I prefer indexed views for single-database denormalization needs (simpler, transactionally consistent) and reserve full asynchronous CQRS read models for cases that genuinely need to aggregate across service boundaries or a different query shape (full-text search, time-series rollups) that SQL Server's OLTP engine isn't built for.

**7. Performance**
The read model needs its own indexing strategy tuned purely for its query patterns (here, a primary-key lookup) — completely decoupled from whatever indexes the write model needs for its own OLTP workload, which is the main performance win: you stop trying to make one schema and one set of indexes serve two very different access patterns.

**8. Edge Cases**
- Consumer failure mid-update leaves the read model out of sync until it recovers and reprocesses — the update above must be idempotent against redelivery (e.g., track the last-processed event ID per aggregate and skip already-applied events) or a redelivered `OrderConfirmed` double-counts `TotalOrders`.
- A read model rebuild (schema change, corruption, new consumer) needs a defined replay strategy — either replaying the full event log/CDC history from the beginning, or rebuilding from the write model directly via a one-time backfill query.

**9. Production Scenario**
A market-data or trade-blotter dashboard queried thousands of times per second by traders is served entirely from a CQRS read model populated by CDC/events from the trade-execution write database, so the read load never touches — and can never degrade — the latency-critical order-execution path.

**10. Interview Follow-ups**
- How do you rebuild a read model from scratch if it drifts or a bug corrupts it?
- How is this different from just adding a read replica of the write database?
- What happens to the read model schema when the write model's schema changes?

**11. Follow-up Answers**
- Replay the full committed event/CDC history (or re-run a backfill query against the write model) into a freshly-truncated read model table, then resume live consumption from the point the replay caught up to — this is only possible if events/CDC history is retained long enough, which is a retention decision made up front.
- A read replica is still shaped exactly like the write model (same normalized schema) and just adds latency-bounded consistency; a CQRS read model is *reshaped* for the query, which a replica never is — the two solve different problems and are often used together.
- The read model's shape is intentionally decoupled from the write model's shape; a write-model schema change requires updating the *event consumer's* mapping logic, not necessarily the read model's schema itself, which is exactly the coupling-reduction CQRS is meant to provide.

**12. Common Mistakes**
Building a CQRS read model and then having other parts of the system *write* to it directly "just this once" — the moment anything other than the event consumer writes to the read model, its consistency story becomes undefined and unrecoverable-by-replay.

**13. Architect Insight**
A Staff engineer can implement the read-model table and the consumer. A Principal/Architect designs the *replay/rebuild story* before the first production incident forces them to invent one under pressure — a read model without a documented, tested rebuild path is a read model you don't actually trust yet.

---

### Q134. How do you enforce idempotency at the database layer?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
Give every operation that must not be double-applied a client- or system-supplied idempotency key, and make the *database* the arbiter of "have I seen this before" via a `UNIQUE` constraint — not application-level "check then insert" logic, which has a race condition. The insert either succeeds (first time) or fails with a uniqueness-violation error (already processed), and the caller treats that specific error as "this already happened, return the prior result" rather than as a failure.

**2. SQL Query**
```sql
CREATE TABLE dbo.ProcessedRequests (
    IdempotencyKey UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    RequestType    VARCHAR(100) NOT NULL,
    ResultOrderID  INT NULL,
    ProcessedAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

BEGIN TRY
    BEGIN TRANSACTION;
        INSERT INTO dbo.ProcessedRequests (IdempotencyKey, RequestType)
        VALUES (@IdempotencyKey, 'CreateOrder');   -- fails on duplicate key if already processed

        INSERT INTO dbo.Orders (CustomerID, OrderDate, TotalAmount, Status)
        VALUES (@CustomerID, SYSUTCDATETIME(), @TotalAmount, 'CONFIRMED');

        UPDATE dbo.ProcessedRequests
        SET ResultOrderID = SCOPE_IDENTITY()
        WHERE IdempotencyKey = @IdempotencyKey;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 2627  -- unique constraint/PK violation
    BEGIN
        ROLLBACK TRANSACTION;
        SELECT ResultOrderID FROM dbo.ProcessedRequests WHERE IdempotencyKey = @IdempotencyKey;
    END
    ELSE
    BEGIN
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END
END CATCH;
```

**3. Explain the Query**
The `IdempotencyKey` `PRIMARY KEY` is the enforcement mechanism: SQL Server itself guarantees only one row can ever exist per key, atomically, even under concurrent requests — there is no window between "check" and "insert" because there is no separate check, only an insert that the constraint accepts or rejects. Error `2627` is SQL Server's primary-key/unique-constraint violation code; catching it specifically (not a blanket catch-all) lets the caller distinguish "duplicate request, return cached result" from every other kind of failure, which should still fail loudly.

**4. Sample Data**
First call with `IdempotencyKey = 'A1B2...'`: inserts succeed, `ResultOrderID = 1001`. A network-retried second call with the *same* key: the `ProcessedRequests` insert throws `2627`, execution jumps to the `CATCH` block, and the client gets back `OrderID = 1001` again — no second order created.

**5. Expected Output**
Exactly one row in `Orders` regardless of how many times the request is retried with the same idempotency key; the caller always receives the same `OrderID`.

**6. Alternative Solutions**
- **Application-level "SELECT then INSERT if not found"** — has a race condition under concurrent identical requests (two requests can both pass the `SELECT` check before either `INSERT`s); I don't recommend this.
- **`MERGE` statement** — can express insert-or-return-existing in one statement, but SQL Server's `MERGE` has documented concurrency edge cases under high contention (it isn't fully atomic against concurrent `MERGE`s without additional locking hints), so a unique-constraint-plus-catch pattern is often safer than relying on `MERGE` alone for this specific guarantee.
- **Unique constraint + catch-and-return (shown above)** — atomic by construction, relies on the database engine rather than application logic for the correctness guarantee.
I prefer the unique-constraint-plus-catch pattern specifically because the correctness guarantee lives in the database's own constraint enforcement, which is provably atomic, rather than in application code that has to get concurrency exactly right on every code path.

**7. Performance**
The `IdempotencyKey` primary key is itself the index that makes both the duplicate-check and the eventual lookup fast (`O(log n)` B-tree seek); the pattern adds one extra row and one extra index maintenance per operation, which is a small, predictable, worthwhile cost against the alternative of double-processing a payment.

**8. Edge Cases**
- The business `INSERT` succeeds but the process crashes before the `UPDATE ... SET ResultOrderID` and `COMMIT` — because both statements are in the same transaction, a crash rolls back *everything*, so a retried request with the same key correctly reprocesses from scratch (there's no partial state to reconcile).
- Two concurrent requests with the *same* key racing to insert into `ProcessedRequests` — the primary key guarantees only one wins; the loser's transaction rolls back and its `CATCH` block correctly returns the winner's result once the winner's transaction has committed (the loser may need a brief retry-with-backoff if it hits the constraint before the winner has committed and populated `ResultOrderID`).
- A caller that doesn't supply an idempotency key at all — this pattern can't help; idempotency has to be a contract the client honors (see Q140 for detecting duplicates without a client-supplied key).

**9. Production Scenario**
A payment-capture endpoint requires every request to carry an `Idempotency-Key` header; the service uses exactly this pattern against a `ProcessedRequests`-style table before ever calling the card network, so a client's network-timeout-triggered retry after a *successful* capture returns the original result instead of charging the customer twice.

**10. Interview Follow-ups**
- What if the loser transaction in the race needs the winner's result immediately, before the winner has committed?
- How long should idempotency keys be retained?
- Does this pattern work the same way across a distributed/sharded database?

**11. Follow-up Answers**
- The loser can retry the `SELECT` for `ResultOrderID` with a short backoff loop (it'll be `NULL` until the winner commits) rather than failing immediately — or the winner can hold the row lock long enough that the loser's `SELECT` naturally blocks until commit, then reads the committed value.
- Long enough to cover the client's realistic retry window (minutes to a few hours is typical for HTTP-level retries) plus operational buffer; keys are usually archived/purged well after that window via a scheduled cleanup job, similar to Q130's outbox retention.
- Across shards/partitions, the idempotency key must be part of (or determine) the partition/shard key, otherwise two shards could each accept the "same" key independently — this is a common bug when idempotency is bolted on after a sharding decision rather than designed alongside it.

**12. Common Mistakes**
Implementing idempotency as "check if it exists, and if not, insert" in application code across two separate round trips to the database — this looks correct in testing (low concurrency) and fails exactly under the production load spike (concurrent retries) it was meant to protect against.

**13. Architect Insight**
The Staff-level answer knows idempotency keys are needed. The Principal/Architect-level answer identifies that idempotency is fundamentally a *concurrency correctness* problem, not a business-logic problem, and therefore reaches for the primitive the database provides specifically for concurrency correctness — a uniqueness constraint — rather than trying to hand-roll the equivalent check in application code.

---

### Q135. How do you reconcile two services' SQL Server databases when eventual consistency has drifted?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
Reconciliation is the safety net underneath eventual consistency (Q132): a scheduled job compares each service's view of the same conceptual fact — usually via a batch export/staging-table comparison rather than a live cross-service query — classifies mismatches into automatically-fixable, needs-manual-review, and needs-investigation buckets, and either self-heals the automatable ones or raises them to a human. Without this job, "eventually consistent" quietly becomes "consistent only as long as nothing ever goes wrong," which nothing ever guarantees.

**2. SQL Query**
```sql
-- Staging table populated by exporting OrdersService's view of order totals
CREATE TABLE dbo.Staging_OrderTotals_Source (OrderID INT PRIMARY KEY, TotalAmount DECIMAL(18,2), Status VARCHAR(20));
-- ReportingService's own denormalized copy
-- dbo.CustomerOrderSummary / dbo.OrderSummary already exists locally

WITH SourceOfTruth AS (
    SELECT OrderID, TotalAmount, Status FROM dbo.Staging_OrderTotals_Source
),
LocalView AS (
    SELECT OrderID, TotalAmount, Status FROM dbo.OrderSummary
)
SELECT
    COALESCE(s.OrderID, l.OrderID) AS OrderID,
    s.TotalAmount AS SourceAmount, l.TotalAmount AS LocalAmount,
    s.Status AS SourceStatus, l.Status AS LocalStatus,
    CASE
        WHEN l.OrderID IS NULL THEN 'MISSING_LOCALLY'
        WHEN s.OrderID IS NULL THEN 'MISSING_AT_SOURCE'
        WHEN s.TotalAmount <> l.TotalAmount OR s.Status <> l.Status THEN 'VALUE_MISMATCH'
        ELSE 'MATCH'
    END AS BreakType
FROM SourceOfTruth s
FULL OUTER JOIN LocalView l ON s.OrderID = l.OrderID
WHERE s.OrderID IS NULL OR l.OrderID IS NULL
   OR s.TotalAmount <> l.TotalAmount OR s.Status <> l.Status;
```

**3. Explain the Query**
The `FULL OUTER JOIN` between the authoritative export (`SourceOfTruth`) and the local read model (`LocalView`) surfaces every kind of break in one pass: rows present on one side only (`MISSING_LOCALLY`/`MISSING_AT_SOURCE`, usually a consumer that hasn't caught up yet or genuinely dropped an event) and rows present on both sides with differing values (`VALUE_MISMATCH`, usually a bug or an out-of-order event application). The final `WHERE` filters out the vast majority of rows that match, so the job only surfaces exceptions.

**4. Sample Data**
`Staging_OrderTotals_Source(1001, 249.99, 'CONFIRMED')`; `OrderSummary(1001, 249.99, 'PENDING')` — the local read model missed the `OrderConfirmed` event.

**5. Expected Output**
One row: `OrderID=1001, SourceStatus='CONFIRMED', LocalStatus='PENDING', BreakType='VALUE_MISMATCH'`.

**6. Alternative Solutions**
- **Live cross-service query comparison** — simplest to reason about but reintroduces the cross-service coupling and load concerns from Q127/Q128; generally avoided for scheduled reconciliation.
- **Batch export + staging-table comparison (shown above)** — the industry-standard approach (mirrors nightly settlement-file reconciliation in payments); decouples the comparison job's timing and load from either service's live path.
- **Checksum/hash comparison instead of column-by-column** — compute a hash per `OrderID` on both sides and compare hashes first, only pulling full column detail for hashes that differ; scales better when reconciling millions of rows and dozens of columns.
I prefer the batch/staging approach with a checksum pre-filter at scale, and full column comparison (as shown) at a scale where readability matters more than shaving comparison cost.

**7. Performance**
The comparison needs a clustered/primary key on `OrderID` on both sides for the `FULL OUTER JOIN` to execute as a cheap merge join rather than a hash join spilling to `tempdb`; at genuinely large scale (tens of millions of rows), pre-aggregating to checksums (previous point) avoids pulling every column across the wire for rows that already match.

**8. Edge Cases**
- A break detected mid-processing, where the local consumer simply hasn't caught up yet (a few hundred ms of normal eventual-consistency lag) — the job needs a grace-period cutoff (e.g., ignore events younger than 5 minutes) to avoid raising false-positive "breaks" that would have self-corrected momentarily.
- A break that recurs on the same `OrderID` repeatedly — a signal of a real consumer bug (e.g., an event handler silently swallowing an exception) rather than a one-off timing issue, and should be escalated differently than a first-time break.

**9. Production Scenario**
A nightly reconciliation job compares a ledger service's account balances (source of truth) against a reporting service's cached balances, auto-corrects `MISSING_LOCALLY` rows by replaying the relevant events, and pages an on-call engineer for any `VALUE_MISMATCH` that recurs on the same account two nights in a row — mirroring exactly the automatable/manual/investigate break-classification convention used for external settlement-file reconciliation in this repo's FinTech material (Q139).

**10. Interview Follow-ups**
- Which breaks should be auto-corrected versus escalated to a human, and why?
- How often should reconciliation run, and does that depend on the data's sensitivity?
- What do you do when the "source of truth" side is itself wrong?

**11. Follow-up Answers**
- Auto-correct breaks with a clear, safe, deterministic fix (`MISSING_LOCALLY` → replay the known event); escalate anything involving money movement, ambiguity about which side is correct, or a pattern that keeps recurring — never silently auto-"fix" a financial value mismatch without an audit trail of what changed and why.
- More sensitive/higher-blast-radius data (ledger balances, regulatory reporting figures) reconciles more frequently (hourly or even near-real-time via streaming comparison) than low-stakes denormalized display data (nightly is often fine); the cadence is a risk decision, not just a technical one.
- That's a data-quality incident in the *source* service, not a reconciliation-job problem — the job's value is precisely that it surfaces this discrepancy for investigation instead of letting it propagate silently; the fix happens upstream, and the reconciliation job's own logic shouldn't try to arbitrate which side is "right" beyond flagging disagreement.

**12. Common Mistakes**
Building event-driven synchronization between services and treating it as self-evidently correct forever, with no reconciliation job at all — every eventually-consistent architecture accumulates undetected drift over time (bugs, dropped messages, race conditions) without one.

**13. Architect Insight**
A Staff engineer builds the event pipeline and calls the consistency problem solved. A Principal/Architect treats "how do we detect and correct drift" as a first-class deliverable of the *same* design — reconciliation isn't a bolt-on for when something goes wrong, it's the mechanism that makes "eventually consistent" a claim you can actually stand behind in a regulated or financially consequential system.

---

## References

1. [What is change data capture (CDC)? — SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/track-changes/about-change-data-capture-sql-server?view=sql-server-ver17)
2. [Enable and Disable change data capture — SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/track-changes/enable-and-disable-change-data-capture-sql-server?view=sql-server-ver17)
3. [Change Data Capture Functions (Transact-SQL) — SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/system-functions/change-data-capture-functions-transact-sql?view=sql-server-ver17)
4. [Create a distributed transaction — SQL Server Native Client](https://learn.microsoft.com/en-us/sql/relational-databases/native-client/odbc/performing-transactions-distributed-transactions?view=sql-server-ver15)
5. [BEGIN DISTRIBUTED TRANSACTION (Transact-SQL) — SQL Server](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/begin-distributed-transaction-transact-sql?view=sql-server-ver17)
6. [Unique constraints and check constraints — SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/tables/unique-constraints-and-check-constraints?view=sql-server-ver17)
7. [OUTPUT clause (Transact-SQL) — SQL Server](https://learn.microsoft.com/en-us/sql/t-sql/queries/output-clause-transact-sql?view=sql-server-ver17)
8. [Transaction Locking and Row Versioning Guide — SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide?view=sql-server-ver17)
