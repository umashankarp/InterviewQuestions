# SQL Server — Complete Interview Prep (All Topics, One File)

> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: None (foundational data-layer domain)
> **Quick-prep edition** (consolidated 2026-10-03). This one file replaces the 14 former SQL Server files. Originals: `git show ebb2d5c:04-SQL-Server/<file>.md`. Extra query drills: `Architect-Role-Cheat-Sheet/SQL-Query-Interview-Questions-Top30.md`.
> Each topic has: **Key concepts → Code example → Most common interview questions with answers.**

| # | Topic | # | Topic |
|---|---|---|---|
| 1 | SQL fundamentals (query order, NULLs, GROUP BY) | 9 | Stored procedures, functions, views, triggers, temp tables |
| 2 | Joins | 10 | Production troubleshooting playbook |
| 3 | Subqueries, CTEs, APPLY | 11 | Database design, partitioning, HA |
| 4 | Window functions | 12 | SQL Server & microservices |
| 5 | Classic query problems (30 solutions) | 13 | FinTech SQL: payments, ledger, reconciliation |
| 6 | Indexing | 14 | Top 40 rapid-fire + Principal questions |
| 7 | Execution plans & query tuning | 15 | Mistakes checklist |
| 8 | Transactions, isolation, locking, deadlocks | | |

**Sample schema used throughout**
```sql
Employees(EmpId, Name, DeptId, ManagerId, Salary, HireDate)
Departments(DeptId, DeptName)
Customers(CustomerId, Name, CreatedAt)
Orders(OrderId, CustomerId, OrderDate, Amount, Status)
OrderItems(OrderId, ProductId, Qty, Price)
Products(ProductId, Name, CategoryId)
Transactions(TxnId, AccountId, TxnDate, Amount, Reference)
Logins(UserId, LoginDate)
```

---

## 1. SQL Fundamentals

**Key concepts**
- **Logical processing order:** `FROM/JOIN → ON → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → TOP/OFFSET`. That's why a SELECT alias can't be used in WHERE but can be used in ORDER BY.
- **WHERE** filters rows *before* grouping; **HAVING** filters groups *after* aggregation.
- **NULL = unknown** → three-valued logic (TRUE/FALSE/UNKNOWN). `NULL = NULL` is UNKNOWN → use `IS NULL`. Aggregates ignore NULLs (except `COUNT(*)`).
- `COUNT(*)` counts rows; `COUNT(col)` counts non-null values; `COUNT(DISTINCT col)` counts distinct non-null values.
- **`ISNULL`** (2 arguments, takes the first argument's type, T-SQL only) vs **`COALESCE`** (n arguments, ANSI, returns the highest-precedence type) vs **`NULLIF(a,b)`** (NULL if equal — great for avoiding divide-by-zero).
- **DISTINCT vs GROUP BY:** same result for de-duplication; GROUP BY when you need aggregates.
- **Pagination:** `ORDER BY ... OFFSET n ROWS FETCH NEXT m ROWS ONLY` (needs a deterministic ORDER BY; deep offsets are slow → keyset).
- **CASE:** simple (`CASE x WHEN 1`) vs searched (`CASE WHEN x > 1`); evaluated in order.
- **Data types:** `DECIMAL(19,4)` for money (never `FLOAT`), `DATETIME2`/`DATETIMEOFFSET` rather than `DATETIME`, `NVARCHAR` for Unicode, avoid `VARCHAR(MAX)` unless needed.
- **DDL** (CREATE/ALTER/DROP), **DML** (SELECT/INSERT/UPDATE/DELETE/MERGE), **DCL** (GRANT/REVOKE), **TCL** (BEGIN/COMMIT/ROLLBACK).
- **DELETE vs TRUNCATE vs DROP:** DELETE is row-by-row, logged, filterable and fires triggers. TRUNCATE deallocates pages, is minimally logged, resets identity, can't have a WHERE, and can't run on a table referenced by a foreign key (it *can* be rolled back inside a transaction). DROP removes the table.

```sql
-- Departments with more than 5 employees and average salary > 80k
SELECT d.DeptName, COUNT(*) AS Headcount, AVG(e.Salary) AS AvgSalary
FROM Employees e
JOIN Departments d ON d.DeptId = e.DeptId
WHERE e.HireDate < '2026-01-01'            -- row filter
GROUP BY d.DeptName
HAVING COUNT(*) > 5 AND AVG(e.Salary) > 80000   -- group filter
ORDER BY AvgSalary DESC;                    -- alias allowed here

-- NULL handling
SELECT COUNT(*) AS AllRows, COUNT(ManagerId) AS WithManager FROM Employees;
SELECT Amount / NULLIF(Qty, 0) AS UnitPrice FROM OrderItems;   -- no divide-by-zero
SELECT COALESCE(MobilePhone, WorkPhone, 'n/a') FROM Contacts;

-- Searched CASE
SELECT OrderId,
       CASE WHEN Amount >= 10000 THEN 'Large'
            WHEN Amount >= 1000  THEN 'Medium'
            ELSE 'Small' END AS Bucket
FROM Orders;

-- Pagination
SELECT OrderId, OrderDate FROM Orders
ORDER BY OrderDate DESC, OrderId DESC
OFFSET 40 ROWS FETCH NEXT 20 ROWS ONLY;

-- Common date functions
SELECT DATEADD(MONTH, -6, CAST(GETDATE() AS DATE)),         -- 6 months ago
       DATEDIFF(DAY, HireDate, GETDATE()),
       EOMONTH(GETDATE()),                                  -- end of month
       DATEFROMPARTS(2026, 10, 1),
       FORMAT(OrderDate, 'yyyy-MM')                         -- slow on large sets; prefer DATETRUNC (2022+)
FROM Employees;
```

**Common interview questions**

**Q1. In what order does SQL Server process a query?**
Logically: FROM/JOIN, WHERE, GROUP BY, HAVING, SELECT, DISTINCT, ORDER BY, then TOP/OFFSET. So WHERE can't see SELECT aliases or aggregates, and ORDER BY can. (The optimizer may physically reorder operations, but the results must match this logical order.)

**Q2. WHERE vs HAVING?**
WHERE filters individual rows before grouping and can't use aggregates. HAVING filters groups after aggregation. Put non-aggregate filters in WHERE — it reduces the rows that get grouped.

**Q3. `COUNT(*)` vs `COUNT(col)` vs `COUNT(DISTINCT col)`?**
All rows / non-null values of col / distinct non-null values. `COUNT(1)` behaves exactly like `COUNT(*)`.

**Q4. Why does `WHERE col = NULL` return nothing?**
Comparisons with NULL yield UNKNOWN, which WHERE treats as false. Use `IS NULL` / `IS NOT NULL`.

**Q5. `ISNULL` vs `COALESCE`?**
`ISNULL` takes 2 arguments, returns the first argument's data type (can truncate), and is T-SQL only. `COALESCE` takes any number, is ANSI standard, and uses data type precedence; it's expanded to a CASE (so subqueries inside it may be evaluated twice).

**Q6. DELETE vs TRUNCATE?**
DELETE: row-by-row, fully logged, supports WHERE, fires triggers, keeps identity. TRUNCATE: deallocates data pages (minimal logging), no WHERE, resets identity, needs ALTER permission, and isn't allowed on tables referenced by foreign keys. Both are transactional in SQL Server.

**Q7. Why `DECIMAL` and not `FLOAT` for money?**
FLOAT is approximate binary floating point (0.1 can't be represented exactly), so sums drift. DECIMAL is exact base-10.

**Q8. DISTINCT vs GROUP BY?**
Without aggregates they produce the same result and often the same plan. Use GROUP BY when you need aggregates; DISTINCT to remove duplicate rows. Reaching for DISTINCT to hide duplicates from a bad join is a code smell.

---

## 2. Joins

**Key concepts**
- **INNER JOIN:** only matching rows. **LEFT JOIN:** all left rows + matches (NULLs otherwise). **RIGHT JOIN:** the mirror (rarely used; rewrite as LEFT). **FULL OUTER:** all rows from both sides. **CROSS JOIN:** Cartesian product (calendars, combinations). **SELF JOIN:** a table joined to itself (employee → manager).
- **Filter placement in a LEFT JOIN:** a condition on the right table in **WHERE** turns it into an inner join; put it in **ON** to keep unmatched left rows.
- **Anti-join** (rows without a match): `NOT EXISTS` (best), `LEFT JOIN ... WHERE right.key IS NULL`, `EXCEPT`. **Avoid `NOT IN` with a nullable subquery** — one NULL makes it return **no rows**.
- **Semi-join** (rows with at least one match): `EXISTS` / `IN` — no duplicates, unlike JOIN.
- Joining one-to-many multiplies rows → watch aggregates (fan-out double counting).
- **Physical join operators** (Nested Loops, Hash, Merge) are covered in §7.

```sql
-- INNER: orders with their customer
SELECT o.OrderId, c.Name FROM Orders o JOIN Customers c ON c.CustomerId = o.CustomerId;

-- LEFT: every customer, with 2026 orders if any (filter in ON!)
SELECT c.CustomerId, c.Name, o.OrderId
FROM Customers c
LEFT JOIN Orders o ON o.CustomerId = c.CustomerId AND o.OrderDate >= '2026-01-01';

-- Anti-join: customers with no orders
SELECT c.* FROM Customers c
WHERE NOT EXISTS (SELECT 1 FROM Orders o WHERE o.CustomerId = c.CustomerId);

-- NOT IN trap: returns NOTHING if any Orders.CustomerId is NULL
SELECT * FROM Customers WHERE CustomerId NOT IN (SELECT CustomerId FROM Orders);

-- SELF JOIN: employees earning more than their manager
SELECT e.Name, e.Salary, m.Name AS Manager, m.Salary AS ManagerSalary
FROM Employees e JOIN Employees m ON m.EmpId = e.ManagerId
WHERE e.Salary > m.Salary;

-- FULL OUTER: reconcile two sources
SELECT COALESCE(a.Reference, b.Reference) AS Reference, a.Amount AS Ours, b.Amount AS Bank
FROM Ledger a FULL OUTER JOIN BankStatement b ON a.Reference = b.Reference
WHERE a.Reference IS NULL OR b.Reference IS NULL OR a.Amount <> b.Amount;

-- CROSS JOIN: every store × every day (for zero-filled reports)
SELECT s.StoreId, d.[Date] FROM Stores s CROSS JOIN Calendar d WHERE d.[Date] >= '2026-10-01';
```

**Common interview questions**

**Q1. Explain the join types.**
INNER returns matches only; LEFT returns all left rows (NULLs for missing right rows); RIGHT is the mirror; FULL returns everything from both sides; CROSS returns every combination; a SELF join relates rows within one table.

**Q2. Why did my LEFT JOIN behave like an INNER JOIN?**
A WHERE condition on a right-table column (e.g., `WHERE o.Status = 'Paid'`) removes the NULL-extended rows. Move the condition into the ON clause, or allow `OR o.OrderId IS NULL`.

**Q3. `NOT IN` vs `NOT EXISTS`?**
If the subquery returns any NULL, `x NOT IN (...)` evaluates to UNKNOWN for every row → no rows returned. `NOT EXISTS` handles NULLs correctly and usually gets an efficient anti-semi-join plan. Prefer `NOT EXISTS`.

**Q4. JOIN vs EXISTS vs IN?**
JOIN returns columns from both tables and can duplicate rows (one-to-many). EXISTS/IN only test for existence (a semi-join) and never duplicate. The optimizer often produces the same plan for EXISTS and IN; EXISTS is clearer and NULL-safe in its negated form.

**Q5. How do you find records in table A not in table B?**
`NOT EXISTS` (preferred), `LEFT JOIN B ... WHERE B.key IS NULL`, or `SELECT key FROM A EXCEPT SELECT key FROM B` (distinct keys only).

**Q6. Why did my SUM double after adding a join?**
Fan-out: joining a one-to-many table repeats each parent row per child, so parent amounts are summed multiple times. Aggregate the child first in a subquery or CTE, then join.

---

## 3. Subqueries, CTEs, Temp Tables & APPLY

**Key concepts**
- **Subqueries:** scalar (one value), multi-row (`IN`, `EXISTS`), table (a derived table in FROM). **Correlated** subqueries reference the outer row (conceptually run per row; the optimizer often rewrites them as joins).
- **CTE** (`WITH x AS (...)`): a named, readable query block; **not materialized** — referenced twice means executed twice. Scoped to one statement.
- **Recursive CTE:** anchor + recursive member with `UNION ALL`; for hierarchies and series; `OPTION (MAXRECURSION n)` (default 100).
- **Temp table `#t`:** physically in tempdb, has statistics, can be indexed — best for large intermediate results reused several times. **Table variable `@t`:** limited statistics (deferred compilation in 2019+ helps), best for small sets. **CTE:** readability, single use.
- **CROSS APPLY / OUTER APPLY:** run a table expression per row (top-N per group, calling table-valued functions, unpacking JSON). OUTER APPLY keeps rows with no results (like LEFT JOIN).

```sql
-- Correlated subquery: employees above their department's average
SELECT e.Name, e.Salary, e.DeptId
FROM Employees e
WHERE e.Salary > (SELECT AVG(Salary) FROM Employees x WHERE x.DeptId = e.DeptId);

-- Chained CTEs
WITH DeptAvg AS (SELECT DeptId, AVG(Salary) AS AvgSal FROM Employees GROUP BY DeptId),
     Above   AS (SELECT e.*, d.AvgSal FROM Employees e JOIN DeptAvg d ON d.DeptId = e.DeptId WHERE e.Salary > d.AvgSal)
SELECT * FROM Above ORDER BY DeptId;

-- Recursive CTE: org chart under employee 1
WITH Org AS (
    SELECT EmpId, Name, ManagerId, 0 AS Lvl FROM Employees WHERE EmpId = 1        -- anchor
    UNION ALL
    SELECT e.EmpId, e.Name, e.ManagerId, o.Lvl + 1
    FROM Employees e JOIN Org o ON e.ManagerId = o.EmpId                          -- recursive
)
SELECT * FROM Org OPTION (MAXRECURSION 50);

-- Recursive date series
WITH D AS (SELECT CAST('2026-10-01' AS DATE) AS d UNION ALL SELECT DATEADD(DAY, 1, d) FROM D WHERE d < '2026-10-31')
SELECT d FROM D;

-- CROSS APPLY: latest 3 orders per customer
SELECT c.CustomerId, x.OrderId, x.OrderDate
FROM Customers c
CROSS APPLY (SELECT TOP (3) OrderId, OrderDate FROM Orders o
             WHERE o.CustomerId = c.CustomerId ORDER BY OrderDate DESC) x;

-- Temp table for a reused, large intermediate set
SELECT CustomerId, SUM(Amount) AS Total INTO #Totals FROM Orders GROUP BY CustomerId;
CREATE CLUSTERED INDEX IX ON #Totals(CustomerId);
```

**Common interview questions**

**Q1. CTE vs temp table vs table variable?**
CTE: readability, single-statement scope, not materialized. Temp table: real tempdb storage with statistics and indexes — best for big intermediate results used multiple times or across statements. Table variable: lightweight, minimal statistics, good for small row counts; it doesn't participate in a transaction rollback.

**Q2. Is a CTE materialized?**
No. It's inlined into the query like a view; referencing it twice runs it twice. Materialize into a temp table if the work is expensive and reused.

**Q3. How does a recursive CTE work?**
The anchor member produces the starting rows; the recursive member joins back to the CTE, repeatedly, until it returns no rows; the results are combined with UNION ALL. Guard against cycles and infinite loops with a level column and MAXRECURSION.

**Q4. Correlated subquery vs join — which is faster?**
Often the same: the optimizer decorrelates many subqueries into joins. When it can't, a correlated subquery may execute per outer row. Rewrite as a JOIN, a window function or APPLY, and check the plan.

**Q5. When do you use CROSS APPLY?**
For per-row table expressions: top-N per group with an index, calling an inline table-valued function per row, or `OPENJSON` per row. OUTER APPLY keeps outer rows with no results.

---

## 4. Window Functions

**Key concepts**
- `function() OVER (PARTITION BY ... ORDER BY ... ROWS/RANGE ...)` — calculates across related rows **without collapsing them** (unlike GROUP BY).
- **Ranking:** `ROW_NUMBER` (1,2,3 — unique), `RANK` (1,1,3 — gaps), `DENSE_RANK` (1,1,2 — no gaps), `NTILE(n)` (buckets).
- **Offset:** `LAG(col, n, default)`, `LEAD(...)`; `FIRST_VALUE`, `LAST_VALUE` (needs a frame `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`).
- **Aggregates over windows:** `SUM/AVG/COUNT/MIN/MAX OVER (...)` — running totals, moving averages, percent of total.
- **Distribution:** `PERCENT_RANK`, `CUME_DIST`, `PERCENTILE_CONT` (interpolated median), `PERCENTILE_DISC`.
- **Frames:** with ORDER BY the default is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` → ties are treated as one peer group and it's slower (spools to tempdb). **Use `ROWS`** explicitly for running totals.
- Window functions can't be used in WHERE (they're evaluated in SELECT) → wrap in a CTE/subquery to filter.
- Performance: a supporting index on `(PARTITION BY cols, ORDER BY cols)` avoids sorts.

```sql
-- Ranking functions side by side
SELECT Name, DeptId, Salary,
       ROW_NUMBER() OVER (PARTITION BY DeptId ORDER BY Salary DESC) AS RowNum,
       RANK()       OVER (PARTITION BY DeptId ORDER BY Salary DESC) AS Rnk,
       DENSE_RANK() OVER (PARTITION BY DeptId ORDER BY Salary DESC) AS DenseRnk,
       NTILE(4)     OVER (ORDER BY Salary DESC)                     AS Quartile
FROM Employees;

-- Running total and 7-row moving average (ROWS, not default RANGE)
SELECT AccountId, TxnDate, Amount,
       SUM(Amount) OVER (PARTITION BY AccountId ORDER BY TxnDate, TxnId ROWS UNBOUNDED PRECEDING) AS RunningBalance,
       AVG(Amount) OVER (PARTITION BY AccountId ORDER BY TxnDate, TxnId ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS MovingAvg7
FROM Transactions;

-- Compare with previous row
SELECT AccountId, TxnDate, Amount,
       Amount - LAG(Amount, 1, 0) OVER (PARTITION BY AccountId ORDER BY TxnDate) AS DiffFromPrev,
       DATEDIFF(DAY, LAG(TxnDate) OVER (PARTITION BY AccountId ORDER BY TxnDate), TxnDate) AS DaysSincePrev
FROM Transactions;

-- Percent of total and median
SELECT DeptId, Name, Salary,
       100.0 * Salary / SUM(Salary) OVER (PARTITION BY DeptId) AS PctOfDept,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY Salary) OVER (PARTITION BY DeptId) AS MedianSalary
FROM Employees;

-- Filtering on a window function → CTE
WITH r AS (SELECT *, DENSE_RANK() OVER (PARTITION BY DeptId ORDER BY Salary DESC) dr FROM Employees)
SELECT * FROM r WHERE dr <= 3;
```

**Common interview questions**

**Q1. ROW_NUMBER vs RANK vs DENSE_RANK?**
With salaries 100, 100, 90: ROW_NUMBER = 1,2,3 (arbitrary order among ties unless you add a tie-breaker); RANK = 1,1,3; DENSE_RANK = 1,1,2. Use DENSE_RANK for "Nth highest distinct value", ROW_NUMBER for de-duplication and "pick one per group".

**Q2. Window function vs GROUP BY?**
GROUP BY collapses rows into one per group; window functions keep every row and add the aggregate alongside it (e.g., each employee's salary next to the department average).

**Q3. ROWS vs RANGE?**
ROWS counts physical rows; RANGE includes all peers with the same ORDER BY value. The default frame with ORDER BY is RANGE, which gives surprising running totals when dates tie, and is slower (on-disk spool). Specify ROWS and add a unique tie-breaker.

**Q4. Why can't I use ROW_NUMBER in WHERE?**
Window functions are computed during SELECT, after WHERE. Wrap the query in a CTE or derived table and filter outside.

**Q5. How do LAG and LEAD help?**
They read a previous or next row's value in the same partition without a self-join — month-over-month change, time between events, detecting status transitions.

**Q6. How do you make window queries fast?**
A "POC" index — Partition columns, then Order columns, Covering the selected columns — so SQL Server streams rows without sorting; use ROWS frames; filter early.

---

## 5. Classic Query Problems (Memorize the Shapes)

```sql
-- 1. Second highest salary (NULL if none)
SELECT MAX(Salary) FROM Employees WHERE Salary < (SELECT MAX(Salary) FROM Employees);

-- 2. Nth highest salary (distinct)
DECLARE @N INT = 3;
WITH r AS (SELECT Salary, DENSE_RANK() OVER (ORDER BY Salary DESC) dr FROM Employees)
SELECT DISTINCT Salary FROM r WHERE dr = @N;
-- or: SELECT DISTINCT Salary FROM Employees ORDER BY Salary DESC OFFSET @N-1 ROWS FETCH NEXT 1 ROW ONLY;

-- 3. Top 3 salaries per department
WITH r AS (SELECT *, DENSE_RANK() OVER (PARTITION BY DeptId ORDER BY Salary DESC) dr FROM Employees)
SELECT DeptId, Name, Salary FROM r WHERE dr <= 3;

-- 4. Highest-paid employee per department (ties included)
WITH r AS (SELECT *, RANK() OVER (PARTITION BY DeptId ORDER BY Salary DESC) rk FROM Employees)
SELECT * FROM r WHERE rk = 1;

-- 5. Employees earning more than their manager → self join (see §2)

-- 6. Find duplicates
SELECT Email, COUNT(*) AS Cnt FROM Customers GROUP BY Email HAVING COUNT(*) > 1;

-- 7. Delete duplicates, keep the latest
WITH d AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY Email ORDER BY CreatedAt DESC, CustomerId DESC) rn FROM Customers)
DELETE FROM d WHERE rn > 1;

-- 8. Customers who never ordered
SELECT c.* FROM Customers c WHERE NOT EXISTS (SELECT 1 FROM Orders o WHERE o.CustomerId = c.CustomerId);

-- 9. Customers with more than 3 orders
SELECT CustomerId, COUNT(*) FROM Orders GROUP BY CustomerId HAVING COUNT(*) > 3;

-- 10. Latest transaction per customer (ROW_NUMBER, or CROSS APPLY TOP 1 with an index)
WITH r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY AccountId ORDER BY TxnDate DESC, TxnId DESC) rn FROM Transactions)
SELECT * FROM r WHERE rn = 1;            -- rn = 2 → second transaction; ORDER BY ASC → first

-- 11. Employees hired in the last 6 months (SARGable)
SELECT * FROM Employees WHERE HireDate >= DATEADD(MONTH, -6, CAST(GETDATE() AS DATE));

-- 12. Running total of sales by day
SELECT SaleDate, DailyTotal, SUM(DailyTotal) OVER (ORDER BY SaleDate ROWS UNBOUNDED PRECEDING) AS RunningTotal
FROM (SELECT CAST(OrderDate AS DATE) SaleDate, SUM(Amount) DailyTotal FROM Orders GROUP BY CAST(OrderDate AS DATE)) t;

-- 13. Month-over-month growth %
WITH m AS (SELECT DATEFROMPARTS(YEAR(OrderDate), MONTH(OrderDate), 1) AS Mth, SUM(Amount) AS Rev FROM Orders
           GROUP BY DATEFROMPARTS(YEAR(OrderDate), MONTH(OrderDate), 1))
SELECT Mth, Rev, LAG(Rev) OVER (ORDER BY Mth) AS PrevRev,
       100.0 * (Rev - LAG(Rev) OVER (ORDER BY Mth)) / NULLIF(LAG(Rev) OVER (ORDER BY Mth), 0) AS GrowthPct
FROM m;
-- Year-over-year: LAG(Rev, 12) on monthly data (or join to the same month last year)

-- 14. Products whose sales grew vs the previous month
WITH ps AS (SELECT ProductId, DATEFROMPARTS(YEAR(o.OrderDate), MONTH(o.OrderDate), 1) Mth, SUM(oi.Qty * oi.Price) Sales
            FROM OrderItems oi JOIN Orders o ON o.OrderId = oi.OrderId GROUP BY ProductId, DATEFROMPARTS(YEAR(o.OrderDate), MONTH(o.OrderDate), 1)),
     c AS (SELECT *, LAG(Sales) OVER (PARTITION BY ProductId ORDER BY Mth) Prev FROM ps)
SELECT * FROM c WHERE Sales > Prev;

-- 15. Consecutive login days (gaps & islands): date − row_number is constant within a streak
WITH d AS (SELECT DISTINCT UserId, CAST(LoginDate AS DATE) AS D FROM Logins),
     g AS (SELECT UserId, D, DATEADD(DAY, -ROW_NUMBER() OVER (PARTITION BY UserId ORDER BY D), D) AS Grp FROM d)
SELECT UserId, MIN(D) AS StreakStart, MAX(D) AS StreakEnd, COUNT(*) AS Days
FROM g GROUP BY UserId, Grp
HAVING COUNT(*) >= 3;                   -- users with 3+ consecutive days
-- Longest streak per user: wrap the above and take MAX(Days) per UserId

-- 16. Missing dates in a range (calendar table or GENERATE_SERIES in SQL Server 2022)
SELECT DATEADD(DAY, s.value, '2026-10-01') AS MissingDate
FROM GENERATE_SERIES(0, 30) s
WHERE NOT EXISTS (SELECT 1 FROM Transactions t WHERE CAST(t.TxnDate AS DATE) = DATEADD(DAY, s.value, '2026-10-01'));

-- 17. Gaps in an ID sequence
SELECT Id + 1 AS GapStart, NextId - 1 AS GapEnd
FROM (SELECT Id, LEAD(Id) OVER (ORDER BY Id) AS NextId FROM Invoices) t
WHERE NextId - Id > 1;

-- 18. Customers who bought EVERY product in category 5 (relational division)
SELECT o.CustomerId
FROM Orders o JOIN OrderItems oi ON oi.OrderId = o.OrderId JOIN Products p ON p.ProductId = oi.ProductId
WHERE p.CategoryId = 5
GROUP BY o.CustomerId
HAVING COUNT(DISTINCT p.ProductId) = (SELECT COUNT(*) FROM Products WHERE CategoryId = 5);

-- 19. Bought product A but not B
SELECT DISTINCT o.CustomerId FROM Orders o JOIN OrderItems i ON i.OrderId = o.OrderId WHERE i.ProductId = 'A'
EXCEPT
SELECT DISTINCT o.CustomerId FROM Orders o JOIN OrderItems i ON i.OrderId = o.OrderId WHERE i.ProductId = 'B';

-- 20. Above department average (window version)
SELECT * FROM (SELECT *, AVG(Salary) OVER (PARTITION BY DeptId) AS DeptAvg FROM Employees) t WHERE Salary > DeptAvg;

-- 21. Department % of total salary
SELECT DeptId, SUM(Salary) AS DeptTotal, 100.0 * SUM(Salary) / SUM(SUM(Salary)) OVER () AS PctOfCompany
FROM Employees GROUP BY DeptId;

-- 22. Duplicate financial transactions on several columns, within 10 minutes of each other
SELECT a.TxnId, b.TxnId AS PossibleDuplicate
FROM Transactions a
JOIN Transactions b ON b.AccountId = a.AccountId AND b.Amount = a.Amount AND b.Reference = a.Reference
                   AND b.TxnId > a.TxnId AND b.TxnDate BETWEEN a.TxnDate AND DATEADD(MINUTE, 10, a.TxnDate);

-- 23. Overlapping date ranges (bookings)
SELECT a.BookingId, b.BookingId
FROM Bookings a JOIN Bookings b ON a.RoomId = b.RoomId AND a.BookingId < b.BookingId
WHERE a.StartDate < b.EndDate AND b.StartDate < a.EndDate;          -- overlap test

-- 24. Event A followed by event B within 30 minutes
SELECT DISTINCT a.UserId
FROM Events a JOIN Events b ON b.UserId = a.UserId AND b.EventType = 'B' AND a.EventType = 'A'
 AND b.EventTime > a.EventTime AND b.EventTime <= DATEADD(MINUTE, 30, a.EventTime);

-- 25. Top-selling product
SELECT TOP (1) WITH TIES ProductId, SUM(Qty) AS Units FROM OrderItems GROUP BY ProductId ORDER BY SUM(Qty) DESC;

-- 26. Cumulative percentage (Pareto)
SELECT ProductId, Sales, 100.0 * SUM(Sales) OVER (ORDER BY Sales DESC ROWS UNBOUNDED PRECEDING) / SUM(Sales) OVER () AS CumPct
FROM (SELECT ProductId, SUM(Qty * Price) AS Sales FROM OrderItems GROUP BY ProductId) t;

-- 27. Point-in-time (as-of) FX rate for each transaction
SELECT t.TxnId, t.TxnDate, r.Rate
FROM Transactions t
CROSS APPLY (SELECT TOP (1) Rate FROM FxRates f WHERE f.Pair = 'EURUSD' AND f.AsOf <= t.TxnDate ORDER BY f.AsOf DESC) r;

-- 28. Pivot: monthly sales per product as columns
SELECT ProductId,
       SUM(CASE WHEN MONTH(o.OrderDate) = 1 THEN oi.Qty END) AS Jan,
       SUM(CASE WHEN MONTH(o.OrderDate) = 2 THEN oi.Qty END) AS Feb
FROM OrderItems oi JOIN Orders o ON o.OrderId = oi.OrderId GROUP BY ProductId;

-- 29. Swap gender values in one update
UPDATE Employees SET Gender = CASE Gender WHEN 'M' THEN 'F' WHEN 'F' THEN 'M' END;

-- 30. Upsert (prefer explicit UPDATE/INSERT with locking hints over MERGE in high concurrency)
BEGIN TRAN;
UPDATE Balances WITH (UPDLOCK, SERIALIZABLE) SET Amount = @a WHERE AccountId = @id;
IF @@ROWCOUNT = 0 INSERT Balances(AccountId, Amount) VALUES (@id, @a);
COMMIT;
```

**Common interview questions**

**Q1. How do you find the Nth highest salary?**
`DENSE_RANK() OVER (ORDER BY Salary DESC)` and filter `= N` (handles ties); or `OFFSET N-1 ROWS FETCH NEXT 1 ROW ONLY` over distinct salaries. Mention what should happen with ties and when fewer than N values exist.

**Q2. How do you delete duplicates but keep one?**
A CTE with `ROW_NUMBER() OVER (PARTITION BY <duplicate key> ORDER BY <keep rule>)` and `DELETE WHERE rn > 1`. Then add a unique constraint so they can't come back. On big tables, delete in batches.

**Q3. Explain gaps-and-islands.**
For consecutive values, `value − ROW_NUMBER()` is constant within a run, so grouping by that difference yields each island (a streak). Gaps are found with `LEAD`/`LAG` comparing neighbours.

**Q4. How do you get the latest row per group efficiently?**
`ROW_NUMBER() ... = 1` in a CTE, or `CROSS APPLY (SELECT TOP 1 ... ORDER BY date DESC)` — with an index on `(GroupKey, Date DESC)` the APPLY version seeks once per group, which is great when there are few groups with many rows each.

**Q5. How do you detect overlapping ranges?**
Two ranges overlap when `A.start < B.end AND B.start < A.end` (adjust for inclusive ends). Self-join on the shared resource with `A.id < B.id` to avoid duplicates.

---

## 6. Indexing

**Key concepts**
- **B-tree** structure: root → intermediate → leaf pages (8 KB pages, 64 KB extents).
- **Clustered index** = the table data itself, sorted by the key (one per table). Best key: **narrow, unique, static, ever-increasing** (`BIGINT IDENTITY`). Random GUIDs cause page splits and fragmentation (use `NEWSEQUENTIALID()` if a GUID is required).
- **Heap** = a table without a clustered index (forwarded records, RID lookups).
- **Non-clustered index** = a separate B-tree of key columns + a row locator (the clustered key). Up to 999 per table.
- **Covering index** = contains every column the query needs; **INCLUDE** columns live only at the leaf level (they don't affect ordering or key size limits).
- **Composite key order:** equality columns first, then range/sort columns; the leftmost prefix rule — an index on `(A, B)` helps `WHERE A=` and `WHERE A= AND B>` but not `WHERE B=` alone.
- **Filtered index:** `WHERE Status = 'PENDING'` — small and precise for hot subsets (watch parameterized queries, which may not match the filter).
- **Unique index/constraint:** enforces business rules (idempotency keys).
- **Columnstore:** column-oriented and compressed, for analytics/aggregations over millions of rows (batch mode); nonclustered columnstore on OLTP tables enables real-time analytics.
- **Selectivity:** high-selectivity predicates (few rows) favour seeks; low selectivity → scans are cheaper than many lookups (the tipping point).
- **Costs:** every index slows INSERT/UPDATE/DELETE, uses memory and disk, and needs maintenance. Remove unused or duplicate indexes (`sys.dm_db_index_usage_stats`).
- **Fragmentation:** REORGANIZE (online, light, ~5–30%) vs REBUILD (more thorough, updates statistics; online in Enterprise edition). On SSDs fragmentation matters less than **statistics** and page density.
- **Fill factor** leaves free space on pages to reduce splits on random inserts.

```sql
-- Clustered on an identity; non-clustered covering index for a hot query
CREATE TABLE Orders (
    OrderId    BIGINT IDENTITY CONSTRAINT PK_Orders PRIMARY KEY CLUSTERED,
    CustomerId BIGINT NOT NULL,
    OrderDate  DATETIME2 NOT NULL,
    Status     VARCHAR(20) NOT NULL,
    Amount     DECIMAL(19,4) NOT NULL
);

-- Query: WHERE CustomerId = @c AND OrderDate >= @d ORDER BY OrderDate DESC, returns Amount, Status
CREATE NONCLUSTERED INDEX IX_Orders_Customer_Date
    ON Orders (CustomerId, OrderDate DESC)     -- equality first, then range/sort
    INCLUDE (Amount, Status);                  -- covering → no key lookup

-- Filtered index for a small hot subset
CREATE NONCLUSTERED INDEX IX_Orders_Pending ON Orders (OrderDate) INCLUDE (CustomerId)
WHERE Status = 'PENDING';

-- Unique constraint as a business rule
CREATE UNIQUE INDEX UX_Payments_IdemKey ON Payments (ClientId, IdempotencyKey);

-- Analytics
CREATE NONCLUSTERED COLUMNSTORE INDEX NCCI_Orders ON Orders (OrderDate, CustomerId, Amount, Status);

-- Unused indexes (reads vs writes since the last restart)
SELECT OBJECT_NAME(s.object_id) AS TableName, i.name, s.user_seeks, s.user_scans, s.user_lookups, s.user_updates
FROM sys.dm_db_index_usage_stats s JOIN sys.indexes i ON i.object_id = s.object_id AND i.index_id = s.index_id
WHERE s.database_id = DB_ID() ORDER BY (s.user_seeks + s.user_scans + s.user_lookups) ASC;

-- Missing index suggestions (treat as hints, not orders)
SELECT * FROM sys.dm_db_missing_index_details;
```

**Common interview questions**

**Q1. Clustered vs non-clustered index?**
The clustered index *is* the table, with leaf pages containing full rows in key order — one per table. A non-clustered index is a separate structure with key columns and a pointer (the clustered key) back to the row; there can be many. Lookups through a non-clustered index that don't cover the query need key lookups into the clustered index.

**Q2. How do you choose a clustered key?**
Narrow (it's copied into every non-clustered index), unique, static (updates move rows), ever-increasing (avoids page splits). `BIGINT IDENTITY` is the classic choice; a random GUID is bad (fragmentation, larger indexes).

**Q3. What's a covering index and why use INCLUDE?**
An index containing all columns a query needs, so it never touches the base table. INCLUDE adds non-key columns only at the leaf level — no impact on sort order or key size limits, and cheaper to maintain than putting them in the key.

**Q4. How do you decide column order in a composite index?**
Equality predicates first (most selective among them), then range predicates or ORDER BY columns. Remember the leftmost prefix rule: the index can only seek on a leading subset of its columns.

**Q5. When do indexes hurt?**
Write-heavy tables (every insert/update maintains each index), too many overlapping indexes, wide keys, indexes on low-selectivity columns that are never used, and blocking or deadlocks from extra lock resources. Every index needs a query that justifies it.

**Q6. Adding an index made the application slower. Why?**
Write overhead on a hot table; a plan change where the optimizer picked the new index with bad estimates (lookups for many rows); more locks and deadlocks between readers and writers; or larger log and replication volume. Check Query Store for regressed queries and the write latency.

**Q7. REORGANIZE vs REBUILD?**
REORGANIZE defragments leaf pages in place — always online, lightweight, interruptible. REBUILD recreates the index (full defragmentation and fresh statistics) and can be online in Enterprise edition. Common guideline: reorganize at 5–30% fragmentation, rebuild above 30% — but on modern storage, keeping statistics up to date matters more.

**Q8. What is a filtered index and when is it better?**
An index on a subset of rows (`WHERE IsActive = 1`). It's smaller, cheaper to maintain and more accurate for queries targeting that subset. Caveat: parameterized queries may not match the filter at compile time.

**Q9. When would you use a columnstore index?**
For analytics and aggregations over large tables (data warehouses, reporting on OLTP via a nonclustered columnstore): it reads only the needed columns, compresses heavily, and runs in batch mode. Not for singleton row lookups.

---

## 7. Execution Plans & Query Tuning

**Key concepts**
- **Estimated plan** (no execution) vs **actual plan** (includes actual row counts, warnings, memory grants). Read right-to-left, top-to-bottom; look for **fat arrows**, **estimated vs actual row mismatches**, **warnings** (implicit conversion, spills, missing statistics).
- **Table scan** (heap) / **clustered index scan** (all rows) / **index seek** (B-tree navigation to a range) / **key lookup** (fetching extra columns per row → fix with INCLUDE).
- **Join operators:** **Nested Loops** (small outer input + indexed inner — OLTP), **Hash Match** (large unsorted inputs, needs a memory grant), **Merge Join** (both inputs sorted on the join key), **Adaptive Join** (2017+, chooses at runtime).
- **Statistics** = histograms (up to 200 steps) of value distributions → cardinality estimation. Stale statistics → bad plans. Auto-update triggers after a threshold of changes (dynamic since 2016); update manually after large loads (`UPDATE STATISTICS ... WITH FULLSCAN` on critical tables).
- **SARGable predicates** let the optimizer seek. Non-SARGable: a function on the column (`YEAR(d)=`, `ISNULL(c,..)=`, `LEFT(name,3)=`), **implicit conversion** (an `NVARCHAR` parameter vs a `VARCHAR` column), leading wildcards (`LIKE '%abc'`), arithmetic on the column (`Amount * 1.1 > 100`).
- **Parameter sniffing:** the plan is compiled for the first parameter values and cached; skewed data makes it bad for other values. Fixes: better indexes; `OPTION (RECOMPILE)`; `OPTIMIZE FOR (@p = ...)` / `OPTIMIZE FOR UNKNOWN`; split procedures by case; **Query Store forced plans**; SQL 2022 **Parameter Sensitive Plan** optimization.
- **"Fast in SSMS, slow in the app":** different SET options (SSMS defaults to `ARITHABORT ON`, ADO.NET to OFF) → a separate plan cache entry → a different sniffed plan. It's parameter sniffing, not ARITHABORT itself.
- **Spills to tempdb:** the memory grant was too small for a sort or hash (bad estimates) → fix estimates, indexes that provide order, memory grant feedback (2019+).
- **Plan cache pollution:** non-parameterized ad hoc SQL creates a plan per literal → parameterize (sp_executesql, ORMs do), enable `optimize for ad hoc workloads`.
- **Query Store:** records query plans and runtime stats over time → find regressions and force good plans. **Enable it on every database.**
- **OR conditions** can prevent seeks → rewrite as UNION ALL or use separate indexes; **catch-all queries** (`@p IS NULL OR col = @p`) → `OPTION (RECOMPILE)` or dynamic SQL.
- **Deep OFFSET pagination** → keyset pagination.

```sql
-- Non-SARGable → SARGable rewrites
WHERE YEAR(OrderDate) = 2026                       -- scan
WHERE OrderDate >= '2026-01-01' AND OrderDate < '2027-01-01'   -- seek

WHERE ISNULL(Status, '') = 'PAID'                  -- scan
WHERE Status = 'PAID'                              -- seek

WHERE AccountNo = 12345        -- AccountNo is VARCHAR → CONVERT_IMPLICIT on the column → scan
WHERE AccountNo = '12345'      -- seek (match types; in .NET set DbType.AnsiString / correct length)

WHERE Name LIKE '%smith'       -- scan (leading wildcard) → full-text search or a reversed computed column
WHERE Name LIKE 'smith%'       -- seek

-- Parameter sniffing fixes
SELECT * FROM Orders WHERE CustomerId = @c OPTION (RECOMPILE);              -- fresh plan each run
SELECT * FROM Orders WHERE CustomerId = @c OPTION (OPTIMIZE FOR (@c UNKNOWN)); -- average-density plan

-- Catch-all search
SELECT * FROM Orders
WHERE (@CustomerId IS NULL OR CustomerId = @CustomerId)
  AND (@Status IS NULL OR Status = @Status)
OPTION (RECOMPILE);

-- Inspect the actual I/O and time
SET STATISTICS IO, TIME ON;

-- Query Store: top regressed queries / force a plan
SELECT TOP 20 q.query_id, rs.avg_duration, p.plan_id
FROM sys.query_store_runtime_stats rs
JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
JOIN sys.query_store_query q ON q.query_id = p.query_id
ORDER BY rs.avg_duration DESC;
EXEC sp_query_store_force_plan @query_id = 42, @plan_id = 7;

-- Statistics
UPDATE STATISTICS dbo.Orders WITH FULLSCAN;
DBCC SHOW_STATISTICS ('dbo.Orders', 'IX_Orders_Customer_Date');
```

**Common interview questions**

**Q1. How do you read an execution plan?**
Right to left (data flows leftward), top to bottom. Find the most expensive operators; compare estimated vs actual rows (big gaps = statistics or sniffing problems); look for scans on large tables, key lookups executed many times, sorts and hashes with spill warnings, implicit-conversion warnings, and parallelism skew. Always use the *actual* plan when possible.

**Q2. Scan vs seek vs key lookup?**
A seek navigates the B-tree to the needed range; a scan reads the whole index or table; a key lookup fetches columns missing from a non-clustered index, once per row. Many lookups are expensive → make the index covering.

**Q3. What is parameter sniffing and how do you fix it?**
SQL Server compiles a plan using the first-call parameter values and reuses it. With skewed data (one huge customer, many tiny ones), the cached plan suits one case and is terrible for the other. Fixes in order: an index that makes both cases cheap; RECOMPILE for infrequent queries; OPTIMIZE FOR; separate code paths; force a known-good plan via Query Store; PSP optimization in SQL Server 2022.

**Q4. Why is a query fast in SSMS but slow from the app?**
SSMS and the app use different SET options (notably ARITHABORT), so they get different plan cache entries — the app is stuck with a plan sniffed for atypical parameters. Compare both plans from the cache; fix the sniffing, don't just flip ARITHABORT. Other causes: different parameter types (implicit conversion from `nvarchar`), or app-side issues (row-by-row fetching, network).

**Q5. What makes a predicate SARGable?**
The column must appear "bare" on one side of a comparison with a compatible type, so the optimizer can seek into the index range. Functions on the column, implicit conversions, leading wildcards and arithmetic on the column all force scans.

**Q6. Nested loops vs hash vs merge join — when?**
Nested loops: a small outer input with an index on the inner side (typical OLTP). Hash: large, unsorted inputs; builds a hash table in memory (watch spills). Merge: both inputs already sorted on the join key — very efficient for large sorted sets.

**Q7. What causes a sort to spill to tempdb?**
The memory grant, based on estimated rows, was too small for the actual rows. Fix the estimates (statistics, sniffing), provide order via an index, reduce the selected columns, or rely on memory grant feedback.

**Q8. What is cardinality estimation and why does it go wrong?**
The optimizer's prediction of row counts at each step, from statistics histograms and assumptions (independence between predicates, containment). It goes wrong with stale statistics, correlated columns, table variables, functions on columns, multi-statement TVFs and parameter sniffing. Bad estimates → wrong join types, memory grants and index choices.

**Q9. How do you find the worst queries on a server?**
Query Store (top duration, CPU and reads; regressed queries), `sys.dm_exec_query_stats` joined to the SQL text and plans, Extended Events for long-running queries, and wait statistics to understand *why* they're slow.

**Q10. How do you tune a slow stored procedure?**
Reproduce it with the real parameters; get the actual plan and `STATISTICS IO/TIME`; find the most expensive operator and estimate errors; fix SARGability, indexes and statistics; check for sniffing; avoid row-by-row logic (cursors, scalar UDFs); and verify with Query Store after deployment.

---

## 8. Transactions, Isolation, Locking & Deadlocks

**Key concepts**
- **ACID:** Atomicity (all or nothing — the transaction log + rollback), Consistency (constraints), Isolation (locks/row versions), Durability (write-ahead log hardened on commit).
- **Isolation levels**

| Level | Dirty read | Non-repeatable read | Phantom | Mechanism |
|---|---|---|---|---|
| READ UNCOMMITTED / `NOLOCK` | ✅ | ✅ | ✅ | no shared locks; can read rows twice or skip them |
| **READ COMMITTED** (default) | ❌ | ✅ | ✅ | short shared locks; readers block on writers |
| **RCSI** (READ_COMMITTED_SNAPSHOT ON) | ❌ | ✅ | ✅ | statement-level row versions; **readers don't block writers** |
| REPEATABLE READ | ❌ | ❌ | ✅ | shared locks held to the end of the transaction |
| **SNAPSHOT** | ❌ | ❌ | ❌ | transaction-level versions; **update conflicts → error 3960** |
| SERIALIZABLE | ❌ | ❌ | ❌ | key-range locks; most blocking |

- **Lock modes:** Shared (S), Update (U — prevents conversion deadlocks), Exclusive (X), Intent (IS/IX/IU), Schema (Sch-S/Sch-M). **Granularity:** row/key → page → table (plus partition).
- **Lock escalation:** about **5,000 locks** on one object → escalates to a table lock → blocks everyone. Avoid with batching (e.g., 2,000 rows per transaction) or `ALTER TABLE ... SET (LOCK_ESCALATION = AUTO|DISABLE)`.
- **Blocking** = waiting on a lock; **deadlock** = a cycle; SQL Server's lock monitor picks a victim (error **1205**; the lowest rollback cost, or set `DEADLOCK_PRIORITY`).
- **Optimistic concurrency:** a `rowversion` column checked in `WHERE` (0 rows affected = conflict). **Pessimistic:** `UPDLOCK`/`HOLDLOCK` hints in short transactions.
- **RCSI/SNAPSHOT cost:** the tempdb version store, 14 bytes per row, and longer version chains with long-running transactions.
- **Long transactions** hold locks, block log truncation (log growth), bloat the version store, and lengthen recovery.
- **`SET XACT_ABORT ON`** in procedures so any error rolls back the whole transaction.

```sql
-- Turn on RCSI (needs a brief exclusive moment on the database)
ALTER DATABASE Payments SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;

-- Safe procedure transaction template
CREATE OR ALTER PROCEDURE dbo.TransferFunds @From BIGINT, @To BIGINT, @Amount DECIMAL(19,4)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRAN;
        -- consistent lock order (lower id first) prevents A↔B deadlocks
        UPDATE Accounts SET Balance = Balance - @Amount
        WHERE AccountId = @From AND Balance >= @Amount;
        IF @@ROWCOUNT = 0 THROW 50001, 'Insufficient funds', 1;
        UPDATE Accounts SET Balance = Balance + @Amount WHERE AccountId = @To;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;                                    -- rethrow with the original error
    END CATCH
END;

-- Optimistic concurrency with rowversion
UPDATE Accounts SET Nickname = @n
WHERE AccountId = @id AND RowVer = @originalRowVer;
IF @@ROWCOUNT = 0 THROW 50002, 'Concurrency conflict', 1;

-- Pessimistic: lock the row for this short transaction (queue-style processing)
SELECT TOP (10) * FROM WorkQueue WITH (UPDLOCK, READPAST, ROWLOCK) WHERE Status = 'NEW' ORDER BY Id;

-- Who is blocking whom?
SELECT r.session_id, r.blocking_session_id, r.wait_type, r.wait_time, t.text
FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE r.blocking_session_id <> 0;

-- Batched delete to avoid lock escalation and log growth
WHILE 1 = 1
BEGIN
    DELETE TOP (2000) FROM AuditLog WHERE CreatedAt < DATEADD(YEAR, -7, SYSUTCDATETIME());
    IF @@ROWCOUNT = 0 BREAK;
END;

-- Deadlock graphs from the default system_health session
SELECT xed.value('@timestamp', 'datetime2'), xed.query('.')
FROM (SELECT CAST(target_data AS XML) AS td FROM sys.dm_xe_session_targets st
      JOIN sys.dm_xe_sessions s ON s.address = st.event_session_address
      WHERE s.name = 'system_health' AND st.target_name = 'ring_buffer') x
CROSS APPLY td.nodes('//RingBufferTarget/event[@name="xml_deadlock_report"]') AS q(xed);
```

**Common interview questions**

**Q1. Explain the isolation levels.**
READ UNCOMMITTED reads dirty data. READ COMMITTED (the default) prevents dirty reads with short shared locks. REPEATABLE READ holds shared locks so rows can't change underneath you (phantoms are still possible). SERIALIZABLE adds range locks, preventing phantoms. SNAPSHOT and RCSI use row versioning: readers see committed versions without blocking writers.

**Q2. Show dirty, non-repeatable and phantom reads.**
Dirty: session A updates without committing, B reads the uncommitted value with NOLOCK, A rolls back. Non-repeatable: B reads a row twice inside a transaction and A updates and commits in between → different values. Phantom: B runs `COUNT(*) WHERE x > 10` twice and A inserts a matching row in between.

**Q3. RCSI vs SNAPSHOT isolation?**
RCSI changes READ COMMITTED to statement-level versioning — transparent to applications; readers never block writers. SNAPSHOT is opt-in per transaction with transaction-level consistency; if two snapshot transactions update the same row, the second fails with update-conflict error 3960. Both use the tempdb version store.

**Q4. Someone wants `NOLOCK` everywhere to fix blocking. Your response?**
No: it can return uncommitted data and miss or duplicate rows during page splits — unacceptable for financial data. Enable RCSI instead, which removes reader/writer blocking with consistent reads, and fix the long transactions and missing indexes that cause blocking.

**Q5. What is lock escalation and how do you avoid problems?**
When a statement holds roughly 5,000+ locks on one object, SQL Server escalates to a table (or partition) lock to save memory — which blocks other sessions. Avoid it by batching large modifications, using indexes so fewer rows are locked, or setting partition-level escalation.

**Q6. How does SQL Server handle deadlocks and how do you fix them?**
The lock monitor detects the cycle (about every 5 seconds) and kills the cheapest transaction to roll back (error 1205). Diagnose from the deadlock graph (system_health XE): which statements, objects and lock modes. Fix: access objects in a consistent order, keep transactions short, add indexes so fewer rows are scanned and locked, use RCSI for reader/writer deadlocks, and retry 1205 in the application.

**Q7. Optimistic vs pessimistic concurrency?**
Optimistic: no locks held; detect conflicts at write time with a rowversion check — best for low contention and web apps. Pessimistic: lock on read (UPDLOCK) inside a short transaction — best when conflicts are frequent and retries are expensive (e.g., allocating limited inventory).

**Q8. Why are long transactions harmful?**
They hold locks (blocking), prevent log truncation (log growth), keep row versions alive (tempdb growth), increase deadlock chances, and make rollback and recovery slow. Keep transactions short; never wait for user input or remote calls inside one.

**Q9. What does `SET XACT_ABORT ON` do?**
Any runtime error aborts and rolls back the entire transaction, instead of leaving it open after statement-level errors. Standard practice in procedures with explicit transactions.

---

## 9. Stored Procedures, Functions, Views, Triggers & Temp Objects

**Key concepts**
- **Stored procedures:** precompiled/cached plans, security boundary (grant EXECUTE only), fewer round trips; can return multiple result sets and use transactions. Use `sp_executesql` with parameters for dynamic SQL (prevents injection and enables plan reuse).
- **Functions:** scalar UDFs (historically row-by-row and they prevent parallelism; SQL 2019 can **inline** many of them), **inline table-valued functions** (a single SELECT — behaves like a parameterized view, optimizer-friendly), multi-statement TVFs (poor estimates — avoid on hot paths). Functions can't change data.
- **Views:** saved queries for abstraction and security; **indexed views** materialize results (schema binding, maintenance cost on writes).
- **Triggers:** AFTER / INSTEAD OF; they run inside the caller's transaction; work with the `inserted`/`deleted` pseudo-tables **as sets** (multi-row!). Hidden logic and performance cost → use sparingly (audit, legacy integrity).
- **Cursors:** row-by-row → usually replace with set-based SQL; if needed, use `LOCAL FAST_FORWARD`.
- **Temporal tables** for automatic history (see §11).
- **Sequences** vs **IDENTITY:** a sequence is shared and can be fetched before insert.
- **MERGE:** convenient but has had bugs and concurrency issues; use it carefully with `HOLDLOCK`, or prefer separate UPDATE/INSERT.

```sql
-- Inline TVF (good) vs scalar UDF (often bad on large sets)
CREATE OR ALTER FUNCTION dbo.CustomerOrders(@CustomerId BIGINT)
RETURNS TABLE AS RETURN
    SELECT OrderId, OrderDate, Amount FROM dbo.Orders WHERE CustomerId = @CustomerId;
GO
SELECT * FROM dbo.CustomerOrders(42);

-- Safe dynamic SQL
DECLARE @sql NVARCHAR(MAX) = N'SELECT * FROM dbo.Orders WHERE Status = @s AND OrderDate >= @d';
EXEC sp_executesql @sql, N'@s VARCHAR(20), @d DATETIME2', @s = 'PAID', @d = '2026-01-01';

-- Set-based audit trigger (handles multi-row updates)
CREATE OR ALTER TRIGGER trg_Accounts_Audit ON dbo.Accounts AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.AccountAudit (AccountId, OldBalance, NewBalance, ChangedAt, ChangedBy)
    SELECT d.AccountId, d.Balance, i.Balance, SYSUTCDATETIME(), SUSER_SNAME()
    FROM inserted i JOIN deleted d ON d.AccountId = i.AccountId
    WHERE i.Balance <> d.Balance;
END;

-- Indexed view for a hot aggregate
CREATE VIEW dbo.vDailySales WITH SCHEMABINDING AS
SELECT CAST(OrderDate AS DATE) AS D, COUNT_BIG(*) AS Cnt, SUM(Amount) AS Total
FROM dbo.Orders GROUP BY CAST(OrderDate AS DATE);
GO
CREATE UNIQUE CLUSTERED INDEX IX_vDailySales ON dbo.vDailySales(D);
```

**Common interview questions**

**Q1. Stored procedure vs function?**
A procedure can modify data, manage transactions, return multiple result sets and output parameters; it's called with EXEC. A function returns a value or table, can't modify data, and can be used inside SELECT/WHERE/JOIN. Inline TVFs are optimizer-friendly; scalar UDFs and multi-statement TVFs can be performance traps.

**Q2. Why are scalar UDFs slow?**
Historically they ran once per row, hid their cost from the optimizer, and forced serial plans. SQL Server 2019 inlines many of them automatically; otherwise rewrite them as inline TVFs or expressions.

**Q3. What's the danger in triggers?**
Hidden side effects, extra work inside every transaction, and the classic bug of assuming one row (`SELECT @id = id FROM inserted`) when a statement changes many. Write them set-based and keep them minimal.

**Q4. How do you prevent SQL injection in dynamic SQL?**
Parameterize with `sp_executesql`; whitelist identifiers (column or table names) and wrap them with `QUOTENAME`; never concatenate user input; and run with least-privilege permissions.

**Q5. View vs indexed view?**
A normal view is just a stored query, expanded at runtime. An indexed view stores the results physically and is maintained on every write — great for expensive, frequently read aggregates; costly on write-heavy tables; and it has many restrictions (SCHEMABINDING, `COUNT_BIG`, deterministic expressions).

**Q6. Cursor vs set-based?**
SQL engines are optimized for set operations; cursors process one row at a time with high overhead. Replace them with joins, window functions or batching; if a cursor is unavoidable, use `LOCAL FAST_FORWARD READ_ONLY`.

---

## 10. Production Troubleshooting Playbook

**Order of investigation:** *what's running now → what is it waiting on → which query and plan → what changed → fix → prevent.*

| Wait type | Meaning | Usual fix |
|---|---|---|
| `LCK_M_*` | blocking on locks | find the head blocker, shorten transactions, RCSI, indexes |
| `PAGEIOLATCH_*` | reading pages from disk | missing indexes (scans), memory pressure, slow storage |
| `CXPACKET`/`CXCONSUMER` | parallelism | tune MAXDOP/cost threshold, fix skew and bad estimates |
| `SOS_SCHEDULER_YIELD` | CPU pressure | expensive queries, scans, scalar UDFs |
| `RESOURCE_SEMAPHORE` | waiting for memory grants | huge sorts and hashes, bad estimates |
| `WRITELOG` | log flush latency | slow log disk, too many tiny commits → batch |
| `PAGELATCH_*` on tempdb | tempdb contention | more tempdb data files, memory-optimized tempdb metadata |
| `ASYNC_NETWORK_IO` | the client isn't consuming results | app reading row-by-row or fetching too much |

```sql
-- What's running right now (or use sp_WhoIsActive)
SELECT r.session_id, r.status, r.wait_type, r.wait_time, r.blocking_session_id, r.cpu_time, r.logical_reads,
       t.text, p.query_plan
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
CROSS APPLY sys.dm_exec_query_plan(r.plan_handle) p
WHERE r.session_id > 50;

-- Top CPU queries from the plan cache
SELECT TOP 10 qs.total_worker_time / qs.execution_count AS AvgCpu, qs.execution_count, st.text
FROM sys.dm_exec_query_stats qs CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
ORDER BY qs.total_worker_time DESC;

-- Server-wide waits since restart
SELECT TOP 15 wait_type, wait_time_ms, waiting_tasks_count FROM sys.dm_os_wait_stats
WHERE wait_type NOT LIKE 'SLEEP%' ORDER BY wait_time_ms DESC;

-- Connections per application/host
SELECT program_name, host_name, COUNT(*) AS Sessions FROM sys.dm_exec_sessions
WHERE is_user_process = 1 GROUP BY program_name, host_name ORDER BY Sessions DESC;
```

**Common interview questions**

**Q1. A query suddenly became slow after a deployment. How do you investigate?**
Query Store: did the plan change (plan regression)? If so, force the previous plan to restore service, then find the cause — new parameter types causing implicit conversion, a changed query shape, statistics updated with a skewed sample, or sniffing. If the plan is the same, check blocking, waits and data volume. Add regression monitoring.

**Q2. CPU is at 95% — what do you do?**
Confirm it's SQL Server (not another process). Find the top CPU queries (Query Store / `dm_exec_query_stats`); look for scans from missing indexes, implicit conversions, parameter sniffing, scalar UDFs, excessive compilations (ad hoc SQL) and parallelism. Fix the worst offenders first; consider `OPTION (RECOMPILE)` storms and plan cache churn.

**Q3. Blocking is increasing — what do you check?**
Find the head blocker (`blocking_session_id` chains, `sp_WhoIsActive`): what statement it runs and whether it's an open transaction idle in the app (a classic: the app forgot to commit). Look at lock types, escalation, missing indexes causing scans, and long transactions. Short term: kill the head blocker if safe. Long term: RCSI, indexes, shorter transactions, batching.

**Q4. Plenty of free CPU but queries are slow. What else?**
Waits: blocking (`LCK`), I/O (`PAGEIOLATCH`, `WRITELOG`), memory grants (`RESOURCE_SEMAPHORE`), tempdb contention, network or client consumption (`ASYNC_NETWORK_IO`), thread-pool starvation in the app, or connection pool exhaustion.

**Q5. Database connections are exhausted. How do you investigate?**
Count sessions by application and host; check whether they're sleeping with open transactions (connection leaks — not disposing `SqlConnection`) or active and blocked (slow queries holding connections). Check app pool settings (default Max Pool Size 100) and whether async code blocks threads. Fix the leaks, the slow queries, and set timeouts.

**Q6. An index seek changed to a scan. Why?**
Statistics changed (the estimated rows crossed the tipping point), a parameter type mismatch (implicit conversion), a query change adding a function or OR, sniffing for a non-selective value, or a dropped or changed index. Compare the old and new plans in Query Store.

**Q7. How do you optimize queries on a 500-million-row table?**
Index for the actual access patterns (covering, filtered); partition by date for maintenance and archiving (partition elimination needs the key in the predicate); a columnstore for analytics; keyset pagination; statistics maintenance with appropriate sampling; batch large modifications; archive cold data; consider read replicas for reporting.

**Q8. How would you design SQL Server for high transaction volume?**
A narrow, efficient schema with the right indexes only; RCSI; short transactions; batched writes; tempdb and log on fast storage with proper file sizing; connection pooling; avoid hotspots (sequential-key last-page contention → `OPTIMIZE_FOR_SEQUENTIAL_KEY`, partitioning); In-Memory OLTP for extreme hot tables; read replicas for reads; and monitoring with Query Store and wait statistics.

---

## 11. Database Design, Partitioning & High Availability

**Key concepts — design**
- **Normalization:** **1NF** atomic values, no repeating groups; **2NF** no partial dependency on part of a composite key; **3NF** no transitive dependency (non-key → non-key); **BCNF** every determinant is a candidate key. OLTP aims for 3NF; analytics uses star schemas (denormalized).
- **Denormalize deliberately** for read performance (stored totals, reporting tables) — and own the consistency (same transaction, triggers or async rebuild).
- **Keys:** candidate (any unique column set), primary (the chosen one), alternate, **surrogate** (IDENTITY/GUID — stable, narrow) vs **natural** (business meaning — can change), foreign key (referential integrity).
- **Constraints:** PK, FK (`ON DELETE NO ACTION | CASCADE | SET NULL`), UNIQUE, CHECK, DEFAULT, NOT NULL — enforce rules in the database, not only in code. Index foreign key columns.
- **Soft delete** (`IsDeleted`, `DeletedAt` + filtered indexes/views) vs **hard delete** (GDPR erasure, simpler queries). **Audit:** temporal tables vs trigger-based audit tables.
- **Multi-tenancy:** shared schema with a `TenantId` column + **row-level security** · schema per tenant · database per tenant (isolation vs cost and operations).

**Key concepts — scale and HA**
- **Partitioning** (one database): a partition function (boundaries) + partition scheme (filegroups); **partition elimination** when queries filter on the key; **partition switching** for instant archive or load; aligned indexes.
- **Sharding** (many databases): application-level routing by a shard key — for write scale beyond one server; cross-shard queries and transactions become hard.
- **HA/DR:** **Always On Availability Groups** (sync = HA with no data loss, async = DR; readable secondaries; listener for failover), **Failover Cluster Instances** (shared storage, instance-level), **log shipping** (simple DR), **transactional replication** (table-level copy to other servers or reporting).
- **Backups:** full + differential + log backups (FULL recovery model) → point-in-time restore. Define **RPO/RTO**, and **test restores**.
- **Archiving:** partition switch out → move to an archive table or cheaper storage; delete in batches otherwise.

```sql
-- 3NF example: customer address split out, enforced with constraints
CREATE TABLE Customers (
    CustomerId BIGINT IDENTITY PRIMARY KEY,
    Email      NVARCHAR(256) NOT NULL CONSTRAINT UQ_Customers_Email UNIQUE,
    Status     VARCHAR(10) NOT NULL CONSTRAINT CK_Customers_Status CHECK (Status IN ('ACTIVE','CLOSED')),
    CreatedAt  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE Orders (
    OrderId    BIGINT IDENTITY PRIMARY KEY,
    CustomerId BIGINT NOT NULL CONSTRAINT FK_Orders_Customers REFERENCES Customers(CustomerId),
    Amount     DECIMAL(19,4) NOT NULL CHECK (Amount > 0)
);
CREATE INDEX IX_Orders_CustomerId ON Orders(CustomerId);    -- always index FKs

-- Monthly partitioning
CREATE PARTITION FUNCTION pfMonthly (DATETIME2) AS RANGE RIGHT FOR VALUES ('2026-08-01', '2026-09-01', '2026-10-01');
CREATE PARTITION SCHEME psMonthly AS PARTITION pfMonthly ALL TO ([PRIMARY]);
CREATE TABLE Txn (TxnId BIGINT NOT NULL, TxnDate DATETIME2 NOT NULL, Amount DECIMAL(19,4) NOT NULL,
                  CONSTRAINT PK_Txn PRIMARY KEY (TxnDate, TxnId)) ON psMonthly(TxnDate);
-- Archive the oldest month instantly (metadata-only)
ALTER TABLE Txn SWITCH PARTITION 1 TO TxnArchive PARTITION 1;

-- System-versioned temporal table (automatic history)
CREATE TABLE Accounts (
    AccountId BIGINT PRIMARY KEY, Balance DECIMAL(19,4) NOT NULL,
    ValidFrom DATETIME2 GENERATED ALWAYS AS ROW START, ValidTo DATETIME2 GENERATED ALWAYS AS ROW END,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.AccountsHistory));
SELECT * FROM Accounts FOR SYSTEM_TIME AS OF '2026-09-30T23:59:59';

-- Row-level security for multi-tenancy
CREATE FUNCTION dbo.fn_TenantFilter(@TenantId INT) RETURNS TABLE WITH SCHEMABINDING AS
RETURN SELECT 1 AS ok WHERE @TenantId = CAST(SESSION_CONTEXT(N'TenantId') AS INT);
CREATE SECURITY POLICY TenantPolicy ADD FILTER PREDICATE dbo.fn_TenantFilter(TenantId) ON dbo.Orders WITH (STATE = ON);
-- app sets per connection: EXEC sp_set_session_context N'TenantId', 42;
```

**Common interview questions**

**Q1. Explain 1NF, 2NF and 3NF with an example.**
An `Orders(OrderId, ProductIds="1,2,3")` column violates 1NF → move to `OrderItems` rows. `OrderItems(OrderId, ProductId, ProductName)`: ProductName depends only on ProductId (part of the key) → 2NF violation → move it to `Products`. `Orders(OrderId, CustomerId, CustomerCity)`: city depends on the customer, not the order → 3NF violation → keep it in `Customers`.

**Q2. When would you denormalize?**
When read performance requires it and you can own the consistency: reporting tables, cached aggregates (an account's current balance), read models in CQRS, or avoiding expensive joins on hot paths. Document the source of truth and how the copy stays in sync.

**Q3. Surrogate vs natural key?**
Surrogate keys (IDENTITY, sequential GUID) are stable, narrow and meaningless — ideal for PKs and FKs. Natural keys (email, ISIN, IBAN) can change and are often wide; keep them as UNIQUE constraints. Typical design: a surrogate PK plus unique natural keys.

**Q4. Partitioning vs sharding?**
Partitioning splits one table inside one database — great for manageability (archiving, maintenance) and partition elimination, but it doesn't add write capacity beyond one server. Sharding splits data across multiple databases or servers for scale, at the cost of routing, cross-shard queries, rebalancing and distributed transactions.

**Q5. Always On AG vs replication vs log shipping?**
AGs are database-level HA/DR with automatic failover (synchronous) and readable secondaries. Transactional replication copies selected tables and objects to other databases (good for reporting or distribution, not HA). Log shipping is simple, asynchronous DR with manual failover. FCI gives instance-level HA on shared storage.

**Q6. Soft delete or hard delete?**
Soft delete keeps history and enables undo, but every query must filter it (use views, filtered indexes or EF query filters) and it conflicts with GDPR erasure. Hard delete is simpler and compliant — keep history via temporal or audit tables. In finance, records are usually never deleted; they're reversed or closed.

**Q7. How do you design a multi-tenant database?**
Choose an isolation level by risk and cost: shared tables with `TenantId` + row-level security (cheapest, needs strong enforcement), schema per tenant, or database per tenant (strong isolation, per-tenant backup and restore, higher ops cost — elastic pools help). Put `TenantId` first in indexes and derive it from the authenticated session.

**Q8. Temporal tables vs audit triggers?**
Temporal tables automatically keep full row history with point-in-time queries — little code, consistent. Audit triggers give custom content (who, why, which columns) but are code you must maintain and test. For "who did it", combine a temporal table with application-level audit context.

**Q9. Design an archiving strategy for a huge history table.**
Partition by date; keep N months hot; switch old partitions out to an archive table or filegroup (or export to cheap storage such as Parquet in a data lake); compress archives (page compression or columnstore); keep queries working through a view if needed; and respect retention regulations (e.g., 7 years) with legal holds.

---

## 12. SQL Server & Microservices

**Key concepts**
- **Database per service:** each service owns its data; others access it via APIs or events → independent deployment and scaling. Cost: no cross-service joins or transactions, data duplication, eventual consistency, more databases to operate.
- **A shared database** couples services through the schema (one change breaks others), creates noisy neighbours, and blurs ownership.
- **Avoid distributed transactions (2PC/MSDTC):** blocking, coordinator failures, poor scalability, unsupported in many cloud setups → use **sagas** (local transactions + compensations).
- **Transactional outbox:** write the business row **and** an `Outbox` row in the **same local transaction**; a relay publishes to the broker and marks rows sent → no lost or phantom events (solves the dual-write problem). Consumers must be idempotent.
- **CDC (Change Data Capture):** reads the transaction log into change tables; Debezium can stream to Kafka. Use it for replication and read models (watch schema-change handling and lag).
- **Idempotent consumers:** an `Inbox`/`ProcessedMessages` table with a unique `MessageId`, checked in the same transaction as the business change.
- **CQRS read models** are updated from events → stale for a moment; the UI must handle read-your-own-writes.
- **Reconciliation jobs** detect drift between services.

```sql
CREATE TABLE Outbox (
    OutboxId     BIGINT IDENTITY PRIMARY KEY,
    AggregateId  VARCHAR(64) NOT NULL,
    EventType    VARCHAR(100) NOT NULL,
    Payload      NVARCHAR(MAX) NOT NULL,
    CreatedAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    PublishedAt  DATETIME2 NULL
);
CREATE INDEX IX_Outbox_Unpublished ON Outbox(OutboxId) WHERE PublishedAt IS NULL;

-- Business write + event in ONE transaction
BEGIN TRAN;
INSERT Orders (OrderId, CustomerId, Amount, Status) VALUES (@id, @cust, @amt, 'PLACED');
INSERT Outbox (AggregateId, EventType, Payload) VALUES (@id, 'OrderPlaced', @json);
COMMIT;

-- Relay: claim a batch safely across multiple relay instances
WITH batch AS (SELECT TOP (100) * FROM Outbox WITH (UPDLOCK, READPAST, ROWLOCK)
               WHERE PublishedAt IS NULL ORDER BY OutboxId)
UPDATE batch SET PublishedAt = SYSUTCDATETIME()
OUTPUT inserted.OutboxId, inserted.EventType, inserted.Payload;   -- publish these (at-least-once)

-- Idempotent consumer
BEGIN TRAN;
INSERT ProcessedMessages (MessageId, ProcessedAt) VALUES (@msgId, SYSUTCDATETIME());  -- PK violation = duplicate → skip
UPDATE Inventory SET Reserved = Reserved + @qty WHERE ProductId = @pid;
COMMIT;

-- Enable CDC
EXEC sys.sp_cdc_enable_db;
EXEC sys.sp_cdc_enable_table @source_schema = 'dbo', @source_name = 'Orders', @role_name = NULL;
```

**Common interview questions**

**Q1. Database per service — benefits and costs?**
Benefits: autonomy, independent schema evolution and scaling, fault isolation, clear ownership. Costs: no joins or ACID across services, data duplication, eventual consistency, sagas and outbox complexity, reporting needs a separate store, more operational overhead.

**Q2. Why avoid 2PC across microservices?**
The coordinator is a single point of failure; locks are held across network calls (blocking); availability is the product of all participants'; many brokers and cloud databases don't support it. Sagas with local transactions, idempotency and compensations scale better.

**Q3. Explain the transactional outbox.**
Saving to the database and publishing to a broker can't be atomic (the dual-write problem). So store the event in an outbox table in the same transaction as the state change; a separate relay (polling or CDC) publishes it and marks it sent. Delivery is at-least-once, so consumers must deduplicate.

**Q4. How does CDC work and when do you use it?**
SQL Server's CDC reads committed changes from the transaction log into change tables (`cdc.dbo_Orders_CT`) with LSNs; tools like Debezium stream them to Kafka. Use it for read models, search indexes, data lake feeds and outbox relaying, without application code changes. Watch latency, retention and schema changes.

**Q5. How do you enforce idempotency at the database layer?**
Unique constraints on idempotency keys or message IDs, inserted in the same transaction as the business change; conditional updates (`WHERE Status = 'PENDING'`) for state transitions; upserts guarded by a unique key.

**Q6. Two services' data have drifted. How do you reconcile?**
Periodic reconciliation jobs compare keys, counts and checksums (or the event log vs state), classify breaks (missing, mismatched, timing), auto-repair safe cases by replaying events, and route the rest to humans. Monitor drift as a metric.

---

## 13. FinTech SQL: Payments, Ledger, Reconciliation, Audit

**Key concepts**
- **Amounts:** `DECIMAL(19,4)` or `BIGINT` minor units + `CHAR(3)` currency — never FLOAT.
- **Payment status lifecycle:** `CREATED → AUTHORIZED → CAPTURED → SETTLED`, with `FAILED`, `REFUNDED`, `REVERSED`. Enforce valid transitions with conditional updates; store status history.
- **Double-entry ledger:** every transaction has ≥ 2 entries; **sum of debits = sum of credits**. **Append-only:** never UPDATE/DELETE entries — correct with **reversing entries**.
- **Balance:** derived from entries (always correct, slower) or stored in an `AccountBalance` row updated **in the same transaction** as the entries (fast) — and verified nightly against the sum of entries.
- **Overdraft prevention:** a conditional update `WHERE Balance >= @amt`, or `UPDLOCK` on the balance row.
- **Reconciliation:** load the external settlement file into staging → match on reference/amount/date → classify breaks (missing internally, missing externally, amount mismatch, timing difference, duplicate) → auto-resolve timing breaks → route the rest to an ops queue.
- **Duplicate detection:** idempotency keys (unique constraint) and heuristic matches (same account, amount and merchant within N minutes).
- **Audit (SOX/PCI):** immutable entries (deny UPDATE/DELETE permissions, triggers to block changes), who/when/why columns, temporal history, a hash chain for tamper evidence, separation of duties, retention (often 7+ years), and no card numbers stored in clear (tokenize; PCI scope).

```sql
CREATE TABLE LedgerTransaction (
    TxnId          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    IdempotencyKey VARCHAR(64) NOT NULL CONSTRAINT UQ_Ledger_Idem UNIQUE,
    Description    NVARCHAR(200) NOT NULL,
    CreatedAt      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CreatedBy      NVARCHAR(128) NOT NULL DEFAULT SUSER_SNAME()
);
CREATE TABLE LedgerEntry (
    EntryId     BIGINT IDENTITY PRIMARY KEY,
    TxnId       UNIQUEIDENTIFIER NOT NULL REFERENCES LedgerTransaction(TxnId),
    AccountId   BIGINT NOT NULL,
    Direction   CHAR(1) NOT NULL CHECK (Direction IN ('D','C')),
    AmountMinor BIGINT NOT NULL CHECK (AmountMinor > 0),
    Currency    CHAR(3) NOT NULL
);
CREATE INDEX IX_LedgerEntry_Account ON LedgerEntry(AccountId, EntryId) INCLUDE (Direction, AmountMinor);

-- Post a transfer atomically: entries + balance update + balanced check
CREATE OR ALTER PROCEDURE dbo.PostTransfer @Key VARCHAR(64), @From BIGINT, @To BIGINT, @Amt BIGINT, @Ccy CHAR(3)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF EXISTS (SELECT 1 FROM LedgerTransaction WHERE IdempotencyKey = @Key) RETURN;   -- already posted
    DECLARE @Txn UNIQUEIDENTIFIER = NEWID();
    BEGIN TRAN;
        UPDATE AccountBalance SET BalanceMinor = BalanceMinor - @Amt
        WHERE AccountId = @From AND Currency = @Ccy AND BalanceMinor >= @Amt;
        IF @@ROWCOUNT = 0 THROW 50010, 'Insufficient funds', 1;
        UPDATE AccountBalance SET BalanceMinor = BalanceMinor + @Amt WHERE AccountId = @To AND Currency = @Ccy;

        INSERT LedgerTransaction (TxnId, IdempotencyKey, Description) VALUES (@Txn, @Key, 'Transfer');
        INSERT LedgerEntry (TxnId, AccountId, Direction, AmountMinor, Currency)
        VALUES (@Txn, @From, 'D', @Amt, @Ccy), (@Txn, @To, 'C', @Amt, @Ccy);
    COMMIT;      -- the unique key on IdempotencyKey catches concurrent duplicates
END;

-- Integrity check: every transaction balances
SELECT TxnId FROM LedgerEntry
GROUP BY TxnId
HAVING SUM(CASE Direction WHEN 'D' THEN AmountMinor ELSE -AmountMinor END) <> 0;

-- Stored balance vs derived balance (nightly)
SELECT b.AccountId, b.BalanceMinor, e.Derived
FROM AccountBalance b
JOIN (SELECT AccountId, SUM(CASE Direction WHEN 'C' THEN AmountMinor ELSE -AmountMinor END) AS Derived
      FROM LedgerEntry GROUP BY AccountId) e ON e.AccountId = b.AccountId
WHERE b.BalanceMinor <> e.Derived;

-- Reconciliation against a bank settlement file loaded into staging
SELECT COALESCE(i.Reference, s.Reference) AS Reference,
       CASE WHEN i.Reference IS NULL THEN 'MISSING_INTERNAL'
            WHEN s.Reference IS NULL THEN 'MISSING_EXTERNAL'
            WHEN i.AmountMinor <> s.AmountMinor THEN 'AMOUNT_MISMATCH'
            ELSE 'MATCHED' END AS BreakType
FROM (SELECT Reference, AmountMinor FROM Payments WHERE SettlementDate = @d) i
FULL OUTER JOIN SettlementStaging s ON s.Reference = i.Reference
WHERE i.Reference IS NULL OR s.Reference IS NULL OR i.AmountMinor <> s.AmountMinor;

-- Valid state transition only
UPDATE Payments SET Status = 'CAPTURED', CapturedAt = SYSUTCDATETIME()
WHERE PaymentId = @id AND Status = 'AUTHORIZED';
IF @@ROWCOUNT = 0 THROW 50020, 'Invalid state transition', 1;

-- Block modifications to ledger history
DENY UPDATE, DELETE ON dbo.LedgerEntry TO AppRole;
```

**Common interview questions**

**Q1. Design a double-entry ledger in SQL Server.**
Tables: `LedgerTransaction` (an ID, a unique idempotency key, metadata) and `LedgerEntry` (transaction ID, account, debit/credit, a positive amount, currency). Every transaction has entries whose debits equal credits — enforced by inserting all entries in one procedure inside one transaction, plus a periodic integrity query. Append-only: corrections are reversing transactions. Index entries by account and time.

**Q2. Stored balance or derived balance?**
Derived from entries is always correct but slows down as history grows. A stored balance is fast; keep it consistent by updating it in the same transaction as the entries, with a conditional update for overdraft protection, and verify it nightly against the sum of entries. Many systems also use snapshots (a balance as of a date + entries since).

**Q3. How do you prevent a negative balance under concurrency?**
An atomic conditional update: `UPDATE ... SET Balance = Balance - @x WHERE Id = @id AND Balance >= @x`, then check `@@ROWCOUNT`. No read-then-write race, because the check and the change happen in one statement under an exclusive lock.

**Q4. How do you reconcile against an external settlement file?**
Bulk load the file into a staging table (validated), FULL OUTER JOIN against internal records on reference (and amount and date), classify each break, auto-match timing differences against the next day's file, write results to a reconciliation table, alert on unresolved breaks, and keep everything auditable. Reconcile even if the partner promises exactly-once.

**Q5. How do you detect duplicate payments without an idempotency key?**
Heuristic matching: same customer or card token, amount, currency and merchant within a short window (a self-join or `LAG` over the time order), flagged for review rather than auto-rejected; then fix the root cause by requiring idempotency keys.

**Q6. How do you represent failed transactions and compensation?**
Never delete or edit: failed payments keep their record with a `FAILED` status and reason; compensation is a new reversing ledger transaction linked to the original (`ReversalOfTxnId`). The full history is visible and auditable.

**Q7. How do you make a ledger SOX/PCI-auditable?**
Immutable, append-only tables (permissions + triggers), who/when/source on every entry, temporal history for reference tables, hash-chaining entries for tamper evidence, separation of duties for schema changes, encrypted and tokenized card data (out of PCI scope), audit log retention, and regular integrity reports.

**Q8. How do you migrate a live `Balance` column to a ledger?**
Create the ledger; write an opening-balance entry per account from a consistent snapshot; dual-write (old column + ledger) in the same transaction; reconcile the two continuously; switch reads to the ledger-derived or maintained balance; then retire direct balance updates — reversible at each step.

---

## 14. Top 40 Rapid-Fire Questions + Principal Questions

1. **Logical query order?** FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → TOP.
2. **WHERE vs HAVING?** Rows before grouping vs groups after.
3. **`COUNT(*)` vs `COUNT(col)`?** All rows vs non-null values.
4. **NULL comparison?** `IS NULL`; `= NULL` is UNKNOWN.
5. **`ISNULL` vs `COALESCE`?** 2 args/first type vs n args/precedence type.
6. **DELETE vs TRUNCATE?** Logged rows + WHERE vs page deallocation + identity reset.
7. **UNION vs UNION ALL?** Removes duplicates (sort cost) vs keeps all (faster).
8. **`NOT IN` trap?** A NULL in the subquery → no rows.
9. **LEFT JOIN turned INNER?** A right-table filter in WHERE.
10. **EXISTS vs JOIN?** A semi-join with no duplicates vs returns columns and may duplicate.
11. **CTE materialized?** No — inlined.
12. **Temp table vs table variable?** Statistics and indexes vs lightweight, few rows.
13. **ROW_NUMBER/RANK/DENSE_RANK?** 1,2,3 / 1,1,3 / 1,1,2.
14. **ROWS vs RANGE?** Physical rows vs peer groups (the default; slower).
15. **Running total?** `SUM() OVER (ORDER BY ... ROWS UNBOUNDED PRECEDING)`.
16. **Previous row?** `LAG()`.
17. **Gaps and islands?** `value − ROW_NUMBER()` groups.
18. **Delete duplicates?** CTE + `ROW_NUMBER() > 1`.
19. **Clustered index?** The table sorted by its key; one per table.
20. **Covering index?** All needed columns; INCLUDE.
21. **Good clustered key?** Narrow, unique, static, increasing.
22. **Composite order?** Equality first, then range.
23. **Key lookup?** Missing columns → make the index cover.
24. **SARGable?** A bare column, matching type, no leading wildcard.
25. **Parameter sniffing?** First-value plan reused → RECOMPILE / OPTIMIZE FOR / Query Store.
26. **SSMS fast, app slow?** Different SET options → different cached plans.
27. **Statistics?** Histograms for cardinality estimates; keep them fresh.
28. **Query Store?** Plan history + forcing; regression detection.
29. **Default isolation?** READ COMMITTED (locking) — enable RCSI.
30. **`NOLOCK`?** Dirty, duplicate or missing rows — avoid.
31. **SNAPSHOT conflict?** Error 3960 on concurrent updates.
32. **Lock escalation?** ~5,000 locks → table lock; batch.
33. **Deadlock error?** 1205; graph in system_health; retry + lock order.
34. **`XACT_ABORT`?** Roll back the whole transaction on any error.
35. **Scalar UDF issue?** Row-by-row, serial plans (inlined in 2019+).
36. **Partitioning vs sharding?** One database vs many databases.
37. **AG vs log shipping?** Automatic HA + readable secondaries vs simple DR.
38. **Outbox?** Event + state in one local transaction.
39. **Money type?** `DECIMAL(19,4)` or BIGINT minor units + currency.
40. **Ledger rule?** Append-only, debits = credits, reversals not edits.

**Principal-level questions**

**P1. Which isolation level would you choose for a payments database, and why?**
RCSI as the database default (consistent reads, no reader/writer blocking), conditional updates or UPDLOCK for check-then-act money movements, SNAPSHOT for consistent multi-statement reports, and SERIALIZABLE only for narrow critical sections. Avoid NOLOCK. Monitor tempdb version store growth and long-running transactions.

**P2. SQL Server or a NoSQL store for a new transactional service?**
A relational database for money, orders and anything needing multi-row atomicity, constraints, ad hoc queries for operations and audit, mature tooling and DBA expertise. NoSQL (DynamoDB, Cosmos DB) when access patterns are simple key-value at massive scale with predictable latency. The "boring" choice is usually the right one for financial correctness.

**P3. The database is the bottleneck at 10× growth. What's your plan, in order?**
Query and index tuning (Query Store top consumers), caching hot reads, read replicas for read-only traffic (handling replica lag), scaling up, partitioning large tables, archiving cold data, CQRS read models, In-Memory OLTP for hot spots, and only then sharding by a natural key (tenant or account) — each step justified by measurements.

**P4. How do you run schema changes safely with zero downtime?**
Expand–contract: additive changes first (nullable columns, new tables), deploy code that writes both shapes, backfill in throttled batches, switch reads, then remove the old structures in a later release. Use online index operations, avoid long schema locks (`WAIT_AT_LOW_PRIORITY`), test on production-size data, and have a rollback plan per step.

**P5. How do you govern SQL performance across many teams?**
Query Store on every database with regression alerts; standard indexing and naming guidelines; code review for data-access changes; performance tests with production-like volumes in CI; per-service database ownership; and dashboards of the top consumers per team.

---

## 15. Mistakes Checklist (say why each is wrong)
- [ ] `= NULL` · `NOT IN` with nullable subqueries · right-table filters in the WHERE of a LEFT JOIN · fan-out double counting
- [ ] FLOAT for money · `DATETIME` without a time zone strategy · `VARCHAR(MAX)` everywhere
- [ ] Functions on indexed columns · type mismatches (implicit conversion) · leading-wildcard LIKE · `SELECT *`
- [ ] Random GUID clustered keys · indexing every column · never removing unused indexes · unindexed foreign keys
- [ ] Ignoring estimated vs actual rows · stale statistics after big loads · no Query Store
- [ ] `NOLOCK` on financial data · long transactions · user interaction inside a transaction · no deadlock retry
- [ ] Huge single-statement deletes/updates (lock escalation, log growth)
- [ ] Scalar UDFs and cursors on large sets · single-row triggers · concatenated dynamic SQL
- [ ] Default RANGE frames for running totals · ROW_NUMBER without a tie-breaker
- [ ] Shared databases across microservices · dual writes without an outbox · 2PC across services
- [ ] Updating or deleting ledger rows · balances not reconciled with entries · storing card numbers in clear
- [ ] Backups never restore-tested · no RPO/RTO defined
