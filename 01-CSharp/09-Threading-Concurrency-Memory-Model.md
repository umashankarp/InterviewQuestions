# Module — C# Advanced: Threading, Concurrency Primitives & the .NET Memory Model

> Domain: C# | Level: Beginner → Expert | Prerequisite: [[01-CLR-JIT-GC-Memory-Management]] (thread stacks, GC suspension), [[02-Async-Await-Internals]] (I/O concurrency, thread pool), [[04-Delegates-Events-Closures]] (capture and shared state)

---

## 1. Topic Description

### Definition

Concurrency in .NET has two distinct halves that are constantly conflated. `async`/`await` addresses **I/O concurrency** — not occupying a thread while waiting — and is covered separately. This subtopic covers the other half: **shared-state concurrency**, where multiple threads read and write the same memory and correctness depends on synchronisation. Underpinning it is the **.NET memory model**, which defines what one thread is guaranteed to observe of another's writes. The model permits the compiler, the JIT and the CPU to reorder operations and to cache values in registers, so without explicit synchronisation a program can observe states that appear impossible from reading the source.

### Core sub-concepts

- **Threads, the thread pool and Tasks** — OS threads and their 1 MB default stacks, pool threads and injection, `Task` as a work item versus a thread.
- **The .NET memory model** — atomicity, visibility and ordering; permitted reorderings; why x64 hides bugs that ARM64 exposes.
- **`volatile`, `Volatile.Read`/`Write`, `Thread.MemoryBarrier`** — acquire/release semantics and what each does and does not guarantee.
- **Atomicity guarantees** — which types are naturally atomic, why `long` on 32-bit is not, and why atomic ≠ thread-safe.
- **`Interlocked`** — `Increment`, `Add`, `Exchange`, `CompareExchange`; compare-and-swap retry loops as the basis of lock-free code.
- **`lock` / `Monitor`** — what the compiler generates, reentrancy, `Monitor.Wait`/`Pulse`/`PulseAll`, and lock object selection.
- **Lock granularity and ordering** — coarse versus fine locks, lock convoys, and consistent ordering as the deadlock defence.
- **Other primitives** — `SemaphoreSlim` (including as an async-compatible lock), `Mutex` (cross-process), `ReaderWriterLockSlim`, `SpinLock`, `Barrier`, `CountdownEvent`, `ManualResetEventSlim`.
- **Race condition classes** — check-then-act, read-modify-write, lost update, and non-atomic publication of partially-constructed objects.
- **Deadlock, livelock, starvation, priority inversion, lock convoy** — distinct failure modes with distinct diagnoses.
- **Concurrent collections** — `ConcurrentDictionary` (and why `GetOrAdd`'s factory may run more than once), `ConcurrentQueue`/`Stack`/`Bag`, `BlockingCollection`, and immutable collections as an alternative.
- **Data parallelism** — `Parallel.For`/`ForEach`, `MaxDegreeOfParallelism`, partitioning, PLINQ, and when parallelism loses to overhead.
- **Producer/consumer pipelines** — `Channel<T>` bounded/unbounded, TPL Dataflow, and backpressure.
- **`Lazy<T>` and initialisation** — thread-safety modes, double-checked locking, and `LazyThreadSafetyMode.PublicationOnly`.
- **Thread-local state** — `[ThreadStatic]`, `ThreadLocal<T>`, and why `AsyncLocal<T>` is the correct tool in async code.
- **False sharing and cache lines** — independent variables on one cache line destroying scaling.
- **Mixing async and locking** — why you cannot `await` inside `lock`, and `SemaphoreSlim(1,1)` as the async mutual-exclusion primitive.
- **Testing concurrency** — stress and interleaving tests, deterministic scheduling, and why a passing test proves little.

### Where it fits

This sits directly on the runtime described in `01-CLR-JIT-GC-Memory-Management` — threads have stacks, the GC suspends them at safe points, and the JIT is one of the parties permitted to reorder your code. It is the necessary complement to `02-Async-Await-Internals`: async tells you how to avoid blocking a thread, and this tells you what happens when several threads touch the same state. Upward it determines whether a singleton service is safe to register, whether a cache can be shared, whether a background worker can mutate what a request handler reads, and whether a "performance optimisation" using a static field is a latent data race.

### Why it matters at scale

Concurrency defects are the most expensive bug class in production because they are **non-deterministic, load-dependent, and often silent**. A data race does not throw; it produces a wrong number, a corrupted collection, or an object that half exists — and the symptom surfaces hours later somewhere unrelated. They pass code review because each line looks correct in isolation, and they pass tests because tests do not create the interleaving. They also hide behind hardware: x64 has a relatively strong memory model that masks missing barriers, so code that has "worked for years" starts failing when deployed to ARM64 (Graviton, Apple silicon, ARM-based cloud instances), which is a genuine and current migration risk. At scale, the additional failures are throughput-shaped — a lock convoy or false sharing means adding cores makes the system slower, which is invisible until capacity planning fails.

### Common pitfalls / anti-patterns

- **Assuming a read of a shared field will see another thread's write** — without `volatile`, `Interlocked` or a lock, the JIT may hoist the read into a register, so a loop polling a `bool` flag can spin forever; this is the classic "it works in Debug and hangs in Release" bug.
- **`lock(this)` or `lock(typeof(T))` or locking on a string** — the lock object is publicly reachable, so unrelated code can take the same lock and deadlock you; always lock a private readonly object.
- **Check-then-act on a concurrent collection** — `if (!dict.ContainsKey(k)) dict.Add(k, v)` is a race even on `ConcurrentDictionary`, because the check and the act are two operations; use `TryAdd` or `GetOrAdd`.
- **Assuming `ConcurrentDictionary.GetOrAdd`'s value factory runs exactly once** — it may run on several threads concurrently for the same key, with only one result stored; if the factory is expensive or has side effects (opening a connection, starting a task) that is a real defect.
- **Inconsistent lock ordering across code paths** — thread A takes lock 1 then 2 while thread B takes 2 then 1; a textbook deadlock that appears only under concurrency and load.
- **`async` work inside a `lock`, or blocking on a lock held across an await** — `lock` cannot span an `await` at all, and holding any lock across an asynchronous boundary invites deadlock and starvation; use `SemaphoreSlim` with `WaitAsync`.
- **Publishing a partially-constructed object to a shared field** — without a release barrier, another thread can observe the reference before the constructor's writes, seeing an object with default field values.
- **`Parallel.ForEach` over work that is I/O-bound or trivially cheap** — burns pool threads on waiting, or spends more on partitioning and coordination than the work itself costs.
- **Sharing a non-thread-safe object between threads because "it's read-only in practice"** — `List<T>`, `Dictionary<K,V>`, `Random` and `DbContext` are not safe for concurrent use, and concurrent reads with a single writer are still undefined behaviour.
- **False sharing from adjacent counters** — per-thread counters packed into one array sit on one cache line, so every increment invalidates every core's cache and throughput collapses as you add threads.

---

## 2. Beginner (10 Q&A)

**Q1. What does the .NET memory model actually permit, and why does that surprise people?**
**A:** It permits the compiler, the JIT and the CPU to reorder reads and writes, and to keep values in registers rather than re-reading memory, provided single-threaded semantics are preserved. That means another thread can observe operations in an order that is impossible to derive from the source, or never observe a write at all. It surprises people because the code reads sequentially and because x64's relatively strong hardware model hides many violations — so the bug lies dormant until the code runs on ARM64 or the JIT makes a different inlining decision.
*Follow-up: Give me a two-thread example where both threads can read a stale value with no synchronisation.*

**Q2. What does `volatile` guarantee, and what does it not?**
**A:** It prevents the compiler and JIT from caching the field in a register and enforces acquire semantics on reads and release semantics on writes, so a `volatile` read cannot be reordered with subsequent operations and a `volatile` write cannot be reordered with preceding ones. That makes it correct for the flag-polling case. What it does **not** give you is atomicity of compound operations: `volatile int i; i++` is still a read-modify-write race, because volatility affects visibility and ordering, not indivisibility.
*Follow-up: When would you use `Volatile.Read`/`Volatile.Write` instead of declaring the field `volatile`?*

**Q3. Which operations are atomic in .NET without any synchronisation?**
**A:** Reads and writes of reference types and of primitive types up to the platform's native word size — so `int` and reference assignments are atomic, and you will never observe a half-written value. `long` and `double` are **not** guaranteed atomic on 32-bit platforms, which is why `Interlocked.Read` exists. Crucially, atomicity is not thread safety: an atomic read followed by an atomic write is still a race, because another thread can act in between. Most real bugs are compound operations, not torn values.
*Follow-up: `bool` is atomic, so why does a `bool` flag still need `volatile`?*

**Q4. What does `lock` compile to, and what are the rules for the lock object?**
**A:** It compiles to `Monitor.Enter` with a `try`/`finally` calling `Monitor.Exit`, so the lock is always released even on exception. `Monitor` is reentrant, meaning the same thread can acquire it again without deadlocking. The lock object must be a private, readonly reference type instance that nothing outside your class can reach — locking on `this`, on a `Type`, or on a string (which may be interned and shared process-wide) lets unrelated code participate in your lock and deadlock you for reasons you cannot see.
*Follow-up: Why can't you lock on a value type?*

**Q5. What is `Interlocked` for and what is compare-and-swap?**
**A:** `Interlocked` provides atomic read-modify-write operations — increment, add, exchange, and compare-exchange — implemented as single CPU instructions, so they are far cheaper than taking a lock. `CompareExchange` is the general primitive: it atomically sets a location to a new value *only if* it currently holds an expected value, returning what was there. That enables lock-free algorithms via a retry loop: read the current value, compute the new one, and CAS it in, looping if another thread changed it meanwhile.
*Follow-up: Write the CAS loop for atomically multiplying a shared `int` by a factor.*

**Q6. Name the distinct concurrency failure modes and how they differ.**
**A:** A **race condition** is a correctness failure where the outcome depends on timing. A **deadlock** is two or more threads each waiting for a lock another holds, so none proceeds. **Livelock** is threads actively responding to each other without making progress. **Starvation** is a thread never getting scheduled or never acquiring a contended lock. A **lock convoy** is throughput collapse when many threads queue on one lock and context-switching dominates. They matter separately because their diagnoses differ: a deadlock shows blocked threads in a dump, whereas a convoy shows high CPU and low throughput.
*Follow-up: How would you tell a lock convoy from ordinary lock contention?*

**Q7. Is `ConcurrentDictionary` enough to make code thread-safe?**
**A:** It makes each individual operation thread-safe, which is not the same as making your *use* of it safe. `if (!dict.ContainsKey(k)) dict[k] = v` is still a race, because two threads can both pass the check. The safe patterns are the atomic composite methods — `TryAdd`, `GetOrAdd`, `AddOrUpdate`, `TryRemove` — which perform the check and the act as one operation. This check-then-act mistake on a concurrent collection is extremely common precisely because the type's name suggests the problem is solved.
*Follow-up: You need to atomically update a value based on its current value. Which method, and what's the catch?*

**Q8. Why can't you `await` inside a `lock`, and what do you use instead?**
**A:** `Monitor` locks have thread affinity — the thread that entered must be the thread that exits — but a continuation after `await` may resume on a different thread, so the compiler forbids it outright. The correct primitive is `SemaphoreSlim(1, 1)` with `WaitAsync`, which is not thread-affine and can be released by whichever thread completes the work. The release must go in a `finally`, and you should be aware that this is mutual exclusion without reentrancy, so a nested acquisition deadlocks.
*Follow-up: Your async critical section calls another method that also takes the same semaphore. What happens?*

**Q9. When is `Parallel.ForEach` the right tool, and when is it wrong?**
**A:** Right for CPU-bound work over a large collection where each item's work is substantial enough to outweigh partitioning and coordination overhead — image processing, computation over a large array. Wrong for I/O-bound work, where it burns pool threads on waiting and `Task.WhenAll` over async operations is strictly better. It is also wrong for very cheap per-item work, where the overhead exceeds the work, and for anything mutating shared state without synchronisation, which it makes trivially easy to get wrong.
*Follow-up: How would you limit `Parallel.ForEach` so it doesn't starve the thread pool of workers for the rest of the app?*

**Q10. What is false sharing?**
**A:** When two independent variables happen to occupy the same CPU cache line, every write to one invalidates the other's cached copy on every other core, so threads that share no data still contend at the hardware level. The classic case is an array of per-thread counters: logically independent, physically adjacent, and throughput actually decreases as you add threads. The fix is padding so each hot variable occupies its own cache line, or restructuring so each thread accumulates locally and combines at the end.
*Follow-up: How would you detect false sharing rather than guess at it?*

---

## 3. Intermediate (10 Q&A)

**Q1. A background flag loop works in Debug and hangs in Release. Explain precisely.**
**A:** In Debug the JIT does little optimisation, so each loop iteration re-reads the field from memory and eventually sees the other thread's write. In Release the JIT can prove the loop body does not modify the field, hoist the read out of the loop into a register, and turn it into an infinite loop testing a stale value — a legal optimisation under the memory model because the model says nothing about the field without synchronisation. The fixes are `volatile`, `Volatile.Read`, `Interlocked`, or a lock; the underlying lesson is that "it worked in Debug" is evidence of a memory-model bug, not of a compiler fault.
*Follow-up: Would a `CancellationToken` have avoided this, and why?*

**Q2. How do you choose between `lock`, `Interlocked`, `SemaphoreSlim` and `ReaderWriterLockSlim`?**
**A:** `Interlocked` for single-variable atomic updates — cheapest by far and lock-free. `lock` for a short critical section over multiple fields; it is fast, reentrant and the right default. `SemaphoreSlim` when you need to limit concurrency to N rather than 1, or when the critical section contains an `await`. `ReaderWriterLockSlim` only when reads massively outnumber writes *and* the critical section is long enough to amortise its higher acquisition cost — for short sections it is usually slower than `lock`, which surprises people who reach for it by name.
*Follow-up: You have a read-mostly dictionary. Would you use `ReaderWriterLockSlim` or something else entirely?*

**Q3. Walk me through diagnosing a production deadlock.**
**A:** Take a process dump and examine the threads: a deadlock shows threads blocked in `Monitor.Wait`/`Enter` with a cycle in what each holds and wants, which `!syncblk` or the equivalent tooling will show directly. Then map the cycle back to the code paths and look for inconsistent lock ordering — the usual cause. The immediate mitigation is a restart; the fix is to establish a global lock ordering, reduce the number of locks held simultaneously, or eliminate the second lock entirely by restructuring the data. I would also add a lock-acquisition timeout in diagnostics builds so the failure is loud rather than a hang.
*Follow-up: The two locks are in different libraries and you can't change the order. Now what?*

**Q4. `ConcurrentDictionary.GetOrAdd` — what's the trap?**
**A:** The value factory is **not** guaranteed to run exactly once for a key: under concurrency several threads can invoke it simultaneously, and only one result is stored while the others are discarded. If the factory is pure and cheap that is merely wasteful; if it opens a connection, starts a background task, or registers something, you have created leaked resources or duplicate work with no error. The fix is `GetOrAdd` with a `Lazy<T>` value so the factory is invoked once by the lazy's own synchronisation, or explicit locking when the construction has side effects.
*Follow-up: Show me the `Lazy<T>` pattern and say which `LazyThreadSafetyMode` you'd choose.*

**Q5. How do you safely publish a fully-constructed object to a shared field?**
**A:** The hazard is that without a release barrier, the reference assignment can be observed by another thread before the constructor's writes to the object's fields, so a reader sees a non-null reference to an object with default values. Assigning to a `volatile` field, or using `Volatile.Write`/`Interlocked.Exchange`, provides the release semantics that order the constructor's writes before the publication. In practice, publishing immutable objects and using `Lazy<T>` or a lock avoids hand-rolling this — the double-checked locking pattern exists precisely because getting this right by hand is subtle.
*Follow-up: Write double-checked locking correctly and point at the line that most implementations get wrong.*

**Q6. When would you choose immutability over locking?**
**A:** Whenever the data is read far more often than written and can be rebuilt cheaply — configuration, lookup tables, routing rules, cached snapshots. Readers then take the current reference and use it with no synchronisation at all, because an immutable object cannot change under them, and a writer publishes a new instance with a single atomic reference assignment. That gives wait-free reads and a far simpler mental model than fine-grained locking. The cost is allocation per update, so it suits read-mostly data and not high-frequency mutation.
*Follow-up: Two related snapshots must be swapped together atomically. How do you do that?*

**Q7. How do you build a bounded producer/consumer pipeline?**
**A:** `Channel<T>` with a bounded capacity and an explicit full-mode policy, a small set of consumer tasks, and backpressure propagated to the producer rather than absorbed. Bounded is the critical decision: an unbounded channel converts a throughput mismatch into an out-of-memory crash, which destroys in-flight work rather than slowing it. The full-mode choice — wait (backpressure), drop oldest (favour freshness), drop write (shed load) — is a product decision that should be made explicitly. Queue depth and consumer lag then become the primary health metrics.
*Follow-up: When would you reach for TPL Dataflow instead of `Channel<T>`?*

**Q8. What are the thread-safety modes of `Lazy<T>` and how do you choose?**
**A:** `ExecutionAndPublication` is the default and guarantees the factory runs exactly once, at the cost of locking during initialisation — the right choice when construction has side effects or is expensive. `PublicationOnly` lets several threads run the factory concurrently and publishes the first to finish, discarding the rest; appropriate when the factory is cheap and pure and you want no lock contention. `None` is unsynchronised and only valid for confirmed single-threaded use. The mode matters because it is the same trade-off as `GetOrAdd`'s factory, made explicit.
*Follow-up: With `PublicationOnly`, the discarded instances are `IDisposable`. What do you do?*

**Q9. `ThreadLocal<T>` versus `AsyncLocal<T>` versus `[ThreadStatic]` — when does each apply?**
**A:** `[ThreadStatic]` and `ThreadLocal<T>` give per-thread storage, which is correct for genuinely thread-affine state such as a per-thread buffer or a random instance. They are wrong in async code, because a continuation can resume on a different thread and the value silently disappears. `AsyncLocal<T>` flows with the `ExecutionContext` across awaits and thread hops, which is how trace context and correlation IDs survive — but it flows *down* only, so a change made in a called method is not visible to the caller.
*Follow-up: Where does `AsyncLocal` flow break down, and what's the consequence in a multi-tenant service?*

**Q10. How do you actually test concurrent code?**
**A:** Not with ordinary unit tests, which run one interleaving and prove almost nothing. What works is stress testing — run the operation from many threads for many iterations and assert on an *invariant* rather than a single outcome, such as a counter equalling the number of increments or a collection containing exactly the expected set. Add deliberate delays or `Thread.Yield` at suspected windows to widen the race, and run under load in a soak test where pool behaviour emerges. I would also treat any intermittently-failing test as a real defect rather than flakiness, because in concurrent code it almost always is one.
*Follow-up: A stress test fails once in 10,000 runs. How do you get from that to a root cause?*

---

## 4. Expert / Architect (10 Q&A)

**Q1. Your service is being migrated from x64 to ARM64 instances. What concurrency risk does that introduce?**
**A:** ARM64 has a weaker memory model than x64: it permits reorderings that x64's hardware effectively prevents, so latent missing-barrier bugs that were masked for years can start manifesting. That means code with data races which "has always worked" is genuinely at risk, and the failures will be rare, non-deterministic and hard to attribute to the migration. I would treat it as a real workstream: audit shared mutable statics and lock-free code, add barriers or locks where reasoning is not airtight, run extended stress tests on ARM hardware specifically, and canary the migration with elevated error monitoring rather than treating it as a like-for-like instance swap.
*Follow-up: How would you find candidate code to audit, given a data race has no syntactic signature?*

**Q2. How do you decide between shared mutable state with locking, immutable snapshots, and partitioning?**
**A:** Partitioning first where the domain allows it, because state that only one thread touches needs no synchronisation at all and scales linearly — sharding work by key is the highest-leverage move available. Immutable snapshots next for read-mostly data, giving lock-free reads and a simple model at the cost of allocation on update. Locking last, and then with the smallest possible critical section. The reason for that order is that locks do not scale: contention grows superlinearly with thread count, so a design whose correctness depends on a hot lock has a throughput ceiling no hardware will lift.
*Follow-up: The domain resists partitioning because of a global invariant. How would you attack that?*

**Q3. Adding cores made the system slower. Walk me through the diagnosis.**
**A:** Negative scaling points to contention rather than capacity. The candidates are a hot lock producing a convoy, where threads spend their time context-switching rather than working; false sharing, where logically independent variables share a cache line; and excessive parallelism oversubscribing the pool so context switches dominate. I would look at CPU time versus wall time, lock contention counters, and context-switch rates, and profile at the hardware level for cache-line contention. The fix depends on which it is — partition the data, pad the fields, or reduce the degree of parallelism — but the general principle is that scaling requires reducing sharing, not adding threads.
*Follow-up: Contention counters show one lock accounts for 80% of it. What's your sequence of options?*

**Q4. What is your position on lock-free programming in application code?**
**A:** Use `Interlocked` for single-variable atomics freely — it is simple, well-understood and correct. Beyond that, hand-written lock-free data structures are a specialist activity: they are extremely hard to reason about, nearly impossible to test exhaustively, and their bugs are the worst kind — rare, non-deterministic, and manifesting as corrupted data rather than a crash. My position is to use the BCL's concurrent collections, which are written and validated by people who do this professionally, and to treat a proposal to write a custom lock-free structure as requiring an exceptional, measured justification plus a plan for how it will be verified and by whom in five years.
*Follow-up: A team has written a custom lock-free ring buffer and benchmarked it as 3x faster. How do you evaluate it?*

**Q5. How do you set concurrency standards across an organisation?**
**A:** Encode them rather than publish them: analyzers banning `lock(this)`, `lock(typeof)`, and locking on strings; a shared library providing the sanctioned primitives (bounded channels, async locks, rate limiters) so teams do not hand-roll them; and templates that start with the right patterns. Then a small set of firm rules with reasons — private lock objects, no locks held across awaits or I/O, no shared mutable statics without an explicit review, immutable by default for anything shared. I would also require concurrency-relevant code to name its thread-safety contract in a comment, because an unstated contract is one future maintainers will violate.
*Follow-up: How would you enforce "no lock held across an await" mechanically?*

**Q6. How does concurrency design interact with the GC and with latency budgets?**
**A:** Several ways that are easy to miss. The GC suspends all managed threads at safe points, so a thread in a tight loop with no safe point delays every collection and therefore every thread. Per-thread allocation in parallel work multiplies gen0 pressure, so a parallel loop can trade CPU gains for collection pauses. Thread stacks are 1 MB reserved each, so an exploded thread count is a memory problem before it is a scheduling one. And lock contention shows as latency, not CPU, which is why a service can be slow at low CPU utilisation. Concurrency and memory behaviour have to be reasoned about together.
*Follow-up: A parallel batch job increased throughput but doubled P99 on the request path sharing the process. What happened?*

**Q7. How would you design a high-throughput component that must maintain a global invariant?**
**A:** Start by testing whether the invariant is genuinely global, because most are not — a per-key or per-partition invariant permits sharding, which is the design that actually scales. Where it truly is global, the options are a single-writer design where one thread owns the state and others submit work through a queue (removing synchronisation entirely from the hot path), an `Interlocked`-based atomic where the invariant is a single value, or accepting an approximate value with periodic reconciliation. I would push hard on the business meaning of the invariant, since "must be exact and immediately visible" is often assumed rather than required, and it is the constraint that forces the expensive design.
*Follow-up: The business confirms it must be exact and immediate. What do you build?*

**Q8. How do you handle a legacy codebase with pervasive shared mutable statics?**
**A:** Inventory first — find the statics and classify them as immutable (harmless), effectively-immutable-after-startup (low risk, worth confirming), and genuinely mutable at runtime (the real problem). Attack the third group by risk: those touched on request paths, those carrying per-request or per-tenant data (which are correctness and isolation bugs, not just races), and those whose corruption would be silent. Convert them to injected scoped services or immutable snapshots rather than adding locks, because adding locks preserves the coupling and adds contention. I would add an analyzer to prevent new ones while the burn-down proceeds.
*Follow-up: One static is a cache that everything depends on and cannot be removed quickly. What's the interim?*

**Q9. What would make you choose an actor or single-threaded model over shared-memory concurrency?**
**A:** When the domain partitions naturally per entity and the alternative is hand-rolling locks around each entity's state — an actor model turns synchronisation into message ordering, which is far easier to reason about and to test. It also suits stateful, long-lived entities where the state machine matters more than throughput. The costs are real: a model the team must learn, harder debugging, and a runtime dependency that must be maintained for the system's life. I would default to `Channel`-based single-writer components, which give most of the benefit with no framework, and reserve a full actor runtime for domains where per-entity state and supervision are genuinely the core problem.
*Follow-up: You inherit a system using a hand-rolled actor abstraction nobody understands. Do you migrate it?*

**Q10. What separates an excellent answer from an adequate one on a concurrency design question?**
**A:** An adequate answer adds a lock in the right place. An excellent one first asks whether the state needs to be shared at all, and reaches for partitioning or immutability before synchronisation; states the thread-safety contract explicitly rather than leaving it implicit; identifies which operations are compound and therefore racy despite atomic parts; names the specific failure mode it is preventing rather than saying "thread safety"; considers the throughput consequence of contention, not just correctness; and says how the design would be verified, knowing that ordinary tests will not find the bug. The distinguishing quality is treating correctness under *arbitrary interleaving* as the requirement, rather than reasoning about the interleaving they happened to imagine.
*Follow-up: Given that framing, what's the first question you'd ask about any shared field you encounter in a code review?*
