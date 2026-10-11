(function (r) {
registerTopic('05-postgresql', {
related: ['04-sql-server', '56-linq-efcore', '29-performance-engineering'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['mvcc', 'internals'],
  code: r`~~~sql
CREATE TABLE sessions (id int PRIMARY KEY, last_seen timestamptz) WITH (fillfactor = 80);  -- room for HOT updates
INSERT INTO sessions VALUES (1, now());
SELECT xmin, xmax, ctid, * FROM sessions WHERE id = 1;     -- ctid (0,1)
UPDATE sessions SET last_seen = now() WHERE id = 1;
SELECT xmin, xmax, ctid, * FROM sessions WHERE id = 1;     -- new tuple, new ctid (0,2): old one is dead
SELECT n_tup_upd, n_tup_hot_upd, n_dead_tup FROM pg_stat_user_tables WHERE relname = 'sessions';
~~~`,
  q: r`How does MVCC work in PostgreSQL, and what does it cost?`,
  a: r`PostgreSQL never updates a row in place. Every row version (a **tuple**) carries {{xmin}} (the transaction that created it) and {{xmax}} (the transaction that deleted or superseded it). An {{UPDATE}} is a delete plus an insert: the old tuple gets an {{xmax}}, a new tuple is written elsewhere in the heap.

A reader takes a **snapshot** (which transaction ids are committed and visible) and checks each tuple's {{xmin}}/{{xmax}} against it. So readers never block writers and writers never block readers; only writer-vs-writer on the same row conflicts.

The costs:

- **Dead tuples** accumulate until {{VACUUM}} reclaims them, causing **bloat** in tables and indexes.
- Every update writes a full new tuple and, unless it is a **HOT** update, a new entry in every index.
- Transaction ids are 32-bit, so tables must be **frozen** periodically to avoid wraparound.

Contrast with SQL Server, which updates in place and keeps versions in tempdb only when RCSI/SNAPSHOT is on. PostgreSQL's versions live in the table itself.`,
  pts: [r`Update = new tuple, old tuple marked dead`, r`Snapshot visibility via xmin/xmax`, r`Readers and writers do not block`, r`Cost: bloat, vacuum, index write amplification, xid wraparound`],
  ex: r`A session-tracking table updating a "last_seen" column 5,000 times a second grew from 2 GB to 40 GB of mostly dead tuples because autovacuum could not keep up; tuning per-table autovacuum and enabling HOT updates (fillfactor 80, no index on last_seen) held it at 3 GB.`,
  fu: [r`What is a HOT update?`, r`Why does a long-running transaction cause bloat everywhere?`],
  pit: [r`Saying PostgreSQL "locks rows for reading". Plain SELECT takes no row locks.`, r`Forgetting that updates write to every index unless HOT.`],
  tip: r`Contrast with SQL Server's in-place update plus tempdb version store. Interviewers for mixed .NET shops love this comparison.` },

{ id: 'q2', level: 'Basic', tags: ['vacuum'],
  q: r`What do VACUUM, VACUUM FULL, ANALYZE and autovacuum each do?`,
  a: r`- **{{VACUUM}}**: marks dead tuples' space as reusable (free space map), updates the visibility map (enables index-only scans) and freezes old tuples. Does not shrink the file (except trailing empty pages). Runs online.
- **{{VACUUM FULL}}**: rewrites the whole table into a new file, returning space to the OS. Takes an **ACCESS EXCLUSIVE** lock: no reads or writes for the duration. Almost never acceptable in production; use {{pg_repack}} instead.
- **{{ANALYZE}}**: samples rows to refresh planner statistics in {{pg_statistic}}.
- **Autovacuum**: background workers that run VACUUM and ANALYZE per table when dead tuples exceed {{autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor * reltuples}} (defaults 50 + 20%).

The 20% default is far too lazy for big tables: a 500 M-row table waits for 100 M dead rows. Tune per table:

~~~sql
ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.01,
                        autovacuum_analyze_scale_factor = 0.005,
                        autovacuum_vacuum_cost_limit = 2000);
~~~`,
  pts: [r`VACUUM reclaims for reuse, does not shrink`, r`VACUUM FULL locks the table exclusively`, r`ANALYZE refreshes statistics`, r`Tune autovacuum per hot table`],
  ex: r`Nightly batch jobs that ran {{VACUUM FULL}} took a 30-minute outage every night; replacing them with tuned autovacuum and occasional {{pg_repack}} removed the window entirely.`,
  fu: [r`How does pg_repack avoid the exclusive lock?`, r`What stops autovacuum from cleaning dead tuples?`],
  pit: [r`Disabling autovacuum because it "uses I/O".`, r`Scheduling VACUUM FULL as routine maintenance.`] },

{ id: 'q3', level: 'Basic', tags: ['indexes'],
  q: r`Which index types does PostgreSQL offer and when would you use each?`,
  a: r`| Type | Good for | Notes |
|---|---|---|
| B-tree (default) | Equality, ranges, ORDER BY, uniqueness | Covers 90% of needs |
| Hash | Equality only | WAL-logged since v10; rarely better than B-tree |
| GIN | jsonb containment, arrays, full-text ({{tsvector}}) | Inverted index; slower writes, use {{fastupdate}} |
| GiST | Geometry (PostGIS), ranges, nearest-neighbour, exclusion constraints | Lossy, balanced tree framework |
| SP-GiST | Non-balanced partitions (IP ranges, quad-trees) | Niche |
| BRIN | Huge, naturally ordered tables (time-series by insert time) | Tiny (KBs for TBs), coarse block ranges |

Plus modifiers that matter more than the type: **partial** indexes ({{WHERE status = 'PENDING'}}), **expression** indexes ({{lower(email)}}), **covering** indexes ({{INCLUDE}}, v11+), and **multicolumn** column ordering.

~~~sql
CREATE INDEX CONCURRENTLY ix_orders_pending ON orders (created_at) WHERE status = 'PENDING';
CREATE INDEX CONCURRENTLY ix_events_ts_brin ON events USING brin (occurred_at);
CREATE INDEX CONCURRENTLY ix_docs_body ON docs USING gin (body jsonb_path_ops);
~~~`,
  pts: [r`B-tree default`, r`GIN for jsonb/arrays/full-text`, r`GiST for geo, ranges, exclusion`, r`BRIN for huge append-ordered tables`, r`Partial and expression indexes`],
  ex: r`A 4 TB telemetry table's B-tree on timestamp was 180 GB; a BRIN index was 6 MB and range queries over a day were still fast because rows were inserted in time order.`,
  fu: [r`Why does BRIN degrade if rows are updated or inserted out of order?`, r`jsonb_ops vs jsonb_path_ops?`],
  pit: [r`Creating indexes without CONCURRENTLY on a live table (blocks writes).`] },

{ id: 'q4', level: 'Basic', tags: ['isolation', 'transactions'],
  q: r`Explain PostgreSQL's isolation levels and how they differ from SQL Server's.`,
  a: r`PostgreSQL accepts all four SQL levels but implements three:

| Level | Behaviour |
|---|---|
| READ UNCOMMITTED | Treated as READ COMMITTED; dirty reads never happen |
| READ COMMITTED (default) | Each **statement** sees a fresh snapshot |
| REPEATABLE READ | One snapshot for the whole **transaction** (snapshot isolation). Concurrent update of the same row raises {{40001 could not serialize access}} |
| SERIALIZABLE | **SSI**: snapshot plus predicate-lock tracking; aborts transactions whose combination would be non-serialisable (prevents write skew) |

Key differences from SQL Server: PostgreSQL's default READ COMMITTED already behaves like SQL Server's **RCSI** (non-blocking reads). PostgreSQL's SERIALIZABLE is **optimistic** (aborts with 40001) rather than lock-based (key-range locks that block), so the application **must retry**.

~~~csharp
// Npgsql: retry serialization failures
catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.SerializationFailure
                                || ex.SqlState == PostgresErrorCodes.DeadlockDetected) { /* retry whole txn */ }
~~~`,
  pts: [r`Default READ COMMITTED ~ SQL Server RCSI`, r`REPEATABLE READ = snapshot isolation`, r`SERIALIZABLE = SSI, optimistic, retry on 40001`, r`No dirty reads at any level`],
  ex: r`An on-call scheduling system allowed two doctors to both go off-call (write skew) under REPEATABLE READ; switching that transaction to SERIALIZABLE with a retry loop prevented it.`,
  fu: [r`What is write skew and why does snapshot isolation allow it?`, r`What does the retry loop need to re-execute?`],
  pit: [r`Using SERIALIZABLE without a retry policy.`, r`Retrying only the failed statement instead of the whole transaction.`] },

{ id: 'q5', level: 'Basic', tags: ['jsonb'],
  q: r`json vs jsonb: when would you store documents in PostgreSQL instead of MongoDB?`,
  a: r`{{json}} stores the original text (keeps whitespace, key order, duplicate keys) and re-parses on every access. {{jsonb}} stores a decomposed binary form: slightly slower to write, much faster to query, supports GIN indexes and operators like {{@>}} (contains), {{?}} (key exists), {{->}}, {{->>}} and SQL/JSON path. Use **jsonb** almost always.

~~~sql
CREATE TABLE payment_events (id bigserial PRIMARY KEY, payload jsonb NOT NULL);
CREATE INDEX ON payment_events USING gin (payload jsonb_path_ops);
SELECT id FROM payment_events WHERE payload @> '{"provider":"stripe","status":"failed"}';
-- generated column for a hot field, B-tree indexable and typed
ALTER TABLE payment_events ADD COLUMN provider text GENERATED ALWAYS AS (payload->>'provider') STORED;
~~~

Choose PostgreSQL jsonb over a document DB when: you also need relational joins, transactions across document and relational rows, one operational database instead of two, and the documents are side-data (metadata, provider payloads). Choose MongoDB when the document **is** the aggregate, schema varies wildly, and you need native horizontal sharding.

Caveats: updating any key rewrites the whole jsonb value (TOAST), and statistics on jsonb internals are weak, so planner estimates can be poor. Promote hot, filtered fields to real columns.`,
  pts: [r`jsonb for nearly everything`, r`GIN index with @> containment`, r`Promote hot fields to (generated) columns`, r`Whole-value rewrite on update`],
  ex: r`A payments team stored raw PSP webhook payloads as jsonb next to the normalised payment row, keeping auditability without a second datastore.`,
  fu: [r`How would you enforce a schema on jsonb?`, r`Why can large jsonb updates cause WAL spikes?`],
  pit: [r`Putting the entire domain model in one jsonb column and losing constraints.`] },

{ id: 'q6', level: 'Basic', tags: ['architecture', 'internals'],
  code: r`~~~ini
; pgbouncer.ini
[databases]
payments = host=pg-primary.internal port=5432 dbname=payments
[pgbouncer]
pool_mode = transaction
max_client_conn = 5000          ; thousands of app connections...
default_pool_size = 60          ; ...multiplexed onto ~2-4x cores of real backends
max_prepared_statements = 200   ; 1.21+: protocol-level prepared statements in transaction mode
server_reset_query =            ; not used in transaction mode
~~~
~~~csharp
// Npgsql: keep the in-process pool small when PgBouncer multiplexes
var cs = "Host=pgbouncer;Database=payments;Username=api;Maximum Pool Size=20;Timeout=5;Command Timeout=30";
~~~`,
  q: r`Describe PostgreSQL's process architecture and why connection count matters so much.`,
  a: r`PostgreSQL is **process-per-connection**: the postmaster forks a backend process for each client connection. Shared state (shared buffers, WAL buffers, lock tables) lives in shared memory. Background processes include the WAL writer, checkpointer, background writer, autovacuum launcher and workers, stats, and WAL senders for replication.

Consequences:

- Each connection costs several MB of memory plus per-backend caches; {{work_mem}} is per sort/hash node, per connection.
- Thousands of mostly idle connections hurt: snapshot computation and lock-table work scale with active backends, and context switching rises.
- Throughput usually peaks around **(2 to 4) × CPU cores** active connections.

So .NET services must pool. Npgsql pools per connection string in-process, but 40 pods × 100 pool size = 4,000 connections. Put **PgBouncer** (transaction pooling) or RDS Proxy in front and size pools deliberately.`,
  pts: [r`Process per connection`, r`Shared buffers + background workers`, r`Peak throughput at a few × cores`, r`Pool in app and with PgBouncer`],
  ex: r`An autoscaling .NET API hit {{too many clients already}} at 500 connections during a sale; PgBouncer in transaction mode multiplexed 3,000 client connections onto 80 server connections and p99 dropped.`,
  fu: [r`What breaks with PgBouncer transaction pooling?`, r`How does work_mem multiply?`],
  pit: [r`Raising max_connections to 5,000 as the fix.`] },

{ id: 'q7', level: 'Intermediate', tags: ['explain', 'performance'],
  q: r`How do you read EXPLAIN (ANALYZE, BUFFERS) output and spot the problem?`,
  a: r`~~~sql
EXPLAIN (ANALYZE, BUFFERS, SETTINGS) SELECT ... ;
~~~

Read the tree **inside out**: the most indented nodes run first. For each node compare:

- **estimated rows vs actual rows** (times {{loops}}). A 100× miss is the root of most bad plans.
- **actual time** (startup..total, per loop). Find where time jumps.
- **Buffers**: {{shared hit}} (cache) vs {{read}} (disk). High reads = I/O bound.
- **Rows Removed by Filter**: a big number means the index did not cover the predicate.
- **Sort Method: external merge Disk** or **Batches > 1** on Hash: {{work_mem}} too small, spilling.
- **Heap Fetches** on an Index Only Scan: visibility map stale, vacuum needed.

Red flags: Seq Scan on a large table with a selective filter; Nested Loop with a huge inner loop count from an underestimate; a function wrapped around an indexed column.

Note {{ANALYZE}} actually executes the statement. Wrap DML in {{BEGIN; ... ROLLBACK;}}. For production, use {{auto_explain}} with {{log_min_duration}} to capture real plans.`,
  pts: [r`Inside-out reading`, r`Estimate vs actual × loops`, r`BUFFERS hit vs read`, r`Spills and Rows Removed by Filter`, r`auto_explain in production`],
  ex: r`A report query estimated 1 row for a correlated pair of columns (country, city) but got 80,000; {{CREATE STATISTICS}} on both columns fixed the estimate and the plan switched from nested loops to a hash join, 45 s to 0.6 s.`,
  fu: [r`What are extended statistics?`, r`How do you see plans for queries with parameters (generic vs custom plans)?`],
  pit: [r`Running EXPLAIN ANALYZE on a DELETE in production without a transaction.`] },

{ id: 'q8', level: 'Intermediate', tags: ['indexes', 'performance'],
  q: r`How do you design multicolumn, partial and covering indexes for a real query?`,
  a: r`Rules for B-tree column order: **equality columns first, then range or sort columns**. Include the remaining selected columns with {{INCLUDE}} to enable an index-only scan.

~~~sql
-- Query: SELECT id, amount, created_at FROM payments
--        WHERE merchant_id = $1 AND status = 'SETTLED' AND created_at >= $2 ORDER BY created_at DESC LIMIT 50;
CREATE INDEX CONCURRENTLY ix_pay_merchant_settled
  ON payments (merchant_id, created_at DESC)
  INCLUDE (amount)
  WHERE status = 'SETTLED';
~~~

Why each part:

- {{merchant_id}} equality first narrows the range; {{created_at DESC}} matches the ORDER BY so no sort and {{LIMIT}} stops early.
- The **partial** {{WHERE}} keeps the index small when SETTLED is a stable subset, and the query must include the same predicate for the planner to use it.
- {{INCLUDE (amount)}} makes it covering; index-only scans also need a fresh visibility map (vacuum).

Each index costs write amplification and blocks HOT updates on indexed columns. Check {{pg_stat_user_indexes.idx_scan}} for unused indexes.`,
  pts: [r`Equality first, then range/sort`, r`Partial index must match query predicate`, r`INCLUDE for index-only scans`, r`Visibility map needed for index-only`],
  ex: r`A merchant dashboard went from 1.2 s (bitmap heap scan + sort) to 4 ms with this pattern.`,
  fu: [r`Why might the planner ignore your partial index with a parameterised status?`],
  pit: [r`Putting the range column first.`, r`Parameterising the value used in the partial predicate.`] },

{ id: 'q9', level: 'Intermediate', tags: ['locking'],
  q: r`Explain row-level locks, SELECT FOR UPDATE variants and SKIP LOCKED queues.`,
  a: r`Row locks are stored in the tuple header (not a lock table), so there is no lock escalation in PostgreSQL. Modes, strongest first: {{FOR UPDATE}}, {{FOR NO KEY UPDATE}} (what a normal UPDATE takes), {{FOR SHARE}}, {{FOR KEY SHARE}} (what a foreign-key check takes). Using {{FOR NO KEY UPDATE}} when you will not change the key reduces conflicts with FK checks.

{{SKIP LOCKED}} makes a reliable work queue:

~~~sql
WITH next AS (
  SELECT id FROM outbox
  WHERE processed_at IS NULL
  ORDER BY id
  LIMIT 100
  FOR UPDATE SKIP LOCKED)
UPDATE outbox o SET locked_by = $1, locked_at = now()
FROM next WHERE o.id = next.id
RETURNING o.*;
~~~

Multiple workers grab disjoint batches without blocking. {{NOWAIT}} errors immediately instead of waiting.

Table-level locks matter too: DDL takes {{ACCESS EXCLUSIVE}}, which queues behind running queries and **blocks everything behind it**. Always set {{lock_timeout}} for migrations.`,
  pts: [r`Row locks in tuple header, no escalation`, r`FOR NO KEY UPDATE vs FOR UPDATE`, r`SKIP LOCKED for queues`, r`DDL lock queueing; set lock_timeout`],
  ex: r`An outbox relay with 8 workers using SKIP LOCKED processed 12,000 messages a second from a PostgreSQL table without a broker for the relay itself.`,
  fu: [r`Why does a waiting ALTER TABLE block new SELECTs?`, r`How do you avoid starving old rows with SKIP LOCKED?`],
  pit: [r`Running ALTER TABLE without lock_timeout during traffic.`] },

{ id: 'q10', level: 'Intermediate', tags: ['wal', 'durability'],
  code: r`~~~sql
-- Per-transaction durability: fast for telemetry, strict for money
BEGIN;
SET LOCAL synchronous_commit = off;
INSERT INTO click_events (user_id, url, at) VALUES ($1, $2, now());
COMMIT;

-- Checkpoint health
SELECT checkpoints_timed, checkpoints_req, buffers_checkpoint, buffers_backend FROM pg_stat_bgwriter;  -- pg_stat_checkpointer in v17
ALTER SYSTEM SET max_wal_size = '16GB';
ALTER SYSTEM SET checkpoint_timeout = '15min';
SELECT pg_reload_conf();
~~~`,
  q: r`What is the WAL, and what do checkpoints, full-page writes and synchronous_commit do?`,
  a: r`The **Write-Ahead Log** records every change before the data pages are modified on disk. Commit returns once the WAL record is flushed, so the WAL is the durability and replication mechanism.

- **Checkpoint**: flushes all dirty pages so recovery can start from that point. Controlled by {{checkpoint_timeout}} and {{max_wal_size}}; spread by {{checkpoint_completion_target}} (0.9). Too-frequent checkpoints cause I/O spikes and more full-page writes.
- **Full-page writes**: the first modification of a page after a checkpoint writes the whole 8 KB page into WAL, guarding against torn pages. This is why WAL volume spikes after each checkpoint.
- **{{synchronous_commit}}**: {{on}} (wait for local flush), {{off}} (return before flush; a crash can lose the last ~600 ms of commits but never corrupts), {{remote_write}}/{{remote_apply}} (wait for sync standbys).

{{synchronous_commit = off}} can be set **per transaction**, a precise tool: off for click-tracking inserts, on for payments.`,
  pts: [r`WAL flushed before commit`, r`Checkpoints bound recovery time`, r`Full-page writes after checkpoint`, r`synchronous_commit per transaction`],
  ex: r`Raising max_wal_size from 1 GB to 16 GB on a write-heavy ledger cut checkpoints from every 40 s to every 10 min and reduced WAL volume by 35% (fewer full-page images).`,
  fu: [r`What does a "checkpoints are occurring too frequently" log warning mean?`],
  pit: [r`Setting fsync = off in production (risks corruption, unlike synchronous_commit = off).`] },

{ id: 'q11', level: 'Intermediate', tags: ['replication'],
  code: r`~~~sql
-- Logical replication for a cross-version upgrade (source v13 -> target v16)
-- on source
CREATE PUBLICATION app_pub FOR ALL TABLES;
-- on target (schema created first with pg_dump --schema-only)
CREATE SUBSCRIPTION app_sub CONNECTION 'host=old-pg dbname=app user=repl' PUBLICATION app_pub;
-- monitor on source
SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM pg_replication_slots;
-- physical: lag per standby
SELECT application_name, state, sync_state, replay_lag FROM pg_stat_replication;
~~~`,
  q: r`Compare streaming (physical) replication and logical replication.`,
  a: r`| | Physical streaming | Logical |
|---|---|---|
| What is shipped | WAL bytes (block changes) | Row changes decoded from WAL |
| Granularity | Whole cluster | Per table (publication/subscription) |
| Versions | Same major version | Cross-version (zero-downtime upgrades) |
| Replica writable | No (hot standby, read-only) | Yes |
| DDL / sequences | Replicated | Not replicated (DDL manual; sequences from v16-ish tooling, verify your version) |
| Use | HA, read replicas, DR | Upgrades, partial replication, CDC (Debezium) |

Synchronous physical replication ({{synchronous_standby_names = 'ANY 1 (s1, s2)'}}) gives zero data loss on failover at the cost of commit latency to the nearest standby.

Logical replication requires replica identity (a primary key) for UPDATE/DELETE, and **replication slots** retain WAL until the consumer confirms, so a dead subscriber can fill the primary's disk.`,
  pts: [r`Physical = cluster-wide, read-only, same version`, r`Logical = per table, cross-version, CDC`, r`Sync standby for RPO 0`, r`Slots retain WAL`],
  ex: r`A team upgraded PostgreSQL 12 to 16 with logical replication: subscriber caught up, a 30-second cutover flipped writes, and the old cluster stayed as rollback.`,
  fu: [r`How do you monitor slot lag?`, r`What does hot_standby_feedback trade off?`],
  pit: [r`Leaving an abandoned replication slot that fills the disk.`] },

{ id: 'q12', level: 'Intermediate', tags: ['partitioning'],
  q: r`When and how do you use declarative partitioning?`,
  a: r`PostgreSQL supports **range**, **list** and **hash** partitioning. Partition when it gives you something concrete:

- **Retention**: {{DROP}}/{{DETACH PARTITION CONCURRENTLY}} a month instead of a massive DELETE (no bloat, no WAL storm).
- **Partition pruning**: queries filtering on the key only touch relevant partitions.
- **Maintenance**: vacuum and reindex smaller units.

~~~sql
CREATE TABLE ledger_entries (
  id bigint GENERATED ALWAYS AS IDENTITY,
  account_id bigint NOT NULL,
  posted_at timestamptz NOT NULL,
  amount numeric(19,4) NOT NULL,
  PRIMARY KEY (id, posted_at)
) PARTITION BY RANGE (posted_at);
CREATE TABLE ledger_entries_2026_10 PARTITION OF ledger_entries
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
~~~

Constraints: primary and unique keys **must include the partition key**; queries that do not filter on the key scan every partition; thousands of partitions slow planning. Automate creation with {{pg_partman}}.

Partitioning is not sharding: everything still lives on one server.`,
  pts: [r`Range/list/hash`, r`Retention by dropping partitions`, r`Pruning needs the key in WHERE`, r`Unique keys must include partition key`],
  ex: r`Deleting 90-day-old audit rows took 6 hours and bloated the table; monthly partitions turned retention into a sub-second DETACH and DROP.`,
  fu: [r`How do you enforce global uniqueness across partitions?`],
  pit: [r`Partitioning a 10 GB table "for performance" with no retention or pruning benefit.`] },

{ id: 'q13', level: 'Intermediate', tags: ['dotnet', 'npgsql'],
  q: r`What should a .NET team know about Npgsql and EF Core with PostgreSQL?`,
  a: r`- Use **{{NpgsqlDataSource}}** (v7+) as the singleton entry point; it owns the pool and type mapping.
- Map {{DateTime}} carefully: since Npgsql 6, {{timestamptz}} maps to UTC {{DateTime}} (Kind=Utc) and writing a Local/Unspecified kind to timestamptz throws. Prefer {{timestamptz}} and {{DateTimeOffset}} or UTC everywhere.
- Identifiers are folded to lower case unless quoted: EF Core quotes everything, so use {{UseSnakeCaseNamingConvention()}} (EFCore.NamingConventions) to avoid {{"OrderItems"}} requiring quotes in hand-written SQL.
- Use **binary COPY** for bulk loads ({{BeginBinaryImport}}), 10 to 50× faster than row inserts.
- Enable **multiplexing** or **prepared statements** ({{Max Auto Prepare}}) for hot paths; with PgBouncer transaction pooling use v1.21+ prepared-statement support or disable auto-prepare.
- Retry: {{EnableRetryOnFailure()}} handles transient errors; serialisation failures need your own whole-transaction retry.

~~~csharp
var dsb = new NpgsqlDataSourceBuilder(cs);
dsb.EnableDynamicJson();
await using var ds = dsb.Build();
services.AddDbContextPool<AppDb>(o => o.UseNpgsql(ds).UseSnakeCaseNamingConvention());
~~~`,
  pts: [r`NpgsqlDataSource singleton`, r`timestamptz = UTC DateTime`, r`Snake case naming`, r`Binary COPY for bulk`, r`Prepared statements vs PgBouncer`],
  ex: r`An import job inserting 5 M rows with EF Core SaveChanges took 40 minutes; binary COPY took 50 seconds.`,
  fu: [r`How does Npgsql map arrays and enums?`],
  pit: [r`Mixing DateTime kinds and getting runtime exceptions after upgrading Npgsql.`] },

{ id: 'q14', level: 'Intermediate', tags: ['ctes', 'sql'],
  q: r`How do CTEs behave in PostgreSQL, and when are they optimisation fences?`,
  a: r`Before v12, every CTE was **materialised**: computed once, results stored, and no predicates pushed in, an optimisation fence. Since v12, a non-recursive, side-effect-free CTE referenced **once** is inlined like a subquery. You control it explicitly:

~~~sql
WITH recent AS MATERIALIZED (SELECT * FROM orders WHERE created_at > now() - interval '1 day')
SELECT ...;   -- force compute-once
WITH x AS NOT MATERIALIZED (...) SELECT ...;   -- force inline
~~~

Data-modifying CTEs are powerful for atomic multi-step operations in one statement:

~~~sql
WITH moved AS (
  DELETE FROM outbox WHERE id = ANY($1) RETURNING *)
INSERT INTO outbox_archive SELECT * FROM moved;
~~~

Recursive CTEs handle hierarchies (org charts, bill of materials); add a depth limit or cycle detection ({{CYCLE}} clause, v14+).`,
  pts: [r`v12+ inlines single-use CTEs`, r`MATERIALIZED / NOT MATERIALIZED hints`, r`Writable CTEs for atomic moves`, r`Recursive with cycle protection`],
  ex: r`An upgrade from 11 to 13 made a report 20× faster with no code change because its CTE became inlinable and the date filter pushed down into an index scan.`,
  fu: [r`When would you deliberately materialise?`],
  pit: [r`Assuming CTEs are always fences (or never are) without knowing the version.`] },

{ id: 'q15', level: 'Intermediate', tags: ['data-types'],
  code: r`~~~sql
CREATE TABLE payments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id   uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,   -- or app-generated UUIDv7
  amount      numeric(19,4) NOT NULL CHECK (amount > 0),
  currency    char(3) NOT NULL,
  status      text NOT NULL CHECK (status IN ('CREATED','AUTHORIZED','CAPTURED','FAILED')),
  reference   text CHECK (length(reference) <= 140),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_hours (store_id int, opens_at time, closes_at time);  -- wall-clock values: no time zone
~~~
~~~csharp
var id = Guid.CreateVersion7();   // .NET 9: time-ordered UUIDv7 for distributed inserts
~~~`,
  q: r`Which PostgreSQL data types do senior engineers choose deliberately?`,
  a: r`- **Money**: {{numeric(19,4)}} (exact). Never {{float}}; avoid the {{money}} type (locale-dependent).
- **Time**: {{timestamptz}} always for instants (stored as UTC, displayed in session time zone). {{timestamp}} without zone only for "wall clock" values like a store's opening time.
- **Identifiers**: {{bigint GENERATED ALWAYS AS IDENTITY}} (SQL standard, preferred over {{serial}}). For distributed ids, {{uuid}}; time-ordered UUIDv7 keeps B-tree inserts mostly sequential in PostgreSQL ({{uuidv7()}} is built in from v18; earlier versions generate it in the app).
- **Text**: {{text}} with a {{CHECK (length(x) <= n)}} if you need a limit; {{varchar(n)}} has no performance advantage.
- **Enumerations**: a lookup table or {{text}} + CHECK is easier to evolve than {{CREATE TYPE ... AS ENUM}} (adding is fine, removing values is not).
- **Ranges**: {{tstzrange}} with exclusion constraints for bookings.
- **Arrays** and **jsonb** for side data, not core relations.`,
  pts: [r`numeric for money`, r`timestamptz for instants`, r`IDENTITY over serial`, r`UUIDv7 for distributed ids`, r`text + CHECK`],
  ex: r`A FX service using double precision drifted by cents on reconciliation; switching to numeric removed every break.`,
  fu: [r`Why does a random UUIDv4 primary key hurt write performance?`],
  pit: [r`Using timestamp without time zone for event times across regions.`] },

{ id: 'q16', level: 'Intermediate', tags: ['constraints'],
  q: r`How do exclusion constraints and deferrable constraints solve real problems?`,
  a: r`**Exclusion constraints** generalise UNIQUE: no two rows may satisfy an operator together. Classic use: no overlapping bookings.

~~~sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE room_bookings (
  room_id int NOT NULL,
  during tstzrange NOT NULL,
  EXCLUDE USING gist (room_id WITH =, during WITH &&)
);
~~~

Without it you need SERIALIZABLE or explicit locking, and application-level checks race.

**Deferrable constraints** are checked at commit instead of per statement:

~~~sql
ALTER TABLE ledger_lines ADD CONSTRAINT fk_txn FOREIGN KEY (txn_id) REFERENCES txns(id) DEFERRABLE INITIALLY DEFERRED;
~~~

Useful for circular references, swapping unique positions ({{UPDATE ... SET position = position + 1}}), and bulk loads in arbitrary order.

General principle: push invariants into the database where they cannot be bypassed by a second service, a script or a race.`,
  pts: [r`EXCLUDE for no-overlap invariants`, r`btree_gist for mixing = and &&`, r`DEFERRABLE checks at commit`, r`DB constraints beat app checks under concurrency`],
  ex: r`A rota system double-booked engineers twice a month due to a check-then-insert race; an exclusion constraint made it impossible.`,
  fu: [r`What error does the app see and how should it handle it?`],
  pit: [r`Relying on a SELECT-before-INSERT check for uniqueness.`] },

{ id: 'q17', level: 'Intermediate', tags: ['full-text-search'],
  q: r`How good is PostgreSQL full-text search and when do you need Elasticsearch/OpenSearch?`,
  a: r`Built-in FTS: {{tsvector}} (normalised lexemes), {{tsquery}}, ranking ({{ts_rank}}), language dictionaries, GIN indexes. {{pg_trgm}} adds fuzzy matching and fast {{ILIKE '%x%'}} via trigram GIN indexes.

~~~sql
ALTER TABLE products ADD COLUMN search tsvector
  GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(name,'')), 'A') ||
                       setweight(to_tsvector('english', coalesce(description,'')), 'B')) STORED;
CREATE INDEX ON products USING gin (search);
SELECT id, name FROM products WHERE search @@ websearch_to_tsquery('english', $1)
ORDER BY ts_rank(search, websearch_to_tsquery('english', $1)) DESC LIMIT 20;
~~~

It is good enough for in-app search over millions of rows with transactional freshness. Move to OpenSearch when you need: BM25-quality relevance tuning, facets/aggregations at scale, typo tolerance across languages, synonyms management, search analytics, or to offload search load from the primary. That adds a CDC pipeline and eventual consistency.`,
  pts: [r`tsvector + GIN`, r`pg_trgm for fuzzy and ILIKE`, r`Transactional freshness`, r`OpenSearch for relevance, facets, scale`],
  ex: r`An internal case-management tool kept search in PostgreSQL and avoided running a search cluster for 50 users.`,
  fu: [r`How would you keep OpenSearch in sync?`],
  pit: [r`Using LIKE '%term%' on a big table without a trigram index.`] },

{ id: 'q18', level: 'Intermediate', tags: ['upsert', 'concurrency'],
  q: r`How do INSERT ... ON CONFLICT and MERGE handle concurrency?`,
  a: r`{{INSERT ... ON CONFLICT}} is an atomic upsert keyed on a unique index or constraint; concurrent inserts of the same key cannot both succeed.

~~~sql
INSERT INTO idempotency_keys (key, request_hash, response, created_at)
VALUES ($1, $2, NULL, now())
ON CONFLICT (key) DO NOTHING
RETURNING key;   -- no row returned => duplicate request
~~~

{{DO UPDATE SET ... = EXCLUDED.col}} merges; a {{WHERE}} on the update makes it conditional (e.g. only apply newer versions).

{{MERGE}} (v15+) is the SQL-standard multi-branch statement. It is **not** concurrency-safe the way ON CONFLICT is: two sessions can both take the NOT MATCHED branch and one fails with a unique violation. Use ON CONFLICT for upserts under concurrency; use MERGE for batch synchronisation.

Note: ON CONFLICT DO NOTHING still burns a sequence value, and an upsert that conflicts takes a row lock.`,
  pts: [r`ON CONFLICT is atomic`, r`EXCLUDED pseudo-table`, r`Conditional DO UPDATE`, r`MERGE not race-safe for upsert`],
  ex: r`A webhook receiver used ON CONFLICT DO NOTHING on the provider event id to de-duplicate Stripe retries with no extra locking.`,
  fu: [r`How do you return the existing row when DO NOTHING skips?`],
  pit: [r`Assuming MERGE replaces ON CONFLICT safely.`] },

{ id: 'q19', level: 'Senior', tags: ['vacuum', 'bloat', 'incident'],
  q: r`Autovacuum cannot keep up and tables are bloating. Walk through diagnosis and fix.`,
  a: r`### 1. Confirm
~~~sql
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum, autovacuum_count
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 20;
~~~
Use {{pgstattuple}} for exact bloat on suspects.

### 2. Find what blocks cleanup
Vacuum can only remove tuples older than the **oldest snapshot** still needed (the xmin horizon). Common blockers:

- Long-running or **idle in transaction** sessions ({{pg_stat_activity}}).
- Abandoned **replication slots** ({{pg_replication_slots}} with old {{xmin}}/{{catalog_xmin}}).
- Standbys with {{hot_standby_feedback = on}} running long queries.
- Orphaned prepared transactions ({{pg_prepared_xacts}}).

### 3. Fix throughput
Per-table scale factors, more {{autovacuum_max_workers}}, higher {{autovacuum_vacuum_cost_limit}} (the global cost limit is shared across workers), faster storage.

### 4. Reclaim
Existing bloat needs {{pg_repack}} (online) since VACUUM will not shrink the file.

### 5. Prevent
{{idle_in_transaction_session_timeout}}, {{statement_timeout}}, alerts on xmin age and slot lag.`,
  pts: [r`Dead tuples per table`, r`xmin horizon blockers: long txns, slots, feedback, prepared xacts`, r`Tune cost limit and scale factors`, r`pg_repack to reclaim`, r`Timeouts and alerts prevent recurrence`],
  ex: r`A BI tool left a session idle in transaction for three days; every table bloated and query latency doubled. Killing it plus a 5-minute idle_in_transaction_session_timeout ended the pattern.`,
  fu: [r`Why does a replica's long query bloat the primary?`],
  pit: [r`Adding more autovacuum workers while a 3-day-old transaction pins the horizon.`],
  tip: r`Say "xmin horizon" early. It shows you know why vacuum fails, not just that it does.` },

{ id: 'q20', level: 'Senior', tags: ['wraparound', 'incident'],
  q: r`What is transaction ID wraparound and how do you prevent an outage from it?`,
  a: r`Transaction ids are 32-bit (~4 billion), compared modulo 2^32, so only ~2 billion are "in the past". If an old unfrozen tuple's xid falls more than ~2 billion behind, it would appear to be in the future and vanish. To prevent that, VACUUM **freezes** old tuples (marks them visible to all).

If freezing falls behind, PostgreSQL first warns, then forces **anti-wraparound autovacuums** (which cannot be cancelled by lock conflicts), and finally, ~3 million xids before the limit, **stops accepting writes** until a manual vacuum runs. That is a full outage on a busy OLTP database and can take hours on large tables.

Monitor:

~~~sql
SELECT datname, age(datfrozenxid) FROM pg_database ORDER BY 2 DESC;
SELECT relname, age(relfrozenxid) FROM pg_class WHERE relkind = 'r' ORDER BY 2 DESC LIMIT 10;
~~~

Alert when age exceeds ~1 billion (well before {{autovacuum_freeze_max_age}} pressure becomes critical). The same horizon blockers as bloat (long transactions, stale slots) also block freezing. High-xid-burn workloads (many tiny transactions) should batch writes.`,
  pts: [r`32-bit xids, freeze old tuples`, r`Forced anti-wraparound vacuum`, r`Write shutdown near the limit`, r`Monitor age(datfrozenxid)`, r`Same blockers as bloat`],
  ex: r`A well-known incident pattern: a high-write service with a stale replication slot ran out of xids and stopped accepting writes; a single-table freeze took most of a day.`,
  fu: [r`How do multixact ids also wrap around?`],
  pit: [r`Cancelling the anti-wraparound vacuum because it "slows things down".`] },

{ id: 'q21', level: 'Senior', tags: ['ha', 'failover'],
  code: r`~~~csharp
// Npgsql multi-host: always connect to the current primary for writes
var write = "Host=pg-a,pg-b,pg-c;Database=payments;Target Session Attributes=read-write;Timeout=5";
var read  = "Host=pg-a,pg-b,pg-c;Database=payments;Target Session Attributes=prefer-standby;Load Balance Hosts=true";
builder.Services.AddNpgsqlDataSource(write, serviceKey: "write");
builder.Services.AddNpgsqlDataSource(read, serviceKey: "read");
// After a failover, clear pools so stale connections to the old primary are dropped
catch (NpgsqlException ex) when (ex.IsTransient) { NpgsqlConnection.ClearAllPools(); throw; }
~~~`,
  q: r`Design high availability for PostgreSQL self-managed vs on RDS/Aurora.`,
  a: r`**Self-managed (Kubernetes or VMs):** primary plus 2 streaming standbys across zones, orchestrated by **Patroni** (leader election via etcd/Consul) or **CloudNativePG** on Kubernetes. Clients reach the leader via a service/VIP or HAProxy that health-checks Patroni's REST endpoint. Fencing prevents split brain.

**Amazon RDS Multi-AZ:** synchronous block-level standby, failover 60 to 120 s via DNS flip. Multi-AZ **DB cluster** (two readable standbys) fails over in ~35 s.

**Aurora PostgreSQL:** storage replicated 6 ways across 3 AZs, quorum writes, replicas share storage (low lag), failover typically under 30 s; Global Database for cross-region DR (RPO ~1 s).

~~~mermaid
flowchart LR
  App[.NET services] --> PB[PgBouncer / RDS Proxy]
  PB --> P[(Primary AZ-a)]
  P -- sync WAL --> S1[(Standby AZ-b)]
  P -- async WAL --> S2[(Standby AZ-c)]
  P -.async.-> DR[(DR region replica)]
  Patroni[Patroni + etcd] -. leader lock .- P
~~~

Application side: short DNS TTL / proxy that pins to new primary, connection retries with jitter, idempotent writes so retried commits do not double-apply, and {{Target Session Attributes=read-write}} in Npgsql multi-host strings.`,
  pts: [r`Patroni / CloudNativePG self-managed`, r`RDS Multi-AZ, Aurora shared storage`, r`Sync standby for RPO 0`, r`Proxy + retries + idempotency on the app side`],
  ex: r`A payments platform on Aurora saw 20-second failovers but 3 minutes of errors because .NET pools held stale connections; RDS Proxy plus pool clearing on failover reduced visible impact to seconds.`,
  fu: [r`What is the commit-was-ambiguous problem during failover?`],
  pit: [r`Ignoring client behaviour; DB failover time is not user-visible recovery time.`],
  trade: r`Self-managed gives control, extensions and cost savings at scale; managed services remove patching, backups and failover engineering. For most product teams, managed wins unless an extension or version is blocking.` },

{ id: 'q22', level: 'Senior', tags: ['backup', 'pitr'],
  code: r`~~~bash
# pgBackRest: full + incremental backups to S3, continuous WAL archiving
pgbackrest --stanza=payments --type=full backup
pgbackrest --stanza=payments --type=incr backup
# PITR into a side cluster, one second before the bad DELETE
pgbackrest --stanza=payments --delta --type=time "--target=2026-10-10 14:01:59+00" \
  --target-action=promote --pg1-path=/var/lib/postgresql/restore restore
# then copy the rows back:
psql -h restore-host -c "\copy (SELECT * FROM orders WHERE created_at < '2026-10-10 14:02') TO 'orders.csv' CSV"
~~~`,
  q: r`How do backups and point-in-time recovery work, and how do you prove they work?`,
  a: r`PITR = a **base backup** (physical copy taken with {{pg_basebackup}} or a tool) plus **continuous WAL archiving**. Restore the base backup, then replay WAL up to {{recovery_target_time}} (or an xid / LSN / named restore point).

Tools: **pgBackRest** or **WAL-G** (parallel, incremental, compressed, encrypted, to S3/Azure Blob). Managed: RDS automated backups (PITR up to 35 days), snapshots for longer retention.

Logical dumps ({{pg_dump}}) are for migrations and selective restores, not DR: slow for big databases and no PITR.

Proof:

- Automated **restore tests** (weekly) into an isolated environment, run integrity checks and row-count reconciliation, record time-to-restore.
- Track **RPO** (WAL archive lag) and **RTO** (measured restore duration) as SLOs.
- Copy backups to a separate account/region with object lock (ransomware).`,
  pts: [r`Base backup + WAL archive`, r`pgBackRest / WAL-G`, r`pg_dump is not DR`, r`Scheduled restore tests measure RTO`, r`Immutable cross-account copies`],
  ex: r`An accidental {{DELETE}} without WHERE at 14:02 was recovered by PITR to 14:01:59 into a side cluster, then the deleted rows were copied back, avoiding a full rollback of later legitimate writes.`,
  fu: [r`How do you recover one table without rolling back the whole database?`],
  pit: [r`Never testing a restore until the real incident.`] },

{ id: 'q23', level: 'Senior', tags: ['migrations', 'zero-downtime'],
  q: r`How do you run schema migrations on a busy PostgreSQL table without downtime?`,
  a: r`Know which DDL rewrites the table or takes long ACCESS EXCLUSIVE locks:

| Operation | Safe? |
|---|---|
| ADD COLUMN nullable / with constant default (v11+) | Instant |
| ADD COLUMN with volatile default ({{now()}}, {{gen_random_uuid()}}) | Rewrites table |
| ALTER COLUMN TYPE (most) | Rewrites table |
| SET NOT NULL | Full scan under lock, unless a validated CHECK (col IS NOT NULL) exists (v12+) |
| ADD FOREIGN KEY / CHECK | Use {{NOT VALID}} then {{VALIDATE CONSTRAINT}} (weaker lock) |
| CREATE INDEX | Use {{CONCURRENTLY}} (outside a transaction) |

Always:

~~~sql
SET lock_timeout = '3s';       -- fail fast instead of queueing everyone behind you
SET statement_timeout = '15min';
ALTER TABLE payments ADD CONSTRAINT fk_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) NOT VALID;
ALTER TABLE payments VALIDATE CONSTRAINT fk_merchant;
~~~

Use **expand/contract**: add new column, dual-write, backfill in batches, switch reads, drop old later. EF Core migrations need review: generated SQL may not use CONCURRENTLY (use {{migrationBuilder.Sql}} with suppressed transaction).`,
  pts: [r`Know rewrite vs metadata-only DDL`, r`lock_timeout always`, r`NOT VALID then VALIDATE`, r`CREATE INDEX CONCURRENTLY`, r`Expand/contract with batched backfill`],
  ex: r`An ALTER TABLE waiting behind a 10-minute report blocked every checkout query for 10 minutes; lock_timeout with retries turned the next attempt into a harmless failed migration.`,
  fu: [r`How do you change a column type from int to bigint on a 2 B-row table?`],
  pit: [r`Letting EF Core run DDL with default timeouts at startup in every pod.`] },

{ id: 'q24', level: 'Senior', tags: ['pgbouncer', 'pooling'],
  code: r`~~~sql
-- Transaction pooling safe: tenant context scoped to the transaction
BEGIN;
SELECT set_config('app.tenant_id', $1, true);        -- true = local to this transaction
SELECT pg_advisory_xact_lock(hashtext('settlement:' || $2));   -- xact-scoped advisory lock
-- ... work ...
COMMIT;
-- Unsafe behind PgBouncer transaction mode:
-- SET app.tenant_id = '...';  SELECT pg_advisory_lock(...);  LISTEN channel;  CREATE TEMP TABLE ...
~~~`,
  q: r`Explain PgBouncer pooling modes and the features they break.`,
  a: r`| Mode | Server connection held for | Breaks |
|---|---|---|
| Session | Whole client session | Nothing, but little multiplexing |
| Transaction | One transaction | Session state: {{SET}} (use {{SET LOCAL}}), advisory session locks, {{LISTEN}}, temp tables across txns, WITH HOLD cursors; prepared statements before 1.21 |
| Statement | One statement | Multi-statement transactions; rarely used |

Transaction mode is the standard for OLTP. Sizing: server pool ≈ what the database can actively run (a few × cores), client side can be thousands.

Checklist for .NET behind transaction pooling: no session-level {{SET}}; use {{SET LOCAL}} inside the transaction (e.g. for row-level-security tenant id); advisory locks only {{pg_advisory_xact_lock}}; enable PgBouncer {{max_prepared_statements}} (1.21+) or set Npgsql {{Max Auto Prepare=0}}; keep Npgsql's own pool small since PgBouncer multiplexes.

Alternatives: RDS Proxy (managed, pinning on session state), PgCat / Supavisor.`,
  pts: [r`Transaction mode for OLTP`, r`Session state breaks`, r`SET LOCAL and xact advisory locks`, r`Prepared statements need 1.21+`],
  ex: r`A multi-tenant app set {{app.tenant_id}} with session SET; behind transaction pooling, another tenant's request reused the connection and saw the wrong tenant's rows via RLS. {{SET LOCAL}} fixed a data leak.`,
  fu: [r`What is connection pinning in RDS Proxy?`],
  pit: [r`Session-level SET for tenant context behind transaction pooling.`],
  tip: r`The tenant-leak story is memorable and shows security awareness in a pooling question.` },

{ id: 'q25', level: 'Senior', tags: ['multi-tenancy', 'rls'],
  q: r`How do you implement multi-tenancy in PostgreSQL, including row-level security?`,
  a: r`Three models:

| Model | Isolation | Ops cost | Fits |
|---|---|---|---|
| Database per tenant | Strongest | High (thousands of DBs, migrations) | Few large, regulated tenants |
| Schema per tenant | Medium | Catalog bloat beyond ~thousands | Hundreds of tenants |
| Shared tables + {{tenant_id}} | Logical | Lowest | Many small tenants |

For shared tables, enforce isolation with **Row-Level Security** rather than trusting every query to add a WHERE:

~~~sql
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
-- per request, inside the transaction:
SELECT set_config('app.tenant_id', $1, true);   -- true = local to txn
~~~

The app role must not be table owner or have {{BYPASSRLS}}. Put {{tenant_id}} first in composite indexes. Plan a path for a big tenant to move to its own database (hybrid model), and test isolation with automated cross-tenant tests.`,
  pts: [r`DB / schema / shared-table trade-offs`, r`RLS as defence in depth`, r`set_config local to transaction`, r`tenant_id leading index column`, r`Hybrid: graduate big tenants`],
  ex: r`A SaaS invoicing product used shared tables + RLS; an ORM query missing the tenant filter in a new endpoint returned zero foreign rows instead of leaking them.`,
  fu: [r`What is the RLS performance cost and how do you avoid it?`],
  pit: [r`Connecting as the table owner, which silently bypasses RLS unless FORCE is set.`] },

{ id: 'q26', level: 'Senior', tags: ['performance', 'planner'],
  code: r`~~~sql
SELECT queryid, calls, round(mean_exec_time::numeric, 1) AS mean_ms, rows / calls AS rows_per_call, left(query, 80)
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
SELECT relname, last_autoanalyze, n_mod_since_analyze FROM pg_stat_user_tables ORDER BY n_mod_since_analyze DESC LIMIT 10;
ALTER TABLE orders ALTER COLUMN tenant_id SET STATISTICS 1000; ANALYZE orders;
-- Reproduce a generic-plan regression for a prepared statement
SET plan_cache_mode = force_custom_plan;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE get_orders('big-tenant');
~~~`,
  q: r`A query was fast yesterday and slow today with no deploy. What happened and how do you fix it?`,
  a: r`Common causes, in order of likelihood:

1. **Stale or misleading statistics** after a big load or delete: run {{ANALYZE}}, check {{last_autoanalyze}}. Raise {{default_statistics_target}} or per-column {{SET STATISTICS 1000}} for skewed columns.
2. **Generic plan switch**: prepared statements (Npgsql auto-prepare) switch to a generic plan after 5 executions if it looks no worse on average. A skewed parameter value then gets a bad plan. Test with {{plan_cache_mode = force_custom_plan}}.
3. **Data distribution crossed a threshold**: index scan to seq scan flip.
4. **Bloat** or a stale visibility map (index-only scans doing heap fetches).
5. **Lock waits** that look like slowness: check {{pg_stat_activity.wait_event}}.
6. Cache eviction or noisy neighbour I/O.

Tools: {{pg_stat_statements}} (compare mean_exec_time and rows over time), {{auto_explain}}, {{pg_stat_activity}} wait events. PostgreSQL has no built-in plan forcing like SQL Server's Query Store; options are fixing stats, rewriting, indexes, per-query settings ({{SET LOCAL}}), or the {{pg_hint_plan}} extension as a last resort.`,
  pts: [r`Statistics first`, r`Generic vs custom plans`, r`Bloat and visibility map`, r`Wait events vs CPU`, r`No native plan forcing`],
  ex: r`A tenant-scoped query went from 5 ms to 4 s when Npgsql's prepared statement went generic; one tenant had 60% of rows. force_custom_plan for that query fixed it.`,
  fu: [r`How do you compare with SQL Server parameter sniffing?`],
  pit: [r`Restarting the database "to clear caches" and losing evidence.`] },

{ id: 'q27', level: 'Senior', tags: ['sharding', 'scale'],
  code: r`~~~sql
-- Citus: distribute by tenant, co-locate related tables, replicate small reference tables
SELECT create_distributed_table('orders', 'tenant_id');
SELECT create_distributed_table('order_lines', 'tenant_id', colocate_with => 'orders');
SELECT create_reference_table('currencies');
-- tenant-scoped query routes to one worker
SELECT sum(total) FROM orders WHERE tenant_id = 'acme' AND created_at > now() - interval '30 days';
-- move a hot tenant to its own shard
SELECT isolate_tenant_to_new_shard('orders', 'acme', cascade_option => 'CASCADE');
~~~`,
  q: r`When a single PostgreSQL primary is not enough, what are the options?`,
  a: r`Climb the ladder in order, because each step adds operational cost:

1. **Fix the workload**: indexes, query rewrites, N+1s, connection pooling, caching hot reads (Redis).
2. **Vertical scale**: modern instances (100+ vCPU, TBs of RAM) handle a lot.
3. **Read replicas** for read-heavy traffic, accepting replication lag (read-your-writes needs routing to primary).
4. **Partitioning** for maintenance and retention.
5. **Functional split**: move a bounded context to its own database.
6. **Sharding**: **Citus** (distributed tables by a distribution column, co-located joins, reference tables), or application-level sharding by tenant/account with a routing directory.
7. Distributed SQL (CockroachDB, YugabyteDB, Aurora Limitless) when you need global writes and can accept latency and compatibility differences.

Shard key choice dominates: it must appear in nearly all queries, spread load evenly, and keep transactions single-shard. Cross-shard transactions and re-sharding are the pain points.`,
  pts: [r`Optimise and scale up first`, r`Replicas for reads with lag caveats`, r`Functional split before sharding`, r`Citus or app-level sharding`, r`Shard key in every query`],
  ex: r`A B2B platform sharded by tenant using Citus; 99% of queries were tenant-scoped, so each ran on one worker and large tenants were isolated to dedicated nodes.`,
  fu: [r`How do you rebalance a hot shard?`],
  pit: [r`Jumping to sharding before fixing a missing index.`] },

{ id: 'q28', level: 'Senior', tags: ['cdc', 'events'],
  code: r`~~~sql
CREATE TABLE outbox (
  id uuid PRIMARY KEY, aggregate_type text NOT NULL, aggregate_id text NOT NULL,
  type text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER SYSTEM SET wal_level = logical;                       -- restart required
ALTER SYSTEM SET max_slot_wal_keep_size = '100GB';          -- bound WAL retained by a dead connector
CREATE PUBLICATION dbz_outbox FOR TABLE outbox;
~~~
~~~json
{ "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
  "plugin.name": "pgoutput", "publication.name": "dbz_outbox", "table.include.list": "public.outbox",
  "transforms": "outbox", "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
  "transforms.outbox.route.by.field": "aggregate_type", "transforms.outbox.table.field.event.key": "aggregate_id" }
~~~`,
  q: r`How do you publish events from PostgreSQL reliably (outbox, logical decoding, Debezium)?`,
  a: r`Dual writes (DB commit then publish to Kafka) lose or duplicate events on failure. Options:

- **Transactional outbox + poller**: insert the event into an {{outbox}} table in the same transaction; a relay polls with {{FOR UPDATE SKIP LOCKED}} and publishes. Simple, works everywhere, adds polling latency.
- **Outbox + CDC (Debezium)**: Debezium reads the WAL via a **logical replication slot** ({{pgoutput}}) and streams outbox inserts to Kafka with the outbox event router. Low latency, no polling load, ordering per aggregate.
- **CDC on business tables**: exposes internal schema as a public contract; usually avoid.

~~~mermaid
sequenceDiagram
  participant API as .NET API
  participant PG as PostgreSQL
  participant DBZ as Debezium (slot)
  participant K as Kafka
  API->>PG: BEGIN, UPDATE orders, INSERT outbox, COMMIT
  PG-->>DBZ: WAL decoded change
  DBZ->>K: publish OrderPlaced (key = orderId)
  DBZ->>PG: confirm LSN (slot advances)
~~~

Operational risks: the slot retains WAL if Debezium is down (alert on {{pg_replication_slots}} lag, set {{max_slot_wal_keep_size}}); failover may lose logical slots unless slot sync/failover slots are configured (v17); consumers must be idempotent (at-least-once).`,
  pts: [r`Dual writes are unsafe`, r`Outbox in same transaction`, r`Debezium via logical slot`, r`Slot WAL retention risk`, r`Idempotent consumers`],
  ex: r`A team's Debezium connector was down over a weekend; the slot retained 900 GB of WAL and the primary's disk hit 95%. max_slot_wal_keep_size and an alert now bound the risk.`,
  fu: [r`What happens to the slot on failover?`],
  pit: [r`Publishing to Kafka inside the DB transaction.`] },

{ id: 'q29', level: 'Senior', tags: ['memory', 'tuning'],
  code: r`~~~sql
-- 64 GB RAM, NVMe, OLTP baseline
ALTER SYSTEM SET shared_buffers = '16GB';            -- ~25% RAM (restart)
ALTER SYSTEM SET effective_cache_size = '44GB';      -- planner hint only
ALTER SYSTEM SET work_mem = '16MB';                  -- per sort/hash node per backend
ALTER SYSTEM SET maintenance_work_mem = '2GB';
ALTER SYSTEM SET random_page_cost = 1.1;             -- SSD
-- big report: raise memory just for this transaction
BEGIN; SET LOCAL work_mem = '512MB'; SELECT ...; COMMIT;
SELECT datname, temp_files, pg_size_pretty(temp_bytes) FROM pg_stat_database;   -- spills
~~~`,
  q: r`How do you size shared_buffers, work_mem and effective_cache_size?`,
  a: r`- **{{shared_buffers}}**: PostgreSQL's own cache. Start at ~25% of RAM (RDS defaults similar). It relies on the OS page cache for the rest (double buffering), so larger is not always better.
- **{{effective_cache_size}}**: a planner hint only (no allocation): ~50 to 75% of RAM. Higher makes index scans look cheaper.
- **{{work_mem}}**: per sort/hash **node**, per query, per connection (and per parallel worker). Total ≈ work_mem × nodes × active connections. Keep the global modest (4 to 64 MB) and raise per session for reports: {{SET LOCAL work_mem = '512MB'}}. Watch {{temp_files}} in {{pg_stat_database}} and spills in plans.
- **{{maintenance_work_mem}}**: vacuum, CREATE INDEX (e.g. 1 to 2 GB); {{autovacuum_work_mem}} separately.
- **{{random_page_cost}}**: default 4 assumes spinning disks; set ~1.1 for SSD/NVMe so the planner prefers index scans appropriately.

Change one thing, measure with pg_stat_statements, keep the rationale in config-as-code.`,
  pts: [r`shared_buffers ~25%`, r`effective_cache_size is a hint`, r`work_mem multiplies`, r`random_page_cost ~1.1 on SSD`],
  ex: r`Setting work_mem to 256 MB globally caused OOM kills under 300 connections; a 16 MB default plus per-report SET LOCAL fixed both spills and memory.`,
  fu: [r`What does huge_pages do for large shared_buffers?`],
  pit: [r`Treating work_mem as a per-connection budget.`] },

{ id: 'q30', level: 'Senior', tags: ['locking', 'deadlocks', 'incident'],
  q: r`Diagnose a blocking chain and a deadlock in PostgreSQL.`,
  a: r`### Blocking
~~~sql
SELECT pid, pg_blocking_pids(pid) AS blocked_by, state, wait_event_type, wait_event,
       now() - xact_start AS xact_age, left(query, 120)
FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;
~~~
Walk to the root blocker; it is often {{idle in transaction}} (an app that opened a transaction and then did an HTTP call). Terminate with {{pg_terminate_backend(pid)}} if needed.

### Deadlocks
PostgreSQL checks for cycles after {{deadlock_timeout}} (1 s), aborts one transaction with {{40P01}} and logs both statements ({{log_lock_waits = on}} shows waits over deadlock_timeout too).

Causes and fixes: inconsistent lock order across code paths (sort ids before updating), FK checks taking {{KEY SHARE}} on parents, and long transactions holding locks. Retry 40P01 in the app.

### Prevent
Short transactions, no network I/O inside a transaction, {{lock_timeout}}, {{idle_in_transaction_session_timeout}}, consistent ordering.`,
  pts: [r`pg_blocking_pids for chains`, r`idle in transaction root blockers`, r`40P01 and retry`, r`Consistent lock ordering`, r`Timeouts`],
  ex: r`A transfer service deadlocked when two transfers between A and B ran in opposite directions; locking accounts in ascending id order removed every deadlock.`,
  fu: [r`Why can a foreign key cause blocking on the parent table?`],
  pit: [r`Raising deadlock_timeout to "reduce deadlocks".`] },

{ id: 'q31', level: 'Senior', tags: ['security'],
  code: r`~~~sql
CREATE ROLE payments_migrator LOGIN;                     -- DDL in CI/CD only
CREATE ROLE payments_app LOGIN;                          -- DML only
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA payments TO payments_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA payments TO payments_app;
ALTER DEFAULT PRIVILEGES FOR ROLE payments_migrator IN SCHEMA payments
  GRANT SELECT, INSERT, UPDATE ON TABLES TO payments_app;
ALTER SYSTEM SET password_encryption = 'scram-sha-256';
ALTER SYSTEM SET pgaudit.log = 'ddl, role, write';
~~~
~~~csharp
var cs = "Host=pg.internal;Database=payments;Username=payments_app;SSL Mode=VerifyFull;Root Certificate=/etc/ssl/rds-ca.pem";
~~~`,
  q: r`How do you secure a PostgreSQL deployment for a regulated (PCI/SOX) environment?`,
  a: r`- **Network**: private subnets only; security groups from app tiers; no public endpoint.
- **Authentication**: {{scram-sha-256}} (never md5/trust), or IAM / Entra ID token auth on RDS/Azure (short-lived tokens, no static passwords); certificates for admin access.
- **TLS**: {{sslmode=verify-full}} in Npgsql connection strings ({{SSL Mode=VerifyFull}}), enforce {{rds.force_ssl}}.
- **Least privilege**: separate roles for migration (DDL), app (DML on its schema), read-only reporting; revoke {{CREATE}} on {{public}} schema; no superuser for apps; default privileges for new tables.
- **Encryption at rest**: KMS-backed storage encryption; column-level ({{pgcrypto}}) or app-level encryption/tokenisation for PAN data, ideally keeping PAN out of the DB via a vault.
- **Auditing**: {{pgaudit}} for DDL, role changes and access to sensitive tables, shipped to an immutable log store.
- **Secrets**: rotated via Secrets Manager / Key Vault.
- **Patching**: track minor releases (security fixes) within a defined SLA.
- RLS for tenant isolation; masking views for support staff.`,
  pts: [r`scram-sha-256 or IAM auth`, r`verify-full TLS`, r`Least-privilege roles`, r`pgaudit to immutable store`, r`Tokenise PAN, keep it out of the DB`],
  ex: r`A PCI assessment scoped the whole database in because PAN was stored encrypted with the key on the same server; tokenisation via a vault took the database out of PCI scope.`,
  fu: [r`What does pgaudit log that log_statement does not?`],
  pit: [r`App connecting as postgres superuser.`] },

{ id: 'q32', level: 'Senior', tags: ['read-replicas', 'consistency'],
  code: r`~~~csharp
// LSN-based read-your-writes: return the commit LSN, wait for it on the replica
await using var cmd = primary.CreateCommand("INSERT INTO orders (...) VALUES (...); SELECT pg_current_wal_lsn()::text");
var lsn = (string)(await cmd.ExecuteScalarAsync(ct))!;          // hand back to the client (header or cookie)

await using var check = replica.CreateCommand("SELECT pg_last_wal_replay_lsn() >= $1::pg_lsn");
check.Parameters.Add(new() { Value = lsn });
bool caughtUp = (bool)(await check.ExecuteScalarAsync(ct))!;
var source = caughtUp ? replica : primary;                       // fall back to primary if lagging
~~~`,
  q: r`How do you use read replicas without serving stale or inconsistent data?`,
  a: r`Streaming replicas are asynchronous by default, so lag ranges from milliseconds to minutes (long replay conflicts, heavy writes).

Patterns:

- **Route by consistency need**: writes and read-after-write to primary; dashboards, search, reports to replicas.
- **Session stickiness**: after a user writes, route their reads to the primary for N seconds.
- **LSN-based reads**: return the commit LSN ({{pg_current_wal_lsn()}}) with the write; on the replica wait until {{pg_last_wal_replay_lsn() >= lsn}} or fall back to primary.
- **Monitor lag**: {{pg_stat_replication.replay_lag}} on the primary; pull a replica out of rotation over a threshold.

Replica query conflicts: long queries on a replica can be cancelled when the primary vacuums rows they need ({{max_standby_streaming_delay}}); {{hot_standby_feedback = on}} avoids cancellation but bloats the primary. Use a dedicated reporting replica with feedback off and long delay, or a separate analytics store.`,
  pts: [r`Async lag is real`, r`Route by consistency need`, r`Read-your-writes via stickiness or LSN`, r`Replica conflicts vs feedback bloat`],
  ex: r`Users saw "order not found" right after checkout because the confirmation page read from a replica; sticky primary reads for 5 s after a write fixed it.`,
  fu: [r`How does Npgsql's multi-host load balancing choose a replica?`],
  pit: [r`Treating replicas as a transparent scale-out for all reads.`] },

{ id: 'q33', level: 'Senior', tags: ['extensions'],
  code: r`~~~sql
SELECT extname, extversion FROM pg_extension ORDER BY 1;          -- inventory before every upgrade
SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name IN ('vector','postgis','pg_partman');
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
ALTER EXTENSION vector UPDATE TO '0.8.0';
~~~`,
  q: r`Which PostgreSQL extensions matter in production, and what is the risk of depending on them?`,
  a: r`High-value extensions:

- {{pg_stat_statements}}: per-query statistics; non-negotiable.
- {{auto_explain}}: logs plans of slow queries.
- {{pgaudit}}: compliance auditing.
- {{pg_trgm}}, {{btree_gist}}, {{pgcrypto}}, {{uuid-ossp}} (or built-in {{gen_random_uuid()}}).
- {{PostGIS}}: geospatial; best in class.
- {{pgvector}}: vector similarity (HNSW/IVFFlat) for RAG next to relational data.
- {{pg_partman}}, {{pg_cron}}, {{pg_repack}}.
- {{TimescaleDB}}, {{Citus}}: change the database's character (licensing and managed-service availability vary).

Risks: managed services allow only a whitelist and specific versions; extensions can block major-version upgrades; some have licence restrictions (Timescale's community licence); and an extension is a dependency with its own CVEs. Keep an inventory, pin versions, and include extensions in the upgrade rehearsal.`,
  pts: [r`pg_stat_statements essential`, r`pgvector for AI workloads`, r`Managed service whitelists`, r`Extensions can block upgrades`],
  ex: r`A team planned a PostgreSQL 16 upgrade and discovered their extension version was unsupported on the target RDS version; rehearsal caught it a month before the window.`,
  fu: [r`When would you choose pgvector over a dedicated vector DB?`],
  pit: [r`Adopting an extension without checking managed-service support.`] },

{ id: 'q34', level: 'Senior', tags: ['upgrades'],
  code: r`~~~bash
# In-place, minutes of downtime: check first, then link mode
pg_upgrade -b /usr/lib/postgresql/13/bin -B /usr/lib/postgresql/16/bin \
  -d /var/lib/postgresql/13/main -D /var/lib/postgresql/16/main --link --check
pg_upgrade ... --link
vacuumdb --all --analyze-in-stages --jobs 8      # statistics are not carried over
~~~
~~~sql
-- logical-replication cutover: sync sequences before switching writes
SELECT 'SELECT setval(' || quote_literal(schemaname || '.' || sequencename) || ', ' || last_value || ');'
FROM pg_sequences WHERE last_value IS NOT NULL;   -- run on source, execute output on target
~~~`,
  q: r`How do you do a major-version upgrade with minimal downtime?`,
  a: r`Options:

| Method | Downtime | Notes |
|---|---|---|
| {{pg_dump}}/restore | Hours for large DBs | Simple, small databases only |
| {{pg_upgrade --link}} | Minutes | In place; rollback is hard after start; stats must be rebuilt ({{vacuumdb --analyze-in-stages}}) |
| Logical replication | Seconds (cutover) | New cluster on new version, replicate, cut over; sequences and DDL need handling |
| Managed blue/green (RDS Blue/Green) | ~1 minute switchover | Uses logical replication under the hood |

Runbook for logical-replication cutover: freeze DDL; create publication; build target; initial sync; monitor lag; run test traffic and compare query plans on the new version; at cutover, stop writes (or pause PgBouncer), wait lag zero, **sync sequences** ({{setval}}), switch connection target, resume; keep the old cluster with reverse replication for rollback.

Upgrade risk is mostly **plan changes** and extension compatibility, not data loss. Rehearse with production-like data and capture pg_stat_statements before and after.`,
  pts: [r`pg_upgrade link mode = minutes`, r`Logical replication = seconds`, r`Sync sequences at cutover`, r`Rebuild statistics`, r`Rehearse and compare plans`],
  ex: r`A 6 TB cluster upgraded 13 to 16 via RDS Blue/Green with 45 s of write pause; a pre-upgrade plan comparison found two regressed queries fixed beforehand.`,
  fu: [r`Why do you need to ANALYZE after pg_upgrade?`],
  pit: [r`Forgetting sequences in logical replication, causing duplicate key errors after cutover.`] },

{ id: 'q35', level: 'Senior', tags: ['pgvector', 'ai'],
  q: r`How would you use pgvector for a RAG system, and what are its limits?`,
  a: r`~~~sql
CREATE EXTENSION vector;
CREATE TABLE doc_chunks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  doc_id uuid NOT NULL,
  content text NOT NULL,
  embedding vector(1536) NOT NULL);
CREATE INDEX ON doc_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
SET hnsw.ef_search = 100;
SELECT id, content FROM doc_chunks
WHERE tenant_id = $1
ORDER BY embedding <=> $2 LIMIT 8;
~~~

Strengths: vectors live next to relational data, so tenant filters, ACL joins, transactions and backups are shared; one less system.

Limits and fixes:

- **Filtered ANN**: HNSW returns approximate top-k then filters, so selective filters can return too few rows. Use iterative scans (pgvector 0.8+), partial indexes per large tenant, or partitioning by tenant.
- **Memory**: HNSW wants to fit in RAM; at tens of millions of 1536-dim vectors, consider {{halfvec}}, dimension reduction, or a dedicated vector DB.
- **Build time** and write amplification on large reindexing.
- Hybrid search (BM25 + vector) needs combining FTS ranking with vector distance (reciprocal rank fusion).`,
  pts: [r`HNSW index with cosine ops`, r`Co-located ACL and tenant filters`, r`Filtered ANN recall issue`, r`Memory limits at scale`, r`Hybrid search via RRF`],
  ex: r`An internal knowledge assistant with 3 M chunks ran on pgvector inside the existing Aurora cluster, avoiding a new vendor review, with p95 retrieval under 40 ms.`,
  fu: [r`How do you measure retrieval recall?`],
  pit: [r`Ignoring that post-filtering can silently drop recall.`] },

{ id: 'q36', level: 'Senior', tags: ['observability'],
  code: r`~~~sql
-- Wraparound and vacuum health
SELECT datname, age(datfrozenxid) AS xid_age FROM pg_database ORDER BY 2 DESC;
-- Long and idle-in-transaction sessions
SELECT pid, state, now() - xact_start AS xact_age, wait_event_type, left(query, 60)
FROM pg_stat_activity WHERE xact_start < now() - interval '5 minutes' ORDER BY xact_age DESC;
-- Wait-event breakdown right now
SELECT wait_event_type, wait_event, count(*) FROM pg_stat_activity WHERE state = 'active' GROUP BY 1, 2 ORDER BY 3 DESC;
~~~`,
  q: r`What would you put on a PostgreSQL production dashboard and alert on?`,
  a: r`**Golden signals for the database:**

- Throughput: transactions/s, rows/s (pg_stat_database).
- Latency: top queries by total time and mean time (pg_stat_statements); p99 from the app side.
- Saturation: active connections vs pool size, CPU, IOPS/throughput vs provisioned, {{wait_event}} breakdown.
- Errors: rollbacks, deadlocks, serialization failures, connection failures.

**PostgreSQL-specific:**

- Replication lag (bytes and time), replication slot retained WAL.
- {{age(datfrozenxid)}} (wraparound).
- Dead tuples and last autovacuum on top tables; long-running and idle-in-transaction sessions.
- Checkpoint frequency and buffers written by backends.
- Temp file bytes (work_mem spills); cache hit ratio (a symptom, not a target).
- Disk free and WAL volume growth.

Alert on symptoms that need action (lag over SLO, xid age over 1 B, slot retaining over 50 GB, disk under 20%, idle-in-transaction over 5 min), not on every metric.`,
  pts: [r`pg_stat_statements top-N`, r`Wait events`, r`Lag and slot retention`, r`xid age and vacuum health`, r`Actionable alerts only`],
  ex: r`An alert on slot-retained WAL caught a stopped CDC connector 6 hours before the disk would have filled.`,
  fu: [r`Why is cache hit ratio a poor alert?`],
  pit: [r`Alerting on CPU alone.`] },

{ id: 'q37', level: 'Principal', tags: ['architecture-decision'],
  code: r`~~~text
ADR-014: Database engine for new .NET services
Context: 30 new services on AWS; SQL Server Enterprise licences = ~$X/yr; team strong in T-SQL.
Options scored (weight): TCO 30 | team skill 20 | ops features 20 | portability 15 | ecosystem 15
  SQL Server (RDS):       2 | 5 | 5 | 2 | 4  -> 3.5
  PostgreSQL (Aurora):    5 | 3 | 4 | 5 | 4  -> 4.25
Decision: PostgreSQL for new services; core ledger stays on SQL Server.
Mitigations: 6-week training, DB reliability owner, paved-road Terraform module, pilot service first.
Revisit: after 12 months using incident and cost data.
~~~`,
  q: r`SQL Server or PostgreSQL for a new .NET platform? How would you decide and justify it?`,
  a: r`Frame it as a decision record with weighted criteria, not a preference.

| Criterion | SQL Server | PostgreSQL |
|---|---|---|
| Licence cost | Enterprise core licences are a major line item | Free; pay only for compute/managed service |
| .NET tooling | First-class (SSMS, SSDT, EF Core default) | Excellent (Npgsql, EF Core provider) but less familiar |
| Operational features | Query Store plan forcing, mature AG, columnstore | Rich extensions (PostGIS, pgvector, partman), logical replication |
| Cloud options | Azure SQL, RDS SQL Server | RDS, Aurora, Azure Flexible Server, AlloyDB, Neon |
| Team skills | Often strong in .NET shops | May need training on vacuum, pooling, planner |
| Concurrency model | Locking by default, RCSI opt-in | MVCC by default, vacuum cost |

Recommendation logic: for a new, cloud-hosted, cost-sensitive platform without heavy SSIS/SSRS dependencies, **PostgreSQL** usually wins on TCO and portability. Keep **SQL Server** where existing estate, Always On skills, or features like Query Store plan forcing and columnstore are central, or where migration risk outweighs savings.

Mitigate the PostgreSQL risks explicitly: training budget, a DBA/SRE owner for vacuum and pooling, runbooks, and a pilot service. Revisit in 12 months with measured cost and incident data.`,
  pts: [r`Weighted criteria, written ADR`, r`Licence TCO is often decisive`, r`Team skills and ops maturity`, r`Feature dependencies (SSIS, Query Store)`, r`Pilot + review point`],
  ex: r`A bank's digital lending platform chose PostgreSQL on Aurora for new services, saving roughly seven figures a year in licences, while the core ledger stayed on SQL Server to avoid migration risk.`,
  fu: [r`How would you migrate an existing SQL Server service?`, r`What would make you reverse the decision?`],
  pit: [r`Arguing benchmarks instead of total cost and team capability.`],
  tip: r`End with the reversal condition. Principals show they know when they would be wrong.` },

{ id: 'q38', level: 'Principal', tags: ['migration', 'sql-server'],
  code: r`~~~sql
-- T-SQL
SELECT TOP (10) Id, ISNULL(Email, '') AS Email FROM dbo.Customers WITH (NOLOCK) WHERE Email = @email;
-- PostgreSQL translation: case-insensitive match needs citext or a nondeterministic collation
CREATE EXTENSION IF NOT EXISTS citext;
ALTER TABLE customers ALTER COLUMN email TYPE citext;
SELECT id, COALESCE(email, '') AS email FROM customers WHERE email = $1 LIMIT 10;
-- or: CREATE COLLATION ci (provider = icu, locale = 'und-u-ks-level2', deterministic = false);
~~~
~~~bash
# validate a table after the copy: counts and an order-independent checksum
psql -c "SELECT count(*), md5(string_agg(md5(t::text), '' ORDER BY id)) FROM customers t"
~~~`,
  q: r`Plan a migration of a large SQL Server application to PostgreSQL.`,
  a: r`### Assess
Inventory schema, T-SQL procedures, triggers, SQL Agent jobs, SSIS, linked servers, CLR, full-text, temporal tables. Use AWS SCT / Babelfish assessment or ora2pg-style tools. Classify each object: auto-convertible, rewrite, or redesign.

### Translate (the gotchas)
- {{IDENTITY}} → {{GENERATED AS IDENTITY}}; {{NVARCHAR}} → {{text}} (UTF-8 everywhere).
- Case sensitivity: SQL Server collations are often case-insensitive; PostgreSQL text comparison is case-sensitive. Use {{citext}} or nondeterministic ICU collations, or normalise.
- {{DATETIME}} → {{timestamptz}}; {{BIT}} → {{boolean}}; {{TOP}} → {{LIMIT}}; {{ISNULL}} → {{COALESCE}}; {{MERGE}} semantics differ.
- Procedures with result sets → functions returning tables; error handling and transactions inside procedures differ.
- Empty string vs NULL behaviour is the same, but implicit conversions differ (PostgreSQL is stricter).

### Move data
Full load plus CDC (AWS DMS, Debezium) to keep the target in sync; validate with row counts and checksums per table.

### Cut over per service
Strangler: move one bounded context at a time; run shadow reads comparing results; cut writes during a short freeze; keep reverse replication for rollback.

### Risk
Performance regressions from different planners: replay production queries ({{pg_stat_statements}} baselines) before cutover. Babelfish can lower the rewrite cost but adds its own compatibility edge cases.`,
  pts: [r`Inventory and classify objects`, r`Case sensitivity and types`, r`Full load + CDC + validation`, r`Strangler per service`, r`Reverse replication for rollback`],
  ex: r`A retailer migrated 40 databases over 18 months service by service; the biggest bug class was case-insensitive email lookups that silently stopped matching until citext was applied.`,
  fu: [r`How would you validate financial data matches exactly?`],
  pit: [r`Big-bang migration of every database in one weekend.`] },

{ id: 'q39', level: 'Principal', tags: ['ledger', 'fintech', 'design'],
  q: r`Design a double-entry ledger on PostgreSQL that is correct under concurrency.`,
  a: r`~~~sql
CREATE TABLE accounts (id bigint PRIMARY KEY, currency char(3) NOT NULL,
  balance numeric(19,4) NOT NULL DEFAULT 0, version bigint NOT NULL DEFAULT 0,
  allow_negative boolean NOT NULL DEFAULT false);
CREATE TABLE journal (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE postings (journal_id bigint NOT NULL REFERENCES journal,
  account_id bigint NOT NULL REFERENCES accounts, amount numeric(19,4) NOT NULL,
  PRIMARY KEY (journal_id, account_id));
~~~

Invariants and how each is enforced:

- **Postings sum to zero per journal**: insert all postings in one transaction and verify ({{SUM(amount) = 0}}) in the posting function, or a deferred constraint trigger at commit.
- **No double posting**: {{idempotency_key}} UNIQUE; a retry returns the original journal.
- **No overdraft**: update balances atomically in deterministic account order: {{UPDATE accounts SET balance = balance + $amt WHERE id = $id AND (allow_negative OR balance + $amt >= 0)}}; zero rows = reject and roll back.
- **Append-only**: revoke UPDATE/DELETE on journal and postings from the app role; corrections are reversing journals.
- **Audit**: balance is a cache; reconcile nightly {{balance = SUM(postings)}}.

Hot accounts (a merchant's settlement account) serialise on one row: shard the account into N sub-accounts, or post asynchronously in batches.`,
  pts: [r`Zero-sum per journal`, r`Idempotency key unique`, r`Conditional atomic balance update in id order`, r`Append-only, reversals not edits`, r`Hot-account sharding`],
  ex: r`A wallet product handled 3,000 postings/s, except the platform fee account which became a lock hotspot; splitting it into 32 sub-accounts removed contention.`,
  fu: [r`How do you produce a balance as of a past date?`, r`Where would SERIALIZABLE help or hurt here?`],
  pit: [r`Storing only balances with no postings.`, r`Read-modify-write balance updates in the app.`] },

{ id: 'q40', level: 'Principal', tags: ['managed-services', 'cost'],
  code: r`~~~bash
# Aurora I/O-Optimized when I/O is a large share of the bill
aws rds modify-db-cluster --db-cluster-identifier payments --storage-type aurora-iopt1 --apply-immediately
# Fast clone for a test environment (copy-on-write, minutes)
aws rds restore-db-cluster-to-point-in-time --source-db-cluster-identifier payments \
  --db-cluster-identifier payments-clone --restore-type copy-on-write --use-latest-restorable-time
~~~`,
  q: r`Compare RDS PostgreSQL, Aurora PostgreSQL and Azure Database for PostgreSQL Flexible Server from a cost and risk view.`,
  a: r`| | RDS PostgreSQL | Aurora PostgreSQL | Azure Flexible Server |
|---|---|---|---|
| Storage | EBS (gp3/io2) per instance | Shared distributed storage, 6 copies, 3 AZs | Managed disks; zone-redundant HA option |
| Replicas | Up to 15, async, own storage | Up to 15, shared storage, low lag | Read replicas, async |
| Failover | Multi-AZ 60 to 120 s; cluster ~35 s | Typically under 30 s | ~60 to 120 s zone-redundant HA |
| Cost model | Instance + storage + IOPS | Instance + storage + I/O (or I/O-Optimized tier) | vCore + storage, reserved discounts |
| Extras | Wide extension support | Global Database, fast clones, Serverless v2 | Entra ID auth, Azure integration |

Decision factors: I/O-heavy workloads can make Aurora Standard expensive (choose I/O-Optimized when I/O exceeds ~25% of the bill); fast clones help test environments; Serverless v2 suits spiky dev/test but has a floor cost. Lock-in: Aurora's storage layer and Global Database are proprietary, but the SQL surface is PostgreSQL, so migration out is logical replication.

Put numbers on it: model monthly cost for current workload and 3× growth, with reserved instances, and include failover RTO as a business metric.`,
  pts: [r`Aurora shared storage, fast failover`, r`I/O pricing trap and I/O-Optimized`, r`Fast clones and Global DB`, r`Model cost at growth multiples`],
  ex: r`A team's Aurora bill was 60% I/O charges; switching to I/O-Optimized cut the total by about 30% with no code change.`,
  fu: [r`When is self-managed on Kubernetes justified?`],
  pit: [r`Choosing Aurora for every workload without checking the I/O profile.`] },

{ id: 'q41', level: 'Principal', tags: ['dr', 'multi-region'],
  code: r`~~~bash
# Aurora Global Database: managed cross-region failover (planned) or detach-and-promote (unplanned)
aws rds failover-global-cluster --global-cluster-identifier payments-global \
  --target-db-cluster-identifier arn:aws:rds:us-east-1:123456789012:cluster:payments-dr
aws rds remove-from-global-cluster --global-cluster-identifier payments-global \
  --db-cluster-identifier arn:aws:rds:us-east-1:123456789012:cluster:payments-dr     # unplanned: promote DR
~~~
~~~sql
SELECT max(replica_lag_in_msec) FROM aurora_global_db_status();   -- alert above 2000 ms
~~~`,
  q: r`Design cross-region disaster recovery for a PostgreSQL-backed payments system with an RPO of under 5 seconds and an RTO of 15 minutes.`,
  a: r`**Target architecture**: primary region with Multi-AZ HA (sync standby), async replication to a warm DR region (Aurora Global Database or a streaming replica), PgBackRest/automated backups copied cross-region and cross-account.

~~~mermaid
flowchart LR
  subgraph R1[Region A - active]
    APP1[Payments API] --> PX1[Proxy] --> P[(Primary)]
    P -- sync --> SB[(Standby AZ)]
  end
  subgraph R2[Region B - warm]
    APP2[Payments API scaled down] -.-> PX2[Proxy] -.-> DRR[(DR replica)]
  end
  P -- async WAL ~1s --> DRR
  P --> BK[(Backups, cross-account, object lock)]
~~~

Key decisions:

- **RPO**: async lag is typically sub-second; alert when it exceeds 2 s. Accept that a regional loss can lose in-flight seconds: **reconcile** with PSP settlement files after failover, which the payments domain does anyway.
- **RTO**: a scripted, rehearsed runbook (promote replica, scale app tier, flip DNS/Global Accelerator), with a human decision gate to avoid flapping on partial outages.
- **Split brain**: fence the old primary (stop app writes in region A) before promoting.
- **Idempotency** keys replicated with data, so retries after failover do not double-charge.
- **Game days** quarterly with measured RTO; regulators (DORA, PRA operational resilience) expect evidence.`,
  pts: [r`Sync HA in-region, async cross-region`, r`Reconcile to cover RPO gap`, r`Scripted promotion + human gate`, r`Fence old primary`, r`Measured game days`],
  ex: r`A quarterly DR test measured 11 minutes to promote and route traffic, with 0.8 s of data loss reconciled against the acquirer's files.`,
  fu: [r`Why not active-active writes across regions?`],
  pit: [r`Promising RPO 0 cross-region without synchronous replication latency cost.`] },

{ id: 'q42', level: 'Principal', tags: ['data-architecture'],
  code: r`~~~sql
-- Schema per service, role per service, no cross-grants
CREATE SCHEMA orders AUTHORIZATION orders_migrator;
CREATE SCHEMA billing AUTHORIZATION billing_migrator;
REVOKE ALL ON SCHEMA billing FROM orders_app;
-- CI check: fail if a migration references another service's schema
-- grep -E '\b(billing|shipping)\.' migrations/orders/*.sql && exit 1
~~~`,
  q: r`How do you prevent the shared database anti-pattern while many services want PostgreSQL?`,
  a: r`Shared databases couple deploys, schemas and failure domains: a migration in one service breaks another, and one team's bad query takes everyone down.

Principles:

- **One owner per schema**: each service owns its tables; others integrate via APIs or events, never direct SQL.
- **Physical layout follows criticality, not dogma**: database-per-service for critical services; smaller services can share a cluster with separate databases/schemas and separate roles (no cross-grants), accepting a shared failure domain for cost.
- **Enforce with permissions**: each service's role can only access its schema; CI checks block cross-schema references.
- **Reporting** via CDC into a warehouse, not via reading service tables.
- **Platform offering**: a paved road (Terraform module, standard parameter groups, pgBouncer, backups, dashboards) so teams get correct defaults without a central DBA bottleneck.

Governance: architecture review only for exceptions; fitness functions (automated checks) instead of meetings.`,
  pts: [r`Schema ownership per service`, r`Shared cluster ok, shared tables not`, r`Enforce with roles and CI`, r`CDC for reporting`, r`Paved road platform`],
  ex: r`A monolith split left 12 services reading one orders table; a schema change took a 6-team coordination. Introducing an order-events stream and read models let the orders team ship schema changes alone.`,
  fu: [r`How do you migrate consumers off direct table access?`],
  pit: [r`Database-per-service everywhere, multiplying ops cost for tiny services.`] },

{ id: 'q43', level: 'Principal', tags: ['incident', 'disk-full'],
  code: r`~~~sql
-- 1. what is growing?
SELECT pg_size_pretty(sum(size)) FROM pg_ls_waldir();
SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM pg_replication_slots ORDER BY pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) DESC;
SELECT archived_count, failed_count, last_failed_wal, last_failed_time FROM pg_stat_archiver;
-- 2. decision recorded with the consumer's owner: drop the abandoned slot
SELECT pg_drop_replication_slot('analytics_dbz');
-- 3. guardrail
ALTER SYSTEM SET max_slot_wal_keep_size = '100GB'; SELECT pg_reload_conf();
~~~`,
  q: r`The primary's disk is 97% full at 2 a.m. Lead the incident.`,
  a: r`### Stabilise (minutes)
1. Declare the incident, assign roles (lead, ops, comms).
2. Find what is growing: {{pg_wal}} directory (slots or archiving failures) vs table data vs temp files vs logs.
3. If WAL: check {{pg_replication_slots}} for inactive slots retaining WAL and {{pg_stat_archiver}} for failing archive_command. Dropping an abandoned slot frees WAL immediately (the consumer must later resync: a business decision, record it).
4. If temp files: find and cancel the runaway query.
5. Buy space: on managed services, increase storage (online on RDS, but there is a 6-hour cooldown before the next increase); delete old logs.

Never delete files in {{pg_wal}} manually; that corrupts the database.

### Recover
Confirm writes succeed, replication healthy, backups resumed.

### Learn
Blameless postmortem: why no alert at 80%? Add {{max_slot_wal_keep_size}}, storage autoscaling, slot and archiver alerts, ownership of the CDC connector.`,
  pts: [r`Identify growth source first`, r`Slots and archiver are top suspects`, r`Never rm pg_wal`, r`Grow storage with cooldown awareness`, r`Postmortem: guardrails and ownership`],
  ex: r`An analytics team's paused Debezium slot retained 1.4 TB; dropping it saved the primary and the team re-snapshotted their pipeline the next day.`,
  fu: [r`Who gets to decide to drop the slot?`],
  pit: [r`Deleting WAL segments by hand.`],
  tip: r`Make clear who makes the business decision (dropping the slot breaks a consumer). Principals separate technical action from decision rights.` },

{ id: 'q44', level: 'Principal', tags: ['capacity-planning'],
  code: r`~~~bash
# Replay a production-shaped workload at increasing rates to find the latency knee
pgbench -h pg-staging -c 64 -j 16 -T 600 -R 3000 -f checkout.sql -f browse.sql@4 --progress=30 payments
pgbench -h pg-staging -c 128 -j 16 -T 600 -R 6000 -f checkout.sql -f browse.sql@4 --progress=30 payments
pgbench -h pg-staging -c 192 -j 16 -T 600 -R 9000 -f checkout.sql -f browse.sql@4 --progress=30 payments
~~~`,
  q: r`How do you capacity-plan a PostgreSQL cluster for 3× growth next year?`,
  a: r`1. **Baseline**: from pg_stat_statements and cloud metrics take peak (not average) CPU, IOPS, throughput, connections, memory working set, storage growth/month, WAL/day.
2. **Find the binding constraint** at 3×: usually CPU for OLTP, IOPS for write-heavy, working set vs RAM for reads, or connection count.
3. **Load test** a production-like copy with replayed traffic (pgbench custom scripts or captured workload) at 1×, 2×, 3×; find the knee in latency.
4. **Headroom policy**: e.g. peak CPU under 60%, so failover to a same-size standby survives.
5. **Plan the levers** ranked by cost: query/index fixes (cheapest), caching, replicas for reads, instance class, partitioning/retention to cap storage, functional split, and only then sharding.
6. **Cost model** with reserved/savings plans, and a trigger list ("if CPU p95 over 60% for 2 weeks, execute step X").

Also plan the non-performance limits: vacuum throughput at 3× write rate, xid consumption, backup and restore time (RTO grows with size).`,
  pts: [r`Peaks, not averages`, r`Find the binding constraint`, r`Load test to find the knee`, r`Headroom for failover`, r`Restore time grows with size`],
  ex: r`Capacity planning showed RTO would breach 4 hours at 3× size; the team introduced partition-level archival to S3, keeping the hot database under 2 TB.`,
  fu: [r`How do you replay production traffic safely?`],
  pit: [r`Planning from average CPU.`] },

{ id: 'q45', level: 'Principal', tags: ['governance', 'team'],
  code: r`~~~yaml
# CI: lint every migration with squawk before it can merge
- name: Lint migrations
  run: |
    npx squawk-cli@1.4.0 --exclude=prefer-text-field migrations/*.sql
~~~
~~~sql
-- What squawk rejects (examples)
CREATE INDEX ix_orders_customer ON orders (customer_id);            -- require-concurrent-index-creation
ALTER TABLE orders ADD COLUMN ref uuid DEFAULT gen_random_uuid();   -- table rewrite (volatile default)
ALTER TABLE orders ALTER COLUMN amount TYPE numeric(20,4);          -- changing-column-type
~~~`,
  q: r`Your organisation has 30 teams using PostgreSQL with frequent incidents. How do you raise the bar without becoming a bottleneck?`,
  a: r`Diagnose first: categorise the last 6 months of incidents (bad migrations, missing indexes, connection exhaustion, vacuum, slot/disk). Usually 3 categories cause 80%.

Then address each with the lightest effective mechanism:

- **Paved road**: a Terraform module with sane parameter groups, PgBouncer, backups, pgaudit, dashboards and alerts by default.
- **Automated guardrails in CI**: migration linting (e.g. squawk) rejects non-concurrent index creation, missing lock_timeout, table rewrites; EF Core migration SQL is reviewed as SQL.
- **Production guardrails**: statement_timeout and idle_in_transaction_session_timeout defaults, slot WAL limits.
- **Shared visibility**: a per-team query-performance report from pg_stat_statements.
- **Enablement**: a short PostgreSQL-for-.NET-engineers course, office hours, runbooks; a guild with database champions per team.
- **Clear ownership**: each database has an owning team on call; the platform team owns the paved road, not every database.

Measure: incident count by category, mean time to recover, migration failure rate. Report quarterly.`,
  pts: [r`Data-driven incident categories`, r`Paved road defaults`, r`CI migration linting`, r`Enablement and champions`, r`Measure outcomes`],
  ex: r`Migration linting plus default timeouts cut database-caused incidents by about 70% over two quarters without adding review meetings.`,
  fu: [r`How do you handle a team that refuses the paved road?`],
  pit: [r`Creating a central DBA approval gate for every schema change.`] },

{ id: 'q46', level: 'Principal', tags: ['event-store', 'design'],
  q: r`Would you build an event store on PostgreSQL? Design it.`,
  a: r`Yes, for most teams: it gives transactions, constraints and familiar operations, and tools like Marten (.NET) already do it.

~~~sql
CREATE TABLE events (
  global_position bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stream_id uuid NOT NULL,
  stream_version int NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  metadata jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stream_id, stream_version));
~~~

- **Optimistic concurrency**: append with expected version; the unique constraint rejects a concurrent append to the same version.
- **Subscriptions** reading by {{global_position}} have a trap: identity values are assigned before commit, so a later position can commit before an earlier one and a reader could skip it. Fixes: read only up to a safe high-water mark (positions older than the oldest in-flight transaction, as Marten's async daemon does), or use a single-writer sequence, or wait briefly on gaps.
- **Snapshots** table for long streams; **partition** by time or stream hash for retention/archival.
- Publishing: outbox or logical decoding to Kafka for external consumers.

Consider EventStoreDB or Kafka-as-log only when you need native subscriptions at very high scale.`,
  pts: [r`Unique (stream, version) for concurrency`, r`Global position gap trap`, r`Snapshots and partitioning`, r`Marten as prior art`],
  ex: r`A team's projection skipped events under load because it trusted identity order; adopting a high-water-mark reader fixed a reconciliation discrepancy.`,
  fu: [r`How do you rebuild a projection without downtime?`],
  pit: [r`Assuming identity/sequence order equals commit order.`],
  tip: r`The commit-order gap is the discriminating detail. Mention it unprompted.` },

{ id: 'q47', level: 'Principal', tags: ['olap', 'reporting'],
  code: r`~~~sql
CREATE MATERIALIZED VIEW daily_revenue AS
SELECT merchant_id, date_trunc('day', created_at) AS day, count(*) AS orders, sum(total) AS revenue
FROM orders WHERE status = 'PAID' GROUP BY 1, 2;
CREATE UNIQUE INDEX ON daily_revenue (merchant_id, day);          -- required for CONCURRENTLY
REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue;             -- readers not blocked (pg_cron every 5 min)
SELECT cron.schedule('refresh-revenue', '*/5 * * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue');
~~~`,
  q: r`Product wants real-time analytics on the PostgreSQL OLTP database. What do you propose?`,
  a: r`Clarify: who reads, how fresh (seconds vs hours), query shapes (fixed dashboards vs ad hoc), data volume.

Options by increasing cost:

1. **Targeted indexes or materialized views** ({{REFRESH MATERIALIZED VIEW CONCURRENTLY}}) for a few fixed dashboards, refreshed every few minutes.
2. **Dedicated read replica** for reporting with tuned settings (larger work_mem, long standby delay), protecting the primary.
3. **Rollup tables** maintained by the app or triggers (counters per hour), or TimescaleDB continuous aggregates.
4. **CDC to an analytical store** (ClickHouse, Redshift, Snowflake, BigQuery) via Debezium/DMS for ad hoc, large scans: columnar engines are 10 to 100× faster for aggregations and isolate load completely.

Recommendation is usually 2 now and 4 when ad hoc analysis grows, because running analytic scans on the OLTP primary risks checkout latency, and row stores are inefficient for wide aggregations.

State SLOs: "dashboards fresh within 60 s, zero impact on primary p99".`,
  pts: [r`Clarify freshness and query shape`, r`Matviews / replicas first`, r`Rollups for counters`, r`CDC to columnar for ad hoc`, r`Protect OLTP latency`],
  ex: r`Ad hoc queries from a BI tool on the primary caused checkout p99 spikes; a CDC pipeline to ClickHouse gave sub-second dashboards and removed the spikes.`,
  fu: [r`How do you handle schema changes flowing through CDC?`],
  pit: [r`Pointing the BI tool at the primary.`] },

{ id: 'q48', level: 'Principal', tags: ['compliance', 'data-retention'],
  code: r`~~~sql
CREATE TABLE persons (person_id uuid PRIMARY KEY, full_name text, email text, address jsonb, erased_at timestamptz);
CREATE TABLE ledger_entries (id bigint PRIMARY KEY, person_id uuid NOT NULL, amount numeric(19,4), posted_at timestamptz)
  PARTITION BY RANGE (posted_at);
-- Erasure: pseudonymise PII, keep financial facts required by retention law
UPDATE persons SET full_name = NULL, email = NULL, address = NULL, erased_at = now() WHERE person_id = $1;
INSERT INTO erasure_log (person_id, requested_at, systems_confirmed) VALUES ($1, now(), ARRAY['pg','search','warehouse']);
-- Retention: drop partitions past the legal period (unless on legal hold)
ALTER TABLE ledger_entries DETACH PARTITION ledger_entries_2016_10 CONCURRENTLY; DROP TABLE ledger_entries_2016_10;
~~~`,
  q: r`How do you meet GDPR erasure and financial record-retention rules at the same time in PostgreSQL?`,
  a: r`The rules conflict: GDPR right to erasure versus multi-year retention for financial records (AML, tax). Resolve with legal input and design for both:

- **Classify data**: PII (name, email, address) vs financial facts (amounts, dates, account ids) vs legally retained identity data (KYC).
- **Separate PII** into its own tables keyed by a surrogate {{person_id}}; transactional tables reference the id only.
- **Erasure = pseudonymisation**: delete or overwrite the PII row (or destroy its per-subject encryption key, crypto-shredding), leaving financial records referring to an id that no longer resolves to a person, where retention law requires the record.
- **Retention**: partition by time and drop partitions past retention; legal hold flags block deletion.
- **Backups and replicas**: erasure must propagate; backups expire by policy, and a restore re-applies an erasure log.
- **Downstream copies** (CDC, warehouse, logs, search) get erasure events too.
- **Audit**: record that erasure happened without recording the erased data.`,
  pts: [r`Classify PII vs financial facts`, r`Separate PII tables`, r`Crypto-shredding`, r`Partition-based retention`, r`Propagate to backups and downstream`],
  ex: r`A bank implemented per-customer data keys; an erasure request destroyed the key, rendering PII in old backups unreadable while ledger entries stayed intact.`,
  fu: [r`How do you prove erasure to a regulator?`],
  pit: [r`Hard-deleting customers and breaking ledger referential integrity.`] },

{ id: 'q49', level: 'Principal', tags: ['code-review'],
  q: r`Code review: what is wrong with this .NET repository method against PostgreSQL?`,
  a: r`~~~csharp
public async Task<bool> ReserveStock(int productId, int qty)
{
    using var conn = new NpgsqlConnection(_cs);
    await conn.OpenAsync();
    await new NpgsqlCommand("SET app.tenant_id = '" + _tenant + "'", conn).ExecuteNonQueryAsync();
    var stock = (int)await new NpgsqlCommand(
        $"SELECT stock FROM products WHERE id = {productId}", conn).ExecuteScalarAsync();
    if (stock < qty) return false;
    await new NpgsqlCommand(
        $"UPDATE products SET stock = {stock - qty} WHERE id = {productId}", conn).ExecuteNonQueryAsync();
    return true;
}
~~~

Findings:

1. **Race (lost update)**: read then write with no transaction or lock; two requests both see 5 and both write 4. Use one atomic statement: {{UPDATE products SET stock = stock - @qty WHERE id = @id AND stock >= @qty}} and check rows affected.
2. **SQL injection** via concatenated {{_tenant}}; also string-interpolated SQL (even ints become a habit). Use parameters.
3. **Session-level SET** leaks tenant context across pooled connections (and breaks with PgBouncer transaction mode). Use {{set_config('app.tenant_id', @t, true)}} inside a transaction.
4. **New NpgsqlConnection per call with raw connection string** instead of a shared {{NpgsqlDataSource}}; commands not disposed.
5. No {{CancellationToken}}; no idempotency for retried reservations (pass a reservation id with a unique constraint).
6. Cast of {{ExecuteScalarAsync}} throws if the product does not exist.

~~~csharp
await using var cmd = _ds.CreateCommand(
  "UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1");
cmd.Parameters.Add(new() { Value = qty });
cmd.Parameters.Add(new() { Value = productId });
return await cmd.ExecuteNonQueryAsync(ct) == 1;
~~~`,
  pts: [r`Atomic conditional update`, r`Parameters, no concatenation`, r`set_config local, not session SET`, r`NpgsqlDataSource and disposal`, r`Idempotency and cancellation`],
  ex: r`This exact pattern oversold a limited product release by 300 units in the first minute.`,
  fu: [r`How would you write a concurrency test for this?`],
  pit: [r`Fixing only the injection and missing the race.`] },

{ id: 'q50', level: 'Principal', tags: ['strategy'],
  code: r`~~~yaml
# Per-database SLOs as code, owned by the product team, reviewed by the platform team
database: payments-pg
owner: team-payments
slos:
  availability: 99.95
  p99_query_ms: 50
  rpo_seconds: 5
  rto_minutes: 15
policies:
  major_version: "N-1 or newer"
  minor_patch_days: 30
  restore_test: weekly
  failover_drill: quarterly
~~~`,
  q: r`What does a PostgreSQL operating model look like at a Principal level: who owns what?`,
  a: r`Clear ownership prevents the two failure modes: a central DBA bottleneck, or teams running databases nobody understands.

| Concern | Owner |
|---|---|
| Platform (provisioning modules, parameter baselines, backup policy, monitoring, upgrades cadence) | Platform/DB reliability team |
| Schema, queries, indexes, data lifecycle | Owning product team |
| Incidents for a database | Owning team on call; platform team as escalation |
| Security baseline, audit, access reviews | Security with platform automation |
| Cost | Owning team, with platform showback dashboards |

Mechanisms: SLOs per database (availability, p99, RPO/RTO), quarterly restore and failover tests, an upgrade policy (stay within N-1 major versions, minor patches within 30 days), a decision record for exceptions (self-managed, extensions), and a learning loop (postmortems feed linting rules and paved-road defaults).

The Principal's role is to set the standards, build consensus across teams, fund the platform work, and measure outcomes, not to approve every index.`,
  pts: [r`Platform vs product ownership split`, r`SLOs including RPO/RTO`, r`Upgrade and patch policy`, r`Postmortems feed guardrails`, r`Principal sets standards, not approvals`],
  ex: r`Moving from a 3-person DBA approval queue to a paved road plus linting cut schema-change lead time from 9 days to under a day while incidents fell.`,
  fu: [r`How do you fund platform work against feature pressure?`],
  pit: [r`Answering only with technical settings and no ownership model.`] }
],
cheat: r`### MVCC
Update = new tuple; old one dead until VACUUM. Readers never block writers. Costs: bloat, index write amplification (unless HOT), xid wraparound (freeze).

### Vacuum health
Tune per-table scale factors. Blockers of the xmin horizon: long / idle-in-transaction sessions, stale replication slots, hot_standby_feedback, prepared xacts. Alert on age(datfrozenxid) > 1 B. pg_repack, never routine VACUUM FULL.

### Isolation
| Level | Note |
|---|---|
| READ COMMITTED (default) | Statement snapshot, like SQL Server RCSI |
| REPEATABLE READ | Snapshot isolation, 40001 on conflict |
| SERIALIZABLE | SSI, optimistic, retry whole txn |

### Indexes
B-tree (equality first, then range/sort), INCLUDE for index-only, partial, expression. GIN for jsonb/FTS/arrays, GiST for ranges/geo/EXCLUDE, BRIN for huge ordered tables. Always CREATE INDEX CONCURRENTLY.

### Connections
Process per connection. Peak at a few × cores. PgBouncer transaction mode: no session SET (use SET LOCAL / set_config(..., true)), xact advisory locks, prepared statements need 1.21+.

### Migrations
lock_timeout always. NOT VALID + VALIDATE. Expand/contract. Watch volatile defaults and type changes (rewrites).

### Replication and HA
Physical (HA, replicas) vs logical (upgrades, CDC). Slots retain WAL: max_slot_wal_keep_size + alerts. Patroni / CloudNativePG / RDS / Aurora. Read-your-writes via stickiness or LSN.

### Say this
"Vacuum can only clean behind the oldest snapshot." "MERGE is not a race-safe upsert; ON CONFLICT is." "Identity order is not commit order." "Fix the workload, scale up, replicas, split, then shard."`
});
})(String.raw);
