> Domain: SQL Server | Level: Beginner → Expert | Prerequisite: [[13-SQL-and-Microservices]]

# SQL Server Interview Workbook — SQL Server in FinTech (Payments, Ledgers & Reconciliation)

Written through the Elite FinTech Interview Panel lens (JPMorgan Chase, Goldman Sachs, Visa, Stripe, BlackRock, Nasdaq-tier calibration). Every question in this file assumes the data at stake is money: correctness, auditability, and regulatory defensibility (SOX/PCI-DSS) are never optional extras here — they are the actual requirement the schema and queries exist to satisfy.

**Canonical FinTech schema used throughout this file** (extends the schema introduced in [[13-SQL-and-Microservices]]):

```sql
CREATE TABLE dbo.Accounts (
    AccountID    INT IDENTITY PRIMARY KEY,
    CustomerID   INT NOT NULL,
    Balance      DECIMAL(18,2) NOT NULL DEFAULT 0,   -- see Q138 for why a stored balance needs care
    Currency     CHAR(3) NOT NULL DEFAULT 'USD'
);

CREATE TABLE dbo.Transactions (
    TransactionID   BIGINT IDENTITY PRIMARY KEY,
    AccountID       INT NOT NULL,
    Amount          DECIMAL(18,2) NOT NULL,
    TransactionType VARCHAR(20) NOT NULL,   -- 'PAYMENT', 'REFUND', 'REVERSAL', ...
    Status          VARCHAR(20) NOT NULL,   -- see Q136 lifecycle
    CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    IdempotencyKey  UNIQUEIDENTIFIER NOT NULL
);

CREATE TABLE dbo.LedgerEntries (
    LedgerEntryID INT IDENTITY PRIMARY KEY,
    AccountID     INT NOT NULL,
    TransactionID BIGINT NOT NULL,
    DebitAmount   DECIMAL(18,2) NOT NULL DEFAULT 0,
    CreditAmount  DECIMAL(18,2) NOT NULL DEFAULT 0,
    EntryDate     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
```

---

### Q136. How do you model payment transactions, including their status lifecycle, and why store amounts as `DECIMAL`, never `FLOAT`?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
A payment transaction needs a schema that captures the amount, the parties, an explicit state machine, and enough metadata to answer "what happened and when" months later for an audit. Every monetary amount is `DECIMAL(p,s)`, never `FLOAT`/`REAL`, because floating-point types are binary approximations — they can't represent values like `0.10` exactly, and repeated arithmetic compounds that error until a ledger that should balance to the cent doesn't.

**2. SQL Query**
```sql
CREATE TABLE dbo.PaymentTransactions (
    PaymentID       BIGINT IDENTITY PRIMARY KEY,
    AccountID       INT NOT NULL,
    Amount          DECIMAL(18,2) NOT NULL CHECK (Amount > 0),
    Currency        CHAR(3) NOT NULL,
    Status          VARCHAR(20) NOT NULL
        CHECK (Status IN ('INITIATED','AUTHORIZED','CAPTURED','SETTLED','FAILED','REVERSED')),
    IdempotencyKey  UNIQUEIDENTIFIER NOT NULL,
    CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_PaymentTransactions_IdempotencyKey UNIQUE (IdempotencyKey)
);

-- Demonstrating why FLOAT is the wrong choice:
DECLARE @f FLOAT = 0.1 + 0.2;
SELECT @f AS FloatResult;                 -- 0.300000000000000044... territory, not exactly 0.3
DECLARE @d DECIMAL(18,2) = 0.1 + 0.2;
SELECT @d AS DecimalResult;               -- exactly 0.30
```

**3. Explain the Query**
The `CHECK` constraint on `Status` makes the state machine explicit and enforced by the engine, not just by convention in application code — an `UPDATE` attempting an invalid status value is rejected at the database, not discovered later by a report. `DECIMAL(18,2)` stores the value as an exact base-10 number (18 total digits, 2 after the decimal point); `FLOAT` stores an IEEE-754 binary approximation, which is why `0.1 + 0.2` in `FLOAT` doesn't equal exactly `0.3` — an error that's invisible on one row and catastrophic summed across millions.

**4. Sample Data**
`PaymentTransactions(5001, 301, 249.99, 'USD', 'CAPTURED', 'a1b2...', '2026-09-13T10:00:00', '2026-09-13T10:00:05')`.

**5. Expected Output**
`FloatResult` prints something like `0.3` on screen but is *not* bit-for-bit equal to the literal `0.3` internally (comparisons and repeated summation expose the drift); `DecimalResult` is exactly `0.30`.

**6. Alternative Solutions**
- **`FLOAT`/`REAL`** — never appropriate for money; included here only to demonstrate why it's wrong.
- **Store amount as an integer count of the smallest currency unit (cents)** — `AmountMinorUnits BIGINT` storing `24999` for `$249.99` — a legitimate, exact alternative used by some payment platforms (e.g., Stripe's API) specifically to avoid any ambiguity about decimal placement; requires consistent conversion logic at every boundary.
- **`DECIMAL(18,2)` (shown above)** — exact, human-readable in T-SQL and tooling without conversion, and SQL Server's native recommended type for exact numeric data.
I prefer `DECIMAL` for the database layer (readability in ad-hoc queries, reports, and DBA tooling) with the minor-units-integer representation reserved for wire-format/API payloads where some ecosystems (card networks, some SDKs) expect it — the two aren't mutually exclusive, they're conversion boundaries.

**7. Performance**
`DECIMAL(18,2)` is a fixed-size numeric type with predictable storage (5–9 bytes depending on precision) and index-friendly, deterministic comparisons — unlike `FLOAT`, which can produce different results depending on the order of operations, making it actively dangerous as an index key or a `GROUP BY`/equality-comparison column for financial aggregates.

**8. Edge Cases**
- `Amount <= 0` — the `CHECK` constraint rejects zero/negative payment amounts at the source; refunds/reversals should be modeled as their own `TransactionType` with their own sign convention in the ledger (see Q137), not as a "negative payment."
- Currency mismatches — comparing or summing `Amount` across rows with different `Currency` values without conversion is a silent correctness bug the schema alone can't prevent; application/reporting logic must always group by `Currency` first.
- A status transition that skips states (`INITIATED` → `SETTLED` with no `AUTHORIZED`/`CAPTURED` in between) — the `CHECK` constraint permits any listed value but not sequencing; enforcing valid *transitions* (not just valid values) typically needs either application-layer state-machine logic or a trigger comparing old/new `Status`.

**9. Production Scenario**
A card-payment service's `PaymentTransactions.Status` column drives which downstream actions are legal — a refund can only be issued against a `SETTLED` payment, a capture only against an `AUTHORIZED` one — and the `CHECK` constraint plus an audit trigger recording every status transition (Q141) together give operations and audit teams a queryable, tamper-evident record of exactly how every payment moved through its lifecycle.

**10. Interview Follow-ups**
- Why not use `MONEY`/`SMALLMONEY`, SQL Server's dedicated currency types?
- How would you enforce valid state *transitions*, not just valid state values?
- How do you handle multi-currency amounts in aggregate reporting?

**11. Follow-up Answers**
- `MONEY` has a fixed 4-decimal-place scale and rounding behavior that doesn't match every currency's conventions, and Microsoft's own guidance favors `DECIMAL`/`NUMERIC` for financial calculations specifically because of `MONEY`'s documented precision-loss behavior in intermediate calculations — `DECIMAL(18,2)` (or more decimal places for currencies/instruments that need them) gives explicit, predictable control.
- A trigger (or, cleaner, application-layer domain logic backed by a lookup table of `(FromStatus, ToStatus)` valid pairs checked before every `UPDATE`) rejects illegal transitions; some teams model this as an explicit `PaymentStatusHistory` table with its own insert-only constraint instead of mutating `Status` in place at all.
- Store `Currency` alongside every amount, never aggregate raw amounts across currencies, and convert to a common reporting currency at query time (or via a separate FX-rate-aware reporting pipeline) using rates captured *as of the transaction date*, not today's rate — mixing historical amounts with a current FX rate is a common and serious reporting bug.

**12. Common Mistakes**
Using `FLOAT` "because it's simpler with existing float-based application code," or using `MONEY` without understanding its rounding semantics — both are the kind of shortcut that looks fine in development with small numbers and produces reconciliation breaks (Q135, Q139) that take days to trace back to a data-type choice.

**13. Architect Insight**
A Staff engineer knows "use `DECIMAL` for money." A Principal/Architect can explain, from the IEEE-754 representation up, *why* `FLOAT` fails for this use case, and treats the choice of numeric type as a correctness decision made once at schema design time — not something ever revisited per-query — because retrofitting a type change onto a live financial table is one of the highest-risk migrations a team can undertake.

---

### Q137. How do you design a double-entry ledger in SQL Server, and how do you enforce that debits always equal credits?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
Double-entry accounting means every economic event produces at least two `LedgerEntries` rows — a debit to one account and an equal credit to another — so the ledger is self-balancing by construction, not by hope. In SQL Server, you enforce "this transaction's entries balance" by writing all of a transaction's ledger rows inside one database transaction and verifying `SUM(Debit) = SUM(Credit)` for that transaction before commit — either in application code immediately before `COMMIT`, or via a constraint/trigger that makes an unbalanced set physically impossible to persist.

**2. SQL Query**
```sql
-- A $100 payment from Account 301 (customer) settling into Account 900 (merchant clearing)
BEGIN TRANSACTION;
    DECLARE @TxnID BIGINT;
    INSERT INTO dbo.Transactions (AccountID, Amount, TransactionType, Status, IdempotencyKey)
    VALUES (301, 100.00, 'PAYMENT', 'CAPTURED', NEWID());
    SET @TxnID = SCOPE_IDENTITY();

    INSERT INTO dbo.LedgerEntries (AccountID, TransactionID, DebitAmount, CreditAmount)
    VALUES (301, @TxnID, 100.00, 0.00);     -- customer account debited (funds leave)

    INSERT INTO dbo.LedgerEntries (AccountID, TransactionID, DebitAmount, CreditAmount)
    VALUES (900, @TxnID, 0.00, 100.00);     -- merchant clearing account credited (funds arrive)

    -- Balance check before commit — the invariant that makes this "double-entry"
    IF (SELECT SUM(DebitAmount) - SUM(CreditAmount) FROM dbo.LedgerEntries WHERE TransactionID = @TxnID) <> 0
        THROW 51000, 'Ledger entries do not balance — rolling back.', 1;
COMMIT TRANSACTION;
```

**3. Explain the Query**
Both `LedgerEntries` rows are inserted in the same transaction as the balance check, so either all three statements (two inserts plus the implicit commit) succeed together or none do — there is never a moment where an unbalanced half-posted transaction is visible to another session, because SQL Server's default isolation already prevents dirty reads of uncommitted data. The `SUM(DebitAmount) - SUM(CreditAmount) <> 0` check is the actual enforcement of the accounting identity; `THROW` aborts the batch (an explicit `ROLLBACK` should also be issued in a `TRY/CATCH` around this in production code) rather than letting an unbalanced set commit.

**4. Sample Data**
`LedgerEntries` for `TransactionID = 7001`: `(301, 7001, 100.00, 0.00)`, `(900, 7001, 0.00, 100.00)`.

**5. Expected Output**
`SELECT SUM(DebitAmount), SUM(CreditAmount) FROM LedgerEntries WHERE TransactionID = 7001` returns `(100.00, 100.00)` — balanced.

**6. Alternative Solutions**
- **Application-level balance check only (shown above)** — straightforward, but relies on every code path that writes to `LedgerEntries` remembering to check; a new feature that inserts ledger rows without going through the shared posting routine can silently violate the invariant.
- **`CHECK` constraint at the row level** — cannot express a cross-row, cross-transaction invariant like "entries for this `TransactionID` sum to zero," because SQL Server `CHECK` constraints only evaluate against a single row's own column values.
- **`AFTER INSERT` trigger on `LedgerEntries` that verifies the balance for the affected `TransactionID`(s) and rolls back if unbalanced** — the strongest guarantee, because it's enforced by the database itself regardless of which application code path performed the insert, at the cost of trigger overhead on every ledger write and more complex logic when a transaction posts its entries across multiple statements/batches.
I prefer the trigger approach for the ledger specifically — it is the one table in the system where "an application bug bypassed the balance check" is not an acceptable failure mode, and the cost of enforcing it in the engine is worth paying.

**7. Performance**
An `AFTER INSERT` trigger that re-aggregates `SUM(DebitAmount), SUM(CreditAmount)` filtered `WHERE TransactionID IN (SELECT DISTINCT TransactionID FROM inserted)` stays cheap because it's scoped to only the affected transaction IDs in the current batch, not the whole table — indexing `LedgerEntries(TransactionID)` is what keeps that aggregation an index seek rather than a scan as the ledger grows into billions of rows.

**8. Edge Cases**
- A transaction that posts to more than two accounts (e.g., a payment with a fee split: customer debited $100, merchant credited $97, fee-revenue account credited $3) — the balance invariant (`SUM(Debit) = SUM(Credit)`) still holds across N entries, it's not limited to exactly two rows.
- Multi-currency ledger entries — "debits equal credits" only makes sense within one currency; a cross-currency transaction needs either a matched pair of same-currency ledgers plus an explicit FX conversion entry, or the invariant must be checked per currency, never summed across currencies.
- Reversing a posted transaction — modeled as a *new* transaction with the debit/credit sides swapped (Q143), never as an `UPDATE`/`DELETE` of the original entries, preserving the append-only audit trail (Q141).

**9. Production Scenario**
A ledger service backing a digital wallet posts every top-up, payment, fee, and payout as balanced `LedgerEntries` rows; a nightly job independently re-verifies `SUM(DebitAmount) = SUM(CreditAmount)` across the *entire* ledger (not just per-transaction) as a defense-in-depth check catching any bug that somehow slipped past the trigger — this whole-ledger balance check is a standard control in real accounting systems and a common interview follow-up in its own right.

**10. Interview Follow-ups**
- How do you verify the *entire* ledger balances, not just one transaction at a time?
- How does this design handle a transaction that fails partway through posting multiple entries?
- Why use separate `Transactions` and `LedgerEntries` tables instead of just one table?

**11. Follow-up Answers**
- `SELECT SUM(DebitAmount) - SUM(CreditAmount) FROM LedgerEntries` with no `WHERE` clause should always return exactly `0`; running this as a scheduled integrity job (and alerting if it's ever nonzero) is the whole-system analog of the per-transaction trigger check.
- Because all of a transaction's `LedgerEntries` inserts happen inside one database transaction, a failure partway through (an error on the third of four planned entries) rolls back everything already inserted for that transaction — there is never a partially-posted transaction visible to readers.
- `Transactions` records the business event once (what happened, to which account, its status); `LedgerEntries` records the accounting *effect* of that event, which can be one-to-many (a single payment can produce multiple ledger lines for fees, tax, FX) — separating them lets the accounting representation evolve (e.g., adding a fee-split entry) without changing what a "transaction" means to the rest of the system.

**12. Common Mistakes**
Modeling a ledger with a single signed `Amount` column per account instead of separate `DebitAmount`/`CreditAmount` columns — it works arithmetically but throws away the self-balancing invariant's visibility (you can no longer trivially verify "debits equal credits" with a single `SUM`, because there's only one column left to sum) and diverges from how real accounting systems and auditors expect a ledger to be structured.

**13. Architect Insight**
A Staff engineer can implement a ledger table. A Principal/Architect designs the ledger so that "the books balance" is a property the *database* can prove on demand — via a trigger, a scheduled integrity job, or both — because in a regulated financial system, "our application code should always do this correctly" is not an answer that survives an audit; "the system cannot represent an unbalanced state, and here's the query that proves it" is.

---

### Q138. Should account balance be a stored column or derived from ledger entries on read — and how do you keep a stored balance consistent?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
The ledger (Q137) is always the source of truth for what happened; the question is whether `Accounts.Balance` is a cached, denormalized number maintained incrementally, or computed fresh from `SUM(CreditAmount - DebitAmount)` over `LedgerEntries` on every read. Derive-on-read is always correct but gets expensive as ledger history grows; a stored, incrementally-maintained balance is fast to read but is a cache that can drift from the ledger if anything updates it outside the transaction that posts the corresponding ledger entries — so if you store it, it must be updated *in the same transaction* as the ledger entries that change it, never afterward.

**2. SQL Query**
```sql
-- Derived (always correct, cost grows with history)
SELECT AccountID, SUM(CreditAmount) - SUM(DebitAmount) AS DerivedBalance
FROM dbo.LedgerEntries
WHERE AccountID = 301
GROUP BY AccountID;

-- Stored balance, maintained atomically with the ledger post
BEGIN TRANSACTION;
    INSERT INTO dbo.LedgerEntries (AccountID, TransactionID, DebitAmount, CreditAmount)
    VALUES (301, @TxnID, 100.00, 0.00);

    UPDATE dbo.Accounts
    SET Balance = Balance - 100.00
    WHERE AccountID = 301;
COMMIT TRANSACTION;

-- Periodic reconciliation between the two (see Q135's pattern applied internally)
SELECT a.AccountID, a.Balance AS StoredBalance,
       le.DerivedBalance,
       a.Balance - le.DerivedBalance AS Drift
FROM dbo.Accounts a
JOIN (
    SELECT AccountID, SUM(CreditAmount) - SUM(DebitAmount) AS DerivedBalance
    FROM dbo.LedgerEntries GROUP BY AccountID
) le ON le.AccountID = a.AccountID
WHERE a.Balance <> le.DerivedBalance;
```

**3. Explain the Query**
The derived-balance query recomputes truth from the append-only ledger every time — correct by construction, but its cost is proportional to that account's entire transaction history unless older entries are periodically rolled up. The stored-balance `UPDATE` sits inside the exact same transaction as the `LedgerEntries INSERT` that justifies it, so SQL Server's atomicity guarantees they can never commit independently — the third query is the safety net that catches any case where that discipline was violated (a bug, a manual `UPDATE`, an out-of-band fix) by comparing the cached value against the recomputed ground truth.

**4. Sample Data**
`LedgerEntries` for account 301 summing to a derived balance of `1,250.00`; `Accounts.Balance` for 301 also `1,250.00` — matching, healthy state.

**5. Expected Output**
The reconciliation query returns zero rows when the cache and the ledger agree; any returned row is `Drift <> 0` and needs investigation exactly like an external reconciliation break (Q135).

**6. Alternative Solutions**
- **Pure derive-on-read** — simplest, always correct, but does not scale to accounts with years of high-frequency transaction history without a rollup/snapshotting strategy (e.g., periodic "balance as of end-of-month" snapshot rows to bound how far back a read has to sum).
- **Stored balance updated in the same transaction (shown above)** — O(1) reads, the standard choice for anything read-hot (checking a balance before authorizing a new payment), at the cost of needing the reconciliation safety net.
- **Stored balance updated asynchronously via events/CDC** — decouples the balance update from the posting transaction's latency, but reintroduces an eventual-consistency window (Q132) on a number where staleness can cause a real business error (approving a payment against a balance that's actually already been spent) — I generally reject this for anything that gates a financial decision, and reserve it for pure display/reporting balances.
I prefer the stored-balance-in-the-same-transaction approach for any balance that gates a decision (can this payment be authorized?), paired with the reconciliation job as defense-in-depth, and pure derive-on-read (or periodic snapshotting) for historical/reporting balances that don't need to be instantaneous.

**7. Performance**
Deriving a balance from `LedgerEntries` needs an index on `(AccountID)` (or `(AccountID, EntryDate)` if you snapshot periodically and only sum entries after the last snapshot) to stay a fast seek+aggregate rather than a full scan; a stored balance turns the same read into a single-row primary-key lookup, which is the entire reason high-throughput authorization checks use it.

**8. Edge Cases**
- Two concurrent transactions both debiting the same account's stored balance — without appropriate locking (the default row-level exclusive lock the `UPDATE` takes is sufficient here, since both `UPDATE`s serialize on the same row) or without `SNAPSHOT`/`READ COMMITTED SNAPSHOT` isolation causing a lost update, one debit could be overwritten by the other; SQL Server's default row-locking behavior on `UPDATE Balance = Balance - x` actually protects this correctly because the read-modify-write happens atomically under the row's exclusive lock — the danger case is instead a *read-then-separate-update* pattern in application code (`SELECT Balance` then `UPDATE Balance = @readValue - x`), which reintroduces the lost-update race the in-place `UPDATE` avoids.
- A negative balance appearing where the business rule says it shouldn't — enforce with a `CHECK (Balance >= 0)` only if overdrafts are genuinely never allowed; many real account types (credit lines) legitimately need negative balances, so this constraint is domain-specific, not universal.
- Balance drift discovered by reconciliation — never silently overwrite the stored balance to match the derived one without an audit entry explaining the correction; treat it exactly like a reconciliation break in Q135/Q139.

**9. Production Scenario**
A digital-wallet authorization path checks `Accounts.Balance` (the fast, stored value) before approving a new payment, while the customer-facing "transaction history" screen and monthly statement are generated by deriving balances from `LedgerEntries` directly — using the right representation for each use case rather than forcing one number to serve both a latency-critical decision and a slower, fully-auditable report.

**10. Interview Follow-ups**
- What isolation level should the balance-check-then-debit operation run under?
- How would you bound the cost of deriving a balance for an account with ten years of history?
- What's the actual failure mode if the stored balance and the ledger silently disagree for a long time?

**11. Follow-up Answers**
- The default `READ COMMITTED` is usually sufficient because the `UPDATE Balance = Balance - x` statement is a single atomic read-modify-write under the row's own lock; if application code separates the read and the write into two statements, it needs either to keep both in one transaction under `REPEATABLE READ`/`SERIALIZABLE` (or `SNAPSHOT`) to prevent a lost update, or better, restructure it as a single in-place `UPDATE` expression as shown, which sidesteps the whole isolation-level question.
- Periodic balance snapshots (e.g., a `BalanceSnapshots(AccountID, AsOfDate, Balance)` row written monthly) let a derive-on-read query start from the nearest prior snapshot and sum only the entries since, bounding the cost regardless of how far back history goes.
- The authorization path silently approves or declines payments against a number that no longer reflects reality — potentially approving a payment that should have been declined (funds already spent) or declining one that should have succeeded — which is exactly why the reconciliation job (Q135's pattern, applied internally) isn't optional for any stored balance that gates a real decision.

**12. Common Mistakes**
Reading the current balance in one statement, doing business logic in application code, then writing a new balance back in a separate `UPDATE` — the classic read-modify-write race that loses updates under concurrency; the fix is almost always to express the change as a single in-place arithmetic `UPDATE` (as shown) rather than a round trip through application memory.

**13. Architect Insight**
A Staff engineer picks one of "stored" or "derived" and implements it correctly in isolation. A Principal/Architect recognizes that real systems need *both* — a fast, transactionally-consistent stored value for decisions, and the append-only ledger as the recoverable, auditable ground truth — plus the reconciliation discipline that keeps the fast path honest, because a financial system that only has the fast path has no way to ever prove it's still correct.

---

### Q139. How do you write reconciliation queries against an externally-supplied settlement file?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
Load the settlement file (typically a daily/nightly CSV or fixed-width file from a payment processor or bank) into a staging table exactly as delivered, then compare it against your own transaction records using a full outer comparison that classifies every row into matched, missing-internally, missing-externally, or amount-mismatched — the same break-classification approach used for cross-service reconciliation (Q135), applied here against an external, authoritative-for-settlement-purposes source instead of another internal service. Critically, external idempotency claims ("the processor says they dedupe") don't remove the need for this — you still reconcile, because the settlement file is the only ground truth for what the processor actually moved.

**2. SQL Query**
```sql
CREATE TABLE dbo.Staging_SettlementFile (
    ProcessorTransactionID VARCHAR(100) PRIMARY KEY,
    OurIdempotencyKey      UNIQUEIDENTIFIER NULL,   -- populated if the processor echoes it back
    SettledAmount          DECIMAL(18,2) NOT NULL,
    SettledAt              DATE NOT NULL,
    LoadedAt               DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
-- BULK INSERT / bcp loads the day's file into this table verbatim before any comparison logic runs.

WITH Matched AS (
    SELECT
        t.TransactionID, t.Amount AS OurAmount,
        s.ProcessorTransactionID, s.SettledAmount,
        CASE
            WHEN s.ProcessorTransactionID IS NULL THEN 'MISSING_AT_PROCESSOR'
            WHEN t.TransactionID IS NULL THEN 'MISSING_INTERNALLY'
            WHEN t.Amount <> s.SettledAmount THEN 'AMOUNT_MISMATCH'
            ELSE 'MATCHED'
        END AS BreakType
    FROM dbo.Transactions t
    FULL OUTER JOIN dbo.Staging_SettlementFile s ON t.IdempotencyKey = s.OurIdempotencyKey
    WHERE t.Status = 'CAPTURED' OR s.ProcessorTransactionID IS NOT NULL
)
SELECT * FROM Matched WHERE BreakType <> 'MATCHED';
```

**3. Explain the Query**
Staging the raw file first (rather than comparing on the fly during load) means the comparison logic is pure SQL against two ordinary tables, easy to test and rerun without re-fetching the file, and keeps a permanent record of exactly what the processor sent that day. The `FULL OUTER JOIN` on the idempotency key surfaces all four break categories in one query, mirroring Q135's internal-reconciliation shape — this is the same technique applied to an external counterparty instead of a sibling service.

**4. Sample Data**
`Transactions(5001, ..., 100.00, 'CAPTURED', 'a1b2...')` with no matching row in `Staging_SettlementFile` for `OurIdempotencyKey = 'a1b2...'` on settlement day → `BreakType = 'MISSING_AT_PROCESSOR'`, meaning the processor hasn't reported settling a capture we believe happened — worth investigating before assuming the money actually moved.

**5. Expected Output**
Zero rows on a clean day; each returned row is a specific, actionable break with enough detail (our transaction ID, the processor's ID if present, both amounts) to route to the right team.

**6. Alternative Solutions**
- **Manual, ad-hoc spreadsheet reconciliation** — what many teams start with; doesn't scale past a small transaction volume and has no audit trail of what was checked.
- **Automated SQL-based comparison against staged data (shown above)** — repeatable, auditable (the staging table itself is evidence), and the standard approach at any real payments-processing scale.
- **Real-time reconciliation via processor webhooks instead of batch files** — reduces the detection window from a day to near-real-time, but many processors only provide authoritative settlement data via the batch file/report, with webhooks covering only the earlier authorization/capture events — so batch reconciliation against the settlement file is usually still required even when webhooks exist, as the final check against the number that actually moved.
I prefer combining both: webhooks for fast operational visibility, and the nightly settlement-file reconciliation as the authoritative, must-never-skip check.

**7. Performance**
Bulk-loading the file via `BULK INSERT`/`bcp` rather than row-by-row inserts is essential at any real volume; the comparison `JOIN` needs the idempotency-key columns indexed on both sides (the staging table's `PRIMARY KEY`/an index on `OurIdempotencyKey`, and an index on `Transactions.IdempotencyKey`) to stay a merge or hash join rather than a nested-loop scan over potentially millions of rows.

**8. Edge Cases**
- The processor reports a settlement for a transaction your system has no record of at all (`MISSING_INTERNALLY`) — a serious break (money moved with no corresponding record) that should page someone immediately, not wait for a routine review.
- Partial settlement — some processors settle a captured amount in installments or net of fees; a naive amount-equality check produces false-positive mismatches unless the comparison accounts for expected fee deductions.
- File arrives late, corrupted, or not at all — the reconciliation job needs its own monitoring (did today's file even load?) independent of the comparison logic itself; a missing file is not the same as "zero breaks."

**9. Production Scenario**
A payments team's nightly job loads the acquiring bank's settlement file, runs exactly this classification query, auto-resolves `MISSING_AT_PROCESSOR` breaks younger than 24 hours (often just processing lag, re-checked the next night), and creates a ticket for anything unresolved after 48 hours or any `AMOUNT_MISMATCH` — the same automatable/manual/investigate triage this repo's System Design reconciliation material describes for settlement processing generally.

**10. Interview Follow-ups**
- Why can't you just trust the processor's own claim that they deduplicate/never double-settle?
- How do you handle a settlement file format change from the processor?
- What's your rollback/correction process when a genuine internal error caused a break?

**11. Follow-up Answers**
- Because reconciliation exists to catch *your own* bugs and the processor's, not just one side — a processor's dedupe guarantee doesn't protect against your system double-submitting under a different idempotency key, a race condition in your capture logic, or a processor-side defect; independent verification against the actual settled amount is the only thing that catches all of these.
- Version the staging table schema (or load into a generically-typed staging table first, then a typed one) and treat a format change as a controlled schema migration with its own testing — never let an unannounced format change silently produce wrong staging data that then looks like real reconciliation breaks.
- A genuine internal error gets corrected via a new, explicit, audited compensating ledger entry (Q143) referencing the original transaction and the reconciliation break that surfaced it — never a silent `UPDATE` to historical financial records.

**12. Common Mistakes**
Writing the comparison as an `INNER JOIN` instead of a `FULL OUTER JOIN` — an `INNER JOIN` silently hides exactly the two most dangerous break categories (`MISSING_INTERNALLY` and `MISSING_AT_PROCESSOR`), because rows with no match on either side never appear in the result at all.

**13. Architect Insight**
A Staff engineer builds the comparison query correctly. A Principal/Architect insists on reconciliation existing *even when the external party's system is contractually or technically supposed to guarantee correctness* — because "supposed to" is not evidence, and in a regulated financial system, the reconciliation report itself is often the audit artifact that proves controls are operating, independent of whether it ever finds anything.

---

### Q140. How do you detect duplicate payments, including when the client didn't supply an idempotency key?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
The clean case — a client-supplied idempotency key enforced by a unique constraint (Q134/Q144) — prevents duplicates at write time. The harder case is detecting duplicates *after the fact* when no reliable key exists (a legacy integration, a client bug, a user double-clicking "Pay" in a way that produced two genuinely separate requests): here you look for transactions on the same account, same amount, same or very similar payee/description, within a tight time window, and flag them as *probable* duplicates for review rather than auto-resolving, because two legitimately separate $20 coffee purchases minutes apart are a real, valid pattern too.

**2. SQL Query**
```sql
WITH Candidates AS (
    SELECT
        t1.TransactionID AS FirstID, t2.TransactionID AS SecondID,
        t1.AccountID, t1.Amount,
        t1.CreatedAt AS FirstAt, t2.CreatedAt AS SecondAt,
        DATEDIFF(SECOND, t1.CreatedAt, t2.CreatedAt) AS SecondsApart
    FROM dbo.Transactions t1
    JOIN dbo.Transactions t2
        ON t1.AccountID = t2.AccountID
        AND t1.Amount = t2.Amount
        AND t1.TransactionType = t2.TransactionType
        AND t2.CreatedAt > t1.CreatedAt
        AND t2.CreatedAt <= DATEADD(SECOND, 120, t1.CreatedAt)   -- 2-minute window
        AND t1.TransactionID <> t2.TransactionID
)
SELECT * FROM Candidates
ORDER BY AccountID, FirstAt;
```

**3. Explain the Query**
The self-join pairs each transaction with any other transaction on the *same account*, for the *same amount and type*, that occurred within a defined trailing window (120 seconds here — tunable per business context); `t2.CreatedAt > t1.CreatedAt` ensures each pair is reported once (not twice, swapped) and excludes a row matching itself. This produces *candidates for review*, not confirmed duplicates — the query's job is recall (don't miss real duplicates), and a human or a secondary rule (matching order/invoice reference, matching device fingerprint) improves precision from there.

**4. Sample Data**
`Transactions`: `(5001, 301, 49.99, 'PAYMENT', 'CAPTURED', '2026-09-13T10:00:00', ...)`, `(5002, 301, 49.99, 'PAYMENT', 'CAPTURED', '2026-09-13T10:00:07', ...)` — same account, amount, type, seven seconds apart.

**5. Expected Output**
One candidate row: `FirstID=5001, SecondID=5002, AccountID=301, Amount=49.99, SecondsApart=7` — flagged for manual review, not automatically refunded, since only a human (or a stronger secondary signal) can confirm it wasn't two genuine separate charges.

**6. Alternative Solutions**
- **Exact idempotency-key matching only** — zero false positives, but catches nothing when no key was supplied or the key itself was generated twice by a buggy client (e.g., a client that regenerates a "unique" key per retry, defeating the whole point).
- **Fuzzy time/amount/account matching (shown above)** — catches the cases exact-key matching can't, at the cost of false positives that need human judgment; appropriate as a *detective* control layered on top of the *preventive* idempotency-key control, never as a replacement for it.
- **Device/session fingerprint or client-request-hash matching** — a stronger secondary signal (same device, same session, same rendered form submission) that can upgrade a fuzzy match from "candidate" to "high-confidence duplicate" without full certainty either, since shared devices/NAT'd networks exist.
I prefer layering all three: idempotency keys as the primary prevention mechanism (Q134), fuzzy detection as a safety net for whatever slips past it, and any available fingerprinting to raise confidence on the fuzzy matches before they reach a human reviewer.

**7. Performance**
The self-join needs an index on `(AccountID, Amount, TransactionType, CreatedAt)` to avoid a full table scan on every run; at high transaction volume, this job typically runs as a scheduled batch over a trailing window (e.g., "the last 24 hours") rather than continuously over the whole history table.

**8. Edge Cases**
- Two genuinely separate, legitimate transactions that happen to match on amount/account/type/window (a recurring $9.99 subscription plus a coincidental $9.99 purchase) — this is exactly why the query produces *candidates*, not automatic reversals; auto-reversing on a fuzzy match risks incorrectly refunding a legitimate charge, which is its own customer-harm incident.
- A retried request that used a *different* idempotency key each time due to a client bug — invisible to the unique-constraint mechanism (Q134) entirely, which is precisely the gap this fuzzy-matching query exists to catch.
- High-frequency legitimate same-amount transactions (e.g., automated trading, micropayments) where the fuzzy window produces a flood of false positives — the window and matching criteria need to be tuned per business context, not applied as one global rule.

**9. Production Scenario**
A payments-operations team runs this fuzzy-duplicate query as a nightly batch job feeding a review queue; combined with the idempotency-key constraint at write time and the settlement-file reconciliation in Q139, it forms a three-layer defense (prevent → reconcile against ground truth → detect what slipped through) against double-charging customers — exactly the kind of layered control a FinTech risk/compliance review expects to see documented, not assumed.

**10. Interview Follow-ups**
- How do you tune the time window to balance false positives against missed duplicates?
- What automated action, if any, is safe to take on a high-confidence duplicate?
- How does this interact with legitimate retry-with-backoff behavior from Q134's idempotency mechanism?

**11. Follow-up Answers**
- Start with a window informed by real client retry behavior (e.g., if clients retry with exponential backoff capped at 30 seconds, a 2–5 minute window comfortably covers legitimate retries) and tune using historical confirmed-duplicate data — err toward a slightly wider window with human review over a narrow one that misses real duplicates, since the review step already guards against false positives.
- Auto-flagging for review is always safe; auto-*refunding* is defensible only for extremely high-confidence matches (identical idempotency-adjacent metadata, same session, sub-second gap) and even then many FinTech compliance policies require human sign-off before reversing a customer-facing charge.
- They shouldn't overlap in the normal case — a properly-functioning idempotency key means retries never create a second `Transactions` row at all, so this fuzzy query's candidates should, in a healthy system, almost always trace back to a *missing or broken* idempotency key on the client side, which is itself useful signal to feed back to the client-integration team.

**12. Common Mistakes**
Treating a fuzzy-match hit as proof of a duplicate and auto-reversing it — inverting the actual risk: refunding a legitimate transaction because it coincidentally matched is itself a customer-trust and financial-control incident, just a different one than the duplicate charge you were trying to prevent.

**13. Architect Insight**
A Staff engineer builds the idempotency-key mechanism and considers duplicates solved. A Principal/Architect assumes the preventive control *will* have gaps — buggy clients, legacy integrations, edge cases nobody anticipated — and builds a detective control on top of it, explicitly designed to produce candidates for judgment rather than false certainty, because a financial system's duplicate-detection strategy is evaluated on its worst case, not its common case.

---

### Q141. How do you design transaction history and audit-trail tables for a financial system?

**Difficulty:** 🔴 Senior

**1. Interview Answer**
Financial audit trails are append-only by design: history tables never get `UPDATE`d or `DELETE`d, because the moment a historical financial record can be silently changed, it stops being evidence of anything. Every state change becomes a *new* row (or a system-versioned temporal-table history row), and permissions are locked down so that even a DBA with `db_owner` shouldn't be able to casually mutate history without it being independently visible.

**2. SQL Query**
```sql
-- Option A: explicit append-only audit table, populated by application code or a trigger
CREATE TABLE dbo.PaymentStatusHistory (
    HistoryID     BIGINT IDENTITY PRIMARY KEY,
    PaymentID     BIGINT NOT NULL,
    OldStatus     VARCHAR(20) NULL,
    NewStatus     VARCHAR(20) NOT NULL,
    ChangedBy     VARCHAR(100) NOT NULL,     -- service/user identity, never nullable
    ChangedAt     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
-- No UPDATE/DELETE permission granted on this table to any application role — INSERT only.

-- Option B: SQL Server system-versioned temporal table — automatic history, enforced by the engine
CREATE TABLE dbo.PaymentTransactionsVersioned (
    PaymentID     BIGINT IDENTITY PRIMARY KEY,
    Amount        DECIMAL(18,2) NOT NULL,
    Status        VARCHAR(20) NOT NULL,
    ValidFrom     DATETIME2 GENERATED ALWAYS AS ROW START NOT NULL,
    ValidTo       DATETIME2 GENERATED ALWAYS AS ROW END NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.PaymentTransactionsHistory));

-- Point-in-time query — "what did this payment look like as of a specific moment?"
SELECT * FROM dbo.PaymentTransactionsVersioned
FOR SYSTEM_TIME AS OF '2026-09-01T00:00:00'
WHERE PaymentID = 5001;
```

**3. Explain the Query**
Option A makes the audit trail an explicit business concept — a `PaymentStatusHistory` row records exactly who changed what and when, in domain language, and its `INSERT`-only permission grant makes tampering require an explicit, auditable escalation rather than an ordinary `UPDATE` statement. Option B lets SQL Server itself maintain history automatically for *every* column change (not just status), enforced at the engine level — every `UPDATE`/`DELETE` against `PaymentTransactionsVersioned` transparently copies the prior row version into `PaymentTransactionsHistory` before applying the change, and `FOR SYSTEM_TIME AS OF` lets you reconstruct the row's exact state at any past instant.

**4. Sample Data**
`PaymentStatusHistory`: `(1, 5001, 'AUTHORIZED', 'CAPTURED', 'payments-svc', '2026-09-13T10:00:05')`.

**5. Expected Output**
`FOR SYSTEM_TIME AS OF '2026-09-01T00:00:00'` returns the row exactly as it existed at that timestamp, even if it has since been updated multiple times — SQL Server reconstructs it from the history table transparently.

**6. Alternative Solutions**
- **Explicit audit table (Option A)** — full control over what's recorded and in what business-meaningful shape (e.g., recording *why* a status changed, not just that it did); requires discipline (or a trigger) to ensure every code path that changes status also writes the history row.
- **System-versioned temporal tables (Option B)** — automatic, can't be forgotten by a future code change, captures *every* column's history not just the ones you thought to track; less able to capture business-meaningful metadata like "who" and "why" without extending the base table's own columns.
- **Both together** — temporal versioning for complete, tamper-resistant column-level history, plus an explicit audit table for business-meaningful events (status transitions, who/why) — the two serve different audiences (a DBA reconstructing exact past state vs. a compliance analyst reading a human-readable change log).
I prefer both together for core ledger/payment tables specifically, given the regulatory weight (SOX/PCI-DSS) these tables carry — the cost of maintaining two mechanisms is small next to the cost of an audit finding "we can't reconstruct what happened."

**7. Performance**
Temporal-table history writes add overhead to every `UPDATE`/`DELETE` (an extra row insert into the history table), which is a reasonable and expected cost for financial tables where write volume is already dominated by careful, transactional operations rather than high-frequency bulk updates; index the history table's period columns for efficient `FOR SYSTEM_TIME` queries over large history.

**8. Edge Cases**
- Retention growth — both approaches accumulate history indefinitely by default; `HISTORY_RETENTION_PERIOD` on temporal tables lets you configure automatic cleanup, but for regulated financial audit trails, retention is a compliance decision (often 7 years for SOX-relevant records), not a storage-optimization one — don't default to short retention without checking the actual regulatory requirement.
- An `UPDATE` that changes many columns at once — a temporal table captures the *entire* prior row as one history row, which is simple and complete, while an explicit audit table modeled per-column-changed can require more complex trigger logic to capture "only what changed."
- Someone with sufficient privilege disabling `SYSTEM_VERSIONING` or dropping the history table — temporal versioning is a strong default but not un-bypassable by a sufficiently privileged principal; genuine tamper-evidence for the highest-sensitivity data may need write-once storage outside the database entirely (e.g., an external, immutable log) in addition to these in-database mechanisms.

**9. Production Scenario**
A regulator's audit request — "show us every state this specific payment was ever in, and who or what changed it, and when" — is answered directly and completely from `PaymentStatusHistory` (the human-readable narrative) cross-checked against `PaymentTransactionsVersioned`'s `FOR SYSTEM_TIME` history (the tamper-resistant column-level record), because the two independently corroborate each other.

**10. Interview Follow-ups**
- How long should financial audit history be retained, and who decides?
- Can temporal-table history itself be tampered with by a privileged user?
- How does this interact with the ledger's append-only design from Q137?

**11. Follow-up Answers**
- Retention is set by regulatory requirement (SOX-relevant financial records are commonly retained around 7 years in the US, though the exact figure depends on the specific regulation, jurisdiction, and record type) and legal/compliance sign-off, not by an engineering default — this is a decision to get explicit sign-off on, not to assume.
- Yes, in principle a `db_owner`-level user can disable versioning or directly manipulate the underlying history table; mitigate with least-privilege access control, separation of duties (the team that can deploy schema changes isn't the team that can approve disabling versioning on production), and, for the highest-sensitivity data, an external immutable log as a second, independent witness.
- They reinforce the same principle at different layers: `LedgerEntries` is itself already append-only (new balancing entries instead of mutating old ones) for the *accounting* record; `PaymentStatusHistory`/temporal versioning captures the *operational* state-machine history of the transaction that produced those ledger entries — together they answer both "what did the books say" and "how did we get there."

**12. Common Mistakes**
Building an audit table but granting the application's normal service account `UPDATE`/`DELETE` permission on it "in case we need to fix a bad row" — the entire value of an audit trail depends on it being genuinely append-only; any code path that *can* mutate it undermines its evidentiary value even if that path is never actually used maliciously.

**13. Architect Insight**
A Staff engineer implements a history table when asked. A Principal/Architect treats "can we prove, to an external auditor, exactly what happened and that this record hasn't been altered" as a first-class design requirement for financial tables from day one — retrofitting genuine append-only auditability onto a system that's been allowing silent `UPDATE`s to historical records for years is far harder than designing it in from the start.

---

### Q142. How do you design settlement processing and batch reconciliation for resilience against partial failures?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
Settlement batches process potentially millions of transactions in one run; the design has to assume the batch *will* fail partway through (a timeout, a deployment, a downstream outage) and be able to resume or safely rerun without double-processing anything already-settled. The core techniques are: track per-item status within the batch (not just batch-level success/failure), make each item's processing idempotent, and make the "what's left to do" query cheap and correct even after an interruption.

**2. SQL Query**
```sql
CREATE TABLE dbo.SettlementBatches (
    BatchID       INT IDENTITY PRIMARY KEY,
    BatchDate     DATE NOT NULL,
    Status        VARCHAR(20) NOT NULL DEFAULT 'RUNNING',   -- RUNNING, COMPLETED, FAILED
    StartedAt     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CompletedAt   DATETIME2 NULL
);

CREATE TABLE dbo.SettlementBatchItems (
    BatchItemID   BIGINT IDENTITY PRIMARY KEY,
    BatchID       INT NOT NULL,
    TransactionID BIGINT NOT NULL,
    Status        VARCHAR(20) NOT NULL DEFAULT 'PENDING',   -- PENDING, SETTLED, FAILED
    ProcessedAt   DATETIME2 NULL,
    CONSTRAINT UQ_BatchItem UNIQUE (BatchID, TransactionID)
);

-- Resuming an interrupted batch: only pick up what's still PENDING
SELECT TOP (1000) bi.BatchItemID, bi.TransactionID
FROM dbo.SettlementBatchItems bi
WHERE bi.BatchID = @BatchID AND bi.Status = 'PENDING'
ORDER BY bi.BatchItemID;

-- Marking an item settled — idempotent because it's a status transition, safe to rerun
UPDATE dbo.SettlementBatchItems
SET Status = 'SETTLED', ProcessedAt = SYSUTCDATETIME()
WHERE BatchItemID = @BatchItemID AND Status = 'PENDING';   -- no-ops harmlessly if already settled
```

**3. Explain the Query**
`SettlementBatchItems` tracks status *per transaction within the batch*, not just at the batch level, so a crash after processing 400,000 of 1,000,000 items leaves an accurate, queryable record of exactly which 600,000 remain — the resume query is simply "everything still `PENDING`." The final `UPDATE`'s `WHERE ... AND Status = 'PENDING'` guard makes the status transition itself idempotent: rerunning it against an already-`SETTLED` item matches zero rows and does nothing, rather than double-applying whatever side effect "settling" entails.

**4. Sample Data**
`SettlementBatches(42, '2026-09-13', 'RUNNING', '2026-09-13T02:00:00', NULL)` with 1,000,000 `SettlementBatchItems` rows, 400,000 already `SETTLED` when the batch process crashes.

**5. Expected Output**
On restart, the resume query returns exactly the 600,000 still-`PENDING` items; after they complete, `SettlementBatches.Status` is updated to `COMPLETED` only once `NOT EXISTS (SELECT 1 FROM SettlementBatchItems WHERE BatchID = 42 AND Status = 'PENDING')`.

**6. Alternative Solutions**
- **All-or-nothing single transaction for the whole batch** — simplest to reason about, but a single failed item (or a timeout) rolls back the entire batch's work, forcing a full rerun from zero at real scale — impractical for million-row batches.
- **Per-item status tracking with idempotent resume (shown above)** — the standard approach for large batch jobs; more schema/bookkeeping overhead, but survives partial failure gracefully and makes progress observable mid-run.
- **Chunked transactions (commit every N items)** — a middle ground: smaller blast radius per failure than all-or-nothing, without the full per-item status-tracking overhead; still needs a way to know which chunk was last committed, which per-item status tracking gives you for free.
I prefer per-item status tracking for genuinely large, long-running settlement batches — the observability alone (you can query "how far along is today's batch" mid-run) is worth the schema overhead, on top of the resumability.

**7. Performance**
The resume query's `WHERE BatchID = @BatchID AND Status = 'PENDING'` needs a supporting index (`(BatchID, Status)`) so that, even after most items are settled, finding the remaining `PENDING` ones stays a fast seek rather than scanning millions of already-processed rows.

**8. Edge Cases**
- An item that fails permanently (e.g., the receiving account was closed) needs a distinct `FAILED` status, not endless `PENDING` retries — and a separate process to route `FAILED` items to manual investigation, or the batch never reaches `COMPLETED`.
- Two batch-runner instances accidentally started concurrently against the same `BatchID` — the `UNIQUE (BatchID, TransactionID)` constraint prevents duplicate item rows, but the processing loop itself should also claim items (similar to Q130's publisher-claim pattern) to avoid two instances both trying to settle the same `PENDING` item simultaneously.
- A batch that's rerun on a *new* `BatchID` for the same `BatchDate` after being aborted — needs a business rule (and ideally a constraint) preventing the same date from being settled twice under two different batch IDs, which would double-settle every transaction in it.

**9. Production Scenario**
A nightly settlement batch that pushes payout instructions to a banking partner tracks each payout's status individually; when the partner's API times out at item 400,000 of 1,000,000, the batch-runner (a scheduled job, potentially on a new instance after a deployment) simply resumes from the next `PENDING` item on its next scheduled run, and operations can see real-time progress via a simple `COUNT(*) GROUP BY Status` query instead of only finding out the batch failed the next morning.

**10. Interview Follow-ups**
- How do you handle an item that keeps failing on every retry?
- How do you prevent two batch-runner instances from processing the same item concurrently?
- How does this settlement-batch design relate to the settlement-file reconciliation in Q139?

**11. Follow-up Answers**
- Track a retry count per item and move it to a distinct `FAILED`/`NEEDS_REVIEW` status after a threshold (e.g., 3 attempts), rather than retrying indefinitely — a permanently-failing item shouldn't block the batch from ever reaching `COMPLETED` for everything else.
- Use claim semantics: `UPDATE TOP (N) SettlementBatchItems SET Status = 'PROCESSING', ClaimedBy = @instanceId OUTPUT inserted.BatchItemID WHERE Status = 'PENDING'` so each instance atomically claims a distinct set of items before working on them, exactly mirroring the multi-publisher problem from Q130.
- This settlement-batch table tracks *our own* processing progress against a *processor/partner interaction we initiate*; Q139's reconciliation compares our resulting records against an *externally-supplied* settlement file received after the fact — they're complementary: this design gets the batch done reliably, Q139 independently verifies it actually landed correctly.

**12. Common Mistakes**
Wrapping an entire million-row settlement batch in one giant transaction "for simplicity" — beyond the lock-duration and log-growth problems this causes, it means a single bad row forces a full rollback and rerun of everything, which is the opposite of resilience at this scale.

**13. Architect Insight**
A Staff engineer writes a batch job that works on the happy path. A Principal/Architect designs the batch job assuming it *will* be interrupted mid-run in production eventually — by a deployment, a timeout, an infrastructure blip — and makes "resume safely from wherever it stopped, with zero double-processing" a first-class property of the schema, not an incident-response afterthought.

---

### Q143. How should a database schema represent failed transactions and their compensation, without ever deleting or mutating financial history?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
A failed or reversed financial transaction is never deleted and never mutates the original record — it's represented by a new row (or new ledger entries) that references the original and encodes what happened: a `FAILED` status on the original if it never actually completed, or a fresh, explicitly-linked reversing transaction with mirrored (sign-flipped) ledger entries if it did complete and now needs to be undone. The rule is the same one from Q137/Q141: history is append-only, so "undoing" something is itself a new, recorded event, not an erasure.

**2. SQL Query**
```sql
-- Case 1: transaction never completed — mark it FAILED, no ledger entries were ever posted for it
UPDATE dbo.Transactions SET Status = 'FAILED', UpdatedAt = SYSUTCDATETIME()
WHERE TransactionID = 5050 AND Status IN ('INITIATED','AUTHORIZED');   -- guard: can't fail something already CAPTURED

-- Case 2: transaction completed (ledger entries exist) and must be reversed — compensating transaction
BEGIN TRANSACTION;
    DECLARE @ReversalTxnID BIGINT;
    INSERT INTO dbo.Transactions (AccountID, Amount, TransactionType, Status, IdempotencyKey)
    VALUES (301, 100.00, 'REVERSAL', 'CAPTURED', NEWID());
    SET @ReversalTxnID = SCOPE_IDENTITY();

    -- mirror the original entries with debit/credit swapped
    INSERT INTO dbo.LedgerEntries (AccountID, TransactionID, DebitAmount, CreditAmount)
    SELECT AccountID, @ReversalTxnID, CreditAmount, DebitAmount   -- swapped
    FROM dbo.LedgerEntries
    WHERE TransactionID = 7001;   -- the original transaction being reversed

    UPDATE dbo.Transactions SET Status = 'REVERSED' WHERE TransactionID = 7001;
COMMIT TRANSACTION;
```

**3. Explain the Query**
Case 1's `WHERE ... AND Status IN ('INITIATED','AUTHORIZED')` guard makes it impossible to mark an already-`CAPTURED` (money-moved) transaction merely `FAILED` — once ledger entries exist, undoing it must go through Case 2's compensating-entry path, never a direct status flip. Case 2 creates a brand-new `Transactions` row of type `REVERSAL` and copies the original's `LedgerEntries` rows with `DebitAmount`/`CreditAmount` swapped — this keeps the double-entry balance invariant intact (Q137) for the reversal itself, while the original transaction and its original ledger entries remain untouched, permanently, as the historical record of what actually happened.

**4. Sample Data**
Original: `Transactions(7001, ..., 100.00, 'PAYMENT', 'CAPTURED')`, `LedgerEntries` `(301, 7001, 100.00, 0.00)` and `(900, 7001, 0.00, 100.00)`. After reversal: a new `Transactions(7050, ..., 100.00, 'REVERSAL', 'CAPTURED')` with `LedgerEntries` `(301, 7050, 0.00, 100.00)` and `(900, 7050, 100.00, 0.00)` — and the original row now shows `Status = 'REVERSED'`.

**5. Expected Output**
Both the original and reversal transactions remain permanently visible in `Transactions` and `LedgerEntries`; net ledger effect on account 301 across both rows is zero, but the *history* of "a payment happened, then it was reversed" is fully preserved rather than erased.

**6. Alternative Solutions**
- **Delete the failed/reversed transaction and its entries** — never appropriate for anything that reached `CAPTURED`/posted-to-ledger status; destroys the audit trail (violates Q141's core principle) and is indefensible in a financial audit.
- **`UPDATE` the original row's amount to zero or its status to reflect the reversal in place** — also destroys the historical record of what the original transaction actually was; an auditor or a customer dispute investigation loses the ability to see the original charge.
- **Compensating transaction with mirrored ledger entries (shown above)** — the standard accounting-correct approach; costs an extra row per reversal but preserves complete, provable history.
I strongly prefer the compensating-transaction approach — it's not really a stylistic choice in a financial system, it's close to a hard requirement once transactions have posted to the ledger.

**7. Performance**
Compensating transactions add rows rather than removing them, so ledger tables grow monotonically over time by design — this is expected and should be planned for via partitioning/archiving strategy (referencing this domain's Database Design material) rather than treated as a problem to "fix" by purging history.

**8. Edge Cases**
- Partial reversal (refunding $30 of a $100 payment) — the compensating transaction posts ledger entries for $30, not the full original amount; the original transaction's status might move to a distinct `PARTIALLY_REVERSED` rather than `REVERSED` if your status model needs to distinguish full from partial reversal.
- A reversal of a reversal (undoing a mistaken refund) — modeled the same way, one more linked compensating transaction; the chain of `Transactions` rows referencing each other (via a `ReversedTransactionID` foreign-key-style column, not shown above but recommended) should make the full sequence reconstructable.
- Attempting to reverse a transaction that's already fully `REVERSED` — needs the same kind of status guard shown in Case 1 to prevent double-reversal, which would incorrectly move twice the money back.

**9. Production Scenario**
A customer-service-initiated refund on a captured payment is implemented exactly as Case 2: a new `REVERSAL` transaction with mirrored ledger entries, linked back to the original via an explicit reference column, giving both the customer-service team and any later audit a complete, unambiguous trail of "charged $100 on Sept 1, refunded $100 on Sept 3, here's both records."

**10. Interview Follow-ups**
- How do you distinguish a `FAILED` transaction from a `REVERSED` one in your status model, and why does the distinction matter?
- How would you model a partial refund?
- What links a reversal transaction back to its original for audit/reporting purposes?

**11. Follow-up Answers**
- `FAILED` means the transaction never completed — no ledger entries, no money moved, nothing to reverse; `REVERSED` means it *did* complete and was subsequently undone via a compensating transaction — conflating the two would make it impossible to answer "did money ever actually move for this transaction" from the status field alone, which auditors specifically ask.
- Post ledger entries for the partial amount only, and track either a running "amount reversed so far" on the original transaction or derive it by summing linked reversal transactions — the original transaction's own `Amount` column never changes regardless.
- An explicit `OriginalTransactionID` (or `ReversedTransactionID`) column on the `Transactions` table pointing from the reversal back to the transaction it compensates — without this explicit link, reconstructing "which reversal undid which payment" requires fragile inference from amounts/timing instead of a direct, queryable relationship.

**12. Common Mistakes**
Handling a "failed payment" and a "successful payment that was later refunded" with the same code path/status value — these are different business events (nothing happened vs. something happened and was then undone) with different accounting and audit implications, and collapsing them loses information an auditor or a customer dispute will eventually need.

**13. Architect Insight**
A Staff engineer implements refunds correctly for the common case. A Principal/Architect designs the status model and schema so that the *distinction* between "never happened" and "happened, then was undone" is structurally impossible to lose — because in a financial system, that distinction is often exactly the fact a regulator, an auditor, or a customer dispute is asking about.

---

### Q144. How do you enforce idempotency specifically for payment-capture writes, tying together the outbox/CDC mechanisms from the microservices file?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
This is Q134's general idempotency pattern applied to the highest-stakes write in the system: before ever calling the card network or bank, the payment service inserts a row keyed on the client-supplied `Idempotency-Key` into a table with a unique constraint, inside the same transaction as the initial `Transactions` row — and only proceeds to the external call if that insert succeeds. The result of the external call, once known, is recorded back onto that same row, and the Outbox pattern (Q130) is used to publish the outcome exactly once per actual attempt, not once per retry.

**2. SQL Query**
```sql
BEGIN TRY
    BEGIN TRANSACTION;
        INSERT INTO dbo.Transactions (AccountID, Amount, TransactionType, Status, IdempotencyKey)
        VALUES (@AccountID, @Amount, 'PAYMENT', 'INITIATED', @IdempotencyKey);
        -- fails here with error 2627 if @IdempotencyKey was already used — see UQ_PaymentTransactions_IdempotencyKey (Q136)
        DECLARE @TxnID BIGINT = SCOPE_IDENTITY();
    COMMIT TRANSACTION;
    -- Only reaching here means this is genuinely the first attempt for this key —
    -- safe to now call the external card network/processor.
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 2627
    BEGIN
        ROLLBACK TRANSACTION;
        -- Already attempted: return the existing transaction's current state, do NOT call the processor again.
        SELECT TransactionID, Status FROM dbo.Transactions WHERE IdempotencyKey = @IdempotencyKey;
        RETURN;
    END
    ELSE BEGIN IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW; END
END CATCH;

-- After the external call returns (success or failure), record the outcome AND enqueue the outbox event atomically:
BEGIN TRANSACTION;
    UPDATE dbo.Transactions SET Status = @ResultStatus, UpdatedAt = SYSUTCDATETIME() WHERE TransactionID = @TxnID;
    INSERT INTO dbo.OutboxMessages (AggregateType, AggregateID, EventType, Payload)
    VALUES ('Transaction', CAST(@TxnID AS VARCHAR(20)),
            CASE WHEN @ResultStatus = 'CAPTURED' THEN 'PaymentCaptured' ELSE 'PaymentFailed' END,
            @ResultPayloadJson);
COMMIT TRANSACTION;
```

**3. Explain the Query**
The first block's `INSERT` under the unique constraint is the exact gate from Q134: it turns "is this a retry" into a question the database answers atomically, before any external, non-transactional side effect (the actual card-network call) happens — this ordering is what prevents a retried request from charging the card twice. The second block reuses the Outbox pattern from Q130 so that "record the outcome" and "publish an event about the outcome" are atomic with each other too — a crash between them can't leave the transaction updated but the event unpublished, or vice versa.

**4. Sample Data**
First call, `IdempotencyKey = 'k1'`: `Transactions` gets `(8001, ..., 'INITIATED', 'k1')`, external call succeeds, second block updates it to `'CAPTURED'` and enqueues a `PaymentCaptured` outbox event. A network-timeout-triggered client retry with the same `'k1'`: the first block's `INSERT` fails with `2627`, and the client is immediately given the current state (`'CAPTURED'`) without a second call to the card network ever happening.

**5. Expected Output**
Exactly one `Transactions` row and exactly one external card-network call per genuine payment attempt, regardless of how many times the client retries with the same idempotency key.

**6. Alternative Solutions**
- **Idempotency check only around the external call, not the initial row creation** — leaves a gap where two concurrent retries could both pass a naive check and both call the processor; the unique-constraint-first approach (shown above) closes that gap the same way Q134 does generally.
- **Idempotency key enforced only at the API-gateway/application layer (e.g., a distributed cache lookup)** — faster for very high-throughput APIs, but the cache is a second source of truth that can itself become inconsistent with the database under failure; I'd only add this as a fast-path optimization in front of the database-enforced guarantee, never as a replacement for it on a payment-capture path specifically.
- **Database-enforced unique constraint (shown above)** — the authoritative guarantee; I always keep this regardless of what faster caching layer sits in front of it, because the cost of getting a payment double-charge wrong far outweighs the cost of one extra `INSERT` attempt.
I prefer the database-enforced constraint as the non-negotiable source of truth, optionally fronted by a cache for latency, on the specific reasoning that a caching layer's failure mode ("cache miss, so we thought this was a new request") is exactly the failure mode that causes double-charges.

**7. Performance**
The unique index on `IdempotencyKey` is the only extra cost versus a non-idempotent insert, and it's a normal B-tree index maintenance cost — negligible compared to the latency of the external card-network call this pattern exists to make safe to retry.

**8. Edge Cases**
- The external call itself times out with an unknown outcome (did the card network actually charge it or not?) — the `Transactions` row sits in `INITIATED`/`AUTHORIZED` limbo; this needs an explicit reconciliation step (query the processor's status API by your own reference, or wait for their webhook/settlement file per Q139) before deciding whether to retry the call or mark it failed — never blindly retry an external call whose prior outcome is unknown.
- A client that generates a *new* idempotency key on every retry (a client-side bug) defeats this mechanism entirely from the server's perspective — this is exactly the gap Q140's fuzzy duplicate-detection query exists to catch as a safety net.
- Concurrent requests with the same key arriving at different service instances simultaneously — the database's unique constraint arbitrates correctly regardless of which instance's request reaches the database first, because the guarantee lives in the constraint, not in any one instance's in-memory state.

**9. Production Scenario**
A checkout API requires an `Idempotency-Key` header on every payment-capture request; the payment service implements exactly this two-transaction pattern, and load-balancer-level retries (common during brief network blips) are provably safe because the *first* database write — before any money moves — is the one guarded by the unique constraint.

**10. Interview Follow-ups**
- What do you do when the external call's outcome is genuinely unknown after a timeout?
- Why split this into two separate transactions instead of one that spans the external call?
- How does this differ from a general idempotency implementation (Q134) — what's specific to payments here?

**11. Follow-up Answers**
- Leave the transaction in a distinct `PENDING_RECONCILIATION` sub-state and resolve it via an explicit status-check call to the processor (if they offer one) or wait for the authoritative settlement file (Q139) — never assume success or failure of an unknown-outcome external call, and never retry it blindly without first checking whether it already succeeded.
- A database transaction should never span a slow, non-transactional external network call — holding locks for the duration of a card-network round trip would be a serious concurrency and availability problem; splitting into "reserve the idempotency slot" then "call externally" then "record the outcome" keeps every database transaction fast and lock-scoped.
- The general pattern (Q134) is the same mechanism; what's specific here is the explicit three-phase shape (reserve → external call → record outcome) required whenever the protected operation includes a non-transactional external side effect, versus Q134's simpler single-transaction example where the entire protected operation was itself internal to the database.

**12. Common Mistakes**
Calling the external payment processor *before* the idempotency-key row is safely committed — if two concurrent retries both pass that check because it happens too early, both proceed to charge the card, which is precisely the failure mode this entire pattern exists to prevent.

**13. Architect Insight**
A Staff engineer implements idempotency for an internal database operation correctly. A Principal/Architect recognizes that payment capture is fundamentally different because it has a *non-transactional, external, hard-to-undo side effect* in the middle of the flow, and designs explicitly for the "outcome unknown after timeout" state as a first-class, expected condition — not an edge case to handle later — because in payments, "we don't know if it worked" is a routine occurrence at scale, not a rare failure.

---

### Q145. How do you design a ledger table to satisfy SOX/PCI-DSS-style auditability requirements?

**Difficulty:** 🔥 Architect

**1. Interview Answer**
Auditability here means three things working together: immutability (Q141's append-only design — nothing in the ledger is ever `UPDATE`d or `DELETE`d), access control with separation of duties (who can *read* the ledger, who can *write* to it via the application, and — critically — nobody routinely has the ability to do both raw schema changes and business writes), and a hard boundary that keeps regulated sensitive data (full card numbers, CVV) out of the ledger entirely, replaced by tokens issued by a PCI-DSS-scoped tokenization service.

**2. SQL Query**
```sql
-- Immutability: no UPDATE/DELETE grants on ledger tables to the application role
DENY UPDATE, DELETE ON dbo.LedgerEntries TO PaymentsAppRole;
GRANT SELECT, INSERT ON dbo.LedgerEntries TO PaymentsAppRole;

-- Separation of duties: a distinct read-only audit role, no write access at all
CREATE ROLE AuditReadOnlyRole;
GRANT SELECT ON dbo.LedgerEntries TO AuditReadOnlyRole;
GRANT SELECT ON dbo.Transactions TO AuditReadOnlyRole;
DENY INSERT, UPDATE, DELETE ON dbo.LedgerEntries TO AuditReadOnlyRole;

-- Tokenization boundary: the ledger/transactions tables never store a real card number
ALTER TABLE dbo.Transactions ADD PaymentMethodToken VARCHAR(100) NULL;
-- PaymentMethodToken is an opaque reference issued by a separate, PCI-DSS-scoped tokenization
-- service/vault — the full PAN (Primary Account Number) never enters this database at all.
```

**3. Explain the Query**
`DENY UPDATE, DELETE` on the application's own service role is a database-enforced backstop for the append-only principle from Q141 — even a bug in application code cannot issue an `UPDATE`/`DELETE` against `LedgerEntries` that SQL Server itself will permit. A separate `AuditReadOnlyRole` with no write privileges at all embodies separation of duties: the people/systems reviewing the ledger for compliance purposes are structurally incapable of also being the ones who can alter it. Storing only a `PaymentMethodToken` (never a real card number) keeps this database out of PCI-DSS's strictest cardholder-data-environment scope for storage — that scope and its associated controls belong to the dedicated tokenization vault instead.

**4. Sample Data**
`Transactions(5001, ..., 'CAPTURED', PaymentMethodToken = 'tok_4f8a...')` — `tok_4f8a...` is meaningless outside the tokenization vault that issued it; there is no card number anywhere in this row.

**5. Expected Output**
An attempt by the application service account to run `DELETE FROM LedgerEntries WHERE ...` fails with a permissions error, regardless of what application-layer bug or malicious actor generated that statement; `AuditReadOnlyRole` can query everything but write nothing.

**6. Alternative Solutions**
- **Rely on application-layer checks alone (no database-level DENY)** — application code can be bypassed by direct database access (a DBA console, a misconfigured tool, a compromised credential); doesn't meet the bar auditors generally expect for a control that's supposed to prevent tampering.
- **Database-level DENY plus role separation (shown above)** — enforced regardless of which layer of the application (or which human with database access) attempts the write; the standard expectation for SOX/PCI-DSS-relevant controls.
- **External immutable log (e.g., write-once storage, blockchain-style hash chaining) as an additional witness** — the strongest tamper-evidence, appropriate for the very highest-sensitivity ledgers, at meaningfully higher operational complexity; I'd reserve this for cases where even a privileged insider threat within the database platform itself is in scope for the threat model.
I prefer database-level DENY plus role separation as the baseline for every financial ledger, adding the external-witness log only where the specific regulatory or threat-model context calls for it.

**7. Performance**
None of these controls (permission grants, tokenization) add meaningful query-time overhead — they're access-control and data-modeling decisions, not runtime cost trade-offs; the token lookup (resolving a token back to a real card number, when genuinely needed) happens in the separate tokenization service, off the hot path of ledger queries entirely.

**8. Edge Cases**
- A legitimate need to correct a genuine data-entry error in a posted ledger entry — handled by a compensating entry (Q143), never a direct `UPDATE`, even by an administrator; if the business process seems to require mutating history, that's a signal the process itself needs redesigning around compensating entries, not that the DENY should be relaxed.
- An emergency "break-glass" scenario where someone with elevated privilege genuinely needs write access temporarily — should go through a time-boxed, logged, approved privilege-elevation process (and ideally itself be recorded in an audit log), never a standing grant "just in case."
- Tokenization-service unavailability blocking payment processing — the tokenization boundary shouldn't become a new single point of failure; this is a resilience/architecture concern for the vault itself, separate from the ledger design but worth naming as a dependency it introduces.

**9. Production Scenario**
During a SOX audit, the auditor's read-only credentials (mapped to `AuditReadOnlyRole`) can query every ledger entry ever posted but cannot alter a single one, cardholder data never appears in a database backup or in an engineer's ad-hoc query results because only tokens are stored there, and every historical record is provably the same as it was when originally posted — because the database itself, not just a policy document, prevents it from being otherwise.

**10. Interview Follow-ups**
- What's the difference in scope/responsibility between your database and a PCI-DSS-scoped tokenization vault?
- How do you prove to an auditor that DENY permissions haven't been quietly changed?
- What would you do if the business genuinely needs to "correct" a posted ledger entry?

**11. Follow-up Answers**
- The tokenization vault is the only system that ever touches, stores, or can reverse a token back to a real Primary Account Number, and it's the system PCI-DSS's strictest cardholder-data-environment controls apply to directly; your application/ledger database only ever handles opaque tokens, which meaningfully shrinks its own compliance scope — this separation is itself a deliberate architectural decision, not an accident.
- Permission grants/denies should themselves be under change management (schema migrations reviewed and approved like any other production change) and periodically audited via `sys.database_permissions`/`sys.database_role_members` queries compared against an expected baseline — "trust the DENY was set correctly once" isn't sufficient; it needs to be independently verifiable on an ongoing basis.
- Post a compensating entry (Q143) referencing the original and explaining the correction in an audited change-request/ticket — "correcting" a posted financial record is always an addition to history, with a clear paper trail of why, never a subtraction or alteration of what was originally recorded.

**12. Common Mistakes**
Treating tokenization and access-control/immutability as separate, unrelated concerns handled by different teams with no shared design review — a ledger that's perfectly immutable but still stores raw card numbers, or one that never stores card data but still allows an application bug to `DELETE` history, both fail the actual audit requirement, just from different directions.

**13. Architect Insight**
A Staff engineer implements each control (DENY grants, tokenization, compensating entries) correctly when asked for it individually. A Principal/Architect designs them as one coherent story they can walk an auditor through end-to-end — here is what we store, here is why nobody, including us, can alter history, here is why cardholder data was never here to begin with — because in a regulated financial system, the architecture *is* the compliance evidence, not a separate document describing it.

---

## References

1. [decimal and numeric (Transact-SQL) — SQL Server](https://learn.microsoft.com/en-us/sql/t-sql/data-types/decimal-and-numeric-transact-sql?view=sql-server-ver17)
2. [Unique constraints and check constraints — SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/tables/unique-constraints-and-check-constraints?view=sql-server-ver17)
3. [Get started with system-versioned temporal tables — SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/tables/getting-started-with-system-versioned-temporal-tables?view=sql-server-ver17)
4. [Temporal Tables — SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/tables/temporal/overview?view=sql-server-ver17)
5. [Manage Historical Data in System-Versioned Temporal Tables — SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/tables/manage-retention-of-historical-data-in-system-versioned-temporal-tables?view=sql-server-ver17)
6. [OUTPUT clause (Transact-SQL) — SQL Server](https://learn.microsoft.com/en-us/sql/t-sql/queries/output-clause-transact-sql?view=sql-server-ver17)
7. [Transaction Locking and Row Versioning Guide — SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide?view=sql-server-ver17)
8. [rowversion (Transact-SQL) — SQL Server](https://learn.microsoft.com/en-us/sql/t-sql/data-types/rowversion-transact-sql?view=sql-server-ver17)
