(function (r) {
registerTopic('06-mongodb', {
related: ['05-postgresql', '08-dynamodb', '07-redis'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['data-modeling'],
  code: r`~~~javascript
// Embedded (bounded, owned, co-read) + extended reference (snapshot of product data at purchase)
db.orders.insertOne({
  _id: ObjectId(), customerId: ObjectId("652f..."), status: "PAID", placedAt: ISODate(),
  lines: [ { productId: ObjectId("64aa..."), name: "Trail shoe", unitPrice: NumberDecimal("89.99"), qty: 1 } ],
  total: NumberDecimal("89.99"), currency: "GBP"
});
// Referenced (unbounded): activity lives in its own collection keyed by userId
db.activity.insertOne({ userId: ObjectId("652f..."), at: ISODate(), type: "login" });
db.activity.createIndex({ userId: 1, at: -1 });
~~~`,
  q: r`How do you decide between embedding and referencing in MongoDB?`,
  a: r`The rule: **model for your access patterns, and data that is read together is stored together.**

Embed when:

- The child belongs to one parent and is read with it (order lines in an order).
- The child set is **bounded** (an order has tens of lines, not millions).
- You want atomic updates: a single-document write is atomic without a transaction.

Reference when:

- The child set is unbounded or grows forever (a user's activity log).
- The child is shared by many parents (a product referenced by many orders) and changes independently.
- Documents would approach the **16 MB** document limit, or hot updates would rewrite large documents.

Hybrid patterns: **extended reference** (copy the product name and price into the order line, reference the product id), **subset** (embed the latest 10 reviews, reference the rest), **bucket** (group time-series readings per hour).

Duplication is a deliberate trade: faster reads, but you own the consistency of the copies. Copy only data that is immutable at the time of the event (the price paid) or acceptable to be eventually updated.`,
  pts: [r`Model for access patterns`, r`Embed bounded, owned, co-read data`, r`Reference unbounded or shared data`, r`16 MB document limit`, r`Extended reference, subset, bucket patterns`],
  ex: r`An e-commerce order embeds its lines plus a snapshot of product name and unit price at purchase time; the product catalogue changes later without rewriting history.`,
  fu: [r`What goes wrong with an unbounded embedded array?`, r`How would you keep a duplicated customer name in sync?`],
  pit: [r`Normalising like a relational schema and then doing $lookup everywhere.`, r`Embedding an ever-growing array of comments or events.`],
  tip: r`Start every MongoDB modelling answer by listing the queries. That single habit separates senior answers.` },

{ id: 'q2', level: 'Basic', tags: ['indexes'],
  q: r`How do MongoDB indexes work and what is the ESR rule?`,
  a: r`MongoDB indexes are B-trees (WiredTiger). Every collection has a unique {{_id}} index. You can create single-field, **compound**, multikey (arrays), text, geospatial (2dsphere), hashed (for sharding), wildcard, TTL, partial and unique indexes.

For compound indexes follow **ESR**: **Equality** fields first, then **Sort** fields, then **Range** fields.

~~~javascript
// query: { tenantId: t, status: "OPEN", createdAt: { $gte: d } } sorted by priority desc
db.tickets.createIndex({ tenantId: 1, status: 1, priority: -1, createdAt: 1 });
~~~

Putting the range before the sort forces an in-memory **SORT** stage (limited to 100 MB unless allowDiskUse).

A **covered query** returns only indexed fields and excludes {{_id}} (or includes it in the index), so no documents are fetched ({{totalDocsExamined: 0}}).

Each index slows writes and consumes RAM; the working set of indexes should fit in the WiredTiger cache.`,
  pts: [r`B-tree indexes, _id always present`, r`ESR: equality, sort, range`, r`In-memory sort is a red flag`, r`Covered queries`, r`Indexes cost writes and RAM`],
  ex: r`A support-ticket list moved from 800 ms to 6 ms by reordering a compound index from (tenantId, createdAt, priority) to (tenantId, status, priority, createdAt).`,
  fu: [r`How do multikey indexes behave with two array fields?`, r`What is index prefix usage?`],
  pit: [r`Creating one single-field index per queried field and expecting index intersection to save you.`] },

{ id: 'q3', level: 'Basic', tags: ['replication'],
  code: r`~~~javascript
rs.initiate({ _id: "rs0", members: [
  { _id: 0, host: "mongo-a.az1:27017", priority: 2 },
  { _id: 1, host: "mongo-b.az2:27017", priority: 1 },
  { _id: 2, host: "mongo-c.az3:27017", priority: 1 } ] });
rs.status().members.map(m => ({ name: m.name, state: m.stateStr, lagSecs: (m.optimeDate ? (new Date() - m.optimeDate) / 1000 : null) }));
~~~
~~~csharp
var settings = MongoClientSettings.FromConnectionString("mongodb://mongo-a,mongo-b,mongo-c/?replicaSet=rs0&retryWrites=true&w=majority");
~~~`,
  dia: r`flowchart LR
  App[.NET service] -->|writes w:majority| P[(Primary AZ1)]
  P -- oplog --> S1[(Secondary AZ2)]
  P -- oplog --> S2[(Secondary AZ3)]
  S1 -. heartbeat / election .- S2
  S1 -. heartbeat .- P`,
  q: r`How does a MongoDB replica set work, and what happens on failover?`,
  a: r`A replica set is one **primary** and usually two or more **secondaries** (odd number of voting members, max 7 voters). Writes go to the primary and are recorded in the **oplog** (an idempotent, capped log); secondaries tail and apply it.

If the primary is unreachable for {{electionTimeoutMillis}} (10 s default), secondaries hold a **Raft-like election**; a member with the most recent oplog and a majority of votes becomes primary. Typical failover: under ~12 seconds.

During failover:

- Writes fail until a new primary exists; drivers with **retryable writes** (default on) retry once automatically.
- Writes acknowledged only by the old primary (with {{w:1}}) and not replicated can be **rolled back** when it rejoins (written to a rollback directory).

So for data that must not be lost: {{writeConcern: majority}}.

Place members across three availability zones; use an arbiter only as a last resort because it cannot hold data and weakens majority write availability.`,
  pts: [r`Primary + secondaries via oplog`, r`Elections need majority`, r`Failover ~10 s`, r`w:1 writes can roll back`, r`Spread across 3 AZs`],
  ex: r`A payment status service lost acknowledged updates during a failover because it used w:1; switching to majority write concern removed the rollback window at a few milliseconds of latency.`,
  fu: [r`Why is a PSA (primary-secondary-arbiter) topology risky with majority writes?`],
  pit: [r`Running two data-bearing nodes only (no majority after one fails).`] },

{ id: 'q4', level: 'Basic', tags: ['consistency', 'write-concern'],
  code: r`~~~csharp
var payments = db.GetCollection<Payment>("payments")
    .WithWriteConcern(WriteConcern.WMajority.With(journal: true))
    .WithReadConcern(ReadConcern.Majority);
var reports = db.GetCollection<Payment>("payments")
    .WithReadPreference(new ReadPreference(ReadPreferenceMode.SecondaryPreferred, maxStaleness: TimeSpan.FromSeconds(90)));
~~~`,
  q: r`Explain write concern, read concern and read preference.`,
  a: r`**Write concern** ({{w}}): how many members must acknowledge. {{w:1}} primary only; {{w:"majority"}} majority of voting members (default since 5.0); {{j:true}} journaled to disk.

**Read concern**: which data a read may return.

- {{local}}: latest on that node, may later be rolled back.
- {{majority}}: data acknowledged by a majority, never rolled back.
- {{linearizable}}: reflects all majority writes completed before the read (primary only, slower).
- {{snapshot}}: in transactions.

**Read preference**: which member serves the read: {{primary}} (default), {{primaryPreferred}}, {{secondary}}, {{secondaryPreferred}}, {{nearest}}, with {{maxStalenessSeconds}}.

Combining majority write and majority read concern with **causally consistent sessions** gives read-your-writes even from secondaries.

Trade-off: stronger settings add latency (cross-AZ round trips), weaker settings risk rollback or stale reads.`,
  pts: [r`w:majority default since 5.0`, r`Read concern controls rollback exposure`, r`Read preference chooses the node`, r`Causal sessions for read-your-writes`],
  ex: r`A dashboard used secondaryPreferred to offload the primary; the order confirmation page kept primary reads to avoid "order not found" after checkout.`,
  fu: [r`When would you use linearizable reads?`],
  pit: [r`Reading from secondaries and assuming the data is current.`] },

{ id: 'q5', level: 'Basic', tags: ['aggregation'],
  q: r`What is the aggregation pipeline and how do you keep it fast?`,
  a: r`A pipeline is a sequence of stages, each transforming a stream of documents: {{$match}}, {{$project}}/{{$set}}, {{$group}}, {{$sort}}, {{$lookup}}, {{$unwind}}, {{$facet}}, {{$bucket}}, {{$setWindowFields}}, {{$merge}}/{{$out}}.

~~~javascript
db.orders.aggregate([
  { $match: { tenantId: t, createdAt: { $gte: from, $lt: to }, status: "PAID" } },
  { $group: { _id: { $dateTrunc: { date: "$createdAt", unit: "day" } },
              revenue: { $sum: "$total" }, orders: { $sum: 1 } } },
  { $sort: { _id: 1 } }
]);
~~~

Performance rules:

- **{{$match}} and {{$sort}} first** so they can use indexes; only stages at the start of the pipeline use indexes.
- Project away fields early to reduce memory.
- Stages are limited to 100 MB RAM; {{allowDiskUse}} spills (default true in 6.0+), slower.
- {{$lookup}} needs an index on the foreign field; it is a per-document join, not a hash join.
- For repeated heavy reports, precompute with {{$merge}} into a summary collection (on-demand materialised view).`,
  pts: [r`Stage pipeline`, r`$match/$sort first to use indexes`, r`100 MB per stage`, r`$lookup needs foreign index`, r`$merge for materialised views`],
  ex: r`A daily revenue dashboard aggregating 50 M orders per request took 30 s; an hourly $merge into a daily_revenue collection made it instant.`,
  fu: [r`How do you explain an aggregation?`],
  pit: [r`Putting $lookup or $unwind before $match.`] },

{ id: 'q6', level: 'Basic', tags: ['transactions'],
  q: r`Does MongoDB support ACID transactions? When should you use them?`,
  a: r`Yes. Single-document operations have always been atomic. Since 4.0 multi-document transactions on replica sets and since 4.2 on sharded clusters, with snapshot isolation.

~~~csharp
using var session = await client.StartSessionAsync();
await session.WithTransactionAsync(async (s, ct) =>
{
    await accounts.UpdateOneAsync(s, a => a.Id == from && a.Balance >= amt,
        Builders<Account>.Update.Inc(a => a.Balance, -amt), cancellationToken: ct);
    await accounts.UpdateOneAsync(s, a => a.Id == to,
        Builders<Account>.Update.Inc(a => a.Balance, amt), cancellationToken: ct);
    return true;
});
~~~

{{WithTransactionAsync}} retries on {{TransientTransactionError}} and {{UnknownTransactionCommitResult}}.

Costs and limits: default 60 s lifetime ({{transactionLifetimeLimitSeconds}}), write conflicts abort the transaction, cross-shard transactions use two-phase commit and are slower, and large transactions pressure the cache.

Guidance: model so most operations touch one document; use transactions for genuine multi-document invariants (transfers, outbox writes), not as a default.`,
  pts: [r`Single-document atomicity`, r`Multi-doc transactions since 4.0/4.2`, r`Use the callback API for retries`, r`Prefer modelling over transactions`],
  ex: r`An order service writes the order document and an outbox document in one transaction so events are never lost.`,
  fu: [r`What is a write conflict and how does it surface?`],
  pit: [r`Using transactions everywhere to emulate a relational design.`] },

{ id: 'q7', level: 'Intermediate', tags: ['explain', 'performance'],
  code: r`~~~javascript
db.setProfilingLevel(1, { slowms: 100 });
db.system.profile.find({ millis: { $gt: 100 } }).sort({ ts: -1 }).limit(5);
const e = db.tickets.find({ tenantId: "t1", status: { $in: ["OPEN", "PENDING"] } }).sort({ priority: -1 }).explain("executionStats");
printjson({ stage: e.queryPlanner.winningPlan.stage, keys: e.executionStats.totalKeysExamined,
            docs: e.executionStats.totalDocsExamined, returned: e.executionStats.nReturned, ms: e.executionStats.executionTimeMillis });
db.tickets.getPlanCache().clear();   // short-term fix while you correct the index
~~~`,
  q: r`How do you diagnose a slow MongoDB query?`,
  a: r`1. Find it: the **profiler** ({{db.setProfilingLevel(1, { slowms: 100 })}}), slow-query log, or Atlas Query Profiler / Performance Advisor.
2. Run {{explain("executionStats")}} and read:

- {{winningPlan}} stage: **IXSCAN** good, **COLLSCAN** bad on large collections, **SORT** means in-memory sort.
- {{totalKeysExamined}} and {{totalDocsExamined}} vs {{nReturned}}: ideally close to 1:1:1. 1,000,000 examined for 20 returned = wrong index.
- {{executionTimeMillis}}, and {{rejectedPlans}} to see what the planner considered.

3. Fix: an ESR-ordered compound index, a covered projection, rewriting {{$or}} so each branch is indexed, avoiding unanchored regex and {{$ne}}/{{$nin}} (poor selectivity).
4. Check the plan cache: MongoDB caches the winning plan per query shape; a shape-level bad choice can persist. {{planCacheClear}} or index filters as a short-term fix.
5. Check server health: cache eviction, ticket availability (concurrent read/write tickets), disk latency.`,
  pts: [r`Profiler and slow log`, r`explain executionStats ratios`, r`COLLSCAN and SORT red flags`, r`Plan cache per query shape`, r`Server health metrics`],
  ex: r`A query examined 2.4 M keys to return 50 because the index started with a low-cardinality status field used with $in on many values; reordering fixed the ratio.`,
  fu: [r`What is a query shape?`],
  pit: [r`Looking only at execution time and not the examined/returned ratio.`] },

{ id: 'q8', level: 'Intermediate', tags: ['dotnet', 'driver'],
  q: r`What should a .NET team know about the MongoDB C# driver?`,
  a: r`- {{MongoClient}} is thread-safe and holds the connection pool: register it as a **singleton**. Creating one per request exhausts connections.
- Configure via {{MongoClientSettings}}: {{MaxConnectionPoolSize}} (default 100), timeouts, {{RetryWrites}}, {{ReadConcern}}, {{WriteConcern}}, server API version.
- Mapping: {{BsonClassMap}} or attributes; register conventions (camelCase, ignore extra elements) once at startup. Use {{[BsonRepresentation(BsonType.Decimal128)]}} for money ({{decimal}}), and GuidRepresentation Standard for GUIDs.
- Prefer typed builders or LINQ (LINQ3 provider is default since 2.19) and check the generated query with explain.
- All I/O is async; pass {{CancellationToken}}.
- Use {{IAsyncCursor}}/{{ToAsyncEnumerable}} for large result sets rather than {{ToListAsync}}.
- EF Core provider for MongoDB exists (GA 2024) for simpler domain models; it has feature gaps compared to the native driver.

~~~csharp
services.AddSingleton<IMongoClient>(_ => new MongoClient(settings));
services.AddSingleton(sp => sp.GetRequiredService<IMongoClient>().GetDatabase("payments"));
~~~`,
  pts: [r`Singleton MongoClient`, r`Decimal128 for money`, r`Conventions once at startup`, r`Explain LINQ-generated queries`, r`Stream large results`],
  ex: r`An Azure Function created a MongoClient per invocation and hit the cluster's connection limit under a burst; a static client fixed it.`,
  fu: [r`How do you handle schema evolution in C# classes?`],
  pit: [r`Storing decimal as double and getting rounding errors.`] },

{ id: 'q9', level: 'Intermediate', tags: ['schema', 'validation'],
  q: r`MongoDB is "schemaless". How do you manage schema and its evolution in production?`,
  a: r`The database does not force a schema, but your application always has one. Manage it explicitly:

- **JSON Schema validation** on the collection ({{$jsonSchema}} validator) with {{validationLevel: "moderate"}} (only validates new and already-valid documents) and {{validationAction: "error"}} or {{"warn"}} during rollout.
- **Schema versioning pattern**: a {{schemaVersion}} field per document; code reads both versions and upgrades lazily on write, while a background migration upgrades the rest.
- **Additive changes** are cheap (new optional field). Renames and type changes need expand/contract: write both, read both, backfill, then remove.
- Contract tests on the C# model classes; {{IgnoreExtraElements}} so old code survives new fields.

~~~javascript
db.runCommand({ collMod: "payments", validator: { $jsonSchema: {
  bsonType: "object", required: ["tenantId", "amount", "currency", "status"],
  properties: { amount: { bsonType: "decimal" }, currency: { bsonType: "string", minLength: 3, maxLength: 3 },
                status: { enum: ["PENDING", "SETTLED", "FAILED"] } } } },
  validationLevel: "moderate", validationAction: "error" });
~~~`,
  pts: [r`Application always has a schema`, r`$jsonSchema validators`, r`schemaVersion field`, r`Lazy + background migration`, r`Expand/contract for renames`],
  ex: r`A team found three spellings of a status field in production; adding a validator plus a version field stopped new drift and a migration cleaned old documents.`,
  fu: [r`How do you migrate a billion documents safely?`],
  pit: [r`Claiming schemaless means no schema design is needed.`] },

{ id: 'q10', level: 'Intermediate', tags: ['ttl', 'indexes'],
  q: r`What are TTL, partial, unique and sparse indexes used for?`,
  a: r`- **TTL**: a background thread (every 60 s) deletes documents whose date field is older than {{expireAfterSeconds}}. Use for sessions, idempotency keys, temporary tokens. Deletion is approximate in time and generates write load; for huge volumes prefer time-bucketed collections you drop.
- **Partial**: index only documents matching a filter, e.g. only {{status: "PENDING"}}. Smaller and faster; the query must include the filter.
- **Unique**: enforce uniqueness (email, idempotency key). In sharded clusters, uniqueness is only guaranteed if the index is prefixed by the shard key.
- **Sparse**: index only documents that have the field; largely superseded by partial indexes ({{partialFilterExpression: { email: { $exists: true } } }}).

~~~javascript
db.idempotency.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 });
db.users.createIndex({ tenantId: 1, email: 1 }, { unique: true,
  partialFilterExpression: { deletedAt: null } }); // unique among active users only
~~~`,
  pts: [r`TTL for expiring data`, r`Partial indexes match query filters`, r`Unique + shard key prefix`, r`Partial supersedes sparse`],
  ex: r`An API stored idempotency keys with a 24-hour TTL index, keeping the collection small without a cleanup job.`,
  fu: [r`Why might TTL deletes cause latency spikes?`],
  pit: [r`Expecting TTL deletion at the exact second.`] },

{ id: 'q11', level: 'Intermediate', tags: ['change-streams', 'events'],
  dia: r`sequenceDiagram
  participant App as .NET service
  participant M as MongoDB (oplog)
  participant R as Relay (change stream)
  participant K as Kafka
  App->>M: insert outbox doc (same transaction as order)
  M-->>R: change event + resume token
  R->>K: publish (key = aggregateId)
  R->>R: save resume token after publish
  Note over R,K: at-least-once, consumers dedupe by message id`,
  q: r`What are change streams and how do you use them reliably?`,
  a: r`Change streams expose the oplog as a resumable stream of inserts, updates, deletes and DDL on a collection, database or deployment. They require a replica set or sharded cluster.

~~~csharp
var options = new ChangeStreamOptions { FullDocument = ChangeStreamFullDocumentOption.UpdateLookup,
                                        ResumeAfter = await LoadResumeTokenAsync() };
using var cursor = await outbox.WatchAsync(pipeline, options, ct);
await foreach (var change in cursor.ToEnumerable().ToAsyncEnumerable())
{
    await PublishAsync(change.FullDocument, ct);          // idempotent consumer downstream
    await SaveResumeTokenAsync(change.ResumeToken);        // after publish: at-least-once
}
~~~

Reliability:

- Persist the **resume token** after processing; on restart resume from it.
- If the token falls off the oplog window (consumer down too long), you cannot resume: size the oplog for your worst outage, and have a re-snapshot procedure.
- Delivery is at-least-once: consumers must be idempotent.
- Use them for an outbox relay, cache invalidation, search sync. For high-volume CDC to Kafka, the MongoDB Kafka connector or Debezium do the token handling.`,
  pts: [r`Oplog-backed, resumable`, r`Persist resume token after processing`, r`Oplog window bounds downtime`, r`At-least-once, idempotent consumers`],
  ex: r`An outbox relay down during a 30-hour incident could not resume because the oplog held 24 hours; the oplog was resized to 72 hours and a replay tool was added.`,
  fu: [r`How do you scale change stream consumers?`],
  pit: [r`Saving the token before processing (loses events on crash).`] },

{ id: 'q12', level: 'Intermediate', tags: ['time-series'],
  q: r`How do you store time-series data in MongoDB?`,
  a: r`Two approaches:

**Native time-series collections** (5.0+): you declare {{timeField}}, {{metaField}} and {{granularity}}; MongoDB stores data internally in compressed buckets, with automatic secondary indexes on meta and time and optional TTL.

~~~javascript
db.createCollection("ticks", { timeseries: { timeField: "ts", metaField: "symbol", granularity: "seconds" },
                               expireAfterSeconds: 60 * 60 * 24 * 30 });
~~~

**Manual bucket pattern**: one document per series per time window with an array of readings and precomputed aggregates (count, min, max, sum). Fewer documents, smaller indexes, pre-aggregated reads.

Native collections are the default now; they have limitations on updates and deletes (improved over versions) and work best for append-only data. For heavy analytical workloads (high-cardinality metrics, long-range rollups) a dedicated store (ClickHouse, Timestream, TimescaleDB) is often better.`,
  pts: [r`Native time-series collections`, r`metaField and granularity`, r`Bucket pattern with pre-aggregates`, r`Append-only fit`, r`Dedicated TSDB for heavy analytics`],
  ex: r`IoT readings at 10 per second per device moved from one document per reading to time-series collections; storage dropped by 70% due to columnar compression.`,
  fu: [r`What does a wrong granularity setting cost?`],
  pit: [r`One document per reading with a separate index per field.`] },

{ id: 'q13', level: 'Intermediate', tags: ['wiredtiger', 'internals'],
  code: r`~~~javascript
const s = db.serverStatus().wiredTiger.cache;
printjson({
  cacheGB: s["maximum bytes configured"] / 1e9,
  usedPct: 100 * s["bytes currently in the cache"] / s["maximum bytes configured"],
  dirtyPct: 100 * s["tracked dirty bytes in the cache"] / s["maximum bytes configured"],
  appThreadEvictions: s["pages evicted by application threads"]   // rising = latency spikes
});
db.orders.stats({ scale: 1024 * 1024 }).indexSizes;               // MB per index vs cache size
~~~`,
  q: r`What should you know about WiredTiger's internals for capacity and performance?`,
  a: r`- **Cache**: WiredTiger's internal cache defaults to the larger of 50% of (RAM - 1 GB) or 256 MB; the OS file cache holds compressed data on top. Keep the **working set** (hot documents + indexes) in cache.
- **Document-level concurrency** with MVCC-like snapshots; writes to different documents do not block each other.
- **Compression**: snappy by default for collections (zstd available), prefix compression for indexes.
- **Checkpoints** every 60 s plus a **journal** (write-ahead log) for durability between checkpoints.
- **Eviction**: when cache dirty or used percentage exceeds thresholds, application threads are drafted to evict, causing latency spikes. Watch "cache dirty %" and "application threads evicting".
- **Tickets**: concurrency is limited by read/write tickets (dynamic since 7.0); exhausted tickets queue operations.

Practical signs of trouble: rising p99 with cache over 95% full, high page faults, disk read IOPS climbing as the working set outgrows RAM.`,
  pts: [r`Cache ~50% RAM`, r`Working set must fit`, r`Document-level concurrency`, r`Eviction pressure = latency spikes`, r`Checkpoints + journal`],
  ex: r`Adding three large indexes pushed the working set beyond cache; p99 tripled until two unused indexes were dropped and the instance size increased.`,
  fu: [r`How do you estimate working set size?`],
  pit: [r`Sizing by total data size instead of working set.`] },

{ id: 'q14', level: 'Intermediate', tags: ['pagination'],
  q: r`How do you paginate large collections efficiently?`,
  a: r`{{skip(n).limit(k)}} walks and discards n entries: page 10,000 is slow, and inserts shift results between pages.

Use **keyset (range) pagination** on an indexed, unique sort key:

~~~javascript
// first page
db.orders.find({ tenantId: t }).sort({ createdAt: -1, _id: -1 }).limit(50);
// next page, using the last item's createdAt and _id
db.orders.find({ tenantId: t, $or: [
  { createdAt: { $lt: lastCreatedAt } },
  { createdAt: lastCreatedAt, _id: { $lt: lastId } } ] })
  .sort({ createdAt: -1, _id: -1 }).limit(50);
~~~

Index: {{{ tenantId: 1, createdAt: -1, _id: -1 }}} covers both. Return an opaque cursor (base64 of the last keys) to clients.

Trade-offs: no "jump to page 500" and total counts are expensive ({{countDocuments}} scans); show "more results" or an estimated count instead. For search UIs with facets and counts, use Atlas Search.`,
  pts: [r`skip is O(n)`, r`Keyset with unique tiebreaker`, r`Opaque cursor`, r`Avoid exact counts`],
  ex: r`An export API using skip timed out past page 2,000; keyset pagination made every page ~5 ms.`,
  fu: [r`How does this map to a REST API design?`],
  pit: [r`Sorting by a non-unique field without a tiebreaker (duplicates/missed rows).`] },

{ id: 'q15', level: 'Intermediate', tags: ['atomic-updates'],
  q: r`How do you update documents safely under concurrency without transactions?`,
  a: r`Use **atomic update operators** with conditions in the filter, so check-and-set happens in one document operation:

~~~javascript
// decrement stock only if enough is left
db.products.updateOne({ _id: p, stock: { $gte: qty } }, { $inc: { stock: -qty } });
// matchedCount 0 => insufficient stock
~~~

Other tools:

- **Optimistic concurrency**: a {{version}} field; update with {{{ _id: id, version: v }}} and {{$inc: { version: 1 }}}; zero matches = conflict, reload and retry.
- {{findOneAndUpdate}} with {{returnDocument: "after"}} to claim work (a queue) atomically.
- Array operators: {{$push}} with {{$slice}} (bounded arrays), {{$addToSet}}, positional {{$}} and filtered {{$[elem]}} updates.
- Upserts with a unique index to avoid duplicates under concurrency.

Avoid read-modify-write in application code (load document, change in C#, replace), which loses concurrent updates.`,
  pts: [r`Condition in the filter`, r`$inc and friends are atomic`, r`Version field for optimistic concurrency`, r`findOneAndUpdate to claim`, r`Avoid replace-whole-document races`],
  ex: r`A flash sale oversold because the service read the product, decremented in C#, and called ReplaceOne; a conditional $inc fixed it.`,
  fu: [r`What happens with upsert races without a unique index?`],
  pit: [r`ReplaceOne after an in-memory change under concurrency.`] },

{ id: 'q16', level: 'Intermediate', tags: ['security'],
  code: r`~~~csharp
// Typed builders: input becomes a value, never an operator
var filter = Builders<User>.Filter.Eq(u => u.Email, request.Email) & Builders<User>.Filter.Eq(u => u.TenantId, tenantId);
// Dangerous: BsonDocument.Parse(requestJson) lets a caller send {"password": {"$ne": null}}
~~~
~~~javascript
db.createRole({ role: "ordersApp", privileges: [
  { resource: { db: "orders", collection: "" }, actions: ["find", "insert", "update", "remove"] } ], roles: [] });
db.createUser({ user: "orders-api", pwd: passwordPrompt(), roles: ["ordersApp"], mechanisms: ["SCRAM-SHA-256"] });
~~~`,
  q: r`How do you secure a MongoDB deployment?`,
  a: r`- **Network**: never expose to the internet (thousands of public databases were ransomed); private endpoints/VPC peering, IP access lists.
- **Authentication**: SCRAM-SHA-256, x.509, or AWS IAM / OIDC (Atlas) for workloads; no shared admin users.
- **Authorisation**: RBAC with least-privilege custom roles per service (readWrite on its database only).
- **TLS** in transit; **encryption at rest** with KMS-managed keys.
- **Client-side field-level encryption (CSFLE)** or **Queryable Encryption** for sensitive fields (PAN, national ids): the server never sees plaintext; Queryable Encryption supports equality (and range in 8.0) queries on encrypted fields.
- **Auditing** (Enterprise/Atlas) to an immutable store.
- **Injection**: never build filters from raw JSON input; in C# use typed builders. Disable server-side JavaScript ({{$where}}) where possible.
- Backups encrypted and access-controlled.`,
  pts: [r`Never public`, r`Least-privilege RBAC`, r`TLS + at-rest encryption`, r`CSFLE / Queryable Encryption`, r`Operator injection risk`],
  ex: r`A login endpoint accepting JSON passed {{{"$ne": null}}} as the password filter and authenticated anyone; typed builders closed the hole.`,
  fu: [r`How does CSFLE key management work?`],
  pit: [r`Deserialising request JSON straight into a BsonDocument filter.`] },

{ id: 'q17', level: 'Intermediate', tags: ['comparison'],
  code: r`~~~text
Same access pattern ("customer's last 20 orders") in each store:
PostgreSQL: SELECT * FROM orders WHERE customer_id = $1 ORDER BY placed_at DESC LIMIT 20;   -- index (customer_id, placed_at DESC)
MongoDB:    db.orders.find({ customerId }).sort({ placedAt: -1 }).limit(20)               -- index { customerId: 1, placedAt: -1 }
DynamoDB:   Query PK = CUST#id, ScanIndexForward = false, Limit = 20                      -- key design does the work
~~~`,
  q: r`MongoDB vs PostgreSQL vs DynamoDB: when would you choose each?`,
  a: r`| | MongoDB | PostgreSQL | DynamoDB |
|---|---|---|---|
| Model | Rich documents, flexible | Relational + jsonb | Key-value / wide-column |
| Queries | Rich ad hoc, aggregation | Full SQL, joins | Key and index lookups only |
| Scale-out | Native sharding | Vertical + replicas (Citus for sharding) | Automatic, near-limitless |
| Transactions | Multi-doc, snapshot | Full ACID, all isolation levels | Up to 100 items, same region |
| Ops | Atlas or self-managed | Many managed options | Serverless, zero ops |
| Cost profile | Instance-based | Instance-based | Per request / capacity |

Pick **PostgreSQL** by default for relational, transactional domains. Pick **MongoDB** when aggregates are naturally documents with varied shapes and you need horizontal scale with rich queries. Pick **DynamoDB** for AWS-native, known-access-pattern, very high-scale workloads where operational simplicity and predictable latency beat query flexibility.`,
  pts: [r`PostgreSQL default for relational`, r`MongoDB for document aggregates + sharding`, r`DynamoDB for known patterns at scale`, r`Query flexibility vs scale vs ops`],
  ex: r`A product catalogue with hundreds of category-specific attributes fit MongoDB; the order ledger stayed in PostgreSQL; the session store went to DynamoDB.`,
  fu: [r`Which would you choose for a ledger and why?`],
  pit: [r`Choosing by hype or "NoSQL scales" without access patterns.`] },

{ id: 'q18', level: 'Intermediate', tags: ['read-scaling'],
  code: r`~~~javascript
// Tag an analytics member so reporting never lands on a failover candidate
cfg = rs.conf();
cfg.members[3].tags = { workload: "analytics" }; cfg.members[3].priority = 0; cfg.members[3].hidden = false;
rs.reconfig(cfg);
~~~
~~~csharp
var analytics = new ReadPreference(ReadPreferenceMode.Secondary, [new TagSet([new Tag("workload", "analytics")])]);
var reports = db.GetCollection<Order>("orders").WithReadPreference(analytics);
~~~`,
  q: r`How do you scale reads in MongoDB and what are the consistency risks?`,
  a: r`Options:

- **Indexes and projections first**; most "we need replicas" problems are missing indexes.
- **Secondary reads** ({{secondaryPreferred}}/{{nearest}}) for analytics or geographically distant users. Risk: replication lag, so data can be stale, and with {{readConcern: local}} a secondary may return data later rolled back.
- **Analytics nodes** (Atlas) or hidden members with tags to isolate reporting load from operational secondaries that might become primary.
- **Caching** hot reads in Redis with change-stream-driven invalidation.
- **Sharding** when the working set or write throughput exceeds one replica set.

Remember: secondaries do the same write work as the primary, so read scaling via secondaries leaves less headroom for failover (the new primary inherits all writes plus reads).`,
  pts: [r`Indexes before replicas`, r`Secondary reads are stale`, r`Analytics nodes isolate reporting`, r`Failover headroom`],
  ex: r`Heavy reports on secondaries caused lag of 40 s; moving them to a tagged analytics node restored normal lag.`,
  fu: [r`How do tag sets route reads?`],
  pit: [r`Sending all reads to secondaries to "scale".`] },

{ id: 'q19', level: 'Senior', tags: ['sharding'],
  code: r`~~~javascript
sh.enableSharding("iot");
sh.shardCollection("iot.events", { deviceId: "hashed" });                 // even writes, scattered ranges
sh.shardCollection("saas.orders", { tenantId: 1, orderId: 1 });           // targeted per tenant
db.orders.find({ tenantId: "t1", orderId: 42 }).explain().queryPlanner.winningPlan.shards.length;  // 1 = targeted
db.adminCommand({ reshardCollection: "iot.events", key: { deviceId: 1, ts: 1 } });  // 5.0+, expensive
~~~`,
  dia: r`flowchart LR
  App[.NET app] --> M1[mongos]
  App --> M2[mongos]
  M1 & M2 --> CFG[(Config server replica set)]
  M1 --> S1[(Shard 1 replica set)]
  M1 --> S2[(Shard 2 replica set)]
  M1 --> S3[(Shard 3 replica set)]
  B[Balancer] -. moves chunks .-> S1 & S2 & S3`,
  q: r`How does sharding work and how do you choose a shard key?`,
  a: r`A sharded cluster has **shards** (each a replica set), **config servers** (metadata: chunk ranges and placement) and **mongos** routers. Data is split into ranges (chunks) by the shard key; the balancer moves ranges to even out data.

Good shard key properties:

- **High cardinality** (many distinct values).
- **Even frequency** (no value dominates).
- **Non-monotonic** for inserts (or hashed), otherwise all inserts hit the last chunk (hot shard).
- **Present in most queries**: queries with the key are **targeted** to one shard; without it they are **scatter-gather** to all shards.

Strategies: **hashed** key on {{_id}} (even writes, but range queries scatter); **compound** like {{{ tenantId: 1, orderId: 1 }}} (targeted per tenant, spreads within large tenants); **zone sharding** to pin tenants or regions to specific shards (data residency).

Since 5.0 you can **reshard** online and since 4.4 refine a key by adding suffix fields, but resharding is expensive; choose carefully.`,
  pts: [r`Shards, config servers, mongos`, r`Cardinality, frequency, monotonicity`, r`Targeted vs scatter-gather`, r`Hashed vs compound vs zones`, r`Resharding is costly`],
  ex: r`Sharding events by timestamp sent every insert to one shard; resharding to {{{ deviceId: "hashed" }}} spread writes evenly across 6 shards.`,
  fu: [r`What is a jumbo chunk?`, r`How would you shard a multi-tenant SaaS where one tenant is 40% of data?`],
  pit: [r`Monotonic shard key like createdAt or ObjectId alone.`],
  tip: r`Always mention targeted vs scatter-gather queries; it ties the key choice to latency.` },

{ id: 'q20', level: 'Senior', tags: ['sharding', 'multi-tenancy'],
  code: r`~~~javascript
sh.shardCollection("saas.records", { tenantId: 1, _id: 1 });
sh.addShardToZone("shard-ent-1", "ENTERPRISE_ACME");
sh.updateZoneKeyRange("saas.records", { tenantId: "acme", _id: MinKey }, { tenantId: "acme", _id: MaxKey }, "ENTERPRISE_ACME");
sh.addShardToZone("shard-eu-1", "EU");
~~~
~~~csharp
// Central enforcement: every query gets the tenant filter
public sealed class TenantCollection<T>(IMongoCollection<T> inner, ITenantContext t) where T : ITenantOwned
{
    private FilterDefinition<T> Scope(FilterDefinition<T> f) => Builders<T>.Filter.Eq(x => x.TenantId, t.Id) & f;
    public IFindFluent<T, T> Find(FilterDefinition<T> f) => inner.Find(Scope(f), new FindOptions { MaxTime = TimeSpan.FromSeconds(5) });
}
~~~`,
  q: r`Design MongoDB multi-tenancy for a SaaS product with a few very large tenants and many small ones.`,
  a: r`Options:

| Model | Pros | Cons |
|---|---|---|
| Database per tenant | Isolation, easy deletion, per-tenant backup | Thousands of DBs: file handles, many collections, slow ops |
| Collection per tenant | Medium isolation | Collection count limits, index explosion |
| Shared collections with {{tenantId}} | Efficient, simple ops | Noisy neighbours, must filter every query |

Hybrid design:

- Shared collections, shard key {{{ tenantId: 1, _id: 1 }}}: queries targeted per tenant; a large tenant spans multiple chunks and shards.
- **Zone sharding** to place enterprise tenants on dedicated shards (performance isolation, data residency: EU tenants on EU shards).
- Enforce tenant filtering centrally: a repository base class or driver-level filter; tests that try cross-tenant access.
- Per-tenant rate limits and query timeouts ({{maxTimeMS}}) to contain noisy neighbours.
- Path to graduate a huge tenant to a dedicated cluster.`,
  pts: [r`Shared collections + tenantId shard key prefix`, r`Zone sharding for isolation and residency`, r`Central tenant filter enforcement`, r`Noisy-neighbour controls`, r`Graduation path`],
  ex: r`A HR SaaS pinned its three largest customers to dedicated shards via zones, cutting their p99 by half and isolating everyone else from their batch jobs.`,
  fu: [r`How do you delete all data for a tenant quickly?`],
  pit: [r`Database per tenant at 50,000 tenants.`] },

{ id: 'q21', level: 'Senior', tags: ['outbox', 'events'],
  q: r`Implement the transactional outbox with MongoDB.`,
  a: r`Write the business change and the event in **one transaction** (or one document), then relay asynchronously.

~~~csharp
await session.WithTransactionAsync(async (s, ct) =>
{
    await orders.InsertOneAsync(s, order, cancellationToken: ct);
    await outbox.InsertOneAsync(s, new OutboxMessage {
        Id = ObjectId.GenerateNewId(), AggregateId = order.Id, Type = "OrderPlaced",
        Payload = JsonSerializer.Serialize(new OrderPlaced(order.Id, order.Total)),
        CreatedAt = DateTime.UtcNow }, cancellationToken: ct);
    return true;
}, cancellationToken: ct);
~~~

Relay options:

- **Change stream** on the outbox collection, publish to Kafka keyed by AggregateId, store the resume token, then let a TTL index delete old outbox documents.
- **Polling** with {{findOneAndUpdate}} claiming batches with a lease.

Single-document alternative (no transaction): embed pending events in the aggregate document ({{$push}} to an {{pendingEvents}} array) and remove them after publishing; atomic because it is one document.

Consumers deduplicate by message id (at-least-once).`,
  pts: [r`One transaction or one document`, r`Change stream relay with resume token`, r`TTL to clean up`, r`Embedded pending-events alternative`, r`Idempotent consumers`],
  ex: r`An ordering service lost 0.1% of events with publish-after-commit; the outbox brought losses to zero.`,
  fu: [r`How do you keep per-aggregate ordering?`],
  pit: [r`Publishing to Kafka inside the transaction callback.`] },

{ id: 'q22', level: 'Senior', tags: ['anti-patterns'],
  code: r`~~~javascript
// Unbounded array (anti-pattern): every message appended to one conversation document
db.conversations.updateOne({ _id: convId }, { $push: { messages: msg } });
// Bucket pattern: at most 100 messages per document, new bucket when full
db.messageBuckets.updateOne(
  { conversationId: convId, count: { $lt: 100 } },
  { $push: { messages: msg }, $inc: { count: 1 }, $setOnInsert: { firstAt: msg.at } },
  { upsert: true });
db.messageBuckets.createIndex({ conversationId: 1, firstAt: -1 });
~~~`,
  q: r`What are the most damaging MongoDB schema anti-patterns you have seen?`,
  a: r`1. **Unbounded arrays**: documents grow until the 16 MB limit, every update rewrites a large document, multikey indexes explode.
2. **Massive number of collections** (per user, per day): each collection and index uses files and cache.
3. **Bloated documents**: rarely used large fields read on every query; split into a separate collection (subset pattern).
4. **Unnecessary indexes**: hurting writes and cache.
5. **Separating data accessed together**: relational normalisation with many $lookups.
6. **Case-insensitive queries without a collation index** ({{$regex: /^x$/i}} cannot use an index efficiently).
7. **Monotonic shard keys** creating hot shards.
8. **Using MongoDB as a queue** with polling on unindexed fields.

The common root cause is designing without explicit access patterns and growth estimates.`,
  pts: [r`Unbounded arrays`, r`Collection explosion`, r`Bloated documents`, r`Over-normalisation`, r`Monotonic shard keys`],
  ex: r`A chat app stored all messages in a conversation document; popular group chats hit 16 MB and failed writes. Bucketing 100 messages per document fixed it.`,
  fu: [r`How would you migrate away from an unbounded array live?`],
  pit: [r`Treating anti-patterns as theory; give a real symptom for each.`] },

{ id: 'q23', level: 'Senior', tags: ['backup', 'dr'],
  code: r`~~~javascript
// Delayed hidden secondary: an hour behind, never primary, invisible to clients
cfg = rs.conf();
cfg.members[4] = { _id: 4, host: "mongo-delayed:27017", priority: 0, hidden: true, secondaryDelaySecs: 3600, votes: 0 };
rs.reconfig(cfg);
~~~
~~~bash
# Restore one collection from the delayed member after an accidental drop
mongodump --host mongo-delayed --db shop --collection orders --out /tmp/orders
mongorestore --host rs0/mongo-a --nsInclude shop.orders /tmp/orders
~~~`,
  q: r`How do you back up and restore MongoDB, including sharded clusters?`,
  a: r`Methods:

- **{{mongodump}}/{{mongorestore}}**: logical, slow for large data, no consistent snapshot across shards. OK for small databases and migrations.
- **Filesystem/volume snapshots** with journaling on: fast; for sharded clusters you must coordinate (stop balancer, snapshot all shards and config servers consistently).
- **Atlas Cloud Backup / Ops Manager**: continuous backup with **point-in-time restore** and consistent sharded-cluster snapshots. This is the practical choice for production.

Operational rules:

- Define RPO/RTO and test restores regularly; measure restore time for your largest cluster.
- Copy backups to another region/account; protect from deletion.
- Remember restore also needs indexes built (logical restores) which can take hours.
- Delayed hidden secondary (e.g. 1 hour behind) protects against operator error (dropped collection) for fast recovery.`,
  pts: [r`mongodump not for large prod`, r`Coordinated snapshots for sharding`, r`Atlas PITR`, r`Test restores, measure RTO`, r`Delayed secondary for human error`],
  ex: r`An engineer dropped a collection in production; a 1-hour delayed secondary allowed copying the collection back in 20 minutes instead of a full restore.`,
  fu: [r`How do you restore a single collection from a sharded backup?`],
  pit: [r`Snapshotting shards independently and getting an inconsistent cluster.`] },

{ id: 'q24', level: 'Senior', tags: ['atlas-search', 'search'],
  code: r`~~~javascript
db.products.aggregate([
  { $search: { index: "products", compound: {
      must: [ { text: { query: "trail shoe", path: ["name", "description"], fuzzy: { maxEdits: 1 } } } ],
      filter: [ { equals: { path: "inStock", value: true } } ] } } },
  { $limit: 20 },
  { $project: { name: 1, price: 1, score: { $meta: "searchScore" } } } ]);
db.docs.aggregate([
  { $vectorSearch: { index: "docs_vec", path: "embedding", queryVector: qv, numCandidates: 200, limit: 8,
                     filter: { tenantId: "t1" } } } ]);
~~~`,
  q: r`When would you use Atlas Search or Atlas Vector Search instead of regular indexes?`,
  a: r`Regular indexes handle exact match, ranges and sorting. They do not handle relevance, typos, stemming, synonyms, facets or semantic similarity.

**Atlas Search** (Lucene-based, runs alongside mongod, synced automatically): full-text with analyzers, fuzzy matching, autocomplete, facets, highlighting, scoring. Queried through the {{$search}} aggregation stage.

**Atlas Vector Search**: approximate nearest-neighbour search over embeddings ({{$vectorSearch}}), with pre-filters on indexed fields; good for RAG and semantic search co-located with operational data.

Trade-offs: search indexes are eventually consistent (sync lag of seconds), run on extra resources (dedicated search nodes in larger tiers), and lock you into Atlas. Self-hosted alternatives: Elasticsearch/OpenSearch with a CDC pipeline, or the newer self-managed search in Community/Enterprise where available.

Hybrid search combines $search and $vectorSearch results with rank fusion.`,
  pts: [r`Regular indexes are not relevance search`, r`Atlas Search = Lucene, $search`, r`Vector Search for embeddings`, r`Eventual consistency of search indexes`, r`Lock-in trade-off`],
  ex: r`A product catalogue moved from $regex queries to Atlas Search with autocomplete and fuzzy matching; search conversion rose and primary CPU dropped.`,
  fu: [r`How do you keep a self-hosted OpenSearch in sync?`],
  pit: [r`Using case-insensitive $regex for user-facing search.`] },

{ id: 'q25', level: 'Senior', tags: ['performance', 'incident'],
  code: r`~~~javascript
// Hot-document contention: one global counter document serialises traffic
db.counters.updateOne({ _id: "requests" }, { $inc: { n: 1 } });
// Sharded counter: spread over 10 documents, sum on read
db.counters.updateOne({ _id: "requests:" + Math.floor(Math.random() * 10) }, { $inc: { n: 1 } }, { upsert: true });
db.counters.aggregate([{ $match: { _id: /^requests:/ } }, { $group: { _id: null, n: { $sum: "$n" } } }]);
~~~`,
  q: r`p99 latency on the primary tripled after a release. Walk through the investigation.`,
  a: r`1. **Scope**: which operations? Atlas/Ops Manager metrics or {{serverStatus}}: opcounters, query targeting (scanned/returned), cache usage, tickets, disk IOPS, replication lag.
2. **What changed**: the release. Diff new queries; check the profiler for new slow query shapes.
3. **Query targeting ratio** spike usually means a new query without an index or a changed filter (e.g. added {{$or}} or {{$regex}}).
4. **Cache**: a new index or larger documents pushing the working set out of memory: eviction by application threads.
5. **Locks/conflicts**: write conflicts on hot documents (counters, a shared config document) from a new feature.
6. **Connections**: a pool misconfiguration creating thousands of connections.

Fix: roll back or feature-flag off if user impact is large, then add the index (in a rolling build) or rewrite the query. Prevent: performance tests with production-like data and explain checks in CI for new query shapes.`,
  pts: [r`Scope the operation and metric`, r`Correlate with the release`, r`Query targeting ratio`, r`Cache eviction`, r`Hot-document conflicts`],
  ex: r`A new feature incremented a global counter document on every request; write conflicts serialised traffic. Sharded counters (10 documents summed on read) fixed it.`,
  fu: [r`How do you add an index on a large collection without impact?`],
  pit: [r`Scaling the instance before identifying the query.`] },

{ id: 'q26', level: 'Senior', tags: ['consistency', 'causal'],
  q: r`Explain causal consistency in MongoDB and when you need it.`,
  a: r`A **causally consistent session** guarantees, for operations in that session: read-your-writes, monotonic reads, monotonic writes, and writes-follow-reads, even when reads go to secondaries.

It works by passing {{operationTime}} and {{clusterTime}}: a secondary waits until it has applied up to the session's last seen time before answering.

Requirements: {{readConcern: majority}} and {{writeConcern: majority}} for the guarantees to hold through failovers.

~~~csharp
using var session = await client.StartSessionAsync(new ClientSessionOptions { CausalConsistency = true });
await profiles.UpdateOneAsync(session, p => p.Id == id, update);
var p = await profilesOnSecondary.Find(session, x => x.Id == id).FirstAsync(); // sees the update
~~~

Use when you offload reads to secondaries but a user must see their own changes. The session must be carried across the user's requests (or you fall back to primary reads for a short window).`,
  pts: [r`Read-your-writes, monotonic reads/writes`, r`Cluster time gossip`, r`Needs majority concerns`, r`Session must span the operations`],
  ex: r`A profile edit page read from nearest secondary in a multi-region cluster; a causal session made users always see their own edits.`,
  fu: [r`How do you carry a session across HTTP requests?`],
  pit: [r`Assuming causal consistency is global across all clients.`] },

{ id: 'q27', level: 'Senior', tags: ['migration', 'zero-downtime'],
  code: r`~~~csharp
ObjectId last = await _checkpoints.LoadAsync("currency-backfill") ?? ObjectId.Empty;
while (true)
{
    var batch = await _orders.Find(o => o.Id > last && o.SchemaVersion < 2).SortBy(o => o.Id).Limit(1000).ToListAsync(ct);
    if (batch.Count == 0) break;
    var writes = batch.Select(o => new UpdateOneModel<Order>(
        Builders<Order>.Filter.Eq(x => x.Id, o.Id) & Builders<Order>.Filter.Lt(x => x.SchemaVersion, 2),   // idempotent
        Builders<Order>.Update.Set(x => x.Currency, o.LegacyCurrency ?? "GBP").Set(x => x.SchemaVersion, 2)));
    await _orders.WithWriteConcern(WriteConcern.WMajority).BulkWriteAsync(writes, new BulkWriteOptions { IsOrdered = false }, ct);
    last = batch[^1].Id; await _checkpoints.SaveAsync("currency-backfill", last);
    while (await _lag.SecondsAsync() > 5) await Task.Delay(TimeSpan.FromSeconds(10), ct);   // throttle on replication lag
}
~~~`,
  q: r`How do you run a large data migration (backfill) in MongoDB without impacting production?`,
  a: r`- **Expand/contract**: deploy code that reads both old and new shapes and writes new; then backfill; then remove old code paths.
- **Batch by range** on {{_id}} (ObjectId is time-ordered) or an indexed field; e.g. 1,000 documents per {{bulkWrite}} with unordered operations.
- **Throttle** on replication lag and cache metrics: pause when secondary lag exceeds a few seconds (majority write concern naturally back-pressures).
- **Idempotent and resumable**: store a checkpoint (last processed _id); updates conditional on {{schemaVersion < 2}}.
- Run from a controlled worker, not a shell on a laptop; observability and a kill switch.
- Build new indexes before switching reads (index builds are online since 4.2 but take resources; build on a rolling basis for very large collections).
- Verify with counts per version and sampling comparisons before contracting.`,
  pts: [r`Expand/contract`, r`Batched bulkWrite by _id range`, r`Throttle on lag`, r`Resumable checkpoint, idempotent filter`, r`Verify before contract`],
  ex: r`A 2-billion-document currency-field migration ran over five days at a throttled rate with zero customer impact, paused automatically twice when lag rose.`,
  fu: [r`How would you handle documents modified during the backfill?`],
  pit: [r`One updateMany over the whole collection in peak hours.`] },

{ id: 'q28', level: 'Senior', tags: ['connection-pooling', 'serverless'],
  code: r`~~~csharp
var settings = MongoClientSettings.FromConnectionString(cs);
settings.MaxConnectionPoolSize = 40;           // per server, per client
settings.MaxConnecting = 2;                    // limits connection storms on deploys
settings.WaitQueueTimeout = TimeSpan.FromSeconds(2);
settings.ServerSelectionTimeout = TimeSpan.FromSeconds(5);
builder.Services.AddSingleton<IMongoClient>(new MongoClient(settings));
// 200 pods x 40 x 3 servers = up to 24,000 connections: size against the cluster tier limit
~~~`,
  q: r`How do connection limits and pooling work with MongoDB in Kubernetes and serverless .NET?`,
  a: r`Each {{MongoClient}} maintains a pool **per server** in the topology (primary and each secondary) plus monitoring connections. Total connections ≈ pods × (pool size used) × servers contacted.

At 200 pods × 100 maxPoolSize, a burst can open 20,000 connections; each server connection costs ~1 MB and CPU for authentication (SCRAM handshakes are expensive during storms).

Practices:

- Singleton client per process; set {{MaxConnectionPoolSize}} realistically (e.g. 20 to 50) and {{MaxConnecting}} (default 2) to limit storms.
- Set {{WaitQueueTimeout}} and operation timeouts ({{TimeoutMS}} in newer drivers) so overload fails fast.
- In Lambda/Azure Functions, create the client outside the handler to reuse across warm invocations; consider Atlas serverless/Data API patterns for extreme fan-out.
- Monitor connection counts per app; alert at a threshold below the tier limit.`,
  pts: [r`Pool per server per client`, r`Pods × pool × servers`, r`Limit pool size and MaxConnecting`, r`Client outside handler`, r`Fail fast timeouts`],
  ex: r`A deploy restarting 300 pods at once caused an authentication storm that pinned primary CPU; staggered rollout and MaxConnecting limits fixed it.`,
  fu: [r`Why are SCRAM handshakes expensive?`],
  pit: [r`Raising maxPoolSize when latency rises, worsening contention.`] },

{ id: 'q29', level: 'Senior', tags: ['multi-region'],
  code: r`~~~javascript
sh.shardCollection("bank.customers", { country: 1, customerId: 1 });
sh.addShardToZone("shard-eu-frankfurt", "EU"); sh.addShardToZone("shard-us-virginia", "US");
sh.updateZoneKeyRange("bank.customers", { country: "DE", customerId: MinKey }, { country: "DE", customerId: MaxKey }, "EU");
sh.updateZoneKeyRange("bank.customers", { country: "US", customerId: MinKey }, { country: "US", customerId: MaxKey }, "US");
~~~`,
  dia: r`flowchart LR
  EUApp[EU app] --> M1[mongos EU]
  USApp[US app] --> M2[mongos US]
  M1 -->|country in EU zone| EU[(EU shard: 3 members in 3 AZs)]
  M2 -->|country in US zone| US[(US shard: 3 members in 3 AZs)]
  M1 -. scatter-gather only for global queries .-> US`,
  q: r`Design a multi-region MongoDB deployment with data residency requirements.`,
  a: r`**Global reads, single write region**: a replica set with members in multiple regions (priority higher in the home region). Reads from {{nearest}} for latency; writes go to the primary's region. Majority writes need acknowledgement from a majority, so member placement determines write latency.

**Data residency / regional writes**: a **sharded cluster with zone sharding** (Atlas Global Clusters): shard key prefixed with a location field ({{{ country: 1, customerId: 1 }}}), zones map EU countries to EU shards and US to US shards. Each region writes locally and data stays in-region.

Considerations:

- Cross-region queries (global analytics) become scatter-gather and may move data across borders; build regional analytics, aggregate anonymised data centrally.
- A customer moving countries requires migrating their documents (change the shard key value).
- Failover policy per region: three members per zone's shard across AZs so a regional AZ loss does not move the primary abroad.
- Encryption keys per region (KMS) for sovereignty.`,
  pts: [r`Single-writer global reads`, r`Zone sharding for residency`, r`Location-prefixed shard key`, r`Cross-border analytics risk`, r`Per-region keys`],
  ex: r`A payments company used Atlas Global Clusters with EU and US zones to meet GDPR transfer requirements while serving each region with local writes.`,
  fu: [r`How does majority write concern behave with members in three regions?`],
  pit: [r`Putting a residency-restricted primary in a foreign region for latency.`] },

{ id: 'q30', level: 'Senior', tags: ['caching'],
  code: r`~~~csharp
// Change stream drives cache invalidation for writes from every service
using var cursor = await products.WatchAsync(
    new EmptyPipelineDefinition<ChangeStreamDocument<Product>>().Match(c => c.OperationType != ChangeStreamOperationType.Insert),
    new ChangeStreamOptions { ResumeAfter = await tokens.LoadAsync("product-cache") }, ct);
while (await cursor.MoveNextAsync(ct))
    foreach (var change in cursor.Current)
    {
        await redis.KeyDeleteAsync("product:" + change.DocumentKey["_id"]);
        await tokens.SaveAsync("product-cache", change.ResumeToken);
    }
~~~`,
  q: r`Should you put Redis in front of MongoDB? How do you keep it consistent?`,
  a: r`Ask first: is MongoDB actually the bottleneck after indexes and projections? With a good index and the working set in cache, MongoDB serves point reads in a millisecond or two. Redis adds value for:

- Very hot keys (product details on a home page) at high QPS.
- Computed results (aggregations, recommendations).
- Reducing cross-region read latency.

Consistency approaches:

- **Cache-aside with TTL**: simplest; tolerate staleness up to TTL.
- **Invalidate on write** in the same code path (delete key after DB commit); race: a concurrent reader can repopulate stale data. Mitigate with short TTLs or versioned keys.
- **Change-stream-driven invalidation**: a consumer deletes or refreshes cache keys for every change; catches writes from all services.

Protect against **stampedes** on popular keys (request coalescing, early refresh). Never let cache be the source of truth for money or inventory decisions.`,
  pts: [r`Prove the need first`, r`Cache-aside + TTL`, r`Change-stream invalidation`, r`Stampede protection`, r`Not for authoritative decisions`],
  ex: r`A catalogue service cut MongoDB read load by 85% with Redis plus change-stream invalidation, keeping staleness under a second.`,
  fu: [r`What is the delete-then-repopulate race?`],
  pit: [r`Caching inventory counts used for checkout decisions.`] },

{ id: 'q31', level: 'Senior', tags: ['indexes', 'operations'],
  code: r`~~~javascript
db.orders.aggregate([{ $indexStats: {} }, { $project: { name: 1, ops: "$accesses.ops", since: "$accesses.since" } }]);
db.orders.hideIndex("ix_status_createdAt");      // reversible instantly: unhideIndex
// ...observe for a full business cycle (month-end), then:
db.orders.dropIndex("ix_status_createdAt");
db.orders.createIndex({ tenantId: 1, createdAt: -1 }, { name: "ix_tenant_created", commitQuorum: "majority" });
~~~`,
  q: r`How do you manage indexes on a very large production collection?`,
  a: r`- **Build impact**: since 4.2, index builds use an optimised process holding exclusive locks only briefly at start and end, but they consume CPU, I/O and cache, and all data-bearing members build simultaneously (4.4+ commit quorum). For huge collections, use a **rolling index build** (one member at a time, out of the replica set) to cap impact.
- **Find unused indexes**: {{$indexStats}} over a representative period (including month-end jobs). Hide first ({{hideIndex}}), observe, then drop: hiding is reversible instantly.
- **Find missing indexes**: profiler, Performance Advisor, query targeting metrics.
- **Index size** vs cache: track total index size; partial indexes and fewer fields help.
- Indexes managed as code (migration scripts or IaC) so environments do not drift.`,
  pts: [r`Index builds cost resources`, r`Rolling builds for huge collections`, r`$indexStats for usage`, r`Hide before drop`, r`Indexes as code`],
  ex: r`Hiding an index believed unused revealed a quarterly report depending on it; unhiding took one command instead of a multi-hour rebuild.`,
  fu: [r`What is commit quorum?`],
  pit: [r`Dropping an index based on one week of stats.`] },

{ id: 'q32', level: 'Senior', tags: ['fintech', 'payments'],
  code: r`~~~csharp
public sealed class PaymentDoc
{
    public ObjectId Id { get; set; }
    [BsonRepresentation(BsonType.Decimal128)] public decimal Amount { get; set; }
    public string Currency { get; set; } = "";
    public string IdempotencyKey { get; set; } = "";          // unique index (merchantId, idempotencyKey)
    public string Status { get; set; } = "CREATED";
    public List<StatusChange> History { get; set; } = new();  // append-only via $push
}
await payments.WithWriteConcern(WriteConcern.WMajority).UpdateOneAsync(
    p => p.Id == id && p.Status == "AUTHORIZED",
    Builders<PaymentDoc>.Update.Set(p => p.Status, "CAPTURED").Push(p => p.History, new StatusChange("CAPTURED", DateTime.UtcNow)), cancellationToken: ct);
~~~`,
  q: r`Would you use MongoDB for payment transactions? Defend your answer.`,
  a: r`It can be done correctly, but the decision depends on what part of payments.

**Good fits**: payment **orchestration state** (a payment document with status history, provider attempts, webhook payloads embedded), merchant configuration, risk/fraud features, audit of provider payloads. These are document-shaped, read by id, and benefit from flexible schemas across providers.

**Requirements to do it safely**: {{w: majority}}, majority/snapshot reads for decisions, transactions where an outbox or multi-document invariant exists, idempotency keys with unique indexes, Decimal128 for amounts, JSON schema validation on the payment collection, immutable status-history arrays (append-only).

**Weaker fit**: the **double-entry ledger**, where constraints, set-based reconciliation queries and decades of accounting tooling favour a relational database. Many firms run orchestration in a document store and the ledger in PostgreSQL/SQL Server.

So: "yes for orchestration with these settings, prefer relational for the ledger", with reasons.`,
  pts: [r`Split orchestration vs ledger`, r`majority write concern`, r`Decimal128, unique idempotency keys`, r`Schema validation`, r`Relational for ledger`],
  ex: r`A PSP stored per-payment state machines in MongoDB (hundreds of provider-specific fields) and posted ledger entries to PostgreSQL via an outbox.`,
  fu: [r`How would you reconcile between the two stores?`],
  pit: [r`Answering yes or no with no conditions.`] },

{ id: 'q33', level: 'Senior', tags: ['observability'],
  code: r`~~~javascript
const rs0 = rs.printSecondaryReplicationInfo();
const oplog = db.getSiblingDB("local").oplog.rs;
const first = oplog.find().sort({ $natural: 1 }).limit(1).next().ts.getTime();
const last = oplog.find().sort({ $natural: -1 }).limit(1).next().ts.getTime();
print("oplog window hours:", (last - first) / 3600);
db.serverStatus().opLatencies;   // reads/writes/commands latency histograms
~~~`,
  q: r`Which MongoDB metrics do you alert on in production?`,
  a: r`- **Replication lag** and **oplog window** (hours of history): alert when the window shrinks below your longest expected secondary/consumer outage.
- **Query targeting** (docs examined per returned): rising means missing indexes.
- **Cache**: dirty and used percentages; application-thread eviction.
- **Tickets / queues**: queued readers/writers.
- **Connections** vs limit.
- **Opcounters and latency** per operation type (p95/p99 from the driver side too, via command monitoring events in .NET mapped to OpenTelemetry).
- **Disk**: IOPS, latency, free space.
- **Elections**: unexpected primary changes.
- **Backup** job success and last snapshot age.

Alert on user-impacting symptoms and capacity risks; keep the rest on dashboards.`,
  pts: [r`Lag and oplog window`, r`Query targeting`, r`Cache eviction`, r`Connections and tickets`, r`Elections and backups`],
  ex: r`An oplog-window alert caught that a 4x write surge had shrunk the window from 48 hours to 5, risking secondary resync; the oplog was enlarged.`,
  fu: [r`How do you trace a MongoDB call in OpenTelemetry from .NET?`],
  pit: [r`Monitoring only CPU and memory.`] },

{ id: 'q34', level: 'Senior', tags: ['data-modeling', 'patterns'],
  code: r`~~~javascript
// Attribute pattern: one index covers thousands of optional attributes
db.products.insertOne({ sku: "TV-55", category: "tv", attrs: [ { k: "screenInches", v: 55 }, { k: "panel", v: "OLED" } ] });
db.products.createIndex({ "attrs.k": 1, "attrs.v": 1 });
db.products.find({ attrs: { $elemMatch: { k: "panel", v: "OLED" } } });
// Computed pattern: maintain rating aggregates on write
db.products.updateOne({ sku: "TV-55" }, { $inc: { "rating.count": 1, "rating.sum": 5 } });
~~~`,
  q: r`Explain the polymorphic, attribute, computed and outlier patterns with examples.`,
  a: r`- **Polymorphic**: different shapes in one collection with a discriminator ({{type: "card"}}, {{"bank"}}), queried together (all payment methods for a customer). In C#, {{BsonDiscriminator}} with class hierarchies.
- **Attribute**: many similar optional fields turned into an array of key/value pairs so one index covers them: {{attrs: [{ k: "color", v: "red" }]}} with index {{{ "attrs.k": 1, "attrs.v": 1 }}}. Solves "index every attribute".
- **Computed**: store precomputed values updated on write (order total, review rating average) to avoid recomputation on every read.
- **Outlier**: most documents fit embedding, a few outliers (a celebrity with millions of followers) overflow into linked documents with a {{hasOverflow: true}} flag; normal documents stay fast.

Each pattern trades write complexity for read performance; document why in the schema docs.`,
  pts: [r`Polymorphic with discriminator`, r`Attribute pattern for sparse fields`, r`Computed for read-heavy aggregates`, r`Outlier for skewed sizes`],
  ex: r`A marketplace with 5,000 category-specific product attributes used the attribute pattern; one compound index replaced hundreds.`,
  fu: [r`How do you maintain computed fields consistently?`],
  pit: [r`Applying patterns without measured access patterns.`] },

{ id: 'q35', level: 'Senior', tags: ['testing'],
  code: r`~~~csharp
public sealed class MongoFixture : IAsyncLifetime
{
    private readonly MongoDbContainer _c = new MongoDbBuilder().WithImage("mongo:7.0").WithReplicaSet().Build(); // transactions + change streams
    public IMongoDatabase Db { get; private set; } = null!;
    public async Task InitializeAsync() { await _c.StartAsync(); Db = new MongoClient(_c.GetConnectionString()).GetDatabase("test"); }
    public Task DisposeAsync() => _c.DisposeAsync().AsTask();
}
[Fact] public async Task Ticket_query_uses_index()
{
    var explain = await _db.RunCommandAsync<BsonDocument>(new BsonDocument("explain",
        new BsonDocument { { "find", "tickets" }, { "filter", new BsonDocument("tenantId", "t1") },
                           { "sort", new BsonDocument("priority", -1) }, { "limit", 20 } }) { { "verbosity", "executionStats" } });
    explain["queryPlanner"]["winningPlan"].ToJson().Should().Contain("IXSCAN").And.NotContain("\"SORT\"");
    var stats = explain["executionStats"];
    stats["totalDocsExamined"].ToInt64().Should().BeLessThanOrEqualTo(stats["nReturned"].ToInt64() * 2);
}
~~~`,
  q: r`How do you test MongoDB-backed .NET services properly?`,
  a: r`- **Integration tests against real MongoDB** with Testcontainers (a single-node replica set, needed for transactions and change streams). Mocks of {{IMongoCollection}} test nothing important (queries, indexes, serialization).
- **Serialization tests**: round-trip domain types (Decimal128, Guid representation, enums as strings, polymorphic discriminators).
- **Index verification**: run key queries with explain in tests and assert {{IXSCAN}} and a sane examined/returned ratio; catches index regressions.
- **Concurrency tests**: parallel conditional updates to verify no oversell.
- **Migration tests**: run schema-version migrations over fixtures with old shapes.
- **Performance**: a production-sized dataset in a staging cluster for load tests; small fixtures hide COLLSCANs.`,
  pts: [r`Testcontainers single-node replica set`, r`Serialization round-trips`, r`Assert IXSCAN in tests`, r`Concurrency tests`, r`Production-sized load tests`],
  ex: r`An explain-assertion test caught a LINQ change that turned an indexed query into a $expr filter with COLLSCAN before it reached production.`,
  fu: [r`How do you speed up container-based tests?`],
  pit: [r`Mocking the collection and calling it an integration test.`] },

{ id: 'q36', level: 'Senior', tags: ['ef-core', 'dotnet'],
  code: r`~~~csharp
// EF Core provider: familiar for CRUD on whole aggregates
public sealed class ShopDb(DbContextOptions<ShopDb> o) : DbContext(o) { public DbSet<Customer> Customers => Set<Customer>(); }
builder.Services.AddDbContext<ShopDb>(o => o.UseMongoDB(mongoClient, "shop"));

// Native driver for a concurrency-sensitive path
await stock.UpdateOneAsync(s => s.Sku == sku && s.Available >= qty,
    Builders<Stock>.Update.Inc(s => s.Available, -qty), cancellationToken: ct);
~~~`,
  q: r`Should a .NET team use the EF Core MongoDB provider or the native driver?`,
  a: r`**EF Core provider** (MongoDB.EntityFrameworkCore): familiar DbContext, change tracking, LINQ, easy for teams coming from SQL. Limitations versus the native driver have included: limited support for some aggregation features, no direct change streams, fewer update operators (it saves whole documents or modified fields via tracking), and transactions/optimistic concurrency semantics to check per version.

**Native driver**: full feature set (aggregation, change streams, atomic operators like {{$inc}} with conditions, bulk writes, explain), explicit control.

Guidance: EF Core for CRUD-heavy domains where documents are read and saved whole by one service; native driver for performance-sensitive paths, concurrency-sensitive updates (counters, stock), streaming and analytics. They can coexist in one service (EF for aggregates, driver for special operations), but be careful not to bypass invariants.`,
  pts: [r`EF Core for CRUD familiarity`, r`Native driver for full features`, r`Atomic operators matter for concurrency`, r`Can coexist with care`],
  ex: r`A team used EF Core for admin CRUD and the native driver for a high-throughput stock reservation path using conditional $inc.`,
  fu: [r`How would you implement optimistic concurrency in each?`],
  pit: [r`Choosing EF Core then emulating relational joins.`] },

{ id: 'q37', level: 'Principal', tags: ['architecture-decision'],
  code: r`~~~sql
-- Often the "scalability" problem is this: a missing composite index and an N+1 loop
SELECT * FROM PolicyAttributes WHERE PolicyId = @id;   -- executed once per policy in a loop (N+1)
CREATE INDEX IX_Policy_Product_Status ON Policies (ProductCode, Status) INCLUDE (Premium);
-- Flexible product attributes: a JSON column instead of a database migration project
ALTER TABLE Policies ADD ProductAttributes NVARCHAR(MAX) CHECK (ISJSON(ProductAttributes) = 1);
~~~`,
  q: r`A team proposes moving their relational system to MongoDB "for scalability". How do you evaluate the proposal?`,
  a: r`Ask for evidence and alternatives before agreeing:

1. **Current bottleneck**: measured? Which queries, CPU, I/O, lock contention? Most relational scaling problems are indexing, N+1, pooling or caching issues fixable in weeks.
2. **Access patterns**: are entities naturally aggregates read by id, or is the domain join-heavy with ad hoc reporting? Join-heavy domains get worse in MongoDB.
3. **Consistency needs**: multi-entity invariants (ledgers, inventory across warehouses) are harder.
4. **Total cost**: rewrite of data access, migration, reporting pipeline changes, new operational skills, Atlas licensing vs current licensing.
5. **Risk**: dual-running, data migration validation, rollback plan.
6. **Alternatives**: vertical scale, read replicas, partitioning, functional split, jsonb columns for flexible attributes.

Outcome: often "move the flexible, document-shaped part (catalogue attributes, user preferences) to MongoDB or jsonb; keep the transactional core relational." Write it as an ADR with measurable success criteria and a pilot.`,
  pts: [r`Demand evidence of the bottleneck`, r`Access patterns decide`, r`Consistency needs`, r`Total cost and risk`, r`Consider partial moves and alternatives`],
  ex: r`A proposal to move an insurance policy system to MongoDB turned into fixing 6 missing indexes and moving product-specific policy attributes to jsonb; the migration was cancelled with a 5× latency improvement.`,
  fu: [r`What would convince you the move is right?`],
  pit: [r`Accepting "NoSQL scales better" as a premise.`],
  tip: r`Principals redirect from technology choice to the problem being solved, without dismissing the team.` },

{ id: 'q38', level: 'Principal', tags: ['cost', 'atlas'],
  code: r`~~~bash
# Online Archive: move orders older than 365 days to cheap object storage, still queryable
atlas clusters onlineArchives create --clusterName prod --db shop --collection orders \
  --dateField placedAt --archiveAfter 365 --partition customerId
atlas clusters update prod --autoScalingComputeEnabled --autoScalingComputeScaleDownEnabled \
  --tier M40 --autoScalingMaxInstanceSize M60
~~~`,
  q: r`How do you control MongoDB Atlas cost at scale?`,
  a: r`Cost drivers: cluster tier (RAM/CPU), storage and IOPS, backups (snapshot storage, PITR), data transfer (cross-region and internet egress), search nodes, and over-provisioned dev/test clusters.

Levers:

- **Right-size**: tier by working set and CPU, not data size; enable compute auto-scaling with bounds.
- **Archive cold data**: Online Archive to object storage for old documents (queryable via federated queries), or TTL/time-bucket deletions.
- **Indexes**: drop unused ones (they drive RAM tier).
- **Data transfer**: keep apps in the same region/cloud as the cluster; private endpoints; avoid cross-region reads unless needed.
- **Non-production**: pause dev clusters, smaller tiers, shared clusters for CI.
- **Backups**: retention policies matching compliance, not "keep forever".
- **Commercial**: annual commitments; compare with self-managed on Kubernetes (cheaper licences, more engineering and risk).

Show cost per business unit (cost per 1,000 orders) and review quarterly.`,
  pts: [r`Tier by working set`, r`Online Archive for cold data`, r`Drop unused indexes`, r`Avoid egress`, r`Unit economics reporting`],
  ex: r`Moving 70% of historical order data to Online Archive let a team drop two cluster tiers, saving about 40% of the bill.`,
  fu: [r`When is self-managed MongoDB cheaper overall?`],
  pit: [r`Scaling tiers to fix a missing index.`] },

{ id: 'q39', level: 'Principal', tags: ['incident', 'failover'],
  code: r`~~~bash
# Find rollback files after the old primary rejoined
ls /var/lib/mongodb/rollback/shop.payments/
bsondump /var/lib/mongodb/rollback/shop.payments/removed.2026-10-10T02-14-11.0.bson > rolled_back.json
grep -c '"_id"' rolled_back.json     # how many acknowledged writes were lost
~~~
~~~csharp
// The fix: majority acknowledgement for business writes (check for old overrides)
var payments = db.GetCollection<Payment>("payments").WithWriteConcern(WriteConcern.WMajority);
~~~`,
  q: r`After a regional network blip, customers report missing updates from the last minute. What happened and what do you change?`,
  a: r`Likely sequence: the primary was isolated, a new primary was elected in another zone, and the old primary had accepted writes that were acknowledged with {{w:1}} but never replicated. When it rejoined, those writes were **rolled back** (saved to rollback files). Clients saw success, data vanished.

Immediate actions:

1. Confirm via logs (election times, rollback events) and the rollback directory.
2. Assess impact: extract rolled-back documents with {{bsondump}}, identify affected customers/transactions.
3. Reconcile: re-apply valid changes (carefully, they may conflict with newer writes), notify stakeholders; for financial data, reconcile with external systems.

Changes:

- Write concern **majority** for all business-critical writes (default since 5.0, so check overrides and old driver configs).
- Majority read concern where decisions depend on reads.
- Retryable writes and idempotency keys so client retries are safe.
- Topology review: members spread across 3 zones, no arbiter-based majority.
- Add rollback detection to alerting and to the incident runbook.`,
  pts: [r`w:1 + failover = rollback`, r`Rollback files hold lost writes`, r`Reconcile, do not blindly re-apply`, r`majority concerns`, r`Topology and alerting fixes`],
  ex: r`A team found 340 rolled-back status updates after a network partition; switching to majority writes added 3 ms latency and removed the class of failure.`,
  fu: [r`What is the latency cost of majority writes across AZs?`],
  pit: [r`Blaming the network and closing the incident.`] },

{ id: 'q40', level: 'Principal', tags: ['platform', 'governance'],
  code: r`~~~csharp
// Internal NuGet: one call configures the client correctly for every service
public static IServiceCollection AddCompanyMongo(this IServiceCollection s, IConfiguration cfg)
{
    BsonSerializer.TryRegisterSerializer(new GuidSerializer(GuidRepresentation.Standard));
    BsonSerializer.TryRegisterSerializer(new DecimalSerializer(BsonType.Decimal128));
    ConventionRegistry.Register("company", new ConventionPack { new CamelCaseElementNameConvention(), new IgnoreExtraElementsConvention(true) }, _ => true);
    var settings = MongoClientSettings.FromConnectionString(cfg.GetConnectionString("Mongo"));
    settings.WriteConcern = WriteConcern.WMajority; settings.ServerSelectionTimeout = TimeSpan.FromSeconds(5);
    settings.ClusterConfigurator = c => c.Subscribe(new DiagnosticsActivityEventSubscriber());   // OpenTelemetry
    return s.AddSingleton<IMongoClient>(new MongoClient(settings));
}
~~~`,
  q: r`How would you set MongoDB standards across 20 product teams?`,
  a: r`- **Paved road**: a cluster provisioning module (Terraform Atlas provider) with defaults: majority write concern, backups with PITR, private networking, TLS, auditing, alerts and dashboards wired to on-call.
- **Client library**: a thin internal NuGet package configuring {{MongoClient}} (singleton, conventions, Decimal128, GuidRepresentation, OpenTelemetry instrumentation, timeouts), so every service starts correct.
- **Modelling reviews**: a short template (access patterns, growth, shard key candidates, indexes) for new collections; reviews by a guild, not a gate.
- **CI checks**: explain-based tests for key queries, schema validators as code, index definitions as code.
- **Operational ownership**: each team owns its clusters and on-call; platform team owns tooling and escalation.
- **Learning loop**: postmortems feed the paved road (e.g. after a rollback incident, enforce majority write concern in the library).

Measure: incidents by category, query targeting ratios, cost per cluster.`,
  pts: [r`Paved-road provisioning`, r`Shared client library`, r`Lightweight modelling reviews`, r`Checks in CI`, r`Ownership and learning loop`],
  ex: r`A shared client package fixed GUID representation inconsistencies that had caused cross-service lookups to fail silently.`,
  fu: [r`How do you get teams to adopt the shared library?`],
  pit: [r`Central DBA approval for every collection change.`] },

{ id: 'q41', level: 'Principal', tags: ['design', 'system-design'],
  q: r`Design the data layer for a product catalogue with 50 M SKUs, 2,000 categories with different attributes, and 20 K reads per second.`,
  a: r`### Model
- {{products}} collection: common fields (sku, title, brand, price snapshot, status) plus the **attribute pattern** for category-specific attributes; polymorphic by category with a {{schemaVersion}}.
- {{inventory}} separate (high write rate, different owner) to keep product documents read-mostly.
- {{pricing}} by region separately if prices change often.

### Indexes
{{{ categoryId: 1, status: 1, popularity: -1 }}}, attribute index {{{ "attrs.k": 1, "attrs.v": 1 }}}, unique sku.

### Reads at 20 K/s
Most reads are product detail by sku: cache in Redis/CDN at the edge with change-stream invalidation; MongoDB serves the misses. Search and faceting via Atlas Search or OpenSearch, not the primary.

### Writes
Bulk catalogue imports in batches with throttling; validation with $jsonSchema per category version.

### Scale
50 M documents × ~5 KB = 250 GB: one replica set may suffice with indexes in RAM; shard by hashed sku when write rate or working set outgrows a set.

~~~mermaid
flowchart LR
  Client --> CDN --> API[Catalogue API .NET]
  API --> R[(Redis)]
  API --> M[(MongoDB products)]
  API --> S[Search index]
  M -- change stream --> Inv[Invalidator] --> R
  M -- change stream --> Sync[Search sync] --> S
~~~`,
  pts: [r`Attribute pattern for variable attributes`, r`Split inventory and pricing`, r`Cache + CDN for detail reads`, r`Search engine for facets`, r`Shard when working set demands`],
  ex: r`A retailer's catalogue served 95% of detail reads from CDN/Redis; MongoDB handled 1,000 rps of misses on a modest replica set.`,
  fu: [r`How do you handle a price change that must be visible within 1 second?`],
  pit: [r`Putting stock counts in the product document read by every page view.`] },

{ id: 'q42', level: 'Principal', tags: ['compliance', 'gdpr'],
  code: r`~~~csharp
// Crypto-shredding with CSFLE: each subject's PII encrypted under its own data key
var keyId = await clientEncryption.CreateDataKeyAsync("aws", new DataKeyOptions(masterKey: kmsKey, alternateKeyNames: ["subject-" + subjectId]), ct);
var encryptedEmail = await clientEncryption.EncryptAsync(email,
    new EncryptOptions(EncryptionAlgorithm.AEAD_AES_256_CBC_HMAC_SHA_512_Random.ToString(), alternateKeyName: "subject-" + subjectId), ct);
// Erasure: delete the key; ciphertext in documents, backups and exports becomes unreadable
await keyVault.DeleteOneAsync(Builders<BsonDocument>.Filter.Eq("keyAltNames", "subject-" + subjectId), ct);
~~~`,
  q: r`How do you implement right-to-erasure and retention policies in MongoDB across replicas, backups and downstream systems?`,
  a: r`- **Data map**: which collections hold personal data, and which downstream systems receive it via change streams/CDC (search, warehouse, caches, logs).
- **Design for erasure**: personal data in a {{subjects}} collection referenced by id; operational documents keep only the id. Erasure deletes or pseudonymises the subject document.
- **Crypto-shredding**: CSFLE with a per-subject data key; deleting the key from the key vault renders encrypted fields unreadable everywhere, including backups.
- **Propagation**: delete operations flow through change streams to downstream systems; each consumer must handle deletes (tombstones in Kafka compacted topics).
- **Retention**: TTL indexes or time-partitioned collections for expiry; legal hold flag overrides.
- **Evidence**: erasure log (id, date, systems confirmed), without the erased data.

Replicas apply deletes automatically; backups expire per retention, and a restore procedure re-applies the erasure log.`,
  pts: [r`Data map including downstream`, r`Separate PII collection`, r`CSFLE per-subject key shredding`, r`Propagate deletes as events`, r`Restore re-applies erasures`],
  ex: r`An audit found erased customers still in the search index; adding delete handling to the search sync consumer closed the gap.`,
  fu: [r`How do you handle erasure in immutable event logs?`],
  pit: [r`Deleting from the primary database only.`] },

{ id: 'q43', level: 'Principal', tags: ['migration'],
  code: r`~~~bash
mongosync --cluster0 "mongodb://src-a,src-b,src-c/?replicaSet=rs0" \
          --cluster1 "mongodb+srv://prod.abcd.mongodb.net" &
curl -X POST localhost:27182/api/v1/start -d '{"source":"cluster0","destination":"cluster1"}'
curl localhost:27182/api/v1/progress           # lagTimeSeconds -> 0 before cutover
# write freeze, then:
curl -X POST localhost:27182/api/v1/commit -d '{}'
~~~`,
  q: r`Plan a migration from self-managed MongoDB on VMs to Atlas with near-zero downtime.`,
  a: r`1. **Assess**: versions (target supports source version?), feature compatibility (server-side JS, deprecated operators), cluster size, oplog window, network path (private endpoint/VPC peering), and security requirements.
2. **Choose tool**: **mongosync / Atlas Live Migration** (initial sync + continuous replication of changes) for replica sets and sharded clusters.
3. **Prepare target**: tier sized from working set, indexes (built during sync), users/roles, network, backups, alerts.
4. **Sync** and monitor lag; validate with document counts and hash comparisons per collection, plus application-level checks.
5. **Rehearse cutover** in a staging environment, measure write freeze duration.
6. **Cutover**: stop writes (maintenance mode or connection string swap via config), wait for lag zero, commit the sync, switch applications (feature flag or config), smoke tests.
7. **Rollback**: keep the source intact and reverse sync where supported, or a defined point of no return.
8. Decommission after a stabilisation period.`,
  pts: [r`Assess compatibility and network`, r`mongosync / Live Migration`, r`Validate counts and hashes`, r`Rehearse cutover`, r`Rollback plan and point of no return`],
  ex: r`A 12 TB sharded cluster moved to Atlas with a 4-minute write freeze, rehearsed twice beforehand.`,
  fu: [r`How do you migrate a sharded cluster with a different shard key?`],
  pit: [r`Using mongodump/restore for terabytes with live writes.`] },

{ id: 'q44', level: 'Principal', tags: ['event-sourcing'],
  dia: r`flowchart LR
  W[Write side: Marten / PostgreSQL event store] -->|events| K[Kafka]
  K --> P1[Projection: order summary]
  K --> P2[Projection: customer 360]
  P1 -->|upsert where version lower| M1[(MongoDB orderSummaries)]
  P2 --> M2[(MongoDB customer360)]
  UI[Angular / React UI] --> Q[Query API] --> M1 & M2`,
  q: r`Would you build an event store or CQRS read models on MongoDB?`,
  a: r`**Read models**: an excellent fit. Projections write denormalised documents per screen or API (order summary, customer 360), updated by event consumers with idempotent upserts keyed by aggregate id and version:

~~~javascript
db.orderSummaries.updateOne(
  { _id: orderId, version: { $lt: eventVersion } },
  { $set: { status: "SHIPPED", version: eventVersion } },
  { upsert: false });
~~~

**Event store**: possible with a collection {{{ streamId, version, type, data }}} and a unique index on (streamId, version) for optimistic concurrency. Global ordering is the hard part: there is no gap-free global sequence; change streams give an ordered stream per replica set (via cluster time), and sharding complicates global order further.

Alternatively store events **inside the aggregate document** for small streams (atomic append + state), with an outbox for publishing.

Recommendation: MongoDB for read models, yes; for the event store prefer a purpose-built option (EventStoreDB, PostgreSQL via Marten, Kafka as distribution) unless the team already operates MongoDB and global ordering is not needed.`,
  pts: [r`Read models are a great fit`, r`Version-guarded idempotent projections`, r`Unique (stream, version)`, r`Global ordering is hard`, r`Purpose-built stores for event sourcing`],
  ex: r`A logistics platform kept its write side in PostgreSQL (Marten) and built 14 MongoDB read models for different UIs, each rebuildable from events.`,
  fu: [r`How do you rebuild a read model with zero downtime?`],
  pit: [r`Projections without version checks (out-of-order events overwrite newer state).`] },

{ id: 'q45', level: 'Principal', tags: ['capacity-planning'],
  code: r`~~~javascript
// Oplog generation rate: GB/hour drives secondary and oplog-window sizing
const s1 = db.getSiblingDB("local").oplog.rs.stats().size; sleep(60000);
const s2 = db.getSiblingDB("local").oplog.rs.stats().size;
print("oplog MB/min:", (s2 - s1) / 1e6);
// Working set estimate: hot indexes + hot documents vs WiredTiger cache
printjson(db.orders.stats({ scale: 1e9 }).totalIndexSize);
~~~`,
  q: r`How do you capacity-plan a MongoDB cluster and decide when to shard?`,
  a: r`Measure: data size growth, **working set** (hot data + indexes), peak ops/s by type, write throughput (oplog GB/hour), CPU, disk IOPS, and replication lag at peak.

Shard when one of these is true and cannot be solved more cheaply:

- Working set cannot fit in RAM on the largest sensible tier.
- Write throughput saturates the primary's CPU or disk (secondaries cannot scale writes).
- Oplog generation outpaces what secondaries or the oplog window can sustain.
- Restore time for one replica set exceeds RTO (smaller shards restore in parallel).
- Data residency requires geographic partitioning.

Before sharding: indexes, archiving, compression, document size reduction, vertical scale.

Shard **before** you are at the edge: balancing moves data and adds load; sharding an overloaded cluster makes the overload worse. Plan the shard key early, even if you start unsharded.`,
  pts: [r`Working set vs RAM`, r`Write throughput is the classic trigger`, r`Restore time as a sharding trigger`, r`Exhaust cheaper options`, r`Shard before the edge`],
  ex: r`A team waited until the primary was at 95% CPU to shard; chunk migrations made it worse and required an emergency traffic shed. The next cluster sharded at 60%.`,
  fu: [r`How do you estimate working set?`],
  pit: [r`Sharding to fix slow queries caused by missing indexes.`] },

{ id: 'q46', level: 'Principal', tags: ['interview-scenario'],
  code: r`~~~csharp
public sealed record Notification(ObjectId Id, string UserId, DateTime CreatedAt, bool Read, string Payload);
// index { userId: 1, createdAt: -1 } + TTL on createdAt
await notifications.InsertOneAsync(n, cancellationToken: ct);
// bounded subset for the header: keep only the latest 5 unread on the user document
await users.UpdateOneAsync(u => u.Id == n.UserId,
    Builders<User>.Update.PushEach(u => u.LatestUnread, [n.Summary()], slice: -5), cancellationToken: ct);
~~~`,
  q: r`A teammate wants to store each user's notifications in an array on the user document. Review the proposal.`,
  a: r`Questions: how many notifications per user (median, p99, worst case)? How long are they kept? How are they read (latest 20, unread count)? How are they written (fan-out to millions for a broadcast)?

Concerns:

- **Unbounded growth**: heavy users accumulate thousands; documents grow towards 16 MB, every update rewrites a large document, the working set bloats because the user document is read on every request.
- **Write contention** on the user document from notification writes plus profile updates.
- **Broadcasts** become millions of document updates.

Better design:

- {{notifications}} collection: {{{ userId, createdAt, read, payload }}}, index {{{ userId: 1, createdAt: -1 }}}, TTL for expiry.
- Optional **subset**: embed the last 5 unread for a fast header, bounded with {{$push}} + {{$slice: -5}}.
- Unread count as a computed counter, or counted on demand with a partial index on unread.
- Broadcasts stored once and merged at read time (fan-out on read) for global announcements.

Deliver feedback as questions and data, not a veto.`,
  pts: [r`Ask for cardinality and lifecycle`, r`Unbounded array risks`, r`Separate collection + TTL`, r`Bounded subset with $slice`, r`Fan-out on read for broadcasts`],
  ex: r`A social feature launched with the array approach; three months later top users' documents exceeded 10 MB and login latency rose 4×.`,
  fu: [r`How do you migrate existing arrays out?`],
  pit: [r`Rejecting without asking about expected sizes.`] },

{ id: 'q47', level: 'Principal', tags: ['resilience'],
  code: r`~~~csharp
var settings = MongoClientSettings.FromConnectionString(cs);
settings.ServerSelectionTimeout = TimeSpan.FromSeconds(5);   // default 30 s hangs API requests during elections
settings.RetryWrites = true; settings.RetryReads = true;
builder.Services.AddResiliencePipeline("mongo", p => p
    .AddCircuitBreaker(new() { FailureRatio = 0.5, MinimumThroughput = 30, BreakDuration = TimeSpan.FromSeconds(10) })
    .AddTimeout(TimeSpan.FromSeconds(3)));
// unique operation id makes an ambiguous retry safe
await payments.InsertOneAsync(new Payment { OperationId = opId /* unique index */ }, cancellationToken: ct);
~~~
~~~javascript
rs.stepDown(60);   // chaos test under load: measure user-visible errors
~~~`,
  q: r`How do you make a .NET service resilient to MongoDB failovers and brownouts?`,
  a: r`- **Retryable writes and reads** (driver defaults) cover one retry on transient errors like a primary step-down.
- **Idempotency** for business operations: a retry after an ambiguous error (timeout after the write reached the server) must not double-apply; use unique operation ids.
- **Timeouts**: server selection timeout (default 30 s is too long for APIs: set ~5 s), operation timeouts / {{TimeoutMS}}, {{maxTimeMS}} on queries.
- **Circuit breakers / bulkheads** (Polly) to stop overload from cascading; separate pools for critical and non-critical paths if needed.
- **Graceful degradation**: serve cached data, queue writes (outbox to a durable queue) for non-critical features.
- **Load shedding** when queues build.
- **Test it**: chaos tests that step down the primary ({{rs.stepDown()}}) during load tests; measure user-visible errors.`,
  pts: [r`Retryable writes`, r`Idempotency for ambiguous results`, r`Short server selection timeouts`, r`Breakers and bulkheads`, r`Step-down chaos tests`],
  ex: r`A step-down test showed 30-second request hangs from the default server selection timeout; reducing it to 5 s and adding a fallback cut user errors to a few seconds of retries.`,
  fu: [r`What does an ambiguous commit look like in the driver?`],
  pit: [r`Infinite retries amplifying load during a brownout.`] },

{ id: 'q48', level: 'Principal', tags: ['comparison', 'cosmos'],
  code: r`~~~bash
# Two-week spike: run the real test suite and query corpus against each target
dotnet test tests/Repository.IntegrationTests -e MONGO_CS="$ATLAS_CS"
dotnet test tests/Repository.IntegrationTests -e MONGO_CS="$COSMOS_VCORE_CS"
dotnet test tests/Repository.IntegrationTests -e MONGO_CS="$COSMOS_RU_CS" --logger "trx;LogFileName=cosmos-ru.trx"
# Cosmos RU cost of a query shape (RU-based API)
mongosh "$COSMOS_RU_CS" --eval 'db.orders.find({tenantId:"t1"}).sort({placedAt:-1}).limit(20).toArray(); db.runCommand({getLastRequestStatistics:1})'
~~~`,
  q: r`Azure Cosmos DB for MongoDB vs MongoDB Atlas: how do you choose?`,
  a: r`| | Cosmos DB for MongoDB (RU-based) | Cosmos DB for MongoDB vCore | MongoDB Atlas |
|---|---|---|---|
| Engine | Cosmos engine with MongoDB wire protocol | MongoDB-compatible on vCore | Genuine MongoDB |
| Compatibility | Subset; some operators, aggregation, transactions behave differently | Higher compatibility | Full, latest features |
| Scaling | Request units, partition key, autoscale | vCore tiers | Tiers, sharding |
| Global distribution | Turnkey multi-region writes | Region replicas | Global clusters |
| Integration | Azure-native (Entra ID, Private Link, billing) | Azure-native | Multi-cloud, Atlas Search/Vector |

Choose Cosmos when Azure-native integration, procurement and turnkey global distribution matter and your workload fits within the compatibility surface (verify with real queries). Choose Atlas when you need full MongoDB features, newest versions, change stream fidelity, search/vector features, or multi-cloud portability.

Run a compatibility spike with your actual queries and drivers before committing; RU pricing needs workload modelling (cost spikes on unindexed queries).`,
  pts: [r`Wire-protocol compatibility vs genuine engine`, r`RU model needs modelling`, r`Azure integration vs full features`, r`Spike with real queries`],
  ex: r`A team's aggregation pipelines with $lookup and $facet behaved differently on RU-based Cosmos; they chose vCore after a two-week spike.`,
  fu: [r`How would you estimate RU cost?`],
  pit: [r`Assuming "MongoDB API" means identical behaviour.`] },

{ id: 'q49', level: 'Principal', tags: ['code-review'],
  q: r`Code review: what is wrong with this MongoDB repository code?`,
  a: r`~~~csharp
public class WalletRepository
{
    public async Task Debit(string walletId, double amount, string filterJson)
    {
        var client = new MongoClient(_cs);
        var col = client.GetDatabase("wallets").GetCollection<BsonDocument>("wallets");
        var filter = BsonDocument.Parse(filterJson);       // from the request
        var wallet = await col.Find(filter).FirstOrDefaultAsync();
        var balance = wallet["balance"].AsDouble - amount;
        wallet["balance"] = balance;
        await col.ReplaceOneAsync(new BsonDocument("_id", wallet["_id"]), wallet);
    }
}
~~~

1. **Operator injection**: parsing a filter from request input lets callers query any wallet ({{$ne}}, {{$gt}}). Build filters from typed values.
2. **Race**: read, compute in memory, replace: concurrent debits lose updates and can overdraw. Use {{UpdateOne}} with filter {{balance >= amount}} and {{$inc}}.
3. **double for money**: use {{decimal}} stored as Decimal128.
4. **New MongoClient per call**: pool exhaustion; inject a singleton.
5. **No idempotency**: retries double-debit; record an operation id with a unique index (in a transaction with the debit, or in the wallet document's recent-operations array).
6. **Null handling**: FirstOrDefault may be null.
7. **Untyped BsonDocument** everywhere: lose compile-time safety; use typed models.
8. No {{CancellationToken}}, no write concern specified for a financial write (verify majority).

~~~csharp
var r = await _wallets.UpdateOneAsync(
    w => w.Id == walletId && w.Balance >= amount && !w.RecentOps.Contains(opId),
    Builders<Wallet>.Update.Inc(w => w.Balance, -amount).Push(w => w.RecentOps, opId),
    cancellationToken: ct);
if (r.ModifiedCount == 0) { /* insufficient funds or duplicate: check which */ }
~~~`,
  pts: [r`Operator injection`, r`Read-modify-replace race`, r`double for money`, r`Client per call`, r`Idempotency`],
  ex: r`An injected filter in a similar endpoint allowed reading other customers' wallets in a penetration test.`,
  fu: [r`How would you bound the RecentOps array?`],
  pit: [r`Fixing only the data type.`] },

{ id: 'q50', level: 'Principal', tags: ['leadership', 'strategy'],
  code: r`~~~text
Peak-season ask (one slide)
Last peak: 18 K ops/s, CPU 70%.  Forecast: 2x.  Load test knee: 1.6x (p99 120 ms -> 900 ms).
Risk: checkout slowdown at peak; failover during peak overloads new primary.
Options: (a) tier M60->M80  +$X/month, 1 day, buys 1.5x
         (b) index + query fixes  2 sprints, buys 1.5x
         (c) shard orders by customerId  6 weeks, buys 5x+
Recommend: (b) now + (a) as insurance; (c) next quarter.  Decision needed by: 1 Nov.
~~~`,
  q: r`How do you explain to executives why the MongoDB cluster needs investment before the next peak season?`,
  a: r`Translate technical risk into business terms with evidence:

1. **Current state in numbers**: peak last year was 18 K ops/s at 70% CPU; this year's forecast is 2× traffic. Working set already at 85% of cache.
2. **Risk**: at forecast load, modelled CPU exceeds 100% and latency rises non-linearly; a failover during peak would leave the new primary overloaded. Express as probability and impact: "likely checkout slowdowns in peak hours; each minute of degraded checkout at peak costs about X in revenue."
3. **Options with cost and timeline**: (a) tier upgrade (cost Y/month, 1 day, buys 1.5×), (b) query and index work (2 sprints, buys ~1.5×), (c) sharding (6 weeks, buys 5×+ long-term). Recommend a combination: (b) now, (a) as insurance for peak, (c) planned for next year.
4. **Proof**: load test results, not opinions.
5. **Ask**: specific budget and people, and a decision date because sharding has a lead time.

Executives fund risk reduction they can understand and compare.`,
  pts: [r`Numbers, not adjectives`, r`Revenue impact of degradation`, r`Options with cost and time`, r`Load test evidence`, r`Decision date`],
  ex: r`Presenting a load-test graph showing the latency knee at 1.6× traffic secured approval for a sharding project two months before peak season.`,
  fu: [r`What if they choose only the cheapest option?`],
  pit: [r`Leading with technical jargon (eviction, tickets) instead of business impact.`] }
],
cheat: r`### Modelling
Model for access patterns. Embed bounded, owned, co-read data; reference unbounded or shared. Patterns: extended reference, subset, bucket, attribute, computed, outlier, polymorphic, schema versioning. 16 MB doc limit.

### Indexes
ESR (equality, sort, range). Covered queries. Partial, unique (+shard key prefix), TTL. Hide before drop. explain executionStats: keys/docs examined ≈ returned; avoid COLLSCAN and in-memory SORT.

### Consistency
| Setting | Use |
|---|---|
| w: majority | Business-critical writes (no rollback) |
| readConcern majority | Decisions on reads |
| Causal session | Read-your-writes from secondaries |
| Transactions | Genuine multi-doc invariants, outbox |

### Scale
Replica set (3 AZs, odd voters). Shard on high-cardinality, even, non-monotonic key present in queries; targeted vs scatter-gather. Zones for residency/tenants. Shard before the edge.

### .NET
Singleton MongoClient, Decimal128 for money, Standard GUIDs, typed builders (no JSON filters from input), conditional $inc for concurrency, CancellationToken, Testcontainers single-node RS.

### Ops
Oplog window vs longest outage; change streams + resume tokens; rolling index builds; Atlas PITR + restore tests; delayed secondary for human error.

### Say this
"Data read together is stored together." "w:1 plus failover means rollback." "Targeted, not scatter-gather." "MongoDB for orchestration and read models, relational for the ledger."`
});
})(String.raw);
