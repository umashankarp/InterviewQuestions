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

**Q1. This exits fine in Debug and hangs forever in Release. Why?**
```csharp
private bool _stop;
void Worker()  { while (!_stop) { DoWork(); } }
void Stop()    => _stop = true;
```
**A:** Nothing in the loop writes `_stop`, so the JIT is free to hoist the read into a register and you spin on a stale copy forever. Debug doesn't optimise, so it re-reads memory each iteration and happens to work. Fix is `volatile`, `Volatile.Read`, `Interlocked`, or a lock. "Works in Debug, hangs in Release" is the tell for a memory-model bug — it's not a compiler fault.
*Follow-up: Does making it `volatile` also make `_counter++` safe?*

**Q2. `_count` is `volatile`. Is this thread-safe?**
```csharp
private volatile int _count;
public void Add() => _count++;
```
**A:** No. `volatile` gives you visibility and ordering, not atomicity. `_count++` is read, add, write — three operations, and two threads can interleave so one increment is lost. Use `Interlocked.Increment(ref _count)`, which is a single atomic instruction. This is the most common misunderstanding of `volatile`: it stops the value being cached in a register, it doesn't make a compound operation indivisible.
*Follow-up: Which operations *are* atomic without any synchronisation?*

**Q3. What's wrong with the lock object here?**
```csharp
public void Update() {
    lock (this) { /* ... */ }
}
```
**A:** `this` is publicly reachable, so any other code holding a reference to your object can take the same lock — including code you've never seen. That's a deadlock you can't diagnose from your own source. Same problem with `lock(typeof(Foo))` and locking on a string, which may be interned and shared process-wide. Always lock a `private readonly object`.
*Follow-up: Why can't you lock on a value type?*

**Q4. What does `Interlocked.CompareExchange` do, and what's it for?**
**A:** It atomically sets a location to a new value only if it currently holds the value you expected, and returns whatever was actually there. That's the building block for lock-free updates: read the current value, compute the new one, CAS it in, and loop if someone else changed it in between. It's a single CPU instruction, so it's far cheaper than taking a lock — which is why `Interlocked` is the right tool for single-variable updates and a lock is the right tool for a critical section over several fields.
*Follow-up: Write the CAS loop for atomically multiplying a shared `int`.*

**Q5. Is this safe?**
```csharp
if (!_dict.ContainsKey(key))
    _dict.TryAdd(key, value);   // _dict is ConcurrentDictionary
```
**A:** No. Each call is individually thread-safe, but check-then-act across two calls is a race — two threads can both pass the `ContainsKey`. The concurrent collection makes operations atomic, not your *use* of them. Use `TryAdd` on its own, or `GetOrAdd`/`AddOrUpdate`, which do the check and the act as one operation. This mistake is common precisely because the type's name suggests the problem is already solved.
*Follow-up: You need to update a value based on its current value. Which method, and what's the catch?*

**Q6. Why won't this compile, and what do you use instead?**
```csharp
lock (_gate) {
    await _repo.SaveAsync();
}
```
**A:** `Monitor` locks have thread affinity — the thread that entered must exit — and a continuation after `await` may resume on a different thread, so the compiler rejects it outright. Use `SemaphoreSlim(1,1)` with `await _sem.WaitAsync()` and release in a `finally`. Two things to know: it isn't reentrant, so a nested acquisition of the same semaphore deadlocks; and holding *any* lock across an await is worth avoiding anyway, because you're holding it for a network round trip.
*Follow-up: Your critical section calls a method that also takes the same semaphore. What happens?*

**Q7. Name the concurrency failure modes and how they differ.**
**A:** A race condition is a correctness failure where the outcome depends on timing. A deadlock is threads waiting on locks each other holds, so nothing progresses. Livelock is threads actively reacting to each other without making progress. Starvation is a thread never getting scheduled or never winning a contended lock. A lock convoy is throughput collapsing because many threads queue on one lock and context switching dominates. They matter separately because the diagnosis differs — a deadlock shows blocked threads in a dump; a convoy shows high CPU and low throughput.
*Follow-up: How would you tell a convoy from ordinary contention?*

**Q8. What's the risk in this cache?**
```csharp
_cache.GetOrAdd(key, k => new DbConnection(cs));
```
**A:** `GetOrAdd`'s value factory is not guaranteed to run once. Under concurrency several threads can invoke it for the same key, and only one result is stored — the rest are discarded. With a pure, cheap factory that's just wasted work. Here you're opening connections and throwing them away unclosed. Wrap the value in a `Lazy<T>` so the factory creating the `Lazy` is cheap and the expensive construction is guarded by the lazy's own synchronisation.
*Follow-up: Which `LazyThreadSafetyMode` would you pick, and why?*

**Q9. What's false sharing?**
**A:** Two independent variables landing on the same CPU cache line, so a write to one invalidates the other's cached copy on every core — threads that share no data still contend at the hardware level. The classic case is an array of per-thread counters: logically independent, physically adjacent, and throughput actually *drops* as you add threads. Fix is padding so each hot variable owns its cache line, or having each thread accumulate locally and combine at the end.
*Follow-up: How would you detect it rather than guess?*

**Q10. `ThreadLocal<T>`, `[ThreadStatic]`, or `AsyncLocal<T>` — which and when?**
**A:** `[ThreadStatic]` and `ThreadLocal<T>` give per-thread storage, correct for genuinely thread-affine state like a per-thread buffer. They're wrong in async code, because a continuation can resume on a different thread and the value silently disappears. `AsyncLocal<T>` flows with `ExecutionContext` across awaits and thread hops — that's how trace context survives an `await`. Note it flows *down* only: a change made in a called method isn't visible to the caller.
*Follow-up: Where does `AsyncLocal` flow break, and what's the consequence in a multi-tenant service?*

---

## 3. Intermediate (10 Q&A)

**Q1. How do you choose between `lock`, `Interlocked`, `SemaphoreSlim` and `ReaderWriterLockSlim`?**
**A:** `Interlocked` for a single-variable atomic update — cheapest, lock-free. `lock` for a short critical section over several fields; it's fast, reentrant, and the right default. `SemaphoreSlim` when you need to limit concurrency to N rather than 1, or when the critical section contains an `await`. `ReaderWriterLockSlim` only when reads massively outnumber writes *and* the section is long enough to amortise its higher acquisition cost — for short sections it's usually slower than `lock`, which surprises people who pick it by name.
*Follow-up: You have a read-mostly dictionary. Would you actually reach for `ReaderWriterLockSlim`?*

**Q2. Production deadlock. Walk me through diagnosing it.**
**A:** Take a dump and look at the threads — a deadlock shows threads blocked in `Monitor.Enter` with a cycle in what each holds and wants; `!syncblk` shows it directly. Map the cycle back to the code and you'll almost always find inconsistent lock ordering: one path takes A then B, another takes B then A. Immediate mitigation is a restart. The fix is a global lock ordering, holding fewer locks at once, or restructuring the data so the second lock disappears. I'd also add lock-acquisition timeouts in diagnostic builds so it fails loudly instead of hanging.
*Follow-up: The two locks are in different libraries and you can't change the order. Now what?*

**Q3. What's the bug, and why does it only show up under load?**
```csharp
public static Config Current;
void Reload() { Current = new Config(_settings); }
```
**A:** Publishing a reference without a release barrier. Another thread can see the non-null `Current` reference *before* the constructor's writes to the object's fields are visible, so it reads a `Config` with default values. It only appears under concurrency, on weaker memory models, and after the JIT has optimised — which is why it survives testing. Make the field `volatile`, or publish with `Volatile.Write`/`Interlocked.Exchange`, or build it with `Lazy<T>`.
*Follow-up: Write double-checked locking correctly and point at the line most people get wrong.*

**Q4. When would you choose immutability over locking?**
**A:** Whenever the data is read far more than written and can be rebuilt cheaply — configuration, lookup tables, routing rules, cached snapshots. Readers take the current reference and use it with no synchronisation at all, because an immutable object can't change under them; a writer builds a new instance and publishes it with one atomic reference assignment. Wait-free reads and a much simpler mental model than fine-grained locking. The cost is an allocation per update, so it suits read-mostly data rather than high-frequency mutation.
*Follow-up: Two related snapshots must be swapped together atomically. How?*

**Q5. You add cores and the system gets slower. What are you looking for?**
**A:** Contention, not capacity. Three candidates: a hot lock producing a convoy, where threads spend their time context-switching rather than working; false sharing, where logically independent variables share a cache line; and oversubscription, where too many threads mean context switches dominate. I'd compare CPU time against wall time, look at lock-contention counters and context-switch rates, and profile for cache-line contention. The general principle is that scaling comes from reducing *sharing*, not from adding threads.
*Follow-up: Contention counters show one lock at 80%. What are your options, in order?*

**Q6. Build me a bounded producer/consumer pipeline.**
**A:** `Channel<T>` with a bounded capacity, an explicit full-mode policy, a small set of consumer tasks, and backpressure propagated to the producer rather than absorbed. Bounded is the decision that matters — unbounded turns a throughput mismatch into an out-of-memory crash, which destroys in-flight work rather than slowing it. The full-mode choice is a product decision: `Wait` applies backpressure, `DropOldest` favours freshness, `DropWrite` sheds load. Queue depth and consumer lag become your primary health metrics.
*Follow-up: When would you reach for TPL Dataflow instead?*

**Q7. `Lazy<T>` thread-safety modes — which do you pick?**
**A:** `ExecutionAndPublication` (the default) guarantees the factory runs exactly once, at the cost of a lock during initialisation — right when construction is expensive or has side effects. `PublicationOnly` lets several threads run the factory concurrently and publishes the first to finish, discarding the rest — fine when the factory is cheap and pure and you want no lock contention. `None` is unsynchronised and only valid for confirmed single-threaded use. It's the same trade-off as `GetOrAdd`'s factory, made explicit.
*Follow-up: With `PublicationOnly`, the discarded instances are `IDisposable`. What do you do?*

**Q8. When is `Parallel.ForEach` wrong?**
**A:** For I/O-bound work — it burns pool threads on waiting where `Task.WhenAll` over async operations consumes none. For very cheap per-item work, where partitioning and coordination cost more than the work. And for anything mutating shared state without synchronisation, which it makes trivially easy to get wrong. It's right for CPU-bound work over a large collection where each item's work is substantial. Also worth setting `MaxDegreeOfParallelism`, or a background batch will starve the pool of threads for the request path sharing the process.
*Follow-up: How does that interact with GC pauses on the request path?*

**Q9. How do you actually test concurrent code?**
**A:** Not with ordinary unit tests — they run one interleaving and prove almost nothing. Stress tests: run the operation from many threads for many iterations and assert on an *invariant*, like a counter equalling the number of increments, rather than a single outcome. Add `Thread.Yield` or deliberate delays at suspected windows to widen the race. Run under sustained load in a soak test so pool behaviour emerges. And treat any intermittently failing test as a real defect rather than flakiness, because in concurrent code it almost always is one.
*Follow-up: A stress test fails once in 10,000 runs. How do you get from that to a root cause?*

**Q10. What's your position on writing lock-free data structures in application code?**
**A:** Use `Interlocked` for single-variable atomics freely — simple, well-understood, correct. Beyond that, hand-written lock-free structures are a specialist activity: extremely hard to reason about, nearly impossible to test exhaustively, and their bugs are the worst kind — rare, non-deterministic, and showing up as corrupted data rather than a crash. Use the BCL's concurrent collections, written and validated by people who do this professionally. A proposal to hand-roll one needs an exceptional measured justification plus a plan for who verifies it in five years.
*Follow-up: A team has a custom lock-free ring buffer benchmarked 3x faster. How do you evaluate it?*

---

## 4. Expert / Architect (10 Q&A)

**Q1. You're moving the fleet from x64 to ARM64 instances. What concurrency risk does that introduce?**
**A:** ARM64 has a weaker memory model than x64 — it permits reorderings that x64's hardware effectively prevents — so latent missing-barrier bugs that have been masked for years can start manifesting. Code with data races that "has always worked" is genuinely at risk, and the failures will be rare, non-deterministic and hard to attribute to the migration. I'd treat it as a real workstream: audit shared mutable statics and any lock-free code, add barriers or locks wherever the reasoning isn't airtight, run extended stress tests on ARM hardware specifically, and canary with elevated monitoring rather than treating it as a like-for-like instance swap.
*Follow-up: A data race has no syntactic signature. How would you find candidates to audit?*

**Q2. How do you decide between shared mutable state with locking, immutable snapshots, and partitioning?**
**A:** Partitioning first wherever the domain allows it, because state only one thread touches needs no synchronisation at all and scales linearly — sharding work by key is the highest-leverage move available. Immutable snapshots next for read-mostly data: lock-free reads, simple model, allocation on update. Locking last, and then with the smallest possible critical section. That order matters because locks don't scale — contention grows superlinearly with thread count, so a design whose correctness depends on a hot lock has a throughput ceiling no hardware will lift.
*Follow-up: The domain resists partitioning because of a global invariant. How do you attack that?*

**Q3. How would you set concurrency standards across an organisation?**
**A:** Encode them rather than publish them. Analyzers banning `lock(this)`, `lock(typeof)` and locking on strings. A shared library providing the sanctioned primitives — bounded channels, async locks, rate limiters — so nobody hand-rolls them. Templates that start with the right patterns. Then a small set of firm rules with reasons attached: private lock objects, no locks held across awaits or I/O, no shared mutable statics without an explicit review, immutable by default for anything shared. I'd also require concurrency-relevant types to state their thread-safety contract in a comment, because an unstated contract is one future maintainers will violate.
*Follow-up: How would you enforce "no lock held across an await" mechanically?*

**Q4. How does concurrency design interact with the GC and with latency budgets?**
**A:** Several ways people miss. The GC suspends all managed threads at safe points, so a thread in a tight loop without one delays every collection and therefore every thread. Per-thread allocation in parallel work multiplies gen0 pressure, so a parallel loop can trade CPU gains for collection pauses on the request path sharing the process. Thread stacks are 1 MB reserved each, so an exploded thread count is a memory problem before it's a scheduling one. And lock contention shows up as *latency*, not CPU — which is why a service can be slow at low utilisation. You have to reason about concurrency and memory together.
*Follow-up: A parallel batch job improved throughput and doubled P99 on the request path. What happened?*

**Q5. Design a high-throughput component that must maintain a global invariant.**
**A:** First test whether the invariant is genuinely global — most aren't, and a per-key or per-partition invariant permits sharding, which is the design that actually scales. Where it truly is global, the options are a single-writer design where one thread owns the state and others submit work through a queue (removing synchronisation from the hot path entirely), an `Interlocked` atomic if the invariant is a single value, or an approximate value with periodic reconciliation. I'd push hard on the business meaning first, because "must be exact and immediately visible" is usually assumed rather than required, and it's the constraint that forces the expensive design.
*Follow-up: The business confirms exact and immediate. What do you build?*

**Q6. You've inherited a codebase full of shared mutable statics. How do you approach it?**
**A:** Inventory and classify first: immutable (harmless), effectively-immutable-after-startup (low risk, worth confirming), and genuinely mutable at runtime (the real problem). Attack the third group by risk — those on request paths, those carrying per-request or per-tenant data (which are isolation bugs, not just races), and those whose corruption would be silent. Convert them to injected scoped services or immutable snapshots rather than adding locks, because adding locks preserves the coupling and adds contention. Add an analyzer to stop new ones while the burn-down runs.
*Follow-up: One static is a cache everything depends on and can't be removed quickly. What's the interim?*

**Q7. What would make you choose an actor or single-threaded model over shared memory?**
**A:** When the domain partitions naturally per entity and the alternative is hand-rolling locks around each entity's state — an actor model turns synchronisation into message ordering, which is far easier to reason about and test. Also when the state machine per entity matters more than raw throughput. The costs are real: a model the team must learn, harder debugging, a runtime dependency maintained for the system's life. My default is `Channel`-based single-writer components, which give most of the benefit with no framework, and I'd reserve a full actor runtime for domains where per-entity state and supervision genuinely are the core problem.
*Follow-up: You inherit a hand-rolled actor abstraction nobody understands. Do you migrate it?*

**Q8. How do you make concurrency bugs findable before production?**
**A:** Accept that ordinary tests won't find them and build the layers that will: stress tests asserting invariants under parallel execution, soak tests long enough for pool and contention behaviour to emerge, fault and latency injection at dependency boundaries, and — where it matters most — running those on the actual target hardware, because the memory model differs. Then in production, the observability that makes contention visible: lock contention counters, thread-pool queue depth, context-switch rates. The organisational piece is treating an intermittent failure as a defect rather than as flakiness to be retried away, which is the single most common way these bugs get shipped.
*Follow-up: A test is quarantined as flaky. How do you decide whether it's a real race?*

**Q9. How do you weigh a lock-free or highly-optimised concurrent design against maintainability?**
**A:** By who pays and for how long. The author pays once; everyone who maintains it pays forever, and in concurrent code the maintenance cost is not just comprehension — it's the risk that a well-intentioned change silently breaks an invariant nobody documented. So the bar rises with the subtlety of the technique: `Interlocked` needs no justification, a custom lock-free structure needs a measured problem, containment behind a small interface, adversarial tests, and a named owner. And I'd want the simpler version kept and benchmarked alongside, so the decision can be revisited when the hardware or the workload changes.
*Follow-up: Two years on, the owner has left and the benchmark no longer runs. What should have been in place?*

**Q10. What separates an excellent answer from an adequate one on a concurrency design question?**
**A:** An adequate answer puts a lock in the right place. An excellent one first asks whether the state needs to be shared at all, and reaches for partitioning or immutability before synchronisation; states the thread-safety contract explicitly rather than leaving it implicit; spots which operations are compound and therefore racy despite atomic parts; names the specific failure mode being prevented rather than saying "thread safety"; considers the throughput consequence of contention, not just correctness; and says how the design would be verified, knowing ordinary tests won't find the bug. The distinguishing quality is treating correctness under *arbitrary interleaving* as the requirement, rather than reasoning about the interleaving they happened to imagine.
*Follow-up: Given that, what's the first question you'd ask about any shared field you find in a code review?*

---
