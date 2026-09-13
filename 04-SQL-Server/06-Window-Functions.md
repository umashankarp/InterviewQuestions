> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: [[05-Subqueries-CTEs]]

# SQL Server Interview Workbook — Window Functions

Window functions are the single highest-leverage T-SQL feature for a Principal/Staff-level interview: they replace self-joins, correlated subqueries, and client-side loops with set-based operators the optimizer can reason about — and their frame semantics are exactly where senior candidates separate themselves from mid-level ones. This file covers ROW_NUMBER/RANK/DENSE_RANK/NTILE, LEAD/LAG, FIRST_VALUE/LAST_VALUE, aggregate-window functions (SUM/AVG OVER), PARTITION BY, frame specification (ROWS vs RANGE), running totals, and moving averages — in more depth than any other file in this workbook, per the brief's explicit "cover extensively" instruction.

Canonical sample schema used throughout:

```sql
Employees(EmployeeID, FirstName, LastName, DepartmentID, ManagerID, Salary, HireDate)
Departments(DepartmentID, DepartmentName)
Customers(CustomerID, CustomerName, Country)
Orders(OrderID, CustomerID, OrderDate, TotalAmount)
OrderItems(OrderItemID, OrderID, ProductID, Quantity, UnitPrice)
Products(ProductID, ProductName, CategoryID, Price)
Categories(CategoryID, CategoryName)
UserLogins(UserID, LoginDate)
UserEvents(UserID, EventType, EventTime)
Accounts(AccountID, CustomerID, Balance, Currency)
Transactions(TransactionID, AccountID, Amount, TransactionType, Status, CreatedAt, IdempotencyKey)
LedgerEntries(LedgerEntryID, AccountID, TransactionID, DebitAmount, CreditAmount, EntryDate)
```

---

## Q55. ROW_NUMBER() vs RANK() vs DENSE_RANK() — behavior with ties

**Difficulty:** 🟢

### 1. Interview Answer
All three are ranking window functions that number rows within a partition ordered by some expression, but they disagree on what happens when two rows tie on the ORDER BY key. `ROW_NUMBER()` ignores ties completely and hands out a strictly sequential integer (1,2,3,4…) — the assignment among tied rows is otherwise arbitrary unless the ORDER BY is unique. `RANK()` gives tied rows the same rank and then **skips** the next rank(s) by the count of ties (1,1,3,4…). `DENSE_RANK()` gives tied rows the same rank but does **not** skip — the next distinct value gets the very next integer (1,1,2,3…). Pick `ROW_NUMBER` when you need a unique row per group (dedup, pagination, "top 1 per group"); pick `RANK` when gaps should reflect how many rows share first place (competition-style ranking); pick `DENSE_RANK` when you want a compact rank suitable for bucketing without gaps (e.g., "top 3 distinct salary levels").

### 2. SQL Query
```sql
SELECT
    e.EmployeeID,
    e.DepartmentID,
    e.Salary,
    ROW_NUMBER() OVER (PARTITION BY e.DepartmentID ORDER BY e.Salary DESC) AS RowNum,
    RANK()       OVER (PARTITION BY e.DepartmentID ORDER BY e.Salary DESC) AS Rnk,
    DENSE_RANK() OVER (PARTITION BY e.DepartmentID ORDER BY e.Salary DESC) AS DenseRnk
FROM Employees e
ORDER BY e.DepartmentID, e.Salary DESC;
```

### 3. Explain the Query
`PARTITION BY e.DepartmentID` resets the ranking counter per department. `ORDER BY e.Salary DESC` defines the ranking order (highest salary = rank 1). SQL Server computes all three window functions in a single logical pass over each partition — the engine typically only needs one sort per distinct `(PARTITION BY, ORDER BY)` shape even when several ranking functions share it, so stacking `ROW_NUMBER`/`RANK`/`DENSE_RANK` in the same query is nearly free once the sort exists.

### 4. Sample Data
| EmployeeID | DepartmentID | Salary |
|---|---|---|
| 1 | 10 | 90000 |
| 2 | 10 | 90000 |
| 3 | 10 | 85000 |
| 4 | 20 | 75000 |

### 5. Expected Output
| EmployeeID | DepartmentID | Salary | RowNum | Rnk | DenseRnk |
|---|---|---|---|---|---|
| 1 | 10 | 90000 | 1 | 1 | 1 |
| 2 | 10 | 90000 | 2 | 1 | 1 |
| 3 | 10 | 85000 | 3 | 3 | 2 |
| 4 | 20 | 75000 | 1 | 1 | 1 |

Note employees 1 and 2 tie at 90000: `RowNum` breaks the tie arbitrarily (1 and 2), `Rnk` gives both rank 1 and then **jumps to 3** for the next employee, `DenseRnk` gives both rank 1 and the next employee gets **2**.

### 6. Alternative Solutions
- **Correlated subquery with COUNT(DISTINCT …):** `SELECT COUNT(DISTINCT e2.Salary) FROM Employees e2 WHERE e2.DepartmentID = e.DepartmentID AND e2.Salary >= e.Salary` reproduces `DENSE_RANK` logic without window functions — works on SQL Server 2000-era code but is O(n²) and far slower on real volumes.
- **Self-join + GROUP BY** to emulate `RANK`: joins the table to itself on `Salary >=` and counts — same asymptotic problem.
- **Preferred:** the window-function form. It's a single sorted pass per partition instead of a subquery evaluated per row, it's declarative, and it lets you request all three ranking flavors from one sort.

### 7. Performance
An index on `(DepartmentID, Salary DESC)` lets the optimizer satisfy the `PARTITION BY`/`ORDER BY` requirement directly from the index order, avoiding an explicit **Sort** operator before the **Window Aggregate**/**Segment** operators appear in the plan (verify with an actual execution plan — see [Display an Actual Execution Plan](https://learn.microsoft.com/en-us/sql/relational-databases/performance/display-an-actual-execution-plan)). Without a matching index, SQL Server inserts a full sort, which is the single largest cost in most window-function queries at scale — a memory grant for the sort can also spill to tempdb under memory pressure. All three ranking functions computed together add negligible extra cost over computing just one, because they share the sort.

### 8. Edge Cases
- **Ties with a non-unique ORDER BY:** `ROW_NUMBER`'s tie-breaking order is undefined/arbitrary unless you add a tiebreaker column (e.g., `ORDER BY Salary DESC, EmployeeID ASC`) — never rely on "whatever order came out" being stable across plan changes.
- **NULLs in the ORDER BY key:** NULLs sort first in ascending order and last in descending order by default in SQL Server; if `Salary` can be NULL, decide explicitly whether NULL salaries should rank first or last and adjust with `ORDER BY CASE WHEN Salary IS NULL THEN 1 ELSE 0 END, Salary DESC` if needed.
- **Empty partition:** not really possible if the partitioning column comes from the same row set, but a `LEFT JOIN` producing a NULL `DepartmentID` puts every unmatched row into its own single-row "NULL partition."
- **No PARTITION BY at all:** ranks the entire result set as one partition — easy to do by accident and get global instead of per-group ranks.

### 9. Production Scenario
Compliance and payroll systems use `ROW_NUMBER() OVER (PARTITION BY EmployeeID ORDER BY EffectiveDate DESC)` to pick the "current" salary/benefits row out of a slowly-changing-dimension table without a separate `IsCurrent` flag that has to be maintained transactionally. Leaderboards and commission-tier calculations use `RANK`/`DENSE_RANK` directly.

### 10. Interview Follow-ups
1. Why does `ROW_NUMBER` require an `ORDER BY` but doesn't strictly need a unique one — and why is that dangerous?
2. How would you get exactly one row per department (the "top-1-per-group" pattern) using these functions?
3. Can you use `RANK()` in a `WHERE` clause directly? Why not?
4. What execution-plan operator computes these functions, and what precedes it?
5. How do these functions behave differently under `SNAPSHOT` isolation vs `READ COMMITTED` if two sessions modify rows concurrently mid-scan?

### 11. Follow-up Answers
1. Without `ORDER BY` the function wouldn't know how to sequence rows, so SQL Server rejects `ROW_NUMBER()` with no `ORDER BY` at parse time. A non-unique `ORDER BY` is dangerous because it makes the row-to-number assignment among ties non-deterministic across executions/plan changes — a "pick one arbitrary row per group" query can silently return a *different* row after a statistics update or index rebuild changes the physical scan order. Add a deterministic tiebreaker (primary key) whenever the result feeds a business decision (e.g., "which row do we soft-delete").
2. Wrap the windowed query in a CTE or derived table and filter `WHERE RowNum = 1` in the outer query — window functions cannot be referenced directly in the same query's `WHERE`/`HAVING` because of T-SQL's logical processing order (windowing happens after `WHERE`).
3. No — `WHERE` is logically evaluated before window functions are computed (`FROM → WHERE → GROUP BY → HAVING → SELECT` including window functions `→ ORDER BY`), so the column doesn't exist yet at `WHERE`-evaluation time. You must filter in an outer query/CTE.
4. The plan shows a **Sort** (if no supporting index) feeding a **Segment** operator (marks partition boundaries) feeding a **Sequence Project** or **Window Aggregate** operator that computes the ranking value per row.
5. Under `READ COMMITTED` (the default, lock-based), a long-running ranking query can read a mix of pre- and post-commit rows from different concurrent transactions as it scans (no repeatable-read guarantee), potentially producing ranks computed against a data set that never existed at any single point in time. Under `SNAPSHOT` isolation, the entire query sees a consistent transaction-start version of the data via row versioning, so the ranking is computed against one coherent snapshot — the standard reason reporting/ranking queries are frequently run under `SNAPSHOT` or `READ COMMITTED SNAPSHOT`.

### 12. Common Mistakes
- Using `RANK()` when `DENSE_RANK()` (or vice versa) was actually wanted — verify against the exact business rule ("skip ranks for ties" vs "compact ranks") rather than defaulting to whichever function is more familiar.
- Forgetting a tiebreaker column and assuming `ROW_NUMBER` returns a stable, reproducible pick among ties.
- Trying to filter on the window function's alias in the same `SELECT`'s `WHERE` clause.
- Assuming these functions require a `GROUP BY` — they don't; they operate over the ungrouped row set defined by the partition.

### 13. Architect Insight
A Senior candidate can compute the ranking. A Staff/Principal candidate additionally knows *why* the ranking is non-deterministic without a tiebreaker, can point to the exact execution-plan operators that materialize it, and reasons about the interaction between ranking queries and isolation levels — because "give me one row per customer" queries are extremely common in reporting pipelines, and a non-deterministic tie-break turning into a flapping report value in production is a real, recurring incident class, not a theoretical concern.

---

## Q56. NTILE() — bucketing rows into N groups

**Difficulty:** 🟡

### 1. Interview Answer
`NTILE(n)` divides the rows in each partition into `n` groups of as-equal-size-as-possible, numbered 1..n, ordered by the `ORDER BY` expression. If the row count doesn't divide evenly by `n`, the earlier groups get one extra row each — e.g., 10 rows into `NTILE(3)` produces groups of size 4, 3, 3. It's the standard tool for percentile/quartile/decile bucketing (salary quartiles, customer deciles by spend) without hand-rolling `NTILE`'s bucket-size arithmetic yourself.

### 2. SQL Query
```sql
SELECT
    e.EmployeeID,
    e.Salary,
    NTILE(4) OVER (ORDER BY e.Salary DESC) AS SalaryQuartile
FROM Employees e;
```

### 3. Explain the Query
SQL Server sorts all rows by `Salary DESC` (no `PARTITION BY` here, so the whole table is one partition), computes `total_rows / 4`, and assigns quartile numbers so the first `total_rows % 4` groups receive one extra row. Quartile 1 therefore holds the highest earners.

### 4. Sample Data
10 employees with distinct salaries ranked 1st (highest) through 10th (lowest).

### 5. Expected Output
Ranks 1–3 → `SalaryQuartile = 1`; ranks 4–6 → `2`; ranks 7–8 → `3`; ranks 9–10 → `4` (groups of 3,3,2,2 for 10 rows / 4 buckets — SQL Server distributes the remainder to the *earliest* groups first).

### 6. Alternative Solutions
- **Manual bucketing via `ROW_NUMBER()` and integer division:** `((ROW_NUMBER() OVER (ORDER BY Salary DESC) - 1) * 4 / COUNT(*) OVER ()) + 1` — mathematically similar but easy to get off-by-one wrong, and doesn't handle the remainder distribution the same way `NTILE` documents it.
- **`PERCENT_RANK()`/`CUME_DIST()`** if you want a continuous percentile (0–1) instead of a discrete bucket number — different semantic, useful when downstream logic needs a percentile score rather than a bucket label.
- **Preferred:** `NTILE` — it's purpose-built, documented, and avoids reinventing the remainder-distribution rule.

### 7. Performance
Same cost profile as the other ranking functions: needs a sort matching the `ORDER BY` (and `PARTITION BY` if present) unless a covering index supplies the order. `NTILE` additionally needs to know the partition's total row count before assigning bucket numbers, so it's inherently a two-pass-over-the-partition operation internally (SQL Server still does this within a single query-plan execution, not as separate round trips).

### 8. Edge Cases
- **Fewer rows than buckets:** if a partition has 2 rows and you ask for `NTILE(4)`, only buckets 1 and 2 will be populated — buckets 3 and 4 simply don't appear, they aren't emitted as empty groups.
- **All rows tied on the ORDER BY key:** `NTILE` still splits them across buckets based on arbitrary tie-order (add a tiebreaker if bucket assignment must be reproducible).
- **NULLs in the ordering column:** sort to one end per standard NULL-ordering rules; decide whether that's the intended bucket.

### 9. Production Scenario
Marketing/CRM systems use `NTILE(10)` on customer lifetime spend to build decile segments for targeted campaigns; risk systems use it on transaction-amount distributions to flag the top percentile for manual review.

### 10. Interview Follow-ups
1. How does `NTILE` decide which buckets get the extra row when the count doesn't divide evenly?
2. How is `NTILE` different from `PERCENT_RANK`/`CUME_DIST`?
3. Can `NTILE` be combined with `PARTITION BY` to bucket within groups (e.g., quartiles per department)?
4. What happens if `n` in `NTILE(n)` is larger than the number of rows in the partition?

### 11. Follow-up Answers
1. Per Microsoft's documented behavior, the first `(row_count % n)` groups (in partition order) each get one extra row; the remaining groups get `row_count / n` (integer division) rows.
2. `PERCENT_RANK` and `CUME_DIST` return a continuous relative-rank value between 0 and 1 for every row; `NTILE` returns a discrete integer bucket label. Use `NTILE` when you need a fixed number of named groups; use `PERCENT_RANK`/`CUME_DIST` when downstream logic needs a comparable relative-position score.
3. Yes — `NTILE(4) OVER (PARTITION BY DepartmentID ORDER BY Salary DESC)` computes independent quartiles inside each department.
4. Every row gets its own bucket number up to the row count, and the remaining bucket numbers beyond the row count are never assigned (no error is raised).

### 12. Common Mistakes
- Assuming `NTILE(4)` always produces exactly equal-sized groups — it doesn't when the row count isn't divisible by 4.
- Confusing `NTILE`'s discrete buckets with a true percentile score, then trying to compare bucket numbers across differently-sized partitions as if they meant the same relative position.
- Forgetting `PARTITION BY` and accidentally bucketing the entire table instead of per-group.

### 13. Architect Insight
The differentiator here is knowing the exact remainder-distribution rule well enough to predict output without running it — because "why does department A's bucket 1 have 3 people but department B's has 2" is exactly the kind of question a data/BI team will escalate, and being able to explain it from the specification rather than from trial-and-error is a Staff-level signal.

---

## Q57. LEAD()/LAG() — comparing to prior/next row

**Difficulty:** 🟢

### 1. Interview Answer
`LAG(expr, offset, default)` and `LEAD(expr, offset, default)` read a value from a row a fixed number of positions **before** or **after** the current row within its partition/order, without a self-join. `offset` defaults to 1, `default` (returned when the offset row doesn't exist, e.g., the first row has no prior row) defaults to `NULL`. They're the standard tool for period-over-period comparisons — day-over-day change, detecting the previous status in a state-transition history, or finding the gap to the next event.

### 2. SQL Query
```sql
SELECT
    t.AccountID,
    t.CreatedAt,
    t.Amount,
    LAG(t.Amount, 1)  OVER (PARTITION BY t.AccountID ORDER BY t.CreatedAt) AS PrevAmount,
    t.Amount - LAG(t.Amount, 1, 0) OVER (PARTITION BY t.AccountID ORDER BY t.CreatedAt) AS ChangeFromPrev,
    LEAD(t.CreatedAt, 1) OVER (PARTITION BY t.AccountID ORDER BY t.CreatedAt) AS NextTxnTime
FROM Transactions t;
```

### 3. Explain the Query
Rows are partitioned per `AccountID` and ordered by `CreatedAt`. `LAG(Amount, 1)` pulls the immediately preceding transaction's amount into the current row (NULL for the first transaction per account). The third-position argument to `LAG` (`0`) supplies a default instead of NULL, letting the subtraction `Amount - LAG(...)` avoid propagating NULL for the very first row. `LEAD(CreatedAt, 1)` looks one row ahead to compute the time until the next transaction — useful for gap analysis.

### 4. Sample Data
| AccountID | CreatedAt | Amount |
|---|---|---|
| 1 | 2026-01-01 | 100 |
| 1 | 2026-01-03 | 150 |
| 1 | 2026-01-10 | 90 |

### 5. Expected Output
| AccountID | CreatedAt | Amount | PrevAmount | ChangeFromPrev | NextTxnTime |
|---|---|---|---|---|---|
| 1 | 2026-01-01 | 100 | NULL | 100 | 2026-01-03 |
| 1 | 2026-01-03 | 150 | 100 | 50 | 2026-01-10 |
| 1 | 2026-01-10 | 90 | 150 | -60 | NULL |

### 6. Alternative Solutions
- **Self-join** on `a.AccountID = b.AccountID AND a.RowNum = b.RowNum + 1` (after assigning `ROW_NUMBER` to both sides) — works, but is two logical scans plus a join versus one sorted pass, and is far more verbose.
- **Correlated subquery** with `TOP 1 ... ORDER BY CreatedAt DESC` filtered to `CreatedAt < current row's CreatedAt` — correct but re-evaluated per row, and doesn't get the benefit of a single shared sort the way window functions do.
- **Preferred:** `LAG`/`LEAD` — introduced specifically to eliminate both patterns; simplest to read and fastest to execute.

### 7. Performance
Needs the same `(PARTITION BY, ORDER BY)`-matching index as any other window function to avoid an explicit sort. `LAG`/`LEAD` are computed as a single forward/backward-looking pass over the sorted partition — O(1) additional work per row once sorted, versus O(n) per row for the correlated-subquery alternative on an unindexed comparison.

### 8. Edge Cases
- **First/last row in a partition:** `LAG`/`LEAD` return the `default` argument (NULL if omitted) — always decide explicitly whether NULL or a sentinel default is correct for the business logic (e.g., "change from previous" for the first row should usually be treated as "N/A", not silently coerced to a large delta from 0).
- **Duplicate ORDER BY values:** if two transactions have the identical `CreatedAt`, which one `LAG` treats as "previous" is arbitrary — add a tiebreaker (e.g., `TransactionID`) for determinism.
- **Gaps vs. multiple offsets:** `LAG(Amount, 2)` skips to two rows back, not "two days back" — offsets are row-based, not value-based; don't confuse this with a date-range window.

### 9. Production Scenario
Fraud-detection pipelines use `LAG` to compare a transaction's amount/location against the account's immediately preceding transaction to flag improbable velocity (e.g., two transactions in different countries three minutes apart); billing systems use it to compute month-over-month usage deltas.

### 10. Interview Follow-ups
1. What does `LAG` return for the first row of a partition, and how do you control that?
2. Is `LAG`/`LEAD` affected by the frame clause (`ROWS BETWEEN …`)?
3. How would you get the value from exactly 7 rows back instead of 1?
4. How do you compute "time since previous event" instead of "value at previous event"?

### 11. Follow-up Answers
1. It returns the `default` argument, or `NULL` if none was supplied — always supply an explicit default when the caller needs a non-NULL sentinel, and document what that sentinel means downstream.
2. No — per Microsoft's documentation, `LAG`/`LEAD` don't support a `ROWS`/`RANGE` frame clause at all; they only take `PARTITION BY` and `ORDER BY`. Frame clauses only apply to aggregate window functions and `FIRST_VALUE`/`LAST_VALUE`.
3. Pass the offset explicitly: `LAG(Amount, 7)`.
4. `DATEDIFF(SECOND, LAG(CreatedAt) OVER (...), CreatedAt)` — subtract the lagged timestamp from the current row's timestamp.

### 12. Common Mistakes
- Forgetting the third `default` argument and then having downstream arithmetic silently produce NULL for boundary rows instead of a sentinel value.
- Assuming `LAG(Amount, N)` means "N days/units back" rather than "N *rows* back" when the data isn't gap-free (e.g., missing days in a daily series).
- Trying to apply a `ROWS BETWEEN` frame clause to `LAG`/`LEAD` — not supported; that's only valid for aggregate/`FIRST_VALUE`/`LAST_VALUE` functions.

### 13. Architect Insight
Recognizing that `LAG`/`LEAD` are row-offset, not time-offset, functions — and knowing to reach for a self-join, `APPLY`, or a generated calendar-spine table instead when the real requirement is "same day last week" over a series with gaps — is the difference between a query that's subtly wrong on real (gappy) production data and one that's actually correct.

---

## Q58. FIRST_VALUE()/LAST_VALUE() — why the frame clause matters

**Difficulty:** 🔴

### 1. Interview Answer
`FIRST_VALUE(expr)` and `LAST_VALUE(expr)` return a value from the first/last row of the **window frame**, not the whole partition — and that distinction is the single most common bug with these two functions. If you don't specify a frame, the *default* frame for a function with an `ORDER BY` is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, which means `LAST_VALUE` with no explicit frame effectively just returns the **current row's own value**, not the true last row of the partition. To get the actual last row of the partition, you must explicitly widen the frame: `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`.

### 2. SQL Query
```sql
SELECT
    o.OrderID,
    o.CustomerID,
    o.OrderDate,
    o.TotalAmount,
    FIRST_VALUE(o.TotalAmount) OVER (
        PARTITION BY o.CustomerID ORDER BY o.OrderDate
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS FirstOrderAmount,
    LAST_VALUE(o.TotalAmount) OVER (
        PARTITION BY o.CustomerID ORDER BY o.OrderDate
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS TrueLastOrderAmount,
    LAST_VALUE(o.TotalAmount) OVER (
        PARTITION BY o.CustomerID ORDER BY o.OrderDate
    ) AS BuggyLastOrderAmount -- default frame: equals current row's own value, NOT the partition's last row
FROM Orders o;
```

### 3. Explain the Query
`FIRST_VALUE` with `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` correctly returns the customer's first-ever order amount for every row, because "first row of the frame" and "first row of the partition" coincide once the frame's lower bound is unbounded. `TrueLastOrderAmount` explicitly extends the frame's upper bound to `UNBOUNDED FOLLOWING`, so every row in the partition sees the same, genuinely-last value. `BuggyLastOrderAmount` uses the implicit default frame (`RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`), so `LAST_VALUE` degenerates to "the last row of everything up to and including me" — i.e., my own value.

### 4. Sample Data
| OrderID | CustomerID | OrderDate | TotalAmount |
|---|---|---|---|
| 1 | 500 | 2026-01-01 | 40 |
| 2 | 500 | 2026-02-01 | 70 |
| 3 | 500 | 2026-03-01 | 55 |

### 5. Expected Output
| OrderID | FirstOrderAmount | TrueLastOrderAmount | BuggyLastOrderAmount |
|---|---|---|---|
| 1 | 40 | 55 | 40 |
| 2 | 40 | 55 | 70 |
| 3 | 40 | 55 | 55 |

`BuggyLastOrderAmount` just mirrors `TotalAmount` for every row — the tell-tale symptom of the missing-frame bug.

### 6. Alternative Solutions
- **`MAX(OrderDate) OVER (...)` joined back to the row with that date**, or a second `FIRST_VALUE` on a `DESC`-ordered window (`FIRST_VALUE(TotalAmount) OVER (PARTITION BY CustomerID ORDER BY OrderDate DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`) — this sidesteps the frame gotcha entirely by flipping the sort direction so "first" in reverse order equals "last" in forward order; many teams standardize on this pattern specifically to avoid the `LAST_VALUE` frame trap.
- **`MAX(TotalAmount) OVER (...)` when "last" and "max" happen to coincide** — only valid if you actually want the maximum, not the chronologically last value; don't conflate the two.
- **Preferred:** explicit `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING` on `LAST_VALUE` when you must use it, but many teams prefer the reversed-`FIRST_VALUE` pattern precisely because it can't silently regress if someone edits the query later and drops the frame clause.

### 7. Performance
Widening the frame to `UNBOUNDED FOLLOWING` forces SQL Server to materialize more of the partition before it can emit a row (it can't stream row-by-row once the answer for row 1 depends on the very last row), which typically shows up as a **Window Spool** operator in the execution plan buffering rows in tempdb-backed workfiles for large partitions — check actual execution plans (never assume) via [Display an Actual Execution Plan](https://learn.microsoft.com/en-us/sql/relational-databases/performance/display-an-actual-execution-plan). The default-frame form (no spool needed) is cheaper precisely because it can stream, which is part of why the trap exists — the "wrong" form is also the faster-looking one until you check the output.

### 8. Edge Cases
- **The default-frame bug itself** — the most important edge case is realizing the default frame silently changes `LAST_VALUE`'s meaning; this is not a rare corner case, it's the modal way this function is used incorrectly.
- **NULLs in the value column:** both functions support `IGNORE NULLS`/`RESPECT NULLS` (the default) as of the versions documented for `FIRST_VALUE`/`LAST_VALUE` — decide explicitly whether a NULL should "count" as the first/last value or be skipped.
- **Ties in ORDER BY:** with `RANGE` framing, tied rows are treated as part of the same peer group and share frame boundaries in ways `ROWS` framing does not — another reason to default to `ROWS` unless you specifically need `RANGE` semantics.

### 9. Production Scenario
Customer-360 dashboards use `FIRST_VALUE`/corrected `LAST_VALUE` to show "first order" and "most recent order" columns per customer in a single pass instead of two separate correlated-subquery columns; this exact frame bug has shipped to production more than once in reporting tools where a "most recent status" column quietly degenerated into "current row's own status."

### 10. Interview Follow-ups
1. What is the default window frame when `ORDER BY` is present but no frame clause is written?
2. Why does `FIRST_VALUE` "just work" without an explicit frame but `LAST_VALUE` doesn't?
3. What's the performance trade-off of widening the frame to `UNBOUNDED FOLLOWING`?
4. How would you write this using `MAX`/reversed `FIRST_VALUE` instead, and why might a team prefer that?
5. Does `RANGE` vs `ROWS` change the answer here?

### 11. Follow-up Answers
1. `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` — per the [OVER Clause documentation](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql).
2. Because "first row up to and including me" and "first row of the whole partition" are the same thing for every row when the frame's lower bound is unbounded — the default frame happens to be correct for `FIRST_VALUE` by coincidence, not because `FIRST_VALUE` is special-cased. `LAST_VALUE`'s upper bound in the default frame is `CURRENT ROW`, which is never the partition's true last row except for the literal last row itself.
3. It prevents the engine from streaming output row-by-row for that window, typically introducing a spool/buffering step that holds the full partition (or a running window) in memory/tempdb — costlier on wide partitions, though for realistic partition sizes (per-customer, per-account) it's rarely the dominant cost in the query.
4. `FIRST_VALUE(TotalAmount) OVER (PARTITION BY CustomerID ORDER BY OrderDate DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)` — some teams prefer this because it can't regress silently: there is no "default frame that happens to look plausible" failure mode the way there is with `LAST_VALUE`.
5. Only if there are ties on the ordering column and you want peer rows to share a frame boundary — `RANGE` groups ties together for frame purposes, `ROWS` treats every physical row independently regardless of ties. For most business queries with a unique or near-unique ordering key, `ROWS` is the safer, more predictable default.

### 12. Common Mistakes
- Using `LAST_VALUE` with no frame clause and trusting the result without checking it against a known-correct row.
- Assuming `FIRST_VALUE`/`LAST_VALUE` and `MIN`/`MAX` are interchangeable — they answer different questions ("value at this position in this order" vs. "extreme value regardless of order").
- Not deciding explicitly on `IGNORE NULLS` behavior when the value column can be NULL.

### 13. Architect Insight
This single gotcha is a favorite Architect-tier interview trap for exactly the reason shown above: the buggy query returns plausible-looking, non-erroring output, so it survives code review unless the reviewer specifically knows to check the frame clause. An excellent answer doesn't just fix the query — it explains *why* it was wrong in a way that would let a reviewer catch the same bug in a completely different query next month.

---

## Q59. SUM() OVER()/AVG() OVER() — running totals and moving averages, the basics

**Difficulty:** 🟢

### 1. Interview Answer
Any aggregate function (`SUM`, `AVG`, `COUNT`, `MIN`, `MAX`) becomes a window function the moment you add an `OVER()` clause — it computes the aggregate over a window of rows *per row* instead of collapsing the result set into one row per group the way `GROUP BY` does. `SUM(Amount) OVER (PARTITION BY AccountID ORDER BY CreatedAt ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)` is the canonical running-total pattern: for each row, sum everything from the start of the partition through the current row.

### 2. SQL Query
```sql
SELECT
    t.AccountID,
    t.CreatedAt,
    t.Amount,
    SUM(t.Amount) OVER (
        PARTITION BY t.AccountID ORDER BY t.CreatedAt
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS RunningTotal,
    AVG(t.Amount) OVER (PARTITION BY t.AccountID) AS AccountAvgAmount
FROM Transactions t;
```

### 3. Explain the Query
`RunningTotal` sums `Amount` from the first row of each account's partition through the current row, producing a cumulative balance-style column. `AccountAvgAmount` has no `ORDER BY` and no frame clause, so its frame is the *entire partition* (the default when there's no `ORDER BY` is the whole partition, not a running frame) — every row for a given account shows that account's overall average transaction amount, unchanged row to row.

### 4. Sample Data
| AccountID | CreatedAt | Amount |
|---|---|---|
| 1 | 2026-01-01 | 100 |
| 1 | 2026-01-03 | 50 |
| 1 | 2026-01-05 | 25 |

### 5. Expected Output
| AccountID | CreatedAt | Amount | RunningTotal | AccountAvgAmount |
|---|---|---|---|---|
| 1 | 2026-01-01 | 100 | 100 | 58.33 |
| 1 | 2026-01-03 | 50 | 150 | 58.33 |
| 1 | 2026-01-05 | 25 | 175 | 58.33 |

### 6. Alternative Solutions
- **Correlated subquery:** `SELECT SUM(Amount) FROM Transactions t2 WHERE t2.AccountID = t.AccountID AND t2.CreatedAt <= t.CreatedAt` — correct, but re-scans/re-aggregates per outer row (O(n²) without a supporting index-assisted seek pattern per row).
- **Cursor/while-loop accumulator** — see Q62 for the full comparison; strictly worse for set-based workloads.
- **Preferred:** the window-function form — one sorted pass, one running accumulator maintained by the engine.

### 7. Performance
A running total's frame (`ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`) is the cheap, streamable case: SQL Server can maintain a single accumulator while scanning the sorted partition in one direction, no spool required, as long as an index supplies the `(PARTITION BY, ORDER BY)` order. The whole-partition frame (no `ORDER BY`, like `AccountAvgAmount`) is also cheap — it's computed once per partition and broadcast to every row.

### 8. Edge Cases
- **NULL amounts:** `SUM`/`AVG` ignore NULLs the same way they do outside window functions — a NULL doesn't zero out or break the running total, it's simply skipped, which can surprise people expecting NULL propagation.
- **Ties in ORDER BY with `RANGE` framing:** switch to `ROWS` explicitly if you need "one row at a time" accumulation rather than "all tied rows advance the total together."
- **Negative amounts (refunds/reversals):** running totals correctly go down — verify the business logic actually wants a signed running total vs. a running total of absolute values.

### 9. Production Scenario
Running account balances in a ledger view (`RunningTotal` per account), inventory-on-hand-after-each-movement reports, and cumulative revenue-to-date dashboards are all the same pattern as this query.

### 10. Interview Follow-ups
1. What's the default frame when there's an `ORDER BY` but no explicit `ROWS`/`RANGE` clause on a `SUM() OVER()`?
2. Why is `AccountAvgAmount` the same value on every row instead of changing per row?
3. How would you compute a running total that resets each calendar month?
4. Would you ever store a running total instead of computing it on every read?

### 11. Follow-up Answers
1. `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` — which, unlike `LAST_VALUE`'s case, happens to be exactly what most people want for a running total, so `SUM(x) OVER (ORDER BY y)` "just works" without an explicit frame — but it's good practice to write the frame explicitly anyway so the query's intent doesn't depend on memorizing the default.
2. Because there's no `ORDER BY` inside that `OVER()`, so the frame is the entire partition for every row — there's no "current row" position to accumulate up to.
3. Add the month to the `PARTITION BY`: `PARTITION BY AccountID, DATEFROMPARTS(YEAR(CreatedAt), MONTH(CreatedAt), 1) ORDER BY CreatedAt ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`.
4. Yes, in a canonical ledger table you typically store the actual `Balance` after each transaction (a materialized running total) rather than recomputing it from scratch on every read, precisely because recomputing a running total over a full transaction history doesn't scale — see [[14-SQL-and-FinTech]] Q138 for the trade-offs of stored vs. computed balances.

### 12. Common Mistakes
- Confusing the "whole partition" default frame (no `ORDER BY`) with the "running" default frame (with `ORDER BY`) — they're genuinely different defaults and easy to mix up.
- Forgetting `PARTITION BY` when the running total should reset per group, producing one giant running total across all accounts.
- Assuming a running total window function scales identically regardless of whether a supporting index exists — it doesn't; see Q62's performance discussion.

### 13. Architect Insight
Knowing which frame is the *default* in which situation (with vs. without `ORDER BY`) — rather than always writing it out explicitly out of habit without understanding why — signals genuine command of the feature rather than pattern-matching from a code snippet found online.

---

## Q60. PARTITION BY mechanics and combining with ORDER BY

**Difficulty:** 🟡

### 1. Interview Answer
`PARTITION BY` divides the query's result set into independent groups before any window function is applied — each group is processed as if it were its own mini result set, and the window function's output for one partition never depends on rows in another partition. `ORDER BY` inside the same `OVER()` clause then defines the sequence of rows *within* each partition, which matters for ranking functions, `LAG`/`LEAD`, and running-total-style aggregate frames, but is irrelevant for whole-partition aggregates (Q59's `AccountAvgAmount`). The two clauses are independent and optional in different combinations: `PARTITION BY` alone (whole-partition aggregate), `ORDER BY` alone (single global partition, sequenced), or both together (per-group sequencing) — but a plain `GROUP BY` cannot express "sequenced within group" the way `PARTITION BY … ORDER BY` can, and that's precisely why window functions exist alongside `GROUP BY` rather than replacing it.

### 2. SQL Query
```sql
SELECT
    o.CustomerID,
    o.OrderID,
    o.OrderDate,
    o.TotalAmount,
    COUNT(*)  OVER (PARTITION BY o.CustomerID) AS TotalOrdersForCustomer,
    SUM(o.TotalAmount) OVER (PARTITION BY o.CustomerID) AS CustomerLifetimeSpend,
    ROW_NUMBER() OVER (PARTITION BY o.CustomerID ORDER BY o.OrderDate) AS OrderSequenceNumber
FROM Orders o;
```

### 3. Explain the Query
`TotalOrdersForCustomer` and `CustomerLifetimeSpend` use `PARTITION BY` with no `ORDER BY` — every row for a given customer shows the same value, computed once over the whole partition. `OrderSequenceNumber` adds `ORDER BY OrderDate` to the same partitioning, producing a per-customer 1, 2, 3… sequence. All three window functions execute over the same base row set without collapsing rows the way a `GROUP BY` would — the original `OrderID`-level detail survives alongside the aggregated context.

### 4. Sample Data / 5. Expected Output
For customer 500 with 3 orders totaling 165: every row for customer 500 shows `TotalOrdersForCustomer = 3` and `CustomerLifetimeSpend = 165`, while `OrderSequenceNumber` increments 1, 2, 3 by `OrderDate`.

### 6. Alternative Solutions
- **`GROUP BY` + join back to the detail table:** `SELECT CustomerID, COUNT(*), SUM(TotalAmount) FROM Orders GROUP BY CustomerID` then join the aggregate back to `Orders` on `CustomerID` — functionally equivalent to the whole-partition window aggregate, but requires two logical passes (an aggregation query plus a join) instead of one.
- **Preferred:** the window-function form when you need row-level detail *and* group-level context in the same result set (the classic "% of group total" or "count of siblings" pattern) — it's both simpler to write and typically cheaper than aggregate-then-join because the optimizer can compute it in one pass with a single sort/segment.

### 7. Performance
An index on `(CustomerID, OrderDate)` supports both the partition-only aggregates and the ordered `ROW_NUMBER` in a single sort. Whole-partition aggregates (no `ORDER BY`) are computed once per distinct partition value and broadcast — cheap. Adding `ORDER BY` to the same partitioning doesn't require a second sort if the two window functions share a compatible sort order; the optimizer can reuse one sort for multiple `OVER()` clauses with the same `(PARTITION BY, ORDER BY)` shape.

### 8. Edge Cases
- **Multiple different `PARTITION BY`/`ORDER BY` shapes in one query:** each distinct shape may require its own sort — four window functions with four different partition/order combinations can mean four sorts, which is a real performance cliff worth watching for in generated reporting SQL.
- **NULL partitioning key:** all NULLs group into a single partition together (NULL is treated as equal to NULL for grouping/partitioning purposes, unlike in equality comparisons).

### 9. Production Scenario
"Show me each order alongside this customer's total order count and lifetime spend" is one of the most common reporting-query shapes in e-commerce/CRM systems, and doing it with `GROUP BY` + join is the most common unnecessary-complexity mistake junior developers make when they haven't internalized that window functions solve this directly.

### 10. Interview Follow-ups
1. Why can you see both `OrderID`-level detail and `CustomerID`-level aggregates in the same row, when `GROUP BY` would force you to choose one or the other?
2. If a query has three window functions with three different `PARTITION BY` clauses, how many sorts does the plan need?
3. How does `PARTITION BY` treat NULL values in the partitioning column?

### 11. Follow-up Answers
1. Because window functions don't collapse the row set the way `GROUP BY` does — the aggregate is computed *per partition* but *emitted per row*, so every original row survives with the group-level number attached.
2. Potentially three separate sorts if the shapes are genuinely incompatible — check the actual execution plan for repeated **Sort** operators; this is a real, checkable cost, not a theoretical one, and consolidating queries to share a `PARTITION BY`/`ORDER BY` shape where the business logic allows is a legitimate tuning technique.
3. NULLs are grouped together into one partition (equivalent to `GROUP BY` semantics), which differs from how NULL behaves in equality predicates (`NULL = NULL` is unknown, not true) — a common point of confusion.

### 12. Common Mistakes
- Writing an aggregate-then-join query out of habit when a single window-function query would be simpler and often faster.
- Not noticing that a report has accumulated several *different* `PARTITION BY`/`ORDER BY` shapes over time (each added by a different developer), multiplying the number of sorts in the plan.

### 13. Architect Insight
Recognizing "detail rows plus group-level context in the same row" as the signature use case for window functions — and reflexively reaching for one query instead of an aggregate-subquery-plus-join — is one of the fastest tells that a candidate has really used this feature in production reporting code, not just read about it.

---

## Q61. Frame specification deep dive — ROWS vs RANGE

**Difficulty:** 🔥

### 1. Interview Answer
The frame clause (`ROWS BETWEEN … AND …` or `RANGE BETWEEN … AND …`) defines exactly which rows, relative to the current row, participate in an aggregate/`FIRST_VALUE`/`LAST_VALUE` window function. `ROWS` counts **physical rows** — "2 rows before me" means exactly two rows, full stop. `RANGE` counts **logical peer groups** based on the `ORDER BY` value — "everything with an ORDER BY value in this range" — which means rows *tied* on the ordering expression are treated as a single unit that enters or leaves the frame together, not one at a time. This difference is invisible when the `ORDER BY` column is unique, and becomes a correctness bug the moment it isn't.

### 2. SQL Query
```sql
-- ROWS: exactly 2 physical rows back, regardless of ties
SELECT
    o.OrderDate, o.TotalAmount,
    SUM(o.TotalAmount) OVER (
        ORDER BY o.OrderDate
        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
    ) AS Sum_RowsFrame,
    -- RANGE: every row sharing the current row's OrderDate value moves together
    SUM(o.TotalAmount) OVER (
        ORDER BY o.OrderDate
        RANGE BETWEEN 2 PRECEDING AND CURRENT ROW
    ) AS Sum_RangeFrame
FROM Orders o
WHERE o.CustomerID = 500;
```
(`RANGE` with a numeric offset like `2 PRECEDING` requires the `ORDER BY` column to support arithmetic offsets and has narrower support than `ROWS`; the more common `RANGE` usage in practice is the default `UNBOUNDED PRECEDING AND CURRENT ROW`, shown in Q58/Q59.)

### 3. Explain the Query
For `Sum_RowsFrame`, the frame always contains exactly 3 physical rows (current + 2 preceding), no matter what their `OrderDate` values are — even if two of those rows happen to share the same date. For `Sum_RangeFrame`, if multiple orders share the exact same `OrderDate`, `RANGE` pulls in **all** of them as a single peer group rather than counting them as separate positions — so the two frames can produce different sums whenever ties exist on the ordering column.

### 4. Sample Data
| OrderDate | TotalAmount |
|---|---|
| 2026-01-01 | 10 |
| 2026-01-01 | 20 |
| 2026-01-02 | 30 |

### 5. Expected Output
For the `2026-01-02` row: `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW` sums exactly the 3 physical rows shown = 60. `RANGE BETWEEN 2 PRECEDING AND CURRENT ROW` on a date column behaves per SQL Server's peer-group rule for ties — both `2026-01-01` rows are one peer group — the practical, safe takeaway is: **don't use `RANGE` with a non-unique `ORDER BY` unless you've deliberately verified the peer-group behavior is what you want.**

### 6. Alternative Solutions
- **Default to `ROWS` everywhere unless you specifically need peer-group semantics** — this is the pragmatic, widely-recommended stance precisely because `ROWS` behavior is predictable regardless of duplicate ordering values, while `RANGE` behavior silently changes when duplicates appear.
- **Add a unique tiebreaker to the `ORDER BY`** (e.g., `ORDER BY OrderDate, OrderID`) so `RANGE` and `ROWS` coincide — valid, but you must remember to do it consistently everywhere `RANGE` is used.

### 7. Performance
`ROWS` frames are generally cheaper to evaluate because the engine only needs a fixed physical offset; `RANGE` frames with ties may require additional comparison work to identify peer-group boundaries. Neither is dramatically more expensive in isolation for typical BETWEEN-bounded windows, but `RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING` (as seen with `LAST_VALUE` fixes) forces the same spool/buffering behavior discussed in Q58 regardless of `ROWS` vs `RANGE`.

### 8. Edge Cases
- **Unique ORDER BY column:** `ROWS` and `RANGE` produce identical results — this is exactly why the difference goes unnoticed until a duplicate value shows up in production data that didn't exist in test data.
- **RANGE with non-integer offsets:** SQL Server's support for `RANGE BETWEEN n PRECEDING/FOLLOWING` with arbitrary data types is narrower than `ROWS` — verify support for your specific column type against the [OVER Clause documentation](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql) before relying on it.
- **Default frame ambiguity:** as shown in Q58, omitting the frame clause entirely defaults to `RANGE`, not `ROWS` — another reason to write frames explicitly.

### 9. Production Scenario
Time-series aggregations (e.g., "sum of transactions in the same second/minute bucket") are exactly where `RANGE`'s peer-group semantics either save you from writing custom tie-handling logic — or silently produce a different-than-expected sum if you assumed `ROWS`-like fixed-count behavior.

### 10. Interview Follow-ups
1. If the `ORDER BY` column is unique, does it matter whether you write `ROWS` or `RANGE`?
2. What's the default frame type when no frame clause is specified at all?
3. Why might `RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING` and `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING` produce the same result even with ties, while their `CURRENT ROW`-bounded versions don't?

### 11. Follow-up Answers
1. No — with a unique ordering column there are no peer groups, so `ROWS` and `RANGE` are equivalent. This is precisely why the distinction is a favorite "gotcha" question: it's invisible until production data contains a duplicate the test data didn't.
2. `RANGE`, per the OVER clause specification — not `ROWS`. This is a widely-missed detail even among experienced developers.
3. Because "unbounded on both sides" always includes the entire partition regardless of how ties are grouped — there's no boundary sitting in the middle of a peer group for the tie-handling rule to matter. The difference only shows up when a frame boundary (like `CURRENT ROW`) can land in the middle of a set of tied rows.

### 12. Common Mistakes
- Treating `ROWS` and `RANGE` as interchangeable syntax variants rather than genuinely different semantics.
- Using `RANGE` with a non-unique `ORDER BY` column without realizing peer rows move together.
- Never explicitly writing the frame clause and relying on an unexamined default.

### 13. Architect Insight
This is one of the highest-value "explain a subtlety, not just a syntax" questions in the whole T-SQL surface area — an Architect-level answer walks through a concrete tie scenario with numbers, the way this answer just did, rather than reciting "ROWS is physical, RANGE is logical" as a memorized one-liner without being able to produce an example where it actually changes the output.

---

## Q62. Running totals — window function vs. cursor/while-loop, and why the window function wins

**Difficulty:** 🔴

### 1. Interview Answer
A cursor or `WHILE` loop computing a running total processes one row at a time, in application-like procedural style, inside the database engine — each iteration is a separate logical operation with its own overhead (fetch, variable assignment, loop control), and SQL Server's optimizer has no opportunity to apply set-based optimizations because there's no single query for it to optimize. The window-function form expresses the same computation as one declarative query; the engine sorts once and maintains a running accumulator internally while streaming through the sorted rows — a single, tight, compiled operation instead of thousands/millions of individually-dispatched loop iterations. On non-trivial row counts (tens of thousands of rows and up), the gap is typically an order of magnitude or more in favor of the window function, and the gap widens with row count because the cursor's per-row overhead is constant while the window function's per-row cost is closer to a memory-bandwidth-bound accumulator update.

### 2. SQL Query
```sql
-- Window-function running total (preferred)
SELECT
    t.AccountID, t.CreatedAt, t.Amount,
    SUM(t.Amount) OVER (
        PARTITION BY t.AccountID ORDER BY t.CreatedAt
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS RunningTotal
FROM Transactions t;

-- Cursor-based equivalent (shown to contrast, not recommended)
DECLARE @AccountID INT, @Amount DECIMAL(18,2), @RunningTotal DECIMAL(18,2) = 0, @PrevAccount INT = NULL;
DECLARE txn_cursor CURSOR FAST_FORWARD FOR
    SELECT AccountID, Amount FROM Transactions ORDER BY AccountID, CreatedAt;
OPEN txn_cursor;
FETCH NEXT FROM txn_cursor INTO @AccountID, @Amount;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF @PrevAccount IS NULL OR @AccountID <> @PrevAccount SET @RunningTotal = 0;
    SET @RunningTotal += @Amount;
    -- ... write @RunningTotal somewhere, e.g. into a temp table ...
    SET @PrevAccount = @AccountID;
    FETCH NEXT FROM txn_cursor INTO @AccountID, @Amount;
END
CLOSE txn_cursor; DEALLOCATE txn_cursor;
```

### 3. Explain the Query
The window-function version is a single query: one sort (or an index-supplied order), one pass, one accumulator maintained internally by the engine per partition. The cursor version explicitly re-implements exactly the same accumulator logic — but does it through repeated `FETCH`/`WHILE` round trips inside the engine's row-at-a-time execution mode, each with its own overhead, and requires manual partition-reset logic (`IF @AccountID <> @PrevAccount`) that the window function gets for free from `PARTITION BY`.

### 4. Sample Data / 5. Expected Output
Same as Q59 — both approaches must produce identical `RunningTotal` values; the difference is entirely in execution strategy and cost, not correctness (when the cursor logic is written correctly).

### 6. Alternative Solutions
- **`SQLCLR` or application-side loop:** even worse — now you're paying network round-trip or CLR-transition overhead per row on top of the same fundamental row-at-a-time problem.
- **Recursive CTE accumulator:** technically set-based syntax but executes iteratively under the hood for this kind of running-sum pattern and doesn't outperform the window-function form; mostly of academic interest here.
- **Preferred:** the window function, without qualification, for this problem shape.

### 7. Performance
The window-function form's cost is dominated by the sort (or avoided entirely with a matching index) plus a linear accumulator pass — verify with `SET STATISTICS TIME/IO ON` and an actual execution plan rather than assuming. The cursor form's cost is dominated by per-row engine-loop overhead that scales linearly with row count *with a much larger constant factor* than the window function's per-row cost, and it also defeats parallelism — cursors (other than `FAST_FORWARD` in specific limited scenarios) generally force serial execution, while the window-function query can potentially use a parallel plan for the sort and partition-local accumulation.

### 8. Edge Cases
- **Very large partitions:** the window-function running total still requires the full partition to be sorted, but doesn't require the full partition to be *resident* the way `LAST_VALUE`'s unbounded-following frame does — a `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` frame can stream.
- **Cursor resource leaks:** a cursor left `OPEN` without `CLOSE`/`DEALLOCATE` on an error path holds server-side resources — another operational risk the set-based form simply doesn't have.

### 9. Production Scenario
Legacy stored procedures inherited from earlier SQL Server eras (pre-2012, before `SUM() OVER()` supported frame clauses broadly) sometimes still contain cursor-based running-total logic; a common, high-value modernization task in a Principal/Staff role is identifying and replacing exactly this pattern, with a measured before/after performance comparison to justify the change to stakeholders.

### 10. Interview Follow-ups
1. Why do cursors typically prevent parallel execution?
2. Is there ever a legitimate reason to use a cursor over a window function for this kind of problem?
3. How would you measure and prove the performance difference to a skeptical reviewer?
4. What SQL Server version introduced the frame-clause-capable `SUM() OVER()` that makes this pattern possible?

### 11. Follow-up Answers
1. Cursors process rows one at a time with server-side state carried between fetches (the current position, local variables) — that sequential, stateful iteration model is fundamentally incompatible with dividing the work across parallel threads, so the optimizer falls back to serial execution for cursor-driven logic.
2. Rarely, for this specific problem shape. Cursors remain occasionally justified for genuinely procedural administrative tasks (e.g., iterating over a small list of databases to run `DBCC` commands) where there's no meaningful set-based equivalent — but "compute a running total" is not one of those cases.
3. Wrap both approaches with `SET STATISTICS TIME, IO ON`, run each against representative data volumes (not a tiny dev sample), capture actual elapsed time/CPU/logical reads, and present the comparison — never assert a performance claim without a measured number attached.
4. Full frame-clause support for `ROWS`/`RANGE` in aggregate window functions arrived in SQL Server 2012, alongside `LAG`/`LEAD`/`FIRST_VALUE`/`LAST_VALUE` — before that, computing a true running total needed either a correlated subquery or exactly this kind of cursor/loop workaround, which is the historical reason the anti-pattern exists in older codebases.

### 12. Common Mistakes
- Keeping inherited cursor-based logic "because it works" without recognizing it as a modernization opportunity once frame-clause window functions are available.
- Rewriting a cursor to a window function without validating the output matches on a full data set (partition-reset bugs are easy to introduce in the cursor version, and comparing against it as a baseline can propagate the bug).

### 13. Architect Insight
A Staff/Principal-level answer doesn't just say "window functions are faster" — it explains the structural reason why (set-based single-pass execution vs. per-row engine-loop overhead, parallelism eligibility), and it insists on measuring rather than asserting, which is exactly the discipline expected when justifying a migration to a skeptical team or a change-review board in a regulated environment.

---

## Q63. N-day moving average implementation

**Difficulty:** 🟡

### 1. Interview Answer
A moving (rolling) average over the last N periods is a frame-based aggregate window function where the frame explicitly spans exactly N rows: `AVG(x) OVER (ORDER BY date_col ROWS BETWEEN N-1 PRECEDING AND CURRENT ROW)`. Unlike a running total (unbounded lower bound), a moving average's lower bound moves forward with the current row, keeping the window a constant size once there are at least N rows.

### 2. SQL Query
```sql
SELECT
    d.TradeDate,
    d.ClosingPrice,
    AVG(d.ClosingPrice) OVER (
        ORDER BY d.TradeDate
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) AS MovingAvg_7Day
FROM DailyPrices d
ORDER BY d.TradeDate;
```

### 3. Explain the Query
`ROWS BETWEEN 6 PRECEDING AND CURRENT ROW` defines a 7-row window (6 before + the current row) that slides forward one row at a time as `TradeDate` advances. For the first 6 rows in the series, the frame simply can't reach back 6 rows, so SQL Server uses however many rows *are* available (rows 1 through the current row) — the average is still computed, just over a smaller-than-7 window, not an error and not NULL.

### 4. Sample Data
10 consecutive daily closing prices for one instrument.

### 5. Expected Output
Row 1's moving average equals its own closing price (only 1 row available); row 7 onward reflects a true trailing 7-day average.

### 6. Alternative Solutions
- **Self-join on a date range** (`JOIN DailyPrices d2 ON d2.TradeDate BETWEEN DATEADD(DAY,-6,d.TradeDate) AND d.TradeDate`) — works for genuinely gap-free calendar-day data, but breaks silently if trading days have gaps (weekends/holidays) unless you're careful; also more expensive than the row-based frame.
- **Preferred:** the `ROWS BETWEEN N-1 PRECEDING AND CURRENT ROW` frame — it's period-count-based (last 7 *rows*), which is almost always what "N-day moving average" means in financial/trading contexts (7 trading days, not 7 calendar days) and matches how the term is used in the [Pragmatic Engineer / trading-systems literature referenced elsewhere in this course's System Design material].

### 7. Performance
Same cost profile as any `ORDER BY`-based window aggregate — an index matching the ordering avoids an explicit sort. A bounded frame (fixed N rows) is cheaper to maintain than an unbounded running total in principle (the accumulator can drop the row leaving the window as well as add the row entering it), though SQL Server's actual implementation details for frame maintenance aren't something to assert precisely without checking the current execution plan/operator behavior for your version.

### 8. Edge Cases
- **Gaps in the date series (e.g., a missing trading day):** a `ROWS`-based frame silently uses whatever 7 rows exist, which may span more than 7 *calendar* days if there are gaps — decide explicitly whether "7 rows" or "7 calendar days" is the actual requirement (the latter needs `RANGE` with a date interval, or a calendar-spine join).
- **Fewer than N rows total:** produces a valid, smaller-window average rather than an error or NULL, which can be surprising if the caller expected NULL until a full N-row window is available — add an explicit `CASE WHEN ROW_NUMBER() OVER (...) < N THEN NULL ELSE AVG(...) OVER (...) END` if partial-window averages shouldn't be shown.
- **Multiple instruments in one query:** always partition by instrument (`PARTITION BY InstrumentID`) — a moving average that accidentally blends two instruments' prices is a serious, easy-to-miss correctness bug.

### 9. Production Scenario
Technical-analysis features in trading platforms (7/50/200-day moving averages), smoothing noisy daily operational metrics (error rates, latency) before alerting on them, and detecting trend changes by comparing a short-window moving average against a long-window one (a "golden cross"/"death cross"-style signal) are all this exact pattern.

### 10. Interview Follow-ups
1. What happens for the first few rows where a full N-row window isn't available yet?
2. How would you make this a true "7 calendar day" average instead of "last 7 rows," in the presence of gaps?
3. How would you compute two moving averages of different window sizes in the same query to detect a crossover?

### 11. Follow-up Answers
1. SQL Server computes the average over whatever rows are actually available within the frame boundary — not an error, not NULL. Whether that's the desired behavior is a business decision, not a technical limitation, and should be made explicit in the query (see Edge Cases).
2. Either join against a generated calendar-spine table so every calendar day has a row (with NULL/forward-filled prices for non-trading days) before applying the `ROWS`-based frame, or use `RANGE BETWEEN INTERVAL '6' DAY PRECEDING AND CURRENT ROW`-style date-range framing where supported — T-SQL's native `RANGE` support for date offsets is limited, so the calendar-spine join is the more portable, reliable approach in SQL Server specifically.
3. Compute both in the same `SELECT` with two differently-sized frames (`ROWS BETWEEN 6 PRECEDING…` and `ROWS BETWEEN 49 PRECEDING…`) as separate columns, then compare them (or their difference/sign change) in the same query or a wrapping query — no need for two separate queries or a self-join.

### 12. Common Mistakes
- Confusing "N rows" with "N calendar days" when the underlying data has gaps.
- Forgetting `PARTITION BY` when the source table holds multiple series (instruments, accounts, sensors) and computing one blended moving average across all of them.
- Not deciding what should happen for the warm-up period before N rows exist.

### 13. Architect Insight
The interviewer is watching for whether the candidate proactively raises the gap-handling and warm-up-period questions unprompted — those are exactly the details that separate "I can write `AVG() OVER()`" from "I've actually shipped a moving-average feature and hit these issues in real data."

---

## Q64. Window functions vs. GROUP BY — when each is the right tool

**Difficulty:** 🟢

### 1. Interview Answer
`GROUP BY` collapses a result set into one row per group — you lose row-level detail by design, and can only select the grouping columns plus aggregates. Window functions compute an aggregate (or ranking/offset value) *per row* while preserving every original row — you keep row-level detail *and* group-level context side by side. Use `GROUP BY` when the answer genuinely is "one row per group" (e.g., "total sales per region"). Use a window function when the answer needs row-level detail annotated with group context (e.g., "each order, plus that customer's total spend"), or when you need something `GROUP BY` structurally cannot express at all — ranking, `LAG`/`LEAD`, or a running total, all of which require an ordering *within* the group that `GROUP BY` has no concept of.

### 2. SQL Query
```sql
-- GROUP BY: one row per department, detail lost
SELECT DepartmentID, AVG(Salary) AS AvgSalary
FROM Employees
GROUP BY DepartmentID;

-- Window function: every employee row retained, annotated with department average
SELECT
    EmployeeID, DepartmentID, Salary,
    AVG(Salary) OVER (PARTITION BY DepartmentID) AS DeptAvgSalary,
    Salary - AVG(Salary) OVER (PARTITION BY DepartmentID) AS DiffFromDeptAvg
FROM Employees;
```

### 3. Explain the Query
The `GROUP BY` query answers "what's the average salary per department" and nothing else — individual employees are gone from the result. The window-function query answers "for each employee, how does their salary compare to their department's average" — it needs every individual row *plus* the group aggregate simultaneously, which is structurally impossible to express with `GROUP BY` alone without a self-join back to the grouped result.

### 4. Sample Data / 5. Expected Output
`GROUP BY` version: 1 row per distinct `DepartmentID`. Window version: 1 row per employee, each showing their own salary alongside their department's average and their own deviation from it.

### 6. Alternative Solutions
- **`GROUP BY` subquery + join:** `SELECT e.*, d.AvgSalary FROM Employees e JOIN (SELECT DepartmentID, AVG(Salary) AS AvgSalary FROM Employees GROUP BY DepartmentID) d ON e.DepartmentID = d.DepartmentID` — produces the same result as the window-function version, but as two logical operations (aggregate, then join) instead of one; the window-function form is simpler to write and typically at least as fast.
- **Preferred:** the window-function form whenever the requirement is "detail row plus group context together."

### 7. Performance
Both approaches ultimately need to compute an aggregate per group; the window-function form generally requires fewer logical operations (no separate join step) and is usually the more efficient plan, though for very simple cases the optimizer may produce comparably-costed plans either way — verify with an actual execution plan rather than assuming one form always wins.

### 8. Edge Cases
- **NULL grouping/partitioning column:** both `GROUP BY` and `PARTITION BY` treat all NULLs as one group — consistent behavior between the two.
- **Combining both in one query:** it's entirely valid to `GROUP BY` for some columns and use window functions over the grouped result (window functions can be applied to the output of a `GROUP BY` when referenced in a later stage, e.g., ranking department averages against each other) — don't assume they're mutually exclusive within a single overall query.

### 9. Production Scenario
"Each transaction alongside this account's running balance and this account's overall average transaction size" is a single window-function query; "total transaction volume by account" for a settlement report is a single `GROUP BY` query — recognizing which shape a requirement actually calls for, on first read, is a basic but frequently-tested fluency check.

### 10. Interview Follow-ups
1. Can you use a window function on top of an already-`GROUP BY`'d result set?
2. Why can't `GROUP BY` alone express `ROW_NUMBER`-style per-row sequencing within a group?
3. Given a requirement, how do you decide in 5 seconds whether it needs `GROUP BY` or a window function?

### 11. Follow-up Answers
1. Yes — write the `GROUP BY` in a CTE/derived table, then apply window functions (e.g., `RANK() OVER (ORDER BY AvgSalary DESC)`) in the outer query to rank the *groups* against each other.
2. Because `GROUP BY` has no concept of row order within a group at all — it aggregates the whole group into one value. `ROW_NUMBER`/`LAG`/`LEAD` fundamentally require a defined sequence of rows within the group, which is exactly what `PARTITION BY … ORDER BY` inside `OVER()` provides and `GROUP BY` structurally cannot.
3. Ask: "does the final output need one row per original entity, or one row per group?" One row per original entity (with group context attached) → window function. One row per group (detail genuinely not needed) → `GROUP BY`.

### 12. Common Mistakes
- Defaulting to `GROUP BY` + self-join out of habit for problems that are a one-line window function.
- Assuming window functions replace `GROUP BY` entirely — they don't; `GROUP BY` is still the right, simpler tool when detail rows genuinely aren't needed in the output.

### 13. Architect Insight
This question is really testing query-shape recognition speed — a Principal Engineer should be able to look at a one-sentence requirement and immediately know which of these two tools (or both, layered) is structurally correct, without trial-and-error. That fluency is what lets a senior engineer review a junior's PR and immediately spot an unnecessary aggregate-subquery-join pattern that a simple window function would replace.

---

## References

1. [Ranking Functions (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/ranking-functions-transact-sql?view=sql-server-ver17) — Microsoft Learn
2. [ROW_NUMBER (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/row-number-transact-sql?view=sql-server-ver17) — Microsoft Learn
3. [RANK (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/rank-transact-sql?view=sql-server-ver16) — Microsoft Learn
4. [DENSE_RANK (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/dense-rank-transact-sql?view=sql-server-ver17) — Microsoft Learn
5. [NTILE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/ntile-transact-sql?view=sql-server-ver17) — Microsoft Learn
6. [LEAD (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/lead-transact-sql?view=sql-server-ver17) — Microsoft Learn
7. [LAG (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/lag-transact-sql?view=sql-server-ver17) — Microsoft Learn
8. [FIRST_VALUE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/first-value-transact-sql?view=sql-server-ver17) — Microsoft Learn
9. [LAST_VALUE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/last-value-transact-sql?view=sql-server-ver17) — Microsoft Learn
10. [OVER Clause (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql?view=sql-server-ver17) — Microsoft Learn
11. [WINDOW (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-window-transact-sql?view=sql-server-ver17) — Microsoft Learn
12. [Execution Plan Overview](https://learn.microsoft.com/en-us/sql/relational-databases/performance/execution-plans?view=sql-server-ver16) — Microsoft Learn
13. [Display an Actual Execution Plan](https://learn.microsoft.com/en-us/sql/relational-databases/performance/display-an-actual-execution-plan?view=sql-server-ver17) — Microsoft Learn
14. [Query Processing Architecture Guide](https://learn.microsoft.com/en-us/sql/relational-databases/query-processing-architecture-guide?view=sql-server-ver17) — Microsoft Learn
