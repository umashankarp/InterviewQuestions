# Module 198 — LINQ & EF Core: Top 50 Interview Questions & Answers for Lead and Principal Engineer Roles (Capstone)

> Domain: LINQ & EF Core | Level: Beginner → Expert | Prerequisite: [[01-EFCore-Foundations-DbContext-Lifetime-Pooling-Providers-Resilience-ReleaseStrategy]], [[02-EFCore-Modeling-Conventions-Relationships-Inheritance-ComplexTypes-JSON-ValueConversion-QueryFilters]], [[03-EFCore-Querying-ChangeTracking-SaveChanges-Concurrency-Transactions-BulkOperations]], [[04-EFCore-Production-Migrations-Performance-Testing-Diagnostics-Security]] — this capstone **synthesises all four**; every answer names the section that carries the full depth.
>
> **Provenance and format note.** Authored **2026-09-19 on an explicit instruction** ("top 50 interview questions and answers for Lead and Principal engineer role", based on the Microsoft Learn EF Core documentation and the entityframeworktutorial.net EF Core tutorial). It is a **Q&A capstone**, not an A6 module: the standing rule that retired the standalone Q&A section from *module* templates (`CLAUDE.md` §A6a) is deliberately set aside for this one file by that instruction, and Modules 194–197 remain §10-free with their depth in §2. The format is the standing Elite FinTech Interview Panel format (§A2): **Question · Ideal Answer · Why this answer is correct · Common mistakes · Possible follow-ups**, with an *excellent-vs-adequate* line where the difference is the point.
>
> **Facts anchor.** Microsoft Learn snapshot read 2026-09-19: **EF Core 10 — LTS, .NET 10 required, supported to 10 Nov 2028; EF Core 8 and 9 — supported to 10 Nov 2026 (52 days from the authoring date); EF Core 11 planned for November 2026 (unreleased — never a design input).** Where a number appears (benchmark, default, limit) it is traced to a module section that states its source. Verify against the version you ship.

---

## How to answer at this bar (a five-beat frame)

Lead and Principal answers are graded on **judgement under trade-offs**, not recall. Use: **(1) headline** the decision in one sentence; **(2) mechanism** — what EF/SQL actually does; **(3) trade-off** — what it costs and what the alternative is; **(4) failure mode** — how it goes wrong in production and *whether anything detects it*; **(5) verification** — the test, metric, or log line that proves it. **Lead** answers must be correct and complete; **Principal** answers must additionally cover organisational leverage — standards, gates, cost, risk, and what you would *not* allow.

## Coverage map — question → module section

| Part | Questions | Theme | Primary sources |
|---|---|---|---|
| **A. Foundations, DbContext & architecture** | Q1–Q10 | Positioning, lifetime, threading, pooling, resilience, idempotency, releases | 194 §2 |
| **B. Modeling** | Q11–Q20 | Conventions, keys, complex/owned, inheritance, converters, JSON, relationships, filters, money, history | 195 §2 |
| **C. Querying & performance** | Q21–Q32 | Translation, caching, tracking, N+1, split queries, pagination, raw SQL, compiled queries, plan regressions | 196 §2.1–2.7, 197 §2.4 |
| **D. Saving, concurrency & transactions** | Q33–Q42 | `SaveChanges`, tracker, disconnected, concurrency, `ExecuteUpdate`, bulk, isolation, deadlocks, outbox | 196 §2.8–2.13 |
| **E. Production, testing, security & leadership** | Q43–Q50 | Migrations, zero-downtime, testing, diagnostics, security, architecture stance, governance | 197 §2 |

---

# Part A — Foundations, DbContext & Architecture

### Q1 · Where does EF Core fit — and when would you *not* use it? *(Lead)*

**Question.** A team proposes Dapper for the whole platform "because EF is slow." Another wants EF for everything. What is your position?

**Ideal answer.** EF Core is an O/RM with four cooperating subsystems — the **model**, the **query pipeline** (LINQ → SQL + shaper), the **change tracker**, and the **update pipeline** (ordered, batched, transactional `SaveChanges`). Its design centre is **transactional, aggregate-shaped work**: load a graph, change it, save it, with optimistic concurrency and centrally enforced rules (tenant filters, soft delete, auditing). It is a poor fit for **set-based bulk work** (use `ExecuteUpdate`/`ExecuteDelete` or `SqlBulkCopy`), **bulk inserts of 10⁵+ rows**, and **reporting/analytics** where the SQL is the artifact. My policy: **EF Core by default; Dapper or raw SQL by *measured* exception**, both able to share one `DbConnection`/`DbTransaction` when a unit of work needs both. The Microsoft Learn performance guidance decides the "EF is slow" claim: EF runtime overhead is the *last* of four factors — database, network transfer, round trips, EF — and "likely to be negligible in most cases."

**Why this is correct.** It states a selection criterion (workload shape), not a tribal preference, and cites where EF's overhead sits relative to the dominant costs. Central enforcement is the real value: rules living in every engineer's memory don't hold at scale (194 §1.2).

**Common mistakes.** "EF is slow, Dapper is fast" without a measurement; "EF means you don't need SQL" — Microsoft's overview says intermediate-or-better database knowledge "is essential to architect, debug, profile, and migrate"; two idioms in one feature with no reason.

**Follow-ups.** How would you *measure* the overhead for our workload? What does mixing EF and Dapper in one transaction look like? Which claims on the entityframeworktutorial.net intro page are stale today (.NET Framework support, "not as mature as EF 6", SQL Compact)?

**Excellent vs adequate.** Adequate: "EF for CRUD, Dapper for speed." Excellent: names the four latency factors, gives the bulk/reporting boundary, and says how to *prove* a Dapper exception is warranted.

---

### Q2 · What is a `DbContext`, and why is its lifetime "one unit of work"? *(Lead)*

**Question.** Explain `DbContext` lifetime. Why is `AddDbContext` scoped, and what breaks if it isn't?

**Ideal answer.** A `DbContext` is a **Unit of Work** (Microsoft Learn quotes Fowler): entities become tracked by query or `Add`/`Attach`, you change them, `SaveChanges` writes the diff, then you **dispose** it. It is deliberately **short-lived**: the change tracker holds every entity it has materialized plus a snapshot, never forgetting on its own. `AddDbContext` registers **scoped** so one HTTP request = one unit of work shared by handler, repository and audit service (one tracker, one transaction). Violations: a **long-lived** context grows unbounded (memory), returns **stale** entities from the identity map without re-reading, and makes `DetectChanges` O(tracked); a **shared** context across threads is unsupported. Creating one per request is cheap — the model is built once and cached; "a `DbContext` is generally a light object."

**Why this is correct.** It ties lifetime to a stated design contract and lists the three concrete failure modes (leak, staleness, concurrency), each traceable to the tracker. (194 §2.3.)

**Common mistakes.** Registering it singleton "for performance"; thinking a context holds a connection (EF opens late and closes early); treating an EF `InvalidOperationException` as recoverable — Microsoft: it "can put the context into an unrecoverable state."

**Follow-ups.** What does the identity map do to a second query for the same row? When is *transient* correct? What are the three symptoms of a captive-dependency bug and how would you triage them?

---

### Q3 · How does thread-safety work with EF Core, and how do you run queries in parallel? *(Lead)*

**Question.** A colleague uses `Task.WhenAll` over two `ToListAsync` calls on the injected context. What happens and what do you do?

**Ideal answer.** EF Core does **not** support parallel operations on one context instance — including parallel async queries. EF detects many cases and throws *"A second operation started on this context before a previous operation completed…"*, but detection is best-effort; undetected concurrent use is "undefined behavior, application crashes and data corruption." Fixes: **await sequentially** (usually right — two indexed counts save ~3 ms and cost a second pooled connection); or, if genuinely worth it, **one context per parallel operation** from `IDbContextFactory<T>` (or a scope per task via `IServiceScopeFactory`). Also: always `await` immediately, no un-awaited calls, no sharing across `Parallel.ForEachAsync` workers; bound parallelism to the **connection budget**, not CPU count.

**Why this is correct.** It gives the rule, admits detection is incomplete, and evaluates whether parallelism pays at all (194 §2.5, §11 Easy).

**Common mistakes.** Catching the exception and continuing with the same instance; disabling `EnableThreadSafetyChecks` to "fix" it; assuming detection guarantees safety.

**Follow-ups.** How do you fan out 500 items safely? What does parallelism do to the connection pool arithmetic? How do you enforce awaiting via analyzers?

---

### Q4 · `AddDbContext` vs `AddDbContextPool` vs `AddDbContextFactory` — choose and defend. *(Lead → Principal)*

**Question.** When do you use each, and how do you decide for a new high-throughput payments API?

**Ideal answer.** **`AddDbContext`** — scoped, per-request unit of work; the default. **`AddDbContextPool`** — reuses context instances (default pool 1,024) to remove per-request setup; Microsoft Learn's single-row benchmark: **701.6 → 350.1 µs and 50.38 → 4.63 KB (≈2× time, ≈11× allocation)** — but single-threaded and zero-latency. **`AddDbContextFactory`** — you create/dispose contexts; right for **Blazor Server, background workers, several units of work per scope, parallel work**. **`AddPooledDbContextFactory`** — factory over a pool for the hottest workers. Decision: default to scoped; **pool only when a profiler shows context setup matters and no per-request state lives on the context**; factory whenever the unit of work isn't the request. For a payments API I start scoped, measure, and adopt pooling with a tenant-safe wrapper (Q5) only if justified.

**Why this is correct.** It matches lifetime to *who owns the unit of work* and puts a measurement gate in front of the optimisation (194 §2.4, §15).

**Common mistakes.** Pooling by default; using scoped contexts in singletons; not disposing factory-created contexts.

**Follow-ups.** What do you tell a team that wants pooling for a 5 ms query path? How much of the 350 µs saving survives 1 ms of database latency (≈21 %)?

---

### Q5 · Pooled contexts and multi-tenancy — what is the trap and the fix? *(Principal)*

**Question.** Tenant id lives on the context and a query filter reads it. After enabling `AddDbContextPool`, customers report seeing another tenant's data. Why, and how do you fix it durably?

**Ideal answer.** A pooled context is effectively a **singleton reused across requests**; the **constructor and `OnConfiguring` run once**, so a tenant id set there carries over to the next lease → the filter uses the *previous* tenant → a cross-tenant leak, not a performance bug. Fix (Microsoft Learn's pattern, hardened): a **singleton pooled factory** wrapped by a **scoped factory that sets `TenantId` on every lease**; register the scoped context from that wrapper; **fail closed** (default `Guid.Empty`, so a forgotten set returns *no* rows); and add an **isolation test** leasing the same instance under two tenants. Defence in depth: **Row-Level Security** with `SESSION_CONTEXT('tenant_id')` set by a connection interceptor **on every connection open** (pooled ADO.NET connections are reused across tenants). Note EF resets *its* state but not your fields nor ADO.NET state.

**Why this is correct.** It identifies the mechanism (singleton-like reuse), applies the documented pattern, and adds a database-enforced second layer because filters aren't a security boundary (194 §2.6, §11 Hard, §12).

**Common mistakes.** "Just set it in `OnConfiguring`" (runs once); a default tenant id of a real tenant; trusting the EF filter alone.

**Follow-ups.** Where does the tenant id come from (token claim — never a client header)? How does RLS behave when one physical connection serves two tenants sequentially?

---

### Q6 · Explain connection pooling vs context pooling and size the pool for 20 pods. *(Principal)*

**Question.** Average load is 6,000 DB calls/s at 4 ms each across 20 pods, SQL Server has 16 vCPU. What `Max Pool Size` and why?

**Ideal answer.** Different pools: **ADO.NET connection pool** (per connection string, default **Max Pool Size 100**, `Connect Timeout` 15 s, `Command Timeout` 30 s) vs **EF context pool**. **Little's Law:** busy connections `L = λ·W = 6,000 × 0.004 = 24` — average demand is tiny. Defaults allow **20 × 100 = 2,000** connections; SQL Server's worker threads at 16 CPUs = **512 + (16−4)×16 = 704**. In a 100× brownout demand `6,000 × 0.4 = 2,400` — the database scheduler saturates before the app pool refuses anything. So the ceiling is a *design* number: **⌊0.7 × 704 / 20⌋ = 25 per pod (500 total)**, with `Connect Timeout ≈ 5 s` so callers fail fast and return 503 + `Retry-After` rather than queue. Raising the pool to "stop the timeouts" hides the signal and melts the database.

**Why this is correct.** It derives the number from demand and capacity, and explains the failure the default causes (194 §2.7, §12).

**Common mistakes.** Setting 1,000 "to be safe"; conflating the two pools; ignoring pod count.

**Follow-ups.** What holds connections longer than needed (streaming reader + slow await, open transaction across an HTTP call, sync-over-async, unbounded fan-out)? What alert leads the timeout (pool wait-count > 0 for 60 s)?

---

### Q7 · A `BackgroundService` must query the database every 30 s. Walk me through it. *(Lead → Principal)*

**Question.** `DbContext` is registered with `AddDbContext`. What do you do?

**Ideal answer.** *Adequate:* inject `IServiceScopeFactory`, scope per cycle. *Principal adds:* the unit of work is the **batch**, not the service lifetime — a fresh context per batch (via **`IDbContextFactory`**, lighter than a scope unless several scoped services must share the tracker/transaction); `AsNoTracking`/`Clear()` for large reads; **parallel workers get one context each**, bounded by the connection budget; **two replicas will run it**, so the query must **claim** rows atomically (guarded `ExecuteUpdate`, `UPDLOCK, READPAST`, or a `rowversion`-guarded status change) or two pods process the same item; explicit-transaction batches run inside `CreateExecutionStrategy().ExecuteAsync` with idempotency (commit ambiguity); pass the host `CancellationToken`; **poison-item handling** (catch per item, record, continue, alert); `TagWith` the polling query. **Enforce** `ValidateScopes/ValidateOnBuild` in all environments — the captive-dependency bug otherwise "works" for hours.

**Why this is correct.** It fixes the lifetime bug *and* sees the between-replicas concurrency bug the fix exposes — the module's discriminating question (194 §2.14, §4).

**Common mistakes.** Injecting `DbContext` into the singleton with validation disabled; one context for the process lifetime; no claiming step.

**Follow-ups.** How do you test that two replicas never double-process? What symptoms did the captive context show (memory, staleness, concurrency exceptions)?

---

### Q8 · What does `EnableRetryOnFailure` do, what does it cost, and how does it interact with transactions? *(Lead)*

**Question.** Explain connection resiliency in EF Core, including the exception you'll hit with `BeginTransaction`.

**Ideal answer.** `EnableRetryOnFailure()` installs an **execution strategy** (SQL Server: `SqlServerRetryingExecutionStrategy`) that retries **transient** faults — defaults from EF source: **6 retries, 30 s max delay, randomised exponential backoff**. Each query and each `SaveChanges` is retried *as a unit*. Costs: EF **buffers result sets** (memory ↑ on large results, no streaming). With a user transaction (`BeginTransactionAsync`) you get *"…SqlServerRetryingExecutionStrategy does not support user-initiated transactions. Use the execution strategy returned by 'DbContext.Database.CreateExecutionStrategy()'…"*: wrap the **whole unit** — fresh context, transaction, all saves, commit — in `strategy.ExecuteAsync(...)` so a retry replays from the top with clean tracker state. For a request path, tighten defaults (e.g. `maxRetryCount: 3`, ≤10 s) so retries don't amplify a brownout.

**Why this is correct.** Names the mechanism, the documented exception, the buffering cost, and the reason the unit must be replayable (194 §2.10).

**Common mistakes.** Reusing one context across attempts; assuming retries are free; not knowing large exports lose streaming.

**Follow-ups.** Are deadlock victims (1205) retried by the built-in detector? (Version-specific — read `SqlServerTransientExceptionDetector`, don't assume.) What retry budget prevents a retry storm?

---

### Q9 · Make a payment insert *exactly-once* with EF Core, given retries and a possible commit-time connection drop. *(Principal)*

**Question.** The connection drops during `COMMIT`. EF's strategy retries. How do you avoid a double payment?

**Ideal answer.** **exactly-once = at-least-once AND at-most-once.** The execution strategy (plus client retries) gives *at-least-once*; a **unique constraint on `(tenant_id, idempotency_key)`, written in the same transaction as the payment**, gives *at-most-once*. If the commit's outcome is **unknown**, Microsoft Learn: the strategy "will retry the operation as if the transaction was rolled back"; if it had committed, that risks "**data corruption**… when inserting a new row with auto-generated key values." Defences, ranked: (1) **client-generated GUID key** so a blind retry hits a duplicate-key error; (2) **`ExecuteInTransactionAsync(db, operation, verifySucceeded)`** — `verifySucceeded` asks the database "did my row land?" (use `SaveChangesAsync(acceptAllChangesOnSuccess:false)` then `AcceptAllChanges()`); (3) a **transaction-marker row**; plus the idempotency table storing the response (replay `200`), a **request hash** (same key + different body → `409`), and a unique-violation catch (`2627/2601`) that turns a concurrent duplicate into a replay. The verification context must itself use a retrying strategy.

**Why this is correct.** It separates atomicity from *knowledge of outcome* and closes both halves of the identity (194 §2.10, §11 Expert, §12 Step 3.3).

**Common mistakes.** "The transaction is atomic so it's safe"; store-generated keys with no idempotency key; ignoring same-key-different-body.

**Follow-ups.** Scenario: response lost after the side effect. Scenario: two pods race on one key. How do you expire idempotency records?

---

### Q10 · EF 8 and 9 both leave support on 10 Nov 2026. What is your upgrade plan and what can change silently? *(Principal)*

**Question.** We're on EF 8/9. Plan the move to EF 10.

**Ideal answer.** Facts: EF 10 is **LTS to 10 Nov 2028**, needs **.NET 10** (won't run on .NET Framework); EF 8/9 EoS **10 Nov 2026**; EF 11 planned Nov 2026. Runbook: upgrade **all `Microsoft.EntityFrameworkCore.*` together** (check third-party providers — Npgsql/Pomelo lag); read **breaking changes**; run the **full suite on the real engine**; **diff the SQL** for critical queries; **add a migration on a production copy** and review it; load-test and compare **query-cache hit rate, per-tagged-query p99, Query Store plans**; canary. **Silent changes to test for:** (a) **`Contains` translation** now one parameter per element, padded (8 values → 10) instead of EF 8/9's single JSON array → SQL and **plan shape** change; (b) with `UseAzureSql`/compat ≥170, existing **`nvarchar` JSON columns are auto-migrated to `json`** on the first migration; (c) `UseNamedDefaultConstraints` renames every default constraint; (d) EF 9 earlier: migration locking and `Migrate()` **throwing on pending model changes**; (e) EF 10 **reverted** EF 9's single-transaction-across-migrations; (f) new build warnings on `FromSqlRaw` concatenation.

**Why this is correct.** Dated facts + a procedure whose steps each target a documented behaviour change (194 §2.12, 197 §2.8).

**Common mistakes.** Treating it as a package bump; not checking provider availability; assuming "no compile errors = no changes."

**Follow-ups.** What is *not* a design input (EF 11 features)? How do you roll back? What's the owner and deadline?

---

# Part B — Modeling

### Q11 · Conventions, annotations, Fluent API — precedence, placement, and the defaults that bite. *(Lead)*

**Question.** How does EF decide the model, and what defaults would you change?

**Ideal answer.** Three sources: **conventions** (lowest) → **data annotations** → **Fluent API** (highest). Keep configuration out of domain classes: per-entity **`IEntityTypeConfiguration<T>`** via `ApplyConfigurationsFromAssembly`; **bulk rules in `ConfigureConventions`** (`Properties<string>().HaveMaxLength(256)`, `Properties<decimal>().HavePrecision(19,4)`, UTC `DateTime` converter). Defaults that bite on SQL Server: **`string` → `nvarchar(max)`** (can't be an index key; index limits 900/1,700 bytes) and **`decimal(18,2)`** — Microsoft: "rarely the best types… EF uses [them] because it doesn't have knowledge of your specific scenario." Also NRT-enabled `string` → `NOT NULL`; required relationship → cascade; **complex types are not discovered by convention**. The model is built lazily at first use, so a validation error can reach production unless a startup test touches `db.Model`. Read **every generated migration**.

**Why this is correct.** It's the precedence rule plus the operational consequence: make the safe choice the default (195 §1–§2.1).

**Common mistakes.** Attributes everywhere; fixing defaults property-by-property; never reading migrations.

**Follow-ups.** How do you fail the build on an unbounded string? How does a model change by hand-editing the snapshot corrupt future diffs?

---

### Q12 · Identity vs HiLo vs client-generated GUID vs natural key — which and why? *(Lead → Principal)*

**Question.** Choose primary-key strategy for a high-volume, idempotent payments table on SQL Server.

**Ideal answer.** **IDENTITY:** simple, but EF must **read the value back** (`OUTPUT INSERTED`), unknown pre-save, and a blind retry after commit ambiguity **inserts a second row**. **HiLo (sequence blocks, default increment 10):** fewer round trips, keys known client-side, batch-friendly. **Client-generated GUID:** key known up front → idempotent retries hit a duplicate-key error; but on **SQL Server `uniqueidentifier` sorts by its *last* 6 bytes**, so a leading-byte time-ordered value like `Guid.CreateVersion7()` gives **no clustered-index locality** — use EF's `SequentialGuidValueGenerator`, or cluster on `(tenant_id, created_at)`/a `bigint`; on PostgreSQL UUIDv7 *is* index-friendly. **Natural keys** (ISIN, IBAN): make them a **unique alternate key**, keep a surrogate PK — natural keys get corrected. Shared tables: `(TenantId, Id)` leading every index. Triggers force `HasTrigger` because `OUTPUT` is illegal on triggered tables.

**Why this is correct.** Each strategy's mechanism, the idempotency implication, and the provider-specific ordering trap (195 §2.2).

**Common mistakes.** "GUIDs are always fragmenting" (or "UUIDv7 is always fine"); natural PK; ignoring read-back cost.

**Follow-ups.** Ledger entries — why `bigint IDENTITY` (ordering, keyset paging)? What breaks if a legacy table has an audit trigger?

---

### Q13 · Owned entity types vs complex types (EF 8 → 10): which for `Money` and `Address`? *(Principal)*

**Question.** Model a value object and defend the choice.

**Ideal answer.** Microsoft Learn: **complex types** (EF 8) map **value objects** — no identity, compared **by value**, copy-on-assign, may be `struct` (EF 10), **`ExecuteUpdate`-able**. **Owned types** are *entity types behind the scenes*: hidden key, **reference semantics** (assigning `Billing = Shipping` **throws**), no bulk update. Owned still allows **navigations**; complex types **cannot** contain navigations or be a `DbSet`. EF 10 adds **optional** complex types, **struct** complex types, **JSON mapping** (`ToJson`) and **complex collections (JSON only)**. Not discovered by convention — configure explicitly. Make them **immutable records** and change with `with`; EF still tracks per property. Identity test: if two customers *sharing* an address should both change when it's edited, it's an **entity**. Migration owned→complex is a *mapping* change — diff the migration. EF 11 items (complex types on TPT/TPC, indexes on complex-type properties) are **unreleased**.

**Why this is correct.** The comparison table and the identity test are the decision procedure (195 §2.7).

**Common mistakes.** Defaulting to owned; mutable reference-type complex values shared between properties; assuming a refactor is safe.

**Follow-ups.** How does `Money` store (`amount_minor` + `currency`)? Why must an optional complex type have a required property?

---

### Q14 · TPH vs TPT vs TPC — how do you choose? *(Principal)*

**Question.** `PaymentInstrument` → `Card`, `BankAccount`, `Wallet`. Which mapping?

**Ideal answer.** **TPH** (default): one table + discriminator; fastest reads, no joins, additive evolution; cost: nullable subtype columns → enforce with **`CHECK` per discriminator**. **TPT** (`UseTptMappingStrategy`): clean `NOT NULL` schema; **JOIN per read**, slowest. **TPC** (`UseTpcMappingStrategy`, EF 7): no joins for concrete queries, base queries `UNION ALL`; **decisive limit: no enforced FK to the abstract base** and keys must be unique across tables (sequence/GUID). Because `payments.instrument_id` needs **one FK target**, TPC is out. My recommendation: **TPH + a JSON `Details` complex property for genuinely variable attributes**; first ask whether inheritance is the right model at all (separate aggregates behind an interface if lifecycles differ). Filters only on the **root** type. PCI: token + last-four only.

**Why this is correct.** Decision driven by query shape and referential-integrity need, not preference (195 §2.6, §15).

**Common mistakes.** TPT "because it's normalised"; TPC without noticing the FK loss; no `CHECK` constraints.

**Follow-ups.** Add a fourth instrument type — additive or structural? How do you verify `OfType<Card>()` filters on the discriminator?

---

### Q15 · Value converters — what silent bug do they introduce? *(Principal)*

**Question.** `List<string> Flags` is stored via a comma-join converter; edits "sometimes vanish." Explain.

**Ideal answer.** For a converted **mutable reference type** EF's default comparison is **reference equality**. `Flags.Add(x)` mutates in place → snapshot and current are the *same reference* → **no change detected → no `UPDATE`, no exception**. Fix: a **`ValueComparer<T>`** comparing/hashing/snapshotting by content — or (EF 8+) map as a **primitive collection** (JSON) with no converter. EF logs `CoreEventId.CollectionWithoutComparer` only as a *warning*; promote it to an error with `ConfigureWarnings`. Enum-as-string: pair with a `CHECK`; strongly-typed ids via converters. Diagnose with `ChangeTracker.DebugView.LongView` and the absence of an `UPDATE` in the SQL log. Best long-term fix for screening flags: a **normalised `customer_flags` table** (indexed, with `set_by/set_at`).

**Why this is correct.** It explains the mechanism (reference equality on snapshot) and the *detection gap* (write returns success and did nothing) (195 §2.4, §4).

**Common mistakes.** Blaming EF; replacing the list as a workaround without understanding; ignoring the warning.

**Follow-ups.** Order-independent hashing for a `HashSet` comparer? How do you regression-test it (mutate, save, reload in a *fresh* context)?

---

### Q16 · JSON columns and primitive collections — when, and when not? *(Principal)*

**Question.** A team wants to put "flexible terms" in JSON. Your view?

**Ideal answer.** **Mechanisms:** EF 7 JSON via owned types; EF 8 **primitive collections**; **EF 10** complex types → JSON, complex collections (JSON only), the native **`json` type** on Azure SQL/SQL Server 2025 (`JSON_VALUE(... RETURNING int)`), and bulk `ExecuteUpdate` of JSON properties. **Use JSON** for data **read and written as a unit** (provider payloads, extension attributes, versioned `terms`). **Don't** for fields you **filter, join, sort, aggregate, constrain or FK** — no per-field statistics, no constraints; indexing needs a JSON-index-capable engine. Rule: *the moment you query inside it on a hot path, promote the field to a column.* Surprise: EF 10 auto-changes existing `nvarchar` JSON columns to `json` on the first migration when configured for `UseAzureSql`/compat ≥170 — opt out by pinning `nvarchar(max)`. Version the document (`schema_version`) and upgrade on materialization.

**Why this is correct.** Clear criteria plus a concrete upgrade hazard (195 §2.8).

**Common mistakes.** JSON as an escape from schema design; querying JSON in hot paths; no schema versioning.

**Follow-ups.** How do you keep a 7-year-old document readable? How do you index a JSON property today?

---

### Q17 · Relationships and delete behaviour — what actually happens on `Remove`? *(Lead)*

**Question.** Explain required vs optional relationships and `DeleteBehavior`; what is your default for financial data?

**Ideal answer.** Principal holds the key; dependent holds the FK; required = non-nullable FK. **Defaults:** required → **`Cascade`**; optional → **`ClientSetNull`** (EF nulls *tracked* dependents; the DB is `NO ACTION`). Pitfall: `ClientSetNull` only affects **loaded** dependents — passes in unit tests (everything loaded), fails in production (dangling FK → DB rejects). SQL Server rejects **multiple cascade paths** — resolve with `Restrict`/`NoAction`. **Financial default: `Restrict` everywhere** — never cascade through a ledger; use **soft delete or supersession**. 1:1 requires `HasForeignKey<TDependent>` (EF can't infer the dependent); M:N via skip navigations, an explicit `UsingEntity` when the link carries payload. DDD: *inside* an aggregate navigations; *between* aggregates **FK by id, no navigation** (keeps tracker small, prevents accidental `Include` chains).

**Why this is correct.** Defaults + the unit-test blind spot + the domain-appropriate policy (195 §2.5).

**Common mistakes.** Relying on cascade in a ledger; ignoring untracked dependents.

**Follow-ups.** How does EF choose the dependent in 1:1? What does `Remove` on a parent with untracked children do?

---

### Q18 · Global query filters for soft delete and tenancy — what defeats them? *(Principal)*

**Question.** We use `HasQueryFilter` for tenant + soft delete. What can go wrong?

**Ideal answer.** A filter is an implicit `Where`; for tenancy it must bind to a **context-instance member** so each context parameterises its own value (which is why *pooled* contexts leak — Q5). **Pitfalls:** (1) **one filter per entity pre-EF 10** — a second overwrites the first; combine with `&&`, losing selective disabling; **EF 10 named filters** (`HasQueryFilter("Tenant", …)`, `IgnoreQueryFilters(["SoftDeletion"])`). (2) **`IgnoreQueryFilters()` disables all**, including tenant. (3) **Required navigation + filtered principal → `INNER JOIN` silently drops rows** (Microsoft's example: 6 posts without `Include`, 3 with) — make the navigation optional or add matching filters. (4) **Not a security boundary** — raw SQL/`ExecuteSql`/a stray ignore bypasses it → add **Row-Level Security**. (5) Only on the **root** type; cycles undetected; unsupported by compiled models. (6) Soft delete needs an interceptor to convert `Deleted→Modified`, **filtered unique indexes**, and cascade handling; `ExecuteDelete` does a *real* delete.

**Why this is correct.** Enumerates the documented failure modes and the layered fix (195 §2.11, §14).

**Common mistakes.** Treating the filter as authorization; not noticing the missing 3 %; unique index blocking re-creation after soft delete.

**Follow-ups.** How would you detect the required-navigation defect (model-rule test + reconciliation total)? How do admins report across tenants safely?

---

### Q19 · Model money correctly — precision, currency, and the `decimal(18,2)` default. *(Lead → Principal)*

**Question.** How do you persist monetary amounts and FX rates?

**Ideal answer.** The default `decimal(18,2)` silently rounds at the database boundary (`1.23456` → `1.23`). Choose deliberately: **minor units** (`bigint amount_minor` + `char(3) currency`) — exact integers, cheap sums/indexes, but needs a per-currency exponent table (JPY 0, USD 2, BHD 3) and fits high-precision rates badly; or **scaled decimal** (`decimal(19,4)`; rates `decimal(28,10)`) — natural to read, rounding policy in code. Either way model **`Money` as a complex type** (amount + currency together, value semantics, `ExecuteUpdate` support) so mismatched-currency arithmetic can't happen; **`CHECK (amount > 0)`**; on the wire send amounts as **strings**, never JSON numbers. Set precision globally in `ConfigureConventions` and gate with a model-rule test that fails on default `(18,2)`.

**Why this is correct.** States the failure, the two defensible designs with trade-offs, and where enforcement lives (195 §2.3, §2.7).

**Common mistakes.** `double`/`float`; global `(18,2)`; currency in a separate loosely-coupled column.

**Follow-ups.** Rounding policy across legs? Where do you store the FX rate used?

---

### Q20 · How do you model audit and history — temporal tables, interceptors, bitemporality? *(Principal)*

**Question.** Regulators ask "what did this trade look like at 10:00 on 3 March" and "what did we *believe* on 3 March about a trade effective 1 March."

**Ideal answer.** SQL Server **system-versioned temporal tables** (`ToTable(t => t.IsTemporal())`, query with `TemporalAsOf`, `TemporalAll`, `TemporalBetween`) capture **system time** automatically — the database guarantees a history row for every change and applications can't forget; history is read-only through EF. That answers question one. **Question two is bitemporal**: temporal tables give only **one axis**; the **business/effective-time** axis (`effective_from`) is a column you model, and the answer is `TemporalAsOf(3 Mar)` combined with `effective_from ≤ 1 Mar`. Add **audit stamping via a `SaveChangesInterceptor`** (who, when, why) and **append-only ledger permissions**. Never delete: supersede/correct with new rows. Plan partitioning/archival for 7-year retention (≈12 TB at 8 M rows/day × 600 B). Additive-only schema evolution.

**Why this is correct.** It splits the two questions into the two time axes and says which is automatic (195 §2.13, §12).

**Common mistakes.** "Temporal tables are bitemporal"; soft-delete flag as audit; audit only in application code.

**Follow-ups.** How do you migrate a temporal table? What breaks `AsOf` queries at scale (history table indexing)?

---

# Part C — Querying & Performance

### Q21 · Walk through how EF Core turns LINQ into rows. *(Lead)*

**Question.** What happens between `db.Payments.Where(...).ToListAsync()` and objects?

**Ideal answer.** (1) The lambda is an **expression tree**. (2) **Preprocess**: extract captured variables as **parameters**, normalise, expand navigations to joins. (3) **Cache key from tree shape** → hit: reuse compiled SQL + shaper; miss: **translate** to a SQL AST → text → compile the **shaper**. (4) Execute (connection from the driver pool). (5) **Materialize**; (6) if tracking, register + snapshot. **Client evaluation:** since 3.0 only the **final projection** may run client-side; otherwise `InvalidOperationException: … could not be translated… insert a call to AsEnumerable/ToList` — a feature; the danger is the manual `AsEnumerable().Where(...)` that loads the table. Deferred execution: nothing runs until enumeration. Read the SQL: `ToQueryString()`, `LogTo`, `TagWith`.

**Why this is correct.** Complete pipeline with the three ways it goes wrong (196 §2.1).

**Common mistakes.** Thinking EF runs the C# in the database; not knowing captured variables become parameters.

**Follow-ups.** Why is EF overhead usually negligible? What does `DateTime.UtcNow` translate to (`SYSUTCDATETIME()` per row)?

---

### Q22 · Dynamic queries and the query cache — how does a "harmless" filter hurt everyone? *(Principal)*

**Question.** A search endpoint builds predicates with `Expression.Constant`. What's wrong?

**Ideal answer.** A value baked in as a **constant** changes the tree shape per value → **recompilation every call** and a distinct SQL text per value → **plan-cache pollution**. Microsoft Learn's benchmark: constant **1,665.8 µs / 109.92 KB** vs parameterised **757.1 µs / 54.95 KB** (2.2× slower, 2× allocation) — and it "continuously pollutes the cache and causes other queries to be re-compiled." Fix: compose with ordinary **`Where` calls on the `IQueryable`** using captured variables; avoid the Expression API unless necessary; `EF.Constant`/`EF.Parameter` (EF 9) to control deliberately. **Detect** with the EF metrics `compiled_query_cache_hits/misses` (hit rate should settle ~100 %); alert if below ~99 % for 10 min.

**Why this is correct.** Cost quantified, blast radius (other queries) named, detection given (196 §2.1, 197 §2.6).

**Common mistakes.** String-concatenated predicates; "the difference is sub-millisecond" (missing the cache effect).

**Follow-ups.** How do you build optional filters cleanly? Why can't compiled queries help dynamic queries?

---

### Q23 · Tracking vs no-tracking vs identity resolution — when and why? *(Lead)*

**Question.** When do you use `AsNoTracking`, and what is `AsNoTrackingWithIdentityResolution`?

**Ideal answer.** Tracking (default) registers every entity + snapshot, and applies **identity resolution**: a second query for a tracked row returns the **existing instance without refreshing values** (stale reads). `AsNoTracking()`: untracked, **no** identity resolution — cheapest; default for read paths. `AsNoTrackingWithIdentityResolution()`: untracked, dedupes **within one query** — for read-only graphs with `Include`. Projections to non-entities aren't tracked; an entity inside an anonymous projection still is. **Fix-up** wires navigations for tracked entities, so a collection can look loaded but be *partial*. `UseQueryTrackingBehavior(NoTracking)` as a default for read-heavy services. Untracked entities can't be modified-and-saved without `Attach`/`Update`.

**Why this is correct.** Cost + semantics (staleness, duplicates) (196 §2.2).

**Common mistakes.** Everything tracked; expecting a re-query to refresh a tracked entity.

**Follow-ups.** How does that identity map produce the stale-read incident in a long-lived context?

---

### Q24 · Define N+1, detect it, fix it, and state your position on lazy loading. *(Lead)*

**Question.** A list endpoint takes 5 s in the cloud. Diagnose.

**Ideal answer.** Load 1,000 parents (1 query) then touch a navigation per parent (1,000) = **1,001 round trips**; at 5 ms cloud latency that's **~5 s** for what one query returns in ~10 ms. Detect: SQL log, **queries-per-request metric**, and a **command-count test** with a `DbCommandInterceptor` asserting a bound *independent of N* (seed 5 vs 500, assert equal). Fix: **projection** (`Select` with `Count`/`Sum` → correlated subquery), eager `Include`, explicit set-based load, or batch child loads by parent-id set. **Lazy loading** (`UseLazyLoadingProxies`/`ILazyLoader`) is an N+1 factory and **synchronous** (no async lazy load → blocks a thread on I/O); unsupported by compiled models — I disallow it by policy on API paths.

**Why this is correct.** Arithmetic, detection that survives refactors, and a policy stance (196 §2.3, §11 Easy).

**Common mistakes.** "Add `Include`" without checking cartesian explosion; unit tests that can't see query counts.

**Follow-ups.** Why is N+1 invisible at compile time? When is explicit loading in a loop acceptable (never on a hot path)?

---

### Q25 · Cartesian explosion and split queries — explain, trade off, and note the EF 10 change. *(Principal)*

**Question.** `Include(b => b.Posts).Include(b => b.Contributors)` is slow. Why, and what are your options?

**Ideal answer.** Two **sibling** collections join to a **cross product**: a blog with 10 posts and 10 contributors returns **100 rows**; each extra sibling multiplies again. Nested (`Posts → Comments`) does *not* explode. Single-collection `Include` merely **duplicates** principal columns per child (matters if the principal has a huge column). **`AsSplitQuery()`** (or `UseQuerySplittingBehavior`) issues **one query per collection**. Costs (Microsoft Learn): **no consistency guarantee** across statements (use snapshot/serializable), **extra round trips**, **buffering** of earlier results (unless MARS, which breaks savepoints), repeated reference joins, and — **before EF 10** — `Skip/Take` needed **fully-unique ordering** or splits could disagree; **EF 10 fixes the subquery ordering**. EF logs `MultipleCollectionIncludeWarning` when unconfigured — make it an error in CI. Alternatives: **project to a DTO** and query children by parent-id set.

**Why this is correct.** Numbers, the exact trade-offs, the version change (196 §2.5).

**Common mistakes.** Split everywhere; ignoring consistency; leaving ordering non-unique on EF ≤ 9.

**Follow-ups.** When is a snapshot transaction worth it? Why do one-to-one navigations stay joined?

---

### Q26 · `Include` vs projection — which is your default for read models? *(Lead)*

**Question.** Why prefer `Select` into a DTO?

**Ideal answer.** `Include` loads **entire entities** (every column, every related row), tracks and snapshots them, and repeats principal columns per child. A projection fetches **only the needed columns/aggregates**, is **untracked**, and often eliminates the join (`b.Posts.Count`). Microsoft's data-duplication note: with a projection "you can omit big columns and improve performance." Use `Include` when you'll **modify** the graph. Projecting *into an anonymous type containing an entity* still tracks that entity. Combine with **keyset paging** and covering indexes.

**Why this is correct.** Ties cost to what is materialized (196 §2.3).

**Common mistakes.** `Include` for every read; projecting after `ToList()` (client-side).

**Follow-ups.** How do you project child collections efficiently? When does a projection prevent an index-only plan (missing `INCLUDE` column)?

---

### Q27 · Offset vs keyset pagination in EF Core. *(Lead → Principal)*

**Question.** `Skip((page-1)*50).Take(50)` on a 400 M-row table. Problem and fix?

**Ideal answer.** Offset is **O(offset + k)**: at page 50,000 the database walks **~2.5 M rows** to return 50; results also shift under concurrent inserts (duplicates/skips). **Keyset** seeks to the cursor: `WHERE (CreatedAt < @c OR (CreatedAt = @c AND Id < @i)) ORDER BY CreatedAt DESC, Id DESC TAKE k+1` (fetch one extra to know if there is a next page) on index `(TenantId, CreatedAt DESC, Id DESC)` → **O(log N + k)**, stable. Trade-off: no random page jump. Cursor is **opaque and HMAC-signed**, includes direction/version. On SQL Server prefer a `datetime2` + `bigint` tiebreak over a GUID (GUID ordering semantics differ from the database's). Always use a **unique, total order**.

**Why this is correct.** Complexity, stability, and the tie-break that makes it correct (196 §2.7, §11 Medium).

**Common mistakes.** Non-unique sort key; `Count()` on every page; offset for exports.

**Follow-ups.** How do you paginate with joins/filters? How do you do "previous page"?

---

### Q28 · Streaming vs buffering — what can starve the connection pool? *(Principal)*

**Question.** `await foreach` over `AsAsyncEnumerable()` inside an export endpoint coincides with a pool-exhaustion outage. Explain.

**Ideal answer.** `ToListAsync()` **buffers** and releases the connection; `AsAsyncEnumerable()` **streams** but **holds the connection for the whole enumeration** — with a slow `await` (an HTTP call) in the loop, each export pins a connection; retried exports multiply it; with default pool 100 the exports alone exhaust it → *"Timeout expired… obtaining a connection from the pool"* long after the database recovers (a **metastable failure**). Also: **a retrying execution strategy forces buffering**. Fix: never `await` non-DB I/O while a reader is open; export in **keyset chunks** (~2,000); give exports **their own registration** (small pool, own app name, no retry strategy, own timeout) as a **bulkhead**; retry **budgets**; alert on **pool wait-count**.

**Why this is correct.** Mechanism, amplification, bulkhead, leading indicator (194 §14).

**Common mistakes.** Raising pool size; retries without budget; `.Result` sync-over-async.

**Follow-ups.** How would you reproduce it in a game-day (inject a 90 s DB stall)? What does `sys.dm_exec_sessions` show?

---

### Q29 · Raw SQL, stored procedures, keyless types — safely. *(Lead)*

**Question.** When do you drop to SQL, and how do you keep it injection-safe and composable?

**Ideal answer.** **`FromSql($"…{x}")`** takes a `FormattableString` → each value a **parameter** (safe); **`FromSqlRaw`** with **concatenation is injectable** — EF 10 adds an analyzer warning; treat as an error. **Dynamic identifiers** (a user-chosen `ORDER BY`) can't be parameterised → **allow-list**. `FromSql` must return **all columns** of the entity and can compose (`Where/OrderBy/Include/AsNoTracking`) only if it's a single `SELECT` wrappable as a subquery (no trailing semicolon; no inner `ORDER BY` on SQL Server). **Stored procedures** (`EXEC …`) are **not composable** — materialise first. **`Database.SqlQuery<T>`** (EF 8) for unmapped types; `ExecuteSql` for DML; **keyless entities** (`HasNoKey()`, `ToView`) for read-only shapes — never tracked. Right uses: hints (`UPDLOCK, READPAST`), CTEs, window functions, `MERGE`, bulk. Keep isolated, tagged, tested on the real engine.

**Why this is correct.** Safety rule, composability rule, and the legitimate use list (196 §2.6).

**Common mistakes.** `FromSqlRaw($"…{x}")` (interpolated *into Raw*); composing over `EXEC`.

**Follow-ups.** Why do filters/tenancy not apply to raw SQL? How do you test the procedure boundary?

---

### Q30 · Compiled queries, compiled models, pooling — when are they worth it? *(Principal)*

**Question.** A colleague wants `EF.CompileAsyncQuery` on every query. Respond with numbers.

**Ideal answer.** Microsoft Learn (single-row, local SQL Server): compiled **671.6 → 564.2 µs (−16 %), 13 → 9 KB**; for 10 rows **709.8 → 645.3 µs (−9 %), 18 → 13 KB**; pooling **701.6 → 350.1 µs**. Savings are **~100 µs**; against a real 5 ms call that's **~2 %** (pooling ~7 %). Limits: compiled queries — **one model**, **scalar parameters only**, **no dynamic composition**; **compiled models** (`dotnet ef dbcontext optimize`) help only **startup** for hundreds–thousands of entity types and forbid **global query filters**, lazy/change-tracking proxies, and need manual regeneration. **Order of operations:** fix SQL/indexes/round trips (orders of magnitude) → tracking/projection (2–10×) → pooling/compiled queries (single-digit %) — only on a **profiled hot path**. Also `EnableThreadSafetyChecks(false)` only after proving no concurrent use.

**Why this is correct.** Reads the docs' numbers as a percentage of realistic latency and gives the priority ordering (197 §2.4).

**Common mistakes.** Micro-optimising while a query scans 60 M rows; ignoring the compiled-model limitations.

**Follow-ups.** How large is "large model"? What does precompiled-query/AOT support look like today (experimental in EF 9 — verify current status)?

---

### Q31 · Same code, same query, suddenly a scan: parameter types, `CONVERT_IMPLICIT`, and sniffing. *(Principal)*

**Question.** Lookups by `isin` (a `varchar(12)` column) went from 4 ms to 900 ms after a "model regeneration" commit.

**Ideal answer.** EF maps `string` → **`nvarchar`** unless told otherwise; comparing an `nvarchar` parameter to a **`varchar` column** makes SQL Server **implicitly convert the column** (`CONVERT_IMPLICIT`, data-type precedence favours `nvarchar`) → **index seek becomes a scan** (here 60 M rows). Root cause: `dotnet ef dbcontext scaffold --force` **overwrote** generated files, deleting a hand-added `IsUnicode(false).HasMaxLength(12)`. Diagnose: EF metrics flat → not layer (d)/pool → **Query Store** top consumer (tagged) → **plan changed seek→scan** → actual plan shows the **CONVERT_IMPLICIT warning** → log shows `@p nvarchar(4000)`. Fix: restore mapping in a **partial configuration class** (never edit generated files), `Properties<string>().AreUnicode(false)` for ASCII families. Prevent: **catalog cross-check test** (mapped `IsUnicode` vs `INFORMATION_SCHEMA.COLUMNS.DATA_TYPE`), **parameter-type snapshot tests**, Query Store plan-change alerts, **production-scale** perf environment. Related: **parameter sniffing** (per-value plan variance) → `OPTION (RECOMPILE)`/`OPTIMIZE FOR` via raw SQL.

**Why this is correct.** A full triage path from symptom to prevention (197 §14).

**Common mistakes.** Adding an index; blaming EF; not noticing the model changed.

**Follow-ups.** Same trap with `decimal` precision and `DateTime` vs `datetime2`? Why did staging not show it?

---

### Q32 · `Contains` with a list — what changed in EF 8/9/10 and what do you do for 5,000 ids? *(Principal)*

**Question.** `ids.Contains(x.Id)` after an EF upgrade changed our SQL. Explain and advise.

**Ideal answer.** Pre-EF 8: values **inlined as constants** → a different SQL text per list (plan-cache bloat, the repo's most-voted issue). **EF 8/9:** one **JSON-array parameter** unpacked with `OPENJSON` — one plan, but the planner loses **cardinality**. **EF 10 default:** **one scalar parameter per element, padded** (8 values → 10 parameters) — stable-ish SQL *and* cardinality. Control: `UseParameterizedCollectionMode(ParameterTranslationMode.Constant | Parameter | MultipleParameters)` globally; `EF.Constant(ids)` per query. **Limit:** SQL Server allows **2,100 parameters** per request → for thousands of ids, **chunk**, or join to a **table-valued parameter/temp table**, or use the JSON mode. Test plans after upgrade; the change alters SQL for *every* `Contains`.

**Why this is correct.** History, current behaviour, a hard limit, and the escape hatches (195 §2.8, 196 §2.4).

**Common mistakes.** Assuming SQL is stable across upgrades; 5,000-element `IN` lists.

**Follow-ups.** Which mode for tiny fixed sets of roles vs large id lists? How do you diff SQL in CI?

---

# Part D — Saving, Concurrency & Transactions

### Q33 · What exactly does `SaveChanges` do, and what state is it in after a failure? *(Lead)*

**Question.** Walk through `SaveChanges`, including ordering, batching, transaction and failure.

**Ideal answer.** (1) `DetectChanges` (snapshot diff). (2) **Interceptors** (`SavingChanges`) run — audit, soft delete, outbox rows added here are saved together. (3) **Topological sort** by FKs: principals inserted before dependents, dependents deleted first. (4) **Batch** statements (SQL Server default max batch ~42; 2,100-parameter cap); store-generated values read back with `OUTPUT` (illegal on triggered tables without `HasTrigger`). (5) **One transaction** — "either completely succeed, or leave the database unmodified"; `AutoTransactionBehavior.WhenNeeded` skips it for a single statement. (6) **Accept changes** (`Added/Modified→Unchanged`) unless `acceptAllChangesOnSuccess:false`. **On failure:** `DbUpdateException`/`DbUpdateConcurrencyException`; the **tracker still holds pending changes** — calling again re-sends everything; fix or `ChangeTracker.Clear()`. Detect unique violations by **provider error number** (2627/2601; PostgreSQL `23505`), not message text.

**Why this is correct.** Full pipeline and the post-failure state most candidates forget (196 §2.10).

**Common mistakes.** Retrying `SaveChanges` on the same dirty context; parsing error messages.

**Follow-ups.** What does `AutoTransactionBehavior.Never` risk? How do you keep entities `Added` for a retry?

---

### Q34 · Change tracker internals and inserting 200,000 entities. *(Principal)*

**Question.** A `foreach { db.Add(x) }` then `SaveChanges` is slow and memory-hungry. Why, and what do you do?

**Ideal answer.** Each entity gets a tracker entry + snapshot; **`DetectChanges` is O(tracked × properties)**, called by `SaveChanges`, `Entries()`, `Local`, etc.; memory grows linearly. Options: **chunk** (1–5 k) with `SaveChanges` + **`ChangeTracker.Clear()`** per chunk (bounded memory; wrap in one transaction if atomic); `AutoDetectChangesEnabled=false` for pure-`Add` loops (remember to detect before modifications); `AddRange`; for ≥10⁵ rows a **bulk route** — `SqlBulkCopy` into a **staging table** then set-based `INSERT…SELECT`/`MERGE` (fastest, gives validate-then-apply), or a bulk library — accepting they **bypass interceptors/audit/filters** (a decision, not an accident). Use `ChangeTracker.DebugView` to inspect; `Tracked`/`StateChanged` events for diagnostics.

**Why this is correct.** Cost model + ladder of solutions + the governance caveat (196 §2.8–§2.9).

**Common mistakes.** One giant context; disabling auto-detect and forgetting to detect.

**Follow-ups.** How do you keep chunked inserts idempotent on restart? What breaks with identity keys and batching?

---

### Q35 · Disconnected entities: `Add`, `Attach`, `Update`, `Remove` — and the client-generated-key trap. *(Lead → Principal)*

**Question.** An API receives an aggregate JSON. How do you persist an update safely?

**Ideal answer.** `Add` → all `Added` (always inserts). `Attach` → `Unchanged` if key set else `Added`; changes not detected. **`Update`** → **all properties `Modified`**, keyed→Modified, unkeyed→Added: it **overwrites every column** including ones the client never sent (**over-posting / lost update**). **Trap:** `Guid` keys are `ValueGeneratedOnAdd` by convention, so with a **client-generated key** `Update(graph)` classifies a *new* aggregate as existing → `UPDATE … WHERE id=@id` → 0 rows → **`DbUpdateConcurrencyException`** for "insert failed": use **`Add`** for inserts or `ValueGeneratedNever()`. **Safer update:** load by key, `Entry(existing).CurrentValues.SetValues(dto)` / copy permitted fields, let the tracker emit a **minimal `UPDATE`** and carry the current `rowversion`. Mixed graphs: **`TrackGraph`** with per-node state. **Never bind a request directly to an entity** (mass assignment — `IsAdmin`, `Balance`). Avoid `entry.State = Modified` (marks everything modified).

**Why this is correct.** Each call's actual state effect plus the two production traps (196 §2.8).

**Common mistakes.** `Update()` for everything; setting `State = Modified`; trusting client-sent tenant/owner ids.

**Follow-ups.** How does the `rowversion` reach the client (`ETag`/`If-Match` → `412`)? How do you handle a deleted child in the payload?

---

### Q36 · Optimistic concurrency in EF Core — mechanism and resolution strategies. *(Lead → Principal)*

**Question.** Two users edit the same trade. What happens and how do you resolve?

**Ideal answer.** Configure a **concurrency token** — `[Timestamp]`/`IsRowVersion()` (SQL Server, DB-generated) or `[ConcurrencyCheck]`/`IsConcurrencyToken()` (app-managed; PostgreSQL maps `xmin`; SQLite has no native token). EF adds it to the `WHERE` (`UPDATE … WHERE Id=@p AND Version=@orig`); **0 rows → `DbUpdateConcurrencyException`** (also for concurrent deletes; **not** for insert collisions — those are unique violations). Three value sets: **current**, **original**, **database** (`GetDatabaseValuesAsync`); resolve by refreshing `OriginalValues.SetValues(databaseValues)` and retrying. Policies: **fail to caller (`412`/`409`)** for human edits; **client wins**; **database wins**; **merge** disjoint fields; **retry the whole unit re-evaluating the rule** for automated updates. **What a token can't see:** cross-row invariants, `ExecuteUpdate`/`ExecuteDelete`, raw SQL; and on a **hot row** retries *amplify* load. Alternative: snapshot/repeatable-read isolation, but the transaction must span read and write.

**Why this is correct.** Mechanism, the three-value model, policy choice by data type, and blind spots (196 §2.11).

**Common mistakes.** Catching and blindly overwriting; retrying only the save (not re-checking the rule); assuming a token guards everything.

**Follow-ups.** How does `If-Match` map to it? What metric shows contention (`optimistic_concurrency_failures`)?

---

### Q37 · Two concurrent debits of 80 on a balance of 100. Only one may succeed. *(Principal)*

**Question.** With EF Core, how?

**Ideal answer.** *Adequate:* `rowversion` on the account, load, subtract, save, catch the exception. *Excellent:* **name the invariant** (`balance ≥ 0`) — a token detects *that the row changed*, not that the rule still holds; after a conflict you must **re-read and re-evaluate** (retry the *unit*). **Best mechanism is often no read:** one **guarded statement** via `ExecuteUpdateAsync` — `SET balance = balance − @amt WHERE id=@id AND balance >= @amt`; rows-affected **1 ⇒ debited, 0 ⇒ insufficient funds**; no lost update, no token, no retry loop, lock held for one statement — place it **last** in the transaction. Then **contention**: at an 8 ms transaction a single row caps at **1/0.008 = 125 updates/s**; a hot merchant account at 58/s is ρ≈0.46 (mean queueing ≈6.8 ms; at ρ=0.9 ≈72 ms) and optimistic retries become a **retry storm** → shard the balance (N=8 → ~7/s each) or make the **append-only ledger** the source of truth. Add the **idempotency key**, **canonical lock order** for transfers, a `CHECK (available ≥ 0)` backstop, and a **reconciliation** job. Test with concurrent tasks on a **real SQL Server** (never the in-memory provider).

**Why this is correct.** Replaces read-modify-write with an atomic check-and-change, then quantifies when even that saturates (196 §2.14, §12, §15).

**Common mistakes.** Token-and-retry as the whole answer; in-memory-provider test; ignoring hot rows.

**Follow-ups.** How does lock hold time change the ceiling (2 ms ⇒ 500/s)? How do you detect a *logic* error that keeps the ledger consistent?

---

### Q38 · `ExecuteUpdate`/`ExecuteDelete` — benefits, and the pitfalls that bite. *(Lead → Principal)*

**Question.** A rewrite to `ExecuteUpdate` cut a job from 41 min to 3 s — and fees stopped being charged. What happened?

**Ideal answer.** They run **one SQL statement immediately**, **bypassing the change tracker**, no `SaveChanges`. Benefits: no load/track/one-`UPDATE`-per-row. **Six pitfalls (Microsoft Learn):** (1) **tracker unaware** — a tracked entity keeps its old snapshot; a later `SaveChanges` that touches *any* property writes the **stale value** back over the `ExecuteUpdate` (rating 5 → DB 6 → `+=2` writes 7) → **silent overwrite** (the fee incident); never mix tracked writes and `ExecuteUpdate` on the same rows in one context — use a fresh context/`Clear()`/`AsNoTracking`. (2) **No implicit transaction** — each call commits separately. (3) **No concurrency-token check** — check rows-affected yourself. (4) **No batching.** (5) **No navigations in `SetProperty`** (project first). (6) **Update/delete only**; no `ExecuteInsert`. Also `ExecuteDelete` is a *real* delete (bypasses soft-delete interceptors). EF 10: regular lambda for conditional `SetProperty`; JSON-complex-type properties updatable.

**Why this is correct.** A performance rewrite changes the *mechanism* and therefore the *guarantees* (196 §2.9, §4).

**Common mistakes.** Not asking what the new mechanism *stops* doing; believing the log line "N rows affected" proves correctness.

**Follow-ups.** Test that would have caught it? How do you make two `ExecuteUpdate`s atomic?

---

### Q39 · Bulk-insert 5 million rows. *(Lead → Principal)*

**Question.** Approach and trade-offs?

**Ideal answer.** EF has **no native bulk insert**. Ladder: `AddRange` + one `SaveChanges` (EF batches; ~10⁴ rows fine; memory-heavy beyond); **chunked** `SaveChanges` + `ChangeTracker.Clear()` (bounded memory; own the atomicity); a **bulk library** (EFCore.BulkExtensions, linq2db) — fast, skips interceptors/tracking/concurrency; **`SqlBulkCopy` into a staging table + set-based `INSERT…SELECT`/`MERGE`** — the fastest and the right choice at ≥10⁵ rows, with a validate-then-apply step and a single transaction if required. Concerns: **audit/filters/interceptors bypassed** (decision, not accident), FK order, constraint/index maintenance cost (disable non-clustered indexes? measure), log growth, **idempotent restart**, batch identity. Tag/monitor duration; run off-peak; throttle if OLTP shares the box.

**Why this is correct.** Matches technique to size and names what each route gives up (196 §2.9).

**Common mistakes.** 5 M `Add`s in one context; unnoticed audit bypass.

**Follow-ups.** How do you make it resumable? Would you pass 5 M rows through the API?

---

### Q40 · Transactions in EF Core — explicit, savepoints, `TransactionScope`, isolation. *(Principal)*

**Question.** When do you go beyond the default `SaveChanges` transaction?

**Ideal answer.** Default: each `SaveChanges` atomic. **Explicit:** `BeginTransactionAsync(IsolationLevel)` across saves/queries (inside `CreateExecutionStrategy().ExecuteAsync` when retries are on). **Savepoints:** with a transaction in progress `SaveChanges` creates one and rolls back to it on error — **incompatible with MARS**. **Share** a connection/transaction across contexts or with ADO.NET/Dapper (`UseTransactionAsync(tx.GetDbTransaction())`). **`TransactionScope`:** works with SqlClient, needs `TransactionScopeAsyncFlowOption.Enabled`, **can't commit/rollback async**, and **distributed transactions exist only on Windows since .NET 7** — don't span microservices; use **Outbox/Saga**. **Isolation:** default READ COMMITTED (locking) unless **RCSI** on (Azure SQL DB default; boxed SQL Server not) — readers stop blocking writers; `SNAPSHOT` adds update-conflict errors (3960); `SERIALIZABLE` adds range locks. Choose the **lowest level that preserves the invariant**, keep transactions **short**, never hold one across a non-DB call.

**Why this is correct.** Layered options with platform limits stated (196 §2.12).

**Common mistakes.** `TransactionScope` around HTTP calls; leaving MARS on and losing savepoints; SERIALIZABLE by default.

**Follow-ups.** How do you prove isolation choice preserves the invariant? What's the deadlock exposure of each?

---

### Q41 · Deadlocks (1205) — cause, diagnosis, and fix in an EF app. *(Principal)*

**Question.** Month-end transfers throw *"chosen as the deadlock victim."* Walk through.

**Ideal answer.** Cause: **inconsistent lock ordering** — `A→B` and `B→A` transfers each lock their source first. Latent until volume makes overlap routine. Diagnose: error **1205** (not timeout/pool); **Extended Events `xml_deadlock_report`/`system_health`** deadlock graph (two `UPDATE accounts` key locks); `TagWith` to attribute; `dm_tran_locks`/`dm_os_waiting_tasks` to rule out long blocking; reproduce with paired opposite-direction transfers. Fix: **canonical lock order** (lower id first); **short transactions, hot-row statement last**; index predicates so updates take row not range locks; **RCSI** so readers don't join chains; **retry the whole unit** (victim is fully rolled back → safe) with a **fresh context**, jittered, ≤3 attempts, **idempotent by key** — and don't assume the built-in detector retries 1205 (check your version). Prevent: CI concurrency test (paired transfers ×1,000), deadlock-count alert, review rule.

**Why this is correct.** Root cause class, tooling, layered fix (196 §2.12, §14).

**Common mistakes.** "Increase timeout"; retry without idempotency; ordering only in one code path.

**Follow-ups.** How do EF's `SaveChanges` update ordering and your explicit ordering interact? What if locks come from two different services?

---

### Q42 · The transactional outbox with EF Core. *(Principal)*

**Question.** Save a payment and publish `PaymentPosted` reliably.

**Ideal answer.** Dual-write (save then publish) can lose or phantom-publish. **Outbox:** write the event as a row **in the same DB transaction**; a **relay** publishes later. With EF: a **`SaveChangesInterceptor`** collects aggregates' domain events in `SavingChanges` and `Add`s `OutboxMessage` rows so they commit atomically with the business change. **Relay:** claim unpublished rows without double-processing — raw SQL `WITH (UPDLOCK, READPAST, ROWLOCK)` (LINQ has no hints; PostgreSQL `FOR UPDATE SKIP LOCKED`) inside a transaction; **keep the claim transaction short** (mark, commit, publish outside, mark done); ordering per aggregate key. Guarantee is **at-least-once** → **consumers must be idempotent** (dedupe on `event_id`): *exactly-once effect = at-least-once delivery + idempotent consumption*. Ops: filtered index on unpublished, retention purge, DLQ after N failures, **alert on oldest-unpublished age** (the only detector of a silently stopped relay); or CDC/log-tailing instead of polling.

**Why this is correct.** Atomicity via one transaction, honest delivery semantics, and the silent-failure detector (196 §2.13, §11 Expert).

**Common mistakes.** Publishing inside the transaction; assuming exactly-once; no relay health alert.

**Follow-ups.** Polling vs CDC trade-offs? How do you order events per aggregate?

---

# Part E — Production, Testing, Security & Leadership

### Q43 · Migrations in production — bundle vs script vs runtime, identities, locking. *(Principal)*

**Question.** How do EF migrations reach production in a regulated firm?

**Ideal answer.** Microsoft Learn's table: **SQL script** (`migrations script --idempotent`) — reviewable, DBA/review-gated, applied outside EF (no EF lock, no seeding); **bundle** (`migrations bundle` → `efbundle`) — automation, self-contained, EF lock + seeding, **cannot show its SQL**; **CLI `database update`** — local dev only; **runtime `Migrate()`** — needs elevated privileges, no review/rollback, races rolling deploys; EF 9+ adds a **database-wide lock** (fixes concurrent corruption, not privilege/review/rollback) and `Migrate()` **throws on pending model changes**. **Two identities:** deployment (schema change) vs runtime (DML only). Bundles: build in CI, run as a **one-shot job**, not in every replica entrypoint, no SDK in the app image, set **`ASPNETCORE_ENVIRONMENT=Production`** (else development secrets may load), supply `--connection` from a secret store. My design: CI emits **both**; **non-prod applies the bundle, prod applies the reviewed script by approved hash** — the approved artifact is byte-identical to what executes. Never `EnsureCreated` before `Migrate`; never wrap `Migrate` in a transaction.

**Why this is correct.** Each strategy's properties and a control-based recommendation (197 §2.2, §15).

**Common mistakes.** Runtime migrate "because EF 9 has a lock"; one identity for app and DDL; bundles without environment set.

**Follow-ups.** Rollback story? How do you keep seeding idempotent after a downgrade?

---

### Q44 · Zero-downtime schema change — rename a column on a 200 M-row table. *(Principal)*

**Question.** EF generated `DropColumn` + `AddColumn` for a rename. What do you do?

**Ideal answer.** Microsoft Learn: EF "is generally unable to know" a rename from a drop+add — applied as-is "**all your customer names will be lost**"; scaffolding prints a **data-loss warning** (a control that lives on a developer's terminal — move it into CI). Even a correct `RenameColumn` breaks **rolling deploys**: version **N and N+1 run simultaneously** (40 pods, 10 at a time, ~90 s/wave ⇒ ~6 min, plus a 24 h rollback window) so the schema must serve both. **Expand/contract:** R1 add nullable column → R2 dual-write → **batched idempotent backfill** (`WHERE new IS NULL`, 5,000-row `ExecuteUpdate` chunks; 200 M/5 k = 40,000 chunks ≈ 27 min DB time, ≈80 min throttled) → R3 read new behind a flag + nightly parity → R4 drop old after ≥2 releases and the rollback window, on a **waiver**. **Lock-queue trap:** DDL needs a Sch-M lock; behind a long transaction it waits and **every new query queues behind it** — a millisecond `ALTER` can stall ~112,000 requests (4,000 req/s × 28 s) → `SET LOCK_TIMEOUT`, check for long transactions, online/resumable index builds. Rollback = **forward-fix/flag flip**, not `Down`.

**Why this is correct.** Names the generator's blind spot, the version-skew constraint, and the lock-queue mechanism (197 §2.3, §4, §12).

**Common mistakes.** Trusting the generated migration; `NOT NULL` add without default; treating `Down` as a rollback plan.

**Follow-ups.** What CI rule catches this? How do you add an index to a 400 M-row table?

---

### Q45 · Testing code that uses EF Core — what do you recommend? *(Lead → Principal)*

**Question.** In-memory provider, SQLite, mocks, repositories, or a real database?

**Ideal answer.** Microsoft Learn: the **in-memory provider** is "highly limited… we discourage its use" (no transactions/raw SQL, different case-sensitivity, no real constraint/concurrency semantics); **mocking `DbSet`** is "complex and difficult" with the same flaws; **SQLite in-memory** is better but has "important discrepancies" and can't test provider-specific `EF.Functions`; a **repository + mocks** "alters the architecture… more implementation and maintenance costs" and excludes EF from the test. **Recommendation:** test against the **real production engine and version** — **Testcontainers** SQL Server once per run, schema by **applying real migrations** (never `EnsureCreated`), **Respawn**/transaction/per-class-database reset. Layered: domain unit tests (no EF, the bulk) → integration on the real engine → **migration tests** (empty and from previous release; `HasPendingModelChanges`) → **concurrency tests** → **query-shape tests** (command counts, SQL + parameter-type snapshots) → **model-rule tests** → few E2E via `WebApplicationFactory`. "Slow" is a fixture-design problem; "flaky" is an isolation problem.

**Why this is correct.** Follows the docs' conclusion and turns it into a concrete strategy (197 §2.5, §11 Hard).

**Common mistakes.** In-memory provider for logic that depends on constraints/transactions; `EnsureCreated` in tests when production uses migrations.

**Follow-ups.** Parallelism? Same SQL Server major version as prod? How do you test a concurrency bug?

---

### Q46 · A release that only added one column made an endpoint 100× slower. *(Principal)*

**Question.** p99 went 40 ms → 4 s. Walk through.

**Ideal answer.** **Contain first** (flag/rollback), then triage by layer. **Metrics before logs:** did `compiled_query_cache_misses` jump, `active_dbcontexts`/pool wait rise, `execution_strategy_operation_failures` spike? **A new column can hurt without a query change** — enumerate: (a) the column is **large/JSON** on a hot entity → every `SELECT` fetches it → project/side table; (b) the **migration itself** — a running backfill/rewrite, or the **lock-queue stampede** (`LCK_M_SCH_M` chains); (c) **plan-cache flush + statistics change** → recompile to a worse plan (**sniffing**) → Query Store plan compare; (d) **parameter-type change** (`nvarchar` vs `varchar`) → `CONVERT_IMPLICIT` scan (Q31); (e) **covering index no longer covers** → key lookups. Prove with the **actual plan**. Fix at the right layer; add a **SQL/parameter-type snapshot regression test**. Close the process gap: **why did staging not show it?** (production-shaped data volume).

**Why this is correct.** Structured, layer-first, and asks the process question — the module's discriminating question (197 §2.10).

**Common mistakes.** Jumping to "add an index"; optimising the query that didn't change; no containment.

**Follow-ups.** How do you build a production-scale perf environment cost-effectively? What do you alert on to catch this class next time?

---

### Q47 · Observability for EF Core — what do you instrument and alert on? *(Lead → Principal)*

**Question.** Design the diagnostics for a data-heavy service.

**Ideal answer.** **Logging** via `ILogger` (`Microsoft.EntityFrameworkCore.Database.Command`); **no sensitive-data logging in production** (EF 10 also redacts inlined constants as `?`); `ConfigureWarnings` to throw on chosen events. **Attribution:** `TagWith("Service.Class.Method")`/`TagWithCallSite()` so Query Store/APM top-N maps to code. **Metrics (EF 9+, meter `Microsoft.EntityFrameworkCore`):** `active_dbcontexts` (growth = leak), `queries` (per-request drift = N+1), `savechanges`, `compiled_query_cache_hits/misses` (sustained misses = dynamic-query defect), `execution_strategy_operation_failures` (transient infra), `optimistic_concurrency_failures` (contention); collect with OpenTelemetry (`AddMeter`) or `dotnet-counters monitor --counters Microsoft.EntityFrameworkCore -p <PID>` for older EF. **Traces:** `OpenTelemetry.Instrumentation.SqlClient`. **Interceptors** for SQL capture/RLS/audit — stateless and cheap. **Alerts:** pool wait-count >0 for 60 s (leading), deadlock count, cache hit rate <99 % for 10 min, p99 per tagged query, Query Store plan changes on critical queries, **oldest unpublished outbox age**.

**Why this is correct.** Maps each signal to a failure class and a leading indicator (197 §2.6).

**Common mistakes.** Only logging SQL; sensitive logging left on; alerting on lagging indicators (timeouts).

**Follow-ups.** How do you correlate trace → tag → plan? What's the cost of logging at `Information` in production?

---

### Q48 · Security and multi-tenancy operations for an EF Core service. *(Principal)*

**Question.** What are your controls?

**Ideal answer.** **Injection:** `FromSql`/`ExecuteSql` interpolation is parameterised; **never concatenate into `…Raw`** (EF 10 analyzer → error); allow-list dynamic identifiers. **Secrets:** Key Vault/Secrets Manager, prefer **passwordless** (managed identity/Entra), never in bundles or repos; **separate deployment vs runtime identities**; runtime DML-only, `INSERT`-only on append-only tables. **Data protection:** TDE; **Always Encrypted** (equality on deterministic columns only, test batching/`OUTPUT`); app-level encryption via converters (column becomes unqueryable); **PCI** — never model a PAN; **GDPR** — soft delete ≠ erasure (crypto-shredding). **Over-posting:** DTOs, never bind to entities. **Tenancy models:** shared schema (filter + **RLS via `SESSION_CONTEXT` on every connection open**, scoped-factory pooling), **schema-per-tenant** (custom `IModelCacheKeyFactory`), **database-per-tenant** (one ADO.NET pool per connection string ⇒ connection budget ∝ tenants; N databases to migrate; version skew) — isolation vs cost. **Change control:** approved script hash = applied artifact; four-eyes. **No `EnableSensitiveDataLogging` in prod** (startup guard).

**Why this is correct.** Layered controls with each tenancy model's operational cost (197 §2.7).

**Common mistakes.** Filter-only isolation; secrets in appsettings; soft delete as GDPR erasure.

**Follow-ups.** How does RLS behave with pooled connections? How do you migrate 300 tenant databases and track skew?

---

### Q49 · Repository over EF? EF vs Dapper policy? And leading a migration off EF6. *(Principal)*

**Question.** Three architecture-stance questions a Principal is expected to settle.

**Ideal answer.** **Repository:** `DbContext` already *is* Unit of Work + repository; a generic pass-through repository re-exposing `IQueryable` is a leaky, redundant layer (Microsoft names the cost: it "alters the architecture… more implementation and maintenance costs"; mocking it hides the behaviour worth testing). Use **aggregate repositories on the write side** (domain contract) and **direct projection queries/read models on the read side** (CQRS). **EF vs Dapper:** EF by default; Dapper/raw SQL by **measured** exception (reporting, bulk, unexpressible SQL); share `DbConnection`/`DbTransaction` when both are needed; never two idioms in one feature without reason. **EF6 → EF Core** is a **port**: inventory EDMX, lazy-loading reliance, `ObjectContext`/`SqlQuery`, TPT/TPH assumptions; scaffold and drop the designer; **explicit behaviour-difference tests** (lazy loading opt-in, client-evaluation rules since 3.0, string/collation, tracking nuances, many-to-many/entity splitting); **strangler** — one bounded context at a time with **side-by-side parity tests**; and note **EF 10 needs .NET 10 and won't run on .NET Framework**, so runtime and ORM move together.

**Why this is correct.** Positions each choice against cost/benefit and evidence, not fashion (197 §2.9).

**Common mistakes.** Generic repository "for testability"; big-bang EF6 port; ignoring the runtime constraint.

**Follow-ups.** How do you migrate a bounded context with parity tests? When *would* you add a repository?

---

### Q50 · You now own EF Core across 30 services. What do you put in place? *(Principal — capstone)*

**Question.** Standards, platform, gates, and a code-review checklist — the organisational answer.

**Ideal answer.** Encode rules **structurally**, not as documents. **Platform library:** one `AddPlatformDbContext<T>()` (provider, retry with tightened budget, pool budget derived from Little's Law, interceptors, health, warnings-as-errors); workers get **`IUnitOfWorkFactory`**, never a raw `DbContext` (analyzer); `ValidateScopes/OnBuild` enforced by test. **Model rules as CI tests:** no unbounded strings, no default `decimal(18,2)`, no comparer-less mutable converters, required-navigation×filter, explicit `OnDelete`, `IsUnicode` vs catalog. **Migration pipeline:** safety analyzer (block drops/narrowing/rename-as-drop-add without a waiver), expand/contract for big tables, idempotent script hash approval, two identities, `LOCK_TIMEOUT`, `has-pending-model-changes`, schema-compare drift gate. **Testing standard:** real engine via Testcontainers, concurrency and command-count/SQL-snapshot tests. **Observability standard:** tags on every non-trivial query, the six EF metrics, pool wait alert, Query Store plan-change alerts. **Governance:** EF upgrade runbook with dated owner (**EF 8/9 EoS 10 Nov 2026**); EF 11 features are not design inputs; waivers carry owners and **expiry**. **Review checklist:** projection/`AsNoTracking` on reads; no N+1 (count test); split-vs-single chosen; keyset paging; `ExecuteUpdate` not mixed with tracked writes; concurrency token or guarded statement; idempotency key; canonical lock order; outbox for events; no `IgnoreQueryFilters` outside the reporting context; no sensitive logging. Measure success: incident classes eliminated, not lines of standards written.

**Why this is correct.** It converts every module's incident into an automated control and explains how leverage scales across teams (197 §17, 194 §17).

**Common mistakes.** A wiki page of guidelines; gatekeeping instead of a paved road; standards with no tests; no owner for upgrades.

**Follow-ups.** How do you roll this out to 30 teams without a big-bang? What is your first quarter's ordering by risk (silent cross-tenant leak first)?

---

## Rapid-fire recall (one-liners a Lead should produce instantly)

| Prompt | Answer |
|---|---|
| Default `DbContext` lifetime? | Scoped — one unit of work |
| Default pool size for `AddDbContextPool`? | 1,024 |
| ADO.NET default `Max Pool Size` / `Connect Timeout` / `Command Timeout`? | 100 / 15 s / 30 s |
| SQL Server worker threads at 16 CPUs? | 512 + (16 − 4) × 16 = 704 |
| Retrying strategy defaults (EF source)? | 6 retries, 30 s max delay |
| What does a retrying strategy cost? | Buffers result sets |
| Client evaluation rule since EF 3.0? | Only the final projection |
| Sibling `Include`s of 10 and 10 rows per parent? | 100 rows per parent |
| Keyset vs offset complexity? | O(log N + k) vs O(offset + k) |
| Concurrency exception name / when not thrown? | `DbUpdateConcurrencyException` / insert unique violations |
| `ExecuteUpdate` and the tracker? | Fully unaware — stale overwrite risk |
| Distributed transactions in .NET? | Windows-only since .NET 7 |
| SQL Server GUID sort order? | Last 6 bytes first |
| Migration lock introduced? | EF 9 |
| `has-pending-model-changes` introduced? | EF 8 |
| EF 10 support end / requirement? | 10 Nov 2028 / .NET 10 |
| EF 8 and 9 support end? | 10 Nov 2026 |
| Metrics meter name (EF 9+)? | `Microsoft.EntityFrameworkCore` |

## How this capstone is scored (Lead vs Principal)

| Dimension | Lead (must show) | Principal (must additionally show) |
|---|---|---|
| Correctness | Right mechanism, right names, right numbers | Knows the version boundary (EF 8/9/10/11) and which claims are *unreleased* |
| Trade-offs | Names the alternative and its cost | Quantifies (Little's Law, 125 updates/s, 100 rows, 2.5 M-row scan) and picks by risk |
| Failure modes | Knows how it breaks | Knows **which failures have no detector** and what independent total/test catches them |
| Production | Reads generated SQL and migrations | Owns the pipeline, evidence, identities, upgrade runbook |
| Leverage | — | Converts each lesson into a **test, analyzer, or gate** and rolls it out across teams |

**Next:** none — this closes the `56-LINQ-EFCore` domain (Modules 194–198). For LINQ language internals see `01-CSharp/05-LINQ-Internals`; for the distributed-systems half of Q9/Q37/Q42 see `16-Distributed-Systems/02-Failure-Detection-Idempotency-Outbox` and `37-Outbox/01`.
