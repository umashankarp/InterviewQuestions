> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: [[07-Query-Problems-Rankings-Duplicates]]

# SQL Server Interview Workbook — Query Problems: Customer/Order Patterns & Date Sequences

Part of the **Top SQL Interview Questions & Answers Workbook** for `04-SQL-Server`. Covers global questions **Q75–Q84**. The first half (Q75–Q78) is the anti-join family — "find X with no matching Y" — which is a different shape from the ranking problems in the previous file and trips up candidates who reach for `NOT IN` without thinking about `NULL`. The second half (Q79–Q83) is the **gaps-and-islands** family, arguably the single hardest recurring pattern in SQL interviews at this level: identifying runs of consecutive values using the "value minus `ROW_NUMBER()`" trick.

**Canonical schema used throughout this file** (extends the schema from `07-Query-Problems-Rankings-Duplicates.md`):

```sql
CREATE TABLE dbo.Customers
(
    CustomerID   INT           NOT NULL PRIMARY KEY,
    CustomerName VARCHAR(100)  NOT NULL,
    Country      VARCHAR(50)   NULL
);

CREATE TABLE dbo.Orders
(
    OrderID     INT           NOT NULL PRIMARY KEY,
    CustomerID  INT           NOT NULL REFERENCES dbo.Customers(CustomerID),
    OrderDate   DATE          NOT NULL,
    TotalAmount DECIMAL(12,2) NOT NULL
);

CREATE TABLE dbo.Products
(
    ProductID   INT           NOT NULL PRIMARY KEY,
    ProductName VARCHAR(100)  NOT NULL,
    CategoryID  INT           NULL
);

CREATE TABLE dbo.OrderItems
(
    OrderItemID INT           NOT NULL PRIMARY KEY,
    OrderID     INT           NOT NULL REFERENCES dbo.Orders(OrderID),
    ProductID   INT           NOT NULL REFERENCES dbo.Products(ProductID),
    Quantity    INT           NOT NULL,
    UnitPrice   DECIMAL(12,2) NOT NULL
);

CREATE TABLE dbo.UserLogins
(
    UserID     INT  NOT NULL,
    LoginDate  DATE NOT NULL,
    PRIMARY KEY (UserID, LoginDate)
);
```

---

### Q75. Find customers who never placed an order

**Difficulty:** 🔴 Senior

**1. Interview Answer**
This is an anti-join: find rows in `Customers` with no corresponding row in `Orders`. The correct, safe tools are `NOT EXISTS` or `LEFT JOIN ... WHERE ... IS NULL`. `NOT IN` is the tool to actively avoid, because it silently returns zero rows for the *entire query* if the subquery's column contains even one `NULL` — a landmine that has caused real production incidents.

**2. SQL Query**
```sql
-- Preferred: NOT EXISTS
SELECT c.CustomerID, c.CustomerName
FROM dbo.Customers c
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.Orders o WHERE o.CustomerID = c.CustomerID
);
```

**3. Explain the Query**
1. For every customer row, the correlated subquery checks whether *any* order references that `CustomerID`.
2. `NOT EXISTS` negates that — true only when no matching order row exists at all.
3. `SELECT 1` inside `EXISTS`/`NOT EXISTS` is idiomatic: the optimizer never materializes the selected column list for an existence check, so `SELECT 1`, `SELECT *`, and `SELECT o.OrderID` are functionally and performance-identical — `SELECT 1` is simply the convention that signals "I only care whether a row exists."

**4. Sample Data**

**Customers**

| CustomerID | CustomerName |
|---|---|
| 1 | Acme Corp |
| 2 | Globex |

**Orders**

| OrderID | CustomerID |
|---|---|
| 100 | 1 |

**5. Expected Output**

| CustomerID | CustomerName |
|---|---|
| 2 | Globex |

**6. Alternative Solutions**
- **`NOT EXISTS` (shown above):** the preferred, safest, most efficient form.
- **`LEFT JOIN ... WHERE o.CustomerID IS NULL`:**
  ```sql
  SELECT c.CustomerID, c.CustomerName
  FROM dbo.Customers c
  LEFT JOIN dbo.Orders o ON o.CustomerID = c.CustomerID
  WHERE o.CustomerID IS NULL;
  ```
  Equally correct and, on modern SQL Server versions, typically produces an identical or near-identical execution plan to `NOT EXISTS` (both are commonly implemented as a "left anti semi join" physical operator) — a matter of style, not correctness, once you filter on the joined table's key column specifically.
- **`NOT IN` — dangerous, do not use without an explicit NULL guard:**
  ```sql
  SELECT c.CustomerID, c.CustomerName
  FROM dbo.Customers c
  WHERE c.CustomerID NOT IN (SELECT o.CustomerID FROM dbo.Orders o);
  ```
  If even a single row in `Orders.CustomerID` is `NULL` (possible if the column is nullable, or after a bad `UNION` with an unrelated NULL-producing query), `NOT IN` returns **zero rows for the entire outer query** — because `x NOT IN (a, b, NULL)` evaluates to `UNKNOWN` for every `x`, not `FALSE`, per three-valued logic. This is one of the most cited real-world SQL correctness bugs at the senior level.
- **Preferred:** `NOT EXISTS` — semantically explicit, immune to the NULL trap by construction (it can never be fooled by a NULL because it doesn't build an `IN` list), and it's what senior SQL developers are expected to reach for by default.

**7. Performance**
`NOT EXISTS`/`LEFT JOIN ... IS NULL` both compile to a **left anti semi join** physical operator, one of the operators mentioned in [SQL Server's join documentation](https://learn.microsoft.com/en-us/sql/relational-databases/performance/joins) — it stops probing as soon as it finds one matching row (for `NOT EXISTS`) and is generally efficient with an index on `Orders.CustomerID`. `NOT IN` against a subquery, when the subquery column is provably `NOT NULL`, can produce an equivalent plan — but the optimizer must first prove non-nullability, which for a nullable column it cannot do, forcing a more defensive (and sometimes slower) execution strategy.

**8. Edge Cases**
- **NULLs in `Orders.CustomerID`:** breaks `NOT IN` entirely (see above); `NOT EXISTS` is unaffected because the correlated predicate `o.CustomerID = c.CustomerID` simply never matches a NULL row (NULL = anything is UNKNOWN, so that row contributes nothing to the EXISTS check either way — which is the correct, safe behavior).
- **Customers with only cancelled/refunded orders:** if "never placed an order" should really mean "never placed a *valid* order," add `AND o.Status <> 'Cancelled'` inside the `NOT EXISTS` subquery — a business-rule clarification worth raising proactively.
- **Empty `Orders` table:** every customer is correctly returned.

**9. Production Scenario**
Marketing re-engagement campaigns ("customers who signed up but never ordered — send them a first-purchase discount code") and churn-adjacent reporting for e-commerce and subscription businesses.

**10. Interview Follow-ups**
1. Walk through exactly why `NOT IN` breaks with a NULL in the subquery's result set.
2. When would `NOT IN` actually be safe to use?
3. How would you find customers who placed orders in *no* specific category (a compound anti-join)?
4. How does the query plan differ between `NOT EXISTS` and `LEFT JOIN ... IS NULL` in practice — should you expect a difference?

**11. Follow-up Answers**
1. `x NOT IN (v1, v2, ..., NULL)` is evaluated by SQL as `x <> v1 AND x <> v2 AND ... AND x <> NULL`. The final comparison, `x <> NULL`, evaluates to `UNKNOWN` for *every* value of `x` (not `TRUE` or `FALSE`). Because the whole `AND` chain includes an `UNKNOWN`, the entire expression can never evaluate to `TRUE` for any row — so `WHERE` filters out every row, and you silently get zero results with no error.
2. `NOT IN` is safe only when the subquery's column is guaranteed `NOT NULL` — either by a `NOT NULL` constraint on that column, or by an explicit `WHERE column IS NOT NULL` added to the subquery itself as a defensive habit.
3. Nest the anti-join one level deeper: `WHERE NOT EXISTS (SELECT 1 FROM Orders o JOIN OrderItems oi ON oi.OrderID = o.OrderID JOIN Products p ON p.ProductID = oi.ProductID WHERE o.CustomerID = c.CustomerID AND p.CategoryID = @CategoryID)`.
4. On modern SQL Server (2016+), both forms typically produce the same anti-semi-join plan shape because the optimizer recognizes the equivalent patterns — but "typically" is not "always," so the correct interview answer is "check `SET STATISTICS XML ON` or the actual plan for your specific query and data distribution rather than assuming" — never claim a specific plan shape without having looked.

**12. Common Mistakes**
- Reaching for `NOT IN` reflexively because it "reads" the most naturally in English ("customer ID not in the list of order customer IDs") — exactly the readability trap that causes this bug in real codebases.
- Not proactively mentioning the NULL landmine unprompted — at this seniority level, interviewers expect you to flag it even if not asked, precisely because it's caused real outages.
- Forgetting that `EXISTS`/`NOT EXISTS` subqueries are correlated and must reference the outer table's key inside the subquery's `WHERE` — writing an uncorrelated `NOT EXISTS (SELECT 1 FROM Orders)` (missing the join predicate) is a logic bug that either returns everything or nothing, not per-customer results.

**13. Architect Insight**
This is one of the highest-signal questions in the entire workbook because the "correct-looking" wrong answer (`NOT IN`) is so common in real codebases that it has caused genuine production incidents (a marketing campaign that mailed literally zero customers because one legacy order row had a NULL `CustomerID` from a data migration). An architect doesn't just know the right syntax — they've internalized *why* the wrong one fails well enough to catch it in a code review without running the query first.

---

### Q76. Find customers who placed multiple orders

**Difficulty:** 🟢 Basic

**1. Interview Answer**
`GROUP BY CustomerID` with `HAVING COUNT(*) > 1` — the canonical "more than one" pattern. The only real subtlety is remembering that `HAVING` filters *after* aggregation, where `WHERE` cannot (yet) reference the aggregate.

**2. SQL Query**
```sql
SELECT c.CustomerID, c.CustomerName, COUNT(o.OrderID) AS OrderCount
FROM dbo.Customers c
JOIN dbo.Orders o ON o.CustomerID = c.CustomerID
GROUP BY c.CustomerID, c.CustomerName
HAVING COUNT(o.OrderID) > 1;
```

**3. Explain the Query**
1. The join expands each customer into one row per order.
2. `GROUP BY` collapses back to one row per customer, computing `COUNT(o.OrderID)` (counting the order rows, not `COUNT(*)`, which would also work here since the join guarantees no NULL `OrderID` rows, but `COUNT(column)` is the more explicit habit when NULLs are ever possible).
3. `HAVING COUNT(o.OrderID) > 1` keeps only customers with more than one order — `HAVING` is required here (not `WHERE`) because the filter depends on the aggregated count, which doesn't exist until after grouping.

**4. Sample Data**

| CustomerID | OrderID |
|---|---|
| 1 | 100 |
| 1 | 101 |
| 2 | 102 |

**5. Expected Output**

| CustomerID | CustomerName | OrderCount |
|---|---|---|
| 1 | Acme Corp | 2 |

**6. Alternative Solutions**
- **`GROUP BY`/`HAVING` (shown above):** the standard, clearest approach.
- **Window-function form:** `SELECT DISTINCT CustomerID FROM (SELECT CustomerID, COUNT(*) OVER (PARTITION BY CustomerID) AS OrderCount FROM Orders) x WHERE OrderCount > 1` — works, but is strictly more verbose than `GROUP BY`/`HAVING` for a plain count-based filter with no other per-row data needed; window functions earn their keep when you need both aggregate *and* row-level detail in the same result set, which isn't the case here.
- **Preferred:** `GROUP BY`/`HAVING` — this is the textbook case that pattern was designed for.

**7. Performance**
An index on `Orders.CustomerID` supports a stream aggregate (if the index provides pre-sorted order) or a hash aggregate otherwise; either is efficient. `HAVING` filters groups *after* the aggregate is computed, so it doesn't reduce the amount of data scanned — the entire `Orders` table (or the relevant index) must still be read once to compute the counts, then the cheap `HAVING` filter discards single-order customers.

**8. Edge Cases**
- Customers with zero orders don't appear at all with an `INNER JOIN` (correctly excluded — they have neither "one" nor "multiple" orders in a way this question cares about).
- "Multiple orders" is unambiguous here (unlike Q71's total-vs-average trap), but confirm whether cancelled/returned orders should count toward the total — a business-rule check worth a quick clarifying question.

**9. Production Scenario**
Loyalty-program segmentation ("repeat customers" as a marketing cohort) and fraud-review heuristics (an unusually high order count in a short window is itself a signal, tying toward Q84's duplicate-transaction detection).

**10. Interview Follow-ups**
1. Why can't you write `WHERE COUNT(*) > 1` instead of using `HAVING`?
2. How would you find customers with multiple orders placed on the *same day* specifically?
3. How do you get the actual list of that customer's order IDs alongside the count, in one query?
4. How would you find customers whose order count is above the *average* order count across all customers?

**11. Follow-up Answers**
1. `WHERE` is evaluated before grouping/aggregation occurs (logically, before `GROUP BY`), so the aggregate value doesn't exist yet at the point `WHERE` runs — `HAVING` exists specifically to filter after aggregation, when `COUNT(*)` is a real, computed value per group.
2. Add `OrderDate` to the grouping: `GROUP BY CustomerID, OrderDate HAVING COUNT(*) > 1` — now each group is a customer-and-day combination.
3. Use `STRING_AGG(CAST(o.OrderID AS VARCHAR(20)), ', ')` (SQL Server 2017+) inside the same `GROUP BY` to concatenate the order IDs into one delimited string per customer, alongside `COUNT(*)`.
4. This needs a second aggregation layer: compute per-customer counts in a CTE, compute the overall average in a scalar subquery or a second CTE, then join/filter — `WITH CustomerCounts AS (SELECT CustomerID, COUNT(*) AS Cnt FROM Orders GROUP BY CustomerID) SELECT * FROM CustomerCounts WHERE Cnt > (SELECT AVG(Cnt) FROM CustomerCounts)`.

**12. Common Mistakes**
- Writing `WHERE COUNT(*) > 1` and getting a syntax/binding error, then not understanding why `HAVING` is required.
- Using `COUNT(*)` vs `COUNT(o.OrderID)` interchangeably without realizing they diverge the moment `OrderID` can be NULL after an outer join (`COUNT(*)` counts rows including NULL-extended outer-join rows; `COUNT(column)` does not).
- Forgetting `c.CustomerName` (or any non-aggregated, non-grouped column) in the `GROUP BY` list, causing a compile error — every selected column must be either aggregated or included in `GROUP BY`.

**13. Architect Insight**
This is a calibration question, similar to Q70 — it should be fast and clean. What differentiates candidates is how quickly and precisely they handle the natural follow-up chain (same-day orders, concatenated order lists, above-average counts), because it reveals whether `GROUP BY`/`HAVING` is a memorized incantation or a genuinely internalized tool they can recombine on the fly.

---

### Q77. Find products that were never sold

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Structurally identical to Q75 — an anti-join — but the "no match" relationship is now two hops away (`Products` → `OrderItems`, not a direct FK), so the `NOT EXISTS` subquery must join through `OrderItems` rather than checking a single table.

**2. SQL Query**
```sql
SELECT p.ProductID, p.ProductName
FROM dbo.Products p
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.OrderItems oi WHERE oi.ProductID = p.ProductID
);
```

**3. Explain the Query**
Same anti-semi-join logic as Q75: for each product, check whether *any* `OrderItems` row references it; if none does, the product has never been sold. Because `Products` has no direct foreign key relationship to `Orders`/`Customers`, this only requires checking the immediate child table (`OrderItems`), not a multi-hop join — the "never sold" relationship lives entirely in whether `OrderItems.ProductID` was ever populated with this product.

**4. Sample Data**

**Products**

| ProductID | ProductName |
|---|---|
| 1 | Widget |
| 2 | Gadget |

**OrderItems**

| ProductID |
|---|
| 1 |

**5. Expected Output**

| ProductID | ProductName |
|---|---|
| 2 | Gadget |

**6. Alternative Solutions**
- **`NOT EXISTS` (shown above):** preferred, for the same reasons as Q75.
- **`LEFT JOIN OrderItems ... WHERE OrderItemID IS NULL`:** equally valid, same anti-semi-join plan shape typically.
- **`NOT IN (SELECT ProductID FROM OrderItems)`:** subject to the exact same NULL landmine as Q75 if `OrderItems.ProductID` could ever be NULL (it shouldn't be, given the `NOT NULL` FK constraint in the canonical schema — but defensive habit says prefer `NOT EXISTS` regardless, since schemas drift and constraints get relaxed during migrations).
- **Preferred:** `NOT EXISTS`, consistent with Q75's reasoning.

**7. Performance**
An index on `OrderItems.ProductID` is essential — without it, the anti-join must scan all of `OrderItems` for every product (or, more likely, the optimizer builds a hash table of all distinct `ProductID`s from `OrderItems` once and probes it per product, which is efficient, but only if statistics are current enough for the optimizer to choose that plan).

**8. Edge Cases**
- A product that exists in `OrderItems` for a *cancelled* order — is that "sold"? If cancelled orders shouldn't count, the subquery needs `JOIN Orders o ON o.OrderID = oi.OrderID AND o.Status <> 'Cancelled'` added — the same kind of business-rule clarification as Q75/Q76.
- Newly launched products with zero sales yet are indistinguishable from genuinely poor-selling discontinued products in this query alone — pairing this with `Products.LaunchDate` or a "days since launch" filter is a natural follow-on for a real inventory report.

**9. Production Scenario**
Inventory and merchandising reviews — identifying dead stock (products taking up warehouse space or catalog listings with zero sales) for markdown, discontinuation, or catalog-cleanup decisions.

**10. Interview Follow-ups**
1. How would you extend this to "products never sold *in the last 12 months*" (as opposed to ever)?
2. How does this change if a product can be sold without going through `OrderItems` (e.g., a separate returns/exchange table also moves inventory)?
3. What's the performance impact of the extra join hop compared to Q75's single-table check?
4. How would you rank never-sold products by how long they've been in the catalog?

**11. Follow-up Answers**
1. Change the anti-join to only exclude products with *recent* sales: `WHERE NOT EXISTS (SELECT 1 FROM OrderItems oi JOIN Orders o ON o.OrderID = oi.OrderID WHERE oi.ProductID = p.ProductID AND o.OrderDate >= DATEADD(MONTH, -12, GETDATE()))` — note this now returns products with *no recent* sales, which includes both never-sold products and products that sold well historically but have gone quiet, a meaningfully different (and often more actionable) business question.
2. The anti-join must check every table that can indicate "this product moved" — often modeled as `NOT EXISTS (... OrderItems ...) AND NOT EXISTS (... ReturnItems ...)`, or better, a unified "inventory movement" view/table that both a returns process and a sales process write to, so the anti-join has one place to check instead of N.
3. Negligible in practice with proper indexing — the anti-semi-join operator still only needs to probe `OrderItems.ProductID` once per product; the "extra hop" compared to Q75 is conceptual (product → order item, rather than customer → order directly), not an added join in the actual anti-join subquery itself.
4. Add `DATEDIFF(day, p.LaunchDate, GETDATE()) AS DaysSinceLaunch` to the `SELECT` list and `ORDER BY DaysSinceLaunch DESC` — surfaces the longest-standing dead stock first.

**12. Common Mistakes**
- Joining `Products` to `Orders` directly (there's no such FK) instead of going through `OrderItems`, which simply won't compile or will silently produce a cartesian/incorrect result if joined on the wrong columns.
- Not considering whether cancelled/returned line items should count as "sold," and defaulting to whatever's easiest to write rather than what the business means.
- Forgetting an index on `OrderItems.ProductID`, turning a routine catalog report into a full scan of a potentially very large fact table.

**13. Architect Insight**
Structurally this is "Q75 again," and a Staff/Principal candidate should say so immediately — but the interesting architect-level layer is the follow-up about *where else* "sold" might be recorded (returns, exchanges, marketplace fulfillment separate from the core `Orders` table). Real retail/e-commerce systems often have sales data fragmented across multiple systems, and knowing to ask "is `OrderItems` really the single source of truth for 'sold,' or do I need to check elsewhere too" is exactly the kind of systems-thinking this question is meant to probe once the base SQL is out of the way.

---

### Q78. Find employees who joined in a particular month/year

**Difficulty:** 🟢 Basic

**1. Interview Answer**
Filter on `HireDate` using a **range predicate**, not a function wrapped around the column. `WHERE YEAR(HireDate) = 2024 AND MONTH(HireDate) = 3` is the intuitive-looking answer and also the wrong one for production, because wrapping an indexed column in a function makes the predicate non-SARGable — SQL Server can no longer seek an index on `HireDate` and must scan every row to evaluate the function.

**2. SQL Query**
```sql
DECLARE @Year INT = 2024, @Month INT = 3;

SELECT EmployeeID, FirstName, LastName, HireDate
FROM dbo.Employees
WHERE HireDate >= DATEFROMPARTS(@Year, @Month, 1)
  AND HireDate <  DATEFROMPARTS(@Year, @Month, 1) + 1  -- add 1 month via DATEADD, see note below
;

-- More robust month-boundary version:
DECLARE @RangeStart DATE = DATEFROMPARTS(@Year, @Month, 1);
DECLARE @RangeEnd   DATE = DATEADD(MONTH, 1, @RangeStart);

SELECT EmployeeID, FirstName, LastName, HireDate
FROM dbo.Employees
WHERE HireDate >= @RangeStart
  AND HireDate <  @RangeEnd;
```

**3. Explain the Query**
1. `DATEFROMPARTS(@Year, @Month, 1)` builds the first day of the target month.
2. `DATEADD(MONTH, 1, @RangeStart)` gives the first day of the *next* month — an exclusive upper bound, which correctly handles every day-count variation (28/29/30/31) without hardcoding a day count.
3. `HireDate >= @RangeStart AND HireDate < @RangeEnd` is a **sargable range scan**: because `HireDate` itself is compared directly (not wrapped in a function), an index on `HireDate` can be seeked directly to the start of the range and scanned forward only through matching rows.

**4. Sample Data**

| EmployeeID | HireDate |
|---|---|
| 1 | 2024-03-15 |
| 2 | 2024-04-01 |

**5. Expected Output** (for `@Year=2024, @Month=3`)

| EmployeeID | HireDate |
|---|---|
| 1 | 2024-03-15 |

**6. Alternative Solutions**
- **`HireDate >= start AND HireDate < end` (shown above):** the sargable, production-correct form — preferred.
- **`YEAR(HireDate) = @Year AND MONTH(HireDate) = @Month`:** intuitive to read, but non-sargable — see Performance below. Acceptable for a one-off ad hoc query against a small table, wrong as a pattern to build into an application's hot path.
- **`FORMAT(HireDate, 'yyyy-MM') = '2024-03'`:** even worse — `FORMAT` is notoriously slow (it goes through the CLR formatting engine) on top of being non-sargable; never use `FORMAT` in a `WHERE` clause for this reason.
- **Preferred:** the range-predicate form, always, for anything beyond a throwaway ad hoc script.

**7. Performance**
This is the canonical SARGability teaching example (see the deeper treatment in `01-Indexing-Query-Execution-Plans.md`'s Query Performance section). `WHERE YEAR(HireDate) = 2024` forces SQL Server to evaluate `YEAR(HireDate)` for *every row* in the table before it can test the predicate — an index on `HireDate` becomes useless because the index is ordered by the raw date value, not by the year extracted from it, so the engine falls back to a full scan. The range form `HireDate >= @start AND HireDate < @end` lets the optimizer seek directly into an index on `HireDate` and read only the qualifying rows — the difference between `O(log n + k)` (seek + k matching rows) and `O(n)` (scan every row) at scale.

**8. Edge Cases**
- Time components: if `HireDate` were a `DATETIME`/`DATETIME2` instead of `DATE`, a naive upper bound like `HireDate <= '2024-03-31'` would incorrectly exclude rows with a timestamp later than midnight on the 31st (e.g., `2024-03-31 14:00:00`) — the exclusive `< @RangeEnd` (first moment of the *next* month) pattern shown above is correct regardless of whether the column carries a time component, which is exactly why it's the recommended idiom over inclusive end-of-month literals.
- Leap years and variable month lengths: handled automatically by `DATEADD(MONTH, 1, ...)` — never hardcode "28/30/31 days."
- NULL `HireDate`: excluded automatically by the range predicate (NULL fails both comparisons) — correct if every employee must have a hire date, worth flagging if the column is unexpectedly nullable.

**9. Production Scenario**
HR cohort reporting ("show me everyone hired in Q1 2024 for new-hire orientation scheduling") and anniversary/benefits-eligibility batch jobs that run monthly against a hire-date range.

**10. Interview Follow-ups**
1. Why exactly does wrapping a column in a function break index usage?
2. How would you find employees hired in a given *quarter* instead of a month?
3. What's the difference between a sargable predicate and a "non-sargable but still correct" one, in terms of actual index usage you'd see in an execution plan?
4. How would you write this to be safe against `DATETIME2` columns with sub-second precision?

**11. Follow-up Answers**
1. A B-tree index is sorted by the *stored* column value. Once you apply a function (`YEAR(HireDate)`), the engine would need a matching index on the *function's result*, not the raw column — SQL Server does support indexed computed columns for exactly this reason, but without one explicitly created, the optimizer has no ordered structure to seek into for `YEAR(HireDate) = 2024`, so it reads every row to compute the function and test it — a scan, not a seek.
2. Compute quarter boundaries with `DATEFROMPARTS(@Year, (@Quarter - 1) * 3 + 1, 1)` as the start and `DATEADD(MONTH, 3, @RangeStart)` as the exclusive end — same range-predicate principle, just a 3-month window instead of 1.
3. In the execution plan, a sargable predicate on an indexed column shows as an **Index Seek** with a `Seek Predicate` matching your range; a non-sargable predicate on the same column shows as an **Index Scan** (or Table/Clustered Index Scan) with the function-wrapped condition listed only as a **Predicate** (a post-scan filter), not a seek predicate — confirmed via `SET STATISTICS XML ON` or the graphical plan, never assumed.
4. The exclusive-upper-bound pattern (`>= start AND < end`) is already safe for any precision, because it never relies on an inclusive end-of-period literal that could be defeated by extra precision — this is precisely why it's preferred over `<= '2024-03-31 23:59:59'`-style literals, which silently truncate/miss rows once you add more fractional-second digits than you guessed.

**12. Common Mistakes**
- Wrapping the column in `YEAR()`/`MONTH()`/`FORMAT()` for a query that will run frequently or against a large table, defeating index usage without realizing it.
- Using an inclusive upper bound literal (`<= '2024-03-31'`) against a `DATETIME`/`DATETIME2` column, silently dropping same-day rows with a nonzero time component.
- Hardcoding "add 30 days" instead of using `DATEADD(MONTH, 1, ...)`, breaking on months with 28, 29, or 31 days.

**13. Architect Insight**
This question is deliberately simple to state and deceptively easy to answer wrong. It's one of the fastest ways an interviewer distinguishes "knows SQL syntax" from "has actually been paged at 2 a.m. because a reporting query someone wrote three years ago just started timing out as the table grew" — SARGability is exactly the kind of lesson that's cheap to explain and expensive to learn without having lived through the production consequence once.

---

### Q79. Find consecutive dates (identify runs)

**Difficulty:** 🔴 Senior

**1. Interview Answer**
This is the entry point to the **gaps-and-islands** technique, the single most important pattern in this file. The trick: subtract a sequential `ROW_NUMBER()` from each date. Within a run of consecutive dates, the date advances by exactly 1 each row while the row number also advances by exactly 1 — so `date - row_number` stays *constant* for the whole run, and changes only when the sequence breaks. That constant becomes a free "group ID" for each island of consecutive dates.

**2. SQL Query**
```sql
WITH Numbered AS (
    SELECT
        LoginDate,
        ROW_NUMBER() OVER (ORDER BY LoginDate) AS rn
    FROM (SELECT DISTINCT LoginDate FROM dbo.UserLogins) AS DistinctDates
),
Islands AS (
    SELECT
        LoginDate,
        DATEADD(DAY, -rn, LoginDate) AS IslandGroup   -- constant within a consecutive run
    FROM Numbered
)
SELECT
    MIN(LoginDate) AS RunStart,
    MAX(LoginDate) AS RunEnd,
    DATEDIFF(DAY, MIN(LoginDate), MAX(LoginDate)) + 1 AS RunLengthDays
FROM Islands
GROUP BY IslandGroup
ORDER BY RunStart;
```

**3. Explain the Query**
1. `Numbered` assigns a strictly sequential row number to each distinct date, ordered chronologically.
2. `DATEADD(DAY, -rn, LoginDate)` computes `LoginDate` minus `rn` days. For a run of genuinely consecutive dates (each one day after the last), this subtraction lands on the *same* calendar date for every row in that run — because both `LoginDate` and `rn` increase by exactly 1 per row, their difference is invariant.
3. As soon as there's a gap (a missing day), `rn` keeps incrementing by 1 but `LoginDate` jumps by more than 1 — so `IslandGroup` shifts to a new value, starting a new group.
4. `GROUP BY IslandGroup` then collapses each run into one summary row: its start, end, and length.

**4. Sample Data**

| LoginDate |
|---|
| 2024-01-01 |
| 2024-01-02 |
| 2024-01-03 |
| 2024-01-05 |
| 2024-01-06 |

**5. Expected Output**

| RunStart | RunEnd | RunLengthDays |
|---|---|---|
| 2024-01-01 | 2024-01-03 | 3 |
| 2024-01-05 | 2024-01-06 | 2 |

**6. Alternative Solutions**
- **`ROW_NUMBER()` difference trick (shown above):** the standard, most widely recognized approach — preferred, because interviewers specifically look for this idiom by name.
- **`LAG()`-based gap flagging:**
  ```sql
  WITH Flagged AS (
      SELECT LoginDate,
             CASE WHEN DATEDIFF(DAY, LAG(LoginDate) OVER (ORDER BY LoginDate), LoginDate) = 1
                  THEN 0 ELSE 1 END AS IsNewRun
      FROM (SELECT DISTINCT LoginDate FROM dbo.UserLogins) d
  ),
  Grouped AS (
      SELECT LoginDate, SUM(IsNewRun) OVER (ORDER BY LoginDate ROWS UNBOUNDED PRECEDING) AS IslandGroup
      FROM Flagged
  )
  SELECT MIN(LoginDate) AS RunStart, MAX(LoginDate) AS RunEnd
  FROM Grouped
  GROUP BY IslandGroup;
  ```
  Equally correct, and arguably more intuitive to explain out loud ("flag every day that doesn't follow the previous day, then running-sum the flags to get a group ID") — a good alternative to offer if asked "is there another way."
- **Preferred:** the `ROW_NUMBER()` difference trick, because it's the more universally recognized idiom and generalizes trivially to numeric sequences (Q81) and multi-user partitions (Q82/Q83) by simply adding `PARTITION BY`.

**7. Performance**
Both approaches are single-pass window-function computations, `O(n log n)` if a sort is required (or `O(n)` if an index on the ordering column already provides sorted order) — dramatically better than a cursor-based "walk the dates and compare to the previous row" procedural approach, which is the naive (and commonly wrong) instinct candidates have before learning this pattern. Always mention that this used to require a cursor/loop before window functions matured, and that the windowed form is now the expected production answer.

**8. Edge Cases**
- Duplicate dates (the same user logging in twice on one day) — the `SELECT DISTINCT` in the base query is essential; without it, duplicate rows for the same date would double-count and desynchronize the `ROW_NUMBER()`-to-date relationship.
- A single isolated date with no neighbor on either side is still correctly reported as its own one-day "run."
- Non-contiguous data types: this exact `DATEADD(DAY, -rn, ...)` trick relies on the sequence advancing by exactly 1 *day* per row — for numeric sequences (Q81) the equivalent is `value - rn` directly (no `DATEADD` needed, since both are already integers).

**9. Production Scenario**
Attendance/activity-streak features (this exact pattern underlies Q82/Q83's login-streak questions), SLA-breach reporting ("show me every consecutive run of days a service was in a degraded state"), and market-data gap detection (identifying runs of trading days with continuous price data vs. missing days).

**10. Interview Follow-ups**
1. Why does `date - row_number` stay constant within a run — walk through the arithmetic explicitly.
2. How would you adapt this for numeric ID sequences instead of dates?
3. How does this handle weekends/holidays if "consecutive" should mean "consecutive business days"?
4. How would you find only runs longer than N days?

**11. Follow-up Answers**
1. If day 1 of a run has `rn = k` and date `d`, then day 2 (one calendar day later) has `rn = k+1` and date `d+1`. `(d+1) - (k+1) = d - k` — the `+1`s cancel exactly, so the difference is invariant as long as the date advances by precisely 1 per row, which is true throughout an unbroken run and false at any gap.
2. Drop the `DATEADD`/date arithmetic entirely: `value - ROW_NUMBER() OVER (ORDER BY value)` computed directly as integers — this is exactly Q81's numeric-sequence-gap problem, same mechanism, no date-specific wrapping needed.
3. Redefine "the next expected value" as the next business day rather than `+1` calendar day — this typically requires either a calendar/business-day reference table (the standard, robust production approach) or a more complex expression that skips weekends, since holidays can't be derived algorithmically at all and *must* come from a reference table.
4. Add `HAVING DATEDIFF(DAY, MIN(LoginDate), MAX(LoginDate)) + 1 > @N` after the final `GROUP BY` — filters the summarized runs, not the raw rows.

**12. Common Mistakes**
- Forgetting `DISTINCT` on the base date list, corrupting the row-number-to-date correspondence when duplicate dates exist.
- Trying to solve this with a correlated subquery or cursor instead of the windowed difference trick — technically possible but far more verbose and, at scale, far slower.
- Using `RANK()`/`DENSE_RANK()` instead of `ROW_NUMBER()` for the numbering step — ties (impossible here after `DISTINCT`, but a real risk in the numeric-ID version of this problem if IDs can repeat) would break the constant-difference invariant.

**13. Architect Insight**
Recognizing and correctly explaining the gaps-and-islands arithmetic *unprompted*, and then immediately noting that this same trick answers Q80–Q83 with minor variations, is one of the strongest single signals in this entire workbook for genuine SQL depth versus memorized syntax. Principal-level interviewers often use this question specifically because there's no way to bluff through the "why does the subtraction work" follow-up without actually understanding it.

---

### Q80. Find missing dates in a date range/sequence

**Difficulty:** 🔴 Senior

**1. Interview Answer**
The mirror image of Q79: instead of finding runs of *present* dates, generate every date that *should* exist in a range (a "date spine"), then anti-join against the actual data to find which ones are absent.

**2. SQL Query**
```sql
DECLARE @StartDate DATE = '2024-01-01';
DECLARE @EndDate   DATE = '2024-01-10';

WITH DateSpine AS (
    SELECT @StartDate AS CalendarDate
    UNION ALL
    SELECT DATEADD(DAY, 1, CalendarDate)
    FROM DateSpine
    WHERE CalendarDate < @EndDate
)
SELECT ds.CalendarDate AS MissingDate
FROM DateSpine ds
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.UserLogins ul
    WHERE ul.LoginDate = ds.CalendarDate
)
OPTION (MAXRECURSION 366);  -- bound the recursion explicitly; see Performance
```

**3. Explain the Query**
1. `DateSpine` is a recursive CTE: the anchor member seeds `@StartDate`; the recursive member repeatedly adds one day until it reaches `@EndDate`, generating every calendar date in the range (see the recursive-CTE mechanics detailed in `05-Subqueries-CTEs.md`).
2. The outer query anti-joins this generated spine against the real `UserLogins` table using `NOT EXISTS` — any spine date with no matching login row is, by definition, missing.
3. `OPTION (MAXRECURSION 366)` raises SQL Server's default 100-level recursion cap — without it, a date range longer than 100 days would fail outright with a recursion-limit error.

**4. Sample Data**
`UserLogins.LoginDate` contains 2024-01-01, 02, 03, 05, 06 (matching Q79's example — the same gap).

**5. Expected Output**

| MissingDate |
|---|
| 2024-01-04 |
| 2024-01-07 |
| 2024-01-08 |
| 2024-01-09 |
| 2024-01-10 |

**6. Alternative Solutions**
- **Recursive CTE date spine (shown above):** clear and dependency-free (no auxiliary table needed), but recursion is capped and, for very long ranges, is not the most efficient generation method.
- **Numbers/Tally table (preferred at scale):**
  ```sql
  WITH Tally AS (
      SELECT TOP (DATEDIFF(DAY, @StartDate, @EndDate) + 1)
             ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS n
      FROM sys.all_objects  -- any large enough system view works as a row source
  ),
  DateSpine AS (
      SELECT DATEADD(DAY, n, @StartDate) AS CalendarDate FROM Tally
  )
  SELECT ds.CalendarDate AS MissingDate
  FROM DateSpine ds
  WHERE NOT EXISTS (SELECT 1 FROM dbo.UserLogins ul WHERE ul.LoginDate = ds.CalendarDate);
  ```
  Set-based rather than recursive, and generally faster for large ranges since it avoids the iterative recursive-CTE execution model entirely — this is the standard production approach, often backed by a persisted numbers table (`dbo.Tally` or `dbo.Numbers`, populated once) rather than repurposing a system catalog view.
- **A dedicated, persisted `dbo.Calendar` table:** the most robust real-world answer — pre-populated with every date for the next N years (plus business-day flags, fiscal-period columns, holiday flags), avoiding on-the-fly generation entirely. Nearly every mature data warehouse has one; worth naming explicitly as the production-grade answer beyond either on-the-fly technique.
- **Preferred:** a persisted calendar/tally table in real production systems; the recursive CTE is the right answer to *demonstrate the technique* in an interview when no such table is assumed to exist.

**7. Performance**
Recursive CTEs execute iteratively — one recursive step per row generated — which does not parallelize and has a real per-iteration overhead; they're fine for date ranges of days-to-a-few-years but a poor choice for generating millions of rows. A tally-table/set-based spine generates all rows in one set-based operation and is dramatically faster for large ranges. A persisted calendar table is fastest of all (a plain index scan/seek against a small, already-materialized table) and is the only approach that scales to "give me every missing date across a 10-year, multi-million-row history table" without any generation cost at all.

**8. Edge Cases**
- Time zone / `DATETIME` vs `DATE` mismatches: if `LoginDate` were a `DATETIME` with a nonzero time component, direct equality (`ul.LoginDate = ds.CalendarDate`) would fail to match even a genuinely-present date — cast or truncate to `DATE` on both sides, or store activity dates as `DATE` in the first place to avoid the ambiguity entirely.
- `MAXRECURSION` cap: silently forgetting it causes a hard failure past 100 levels — always set it explicitly (or `0` for unlimited, with caution) when using a recursive-CTE spine for anything beyond a small demo range.
- Weekends/holidays: if "missing" should only apply to expected business days, filter the spine (or the final anti-join result) against a business-day calendar rather than treating every calendar day as expected.

**9. Production Scenario**
Market-data completeness checks (missing trading-day price bars), SLA/uptime reporting (days with no heartbeat/health-check record are effectively "missing" observations), and billing-cycle audits (identifying days a metered service failed to record usage).

**10. Interview Follow-ups**
1. Why does a recursive CTE have a default recursion limit, and what's the risk of raising it carelessly?
2. When would you choose a persisted calendar table over generating dates on the fly, concretely?
3. How would you adapt this to find missing *business days* only?
4. How does the anti-join here relate to Q75/Q77's anti-join pattern?

**11. Follow-up Answers**
1. The 100-level default guards against runaway/infinite recursion from a coding mistake (e.g., a recursive member that never terminates) silently consuming server resources; raising it is safe once you've confirmed the termination condition (`WHERE CalendarDate < @EndDate`) is correct and the range is bounded and reasonable — `OPTION (MAXRECURSION 0)` (unlimited) should be reserved for cases where the range is provably bounded elsewhere.
2. Any system that repeatedly needs date-spine/gap analysis (daily reporting jobs, dashboards computed on every page load) should use a persisted calendar table — the generation cost is paid once at table-creation/maintenance time rather than on every query execution; reserve on-the-fly generation for ad hoc, one-off analysis.
3. Add an `IsBusinessDay` bit column to the calendar table (or compute `DATEPART(WEEKDAY, ...)` plus a holiday-exclusion join) and filter the spine to `WHERE IsBusinessDay = 1` before the anti-join — holidays specifically cannot be derived algorithmically and must come from a reference table.
4. It's the same anti-join shape as Q75/Q77 (`NOT EXISTS` between a "should exist" set and an "actually exists" set) — the only difference is that here the "should exist" set is *generated* (a date spine) rather than *queried from an existing table* (`Customers`, `Products`). Recognizing this as the same fundamental pattern, just with a synthesized left-hand side, is the connecting insight across this whole file.

**12. Common Mistakes**
- Omitting `OPTION (MAXRECURSION ...)` and having the query fail outright on any range longer than 100 days.
- Comparing a `DATE` spine against a `DATETIME` column without normalizing, silently reporting every date as "missing" because none of the equality comparisons ever match.
- Reaching for a recursive CTE in a hot production reporting path instead of a persisted calendar table, needlessly paying iterative generation cost on every run.

**13. Architect Insight**
The SQL mechanics are Senior-level; the Principal-level answer is recommending a persisted calendar/date-dimension table as standard infrastructure the moment this class of question comes up more than once — this is a genuinely common real recommendation in data-warehouse and reporting-system design, and naming it unprompted signals architectural maturity beyond "I can write a recursive CTE."

---

### Q81. Find gaps in a numeric sequence

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Same gaps-and-islands machinery as Q79, applied to integers instead of dates — and, symmetrically, the same anti-join-against-a-generated-spine idea as Q80 also works directly. This question is really "do you recognize this is the same pattern," not a new technique.

**2. SQL Query**
```sql
-- Approach A: island-detection (find the *bounds* of each existing run, gaps are the space between runs)
WITH Numbered AS (
    SELECT OrderID, ROW_NUMBER() OVER (ORDER BY OrderID) AS rn
    FROM dbo.Orders
),
Islands AS (
    SELECT OrderID, OrderID - rn AS IslandGroup
    FROM Numbered
)
SELECT MIN(OrderID) AS RunStart, MAX(OrderID) AS RunEnd
FROM Islands
GROUP BY IslandGroup
ORDER BY RunStart;

-- Approach B: direct gap detection via LEAD (report each gap's boundaries explicitly)
SELECT
    OrderID                                            AS GapStartsAfter,
    LEAD(OrderID) OVER (ORDER BY OrderID)              AS NextExistingID,
    LEAD(OrderID) OVER (ORDER BY OrderID) - OrderID - 1 AS MissingCount
FROM dbo.Orders
WHERE LEAD(OrderID) OVER (ORDER BY OrderID) - OrderID > 1;
```

**3. Explain the Query**
- **Approach A** applies Q79's exact `value - ROW_NUMBER()` trick to `OrderID` directly (no date arithmetic needed, since both are already integers) — the output is every contiguous run of existing IDs; the *gaps* are implicitly everything between one run's `RunEnd` and the next run's `RunStart`.
- **Approach B** is more direct when the actual question is "show me the gaps themselves," not the runs: `LEAD(OrderID)` looks ahead to the next row's ID; if it's more than 1 greater than the current ID, there's a gap, and the arithmetic `LEAD - Current - 1` gives exactly how many IDs are missing in that gap.

**4. Sample Data**

| OrderID |
|---|
| 100 |
| 101 |
| 102 |
| 105 |
| 106 |

**5. Expected Output** (Approach B)

| GapStartsAfter | NextExistingID | MissingCount |
|---|---|---|
| 102 | 105 | 2 |

(IDs 103 and 104 are missing.)

**6. Alternative Solutions**
- **Island detection (Approach A):** best when you need the *runs* themselves (e.g., "show me every contiguous batch of order IDs").
- **`LEAD`-based direct gap detection (Approach B):** best when you need the gaps *themselves*, explicitly, with counts — usually the more directly useful form for "find gaps in a sequence" as literally asked.
- **Preferred:** Approach B for this specific question's phrasing, but both are worth mentioning — showing you can derive either view from the same underlying windowed mechanics is itself the signal.

**7. Performance**
Both are single-pass window-function computations, `O(n)` given an index that provides `OrderID` in sorted order (which a clustered index on an identity/sequential PK typically already does) — no join, no self-join, no cursor. This is dramatically better than the pre-window-function idiom of a correlated subquery per row (`SELECT MIN(OrderID) FROM Orders WHERE OrderID > x AND NOT EXISTS (...)`), which is quadratic in the worst case.

**8. Edge Cases**
- If `OrderID` isn't strictly sequential by design (e.g., IDs are assigned by multiple systems, or some ranges are deliberately reserved), "gaps" here means "gaps in the *observed* data," not necessarily "missing/lost records" — a business clarification worth surfacing, since this exact query is often (mis)used to hunt for "lost" transactions when the real explanation is a reserved ID range or a merge of multiple ID sequences.
- Non-integer or non-contiguous-by-design keys (GUIDs, natural keys) make "gap" analysis meaningless — confirm the column is a surrogate sequential key before applying this pattern at all.

**9. Production Scenario**
Financial and audit contexts specifically: invoice-number or check-number sequence-gap detection is a standard control in accounting systems (a missing invoice number can indicate a voided/lost invoice that must be accounted for, or in the worst case, a sign of fraud/deleted records) — this exact query pattern is a real audit-control implementation, not just an interview exercise. It also reappears in market-data tick-sequence-number gap detection, where a missing sequence number indicates a dropped message that must be replayed from the feed.

**10. Interview Follow-ups**
1. Why might gaps in an identity column be completely normal and not indicate data loss?
2. How would you adapt this to detect gaps *per partition* (e.g., per invoice book, per customer)?
3. How does `IDENTITY` column gap behavior in SQL Server relate to this question (e.g., after a failed insert or a server restart)?
4. How would this scale to a sequence with hundreds of millions of rows?

**11. Follow-up Answers**
1. Rolled-back transactions still consume an `IDENTITY` value (the counter increments before the insert commits, and a rollback doesn't return the value to the pool), and a server restart can also cause identity-value jumps in some configurations — gaps in an `IDENTITY` column are expected and routine, not inherently evidence of data loss; this is precisely why financial systems typically use a separate, gap-monitored business sequence (like invoice number) rather than relying on the surrogate `IDENTITY` PK for audit purposes.
2. Add `PARTITION BY InvoiceBookID` (or the relevant grouping column) to both the `ROW_NUMBER()`/`LEAD()` window specs — gaps are then detected independently within each partition, exactly like Q82/Q83 partition login-streak detection per user.
3. `IDENTITY` gaps specifically come from rolled-back inserts, `TRUNCATE`/reseed operations, or (historically, in some SQL Server versions/configurations) cached identity blocks lost on an unexpected restart — worth knowing as context, but orthogonal to whether the *business* sequence being audited (e.g., invoice number, which might not even be the same column as the surrogate `IDENTITY` PK) should ever have gaps.
4. The windowed approach remains linear and index-supported at any scale; for hundreds of millions of rows, the main consideration becomes whether the query needs to scan the *entire* history each run or can be scoped incrementally (e.g., only check for gaps in IDs greater than the last-checked watermark) to avoid repeatedly re-scanning already-verified history.

**12. Common Mistakes**
- Treating every `IDENTITY` gap as a data-loss incident without understanding that rollbacks and restarts routinely create them.
- Using the island-detection form when the question actually wants the gaps themselves (or vice versa), and not clearly stating which output shape you're producing.
- Forgetting to partition when the sequence is really N independent sequences (e.g., one per invoice book) rather than one global sequence.

**13. Architect Insight**
The technical mechanism is a copy-paste of Q79. The architect-level value-add is knowing the difference between a *surrogate* sequence (an `IDENTITY` PK, where gaps are normal and usually irrelevant) and a *business* sequence (an invoice or check number, where gaps are a genuine control failure that auditors and regulators specifically look for) — conflating the two is a real mistake that shows up in actual SOX/financial-controls conversations, not just interview trivia.

---

### Q82. Find consecutive login days per user

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Exactly Q79's technique with one addition: `PARTITION BY UserID` in the `ROW_NUMBER()` call, so the "constant difference" island trick resets independently for each user instead of running across the whole table as one global sequence.

**2. SQL Query**
```sql
WITH Numbered AS (
    SELECT
        UserID,
        LoginDate,
        ROW_NUMBER() OVER (PARTITION BY UserID ORDER BY LoginDate) AS rn
    FROM (SELECT DISTINCT UserID, LoginDate FROM dbo.UserLogins) AS DistinctLogins
)
SELECT
    UserID,
    MIN(LoginDate) AS StreakStart,
    MAX(LoginDate) AS StreakEnd,
    DATEDIFF(DAY, MIN(LoginDate), MAX(LoginDate)) + 1 AS StreakLengthDays
FROM (
    SELECT UserID, LoginDate, DATEADD(DAY, -rn, LoginDate) AS IslandGroup
    FROM Numbered
) AS Islands
GROUP BY UserID, IslandGroup
ORDER BY UserID, StreakStart;
```

**3. Explain the Query**
Identical arithmetic to Q79 — `LoginDate` minus a sequential row number stays constant within a run — but because `ROW_NUMBER()` is partitioned `PARTITION BY UserID`, the numbering (and therefore the island-grouping arithmetic) restarts independently for every user. `GROUP BY UserID, IslandGroup` then produces one row per user *per streak*, not one row per streak globally.

**4. Sample Data**

| UserID | LoginDate |
|---|---|
| 1 | 2024-01-01 |
| 1 | 2024-01-02 |
| 1 | 2024-01-04 |
| 2 | 2024-01-01 |

**5. Expected Output**

| UserID | StreakStart | StreakEnd | StreakLengthDays |
|---|---|---|---|
| 1 | 2024-01-01 | 2024-01-02 | 2 |
| 1 | 2024-01-04 | 2024-01-04 | 1 |
| 2 | 2024-01-01 | 2024-01-01 | 1 |

**6. Alternative Solutions**
- **Partitioned `ROW_NUMBER()` difference trick (shown above):** preferred — single pass, directly extends Q79/Q81.
- **`LAG()`-based per-user gap flagging:** the same alternative shown in Q79, with `PARTITION BY UserID` added to the `LAG()` call — equally valid, same trade-offs as discussed there.
- No fundamentally different alternative approach exists worth presenting — this question exists specifically to confirm you can add a partition to a pattern you already know, not to test a new technique.

**7. Performance**
An index on `(UserID, LoginDate)` lets the partitioned window function stream each user's logins in pre-sorted order with no separate sort operator — essential once the user base and login history both grow large, since the alternative (sorting the whole table by `UserID, LoginDate` at query time) becomes an increasingly expensive operation.

**8. Edge Cases**
- Users with a single login ever: correctly reported as a one-day "streak."
- Multiple logins by the same user on the same day: the `SELECT DISTINCT` in the base CTE is essential here for the same reason as Q79 — without it, same-day duplicate rows would desynchronize the row-number-to-date correspondence within that user's partition.
- A user with zero logins never appears in `UserLogins` at all, so they trivially don't appear in this result — correct, since there's no streak data to report for them.

**9. Production Scenario**
This is the direct SQL underpinning of gamified engagement features — "daily streak" badges/rewards in consumer apps (Duolingo-style streak tracking), and equally, security/fraud monitoring for unusual login-cadence changes (a sudden break in an otherwise-daily login pattern can be a weak signal worth correlating with other fraud indicators).

**10. Interview Follow-ups**
1. What's the one-line change from Q79 to this question, and why does it work?
2. How would you find each user's *current, active* streak (the one ending today or yesterday), not all historical streaks?
3. How would this scale to millions of users, each with years of login history?
4. How do you handle a user's timezone when "day" is ambiguous across regions?

**11. Follow-up Answers**
1. Adding `PARTITION BY UserID` to the `ROW_NUMBER()` — everything else, including the island-grouping arithmetic, is unchanged, because the partition simply makes the row numbering (and therefore the constant-difference trick) independent per user rather than global.
2. After computing all streaks (as shown), filter to each user's single most recent streak: wrap the result in another `ROW_NUMBER() OVER (PARTITION BY UserID ORDER BY StreakEnd DESC)` and take rank 1, then further filter to `StreakEnd >= CAST(GETDATE() AS DATE) - 1` to confirm the streak is still "live" (ended today or yesterday, allowing for the user not having logged in yet today).
3. The mechanics don't change, but the supporting `(UserID, LoginDate)` index becomes critical, and it's worth considering whether this is computed on every read (expensive at scale, recomputing full history per query) versus maintained incrementally — e.g., an `UserStreaks` summary table updated once per login event rather than recalculated from full history on every dashboard load.
4. Store `LoginDate` in the user's local calendar date (computed at write time using their profile timezone or the timezone of the originating request), not a UTC-derived date truncation — truncating a UTC timestamp to a date can shift a login to the "wrong" calendar day for users far from UTC, silently breaking streaks that, from the user's perspective, were never broken.

**12. Common Mistakes**
- Forgetting to partition and computing one company-wide "streak" instead of per-user streaks.
- Not deduplicating same-day multiple logins before numbering.
- Computing this from scratch over full history on every request instead of maintaining an incremental summary for a high-traffic feature — a real performance/architecture trade-off, not just a SQL syntax issue.

**13. Architect Insight**
The SQL here is a one-line delta from Q79 — trivial for anyone who genuinely understood that question. The architect-level conversation is entirely in the follow-ups: timezone correctness (a real, frequently-mishandled bug class in global consumer products) and the read-time-computation-vs-maintained-summary trade-off for a feature that's likely rendered on every single user session. That's the real interview: can you take a solved SQL puzzle and reason about it as a production feature with scale and correctness constraints attached.

---

### Q83. Find the longest consecutive streak per user

**Difficulty:** 🔥 Architect

**1. Interview Answer**
Build directly on Q82: compute every streak per user (already solved), then take the single longest one per user using the exact top-N-per-group pattern from Q72 (`ROW_NUMBER()`/`RANK() OVER (PARTITION BY UserID ORDER BY StreakLengthDays DESC)`, filter to rank 1). This question is explicitly a composition of two already-solved problems, and naming that composition is the strongest possible opening.

**2. SQL Query**
```sql
WITH Numbered AS (
    SELECT UserID, LoginDate,
           ROW_NUMBER() OVER (PARTITION BY UserID ORDER BY LoginDate) AS rn
    FROM (SELECT DISTINCT UserID, LoginDate FROM dbo.UserLogins) AS DistinctLogins
),
Streaks AS (
    SELECT
        UserID,
        MIN(LoginDate) AS StreakStart,
        MAX(LoginDate) AS StreakEnd,
        DATEDIFF(DAY, MIN(LoginDate), MAX(LoginDate)) + 1 AS StreakLengthDays
    FROM (
        SELECT UserID, LoginDate, DATEADD(DAY, -rn, LoginDate) AS IslandGroup
        FROM Numbered
    ) AS Islands
    GROUP BY UserID, IslandGroup
),
RankedStreaks AS (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY UserID ORDER BY StreakLengthDays DESC, StreakStart ASC) AS StreakRank
    FROM Streaks
)
SELECT UserID, StreakStart, StreakEnd, StreakLengthDays
FROM RankedStreaks
WHERE StreakRank = 1
ORDER BY UserID;
```

**3. Explain the Query**
1. `Numbered` and the derived `Islands`/`Streaks` CTE reproduce Q82's per-user streak detection exactly.
2. `RankedStreaks` applies a second, independent windowing pass: within each user's own set of streaks, rank them by length descending, breaking ties by earliest `StreakStart` (a deliberate, explicit tiebreak — "if a user has two equally-long streaks, report the earlier one" — stated as a business decision, not left to chance).
3. Filtering to `StreakRank = 1` keeps exactly one row per user: their single longest streak.

**4. Sample Data** (same as Q82, plus a longer run for UserID 1)

| UserID | LoginDate |
|---|---|
| 1 | 2024-01-01 |
| 1 | 2024-01-02 |
| 1 | 2024-01-04 |
| 1 | 2024-01-05 |
| 1 | 2024-01-06 |

**5. Expected Output**

| UserID | StreakStart | StreakEnd | StreakLengthDays |
|---|---|---|---|
| 1 | 2024-01-04 | 2024-01-06 | 3 |

(The 3-day streak beats the earlier 2-day streak.)

**6. Alternative Solutions**
- **Two-layer windowing (shown above):** preferred — composes cleanly from already-explained building blocks (Q79's islands + Q72's top-N-per-group), and is easy to extend (e.g., top 3 longest streaks per user by changing the final filter).
- **`MAX(StreakLengthDays)` with `GROUP BY UserID`, then a join back:** works, but if two streaks tie for longest, a plain `MAX`+join returns *both* tied streaks without an explicit, stated tiebreak rule — which may be exactly what's wanted, or may need the same explicit tiebreak decision as the `ROW_NUMBER()` version, just made less visibly.
- **Preferred:** the `ROW_NUMBER()` ranking layer — it forces an explicit tiebreak decision into the query itself, which is the more defensible production pattern.

**7. Performance**
Two windowing passes over the same (already small, per-user) `Streaks` intermediate result set — the expensive part of this query is identical to Q82's cost (scanning/sorting the base `UserLogins` table), and the second ranking pass operates only on the much smaller "one row per streak" intermediate result, not the original login-event-level data, so it adds negligible additional cost.

**8. Edge Cases**
- Ties for longest streak: resolved explicitly via the `StreakStart ASC` tiebreak in this answer — call this out as a deliberate choice, since "report all tied longest streaks" is an equally valid alternative interpretation (swap `ROW_NUMBER()` for `RANK()` to get that behavior instead).
- Users with exactly one login: their only "streak" (length 1) is trivially their longest.
- Very long individual streaks (a user who logs in every single day for years): `StreakLengthDays` grows unbounded but the calculation itself doesn't change — no special-casing needed, since `DATEDIFF` handles arbitrarily large date ranges without issue.

**9. Production Scenario**
The direct backing query for a "your longest streak: 47 days" profile-page statistic in a gamified/engagement-driven consumer app — and, in a very different domain, computing the longest run of consecutive on-time payments (or, inversely, consecutive missed payments) per account in a lending/collections context, where the same exact SQL shape identifies risk patterns.

**10. Interview Follow-ups**
1. How does this query's structure explicitly demonstrate composing Q79 and Q72's patterns together?
2. How would you get each user's top 3 longest streaks instead of just the single longest?
3. How would you maintain this incrementally rather than recomputing full history on every request?
4. How would you extend "streak" to something other than daily logins — e.g., consecutive on-time payments — and what changes?

**11. Follow-up Answers**
1. The inner CTEs are exactly Q79/Q82's gaps-and-islands mechanism (find runs via `value - row_number`); the outer `RankedStreaks` CTE is exactly Q72's top-N-per-group mechanism (`PARTITION BY ... ORDER BY ... DESC`, filter to rank 1) — applied to the *output* of the first pattern instead of to raw table rows. Stating this decomposition explicitly is the strongest possible answer framing.
2. Change `WHERE StreakRank = 1` to `WHERE StreakRank <= 3` in the final filter — identical to the Q72→Q74 generalization.
3. Maintain a `UserStreakSummary` table with each user's current active streak length and longest-ever streak length, updated transactionally on each login event (increment if the login is exactly one day after the last recorded login, reset to 1 otherwise, and update "longest ever" if the current streak just exceeded it) — this converts an `O(full history)` read-time computation into an `O(1)` write-time update, which is the correct trade-off for a value read far more often than the underlying event log changes.
4. Replace `UserLogins`/`LoginDate` with `Payments`/`PaymentDate` (or a derived "on schedule" boolean per period) and adjust the "expected next value" logic from "+1 calendar day" to "+1 billing period" (which may not be a fixed number of days, e.g., monthly billing) — the core `value - row_number`-style island detection still applies, but the definition of "the next expected value in sequence" must be recomputed for the new domain rather than assumed to be exactly 1 day.

**12. Common Mistakes**
- Re-deriving the whole thing from scratch instead of explicitly reusing/referencing Q79's and Q72's already-established patterns — a missed opportunity to demonstrate pattern recognition.
- Using `MAX()` alone without an explicit tiebreak decision when ties are a real possibility in the data.
- Recomputing full history on every page load for a feature (a profile "longest streak" stat) that's read far more often than the underlying data changes, without considering an incremental/maintained-summary alternative.

**13. Architect Insight**
This is the capstone question of the gaps-and-islands family in this workbook, and it's deliberately rated 🔥 Architect rather than 🔴 Senior because the *SQL* itself is no harder than composing two already-known patterns — the real bar being tested is whether the candidate can (a) recognize and state that composition explicitly, and (b) pivot unprompted to the read-vs-write, compute-vs-maintain architectural trade-off in follow-up 3, which is the kind of judgment call that separates "writes correct SQL" from "designs the feature this SQL supports."

---

### Q84. Find duplicate transactions

**Difficulty:** 🔥 Architect

**1. Interview Answer**
Unlike Q67's row-level duplicate detection (identical values across defined columns), "duplicate transaction" in a financial context is inherently fuzzy: two transactions are rarely byte-identical, but a genuine duplicate charge typically shares the same account, the same amount, and occurs within a short time window of another transaction — the *interview answer itself* should open by naming this ambiguity, because picking the wrong duplicate definition is the actual risk in production (a payments system that's too aggressive about flagging "duplicates" will incorrectly block a customer's second legitimate $9.99 coffee purchase of the day).

**2. SQL Query**
```sql
-- Exact-match duplicates (same account, amount, and transaction type, submitted within 60 seconds)
WITH Candidates AS (
    SELECT
        TransactionID,
        AccountID,
        Amount,
        TransactionType,
        CreatedAt,
        LAG(TransactionID) OVER (
            PARTITION BY AccountID, Amount, TransactionType
            ORDER BY CreatedAt
        ) AS PriorTransactionID,
        LAG(CreatedAt) OVER (
            PARTITION BY AccountID, Amount, TransactionType
            ORDER BY CreatedAt
        ) AS PriorCreatedAt
    FROM dbo.Transactions
    WHERE Status IN ('SUCCESS', 'PENDING')   -- exclude already-failed/reversed transactions
)
SELECT
    TransactionID,
    PriorTransactionID,
    AccountID,
    Amount,
    CreatedAt,
    DATEDIFF(SECOND, PriorCreatedAt, CreatedAt) AS SecondsSincePrior
FROM Candidates
WHERE PriorTransactionID IS NOT NULL
  AND DATEDIFF(SECOND, PriorCreatedAt, CreatedAt) <= 60;
```

**3. Explain the Query**
1. Partition transactions by the fields that define "the same charge, repeated": `AccountID`, `Amount`, `TransactionType`. Within each partition, `LAG()` looks back to the immediately preceding transaction that shares all three attributes.
2. `DATEDIFF(SECOND, PriorCreatedAt, CreatedAt) <= 60` is the time-window heuristic — two otherwise-identical transactions more than 60 seconds apart are treated as separate, legitimate charges (e.g., two different days' coffee purchases would never be this close, but a genuine double-submit from a retried API call typically lands within seconds).
3. Filtering `Status IN ('SUCCESS', 'PENDING')` deliberately excludes already-failed or already-reversed transactions from consideration — a transaction that failed cleanly isn't a "duplicate" of the retry that then succeeded; it's the expected retry behavior working correctly (this ties directly into the idempotency-key discussion in `14-SQL-and-FinTech.md`).

**4. Sample Data**

| TransactionID | AccountID | Amount | TransactionType | CreatedAt |
|---|---|---|---|---|
| 1001 | A1 | 50.00 | DEBIT | 2024-03-01 10:00:00 |
| 1002 | A1 | 50.00 | DEBIT | 2024-03-01 10:00:05 |
| 1003 | A1 | 50.00 | DEBIT | 2024-03-02 09:00:00 |

**5. Expected Output**

| TransactionID | PriorTransactionID | AccountID | Amount | SecondsSincePrior |
|---|---|---|---|---|
| 1002 | 1001 | A1 | 50.00 | 5 |

(Transaction 1003 is the same amount but nearly 24 hours later — correctly not flagged as a duplicate of 1002.)

**6. Alternative Solutions**
- **`LAG()` time-window comparison (shown above):** preferred — directly expresses "compare each transaction to its immediate predecessor within the same account/amount/type group," which maps cleanly onto the business definition of a likely duplicate.
- **Self-join with a `BETWEEN` time window:**
  ```sql
  SELECT t1.TransactionID, t2.TransactionID AS DuplicateOf
  FROM dbo.Transactions t1
  JOIN dbo.Transactions t2
      ON t1.AccountID = t2.AccountID
     AND t1.Amount = t2.Amount
     AND t1.TransactionType = t2.TransactionType
     AND t1.TransactionID > t2.TransactionID
     AND t1.CreatedAt BETWEEN t2.CreatedAt AND DATEADD(SECOND, 60, t2.CreatedAt);
  ```
  Correct, but can produce more than one match per transaction if three or more near-identical transactions cluster together (each later one matches every earlier one within the window), requiring extra de-duplication of the *result set itself* — the `LAG()` form avoids this by construction, since it only ever compares to the single immediately-preceding row.
- **The real production answer — prevent, don't detect:** an `IdempotencyKey` column with a unique constraint (see `14-SQL-and-FinTech.md` Q144), enforced by the payment-submission API, so that a retried request with the same idempotency key is rejected/deduplicated *before* it ever becomes two rows — detection queries like this one are then a monitoring/audit backstop for cases where the idempotency mechanism itself was bypassed or didn't exist for older data, not the primary defense.
- **Preferred:** the `LAG()` form for detection/audit purposes; idempotency-key enforcement at the write path as the actual architectural fix.

**7. Performance**
Requires an index on `(AccountID, Amount, TransactionType, CreatedAt)` to let the partitioned `LAG()` stream each group in order without a separate sort — on a large, high-volume transactions table, this exact composite index is worth having permanently if duplicate-detection is a recurring batch job (e.g., a nightly fraud-review sweep), rather than an ad hoc index built for a one-off investigation.

**8. Edge Cases**
- Legitimate repeated charges: a subscription renewal, or a customer genuinely buying the same $4.50 item twice in the same minute at a vending machine/kiosk — the 60-second/same-amount heuristic is a *risk signal* for manual review, not proof of an erroneous duplicate; this must be communicated clearly to whoever consumes this query's output.
- Multi-currency accounts: `Amount` equality must account for `Currency` too (add `Currency` to the partition key) — comparing `50.00 USD` to `50.00 EUR` as "the same amount" would be a real bug.
- Reversed/refunded pairs: a genuine duplicate charge followed by its own refund could otherwise mask itself if the refund is stored as a negative-amount transaction rather than a status change on the original — confirm the data model's refund representation before assuming `Amount` equality alone is sufficient.

**9. Production Scenario**
This is a real, recurring control in payment-processing systems: detecting double-charges caused by client-side retry logic (a mobile app that resubmits a payment after a timeout, not realizing the first request actually succeeded server-side) before they reach a customer's statement and trigger a chargeback or support complaint — directly tying into the reconciliation and idempotency material in `13-SQL-and-Microservices.md` and `14-SQL-and-FinTech.md`.

**10. Interview Follow-ups**
1. Why is "duplicate transaction" a fuzzier concept than "duplicate row" (Q67), and how does that change your approach?
2. How does idempotency-key enforcement at the API layer relate to this detection query, and which one is the "real" fix?
3. How would you tune the 60-second window, and what would you measure to validate the choice?
4. How would this query need to change for a system processing thousands of transactions per second?

**11. Follow-up Answers**
1. A duplicate row (Q67) is an exact-match problem with a crisp, objective definition. A duplicate transaction is a *probabilistic risk signal* — same account/amount/type within a short window is *suggestive* of an erroneous duplicate but is never definitionally proof, because legitimate repeated charges exist; the query's job shifts from "find exact matches" to "surface candidates for review," which changes how false positives should be handled (flag for review, don't auto-reverse).
2. Idempotency-key enforcement (a unique constraint on a client-supplied key, checked at write time) is the actual *prevention* mechanism — it stops the duplicate from ever being persisted as two committed rows in the first place. This detection query is a *backstop*: it catches duplicates that occurred before idempotency keys existed in the system, or that slipped through due to a bug in the idempotency-key implementation itself (e.g., a client generating a new key on every retry instead of reusing the same one, defeating the whole mechanism).
3. Tune it by looking at the actual distribution of "time between legitimate repeated charges of the same amount" vs. "time between client-retry-caused duplicates" in historical, manually-reviewed data — retries from a timing-out HTTP client typically land within single-digit seconds, while legitimate repeat purchases of an identical amount are usually minutes to hours apart at minimum; validate the chosen threshold against a sample of confirmed true/false positives rather than picking a round number arbitrarily.
4. At very high transaction volume, avoid scanning the full historical table on every check — restrict the window function to a recent rolling time slice (e.g., only transactions from the last few minutes, using a filtered/indexed view or a time-bucketed partition) so each incoming transaction is compared only against a small, recent candidate set rather than the entire history, and consider doing this check synchronously in the application/API layer via a targeted point lookup (by account+amount+recent-time-range) rather than as a periodic full-table batch sweep.

**12. Common Mistakes**
- Treating any two same-amount, same-account transactions within the time window as a confirmed duplicate and auto-reversing them, without human review — a serious operational risk given the false-positive potential discussed above.
- Building this as a full-table self-join without a time-window bound at all ("all transactions with the same amount, ever"), producing an enormous, mostly-useless result set of coincidental matches.
- Not distinguishing "detection query" from "prevention mechanism," and treating this SQL as the actual fix for a duplicate-charge bug instead of pushing for idempotency-key enforcement at the source.

**13. Architect Insight**
This question closes the file precisely because it forces a shift from "SQL correctness" (every prior question in this file) to "SQL as a risk-management tool operating on inherently ambiguous business semantics." The Principal/Architect-level answer explicitly separates *detection* (this query, a monitoring backstop) from *prevention* (idempotency keys at the write path, covered in depth in `13-SQL-and-Microservices.md` and `14-SQL-and-FinTech.md`) — and refuses to let the query's output trigger an automated, irreversible action (like auto-reversal) without a human-review step, because the cost of a false positive (blocking or reversing a legitimate transaction) is asymmetric with the cost of a false negative (a missed duplicate that gets caught on the next audit pass).

---

## References

1. [EXISTS (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/exists-transact-sql) — Microsoft Learn
2. [Subqueries (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/performance/subqueries) — Microsoft Learn
3. [WITH common_table_expression (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/with-common-table-expression-transact-sql) — Microsoft Learn (recursive CTE guidance and `MAXRECURSION`)
4. [DATEDIFF (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/datediff-transact-sql) — Microsoft Learn
5. [ROW_NUMBER (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/row-number-transact-sql) — Microsoft Learn
6. [Execution Plan Overview](https://learn.microsoft.com/en-us/sql/relational-databases/performance/execution-plans) — Microsoft Learn
7. [Indexes (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/indexes) — Microsoft Learn
