# PostgreSQL · MongoDB · DynamoDB — Cram Sheet

> Tier 3 (thin recall) · Source: `05-PostgreSQL/` `06-MongoDB/` `08-DynamoDB/` (6 modules, 2,691 lines) · Read: 8 min
> **Learn these as a diff against [[04-SQL-Server]].** The interview question is almost always "why this one?"

---

## PostgreSQL — the diff from SQL Server

- **MVCC with no undo log:** an `UPDATE` writes a **new row version** and marks the old dead. Consequences:
  - **Readers never block writers, writers never block readers** — natively, without RCSI.
  - **Dead tuples accumulate → `VACUUM`** reclaims them and `ANALYZE` refreshes stats. **Autovacuum falling behind is *the* PostgreSQL production incident** — table bloat, index bloat, and eventually **transaction ID wraparound**, which forces a shutdown to protect data.
  - `UPDATE` is relatively expensive; **HOT updates** avoid index churn when no indexed column changes.
- **Isolation:** `READ COMMITTED` (default) · `REPEATABLE READ` (a true snapshot — **no phantoms**, unlike the ANSI definition) · `SERIALIZABLE` (**SSI** — optimistic; it *aborts* conflicting transactions with a serialization failure rather than blocking, so you must retry).
- **Index types beyond B-tree — the standard question:** **GIN** (inverted — JSONB, full-text, arrays) · **GiST** (geometric, ranges, nearest-neighbour) · **BRIN** (tiny, for naturally-ordered huge tables like time series) · **Hash** · **partial** (`WHERE`) and **expression** indexes (which SQL Server needs a computed column for).
- **`JSONB`** — binary, indexable with GIN, supports containment `@>` and path operators. This is why teams choose Postgres over a document store.
- **Extensions are the real differentiator:** PostGIS, `pg_stat_statements`, `pg_partman`, TimescaleDB, `pgvector` (embeddings), Citus.
- **Replication:** streaming (physical, WAL-based) vs **logical** (per-table, cross-version — what CDC/Debezium uses).
- Other diffs: `SERIAL`/`IDENTITY`/`UUID` · `RETURNING` on DML · `ON CONFLICT DO UPDATE` (upsert) · `LISTEN/NOTIFY` · rich array and range types · `CREATE INDEX CONCURRENTLY` (no write lock).
- **Connection cost is high** (process per connection) → **PgBouncer** is effectively mandatory at scale.

---

## MongoDB

- **Document model:** collections of BSON documents. **16 MB document limit.** Schema-flexible, which means **schema is enforced by your application** (or by JSON-schema validators, which you should use).
- **The modelling decision is embed vs reference:**
  - **Embed** when data is accessed together, has a bounded size, and is owned by the parent (order → line items). One read, no join.
  - **Reference** when it's large, unbounded, shared, or independently updated.
  - **The unbounded-array anti-pattern** (embedding a growing list of comments) is the classic failure — it hits the 16 MB cap and degrades every update.
- **Design for the query pattern, not for normalisation** — duplication is expected and correct.
- **`_id`** is auto-indexed. Compound indexes follow the **ESR rule: Equality → Sort → Range** for field order.
- **Aggregation pipeline:** `$match` (as early as possible, to use indexes) → `$project` → `$group` → `$sort` → `$lookup` (a left outer join — available, but a sign you may have modelled wrong).
- **Replica set:** one primary, N secondaries, automatic election. **Write concern** `w:1` (primary only) / `w:"majority"` (durable) / `j:true` (journal). **Read preference** primary / secondary / nearest — reading from a secondary means **stale reads**.
- **Sharding:** shard key is chosen **once and is very hard to change**. Needs high cardinality, even distribution and query alignment. **A monotonically increasing shard key creates a hot shard** — use hashed sharding or a compound key.
- **Multi-document ACID transactions exist (4.0+)** — but they are a sign you may have modelled the aggregate boundary wrong; embedding usually removes the need.
- **Change Streams** = CDC, built on the oplog.

---

## DynamoDB

- **Key model:** **partition key** (determines the physical partition via a hash) + optional **sort key**. `PK` alone = a simple key; `PK+SK` = a composite key enabling range queries within a partition.
- **The whole design is the access pattern.** You enumerate every query the application will make *first*, then design keys. There is no ad-hoc query, and adding one later can mean a migration.
- **`Query` (efficient, uses keys) vs `Scan` (reads the whole table — never on a hot path).**
- **Single-table design** — heterogeneous item types in one table with generic `PK`/`SK` attributes and overloaded indexes, so one query returns a whole object graph. Powerful, and genuinely harder to maintain; **be able to argue both sides.**
- **GSI** — different partition and sort key, **its own capacity, eventually consistent**, can be added later. **LSI** — same partition key, alternate sort key, **strongly consistent, must be created with the table**, and it caps that partition at 10 GB.
- **Hot partition: "just add capacity" does not fix a bad key.** Throughput is per-partition. Fixes: write sharding with a suffix, on-demand mode, or a better key.
- **Capacity:** on-demand (spiky, no planning, pricier per request) vs provisioned + auto-scaling (steady, cheaper). Item limit **400 KB**.
- **Condition expressions** give optimistic concurrency (`attribute_not_exists(PK)` for insert-if-absent — the **idempotency primitive**). **Transactions** (`TransactWriteItems`) are limited to 100 items and cost 2×.
- **DynamoDB Streams** → Lambda: the native outbox/CDC mechanism. **TTL** for automatic expiry. **DAX** for microsecond caching. **Global Tables** for multi-region active-active (last-writer-wins conflict resolution).
- **Strongly consistent reads cost 2× and are not available on a GSI.**

---

## Choosing — the answer they want

| Use | Pick |
|---|---|
| Transactions, joins, ad-hoc queries, reporting, **money** | **Relational** (SQL Server / PostgreSQL) |
| Relational + JSON + extensions + open source | **PostgreSQL** |
| Flexible/evolving schema, document-shaped aggregates, fast iteration | **MongoDB** |
| Known access patterns, extreme scale, predictable single-digit-ms, serverless | **DynamoDB** |

**Say this:** "NoSQL" is not a category with shared properties — a document store, a wide-column store and a KV store solve different problems. **Start relational unless there is a specific reason not to**; the burden of proof is on leaving it. And the real cost of DynamoDB is not learning the API, it is that **your access patterns become part of your schema**.

---

## Top traps

1. Autovacuum ignored → bloat and XID wraparound.
2. Postgres `SERIALIZABLE` without retry logic (it aborts, it doesn't block).
3. Unbounded arrays embedded in a Mongo document.
4. Mongo modelled normalised, like a relational schema.
5. Mongo shard key chosen without considering distribution — and effectively unchangeable.
6. Reading from a secondary and expecting fresh data.
7. DynamoDB `Scan` on a request path.
8. "Just add capacity" for a hot partition.
9. Expecting strongly consistent reads from a GSI.
10. Choosing NoSQL for scale you don't have, then needing a join.

---

## Interview Q&A — Lead / Principal

**Answer frame:** headline → mechanism → trade-off + threshold → failure mode **and how you'd know** → *(Principal)* should it exist / who owns it.

### Q1 · SQL or NoSQL for a new service *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"Greenfield service. The team wants MongoDB because 'it scales.' Your call."*

**Answer.** Start relational unless there's a specific reason not to, and put the burden of proof on leaving it. "It scales" isn't a requirement — a well-indexed PostgreSQL or SQL Server instance handles far more than most services ever see, and scale is something you should be able to *demonstrate*, not anticipate. What you give up leaving relational is joins, ad-hoc queries, mature transactional semantics and the reporting story, and teams consistently underestimate how much they'll want those in year two.

I'd also challenge "NoSQL" as a category — a document store, a wide-column store and a key-value store solve genuinely different problems, so the real question is which access pattern we have. Naturally document-shaped aggregates read and written whole, with a schema genuinely still moving: Mongo is reasonable. Every access pattern enumerable up front with predictable single-digit-millisecond latency at high volume: DynamoDB. A money invariant or anyone wanting ad-hoc reporting: relational.

For DynamoDB specifically I'd emphasise that **your access patterns become your schema** — adding a query later can mean a migration, and that's the real cost, not the API. So the question I'd put back to the team is "list every query this service will serve in two years" — and if they can't, that's the argument for relational.

**Why it lands.** Rejects the stated reason, breaks the false category, gives per-store selection criteria, converts it into a question the team can answer.
**✗ Weak answer.** "NoSQL doesn't support transactions" (outdated) or "relational always" (dogma).
**↳ Follow-ups.** What if we do need to scale later? Can you start relational and move?

---

### Q2 · DynamoDB hot partition *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Our DynamoDB table throttles at peak despite provisioned capacity well above our total throughput. Why?"*

**Answer.** Throughput is **per partition**, not per table, so aggregate capacity tells you nothing if load concentrates on one partition key. Almost always key design: a tenant id where one tenant is 90% of traffic, or a date key where everything writes to today. **"Just add capacity" cannot fix it** — you'd be provisioning a total the hot partition can't individually absorb. Confirm with CloudWatch contributor insights to identify the hot key.

Fixes: **write sharding** — append a calculated suffix (`tenantId#0..N`) so writes spread, fan out on read — the standard answer, costing read complexity. **On-demand mode**, which tolerates more skew and is the pragmatic fix if traffic shape is unpredictable. Or **re-key** the table if the access pattern doesn't genuinely need that partition key, which is a migration.

Design point: this is DynamoDB working as documented, not a defect. The lesson is that key design *is* the capacity plan, and single-table design amplifies it — so I'd want access patterns and their relative volumes written down before choosing keys on the next table.

**Why it lands.** Explains why the obvious fix fails, three graded options, then generalises to the design discipline.
**✗ Weak answer.** Increasing provisioned capacity, or "switch to on-demand" with no mention of the key.
**↳ Follow-ups.** How many shards? How does this interact with a GSI? What does adaptive capacity actually do?

---

### Q3 · Is a tenant filter sufficient isolation? *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"We use a global query filter for `TenantId`. Is that sufficient isolation?"*

**Answer.** Good default, **not sufficient alone**, because there are several ways to be outside it and they're all easy to hit: `IgnoreQueryFilters()`, raw SQL, `ExecuteUpdate`/`ExecuteDelete` (which bypass filters entirely), and navigation from a required relationship behaving unexpectedly. Any one in a code path is a cross-tenant leak, and none look alarming in review.

So: defence in depth, **no single load-bearing mechanism**. Query filter as the default. Row-level security in the database as an independent second layer raw SQL can't route around. A test suite that actively attempts cross-tenant access and asserts failure — positive *and* negative tests, because a filter silently not applied passes every positive test. For the highest-isolation tenants, a separate database or schema, turning a code bug into an impossibility.

The point I'd make explicitly: **tenant leakage has genuinely weak detection.** No error, no exception, no metric moves — a customer tells you, or a regulator does. So I'd add a canary: synthetic records in each tenant that should never appear in another tenant's results, checked continuously. That's the detector for a failure that otherwise has none.

**Why it lands.** Enumerates the bypasses, insists on layers, builds a detector for a failure class with none.
**✗ Weak answer.** "Yes, the global filter handles it."
**↳ Follow-ups.** What does RLS cost in performance? How do you handle a legitimate cross-tenant admin query?

---

### Quick-fire (30 seconds each)

- **"PostgreSQL or SQL Server?"** → Mostly a licensing and ecosystem decision rather than a capability one. Postgres gives you MVCC where readers never block writers by default, richer index types — GIN for JSONB and full text, BRIN for huge ordered tables — and extensions like PostGIS and pgvector that have no SQL Server equivalent. The operational cost you take on is vacuum: autovacuum falling behind causes bloat and ultimately transaction-ID wraparound, and connections are expensive enough that PgBouncer is effectively mandatory.
- **"When would you use DynamoDB?"** → When I can enumerate every access pattern up front and I need predictable single-digit-millisecond latency at very large scale with no operational burden. The design *is* the access patterns — partition key, sort key, GSIs — and there's no ad-hoc query, so a new query later can mean a data migration. That's the real trade, not the API. If the business needs reporting, joins, or ad-hoc analysis, I'd keep the system of record relational and stream to something else for those.
- **"Embed or reference in MongoDB?"** → Embed when the data is read together, bounded in size, and owned by the parent — order line items are the canonical case, one read, no join. Reference when it's unbounded, shared between parents, or updated independently. The failure I'd call out is the unbounded array: embedding comments or events that grow forever hits the 16 MB document cap and makes every update rewrite the document. And I'd model for the query pattern, not normalisation — duplication is expected here.

---

**Go deeper:** `05-PostgreSQL/`, `06-MongoDB/`, `08-DynamoDB/` · **Related:** [[04-SQL-Server]], [[21-AWS]], [[14-System-Design-Core]]
