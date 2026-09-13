> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: None (foundational data-layer domain)

# SQL Server Interview Workbook — Indexing & Query Performance/Execution Plans

A Principal/Staff/Architect-calibrated interview workbook. Every question below carries a full worked answer: the spoken answer, the T-SQL, sample data and output, alternative approaches with a stated preference, performance/index/plan implications, edge cases, a production scenario, likely follow-ups with strong answers, common mistakes, and the specific insight that separates a senior answer from an adequate one.

**Canonical sample schema used throughout** (also reused by sibling workbook files):
- `Employees(EmployeeID, FirstName, LastName, DepartmentID, ManagerID, Salary, HireDate)`, `Departments(DepartmentID, DepartmentName)`
- `Customers(CustomerID, CustomerName, Country)`, `Orders(OrderID, CustomerID, OrderDate, TotalAmount)`, `OrderItems(OrderItemID, OrderID, ProductID, Quantity, UnitPrice)`, `Products(ProductID, ProductName, CategoryID, Price)`, `Categories(CategoryID, CategoryName)`

---

## Part A: Indexing

### Q1. What's the difference between a clustered and a non-clustered index, and how is each actually structured on disk?

**Difficulty:** 🔴 Senior

#### 1. Interview Answer
A clustered index *is* the table: the leaf level of its B+‑tree contains the actual data rows, physically ordered by the index key. A table can have at most one, because rows can only be sorted one way at a time. A non-clustered index is a separate structure whose leaf level contains the index key column(s) plus a *row locator* — the clustering key if the table has a clustered index, or a physical Row ID (RID) if the table is a heap. A table can have up to 999 non-clustered indexes. Reading through a non-clustered index therefore usually means two traversals when you need columns that aren't in the index: one down the non-clustered B+‑tree to find the row locator, then a second traversal (a "key lookup") down the clustered index to fetch the rest of the row.

#### 2. SQL Query
```sql
-- Clustered index (usually the PK, but doesn't have to be)
CREATE CLUSTERED INDEX IX_Employees_EmployeeID ON dbo.Employees(EmployeeID);

-- Non-clustered index on a frequently filtered column
CREATE NONCLUSTERED INDEX IX_Employees_DepartmentID ON dbo.Employees(DepartmentID);
```

#### 3. Explain the Query
The clustered index statement physically sorts and stores `Employees` rows by `EmployeeID`. The non-clustered index builds a second, smaller B+‑tree keyed on `DepartmentID`; each leaf row stores `DepartmentID` plus the clustering key (`EmployeeID`), not the whole row. A query filtering on `DepartmentID` that also needs `Salary` must jump from the non-clustered leaf to the clustered index to retrieve `Salary` — the key lookup.

#### 4. Sample Data
| EmployeeID | DepartmentID | Salary |
|---|---|---|
| 101 | 10 | 95000 |
| 102 | 10 | 88000 |
| 103 | 20 | 76000 |

#### 5. Expected Output
`SELECT Salary FROM Employees WHERE DepartmentID = 10` returns `95000, 88000` — but internally via a seek on `IX_Employees_DepartmentID` followed by two key lookups into the clustered index.

#### 6. Alternative Solutions
- **Heap (no clustered index) + non-clustered indexes only** — viable for pure insert-heavy staging tables with no ordered access pattern, but every non-clustered index then stores an 8-byte RID instead of the (often narrower, but sometimes wider) clustering key, and RIDs change if the row is ever moved (forwarding pointers), which is worse in practice.
- **Clustered index on a natural, frequently-ranged column (e.g., OrderDate)** instead of a surrogate key — good when range scans by date dominate, bad if it causes page splits from non-sequential inserts.
- **Preferred**: clustered index on a narrow, static, ever-increasing key (identity or sequential GUID via `NEWSEQUENTIALID()`), because every non-clustered index carries that key at every leaf row — a wide or volatile clustering key bloats every other index and causes fragmentation on update.

#### 7. Performance
Index requirement: none beyond the index itself — this *is* the fundamental performance decision for the table. Verify via the actual execution plan: a `Clustered Index Seek` is O(log n) page reads down the tree; a non-clustered lookup path shows as `Index Seek` + `Key Lookup`, and SSMS/Query Store will show the lookup's estimated/actual row count and cost percentage — if the lookup count is high relative to rows returned, that's the signal to add covering columns (Q3). Confirm via `SET STATISTICS IO ON` logical reads, not intuition.

#### 8. Edge Cases
A heap with no clustered index and no non-clustered indexes forces a full table scan for every query. Updating the clustering key value is expensive — it's a delete+insert at every non-clustered index that references it as the row locator. Wide clustering keys (e.g., a `VARCHAR(200)` natural key) inflate every secondary index.

#### 9. Production Scenario
A ledger table clustered on `(AccountID, TransactionID)` gets sequential inserts per account and range-scans well for "all transactions for this account," at the cost of hot-page contention if one account is extremely high-volume — a case for partitioning (see Database Design workbook, Q121).

#### 10. Interview Follow-ups
1. Why can a table have only one clustered index?
2. What happens to non-clustered indexes if you rebuild the clustered index?
3. What's a "forwarding pointer" and when does it occur?
4. When would you deliberately choose a heap?
5. How does a unique clustered index differ from a non-unique one internally?

#### 11. Follow-up Answers
1. Because the clustered index physically orders the data rows — data can only have one physical order at a time.
2. Rebuilding the clustered index doesn't invalidate non-clustered indexes' logical row locators (the clustering key values), but it is still a size-of-data operation that can cause non-clustered indexes to be rebuilt too if the clustering key values change (rare) or if `ALL` is specified.
3. A forwarding pointer happens on a heap when a variable-length row grows too large for its page after an update and must move; the original slot leaves a pointer to the new location, adding an extra I/O to every access — a heap-specific pathology that argues for clustered indexes on volatile tables.
4. Rare in OLTP; sometimes used for high-throughput staging/ETL landing tables where you bulk-load and immediately bulk-read/truncate, and no natural sort order helps.
5. SQL Server adds a hidden 4-byte "uniquifier" to duplicate keys in a non-unique clustered index so every non-clustered index's row locator stays unique — a subtle cost of not enforcing uniqueness on the clustering key.

#### 12. Common Mistakes
Assuming the primary key and clustered index are the same thing (they default together but are independent choices). Choosing a wide or GUID (`NEWID()`, not sequential) clustering key, which randomizes insert location and causes constant page splits. Forgetting that every non-clustered index pays the clustering-key-width tax.

#### 13. Architect Insight
A senior candidate recites "clustered = data, non-clustered = pointer." A staff/principal candidate reasons about the *cost this imposes on every other index in the table* and picks the clustering key as a table-wide architectural decision — not a per-query one — because changing it later means rebuilding every dependent non-clustered index.

---

### Q2. How do you decide column order in a composite (multi-column) index, and why does order matter?

**Difficulty:** 🔴 Senior

#### 1. Interview Answer
Column order determines which query predicates the index can seek on versus merely scan within. A composite index is sorted first by its leading column, then by the next column within each value of the first, and so on — exactly like a phone book sorted by last name then first name. A query that filters only on the second column can't seek the index at all (it would have to scan every leading-column value). The rule of thumb — often stated as "equality, then inequality, then included columns" — is: put columns used in equality predicates first (most selective ones earliest among ties), range/inequality predicate columns next, and put `ORDER BY`/output-only columns last (or in `INCLUDE`).

#### 2. SQL Query
```sql
-- Good: supports "orders for one customer in a date range" as a pure seek
CREATE NONCLUSTERED INDEX IX_Orders_CustomerID_OrderDate
    ON dbo.Orders(CustomerID, OrderDate) INCLUDE (TotalAmount);

SELECT OrderID, TotalAmount
FROM Orders
WHERE CustomerID = 42 AND OrderDate >= '2026-01-01';
```

#### 3. Explain the Query
`CustomerID` leads because it's an equality predicate; `OrderDate` follows because it's a range predicate applied *within* each customer's rows — the optimizer seeks to `CustomerID = 42`, then range-scans the contiguous `OrderDate` values for just that customer. `TotalAmount` is included (not keyed) because it's only needed in the output, not for filtering or ordering — keeping it out of the key keeps the key itself narrow.

#### 4. Sample Data
| OrderID | CustomerID | OrderDate | TotalAmount |
|---|---|---|---|
| 1 | 42 | 2025-11-01 | 120 |
| 2 | 42 | 2026-02-10 | 340 |
| 3 | 7 | 2026-02-11 | 50 |

#### 5. Expected Output
Only `OrderID 2` (`CustomerID=42` and `OrderDate >= 2026-01-01`).

#### 6. Alternative Solutions
- **`(OrderDate, CustomerID)`** — would help "all orders in a date range across customers" but forces a scan-then-filter for the per-customer-in-range query above; wrong for this predicate shape.
- **Two single-column indexes** on `CustomerID` and `OrderDate` separately — SQL Server *can* intersect them, but an index intersection is almost always more expensive than one well-ordered composite seek; only worth it when the two columns are queried independently in different queries as well.
- **Preferred**: the composite `(CustomerID, OrderDate)` with `TotalAmount` included, because it serves the actual predicate shape as a single seek plus becomes covering (Q3) for this exact query.

#### 7. Performance
Verify column order is correct by checking the plan for a `Seek` predicate (both columns) versus a `Seek` predicate + `Residual`/`Predicate` (only the leading column seeks, the rest is a filter applied after). `SET STATISTICS IO` should show logical reads close to the number of matching rows, not the whole table.

#### 8. Edge Cases
If `CustomerID` has very low selectivity (e.g., 90% of orders belong to one whale customer), the optimizer may still choose a scan over the seek for that value — cardinality estimation, not just index existence, decides the plan (see Q15). NULLs in a leading equality column need `IS NULL`, which composite indexes support, but be sure the query actually uses it explicitly.

#### 9. Production Scenario
A customer-facing "my order history" page filtering by `CustomerID` and a date range is exactly this pattern — one of the highest-frequency queries in any e-commerce or banking transaction-history screen.

#### 10. Interview Follow-ups
1. What happens if you swap the column order?
2. How many range columns can a composite index seek on effectively?
3. Does column order matter for `INCLUDE`d columns?
4. How would you decide order if two columns are both used in equality predicates in different queries?
5. What's the "leftmost prefix" rule?

#### 11. Follow-up Answers
1. The query above degrades to a scan of all rows for `CustomerID=42` — worse if the composite were `(OrderDate, CustomerID)`, it can't seek on `CustomerID` at all without `OrderDate` supplied.
2. Effectively one contiguous range after any number of leading equality columns — SQL Server can seek `col1 = x AND col2 BETWEEN a AND b`, but a second range column beyond that just gets filtered, not seeked.
3. No — included columns are stored only at the leaf and aren't part of the sort key, so their order doesn't affect seekability, only storage/covering.
4. Put the column that's more frequently an equality predicate, or the more selective one, leading; if both patterns matter equally, consider two separate indexes rather than compromising one.
5. A composite index can only be used for seeking on a *prefix* of its key columns starting from the left — `(A, B, C)` seeks efficiently on `A`, `A+B`, or `A+B+C`, but not on `B` or `C` alone.

#### 12. Common Mistakes
Ordering composite index columns to match a `SELECT` list instead of the `WHERE`/`JOIN` predicate shape. Assuming an index helps a query just because all referenced columns are somewhere in the index, regardless of order.

#### 13. Architect Insight
Junior candidates know composite indexes exist; senior candidates can look at a query's predicate and immediately state the correct column order and justify it via the leftmost-prefix rule; principal candidates additionally weigh this against *all* the other queries hitting that table, because one index serves many queries and column order is a shared, table-wide trade-off, not a per-query optimization.

---

### Q3. What's a covering index, and how do included columns differ from key columns?

**Difficulty:** 🟡 Intermediate

#### 1. Interview Answer
A covering index is a non-clustered index that contains every column a specific query needs — in the key, in `INCLUDE`, or both — so SQL Server can satisfy the query entirely from the non-clustered index's leaf level without a key lookup back to the clustered index. `INCLUDE` columns are stored only at the leaf level of the non-clustered B+‑tree: they don't participate in the sort order and aren't used for seeking or filtering, but they're available for output, which keeps the key itself narrow (cheaper to seek/sort) while still avoiding lookups.

#### 2. SQL Query
```sql
CREATE NONCLUSTERED INDEX IX_Orders_CustomerID_Covering
    ON dbo.Orders(CustomerID, OrderDate)
    INCLUDE (TotalAmount);

SELECT OrderDate, TotalAmount
FROM Orders
WHERE CustomerID = 42;
```

#### 3. Explain the Query
Every column the query touches — `CustomerID` (filter), `OrderDate` (output/key), `TotalAmount` (output, included) — exists in the non-clustered index leaf. The optimizer can produce an `Index Seek` with no `Key Lookup` operator at all.

#### 4. Sample Data
Same `Orders` table as Q2.

#### 5. Expected Output
`OrderDate, TotalAmount` rows for `CustomerID = 42`, served purely from the non-clustered index.

#### 6. Alternative Solutions
- **Widen the index key itself** (`(CustomerID, OrderDate, TotalAmount)`) instead of using `INCLUDE` — works but makes the key wider than necessary, increasing page-split and sort costs since `TotalAmount` never needs to be sorted.
- **Rely on the clustered index only** and accept the key lookup — fine for low-frequency queries or small result sets, not for hot paths.
- **Preferred**: `INCLUDE` for output-only columns — narrower key, same covering benefit.

#### 7. Performance
Confirm by inspecting the plan: no `Key Lookup` operator should appear. Trade-off: every included column increases the leaf-page size and storage/maintenance cost of the index and slightly increases write cost on `INSERT`/`UPDATE` of those columns — covering indexes are a read/write trade-off, not a free win.

#### 8. Edge Cases
Adding too many included columns for "just in case" coverage bloats the index and can push it past being worth maintaining versus just doing the lookup. Wide `VARCHAR`/`NVARCHAR` included columns multiply that cost. A covering index doesn't help if the query later adds a column to its `SELECT *` that isn't included.

#### 9. Production Scenario
Dashboard/reporting queries that repeatedly project the same 3–4 columns for a filtered customer or account are the classic covering-index candidate — turns a lookup-heavy plan into a pure seek.

#### 10. Interview Follow-ups
1. Does a covering index eliminate the need for the clustered index lookup entirely, always?
2. What's the storage cost of `INCLUDE`?
3. Can `INCLUDE` columns be of any data type?
4. How do you find out if an index isn't fully covering a query?

#### 11. Follow-up Answers
1. Only for that specific query's column list — a different query against the same table may still need a lookup unless it's also covered.
2. Included columns are duplicated at every leaf row of the non-clustered index — real storage and write-amplification cost, not free.
3. Almost any type except a few large object restrictions on the *key* — `INCLUDE` is more permissive on size than key columns (which are capped near 900/1700 bytes), because leaf-only storage doesn't need to support seeking.
4. Look for a `Key Lookup` operator (or `RID Lookup` on a heap) in the actual execution plan connected to the index seek via a nested loop.

#### 12. Common Mistakes
Including every column "to be safe," which turns the non-clustered index into a near-duplicate of the table and doubles write cost. Forgetting that key-lookup elimination is query-specific, not table-wide.

#### 13. Architect Insight
The senior-vs-adequate line here is whether the candidate treats covering indexes as a targeted response to a specific, measured hot query (verified via plan/DMV) versus a blanket "add INCLUDE everywhere" habit that quietly doubles the table's write cost.

---

### Q4. What's a filtered index, and when does it outperform a full non-clustered index?

**Difficulty:** 🟡 Intermediate

#### 1. Interview Answer
A filtered index is a non-clustered index with a `WHERE` predicate, indexing only the subset of rows that match it. It's smaller, cheaper to maintain, and has better statistics quality (a denser, more accurate histogram) than a full index would for that subset — ideal when queries consistently target a small, well-defined slice of a much larger table, like active/pending rows in a table dominated by completed/archived ones.

#### 2. SQL Query
```sql
CREATE NONCLUSTERED INDEX IX_Transactions_Pending
    ON dbo.Transactions(AccountID, CreatedAt)
    WHERE Status = 'PENDING';

SELECT TransactionID, Amount
FROM Transactions
WHERE Status = 'PENDING' AND AccountID = 555;
```

#### 3. Explain the Query
The index only contains rows where `Status = 'PENDING'`; if 99% of transactions are `SUCCESS`/`FAILED`, this index is roughly 1% of the table's size, so it fits in memory more easily and every maintenance operation only touches pending rows.

#### 4. Sample Data
| TransactionID | AccountID | Status | CreatedAt |
|---|---|---|---|
| 1 | 555 | PENDING | 2026-09-10 |
| 2 | 555 | SUCCESS | 2026-09-01 |
| 3 | 555 | PENDING | 2026-09-12 |

#### 5. Expected Output
`TransactionID 1` and `3`.

#### 6. Alternative Solutions
- **Full index on `(Status, AccountID, CreatedAt)`** — works for any status, but is far larger and its statistics are diluted across all status values, hurting cardinality estimates for the rare `PENDING` case.
- **Indexed view / separate "hot" table** for pending transactions — heavier to maintain, justified only at extreme scale.
- **Preferred**: the filtered index — it directly matches the access pattern ("we only ever query pending rows this way") at a fraction of the cost.

#### 7. Performance
The plan shows a normal `Index Seek`, but the *optimizer must be able to prove the query's predicate implies the filter* — the query's `WHERE` must match or be a subset of the index's filter predicate, using the exact same comparison semantics (this is stricter than it looks; parameterized queries with `@Status` instead of a literal `'PENDING'` may not match unless SQL Server can simplify it, so filtered indexes pair best with literal-heavy or `OPTION (RECOMPILE)` queries).

#### 8. Edge Cases
If application code passes `Status` as a parameter rather than a literal, the optimizer may be unable to guarantee the filtered index covers the query for all possible parameter values and will ignore it — a frequent "why isn't my filtered index being used" root cause. Filtered indexes can't be used to enforce uniqueness across the whole table, only within the filtered subset.

#### 9. Production Scenario
A payments table where only `PENDING`/`PROCESSING` rows are polled by a reconciliation job, while `SUCCESS`/`FAILED` rows dominate row count historically — the filtered index keeps that hot polling query fast indefinitely regardless of table growth.

#### 10. Interview Follow-ups
1. Why might a filtered index silently not get used?
2. Can a filtered index be unique?
3. How does a filtered index affect statistics maintenance?
4. What SQL Server version introduced filtered indexes?

#### 11. Follow-up Answers
1. Parameterized predicates that the optimizer can't statically prove match the filter (type mismatches, non-SARGable wrapping, or values passed as variables instead of literals in a way the optimizer can't simplify).
2. Yes — `UNIQUE` filtered indexes are a common way to enforce "unique among non-deleted rows" for soft-delete tables.
3. Filtered indexes get their own filtered statistics, which are denser and more accurate for the subset than the full table's statistics would be — a secondary performance benefit beyond size.
4. SQL Server 2008.

#### 12. Common Mistakes
Creating a filtered index and then querying with a parameter, not a literal, and being confused when it's unused. Using a filtered index to try to enforce uniqueness across the *whole* table (it only covers the filtered subset).

#### 13. Architect Insight
Recognizing that a filtered index's statistics quality — not just its size — is often the bigger win, and knowing the parameter-vs-literal gotcha up front, is what separates someone who's actually debugged this in production from someone reciting the definition.

---

### Q5. What is index selectivity and cardinality, and how do they determine whether SQL Server will actually use an index?

**Difficulty:** 🔴 Senior

#### 1. Interview Answer
Selectivity is the fraction of rows an index key value returns — `distinct values / total rows` for a rough estimate, or the actual matching-row fraction for a specific predicate. High selectivity (few rows per key value, like an email address) makes an index seek cheap and attractive; low selectivity (few distinct values, like a `Status` flag with 3 values, or a `Gender` column) means each key value matches a large fraction of the table, and SQL Server's optimizer will often correctly choose a table/clustered-index scan over a seek plus mass key-lookups, because the scan does less total I/O. This is a cost-based decision, not a fixed threshold — the optimizer estimates cardinality (expected row count) from statistics and picks whichever physical operation it estimates is cheaper.

#### 2. SQL Query
```sql
-- Low selectivity: Status has 3 values across millions of rows
SELECT * FROM Transactions WHERE Status = 'SUCCESS';   -- likely a scan

-- High selectivity: AccountID has near-unique values relative to a filter
SELECT * FROM Transactions WHERE TransactionID = 88213; -- always a seek
```

#### 3. Explain the Query
For the `Status` query, if `SUCCESS` is 95% of rows, an index seek would still touch 95% of the table's rows via lookups — strictly more expensive than one sequential scan. For `TransactionID` (the clustering/unique key), exactly one row matches, so a seek is unambiguously cheapest.

#### 4. Sample Data
| Status | RowCount |
|---|---|
| SUCCESS | 9,500,000 |
| FAILED | 400,000 |
| PENDING | 100,000 |

#### 5. Expected Output
Querying `Status = 'PENDING'` (1% selectivity) is a good seek candidate; `Status = 'SUCCESS'` (95%) is not, even with an index present.

#### 6. Alternative Solutions
- **Filtered index on `Status = 'PENDING'`** (Q4) — turns the low-selectivity-overall column into a highly selective, purpose-built index for the one value that's actually queried selectively.
- **Force the seek via an index hint** — almost always the wrong move; fighting the optimizer's cost-based decision on a correctly-estimated low-selectivity predicate usually makes things worse.
- **Preferred**: accept the scan for genuinely low-selectivity predicates; use a filtered index only for the specific low-frequency value that's actually queried often.

#### 7. Performance
Verify with `DBCC SHOW_STATISTICS` or the histogram in the actual execution plan's "Statistics Info" — compare `Estimated Number of Rows` to `Actual Number of Rows`; a large gap signals stale or skewed statistics rather than a selectivity problem per se (see Q15).

#### 8. Edge Cases
Skewed distributions (one `AccountID` with a million transactions among mostly single-digit accounts) break the "average selectivity" assumption — this is where parameter sniffing (Q16) and per-value cardinality estimation diverge sharply from the column's overall selectivity.

#### 9. Production Scenario
A fraud-flag column that's `0` for 99.99% of rows and `1` for suspicious transactions is a textbook filtered-index-on-a-low-selectivity-column case: the column overall is nearly useless as an index, but the rare value is exactly what fraud-review queries filter on.

#### 10. Interview Follow-ups
1. How does SQL Server estimate selectivity without scanning the whole table?
2. What's the difference between selectivity and density?
3. Why might the optimizer choose a scan even for a selective predicate?
4. How would you diagnose a case where the optimizer "should" seek but scans instead?

#### 11. Follow-up Answers
1. Via sampled or full-scan statistics (histograms) built and periodically auto-updated on indexed/queried columns, not by scanning at query time.
2. Density is the inverse relationship — `1/distinct values` — used internally for multi-column cardinality math; selectivity is the more query-facing framing of "how many rows match."
3. If statistics are stale/skewed, if the predicate isn't SARGable (Q18), or if the estimated cost of the seek-plus-lookups genuinely exceeds a scan for that specific value.
4. Compare estimated vs. actual rows in the plan, check `sys.dm_db_stats_properties` for last-updated time and modification counter, and check for non-SARGable predicate forms before assuming the optimizer is "wrong."
`

#### 12. Common Mistakes
Treating "add an index" as always correct regardless of the column's cardinality. Fighting the optimizer with hints instead of first checking statistics freshness and predicate SARGability.

#### 13. Architect Insight
A senior engineer knows scans-beat-seeks-sometimes is real; a principal engineer designs the *right narrow index for the actually-queried skewed value* (filtered index) instead of arguing with the optimizer about the column as a whole.

---

### Q6. What causes index fragmentation, and how do you choose between REORGANIZE and REBUILD?

**Difficulty:** 🟡 Intermediate

#### 1. Interview Answer
Fragmentation happens when logical page order (the B+‑tree's leaf-to-leaf chain) diverges from physical page order on disk, mainly from page splits caused by inserts/updates that don't fit in existing pages in key order (common with non-sequential keys like GUIDs, or `UPDATE`s that grow a variable-length column). Microsoft's own guidance: `REORGANIZE` for fragmentation roughly 5–30% (low system-resource, defragments the leaf level in place, can be stopped/resumed, doesn't update statistics with a full scan); `REBUILD` above ~30% (drops and recreates the index — reclaims space, resets fill factor, is a size-of-data operation, but with `ONLINE = ON` in Enterprise/certain editions can avoid blocking).

#### 2. SQL Query
```sql
SELECT i.name, ps.avg_fragmentation_in_percent, ps.page_count
FROM sys.dm_db_index_physical_stats(DB_ID(), OBJECT_ID('dbo.Orders'), NULL, NULL, 'LIMITED') ps
JOIN sys.indexes i ON i.object_id = ps.object_id AND i.index_id = ps.index_id;

ALTER INDEX IX_Orders_CustomerID_OrderDate ON dbo.Orders REORGANIZE;
-- vs.
ALTER INDEX IX_Orders_CustomerID_OrderDate ON dbo.Orders REBUILD WITH (ONLINE = ON, FILLFACTOR = 90);
```

#### 3. Explain the Query
`sys.dm_db_index_physical_stats` reports `avg_fragmentation_in_percent` per index; the maintenance script branches on that value. `FILLFACTOR = 90` leaves 10% free space per page on rebuild to delay the next round of splits for insert-heavy indexes.

#### 4. Sample Data
| Index | Fragmentation % | Page Count |
|---|---|---|
| IX_Orders_CustomerID_OrderDate | 42% | 15,000 |
| PK_Orders | 3% | 50,000 |

#### 5. Expected Output
The first index qualifies for `REBUILD` (>30%); the second is healthy and needs no action — and note page count matters too: Microsoft's guidance generally doesn't bother with indexes under ~1000 pages regardless of fragmentation, since the cost of maintenance exceeds the benefit.

#### 6. Alternative Solutions
- **Scheduled full rebuild of everything nightly** — simple but wasteful; rebuilds healthy, small, or rarely-fragmenting indexes for no benefit and consumes log space/IO unnecessarily.
- **Ola Hallengren's maintenance solution** (community-standard, not homegrown) — conditionally reorganizes/rebuilds based on fragmentation and page-count thresholds automatically; the de facto production standard for SQL Server index maintenance.
- **Preferred**: condition-based maintenance (via DMV threshold checks, ideally via the established Ola Hallengren scripts) rather than blanket or manual rebuilds.

#### 7. Performance
`REBUILD` fully updates statistics with a 100% scan as a side effect; `REORGANIZE` does not update statistics at all — a common miss is reorganizing and assuming statistics are now fresh. Rebuilding is log-intensive in `FULL` recovery model; consider `BULK_LOGGED` temporarily for large offline maintenance windows if RPO tolerates it.

#### 8. Edge Cases
Very small tables/indexes fragment "high on paper" (e.g., 60%) but the absolute page count is trivial (under 1000 pages) — Microsoft explicitly recommends ignoring fragmentation below this threshold. Heavily fragmented heaps (no clustered index) cannot be reorganized at all — only rebuilt (or converted to a clustered index).

#### 9. Production Scenario
A ledger table with a sequential `BIGINT IDENTITY` clustering key rarely fragments from inserts (always appended at the end); the same table's non-clustered index on a mutable `Status` column fragments quickly as rows move between filtered ranges — different indexes on the same table need different maintenance cadences.

#### 10. Interview Follow-ups
1. Why doesn't REORGANIZE update statistics?
2. What's a page split, mechanically?
3. Why do sequential GUID keys fragment less than random GUIDs?
4. Can you rebuild indexes online in all SQL Server editions?

#### 11. Follow-up Answers
1. Reorganize only physically reorders existing leaf pages to match logical order; it doesn't re-sample the data distribution, so the statistics histogram is untouched — a separate `UPDATE STATISTICS` is needed if data has changed meaningfully.
2. When a new row doesn't fit on its target page (identified by its key value) in sorted order, SQL Server allocates a new page and moves roughly half the rows to it, breaking physical/logical order at that point and leaving a page roughly half-full.
3. `NEWSEQUENTIALID()` or application-generated sequential IDs insert at the end of the key range, appending rather than splitting existing pages, unlike `NEWID()`'s random values which insert throughout the tree.
4. Online index rebuild has historically been an Enterprise-only feature; check the specific edition/version's feature matrix on Microsoft Learn before assuming availability — Standard Edition gained some online DDL capability in more recent versions, but this should always be verified per version rather than assumed.

#### 12. Common Mistakes
Rebuilding every index nightly regardless of fragmentation or size. Assuming `REORGANIZE` refreshes statistics. Choosing a random GUID as a clustering key without considering fragmentation impact.

#### 13. Architect Insight
The senior/principal distinction here is operational: knowing the DMV, the 5%/30% thresholds, and the page-count caveat is senior; designing the *clustering key choice up front* to minimize future fragmentation, and picking a maintenance tool (not a bespoke script) that the whole ops team can operate, is principal-level thinking about total cost of ownership.

---

### Q7. When do indexes actively hurt performance?

**Difficulty:** 🔴 Senior

#### 1. Interview Answer
Every index is a write amplifier: each `INSERT`/`UPDATE`/`DELETE` that touches an indexed column must also update every index containing that column, in addition to the base table (or clustered index). Indexes hurt when: (1) a table has many rarely-used indexes maintained on every write of a high-throughput OLTP table; (2) redundant/overlapping indexes exist (e.g., `(A)` and `(A, B)` — the first is often fully redundant); (3) wide indexes with many included columns multiply page count and memory/buffer-pool pressure; (4) the optimizer's extra plan-choice search space for many indexes marginally increases compile time; (5) index maintenance (rebuild/reorganize, Q6) becomes a growing operational burden as index count grows.

#### 2. SQL Query
```sql
-- Find unused or rarely-used indexes worth reviewing
SELECT OBJECT_NAME(s.object_id) AS TableName, i.name AS IndexName,
       s.user_seeks, s.user_scans, s.user_lookups, s.user_updates
FROM sys.dm_db_index_usage_stats s
JOIN sys.indexes i ON i.object_id = s.object_id AND i.index_id = s.index_id
WHERE s.database_id = DB_ID() AND s.user_updates > (s.user_seeks + s.user_scans + s.user_lookups) * 10;
```

#### 3. Explain the Query
`sys.dm_db_index_usage_stats` tracks reads vs. writes per index since the last SQL Server restart; an index with high `user_updates` and near-zero `user_seeks`/`user_scans`/`user_lookups` is pure write overhead with no read benefit — a rebuild/drop candidate.

#### 4. Sample Data
| IndexName | user_seeks | user_scans | user_lookups | user_updates |
|---|---|---|---|---|
| IX_Orders_LegacyReport | 0 | 2 | 0 | 480,000 |
| IX_Orders_CustomerID_OrderDate | 120,000 | 300 | 0 | 480,000 |

#### 5. Expected Output
`IX_Orders_LegacyReport` is a strong drop candidate; the second index earns its write cost through heavy read use.

#### 6. Alternative Solutions
- **Drop unused indexes outright** after confirming via usage stats over a full representative business cycle (not just since last restart — stats reset on restart/failover).
- **Consolidate overlapping indexes** into one wider composite rather than several narrow redundant ones.
- **Preferred**: periodic, data-driven index audits against `sys.dm_db_index_usage_stats` (captured over time, not a single snapshot) rather than either "index everything" or "never touch indexes" extremes.

#### 7. Performance
Every additional index roughly adds one more B+‑tree write per DML statement touching its key columns — on a table doing thousands of writes/second, 10 unnecessary indexes can be a meaningfully measurable multiple of total I/O and log generation, not just a rounding error.

#### 8. Edge Cases
`sys.dm_db_index_usage_stats` resets on service restart/failover, so "zero usage" right after a failover is misleading — always check uptime and consider a longer observation window or Query Store data instead.

#### 9. Production Scenario
This is exactly the "we added an index and the application got slower" incident (Q9) — usually because the new index's write cost on a hot insert path outweighed its read benefit, or because it duplicated an existing index's coverage.

#### 10. Interview Follow-ups
1. How do you know an index is truly redundant vs. subtly different?
2. What's the write cost difference between updating a key column vs. an included column?
3. How does index count affect optimizer compile time?
4. Would you ever keep an "unused" index anyway?

#### 11. Follow-up Answers
1. `(A)` is redundant to `(A, B)` for equality/seek purposes on `A` alone, but not identical if `(A)` is unique/has different fill factor, or if `(A,B)` is filtered and `(A)` is not — check exact semantics, don't drop on name pattern alone.
2. Updating a key column can force the row to move within the index's sort order (page split potential); updating an included-only column just rewrites the leaf entry in place — cheaper, but still not free.
3. More indexes mean a larger search space for the optimizer to cost during plan generation, which can measurably increase compile time for complex queries on heavily-indexed tables.
4. Yes — an index enforcing a business uniqueness constraint, or one used rarely but for a critical month-end/regulatory report, is legitimate even with low seek counts; usage stats inform, they don't override business requirements.

#### 12. Common Mistakes
Treating "more indexes = faster" as universally true. Dropping indexes based on a usage snapshot taken right after a restart. Not distinguishing index-supports-a-constraint from index-supports-a-query.

#### 13. Architect Insight
Adequate answers describe indexes as purely beneficial for reads; senior/principal answers frame every index as a read/write trade-off made at the table level, and treat "which indexes exist" as something to actively govern and audit over the table's lifetime, not a one-time setup decision.

---

### Q8. Given a new, unfamiliar table and its query workload, how do you decide which columns to index?

**Difficulty:** 🔥 Architect

#### 1. Interview Answer
Start from the actual query workload, not the schema in isolation: capture the highest-frequency and highest-cost queries (via Query Store or `sys.dm_exec_query_stats`), and for each, identify equality predicates, range predicates, join keys, and `ORDER BY`/`GROUP BY` columns. Apply the composite-index ordering rule (Q2: equality → range → include) per query pattern, then look for overlap across queries to consolidate into a smaller number of indexes that serve multiple query shapes rather than one bespoke index per query. Weigh every candidate index against its write cost on that table's actual write volume (Q7) before adding it — indexing is always workload-first, never schema-first.

#### 2. SQL Query
```sql
SELECT TOP 20
    qs.execution_count,
    qs.total_logical_reads / qs.execution_count AS avg_logical_reads,
    SUBSTRING(qt.text, (qs.statement_start_offset/2)+1,
        ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(qt.text) ELSE qs.statement_end_offset END - qs.statement_start_offset)/2) + 1) AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
WHERE qt.text LIKE '%Orders%'
ORDER BY qs.total_logical_reads DESC;
```

#### 3. Explain the Query
This pulls the highest-I/O queries touching `Orders` from the plan cache, ranked by total logical reads — the actual bottleneck signal, not a guess. In practice you'd use Query Store's built-in "Top Resource Consuming Queries" report instead of hand-rolling this on a modern instance, since Query Store persists across restarts and plan cache eviction.

#### 4. Sample Data
Not applicable — this is a workload-analysis query against system DMVs, not business data.

#### 5. Expected Output
A ranked list of the actual queries costing the most I/O against the target table, each with its predicate shape extractable from the query text.

#### 6. Alternative Solutions
- **Index every foreign key and every WHERE-clause column found by inspection** — fast to do, but ignores actual frequency/cost and often over-indexes rarely-run queries while missing composite shapes that matter.
- **Database Engine Tuning Advisor** against a captured workload trace — legitimate and useful for a first pass on unfamiliar schemas, but its recommendations should be reviewed, not applied blindly (it can suggest redundant or overly-specific indexes).
- **Preferred**: Query Store/DMV-driven analysis of real production query cost, cross-checked against DETA suggestions as a second opinion, applied with the write-cost governance from Q7.

#### 7. Performance
Prioritize indexes that fix the queries contributing the most *total* logical reads/CPU (`execution_count × per-execution cost`), not just the single slowest query — a moderately slow query run 100,000 times/day usually matters more than a very slow report run once a month.

#### 8. Edge Cases
A brand-new table/feature has no query history yet — in that case, index from the known access patterns in the application design (foreign keys used in joins, the primary lookup key) and revisit with real data after the feature ships; don't over-engineer speculative indexes for query shapes that don't exist yet.

#### 9. Production Scenario
Inheriting a legacy schema with 40 indexes on one table (a real, common finding) — the workflow above (usage stats to find dead weight, Query Store to find what's actually driving cost) is exactly how you'd triage it rather than guessing.

#### 10. Interview Follow-ups
1. How do you handle conflicting index needs between an OLTP write path and a reporting read path on the same table?
2. What's the role of Query Store specifically, versus the plan cache?
3. How do you validate an index recommendation before deploying it to production?
4. How does this change for a table with 500 million rows (see Q115)?

#### 11. Follow-up Answers
1. Separate them physically where possible — a read replica or reporting database with its own index set, or an indexed view/summary table — rather than compromising the OLTP table's write path with report-only indexes.
2. The plan cache is transient (evicted under memory pressure, cleared on restart) and only shows the *current* compiled plan; Query Store persists historical plans and runtime stats across restarts, enabling trend analysis and plan-regression detection (Q16/Q17) that the plan cache alone can't provide.
3. Test on a representative data volume/distribution (not just a small dev copy), check the plan before/after with `SET STATISTICS IO/TIME`, and monitor write-path impact (duration of inserts/updates) in a staging environment before production rollout, ideally behind a low-risk deployment window.
4. At that scale, indexing decisions can't be separated from partitioning and archiving strategy (Q115/Q121) — an index alone doesn't solve the operational cost of maintaining statistics/rebuilds on a 500M-row table.

#### 12. Common Mistakes
Indexing based on the schema diagram alone. Applying every Database Engine Tuning Advisor suggestion without reviewing for redundancy. Ignoring the write path entirely when optimizing reads.

#### 13. Architect Insight
This question is where architect-level candidates distinguish themselves by explicitly naming the *process* (measure real workload → identify predicate shapes → consolidate → weigh against write cost → validate before deploy) rather than jumping straight to "I'd add an index on X" — process discipline under ambiguity is exactly what's being tested.

---

### Q9. Production incident: adding an index made the application slower. Walk through the root-cause investigation.

**Difficulty:** 🔥 Architect

#### 1. Interview Answer
This is almost always one of: (a) the new index sits on a high-write table and its maintenance cost outweighs the read benefit it was meant to provide; (b) the new index changed the optimizer's plan choice for *other*, unrelated queries via plan cache invalidation or a shifted cost estimate, sending some of them to a worse plan; (c) the index caused unexpected lock contention (a new index means new pages to lock/latch, and can change lock ordering, occasionally introducing new deadlock patterns); or (d) the rebuild/creation itself was still running or briefly held a blocking schema-modification lock during a deploy window that overlapped live traffic. The investigation is: confirm the regression's time window against the deployment; compare execution plans (via Query Store's plan-regression view, which is built exactly for this) for the affected queries before and after; check `sys.dm_db_index_usage_stats` for the new index's actual read-vs-write ratio; and check for blocking/deadlocks coinciding with the change.

#### 2. SQL Query
```sql
-- Query Store: find queries whose plan changed and got worse after a given time
SELECT q.query_id, rs1.avg_duration AS avg_duration_before, rs2.avg_duration AS avg_duration_after
FROM sys.query_store_query q
JOIN sys.query_store_plan p1 ON p1.query_id = q.query_id
JOIN sys.query_store_runtime_stats rs1 ON rs1.plan_id = p1.plan_id
JOIN sys.query_store_plan p2 ON p2.query_id = q.query_id AND p2.plan_id <> p1.plan_id
JOIN sys.query_store_runtime_stats rs2 ON rs2.plan_id = p2.plan_id
WHERE rs2.avg_duration > rs1.avg_duration * 2;
```

#### 3. Explain the Query
This surfaces queries with more than one distinct plan on record where a later plan's average duration is at least double an earlier one's — Query Store's plan-forcing feature (`sp_query_store_force_plan`) can then pin the good plan immediately as a stopgap while the index change is properly reviewed.

#### 4. Sample Data
Not applicable — diagnostic query against Query Store system views.

#### 5. Expected Output
A short list of regressed queries with both plan IDs, which you'd open side-by-side in SSMS to compare operators.

#### 6. Alternative Solutions
- **Immediately drop the new index** — fastest mitigation if it's clearly the cause and not load-bearing for anything else yet, but skips root-cause understanding.
- **Force the prior good plan via Query Store** — buys time without removing the index, useful if the index is needed for a different, legitimate query.
- **Preferred**: mitigate first (drop or force-plan, whichever is faster and safer given what's known), then complete the Query-Store-driven root cause before deciding whether to reintroduce the index with adjustments (different columns, filtered, different fill factor, or during a lower-traffic maintenance window).

#### 7. Performance
The core lesson to verify, not assume: a new index changes the cost estimates the optimizer uses for *every* plan touching that table, not just the query it was added for — cost-based optimizers can and do pick worse plans for unrelated queries once a new access path exists and looks (incorrectly, for that query) cheaper.

#### 8. Edge Cases
If the regression coincides exactly with statistics auto-update triggered by the index-creation's implicit scan, the real cause may be a parameter-sniffed bad plan (Q16) coincidentally surfaced by the new statistics, not the index itself — don't stop investigating at "we added an index" without confirming the causal mechanism.

#### 9. Production Scenario
A payments-processing system where a new index intended to speed up a reconciliation report instead slowed down the hot payment-insert path by ~15%, discovered via APM latency alerts within an hour of a routine deploy — exactly the kind of incident this workbook's Troubleshooting section (Q105–Q116) treats in more general form.

#### 10. Interview Follow-ups
1. How would you have caught this before production?
2. What's plan forcing, and what are its risks?
3. How does this differ from a parameter-sniffing regression?
4. What monitoring would you put in place to catch this faster next time?

#### 11. Follow-up Answers
1. Load-test the write path with the new index under representative concurrency before deploy, and deploy behind a canary/percentage rollout with APM latency monitoring rather than a full cutover.
2. `sp_query_store_force_plan` pins a specific plan for a query; the risk is that a forced plan can become suboptimal later as data distribution changes, so it's a temporary stabilizer, not a permanent fix, and needs a follow-up ticket to actually resolve root cause.
3. Parameter sniffing regressions happen without any schema change, purely from a new parameter value compiling a bad-for-other-values plan; an index-related regression is caused by a genuine access-path change altering cost estimates — the fix for the former is often `OPTIMIZE FOR`/`RECOMPILE`, for the latter it's revisiting the index design.
4. Query Store's automatic plan regression detection/alerts (available in modern SQL Server versions), APM latency dashboards keyed to deploy markers, and a standard "index change" runbook requiring before/after `STATISTICS IO/TIME` comparison as part of code review.

#### 12. Common Mistakes
Assuming a new index can only help, never hurt, because "it's just an index." Dropping the index without ever confirming the causal mechanism, risking a repeat with the next "helpful" index. Not having deploy-time correlation between schema changes and APM alerts.

#### 13. Architect Insight
The discriminating trait here is treating index changes as *production changes with blast radius*, requiring the same rigor (staging validation, canary rollout, before/after measurement, rollback plan) as an application code deploy — not as a low-risk DBA housekeeping task.

---

## Part B: Query Performance & Execution Plans

### Q10. How do you read a SQL Server execution plan, and what's the difference between estimated and actual plans?

**Difficulty:** 🟡 Intermediate

#### 1. Interview Answer
An execution plan is a tree of physical operators (scans, seeks, joins, sorts, aggregates) that SQL Server's Query Optimizer chose to run a statement, read right-to-left, bottom-to-top for data flow, with each operator showing its estimated cost as a percentage of the total batch. The *estimated* plan is generated by the optimizer without running the query, using statistics-based row-count estimates only; the *actual* plan requires execution and additionally reports the true number of rows produced by each operator, actual execution counts, and runtime warnings (like implicit conversions or spills) — comparing estimated vs. actual rows at each operator is the single most useful diagnostic in the whole plan.

#### 2. SQL Query
```sql
SET STATISTICS XML ON;
SELECT o.OrderID, c.CustomerName
FROM Orders o JOIN Customers c ON c.CustomerID = o.CustomerID
WHERE o.OrderDate >= '2026-01-01';
SET STATISTICS XML OFF;
```

#### 3. Explain the Query
`SET STATISTICS XML ON` captures the actual execution plan as XML alongside the result set (equivalent to SSMS's "Include Actual Execution Plan" button); the plan XML records both estimated and actual row counts per operator, letting you diff them directly.

#### 4. Sample Data
Not applicable — this is a plan-capture technique, not a data query.

#### 5. Expected Output
A graphical (or XML) plan showing, e.g., `Index Seek (Orders) → Hash Match (Join) → Index Seek (Customers)`, each annotated with its cost percentage and estimated/actual row counts.

#### 6. Alternative Solutions
- **`SET SHOWPLAN_XML ON`** — shows only the *estimated* plan without executing the query at all; useful when you can't safely run the query against production data (e.g., it has side effects, or is prohibitively slow).
- **Query Store's plan viewer in SSMS** — best for historical/regression analysis (Q9), not just a single ad hoc capture.
- **Preferred**: actual plan (`STATISTICS XML`/SSMS "Include Actual Execution Plan") for any live investigation, since estimated-vs-actual divergence is the primary signal for most performance problems (Q15).

#### 7. Performance
Read the plan for: highest cost-percentage operators first, any operator where actual rows vastly exceed estimated rows (cardinality estimation problem, Q15), warning icons (implicit conversion, spilled sort/hash to `tempdb`), and the overall shape (are there unnecessary sorts or lookups that a different index would eliminate).

#### 8. Edge Cases
Cost percentages are *relative estimates*, not wall-clock time — a plan can show one operator at "80% cost" while actually running fast in absolute terms if the whole batch is cheap; always corroborate with actual duration/IO, not cost percentage alone. Triggers and cascading constraints run "invisibly" outside the plan you're looking at unless you capture them separately.

#### 9. Production Scenario
Every serious production slow-query investigation starts here — before touching indexes, code, or configuration, you capture and read the actual plan to know what's actually happening rather than guessing.

#### 10. Interview Follow-ups
1. Why would estimated and actual row counts differ significantly?
2. What do the yellow warning triangles in a graphical plan mean?
3. How do you get an actual plan for a query you can't safely execute against production?
4. What's a "spill to tempdb" and how do you spot it?

#### 11. Follow-up Answers
1. Stale statistics, parameter sniffing against an atypical value, non-SARGable predicates the optimizer can't estimate precisely, or complex multi-table join cardinality math compounding small errors — see Q15.
2. Common warnings: implicit conversion affecting cardinality/seek ability, no join predicate (unintended cross join), or a column with no statistics.
3. Run it against a restored copy/replica with representative data and volume, or capture the estimated plan only via `SHOWPLAN_XML`, understanding it won't reflect true runtime row counts.
4. A sort or hash operation that doesn't fit in its granted memory spills intermediate results to `tempdb`; visible in the actual plan as a warning on the Sort/Hash Match operator, and a strong signal to investigate memory grant sizing or reduce the row/column volume being sorted.

#### 12. Common Mistakes
Reading cost percentages as if they were absolute timings. Only ever looking at estimated plans in production troubleshooting. Ignoring warning icons.

#### 13. Architect Insight
Adequate candidates can name the operators; senior candidates diagnose from estimated-vs-actual divergence and warnings; principal candidates use the plan as one input alongside Query Store history, DMV wait stats, and `STATISTICS IO/TIME` to build a complete causal picture rather than fixating on the plan shape alone.

---

### Q11. What's the difference between a table scan, an index scan, and an index seek?

**Difficulty:** 🟢 Basic

#### 1. Interview Answer
A table scan reads every row of a heap (no clustered index) top to bottom. An index scan reads every row of an index (clustered or non-clustered) in leaf order, still touching every row — usually because no predicate exists that lets the optimizer narrow the search, or because a large fraction of rows are needed anyway. An index seek navigates the B+‑tree directly to the matching row(s) using the key, touching only the pages needed to satisfy the predicate — O(log n) plus the number of matching rows, versus O(n) for a scan.

#### 2. SQL Query
```sql
SELECT * FROM Orders;                              -- (Clustered) Index Scan
SELECT * FROM Orders WHERE CustomerID = 42;         -- Index Seek if CustomerID is indexed and selective
SELECT * FROM Orders WHERE YEAR(OrderDate) = 2026;  -- Scan, even with an index on OrderDate (non-SARGable, see Q18)
```

#### 3. Explain the Query
The first has no predicate, so every row must be read — a scan is not just acceptable but optimal here. The second, with a selective indexed equality predicate, seeks directly. The third wraps the indexed column in a function, which defeats seekability even though `OrderDate` is indexed — this is purely a query-authoring problem, not a missing-index problem.

#### 4. Sample Data
`Orders(OrderID, CustomerID, OrderDate)` with an index on `OrderDate`.

#### 5. Expected Output
Query 1 and 3 both produce scans; query 2 produces a seek — despite query 3 having an index available on the filtered column.

#### 6. Alternative Solutions
For query 3: rewrite as `WHERE OrderDate >= '2026-01-01' AND OrderDate < '2027-01-01'` — a SARGable range predicate that *can* seek on the same index, producing identical results with vastly better scalability as the table grows.

#### 7. Performance
A scan's cost grows linearly with table size regardless of how few rows match; a seek's cost is nearly flat as the table grows (logarithmic tree depth plus matching rows) — this divergence is exactly why "works fine in dev, times out in production" happens as tables grow past the point where a scan-based query used to be tolerable.

#### 8. Edge Cases
For very small tables, the optimizer may deliberately choose a scan over a seek even when an index exists, because reading the whole (tiny) table in one sequential pass is genuinely cheaper than the overhead of tree navigation — this is correct optimizer behavior, not a bug.

#### 9. Production Scenario
The `YEAR(OrderDate) = 2026` pattern is one of the most common real-world causes of a "sudden" performance cliff as a table crosses from small (scan is fine) to large (scan becomes the bottleneck) — see Q18 for the full SARGability treatment.

#### 10. Interview Follow-ups
1. Is a scan always bad?
2. Can an index seek still be slow?
3. What's a "range scan" versus a "seek," terminology-wise?
4. How would you find all non-SARGable predicates in an application's query set?

#### 11. Follow-up Answers
1. No — for small tables, or queries genuinely needing most/all rows (a report with no effective filter), a scan can be the optimizer's correct, cheapest choice.
2. Yes — a seek that matches millions of rows (a poorly selective predicate, Q5) still has to read and process all of them; "seek" describes the access method, not a performance guarantee.
3. SQL Server plans label both point lookups and contiguous-range reads as "Index Seek" — the seek predicate shown in the operator's properties clarifies whether it's an equality or a range.
4. Review Query Store/plan cache for scans on large tables that have a seemingly-relevant index available, and inspect those queries' `WHERE` clauses for functions wrapping columns, implicit conversions, or leading wildcards (`LIKE '%x'`).

#### 12. Common Mistakes
Assuming "scan" always means "missing index" without checking whether the predicate is even seekable. Assuming "seek" always means "fast."

#### 13. Architect Insight
The senior-level tell is immediately spotting that `YEAR(OrderDate) = 2026` is a query-authoring bug, not an indexing gap — junior debugging adds indexes; senior debugging reads the predicate first.

---

### Q12. What's a key lookup (bookmark lookup), and how do you eliminate it?

**Difficulty:** 🟡 Intermediate

#### 1. Interview Answer
A key lookup happens when a non-clustered index seek finds the matching rows but the query needs additional columns not present in that index, forcing a second seek per matching row into the clustered index (or a RID lookup into a heap) to fetch them. It's cheap for a handful of matches but becomes the dominant cost as match count grows, because it's effectively a nested-loop join executed once per row rather than a single set-based operation. ("Bookmark lookup" is the pre-2005 term for the same concept; modern plans show `Key Lookup` or `RID Lookup`.)

#### 2. SQL Query
```sql
-- Non-clustered index on CustomerID only
CREATE NONCLUSTERED INDEX IX_Orders_CustomerID ON dbo.Orders(CustomerID);

SELECT OrderID, OrderDate, TotalAmount
FROM Orders
WHERE CustomerID = 42;   -- Index Seek + Key Lookup (TotalAmount, OrderDate not in the index)
```

#### 3. Explain the Query
The seek on `IX_Orders_CustomerID` finds matching `OrderID`s (via the clustering key stored at the leaf) quickly, but `OrderDate` and `TotalAmount` aren't in that index, so a `Key Lookup` operator runs once per matched row against the clustered index to retrieve them — visible in the plan as a `Nested Loops` joining the seek to the lookup.

#### 4. Sample Data
Same `Orders` table; assume `CustomerID = 42` matches 5,000 rows out of 10 million.

#### 5. Expected Output
Correct results, but 5,000 individual lookup operations — noticeably slower than a covering-index plan for the same result set.

#### 6. Alternative Solutions
- **Add `INCLUDE (OrderDate, TotalAmount)`** to the existing index — turns it covering, eliminating the lookup entirely (Q3).
- **Leave it as-is** if the matched-row count is consistently small (a handful of rows) — the lookup cost is genuinely negligible at low cardinality, and adding `INCLUDE` has its own write-cost trade-off (Q7).
- **Preferred**: covering index via `INCLUDE`, specifically when Query Store/plan analysis shows this exact query pattern running frequently against a non-trivial match count.

#### 7. Performance
SSMS's plan will show the `Key Lookup`'s cost percentage directly, often surprisingly high relative to the seek itself once match counts climb into the thousands — this is the single most common "why is my seek-based query still slow" answer.

#### 8. Edge Cases
If the matched-row count varies wildly by parameter value (some customers have 5 orders, others 50,000), a plan compiled for the low-count case can perform terribly for the high-count case purely from lookup count — this interacts directly with parameter sniffing (Q16).

#### 9. Production Scenario
A "recent orders" widget querying by `CustomerID` across a growing `Orders` table is exactly this pattern; as the table and per-customer order counts grow, the same query's cost grows with it purely from lookup count, even though the index "exists."

#### 10. Interview Follow-ups
1. How do you spot a key lookup in a plan quickly?
2. Is a RID lookup worse than a key lookup?
3. Does adding INCLUDE always help?
4. What's the relationship between key lookups and parameter sniffing?

#### 11. Follow-up Answers
1. Look for a `Key Lookup` or `RID Lookup` operator joined to the seek via `Nested Loops`, and check its cost percentage in the plan.
2. Generally comparable in mechanism, but a RID lookup (heap) uses a physical page/slot address, which can go stale via forwarding pointers (Q1) — an extra potential hop the key-lookup-via-clustered-index path doesn't have.
3. No — it trades read cost for write cost (Q7); only worth it when the query is frequent/costly enough to justify the wider index.
4. A plan compiled for a low-match-count parameter value may keep the seek+lookup strategy even when a later, high-match-count value makes a full scan objectively cheaper — the lookup count is precisely the mechanism by which a "good" plan for one parameter becomes catastrophic for another.

#### 12. Common Mistakes
Not noticing the lookup operator at all and only looking at the seek. Adding `INCLUDE` reflexively without checking whether match counts justify it.

#### 13. Architect Insight
Recognizing that the lookup's cost scales with *match count, not table size*, and that this is precisely the variable that makes the same query fast for some parameter values and slow for others, is the connective insight that ties indexing, plan-reading, and parameter sniffing together — exactly the kind of cross-topic synthesis a principal-level answer demonstrates.

---

### Q13. What causes a Sort operator to spill to tempdb, and how do you fix it?

**Difficulty:** 🔴 Senior

#### 1. Interview Answer
SQL Server estimates how much memory a Sort (or Hash Match) operator will need based on estimated row count and row width, and requests that memory grant up front before execution starts. If the *actual* row count or width significantly exceeds the estimate — most often from stale statistics, parameter sniffing, or a non-SARGable predicate producing a much larger intermediate set than predicted — the operator runs out of its granted memory and spills intermediate data to `tempdb`, which is dramatically slower than an in-memory sort and shows as an explicit warning on the operator in the actual execution plan.

#### 2. SQL Query
```sql
SELECT OrderID, CustomerID, TotalAmount
FROM Orders
ORDER BY TotalAmount DESC;   -- large sort if Orders has no useful index for this order
```

#### 3. Explain the Query
Without an index on `TotalAmount`, SQL Server must sort the entire result set in a Sort operator; if `Orders` has 50 million rows and the memory grant (sized from statistics) undershoots the actual row count, the sort spills.

#### 4. Sample Data
Not meaningfully representable at small scale — this is a scale-dependent phenomenon.

#### 5. Expected Output
Correct sorted results, but with a `Sort Warning` in the actual plan and dramatically higher duration than the granted-memory estimate would predict.

#### 6. Alternative Solutions
- **Add a supporting index on the sort column** — turns an explicit Sort operator into an `Index Scan`/`Seek` that already returns rows in order, eliminating the sort entirely; the strongest fix when the column is queried this way often.
- **Update statistics** if the estimate was simply stale, so the memory grant is sized correctly even though a Sort operator still runs.
- **Increase `tempdb` file count/placement on fast storage** as a mitigation for spills that can't be eliminated (e.g., genuinely ad hoc sort columns) — treats the symptom, not the cause, but is a legitimate operational lever.
- **Preferred**: eliminate the sort via indexing when the access pattern is known and recurring; only tune `tempdb`/memory grants for genuinely unpredictable ad hoc sorts.

#### 7. Performance
Verify via the actual plan's Sort operator properties (memory grant used vs. granted, spill level) or `sys.dm_exec_query_memory_grants` while the query runs — don't assume a spill from symptoms (slow query) alone without confirming the operator warning.

#### 8. Edge Cases
Multiple concurrent large sorts can exhaust `tempdb`'s configured space entirely, causing outright query failures for unrelated sessions sharing the same `tempdb` — a spill isn't just slow, at scale it's a shared-resource risk across the whole instance.

#### 9. Production Scenario
An ad hoc reporting query newly added to a dashboard, sorting a large unindexed result set, can silently degrade the whole instance's `tempdb` throughput for every other concurrent workload — a classic "one bad report query" incident.

#### 10. Interview Follow-ups
1. How do you see the memory grant size for a query before it runs?
2. Does a Hash Match operator have the same spill risk?
3. What's the relationship between spills and parameter sniffing?
4. How do you monitor for spills instance-wide, not just per query?

#### 11. Follow-up Answers
1. The estimated plan shows a `MemoryGrantInfo` element (visible via the plan XML or operator properties) reflecting the optimizer's row/width estimate at compile time.
2. Yes — Hash Match (used in hash joins and hash aggregates) builds an in-memory hash table sized similarly from estimates and spills partitions to `tempdb` under the same estimate-vs-actual mismatch conditions.
3. A plan compiled for a small parameter value gets a small memory grant; if a later execution reuses that plan for a much larger parameter value, the undersized grant causes a spill purely from plan reuse, not from stale statistics — another concrete parameter-sniffing symptom (Q16).
4. `sys.dm_exec_query_memory_grants` for current grants, and Extended Events (`sort_warning`/`hash_warning`) or Query Store wait-stats categorization for historical/aggregate spill tracking across the whole instance.

#### 12. Common Mistakes
Diagnosing a slow query as "needs more memory" without checking whether an index could eliminate the sort altogether. Not distinguishing a genuine one-off ad hoc spill from a recurring, indexable pattern.

#### 13. Architect Insight
The principal-level answer treats a spill as a symptom with several distinct possible root causes (statistics, sniffing, missing index, genuinely unpredictable ad hoc access) and picks the fix that matches the actual cause, rather than reaching for "increase memory" or "add more tempdb files" as a universal first response.

---

### Q14. When does SQL Server choose a hash join versus a nested-loop join versus a merge join?

**Difficulty:** 🔴 Senior

#### 1. Interview Answer
Nested loops: best when one input is small and the other is large but has a usable index on the join column — for each outer row, seek the inner input; cheapest in I/O when the outer side is genuinely small. Merge join: best when both inputs are already sorted on the join key (e.g., both delivered via ordered index scans) — a single synchronized pass through both sorted streams, very efficient, but requires that sort order (or pays to create it). Hash join: best when inputs are large and unsorted, and/or their sizes differ significantly — builds an in-memory hash table from the smaller ("build") input, then probes it with the larger ("probe") input; the general-purpose workhorse for large, unindexed joins, at the cost of needing memory (Q13) and full materialization of the build side before probing starts.

#### 2. SQL Query
```sql
SELECT o.OrderID, c.CustomerName
FROM Orders o
JOIN Customers c ON c.CustomerID = o.CustomerID
WHERE o.OrderDate >= '2026-01-01';
```

#### 3. Explain the Query
If `Orders` is filtered down to a small set via an index seek on `OrderDate`, and `Customers` has an index on `CustomerID`, the optimizer likely picks nested loops (small filtered outer, indexed inner seek). If the filter is much less selective and both sides are large, it likely picks a hash join instead.

#### 4. Sample Data
`Orders`: 10 million rows, ~2,000 match the date filter. `Customers`: 500,000 rows, indexed on `CustomerID`.

#### 5. Expected Output
With the numbers above, nested loops (2,000 outer-side seeks into an indexed `Customers`) beats building a 500,000-row hash table for a 2,000-row probe.

#### 6. Alternative Solutions
- **Force a join type via hint (`INNER HASH JOIN`, `INNER LOOP JOIN`, `INNER MERGE JOIN`)** — occasionally justified when the optimizer's cardinality estimate is provably wrong and can't be fixed by updating statistics, but it's a targeted, documented override, not a default habit.
- **Rewrite to change the effective input sizes** (filter earlier, pre-aggregate) so the optimizer's natural cost-based choice improves without forcing anything.
- **Preferred**: trust the cost-based choice by default; only override with a hint after confirming (via the plan) that the estimate, not the join algorithm choice logic itself, is the actual problem.

#### 7. Performance
Nested loops scale with `outer rows × inner seek cost` — bad if the "small" side turns out large. Hash join scales with `build input size` for memory and I/O if it spills (Q13). Merge join is cheapest when sort order is free (already indexed that way) and expensive if SQL Server must add explicit Sort operators to enable it — check the plan for whether the merge join's inputs required additional sorts.

#### 8. Edge Cases
A nested loop join against a table lacking a usable index on the join column effectively becomes "seek-less," degrading to a scan per outer row — catastrophic; this is what index hints or forced nested loops can accidentally cause if applied without checking both sides are properly indexed.

#### 9. Production Scenario
Reporting queries joining a large fact table to a large dimension table with no effective filter are the classic hash-join case; point-lookup transactional queries joining a filtered small set to an indexed reference table are the classic nested-loop case — recognizing which shape a query has predicts which join type is appropriate before even looking at the plan.

#### 10. Interview Follow-ups
1. Why might the optimizer choose the "wrong" join type?
2. What's an adaptive join (batch mode)?
3. Can you have a hash join between three tables in one plan?
4. How does join type choice relate to parallelism?

#### 11. Follow-up Answers
1. Usually cardinality misestimation (Q15) — the optimizer picked correctly for its estimated row counts, but the estimates themselves were wrong, which is a statistics/predicate problem, not a join-algorithm bug.
2. SQL Server's Adaptive Join operator (batch-mode, available on modern versions) defers the nested-loop-vs-hash-join choice until after seeing the actual row count of the build input at runtime, mitigating exactly the misestimation risk described above for that specific decision point.
3. A single plan can have multiple binary join operators (each joining two inputs) chained together, so a three-table query might show two hash joins, or a mix of hash and nested loops, depending on each pairwise input's characteristics.
4. Hash joins parallelize well (each thread can build/probe a partition of the hash table); nested loops parallelize less naturally per-row but can still run in parallel across independent outer-row partitions — join type and degree-of-parallelism decisions interact in the optimizer's overall plan search.

#### 12. Common Mistakes
Assuming one join type is universally "best." Forcing a join hint without first confirming the cardinality estimate was the actual problem. Not checking whether a merge join's apparent efficiency is actually paid for by hidden Sort operators earlier in the plan.

#### 13. Architect Insight
A senior candidate can explain when each join type is theoretically preferred; a principal candidate reads the actual plan, identifies which cost driver (estimate error vs. genuine algorithm mismatch) is at play, and picks the narrowest possible fix — usually statistics or an index, only rarely a hint.

---

### Q15. What is cardinality estimation, how does it use statistics, and what makes it go wrong?

**Difficulty:** 🔥 Architect

#### 1. Interview Answer
Cardinality estimation is the optimizer's prediction of how many rows will flow out of each operator in a candidate plan, derived from column/index statistics — primarily a histogram (up to 200 steps) capturing the data distribution, plus density information for multi-column correlation. These estimates drive every downstream decision: join type (Q14), memory grants (Q13), seek-vs-scan (Q11), and parallelism degree. It goes wrong from: stale statistics (data has changed materially since the last auto-update, which triggers at a percentage-of-rows-modified threshold, not immediately); parameter sniffing (Q16) compiling for an atypical value; correlated columns the optimizer assumes are independent (e.g., `City = 'New York'` and `State = 'NY'` — multiplying their individual selectivities underestimates the true match count since they're not independent); and non-SARGable predicates (Q18) the optimizer can't estimate precisely from a histogram at all, falling back to a fixed guess.

#### 2. SQL Query
```sql
DBCC SHOW_STATISTICS ('dbo.Orders', 'IX_Orders_CustomerID_OrderDate') WITH HISTOGRAM;

SELECT OBJECT_NAME(object_id), stats_id, last_updated, rows, rows_sampled, modification_counter
FROM sys.dm_db_stats_properties(OBJECT_ID('dbo.Orders'), NULL);
```

#### 3. Explain the Query
`DBCC SHOW_STATISTICS ... WITH HISTOGRAM` shows the actual step values and row-count estimates the optimizer will use for that index's leading column. `sys.dm_db_stats_properties` shows how stale the statistics are (`last_updated`) and how much the underlying data has changed since (`modification_counter`) relative to `rows` — the direct diagnostic for "are my statistics stale."

#### 4. Sample Data
| RANGE_HI_KEY | RANGE_ROWS | EQ_ROWS | DISTINCT_RANGE_ROWS |
|---|---|---|---|
| 2026-01-01 | 120,000 | 3,500 | 28 |
| 2026-02-01 | 118,000 | 4,100 | 27 |

#### 5. Expected Output
For a predicate `OrderDate = '2026-02-01'`, the optimizer estimates `4,100` rows directly from `EQ_ROWS`; for a range query between the two boundaries, it interpolates from `RANGE_ROWS`/`DISTINCT_RANGE_ROWS`.

#### 6. Alternative Solutions
- **`UPDATE STATISTICS ... WITH FULLSCAN`** — most accurate, most expensive; reserved for critical tables or after bulk loads.
- **Rely on auto-update** (default) — sufficient for most tables, but the trigger threshold is a percentage of rows changed, which means very large tables can go a long time between auto-updates in absolute row terms; modern SQL Server versions improved this with more granular auto-update thresholds, but it should still be verified per table/version rather than assumed sufficient.
- **`OPTION (RECOMPILE)`** or **`OPTIMIZE FOR`** hints to address parameter-specific estimation issues directly (Q16) rather than fighting statistics quality in general.
- **Preferred**: auto-update as the default, with explicit `FULLSCAN` updates scheduled after large bulk operations (ETL loads, bulk deletes) that wouldn't otherwise cross the auto-update threshold promptly, plus targeted per-query hints for the specific parameter-sniffing cases statistics quality alone can't fix.

#### 7. Performance
Always compare estimated vs. actual rows per operator (Q10) as the direct evidence of a cardinality problem — don't infer it indirectly from slow duration alone, since slow duration has many other possible causes (blocking, missing index, hardware).

#### 8. Edge Cases
Multi-statement table-valued functions and table variables (pre-2019, without the `RECOMPILE`-triggering "table variable deferred compilation" improvement in later versions) have historically had very poor or fixed-guess cardinality estimates regardless of statistics — a specific, well-known trap worth naming explicitly in an interview.

#### 9. Production Scenario
A nightly batch job that bulk-inserts millions of rows and is immediately followed by application queries against that data can hit exactly this: statistics from before the load are now wildly stale, and the auto-update threshold hasn't fired yet, producing terrible estimates and plan choices for the first queries after the load until either auto-update catches up or a forced update is run as part of the ETL pipeline itself.

#### 10. Interview Follow-ups
1. What's the auto-update statistics threshold, roughly?
2. How do correlated columns cause estimation errors, concretely?
3. What are multi-column statistics and when do you create them manually?
4. How does the new (2014+) cardinality estimator differ from the legacy one?

#### 11. Follow-up Answers
1. Historically a fixed ~20% of rows changed (plus a smaller fixed component) triggers auto-update; this can mean enormous absolute row counts change on very large tables before an update fires — worth verifying the specific behavior/trace flags or database-scoped configuration for the SQL Server version in use rather than quoting one number as universal.
2. The optimizer's default assumption is independence between predicates on different columns, so it multiplies their individual selectivities together — if `City` and `State` are correlated (as they obviously are), this underestimates rows matching both, sometimes drastically.
3. Manually created multi-column statistics (`CREATE STATISTICS`) or filtered statistics can capture correlation the optimizer wouldn't otherwise model; used when a specific known-correlated predicate combination is a recurring, high-value query pattern with observed estimation errors.
4. The 2014+ cardinality estimator changed several core assumptions (e.g., how it handles ascending key/out-of-date-statistics scenarios and multi-predicate correlation) and can produce different — not universally better — estimates than the legacy (pre-2014) model; database compatibility level controls which model is used, which is itself a common source of "why did upgrading SQL Server change my plans" incidents.

#### 12. Common Mistakes
Treating "update statistics" as a cure-all without checking whether the real problem is parameter sniffing or a non-SARGable predicate instead. Assuming correlated-column estimation errors are bugs rather than a documented, name-able optimizer limitation.

#### 13. Architect Insight
This is one of the highest-value topics in the whole workbook for separating tiers: an adequate answer says "statistics help the optimizer estimate rows"; a senior answer explains the histogram mechanism and staleness; a principal/architect answer names the *specific* failure modes (correlation, parameter sniffing, non-SARGability, cardinality-estimator-version changes) and matches each to its distinct fix, because conflating them leads to the wrong remediation.

---

### Q16. What is parameter sniffing, and how do you fix a query that's fast for one parameter value but slow for another?

**Difficulty:** 🔥 Architect

#### 1. Interview Answer
When SQL Server compiles a parameterized query or stored procedure, it "sniffs" the actual parameter value(s) supplied on that first compilation and builds a plan optimized for that specific value's cardinality — then caches and reuses that plan for subsequent calls with different values. This is usually beneficial (plan reuse avoids recompilation cost), but becomes a problem when the data distribution is skewed enough that the plan optimal for one value (e.g., a rare `Status`) is badly wrong for another (e.g., a common `Status`) — most visibly when a low-cardinality value compiles a nested-loop/seek plan that then runs with thousands of key lookups for a high-cardinality value passed later. Fixes, from least to most invasive: `OPTIMIZE FOR <typical value>` (or `OPTIMIZE FOR UNKNOWN`, which uses average density instead of a sniffed value) to compile a "safe average" plan; `OPTION (RECOMPILE)` to compile fresh every execution (trades CPU for plan correctness, best for genuinely highly-variable parameters); splitting into separate statements/procedures per parameter-value class if the skew is bimodal; or, in SQL Server 2022+, Parameter Sensitive Plan (PSP) optimization, which lets the engine automatically cache multiple plans for different parameter value "buckets" for the same query.

#### 2. SQL Query
```sql
CREATE OR ALTER PROCEDURE dbo.GetTransactionsByStatus
    @Status VARCHAR(20)
AS
BEGIN
    SELECT TransactionID, AccountID, Amount
    FROM Transactions
    WHERE Status = @Status
    OPTION (RECOMPILE);   -- or OPTIMIZE FOR (@Status = 'PENDING')
END;
```

#### 3. Explain the Query
`OPTION (RECOMPILE)` forces a fresh compile using the actual runtime value of `@Status` every single execution, guaranteeing a correctly-estimated plan for whichever value is passed at the cost of compilation CPU on every call — the right trade when execution frequency is low-to-moderate and correctness matters more than compile overhead; for high-frequency execution, `OPTIMIZE FOR` a representative "worst common case" value is usually the better trade.

#### 4. Sample Data
`Transactions.Status`: `SUCCESS` 9.5M rows, `PENDING` 100K rows.

#### 5. Expected Output
Without a fix: a plan compiled first for `@Status = 'PENDING'` (seek + few lookups) runs disastrously for `@Status = 'SUCCESS'` (seek + 9.5M lookups) if reused as-is; with `OPTION (RECOMPILE)`, each call gets a plan matched to its actual value (a scan for `SUCCESS`, a seek for `PENDING`).

#### 6. Alternative Solutions
- **`OPTIMIZE FOR UNKNOWN`** — compiles using average statistics density rather than any specific sniffed value, giving a consistent "average" plan; good when no single value is representative and consistency matters more than optimality for any one value.
- **Plan guides / Query Store forced plans** — apply a fix without changing application code, useful when you can't modify the query/procedure directly (third-party app).
- **PSP optimization (2022+)** — lets the engine handle it automatically for eligible query shapes, reducing the need for manual hints, but should still be monitored, not treated as a silent fix-all.
- **Preferred**: `OPTION (RECOMPILE)` for low/moderate-frequency, highly-skewed-parameter procedures; `OPTIMIZE FOR` a chosen typical value for high-frequency ones where recompilation cost would itself become a bottleneck; PSP as a modern-version safety net, still monitored via Query Store.

#### 7. Performance
Confirm the diagnosis via Query Store: look for one `query_id` with multiple plans and wildly different `avg_duration`/`avg_logical_io_reads` across executions — that variance across executions of the *same query text* with different plans is the direct fingerprint of a parameter-sniffing problem, distinct from a generally-slow query that's uniformly slow.

#### 8. Edge Cases
`OPTION (RECOMPILE)` also means the query never benefits from plan cache reuse, so extremely high-frequency (thousands of calls/second) procedures can turn compilation CPU itself into the new bottleneck — this is exactly why "always just recompile" isn't the universal answer.

#### 9. Production Scenario
A stored procedure serving a customer support dashboard's "show all transactions with status X" that is fast in QA (tested only against the common status) and suddenly a support agent filters by a rare status, or vice versa in production, and the app times out — a very common, very real production incident traced back to exactly this mechanism.

#### 10. Interview Follow-ups
1. How is this different from cardinality estimation in general (Q15)?
2. What triggers a stored procedure's plan to be evicted/recompiled naturally?
3. What's the risk of OPTIMIZE FOR a specific literal value?
4. How does ad hoc/inline SQL (not a stored procedure) experience parameter sniffing differently?

#### 11. Follow-up Answers
1. Cardinality estimation (Q15) is the general mechanism of predicting row counts from statistics; parameter sniffing is a specific, narrower failure mode of that mechanism where the *compiled* plan is fine for the sniffed value but wrong for a different value at *reuse* time — the estimation itself wasn't wrong for the value it saw.
2. Statistics updates on referenced objects, explicit `sp_recompile`, schema changes to referenced objects, plan cache memory pressure evicting the plan, or server restart/failover.
3. If the chosen literal's typical distribution shifts over time (business changes), the hardcoded `OPTIMIZE FOR` value can silently become wrong and needs periodic review — it's a targeted fix, not a "set and forget" one.
4. Ad hoc/inline SQL without forced parameterization is compiled per distinct literal text by default (each `Status = 'PENDING'` vs. `Status = 'SUCCESS'` literal is its own cache entry), so it doesn't suffer classic parameter sniffing the same way — but it instead risks plan cache bloat from too many single-use plans, a different but related performance problem (Q17).

#### 12. Common Mistakes
Diagnosing every "sometimes slow" query as parameter sniffing without confirming via Query Store's multi-plan evidence. Applying `OPTION (RECOMPILE)` universally without weighing the CPU cost at the procedure's actual call frequency.

#### 13. Architect Insight
This is consistently one of the highest-frequency real interview questions at this level because it's where textbook optimizer knowledge meets production judgment — the discriminator is picking the *right* fix (recompile vs. optimize-for vs. splitting logic vs. PSP) for the specific frequency/skew profile, not just naming that "parameter sniffing" is the cause.

---

### Q17. What is plan cache pollution, and how do ad hoc queries cause it?

**Difficulty:** 🔴 Senior

#### 1. Interview Answer
The plan cache stores compiled plans keyed by the exact query text (for ad hoc SQL) or object identity (for stored procedures/parameterized queries), so it can skip recompilation on reuse. Ad hoc SQL built by string-concatenating literal values directly into the query text (a common anti-pattern, and also a SQL-injection risk) produces a distinct cache entry for every unique literal combination, even though the query *shape* is identical — thousands of single-use, never-reused plans bloat the cache, consuming memory that would otherwise hold genuinely reusable plans, and adding compilation CPU overhead on every call since nothing is ever actually reused.

#### 2. SQL Query
```sql
-- Anti-pattern: produces a new cache entry per CustomerID value
EXEC sp_executesql N'SELECT * FROM Orders WHERE CustomerID = 42';
EXEC sp_executesql N'SELECT * FROM Orders WHERE CustomerID = 43';

-- Fix: parameterized, one reusable cache entry for any CustomerID
EXEC sp_executesql N'SELECT * FROM Orders WHERE CustomerID = @CustomerID',
    N'@CustomerID INT', @CustomerID = 42;
```

#### 3. Explain the Query
The first form's query text literally differs per call (`42` vs `43`), so SQL Server treats them as unrelated statements needing separate plans; the second form has one fixed query text with a parameter marker, so every call regardless of `@CustomerID`'s value reuses the same cached plan (subject to the parameter-sniffing trade-offs of Q16).

#### 4. Sample Data
Not applicable — a plan-cache behavior, not a data query.

#### 5. Expected Output
Monitoring `sys.dm_exec_cached_plans` after the anti-pattern shows `usecounts = 1` for a large number of distinct, near-identical plans; after the fix, one plan with a high `usecounts`.

#### 6. Alternative Solutions
- **`sp_executesql` with parameters** (shown above) — the standard, correct fix at the application/query-construction level.
- **Forced parameterization** (`ALTER DATABASE ... SET PARAMETERIZATION FORCED`) — a database-wide setting that makes SQL Server auto-parameterize literals in ad hoc queries even if the application doesn't; a blunt instrument that can itself cause unwanted parameter sniffing on queries that actually benefited from literal-specific plans, so applied cautiously and tested, not as a default.
- **Preferred**: fix query construction to use parameters (ORM/data-access-layer level, e.g., proper use of parameterized `SqlCommand` in ADO.NET/EF Core) — the root-cause fix; forced parameterization only as a stopgap for third-party applications that can't be changed.

#### 7. Performance
Check `sys.dm_exec_cached_plans` grouped by `objtype = 'Adhoc'` and `usecounts = 1` count and total cache memory (`sys.dm_os_memory_clerks` for `CACHESTORE_SQLCP`) to quantify the actual pollution before and after a fix — don't assume it's the cause of memory pressure without measuring.

#### 8. Edge Cases
The "optimize for ad hoc workloads" server-level setting mitigates the *memory* cost specifically by only caching a lightweight stub on first execution (a full plan is only cached on the second execution of the exact same text) — a legitimate low-risk instance-level configuration for workloads dominated by genuinely single-use ad hoc queries, distinct from fixing the query construction itself.

#### 9. Production Scenario
A poorly-built reporting/search feature that concatenates every filter value directly into SQL text (often alongside a SQL-injection vulnerability, which should be flagged as a separate, more urgent finding) is a frequent real-world source of both plan cache bloat and a security defect discovered in the same code review.

#### 10. Interview Follow-ups
1. How is this different from parameter sniffing (Q16)?
2. What's "optimize for ad hoc workloads" and when would you enable it?
3. Does this affect stored procedures the same way?
4. How would you detect this in an existing production system?

#### 11. Follow-up Answers
1. They're near-opposite failure modes of the same mechanism: parameter sniffing is *too much* reuse of a plan that's wrong for some values; plan cache pollution is *too little* reuse because queries are needlessly distinct — the fix directions are correspondingly different (recompile/optimize-for vs. parameterize).
2. A server-level configuration that defers full plan caching until a query's exact text is seen twice; enable it on instances dominated by genuine single-use ad hoc SQL to reduce memory pressure from single-use plan bloat, with minimal downside for workloads that do have legitimately reusable parameterized queries.
3. No — stored procedures and `sp_executesql` calls are parameterized by construction (the procedure/statement signature is fixed), so they don't suffer this specific pollution mode; the risk is specific to string-concatenated ad hoc SQL.
4. Query `sys.dm_exec_cached_plans` joined to `sys.dm_exec_sql_text`, group by a normalized form of the query text (stripping literals) to spot large families of near-identical single-use entries, and check total ad hoc cache memory via `sys.dm_os_memory_clerks`.

#### 12. Common Mistakes
Building SQL via string concatenation for "just this one report." Confusing plan cache pollution with parameter sniffing and applying the wrong fix (e.g., `OPTION (RECOMPILE)` doesn't address cache bloat from ad hoc text variation).

#### 13. Architect Insight
Recognizing that this is fundamentally an application/data-access-layer discipline issue (parameterize at the source) rather than a database-tunable setting is the principal-level framing — server-level mitigations like "optimize for ad hoc workloads" manage the symptom for workloads you can't change, they don't fix the underlying anti-pattern.

---

### Q18. What makes a predicate SARGable, and what common patterns break it?

**Difficulty:** 🔴 Senior

#### 1. Interview Answer
"SARGable" (Search ARGument-able) means the predicate is written in a form the optimizer can evaluate directly against an index's B+‑tree structure via a seek, rather than needing to evaluate a function or expression against every row first. Breaking patterns: wrapping the indexed column in a function (`WHERE YEAR(OrderDate) = 2026`, `WHERE UPPER(Name) = 'X'`); implicit data-type conversions where the column's type differs from the literal/parameter's type, forcing SQL Server to convert the column (not the literal) to compare them, especially common with `VARCHAR`-vs-`NVARCHAR` mismatches; a leading wildcard in `LIKE` (`LIKE '%smith'`); and arithmetic on the column itself (`WHERE Price * 1.1 > 100`). Each defeats seeking because the optimizer can't use the index's sort order to jump directly to matching values without first computing the expression for every row.

#### 2. SQL Query
```sql
-- Non-SARGable (function on the column)
SELECT * FROM Orders WHERE YEAR(OrderDate) = 2026;

-- SARGable equivalent
SELECT * FROM Orders WHERE OrderDate >= '2026-01-01' AND OrderDate < '2027-01-01';

-- Non-SARGable (implicit conversion: Name is VARCHAR, literal is NVARCHAR via N'' or driver default)
SELECT * FROM Customers WHERE Name = N'Smith';

-- SARGable (matching types)
SELECT * FROM Customers WHERE Name = 'Smith';
```

#### 3. Explain the Query
`YEAR(OrderDate) = 2026` must compute `YEAR()` for every row before it can compare, ignoring any index on `OrderDate` entirely; the range rewrite lets the optimizer seek directly to the `2026-01-01` boundary and range-scan forward. The `NVARCHAR` literal against a `VARCHAR` column forces an implicit conversion of the *column* (per SQL Server's data type precedence rules, the lower-precedence type converts), which similarly defeats seeking on a `VARCHAR` index.

#### 4. Sample Data
`Customers(Name VARCHAR(100))` with an index on `Name`; application code (e.g., via ADO.NET/EF Core sending `NVARCHAR` parameters by default) causes the implicit conversion invisibly, without any application-visible symptom besides slowness.

#### 5. Expected Output
The non-SARGable forms return correct results but via a scan; the SARGable rewrites return identical results via a seek.

#### 6. Alternative Solutions
- **Computed column + index on the computed column** (e.g., a persisted `OrderYear AS YEAR(OrderDate)` column, indexed) — lets you keep the function-based query shape if the application layer can't be changed, at the cost of schema complexity and an extra maintained column.
- **Fix the query/parameter types directly** — the cleanest fix, and the only one that also avoids the implicit-conversion variant of this problem.
- **Preferred**: fix the predicate/parameter type at the source; reserve computed-column indexes for cases where the expression is genuinely needed in many different queries and rewriting all of them isn't practical.

#### 7. Performance
Confirm via the actual plan: an implicit conversion shows an explicit warning icon on the affected operator in modern SSMS versions, directly naming the conversion — don't rely on inference alone when the plan will tell you outright.

#### 8. Edge Cases
`VARCHAR`/`NVARCHAR` mismatches are especially insidious because they produce *correct results* and no error — purely a silent performance defect, often introduced by an ORM's default parameter type inference (e.g., .NET strings default to `NVARCHAR` unless explicitly typed), which is why this specific pattern deserves explicit attention in a .NET-heavy shop.

#### 9. Production Scenario
A .NET application using Entity Framework (or raw ADO.NET) against `VARCHAR` columns without explicitly specifying `SqlDbType.VarChar` on parameters is one of the most common real-world SARGability defects in exactly this codebase's stack — worth naming directly given the candidate's C#/.NET background.

#### 10. Interview Follow-ups
1. Why does SQL Server convert the column instead of the literal in a type mismatch?
2. How do you find all non-SARGable predicates in an existing codebase?
3. Is `LIKE '%smith%'` always non-SARGable?
4. Does a SARGable rewrite always produce an identical result set to the original?

#### 11. Follow-up Answers
1. Per Data Type Precedence rules, the value with lower precedence converts to the higher-precedence type — `NVARCHAR` outranks `VARCHAR`, so the `VARCHAR` column (not the `NVARCHAR` literal) is what gets implicitly converted for every row, defeating its index.
2. Review Query Store/plan cache for scans on indexed columns, check actual plans for implicit-conversion warnings, and audit ORM parameter type mapping (in .NET, confirm `SqlParameter.SqlDbType` matches the column type) as a systematic code-review item.
3. Yes for a leading wildcard (`%smith`) — no way to seek since any value could match; a trailing-only wildcard (`smith%`) *is* SARGable, since it can seek to the `smith` prefix and range-scan forward.
4. Almost always yes if done correctly (the date-range rewrite is logically equivalent to the `YEAR()` filter for a full calendar year), but care is needed at boundaries (off-by-one on date ranges, case-sensitivity differences if collation matters) — always verify equivalence, don't just assume it.

#### 12. Common Mistakes
Wrapping indexed columns in functions out of habit for readability. Letting an ORM infer parameter types without verifying they match column types. Assuming any `LIKE` usage is automatically non-SARGable.

#### 13. Architect Insight
This is a favorite because it's cheap to test live in an interview (dictate a query, ask "is this SARGable, why, fix it") and cleanly separates candidates who've internalized *why* certain forms defeat seeking (data type precedence, index structure) from those who've only memorized "don't use functions on columns" as a rule without the underlying mechanism.

---

### Q19. How do OR conditions, LIKE, and pagination each create their own distinct performance problems, and how do you fix each?

**Difficulty:** 🔴 Senior

#### 1. Interview Answer
**OR conditions** across different columns often prevent a single index seek because no one index covers both branches efficiently — SQL Server may need an index union/concatenation (`Index Seek` + `Index Seek` combined via `Concatenation`/`Merge`) or fall back to a scan; rewriting as `UNION` of two seek-friendly queries, or restructuring to a single `IN` list when the OR is on the same column, often performs far better than the OR form. **`LIKE`** is SARGable only for patterns with a fixed, non-wildcard prefix (`'smith%'`); a leading wildcard (`'%smith'`) can't seek and forces a scan — full-text search or a trigram/dedicated search index is the correct tool for genuine substring search at scale, not `LIKE '%x%'` against a B+‑tree index. **Pagination** via `OFFSET n ROWS FETCH NEXT m ROWS ONLY` re-scans and discards the first `n` rows on every page request — cheap for early pages, increasingly expensive (`O(n)`) for deep pages; keyset/seek pagination (`WHERE OrderID < @LastSeenOrderID ORDER BY OrderID DESC`) instead seeks directly to the continuation point, staying `O(log n)` regardless of page depth.

#### 2. SQL Query
```sql
-- OR across columns: often better as UNION
SELECT OrderID FROM Orders WHERE CustomerID = 42
UNION
SELECT OrderID FROM Orders WHERE OrderDate = '2026-01-01';

-- Deep OFFSET pagination (page 10,000): expensive
SELECT OrderID, OrderDate FROM Orders ORDER BY OrderID
OFFSET 100000 ROWS FETCH NEXT 20 ROWS ONLY;

-- Keyset pagination: cheap regardless of depth
SELECT TOP (20) OrderID, OrderDate FROM Orders
WHERE OrderID < @LastSeenOrderID
ORDER BY OrderID DESC;
```

#### 3. Explain the Query
The `UNION` form lets each branch seek its own index independently, then deduplicates the combined result — often cheaper than a single scan-based OR, provided both columns are separately indexed. The `OFFSET` query must count through and discard 100,000 rows in index order before returning the next 20 — cost grows with page depth. The keyset form seeks directly to `OrderID < @LastSeenOrderID` and takes the next 20 — constant cost regardless of how "deep" into the dataset that continuation point is.

#### 4. Sample Data
`Orders` with 10 million rows, `OrderID` clustered/indexed ascending.

#### 5. Expected Output
All three pagination-style queries return correct, consistent-shape results, but `OFFSET 100000` measurably costs more than `OFFSET 20`, while the keyset query's cost stays flat regardless of the `@LastSeenOrderID` value.

#### 6. Alternative Solutions
- **For OR**: a computed/indicator column combining conditions, or restructuring the query into an `IN` list when possible, are lighter alternatives to `UNION` when applicable; `UNION ALL` (not `UNION`) if you can guarantee the branches are mutually exclusive, to skip the deduplication cost.
- **For LIKE**: SQL Server Full-Text Search (`CONTAINS`/`FREETEXT`) for substring/word search at scale; a computed reversed-string column indexed separately can support suffix (`'%smith'`) matches specifically, as a narrower alternative to full-text search.
- **For pagination**: keyset/seek pagination is preferred whenever the UI supports "next page" style navigation without needing arbitrary jump-to-page-N; `OFFSET`/`FETCH` remains acceptable for shallow pagination (first several pages) or when arbitrary page-number jumping is a hard UI requirement.
- **Preferred**: UNION for genuinely different-column ORs; full-text search for real substring search; keyset pagination as the default for infinite-scroll/next-page UIs, `OFFSET`/`FETCH` reserved for shallow, page-number-driven UIs.

#### 7. Performance
Verify the OR rewrite actually improves the plan (compare logical reads via `STATISTICS IO` before/after — `UNION` isn't automatically better if the columns aren't well-indexed separately). For pagination, directly compare `STATISTICS IO`/duration at a shallow offset versus a deep offset to demonstrate the `O(n)` growth concretely rather than asserting it.

#### 8. Edge Cases
Keyset pagination requires a unique, stable sort key (ties on the sort column alone can skip or duplicate rows across pages) — always include a tiebreaker column (or use a genuinely unique key like `OrderID`) in both the `WHERE` and `ORDER BY`. `UNION` (versus `UNION ALL`) silently deduplicates, which is a correctness change, not just a performance one, if the branches can overlap.

#### 9. Production Scenario
A public API's "list transactions" endpoint that exposes `?page=N` naively as `OFFSET (N-1)*pageSize` will visibly slow down as users/bots page deep into large accounts — a very common real API performance complaint, and a good candidate discussion point for redesigning the API contract around a cursor/continuation token instead of a page number.

#### 10. Interview Follow-ups
1. Why does OFFSET/FETCH pagination get slower for deeper pages, mechanically?
2. What's a concrete downside of keyset pagination from a UX/API-design perspective?
3. When is UNION ALL unsafe to use instead of UNION?
4. How would you redesign a public paginated API to use keyset pagination without breaking existing page-number-based clients?

#### 11. Follow-up Answers
1. The engine must still traverse and count past every skipped row in index order before it can start returning the requested page — there's no way to "jump to row 100,000" in a B+‑tree without walking through the preceding rows (or maintaining a separate row-number index structure, which SQL Server doesn't do natively for this).
2. Keyset pagination doesn't support arbitrary "jump to page 47" navigation — it only supports "next"/"previous" relative to a known cursor position, which is a real UX constraint for UIs that expect page-number jump links.
3. When the branches can produce overlapping/duplicate rows and the caller needs those duplicates removed — `UNION ALL` skips deduplication entirely, which is only safe/correct when the branches are known to be mutually exclusive.
4. Offer both: an opaque `cursor` parameter for keyset-based "next page" navigation as the primary/recommended path, while keeping the existing `page` parameter working via `OFFSET`/`FETCH` for backward compatibility, clearly documenting the performance trade-off of deep page-number access in the API docs.

#### 12. Common Mistakes
Using `LIKE '%x%'` for search and reaching for more hardware instead of full-text search. Using `UNION` when `UNION ALL` is both correct and cheaper. Building a public API purely around page numbers without ever considering cursor-based pagination.

#### 13. Architect Insight
Each of these three sub-problems has the same underlying shape — a query pattern that *looks* reasonable but structurally can't use an index the way the developer assumes — and a principal-level candidate names the mechanism for each precisely (index union cost, wildcard seek-ability, offset re-scan cost) rather than offering only "add caching" as a generic deflection.

---

## References
1. [Clustered and Nonclustered Indexes Described](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/clustered-and-nonclustered-indexes-described) — Microsoft Learn
2. [Create Nonclustered Indexes](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/create-nonclustered-indexes) — Microsoft Learn
3. [CREATE INDEX (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-index-transact-sql) — Microsoft Learn
4. [SQL Server Index Architecture and Design Guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-index-design-guide) — Microsoft Learn
5. [Create Filtered Indexes](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/create-filtered-indexes) — Microsoft Learn
6. [Reorganize and Rebuild Indexes](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/reorganize-and-rebuild-indexes) — Microsoft Learn
7. [Execution Plan Overview](https://learn.microsoft.com/en-us/sql/relational-databases/performance/execution-plans) — Microsoft Learn
8. [Analyze an Actual Execution Plan](https://learn.microsoft.com/en-us/sql/relational-databases/performance/analyze-an-actual-execution-plan) — Microsoft Learn
9. [Display an Actual Execution Plan](https://learn.microsoft.com/en-us/sql/relational-databases/performance/display-an-actual-execution-plan) — Microsoft Learn
10. [Logical and Physical Showplan Operator Reference](https://learn.microsoft.com/en-us/sql/relational-databases/showplan-logical-and-physical-operators-reference) — Microsoft Learn
11. [Statistics](https://learn.microsoft.com/en-us/sql/relational-databases/statistics/statistics) — Microsoft Learn
12. [Cardinality Estimation (SQL Server)](https://learn.microsoft.com/en-us/sql/relational-databases/performance/cardinality-estimation-sql-server) — Microsoft Learn
13. [Parameter Sensitive Plan Optimization](https://learn.microsoft.com/en-us/sql/relational-databases/performance/parameter-sensitive-plan-optimization) — Microsoft Learn
14. [Automatic Tuning](https://learn.microsoft.com/en-us/sql/relational-databases/automatic-tuning/automatic-tuning) — Microsoft Learn
15. [Join Hints (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/hints-transact-sql-join) — Microsoft Learn
16. [ORDER BY Clause — OFFSET/FETCH (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql) — Microsoft Learn
17. [TOP (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/top-transact-sql) — Microsoft Learn
