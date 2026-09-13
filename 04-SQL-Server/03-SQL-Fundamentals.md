> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: None (entry point for SQL fundamentals)

# SQL Server Interview Workbook — SQL Fundamentals

Part of the **Top SQL Interview Questions & Answers Workbook** for `04-SQL-Server`. This file covers global questions **Q30–Q38** — SELECT/WHERE, GROUP BY/HAVING, ORDER BY, DISTINCT, CASE, NULL handling, aggregates, and string/date functions. See [[02-Transactions-Isolation-Locking]] for the workbook's transaction/concurrency material and [[15-Interview-Challenge-Mode]] for the live-practice question bank.

**Canonical sample schemas used throughout this workbook:** `Employees(EmployeeID, FirstName, LastName, DepartmentID, ManagerID, Salary, HireDate)`, `Departments(DepartmentID, DepartmentName)`, `Customers(CustomerID, CustomerName, Country)`, `Orders(OrderID, CustomerID, OrderDate, TotalAmount)`, `OrderItems(OrderItemID, OrderID, ProductID, Quantity, UnitPrice)`, `Products(ProductID, ProductName, CategoryID, Price)`.

---

### Q30. Explain SELECT/WHERE — specifically, what order does SQL Server actually evaluate a query's clauses in?

**Difficulty:** 🟢 Basic

**1. Interview Answer**
SQL is written in one order (`SELECT`, `FROM`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`) but SQL Server's logical processing order is different: `FROM` (and `JOIN`s) first, then `WHERE` filters rows, then `GROUP BY` forms groups, then `HAVING` filters groups, then `SELECT` computes the output expressions, then `ORDER BY` sorts, then `OFFSET`/`FETCH`/`TOP` limits. This is why you can't reference a column alias defined in `SELECT` inside the same query's `WHERE` clause — `WHERE` is logically evaluated before `SELECT` even exists.

**2. SQL Query**
```sql
SELECT
    e.DepartmentID,
    COUNT(*) AS EmployeeCount
FROM dbo.Employees e
WHERE e.HireDate >= '2020-01-01'
GROUP BY e.DepartmentID
HAVING COUNT(*) > 5
ORDER BY EmployeeCount DESC;
```

**3. Explain the Query**
Logically: `FROM Employees` builds the row source; `WHERE` discards employees hired before 2020; `GROUP BY DepartmentID` buckets survivors into per-department groups; `HAVING COUNT(*) > 5` discards groups with 5 or fewer employees; `SELECT` produces the `DepartmentID`/`EmployeeCount` pair for the surviving groups; `ORDER BY EmployeeCount DESC` sorts the final result. The alias `EmployeeCount` can be used in `ORDER BY` (evaluated after `SELECT`) but could not be used in `WHERE` or `GROUP BY` (evaluated before `SELECT` computes it).

**4. Sample Data**
| EmployeeID | DepartmentID | HireDate |
|---|---|---|
| 1 | 10 | 2021-03-01 |
| 2 | 10 | 2022-06-15 |
| 3 | 20 | 2019-01-01 |
| ... (6 more in DepartmentID 10, hired after 2020) | | |

**5. Expected Output**
| DepartmentID | EmployeeCount |
|---|---|
| 10 | 8 |

**6. Alternative Solutions**
- Using a CTE to pre-filter and pre-aggregate in named steps for readability on more complex versions of this query — functionally identical, purely a style/maintainability choice (see [[05-Subqueries-CTEs]]).
- **Preferred**: the direct form shown for simple cases; a CTE once more than two or three logical steps are chained, so intent stays readable.

**7. Performance**
An index on `Employees(HireDate)` or a composite `(DepartmentID, HireDate)` lets the `WHERE` filter and `GROUP BY` both be satisfied efficiently — check the execution plan for a Stream Aggregate fed by an ordered Index Seek/Scan rather than a Hash Match Aggregate over an unordered scan, which signals a missing supporting index (see [[01-Indexing-Query-Execution-Plans]]).

**8. Edge Cases**
- If `HireDate` is `NULL` for some rows, they're silently excluded by `WHERE e.HireDate >= '2020-01-01'` (NULL comparisons are never true) — decide explicitly whether that's the intended behavior.
- Empty `Employees` table returns an empty result set, not an error.
- `HAVING COUNT(*) > 5` with no `GROUP BY` at all would treat the whole table as one group — different semantics than intended here.

**9. Production Scenario**
Headcount-by-department dashboards and hiring-velocity reports use exactly this shape — filter to a time window, group by an organizational dimension, filter to only the groups that matter.

**10. Interview Follow-ups**
1. Why can't you reference a `SELECT`-list alias in the `WHERE` clause?
2. What's the difference in logical order between `WHERE` and `HAVING`?
3. Where does a window function (Q55-Q64) fit in this logical order?
4. Why does `TOP` combined with `ORDER BY` sometimes still return "non-deterministic" ties?
5. How does the query optimizer's actual physical execution order differ from this logical order?

**11. Follow-up Answers**
1. Because `WHERE` is logically evaluated before `SELECT` computes any output expressions or aliases — the alias simply doesn't exist yet at the point `WHERE` runs. (SQL Server does allow referencing a `SELECT`-list alias in `ORDER BY`, since that clause runs after `SELECT`.)
2. `WHERE` filters individual rows before grouping happens; `HAVING` filters entire groups after `GROUP BY` has formed them — a `WHERE` predicate can't reference an aggregate (`COUNT`, `SUM`) because aggregates don't exist yet at that point, which is exactly why `HAVING` exists as a separate clause.
3. Window functions are evaluated conceptually after `WHERE`/`GROUP BY`/`HAVING` but before the final `ORDER BY`/`TOP` — they operate over the row set that's already been filtered and grouped, which is why you can't put a window function's result directly in a `WHERE` clause without wrapping the query in a CTE/subquery.
4. `TOP` without a fully unique `ORDER BY` key doesn't guarantee which rows among ties get returned — SQL Server is free to return any of them, and that choice can even change between runs (different execution plan, parallelism); include enough columns in `ORDER BY` to make the sort deterministic if tie-breaking matters.
5. The optimizer is free to reorder physical operations however it wants (e.g., pushing a filter down before a join, or evaluating `HAVING`-equivalent logic during aggregation) as long as the *result* matches what the logical order would produce — the logical order defines correctness/semantics, not the actual execution plan shape.

**12. Common Mistakes**
- Writing `WHERE COUNT(*) > 5` instead of `HAVING COUNT(*) > 5` and being confused by the resulting error.
- Assuming clauses execute in the order they're typed.
- Referencing a `SELECT`-list alias inside `WHERE` and being surprised it fails ("Invalid column name").

**13. Architect Insight**
This is Basic-tier syntax knowledge, but the discriminator at a senior interview is connecting logical processing order to **why specific execution-plan shapes exist** — e.g., recognizing that the optimizer pushing a `WHERE` predicate below a `JOIN` (predicate pushdown) is only valid because of this logical ordering guarantee, which is the same reasoning that underlies SARGability discussions in [[01-Indexing-Query-Execution-Plans]].

**References**
1. [SELECT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-transact-sql)

---

### Q31. Explain GROUP BY and the aggregate functions — including what happens with NULLs.

**Difficulty:** 🟢 Basic

**1. Interview Answer**
`GROUP BY` partitions rows into buckets sharing the same value(s) in the specified column(s), and aggregate functions (`SUM`, `COUNT`, `AVG`, `MIN`, `MAX`) then compute one value per bucket. Every column in the `SELECT` list must either be in the `GROUP BY` list or wrapped in an aggregate — SQL Server enforces this, unlike some other engines that silently pick an arbitrary value. Aggregates other than `COUNT(*)` ignore `NULL` values entirely when computing their result.

**2. SQL Query**
```sql
SELECT
    DepartmentID,
    COUNT(*) AS TotalEmployees,
    AVG(Salary) AS AvgSalary,
    SUM(Salary) AS TotalPayroll,
    MIN(Salary) AS MinSalary,
    MAX(Salary) AS MaxSalary
FROM dbo.Employees
GROUP BY DepartmentID;
```

**3. Explain the Query**
Rows are bucketed by `DepartmentID`; for each bucket, `COUNT(*)` counts every row (including ones with a `NULL` salary), while `AVG`/`SUM`/`MIN`/`MAX(Salary)` compute over only the non-`NULL` salary values in that bucket — a department with 10 employees where 2 have a `NULL` salary reports `TotalEmployees = 10` but `AVG(Salary)` computed over only 8 values.

**4. Sample Data**
| EmployeeID | DepartmentID | Salary |
|---|---|---|
| 1 | 10 | 80000 |
| 2 | 10 | NULL |
| 3 | 10 | 95000 |

**5. Expected Output**
| DepartmentID | TotalEmployees | AvgSalary | TotalPayroll | MinSalary | MaxSalary |
|---|---|---|---|---|---|
| 10 | 3 | 87500.00 | 175000 | 80000 | 95000 |

**6. Alternative Solutions**
- `SUM(Salary) / COUNT(*)` as a manual "average" would silently give a *different, usually wrong* number than `AVG(Salary)` whenever NULLs are present, because the denominator would include NULL rows that the numerator's `SUM` excluded — never use this instead of `AVG`.
- Window function equivalents (`SUM(Salary) OVER (PARTITION BY DepartmentID)`, see [[06-Window-Functions]]) achieve per-group aggregates *without collapsing rows*, useful when you need the aggregate alongside individual employee detail rows in the same result set.

**7. Performance**
An index on `(DepartmentID)` (or `DepartmentID INCLUDE (Salary)` as a covering index) lets SQL Server use a Stream Aggregate over ordered input instead of a Hash Match Aggregate — check the execution plan; for a small number of distinct `DepartmentID` values a Hash Aggregate over a full scan may actually be the optimizer's correct choice, so don't force Stream Aggregate via hints without measuring.

**8. Edge Cases**
- All-`NULL` salary in a group → `AVG`/`SUM`/`MIN`/`MAX` return `NULL` for that group, not `0` or an error.
- Empty table → zero groups returned (not one group with `COUNT(*) = 0`) — a common source of confusion when a report "disappears" instead of showing zero.
- `COUNT(Salary)` (column, not `*`) differs from `COUNT(*)` specifically because it excludes NULL salaries — see Q37 for the full distinction.

**9. Production Scenario**
Payroll summary and compensation-benchmarking reports rely on correct NULL-aware aggregation — miscounting or silently including/excluding NULL compensation data (e.g., unfilled positions, contractors without a set salary) is a real, embarrassing reporting bug class.

**10. Interview Follow-ups**
1. Why does SQL Server require every non-aggregated column to appear in `GROUP BY`?
2. What does `GROUP BY ()` (empty) or `GROUP BY ROLLUP`/`CUBE` do?
3. How would you get a department's average salary *excluding* a specific outlier without a subquery?
4. Why might `COUNT(*)` and `COUNT(Salary)` differ, and when would you deliberately want that difference?
5. Can you `GROUP BY` a computed expression, not just a raw column?

**11. Follow-up Answers**
1. Because any non-aggregated, non-grouped column would have multiple, ambiguous values within a group — SQL Server (unlike MySQL's traditionally lenient default mode) refuses to silently pick one arbitrary value, forcing the query to be explicit about what it means.
2. `GROUP BY ROLLUP(DepartmentID)` adds a grand-total row (and, with more columns, subtotal rows) in addition to the per-group rows; `CUBE` generates subtotals for every combination of the grouping columns — both are used for multi-level reporting summaries without writing several separate `UNION ALL` queries.
3. `AVG(Salary) FILTER`-equivalent isn't native T-SQL syntax (that's more of a PostgreSQL/standard-SQL feature); in SQL Server, use a `CASE` expression inside the aggregate: `AVG(CASE WHEN EmployeeID <> @OutlierId THEN Salary END)` — the `CASE` returns `NULL` for the excluded row, and `AVG` ignores NULLs automatically.
4. `COUNT(*)` counts rows regardless of NULLs in any column; `COUNT(Salary)` counts only rows where `Salary IS NOT NULL`. You'd deliberately use `COUNT(Salary)` to answer "how many employees have a recorded salary" as distinct from "how many employees are there" — e.g., data-completeness/data-quality reporting.
5. Yes — `GROUP BY YEAR(HireDate)` or `GROUP BY DATEPART(QUARTER, HireDate)` groups by a computed expression directly; the same expression must then also appear (or be re-derived identically) in the `SELECT` list.

**12. Common Mistakes**
- Computing an "average" manually as `SUM(x)/COUNT(*)` instead of `AVG(x)`, silently producing a wrong number whenever NULLs exist.
- Forgetting that an empty group produces no row at all, then treating a missing department in a report as "zero activity" when it might mean "no rows matched the filter, department not evaluated."
- Not knowing `ROLLUP`/`CUBE`/`GROUPING SETS` exist and hand-writing multiple `UNION ALL` queries to get subtotal reports instead.

**13. Architect Insight**
Fundamentals-tier syntax, but the Architect-level tell is precision about NULL semantics under aggregation — this exact gap (treating `COUNT(*)` and `COUNT(column)` as interchangeable, or computing averages manually) is a disproportionately common source of real financial-reporting bugs, which is why interviewers at this bar probe it even in an "easy" question.

**References**
1. [SELECT - GROUP BY clause (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-group-by-transact-sql)

---

### Q32. HAVING vs. WHERE — why does HAVING need to exist as a separate clause?

**Difficulty:** 🟢 Basic

**1. Interview Answer**
`WHERE` filters individual rows *before* grouping; `HAVING` filters entire groups *after* aggregation has happened. `HAVING` exists because, at the point `WHERE` is logically evaluated, aggregate values (`COUNT`, `SUM`, etc.) don't exist yet — there's no way to say "only rows where the group's total exceeds X" using `WHERE` alone, because "the group's total" isn't computed until `GROUP BY`/aggregation runs.

**2. SQL Query**
```sql
SELECT DepartmentID, SUM(Salary) AS TotalPayroll
FROM dbo.Employees
WHERE HireDate >= '2018-01-01'         -- row-level filter, before grouping
GROUP BY DepartmentID
HAVING SUM(Salary) > 500000;           -- group-level filter, after aggregation
```

**3. Explain the Query**
`WHERE HireDate >= '2018-01-01'` removes individual employee rows hired before 2018 *before* any grouping occurs — reducing the row set the aggregation even sees. `GROUP BY DepartmentID` then buckets the survivors. `HAVING SUM(Salary) > 500000` discards entire departments whose *aggregated* payroll (computed only from the already-`WHERE`-filtered rows) doesn't clear the threshold — this could never be expressed in `WHERE` because `SUM(Salary)` doesn't exist as a value until after grouping.

**4. Sample Data**
Employees across departments 10, 20, 30 hired at various dates with various salaries; department 10's post-2018 payroll totals $620,000; department 20's totals $310,000.

**5. Expected Output**
| DepartmentID | TotalPayroll |
|---|---|
| 10 | 620000 |

**6. Alternative Solutions**
- Wrapping the aggregation in a subquery/CTE and filtering the outer query with `WHERE` on the pre-computed aggregate column — functionally equivalent to `HAVING`, sometimes preferred purely for readability when the aggregation logic is already complex enough to warrant its own named step (see [[05-Subqueries-CTEs]]).
- **Preferred**: `HAVING` directly for straightforward cases — it's the idiomatic, standard way to express this and avoids an unnecessary extra query layer.

**7. Performance**
`WHERE` reduces the row count *before* the (often more expensive) aggregation step runs — always push as much filtering as possible into `WHERE` rather than filtering post-aggregation in `HAVING` when the predicate doesn't actually depend on an aggregate value; this is a common, easy performance win the optimizer can't always do for you if the predicate is written on the wrong clause unnecessarily (e.g., writing `HAVING DepartmentID = 10` instead of `WHERE DepartmentID = 10`).

**8. Edge Cases**
- `HAVING DepartmentID = 10` (a predicate that doesn't need aggregation at all) works but is a performance anti-pattern — it should be in `WHERE` so it filters before the (potentially expensive) grouping step, not after.
- A `HAVING` clause with no `GROUP BY` treats the entire table as a single group — legal, if unusual (e.g., `SELECT COUNT(*) FROM Orders HAVING COUNT(*) > 1000000`).
- `HAVING` can reference an aggregate not present in the `SELECT` list at all — the two lists are independent.

**9. Production Scenario**
"Show me all departments over payroll budget" or "customers whose total order value this quarter exceeds $1M" (a threshold/flagging report) are exactly the `GROUP BY`+`HAVING` shape — a row-level filter narrows scope, a group-level filter finds the groups that matter.

**10. Interview Follow-ups**
1. What happens if you put a non-aggregate, non-grouped-column predicate in `HAVING` — does it error?
2. Can `HAVING` and `WHERE` reference the same column?
3. Is there a performance difference between filtering in `HAVING` vs. wrapping in a subquery and filtering in the outer `WHERE`?
4. Why is `HAVING COUNT(*) > 5` valid but `WHERE COUNT(*) > 5` is not?
5. How would you find "customers with more than 3 orders" — which clause does the count threshold belong in?

**11. Follow-up Answers**
1. It doesn't error as long as the referenced column is either in `GROUP BY` or wrapped in an aggregate — SQL Server enforces the same "every column must be grouped or aggregated" rule in `HAVING`'s expression as it does in `SELECT`.
2. Yes, routinely — e.g., `WHERE DepartmentID IS NOT NULL` (row-level) combined with `HAVING COUNT(*) > 5` (group-level) on the same `DepartmentID` grouping column serves two different filtering purposes at two different stages.
3. Modern SQL Server's optimizer typically produces the same or a very similar execution plan for both forms since it can reason about the semantic equivalence — but for very complex aggregation logic, an explicit CTE/subquery can sometimes help the optimizer (or a human reader) more than a deeply nested `HAVING` expression; verify with actual execution plans rather than assuming either form is always faster.
4. Because at the point `WHERE` is logically evaluated, no grouping or aggregation has happened yet, so `COUNT(*)` has no meaning — there's no "count" to compare against until `GROUP BY` produces groups for `HAVING` to then evaluate aggregates over.
5. `HAVING COUNT(*) > 3` after `GROUP BY CustomerID` — "more than 3 orders" is inherently a per-group aggregate threshold, which is exactly what `HAVING` exists for; it cannot be expressed in `WHERE`.

**12. Common Mistakes**
- Putting a plain, non-aggregate row filter in `HAVING` "because it comes after GROUP BY in my mental model of the query," missing the free performance win of filtering earlier in `WHERE`.
- Trying to write `WHERE COUNT(*) > 5` and being confused by the error instead of understanding why it's structurally impossible.
- Assuming `HAVING` can only reference columns present in the `SELECT` list.

**13. Architect Insight**
Basic-tier concept, but interviewers at this bar use it to check whether a candidate reasons about the *logical processing pipeline* (Q30) rather than pattern-matching clause keywords — an Architect explains `HAVING`'s existence as a direct consequence of *when* aggregation happens in that pipeline, not as an arbitrary syntax rule to memorize.

**References**
1. [HAVING (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-having-transact-sql)

---

### Q33. ORDER BY, TOP, and OFFSET/FETCH — how do you implement pagination correctly?

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
`ORDER BY` sorts the final result set and is required (directly or indirectly) for any deterministic pagination. `TOP (N)` returns the first N rows per that ordering — simple, but without a companion `OFFSET`, not directly usable for "page 2, 3, 4...". `OFFSET n ROWS FETCH NEXT m ROWS ONLY` (added in SQL Server 2012) implements true page-based pagination: skip `n` rows, then return the next `m`. It requires `ORDER BY` and, critically, the `ORDER BY` key must be unique (or made unique by including a tiebreaker column) for pagination to be stable across pages.

**2. SQL Query**
```sql
DECLARE @PageNumber INT = 3, @PageSize INT = 20;

SELECT OrderID, CustomerID, OrderDate, TotalAmount
FROM dbo.Orders
ORDER BY OrderDate DESC, OrderID DESC   -- OrderID as tiebreaker for determinism
OFFSET (@PageNumber - 1) * @PageSize ROWS
FETCH NEXT @PageSize ROWS ONLY;
```

**3. Explain the Query**
`ORDER BY OrderDate DESC, OrderID DESC` establishes a fully deterministic sort — `OrderDate` alone could have ties (multiple orders on the same date), so `OrderID` breaks them consistently. `OFFSET 40 ROWS` (for page 3, page size 20) skips the first 40 rows in that order, and `FETCH NEXT 20 ROWS ONLY` returns the next 20 — page 3's contents.

**4. Sample Data**
`Orders` table with 500 rows spanning several months, multiple orders sharing the same `OrderDate`.

**5. Expected Output**
Exactly 20 rows, rows 41–60 in `OrderDate DESC, OrderID DESC` order — consistent every time as long as no rows are inserted/deleted between page requests.

**6. Alternative Solutions**
- **`TOP` + subquery ("NOT IN previous page's IDs")**: legacy pattern, awkward and inefficient for deep pages — avoid in new code.
- **Keyset ("seek") pagination** — `WHERE (OrderDate, OrderID) < (@LastSeenOrderDate, @LastSeenOrderId) ORDER BY OrderDate DESC, OrderID DESC` `FETCH NEXT 20 ROWS ONLY` using the last row's key from the previous page instead of a numeric offset: dramatically better performance for deep pagination (page 5,000) since it seeks directly to the right point instead of scanning and discarding `OFFSET` rows, at the cost of not supporting "jump to arbitrary page N" navigation.
- **Preferred**: `OFFSET`/`FETCH` for typical shallow, user-facing "page 1, 2, 3" UIs with a reasonable total page count; keyset pagination for infinite-scroll feeds, API cursors, or any dataset where users can page arbitrarily deep — see Q19 for the full performance comparison.

**7. Performance**
`OFFSET`/`FETCH` still has to *read and discard* all `OFFSET` rows internally even though it doesn't return them — an index on `(OrderDate DESC, OrderID DESC)` lets this be an efficient ordered seek-and-skip rather than a full sort, but the cost still grows linearly with the offset, which is why deep pagination (large page numbers) degrades and keyset pagination becomes necessary at scale.

**8. Edge Cases**
- Non-unique `ORDER BY` key (just `OrderDate` alone) means row order *within* a tied date is undefined and can change between page requests — rows can be skipped or duplicated across pages. Always include a unique tiebreaker.
- `OFFSET` beyond the total row count returns an empty set, not an error.
- Concurrent inserts/deletes between page 1 and page 2 requests can shift results in `OFFSET`-based pagination (a row can appear on two pages or be skipped entirely) — keyset pagination is more resilient to this because it anchors to a specific seen value rather than a positional count.

**9. Production Scenario**
Any paged API endpoint (`GET /orders?page=3&pageSize=20`) or paged admin UI grid uses this pattern; high-traffic public APIs with deep pagination (e.g., a transaction-history endpoint) are exactly where the `OFFSET`-vs-keyset performance difference becomes a real, customer-visible latency issue.

**10. Interview Follow-ups**
1. Why must `OFFSET`/`FETCH` be paired with `ORDER BY`?
2. What specifically makes deep `OFFSET` pagination slow — what does the execution plan show?
3. How would you redesign a "jump to page 5,000" UI requirement if keyset pagination doesn't support it?
4. What happens to `OFFSET`-based pagination correctness if rows are being actively inserted between page requests?
5. Is `TOP` ever still the right choice over `OFFSET`/`FETCH`?

**11. Follow-up Answers**
1. Because "the next N rows" is only a meaningful, repeatable concept relative to a defined order — without `ORDER BY`, SQL Server has no guaranteed row order at all (heap/index order is an implementation detail, not a contract), so `OFFSET`/`FETCH` without `ORDER BY` would be non-deterministic garbage.
2. The execution plan shows the engine scanning/seeking through `OFFSET + FETCH` total rows and then discarding the first `OFFSET` of them (visible as a large number of rows read by the underlying seek/scan operator versus a small number actually returned) — the further into the result set you page, the more rows are read-and-thrown-away, which is the direct mechanical cause of the slowdown.
3. Offer keyset/cursor-based "next page" navigation as the primary UX (most real-world usage is sequential paging or infinite scroll anyway) and, if arbitrary jump-to-page is a hard requirement, keep `OFFSET`/`FETCH` for that specific feature while accepting its cost is bounded to realistic page-count ranges (e.g., cap at page 100) rather than trying to optimize genuinely unbounded deep offsets.
4. A row inserted with a sort-key value that places it before the current offset point shifts every subsequent row's position by one, which can cause a row to be shown twice across two page requests (once on each page) or skipped entirely — an accepted, documented trade-off of offset-based pagination under concurrent writes, which keyset pagination avoids because it seeks by value, not position.
5. `TOP (N)` alone (no offset) is fine and arguably clearer for "just give me the first/most-recent N rows, no paging" use cases — dashboards, "latest 10 transactions" widgets — where there's no concept of subsequent pages at all.

**12. Common Mistakes**
- Using `OFFSET`/`FETCH` (or `TOP`) with a non-unique `ORDER BY` key and getting inconsistent results across page loads.
- Not indexing the `ORDER BY` columns, forcing a full sort on every page request regardless of pagination technique.
- Defaulting to `OFFSET`/`FETCH` for a high-scale, deep-pagination API without considering keyset pagination, then hitting a performance wall in production.

**13. Architect Insight**
The Senior-level answer implements pagination correctly. The Architect-level answer chooses the *pagination strategy* (offset vs. keyset) based on the actual access pattern and scale requirement up front — including designing the API contract itself (page-number-based vs. cursor/token-based) around that choice — rather than defaulting to `OFFSET`/`FETCH` everywhere and discovering the scaling wall after the fact, which is precisely the trade-off explored further in Q19.

**References**
1. [ORDER BY Clause (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql)
2. [TOP (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/top-transact-sql)

---

### Q34. DISTINCT vs. GROUP BY — when are they actually equivalent, and when do they diverge?

**Difficulty:** 🟢 Basic

**1. Interview Answer**
`SELECT DISTINCT col1, col2 FROM T` and `SELECT col1, col2 FROM T GROUP BY col1, col2` produce identical *results* when there's no aggregate function involved — both collapse duplicate `(col1, col2)` combinations to one row each. They diverge the moment aggregation is needed: `GROUP BY` supports computing `SUM`/`COUNT`/etc. per group, which `DISTINCT` cannot express at all. `DISTINCT` also applies to the *entire selected row*, not to an arbitrary subset of columns independent of what's selected.

**2. SQL Query**
```sql
-- Equivalent for simple de-duplication:
SELECT DISTINCT DepartmentID FROM dbo.Employees;

SELECT DepartmentID FROM dbo.Employees GROUP BY DepartmentID;

-- NOT expressible with DISTINCT — requires GROUP BY:
SELECT DepartmentID, COUNT(*) AS EmployeeCount
FROM dbo.Employees
GROUP BY DepartmentID;
```

**3. Explain the Query**
The first two statements both return one row per distinct `DepartmentID` value and, for this specific case with no aggregate, typically produce identical execution plans (the optimizer recognizes the semantic equivalence). The third statement needs a per-group count, which has no `DISTINCT` equivalent — there's no way to say "distinct department IDs, but also tell me how many rows had each one" using `DISTINCT` alone.

**4. Sample Data**
`Employees` with `DepartmentID` values `10, 10, 20, 20, 20, 30`.

**5. Expected Output**
First two queries: `10, 20, 30` (3 rows). Third query: `(10, 2), (20, 3), (30, 1)`.

**6. Alternative Solutions**
- `DISTINCT` is sometimes (mis)used to "fix" a query that returns unexpected duplicates from a join fan-out, papering over an actual logic error rather than fixing the join cardinality — this is a red flag, not a legitimate use, and should prompt investigating why duplicates appeared in the first place.
- **Preferred**: use `DISTINCT` only when duplicate elimination is the actual intended semantic (e.g., "list of distinct countries our customers are in"), never as a blind fix for unexplained duplicate rows.

**7. Performance**
Both `DISTINCT` and `GROUP BY` (without aggregates) typically compile to the same physical operator (a Hash Match or Stream Aggregate used for duplicate removal) — verify via execution plan rather than assuming one is inherently faster; on the columns actually selected, an appropriate index avoids a full sort/hash step for either form.

**8. Edge Cases**
- `DISTINCT` considers two `NULL`s equal for de-duplication purposes (unlike a `WHERE col = NULL` comparison, which is never true) — `SELECT DISTINCT col FROM T` collapses all `NULL` rows into a single `NULL` output row.
- `DISTINCT *` deduplicates based on *every* column in the row — a common gotcha when a join brings in a column that makes every row technically unique, silently defeating the intended de-duplication.
- `COUNT(DISTINCT col)` is valid and different from both plain `DISTINCT` and `GROUP BY` — it counts distinct non-NULL values of a column within a group/whole table.

**9. Production Scenario**
"List of distinct countries with active customers" is a clean `DISTINCT` use case; "customer count per country" requires `GROUP BY` — recognizing which one a requirement actually calls for (and not defaulting to `DISTINCT` just because it's shorter to type) matters for correctness the moment a count/sum is added later.

**10. Interview Follow-ups**
1. Does `DISTINCT` always produce the same execution plan as an equivalent `GROUP BY`?
2. Why does `DISTINCT` treat NULLs as equal to each other when `=` doesn't?
3. What's `COUNT(DISTINCT col)` actually computing, mechanically?
4. Can you use `DISTINCT` inside an aggregate function other than `COUNT`?
5. When would `DISTINCT` mask a real bug rather than express intended de-duplication?

**11. Follow-up Answers**
1. In modern versions, generally yes for the simple no-aggregate case — the optimizer recognizes the semantic equivalence and can choose the same physical strategy for either syntax; this isn't a hard guarantee across all versions/scenarios, so verify with `SET STATISTICS XML ON` or the graphical plan when it matters.
2. `DISTINCT`'s de-duplication semantics are defined in terms of value *equality for grouping purposes*, which SQL treats NULL-to-NULL as a match for (the same rule `GROUP BY` uses) — this is a different, specific rule from the three-valued-logic `=` operator used in `WHERE`/`JOIN` predicates, which always evaluates `NULL = NULL` as `UNKNOWN`, not `TRUE`.
3. It builds the set of distinct non-NULL values of the column (conceptually the same de-duplication as plain `DISTINCT` on that one column) and then counts the size of that set — mechanically often implemented via a sort or hash-based distinct step feeding into the count.
4. Yes — `SUM(DISTINCT col)`, `AVG(DISTINCT col)` etc. are valid and sum/average only the distinct values of the column, not every row's value; a genuinely uncommon but real interview trick question since it's rarely useful in practice and easy to apply by mistake.
5. When a join introduces unintended row multiplication (a one-to-many join fan-out) and the fix applied is "just add `DISTINCT`" rather than fixing the join condition or aggregating properly — `DISTINCT` can hide the symptom while the underlying query logic remains wrong, and can still produce incorrect results if the fanned-out rows aren't actually fully identical after all selected columns are considered.

**12. Common Mistakes**
- Reaching for `DISTINCT` to fix unexpected duplicate rows from a join without understanding *why* the duplicates appeared.
- Assuming `DISTINCT` and `GROUP BY` are always interchangeable, then being unable to express a required aggregate.
- Forgetting NULL-equality semantics differ between `DISTINCT`/`GROUP BY` and `WHERE`/`JOIN` predicates.

**13. Architect Insight**
This is a Basic-tier question, but a senior candidate's answer should immediately flag the "DISTINCT papering over a join bug" anti-pattern unprompted — that's the signal an interviewer is actually listening for, since it demonstrates the candidate treats unexpected duplicates as a correctness investigation, not a formatting nuisance to suppress.

**References**
1. [SELECT clause (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-clause-transact-sql)

---

### Q35. CASE expressions — simple vs. searched, and where do people misuse them?

**Difficulty:** 🟢 Basic

**1. Interview Answer**
`CASE` has two forms: **simple** (`CASE column WHEN value1 THEN ... WHEN value2 THEN ... END`, equality comparisons only against one expression) and **searched** (`CASE WHEN condition1 THEN ... WHEN condition2 THEN ... END`, arbitrary boolean conditions, more flexible). Both are expressions, not statements — they return a single value and can be used anywhere a value is expected (`SELECT` list, `WHERE`, `ORDER BY`, even inside an aggregate).

**2. SQL Query**
```sql
SELECT
    EmployeeID,
    Salary,
    CASE   -- searched CASE: arbitrary conditions
        WHEN Salary >= 150000 THEN 'Senior'
        WHEN Salary >= 90000  THEN 'Mid'
        ELSE 'Junior'
    END AS SalaryBand,
    CASE DepartmentID   -- simple CASE: equality only
        WHEN 10 THEN 'Engineering'
        WHEN 20 THEN 'Sales'
        ELSE 'Other'
    END AS DepartmentName
FROM dbo.Employees;
```

**3. Explain the Query**
The searched `CASE` on `Salary` evaluates each `WHEN` condition top-to-bottom and returns the value tied to the *first* one that's true — order matters (a common bug is ordering thresholds so a later, more specific condition is unreachable because an earlier, broader one already matched). The simple `CASE` on `DepartmentID` is shorthand for `CASE WHEN DepartmentID = 10 THEN ... WHEN DepartmentID = 20 THEN ... END` — only equality checks against the single leading expression, nothing more complex.

**4. Sample Data**
| EmployeeID | Salary | DepartmentID |
|---|---|---|
| 1 | 160000 | 10 |
| 2 | 95000 | 20 |
| 3 | 70000 | 30 |

**5. Expected Output**
| EmployeeID | Salary | SalaryBand | DepartmentName |
|---|---|---|---|
| 1 | 160000 | Senior | Engineering |
| 2 | 95000 | Mid | Sales |
| 3 | 70000 | Junior | Other |

**6. Alternative Solutions**
- `IIF(condition, true_value, false_value)`: syntactic sugar for a two-branch searched `CASE`, fine for simple binary logic but doesn't scale to multiple branches as cleanly.
- Conditional aggregation using `CASE` inside `SUM`/`COUNT` (`SUM(CASE WHEN Status = 'Completed' THEN 1 ELSE 0 END)`) is the standard T-SQL pattern for pivot-like per-category counts without the `PIVOT` operator — see Q103.
- **Preferred**: searched `CASE` for anything beyond simple equality or beyond two branches; `IIF` only for genuinely simple, single-condition inline logic.

**7. Performance**
A `CASE` expression in the `SELECT` list is evaluated per output row with negligible cost. A `CASE` expression in a `WHERE` clause on an indexed column, however, can prevent an index seek on that column (making the predicate non-SARGable) — see Q18's SARGability discussion; prefer rewriting as separate `OR`-ed conditions or restructuring the query if a `CASE`-based `WHERE` predicate turns a seek into a scan on a large table.

**8. Edge Cases**
- No matching `WHEN` and no `ELSE` → the whole `CASE` expression evaluates to `NULL`, not an error — a frequent silent-bug source when a new category value appears and every existing `WHEN` branch misses it.
- `WHEN` branches are evaluated in written order and short-circuit at the first match — overlapping conditions where a later, intended-to-be-more-specific branch is unreachable is a real, easy-to-introduce bug.
- Mixing incompatible return types across branches forces an implicit conversion to a common type, which can silently truncate or reformat data (e.g., mixing an `INT` result in one branch with a `VARCHAR` in another converts everything to `VARCHAR`).

**9. Production Scenario**
Categorizing transactions into risk tiers, compensation bands, or status-display labels for a UI/report are all standard `CASE`-expression use cases — and the "no ELSE, unhandled new category silently becomes NULL" failure mode is a realistic, real incident pattern when a new status/category value is introduced upstream without updating every `CASE` expression that classifies it.

**10. Interview Follow-ups**
1. Why should you almost always include an `ELSE` branch, even if you think every case is covered?
2. Can a `CASE` expression's branches return different data types?
3. How is `CASE` different from `IIF`?
4. What happens if a `CASE` expression appears in a `WHERE` clause on an indexed column — any performance implications?
5. How would you use `CASE` to implement conditional aggregation (a pivot-style report) without the `PIVOT` operator?

**11. Follow-up Answers**
1. Because without `ELSE`, any unmatched input silently becomes `NULL` rather than raising a visible error — for anything feeding a report, a UI label, or a downstream calculation, a silent NULL is far more dangerous than a deliberate, visible default value or an explicit error for an unexpected input.
2. Yes, but SQL Server implicitly converts all branches to a single common data type (following data type precedence rules) — this can cause unexpected truncation/formatting if, say, one branch returns a `DECIMAL` and another a shorter `VARCHAR`; be explicit about intended output type with `CAST`/`CONVERT` if branches naturally differ.
3. `IIF(a, b, c)` is precisely `CASE WHEN a THEN b ELSE c END` — pure syntactic sugar for the two-branch case, introduced for T-SQL/Access-migration convenience; anything `IIF` can do, searched `CASE` can also do, but not vice versa (multi-branch logic needs `CASE`).
4. Yes — a `CASE` expression wrapped around an indexed column in a `WHERE` clause typically makes the predicate non-SARGable (the optimizer can't use the index to seek, since it would have to evaluate the expression for every row to know if it matches), forcing a scan; this is functionally identical to the "functions on indexed columns" anti-pattern covered in Q18.
5. `SUM(CASE WHEN Region = 'East' THEN SalesAmount ELSE 0 END) AS East, SUM(CASE WHEN Region = 'West' THEN SalesAmount ELSE 0 END) AS West` — one `CASE`-guarded `SUM` per desired output column, combined with an outer `GROUP BY` on whatever dimension isn't being pivoted; see Q103 for the full pivot treatment including the native `PIVOT` operator alternative.

**12. Common Mistakes**
- Omitting `ELSE` and letting unmatched values silently become NULL in a report.
- Ordering searched `CASE` branches so a broad early condition makes a later, more specific one unreachable.
- Using `CASE` in a `WHERE` clause on a large indexed table without realizing it defeats index seeks.

**13. Architect Insight**
Basic syntax, but the Architect-level answer proactively raises the "no ELSE = silent NULL for future unhandled categories" risk and treats it as a data-quality/maintainability concern that belongs in code review standards, not just a personal habit — this is exactly the kind of unprompted risk-awareness that separates a Staff from a Senior answer even on simple material.

**References**
1. [CASE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/case-transact-sql)
2. [IIF (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/logical-functions-iif-transact-sql)

---

### Q36. NULL handling — three-valued logic, and ISNULL vs. COALESCE vs. NULLIF.

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
SQL uses three-valued logic: any predicate involving `NULL` evaluates to `TRUE`, `FALSE`, or `UNKNOWN` — and `UNKNOWN` is treated as "not true" everywhere a boolean is needed (`WHERE`, `JOIN ON`, `CHECK`), which is why `NULL = NULL` is `UNKNOWN`, not `TRUE`, and rows with `NULL` in a compared column are excluded by `=`/`<>` comparisons entirely (use `IS NULL`/`IS NOT NULL` instead). For substituting default values: `ISNULL(expr, replacement)` is SQL-Server-specific, takes exactly two arguments, and returns the data type of the *first* argument. `COALESCE(expr1, expr2, ..., exprN)` is ANSI-standard, takes any number of arguments, returns the first non-NULL one, and follows `CASE`-expression data-type precedence rules (returns the type of the highest-precedence argument). `NULLIF(expr1, expr2)` returns `NULL` if the two are equal, otherwise returns `expr1` — the inverse operation, used to *introduce* NULL rather than replace it.

**2. SQL Query**
```sql
SELECT
    EmployeeID,
    ISNULL(MiddleName, '') AS MiddleName_ISNULL,
    COALESCE(MiddleName, PreferredName, 'N/A') AS DisplayName,
    NULLIF(Bonus, 0) AS BonusOrNullIfZero    -- treat a 0 bonus as "not set" for averaging
FROM dbo.Employees;

-- Why NULLIF matters for correct averaging:
SELECT AVG(NULLIF(Bonus, 0)) AS AvgBonusExcludingZeros
FROM dbo.Employees;
```

**3. Explain the Query**
`ISNULL(MiddleName, '')` substitutes an empty string whenever `MiddleName` is `NULL`. `COALESCE` chains multiple fallbacks, returning the first non-NULL among `MiddleName`, `PreferredName`, or the literal `'N/A'`. `NULLIF(Bonus, 0)` converts a stored `0` bonus into `NULL` — useful because `AVG` ignores NULLs but not zeros, so `AVG(NULLIF(Bonus, 0))` computes the average bonus *among employees who actually received one*, excluding both NULLs and explicit zeros, which `AVG(Bonus)` alone cannot do.

**4. Sample Data**
| EmployeeID | MiddleName | PreferredName | Bonus |
|---|---|---|---|
| 1 | NULL | 'Ally' | 5000 |
| 2 | 'James' | NULL | 0 |
| 3 | NULL | NULL | NULL |

**5. Expected Output**
Row 1: `DisplayName='Ally'`, `BonusOrNullIfZero=5000`. Row 2: `DisplayName='James'`, `BonusOrNullIfZero=NULL`. Row 3: `DisplayName='N/A'`, `BonusOrNullIfZero=NULL`. `AvgBonusExcludingZeros` = `5000.00` (only row 1 counted).

**6. Alternative Solutions**
- A searched `CASE WHEN col IS NULL THEN replacement ELSE col END` is functionally equivalent to `ISNULL`/`COALESCE` for the two-argument case — more verbose, occasionally preferred when the "replacement" logic is more complex than a single fallback value.
- **Preferred**: `COALESCE` over `ISNULL` in new code by default — it's ANSI-standard (portable), supports N-way fallback chains naturally, and its data-type behavior is more predictable/standard than `ISNULL`'s "type of the first argument" rule, which has caused real truncation bugs (e.g., `ISNULL(NULL, 'a long string')` truncated because the untyped `NULL` literal defaulted to a narrow type in older engine behavior).

**7. Performance**
`ISNULL`/`COALESCE` on an indexed column used in a `WHERE` clause is non-SARGable for the same reason any function wrapping an indexed column is (Q18) — if you need to find "rows where `MiddleName` is NULL or empty," write it as `WHERE MiddleName IS NULL OR MiddleName = ''` rather than `WHERE ISNULL(MiddleName, '') = ''`, so the optimizer can still seek.

**8. Edge Cases**
- `COALESCE` with mismatched argument types can raise a conversion error at query-compile time if there's no implicit conversion path between them, whereas `ISNULL`'s two-argument, first-argument-type-wins behavior can instead silently truncate — genuinely different failure modes worth knowing.
- `NULLIF(a, a)` (same expression twice) always returns `NULL` — a sometimes-useful, sometimes-accidental way to force a NULL for a specific sentinel value.
- `COALESCE` is technically defined in terms of a `CASE` expression per the ANSI standard, and evaluates each argument potentially more than once in edge cases involving side-effecting scalar functions — rarely relevant in practice but a known subtlety.

**9. Production Scenario**
Computing a display name with graceful fallbacks (preferred name → legal name → "Unknown"), or excluding sentinel "not applicable" values (a `0` used to mean "not set" in a legacy system) from an average — both are routine reporting and UI-facing scenarios.

**10. Interview Follow-ups**
1. Why does `ISNULL(NULL, 'a very long string')` sometimes truncate when `COALESCE` with the same arguments doesn't?
2. What does `WHERE Column = NULL` actually return, and why?
3. How would you find rows where a column is either NULL or an empty string, correctly and SARGably?
4. What's the practical use case for `NULLIF`, beyond the averaging example?
5. Is `COALESCE` guaranteed to short-circuit and not evaluate later arguments once an earlier one is non-NULL?

**11. Follow-up Answers**
1. `ISNULL` types its result based on the *first* argument; if the first argument is an untyped `NULL` literal or a narrower column type than the replacement value, the result can be silently truncated to that narrower type. `COALESCE` follows standard data-type-precedence rules across *all* its arguments, generally picking the widest/highest-precedence type among them — which is exactly why `COALESCE` is the safer default in new code.
2. It returns zero rows matching that predicate — `Column = NULL` evaluates to `UNKNOWN` for every row (per three-valued logic), and `UNKNOWN` is treated as not-satisfying `WHERE`, regardless of whether `Column` actually contains `NULL` values or not. (Note: `SET ANSI_NULLS OFF`, a deprecated legacy setting, changes this behavior — never rely on it in new code.)
3. `WHERE Column IS NULL OR Column = ''` — written this way (not wrapped in a function), both branches can potentially use an index (a NULL-inclusive filtered index, or an index seek combined with an OR, depending on the optimizer's plan) rather than forcing a scan the way `WHERE ISNULL(Column, '') = ''` would.
4. Guarding against division by zero: `SELECT Numerator / NULLIF(Denominator, 0)` returns `NULL` instead of raising a divide-by-zero error when `Denominator` is `0` — a very common, practical production pattern for computing ratios/percentages safely.
5. Yes for evaluation order (arguments are evaluated left to right and evaluation can stop once a non-NULL is found in typical usage), but the ANSI-standard definition expressed as an equivalent `CASE` expression means each argument expression could, in principle, be evaluated as part of determining the result type/collation even if not for its value — in practice, for standard scalar expressions without side effects (the overwhelming majority of real usage), this distinction has no observable effect.

**12. Common Mistakes**
- Writing `WHERE Column = NULL` expecting it to find NULL rows.
- Relying on `ISNULL`'s implicit typing without realizing it can silently truncate a replacement value.
- Using `AVG(Bonus)` when the actual business question requires excluding explicit-zero sentinel values via `NULLIF`, silently under- or over-stating the true average.

**13. Architect Insight**
Any competent engineer knows `ISNULL`/`COALESCE` exist. The Architect-level distinction is knowing their type-inference behavior differs in a way that has caused real production truncation bugs, defaulting to `COALESCE` for portability and predictability, and treating three-valued logic as a first-class correctness concern in every `WHERE`/`JOIN` predicate review — not an occasional gotcha to look up when something breaks.

**References**
1. [COALESCE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/coalesce-transact-sql)

---

### Q37. Aggregate functions deep dive — COUNT(*) vs. COUNT(column) vs. COUNT(DISTINCT column).

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
`COUNT(*)` counts every row in the group/table, full stop, regardless of NULLs in any column. `COUNT(column)` counts only rows where that specific column is `NOT NULL`. `COUNT(DISTINCT column)` counts the number of distinct non-NULL values that column takes — duplicates and NULLs both collapse out. All other aggregates (`SUM`, `AVG`, `MIN`, `MAX`) ignore NULL values in their input the same way `COUNT(column)` does.

**2. SQL Query**
```sql
SELECT
    COUNT(*)                    AS TotalOrders,
    COUNT(ShippedDate)          AS OrdersShipped,
    COUNT(DISTINCT CustomerID)  AS UniqueCustomers
FROM dbo.Orders;
```

**3. Explain the Query**
`COUNT(*)` gives the raw row count of `Orders` — every order, shipped or not. `COUNT(ShippedDate)` counts only orders where `ShippedDate IS NOT NULL` — i.e., orders that have actually shipped, using NULL as the "not yet shipped" sentinel. `COUNT(DISTINCT CustomerID)` gives the number of unique customers who placed at least one order, regardless of how many orders each placed.

**4. Sample Data**
| OrderID | CustomerID | ShippedDate |
|---|---|---|
| 1 | 100 | 2026-01-05 |
| 2 | 100 | NULL |
| 3 | 200 | 2026-01-06 |

**5. Expected Output**
| TotalOrders | OrdersShipped | UniqueCustomers |
|---|---|---|
| 3 | 2 | 2 |

**6. Alternative Solutions**
- `SUM(CASE WHEN ShippedDate IS NOT NULL THEN 1 ELSE 0 END)` is a verbose, functionally-equivalent alternative to `COUNT(ShippedDate)` — never preferred, since `COUNT(column)` expresses the same intent more directly and the optimizer handles it more predictably.
- For "distinct count per group across multiple aggregates in one query" where multiple `COUNT(DISTINCT ...)` on *different* columns are needed simultaneously, SQL Server has historical limitations (can't mix `COUNT(DISTINCT A)` and `COUNT(DISTINCT B)` as trivially as a single distinct count) — a common workaround is a `GROUP BY` subquery per distinct dimension, or `APPROX_COUNT_DISTINCT` for large-scale approximate cardinality when exactness isn't required.

**7. Performance**
`COUNT(*)` over a table with a narrow, always-present index (e.g., the clustered index key) is typically the cheapest of the three, since the engine can count index entries without touching row data at all. `COUNT(DISTINCT column)` requires an internal sort/hash-based deduplication step and is meaningfully more expensive at scale — an index on that specific column reduces but doesn't eliminate this cost; verify via the execution plan whether a Sort or Hash Match (Aggregate) operator dominates the cost for large tables.

**8. Edge Cases**
- Empty table: `COUNT(*)` returns `0` correctly (unlike `SUM`/`AVG`, which would return `NULL` on an empty input — `COUNT` is the one aggregate that never returns NULL).
- `COUNT(DISTINCT column)` on an all-NULL column returns `0`, not `NULL` and not the row count.
- `COUNT(1)` and `COUNT(*)` are functionally and (in modern SQL Server) performance-identical — the optimizer recognizes `COUNT(constant)` as equivalent to `COUNT(*)`; the once-common belief that `COUNT(1)` is faster is outdated folklore for this engine.

**9. Production Scenario**
Dashboard metrics like "total orders," "orders shipped," and "unique active customers" in the same reporting query are exactly this three-way distinction — getting any of the three wrong (e.g., using `COUNT(*)` where `COUNT(DISTINCT CustomerID)` was intended) silently produces a materially wrong business metric that can go unnoticed for a long time since the query still "works."

**10. Interview Follow-ups**
1. Is `COUNT(1)` faster than `COUNT(*)` in SQL Server?
2. Why does `COUNT(*)` never return NULL, unlike `SUM`/`AVG`/`MIN`/`MAX`?
3. How would you get two different `COUNT(DISTINCT ...)` values (on two different columns) in a single query efficiently?
4. What does `COUNT(DISTINCT column)` do with NULLs, and why?
5. How would you approximate a distinct count on a billion-row table where exact `COUNT(DISTINCT)` is too slow?

**11. Follow-up Answers**
1. No, not in modern SQL Server — the optimizer treats `COUNT(1)`, `COUNT(*)`, and `COUNT(<any non-nullable constant>)` identically, compiling to the same plan; this was arguably true of some very old database engines but is not a meaningful distinction to make in a current SQL Server interview answer beyond acknowledging the folklore and correcting it.
2. Because `COUNT(*)` is defined as "number of rows," a value that always exists even for an empty group (the answer is `0`, a real number) — whereas `SUM`/`AVG`/`MIN`/`MAX` are defined over the *values* in a column, and an empty set of values has no sum/average/min/max to report, so standard SQL defines the result as `NULL` (a specific, deliberate design choice, not an oversight).
3. Use conditional aggregation with `CASE` inside a `COUNT(DISTINCT ...)`-equivalent pattern is not directly possible for genuinely distinct multi-column counts in one pass; the standard approach is separate scalar subqueries (`(SELECT COUNT(DISTINCT CustomerID) FROM Orders) AS UniqueCustomers, (SELECT COUNT(DISTINCT ProductID) FROM OrderItems) AS UniqueProducts`) or, for same-table multi-distinct-count needs, `GROUP BY`-then-aggregate subqueries feeding an outer query.
4. It excludes them, for the same reason any aggregate does — `DISTINCT` first reduces the column's values to a distinct, non-NULL set (per the same NULL-collapsing rule as plain `DISTINCT`, Q34), and `COUNT` then counts the size of that set; there is no "count of distinct NULLs" concept in standard aggregate semantics.
5. `APPROX_COUNT_DISTINCT(column)` (available since SQL Server 2019) uses a probabilistic algorithm (HyperLogLog-family) to estimate cardinality with a small, bounded error (~2% typical) at a fraction of the memory/CPU cost of an exact `COUNT(DISTINCT)` over huge datasets — appropriate when the business need is genuinely an approximate metric (e.g., "roughly how many unique visitors") rather than an exact, audit-grade figure.

**12. Common Mistakes**
- Using `COUNT(*)` when `COUNT(DISTINCT column)` was actually needed (or vice versa), silently reporting the wrong business metric.
- Believing `COUNT(1)` is a meaningful performance optimization over `COUNT(*)` in SQL Server.
- Forgetting that `COUNT(column)` silently excludes NULLs, leading to an undercount interpreted as "total records" when it's actually "records with this field populated."

**13. Architect Insight**
This looks like trivia, but it's a genuinely high-frequency source of silently-wrong dashboards and financial reports in real systems — the Architect-level answer treats "which COUNT variant" as a business-semantics question to nail down explicitly with stakeholders (what does "total" mean here — rows, or unique entities?) rather than a syntax detail, because the wrong choice produces a plausible-looking number that's simply incorrect.

**References**
1. [COUNT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/count-transact-sql)
2. [APPROX_COUNT_DISTINCT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/approx-count-distinct-transact-sql)

---

### Q38. Which string/date functions come up most often in interviews, and what are the gotchas?

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
The high-frequency set: `DATEDIFF`/`DATEADD` for date arithmetic, `EOMONTH` for month-end/month-over-month logic, `STRING_SPLIT` for parsing delimited values into rows, `CONCAT`/`CONCAT_WS` vs. `+` for string concatenation, and `TRY_CONVERT`/`TRY_CAST` for safe type conversion. The key gotchas: `DATEDIFF` counts *boundary crossings*, not full elapsed units (so `DATEDIFF(YEAR, '2025-12-31', '2026-01-01')` returns `1` despite one day of actual elapsed time); string concatenation with `+` propagates `NULL` (any NULL operand makes the whole result NULL) while `CONCAT` treats NULL as an empty string.

**2. SQL Query**
```sql
SELECT
    DATEDIFF(YEAR, '2025-12-31', '2026-01-01')      AS YearDiff_Misleading,   -- 1, not ~0
    DATEDIFF(DAY, '2025-12-31', '2026-01-01')        AS DayDiff_Actual,        -- 1
    EOMONTH(GETUTCDATE())                            AS ThisMonthEnd,
    EOMONTH(GETUTCDATE(), -1)                        AS LastMonthEnd,
    CONCAT(FirstName, ' ', NULL, LastName)           AS ConcatHandlesNull,     -- no NULL propagation
    FirstName + ' ' + NULL + LastName                AS PlusPropagatesNull,   -- entire result is NULL
    TRY_CONVERT(DATE, '2026-13-40')                  AS SafeConversion        -- NULL, not an error
FROM dbo.Employees;

-- STRING_SPLIT: parsing a delimited list into rows
SELECT value AS Tag
FROM STRING_SPLIT('fraud,high-value,manual-review', ',');
```

**3. Explain the Query**
`DATEDIFF(YEAR, ...)` counts how many January-1st boundaries were crossed between the two dates — not full 365-day years — which is why Dec 31 to Jan 1 (one calendar day apart) reports a year difference of `1`; this surprises people expecting "years elapsed" semantics. `EOMONTH` with an offset (`-1`) computes last month's end date directly, avoiding manual date-arithmetic. `CONCAT` treats each NULL argument as an empty string, while the `+` operator returns NULL for the entire expression if *any* operand is NULL — a frequent source of "why did the whole name disappear" bugs. `TRY_CONVERT` returns `NULL` on a conversion failure instead of throwing, useful for safely parsing untrusted/dirty input data. `STRING_SPLIT` is a table-valued function turning a delimited string into one row per element, commonly used to pass a list of IDs into a query without dynamic SQL.

**4. Sample Data**
`Employees.FirstName='Jane', LastName='Doe'`; current date treated as `2026-09-13`.

**5. Expected Output**
`YearDiff_Misleading=1`, `DayDiff_Actual=1`, `ThisMonthEnd=2026-09-30`, `LastMonthEnd=2026-08-31`, `ConcatHandlesNull='Jane Doe'` (extra space from the NULL argument), `PlusPropagatesNull=NULL`, `SafeConversion=NULL`. `STRING_SPLIT` output: three rows, `'fraud'`, `'high-value'`, `'manual-review'`.

**6. Alternative Solutions**
- Manual date-boundary-safe year-difference logic (`DATEDIFF(YEAR, d1, d2) - CASE WHEN ... THEN 1 ELSE 0 END` adjusting for whether the anniversary has occurred) when true "elapsed full years" semantics are required instead of `DATEDIFF`'s boundary-crossing count — necessary for age calculations, tenure calculations, etc.
- `STRING_SPLIT` (simple, fast, but historically didn't guarantee element ordering before SQL Server 2022's optional `ordinal` parameter) vs. a numbered-table/JSON-based split for cases where original order must be preserved — use `STRING_SPLIT(string, separator, 1)` with the `enable_ordinal` argument (2022+) when order matters.
- **Preferred**: `CONCAT`/`CONCAT_WS` over `+` for any string-building involving columns that could be NULL — eliminates an entire class of "missing text" bugs by default.

**7. Performance**
`STRING_SPLIT` is a set-based, generally efficient way to turn a delimited parameter into rows for a `JOIN`/`IN` — far preferable to looping or dynamic SQL string concatenation for a variable-length list of IDs; date functions and `CONCAT`/`TRY_CONVERT` are cheap scalar operations with no indexing implications on their own, though wrapping an *indexed column* in any of them in a `WHERE` clause reintroduces the SARGability problem from Q18.

**8. Edge Cases**
- `DATEDIFF`'s boundary-crossing behavior applies to every date part, not just `YEAR` — `DATEDIFF(MONTH, '2026-01-31', '2026-02-01')` returns `1` despite one day of actual elapsed time, for the same reason.
- `STRING_SPLIT` on an empty string returns one row with an empty string value, not zero rows — a common off-by-one surprise when parsing optional/empty input.
- `TRY_CONVERT`/`TRY_CAST` swallow the conversion error into a silent `NULL` — appropriate for genuinely-optional/dirty input, dangerous if used reflexively where an actual conversion failure should be surfaced as an error rather than hidden.

**9. Production Scenario**
Month-over-month/quarter-over-quarter growth reports (Q89/Q90) lean heavily on `EOMONTH` and boundary-aware `DATEDIFF` usage; passing a comma-separated list of transaction IDs from an application layer into a stored procedure via `STRING_SPLIT` instead of building dynamic SQL is a standard, injection-safe pattern in production financial systems.

**10. Interview Follow-ups**
1. Why does `DATEDIFF(YEAR, '2025-12-31', '2026-01-01')` return 1, and how would you compute true elapsed full years instead?
2. What's the practical difference between `CONVERT`, `CAST`, and `TRY_CONVERT`?
3. Does `STRING_SPLIT` guarantee output row order matches the input string's element order?
4. Why prefer `CONCAT`/`CONCAT_WS` over `+` for building display strings from nullable columns?
5. What's a SQL-injection-safe way to pass a variable-length list of IDs into a parameterized query, and how does `STRING_SPLIT` fit in?

**11. Follow-up Answers**
1. Because `DATEDIFF` counts how many date-part *boundaries* were crossed, not elapsed duration — Dec 31 to Jan 1 crosses exactly one year boundary despite being one day apart. True "full elapsed years" (e.g., for age/tenure) requires subtracting 1 if the anniversary date hasn't yet occurred in the later date: `DATEDIFF(YEAR, BirthDate, GETDATE()) - CASE WHEN DATEADD(YEAR, DATEDIFF(YEAR, BirthDate, GETDATE()), BirthDate) > GETDATE() THEN 1 ELSE 0 END`.
2. `CAST` is ANSI-standard, `CONVERT` is SQL-Server-specific and additionally supports a `style` parameter for format control (useful for date-to-string formatting); both throw an error on an invalid conversion. `TRY_CONVERT` (and `TRY_CAST`) perform the same conversion but return `NULL` instead of throwing on failure — the right choice specifically when the input's validity is uncertain and a failed conversion is an expected, handleable case rather than an exceptional one.
3. Only when using the `enable_ordinal = 1` argument (available since SQL Server 2022), which adds an `ordinal` output column reflecting original position — without it, `STRING_SPLIT` makes no ordering guarantee at all, and relying on result order without the ordinal parameter is a latent bug.
4. Because `+` treats the entire concatenation expression as NULL the instant any single operand is NULL, silently dropping an entire computed string (e.g., a full name becoming entirely blank because a middle name was NULL) — `CONCAT` treats each NULL argument as an empty string instead, so the rest of the concatenation survives intact; `CONCAT_WS` additionally handles a separator cleanly without leaving double-separators around missing values.
5. Pass the list as a single delimited `VARCHAR`/`NVARCHAR` parameter (or, better in modern SQL Server, a table-valued parameter) to a parameterized query/stored procedure — never concatenate the ID list directly into dynamic SQL text. `STRING_SPLIT` then turns that single safely-parameterized string into a row set usable in a `JOIN`/`IN (SELECT value FROM STRING_SPLIT(@Ids, ','))`, avoiding both SQL injection and the parameter-count limits of a giant `IN (...)` list built dynamically.

**12. Common Mistakes**
- Interpreting `DATEDIFF(YEAR, ...)` as "full years elapsed" without accounting for its boundary-crossing semantics.
- Using `+` for string concatenation on nullable columns and being surprised by an entirely-blank result.
- Assuming `STRING_SPLIT` preserves input order without explicitly requesting the ordinal column.
- Using `TRY_CONVERT` everywhere reflexively, silently swallowing conversion errors that should have surfaced as bugs.

**13. Architect Insight**
These are everyday functions, but a Principal-level answer distinguishes itself by naming the *specific* semantic gotchas (boundary-crossing `DATEDIFF`, NULL-propagating `+`, unordered `STRING_SPLIT`) unprompted, because these are exactly the kind of "technically correct syntax, subtly wrong semantics" bugs that pass code review and surface only in production — the kind of failure mode a Principal Engineer is expected to catch before it ships, not after an incident.

**References**
1. [DATEDIFF (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/datediff-transact-sql)
2. [EOMONTH (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/eomonth-transact-sql)
3. [STRING_SPLIT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/string-split-transact-sql)

---

## Next in this workbook

[[04-Joins]] covers INNER/LEFT/RIGHT/FULL/CROSS/SELF joins, JOIN vs. EXISTS vs. IN, and the unmatched/duplicate-record patterns (Q39–Q47).
