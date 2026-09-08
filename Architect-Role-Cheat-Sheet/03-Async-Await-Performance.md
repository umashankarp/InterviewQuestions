# 3. Async/Await & Performance — 20 Questions (Answered)

> Role lens: **Solution / Technical Architect**. Async is not about speed — it is about *scalability under concurrency*. Every answer below should make that distinction visible.

---

## Q1. How does async/await work internally?

**It is a compiler transformation into a state machine — there is no thread magic.**

When the compiler sees `async`, it rewrites the method into a struct implementing `IAsyncStateMachine`:

```csharp
public async Task<decimal> GetBalanceAsync(Guid id)
{
    var acct = await _repo.FindAsync(id);      // suspension point 1
    var rate = await _fx.GetRateAsync(acct.Currency);  // suspension point 2
    return acct.Balance * rate;
}
```

becomes, conceptually:

```csharp
struct StateMachine : IAsyncStateMachine
{
    public int _state;                 // -1 = running, 0..n = awaiting the nth await
    public AsyncTaskMethodBuilder<decimal> _builder;
    public Guid id; public Account acct; public decimal rate;   // locals become FIELDS
    private TaskAwaiter<Account> _awaiter1;

    public void MoveNext()
    {
        switch (_state)
        {
            case -1:
                _awaiter1 = _repo.FindAsync(id).GetAwaiter();
                if (!_awaiter1.IsCompleted)                       // fast path: already done? don't suspend
                {
                    _state = 0;
                    _builder.AwaitUnsafeOnCompleted(ref _awaiter1, ref this);  // register continuation, RETURN
                    return;                                        // <-- the calling thread is released here
                }
                goto case 0;
            case 0:
                acct = _awaiter1.GetResult();                      // rethrows exception if faulted
                ...
        }
    }
}
```

**The five things to say:**

1. **Locals become fields**, so state survives suspension. This is why the state machine is heap-allocated *only when it actually suspends* (the builder boxes the struct at that point) — a fully-synchronous async method allocates nothing on modern .NET.
2. **`await` means "register a continuation and return".** The calling thread goes back to the thread pool and serves other requests. **No thread is blocked waiting for the I/O.**
3. **The I/O itself is threadless.** The OS completes it via an I/O completion port; a thread-pool thread is only borrowed to run the continuation when the data arrives. This is the entire scalability story: 10,000 concurrent awaited HTTP calls ≠ 10,000 threads.
4. **The awaiter pattern is duck-typed.** Anything exposing `GetAwaiter()` returning `INotifyCompletion` + `IsCompleted` + `GetResult()` is awaitable — which is how `ValueTask`, `Task`, `YieldAwaitable`, and custom awaitables all work.
5. **Continuations resume on the captured `SynchronizationContext`/`TaskScheduler`** — except in ASP.NET Core, which has **no `SynchronizationContext`**, so continuations run on any thread-pool thread. That is why `ConfigureAwait(false)` is unnecessary in ASP.NET Core app code but still matters in libraries (which may be consumed by WPF/WinForms/legacy ASP.NET, where it prevents deadlocks).

**Exceptions:** an exception inside an async method is captured into the returned `Task` and rethrown at `await` (with the stack trace preserved via `ExceptionDispatchInfo`). Exception: `async void` — the exception is posted to the `SynchronizationContext` or the thread pool and **crashes the process**.

---

## Q2. What is a `Task`?

A `Task` is a **promise/future**: an object representing an operation that will complete in the future, carrying its state (`WaitingForActivation`, `Running`, `RanToCompletion`, `Faulted`, `Canceled`), its result (`Task<T>`), its exception (`AggregateException`), and its continuation list.

**Key clarification for interviews:** *a `Task` is not a thread and does not imply one.*

- A `Task` returned from `HttpClient.GetAsync` represents **I/O in flight** — no thread is associated with it at all while it is pending.
- A `Task` returned from `Task.Run` represents **queued work for a thread-pool thread**.

Both are the same type; the difference is who completes them.

**Related types:**
- **`ValueTask`/`ValueTask<T>`** — a struct that either holds a result synchronously or wraps a `Task`. Use it when a method **usually completes synchronously** on a **hot path** (cache hits, buffered stream reads). Rules: await it exactly once, never `.Result` on an incomplete one, never store it, never await it concurrently. Use `Task` by default; `ValueTask` is an optimisation with sharp edges.
- **`TaskCompletionSource<T>`** — the manual way to create a `Task` you complete yourself; the bridge from event-based/callback APIs to async. **Always construct with `TaskCreationOptions.RunContinuationsAsynchronously`**, or the completing thread runs the continuations inline, which causes surprising deadlocks and latency in a message-pump.
- **`Task.CompletedTask` / `Task.FromResult`** — allocation-free/cheap returns for synchronous paths.

---

## Q3. `Task` vs `Thread`?

| | `Thread` | `Task` |
|---|---|---|
| Abstraction level | OS thread (1 MB stack, kernel object) | A unit of work / promise |
| Cost | ~1 MB stack + kernel scheduling; expensive to create | Object allocation; may not use a thread at all |
| Pooling | No (you create and destroy) | Yes, via the thread pool |
| Return value | None (must use shared state) | `Task<T>` |
| Exceptions | Crash the process if unhandled | Captured on the Task, rethrown at await |
| Cancellation | `Abort` (removed/unsafe) or manual flags | `CancellationToken`, cooperative |
| Composition | Manual (`Join`, events) | `WhenAll`, `WhenAny`, continuations, `await` |

**When you would still use a raw `Thread`:** a dedicated, long-running, blocking loop that you do not want to occupy a pool thread — a Kafka consumer poll loop, a serial-port reader, a real-time market-data feed handler needing a specific priority or a bigger stack. Even then, `Task.Factory.StartNew(..., TaskCreationOptions.LongRunning)` gives you a dedicated thread with better integration.

**The architect framing:** *threads are a scarce, expensive OS resource; tasks are a cheap, composable scheduling abstraction over them. Modern server code should almost never create threads — it should stop blocking them.*

---

## Q4. `Task.Run()` — when should you use it?

**Use it to move CPU-bound work off the current thread.** That's it.

```csharp
// Legitimate: expensive pure computation (risk pricing, PDF render, large sort)
var var95 = await Task.Run(() => MonteCarloVaR(portfolio, 1_000_000), ct);
```

**Do NOT use it to "make things async":**

```csharp
// WRONG — wraps blocking I/O; now you burn a thread AND pay scheduling overhead
var data = await Task.Run(() => File.ReadAllText(path));      // use File.ReadAllTextAsync
var rows = await Task.Run(() => db.Query("SELECT ..."));      // use the async ADO/EF API
```

Wrapping sync-over-blocking in `Task.Run` is called **"async over sync"** — it makes the *caller* non-blocking by moving the blocking to a pool thread. Net thread consumption is unchanged (actually worse), so it does not improve server scalability. It is only appropriate when no async API exists and you must not block the request thread — and even then it should be flagged as debt.

**In ASP.NET Core specifically:** the request is already on a thread-pool thread. `Task.Run` for CPU work inside a request just moves work from one pool thread to another and adds a context switch — it gains nothing for throughput. It is useful for *offloading long CPU work so the request thread can... do nothing else*, which is not a thing. The real answer for heavy CPU work in a web app: **do it out of band** (queue → worker) or dedicate a separate service/instance pool for it, so a CPU spike doesn't starve latency-sensitive endpoints.

**Fire-and-forget (`_ = Task.Run(...)` without awaiting) is a production hazard:** no error handling (unobserved exceptions), no shutdown coordination (killed mid-flight), no backpressure. If you need background work, use `IHostedService`/`BackgroundService` with a bounded `Channel<T>`, or a real queue.

---

## Q5. What happens when you use `.Result` or `.Wait()`?

**Three separate harms:**

**1. Deadlock (in contexts with a `SynchronizationContext`).** Legacy ASP.NET, WPF, WinForms:
```csharp
// UI or classic ASP.NET thread
var result = GetDataAsync().Result;   // blocks the context thread
// inside GetDataAsync, after await, the continuation tries to POST back to that same
// single-threaded context — which is blocked waiting for the task → deadlock forever.
```
ASP.NET Core has no `SynchronizationContext`, so this specific deadlock does not occur there — but the other two harms do, and they are worse at scale.

**2. Thread-pool starvation.** Blocking a pool thread means it cannot serve another request. Under load, every incoming request blocks another thread; the pool injects new threads slowly (roughly one or two per second beyond the minimum after a brief hill-climbing phase), so latency explodes and the service appears hung while CPU sits near idle. This is the classic "the service died but CPU is 5 %" incident.

**3. Exception semantics change.** `.Result`/`.Wait()` throw `AggregateException` wrapping the real exception; `await` unwraps it. Catch blocks written for the real exception type silently stop matching.

**The rule:** **async all the way down.** If a synchronous entry point genuinely cannot be avoided (a legacy interface, `Main` pre-C# 7.1, a constructor), isolate it, document it, and prefer `GetAwaiter().GetResult()` over `.Result` (it at least unwraps the exception) — while treating it as a defect to be removed.

**Interview follow-up: "How do you detect this in production?"** — thread-pool queue length and thread count climbing while CPU is flat; `dotnet-counters` `threadpool-queue-length` and `threadpool-thread-count`; a dump with `!threads` showing many threads in `WaitOne`/`Monitor.Wait` under `Task.Result` frames; and the `ThreadPool Starvation` detection in `dotnet-stack`/Visual Studio diagnostics.

---

## Q6. What is thread-pool starvation?

**Definition:** all thread-pool threads are blocked (not busy computing — *blocked*), so queued work items cannot run. New threads are injected only slowly by the pool's hill-climbing algorithm, so the backlog grows faster than capacity.

**Symptoms — memorise this signature:**
- Request latency climbs steeply, then requests time out.
- **CPU utilisation is LOW** (5–20 %) — the giveaway. A CPU-bound problem shows high CPU; starvation shows idle CPU with a growing queue.
- Thread count climbs steadily (~1–2/s) rather than jumping.
- Health checks start failing; the pod looks "hung".
- It gets dramatically worse at a load threshold — a cliff, not a curve.

**Causes:**
1. `.Result` / `.Wait()` / `GetAwaiter().GetResult()` on async code (the #1 cause).
2. Synchronous I/O in request paths (`Stream.Read`, `WebClient`, sync ADO.NET, `File.ReadAllText`).
3. `lock`/`Monitor`/`SemaphoreSlim.Wait()` (sync) held across I/O.
4. `Task.Run` used heavily to wrap blocking calls — consumes two threads per operation.
5. Long CPU-bound work on pool threads at high concurrency (legitimately busy, but same effect).
6. A dependency that has slowed down: a 50 ms DB call becoming 5 s multiplies in-flight blocked work 100×.

**Mitigations:**
- Fix the blocking (the only real fix).
- **`ThreadPool.SetMinThreads(n, n)`** raises the floor so the pool doesn't ramp slowly — a *mitigation for burst*, not a cure; it hides the bug and wastes memory if set absurdly high.
- Bound concurrency to dependencies (bulkheads, `SemaphoreSlim` with `WaitAsync`) so one slow dependency can't consume the whole pool.
- Timeouts on every outbound call so blocked work is bounded in time.

---

## Q7. How do you diagnose thread-pool starvation?

**Live, in order:**

1. **Counters:** `dotnet-counters monitor -p <pid> --counters System.Runtime`
   - `threadpool-thread-count` rising steadily
   - `threadpool-queue-length` > 0 and growing — **the definitive signal**
   - `threadpool-completed-items-count` rate flat or falling
   - CPU low at the same time
2. **Dump analysis:** `dotnet-dump collect -p <pid>` then
   ```
   dotnet-dump analyze core.dmp
   > clrstack -all          # or !threads
   > dumpasync              # shows pending async state machines
   ```
   Look for many threads with identical stacks parked in `Monitor.Wait`, `SemaphoreSlim.Wait`, `Task.Result`, `ManualResetEventSlim.Wait`, `Socket.Receive`. If 100 threads share one stack that includes `.GetResult()` under a sync frame, you have your answer and your line number.
3. **`dotnet-stack report`** for a quick live snapshot without a full dump.
4. **Traces:** `dotnet-trace collect --providers Microsoft-DotNETCore-SampleProfiler` and look at thread-pool events; the `ThreadPoolWorkerThreadAdjustment` events show the hill-climbing struggle.
5. **In-app detection:** a background timer that measures how long a trivial work item takes to get scheduled (`ThreadPool.QueueUserWorkItem` → measure delay). Export as a metric `threadpool_scheduling_delay_ms`. Rising delay = starvation, and it alerts before customers notice. I put this in every high-throughput service I own.

**Prevention as policy:** ban sync-over-async in code review with an analyzer (e.g. `Microsoft.VisualStudio.Threading.Analyzers` VSTHRD002/VSTHRD103), require async APIs at all layers, and load-test at 2–3× expected peak — starvation only appears under concurrency.

---

## Q8. Does async make an operation faster?

**No. A single operation under async is marginally *slower*** — you pay for the state machine, possible allocation, and a continuation dispatch/context switch.

**What async improves is *scalability and resource efficiency*:** a fixed number of threads can have a far larger number of operations in flight, because threads are not parked waiting on I/O.

**Concrete framing that lands well in interviews:**

> "A 100 ms database call takes 100 ms either way. Synchronously, one thread is unusable for that whole 100 ms. With 200 pool threads I top out around 2,000 requests/second and then queue. Asynchronously that thread serves other requests during the wait, so the same 200 threads can hold tens of thousands of concurrent calls; throughput is then bounded by the *database*, not by my thread count. Async didn't make the call faster — it stopped me wasting threads on waiting."

**Corollaries:**
- Async does **nothing** for CPU-bound work — the CPU is busy either way. `Task.Run` just moves it.
- Async can *improve p99 latency indirectly*, by preventing the queueing that blocking causes at high concurrency.
- Async has a real cost at very low concurrency — a console app doing one thing at a time gains nothing.
- Async **does** improve memory: threads cost ~1 MB of stack each; async state machines cost tens of bytes.

---

## Q9. How do you handle parallel async operations?

**Distinguish concurrency (multiple I/O in flight) from parallelism (multiple CPUs computing).**

**Concurrent I/O — `Task.WhenAll`:**
```csharp
var accountTask = _accounts.GetAsync(id, ct);
var limitsTask  = _limits.GetAsync(id, ct);
var fxTask      = _fx.GetRateAsync("USD", ct);

await Task.WhenAll(accountTask, limitsTask, fxTask);       // 3 calls overlap: total ≈ slowest, not sum
var decision = Decide(accountTask.Result, limitsTask.Result, fxTask.Result);  // safe: already completed
```

**Bounded concurrency over a collection — `Parallel.ForEachAsync` (.NET 6+), the modern default:**
```csharp
await Parallel.ForEachAsync(paymentIds,
    new ParallelOptions { MaxDegreeOfParallelism = 10, CancellationToken = ct },
    async (id, token) => await ProcessAsync(id, token));
```

**CPU-bound parallelism — PLINQ / `Parallel.For`:**
```csharp
var results = trades.AsParallel().WithDegreeOfParallelism(Environment.ProcessorCount)
                    .Select(Price).ToArray();
```

**Rules and traps:**
- **Never `Parallel.ForEach` with an `async` lambda** — `Parallel.ForEach` takes `Action`, so `async` becomes `async void`: it returns immediately, exceptions are lost, and you get uncontrolled concurrency. Use `Parallel.ForEachAsync`.
- **`Task.WhenAll` aggregates exceptions but `await` only rethrows the first.** To see all: `try { await whenAll; } catch { foreach (var e in task.Exception!.InnerExceptions) ... }`.
- **Don't share a `DbContext` across parallel tasks** — it is not thread-safe. One scope/context per parallel branch.
- **Watch downstream capacity.** Fanning 500 concurrent calls at a dependency that handles 50 is a self-inflicted DoS. Always bound (Q11) and honour the dependency's documented limits.
- **Preserve cancellation** through every branch.

---

## Q10. `Task.WhenAll()` vs sequential awaits?

**Sequential (`await a; await b; await c;`)** — total latency is the **sum**. Correct when operations are **dependent** (b needs a's result), when you need **ordering guarantees**, or when the downstream cannot take concurrency.

**`Task.WhenAll`** — total latency is the **maximum**. Correct when operations are **independent**.

```
Sequential:  [--A 80ms--][--B 120ms--][--C 60ms--]   → 260 ms
WhenAll:     [--A 80ms--]
             [--B 120ms------]                        → 120 ms
             [--C 60ms-]
```

**Critical detail: start the tasks before awaiting.**
```csharp
// This is still SEQUENTIAL — the await forces completion before the next call starts
var a = await GetAAsync(); var b = await GetBAsync();

// This is concurrent — both are in flight before either is awaited
var ta = GetAAsync(); var tb = GetBAsync();
await Task.WhenAll(ta, tb);
```

**When *not* to use `WhenAll`:**
- Unbounded fan-out (`WhenAll(ids.Select(ProcessAsync))` with 10,000 ids) — throttle instead.
- Where partial failure semantics matter: `WhenAll` waits for **all** even after one fails. If you need fail-fast, use `Task.WhenAny` on the work plus a cancellation, or bound with a `CancellationTokenSource` you cancel on first failure.
- Where a downstream enforces ordering or per-key serialisation.

**Related:** `Task.WhenAny` for first-response-wins (hedged requests, timeouts); .NET 9's `Task.WhenEach` for processing results as they complete rather than waiting for the whole set.

---

## Q11. How do you limit concurrency?

Four mechanisms, chosen by context:

**1. `SemaphoreSlim` — general-purpose async gate.**
```csharp
private readonly SemaphoreSlim _gate = new(initialCount: 10);

async Task<T> LimitedAsync(Func<Task<T>> work, CancellationToken ct)
{
    await _gate.WaitAsync(ct);              // WaitAsync, never Wait() — Wait() blocks a pool thread
    try { return await work(); }
    finally { _gate.Release(); }            // finally is mandatory, or you leak permits and deadlock
}
```

**2. `Parallel.ForEachAsync` with `MaxDegreeOfParallelism`** — the cleanest option for bounded iteration over a collection (Q9).

**3. `Channel<T>` + N consumers — the producer/consumer pipeline.** Best when work arrives continuously and you also want *backpressure*:
```csharp
var channel = Channel.CreateBounded<Payment>(new BoundedChannelOptions(1000)
{
    FullMode = BoundedChannelFullMode.Wait          // producer awaits when full → backpressure
});
var consumers = Enumerable.Range(0, 8).Select(_ => Task.Run(async () =>
{
    await foreach (var p in channel.Reader.ReadAllAsync(ct)) await ProcessAsync(p, ct);
})).ToArray();
```

**4. Platform-level:** Polly/`Microsoft.Extensions.Http.Resilience` **bulkhead (rate limiter) policy** per dependency, connection-pool limits (`MaxPoolSize`, `SocketsHttpHandler.MaxConnectionsPerServer`), Kafka `max.poll.records`, and the ASP.NET Core rate limiter for inbound.

**Architect's point:** concurrency limits should be **per-dependency**, not global — that is what makes them a bulkhead (§4 Q30). And every limit needs a *queue policy*: reject fast (429) or wait with a bounded queue. Unbounded queues turn an overload into an OOM.

---

## Q12. What is cancellation and how does `CancellationToken` work?

**Cooperative cancellation.** Nothing is forcibly aborted; the token is a signal that well-behaved code checks and honours.

**Mechanism:** `CancellationTokenSource` owns the state and hands out lightweight `CancellationToken` structs. `Cancel()` sets a flag and synchronously runs registered callbacks; awaiting operations complete as canceled (`OperationCanceledException`).

```csharp
public async Task<Quote> GetQuoteAsync(string symbol, CancellationToken ct)
{
    ct.ThrowIfCancellationRequested();                       // check before expensive work
    var resp = await _http.GetAsync(url, ct);                // pass it DOWN — this is the important part
    await using var s = await resp.Content.ReadAsStreamAsync(ct);
    return await JsonSerializer.DeserializeAsync<Quote>(s, cancellationToken: ct);
}
```

**Rules:**
- **Propagate the token to every async call.** A token that isn't passed down does nothing. This is the most common cancellation bug: the method accepts a `CancellationToken` and then never uses it.
- **`HttpContext.RequestAborted`** is the token for "client disconnected" in ASP.NET Core. Honouring it stops you doing work for a caller who has gone — meaningful savings at scale.
- **Linked tokens** combine sources: `CancellationTokenSource.CreateLinkedTokenSource(requestAborted, timeoutCts.Token)`. **Dispose the linked source** or you leak registrations (a real memory leak in long-lived scenarios).
- **`OperationCanceledException` is expected, not an error.** Don't log it as Error; don't count it in your error SLO; map to 499 or just let the connection close.
- **Cancellation is not rollback.** If a payment authorisation was already sent, cancelling the token does not un-send it. That is why cancellation must be paired with idempotency and compensation (§14).
- Long CPU loops must poll `ct.IsCancellationRequested` themselves; nothing does it for them.

---

## Q13. How do you implement timeouts?

**Every outbound call needs a timeout. "No timeout" is a decision to hang forever.**

**Preferred (.NET 8+) — `CancellationTokenSource` with timeout, linked to the request token:**
```csharp
using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
timeoutCts.CancelAfter(TimeSpan.FromSeconds(2));
try
{
    return await _gateway.AuthorizeAsync(req, timeoutCts.Token);
}
catch (OperationCanceledException) when (!ct.IsCancellationRequested)
{
    throw new TimeoutException("Gateway authorisation exceeded 2s");   // distinguish OUR timeout from caller cancel
}
```

**HTTP client level:**
```csharp
builder.Services.AddHttpClient<ISchemeClient, VisaClient>(c => c.Timeout = TimeSpan.FromSeconds(5))
    .AddStandardResilienceHandler(o =>
    {
        o.AttemptTimeout.Timeout      = TimeSpan.FromSeconds(2);   // per attempt
        o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(8);   // across all retries
        o.Retry.MaxRetryAttempts = 3;
        o.CircuitBreaker.FailureRatio = 0.5;
    });
```

**Design rules:**
- **Timeout budgets must decrease down the call chain.** If the client's timeout is 10 s, your service should time out downstream at, say, 3 s so you can retry or degrade *inside* the budget. Cascading equal timeouts produce simultaneous expiry everywhere and no useful behaviour.
- **Separate connect, read/attempt, and total timeouts.** A total timeout that doesn't account for retries is a lie.
- **Set timeouts everywhere, not just HTTP:** SQL `CommandTimeout`, Redis `syncTimeout`, Kafka `request.timeout.ms`/`max.poll.interval.ms`, gRPC deadlines (`CallOptions.Deadline` — and gRPC propagates deadlines across hops, which is a genuine advantage worth mentioning).
- **A timeout is not a failure verdict.** The remote side may have succeeded. This is exactly why timed-out non-idempotent operations must be retried with an idempotency key and reconciled — see §14 Q17/Q18.

---

## Q14. What is backpressure?

**Backpressure is a feedback signal from a slow consumer to a fast producer, telling it to slow down.** Without it, the fast side's excess work accumulates somewhere — a queue, a buffer, RAM — until the system fails, usually as an OOM or a latency collapse.

**Where it shows up in a .NET/microservices stack:**

| Layer | Backpressure mechanism |
|---|---|
| TCP | Receive window (flow control, built in) |
| `System.IO.Pipelines` | `PauseWriterThreshold`/`ResumeWriterThreshold` |
| `Channel<T>` | `BoundedChannelOptions` + `FullMode.Wait` — writer awaits |
| HTTP API | Rate limiting → **429 + `Retry-After`** (backpressure to clients) |
| Kafka | Consumer *pull* model + `max.poll.records`; lag is the visible signal |
| SQS/queues | Visibility timeout + bounded prefetch |
| Thread pool | (Anti-pattern) unbounded queue — no backpressure by default |
| Databases | Connection pool exhaustion → callers block (crude backpressure) |

```csharp
// Bounded channel: the producer is forced to wait — this IS backpressure
var ch = Channel.CreateBounded<Trade>(new BoundedChannelOptions(10_000)
{
    FullMode = BoundedChannelFullMode.Wait,
    SingleReader = false, SingleWriter = false
});
await ch.Writer.WriteAsync(trade, ct);      // suspends when full instead of growing memory
```

**Architect's framing:** *"Unbounded buffering is not resilience — it's deferred failure. Every queue in the design must have a bound and a documented behaviour when it hits that bound: block, shed, or spill."* Kafka is popular precisely because it makes the buffer explicit, durable and observable (consumer lag) instead of hiding it in RAM.

---

## Q15. How do you avoid unbounded concurrency?

**Concrete controls, applied at every boundary:**

1. **Inbound:** rate limiting (§1 Q17) and Kestrel's `MaxConcurrentConnections`; return 429/503 rather than accepting work you cannot do.
2. **Internal fan-out:** never `Task.WhenAll` over an unbounded collection; use `Parallel.ForEachAsync` with `MaxDegreeOfParallelism`, or a `SemaphoreSlim`, or a `Channel` with N workers.
3. **Outbound per dependency:** bulkhead/rate-limiter policies, `MaxConnectionsPerServer`, DB `Max Pool Size`. Each dependency gets its own budget so one cannot consume the whole app's capacity.
4. **Queues bounded, always.** `Channel.CreateBounded`, not `CreateUnbounded`. Choose `Wait` (backpressure), `DropOldest`/`DropWrite` (shed load) deliberately.
5. **Batch sizes bounded.** `max.poll.records`, SQS `MaxNumberOfMessages`, paging on every list endpoint (with a hard server-side max, not just a client-supplied `pageSize`).
6. **Timeouts** so in-flight work is bounded in *time* as well as count.
7. **Autoscaling with a ceiling** — HPA `maxReplicas` sized to what the database can take. Scaling the API tier without scaling (or protecting) the datastore just moves the queue to the datastore.

**The failure mode to describe:** a retry storm. Downstream slows → callers time out → callers retry → concurrency triples → downstream collapses → everything retries. Bounded concurrency + circuit breakers + jittered backoff is the standard cure (§4 Q28, §5 Q18).

---

## Q16. How do you optimize high-throughput APIs?

Ordered by real-world payoff:

1. **Remove blocking.** Async end-to-end; no `.Result`, no sync I/O. Without this, nothing else matters.
2. **Cut round-trips.** Batch DB calls, avoid N+1, co-locate chatty services or merge them, use `WhenAll` for independent calls, and prefer one composite endpoint over five chatty ones (or a BFF).
3. **Cache aggressively and correctly.** Output caching for public GETs, Redis for shared reference data, in-memory for tiny hot data. Cache hit ratio is usually the single biggest throughput lever.
4. **Cheapen serialization.** `System.Text.Json` **source-generated** context (no reflection, no runtime metadata), avoid re-serializing, consider MessagePack/Protobuf for internal hops, and stream large payloads (`IAsyncEnumerable`, `PipeWriter`).
5. **Reduce allocations.** Pooled buffers (`ArrayPool`, `RecyclableMemoryStream`), `Span`/`stackalloc` for parsing, `record struct` for small values, `[LoggerMessage]` source-generated logging, avoid LINQ and closures in the hottest loops. Target ~0 allocations per request on the hot path.
6. **Tune the data layer.** Right indexes, `AsNoTracking`, projections, compiled queries, read replicas for read-heavy endpoints, and connection pool sized to the DB's capacity — not higher.
7. **Right-size infrastructure.** Server GC, ReadyToRun, sensible CPU/memory requests/limits (CPU limits cause throttling — see §10 Q20), HTTP/2 between services, keep-alive tuned.
8. **Shed and shape load.** Rate limits, bulkheads, circuit breakers, priority queues for critical traffic.
9. **Move work off the request path.** 202 Accepted + async processing for anything the caller doesn't need synchronously. This is the biggest architectural lever of all.
10. **Prove it.** Load test to a stated target with p99 SLOs, profile the top three hotspots, iterate. Optimising without measurement is how teams spend a sprint on a 2 % gain.

---

## Q17. How do you diagnose high API latency?

**Method — always split the latency before you optimise anything.**

1. **Confirm the shape.** Is it all requests (systemic) or the tail (contention/GC/one hot key)? Look at p50 vs p95 vs p99. A high p50 is usually an inefficiency; a high p99 with a normal p50 is contention, GC, or a slow dependency subset.
2. **Split by endpoint and by dependency** using distributed tracing. A flame/waterfall view answers "is it us or them?" in seconds — this is exactly what tracing is for (§1 Q19).
3. **Check the queue.** Is the time spent *executing* or *waiting to be scheduled*? Thread-pool queue length, Kestrel connection queue, load-balancer surge queue, DB connection-pool wait time. Queueing latency looks identical to slowness from outside but has a completely different fix.
4. **Check dependencies:** DB (slow query store, execution plans, blocking/waits), cache (hit ratio collapse), downstream APIs (their p99), messaging (consumer lag).
5. **Check the runtime:** `% time in GC`, Gen2 rate, LOH growth, exception rate (exceptions are expensive — a high throw rate is a hidden latency source), lock contention (`Monitor Lock Contention Count`).
6. **Check the platform:** CPU throttling (cgroup `nr_throttled` — a container at its CPU limit shows latency with "low CPU"), noisy neighbours, network retransmits, DNS resolution latency, TLS handshake churn (connection pooling not working).
7. **Correlate with change.** Deploy markers, config changes, traffic mix shifts, data growth. Most latency regressions have a cause with a timestamp.

**Tooling:** OpenTelemetry traces, `dotnet-counters`, `dotnet-trace`/PerfView, application-level RED dashboards, DB Query Store / `pg_stat_statements`, and a continuous profiler (Datadog/Pyroscope) if available.

---

## Q18. How do you diagnose high CPU?

1. **Confirm it's your process** — `top`/Task Manager, container CPU vs node CPU, and whether it's user or system time. High *system* time suggests syscalls/network/GC or excessive context switching.
2. **Capture a profile:**
   ```
   dotnet-trace collect -p <pid> --profile cpu-sampling --duration 00:00:30
   ```
   Open in PerfView/Speedscope/Visual Studio → look at the top stacks by inclusive/exclusive time.
3. **Classify the pattern:**
   - **GC-dominated** (`clrgc` frames, high `% time in GC`) → allocation problem, not a compute problem. Fix allocations (Q25 §11).
   - **Serialization-dominated** → reflection-based JSON, large payloads → source generators, smaller DTOs.
   - **Regex** → catastrophic backtracking on user input (a genuine DoS vector — use `RegexOptions.NonBacktracking`, timeouts, or the source-generated `[GeneratedRegex]`).
   - **Exception-heavy** (`throw`/`EH` frames) → exceptions used for control flow; a throw costs microseconds *and* a stack walk.
   - **Lock contention** (`Monitor.Enter`, spin) → contended hot lock; reduce scope, shard, or use concurrent collections.
   - **Business logic hot loop** → algorithmic problem; look at complexity, not micro-optimisation.
   - **Encryption/compression** → expected; consider offloading (TLS termination at the LB, hardware acceleration).
4. **Check for infinite/tight loops** — a spin-wait, a `while(true)` without an await/delay, a retry loop with no backoff. These pin one core to 100 %.
5. **Correlate with load.** CPU proportional to RPS is capacity; CPU high at flat RPS is a regression or a pathological input.

**Fixes, in order:** algorithm → allocations → serialization → caching → parallelism → more hardware. Adding CPU first is the expensive answer to a design problem.

---

## Q19. How do you diagnose high memory?

1. **Establish which memory.** Working set vs managed heap vs native. `dotnet-counters` gives `gc-heap-size`, `gen-0/1/2-size`, `loh-size`, `poh-size`, and `working-set`. If working set ≫ managed heap → native leak (handles, native libs, `HttpClient` handlers, memory-mapped files).
2. **Growth pattern:**
   - **Sawtooth that returns to baseline** → healthy; just a high allocation rate.
   - **Monotonic rise** → leak (§2 Q17).
   - **Step increases** → caching or pooling filling up; check bounds.
   - **Spikes on specific endpoints** → large payload buffering, unbounded result sets, file uploads read into memory.
3. **Dump and diff.** `dotnet-dump collect` at two times → `dumpheap -stat` → compare top types → `gcroot` on a growing instance to find the retaining path.
4. **Common findings:** unbounded `MemoryCache` (no `SizeLimit`), static dictionaries, event handlers, retained `DbContext`, large `List<T>` from an unpaged query, `MemoryStream` per request, string concatenation in loops, LOH fragmentation.
5. **Container specifics:** the pod is OOMKilled at the **cgroup limit**, which may be far below what the GC thinks is available if limits aren't detected. Ensure `DOTNET_GCHeapHardLimitPercent` or rely on .NET's container awareness; set memory *requests* = *limits* for predictable behaviour; and remember the JIT, native libs and thread stacks live outside the managed heap.

**Fixes:** bound every cache (size + TTL), stream instead of buffer, page every query, pool large buffers, dispose properly, and set `<ServerGarbageCollection>` with `<ConcurrentGarbageCollection>` appropriately for the workload — Server GC uses more memory per core, which matters in small containers (consider Workstation GC for a 0.5-CPU sidecar-sized service).

---

## Q20. How would you design a 10K+ RPS .NET application?

**Start with the numbers, then the architecture.**

**Capacity arithmetic (show it — this is what separates Staff from Senior):**
- Target: 10,000 RPS, p99 < 100 ms, 99.99 % availability.
- By **Little's Law**: concurrency = throughput × latency = 10,000 × 0.05 s (p50 50 ms) = **500 concurrent requests in flight**.
- If a single instance handles 1,500 RPS at acceptable latency (measured, not guessed), I need ~7 instances for load and **~10–14 for N+2 redundancy across 3 AZs** with headroom for a deploy and an AZ loss.
- Data: 10,000 RPS × 2 KB payload ≈ 20 MB/s in, similar out → well within an ALB, but it's 1.7 TB/day of logs if I log 1 KB per request — so **sample logs and keep 100 % of errors**.

**Architecture:**

1. **Stateless services** behind an ALB/NLB, across ≥3 AZs, auto-scaled on RPS/latency (not CPU alone). Statelessness is what makes horizontal scaling work at all — sessions in Redis or in the token, never in memory.
2. **Read path dominated by cache.** CDN/CloudFront for static and cacheable GETs; Redis (cluster mode, with client-side/near cache for the hottest keys) for shared state; in-process `MemoryCache` for the top-N hot keys to avoid a network hop. Aim for a 90 %+ hit ratio on read-heavy endpoints — that turns 10K RPS at the API into ~1K at the database.
3. **Write path off the request thread.** Accept → validate → persist → **202 Accepted**, with the heavy work done by consumers off Kafka/SQS. Use the **Outbox** pattern so the DB write and the event publish cannot diverge (§14 Q9).
4. **Data tier designed for the access pattern.** Aurora/RDS with read replicas for reads; partition/shard by tenant or account for writes; DynamoDB (or similar) for extreme-scale key-value access with a well-chosen partition key; **no cross-shard transactions on the hot path**.
5. **Resilience:** timeouts everywhere, retries with jittered backoff on idempotent calls only, circuit breakers per dependency, bulkheads, graceful degradation (serve stale cache rather than 500), and load shedding at the edge with 429s.
6. **.NET specifics:** Server GC, source-generated JSON, `ArrayPool`, Minimal APIs or trimmed MVC on hot endpoints, HTTP/2 internally, connection pools sized deliberately, zero blocking calls, ReadyToRun to cut cold start during scale-out.
7. **Observability sized for the volume:** RED metrics per endpoint, tail-based trace sampling, cardinality discipline on labels, SLO-based alerting with error budgets.
8. **Delivery safety:** canary deploys with automatic rollback on SLO breach, expand/contract DB migrations, feature flags, and load tests at 2–3× peak in a production-like environment before every major change.

**Closing statement:** *"At 10K RPS the application code is rarely the constraint — the constraints are the datastore, the number of network round-trips per request, and the blast radius of a single dependency. So I design for cache-first reads, asynchronous writes, bounded concurrency per dependency, and horizontal statelessness — then prove the numbers with a load test rather than assuming them."*

---

**Previous:** [02 — C# / Advanced .NET](./02-CSharp-Advanced-DotNet.md) | **Next:** [04 — Microservices](./04-Microservices.md)

---

## References — official documentation

| Topic | Source |
|---|---|
| Async programming model (TAP) | https://learn.microsoft.com/dotnet/csharp/asynchronous-programming/ |
| Task-based Asynchronous Pattern | https://learn.microsoft.com/dotnet/standard/asynchronous-programming-patterns/task-based-asynchronous-pattern-tap |
| Async guidance / anti-patterns (ASP.NET Core) | https://learn.microsoft.com/aspnet/core/fundamentals/best-practices |
| `Task` class | https://learn.microsoft.com/dotnet/api/system.threading.tasks.task |
| `ValueTask` usage guidance | https://learn.microsoft.com/dotnet/api/system.threading.tasks.valuetask-1#remarks |
| `Task.Run` guidance | https://learn.microsoft.com/dotnet/standard/parallel-programming/task-based-asynchronous-programming |
| Managed thread pool | https://learn.microsoft.com/dotnet/standard/threading/the-managed-thread-pool |
| Thread-pool starvation diagnostics | https://learn.microsoft.com/dotnet/core/diagnostics/debug-threadpool-starvation |
| `Parallel.ForEachAsync` | https://learn.microsoft.com/dotnet/api/system.threading.tasks.parallel.foreachasync |
| Cancellation in managed threads | https://learn.microsoft.com/dotnet/standard/threading/cancellation-in-managed-threads |
| `System.Threading.Channels` | https://learn.microsoft.com/dotnet/core/extensions/channels |
| `System.IO.Pipelines` | https://learn.microsoft.com/dotnet/standard/io/pipelines |
| HTTP resilience (`Microsoft.Extensions.Http.Resilience`) | https://learn.microsoft.com/dotnet/core/resilience/http-resilience |
| `IHttpClientFactory` guidelines | https://learn.microsoft.com/dotnet/core/extensions/httpclient-factory |
| Performance diagnostics tools | https://learn.microsoft.com/dotnet/core/diagnostics/ |
| High CPU diagnostics tutorial | https://learn.microsoft.com/dotnet/core/diagnostics/debug-highcpu |
| ASP.NET Core performance best practices | https://learn.microsoft.com/aspnet/core/performance/performance-best-practices |
