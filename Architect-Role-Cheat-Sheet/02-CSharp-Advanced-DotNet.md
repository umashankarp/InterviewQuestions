# 2. C# / Advanced .NET — 20 Questions (Answered)

> Role lens: **Solution / Technical Architect**. Language questions at this level are really questions about *memory, lifetime, correctness under concurrency, and API design*. Answer them that way.

---

## Q1. Explain value types vs reference types.

**Value types** (`struct`, `enum`, all primitives, `record struct`, tuples, `Span<T>`, `DateTime`, `decimal`, `Guid`, `Nullable<T>`) hold their data **inline**. Assignment copies the whole value. They derive from `System.ValueType`.

**Reference types** (`class`, `record class`, `interface`, `delegate`, `string`, arrays) hold a **reference** to an object on the managed heap. Assignment copies the reference; two variables then observe the same object.

```csharp
struct P { public int X; }
class  C { public int X; }

var p1 = new P { X = 1 }; var p2 = p1; p2.X = 99;   // p1.X == 1  (independent copy)
var c1 = new C { X = 1 }; var c2 = c1; c2.X = 99;   // c1.X == 99 (same object)
```

**Where they actually live** — and this is the correction interviewers listen for: "value types live on the stack" is **wrong as a general statement**. Storage location is determined by the *containing* storage, not by the type:

- A local value type with no capture → stack.
- A value-type **field of a class** → on the heap, inside that object.
- A value type in an array → in the array's heap block (which is why `Point[]` is contiguous and cache-friendly, and `List<Point>` beats `List<PointClass>` for iteration).
- A value type captured by a lambda or `async` state machine → hoisted to a heap-allocated closure/state-machine object.
- A boxed value type → on the heap.

**Semantics that follow:**
- **Equality:** value types use structural equality (`ValueType.Equals` — reflection-based and slow unless you override it or use `record struct`); reference types use reference equality unless overridden. `string` is the famous exception — a reference type with value equality.
- **Nullability:** value types need `Nullable<T>` to be null; reference types are nullable by nature (with compile-time nullable annotations in modern C#).
- **Defaults:** `default(struct)` is all-zero-bits and always valid; `default(class)` is `null`.

**Architect's guidance:** use a `struct` when the type is small (≈16 bytes or less), immutable, logically a single value, and short-lived — `Money`, `TradeId`, `Timestamp`. Use `readonly struct` to prevent defensive copies. Everything else is a class. Mutable structs are a documented footgun (`readonly` fields, collections and properties return copies, so mutations silently vanish).

---

## Q2. Stack vs heap?

| | Stack | Managed heap |
|---|---|---|
| Allocated by | Moving a stack pointer (one instruction) | Allocation pointer bump in Gen0 + eventual GC |
| Lifetime | LIFO, tied to method frame | Until unreachable, then GC |
| Size | Small and fixed — **1 MB default per thread** on Windows | Bounded by process/container memory |
| Cost of reclaim | Free (pop the frame) | GC pause proportional to surviving objects |
| Thread affinity | Per-thread, private | Shared across threads |
| Failure mode | `StackOverflowException` — **uncatchable, kills the process** | `OutOfMemoryException` |

**What goes on the stack:** method parameters, locals (that aren't captured/hoisted), return addresses, and the *references themselves* for reference-type locals.

**What goes on the heap:** all objects, arrays, boxed values, closures, `async` state machines when they suspend, delegates.

**Why an architect cares:**
- **Allocation rate drives GC pressure**, and GC pauses drive p99 latency. A service allocating 2 GB/s spends measurable time in Gen0 collections; the fix is usually not "tune the GC" but "stop allocating" — pooled buffers (`ArrayPool<T>`), `Span<T>`/`stackalloc` for parsing, struct enumerators, source-generated JSON.
- **Stack depth is a hard limit.** Deep recursion over user-supplied data (nested JSON, XML, expression trees) is a real DoS vector: `StackOverflowException` cannot be caught and takes the process down. Convert recursion to an explicit stack, or bound depth.
- **`stackalloc`** gives stack-allocated spans for small buffers (`Span<byte> buf = stackalloc byte[256];`) — great for parsing, dangerous in a loop (each iteration adds to the same frame). Always guard with a size threshold and fall back to `ArrayPool`.

---

## Q3. `class` vs `struct`?

| | `class` | `struct` |
|---|---|---|
| Semantics | Reference | Value (copy on assign/pass) |
| Storage | Heap object + header (16 bytes overhead on x64: sync block + method table pointer) | Inline in its container |
| Inheritance | Yes | No (can implement interfaces) |
| `null` | Yes | Only via `Nullable<T>` |
| Default | `null` | Zero-initialised instance |
| Equality | Reference by default | Structural (override it — the default is reflection-based) |
| GC | Tracked | Not individually tracked |

**Choose `struct` when all of these hold:** small (guideline ≤16 bytes), immutable, represents a single conceptual value, and is not frequently boxed. Otherwise choose `class`.

**The traps:**

1. **Boxing kills the benefit.** Putting a struct in a non-generic collection, casting to `object`, or calling an interface method through an interface reference boxes it. `List<T>` and generics are fine; `ArrayList` and `IComparable` (non-generic) are not.
2. **Copy cost.** A 200-byte struct passed by value to a method called a million times copies 200 MB. Use `in` parameters (`readonly ref`) or make it a class.
3. **Defensive copies.** Calling a non-readonly member on a `readonly` field of a non-`readonly struct` makes the compiler copy the struct first. Mark structs `readonly struct` to eliminate this.
4. **Mutable structs lie.** `list[0].X = 5` doesn't compile for a `List<T>` of structs (indexer returns a copy) — and where it *does* compile (arrays), it silently behaves differently from what people expect.

**Modern forms:** `readonly record struct Money(decimal Amount, string Currency);` — value semantics, structural equality, immutability, no boxing on equality, and no `ValueType.Equals` reflection. That is my default for domain value objects.

`ref struct` (`Span<T>`, `ReadOnlySpan<T>`) is a further category: stack-only, cannot be boxed, cannot be a field of a class, cannot be captured by a lambda or used across an `await`. That restriction is the *point* — it makes zero-copy slicing memory-safe.

---

## Q4. Interface vs abstract class?

| | Interface | Abstract class |
|---|---|---|
| Multiple inheritance | Yes | No (single base class) |
| State (fields) | No instance fields | Yes |
| Constructors | No | Yes |
| Access modifiers on members | Public by default (private/protected allowed since C# 8 with DIM) | Full range |
| Versioning | Adding a member breaks implementers (unless default-implemented) | Adding a virtual member with a body is non-breaking |
| Value types | Structs can implement | Cannot inherit |

**Semantic distinction:** an interface is a **capability contract** ("can be serialised", "can be repaid") — a *can-do* relationship. An abstract class is a **partial implementation with a shared identity** — an *is-a* relationship with reusable state and behaviour.

**Architect's decision rules:**
- Default to **interfaces** for boundaries and ports (`IPaymentGateway`, `IEventPublisher`). They keep the graph flexible, are trivially mockable, and impose no hierarchy on implementers.
- Use an **abstract class** when there is genuine shared state and a template algorithm — the Template Method pattern (`abstract class PaymentProcessor` with a sealed `Process()` that calls abstract `Validate()`/`Authorise()`/`Capture()`).
- **Both together** is common and correct: `interface IPaymentGateway` for the contract, `abstract class PaymentGatewayBase : IPaymentGateway` for shared plumbing that concrete gateways *may* opt into.
- **Default interface members (C# 8+)** let you add a method to a published interface without breaking implementers. Use them for *versioning* an interface you don't control the implementers of — not as a general mixin mechanism. They come with real complexity (diamond resolution, no state, must be invoked through the interface).
- **Prefer composition over both.** In practice most "we need an abstract base" situations are better solved by injecting a collaborator.

---

## Q5. What are delegates?

A **delegate** is a type-safe function pointer — a class (deriving from `MulticastDelegate`) holding a *target object* and a *method pointer*, with an invocation list so it can be multicast.

```csharp
public delegate decimal FeeCalculator(decimal amount, string currency);

FeeCalculator flat = (a, c) => a * 0.02m;
FeeCalculator combined = flat + ((a, c) => a * 0.01m);   // multicast: last return value wins
```

**What matters at architect level:**

- **They are the substrate of everything functional in .NET**: `Func`/`Action`/`Predicate` are just generic delegate declarations; LINQ, events, callbacks and middleware (`RequestDelegate`) are all delegates.
- **Closures allocate.** A lambda capturing a variable becomes a compiler-generated display class on the heap, one per capture scope. In a hot loop this is a real allocation source. A lambda capturing *nothing* is cached as a static singleton by Roslyn — capture-free lambdas are effectively free.
- **Captured loop variables:** `foreach` variables are per-iteration since C# 5, but `for` loop variables are still shared — capturing `i` in a `for` loop and deferring execution gives you the final value. Classic bug.
- **Delegates keep targets alive.** A long-lived delegate holding an instance method target roots that object — the mechanism behind the classic event-handler memory leak (Q17).
- **Delegate vs interface:** a delegate is best for a single-method callback where the implementation is inline and incidental (`Func<T, bool>` predicate). An interface is better when the operation is a named, testable, injectable concept (`IFeeStrategy`) — the boundary in a Strategy pattern. As an architect: use delegates for *plumbing*, interfaces for *policy*.

---

## Q6. What are events?

An **event** is a delegate field with restricted access: only the declaring type can `Invoke` it or assign to it; the outside world can only `+=` and `-=`. That encapsulation is the entire point — without it, any consumer could clear all subscribers or raise the event.

```csharp
public sealed class PaymentProcessor
{
    public event EventHandler<PaymentAuthorizedEventArgs>? PaymentAuthorized;

    private void OnAuthorized(Payment p) =>
        PaymentAuthorized?.Invoke(this, new PaymentAuthorizedEventArgs(p));   // ?. reads the field once — thread-safe
}
```

**Production concerns:**

- **Memory leaks.** The publisher holds a strong reference to every subscriber. If a long-lived publisher (a singleton cache) holds a short-lived subscriber (a request-scoped service), the subscriber never gets collected. Always unsubscribe, use weak-event patterns, or scope the publisher correctly. This is one of the most common real .NET leaks.
- **Exceptions.** If one handler throws, the rest of the invocation list is not called and the exception propagates to the raiser. Wrap handler invocation if independence matters.
- **Synchronous and same-thread.** Events are not a message bus. They execute inline on the raising thread; a slow handler blocks the publisher.
- **`async void` handlers** are the standard event-handler shape and their exceptions cannot be caught by the raiser — they go to the unhandled-exception path and can kill the process. In server code, avoid events for async work entirely.

**Architect's position:** in-process events are fine for UI and for framework extension points, but for *domain* events in a distributed system, do not use C# events. Use an in-process mediator (MediatR notifications) for same-transaction handlers, and a broker (Kafka/SNS) with the Outbox pattern for cross-service events — because you need durability, retry, ordering and observability that C# events cannot provide. (See §14.)

---

## Q7. Explain `Func`, `Action` and `Predicate`.

Three built-in generic delegate families:

| Type | Signature | Returns |
|---|---|---|
| `Action<T1..T16>` | takes 0–16 args | `void` |
| `Func<T1..T16, TResult>` | takes 0–16 args, **last type parameter is the return type** | `TResult` |
| `Predicate<T>` | takes one arg | `bool` — functionally identical to `Func<T,bool>` |

```csharp
Action<Payment>            audit   = p => logger.LogInformation("Audited {Id}", p.Id);
Func<Payment, decimal>     feeOf   = p => p.Amount * 0.029m + 0.30m;
Predicate<Payment>         isLarge = p => p.Amount > 10_000m;
Func<Payment, Task<bool>>  authAsync = async p => await gateway.AuthorizeAsync(p);   // async delegate
```

**Notes an interviewer will probe:**
- `Predicate<T>` predates generics-heavy LINQ; the BCL now overwhelmingly uses `Func<T,bool>`. They are *not* implicitly convertible to each other (different types), which surprises people. Prefer `Func<T,bool>` for new code.
- **Async delegates** are `Func<..., Task>` / `Func<..., ValueTask>`. There is no `AsyncAction`; if you find yourself with `Action` for async work, you have created an `async void` and lost error handling.
- **`Func<T>` as a lazy/factory injection** is a legitimate DI pattern: inject `Func<IPaymentGateway>` when you need deferred or per-call creation without a service locator.
- **`Expression<Func<T,bool>>` is not `Func<T,bool>`.** The former is a *data structure* describing the code, which is what makes `IQueryable` translation to SQL possible (Q11).

---

## Q8. What are generics and why are they important?

Generics parameterise types and methods over types, giving **compile-time type safety with no boxing and no casting**.

**How the runtime implements them — the part that matters:**
- For **reference type** arguments, the JIT shares **one** native code instantiation across all of them (references are all pointer-sized).
- For **value type** arguments, the JIT generates a **specialised** instantiation per type. This is why `List<int>` stores ints inline with zero boxing and performs like a hand-written int array, unlike Java's type-erased generics.
- Generic type information survives to runtime (reifed generics), so `typeof(List<int>) != typeof(List<string>)` and reflection can see the arguments.

**Why they matter architecturally:**
- **Performance:** no boxing on value types, no cast checks. `List<int>` vs `ArrayList` is an order-of-magnitude difference in allocation.
- **API expressiveness:** `Result<TValue, TError>`, `IRepository<TEntity, TKey>`, `IRequestHandler<TRequest, TResponse>` (MediatR) — the whole CQRS handler dispatch pattern depends on open generic registration:
  ```csharp
  services.AddScoped(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));
  ```
- **Constraints** turn generic code from "anything" into "anything that can do X": `where T : class`, `struct`, `new()`, `IComparable<T>`, `notnull`, `unmanaged`, and — since C# 11 — **static abstract members**, which finally allow generic math and generic factory patterns:
  ```csharp
  static T Sum<T>(IEnumerable<T> xs) where T : INumber<T>
      => xs.Aggregate(T.Zero, (a, b) => a + b);
  ```

**Costs to acknowledge:** code bloat for many value-type instantiations, harder AOT/trimming stories with deep generic reflection, and unreadable APIs when generics are over-applied. `IRepository<TEntity, TKey, TContext, TSpec>` is a smell, not a design.

---

## Q9. Explain covariance and contravariance.

**Variance is about safe assignability of generic types when the type argument changes.**

- **Covariance (`out`)** — preserves assignment direction. `IEnumerable<Derived>` is assignable to `IEnumerable<Base>`. Legal only when `T` appears in **output** positions.
- **Contravariance (`in`)** — reverses it. `IComparer<Base>` is assignable to `IComparer<Derived>`. Legal only when `T` appears in **input** positions.
- **Invariance** — the default. `List<Derived>` is *not* a `List<Base>`.

```csharp
IEnumerable<CardPayment> cards = ...;
IEnumerable<Payment> payments = cards;     // OK: IEnumerable<out T>

Action<Payment> logAny = p => Log(p);
Action<CardPayment> logCard = logAny;      // OK: Action<in T>

List<CardPayment> list = ...;
List<Payment> bad = list;                  // COMPILE ERROR — and rightly so
```

**Why `List<T>` must be invariant:** it both reads and writes `T`. If covariance were allowed, you could take a `List<CardPayment>` as `List<Payment>` and insert a `BankTransferPayment` — corrupting the list. The rule is enforced by the compiler precisely to prevent this.

**Array covariance is the historical mistake.** `Payment[] arr = new CardPayment[10];` compiles (C# inherited this from Java for pre-generics reasons) but throws `ArrayTypeMismatchException` **at runtime** on a bad store, and imposes a covariance check on *every* array store. Cite this as the canonical example of unsound variance.

**Practical impact:** variance is why you can pass `List<Order>` to a method taking `IEnumerable<IOrder>`, why `Func<in T, out TResult>` composes so freely, and why you should declare `out`/`in` on your own interfaces where the usage permits — it removes a whole class of pointless adapter code from callers.

---

## Q10. What is boxing/unboxing?

**Boxing** wraps a value type in a heap-allocated object so it can be treated as `object` or a non-generic interface. **Unboxing** extracts it, with a runtime type check.

```csharp
int i = 42;
object boxed = i;        // boxing: heap allocation + copy
int j = (int)boxed;      // unboxing: type check + copy
```

**Cost:** an allocation (24 bytes on x64 for an int: header + method table + payload, padded), a copy, GC pressure, and a cache miss on access. In a tight loop it dominates.

**Where boxing sneaks in — this is the real interview content:**

```csharp
// 1. Non-generic collections
ArrayList list = new(); list.Add(42);                       // boxed

// 2. String concatenation / non-generic APIs
string s = "id=" + id;                                      // boxes if id is a struct without an overload
Console.WriteLine("{0}", someStruct);                        // boxes (object[] params)

// 3. Interface calls on structs through an interface reference
IComparable c = 42;                                          // boxed

// 4. Struct implementing an interface, used as an unconstrained generic
void M<T>(T x) { var s = ((IFormattable)x).ToString(); }      // boxes; constrain with where T : IFormattable to avoid

// 5. LINQ over value types with object-typed operators, and Enum.HasFlag before .NET Core 2.1
// 6. Logging with object[] params — the reason ILogger has generic overloads and source-generated logging
```

**How to avoid it:** generics with constraints, `Span<T>`, `IEquatable<T>`/`IComparable<T>` (generic versions — implementing them lets `EqualityComparer<T>.Default` avoid boxing), `record struct` (structural equality without `ValueType.Equals` reflection), source-generated logging (`[LoggerMessage]`), and `string.Create`/interpolated string handlers.

**How to detect it:** the JIT emits `box` IL — inspect with ILSpy/sharplab; measure with BenchmarkDotNet's `MemoryDiagnoser` (allocations per op should be 0 on hot paths); in production, high Gen0 collection rate with low surviving bytes is the signature.

---

## Q11. Explain `IEnumerable`, `IQueryable` and `IAsyncEnumerable`.

| | `IEnumerable<T>` | `IQueryable<T>` | `IAsyncEnumerable<T>` |
|---|---|---|---|
| Execution | In-memory, lazy, pull | **Translated** to another language (SQL) by a provider | Lazy, pull, **asynchronous** |
| Lambda form | `Func<T,bool>` — compiled code | `Expression<Func<T,bool>>` — an AST | `Func<T,bool>` |
| Iteration | `foreach` | `foreach` (triggers translation + execution) | `await foreach` |
| Where it runs | Your process | The database | Your process, non-blocking on each step |

**The critical distinction (LINQ-to-Objects vs LINQ-to-Entities):**

```csharp
// IQueryable — the predicate becomes an expression tree, translated to SQL WHERE.
// One row leaves the database.
var q = db.Payments.Where(p => p.Amount > 10_000).First();

// IEnumerable — AsEnumerable() ends translation. The ENTIRE table is streamed into memory
// and filtered in C#. This is the single most expensive mistake in EF Core code.
var e = db.Payments.AsEnumerable().Where(p => p.Amount > 10_000).First();
```

Returning `IEnumerable<T>` from a repository *deliberately* closes the query — nothing further composes into SQL. Returning `IQueryable<T>` lets callers compose but **leaks persistence concerns into the application layer** and makes it possible for a caller to accidentally trigger a table scan or a lazy-load N+1. My architectural rule: **repositories return materialised results or accept a specification; `IQueryable` does not cross the application boundary.**

**`IAsyncEnumerable<T>` (C# 8)** is for streaming asynchronous sequences without buffering everything:

```csharp
public async IAsyncEnumerable<Payment> StreamAsync([EnumeratorCancellation] CancellationToken ct)
{
    await foreach (var p in db.Payments.AsAsyncEnumerable().WithCancellation(ct))
        yield return p;
}
```

Use it for large result sets, Kafka/queue consumption, and server-streaming gRPC — anywhere `Task<List<T>>` would mean holding the whole set in memory. Note `[EnumeratorCancellation]` — without it the token passed to `WithCancellation` is silently ignored, a subtle and common bug. ASP.NET Core can return `IAsyncEnumerable<T>` directly from an action and stream the JSON array.

---

## Q12. What are records?

`record` (C# 9) and `record struct` (C# 10) are **reference/value types with compiler-generated value semantics**: structural `Equals`/`GetHashCode`, `ToString` printing members, deconstruction, and `with`-expression non-destructive mutation.

```csharp
public record Payment(Guid Id, decimal Amount, string Currency)
{
    public bool IsLarge => Amount > 10_000m;
}

var a = new Payment(id, 100m, "USD");
var b = a with { Amount = 200m };     // new instance, everything else copied
a == new Payment(id, 100m, "USD");    // true — structural equality
```

**What the compiler actually generates:** an `EqualityContract`, `Equals(T)`/`Equals(object)`/`GetHashCode` over all fields, `==`/`!=`, a protected **copy constructor** used by `with`, `PrintMembers`/`ToString`, and `Deconstruct` for positional records. Init-only setters make positional properties immutable.

**Where I use them:**
- **DTOs and API contracts** — immutable, value-compared, concise.
- **Domain value objects** — `record struct Money(decimal Amount, Currency Currency)`.
- **Commands, queries and events** in CQRS/event-sourced systems — events *must* be immutable, and structural equality makes tests trivial.
- **Configuration/options objects.**

**Where I do not:** entities with identity and mutable lifecycle. An `Order` is equal to another `Order` because their **IDs** match, not because every field matches — that is exactly the opposite of record semantics. Use a class with an explicit identity-based `Equals`.

**Caveats:** equality is **shallow** — a record containing a `List<T>` compares the list by reference, so two "equal-looking" records are unequal. Inheritance and equality interact through `EqualityContract` (a base record is never equal to a derived one, which is correct but surprising). And records are not automatically serialization-friendly for every serializer — positional records need a constructor-binding-capable serializer (`System.Text.Json` handles this since .NET 5, with `[JsonConstructor]` when ambiguous).

---

## Q13. What is immutability?

**Definition:** an object whose observable state cannot change after construction.

**How to achieve it in C#:** `readonly` fields, `init`-only or get-only properties, `record`/`readonly record struct`, immutable collections (`ImmutableArray<T>`, `ImmutableDictionary<K,V>`, or `FrozenDictionary` for read-heavy lookup built once), defensive copying at the boundary, and — critically — **deep** immutability, not just the outer object.

**Why it matters to an architect:**

1. **Thread safety for free.** An immutable object cannot race. In a high-concurrency server this removes whole categories of bug and whole categories of lock. Sharing an immutable config snapshot across 1000 concurrent requests needs no synchronisation.
2. **Reasoning and debugging.** A value that cannot change cannot be changed by a distant caller. "Who mutated this?" stops being a question.
3. **Safe caching and sharing.** You can hand the same instance to many callers without defensive copies.
4. **Correctness of dictionary keys.** Mutating an object after using it as a key corrupts the hash bucket. Immutable keys make that impossible.
5. **Event sourcing and audit.** Events are immutable facts; the whole model depends on it. (See §13.)
6. **Functional composition.** `with`-expressions give cheap derived states without shared-mutable-state bugs.

**Costs to be honest about:** allocation per change (a `with` on a large record copies it), and awkwardness in ORM/entity scenarios where the framework needs to materialise and track mutable state. My pragmatic rule: **immutable by default for values, DTOs, events, commands and configuration; mutable only where identity and lifecycle genuinely demand it (entities, aggregates), and even there mutate only through methods that enforce invariants** — never public setters.

---

## Q14. Explain garbage collection in .NET.

**Model:** a tracing, generational, mark-and-sweep collector with compaction. Memory is reclaimed by *reachability*, not reference counting, so cycles are collected.

**The cycle:**
1. **Allocation** is a pointer bump in the Gen0 allocation context — extremely cheap, comparable to stack allocation.
2. When Gen0 fills (its budget is dynamic, roughly the size of the L2 cache), a collection triggers.
3. **Mark:** starting from roots (stack locals, statics, CPU registers, GC handles, finalisation queue), the collector traces every reachable object.
4. **Sweep/compact:** unreachable objects' space is reclaimed; survivors are compacted (moving objects and updating references) to eliminate fragmentation, then **promoted** to the next generation.

**Key mechanisms to name:**
- **Generational hypothesis** — most objects die young. Collecting only Gen0 is cheap and catches most garbage.
- **Card table / write barriers** — track old→young references so a Gen0 collection doesn't have to scan the whole heap.
- **Ephemeral segment** — Gen0 and Gen1 live together and are collected together in a Gen1 collection.
- **Background GC** — Gen2 collections run mostly concurrently with the application; only short pauses suspend threads.
- **Workstation vs Server GC.** Server GC uses one heap and one GC thread **per core**, dramatically higher throughput for multi-core servers, at the cost of more memory. **Always enable Server GC for server workloads** (`<ServerGarbageCollection>true</ServerGarbageCollection>`), but be careful in containers: set `DOTNET_GCHeapHardLimit` or rely on .NET's container-limit awareness so the GC sizes to the cgroup limit, not the host.
- **Concurrent/SustainedLowLatency modes**, and `GCSettings.LatencyMode` for short critical regions.
- **`GC.TryStartNoGCRegion`** for latency-critical windows (e.g. a market-open burst) — advanced, rarely correct, but worth knowing for a trading-systems interview.

**What GC does *not* do:** release unmanaged resources (file handles, sockets, native memory) — that is what `IDisposable` and finalizers are for; and it does not prevent leaks caused by unintended references (Q17).

---

## Q15. What are Gen 0, Gen 1 and Gen 2?

- **Gen 0** — brand-new small objects. Collected very frequently, very cheaply. Most objects die here and are never even touched by the collector (dead objects cost nothing; only survivors are copied).
- **Gen 1** — Gen 0 survivors. Acts as a **buffer** between short- and long-lived objects, so that objects which are merely "in flight" during a Gen0 collection don't get promoted straight to the expensive generation.
- **Gen 2** — Gen 1 survivors: long-lived objects — singletons, caches, static data, compiled artefacts. Collected rarely; a **full blocking Gen2 collection is the expensive one** and is what shows up as a latency spike.

A GC of generation *N* also collects all generations below it. So a Gen2 collection is a full collection.

**Diagnostics to quote:**
- Healthy service: high Gen0 rate, low promotion rate, rare Gen2.
- **Bad signature:** a high Gen2 collection rate, or a rising `% Time in GC` (over ~10 % is a problem), or a growing gap between allocated and surviving bytes. That means objects are surviving that shouldn't — usually a cache without bounds, an event-handler leak, or mid-lifetime objects (a request-scoped object held by a singleton).
- **Mid-life crisis** — objects that survive Gen0/Gen1 but die shortly after promotion. The most expensive allocation pattern. Typical cause: buffering large per-request state, or an over-eager cache with a short-lived working set.

Counters: `dotnet-counters monitor --counters System.Runtime` gives gen sizes, collection counts per generation, allocation rate, `% time in GC`, and LOH size.

---

## Q16. What is the Large Object Heap?

Objects **≥ 85,000 bytes** (and `double[]` ≥ 1000 elements) are allocated on the **LOH**, a separate heap that:

- is **collected only with Gen 2** (so LOH garbage lives until a full collection),
- is **not compacted by default** (compaction is expensive because it moves large blocks),
- therefore **fragments**: free blocks exist but none is contiguous enough for the next big allocation, so the heap grows, and you can get `OutOfMemoryException` with plenty of "free" memory.

**Typical culprits in a .NET service:** large `byte[]` buffers for file/HTTP payloads, big `string`s from serializing large JSON, `List<T>` growth (doubling reallocates — a list growing to 100k items allocates a series of ever-larger arrays, several of which land on the LOH), `MemoryStream` growth, large report/export generation.

**Mitigations, in order of preference:**
1. **Don't allocate large arrays repeatedly** — use `ArrayPool<byte>.Shared.Rent/Return`, `RecyclableMemoryStream`, and `IBufferWriter<T>`/`PipeWriter` for streaming.
2. **Stream, don't buffer.** Read/write with `Stream`, `System.IO.Pipelines`, `IAsyncEnumerable<T>`, and serialize directly to the response body rather than to an intermediate `string` or `MemoryStream`.
3. **Pre-size collections** (`new List<T>(capacity)`) to avoid the doubling ladder.
4. **Chunk the work.** 10 batches of 10k rows beats one batch of 100k.
5. As a last resort, `GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce` before an induced Gen2 collection — a maintenance-window tool, never a steady-state design.

---

## Q17. How do you diagnose memory leaks?

**Definition in a managed runtime:** not "forgot to free" but "still reachable, no longer needed."

**Method — the sequence I would actually run in production:**

1. **Confirm it is a leak, not just a large heap.** Watch working set and *managed heap size* over hours. A leak is a monotonic rise across GCs that never returns to baseline. `dotnet-counters monitor --process-id <pid> --counters System.Runtime` shows gen sizes, `gc-heap-size`, LOH size, allocation rate.
2. **Distinguish managed vs unmanaged.** If working set climbs but the managed heap is flat, the leak is native — unclosed sockets/handles, a native library, or (very commonly) **unbounded `HttpClient` handler creation**. Check handle count and `dotnet-counters` for `ThreadPool Thread Count`.
3. **Capture heap dumps.** `dotnet-dump collect -p <pid>` at two points in time. Compare.
4. **Analyse.** `dotnet-dump analyze` → `dumpheap -stat` (what types dominate), then `gcroot <address>` on a representative instance — **this is the money command**: it tells you *who is holding the reference*. Or use Visual Studio's managed heap analysis / dotMemory for a diff view.
5. **Read the retention path** and fix the root, not the symptom.

**The recurring root causes, in the order I actually find them:**

| Cause | Signature |
|---|---|
| **Static/singleton collection that only grows** (a hand-rolled cache, a dictionary of "recent" items) | One type dominating the heap, rooted by a static |
| **Event handlers never unsubscribed** | Subscriber objects rooted by a long-lived publisher's delegate |
| **Captured `HttpContext`/scoped services in a singleton** | Request-scoped types alive long past the request |
| **Timers / `CancellationTokenSource` never disposed**; `CTS.Register` callbacks never unregistered | Growing timer queue; CTS holding delegates |
| **`IDisposable` not disposed** (streams, `SqlConnection`, `HttpResponseMessage`) | Finalisation queue growth, handle-count growth |
| **New `HttpClient` per call** | Socket exhaustion + TIME_WAIT, not strictly a heap leak but presents similarly |
| **`ThreadLocal`/`AsyncLocal` misuse** | Values retained per thread in a pooled-thread environment |
| **`ConditionalWeakTable` misunderstood, or strong caches keyed by long-lived objects** | Subtle retention |
| **LOH fragmentation** | OOM with free memory available (Q16) |

**Prevention as an architect:** bounded caches with size *and* time limits (`MemoryCacheEntryOptions.SetSize` + `SizeLimit`), `IDisposable`/`IAsyncDisposable` discipline enforced by analyzers (CA2000/CA1001), `IHttpClientFactory` mandated, `ValidateScopes` on, and a soak test (sustained load for hours) in the pipeline — leaks are invisible in a 60-second load test and obvious in a 6-hour one.

---

## Q18. Explain `IDisposable` and `IAsyncDisposable`.

**`IDisposable`** is the deterministic-cleanup contract for **unmanaged or scarce resources**: file handles, sockets, DB connections, native memory, OS synchronisation primitives, pooled objects.

```csharp
public sealed class LedgerClient : IDisposable, IAsyncDisposable
{
    private readonly SqlConnection _conn;
    private bool _disposed;

    public void Dispose()
    {
        if (_disposed) return;
        _conn.Dispose();
        _disposed = true;
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        await _conn.DisposeAsync();     // async flush/close — no blocking on network I/O
        _disposed = true;
    }
}

using var client = new LedgerClient();          // sync
await using var client2 = new LedgerClient();   // async — calls DisposeAsync
```

**The full Dispose pattern** (`protected virtual void Dispose(bool disposing)` + finalizer + `GC.SuppressFinalize`) is only needed when you **directly own unmanaged resources** and the class is unsealed. For the 95 % case — a sealed class wrapping other managed disposables — the simple form above is correct and preferable. Prefer `SafeHandle` over writing a finalizer at all.

**Why `IAsyncDisposable` exists:** disposal that involves I/O (flushing a network buffer, sending a close frame, committing offsets) would otherwise block a thread-pool thread. `await using` keeps it non-blocking. `ValueTask` is used because disposal is usually synchronous in practice.

**Rules I enforce:**
- **Never call `Dispose()` on something injected by the DI container** — the container owns the lifetime; disposing it early breaks other consumers.
- **`Dispose` must be idempotent and must not throw.**
- **Implement both** when the type can be used in an async context; if a type implements `IAsyncDisposable`, `await using` it.
- **Analyzer coverage** (CA2000/CA1063/CA1816) rather than code review vigilance.
- **Finalizers are a last resort**: they add an object to the finalisation queue, delay collection by at least one extra GC cycle, run on a single finalizer thread (a slow finalizer stalls all of them), and run in an unpredictable order. `SafeHandle` exists so you almost never need one.

---

## Q19. What is dependency inversion?

**The principle (the "D" in SOLID), in two clauses:**
1. High-level modules should not depend on low-level modules; **both should depend on abstractions**.
2. Abstractions should not depend on details; **details should depend on abstractions**.

**The subtlety most candidates miss:** DIP is not "use interfaces". It is about **who owns the abstraction**. The interface belongs to the *consumer's* layer, not the implementer's. `IPaymentGateway` is defined in the Application/Domain project and *implemented* in Infrastructure. That single ownership decision is what inverts the dependency arrow at build time and is why Clean/Hexagonal architecture works at all.

```
WRONG (no inversion — just indirection):
  Application ──▶ Infrastructure.IStripeGateway ──▶ Stripe SDK

RIGHT (inverted):
  Application ──▶ Application.IPaymentGateway
                          ▲
                          │ implements
                  Infrastructure.StripeGateway ──▶ Stripe SDK
```

The compile-time dependency now points *inward*, toward policy. Infrastructure can be replaced, mocked, or deleted without touching a line of domain code.

**Dependency Inversion vs Inversion of Control vs Dependency Injection:**
- **DIP** — a design principle about the direction of dependencies.
- **IoC** — the general idea of the framework calling you.
- **DI** — a specific technique (constructor injection) for supplying dependencies.
You can do DI without DIP (injecting a concrete `SqlPaymentRepository` into a domain service — injection, no inversion), and DIP without a container (manual composition root).

**Practical value in an architecture:** testability (substitute a fake gateway), replaceability (Stripe → Adyen with no domain change), parallel development against a contract, and **protecting the stable core from volatile details** — the actual business reason, and the one to lead with.

**Where to stop:** not every class needs an interface. Apply DIP at *boundaries you expect to change or need to isolate* — persistence, external APIs, messaging, time, randomness. Inverting internal helper classes just adds indirection with no benefit.

---

## Q20. How would you design highly maintainable C# code?

Maintainability is a property of *change cost*. Answer it as a set of deliberate decisions:

**1. Boundaries first.** Organise by feature/bounded context, not by technical layer (`Payments/`, `Settlement/` — not `Controllers/`, `Services/`, `Repositories/` at the top level). The reason: change requests arrive by feature, and vertical slices localise them. Enforce with project references and architecture tests.

**2. Explicit dependencies.** Constructor injection only; no service locator, no statics with state, no ambient `DateTime.Now` (inject `TimeProvider` — .NET 8's built-in abstraction; it makes time testable, which is transformative in a settlement/scheduling system).

**3. Model the domain, not the database.** Rich types over primitives (`Money`, `AccountId`, `Iban` instead of `decimal`, `Guid`, `string`) — this alone eliminates a category of bugs where arguments are silently swapped. Encapsulate invariants inside aggregates; no public setters on entities.

**4. Immutability by default.** Records for DTOs/events/values; mutation only through intention-revealing methods.

**5. Make illegal states unrepresentable.** Nullable reference types on (`<Nullable>enable</Nullable>`, warnings as errors), exhaustive `switch` expressions over closed hierarchies, `Result<T>`/discriminated-union style returns for expected failures instead of exceptions for control flow.

**6. Small, single-purpose units.** SOLID applied with judgement — SRP as "one reason to change", OCP via strategy/polymorphism where variation is real, not speculative. Resist the urge to abstract before the second use case exists (YAGNI beats speculative generality).

**7. Consistent, enforced style.** `.editorconfig`, analyzers (`Microsoft.CodeAnalysis.NetAnalyzers`, `TreatWarningsAsErrors`), nullable + trimming warnings on, one formatter, no debate in code review about braces. Machine-enforced conventions free review capacity for design.

**8. Tests as the safety net that makes change cheap.** Unit tests on the domain (fast, no I/O, no mocks of your own types), integration tests on adapters using Testcontainers against real SQL/Kafka, architecture tests for dependency rules, contract tests between services, and a small set of end-to-end smoke tests. Test behaviour, not implementation — over-mocked tests are the main reason codebases become *harder* to change with more tests.

**9. Observability built in, not bolted on.** Structured logs, traces, business metrics from day one. Code you cannot observe is code you cannot safely change.

**10. Documentation that stays true.** ADRs (Architecture Decision Records) for the *why*, a README that gets you running in one command, and XML docs only on public contracts. Anything else rots.

**Closing framing:** *"Maintainable code is code where the cost of the tenth change is not higher than the cost of the first. Everything above is in service of keeping that curve flat — and the two biggest levers are clear boundaries and a fast, trustworthy test suite."*

---

**Previous:** [01 — ASP.NET Core Architecture](./01-AspNetCore-Architecture.md) | **Next:** [03 — Async/Await & Performance](./03-Async-Await-Performance.md)

---

## References — official documentation

| Topic | Source |
|---|---|
| Value types vs reference types | https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/value-types |
| Choosing between class and struct | https://learn.microsoft.com/dotnet/standard/design-guidelines/choosing-between-class-and-struct |
| `struct` type / `readonly struct` | https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/struct |
| `ref struct` (`Span<T>`) | https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/ref-struct |
| Memory and span usage guidelines | https://learn.microsoft.com/dotnet/standard/memory-and-spans/memory-t-usage-guidelines |
| Interfaces / default interface methods | https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/interface |
| Delegates | https://learn.microsoft.com/dotnet/csharp/programming-guide/delegates/ |
| Events | https://learn.microsoft.com/dotnet/csharp/events-overview |
| Generics in .NET | https://learn.microsoft.com/dotnet/standard/generics/ |
| Covariance and contravariance | https://learn.microsoft.com/dotnet/standard/generics/covariance-and-contravariance |
| Boxing and unboxing | https://learn.microsoft.com/dotnet/csharp/programming-guide/types/boxing-and-unboxing |
| `IEnumerable<T>` vs `IQueryable<T>` | https://learn.microsoft.com/dotnet/api/system.linq.iqueryable-1 |
| `IAsyncEnumerable<T>` | https://learn.microsoft.com/dotnet/api/system.collections.generic.iasyncenumerable-1 |
| Records | https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/record |
| Garbage collection fundamentals | https://learn.microsoft.com/dotnet/standard/garbage-collection/fundamentals |
| Workstation vs Server GC | https://learn.microsoft.com/dotnet/standard/garbage-collection/workstation-server-gc |
| Large Object Heap | https://learn.microsoft.com/dotnet/standard/garbage-collection/large-object-heap |
| GC in containers / heap limits | https://learn.microsoft.com/dotnet/core/runtime-config/garbage-collector |
| Diagnosing memory leaks (tutorial) | https://learn.microsoft.com/dotnet/core/diagnostics/debug-memory-leak |
| `dotnet-dump` / `dotnet-counters` | https://learn.microsoft.com/dotnet/core/diagnostics/ |
| Implementing `IDisposable` / `IAsyncDisposable` | https://learn.microsoft.com/dotnet/standard/garbage-collection/implementing-dispose |
| Dependency inversion (architecture guide) | https://learn.microsoft.com/dotnet/architecture/modern-web-apps-azure/architectural-principles |
