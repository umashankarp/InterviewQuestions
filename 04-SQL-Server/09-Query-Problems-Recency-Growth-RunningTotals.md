> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: [[08-Query-Problems-Customer-Order-Date-Patterns]]

# SQL Server Interview Workbook — Query Problems: Recency, Growth & Running Totals

This file covers Q85–Q94 of the workbook: point-in-time/recency lookups, growth-rate calculations, and running-total/percentage-of-total patterns — the query shapes that show up constantly in reporting, billing, and reconciliation code.

**Canonical schema used in this file:**

```sql
CREATE TABLE Customers (CustomerID INT PRIMARY KEY, CustomerName VARCHAR(100), Country VARCHAR(50));
CREATE TABLE Orders (OrderID INT PRIMARY KEY, CustomerID INT, OrderDate DATE, TotalAmount DECIMAL(12,2));
CREATE TABLE Products (ProductID INT PRIMARY KEY, ProductName VARCHAR(100), CategoryID INT, Price DECIMAL(10,2));
CREATE TABLE OrderItems (OrderItemID INT PRIMARY KEY, OrderID INT, ProductID INT, Quantity INT, UnitPrice DECIMAL(10,2));
CREATE TABLE Accounts (AccountID INT PRIMARY KEY, CustomerID INT, Balance DECIMAL(18,2), Currency CHAR(3));
CREATE TABLE Transactions (TransactionID INT PRIMARY KEY, AccountID INT, Amount DECIMAL(18,2), TransactionType VARCHAR(20), Status VARCHAR(20), CreatedAt DATETIME2, IdempotencyKey UNIQUEIDENTIFIER);
CREATE TABLE Employees (EmployeeID INT PRIMARY KEY, FirstName VARCHAR(50), LastName VARCHAR(50), DepartmentID INT, ManagerID INT, Salary DECIMAL(10,2), HireDate DATE);
CREATE TABLE Departments (DepartmentID INT PRIMARY KEY, DepartmentName VARCHAR(100));
```

---

### Q85. Find the latest record for each customer

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Partition the rows by customer, order by the recency column descending, and take rank 1 per partition with `ROW_NUMBER() OVER (PARTITION BY CustomerID ORDER BY OrderDate DESC, OrderID DESC)`. The tiebreaker on a second column (usually the surrogate key) matters — without it, two orders placed on the same date make the result non-deterministic.

**2. SQL Query**
```sql
WITH RankedOrders AS (
    SELECT
        o.*,
        ROW_NUMBER() OVER (PARTITION BY o.CustomerID ORDER BY o.OrderDate DESC, o.OrderID DESC) AS rn
    FROM Orders o
)
SELECT OrderID, CustomerID, OrderDate, TotalAmount
FROM RankedOrders
WHERE rn = 1;
```

**3. Explain the Query**
`PARTITION BY CustomerID` resets the numbering for each customer. `ORDER BY OrderDate DESC, OrderID DESC` puts the most recent order first within each partition, and the `OrderID` tiebreak guarantees a single deterministic winner when two orders share a date. `rn = 1` then picks exactly one row per customer.

**4. Sample Data**
| OrderID | CustomerID | OrderDate  | TotalAmount |
|---|---|---|---|
| 101 | 1 | 2026-06-01 | 250.00 |
| 102 | 1 | 2026-06-15 | 90.00 |
| 103 | 2 | 2026-06-10 | 400.00 |
| 104 | 2 | 2026-06-10 | 120.00 |

**5. Expected Output**
| OrderID | CustomerID | OrderDate | TotalAmount |
|---|---|---|---|
| 102 | 1 | 2026-06-15 | 90.00 |
| 104 | 2 | 2026-06-10 | 120.00 |

(Customer 2's two same-day orders are broken by the higher `OrderID`.)

**6. Alternative Solutions**
- **Correlated subquery / `NOT EXISTS`:** `SELECT * FROM Orders o1 WHERE NOT EXISTS (SELECT 1 FROM Orders o2 WHERE o2.CustomerID = o1.CustomerID AND (o2.OrderDate, o2.OrderID) > (o1.OrderDate, o1.OrderID))`. Correct but SQL Server doesn't support row-value comparisons directly, so it becomes an uglier `OR` chain — avoid it.
- **`OUTER APPLY` per customer:** `SELECT c.CustomerID, x.* FROM Customers c OUTER APPLY (SELECT TOP (1) * FROM Orders o WHERE o.CustomerID = c.CustomerID ORDER BY o.OrderDate DESC, o.OrderID DESC) x`. Preferred when the driving table is `Customers` (you want a row even for customers with zero orders) and there's a matching index — `APPLY` can use a `TOP (1)` per-seek plan that is often cheaper than materializing and ranking the whole `Orders` table first.
- **`MAX()` + join:** get `MAX(OrderDate)` per customer, join back to `Orders`. Breaks silently on same-day ties (returns duplicates) unless you add a second aggregation — more code for no benefit over `ROW_NUMBER`.

**Preferred:** `ROW_NUMBER` for reporting queries over the whole table; `OUTER APPLY` when you're already iterating a small driving set (e.g., "top 50 VIP customers, get their latest order").

**7. Performance**
An index on `(CustomerID, OrderDate DESC, OrderID DESC) INCLUDE (TotalAmount)` lets the `APPLY` variant seek directly to the top row per customer without touching the rest of that customer's orders — critical once a customer can have thousands of orders. The `ROW_NUMBER` version scans and sorts the whole table if no matching index exists; SQL Server can still exploit the same index to avoid an explicit sort, since the window's `ORDER BY` matches the index order.

**8. Edge Cases**
- Customers with zero orders disappear entirely from the `ROW_NUMBER` version (it's an inner scan of `Orders`) — use `OUTER APPLY` from `Customers` if you need them represented with NULLs.
- Same-day, same-second inserts: without a deterministic tiebreak column, re-running the query can return a different "latest" row on each execution even though the data hasn't changed — a real production bug source.
- NULL `OrderDate` sorts first under `ASC` and last under `DESC` by default in SQL Server; if `OrderDate` can be NULL, decide explicitly whether an order with no date should ever be "latest."

**9. Production Scenario**
Customer 360 dashboards, "last order date" columns in a CRM export, and cache-invalidation checks ("has this customer ordered since we last computed their loyalty tier?") are all this exact shape.

**10. Interview Follow-ups**
1. How would you get the latest order per customer *per product category* instead of overall?
2. What changes if you need the top 3 latest orders per customer instead of just 1?
3. How do you keep this fast when `Orders` is 500M rows and partitioned by month?
4. What's the risk of using `MAX(OrderDate)` without a tiebreaker in a billing report?
5. How would you express this in LINQ/EF Core against the same schema?

**11. Follow-up Answers**
1. Add `CategoryID` (via a join to `OrderItems`/`Products`) into the `PARTITION BY` list — the ranking logic doesn't change, only the partition key.
2. Change the filter from `rn = 1` to `rn <= 3` — `ROW_NUMBER` (not `RANK`) is still correct because you want exactly 3 rows even if there are ties, unless the business wants ties included, in which case switch to `RANK() <= 3`.
3. Rely on partition elimination (query only the last 1–2 monthly partitions when you know most "latest" orders are recent) combined with the covering index above; for the rare customer whose latest order is old, a per-customer `APPLY` seek still finds it in O(log n) without scanning older partitions if the index spans all partitions.
4. `MAX(OrderDate)` joined back to `Orders` returns every order matching that max date — silently doubling rows for same-day repeat customers, which then double-counts revenue in a downstream `SUM`.
5. `orders.GroupBy(o => o.CustomerId).Select(g => g.OrderByDescending(o => o.OrderDate).ThenByDescending(o => o.OrderId).First())` — but flag that naive EF Core translation of `GroupBy` + `First()` historically produced client-evaluated or subquery-heavy SQL; verify the generated T-SQL uses `ROW_NUMBER` (EF Core 6+ handles this pattern reasonably, but always check the generated plan).

**12. Common Mistakes**
Forgetting the tiebreaker column and shipping a query that's "correct" in dev (no same-day ties in test data) but nondeterministic in production. Using `TOP (1) ... ORDER BY OrderDate DESC` per customer via a loop or cursor instead of a set-based window function.

**13. Architect Insight**
A senior candidate writes the `ROW_NUMBER` query. A staff/architect candidate immediately asks "what happens on a tie" before being asked, and picks the tiebreak column based on what "latest" *means to the business* (last modified? last inserted? highest ID?) rather than assuming `OrderDate` alone is sufficient — because in financial systems, the wall-clock timestamp and the "logical" ordering of events can diverge under clock skew or backdated entries.

---

### Q86. Find the first transaction for each customer

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Same shape as "latest," but flip the ordering direction and go through the customer's accounts: partition by account (or customer, if joining `Accounts`), order by `CreatedAt ASC, TransactionID ASC`, take rank 1.

**2. SQL Query**
```sql
WITH FirstTxnPerAccount AS (
    SELECT
        t.*,
        ROW_NUMBER() OVER (PARTITION BY t.AccountID ORDER BY t.CreatedAt ASC, t.TransactionID ASC) AS rn
    FROM Transactions t
)
SELECT a.CustomerID, f.AccountID, f.TransactionID, f.Amount, f.CreatedAt
FROM FirstTxnPerAccount f
JOIN Accounts a ON a.AccountID = f.AccountID
WHERE f.rn = 1;
```

If "first transaction" must be per *customer* (across all of a customer's accounts) rather than per account, partition by `a.CustomerID` after the join instead:
```sql
WITH CustomerTxns AS (
    SELECT
        a.CustomerID, t.TransactionID, t.Amount, t.CreatedAt,
        ROW_NUMBER() OVER (PARTITION BY a.CustomerID ORDER BY t.CreatedAt ASC, t.TransactionID ASC) AS rn
    FROM Transactions t
    JOIN Accounts a ON a.AccountID = t.AccountID
)
SELECT CustomerID, TransactionID, Amount, CreatedAt
FROM CustomerTxns
WHERE rn = 1;
```

**3. Explain the Query**
Identical mechanics to Q85, inverted: `ASC` ordering surfaces the earliest row per partition. The two variants differ only in *what* you partition by — account-level "first transaction" (useful for account-opening audits) versus customer-level "first transaction" (useful for "customer lifetime start" metrics when one customer can hold several accounts).

**4. Sample Data**
| TransactionID | AccountID | Amount | CreatedAt |
|---|---|---|---|
| 5001 | 10 | 100.00 | 2026-01-05 09:00 |
| 5002 | 10 | -20.00 | 2026-01-06 14:00 |
| 5003 | 11 | 500.00 | 2026-01-04 08:00 |

**5. Expected Output** (account-level)
| CustomerID | AccountID | TransactionID | Amount | CreatedAt |
|---|---|---|---|---|
| 1 | 10 | 5001 | 100.00 | 2026-01-05 09:00 |
| 2 | 11 | 5003 | 500.00 | 2026-01-04 08:00 |

**6. Alternative Solutions**
- `MIN(CreatedAt)` per account joined back to `Transactions` — same duplicate-on-tie risk as Q85's `MAX` variant.
- `OUTER APPLY` from `Accounts`: `SELECT a.*, x.* FROM Accounts a OUTER APPLY (SELECT TOP (1) * FROM Transactions t WHERE t.AccountID = a.AccountID ORDER BY t.CreatedAt ASC, t.TransactionID ASC) x` — preferred when you're already scanning `Accounts` and want every account represented, including brand-new accounts with zero transactions.

**Preferred:** `ROW_NUMBER` for a bulk report over all transactions; `APPLY` when driven from the account/customer dimension table.

**7. Performance**
Same index shape as Q85 but ascending: `(AccountID, CreatedAt, TransactionID) INCLUDE (Amount)`. Ledger and transaction tables are typically append-only and grow unbounded, so this index should exist regardless — "first transaction" queries are a good forcing function to notice if it's missing.

**8. Edge Cases**
- Backdated corrections: a transaction inserted today with a `CreatedAt` of last month will retroactively become the "first" transaction — decide whether "first" means first *chronologically* or first *as recorded* (i.e., order by `TransactionID`/an insert-order surrogate instead of `CreatedAt`). This distinction is a classic financial-services gotcha.
- Reversed/voided transactions: does a reversal count as a "transaction" for this purpose? Usually you'd filter `WHERE Status <> 'VOIDED'` before ranking.

**9. Production Scenario**
KYC/AML systems flag "first transaction after account opening" for enhanced monitoring; customer lifecycle analytics use "first purchase date" as the cohort anchor for retention curves.

**10. Interview Follow-ups**
1. How do you handle the "first transaction" if it must exclude failed/declined transactions?
2. How would this query change if transactions are partitioned across multiple databases (sharded by customer)?
3. What if `CreatedAt` is stored in the transaction's local timezone rather than UTC?

**11. Follow-up Answers**
1. Add `WHERE t.Status = 'SUCCESS'` inside the CTE before ranking — filtering after ranking would still number failed transactions into contention for rank 1.
2. Push the ranking down to each shard (each shard finds its own candidate first row per customer it owns), then a thin fan-out/fan-in layer picks the global minimum — never pull all raw rows cross-shard just to rank them centrally.
3. Normalize to UTC at write time if at all possible; if not, `CreatedAt` comparisons across accounts opened in different timezones will be off by hours, which is enough to reorder "first" transactions across a midnight boundary — call this out explicitly as a data-quality risk in the design review.

**12. Common Mistakes**
Treating `CreatedAt` as authoritative ordering when a backfill/migration job inserted historical rows with today's insert time but a old business date column — always rank on the *business* timestamp the requirement cares about, not whichever column happens to be indexed.

**13. Architect Insight**
The junior answer stops at "ROW_NUMBER ascending." The architect answer names the semantic ambiguity in "first" (chronological vs. recorded vs. business-date) up front, because getting this wrong in a regulated ledger is a compliance defect, not just a query bug.

---

### Q87. Find the most recent transaction before another given transaction (as-of / point-in-time lookup)

**Difficulty:** 🔴 Senior

**1. Interview Answer**
This is a self-referencing, correlated "as-of" lookup: for a target transaction, find the transaction on the same account with the greatest `CreatedAt` that is still strictly less than the target's `CreatedAt`. Use `OUTER APPLY` (or `CROSS APPLY` if a prior transaction is guaranteed to exist) with a `TOP (1) ... ORDER BY CreatedAt DESC` correlated to the target.

**2. SQL Query**
```sql
DECLARE @TargetTransactionID INT = 5002;

SELECT
    target.TransactionID   AS TargetTransactionID,
    target.CreatedAt       AS TargetCreatedAt,
    prior.TransactionID    AS PriorTransactionID,
    prior.Amount           AS PriorAmount,
    prior.CreatedAt        AS PriorCreatedAt
FROM Transactions target
OUTER APPLY (
    SELECT TOP (1) t.TransactionID, t.Amount, t.CreatedAt
    FROM Transactions t
    WHERE t.AccountID = target.AccountID
      AND t.CreatedAt < target.CreatedAt
    ORDER BY t.CreatedAt DESC, t.TransactionID DESC
) prior
WHERE target.TransactionID = @TargetTransactionID;
```

To compute this for *every* transaction at once (not just one target), replace the outer `WHERE` filter with nothing and let `APPLY` run per row — this is the "running previous value" pattern, which for a single column is more idiomatically solved with `LAG()`:
```sql
SELECT
    TransactionID, AccountID, CreatedAt,
    LAG(TransactionID) OVER (PARTITION BY AccountID ORDER BY CreatedAt, TransactionID) AS PriorTransactionID,
    LAG(CreatedAt)     OVER (PARTITION BY AccountID ORDER BY CreatedAt, TransactionID) AS PriorCreatedAt
FROM Transactions;
```

**3. Explain the Query**
The `OUTER APPLY` form is a *correlated table lookup*, not a window function — it's the right tool when you need an "as-of" answer for one or a few specific rows (e.g., "what was the balance just before this disputed charge?"), because it doesn't require computing the answer for every row in the table. The `LAG()` form computes the immediately-prior row for *every* transaction in one pass and is the right tool for bulk reporting (e.g., "for every transaction, show the gap since the previous one").

**4. Sample Data**
| TransactionID | AccountID | Amount | CreatedAt |
|---|---|---|---|
| 5001 | 10 | 100.00 | 2026-01-05 09:00 |
| 5002 | 10 | -20.00 | 2026-01-06 14:00 |
| 5003 | 10 | 50.00 | 2026-01-07 10:00 |

**5. Expected Output** (target = 5002)
| TargetTransactionID | TargetCreatedAt | PriorTransactionID | PriorAmount | PriorCreatedAt |
|---|---|---|---|---|
| 5002 | 2026-01-06 14:00 | 5001 | 100.00 | 2026-01-05 09:00 |

**6. Alternative Solutions**
- **Correlated subquery with `MAX(CreatedAt)`, then a second lookup:** two round-trips through the logic (find the max prior date, then find the row with that date) — works but is exactly what `APPLY`/`TOP(1)` does in one pass, so prefer `APPLY`.
- **`LAG()` window function:** best when you need this for *every* row rather than one target — O(n log n) once (a single sort) versus O(n) `APPLY` seeks if indexed, but per-target `APPLY` is cheaper when you only need a handful of lookups out of a huge table.
- **Self-join with `<`:** `JOIN Transactions prior ON prior.AccountID = t.AccountID AND prior.CreatedAt < t.CreatedAt` then `GROUP BY ... HAVING MAX(prior.CreatedAt)` — correct but typically a worse plan than `APPLY`/`LAG` because it joins every earlier row before collapsing, rather than seeking directly to the one needed row.

**Preferred:** `APPLY` for single/few-target as-of lookups (dispute investigation tooling); `LAG()` for whole-table reporting.

**7. Performance**
The `APPLY` form needs `(AccountID, CreatedAt DESC, TransactionID DESC) INCLUDE (Amount)` to turn into an index seek + `TOP (1)` — O(log n) per lookup instead of an O(n) scan of that account's history. Without the index, this degrades badly on accounts with years of transaction history. The `LAG()` form benefits from `(AccountID, CreatedAt, TransactionID)` matching its `PARTITION BY`/`ORDER BY` so the engine can stream instead of sort.

**8. Edge Cases**
- No prior transaction exists (first transaction on the account) — `OUTER APPLY` correctly returns NULLs; using `CROSS APPLY` would silently drop the target row entirely, which is a common bug when someone "simplifies" the query.
- Exact-timestamp ties (two transactions with identical `CreatedAt`): the `TransactionID DESC` tiebreak in `ORDER BY` is what makes the result deterministic — without it, "the transaction before" is ambiguous by definition.
- `CreatedAt < target.CreatedAt` (strict) vs `<=` — using `<=` on the un-filtered self-join would incorrectly match the target transaction against itself.

**9. Production Scenario**
Dispute/chargeback investigation ("what was the account state right before this charge?"), point-in-time balance reconstruction, and "compare this trade's price to the previous trade" in a market-data or execution-quality context.

**10. Interview Follow-ups**
1. How would you find the running account balance *as of* the prior transaction, not just identify it?
2. How does this pattern relate to temporal tables (`FOR SYSTEM_TIME AS OF`)?
3. What if two accounts need to be compared — "prior transaction on *either* of these two accounts"?

**11. Follow-up Answers**
1. Combine with a running-total window function (see Q91): compute `SUM(Amount) OVER (PARTITION BY AccountID ORDER BY CreatedAt, TransactionID ROWS UNBOUNDED PRECEDING)` as a `RunningBalance` column first, then the `LAG()` of that column *is* the balance just before the target.
2. SQL Server's system-versioned temporal tables answer a related but different question — "what did this *row* look like as of time T" (row history), not "what was the most recent *other* row before time T." They can be combined: query the temporal history `FOR SYSTEM_TIME AS OF @t` to reconstruct row-level state, and use `APPLY`/`LAG` for cross-row sequencing.
3. Drop `AccountID` from the partition/correlation predicate and instead correlate on `AccountID IN (@Account1, @Account2)` — the `APPLY` still seeks per matching account, but now you're merging two accounts' timelines, so add `AccountID` to the `SELECT` list to disambiguate which account the prior transaction belongs to.

**12. Common Mistakes**
Using `CROSS APPLY` when the target might be the very first transaction (silently drops that target row from the result set). Comparing timestamps with `<=` and getting the target back as its own "prior" transaction.

**13. Architect Insight**
Recognizing when to reach for `APPLY` (few lookups, correlated) versus `LAG` (whole-table, ordered pass) versus temporal tables (row-history, not cross-row sequencing) is exactly the kind of tool-selection judgment that separates a senior engineer who "can write the query" from an architect who picks the *cheapest correct* mechanism for the actual access pattern.

---

### Q88. Find customers whose total purchases exceed a threshold

**Difficulty:** 🟢 Basic

**1. Interview Answer**
Aggregate `Orders` by customer with `SUM(TotalAmount)`, then filter the aggregated result with `HAVING`, not `WHERE` — `WHERE` filters rows before aggregation and can't reference the aggregate.

**2. SQL Query**
```sql
DECLARE @Threshold DECIMAL(12,2) = 1000.00;

SELECT
    o.CustomerID,
    SUM(o.TotalAmount) AS TotalPurchases
FROM Orders o
GROUP BY o.CustomerID
HAVING SUM(o.TotalAmount) > @Threshold
ORDER BY TotalPurchases DESC;
```

**3. Explain the Query**
`GROUP BY CustomerID` collapses all of a customer's orders into one row; `SUM(TotalAmount)` computes the aggregate per group; `HAVING` then filters *groups*, evaluated after the aggregation, whereas `WHERE` would be evaluated against individual `Orders` rows before grouping and cannot see `SUM(...)`.

**4. Sample Data**
| CustomerID | TotalAmount |
|---|---|
| 1 | 600.00 |
| 1 | 500.00 |
| 2 | 200.00 |

**5. Expected Output** (`@Threshold = 1000`)
| CustomerID | TotalPurchases |
|---|---|
| 1 | 1100.00 |

**6. Alternative Solutions**
- **CTE + outer filter:** `WITH T AS (SELECT CustomerID, SUM(TotalAmount) tp FROM Orders GROUP BY CustomerID) SELECT * FROM T WHERE tp > @Threshold` — functionally identical to `HAVING`, purely a style choice; prefer it when the aggregate needs to be reused (e.g., also selected in an outer `CASE`) or when the query already has a CTE for readability.
- **Window function + `DISTINCT`:** `SELECT DISTINCT CustomerID, SUM(TotalAmount) OVER (PARTITION BY CustomerID) FROM Orders WHERE ... > @Threshold` — works but computes the sum once per *row* instead of once per group, then throws away duplicates; strictly worse than `GROUP BY`/`HAVING` for this shape.

**Preferred:** plain `GROUP BY`/`HAVING` — simplest, and the optimizer's stream-aggregate plan for it is well understood and easy to reason about.

**7. Performance**
An index on `(CustomerID) INCLUDE (TotalAmount)` lets SQL Server do a stream aggregate per customer without a full table sort, especially valuable if `CustomerID` is already the leading column of the clustering key or another index. On very large `Orders` tables, consider a pre-aggregated summary table (`CustomerOrderTotals`) maintained incrementally, so this query becomes an index seek rather than a full aggregation on every call.

**8. Edge Cases**
- Customers with a mix of positive orders and negative refund rows (if refunds are modeled as negative `TotalAmount`): decide whether "total purchases" means gross or net — this changes whether refunds should be excluded with a `WHERE TotalAmount > 0` before the `GROUP BY`.
- `NULL` `TotalAmount` on an order (e.g., pending pricing) is silently ignored by `SUM`, which can understate a customer's total without any error or warning.

**9. Production Scenario**
Loyalty-tier eligibility checks, VIP-customer flags for support routing, and fraud rules like "flag accounts whose cumulative spend just crossed $10,000 in 24 hours" (same shape with a time-windowed `WHERE` added before the `GROUP BY`).

**10. Interview Follow-ups**
1. How do you make this "purchases in the last 90 days" instead of all-time?
2. How would you keep this fast if it runs on every checkout to check loyalty-tier eligibility in real time?
3. What if "total purchases" must count only completed orders, not cancelled ones?

**11. Follow-up Answers**
1. Add `WHERE o.OrderDate >= DATEADD(DAY, -90, SYSDATETIME())` before the `GROUP BY` — filtering rows first, then aggregating, is correct and lets the optimizer use a date-range seek if `OrderDate` is indexed.
2. Don't recompute from raw `Orders` on every checkout — maintain a running `TotalPurchases` counter on the `Customers`/loyalty table, updated transactionally (in the same transaction as order insertion) or via an async projection (CDC/outbox to a summary table); recomputing a full aggregate synchronously in the checkout path is a latency and lock-contention risk.
3. Add `WHERE o.Status = 'COMPLETED'` before grouping — same caution as Q88's refund note: define "purchase" precisely with the business before writing the filter.

**12. Common Mistakes**
Writing `WHERE SUM(TotalAmount) > @Threshold` (a syntax error — aggregates aren't allowed in `WHERE`) and fixing it by wrapping the whole thing in a subquery instead of just learning `HAVING`. Forgetting `ORDER BY` and assuming `GROUP BY` output is naturally sorted (it is not guaranteed to be).

**13. Architect Insight**
The interesting architectural question isn't the query — it's *where this computation should live*. An architect flags that "check threshold on every request" against a live aggregation doesn't scale, and proposes either a maintained summary table, a cached/denormalized counter updated transactionally, or an async event-driven projection — trading off consistency freshness against read latency and write-path complexity.

---

### Q89. Calculate month-over-month growth

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Aggregate revenue per calendar month, then use `LAG()` over the month-ordered result to pull the previous month's value into the same row, and compute `(current - previous) / previous`.

**2. SQL Query**
```sql
WITH MonthlyRevenue AS (
    SELECT
        DATEFROMPARTS(YEAR(OrderDate), MONTH(OrderDate), 1) AS MonthStart,
        SUM(TotalAmount) AS Revenue
    FROM Orders
    GROUP BY DATEFROMPARTS(YEAR(OrderDate), MONTH(OrderDate), 1)
)
SELECT
    MonthStart,
    Revenue,
    LAG(Revenue) OVER (ORDER BY MonthStart) AS PriorMonthRevenue,
    CAST(
        (Revenue - LAG(Revenue) OVER (ORDER BY MonthStart)) * 100.0
        / NULLIF(LAG(Revenue) OVER (ORDER BY MonthStart), 0)
    AS DECIMAL(6,2)) AS MoMGrowthPct
FROM MonthlyRevenue
ORDER BY MonthStart;
```

**3. Explain the Query**
The CTE first collapses orders into one row per calendar month using `DATEFROMPARTS` (day forced to 1) as a normalized month key — this is preferable to `FORMAT(OrderDate, 'yyyy-MM')` because it stays a comparable/sortable `DATE` rather than a string. The outer query then uses `LAG(Revenue) OVER (ORDER BY MonthStart)` to fetch the immediately preceding month's revenue *in the same row*, and computes the percentage change. `NULLIF(..., 0)` guards the division against a zero-revenue prior month.

**4. Sample Data**
| MonthStart | Revenue |
|---|---|
| 2026-04-01 | 10000 |
| 2026-05-01 | 12000 |
| 2026-06-01 | 9000 |

**5. Expected Output**
| MonthStart | Revenue | PriorMonthRevenue | MoMGrowthPct |
|---|---|---|---|
| 2026-04-01 | 10000 | NULL | NULL |
| 2026-05-01 | 12000 | 10000 | 20.00 |
| 2026-06-01 | 9000 | 12000 | -25.00 |

**6. Alternative Solutions**
- **Self-join on month offset:** `JOIN MonthlyRevenue prior ON prior.MonthStart = DATEADD(MONTH, -1, cur.MonthStart)` — explicit and works, but breaks silently if a month has zero orders and therefore no row at all (the join simply produces no match, rather than a NULL-filled gap) — `LAG()` over a *gapless* calendar spine avoids this (see follow-up 1).
- **Client-side calculation:** pull raw monthly sums to the application and diff them there — pushes trivial arithmetic across a network boundary for no reason; keep it in SQL.

**Preferred:** `LAG()` — it's the textbook tool for "compare this row to the previous row in a defined order," is set-based, and reads as declaratively as the business requirement itself.

**7. Performance**
The aggregation step is the expensive part (a full scan/aggregate of `Orders`, ideally against a covering index on `(OrderDate) INCLUDE (TotalAmount)` or a pre-aggregated `DailyRevenue`/`MonthlyRevenue` rollup table maintained by a nightly job). Once collapsed to one row per month, the `LAG()` computation itself is essentially free — at most a few hundred rows.

**8. Edge Cases**
- **Missing months** (zero orders in a month): the `MonthlyRevenue` CTE simply won't produce a row for that month, which then makes the *next* month's "prior month" incorrectly point two months back. Fix by generating a gapless calendar spine (a numbers-table-driven list of month starts) and `LEFT JOIN` the aggregation onto it, coalescing missing revenue to 0.
- Partial current month (e.g., running this mid-month): comparing a partial month's revenue to a full prior month understates growth — either exclude the current in-progress month or normalize both to "revenue per day so far."
- Division by zero when the prior month had exactly 0 revenue — handled by `NULLIF`.

**9. Production Scenario**
Board-deck revenue dashboards, finance's monthly close reporting, and automated anomaly alerts ("MoM revenue dropped more than 15%, page the on-call analyst").

**10. Interview Follow-ups**
1. How do you handle a month with genuinely zero orders so it doesn't corrupt the next month's comparison?
2. How would you compute a 3-month rolling average alongside this?
3. How do you avoid misleading growth numbers from a partial current month?

**11. Follow-up Answers**
1. Build a calendar/spine table (or a recursive CTE / `GENERATE_SERIES`-style numbers table) of every month in range, `LEFT JOIN` the revenue aggregation onto it, and `COALESCE(Revenue, 0)` — now `LAG()` always sees a row for every month, gap or not.
2. Add `AVG(Revenue) OVER (ORDER BY MonthStart ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)` as a sibling column — same partition-free window, different frame and aggregate function (cross-reference `06-Window-Functions.md` Q63 for the moving-average frame mechanics).
3. Either exclude the in-flight current month from the growth calculation entirely (`WHERE MonthStart < DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)`), or compute a day-normalized run-rate (`Revenue / DAY(EOMONTH(MonthStart))` up to today's day-of-month) so a half-finished month isn't compared apples-to-oranges against a complete one.

**12. Common Mistakes**
Formatting the month key as a string (`'2026-06'`) and then sorting it lexically, which happens to work for `yyyy-MM` but breaks the moment someone reuses the pattern with `MM-yyyy`. Forgetting `NULLIF` and crashing the report on the first month that had zero revenue.

**13. Architect Insight**
The senior-vs-architect line here is the gap-handling: almost everyone gets the happy-path `LAG()` query right immediately. Only the stronger candidates proactively raise "what happens to a month with no orders" before being asked — because in a real revenue report, a silently-skipped zero month doesn't just show a wrong number, it corrupts every subsequent month's growth calculation.

---

### Q90. Calculate year-over-year growth

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Structurally identical to Q89's month-over-month calculation, but aggregated by year, and typically compared using `LAG(Revenue, 1)` with an explicit offset of 1 year — or, for YoY-*by-month* (comparing this June to last June rather than this year total to last year total), partition by calendar month and lag across years.

**2. SQL Query**
```sql
-- Simple annual YoY
WITH YearlyRevenue AS (
    SELECT YEAR(OrderDate) AS OrderYear, SUM(TotalAmount) AS Revenue
    FROM Orders
    GROUP BY YEAR(OrderDate)
)
SELECT
    OrderYear,
    Revenue,
    LAG(Revenue) OVER (ORDER BY OrderYear) AS PriorYearRevenue,
    CAST((Revenue - LAG(Revenue) OVER (ORDER BY OrderYear)) * 100.0
         / NULLIF(LAG(Revenue) OVER (ORDER BY OrderYear), 0) AS DECIMAL(6,2)) AS YoYGrowthPct
FROM YearlyRevenue
ORDER BY OrderYear;

-- Same calendar month, year over year (e.g., "June 2026 vs. June 2025")
WITH MonthlyRevenue AS (
    SELECT YEAR(OrderDate) AS OrderYear, MONTH(OrderDate) AS OrderMonth, SUM(TotalAmount) AS Revenue
    FROM Orders
    GROUP BY YEAR(OrderDate), MONTH(OrderDate)
)
SELECT
    OrderYear, OrderMonth, Revenue,
    LAG(Revenue) OVER (PARTITION BY OrderMonth ORDER BY OrderYear) AS SameMonthPriorYear,
    CAST((Revenue - LAG(Revenue) OVER (PARTITION BY OrderMonth ORDER BY OrderYear)) * 100.0
         / NULLIF(LAG(Revenue) OVER (PARTITION BY OrderMonth ORDER BY OrderYear), 0) AS DECIMAL(6,2)) AS YoYGrowthPct
FROM MonthlyRevenue
ORDER BY OrderMonth, OrderYear;
```

**3. Explain the Query**
The first form is the annual-total version of Q89. The second form is the more commonly-requested "same month, year over year" metric: `PARTITION BY OrderMonth` groups "all Junes together, all Julys together," and `LAG() OVER (PARTITION BY OrderMonth ORDER BY OrderYear)` then compares each month to that *same* month one year prior — which is a materially different (and more useful) metric than comparing December to November.

**4. Sample Data**
| OrderYear | OrderMonth | Revenue |
|---|---|---|
| 2025 | 6 | 8000 |
| 2026 | 6 | 9600 |

**5. Expected Output**
| OrderYear | OrderMonth | Revenue | SameMonthPriorYear | YoYGrowthPct |
|---|---|---|---|---|
| 2025 | 6 | 8000 | NULL | NULL |
| 2026 | 6 | 9600 | 8000 | 20.00 |

**6. Alternative Solutions**
- **`DATEADD(YEAR, -1, ...)` self-join:** join the monthly aggregation to itself on `cur.OrderMonth = prior.OrderMonth AND cur.OrderYear = prior.OrderYear + 1` — equivalent to the `LAG`/`PARTITION BY` version but more verbose; prefer `LAG` unless you need a non-adjacent year offset that a fixed `LAG(x, N)` can't express cleanly (e.g., "compare to whichever year had the highest prior revenue," which isn't a simple offset).
- **`FIRST_VALUE`/`LAST_VALUE` framed by year:** overkill for a simple prior-year lookup; reserve these for min/max-in-frame problems (see `06-Window-Functions.md` Q58).

**Preferred:** the partitioned `LAG()` form — it directly encodes "same calendar month, previous year" without a self-join.

**7. Performance**
Same profile as Q89: the aggregation dominates cost; consider maintaining a pre-aggregated `MonthlyRevenue` rollup (refreshed nightly via an indexed view or a scheduled job) if this report runs frequently against a large `Orders` table, so YoY/MoM dashboards read from a small summary table instead of re-scanning raw transactional data on every page load.

**8. Edge Cases**
- Leap-year February and calendar-length mismatches distort day-normalized comparisons if you ever divide by "days in month" — for YoY revenue *totals* this rarely matters, but flag it if the metric is a daily average.
- A business that changed its fiscal year definition mid-history needs the year boundary computed against the *fiscal* calendar, not `YEAR(OrderDate)` — don't assume calendar year without asking.
- New product lines or acquisitions that didn't exist in the prior year will show "infinite" or NULL growth (division by zero via `NULLIF`) — that NULL is the *correct* answer, not a bug, and should be rendered as "N/A" rather than 0% in a dashboard.

**9. Production Scenario**
Annual-report and investor-deck YoY figures, and capacity-planning forecasts that assume "this year tracks last year plus X% growth."

**10. Interview Follow-ups**
1. How would you compute YoY growth for a metric that must exclude one-time bulk orders (outlier exclusion)?
2. How do you present YoY for a partial current year (e.g., reporting in Q2 of the current year)?
3. How would you extend this to compare against a *3-year average* baseline instead of just the immediately preceding year?

**11. Follow-up Answers**
1. Filter outliers before aggregation (e.g., `WHERE TotalAmount < @OutlierThreshold`, or exclude orders flagged `IsBulkOrder = 1`) inside the `MonthlyRevenue`/`YearlyRevenue` CTE, and document the exclusion rule next to the report — silently excluding data without disclosure is a governance/audit problem in a finance-facing report.
2. Compare only the elapsed portion of both years (`WHERE OrderDate <= same day-of-year cutoff in both years`), often called "trailing comparable period," rather than comparing a partial current year to a full prior year.
3. Replace `LAG(Revenue)` with `AVG(Revenue) OVER (ORDER BY OrderYear ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING)` as the baseline denominator — same window-function toolkit, different frame.

**12. Common Mistakes**
Comparing calendar year totals when the business actually operates on a fiscal year, producing numbers that don't reconcile with finance's own reports. Treating a NULL (no prior-year data) growth result as 0% in a chart, which visually implies flat growth instead of "not applicable."

**13. Architect Insight**
The differentiator is knowing *which* YoY the business means — annual total vs. same-month vs. trailing-comparable-period — and confirming that before writing a single line of SQL. Shipping a technically-correct query that answers the wrong version of "year over year" is a worse outcome than asking one clarifying question up front.

---

### Q91. Calculate running totals

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Use a window `SUM()` with an explicit frame: `SUM(Amount) OVER (ORDER BY CreatedAt, TransactionID ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`. This is the mechanism already introduced in `06-Window-Functions.md` Q59/Q62 — here it's applied to a concrete running-account-balance scenario and compared against pre-window-function alternatives.

**2. SQL Query**
```sql
SELECT
    TransactionID,
    AccountID,
    Amount,
    CreatedAt,
    SUM(Amount) OVER (
        PARTITION BY AccountID
        ORDER BY CreatedAt, TransactionID
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS RunningBalance
FROM Transactions
WHERE Status = 'SUCCESS'
ORDER BY AccountID, CreatedAt, TransactionID;
```

**3. Explain the Query**
`PARTITION BY AccountID` computes an independent running total per account. `ORDER BY CreatedAt, TransactionID` defines the sequence the running total accumulates over (with the `TransactionID` tiebreak for same-timestamp inserts). `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` is the explicit frame meaning "every row from the start of this partition through the current row" — this is also `SUM(Amount) OVER (PARTITION BY AccountID ORDER BY CreatedAt, TransactionID)`'s *default* frame when an `ORDER BY` is present, but writing it explicitly is better practice because it documents intent and avoids surprises if someone later changes the frame elsewhere.

**4. Sample Data**
| TransactionID | AccountID | Amount | CreatedAt |
|---|---|---|---|
| 1 | 10 | 100.00 | 2026-01-01 |
| 2 | 10 | -30.00 | 2026-01-02 |
| 3 | 10 | 50.00 | 2026-01-03 |

**5. Expected Output**
| TransactionID | AccountID | Amount | RunningBalance |
|---|---|---|---|
| 1 | 10 | 100.00 | 100.00 |
| 2 | 10 | -30.00 | 70.00 |
| 3 | 10 | 50.00 | 120.00 |

**6. Alternative Solutions**
- **Recursive CTE:** carry a running accumulator row-by-row (`anchor: first row's amount as running total; recursive: prior running total + current amount`). Correct, but SQL Server evaluates recursive CTEs iteratively rather than set-at-a-time, and it's dramatically slower and harder to read than the window-function form for anything beyond a few thousand rows — avoid it for this problem.
- **Cursor/loop in T-SQL:** row-by-row procedural accumulation. Functionally correct, universally the worst option for a set-based database — flagged explicitly as an anti-pattern in an interview because reaching for a cursor here signals the candidate doesn't know window functions exist.
- **Client-side accumulation:** pull ordered rows and sum in application code — moves compute and network I/O for something the database does natively and efficiently; only justified if the running total needs application-side business rules too complex to express in SQL.

**Preferred:** the window-function form, unconditionally, for any data volume beyond trivial. This is precisely why running totals get a dedicated interview question: candidates who reach for a cursor or recursive CTE here are signaling they don't know the modern T-SQL toolkit.

**7. Performance**
An index on `(AccountID, CreatedAt, TransactionID) INCLUDE (Amount)` lets SQL Server stream the partition in the exact order the window needs, computing the running sum in a single forward pass without an extra sort operator in the plan. Without a matching index, the optimizer inserts a sort before the window aggregate — acceptable for a bounded per-account report, expensive if run unfiltered across a massive multi-tenant table.

**8. Edge Cases**
- Reversed/failed transactions must be excluded (or explicitly included with a sign flip) *before* windowing — filtering after computing the running total would still include them in earlier rows' sums.
- Floating-point drift: use `DECIMAL`/`MONEY`, never `FLOAT`, for money running totals — floating point accumulation error compounds visibly over thousands of rows.
- Concurrent inserts during report generation: a running balance computed mid-stream against a table still receiving writes is a point-in-time snapshot, not a live value — under `READ COMMITTED` (or better, `SNAPSHOT`) isolation, decide explicitly whether the report should reflect transactions committed after the query started.

**9. Production Scenario**
Bank/account statement "balance after this transaction" columns, inventory running-stock-level reports, and cumulative-spend progress bars toward a spending limit or rebate threshold.

**10. Interview Follow-ups**
1. How would you validate that a running balance computed this way matches the account's stored `Balance` column?
2. What if you need the running total to reset at the start of each statement period (e.g., monthly)?
3. How would you make this incremental — updated on each new transaction rather than recomputed from scratch?

**11. Follow-up Answers**
1. Compare the last row's `RunningBalance` per account against `Accounts.Balance` in a reconciliation job — a mismatch indicates either a missed/duplicated transaction or a manual balance adjustment that bypassed the transaction log, both of which are exactly the kind of break a reconciliation process (see `14-SQL-and-FinTech.md`) exists to catch.
2. Add the statement period to the partition key: `PARTITION BY AccountID, DATEFROMPARTS(YEAR(CreatedAt), MONTH(CreatedAt), 1)` — the running total now restarts at the beginning of each month automatically.
3. Don't recompute the full running total on read; maintain `Accounts.Balance` transactionally (update it in the same transaction that inserts the `Transactions` row) so the "current balance" is an O(1) read, and reserve the window-function query for historical/audit reports that need the balance *at every point in time*, not just the current value.

**12. Common Mistakes**
Omitting `ORDER BY` inside the window's `OVER` clause, which for `SUM` silently changes the frame default to "the whole partition" (every row gets the *grand total*, not a running total) rather than raising an error — this is one of the most common real-world window-function bugs. Using `FLOAT` for monetary running totals.

**13. Architect Insight**
An architect doesn't just answer "how do I compute a running total" — they immediately flag the reconciliation angle (follow-up 1): a running total computed independently from the transaction log is also the mechanism for *detecting* drift against a stored balance, which is a core control in any ledger-backed system.

---

### Q92. Calculate cumulative percentage

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Compute the running total (as in Q91) and the grand total (an unbounded, unframed window sum with no `ORDER BY`) in the same query, then divide.

**2. SQL Query**
```sql
SELECT
    ProductID,
    Revenue,
    SUM(Revenue) OVER (ORDER BY Revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS CumulativeRevenue,
    SUM(Revenue) OVER () AS GrandTotalRevenue,
    CAST(
        SUM(Revenue) OVER (ORDER BY Revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) * 100.0
        / SUM(Revenue) OVER ()
    AS DECIMAL(6,2)) AS CumulativePct
FROM (
    SELECT oi.ProductID, SUM(oi.Quantity * oi.UnitPrice) AS Revenue
    FROM OrderItems oi
    GROUP BY oi.ProductID
) ProductRevenue
ORDER BY Revenue DESC;
```

**3. Explain the Query**
`SUM(Revenue) OVER (ORDER BY Revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)` is the running total from highest-revenue product down. `SUM(Revenue) OVER ()` — no `ORDER BY`, no frame — computes the grand total across *all* rows and repeats it on every row (this is the classic "total without collapsing rows" window-function trick). Dividing the two per row gives the cumulative percentage of total revenue contributed by the top N products so far — the basis of an 80/20 (Pareto) analysis.

**4. Sample Data**
| ProductID | Revenue |
|---|---|
| 1 | 5000 |
| 2 | 3000 |
| 3 | 2000 |

**5. Expected Output**
| ProductID | Revenue | CumulativeRevenue | GrandTotalRevenue | CumulativePct |
|---|---|---|---|---|
| 1 | 5000 | 5000 | 10000 | 50.00 |
| 2 | 3000 | 8000 | 10000 | 80.00 |
| 3 | 2000 | 10000 | 10000 | 100.00 |

**6. Alternative Solutions**
- **Two separate queries (grand total via a scalar subquery, running total via window function), joined:** `CROSS JOIN (SELECT SUM(Revenue) AS Total FROM ProductRevenue) gt` — works, and is arguably more readable to engineers unfamiliar with the unframed `OVER ()` trick, at the cost of an extra (trivial) subquery. Functionally equivalent performance.
- **Two-pass aggregation in application code:** unnecessary — this is a single-query problem in T-SQL.

**Preferred:** the all-window-function form for conciseness once the team is comfortable reading `OVER ()` as "grand total, no partition, no order."

**7. Performance**
The revenue aggregation (inner `GROUP BY`) is the potentially expensive part on a large `OrderItems` table — index `(ProductID) INCLUDE (Quantity, UnitPrice)` helps. Once collapsed to one row per product, the window computations are cheap (products are typically a small dimension, not billions of rows).

**8. Edge Cases**
- Ties in `Revenue DESC` ordering make the "top N products contributing 80% of revenue" boundary ambiguous — add a deterministic tiebreak (`ProductID`) to the `ORDER BY` inside the window.
- A product with `Revenue = 0` or negative (heavy-return product) will move backwards or stay flat in the cumulative curve — decide whether to exclude non-positive revenue products from a Pareto analysis.
- `GrandTotalRevenue = 0` (no sales at all) causes a division-by-zero — guard with `NULLIF` in production code even though the sample assumes non-zero totals.

**9. Production Scenario**
Pareto (80/20) analysis for inventory/category management ("which 20% of SKUs drive 80% of revenue"), and cumulative-distribution charts in BI dashboards.

**10. Interview Follow-ups**
1. How would you find exactly how many products are needed to reach 80% of total revenue?
2. How does this differ if you need cumulative percentage *within each category* rather than globally?
3. What's the risk of computing `GrandTotalRevenue` per partition vs. globally, and how would the query change?

**11. Follow-up Answers**
1. Wrap the query in a CTE and add `WHERE CumulativePct <= 80` (or find the `MIN` row where it first exceeds 80) — `COUNT(*)` over that filtered result answers "how many SKUs."
2. Add `PARTITION BY CategoryID` to *both* window functions (`SUM(...) OVER (PARTITION BY CategoryID ORDER BY Revenue DESC ...)` and `SUM(Revenue) OVER (PARTITION BY CategoryID)`) — each category now gets its own independent cumulative curve and its own 100% denominator.
3. If `GrandTotalRevenue` is accidentally partitioned (e.g., someone copy-pastes the `PARTITION BY` from the running-total window into the grand-total window), every row's "percentage of total" becomes "percentage of its own category" instead of "percentage of everything" — a subtle bug that produces plausible-looking but wrong numbers, which is exactly why explicit, reviewed window clauses matter more than they might seem to for "just an OVER()."

**12. Common Mistakes**
Copy-pasting the `PARTITION BY`/`ORDER BY` clause from the running-total window into the grand-total window (or vice versa) without noticing they must differ — a very easy, very common bug in window-function-heavy queries.

**13. Architect Insight**
This question tests whether a candidate understands that a single `OVER` clause's partition/frame is a semantic decision, not boilerplate to copy between window functions in the same query — conflating them produces numerically plausible but categorically wrong results, the worst kind of bug because it doesn't error, it just misleads.

---

### Q93. Find each department's salary as a percentage of total departmental salary

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Two levels of aggregation: total salary per department, and total salary company-wide (or per some larger grouping), then divide. Framed as "each employee's percentage of their department's total" versus "each department's percentage of company total" — both are common; the query below does the latter, with the former as an alternative.

**2. SQL Query**
```sql
-- Each department's % of total company salary spend
WITH DeptTotals AS (
    SELECT DepartmentID, SUM(Salary) AS DeptSalary
    FROM Employees
    GROUP BY DepartmentID
)
SELECT
    d.DepartmentName,
    dt.DeptSalary,
    CAST(dt.DeptSalary * 100.0 / SUM(dt.DeptSalary) OVER () AS DECIMAL(6,2)) AS PctOfCompanyPayroll
FROM DeptTotals dt
JOIN Departments d ON d.DepartmentID = dt.DepartmentID
ORDER BY PctOfCompanyPayroll DESC;

-- Each employee's % of their OWN department's total salary
SELECT
    e.EmployeeID, e.FirstName, e.LastName, e.DepartmentID, e.Salary,
    CAST(e.Salary * 100.0 / SUM(e.Salary) OVER (PARTITION BY e.DepartmentID) AS DECIMAL(6,2)) AS PctOfDeptPayroll
FROM Employees e
ORDER BY e.DepartmentID, PctOfDeptPayroll DESC;
```

**3. Explain the Query**
The first query aggregates to one row per department, then uses `SUM(DeptSalary) OVER ()` (no partition — a true grand total) as the denominator for each department's share. The second query skips pre-aggregation entirely: `SUM(Salary) OVER (PARTITION BY DepartmentID)` computes each department's total *without collapsing rows*, so every employee row can be divided by their own department's total directly.

**4. Sample Data**
| EmployeeID | DepartmentID | Salary |
|---|---|---|
| 1 | 10 | 80000 |
| 2 | 10 | 120000 |
| 3 | 20 | 100000 |

**5. Expected Output** (per-employee, within-department)
| EmployeeID | DepartmentID | Salary | PctOfDeptPayroll |
|---|---|---|---|
| 2 | 10 | 120000 | 60.00 |
| 1 | 10 | 80000 | 40.00 |
| 3 | 20 | 100000 | 100.00 |

**6. Alternative Solutions**
- **Subquery-per-row for the department total:** `(SELECT SUM(Salary) FROM Employees e2 WHERE e2.DepartmentID = e.DepartmentID)` as a correlated scalar subquery in the `SELECT` list — logically identical to the window-function form but typically re-executes per outer row unless the optimizer recognizes and simplifies it; the window-function form is the modern, preferred idiom precisely because it guarantees single-pass computation.
- **Two-query approach (aggregate then join):** matches the first query's shape; more explicit for readers unfamiliar with unpartitioned/partitioned `OVER()`, functionally equivalent.

**Preferred:** window functions directly on the base table (no pre-aggregation needed) when you need row-level *and* group-level figures together in one result set, as in the per-employee example.

**7. Performance**
An index on `(DepartmentID) INCLUDE (Salary)` supports both the `GROUP BY` and the partitioned window sum efficiently — SQL Server can compute `SUM(Salary) OVER (PARTITION BY DepartmentID)` with a single stream aggregate pass per partition rather than one correlated subquery execution per row.

**8. Edge Cases**
- Employees with `NULL` salary (e.g., unpaid interns, data entry gaps) are excluded from `SUM` automatically — decide if that's correct or if they should count as zero, and be explicit either way in the query/comments.
- A department with exactly one employee will always show 100% — not a bug, but worth calling out so a report reader doesn't misread it as an error.
- Departments with zero employees don't appear in the `Employees`-driven query at all — if department-level reporting must include empty departments, drive from `Departments` with a `LEFT JOIN`.

**9. Production Scenario**
Compensation-planning dashboards for HR/Finance (departmental payroll share of total spend), and headcount-cost allocation for internal chargeback between cost centers.

**10. Interview Follow-ups**
1. How would you compute this hierarchically — division → department → company — in one query?
2. How do you handle mid-year transfers between departments for a period-based percentage?
3. What access-control concerns come up in exposing this query's results broadly?

**11. Follow-up Answers**
1. Use `GROUPING SETS` (or multiple `SUM(...) OVER (PARTITION BY ...)` calls with different partition keys — division, then department, then none) in the same `SELECT`, so one result set carries percentages at every level of the hierarchy simultaneously.
2. Model salary as a time-sliced fact (an `EmployeeSalaryHistory` table with `EffectiveFrom`/`EffectiveTo` and `DepartmentID` at each point in time) rather than a single current `Salary` column, and aggregate over the reporting period's slices — a flat `Employees.Salary` column can't correctly represent "spent 6 months in Dept A and 6 in Dept B."
3. Raw compensation data is among the most sensitive data in any company; this query's output must be access-controlled (row-level security or a restricted reporting role) and should almost never be exposed at the individual-employee level outside HR/Finance — aggregate-only views are the usual mitigation.

**12. Common Mistakes**
Computing department totals with a `GROUP BY` query and then trying to also select individual employee salaries in the same `SELECT` list without a window function — a classic "not an aggregate function and not in the GROUP BY" error, usually "fixed" by throwing every column into `GROUP BY`, which then defeats the aggregation.

**13. Architect Insight**
The interesting architectural point here isn't the SQL — it's follow-up 3. A staff/architect-level candidate proactively raises data-sensitivity and access-control concerns for a query that exposes individual compensation, rather than treating "can I write the SELECT" as the entire scope of the problem.

---

### Q94. Find the top-selling product

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
"Top-selling" is ambiguous between *units sold* and *revenue* — always clarify which, because they frequently disagree (a cheap product sold in bulk can outsell an expensive product in units while losing on revenue). Aggregate `OrderItems` by product on the chosen metric and take the top row.

**2. SQL Query**
```sql
-- By revenue
SELECT TOP (1)
    oi.ProductID,
    p.ProductName,
    SUM(oi.Quantity * oi.UnitPrice) AS TotalRevenue
FROM OrderItems oi
JOIN Products p ON p.ProductID = oi.ProductID
GROUP BY oi.ProductID, p.ProductName
ORDER BY TotalRevenue DESC;

-- By units sold
SELECT TOP (1)
    oi.ProductID,
    p.ProductName,
    SUM(oi.Quantity) AS TotalUnitsSold
FROM OrderItems oi
JOIN Products p ON p.ProductID = oi.ProductID
GROUP BY oi.ProductID, p.ProductName
ORDER BY TotalUnitsSold DESC;
```

**3. Explain the Query**
Both queries aggregate `OrderItems` per product — one by `SUM(Quantity * UnitPrice)` (revenue), the other by `SUM(Quantity)` (units) — then `TOP (1) ... ORDER BY <metric> DESC` picks the winner. Note `TOP (1)` silently picks *one* row arbitrarily among exact ties unless `ORDER BY` includes a tiebreak (`ProductID`), which matters if the report must be reproducible.

**4. Sample Data**
| ProductID | Quantity | UnitPrice |
|---|---|---|
| 1 | 1000 | 2.00 |
| 2 | 50 | 100.00 |

**5. Expected Output**
By revenue → Product 2 (5000 vs. 2000). By units → Product 1 (1000 vs. 50). This divergence is the point of the question.

**6. Alternative Solutions**
- **`ROW_NUMBER() = 1` instead of `TOP (1)`:** identical result for a single winner, but `ROW_NUMBER` generalizes cleanly to "top N" and to "top-selling product *per category*" (`PARTITION BY CategoryID`), whereas `TOP (1)` does not partition — prefer `ROW_NUMBER`/`RANK` the moment the requirement might grow into a per-group top-N.
- **`RANK()` instead of `ROW_NUMBER()`:** use `RANK()` if exact ties should both be reported as "the top seller" rather than arbitrarily picking one.

**Preferred:** `TOP (1)` for a single global answer with a known, simple metric; `ROW_NUMBER`/`RANK` the moment there's any grouping (see Q95's per-category "second-best-seller," which is the direct extension of this problem).

**7. Performance**
A covering index on `OrderItems(ProductID) INCLUDE (Quantity, UnitPrice)` lets the aggregation stream efficiently. For a frequently-run "best seller" widget, maintain a materialized/indexed view or a nightly-refreshed summary table rather than aggregating the full order-line history on every page load.

**8. Edge Cases**
- Exact ties in revenue/units between two products — without a tiebreak, results become nondeterministic across runs, which is confusing on a "trending now" storefront widget that keeps changing between page loads.
- Returned/refunded units: decide whether `Quantity` should be net of returns (subtract a `Returns` table) or gross — "top-selling" for a merchandising decision usually wants *net* demand.
- Time window: "top-selling" almost always implicitly means "this month/quarter," not all-time — clarify before assuming an unbounded aggregation.

**9. Production Scenario**
E-commerce homepage "bestsellers" widgets, merchandising/replenishment decisions (which SKUs to reorder), and quarterly business reviews.

**10. Interview Follow-ups**
1. How would you find the top-selling product *per category* rather than globally?
2. How would this query change to answer "top-selling product this month" vs. all-time?
3. Revenue and units disagree on the winner — which does the business actually care about, and how would you present both without confusing stakeholders?

**11. Follow-up Answers**
1. Add `PARTITION BY p.CategoryID` to a `ROW_NUMBER()` window over the same aggregation and filter `WHERE rn = 1` — this is exactly Q95's pattern one level up.
2. Add `WHERE o.OrderDate >= @PeriodStart AND o.OrderDate < @PeriodEnd` (joining `Orders` for the date) before the `GROUP BY` — the aggregation logic is unchanged, only the row-filtering predicate changes.
3. Present both metrics side by side in the report with clear labels ("#1 by revenue," "#1 by units") rather than picking one and hiding the other — silently choosing one framing to produce a single "the best seller" headline is how misleading dashboards get built; an architect-level answer surfaces the ambiguity rather than resolving it unilaterally.

**12. Common Mistakes**
Answering "top-selling" with only one interpretation (usually units, because `SUM(Quantity)` is the first thing that comes to mind) without asking whether revenue is what the business actually means. Forgetting the join to `Products` and reporting a `ProductID` with no human-readable name.

**13. Architect Insight**
This is a deceptively simple query wrapped around a real ambiguity. The junior answer picks a metric and writes correct SQL for it. The architect answer names the ambiguity explicitly, asks which metric matters for the decision being made, and — if forced to guess — implements both and labels them clearly rather than presenting one number as *the* answer.

---

## References

1. [OVER Clause (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql)
2. [LAG (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/lag-transact-sql)
3. [LEAD (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/lead-transact-sql)
4. [Aggregate Functions (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/aggregate-functions-transact-sql)
5. [FROM clause plus JOIN, APPLY, PIVOT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-transact-sql) — covers `CROSS APPLY`/`OUTER APPLY` syntax
6. [EXISTS (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/exists-transact-sql)
7. [Execution Plan Overview](https://learn.microsoft.com/en-us/sql/relational-databases/performance/execution-plans)
8. [Analyze an actual execution plan](https://learn.microsoft.com/en-us/sql/relational-databases/performance/analyze-an-actual-execution-plan)
