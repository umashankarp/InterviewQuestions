# C# — Cram Sheet

> Tier 1 (high frequency) · Source: `01-CSharp/` (13 modules, 7,239 lines) · Read: 20 min · Drill: 3x

---

## Numbers to know cold

| Fact | Value |
|---|---|
| LOH threshold | **85,000 bytes** |
| Object header (x64) | **16 bytes** (SyncBlockIndex + MethodTable ptr) |
| Tier0 → Tier1 promotion | **~30 calls** |
| Thread-pool growth when starved | **~1 thread / sec** |
| Server GC | 1 heap + 1 GC thread **per core** |
| GC generations | Gen0 / Gen1 / Gen2 + LOH + POH |

---

## 1. CLR · JIT · GC

- **Pipeline:** C# → Roslyn → **IL + metadata** → JIT → native. Tiered: Tier0 (fast, unoptimised) → Tier1 (optimised, ~30 calls) + **OSR** for long-running loops. **R2R** = precompiled, still re-JITs hot code. **NativeAOT** = no JIT, no startup cost, no reflection-emit.
- **Generational hypothesis:** most objects die young. Cost is proportional to **survivors, not garbage** — a Gen0 collection is cheap because dead objects are never touched.
- **Write barrier + card table:** storing a reference into an older-gen object marks a card, so ephemeral GCs skip scanning all of Gen2. This is *why* Gen0 stays cheap with a huge Gen2.
- **LOH** is swept, not compacted (by default) → fragmentation; only collected with Gen2.
- **Roots:** live stack slots/registers, statics, GC handles, finalization queue. Nulling a local rarely matters (the JIT already tracks last use).
- **Server vs Workstation GC:** Server = throughput (per-core heaps); Workstation = latency/footprint. **DATAS** (.NET 8+) makes Server GC adaptive — fixes container over-commit.
- **Stack vs heap:** a struct lives *wherever its storage lives*. Struct field of a class → heap. Captured in a closure or held across `await` → heap. "Structs go on the stack" is a rule of thumb about locals only.

> **TRAP** — `GC.Collect()` on a request path: forces a full blocking collection, discards tuning heuristics, makes latency worse.
> **TRAP** — "Background GC never blocks." It still has brief blocking phases.

**Tools:** `dotnet-counters` (live) · `dotnet-trace` (timeline) · `dotnet-gcdump` (heap diff) · `dotnet-dump` (post-mortem).

---

## 2. Async / Await

- `await` does **not** block a thread — it registers a continuation and returns. The compiler rewrites the method into a **state machine** (`struct`, boxed only on genuine suspension).
- **SynchronizationContext** = *which thread runs the continuation*. **ExecutionContext** = *what ambient data flows* (AsyncLocal, principal). Different concerns — never conflate.
- **Classic deadlock** requires a captured SyncContext (WinForms/WPF/legacy ASP.NET): `.Result` blocks the one thread the continuation needs. **ASP.NET Core has no SyncContext** → sync-over-async there causes **thread-pool starvation** instead. Different failure, harder to spot.
- `ValueTask<T>`: avoids allocation when completing synchronously. **Strict rules** — await once, no `.Result` before completion, never cache. Use narrowly, after profiling.
- `async void`: exceptions cannot be caught → crashes the process. Only for UI event handlers.
- `Task.Run` = move CPU-bound work off the caller. Pointless inside an ASP.NET Core handler (already a pool thread) — it just adds a hop.
- `Task.WhenAll` aggregates exceptions, but `await` surfaces **only the first** — inspect `.Exception.InnerExceptions` for the rest.
- **Bounded concurrency is mandatory** when fanning out: `Parallel.ForEachAsync`, `SemaphoreSlim`, `Channel<T>`.

> **TRAP** — sharing a scoped `DbContext` across `Task.WhenAll` branches → silent data corruption (not thread-safe).
> **TRAP** — `ConfigureAwait(false)` is not purely perf; it changes behaviour where a real SyncContext matters.

---

## 3. Span&lt;T&gt; / Memory&lt;T&gt; / Low allocation

- `Span<T>` = `{ ref T, int Length }`. A **view, not a copy** — mutating it mutates the backing memory. As a `ref struct`: no boxing, no heap fields, **cannot cross `await`**.
- `Memory<T>` = the heap-safe counterpart, for fields and across `await`.
- `ArrayPool<T>` solves *repeated buffer allocation*; `Span<T>` solves *allocation when slicing*. Complementary, not alternatives.
- `ArrayPool.Rent` **may return a larger array** — always track the requested length.
- `"literal"u8` → compile-time `ReadOnlySpan<byte>` into static data. Genuinely free.
- `System.IO.Pipelines` / `ReadOnlySequence<T>` exist because real I/O is **not contiguous**; `Span<T>` alone assumes it is.

> **TRAP** — `stackalloc` sized by untrusted input = stack-overflow DoS. Always cap.
> **TRAP** — forgetting `clearArray: true` on `ArrayPool.Return` leaks sensitive data to the next renter.
> **TRAP** — `PipeReader.AdvanceTo(consumed, examined)`: wrong `examined` → busy-loop or stall.

**Framing:** this is an optimisation for *profiled hot paths*, not a default style.

---

## 4. Delegates · Events · Closures

- Delegate = type-safe method reference. `event` = delegate field with compiler-enforced `+=`/`-=`-only external access.
- Multicast delegates are **immutable** — `+=`/`-=` allocate a new instance, O(N).
- **Only the last subscriber's return value survives** a non-void multicast invoke. Classic silent-validation-bypass bug.
- **An exception in subscriber N aborts N+1 onward.** For isolation: `GetInvocationList()` + per-subscriber try/catch.
- **Closures** lift captured variables into a compiler-generated heap class → that is why mutation after lambda creation is visible inside, and why capture allocates.
- `for`-loop closures share **one** captured variable across iterations; `foreach` does not (since C# 5).

> **TRAP (the big one)** — **lapsed listener**: a long-lived publisher's event keeps every subscriber alive forever. The #1 production memory leak in this topic.
> **TRAP** — re-writing an identical-looking lambda at `-=` time does not unsubscribe. Store the original instance.

---

## 5. LINQ Internals

- `IEnumerable<T>` → lambda compiles to a **delegate**, runs in-process. `IQueryable<T>` → lambda compiles to an **expression tree**, translated by a provider (EF Core → SQL).
- The distinction to say out loud: `Func<T,bool>` (compiled code) vs `Expression<Func<T,bool>>` (**inspectable data describing** the lambda).
- **Deferred execution:** nothing runs until enumerated. Captured variables are read **at enumeration time**. Re-enumerating re-runs the whole chain.
- `yield return` → iterator state machine — structurally the same compiler trick as `async`.
- **Client-side evaluation** = a non-translatable method inside an `IQueryable` predicate. Modern EF Core throws; older versions silently pulled the whole table. Highest-severity LINQ bug class.
- `Where`/`Select` **stream** (O(1) extra memory). `OrderBy`/`GroupBy` **buffer everything** (O(n)).
- `Count` is O(1) for `ICollection<T>`, O(n) otherwise — decided at runtime by the actual type, not the static type.
- `Any()` beats `Count() > 0`. `AsNoTracking()` is near-free on read-only queries.

> **TRAP** — never leak a raw `IQueryable<T>` past a repository boundary → `ObjectDisposedException` once the `DbContext` is gone. Use the **Specification pattern**: pass `Expression<Func<T,bool>>` as data, never a live `IQueryable`.
> **Diagnostic tell:** a breakpoint inside an `IQueryable` predicate that *hits* proves client-side evaluation.

---

## 6. Generics & Variance

- C# generics are **reified** — full type info at runtime. **Value-type** instantiations get separately JIT-specialised code (no boxing); **reference-type** instantiations share one code body.
- Variance applies **only to interfaces and delegates**, never classes/structs, and only when `T` is used in one direction:
  - `out T` (**covariant**) — `T` only comes out. `IEnumerable<Cat>` → `IEnumerable<Animal>` ✔
  - `in T` (**contravariant**) — `T` only goes in. `IComparer<Animal>` → `IComparer<Cat>` ✔
  - `Func<in T, out TResult>` — the canonical both-directions example.
- `List<Cat>` ✖→ `List<Animal>`: invariant, because `Add`/indexer put `T` in *both* positions.
- **Standard fix pattern:** split into a covariant read-only interface plus an invariant read-write one. The BCL does exactly this (`IEnumerable`/`ICollection`/`IList`).
- Variance is **100% compile-time** — zero runtime cost, no wrapping.
- `where T : new()` guarantees `new T()` **compiles**, not that the result is valid or initialised.
- **Generic math** (C# 11+): `static abstract` interface members → `INumber<T>`.

> **TRAP** — a `static` field in a generic class gets **independent storage per closed type**, even though ref-type instantiations share JIT'd code.
> **TRAP** — overloads cannot differ by constraint alone; `where` does not participate in overload resolution.

---

## 7. Records · Pattern Matching · Immutability

- `record` synthesises value equality, `ToString`, deconstruction, `with`. `record` = `record class` (reference type); `record struct` is the value variant.
- **`with` is a SHALLOW copy** — the #1 gotcha; name it unprompted. Mutable reference members are *shared* between original and copy. Fix: immutable collections.
- `EqualityContract` makes record equality respect **runtime type**, so base and derived instances with equal shared members do not compare equal.
- Patterns: type · property · positional · relational · list (C# 11+).
- **`CS8509` (non-exhaustive switch) is a WARNING, not an error.** Enable warnings-as-errors for a real guarantee.
- Sealed hierarchy + exhaustive switch = C#'s practical discriminated union.

> **TRAP** — a `_ => default` discard arm silently defeats exhaustiveness checking for every future case.
> **TRAP** — a record's default `ToString()` prints all properties → leaks PII/secrets into logs.

---

## 8. Exceptions

- **Two-pass model:** pass 1 = *search* (evaluates filters, **no unwinding**) → pass 2 = *unwind* (runs `finally`). This is exactly why `when` filters can inspect un-unwound stack state.
- `throw;` **preserves** the stack trace. `throw ex;` **resets** it. Top-tier distinguishing question.
- `ExceptionDispatchInfo.Capture(ex).Throw()` — preserves the trace when rethrowing on a *different* thread or location. This is what `Task` uses internally.
- Throwing is expensive (stack capture + two-pass). Never use exceptions for routine control flow — follow the BCL's own `Parse`/`TryParse` convention.
- **Type selection:** `ArgumentException` family = *caller bug*. `InvalidOperationException` = *bad state for this operation*. Custom domain exception = *expected, named domain failure*.
- Broad `catch (Exception)` is legitimate **only** at deliberate boundaries: a global handler, or per-item queue-consumer isolation.

> **TRAP** — `.Result`/`.Wait()` surfaces a raw `AggregateException`; `await` auto-unwraps. A catch written for one stops matching if the caller switches to the other.
> **TRAP** — `finally` is not unconditional: process termination and `StackOverflowException` skip it.
> **The principle interviewers probe:** separate *expected domain failure* from *unexpected bug*, in both type design and log severity. Conflating them hides real bugs for months.

---

## 9. Threading & the .NET Memory Model

- `lock` = `Monitor.Enter/Exit`; reentrant on the same thread. `SemaphoreSlim` for async (`lock` cannot span `await`).
- `volatile` = prevents reordering + guarantees visibility; it is **not** atomicity. `Interlocked` for atomic read-modify-write.
- `Interlocked.CompareExchange` = the CAS primitive behind lock-free structures.
- Memory model: .NET is stronger-than-spec on x86/x64; **ARM is weaker** — code that "works" on x64 can break on Graviton/Apple Silicon.
- `ThreadLocal<T>` vs `AsyncLocal<T>`: the latter flows with `ExecutionContext` across `await`.

---

## 10. Collections & BCL Internals

- `Dictionary<K,V>`: bucket array + entry array, chained via a `next` index. O(1) amortised; **degrades to O(n)** with a bad `GetHashCode`.
- `List<T>`: backing array, **doubles** on growth. Set `capacity` when the size is known.
- **Struct enumerators** — `foreach` over `List<T>`/`Dictionary` directly is allocation-free, but **boxes** when enumerated through the `IEnumerable<T>` interface.
- `ConcurrentDictionary`: striped locks for writes, lock-free reads. `GetOrAdd`'s factory **may run more than once** — it is not atomic.
- Immutable collections use structural sharing; `ImmutableArray` is cheap to read, expensive to add; `ImmutableList` is a tree.
- **Always override `GetHashCode` with `Equals`** — mutating a key after insertion loses it permanently.

---

## 11. Disposal & Nullability

- `IDisposable` = deterministic cleanup. **Finalizers are a costly safety net**, not a mechanism — they promote the object a generation and delay collection.
- Dispose pattern: `Dispose(bool disposing)` + `GC.SuppressFinalize(this)`.
- `IAsyncDisposable` + `await using` for async resources.
- **`HttpClient`**: do not dispose per use (socket exhaustion) and do not hold one forever (stale DNS). Use `IHttpClientFactory`.
- NRTs are **compile-time only** — zero runtime enforcement. A `null` can still arrive from JSON, EF, or untyped/legacy code. Validate at boundaries regardless.

---

## 12. Reflection · Attributes · Source Generators

- Reflection is slow (metadata lookup, no inlining) and **breaks NativeAOT/trimming**.
- Faster paths: cache `MethodInfo`, compile to a delegate (`Expression.Compile`), or eliminate it with a **source generator**.
- Source generators run at compile time and emit real C# — zero runtime cost, AOT-safe. Used by `System.Text.Json`, `LoggerMessage`, and regex.

---

## 13. Strings · Encoding · Globalization

- `string` is UTF-16, immutable, interned for literals. `StringBuilder` when the loop count is unknown.
- **`char` ≠ character** — surrogate pairs (emoji) and grapheme clusters. Use `StringInfo`/runes.
- **Comparison is the interview trap:** `Ordinal` for identifiers, IDs, protocol tokens. Culture-sensitive **only** for user-facing sort/display.
- The **Turkish-I** problem: `ToLower()` on `"I"` in `tr-TR` yields dotless `ı` → security checks and lookups fail. Always `ToLowerInvariant()` / `StringComparison.Ordinal`.

---

## Top 10 traps (drill these)

1. `with` is a shallow copy.
2. Only the **last** multicast subscriber's return value survives.
3. `throw ex;` destroys the stack trace.
4. `CS8509` exhaustiveness is only a warning.
5. `ArrayPool.Rent` returns a **larger** array.
6. Lapsed-listener event leak.
7. `IQueryable` leaked past the repository boundary.
8. Scoped `DbContext` shared across `Task.WhenAll`.
9. `stackalloc` from an untrusted length.
10. `ToLower()` in `tr-TR`.

---

## Interview Q&A — Lead / Principal

**Answer frame (five beats):** ① headline the decision first → ② mechanism underneath *(Senior stops here)* → ③ trade-off + the threshold where the answer flips → ④ failure mode **and how you'd know**; name what has no detector → ⑤ *(Principal)* should it exist, who owns it in three years.

### Q1 · Sync-over-async in production *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"Your API is timing out under load. CPU is 15%. Thread count is climbing. What's happening?"*

**Answer.** That signature — **high latency, low CPU, climbing thread count** — is thread-pool starvation, and in ASP.NET Core it's almost always sync-over-async: a `.Result`, `.Wait()`, or synchronous I/O on a pool thread. Each blocked request consumes a thread that can't be reused, the pool injects new threads at only about **one per second**, so arrival rate outruns supply and queue depth grows without bound. I'd confirm with `dotnet-counters` — `threadpool-queue-length` rising while `cpu-usage` stays low is conclusive — then `dotnet-stack` or a dump to find the blocking frame. Fix is async all the way down; the stopgap is raising `ThreadPool.SetMinThreads` to survive the incident, and I'd be explicit that's buying time, not a fix. Prevention is a Roslyn analyzer banning `.Result`/`.Wait()` at PR time, because this reappears the moment someone is in a hurry.

**Why it lands.** Names the *signature* before the cause, gives the specific counter, separates mitigation from remediation.
**✗ Weak answer.** "We need more CPU / more instances." Scaling out multiplies it — each new instance starves the same way.
**↳ Follow-ups.** Why no deadlock here but a hang in WinForms? What does `SetMinThreads` actually cost? How do you catch it before production?

---

### Q2 · Deadlock vs starvation *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Same `.Result` call — why does it hang instantly in a desktop app but only fail under load in ASP.NET Core?"*

**Answer.** Whether a `SynchronizationContext` was captured. In WinForms/WPF/legacy ASP.NET there's a single-threaded context: `await` schedules the continuation back onto *that* thread, and `.Result` is blocking *that* thread — so the continuation can never run. Deterministic deadlock, first request, every time. **ASP.NET Core has no SynchronizationContext**, so the continuation goes to any pool thread and the call does complete — it just burns a thread while waiting. Fine in dev at one request, collapses at a few hundred concurrent. The second failure is harder because it's load-dependent and looks like a capacity problem.

**Why it lands.** Explains why the same code has two different failure modes — the distinction most candidates flatten.
**✗ Weak answer.** "`ConfigureAwait(false)` fixes it." It prevents the deadlock; it does nothing for starvation, which is the ASP.NET Core case.
**↳ Follow-ups.** So is `ConfigureAwait(false)` needed in ASP.NET Core? Where does `ExecutionContext` still flow?

---

### Q3 · GC pauses in production *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"p99 latency spikes to 2 seconds every few minutes. p50 is fine. Where do you look?"*

**Answer.** Periodic p99 spikes with a healthy p50 is a stop-the-world signature — usually Gen2/blocking GC. First number is **allocation rate, not heap size**: a small heap with a huge allocation rate causes constant collections. `dotnet-counters` for `alloc-rate`, `gen-2-gc-count`, `% time in GC`; above roughly 5–10% time in GC I stop looking elsewhere. Then `dotnet-gcdump` twice a few minutes apart and **diff** — that shows what's *surviving*, not what's being allocated. Common causes: Large Object Heap traffic (≥ **85,000 bytes**, only collected with Gen2, not compacted by default) and mid-life promotion from caching objects just long enough to reach Gen2. Fixes are `ArrayPool`, `Span` on the hot path, and correcting cache lifetimes. In a container I'd check whether Server GC is over-committing and whether **DATAS** (.NET 8+) applies.

**Why it lands.** Allocation-rate-first is the expert move; a gcdump *diff* rather than a snapshot shows you've done this for real.
**✗ Weak answer.** "Call `GC.Collect()`" or "add memory." The first forces the exact pause you're removing.
**↳ Follow-ups.** Server vs Workstation GC here? What does a configurable LOH threshold change? When is a pause budget a design constraint?

---

### Q4 · Should we adopt `Span<T>` / low-allocation patterns? *(Principal)* ⭐⭐⭐
**Asked as:** *"A senior engineer wants to rewrite the parsing layer with `Span<T>` and `ArrayPool`. Do you approve it?"*

**Answer.** Only against a profile showing that layer is hot, with a target number. `Span<T>` genuinely eliminates slicing allocations and `ArrayPool` eliminates repeat buffer allocation — but they carry a permanent readability tax and a class of bugs the team hasn't had: `ref struct` can't cross an `await`, `ArrayPool.Rent` returns a **larger** array than requested, and a pooled buffer without `clearArray: true` leaks data between renters. That last one is a security finding in a payments context, not a performance note. So: show me the allocation rate and the p99 contribution, scope it to the measured hot path, and I want pooled-buffer clearing in the PR checklist. A FIX or market-data parser on a latency budget, yes. The admin API, no.

**Why it lands.** Approves conditionally with a measurable gate, and names the *security* failure rather than only the perf trade.
**✗ Weak answer.** Blanket yes ("it's faster") or blanket no ("premature optimisation") — both skip the measurement.
**↳ Follow-ups.** What breaks if a `Span` crosses an `await`? How would you cap a `stackalloc` from untrusted input?

---

### Q5 · Records and immutability in a domain model *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"We migrated our domain entities to records. Production shows two orders sharing modified line items. Why?"*

**Answer.** **`with` is a shallow copy.** If the record holds a mutable reference type — a `List<OrderLine>` — the copy and the original share the same list instance, so mutating through one is visible through the other. The record gives value *equality*, not deep immutability, and people assume both. Fix: pair records with immutable collections (`ImmutableList<T>`), or model line items as records too and replace rather than mutate. I'd add an architecture test banning mutable collection types on record properties, because review won't catch this reliably. Two related traps: the synthesised `ToString()` prints every property, so a record holding a PAN or token leaks it into logs; and switch exhaustiveness (`CS8509`) is only a **warning** — you need warnings-as-errors for a real guarantee.

**Why it lands.** Diagnoses from the symptom, generalises to the bug class, then makes it structurally impossible rather than relying on review.
**✗ Weak answer.** "Records are immutable" — they're *shallowly* immutable, which is exactly the bug.
**↳ Follow-ups.** What does `EqualityContract` do across inheritance? When is `record struct` a regression?

---

### Q6 · Exception design and `catch (Exception)` *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Review this: every service method is wrapped in `try { } catch (Exception ex) { log; return null; }`."*

**Answer.** I'd reject it, because it conflates two categories needing opposite treatment: **expected domain failures** (insufficient funds, card declined) and **unexpected bugs** (null reference, missing config). Catching both and returning null means a genuine defect is logged at the same severity as a business outcome and swallowed — which is how a real bug survives for months while dashboards stay green. Broad catch is legitimate at exactly two places: a global handler at the process boundary, and per-item isolation in a queue consumer so one poison message doesn't kill the worker. Everywhere else, let it propagate. Domain failures get named exception types or a `Result<T>`, following the BCL's own `Parse`/`TryParse` precedent, logged at Information or Warning. Bugs propagate, alert, page. I'd also check for `throw ex;` while I'm there — it resets the stack trace and turns a five-minute diagnosis into an afternoon.

**Why it lands.** Frames it as a *category* error with an operational consequence, and gives the two legitimate exceptions rather than an absolute rule.
**✗ Weak answer.** "Never catch general exceptions" — too absolute; the interviewer will produce the queue-consumer counterexample.
**↳ Follow-ups.** Where does `ExceptionDispatchInfo` fit? What changes if the caller switches from `await` to `.Result`? How do you classify transient vs permanent for retry?

---

### Q7 · `HttpClient` and socket exhaustion *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Intermittent `SocketException` calling a partner API under load. Code uses `using var client = new HttpClient()`."*

**Answer.** Socket exhaustion. Disposing `HttpClient` doesn't release the TCP connection immediately — it sits in `TIME_WAIT` for up to four minutes, so under load you exhaust ephemeral ports. The naive fix, a static `HttpClient`, swaps one bug for another: it caches DNS at handler creation, so when the partner fails over you keep hitting a dead IP. **The answer is `IHttpClientFactory`**, which pools handlers *and* rotates them on a lifetime so DNS is honoured. Saying both halves matters — most candidates know only the socket half. Then I'd add resilience through the factory: Polly timeout, retry with jitter, and a circuit breaker, because a partner API is exactly where you want to fail fast rather than pile up doomed calls.

**Why it lands.** Names the second, subtler failure of the obvious fix — the level differentiator on this question.
**✗ Weak answer.** "Make it static." Correct for sockets, introduces DNS blindness.
**↳ Follow-ups.** What handler lifetime and why? Where does breaker state live across 20 replicas?

---

### Q8 · Thread safety on a shared cache *(Lead)* ⭐⭐⭐
**Asked as:** *"We use a `static Dictionary` as an in-process cache. It occasionally throws or returns wrong data."*

**Answer.** `Dictionary<K,V>` isn't thread-safe, and concurrent writes corrupt the bucket structure — showing up as an infinite loop, a wrong read, or an `IndexOutOfRangeException` from inside the BCL, all of which look inexplicable. `ConcurrentDictionary` is the direct fix, with one caveat: **`GetOrAdd`'s value factory can run more than once** under contention, so if it's expensive or has a side effect, wrap it in `Lazy<T>`. Beyond correctness I'd question the cache itself — a static in-process cache means N replicas hold N divergent copies with no invalidation path, so a config change lands at different times on different instances. Where staleness matters, `IMemoryCache` with a bounded size and TTL, or Redis if it must be coherent across the fleet.

**Why it lands.** Fixes the bug, then escalates to the architectural problem the bug was hiding.
**✗ Weak answer.** "Add a `lock`" — works, serialises every read, and misses the coherence issue.
**↳ Follow-ups.** What does a bad `GetHashCode` do here? How do you invalidate across replicas?

---

### Quick-fire (30 seconds each)

- **"What happens when you `await`?"** → The compiler builds a state machine. At the await point, if the operation is incomplete, it registers a continuation and returns the thread to the pool. On completion the continuation resumes — on the captured SynchronizationContext if there is one. No thread is blocked while waiting.
- **"Why is a Gen0 GC cheap?"** → Cost is proportional to survivors, not garbage. Gen0 is small and contiguous; mark what is live, compact, reset the allocation pointer. Dead objects are never touched, and card tables keep Gen2 out of the scan.
- **"IEnumerable vs IQueryable?"** → Delegate vs expression tree. One executes in-process; the other is inspectable data a provider translates to SQL. The risks are client-side evaluation and leaking `IQueryable` past its `DbContext`.
- **"Deadlock vs starvation?"** → Deadlock requires a captured SynchronizationContext — the blocked thread is the one the continuation needs. ASP.NET Core has none, so sync-over-async exhausts the thread pool instead, which grows ~1 thread/sec and looks like a slow site rather than a hang.

---

**Go deeper:** `01-CSharp/01`–`13` · **Related sheets:** [[02-DotNet-AspNetCore]], [[56-EFCore]], [[29-Performance-Engineering]]
