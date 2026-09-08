# 11. Performance Engineering — 31 Questions (Answered)

> **Method:** definitions and mechanics are taken from **Microsoft Learn** (.NET GC fundamentals, EF Core performance, ADO.NET connection pooling, ASP.NET Core performance best practices), the **Apache Kafka documentation**, the **AWS Well-Architected Performance Efficiency pillar** and the **AWS Builders' Library**, plus the original queueing-theory result for Little's Law. Then the architect-level analysis: what to measure, what the number actually means, and what to change. Links in **References**.

---

## Q1. How do you approach performance engineering?

**The discipline, in one sentence:** *measure, find the bottleneck, fix the bottleneck, measure again* — and never optimise anything you have not measured, because intuition about performance is wrong far more often than it is right.

**The method I actually follow:**

**1. Define the target first.** "Fast" is not a requirement. A requirement is: *"p99 latency < 200 ms at 2,000 RPS, with error rate < 0.1 %, at 60 % CPU headroom."* Without a number you cannot know when to stop, and you will optimise the wrong thing. Derive it from the business: what does the user experience, what does the SLA say, what does the downstream system need?

**2. Measure in production, not just in a lab.** Real traffic has cache misses, cold starts, noisy neighbours, skewed data and pathological inputs that a synthetic test never produces. Instrument with **percentile latency histograms**, throughput, error rate, saturation and queue depth — not averages (Q3).

**3. Find the bottleneck — the one resource that limits everything.** Every system has exactly one at a time: CPU, memory, disk I/O, network, a lock, a connection pool, a downstream service, or a single-threaded component. **Optimising anything other than the current bottleneck changes nothing.** This is the point most engineers skip and it is the reason most "optimisation" work has no measurable effect.

**4. Use the USE and RED methods to structure the search.**
- **USE** (resources): for every resource, check **U**tilisation, **S**aturation, **E**rrors.
- **RED** (services): for every service, check **R**ate, **E**rrors, **D**uration.
Together they cover the whole stack and stop you guessing.

**5. Profile before changing code.** A CPU profile, an allocation profile, a query plan, a flame graph, a distributed trace. In .NET: `dotnet-trace`, `dotnet-counters`, PerfView, Visual Studio Profiler, and **BenchmarkDotNet** for micro-level comparisons (never `Stopwatch` in a loop — JIT warm-up, tiered compilation and GC timing will lie to you).

**6. Fix in order of leverage, not in order of interest.** The usual ranking, and it is remarkably stable across systems:

| Rank | Change | Typical gain |
|---|---|---|
| 1 | **Do less work** — remove the call, cache the result, batch the request | 10–1000× |
| 2 | **Fix the algorithm / query** — an index, an N+1, an O(n²) loop | 10–100× |
| 3 | **Parallelise / go async properly** | 2–10× |
| 4 | **Tune configuration** — pool sizes, batch sizes, timeouts, GC mode | 1.2–3× |
| 5 | **Micro-optimise code** — spans, pooling, struct tuning | 1.05–1.5× |

Most teams start at 5 and never reach 1.

**7. Re-measure and guard the gain.** Add the benchmark or load test to CI so the improvement does not silently regress. Performance without a regression gate decays.

**8. Know when to stop.** Performance work has diminishing returns and real costs — complexity, readability, maintainability. Stop when the target is met with headroom. "Fast enough, with margin, and simple" beats "as fast as possible".

**The framing for a panel:** performance engineering is not a phase before go-live; it is a **continuous property** maintained by targets (SLOs), instrumentation, load testing in CI, and capacity review — the same way security is. In a payments platform, add: performance is a *correctness* concern, because a timeout on a settlement call is not a slow success, it is an ambiguous outcome you now have to reconcile.

---

## Q2. How do you diagnose a slow API?

Work **top-down through the request path**, halving the search space at each step. The goal is to locate *where the time goes* before forming any theory about *why*.

**Step 1 — Characterise the problem precisely.** These four questions eliminate most wrong turns:

| Question | What the answer tells you |
|---|---|
| **All requests or some?** | All → systemic (dependency, resource, config). Some → data-dependent (a hot key, a large tenant, a missing index for one query shape) |
| **Always or intermittently?** | Intermittent → GC pauses, lock contention, connection-pool waits, noisy neighbour, a cold cache |
| **Since when?** | Correlate with a deploy, a config change, a data-volume threshold, a traffic increase |
| **p50 or only p99?** | p50 up → everything is slower. **Only p99 up → queueing, contention, GC, or a small subset of pathological requests** |

**Step 2 — Read the distributed trace.** This is the single highest-value tool and it should be the first thing you look at, not the last. A trace decomposes total latency into spans: which service, which database call, which external API. If you cannot answer "where did the 800 ms go?" in under a minute, your observability is the first thing to fix.

**Step 3 — Attribute the time.** Latency is only ever one of these:

```
Total = queue/wait time + CPU time + I/O wait + downstream time + serialisation + network
```
- **Downstream dominates** → the problem is not your service; check the dependency, and check whether you are calling it N times when you could call it once.
- **I/O wait dominates** → database. Go to Q9.
- **CPU dominates** → profile it; usually serialisation, regex, crypto, LINQ over large in-memory collections, or logging.
- **Queue/wait dominates** → saturation. Thread-pool starvation, connection-pool exhaustion, or a lock. This is the case people misdiagnose most often, because CPU looks *low*.

**Step 4 — .NET-specific checks**, in the order that finds the problem fastest:

```bash
dotnet-counters monitor -p 1 System.Runtime Microsoft.AspNetCore.Hosting
```
| Counter | What a bad value means |
|---|---|
| **`ThreadPool Queue Length` rising, CPU low** | **Thread-pool starvation** — sync-over-async (`.Result`, `.Wait()`, `.GetAwaiter().GetResult()`) somewhere in the path |
| `% Time in GC` > 10 %, high Gen 2 count | Allocation pressure / LOH churn (Q24, Q25) |
| `Exception Count` high | Exceptions used as control flow — they are expensive |
| `Current Requests` climbing | Requests arriving faster than they complete — saturation |
| `Monitor Lock Contention Count` | Lock contention |

**Step 5 — Reproduce and profile.** `dotnet-trace collect` for a CPU profile, `dotnet-stack report` if it is hung, `dotnet-gcdump` if memory is implicated. Then a flame graph.

**The most common real causes, ranked by how often they actually turn out to be it:**

1. **N+1 database queries** (Q11) — by a wide margin the most common.
2. **A missing or unusable index** (Q13).
3. **Synchronous blocking on async code** → thread-pool starvation.
4. **A slow downstream call with no timeout**, holding a connection and a thread.
5. **Chatty service-to-service calls** — five sequential hops that could be one or run in parallel.
6. **No caching of something expensive and rarely changing.**
7. **Over-fetching** — selecting entire entities, or whole tables, to use two fields.
8. **Connection-pool exhaustion** (Q16).
9. **GC pressure** from large allocations per request.
10. **Serialisation of large payloads.**

---

## Q3. Why is p95/p99 more useful than average latency?

**Because the average hides exactly the users you are failing, and because averages do not compose.**

**1. The average is not a user experience.** If 99 requests take 10 ms and one takes 5,000 ms, the mean is ~60 ms — a number *no request actually experienced*. It looks fine. Meanwhile one user in a hundred waited five seconds. Percentiles describe real requests; the mean describes an imaginary one.

**2. Tail latency is where the failures live.** Timeouts, retries, abandoned checkouts, circuit breakers tripping — these are all tail events. The p99 is the number that correlates with error rate and with user complaints; the mean never moves enough to notice.

**3. Tail latency amplifies across a distributed call graph.** This is the argument that wins the question, and it comes from Dean & Barroso's *The Tail at Scale*: if a request fans out to **10** services each with a p99 of 100 ms, the probability that *at least one* is slow is `1 − 0.99¹⁰ ≈ 9.6 %`. So a **1-in-100 slow event per service becomes 1-in-10 for the user.** In a microservices platform, one service's p99 is everyone's p90.

**4. Averages hide bimodality.** Cache hit 5 ms / cache miss 500 ms averages to something meaningless. Percentiles show the two populations.

**What I actually track:**

| Metric | Use |
|---|---|
| **p50** | The typical experience; the baseline |
| **p95 / p99** | The SLO target; where users hurt |
| **p99.9** | Where systemic problems appear first — GC pauses, failovers, lock convoys |
| **max** | Timeout tuning and worst-case reasoning |
| **Histogram / heatmap** | Shows bimodality that any single percentile hides |

**Two technical cautions that mark a serious answer:**

- **Percentiles do not average.** You cannot take the p99 of ten pods and average them to get the fleet p99 — it is arithmetically meaningless. Aggregate the **histogram buckets** (this is why Prometheus `histogram_quantile` over a summed bucket rate is correct and averaging pre-computed quantiles is not).
- **Coordinated omission** understates the tail badly: if a load generator waits for a slow response before sending the next request, it never records the requests it *failed to send* during the stall. Use a tool that corrects for it (HdrHistogram-based, `wrk2`, or k6 with an open model) or your p99 is fiction.

**And define SLOs on percentiles, not averages:** *"99 % of payment authorisations complete within 300 ms over a 30-day window"* is a statement you can alert on with a burn rate, hold a team to, and put in front of a regulator. An average cannot do any of that.

---

## Q4. What is throughput?

**Throughput is the rate of work completed per unit of time** — requests per second, transactions per second, messages per second, bytes per second. It is a **rate**, and it is the counterpart to latency, which is a **duration**.

**The distinction that matters:**

| | **Latency** | **Throughput** |
|---|---|---|
| Measures | Time for **one** unit of work | **Units of work per second** |
| Improved by | Doing less, doing it faster, removing waits | Parallelism, batching, more capacity |
| Analogy | How long one car takes to cross the bridge | How many cars cross per hour |

**They are related but not the same, and optimising one can harm the other.** Batching increases throughput and *increases* latency (you wait to fill the batch). Adding parallelism increases throughput until contention makes per-request latency worse. A queue absorbs bursts (protecting throughput) at the cost of latency for queued items. Any performance conversation that does not name which one is being optimised is confused.

**The relationship, formally:** by Little's Law (Q6), `Throughput = Concurrency / Latency`. So for a fixed concurrency limit, **latency and throughput are inversely proportional** — halving latency doubles throughput without adding a single resource. That is why latency work is usually the cheapest capacity work available, and it is the sentence to say in an interview.

**Measuring it honestly:**
- Measure **completed** work, not *offered* load. A system "handling 10,000 RPS" while erroring on half of them is handling 5,000.
- Measure at a **stated latency and error budget**. "Maximum throughput" at a 30-second p99 is a useless number.
- Watch for the **knee**: throughput rises with load, plateaus at saturation, and then often *falls* as contention, retries and queueing take over. The useful capacity figure is just below the knee, not at the peak.

---

## Q5. What is concurrency?

**Concurrency is the number of units of work in progress at the same time.** Note "in progress", not "executing" — a request waiting on a database is concurrent but not running.

**The distinction that gets asked immediately — concurrency vs parallelism:**

| | **Concurrency** | **Parallelism** |
|---|---|---|
| Definition | **Dealing with** many things at once | **Doing** many things at once |
| Requires | Nothing special — one core can be highly concurrent | **Multiple cores** |
| .NET mechanism | `async`/`await`, the thread pool, I/O completion ports | `Parallel.For`, PLINQ, multiple threads on multiple cores |
| Bound by | I/O waits, connection limits, memory | CPU cores |
| Rob Pike's framing | *"Concurrency is about structure"* | *"Parallelism is about execution"* |

**Why this matters concretely for .NET services:** `async`/`await` gives you **concurrency, not parallelism, and not speed**. An `await` on a database call releases the thread back to the pool so it can serve another request; the individual request is not faster — often marginally slower — but the server sustains vastly more concurrent requests with the same threads. That is why the correct claim is *"async improves scalability under concurrency"*, never *"async makes it faster"* (Module 3).

**The failure mode to name:** **unbounded concurrency**. Every concurrent operation holds resources — a thread, a connection, memory, a socket. Ten thousand concurrent requests each holding a database connection exhausts a 100-connection pool instantly, and the symptom is timeouts with **low CPU** — which reads as "the system is idle and broken" until you look at the pool. Bound it deliberately: `SemaphoreSlim`, `Parallel.ForEachAsync` with `MaxDegreeOfParallelism`, `Channel<T>` with a bounded capacity, ASP.NET Core concurrency-limiter middleware, or a queue with a fixed consumer count.

**The counter-intuitive rule:** past the optimal concurrency, **more concurrency makes everything worse** — context switching, cache thrashing, lock contention and queueing add cost while completing no extra work. The Universal Scalability Law formalises this: throughput rises, plateaus, then **declines**. Finding and enforcing the optimal concurrency limit is often a bigger win than adding hardware.

---

## Q6. Explain Little's Law.

**Little's Law (J.D.C. Little, 1961)** is the fundamental relationship in queueing theory:

```
L = λ × W
```
> **L** = average number of items in the system (concurrency / queue length)
> **λ** = average arrival rate (throughput, when stable)
> **W** = average time an item spends in the system (latency)

Rearranged for the form engineers actually use:

```
Concurrency = Throughput × Latency        →     Throughput = Concurrency / Latency
```

**Why it is powerful:** it holds for **any stable system**, regardless of arrival distribution, service-time distribution, or scheduling discipline. No assumptions, no model fitting. If you know two of the three, you know the third — and if a stated set of numbers violates it, someone is wrong.

**Worked examples of the kind an interview expects:**

**(a) How much concurrency do I need?**
Target 2,000 RPS at 100 ms average latency:
`L = 2,000 × 0.1 = 200 concurrent requests in flight.`
So the system must sustain 200 simultaneous in-progress requests — which immediately tells you the connection pool, thread pool and downstream limits you need. A 100-connection database pool cannot support this if every request holds a connection for its whole duration.

**(b) What throughput can this pool give me?**
A pool of 100 database connections, each query taking 20 ms:
`λ = 100 / 0.02 = 5,000 queries/second` — the hard ceiling. No amount of extra application instances raises it.

**(c) Sizing a worker pool.**
20 workers, each message taking 200 ms: `λ = 20 / 0.2 = 100 msg/s`. To reach 500 msg/s: either 100 workers, or cut processing to 40 ms, or some combination. This is exactly how you size Kafka/SQS consumer fleets.

**(d) Diagnosing a claim.** "We do 10,000 RPS with 50 ms latency from a 50-connection pool." Little's Law: `10,000 × 0.05 = 500` concurrent — 500 > 50. Either the connections aren't held for the whole request, or one of the numbers is wrong. The law turns hand-waving into arithmetic.

**Two cautions:**
- It applies to a **stable** system — arrival rate must equal completion rate over the measurement window. During overload, the queue grows without bound and latency diverges; the law still holds instantaneously but the "average" is not meaningful.
- It says nothing about **variance**. Two systems with identical L, λ and W can have wildly different p99s. Little's Law sizes capacity; percentiles describe experience. You need both.

---

## Q7. How do you perform capacity planning?

A quantitative process, not a guess. The output is a specific number of instances, a specific database size, and a stated headroom — with the arithmetic shown.

**1. Establish the demand model.**
- Current and projected **peak** RPS (not average — plan for peak), the peak-to-average ratio, and the shape of the day.
- **Business events**: payroll day, month-end settlement, market open, Black Friday, a marketing campaign. In a payments platform these are the real capacity drivers and they are predictable.
- Growth rate, and the planning horizon (typically 12 months).

**2. Measure the unit of capacity.** Load-test a single instance to find its **knee** — the throughput just before latency degrades:
> *One instance sustains 250 RPS at p99 = 180 ms, at 65 % CPU.*

**3. Apply Little's Law and the headroom rule.**
```
Peak demand              = 2,000 RPS
Per-instance capacity    =   250 RPS
Minimum instances        = 2,000 / 250 = 8
Target utilisation 60 %  → 8 / 0.6      = 14 instances
N+1 for AZ loss (of 3)   → 14 × 1.5     = 21 instances (each AZ can absorb a lost AZ)
```
**Why 60 %, not 90 %:** queueing theory — as utilisation → 100 %, latency → ∞ (for M/M/1, `W = 1/(μ−λ)`). Above ~70 % utilisation, latency rises steeply for small increases in load. You are buying **latency stability**, not idle hardware.

**4. Plan every tier, not just compute.** The bottleneck moves. Check: database connections and IOPS, cache memory and eviction rate, Kafka partitions (they bound consumer parallelism), NAT/network throughput, downstream **third-party rate limits** (frequently the real ceiling in fintech — the payment provider caps you at 100 TPS regardless of your fleet), and service quotas.

**5. Validate by testing at target, not by extrapolating.** Linear extrapolation is where capacity plans go wrong: shared resources (database, cache, locks) mean 10 instances rarely deliver 10× one instance. Load test at the projected peak.

**6. Build the elasticity plan.** What autoscales, how fast, on which signal, and what the `maxReplicas`/quota ceiling is. Then check the **scale-up time** against the **spike ramp**: if traffic goes 3× in 60 seconds and nodes take 3 minutes, autoscaling will not save you — you need pre-provisioned capacity ahead of a known event (scheduled scaling before market open) or a queue to absorb the burst.

**7. Review continuously.** Capacity is a living number: track actual peak vs planned, utilisation trend, and cost per transaction. Re-plan quarterly and before every known event.

**The framing:** capacity planning is a **risk and cost trade-off**, not a technical exercise. Over-provisioning wastes money; under-provisioning costs revenue and trust. State the assumption, show the arithmetic, name the headroom, and identify which tier saturates first — that last part is what a Principal-level answer contains.

---

## Q8. Load vs stress vs spike vs soak testing?

Four different questions, four different tests. Naming the *question* each answers is the crisp way to answer.

| Test | Question it answers | Profile | What you look for |
|---|---|---|---|
| **Load (performance) test** | *"Does it meet the SLO at expected peak?"* | Ramp to expected peak, hold 15–60 min | p95/p99 latency, error rate, resource utilisation at target |
| **Stress test** | *"Where does it break, and how?"* | Ramp **past** peak until failure | The **knee**, the failure mode, whether it degrades gracefully or collapses |
| **Spike test** | *"Can it survive a sudden surge?"* | Instant 5–10× jump, then drop | Autoscaling reaction time, queue absorption, error rate during the spike, **and recovery afterwards** |
| **Soak (endurance) test** | *"Does it survive 24 hours?"* | Moderate load for 8–72 hours | **Memory leaks**, connection leaks, file-handle leaks, log-disk growth, cache unbounded growth, gradual latency creep |

**Two more worth naming:**
- **Volume test** — behaviour with a production-sized *dataset*, not production traffic. A query that is fast on 10,000 rows and catastrophic on 50 million is invisible to every other test. This is where missing indexes surface.
- **Breakpoint/capacity test** — a controlled ramp specifically to find the maximum sustainable throughput for the capacity plan.

**What each one actually catches, in practice:**
- **Load** catches whether you met the requirement. It is the pass/fail gate.
- **Stress** catches the *failure mode*, which matters more than the number: does the service shed load cleanly (429s, circuit breakers) or does it cascade — retries amplifying, queues growing, everything timing out? A system that returns 429 at 3× capacity is far better than one that returns 500s at 1.2×.
- **Spike** catches the gap between autoscaling speed and demand ramp, and it catches **retry storms**.
- **Soak** catches the bugs that only time reveals — and in .NET that is almost always a leak: a static collection that grows, an undisposed `HttpClient` handler, an `IMemoryCache` with no size limit, an event handler never unsubscribed.

**How I run them in practice:** a **smoke/load test in CI on every build** against a scaled-down environment, with a latency budget as a gate, so regressions are caught by the PR that causes them; **stress and spike** before major releases and before known events; **soak** weekly or before a release, in a production-like environment with production-shaped data. Test with **realistic data distribution** — uniform synthetic keys hide hot partitions and cache-miss behaviour, which is precisely what breaks in production.

**Tools:** **k6** (scriptable, CI-friendly, correct open-model load generation), **NBomber** (.NET-native), JMeter, Gatling, Locust, and **`wrk2`** where coordinated-omission-corrected latency matters. Note that AWS's Distributed Load Testing solution and Azure Load Testing exist for driving load at genuine scale from many sources.

---

## Q9. How do you identify database bottlenecks?

The database is the bottleneck more often than anything else, so this is worth a systematic answer rather than "check slow queries".

**Step 1 — Confirm it is the database.** From the application side, the trace shows time spent in database spans. From the .NET side, `dotnet-counters` on the ADO.NET provider shows active/pooled connections. If the app is waiting and the database is idle, the problem is the **pool**, not the database (Q16).

**Step 2 — Find the expensive queries.** Every engine has the same tool under a different name:

| Engine | Tool |
|---|---|
| **SQL Server** | Query Store, `sys.dm_exec_query_stats`, Extended Events, Database Engine Tuning Advisor |
| **PostgreSQL** | **`pg_stat_statements`** (total time, calls, mean, rows), `auto_explain`, `pg_stat_activity` |
| **AWS RDS/Aurora** | **Performance Insights** — the fastest path to "which SQL and which wait event dominates DB load" |
| **MongoDB** | Database Profiler, `explain()` |

**Rank by total time (`calls × mean`), not by mean.** A 5 ms query executed 2 million times is a far bigger problem than a 3-second report run twice a day — and it is the one an N+1 produces.

**Step 3 — Read the wait statistics.** This is the step that separates a real answer from a generic one: waits tell you *what the database is waiting on*, which names the bottleneck directly.

| Wait type (SQL Server / PostgreSQL) | Meaning |
|---|---|
| `PAGEIOLATCH_*` / `IO:DataFileRead` | **Disk reads** — missing index, insufficient memory, too much data scanned |
| `LCK_M_*` / `Lock:transactionid` | **Blocking** — long transactions, lock escalation, missing index causing range locks |
| `CXPACKET` / parallel workers | Parallelism skew — often a symptom, not a cause |
| `WRITELOG` / `WALWrite` | Transaction log / WAL write throughput — commit-heavy workload, slow storage |
| `RESOURCE_SEMAPHORE` | Memory grants exhausted — over-large sorts/hashes |
| `Client:ClientRead` | The **database is waiting on the application** — chatty client, or the app not consuming results fast enough |

**Step 4 — Check the usual structural causes, in order of frequency:**

1. **Missing or unusable index** (Q13) — the query plan shows a scan where a seek belongs.
2. **N+1 query pattern** (Q11) — huge call counts of a trivial query.
3. **Over-fetching** — `SELECT *`, entire entities, no pagination.
4. **Blocking/locking** — long-running transactions, transactions held open across an external call (unforgivable in a payment flow), lock escalation.
5. **Parameter sniffing / plan instability** (SQL Server) — the same query fast then suddenly slow after a recompile.
6. **Stale statistics** — the optimiser choosing badly because its row estimates are wrong.
7. **Connection pool exhaustion** (Q16) — application-side, presenting as database slowness.
8. **Write amplification from too many indexes** — every index must be maintained on write.
9. **Hot rows / hot partitions** — a sequence table, a single counter row, a `payments#2026-09-08` partition key.

**Step 5 — Check the infrastructure.** IOPS and throughput limits (an EBS gp3 volume at its provisioned IOPS ceiling looks exactly like a slow database), CPU, memory/buffer-cache hit ratio, replication lag if reads go to a replica, and instance-level connection limits.

**The architect-level point:** the fastest query is the one you never issue. Before tuning, ask whether the read can be cached, whether the data can be denormalised into a read model (CQRS), whether the work can be batched, or whether it belongs in the request path at all. Tuning a query that shouldn't exist is the second-best outcome.

---

## Q10. How do you optimize EF Core?

Following the **EF Core performance documentation** on Microsoft Learn, in the order the docs themselves prioritise.

**1. Use indexes properly.** The docs are explicit: *"The main deciding factor in whether a query runs fast or not is whether it will properly utilize indexes."* And the subtle part — a query can silently defeat an index:
```csharp
context.Posts.Where(p => p.Title.StartsWith("A"))  // uses an index (SQL Server)
context.Posts.Where(p => p.Title.EndsWith("A"))    // does NOT
```
Any function applied to the column (`ToLower()`, date arithmetic, `price / 2`) makes the predicate **non-SARGable**. The documented remedies are a computed persisted column with an index over it, or an expression index where the database supports one.

**2. Project only the properties you need.** Querying entities pulls every column. `Select` into an anonymous type or DTO and EF emits only the columns you asked for. This reduces I/O, network transfer, materialisation cost and memory — usually the largest single win after indexing.

**3. Limit the result-set size.** The docs warn that *"test databases frequently contain little data, so that everything works well while testing, but performance problems suddenly appear when the query starts running on real-world data."* Always `Take(n)`, and paginate. For paging, the docs recommend **keyset pagination** (`WHERE (Date, Id) < (@lastDate, @lastId) ORDER BY … LIMIT n`) over `Skip`/`Take`, because `OFFSET` makes the database count and discard every skipped row — page 10,000 is catastrophic.

**4. Avoid the N+1 problem — see Q11.** Eager-load with `Include`, or better, project.

**5. Avoid cartesian explosion.** Multiple `Include`s on collection navigations produce a JOIN that duplicates the principal's columns for every child row; with two collections it multiplies. The documented fix is **`AsSplitQuery()`**, which issues separate queries — noting the docs' caveat that the current implementation costs a round trip per query.

**6. Use no-tracking for read-only queries — see Q12.**

**7. Stream instead of buffering for large result sets.** `ToListAsync()` buffers everything into memory; `AsAsyncEnumerable()` with `await foreach` streams one row at a time with fixed memory. The docs also flag two cases where **EF buffers internally regardless**: when a retrying execution strategy is enabled, and for all but the last query of a split query.

**8. Use async everywhere.** *"In order for your application to be scalable, it's important to always use asynchronous APIs"* — and the docs' warning is worth quoting: *"Avoid mixing synchronous and asynchronous code in the same application — it's very easy to inadvertently trigger subtle thread-pool starvation issues."*

**9. Drop to SQL when EF cannot generate what you need** — `FromSql`, a user-defined/table-valued function, or a view. The docs are clear that this is a **last resort** because of the maintenance cost, but for a hot reporting query it is often the right call.

**10. Reduce round trips.** Batch writes (EF batches `SaveChanges` automatically — don't call it per entity in a loop), and use **`ExecuteUpdateAsync`/`ExecuteDeleteAsync`** for set-based operations instead of loading entities to modify them. Use **compiled queries** (`EF.CompileAsyncQuery`) for very hot query shapes to skip expression-tree translation, and **DbContext pooling** (`AddDbContextPool`) to avoid per-request context construction cost.

**11. Never use lazy loading in a service.** The docs: *"Because lazy loading makes it extremely easy to inadvertently trigger the N+1 problem, it is recommended to avoid it."*

**And the diagnostic habit that underpins all of it:** turn on EF's statement logging (or use `ToQueryString()`, MiniProfiler, or OpenTelemetry's EF instrumentation) and **look at the SQL your LINQ produces**. Almost every EF performance problem is obvious the moment you read the generated SQL, and invisible until you do.

---

## Q11. What is the N+1 query problem?

**Definition:** one query fetches N parent rows, then **N additional queries** fetch each parent's children — 1 + N round trips where 1 or 2 would do.

**The EF Core documentation's own example**, with lazy loading enabled:
```csharp
foreach (var blog in await context.Blogs.ToListAsync())   // 1 query: SELECT * FROM Blogs
    foreach (var post in blog.Posts)                      // N queries: one per blog
        Console.WriteLine($"{blog.Url}: {post.Title}");
```
The docs' logging output shows exactly this: one query for blogs, then `SELECT … FROM Post WHERE BlogId = @p` repeated per blog — *"this is sometimes called the N+1 problem, and it can cause very significant performance issues."*

**Why it is so damaging:** each query is individually fast — 1 ms — so nothing looks slow in isolation. But 500 parents means 501 round trips. At 1 ms network round-trip each, that is **500 ms of pure latency** doing almost no work, and it scales linearly with data volume, so it passes every test against a small dataset and collapses in production. It also consumes a connection for far longer, multiplying into pool pressure under concurrency.

**How to spot it:**
- The trace shows one endpoint issuing hundreds of database spans.
- `pg_stat_statements` / Query Store shows a trivial query with an enormous `calls` count.
- EF statement logging shows the same SQL repeating with different parameters.

**The fixes, in preference order:**

```csharp
// 1. BEST — project exactly what you need, one query, no over-fetching
var data = await context.Blogs
    .Select(b => new BlogDto(b.Url, b.Posts.Select(p => p.Title).ToList()))
    .ToListAsync();

// 2. Eager loading — one round trip, but fetches whole entities
var blogs = await context.Blogs.Include(b => b.Posts).ToListAsync();

// 3. Many collection Includes → cartesian explosion; split into separate queries
var blogs = await context.Blogs
    .Include(b => b.Posts).Include(b => b.Authors)
    .AsSplitQuery().ToListAsync();

// 4. Filtered include — eager, but only the children you want
var blogs = await context.Blogs
    .Include(b => b.Posts.OrderByDescending(p => p.Date).Take(5))
    .ToListAsync();
```
And **turn lazy loading off**, which removes the whole class of bug at the source.

**N+1 is not only an ORM problem** — this is the point that generalises the answer and is worth making. The same shape appears in:
- **REST APIs**: fetch a list of 100 orders, then call `GET /customers/{id}` 100 times. Fix with a batch endpoint (`?ids=…`), by embedding the data, or with a BFF that composes it once.
- **GraphQL**: the canonical case; fixed with **DataLoader** batching.
- **Microservices**: a service calling another once per item in a loop — the fix is a bulk call, or moving the data (event-carried state transfer) so the call disappears.
- **Caching**: N individual `GET`s to Redis instead of one `MGET`/pipeline.

**The general principle:** *chattiness is the enemy of distributed performance.* Whenever you see a loop containing an I/O call, you have found an N+1 — batch it, or restructure so it isn't needed.

---

## Q12. When should you use AsNoTracking()?

**Per the EF Core documentation:** EF tracks entity instances by default so changes are detected and persisted on `SaveChanges`. Tracking costs two things, both documented:

1. *"EF internally maintains a dictionary of tracked instances… The dictionary maintenance and lookups take up some time when loading the query's results."* (This is **identity resolution**.)
2. *"Before handing a loaded instance to the application, EF snapshots that instance and keeps the snapshot internally… The snapshot takes up more memory, and the snapshotting process itself takes time."*

**The measured effect, from Microsoft's own published benchmark** (10 blogs × 20 posts):

| Method | Mean | Allocated |
|---|---|---|
| `AsTracking` | 1,414.7 µs | 380.11 KB |
| **`AsNoTracking`** | **993.3 µs (0.71×)** | **232.89 KB** |

Roughly **30 % faster and 39 % less memory** on a read-only query — and the gap widens with result-set size.

**Use `AsNoTracking()` whenever the entities will not be modified in that context:**
- Every `GET` endpoint, read model, report, export, lookup or search.
- Any projection to a DTO (though note: **projections to non-entity types are not tracked anyway**, so `AsNoTracking()` is redundant there — a detail worth getting right).
- Bulk reads for processing where you write via a different mechanism.

**Do not use it when** you intend to modify and `SaveChanges` — nothing will be persisted, because there is no change tracker entry. (You can still update by attaching and marking properties modified, but the docs describe this as an advanced technique to attempt *"only… if the change tracking overhead has been shown to be unacceptable via profiling"*.)

**The trap that the documentation calls out and most candidates miss:** *"since no-tracking queries do not perform identity resolution, a database row which is referenced by multiple other loaded rows will be materialized as different instances."* Load 100 Posts that all reference the same Blog: a **tracking** query gives you one shared `Blog` instance; a **no-tracking** query gives you **100 separate Blog objects**. That is more memory than you expected, and reference-equality comparisons (`blogA == blogB`) silently become false. Where you need de-duplication without change tracking, use **`AsNoTrackingWithIdentityResolution()`**.

**How I'd configure it in a real service:** rather than remembering per query, set the default at the context level for read-heavy services and opt *in* to tracking where you write:
```csharp
services.AddDbContext<AppDbContext>(o => o
    .UseNpgsql(cs)
    .UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking));
```
Better still, in a CQRS design, use a **separate read context** configured no-tracking (or Dapper for the read side) and keep the tracked context exclusively for the write model — which makes the distinction structural rather than a discipline someone has to remember.

---

## Q13. How do database indexes affect performance?

An index is a **sorted, auxiliary data structure** (almost always a B-tree) that lets the engine find rows without scanning the table. It converts an **O(n) scan into an O(log n) seek**.

**The trade-off, stated as the EF Core docs do:** *"While indexes speed up queries, they also slow down updates since they need to be kept up-to-date. Avoid defining indexes which aren't needed."*

| Reads | Writes |
|---|---|
| Seek instead of scan — orders of magnitude faster on large tables | Every `INSERT`/`UPDATE`/`DELETE` must maintain **every** affected index |
| Enables efficient `ORDER BY`, `GROUP BY`, `MIN`/`MAX`, joins, range scans | Extra storage, extra log/WAL volume, more page splits and fragmentation |
| A **covering** index answers the query entirely from the index | More indexes = slower writes, and a write-heavy table with 12 indexes is a real bottleneck |

**Concepts that must appear in a strong answer:**

- **Clustered vs non-clustered.** The clustered index *is* the table's physical order (one per table). A non-clustered index is a separate structure with a pointer back to the row — and that lookup ("key lookup"/"bookmark lookup") is what makes a non-covering index expensive for wide selects.
- **Composite index column order is everything.** Per the docs: *"an index on columns A and B speeds up queries filtering by A and B as well as queries filtering only by A, but it does not speed up queries only filtering over B."* Leading column first, then the next most selective. This single rule explains most "we have an index and it's still slow" cases.
- **Covering index / `INCLUDE`.** Adding non-key columns to the index leaf lets the query be answered without touching the table at all — often a 10× improvement on a hot read.
- **Selectivity.** An index on a low-cardinality column (`status`, `is_active`) is usually ignored — the optimiser correctly decides scanning is cheaper. **Filtered indexes** (`WHERE status = 'PENDING'`) fix exactly this case and are ideal for the "small set of active rows in a huge table" pattern that outbox and job tables have.
- **SARGability.** A predicate that wraps the column in a function (`WHERE YEAR(created) = 2026`, `WHERE LOWER(email) = …`) cannot use a plain index. Rewrite as a range (`created >= '2026-01-01' AND created < '2027-01-01'`) or index the expression/computed column.
- **Statistics.** The optimiser chooses plans from row-count estimates. Stale statistics produce bad plans on perfectly good indexes.
- **Index maintenance.** Fragmentation, fill factor, and in PostgreSQL, bloat and `REINDEX`/autovacuum behaviour.

**How I decide what to index:** from the **actual query workload**, not from the schema. Pull the top queries by total time (`pg_stat_statements`, Query Store), read their plans, and add the minimum set of indexes that turns scans into seeks — then verify writes did not regress. Use the engine's missing-index DMVs as a *hint*, never as instructions; they over-suggest wildly and will happily recommend fifteen overlapping indexes.

**In a fintech context:** the `payments` table is both write-heavy and read-heavy, so index count is a genuine trade-off. Typical set: PK on `payment_id`, unique on `idempotency_key` (which is a correctness constraint as much as a performance one), composite on `(merchant_id, created_at DESC)` for merchant statements, filtered index on `status` for the pending/retry worker, and — deliberately — **not** an index on every column someone might one day filter by.

---

## Q14. How do you analyze a SQL execution plan?

The execution plan is the optimiser's chosen strategy. Reading it is the difference between guessing and knowing.

**Get an actual plan, not an estimated one** — you need real row counts:

| Engine | Command |
|---|---|
| **PostgreSQL** | `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT …` — `BUFFERS` is essential; it shows shared hits vs reads |
| **SQL Server** | `SET STATISTICS IO, TIME ON` + Include Actual Execution Plan; or Query Store's plan |
| **EF Core** | `query.ToQueryString()` to get the SQL, then explain it in the database |

**Read it from the innermost/rightmost operator outward** — that is execution order.

**What to look for, in priority order:**

**1. The estimate-vs-actual gap.** This is the single most informative signal. If the optimiser estimated 10 rows and got 2,000,000, every downstream choice (join type, memory grant, index use) was made on bad information. Cause: stale statistics, parameter sniffing, correlated predicates, or a non-SARGable expression the optimiser can't estimate. Fix the estimate and the plan usually fixes itself.

**2. Scans where seeks belong.**

| Operator | Meaning |
|---|---|
| **Seq Scan / Table Scan / Clustered Index Scan** | Reading everything. Fine on a small table or when returning most rows; a red flag on a large table with a selective predicate |
| **Index Seek / Index Scan (Postgres)** | Using the index to navigate — what you want |
| **Key Lookup / Bookmark Lookup** | Index found the row but had to fetch other columns from the table. High counts → make the index **covering** with `INCLUDE` |
| **Bitmap Heap Scan** (Postgres) | Index gave many rows; often fine, but check `Rows Removed by Filter` |

**3. Join strategy vs data size.**

| Join | Good when | Bad sign |
|---|---|---|
| **Nested Loop** | Small outer input, indexed inner | Chosen with a large outer input — usually an underestimate |
| **Hash Join** | Large unsorted inputs | Spilling to disk (`Batches > 0` in Postgres; `Hash Warning` in SQL Server) |
| **Merge Join** | Both inputs already sorted | An expensive explicit Sort feeding it |

**4. Expensive operators and warnings.** A **Sort** or **Hash** that **spills to disk** (`external merge Disk: 15432kB`) means the memory grant was too small — usually a consequence of the bad estimate in (1). Sort operators that could be eliminated by an index in the right order. In SQL Server, plan warnings (implicit conversion, missing index, excessive grant) appear directly on the operator and are worth reading first.

**5. Implicit conversions.** `WHERE varchar_column = @nvarchar_param` silently converts the *column*, defeating the index. This is a classic and it shows as `CONVERT_IMPLICIT` in the plan. In EF Core it is usually a mismatch between the C# `string` mapping and the column type.

**6. Parallelism.** Wide parallel plans on an OLTP query often indicate a scan the optimiser is trying to brute-force. `CXPACKET` waits with skewed row distribution across threads means uneven work.

**7. Buffers (PostgreSQL).** `shared hit` = from cache (fast), `shared read` = from disk. A query with millions of `shared read` is an I/O problem; the fix may be an index, or it may be more memory.

**The workflow:** find the operator with the largest **actual** cost or the worst estimate/actual ratio → understand why the optimiser chose it → change *one* thing (index, rewrite, statistics update, parameter handling) → re-explain and compare. Change one thing at a time or you learn nothing.

**A caution to voice:** the "cost" percentages in a SQL Server plan are **estimates**, not measurements. A node shown as 2 % of the plan can be 90 % of the runtime if the estimate was wrong. Trust actual rows, actual time and actual I/O over cost percentages.

---

## Q15. How does connection pooling work?

**Per Microsoft Learn (ADO.NET):** opening a database connection is **expensive** — TCP handshake, TLS negotiation, authentication, session setup — typically tens of milliseconds. Connection pooling amortises that by **reusing physical connections**.

**The mechanism:**

```
app: new SqlConnection(cs)      → cheap object, no network
app: conn.OpenAsync()           → ask the pool for a connection
        ├── free connection available?  → hand it over (~microseconds)
        ├── pool below Max Pool Size?   → open a NEW physical connection (~10–50 ms)
        └── pool at max?               → WAIT up to Connect Timeout, then throw
app: conn.DisposeAsync()        → connection RETURNED to the pool, not closed
                                  (session reset; transaction rolled back if not committed)
```

**Facts that matter:**

- **Pools are keyed by the exact connection string.** Any difference — a different `Application Name`, a different password, a stray space — creates a **separate pool**. This is how an application ends up with five pools of 100 and blows the server's connection limit.
- **`Max Pool Size` defaults to 100** in SqlClient. `Min Pool Size` defaults to 0, so the first requests after idle pay full connection cost — set a small `Min Pool Size` for latency-sensitive services to keep warm connections.
- **`Connect Timeout` (default 15 s in SqlClient)** is the time you wait *for a pooled connection*, not just for the network. Exhaustion therefore manifests as a timeout exception after that delay.
- **You must dispose.** `using`/`await using` returns the connection to the pool. A missing dispose is a leaked connection — the pool shrinks until nothing is left.
- **The pool is per process (per AppDomain).** Twenty pods × 100 max = **2,000 connections** to the database. This is the arithmetic people forget, and it is how a horizontally scaled service takes down its own database.

**In practice for .NET:**
```csharp
// Registering the DbContext gives you ADO.NET pooling automatically;
// AddDbContextPool additionally pools the DbContext *objects*.
services.AddDbContextPool<AppDbContext>(o => o.UseNpgsql(cs), poolSize: 128);
// Connection string: "…;Maximum Pool Size=50;Minimum Pool Size=5;Timeout=15"
```
Hold connections for the **shortest possible time**: open late, close early, and **never hold a connection (or a transaction) across an external HTTP call**. In a payments service that mistake — a database transaction open while awaiting the payment provider — is how one slow third party exhausts the pool and takes down everything.

**At scale, add an external pooler.** For PostgreSQL, **PgBouncer** (or **RDS Proxy** on AWS) sits between the fleet and the database in transaction-pooling mode, multiplexing thousands of application connections onto a small number of server connections. This is the standard answer for serverless and highly-scaled workloads where per-instance pools cannot be reconciled with the database's connection limit — and RDS Proxy additionally preserves connections across a failover, which shortens recovery.

---

## Q16. What causes connection pool exhaustion?

**Symptom:** `Timeout expired. The timeout period elapsed prior to obtaining a connection from the pool. This may have occurred because all pooled connections were in use and max pool size was reached.` — and critically, **CPU is low and the database looks idle**, because the application is queuing on its own pool, not on the database.

**Causes, ranked by real-world frequency:**

| # | Cause | Detail |
|---|---|---|
| 1 | **Connections not disposed** | A missing `using`, an exception path that skips disposal, a `DbContext` resolved outside a scope. The pool bleeds until empty |
| 2 | **Slow queries holding connections** | Little's Law: `concurrency = throughput × duration`. A query that goes from 20 ms to 500 ms multiplies connection demand **25×** at the same RPS — this is the mechanism behind most sudden exhaustion events |
| 3 | **Holding a connection across I/O** | A transaction or open connection while awaiting an HTTP call, a queue publish, or a file write |
| 4 | **Traffic beyond planned concurrency** | Pool sized for 200 RPS, now serving 800 |
| 5 | **Sync-over-async / thread-pool starvation** | Blocked threads hold connections while unable to complete; the two exhaustion modes reinforce each other |
| 6 | **Long-running / orphaned transactions** | An unclosed transaction pins a connection indefinitely |
| 7 | **Pool fragmentation** | Multiple connection strings → multiple pools, none of them large enough |
| 8 | **Pool too small for the workload**, or database `max_connections` too low for `pods × Max Pool Size` |

**Diagnosing it:**
```bash
dotnet-counters monitor -p 1 Microsoft.Data.SqlClient.EventSource   # or Npgsql
#   active-hard-connections, active-soft-connections, number-of-pooled-connections,
#   number-of-non-pooled-connections, number-of-active-connection-pools
```
Database side: `sys.dm_exec_sessions` / `pg_stat_activity` — look for many sessions `idle in transaction`, which is the fingerprint of cause 3 or 6.

**Fixes, in order:**

1. **Fix the leak first.** `await using var conn = …`; scoped `DbContext` lifetimes; never a singleton `DbContext`.
2. **Make the queries fast.** The most effective way to need fewer connections is to hold each one for less time.
3. **Never span an external call** with an open connection or transaction. Commit, then publish (via the **outbox**, so you don't create a dual-write problem in the process).
4. **Size deliberately**, and check the total: `pods × Max Pool Size ≤ database max_connections − headroom`. Then front it with **PgBouncer/RDS Proxy** if the arithmetic doesn't work.
5. **Bound concurrency upstream** — a concurrency limiter or bulkhead so excess load is rejected fast (429) rather than queueing on the pool and timing out slowly. Failing fast is better than failing late.
6. **Alarm on pool utilisation > 80 %**, not on the timeout exception — by the time you see timeouts, users already have.

---

## Q17. How does caching improve performance?

Caching stores the result of an expensive operation so subsequent requests get it cheaply. It is the highest-leverage performance technique available, and also the one that introduces the most correctness risk — a good answer covers both.

**What it buys, quantitatively:**

| Source | Typical latency |
|---|---|
| CPU L1/L2 cache | ~1–10 ns |
| **In-process memory (`IMemoryCache`)** | **~50–100 ns** |
| **Distributed cache (Redis/ElastiCache), same AZ** | **~0.3–1 ms** |
| Database query (indexed, warm) | 1–10 ms |
| Database query (complex/cold) | 50–1,000 ms |
| External API | 50–2,000 ms |

So a cache hit replaces a 100 ms query with a 0.5 ms lookup — **200×** — and simultaneously removes load from the database, which helps every *uncached* query too. That second-order effect is usually larger than the first.

**The layers, outermost first:**

| Layer | Example | Best for |
|---|---|---|
| **Client / browser** | `Cache-Control`, ETag | Static assets |
| **CDN / edge** | CloudFront | Public, cacheable content; offloads the origin entirely |
| **API gateway** | API Gateway cache | Read-heavy public endpoints |
| **In-process** | `IMemoryCache`, `HybridCache` | Hottest data; fastest; **per-instance, so N copies and N invalidation problems** |
| **Distributed** | Redis / ElastiCache | Shared state, session, idempotency keys, rate limits; consistent across instances |
| **Database** | Buffer pool, materialised views | Free; already happening |

**.NET note:** **`HybridCache`** (.NET 9) is the current recommendation — it combines L1 in-process and L2 distributed caching behind one API, and gives you **stampede protection** built in (Q19), which previously you had to build yourself.

**Cache-aside is the default pattern:**
```csharp
var rate = await cache.GetOrCreateAsync($"fx:{pair}", async ct => {
    var v = await rateService.GetAsync(pair, ct);
    return v;
}, new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(5) });
```

**The costs, which must be stated:**
- **Staleness.** Every cache is a decision to serve possibly-old data. That decision must be made per data type: FX rates for 5 seconds, product catalogue for an hour, **an account balance: never**.
- **Invalidation.** The hard part. Options: short TTL (simplest, usually right), event-driven invalidation on write, or write-through.
- **A new failure mode.** The cache going down transfers full load to the database instantly — which is why you need stampede protection and a degradation plan.
- **Memory cost** and eviction behaviour; an unbounded `IMemoryCache` is a memory leak with a friendly name (always set `SizeLimit`).

**Where I would *not* cache in a payments platform:** balances, transaction state, authorisation decisions, or anything where stale data creates a financial or regulatory error. Cache the *reference* data around them — merchant configuration, FX rates, BIN ranges, country rules — where staleness is bounded and tolerable. Being explicit about that boundary is what a fintech panel is listening for.

---

## Q18. What is cache stampede?

**Cache stampede** (also *dog-piling*, *thundering herd*, *cache miss storm*): a popular cache key expires or is evicted, and **every concurrent request for it misses simultaneously**, so all of them hit the origin at once to recompute the same value.

```
t=0.000  key "top-merchants" expires
t=0.001  1,000 concurrent requests → all MISS
t=0.002  1,000 identical expensive queries hit the database
t=0.100  database saturates; latency climbs; some requests time out
t=0.200  timeouts trigger client retries → MORE load
t=…      the database falls over, taking down services that were otherwise healthy
```

**Why it is worse than it looks:**
1. The database was sized for the *cached* load — perhaps 10 QPS. It now receives 1,000 QPS of the most expensive query in the system.
2. The 999 redundant computations produce an identical result; all of the work is waste.
3. **Retries amplify it.** Timeouts cause retries, which add load, which cause more timeouts — a positive feedback loop.
4. It is **correlated by construction**: TTL-based expiry synchronises the misses. Cache entries created together expire together, so the same failure recurs on a cycle.

**Related failure modes worth naming, because interviewers probe the distinction:**

| Failure | Cause |
|---|---|
| **Stampede / dog-pile** | One hot key expires → many concurrent recomputes |
| **Cache penetration** | Requests for a key that **does not exist anywhere** — every request reaches the database. Classic attack vector: request random non-existent account IDs |
| **Cache avalanche** | **Many** keys expire at once (same TTL set at deploy/warm-up), or the cache node fails → the entire load lands on the origin |

**The real-world trigger to mention:** it most often fires after a **cache restart, a failover, or a deploy that changes the key prefix** — the cache is empty, and full production traffic arrives at a cold cache. If you have ever seen a service that is fine until it is restarted under load, this is usually why.

---

## Q19. How do you prevent cache stampede?

Layered defences; use several, because they address different parts of the problem.

**1. Request coalescing / single-flight — the primary fix.** Only **one** caller recomputes; the rest wait for that result.
```csharp
// Per-key lock so concurrent misses collapse into one origin call
private static readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();

async Task<T> GetOrCreateAsync<T>(string key, Func<Task<T>> factory, TimeSpan ttl)
{
    if (_cache.TryGetValue(key, out T? v)) return v!;
    var gate = _locks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
    await gate.WaitAsync();
    try
    {
        if (_cache.TryGetValue(key, out v)) return v!;      // double-check: someone else filled it
        v = await factory();
        _cache.Set(key, v, ttl);
        return v;
    }
    finally { gate.Release(); }
}
```
**In .NET 9+, use `HybridCache`** — `GetOrCreateAsync` provides stampede protection natively, and does it across the L1/L2 layers, which is why it is now the recommended answer rather than hand-rolling the above.

**2. Jittered TTLs — prevents synchronised expiry (avalanche).** Never a fixed TTL for a whole class of keys:
```csharp
var ttl = TimeSpan.FromMinutes(30) + TimeSpan.FromSeconds(Random.Shared.Next(0, 300));
```
This is a one-line change that eliminates a whole failure mode, and it belongs in your caching helper so nobody has to remember it.

**3. Probabilistic early expiration (XFetch).** As an entry approaches expiry, each request has a small, increasing probability of refreshing it *early*, in the background, while the old value is still served. Refresh happens before the cliff, and only one request typically wins the dice roll.

**4. Stale-while-revalidate.** Serve the stale value immediately and refresh asynchronously. Latency stays flat, the origin sees exactly one request, and users get slightly-old data instead of a timeout — usually the right trade for reference data. Pair with **stale-if-error**: on origin failure, keep serving stale rather than failing.

**5. Background refresh for known-hot keys.** For a small set of critical keys (FX rates, merchant config), a hosted service refreshes them on a timer so they are *never* absent. Requests never experience a miss at all.

**6. Cache negative results — defeats penetration.** Cache "not found" with a short TTL, or put a **Bloom filter** in front for existence checks, so requests for non-existent keys don't reach the database.

**7. Warm the cache on startup**, before the instance reports Ready. This is the readiness-probe link: don't accept traffic until the cache is primed, otherwise every deploy is a small stampede.

**8. Bound the blast radius regardless.** A **bulkhead**/concurrency limiter on the origin call (`SemaphoreSlim(20)`) so at most 20 recomputes can ever run concurrently, plus a **circuit breaker** so a struggling database sheds load rather than being hammered. This is the defence that works even when the others fail.

**The architect's summary:** stampede is a **correlated-failure** problem. Every fix is a way of decorrelating — decorrelate expiry (jitter), decorrelate recomputation (coalescing), or decouple the response from the recomputation (stale-while-revalidate). Say it that way and it generalises to retry storms and thundering herds elsewhere in the system.

---

## Q20. Vertical vs horizontal scaling?

| | **Vertical (scale up)** | **Horizontal (scale out)** |
|---|---|---|
| Method | A bigger machine — more CPU, RAM, IOPS | More machines |
| Limit | **Hard ceiling** — the largest instance available | **Effectively unbounded** |
| Availability | **Still a single point of failure** | Redundancy is inherent |
| Downtime to scale | Usually a restart/failover | None — add instances |
| Cost curve | **Super-linear** — the top of the range is disproportionately expensive | Roughly linear |
| Application changes | **None** — this is its great advantage | Must be **stateless**, needs load balancing, service discovery, distributed state |
| Granularity | Coarse (double the instance) | Fine (one instance at a time) |
| Best for | **Databases**, licensed software, single-threaded workloads, quick wins | **Stateless application tiers**, web/API, workers |

**When vertical is genuinely the right answer** — and saying so shows judgement rather than reflex:
- **Relational databases.** Writes go to one primary; you cannot horizontally scale writes without sharding, which is a major architectural commitment. Scaling Aurora up a size is a Tuesday; sharding a ledger is a year.
- **A quick, cheap fix** while you address the real problem.
- Workloads that are memory-bound or need a large single dataset in RAM.
- Anything with per-core licensing where the arithmetic inverts.

**When horizontal is right:** stateless services (which is what your .NET APIs should be), variable load where elasticity saves money, and anything needing HA — because *N* instances across three AZs is availability, whereas one enormous instance is a single point of failure no matter how large.

**The rules that make horizontal scaling actually work:**
1. **Stateless application tier.** No in-process session state, no local file dependencies, no sticky sessions. Externalise state to Redis/database.
2. **Idempotent operations** — because with retries and multiple instances, duplicate delivery is a certainty.
3. **No shared mutable state** without coordination (distributed locks are a design smell; prefer partitioning by key).
4. **The bottleneck moves.** Scaling the app tier just pushes the pressure onto the database, the cache or the third party — which is Q21.

**The mature answer:** you use both, at different tiers. Horizontal for the stateless app tier (elastic, redundant, cheap), vertical for the relational database (until sharding or a different store is genuinely justified), with read replicas and caching to relieve the database's read load so vertical scaling lasts longer. And know the ceiling before you need it: "we can scale Aurora to db.r7g.16xlarge, which gets us to roughly 12,000 write TPS; beyond that we shard by merchant" is a capacity plan. "We'll scale up" is not.

---

## Q21. Why doesn't scaling APIs always solve performance problems?

Because **adding instances only helps if the application tier is the bottleneck** — and it usually isn't. This question is really testing whether you understand bottleneck theory.

**Where the load actually goes when you add instances:**

```
        10 pods                        40 pods
           │                              │
           ▼                              ▼
   ┌───────────────┐              ┌───────────────┐
   │  ONE database │  ← same       │  ONE database │  ← now 4× the connections,
   │  ONE cache    │               │  ONE cache    │     4× the queries, and
   │  ONE 3rd party│               │  ONE 3rd party│     the SAME capacity
   └───────────────┘              └───────────────┘
```

**The specific reasons scaling out fails, each worth naming:**

1. **The bottleneck is downstream and shared.** One database, one Redis, one payment provider. Four times the callers hitting a fixed-capacity resource makes it *worse*, not better — more connections, more contention, more queueing.
2. **A hard external limit.** The provider rate-limits you at 100 TPS. A thousand pods still get 100 TPS, plus a lot of 429s.
3. **Connection multiplication.** `pods × Max Pool Size` can exceed the database's `max_connections`, so scaling out **causes** the outage it was meant to prevent (Q15).
4. **Serialisation — Amdahl's Law.** If 10 % of the work is inherently serial (a lock, a sequence, a single-writer path), the maximum speed-up is 10× no matter how many instances you add.
5. **Coherence cost — the Universal Scalability Law.** Beyond contention, there is the cost of keeping nodes consistent (cache invalidation chatter, distributed locks, coordination). Throughput doesn't just plateau — it **declines**. More nodes can be slower.
6. **Latency is not throughput.** A request that takes 2 seconds because of one slow downstream call still takes 2 seconds with 100 instances. **Scaling out increases throughput; it does not reduce latency.** This is the confusion at the heart of most "we scaled and it didn't help" stories.
7. **Partition/parallelism ceilings.** Kafka consumers cannot exceed the partition count — the 20th consumer on a 10-partition topic sits idle.
8. **Cold starts and warm-up.** New instances have empty caches, unJITted code and empty connection pools; during a spike they are briefly *slower* and add cache-miss load.
9. **The problem is a bug.** An N+1, a missing index, a lock. Scaling multiplies the bug.

**The correct method, stated plainly:** *find the bottleneck first.* If the app tier is CPU-saturated, scale out — it works, and it is the easy case. If it is anything else — database, cache, external dependency, lock, connection pool, thread pool — scaling out is at best neutral and often actively harmful. Load-shedding, caching, batching, query optimisation and asynchrony are what actually help.

**The line to use in an interview:** *"Scaling is not a performance fix; it is a capacity fix. If the system is slow at low load, it will be slow at high load with more instances."*

---

## Q22. How do you optimize Kafka consumers?

Per the **Apache Kafka documentation** and the consumer configuration reference, in the order that matters.

**1. Partitions are the parallelism ceiling.** Each partition is consumed by exactly one member of a group, so **consumer instances > partitions leaves some idle** (Module 8). If you need more parallel consumers, you need more partitions — and partition count can only ever be increased, so plan it with headroom.

**2. Decouple polling from processing — the highest-value change.** The single most common consumer problem is slow processing inside the poll loop causing `max.poll.interval.ms` breaches, which triggers a rebalance, which causes reprocessing, which makes it slower still. Either process asynchronously with bounded parallelism (a `Channel<T>` and N workers, committing only after completion), or make processing fast enough to stay inside the interval.

**3. Tune the fetch and poll settings:**

| Setting | Effect |
|---|---|
| `max.poll.records` | Records per poll. **Lower it** if per-record processing is slow — this is usually the fix for rebalance loops |
| `max.poll.interval.ms` | Max time between polls before the member is considered dead and a rebalance starts |
| `fetch.min.bytes` / `fetch.max.wait.ms` | Batch more per fetch — fewer round trips, higher throughput, slightly higher latency |
| `max.partition.fetch.bytes` | Data per partition per fetch |
| `session.timeout.ms` / `heartbeat.interval.ms` | Failure detection speed vs rebalance sensitivity |

**4. Batch the work downstream.** If each message triggers a database write, you have made the database do N round trips. Accumulate a batch and write once — often a 10–50× improvement, and it is usually the difference between keeping up and falling behind.

**5. Commit offsets deliberately.** Manual commit **after** successful processing gives at-least-once; auto-commit can lose or duplicate messages depending on timing. Commit in batches, not per message — per-message commits are a throughput killer. And since at-least-once means duplicates, the consumer must be **idempotent** regardless (Module 5).

**6. Minimise rebalancing**, which is pure downtime:
- **Static group membership** (`group.instance.id`) so a pod restart doesn't trigger a full rebalance.
- **`CooperativeStickyAssignor`** for incremental rebalancing instead of stop-the-world.
- Stable pod identity, generous `max.poll.interval.ms`, and no long GC pauses.

**7. Watch the right metric: consumer lag**, per partition. Rising lag on *one* partition means key skew or a stuck consumer; rising lag on *all* means insufficient capacity. Alert on lag **trend**, not absolute value — lag of 10,000 that is falling is fine; lag of 500 that is rising is not.

**8. Handle poison messages** with a retry topic and a **DLQ** — never let one bad message block a partition forever, and never retry in place indefinitely (Module 7).

**9. .NET specifics:** use `Confluent.Kafka` with a long-lived consumer; do the deserialisation cheaply (System.Text.Json source generators, or Avro/Protobuf with a schema registry); avoid per-message allocations; and never block the consume loop on `.Result`.

---

## Q23. How do you optimize Kafka producers?

Per the **Apache Kafka producer configuration** documentation. The producer is where the throughput-vs-latency-vs-durability trade-off is made explicit, and a good answer treats it as a three-way choice rather than a list of settings.

**1. Batching — the single biggest lever.**

| Setting | Effect |
|---|---|
| **`linger.ms`** (default 0) | How long to wait to fill a batch. **0 means send immediately** — lowest latency, worst throughput. Setting `5–100 ms` can improve throughput by an order of magnitude |
| **`batch.size`** (default 16 KB) | Maximum bytes per partition per batch. Raise to 64–256 KB for high throughput |
| `buffer.memory` (default 32 MB) | Total client-side buffer; when full, `send()` blocks for `max.block.ms` |

The producer sends when **either** `batch.size` is reached **or** `linger.ms` elapses. `linger.ms = 0` is the default precisely because Kafka optimises for latency out of the box; throughput tuning means deliberately trading a few milliseconds.

**2. Compression.** `compression.type` = `lz4` (fast, good ratio — usually the right default), `zstd` (best ratio, more CPU), `snappy`, or `gzip` (slow). Compression is applied **per batch**, so larger batches compress dramatically better — batching and compression multiply each other. On a JSON payload, `lz4` typically gives 3–5× reduction, which cuts network, broker disk and replication cost simultaneously.

**3. Durability — `acks`, and be explicit about the trade:**

| `acks` | Guarantee | Use |
|---|---|---|
| `0` | Fire and forget; data loss on any failure | Metrics, traces — never money |
| `1` | Leader acknowledged; **lost if the leader fails before replication** | Tolerable-loss telemetry |
| **`all` (`-1`)** | All in-sync replicas acknowledged | **Any financial event.** Combine with `min.insync.replicas=2` and `replication.factor=3` |

`acks=all` costs latency, not throughput — throughput is preserved by batching and by `max.in.flight.requests.per.connection`.

**4. Idempotence and ordering.** **`enable.idempotence=true`** (the default in modern clients) makes retries safe: the broker de-duplicates by producer ID and sequence number, so a retried send does not produce a duplicate. It requires `acks=all`, `retries > 0`, and `max.in.flight.requests.per.connection ≤ 5` — and with idempotence enabled, **ordering is preserved even with 5 in-flight requests**, which is the modern answer (the old advice of `max.in.flight=1` for ordering costs enormous throughput and is no longer necessary).

**5. Partitioning.** The key determines the partition (`hash(key) % partitions`), which determines ordering and load distribution. **Key skew is a real production problem** — keying by `merchant_id` when one merchant is 40 % of volume creates a hot partition that caps your throughput at one consumer's capacity. If you don't need per-key ordering, use a null key and let the **sticky partitioner** batch efficiently across partitions.

**6. Async, always.** Never `await` per-message delivery confirmation in a loop — that serialises everything and destroys batching. Use the delivery callback / `ProduceAsync` with bounded concurrency, and handle failures there.

**7. Serialisation.** Avro/Protobuf with a **Schema Registry** over JSON: smaller payloads, faster serialisation, and schema evolution enforced at the boundary (Module 7).

**8. Reuse the producer.** It is thread-safe and expensive to create. **One producer per process**, injected as a singleton. Creating one per message is a startling but not-uncommon bug.

**The three profiles to name, because it shows you understand the trade rather than the settings:**

| Profile | Settings |
|---|---|
| **Max throughput** | `linger.ms=100`, `batch.size=256KB`, `compression=lz4`, `acks=1` |
| **Low latency** | `linger.ms=0`, small batches, `compression=none`, `acks=1` |
| **Max durability (payments)** | `acks=all`, `enable.idempotence=true`, `min.insync.replicas=2`, `linger.ms=10`, `compression=lz4`, infinite retries with `delivery.timeout.ms` bounding the total |

---

## Q24. How do you identify GC problems?

**Per Microsoft Learn**, the .NET managed heap is divided into generations to exploit two observations: *"Newer objects have shorter lifetimes, and older objects have longer lifetimes"*, and *"It's faster to compact the memory for a portion of the managed heap than for the entire managed heap."*

**What matters diagnostically:**
- **Gen 0** collections are cheap and frequent — high Gen 0 counts alone are *not* a problem.
- **Gen 2 collections are full collections** — *"A generation 2 garbage collection is also known as a full garbage collection because it reclaims objects in all generations."* These are the expensive ones.
- **All managed threads are suspended** except the triggering thread while a collection runs — this is the source of latency spikes.
- The docs state collections occur when: physical memory is low, *"the memory that's used by allocated objects on the managed heap surpasses an acceptable threshold"*, or `GC.Collect()` is called.

**Symptoms of a GC problem, and what each points to:**

| Symptom | Likely cause |
|---|---|
| **p99 latency spikes with a flat p50** | Gen 2 / blocking collections pausing all threads |
| **High `% Time in GC` (> 10 %)** | Allocation rate too high — the app is spending its time collecting, not working |
| **Gen 2 count rising steadily** | Objects surviving to Gen 2 — a **mid-life crisis** (objects living just long enough to be promoted) or a leak |
| **Memory grows and never returns** | A leak: a static collection, an unbounded cache, un-unsubscribed events, undisposed resources |
| **LOH growing / fragmented** | Frequent allocations ≥ **85,000 bytes** (Q25) |
| **OOMKilled in a container** | Heap limit vs container limit mismatch (Module 10 Q21) |

**Tools, in the order I use them:**
```bash
dotnet-counters monitor -p 1 System.Runtime
#   gc-heap-size, gen-0/1/2-gc-count, time-in-gc, alloc-rate,
#   loh-size, poh-size, gc-fragmentation
dotnet-gcdump collect -p 1        # what is retained, and by what
dotnet-trace collect -p 1 --profile gc-verbose
```
Then PerfView or Visual Studio's dump analysis; `dotnet-dump analyze` with `dumpheap -stat` and `gcroot` to find what is holding a reference. In production, `dotnet-monitor` as a sidecar gives you on-demand dumps without an interactive session.

**The key ratios to compute, not just the raw counters:**
- **Gen 2 collections per minute** — should be very low (single digits) for a healthy service.
- **Gen 0 : Gen 1 : Gen 2 ratio** — a healthy app is roughly 100 : 10 : 1. If it approaches 10 : 5 : 1, objects are surviving too long and something is being promoted that shouldn't be.
- **Allocation rate per request** — the number that actually drives everything above.

**Server GC vs Workstation GC.** Server GC uses a heap and a dedicated GC thread **per logical core**, giving much higher throughput — it is the default for ASP.NET Core and is what you want on a dedicated host. But in a **small container** it can allocate far more memory than expected and behave badly (Module 10 Q21); `DOTNET_gcServer=0`, or `GCHeapHardLimitPercent`, is the lever. **Background GC** allows Gen 2 collection concurrently with allocation, which is why full collections are less catastrophic than they used to be. .NET 8+ also offers **DATAS** (Dynamic Adaptation To Application Sizes), which adjusts heap count to the actual workload and is genuinely useful for containerised services.

**The important framing:** *GC is rarely the root cause — it is the messenger.* The GC is doing its job; the problem is the allocation rate. Fix the allocations (Q25) rather than tuning the collector, unless you have measured a specific configuration mismatch.

---

## Q25. How do you reduce .NET allocations?

Every allocation is future GC work, so reducing allocations reduces both memory *and* pause-driven tail latency.

**1. Know the LOH threshold.** Per Microsoft Learn: *"The large object heap contains objects that are 85,000 bytes and larger, which are usually arrays."* LOH objects are collected as part of **Gen 2** and *"ordinarily, the large object heap isn't compacted because copying large objects imposes a performance penalty"* — so LOH churn causes both full collections and fragmentation. A `byte[]` of 100 KB per request is a specific, findable performance bug.

**2. Use `Span<T>` / `Memory<T>` / `ReadOnlySpan<T>`** for slicing without copying:
```csharp
// allocates a new string per call
var code = input.Substring(0, 3);
// zero allocation
ReadOnlySpan<char> code = input.AsSpan(0, 3);
```
And parse/format over spans: `int.Parse(span)`, `Utf8Formatter`, `IUtf8SpanFormattable`.

**3. Pool what is big and reusable.**
```csharp
var buffer = ArrayPool<byte>.Shared.Rent(8192);
try { /* … */ } finally { ArrayPool<byte>.Shared.Return(buffer); }
```
`ArrayPool<T>`, `MemoryPool<T>`, `ObjectPool<T>` (from `Microsoft.Extensions.ObjectPool`), `RecyclableMemoryStream` instead of `MemoryStream` for large payloads. **`System.IO.Pipelines`** for high-throughput network/stream processing — this is what Kestrel itself uses.

**4. Avoid the hidden allocations that dominate real services:**

| Pattern | Allocation | Fix |
|---|---|---|
| String concatenation in a loop | A new string per iteration | `StringBuilder`, `string.Create`, interpolated-string handlers |
| **Boxing** a value type | A heap object per box | Generics; avoid `object`/non-generic collections; `struct` constraints |
| **LINQ in a hot path** | Enumerators, closures, delegates, intermediate lists | A plain `for` loop in genuinely hot code (keep LINQ everywhere else — readability wins by default) |
| **Closures capturing variables** | A display class per call | Static lambdas (`static () =>`), pass state explicitly |
| `async` methods that rarely await | A state machine + `Task` | **`ValueTask`** for hot, usually-synchronous paths |
| Logging with string interpolation | Formats even when the level is disabled | **Structured logging with message templates**, or `LoggerMessage` source generators |
| `params object[]` / `String.Format` | Array + boxing | Source-generated logging, overloads |
| Exceptions as control flow | Very expensive | `TryParse`-style APIs, result types |

**5. Use `struct` deliberately** for small, short-lived, immutable values (`readonly record struct`) — but measure: large structs copied repeatedly are worse than a heap allocation, and a struct captured in a closure or async state machine gets boxed anyway.

**6. Serialise efficiently.** `System.Text.Json` **source generators** (`JsonSerializerContext`) remove reflection and cut allocations substantially; serialise directly to a `PipeWriter`/`Utf8JsonWriter` rather than to a `string` and then to bytes.

**7. Cache what you keep re-creating** — compiled `Regex` (or `[GeneratedRegex]`), `JsonSerializerOptions`, `HttpClient` via `IHttpClientFactory`, EF compiled queries.

**The discipline:** measure with **BenchmarkDotNet** and `[MemoryDiagnoser]`, which reports allocated bytes and Gen 0/1/2 counts per operation, and profile allocations with `dotnet-trace`/PerfView before optimising. Then apply this work **only in hot paths** — allocation-free code is harder to read and maintain, and in a request handler that runs twice a day it buys nothing. That judgement — knowing where this effort pays and where it is waste — is what distinguishes an architect from an enthusiast.

---

## Q26. How do serialization choices affect performance?

Serialisation sits on **every** network boundary, so its cost is multiplied by every call in the system — and it affects CPU, allocations, payload size, network cost and schema evolution simultaneously.

| Format | Size (relative) | Speed | Human-readable | Schema | Typical use |
|---|---|---|---|---|---|
| **JSON** | 1.0× (baseline) | Moderate | **Yes** | Optional (JSON Schema) | Public APIs, debuggability |
| **MessagePack** | ~0.5× | Fast | No | Optional | Internal services, caches |
| **Protobuf** | ~0.3× | **Very fast** | No | **Required, strongly typed** | **gRPC**, internal contracts |
| **Avro** | ~0.3× | Very fast | No | **Required, registry-backed** | **Kafka**, data pipelines |
| **XML/SOAP** | ~2× | Slow | Yes | XSD | Legacy, some banking interfaces |

**What the choice actually changes:**

1. **CPU per request.** Serialisation is frequently 10–30 % of CPU in a chatty microservices system. Binary formats with generated code (Protobuf, Avro, MessagePack) avoid reflection entirely.
2. **Allocations.** Reflection-based JSON allocates heavily; **source-generated `System.Text.Json`** avoids most of it. Serialising directly to a `PipeWriter` avoids intermediate strings and byte arrays.
3. **Payload size → network and cost.** A 3× smaller payload means 3× less bandwidth, less cross-AZ transfer charge (a real AWS line item), smaller Kafka batches on disk and in replication, and lower serialisation cost at both ends.
4. **Schema evolution.** This is the architectural consideration, not the performance one, and it usually dominates the decision: Protobuf and Avro give you enforced forward/backward compatibility (via field numbers and a schema registry); JSON gives you convention and hope. In an event-driven platform where producers and consumers deploy independently, that enforcement is worth more than the speed.

**Practical guidance:**
- **Public/partner APIs → JSON.** Debuggability, tooling and universal client support outweigh the bytes. Use `System.Text.Json` with source generators, not `Newtonsoft.Json`, in hot paths.
- **Internal service-to-service → gRPC/Protobuf** where the call volume is high and the contract is stable. Note the trade-off from Module 10 Q6: gRPC's long-lived HTTP/2 connections break Kubernetes L4 load balancing, so you need client-side load balancing or a mesh.
- **Kafka events → Avro or Protobuf with a Schema Registry.** Compression (`lz4`) then compounds the saving.
- **Cache values → MessagePack or Protobuf.** Redis stores bytes; smaller values mean more cache in the same memory and faster network round trips.

**The measurement to cite rather than assert:** benchmark with your **actual payloads**. Format comparisons on a 3-field object are meaningless; the differences appear on realistic documents with nested collections. And check the **whole** cost — a format that serialises 2× faster but produces a 2× larger payload is a wash on a network-bound service and a loss on a cross-AZ one.

**The caution:** don't optimise serialisation before it is the bottleneck. If a request spends 200 ms in the database and 2 ms serialising, switching to Protobuf saves 1 ms and costs you readable logs, easier debugging and a schema toolchain. Fix the database.

---

## Q27. How do retries affect performance?

Retries improve **success rate** for transient faults and can catastrophically damage **stability** — this is one of the most important trade-offs in distributed systems, and the AWS Builders' Library article on timeouts, retries and backoff is the canonical reference.

**The mechanism of harm — retry amplification:**

```
Service A → B → C.  Each layer retries 3×.
C degrades and starts timing out.
  A's 1 request → 3 attempts at B → 9 attempts at C
A struggling service receives 9× its normal load, precisely when it can least handle it.
```
With four layers it is 81×. **Retries turn a partial degradation into a total outage** — the failing service can never recover because the retry load keeps it saturated. This is the *retry storm*, and it is one of the most common causes of a small incident becoming a large one.

**The specific costs:**
- **Latency multiplies.** A request with a 5-second timeout and 3 retries can take 15+ seconds — often long after the caller has given up, so the work is pure waste.
- **Resource occupation.** Each in-flight retry holds a thread, a connection and memory in *every* service in the chain.
- **Load amplification** as above.
- **Duplicate side effects** if the operation is not idempotent — and in payments, a retried authorisation without an idempotency key is a double charge.

**How to retry safely — the full set, because a partial answer here is a red flag:**

1. **Only retry retryable errors.** 5xx, 429, timeouts, connection failures. **Never retry 4xx** (400, 401, 403, 404, 422) — the request is wrong and will stay wrong; retrying is pure waste (Module 5).
2. **Exponential backoff with jitter.** Backoff alone still synchronises clients into waves; **jitter decorrelates them**. AWS specifically recommends full jitter: `sleep = random(0, min(cap, base × 2^attempt))`.
3. **Cap the attempts** — 2–3 for a synchronous request path. Deep retry chains belong in asynchronous processing, not in a user-facing call.
4. **Retry at ONE layer only.** This is the fix for amplification, and it is the point most candidates miss. Retry at the edge or in the client library, not at every hop. If every layer retries, you have multiplied, not added.
5. **Combine with a circuit breaker.** After N consecutive failures, stop calling entirely for a cooldown period. The breaker is what prevents the storm — retries handle *transient* faults; the breaker handles *sustained* ones, and confusing the two is how outages get extended.
6. **Add a retry budget / token bucket.** Allow retries to be at most ~10 % of total requests. When the budget is exhausted, fail fast. This bounds amplification even when everything else is misconfigured.
7. **Idempotency keys** on anything that mutates state, so a retry is safe by construction.
8. **Timeouts must be shorter as you go deeper** so an inner call cannot outlive its caller's patience.

**In .NET**, this is `Microsoft.Extensions.Http.Resilience` / Polly:
```csharp
builder.Services.AddHttpClient<PaymentClient>()
    .AddStandardResilienceHandler(o => {
        o.Retry.MaxRetryAttempts = 3;
        o.Retry.BackoffType = DelayBackoffType.Exponential;
        o.Retry.UseJitter = true;
        o.CircuitBreaker.FailureRatio = 0.5;
        o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(2);
        o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(10);
    });
```

**The summary line:** *retries are a load multiplier aimed at a system that is already struggling.* They are correct for transient, independent faults and actively harmful for systematic ones — so bound them, jitter them, budget them, apply them at one layer, and put a circuit breaker in front.

---

## Q28. How does backpressure improve stability?

**Backpressure is the mechanism by which a system signals "I cannot accept more work right now" and the producer slows down.** Without it, a system under overload accepts work it cannot complete, queues grow without bound, latency climbs past every timeout, memory fills, and the system collapses — having done *no* useful work in the process.

**What happens without backpressure — the collapse curve:**

```
throughput
    │        ╭──────╮
    │      ╭─╯      ╰──╮          ← the "knee"; past it, throughput FALLS
    │    ╭─╯           ╰────╮        because time goes to queueing,
    │  ╭─╯                  ╰───     context switching and timed-out work
    └──────────────────────────── offered load
```
The pathology: every request is accepted, queues to a 30-second wait, the client times out at 5 seconds and retries — so the server completes work **nobody is waiting for any more**, while the retry adds new load. Goodput approaches zero while utilisation is 100 %.

**With backpressure, the curve flattens instead of collapsing:** excess load is rejected **immediately and cheaply** (a 429 costs microseconds), so the accepted load is served at normal latency. **Partial success beats total failure**, and fast rejection lets the client do something sensible (back off, degrade, queue, tell the user).

**How to implement it, layer by layer:**

| Layer | Mechanism |
|---|---|
| **Ingress** | Rate limiting (ASP.NET Core `AddRateLimiter` — fixed/sliding window, token bucket, **concurrency limiter**), API Gateway throttling, WAF rate rules |
| **Application** | Bounded queues — `Channel<T>` with `BoundedChannelFullMode.Wait` or `.DropWrite`; `SemaphoreSlim` around a scarce resource; `Parallel.ForEachAsync` with `MaxDegreeOfParallelism` |
| **Consumer (Kafka/SQS)** | `max.poll.records`, prefetch limits, bounded worker pools — **the queue itself is the backpressure**, which is why queues are stabilising |
| **Database** | Connection-pool max size **is** backpressure — but it must fail fast, not queue for 30 s |
| **Between services** | gRPC/HTTP2 flow control, TCP windowing, 429 with `Retry-After` |
| **Client** | Honour 429/`Retry-After`; circuit breaker; adaptive concurrency |

```csharp
// Bounded channel: the producer awaits when full — genuine backpressure
var channel = Channel.CreateBounded<PaymentEvent>(new BoundedChannelOptions(10_000)
{
    FullMode = BoundedChannelFullMode.Wait   // or DropWrite to shed, deliberately
});
```

**The design principles that make it work:**
1. **Bound every queue.** An unbounded queue is not a buffer, it is a deferred out-of-memory error. This is the single most important rule.
2. **Reject early and cheaply.** Rejecting at the edge costs nothing; rejecting after the database call has already been made costs everything.
3. **Shed the least valuable load first.** Prioritise: payment authorisations over analytics queries; paying customers over free tier; interactive over batch.
4. **Make rejection actionable** — 429 with `Retry-After`, not 500. A 500 tells the client to panic; a 429 tells it exactly what to do.
5. **Degrade gracefully** rather than failing: serve stale cache, skip the recommendations panel, defer non-essential work to a queue.

**The framing for a panel:** *backpressure converts an unbounded failure into a bounded one.* It is the difference between a system that serves 2,000 RPS well and rejects the excess, and one that accepts 5,000 RPS and serves none of them. In a payments platform it is also a correctness property — a request rejected with 429 has an unambiguous outcome, whereas a request that times out mid-flight leaves a payment in an unknown state that someone has to reconcile.

---

## Q29. What tools do you use for performance testing?

Grouped by what they answer, because "which tool" is really "which question".

**Load generation:**

| Tool | Strengths |
|---|---|
| **k6** | JavaScript scripting, **CI-native**, thresholds as pass/fail gates, open-model load generation (avoids coordinated omission), good cloud/distributed story. My default. |
| **NBomber** | **.NET-native** — write scenarios in C#, reuse your own clients and models |
| **Gatling** | Scala DSL, excellent reports, strong for complex user journeys |
| **JMeter** | Mature, huge plugin ecosystem, GUI; heavier and thread-per-user by default |
| **Locust** | Python, easy distributed mode |
| **`wrk2`** | Constant-throughput HTTP with **coordinated-omission-corrected** latency |
| **AWS Distributed Load Testing / Azure Load Testing** | Driving genuinely large load from many sources without building the harness |

**Profiling (.NET):**

| Tool | Use |
|---|---|
| **`dotnet-counters`** | Live counters — GC, thread pool, exceptions, request rate. First thing to run |
| **`dotnet-trace`** | CPU sampling and event traces → flame graph |
| **`dotnet-gcdump` / `dotnet-dump`** | Heap contents; what is retained and by what |
| **`dotnet-stack`** | Thread stacks — for hangs and deadlocks |
| **`dotnet-monitor`** | Production sidecar: on-demand dumps, traces, metrics over HTTP |
| **PerfView** | Deep ETW analysis, GC and JIT detail |
| **Visual Studio / JetBrains dotTrace, dotMemory** | Interactive profiling and allocation attribution |
| **BenchmarkDotNet** | Rigorous micro-benchmarks with `[MemoryDiagnoser]` — the *only* correct way to compare two implementations |

**Database:** SQL Server Query Store and Extended Events; PostgreSQL `pg_stat_statements`, `auto_explain`, `EXPLAIN (ANALYZE, BUFFERS)`; **RDS Performance Insights**; MiniProfiler and EF Core statement logging on the application side.

**Observability in production** — which is where the real answers are:
- **OpenTelemetry** instrumentation → traces, metrics, logs, correlated by trace ID.
- **Prometheus/Grafana**, **CloudWatch** (Application Signals, SLOs), **Jaeger/Tempo/X-Ray** for traces.
- **Continuous profiling** — Pyroscope, Parca, or Datadog/Dynatrace — a genuinely underrated capability: profile production continuously and compare flame graphs across releases.
- **Synthetic monitoring** (CloudWatch Synthetics canaries) to measure the user path from outside.

**The point I'd make about tooling:** the tool matters far less than **testing with realistic data and a realistic traffic shape**. Uniform random keys against an empty database will pass every test and tell you nothing — no cache-miss behaviour, no hot partitions, no index pressure, no lock contention. Reproduce production's data volume, key distribution and concurrency, or the numbers are theatre.

**And put it in CI.** A k6 smoke test with a `p(95) < 200ms` threshold on every pull request catches regressions in the change that caused them, when the context is fresh and the fix is cheap — which is worth more than any amount of pre-release load testing.

---

## Q30. How would you design a 2,000+ RPS API?

**First, size the problem honestly** — this framing earns credit immediately, because it shows you know when *not* to over-engineer.

```
2,000 RPS × 86,400 s = 173 million requests/day
Per instance at 250 RPS  → 8 instances minimum
At 60 % target utilisation → 14 instances
N+1 across 3 AZs          → ~21 instances
Little's Law: L = 2,000 × 0.1 s = 200 concurrent requests in flight
```
**2,000 RPS is a moderate load for modern .NET.** Kestrel handles tens of thousands of requests per second per instance on trivial work; the real constraint is what each request *does* — and it is almost always the database. Saying this prevents the classic mistake of designing a Kafka-and-CQRS cathedral for a load that a well-built three-tier service handles comfortably.

**The design:**

**1. Edge.** CloudFront (cache static and cacheable responses at the edge — every cache hit is a request your origin never sees) → WAF → ALB across 3 AZs.

**2. Application tier.** ASP.NET Core on ECS Fargate or EKS, **stateless**, 21 instances across 3 AZs, HPA on **RPS or concurrency** rather than CPU (Module 10 Q19), `maxUnavailable: 0` rollouts, readiness-gated traffic. Async all the way down — no sync-over-async anywhere in the request path.

**3. Data.** Aurora PostgreSQL Multi-AZ: **writer** for all writes and read-your-own-writes; **2–3 readers** for queries that tolerate replica lag. **RDS Proxy** in front so 21 instances × 50 pool size doesn't exceed the connection limit. Indexes derived from the actual query workload; no N+1; projections rather than whole entities; keyset pagination.

**4. Caching — the single biggest lever at this scale.** ElastiCache Redis (cluster mode, Multi-AZ) plus in-process `HybridCache` for the hottest reference data. Cache reference data (merchant config, FX rates, BIN ranges) aggressively; **never** cache balances or transaction state. Jittered TTLs, stampede protection, cache warming on startup.

**5. Asynchrony.** Anything not needed for the response goes to **SQS/Kafka** — notifications, audit writes, analytics, webhook delivery, reporting projections. Shrinking the synchronous path is how you cut p99 without adding hardware.

**6. Resilience.** Timeouts everywhere (shorter as you go deeper), retries **at one layer** with jitter and a budget, circuit breakers on every external dependency, bulkheads isolating the payment provider from everything else, and rate limiting/backpressure at the edge.

**7. Observability.** OpenTelemetry traces with correlation IDs, RED metrics per endpoint, SLOs with burn-rate alerts, continuous profiling, and a k6 load test in CI with a latency threshold.

**8. Verify.** Load test at 2× target; stress test to find the knee and confirm it degrades with 429s rather than 500s; spike test to check autoscaling keeps up; soak test for 24 hours to catch leaks.

**Where the bottleneck will actually be** — and naming this is the answer: **the database**. At 2,000 RPS with, say, 5 queries per request, that is 10,000 QPS — well past what a single Aurora writer handles for anything non-trivial. The work is therefore: **reduce queries per request** (batch, project, cache), **move reads to replicas**, and **move writes off the hot path** (queue + async processing). Adding application instances is the easy 10 % of this design; the database strategy is the other 90 %.

---

## Q31. How would you design a 10K+ RPS system?

At 10,000+ RPS the arithmetic changes qualitatively: **864 million requests/day**, and a single relational writer is no longer sufficient for the write path. This is where genuinely distributed design becomes necessary rather than fashionable.

```
10,000 RPS, p99 target 100 ms
Little's Law: L = 10,000 × 0.1 = 1,000 concurrent requests in flight
At 400 RPS/instance → 25 instances; at 60 % util → 42; N+1 across 3 AZs → ~63 instances
```

**What must change relative to Q30:**

**1. Push work to the edge.** CloudFront with an aggressive cache policy, and **CloudFront Functions** for auth-token validation, redirects and A/B routing at the PoP. Every request served at the edge is one the origin never pays for. For a read-heavy API, a 70 % edge hit rate turns 10,000 RPS into 3,000 at the origin — the cheapest 3× you will ever get.

**2. Partition/shard the write path.** One relational primary cannot absorb this write rate. Options, in order of preference:
- **Shard by a natural key** (merchant, account, tenant) so each shard is an independent Aurora cluster. Choose the key so that transactions are single-shard — cross-shard transactions are what makes sharding painful.
- **Move high-volume writes to DynamoDB** (idempotency keys, event/audit sinks, session and device state) where the access pattern is key-based; keep the ledger relational.
- **Write behind a log**: accept to Kafka, acknowledge, and apply asynchronously. This converts a synchronous write bottleneck into a throughput problem the log is designed for — at the cost of eventual consistency, which must be an explicit product decision.

**3. CQRS with materialised read models.** Separate the write model (normalised, ACID, correctness-critical) from read models (denormalised, purpose-built per query, in DynamoDB/OpenSearch/Redis), kept in sync via events from an **outbox**. Reads then never touch the write database, and each read model is independently scalable.

**4. Multi-layer caching with high hit rates.** Edge (CloudFront) → in-process (`HybridCache`) → distributed (Redis cluster). At this scale, a cache hit-rate improvement from 90 % to 95 % **halves** origin load — hit rate is a first-class metric with its own alert.

**5. Asynchronous by default.** The synchronous path does the minimum required to give a correct answer; everything else is an event. Kafka/MSK as the backbone, partitioned for parallelism, with consumers sized by Little's Law.

**6. Connection strategy.** RDS Proxy or PgBouncer is now mandatory — 63 instances cannot each hold a pool against a database's connection limit. DynamoDB and SQS avoid the problem entirely by being HTTP-based, which is part of why they suit this scale.

**7. Backpressure and load shedding as first-class design** (Q28), with priority tiers so that if you must shed, you shed analytics before authorisations.

**8. Cost engineering becomes an architecture driver.** At 864 million requests/day, a 1 ms CPU saving per request is real money; so is the choice between API Gateway ($1–3.50/million → **$864–3,000/day**) and an ALB, or between cross-AZ chatter and AZ-aware routing. Graviton instances, right-sized containers, Savings Plans, S3 lifecycle policies, and VPC endpoints instead of NAT all move the needle at this volume. Design reviews should include cost-per-transaction alongside latency.

**9. Data tiering.** Hot data in Redis/DynamoDB, warm in Aurora, cold in S3 with Athena/Glue for analytics. Keeping 5 years of transactions in the OLTP database is both a cost and a performance problem.

**The honest caveats to state, because they demonstrate judgement:**

- **10,000 RPS is not inherently hard; 10,000 RPS of *complex, transactional, correctness-critical* work is.** A read-heavy API at 10K RPS is largely a caching and CDN exercise. Ten thousand payment authorisations per second is a different system entirely — and worth noting that most real payment platforms peak in the **hundreds** of TPS, where the design driver is correctness and auditability rather than throughput (which is exactly the conclusion the *Designing a Payment System* case study reaches).
- **Every one of these techniques adds complexity, failure modes and operational cost.** Sharding, CQRS and event-driven writes buy scale and charge you in eventual consistency, debugging difficulty and reconciliation work. Adopt them when the numbers demand it — and be able to say what the number was.
- **Measure before assuming.** The bottleneck at 10K RPS is rarely where the design document says it is.

---

## References — official documentation

| Topic | Source |
|---|---|
| .NET — Fundamentals of garbage collection (generations, LOH, conditions) | https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/fundamentals |
| .NET — Large object heap | https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/large-object-heap |
| .NET — Workstation vs server GC | https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/workstation-server-gc |
| .NET — GC runtime configuration options (heap hard limit, DATAS) | https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector |
| .NET — Memory and span usage guidelines | https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines |
| .NET — `ArrayPool<T>` | https://learn.microsoft.com/en-us/dotnet/api/system.buffers.arraypool-1 |
| .NET — System.IO.Pipelines | https://learn.microsoft.com/en-us/dotnet/standard/io/pipelines |
| .NET — diagnostic tools (`dotnet-counters`, `dotnet-trace`, `dotnet-gcdump`, `dotnet-dump`) | https://learn.microsoft.com/en-us/dotnet/core/diagnostics/ |
| .NET — dotnet-monitor | https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-monitor |
| .NET — well-known EventCounters | https://learn.microsoft.com/en-us/dotnet/core/diagnostics/available-counters |
| ASP.NET Core — performance best practices | https://learn.microsoft.com/en-us/aspnet/core/performance/performance-best-practices |
| ASP.NET Core — caching overview & HybridCache | https://learn.microsoft.com/en-us/aspnet/core/performance/caching/hybrid |
| ASP.NET Core — rate limiting middleware | https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit |
| .NET — resilience (Polly / `Microsoft.Extensions.Http.Resilience`) | https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience |
| EF Core — performance overview | https://learn.microsoft.com/en-us/ef/core/performance/ |
| EF Core — efficient querying (indexes, projection, N+1, split queries, buffering) | https://learn.microsoft.com/en-us/ef/core/performance/efficient-querying |
| EF Core — tracking vs no-tracking queries | https://learn.microsoft.com/en-us/ef/core/querying/tracking |
| EF Core — single vs split queries | https://learn.microsoft.com/en-us/ef/core/querying/single-split-queries |
| EF Core — pagination (keyset) | https://learn.microsoft.com/en-us/ef/core/querying/pagination |
| EF Core — efficient updating & `ExecuteUpdate`/`ExecuteDelete` | https://learn.microsoft.com/en-us/ef/core/performance/efficient-updating |
| EF Core — performance diagnosis | https://learn.microsoft.com/en-us/ef/core/performance/performance-diagnosis |
| ADO.NET — SQL Server connection pooling | https://learn.microsoft.com/en-us/dotnet/framework/data/adonet/sql-server-connection-pooling |
| Npgsql — connection string parameters / pooling | https://www.npgsql.org/doc/connection-string-parameters.html |
| SQL Server — Query Store | https://learn.microsoft.com/en-us/sql/relational-databases/performance/monitoring-performance-by-using-the-query-store |
| SQL Server — execution plans | https://learn.microsoft.com/en-us/sql/relational-databases/performance/execution-plans |
| PostgreSQL — EXPLAIN and using EXPLAIN | https://www.postgresql.org/docs/current/using-explain.html |
| PostgreSQL — `pg_stat_statements` | https://www.postgresql.org/docs/current/pgstatstatements.html |
| PostgreSQL — index types and usage | https://www.postgresql.org/docs/current/indexes.html |
| Apache Kafka — producer configuration | https://kafka.apache.org/documentation/#producerconfigs |
| Apache Kafka — consumer configuration | https://kafka.apache.org/documentation/#consumerconfigs |
| Apache Kafka — design & performance | https://kafka.apache.org/documentation/#design |
| AWS Well-Architected — Performance Efficiency pillar | https://docs.aws.amazon.com/wellarchitected/latest/performance-efficiency-pillar/welcome.html |
| AWS Builders' Library — Timeouts, retries and backoff with jitter | https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/ |
| AWS Builders' Library — Using load shedding to avoid overload | https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/ |
| AWS Builders' Library — Caching challenges and strategies | https://aws.amazon.com/builders-library/caching-challenges-and-strategies/ |
| AWS — Amazon RDS Performance Insights | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PerfInsights.html |
| AWS — Amazon RDS Proxy | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html |
| AWS — ElastiCache best practices | https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/BestPractices.html |
| BenchmarkDotNet documentation | https://benchmarkdotnet.org/articles/overview.html |
| k6 documentation | https://grafana.com/docs/k6/latest/ |
| OpenTelemetry — .NET | https://opentelemetry.io/docs/languages/net/ |
| Little's Law (original result) | J.D.C. Little, *A Proof for the Queuing Formula L = λW*, Operations Research, 1961 |
| The Tail at Scale (Dean & Barroso) | https://research.google/pubs/the-tail-at-scale/ |

---

**Previous:** [10 — Kubernetes](./10-Kubernetes.md) | **Next:** [12 — Architecture Patterns](./12-Architecture-Patterns.md)
