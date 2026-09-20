# EF Core — Cram Sheet

> Tier 2 (high frequency for .NET roles) · Source: `56-LINQ-EFCore/` (5 modules, 4,477 lines) · Read: 15 min

---

## 1. DbContext — lifetime & threading

- **`DbContext` is a Unit of Work + Identity Map**, and that dictates everything: it is **short-lived, single-threaded, and not thread-safe.** Default registration is **Scoped** (one per request).
- **Five ways to obtain one:** `AddDbContext` (Scoped) · `AddDbContextPool` (pooled) · **`AddDbContextFactory`** (for Blazor, background services, and anywhere the unit of work isn't a request) · `IServiceScopeFactory` + scope · `new` (tests only).
- **The four ways it gets used concurrently — all bugs:**
  1. `Task.WhenAll` over the same context;
  2. a Singleton capturing it (captive dependency);
  3. Blazor Server components (the circuit outlives the request → **use the factory**);
  4. a background service resolving it from the root provider.
  **Symptom:** `A second operation was started on this context instance before a previous operation completed` — or, worse, silent data corruption.
- **Context pooling** resets and reuses the context instance (saves setup cost, ~2–3× on trivial ops). **The state trap:** any custom state you add to your derived `DbContext` (a tenant id, a user) **survives into the next request** unless you reset it. Pooling and per-tenant state do not mix casually.
- **Connection pooling is a *different* pool** — ADO.NET's, keyed on the exact connection string. That's the one protecting your database. A connection string varying per request silently creates a pool per variant.
- **Connection resiliency** (`EnableRetryOnFailure`) is mandatory on cloud databases (Azure SQL, RDS Multi-AZ failover). Two rules: it **buffers** results (a memory cost), and **it cannot be used with a user-initiated transaction** unless you wrap the whole thing in an `IExecutionStrategy`. **Commit ambiguity** — a retry after a lost commit acknowledgement can double-apply; idempotency is still yours to solve.
- **EF Core abstracts the *API*, not the *database*.** Provider differences in translation, types, concurrency and collation are real; "we can swap providers" is a weak claim.

---

## 2. Modeling

- **Keys:** surrogate (`IDENTITY`/sequence) is the default. `Guid` as a clustered key causes page splits — and note **SQL Server orders `uniqueidentifier` by its *last* bytes**, so sequential-GUID schemes must match that. Use a surrogate PK + a unique index on the natural key.
- **The four property defaults that bite money code:** `decimal` maps to a **provider default precision** unless you specify `HasPrecision(19,4)` (silent rounding!) · strings default to `nvarchar(max)` without `HasMaxLength` (unindexable) · `DateTime` vs `DateTimeOffset` · nullability inferred from the CLR type.
- **Value conversions** (`HasConversion`) — for strongly-typed IDs, enums-as-strings, `Money`. **The silent bug with no exception:** a converted column is usually **not translatable in a `Where` predicate** the way you expect, and comparisons/ordering happen on the *stored* representation — so an enum stored as a string sorts alphabetically, not by ordinal.
- **Relationships:** principal/dependent, required vs optional. **Where rows silently disappear:** an *inner* join is generated for a required relationship, so a missing principal row drops the dependent from the results entirely.
- **Inheritance — choose by query shape, not by taste:**
  | | Tables | Pro | Con |
  |---|---|---|---|
  | **TPH** (default) | one | fastest, no joins | nullable columns, no NOT NULL integrity |
  | **TPT** | one per type | normalised, real constraints | joins on every query |
  | **TPC** | one per concrete type | no joins, good for polymorphic queries | no shared identity; duplicated columns |
- **Owned types vs complex types** — owned types are still entities with identity (and were the old way to model value objects); **complex types (EF 8+) are true value objects, no identity, no tracking as a separate entity.** Prefer complex types for `Address`/`Money` going forward.
- **JSON columns and primitive collections** — a document inside a row, queryable, with a contract you now own (schema evolution is on you).
- **Global query filters** — the right mechanism for **soft delete** and **multi-tenancy**. **What quietly defeats them:** `IgnoreQueryFilters()`, direct SQL or other data access that bypasses the EF query pipeline, and **navigation to a filtered entity from a required relationship** (which can throw or silently drop rows). `ExecuteUpdate`/`ExecuteDelete` compose over the filtered query by default. Treat a query filter as defence in depth, never the only tenancy control.
- **Indexes and constraints belong in the model** — the model is also your physical design.

---

## 3. Querying, Tracking & Saving

- **Pipeline:** LINQ expression tree → translated to SQL → executed → materialised → tracked. **Three places it goes wrong:** untranslatable expression (client evaluation / exception), a bad plan, or over-materialisation.
- **`AsNoTracking()` for every read-only query** — near-free win, skips snapshot creation. `AsNoTrackingWithIdentityResolution()` when you still need reference identity.
- **N+1** — the classic. Fix with **eager loading** (`Include`/`ThenInclude`) or a projection. **Lazy loading is off by default and should stay off** in web apps.
- **Single vs split query — a genuine trade:** one query with multiple `Include`s on collections causes a **cartesian explosion** (rows multiply). `AsSplitQuery()` issues one query per collection — no explosion, but **multiple round trips and no longer a single consistent snapshot** unless you wrap it in a transaction.
- **Projection (`Select`) beats `Include`** when you only need some fields — less data, no tracking, no explosion.
- **`Contains` on a list** translates to `IN (...)` — a large list produces a huge query and parameter-count limits (SQL Server's ~2,100 parameter cap). Batch or use a temp table / TVP.
- **`ExecuteUpdate` / `ExecuteDelete` (EF 7+)** — set-based, one statement, **no tracking and no `SaveChanges` pipeline**. They still apply the source query's global filters by default, but bypass automatic optimistic concurrency and `SaveChanges`-based auditing/soft-delete logic. Command interceptors still observe the generated command. Fast and correct for bulk; use explicit predicates and concurrency checks where required.
- **`SaveChanges`** — orders operations by dependency, **batches** them, and wraps everything in an implicit transaction (all-or-nothing). Returns the number of affected rows.
- **Optimistic concurrency:** `[Timestamp]` / `rowversion` or `IsConcurrencyToken()`. EF adds the token to the `WHERE` clause; 0 rows affected ⇒ `DbUpdateConcurrencyException`. **What it cannot see:** changes made through raw SQL or `ExecuteUpdate`, and anything on an entity you didn't load. Resolution strategies: client wins, store wins, or merge — always a business decision.
- **Transactions:** the `SaveChanges` implicit transaction is usually enough. Use an explicit `BeginTransaction` only to span multiple `SaveChanges` calls — and with retries you **must** use `IExecutionStrategy.ExecuteAsync`.
- **The outbox with EF Core:** add the outbox entity in the **same `SaveChanges`** as the business change — a single local transaction, atomically. That's the whole pattern.

---

## 4. Production

- **Migrations:** generated code is a *suggestion* — always read it. The traps: a rename detected as **drop + add** (data loss), a column type change generating a destructive rewrite, and a missing `down`.
- **Never call `Database.Migrate()` from application startup in production** with multiple replicas — concurrent migrations race. Apply migrations as a **separate deployment step**, with a **different, higher-privilege identity** than the app's runtime identity, and a lock.
- **Zero-downtime schema change = expand → migrate → contract**, same as any parallel change:
  1. **Expand:** add the new nullable column; deploy code that writes both, reads old.
  2. **Backfill** in batches (watch the **lock queue** — a long `ALTER` blocks everything queued behind it).
  3. Deploy code that reads new.
  4. **Contract:** stop writing old, drop it.
  Each step independently deployable and reversible.
- **Performance: measure, attribute to a layer, fix that layer.** Is it the LINQ→SQL translation, the query plan, the round-trip count, or materialisation? Tools: EF logging of generated SQL, `ToQueryString()`, EF Core metrics/`EventCounters`, and the database's own plan tooling.
- **Compiled queries** (`EF.CompileAsyncQuery`) remove expression-tree compilation from a genuinely hot path — measure first.
- **Testing:** **the InMemory provider is not recommended** — it is not a relational database, so it silently passes things that fail against SQL. Use **SQLite in-memory** for fast relational-ish tests, and **Testcontainers / a real SQL Server** for anything depending on provider behaviour, transactions, or generated SQL.
- **Security:** parameterised by default — but **`FromSqlRaw` with string interpolation reintroduces injection**; use `FromSqlInterpolated` or explicit parameters.
- **Repository over EF Core?** Usually no — `DbContext` *is* a Unit of Work and `DbSet<T>` *is* a Repository. Add one only when it's aggregate-scoped and hides a real decision; never leak `IQueryable` across the boundary (use a Specification passing `Expression<Func<T,bool>>`).
- **EF Core vs Dapper:** EF for the write model, aggregates, change tracking and migrations; Dapper for hot read paths and complex reporting SQL. **Using both deliberately is the mature answer**, not a compromise.

---

## Top traps

1. Sharing a `DbContext` across concurrent tasks.
2. `decimal` without `HasPrecision` → silent rounding on money.
3. Missing `AsNoTracking()` on read paths.
4. N+1 from lazy loading or a loop.
5. Cartesian explosion from multiple collection `Include`s.
6. Assuming `ExecuteUpdate`/`ExecuteDelete` runs `SaveChanges` auditing, soft-delete logic or automatic concurrency checks. Query filters still apply unless disabled.
7. `Database.Migrate()` at startup with multiple replicas.
8. Rename generated as drop + add.
9. InMemory provider used as a database in tests.
10. `FromSqlRaw` with interpolation.
11. Retry policy + explicit transaction without `IExecutionStrategy`.
12. Context pooling with per-tenant state on the derived context.

---

## Interview Q&A — Lead / Principal

**Answer frame:** headline → mechanism → trade-off + threshold → failure mode **and how you'd know** → *(Principal)* should it exist / who owns it.

### Q1 · DbContext concurrency in production *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"`A second operation was started on this context instance...` in production, intermittently. Root cause?"*

**Answer.** Something is using one `DbContext` concurrently. It's a Unit of Work with an identity map and change tracker — deliberately **not thread-safe**, and short-lived by design. Four ways it happens: `Task.WhenAll` over the injected context; a Singleton capturing it; a Blazor Server component, where the circuit outlives the request; or a background service resolving from the root provider. The exception is the *lucky* case — EF detects many but not all of them, and the undetected ones are silent data corruption, which is worse. Fixes by cause: for fan-out, a context per branch via `IDbContextFactory`; for Blazor and background work, `AddDbContextFactory` is the correct registration, not Scoped. And I'd question whether the parallelism pays — two round trips in parallel against the same database often isn't faster than one batched query, so sometimes the fix is deleting the `WhenAll`.

**Why it lands.** Enumerates causes, says the thrown exception is the *good* outcome, and questions whether the parallelism was worth it.
**✗ Weak answer.** "Register it Transient" — moves the bug and breaks the unit-of-work boundary.
**↳ Follow-ups.** What does context pooling change, and what's the state trap? How does connection pooling differ from context pooling?

---

### Q2 · N+1 and query performance *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"An endpoint takes 8 seconds. It returns 50 orders with their line items. What do you do?"*

**Answer.** I look at the generated SQL first, not the code — `ToQueryString()` or EF logging. Eight seconds for 50 rows is almost certainly **N+1**: one query for orders then one per order, so 51 round trips. Fixes in order of preference: **project with `Select`** into exactly the fields the response needs, which avoids tracking and the join entirely; or `Include` if I genuinely need the entity graph. The trap with `Include` across multiple collections is **cartesian explosion** — rows multiply and the wire payload dwarfs the data. `AsSplitQuery()` fixes the explosion at the cost of extra round trips and losing the single consistent snapshot, so wrap it in a transaction if that matters. I'd add `AsNoTracking()` since it's a read — near-free. Then prevention: an interceptor or test-harness assertion that fails when one request issues more than a threshold number of queries, because N+1 returns with every new navigation property.

**Why it lands.** SQL-first, ordered fix list with the trade for each, plus a regression detector.
**✗ Weak answer.** "Add `Include`" with no mention of cartesian explosion or projection.
**↳ Follow-ups.** When is `AsSplitQuery` wrong? What does `AsNoTracking` actually skip? How do you paginate a split query?

---

### Q3 · Zero-downtime schema change *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"You need to rename a column on a 400-million-row table with 24/7 traffic. Walk me through it."*

**Answer.** A rename is never one step, because EF generates it as **drop-plus-add** — data loss. It's expand–contract across at least three releases. **Expand:** add the new column nullable, deploy code writing both and reading the old — both versions run simultaneously during a rolling deploy, so the schema must satisfy both. **Migrate:** backfill in batches sized to keep each transaction short, because a long `ALTER` or a big update blocks everything queued behind it — watch the lock queue and log growth, run off-peak. **Switch:** deploy code reading the new column. **Contract:** in a *later* release stop writing the old column and drop it. Every step independently deployable and reversible.

Operationally: migrations do **not** run from application startup — with multiple replicas they race — so a separate deployment step, with a higher-privilege identity than the app's runtime identity, holding a lock. And I read every generated migration, every time. On 400 million rows I'd also ask whether the rename is worth it at all; a view or a mapped property may deliver the same outcome for a fraction of the risk.

**Why it lands.** Names drop-plus-add, the rolling-deploy dual-compatibility constraint, the lock queue, migration identity — then questions the requirement.
**✗ Weak answer.** "Run `dotnet ef migrations add` and deploy." That's the outage.
**↳ Follow-ups.** How do you roll back after the backfill? What if it takes 6 hours? Who holds the migration credential?

---

### Q4 · Repository over EF Core *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"Your team has a generic `IRepository<T>` over EF Core. A new joiner says it's an anti-pattern. Adjudicate."*

**Answer.** They're mostly right, and I'd want the team to hear why rather than just ruling. `DbContext` is **already** a Unit of Work and `DbSet<T>` is **already** a repository — so a generic `IRepository<T>` is usually forwarding methods that add indirection without hiding a decision. Worse, the common implementation returns `IQueryable<T>`, which leaks EF all the way out and produces `ObjectDisposedException` when the caller enumerates after the context is gone. Where a repository *does* earn its place is **aggregate-scoped**: an `IOrderRepository` returning whole `Order` aggregates and hiding the loading strategy, enforcing the DDD boundary. For query flexibility across that boundary, the Specification pattern — `Expression<Func<T,bool>>` as data, never a live `IQueryable`. So: keep repositories where they're aggregate-scoped, delete the generic one, and frame it to the team as removing an abstraction, which is a normal and healthy thing to do.

**Why it lands.** Adjudicates rather than siding, names the concrete failure, and gives the case where it *is* right.
**✗ Weak answer.** "Repositories are always good for testability" — `DbContext` is testable via the provider; that's a separate debate.
**↳ Follow-ups.** How do you test without a repository? Where does the Specification live? Is the InMemory provider acceptable for tests?

---

### Q5 · `ExecuteUpdate` and the silent bypass *(Lead)* ⭐⭐⭐
**Asked as:** *"A developer replaced a slow bulk update with `ExecuteUpdate`. It's much faster. Any concerns?"*

**Answer.** Yes — it's faster because it bypasses materialisation, tracking and the `SaveChanges` pipeline. `ExecuteUpdate` issues one set-based statement; **global query filters on its source query still apply by default**, and database-command interceptors still see the command. But any soft-delete or auditing logic implemented in `SaveChanges` does not run, and automatic optimistic concurrency is skipped, so it can overwrite a concurrent edit. None of that means don't use it; it means use it deliberately: keep tenancy filters enabled and make the tenant predicate explicit for sensitive writes, add a concurrency-token predicate plus an affected-row check where the business needs it, and provide an alternate audit path where compliance requires one. I'd want a code-review rule that flags it.

**Why it lands.** Accepts the win and enumerates exactly what was traded for it, including the compliance consequence.
**✗ Weak answer.** "It's fine, it's the recommended bulk API."
**↳ Follow-ups.** How would you keep the audit trail? What's the interaction with an open transaction?

---

### Quick-fire (30 seconds each)

- **"What lifetime should DbContext have, and why?"** → Scoped — one per request — because it's a Unit of Work with an identity map and change tracker, so it's meant to be short-lived and it is not thread-safe. The failure cases are all the same bug: `Task.WhenAll` over one context, a Singleton capturing it, or Blazor Server where the circuit outlives the request. For those you use `AddDbContextFactory` and create a context per unit of work.
- **"How do you fix N+1 in EF Core?"** → First confirm it by logging the generated SQL — the tell is one query then N more. Then either eager-load with `Include`, or better, project with `Select` to just the fields needed, which avoids tracking and the cartesian explosion entirely. If I do need several collections eagerly, `AsSplitQuery` avoids the row multiplication at the cost of extra round trips and losing the single consistent snapshot, so I'd wrap it in a transaction if that matters.
- **"How do you do a zero-downtime schema change?"** → Expand–contract. Add the new column nullable, deploy code writing both and reading the old, backfill in batches while watching the lock queue, then deploy code reading the new, and only in a later release stop writing and drop the old. Migrations run as a separate deployment step with a higher-privilege identity, never `Database.Migrate()` at startup with multiple replicas racing. And I read the generated migration every time, because a rename comes out as drop-plus-add.

---

**Go deeper:** `56-LINQ-EFCore/01`–`05` (05 = top-50 Q&A capstone) · **Related:** [[04-SQL-Server]], [[01-CSharp]], [[31-DDD]], [[34-CQRS-EventSourcing-Saga-Outbox]]
