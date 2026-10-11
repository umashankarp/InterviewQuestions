(function (r) {
registerTopic('04-sql-server', {
related: ['05-postgresql', '56-linq-efcore', '29-performance-engineering'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['indexes'],
  code: r`~~~sql
CREATE TABLE dbo.Orders (
  OrderId    bigint IDENTITY(1,1) NOT NULL,
  PublicId   uniqueidentifier NOT NULL DEFAULT NEWSEQUENTIALID(),
  CustomerId bigint NOT NULL,
  CreatedUtc datetime2(3) NOT NULL,
  Total      decimal(19,4) NOT NULL,
  CONSTRAINT PK_Orders PRIMARY KEY CLUSTERED (OrderId)            -- narrow, unique, static, ever-increasing
);
CREATE UNIQUE NONCLUSTERED INDEX UX_Orders_PublicId ON dbo.Orders (PublicId);   -- leaf carries OrderId as locator
CREATE NONCLUSTERED INDEX IX_Orders_Customer ON dbo.Orders (CustomerId, CreatedUtc DESC);
~~~`,
  q: r`What is the difference between a clustered and a non-clustered index?`,
  a: r`A **clustered index** *is* the table: the leaf level of the B+tree holds the data rows, sorted by the clustering key. There can be only one. A table without one is a **heap**.

A **non-clustered index** is a separate B+tree whose leaf rows hold the index key plus a **row locator**: the clustering key (if the table is clustered) or a RID (for heaps). Fetching columns not in the index requires a **key lookup** back into the clustered index.

Choosing the clustering key: **narrow, unique, static, ever-increasing** (e.g. {{BIGINT IDENTITY}}), because it is copied into every non-clustered index and drives page splits. A random {{UNIQUEIDENTIFIER}} ({{NEWID()}}) causes fragmentation and page splits; {{NEWSEQUENTIALID()}} or a bigint key avoids that.`,
  pts: [r`Clustered = the table, one per table`, r`Non-clustered leaf holds the clustering key`, r`Key lookups cost random I/O`, r`Narrow, unique, static, increasing clustering key`],
  ex: r`An orders table clustered on a {{NEWID()}} GUID had 99% fragmentation and heavy page splits; reclustering on {{BIGINT IDENTITY}} and keeping the GUID as a non-clustered unique key fixed insert latency.`,
  fu: [r`What is a heap and when is it acceptable?`, r`Why does a wide clustering key bloat every index?`],
  pit: [r`Saying "a clustered index is physically sorted on disk". Logically ordered by key; pages are linked, not necessarily contiguous.`],
  tip: r`Mention the clustering key being copied into every non-clustered index. It shows you understand the storage cost.` },

{ id: 'q2', level: 'Basic', tags: ['indexes'],
  q: r`What is a covering index and what are INCLUDE columns?`,
  a: r`A query is **covered** when one index contains every column it needs, so SQL Server never touches the base table (no key lookup).

{{INCLUDE}} columns are stored only at the leaf level of a non-clustered index: they make the index covering without widening the key (keys are limited to 16 columns / 1,700 bytes and are sorted; included columns are not).

~~~sql
CREATE NONCLUSTERED INDEX IX_Orders_Customer_Date
ON dbo.Orders (CustomerId, OrderDate DESC)
INCLUDE (Status, TotalAmount);
-- covers: SELECT OrderDate, Status, TotalAmount FROM dbo.Orders WHERE CustomerId = @c ORDER BY OrderDate DESC
~~~

Trade-off: every index slows writes (each insert/update maintains it) and takes space and buffer-pool memory. Cover the hot queries, not all queries.`,
  pts: [r`Covering avoids key lookups`, r`INCLUDE adds leaf-only columns`, r`Key columns for seek and order, INCLUDE for retrieval`, r`Every index taxes writes`],
  ex: r`A dashboard query doing 40,000 key lookups per call dropped from 900 ms to 12 ms with one covering index.`,
  fu: [r`When does the optimiser choose a scan over seek + lookups?`],
  pit: [r`Adding INCLUDE (*)-style indexes that duplicate the whole table.`] },

{ id: 'q3', level: 'Basic', tags: ['transactions', 'acid'],
  code: r`~~~sql
SET XACT_ABORT ON;               -- any error rolls the whole transaction back
BEGIN TRAN;
  UPDATE dbo.Accounts SET Balance -= 100 WHERE AccountId = 1;
  UPDATE dbo.Accounts SET Balance += 100 WHERE AccountId = 2;
COMMIT;                          -- returns only after the log records are hardened (WAL)
-- Is the log the bottleneck?
SELECT wait_type, waiting_tasks_count, wait_time_ms FROM sys.dm_os_wait_stats WHERE wait_type = 'WRITELOG';
ALTER DATABASE Payments SET ACCELERATED_DATABASE_RECOVERY = ON;   -- fast rollback and recovery (2019+)
~~~`,
  q: r`Explain ACID and how SQL Server implements durability.`,
  a: r`- **Atomicity**: all or nothing; undo via the transaction log.
- **Consistency**: constraints hold before and after.
- **Isolation**: concurrent transactions do not interfere (per the isolation level).
- **Durability**: once committed, survives a crash.

SQL Server uses **write-ahead logging (WAL)**: changes are written to the transaction log and the log is hardened to disk **before** commit returns; data pages are written later by checkpoints and the lazy writer. On restart, **crash recovery** redoes committed work and undoes uncommitted work from the log (Accelerated Database Recovery makes undo near-instant using a persistent version store).

Implication: log write latency is on the commit path, so put the log on fast, low-latency storage; and {{DELAYED_DURABILITY}} trades durability for throughput.`,
  pts: [r`WAL: log hardened before commit returns`, r`Recovery: redo and undo`, r`Log latency = commit latency`, r`ADR speeds recovery and rollback`],
  ex: r`A high-insert payments service was bottlenecked on {{WRITELOG}} waits; moving the log to low-latency storage and batching commits fixed it.`,
  fu: [r`What is the difference between a checkpoint and the lazy writer?`, r`What does delayed durability risk?`],
  pit: [r`Thinking data pages must be flushed at commit.`] },

{ id: 'q4', level: 'Basic', tags: ['isolation'],
  code: r`~~~sql
ALTER DATABASE Shop SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;   -- RCSI: readers stop blocking writers
ALTER DATABASE Shop SET ALLOW_SNAPSHOT_ISOLATION ON;
SET TRANSACTION ISOLATION LEVEL SNAPSHOT;
BEGIN TRAN;
  SELECT Balance FROM dbo.Accounts WHERE AccountId = 1;     -- consistent view for the whole transaction
  UPDATE dbo.Accounts SET Balance -= 10 WHERE AccountId = 1; -- error 3960 if another txn changed this row meanwhile
COMMIT;
~~~`,
  q: r`List SQL Server isolation levels and the anomalies each prevents.`,
  a: r`| Level | Dirty read | Non-repeatable read | Phantom | Mechanism |
|---|---|---|---|---|
| READ UNCOMMITTED / NOLOCK | possible | possible | possible | No shared locks |
| READ COMMITTED (default) | no | possible | possible | Short shared locks |
| READ COMMITTED SNAPSHOT (RCSI) | no | possible | possible | Row versions, statement-level snapshot |
| REPEATABLE READ | no | no | possible | Shared locks held to end |
| SNAPSHOT | no | no | no* | Transaction-level row versions; update conflicts error 3960 |
| SERIALIZABLE | no | no | no | Key-range locks |

*Snapshot gives a consistent view but can allow **write skew**.

Most OLTP systems should enable **RCSI**: readers do not block writers and vice versa, at the cost of tempdb version-store usage. Note {{NOLOCK}} can return rows twice, skip rows, or read uncommitted data that is later rolled back.`,
  pts: [r`Default is READ COMMITTED (locking)`, r`RCSI removes reader/writer blocking`, r`SNAPSHOT can raise update conflicts`, r`NOLOCK is not "faster safe reads"`],
  ex: r`Enabling RCSI on an order system removed most blocking chains between reporting reads and checkout writes.`,
  fu: [r`What is write skew?`, r`Why can NOLOCK miss rows or read them twice?`],
  pit: [r`Sprinkling NOLOCK to "fix" blocking.`] },

{ id: 'q5', level: 'Basic', tags: ['joins'],
  code: r`~~~sql
-- NOT IN with a NULL in the subquery returns no rows; NOT EXISTS is safe and usually a clean anti semi join
SELECT c.CustomerId FROM dbo.Customers c
WHERE NOT EXISTS (SELECT 1 FROM dbo.Orders o WHERE o.CustomerId = c.CustomerId);
-- CROSS APPLY: top-N per group (latest 3 orders per customer)
SELECT c.CustomerId, x.OrderId, x.CreatedUtc
FROM dbo.Customers c
CROSS APPLY (SELECT TOP (3) OrderId, CreatedUtc FROM dbo.Orders o WHERE o.CustomerId = c.CustomerId ORDER BY CreatedUtc DESC) x;
~~~`,
  q: r`Explain join types and the physical join algorithms SQL Server uses.`,
  a: r`Logical joins: {{INNER}}, {{LEFT/RIGHT/FULL OUTER}}, {{CROSS}}, plus {{CROSS APPLY}} / {{OUTER APPLY}} (correlated, like a lateral join), and semi/anti joins from {{EXISTS}} / {{NOT EXISTS}}.

Physical operators the optimiser picks:

- **Nested loops**: for each outer row, seek the inner. Best when the outer input is small and the inner is indexed.
- **Merge join**: both inputs sorted on the join key; linear. Great for large, pre-sorted inputs.
- **Hash match**: builds a hash table on the smaller input, probes with the other. Good for large unsorted inputs; needs a memory grant and spills to tempdb if under-estimated.
- **Adaptive join** (2017+, batch mode): decides between hash and nested loops at runtime based on actual row count.

Bad cardinality estimates are the usual reason for a wrong choice.`,
  pts: [r`Nested loops, merge, hash, adaptive`, r`Choice driven by estimates and indexes`, r`Hash spills = memory grant too small`, r`NOT EXISTS preferred over NOT IN with NULLs`],
  ex: r`A query chose nested loops expecting 10 rows but got 2 million; updating statistics switched it to a hash join and runtime fell from minutes to seconds.`,
  fu: [r`Why can NOT IN return no rows when the subquery contains NULL?`],
  pit: [r`Forcing join hints instead of fixing statistics or indexes.`] },

{ id: 'q6', level: 'Basic', tags: ['window-functions'],
  q: r`Explain window functions with a practical example.`,
  a: r`Window functions compute values across a set of rows related to the current row **without collapsing them** (unlike GROUP BY).

- Ranking: {{ROW_NUMBER}}, {{RANK}}, {{DENSE_RANK}}, {{NTILE}}.
- Offset: {{LAG}}, {{LEAD}}, {{FIRST_VALUE}}, {{LAST_VALUE}}.
- Aggregates over a frame: {{SUM(...) OVER (PARTITION BY ... ORDER BY ... ROWS BETWEEN ...)}}.

~~~sql
SELECT AccountId, TxnDate, Amount,
       SUM(Amount) OVER (PARTITION BY AccountId ORDER BY TxnDate, TxnId
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS RunningBalance,
       Amount - LAG(Amount) OVER (PARTITION BY AccountId ORDER BY TxnDate, TxnId) AS DeltaFromPrev
FROM dbo.Transactions;
~~~

Specify {{ROWS}} explicitly: the default frame with ORDER BY is {{RANGE UNBOUNDED PRECEDING}}, which is slower (on-disk spool) and treats ties together. A supporting index on (partition, order) columns avoids a sort.`,
  pts: [r`No row collapse`, r`PARTITION BY + ORDER BY + frame`, r`Prefer ROWS over default RANGE`, r`Index (partition, order) to avoid sorts`],
  ex: r`Running balances for statements computed in one pass instead of a correlated subquery that was O(n²).`,
  fu: [r`ROW_NUMBER vs RANK vs DENSE_RANK on ties?`],
  pit: [r`Non-deterministic ORDER BY in ROW_NUMBER (add a unique tiebreaker).`] },

{ id: 'q7', level: 'Intermediate', tags: ['execution-plans'],
  code: r`~~~sql
SET STATISTICS IO, TIME ON;
SELECT o.OrderId, o.Total FROM dbo.Orders o WHERE o.CustomerId = @c AND o.CreatedUtc >= @from;
-- Actual plan red flags: Estimated 1 vs Actual 2,000,000 rows; Key Lookup x 40,000; Sort/Hash spill warnings;
-- CONVERT_IMPLICIT in a seek predicate; Table/Clustered Index Scan for a selective filter
SELECT TOP (20) qs.total_logical_reads / qs.execution_count AS avg_reads, qp.query_plan
FROM sys.dm_exec_query_stats qs CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
ORDER BY avg_reads DESC;
~~~`,
  q: r`How do you read an execution plan, and what are the red flags?`,
  a: r`Read **right to left, top to bottom** (data flows leftward); compare **estimated vs actual rows** on each operator (use the actual plan or Query Store / {{SET STATISTICS IO, TIME ON}}).

Red flags:

- Large estimate vs actual mismatch (stale stats, parameter sniffing, non-SARGable predicates, table variables, multi-statement TVFs).
- **Key lookups** executed thousands of times.
- **Scans** of large tables where a seek was expected.
- **Implicit conversions** ({{CONVERT_IMPLICIT}}) on columns, killing index seeks.
- **Spills** to tempdb on sort/hash (warning icon), excessive memory grants.
- **Sort** operators on large inputs (missing index order).
- **Parallelism** on small queries, or serial plans caused by scalar UDFs.
- Warnings: missing index suggestions (treat as hints, not orders).

Logical reads (from STATISTICS IO) are the most stable metric to compare versions of a query.`,
  pts: [r`Estimated vs actual rows`, r`Lookups, scans, spills, implicit conversions`, r`Logical reads as the comparison metric`],
  ex: r`An {{nvarchar}} parameter compared to a {{varchar}} column caused CONVERT_IMPLICIT and a scan of 50M rows; fixing the parameter type restored the seek.`,
  fu: [r`What is a residual predicate?`],
  pit: [r`Trusting estimated cost percentages as if they were real time.`] },

{ id: 'q8', level: 'Intermediate', tags: ['sargability'],
  code: r`~~~sql
-- Non-SARGable: function on the column, implicit conversion, leading wildcard
WHERE YEAR(CreatedUtc) = 2026
WHERE CONVERT(date, CreatedUtc) = '2026-10-10'          -- (this one is actually SARGable via a special rule, but avoid relying on it)
WHERE AccountNumber = 12345                              -- varchar column vs int literal -> CONVERT_IMPLICIT scan
WHERE Email LIKE '%@example.com'
-- SARGable rewrites
WHERE CreatedUtc >= '2026-01-01' AND CreatedUtc < '2027-01-01'   -- half-open range
WHERE AccountNumber = '12345'
-- C#: match the parameter type to the column (varchar, not nvarchar)
cmd.Parameters.Add("@acct", SqlDbType.VarChar, 20).Value = acct;
~~~`,
  q: r`What does SARGable mean, and give examples of non-SARGable predicates.`,
  a: r`A predicate is **SARGable** (Search ARGument-able) when the engine can use an index seek on it: the column appears bare on one side.

Non-SARGable → fix:

| Bad | Good |
|---|---|
| {{WHERE YEAR(OrderDate) = 2026}} | {{WHERE OrderDate >= '2026-01-01' AND OrderDate < '2027-01-01'}} |
| {{WHERE LEFT(Name, 3) = 'Smi'}} | {{WHERE Name LIKE 'Smi%'}} |
| {{WHERE Amount * 1.1 > 100}} | {{WHERE Amount > 100 / 1.1}} |
| {{WHERE ISNULL(Status, 'X') = 'A'}} | {{WHERE Status = 'A'}} |
| {{WHERE Email LIKE '%@x.com'}} | Persisted computed column (reversed) or full-text |
| varchar column vs nvarchar parameter | Match parameter type to column |

Also: {{OR}} across different columns can block seeks (rewrite as {{UNION ALL}} or rely on index union), and functions in JOIN conditions have the same effect.`,
  pts: [r`Keep the column bare`, r`Ranges instead of functions on dates`, r`Match data types`, r`Computed columns for expressions`],
  ex: r`Rewriting {{CAST(CreatedAt AS date) = @d}} as a half-open range cut a query from 4 s to 30 ms. (SQL Server can sometimes seek on the date cast, but the explicit range is reliable.)`,
  fu: [r`How can a computed column be indexed?`],
  pit: [r`BETWEEN with datetime end-of-day boundaries instead of half-open ranges.`] },

{ id: 'q9', level: 'Intermediate', tags: ['statistics'],
  code: r`~~~sql
SELECT s.name, sp.last_updated, sp.rows, sp.rows_sampled, sp.modification_counter
FROM sys.stats s CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE s.object_id = OBJECT_ID('dbo.Orders');
UPDATE STATISTICS dbo.Orders IX_Orders_Customer WITH FULLSCAN;
-- ascending-key problem: new rows beyond the histogram are estimated badly; 2014+ CE helps, so do frequent updates
ALTER DATABASE SCOPED CONFIGURATION SET LEGACY_CARDINALITY_ESTIMATION = OFF;
~~~`,
  q: r`What are statistics, and why do stale statistics cause bad plans?`,
  a: r`Statistics are histograms (up to 200 steps) plus density information on columns/indexes. The optimiser uses them to **estimate row counts** (cardinality), which drive join type, memory grants, parallelism, and index choice.

Stale or coarse stats produce wrong estimates. Auto-update triggers after a threshold of modifications (dynamic threshold since 2016 compat level: roughly sqrt(1000 × rows) for large tables), which can still be too late for ascending keys (new dates fall beyond the histogram's last step).

Maintenance: keep {{AUTO_UPDATE_STATISTICS}} on (consider async for latency-sensitive OLTP), add scheduled updates for volatile large tables (Ola Hallengren's scripts), use {{FULLSCAN}} where sampling misleads, and create multi-column stats for correlated predicates. Inspect with {{DBCC SHOW_STATISTICS}} / {{sys.dm_db_stats_properties}}.`,
  pts: [r`Estimates drive every plan decision`, r`Auto-update threshold may lag`, r`Ascending-key problem`, r`Scheduled maintenance for hot tables`],
  ex: r`Nightly loads added a day of data beyond the histogram; morning queries estimated 1 row and chose nested loops until stats were updated post-load.`,
  fu: [r`What is the cardinality estimator version and how does compat level affect it?`],
  pit: [r`Rebuilding indexes daily "to fix performance" when it was the stats update that helped.`] },

{ id: 'q10', level: 'Intermediate', tags: ['parameter-sniffing'],
  code: r`~~~sql
CREATE OR ALTER PROCEDURE dbo.GetOrdersByCustomer @CustomerId bigint AS
SELECT OrderId, Total FROM dbo.Orders WHERE CustomerId = @CustomerId
OPTION (OPTIMIZE FOR (@CustomerId UNKNOWN));     -- or RECOMPILE for highly skewed, infrequent queries
-- Query Store: force the known-good plan while you fix the root cause
EXEC sp_query_store_force_plan @query_id = 4711, @plan_id = 12;
-- SQL Server 2022: Parameter Sensitive Plan optimization keeps multiple plans per skew bucket
ALTER DATABASE SCOPED CONFIGURATION SET PARAMETER_SENSITIVE_PLAN_OPTIMIZATION = ON;
~~~`,
  q: r`What is parameter sniffing and how do you fix a bad case?`,
  a: r`On first compile, SQL Server optimises a parameterised query for the **values passed that time** and caches the plan. If data is skewed (one customer with 5 million orders, most with 10), the cached plan may be terrible for other values.

Fixes, roughly in order of preference:

1. **Better indexing** so one plan is good for all values.
2. **{{OPTION (RECOMPILE)}}** for infrequent, expensive queries (compile cost every time).
3. **{{OPTIMIZE FOR (@p = value)}}** or **{{OPTIMIZE FOR UNKNOWN}}** (density-based average plan).
4. **Query Store plan forcing** of a known-good plan (and monitor it).
5. **Parameter Sensitive Plan optimisation (SQL Server 2022, compat 160)**: caches multiple plans per predicate value range automatically.
6. Splitting into separate procedures/branches for known outlier classes.

Avoid "local variable" tricks without understanding them (they also produce a density-based plan).`,
  pts: [r`Plan built for first values`, r`Skew makes it hurt`, r`RECOMPILE, OPTIMIZE FOR, Query Store forcing`, r`PSP optimisation in 2022`],
  ex: r`A dashboard was fast for small merchants and timed out for the largest; Query Store showed two plans and forcing the hash-join plan stabilised it.`,
  fu: [r`How do you detect parameter sniffing in production?`],
  pit: [r`Clearing the whole plan cache (DBCC FREEPROCCACHE) as a fix.`] },

{ id: 'q11', level: 'Intermediate', tags: ['locking', 'blocking'],
  code: r`~~~sql
-- Who is blocking whom right now?
SELECT r.session_id, r.blocking_session_id, r.wait_type, r.wait_time, t.text
FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE r.blocking_session_id <> 0;
EXEC sp_WhoIsActive @find_block_leaders = 1, @get_locks = 1;
-- Escalation (~5,000 locks on one object): batch big updates
WHILE 1 = 1
BEGIN
  UPDATE TOP (4000) dbo.Orders SET Archived = 1 WHERE CreatedUtc < '2024-01-01' AND Archived = 0;
  IF @@ROWCOUNT = 0 BREAK;
END
~~~`,
  q: r`Explain locking, lock escalation and how to investigate blocking.`,
  a: r`SQL Server takes locks at row/key, page, and object level with modes **S** (shared), **U** (update), **X** (exclusive), **IS/IX** (intent), **Sch-S/Sch-M** (schema). Locks are held according to isolation level; X locks until commit.

**Lock escalation**: when one statement holds about 5,000 locks on an object, SQL Server tries to escalate to a table (or partition) lock, which can block everyone. Mitigate by batching large modifications, indexing so fewer rows are touched, or {{LOCK_ESCALATION = AUTO}} on partitioned tables.

Investigate blocking: {{sys.dm_exec_requests}} ({{blocking_session_id}}, {{wait_type}}), {{sys.dm_tran_locks}}, {{sp_WhoIsActive}}, the **blocked process report** (Extended Events) and Query Store wait stats. Find the **head blocker**: often an open transaction waiting on the application (a long transaction with a network call inside).`,
  pts: [r`Lock modes and intent locks`, r`Escalation at ~5,000 locks`, r`Find the head blocker`, r`Long transactions are the usual cause`],
  ex: r`The head blocker was a transaction left open while the API called a payment provider for 20 seconds; moving the call outside the transaction removed the blocking.`,
  fu: [r`What is the difference between blocking and deadlock?`],
  pit: [r`Holding transactions across network calls or user think time.`] },

{ id: 'q12', level: 'Intermediate', tags: ['deadlocks'],
  code: r`~~~sql
-- Capture deadlock graphs from the built-in system_health session
SELECT CAST(event_data AS xml) AS deadlock
FROM sys.fn_xe_file_target_read_file('system_health*.xel', NULL, NULL, NULL)
WHERE object_name = 'xml_deadlock_report';
~~~
~~~csharp
// Fix the cause (consistent order, indexes, short txns) and retry the victim (error 1205)
var retry = new ResiliencePipelineBuilder().AddRetry(new RetryStrategyOptions
{
    ShouldHandle = new PredicateBuilder().Handle<SqlException>(e => e.Number == 1205),
    MaxRetryAttempts = 3, BackoffType = DelayBackoffType.Exponential, UseJitter = true
}).Build();
await retry.ExecuteAsync(async ct => await transfers.ExecuteAsync(cmd, ct), ct);
~~~`,
  q: r`How do deadlocks happen and how do you resolve them?`,
  a: r`A deadlock is a cycle: session A holds a lock B needs while B holds one A needs. The lock monitor detects it (every few seconds or faster when frequent) and kills the cheapest victim with **error 1205**.

Common causes: transactions touching tables in different orders; a key lookup vs an update on the same index (reader holds non-clustered, writer holds clustered); missing indexes causing scans that lock many rows; SERIALIZABLE range locks; upgrade patterns (read then update without {{UPDLOCK}}).

Resolution:

1. Capture the **deadlock graph** (system_health XE session has it by default).
2. Fix root causes: consistent access order, covering indexes to remove lookups, shorter transactions, {{UPDLOCK}} for read-then-write, RCSI to remove reader participation.
3. **Retry** the victim transaction in the application (with backoff) because some deadlocks remain possible.`,
  pts: [r`Cycle of waits; 1205 victim`, r`Deadlock graph from system_health`, r`Consistent order, covering indexes, short transactions`, r`Application retry for 1205`],
  ex: r`~~~sql
BEGIN TRAN;
SELECT Balance FROM dbo.Accounts WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id; -- prevents read-then-update deadlock
UPDATE dbo.Accounts SET Balance = Balance - @amt WHERE Id = @id;
COMMIT;
~~~`,
  fu: [r`Why does a key lookup cause deadlocks with updates?`],
  pit: [r`Using NOLOCK to "fix" deadlocks.`] },

{ id: 'q13', level: 'Intermediate', tags: ['t-sql', 'query', 'window-functions'],
  q: r`Write a query for the second highest salary, then generalise to the Nth highest, overall and per department.`,
  a: r`The most frequently asked T-SQL question. A strong answer shows several methods, then handles the cases the interviewer is really testing: **ties**, **no Nth value** (return NULL, not an empty set) and **per-group** versions.

### Method choice
| Method | Ties | Per department | Notes |
|---|---|---|---|
| {{MAX ... WHERE salary < (SELECT MAX ...)}} | handled (distinct values) | awkward | Only for 2nd highest |
| {{DENSE_RANK() = N}} | Nth distinct salary, returns all tied people | {{PARTITION BY}} | The usual best answer |
| {{OFFSET N-1 ROWS FETCH NEXT 1}} on {{DISTINCT}} | handled with DISTINCT | no | Clean for a single value |
| {{TOP 1 ... FROM (TOP N DISTINCT ... DESC) ORDER BY ASC}} | handled | no | Classic pre-2012 trick |
| Correlated {{COUNT(DISTINCT)}} | handled | yes | O(n²): mention, do not use on big tables |

### Ties: RANK vs DENSE_RANK vs ROW_NUMBER
Salaries 100, 100, 90: {{ROW_NUMBER}} gives 1,2,3 (90 is "3rd"), {{RANK}} gives 1,1,3 (no 2nd), {{DENSE_RANK}} gives 1,1,2 (90 is the 2nd highest). "Nth highest salary" almost always means the Nth **distinct** value, so use DENSE_RANK, and say so.

### Edge cases
- Fewer than N distinct salaries: wrap in a scalar subquery so the result is one row with NULL.
- NULL salaries: exclude explicitly ({{WHERE Salary IS NOT NULL}}); NULLs sort lowest in DESC order but you should not rely on that.
- Performance: an index on {{(DepartmentId, Salary DESC)}} lets the per-department version read only the top rows of each partition.`,
  code: r`~~~sql
-- 2nd highest (classic)
SELECT MAX(Salary) AS SecondHighest FROM dbo.Employees
WHERE Salary < (SELECT MAX(Salary) FROM dbo.Employees);

-- Nth highest distinct salary; returns NULL when it does not exist
DECLARE @N int = 3;
SELECT (SELECT DISTINCT Salary FROM dbo.Employees WHERE Salary IS NOT NULL
        ORDER BY Salary DESC OFFSET @N - 1 ROWS FETCH NEXT 1 ROWS ONLY) AS NthHighest;

-- Nth highest with the employees who earn it (ties included), per department
WITH ranked AS (
  SELECT e.EmployeeId, e.Name, e.DepartmentId, e.Salary,
         DENSE_RANK() OVER (PARTITION BY e.DepartmentId ORDER BY e.Salary DESC) AS rnk
  FROM dbo.Employees e WHERE e.Salary IS NOT NULL)
SELECT d.Name AS Department, r.Name, r.Salary
FROM ranked r JOIN dbo.Departments d ON d.DepartmentId = r.DepartmentId
WHERE r.rnk = @N;

-- Correlated version (works everywhere, O(n^2))
SELECT DISTINCT e1.Salary FROM dbo.Employees e1
WHERE @N - 1 = (SELECT COUNT(DISTINCT e2.Salary) FROM dbo.Employees e2 WHERE e2.Salary > e1.Salary);

CREATE INDEX IX_Employees_Dept_Salary ON dbo.Employees (DepartmentId, Salary DESC) INCLUDE (Name);
~~~`,
  pts: [r`Use DENSE_RANK for the Nth distinct salary, and state that ties matter.`, r`Wrap in a scalar subquery so a missing Nth value returns NULL, not zero rows.`, r`PARTITION BY DepartmentId gives the per-department version in one pass.`, r`Exclude NULL salaries explicitly.`, r`Index (DepartmentId, Salary DESC) so each partition reads only its top rows.`],
  ex: r`In a payroll-analytics interview at a bank, the follow-up was "now return all employees tied for 2nd place in each department, including departments with fewer than 2 distinct salaries as NULL rows", which needs DENSE_RANK plus a LEFT JOIN from Departments.`,
  fu: [r`Return departments with no Nth salary as a NULL row.`, r`How would the answer change if "Nth highest" means Nth row, not Nth distinct value?`, r`Why is the correlated COUNT(DISTINCT) version slow?`],
  pit: [r`Using ROW_NUMBER and silently skipping a tied value.`, r`Using TOP N without DISTINCT, so duplicates shift the answer.`, r`Returning an empty result instead of NULL when N exceeds the distinct count.`],
  tip: r`Ask "distinct salary or Nth employee?" before writing anything. Interviewers score the clarifying question.` },

{ id: 'q14', level: 'Intermediate', tags: ['t-sql', 'query', 'self-join'],
  q: r`Find the highest-paid employee(s) in each department, and employees who earn more than their manager or above their department average.`,
  a: r`Three classic queries that test grouping, ties and self-joins.

### Highest paid per department (with ties)
Joining back to a {{GROUP BY ... MAX}} result works and returns ties. A window function avoids the second scan: {{RANK() OVER (PARTITION BY DepartmentId ORDER BY Salary DESC) = 1}}. Using {{ROW_NUMBER}} instead silently picks one of the tied employees, which is a bug unless "pick one" is the requirement.

### Earns more than their manager
A **self-join**: the Employees table joined to itself on {{e.ManagerId = m.EmployeeId}}. Use an inner join (employees without a manager are excluded by definition) and say so.

### Above department average
Either a correlated subquery or, better, {{AVG(Salary) OVER (PARTITION BY DepartmentId)}} computed in the same scan. Watch integer division: if Salary is an int, {{AVG}} returns an int; cast to decimal.

### Department with the highest total payroll
{{TOP (1) WITH TIES ... ORDER BY SUM(Salary) DESC}}: WITH TIES returns all departments sharing the maximum.`,
  code: r`~~~sql
-- Highest paid per department, ties included (window version: one scan)
SELECT DepartmentId, Name, Salary
FROM (SELECT DepartmentId, Name, Salary,
             RANK() OVER (PARTITION BY DepartmentId ORDER BY Salary DESC) AS rnk
      FROM dbo.Employees) x
WHERE rnk = 1;

-- Same with GROUP BY + join back (also returns ties)
SELECT e.DepartmentId, e.Name, e.Salary
FROM dbo.Employees e
JOIN (SELECT DepartmentId, MAX(Salary) AS MaxSal FROM dbo.Employees GROUP BY DepartmentId) m
  ON m.DepartmentId = e.DepartmentId AND m.MaxSal = e.Salary;

-- Earns more than their manager (self-join)
SELECT e.Name AS Employee, e.Salary, m.Name AS Manager, m.Salary AS ManagerSalary
FROM dbo.Employees e
JOIN dbo.Employees m ON m.EmployeeId = e.ManagerId
WHERE e.Salary > m.Salary;

-- Above department average (no second pass)
SELECT DepartmentId, Name, Salary, DeptAvg
FROM (SELECT DepartmentId, Name, Salary,
             AVG(CAST(Salary AS decimal(19,2))) OVER (PARTITION BY DepartmentId) AS DeptAvg
      FROM dbo.Employees) x
WHERE Salary > DeptAvg;

-- Department(s) with the largest payroll
SELECT TOP (1) WITH TIES DepartmentId, SUM(Salary) AS Payroll
FROM dbo.Employees GROUP BY DepartmentId ORDER BY SUM(Salary) DESC;
~~~`,
  pts: [r`RANK() = 1 per department returns all tied top earners; ROW_NUMBER silently drops ties.`, r`"More than their manager" is a self-join on ManagerId = EmployeeId.`, r`AVG() OVER (PARTITION BY ...) compares each row to its group in one scan.`, r`Cast before AVG on integer columns to avoid integer division.`, r`TOP (1) WITH TIES returns every group that shares the maximum.`],
  ex: r`A compensation-review report used ROW_NUMBER for "top earner per desk" and dropped one of two equally paid traders from a bonus approval list; switching to RANK fixed it.`,
  fu: [r`Return the manager chain for an employee (recursive CTE).`, r`Find departments where every employee earns above 50,000.`, r`What changes if ManagerId can point to an employee in another company entity?`],
  pit: [r`Using ROW_NUMBER where ties must be kept.`, r`Integer AVG truncating 72,499.5 to 72,499.`, r`LEFT JOIN to the manager and then filtering on the manager's salary (turns into an inner join anyway).`] },

{ id: 'q15', level: 'Intermediate', tags: ['pagination'],
  q: r`How do you paginate efficiently in SQL Server?`,
  a: r`{{OFFSET/FETCH}} is simple but cost grows with the offset: page 10,000 reads and discards 500,000 rows.

**Keyset (seek) pagination** uses the last seen key:

~~~sql
SELECT TOP (@pageSize) Id, CreatedAt, Total
FROM dbo.Orders
WHERE CustomerId = @c
  AND (CreatedAt < @lastCreatedAt OR (CreatedAt = @lastCreatedAt AND Id < @lastId))
ORDER BY CreatedAt DESC, Id DESC;
-- supporting index: (CustomerId, CreatedAt DESC, Id DESC) INCLUDE (Total)
~~~

It is constant cost and stable under concurrent inserts. Totals: avoid {{COUNT(*)}} on every page; cache counts or show "more available". For deep random access use OFFSET on a narrow key set then join (the "deferred join" trick).`,
  pts: [r`OFFSET cost grows`, r`Keyset with unique tiebreaker`, r`Index matches filter + order`, r`Avoid COUNT(*) per page`],
  ex: r`An admin grid moved to keyset paging and stopped timing out on late pages.`,
  fu: [r`How would you implement "jump to page N" with keyset?`],
  pit: [r`ORDER BY a non-unique column without a tiebreaker.`] },

{ id: 'q16', level: 'Intermediate', tags: ['t-sql', 'query', 'duplicates'],
  q: r`Find duplicate rows, then delete the duplicates while keeping one row per group.`,
  a: r`First define "duplicate": which columns form the business key (for example Email, or CustomerId + OrderDate + Amount)? Then decide **which row survives** (lowest Id, newest, the most complete row). Interviewers look for that question before any code.

### Find
{{GROUP BY key HAVING COUNT(*) > 1}} lists duplicate keys; a window {{COUNT(*) OVER (PARTITION BY key)}} lists the duplicate **rows** with all columns.

### Delete, keeping one
The idiomatic SQL Server answer is a CTE with {{ROW_NUMBER() OVER (PARTITION BY key ORDER BY survivor rule)}} and {{DELETE FROM cte WHERE rn > 1}}: SQL Server lets you delete through a CTE over a single table.

### Production concerns
- On large tables delete in batches to avoid log growth and lock escalation.
- Check foreign keys: child rows may reference the duplicates; re-point them to the survivor first.
- **Prevent recurrence** with a unique index (filtered if soft-deleted rows exist), otherwise duplicates come back with the next race condition.
- Normalise before comparing (trim, lower-case email) or "duplicates" slip through.`,
  code: r`~~~sql
-- Which keys are duplicated?
SELECT LOWER(LTRIM(RTRIM(Email))) AS EmailKey, COUNT(*) AS Cnt
FROM dbo.Customers GROUP BY LOWER(LTRIM(RTRIM(Email))) HAVING COUNT(*) > 1;

-- Show the duplicate rows themselves
SELECT * FROM (SELECT c.*, COUNT(*) OVER (PARTITION BY LOWER(LTRIM(RTRIM(Email)))) AS Cnt FROM dbo.Customers c) x
WHERE Cnt > 1 ORDER BY Email;

-- Re-point children to the survivor, then delete the rest (keep the oldest CustomerId)
WITH d AS (
  SELECT CustomerId, MIN(CustomerId) OVER (PARTITION BY LOWER(LTRIM(RTRIM(Email)))) AS KeepId
  FROM dbo.Customers)
UPDATE o SET o.CustomerId = d.KeepId
FROM dbo.Orders o JOIN d ON d.CustomerId = o.CustomerId WHERE d.CustomerId <> d.KeepId;

WITH d AS (
  SELECT ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(Email))) ORDER BY CustomerId) AS rn
  FROM dbo.Customers)
DELETE FROM d WHERE rn > 1;

-- Prevent recurrence
ALTER TABLE dbo.Customers ADD EmailKey AS LOWER(LTRIM(RTRIM(Email))) PERSISTED;
CREATE UNIQUE INDEX UX_Customers_EmailKey ON dbo.Customers (EmailKey) WHERE IsDeleted = 0;
~~~`,
  pts: [r`Define the business key and the survivor rule before writing SQL.`, r`GROUP BY ... HAVING COUNT(*) > 1 finds keys; COUNT(*) OVER finds the rows.`, r`DELETE through a ROW_NUMBER CTE where rn > 1 keeps exactly one row.`, r`Re-point child foreign keys to the survivor first.`, r`Add a unique (filtered) index so duplicates cannot return.`],
  ex: r`A KYC table had 41,000 duplicate customers from a retry bug; the team merged children to survivors, deleted in 5,000-row batches overnight, and added a unique index on the normalised email, which then surfaced the original race in the signup API.`,
  fu: [r`How do you dedupe a table with no primary key at all?`, r`How would you do this on a 2-billion-row table?`, r`How do you find near-duplicates (typos in names)?`],
  pit: [r`Deleting with DISTINCT into a new table and losing other columns or identity values.`, r`Not normalising case and whitespace.`, r`Deleting parents and orphaning child rows.`] },

{ id: 'q17', level: 'Intermediate', tags: ['high-availability'],
  code: r`~~~sql
CREATE AVAILABILITY GROUP AgPayments
WITH (AUTOMATED_BACKUP_PREFERENCE = SECONDARY, DB_FAILOVER = ON)
FOR DATABASE Payments
REPLICA ON
 'SQL1' WITH (ENDPOINT_URL = 'TCP://sql1:5022', AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,  FAILOVER_MODE = AUTOMATIC, SECONDARY_ROLE (ALLOW_CONNECTIONS = READ_ONLY)),
 'SQL2' WITH (ENDPOINT_URL = 'TCP://sql2:5022', AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,  FAILOVER_MODE = AUTOMATIC, SECONDARY_ROLE (ALLOW_CONNECTIONS = READ_ONLY)),
 'SQL3' WITH (ENDPOINT_URL = 'TCP://sql3-dr:5022', AVAILABILITY_MODE = ASYNCHRONOUS_COMMIT, FAILOVER_MODE = MANUAL);
~~~`,
  dia: r`flowchart LR
  App[.NET app: MultiSubnetFailover=True] --> L[AG listener]
  L --> P[(SQL1 primary AZ-a)]
  P -- sync commit --> S[(SQL2 secondary AZ-b, auto failover)]
  P -- async --> DR[(SQL3 DR region, manual failover)]
  R[Reporting] -->|ApplicationIntent=ReadOnly| S`,
  q: r`Compare Always On Availability Groups, Failover Cluster Instances, log shipping and replication.`,
  a: r`| Feature | Protects | Granularity | Readable secondaries | Notes |
|---|---|---|---|---|
| **Availability Groups (AG)** | Database(s) | Group of DBs | Yes | Sync (zero data loss, local) or async (DR); automatic failover with sync; listener |
| **Failover Cluster Instance (FCI)** | Instance | Whole instance | No | Shared storage; protects against server failure, not storage failure |
| **Log shipping** | Database | DB | Standby read (restore with standby) | Simple DR, minutes of lag, manual failover |
| **Transactional replication** | Selected tables | Articles | Yes (writable subscribers) | Data distribution/reporting, not HA |

Typical enterprise design: an AG with two synchronous replicas in one region (automatic failover, RPO 0) plus an asynchronous replica in another region for DR (RPO seconds, manual failover). Remember logins, jobs, and linked servers are **not** in the AG; contained AGs (2022) address some of that.`,
  pts: [r`AG = database-level HA/DR`, r`Sync for RPO 0, async for distance`, r`Server objects are not replicated (except contained AG)`],
  ex: r`A bank used sync AG for local HA and async AG to a second data centre; DR drills measured RTO under 15 minutes.`,
  fu: [r`What is the cost of synchronous commit on latency?`],
  pit: [r`Forgetting logins and jobs on the secondary, so failover "works" but the app cannot connect.`] },

{ id: 'q18', level: 'Intermediate', tags: ['t-sql', 'query', 'anti-join'],
  q: r`Find customers who have never placed an order. Why can NOT IN return no rows, and which form do you prefer?`,
  a: r`Four ways to write an **anti-join**:

| Form | NULL-safe | Plan |
|---|---|---|
| {{NOT EXISTS}} | yes | Anti semi join, stops at first match |
| {{LEFT JOIN ... WHERE o.CustomerId IS NULL}} | yes | Join then filter, sometimes less efficient |
| {{NOT IN (subquery)}} | **no** | If the subquery returns any NULL, the result is empty |
| {{EXCEPT}} | yes | Set operation, distinct values, only the key columns |

### The NOT IN trap
{{x NOT IN (1, 2, NULL)}} expands to {{x <> 1 AND x <> 2 AND x <> NULL}}. The last comparison is UNKNOWN, so the whole predicate is never TRUE and **no rows** come back. With a nullable foreign key in Orders this bug ships silently. Prefer {{NOT EXISTS}}.

### Related frequently asked variants
- Customers who ordered in 2025 but not in 2026: {{EXISTS ... AND NOT EXISTS ...}}.
- Products never sold: same pattern against order lines.
- "First order date per customer" and "customers whose first order was in October": {{MIN(OrderDate)}} grouped, or {{ROW_NUMBER}}.

Index {{Orders(CustomerId)}} so each probe is a seek.`,
  code: r`~~~sql
-- Preferred: NOT EXISTS
SELECT c.CustomerId, c.Name
FROM dbo.Customers c
WHERE NOT EXISTS (SELECT 1 FROM dbo.Orders o WHERE o.CustomerId = c.CustomerId);

-- LEFT JOIN anti-join
SELECT c.CustomerId, c.Name
FROM dbo.Customers c LEFT JOIN dbo.Orders o ON o.CustomerId = c.CustomerId
WHERE o.OrderId IS NULL;

-- The trap: returns ZERO rows if any Orders.CustomerId is NULL
SELECT c.CustomerId FROM dbo.Customers c
WHERE c.CustomerId NOT IN (SELECT o.CustomerId FROM dbo.Orders o);

-- Ordered in 2025 but not in 2026
SELECT c.CustomerId FROM dbo.Customers c
WHERE EXISTS (SELECT 1 FROM dbo.Orders o WHERE o.CustomerId = c.CustomerId AND o.OrderDate >= '2025-01-01' AND o.OrderDate < '2026-01-01')
  AND NOT EXISTS (SELECT 1 FROM dbo.Orders o WHERE o.CustomerId = c.CustomerId AND o.OrderDate >= '2026-01-01');

-- First order per customer
SELECT CustomerId, MIN(OrderDate) AS FirstOrder FROM dbo.Orders GROUP BY CustomerId;
~~~`,
  pts: [r`Prefer NOT EXISTS: NULL-safe and compiles to an anti semi join.`, r`NOT IN with any NULL in the subquery returns no rows at all.`, r`LEFT JOIN ... IS NULL works but test it on the key column, not a nullable one.`, r`Index the foreign key so each probe is a seek.`, r`Combine EXISTS and NOT EXISTS for "did X but not Y" questions.`],
  ex: r`A churn report using NOT IN returned zero lapsed customers for a month because one order row had a NULL CustomerId from a guest checkout; NOT EXISTS returned the real 3,200.`,
  fu: [r`How does the optimiser execute NOT EXISTS?`, r`When is EXCEPT a better choice?`],
  pit: [r`NOT IN against a nullable column.`, r`LEFT JOIN anti-join that tests a nullable non-key column for IS NULL.`] },

{ id: 'q19', level: 'Senior', tags: ['t-sql', 'query', 'top-n-per-group'],
  q: r`Return the latest 3 orders per customer (top-N per group). Compare ROW_NUMBER with CROSS APPLY and explain which performs better when.`,
  a: r`Two standard patterns:

- **ROW_NUMBER over a partition** and filter {{rn <= 3}}: one scan of Orders, sorts or reads an index in partition order. Best when you need top-N for **most** customers or there are few rows per customer.
- **CROSS APPLY (SELECT TOP (3) ... ORDER BY ...)**: for each customer, a seek into an index on {{(CustomerId, OrderDate DESC)}}. Best when there are **many rows per group** and you only need the top few, or only for a filtered set of customers: it reads 3 rows per customer instead of the whole table.

Use **OUTER APPLY** to keep customers with no orders.

### Ties and determinism
{{ORDER BY OrderDate DESC}} alone is non-deterministic when two orders share a timestamp; add a unique tiebreaker ({{OrderId DESC}}), otherwise results change between runs and pagination breaks. If "top 3 including ties" is required, use {{DENSE_RANK}} or {{TOP (3) WITH TIES}}.

### Index
{{CREATE INDEX ... ON Orders (CustomerId, OrderDate DESC, OrderId DESC) INCLUDE (Total)}} supports both patterns without a sort.`,
  code: r`~~~sql
-- Pattern 1: ROW_NUMBER
SELECT CustomerId, OrderId, OrderDate, Total
FROM (SELECT o.CustomerId, o.OrderId, o.OrderDate, o.Total,
             ROW_NUMBER() OVER (PARTITION BY o.CustomerId ORDER BY o.OrderDate DESC, o.OrderId DESC) AS rn
      FROM dbo.Orders o) x
WHERE rn <= 3;

-- Pattern 2: APPLY (seek per customer; OUTER APPLY keeps customers with no orders)
SELECT c.CustomerId, c.Name, t.OrderId, t.OrderDate, t.Total
FROM dbo.Customers c
OUTER APPLY (SELECT TOP (3) o.OrderId, o.OrderDate, o.Total
             FROM dbo.Orders o WHERE o.CustomerId = c.CustomerId
             ORDER BY o.OrderDate DESC, o.OrderId DESC) t
WHERE c.Segment = 'VIP';

CREATE INDEX IX_Orders_Customer_Date ON dbo.Orders (CustomerId, OrderDate DESC, OrderId DESC) INCLUDE (Total);
~~~`,
  pts: [r`ROW_NUMBER filtered to rn <= N scans once; good when most groups are needed.`, r`CROSS/OUTER APPLY with TOP (N) seeks per group; wins with many rows per group or few groups.`, r`Always add a unique tiebreaker to ORDER BY for deterministic results.`, r`Use DENSE_RANK or WITH TIES when ties must be included.`, r`An index on (group, sort key DESC) removes the sort for both patterns.`],
  ex: r`A "recent activity" API for 2,000 VIP customers with 50 million orders went from a 9-second ROW_NUMBER scan to 40 ms with OUTER APPLY and a matching index.`,
  fu: [r`How would you return the 2nd order only for each customer?`, r`How does batch mode change the ROW_NUMBER plan?`],
  pit: [r`Non-deterministic ORDER BY in ROW_NUMBER.`, r`CROSS APPLY dropping customers with no orders when they should appear.`] },

{ id: 'q20', level: 'Senior', tags: ['performance', 'diagnosis'],
  code: r`~~~sql
EXEC sp_WhoIsActive @get_plans = 1;                                         -- 1. what is running now
SELECT TOP (10) wait_type, wait_time_ms - signal_wait_time_ms AS resource_wait_ms     -- 2. what are we waiting on
FROM sys.dm_os_wait_stats ORDER BY resource_wait_ms DESC;
-- 3. what changed: deploys, stats, plans -> Query Store "Regressed queries"
SELECT TOP (10) q.query_id, rs.avg_duration, rs.last_execution_time, p.plan_id
FROM sys.query_store_runtime_stats rs JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
JOIN sys.query_store_query q ON q.query_id = p.query_id ORDER BY rs.avg_duration DESC;
~~~`,
  q: r`A SQL Server suddenly becomes slow. Walk through your investigation.`,
  a: r`### Triage (minutes)
1. **What is running now**: {{sp_WhoIsActive}} / {{sys.dm_exec_requests}}: blocking chains, long runners, wait types.
2. **Waits**: {{sys.dm_os_wait_stats}} deltas or Query Store wait stats: CPU ({{SOS_SCHEDULER_YIELD}}), I/O ({{PAGEIOLATCH_*}}, {{WRITELOG}}), locks ({{LCK_M_*}}), memory grants ({{RESOURCE_SEMAPHORE}}), tempdb ({{PAGELATCH}}), parallelism ({{CXPACKET/CXCONSUMER}}).
3. **What changed**: deployment, data volume, stats, plan changes (**Query Store regressed queries**), configuration, failover, maintenance jobs.

### Narrow
- **Query Store**: top resource consumers and plan changes over time; force the previous good plan as an immediate mitigation.
- Host: CPU, memory pressure (page life expectancy, memory grants pending), storage latency.

### Fix and prevent
Fix the root cause (index, stats, query rewrite, transaction length), then add alerts on the leading indicator you found.`,
  pts: [r`Current activity, waits, changes`, r`Query Store regressed queries`, r`Force good plan as mitigation`, r`Alert on the leading indicator`],
  ex: r`Query Store showed a plan change after a stats update; forcing the old plan restored service in minutes while the index fix shipped.`,
  fu: [r`What does RESOURCE_SEMAPHORE indicate?`],
  pit: [r`Restarting SQL Server, which loses the evidence and empties the cache.`] },

{ id: 'q21', level: 'Senior', tags: ['query-store'],
  code: r`~~~sql
ALTER DATABASE Payments SET QUERY_STORE = ON (OPERATION_MODE = READ_WRITE, QUERY_CAPTURE_MODE = AUTO,
  MAX_STORAGE_SIZE_MB = 4096, INTERVAL_LENGTH_MINUTES = 15, WAIT_STATS_CAPTURE_MODE = ON);
-- Queries with more than one plan where the latest is slower
SELECT q.query_id, COUNT(DISTINCT p.plan_id) AS plans, MAX(rs.avg_duration) AS worst_avg_us
FROM sys.query_store_query q JOIN sys.query_store_plan p ON p.query_id = q.query_id
JOIN sys.query_store_runtime_stats rs ON rs.plan_id = p.plan_id
GROUP BY q.query_id HAVING COUNT(DISTINCT p.plan_id) > 1 ORDER BY worst_avg_us DESC;
EXEC sp_query_store_force_plan @query_id = 4711, @plan_id = 12;
~~~`,
  q: r`What is Query Store and how do you use it in production?`,
  a: r`Query Store (on by default for new databases since SQL Server 2022) persists **query text, plans, runtime stats and wait stats** over time inside the database.

Uses:

- **Regression detection**: "Regressed Queries" report shows queries whose performance worsened after a plan change.
- **Plan forcing**: pin a known-good plan; SQL Server 2022 adds **Query Store hints** to apply options (e.g. {{RECOMPILE}}, {{MAXDOP}}) without code changes.
- **Upgrade safety**: capture baselines before changing compatibility level, then compare.
- **Top consumers** by CPU, duration, reads, waits.
- On readable secondaries (2022) for read workloads.

Operational care: size limits and cleanup policy ({{QUERY_CAPTURE_MODE = AUTO}}), monitor forced plans (they can fail if an index is dropped), and treat forcing as a mitigation while fixing the root cause.`,
  pts: [r`History of plans and runtime`, r`Force plans and hints without code changes`, r`Baseline before upgrades`],
  ex: r`Raising compat level to 160 regressed three queries; Query Store hints restored them in minutes while the team rewrote them.`,
  fu: [r`What happens to a forced plan if its index is dropped?`],
  pit: [r`Forcing plans and forgetting them for years.`] },

{ id: 'q22', level: 'Senior', tags: ['partitioning'],
  code: r`~~~sql
CREATE PARTITION FUNCTION pfMonthly (datetime2(3)) AS RANGE RIGHT FOR VALUES ('2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01');
CREATE PARTITION SCHEME psMonthly AS PARTITION pfMonthly ALL TO ([PRIMARY]);
CREATE TABLE dbo.AuditEvents (Id bigint IDENTITY, OccurredUtc datetime2(3) NOT NULL, Payload nvarchar(max),
  CONSTRAINT PK_Audit PRIMARY KEY CLUSTERED (OccurredUtc, Id)) ON psMonthly (OccurredUtc);
-- Retention in seconds instead of a multi-hour DELETE
TRUNCATE TABLE dbo.AuditEvents WITH (PARTITIONS (1));
ALTER PARTITION FUNCTION pfMonthly() MERGE RANGE ('2026-08-01');
~~~`,
  q: r`When and how do you use table partitioning?`,
  a: r`Partitioning splits one table into partitions by a key (usually date) via a **partition function** and **scheme**; queries see one table.

Real benefits are **manageability**, not raw query speed:

- **Sliding window**: {{SWITCH}} out an old partition (metadata-only) and {{TRUNCATE TABLE ... WITH (PARTITIONS)}} instead of deleting billions of rows.
- Per-partition index rebuilds, compression, and filegroups on cheaper storage for cold data.
- Partition elimination for queries filtered on the key.
- Lock escalation to partition level.

Costs: every query without the partition key touches all partitions; unique indexes must include the partition key (aligned); more complex maintenance. Do not partition small tables; first prove that indexes are insufficient.`,
  pts: [r`Manageability first`, r`SWITCH for instant archive`, r`Queries must filter on the key`, r`Aligned indexes include the key`],
  ex: r`A 4 TB transaction-history table partitioned monthly purges a month in seconds with SWITCH instead of an 8-hour delete.`,
  fu: [r`How do you add a new partition boundary without long locks?`],
  pit: [r`Partitioning expecting faster point lookups.`] },

{ id: 'q23', level: 'Senior', tags: ['columnstore', 'analytics'],
  code: r`~~~sql
-- Real-time operational analytics: rowstore for OLTP + nonclustered columnstore for aggregates
CREATE NONCLUSTERED COLUMNSTORE INDEX NCCI_Orders ON dbo.Orders (CustomerId, CreatedUtc, Status, Total)
WITH (COMPRESSION_DELAY = 30);   -- keep hot rows in the delta store briefly
SELECT Status, COUNT(*), SUM(Total) FROM dbo.Orders WHERE CreatedUtc >= DATEADD(day, -30, SYSUTCDATETIME()) GROUP BY Status;  -- batch mode
~~~`,
  q: r`Rowstore versus columnstore indexes, and real-time operational analytics.`,
  a: r`**Rowstore** (B-tree) stores rows together: ideal for OLTP point reads and small range scans.

**Columnstore** stores each column separately in compressed segments (about a million rows per rowgroup) and processes them in **batch mode**: huge compression (often 10x) and fast aggregations over many rows, with segment elimination. Weak for single-row lookups and frequent updates (deletes are marked in a delete bitmap; updates are delete + insert; trickle inserts land in delta stores).

Patterns:

- Clustered columnstore for fact tables / data warehouses.
- **Non-clustered columnstore on an OLTP table** ("real-time operational analytics") to run reports without a separate warehouse, at some write cost.
- Batch mode on rowstore (2019+) gives some benefit without columnstore.

Maintain by keeping rowgroups healthy (bulk load ≥102,400 rows per batch to compress directly) and reorganising to merge small rowgroups.`,
  pts: [r`Columnstore = compression + batch mode`, r`Bad for point updates`, r`NCCI for operational analytics`, r`Bulk load in large batches`],
  ex: r`A 2-billion-row fact table shrank from 900 GB to 80 GB and month-to-date aggregates went from minutes to seconds.`,
  fu: [r`What is segment elimination?`],
  pit: [r`Using clustered columnstore for an OLTP table with single-row updates.`] },

{ id: 'q24', level: 'Senior', tags: ['concurrency', 'patterns'],
  q: r`How do you implement a reliable queue table or "claim next job" pattern in SQL Server?`,
  a: r`Use {{UPDLOCK, READPAST, ROWLOCK}} so competing workers skip rows locked by others and atomically claim work:

~~~sql
WITH next AS (
  SELECT TOP (10) * FROM dbo.Jobs WITH (UPDLOCK, READPAST, ROWLOCK)
  WHERE Status = 'Ready' AND AvailableAt <= SYSUTCDATETIME()
  ORDER BY AvailableAt, Id)
UPDATE next SET Status = 'Processing', LockedBy = @worker, LockedUntil = DATEADD(minute, 5, SYSUTCDATETIME())
OUTPUT inserted.Id, inserted.Payload;
-- index: (Status, AvailableAt, Id)
~~~

Add: a lease ({{LockedUntil}}) so crashed workers' jobs are reclaimed; attempt counts and a dead-letter status; idempotent processing; deletion/archiving of completed rows in batches to keep the table small. This is also how outbox relays poll. At higher scale use a real broker.`,
  pts: [r`UPDLOCK + READPAST`, r`Lease and reclaim`, r`Attempts and dead-letter`, r`Keep the table small`],
  ex: r`An outbox relay with READPAST let 8 workers publish 5,000 messages per second without blocking each other.`,
  fu: [r`Why does ordering by AvailableAt need a supporting index?`],
  pit: [r`SELECT then UPDATE in two statements without locks: two workers take the same job.`] },

{ id: 'q25', level: 'Senior', tags: ['t-sql', 'query', 'gaps-and-islands'],
  q: r`Gaps and islands: find users who logged in on 3 or more consecutive days, and find missing invoice numbers.`,
  a: r`### Islands (consecutive runs)
The trick: for consecutive dates, {{date - ROW_NUMBER()}} is constant within a run. Group by that difference to get each island's start, end and length.

1. De-duplicate to one row per user per day (several logins a day would break the arithmetic).
2. {{grp = DATEADD(day, -ROW_NUMBER() OVER (PARTITION BY UserId ORDER BY LoginDate), LoginDate)}}.
3. {{GROUP BY UserId, grp HAVING COUNT(*) >= 3}}.

### Gaps (missing values)
Use {{LEAD}} to compare each value with the next: where {{next - current > 1}} there is a gap from {{current + 1}} to {{next - 1}}. This avoids generating a full number series.

### Variants interviewers ask
- Longest streak per user: the max island length.
- Periods where a server status stayed the same (islands on a status column): use {{ROW_NUMBER}} per user minus {{ROW_NUMBER}} per user and status.
- Session-ising events with a 30-minute inactivity gap: {{LAG}} to flag a new session when the gap exceeds 30 minutes, then a running {{SUM}} of the flags gives a session number.`,
  code: r`~~~sql
-- Users with 3+ consecutive login days
WITH days AS (SELECT DISTINCT UserId, CAST(LoginAt AS date) AS d FROM dbo.Logins),
grp AS (SELECT UserId, d, DATEADD(day, -ROW_NUMBER() OVER (PARTITION BY UserId ORDER BY d), d) AS g FROM days)
SELECT UserId, MIN(d) AS StreakStart, MAX(d) AS StreakEnd, COUNT(*) AS Days
FROM grp GROUP BY UserId, g HAVING COUNT(*) >= 3;

-- Missing invoice numbers (gaps)
SELECT InvoiceNo + 1 AS GapStart, NextNo - 1 AS GapEnd
FROM (SELECT InvoiceNo, LEAD(InvoiceNo) OVER (ORDER BY InvoiceNo) AS NextNo FROM dbo.Invoices) x
WHERE NextNo - InvoiceNo > 1;

-- Sessions: new session after 30 minutes of inactivity
WITH e AS (
  SELECT UserId, EventAt,
         CASE WHEN DATEDIFF(minute, LAG(EventAt) OVER (PARTITION BY UserId ORDER BY EventAt), EventAt) <= 30 THEN 0 ELSE 1 END AS NewSession
  FROM dbo.Events),
s AS (SELECT *, SUM(NewSession) OVER (PARTITION BY UserId ORDER BY EventAt ROWS UNBOUNDED PRECEDING) AS SessionNo FROM e)
SELECT UserId, SessionNo, MIN(EventAt) AS Started, MAX(EventAt) AS Ended, COUNT(*) AS Events
FROM s GROUP BY UserId, SessionNo;
~~~`,
  pts: [r`For consecutive values, value minus ROW_NUMBER is constant per island.`, r`De-duplicate to one row per entity per day first.`, r`LEAD finds gaps without generating a number series.`, r`LAG plus a running SUM of "new group" flags builds sessions.`, r`All three run as single scans with an index on (UserId, date).`],
  ex: r`A fraud team used the islands pattern to find cards used on 5+ consecutive days in new countries; a compliance team used the gaps query to prove invoice numbering had no unexplained gaps for an audit.`,
  fu: [r`Find each user's longest streak.`, r`How do you handle time zones when "day" depends on the user's locale?`],
  pit: [r`Forgetting DISTINCT per day, so two logins on one day break the run.`, r`Using a cursor or loop instead of set-based logic.`],
  tip: r`Name the technique ("gaps and islands") before solving. It signals you have seen the class of problem.` },

{ id: 'q26', level: 'Senior', tags: ['cdc', 'integration'],
  code: r`~~~sql
-- Temporal table: full row history for audit and "as of" queries
ALTER TABLE dbo.Accounts ADD
  ValidFrom datetime2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL DEFAULT SYSUTCDATETIME(),
  ValidTo   datetime2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL DEFAULT '9999-12-31',
  PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo);
ALTER TABLE dbo.Accounts SET (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.AccountsHistory, HISTORY_RETENTION_PERIOD = 7 YEARS));
SELECT * FROM dbo.Accounts FOR SYSTEM_TIME AS OF '2026-09-30T23:59:59' WHERE AccountId = 42;
-- CDC for streaming changes out (Debezium reads cdc.* tables)
EXEC sys.sp_cdc_enable_table @source_schema = 'dbo', @source_name = 'Orders', @role_name = NULL;
~~~`,
  q: r`CDC, Change Tracking, temporal tables and triggers: which to use for change capture?`,
  a: r`| Mechanism | Captures | Use for |
|---|---|---|
| **Change Data Capture** | Full before/after column values, read asynchronously from the log | Feeding Kafka (Debezium), data warehouses, outbox-like integration |
| **Change Tracking** | Which rows changed (keys, version), not values | Lightweight sync of clients/caches |
| **Temporal tables** | Full row history with validity periods | Audit, "as of" queries, regulatory history |
| **Triggers** | Anything, synchronously | Small, carefully written cases; adds latency to every write |

CDC adds log-reading jobs and storage; ensure log truncation is not held up. Temporal tables give {{FOR SYSTEM_TIME AS OF}} queries with almost no code. For integration events prefer an explicit **outbox** table (business-level events) over raw CDC of internal tables, or use CDC on the outbox table.`,
  pts: [r`CDC = values from the log`, r`Change Tracking = what changed`, r`Temporal = history and as-of queries`, r`Outbox for business events`],
  ex: r`Regulators asked for the state of an account on a given date; a temporal table answered with one query.`,
  fu: [r`Why is CDC of internal tables a coupling risk?`],
  pit: [r`Business logic in triggers that nobody can see.`] },

{ id: 'q27', level: 'Senior', tags: ['security'],
  code: r`~~~sql
-- Row-level security: tenant isolation enforced by the engine
CREATE FUNCTION sec.fn_tenant(@TenantId int) RETURNS TABLE WITH SCHEMABINDING AS
  RETURN SELECT 1 AS ok WHERE @TenantId = CAST(SESSION_CONTEXT(N'TenantId') AS int);
CREATE SECURITY POLICY sec.TenantPolicy ADD FILTER PREDICATE sec.fn_tenant(TenantId) ON dbo.Invoices,
  ADD BLOCK PREDICATE sec.fn_tenant(TenantId) ON dbo.Invoices AFTER INSERT WITH (STATE = ON);
EXEC sp_set_session_context @key = N'TenantId', @value = 42, @read_only = 1;
-- Dynamic data masking for support users
ALTER TABLE dbo.Customers ALTER COLUMN Email ADD MASKED WITH (FUNCTION = 'email()');
-- Always Encrypted for columns the DBA must not read (keys held by the client)
~~~`,
  q: r`How do you secure SQL Server data (encryption, masking, row-level security)?`,
  a: r`- **TDE**: encrypts data and log files at rest; transparent to apps; protects stolen files/backups, not a logged-in attacker.
- **Always Encrypted** (with secure enclaves): column encryption with keys held by the client; DBAs and the server never see plaintext; limits querying (deterministic for equality, enclaves for richer operations).
- **TLS** for connections ({{Encrypt=True}}, valid certificates; Microsoft.Data.SqlClient defaults to encrypt in v4+).
- **Dynamic Data Masking**: masks output for non-privileged users; a presentation convenience, **not** a security boundary (inference attacks).
- **Row-Level Security**: predicate functions filter rows per user/tenant; defence in depth for multi-tenancy.
- **Least privilege**: app login with only needed permissions, no sysadmin; contained users; Entra ID / AD authentication; auditing (SQL Server Audit).
- Backups encrypted; secrets in a vault.`,
  pts: [r`TDE at rest, TLS in transit`, r`Always Encrypted for DBA-proof columns`, r`DDM is not security`, r`RLS for tenancy, least privilege`],
  ex: r`PCI requirements were met by tokenising PAN outside the database, TDE for at-rest, and an app login without SELECT on audit tables.`,
  fu: [r`What can Always Encrypted not do?`],
  pit: [r`Relying on Dynamic Data Masking as the control for sensitive data.`] },

{ id: 'q28', level: 'Senior', tags: ['ef-core', 'performance'],
  code: r`~~~csharp
// N+1: one query per order for its lines
foreach (var o in await db.Orders.ToListAsync()) o.Lines = await db.Lines.Where(l => l.OrderId == o.Id).ToListAsync();
// Fix: project in one round trip; AsSplitQuery for multiple collections to avoid cartesian explosion
var dto = await db.Orders.Where(o => o.CustomerId == id)
    .Select(o => new { o.Id, o.Total, Lines = o.Lines.Select(l => new { l.Sku, l.Qty }) }).ToListAsync(ct);
// Catch it: log slow/duplicated queries in tests
options.LogTo(Console.WriteLine, [RelationalEventId.CommandExecuted]).EnableSensitiveDataLogging(false);
~~~`,
  q: r`What SQL Server problems do ORMs commonly cause, and how do you catch them?`,
  a: r`- **N+1 queries** (lazy loading in loops).
- **Over-fetching** (SELECT * of wide entities), loading graphs you do not need.
- **Implicit conversions** from parameter type/length mismatches ({{nvarchar(4000)}} vs {{varchar(20)}}).
- **Plan cache pollution** from varying IN-list sizes or unparameterised literals.
- **Cartesian explosion** when including multiple collections (use split queries).
- **Client-side evaluation** or untranslatable LINQ.
- **Chatty transactions** and long-lived DbContexts.

Catch them: log generated SQL in development with warnings on, integration tests asserting query counts, Query Store top consumers in production, APM traces showing many DB spans per request, and code review rules ({{AsNoTracking}}, projections). See the EF Core topic for fixes.`,
  pts: [r`N+1, over-fetch, conversions, cartesian explosion`, r`Measure query count per request`, r`Query Store + traces in prod`],
  ex: r`A page made 401 queries (1 + 400 lazy loads); a projection reduced it to one query.`,
  fu: [r`How do you assert query counts in tests?`],
  pit: [r`Blaming SQL Server for ORM-generated workloads without looking at the SQL.`] },

{ id: 'q29', level: 'Senior', tags: ['migrations', 'zero-downtime'],
  code: r`~~~sql
-- Expand: add nullable column (metadata-only), backfill in batches, then enforce
ALTER TABLE dbo.Customers ADD NormalizedEmail nvarchar(256) NULL;
WHILE 1 = 1 BEGIN
  UPDATE TOP (5000) dbo.Customers SET NormalizedEmail = LOWER(Email) WHERE NormalizedEmail IS NULL;
  IF @@ROWCOUNT = 0 BREAK; WAITFOR DELAY '00:00:01';
END
CREATE UNIQUE INDEX UX_Customers_NormEmail ON dbo.Customers (NormalizedEmail) WITH (ONLINE = ON, RESUMABLE = ON);
-- Contract (a later release, once no code reads Email): drop the old column
~~~`,
  q: r`How do you deploy schema changes with zero downtime?`,
  a: r`Use **expand/contract** so old and new application versions work with the schema at every step:

1. **Expand**: add new nullable column/table/index (online), deploy code that writes both old and new.
2. **Backfill** in small batches (avoid long locks and log growth), with throttling.
3. **Switch reads** to the new structure; verify.
4. **Contract**: remove old writes, then drop the old column in a later release.

Specifics: {{CREATE INDEX ... WITH (ONLINE = ON, RESUMABLE = ON)}}; adding a NOT NULL column with a default is metadata-only on modern versions (Enterprise/Azure); renames break older code (avoid, or use views/synonyms during transition); large data changes in batches of a few thousand rows with {{WAITFOR}} delays; check AG replica lag. Run migrations from the pipeline, idempotent and reviewed, with a tested rollback path (which may be "roll forward").`,
  pts: [r`Expand, backfill, switch, contract`, r`Online, resumable index operations`, r`Batch backfills`, r`Never rename in one step`],
  ex: r`Splitting {{Name}} into {{FirstName}}/{{LastName}} took three releases with no downtime.`,
  fu: [r`How do you handle a column type change on a 1-billion-row table?`],
  pit: [r`A migration that drops a column the previous app version still reads.`] },

{ id: 'q30', level: 'Senior', tags: ['t-sql', 'query', 'running-totals'],
  q: r`Write running totals, a 7-day moving average and an account balance "as of" any date. Why does the window frame matter?`,
  a: r`### Running total
{{SUM(Amount) OVER (PARTITION BY AccountId ORDER BY TxnDate, TxnId ROWS UNBOUNDED PRECEDING)}}. Always add a unique tiebreaker and an explicit **ROWS** frame.

### Why the frame matters
With an ORDER BY and no frame, SQL Server uses {{RANGE UNBOUNDED PRECEDING}}: rows with the same ORDER BY value are **peers** and get the same total, and the RANGE frame uses an on-disk spool in row mode, which is much slower. {{ROWS}} gives a true row-by-row running total and an in-memory spool.

### Moving average
Calendar-correct 7-day averages need one row per day: if days can be missing, join to a calendar table first, otherwise {{ROWS BETWEEN 6 PRECEDING AND CURRENT ROW}} averages the last 7 **rows**, not 7 days.

### Balance as of a date
Either the running total filtered at the date, or simply {{SUM ... WHERE TxnDate <= @asOf}} with an index on {{(AccountId, TxnDate) INCLUDE (Amount)}}. For large ledgers, keep daily snapshot balances and add only the transactions since the last snapshot.

### Old-version alternatives
Before 2012: correlated subqueries (O(n²)) or the "quirky update" (undocumented ordering, unsafe). Mention them only to explain why window functions replaced them.`,
  code: r`~~~sql
-- Running balance per account
SELECT AccountId, TxnId, TxnDate, Amount,
       SUM(Amount) OVER (PARTITION BY AccountId ORDER BY TxnDate, TxnId ROWS UNBOUNDED PRECEDING) AS RunningBalance
FROM dbo.Transactions;

-- 7-day moving average of daily revenue, calendar-correct (dbo.Calendar has one row per date)
WITH daily AS (
  SELECT c.d, COALESCE(SUM(o.Total), 0) AS Revenue
  FROM dbo.Calendar c LEFT JOIN dbo.Orders o ON o.OrderDate >= c.d AND o.OrderDate < DATEADD(day, 1, c.d)
  WHERE c.d BETWEEN '2026-09-01' AND '2026-09-30' GROUP BY c.d)
SELECT d, Revenue, AVG(Revenue) OVER (ORDER BY d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS Avg7d
FROM daily;

-- Balance as of a date
DECLARE @asOf date = '2026-06-30';
SELECT AccountId, SUM(Amount) AS BalanceAsOf
FROM dbo.Transactions WHERE TxnDate <= @asOf GROUP BY AccountId;

-- Percentage of total and cumulative percentage
SELECT ProductId, Revenue,
       100.0 * Revenue / SUM(Revenue) OVER () AS PctOfTotal,
       100.0 * SUM(Revenue) OVER (ORDER BY Revenue DESC, ProductId ROWS UNBOUNDED PRECEDING) / SUM(Revenue) OVER () AS CumPct
FROM dbo.ProductRevenue;
~~~`,
  pts: [r`SUM() OVER (... ROWS UNBOUNDED PRECEDING) is the running total.`, r`Default RANGE frame treats ties as peers and is slower; specify ROWS.`, r`Add a unique tiebreaker to ORDER BY.`, r`Moving averages over days need a calendar table when days can be missing.`, r`For large ledgers, snapshot balances plus recent transactions.`],
  ex: r`A statement generator switched from a correlated subquery (O(n²), 14 minutes) to a windowed running total with ROWS (11 seconds) for 40 million transactions.`,
  fu: [r`How do you reset the running total at each month?`, r`What does batch mode on rowstore do for window aggregates?`],
  pit: [r`Relying on the default RANGE frame and getting identical totals for same-day rows.`, r`Averaging 7 rows and calling it 7 days.`] },

{ id: 'q31', level: 'Senior', tags: ['t-sql', 'query', 'recursive-cte'],
  q: r`Use a recursive CTE to return an employee's full reporting line and everyone under a manager, with depth and path. How do you guard against cycles?`,
  a: r`A recursive CTE has an **anchor** member (the starting rows) and a **recursive** member that joins the CTE to the table, combined with {{UNION ALL}}. Each iteration adds the next level until no rows are produced.

### Down the tree (all reports of a manager)
Anchor: the manager. Recursive: employees whose ManagerId is in the previous level. Carry {{Depth + 1}} and a path string for ordering and display.

### Up the tree (management chain)
Anchor: the employee. Recursive: join to the manager of the previous row.

### Cycles and limits
Bad data (A manages B, B manages A) causes infinite recursion until {{MAXRECURSION}} (default 100) aborts with an error. Guard by carrying the path and stopping when the next id is already in it, and set {{OPTION (MAXRECURSION n)}} deliberately ({{0}} = unlimited, risky).

### Alternatives
For deep, read-heavy hierarchies consider {{hierarchyid}} (fast subtree queries via {{IsDescendantOf}}), a closure table (all ancestor/descendant pairs), or the SQL graph tables. Recursive CTEs are fine for hundreds of thousands of nodes with an index on ManagerId.`,
  code: r`~~~sql
-- Everyone under manager 10, with depth and path
WITH org AS (
  SELECT EmployeeId, Name, ManagerId, 0 AS Depth,
         CAST('/' + CAST(EmployeeId AS varchar(10)) + '/' AS varchar(4000)) AS Path
  FROM dbo.Employees WHERE EmployeeId = 10
  UNION ALL
  SELECT e.EmployeeId, e.Name, e.ManagerId, o.Depth + 1,
         CAST(o.Path + CAST(e.EmployeeId AS varchar(10)) + '/' AS varchar(4000))
  FROM dbo.Employees e
  JOIN org o ON e.ManagerId = o.EmployeeId
  WHERE o.Path NOT LIKE '%/' + CAST(e.EmployeeId AS varchar(10)) + '/%'   -- cycle guard
)
SELECT REPLICATE('    ', Depth) + Name AS OrgChart, Depth, Path
FROM org ORDER BY Path
OPTION (MAXRECURSION 50);

-- Management chain upwards for employee 457
WITH chain AS (
  SELECT EmployeeId, Name, ManagerId, 0 AS Lvl FROM dbo.Employees WHERE EmployeeId = 457
  UNION ALL
  SELECT m.EmployeeId, m.Name, m.ManagerId, c.Lvl + 1
  FROM dbo.Employees m JOIN chain c ON m.EmployeeId = c.ManagerId)
SELECT * FROM chain ORDER BY Lvl;

CREATE INDEX IX_Employees_Manager ON dbo.Employees (ManagerId) INCLUDE (Name);
~~~`,
  pts: [r`Anchor member plus recursive member joined with UNION ALL.`, r`Carry Depth and a Path column for ordering and display.`, r`Guard cycles by checking the path, and set MAXRECURSION deliberately.`, r`Index ManagerId so each level is a seek.`, r`For heavy subtree reads consider hierarchyid or a closure table.`],
  ex: r`An approval-routing service built the approval chain with a recursive CTE; a data-entry error created a cycle and hit MAXRECURSION in production until a path-based guard and a CHECK in the HR import were added.`,
  fu: [r`Count the total headcount under each manager.`, r`Bill of materials: total quantity of each component in a product.`],
  pit: [r`UNION instead of UNION ALL (extra distinct sort, may hide cycle symptoms).`, r`No cycle protection on user-maintained data.`] },

{ id: 'q32', level: 'Senior', tags: ['batch'],
  q: r`How do you update or delete hundreds of millions of rows safely?`,
  a: r`Never in one statement: it would hold locks for hours, escalate to a table lock, fill the transaction log (it cannot truncate until commit), lag AG replicas, and take forever to roll back if cancelled.

Batch it:

~~~sql
DECLARE @rows int = 1;
WHILE @rows > 0
BEGIN
  DELETE TOP (5000) FROM dbo.AuditLog WHERE CreatedAt < @cutoff;   -- index on CreatedAt
  SET @rows = @@ROWCOUNT;
  WAITFOR DELAY '00:00:00.200';  -- throttle; let log backups and replicas keep up
END
~~~

Also: keep each batch under the lock escalation threshold, drive by an indexed key range for stable performance, checkpoint progress for restartability, run off-peak, monitor log usage and replica lag, and consider **partition SWITCH/TRUNCATE** or "copy the rows you keep into a new table then swap" when removing most of a table.`,
  pts: [r`Batch under escalation threshold`, r`Throttle for log and replicas`, r`Restartable progress`, r`Partition switch or copy-and-swap for most rows`],
  ex: r`Purging 600 million audit rows ran in batches over two nights with no user impact.`,
  fu: [r`Why can cancelling a huge delete take longer than running it?`],
  pit: [r`A single DELETE with no WHERE index support.`] },

{ id: 'q33', level: 'Senior', tags: ['upsert', 'concurrency'],
  q: r`How do you implement an idempotent upsert in SQL Server under concurrency? What is wrong with MERGE or IF EXISTS?`,
  a: r`{{IF NOT EXISTS (SELECT ...) INSERT ... ELSE UPDATE ...}} is a race: two sessions both see "not exists" and both insert (duplicate rows, or a unique-key error). {{MERGE}} has the same race at default isolation **and** a history of bugs and surprising behaviour (filtered indexes, triggers, multiple matches); many teams avoid it for OLTP upserts.

Safe patterns:

~~~sql
-- 1. Update first, insert if nothing updated, serialised on the key range
BEGIN TRAN;
UPDATE dbo.Positions WITH (UPDLOCK, SERIALIZABLE) SET Qty = @qty, UpdatedUtc = SYSUTCDATETIME()
WHERE AccountId = @a AND Symbol = @s;
IF @@ROWCOUNT = 0
  INSERT dbo.Positions (AccountId, Symbol, Qty, UpdatedUtc) VALUES (@a, @s, @qty, SYSUTCDATETIME());
COMMIT;

-- 2. Insert and treat a duplicate-key error (2627/2601) as "exists", then update
~~~

The **unique constraint** on the natural key is the real guarantee; the locking hints prevent the error from happening. {{SERIALIZABLE}} here takes a key-range lock only on that key (with a supporting index), so contention stays local.

For bulk upserts: load into a staging table, then set-based UPDATE + INSERT ... WHERE NOT EXISTS in one transaction with appropriate locks, or {{MERGE}} with {{HOLDLOCK}} if the team accepts it and tests it.`,
  pts: [r`IF EXISTS then INSERT is a race`, r`MERGE needs HOLDLOCK and has known issues`, r`UPDLOCK + SERIALIZABLE on the key`, r`Unique constraint as the true guarantee`],
  ex: r`A position-keeping service produced duplicate rows under parallel trade imports until the upsert used UPDLOCK/SERIALIZABLE and a unique index on (AccountId, Symbol).`,
  fu: [r`Why does SERIALIZABLE not lock the whole table here?`, r`How does PostgreSQL ON CONFLICT compare?`],
  pit: [r`Relying on application-side "check then insert".`, r`MERGE without HOLDLOCK in concurrent code.`] },

{ id: 'q34', level: 'Senior', tags: ['t-sql', 'query', 'lag-lead', 'percentiles'],
  q: r`Calculate month-over-month and year-over-year revenue growth, and the median order value per region.`,
  a: r`### Month-over-month
Aggregate to one row per month first, then {{LAG(Revenue) OVER (ORDER BY Month)}} gives the previous month. Growth = (current - previous) / previous, guarding division by zero with {{NULLIF}}.

### Year-over-year
{{LAG(Revenue, 12)}} only works if every month exists; with missing months, join on {{DATEADD(year, -1, Month)}} instead, which is also clearer.

### Truncating dates
{{DATETRUNC(month, OrderDate)}} (SQL Server 2022) or {{DATEFROMPARTS(YEAR(d), MONTH(d), 1)}}; group by the truncated value, but filter with half-open ranges on the raw column so indexes are used.

### Median and percentiles
{{PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY Total) OVER (PARTITION BY Region)}} interpolates (true median); {{PERCENTILE_DISC}} returns an actual value. Both are window functions in SQL Server, so add DISTINCT or group afterwards. They sort the whole partition: on large tables consider approximate functions ({{APPROX_PERCENTILE_CONT}}, 2022) for dashboards.`,
  code: r`~~~sql
WITH monthly AS (
  SELECT DATEFROMPARTS(YEAR(OrderDate), MONTH(OrderDate), 1) AS Mth, SUM(Total) AS Revenue
  FROM dbo.Orders
  WHERE OrderDate >= '2024-01-01' AND OrderDate < '2026-11-01'
  GROUP BY DATEFROMPARTS(YEAR(OrderDate), MONTH(OrderDate), 1))
SELECT m.Mth, m.Revenue,
       LAG(m.Revenue) OVER (ORDER BY m.Mth) AS PrevMonth,
       100.0 * (m.Revenue - LAG(m.Revenue) OVER (ORDER BY m.Mth)) / NULLIF(LAG(m.Revenue) OVER (ORDER BY m.Mth), 0) AS MoMPct,
       ly.Revenue AS SameMonthLastYear,
       100.0 * (m.Revenue - ly.Revenue) / NULLIF(ly.Revenue, 0) AS YoYPct
FROM monthly m
LEFT JOIN monthly ly ON ly.Mth = DATEADD(year, -1, m.Mth)
ORDER BY m.Mth;

-- Median and 95th percentile order value per region
SELECT DISTINCT Region,
       PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY Total) OVER (PARTITION BY Region) AS MedianOrder,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY Total) OVER (PARTITION BY Region) AS P95Order
FROM dbo.Orders;
~~~`,
  pts: [r`Aggregate per month first, then LAG for month-over-month.`, r`Join on DATEADD(year, -1, month) for year-over-year when months can be missing.`, r`NULLIF guards division by zero.`, r`Filter raw dates with half-open ranges; group by the truncated date.`, r`PERCENTILE_CONT gives the true median; approximate percentiles for big dashboards.`],
  ex: r`A finance dashboard's LAG(12) year-over-year was wrong for a new region that had no sales for two months; joining on DATEADD fixed every number.`,
  fu: [r`How would you compute a 3-month rolling growth rate?`, r`Why is AVG a bad proxy for a typical order value?`],
  pit: [r`LAG(12) with gaps in months.`, r`Grouping by a function of the column in the WHERE clause, killing index seeks.`] },

{ id: 'q35', level: 'Senior', tags: ['t-sql', 'query', 'pivot'],
  q: r`Pivot monthly sales into columns per month, including a dynamic version when the months are not known in advance. How do you avoid SQL injection?`,
  a: r`### Static pivot
Either the {{PIVOT}} operator or **conditional aggregation** ({{SUM(CASE WHEN Mth = 1 THEN Amount END)}}). Conditional aggregation is often clearer, handles several aggregates at once and is easy to port to other databases.

### Dynamic pivot
When the column list comes from data (months, product names), build the column list with {{STRING_AGG(QUOTENAME(x), ',')}} and run it with {{sp_executesql}}. **QUOTENAME** brackets and escapes each identifier, which is the injection defence; values used in filters still go through parameters, never string concatenation.

### Unpivot
{{UNPIVOT}} or, more flexibly, {{CROSS APPLY (VALUES ...)}}, which keeps NULLs if you want them and can unpivot several column groups together.

### When not to pivot in SQL
Pivoting for display is usually better done in the reporting layer or the front end; dynamic SQL complicates plan caching, permissions and testing. Pivot in SQL when the consumer is a fixed-format export or a downstream system.`,
  code: r`~~~sql
-- Conditional aggregation (static)
SELECT ProductId,
       SUM(CASE WHEN MONTH(SaleDate) = 1 THEN Amount END) AS Jan,
       SUM(CASE WHEN MONTH(SaleDate) = 2 THEN Amount END) AS Feb,
       SUM(CASE WHEN MONTH(SaleDate) = 3 THEN Amount END) AS Mar
FROM dbo.Sales WHERE SaleDate >= '2026-01-01' AND SaleDate < '2026-04-01'
GROUP BY ProductId;

-- Dynamic pivot over regions present in the data
DECLARE @cols nvarchar(max), @sql nvarchar(max), @year int = 2026;
SELECT @cols = STRING_AGG(QUOTENAME(Region), ',') WITHIN GROUP (ORDER BY Region)
FROM (SELECT DISTINCT Region FROM dbo.Sales) r;
SET @sql = N'SELECT ProductId, ' + @cols + N'
FROM (SELECT ProductId, Region, Amount FROM dbo.Sales WHERE YEAR(SaleDate) = @y) s
PIVOT (SUM(Amount) FOR Region IN (' + @cols + N')) p;';
EXEC sp_executesql @sql, N'@y int', @y = @year;      -- value stays a parameter

-- Unpivot with CROSS APPLY (VALUES ...)
SELECT q.ProductId, v.Quarter, v.Amount
FROM dbo.QuarterlySales q
CROSS APPLY (VALUES ('Q1', q.Q1), ('Q2', q.Q2), ('Q3', q.Q3), ('Q4', q.Q4)) v(Quarter, Amount);
~~~`,
  pts: [r`Conditional aggregation is the most readable and portable pivot.`, r`Dynamic pivot: build columns with STRING_AGG(QUOTENAME(...)) and run sp_executesql.`, r`QUOTENAME escapes identifiers; values stay parameters.`, r`CROSS APPLY (VALUES ...) is the flexible unpivot.`, r`Prefer pivoting in the presentation layer unless the output format is fixed.`],
  ex: r`A regulatory export needed one column per reporting entity, which changed quarterly; a dynamic pivot with QUOTENAME replaced a hand-edited query that had broken twice.`,
  fu: [r`How would you add a Total column and a Total row?`, r`What permissions does dynamic SQL run under?`],
  pit: [r`Concatenating user input into dynamic SQL.`, r`YEAR(SaleDate) = @y in a hot query (non-SARGable).`] },

{ id: 'q36', level: 'Senior', tags: ['gdpr', 'retention'],
  code: r`~~~sql
-- Erasure: pseudonymise the subject while preserving retained financial records
UPDATE dbo.Customers SET FullName = N'ERASED', Email = NULL, Phone = NULL, ErasedUtc = SYSUTCDATETIME() WHERE CustomerId = @id;
-- Temporal history also holds PII: purge it for the subject (requires turning versioning off briefly)
ALTER TABLE dbo.Customers SET (SYSTEM_VERSIONING = OFF);
DELETE FROM dbo.CustomersHistory WHERE CustomerId = @id;
ALTER TABLE dbo.Customers SET (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.CustomersHistory));
INSERT dbo.ErasureLog (CustomerId, ErasedUtc) VALUES (@id, SYSUTCDATETIME());   -- re-applied after any restore
~~~`,
  q: r`How do you implement data retention and GDPR erasure in SQL Server when backups, audit tables and replicas also hold the data?`,
  a: r`### Know where personal data lives
A data map: tables/columns classified (SQL Server data classification labels), plus copies: replicas, CDC tables, temporal history, audit tables, backups, warehouse, logs, search indexes, caches.

### Erasure approaches
- **Delete or anonymise** in the system of record and propagate via events to every derived store (search, warehouse, caches) with confirmation.
- **Temporal/ledger history**: history tables need explicit handling (temporal history can be cleaned with system versioning briefly off, under change control; ledger tables cannot be altered, so keep personal data out of them and reference it by pseudonymous id).
- **Crypto-shredding**: encrypt each subject's personal fields with a per-subject key; erasing the key makes all copies (including backups) unreadable.
- **Backups**: usually not rewritten; document that erased data in backups expires with backup retention and is never restored into production without re-applying erasures (keep an erasure log to replay after any restore).

### Retention
Retention periods per data class (e.g. 7 years for transaction records vs 2 years for marketing consent), implemented as scheduled, batched purges or partition switching, with legal holds that override them.

### Evidence
Log erasure requests and completion per system for auditors and DPO reporting.`,
  pts: [r`Data map including every copy`, r`Propagate erasure to derived stores`, r`Crypto-shredding for immutable copies`, r`Erasure log replayed after restores`, r`Retention by data class with legal hold`],
  ex: r`After restoring a database from backup to fix corruption, the team replayed the erasure log so previously erased customers did not reappear.`,
  fu: [r`How do you reconcile "right to erasure" with AML record-keeping obligations?`, r`What is pseudonymisation versus anonymisation?`],
  pit: [r`Forgetting temporal history, CDC tables and search indexes.`, r`Restoring old backups without re-applying erasures.`] },

{ id: 'q37', level: 'Principal', tags: ['scaling'],
  code: r`~~~csharp
// Reads to readable secondaries, writes to primary
var write = "Server=tcp:ag-listener,1433;Database=Shop;MultiSubnetFailover=True;Encrypt=True";
var read  = "Server=tcp:ag-listener,1433;Database=Shop;ApplicationIntent=ReadOnly;MultiSubnetFailover=True;Encrypt=True";
builder.Services.AddDbContext<ShopDb>(o => o.UseSqlServer(write));
builder.Services.AddDbContext<ShopReadDb>(o => o.UseSqlServer(read).UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking));
~~~`,
  q: r`How do you scale SQL Server reads and writes?`,
  a: r`**Reads**: indexing and query fixes first; caching (Redis) for hot reads; **readable secondaries** in an AG (read-intent routing via {{ApplicationIntent=ReadOnly}}), with replica lag awareness; reporting moved to a warehouse/columnstore.

**Writes**: they go to a single primary, so scale **up** (CPU, memory, faster log storage), reduce write amplification (fewer indexes, narrow rows), batch, use in-memory OLTP for hot contention points, and fix last-page insert contention ({{OPTIMIZE_FOR_SEQUENTIAL_KEY}} in 2019+).

Beyond one primary: **shard** by tenant or key (application-level routing, elastic database tools), or split by domain (each service its own database). Sharding adds cross-shard query and rebalancing complexity; adopt only when single-node limits are real.`,
  pts: [r`Reads: indexes, cache, secondaries`, r`Writes: one primary, scale up and reduce amplification`, r`Shard by tenant only when needed`],
  ex: r`Routing reporting traffic to a readable secondary cut primary CPU by 35% without code changes beyond the connection string.`,
  fu: [r`What is last-page insert contention?`],
  pit: [r`Reading your own writes from an asynchronous secondary.`] },

{ id: 'q38', level: 'Principal', tags: ['auditing', 'compliance'],
  code: r`~~~sql
CREATE TABLE audit.Events (
  EventId bigint IDENTITY PRIMARY KEY, OccurredUtc datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  Actor nvarchar(128) NOT NULL, Action varchar(64) NOT NULL, Entity varchar(64) NOT NULL, EntityId varchar(64) NOT NULL,
  Before nvarchar(max) NULL, After nvarchar(max) NULL, PrevHash binary(32) NULL, RowHash binary(32) NOT NULL);  -- hash chain
DENY UPDATE, DELETE ON audit.Events TO app_role;
-- SQL Server 2022 ledger tables: tamper-evident by the engine
CREATE TABLE dbo.LimitChanges (Id int PRIMARY KEY, AccountId int, NewLimit decimal(19,4)) WITH (LEDGER = ON (APPEND_ONLY = ON));
~~~`,
  q: r`How do you build an audit trail that satisfies regulators?`,
  a: r`Requirements: who changed what, when, from where, before and after values; tamper evidence; retention; searchable.

Options combined by need:

- **Temporal tables** for full row history with "as of" queries.
- **Application-level audit events** (business meaning: "fee waived by user X, reason Y") written in the same transaction as the change.
- **SQL Server Audit** for privileged and DDL activity, sent to a secured location.
- **Ledger tables** (SQL Server 2022 / Azure SQL): cryptographically chained history giving tamper evidence, with digests stored in immutable storage.

Controls: separate audit storage permissions from operators (segregation of duties), UTC timestamps, retention policies, and PII handling (erasure requests vs immutability: pseudonymise or crypto-shred personal fields).`,
  pts: [r`Business events + row history + DDL audit`, r`Ledger tables for tamper evidence`, r`Segregation of duties`, r`Erasure vs immutability plan`],
  ex: r`Ledger tables let a payments firm prove to auditors that settlement records were not altered after posting.`,
  fu: [r`How do you reconcile GDPR erasure with immutable ledgers?`],
  pit: [r`Audit tables writable by the same app login.`] },

{ id: 'q39', level: 'Principal', tags: ['architecture', 'decision'],
  code: r`~~~text
Decision matrix (weights agreed with stakeholders)
Criterion (weight)            SQL Server   PostgreSQL
Licence TCO (30)              2            5
Team skills (20)              5            3
Plan control / Query Store(15) 5           3
Extensions & portability (15) 2            5
Managed options (10)          4            5
Existing estate fit (10)      5            2
Weighted                      3.5          4.0   -> PostgreSQL for new services, keep core on SQL Server
~~~`,
  q: r`SQL Server versus PostgreSQL for a new platform: how do you decide?`,
  a: r`| Factor | SQL Server | PostgreSQL |
|---|---|---|
| Licensing cost | Significant (per core, Enterprise for many HA/perf features) | Free; pay for managed service only |
| HA/DR | Mature AGs, FCI, integrated tooling | Streaming replication + Patroni or managed (RDS/Aurora, Azure Flexible) |
| Tooling | SSMS, Query Store, rich DMVs, integration with .NET/Windows/AD | psql, pg_stat_statements, rich extension ecosystem |
| Features | Columnstore, In-Memory OLTP, temporal, ledger | JSONB, extensions (PostGIS, pgvector, TimescaleDB), rich types |
| Concurrency | Locking by default, RCSI/snapshot optional | MVCC always; vacuum to manage |
| Cloud | Azure SQL family; RDS | Every cloud, Aurora, Neon, many hosts |
| Skills | Common in .NET/enterprise shops | Broad, growing |

Decide by workload needs, total cost (licences dominate at scale), existing skills and operational tooling, compliance requirements, and ecosystem features you need (vector search, GIS). For a .NET shop with heavy BI on Microsoft tools and DBAs, SQL Server is reasonable; for cost-sensitive cloud-native services, PostgreSQL is a strong default. Avoid running both without a reason.`,
  pts: [r`Licensing vs feature/tooling maturity`, r`MVCC vs locking default`, r`Skills and operations matter as much as features`],
  ex: r`A fintech chose PostgreSQL for new services (cost, pgvector) while keeping core ledger on SQL Server where AG expertise existed.`,
  fu: [r`What would trigger a migration of an existing SQL Server estate?`],
  pit: [r`Choosing on benchmarks instead of total cost and operational capability.`] },

{ id: 'q40', level: 'Principal', tags: ['ledger', 'design'],
  code: r`~~~sql
CREATE TABLE dbo.Journal (JournalId bigint IDENTITY PRIMARY KEY, IdempotencyKey varchar(64) NOT NULL UNIQUE, CreatedUtc datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME());
CREATE TABLE dbo.Postings (JournalId bigint NOT NULL REFERENCES dbo.Journal, AccountId bigint NOT NULL, Amount decimal(19,4) NOT NULL,
  CONSTRAINT PK_Postings PRIMARY KEY (JournalId, AccountId));
CREATE OR ALTER PROCEDURE dbo.PostTransfer @Key varchar(64), @From bigint, @To bigint, @Amt decimal(19,4) AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRAN;
    INSERT dbo.Journal (IdempotencyKey) VALUES (@Key);                  -- duplicate retry fails here
    DECLARE @j bigint = SCOPE_IDENTITY();
    UPDATE dbo.Accounts SET Balance -= @Amt WHERE AccountId = @From AND Balance >= @Amt;   -- lock lower id first in real code
    IF @@ROWCOUNT = 0 THROW 50001, 'Insufficient funds', 1;
    UPDATE dbo.Accounts SET Balance += @Amt WHERE AccountId = @To;
    INSERT dbo.Postings VALUES (@j, @From, -@Amt), (@j, @To, @Amt);    -- sums to zero
  COMMIT;
END
~~~`,
  q: r`Design a double-entry ledger schema in SQL Server that is correct under concurrency.`,
  a: r`### Model
- {{Accounts(AccountId, Currency, Status, RowVersion)}}.
- {{JournalEntries(EntryId, IdempotencyKey UNIQUE, CreatedAt, Description)}}.
- {{Postings(PostingId, EntryId, AccountId, Amount decimal(19,4), Direction)}}: each entry's postings sum to zero (debits = credits), enforced in the posting procedure and checked by reconciliation.
- {{AccountBalances(AccountId, Balance, LastPostingId, RowVersion)}}: a maintained snapshot for fast reads; the postings table is the source of truth.

### Write path
One transaction: insert the entry (unique idempotency key stops duplicates), insert postings, update balances with **conditional updates** ({{WHERE Balance + @delta >= 0}} for no-overdraft accounts) and consistent account ordering (lowest id first) to avoid deadlocks.

### Integrity and audit
Append-only (no UPDATE/DELETE on postings: corrections are reversing entries), ledger tables or hash chaining for tamper evidence, daily reconciliation that balances sum to postings and entries sum to zero.`,
  pts: [r`Append-only postings, entries sum to zero`, r`Idempotency key unique`, r`Conditional balance updates in id order`, r`Reversals, not edits`],
  ex: r`~~~sql
UPDATE dbo.AccountBalances
SET Balance = Balance + @delta, LastPostingId = @postingId
WHERE AccountId = @acct AND (@allowNegative = 1 OR Balance + @delta >= 0);
IF @@ROWCOUNT = 0 THROW 50010, 'Insufficient funds or account locked', 1;
~~~`,
  fu: [r`How do you handle hot accounts (a merchant receiving thousands of postings per second)?`],
  pit: [r`Storing only a balance column and updating it in place.`] },

{ id: 'q41', level: 'Principal', tags: ['hot-spots', 'scaling'],
  code: r`~~~sql
-- Split the hot balance into N sub-balances; writers pick one, readers sum
CREATE TABLE dbo.MerchantBalanceSlots (MerchantId bigint NOT NULL, Slot tinyint NOT NULL, Balance decimal(19,4) NOT NULL,
  CONSTRAINT PK_MBS PRIMARY KEY (MerchantId, Slot));
UPDATE dbo.MerchantBalanceSlots SET Balance += @amt WHERE MerchantId = @m AND Slot = ABS(CHECKSUM(NEWID())) % 32;
SELECT SUM(Balance) FROM dbo.MerchantBalanceSlots WHERE MerchantId = @m;
-- Alternative: append-only postings + periodic aggregation (no row is updated by every request)
~~~`,
  q: r`A single "hot" row (merchant balance) is the throughput bottleneck. What are your options?`,
  a: r`Contention on one row serialises all writers. Options, by increasing complexity:

1. **Shorten the critical section**: only the balance update inside the transaction, nothing else; RCSI so readers do not block.
2. **Append-only postings without updating a balance row on every write**; compute balances asynchronously (or periodically), and check limits differently for accounts that receive funds (credits need no overdraft check).
3. **Sub-accounts / striping**: split the hot balance into N buckets (hash of posting id), sum on read; checks for debits run against the aggregate with care.
4. **Batching**: aggregate many small credits in memory/queue and post one entry per interval (accepting latency in visible balance).
5. **In-Memory OLTP** for the contention point.

Choose based on which invariants must be immediate (debits that can overdraw) versus eventually consistent (incoming credits).`,
  pts: [r`Know which invariants must be synchronous`, r`Append-only + async balance`, r`Striped buckets`, r`Batch credits`],
  ex: r`A marketplace's settlement account went from 300 to 8,000 postings per second by striping into 32 buckets for credits.`,
  fu: [r`How do you enforce a credit limit across striped buckets?`],
  pit: [r`Scaling up hardware for a single-row lock bottleneck.`] },

{ id: 'q42', level: 'Principal', tags: ['migration', 'cloud'],
  code: r`~~~bash
# Assess at scale, then migrate in waves with online methods
az datamigration sql-server-schema --action MigrateSchema ...      # or Azure Migrate / DMA assessments
az datamigration sql-managed-instance create --source-database-name Payments --target-db-name Payments \
  --scope /subscriptions/.../managedInstances/mi-prod --source-sql-connection ... --offline-configuration offline=false
~~~
~~~text
Wave plan: 1) low-risk internal DBs  2) apps with clean connection strings  3) DBs with Agent jobs / linked servers
          4) the critical core, with rehearsed cutover and rollback. Each wave: assess -> remediate -> replicate -> cut over -> decommission
~~~`,
  q: r`Plan the migration of 200 on-premises SQL Server databases to the cloud.`,
  a: r`1. **Discover and assess**: inventory (size, version, features used, dependencies like linked servers, Agent jobs, SSIS, CLR, cross-DB queries), performance baselines, criticality, compliance; tools: Azure Migrate/DMA, AWS DMS/SCT, Query Store baselines.
2. **Choose targets per group**: PaaS (Azure SQL DB/MI, RDS) where features allow, VMs for the rest; decide licensing (Hybrid Benefit/BYOL).
3. **Landing zone**: networking (private endpoints), identity, backups, monitoring, DR design, cost guardrails.
4. **Pilot** low-risk databases end-to-end; build runbooks.
5. **Migrate in waves** with minimal downtime: log shipping / AG distributed or MI link / DMS continuous replication; cutover with a rollback plan.
6. **Validate**: data checks, performance vs baseline (Query Store), application tests.
7. **Optimise**: right-size after 2-4 weeks of real metrics; reserved capacity.
8. **Decommission** and update documentation.

Governance: a migration factory with a dashboard, wave plan, risk register, and business sign-offs.`,
  pts: [r`Assess features and dependencies first`, r`Pilot, then waves`, r`Near-zero-downtime replication methods`, r`Right-size after real metrics`],
  ex: r`Thirty databases needed MI because of Agent and cross-DB queries; 150 went to Azure SQL DB; 20 stayed on VMs for SSIS.`,
  fu: [r`How do you handle a database shared by 12 applications?`],
  pit: [r`Lift-and-shift sizing that copies on-prem over-provisioning.`] },

{ id: 'q43', level: 'Principal', tags: ['governance'],
  code: r`~~~yaml
# Every schema change is a reviewed migration in Git, applied by the pipeline (never by hand in prod)
- name: Schema drift + destructive change check
  run: |
    dotnet ef migrations script --idempotent -o out/migrate.sql
    ./tools/sqlcheck out/migrate.sql --deny "DROP COLUMN,DROP TABLE,ALTER COLUMN" --require-online-index
- name: Apply (prod, after approval)
  run: sqlcmd -S $SQL_SERVER -d Payments -i out/migrate.sql -b
~~~`,
  q: r`How do you govern database changes across many teams?`,
  a: r`- **Migrations as code** (EF Core migrations, DbUp, Flyway, SSDT) in the service repo; reviewed like code; run by the pipeline, never by hand in production.
- **Ownership**: each database owned by one service/team; no other team writes to it (integration via APIs/events). Shared databases are the main source of coupling.
- **Review tiers**: risky changes (large tables, locks, data migrations) need DBA/platform review with a checklist (online? batched? rollback? replica lag?).
- **Automated checks**: lint SQL, detect destructive changes, test migrations against a production-sized copy.
- **Observability standard**: Query Store on, alerts on blocking, deadlocks, log usage, replica lag.
- **Access**: least privilege, break-glass access with audit.
- **Data classification** tags for PII and retention.`,
  pts: [r`Migrations in the pipeline`, r`One owner per database`, r`Risk-tiered review`, r`Production-sized migration tests`],
  ex: r`A migration test against a masked production copy caught a 40-minute lock from an index build before release.`,
  fu: [r`How do you break up a shared database?`],
  pit: [r`DBAs running ad-hoc scripts in production with no record.`] },

{ id: 'q44', level: 'Principal', tags: ['incident'],
  code: r`~~~csharp
// Typical causes: connection string to the old node instead of the listener, no MultiSubnetFailover,
// logins/SIDs or Agent jobs not present on the new primary, long DNS TTL on the listener
var cs = new SqlConnectionStringBuilder
{
    DataSource = "tcp:ag-listener.corp,1433", InitialCatalog = "Payments",
    MultiSubnetFailover = true, ConnectRetryCount = 3, ConnectRetryInterval = 5, Encrypt = SqlConnectionEncryptOption.Mandatory
}.ConnectionString;
~~~
~~~sql
-- Logins must exist with the same SIDs on every replica (or use contained users)
SELECT name, sid FROM sys.server_principals WHERE type IN ('S','U');
~~~`,
  q: r`Incident: the AG primary failed over and the application is down although the secondary is healthy. Why, and what do you change?`,
  a: r`Typical causes after a "successful" failover:

- **Logins / SIDs missing** on the new primary (orphaned users) or mismatched passwords.
- **Connection string** pointing to a server name, not the AG **listener**, or missing {{MultiSubnetFailover=True}} (slow or failed connection to multi-subnet listeners).
- **Agent jobs, linked servers, certificates, credentials** not present on the secondary.
- **DNS/connection pooling**: applications holding dead pooled connections without retry logic.
- **Async replica** promoted with data loss, causing application errors.
- Firewall rules or DNS TTL issues in DR.

Immediate fix: correct logins/connection strings, restart pools. Long term: sync server-level objects automatically (dbatools, **contained AG** in 2022), connection resiliency in the app (retry on transient errors), regular failover drills measured against RTO, and monitoring that tests the application path, not just the replica state.`,
  pts: [r`Server objects are outside the AG`, r`Listener + MultiSubnetFailover`, r`App retry logic`, r`Drills measure real RTO`],
  ex: r`A quarterly drill revealed a missing login for the reporting service before a real outage did.`,
  fu: [r`What is a contained availability group?`],
  pit: [r`Testing failover of the database but not of the applications.`] },

{ id: 'q45', level: 'Principal', tags: ['t-sql', 'query', 'reconciliation'],
  q: r`Write a reconciliation between our ledger and a bank statement file: classify every break, handle duplicates and timing differences, and make it fast on millions of rows.`,
  a: r`Reconciliation is a **FULL OUTER JOIN** on a match key followed by classification, but the hard parts are the matching rules and scale.

### Matching rules (agree them with finance first)
1. Exact match on reference + amount + currency.
2. Tolerant match: same amount and currency, value dates within N business days (timing differences).
3. Many-to-one: one bank line settles several ledger entries (batch payouts), matched on sums.

### Break classes
- **Missing in ledger** (bank only): unbooked fees, unknown receipts.
- **Missing at bank** (ledger only): not yet settled, or failed payment.
- **Amount mismatch**: FX, fees deducted, partial settlement.
- **Duplicate**: the same reference twice on one side; must be detected **before** joining, otherwise the join multiplies rows.

### Scale and correctness
Stage both sides into tables with computed match keys and indexes; run passes from strict to tolerant, marking matched rows so later passes only see leftovers; keep results immutable per run (run id) for audit; never update source data. Totals per class must reconcile back to the control totals of both files.`,
  code: r`~~~sql
-- 0. Duplicates inside each side (would multiply join results)
SELECT Reference, COUNT(*) FROM recon.Bank WHERE RunId = @run GROUP BY Reference HAVING COUNT(*) > 1;

-- 1. Strict pass: classify every row (filter each side by run BEFORE the outer join)
WITH l AS (SELECT * FROM recon.Ledger WHERE RunId = @run),
     b AS (SELECT * FROM recon.Bank   WHERE RunId = @run)
SELECT COALESCE(l.Reference, b.Reference) AS Reference,
       l.Amount AS LedgerAmount, b.Amount AS BankAmount,
       CASE WHEN l.Reference IS NULL THEN 'MISSING_IN_LEDGER'
            WHEN b.Reference IS NULL THEN 'MISSING_AT_BANK'
            WHEN l.Amount <> b.Amount OR l.Currency <> b.Currency THEN 'AMOUNT_MISMATCH'
            ELSE 'MATCHED' END AS Status
INTO #pass1
FROM l FULL OUTER JOIN b ON b.Reference = l.Reference;

-- 2. Tolerant pass for timing differences: same amount/currency, value date within 3 days, one-to-one
WITH cand AS (
  SELECT l.LedgerId, b.BankId,
         ROW_NUMBER() OVER (PARTITION BY l.LedgerId ORDER BY ABS(DATEDIFF(day, l.ValueDate, b.ValueDate)), b.BankId) AS rl,
         ROW_NUMBER() OVER (PARTITION BY b.BankId ORDER BY ABS(DATEDIFF(day, l.ValueDate, b.ValueDate)), l.LedgerId) AS rb
  FROM recon.UnmatchedLedger l
  JOIN recon.UnmatchedBank b ON b.Amount = l.Amount AND b.Currency = l.Currency
   AND b.ValueDate BETWEEN DATEADD(day, -3, l.ValueDate) AND DATEADD(day, 3, l.ValueDate))
INSERT recon.Matches (RunId, LedgerId, BankId, Rule)
SELECT @run, LedgerId, BankId, 'AMOUNT_DATE_3D' FROM cand WHERE rl = 1 AND rb = 1;

-- 3. Control totals must tie out
SELECT Status, COUNT(*) AS Items, SUM(COALESCE(LedgerAmount, 0)) AS Ledger, SUM(COALESCE(BankAmount, 0)) AS Bank
FROM #pass1 GROUP BY Status;
~~~`,
  pts: [r`FULL OUTER JOIN on a match key, then CASE to classify each break.`, r`Detect duplicates per side before joining, or the join multiplies rows.`, r`Run passes from strict to tolerant and exclude already-matched rows.`, r`Use ROW_NUMBER in both directions to keep tolerant matches one-to-one.`, r`Immutable results per run id, and control totals that tie back to both files.`],
  ex: r`A payments team's daily reconciliation dropped from 3 hours of spreadsheet work to a 6-minute job with 4 matching passes; unexplained breaks fell from about 400 a day to under 20, all genuinely needing investigation.`,
  fu: [r`How would you match one bank line to several ledger entries that sum to it?`, r`How do you make the reconciliation auditable?`],
  pit: [r`Joining before removing duplicates.`, r`A tolerant pass that matches one bank line to several ledger lines.`, r`Updating source tables during reconciliation.`],
  tip: r`Start with "what are the matching rules, agreed with finance?" That is the Principal signal here, not the JOIN.` },

{ id: 'q46', level: 'Principal', tags: ['data-architecture'],
  code: r`~~~sql
-- One database (or schema) per service, one login per service, no cross-database queries
CREATE LOGIN orders_svc WITH PASSWORD = '...'; CREATE USER orders_svc FOR LOGIN orders_svc;
ALTER ROLE db_datareader ADD MEMBER orders_svc; ALTER ROLE db_datawriter ADD MEMBER orders_svc;
-- Reporting reads replicas/CDC streams into a warehouse instead of joining across service databases
~~~`,
  q: r`How should a microservices platform use SQL Server without creating a distributed monolith?`,
  a: r`- **Database per service** (or schema per service with strict permissions): no cross-service joins or shared tables; services integrate through APIs and events.
- **Outbox** in each service's database for reliable event publishing (CDC or polling relay).
- **Read models** built from events for cross-service queries; reporting via a warehouse fed by CDC/events, not by querying service databases directly.
- **Consolidate physically, separate logically** to control cost: many service databases on a shared, well-managed instance or elastic pool, with resource governance to limit noisy neighbours.
- **Reference data** owned by one service and replicated.
- **Sagas** for cross-service transactions instead of distributed transactions.

The anti-pattern to avoid: a shared database with ten services reading and writing each other's tables, which makes every schema change a cross-team release.`,
  pts: [r`Logical isolation per service`, r`Outbox + events, read models`, r`Physical consolidation with governance`, r`No shared tables`],
  ex: r`Ten services on one Azure SQL elastic pool, each with its own database and login, kept costs low while preserving independence.`,
  fu: [r`How do you migrate off a shared database incrementally?`],
  pit: [r`Cross-database joins between service databases.`] },

{ id: 'q47', level: 'Principal', tags: ['t-sql', 'query', 'fraud', 'window-functions'],
  q: r`Fraud rule: flag cards with more than 3 transactions within any 10-minute window, or total spend above 5,000 within 24 hours. Write it and make it scale.`,
  a: r`This is a **sliding time window** problem: "any 10 minutes" means a window that ends at each transaction, not fixed buckets (fixed buckets miss bursts that straddle a boundary).

### Approaches
- **Self-join on a time range**: for each transaction, count the same card's transactions in the previous 10 minutes. Correct and simple; with an index on {{(CardId, TxnAt)}} each probe is a short range seek.
- **APPLY with COUNT**: same idea, often a clearer plan.
- **LAG(TxnAt, 3)**: "more than 3 in 10 minutes" is equivalent to "the 3rd previous transaction is within 10 minutes", which is a single scan and the fastest. Interviewers like this insight.
- SQL Server window frames support ROWS but not time-based RANGE intervals, so for the 24-hour spend rule use APPLY with a range predicate.

### Scale and production
Batch SQL is fine for after-the-fact investigations and model features. **Real-time** authorisation decisions (under 50 ms) belong in a streaming system or an in-memory velocity store (Redis sorted sets, Flink), with SQL used to backtest rules on history. Deduplicate retries and reversals first, or legitimate retries look like velocity.`,
  code: r`~~~sql
-- More than 3 transactions in 10 minutes: the 3rd previous one is within 10 minutes (single scan)
SELECT CardId, TxnId, TxnAt
FROM (SELECT CardId, TxnId, TxnAt,
             LAG(TxnAt, 3) OVER (PARTITION BY CardId ORDER BY TxnAt, TxnId) AS ThirdPrev
      FROM dbo.CardTxns WHERE TxnAt >= DATEADD(day, -1, SYSUTCDATETIME()) AND Status <> 'REVERSED') x
WHERE ThirdPrev >= DATEADD(minute, -10, TxnAt);

-- Spend above 5,000 within the 24 hours ending at each transaction
SELECT t.CardId, t.TxnId, t.TxnAt, w.Spend24h
FROM dbo.CardTxns t
CROSS APPLY (SELECT SUM(p.Amount) AS Spend24h
             FROM dbo.CardTxns p
             WHERE p.CardId = t.CardId AND p.TxnAt > DATEADD(hour, -24, t.TxnAt) AND p.TxnAt <= t.TxnAt) w
WHERE w.Spend24h > 5000 AND t.TxnAt >= DATEADD(day, -1, SYSUTCDATETIME());

CREATE INDEX IX_CardTxns_Card_Time ON dbo.CardTxns (CardId, TxnAt) INCLUDE (Amount, Status);
~~~`,
  pts: [r`"Any 10 minutes" is a sliding window ending at each transaction, not fixed buckets.`, r`LAG(TxnAt, 3) within 10 minutes detects "more than 3" in a single scan.`, r`APPLY with a time-range predicate handles sum-over-24-hours rules.`, r`Index (CardId, TxnAt) INCLUDE (Amount) so every probe is a short seek.`, r`Real-time decisions belong in a streaming/velocity store; SQL backtests rules.`],
  ex: r`A card issuer backtested a new velocity rule over 18 months of transactions in SQL before deploying it to the real-time engine; the backtest showed the rule would have flagged 0.4% of genuine customers, so the threshold was raised before launch.`,
  fu: [r`How would you count distinct merchants per card in the last hour?`, r`How do retries and reversals distort velocity rules?`],
  pit: [r`Fixed 10-minute buckets that miss bursts across a boundary.`, r`Running the query over all history without a time filter.`] },

{ id: 'q48', level: 'Principal', tags: ['t-sql', 'query', 'relational-division'],
  q: r`Find customers who bought every product in a given set (relational division), and the smallest set of customers that makes up 80% of revenue.`,
  a: r`### Relational division
"Customers who bought **all** of products A, B and C" cannot be expressed with a simple join. Two standard solutions:

- **Count method**: filter to the target products, group by customer, and require {{COUNT(DISTINCT ProductId)}} equal to the size of the set. Fast and readable.
- **Double NOT EXISTS**: "there is no target product that the customer has not bought". Logically pure, handles "exact division" variants, slower to read.

Decide with the interviewer whether "exactly these products and nothing else" is meant (exact division): add a condition that the customer bought no other products.

### Pareto (80% of revenue)
Rank customers by revenue, compute the running share of total, and keep customers until the running share reaches 80%. Include the customer that **crosses** the threshold: filter on the running share **before** adding the current customer being below 80%.

These two queries test whether a candidate thinks in sets rather than loops.`,
  code: r`~~~sql
-- Customers who bought ALL products in the target set (count method)
DECLARE @target TABLE (ProductId int PRIMARY KEY);
INSERT @target VALUES (101), (205), (309);
SELECT o.CustomerId
FROM dbo.OrderLines ol JOIN dbo.Orders o ON o.OrderId = ol.OrderId
WHERE ol.ProductId IN (SELECT ProductId FROM @target)
GROUP BY o.CustomerId
HAVING COUNT(DISTINCT ol.ProductId) = (SELECT COUNT(*) FROM @target);

-- Same with double NOT EXISTS
SELECT c.CustomerId FROM dbo.Customers c
WHERE NOT EXISTS (
  SELECT 1 FROM @target t
  WHERE NOT EXISTS (SELECT 1 FROM dbo.OrderLines ol JOIN dbo.Orders o ON o.OrderId = ol.OrderId
                    WHERE o.CustomerId = c.CustomerId AND ol.ProductId = t.ProductId));

-- Customers making up 80% of revenue (include the one that crosses the line)
WITH rev AS (SELECT CustomerId, SUM(Total) AS Revenue FROM dbo.Orders GROUP BY CustomerId),
cum AS (SELECT CustomerId, Revenue,
               SUM(Revenue) OVER (ORDER BY Revenue DESC, CustomerId ROWS UNBOUNDED PRECEDING) AS RunningRev,
               SUM(Revenue) OVER () AS TotalRev
        FROM rev)
SELECT CustomerId, Revenue, 100.0 * RunningRev / TotalRev AS CumPct
FROM cum
WHERE RunningRev - Revenue < 0.8 * TotalRev
ORDER BY Revenue DESC;
~~~`,
  pts: [r`Relational division: filter to the set, GROUP BY customer, HAVING COUNT(DISTINCT) = set size.`, r`Double NOT EXISTS expresses "no target product not bought".`, r`Clarify exact division (only these products) versus at least these.`, r`Pareto: running SUM over revenue DESC divided by the total.`, r`Include the row that crosses the threshold by testing the running total before it.`],
  ex: r`A cross-sell team used relational division to find clients holding all three core products (current account, card, savings), then the Pareto query to show that 7% of clients produced 80% of fee revenue, which reshaped relationship-manager coverage.`,
  fu: [r`Find customers who bought exactly the set and nothing else.`, r`How would you do this per month efficiently?`],
  pit: [r`COUNT(*) instead of COUNT(DISTINCT), so repeat purchases fake a match.`, r`Dropping the customer that crosses the 80% line.`] },

{ id: 'q49', level: 'Principal', tags: ['indexes', 'design'],
  code: r`~~~sql
-- OLTP: clustered on OrderId; point lookups by public id
CREATE UNIQUE INDEX UX_Orders_PublicId ON dbo.Orders (PublicId);
-- Customer screens: covering index for "my orders" newest first
CREATE INDEX IX_Orders_Customer ON dbo.Orders (CustomerId, CreatedUtc DESC) INCLUDE (Status, Total);
-- Finance reports: nonclustered columnstore for aggregates, partitioned by month for retention
CREATE NONCLUSTERED COLUMNSTORE INDEX NCCI_Orders ON dbo.Orders (CreatedUtc, Status, Total, Currency, MerchantId);
-- Free-text customer search goes to a search index, not LIKE '%x%' on 300 M rows
~~~`,
  q: r`An Orders table (300M rows) serves OLTP lookups, customer search screens and finance reports. Design its indexing and data-access strategy.`,
  a: r`### Separate the workloads first
One table cannot be optimal for point writes, ad-hoc search, and large aggregations at the same time. Decide per workload:

| Workload | Access pattern | Strategy |
|---|---|---|
| OLTP (create, get by id, list by customer) | Point and narrow range | Clustered on {{BIGINT IDENTITY}} {{OrderId}}; NCI {{(CustomerId, CreatedAt DESC) INCLUDE (Status, Total)}}; unique NCI on {{ExternalRef}} for idempotency |
| Back-office search (any of 12 filters, free text) | Unpredictable predicates | Do not index every combination; move to a search index (OpenSearch) fed by CDC/outbox, or a few composite indexes for the top 3 filter combinations found in Query Store |
| Finance reports (sums by day, merchant, currency) | Large scans and aggregations | Non-clustered **columnstore** on the table (operational analytics) or a separate reporting store/warehouse; partition by month for archive |

### Rules applied
- Every index justified by a **named query** from Query Store with its frequency and cost; unused indexes ({{sys.dm_db_index_usage_stats}}, observed over a full business cycle including month-end) removed.
- Write budget: each extra index adds write latency and log volume; measure insert p99 before and after.
- Filtered indexes for hot subsets ({{WHERE Status IN ('Pending','Processing')}}) instead of full-table indexes on low-selectivity columns.
- Read replicas for search/report traffic if it stays in SQL Server; stale-by-seconds is acceptable there.

### Governance
Index changes go through migrations with a review checklist (online build, size, write impact), and a quarterly index review.`,
  pts: [r`Different workloads, different structures`, r`Every index tied to a measured query`, r`Columnstore or warehouse for reports`, r`Search engine for free-form search`, r`Filtered indexes for hot subsets`],
  ex: r`An orders table had 27 indexes added over years; usage stats over a quarter showed 11 unused. Removing them cut insert latency by 40% and the log volume by a third, while search moved to OpenSearch.`,
  fu: [r`How do you decide to drop an index safely?`, r`What changes if the table is partitioned?`],
  pit: [r`Adding every missing-index suggestion.`, r`Measuring index usage over a week that excludes month-end.`],
  tip: r`Asking "which queries and how often?" before proposing any index is the Principal signal.` },

{ id: 'q50', level: 'Principal', tags: ['code-review', 't-sql'],
  q: r`Code review: what is wrong with this stored procedure that applies a fee to an account?`,
  a: r`~~~sql
CREATE PROCEDURE dbo.ApplyFee @AccountId int, @Fee float AS
BEGIN
  DECLARE @bal float;
  SELECT @bal = Balance FROM Accounts WITH (NOLOCK) WHERE AccountId = @AccountId;
  IF @bal >= @Fee
  BEGIN
    BEGIN TRAN
      UPDATE Accounts SET Balance = @bal - @Fee WHERE AccountId = @AccountId;
      INSERT INTO FeeLog VALUES (@AccountId, @Fee, GETDATE());
    COMMIT
  END
END
~~~

Findings, most severe first:

1. **Lost update / race**: balance read outside the transaction, then written as {{@bal - @Fee}}. Two concurrent calls both read 100 and both write 90: one fee is lost (or worse, a concurrent deposit is overwritten). Use an atomic conditional update: {{UPDATE ... SET Balance = Balance - @Fee WHERE AccountId = @AccountId AND Balance >= @Fee}} and check {{@@ROWCOUNT}}.
2. **{{NOLOCK}}** reads uncommitted data (a deposit that later rolls back) to make a financial decision.
3. **{{float}} for money**: binary rounding errors; use {{decimal(19,4)}} matching the column.
4. **No idempotency**: a client retry after a timeout charges twice. Accept a {{@RequestId}} with a unique constraint in {{FeeLog}}.
5. **No error handling**: without {{SET XACT_ABORT ON}} and TRY/CATCH a failure between statements can leave an open transaction or a partial write.
6. {{INSERT ... VALUES}} without a column list breaks when the table changes.
7. {{GETDATE()}} is local server time; use {{SYSUTCDATETIME()}}.
8. Missing schema-qualification on {{Accounts}}/{{FeeLog}} (minor plan-cache and resolution cost), no {{SET NOCOUNT ON}}.

~~~sql
CREATE OR ALTER PROCEDURE dbo.ApplyFee @AccountId bigint, @Fee decimal(19,4), @RequestId uniqueidentifier AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRAN;
    INSERT dbo.FeeLog (RequestId, AccountId, Fee, CreatedUtc) VALUES (@RequestId, @AccountId, @Fee, SYSUTCDATETIME()); -- unique RequestId: duplicate retry fails fast
    UPDATE dbo.Accounts SET Balance = Balance - @Fee WHERE AccountId = @AccountId AND Balance >= @Fee;
    IF @@ROWCOUNT = 0 THROW 50020, 'Insufficient funds', 1;
  COMMIT;
END
~~~

(The caller treats a duplicate-key error on {{RequestId}} as "already applied" and returns the original result.)`,
  pts: [r`Read-then-write race: use atomic conditional update`, r`NOLOCK for money decisions`, r`float for money`, r`Idempotency via unique request id`, r`XACT_ABORT and error handling`],
  ex: r`This exact read-modify-write pattern caused a fee to be charged twice and a deposit to vanish under load in a retail-banking batch; the conditional update eliminated both.`,
  fu: [r`How would you test for the race condition?`, r`Why insert the log row before the update?`],
  pit: [r`Fixing only the data type and missing the race.`, r`Adding HOLDLOCK everywhere instead of a single atomic statement.`] }
],
cheat: r`### Storage and indexes
Clustered = table (narrow, unique, static, increasing key). Non-clustered leaf holds clustering key → key lookups. Covering via INCLUDE. Every index taxes writes. Columnstore for analytics, rowstore for OLTP.

### Plans
Estimates drive everything → statistics matter. Read actual plans: estimate vs actual, lookups, scans, spills, CONVERT_IMPLICIT. SARGable predicates; half-open date ranges; match parameter types. Parameter sniffing → RECOMPILE / OPTIMIZE FOR / Query Store forcing / PSP (2022).

### Concurrency
| Problem | Fix |
|---|---|
| Readers vs writers blocking | RCSI |
| Deadlock 1205 | Consistent order, covering index, short txn, UPDLOCK, app retry |
| Lock escalation (~5,000 locks) | Batch, index, partition-level escalation |
| Queue table | UPDLOCK + READPAST + lease |
| Duplicates under concurrency | UNIQUE index (idempotency key) |
| Open txn on error | SET XACT_ABORT ON |

### Operations
FULL recovery + log backups (RPO) + tested restores. AG sync local, async DR; logins/jobs outside the AG; listener + MultiSubnetFailover. Expand/contract migrations; online, resumable index ops; batch large deletes.

### Diagnose
sp_WhoIsActive → wait stats → what changed → Query Store regressed queries → force plan → fix root cause.

### T-SQL query patterns (most asked)
| Problem | Pattern |
|---|---|
| Nth highest salary | DENSE_RANK() = N (ties), OFFSET N-1 FETCH 1 in a scalar subquery (NULL if missing) |
| Top earner per department | RANK() OVER (PARTITION BY dept ORDER BY salary DESC) = 1 |
| Earns more than manager | Self-join e.ManagerId = m.EmployeeId |
| Duplicates | GROUP BY key HAVING COUNT(*) > 1; DELETE via ROW_NUMBER CTE where rn > 1; then a unique index |
| Never ordered | NOT EXISTS (never NOT IN with NULLs) |
| Top-N per group | ROW_NUMBER <= N, or OUTER APPLY TOP (N) with index (group, sort DESC) |
| Consecutive days | date - ROW_NUMBER() = island key; LEAD for gaps |
| Running total | SUM() OVER (ORDER BY d, id ROWS UNBOUNDED PRECEDING) |
| MoM / YoY | Aggregate per month, LAG; join on DATEADD(year, -1, m) |
| Median | PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY x) OVER (PARTITION BY g) |
| Hierarchy | Recursive CTE, path + MAXRECURSION as cycle guard |
| Pivot | SUM(CASE ...) or dynamic PIVOT with QUOTENAME + sp_executesql |
| Bought all of a set | GROUP BY customer HAVING COUNT(DISTINCT product) = set size |

### Say this
"WAL: log latency is commit latency." "NOLOCK is not a fix." "Query Store first, then fix." "Append-only ledger, corrections are reversals." "Licensing is the biggest cost lever."`
});
})(String.raw);
