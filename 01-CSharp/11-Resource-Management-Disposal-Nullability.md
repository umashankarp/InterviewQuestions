# Module — C# Advanced: Resource Management, Disposal & Nullability

> Domain: C# | Level: Beginner → Expert | Prerequisite: [[01-CLR-JIT-GC-Memory-Management]] (finalization, GC vs deterministic cleanup), [[02-Async-Await-Internals]] (async disposal, cancellation), [[08-Exception-Handling-Custom-Exceptions]] (failure paths and cleanup)

---

## 1. Topic Description

### Definition

The GC reclaims **memory** and nothing else. Every other resource — file handles, sockets, database connections, native allocations, OS synchronisation objects, timers, event subscriptions, cancellation registrations — must be released explicitly, and `IDisposable`/`IAsyncDisposable` is the contract for doing so deterministically. **Ownership** is the design question underneath: exactly one component is responsible for a resource's lifetime, and every bug in this area is a case where ownership was ambiguous. **Nullable reference types** address the adjacent problem of *reference* validity — making "may be absent" a compile-time-checked property rather than a runtime surprise — and belong here because both are about making lifetime and validity explicit in the type system.

### Core sub-concepts

- **Deterministic disposal versus garbage collection** — why `Dispose` does not free managed memory and the GC does not release handles.
- **`IDisposable` and the dispose pattern** — `Dispose(bool disposing)`, `GC.SuppressFinalize`, and when a finalizer is actually warranted.
- **Finalizers** — the single finalizer thread, the resurrection hazard, the two-collection survival cost, and why a blocking finalizer roots everything behind it.
- **`SafeHandle`** — the correct modern mechanism for owning a native handle, and why it beats a hand-written finalizer.
- **`using` statements and declarations** — scope-based disposal, and `await using` for `IAsyncDisposable`.
- **`IAsyncDisposable`** — why it exists (flushing, draining, network round trips in cleanup), and the pitfalls of implementing both interfaces.
- **Ownership semantics** — who disposes: the creator, the injected container, or the caller; and how a method signature communicates transfer of ownership.
- **DI container ownership** — which registrations the container disposes, transient-disposable accumulation, and scope lifetime.
- **`HttpClient` and pooled resources** — why disposing per call is wrong, socket exhaustion, and `IHttpClientFactory`.
- **Subscription and registration leaks** — event handlers, `CancellationTokenRegistration`, timers, and `IDisposable` returned by subscription APIs.
- **Disposal and exceptions** — cleanup on the failure path, exceptions thrown from `Dispose`, and masking the original error.
- **Double disposal and use-after-dispose** — idempotent `Dispose`, `ObjectDisposedException`, and the intermittent nature of use-after-dispose bugs.
- **Nullable reference types** — annotations, flow analysis, `?`/`!`, the null-forgiving operator as an assertion, and `#nullable` context control.
- **Nullability attributes** — `NotNullWhen`, `MaybeNull`, `AllowNull`, `DisallowNull`, `MemberNotNull` for expressing contracts flow analysis cannot infer.
- **Nullability at boundaries** — deserialisation, ORMs, reflection and interop producing nulls the compiler believes impossible.
- **Migration strategy** — enabling nullable contexts incrementally on a large codebase without a flag day.

### Where it fits

This sits between the runtime's memory model in `01` and every layer that touches the outside world. It is the discipline that makes a service survive long-running operation: memory is handled for you, and everything else is not. It interacts directly with DI (`02-DotNet-AspNetCore/02-DI-Container-Internals` decides who disposes what), with async (`02` — disposal that must await, and cancellation registrations that leak), with events (`04` — subscriptions as resources), and with exceptions (`08` — cleanup on failure paths). Nullability sits alongside because it addresses the same category of defect: state whose validity is assumed rather than expressed, discovered at runtime rather than at compile time.

### Why it matters at scale

Resource leaks are the class of bug that survives every test and kills a service in production after hours or days of uptime. Undisposed sockets exhaust ephemeral ports, and the symptom is a service that works perfectly for six hours and then cannot make outbound calls — with the error appearing at the HTTP client, nowhere near the leak. Undisposed database connections exhaust the pool, and every request then blocks waiting for one, so a leak in a rarely-used code path takes down the whole service. Undisposed cancellation registrations and event subscriptions root object graphs, producing a memory profile that looks like a leak and resists diagnosis because nothing is obviously wrong. On the nullability side, `NullReferenceException` remains the single most common exception in .NET production logs, and the majority are cases where absence was possible and nobody wrote the check.

### Common pitfalls / anti-patterns

- **Disposing `HttpClient` per request** — each disposal leaves a socket in `TIME_WAIT`, so under load the service exhausts ephemeral ports and outbound calls fail for minutes; the correct answer is a long-lived client via `IHttpClientFactory`, which also handles DNS rotation.
- **A `using` around a resource the caller still needs** — disposing something you did not create, or that is shared, produces `ObjectDisposedException` in unrelated code and is a classic ownership error.
- **Transient `IDisposable` registrations resolved inside a long-lived scope** — the container tracks every instance for disposal at scope end, so they accumulate for the process lifetime and show in a dump as objects rooted by the service provider.
- **Registering a disposable with `AddSingleton(new Foo())`** — the container did not create it and will not dispose it; ownership silently transferred to you with no compiler warning.
- **A finalizer that blocks or does non-trivial work** — there is one finalizer thread running serially, so one blocking finalizer stalls every finalizable object behind it and memory grows with no allocation bug present.
- **Forgetting to dispose `CancellationTokenRegistration` or a linked `CancellationTokenSource`** — the registration keeps the callback (and its captured state) alive on the source's list, which for a long-lived token is an unbounded leak.
- **Throwing from `Dispose`** — it typically runs on the exception path, so it replaces the original exception with a cleanup failure and destroys the diagnosis.
- **The null-forgiving operator (`!`) used to silence warnings** — it is an unverified assertion, so it converts a compile-time warning into a runtime `NullReferenceException` while making the code look checked.
- **Enabling nullable reference types and treating warnings as noise** — a partially-annotated codebase gives false confidence, because unannotated boundaries silently produce nulls the compiler believes impossible.
- **Assuming deserialised or ORM-materialised objects honour non-nullable annotations** — those paths bypass constructors and flow analysis entirely, so a `string` declared non-nullable is routinely null at runtime.

---

## 2. Beginner (10 Q&A)

**Q1. What's wrong with this, and what actually happens in production?**
```csharp
public async Task<string> GetAsync(string url) {
    using var client = new HttpClient();
    return await client.GetStringAsync(url);
}
```
**A:** Disposing `HttpClient` per call closes the underlying connection and leaves the socket in `TIME_WAIT` for a couple of minutes. Under load you exhaust the ephemeral port range and every outbound call starts failing — typically after the service has been running happily for hours, which makes the correlation hard to see. `HttpClient` is designed to be long-lived and shared; use `IHttpClientFactory`, which pools and rotates handlers so you get connection reuse *and* still honour DNS changes.
*Follow-up: What's the problem with a single `static HttpClient` held for the process lifetime?*

**Q2. If `Dispose` doesn't free memory, what does it do?**
**A:** Releases things the GC knows nothing about — file handles, sockets, database connections, native memory, OS synchronisation objects — at a moment you choose rather than at some unpredictable future collection. The object's managed memory is still reclaimed normally afterwards. That split is the whole point: memory is non-deterministic and automatic, everything else is deterministic and yours. Conflating them is why people ask whether they should dispose "to free memory".
*Follow-up: So why does failing to dispose sometimes look exactly like a memory leak?*

**Q3. Does this type need a finalizer?**
```csharp
class ReportGenerator : IDisposable {
    private readonly FileStream _output;
    private readonly SqlConnection _conn;
}
```
**A:** No. It owns *managed* disposables, each of which handles its own cleanup — so it needs `Dispose` to cascade, and nothing more. A finalizer is only warranted when a type directly owns an unmanaged resource, and even then `SafeHandle` is the better mechanism. Adding one here costs every instance a place on the finalization queue, an extra collection and a promotion, for cleanup that will never be needed.
*Follow-up: Why does a finalizable object survive at least two collections?*

**Q4. What is `SafeHandle` and why prefer it over an `IntPtr` plus a finalizer?**
**A:** It's a managed wrapper for a native handle with correct finalization, reference counting and protection against handle-recycling attacks, and it integrates with P/Invoke marshalling. Hand-rolling an `IntPtr` field with a finalizer means dealing with partial construction, double release, and the window where a handle is closed while another thread is still using it. `SafeHandle` solves those and guarantees release even during abrupt shutdown. It's the standard answer for owning native resources.
*Follow-up: What is handle recycling, and why does the reference counting matter for it?*

**Q5. Who disposes an injected dependency?**
**A:** Whoever created it — which for a DI-supplied dependency is the container, not your class. A class that disposes an injected service is disposing something it doesn't own, and the next consumer of that instance gets `ObjectDisposedException`. The container disposes what it created when the scope ends: scoped instances at end of request, singletons at shutdown. The exception is an instance you constructed and registered yourself, which the container won't dispose because it didn't create it.
*Follow-up: Your class creates one disposable internally and receives another by injection. What does `Dispose` look like?*

**Q6. What's `IAsyncDisposable` for?**
**A:** Cleanup that genuinely needs to await — flushing a buffer over the network, draining a channel, closing a connection with a handshake, waiting for background work to finish. Doing that synchronously in `Dispose` means blocking, which in a server is exactly the sync-over-async pattern that starves the thread pool. You consume it with `await using`. If a type implements both, callers should prefer the async path, and the synchronous one should be genuinely correct rather than a blocking wrapper around the async one.
*Follow-up: What goes wrong if `Dispose` calls `DisposeAsync().GetAwaiter().GetResult()`?*

**Q7. What's the difference between these two?**
```csharp
using (var conn = Open()) { Query(conn); }   // statement
using var conn2 = Open();                     // declaration
```
**A:** The statement disposes at its closing brace; the declaration disposes at the end of the *enclosing scope*, usually the whole method. The declaration is cleaner for the common case but changes *when* disposal happens — which matters if you want the connection released before doing further work in the same method. Using the declaration everywhere can silently extend resource lifetimes.
*Follow-up: When would you deliberately use the block form?*

**Q8. What do nullable reference types actually change?**
**A:** Nothing at runtime — they're compile-time annotations plus flow analysis. `string` means "shouldn't be null", `string?` means "may be", and the compiler tracks assignments and checks to warn where a possibly-null value is dereferenced. That turns a large class of runtime `NullReferenceException` into build-time warnings. The critical limitation: it isn't enforced. Reflection, deserialisation, ORMs and code compiled without the feature can all put null in a non-nullable reference.
*Follow-up: A JSON payload omits a required field. What's in your non-nullable property?*

**Q9. When is the null-forgiving operator legitimate?**
**A:** When you have knowledge the flow analysis can't express — a value validated by a helper method, a field set by a framework after construction, a `TryGet` whose contract the compiler can't see. It's illegitimate as a way to silence a warning you didn't understand, because it converts a compile-time signal into a runtime exception while making the code look verified. Each use should be justified, and often the better fix is an attribute that teaches the analysis the real contract.
*Follow-up: How would you express "this out parameter is non-null when the method returns true"?*

**Q10. What's the leak here?**
```csharp
public MyService(IHostApplicationLifetime lifetime) {
    lifetime.ApplicationStopping.Register(() => Cleanup());
}
```
**A:** `Register` returns a `CancellationTokenRegistration` that's being discarded, and the token is application-lifetime. So the source keeps that callback — and everything the lambda captures, including `this` — alive for the process lifetime. If this service is scoped or transient, every instance ever created is now rooted. Capture the registration and dispose it, usually in the service's own `Dispose`.
*Follow-up: Same shape with a linked `CancellationTokenSource`. What accumulates?*

---

## 3. Intermediate (10 Q&A)

**Q1. A service runs fine for six hours then all outbound HTTP fails. Walk me through it.**
**A:** That profile is socket or connection exhaustion — something creates and disposes connections per operation, so sockets accumulate in `TIME_WAIT` until the ephemeral port range runs out. Usual cause is `HttpClient` per request, often inside a `using`. I'd confirm from the machine's socket state counts rather than application logs, since the app only sees a generic connection failure. Fix is `IHttpClientFactory` or a long-lived client. The broader lesson: the failure appears at the point of *use*, hours after and far from the code that causes it.
*Follow-up: Connection counts look normal but the DB pool is exhausted instead. What's the equivalent cause?*

**Q2. How do you diagnose a resource leak that presents as growing memory?**
**A:** Heap snapshots over time, diffed, then follow the *root path* rather than the largest objects — a leak is an unintended root and `!gcroot` names it. For resource leaks specifically, look for objects rooted by the service provider's disposables list (transient disposables accumulating in a long-lived scope), by a `CancellationTokenSource`'s registration list, by a timer, or by an event's invocation list. Each has a distinctive root path, and recognising them turns a multi-day investigation into a short one.
*Follow-up: The root path ends at `CancellationTokenSource`. What's the specific bug?*

**Q3. What's wrong with this registration, and what does it cause?**
```csharp
services.AddTransient<IReportWriter, FileReportWriter>();  // FileReportWriter : IDisposable
```
— resolved repeatedly from a singleton's scope.
**A:** The container tracks every disposable it creates so it can dispose them at scope end. Resolved from the root scope, "scope end" never comes — so every instance is retained for the process lifetime and shows in a dump as objects rooted by the service provider. Two rules avoid it: don't register disposables as transient if they may be resolved from long-lived scopes, and prefer explicit `using` ownership for short-lived disposables the container needn't track at all.
*Follow-up: A dump shows thousands of objects rooted by `ServiceProviderEngineScope`. What do you conclude?*

**Q4. How should `Dispose` behave on a second call, or when the object is used afterwards?**
**A:** Idempotent — a second call is a no-op, not an error — because disposal can legitimately happen through more than one path, such as a `using` plus a container. Use after disposal should throw `ObjectDisposedException` from public members, turning silent misbehaviour into a clear diagnosis. That matters because use-after-dispose bugs are intermittent and timing-dependent, so a clear exception at the point of misuse is dramatically cheaper to chase than corrupted behaviour later.
*Follow-up: A disposed object is used from a cached delegate. Why is that so hard to reproduce?*

**Q5. What are the rules for exceptions and disposal?**
**A:** `Dispose` shouldn't throw, because it usually runs while an exception is already propagating — throwing there replaces the original with a cleanup failure and destroys the diagnosis. If cleanup can genuinely fail in a way that matters, make it a separate explicit method (`FlushAsync`, `CloseAsync`) the caller invokes and can handle, with `Dispose` as the best-effort net. On the other side, resources acquired must be released on the failure path too, which is what `using` and `try`/`finally` guarantee and what cleanup written after the last statement does not.
*Follow-up: You must flush on dispose and the flush can fail. How do you structure that API?*

**Q6. How do you decide ownership when a method returns a disposable?**
**A:** Make it explicit in the design and the documentation, because the type system doesn't express it. A `Create…` or `Open…` method conventionally transfers ownership to the caller, who must dispose; a property or `Get…` returning a shared instance does not. Where ambiguity is likely, return an explicit owner type — `IMemoryOwner<T>` is the BCL's example — so the contract is in the signature. The shape to avoid is a method that *sometimes* creates and sometimes returns a cached instance, because then no caller can dispose correctly.
*Follow-up: A factory returns a cached instance for some inputs and a new one for others. How do you fix that API?*

**Q7. How would you migrate a large codebase to nullable reference types?**
**A:** Incrementally, per project or file with `#nullable enable`, so you're never in a half-annotated state you can't reason about. Start at the boundaries producing the most nulls — deserialisation, database access, external APIs — because annotating those correctly gives the biggest reduction in real defects. Treat warnings as a burn-down with a visible number rather than switching them to errors immediately, which would block all work. The trap is annotating mechanically to silence warnings, especially with `!`, which gives you a codebase claiming null-safety it doesn't have.
*Follow-up: Half the warnings are in generated code you don't own. How do you handle that?*

**Q8. Which nullability attributes actually matter?**
**A:** `NotNullWhen(true)` for the `TryGet` pattern, so a successful return teaches the compiler the out parameter is non-null — without it every call site needs `!`. `MaybeNull` and `AllowNull` for generic code where `T?` can't express the intent under different constraints. `MemberNotNull` for initialisation helpers called from a constructor, which flow analysis can't see through. They matter because they let you express real contracts the analysis can't infer — the difference between the feature reducing defects and producing a codebase littered with suppressions.
*Follow-up: A generic method returns `default(T)` when not found. How do you annotate that correctly?*

**Q9. Why do non-nullable properties end up null at runtime?**
**A:** Because deserialisers, ORMs and reflection-based factories bypass constructors and flow analysis entirely — they set fields directly or use a parameterless constructor, so the compiler's guarantee never applied to that path. You get a `string` declared non-nullable containing null, which is exactly what the feature was meant to eliminate. Mitigations: validate at the boundary rather than trusting the annotation, use `required` so construction can't omit them, and treat any object crossing a serialisation boundary as untrusted regardless of declared types.
*Follow-up: How does `required` help, and what does it still not cover?*

**Q10. How do you handle disposal when work continues after the response is sent?**
**A:** Make the work's scope explicit rather than borrowing the request's. Continuing to use a request-scoped resource after the response means racing against scope disposal, which produces intermittent `ObjectDisposedException` under load. Correct pattern is a new DI scope for the background work, resolving its own dependencies and disposed when the work completes — or better, hand the work to a hosted service or a queue so it isn't tied to a request at all. I'd treat any fire-and-forget from a request handler as a defect for this reason among others.
*Follow-up: The background work needs data from the request scope. How do you pass it safely?*

---

## 4. Expert / Architect (10 Q&A)

**Q1. How do you make resource ownership explicit at an architectural level?**
**A:** Establish conventions the whole estate follows and encode them where possible: creation methods transfer ownership and are named accordingly; injected dependencies are never disposed by their consumer; anything returning a pooled or shared resource returns an explicit owner type; background work always creates its own scope. Then make deviations visible — analyzers for the common mistakes, a shared library providing the sanctioned patterns for HTTP clients, background work and pooled buffers. This has to be convention rather than case-by-case reasoning, because the compiler can't express ownership and consistency is the only mechanism available.
*Follow-up: How would you enforce "never dispose an injected dependency" mechanically?*

**Q2. How do you detect resource leaks before production?**
**A:** Soak tests rather than unit tests — a realistic workload run for hours, watching handle counts, socket states, connection-pool usage and heap growth, because leaks are cumulative and a short test can't show them. Assert on the trajectory, not the peak. In development, deliberately low connection-pool limits make leaks fail fast rather than surface after hours. Add heap-diff assertions in a nightly job for the types most likely to leak. And make it a scheduled, owned activity, because leaks are precisely the class of defect CI's short-lived processes can't reveal.
*Follow-up: A soak test shows a slow linear handle-count increase. How do you narrow it down?*

**Q3. What's your position on nullable reference types for a large existing codebase?**
**A:** Worth adopting, but only with the discipline to do it honestly. Enabled incrementally with warnings genuinely resolved, it removes a large and expensive class of defect and — just as valuable — forces explicit decisions about where absence is meaningful, which improves the model. Enabled and then suppressed with `!` and blanket pragmas, it's worse than not enabling it, because the codebase now claims a guarantee it doesn't provide and reviewers stop looking. So I'd gate adoption on the team's willingness to treat the warnings as real, and start where the actual nulls come from.
*Follow-up: A team enabled it a year ago and has 4,000 suppressed warnings. What do you do?*

**Q4. How do you design a shared library's disposal contract?**
**A:** Conservatively, because disposal semantics are a contract consumers depend on and can't work around. Implement `IAsyncDisposable` where cleanup genuinely needs to await, keep `Dispose` idempotent and non-throwing, document precisely what the consumer owns versus what the library retains, and never dispose objects the consumer passed in unless the API explicitly says it takes ownership. Avoid finalizers unless the library directly owns native resources, since a finalizer in a widely-used library multiplies the finalization-queue cost across every consumer. Clear ownership documentation is the highest-value artefact here.
*Follow-up: Your library accepts a `Stream` and needs to know whether to dispose it. How do you design that?*

**Q5. How do resource concerns differ between a long-running service and a short-lived process?**
**A:** In a short-lived process — a function, a CLI tool, a job — leaks are largely irrelevant because the process exits and the OS reclaims everything, so effort is better spent on startup cost. In a long-running service every leak is cumulative and the failure arrives at some unpredictable point measured in hours or days, so disposal discipline, bounded caches and scope hygiene become primary correctness concerns. The mistake is applying short-lived-process habits to a service, producing code that passes every test and dies overnight. Knowing which model you're in should be explicit, not assumed.
*Follow-up: A library written for batch jobs is now used in a long-running service. What would you audit?*

**Q6. How do you handle resources that must be released even if the process dies?**
**A:** You can't, within the process — `finally` and finalizers both require the process to survive. So a distributed lock, a claimed queue message or a reserved external resource released only in `Dispose` is held forever when the process is killed. The answer is external: leases with expiry so an abandoned resource is reclaimed by time, visibility timeouts on queue messages, heartbeats that stop when the process does. Architecturally, any cross-process resource needs an expiry-based design, and "we release it in a `finally`" is an incomplete answer whenever the resource lives outside the process.
*Follow-up: How would you choose the lease duration, and what's the trade-off?*

**Q7. How do you evaluate the cost of defensive disposal patterns?**
**A:** By what they actually prevent. Idempotent `Dispose` and `ObjectDisposedException` checks cost almost nothing and prevent genuinely confusing bugs, so they're worth it universally. Defensive copies and wrapper types cost allocation and indirection, so they belong where the resource crosses a trust or concurrency boundary rather than everywhere. Finalizers as a safety net cost every instance a place on the finalization queue and an extra collection, which is a poor trade unless native resources are involved. Pay for safety where a mistake would be silent and expensive; don't where it'd be immediate and obvious.
*Follow-up: A team adds finalizers "just in case" across their types. Response?*

**Q8. How do disposal and lifetimes interact in a DI-heavy architecture?**
**A:** The container becomes the de facto owner of most lifetimes, which is good — one consistent policy — but it moves the lifetime decisions into the composition root rather than the code that uses them, so mistakes are invisible at the point of use. Transient disposables, captured scoped services and pre-built singleton instances all have disposal consequences that only appear at runtime, and scope validation catches only some. So the composition root deserves the same review rigour as any critical code, plus validate-on-build in every environment and an integration test that constructs the whole graph.
*Follow-up: How would you detect transient-disposable accumulation before it becomes a production leak?*

**Q9. How would you approach a legacy system with pervasive resource-management problems?**
**A:** Quantify first — handle counts, connection-pool usage, socket states under load — so you know which resource is actually leaking rather than fixing whichever is easiest to see. Then fix by blast radius: the shared connection or HTTP client affecting every request before the file handle in a monthly job. Add analyzers to stop new instances while the burn-down proceeds, and set connection-pool limits low in test environments so regressions fail loudly. Add the soak test early, because without it you can't demonstrate the improvement and the work loses support.
*Follow-up: The leak is in a third-party library you can't change. Options?*

**Q10. What separates an excellent answer from an adequate one on resource management?**
**A:** An adequate answer wraps things in `using`. An excellent one reasons about *ownership* — who created it, who may dispose it, how the API communicates that — because every real bug here is an ownership ambiguity rather than a forgotten keyword. It distinguishes managed memory from external resources and knows the GC handles only one. It knows disposal on the *failure* path is where leaks actually occur. It recognises that cross-process resources need expiry rather than cleanup code. And it treats nullability and disposal as the same discipline: making validity and lifetime explicit in the type system. The distinguishing quality is designing so the mistake is impossible rather than remembering not to make it.
*Follow-up: Given that, how would you design an API so a caller cannot forget to dispose?*

---
