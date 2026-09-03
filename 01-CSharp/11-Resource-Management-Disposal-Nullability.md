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

**Q1. What does `Dispose` actually do, given the GC exists?**
**A:** It releases resources the GC knows nothing about — file handles, sockets, database connections, native memory, OS synchronisation objects — at a moment you choose rather than at an unpredictable future collection. It does not free the object's managed memory; the object is still collected normally afterwards. That separation is the whole point: memory is non-deterministic and handled automatically, while everything else is deterministic and your responsibility. Conflating the two is why people ask whether they should "dispose to free memory".
*Follow-up: If `Dispose` doesn't free memory, why does failing to call it sometimes look like a memory leak?*

**Q2. When does a type need a finalizer?**
**A:** Only when it *directly* owns an unmanaged resource — a raw handle or native allocation — and even then, `SafeHandle` is the better mechanism because it handles the finalization correctly for you. A type composed of other disposable managed types needs `Dispose` but not a finalizer, because each component handles its own. Adding a finalizer unnecessarily is costly: the object survives at least two collections, is placed on the finalization queue, and is promoted to a higher generation, all for cleanup that will never be needed.
*Follow-up: Why does a finalizable object survive at least two collections?*

**Q3. Explain the dispose pattern and what `GC.SuppressFinalize` is for.**
**A:** The pattern separates cleanup into `Dispose(bool disposing)`: when called from `Dispose()` the flag is true and you release both managed and unmanaged resources; when called from the finalizer it is false and you must only touch unmanaged ones, because managed objects may already have been finalized. `Dispose()` then calls `GC.SuppressFinalize(this)` to tell the collector the finalizer is no longer needed, which removes the object from the finalization queue and avoids the extra collection and promotion. Without that call, correct disposal still leaves you paying the finalization tax.
*Follow-up: A type has no finalizer. Should `Dispose` still call `SuppressFinalize`?*

**Q4. What is `IAsyncDisposable` for, and when do you implement it?**
**A:** For cleanup that genuinely needs to await — flushing a buffer over the network, draining a channel, closing a connection with a protocol handshake, waiting for background work to finish. Doing that synchronously in `Dispose` means blocking, which in a server is exactly the sync-over-async pattern that causes thread-pool starvation. You consume it with `await using`. If a type implements both interfaces, callers should prefer the async path, and the synchronous one should remain correct rather than being a blocking wrapper around the async one.
*Follow-up: What goes wrong if `Dispose` calls `DisposeAsync().GetAwaiter().GetResult()`?*

**Q5. Who is responsible for disposing an injected dependency?**
**A:** Whoever created it — which for a DI-supplied dependency is the container, not your class. A class that disposes an injected service is disposing something it does not own, and the next consumer of that instance gets `ObjectDisposedException`. The container disposes instances it created when their scope ends: scoped instances at end of request, singletons at application shutdown. The exception is a pre-built instance you registered yourself, which the container will not dispose because it did not create it.
*Follow-up: Your class creates a disposable internally *and* receives one by injection. What's the correct `Dispose` implementation?*

**Q6. Why is disposing `HttpClient` per request wrong?**
**A:** Because disposal closes the underlying connection and leaves the socket in `TIME_WAIT` for a period, so a service making many calls exhausts ephemeral ports and outbound requests begin failing — typically after the service has been running fine for some time, which makes the correlation hard to see. `HttpClient` is designed to be long-lived and shared. The correct approach is `IHttpClientFactory`, which pools and rotates the underlying handlers, giving you connection reuse while still honouring DNS changes — which a single static client held forever does not.
*Follow-up: What problem does a single `static HttpClient` held for the process lifetime have?*

**Q7. What does a `using` declaration do differently from a `using` statement?**
**A:** A `using` statement introduces an explicit block and disposes at its closing brace; a `using` declaration (`using var x = …;`) disposes at the end of the *enclosing scope*, usually the method. The declaration is cleaner for the common case, but it changes when disposal happens, which matters when you want the resource released before doing further work in the same method — for example releasing a connection before a long computation. Choosing the declaration everywhere can therefore extend resource lifetimes unintentionally.
*Follow-up: When would you deliberately use the block form instead?*

**Q8. What do nullable reference types actually change?**
**A:** Nothing at runtime — they are compile-time annotations plus flow analysis. Declaring `string` means "should not be null" and `string?` means "may be null", and the compiler tracks assignments and checks to warn where a possibly-null value is dereferenced. That turns a large class of runtime `NullReferenceException` into build-time warnings. The critical limitation is that it is not enforced: reflection, deserialisation, ORMs and code compiled without the feature can all produce null in a non-nullable reference, so the annotations are a strong convention rather than a guarantee.
*Follow-up: A JSON payload omits a required field. What does your non-nullable property contain?*

**Q9. What is the null-forgiving operator and when is it legitimate?**
**A:** `!` suppresses the compiler's null warning by asserting you know the value is not null. It is legitimate when you have knowledge the flow analysis cannot express — a value validated by a helper method, a field set by a framework after construction, a `TryGet` pattern whose contract the compiler cannot see. It is illegitimate as a way to make a warning go away, because it converts a compile-time signal into a runtime exception while making the code look verified. I would expect each use to be justified, ideally with a comment or replaced by an attribute that teaches the analysis the real contract.
*Follow-up: How would you express "this out parameter is non-null when the method returns true" so `!` isn't needed?*

**Q10. What is `SafeHandle` and why prefer it over `IntPtr` plus a finalizer?**
**A:** It is a managed wrapper for a native handle with correct finalization, reference counting and protection against handle recycling attacks, and it integrates with P/Invoke marshalling. Hand-rolling an `IntPtr` field with a finalizer is error-prone: it has to deal with partial construction, double release, and the window where a handle is closed while another thread is still using it. `SafeHandle` solves those, and it also guarantees release even if the process is shutting down abruptly. It is the standard answer for owning native resources.
*Follow-up: What is handle recycling and why does `SafeHandle`'s reference counting matter for it?*

---

## 3. Intermediate (10 Q&A)

**Q1. A service works for six hours and then all outbound HTTP calls fail. Walk me through it.**
**A:** That profile is socket or connection exhaustion: something is creating and disposing connections per operation, so sockets accumulate in `TIME_WAIT` until the ephemeral port range is exhausted. The usual cause is `HttpClient` constructed per request, sometimes inside a `using`. I would confirm with the machine's socket state counts rather than the application logs, since the application only sees a generic connection failure. The fix is `IHttpClientFactory` or a long-lived client; the broader lesson is that the failure appears at the point of *use*, hours after and far from the code that causes it.
*Follow-up: Connection counts look normal but the database connection pool is exhausted instead. What's the equivalent cause?*

**Q2. How do you diagnose a resource leak that presents as growing memory?**
**A:** Take heap snapshots over time and diff them, then follow the *root path* rather than the largest objects — a leak is an unintended root, and `!gcroot` or the equivalent names it directly. For resource leaks specifically, look for objects rooted by the service provider's disposables list (transient disposables accumulating in a long-lived scope), by a `CancellationTokenSource`'s registration list, by a timer, or by an event's invocation list. Each of those has a distinctive root path, and recognising them turns a multi-day investigation into a short one.
*Follow-up: The root path ends at `CancellationTokenSource`. What's the specific bug?*

**Q3. How does a `CancellationToken` cause a leak?**
**A:** Registering a callback on a token returns a `CancellationTokenRegistration`, and the source keeps that callback — and everything it captures — alive until the token is cancelled or the registration is disposed. For a short-lived request token that is harmless; for a long-lived token, such as an application-lifetime token registered against on every request, the callback list grows without bound. The same applies to linked token sources, which register against their parents and must be disposed. The fix is to dispose registrations and linked sources, usually via `using`.
*Follow-up: You create a linked token source per request and never dispose it. What exactly accumulates?*

**Q4. How should `Dispose` behave when called twice, or when the object is used after disposal?**
**A:** `Dispose` must be idempotent — a second call is a no-op, not an error — because disposal can legitimately happen through more than one path, such as a `using` plus a container. Use after disposal should throw `ObjectDisposedException` from public members, which turns a silent misbehaviour into a clear diagnosis. The reason this matters is that use-after-dispose bugs are intermittent and depend on timing, so a clear exception at the point of misuse is dramatically cheaper to diagnose than corrupted behaviour later.
*Follow-up: A disposed object is used from a cached delegate. Why is that so hard to reproduce?*

**Q5. What are the rules for exceptions and disposal?**
**A:** `Dispose` should not throw, because it usually runs while an exception is already propagating — a throw there replaces the original exception with a cleanup failure and destroys the diagnosis. If cleanup can genuinely fail in a way that matters, it should be a separate explicit method (`CloseAsync`, `FlushAsync`) that the caller invokes and can handle, with `Dispose` as the best-effort safety net. On the other side, resources acquired must be released on the failure path too, which is what `using` and `try`/`finally` guarantee and what hand-written cleanup after the last statement does not.
*Follow-up: You must flush a buffer on dispose and the flush can fail. How do you structure that API?*

**Q6. How do you decide ownership when a method returns a disposable?**
**A:** By making it explicit in the API's design and documentation, because the type system does not express it. A method named `Create…` or `Open…` conventionally transfers ownership to the caller, who must dispose it; a property or a `Get…` returning a shared instance does not. Where ambiguity is likely, returning an explicit owner type — `IMemoryOwner<T>` being the BCL's example — makes the contract part of the signature. The failure to avoid is a method that sometimes creates and sometimes returns a cached instance, because no caller can then dispose correctly.
*Follow-up: A factory returns a cached instance for some inputs and a new one for others. How do you fix that API?*

**Q7. How do you migrate a large codebase to nullable reference types?**
**A:** Incrementally, per project or per file, using `#nullable enable` so the codebase is never in a half-annotated state you cannot reason about. Start at the boundaries that produce the most nulls — deserialisation, database access, external APIs — because annotating them correctly gives the largest reduction in real defects. Treat the warnings as a burn-down with a visible number rather than switching them to errors immediately, which would block all work. The trap is annotating mechanically to silence warnings, especially with `!`, which yields a codebase that claims null-safety it does not have.
*Follow-up: Half the warnings are in generated code you don't own. How do you handle that?*

**Q8. Which nullability attributes matter in practice and why?**
**A:** `NotNullWhen(true)` for the `TryGet` pattern, so a successful return teaches the compiler the out parameter is non-null — without it, every call site needs `!`. `MaybeNull` and `AllowNull` for generic code where `T?` cannot express the intent under different constraints. `MemberNotNull` for initialisation helpers called from a constructor, which flow analysis cannot see through. These matter because they let you express real contracts the analysis cannot infer, which is the difference between the feature reducing defects and it producing a codebase littered with suppressions.
*Follow-up: A generic method returns `default(T)` when not found. How do you annotate that correctly?*

**Q9. Why do non-nullable properties end up null at runtime, and what do you do about it?**
**A:** Because deserialisers, ORMs and reflection-based factories bypass constructors and flow analysis entirely — they set fields directly or use a parameterless constructor, so the compiler's guarantee never applied to that path. The result is a `string` declared non-nullable containing null, which is exactly the situation the feature was meant to eliminate. The mitigations are validating at the boundary rather than trusting the annotation, using `required` members so construction cannot omit them, and treating any object crossing a serialisation boundary as untrusted regardless of its declared types.
*Follow-up: How does `required` help here, and what does it still not cover?*

**Q10. How do you handle disposal in an async pipeline where work continues after the response?**
**A:** By making the work's scope explicit rather than borrowing the request's. Continuing to use a request-scoped resource after the response has been sent means racing against scope disposal, which produces intermittent `ObjectDisposedException` under load. The correct pattern is to create a new DI scope for the background work, resolve its own dependencies, and dispose it when the work completes — or better, to hand the work to a hosted service or a queue so it is not tied to a request at all. I would treat any fire-and-forget from a request handler as a defect for this reason among others.
*Follow-up: The background work needs data from the request scope. How do you pass it safely?*

---

## 4. Expert / Architect (10 Q&A)

**Q1. How do you make resource ownership explicit at an architectural level?**
**A:** By establishing conventions the whole estate follows and encoding them where possible: creation methods transfer ownership and are named accordingly; injected dependencies are never disposed by their consumer; anything that returns a pooled or shared resource returns an explicit owner type; and background work always creates its own scope. Then make deviations visible — analyzers for the common mistakes, and a shared library providing the sanctioned patterns for HTTP clients, background work and pooled buffers. The reason this must be a convention rather than case-by-case reasoning is that the compiler cannot express ownership, so consistency is the only mechanism available.
*Follow-up: How would you enforce "never dispose an injected dependency" mechanically?*

**Q2. How do you detect resource leaks before production?**
**A:** With soak tests rather than unit tests — run a realistic workload for hours and watch handle counts, socket states, connection-pool usage and heap growth, because leaks are cumulative and a short test cannot show them. Assert on the trajectory, not the peak. In development, connection-pool limits set deliberately low make leaks fail fast rather than surface after hours. And I would add heap-diff assertions in a nightly job for the specific types most likely to leak. The organisational point is that this is a scheduled, owned activity, since leaks are precisely the class of defect that CI's short-lived processes cannot reveal.
*Follow-up: A soak test shows a slow, linear handle-count increase. How do you narrow it down?*

**Q3. What's your position on nullable reference types for a large existing codebase?**
**A:** Worth adopting, but only with the discipline to do it honestly. Enabled incrementally with warnings genuinely resolved, it removes a large and expensive class of defect and — just as valuable — forces explicit decisions about where absence is meaningful, which improves the model. Enabled and then suppressed with `!` and blanket pragmas, it is worse than not enabling it, because the codebase now claims a guarantee it does not provide and reviewers stop looking. So I would gate adoption on the team's willingness to treat the warnings as real, and I would start at the boundaries where the actual nulls come from.
*Follow-up: A team enabled it a year ago and has 4,000 suppressed warnings. What do you do?*

**Q4. How do you design a shared library's disposal contract?**
**A:** Conservatively, because a library's disposal semantics are a contract consumers depend on and cannot work around. Implement `IAsyncDisposable` where cleanup genuinely needs to await, keep `Dispose` idempotent and non-throwing, document precisely what the consumer owns versus what the library retains, and never dispose objects the consumer passed in unless the API explicitly says it takes ownership. I would also avoid finalizers unless the library directly owns native resources, since a finalizer in a widely-used library multiplies the finalization-queue cost across every consumer. Clear ownership documentation is the single highest-value artefact here.
*Follow-up: Your library accepts a `Stream` and needs to know whether to dispose it. How do you design that?*

**Q5. How do resource-management concerns change in a long-running versus a short-lived process?**
**A:** In a short-lived process — a function, a CLI tool, a job — leaks are largely irrelevant because the process exits and the OS reclaims everything, so effort is better spent on startup cost. In a long-running service, every leak is cumulative and the failure arrives at some unpredictable point measured in hours or days, so disposal discipline, bounded caches and scope hygiene become primary correctness concerns. The mistake I see is applying short-lived-process habits to a service, which produces code that passes every test and dies overnight. Knowing which model you are in should be explicit, not assumed.
*Follow-up: A library written for batch jobs is now used in a long-running service. What would you audit?*

**Q6. How do you handle resources that must be released even if the process dies?**
**A:** You cannot, within the process — `finally` and finalizers both require the process to survive, so a distributed lock, a claimed queue message or a reserved external resource released only in `Dispose` is held forever when the process is killed. The answer is external: leases with expiry so an abandoned resource is reclaimed by time, visibility timeouts on queue messages, and heartbeats that stop when the process does. Architecturally this means any cross-process resource needs an expiry-based design, and I would treat "we release it in a `finally`" as an incomplete answer whenever the resource lives outside the process.
*Follow-up: How would you choose the lease duration, and what's the trade-off?*

**Q7. How do you evaluate the cost of defensive disposal patterns?**
**A:** By what they actually prevent. Idempotent `Dispose` and `ObjectDisposedException` checks cost almost nothing and prevent genuinely confusing bugs, so they are worth it universally. Defensive copies and wrapper types cost allocation and indirection, so they belong where the resource crosses a trust or concurrency boundary rather than everywhere. Finalizers as a safety net cost every instance a place on the finalization queue and an extra collection, which is a poor trade unless native resources are involved. The principle is to pay for safety where a mistake would be silent and expensive, and not where it would be immediate and obvious.
*Follow-up: A team adds finalizers "just in case" across their types. What's your response?*

**Q8. How do disposal and nullability interact with a DI-heavy architecture?**
**A:** The container becomes the de facto owner of most lifetimes, which is good — one consistent policy — but it means the lifetime decisions live in the composition root rather than in the code that uses them, so mistakes are invisible at the point of use. Transient disposables, captured scoped services and pre-built singleton instances all have disposal consequences that only appear at runtime, and scope validation catches only some. So the composition root deserves the same review rigour as any other critical code, and I would insist on validate-on-build in every environment plus an integration test that constructs the whole graph.
*Follow-up: How would you detect transient-disposable accumulation before it becomes a production leak?*

**Q9. How would you approach a legacy system with pervasive resource-management problems?**
**A:** Quantify first — handle counts, connection-pool usage, socket states under load — so you know which resource is actually leaking rather than fixing whichever is easiest to see. Then fix by blast radius: the shared connection or HTTP client affecting every request before the file handle in a monthly job. Add analyzers to stop new instances while the burn-down proceeds, and set connection-pool limits low in test environments so regressions fail loudly. I would also add the soak test early, because without it you cannot demonstrate the improvement and the work loses support.
*Follow-up: The leak is in a third-party library you can't change. What are your options?*

**Q10. What separates an excellent answer from an adequate one on resource management?**
**A:** An adequate answer wraps things in `using`. An excellent one reasons about *ownership* — who created it, who may dispose it, and how the API communicates that — because every real bug in this area is an ownership ambiguity rather than a forgotten keyword. It distinguishes managed memory from external resources and knows the GC handles only one of them; it knows disposal on the failure path is where leaks actually occur; it recognises that cross-process resources need expiry rather than cleanup code; and it treats nullability and disposal as the same underlying discipline of making validity and lifetime explicit in the type system. The distinguishing quality is designing so that the mistake is impossible, rather than remembering not to make it.
*Follow-up: Given that, how would you design an API so a caller cannot forget to dispose?*
