> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: [[06-Window-Functions]]

# SQL Server Interview Workbook — Query Problems: Rankings, Duplicates & Departmental Aggregates

This file is part of the **Top SQL Interview Questions & Answers Workbook** for `04-SQL-Server`. It covers global questions **Q65–Q74**: the classic "rankings and duplicates" family that shows up in nearly every senior SQL interview. Every problem is solved with a window-function approach first (the production-grade, SQL Server–idiomatic answer) and at least one non-window alternative, because interviewers at this level want to see you reason about *why* one approach is preferred, not just that you know the syntax.

**Canonical schema used throughout this file:**

```sql
CREATE TABLE dbo.Departments
(
    DepartmentID   INT           NOT NULL PRIMARY KEY,
    DepartmentName VARCHAR(100)  NOT NULL
);

CREATE TABLE dbo.Employees
(
    EmployeeID   INT           NOT NULL PRIMARY KEY,
    FirstName    VARCHAR(50)   NOT NULL,
    LastName     VARCHAR(50)   NOT NULL,
    DepartmentID INT           NULL REFERENCES dbo.Departments(DepartmentID),
    ManagerID    INT           NULL REFERENCES dbo.Employees(EmployeeID),
    Salary       DECIMAL(12,2) NOT NULL,
    HireDate     DATE          NOT NULL
);
```

---

### Q65. Find the second-highest salary

**Difficulty:** 🟢 Basic

**1. Interview Answer**
The second-highest salary is the salary ranked #2 when all *distinct* salary values are ordered descending. The classic trap is treating this as "the second row," which breaks the moment two employees share the top salary. `DENSE_RANK()` is the right tool because it ranks by distinct value, not by row.

**2. SQL Query**
```sql
SELECT Salary AS SecondHighestSalary
FROM (
    SELECT Salary, DENSE_RANK() OVER (ORDER BY Salary DESC) AS SalaryRank
    FROM dbo.Employees
) AS Ranked
WHERE SalaryRank = 2;
```

**3. Explain the Query**
1. The inner query assigns a dense rank to every row based on `Salary DESC`. `DENSE_RANK` gives identical rank to tied salaries and never skips a rank number.
2. The outer query filters to `SalaryRank = 2`, which is "the second distinct salary value," not "the second row."
3. If multiple employees earn that second-highest salary, all of them are returned — which is usually what "the second-highest salary" means in a business sense (compensation is a value, not a row).

**4. Sample Data**

| EmployeeID | Salary |
|---|---|
| 1 | 90000 |
| 2 | 90000 |
| 3 | 85000 |
| 4 | 70000 |

**5. Expected Output**

| SecondHighestSalary |
|---|
| 85000 |

**6. Alternative Solutions**
- **`OFFSET/FETCH` on distinct values:**
  ```sql
  SELECT DISTINCT Salary
  FROM dbo.Employees
  ORDER BY Salary DESC
  OFFSET 1 ROWS FETCH NEXT 1 ROWS ONLY;
  ```
  Simple and readable, but only returns one row even if there's a tie for second — semantically different from the `DENSE_RANK` version.
- **Correlated subquery:**
  ```sql
  SELECT MAX(Salary) AS SecondHighestSalary
  FROM dbo.Employees
  WHERE Salary < (SELECT MAX(Salary) FROM dbo.Employees);
  ```
  Elegant for exactly "2nd highest," but doesn't generalize to "Nth highest" without nesting further (see Q66).
- **Preferred:** `DENSE_RANK()` — it's the one that generalizes cleanly to Q66 and correctly handles ties, and it reads its intent directly ("give me rank 2").

**7. Performance**
An index on `Salary` (or a covering index including `Salary`) lets SQL Server produce the `DENSE_RANK` via an ordered index scan instead of a sort. Without an index, the optimizer sorts the full table, an `O(n log n)` operation with a memory grant sized off cardinality estimates. On a small `Employees` table this is irrelevant; on tens of millions of compensation rows it becomes the dominant cost, and the sort is a common `SORT` operator you'd see in the execution plan spilling to `tempdb` if the memory grant undershoots.

**8. Edge Cases**
- **Fewer than 2 distinct salaries:** the query returns zero rows — no error, but the caller must handle "no second-highest exists" rather than assuming a value.
- **NULL salaries:** `NULL` sorts last in `ORDER BY ... DESC` in SQL Server by default (NULLs low), so a `NULL` salary won't wrongly appear as "second highest" ahead of real values — but confirm the column is `NOT NULL` in production; a nullable compensation column is itself a modeling smell.
- **All salaries identical:** `DENSE_RANK` gives every row rank 1, so "second highest" correctly returns no rows.

**9. Production Scenario**
Compensation-band reporting for HR/finance ("show me the top two pay tiers in each cost center") and compliance dashboards that must flag pay compression (when the 2nd-highest is suspiciously close to the highest).

**10. Interview Follow-ups**
1. How would you find the 2nd-highest salary *per department*?
2. What changes if "second highest" must mean "second highest distinct row including ties counted individually" (i.e., row-based, not value-based)?
3. How do you make this parameterized for "Nth highest"?
4. What index would you create to make this fast at scale, and why?
5. How does this differ from `TOP 1` with `OFFSET`?

**11. Follow-up Answers**
1. Add `PARTITION BY DepartmentID` to the `OVER` clause — this is exactly Q73.
2. Swap `DENSE_RANK()` for `ROW_NUMBER()`; row-based semantics means ties are broken arbitrarily by whatever tiebreaker `ORDER BY` provides (add a deterministic tiebreaker like `EmployeeID` to avoid nondeterminism).
3. Parameterize the rank filter: `WHERE SalaryRank = @N` — this is Q66.
4. A nonclustered index on `(Salary)` — or `(Salary) INCLUDE (EmployeeID)` if you need to identify who — avoids a full table scan/sort; the leading column must be the one you rank on.
5. `TOP 1 ... OFFSET` operates on *rows*, so ties collapse to a single row unpredictably unless you add explicit tiebreakers; `DENSE_RANK` operates on *values*, which is almost always the correct business semantics for "Nth highest salary."

**12. Common Mistakes**
- Using `ROW_NUMBER()` and silently dropping ties, then being surprised when compensation audits show more than one person at "the" second-highest salary.
- Writing `SELECT MAX(Salary) FROM Employees WHERE Salary != (SELECT MAX(Salary) FROM Employees)` — this is wrong whenever two employees share the maximum salary, because it excludes *all* of them, potentially skipping straight to the third-highest value.
- Forgetting `DISTINCT` in the `OFFSET/FETCH` alternative, which then treats duplicate salary rows as consuming rank slots.

**13. Architect Insight**
A Senior candidate solves this correctly. A Staff/Principal candidate immediately asks "second-highest *by value* or *by row*, and does the interviewer's schema even guarantee uniqueness?" — then picks `DENSE_RANK` and states the tie-handling decision explicitly before writing code. That's the tell: architects treat ambiguous requirements as a design decision to surface, not an assumption to silently bake in.

---

### Q66. Find the Nth-highest salary (parameterized, general solution)

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Generalize Q65 by parameterizing the rank filter. `DENSE_RANK()` remains the right tool because "Nth highest" is a statement about distinct values, and the pattern scales to any N without restructuring the query.

**2. SQL Query**
```sql
DECLARE @N INT = 3;

SELECT Salary AS NthHighestSalary
FROM (
    SELECT Salary, DENSE_RANK() OVER (ORDER BY Salary DESC) AS SalaryRank
    FROM dbo.Employees
) AS Ranked
WHERE SalaryRank = @N;
```

As a reusable inline table-valued function for production use:
```sql
CREATE OR ALTER FUNCTION dbo.GetNthHighestSalary (@N INT)
RETURNS TABLE
AS
RETURN
(
    SELECT Salary AS NthHighestSalary
    FROM (
        SELECT Salary, DENSE_RANK() OVER (ORDER BY Salary DESC) AS SalaryRank
        FROM dbo.Employees
    ) AS Ranked
    WHERE SalaryRank = @N
);
GO
-- SELECT * FROM dbo.GetNthHighestSalary(3);
```

**3. Explain the Query**
Identical mechanics to Q65, but `@N` replaces the hard-coded `2`. Wrapping it in an inline table-valued function (iTVF, not a multi-statement TVF) means SQL Server can inline and optimize it as if it were pasted directly into the calling query — multi-statement TVFs, by contrast, are optimized as black boxes with a fixed row-count estimate (historically 1, or 100 in newer cardinality estimator versions), which misleads the optimizer's join and memory-grant decisions.

**4. Sample Data**
Same as Q65 (90000, 90000, 85000, 70000). `@N = 3` should return `70000` because 90000 is rank 1, 85000 is rank 2, 70000 is rank 3 — the tie at rank 1 does not create a gap (that's exactly why `DENSE_RANK`, not `RANK`, is correct here).

**5. Expected Output**

| NthHighestSalary |
|---|
| 70000 |

**6. Alternative Solutions**
- **`RANK()` instead of `DENSE_RANK()`:** wrong for this problem — `RANK` would make the tie at rank 1 consume two rank slots, skipping straight to rank 3 for 85000, so "2nd highest" would return nothing. This distinction is one of the most common trip-ups at this level.
- **Recursive/`OFFSET` approach:** `OFFSET (@N - 1) ROWS FETCH NEXT 1 ROWS ONLY` over `SELECT DISTINCT Salary ... ORDER BY Salary DESC` — works, but only returns a single row per N even with ties, changing the semantics.
- **Preferred:** `DENSE_RANK()` in a parameterized iTVF — correct tie semantics, inlinable, reusable.

**7. Performance**
Same indexing story as Q65: an index on `Salary` avoids a full sort. The critical performance point unique to this question is the **iTVF vs. multi-statement TVF** choice — a multi-statement TVF materializes its result into a work table and is treated as an opaque row-count guess by the optimizer, which can produce catastrophic plans when joined against other tables. Always prefer inline TVFs (a single `RETURN (SELECT ...)`) for reusable parameterized queries like this.

**8. Edge Cases**
- `@N` larger than the number of distinct salaries → zero rows, not an error; callers must check for this.
- `@N <= 0` → also zero rows; validate in the application layer or add a `CHECK`/guard clause if this function is exposed broadly.
- Negative or NULL `@N` → NULL comparison in `WHERE SalaryRank = NULL` never matches (three-valued logic), silently returning empty rather than erroring — worth an explicit `IF @N IS NULL RAISERROR(...)` guard in production code.

**9. Production Scenario**
Compensation review tooling where an HR analyst picks an arbitrary percentile-adjacent cutoff ("show me who's in the top 5 pay bands") without redeploying code for each N.

**10. Interview Follow-ups**
1. Why prefer an inline TVF over a stored procedure returning a result set here?
2. How would you defend against SQL injection if `@N` came from user input in dynamic SQL?
3. How does this change if you need the Nth highest *per department* simultaneously for all departments?
4. What happens to performance if this function is called inside a `CROSS APPLY` for every row of another table?

**11. Follow-up Answers**
1. An iTVF can be inlined into the caller's plan and can participate in joins/`APPLY` naturally; a stored procedure's result set can't be joined against directly without `INSERT ... EXEC` into a temp table, which loses statistics and forces an extra materialization step.
2. `@N` is a typed `INT` parameter here, not string-concatenated, so there's no injection surface — this is exactly the argument for parameterized queries over dynamic SQL string-building for numeric inputs.
3. Add `PARTITION BY DepartmentID` inside the `OVER` clause and drop the outer filter to `SalaryRank = @N` per partition — one query returns every department's Nth-highest salary simultaneously, which is far better than calling this function once per department.
4. If used in `CROSS APPLY` per outer row, an iTVF re-evaluates the full ranking subquery for every outer row unless the optimizer can push the outer row's filter down — profile with `SET STATISTICS IO ON` before assuming this is fine at scale; for large N-per-row scenarios, prefer computing all ranks once with `PARTITION BY` and joining, not `APPLY`-ing a scalar-style lookup per row.

**12. Common Mistakes**
- Using `RANK()` and getting `NULL`/no result for a tie scenario that `DENSE_RANK()` would have handled correctly.
- Writing this as a multi-statement TVF (`RETURNS @Result TABLE (...) AS BEGIN ... END`) out of habit, without realizing the optimizer treats it as a black box.
- Not validating `@N` before use, letting silent empty results masquerade as "there is no such salary" when actually the input was invalid.

**13. Architect Insight**
The junior-to-senior line here is knowing `DENSE_RANK` vs `RANK`. The senior-to-staff line is knowing *why* a multi-statement TVF is a performance trap and defaulting to inline TVFs for anything reusable and parameterized. The staff-to-architect line is recognizing that "Nth highest, per employee" and "Nth highest per department, for all departments" are the same mechanism (`PARTITION BY`) and refusing to write N separate queries when one windowed query answers all groups at once.

---

### Q67. Find duplicate records in a table

**Difficulty:** 🟢 Basic

**1. Interview Answer**
"Duplicate" must first be defined precisely: duplicate by *every* column, or duplicate by a specific business key (e.g., same `FirstName`+`LastName`+`DepartmentID` but different `EmployeeID`)? Once defined, `GROUP BY` the duplicate-defining columns with `HAVING COUNT(*) > 1` finds the duplicate groups; if you need the actual row identifiers, a window-function approach is cleaner.

**2. SQL Query**
```sql
-- Duplicate groups by business key (name + department)
SELECT FirstName, LastName, DepartmentID, COUNT(*) AS DuplicateCount
FROM dbo.Employees
GROUP BY FirstName, LastName, DepartmentID
HAVING COUNT(*) > 1;

-- Individual duplicate rows, with a row number to identify "extra" copies
SELECT *
FROM (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY FirstName, LastName, DepartmentID ORDER BY EmployeeID) AS rn
    FROM dbo.Employees
) AS Dedup
WHERE rn > 1;
```

**3. Explain the Query**
1. The `GROUP BY`/`HAVING` form answers "which combinations of values appear more than once" — good for a summary report.
2. The `ROW_NUMBER()` form answers "which specific rows are the extras" — it partitions by the duplicate-defining key, numbers each partition starting at 1 in `EmployeeID` order (or `HireDate`, or whatever tiebreak defines "the original"), and `rn > 1` marks every row after the first as a duplicate.
3. This second form is what you build on directly for Q68 (deleting duplicates).

**4. Sample Data**

| EmployeeID | FirstName | LastName | DepartmentID |
|---|---|---|---|
| 1 | Alex | Kim | 10 |
| 2 | Alex | Kim | 10 |
| 3 | Priya | Rao | 20 |

**5. Expected Output** (individual-rows form)

| EmployeeID | FirstName | LastName | DepartmentID | rn |
|---|---|---|---|---|
| 2 | Alex | Kim | 10 | 2 |

**6. Alternative Solutions**
- **`GROUP BY`/`HAVING`:** best for a count/summary; doesn't identify which specific row to keep or drop.
- **`ROW_NUMBER()` windowed:** best when you need to act on individual rows (delete, flag, merge).
- **Self-join:** `SELECT e1.* FROM Employees e1 JOIN Employees e2 ON e1.FirstName = e2.FirstName AND e1.LastName = e2.LastName AND e1.DepartmentID = e2.DepartmentID AND e1.EmployeeID > e2.EmployeeID` — works but reads less clearly than the window-function form and can be quadratic-feeling without a good index; window functions are generally preferred in modern SQL Server for this pattern.
- **Preferred:** `ROW_NUMBER()` — one pass, clear intent, directly reusable for deletion.

**7. Performance**
An index on the duplicate-defining columns `(FirstName, LastName, DepartmentID)` lets both the `GROUP BY` and the `PARTITION BY` avoid an expensive sort/hash-aggregate over the whole table. On very large tables, prefer the `GROUP BY`/`HAVING` form first to get a *count* of how bad the problem is before running the row-level query — this avoids materializing a huge duplicate set if the answer is "there are 40 million duplicates and something upstream is badly broken."

**8. Edge Cases**
- Duplicate definition ambiguity: if "duplicate" means the *entire row* (all columns identical, including `EmployeeID`), then by definition no two rows can be duplicates if there's a primary key — the question only makes sense once you exclude the surrogate key from the comparison.
- NULLs in the key columns: `GROUP BY` treats two `NULL`s as equal for grouping purposes (unlike `=` comparisons in `WHERE`, where `NULL = NULL` is `UNKNOWN`) — this is a common source of confusion and worth calling out explicitly in an interview.
- Case sensitivity: whether `'Alex'` and `'ALEX'` count as duplicates depends entirely on the column's collation; a case-insensitive collation (the SQL Server default in most installs) treats them as equal.

**9. Production Scenario**
Data-quality audits after a bulk import or a merge of two customer databases (post-acquisition), where the same customer or employee may have been entered twice under slightly different source systems.

**10. Interview Follow-ups**
1. How do you find duplicates across *all* columns without listing every column name?
2. How would you handle case-insensitive vs. case-sensitive duplicate detection explicitly, regardless of the column's default collation?
3. How does this scale to a 500-million-row table?
4. What's the difference between a duplicate and a near-duplicate (fuzzy match), and how would you even begin to detect the latter in T-SQL?

**11. Follow-up Answers**
1. Use `CHECKSUM(*)` or `HASHBYTES('SHA2_256', CONCAT(col1, '|', col2, ...))` grouped with `HAVING COUNT(*) > 1`, then verify real matches with a full row comparison — hash collisions are rare but non-zero, so never delete solely on a checksum match without verifying the underlying columns.
2. Wrap the comparison columns in `UPPER()`/`LOWER()`, or explicitly `COLLATE Latin1_General_BIN2` (or your chosen case-sensitive collation) inside the `GROUP BY`/`PARTITION BY` to force the semantics regardless of the column's default collation.
3. At 500M rows, avoid an unindexed full-table `GROUP BY`; build a covering nonclustered index on the key columns first, or better, batch the check by a partitioning key (date range, region) and run it incrementally rather than as one giant scan — see Q115 for the general large-table strategy.
4. A near-duplicate ("Jon Smith" vs. "John Smith") requires fuzzy matching — SOUNDEX/DIFFERENCE for phonetic similarity, or `Data Quality Services`/external libraries for edit-distance matching; plain T-SQL equality/hash comparisons only catch exact duplicates.

**12. Common Mistakes**
- Grouping on every column including the primary key, which guarantees zero duplicates are ever found (since the PK is unique by definition) — then wrongly concluding "there are no duplicates."
- Assuming `NULL = NULL` behaves the same in `GROUP BY` as in `WHERE` — leads to confusion when NULL-keyed rows group together unexpectedly.
- Deleting based on `GROUP BY`/`HAVING` output directly without first identifying *which* row to keep (see Q68) — this can delete every copy including the "real" one if not careful.

**13. Architect Insight**
Anyone can write `GROUP BY ... HAVING COUNT(*) > 1`. What separates a senior answer is opening with "duplicate by what definition, and what's the tiebreak for which copy survives?" before touching the keyboard — because in production, "delete the duplicates" is never really the ask; "which one is authoritative, and why" is the actual decision, and that decision usually belongs to the business, not the database.

---

### Q68. Delete duplicate records while keeping exactly one

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Use a CTE wrapping the `ROW_NUMBER()` pattern from Q67, then `DELETE` from the CTE where `rn > 1`. Deleting through a CTE is fully supported in T-SQL and is the standard, safe pattern for this — always run the equivalent `SELECT` first to verify exactly which rows would be removed.

**2. SQL Query**
```sql
WITH Deduped AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY FirstName, LastName, DepartmentID
               ORDER BY EmployeeID  -- defines which copy is "kept" (the earliest EmployeeID)
           ) AS rn
    FROM dbo.Employees
)
DELETE FROM Deduped
WHERE rn > 1;
```

**3. Explain the Query**
1. The CTE computes a `ROW_NUMBER()` per duplicate group exactly as in Q67.
2. `DELETE FROM Deduped WHERE rn > 1` deletes through the CTE — SQL Server translates this back into deletes against the base table `dbo.Employees`, because a CTE is not materialized; it's a named subquery in the plan.
3. The row with `rn = 1` (lowest `EmployeeID`, or whatever the `ORDER BY` picks) is kept; every later duplicate is removed.

**4. Sample Data** (same as Q67: two "Alex Kim" rows, EmployeeID 1 and 2)

**5. Expected Output**
After running, `SELECT * FROM dbo.Employees WHERE FirstName = 'Alex'` returns only `EmployeeID = 1` — the row with `EmployeeID = 2` is gone.

**6. Alternative Solutions**
- **CTE + `DELETE` (shown above):** the standard, safest approach — the `SELECT` you'd run to verify is nearly identical to the `DELETE`, minimizing the chance of a mismatch between "what I checked" and "what I deleted."
- **`DELETE` with a self-join:**
  ```sql
  DELETE e1
  FROM dbo.Employees AS e1
  JOIN dbo.Employees AS e2
      ON e1.FirstName = e2.FirstName
     AND e1.LastName = e2.LastName
     AND e1.DepartmentID = e2.DepartmentID
     AND e1.EmployeeID > e2.EmployeeID;
  ```
  Deletes every row that has *any* earlier duplicate — correct, but less obviously correct at a glance than the CTE form, and harder to eyeball-verify before running.
- **Preferred:** CTE + `ROW_NUMBER()` — the verify-then-delete workflow (run the `SELECT` inside the CTE first, confirm row count, then swap to `DELETE`) is the safest production pattern and is what interviewers expect you to describe unprompted.

**7. Performance**
This is a write operation: SQL Server takes row/page locks (or escalates to a table lock past ~5,000 rows affected in one statement, see [locking documentation](https://learn.microsoft.com/en-us/sql/relational-databases/performance/joins) and the Transactions/Isolation file's lock-escalation coverage) and fully logs every deleted row (`DELETE` is always fully logged, unlike `TRUNCATE`). On a large table, batch the delete (`DELETE TOP (10000) FROM Deduped WHERE rn > 1` in a loop) to avoid a single giant transaction that balloons the transaction log and holds locks for an extended period, blocking concurrent writers.

**8. Edge Cases**
- Running the `DELETE` twice is idempotent-safe in effect (the second run finds no `rn > 1` rows left), but re-running it inside the same uncommitted transaction as the first has no additional effect — always confirm with a `SELECT COUNT(*)` after, not just "no error was thrown."
- If the table has foreign keys referencing the duplicate rows (e.g., `Orders.EmployeeID` pointing at the duplicate's `EmployeeID`), the delete fails with a constraint violation unless those references are repointed to the surviving row first — this is the real-world complication that makes "just delete the duplicates" rarely a one-line fix.
- No `ORDER BY` tiebreaker in the `PARTITION BY` beyond a non-unique column risks nondeterministic "which row survives" if two duplicate rows are otherwise identical — always order by a unique, meaningful column (the surrogate key, or `CreatedAt`).

**9. Production Scenario**
Cleanup after a batch-import job re-ran without an idempotency guard and inserted the same file's rows twice — a very common real incident, especially in nightly ETL pipelines without a staging/upsert pattern.

**10. Interview Follow-ups**
1. How do you handle foreign-key references to the rows being deleted?
2. How would you do this safely on a live, high-traffic table without a long-lived lock?
3. How do you decide which duplicate to keep when "lowest ID" isn't the right business rule (e.g., "keep the one with the most complete data")?
4. How would you prevent this from happening again at the source?

**11. Follow-up Answers**
1. First `UPDATE` the child table's foreign key to point at the surviving `EmployeeID` (matched via the same `ROW_NUMBER()`/`MIN(EmployeeID)` logic per duplicate group), then delete the duplicate parent rows — order matters, and this is exactly the kind of multi-step operation that belongs in an explicit transaction with error handling.
2. Batch the delete in small chunks (e.g., 5,000 rows at a time) inside a loop, each in its own short transaction, to avoid holding locks/log space for a long duration; consider running during a low-traffic window and monitoring blocking (`sys.dm_exec_requests`) as you go.
3. Replace the `ORDER BY EmployeeID` in the `ROW_NUMBER()` with a more meaningful tiebreak — e.g., `ORDER BY (CASE WHEN Email IS NOT NULL THEN 0 ELSE 1 END), EmployeeID` to prefer the more complete row; this is a business decision to confirm with stakeholders, not something to assume.
4. Add a unique constraint or unique filtered index on the natural key (or an idempotency key on the import batch) so the database itself rejects the duplicate insert at the source — turning "detect and clean up duplicates" into "duplicates can no longer occur."

**12. Common Mistakes**
- Deleting without running the equivalent `SELECT` first to confirm row count and identity.
- Deleting all rows in a duplicate group (forgetting `rn > 1` and using `rn >= 1`), wiping out the data entirely.
- Not wrapping the operation in an explicit transaction with a way to roll back if the foreign-key repointing step (see follow-up 1) fails partway through.

**13. Architect Insight**
A Senior engineer writes the correct `DELETE`. A Principal engineer asks "why did duplicates get created in the first place, and can I add a constraint that makes this class of bug structurally impossible going forward" — treating the cleanup as a symptom, not the fix. That reframing (unique constraint at the source vs. a one-time cleanup script) is the recurring architect-level move across this entire "find duplicates" family of questions.

---

### Q69. Find employees earning more than their manager

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
This is a self-join: join `Employees` to itself on `ManagerID = ManagerEmployeeID`, then filter where the employee's salary exceeds the manager's. It tests whether you can comfortably alias the same table twice and reason about a hierarchical relationship stored as a self-referencing foreign key.

**2. SQL Query**
```sql
SELECT
    e.EmployeeID,
    e.FirstName + ' ' + e.LastName AS EmployeeName,
    e.Salary AS EmployeeSalary,
    m.FirstName + ' ' + m.LastName AS ManagerName,
    m.Salary AS ManagerSalary
FROM dbo.Employees AS e
JOIN dbo.Employees AS m
    ON e.ManagerID = m.EmployeeID
WHERE e.Salary > m.Salary;
```

**3. Explain the Query**
1. `dbo.Employees` is aliased twice: `e` for the employee row, `m` for that employee's manager row.
2. The join condition `e.ManagerID = m.EmployeeID` walks the self-referencing foreign key: "find the row whose `EmployeeID` matches this employee's `ManagerID`."
3. `WHERE e.Salary > m.Salary` filters to only the cases where the report out-earns their manager.
4. This is an `INNER JOIN`, so employees with `ManagerID IS NULL` (e.g., the CEO) are automatically excluded — they have no manager to compare against, which is correct.

**4. Sample Data**

| EmployeeID | Name | ManagerID | Salary |
|---|---|---|---|
| 1 | Dana (CEO) | NULL | 200000 |
| 2 | Sam | 1 | 150000 |
| 3 | Priya | 2 | 160000 |

**5. Expected Output**

| EmployeeID | EmployeeName | EmployeeSalary | ManagerName | ManagerSalary |
|---|---|---|---|---|
| 3 | Priya | 160000 | Sam | 150000 |

**6. Alternative Solutions**
- **Self-join (shown above):** the clearest, most idiomatic solution — preferred.
- **Correlated subquery:**
  ```sql
  SELECT e.*
  FROM dbo.Employees e
  WHERE e.Salary > (SELECT m.Salary FROM dbo.Employees m WHERE m.EmployeeID = e.ManagerID);
  ```
  Works, and is arguably just as readable; functionally near-identical to the join since the correlated subquery here returns a single scalar (`EmployeeID` is a primary key, so at most one row matches).
- **Preferred:** the self-join, because it naturally extends to also selecting the manager's columns (name, department) in the same result set without a second round-trip — the correlated-subquery form only produces a scalar comparison unless repeated per column you need.

**7. Performance**
The self-join needs an index on `ManagerID` (a foreign key column is *not* automatically indexed in SQL Server — this trips people up constantly) so the join can seek into `m` instead of scanning. Without that index, this becomes a nested-loop or hash join against a full table scan of `Employees` for every outer row, which is fine at 10,000 employees and painful at 10 million.

**8. Edge Cases**
- CEO / top-of-hierarchy rows with `ManagerID IS NULL` are excluded by the `INNER JOIN` — correct behavior, but confirm this is the intended semantic (an outer join would include them with NULL manager columns and never satisfy `Salary > NULL`, which is `UNKNOWN`, so they'd be excluded either way — but be explicit about which join type you chose and why).
- Circular management references (a data-integrity bug where A manages B and B manages A) don't break this particular query, but they *do* break a recursive-CTE traversal of the same hierarchy (see the recursive-CTE coverage in `05-Subqueries-CTEs.md`) — worth mentioning proactively as a related risk.
- Ties (`e.Salary = m.Salary`) are correctly excluded by the strict `>` — confirm whether the business wants `>=` treated differently ("earns at least as much as").

**9. Production Scenario**
Compensation-equity audits and compliance checks — pay-compression anomalies where a report out-earns their manager are often flagged during annual comp review as either a promotion-lag issue or a data-entry error in the reporting-line table.

**10. Interview Follow-ups**
1. How would you find employees who earn more than the *average* salary of their entire management chain (not just their direct manager)?
2. How does this query behave for the CEO, and is that correct?
3. What index(es) would you add, and why isn't the FK auto-indexed?
4. How would you extend this to show the salary *gap*, sorted descending?

**11. Follow-up Answers**
1. That requires walking the full chain via a recursive CTE to collect all ancestors per employee, then aggregating — a materially harder problem than the direct-manager case; sketch the recursive CTE (anchor: self; recursive: join to `ManagerID`) then `AVG()` over the collected ancestor salaries.
2. The CEO has `ManagerID = NULL`; the inner join drops that row entirely since there's nothing to match — correct, since "earns more than their manager" is undefined for someone with no manager.
3. Add `CREATE INDEX IX_Employees_ManagerID ON dbo.Employees(ManagerID) INCLUDE (Salary);` — SQL Server never auto-creates indexes on FK columns (unlike the PK, which gets a unique clustered/nonclustered index automatically); this is one of the most common "the FK exists but the query is still slow" interview gotchas.
4. Add `(e.Salary - m.Salary) AS SalaryGap` to the `SELECT` list and `ORDER BY SalaryGap DESC`.

**12. Common Mistakes**
- Forgetting to alias the table twice and instead trying to self-reference column names without disambiguation, which SQL Server rejects as ambiguous.
- Assuming the `ManagerID` foreign key is indexed by default — it isn't, and this query is the textbook case where that assumption causes a production slowdown.
- Using `LEFT JOIN` instead of `INNER JOIN` without a reason, then having to remember that `NULL > NULL` filters those rows out anyway — functionally similar result via a more confusing path.

**13. Architect Insight**
The self-join itself is Senior-level table stakes. What separates a Staff/Principal answer is proactively naming the FK-indexing gotcha *before* being asked, and recognizing that "earns more than their manager" is a one-hop version of a general hierarchy-traversal problem — the same underlying skill (self-referencing joins vs. recursive CTEs) that shows up again in org-chart, bill-of-materials, and category-tree problems throughout the rest of this workbook.

---

### Q70. Find employees with no department assigned

**Difficulty:** 🟢 Basic

**1. Interview Answer**
This is a `NULL` check, not a join-mismatch problem, because `DepartmentID` lives directly on `Employees` as a nullable foreign key. `WHERE DepartmentID IS NULL` is the entire answer — the interview value here is in correctly explaining *why* `= NULL` doesn't work.

**2. SQL Query**
```sql
SELECT EmployeeID, FirstName, LastName
FROM dbo.Employees
WHERE DepartmentID IS NULL;
```

**3. Explain the Query**
`IS NULL` is a dedicated predicate, not a comparison operator — SQL's three-valued logic means `DepartmentID = NULL` always evaluates to `UNKNOWN` (never `TRUE`), even when `DepartmentID` genuinely has no value, so a `WHERE DepartmentID = NULL` clause silently returns zero rows regardless of data. `IS NULL` is the only correct way to test for the absence of a value.

**4. Sample Data**

| EmployeeID | DepartmentID |
|---|---|
| 1 | 10 |
| 2 | NULL |

**5. Expected Output**

| EmployeeID |
|---|
| 2 |

**6. Alternative Solutions**
- **`IS NULL` (shown above):** the only correct, idiomatic form.
- **`NOT EXISTS` against Departments:** unnecessary here since `DepartmentID` is a direct column, not something requiring a join to detect absence — but this pattern *does* become necessary for Q75/Q77 (customers/products with no matching child rows in another table), where the "missing" relationship lives in a join, not a nullable column.
- There is no genuinely competing alternative for this specific case — the point of the question is recognizing when a simple `IS NULL` suffices versus when an anti-join (`NOT EXISTS`/`LEFT JOIN ... WHERE ... IS NULL`) is required, which is exactly what Q75 and Q77 test next.

**7. Performance**
A nonclustered index on `DepartmentID` supports an efficient seek for `IS NULL` (SQL Server indexes NULLs like any other value in a B-tree, at one position), so this is cheap even at scale, provided the number of NULL rows is a small fraction of the table (otherwise the optimizer may reasonably choose a scan).

**8. Edge Cases**
- Confusing "no department" (`DepartmentID IS NULL`) with "assigned to a department that no longer exists" (an orphaned foreign key value with no matching row in `Departments`) — the second case shouldn't be possible if the FK constraint is enforced, but *is* possible if the constraint was added `WITH NOCHECK` or the FK was dropped temporarily during a migration. Always verify FK trust status (`sys.foreign_keys.is_not_trusted`) if you suspect this.
- `0` as a sentinel "no department" value instead of `NULL` — a schema smell interviewers sometimes plant deliberately; if you see a `DepartmentID = 0` convention, `IS NULL` won't catch those rows, and you must ask which convention is actually in use.

**9. Production Scenario**
Onboarding-pipeline audits: new hires entered into the HR system before their department assignment is finalized, or a bulk-import bug that dropped the `DepartmentID` column for a batch of records.

**10. Interview Follow-ups**
1. Why doesn't `WHERE DepartmentID = NULL` work?
2. How would this differ if "no department" meant "assigned to a department not present in the Departments table"?
3. How do you find the *count* of employees per NULL/non-NULL department status, in one query?
4. What does `ANSI_NULLS` control, and is it relevant here?

**11. Follow-up Answers**
1. `NULL` represents "unknown/absent," and per ANSI SQL three-valued logic, any comparison operator (`=`, `<>`, `<`, etc.) against `NULL` evaluates to `UNKNOWN`, which `WHERE` treats the same as `FALSE` — only `IS NULL`/`IS NOT NULL` are defined to test for it directly.
2. That's an anti-join: `LEFT JOIN Departments d ON e.DepartmentID = d.DepartmentID WHERE d.DepartmentID IS NULL` (or `NOT EXISTS`), catching both truly-NULL FKs and orphaned non-NULL FK values with no matching parent.
3. `SELECT CASE WHEN DepartmentID IS NULL THEN 'No Department' ELSE 'Assigned' END AS Status, COUNT(*) FROM Employees GROUP BY CASE WHEN DepartmentID IS NULL THEN 'No Department' ELSE 'Assigned' END;`
4. `ANSI_NULLS` controls whether `= NULL` and `<> NULL` return `UNKNOWN` (ON, the ANSI-standard and default behavior since SQL Server 2008, and required for filtered indexes/indexed views) or are special-cased to behave like `IS NULL`/`IS NOT NULL` (OFF, deprecated legacy behavior) — production code should never rely on `ANSI_NULLS OFF`.

**12. Common Mistakes**
- Writing `WHERE DepartmentID = NULL` and getting confused when it silently returns no rows instead of an error.
- Conflating "NULL foreign key" with "orphaned foreign key" — they require different queries (`IS NULL` vs. an anti-join) and mean different things operationally.
- Not checking whether the schema uses a sentinel value (like `0` or `-1`) instead of `NULL` for "unassigned," which is a legacy pattern still found in older systems.

**13. Architect Insight**
This question is intentionally simple — it's a calibration check. A candidate who overcomplicates `IS NULL` into a join or a `CASE` expression signals they don't have basic SQL fluency at the 14-year level expected here. The real signal to listen for is whether the candidate spontaneously distinguishes "NULL FK" from "orphaned FK," because that distinction is exactly what separates this question from Q75/Q77 later in the workbook.

---

### Q71. Find the department with the highest total/average salary

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Aggregate `Salary` per department with `GROUP BY DepartmentID`, then take the top result — either with `TOP (1) ... ORDER BY`, or with a windowed rank if ties must all be surfaced. "Highest total" and "highest average" are different business questions (a department with many mediocre earners can have a higher *total* than a small department of high earners) and should be asked about explicitly.

**2. SQL Query**
```sql
-- Highest total salary
SELECT TOP (1) WITH TIES
    d.DepartmentName,
    SUM(e.Salary) AS TotalSalary
FROM dbo.Employees e
JOIN dbo.Departments d ON e.DepartmentID = d.DepartmentID
GROUP BY d.DepartmentName
ORDER BY TotalSalary DESC;

-- Highest average salary
SELECT TOP (1) WITH TIES
    d.DepartmentName,
    AVG(e.Salary) AS AvgSalary
FROM dbo.Employees e
JOIN dbo.Departments d ON e.DepartmentID = d.DepartmentID
GROUP BY d.DepartmentName
ORDER BY AvgSalary DESC;
```

**3. Explain the Query**
1. Join `Employees` to `Departments` to get a human-readable name (optional if you're fine reporting by `DepartmentID`).
2. `GROUP BY d.DepartmentName` collapses to one row per department, computing `SUM`/`AVG` of `Salary` within each group.
3. `TOP (1) WITH TIES` returns the single highest row — and *also* any other department that exactly ties for that value, rather than silently picking one arbitrarily the way plain `TOP (1)` would.

**4. Sample Data**

| DepartmentName | Salary |
|---|---|
| Engineering | 150000 |
| Engineering | 140000 |
| Sales | 100000 |
| Sales | 95000 |
| Sales | 90000 |

**5. Expected Output** (highest total)

| DepartmentName | TotalSalary |
|---|---|
| Sales | 285000 |

(Note: Engineering wins on **average** — 145000 vs. Sales's 95000 — which is exactly the "total vs. average tell a different story" trap this question is designed to surface.)

**6. Alternative Solutions**
- **`TOP (1) WITH TIES` (shown above):** clean, and `WITH TIES` correctly surfaces multi-way ties instead of hiding them.
- **Window-function form:**
  ```sql
  SELECT DepartmentName, TotalSalary
  FROM (
      SELECT d.DepartmentName, SUM(e.Salary) AS TotalSalary,
             RANK() OVER (ORDER BY SUM(e.Salary) DESC) AS SalaryRank
      FROM dbo.Employees e
      JOIN dbo.Departments d ON e.DepartmentID = d.DepartmentID
      GROUP BY d.DepartmentName
  ) AS Ranked
  WHERE SalaryRank = 1;
  ```
  Equivalent result to `TOP (1) WITH TIES`, but more composable if you later need "top 3 departments" (change `= 1` to `<= 3`) — this is the same principle as Q65's window-function preference.
- **Preferred:** the window-function form for anything beyond "just the single top row," because it generalizes without restructuring the query.

**7. Performance**
`GROUP BY` on `DepartmentID`/`DepartmentName` with a hash or stream aggregate is efficient if there's an index supporting the join and grouping key; for a small number of departments (tens to low hundreds) against millions of employee rows, expect a hash aggregate — the optimizer builds an in-memory hash table keyed by department and streams employee rows through it once, which is `O(n)` in the employee row count.

**8. Edge Cases**
- Departments with zero employees never appear in this result (an `INNER JOIN`/`GROUP BY` naturally excludes groups with no rows) — if you need to *include* empty departments (correctly showing `TotalSalary = 0` or `NULL`), you need a `LEFT JOIN` from `Departments` to `Employees` instead.
- `AVG()` ignores `NULL` salaries in its denominator (it does not treat `NULL` as `0`) — confirm this is the intended behavior versus a business rule that unpaid/unset salaries should count as zero and drag the average down.
- Multi-way ties: plain `TOP (1)` without `WITH TIES` silently drops all but one tied department — a common, easy-to-miss bug.

**9. Production Scenario**
Executive compensation-cost dashboards ("which business unit has the highest payroll burden") and workforce-planning reports that must distinguish "biggest total cost" from "most highly compensated per head" — two very different signals for budget decisions.

**10. Interview Follow-ups**
1. Why might "highest total" and "highest average" give different answers, and which does the business usually care about?
2. How do you include departments with zero employees in the result?
3. How would you extend this to the top 3 departments by average salary?
4. How does `WITH TIES` interact with the `ORDER BY` clause — what happens if you remove the `ORDER BY`?

**11. Follow-up Answers**
1. Total answers "which department costs the most in payroll" (relevant to budget); average answers "which department pays the best per person" (relevant to compensation benchmarking/retention risk) — a large department of average earners can beat a small department of top earners on total alone.
2. `LEFT JOIN Departments d ... LEFT JOIN Employees e ON ...`, then `SUM(ISNULL(e.Salary, 0))` — this surfaces departments with no employees at `TotalSalary = 0` instead of silently omitting them.
3. Change the window-function form's filter to `WHERE SalaryRank <= 3` after ordering by `AvgSalary DESC`.
4. `TOP ... WITH TIES` requires an `ORDER BY` to know what "tied" means — SQL Server raises an error (`TOP N WITH TIES` without `ORDER BY` is invalid syntax) if you omit it, because there's no defined notion of a tie without a sort key.

**12. Common Mistakes**
- Using plain `TOP (1)` when there could be ties, silently hiding a tie that the business actually needs to know about.
- Conflating `SUM` and `AVG` use cases and reporting the wrong one to stakeholders.
- Using `INNER JOIN` when zero-employee departments must be represented in the output.

**13. Architect Insight**
A Senior engineer writes correct aggregate SQL. A Staff/Principal engineer stops and asks "total or average — which one does the stakeholder actually want, and have I confirmed that instead of guessing," because this exact ambiguity has burned real compensation-reporting projects (a total-based ranking recommending budget cuts to a small, highly-paid, highly-productive team because a larger team's total dwarfed it). The SQL is the easy 20%; asking the right clarifying question is the other 80%.

---

### Q72. Find the highest-paid employee in each department

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Rank employees by salary *within* each department using `ROW_NUMBER()` (or `RANK()`/`DENSE_RANK()` if ties should be surfaced) with `PARTITION BY DepartmentID`, then filter to rank 1. This is the "top-N per group" pattern, one of the single most frequently asked SQL interview problems at any seniority level.

**2. SQL Query**
```sql
SELECT DepartmentID, EmployeeID, FirstName, LastName, Salary
FROM (
    SELECT *,
           RANK() OVER (PARTITION BY DepartmentID ORDER BY Salary DESC) AS SalaryRank
    FROM dbo.Employees
) AS Ranked
WHERE SalaryRank = 1;
```

**3. Explain the Query**
1. `PARTITION BY DepartmentID` resets the ranking independently for every department — think of it as running the `ORDER BY Salary DESC` ranking separately per department, all in a single pass.
2. `RANK()` (not `ROW_NUMBER()`) is chosen here deliberately: if two employees in the same department are tied for the highest salary, the business almost certainly wants to see *both* as "the highest-paid," not an arbitrary pick of one.
3. `WHERE SalaryRank = 1` then returns the top earner(s) per department.

**4. Sample Data**

| EmployeeID | DepartmentID | Salary |
|---|---|---|
| 1 | 10 | 120000 |
| 2 | 10 | 110000 |
| 3 | 20 | 95000 |

**5. Expected Output**

| DepartmentID | EmployeeID | Salary |
|---|---|---|
| 10 | 1 | 120000 |
| 20 | 3 | 95000 |

**6. Alternative Solutions**
- **`RANK()` windowed (shown above):** preferred — single pass, correctly surfaces ties, and generalizes to "top N" by changing the filter.
- **Correlated subquery:**
  ```sql
  SELECT *
  FROM dbo.Employees e
  WHERE Salary = (SELECT MAX(Salary) FROM dbo.Employees e2 WHERE e2.DepartmentID = e.DepartmentID);
  ```
  Correct and also naturally surfaces ties (since it's an equality match, not a row pick), but re-evaluates `MAX(Salary)` once per outer row unless the optimizer is smart enough to cache it per distinct `DepartmentID` — in practice SQL Server often handles this well via a nested loop against a computed scalar per group, but it's less obviously efficient than the single-pass windowed version, especially before you check the actual plan.
- **`APPLY`:**
  ```sql
  SELECT d.DepartmentID, TopEmp.*
  FROM dbo.Departments d
  CROSS APPLY (
      SELECT TOP (1) * FROM dbo.Employees e WHERE e.DepartmentID = d.DepartmentID ORDER BY Salary DESC
  ) AS TopEmp;
  ```
  Excellent when you need "top 1 (or top N) per group" driven from the *groups* table itself (naturally includes/excludes empty departments depending on `CROSS`/`OUTER APPLY`), and reads very clearly — a strong alternative, especially favored when N is small and there's a supporting index per partition key.

**7. Performance**
This is the textbook case for a composite index: `CREATE INDEX IX_Employees_Dept_Salary ON dbo.Employees(DepartmentID, Salary DESC) INCLUDE (EmployeeID, FirstName, LastName);`. With that index, SQL Server can satisfy the `PARTITION BY DepartmentID ORDER BY Salary DESC` requirement directly from the index order, avoiding a separate sort operator — this is one of the highest-leverage indexes you can create for "top-N per group" workloads, and the `APPLY` alternative benefits from the exact same index (it becomes an index seek per department, "loose index scan"–style).

**8. Edge Cases**
- Ties within a department: `RANK()` surfaces all tied top earners; `ROW_NUMBER()` would arbitrarily pick one, which is usually the wrong choice unless the business explicitly wants exactly one row per department regardless of ties.
- Departments with only one employee: that employee is trivially rank 1 — correct, no special-casing needed.
- Employees with `DepartmentID IS NULL` (see Q70): they form their own "partition" (NULL is a valid partition key value) and will produce a `SalaryRank = 1` row with `DepartmentID = NULL` unless explicitly filtered out — decide whether that's wanted.

**9. Production Scenario**
Department-head dashboards, succession-planning reports ("who's the top performer/earner per team"), and bonus-pool allocation logic that treats the top earner per department specially.

**10. Interview Follow-ups**
1. Why `RANK()` here instead of `ROW_NUMBER()`?
2. How would this change to return the top 3 per department (Q74)?
3. What index would make this fast, and why does column order in the index matter?
4. How does `CROSS APPLY` differ from `OUTER APPLY` in this context?

**11. Follow-up Answers**
1. `RANK()` preserves ties as equally-ranked, which matches "highest-paid" as a value-based concept, not a row-count concept — see the identical reasoning in Q65/Q73.
2. Change `WHERE SalaryRank = 1` to `WHERE SalaryRank <= 3` — no other change needed, which is exactly why the windowed approach is preferred over one-off per-department queries.
3. `(DepartmentID, Salary DESC)` — `DepartmentID` must lead because that's the partition key (index rows must be grouped by department first), and `Salary DESC` second so that within each department's index range, rows are already in the exact order the `RANK()`/`TOP` needs, letting the engine walk the front of the block without any sort.
4. `CROSS APPLY` excludes departments with zero matching employees (like an inner join); `OUTER APPLY` includes them with NULL employee columns (like a left join) — use `OUTER APPLY` if empty departments must still appear in the report.

**12. Common Mistakes**
- Defaulting to `ROW_NUMBER()` out of habit and silently hiding genuine ties.
- Building an index on `Salary` alone instead of `(DepartmentID, Salary DESC)`, missing the partition-alignment benefit entirely.
- Using `MAX(Salary)` with `GROUP BY DepartmentID` alone and then needing a second join back to `Employees` to retrieve the full row — functionally works but requires two passes/a self-join, versus the one-pass windowed solution.

**13. Architect Insight**
This exact pattern — `PARTITION BY <group> ORDER BY <metric> DESC`, filter to rank ≤ N — is the single most reusable idiom in the entire workbook; it reappears in Q73 (2nd highest per dept), Q74 (top 3 per dept), Q94 (top-selling product), and Q95 (2nd-best-selling product). An architect-level candidate names this pattern explicitly ("this is the same top-N-per-group shape as...") rather than re-deriving it from scratch each time, which is exactly the kind of pattern-recognition interviewers are listening for across a full session of these questions.

---

### Q73. Find the second-highest salary in each department

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Directly combine Q65 (second-highest via `DENSE_RANK`) with Q72's `PARTITION BY DepartmentID` — this single change ("add a partition") is what makes window functions so powerful for this whole question family.

**2. SQL Query**
```sql
SELECT DepartmentID, EmployeeID, FirstName, LastName, Salary
FROM (
    SELECT *,
           DENSE_RANK() OVER (PARTITION BY DepartmentID ORDER BY Salary DESC) AS SalaryRank
    FROM dbo.Employees
) AS Ranked
WHERE SalaryRank = 2;
```

**3. Explain the Query**
Identical structure to Q72, but with `DENSE_RANK()` instead of `RANK()` (matching Q65's reasoning: "second highest" is a statement about the second-highest *distinct value*, so ties at rank 1 must not create a gap before rank 2) and the filter changed from `= 1` to `= 2`.

**4. Sample Data**

| EmployeeID | DepartmentID | Salary |
|---|---|---|
| 1 | 10 | 120000 |
| 2 | 10 | 120000 |
| 3 | 10 | 110000 |
| 4 | 20 | 95000 |

**5. Expected Output**

| DepartmentID | EmployeeID | Salary |
|---|---|---|
| 10 | 3 | 110000 |

(Department 20 has only one employee, so it has no "second-highest" and correctly produces no row.)

**6. Alternative Solutions**
- **`DENSE_RANK()` windowed (shown above):** preferred, single pass, correct tie semantics.
- **`APPLY` with `OFFSET/FETCH`:**
  ```sql
  SELECT d.DepartmentID, Second.*
  FROM dbo.Departments d
  CROSS APPLY (
      SELECT DISTINCT Salary
      FROM dbo.Employees e
      WHERE e.DepartmentID = d.DepartmentID
      ORDER BY Salary DESC
      OFFSET 1 ROWS FETCH NEXT 1 ROWS ONLY
  ) AS Second;
  ```
  Clear and composable per-department, but only returns one salary value per department even under ties, and re-runs the sort once per department (fine for a modest department count, less ideal at thousands of partitions compared to the single windowed pass).
- **Preferred:** `DENSE_RANK()` — one scan of `Employees`, correct tie handling, and it's the same mental model as every other "Nth per group" question in this file.

**7. Performance**
The same `(DepartmentID, Salary DESC)` composite index from Q72 serves this query equally well — SQL Server computes the window function by streaming each department's pre-sorted index range and assigning dense ranks on the fly, with no separate sort operator needed.

**8. Edge Cases**
- Departments with fewer than 2 distinct salary values produce no row for that department — this is correct ("there is no second-highest"), but make sure downstream reporting doesn't misinterpret "absent" as "zero."
- Ties at rank 1: with `DENSE_RANK`, two employees tied for highest still leaves the *next distinct* salary as rank 2 — verify this matches the business's expectation (some stakeholders genuinely want "the 2nd and 3rd highest earners by row," which is a `ROW_NUMBER()`-based ask instead).

**9. Production Scenario**
Succession-planning ("who's the backup to the top earner/highest performer in each team") and pay-band compression analysis per department (checking whether the gap between the top two earners is unusually small or large).

**10. Interview Follow-ups**
1. How do you extend this to "second-highest across the whole company," ignoring department — is that a different query?
2. What happens to a department with exactly one employee?
3. How would you return *both* the highest and second-highest per department in one result set, clearly labeled?
4. How does this generalize to "Nth highest per department"?

**11. Follow-up Answers**
1. Yes and no — Q65's un-partitioned `DENSE_RANK()` (no `PARTITION BY`) is exactly "second-highest company-wide"; this question is the same mechanism with a partition added. Recognizing that "add or remove `PARTITION BY`" is the entire delta between the two questions is the pattern-matching skill being tested.
2. It contributes zero rows to this result — there's no second-highest to report, which is correct, not a bug.
3. `WHERE SalaryRank IN (1, 2)`, then add a `CASE WHEN SalaryRank = 1 THEN 'Highest' ELSE 'Second-Highest' END AS Label` column.
4. Parameterize the filter exactly as in Q66 — `WHERE SalaryRank = @N` — with the same `PARTITION BY DepartmentID` in place; the mechanisms compose directly.

**12. Common Mistakes**
- Using `RANK()` here and getting no result for departments where the top two salaries are tied (because `RANK` would jump the next distinct value to rank 3, not rank 2).
- Forgetting `PARTITION BY` entirely and computing "second-highest company-wide" when the department-level answer was asked for.
- Assuming every department has a second-highest salary and not handling the case where a department has only one employee.

**13. Architect Insight**
This question exists specifically to test whether a candidate recognizes composability: that Q65 + Q72's partitioning = this question, with zero new concepts. Interviewers at this level are watching for candidates who explicitly say "this is the same as the second-highest-salary problem, just partitioned by department" — that's a stronger signal of deep understanding than independently re-deriving the correct query from first principles each time.

---

### Q74. Find the top 3 salaries per department

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Same `PARTITION BY DepartmentID` windowed pattern as Q72/Q73, generalized to `SalaryRank <= 3`. The interesting decision is *which* ranking function to use, because it changes how many rows "top 3" actually returns when there are ties.

**2. SQL Query**
```sql
SELECT DepartmentID, EmployeeID, FirstName, LastName, Salary, SalaryRank
FROM (
    SELECT *,
           DENSE_RANK() OVER (PARTITION BY DepartmentID ORDER BY Salary DESC) AS SalaryRank
    FROM dbo.Employees
) AS Ranked
WHERE SalaryRank <= 3
ORDER BY DepartmentID, SalaryRank;
```

**3. Explain the Query**
Structurally identical to Q73, with two changes: the filter becomes `<= 3` instead of `= 2`, and the choice of `DENSE_RANK()` means "top 3 distinct salary levels" (which could be more than 3 employees if there are ties at any of those levels) rather than "exactly 3 rows." This distinction must be stated explicitly to the interviewer.

**4. Sample Data**

| EmployeeID | DepartmentID | Salary |
|---|---|---|
| 1 | 10 | 150000 |
| 2 | 10 | 150000 |
| 3 | 10 | 140000 |
| 4 | 10 | 130000 |
| 5 | 10 | 120000 |

**5. Expected Output** (with `DENSE_RANK`, top 3 *distinct* salary levels: 150000, 140000, 130000)

| DepartmentID | EmployeeID | Salary | SalaryRank |
|---|---|---|---|
| 10 | 1 | 150000 | 1 |
| 10 | 2 | 150000 | 1 |
| 10 | 3 | 140000 | 2 |
| 10 | 4 | 130000 | 3 |

(EmployeeID 5 at 120000 is excluded — it's the 4th distinct level. Note this returns 4 rows for "top 3," because two employees share rank 1.)

**6. Alternative Solutions**
- **`DENSE_RANK() <= 3` (shown above):** "top 3 pay *levels*" — the right choice when the business means "everyone earning one of the three highest amounts."
- **`ROW_NUMBER() <= 3`:** "top 3 *people*, period" — exactly 3 rows per department always (assuming at least 3 employees exist), with ties broken arbitrarily unless you add a deterministic secondary `ORDER BY` (e.g., `ORDER BY Salary DESC, EmployeeID ASC`). This is the right choice when a bonus pool has exactly 3 physical slots to fill, regardless of salary ties.
- **`RANK() <= 3`:** a middle ground — ties at rank 1 consume multiple slots, and rank jumps afterward (rank 1, 1, 3), so "top 3" by `RANK` could return only 2 distinct levels if there's a 2-way tie at the top, or could return more than 3 rows the same way `DENSE_RANK` can. `RANK` is rarely the right choice for a "top N" cutoff question specifically because of this jump behavior — flag it as a common wrong answer.
- **Preferred:** ask the interviewer which semantic they mean, then pick `DENSE_RANK` (levels) or `ROW_NUMBER` (fixed headcount) accordingly — this is the single most important thing to say out loud for this question.

**7. Performance**
Same `(DepartmentID, Salary DESC)` composite index as Q72/Q73 supports all three ranking-function variants identically — the choice of `RANK`/`DENSE_RANK`/`ROW_NUMBER` doesn't change the access pattern, only the tie semantics, so there's no performance trade-off between the three; pick based on business meaning alone.

**8. Edge Cases**
- A department with fewer than 3 employees returns all of them, not an error and not padded to 3 rows.
- Heavy tie clustering at the top (e.g., 10 employees all earning the department's maximum salary) means `DENSE_RANK <= 3` could return far more than 3 rows for that department — worth surfacing to whoever consumes "top 3" as a fixed-size expectation (e.g., a UI rendering exactly 3 rows would break).
- `ROW_NUMBER()` without a fully deterministic `ORDER BY` (ties broken only by `Salary DESC`) can return a *different* set of "top 3" rows on repeated runs against the same data, because SQL Server doesn't guarantee tie-breaking order without an explicit secondary sort key — a subtle correctness bug that only manifests under ties.

**9. Production Scenario**
Bonus-pool eligibility ("top 3 earners per team get an additional discretionary bonus review") and leaderboard-style internal dashboards.

**10. Interview Follow-ups**
1. What's the practical difference in output between `RANK`, `DENSE_RANK`, and `ROW_NUMBER` for "top 3," concretely?
2. How do you guarantee deterministic output when using `ROW_NUMBER()` with ties?
3. How would you extend this to "top 3, but at least 5 if there are ties at the boundary" (a common real business rule)?
4. How does this query's cost scale as the number of departments grows into the thousands?

**11. Follow-up Answers**
1. `ROW_NUMBER`: always exactly 3 rows per department (given ≥3 employees), arbitrary tie-break. `DENSE_RANK`: exactly the top 3 distinct salary *values*, which can be more than 3 rows under ties. `RANK`: top 3 by rank number, which skips values after a tie, so it can return fewer than 3 distinct salary levels while still potentially returning more than 3 rows — the least intuitive of the three, and worth actively avoiding for "top N" unless specifically requested.
2. Add a fully unique tiebreaker column to the `ORDER BY` inside the `OVER` clause, e.g., `ORDER BY Salary DESC, EmployeeID ASC` — since `EmployeeID` is a primary key, this guarantees a total order and therefore deterministic, repeatable results.
3. Use `RANK()` instead of `DENSE_RANK()`/`ROW_NUMBER()` with `<= 3`: `RANK`'s "skip after tie" behavior actually implements exactly this rule — if 3 people tie for 3rd place, `RANK` gives all of them rank 3, and the filter `<= 3` naturally includes all of them (5 total rows), which is precisely the "at least 3, expand on ties" business rule.
4. The window function itself scales linearly with total employee rows (single pass, `O(n log n)` for the underlying sort if not index-supported, `O(n)` if the composite index supports order), regardless of department count — the partition count doesn't change the algorithmic complexity, only how the single pass is logically segmented.

**12. Common Mistakes**
- Using `RANK()` by default without realizing it can produce a confusing, non-round-number of results.
- Assuming `ROW_NUMBER()` ties break in `EmployeeID` order without an explicit secondary sort key — this is not guaranteed by the standard and can change between executions or after an index rebuild.
- Not clarifying "top 3 people" vs. "top 3 pay levels" before writing code, then delivering the wrong one.

**13. Architect Insight**
This question is the workbook's clearest test of whether a candidate treats `RANK`/`DENSE_RANK`/`ROW_NUMBER` as interchangeable syntax (a red flag at this level) or as three genuinely different semantic tools chosen deliberately based on the business rule. The single strongest answer opens by naming all three, stating what each produces under ties, and only then asking "which one matches what you need" — demonstrating command of the space before committing to code.

---

## References

1. [ROW_NUMBER (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/row-number-transact-sql) — Microsoft Learn
2. [RANK (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/rank-transact-sql) — Microsoft Learn
3. [DENSE_RANK (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/dense-rank-transact-sql) — Microsoft Learn
4. [WITH common_table_expression (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/with-common-table-expression-transact-sql) — Microsoft Learn
5. [DELETE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/delete-transact-sql) — Microsoft Learn
6. [Joins (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/performance/joins) — Microsoft Learn
7. [Indexes (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/indexes) — Microsoft Learn
