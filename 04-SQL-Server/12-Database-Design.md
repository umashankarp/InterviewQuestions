# SQL Server Interview Workbook — Database Design

> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: [[11-Troubleshooting-Scenarios]]

This file is part of the **Top SQL Interview Questions & Answers Workbook** for `04-SQL-Server`. It uses the workbook's 13-part answer format (not the repo's standard module template) and covers **Database Design** — Q117–Q126: normalization/denormalization, key types, constraints, partitioning, sharding, replication, archiving, temporal tables/audit design, and soft deletes/multi-tenancy.

---

## Q117. What is normalization, and can you walk through 1NF → 2NF → 3NF → BCNF with a concrete example?

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
Normalization is the discipline of structuring tables so that each fact is stored exactly once, eliminating update/insert/delete anomalies. Each normal form removes a specific class of redundancy: 1NF removes repeating groups and non-atomic values; 2NF removes partial dependencies on part of a composite key; 3NF removes transitive dependencies (non-key columns depending on other non-key columns); BCNF tightens 3NF to handle cases where a table has multiple overlapping candidate keys.

**2. SQL Query**
```sql
-- UNNORMALIZED (violates 1NF: repeating groups, non-atomic Products column)
CREATE TABLE Orders_Unnormalized (
    OrderID INT PRIMARY KEY,
    CustomerName VARCHAR(100),
    CustomerCity VARCHAR(100),
    Products VARCHAR(500)   -- 'Widget:2, Gadget:1'  <-- non-atomic
);

-- 1NF: atomic values, one product per row, composite key
CREATE TABLE OrderItems_1NF (
    OrderID INT,
    ProductName VARCHAR(100),
    CustomerName VARCHAR(100),   -- still repeats per line item (partial dependency)
    CustomerCity VARCHAR(100),
    Quantity INT,
    PRIMARY KEY (OrderID, ProductName)
);

-- 2NF: remove partial dependency (CustomerName/City depend only on OrderID, not on the full key)
CREATE TABLE Orders_2NF (
    OrderID INT PRIMARY KEY,
    CustomerName VARCHAR(100),
    CustomerCity VARCHAR(100)
);
CREATE TABLE OrderItems_2NF (
    OrderID INT REFERENCES Orders_2NF(OrderID),
    ProductName VARCHAR(100),
    Quantity INT,
    PRIMARY KEY (OrderID, ProductName)
);

-- 3NF: remove transitive dependency (CustomerCity depends on CustomerID, not directly on OrderID)
CREATE TABLE Customers_3NF (
    CustomerID INT PRIMARY KEY,
    CustomerName VARCHAR(100),
    CustomerCity VARCHAR(100)
);
CREATE TABLE Orders_3NF (
    OrderID INT PRIMARY KEY,
    CustomerID INT REFERENCES Customers_3NF(CustomerID)
);
CREATE TABLE OrderItems_3NF (
    OrderID INT REFERENCES Orders_3NF(OrderID),
    ProductID INT,
    Quantity INT,
    PRIMARY KEY (OrderID, ProductID)
);
```

**3. Explain the Query**
- `Orders_Unnormalized` fails 1NF because `Products` packs multiple facts into one string — you cannot filter or aggregate by product without parsing text.
- `OrderItems_1NF` fixes atomicity but `CustomerName`/`CustomerCity` depend only on `OrderID` (part of nothing here, but conceptually once you add a composite key like `(OrderID, ProductName)`, those columns depend on just `OrderID`, not the full key) — a **partial dependency**, which 2NF eliminates by splitting `Orders` out.
- `Orders_2NF` still has `CustomerCity` depending on `CustomerName`/an implicit customer identity rather than directly on `OrderID` — a **transitive dependency**. 3NF eliminates it by extracting `Customers_3NF`.
- BCNF matters when a table has **overlapping composite candidate keys** — e.g., a `CourseSchedule(StudentID, Subject, Teacher)` table where `Teacher` determines `Subject` (each teacher teaches one subject) but `(StudentID, Subject)` is also a candidate key. 3NF can be satisfied while this anomaly remains; BCNF requires decomposing into `TeacherSubject(Teacher, Subject)` and `StudentTeacher(StudentID, Teacher)`.

**4. Sample Data**
`Orders_Unnormalized`:
| OrderID | CustomerName | CustomerCity | Products |
|---|---|---|---|
| 1 | Acme Corp | NYC | Widget:2, Gadget:1 |

**5. Expected Output**
After normalization, the same fact is represented as: `Customers_3NF(1, 'Acme Corp', 'NYC')`, `Orders_3NF(1, 1)`, `OrderItems_3NF(1, 101, 2)`, `OrderItems_3NF(1, 102, 1)` — no column repeats information that another table already owns.

**6. Alternative Solutions**
1. **Fully normalized to 3NF/BCNF (recommended default)** — best data integrity, smallest storage footprint, cheapest to keep consistent; cost is more joins per query.
2. **Stop at 2NF and accept some transitive redundancy** — occasionally justified for a small, rarely-changing dimension (e.g., embedding `CustomerCity` directly on `Orders` for a reporting table) where the join cost matters more than the (small, well-understood) redundancy risk.
3. **Denormalize deliberately after modeling to 3NF** (see Q118) — the correct sequence is *always* normalize first for correctness, then denormalize specific hot paths for performance, never skip normalization to "save time."

I prefer defaulting to 3NF/BCNF for OLTP schemas and treating denormalization as an explicit, reviewed exception, not a starting point — anomalies found after production data exists are far more expensive to fix than an extra `JOIN`.

**7. Performance**
Normalization *costs* query-time joins but *saves* write-time integrity checking, storage (no duplicated `CustomerCity` per order line), and avoids anomaly-driven bugs (updating a customer's city in one row but not another). With proper indexing on foreign keys (`OrderItems_3NF.OrderID`, `Orders_3NF.CustomerID`), join cost on a well-indexed OLTP schema is a non-issue at typical transactional volumes; it becomes a real concern only at extreme read fan-out, which is what read models/denormalized reporting tables are for.

**8. Edge Cases**
- Composite-key tables (`OrderItems`) need `NOT NULL` on every key column — SQL Server allows `NULL` in non-primary-key `UNIQUE` constraints but not in `PRIMARY KEY` columns.
- Migrating an unnormalized legacy table into 3NF while it's live requires a backfill + dual-write strategy, not a single blocking `ALTER TABLE`.
- BCNF violations are easy to miss because they only show up with *overlapping* candidate keys — most schemas never hit them, so don't over-engineer for BCNF by default; reach for it only when you can name the second candidate key.

**9. Production Scenario**
A trade-capture system that started as `Trades(TradeID, TraderName, TraderDesk, Symbol, Price, Qty)` will silently corrupt reporting the day a trader switches desks mid-quarter — every historical trade row's `TraderDesk` needs updating or your desk-level P&L is wrong. Normalizing `Trader(TraderID, Name, DeskID)` out of `Trades` and pointing `Trades.TraderID` at it (with `DeskID` versioned by an effective-dated history table if desks change over time) makes desk reassignment a one-row update instead of a mass-update anomaly.

**10. Interview Follow-ups**
1. What's the difference between a transitive dependency and a partial dependency?
2. Give an example of a 3NF table that is not in BCNF.
3. Does normalization prevent all data anomalies?
4. When would you deliberately stop at 2NF?
5. How does normalization interact with indexing strategy?

**11. Follow-up Answers**
1. Partial dependency: a non-key column depends on *part of* a composite primary key. Transitive: a non-key column depends on *another non-key column*, not on the key at all.
2. The classic `(StudentID, Subject) → Teacher` with `Teacher → Subject` example above — every column is fully and non-transitively dependent on a candidate key, satisfying 3NF, but the `Teacher → Subject` dependency isn't on a *whole* candidate key.
3. No — it eliminates *redundancy-driven* anomalies but not all data quality problems (e.g., it won't stop someone entering a negative `Quantity` without a `CHECK` constraint).
4. When the "child" table's own identity has no independent meaning outside its parent and the join is guaranteed 1:1 with no growth path (rare) — in practice, almost always normalize fully and denormalize later with clear justification instead.
5. Normalized schemas need indexes on every foreign key used in joins (SQL Server does **not** auto-index FK columns — see Q120) or query plans silently degrade to scans as data grows.

**12. Common Mistakes**
- Treating "3NF" as a synonym for "correct" and never checking for BCNF violations when a table clearly has two candidate keys.
- Normalizing lookup/reference data that never changes (e.g., a two-row `Status(Active, Inactive)` table) to the point of adding join overhead with zero integrity benefit — apply judgment, not dogma.
- Confusing normalization (structural correctness) with performance tuning (a separate, later concern).

**13. Architect Insight**
A junior answer defines the normal forms. A senior/architect answer explains *why* — that normalization is fundamentally about **making illegal states unrepresentable and updates single-writer**, and that the decision to normalize or not should be driven by where in the read/write path a table sits: normalize the system-of-record (OLTP) aggressively, and denormalize explicitly, with a documented reconciliation/refresh strategy, only for read-optimized projections downstream of it.

---

## Q118. When and why would you deliberately denormalize a schema?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Denormalize when the cost of joining normalized data at read time — measured, not assumed — exceeds the cost of managing the resulting redundancy. Typical triggers: reporting/analytics queries that aggregate across millions of rows and can't tolerate multi-way joins, read-heavy dashboards, or a CQRS read model that's rebuilt from an event stream and is disposable if it drifts. Denormalization is a targeted performance decision layered *on top of* a normalized system of record, not a substitute for one.

**2. SQL Query**
```sql
-- Normalized system-of-record
CREATE TABLE Orders (OrderID INT PRIMARY KEY, CustomerID INT, OrderDate DATE);
CREATE TABLE OrderItems (OrderID INT, ProductID INT, Quantity INT, UnitPrice DECIMAL(18,2));
CREATE TABLE Customers (CustomerID INT PRIMARY KEY, CustomerName VARCHAR(100), Region VARCHAR(50));

-- Denormalized reporting table, refreshed on a schedule or via trigger/CDC
CREATE TABLE OrderSummary_Denormalized (
    OrderID INT PRIMARY KEY,
    CustomerName VARCHAR(100),
    Region VARCHAR(50),
    OrderDate DATE,
    OrderTotal DECIMAL(18,2),
    LastRefreshedAt DATETIME2 DEFAULT SYSUTCDATETIME()
);

-- Refresh statement (run on a schedule, via CDC trigger, or from an ETL/stream consumer)
MERGE OrderSummary_Denormalized AS target
USING (
    SELECT o.OrderID, c.CustomerName, c.Region, o.OrderDate,
           SUM(oi.Quantity * oi.UnitPrice) AS OrderTotal
    FROM Orders o
    JOIN Customers c ON c.CustomerID = o.CustomerID
    JOIN OrderItems oi ON oi.OrderID = o.OrderID
    GROUP BY o.OrderID, c.CustomerName, c.Region, o.OrderDate
) AS src
ON target.OrderID = src.OrderID
WHEN MATCHED THEN UPDATE SET CustomerName = src.CustomerName, Region = src.Region,
    OrderTotal = src.OrderTotal, LastRefreshedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (OrderID, CustomerName, Region, OrderDate, OrderTotal)
    VALUES (src.OrderID, src.CustomerName, src.Region, src.OrderDate, src.OrderTotal);
```

**3. Explain the Query**
The system-of-record (`Orders`/`OrderItems`/`Customers`) stays normalized so writes remain single-source-of-truth. `OrderSummary_Denormalized` pre-computes the join and aggregation so a dashboard does a single-table `SELECT` instead of a 3-way join with a `GROUP BY` over the full history every time it renders. The `MERGE` keeps the summary table synchronized without a full rebuild; `LastRefreshedAt` makes staleness observable instead of silent.

**4. Sample Data**
`Orders`: `(1, 501, '2026-09-01')`. `OrderItems`: `(1, 10, 2, 25.00)`, `(1, 11, 1, 40.00)`. `Customers`: `(501, 'Acme Corp', 'EMEA')`.

**5. Expected Output**
`OrderSummary_Denormalized`: `(1, 'Acme Corp', 'EMEA', '2026-09-01', 90.00, <refresh timestamp>)`.

**6. Alternative Solutions**
1. **Materialized/denormalized table refreshed by `MERGE` or CDC (shown above)** — good when near-real-time freshness matters and you control the refresh cadence explicitly.
2. **Indexed view** (`CREATE VIEW ... WITH SCHEMABINDING` + unique clustered index) — SQL Server maintains it transactionally and automatically on every underlying write; simplest to keep correct, but adds write-path overhead to every `INSERT`/`UPDATE` on the base tables and has restrictive requirements (no outer joins, deterministic aggregates only).
3. **Leave it normalized and let the query optimizer do the join every time**, backed by covering indexes — viable until data volume or query frequency makes the join cost material; always the right starting point (see Q117) before reaching for either denormalized alternative.

I prefer starting with option 3, moving to an indexed view when the read pattern is simple/stable and write volume can absorb the overhead, and falling back to an explicitly-refreshed denormalized table (option 1) when the read pattern is complex or write volume is too high for an indexed view's synchronous maintenance cost.

**7. Performance**
Denormalization trades write-amplification and staleness risk for read-time speed — the summary table read is O(1) lookup instead of an O(n) aggregation across order history. The `MERGE` itself costs proportional to the refresh batch size; batching (e.g., "refresh orders modified since last run" via a `ModifiedAt` column or CDC) keeps this bounded instead of rescanning the whole history each cycle.

**8. Edge Cases**
- Refresh lag: a dashboard reading `OrderSummary_Denormalized` right after an order is placed may show stale data until the next refresh — surface `LastRefreshedAt` in the UI rather than hiding it.
- Concurrent refresh runs must not race — serialize the job (e.g., `sp_getapplock`) or make the `MERGE` idempotent per batch key.
- Schema drift: if `Customers.Region` changes, historical `OrderSummary_Denormalized` rows reflect the region *as of the last refresh*, not as of the order date — decide explicitly whether that's the desired semantics (current region) or whether you need to snapshot the region at order time instead.

**9. Production Scenario**
A trading desk's real-time P&L dashboard aggregates millions of fills across positions; recomputing it from normalized `Fills`/`Instruments`/`Accounts` tables on every page load is too slow. A denormalized `PositionSummary` table, refreshed incrementally as fills stream in via CDC, gives sub-second dashboard reads while `Fills` remains the normalized, auditable system-of-record for reconciliation and regulatory reporting.

**10. Interview Follow-ups**
1. How do you keep a denormalized table from silently going stale?
2. What's the difference between denormalization and an indexed view?
3. How would you detect and repair drift between the source tables and the denormalized copy?
4. Would you ever denormalize the system-of-record itself?
5. How does this interact with CQRS?

**11. Follow-up Answers**
1. Expose a `LastRefreshedAt`/version column, alert if refresh lag exceeds an SLA, and run periodic reconciliation queries comparing aggregates.
2. An indexed view is maintained transactionally by the engine on every write to the base tables (always consistent, but adds synchronous write cost and has strict eligibility rules); a denormalized table is maintained by your own refresh logic (async, flexible, but can drift).
3. A scheduled reconciliation job that recomputes the aggregate from source and diffs it against the denormalized row, alerting or auto-repairing on mismatch — exactly the reconciliation discipline used for external settlement files (see `14-SQL-and-FinTech.md`).
4. No — the system-of-record should stay normalized; denormalize downstream read models instead, so there's always one place correctness questions get resolved.
5. This *is* the CQRS read-model pattern: the normalized tables are the write model, the denormalized table is a read model kept eventually consistent — see Q133 in `13-SQL-and-Microservices.md`.

**12. Common Mistakes**
- Denormalizing before measuring — adding redundancy for a join that was never actually a bottleneck.
- Forgetting to version/timestamp the denormalized copy, making staleness invisible until a user notices wrong numbers.
- Denormalizing the *only* copy of the data (deleting the normalized source), leaving no way to rebuild or audit it.

**13. Architect Insight**
The senior signal is treating denormalization as a **cache with an invalidation strategy**, not a schema shortcut: name the staleness bound, name the reconciliation mechanism, and name what happens when the two diverge. A junior answer just says "denormalize for speed."

---

## Q119. Distinguish primary key, foreign key, candidate key, surrogate key, and natural key — and explain when you'd choose a surrogate key over a natural one.

**Difficulty:** 🟢 Basic (definitions) / 🟡 Intermediate (the surrogate-vs-natural decision)

**1. Interview Answer**
A **candidate key** is any minimal column set that could uniquely identify a row; a table can have several. The **primary key** is the candidate key chosen as the table's main identifier. A **foreign key** is a column (or set) in one table that references a candidate key (usually the primary key) in another, enforcing referential integrity. A **natural key** is a candidate key made of real-world business data (e.g., SSN, ISIN, email); a **surrogate key** is a system-generated identifier (e.g., an `IDENTITY` int or a `UNIQUEIDENTIFIER`) with no business meaning. Default to a surrogate primary key and enforce the natural key separately as a `UNIQUE` constraint — this decouples row identity from business rules that change.

**2. SQL Query**
```sql
CREATE TABLE Employees (
    EmployeeID INT IDENTITY(1,1) PRIMARY KEY,   -- surrogate key
    EmployeeCode VARCHAR(20) NOT NULL,          -- natural key, still unique
    NationalInsuranceNumber VARCHAR(20) NOT NULL,
    FullName VARCHAR(100) NOT NULL,
    DepartmentID INT NOT NULL,
    CONSTRAINT UQ_Employees_EmployeeCode UNIQUE (EmployeeCode),
    CONSTRAINT UQ_Employees_NINumber UNIQUE (NationalInsuranceNumber),
    CONSTRAINT FK_Employees_Department FOREIGN KEY (DepartmentID)
        REFERENCES Departments(DepartmentID)
);
```

**3. Explain the Query**
`EmployeeID` is the primary key and is surrogate — it never changes and carries no business meaning, so it's safe to use in every foreign key elsewhere in the schema. `EmployeeCode` and `NationalInsuranceNumber` are both candidate keys (each alone could identify a row) but are enforced only as `UNIQUE`, not `PRIMARY KEY`, because business identifiers can be reissued, corrected, or — in the case of an SSN-equivalent — should never be exposed as a join key across the schema for privacy reasons. `DepartmentID` is a foreign key referencing `Departments`' primary key, enforcing that every employee belongs to a real department.

**4. Sample Data**
| EmployeeID | EmployeeCode | NationalInsuranceNumber | FullName | DepartmentID |
|---|---|---|---|---|
| 1 | E-1001 | QQ123456C | Jane Doe | 5 |

**5. Expected Output**
Inserting a second row with `EmployeeCode = 'E-1001'` fails with a `UNIQUE` constraint violation; inserting `DepartmentID = 999` (nonexistent) fails the `FOREIGN KEY` constraint.

**6. Alternative Solutions**
1. **Surrogate `IDENTITY` primary key + natural key as `UNIQUE`** (shown, recommended) — cheap 4-byte joins, immune to business-rule changes to the natural key, and every FK elsewhere is small and stable.
2. **Natural key as primary key** (e.g., `EmployeeCode` PK directly) — simpler schema with one fewer column, but every downstream FK now carries a wider, string-typed key, and if the business ever needs to *reissue* an employee code (company merger, format migration), you're rewriting every FK row across every child table.
3. **`UNIQUEIDENTIFIER` (GUID) surrogate key** — useful when IDs must be generated client-side or across distributed systems without a central sequence, at the cost of larger key width (16 bytes vs 4), worse clustered-index page-fill/fragmentation behavior if used as the clustering key (random GUIDs cause page splits — use `NEWSEQUENTIALID()` or a client-friendly sequential scheme if GUIDs are required as the clustered key).

I default to option 1 for internally-generated entities and reach for option 3 only when IDs genuinely need to be generated outside the database before the row exists (e.g., idempotent client-side order creation).

**7. Performance**
A 4-byte `INT` surrogate key is cheaper to store and index than a wide natural key (a `VARCHAR(20)` or composite key) in every child table's foreign key column and every non-clustered index that includes it — this compounds across a schema with many child tables. Natural keys used as clustered primary keys can also force wider, less cache-efficient non-clustered index leaf rows, since SQL Server stores the clustering key in every non-clustered index.

**8. Edge Cases**
- Natural "keys" often turn out not to be truly unique or stable over time (two people can legitimately share an SSN-equivalent in edge cases like data entry error or reissue) — never assume a natural identifier is a safe *primary* key without verifying the business guarantees it.
- `IDENTITY` values are not guaranteed gap-free (rolled-back transactions burn values) — never expose them as a "row count" or rely on them for sequential business meaning.
- Composite natural keys (e.g., `(CountryCode, LocalAccountNumber)`) are legitimate as `UNIQUE`/alternate keys but make foreign keys wider everywhere they're referenced — a strong argument for wrapping them behind a surrogate key.

**9. Production Scenario**
A core-banking `Accounts` table originally used the customer-facing account number as its primary key. When the bank went through a core-system migration and had to renumber accounts for a subset of customers, every child table (`Transactions`, `Statements`, `StandingOrders`) needed a cascading key rewrite across billions of rows. Had `AccountID` been a surrogate key with `AccountNumber` as a `UNIQUE` alternate key, the renumbering would have been a single-column update on `Accounts` alone.

**10. Interview Follow-ups**
1. Can a table have more than one candidate key?
2. Is a foreign key required to reference a primary key specifically?
3. What happens to `IDENTITY` values after a failed transaction?
4. Why avoid random GUIDs as a clustered index key?
5. Would you ever use a composite (multi-column) primary key?

**11. Follow-up Answers**
1. Yes — every candidate key is a valid uniqueness guarantee; only one is chosen as *the* primary key, the rest are typically enforced as `UNIQUE` constraints (alternate keys).
2. No — a foreign key can reference any column(s) covered by a `UNIQUE` constraint or `UNIQUE` index, not only the primary key, though referencing the primary key is the overwhelmingly common convention.
3. They're consumed and not reused — `IDENTITY` guarantees uniqueness and increasing order, not contiguity, so gaps are normal and expected.
4. Random GUIDs inserted as a clustered key cause the physical row order to scatter across pages on every insert, driving heavy page splits and fragmentation; `NEWSEQUENTIALID()` or an `INT`/`BIGINT` surrogate avoids this.
5. Yes — legitimately for pure associative/junction tables in a many-to-many relationship (e.g., `(OrderID, ProductID)` in `OrderItems`), where the combination genuinely *is* the row's identity and there's no independent surrogate needed.

**12. Common Mistakes**
- Using a mutable business value (email, phone number) as a primary key that other tables reference by value.
- Assuming `IDENTITY` values are contiguous and using gaps as evidence of "missing" rows.
- Defaulting to GUID primary keys everywhere "for uniqueness" without considering the clustered-index fragmentation cost.

**13. Architect Insight**
The architect-level distinction is recognizing that **primary key choice is an identity-stability decision, not just a uniqueness decision** — the question isn't "what uniquely identifies this row today" but "what would still be true, and still be safe to reference from a hundred other tables, in five years after every business-rule change you can't yet predict." That's the case for surrogate keys as the default.

---

## Q120. How do constraints enforce referential integrity, and what are the trade-offs between `CASCADE`, `SET NULL`, and `NO ACTION` on a foreign key?

**Difficulty:** 🟡 Intermediate

**1. Interview Answer**
`PRIMARY KEY`, `UNIQUE`, `CHECK`, `NOT NULL`, and `FOREIGN KEY` constraints let SQL Server enforce data integrity declaratively at write time, rather than trusting application code to never insert an orphaned or invalid row. On a foreign key, `ON DELETE`/`ON UPDATE` behavior controls what happens to child rows when the referenced parent row is deleted or its key changes: `NO ACTION` (default) blocks the parent operation if children exist, `CASCADE` propagates the delete/update to children, and `SET NULL`/`SET DEFAULT` nulls out or resets the child's FK column instead of deleting the child row.

**2. SQL Query**
```sql
CREATE TABLE Departments (
    DepartmentID INT PRIMARY KEY,
    DepartmentName VARCHAR(100) NOT NULL
);

CREATE TABLE Employees (
    EmployeeID INT IDENTITY PRIMARY KEY,
    FullName VARCHAR(100) NOT NULL,
    Salary DECIMAL(18,2) NOT NULL CHECK (Salary >= 0),
    DepartmentID INT NULL,
    CONSTRAINT FK_Employees_Department FOREIGN KEY (DepartmentID)
        REFERENCES Departments(DepartmentID)
        ON DELETE SET NULL          -- deleting a department orphans employees to NULL, doesn't delete them
        ON UPDATE CASCADE           -- if DepartmentID is ever renumbered, employees follow automatically
);

CREATE TABLE Timesheets (
    TimesheetID INT IDENTITY PRIMARY KEY,
    EmployeeID INT NOT NULL,
    CONSTRAINT FK_Timesheets_Employee FOREIGN KEY (EmployeeID)
        REFERENCES Employees(EmployeeID)
        ON DELETE NO ACTION         -- block deleting an employee who has timesheet history
);
```

**3. Explain the Query**
`CHECK (Salary >= 0)` rejects invalid data at the column level regardless of application logic. `Employees.DepartmentID` uses `ON DELETE SET NULL` because losing a department shouldn't destroy employee records — it should just leave them departmentless pending reassignment. `Timesheets.EmployeeID` deliberately uses `NO ACTION` (the default) because timesheet history is a compliance/audit record — an employee with recorded hours must never be deletable outright; the application is forced to handle that case explicitly (e.g., soft-delete the employee instead, see Q126).

**4. Sample Data**
`Departments`: `(5, 'Engineering')`. `Employees`: `(1, 'Jane Doe', 95000, 5)`. `Timesheets`: `(1, 1)`.

**5. Expected Output**
`DELETE FROM Departments WHERE DepartmentID = 5` succeeds and sets `Employees.DepartmentID` to `NULL` for Jane Doe. `DELETE FROM Employees WHERE EmployeeID = 1` **fails** with a foreign key violation because a `Timesheets` row still references it.

**6. Alternative Solutions**
1. **Declarative FK constraints with explicit `ON DELETE`/`ON UPDATE` behavior** (shown) — integrity is enforced by the engine itself, can't be bypassed by a buggy application path, and is visible in the schema for anyone reading it.
2. **Enforce integrity in application/service code only** — more flexible for cross-database/cross-service references where a real FK isn't possible (e.g., microservices with database-per-service, see `13-SQL-and-Microservices.md`), but is only as reliable as every code path that touches the table, including ad hoc scripts and future developers.
3. **Triggers for integrity logic too complex for a `CHECK` constraint** (e.g., cross-row validation) — powerful but harder to reason about, debug, and performance-tune than declarative constraints; use only when constraints genuinely can't express the rule.

I prefer declarative constraints (option 1) as the default for anything within a single database, reserving application-level checks for cross-database boundaries where the engine literally cannot enforce it.

**7. Performance**
Unlike a `PRIMARY KEY`, creating a `FOREIGN KEY` constraint does **not** automatically create an index on the referencing column — if you don't index `Timesheets.EmployeeID` yourself, every check of "does this employee have timesheets" (which `DELETE`/`CASCADE` processing does internally) is a table scan. Always manually index foreign key columns that participate in deletes, updates, or joins.

**8. Edge Cases**
- `CASCADE` chains can multiply: deleting one parent can cascade-delete deeply, unexpectedly deleting far more data than intended — SQL Server also disallows *cyclical* cascade paths (multiple cascade paths to the same table) at creation time.
- `CHECK` constraints are not validated against existing rows by default when added with `WITH NOCHECK` — always verify with `WITH CHECK CHECK CONSTRAINT` after a `NOCHECK` add, or the constraint silently doesn't protect pre-existing bad data.
- `SET NULL` requires the FK column to be nullable — a `NOT NULL` FK column cannot use `ON DELETE SET NULL` (SQL Server will reject the constraint definition).

**9. Production Scenario**
In a trade-settlement schema, `Trades.CounterpartyID` referencing `Counterparties` should almost never cascade-delete: deleting a counterparty must not silently delete trade history. `NO ACTION` (or better, disallowing hard deletes on `Counterparties` entirely via a soft-delete flag, Q126) protects the audit trail that regulators expect to be immutable.

**10. Interview Follow-ups**
1. Does a foreign key constraint automatically index the referencing column?
2. What's the danger of `WITH NOCHECK` when adding a constraint?
3. When would `ON DELETE CASCADE` be actively dangerous?
4. How do `CHECK` constraints interact with query optimization?
5. Can a `CHECK` constraint reference another table?

**11. Follow-up Answers**
1. No — you must create that index explicitly; this is one of the most common causes of unexpected blocking/scanning during cascade or delete operations.
2. `WITH NOCHECK` adds the constraint without validating existing data, so old bad rows stay invalid; the optimizer also won't *trust* an unchecked constraint for plan simplification the way it trusts a checked one.
3. In any audit/compliance-bearing parent-child relationship (financial records, medical records) — cascading deletes there can destroy required history; prefer `NO ACTION` + explicit soft-delete workflows.
4. A trusted `CHECK` constraint can let the optimizer eliminate partitions/branches it can prove can't match (e.g., a `CHECK (Region = 'EU')` on a partitioned table lets the engine skip non-EU partitions entirely for some query shapes).
5. Not directly — `CHECK` constraints can only reference columns in the same row/table. Cross-table validation requires a trigger or application-level enforcement.

**12. Common Mistakes**
- Forgetting to index FK columns, then being surprised deletes/cascades are slow or cause heavy blocking.
- Using `ON DELETE CASCADE` reflexively without considering audit/compliance requirements.
- Adding `CHECK`/`FOREIGN KEY` constraints with `NOCHECK` "to save time" and never circling back to validate existing data.

**13. Architect Insight**
A senior answer treats each FK's delete/update behavior as a **deliberate business decision recorded in the schema**, not a default left on autopilot — "can this parent ever be removed while children exist, and if so, what should happen to them" is a question the architect answers explicitly per relationship, especially anywhere audit/regulatory retention is in play.

---

## Q121. How does table partitioning work in SQL Server, and how do partition function/scheme and partition switching fit together?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Table partitioning splits a table's rows across multiple physical units (partitions) based on the value of a partitioning column, using a **partition function** (defines the boundary values) mapped through a **partition scheme** (maps each partition to a filegroup). This lets maintenance operations — index rebuilds, statistics updates, and especially data loading/archival via `ALTER TABLE ... SWITCH` — operate on a single partition instead of the whole table, and lets the optimizer perform **partition elimination**, skipping partitions that can't match the query's filter.

**2. SQL Query**
```sql
-- Partition function: monthly boundaries on OrderDate
CREATE PARTITION FUNCTION PF_OrderDate_Monthly (DATE)
AS RANGE RIGHT FOR VALUES ('2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01');

-- Partition scheme: map each partition to a filegroup (ALL TO PRIMARY for simplicity here)
CREATE PARTITION SCHEME PS_OrderDate_Monthly
AS PARTITION PF_OrderDate_Monthly ALL TO ([PRIMARY]);

CREATE TABLE Orders (
    OrderID BIGINT NOT NULL,
    OrderDate DATE NOT NULL,
    CustomerID INT NOT NULL,
    OrderTotal DECIMAL(18,2) NOT NULL,
    CONSTRAINT PK_Orders PRIMARY KEY (OrderID, OrderDate)
) ON PS_OrderDate_Monthly(OrderDate);

-- Archival via partition switch: move a full month out to a staging table (metadata-only, near-instant)
CREATE TABLE Orders_Archive_202601 (
    OrderID BIGINT NOT NULL,
    OrderDate DATE NOT NULL,
    CustomerID INT NOT NULL,
    OrderTotal DECIMAL(18,2) NOT NULL,
    CONSTRAINT PK_Orders_Archive_202601 PRIMARY KEY (OrderID, OrderDate),
    CONSTRAINT CK_Orders_Archive_202601 CHECK (OrderDate >= '2026-01-01' AND OrderDate < '2026-02-01')
) ON [PRIMARY];

ALTER TABLE Orders SWITCH PARTITION 2 TO Orders_Archive_202601;
```

**3. Explain the Query**
`PF_OrderDate_Monthly` with `RANGE RIGHT` defines boundaries so `'2026-01-01'` starts partition 2 (partition 1 is everything before `'2026-01-01'`), each subsequent boundary starting the next partition. `PS_OrderDate_Monthly` assigns every partition to `[PRIMARY]` here for simplicity — in production you'd typically map older, colder partitions to a cheaper filegroup/storage tier. `Orders` is created `ON PS_OrderDate_Monthly(OrderDate)`, physically distributing rows by month. The `SWITCH PARTITION` statement reassigns partition 2's data to `Orders_Archive_202601` as a **metadata-only operation** — no rows are physically copied — provided the target table has an identical schema, indexes, and a `CHECK` constraint that exactly matches the partition's boundary (required so the engine can verify data placement without scanning).

**4. Sample Data**
`Orders` rows with `OrderDate` values spanning January–March 2026 land in partitions 2, 3, and 4 respectively based on the boundaries.

**5. Expected Output**
After the switch, `SELECT COUNT(*) FROM Orders WHERE OrderDate >= '2026-01-01' AND OrderDate < '2026-02-01'` returns 0 (that data moved), and the same predicate against `Orders_Archive_202601` returns the migrated rows — instantly, without a row-by-row `DELETE`/`INSERT`.

**6. Alternative Solutions**
1. **Native table partitioning with `SWITCH`** (shown) — best for very large single-table archival/rolling-window workloads (e.g., "keep 13 months hot, archive the rest") where partition elimination also speeds up date-ranged queries; requires Standard edition or higher support for the row counts involved (partitioning itself has been available broadly since SQL Server 2016 SP1, unlike some Enterprise-only features from earlier versions).
2. **Separate archive table populated by a scheduled batch `DELETE ... OUTPUT INTO`** — works without partitioning, portable to any edition/version, but is a logged, row-by-row operation that competes for locks/log space and is far slower at scale than a metadata-only switch.
3. **Partitioned views (`UNION ALL` across separate tables with `CHECK` constraints)** — the pre-2005 technique, still occasionally seen; strictly worse than native partitioning today for maintainability and optimizer support, kept only for legacy or cross-database partitioning scenarios native partitioning can't do (native partitioning is confined to a single database).

I default to native table partitioning (option 1) for any single-database table where a time-based (or similarly monotonic) archival/retention pattern is a first-class requirement.

**7. Performance**
Partition elimination lets the optimizer skip entire partitions it can prove don't match a `WHERE` clause (e.g., a query filtered to March never touches January's partition), turning an O(n) scan into an O(partition size) scan for well-aligned queries. `SWITCH` is O(1) regardless of row count because it changes only metadata pointers — this is the entire reason it's the standard technique for archiving hundreds of millions of rows without a maintenance-window-blowing batch delete.

**8. Edge Cases**
- `SWITCH` requires the source and target table schemas, indexes, and constraints to match **exactly**, and the target must be empty (switching in) or the source partition's data must satisfy the target's `CHECK` constraint (switching out) — mismatches fail immediately, which is a feature (fail fast) not a bug.
- Partitioning column must be part of every unique index/constraint (including the primary key) on the table — this is why `PK_Orders` above is `(OrderID, OrderDate)`, not just `OrderID`.
- Skewed partition sizes (e.g., one month with 10x the volume of others) undermine the "maintenance operates on manageable units" benefit — monitor partition row counts, don't just set-and-forget the boundaries.

**9. Production Scenario**
A market-data tick-capture table ingesting hundreds of millions of rows per day partitions by trading date, keeps the last 90 days on fast SSD-backed filegroups, and nightly-switches expired days into an archive table on cheaper storage — with zero blocking on the live ingestion path, because the switch never touches the actively-written current-day partition.

**10. Interview Follow-ups**
1. What's the difference between `RANGE LEFT` and `RANGE RIGHT`?
2. Why must the partitioning column be part of every unique constraint?
3. Does partitioning improve performance for queries that don't filter on the partitioning column?
4. What happens if the target table of a `SWITCH` isn't empty?
5. How do you rebuild indexes on just one partition?

**11. Follow-up Answers**
1. `RANGE LEFT` puts the boundary value itself in the *left* (lower) partition; `RANGE RIGHT` puts it in the *right* (upper) partition — `RANGE RIGHT` is the conventional choice for date boundaries so `'2026-01-01'` unambiguously starts January's partition rather than ending December's.
2. SQL Server must be able to guarantee uniqueness *within* a single partition without cross-partition coordination — including the partitioning column in every unique key lets it do that check locally.
3. No, and it can hurt — a query with no predicate on the partitioning column must still touch every partition, so a table over-partitioned for a workload that doesn't filter on that column gains nothing and adds overhead.
4. The `SWITCH` fails outright — SQL Server refuses to overwrite or merge data during a switch; the target must be empty and schema-identical.
5. `ALTER INDEX ... REBUILD PARTITION = n` rebuilds a single partition's index rather than the whole table — this is the maintenance-window benefit partitioning is built for.

**12. Common Mistakes**
- Forgetting to include the partitioning column in the primary key/unique constraints, then being unable to create the table at all.
- Assuming partitioning automatically speeds up every query, rather than only queries that filter on (or align with) the partitioning column.
- Switching data into a target table whose indexes don't exactly mirror the source, causing the switch to fail at the worst possible time (a maintenance window).

**13. Architect Insight**
The senior/architect framing is that partitioning is a **manageability and elimination tool, not a sharding substitute** — it solves "how do I archive/maintain one table's data in slices" within a single SQL Server instance, and should never be confused with horizontal scaling across multiple database instances (Q122), which it does not provide by itself.

---

## Q122. What's the difference between sharding and partitioning, and when do you need application-level sharding instead of SQL Server's native partitioning?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
Partitioning (Q121) splits one table's data into multiple physical units **within a single database/instance** — it helps manageability and query elimination, but every partition still shares the same CPU, memory, and I/O ceiling of that one SQL Server instance. Sharding splits data **across multiple independent database instances** (often on different servers), so it scales write throughput and total storage horizontally, at the cost of the database no longer being able to enforce cross-shard joins, foreign keys, or transactions for you — the application (or a routing/orchestration layer) takes on that responsibility.

**2. SQL Query**
```sql
-- Sharded design: each shard is a physically separate database, keyed by CustomerID range/hash
-- Shard 1 database (CustomerID % 4 = 0)
CREATE TABLE Orders (
    OrderID BIGINT NOT NULL,
    CustomerID INT NOT NULL,
    OrderDate DATE NOT NULL,
    OrderTotal DECIMAL(18,2) NOT NULL,
    CONSTRAINT PK_Orders PRIMARY KEY (OrderID)
);
-- Identical DDL is deployed to Shard 2/3/4 databases (CustomerID % 4 = 1/2/3)

-- Application-level shard routing (conceptual — this logic lives in the app/gateway, not in T-SQL):
--   shardIndex = CustomerID % 4
--   connectionString = ShardConnectionStrings[shardIndex]
-- Cross-shard reporting requires either:
--   (a) fan-out query + in-app merge, or
--   (b) a separate aggregated read model (see Q118) fed by CDC from every shard
```

**3. Explain the Query**
Each shard is a structurally identical, independently-running SQL Server database holding a disjoint subset of customers, chosen by a **shard key** (`CustomerID` here, via modulo hashing — range-based, e.g., by region or customer-ID range, is the other common scheme). There is no `FOREIGN KEY`, `JOIN`, or single `SELECT` that can span shards natively; the application must route each query to the correct shard using the same key logic used to place the data, and any cross-shard aggregate needs either fan-out-and-merge in application code or a dedicated cross-shard read model.

**4. Sample Data**
`CustomerID = 1001` → `1001 % 4 = 1` → routed to Shard 2. `CustomerID = 1002` → `1002 % 4 = 2` → routed to Shard 3.

**5. Expected Output**
A query for "all orders for CustomerID 1001" hits exactly one shard and returns fast; a query for "total orders across all customers" must fan out to all four shards and sum the results in application code — there's no single SQL Server instance that can compute it in one query.

**6. Alternative Solutions**
1. **Stay single-instance, scale vertically + partition (Q121) + read replicas (Q123)** — the right choice until you provably exceed a single instance's practical ceiling (very high sustained write throughput, or storage/compute that a single (even large) instance can't cost-effectively serve); avoids all cross-shard complexity.
2. **Application-level sharding with a custom routing layer** (shown) — necessary once write throughput or storage genuinely exceeds single-instance limits; the cost is real: no cross-shard transactions, joins, or foreign keys, and a materially harder operational story (schema migrations must run identically across every shard).
3. **A distributed SQL platform (e.g., Azure SQL Database elastic pools/sharding library, or a different database engine built for horizontal scale)** — offloads some routing/rebalancing complexity to the platform, at the cost of adopting a different (and sometimes less mature/familiar) toolset than plain SQL Server.

I recommend never reaching for sharding pre-emptively — exhaust vertical scaling, partitioning, read replicas, and caching first (per Q123/Q29's "transactions and performance" discipline), because sharding is the option that most permanently complicates the data model; treat it as a last resort justified by measured, not projected, limits.

**7. Performance**
Sharding removes the single-instance ceiling on write throughput and total storage by distributing load, but every cross-shard operation (a report spanning all customers, a query without the shard key) becomes strictly more expensive than the equivalent single-instance query, because it now requires fan-out, network round trips to multiple databases, and application-side merging.

**8. Edge Cases**
- **Hot shards**: a hashing scheme that seemed even can still produce a hot shard if one customer (or one heavily-traded instrument) dominates traffic — modulo/hash sharding needs monitoring, and range sharding needs rebalancing logic for growth.
- **Resharding**: changing the shard count later (e.g., 4 shards → 8) requires physically moving data between databases — this is one of the most operationally painful migrations in a sharded system if not planned for from day one (e.g., via consistent hashing or a shard map that can be split without a full data reshuffle).
- **Cross-shard transactions**: if a business operation must atomically touch two shards (e.g., transferring funds between accounts on different shards), you need a saga/compensating-transaction pattern (see `13-SQL-and-Microservices.md`), not a native SQL Server transaction.

**9. Production Scenario**
A payments platform outgrows a single SQL Server instance's write throughput as merchant volume grows. Sharding `Transactions` by `MerchantID` hash across 16 databases lets write volume scale roughly linearly with shard count, while a separate CDC-fed reporting warehouse aggregates across all 16 shards for finance/regulatory reporting that genuinely needs a global view.

**10. Interview Follow-ups**
1. Can you shard and partition the same table simultaneously?
2. How do you handle a query that needs data from multiple shards?
3. What's the hardest part of resharding in production?
4. How do foreign keys work across shards?
5. Would you choose range-based or hash-based sharding, and why?

**11. Follow-up Answers**
1. Yes — each shard database can itself be partitioned internally (Q121) for manageability; the two techniques operate at different levels (across instances vs. within one) and are complementary, not competing.
2. Fan-out-query-and-merge in the application/gateway layer, or maintain a separate cross-shard aggregated read model updated via CDC/events from every shard.
3. Rebalancing existing data to new shard boundaries without downtime — typically solved with consistent hashing (minimizes how much data moves) or a shard-map service that can split one shard's range into two without touching unrelated shards.
4. They don't — referential integrity across shards must be enforced in application code, accepting eventual consistency or using a saga pattern for compensating actions if a cross-shard invariant is violated.
5. Hash-based distributes load evenly and avoids hot shards from sequential keys, but makes range scans (e.g., "all orders in March") expensive since they hit every shard; range-based keeps range scans efficient but risks hot shards from skewed key distributions (e.g., a rapidly growing single tenant) — the choice depends on whether the dominant query pattern is point lookups (favor hash) or range scans (favor range), and I'd pick based on the workload's actual query shape, not a default.

**12. Common Mistakes**
- Sharding before establishing that a single, well-tuned, partitioned, read-replica-backed instance genuinely can't meet requirements.
- Choosing a shard key that doesn't match the dominant access pattern (e.g., sharding by `OrderID` when almost every query filters by `CustomerID`), forcing fan-out on the common case.
- Underestimating the operational cost of keeping schema migrations, backups, and monitoring consistent across N independent shard databases.

**13. Architect Insight**
The architect-level answer names the actual trigger condition ("we measured X TPS/GB and a single instance tops out at Y") rather than treating sharding as a generic "for scale" upgrade, and is explicit that sharding is a **one-way architectural door** — it permanently removes the database's ability to enforce cross-entity invariants, pushing that responsibility onto application code for the life of the system.

---

## Q123. Compare Always On Availability Groups, readable secondary replicas, and transactional replication as high-availability/read-scale strategies.

**Difficulty:** 🔴 Senior

**1. Interview Answer**
**Always On Availability Groups (AGs)** replicate one or more databases as a unit to secondary replicas for both high availability (automatic failover) and disaster recovery, and can expose secondaries as **readable secondary replicas** to offload read-only reporting traffic. **Transactional replication** distributes data at the object (table/publication) level from a publisher to one or more subscribers, is more granular and flexible (can filter rows/columns, subscribe from different SQL Server versions), but doesn't provide automatic failover — it's a data-distribution mechanism, not an HA mechanism. Choose AGs for HA/DR with optional read-scale; choose transactional replication when you need selective, granular data distribution (e.g., only certain tables to a reporting server) rather than whole-database failover.

**2. SQL Query**
```sql
-- Always On AG: create the group over a mirrored/synchronized database
CREATE AVAILABILITY GROUP [AG_Trading]
    FOR DATABASE [TradingDB]
    REPLICA ON
        'SQLNODE1' WITH (
            ENDPOINT_URL = 'TCP://SQLNODE1:5022',
            AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
            FAILOVER_MODE = AUTOMATIC,
            SECONDARY_ROLE (ALLOW_CONNECTIONS = NO)
        ),
        'SQLNODE2' WITH (
            ENDPOINT_URL = 'TCP://SQLNODE2:5022',
            AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
            FAILOVER_MODE = AUTOMATIC,
            SECONDARY_ROLE (ALLOW_CONNECTIONS = READ_ONLY)   -- readable secondary for reporting
        );

-- Application routes reporting connections to the readable secondary via the AG listener + read-only routing
-- (ApplicationIntent=ReadOnly in the connection string)
```

**3. Explain the Query**
`AVAILABILITY_MODE = SYNCHRONOUS_COMMIT` on both replicas means a transaction commits on the primary only after the secondary has hardened the log record too — this is what makes automatic failover safe (no committed data is lost), at the cost of added commit latency proportional to network round-trip to the secondary. `SECONDARY_ROLE (ALLOW_CONNECTIONS = READ_ONLY)` on `SQLNODE2` turns it into a readable secondary; reporting queries connect with `ApplicationIntent=ReadOnly` and the AG listener routes them there automatically, offloading read load from the primary without touching the primary's resources.

**4. Sample Data**
N/A — this is an infrastructure/topology configuration rather than a data query.

**5. Expected Output**
Under normal operation, write traffic goes to `SQLNODE1` (primary) and read-only reporting traffic is routed to `SQLNODE2` (secondary). If `SQLNODE1` fails, the AG automatically fails over to `SQLNODE2`, which becomes the new primary with no data loss (synchronous commit) and (with proper client retry logic) minimal application-visible downtime.

**6. Alternative Solutions**
1. **Always On AG with a readable secondary** (shown) — best when you need both HA/DR *and* read-scale for the *entire* database, and can tolerate synchronous-commit latency (or accept asynchronous commit's small data-loss window for a DR-only secondary).
2. **Transactional replication to a dedicated reporting subscriber** — best when only specific tables/columns need to go to a separate reporting server, or subscribers run different SQL Server versions/editions than the publisher; provides no automatic failover, so it complements rather than replaces an HA strategy.
3. **Failover Cluster Instance (FCI)** — protects the whole SQL Server *instance* via shared storage failover (not database-level, no read-scale), appropriate when you need instance-level HA (e.g., for features AGs don't cover) but don't need a readable secondary.

I default to Always On AGs with a readable secondary for a modern HA+read-scale requirement on Standard/Enterprise edition, and reach for transactional replication specifically when the requirement is "get *this* subset of data onto *that* other system," which is a data-distribution problem, not an HA problem.

**7. Performance**
Synchronous-commit AGs add write latency equal to the round trip to the secondary's log hardening — matters most for latency-sensitive OLTP with a geographically distant secondary, which is why DR secondaries are often asynchronous (accepting a small RPO > 0) while the local HA secondary stays synchronous. Readable secondaries reduce primary load for reporting but introduce **redo-queue lag** — a secondary can be momentarily behind the primary, so read-only queries there see slightly stale data.

**8. Edge Cases**
- Readable secondaries can experience blocking from long-running reporting queries against the redo thread in older configurations — mitigated in modern SQL Server by row-versioning-based isolation on the secondary, but still worth monitoring redo-queue lag under heavy reporting load.
- Automatic failover has a decision quorum requirement (Windows Server Failover Clustering) — an even split ("split-brain") scenario must be prevented by proper quorum configuration, or you risk two nodes believing they're primary.
- Transactional replication subscribers can fall behind if the distribution agent can't keep up with publisher write volume — monitor latency, don't assume "eventually consistent" means "always caught up within seconds."

**9. Production Scenario**
A trading platform's `TradingDB` runs in a synchronous-commit AG across two nodes in the same data center for zero-data-loss automatic failover, with a third asynchronous-commit replica in a different region for disaster recovery, and read-only risk/compliance reporting queries routed to the local readable secondary so they never compete with order-execution write throughput on the primary.

**10. Interview Follow-ups**
1. What's the difference between synchronous and asynchronous commit mode in an AG?
2. Can a readable secondary become the primary automatically?
3. Why might replication be a better fit than an AG for a specific reporting use case?
4. What is RPO/RTO and how do these technologies affect each?
5. How do client applications discover which replica is currently primary?

**11. Follow-up Answers**
1. Synchronous commit waits for the secondary to harden the transaction log before committing on the primary (zero data loss, added latency); asynchronous commit returns as soon as the primary commits, sending the log record to the secondary without waiting (lower latency, small potential data loss window on failover).
2. Only if it's configured with `FAILOVER_MODE = AUTOMATIC` and part of the automatic-failover set (requires synchronous commit and cluster quorum); asynchronous-commit secondaries typically require manual failover.
3. When you need to distribute only specific tables/columns to a heterogeneous subscriber (different edition/version, or even a non-SQL-Server-only reporting pipeline via a custom subscriber), not the whole database.
4. RPO (Recovery Point Objective) is how much data you can afford to lose; RTO (Recovery Time Objective) is how long you can afford to be down. Synchronous AGs minimize RPO (near zero); automatic failover minimizes RTO; asynchronous DR replicas accept a larger RPO in exchange for geographic distance.
5. Via the AG listener (a virtual network name/IP that always points at the current primary) combined with `ApplicationIntent=ReadOnly` in the connection string for read-only routing to secondaries — the application never needs to hardcode which physical node is primary.

**12. Common Mistakes**
- Assuming a readable secondary has zero lag and using it for anything requiring read-your-own-write consistency.
- Configuring synchronous commit to a geographically distant DR site, tanking primary write latency unnecessarily.
- Treating replication as an HA solution and being surprised there's no automatic failover.

**13. Architect Insight**
The senior/architect framing separates three distinct requirements that are easy to conflate — **HA** (survive a node failure with minimal downtime), **DR** (survive a site/region failure), and **read-scale** (offload reporting load) — and picks the topology (often a combination: sync local HA + async remote DR + readable secondary for reporting) per requirement rather than assuming one technology solves all three.

**References**
1. [Overview of Always On Availability Groups](https://learn.microsoft.com/en-us/sql/database-engine/availability-groups/windows/overview-of-always-on-availability-groups-sql-server)
2. [Active secondaries: readable secondary replicas](https://learn.microsoft.com/en-us/sql/database-engine/availability-groups/windows/active-secondaries-readable-secondary-replicas-always-on-availability-groups)
3. [Transactional Replication](https://learn.microsoft.com/en-us/sql/relational-databases/replication/transactional/transactional-replication)

---

## Q124. Design an archiving strategy for a table with years of history that's slowing down day-to-day operations.

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Separate "hot" (recent, actively queried) data from "cold" (historical, rarely queried) data using table partitioning by date, then move expired partitions to an archive table via `ALTER TABLE ... SWITCH` on a schedule, keeping the archive table's data accessible (for compliance/audit queries) but off the hot table's indexes and statistics. Combine with filtered indexes on the hot table so common queries ("active" orders, "this year's" transactions) only ever touch and index recent rows.

**2. SQL Query**
```sql
-- Hot table, partitioned by month, filtered index on the recent/active window
CREATE TABLE Transactions (
    TransactionID BIGINT NOT NULL,
    TransactionDate DATE NOT NULL,
    AccountID INT NOT NULL,
    Amount DECIMAL(18,2) NOT NULL,
    Status VARCHAR(20) NOT NULL,
    CONSTRAINT PK_Transactions PRIMARY KEY (TransactionID, TransactionDate)
) ON PS_TransactionDate_Monthly(TransactionDate);

-- Filtered index: only index the operationally "active" window, keeps index small and fast
CREATE INDEX IX_Transactions_Active_AccountID
ON Transactions (AccountID, TransactionDate)
WHERE TransactionDate >= '2026-07-01';   -- rolling ~90-day active window, refreshed periodically

-- Scheduled archival job (monthly, via SQL Agent):
-- 1. Identify the oldest hot partition that has aged past the retention window
-- 2. SWITCH it into a matching Archive table (metadata-only, Q121)
ALTER TABLE Transactions SWITCH PARTITION 1 TO Transactions_Archive_202501;
```

**3. Explain the Query**
Partitioning by `TransactionDate` lets the archival job isolate exactly one month's data as a unit. The filtered index only covers the recent window that operational queries actually hit, so it stays small and cheap to maintain regardless of how many years of history the base table accumulates — historical queries against old data fall back to the full (non-filtered) primary key or a separate index on the archive table, which is fine since those queries are rarer and less latency-sensitive. The `SWITCH` step is the same metadata-only mechanism from Q121, run on a schedule instead of ad hoc.

**4. Sample Data**
`Transactions` spans January 2020 – September 2026; the filtered index only contains rows from July 2026 onward.

**5. Expected Output**
Operational queries filtering by `AccountID` and a recent date range use the small filtered index and return in milliseconds regardless of total table size; a compliance query spanning 2021–2026 still returns correct results by querying across `Transactions` + the relevant `Transactions_Archive_*` tables (via a `UNION ALL` view if transparent access is required).

**6. Alternative Solutions**
1. **Partition + switch + filtered index** (shown) — keeps everything in SQL Server, preserves queryability of history, best when audit/compliance requires the data to remain in a relational, query-able form.
2. **Export cold data to cheaper storage (e.g., Parquet files in blob storage, queried via an external/PolyBase table when needed)** — lowest ongoing SQL Server storage cost, appropriate when historical queries are rare enough that a slower external-query path is acceptable; loses transactional query performance and needs a separate tool for ad hoc historical analysis.
3. **Delete data outright past a retention period** — simplest, but only viable when there's no regulatory/audit requirement to retain it; in financial services this is rarely an option for transaction-level data (retention periods are often 5–7+ years by regulation).

I default to option 1 for regulated financial data (retention requirements make deletion a non-starter, and query-ability during audits matters), and would consider option 2 only after data ages well past any realistic audit window.

**7. Performance**
The filtered index keeps the operationally hot index's size roughly constant over time instead of growing unbounded with history — this is what keeps day-to-day query and index-maintenance (rebuild/reorganize) time bounded regardless of how many years of data the table has accumulated in total.

**8. Edge Cases**
- The filtered index's boundary (`TransactionDate >= '2026-07-01'` in the example) is a moving target — it must be periodically recreated/redefined (e.g., via a scheduled job that rebuilds it with an updated cutoff), or it silently stops covering "recent" data as time passes.
- Queries spanning both the hot table and archive tables need a `UNION ALL` view or application-level fan-out — don't assume "archived" data disappears from every possible query need (audits routinely need multi-year ranges).
- Archive tables still need their own (lighter) indexing and statistics maintenance — "archived" doesn't mean "never queried," just "queried less often and less latency-sensitively."

**9. Production Scenario**
A card-payments processor retains 7 years of transaction records for PCI-DSS and regulatory audit purposes, but 99% of day-to-day fraud-detection and customer-service queries only ever touch the last 90 days. Partitioning by transaction date, switching expired months into yearly archive tables, and maintaining a filtered "active window" index keeps the hot path fast while a `UNION ALL` compliance view still answers "show me this customer's full 7-year transaction history" correctly when auditors ask.

**10. Interview Follow-ups**
1. How do you make archived data still queryable transparently?
2. What happens to a filtered index's usefulness if its boundary isn't maintained?
3. Why not just delete old data if nobody queries it?
4. How would you handle a query that spans both hot and archive tables?
5. How does this interact with backup strategy?

**11. Follow-up Answers**
1. A `UNION ALL` view over the hot table and all archive tables (or a partitioned view) gives applications a single queryable name, at the cost of the optimizer needing to fan out across all of them for unfiltered queries — acceptable for the rarer, less latency-sensitive historical queries this path serves.
2. It silently becomes a partial index that no longer matches "recent" queries, causing the optimizer to fall back to a full scan or the base index — worth alerting on index usage stats (`sys.dm_db_index_usage_stats`) if this drifts.
3. Regulatory retention requirements (SOX, PCI-DSS, and similar financial-services obligations) typically mandate keeping transaction-level records for years regardless of query frequency — deletion isn't a business option even if it's a performance win.
4. Query both explicitly (application-level fan-out with merge) or through a `UNION ALL` view; for a rare, non-latency-sensitive path, the simpler `UNION ALL` view is usually the right trade-off.
5. Archive tables/older partitions change far less often, so they can move to a less frequent backup cadence (e.g., weekly full instead of daily) once switched, reducing backup window and storage cost for data that's effectively immutable history.

**12. Common Mistakes**
- Building an archiving strategy that makes historical data effectively unqueryable, then discovering an audit needs exactly that data.
- Letting a filtered index's boundary condition become stale and not noticing until query performance degrades.
- Archiving via row-by-row `DELETE`/`INSERT` instead of partition `SWITCH`, turning a metadata operation into an hours-long, log-heavy batch job.

**13. Architect Insight**
The architect-level answer designs the archiving strategy **backward from the retention/audit requirement**, not forward from "the table is big" — the first question is "what's the legally/contractually required retention period and what must still be queryable during that period," and the technical mechanism (partition switch, filtered index, cheaper storage tier) follows from that answer.

---

## Q125. Compare SQL Server's built-in temporal tables against a hand-rolled audit-trigger/audit-table approach for tracking historical changes.

**Difficulty:** 🔴 Senior

**1. Interview Answer**
System-versioned **temporal tables** give SQL Server–managed, automatic history tracking: every `UPDATE`/`DELETE` transparently writes the prior row version into a linked history table with period columns, and you can query "as of" any point in time with `FOR SYSTEM_TIME AS OF`. A hand-rolled **audit table + triggers** approach gives full control over what's captured (e.g., who made the change, from what application, why) but requires you to write and maintain that logic yourself, including keeping it correct as the schema evolves. Prefer temporal tables for pure point-in-time data recovery/history; add a custom audit table alongside when you also need to capture *who/why* (an actor identity, a reason code) that isn't naturally part of the row's own data.

**2. SQL Query**
```sql
-- Temporal table: automatic history, zero application code needed
CREATE TABLE AccountBalances (
    AccountID INT NOT NULL PRIMARY KEY,
    Balance DECIMAL(18,2) NOT NULL,
    ValidFrom DATETIME2 GENERATED ALWAYS AS ROW START NOT NULL,
    ValidTo DATETIME2 GENERATED ALWAYS AS ROW END NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.AccountBalances_History));

-- Query the balance as of a specific point in time — no application logic required
SELECT AccountID, Balance
FROM AccountBalances FOR SYSTEM_TIME AS OF '2026-06-15T00:00:00'
WHERE AccountID = 1001;

-- Hand-rolled audit table: captures actor/reason, not just before/after state
CREATE TABLE AccountBalances_AuditLog (
    AuditID BIGINT IDENTITY PRIMARY KEY,
    AccountID INT NOT NULL,
    OldBalance DECIMAL(18,2) NOT NULL,
    NewBalance DECIMAL(18,2) NOT NULL,
    ChangedByUserID INT NOT NULL,
    ChangeReason VARCHAR(200) NULL,
    ChangedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TRIGGER TR_AccountBalances_Audit ON AccountBalances_NoTemporal
AFTER UPDATE AS
BEGIN
    INSERT INTO AccountBalances_AuditLog (AccountID, OldBalance, NewBalance, ChangedByUserID, ChangeReason)
    SELECT i.AccountID, d.Balance, i.Balance, SESSION_CONTEXT(N'UserID'), SESSION_CONTEXT(N'ChangeReason')
    FROM inserted i JOIN deleted d ON d.AccountID = i.AccountID;
END;
```

**3. Explain the Query**
The temporal table's `ValidFrom`/`ValidTo` period columns are maintained entirely by the engine — every `UPDATE` automatically closes out the old row version into `AccountBalances_History` with the correct validity window, with no trigger or application code required, and `FOR SYSTEM_TIME AS OF` transparently queries across the current and history tables. The trigger-based audit table instead captures business context (`ChangedByUserID`, `ChangeReason`) that has no natural home in the base row itself, pulled here from `SESSION_CONTEXT` (set by the application per session) — this is the kind of metadata temporal tables cannot capture on their own since they only version the row's own columns.

**4. Sample Data**
`AccountBalances` starts at `(1001, 1000.00)`; an update to `1500.00` at `2026-06-20` closes the old temporal row (`ValidFrom` = creation, `ValidTo` = 2026-06-20) into history and opens a new current row.

**5. Expected Output**
`FOR SYSTEM_TIME AS OF '2026-06-15'` returns `Balance = 1000.00` (the value in effect then); querying the current table returns `1500.00`. The audit table separately shows *who* made the change and *why*, which the temporal history alone does not.

**6. Alternative Solutions**
1. **Temporal tables only** — zero maintenance burden, best when the requirement is purely "what did this data look like at time T," with no need for actor/reason metadata.
2. **Custom audit table + triggers only** — full control over captured metadata, but you own correctness (a missed trigger update path after a schema change silently breaks history capture) and must build your own "as of" query logic.
3. **Both together** (shown) — temporal table gives free point-in-time recovery/debugging; audit table gives the compliance-grade "who/why" record — the two serve different questions and are not mutually exclusive.

I recommend temporal tables as the default for any table where "what changed and when" matters, and layering a custom audit table on top only when a specific compliance or business requirement needs actor/reason capture that temporal tables can't provide natively.

**7. Performance**
Temporal tables add a write-time cost proportional to closing out the old row version (an additional insert into the history table per update) — for high-frequency-update tables (e.g., a live balance updated on every transaction) this can be significant, and history tables should themselves be indexed and, ideally, partitioned by `ValidTo` for retention management, mirroring Q124's archiving pattern. Trigger-based audit adds similar per-write overhead plus the cost of whatever logic the trigger executes.

**8. Edge Cases**
- Temporal tables do **not** capture `TRUNCATE TABLE` or certain bulk operations the same way row-by-row `UPDATE`/`DELETE` are captured — verify behavior for your specific bulk-load path.
- History tables grow unbounded by default — pair with a retention policy (`HISTORY_RETENTION_PERIOD` or a scheduled cleanup) or they become their own Q124-style archiving problem.
- Triggers fire per statement, not per row, by default in the way they're written — the `INSERTED`/`DELETED` pseudo-tables can contain multiple rows for a multi-row `UPDATE`, and a trigger written assuming single-row semantics silently loses audit records on bulk updates. Always write set-based trigger logic (as in the example, joining `inserted`/`deleted`) rather than assuming one row.

**9. Production Scenario**
A core-banking `AccountBalances` table uses system-versioned temporal tables so any dispute ("what was my balance on this date") can be answered directly with `FOR SYSTEM_TIME AS OF`, while a separate compliance audit table captures which teller or system process authorized each adjustment — satisfying both operational debugging needs and regulatory audit-trail requirements (SOX/PCI-DSS-style change-management expectations) with two purpose-built mechanisms rather than overloading one.

**10. Interview Follow-ups**
1. Does a temporal table capture who made a change?
2. What happens to temporal history on a `TRUNCATE TABLE`?
3. How would you purge old temporal history for storage/compliance reasons?
4. What's a common trigger-writing mistake that breaks audit correctness under bulk updates?
5. Can you make a temporal table's history queryable alongside a custom audit table in one report?

**11. Follow-up Answers**
1. No — only the row's own column values and the validity period; actor/reason metadata requires a separate mechanism (`SESSION_CONTEXT` + trigger/audit table, or an application-level audit log).
2. Temporal tables restrict/block certain schema and bulk operations specifically to prevent silently losing history — check current behavior for your SQL Server version before relying on any bulk path with a temporal table.
3. `ALTER TABLE ... SET (SYSTEM_VERSIONING = ON (HISTORY_RETENTION_PERIOD = 7 YEARS))`, or manually archive/delete from the history table on a schedule, mirroring Q124's partition-and-switch pattern for the history table itself.
4. Assuming `INSERTED`/`DELETED` contain exactly one row and writing scalar (non-set-based) logic — this silently drops audit rows the first time someone runs a multi-row `UPDATE`.
5. Yes — join `AccountBalances FOR SYSTEM_TIME ALL` (or `BETWEEN`/`AS OF`) against `AccountBalances_AuditLog` on `AccountID` and overlapping time ranges to reconstruct a complete "what changed, when, and by whom" report.

**12. Common Mistakes**
- Assuming temporal tables are a complete audit solution when a compliance requirement actually needs actor/reason capture.
- Writing row-by-row-assuming triggers that silently under-count on bulk updates.
- Letting history tables grow forever with no retention policy, turning them into the next performance problem.

**13. Architect Insight**
The architect-level distinction is that temporal tables answer **"what was the data"** and audit tables answer **"who changed it and why"** — these are different questions with different regulatory weight (a SOX auditor typically wants both), and conflating them leads to either an over-engineered custom system reinventing what temporal tables give for free, or a compliance gap where "who approved this" was assumed to be answerable but never actually captured.

**References**
1. [Temporal Tables — Overview](https://learn.microsoft.com/en-us/sql/relational-databases/tables/temporal/overview)
2. [Get started with system-versioned temporal tables](https://learn.microsoft.com/en-us/sql/relational-databases/tables/getting-started-with-system-versioned-temporal-tables)

---

## Q126. Soft deletes vs. hard deletes, and how would you design a multi-tenant database schema?

**Difficulty:** 🔴 Senior / 🔥 Architect (multi-tenant scaling decision)

**1. Interview Answer**
A **soft delete** marks a row inactive (e.g., `IsDeleted BIT` or `DeletedAt DATETIME2 NULL`) instead of physically removing it, preserving history, satisfying audit requirements, and avoiding foreign-key cascade complications — at the cost of every query needing to filter out deleted rows (best hidden behind a view or a filtered index). A **hard delete** physically removes the row, which is simpler and reclaims space immediately but destroys history irrecoverably. For multi-tenant design, the three standard options are **shared schema with a `TenantID` column** (cheapest, hardest to isolate), **schema-per-tenant** (moderate isolation, moderate operational cost), and **database-per-tenant** (strongest isolation, highest operational cost) — the right choice depends on tenant count, per-tenant data volume, and compliance/isolation requirements.

**2. SQL Query**
```sql
-- Soft delete: never physically remove, filter via a view + filtered index
CREATE TABLE Customers (
    CustomerID INT IDENTITY PRIMARY KEY,
    TenantID INT NOT NULL,
    CustomerName VARCHAR(100) NOT NULL,
    IsDeleted BIT NOT NULL DEFAULT 0,
    DeletedAt DATETIME2 NULL
);
CREATE INDEX IX_Customers_Active ON Customers (TenantID, CustomerName) WHERE IsDeleted = 0;
CREATE VIEW ActiveCustomers AS
    SELECT * FROM Customers WHERE IsDeleted = 0;

-- "Deleting" a customer:
UPDATE Customers SET IsDeleted = 1, DeletedAt = SYSUTCDATETIME() WHERE CustomerID = 42;

-- Multi-tenant, shared-schema design: every table carries TenantID, enforced via Row-Level Security
CREATE TABLE Orders (
    OrderID INT IDENTITY PRIMARY KEY,
    TenantID INT NOT NULL,
    CustomerID INT NOT NULL,
    OrderTotal DECIMAL(18,2) NOT NULL
);

CREATE FUNCTION dbo.fn_TenantAccessPredicate(@TenantID INT)
RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS AccessResult WHERE @TenantID = CAST(SESSION_CONTEXT(N'TenantID') AS INT);

CREATE SECURITY POLICY TenantIsolationPolicy
ADD FILTER PREDICATE dbo.fn_TenantAccessPredicate(TenantID) ON dbo.Orders,
ADD BLOCK PREDICATE dbo.fn_TenantAccessPredicate(TenantID) ON dbo.Orders AFTER INSERT
WITH (STATE = ON);
```

**3. Explain the Query**
The soft-delete pattern keeps `Customers` rows physically present but hides them from normal use via `ActiveCustomers` and speeds up "active only" queries with a filtered index that excludes deleted rows entirely from the index structure (small, fast, matches the common-case query). The multi-tenant example uses **Row-Level Security (RLS)**: every table carries `TenantID`, and a security policy with a filter/block predicate transparently restricts every query and write to the tenant set in `SESSION_CONTEXT` — application code doesn't need to remember to add `WHERE TenantID = @CurrentTenant` everywhere (a common and dangerous class of bug), because the engine enforces it centrally.

**4. Sample Data**
`Customers`: `(42, 5, 'Old Corp', 0, NULL)`. After the soft delete: `(42, 5, 'Old Corp', 1, '2026-09-13T10:00:00')`. `ActiveCustomers` no longer returns row 42.

**5. Expected Output**
Any query against `Orders` from a session with `SESSION_CONTEXT('TenantID') = 5` only ever sees Tenant 5's rows, even if the application query has no `WHERE TenantID` clause at all — RLS enforces it transparently, and any attempted `INSERT` for a different tenant is blocked.

**6. Alternative Solutions — Soft vs. Hard Delete**
1. **Soft delete via flag/filtered index/view** (shown) — best default for anything with audit, "undo," or reporting-on-history requirements (which includes virtually all financial and most enterprise data).
2. **Hard delete** — appropriate for genuinely transient data with no compliance requirement (e.g., expired session tokens, temp processing rows) where keeping history has zero value and reclaiming space matters.
3. **Soft delete + scheduled hard-delete purge past a retention window** — the common hybrid: soft-delete immediately for safety/undo, then hard-delete (or archive per Q124) after the data ages past both the business "undo" window and any compliance retention requirement.

**Alternative Solutions — Multi-Tenant Design**
1. **Shared schema + `TenantID` + Row-Level Security** (shown) — cheapest to operate (one schema, one set of migrations, one backup), scales to many small tenants easily, but "noisy neighbor" tenants share the same resources and a schema bug in RLS is a cross-tenant data leak risk.
2. **Schema-per-tenant** — moderate isolation (separate namespace per tenant within one database), easier per-tenant customization, but migrations must run per-schema and the schema count itself becomes an operational scaling axis.
3. **Database-per-tenant** — strongest isolation (separate backup/restore, separate resource governance, easiest to satisfy a "your data must be physically separate" compliance demand), but the highest per-tenant operational cost — hundreds or thousands of tenants means hundreds or thousands of databases to patch, monitor, and back up.

I default to shared-schema + RLS for a large number of small-to-medium tenants where operational simplicity matters most, and move to database-per-tenant specifically when a compliance/contractual requirement demands physical data isolation (common in financial-services enterprise contracts) or when a handful of very large tenants would otherwise dominate a shared instance's resources.

**7. Performance**
Filtered indexes on `IsDeleted = 0` keep "active row" queries fast regardless of how much soft-deleted history accumulates. RLS predicates are evaluated as an inline table-valued function folded into the query plan — a `SCHEMABINDING` scalar/simple predicate function is essential so the optimizer can treat it efficiently (a non-inlineable predicate function can silently force scans); always verify the execution plan shows the predicate being applied efficiently (e.g., via an index seek on `TenantID`) rather than being applied after a full scan.

**8. Edge Cases**
- Soft-deleted rows still count against `UNIQUE` constraints unless the constraint itself is filtered (e.g., `CREATE UNIQUE INDEX ... WHERE IsDeleted = 0`) — otherwise you can't "re-create" a customer with the same natural key after soft-deleting the original.
- RLS predicates must cover **every** access path, including ad hoc queries run by DBAs/support staff with elevated permissions — decide explicitly whether `db_owner`/sysadmin sessions bypass RLS (they do, by default, unless the policy is designed to also apply to elevated roles) and treat that as a deliberate, reviewed decision, not an oversight.
- Multi-tenant shared-schema designs must ensure `SESSION_CONTEXT('TenantID')` is set correctly and can't be forged by application code — this is a security-critical trust boundary, not just a convenience filter.

**9. Production Scenario**
A B2B SaaS billing platform serving thousands of small-to-mid-size corporate clients uses shared-schema + RLS for cost efficiency across the long tail of small tenants, while its largest enterprise clients — who contractually require physically isolated data for their own compliance reasons — are provisioned on dedicated database-per-tenant instances, giving the platform a tiered isolation model matched to actual contractual/compliance requirements rather than one-size-fits-all.

**10. Interview Follow-ups**
1. Does Row-Level Security protect against a `sysadmin` querying the table directly?
2. How do you handle a `UNIQUE` constraint with soft deletes?
3. What's the operational cost difference between schema-per-tenant and database-per-tenant at 1,000 tenants?
4. How would you migrate a tenant from shared-schema to its own dedicated database later?
5. Can RLS predicates hurt query performance?

**11. Follow-up Answers**
1. Not by default — `sysadmin`/`db_owner` and users with `UNMASK`/bypass-equivalent privileges can see all rows unless the policy is explicitly designed with `SCHEMABINDING` and no bypass role exemptions considered acceptable; treat RLS as defense against *application-layer* query mistakes, not as a substitute for tightly controlling who holds elevated database roles.
2. Use a **filtered unique index** (`WHERE IsDeleted = 0`) instead of a plain `UNIQUE` constraint, so uniqueness is enforced only among active rows, allowing a natural key to be reused after its original row is soft-deleted.
3. Schema-per-tenant at 1,000 tenants means 1,000 schemas to migrate (typically scriptable and manageable in one database); database-per-tenant means 1,000 separate databases to back up, patch, and monitor independently — an order of magnitude more operational surface area, usually requiring dedicated tooling/automation to manage at that scale.
4. Export the tenant's rows (filtered by `TenantID`) from the shared schema, provision a new dedicated database with identical schema, bulk-load the data, cut the application's tenant-routing config over to the new connection string, then soft/hard-delete the tenant's rows from the shared schema after verifying the migration — done during a maintenance window or with dual-write/backfill for zero downtime.
5. Yes, if the predicate function isn't simple/inlineable (`SCHEMABINDING` with straightforward logic) — a complex predicate can prevent the optimizer from pushing the filter down efficiently, so always check the execution plan after adding RLS to a hot table.

**12. Common Mistakes**
- Using a plain `UNIQUE` constraint alongside soft deletes and being unable to reuse a natural key.
- Assuming RLS alone is sufficient security without also controlling who holds elevated roles that bypass it.
- Choosing database-per-tenant "for safety" without weighing the real operational cost at scale, or choosing shared-schema without a credible RLS enforcement story.

**13. Architect Insight**
The architect-level answer treats soft-delete-vs-hard-delete and shared-vs-isolated multi-tenancy as **the same class of decision**: how much isolation/history do you need, and what will you pay operationally for it. The strongest answers name the actual driver — compliance/contract requirements, tenant-count-vs-tenant-size distribution, audit obligations — rather than picking the "safer-sounding" option by default, because over-isolating (database-per-tenant for 10,000 small tenants) is its own expensive mistake.

**References**
1. [Primary and foreign key constraints](https://learn.microsoft.com/en-us/sql/relational-databases/tables/primary-and-foreign-key-constraints)
2. [Unique constraints and check constraints](https://learn.microsoft.com/en-us/sql/relational-databases/tables/unique-constraints-and-check-constraints)
3. [Partitioned Tables and Indexes](https://learn.microsoft.com/en-us/sql/relational-databases/partitions/partitioned-tables-and-indexes)
4. [ALTER TABLE (Transact-SQL) — SWITCH](https://learn.microsoft.com/en-us/sql/t-sql/statements/alter-table-transact-sql)
5. [Overview of Always On Availability Groups](https://learn.microsoft.com/en-us/sql/database-engine/availability-groups/windows/overview-of-always-on-availability-groups-sql-server)
6. [Active secondaries: readable secondary replicas](https://learn.microsoft.com/en-us/sql/database-engine/availability-groups/windows/active-secondaries-readable-secondary-replicas-always-on-availability-groups)
7. [Transactional Replication](https://learn.microsoft.com/en-us/sql/relational-databases/replication/transactional/transactional-replication)
8. [Temporal Tables — Overview](https://learn.microsoft.com/en-us/sql/relational-databases/tables/temporal/overview)
9. [Get started with system-versioned temporal tables](https://learn.microsoft.com/en-us/sql/relational-databases/tables/getting-started-with-system-versioned-temporal-tables)

---

**Next in workbook:** [[13-SQL-and-Microservices]] — database-per-service, distributed transactions, transactional outbox, and CDC.
