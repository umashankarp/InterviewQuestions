# SQL Query Interview Questions — Top 30 (Principal Engineer Level)

> **Method:** solutions are written in **T-SQL (SQL Server)** — the primary dialect used elsewhere in this
> program — with `PostgreSQL` divergences called out inline where they actually matter (they rarely do:
> `RANK`/`DENSE_RANK`/`ROW_NUMBER`/`LAG`/`LEAD` are ANSI SQL:2003 window functions and behave identically on
> both engines; the differences are almost always in date functions and `TOP n` vs `LIMIT n`). Every answer
> gives the query, the mechanism (*why* it produces the right rows, not just that it does), the mistake a
> mid-level candidate makes, the indexing/performance angle a Principal is expected to volunteer unprompted,
> and the follow-up question an interviewer asks next. Fintech framing (payments, ledgers, fraud/velocity
> checks) is used where a problem is naturally payments-shaped; generic HR/commerce schemas are kept where
> the fintech wrapper would be forced.
>
> **Standalone reference, not part of the 01–21 numbered sequence** in this folder (see this folder's
> `CLAUDE.md`) — these are hands-on coding problems with worked query solutions, a different shape of content
> from the 19 architect-concept Q&A files, so it is not numbered into that chain or added to its topic map.

## Question map

| # | Question | Key SQL Concept | Difficulty |
|---|---|---|---|
| 1 | Find the 2nd highest salary | `DENSE_RANK`, subquery | 🟢 |
| 2 | Find the Nth highest salary | Window functions | 🟡 |
| 3 | Top 3 salaries in each department | `DENSE_RANK` + `PARTITION BY` | 🔴 |
| 4 | Highest-paid employee in each department | Window function | 🟡 |
| 5 | Employees earning more than their manager | Self join | 🔴 |
| 6 | Find duplicate records | `GROUP BY` + `HAVING` | 🟢 |
| 7 | Delete duplicates, keep the latest | `ROW_NUMBER()` | 🔴 |
| 8 | Customers who never placed an order | `LEFT JOIN` / `NOT EXISTS` | 🟡 |
| 9 | Customers with more than 3 orders | `GROUP BY` + `HAVING` | 🟢 |
| 10 | Latest transaction per customer | `ROW_NUMBER()` | 🔴 |
| 11 | First transaction per customer | `ROW_NUMBER()` | 🟡 |
| 12 | Second transaction per customer | `ROW_NUMBER()` | 🔴 |
| 13 | Employees who joined in the last 6 months | Date functions | 🟢 |
| 14 | Highest salary by department | `GROUP BY` | 🟢 |
| 15 | Departments with more than 5 employees | `GROUP BY` + `HAVING` | 🟢 |
| 16 | Running total of sales | `SUM() OVER()` | 🔴 |
| 17 | Month-over-month sales growth | `LAG()` | 🔴 |
| 18 | Products selling above the previous month | `LAG()` | 🔴 |
| 19 | Consecutive login days per user | Gaps & islands | 💀 |
| 20 | Longest consecutive login streak | Gaps & islands | 💀 |
| 21 | Missing dates in a transaction table | Calendar / CTE | 🔴 |
| 22 | Gaps in an ID/sequence | `LEAD()` / CTE | 🔴 |
| 23 | Customers who bought every product in a category | Relational division | 💀 |
| 24 | Bought Product A but not Product B | `EXISTS` / `NOT EXISTS` | 🔴 |
| 25 | Employees earning above department average | CTE / window function | 🔴 |
| 26 | Each department's % of total salary spend | Window aggregate | 🔴 |
| 27 | Duplicate financial transactions (multi-column) | Grouping / window | 🔴 |
| 28 | Transactions within 10 minutes of another | `LAG()` + dates | 💀 |
| 29 | Overlapping date ranges | Interval logic | 💀 |
| 30 | Event A followed by Event B within a time window | Sessionization / `APPLY` | 💀 |

---

## Reference schemas

Every solution below is written against one of these four schemas so the SQL is copy-runnable and the
join keys stay consistent across questions.

```sql
-- HR / payroll
CREATE TABLE Employees (
    EmpId     INT PRIMARY KEY,
    Name      VARCHAR(100),
    DeptId    INT,
    ManagerId INT NULL,              -- self-referencing FK -> Employees.EmpId
    Salary    DECIMAL(12,2),
    HireDate  DATE
);
CREATE TABLE Departments (DeptId INT PRIMARY KEY, DeptName VARCHAR(100));

-- Commerce
CREATE TABLE Customers (CustomerId INT PRIMARY KEY, Name VARCHAR(100));
CREATE TABLE Orders   (OrderId INT PRIMARY KEY, CustomerId INT, OrderDate DATE, Amount DECIMAL(12,2));
CREATE TABLE Purchases(CustomerId INT, ProductId VARCHAR(20), Category VARCHAR(50));
CREATE TABLE Products (ProductId VARCHAR(20) PRIMARY KEY, Category VARCHAR(50));

-- Payments / ledger
CREATE TABLE Transactions (
    TxnId       BIGINT PRIMARY KEY,
    AccountId   INT,
    Amount      DECIMAL(18,2),
    TxnDateTime DATETIME2,
    MerchantId  INT,
    Category    VARCHAR(50)
);
CREATE TABLE MonthlySales (ProductId INT, SaleMonth DATE, Revenue DECIMAL(18,2));

-- Behavioral / events
CREATE TABLE Logins (UserId INT, LoginDate DATE);
CREATE TABLE Events (UserId INT, EventType VARCHAR(50), EventTime DATETIME2);
```

---

## Q1. Find the 2nd highest salary 🟢

**Concept:** `DENSE_RANK`, subquery.

```sql
-- A: no window functions needed
SELECT MAX(Salary) AS SecondHighest
FROM Employees
WHERE Salary < (SELECT MAX(Salary) FROM Employees);

-- B: window function, generalizes to Q2
SELECT DISTINCT Salary
FROM (
    SELECT Salary, DENSE_RANK() OVER (ORDER BY Salary DESC) AS rnk
    FROM Employees
) ranked
WHERE rnk = 2;
```

**Mechanism:** (A) shrinks the candidate set to everything below the max, then re-maxes it — one pass,
no window function, correct even with duplicate top salaries. (B) `DENSE_RANK` assigns rank `1` to every
row tied for the max, then `2` to the *next distinct* value — which is exactly "2nd highest" under the
common interview definition (a distinct value, not a row position).

**Common mistakes:**
- Using `ROW_NUMBER()` instead of `DENSE_RANK()` — if two employees tie for #1, `ROW_NUMBER` hands the
  "2nd highest" title to one of the two people who are actually tied for 1st.
- `SELECT Salary FROM Employees ORDER BY Salary DESC OFFSET 1 ROWS FETCH NEXT 1 ROWS ONLY` without a
  `DISTINCT` first — same tie bug, and it silently returns a *row*, not a *rank*.
- Not deciding what happens when there is no 2nd-highest value (only one distinct salary exists): (A)
  returns `NULL`; (B) returns an empty result set. These are different contracts — state which one the
  caller needs before writing the query.

**Principal-level considerations:** a nonclustered index on `Salary DESC` turns (A) into two index-seek
operations instead of a scan; on a payroll table with tens of millions of rows that's the difference
between a sub-millisecond lookup and a full scan. Ask the interviewer whether "2nd highest" means 2nd
distinct value or 2nd row before writing either query — it's the single most common ambiguity in this
question and volunteering the clarification is itself a signal.

**Follow-up:** "generalize this to the Nth highest" → Q2.

---

## Q2. Find the Nth highest salary 🟡

**Concept:** window functions.

```sql
DECLARE @N INT = 3;

SELECT DISTINCT Salary
FROM (
    SELECT Salary, DENSE_RANK() OVER (ORDER BY Salary DESC) AS rnk
    FROM Employees
) ranked
WHERE rnk = @N;
```

**Mechanism:** identical to Q1(B) with `N` as a parameter — this is why the window-function form, not the
`MAX`-of-a-shrinking-set form, is the one worth memorizing: it's the only one that generalizes.

**Common mistakes:** reaching for `OFFSET N-1 ROWS FETCH NEXT 1 ROW` on the raw (non-deduplicated) table —
correct only when salaries happen to be unique, which is not a safe assumption in a payroll table (a pay
band produces exact ties routinely).

**Principal-level considerations:** for small, fixed `N` (say, top-5 leaderboards refreshed per request),
`TOP (@N)` with an index on the sort column lets the optimizer stop after `N` rows instead of ranking the
whole table — materially cheaper than `DENSE_RANK` over the full set when the table is large and `N` is
small. `DENSE_RANK` still wins when the table is already being scanned for other reasons (compute the rank
once, reuse it) or when you need every rank simultaneously (e.g., a compensation-band report).

**Follow-up:** "what if two people are tied for Nth?" → both rows come back, correctly, because the filter
is on the *rank value*, not a row count — worth stating explicitly, since it's the whole reason `DENSE_RANK`
was chosen.

---

## Q3. Top 3 salaries in each department 🔴

**Concept:** `DENSE_RANK` + `PARTITION BY`.

```sql
SELECT EmpId, Name, DeptId, Salary
FROM (
    SELECT *, DENSE_RANK() OVER (PARTITION BY DeptId ORDER BY Salary DESC) AS rnk
    FROM Employees
) ranked
WHERE rnk <= 3;
```

**Mechanism:** `PARTITION BY DeptId` resets the ranking counter at every department boundary — the engine
conceptually sorts by `(DeptId, Salary DESC)`, then numbers within each partition independently.

**Common mistakes:** using `RANK()` and being surprised that a department with a 3-way tie for 1st returns
zero rows at rank 2 or 3 (`RANK` leaves gaps: `1,1,1,4`); using `ROW_NUMBER()` and silently dropping tied
earners past the cutoff. State which semantic the business wants — "top 3 *people*" (`ROW_NUMBER`, always
exactly 3 per department) vs "top 3 *pay levels*" (`DENSE_RANK`, can return more than 3 rows) — before
picking the function; this distinction is the actual test in this question, not the syntax.

**Principal-level considerations:** a composite index `(DeptId, Salary DESC) INCLUDE (Name, EmpId)` lets
SQL Server stream each partition pre-sorted and avoid a sort operator entirely — check the plan for a
`Window Spool` with no preceding `Sort`; if a `Sort` appears, the index isn't covering the partition/order
combination. At scale (thousands of departments), this is the difference between an `O(n log n)` global
sort and an index-ordered scan.

**Follow-up:** "now do it without an index on `(DeptId, Salary)`" → the optimizer falls back to sorting the
whole table by `(DeptId, Salary DESC)` before windowing; call out the cost explicitly rather than treating
the query as free.

---

## Q4. Highest-paid employee in each department 🟡

**Concept:** window function.

```sql
SELECT EmpId, Name, DeptId, Salary
FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY DeptId ORDER BY Salary DESC, EmpId) AS rn
    FROM Employees
) ranked
WHERE rn = 1;
```

**Mechanism:** `ROW_NUMBER`, not `DENSE_RANK`, because the requirement is "one employee," a row-count
guarantee — a tie must be broken deterministically, hence the secondary `ORDER BY ... EmpId` tiebreaker.

**Common mistakes:** `SELECT DeptId, MAX(Salary) FROM Employees GROUP BY DeptId` and then trying to also
select `Name` in the same `SELECT` list — that's a `GROUP BY` error (or, on engines that permit it,
non-deterministic — an arbitrary name from the group), because `Name` isn't functionally dependent on the
grouped columns. Getting both the max value and the full row it belongs to is exactly the case window
functions exist for.

**Principal-level considerations:** without a tiebreaker, "the highest-paid employee" is a nondeterministic
query — rerunning it can return a different employee for a tied department. In a production reporting
context (e.g., a compensation-review extract) that nondeterminism is a correctness bug even though the SQL
"runs fine," and it's the kind of thing that only shows up as an intermittent discrepancy days later.

**Follow-up:** "what if you need the top earner per department *and* the department's average, side by
side?" → combine with a second window aggregate: `AVG(Salary) OVER (PARTITION BY DeptId)` in the same
subquery, no extra join needed (ties into Q25/Q26's technique).

---

## Q5. Employees earning more than their manager 🔴

**Concept:** self join.

```sql
SELECT e.Name AS Employee, e.Salary AS EmpSalary,
       m.Name AS Manager,  m.Salary AS MgrSalary
FROM Employees e
JOIN Employees m ON e.ManagerId = m.EmpId
WHERE e.Salary > m.Salary;
```

**Mechanism:** the table is joined to itself through the `ManagerId → EmpId` self-reference, producing an
(employee, their manager) row pair per join, then filtered on the salary comparison.

**Common mistakes:** using `LEFT JOIN` here — an `INNER JOIN` is actually correct and intentional: rows
with `ManagerId IS NULL` (the CEO, or anyone with no manager) have nothing to compare against and should be
excluded, not returned with a `NULL` manager salary that then fails the `>` comparison anyway. Choosing
`INNER JOIN` deliberately and being able to say why is the actual signal here.

**Principal-level considerations:** this only compares an employee to their *direct* manager. "Does anyone
earn more than *anyone above them in the chain*" is a different, harder problem requiring a recursive CTE
to walk the hierarchy — don't let the interviewer's phrasing quietly expand scope without naming that
you're solving the one-level version. Index `ManagerId` (it's a self-FK, and SQL Server does not
auto-index FK columns) — without it, this self join is a hash or nested-loop scan over the full table
twice.

**Follow-up:** "extend to the full chain of command" → recursive CTE from each employee up through
`ManagerId` accumulating the max salary seen, or a `HierarchyId`/closure-table model if this query pattern
is common in production (self-joins on deep hierarchies degrade badly; a closure table trades write
complexity for O(1) ancestor lookups).

---

## Q6. Find duplicate records 🟢

**Concept:** `GROUP BY` + `HAVING`.

```sql
SELECT Email, COUNT(*) AS Occurrences
FROM Customers
GROUP BY Email
HAVING COUNT(*) > 1;
```

**Mechanism:** grouping collapses rows sharing the key into one bucket per distinct value; `HAVING`
filters *after* aggregation (unlike `WHERE`, which can't see `COUNT(*)`).

**Common mistakes:** treating "duplicate" as self-evident. A full-row duplicate (`GROUP BY` every column)
and a business-key duplicate (`GROUP BY Email` while `CustomerId` differs) are different bugs with
different fixes — the first is usually an ingestion replay, the second is usually a missing unique
constraint. Ask which one before writing the query.

**Principal-level considerations:** this query *finds* duplicates; it doesn't explain how they got there.
In production the useful next question is upstream — is there a unique constraint missing, is an
at-least-once message consumer re-inserting on redelivery, is a retried API call not idempotent? Treat this
as a detection query that should be followed by a root-cause fix (often a unique index or an idempotency
key — see Q27), not a query you schedule to run forever as the fix itself.

**Follow-up:** "now remove them, keeping one" → Q7.

---

## Q7. Delete duplicates while keeping the latest record 🔴

**Concept:** `ROW_NUMBER()`.

```sql
WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY Email ORDER BY CreatedAt DESC, CustomerId DESC) AS rn
    FROM Customers
)
DELETE FROM ranked
WHERE rn > 1;
```

**Mechanism:** number each duplicate group newest-first; everything except `rn = 1` is a strictly older
copy and safe to remove. Deleting directly through the CTE works because the CTE is not materialized — it's
inlined into the delete plan against the base table.

**Common mistakes:** forgetting a deterministic tiebreaker when `CreatedAt` can tie (two rows inserted in
the same batch with identical timestamps) — without `CustomerId DESC` as a second key, which row survives
is arbitrary and the delete becomes nondeterministic across runs. Running this without first running the
`SELECT` form of the same CTE to eyeball the row count that will be deleted.

**Principal-level considerations:** on a large production table, a single unbounded `DELETE` holds locks
for the whole duration and can blow up the transaction log — batch it (`DELETE TOP (10000) FROM ranked
WHERE rn > 1`, looping until `@@ROWCOUNT = 0`, each batch its own transaction) to bound lock duration and
log growth. Always run inside an explicit transaction with the row count verified against the earlier
`SELECT COUNT(*)` from Q6 before committing, and consider archiving the deleted rows to a holding table
first — deletes based on a heuristic "keep the latest" rule are not reversible once committed, and in a
regulated data set (financial records) you may be required to retain them anyway rather than hard-delete.

**Follow-up:** "how would you have prevented this instead of cleaning it up after the fact?" → a unique
constraint/index on the business key, enforced at write time, turns this whole class of bug into an
`INSERT` failure the application must handle, instead of a silent duplicate discovered later.

---

## Q8. Customers who never placed an order 🟡

**Concept:** `LEFT JOIN` / `NOT EXISTS`.

```sql
-- A
SELECT c.CustomerId, c.Name
FROM Customers c
LEFT JOIN Orders o ON o.CustomerId = c.CustomerId
WHERE o.OrderId IS NULL;

-- B (preferred)
SELECT c.CustomerId, c.Name
FROM Customers c
WHERE NOT EXISTS (SELECT 1 FROM Orders o WHERE o.CustomerId = c.CustomerId);
```

**Mechanism:** (A) produces a `NULL`-padded row for every customer with zero matching orders, then filters
to just those; (B) asks the question directly — "does no order exist for this customer" — without ever
materializing the join.

**Common mistakes:** `WHERE CustomerId NOT IN (SELECT CustomerId FROM Orders)` — the classic trap. If even
one row in `Orders.CustomerId` is `NULL`, `NOT IN` against a list containing `NULL` returns **zero rows for
the entire query**, because `x <> NULL` evaluates to `UNKNOWN`, not `TRUE`, for every comparison. This is a
correctness bug that passes code review and passes testing on clean sample data, then silently returns
nothing in production the first time a bad row appears — it's one of the highest-value "gotcha" facts to
know cold at this level.

**Principal-level considerations:** `NOT EXISTS` doesn't have the `NULL` trap and is also usually the
better execution plan — the optimizer can implement it as an anti-semi-join and stop at the first match per
customer, whereas the `LEFT JOIN` form must produce and then filter every row. Prefer `NOT EXISTS` by
default; reach for `LEFT JOIN ... IS NULL` only when you already need the joined columns for something else
in the same query.

**Follow-up:** "why is `NOT IN` dangerous but `IN` is fine?" → `IN` against a list containing `NULL` just
never matches the `NULL` entry (harmless, no false negative for the rows that do match); `NOT IN` needs
*every* comparison to be `TRUE`, and a single `UNKNOWN` in the list poisons the whole predicate.

---

## Q9. Customers who placed more than 3 orders 🟢

**Concept:** `GROUP BY` + `HAVING`.

```sql
SELECT CustomerId, COUNT(*) AS OrderCount
FROM Orders
GROUP BY CustomerId
HAVING COUNT(*) > 3;
```

**Common mistakes:** filtering with `WHERE COUNT(*) > 3` (illegal — `WHERE` runs before aggregation) or
computing the count in a subquery per customer (`O(n²)`-shaped instead of one grouped scan).

**Principal-level considerations:** if "orders" should exclude cancelled/refunded ones, that belongs in the
`WHERE` clause *before* the `GROUP BY`, not as a `HAVING COUNT(*) > 3 AND Status = 'Cancelled'` — pushing
the row-level filter earlier lets the optimizer reduce the row set before aggregating, and avoids
conflating "3 orders" with "3 rows that happen to include cancellations." An index on `CustomerId` (or a
covering index on `(CustomerId) INCLUDE (Status)`) turns this into a stream aggregate instead of a hash
aggregate over the full table.

---

## Q10. Find the latest transaction for each customer 🔴

**Concept:** `ROW_NUMBER()`.

```sql
SELECT *
FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY AccountId ORDER BY TxnDateTime DESC, TxnId DESC) AS rn
    FROM Transactions
) t
WHERE rn = 1;
```

**Mechanism:** partition resets the counter per account; ordering descending by time (with `TxnId` as a
deterministic tiebreaker for same-timestamp transactions) puts the latest row at `rn = 1`.

**Common mistakes:** `SELECT AccountId, MAX(TxnDateTime) FROM Transactions GROUP BY AccountId` and then
needing the *rest of the row* (amount, merchant) — requires a second join back to the base table on
`(AccountId, TxnDateTime)`, which is both slower (two passes) and fragile (breaks silently if two
transactions share the exact same timestamp, returning duplicate rows from the join). `ROW_NUMBER` gets the
whole row in one pass, deterministically.

**Principal-level considerations:** a covering index `(AccountId, TxnDateTime DESC) INCLUDE (rest of the
row's columns)` lets this run as an index scan with no sort. This exact pattern — "current state per key
from an append-only event/transaction log" — is the standard read-side query for an event-sourced ledger;
in a high-throughput system you'd typically also maintain a materialized "latest transaction per account"
table updated incrementally, rather than re-deriving it with a window function on every read.

---

## Q11. Find the first transaction for each customer 🟡

**Concept:** `ROW_NUMBER()`.

```sql
SELECT *
FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY AccountId ORDER BY TxnDateTime ASC, TxnId ASC) AS rn
    FROM Transactions
) t
WHERE rn = 1;
```

Mirror of Q10 with the sort direction flipped. **Principal-level considerations:** "first transaction" is a
common proxy for account-opening/activation date in a KYC or onboarding-analytics context — if that's the
real business question, check whether an explicit `AccountOpenedDate` already exists on the account record
before deriving it from transaction history, which is one migration/backfill away from being wrong (e.g., a
zero-value verification transaction that isn't really "the first transaction" in the business sense).

---

## Q12. Find the second transaction for each customer 🔴

**Concept:** `ROW_NUMBER()`.

```sql
SELECT *
FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY AccountId ORDER BY TxnDateTime ASC, TxnId ASC) AS rn
    FROM Transactions
) t
WHERE rn = 2;
```

**Why this is its own question, not just "Q11 with `rn = 2`":** it's testing whether the candidate reaches
for `ROW_NUMBER` (position-based, always exactly one row per account, no matter how many ties on
`TxnDateTime`) rather than `DENSE_RANK`/`RANK` (value-based) out of habit from Q1–Q3. Position questions
("the Nth *row*") want `ROW_NUMBER`; value questions ("the Nth *distinct amount*") want `DENSE_RANK`. Being
able to say which one applies and why, in one sentence, is the actual bar here.

**Principal-level considerations:** same indexing story as Q10/Q11 — `(AccountId, TxnDateTime, TxnId)`
covers the partition/order for all three "Nth transaction" variants with one index.

---

## Q13. Find employees who joined in the last 6 months 🟢

**Concept:** date functions.

```sql
SELECT EmpId, Name, HireDate
FROM Employees
WHERE HireDate >= DATEADD(MONTH, -6, CAST(GETDATE() AS DATE));
```

**Mechanism:** compute the six-months-ago boundary *once*, as a constant, and compare `HireDate` to it
directly.

**Common mistakes — and the actual point of this question:** writing
`WHERE DATEDIFF(MONTH, HireDate, GETDATE()) <= 6` or `WHERE DATEADD(MONTH, 6, HireDate) >= GETDATE()`.
Both wrap the *column* in a function call. That makes the predicate **non-sargable** — the optimizer can no
longer use an index seek on `HireDate`, because it would have to evaluate the function against every row
before it knows which rows qualify, forcing a full scan (or full index scan) regardless of how selective the
filter actually is. Isolating the column on one side of the comparison (`HireDate >= <constant>`) keeps the
predicate sargable and seek-able.

**Principal-level considerations:** this is one of the highest-frequency real-world performance bugs in
production SQL — a query that "used to be fast" degrades silently as the table grows because someone wrote
`WHERE YEAR(HireDate) = 2026` or wrapped a date column in `CONVERT`/`CAST` for formatting inside the
`WHERE` clause. Spotting a non-sargable predicate on sight, and rewriting it to isolate the column, is a
default Principal-level expectation, not a bonus point.

**Follow-up:** "what if `HireDate` is stored as a `DATETIME` with a time component and you need whole
calendar months?" → be explicit about truncation (`CAST(GETDATE() AS DATE)`) so a `HireDate` with a
midday timestamp isn't excluded by an off-by-a-few-hours boundary.

---

## Q14. Find the highest salary by department 🟢

**Concept:** `GROUP BY`.

```sql
SELECT DeptId, MAX(Salary) AS HighestSalary
FROM Employees
GROUP BY DeptId;
```

**The point of this question:** distinguishing it from Q4. This returns exactly one row per department with
the *value*; it cannot also return the employee's name, because `Name` isn't part of the grouping key and
isn't aggregated — that requires the window-function form from Q4. A candidate who reaches for `GROUP BY`
when asked for the *value* and for `ROW_NUMBER`/window functions when asked for the *whole row* has
internalized the actual distinction the interview panel is checking for.

**Principal-level considerations:** an index on `(DeptId, Salary)` lets this run as a stream aggregate
(one pass, no sort) instead of a hash aggregate — cheap either way at HR-table scale, but worth naming to
show the reasoning generalizes to tables where it isn't cheap.

---

## Q15. Find departments having more than 5 employees 🟢

**Concept:** `GROUP BY` + `HAVING`.

```sql
SELECT DeptId, COUNT(*) AS Headcount
FROM Employees
GROUP BY DeptId
HAVING COUNT(*) > 5;
```

**Principal-level considerations:** if the intent is "more than 5 *active* employees," the active/terminated
filter belongs in `WHERE` before grouping, not folded into a compound `HAVING` — same reasoning as Q9. If
this powers a live headcount dashboard rather than an ad hoc report, an indexed view or a materialized
rollup table maintained by the write path is usually the right production answer, not a `GROUP BY` re-run
on every page load.

---

## Q16. Calculate running total of sales 🔴

**Concept:** `SUM() OVER()`.

```sql
SELECT SaleMonth, Revenue,
       SUM(Revenue) OVER (
           PARTITION BY ProductId
           ORDER BY SaleMonth
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS RunningTotal
FROM MonthlySales;
```

**Mechanism:** the frame clause `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` says "sum every row from
the start of this product's partition up to and including the current row" — that's the running total by
definition.

**Common mistakes:** omitting the frame clause and relying on the default. With an `ORDER BY` present but no
explicit frame, SQL Server's default is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` — which, unlike
`ROWS`, groups *tied* `ORDER BY` values together into one logical peer group and gives every row in that tie
the same (post-tie) total, not a strictly row-by-row accumulation. If `SaleMonth` can repeat (multiple rows
per month), that default silently produces the wrong running total. Being explicit about `ROWS` vs `RANGE`
is the actual test.

**Principal-level considerations:** window aggregates require the data ordered by the partition/order keys;
without a supporting index, the engine inserts a `Sort` before the `Window Spool` — check the plan. For a
report that's recomputed on every page load against a large fact table, consider precomputing the running
total incrementally at write time (or via an indexed view) instead of resorting the whole history on every
read.

---

## Q17. Calculate month-over-month sales growth 🔴

**Concept:** `LAG()`.

```sql
WITH withprev AS (
    SELECT ProductId, SaleMonth, Revenue,
           LAG(Revenue) OVER (PARTITION BY ProductId ORDER BY SaleMonth) AS PrevRevenue
    FROM MonthlySales
)
SELECT ProductId, SaleMonth, Revenue, PrevRevenue,
       Revenue - PrevRevenue AS Delta,
       (Revenue - PrevRevenue) * 100.0 / NULLIF(PrevRevenue, 0) AS PctGrowth
FROM withprev;
```

**Mechanism:** `LAG(Revenue)` pulls the value from the previous row *within the same partition* — one
lookback, no self-join.

**Common mistakes:** dividing by `PrevRevenue` directly — a product with zero revenue in the prior month
(new launch, or the first month in a promotional relaunch) causes a divide-by-zero error; `NULLIF(x, 0)`
turns that into a clean `NULL` percentage instead of a runtime error. Also: computing `LAG(Revenue)`
separately in three different expressions instead of once in a CTE — repeats the window computation and
hurts readability; compute it once, reuse the column.

**Principal-level considerations:** the first month for every product has no prior month — `PrevRevenue`
and therefore `PctGrowth` are correctly `NULL` there, not zero. If the report renders that as `0%` growth
it silently overstates a decline; decide and document how the UI/report layer should represent "no prior
period" versus "0% change," because those are different facts.

---

## Q18. Find products whose sales are greater than the previous month 🔴

**Concept:** `LAG()`.

```sql
WITH withprev AS (
    SELECT ProductId, SaleMonth, Revenue,
           LAG(Revenue) OVER (PARTITION BY ProductId ORDER BY SaleMonth) AS PrevRevenue
    FROM MonthlySales
)
SELECT ProductId, SaleMonth, Revenue, PrevRevenue
FROM withprev
WHERE Revenue > PrevRevenue;
```

**The point of this question:** it's Q17's CTE with a `WHERE` filter instead of a computed column — testing
whether the candidate reuses the same `LAG` pattern instead of reinventing it with a self-join
(`JOIN MonthlySales prev ON prev.ProductId = cur.ProductId AND prev.SaleMonth = DATEADD(MONTH, -1,
cur.SaleMonth)`, which breaks the moment a month is missing from the data — see Q21).

**Principal-level considerations:** `WHERE Revenue > PrevRevenue` naturally excludes the first month per
product (`PrevRevenue IS NULL`, and `NULL` comparisons are `UNKNOWN`, which `WHERE` treats as false) —
correct behavior here (a product can't be said to be "growing" with no baseline), but confirm that's the
desired semantic rather than an accident of `NULL` handling.

---

## Q19. Find consecutive login days for users 💀

**Concept:** gaps & islands.

```sql
WITH distinct_logins AS (
    SELECT DISTINCT UserId, LoginDate FROM Logins
),
grouped AS (
    SELECT UserId, LoginDate,
           DATEADD(DAY, -ROW_NUMBER() OVER (PARTITION BY UserId ORDER BY LoginDate), LoginDate) AS IslandKey
    FROM distinct_logins
)
SELECT UserId, MIN(LoginDate) AS StreakStart, MAX(LoginDate) AS StreakEnd, COUNT(*) AS StreakLength
FROM grouped
GROUP BY UserId, IslandKey
ORDER BY UserId, StreakStart;
```

**Mechanism — the core trick, worth explaining in full:** within any run of *consecutive* calendar dates,
`LoginDate` and `ROW_NUMBER()` both increase by exactly 1 per row, so `LoginDate − ROW_NUMBER()` is
**constant for every row in that run** and changes the instant there's a gap. That constant is an
arbitrary but stable "island ID" — grouping by it collapses each consecutive run into one bucket, and
`MIN`/`MAX`/`COUNT` over the bucket give the streak's start, end, and length. This is the single technique
behind essentially every "consecutive X" interview question, so understanding *why* the subtraction is
constant (not just that the formula works) is what separates memorization from actual understanding.

**Common mistakes:** forgetting `DISTINCT` on `(UserId, LoginDate)` first — if a user can log in multiple
times in one day and the raw table has multiple rows per day, the row-number-vs-date arithmetic breaks
because row-number advances faster than the date does.

**Principal-level considerations:** correctness depends on `LoginDate` having no gaps introduced by
timezone handling — logins timestamped in UTC but "day" meant in the user's local timezone need to be
bucketed to local calendar date *before* this query runs, or a user near a day boundary gets split into two
spurious islands. Call this out unprompted; it's the realistic way this exact query goes wrong in
production.

**Follow-up:** "find the single longest streak" → Q20.

---

## Q20. Find the longest consecutive login streak 💀

**Concept:** gaps & islands, extended.

```sql
WITH distinct_logins AS (
    SELECT DISTINCT UserId, LoginDate FROM Logins
),
grouped AS (
    SELECT UserId, LoginDate,
           DATEADD(DAY, -ROW_NUMBER() OVER (PARTITION BY UserId ORDER BY LoginDate), LoginDate) AS IslandKey
    FROM distinct_logins
),
islands AS (
    SELECT UserId, MIN(LoginDate) AS StreakStart, MAX(LoginDate) AS StreakEnd,
           COUNT(*) AS StreakLength
    FROM grouped
    GROUP BY UserId, IslandKey
)
SELECT UserId, StreakStart, StreakEnd, StreakLength
FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY UserId ORDER BY StreakLength DESC, StreakStart DESC) AS rn
    FROM islands
) ranked
WHERE rn = 1;
```

**Mechanism:** Q19 finds *every* island; this ranks islands per user by length and keeps the longest —
combining two window-function passes (`ROW_NUMBER` for islands, then `ROW_NUMBER` again for "the biggest
island") in one query.

**Principal-level considerations:** for a single global "longest streak across all users" leaderboard, drop
the `PARTITION BY UserId` on the final rank and take `TOP 1` overall (with a tiebreak policy for simultaneous
record-holders). At scale, this whole computation is a natural candidate for a nightly batch job that
maintains a `UserStreaks` summary table incrementally, rather than recomputing gaps-and-islands over the
full login history on every dashboard load — call this out to show you're thinking about the query's cost
profile in production, not just its correctness in isolation.

---

## Q21. Find missing dates in a transaction table 🔴

**Concept:** calendar / CTE.

```sql
WITH bounds AS (
    SELECT MIN(CAST(TxnDateTime AS DATE)) AS MinD, MAX(CAST(TxnDateTime AS DATE)) AS MaxD
    FROM Transactions
),
calendar AS (
    SELECT MinD AS d FROM bounds
    UNION ALL
    SELECT DATEADD(DAY, 1, d) FROM calendar, bounds WHERE d < MaxD
)
SELECT c.d AS MissingDate
FROM calendar c
LEFT JOIN Transactions t ON CAST(t.TxnDateTime AS DATE) = c.d
WHERE t.TxnId IS NULL
OPTION (MAXRECURSION 0);
```

**Mechanism:** a recursive CTE generates one row per calendar day between the observed min and max dates
(a "date spine"), then a `LEFT JOIN ... IS NULL` (same pattern as Q8) finds spine dates with no matching
transaction.

**Common mistakes:** forgetting `OPTION (MAXRECURSION 0)` — SQL Server's recursive CTE default cap is 100
levels, which silently truncates a spine longer than 100 days.

**Principal-level considerations:** a recursive CTE regenerating the date spine on every query execution is
fine for ad hoc analysis but is the wrong long-term answer for anything run repeatedly — a permanent,
pre-populated `Calendar`/`DimDate` table (a standard data-warehouse dimension, one row per date for the next
several decades, indexed on `Date`) turns this into a plain `LEFT JOIN` with no recursion cost at all. If
"missing dates" is a recurring reconciliation check (e.g., "did settlement run every business day"), that's
the production-grade version, and it should also exclude weekends/holidays via a `IsBusinessDay` flag on the
calendar table rather than hardcoding `DATEPART(WEEKDAY, ...)` logic into every query that needs it.

---

## Q22. Find gaps in an ID/sequence 🔴

**Concept:** `LEAD()` / CTE.

```sql
SELECT Id + 1 AS GapStart, NextId - 1 AS GapEnd
FROM (
    SELECT Id, LEAD(Id) OVER (ORDER BY Id) AS NextId
    FROM T
) x
WHERE NextId - Id > 1;
```

**Mechanism:** `LEAD(Id)` looks one row ahead in ID order; whenever the gap between a row and its successor
is more than 1, everything strictly between them is missing.

**Common mistakes:** off-by-one on the reported range — the gap is `[Id+1, NextId-1]`, not `[Id, NextId]`.
For a single-row gap (`NextId = Id + 2`), `GapStart` and `GapEnd` are equal, which is correct and often
missed in a hand-traced example.

**Principal-level considerations:** in a payments/ledger context, gaps in a monotonic transaction-ID or
sequence-number column are a real production alarm — they indicate either legitimate deletes, a failed
insert that still consumed a sequence value (normal for `IDENTITY`/`SERIAL` columns, which don't roll back
on transaction failure), or, in the worst case, missing records that need investigating for data loss.
Knowing that an `IDENTITY` gap is *expected* under normal failure/retry behavior — not proof of data loss —
is the fact that separates a calm, correct incident response from an unnecessary emergency.

---

## Q23. Find customers who purchased every product in a category 💀

**Concept:** relational division.

```sql
-- A: count-comparison division (fast, needs care with the denominator)
SELECT p.CustomerId
FROM Purchases p
JOIN Products pr ON pr.ProductId = p.ProductId
WHERE pr.Category = 'Electronics'
GROUP BY p.CustomerId
HAVING COUNT(DISTINCT p.ProductId) = (
    SELECT COUNT(*) FROM Products WHERE Category = 'Electronics'
);

-- B: double-negation division (the "textbook" relational-division form)
SELECT DISTINCT c.CustomerId
FROM Customers c
WHERE NOT EXISTS (
    SELECT 1 FROM Products pr
    WHERE pr.Category = 'Electronics'
    AND NOT EXISTS (
        SELECT 1 FROM Purchases p
        WHERE p.CustomerId = c.CustomerId AND p.ProductId = pr.ProductId
    )
);
```

**Mechanism:** relational division asks "for this customer, is there *no* product in the category they
*haven't* bought" — literally "there does not exist a product such that there does not exist a matching
purchase," which is what (B) encodes directly. (A) is a cheaper proxy: if a customer's distinct purchased
product count within the category equals the category's total product count, they must have bought all of
them (pigeonhole).

**Common mistakes:** with (A), joining `Purchases` to `Products` and grouping *before* restricting to the
category is the main way this silently produces wrong answers — counting distinct products across all
categories a customer bought, rather than just the target category, will never equal the target category's
count and the query returns nobody. The `WHERE pr.Category = 'Electronics'` before the `GROUP BY` is load
bearing.

**Principal-level considerations:** (A) is usually faster (aggregation, index-friendly) and is the one to
lead with in an interview, but (B) is the one to know cold conceptually because it's the general form of
relational division and generalizes to conditions (A)'s counting trick can't express cleanly — e.g., "every
product in the category, at a quantity of at least 2." State the trade-off rather than presenting only one.

---

## Q24. Find customers who purchased Product A but not Product B 🔴

**Concept:** `EXISTS` / `NOT EXISTS`.

```sql
SELECT DISTINCT p1.CustomerId
FROM Purchases p1
WHERE p1.ProductId = 'A'
AND NOT EXISTS (
    SELECT 1 FROM Purchases p2
    WHERE p2.CustomerId = p1.CustomerId AND p2.ProductId = 'B'
);
```

**Mechanism:** filter to customers with at least one row for `A`, then exclude any of them that also have a
row for `B`, correlated by `CustomerId`.

**Common mistakes:** trying to express this as a single-row condition (`WHERE ProductId = 'A' AND
ProductId <> 'B'`) — that's a contradiction-free but meaningless filter on one row; "bought A" and "didn't
buy B" are facts about two different (possibly nonexistent) rows for the same customer, which is exactly
why this needs a correlated subquery or self-join, not a single-row predicate.

**Principal-level considerations:** this is the standard shape of a marketing "next-best-offer" /
cross-sell query (customers engaged with product A, not yet cross-sold to B) and, in a fraud/compliance
context, the shape of a control gap check (e.g., "accounts with a wire transfer but no matching KYC
attestation on file"). The `NOT EXISTS` form scales far better than `NOT IN (SELECT ProductId FROM
Purchases WHERE ProductId = 'B')`-style rewrites once `NULL`s are anywhere in play — same trap as Q8.

---

## Q25. Find employees earning above department average 🔴

**Concept:** CTE / window function.

```sql
-- A: correlated subquery
SELECT e.EmpId, e.Name, e.DeptId, e.Salary
FROM Employees e
WHERE e.Salary > (
    SELECT AVG(e2.Salary) FROM Employees e2 WHERE e2.DeptId = e.DeptId
);

-- B: window function
SELECT EmpId, Name, DeptId, Salary
FROM (
    SELECT *, AVG(Salary) OVER (PARTITION BY DeptId) AS DeptAvg
    FROM Employees
) x
WHERE Salary > DeptAvg;
```

**Mechanism:** (A) recomputes the department average once per outer row via correlation; (B) computes every
department's average once, in a single pass, and attaches it to every row in that partition.

**Common mistakes:** computing the average with a separate `GROUP BY` query and then trying to join it back
without also carrying `DeptId` correctly, or comparing against the *global* average instead of the
*department* average (a scoping mistake that's easy to make under interview pressure and easy to catch by
reading the `PARTITION BY`/correlation clause back out loud).

**Principal-level considerations:** conceptually (A) looks like `O(n)` subquery executions, but SQL
Server's optimizer typically flattens a correlated `AVG` subquery like this into a single grouped scan plus
a join — check the actual execution plan rather than assuming the naive per-row cost model; the two forms
often produce comparable plans on this engine. (B) is still generally preferred for readability and because
it composes more easily when multiple department-level aggregates are needed side by side (ties into Q26).

---

## Q26. Find the percentage contribution of each department to total salary 🔴

**Concept:** window aggregate.

```sql
SELECT DeptId,
       SUM(Salary) AS DeptTotal,
       SUM(Salary) * 100.0 / SUM(SUM(Salary)) OVER () AS PctOfTotal
FROM Employees
GROUP BY DeptId;
```

**Mechanism:** `SUM(Salary)` is the ordinary grouped aggregate per department; `SUM(SUM(Salary)) OVER ()`
is a *window function applied on top of an already-grouped aggregate* — it re-sums the per-department totals
across the whole (unpartitioned) result set, giving the grand total on every row without a second query or
a self-join back to an ungrouped total.

**Common mistakes:** trying to compute the grand total with a separate scalar subquery
(`(SELECT SUM(Salary) FROM Employees)`) — not wrong, but it's a second full scan of the base table where the
window-over-aggregate form reuses the same grouped result set the query already produced.

**Principal-level considerations:** this "aggregate of an aggregate" pattern — window function wrapping a
`GROUP BY` result — is underused and worth having ready; it's the same shape needed for "each region's share
of total revenue," "each merchant's share of processed volume," and similar total-and-share reports that
are extremely common in financial reporting. Watch for integer division: `SUM(Salary) * 100.0 / ...` — the
`100.0` (not `100`) forces decimal arithmetic; without it, integer division truncates every percentage to 0
except when it divides evenly.

---

## Q27. Find duplicate financial transactions based on multiple columns 🔴

**Concept:** grouping / window — framed as double-charge detection.

```sql
SELECT AccountId, Amount, MerchantId, CAST(TxnDateTime AS DATE) AS TxnDate, COUNT(*) AS Occurrences
FROM Transactions
GROUP BY AccountId, Amount, MerchantId, CAST(TxnDateTime AS DATE)
HAVING COUNT(*) > 1;
```

**Mechanism:** grouping on the composite "looks like the same charge" key (account, amount, merchant, and
calendar day rather than exact timestamp, since a genuine retry a few seconds later shouldn't dodge
detection by timestamp alone) surfaces repeats.

**Common mistakes — and the real point of this question at a fintech-caliber interview:** treating this
heuristic detection query as if it were the *fix*. A same-day, same-amount, same-merchant repeat is not
proof of an erroneous double charge — a customer can legitimately buy two identical coffees from the same
merchant on the same day. In a payments system, the correct way to *prevent* duplicate processing isn't a
nightly `GROUP BY` sweep at all — it's an **idempotency key** on the write path (a client-supplied key,
enforced with a unique constraint, so a retried request updates/returns the original result instead of
inserting a second row). This query is a monitoring/investigation tool for a control that lives elsewhere,
not the control itself — say this explicitly; it's the difference between a detection mindset and a
prevention mindset, and interview panels at this level are listening for exactly that distinction.

**Principal-level considerations:** if genuine double-charges are found, the remediation (reversal/refund)
must itself be idempotent and auditable — every automated reversal needs its own record tying it back to the
detected duplicate pair, because "we deleted the extra row" is not an acceptable answer in a system subject
to financial audit; the correct fix is a compensating, reviewable transaction, not a silent delete (this
also connects to why Q7's blind delete-duplicates pattern is inappropriate for a ledger table specifically).

---

## Q28. Find transactions occurring within 10 minutes of another transaction 💀

**Concept:** `LAG()` + dates — framed as a payment-velocity/fraud check.

```sql
WITH ordered AS (
    SELECT *, LAG(TxnDateTime) OVER (PARTITION BY AccountId ORDER BY TxnDateTime) AS PrevTxnTime
    FROM Transactions
)
SELECT *,
       DATEDIFF(MINUTE, PrevTxnTime, TxnDateTime) AS MinutesSincePrev
FROM ordered
WHERE DATEDIFF(MINUTE, PrevTxnTime, TxnDateTime) <= 10;
```

**Mechanism:** with the rows sorted ascending by time per account, `LAG` always retrieves the *nearest
preceding* transaction. That's not a simplification — it's sufficient by construction: if the gap to the
nearest preceding transaction exceeds 10 minutes, every transaction before that one is even further away, so
checking only the immediate predecessor correctly answers "is there any prior transaction within 10 minutes"
without needing to compare against every earlier row.

**Common mistakes:** assuming a self-join with a `BETWEEN` range (`b.TxnDateTime BETWEEN
DATEADD(MINUTE,-10,a.TxnDateTime) AND a.TxnDateTime`) is required — it works, but it's needlessly
`O(n²)`-shaped for a question `LAG` answers in one linear pass. The self-join form does become necessary if
the requirement changes to "within 10 minutes of **any** other transaction, looking both directions" — then
both `LAG` and `LEAD` are needed (or a self-join), since being close to a *later* transaction isn't captured
by looking only backward.

**Principal-level considerations:** this is a velocity check — the standard first-pass fraud/anomaly
detection pattern for card-present or ACH transaction streams. In production this typically doesn't run as
an ad hoc batch query at all; it runs as a streaming computation (a sliding window aggregation in a stream
processor) evaluated at write time, so the account can be flagged or the transaction held *before*
settlement, not discovered afterward in a report. Naming that this SQL query is the "batch reporting"
version of a check that a real-time system would implement differently is the kind of connection a Principal
Engineer is expected to make unprompted.

---

## Q29. Find overlapping date ranges 💀

**Concept:** interval logic.

```sql
SELECT a.IntervalId AS A, b.IntervalId AS B, a.StartDate, a.EndDate, b.StartDate, b.EndDate
FROM Intervals a
JOIN Intervals b
    ON a.IntervalId < b.IntervalId          -- avoid (a,b)+(b,a) duplicates and a matching itself
   AND a.StartDate <= b.EndDate
   AND b.StartDate <= a.EndDate;
```

**Mechanism:** two closed intervals `[s1,e1]` and `[s2,e2]` overlap **iff `s1 <= e2 AND s2 <= e1`** — this
is the standard interval-overlap identity (easiest to internalize by proving its negation: they *fail* to
overlap only when one ends strictly before the other starts, i.e. `e1 < s2 OR e2 < s1`; De Morgan's law on
that gives the overlap condition directly). `a.IntervalId < b.IntervalId` is not part of the overlap logic —
it's there purely to report each overlapping pair once instead of twice, and to prevent a row from ever
being joined to itself.

**Common mistakes:** trying to special-case the four ways two intervals can overlap (A contains B, B
contains A, A starts first and they cross, B starts first and they cross) with an `OR` of four conditions —
the two-inequality identity above already covers all four cases in one predicate; enumerating cases by hand
is a sign of not having internalized the general form.

**Principal-level considerations:** for "does interval X overlap *anything*" queries at scale, this
pairwise self-join is `O(n²)` and does not scale to large interval sets — a range/temporal index (SQL
Server's temporal tables, or an interval tree / R-tree structure application-side) is the production answer.
This exact pattern also underlies a real scheduling/compliance problem: detecting overlapping employment
periods, overlapping trade holding periods, or overlapping validity windows on a slowly-changing-dimension
table (e.g., two "current" address rows for the same customer that should never coexist) — call out the
domain-agnostic reusability of the identity rather than treating it as a date-specific trick.

**Follow-up:** "now merge all overlapping intervals into their union" → sort by `StartDate`, then run a
gaps-and-islands pass (Q19's technique) using a running `MAX(EndDate) OVER (ORDER BY StartDate ROWS
UNBOUNDED PRECEDING)` to detect where a new interval starts after the running-max end date — that's where a
new merged interval begins.

---

## Q30. Find users who performed Event A followed by Event B within a specified time window 💀

**Concept:** sessionization / `APPLY` — the funnel-conversion pattern.

```sql
-- A: correct, but O(n^2)-shaped under a naive self-join
SELECT DISTINCT a.UserId
FROM Events a
JOIN Events b
    ON a.UserId = b.UserId
   AND a.EventType = 'A'
   AND b.EventType = 'B'
   AND b.EventTime > a.EventTime
   AND b.EventTime <= DATEADD(MINUTE, 30, a.EventTime);

-- B: scales better — CROSS APPLY finds only the nearest qualifying B per A
SELECT DISTINCT a.UserId
FROM Events a
CROSS APPLY (
    SELECT TOP (1) b.EventTime
    FROM Events b
    WHERE b.UserId = a.UserId
      AND b.EventType = 'B'
      AND b.EventTime > a.EventTime
    ORDER BY b.EventTime ASC
) nearest_b
WHERE a.EventType = 'A'
  AND nearest_b.EventTime <= DATEADD(MINUTE, 30, a.EventTime);
```

**Mechanism:** (A) joins every `A` event for a user to every later `B` event for that user and filters to
the ones inside the window — correct, but for a user with many `A`/`B` events it produces and discards a
large cross-product before filtering. (B) uses `CROSS APPLY` to pull, per `A` event, only the single
soonest-following `B` event, then checks that one candidate against the window — no cross-product, and it's
also the natural place to plug in "the nearest occurrence of X" logic in general, not just this window
check.

**Common mistakes:** not deduplicating when a user could trigger multiple qualifying `(A, B)` pairs — the
question asks *which users* did this, so `DISTINCT UserId` is correct; a subtly different but common variant
of this question asks for the *count of conversions*, which must not deduplicate and needs a different
query entirely (every qualifying pair counts). Confirm which one is being asked.

**Principal-level considerations:** this is the canonical **funnel/conversion-window** query — "viewed
product → purchased within 30 minutes," "login → wire-transfer initiated within 10 minutes" for a fraud
funnel, "payment authorized → settlement confirmed within a service-level window" for ops monitoring. At the
data volumes where this matters in production (clickstream/event-log scale), this stops being a query you
run against an OLTP table at all — it becomes a job in a stream-processing or columnar analytical engine
(session windows in Kafka Streams/Flink, or a partitioned/clustered columnar table), because a self-join or
`APPLY` over a billion-row event table, however well-indexed, is the wrong tool once volume crosses from
"reporting" into "real-time." Naming that boundary — where the SQL answer stops being the production answer
— is exactly the kind of judgment this question is designed to surface at the Principal level.

---

## References

| Topic | Source |
|---|---|
| Window functions (`OVER`, `PARTITION BY`, frames) | https://learn.microsoft.com/sql/t-sql/queries/select-over-clause-transact-sql |
| `RANK`, `DENSE_RANK`, `ROW_NUMBER`, `NTILE` | https://learn.microsoft.com/sql/t-sql/functions/ranking-functions-transact-sql |
| `LAG` / `LEAD` | https://learn.microsoft.com/sql/t-sql/functions/lag-transact-sql |
| `APPLY` (`CROSS APPLY` / `OUTER APPLY`) | https://learn.microsoft.com/sql/t-sql/queries/from-transact-sql#using-apply |
| Recursive CTEs | https://learn.microsoft.com/sql/t-sql/queries/with-common-table-expression-transact-sql |
| `NULL` and three-valued logic / the `NOT IN` trap | https://learn.microsoft.com/sql/t-sql/language-elements/comparison-operators-transact-sql |
| Sargability and index seeks vs scans | https://learn.microsoft.com/sql/relational-databases/performance/query-tuning-and-optimization |
| Execution plans (reading `Sort`/`Window Spool`/`Hash Match`) | https://learn.microsoft.com/sql/relational-databases/performance/execution-plans |
| PostgreSQL window functions (for dialect comparison) | https://www.postgresql.org/docs/current/tutorial-window.html |
| PostgreSQL date/time functions | https://www.postgresql.org/docs/current/functions-datetime.html |
| Idempotency keys for safe retries (Stripe API docs, widely cited pattern reference) | https://stripe.com/docs/api/idempotent_requests |
| Gaps-and-islands technique reference (Itzik Ben-Gan's canonical write-up) | https://learn.microsoft.com/archive/blogs/sqlserverstorageengine/gaps-and-islands |
