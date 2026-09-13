> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: [[01-Indexing-Query-Execution-Plans]]

# SQL Server Interview Workbook — Transactions, ACID, Isolation Levels & Locking

Part of the **Top SQL Interview Questions & Answers Workbook** (see [[03-SQL-Fundamentals]] for the entry-point file and the workbook-wide sample schemas). This file covers global questions **Q20–Q29** — transactions, ACID, isolation levels, locking, blocking, deadlocks, and concurrency control, calibrated for Principal/Staff Engineer and Architect-level interviews at top-tier financial institutions.

**Canonical sample schemas used throughout:** `Employees(EmployeeID, FirstName, LastName, DepartmentID, ManagerID, Salary, HireDate)`, `Accounts(AccountID, CustomerID, Balance, Currency)`, `Transactions(TransactionID, AccountID, Amount, TransactionType, Status, CreatedAt, IdempotencyKey)`, `LedgerEntries(LedgerEntryID, AccountID, TransactionID, DebitAmount, CreditAmount, EntryDate)`.

---

### Q20. What are the ACID properties, and how does SQL Server actually implement each one?

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
ACID is Atomicity, Consistency, Isolation, and Durability — the four guarantees a transaction must provide. SQL Server implements them concretely: **Atomicity** via the transaction log — every modification is written to the log before the data page (write-ahead logging, WAL), so on `ROLLBACK` or crash recovery SQL Server can undo partial work. **Consistency** is enforced by constraints (PK/FK/CHECK/UNIQUE), triggers, and the atomic all-or-nothing guarantee — the database moves from one valid state to another. **Isolation** is controlled by the transaction isolation level (locking or row-versioning based), which determines what one transaction can see of another's uncommitted or concurrently-committed changes. **Durability** is guaranteed because a `COMMIT` doesn't return until the log record for that commit is hardened to disk (or to the log file's storage) — the data pages themselves can still be flushed later by the lazy writer/checkpoint, because the log is replayed on restart.

**2. SQL Query**
```sql
BEGIN TRANSACTION;

UPDATE dbo.Accounts SET Balance = Balance - 500 WHERE AccountID = 101;
UPDATE dbo.Accounts SET Balance = Balance + 500 WHERE AccountID = 202;

IF (SELECT Balance FROM dbo.Accounts WHERE AccountID = 101) < 0
BEGIN
    ROLLBACK TRANSACTION;
    THROW 50001, 'Insufficient funds; transfer rolled back.', 1;
END
ELSE
    COMMIT TRANSACTION;
```

**3. Explain the Query**
This is a funds-transfer transaction — the textbook ACID example. Both `UPDATE`s must succeed or neither must: that's atomicity. The `CHECK`-style guard against a negative balance (in real systems this would also be a `CHECK CONSTRAINT`) protects consistency. Until `COMMIT`, both rows are exclusively locked, so no other transaction can see the debited-but-not-yet-credited intermediate state — that's isolation. Once `COMMIT TRANSACTION` returns, the change survives a server crash — that's durability, guaranteed by the log flush that happens as part of commit processing.

**4. Sample Data**
| AccountID | Balance |
|---|---|
| 101 | 1000.00 |
| 202 | 250.00 |

**5. Expected Output**
| AccountID | Balance |
|---|---|
| 101 | 500.00 |
| 202 | 750.00 |

**6. Alternative Solutions**
- **Application-level compensating logic** (no DB transaction, retry/undo in code): rejected — durability and atomicity become the application's problem, and a crash between the two updates leaves the ledger inconsistent with no recovery path.
- **`CHECK CONSTRAINT (Balance >= 0)` instead of the manual `IF` guard**: preferred in production — it's enforced unconditionally (can't be bypassed by a code path that forgets the check) and it fails the whole statement/transaction automatically, which is more robust than an application-level `IF`.
- **Preferred**: explicit transaction + `CHECK CONSTRAINT` combined — the constraint is the safety net, the transaction is the atomicity boundary.

**7. Performance**
No special indexing need beyond the PK on `AccountID` (a seek, not a scan, on both updates). The cost that matters here is **lock duration**: both rows are held with exclusive (X) locks from the first `UPDATE` until `COMMIT`/`ROLLBACK`. Keep the transaction as short as possible — no user interaction, no network round-trip, no unrelated work between `BEGIN TRAN` and `COMMIT` — because every millisecond the locks are held is a millisecond another transfer touching the same account blocks. Verify with `sys.dm_tran_locks` and `sys.dm_exec_requests` (see Q25) that lock duration matches expectations under load, not just correctness in isolation.

**8. Edge Cases**
- Second `UPDATE`'s `AccountID` doesn't exist → 0 rows affected, no error raised by default, but the money "disappears." Production code must check `@@ROWCOUNT` after each statement.
- Concurrent transfers touching the same two accounts in opposite order → classic deadlock setup (see Q26); always acquire resources in a consistent order (e.g., lower `AccountID` first).
- Crash exactly after the log record for `COMMIT` is hardened but before the client receives acknowledgment → the transaction is still committed (durability holds); the client must treat a dropped connection during commit as "unknown outcome, check state" rather than "assume failure."

**9. Production Scenario**
This is literally the pay-in/pay-out pattern in a payments or core-banking ledger: any operation that moves value between two internal accounts (transfer, fee capture, refund) is modeled as one atomic transaction touching both sides of the ledger, never as two independent statements.

**10. Interview Follow-ups**
1. What happens to the locks if the client's connection drops between the two `UPDATE`s but before `COMMIT`/`ROLLBACK`?
2. How does SQL Server guarantee durability if the data pages haven't been written to disk yet at commit time?
3. Can you get atomicity without an explicit transaction?
4. What's the difference between an implicit and explicit transaction here?
5. How would you redesign this to also produce an auditable ledger entry (double-entry) rather than just mutating a balance?

**11. Follow-up Answers**
1. SQL Server detects the broken connection (attention/session termination) and automatically rolls back any open transaction on that session — orphaned locks are not left held indefinitely.
2. Durability is guaranteed by the transaction **log**, not the data file. `COMMIT` only returns after the log record is flushed (hardened) to stable storage. On restart, SQL Server's recovery process replays (`REDO`) committed transactions from the log against the data files and undoes (`UNDO`) uncommitted ones — the data file can lag the log and still be durable, because the log is authoritative.
3. Yes — every single statement in SQL Server runs inside an implicit atomic transaction by default (autocommit mode); a single `UPDATE` is atomic even with no `BEGIN TRAN`. Explicit transactions are needed only to make **multiple** statements atomic together.
4. Implicit/autocommit: each statement commits on its own. Explicit (`BEGIN TRAN`...`COMMIT`/`ROLLBACK`): you control the atomic boundary across multiple statements, which is required here since two accounts must change together.
5. Insert two `LedgerEntries` rows (a debit and a credit) inside the same transaction instead of (or in addition to) mutating `Accounts.Balance` directly — see Q137/Q138 in the FinTech section for the full double-entry design.

**12. Common Mistakes**
- Treating "SQL Server supports transactions" as equivalent to "my code is safe" — atomicity only spans the statements actually inside `BEGIN...COMMIT`.
- Not checking `@@ROWCOUNT`/`@@ERROR` (or, in modern code, not wrapping in `TRY...CATCH` with `XACT_ABORT ON`) — a failed statement inside a transaction does not automatically roll back the whole transaction unless `XACT_ABORT` is set or you check and roll back explicitly.
- Holding transactions open across application-tier round-trips (e.g., waiting on an external API call) — this destroys the "isolation should be brief" assumption every locking-based isolation level relies on.

**13. Architect Insight**
A Senior engineer can define ACID. A Principal/Architect explains that ACID is a **cost you're choosing to pay for correctness**, and that the design lever isn't "use a transaction," it's *how much work happens inside the atomic boundary*. The discriminating move at this bar: recognize that `XACT_ABORT ON` should be a standing `SET` option in production stored procedures (so any runtime error auto-rolls-back instead of leaving a transaction open on the connection), and that transaction scope is a first-class design decision made at the same time as the schema — not an afterthought wrapped around already-written statements.

---

### Q21. Explain SQL Server's transaction isolation levels — what does each one actually change?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
SQL Server has five isolation levels along a spectrum trading consistency for concurrency: **READ UNCOMMITTED** (no shared locks taken, no blocking, dirty reads allowed), **READ COMMITTED** (default — never reads uncommitted data, but the same row can change between two reads in the same transaction), **REPEATABLE READ** (holds shared locks until end of transaction so previously-read rows can't change, but new rows can still appear — phantoms), **SERIALIZABLE** (range locks prevent phantoms too — full isolation, most blocking), and **SNAPSHOT** (row-versioning based instead of locking — readers see a transactionally-consistent point-in-time view and never block writers or get blocked by them, at the cost of tempdb version-store overhead and possible update conflicts).

**2. SQL Query**
```sql
-- Session A
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
BEGIN TRANSACTION;
SELECT Balance FROM dbo.Accounts WHERE AccountID = 101;   -- reads 1000
-- ... Session B commits an UPDATE to AccountID 101 here ...
SELECT Balance FROM dbo.Accounts WHERE AccountID = 101;   -- reads 800 (non-repeatable read)
COMMIT;
```

**3. Explain the Query**
Under `READ COMMITTED`, each individual `SELECT` only guarantees it won't read uncommitted data *at the moment it runs* — it takes and releases shared locks per-statement. Between the two `SELECT`s in the same transaction, Session B's committed change becomes visible, so the same row yields two different values inside one logical transaction. This is by design at this isolation level and is the textbook demonstration of a **non-repeatable read**.

**4. Sample Data**
`Accounts`: `AccountID=101, Balance=1000.00` initially; Session B runs `UPDATE Accounts SET Balance = 800 WHERE AccountID = 101; COMMIT;` between Session A's two reads.

**5. Expected Output**
First `SELECT`: `1000.00`. Second `SELECT` (same transaction): `800.00`.

**6. Alternative Solutions**
- **REPEATABLE READ**: re-running the query under this level holds a shared lock on the row after the first read, so Session B's `UPDATE` blocks until Session A commits — the second read is guaranteed to return `1000.00` too. Cost: more blocking.
- **SNAPSHOT**: Session A would see `1000.00` both times, from its own transactionally-consistent snapshot, *without blocking Session B's update at all* — Session B's update just creates a new version. This is usually the better fix in high-concurrency OLTP systems because it removes reader/writer blocking entirely.
- **Preferred for financial reporting/reconciliation reads**: `SNAPSHOT` over `REPEATABLE READ` — same consistency guarantee for reads, none of the blocking cost, at the price of tempdb version-store space and needing `ALLOW_SNAPSHOT_ISOLATION ON` at the database level.

**7. Performance**
Locking isolation levels (`READ COMMITTED` through `SERIALIZABLE`) trade concurrency for consistency purely via lock scope and duration — verify actual blocking with `sys.dm_tran_locks` joined to `sys.dm_exec_requests` (Q25). `SNAPSHOT`/`READ_COMMITTED_SNAPSHOT` trade blocking for **tempdb pressure** (row versions must be stored and cleaned up) — monitor `sys.dm_tran_active_snapshot_database_transactions` and tempdb version-store size, not just query duration, before assuming snapshot isolation is "free."

**8. Edge Cases**
- Long-running Session A under `SNAPSHOT` can hold the tempdb version store from being cleaned up, growing tempdb — a real production incident category.
- `SERIALIZABLE` with a range predicate and no supporting index escalates to full-table range locks — very easy to accidentally block an entire table.
- `READ UNCOMMITTED`/`NOLOCK` can return **more or fewer rows than actually ever existed** if a page split happens mid-scan — not just "old data," genuinely wrong data.

**9. Production Scenario**
End-of-day reconciliation and reporting jobs that must read a transactionally-consistent view of the ledger while trading continues to write to it are a canonical `SNAPSHOT` isolation use case — you get repeatable, consistent reads without stalling live payment processing.

**10. Interview Follow-ups**
1. What's the actual difference between `SNAPSHOT` and `READ_COMMITTED_SNAPSHOT`?
2. Why does `SERIALIZABLE` prevent phantoms when `REPEATABLE READ` doesn't?
3. What error do you get from a `SNAPSHOT` write-write conflict, and how should the application handle it?
4. Is `READ UNCOMMITTED` ever appropriate in a financial system?
5. How do you choose an isolation level for a given piece of code — what's the decision process?

**11. Follow-up Answers**
1. `READ_COMMITTED_SNAPSHOT` (RCSI) is a *database-level* setting that changes what `READ COMMITTED` means (statement-level snapshot, no code change needed, no extra isolation-level syntax). `SNAPSHOT` is an explicit, opt-in *transaction-level* isolation level (`SET TRANSACTION ISOLATION LEVEL SNAPSHOT`) giving a transaction-level (not just statement-level) consistent view. Both use the same version-store machinery in tempdb.
2. `REPEATABLE READ` locks the rows it has read, so those specific rows can't change — but a concurrent transaction can still *insert* a new row that matches the original query's predicate, and re-running the query returns it (a phantom). `SERIALIZABLE` takes range (key-range) locks covering the predicate itself, so no row — existing or new — matching that range can be inserted, updated, or deleted until the transaction ends.
3. Error 3960, "Snapshot isolation transaction aborted due to update conflict." The application must catch this and retry the transaction from the start (with fresh reads) — it is not automatically retried by SQL Server.
4. Essentially never for anything that reads balances, computes aggregates, or drives a decision. It's occasionally acceptable for approximate, non-critical monitoring/dashboard queries where a dirty read has no financial consequence, and even then `READ COMMITTED` with RCSI enabled is almost always the better choice since it removes the "genuinely wrong data" risk of `NOLOCK` at a similar blocking cost.
5. Start from the read/write mix and the correctness requirement, not a default: pure OLTP writes → `READ COMMITTED` (with RCSI at the database level to cut blocking) is usually sufficient because each statement is short. Multi-step logic that must not see intermediate concurrent changes (balance checks, inventory holds) → `SNAPSHOT` or `REPEATABLE READ`/`SERIALIZABLE` with explicit conflict-retry logic. Reporting/reconciliation → `SNAPSHOT`. Never choose based on "what stops the error I'm seeing" without first identifying which anomaly (dirty/non-repeatable/phantom read, or write skew) is actually the threat.

**12. Common Mistakes**
- Assuming `READ COMMITTED` (the default) means "I always see fresh, consistent data" — it only guarantees no dirty reads, nothing about repeatability across statements in the same transaction.
- Sprinkling `WITH (NOLOCK)` everywhere as a generic performance fix without understanding it can return duplicate rows, skip rows, or read torn/inconsistent data.
- Enabling `SNAPSHOT`/RCSI without a plan for update-conflict retries, then being surprised by intermittent error 3960 in production.

**13. Architect Insight**
A Senior answer lists the isolation levels and their read anomalies correctly. A Principal/Architect answer treats isolation level as a **per-workload architectural decision documented alongside the schema**, distinguishes RCSI (database default behavior change, near-zero code impact) from explicit `SNAPSHOT` (opt-in, requires conflict-handling code), and can articulate the tempdb capacity-planning consequence of turning on row versioning fleet-wide — which is exactly the kind of operational, infrastructure-budget-aware reasoning that separates this level from "knows the SQL syntax."

**References**
1. [SET TRANSACTION ISOLATION LEVEL (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-transaction-isolation-level-transact-sql)
2. [Transaction Locking and Row Versioning Guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide)
3. [Snapshot Isolation in SQL Server](https://learn.microsoft.com/en-us/dotnet/framework/data/adonet/sql/snapshot-isolation-in-sql-server)

---

### Q22. Demonstrate dirty reads, non-repeatable reads, and phantom reads with concrete two-session examples.

**Difficulty:** 🔴 Senior

**1. Interview Answer**
All three are anomalies that occur when a transaction reads data that a concurrent transaction is also touching. A **dirty read** sees another transaction's uncommitted change (which might later roll back). A **non-repeatable read** re-reads the *same row* within one transaction and gets a different value because another transaction committed a change to it in between. A **phantom read** re-runs the *same predicate* (a range/set query) within one transaction and gets a different *set of rows* because another transaction inserted or deleted a matching row in between. They form a strict hierarchy of what each isolation level prevents.

**2. SQL Query**
```sql
-- Dirty read demonstration
-- Session A:
BEGIN TRANSACTION;
UPDATE dbo.Accounts SET Balance = Balance - 500 WHERE AccountID = 101;  -- not yet committed

-- Session B (READ UNCOMMITTED):
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT Balance FROM dbo.Accounts WHERE AccountID = 101;  -- sees the -500, uncommitted

-- Session A:
ROLLBACK TRANSACTION;  -- Session B's read was of data that never actually existed
```

**3. Explain the Query**
Session B reads a balance that reflects a debit which Session A then rolls back — Session B made a decision (or displayed a number) based on data that was never true. This is only possible under `READ UNCOMMITTED` (or `NOLOCK`), because that level takes no shared locks and doesn't wait for Session A's exclusive lock to be released.

**4. Sample Data**
`Accounts.AccountID=101, Balance=1000.00`.

**5. Expected Output**
Session B reads `500.00` (dirty — Session A never committed this). After Session A's rollback, the true balance remains `1000.00`.

**6. Alternative Solutions**
- Non-repeatable read and phantom read variants follow the same two-session pattern: for non-repeatable, Session B commits an `UPDATE` to a row Session A has already read once (under `READ COMMITTED`); for phantom, Session B commits an `INSERT` matching a range Session A has already queried once (under `REPEATABLE READ`, which doesn't block inserts, only existing-row changes).
- The fix for all three is raising the isolation level to the one that prevents the specific anomaly you care about, or switching to `SNAPSHOT` isolation, which prevents dirty and non-repeatable reads by design (and, combined with proper range logic, addresses phantoms as write-conflicts instead).

**7. Performance**
Preventing these anomalies is not free: `READ UNCOMMITTED` has effectively zero locking cost but zero correctness guarantee; each step up (`READ COMMITTED` → `REPEATABLE READ` → `SERIALIZABLE`) holds locks longer and over a wider scope, which is measured as increased average wait time in `sys.dm_os_wait_stats` (`LCK_M_*` wait types) and increased blocking-chain length in `sys.dm_exec_requests`.

**8. Edge Cases**
- A dirty read of a row that a rolled-back transaction *inserted* isn't just "a wrong value" — the row itself vanishes after rollback, which can break code that fetched a "current" ID and tried to use it downstream.
- Non-repeatable reads inside a multi-step calculation (read balance, compute fee, write result) can silently use inconsistent inputs across steps even though each individual read was itself correct.
- Phantom reads matter most for aggregate queries re-run inside one transaction (e.g., `SELECT SUM(Amount)` re-executed after a concurrent insert) — the aggregate itself changes, which is easy to miss in testing with low concurrency.

**9. Production Scenario**
A risk/exposure calculation that reads a customer's open positions twice within one transaction (once to compute exposure, once to double-check before approving a new trade) must not be vulnerable to a non-repeatable or phantom read — otherwise the second check can pass against data that no longer matches reality by the time the trade is approved.

**10. Interview Follow-ups**
1. Which anomaly does `REPEATABLE READ` still permit, and why is that acceptable at that level?
2. Can `SNAPSHOT` isolation still produce phantom-like effects?
3. Why doesn't `READ COMMITTED` (with RCSI) suffer from dirty reads even though it doesn't hold long-duration locks?
4. How would you write an automated test that reliably reproduces a non-repeatable read?
5. What's "write skew," and which of these three anomalies does it relate to?

**11. Follow-up Answers**
1. Phantom reads — `REPEATABLE READ` locks the specific rows already read, but a *new* row inserted by another transaction doesn't exist yet to be locked, so it can appear on a re-query. This is accepted because locking an entire predicate range (what `SERIALIZABLE` does) is significantly more expensive and most workloads don't need it.
2. Not in the classic sense — a `SNAPSHOT` transaction sees a fixed, transactionally-consistent point-in-time view for its whole duration, so a re-run query returns the same row set. It can instead surface as an **update conflict** (error 3960) if the snapshot transaction tries to write something another transaction has since changed.
3. Because RCSI serves each statement a *committed* row version from the version store rather than the live, possibly-uncommitted row — it never needs to wait for or read another transaction's uncommitted data, it just reads an older-but-committed version instead.
4. Open two connections/sessions explicitly (e.g., two `SqlConnection`s in an integration test), start a transaction on the first, read a row, have the second connection commit an update to that row, then read again on the first connection and assert the value changed — this must be a true two-connection test; a single connection can't demonstrate it.
5. Write skew is a related-but-distinct anomaly where two transactions each read overlapping data, then each write to a *different* row based on what they read, and the combination violates an invariant that neither transaction's individual write would have violated alone (e.g., two doctors each checking "am I the last on-call" and both going off-call). Plain phantom-read prevention doesn't stop it — it requires `SERIALIZABLE` or explicit application-level constraints, and is a well-known gap even at strong isolation levels in many systems.

**12. Common Mistakes**
- Confusing "non-repeatable read" (same row, different value) with "phantom read" (different row *set*) — interviewers specifically probe this distinction.
- Believing `SNAPSHOT` isolation eliminates all concurrency anomalies — it eliminates dirty/non-repeatable reads and (practically) phantoms for reads, but write-write conflicts and write skew are still possible and must be handled.
- Testing for these anomalies with a single session/connection, which cannot reproduce them at all.

**13. Architect Insight**
Anyone can define the three anomalies. The Architect-level distinction is recognizing that **each isolation level is defined by exactly which anomalies it forbids**, that this is a formal hierarchy (not a vague "stricter is safer" spectrum), and that the correct engineering question is never "what's the safest isolation level" but "which specific anomaly, if it occurred, would violate a real invariant in this workflow" — then choosing the cheapest level that prevents *that* anomaly, not the strongest one available.

**References**
1. [Transaction Locking and Row Versioning Guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide)
2. [SET TRANSACTION ISOLATION LEVEL (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-transaction-isolation-level-transact-sql)

---

### Q23. What lock types and modes does SQL Server use, and how do they interact?

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
SQL Server's core lock modes are **Shared (S)** for reads, **Exclusive (X)** for writes, **Update (U)** to avoid a conversion deadlock when a statement will read-then-write the same row, and **Intent locks (IS, IX, IU)** taken at a higher granularity (page, table) to signal "a lock is held somewhere below this level" so another transaction doesn't have to scan every row to know a table-level lock is safe to take. Compatibility between modes determines blocking: two `S` locks are compatible (concurrent readers don't block each other); `S` and `X` are not; `X` and anything else are not. `U` is compatible with `S` but not with another `U` or `X` — this is specifically what prevents the classic "two transactions both take a shared lock intending to upgrade to exclusive, then deadlock" pattern.

**2. SQL Query**
```sql
-- Demonstrates an Update lock avoiding a conversion deadlock
BEGIN TRANSACTION;

UPDATE dbo.Accounts WITH (UPDLOCK)
SET Balance = Balance - 100
WHERE AccountID = 101;

-- Inspect current locks held by this session
SELECT
    tl.resource_type,
    tl.request_mode,
    tl.request_status,
    OBJECT_NAME(p.object_id) AS TableName
FROM sys.dm_tran_locks tl
LEFT JOIN sys.partitions p ON tl.resource_associated_entity_id = p.hobt_id
WHERE tl.request_session_id = @@SPID;

COMMIT TRANSACTION;
```

**3. Explain the Query**
`WITH (UPDLOCK)` forces SQL Server to take an Update lock on the row as soon as it's read for the `WHERE` clause, rather than a plain Shared lock. If two transactions both did a plain `SELECT ... WHERE AccountID = 101` intending to follow up with an `UPDATE`, both could acquire compatible `S` locks, and then both try to escalate to `X` simultaneously — neither can proceed, and neither will release: a deadlock. Taking `U` up front means only one transaction can hold it at a time, so the second one blocks *before* doing any work, instead of deadlocking after. The `sys.dm_tran_locks` query then shows exactly which lock types are held for this session, joined back to the object name via the partition's `hobt_id`.

**4. Sample Data**
Single row: `AccountID=101, Balance=1000.00`.

**5. Expected Output**
The `sys.dm_tran_locks` query returns rows like: `resource_type=KEY, request_mode=U, request_status=GRANT, TableName=Accounts` (and typically an `IX` at `PAGE` and `IX` at `OBJECT`/table level too), showing the intent-lock hierarchy backing the row-level Update lock.

**6. Alternative Solutions**
- **Plain `SELECT` then `UPDATE`** (no hint): simplest to write, but exposes the read-then-write conversion-deadlock risk under concurrency — not recommended for a read-modify-write pattern under contention.
- **`UPDLOCK` (shown above)**: the standard fix for read-then-write races; serializes contenders instead of deadlocking them.
- **`UPDLOCK, HOLDLOCK`** together: adds repeatable-read-strength holding of the lock for the whole transaction, useful for check-then-act patterns (e.g., "does this row exist, if not insert it") to also prevent a concurrent insert.
- **Preferred**: `UPDLOCK` on any statement that reads a row specifically in order to decide whether/how to modify it — it's cheap insurance against an entire class of intermittent deadlocks that are painful to reproduce later.

**7. Performance**
Intent locks are metadata, not row-count-proportional — they cost effectively nothing per row and exist purely so lock compatibility checks at a coarse granularity don't require scanning every fine-grained lock below. The real cost driver is **lock duration and row count**, not lock type per se: verify with `sys.dm_tran_locks` under representative concurrent load, not just single-session testing, since these effects only manifest with actual contention.

**8. Edge Cases**
- Lock compatibility is evaluated per-resource, not per-transaction — a transaction can simultaneously hold `S` on one row and `X` on another; only same-resource compatibility matters.
- Under RCSI/`SNAPSHOT`, readers largely don't take blocking-relevant `S` locks at all (they read a version instead), which changes the whole calculus above for read-heavy workloads.
- Schema-modification (`Sch-M`) locks are a distinct category from data locks entirely, and even a "harmless" `SELECT` will block behind an in-progress `ALTER TABLE` because of `Sch-S`/`Sch-M` incompatibility — a common surprise in production deployments.

**9. Production Scenario**
Order/inventory-hold logic ("check remaining stock, then decrement it") is the classic read-then-write pattern that needs `UPDLOCK` to avoid two concurrent checkouts both reading the same stock count and both proceeding, or deadlocking each other while trying.

**10. Interview Follow-ups**
1. Why is a plain `S` lock not sufficient protection for a read-then-write sequence?
2. What's the difference between `UPDLOCK` and `XLOCK`?
3. How do intent locks let SQL Server avoid scanning every row to check for a table-level conflict?
4. What lock mode does a `SELECT` take under `SNAPSHOT` isolation?
5. How would you diagnose which lock mode is causing a specific blocking incident in production?

**11. Follow-up Answers**
1. Because two transactions can each hold a compatible `S` lock on the same row simultaneously; when both then try to convert to `X` to perform their write, neither can proceed since `X` isn't compatible with the other's still-held `S` — a lock-conversion deadlock, not a request-time block.
2. `UPDLOCK` is compatible with `S` (other readers can still take a shared lock concurrently) but not with another `U` or `X` — it only blocks other *writers/updaters*, not readers. `XLOCK` is a plain exclusive lock taken proactively (e.g., on a `SELECT` you want to fully serialize) — incompatible with everything, including other readers, so it's more restrictive.
3. If a transaction wants a table-level `X` lock, it only needs to check for incompatible intent locks at that same table level (IS/IX/IU counts) rather than inspecting every individual row lock beneath it — intent locks are the summarized signal.
4. Effectively none that block writers — under `SNAPSHOT` (or RCSI), reads are satisfied from a row version in tempdb and don't need to acquire a blocking-relevant `S` lock on the live row at all, which is precisely why snapshot-based isolation doesn't block writers.
5. Query `sys.dm_exec_requests` for sessions with a non-null `blocking_session_id`, join to `sys.dm_tran_locks` to see the specific `request_mode` and `resource_type` each session holds/wants, and use `sys.dm_exec_sql_text`/`sys.dm_exec_input_buffer` on both the blocked and blocking session IDs to see the actual statements involved (full method detailed in Q25).

**12. Common Mistakes**
- Assuming `NOLOCK`/`READ UNCOMMITTED` is a locking "fix" for blocking rather than a correctness trade-off — it avoids taking `S` locks but doesn't change the underlying contention on writers.
- Not knowing intent locks exist at all, and being unable to explain the `IX`/`IS` rows that show up in `sys.dm_tran_locks` output.
- Using `XLOCK` reflexively instead of the less-restrictive `UPDLOCK` for a plain read-then-write, unnecessarily blocking concurrent readers too.

**13. Architect Insight**
The Senior-level answer names the lock modes. The Architect-level answer explains *why the compatibility matrix is shaped the way it is* — specifically that `U` exists purely to break a specific deadlock pattern architecturally rather than relying on application-level retry logic — and can point to `sys.dm_tran_locks` as the concrete diagnostic tool rather than treating locking as a black box you reason about only in the abstract.

**References**
1. [Transaction Locking and Row Versioning Guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide)
2. [sys.dm_tran_locks (Transact-SQL)](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-tran-locks-transact-sql)

---

### Q24. What is lock escalation, when does it trigger, and how do you control it?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Lock escalation is SQL Server converting many fine-grained row/page locks into a single coarser table-level (or partition-level, since SQL Server 2008+) lock, to bound the memory cost of lock management. It triggers when a single statement holds roughly **5,000 or more locks** on one table (checked periodically, not exactly at 5,000), or under general server lock-memory pressure. The consequence: a statement that was only touching a small subset of rows suddenly holds an exclusive lock on the *entire table*, blocking unrelated queries that would otherwise not have conflicted at all.

**2. SQL Query**
```sql
-- A large single-statement UPDATE risking escalation
UPDATE dbo.Transactions
SET Status = 'ARCHIVED'
WHERE CreatedAt < DATEADD(YEAR, -7, GETUTCDATE());

-- Controlling it per table:
ALTER TABLE dbo.Transactions SET (LOCK_ESCALATION = DISABLE);

-- Or breaking the large operation into batches to stay under the threshold:
DECLARE @RowsAffected INT = 1;
WHILE @RowsAffected > 0
BEGIN
    UPDATE TOP (2000) dbo.Transactions
    SET Status = 'ARCHIVED'
    WHERE CreatedAt < DATEADD(YEAR, -7, GETUTCDATE())
      AND Status <> 'ARCHIVED';

    SET @RowsAffected = @@ROWCOUNT;
END
```

**3. Explain the Query**
The single large `UPDATE` may acquire tens of thousands of row/key locks if the predicate matches many rows, crossing the ~5,000-lock threshold and escalating to a table lock — blocking every other reader and writer on `Transactions` for the statement's duration. `ALTER TABLE ... SET (LOCK_ESCALATION = DISABLE)` tells SQL Server never to escalate for this table (used sparingly, and it doesn't remove memory pressure, just moves the trade-off). The batched-loop version is the more broadly-applicable fix: each `UPDATE TOP (2000)` stays well under the escalation threshold and commits (implicitly, per statement, or explicitly per batch) before the next batch starts, so no single statement ever holds enough locks to trigger escalation, and other transactions get interleaved access between batches.

**4. Sample Data**
`Transactions` table with several million historical rows, a small fraction older than 7 years.

**5. Expected Output**
Rows matching the age predicate have `Status = 'ARCHIVED'`; with the batched approach, this happens incrementally without a sustained table-level lock.

**6. Alternative Solutions**
- **`LOCK_ESCALATION = DISABLE`**: stops escalation but does nothing to reduce the actual number of row locks held, and heavy lock-memory use remains a server-wide concern — a blunt instrument, best reserved for tables where you've proven table-lock blocking is worse than the memory cost.
- **`LOCK_ESCALATION = AUTO`** (partition-aware): escalates to partition-level instead of table-level for partitioned tables — a good middle ground when the table is already partitioned (e.g., by date) and concurrent access is naturally partition-isolated.
- **Batching (preferred)**: addresses the root cause (one statement touching too many rows) rather than suppressing the symptom, and has the added production benefit of bounding transaction-log growth and lock hold time per batch.

**7. Performance**
Batching trades total wall-clock time (more overhead from repeated statement start/commit) for concurrency (other transactions get windows to run between batches) — verify the batch size empirically: too small and overhead dominates, too large and you re-approach the escalation threshold or excessive log growth per batch.

**8. Edge Cases**
- Escalation can also occur due to *aggregate* server-wide lock memory pressure, not just a single statement's count — a server under heavy concurrent load can see escalation on statements that would be fine in isolation.
- Disabling escalation on a hot OLTP table can let a single runaway query hold an enormous number of row locks, consuming server memory (each lock has a fixed in-memory cost) rather than escalating — sometimes worse than the blocking it was meant to avoid.
- Partitioned tables with `LOCK_ESCALATION = AUTO` still escalate to full-table if the statement spans multiple partitions.

**9. Production Scenario**
Nightly archival/purge jobs against large transaction-history or audit tables are the most common real-world trigger for escalation-related incidents — an unbounded `DELETE`/`UPDATE` against millions of rows escalates to a table lock and blocks live traffic for the job's duration, which is exactly why these jobs are batched in production financial systems.

**10. Interview Follow-ups**
1. Why does the escalation threshold exist at all — what's the actual cost of holding many fine-grained locks?
2. Can escalation happen from `S` locks (a large `SELECT`), not just `X`?
3. How would you detect that escalation actually happened, after the fact?
4. Why is partition-level escalation better than table-level for a date-partitioned table?
5. What's the operational risk of globally disabling lock escalation server-wide (trace flag 1211/1224) versus per-table?

**11. Follow-up Answers**
1. Each lock is a small but non-zero structure in server memory (roughly on the order of 64–128 bytes depending on version/lock type); millions of row locks across many concurrent large statements can consume gigabytes of memory that would otherwise serve the buffer pool — escalation bounds this memory cost by trading it for coarser-grained blocking.
2. Yes — a large `SELECT` under an isolation level that takes shared locks (e.g., `REPEATABLE READ`/`SERIALIZABLE`, or `READ COMMITTED` without RCSI while the read is in flight) can also cross the threshold and escalate its `S` locks to a shared table lock, blocking writers (though not other readers, since `S`-table is still compatible with other `S` requests).
3. Query the `Lock:Escalation` extended event/trace event, or check `sys.dm_os_performance_counters` for the `Lock Manager > Lock Table Lock Escalations/sec` counter; a spike correlated with the job's run window confirms it.
4. Because concurrent access to a date-partitioned transaction table is typically also date-scoped (recent-partition writes, historical-partition reads/archival) — escalating to the specific partition being touched, instead of the whole table, leaves unrelated partitions completely unaffected.
5. Trace flags 1211 (disable escalation entirely, server-wide) and 1224 (disable only the row/page-count threshold, keep memory-pressure-triggered escalation) are blunt, server-wide instruments — they affect every table on the instance, including ones where escalation was actually helping bound memory use. Per-table `ALTER TABLE ... SET (LOCK_ESCALATION = ...)` is almost always the better-scoped choice; reaching for the trace flags is a signal the real problem (one specific job's unbounded statement) hasn't actually been fixed.

**12. Common Mistakes**
- Treating lock escalation as a bug to eliminate everywhere, rather than a deliberate memory/concurrency trade-off that's usually fine for genuinely bulk operations run at low-traffic times.
- Reaching for server-wide trace flags before trying per-table settings or, better, batching the actual offending statement.
- Not realizing that a `SELECT` can trigger escalation too, and only ever looking at `UPDATE`/`DELETE` statements when investigating.

**13. Architect Insight**
A Senior candidate knows escalation exists and roughly when. A Principal/Architect treats the escalation threshold as a **capacity-planning input to job design**: any bulk operation against a large table is designed batched from the start, with batch size chosen from measured lock counts and log growth, not discovered reactively after an incident report about nightly blocking. This is also where the Architect connects the dots to Q115 (500-million-row table strategy) — partitioning and batched maintenance are the same underlying discipline applied at different points in the system's lifecycle.

**References**
1. [Resolve Blocking Problems Caused by Lock Escalation](https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/performance/resolve-blocking-problems-caused-lock-escalation)
2. [Lock:Escalation Event Class](https://learn.microsoft.com/en-us/sql/relational-databases/event-classes/lock-escalation-event-class)
3. [Server Configuration: locks](https://learn.microsoft.com/en-us/sql/database-engine/configure-windows/configure-the-locks-server-configuration-option)

---

### Q25. Blocking is increasing on a production server — what specifically do you check, in what order?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
I don't guess — I go straight to the DMVs. First, `sys.dm_exec_requests` filtered to `blocking_session_id <> 0` to find blocked sessions and identify the head of each blocking chain (a session that is blocking others but isn't itself blocked). Then `sys.dm_tran_locks` to see exactly what resource and lock mode the head-blocker holds and what the waiters want. Then `sys.dm_exec_sql_text`/`sys.dm_exec_input_buffer` on the blocking session's `sql_handle` to see what statement it's actually running — very often it's an open transaction sitting idle (`sleeping` status with an open transaction) waiting on something outside the database entirely, like an application-tier bug or a slow downstream call inside a transaction.

**2. SQL Query**
```sql
-- Step 1: find blocking chains
SELECT
    r.session_id,
    r.blocking_session_id,
    r.wait_type,
    r.wait_time,
    r.status,
    r.command,
    st.text AS current_statement
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) st
WHERE r.blocking_session_id <> 0
ORDER BY r.wait_time DESC;

-- Step 2: what is the head blocker actually holding, and what's it doing (may be idle)
SELECT
    s.session_id,
    s.status,
    s.open_transaction_count,
    ib.event_info AS last_statement_run
FROM sys.dm_exec_sessions s
OUTER APPLY sys.dm_exec_input_buffer(s.session_id, NULL) ib
WHERE s.session_id = @HeadBlockerSessionId;

-- Step 3: exact lock resource in contention
SELECT resource_type, resource_database_id, request_mode, request_status, request_session_id
FROM sys.dm_tran_locks
WHERE request_session_id IN (@HeadBlockerSessionId, @BlockedSessionId);
```

**3. Explain the Query**
Step 1 surfaces every currently-blocked request and, critically, its `blocking_session_id` — chains are found by following that column until you reach a session that isn't itself blocking anyone else's `blocking_session_id` (the head). Step 2 checks the head blocker's actual status: if `status = 'sleeping'` with `open_transaction_count > 0`, the connection has an open transaction but isn't currently running anything — meaning the application (not SQL Server) is the bottleneck, likely holding a transaction open across a slow external call or forgetting to commit. Step 3 pinpoints the exact resource and lock-mode conflict, confirming which statement/table/row is actually contended.

**4. Sample Data**
A blocked session (id 62) waiting `LCK_M_X` on a row, `blocking_session_id = 58`; session 58 shows `status='sleeping'`, `open_transaction_count=1`.

**5. Expected Output**
Confirms session 58 opened a transaction, executed an `UPDATE`, and never committed/rolled back — the application is holding the transaction open (e.g., during a synchronous call to a payment gateway inside the DB transaction), and every other transaction touching that row queues up behind it.

**6. Alternative Solutions**
- **`sp_who2` / Activity Monitor (GUI)**: quick and built-in, fine for a first glance, but far less precise than the DMVs above for identifying exact resources and root cause — not sufficient on its own for a real incident.
- **Extended Events "blocked process report"**: the production-grade approach — configure the `blocked process threshold` server option and capture an XE session so blocking incidents are recorded automatically with full statement text and wait chains, rather than requiring you to be actively querying DMVs at the exact moment blocking occurs.
- **Preferred for ongoing monitoring**: the blocked-process-report XE session running continuously, with the manual DMV queries above used for live, in-the-moment triage during an active incident.

**7. Performance**
These are metadata/DMV queries — negligible cost against the server, safe to run under load, and specifically designed for exactly this kind of live diagnosis without adding to the contention being investigated.

**8. Edge Cases**
- A blocking chain can be many sessions deep — always find the true head (a session blocking others while itself unblocked), not just the immediately-blocked session a user reported.
- The head blocker can be an orphaned distributed transaction (e.g., an MSDTC transaction) rather than a live connection — check `sys.dm_tran_active_transactions` in that case.
- Intermittent, self-resolving blocking (a few hundred milliseconds) is often normal OLTP behavior, not an incident — distinguish sustained/growing blocking from routine, brief lock waits before escalating.

**9. Production Scenario**
This exact triage sequence is the standard first response to a "checkout/payment processing is slow" page — the on-call engineer needs to determine within minutes whether the cause is a genuinely long-running query, a missing index, or (very commonly) application code holding a database transaction open across a slow network call.

**10. Interview Follow-ups**
1. What's the difference between blocking and a deadlock, operationally?
2. How would you set up proactive alerting for blocking rather than reacting to it?
3. What does it mean if the head blocker's `wait_type` is `NULL` but `open_transaction_count` is 1?
4. How do you find the *application code path* responsible, not just the SQL statement?
5. What immediate mitigation would you take if you found the exact cause but couldn't deploy a code fix right now?

**11. Follow-up Answers**
1. Blocking is a normal, transient consequence of lock compatibility — it resolves on its own once the blocker commits/rolls back. A deadlock is a *cycle* of blocking (A waits for B, B waits for A) that SQL Server must detect and break by killing one participant (the deadlock monitor, running roughly every 5 seconds by default) — blocking that never resolves on its own without external intervention is a different, worse failure mode than an ordinary queue.
2. Configure `sp_configure 'blocked process threshold'` (e.g., to 5 seconds) plus an Extended Events session capturing the `blocked_process_report` event, feeding into the existing monitoring/alerting pipeline (e.g., an Azure Monitor alert or a scheduled job checking for report events) so the team is paged automatically, rather than depending on a user complaint.
3. `status='sleeping'`, `wait_type=NULL` (nothing pending, not actually waiting on a resource) combined with `open_transaction_count=1` is the specific signature of an application holding a transaction open with no active statement — the classic "opened a transaction, then made a network call, forgot to commit" bug.
4. Correlate `session_id` back to the application via `sys.dm_exec_sessions.host_name`/`program_name`/`client_interface_name`, or better, ensure the application sets `SET CONTEXT_INFO` or `APPLICATION NAME` in the connection string to a value identifying the specific service/code path, and correlate the timestamp with distributed tracing (a correlation/trace ID) in the application's own logs.
5. `KILL` the blocking session as an immediate, temporary mitigation to relieve production impact (with the caveat that its transaction rolls back, which must be safe for the workload), while filing the actual code fix (shortening the transaction scope) as the real remediation — a `KILL` is triage, never a fix.

**12. Common Mistakes**
- Focusing on the blocked session's slow-seeming query instead of the head blocker — the blocked query is usually innocent; the blocker is where the actual problem lives.
- Not distinguishing "blocking" from "deadlock" in an interview answer — they're frequently conflated but require different detection and remediation.
- Reaching for `KILL` as if it were a fix rather than an emergency mitigation with data-loss/rollback implications for the killed transaction.

**13. Architect Insight**
The Senior-level answer knows the DMVs. The Principal/Architect-level answer treats blocking as a **signal about application transaction discipline**, not a database problem to be tuned away — and pushes for the actual fix to be "shrink the transaction scope in code" (e.g., move the external API call outside the `BEGIN TRAN`/`COMMIT` boundary) rather than database-side workarounds like `NOLOCK`, which the Architect recognizes just trade a visible symptom (blocking) for an invisible one (incorrect data).

**References**
1. [Understand and Resolve SQL Server Blocking Problems](https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/performance/understand-resolve-blocking)
2. [sys.dm_exec_requests (Transact-SQL)](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-exec-requests-transact-sql)
3. [sys.dm_tran_locks (Transact-SQL)](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-tran-locks-transact-sql)

---

### Q26. Walk through how SQL Server detects and resolves a deadlock, and how you'd read the deadlock graph.

**Difficulty:** 🔥 Architect

**1. Interview Answer**
SQL Server runs a background **deadlock monitor** (lock monitor thread) that periodically — by default checking roughly every 5 seconds, ramping up to check more frequently when deadlocks are actively being found — walks the wait-for graph formed by blocked sessions to detect cycles: session A waiting on a resource held by B, while B waits on a resource held by A. When a cycle is found, SQL Server picks a **victim** (by default, the transaction that's cheapest to roll back, measured by log bytes written, unless `SET DEADLOCK_PRIORITY` says otherwise) and kills it with error 1205, rolling back its transaction automatically so the other participant(s) can proceed. The classic root cause is two transactions touching the same two resources in *opposite order*.

**2. SQL Query**
```sql
-- Session A
BEGIN TRANSACTION;
UPDATE dbo.Accounts SET Balance = Balance - 100 WHERE AccountID = 101;  -- locks 101
-- (pause)
UPDATE dbo.Accounts SET Balance = Balance + 100 WHERE AccountID = 202;  -- now wants 202

-- Session B (started around the same time)
BEGIN TRANSACTION;
UPDATE dbo.Accounts SET Balance = Balance - 50 WHERE AccountID = 202;   -- locks 202
-- (pause)
UPDATE dbo.Accounts SET Balance = Balance + 50 WHERE AccountID = 101;   -- now wants 101 → DEADLOCK

-- Capture deadlock graphs going forward:
DBCC TRACEON (1222, -1);  -- legacy; prefer the system_health XE session in modern versions
-- Query the always-on system_health session for deadlock graphs:
SELECT
    xed.query('.') AS DeadlockGraph
FROM sys.dm_xe_session_targets st
JOIN sys.dm_xe_sessions s ON s.address = st.event_session_address
CROSS APPLY (SELECT CAST(st.target_data AS XML) AS TargetData) td
CROSS APPLY td.TargetData.nodes('RingBufferTarget/event[@name="xml_deadlock_report"]') AS Deadlocks(xed)
WHERE s.name = 'system_health';
```

**3. Explain the Query**
Session A locks `101` then wants `202`; Session B locks `202` then wants `101` — a textbook opposite-order cycle. SQL Server's deadlock monitor detects the cycle (A→waits-for→B→waits-for→A) and terminates one of them, returning error 1205 to that session's client with its transaction fully rolled back. The `system_health` Extended Events session captures `xml_deadlock_report` events by default on every modern SQL Server instance (no extra configuration needed), so the second query mines that always-on ring buffer for the actual deadlock graph XML — showing both participating processes, the exact resources and lock modes each held/wanted, and which one was chosen as the victim.

**4. Sample Data**
Same `Accounts` rows as Q20/Q23 (`AccountID 101` and `202`).

**5. Expected Output**
One session succeeds and commits; the other receives: `Transaction (Process ID 62) was deadlocked on lock resources with another process and has been chosen as the deadlock victim. Rerun the transaction.` (Error 1205). The deadlock graph XML shows both `process` nodes (with their `inputbuf`, isolation level, and `lockMode`) and the `victim-list` identifying which one was killed.

**6. Alternative Solutions**
- **Reactive**: catch error 1205 in application code and automatically retry the whole transaction from the start — necessary as a safety net regardless of other fixes, since deadlocks can never be fully eliminated, only made rare.
- **Preventive — consistent resource ordering**: always touch resources (rows/tables) in the same order across all code paths (e.g., always update the lower `AccountID` first) — this specific fix eliminates *this* deadlock pattern entirely, since a cycle requires opposite ordering.
- **Preventive — `UPDLOCK` up front** (Q23): converts a lock-conversion deadlock into a simple, non-deadlocking block/wait.
- **Preferred**: consistent ordering as the primary fix (removes the root cause) plus mandatory retry-on-1205 logic as defense in depth (because ordering discipline across a large codebase and many developers is never 100% guaranteed).

**7. Performance**
Deadlock detection itself is cheap (a background thread, not per-transaction overhead) — the real cost is the wasted work of the rolled-back victim transaction and the latency the client experiences retrying it. Under sustained high deadlock rates, this is a measurable throughput tax and should be tracked via the `Deadlocks/sec` performance counter, not just treated as an occasional annoyance.

**8. Edge Cases**
- More than two transactions can form a longer deadlock cycle (A waits for B, B waits for C, C waits for A) — the graph and remediation reasoning is the same, just with more nodes.
- `SET DEADLOCK_PRIORITY` can force a specific transaction to always/never be chosen as victim — useful for protecting a critical low-frequency transaction at the expense of a high-frequency one, but must be used deliberately and documented, not sprinkled in reactively.
- A deadlock can involve non-data resources too (e.g., worker threads, memory), though the row/key deadlock shown here is by far the most common interview and production scenario.

**9. Production Scenario**
Two different code paths that both update `Accounts` and `LedgerEntries` — one for a customer-initiated transfer, another for a scheduled fee-sweep batch job — updating them in different orders is a realistic, easy-to-introduce deadlock source across a codebase with multiple contributors, exactly the kind of cross-team consistency an Architect is responsible for enforcing (e.g., via a documented data-access convention or a shared repository method that always orders by primary key).

**10. Interview Follow-ups**
1. Why does SQL Server pick the "cheapest to roll back" transaction as the default victim?
2. How is a deadlock different from ordinary blocking that just happens to be slow?
3. What would you look at in the deadlock graph specifically to determine root cause, not just confirm a deadlock happened?
4. How do you make deadlock capture happen automatically in production without manually running trace flags?
5. If retries-on-1205 are in place, is fixing the resource-ordering issue still worth the engineering time?

**11. Follow-up Answers**
1. Rolling back the transaction with less work invested (fewer log records written) is cheaper for the system overall than rolling back a transaction that's done significantly more work — it's a pragmatic default to minimize wasted total effort, not a fairness guarantee (and it's why `DEADLOCK_PRIORITY` exists, for cases where "cheapest" isn't the same as "least important").
2. Ordinary blocking always resolves once the blocking transaction commits or rolls back on its own — there's no cycle, just a queue. A deadlock is a genuine cycle with no possible resolution without external intervention (one participant must be killed), which is exactly why SQL Server has a dedicated background monitor for it rather than just relying on lock timeouts.
3. The `process` nodes' `inputbuf` (the actual statement text each session was running), the `isolationlevel`, and — critically — the *order* in which each process's owned resources and requested resources appear, which reveals which resource was acquired first by which side and confirms the opposite-ordering root cause.
4. The `system_health` Extended Events session captures `xml_deadlock_report` automatically on every instance since SQL Server 2008, with no setup — querying it (as shown above) is sufficient for most cases; a dedicated custom XE session is only needed for longer retention or additional context beyond what `system_health`'s ring buffer keeps.
5. Yes — retries add latency, wasted CPU/log work, and (at high deadlock rates) a throughput ceiling; they're a safety net for the deadlocks you haven't found or can't fully prevent (e.g., across service boundaries), not a substitute for removing a known, fixable ordering bug once identified.

**12. Common Mistakes**
- Describing deadlock resolution as "SQL Server picks randomly" — it's a deterministic cost-based choice (modifiable via `DEADLOCK_PRIORITY`), not random.
- Not knowing the `system_health` session captures deadlock graphs automatically, and reaching for legacy trace flags (1204/1222) as if they were still necessary first steps.
- Treating "catch 1205 and retry" as sufficient on its own without also fixing the underlying access-order inconsistency.

**13. Architect Insight**
A Senior candidate can explain what a deadlock is and demonstrate one. A Principal/Architect treats the resource-access ordering convention as an **enforced architectural rule across the codebase** (documented, reviewed, ideally centralized behind a shared data-access method rather than left to individual developers' discipline), understands the deadlock-victim cost model well enough to use `DEADLOCK_PRIORITY` deliberately for asymmetric-importance transactions, and never presents "just retry on 1205" as a complete answer — because it treats a preventable design flaw as an acceptable steady-state cost.

**References**
1. [Deadlocks Guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-deadlocks-guide)
2. [Transaction Locking and Row Versioning Guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide)

---

### Q27. Compare optimistic and pessimistic concurrency control in SQL Server — how do you actually implement each?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Pessimistic concurrency assumes conflicts are likely and prevents them up front by taking locks (`UPDLOCK`, `XLOCK`, or simply relying on default locking isolation levels) that block other transactions from touching the same data until the first finishes. Optimistic concurrency assumes conflicts are rare, lets transactions proceed without locking, and instead **detects** a conflict at write time — typically via a `rowversion`/`timestamp` column (or an explicit version/`ETag` number) checked in the `UPDATE`'s `WHERE` clause — and rejects the write if the row changed since it was read, leaving the caller to re-read and retry.

**2. SQL Query**
```sql
-- Pessimistic: lock the row for the duration of the read-then-write
BEGIN TRANSACTION;
SELECT Balance FROM dbo.Accounts WITH (UPDLOCK, ROWLOCK) WHERE AccountID = 101;
UPDATE dbo.Accounts SET Balance = Balance - 100 WHERE AccountID = 101;
COMMIT TRANSACTION;

-- Optimistic: version-stamped table, no locking held between read and write
ALTER TABLE dbo.Accounts ADD RowVer ROWVERSION;

DECLARE @OriginalRowVer BINARY(8) = (SELECT RowVer FROM dbo.Accounts WHERE AccountID = 101);
-- ... application computes the new balance client-side, possibly after some delay ...
UPDATE dbo.Accounts
SET Balance = Balance - 100
WHERE AccountID = 101 AND RowVer = @OriginalRowVer;

IF @@ROWCOUNT = 0
    THROW 51000, 'Concurrency conflict: row was modified by another transaction. Re-read and retry.', 1;
```

**3. Explain the Query**
The pessimistic version holds a row lock from the moment it's read until the transaction commits — any other transaction wanting to touch that row simply waits. The optimistic version never holds a lock across the read-then-write gap at all; instead, the `UPDATE`'s `WHERE` clause includes the exact `RowVer` value seen at read time. SQL Server automatically changes `RowVer` on every modification to that row, so if anyone else updated the row in between, the `WHERE` clause no longer matches, `@@ROWCOUNT` comes back `0`, and the application knows to re-fetch and retry rather than silently overwriting someone else's change.

**4. Sample Data**
`Accounts.AccountID=101, Balance=1000.00, RowVer=0x0000000000000A1B`.

**5. Expected Output**
Optimistic path succeeds (`@@ROWCOUNT=1`) if no one else touched the row; fails (`@@ROWCOUNT=0`, exception thrown) if another transaction modified it between the read and this `UPDATE`.

**6. Alternative Solutions**
- **Pessimistic (`UPDLOCK`)**: simplest to reason about, guarantees success on first attempt (no retry logic needed), but holds a lock — including across any application-tier delay between read and write — which doesn't scale well if that gap is long (e.g., waiting on user input in a multi-step UI form).
- **Optimistic (`rowversion`)**: scales far better for long read-then-write gaps (nothing is locked while the user thinks), but requires the application to implement retry/conflict-handling logic, and under *very* high contention on the same row, wastes work on repeated failed attempts.
- **Preferred**: pessimistic for short, server-side read-modify-write sequences (a single stored procedure, sub-second gap); optimistic for anything spanning a user interaction or an external system call between read and write — which is most multi-tier application "edit and save" workflows.

**7. Performance**
Pessimistic locking's cost is blocking duration — directly proportional to how long the lock is held. Optimistic concurrency's cost is retry rate under contention — measure actual conflict/retry frequency (e.g., count of caught `@@ROWCOUNT=0` events) in production; if it's high on a specific row (a "hot row"), optimistic concurrency is actively hurting throughput via wasted round-trips and pessimistic locking (or a redesign to reduce contention on that row, such as splitting a counter) is likely the better fit.

**8. Edge Cases**
- Optimistic concurrency conflicts must be surfaced to a human or a well-defined retry policy — silently retrying a financial `UPDATE` without re-validating business rules against fresh data can itself introduce a bug (e.g., re-applying a discount that's no longer valid).
- A `rowversion` column changes on *any* update to the row, even one to an unrelated column — this can cause false-positive conflicts if two updates to genuinely independent columns on the same row race each other; column-level or table-splitting redesign may be warranted for wide, highly-contended rows.
- Pessimistic locking held across a network round-trip to an external system inside the same transaction is the specific anti-pattern flagged in Q25/Q29 — never do this regardless of which concurrency model you've chosen.

**9. Production Scenario**
A trader-facing order-amendment screen (load an order, let the trader edit fields over several seconds, then save) is the canonical optimistic-concurrency use case — locking the order row pessimistically for the entire time the trader is looking at the screen would be a severe scalability and usability problem; a `rowversion` check on save is the standard pattern.

**10. Interview Follow-ups**
1. What HTTP-layer concept is optimistic concurrency's `rowversion` analogous to, and why does that matter for a web API?
2. Can you combine both approaches in the same system?
3. What happens if two optimistic updates race and both check the same original `RowVer`?
4. How would you decide, for a specific table, which model to use?
5. Is `rowversion` the only way to implement optimistic concurrency in SQL Server?

**11. Follow-up Answers**
1. The HTTP `ETag` / `If-Match` conditional-request pattern is the direct analog — a REST API typically exposes the `rowversion` (base64/hex-encoded) as an `ETag`, and a `PUT`/`PATCH` request includes it in `If-Match`; the API layer translates a 0-row-affected `UPDATE` into an HTTP `412 Precondition Failed`, giving the client the same "someone else changed this, re-fetch" signal end-to-end.
2. Yes, routinely — e.g., pessimistic `UPDLOCK` for the short server-side critical section that finalizes a balance change, combined with optimistic `rowversion` checks for the longer-lived, user-facing edit workflow that precedes it; they solve different segments of the same overall operation.
3. Exactly one of them wins (the first `UPDATE` to actually execute changes the `RowVer`); the second one's `WHERE RowVer = @OriginalRowVer` no longer matches anything, so it affects 0 rows and must retry — SQL Server's row-level locking during the `UPDATE` statement itself (even though the *application* pattern is "optimistic") guarantees this is resolved correctly and atomically, never as a lost update.
4. Look at the length and nature of the gap between read and write: sub-second, purely server-side → pessimistic is simpler and safe. Spans user think-time, an external API call, or a multi-request workflow → optimistic, because holding a pessimistic lock across that gap would be a scalability and (for external calls) a distributed-transaction-risk problem (see Q29).
5. No — an application-managed integer/GUID version column incremented explicitly in the `UPDATE` statement (`WHERE Version = @V` then `SET Version = Version + 1`) achieves the same effect and is portable across databases (useful if the same data-access pattern must also target PostgreSQL, say); `rowversion` is simply the SQL-Server-native, zero-application-code way to get an always-changing value automatically.

**12. Common Mistakes**
- Implementing "optimistic concurrency" by reading a value, checking it in application code, and then issuing a separate unconditional `UPDATE` — this is not actually safe, since another transaction can modify the row in the gap between the application's check and the `UPDATE`; the version check must be *in the `UPDATE`'s `WHERE` clause itself* to be atomic.
- Never handling the `@@ROWCOUNT=0` / conflict case at all, so concurrent edits silently vanish with no error and no retry.
- Choosing pessimistic locking by default "because it's simpler" for workflows that actually span user interaction time, causing severe lock contention in production.

**13. Architect Insight**
A Senior engineer can implement either pattern correctly in isolation. A Principal/Architect chooses between them **based on the shape of the workflow's read-write gap**, connects optimistic concurrency directly to the HTTP `ETag`/`412` pattern so the database-level design and the API contract are consistent end-to-end, and recognizes that the "same row updated concurrently" conflict rate is itself a metric worth monitoring in production — a rising conflict rate on a specific entity is an early signal of a hot-row scaling problem long before it shows up as a raw performance complaint.

**References**
1. [rowversion (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/data-types/rowversion-transact-sql)
2. [MIN_ACTIVE_ROWVERSION (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/min-active-rowversion-transact-sql)
3. [Transactions and concurrency - ADO.NET Provider for SQL Server](https://learn.microsoft.com/en-us/sql/connect/ado-net/transactions-and-concurrency)

---

### Q28. READ_COMMITTED_SNAPSHOT vs. SNAPSHOT isolation — what's the actual mechanism, and what does it cost?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
Both are built on the same underlying mechanism: **row versioning**. When a row is modified, SQL Server copies the pre-modification version into the **version store**, a structure inside `tempdb`, before applying the change; readers under either mode can be served an older, committed version from that store instead of blocking behind the writer's lock. The difference is scope and opt-in model: **RCSI** is a *database-level* setting (`ALTER DATABASE ... SET READ_COMMITTED_SNAPSHOT ON`) that silently changes what the existing `READ COMMITTED` isolation level means — each *statement* gets a consistent snapshot as of the statement's start, with zero application code changes required. **SNAPSHOT** is an explicit, separate isolation level a *transaction* must opt into (`SET TRANSACTION ISOLATION LEVEL SNAPSHOT`), giving a consistent view for the *entire transaction's duration*, not just one statement — and it requires `ALLOW_SNAPSHOT_ISOLATION ON` at the database level plus explicit code changes to request it.

**2. SQL Query**
```sql
-- Enable both capabilities at the database level (they're independent settings)
ALTER DATABASE TradingLedger SET ALLOW_SNAPSHOT_ISOLATION ON;
ALTER DATABASE TradingLedger SET READ_COMMITTED_SNAPSHOT ON;

-- RCSI in effect automatically — no code change, this is now what READ COMMITTED means:
SELECT Balance FROM dbo.Accounts WHERE AccountID = 101;  -- statement-level consistent read, non-blocking

-- Explicit SNAPSHOT for a whole multi-statement transaction:
SET TRANSACTION ISOLATION LEVEL SNAPSHOT;
BEGIN TRANSACTION;
SELECT Balance FROM dbo.Accounts WHERE AccountID = 101;      -- consistent as of BEGIN TRANSACTION
-- ... other work, possibly seconds later ...
SELECT Balance FROM dbo.Accounts WHERE AccountID = 101;      -- still the SAME value, transaction-consistent
COMMIT TRANSACTION;

-- Monitor version-store pressure:
SELECT SUM(reserved_page_count) * 8 / 1024.0 AS VersionStoreMB
FROM sys.dm_db_file_space_usage
WHERE database_id = DB_ID('tempdb');
```

**3. Explain the Query**
Enabling RCSI changes every existing `READ COMMITTED` statement (the default isolation level, used implicitly by most application code) to read from the version store instead of taking blocking-relevant shared locks — this is why it's the single highest-leverage lever for reducing reader/writer blocking fleet-wide, and why it requires no application changes. The explicit `SNAPSHOT` transaction, in contrast, must be requested in code and holds its consistent view for as long as the transaction is open, which is more powerful (transaction-, not statement-, level consistency) but also means a long-running snapshot transaction pins older versions in tempdb for longer. The monitoring query checks how much of tempdb is currently consumed by the version store, which grows with transaction duration and write volume.

**4. Sample Data**
`TradingLedger` database with steady write traffic to `Accounts`/`Transactions` and mixed read/write workload.

**5. Expected Output**
Under RCSI, concurrent readers no longer block behind writers (verified via `sys.dm_tran_locks` showing no `S`-lock waits on rows being written); `sys.dm_db_file_space_usage` shows a non-zero, workload-proportional version-store size in tempdb.

**6. Alternative Solutions**
- **RCSI only** (most common production choice): fixes the vast majority of reader/writer blocking with zero code changes, since almost all code runs under default `READ COMMITTED`; doesn't help with the specific multi-statement-consistency problem `SNAPSHOT` solves.
- **SNAPSHOT only** (opt-in per transaction): used surgically for the specific transactions/reports that need transaction-level (not just statement-level) consistency — reconciliation jobs, multi-step calculations — without changing the isolation semantics for the rest of the application.
- **Both together** (shown above): the standard production configuration — RCSI as the new baseline default, `SNAPSHOT` opted into explicitly for the specific code paths that need it.

**7. Performance**
The core trade-off: **blocking cost moves to tempdb cost**. Every row modification now does extra work versioning the old row into tempdb, tempdb I/O and space usage rise, and long-running snapshot transactions can bloat the version store (since old versions can't be cleaned up while any transaction might still need them) — monitor `tempdb` version-store size and the `Version Store Size (KB)` / `Version Generation rate` / `Version Cleanup rate` performance counters under real load before rolling this out fleet-wide, not just functional correctness in a dev environment.

**8. Edge Cases**
- A single long-running `SNAPSHOT` (or even RCSI, to a lesser extent) transaction can prevent version-store cleanup for the *entire database*, causing tempdb to grow unexpectedly — a known production incident pattern ("tempdb filled up because of one forgotten open transaction").
- `SNAPSHOT` transactions can hit update conflicts (error 3960, Q21) that RCSI's statement-level scope never encounters, since RCSI doesn't hold a consistent view across multiple statements to begin with.
- Enabling RCSI changes behavior for *every* piece of code using default isolation — including any code that was unknowingly relying on `READ COMMITTED`'s blocking behavior as an implicit synchronization mechanism (rare, but real, and worth an audit before flipping the switch on a large legacy system).

**9. Production Scenario**
A high-throughput trade-processing database enabling RCSI as a global setting to eliminate reporting-query-vs-trade-write blocking, while a small number of specific end-of-day reconciliation stored procedures explicitly opt into `SNAPSHOT` for their multi-step consistency needs — this exact combination is a common, well-understood configuration at trading and payments firms.

**10. Interview Follow-ups**
1. If RCSI is on, do you still need explicit `SNAPSHOT` anywhere?
2. What's the actual overhead added to a plain `UPDATE` once RCSI is enabled?
3. How do you clean up bloated tempdb version store caused by a long-running transaction?
4. Does RCSI eliminate write-write conflicts?
5. What's your rollout plan for turning RCSI on for an existing, large production database?

**11. Follow-up Answers**
1. Yes, for any transaction that needs a consistent view across *multiple* statements/round-trips — RCSI only guarantees consistency per individual statement, so a multi-step read-then-read-then-decide sequence can still see different committed states across its steps under RCSI alone.
2. Every `UPDATE`/`DELETE`/`INSERT`-with-update-triggering behavior on a versioned row must first copy the previous version into the tempdb version store and stamp the row with a version-store pointer — a small but real per-write CPU and tempdb I/O cost, generally acceptable but non-zero and worth validating with a load test on the specific workload, not assumed away.
3. Identify and terminate (or wait out) the long-running transaction holding back the version-store cleanup — query `sys.dm_tran_active_snapshot_database_transactions` to find the oldest active snapshot transaction, since SQL Server can't discard any version still older than the oldest transaction that might need it.
4. No — RCSI and `SNAPSHOT` both still detect and can be affected by concurrent *writes* to the same row; `SNAPSHOT` specifically surfaces this as an explicit update-conflict error (3960) the application must handle, while RCSI (being READ COMMITTED under the hood for writes) uses ordinary locking for writers, so two concurrent writers to the same row still block/serialize normally under RCSI — only the *read* path changed.
5. Enable `ALLOW_SNAPSHOT_ISOLATION` and test in a staging environment under production-like concurrent load first; monitor tempdb sizing headroom (version store needs real capacity); roll out `READ_COMMITTED_SNAPSHOT` during a low-traffic maintenance window since the `ALTER DATABASE` requires no other active connections at the moment it's applied; then closely monitor the tempdb version-store counters and overall blocking metrics for a full business cycle (including the nightly batch/reporting window) before declaring success.

**12. Common Mistakes**
- Conflating RCSI and `SNAPSHOT` as the same thing, or assuming one "just enables" the other.
- Enabling RCSI/`SNAPSHOT` without first sizing tempdb for the additional version-store load — a routine cause of "tempdb ran out of space" incidents shortly after this change ships.
- Believing snapshot-based isolation removes the need to ever think about write conflicts, rather than just moving dirty/non-repeatable read anomalies into an explicit, handleable error instead.

**13. Architect Insight**
The Senior-level distinction is knowing RCSI and SNAPSHOT are different settings. The Architect-level distinction is treating this as an **infrastructure capacity decision, not just a syntax choice** — sizing tempdb for the added version-store load, defining monitoring for version-store bloat before rollout (not after an incident), and being able to articulate precisely which anomaly each setting removes so the choice is driven by the workload's actual consistency requirement rather than "SNAPSHOT sounds stronger so use that everywhere."

**References**
1. [Transaction Locking and Row Versioning Guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide)
2. [Snapshot Isolation in SQL Server](https://learn.microsoft.com/en-us/dotnet/framework/data/adonet/sql/snapshot-isolation-in-sql-server)
3. [Optimized Locking - SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/performance/optimized-locking)

---

### Q29. Why do transactions hurt performance when they run "too long," and what does "too long" actually mean here?

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
A transaction's cost to the rest of the system isn't its CPU time — it's how long it holds locks (or, under versioning, how long it pins the version store) relative to how much other work wants to touch the same resources. "Too long" means "long enough that other transactions queue up behind it," which is a function of both wall-clock duration and how contended the touched rows/tables are. The single most common real-world cause isn't a slow query at all — it's a transaction left open across a slow *external* call (an HTTP request, a message-queue publish, user think-time in a UI) that has nothing to do with the database's own performance.

**2. SQL Query**
```sql
-- Anti-pattern: transaction spans an external/slow operation
BEGIN TRANSACTION;
UPDATE dbo.Accounts SET Balance = Balance - 500 WHERE AccountID = 101;
-- application code here calls an external payment gateway over HTTP,
-- taking 2-5 seconds, WHILE the row lock on AccountID 101 is still held
UPDATE dbo.Transactions SET Status = 'COMPLETED' WHERE TransactionID = 9001;
COMMIT TRANSACTION;

-- Fix: keep the transaction scoped only to the database work
UPDATE dbo.Accounts SET Balance = Balance - 500 WHERE AccountID = 101;
-- call the external payment gateway OUTSIDE any open transaction
-- then, in a second short transaction, record the outcome:
UPDATE dbo.Transactions SET Status = 'COMPLETED' WHERE TransactionID = 9001;
```

**3. Explain the Query**
The anti-pattern version holds an exclusive row lock on `AccountID 101` for the entire duration of an external HTTP call — potentially seconds, a lifetime in database terms, during which every other transaction wanting to touch that row queues up. The fix separates the fast, purely-transactional database work from the slow external call entirely; this typically requires an idempotency-key/outbox-style pattern (Q37, Q130) to correctly handle the case where the external call succeeds but the process crashes before recording that fact — a genuinely harder design problem than the naive version, but the alternative (locks held across network calls) is not a viable trade-off at any real scale.

**4. Sample Data**
Same `Accounts`/`Transactions` tables as prior questions.

**5. Expected Output**
With the fix, the row lock on `AccountID 101` is held for milliseconds (just the `UPDATE`'s own execution time) rather than seconds, so concurrent transactions touching that account are no longer serialized behind an unrelated external system's latency.

**6. Alternative Solutions**
- **Shorten the transaction scope (shown above)**: the correct fix — addresses root cause.
- **Increase isolation-level leniency (e.g., `NOLOCK` elsewhere in the system) to "work around" the resulting blocking**: rejected — treats a symptom with a correctness-compromising workaround instead of fixing the actual long-held lock.
- **Lower the lock-wait timeout (`SET LOCK_TIMEOUT`) so blocked sessions fail fast instead of queuing indefinitely**: a reasonable *complementary* safety measure (fail fast and retry/alert, rather than an invisible growing queue) but doesn't reduce the underlying blocking — it only changes how the symptom surfaces.

**7. Performance**
Measure actual lock hold time via `sys.dm_tran_locks` combined with `sys.dm_exec_sessions.last_request_start_time`, or, more directly, via an Extended Events session tracking `lock_acquired`/`lock_released` events correlated by `transaction_id` — don't estimate from query text alone, since the same statement's *lock* duration depends entirely on what runs between it and the `COMMIT`, which static SQL analysis can't see.

**8. Edge Cases**
- A transaction that's fast in isolated testing can become "too long" purely due to contention from concurrent load — duration alone isn't the full story; it's duration **times** how many other transactions want the same resource.
- ORMs (including EF Core) can silently keep a transaction open longer than intended if application code performs unrelated work (logging, additional queries, external calls) between opening a transaction scope and disposing/committing it — a frequent, hard-to-spot source of this exact anti-pattern in .NET codebases.
- Retry logic that retries the *entire* long transaction (external call included) on failure can make an already-long transaction worse under load, compounding the problem instead of fixing it.

**9. Production Scenario**
This is the single most common root cause behind "the database is slow" incidents in the author's experience at scale: it's very rarely the database's own query performance, and very often application code holding a transaction open across a network call to another service — exactly the pattern this question and Q25's triage sequence exist to catch quickly.

**10. Interview Follow-ups**
1. How would you enforce "no external calls inside a transaction" as an organizational discipline, not just a one-off code review comment?
2. What's the relationship between this anti-pattern and the Outbox pattern (Q130)?
3. Does RCSI/SNAPSHOT make this problem go away?
4. How would you detect this specific anti-pattern happening right now in production, automatically?
5. Is there ever a legitimate reason to hold a transaction open across a slow operation?

**11. Follow-up Answers**
1. Code review checklists help but don't scale reliably; the more durable fix is architectural — provide a shared, narrowly-scoped data-access abstraction (e.g., a repository method or a `using` pattern that wraps exactly the DB statements and nothing else) that makes the *correct* short-transaction pattern the easy default, and add a static-analysis or code-review-bot rule flagging `await` calls to non-database code between transaction begin/commit.
2. The Outbox pattern is precisely the standard solution to the harder problem this fix creates: once the external call is moved outside the transaction, you need a reliable way to guarantee the external action and the database state change are eventually consistent even if the process crashes between them — the transactional outbox writes the "intent to call externally" as a row in the same short transaction as the data change, then a separate process reliably delivers it.
3. No — RCSI/SNAPSHOT change how *readers* interact with an in-progress writer, but they don't change how long a writer's own locks are held for, and a transaction spanning an external call still holds exclusive locks on the rows it has already modified for that entire duration regardless of isolation level.
4. An Extended Events session capturing long-running open transactions (e.g., `sqlserver.transaction_log` or a custom session watching `sys.dm_tran_session_transactions` joined to `sys.dm_exec_sessions` for `status='sleeping'` sessions with `open_transaction_count > 0`) polled on an interval, alerting when any transaction has been open longer than a threshold (e.g., 1 second) without an active request — directly targets this exact signature.
5. Rarely, and it should be treated as an explicit, reviewed exception rather than a default — e.g., a `SERIALIZABLE` transaction that must genuinely hold a range lock across a short (sub-100ms) validation step with no network call involved; the moment a network round-trip to a system outside your control is involved, there is essentially no legitimate justification for holding a database transaction open across it.

**12. Common Mistakes**
- Assuming transaction "performance" is about the transaction's own SQL execution time rather than its lock-hold duration and the concurrency cost that imposes on everyone else.
- Wrapping an entire application-layer "process a payment" method in one database transaction scope by default (a common ORM/framework convenience trap) without auditing what actually happens between open and commit.
- Fixing the resulting blocking symptom with looser isolation (`NOLOCK`) instead of shortening the transaction that's actually the root cause.

**13. Architect Insight**
Any experienced engineer knows "keep transactions short." The Architect-level answer explains *why* the naive fix (just moving the external call out) creates a new, harder consistency problem — and can design the Outbox-based solution to that harder problem rather than stopping at "don't do that." This is the connective tissue between this question, distributed transactions (Q129), and the Outbox pattern (Q130) that a Staff-level answer often misses by treating each as an isolated topic.

**References**
1. [Transaction Locking and Row Versioning Guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide)
2. [Understand and Resolve SQL Server Blocking Problems](https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/performance/understand-resolve-blocking)
3. [Transactions and concurrency - ADO.NET Provider for SQL Server](https://learn.microsoft.com/en-us/sql/connect/ado-net/transactions-and-concurrency)

---

## SQL INTERVIEW CHALLENGE — how this section works in this file

For live interview-mode practice on transactions/isolation/locking topics, use [[15-Interview-Challenge-Mode]], which holds the full unanswered practice bank spanning every file in this workbook and the exact scoring rubric (Correctness/10, Query Quality/10, Performance/10, Edge Cases/10, Senior-level Reasoning/10) requested for interactive mode.
