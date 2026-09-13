> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: [[04-Joins]]

# SQL Server Interview Workbook — Subqueries & CTEs

Canonical sample schema (consistent with [[04-Joins]] and the rest of this workbook):

```sql
CREATE TABLE Departments (DepartmentID INT PRIMARY KEY, DepartmentName VARCHAR(50));
CREATE TABLE Employees (
    EmployeeID INT PRIMARY KEY, FirstName VARCHAR(50), LastName VARCHAR(50),
    DepartmentID INT NULL, ManagerID INT NULL, Salary DECIMAL(12,2), HireDate DATE
);
CREATE TABLE Orders (OrderID INT PRIMARY KEY, CustomerID INT, OrderDate DATE, TotalAmount DECIMAL(12,2));
```

---

## Q48. Subqueries — scalar vs. multi-row vs. table subqueries

**Difficulty:** 🟢 Basic

**1. Interview Answer**
A **scalar subquery** returns exactly one column, one row (or `NULL`) and can be used anywhere a single value is expected — `SELECT`, `WHERE = `, etc. A **multi-row subquery** returns one column but multiple rows, and must be consumed with `IN`, `ANY`, `ALL`, or `EXISTS` — never bare `=`. A **table subquery** (derived table) returns multiple columns and multiple rows and is used in a `FROM` clause as if it were a real table.

**2. SQL Query**
```sql
-- Scalar subquery: average salary company-wide, used in a comparison
SELECT EmployeeID, Salary
FROM Employees
WHERE Salary > (SELECT AVG(Salary) FROM Employees);

-- Multi-row subquery: employees in any department based in specific cities
SELECT EmployeeID FROM Employees
WHERE DepartmentID IN (SELECT DepartmentID FROM Departments WHERE DepartmentName IN ('Engineering', 'Trading'));

-- Table subquery (derived table) used in FROM
SELECT deptAvg.DepartmentID, deptAvg.AvgSalary
FROM (SELECT DepartmentID, AVG(Salary) AS AvgSalary FROM Employees GROUP BY DepartmentID) AS deptAvg
WHERE deptAvg.AvgSalary > 80000;
```

**3. Explain the Query**
The scalar subquery `(SELECT AVG(Salary) FROM Employees)` is computed once (it doesn't depend on the outer row — it's *uncorrelated*) and reused as a single number in the outer `WHERE` comparison. The multi-row subquery returns a list of `DepartmentID`s and is consumed with `IN`, which checks outer-row membership against that list. The derived table `deptAvg` is materialized conceptually as its own result set, then filtered and referenced in the outer query exactly like any base table.

**4. Sample Data**
`Employees`: (1, ..., Salary=95000), (2, ..., Salary=70000), (3, ..., Salary=110000). Average = 91,666.67.

**5. Expected Output**
Scalar query returns employees 1 and 3 (both above the ~91,667 average).

**6. Alternative Solutions**
- The scalar-subquery comparison could be rewritten with a `CROSS JOIN` to a one-row aggregate derived table — functionally identical, marginally more verbose, no real advantage.
- The derived-table example could instead be a CTE (Q53 covers exactly this trade-off).
For a one-off, single-use aggregate, an inline scalar subquery or derived table is fine; reach for a CTE (Q50) the moment the same derived result is needed more than once in the statement, for readability.

**7. Performance**
An **uncorrelated** scalar subquery like `(SELECT AVG(Salary) FROM Employees)` is evaluated once regardless of how many outer rows exist — cheap. Microsoft Learn's own subquery-performance guidance notes there is usually no inherent performance difference between a subquery-based statement and a semantically equivalent join-based one; the optimizer normalizes many subquery forms into joins or semi-joins internally. The real performance risk is a **correlated** subquery (Q49) re-evaluated per outer row.

**8. Edge Cases**
- A scalar subquery that returns more than one row raises a runtime error ("Subquery returned more than 1 value") — this is a real failure mode when the "obviously single-row" assumption breaks (e.g., duplicate `DepartmentID`s in a table you assumed was unique).
- A scalar subquery that returns zero rows evaluates to `NULL`, not an error — `WHERE Salary > NULL` is `UNKNOWN` for every row, so the outer query silently returns nothing.

**9. Production Scenario**
Threshold-based alerting queries ("flag transactions above 3 standard deviations from this account's average") routinely use scalar subqueries for the per-account baseline, and derived tables for pre-aggregated department/region rollups feeding a reporting layer.

**10. Interview Follow-ups**
1. What happens if a scalar subquery unexpectedly returns two rows?
2. How is `ANY`/`ALL` different from `IN` for multi-row subqueries?
3. Why might the optimizer treat a derived table differently from a CTE with identical logic?
4. When would a scalar subquery be re-evaluated per row vs. once?
5. What's the difference between a subquery and a view?

**11. Follow-up Answers**
1. SQL Server raises error 512 ("Subquery returned more than 1 value...") at runtime — this is a hard failure, not a silent wrong answer, which is actually the safer failure mode compared to some of the `NULL`-related traps elsewhere in this workbook.
2. `= ANY (subquery)` is equivalent to `IN (subquery)`; `= ALL (subquery)` requires the value to equal *every* row returned (rare); `> ALL (subquery)` means "greater than the maximum" and `> ANY (subquery)` means "greater than the minimum" — these are precise but often less readable than an equivalent `MAX()`/`MIN()` scalar subquery, which is why `ANY`/`ALL` appear more in exam questions than in production code.
3. In practice, for a query executed once, the optimizer generally treats a derived table and an equivalently-defined CTE identically — both are inlined into the query plan. Differences in observed behavior are more often about how many times each is *referenced* in the outer query (a CTE referenced twice may be recomputed twice, exactly like a derived table would be, unless the optimizer spools it) rather than an inherent CTE-vs-derived-table plan distinction — verify with the actual plan rather than assuming either form is materialized.
4. Only correlated subqueries (Q49) are conceptually re-evaluated per outer row; a subquery with no reference to the outer query's columns is uncorrelated and evaluated once, regardless of syntactic position.
5. A view is a named, persisted subquery definition stored in the database catalog and reusable across many statements without repeating its SQL; a subquery/derived table is inline, single-statement-scoped, and not persisted or reusable elsewhere.

**12. Common Mistakes**
- Assuming a scalar subquery can never return multiple rows just because it "looks like" it should.
- Confusing `ANY`/`ALL` semantics (a very common source of off-by-one-comparison-direction bugs).
- Not realizing an empty-result scalar subquery yields `NULL`, not zero or an error.

**13. Architect Insight**
A senior/architect answer distinguishes these three subquery categories crisply and immediately reasons about failure modes (the multi-row-into-scalar error, the empty-result-into-`NULL` trap) rather than only describing the happy path — because in production, "subquery returned more than one value" at 2 a.m. on a batch job is a real, specific incident category interviewers are probing for.

---

## Q49. Correlated subqueries — execution cost vs. joins

**Difficulty:** 🔴 Senior

**1. Interview Answer**
A correlated subquery references a column from the *outer* query, meaning it conceptually must be re-evaluated once per outer row (unlike an uncorrelated subquery, evaluated once total). Naively, this suggests an O(N×M) cost. In practice, SQL Server's optimizer frequently rewrites correlated subqueries into an equivalent `APPLY` or semi-join physical operator that performs comparably to a hand-written join — but this transformation isn't guaranteed for every query shape, so a correlated subquery is a place to specifically check the execution plan rather than assume either "it's fine" or "it's slow."

**2. SQL Query**
```sql
-- Correlated subquery: each employee's salary compared to their own department's average
SELECT e.EmployeeID, e.Salary, e.DepartmentID
FROM Employees e
WHERE e.Salary > (
    SELECT AVG(e2.Salary) FROM Employees e2 WHERE e2.DepartmentID = e.DepartmentID
);
```

**3. Explain the Query**
The inner subquery's `WHERE e2.DepartmentID = e.DepartmentID` references `e`, the outer query's alias — this correlation is what makes it a *correlated* subquery: its result depends on which outer row is currently being evaluated, so conceptually it computes a different department average for every employee row, rather than one global number.

**4. Sample Data**
Department 10: employees with salaries 80000, 100000 (avg 90000). Department 20: salaries 60000, 90000 (avg 75000).

**5. Expected Output**
Only the 100000 employee (dept 10, above 90000 avg) and the 90000 employee (dept 20, above 75000 avg) are returned.

**6. Alternative Solutions**
- Rewrite as a join against a pre-aggregated derived table: `JOIN (SELECT DepartmentID, AVG(Salary) AS AvgSal FROM Employees GROUP BY DepartmentID) da ON da.DepartmentID = e.DepartmentID WHERE e.Salary > da.AvgSal` — computes each department's average exactly once, then joins, rather than relying on the optimizer to discover that equivalence itself.
- A window function: `SELECT * FROM (SELECT *, AVG(Salary) OVER (PARTITION BY DepartmentID) AS DeptAvg FROM Employees) x WHERE Salary > DeptAvg` — often the cleanest and most performant, since the window function computes the partitioned average in a single pass.
For this specific "compare to a group aggregate" shape, I prefer the window-function form — it's a single scan, avoids relying on the optimizer's ability to flatten a correlated subquery, and reads cleanly.

**7. Performance**
Whether the correlated subquery form performs acceptably depends entirely on whether SQL Server's optimizer can transform it into an efficient join/apply plan and whether `DepartmentID` is indexed; always verify via the actual execution plan rather than assuming either "correlated subqueries are always slow" or "the optimizer will always fix it." The pre-aggregated-join and window-function rewrites remove the ambiguity entirely by construction, which is exactly why they're the preferred production idiom for this pattern.

**8. Edge Cases**
- A department with exactly one employee: that employee's salary can never exceed their own department's average (average of one value equals that value), so they never appear — a subtle business-logic edge case worth calling out explicitly in a design/code review.
- `NULL` salaries are excluded from `AVG()` automatically, which can shift the computed average in ways that surprise reviewers if not documented.

**9. Production Scenario**
Compensation-band-outlier reports ("who's paid meaningfully above their department's/level's average") and fraud/anomaly detection ("is this transaction unusually large relative to this account's historical average") are both instances of this exact "correlated group-relative comparison" pattern.

**10. Interview Follow-ups**
1. How would you confirm whether SQL Server flattened this correlated subquery into a join?
2. Why might the window-function rewrite be preferred even if the plans end up similar?
3. What happens performance-wise if `DepartmentID` isn't indexed?
4. Is a correlated subquery in the `SELECT` list different in cost from one in `WHERE`?
5. How would you extend this to "top earner per department, with their department's average shown alongside"?

**11. Follow-up Answers**
1. Look at the actual execution plan — a flattened correlated subquery typically shows up as a nested-loop `Apply` or a hash/merge join against an aggregated build side, not a literal "subquery re-executed per row" operator; never assume from the T-SQL text alone.
2. The window-function form removes ambiguity by construction — it's guaranteed to be a single logical pass with a well-understood physical implementation (a sort or hash-based partitioned aggregate), rather than depending on the optimizer successfully proving an equivalence for this specific query shape.
3. Without an index on `DepartmentID`, both the correlated-subquery and pre-aggregated-join forms likely require scanning `Employees` per distinct department (or at best once, if flattened well) — the join/window forms remain more predictable since they don't hinge on a correlated-to-join transformation happening at all.
4. A correlated subquery in the `SELECT` list is conceptually evaluated once per output row regardless (since one row is being projected at a time) — the cost concern there is identical in kind to `WHERE`: does the optimizer flatten it into a single-pass join/apply, or does it become a real per-row nested loop against an unindexed table.
5. Combine `ROW_NUMBER() OVER (PARTITION BY DepartmentID ORDER BY Salary DESC)` with `AVG(Salary) OVER (PARTITION BY DepartmentID)` in the same `SELECT`, then filter `WHERE rn = 1` in an outer query — one single-pass window computation produces both pieces of information together (this is exactly the top-N-per-group technique used throughout Q72–Q74).

**12. Common Mistakes**
- Assuming "correlated" automatically means "slow" without checking the plan.
- Reaching for a correlated subquery when a window function would be both clearer and more predictably performant.
- Forgetting that `AVG()` silently ignores `NULL`s, skewing group-relative comparisons.

**13. Architect Insight**
A senior candidate can explain *why* correlated subqueries have a reputation for being slow (naive per-row re-evaluation) and *why* that reputation is often outdated (modern optimizers flatten many of them). An architect-level candidate goes further and defaults to the window-function form specifically to remove that ambiguity from the design entirely, rather than relying on optimizer behavior they'd have to re-verify on every SQL Server upgrade.

---

## Q50. CTE basics and readability benefits over nested subqueries

**Difficulty:** 🟢 Basic

**1. Interview Answer**
A Common Table Expression (`WITH name AS (...)`) is a named, temporary result set scoped to a single statement. Its main value is readability and composability: instead of nesting subqueries three levels deep, you name each logical step and reference it top-to-bottom, which mirrors how you'd actually reason about the problem out loud.

**2. SQL Query**
```sql
WITH DeptAverages AS (
    SELECT DepartmentID, AVG(Salary) AS AvgSalary
    FROM Employees
    GROUP BY DepartmentID
),
HighPayingDepts AS (
    SELECT DepartmentID FROM DeptAverages WHERE AvgSalary > 90000
)
SELECT e.EmployeeID, e.Salary, e.DepartmentID
FROM Employees e
INNER JOIN HighPayingDepts h ON h.DepartmentID = e.DepartmentID;
```

**3. Explain the Query**
`DeptAverages` computes one row per department with its average salary. `HighPayingDepts` filters that down to only the departments clearing the 90,000 threshold. The final `SELECT` joins `Employees` against that filtered department list — each named step is independently readable, and a reviewer can validate `DeptAverages` in isolation (by running just that CTE as a standalone query) before trusting the composed result.

**4. Sample Data**
Same as Q49: Department 10 avg 90000 (not `>` 90000, so excluded), Department 20 avg 75000 (excluded) — adjust with a Department 30 avg 120000 to show inclusion.

**5. Expected Output**
Only employees in Department 30 appear in the final result.

**6. Alternative Solutions**
- The equivalent nested-subquery form: `SELECT e.* FROM Employees e WHERE e.DepartmentID IN (SELECT DepartmentID FROM (SELECT DepartmentID, AVG(Salary) AS AvgSalary FROM Employees GROUP BY DepartmentID) x WHERE x.AvgSalary > 90000)` — functionally identical, but the nesting makes it harder to isolate and unit-test each step independently.
- A temporary table for the same intermediate result (Q52) if it needs to be reused across multiple, separate statements rather than within one.
I default to CTEs for any multi-step derivation within a single statement — nested nested subqueries beyond one level are a consistent code-review flag in my experience for readability alone.

**7. Performance**
A non-recursive CTE is, by default, **not materialized** — SQL Server inlines its definition into the outer query at compile time, exactly like an equivalent derived table (Q53). This means a CTE referenced multiple times in the same statement can have its definition logically re-evaluated for each reference unless the optimizer chooses to spool the result — CTEs are a readability construct, not a performance or caching mechanism, a very common and important misconception (elaborated fully in Q54).

**8. Edge Cases**
- Referencing a CTE name that shadows an existing table/view name in scope — legal, but a readability hazard.
- Chaining many CTEs, each depending on the last, still ultimately compiles to one query tree — extremely deep chains can affect plan-compilation time exactly like deeply nested joins would.

**9. Production Scenario**
Multi-step reporting logic (e.g., "compute daily totals, then compute a 7-day moving average of those totals, then flag days more than 2x the moving average") reads far more maintainably as three named, sequential CTEs than as triple-nested subqueries — and is much easier for a reviewer or the next engineer to modify safely.

**10. Interview Follow-ups**
1. Is a CTE the same thing as a temp table under the hood?
2. Can a CTE reference another CTE defined earlier in the same `WITH` clause?
3. What's the scope/lifetime of a CTE?
4. Can you `INSERT`/`UPDATE`/`DELETE` through a CTE?
5. Why might using the same CTE name twice in one statement still cause it to be computed twice?

**11. Follow-up Answers**
1. No — a temp table is a real, physical object in `tempdb` with its own statistics and persisted rows across multiple statements within a session/batch; a CTE is purely a textual/query-plan construct scoped to one statement, with nothing physically materialized by default (Q52 covers this trade-off in full).
2. Yes, within the same `WITH` clause, later CTEs can reference earlier ones (but not the reverse, and a CTE cannot reference itself except in the specific recursive-CTE syntax, Q51).
3. A CTE exists only for the duration of the single statement it's attached to (a `SELECT`, `INSERT`, `UPDATE`, `MERGE`, or `DELETE`) — it cannot be referenced from a subsequent, separate statement, which is the key practical difference from a temp table (Q52).
4. Yes — a CTE can be the target of `UPDATE`/`DELETE`/`MERGE` (updating "through" the CTE's underlying base table), which is a common technique for expressing complex row-targeting logic (e.g., delete-duplicates in Q68 uses exactly this pattern).
5. Because a CTE is inlined by default rather than cached — every reference to it in the outer query is, conceptually, a fresh copy of its defining query, so the optimizer may (but is not obligated to) execute the underlying logic once per reference rather than once total.

**12. Common Mistakes**
- Believing a CTE is automatically materialized/cached the first time it's referenced (addressed fully in Q54).
- Nesting subqueries deeply instead of naming intermediate steps as CTEs, hurting reviewability.
- Assuming a CTE persists beyond its single attached statement.

**13. Architect Insight**
CTEs are a readability and composability tool, not a performance tool — a senior candidate uses them for clarity and reasons about performance from the actual execution plan and indexing, never from "I named this step, so it must be efficient now." Conflating the two is one of the most common CTE misconceptions at this interview level (Q54 is the direct, deeper follow-up).

---

## Q51. Recursive CTE — hierarchy traversal

**Difficulty:** 🔴 Senior

**1. Interview Answer**
A recursive CTE has an **anchor member** (the base case — typically the root row(s)) `UNION ALL`'d with a **recursive member** that joins the CTE back to itself, referencing the previous iteration's output, repeating until the recursive member returns no more rows. It's the standard tool for traversing hierarchies (org charts, category trees, bill-of-materials) of unknown or variable depth.

**2. SQL Query**
```sql
WITH OrgChart AS (
    -- Anchor: the root(s) of the hierarchy
    SELECT EmployeeID, FirstName, LastName, ManagerID, 0 AS Level
    FROM Employees
    WHERE ManagerID IS NULL

    UNION ALL

    -- Recursive member: each employee whose manager was found in the previous iteration
    SELECT e.EmployeeID, e.FirstName, e.LastName, e.ManagerID, oc.Level + 1
    FROM Employees e
    INNER JOIN OrgChart oc ON e.ManagerID = oc.EmployeeID
)
SELECT * FROM OrgChart
ORDER BY Level, EmployeeID
OPTION (MAXRECURSION 100);
```

**3. Explain the Query**
The anchor selects everyone with no manager (`Level 0`, the root(s)). The recursive member joins `Employees` to the CTE's own prior output, matching each employee's `ManagerID` to an `EmployeeID` already found — the first execution finds direct reports of the roots (`Level 1`), the second execution finds their reports (`Level 2`), and so on, until an iteration finds zero new rows and recursion stops. `MAXRECURSION 100` is a safety cap (SQL Server's own default is 100) that turns a runaway/circular-reference bug into a controlled error rather than an infinite loop.

**4. Sample Data**
(1, Amy, ManagerID=NULL), (2, Raj, ManagerID=1), (3, Lee, ManagerID=2)

**5. Expected Output**
| EmployeeID | Level |
|---|---|
| 1 | 0 |
| 2 | 1 |
| 3 | 2 |

**6. Alternative Solutions**
- A **materialized path** or **closure table** design (storing the full ancestor chain per node, maintained on write) trades write-time complexity for O(1) read-time traversal — strongly preferred over recursive CTEs for hierarchies that are read very frequently and change relatively rarely (most org charts, most category trees).
- `HierarchyID` (SQL Server's native hierarchical data type) — built-in support for ancestor/descendant queries without recursion, at the cost of a less familiar API.
For a hierarchy queried occasionally at moderate depth, the recursive CTE is fine and simplest to write; for a hierarchy queried on a hot path at scale, I'd push for a closure table or `HierarchyID` to avoid recursive-query cost entirely on every read.

**7. Performance**
Each recursion level is effectively an additional join iteration — cost scales with hierarchy depth × fan-out per level. `ManagerID` needs an index (it's a self-referencing FK, not automatically indexed) or every recursive step degrades toward a scan. Recursive CTEs also cannot always use the same optimization techniques as a single flattened query, so very deep or very wide hierarchies (thousands of nodes, dozens of levels) are exactly where the materialized-path/closure-table alternative starts winning decisively.

**8. Edge Cases**
- Circular references (a manager cycle, a genuine data-integrity violation) would recurse forever without `MAXRECURSION`; with it, SQL Server raises an error once the cap is hit, rather than hanging.
- Multiple roots (several `ManagerID IS NULL` rows) are all included as separate trees starting at `Level 0` — valid for an org with multiple top-level executives, but worth confirming is the intended business meaning.

**9. Production Scenario**
Org-chart-based approval routing, product-category tree navigation for an e-commerce catalog, and bill-of-materials explosion (which sub-assemblies make up a manufactured product) are the three classic recursive-CTE use cases interviewers probe.

**10. Interview Follow-ups**
1. What does `MAXRECURSION 0` mean, and why is it risky?
2. How would you detect a cycle explicitly rather than relying on the recursion cap?
3. Why is a closure table often preferred for read-heavy hierarchies?
4. Can a recursive CTE do a bottom-up traversal (leaf to root) instead of top-down?
5. What's `HierarchyID` and when would you reach for it instead?

**11. Follow-up Answers**
1. `MAXRECURSION 0` removes the recursion limit entirely — appropriate only when you are certain the data cannot contain a cycle (enforced by application logic or a constraint), since otherwise a corrupted cyclic reference causes genuinely unbounded recursion and resource exhaustion.
2. Carry a delimited "path so far" string or a table-valued list of visited IDs through each recursive step, and add a `WHERE NOT EXISTS (visited IDs contains this ID)` guard in the recursive member — this converts a hang into an explicit, catchable "cycle detected" condition rather than relying on hitting the recursion cap.
3. A closure table (storing every ancestor-descendant pair, not just immediate parent-child) turns "give me all descendants of X" into a single indexed-lookup `WHERE AncestorID = X` — no recursion at read time at all — at the cost of more complex, and more numerous, writes whenever the hierarchy changes shape.
4. Yes — start the anchor member from the leaf/target node(s) instead of the root, and have the recursive member join upward via `ManagerID` instead of downward, producing the ancestor chain instead of the descendant tree.
5. `HierarchyID` is a SQL Server system data type that encodes tree position directly in a compact binary value, with built-in methods (`GetAncestor`, `IsDescendantOf`) for hierarchy queries without recursive CTEs — it's a good fit when the hierarchy is a first-class, heavily-queried part of the schema, but it's a less commonly known API and adds a learning curve for the team maintaining it.

**12. Common Mistakes**
- Omitting `MAXRECURSION` (or setting it too high) against data that isn't guaranteed cycle-free.
- Forgetting to index the self-referencing FK column driving the recursive join.
- Defaulting to a recursive CTE for a hot-path, read-heavy hierarchy instead of considering a closure table or `HierarchyID` up front.

**13. Architect Insight**
Anyone can write the anchor/recursive-member syntax. A Staff/Principal-level answer treats "how is this hierarchy actually queried in production — occasionally and shallow, or constantly and deep?" as the deciding design question, and picks between recursive CTE, closure table, and `HierarchyID` accordingly — rather than defaulting to whichever technique was most recently learned.

---

## Q52. CTE vs. temporary table — decision criteria

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Use a **temp table** when you need the intermediate result reused across *multiple separate statements* in the same batch/procedure, when it's large enough that its own statistics matter for a good plan, or when it needs to support later `UPDATE`/indexing. Use a **CTE** when the intermediate result is only needed to compose a *single* statement more readably — it adds no persistence, no independent statistics, and no ability to be indexed.

**2. SQL Query**
```sql
-- Temp table: reused across two separate statements, and can be indexed
SELECT DepartmentID, AVG(Salary) AS AvgSalary
INTO #DeptAverages
FROM Employees
GROUP BY DepartmentID;

CREATE INDEX IX_DeptAverages_DeptID ON #DeptAverages (DepartmentID);

SELECT * FROM #DeptAverages WHERE AvgSalary > 90000;
UPDATE #DeptAverages SET AvgSalary = AvgSalary * 1.03 WHERE DepartmentID = 10; -- a second, independent statement
```

**3. Explain the Query**
`SELECT ... INTO #DeptAverages` materializes the aggregate into a real, physical temp table in `tempdb`, which then has its own statistics (so the optimizer can estimate cardinality accurately for later queries against it) and can have its own index added. Crucially, `#DeptAverages` survives across multiple, independent statements in the same session/batch — a CTE could not do this; it would need to be re-declared and recomputed in every statement that needed it.

**4. Sample Data**
Same department-average data as prior questions.

**5. Expected Output**
The temp table persists and is queried, then updated, in two separate statements — something a `WITH ... AS (...)` CTE structurally cannot do, since a CTE is bound to exactly one following statement.

**6. Alternative Solutions**
- A table variable (`DECLARE @DeptAverages TABLE (...)`) — similar persistence-across-statements benefit to a temp table, but historically had much less accurate optimizer cardinality estimation (assumed low row counts) prior to SQL Server 2019's deferred compilation improvements; still generally has fewer indexing/statistics capabilities than a full temp table for large or skewed data.
- A CTE, when everything needed fits in one statement — simplest, no `tempdb` I/O at all.
Decision rule I use: single statement → CTE; multiple statements, need an index, or the intermediate set is large enough that plan quality depends on real statistics → temp table; small, short-lived, single-batch scratch space where estimation isn't critical → table variable is acceptable but no longer clearly superior to a temp table in modern SQL Server.

**7. Performance**
A temp table incurs real `tempdb` I/O (writing the intermediate result to disk-backed pages, though often cached in the buffer pool) but gains accurate statistics and optional indexing in return — a worthwhile trade the moment the intermediate result is large or is scanned/filtered multiple times. A CTE has zero materialization cost by itself, but also zero opportunity for the optimizer to use statistics on "the CTE's result" specifically — it only has statistics on the underlying base tables the CTE's definition reads from.

**8. Edge Cases**
- A temp table created inside one session is not visible to another session (local temp tables, `#name`) — global temp tables (`##name`) are visible instance-wide and carry real concurrency/cleanup considerations.
- Recompiling a stored procedure that creates and populates a temp table can trigger a plan recompilation once the temp table's row count is known — a well-documented behavior worth knowing when a procedure's plan seems to "change" mid-execution.

**9. Production Scenario**
A multi-step nightly batch job — first materialize a temp table of "accounts eligible for interest calculation," then run three separate `UPDATE`/`INSERT` statements against that temp table set — is the textbook production case for choosing a temp table over a CTE, since a CTE cannot span those separate statements at all.

**10. Interview Follow-ups**
1. Why did table variables historically get worse plans than temp tables?
2. Does a temp table participate in transactions/rollback the same way a permanent table does?
3. How would you decide between a temp table and a CTE for a single complex `SELECT` with three intermediate steps?
4. What's the cleanup/lifetime story for local vs. global temp tables?
5. Can indexing a temp table ever make a query slower?

**11. Follow-up Answers**
1. Prior to SQL Server 2019's table-variable deferred-compilation improvements, the optimizer assumed a fixed, very low row-count estimate for table variables regardless of actual content, because it didn't have real statistics to work from — this could produce badly-suited plans (e.g., a nested loop join where a hash join was needed) for anything beyond small row counts; deferred compilation narrowed but didn't eliminate this gap.
2. Yes for local operations within the current transaction — a temp table's data changes roll back with an explicit transaction rollback like any other table, but the temp table's *existence* (its `CREATE`) is typically not something application code rolls back in practice, since it's usually created outside the business transaction's scope.
3. If all three steps are used exactly once, in sequence, within a single `SELECT`, a CTE (or a chain of CTEs) is simplest and avoids `tempdb` I/O entirely; if any intermediate result is large, reused many times, or benefits from its own index, a temp table earns its overhead.
4. A local temp table (`#name`) is automatically dropped when the creating session ends (or, inside a stored procedure, generally when that procedure completes, unless created in a nested scope with different visibility rules) — a global temp table (`##name`) persists until the creating session ends *and* no other session is actively referencing it, making cleanup and concurrent-access semantics something to design around deliberately.
5. Yes — if the temp table is small or short-lived, the overhead of creating and maintaining an index can exceed the benefit of using it, and index creation itself adds a synchronous cost to the batch before the "useful" query even runs; only add an index when the temp table is large enough or reused enough times to amortize that cost.

**12. Common Mistakes**
- Defaulting to temp tables everywhere out of habit, adding unnecessary `tempdb` I/O for logic that fits cleanly in a single-statement CTE.
- Assuming a table variable is always lighter-weight than a temp table — true for trivial cases, not reliably true once row counts and skew matter.
- Forgetting that a CTE cannot be referenced from a second, separate statement.

**13. Architect Insight**
This is a design-judgment question disguised as a syntax question. A Staff/Principal-level answer names the concrete axes (statement span, need for statistics/indexing, `tempdb` cost) and picks per-situation, rather than treating either construct as a universal default — and can speak to how table-variable deferred compilation changed (but didn't erase) the historical table-variable-vs-temp-table trade-off, showing currency with the platform's evolution.

---

## Q53. CTE vs. derived table (inline subquery)

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Functionally, a non-recursive CTE and an equivalent derived table (a subquery in the `FROM` clause) are usually interchangeable — both are inlined by the optimizer, and for a single reference, plans are typically equivalent. The practical difference is almost entirely readability and reuse *within the statement*: a CTE can be defined once and referenced multiple times later in the same statement by name; a derived table must be repeated (or wrapped again) everywhere it's needed.

**2. SQL Query**
```sql
-- Derived table: must repeat the subquery if needed twice
SELECT a.DepartmentID, a.AvgSalary
FROM (SELECT DepartmentID, AVG(Salary) AS AvgSalary FROM Employees GROUP BY DepartmentID) a
WHERE a.AvgSalary > (SELECT MAX(AvgSalary) FROM (SELECT DepartmentID, AVG(Salary) AS AvgSalary FROM Employees GROUP BY DepartmentID) b) * 0.9;

-- CTE: defined once, referenced twice by name
WITH DeptAverages AS (
    SELECT DepartmentID, AVG(Salary) AS AvgSalary FROM Employees GROUP BY DepartmentID
)
SELECT a.DepartmentID, a.AvgSalary
FROM DeptAverages a
WHERE a.AvgSalary > (SELECT MAX(AvgSalary) FROM DeptAverages) * 0.9;
```

**3. Explain the Query**
Both queries find departments whose average salary is within 90% of the single highest department average. The derived-table version has to write the "average salary per department" logic twice (once as `a`, once as `b`) because a derived table has no name outside its own `FROM` clause context; the CTE version defines `DeptAverages` once and references it twice by name — same logic, no duplication, and a single place to fix if the definition ever needs to change.

**4. Sample Data**
Same department-average data as prior questions.

**5. Expected Output**
Identical results from both forms — this question is about maintainability, not output differences.

**6. Alternative Solutions**
- A window function (`AVG(Salary) OVER (PARTITION BY DepartmentID)` combined with `MAX(...) OVER ()`) could avoid the repeated-aggregation problem entirely for this specific case — again illustrating that window functions are frequently the most elegant answer once the underlying need is "compare a row to an aggregate."
- A temp table or indexed view if `DeptAverages` needs to be reused across *multiple statements*, not just within one (Q52).
For any logic referenced more than once within a single statement, I always name it via CTE — duplicating subquery text is a maintenance hazard (the two copies can drift if one is edited and the other forgotten).

**7. Performance**
Because neither form is materialized by default, referencing the same CTE (or the same derived-table logic, copy-pasted) multiple times can cause the optimizer to recompute the underlying aggregation multiple times in the final plan — using a CTE does **not**, by itself, guarantee the aggregation runs only once (that's the Q54 misconception). If profiling shows the repeated computation is genuinely expensive, materializing it once via a temp table or an indexed view is the fix, not simply switching from derived table to CTE.

**8. Edge Cases**
- Very deeply nested derived tables (subqueries inside subqueries inside subqueries) become difficult to review — this readability cliff is exactly what motivates preferring CTEs once nesting exceeds one or two levels.
- A CTE referenced many times with an expensive definition can, in the worst case, perform worse than expected precisely because engineers assume "I named it once, so it's computed once" (Q54).

**9. Production Scenario**
Financial reports computing several ratios from the same underlying aggregated dataset (e.g., "expense ratio," "loss ratio," "combined ratio" all derived from the same claims/premium rollup) are far more maintainable — and far less bug-prone under later edits — written as one named CTE referenced three times than as three independently-typed derived-table copies of the same aggregation logic.

**10. Interview Follow-ups**
1. Does SQL Server automatically avoid recomputing a CTE referenced multiple times?
2. When would you actually see a measurable performance difference between the two forms?
3. How would you force materialization if repeated computation turns out to be a real cost?
4. Is there a limit to how many times you can reference the same CTE?
5. Would a view be a better choice than either, in some cases?

**11. Follow-up Answers**
1. Not automatically and not guaranteed — the optimizer *may* choose to spool (materialize) a CTE's result if it determines that's cheaper for a specific plan, but this is a cost-based decision, not a language guarantee; verify via the execution plan (look for a "Spool" operator) rather than assuming.
2. When the CTE's/derived table's underlying definition is expensive (a large aggregation, a join across large tables) and is referenced multiple times in a plan that does *not* get spooled — that's when repeated computation shows up as real, measurable extra CPU/IO in the execution plan.
3. Materialize explicitly into a temp table (Q52) or an indexed view — both guarantee single computation with a real, reusable, statistics-backed result, removing reliance on the optimizer's spool decision.
4. No hard SQL-level limit on reference count, but every additional reference is more text for the optimizer to reason about and a further nudge toward considering materialization if the underlying query is non-trivial.
5. Yes, when the same aggregation is needed across *many different statements and* stored procedures over time, not just within one query — a view (or indexed view for a persisted, pre-computed version) is the right level of reuse; a CTE's reuse is scoped to a single statement only.

**12. Common Mistakes**
- Copy-pasting the same subquery logic multiple times instead of naming it once via CTE.
- Assuming a CTE is materialized/cached simply because it's referenced more than once.
- Reaching for a full temp table or view when the logic is genuinely single-statement-scoped and a CTE would suffice.

**13. Architect Insight**
The senior-level nuance here is refusing to treat "CTE" and "derived table" as a performance decision at all — they are a *readability and duplication* decision. Performance is a separate, plan-verified question that applies almost identically to both, and conflating the two (as many mid-level candidates do) is precisely the gap Q54 probes even more directly.

---

## Q54. Multiple/chained CTEs and the "CTE is materialized" myth

**Difficulty:** 🔥 Architect

**1. Interview Answer**
A CTE is **not** automatically materialized or cached. By default, SQL Server treats a CTE definition as inline, reusable *text* substituted at each point of reference — if a CTE is referenced three times in the outer query, the optimizer may (cost-permitting) execute its underlying logic up to three separate times, unless it decides a spool is cheaper. This is one of the most consequential and most commonly-wrong beliefs candidates carry into senior interviews, because it directly affects how you reason about the performance of any query built from chained, multiply-referenced CTEs.

**2. SQL Query**
```sql
WITH ExpensiveAggregate AS (
    -- Imagine this scans and aggregates a very large table
    SELECT CustomerID, SUM(TotalAmount) AS LifetimeValue
    FROM Orders
    GROUP BY CustomerID
)
SELECT
    (SELECT COUNT(*) FROM ExpensiveAggregate WHERE LifetimeValue > 10000) AS HighValueCount,
    (SELECT AVG(LifetimeValue) FROM ExpensiveAggregate) AS AvgLifetimeValue,
    (SELECT MAX(LifetimeValue) FROM ExpensiveAggregate) AS MaxLifetimeValue;
```

**3. Explain the Query**
`ExpensiveAggregate` is referenced three separate times in the final `SELECT`. Without an optimizer-chosen spool, this can mean the underlying `GROUP BY` over `Orders` — potentially a large, expensive scan-and-aggregate — executes up to three times in the compiled plan, not once. This is the exact scenario where "I named it once so it must run once" quietly costs 3x the necessary I/O and CPU in production.

**4. Sample Data**
Illustrative only — the point is structural (reference count), not data-dependent.

**5. Expected Output**
Correct results either way; the concern here is purely execution cost, not correctness.

**6. Alternative Solutions**
- Materialize `ExpensiveAggregate` into a **temp table** first (Q52), then run all three scalar queries against the temp table — guarantees single computation.
- Compute all three aggregates in a **single pass** using conditional aggregation: `SELECT SUM(CASE WHEN LifetimeValue > 10000 THEN 1 ELSE 0 END), AVG(LifetimeValue), MAX(LifetimeValue) FROM ExpensiveAggregate` — still only one reference to the CTE, and also only one logical pass over its result.
- Check the actual plan first — on a given SQL Server version/workload, the optimizer may already spool it; "fixing" a problem that the optimizer already solved is wasted engineering effort.
My default: rewrite to a single reference (conditional aggregation) wherever possible: it removes the ambiguity entirely rather than hoping the optimizer spools.

**7. Performance**
The concrete fix, when profiling confirms repeated computation is real and costly: either restructure to reference the CTE (or derived table) exactly once, or materialize it explicitly (temp table / indexed view) so repeated reference is genuinely free. Never assume; the `SET STATISTICS IO ON` output and the actual execution plan's operator tree are the only reliable ways to confirm whether repeated logical references turned into repeated physical work.

**8. Edge Cases**
- A recursive CTE is a completely different animal — its recursive execution model is inherently iterative and is not the "materialization" question at all; don't conflate the two when discussing this myth.
- Very cheap CTE definitions (a simple filter on an already-small, well-indexed table) make this concern moot — the "does it get recomputed" question only matters once the underlying definition is genuinely expensive.

**9. Production Scenario**
A financial dashboard computing five different KPIs (count, sum, average, min, max, percentile) from the same expensive `ExpensiveAggregate`-style CTE, written naively with five separate references, is a completely realistic way to accidentally 5x the load of a dashboard refresh query — a very plausible root cause for a "why did dashboard load time suddenly get slow" production-debugging scenario (see [[11-Troubleshooting-Scenarios]]).

**10. Interview Follow-ups**
1. How would you prove, on a specific query, whether the CTE was recomputed or spooled?
2. Does this same concern apply to derived tables and inline table-valued functions?
3. Is there a hint to force materialization of a CTE in SQL Server?
4. Why doesn't the optimizer just always spool multiply-referenced CTEs?
5. How does this misconception typically survive code review?

**11. Follow-up Answers**
1. Capture the actual execution plan (not the estimated one) and count how many times the base table(s) underneath the CTE's definition are scanned/aggregated in the operator tree — or use `SET STATISTICS IO ON` and compare logical reads against what a single pass over the base table should cost.
2. Yes, identically — a derived table referenced multiple times (if it even syntactically could be, which usually requires re-typing it) and a multi-statement inline table-valued function share the same "not automatically cached" characteristic; this is a property of how the optimizer treats inlined logical expressions generally, not something specific to the `WITH` keyword.
3. There is no direct, guaranteed "materialize this CTE" hint in standard T-SQL — the reliable way to force single materialization is to make it a real object: a temp table, table variable, or indexed view. (SQL Server *may* introduce a Spool operator on its own initiative, but that's a cost-based optimizer decision, not something you can force with a documented hint the way you can force a join type.)
4. Spooling has its own cost (writing the intermediate result to a work table in `tempdb`) — for a cheap CTE definition, referencing it multiple times inline can genuinely be cheaper than paying to spool it once; the optimizer makes this trade-off per query based on estimated costs, which is exactly why the behavior isn't a fixed rule you can memorize.
5. It survives because the query still returns *correct* results either way — the myth only costs extra CPU/IO, it never produces a wrong answer, so nothing fails in QA or code review unless someone specifically profiles the query under production-scale data volume.

**12. Common Mistakes**
- Stating in an interview that "CTEs are cached/materialized" as a flat fact — this is the single most common wrong statement candidates make about CTEs at this level.
- Refactoring nested subqueries into a multiply-referenced CTE for readability and assuming that refactor is performance-neutral or positive by default.
- Not checking the actual plan before concluding a CTE-heavy query "must" be inefficient, or "must" be fine.

**13. Architect Insight**
This question is deliberately placed last in this file because it's the one most likely to separate a Senior from a Staff/Principal answer in a live interview: a Senior candidate usually states the myth as fact ("CTEs cache their result"). A Staff/Principal candidate corrects it precisely, explains the cost-based reason the optimizer sometimes spools anyway, and — critically — reaches for the *provable* fix (single-reference rewrite or explicit materialization) rather than a belief about how the engine behaves.

**References**
1. [WITH common_table_expression (Transact-SQL) — Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/queries/with-common-table-expression-transact-sql?view=sql-server-ver17)
2. [Recursive Queries Using Common Table Expressions — Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/queries/recursive-common-table-expression-transact-sql?view=sql-server-ver17)
3. [Nested Common Table Expression (CTE) — Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/queries/nested-common-table-expression?view=sql-server-ver17)
4. [Subqueries (SQL Server) — Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/performance/subqueries?view=sql-server-ver17)
5. [tempdb Database — Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/databases/tempdb-database?view=sql-server-ver16)
6. [CREATE TABLE (Transact-SQL) — Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-table-transact-sql?view=sql-server-ver17)
