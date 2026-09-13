> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: [[01-Indexing-Query-Execution-Plans]], [[02-Transactions-Isolation-Locking]]

# SQL Server Interview Workbook — Production Troubleshooting Scenarios

These twelve questions are incident-style, not query-writing questions. The "answer" is an investigation methodology, so **SQL Query** / **Sample Data** / **Expected Output** below show the *diagnostic* DMV/Query Store queries you'd run and the pattern in their output that points at root cause — not a business-logic query. All DMV/Extended-Events/Query-Store output shown is illustrative, not a captured real trace, per the no-fabrication rule.

Sample fintech context reused across this file: a payments platform with `Payments(PaymentId, AccountId, Amount, Status, CreatedAt)`, `Accounts(AccountId, CustomerId, Balance)`, `Trades(TradeId, AccountId, Symbol, Quantity, Price, SettledAt)`.

---

### Q105. A query suddenly became slow after deployment — how do you investigate?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
I don't guess — I first establish *what actually changed at the time it got slow*: the execution plan, the schema, the statistics, or the workload. Query Store is the fastest path: it timestamps every plan and its runtime stats, so I can see whether a new plan appeared around the deployment window and whether that plan's average duration/IO is worse than the prior one. In parallel I diff the deployment script against the schema (dropped/rebuilt index, changed column type causing an implicit conversion, a trigger added, a stats-update job that ran). Only after confirming *which* of those changed do I pick a fix — forcing the old plan is a stopgap, not the fix.

**2. SQL Query**
```sql
-- Did the plan change around deployment time, and did runtime get worse?
SELECT
    qsq.query_id,
    qsp.plan_id,
    qsp.last_compile_start_time,
    rs.avg_duration / 1000.0            AS avg_duration_ms,
    rs.avg_logical_io_reads,
    rs.count_executions
FROM sys.query_store_query            AS qsq
JOIN sys.query_store_plan             AS qsp ON qsp.query_id = qsq.query_id
JOIN sys.query_store_runtime_stats    AS rs  ON rs.plan_id   = qsp.plan_id
JOIN sys.query_store_runtime_stats_interval AS rsi ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
WHERE qsq.query_id = @QueryId
ORDER BY rsi.start_time;
```

**3. Explain the Query**
This walks `sys.query_store_query` → `sys.query_store_plan` → `sys.query_store_runtime_stats`, joined to the time-bucketed interval table, for one known-slow query. Each row is one plan's average duration/IO for one time window, ordered chronologically — so a step-change in `avg_duration_ms` that lines up with `last_compile_start_time` right after the deployment timestamp is the smoking gun.

**4. Sample Data (illustrative)**
| plan_id | last_compile_start_time | avg_duration_ms | avg_logical_io_reads | count_executions |
|---|---|---|---|---|
| 41 | 2026-09-01 02:00 | 4.2 | 18 | 51,200 |
| 57 | 2026-09-10 03:14 (deploy window) | 210.6 | 3,400 | 9,800 |

**5. Expected Output**
A new `plan_id` appears exactly at the deployment timestamp, with logical reads jumping ~190x — that's an index scan replacing what was an index seek, not a data-volume story (volume doesn't jump 190x in one deploy).

**6. Alternative Solutions**
- **Query Store "Regressed Queries" report** (SSMS built-in) — fastest UI path, same underlying data as above; good for "show me everything that got worse," not just one known query.
- **`sys.dm_exec_query_stats` diff** (cache-based) — works even without Query Store enabled, but loses history on plan eviction/restart, so it can't answer "what did it look like before" once the old plan falls out of cache.
- **Deployment script diff** (`sp_helpindex`, `INFORMATION_SCHEMA.COLUMNS` before/after, or a schema-compare tool) — necessary regardless, because Query Store tells you *that* the plan changed, not *why*; you still need to correlate it to a specific DDL change.
I prefer Query Store as the entry point because it survives restarts and gives a time series, then confirm the "why" with a schema diff.

**7. Performance**
Query Store itself adds a small, tunable overhead (`MAX_STORAGE_SIZE_MB`, capture policy) — [Monitor Performance by Using the Query Store](https://learn.microsoft.com/en-us/sql/relational-databases/performance/monitoring-performance-by-using-the-query-store) — but that cost is far smaller than repeatedly running expensive scans. `sp_query_store_force_plan` gets you back to the good plan in seconds while the real index/stats fix is scheduled properly, avoiding a rushed hotfix under incident pressure.

**8. Edge Cases**
- Multiple unrelated queries regress at the same time → look for a shared cause: an `UPDATE STATISTICS ... WITH FULLSCAN` job, a tempdb contention spike, or a maintenance window that rebuilt indexes with a different fill factor.
- A cold cache after a restart can look like "sudden slowness" with no deployment involved — check `sys.dm_os_sys_info.sqlserver_start_time` before blaming the deploy.
- The plan didn't change, but the *data* did (a batch load just before the deploy) — don't assume causation from correlation in time.

**9. Production Scenario**
A payments-lookup query (`SELECT * FROM Payments WHERE AccountId = @Id AND Status = 'PENDING'`) went from single-digit milliseconds to 200ms+ right after a migration that widened `Status` from `CHAR(10)` to `NVARCHAR(20)` — an implicit conversion in the predicate silently turned an index seek into a scan.

**10. Interview Follow-ups**
1. What if Query Store isn't enabled in this environment?
2. How would you tell a stats problem from a genuine plan-choice regression?
3. What's your rollback plan if forcing the old plan doesn't help?
4. How do you prevent this class of regression pre-production?
5. Would you expect `RECOMPILE` to fix this permanently?

**11. Follow-up Answers**
1. Fall back to `sys.dm_exec_query_stats` plus, if you captured one, a pre-deployment baseline extract (`sys.dm_exec_query_plan` XML saved from the last known-good run) — this is exactly why baselining plans before a release is worth the discipline.
2. Check `sys.dm_db_stats_properties` for `last_updated`/`modification_counter` on the tables involved; if stats are fresh and the plan still regressed, it's a genuine optimizer/schema-driven change, not staleness.
3. Force the last-known-good plan via Query Store (`sp_query_store_force_plan`) as an immediate mitigation, independent of finding root cause, then unforce once the real fix (index/stat/type fix) ships.
4. Add a pre-prod step that captures actual execution plans for the top N business-critical queries and diffs them against the last release — a "plan regression gate," conceptually like a performance test, in CI/CD.
5. No — `RECOMPILE` gets you a fresh plan *this time*, but if the underlying cause (implicit conversion, missing index) is still there, the next compile can pick the same bad plan again; it treats the symptom.

**12. Common Mistakes**
Restarting SQL Server "to clear things up" — this wipes the plan cache and Query Store's in-memory buffer, destroying the evidence needed to diagnose the regression, and only masks the problem until the bad plan gets cached again.

**13. Architect Insight**
A senior engineer runs a query and gets a number. A staff/principal engineer produces a timeline: "the plan changed at 03:14, correlating with migration script X, cause: implicit conversion on `Status`, confirmed via execution-plan XML showing a `CONVERT_IMPLICIT` warning" — and only then proposes a fix, with a note on how to prevent the same defect class next release.

---

### Q106. SQL Server CPU is at 95% — what's your troubleshooting sequence?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
High CPU isn't a diagnosis, it's a symptom. I first find *what's consuming it*: top queries by CPU from `sys.dm_exec_query_stats`, and whether it's genuinely query-execution CPU or compilation/recompilation churn (`sys.dm_exec_query_stats` vs `sys.dm_os_performance_counters` "Batch Requests/sec" vs "SQL Compilations/sec"). Then I check for parallelism-related CPU burn (`CXPACKET`/`CXCONSUMER` waits with a misconfigured `MAXDOP`/cost threshold) versus a genuine missing-index scan storm.

**2. SQL Query**
```sql
SELECT TOP 20
    qs.total_worker_time / 1000.0 / qs.execution_count AS avg_cpu_ms,
    qs.execution_count,
    qs.total_worker_time / 1000.0 AS total_cpu_ms,
    SUBSTRING(st.text, (qs.statement_start_offset/2) + 1,
        ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text) ELSE qs.statement_end_offset END - qs.statement_start_offset)/2) + 1) AS statement_text
FROM sys.dm_exec_query_stats AS qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS st
ORDER BY qs.total_worker_time DESC;
```

**3. Explain the Query**
[`sys.dm_exec_query_stats`](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-exec-query-stats-transact-sql?view=sql-server-ver17) has one row per cached statement with cumulative CPU (`total_worker_time`), so ordering by that surfaces the heaviest CPU consumers since the plan was cached; `sys.dm_exec_sql_text` recovers the actual statement text from the handle.

**4. Sample Data**
| avg_cpu_ms | execution_count | total_cpu_ms | statement_text |
|---|---|---|---|
| 380 | 42,000 | 15,960,000 | `SELECT * FROM Trades WHERE Symbol = @s` |

**5. Expected Output**
One statement dominates total CPU with a high `execution_count` — a scan-per-call pattern, pointing at a missing index on `Symbol` rather than one runaway ad-hoc query.

**6. Alternative Solutions**
- **`sys.dm_os_schedulers`** ([docs](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-os-schedulers-transact-sql)) — shows `runnable_tasks_count` per scheduler; a high runnable queue with CPU pegged means genuine CPU pressure, not I/O masquerading as CPU.
- **Query Store "Top Resource Consuming Queries" by CPU** — same data as above with a UI and history, easier to present to stakeholders.
- **Perfmon `SQL Compilations/sec` vs `SQL Re-Compilations/sec`** — if these are high relative to `Batch Requests/sec`, the CPU is being spent compiling, not executing (points at missing plan reuse / ad-hoc query storm, not a bad index).
I lead with the query-stats view because it directly names the offending statement; scheduler/perfmon counters confirm whether it's execution CPU or compile CPU.

**7. Performance**
Fixing a scan-driven CPU problem (adding the right index) is typically the highest-leverage fix available — it reduces both CPU and I/O simultaneously, unlike raising `MAXDOP` or adding cores, which just processes the same wasteful scan faster.

**8. Edge Cases**
- CPU pegged but `runnable_tasks_count` is near zero → CPU isn't the bottleneck, waits are (check `sys.dm_os_wait_stats`, [docs](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-os-wait-stats-transact-sql?view=sql-server-ver17)); this is the inverse case, see Q111.
- Parallelism inflating "CPU time" — a query with `MAXDOP 8` reports 8x the worker time of a serial query for the same wall-clock duration; don't read total CPU as duration.
- Antivirus/backup/CHECKDB running concurrently — rule out non-SQL-Server processes via Task Manager/`sys.dm_os_process_memory` before blaming query plans.

**9. Production Scenario**
A trade-settlement job's per-symbol lookup (`Trades WHERE Symbol = @s`) had no index on `Symbol`; as trading volume grew, the table scan cost scaled linearly with row count until CPU pegged during market open.

**10. Interview Follow-ups**
1. How do you tell compile-CPU from execute-CPU quickly?
2. What would make you suspect `MAXDOP` misconfiguration specifically?
3. How does this differ from Q111 (plenty of CPU, still slow)?
4. What's a safe MAXDOP default for an OLTP payments workload?
5. How do you validate the fix actually reduced CPU in production?

**11. Follow-up Answers**
1. Compare `SQL Compilations/sec` and `SQL Re-Compilations/sec` against `Batch Requests/sec` in `sys.dm_os_performance_counters`; a high compile ratio points at ad-hoc/non-parameterized queries or excessive recompiles (stats updates, `RECOMPILE` hints), not the queries' own logic.
2. A wait-stats profile dominated by `CXPACKET`/`CXCONSUMER` alongside high CPU on many schedulers for a handful of relatively small OLTP queries — parallelism kicking in for queries too cheap to need it (cost threshold too low for the hardware).
3. Here CPU itself is the constrained resource (`runnable_tasks_count` > 0, schedulers saturated); in Q111 CPU is idle and something else (I/O, memory, locks) is the constraint — the DMV story is the opposite.
4. Per Microsoft's guidance ([MAXDOP configuration](https://learn.microsoft.com/en-us/sql/database-engine/configure-windows/configure-the-max-degree-of-parallelism-server-configuration-option?view=sql-server-ver17)), for OLTP with >8 logical processors per NUMA node, MAXDOP 8 with an appropriately raised cost threshold for parallelism is a common, safe starting point — not 0/unlimited, which lets a single query monopolize CPU.
5. Re-run the same top-CPU query against `sys.dm_exec_query_stats`/Query Store after the fix ships and compare `avg_cpu_ms` and `total_worker_time` trend over the following days, not just the first execution.

**12. Common Mistakes**
Jumping straight to "add more cores" or raising `MAXDOP` without first identifying *which* statement is consuming the CPU — that treats a capacity symptom without ever finding the query-level cause, so the same workload growth will re-trigger the incident.

**13. Architect Insight**
A senior engineer finds the top-CPU query. An architect additionally asks whether this is a *capacity* problem (genuine growth outpacing current indexing/hardware — needs a scaling plan) or a *defect* (missing index, bad plan) — and frames the fix and the follow-up capacity conversation with stakeholders accordingly, rather than presenting a one-off patch as if it closes the growth trend.

---

### Q107. Blocking is increasing in production — what do you check?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
I look for the head of each blocking chain, not just the symptom of many blocked sessions — most blocking incidents are one long-running transaction (or a missing index causing a scan under a lock) blocking a growing queue behind it. `sys.dm_exec_requests` filtered on `blocking_session_id <> 0` gives the chain; the session at the root, with `blocking_session_id = 0`, is the one actually holding the lock everyone else is waiting on.

**2. SQL Query**
```sql
SELECT
    r.session_id, r.blocking_session_id, r.wait_type, r.wait_time,
    r.status, r.command, t.text AS blocking_or_blocked_sql
FROM sys.dm_exec_requests AS r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) AS t
WHERE r.blocking_session_id <> 0
   OR r.session_id IN (SELECT blocking_session_id FROM sys.dm_exec_requests WHERE blocking_session_id <> 0)
ORDER BY r.blocking_session_id, r.wait_time DESC;
```

**3. Explain the Query**
[`sys.dm_exec_requests`](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-exec-requests-transact-sql) exposes `blocking_session_id` per active request; this pulls every request that is either blocked or is itself the blocker, so you can reconstruct the whole chain (A blocks B blocks C) in one result set instead of chasing it session by session.

**4. Sample Data**
| session_id | blocking_session_id | wait_type | wait_time (ms) | command |
|---|---|---|---|---|
| 88 | 0 | — | — | `UPDATE Accounts SET Balance = ...` (open tx, no commit yet) |
| 91 | 88 | LCK_M_X | 12,400 | `SELECT ... WHERE AccountId = ...` |
| 95 | 91 | LCK_M_X | 9,800 | `UPDATE Accounts ...` |

**5. Expected Output**
Session 88 is the root (`blocking_session_id = 0`) and has been open a long time with no matching commit visible — a transaction left open by application code (missing `COMMIT`/connection not returned to pool cleanly), not a query-plan problem.

**6. Alternative Solutions**
- **Activity Monitor in SSMS** — visual blocking-chain view, same underlying data, faster for a one-off look during an incident call.
- **A blocked-process-report Extended Event** (`blocked_process_threshold` configured + `xml_deadlock_report`-style capture) — better for *recurring* blocking, since it captures automatically instead of requiring you to be watching at the right second.
- **`sys.dm_tran_locks` joined to `sys.dm_exec_sessions`** — needed when you must see exactly *which rows/pages* are locked, not just which sessions are involved (e.g., to confirm lock escalation to table-level is the cause).
For a live, ongoing incident I go straight to `sys.dm_exec_requests` because it's immediate; for a recurring-but-intermittent pattern I'd configure the blocked-process report so it self-captures.

**7. Performance**
The fix is almost never "add hardware" — it's shortening the root transaction (commit sooner, move the row-lookup/validation logic outside the transaction boundary) or fixing the underlying scan holding locks longer than necessary via the correct index.

**8. Edge Cases**
- The chain's head is waiting on something *outside* SQL Server entirely (an app-level distributed lock, a synchronous call to another service made mid-transaction) — the fix is architectural (don't call out to the network inside a DB transaction), not indexing.
- Lock escalation mid-chain: session 88 escalated a row-lock to a table lock, so sessions 91/95 are blocked on the whole table, not the one row they actually need — see Q109/Q114's escalation discussion and [Resolve Blocking Problems Caused by Lock Escalation](https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/performance/resolve-blocking-problems-caused-lock-escalation).
- Blocking that resolves itself in under a second on every check — often normal, expected contention; alerting on *duration* (e.g., >5s) rather than mere presence avoids false alarms.

**9. Production Scenario**
An `UPDATE Accounts SET Balance = ...` inside a service call that also made a synchronous HTTP call to a fraud-check API before committing — during a fraud-service slowdown, the DB transaction stayed open for seconds, and every subsequent balance read/write on that account queued behind it.

**10. Interview Follow-ups**
1. How do you distinguish blocking from a deadlock?
2. What isolation level would reduce this without changing application logic?
3. How would you alert on this proactively instead of reacting?
4. Would `NOLOCK` be an acceptable fix here?
5. How do you explain "the database is fine, your code held a transaction open" to a team that doesn't own the DB?

**11. Follow-up Answers**
1. Blocking is one session waiting for another to release a lock, with no cycle — it resolves once the blocker finishes; a deadlock is a *cycle* of waits (A waits for B, B waits for A) that SQL Server must break by killing one participant (see Q108).
2. Read Committed Snapshot Isolation (RCSI) removes reader/writer blocking for this pattern (readers see a versioned snapshot instead of waiting on the writer's lock) without any application code change — but it doesn't fix writer/writer blocking, which this scenario also has.
3. Configure the blocked-process-report threshold (`sp_configure 'blocked process threshold'`) with an Extended Events session capturing it, alerting when any chain's root wait exceeds a few seconds — proactive, not "someone noticed the app was slow."
4. No — `NOLOCK` (READ UNCOMMITTED) on a `Balance` read in a payments system risks dirty reads of an in-flight, possibly-to-be-rolled-back update; the correct fix is shortening the transaction or RCSI, not reading incorrect financial data.
5. Bring the evidence: the blocking-chain query output showing the root session's SQL text is the external fraud-check-adjacent update, timestamped against the fraud service's own incident window — data, not blame, moves this conversation.

**12. Common Mistakes**
Killing the blocking session (`KILL`) as the "fix" without understanding what it was doing — for a financial `UPDATE`, an uncontrolled kill mid-transaction just forces a rollback at an unknown point and can itself cause application-visible errors; it treats the symptom and risks a worse outcome than the blocking did.

**13. Architect Insight**
A senior engineer finds and reports the blocking chain. A principal engineer also asks *why* the transaction boundary includes a network call in the first place, and pushes for a design change — validate/call external services before opening the transaction, or move to a compensating/outbox pattern (see the SQL+Microservices file) — since indexing/isolation tuning only mitigates a design smell that will resurface under different load shapes.

---

### Q108. A deadlock occurs every few minutes — how do you diagnose it?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
SQL Server already captures every deadlock's graph by default in the `system_health` Extended Events session — I don't need to reproduce it live. I pull the `xml_deadlock_report` events, read the two (or more) participating processes' resource lists and lock-request modes, and identify the *access order* mismatch: process A takes lock on resource 1 then wants resource 2, process B took resource 2 first and wants resource 1. The fix is almost always ordering, not "add more capacity."

**2. SQL Query**
```sql
SELECT
    CAST(xet.target_data AS xml) AS target_data
FROM sys.dm_xe_session_targets AS xet
JOIN sys.dm_xe_sessions AS xe ON xe.address = xet.event_session_address
WHERE xe.name = 'system_health';
-- then extract xml_deadlock_report nodes:
-- SELECT event_data.value('(data/value)[1]', 'nvarchar(max)') FROM
--   (SELECT target_data.query('.') AS event_data FROM ... ) AS x
```

**3. Explain the Query**
Per [Use the system_health session](https://learn.microsoft.com/en-us/sql/relational-databases/extended-events/use-the-system-health-session?view=sql-server-ver16), `system_health` runs by default and captures `xml_deadlock_report` events into a ring buffer target; this query reads that target's XML, which you then shred (via `.query()`/`.value()` XQuery) to pull out each deadlock's `<deadlock>` node — victim, process list, resource list — without needing to enable anything extra. For deeper, always-on capture, [Trace Flag 1222](https://learn.microsoft.com/en-us/sql/t-sql/database-console-commands/dbcc-traceon-trace-flags-transact-sql?view=sql-server-ver17) writes a text-based deadlock report to the error log, per [How It Works: Deadlock Trace Flag 1222 Output](https://learn.microsoft.com/en-us/archive/blogs/bobsql/how-it-works-sql-server-deadlock-trace-flag-1222-output) — useful as a supplement, at the cost of extra error-log write overhead.

**4. Sample Data (illustrative deadlock graph excerpt)**
```
process 1 (spid 61): owns KEY lock on Accounts.PK (AccountId=100), waits for KEY lock on Trades.PK (TradeId=500)
process 2 (spid 74): owns KEY lock on Trades.PK (TradeId=500), waits for KEY lock on Accounts.PK (AccountId=100)
victim: spid 74
```

**5. Expected Output**
Two processes taking `Accounts` then `Trades` locks in opposite order — a textbook lock-ordering deadlock, not a resource-contention/scale problem.

**6. Alternative Solutions**
- **`system_health` ring buffer (above)** — zero setup, always on, but the ring buffer is limited size/rolls over, so a low-frequency deadlock might be lost between checks.
- **Dedicated Extended Events session on `xml_deadlock_report` writing to a file target** — durable, doesn't roll over, my preference for a "every few minutes" recurring incident since you need reliable capture across a longer window.
- **Trace Flag 1222 to the error log** — legacy but still useful, text form is sometimes easier to skim than shredding XML; adds logging overhead per Microsoft's own caveat, so I wouldn't leave it on indefinitely on a high-throughput OLTP system.
I'd set up the dedicated file-target XE session for an incident recurring this often, since the default ring buffer isn't guaranteed to still hold it by the time someone looks.

**7. Performance**
The actual fix (consistent access order, or shortening the transactions so the lock-hold window shrinks) has zero runtime cost; it's a code change, not a hardware or index change. Retry-with-backoff on the deadlock-victim error (1205) is a legitimate complement, never a substitute — see the Saga/idempotency material in the System-Design retries discussion.

**8. Edge Cases**
- A "deadlock" that's actually a lock-timeout (error 1222) misreported as a deadlock by the app team — check the actual SQL Server error number, they require different fixes.
- Deadlocks between a row-modification and a *schema*-stability lock (e.g., an index rebuild running online) — the fix is scheduling maintenance windows, not code access order.
- Parallel-query intra-query "deadlocks" (rare, exchange-spill related) — a different root cause from classic two-session deadlocks; don't apply the access-order fix blindly.

**9. Production Scenario**
A trade-settlement batch job updates `Accounts` then `Trades` in one stored procedure, while a real-time trade-execution path updates `Trades` then `Accounts` in a different code path — under concurrent load at market close, these collide in opposite lock order every few minutes until one path was reordered to match the other.

**10. Interview Follow-ups**
1. How does SQL Server pick which process to kill as the deadlock victim?
2. Would raising the isolation level make this better or worse?
3. How do you prevent this class of bug from recurring across future code changes?
4. What's the difference between a deadlock and a livelock, and does SQL Server have the latter?
5. How would you handle the deadlock victim's error in application code?

**11. Follow-up Answers**
1. By default, the one with the lowest estimated rollback cost is chosen as the victim (cheaper to undo); `SET DEADLOCK_PRIORITY` lets you bias this explicitly for a session that must not be the sacrificial one.
2. Worse, generally — `SERIALIZABLE`/higher isolation increases lock scope and hold duration, making a lock-order collision *more* likely, not less; the fix here is code-level ordering, independent of isolation level.
3. Establish and document a canonical multi-table lock-acquisition order for the domain (e.g., always `Accounts` before `Trades`) and enforce it via code review/a lint rule on stored procedures — the same discipline as avoiding circular waits in any concurrent system, not a SQL-specific trick.
4. A livelock is two processes each repeatedly yielding to avoid a deadlock and making no forward progress; SQL Server's deadlock detector specifically breaks true circular waits by killing a victim, so a livelock in the classic sense isn't really an SQL Server DB-engine phenomenon (it's an application-level retry-storm risk if retries aren't backed off).
5. Catch error 1205 specifically, and retry the transaction from the start (not mid-transaction) with jittered backoff — treating it as an expected, recoverable condition in write-heavy paths rather than surfacing it as a user-facing failure.

**12. Common Mistakes**
Wrapping the deadlock-prone code in `TRY/CATCH` and swallowing error 1205 without retrying the transaction — this silently drops the failed update (e.g., a trade never gets recorded) instead of either fixing the ordering or safely retrying it.

**13. Architect Insight**
A senior engineer reads the deadlock graph and reorders one procedure. An architect documents the canonical lock-order convention for the whole domain, adds it to the team's engineering standards, and asks whether a design that requires cross-aggregate locking (`Accounts` + `Trades` in one transaction) should instead be split via the Outbox/Saga patterns so no single transaction needs both locks at all.

---

### Q109. An index seek changed to an index scan — why?

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Five usual suspects: stale statistics (the optimizer's cardinality estimate no longer matches reality), a parameter-sniffed plan built for a non-selective value, the index itself was dropped/altered/disabled, a new predicate introduced an implicit conversion that isn't SARGable anymore, or the optimizer's cost-based choice genuinely changed because the table grew large enough that a scan+hash beats many seeks. I check statistics freshness and the plan's estimated-vs-actual row counts first — that mismatch is the fastest signal.

**2. SQL Query**
```sql
SELECT
    s.name, sp.last_updated, sp.modification_counter, sp.rows, sp.rows_sampled
FROM sys.stats AS s
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) AS sp
WHERE s.object_id = OBJECT_ID('dbo.Trades');
```

**3. Explain the Query**
`sys.dm_db_stats_properties` reports when each statistics object was last updated and how many row modifications have occurred since — a large `modification_counter` relative to `rows` (roughly >20% for the auto-update threshold on larger tables) means the optimizer's estimates are likely stale enough to justify a bad plan choice.

**4. Sample Data**
| name | last_updated | modification_counter | rows |
|---|---|---|---|
| IX_Trades_Symbol | 2026-06-01 | 4,200,000 | 5,000,000 |

**5. Expected Output**
84% of rows modified since the last stats update — well past the auto-update threshold behavior being effective in practice, strongly suggesting stale-stats-driven misestimation is why the optimizer now thinks a scan is cheaper than a seek.

**6. Alternative Solutions**
- **Compare actual execution plan's estimated vs. actual rows** — the single most direct diagnostic; a huge gap confirms a cardinality-estimation problem regardless of *which* underlying cause produced it.
- **Check `sys.indexes` for `is_disabled`** — rules out the "index isn't there anymore" cause in one query.
- **Check the predicate for an implicit conversion** (execution plan warning icon, or `sys.dm_exec_query_plan` XML `PlanAffectingConvert`) — rules out the SARGability cause.
I check estimated-vs-actual first because it tells you *whether* it's a cardinality problem at all before spending time on any one specific cause.

**7. Performance**
`UPDATE STATISTICS ... WITH FULLSCAN` (or enabling `AUTO_UPDATE_STATISTICS_ASYNC` appropriately) is cheap relative to running scan-based plans in production; for very large or heavily-modified tables, a scheduled stats-maintenance job is the durable fix rather than relying on the automatic threshold alone.

**8. Edge Cases**
- The optimizer is *right* to scan — for a query returning a large fraction of the table, a scan genuinely beats thousands of individual seeks; "index seek" isn't always the goal.
- Statistics were just updated (by an overnight job) and *that itself* triggered a new, worse plan for a different parameter value — this is parameter sniffing wearing a stats-update costume; see Q110/Q113.
- Filtered index whose filter predicate no longer matches the query due to a value-range shift (e.g., a filtered index on `Status = 'PENDING'` while trending order volume shifted).

**9. Production Scenario**
A `Trades` lookup by `Symbol` scanned instead of seeking after a large batch backfill inserted six months of historical trades overnight without a subsequent stats update, since the auto-update threshold hadn't yet fired relative to the *pre-backfill* row count baseline.

**10. Interview Follow-ups**
1. Why doesn't SQL Server always keep statistics perfectly up to date automatically?
2. How would `WITH RECOMPILE` interact with this?
3. What's the difference between `UPDATE STATISTICS` and rebuilding the index?
4. How do filtered statistics change this analysis?
5. Would a covering index have prevented this regardless of stats?

**11. Follow-up Answers**
1. Because scanning the whole table to keep stats perfectly current on every write would be prohibitively expensive on large, high-write tables; SQL Server samples and uses modification-count thresholds to balance freshness against overhead.
2. `WITH RECOMPILE` forces a fresh estimate using current statistics and the current parameter's actual value on every execution — it fixes stale-plan symptoms at the cost of compiling every time, which is a real CPU trade-off on a hot path.
3. `UPDATE STATISTICS` only refreshes the optimizer's row/value-distribution estimates; rebuilding the index additionally defragments the physical structure and, as a side effect, also refreshes its statistics with a full scan — so a rebuild fixes this but is a heavier operation than needed if fragmentation isn't the issue.
4. Filtered statistics (or a filtered index's built-in stats) give a much more accurate density estimate for the specific subset actually queried (e.g., only `PENDING` trades), which can prevent exactly this kind of misestimation for skewed subsets that full-table stats blur together.
5. Not necessarily — a covering index avoids a key lookup, but the optimizer can still choose to scan it instead of seek it if it believes (correctly or not) that a large fraction of rows qualify; covering and "seek vs. scan" are related but distinct concerns (see `01-Indexing-Query-Execution-Plans.md` Q3/Q11).

**12. Common Mistakes**
Rebuilding every index on the table as a reflexive fix without first confirming *whether* fragmentation or stale statistics is actually the cause — an expensive operation applied without diagnosis, which may not address a parameter-sniffing or implicit-conversion root cause at all.

**13. Architect Insight**
A senior engineer updates statistics and moves on. A staff engineer asks *why* the modification counter got that high before triggering an update — was the backfill job supposed to run `UPDATE STATISTICS` at the end as a matter of policy? — and turns a one-off diagnostic fix into a standing operational checklist for future bulk loads.

---

### Q110. A query is fast for one parameter value but slow for another — why?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Classic parameter sniffing: the plan cached for this statement was compiled using whichever parameter value first triggered compilation, and that plan is optimal for that value's selectivity but not for a very differently-distributed value. It's a data-skew problem exposed through plan reuse, not a bug in the query text itself. Diagnosis: compare the cached plan's compile-time parameter (`sys.dm_exec_query_stats` → `sys.dm_exec_plan_attributes`) against the value that's currently running slow.

**2. SQL Query**
```sql
SELECT
    qs.plan_handle,
    pa.value AS compiled_with_parameters
FROM sys.dm_exec_query_stats AS qs
CROSS APPLY sys.dm_exec_plan_attributes(qs.plan_handle) AS pa
WHERE pa.attribute = 'set_options' OR pa.attribute = 'sql_handle'
-- practically: use "Show Actual Execution Plan" and inspect the
-- "Parameter Compiled Value" vs "Parameter Runtime Value" properties on the root operator
```

**3. Explain the Query**
The properties pane of an actual execution plan directly exposes `Parameter Compiled Value` next to `Parameter Runtime Value` on the statement root — the fastest practical way to confirm sniffing; the DMV route above is the scriptable equivalent when you need this checked programmatically across many cached plans rather than one plan you already have open.

**4. Sample Data**
| Parameter | Compiled Value | Runtime Value |
|---|---|---|
| @Status | 'SETTLED' (99% of rows) | 'PENDING' (0.1% of rows) |

**5. Expected Output**
A plan built for a highly non-selective value (`SETTLED`, expects a scan) is being reused for a highly selective one (`PENDING`, wants a seek) — the scan-shaped plan is technically correct but far from optimal for the current call.

**6. Alternative Solutions**
- **`OPTION (RECOMPILE)`** — compiles fresh for every call using the actual runtime value; correct plan every time, at the cost of compilation CPU on every execution — reasonable for a low-frequency, high-variance query.
- **`OPTIMIZE FOR (@Status = 'PENDING')` / `OPTIMIZE FOR UNKNOWN`** — pins the plan to a chosen "average case" selectivity or forces a density-vector-based generic estimate, avoiding per-call recompile cost but accepting a single compromise plan for all values.
- **Parameter Sensitive Plan (PSP) optimization** ([docs](https://learn.microsoft.com/en-us/sql/relational-databases/performance/parameter-sensitive-plan-optimization?view=sql-server-ver17)) — SQL Server 2022+ can cache *multiple* plans for the same statement keyed on parameter-value buckets automatically, which is the modern fix for exactly this skew pattern without hand-tuning hints.
On SQL Server 2022+ I'd let PSP optimization handle this natively first; on older versions, `RECOMPILE` for low-frequency queries or splitting into two statements (`IF`/branch by known-skewed values) for high-frequency ones.

**7. Performance**
`RECOMPILE` trades CPU-per-call for correctness-per-call; on a statement executed thousands of times per second, that CPU cost compounds and PSP or branching is the better trade-off. See `01-Indexing-Query-Execution-Plans.md` Q16 for the full parameter-sniffing mechanics.

**8. Edge Cases**
- Plan cache eviction due to memory pressure can *look* like intermittent sniffing (different compiles pick different values over time by chance) — check `sys.dm_exec_cached_plans` eviction reasons before assuming it's purely skew-driven.
- A stored procedure with several branches (`IF @Status = 'PENDING' ... ELSE ...`) can still sniff at the *procedure* level if SQL Server builds one plan covering all branches — branching alone doesn't guarantee per-branch optimal plans without `RECOMPILE` on the branch or separate procedures.

**9. Production Scenario**
A `GetTradesByStatus` procedure ran fast for `'SETTLED'` (the vast majority) but timed out for `'FAILED'` (a rare, operationally critical status support engineers query during an incident) — precisely when a fast answer mattered most.

**10. Interview Follow-ups**
1. How is this different from Q109's stats-staleness scenario?
2. What's `OPTIMIZE FOR UNKNOWN` actually doing under the hood?
3. Would an index per status value help?
4. How do you reproduce this in a test environment reliably?
5. Does this apply to ad-hoc queries, or only stored procedures/parameterized queries?

**11. Follow-up Answers**
1. Q109 is about the optimizer's *estimate* being wrong due to stale data distribution knowledge; this is about the optimizer's estimate being *correct for one value* but the *plan being reused* for a differently-distributed value — stats can be perfectly fresh and sniffing still happens.
2. It uses the column's overall density vector (average selectivity across all values) instead of the specific literal/parameter value, producing one "generically reasonable" plan instead of one hyper-optimized for whichever value happened to compile first — better average case, potentially worse for either extreme.
3. A filtered index on the rare, high-value status (e.g., `WHERE Status = 'FAILED'`) gives the optimizer a purpose-built, small, cheap structure for that case regardless of which plan is cached for the general query — often a stronger fix than compilation hints alone.
4. Force separate compiles for each value with `sp_recompile`/plan-cache flush plus tracing `Parameter Compiled Value`, or explicitly test with `OPTION (RECOMPILE)` for each value to see each value's ideal plan shape before comparing to the cached one.
5. Primarily stored procedures and parameterized queries — true ad-hoc, non-parameterized literal queries usually compile a plan specific to that literal each time (unless "simple parameterization" auto-parameterizes them), so sniffing is much more a parameterized-query/proc phenomenon.

**12. Common Mistakes**
Reflexively adding `WITH RECOMPILE` to every stored procedure "to be safe" — this silently taxes CPU on every single call for procedures that never had a skew problem in the first place, trading a hypothetical issue for a real, constant cost.

**13. Architect Insight**
A senior engineer applies `OPTION (RECOMPILE)` and the symptom disappears. A principal engineer asks whether the *data model* should expose a rare, operationally critical value (`FAILED`) through a dedicated, purpose-built access path (a filtered index, or even a separate small "exceptions" table) rather than relying entirely on the optimizer to guess correctly across a wildly skewed single column.

---

### Q111. SQL Server has plenty of free CPU but queries are still slow — what else could be wrong?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
If CPU isn't the bottleneck, something else is: I go straight to `sys.dm_os_wait_stats` to see what SQL Server's worker threads are actually *waiting* on cumulatively — I/O latency (`PAGEIOLATCH_*`), memory pressure (`RESOURCE_SEMAPHORE`), locking (`LCK_M_*`), or tempdb contention (`PAGELATCH_*` on tempdb's allocation pages). CPU-idle-but-slow almost always means the engine is waiting on something external to the CPU scheduler.

**2. SQL Query**
```sql
SELECT TOP 10
    wait_type,
    waiting_tasks_count,
    wait_time_ms,
    wait_time_ms * 1.0 / NULLIF(waiting_tasks_count, 0) AS avg_wait_ms
FROM sys.dm_os_wait_stats
WHERE wait_type NOT IN ('SLEEP_TASK','BROKER_TASK_STOP','CLR_SEMAPHORE') -- exclude benign/background waits
ORDER BY wait_time_ms DESC;
```

**3. Explain the Query**
[`sys.dm_os_wait_stats`](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-os-wait-stats-transact-sql?view=sql-server-ver17) is cumulative since the last restart or manual clear, so the *shape* (which wait type dominates total wait time) tells you the system's dominant bottleneck class; filtering out known-benign background waits keeps signal separated from noise.

**4. Sample Data**
| wait_type | waiting_tasks_count | wait_time_ms | avg_wait_ms |
|---|---|---|---|
| PAGEIOLATCH_SH | 210,000 | 8,400,000 | 40 |
| LCK_M_X | 4,200 | 950,000 | 226 |

**5. Expected Output**
`PAGEIOLATCH_SH` dominating means threads are waiting on physical page reads from disk — an I/O subsystem or buffer-pool-memory (Page Life Expectancy) problem, not a CPU one; CPU can sit idle while every worker queues on disk.

**6. Alternative Solutions**
- **`sys.dm_os_wait_stats` (above)** — cheap, cumulative, best first pass for "what class of bottleneck is this."
- **Page Life Expectancy counter + `sys.dm_os_buffer_descriptors`** — confirms whether it's specifically buffer-pool memory pressure (PLE dropping, pages being evicted and re-read) versus genuinely slow underlying storage.
- **Query Store's Wait Stats report** — ties specific *queries* to specific wait categories over time, closing the loop from "the system waits on I/O" to "this query causes most of it."
I start system-wide with wait stats, then narrow to Query Store's per-query wait breakdown once I know which category to chase.

**7. Performance**
If it's genuinely storage-latency bound, the fix is either reducing logical I/O (better indexing so fewer pages need reading — same lever as most of this file) or addressing the storage/memory tier (more buffer pool RAM, faster storage) — CPU upgrades would do nothing here, which is exactly the point of this question.

**8. Edge Cases**
- High `CXPACKET` wait time is often *normal* on a data-warehouse-style workload using intentional parallelism — don't treat it as automatically pathological the way you might on pure OLTP.
- Wait stats are cumulative since restart; a recent restart make percentages misleading until enough steady-state time has passed — always note the collection window (`sys.dm_os_sys_info.sqlserver_start_time`).
- Wait time can be inflated by an unrelated, currently-resolved historical spike (a one-time bulk load last week) if stats were never cleared — pair with a recent-interval Query Store view rather than all-time cumulative alone.

**9. Production Scenario**
A market-data ingestion service showed near-zero CPU utilization on the SQL Server VM while insert latency crept up during the trading day; wait stats showed dominant `PAGEIOLATCH_SH`/`WRITELOG`, traced to an underprovisioned storage tier that couldn't keep up with write throughput at peak tick volume — a storage/IOPS problem, not a query or CPU problem.

**10. Interview Follow-ups**
1. How do `WRITELOG` waits differ from `PAGEIOLATCH` waits in what they imply?
2. What would low Page Life Expectancy specifically indicate?
3. How would tempdb contention show up here, and what's the standard mitigation?
4. Is this different in a cloud-managed environment (e.g., Azure SQL) versus on-prem?
5. How do you rule out network latency as the "slow but no CPU" cause?

**11. Follow-up Answers**
1. `WRITELOG` means threads are waiting on the transaction log flush to durable storage (a write-ahead-log/durability bottleneck, often log-disk latency or too many small transactions); `PAGEIOLATCH_*` means waiting on data-file page reads/writes — different subsystems, different fixes (log-disk provisioning/batching commits vs. data-disk throughput/buffer pool sizing).
2. A low, falling Page Life Expectancy means pages are being evicted from the buffer pool faster than expected, forcing more physical reads — usually insufficient RAM allocated to SQL Server relative to the active working set, or a query pattern scanning far more data than needed and churning the cache for everyone else.
3. `PAGELATCH_*` (not `PAGEIOLATCH`) contention on tempdb's PFS/GAM/SGAM allocation pages under heavy temp-object or version-store (RCSI/snapshot) churn; standard mitigation is multiple correctly-sized tempdb data files (per Microsoft guidance, generally one file per up to 8 logical CPUs, all equally sized) and trace flags historically used for this (now largely automatic in modern versions).
4. In Azure SQL Database/Managed Instance, storage and log I/O are abstracted and governed by the service tier's IOPS/throughput limits (DTU/vCore-based); the same wait-type analysis still applies, but the fix is often "scale the tier up" or "check for throttling" rather than "provision faster physical disks."
5. Check `sys.dm_exec_requests`/`sys.dm_os_wait_stats` for `ASYNC_NETWORK_IO` specifically — that wait type means SQL Server has results ready and is waiting on the *client* to consume them (slow app-side processing or a genuinely slow network), distinguishing it clearly from server-side I/O or memory waits.

**12. Common Mistakes**
Interpreting "CPU is low" as "the database isn't the problem" and redirecting the investigation entirely to application code — low CPU utilization is itself a specific, diagnosable signal pointing at I/O/memory/locking, not evidence that SQL Server is innocent.

**13. Architect Insight**
A senior engineer identifies the dominant wait type. An architect connects it to a capacity/cost decision: is this an indexing defect (fix for free), a buffer-pool sizing issue (a memory/SKU conversation), or a storage-tier limitation (an infrastructure spend conversation) — and brings the right stakeholder into the right conversation instead of treating every wait-stat finding as a pure engineering fix.

---

### Q112. Database connections are exhausted — how do you investigate?

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
I separate "the app's connection pool is exhausted" from "SQL Server's own connection/worker limit is exhausted" — they look similar externally but have different causes. On the SQL Server side, `sys.dm_exec_sessions` and `sys.dm_exec_connections` show who's actually connected, for how long, and whether sessions are sitting idle-in-transaction (a leak) versus genuinely busy.

**2. SQL Query**
```sql
SELECT
    s.session_id, s.login_name, s.host_name, s.program_name,
    s.status, s.last_request_start_time, s.last_request_end_time,
    DATEDIFF(SECOND, s.last_request_end_time, GETDATE()) AS idle_seconds
FROM sys.dm_exec_sessions AS s
WHERE s.is_user_process = 1
ORDER BY idle_seconds DESC;
```

**3. Explain the Query**
[`sys.dm_exec_sessions`](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-exec-sessions-transact-sql?view=sql-server-ver17) filtered to user processes and sorted by idle time surfaces connections that are open but not doing anything — the classic signature of an application-side connection leak (a connection checked out of the pool, used, and never returned/disposed).

**4. Sample Data**
| session_id | program_name | status | idle_seconds |
|---|---|---|---|
| 220 | PaymentService | sleeping | 3,600 |
| 221 | PaymentService | sleeping | 3,590 |

**5. Expected Output**
Dozens of sessions from the same `program_name`, all sleeping for a long, similar duration — one code path is opening connections/transactions and not releasing them back to the pool, exhausting the pool's max size under load.

**6. Alternative Solutions**
- **`sys.dm_exec_connections` joined to sessions** — adds network-level detail (client `net_transport`, `client_net_address`), useful when the leak might be coming from one specific host/instance among many app servers.
- **Application-side pool diagnostics** (e.g., .NET's `SqlConnection` pool counters, `SqlClientEventSource`) — necessary because the exhaustion is often entirely on the *client* pool, before it even reaches SQL Server's own connection limit; this is usually the faster place to look first for a modern connection-pooled app.
- **`sys.dm_os_ring_buffers` for `RING_BUFFER_CONNECTION_LEGACY`/login failures** — useful when the *symptom* is failed new connections, to see if SQL Server itself is refusing (rare) versus the app pool simply having none available (common).
For a typical ADO.NET/EF Core app, I check the client pool counters and open-transaction pattern first, since SQL Server-side connection limits are rarely the actual ceiling hit in practice.

**7. Performance**
The fix is almost always application code (ensure `using`/`Dispose`/`await using` on every connection and transaction, including on exception paths) rather than a server-side setting; raising `max_connections`-style limits without fixing a leak just delays the same exhaustion at a higher connection count.

**8. Edge Cases**
- Connections held open deliberately for a long-running reporting query — not a leak, a legitimate long transaction; distinguish by checking whether `last_request_end_time` is recent (busy) vs. old (idle-in-transaction / truly abandoned).
- MARS (Multiple Active Result Sets) connections show multiple rows in `sys.dm_exec_connections` per one logical session — don't double-count these as separate leaked connections.
- Pool exhaustion under a *legitimate* traffic spike (not a leak) — the fix here is capacity (larger pool size, read replicas) rather than a code bug.

**9. Production Scenario**
A payment-service background worker opened a `SqlConnection` inside a `catch` block's retry path without disposing the original connection on the failure branch — under intermittent transient failures, connections leaked steadily until the pool was exhausted and new payment requests started failing with pool-timeout errors.

**10. Interview Follow-ups**
1. How do you distinguish a client-pool exhaustion from a server-side limit?
2. What's a safe way to reproduce this in a load test before it hits production?
3. How would connection pooling differ between a single monolith and many microservice instances hitting the same database?
4. What's the risk of just increasing `Max Pool Size`?
5. How does this interact with the transaction-left-open pattern from Q107?

**11. Follow-up Answers**
1. A client-pool exhaustion manifests as a timeout *before* SQL Server even sees a new connection attempt (visible in the app's own pool metrics/exceptions); a true server-side limit manifests as SQL Server actively rejecting logins, visible in the SQL Server error log and connection-attempt DMVs.
2. Run a load test that specifically exercises the exception/retry code paths (not just the happy path), since leaks frequently hide in error-handling branches that normal load testing under healthy conditions never exercises.
3. Each service instance typically maintains its own pool, so total connections against the database scale with instance count × pool size — a fleet of many small instances can exhaust the database's real connection ceiling even with no single instance leaking, which argues for a connection-pooling proxy (e.g., PgBouncer-style pattern, or Azure SQL's built-in pooling) at scale.
4. It raises the ceiling before the same underlying leak causes exhaustion again, while also increasing SQL Server-side resource consumption per idle-but-open connection (memory for session state) — treating the symptom while making the eventual failure larger and more expensive.
5. They're closely related: an idle-in-transaction leaked connection (this question) is frequently also the head of a blocking chain (Q107) if it left an open transaction rather than just an open connection — the DMV signature (`open_tran = 1` on `sys.dm_exec_sessions` for that session) tells you which case you're in.

**12. Common Mistakes**
Restarting the application/IIS pool as the fix — this clears the leaked connections temporarily but doesn't address the underlying code defect, so the leak resumes and exhausts the pool again on the same timeline.

**13. Architect Insight**
A senior engineer finds the leaking sessions and asks the team to fix the `catch` block. An architect asks whether connection/transaction lifetime management should be enforced structurally (a base repository/unit-of-work pattern that guarantees disposal, static analysis rules, or a connection-pooling proxy layer that fails safe) rather than relying on every future engineer remembering to dispose correctly on every exception path.

---

### Q113. A query is fast in SSMS but slow when called from the application — why?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
This is almost always a *different cached plan* for the "same" query text, caused by different `SET` options between SSMS and the application's driver, or parameter sniffing where the app calls with a different first parameter value than your manual SSMS test. SSMS and ADO.NET/ODBC/JDBC drivers frequently default to different `ARITHABORT`/`ANSI_*` settings, and those settings are part of the plan-cache key — so it's genuinely a *different* plan, not the same plan running differently.

**2. SQL Query**
```sql
SELECT
    cp.plan_handle, cp.usecounts, cp.size_in_bytes,
    pa.value AS set_options_bitmask
FROM sys.dm_exec_cached_plans AS cp
CROSS APPLY sys.dm_exec_sql_text(cp.plan_handle) AS st
CROSS APPLY sys.dm_exec_plan_attributes(cp.plan_handle) AS pa
WHERE st.text LIKE '%FROM Trades WHERE Symbol%'
  AND pa.attribute = 'set_options';
```

**3. Explain the Query**
This surfaces every distinct cached plan for statements matching this text along with the `set_options` bitmask each was compiled under; if SSMS's session and the application's session show *different* bitmask values, that confirms they're maintaining two separate cache entries — meaning your fast manual test in SSMS never actually validates the plan the application uses.

**4. Sample Data**
| plan_handle | usecounts | set_options_bitmask |
|---|---|---|
| 0x0700... (SSMS) | 12 | 4347 |
| 0x0900... (app, EF Core) | 480,000 | 251 |

**5. Expected Output**
Two separate plan-cache entries for the same query text with different `set_options` values — SSMS's `ARITHABORT ON`/`ANSI_*` defaults produced one plan, the app driver's defaults produced another, and only the app's plan is the one under actual load.

**6. Alternative Solutions**
- **Match SET options explicitly in SSMS** (`SET ARITHABORT ON; SET ANSI_NULLS ON; ...` to mirror the app's connection string/driver defaults) before testing, so you're actually reproducing the same cache entry — this is the direct fix to the diagnostic gap itself.
- **Query Store**, viewed without any SSMS-vs-app assumption — since it captures plans regardless of which session created them, comparing "all plans for this query_id" surfaces the divergence without needing to know about SET options in advance.
- **Enable `OPTION (RECOMPILE)` temporarily on the app-side call** to see whether a fresh compile under the app's actual runtime parameter/settings fixes it — if yes, this confirms plan-caching/sniffing rather than, say, network latency.
I go to Query Store first in practice, since it makes the "there are two plans" fact obvious immediately, then investigate why they diverge.

**7. Performance**
Once you know it's a SET-options/parameter-sniffing divergence, the fix (matching connection settings, or `OPTIMIZE FOR`/PSP as in Q110) is essentially free at runtime, versus the wasted engineering hours spent looking for an "application network problem" that doesn't exist.

**8. Edge Cases**
- The app uses `sp_executesql` with auto-parameterization while your SSMS test used a hard-coded literal — different code paths into the optimizer entirely, not just different SET options.
- Connection-string-level settings like `Enlist=true`/ambient transaction enrollment can change effective isolation/locking behavior between SSMS and app, independent of SET options.
- The app calls the query inside a larger ambient transaction (e.g., a `TransactionScope` wrapping several statements) that SSMS's single-statement test never replicates, changing lock waits, not the plan itself.

**9. Production Scenario**
An EF Core-generated query against `Trades` ran in single-digit milliseconds every time a developer tested it in SSMS, yet timed out under production load — EF Core's connection defaults had `ARITHABORT OFF`, producing a separate, worse cached plan than the developer's SSMS session (`ARITHABORT ON` by default), each keyed independently in the plan cache.

**10. Interview Follow-ups**
1. Which specific SET option is most commonly the culprit historically, and why?
2. How would you make this reproducible for a teammate who doesn't believe you?
3. Does this apply equally to ad-hoc queries and stored procedures?
4. How does connection pooling interact with this (e.g., pooled connections resetting SET options)?
5. What's the long-term fix so this class of bug doesn't recur?

**11. Follow-up Answers**
1. `ARITHABORT` is the classic historical culprit — older SQL Server versions' query optimizer treated it as plan-cache-affecting, and many client libraries (ODBC/OLE DB defaults) set it differently than SSMS, producing the exact symptom "fast in SSMS, slow from the app" that's been a recurring, well-documented gotcha for years.
2. Reproduce it precisely by explicitly issuing the app's actual SET options in an SSMS window before running the query, rather than relying on SSMS's own connection defaults — that turns "trust me" into a side-by-side, repeatable demonstration.
3. Yes to both, though stored procedures add another wrinkle: the *first* caller's SET options (whichever session/settings compiled the procedure's plan first) determine the initial cached plan for everyone, until eviction/recompile.
4. Connection pooling reuses the underlying physical connection, but *session-level* SET options are typically reset to the pool's/driver's baseline on each logical open unless explicitly changed by the app — so pooling doesn't inherently cause this, but inconsistent SET-option calls sprinkled across different code paths sharing the pool can.
5. Standardize SET options at the connection/driver-configuration level for the whole application (one consistent baseline for every service instance) so there's only ever one relevant plan-cache key for a given query text, and document that baseline so ad-hoc SSMS testing can intentionally match it.

**12. Common Mistakes**
Concluding "the network is slow" or "the app server is underpowered" from this symptom without ever comparing SET options or plans — an entirely plausible-sounding but wrong hypothesis that sends the investigation toward infrastructure instead of the actual plan-cache divergence.

**13. Architect Insight**
A senior engineer matches SET options and fixes the immediate case. A principal engineer standardizes connection configuration across every service touching this database so "fast in SSMS, slow in the app" stops being a recurring class of incident report — turning a one-off fix into an organizational standard.

---

### Q114. Adding an index made the application slower — why?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Every index has to be maintained on every `INSERT`/`UPDATE`/`DELETE` that touches its key or included columns — so on a write-heavy table, a new index can slow writes even while it speeds up the read it was added for. It's also possible the new index gave the optimizer an additional, *worse* option it didn't have before (an index intersection or a suboptimal seek path it now mistakenly prefers), or that it increased lock footprint/contention on an already-hot table.

**2. SQL Query**
```sql
SELECT
    OBJECT_NAME(s.object_id) AS table_name, i.name AS index_name,
    s.leaf_insert_count, s.leaf_update_count, s.leaf_delete_count,
    s.range_scan_count, s.singleton_lookup_count
FROM sys.dm_db_index_operational_stats(DB_ID(), NULL, NULL, NULL) AS s
JOIN sys.indexes AS i ON i.object_id = s.object_id AND i.index_id = s.index_id
WHERE OBJECT_NAME(s.object_id) = 'Trades';
```

**3. Explain the Query**
`sys.dm_db_index_operational_stats` reports per-index write activity (`leaf_insert/update/delete_count`) alongside read activity (`range_scan_count`, `singleton_lookup_count`) — comparing the new index's write counts against its actual read usage tells you whether it's paying for itself, and comparing *all* indexes' write counts before/after the addition shows the added maintenance cost imposed on every one of them for each row change.

**4. Sample Data**
| index_name | leaf_insert_count | leaf_update_count | singleton_lookup_count |
|---|---|---|---|
| PK_Trades | 500,000 | 500,000 | 50 |
| IX_Trades_NewIndex | 500,000 | 500,000 | 12 |

**5. Expected Output**
The new index absorbs the full 500,000 write count of every insert (as expected — every index does), but its own `singleton_lookup_count` (actual reads served) is tiny — it's costing full write overhead for almost no read benefit, a net loss.

**6. Alternative Solutions**
- **Compare index usage stats (`sys.dm_db_index_usage_stats`) before/after** — directly answers "is this index even being used by the plans it was meant to help," the most direct check for "was this index worth it at all."
- **Check execution plans of the write-heavy statements for new lock/latch waits** — rules in or out lock-contention-driven slowdown versus pure I/O/CPU write-maintenance cost.
- **Check whether the new index changed the *read* query's plan for the worse** (e.g., the optimizer now picks a less-selective index due to statistics/cost miscalculation, or an index intersection that's actually slower than the old single-index scan) — the "added a worse option" failure mode, distinct from pure write overhead.
I check usage stats first since it's the fastest way to find "we paid maintenance cost for a nearly-unused index," which is the most common real-world cause of this symptom.

**7. Performance**
If the index isn't earning its write cost, dropping it recovers write throughput immediately; if it *is* needed for a specific critical read path, narrowing it (fewer included columns, a filtered index scoped to only the rows that read path actually needs) reduces the write-maintenance cost while keeping the read benefit.

**8. Edge Cases**
- The new index caused **page splits** on a table with a non-sequential key, adding I/O overhead beyond simple maintenance cost — check `sys.dm_db_index_physical_stats` for fragmentation trending up sharply post-deployment.
- Lock escalation now happens sooner because the new index means more (row) locks are acquired per statement before hitting the same table-lock threshold — see Q107/Q108's lock-escalation mechanics.
- The read query the index was meant to help barely improved (small selectivity gain) while every writer got materially slower — a net-negative trade the team didn't actually measure before shipping.

**9. Production Scenario**
Adding a non-clustered index on `Trades.SettledAt` to speed up an end-of-day settlement report slowed down the real-time trade-insert path noticeably, because trade inserts arrive in high volume with essentially random `SettledAt` ordering at insert time (it's populated later), causing page splits on every batch of inserts into that new index.

**10. Interview Follow-ups**
1. How would you have predicted this before deploying the index?
2. What's the relationship between fill factor and this problem?
3. When is it worth accepting slower writes for faster reads anyway?
4. How does this connect to the "when indexes hurt performance" material in the Indexing file?
5. Would a filtered or included-column redesign have avoided the trade-off entirely?

**11. Follow-up Answers**
1. Load-test the write path specifically (not just validate the target read query got faster) before deploying any new index on a high-write table — measuring only the intended benefit and never the maintenance cost is the root process gap.
2. A lower fill factor leaves free space per page to absorb inserts without immediately splitting, trading some storage/read-density for reduced split frequency — appropriate specifically for indexes on columns with non-sequential/random insert patterns like this one.
3. When the read path is materially more business-critical or more frequent than the write path, and the read improvement is large relative to the write regression — a genuine cost-benefit call the team should make explicitly and measure, not an automatic "indexes are good" assumption.
4. Directly — see `01-Indexing-Query-Execution-Plans.md` Q7 ("when indexes hurt performance"); this question is that principle observed as a live production incident rather than a design-time consideration.
5. Possibly — if the settlement report only needs a handful of columns and only for already-settled trades, a filtered, narrow, off-hot-path index (or even a separate reporting replica/read model) could serve the report without adding maintenance cost to the hot insert path at all.

**12. Common Mistakes**
Adding an index directly in production based solely on "the missing-index DMV/Database Engine Tuning Advisor suggested it" without validating write-path impact — these tools recommend purely from a read-cost-reduction lens and have no visibility into your write-throughput requirements.

**13. Architect Insight**
A senior engineer measures the write regression and either drops or narrows the index. An architect asks whether this table's read and write workloads should be *separated* altogether (an async read-replica or a CQRS read model built via CDC — see the SQL+Microservices file) once indexing trade-offs on a single table start fighting each other at this table's scale and criticality.

---

### Q115. A table has 500 million rows — how would you optimize queries against it?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
At this scale I stop thinking "add an index" as the only lever and think in three layers: partitioning (so most queries and maintenance only ever touch the relevant slice), the right index/columnstore strategy for the actual access pattern (OLTP point lookups vs. analytical aggregation), and archiving (does all 500M rows need to live in the hot, transactional table at all). I'd also revisit whether every query genuinely needs to scan this table live, or whether some should be served from a pre-aggregated/read-model table instead.

**2. SQL Query**
```sql
-- Confirm the actual access pattern before choosing a strategy
SELECT
    range_scan_count, singleton_lookup_count, leaf_insert_count
FROM sys.dm_db_index_operational_stats(DB_ID(), OBJECT_ID('dbo.Trades'), NULL, NULL);
```

**3. Explain the Query**
Before prescribing partitioning or columnstore, I confirm whether this table is predominantly point-lookup (OLTP, favors row-store + selective indexes) or range/aggregate-scan heavy (analytical, favors columnstore) — `singleton_lookup_count` vs `range_scan_count` on the live table answers that empirically rather than by assumption.

**4. Sample Data**
| range_scan_count | singleton_lookup_count | leaf_insert_count |
|---|---|---|
| 850,000 | 42,000,000 | 500,000/day |

**5. Expected Output**
Singleton lookups dominate by orders of magnitude — this is fundamentally an OLTP point-lookup table, so the answer leans toward partitioning + selective/covering indexes + archiving, not a wholesale columnstore conversion (which favors scan-heavy analytical workloads).

**6. Alternative Solutions**
- **Table partitioning by date range** ([docs](https://learn.microsoft.com/en-us/sql/relational-databases/partitions/partitioned-tables-and-indexes?view=sql-server-ver17)) — lets maintenance (index rebuilds, stats updates, even archiving via partition switch) operate on one partition at a time instead of the whole 500M-row table, and lets range-filtered queries benefit from partition elimination.
- **Columnstore index** ([docs](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/columnstore-indexes-overview?view=sql-server-ver17)) — the right call *if and only if* the workload is genuinely scan/aggregate-heavy (a settlement/analytics table, not this OLTP one); a nonclustered columnstore alongside the rowstore clustered index can serve both patterns from one table if truly mixed.
- **Archiving cold data out** (partition switch into an archive table, or an entirely separate cold-storage table/database) — reduces the *hot* table's effective size for every day-to-day query and maintenance operation, which is often the single highest-leverage move at this scale.
Given this table's confirmed OLTP-lookup-heavy profile, I'd lead with partitioning-by-date plus archiving, keep the clustered rowstore index, and only consider a nonclustered columnstore later if a genuinely analytical workload also needs to hit this same table.

**7. Performance**
Partition switching (`ALTER TABLE ... SWITCH PARTITION`) moves/archives large chunks of data as a near-instant metadata operation instead of a row-by-row `DELETE`, avoiding the transaction-log and locking cost a naive bulk delete would impose on a table this size.

**8. Edge Cases**
- Partitioning without a partition-aligned index can still force full-table scans if queries don't filter on the partitioning column — the partitioning key must match the dominant query predicate (usually date) to pay off.
- Foreign keys referencing a partitioned table have specific constraints/considerations in SQL Server; validate referential-integrity design against the partitioning scheme before committing to it.
- Columnstore indexes are poor for high-frequency single-row inserts/updates (much better for batch loads) — applying one to this table's actual OLTP insert pattern would likely make things worse, reinforcing why confirming the access pattern first (step 3) matters.

**9. Production Scenario**
A `Trades` table hit 500M rows after several years of tick-level trade capture; nightly index maintenance started exceeding the maintenance window, and `SettledAt`-range reporting queries scanned far more data than needed since nothing partitioned or archived old, already-settled trades out of the hot path.

**10. Interview Follow-ups**
1. How do you choose the partitioning key when there are multiple candidate date columns?
2. What changes about backup/restore strategy at this table size?
3. Would you consider sharding across databases instead of partitioning within one?
4. How does this interact with the isolation-level/locking material from `02-Transactions-Isolation-Locking.md`?
5. How do you migrate an existing 500M-row table to a partitioned scheme with minimal downtime?

**11. Follow-up Answers**
1. Choose the column that the *majority of high-frequency queries* filter or range-scan on (here, likely `SettledAt` for reporting, or `TradeDate` for regulatory retention) — partitioning optimizes for the dominant access pattern, and a mismatch between partitioning key and query predicates gets you the maintenance benefit without the query-performance benefit.
2. Partitioning enables filegroup-level backup strategies (backing up cold, unchanging partitions/filegroups infrequently and hot/recent ones frequently), which is often necessary once a single full backup of the whole table/database no longer fits the backup window.
3. Sharding (splitting across separate databases/instances) becomes worth considering once you're bottlenecked on a *single instance's* total capacity (CPU/memory/IOPS ceiling) rather than just this one table's manageability — partitioning solves manageability and query-scoping within one instance; sharding solves total-capacity limits across instances, at real added complexity (cross-shard queries, distributed transactions — see the Microservices file).
4. At this scale, lock/latch contention (Q107/Q111) becomes more likely simply from more concurrent activity touching the same hot pages — partitioning also helps here by spreading contention across partitions' distinct page ranges rather than one monolithic B-tree's hottest pages.
5. Typically: create the new partitioned table/scheme alongside the existing one, backfill historical data via partition-aligned bulk loads (or `SWITCH` from a staging table), then cut over new writes with minimal downtime — a live `ALTER TABLE` repartition of a 500M-row table in place is rarely practical without a migration strategy like this.

**12. Common Mistakes**
Assuming "500 million rows automatically means columnstore/data-warehouse patterns" without first confirming the actual read/write mix — applying an analytical-workload solution to a point-lookup OLTP table often makes the dominant workload worse while helping a minority use case.

**13. Architect Insight**
A senior engineer picks a technique (partition, columnstore, archive) that sounds right for "big table." An architect first measures the actual access pattern (as step 2 shows), then picks the *combination* appropriate to that pattern, and explicitly separates "manageability at scale" (partitioning, archiving) from "workload-shape" (rowstore vs. columnstore) as two different problems that happen to both show up once a table crosses this size.

---

### Q116. How would you design SQL Server for high transaction volume?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
High transaction volume design is mostly about minimizing lock footprint and hold time, choosing the right isolation level deliberately, scaling reads away from the primary, and avoiding architectural anti-patterns that create artificial contention (like sequential-key insert hotspots or chatty round-trips inside a transaction). It's a combination of schema/index design, isolation-level choice, connection/transaction discipline in application code, and topology (Always On for read-scale and failover).

**2. SQL Query**
```sql
-- Baseline: identify current hotspot pages/contention before any redesign
SELECT
    OBJECT_NAME(p.object_id) AS table_name,
    wait_stats.wait_type, wait_stats.wait_time_ms
FROM sys.dm_db_index_operational_stats(DB_ID(), NULL, NULL, NULL) AS p
CROSS APPLY (
    SELECT TOP 1 wait_type, wait_time_ms
    FROM sys.dm_os_wait_stats
    WHERE wait_type LIKE 'PAGELATCH%' OR wait_type LIKE 'LCK_M%'
    ORDER BY wait_time_ms DESC
) AS wait_stats;
```

**3. Explain the Query**
Any "design for high transaction volume" answer should be grounded in evidence of where the *current* system already contends — `PAGELATCH`/`LCK_M_*` wait concentration on specific tables points at hotspots (e.g., an ever-increasing identity/sequential key concentrating inserts on the last page of the B-tree) that a redesign needs to specifically target rather than a generic "optimize everything" pass.

**4. Sample Data**
| table_name | wait_type | wait_time_ms |
|---|---|---|
| Payments | PAGELATCH_EX | 4,200,000 |

**5. Expected Output**
Heavy `PAGELATCH_EX` contention on `Payments` points at last-page insert contention — many concurrent transactions all trying to insert into the same "hot" final page because the clustering key is monotonically increasing (an identity or sequential GUID/timestamp).

**6. Alternative Solutions — design levers, in order of typical impact**
- **Short, focused transactions**: validate/compute everything possible *before* opening the transaction; commit as soon as the durable write is done. Directly reduces lock hold time, the single biggest lever against blocking (Q107) at volume.
- **RCSI (Read Committed Snapshot Isolation)** for the database: removes reader/writer blocking for the common case, letting high-volume read traffic coexist with concurrent writes without queuing behind row/page locks — at the cost of tempdb version-store overhead, which must be capacity-planned.
- **Avoiding hot-page insert contention**: a non-sequential clustering key (or `SEQUENCE`s bucketed to spread inserts) — or, if a sequential key is required for range-scan efficiency, techniques like table partitioning by a hash/mod of the key to spread inserts across multiple "last pages" — to solve exactly the `PAGELATCH_EX` pattern surfaced above.
- **Read scaling via Always On Availability Groups** ([docs](https://learn.microsoft.com/en-us/sql/database-engine/availability-groups/windows/overview-of-always-on-availability-groups-sql-server?view=sql-server-ver17)) readable secondaries: routes reporting/read-heavy traffic off the primary entirely, leaving the primary's capacity for writes.
- **Batching**: combining many small single-row transactions into batched multi-row operations where business semantics allow it, amortizing log-flush (`WRITELOG`) cost across more work per commit.
I'd sequence these by evidence: fix the hot-page contention first if wait stats show it (as here), then transaction-shortening/RCSI as standing discipline, then Always On read-scaling once the primary's write capacity is otherwise healthy.

**7. Performance**
Each lever targets a distinct wait-stat signature (`PAGELATCH_EX` → key/insert-pattern fix; `LCK_M_*` → transaction-shortening/RCSI; `WRITELOG` → batching/log-disk provisioning) — treating "high transaction volume" as one undifferentiated problem, rather than mapping symptom to specific lever, is how teams end up applying the wrong fix.

**8. Edge Cases**
- RCSI's tempdb version-store growth under very high write volume can itself become the new bottleneck if tempdb isn't sized/provisioned for it — a trade-off, not a free win.
- A non-sequential clustering key improves insert distribution but can hurt range-scan queries that benefit from physical row ordering — the trade-off must be weighed against the table's actual read patterns (see Q115's "confirm the access pattern first" principle).
- Always On readable secondaries introduce replication lag — reports run there may show slightly stale data, which must be acceptable to the business use case reading from them.

**9. Production Scenario**
A payments-ingestion table used an ever-increasing `BIGINT IDENTITY` clustering key; at peak volume, concurrent payment-insert transactions from many application instances all contended for the same last page of the clustered index, capping insert throughput well below what the hardware could otherwise sustain — diagnosed exactly via the `PAGELATCH_EX` wait-stat signature above, fixed by redesigning the clustering strategy and shortening transaction scope.

**10. Interview Follow-ups**
1. Why not just use `NEWID()` for the key to avoid sequential contention?
2. How does this design change if strict ordering of transactions matters (e.g., ledger entries)?
3. What's the throughput cost of RCSI, concretely?
4. How would you validate a redesign like this before rolling it out to production?
5. At what point would you consider moving off a single relational primary entirely (sharding/other stores)?

**11. Follow-up Answers**
1. A fully random `NEWID()` clustering key trades last-page contention for severe fragmentation (random insert points scattered across the whole index, causing page splits everywhere) and poor range-scan locality — often a worse trade overall than a well-chosen sequential-but-bucketed or `NEWSEQUENTIALID()`-style approach; the fix should target the actual contention pattern, not swap one problem for a different one.
2. Strict-ordering requirements (a ledger, per `14-SQL-and-FinTech.md`) push back toward accepting some serialization at the point of the ordering-critical write (e.g., a per-account sequence number generated within the same transaction) — you can still shorten and optimize everything *around* that unavoidable serialization point, but you can't fully parallelize away an inherently ordered append.
3. RCSI's cost is primarily in tempdb: every modified row's prior version is stored in the version store until no active snapshot still needs it, so write-heavy, long-running-read-concurrent workloads need tempdb sized and monitored for version-store growth, plus a small CPU/IO cost per write to maintain versions.
4. Load-test the redesign against a production-scale, production-shaped dataset (not a small dev copy — hot-page contention specifically requires realistic concurrency and data volume to reproduce), and validate via the same wait-stat query used to diagnose the original problem, confirming the specific wait type actually drops.
5. Once you've applied the relational levers above and are still capacity-constrained by a *single instance's* total throughput ceiling (not a design defect within that instance) — that's the point sharding or moving specific workloads to a purpose-built store (event log, specialized ledger store) becomes a capacity conversation rather than a tuning one, echoing Q115's partitioning-vs-sharding distinction.

**12. Common Mistakes**
Treating "high transaction volume" as purely a hardware/scaling question (bigger VM, more cores) without first fixing schema-level contention patterns like hot-page inserts or long transaction spans — hardware masks these problems temporarily and re-exposes them at the next growth milestone.

**13. Architect Insight**
A senior engineer applies RCSI and shortens transactions. A principal/architect additionally designs the *evidence loop*: which wait-stat signature would tell us this design is holding up as volume keeps growing, and at what specific threshold does the team revisit sharding versus simply provisioning more of the same — turning a one-time redesign into a monitored, revisitable capacity model instead of a "fixed it, done" answer.

---

## SQL INTERVIEW CHALLENGE — Practice Mode

To use this file interactively: ask me one troubleshooting scenario from this list at a time (by number, e.g. "Q107"), without revealing the answer above. I'll describe my investigation approach and the diagnostic queries I'd run; you evaluate on Correctness/10, Query quality/10, Performance/10, Edge cases/10, and Senior-level reasoning/10, then show what I did right, what I missed, the reference answer above, and a follow-up question — per the workbook's standing Interview Challenge Mode (see `15-Interview-Challenge-Mode.md`).

---

## References

1. [sys.dm_exec_query_stats (Transact-SQL)](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-exec-query-stats-transact-sql?view=sql-server-ver17)
2. [sys.dm_os_wait_stats (Transact-SQL)](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-os-wait-stats-transact-sql?view=sql-server-ver17)
3. [SQL Server Deadlocks Guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-deadlocks-guide?view=sql-server-ver17)
4. [Use the system_health session](https://learn.microsoft.com/en-us/sql/relational-databases/extended-events/use-the-system-health-session?view=sql-server-ver16)
5. [sys.dm_exec_requests (Transact-SQL)](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-exec-requests-transact-sql)
6. [sys.dm_exec_sessions (Transact-SQL)](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-exec-sessions-transact-sql?view=sql-server-ver17)
7. [sys.dm_exec_connections (Transact-SQL)](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-exec-connections-transact-sql?view=sql-server-ver17)
8. [Trace Flags (Transact-SQL) — includes 1222](https://learn.microsoft.com/en-us/sql/t-sql/database-console-commands/dbcc-traceon-trace-flags-transact-sql?view=sql-server-ver17)
9. [How It Works: SQL Server Deadlock Trace Flag 1222 Output](https://learn.microsoft.com/en-us/archive/blogs/bobsql/how-it-works-sql-server-deadlock-trace-flag-1222-output)
10. [Columnstore indexes: Overview](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/columnstore-indexes-overview?view=sql-server-ver17)
11. [Partitioned Tables and Indexes](https://learn.microsoft.com/en-us/sql/relational-databases/partitions/partitioned-tables-and-indexes?view=sql-server-ver17)
12. [What is an Always On Availability Group?](https://learn.microsoft.com/en-us/sql/database-engine/availability-groups/windows/overview-of-always-on-availability-groups-sql-server?view=sql-server-ver17)
13. [Server Configuration: max degree of parallelism](https://learn.microsoft.com/en-us/sql/database-engine/configure-windows/configure-the-max-degree-of-parallelism-server-configuration-option?view=sql-server-ver17)
14. [sys.dm_os_schedulers (Transact-SQL)](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-os-schedulers-transact-sql)
15. [Parameter Sensitive Plan Optimization](https://learn.microsoft.com/en-us/sql/relational-databases/performance/parameter-sensitive-plan-optimization?view=sql-server-ver17)
16. [Transaction Locking and Row Versioning Guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide?view=sql-server-ver17)
17. [Resolve Blocking Problems Caused by Lock Escalation](https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/performance/resolve-blocking-problems-caused-lock-escalation)
18. [Monitor Performance by Using the Query Store](https://learn.microsoft.com/en-us/sql/relational-databases/performance/monitoring-performance-by-using-the-query-store?view=sql-server-ver17)
19. [Query Processing Architecture Guide](https://learn.microsoft.com/en-us/sql/relational-databases/query-processing-architecture-guide?view=sql-server-ver17)
