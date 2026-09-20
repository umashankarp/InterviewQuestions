# Performance Engineering — Cram Sheet

> Tier 2 · Source: `29-Performance-Engineering/` (4 modules, 2,916 lines) · Read: 12 min

---

## 1. Profiling & Bottleneck Diagnosis

- **Sampling profiler** (periodic stack capture) — low overhead, safe in production, misses short-lived work. **Instrumenting profiler** (injected timers) — exact call counts, high overhead, distorts what it measures.
- **The observer effect is real:** instrumentation changes the thing measured. Always validate a finding with a second method, and treat a single run as a sample, not a fact (report distributions, not one number).
- **CLR cost centres a profiler must distinguish:** your code · JIT · GC · lock contention · thread-pool queueing · native/syscall · network wait. "High CPU" means nothing until attributed to one of these.
- **Allocation rate, not heap size, is the first number to check.** A small heap with a huge allocation rate causes constant Gen0 collections; a large stable heap may be fine. `dotnet-counters` → `alloc-rate`, `gen-0-gc-count`, `% time in GC`.
- **Thread-pool starvation signature:** high queue length, **low CPU**, rising latency, and the pool growing ~1 thread/sec. Cause is almost always **sync-over-async** (`.Result`/`.Wait()`) or a blocking call on a pool thread.
- **Lock convoying** — the hidden cost of contention: threads queue on a lock, each acquisition forces a context switch, and throughput collapses **faster than contention alone predicts**. Symptom: high context-switch rate with modest CPU.

**Toolchain:** `dotnet-counters` (live) · `dotnet-trace` (timeline) · `dotnet-gcdump` (heap diff) · `dotnet-dump` + SOS (post-mortem) · PerfView · **BenchmarkDotNet** (micro).

---

## 2. Load Testing & Capacity

- **Open-loop vs closed-loop, and why it changes the answer:**
  - **Closed-loop** — N virtual users, each waits for a response before sending the next. **Backpressure is built in**, so the system can never be overloaded and your measured latency is optimistic.
  - **Open-loop** — requests arrive at a fixed rate regardless of responses. Models real traffic. **This is the one that finds the cliff.**
- **Coordinated omission — the silent measurement bug.** If the load generator waits for a slow response before issuing the next request, it *fails to issue* the requests that would have been slowest — so the recorded p99 is dramatically better than reality. Fix: use a tool that corrects for it (wrk2, Gatling's open model, JMeter with a throughput shaper) and measure latency **from intended send time**, not actual send time.
- **Little's Law: `L = λ × W`** (concurrency = arrival rate × latency). Uses: size thread/connection pools, predict queue depth, and prove that **reducing latency reduces required concurrency**.
- **JIT warm-up invalidates naive .NET benchmarks** — Tier 0 code runs first. BenchmarkDotNet handles warm-up, multiple iterations and statistics; a `Stopwatch` in a loop does not.
- **The non-linear cliff:** throughput rises, then collapses rather than plateauing. Causes: queueing past a saturated resource, thread-pool exhaustion, GC death spiral, connection-pool exhaustion, **retry amplification**, or a metastable state where retries *are* the load.
- **Tie load testing to progressive delivery** — a canary with automated abort is a continuous load test against real traffic.

---

## 3. Caching & Data Access

- **First: know where the latency actually goes.** Typical web request: network → TLS → middleware → **database round trips (usually dominant)** → serialisation. Measure before caching — caching a fast query to avoid fixing a slow one is a permanent liability.
- **Population strategies:** cache-aside (lazy) · read-through · write-through · write-behind · refresh-ahead. (See [[14-System-Design-Core]] §5 for the table.)
- **Stampede, mechanically:** a hot key expires; every concurrent request misses simultaneously and hits the database at once. Fixes: **single-flight/request coalescing** (one request rebuilds, others wait), **probabilistic early expiry**, a short distributed lock, or never expiring hot keys.
- **Connection pooling — what actually gets reused** is the TCP connection *and* the authenticated session, which is why the pool is keyed on the **exact connection string**. A string that varies per request (e.g. an appended application name) silently creates a pool per variant and exhausts the server. Default ADO.NET pool size is 100.
- **Offset vs keyset pagination — the query-plan difference:** `OFFSET n` still **reads and discards** n rows, so page 10,000 is linearly slower. **Keyset/seek** (`WHERE (sort, id) > (@last, @lastId)`) is constant-time and index-friendly. The trade-off is you lose random page access.
- **Denormalisation vs caching — two different answers to "this read is too slow":** a cache is a *second copy with a staleness window and its own failure modes*; denormalisation is a *permanent schema change with a write-time consistency cost*. Denormalise when the read pattern is permanent and the write rate is low; cache when the access is skewed and staleness is tolerable.
- **Read-replica lag is a consistency boundary, not a latency detail** — route reads deliberately and handle read-your-own-writes explicitly.

---

## 4. Latency Budgets & Regression Prevention

- **Latency budget = the latency analogue of an error budget.** Total user-facing budget (e.g. 300 ms p99) is decomposed across the critical path: gateway 10 ms + auth 20 ms + service 100 ms + DB 80 ms + serialisation 20 ms + headroom.
- **Budget ownership is recursive — the caller owns the callee's budget.** If you call a service, its latency is inside *your* budget, so you are the one who must negotiate or defend it. This framing is what stops "not my service" arguments.
- **Only the critical path matters** — work that is genuinely off the critical path (fire-and-forget analytics) has no budget.
- **Micro vs macro benchmarking:** micro (BenchmarkDotNet) validates a specific change; macro (load test / production SLI) validates the budget. **A micro-benchmark win that doesn't move the macro number is not a win.**
- **Gradual drift is the hard detection problem** — no single release regresses more than 2%, but twenty releases regress 40%. Single-change comparison cannot see it. Fix: **track the trend over a long window** against an absolute budget, not just release-over-release deltas.
- **Performance debt as a tracked liability** — record it like any other debt, with the business cost attached, or it is never prioritised.

---

## Top traps

1. Optimising without profiling first.
2. Closed-loop load testing → optimistic latency, cliff never found.
3. **Coordinated omission** → p99 that is fiction.
4. A `Stopwatch` micro-benchmark with no JIT warm-up.
5. Checking heap size instead of **allocation rate**.
6. Diagnosing thread-pool starvation as "we need more CPU."
7. Caching over a query that just needs an index.
8. `OFFSET` for deep pagination.
9. A per-request-varying connection string fragmenting the pool.
10. Release-over-release comparison missing gradual drift.

---

## Interview Q&A — Lead / Principal

### Q1 · The load test that lied *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"We load-tested at 2× expected traffic and p99 was 200ms. Production fell over at 1.2×. How?"*

**Answer.** Almost certainly **coordinated omission** plus closed-loop generation. A closed-loop tool runs N virtual users, each waiting for a response before sending the next request — so backpressure is built into the test and the system **cannot be overloaded**. Worse, when a response is slow the generator doesn't issue the requests it would otherwise have sent, so the requests that would have experienced the worst latency are never made. Your p99 is computed over a sample that excludes the bad cases. It's not a tuning error; the number was fiction.

The fix is **open-loop generation** at a fixed arrival rate regardless of responses — wrk2, Gatling's open model, JMeter with a throughput shaper — and measuring latency from the **intended** send time, not the actual one. That's what finds the cliff.

The second half of the answer is that throughput doesn't plateau, it **collapses**: past saturation, queues grow, latency rises, clients retry, and the retries become the load — a metastable state where the system stays down after the trigger passes. So I'd also want the test to include realistic client retry behaviour, because a load test with no retries misses the amplification entirely. And I'd test to failure deliberately to find where the cliff is, rather than testing to 2× and declaring success.

**Why it lands.** Names coordinated omission precisely, explains why the number was wrong rather than merely optimistic, and adds retry amplification and test-to-failure.
**✗ Weak answer.** "We didn't test enough load."
**↳ Follow-ups.** What tool would you use? How do you model realistic retry behaviour?

---

### Q2 · Performance regressed and nobody noticed *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"p99 has gone from 180ms to 400ms over a year. No single release caused it. How do you stop this?"*

**Answer.** This is **gradual drift**, and it's invisible to the control most teams have — release-over-release comparison. No single release regressed more than 2%, so nothing ever failed a gate, but twenty releases compounded to 120%. The detection gap is structural: you're measuring deltas when you should be measuring against an **absolute budget**.

So: define a **latency budget** decomposed across the critical path — gateway 10ms, auth 20ms, service 100ms, database 80ms, plus headroom — and track each component against its allocation over a long window, not against last week. The ownership rule that makes it work is that **the caller owns the callee's budget**: if I call your service, your latency is inside my budget, so I'm the one who has to negotiate it. That stops the "not my service" deadlock these conversations usually reach.

Alongside: continuous profiling in production so attribution is possible after the fact, and **performance debt tracked as a visible liability with a business cost**, because otherwise it never competes with features. And I'd be honest that some of that 220ms is legitimate — features were added — so the goal isn't the old number, it's an agreed budget with someone accountable for each slice.

**Why it lands.** Names the detection gap, absolute-budget over delta, the caller-owns-callee rule, and concedes some regression is legitimate.
**✗ Weak answer.** "Add performance tests to CI" — micro-benchmarks don't catch system-level drift.
**↳ Follow-ups.** How do you allocate the budget initially? What if a team refuses their slice?

---

### Quick-fire (30 seconds each)

- **"The API got slow — walk me through it."** → Start at the SLI to confirm it's real and scoped, then attribute the time to a layer before touching anything: `dotnet-counters` for allocation rate, GC time and thread-pool queue length, and a trace to see whether it's our code, GC, lock contention, or waiting on a dependency. Low CPU with a growing queue means thread-pool starvation, usually sync-over-async. High allocation rate with frequent Gen0 means an allocation problem, not a heap-size problem. Only once I know the layer do I fix the layer.
- **"What's coordinated omission?"** → A measurement bug where the load generator waits for a slow response before sending the next request, so the requests that would have hit the worst latency are never issued. Your p99 then looks fine while real users see seconds. It happens in every closed-loop tool by default. The fix is open-loop generation and measuring latency from the *intended* send time, which is what wrk2 and Gatling's open model do.
- **"How do you stop performance regressing over time?"** → An explicit latency budget decomposed across the critical path, with the rule that the caller owns the callee's budget so there's always an owner. Then continuous measurement against the absolute budget rather than release-over-release, because gradual drift — twenty releases at 2% each — is invisible to single-change comparison. And performance debt tracked as a real liability with a business cost, or it never gets scheduled.

---

**Go deeper:** `29-Performance-Engineering/01`–`04` · **Related:** [[01-CSharp]], [[04-SQL-Server]], [[27-Observability]], [[14-System-Design-Core]]
