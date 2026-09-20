# SQL Server — Cram Sheet

> Tier 1 (highest frequency) · Source: `04-SQL-Server/` (14 files, 145 Q, 10,843 lines) · Read: 30 min · Drill: 5x

---

## 1. Indexing

- **Clustered index = the table itself.** B-tree whose *leaf level is the data pages*, physically ordered by the key. **One per table.**
- **Non-clustered index** = separate B-tree; leaf holds the key + a **row locator** (the clustered key, or a RID for a heap).
- **Composite index column order — the rule:** equality columns first, then range, then the rest. An index on `(A,B,C)` serves `A`, `A,B`, `A,B,C` — **not `B` alone**. (Left-most prefix rule.)
- **Covering index** = the index alone answers the query, no lookup. `INCLUDE` columns sit **only at the leaf**, are not sorted, don't count toward the 900-byte key limit → use INCLUDE for SELECT-list columns, key columns for WHERE/JOIN/ORDER BY.
- **Filtered index** — `WHERE IsActive = 1`. Smaller, cheaper to maintain. Wins when the predicate is highly selective and stable (e.g. soft-delete flags, status = 'Pending').
- **Selectivity** = distinct values ÷ total rows. High selectivity → seek. Low selectivity (e.g. `Gender`) → the optimizer ignores the index and scans. **~>30% of rows returned ⇒ a scan is genuinely cheaper.**
- **Fragmentation:** `REORGANIZE` < 30%, online, no big log growth. `REBUILD` ≥ 30%, updates stats, offline unless Enterprise `ONLINE = ON`.
- **When indexes hurt:** every index is a write tax (INSERT/UPDATE/DELETE must maintain it) + storage + backup time + lock/latch contention on hot ranges.

> **TRAP — "adding an index made it slower."** Causes: (a) write amplification on a write-heavy table; (b) the optimizer switched to a *worse* plan under the new statistics; (c) the new index's key order causes a hotspot; (d) it displaced a better plan from cache.
> **TRAP** — a monotonic clustered key (IDENTITY, timestamp) puts every insert on the **last page** → PAGELATCH contention. Mitigate with `OPTIMIZE_FOR_SEQUENTIAL_KEY`, hash partitioning, or a different key.

---

## 2. Execution Plans & Query Performance

- **Estimated** plan = optimizer's guess, no execution. **Actual** plan = with real row counts. **Compare estimated vs actual rows — a large skew is your #1 diagnostic signal** (bad statistics or a non-SARGable predicate).
- **Scan vs seek:** *table scan* = heap, all pages. *Index scan* = all leaf pages of an index. *Index seek* = B-tree navigation to specific rows. A scan is not automatically bad — it's correct for low-selectivity or small tables.
- **Key lookup (bookmark lookup)** — index found the row, but needs extra columns from the clustered index. Fix by **adding the missing columns via `INCLUDE`**. Expensive because it's a per-row random I/O.
- **Sort spill to tempdb** — the memory grant was too small because cardinality was underestimated. Fix: update stats, add a supporting index so the sort disappears, or reduce the row width.
- **Join operators:**
  | Join | Chosen when | Cost |
  |---|---|---|
  | **Nested loop** | small outer + indexed inner | O(n·log m); best for OLTP small sets |
  | **Merge** | both inputs sorted on the join key | O(n+m), needs sorted input |
  | **Hash** | large, unsorted, no useful index | builds hash table; needs a memory grant, can spill |
- **Cardinality estimation** uses statistics histograms. It goes wrong with: stale stats, skewed data, table variables (assumed 1 row pre-2019), multi-column correlation, local variables, and non-SARGable predicates.
- **Parameter sniffing** — SQL Server caches a plan built for the *first* parameter value. Great for that value, terrible for a skewed one. **Fixes:** `OPTIMIZE FOR UNKNOWN`, `RECOMPILE`, branch into separate procs, Query Store plan forcing, or fix the underlying skew. (SQL 2022 **Parameter Sensitive Plan optimization** does this automatically.)
- **Plan cache pollution** — unparameterised ad-hoc SQL creates one plan per literal. Fix: parameterise, `OPTIMIZE FOR AD HOC WORKLOADS`, forced parameterisation.
- **SARGable** = the predicate can use an index seek. **Broken by:**
  - `WHERE YEAR(OrderDate) = 2024` → use a range: `>= '2024-01-01' AND < '2025-01-01'`
  - `WHERE Col * 2 = 100` → `WHERE Col = 50`
  - `WHERE LEFT(Name,3) = 'ABC'` → `WHERE Name LIKE 'ABC%'`
  - `LIKE '%abc'` — leading wildcard, never seekable → full-text index
  - **Implicit conversion** — `NVARCHAR` parameter against a `VARCHAR` column. Silent, very common, shows as `CONVERT_IMPLICIT` in the plan.
- **OR** conditions often prevent index use → rewrite as `UNION ALL` of two seekable queries.
- **Pagination:** `OFFSET/FETCH` degrades linearly (it still reads and discards). For deep pages use **keyset / seek pagination**: `WHERE (SortKey, Id) > (@lastKey, @lastId) ORDER BY SortKey, Id`.

---

## 3. Transactions · Isolation · Locking

**ACID in SQL Server:** Atomicity = transaction log + rollback · Consistency = constraints · Isolation = locks/row-versioning · Durability = **WAL (write-ahead logging)**, log flushed before commit acknowledges.

| Isolation level | Dirty read | Non-repeatable | Phantom | Mechanism |
|---|---|---|---|---|
| READ UNCOMMITTED | ✔ | ✔ | ✔ | no shared locks (= `NOLOCK`) |
| **READ COMMITTED** *(default)* | ✖ | ✔ | ✔ | short shared locks |
| **READ COMMITTED SNAPSHOT (RCSI)** | ✖ | ✔ | ✔ | **row versions in tempdb, readers never block** |
| REPEATABLE READ | ✖ | ✖ | ✔ | holds shared locks to commit |
| SERIALIZABLE | ✖ | ✖ | ✖ | key-range locks |
| **SNAPSHOT** | ✖ | ✖ | ✖ | transaction-level versioning; **update conflict → error 3960** |

- **RCSI vs SNAPSHOT:** RCSI is a *database* option giving statement-level consistency, near drop-in, readers don't block writers. SNAPSHOT is a *transaction-level* consistent view and can fail with an update conflict. **Both cost tempdb** and add a 14-byte row version tag.
- **`NOLOCK` is not "no locking" — it's READ UNCOMMITTED**: dirty reads, plus rows read **twice or skipped entirely** during page splits. Never acceptable on financial reads.
- **Lock modes:** S (shared) · X (exclusive) · U (update, prevents conversion deadlocks) · IS/IX (intent, at higher granularity). Compatibility: S+S ✔, S+X ✖, X+X ✖.
- **Lock escalation:** row/page → **table** at **~5,000 locks** in one statement. Control with `ALTER TABLE ... SET (LOCK_ESCALATION = DISABLE|AUTO)` or batch your DML into chunks.
- **Deadlock:** circular wait. SQL Server's monitor runs **every ~5 seconds**, picks the **cheapest transaction to roll back** as victim (error **1205**). Read the deadlock graph from Extended Events / `system_health`. **Fixes:** consistent object access order, shorter transactions, covering indexes (shorter lock duration), RCSI, `UPDLOCK` hints.
- **Blocking triage order:** `sys.dm_exec_requests` (blocking_session_id) → `sys.dm_os_waiting_tasks` → `sys.dm_tran_locks` → get the blocker's SQL text → check for an open uncommitted transaction / a chatty client / a missing index.
- **Optimistic vs pessimistic:** optimistic = `rowversion`/`ROWVERSION` column checked on update, 0 rows affected ⇒ conflict. Pessimistic = `UPDLOCK, HOLDLOCK` at read time. Optimistic wins under low contention; pessimistic under high contention with short transactions.
- **"Too long" transaction** = holds locks and pins the log. It blocks log truncation, grows tempdb version store, and widens the blocking-chain window. **Never** put a user prompt, an HTTP call, or a message publish inside a transaction.

---

## 4. SQL Fundamentals

**Logical processing order (not written order) — quote this:**
`FROM → ON → JOIN → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → OFFSET/FETCH`

That is *why*: you cannot use a `SELECT` alias in `WHERE` (SELECT hasn't run), but you *can* in `ORDER BY`.

- **`WHERE` filters rows before grouping; `HAVING` filters groups after.** `HAVING` exists because aggregates don't exist until after `GROUP BY`.
- **NULL = three-valued logic.** `NULL = NULL` is **UNKNOWN**, not true. Use `IS NULL`. `NOT IN (subquery containing NULL)` returns **no rows** — the classic trap; use `NOT EXISTS`.
- Aggregates **ignore NULLs** — except `COUNT(*)`.
  - `COUNT(*)` = all rows · `COUNT(col)` = non-NULL values · `COUNT(DISTINCT col)` = distinct non-NULL.
  - `AVG(col)` divides by the **non-NULL count**, so NULL ≠ 0.
- **`ISNULL` vs `COALESCE`:** `ISNULL` is T-SQL, 2 args, takes the **first argument's type** (silent truncation risk). `COALESCE` is ANSI, N args, uses datatype precedence, and **evaluates its arguments more than once** (bad with subqueries). `NULLIF(a,b)` → NULL when equal (divide-by-zero guard).
- **`DISTINCT` vs `GROUP BY`**: equivalent for plain dedupe; `GROUP BY` is required once you aggregate.
- **Date gotchas:** `BETWEEN '2024-01-01' AND '2024-01-31'` **misses 31 Jan after 00:00:00** → use `>= start AND < nextDay`. `GETDATE()` is non-deterministic (kills index use on computed columns).

---

## 5. JOINs

- `INNER` = matches only · `LEFT` = all left + matched right · `FULL OUTER` = both sides · `CROSS` = Cartesian (legit for calendar tables, test-data generation, matrix reports).
- **RIGHT JOIN is rare** because reordering the FROM clause reads better; it's a style preference, not a capability difference.
- **The LEFT JOIN trap:** a filter on the right table in `WHERE` **silently converts it to an INNER JOIN**. Put it in the `ON` clause instead.
- **`JOIN` vs `EXISTS`:** `EXISTS` short-circuits on the first match and **cannot duplicate rows**; a JOIN to a non-unique side **multiplies rows**. Use `EXISTS` for pure existence checks.
- **`NOT IN` vs `NOT EXISTS`:** if the subquery yields a single NULL, `NOT IN` returns **zero rows**. `NOT EXISTS` is NULL-safe. **Always prefer `NOT EXISTS`.**
- **Anti-join** (find unmatched): `LEFT JOIN ... WHERE r.Id IS NULL`, or `NOT EXISTS`.
- **Self join**: employee/manager — `FROM Emp e LEFT JOIN Emp m ON e.ManagerId = m.Id`.

---

## 6. Subqueries & CTEs

- **Correlated subquery** runs per outer row → usually rewrite as a JOIN or `APPLY`. (`CROSS APPLY` ≈ inner join to a correlated table expression; `OUTER APPLY` ≈ left join. The idiomatic tool for top-N-per-group.)
- **CTE = readability, not materialization.** **The "a CTE is materialized" claim is a myth** in SQL Server — it is inlined into the plan and a CTE referenced twice is **evaluated twice**. If you need materialization, use a `#temp` table.
- **CTE vs temp table vs table variable:**
  | | Stats | Indexes | Use when |
  |---|---|---|---|
  | CTE | inherits | none | readability, single reference, recursion |
  | `#temp` | **yes** | yes | large intermediate sets, reused multiple times |
  | `@table` | no (1-row guess pre-2019) | PK only | small, known-tiny sets |
- **Recursive CTE:** anchor `UNION ALL` recursive member; default recursion limit **100** — set `OPTION (MAXRECURSION n)`, `0` = unlimited (risk of infinite loop).

---

## 7. Window Functions

- `func() OVER (PARTITION BY ... ORDER BY ... ROWS/RANGE ...)` — aggregates **without collapsing rows**. That is the difference from `GROUP BY`.

| | Ties | Gaps |
|---|---|---|
| `ROW_NUMBER()` | arbitrary distinct numbers | no |
| `RANK()` | same rank | **skips** (1,1,3) |
| `DENSE_RANK()` | same rank | no gap (1,1,2) |

- `LAG()/LEAD(col, n, default)` — previous/next row. The tool for month-over-month, streaks, and deltas.
- **`ROWS` vs `RANGE` — high-value trap:** the default frame with `ORDER BY` is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, which includes **all peer rows with an equal ORDER BY value**. For a true row-by-row running total use **`ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`** — it is also faster (no on-disk spool).
- `LAST_VALUE()` looks wrong by default for the same reason — the frame ends at the current row. Fix: `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`.
- **N-day moving average:** `AVG(x) OVER (ORDER BY d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)`.
- Window function beats a cursor/while-loop for running totals by orders of magnitude — a single pass vs row-by-row (RBAR).

---

## 8. The Classic Query Patterns (memorise the shapes)

```sql
-- Nth highest (dedup-safe)
SELECT DISTINCT Salary FROM Emp ORDER BY Salary DESC OFFSET @N-1 ROWS FETCH NEXT 1 ROWS ONLY;
-- or: WHERE rnk = @N  using DENSE_RANK()

-- Top-1 / Top-N per group
WITH x AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY DeptId ORDER BY Salary DESC) rn FROM Emp)
SELECT * FROM x WHERE rn = 1;          -- rn <= 3 for top 3

-- Find duplicates
SELECT Email, COUNT(*) FROM Users GROUP BY Email HAVING COUNT(*) > 1;

-- Delete duplicates, keep one
WITH x AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY Email ORDER BY Id) rn FROM Users)
DELETE FROM x WHERE rn > 1;            -- deleting through a CTE is legal and expected

-- Latest row per customer  (also: CROSS APPLY ... TOP 1)
WITH x AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY CustId ORDER BY CreatedAt DESC) rn FROM Orders)
SELECT * FROM x WHERE rn = 1;

-- Gaps and islands (consecutive dates / login streaks)
SELECT UserId, MIN(d) AS StartD, MAX(d) AS EndD, COUNT(*) AS StreakLen
FROM (SELECT UserId, d, DATEADD(DAY, -ROW_NUMBER() OVER (PARTITION BY UserId ORDER BY d), d) AS grp
      FROM Logins) t
GROUP BY UserId, grp;                  -- constant grp == consecutive run

-- Month-over-month growth
SELECT m, tot, LAG(tot) OVER (ORDER BY m) AS prev,
       (tot - LAG(tot) OVER (ORDER BY m)) * 100.0 / NULLIF(LAG(tot) OVER (ORDER BY m),0) AS pct
FROM MonthlyTotals;

-- Running total (note ROWS, not RANGE)
SUM(Amount) OVER (PARTITION BY AcctId ORDER BY TxnDate ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
```

---

## 9. Production Troubleshooting Playbook

| Symptom | First checks |
|---|---|
| **Query slow after deploy** | plan change? Query Store → compare plans, force the good one. Then stats, then schema/index change. |
| **CPU 95%** | `sys.dm_exec_query_stats` ORDER BY `total_worker_time` → top CPU plans · missing index → scans · excessive parallelism (tune **MAXDOP** + **Cost Threshold for Parallelism**, default 5 is far too low; use 50) · implicit conversions. |
| **Blocking rising** | `dm_exec_requests.blocking_session_id` → head blocker → its SQL + open transaction → long transaction, missing index, or lock escalation. |
| **Deadlocks every few minutes** | `system_health` XE ring buffer → deadlock graph → identify the two access orders → enforce a consistent order; consider RCSI. |
| **Seek became a scan** | stale statistics, parameter sniffing, data growth crossing the tipping point, an implicit conversion introduced by a client-library change. |
| **Fast in SSMS, slow from app** | **different SET options** (ARITHABORT ON in SSMS, OFF by default in ADO.NET) → *a different cached plan*. Also implicit conversion from `NVARCHAR` parameters. **This is the single most-asked SQL trick question.** |
| **CPU idle but slow** | it's waits, not CPU: `sys.dm_os_wait_stats` → `PAGEIOLATCH_*` (disk), `WRITELOG` (log latency), `LCK_M_*` (blocking), `RESOURCE_SEMAPHORE` (memory grants), `ASYNC_NETWORK_IO` (**slow client consumption**, not the server). |
| **Connections exhausted** | pool size (default 100), connection leaks (undisposed), long transactions, `sys.dm_exec_sessions` by host/program. |
| **500M-row table** | partition by date, columnstore for analytics, archive cold data, keyset pagination, filtered indexes, batched DML. |

---

## 10. Database Design

- **Normalization:** 1NF atomic values, no repeating groups → 2NF no partial dependency on part of a composite key → 3NF no transitive dependency (non-key → non-key) → BCNF every determinant is a candidate key.
- **Denormalize deliberately** for read-heavy reporting, expensive repeated joins, or precomputed aggregates — and then own the **consistency cost** (triggers, jobs, or event-driven refresh).
- **Keys:** surrogate (IDENTITY / sequence) = stable, narrow, no business meaning. Natural = meaningful but changes. **Use a surrogate PK + a unique constraint on the natural key.** Avoid a random `GUID` as the *clustered* key (page splits) — SQL Server sorts `uniqueidentifier` by its **last bytes**, so sequential-GUID schemes must match that.
- **Referential actions:** `CASCADE` (dangerous at depth — silent mass deletes), `SET NULL`, `NO ACTION` (default, safest). In high-volume systems many teams enforce in the app + keep `NO ACTION`.
- **Partitioning** (one database, one instance, partition function + scheme on a filegroup) gives **partition elimination** and near-instant **`SWITCH`** for load/archive. **Sharding** spreads across *separate databases/servers* for capacity — needs application-level routing, and cross-shard queries and transactions become your problem.
- **HA:** Always On AG (synchronous = zero data loss, higher commit latency; asynchronous = possible loss, lower latency), readable secondaries (watch **read staleness** and version-store growth), transactional replication (object-level, more fragile).
- **Temporal tables** (`SYSTEM_VERSIONING = ON`) vs audit triggers: temporal is declarative, engine-maintained, `FOR SYSTEM_TIME AS OF` queries — but records *what changed*, not *who/why*. Triggers capture user/context but are hand-maintained and easy to bypass. Financial audit usually needs both.
- **Soft delete:** add `IsDeleted` + a **filtered unique index** and remember every query must filter it (a global query filter in EF Core). **Multi-tenant:** shared schema + `TenantId` on every table + row-level security, vs database-per-tenant (isolation, cost, noisy-neighbour trade-off).

---

## 11. SQL Server & Microservices

- **Database per service** — the coupling you remove is schema coupling; the cost is no cross-service joins, no cross-service FKs, no distributed transactions, N backup/patch/HA estates, and reporting must be solved separately.
- **Shared database breaks:** independent deployability, schema evolution (any change is a multi-team negotiation), failure isolation, and per-service scaling.
- **Avoid 2PC/MSDTC:** it is a blocking protocol — the coordinator holds locks across services; if it dies in-doubt transactions hold locks indefinitely. Availability is the product of all participants. Use **Saga + compensation** instead.
- **Transactional Outbox:** write the business row **and** an `Outbox` row **in one local transaction**; a relay polls/CDCs the outbox and publishes, marking sent. This is what makes "save and publish" atomic without 2PC. Consumers must be idempotent (at-least-once).
- **CDC** reads the **transaction log** (low overhead, no schema change, async) vs Change Tracking (lightweight, only tells you *that* a row changed) vs triggers (synchronous, adds write latency).
- **Database-layer idempotency:** a unique constraint on the idempotency/business key; catch **error 2627/2601** and treat it as a successful duplicate.
- **CQRS read model** on SQL Server: write model normalized, read model denormalized, updated via outbox/CDC events → **staleness window** you must name and bound (e.g. p99 < 2s) and expose in the UI.
- **Reconciliation** when drift happens: compare by business key with a `FULL OUTER JOIN`, classify breaks into auto-fixable / manual / investigate, and replay from the event log.

---

## 12. FinTech / Payments SQL

- **`DECIMAL(19,4)` — never `FLOAT`/`REAL`** for money. Binary floating point cannot represent 0.1 exactly; errors accumulate and fail audit. Store the **currency code** alongside, and store the **minor-unit scale** per currency (JPY has 0 decimals).
- **Payment status lifecycle** — model explicitly and make it **append-only**: `NOT_STARTED → EXECUTING → SUCCESS | FAILED`. Never mutate or delete a financial row; write a new row (reversal/compensation) and let the current state be derived.
- **Double-entry ledger:** every transaction writes ≥ 2 `LedgerEntry` rows sharing a `TransactionId`, with debits and credits. **Enforce debits = credits** in a single transaction plus a nightly assertion query (`SUM(Amount) GROUP BY TransactionId HAVING SUM(Amount) <> 0`). A CHECK constraint cannot span rows.
- **Balance: stored or derived?** Derived (`SUM` of entries) is always correct but slows as history grows. **Answer: a stored balance as a cached projection, plus the ledger as the source of truth, reconciled by a scheduled assertion** — update it in the *same* transaction as the entries, with `rowversion`/`UPDLOCK` to serialise concurrent updates.
- **Duplicate payment detection without an idempotency key:** match on `(CustomerId, Amount, MerchantId)` within a short time window; flag rather than auto-reject, and feed it to manual review.
- **Reconciliation against a settlement file:** load into a staging table, `FULL OUTER JOIN` on the external reference, classify — *matched*, *in-us-not-them*, *in-them-not-us*, *amount mismatch*. Reconciliation is required **even when the provider claims idempotency**.
- **Audit/SOX/PCI:** append-only, no UPDATE/DELETE grants on the ledger, temporal tables or an immutable audit table, capture actor + timestamp + reason, retention policy, separation of duties, and **never store a PAN** — tokenise.

---

## Top 15 traps

1. `NOT IN` with a NULL → zero rows. Use `NOT EXISTS`.
2. `RANGE` (default) vs `ROWS` in a running total.
3. `BETWEEN` on datetime misses the last day.
4. LEFT JOIN + right-table filter in `WHERE` = INNER JOIN.
5. `NOLOCK` = dirty reads, plus rows read twice or skipped.
6. Non-SARGable `YEAR(col) =` / `LEFT(col,n) =` / leading `%`.
7. Implicit conversion `NVARCHAR` param vs `VARCHAR` column.
8. Fast in SSMS, slow in app = **ARITHABORT** / different cached plan.
9. "CTE is materialized" — it is not.
10. `FLOAT` for money.
11. Lock escalation at ~5,000 locks.
12. Composite index left-most prefix.
13. `COUNT(col)` skips NULLs; `AVG` divides by non-NULL count.
14. `OFFSET/FETCH` for deep pagination.
15. Cost Threshold for Parallelism left at the default 5.

---

## Interview Q&A — Lead / Principal

**Answer frame:** headline → mechanism → trade-off + threshold → failure mode **and how you'd know** → *(Principal)* should it exist / who owns it.

### Q1 · The query that got slow after a deploy *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"A query that ran in 200ms now takes 40 seconds. The code didn't change. Go."*

**Answer.** Code didn't change, so I start with what did: the **plan**, the **statistics**, or the **data volume**. Query Store is fastest — plan history per query, so I can see whether a new plan compiled and compare actual vs estimated rows on both. A large estimated/actual skew says it's cardinality: stale statistics, data growth crossing a tipping point, or parameter sniffing on an unrepresentative value. If a good plan exists in history, **forcing it is the immediate mitigation** — stops the bleeding in seconds — and I'd say explicitly it's a stopgap that must be unwound, because a forced plan hides the cause and eventually becomes wrong itself.

Then root cause. Stale stats: update them, and ask why auto-update didn't fire — on a large table the default ~20%-change threshold means it can grow a long way before refreshing. Sniffing: see Q2. A deploy that added an index can push the optimizer to a worse plan on new statistics — the "we added an index and it got slower" case. Prevention is Query Store regression alerting, so the next one pages us instead of a customer.

**Why it lands.** Plan-history first, mitigation separated from remediation, and names why auto-stats didn't save you.
**✗ Weak answer.** "Rebuild all the indexes" — sometimes works by accident (it updates stats) and teaches nothing.
**↳ Follow-ups.** What's the auto-stats threshold on a 500M-row table? When would you *not* force a plan?

---

### Q2 · Parameter sniffing *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"Same stored procedure. Fast for customer A, 30 seconds for customer B. Why?"*

**Answer.** Parameter sniffing. SQL Server compiles and caches a plan using the **first** parameter value it sees and reuses it. If customer A has 10 orders, the optimizer picks a nested-loop seek — correct for A, catastrophic for customer B with two million, where a hash join and scan would win. Confirm by comparing estimated vs actual rows on the slow case: estimates will look like A's data.

The fix depends on workload, and saying *which and why* is the whole question. `OPTION (RECOMPILE)` when compilation is cheap relative to execution and skew is severe — you pay CPU per call for a correct plan. `OPTIMIZE FOR UNKNOWN` for one stable average plan, accepting it's mediocre for both. **Separate procedures** when the data is genuinely bimodal — a big-customer path and a small-customer path. Query Store plan forcing as a surgical fix for one known-bad case. On SQL Server 2022, **Parameter Sensitive Plan optimization** caches multiple plans per parameter bucket and handles the common case. And the structural answer underneath: the real problem is data skew, so if one tenant is 1000× the others that may be a partitioning or isolation decision, not a query-tuning one.

**Why it lands.** Four fixes with the condition selecting each, 2022 PSP, then escalates to the skew.
**✗ Weak answer.** "Add `WITH RECOMPILE`" as a reflex with no cost discussion.
**↳ Follow-ups.** What does RECOMPILE cost at 10,000 calls/sec? How do you detect this proactively?

---

### Q3 · Fast in SSMS, slow from the application *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"100ms in SSMS, 30 seconds from the app. Same server, same parameters."*

**Answer.** The classic. **Different SET options produce a different cached plan** — SSMS sets `ARITHABORT ON`, ADO.NET leaves it OFF, and plans are cached per SET-option set. So there are genuinely two plans, and the app's was compiled for a bad parameter — parameter sniffing wearing a disguise. Confirm by querying the plan cache for both and comparing.

The wrong fix is setting `ARITHABORT ON` in the connection string: it hands the app SSMS's plan, the symptom vanishes, and it comes back. Fix the sniffing.

The second cause, more insidious, is an **implicit conversion**: an `NVARCHAR` parameter from .NET against a `VARCHAR` column. EF and ADO.NET default strings to `NVARCHAR`, the conversion lands on the *column*, and the predicate stops being SARGable — scan from the app, seek from SSMS where you typed a literal. Shows as `CONVERT_IMPLICIT` in the plan. Fix is `IsUnicode(false)` in the EF mapping or an explicit `DbType`. Very common, almost never guessed.

**Why it lands.** Names both causes, says why the obvious fix is wrong, and the implicit-conversion detail is a strong differentiator.
**✗ Weak answer.** "Add ARITHABORT to the connection string."
**↳ Follow-ups.** How do you find implicit conversions across the whole workload? Why does the conversion go on the column?

---

### Q4 · Recurring deadlocks *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Error 1205 a few times an hour in the payments service. Retry logic handles it. Acceptable?"*

**Answer.** Retry is correct *immediate* handling — deadlock victims are by definition safe to retry — but treating it as the solution is wrong, because deadlock rate rises super-linearly with load, so "a few an hour" becomes an incident at 3× traffic. I'd pull the deadlock graph from the `system_health` Extended Events session — on by default, nobody looks at it — and read the two resource lists to find the **inconsistent access order**, almost always two code paths touching the same two tables in opposite order.

Fixes in order: enforce consistent object access order across the codebase (the real fix); shorten transactions to narrow the window; add a covering index so locks are held over fewer rows for less time; consider **RCSI** so readers stop blocking writers entirely, removing a whole class of these at the cost of tempdb version-store pressure. For update-then-read, `UPDLOCK` at read time converts a deadlock into a block — strictly better.

The bit I'd add: in payments a retried transaction must be **idempotent**, or the retry that "handles" the deadlock is how you double-charge. I'd check that before declaring the retry safe.

**Why it lands.** Accepts the retry, explains why it's insufficient, names `system_health`, connects back to payment idempotency.
**✗ Weak answer.** "Raise the deadlock priority" or "add `NOLOCK`."
**↳ Follow-ups.** What does the deadlock graph actually show? What does RCSI cost?

---

### Q5 · Blocking and lock escalation *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"A nightly batch job blocks the entire application for 20 minutes. Fix it."*

**Answer.** Almost certainly **lock escalation**: SQL Server converts row/page locks to a **table** lock at around **5,000 locks in one statement**, so a large batch `UPDATE`/`DELETE` that starts fine-grained ends holding an exclusive table lock and everything queues behind it. Confirm via `sys.dm_tran_locks` showing an OBJECT-level X lock, and `dm_exec_requests.blocking_session_id` to walk to the head blocker.

Fix is **batching** — chunk the DML into loops of a few thousand rows with a commit between, so locks release regularly and other work interleaves. Better than disabling escalation with `LOCK_ESCALATION = DISABLE`, which trades a table lock for enormous lock-memory consumption. For deleting most of a table, partition switching is dramatically better — a metadata operation rather than row-by-row.

The design point: it holds locks for 20 minutes because it's one transaction, and a long transaction also pins the log and prevents truncation. Nothing running 20 minutes should be a single transaction. And I'd ask whether it needs to touch the OLTP tables at all, or belongs against a replica or a reporting store.

**Why it lands.** Gives the threshold, the confirming DMVs, batching over disabling escalation, then questions the design.
**✗ Weak answer.** "Run it at a quieter time" — moves the problem.
**↳ Follow-ups.** What batch size and why? What does a long transaction do to the log? When is partition switch right?

---

### Q6 · Would you approve this index? *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"A PR adds four indexes to the orders table to fix a slow report. Approve?"*

**Answer.** Not as written. Every index is a **write tax** — each INSERT/UPDATE/DELETE maintains it — plus storage, backup time and more pages competing for memory. On the highest-write table in the system, four indexes for one report is the wrong trade. I'd want the execution plan showing the benefit, the write volume on that table, and whether one **covering** index with `INCLUDE` serves the query instead of four. Column order is usually wrong in these PRs — equality first, then range, and the leftmost-prefix rule means `(A,B,C)` serves `A` and `A,B` but **not `B` alone**, so people add indexes an existing one already covers. I'd check `sys.dm_db_index_usage_stats` for unread indexes and propose dropping some in the same change.

The bigger question is whether a report should drive index decisions on an OLTP table at all. If it's recurring, the answer is a read replica or a reporting projection, not more indexes.

**Why it lands.** Quantifies the cost, proposes consolidation, names leftmost-prefix redundancy, escalates to architecture.
**✗ Weak answer.** Approving because it's faster, or rejecting with "indexes slow writes" and no numbers.
**↳ Follow-ups.** Why can adding an index make the *application* slower? INCLUDE vs key columns?

---

### Q7 · Isolation level for a payments database *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"What isolation level would you run a payments database at, and why?"*

**Answer.** `READ COMMITTED` with **`READ_COMMITTED_SNAPSHOT` on**. Reasoning: under plain read-committed, readers take shared locks and block writers, so reporting and UI reads create contention on the write path — in payments that's the path that must never stall. RCSI uses row versioning so **readers never block writers and writers never block readers**, a near-drop-in change removing the largest source of blocking. Cost is tempdb version-store pressure and 14 bytes per row, both needing monitoring and capacity.

Then the important part: isolation level is *not* how you protect a balance. RCSI still allows non-repeatable reads, so anything reading a balance then writing based on it needs an explicit guard — optimistic concurrency with a `rowversion` checked on update, or `UPDLOCK, HOLDLOCK` at read time to serialise. **The invariant is enforced by the write, not by the isolation level** — that separation is what the question tests. I'd reserve `SERIALIZABLE` for narrow operations where a genuine phantom breaks an invariant, and never allow `NOLOCK` on financial reads.

**Why it lands.** Recommends with the cost, then separates isolation from invariant enforcement — the Principal signal.
**✗ Weak answer.** "SERIALIZABLE, because it's finance" — correct-sounding, would destroy throughput.
**↳ Follow-ups.** RCSI vs SNAPSHOT? What's error 3960? How do you size tempdb for this?

---

### Q8 · Someone wants `NOLOCK` *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"A senior developer is adding `WITH (NOLOCK)` across reporting queries to reduce blocking. How do you respond?"*

**Answer.** I'd push back on evidence rather than authority, because they're solving a real problem. `NOLOCK` is `READ UNCOMMITTED` — the name misleads; it's not "no locking overhead," it's "read uncommitted data." Beyond dirty reads, the part most people don't know is that during a page split an allocation-order scan can return the **same row twice or miss it entirely**, so a report total can be wrong in a way that's unreproducible and unexplainable. In a regulated environment that's a finding, not a preference.

The constructive response: their complaint is valid — reads *are* blocking — and **RCSI gives them what they actually want**, non-blocking reads with a consistent point-in-time view and no correctness loss. So the answer isn't "no," it's "let's enable RCSI and measure the tempdb impact." If they still want NOLOCK after that, the remaining case is genuinely approximate dashboards where being stale and occasionally wrong is acceptable — and I'd want that documented rather than spread through the codebase as a hint.

**Why it lands.** Names the duplicate/missed-row behaviour, not just dirty reads, and redirects to the fix that meets their real need — disagreeing without dismissing.
**✗ Weak answer.** "NOLOCK is bad, never use it" — true-ish, and loses the room.
**↳ Follow-ups.** What does RCSI cost? Is there any query where you'd accept NOLOCK?

---

### Q9 · Design a ledger *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"Design the data model for an account balance system. We're a payments company."*

**Answer.** **Append-only double-entry**, derived rather than asserted. The naive model is a `balance` column you update — loses history, can't answer "why is this balance what it is," can't be audited, and makes concurrent updates a lock contention point on the hottest row in the system. Instead: every transaction writes **at least two `LedgerEntry` rows** sharing a `TransactionId`, debits and credits, summing to zero. Nothing is ever updated or deleted — a correction is a **new reversing entry**, always forward. Complete audit trail by construction, not as an add-on.

Concretely: amounts as **`DECIMAL(19,4)`, never float** — binary floating point can't represent 0.1 and errors accumulate until they fail audit — with a currency code and its minor-unit scale stored alongside, because JPY has zero decimals. Status lifecycles explicit and append-only. Debits-equals-credits can't be a CHECK constraint because it spans rows, so it's enforced inside the transaction plus a **scheduled assertion** grouping by `TransactionId` and alarming on any non-zero sum.

On balance: derived is always correct but degrades as history grows; stored is fast but drifts. Honest answer is **both** — a stored balance as a cached projection updated in the same transaction as the entries, ledger as source of truth, reconciliation proving they agree. Concurrency on a hot account handled with `rowversion` or `UPDLOCK`, not hope.

Permissions: `INSERT` only, no `UPDATE`/`DELETE` grant to the application identity at all — immutability enforced by the database, not by discipline. And daily reconciliation against the provider's settlement file regardless, because their view is authoritative.

**Why it lands.** Derives double-entry, names DECIMAL and *why*, gives the cross-row-invariant workaround, resolves stored-vs-derived with "both plus reconciliation," and revokes UPDATE at the database.
**✗ Weak answer.** A `balance` column with a mutex, or double-entry recited with no invariant enforcement.
**↳ Follow-ups.** How do you prove a historical balance to a regulator? How do you migrate a live `balance` column? What if a reversal itself fails?

---

### Q10 · Reconciliation against an external file *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"Your ledger says £4.2m settled yesterday. The provider's file says £4.198m. What now?"*

**Answer.** First: this is expected, not exceptional — a reconciliation that never finds breaks isn't working, and I'd be more worried by a perfect match. Load the file to staging, `FULL OUTER JOIN` on the external reference, and **classify every break** into four buckets: in-us-not-them, in-them-not-us, amount mismatch, status mismatch. Then triage into auto-fixable (timing — settled either side of the cut-off, resolves next cycle), manual (a known fee or FX-rounding rule), and investigate (genuinely unexplained).

The operational design matters more than the query: breaks need an **owner, an ageing SLA, and an alarm on the *unexplained* count specifically** — not total break count, which is always non-zero and therefore ignored. Ageing past SLA escalates. The number that matters is unexplained breaks trending, not today's absolute figure.

**Reconciliation is required even when the provider claims idempotency**, because their view is authoritative and our correctness doesn't cross the boundary. The failure with no detector: a break auto-classified as timing that silently never resolves — so track re-occurrence of the same reference across cycles.

**Why it lands.** Normalises breaks, gives the classification, designs the operational loop, names the undetected failure.
**✗ Weak answer.** "Write a query to find the differences" — that's 10% of the answer.
**↳ Follow-ups.** What if the file is late? How do you reconcile when you don't know the outcome at all?

---

### Q11 · Table with 500 million rows *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Queries against our transactions table have degraded as it grew to 500 million rows. Options?"*

**Answer.** Cheapest first. **Indexing and query tuning** — almost always the real fix, and I want the plans before anything structural. **Keyset pagination** instead of `OFFSET`, because `OFFSET 100000` still reads and discards 100,000 rows, so deep pages degrade linearly. **Archival** — most 500M-row transaction tables are 95% cold data nobody queries, so moving anything past the retention requirement to an archive or cold storage is the highest-leverage change and often the only one needed.

Then structural: **partitioning by date** for partition elimination and near-instant `SWITCH`-based archival. **Columnstore** for the analytical queries specifically if reporting is the pain. Only then **sharding**, and explicitly as a last resort, because it costs cross-shard joins, cross-shard transactions, global uniqueness and global ordering — all of which become application problems.

First question I'd actually ask is *which* queries degraded, because "the table is big" is rarely the cause — a well-indexed 500M-row table serves point lookups fine. If everything degraded, I'd suspect the buffer pool no longer holds the working set, which is a memory problem, not a row-count one.

**Why it lands.** Ordered by cost, names archival as the usual answer, challenges the premise with the working-set observation.
**✗ Weak answer.** Jumping to sharding or "move to NoSQL."
**↳ Follow-ups.** How does partition switching work? What breaks when you shard? How do you archive without downtime?

---

### Q12 · Read replica lag *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"We moved reads to a replica and now users intermittently don't see their own updates. Fix it."*

**Answer.** Replication is asynchronous, so read-your-own-writes is broken by construction — the write went to the primary, the read hit a replica that hadn't caught up. The wrong fix is routing everything back to the primary, discarding the benefit.

Options, chosen by scope: **route reads to the primary for a short window after a write** by that session — simple, effective, costs you only the seconds after a mutation. **Return the updated resource from the write** so the UI doesn't re-read at all — usually cleanest, removes a round trip. **Version/LSN tokens** — the write returns a position, the read waits for the replica to reach it — correct but more machinery. Or **design the interaction** so it doesn't need immediacy, sometimes the honest answer.

Framing: replica lag isn't a latency detail, it's a **consistency boundary**, so the decision is per-read-path, not global. A dashboard can be seconds stale; "did my payment go through" cannot. I'd classify read paths explicitly, route accordingly, and **alert on lag** — because the failure mode is lag growing quietly until it's minutes and nobody notices.

**Why it lands.** Four options with selection criteria, plus the "consistency boundary, decided per path" framing.
**✗ Weak answer.** "Read from the primary" — undoes the change.
**↳ Follow-ups.** What's an acceptable lag SLO? What happens during failover?

---

### Q13 · Migrating a live `balance` column to a ledger *(Principal)* ⭐⭐⭐
**Asked as:** *"We have a `balance` column in production. You want a ledger. How do you get there without downtime or a discrepancy?"*

**Answer.** Parallel-run with reconciliation, over months, not a cutover. **Backfill** first: derive historical entries from whatever history exists — transaction logs, audit tables — and be explicit that backfill-derived history is a **reconstruction, not a record**, so it's weaker evidence than entries captured live. I'd mark those entries as derived so nobody later mistakes them for original.

Then **dual-write**: every balance-changing operation writes both the column and the ledger entries, in the same transaction so they can't diverge. Deliberately two sources of truth, temporarily. Run **continuous reconciliation** recomputing the balance from the ledger and comparing — that job is the whole safety mechanism, and I want it green for a sustained period covering the rare paths: month-end, reversals, corrections, FX. **"It reconciled for six weeks" is not proof** if month-end only happened once.

Then **cutover behind a feature flag**, reads served from the ledger projection, column still written and reconciled so rollback is a flag flip. Only after a further clean period do you stop writing the column and drop it — and I'd budget that decommissioning explicitly, because old systems never die on their own.

**Why it lands.** Names the derived-history risk, makes reconciliation the safety mechanism, insists on rare-path coverage, budgets decommissioning.
**✗ Weak answer.** Backfill, cut over, delete the column.
**↳ Follow-ups.** What if reconciliation finds a historical discrepancy? Who signs off cutover? How long do you dual-write?

---

### Quick-fire (30 seconds each)

- **"Clustered vs non-clustered?"** → The clustered index *is* the table — its leaf level holds the data pages in key order, so there's one per table. A non-clustered index is a separate B-tree whose leaf holds the key plus a row locator, which is why it may need a key lookup back to the clustered index. You eliminate that lookup with INCLUDE columns.
- **"Query fast in SSMS, slow from the app?"** → Almost always different SET options — SSMS sets ARITHABORT ON, ADO.NET leaves it OFF, so they get two different cached plans and the app's was compiled for a bad parameter. Confirm by comparing the cached plans in Query Store, then fix the parameter sensitivity rather than the SET option.
- **"How do you fix parameter sniffing?"** → First confirm it: same query, wildly different actual-vs-estimated rows for different parameters. Then choose by workload — `RECOMPILE` if compilation is cheap relative to execution, `OPTIMIZE FOR UNKNOWN` to get a stable average plan, separate procedures when there are genuinely two shapes, or Query Store plan forcing as the surgical fix. On 2022, PSP optimization handles the common case.
- **"Design a ledger."** → Append-only double-entry: every transaction writes at least two entries sharing a transaction id, debits and credits, amounts as DECIMAL(19,4) with a currency code, all in one local transaction. Nothing is ever updated or deleted — corrections are reversal entries. Balance is a cached projection reconciled against `SUM` of entries by a scheduled assertion, and the whole table is locked down to INSERT-only for auditability.

---

**Go deeper:** `04-SQL-Server/01`–`15` · **Related:** [[56-EFCore]], [[34-CQRS-EventSourcing-Saga-Outbox]], [[34-CQRS-EventSourcing-Saga-Outbox]], [[14-System-Design-Core]]
