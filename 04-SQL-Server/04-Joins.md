> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: [[03-SQL-Fundamentals]]

# SQL Server Interview Workbook — JOINs

Canonical sample schema used throughout this workbook:

```sql
CREATE TABLE Departments (DepartmentID INT PRIMARY KEY, DepartmentName VARCHAR(50));
CREATE TABLE Employees (
    EmployeeID INT PRIMARY KEY, FirstName VARCHAR(50), LastName VARCHAR(50),
    DepartmentID INT NULL, ManagerID INT NULL, Salary DECIMAL(12,2), HireDate DATE
);
CREATE TABLE Customers (CustomerID INT PRIMARY KEY, CustomerName VARCHAR(100), Country VARCHAR(50));
CREATE TABLE Orders (OrderID INT PRIMARY KEY, CustomerID INT, OrderDate DATE, TotalAmount DECIMAL(12,2));
CREATE TABLE Products (ProductID INT PRIMARY KEY, ProductName VARCHAR(100), CategoryID INT, Price DECIMAL(10,2));
CREATE TABLE OrderItems (OrderItemID INT PRIMARY KEY, OrderID INT, ProductID INT, Quantity INT, UnitPrice DECIMAL(10,2));
```

---

## Q39. Explain INNER JOIN semantics across multiple tables

**Difficulty:** 🟢 Basic

**1. Interview Answer**
An `INNER JOIN` returns only the rows where the join predicate matches on both sides. Chaining `INNER JOIN`s across N tables is a series of pairwise matches evaluated logically left-to-right (the optimizer is free to reorder physically) — if any table in the chain has no matching row for a given key, that entire row disappears from the result. It's a filter, not just a "combine" operation.

**2. SQL Query**
```sql
SELECT e.FirstName, e.LastName, d.DepartmentName, o.OrderID, o.TotalAmount
FROM Employees e
INNER JOIN Departments d ON e.DepartmentID = d.DepartmentID
INNER JOIN Orders o       ON o.CustomerID = e.EmployeeID; -- illustrative cross-entity join
```

**3. Explain the Query**
- `FROM Employees e` establishes the driving row source.
- The first `INNER JOIN` keeps only employees whose `DepartmentID` matches an existing `Departments.DepartmentID` — employees with `DepartmentID = NULL` or an orphaned ID are dropped.
- The second `INNER JOIN` further filters to rows that also have a matching order; an employee with zero orders drops out entirely, even though they survived the first join.
- Each join is logically a Cartesian product of the two inputs followed by a filter on the `ON` predicate — the optimizer implements it as a nested-loop, hash, or merge join (see [[01-Indexing-Query-Execution-Plans]] Q14), never a literal cross product.

**4. Sample Data**
`Employees`: (1, Amy, Chen, 10, NULL, 95000), (2, Raj, Patel, NULL, 1, 88000)
`Departments`: (10, 'Engineering')

**5. Expected Output**
Only Amy Chen's row (department 10 matches); Raj Patel is dropped because `DepartmentID` is `NULL` and `NULL` never equals anything, including another `NULL`, under standard SQL comparison semantics.

**6. Alternative Solutions**
- Old-style comma join with `WHERE` predicates (`FROM Employees e, Departments d WHERE e.DepartmentID = d.DepartmentID`) — semantically identical for inner joins but Microsoft explicitly recommends `ANSI JOIN` syntax because it separates join logic from filter logic and is the only syntax that supports outer joins unambiguously.
- `APPLY` when the second table's rows depend on a computation involving the first (not a plain equality) — covered under window/relational-division problems later in this workbook.
I prefer explicit `ANSI JOIN` syntax always — it's the only form that scales to outer joins without ambiguity and is what every SQL Server query-plan tool assumes.

**7. Performance**
An equality join on `DepartmentID`/`CustomerID` needs a supporting index (ideally the join column as a leading key, or the FK naturally indexed) to get an index seek instead of a scan on the inner input. With good statistics and a selective join key, the optimizer typically picks a nested-loop join for small outer inputs and a hash join for large, unsorted, roughly-equal-sized inputs (see [[01-Indexing-Query-Execution-Plans]] Q14). Chaining many `INNER JOIN`s increases the search space the optimizer must consider for join order — beyond ~8-10 tables, plan compilation time itself can become noticeable.

**8. Edge Cases**
- `NULL` foreign keys never match — they silently vanish from `INNER JOIN` results, which is the #1 source of "why is my row missing" bugs.
- Duplicate keys on either side cause row multiplication (fan-out) — joining a one-to-many relationship without aggregating afterward inflates `SUM()`/`COUNT()` results.
- An empty table on either side of the chain makes the entire result set empty.

**9. Production Scenario**
Reporting queries that join `Orders` → `Customers` → `Region` to produce a sales-by-region dashboard: if `Region` is nullable on newly onboarded customers, an `INNER JOIN` silently drops their revenue from the report — a classic financial-reporting undercount bug that only a `LEFT JOIN` + explicit `NULL` handling catches.

**10. Interview Follow-ups**
1. What's the difference between putting a filter in the `ON` clause vs. the `WHERE` clause for an inner join?
2. How does SQL Server decide the physical join algorithm and order?
3. What happens to an `INNER JOIN` when one side has duplicate keys?
4. Why is comma-join syntax discouraged?
5. How would you detect that an inner join is unintentionally dropping rows?

**11. Follow-up Answers**
1. For `INNER JOIN`, placing a predicate in `ON` vs. `WHERE` produces identical results (both are applied before the row can appear in the output) — but for `LEFT/RIGHT/FULL JOIN` it changes semantics entirely (a `WHERE` filter on the outer side re-filters after the outer join, effectively converting it back into an inner join).
2. The optimizer estimates cardinality from statistics on each table/index, then costs candidate join orders and algorithms (nested loop, hash, merge) using its cost-based model, picking the cheapest plan within its search-time budget — it does not necessarily honor the order you wrote the joins in.
3. Row multiplication: each row on side A that matches N rows on side B produces N output rows. Aggregating (`SUM`, `COUNT`) after such a join without first deduplicating is a very common financial-reporting bug (e.g., an order joined to multiple `OrderItems` inflates `SUM(TotalAmount)` if `TotalAmount` isn't grouped correctly).
4. Comma-join syntax mixes join predicates and filter predicates in one `WHERE` clause, makes accidental cross joins (a forgotten predicate) far easier, and cannot express outer joins in a standard, portable way — ANSI join syntax has been the recommended standard since SQL-92 and is what Microsoft Learn's own examples use.
5. Compare `COUNT(*)` before and after adding a join; if the joined result has fewer or unexpectedly different rows than the driving table, audit for `NULL` keys or join-column mismatches, and confirm expectations against a `LEFT JOIN ... WHERE right.key IS NULL` anti-join query (Q46) to see exactly which rows are being excluded.

**12. Common Mistakes**
- Assuming `INNER JOIN` is a superset operation like a "combine"; it is a filter, and rows disappear silently with no error.
- Forgetting that a `NULL` foreign key is not "unmatched, but included" — it's simply excluded.
- Joining before aggregating on a one-to-many relationship, causing double-counted sums.

**13. Architect Insight**
A senior candidate states the join algorithm trade-offs and cardinality implications unprompted; a Staff/Principal-level candidate additionally reasons about *when a filter belongs in `ON` vs. `WHERE`* for outer joins, and proactively flags the "silent row loss on NULL FK" risk in a financial-reporting context — because in fintech, a silently dropped row in a reconciliation or settlement report is not a bug ticket, it's a regulatory finding.

---

## Q40. LEFT JOIN vs. RIGHT JOIN — when to use each, and why RIGHT JOIN is rare in practice

**Difficulty:** 🟢 Basic

**1. Interview Answer**
`LEFT JOIN` keeps every row from the left (first-named) table, filling unmatched right-side columns with `NULL`. `RIGHT JOIN` is the mirror image — every row from the right table survives. They are logically interchangeable (`A LEFT JOIN B` ≡ `B RIGHT JOIN A` with tables swapped), so `RIGHT JOIN` is rarely used in practice: teams standardize on `LEFT JOIN` and reorder the `FROM`/`JOIN` tables instead, because a codebase mixing both is harder to scan — a reviewer has to track which side is "preserved" per statement instead of always assuming "the first table in FROM."

**2. SQL Query**
```sql
-- Preferred idiom: always LEFT JOIN, put the "keep all rows from" table first
SELECT c.CustomerName, o.OrderID, o.TotalAmount
FROM Customers c
LEFT JOIN Orders o ON o.CustomerID = c.CustomerID;
```

**3. Explain the Query**
Every customer row is preserved regardless of whether they have any orders; for customers with no matching `Orders` row, `o.OrderID` and `o.TotalAmount` return `NULL`. This is the standard shape for "all X, with optional Y" reports (e.g., "all customers, with their most recent order if any").

**4. Sample Data**
`Customers`: (1, 'Acme Corp'), (2, 'Globex')
`Orders`: (100, 1, '2026-01-05', 500.00)

**5. Expected Output**
| CustomerName | OrderID | TotalAmount |
|---|---|---|
| Acme Corp | 100 | 500.00 |
| Globex | NULL | NULL |

**6. Alternative Solutions**
- `RIGHT JOIN Customers c ON o.CustomerID = c.CustomerID FROM Orders o` — functionally identical, stylistically discouraged for the readability reason above.
- `FULL OUTER JOIN` when you need unmatched rows from *both* sides (Q41) — overkill here since only one direction is needed.
Preference: always express intent with `LEFT JOIN` and put the "must keep everything" table first; reserve `FULL OUTER JOIN` for genuine two-sided gap analysis.

**7. Performance**
A `LEFT JOIN`'s outer (preserved) side is typically scanned or seeked based on any filters on it directly; the inner (optional) side benefits from an index on its join column exactly like an inner join — SQL Server still uses nested-loop/hash/merge algorithms, just tracking which rows from the preserved side had no match to null-pad them. A `LEFT JOIN` is not inherently slower than an `INNER JOIN` for equivalent cardinality; the misconception that "outer joins are slow" usually stems from a missing index on the joined column, not the join type itself.

**8. Edge Cases**
- Applying a `WHERE o.TotalAmount > 100` filter after a `LEFT JOIN` silently converts it into an inner join, because rows with `NULL` fail the comparison — the fix is `WHERE o.TotalAmount > 100 OR o.TotalAmount IS NULL`, or move the predicate into the `ON` clause if the intent was to filter which orders qualify for matching (not which customers to keep).
- Duplicate keys on the "optional" side still fan out the preserved row into multiple output rows.

**9. Production Scenario**
A customer-health dashboard listing every active customer with their latest order date (`NULL` meaning "never ordered, flag for outreach") is a textbook `LEFT JOIN` — using `INNER JOIN` there would make churned/never-converted customers invisible from the very report meant to surface them.

**10. Interview Follow-ups**
1. What happens if you add a `WHERE` condition on the right table's column after a `LEFT JOIN`?
2. Is `A LEFT JOIN B` ever *not* equivalent to `B RIGHT JOIN A`?
3. How do you get "customers with no orders" from this shape?
4. Does `LEFT JOIN` guarantee row order?
5. How would you find the most recent order per customer using this join shape?

**11. Follow-up Answers**
1. It re-filters after the outer join executes; any row where the right-side column is `NULL` fails a typical comparison predicate (`> `, `=`, etc. — `NULL` compared to anything is `UNKNOWN`, which `WHERE` treats as false), silently downgrading the `LEFT JOIN` to behave like an `INNER JOIN`. This is one of the most common correctness bugs in production SQL.
2. They're equivalent only if the table order and join predicate are swapped consistently; the *result set* is the same but the physical plan and even column order in `SELECT *` can differ. Semantically, "not equivalent" cases mostly arise from confusing yourself about which table is now "left" after the swap.
3. `SELECT c.* FROM Customers c LEFT JOIN Orders o ON o.CustomerID = c.CustomerID WHERE o.CustomerID IS NULL` (the anti-join pattern, detailed in Q46).
4. No — `LEFT JOIN` (like all relational operators) makes no ordering guarantee without an explicit `ORDER BY`; the optimizer is free to return rows in whatever order its chosen physical operator produces them.
5. Use a window function (`ROW_NUMBER() OVER (PARTITION BY CustomerID ORDER BY OrderDate DESC)`) inside a CTE/derived table, then `LEFT JOIN` to that filtered result — see the Window Functions workbook and Q85 (latest record per customer).

**12. Common Mistakes**
- Filtering on the nullable side in `WHERE` and accidentally collapsing the outer join to an inner join.
- Using `RIGHT JOIN` inconsistently across a codebase, making joins harder to review.
- Forgetting `IS NULL` (vs. `= NULL`, which never matches anything because `NULL` is not "equal" to `NULL` in SQL's three-valued logic) when hunting for unmatched rows.

**13. Architect Insight**
A junior candidate can state the mechanical difference between `LEFT` and `RIGHT`. A senior/architect candidate immediately flags the `WHERE`-clause-collapses-outer-join trap as the single most common production bug pattern in this area, and can explain *why* — three-valued logic (`TRUE`/`FALSE`/`UNKNOWN`) governs `WHERE` filtering, and `UNKNOWN` is treated as "exclude."

**References**
1. [Joins (SQL Server) — Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/performance/joins?view=sql-server-ver17)
2. [FROM clause plus JOIN, APPLY, PIVOT (T-SQL) — Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-transact-sql?view=sql-server-ver17)

---

## Q41. FULL OUTER JOIN — semantics and use cases

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
`FULL OUTER JOIN` returns every row from both tables, `NULL`-padding whichever side has no match. It's the union of what `LEFT JOIN` and `RIGHT JOIN` would each produce. Its primary real-world use is **two-sided gap/reconciliation analysis** — "what's in A but not B, what's in B but not A, and what matches" in a single query.

**2. SQL Query**
```sql
SELECT
    COALESCE(a.TransactionID, b.TransactionID) AS TransactionID,
    a.Amount AS InternalAmount,
    b.Amount AS BankAmount,
    CASE
        WHEN a.TransactionID IS NULL THEN 'MISSING_INTERNALLY'
        WHEN b.TransactionID IS NULL THEN 'MISSING_AT_BANK'
        WHEN a.Amount <> b.Amount THEN 'AMOUNT_MISMATCH'
        ELSE 'MATCHED'
    END AS ReconciliationStatus
FROM InternalTransactions a
FULL OUTER JOIN BankStatementLines b ON a.TransactionID = b.TransactionID;
```

**3. Explain the Query**
`COALESCE` picks whichever ID is non-null since exactly one side is `NULL` for unmatched rows. The `CASE` expression classifies each row into the three reconciliation-break categories that real settlement/reconciliation systems use: present only internally, present only externally, or present on both sides but disagreeing on amount.

**4. Sample Data**
`InternalTransactions`: (T1, 100.00), (T2, 50.00)
`BankStatementLines`: (T2, 50.00), (T3, 75.00)

**5. Expected Output**
| TransactionID | InternalAmount | BankAmount | ReconciliationStatus |
|---|---|---|---|
| T1 | 100.00 | NULL | MISSING_AT_BANK |
| T2 | 50.00 | 50.00 | MATCHED |
| T3 | NULL | 75.00 | MISSING_INTERNALLY |

**6. Alternative Solutions**
- Two separate anti-join queries (`LEFT JOIN ... IS NULL` each direction) `UNION ALL`'d together, plus a third matched-query — more verbose but sometimes preferred because each branch can use a different, more selective index/plan rather than forcing a single full-outer physical strategy.
- `EXCEPT`/`INTERSECT` set operators for a coarser "which keys differ" check without carrying row payload.
I prefer `FULL OUTER JOIN` with a `CASE` classifier for reconciliation work specifically because it produces one row per key with full context in a single readable statement — matching how [[../14-System-Design]] reconciliation-break classification is described (automatable / manual / investigate).

**7. Performance**
SQL Server typically implements `FULL OUTER JOIN` as a merge join (both inputs sorted or made sortable via an index on the join key) or a hash join with an extra bitmap tracking unmatched build-side rows. A supporting index on `TransactionID` on both sides is essential at any real volume — without one, both sides are scanned and sorted, which is expensive for large settlement files (often millions of rows nightly).

**8. Edge Cases**
- Duplicate `TransactionID`s on either side fan out exactly like inner/left joins — reconciliation systems must dedupe or enforce uniqueness upstream, or add a secondary matching key (amount + date) to disambiguate.
- `NULL` in the join key itself: if `TransactionID` can be `NULL` on either side, those rows never match anything (including each other) and always appear as one-sided — a subtle bug if `NULL` is used as a "not yet assigned" placeholder rather than a true absence.

**9. Production Scenario**
Nightly settlement reconciliation between an internal ledger and an externally supplied bank/processor settlement file — exactly the reconciliation pattern called out in this repo's [[../14-System-Design]] payment-system standard (break classification into automatable/manual/investigate). `FULL OUTER JOIN` is the standard first-pass query every reconciliation engine runs before applying business rules to each break category.

**10. Interview Follow-ups**
1. How is `FULL OUTER JOIN` different from `UNION` of two `LEFT JOIN`s?
2. What physical join algorithms can implement a full outer join?
3. How would you handle near-matches (off-by-a-cent amounts, timing differences) that a plain equality join misses?
4. How do you scale this to hundreds of millions of rows nightly?
5. What SQL Server feature would you use to make this idempotent if the reconciliation job re-runs?

**11. Follow-up Answers**
1. `UNION` of a `LEFT JOIN` and a `RIGHT JOIN` (or two `LEFT JOIN`s with sides swapped) produces the same *rows* as a `FULL OUTER JOIN` but requires the engine to execute two separate join operations and deduplicate matched rows appearing in both — `FULL OUTER JOIN` is a single physical operator and is both clearer and typically cheaper.
2. Merge join (both sides sorted on the join key, single pass) is the classic full-outer-friendly algorithm; SQL Server's hash join can also support full outer semantics by tracking unmatched build rows in the hash table. Nested loop join does not naturally support full-outer semantics because it processes only one direction (outer preserved) efficiently.
3. Equality alone is too strict for real-world reconciliation — production systems typically join on a stable ID when available, and fall back to fuzzy matching (amount within tolerance + date window) for unmatched remainders in a **second pass**, escalating anything still unmatched to the "manual investigation" bucket rather than trying to encode fuzzy logic into a single SQL join.
4. Partition both sides by date (settlement files are naturally date-bounded), index the join key, and process incrementally rather than re-scanning the full history each night; for very large volumes, push the join into a batch/columnstore-oriented engine or pre-aggregate before joining raw line items.
5. Make the reconciliation *write* (e.g., inserting `ReconciliationStatus` rows) idempotent via `MERGE` or an upsert keyed on `TransactionID` + `RunDate`, so re-running the same night's job doesn't duplicate break records — this is the same idempotency discipline covered in Q144.

**12. Common Mistakes**
- Reaching for two separate `LEFT JOIN` queries `UNION`'d together out of habit, missing that `FULL OUTER JOIN` is simpler and usually cheaper.
- Treating a `FULL OUTER JOIN` reconciliation as "done" without a fuzzy-matching fallback pass — real financial data always has a long tail of near-misses.
- Not indexing both sides of the join, turning a nightly job into an unplanned full scan of two large tables.

**13. Architect Insight**
Anyone can write the `FULL OUTER JOIN` syntax. What separates a Staff/Principal answer is treating this as a **reconciliation engine design problem**, not a query problem: classifying breaks, planning a fuzzy-match fallback, making the downstream write idempotent, and reasoning about how the job scales as transaction volume grows — because in FinTech, an unreconciled break isn't just a data-quality issue, it's a control failure that auditors will ask about by name.

---

## Q42. CROSS JOIN and its legitimate uses

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
`CROSS JOIN` produces the full Cartesian product — every row of A paired with every row of B, with no join predicate. It's usually a mistake when it appears by accident (a forgotten `ON`/`WHERE` in old comma-join syntax), but it has legitimate uses: generating a **date spine**, enumerating all valid combinations (e.g., every product × every region for a coverage report), or building a calendar/scaffold table to `LEFT JOIN` real data against so gaps show up as zero/`NULL` rather than silently missing.

**2. SQL Query**
```sql
-- Date spine: every day in a range, cross-joined with every department,
-- so departments with zero activity on a given day still show a 0 row.
WITH DateSpine AS (
    SELECT CAST('2026-01-01' AS DATE) AS ReportDate
    UNION ALL
    SELECT DATEADD(DAY, 1, ReportDate) FROM DateSpine WHERE ReportDate < '2026-01-31'
)
SELECT ds.ReportDate, d.DepartmentName,
       COALESCE(SUM(t.Amount), 0) AS DailyTotal
FROM DateSpine ds
CROSS JOIN Departments d
LEFT JOIN Transactions t
    ON t.TransactionDate = ds.ReportDate AND t.DepartmentID = d.DepartmentID
GROUP BY ds.ReportDate, d.DepartmentName
OPTION (MAXRECURSION 31);
```

**3. Explain the Query**
The recursive CTE builds 31 calendar days. `CROSS JOIN Departments` multiplies that by every department, producing a complete "every day × every department" scaffold with no gaps. The `LEFT JOIN` to real `Transactions` then fills in actual amounts where they exist and `COALESCE`s to zero elsewhere — this is the standard technique for reports that must show explicit zeros for "no activity" rather than omitting the row entirely.

**4. Sample Data**
`Departments`: (10, 'Engineering'), (20, 'Sales') — 2 departments × 31 days = 62 scaffold rows regardless of how many actual transactions exist.

**5. Expected Output**
62 rows, one per (day, department) pair, `DailyTotal` = 0 for any combination with no matching transaction that day.

**6. Alternative Solutions**
- A pre-populated persistent `Calendar`/`DimDate` table `CROSS JOIN`'d with a dimension table — preferred in a real data warehouse over a recursive CTE, since the calendar table is static, indexed, and reused across every report rather than recomputed per query.
- `GENERATE_SERIES` (SQL Server 2022+) as a lighter-weight numeric/date spine generator than a recursive CTE.
I prefer a persistent calendar dimension table in any real warehouse — recomputing a date spine via recursive CTE on every query execution is wasted CPU for something that never changes.

**7. Performance**
`CROSS JOIN` cost is `|A| × |B|` rows — trivial for small dimension tables (dozens to low thousands of rows) but catastrophic if either side is a fact table with millions of rows; that's the classic "accidental cross join" performance incident. There's no join predicate to index against by definition — performance is purely a function of the two input cardinalities.

**8. Edge Cases**
- An accidental `CROSS JOIN` from a missing join predicate in comma-join syntax can silently multiply row counts by orders of magnitude — always sanity-check row counts after any join.
- Empty input on either side collapses the whole cross join to zero rows.

**9. Production Scenario**
Building complete SLA/coverage reports ("every service × every region, flag anything with zero deployments") or generating all valid (currency-pair, settlement-date) combinations for an FX trade-processing coverage check — anywhere the *absence* of data needs to be visible rather than implicitly missing.

**10. Interview Follow-ups**
1. How do you tell an intentional `CROSS JOIN` from an accidental one in a code review?
2. Why is a persistent calendar table usually better than a recursive CTE spine?
3. What's the risk of cross-joining two large tables in production?
4. How does `CROSS APPLY` differ from `CROSS JOIN`?
5. How would you build a coverage report showing zero-activity combinations at scale?

**11. Follow-up Answers**
1. An intentional one is explicit `CROSS JOIN` syntax with a comment explaining the scaffold/enumeration purpose, applied to genuinely small dimension tables; an accidental one is almost always old comma-join syntax with a missing/incorrect `WHERE` predicate on two fact-sized tables, discoverable by a suspicious row-count multiplication.
2. A calendar table is computed once, indexed, small, and reused everywhere — a recursive CTE recomputes the same static sequence on every single query execution, burning CPU and tempdb spool space for no benefit since the set of calendar dates never changes.
3. Row-count explosion: `CROSS JOIN`ing a 1M-row table with a 10K-row table produces 10 billion rows, which can exhaust tempdb, blow query timeouts, or (worse) silently succeed but corrupt downstream aggregates if a `GROUP BY` masks the inflation.
4. `CROSS APPLY` evaluates a table-valued expression (often a function or correlated subquery) once per row of the left input and can reference that row's columns — it's a *correlated*, row-dependent join, whereas `CROSS JOIN` has no correlation and no predicate at all.
5. Build (or reuse) a small, indexed dimension scaffold (calendar × entity), `CROSS JOIN` those two small dimensions, then `LEFT JOIN` the fact table with `COALESCE` for zero-fill — never cross-join two fact-sized tables directly.

**12. Common Mistakes**
- Writing `CROSS JOIN` (or its accidental comma-join equivalent) between two large fact tables.
- Recomputing a date spine via recursive CTE repeatedly instead of maintaining a calendar table.
- Forgetting `COALESCE`/zero-fill after the scaffold join, defeating the entire purpose of building the scaffold.

**13. Architect Insight**
A senior candidate recognizes `CROSS JOIN` as dangerous by default and know its safe uses. An architect-level answer goes further: recommending a maintained calendar/dimension table as reusable infrastructure across the whole reporting layer, not a one-off recursive CTE per report — because ad hoc spine generation duplicated across dozens of reports is exactly the kind of small inefficiency that compounds into real warehouse cost at scale.

---

## Q43. SELF JOIN — the employee/manager pattern

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
A `SELF JOIN` joins a table to itself, using table aliases to treat it as two logically distinct row sets — the canonical example is comparing each employee to their own manager, both of whom live in the same `Employees` table.

**2. SQL Query**
```sql
SELECT e.FirstName + ' ' + e.LastName AS Employee,
       m.FirstName + ' ' + m.LastName AS Manager
FROM Employees e
LEFT JOIN Employees m ON e.ManagerID = m.EmployeeID;
```

**3. Explain the Query**
`e` and `m` are two aliases over the same physical table. For each employee row `e`, SQL Server looks up the row `m` whose `EmployeeID` equals `e.ManagerID`. `LEFT JOIN` (not `INNER JOIN`) is essential here — the CEO or any top-level employee has `ManagerID = NULL` and must still appear in the report, just with `Manager = NULL`.

**4. Sample Data**
(1, Amy, Chen, ManagerID=NULL), (2, Raj, Patel, ManagerID=1)

**5. Expected Output**
| Employee | Manager |
|---|---|
| Amy Chen | NULL |
| Raj Patel | Amy Chen |

**6. Alternative Solutions**
- A recursive CTE (Q51) when you need the *entire* management chain up to the root, not just the immediate manager.
- A correlated subquery (`SELECT (SELECT FirstName FROM Employees m WHERE m.EmployeeID = e.ManagerID) FROM Employees e`) — works but is less idiomatic and typically performs worse than a join for anything beyond a single scalar lookup.
For one level of hierarchy, the self-join is simplest and most idiomatic; for N levels, use the recursive CTE from Q51.

**7. Performance**
Functionally just another join — needs an index on `Employees.EmployeeID` (already the clustered PK, so free) and ideally one on `ManagerID` if this pattern runs frequently at scale, since `ManagerID` is the predicate driving the lookup into the second instance of the table.

**8. Edge Cases**
- Circular management references (a data-integrity bug, not a valid org chart) will not cause this single self-join to fail, but will cause infinite loops if naively extended to a recursive CTE without a cycle guard.
- `ManagerID` pointing to a non-existent `EmployeeID` (referential-integrity violation) — the `LEFT JOIN` silently shows `Manager = NULL`, indistinguishable from "top-level employee" unless you separately validate FK integrity.

**9. Production Scenario**
Org-chart reporting, approval-chain lookups (does this expense report need to escalate to a manager's manager?), and access-control systems where permissions inherit up a reporting hierarchy.

**10. Interview Follow-ups**
1. Why must this use `LEFT JOIN` instead of `INNER JOIN`?
2. How would you get the full chain to the CEO, not just one level?
3. How do you detect a circular management reference in the data?
4. Can a self-join be used for something other than hierarchies?
5. What index would most help this query at scale?

**11. Follow-up Answers**
1. `INNER JOIN` would silently exclude every employee with no manager (typically the CEO/root), which is a real, valid row that must appear in an org-chart report — the classic inner-vs-outer trap from Q40 applied to hierarchical data specifically.
2. A recursive CTE (Q51) that starts from each employee and repeatedly joins to `ManagerID` until it hits a `NULL`, accumulating the chain.
3. Run the recursive CTE with a hard `MAXRECURSION` cap and/or a "visited IDs" tracking column; if the recursion hits the cap or revisits an ID, that's a circular reference to flag for data cleanup — SQL Server itself will throw an error at 100 levels by default (`MAXRECURSION 0` for unlimited, used cautiously).
4. Yes — any "compare this row to another row in the same table" problem: finding pairs of duplicate customers by matching name/address, finding products in the same category, comparing this month's price to last month's price stored in the same table with a date column (a self-join on `ProductID` with a date offset, an alternative to `LAG()` from the Window Functions workbook).
5. A non-clustered index on `ManagerID` (a foreign key referencing the same table) — SQL Server does not automatically index foreign keys, so this lookup is a table/clustered-index scan without one at any real employee-table size.

**12. Common Mistakes**
- Using `INNER JOIN` and silently losing the org root.
- Attempting full-hierarchy traversal with a self-join instead of recognizing it needs recursion.
- Not indexing the self-referencing foreign key column.

**13. Architect Insight**
A junior candidate gets the syntax right. A senior candidate immediately calls out the `LEFT JOIN` requirement and the missing-FK-index gap unprompted; a Staff/Principal-level candidate also flags that self-referencing hierarchies are a well-known scaling pain point in relational databases and knows when to reach for a closure table or a materialized path column instead of recursive traversal once the hierarchy gets deep or is queried very frequently.

---

## Q44. JOIN vs. EXISTS — semantic and performance differences

**Difficulty:** 🔴 Senior

**1. Interview Answer**
`EXISTS` is a boolean existence test — it stops evaluating the moment it finds one matching row, never fans out output rows even if there are multiple matches on the other side, and cannot select columns from the subquery's table. `JOIN` retrieves and combines actual column data and *will* fan out one output row per match. Use `JOIN` when you need columns from both tables; use `EXISTS` when you only need to filter based on whether a related row exists, especially when the relationship is one-to-many and you don't want duplicate outer rows.

**2. SQL Query**
```sql
-- JOIN: fans out if a customer has multiple orders — wrong tool for "has at least one order"
SELECT DISTINCT c.CustomerID, c.CustomerName
FROM Customers c
INNER JOIN Orders o ON o.CustomerID = c.CustomerID;

-- EXISTS: correct tool — one row per customer, no DISTINCT needed, short-circuits per row
SELECT c.CustomerID, c.CustomerName
FROM Customers c
WHERE EXISTS (SELECT 1 FROM Orders o WHERE o.CustomerID = c.CustomerID);
```

**3. Explain the Query**
The `JOIN` version must produce one row per matching `Orders` record, so a customer with 5 orders appears 5 times, forcing a `DISTINCT` (itself an extra sort/hash operation) to get back to "one row per qualifying customer." The `EXISTS` version's subquery is a correlated existence check — for each `Customers` row, SQL Server probes `Orders` for `CustomerID` match and returns `TRUE`/`FALSE` without ever materializing or counting how many orders exist; `SELECT 1` is idiomatic because the actual selected value is discarded.

**4. Sample Data**
`Customers`: (1, Acme). `Orders`: (100,1), (101,1), (102,1) — three orders for the same customer.

**5. Expected Output**
`JOIN` + `DISTINCT`: 1 row (after deduplication, but the engine did produce and discard 3 intermediate rows). `EXISTS`: 1 row, directly, no intermediate fan-out.

**6. Alternative Solutions**
- `IN` (Q45) — semantically close to `EXISTS` for simple, non-`NULL`-bearing subqueries, but behaves dangerously differently once `NULL`s are involved.
- `JOIN` + `GROUP BY` (instead of `DISTINCT`) if you also need an aggregate like `COUNT(o.OrderID)` alongside the existence check — at that point you genuinely need the join.
Prefer `EXISTS` whenever the requirement is purely "does a related row exist," full stop — it communicates intent precisely and avoids the fan-out/dedupe dance entirely.

**7. Performance**
Historically, `EXISTS` had a real performance edge because it can short-circuit (stop at the first match) whereas an equivalent `IN`/`JOIN` had to fully materialize the driven side. Modern SQL Server's optimizer often transforms all three (`JOIN`+`DISTINCT`, `IN`, `EXISTS`) into semantically equivalent semi-join physical operators when it can prove equivalence — so for simple, non-`NULL` cases, plans frequently converge. The gap reappears exactly where the optimizer *can't* safely make that transformation, and that gap is almost entirely about `NULL` semantics, not about a mechanical performance difference (Q45). Always confirm via actual execution plan rather than assuming.

**8. Edge Cases**
- Duplicate matching rows on the joined side: `JOIN` fans out, `EXISTS` never does — this is the core semantic difference, not just a performance detail.
- `NULL`s in the correlated column change nothing for `EXISTS` (it's checking existence of a match, not comparing values) but are the entire story for `IN`/`NOT IN` (Q45).

**9. Production Scenario**
"List all customers who have placed at least one order" (a marketing segment query) is naturally an `EXISTS` — using `JOIN` + `DISTINCT` there is a very common code-review flag because it does unnecessary work and risks the reviewer forgetting the `DISTINCT` entirely, producing duplicate rows downstream in a mailing list.

**10. Interview Follow-ups**
1. Does SQL Server always produce a different plan for `JOIN`+`DISTINCT` vs. `EXISTS`?
2. When would you actually need the `JOIN`, not `EXISTS`?
3. What's a semi-join, physically?
4. Why does `SELECT 1` appear inside `EXISTS` instead of real columns?
5. How does `NOT EXISTS` compare to `NOT IN`?

**11. Follow-up Answers**
1. Not necessarily — when the optimizer can prove the transformation is safe (typically once it can rule out both `NULL`-comparison hazards and the need for row multiplication), it will often generate an equivalent semi-join plan for either form. It's not guaranteed for every query shape, which is why you validate with an actual plan rather than assuming.
2. When you need actual column values from the related table in your output, or an aggregate over the related rows (`COUNT`, `SUM`) — existence alone isn't enough once you need the related data itself.
3. A semi-join is a physical/logical operator that, for each outer row, stops after finding the first matching inner row — it never fans out and never needs a post-hoc `DISTINCT`; this is exactly what `EXISTS` (and a well-optimized `IN`) compile down to.
4. `SELECT 1` (or `SELECT *`) is a stylistic convention signaling "the projected value is irrelevant, only existence matters" — SQL Server does not evaluate or fetch the actual column data for an `EXISTS` check, so there is no performance difference between `SELECT 1` and `SELECT *` here; it's purely a readability/intent signal.
5. `NOT EXISTS` is `NULL`-safe by construction (it's just "no matching row was found," regardless of what values that row does or doesn't contain) — `NOT IN` breaks silently and returns zero rows for the *entire query* if the subquery's result set contains even one `NULL` (Q45). This is the single most consequential correctness difference in this whole topic area.

**12. Common Mistakes**
- Using `JOIN` + `DISTINCT` reflexively for pure existence checks.
- Assuming `EXISTS` is always faster without checking the actual plan.
- Not knowing the `NOT IN`/`NULL` trap and using `NOT IN` where `NOT EXISTS` was required (Q45 covers this in depth).

**13. Architect Insight**
Mid-level candidates know `EXISTS` "can be faster." A senior/architect-level candidate leads with the *semantic* distinction (existence test vs. row retrieval, no fan-out vs. fan-out) and treats performance as a secondary, plan-verified consequence — and immediately connects this topic to the `NOT IN`/`NULL` correctness trap in Q45, because in interviews at this bar, JOIN-vs-EXISTS is almost always a setup for that follow-up.

---

## Q45. JOIN vs. IN vs. EXISTS with NULLs — the NOT IN trap

**Difficulty:** 🔴 Senior

**1. Interview Answer**
`IN` and `EXISTS` are usually interchangeable for positive matching (`WHERE x IN (subquery)` ≈ `WHERE EXISTS (...)`), but their negations are **not** interchangeable when the subquery can return `NULL`. `NOT IN (subquery)` returns **zero rows for the entire outer query** if the subquery's result set contains even a single `NULL`, because SQL's three-valued logic makes every comparison against that `NULL` evaluate to `UNKNOWN`, and `UNKNOWN` anywhere in an `AND`-chain of a `NOT IN` list poisons the whole predicate. `NOT EXISTS` has no such trap — it is always `NULL`-safe.

**2. SQL Query**
```sql
-- DANGEROUS: if any Orders.CustomerID is NULL, this returns ZERO rows, silently.
SELECT c.CustomerID, c.CustomerName
FROM Customers c
WHERE c.CustomerID NOT IN (SELECT o.CustomerID FROM Orders o);

-- SAFE: NOT EXISTS is immune to NULLs in the subquery's result set.
SELECT c.CustomerID, c.CustomerName
FROM Customers c
WHERE NOT EXISTS (SELECT 1 FROM Orders o WHERE o.CustomerID = c.CustomerID);
```

**3. Explain the Query**
`NOT IN` conceptually expands to `WHERE c.CustomerID <> o1.CustomerID AND c.CustomerID <> o2.CustomerID AND ...` for every row the subquery returns. If any `o.CustomerID` is `NULL`, that one comparison evaluates to `UNKNOWN` rather than `TRUE`/`FALSE`; `AND`ed with anything, `UNKNOWN` propagates, and the entire `WHERE` clause for **every outer row** becomes `UNKNOWN` — which `WHERE` treats identically to `FALSE`. The result: an empty result set, with no error, no warning. `NOT EXISTS` instead asks "is there a row where `o.CustomerID = c.CustomerID`?" per outer row independently — a stray `NULL` in an unrelated `Orders` row never touches this per-row correlated check.

**4. Sample Data**
`Customers`: (1, Acme), (2, Globex). `Orders`: (100, 1), (101, NULL) — one order has a `NULL` `CustomerID` (e.g., a guest checkout or a data-quality gap).

**5. Expected Output**
`NOT IN` version: **0 rows** — even though Globex (CustomerID 2) genuinely has no orders, the whole query is silently poisoned by the `NULL` in `Orders.CustomerID` from an unrelated row.
`NOT EXISTS` version: correctly returns Globex, CustomerID 2.

**6. Alternative Solutions**
- `NOT IN (SELECT o.CustomerID FROM Orders o WHERE o.CustomerID IS NOT NULL)` — adding an explicit `IS NOT NULL` filter fixes `NOT IN`, but relies on every developer remembering to add it every single time; it's a landmine waiting for the next person who copies the pattern without the guard.
- `LEFT JOIN ... WHERE right.key IS NULL` (the anti-join pattern, Q46) — also `NULL`-safe and often the most performant of the three for large tables, because it's a straightforward join the optimizer has decades of tuning for.
I strongly prefer `NOT EXISTS` (or the `LEFT JOIN`/`IS NULL` anti-join) as the **default**, and treat bare `NOT IN` against a subquery as a code-review-blocking issue unless the column is provably `NOT NULL` (e.g., a primary key or a `NOT NULL`-constrained foreign key).

**7. Performance**
Modern SQL Server can often produce equivalent anti-semi-join plans for `NOT EXISTS` and a correctly-`NULL`-guarded `NOT IN`, so raw performance is rarely the deciding factor — correctness is. Always verify with an actual execution plan (never assume) when performance genuinely matters at scale; an anti-join generally benefits from an index on the correlated/joined column exactly like its positive counterparts.

**8. Edge Cases**
- A `NULL` anywhere in the `NOT IN` subquery's result column silently zeroes the entire outer result — this is the single highest-value SQL correctness fact to know at this interview level.
- An empty subquery result set (`Orders` table empty) is safe for all three approaches — `NOT IN (empty set)` is `TRUE` for every row, `NOT EXISTS` is `TRUE` for every row, and the anti-join keeps every left row. The danger is specifically `NULL` values, not emptiness.

**9. Production Scenario**
"Find customers who have never placed an order" for a re-engagement campaign, written with `NOT IN`, silently returning zero customers for months because one legacy guest-checkout order has a `NULL` `CustomerID` — a real, well-documented class of production incident, and one of the most-cited SQL gotchas in Microsoft's own community answers.

**10. Interview Follow-ups**
1. Why doesn't the same problem happen with plain `IN` (not negated)?
2. How would you detect this bug was already deployed in existing code?
3. Does adding a `NOT NULL` constraint on the FK column make `NOT IN` permanently safe?
4. What does "three-valued logic" mean precisely?
5. Would `ANSI_NULLS` settings change this behavior?

**11. Follow-up Answers**
1. `x IN (a, b, NULL)` only needs **one** true match to succeed — it's effectively `x = a OR x = b OR x = NULL`, and `OR` short-circuits to `TRUE` the moment any branch is `TRUE`, so a stray `NULL` branch evaluating to `UNKNOWN` doesn't affect a query that already found its match via `OR`. `NOT IN` is the `AND` case, where a single `UNKNOWN` poisons the whole conjunction — negation and De Morgan's laws are exactly why this asymmetry exists.
2. Grep the codebase for `NOT IN (SELECT` patterns and manually verify (a) the subquery's column has a `NOT NULL` constraint, or (b) an explicit `IS NOT NULL` guard is present in the subquery; treat every unguarded instance as a defect until proven otherwise. This is exactly the kind of finding a Principal Engineer surfaces in a code/architecture review.
3. Yes — if the column is provably `NOT NULL` (schema-enforced, not just "usually populated"), `NOT IN` against it is safe forever, because the hazard is specifically the *possibility* of a `NULL` row in the subquery's result. The safest long-term fix is often adding that constraint, not just remembering the `IS NOT NULL` guard at every call site.
4. SQL's comparison logic has three outcomes — `TRUE`, `FALSE`, and `UNKNOWN` — because comparing anything to `NULL` (an absence of a value, not a value) cannot be truthfully answered `TRUE` or `FALSE`; `WHERE`, `HAVING`, and `CASE WHEN` all treat `UNKNOWN` as "does not satisfy," which is the root mechanism behind this entire class of bug.
5. `ANSI_NULLS` (deprecated to always-`ON` behavior in modern SQL Server; `OFF` is unsupported in newer versions) governs whether `= NULL`/`<> NULL` behave as always-`UNKNOWN` (ANSI-standard, correct) vs. a legacy non-standard equality check — it does not change the `NOT IN`-with-`NULL`-in-the-list hazard described here, which is inherent to the `IN`/`NOT IN` predicate's definition, not a session setting.

**12. Common Mistakes**
- Using bare `NOT IN (subquery)` without verifying the subquery column can never return `NULL`.
- Believing a code review "looks fine" because the query runs without error — this bug produces *silently wrong results*, not an exception, which is far more dangerous.
- Confusing this with the `= NULL` mistake (Q36) — related three-valued-logic root cause, different surface bug.

**13. Architect Insight**
This is one of the highest-signal SQL questions at the Principal/Staff bar precisely because the wrong answer doesn't crash — it ships, passes QA (if QA's test data has no `NULL`s), and quietly returns wrong business results in production for months. An architect-level answer doesn't just know the fix; they treat "does the subquery's column allow `NULL`?" as a mandatory review question for every `NOT IN` in a codebase, and would push for a lint rule or schema constraint that makes the bug structurally impossible rather than relying on every future developer remembering this fact.

---

## Q46. Finding unmatched records — the anti-join pattern

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
"Unmatched" queries (rows in A with no corresponding row in B) are answered with an **anti-join**: either `LEFT JOIN B ... WHERE B.key IS NULL`, or `WHERE NOT EXISTS (SELECT 1 FROM B WHERE B.key = A.key)`. Both are standard, correct, `NULL`-safe idioms; `NOT IN` is the one to avoid (Q45) unless the subquery column is guaranteed `NOT NULL`.

**2. SQL Query**
```sql
-- Customers who have never placed an order
SELECT c.CustomerID, c.CustomerName
FROM Customers c
LEFT JOIN Orders o ON o.CustomerID = c.CustomerID
WHERE o.CustomerID IS NULL;

-- Equivalent, NOT EXISTS form
SELECT c.CustomerID, c.CustomerName
FROM Customers c
WHERE NOT EXISTS (SELECT 1 FROM Orders o WHERE o.CustomerID = c.CustomerID);
```

**3. Explain the Query**
The `LEFT JOIN` preserves every customer; for customers with no matching order, every column from `Orders` (including `CustomerID`) comes back `NULL`. Filtering `WHERE o.CustomerID IS NULL` isolates exactly those non-matches. This works precisely because `o.CustomerID` can only be `NULL` in the joined result as an artifact of the outer join finding no match — it is not testing the *original* `Orders.CustomerID` column, so the `NOT IN` `NULL`-poisoning hazard from Q45 does not apply here.

**4. Sample Data**
`Customers`: (1, Acme), (2, Globex). `Orders`: (100, 1).

**5. Expected Output**
| CustomerID | CustomerName |
|---|---|
| 2 | Globex |

**6. Alternative Solutions**
- `EXCEPT`: `SELECT CustomerID FROM Customers EXCEPT SELECT CustomerID FROM Orders` — concise for single-column comparisons, but loses the ability to select other columns from `Customers` without an extra join back.
- `NOT IN` with an explicit `IS NOT NULL` guard — works, but strictly inferior to the two idioms above with no upside.
`LEFT JOIN ... IS NULL` and `NOT EXISTS` are both excellent; I lean `NOT EXISTS` for readability of *intent* ("prove no such row exists") and `LEFT JOIN ... IS NULL` when I already need other outer-side columns from the join for the same query.

**7. Performance**
Both idioms typically compile to an anti-semi-join physical operator when an index exists on the joined/correlated column (`Orders.CustomerID` here) — this is one of the query shapes where SQL Server's optimizer is very good at recognizing the equivalence and choosing an efficient plan regardless of which of the two you write. Without an index on `Orders.CustomerID`, expect a full scan of `Orders` for each anti-join evaluation strategy the optimizer considers.

**8. Edge Cases**
- Empty `Orders` table: every customer correctly appears as unmatched.
- Duplicate `CustomerID` values in `Orders` do not cause duplicate output rows in the anti-join form (unlike a plain `INNER JOIN`), because the filter is existence-based, not row-multiplying — this is a genuine advantage of anti-join idioms over "join then filter."

**9. Production Scenario**
"Customers who never ordered" for re-engagement campaigns, "products never sold" (Q77), "invoices with no matching payment" for AR aging reports — the anti-join is one of the most frequently reused query shapes in any transactional business domain.

**10. Interview Follow-ups**
1. Why doesn't the anti-join fan out like `INNER JOIN` does with duplicate keys?
2. When would `EXCEPT` be the wrong tool here?
3. How would you find unmatched records across *three* tables?
4. What index would you add to make this fast at scale?
5. How is this related to the "missing dates" problem later in this workbook?

**11. Follow-up Answers**
1. Both `LEFT JOIN...IS NULL` and `NOT EXISTS` only care about presence/absence of a match, not how many matches exist — a customer with three orders still contributes at most one "no unmatched row found" outcome that's then filtered out entirely (they're excluded, correctly, exactly once), never duplicated.
2. `EXCEPT` compares whole result sets (deduplicating automatically) and requires matching column lists/types between the two `SELECT`s — it's awkward the moment you need extra columns from the "unmatched" side beyond the comparison key, or when you need to keep duplicates that are meaningful in your domain.
3. Chain `NOT EXISTS` clauses (or successive `LEFT JOIN...IS NULL` conditions) for each table you need "and also absent from" — e.g., customers with no orders AND no support tickets: two independent `NOT EXISTS` predicates `AND`ed together.
4. A non-clustered index on `Orders.CustomerID` (the join/correlation column) — without it, this pattern forces a scan of `Orders` for every anti-join strategy the optimizer might pick.
5. It's the same fundamental shape — "which values from a complete/expected set (customers, dates, sequence numbers) have no corresponding row in the actual data set" — Q80 (missing dates) and Q81 (gaps in sequences) are anti-joins against a generated complete reference set instead of another real table.

**12. Common Mistakes**
- Reaching for `NOT IN` out of habit instead of `NOT EXISTS`/`LEFT JOIN...IS NULL`.
- Forgetting the index on the correlated column and being surprised by a full scan at scale.
- Trying to use plain `INNER JOIN` plus `COUNT = 0` logic in a `HAVING` clause where a direct anti-join would be simpler and clearer.

**13. Architect Insight**
This question is often the *setup* for Q45 in a real interview loop — a strong candidate proactively distinguishes anti-join safety from `NOT IN` danger without being asked, signaling they understand the underlying `NULL`-semantics reason rather than having memorized "use `NOT EXISTS`" as a rule of thumb.

---

## Q47. Finding duplicate records — JOIN/GROUP BY vs. window functions

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
"Find duplicates" almost always means "rows sharing the same value(s) on a natural key, appearing more than once." The classic approach is `GROUP BY` the duplicate-defining columns with `HAVING COUNT(*) > 1`. A more powerful, more flexible modern approach uses `ROW_NUMBER() OVER (PARTITION BY <dup-key> ORDER BY ...)`, which additionally lets you identify *which specific rows* to keep vs. delete (needed for de-duplication, Q68) — plain `GROUP BY` only tells you a duplicate group exists, not which individual row is the "extra" one.

**2. SQL Query**
```sql
-- Approach 1: GROUP BY / HAVING — answers "which keys are duplicated, and how many times"
SELECT CustomerID, OrderDate, COUNT(*) AS DupCount
FROM Orders
GROUP BY CustomerID, OrderDate
HAVING COUNT(*) > 1;

-- Approach 2: window function — answers "which exact rows are the duplicates"
SELECT *
FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY CustomerID, OrderDate ORDER BY OrderID) AS rn
    FROM Orders
) ranked
WHERE rn > 1;
```

**3. Explain the Query**
Approach 1 groups rows by the columns that define "duplicate" (here, same customer placing what looks like the same order twice on the same date) and keeps only groups with more than one member. Approach 2 numbers every row within each duplicate-key partition starting at 1 (ordered by `OrderID`, so the earliest-inserted row gets `rn = 1`); any row with `rn > 1` is, by definition, a duplicate beyond the first occurrence — exactly the set you'd delete to de-duplicate while keeping one record.

**4. Sample Data**
`Orders`: (100, CustID=1, '2026-01-05'), (101, CustID=1, '2026-01-05'), (102, CustID=2, '2026-01-06')

**5. Expected Output**
Approach 1: one row — `CustomerID=1, OrderDate=2026-01-05, DupCount=2`.
Approach 2: one row — OrderID 101 (`rn=2`), since OrderID 100 is `rn=1` and kept.

**6. Alternative Solutions**
- Self-join (`Orders o1 JOIN Orders o2 ON o1.CustomerID = o2.CustomerID AND o1.OrderDate = o2.OrderDate AND o1.OrderID < o2.OrderID`) — works, but doesn't scale cleanly past pairwise comparison for groups of 3+ duplicates without extra logic.
- `COUNT(*) OVER (PARTITION BY ...)` alongside `ROW_NUMBER()` when you want to report *how many* duplicates each row belongs to, not just flag it as one.
`ROW_NUMBER()` is my default for anything beyond "just tell me the duplicate keys exist," because it's the only approach that identifies individual rows precisely and composes directly into a `DELETE` (Q68).

**7. Performance**
`GROUP BY`/`HAVING` requires a sort or hash aggregate over the grouping columns — an index covering `(CustomerID, OrderDate)` avoids an explicit sort. The window-function approach similarly benefits from an index matching the `PARTITION BY`/`ORDER BY` columns, since SQL Server can use it to avoid a separate sort operator before computing `ROW_NUMBER()`. For very large tables, both approaches are full-table-scan-scale operations by nature (you must examine every row to find duplicates) — the win from indexing is avoiding an *additional* sort step, not avoiding the scan itself.

**8. Edge Cases**
- `NULL`s in the duplicate-defining columns: `GROUP BY` treats multiple `NULL`s in the same grouping column as equal to each other for grouping purposes (an explicit exception to normal `NULL <> NULL` comparison semantics) — so rows with `NULL` in the dup-key columns *will* group together and can register as "duplicates," which may or may not match business intent.
- Ties in the `ORDER BY` inside `ROW_NUMBER()`: if the ordering column isn't unique, which specific row gets `rn = 1` is arbitrary/non-deterministic unless you add a tiebreaker (e.g., append the primary key to `ORDER BY`).

**9. Production Scenario**
Duplicate-payment detection in a FinTech ledger (Q140) — the same technique, partitioned by (account, amount, narrow time window) instead of (customer, date), is the backbone of most duplicate-transaction detection jobs.

**10. Interview Follow-ups**
1. Why might `GROUP BY` treat two `NULL`s as "the same" when `NULL = NULL` is `UNKNOWN`?
2. How do you make `ROW_NUMBER()`'s tie-breaking deterministic?
3. How would you find duplicates across *fuzzy* criteria (near-matching amounts/times), not exact equality?
4. What's the risk of running a duplicate-detection query directly against a live OLTP table during business hours?
5. How does this generalize to "find the Nth occurrence" rather than just "duplicates beyond the first"?

**11. Follow-up Answers**
1. `GROUP BY` (and `DISTINCT`, and `UNION`) use a different equality notion than the `WHERE`/`ON` comparison operators — the SQL standard specifically defines grouping/set operations to treat `NULL`s as grouping together, which is a deliberate, documented exception to three-valued comparison logic, not a bug.
2. Add a unique, stable column (typically the primary key) as the final `ORDER BY` key inside the `OVER` clause, e.g. `ORDER BY OrderDate, OrderID` — this guarantees a fully deterministic total order and therefore a deterministic `rn` assignment every time the query runs.
3. Exact-match window functions can't do fuzzy matching directly — typically you bucket into tolerance windows first (e.g., round timestamps to the nearest minute, round amounts to whole units) and then apply the same `PARTITION BY`/`ROW_NUMBER()` technique on the bucketed values, escalating true near-misses to manual review rather than auto-classifying them as duplicates.
4. Both approaches require scanning the full table (or a large portion of it), which can add read pressure and, depending on isolation level, contribute to blocking against concurrent writers (Q25); running with `READ COMMITTED SNAPSHOT` (Q28) or against a read-replica/reporting copy avoids contending with live OLTP traffic.
5. `ROW_NUMBER()` generalizes trivially — `WHERE rn = 1` gets the first occurrence, `WHERE rn = N` gets exactly the Nth, and `WHERE rn > 1` gets "everything after the first" (all duplicates). This is the exact same mechanism reused for the Nth-highest-salary problem (Q66) and top-N-per-group problems (Q74).

**12. Common Mistakes**
- Using `GROUP BY`/`HAVING` when the actual requirement is "delete all but one," which needs row-level identification, not just group-level counts.
- Forgetting a deterministic tiebreaker in `ORDER BY`, producing a different "kept" row on each run.
- Not considering whether `NULL`s should count as duplicates for the business rule at hand.

**13. Architect Insight**
The interesting part of this question, at a senior bar, isn't the syntax — it's recognizing that "find duplicates" is underspecified until you pin down *the exact business definition of duplicate* (exact match? fuzzy match? does `NULL` count? which row is authoritative to keep?) — an architect-level answer asks these clarifying questions before writing a single line of SQL, exactly as they would before designing a de-duplication or reconciliation system in production.

**References**
1. [Joins (SQL Server) — Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/performance/joins?view=sql-server-ver17)
2. [FROM clause plus JOIN, APPLY, PIVOT (T-SQL) — Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-transact-sql?view=sql-server-ver17)
3. [EXISTS (Transact-SQL) — Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/exists-transact-sql?view=sql-server-ver17)
4. [IN (Transact-SQL) — Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/in-transact-sql?view=sql-server-ver17)
5. [Subqueries (SQL Server) — Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/performance/subqueries?view=sql-server-ver17)
6. [WHERE (Transact-SQL) — Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/queries/where-transact-sql?view=sql-server-ver16)
