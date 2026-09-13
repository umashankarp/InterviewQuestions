> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: [[14-SQL-and-FinTech]] (assumes the full workbook — Q1–Q145 — has been studied first)

# SQL Server Interview Workbook — Interview Challenge Mode

This file does not contain answers. It is the operating manual and question bank for the interactive challenge mode that follows the worked workbook (files `03` through `14`, Q1–Q145). Studying the answered questions builds recognition; this mode tests whether that knowledge transfers to a problem you haven't seen phrased exactly this way before.

## How This Mode Works

1. **One question at a time.** The interviewer (Claude, acting as the Senior SQL Server Database Architect / Technical Interviewer persona from the workbook brief) presents a single prompt from the bank below, or a variation of one.
2. **No answer is shown up front.** The candidate writes T-SQL against the canonical schema and submits it before seeing anything — no query, no hint, no "here's the shape of the solution."
3. **The interviewer waits.** If the candidate asks for a hint, the interviewer may give one small nudge (e.g., "think about what happens with ties") without revealing the query or the approach.
4. **Scoring happens only after submission**, across five dimensions, each out of 10 (see Scoring Rubric Reference below).
5. **Feedback follows a fixed structure** every time: what was done correctly → what was missed → the correct query → a better/optimized query if one exists → an explanation of the difference → an interviewer follow-up question that probes the same concept from a different angle (e.g., "what changes if this column is nullable?" or "what does the execution plan look like once the table hits 200M rows?").
6. **Difficulty ramps up.** The session starts at 🟢 Basic and moves toward 🔥 Architect as the candidate demonstrates competence — mirroring how a real 90-minute panel loop escalates rather than randomizing difficulty.
7. **A weak answer is challenged, not passed.** Per the workbook's Elite FinTech Interview Panel calibration, a technically-correct-but-naive answer (e.g., a correlated subquery that works but wouldn't survive at scale) is followed up on before moving to the next question, the same way a real Principal Engineer interviewer would push back before letting a shallow answer stand.

No query, sample data, or expected output for any bank question below is given anywhere in this file — that would let the candidate look up the answer instead of deriving it, defeating the purpose of the mode.

## Canonical Sample Schema

The same four schema groups used throughout the answered workbook (files `03`–`14`). Reproduced here so this file is self-contained and a challenge session doesn't require flipping back to another file mid-interview.

```sql
-- HR schema
CREATE TABLE Departments (
    DepartmentID   INT PRIMARY KEY,
    DepartmentName VARCHAR(100) NOT NULL
);

CREATE TABLE Employees (
    EmployeeID   INT PRIMARY KEY,
    FirstName    VARCHAR(50)  NOT NULL,
    LastName     VARCHAR(50)  NOT NULL,
    DepartmentID INT NULL REFERENCES Departments(DepartmentID),
    ManagerID    INT NULL REFERENCES Employees(EmployeeID),
    Salary       DECIMAL(12,2) NOT NULL,
    HireDate     DATE NOT NULL
);

-- Sales schema
CREATE TABLE Categories (
    CategoryID   INT PRIMARY KEY,
    CategoryName VARCHAR(100) NOT NULL
);

CREATE TABLE Products (
    ProductID   INT PRIMARY KEY,
    ProductName VARCHAR(100) NOT NULL,
    CategoryID  INT NOT NULL REFERENCES Categories(CategoryID),
    Price       DECIMAL(12,2) NOT NULL
);

CREATE TABLE Customers (
    CustomerID   INT PRIMARY KEY,
    CustomerName VARCHAR(100) NOT NULL,
    Country      VARCHAR(50) NOT NULL
);

CREATE TABLE Orders (
    OrderID     INT PRIMARY KEY,
    CustomerID  INT NOT NULL REFERENCES Customers(CustomerID),
    OrderDate   DATE NOT NULL,
    TotalAmount DECIMAL(12,2) NOT NULL
);

CREATE TABLE OrderItems (
    OrderItemID INT PRIMARY KEY,
    OrderID     INT NOT NULL REFERENCES Orders(OrderID),
    ProductID   INT NOT NULL REFERENCES Products(ProductID),
    Quantity    INT NOT NULL,
    UnitPrice   DECIMAL(12,2) NOT NULL
);

-- Events schema
CREATE TABLE UserLogins (
    UserID    INT NOT NULL,
    LoginDate DATE NOT NULL
);

CREATE TABLE UserEvents (
    UserID    INT NOT NULL,
    EventType VARCHAR(50) NOT NULL,
    EventTime DATETIME2 NOT NULL
);

-- FinTech schema
CREATE TABLE Accounts (
    AccountID  INT PRIMARY KEY,
    CustomerID INT NOT NULL REFERENCES Customers(CustomerID),
    Balance    DECIMAL(18,2) NOT NULL,
    Currency   CHAR(3) NOT NULL
);

CREATE TABLE Transactions (
    TransactionID   INT PRIMARY KEY,
    AccountID       INT NOT NULL REFERENCES Accounts(AccountID),
    Amount          DECIMAL(18,2) NOT NULL,
    TransactionType VARCHAR(20) NOT NULL,   -- e.g. DEBIT, CREDIT, REVERSAL
    Status          VARCHAR(20) NOT NULL,   -- e.g. PENDING, SUCCESS, FAILED
    CreatedAt       DATETIME2 NOT NULL,
    IdempotencyKey  VARCHAR(64) NULL
);

CREATE TABLE LedgerEntries (
    LedgerEntryID INT PRIMARY KEY,
    AccountID     INT NOT NULL REFERENCES Accounts(AccountID),
    TransactionID INT NOT NULL REFERENCES Transactions(TransactionID),
    DebitAmount   DECIMAL(18,2) NOT NULL DEFAULT 0,
    CreditAmount  DECIMAL(18,2) NOT NULL DEFAULT 0,
    EntryDate     DATETIME2 NOT NULL
);
```

## Practice Question Bank

30 prompts, ordered easy → hard. Each names only the scenario and the tables involved — no query, no sample rows, no expected output.

### 🟢 Basic

1. **B1.** Using `Employees` and `Departments`, list every employee's full name alongside their department name. Make sure employees with no assigned department still appear, with the department shown as unknown. *Tables: Employees, Departments.*
2. **B2.** Return each department's headcount and average salary, but only for departments with more than 3 employees. *Tables: Employees, Departments.*
3. **B3.** List all customers from the `Customers` table who are based in a country of your choosing, ordered alphabetically by name. *Tables: Customers.*
4. **B4.** For each order in `Orders`, show the order ID, order date, and a label of "Recent" if placed in the last 30 days relative to the most recent order date in the table, otherwise "Older." *Tables: Orders.*
5. **B5.** Find every product in `Products` that has never appeared in `OrderItems`. *Tables: Products, OrderItems.*
6. **B6.** Count how many distinct customers placed at least one order in each calendar year present in `Orders`. *Tables: Orders.*
7. **B7.** Write a query that returns each employee's salary alongside the company-wide average salary, without using a subquery in the `WHERE` clause. *Tables: Employees.*

### 🟡 Intermediate

8. **I1.** Find employees whose salary is above the average salary of their own department (not the company-wide average). *Tables: Employees.*
9. **I2.** Using a CTE, build a two-level view of the org chart: employee, their manager's name, and their manager's manager's name. Handle employees with no manager or no grand-manager gracefully. *Tables: Employees.*
10. **I3.** For each customer, find their most expensive single order (by `TotalAmount`), breaking ties by the earliest `OrderDate`. *Tables: Customers, Orders.*
11. **I4.** Rank products within each category by price, and return only the second-cheapest product per category. *Tables: Products, Categories.*
12. **I5.** Find customers who have placed orders in at least 3 different calendar months. *Tables: Customers, Orders.*
13. **I6.** For each account in `Accounts`, compute a running balance over its `Transactions` ordered by `CreatedAt`, and flag any point where the running balance would go negative. *Tables: Accounts, Transactions.*
14. **I7.** Find pairs of employees who share the same manager and were hired within 30 days of each other. *Tables: Employees.*
15. **I8.** Using `UserLogins`, find users who logged in on both the first and last calendar day of at least one month. *Tables: UserLogins.*
16. **I9.** Write a query that returns, for every department, the name of the most recently hired employee — without using `TOP` or `LIMIT`. *Tables: Employees, Departments.*

### 🔴 Senior

17. **S1.** In `UserLogins`, identify every user's longest unbroken streak of consecutive login days, and return only users whose longest streak is at least 5 days. *Tables: UserLogins.*
18. **S2.** Find all products whose total monthly sales quantity (from `OrderItems`/`Orders`) increased for at least 3 consecutive months. *Tables: Products, Orders, OrderItems.*
19. **S3.** For each customer, find the number of days between their first order and their second order — and separately, the average of that gap across all customers who have placed at least two orders. *Tables: Customers, Orders.*
20. **S4.** A colleague's query joins `Orders` to `OrderItems` to `Products` and filters on `UPPER(ProductName) = 'WIDGET'`, and it recently started running as a table scan instead of an index seek even though `ProductName` is indexed. Explain what's likely happening and how you'd confirm it, then propose a fix. *Tables: Products, Orders, OrderItems (conceptual/diagnostic — no data manipulation required).*
21. **S5.** Two application threads each read an account's balance in `Accounts`, both calculate a new balance after a debit, and both write it back. Design the transaction/isolation approach that prevents the classic lost-update problem here, and state which isolation level or locking hint you'd use and why. *Tables: Accounts, Transactions.*
22. **S6.** Find every gap of more than 2 consecutive calendar days where a given `AccountID` had zero transactions, across the full date range the account has been active. *Tables: Accounts, Transactions.*
23. **S7.** Using `UserEvents`, find every user who triggered an event of type `'ERROR'` within 5 minutes of an event of type `'CHECKOUT_START'`, without ever triggering `'CHECKOUT_COMPLETE'` in between. *Tables: UserEvents.*
24. **S8.** For each department, return the employee(s) whose salary is closest to (but not exceeding) the department's median salary. *Tables: Employees, Departments.*
25. **S9.** A batch job inserts thousands of rows per second into `Transactions` and you're seeing frequent deadlocks between it and a reporting query that reads the same table. Walk through how you'd diagnose which resources are involved and at least two structurally different fixes (not just "add `NOLOCK`"). *Tables: Transactions (conceptual/diagnostic).*

### 🔥 Architect

26. **A1.** Find every customer who has purchased at least one product from every category that exists in the `Categories` table. *Tables: Customers, Orders, OrderItems, Products, Categories.*
27. **A2.** Design a reconciliation query: you receive a nightly settlement file (assume it lands in a staging table `SettlementFile(TransactionID, ExternalStatus, ExternalAmount)`) and must classify every row in `Transactions` for that day into MATCHED, AMOUNT_MISMATCH, MISSING_INTERNALLY, or MISSING_EXTERNALLY. Describe the query approach and the indexing you'd want on both sides. *Tables: Transactions, LedgerEntries (+ a hypothetical SettlementFile staging table).*
28. **A3.** You're asked to add idempotency to payment submission so that retried client requests with the same `IdempotencyKey` never create a duplicate transaction, under concurrent load. Design the constraint/query pattern that guarantees this at the database level, and explain what happens when two concurrent requests race on the same key. *Tables: Transactions.*
29. **A4.** A 500-million-row `Transactions` table needs to support both fast recent-activity lookups (last 30 days, sub-second) and occasional multi-year audit queries. Propose a partitioning/indexing/archiving strategy, and state what trade-off you're accepting. *Tables: Transactions, LedgerEntries.*
30. **A5.** Propose a schema change to `Accounts`/`LedgerEntries` that would let you prove, for any historical point in time, that debits equal credits for a given account — i.e., support a full audit replay — without recomputing from the entire transaction history each time. Justify the trade-off in storage and write complexity. *Tables: Accounts, LedgerEntries, Transactions.*

## Scoring Rubric Reference

Use this checklist for every submitted answer in this mode, in this order:

| Dimension | /10 | What it evaluates |
|---|---|---|
| Correctness | /10 | Does the query return the right result set, including edge cases (NULLs, ties, empty inputs)? |
| Query Quality | /10 | Is it readable, maintainable, appropriately simple — not cleverness for its own sake? |
| Performance | /10 | Would it scale — right join strategy, SARGable predicates, no unnecessary scans, sensible use of indexes? |
| Edge Cases | /10 | Did the candidate proactively address NULLs, duplicates, empty tables, concurrent modification, ties? |
| Senior-Level Reasoning | /10 | Did the candidate explain trade-offs, name the execution-plan shape they'd expect, and distinguish "correct" from "production-optimized" unprompted? |

After scoring, always give, in this exact order:
1. What was done correctly
2. What was missed
3. The correct query
4. A better/optimized query, if one exists, with the reason it's better
5. An explanation of the difference
6. One interviewer follow-up question that pushes on the same concept from a new angle

Never skip straight to the correct query without the scoring and the "what was done correctly" step first — the point of the mode is calibrated feedback, not just answer-checking.
