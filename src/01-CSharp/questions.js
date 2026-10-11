(function (r) {
registerTopic('01-csharp', {
related: ['02-dotnet-aspnetcore', '56-linq-efcore', '09-oop'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['types', 'memory'],
  code: r`~~~csharp
public struct PointS { public int X; }          // value type: copied on assignment
public class  PointC { public int X; }          // reference type: reference copied

var s1 = new PointS { X = 1 }; var s2 = s1; s2.X = 99;   // s1.X is still 1
var c1 = new PointC { X = 1 }; var c2 = c1; c2.X = 99;   // c1.X is now 99

// Mutable struct trap: List indexer returns a copy
var list = new List<PointS> { new() { X = 1 } };
// list[0].X = 5;                 // CS1612: cannot modify the return value (it is a copy)
var tmp = list[0]; tmp.X = 5; list[0] = tmp;
~~~`,
  q: r`What is the difference between value types and reference types in C#?`,
  a: r`A **value type** (struct, enum, primitives) holds its data directly; copying it copies the data. A **reference type** (class, interface, delegate, array, string) holds a reference to an object on the managed heap; copying it copies the reference, so two variables can point at one object.

Consequences:

- Assignment and parameter passing copy the value for structs, so mutation inside a method does not affect the caller.
- Reference types are garbage collected; value types have no per-object header and no GC cost of their own.
- {{null}} is valid for references by default; value types need {{Nullable<T>}} ({{int?}}).

Where a value lives is *not* simply "structs on the stack": a struct field of a class lives inside that heap object, a captured struct in a closure is heap allocated, and a boxed struct is a heap object.`,
  pts: [r`Copy semantics differ: data vs reference`, r`Value types are not always on the stack`, r`Structs have no inheritance (only interfaces)`, r`Choose struct for small, immutable, short-lived data`],
  ex: r`A {{Money}} value (amount + currency) is a good small immutable struct or record struct; a {{Customer}} entity with identity is a class.`,
  fu: [r`What is boxing and why does it matter?`, r`When does a struct end up on the heap?`],
  pit: [r`Saying "value types live on the stack, reference types on the heap" without the exceptions.`] },

{ id: 'q2', level: 'Basic', tags: ['equality'],
  code: r`~~~csharp
string a = "hello", b = new string("hello".AsSpan());
Console.WriteLine(a == b);                     // True: string overloads == for value equality
Console.WriteLine(ReferenceEquals(a, b));      // False: different instances
object oa = a, ob = b;
Console.WriteLine(oa == ob);                   // False: object == is reference equality (static types decide)
Console.WriteLine(oa.Equals(ob));              // True: virtual Equals dispatches to string.Equals

record Money(decimal Amount, string Currency);
Console.WriteLine(new Money(1, "GBP") == new Money(1, "GBP"));   // True: records generate value equality
~~~`,
  q: r`Explain ==, Equals(), and ReferenceEquals().`,
  a: r`- {{ReferenceEquals(a, b)}}: true only if both refer to the same object (for value types, always false after boxing).
- {{a.Equals(b)}}: virtual method; default for classes is reference equality, for structs a field-by-field comparison (slow via reflection unless overridden), for {{string}} and records value equality.
- {{a == b}}: operator; by default reference equality for classes, but can be overloaded ({{string}} compares content, records generate it).

If you override {{Equals}}, also override {{GetHashCode}} consistently (equal objects must produce equal hashes) and prefer implementing {{IEquatable<T>}} to avoid boxing in generic collections.

Records give you value equality, {{GetHashCode}}, and {{IEquatable<T>}} for free.`,
  pts: [r`Override Equals and GetHashCode together`, r`Implement IEquatable<T> for structs`, r`Records have value-based equality`, r`Mutable fields in hash codes break dictionaries`],
  ex: r`A {{record struct OrderId(Guid Value)}} works correctly as a {{Dictionary}} key with no extra code.`,
  fu: [r`What breaks if GetHashCode changes after the object is in a HashSet?`],
  pit: [r`Overriding Equals but forgetting GetHashCode.`] },

{ id: 'q3', level: 'Basic', tags: ['boxing', 'performance'],
  code: r`~~~csharp
int n = 42;
object boxed = n;                 // allocation on the heap
int back = (int)boxed;            // unbox: type check + copy

var legacy = new System.Collections.ArrayList { 1, 2, 3 };   // boxes every int
var modern = new List<int> { 1, 2, 3 };                       // no boxing

// Hidden boxing: struct through a non-generic interface, string interpolation of old APIs
IComparable c = n;                                            // boxes
static bool Less<T>(T x, T y) where T : IComparable<T> => x.CompareTo(y) < 0;  // generic: no boxing
~~~`,
  q: r`What is boxing and unboxing, and how do you avoid it?`,
  a: r`**Boxing** wraps a value type in a heap-allocated object (when assigned to {{object}} or an interface it implements). **Unboxing** casts back and copies the value out, with a type check.

Costs: an allocation, a copy, and GC pressure. Hidden sources: non-generic collections ({{ArrayList}}), {{string.Format}} with value arguments, calling an interface method on a struct through the interface type, {{Enum.ToString()}} in older paths, and {{object.Equals}} on structs.

Avoid by using generics ({{List<int>}}), generic constraints ({{where T : struct, IComparable<T>}}, which are constrained calls and do not box), {{IEquatable<T>}}, and interpolated string handlers.`,
  pts: [r`Boxing = heap allocation + copy`, r`Generics remove most boxing`, r`Constrained calls on generic T do not box`, r`Find it with allocation profilers`],
  ex: r`A hot-path {{Dictionary<object, int>}} keyed by ints was boxing every lookup; changing the key type to {{int}} removed 40% of allocations.`,
  fu: [r`Does foreach over List<T> box?`, r`Why is a struct enumerator not boxed by foreach?`],
  pit: [r`Assuming boxing only happens on explicit casts.`] },

{ id: 'q4', level: 'Basic', tags: ['types'],
  q: r`When would you choose a struct over a class?`,
  a: r`Prefer a struct when the type is **small (roughly under 16 bytes), logically a single value, immutable, short-lived**, and not frequently boxed. Typical: {{DateTime}}, {{Guid}}, {{Money}}, coordinates.

Avoid structs when: the type is large (copying cost), mutable (copies diverge silently), needs inheritance, or is mostly used through interfaces (boxing).

Guidelines: make them {{readonly struct}} so the compiler avoids defensive copies; implement {{IEquatable<T>}}; pass large ones by {{in}} reference only after measuring.

~~~csharp
public readonly record struct Money(decimal Amount, string Currency)
{
    public Money Add(Money other) => Currency == other.Currency
        ? this with { Amount = Amount + other.Amount }
        : throw new InvalidOperationException("Currency mismatch");
}
~~~`,
  pts: [r`Small, immutable, value-like`, r`readonly struct avoids defensive copies`, r`Mutable structs are a bug source`, r`Measure before optimising`],
  ex: r`A market-data tick as a {{readonly struct}} stored in an array avoids one object per tick (millions per second).`,
  fu: [r`What is a defensive copy?`, r`Why is List<MutableStruct>[i].X = 1 a compile error?`],
  pit: [r`Choosing struct "for performance" for a 60-byte mutable type.`] },

{ id: 'q5', level: 'Basic', tags: ['nullability'],
  code: r`~~~csharp
#nullable enable
public sealed class Customer
{
    public required string Name { get; init; }      // non-null contract
    public string? MiddleName { get; init; }         // explicitly optional
}
static int NameLength(Customer c) => c.Name.Length + (c.MiddleName?.Length ?? 0);

// Compile-time only: JSON can still deliver null into a non-nullable property
var c = JsonSerializer.Deserialize<Customer>("{\"Name\":null}");   // no runtime guarantee
ArgumentNullException.ThrowIfNull(c?.Name);                         // validate at the boundary
~~~`,
  q: r`What are nullable reference types and what do they actually guarantee?`,
  a: r`With {{<Nullable>enable</Nullable>}}, the compiler treats reference types as non-null by default and tracks whether {{T?}} values have been checked. It produces **warnings**, not runtime guarantees: nothing stops a {{null}} arriving from reflection, JSON deserialisation, or an unannotated library.

Use annotations ({{string?}}), attributes ({{[NotNullWhen(true)]}}, {{[MemberNotNull]}}), {{required}} members, and the null-forgiving {{!}} sparingly (it silences the compiler, it does not check).

Boundaries (deserialisers, EF entities, DI) still need runtime validation; treat the feature as a design tool that documents intent and catches mistakes early.`,
  pts: [r`Compile-time flow analysis only`, r`Treat warnings as errors in new code`, r`Validate at trust boundaries`, r`Avoid the ! operator as a habit`],
  ex: r`Enabling nullable on a 200k-LOC service surfaced 38 real null-dereference paths in the first week.`,
  fu: [r`How do you migrate a large codebase incrementally?`],
  pit: [r`Sprinkling ! to make warnings disappear.`] },

{ id: 'q6', level: 'Basic', tags: ['oop'],
  code: r`~~~csharp
public interface IClock { DateTimeOffset UtcNow { get; } }                 // capability / port
public interface IShape { double Area { get; } double Perimeter => 0; }    // default member (C# 8)

public abstract class Repository<T>(DbContext db) where T : class          // shared state + helpers
{
    protected DbSet<T> Set => db.Set<T>();
    public virtual Task<T?> FindAsync(Guid id, CancellationToken ct) => Set.FindAsync([id], ct).AsTask();
}
~~~`,
  q: r`Interface versus abstract class: how do you choose?`,
  a: r`An **interface** defines a contract with no state; a class can implement many. Since C# 8 interfaces can have default implementations, but they are for evolving contracts, not for sharing code by habit.

An **abstract class** can hold state, constructors, and shared implementation; a class can inherit only one.

Choose an interface for capabilities and for seams you want to mock or substitute (dependency inversion). Choose an abstract class when subclasses share significant behaviour and an "is-a" relationship, and you control the hierarchy. Prefer **composition over inheritance** when in doubt.`,
  pts: [r`Interfaces = capability / contract`, r`Abstract class = shared implementation + state`, r`Default interface methods are for evolution`, r`Prefer composition`],
  ex: r`{{IPaymentGateway}} (interface) with {{StripeGateway}} and {{AdyenGateway}} implementations; a shared {{GatewayBase}} abstract class only if they truly share retry and logging code.`,
  fu: [r`What is the diamond problem and how do default interface methods handle it?`],
  pit: [r`Creating an interface for every class "just in case".`] },

{ id: 'q7', level: 'Intermediate', tags: ['delegates', 'events'],
  q: r`Explain delegates, events, Func/Action, and the memory-leak risk of events.`,
  a: r`A **delegate** is a type-safe function reference (multicast: it holds an invocation list). {{Func<>}} returns a value, {{Action<>}} does not, {{Predicate<T>}} returns bool. An **event** is a delegate field with restricted access: outsiders can only {{+=}} / {{-=}}, only the owner can raise it.

Leak: a subscriber is held strongly by the publisher's invocation list. A long-lived publisher (static event, singleton) keeps short-lived subscribers alive until they unsubscribe.

Fixes: unsubscribe (IDisposable subscription), weak events, or avoid long-lived static events.

~~~csharp
public event EventHandler<OrderPlaced>? Placed;
protected void OnPlaced(OrderPlaced e) => Placed?.Invoke(this, e);
~~~

Raising: copy-on-read via {{?.Invoke}} is thread-safe against concurrent unsubscribe.`,
  pts: [r`Events are encapsulated multicast delegates`, r`Publisher holds subscribers strongly`, r`Unsubscribe or use weak references`, r`Handlers throwing stop later handlers`],
  ex: r`A WPF/Blazor component subscribed to a singleton service event and never unsubscribed; each page visit leaked a component instance.`,
  fu: [r`What happens if one handler throws?`, r`How do async event handlers behave (async void)?`],
  pit: [r`async void handlers: exceptions crash the process.`] },

{ id: 'q8', level: 'Intermediate', tags: ['linq'],
  q: r`Explain deferred execution in LINQ and the multiple-enumeration bug.`,
  a: r`Most LINQ operators ({{Where}}, {{Select}}, {{OrderBy}}) return a lazy query object; nothing runs until enumeration ({{foreach}}, {{ToList}}, {{Count}}, {{First}}). Operators like {{ToList}}, {{ToArray}}, {{Count}}, {{Sum}} are **immediate**.

Problems:

- **Multiple enumeration**: enumerating an {{IEnumerable}} twice reruns the pipeline (and any I/O or side effects inside it).
- **Captured variables** are read at execution time, not definition time.
- A query over a database context may run after the context is disposed.

Materialise once when you need a stable snapshot; accept {{IReadOnlyCollection<T>}} when you will enumerate more than once.

~~~csharp
var active = users.Where(u => u.IsActive);   // not executed
users.Add(newActiveUser);
var n = active.Count();                       // includes newActiveUser
~~~`,
  pts: [r`Lazy until enumerated`, r`Materialise to snapshot`, r`Beware side effects inside lambdas`, r`IEnumerable params can hide re-evaluation`],
  ex: r`A method took {{IEnumerable<Order>}} from a DB query and looped over it three times, issuing three SQL queries.`,
  fu: [r`IEnumerable vs IQueryable?`, r`What does OrderBy do on enumeration (buffering)?`],
  pit: [r`Returning a lazy query from a method that disposes its resources.`] },

{ id: 'q9', level: 'Intermediate', tags: ['linq', 'ef'],
  code: r`~~~csharp
IQueryable<Order> q = db.Orders.Where(o => o.CustomerId == id);          // expression tree -> SQL
var recent = await q.OrderByDescending(o => o.CreatedAt).Take(20).ToListAsync(ct);   // TOP 20 in SQL

IEnumerable<Order> e = db.Orders.AsEnumerable();                            // switches to LINQ-to-Objects
var bad = e.Where(o => o.CustomerId == id).Take(20).ToList();               // pulls the whole table

// Return IEnumerable/IReadOnlyList from repositories, not IQueryable, to keep query shape owned
~~~`,
  q: r`IEnumerable versus IQueryable.`,
  a: r`{{IEnumerable<T>}}: in-memory iteration; operators take delegates ({{Func<>}}) and run in your process. {{IQueryable<T>}}: operators take **expression trees** ({{Expression<Func<>>}}) that a provider (EF Core) translates to SQL.

Switching mid-query matters: after {{AsEnumerable()}} / {{ToList()}}, the rest runs in memory, so filtering after it pulls the whole table.

Risks: client-side evaluation of untranslatable methods (EF Core throws now rather than silently running locally), exposing {{IQueryable}} from repositories leaks persistence concerns and allows unbounded queries.

Rule: filter, project and page **before** materialising; keep {{IQueryable}} inside the data layer or expose specific query methods.`,
  pts: [r`Expression trees vs delegates`, r`Filtering after ToList is client-side`, r`Do not leak IQueryable across layers`],
  ex: r`{{db.Orders.ToList().Where(o => o.Total > 100)}} loaded 3 million rows; moving {{Where}} first returned 4,000.`,
  fu: [r`How does the provider translate an expression tree?`],
  pit: [r`Calling custom C# methods inside an IQueryable predicate.`] },

{ id: 'q10', level: 'Intermediate', tags: ['iterators'],
  q: r`How does yield return work?`,
  a: r`The compiler rewrites an iterator method into a **state machine class** implementing {{IEnumerator<T>}}. Each {{yield return}} saves local state and a state number; {{MoveNext}} resumes after the last yield. Execution is lazy and streaming: only one element is produced at a time, so you can model infinite sequences and process huge inputs in constant memory.

Gotchas: argument validation inside an iterator method runs on first {{MoveNext}}, not at call time (split into a public validating method and a private iterator); {{yield}} cannot be inside {{try/catch}} (it can in {{try/finally}}); the iterator runs on the consumer's thread.

~~~csharp
public static IEnumerable<T> Where<T>(IEnumerable<T> src, Func<T, bool> p)
{
    foreach (var x in src) if (p(x)) yield return x;
}
~~~`,
  pts: [r`Compiler-generated state machine`, r`Lazy and constant-memory`, r`Validate arguments eagerly in a wrapper`],
  ex: r`Streaming a 5 GB CSV through an iterator pipeline kept memory flat versus loading all rows.`,
  fu: [r`What does IAsyncEnumerable add?`],
  pit: [r`Expecting the argument exception at call time.`] },

{ id: 'q11', level: 'Intermediate', tags: ['async'],
  q: r`What does async/await compile to, and what is a Task?`,
  a: r`An {{async}} method becomes a **state machine** (a struct in release builds, to avoid allocation on the synchronous path). At each {{await}}, if the awaited operation has not completed, the method registers a continuation and **returns** its Task to the caller, freeing the thread. When the operation completes, the continuation resumes the state machine, on the captured {{SynchronizationContext}}/{{TaskScheduler}} unless {{ConfigureAwait(false)}} is used.

A {{Task}} represents a future result; it is a **promise**, not necessarily a thread. For I/O there is no thread blocked at all (the OS completion port signals completion). For CPU work, {{Task.Run}} queues to the thread pool.

~~~csharp
public async Task<Order> GetAsync(int id, CancellationToken ct)
{
    var row = await _db.Orders.FindAsync(new object[] { id }, ct); // thread released here
    return Map(row);
}
~~~`,
  pts: [r`State machine rewrite`, r`await releases the thread for I/O`, r`Task is a promise not a thread`, r`Context capture affects where continuation runs`],
  ex: r`An ASP.NET Core API handling 5,000 concurrent requests uses tens of threads because awaiting I/O releases them.`,
  fu: [r`Why is async void dangerous?`, r`What is the cost of async on the hot synchronous path?`],
  pit: [r`Wrapping I/O in Task.Run "to make it async".`] },

{ id: 'q12', level: 'Intermediate', tags: ['async', 'valuetask'],
  code: r`~~~csharp
private readonly ConcurrentDictionary<string, Rate> _cache = new();
// Hot path usually completes synchronously: ValueTask avoids a Task allocation
public ValueTask<Rate> GetRateAsync(string pair, CancellationToken ct) =>
    _cache.TryGetValue(pair, out var r) ? ValueTask.FromResult(r) : new ValueTask<Rate>(LoadAsync(pair, ct));
private async Task<Rate> LoadAsync(string pair, CancellationToken ct) { var r = await _api.GetAsync(pair, ct); _cache[pair] = r; return r; }

// Rules: await a ValueTask exactly once; never await it twice or concurrently
var vt = GetRateAsync("EURUSD", ct);
var rate = await vt;            // ok
// var again = await vt;        // undefined behaviour with pooled sources; use .AsTask() if you need that
~~~`,
  q: r`Task versus ValueTask: when is ValueTask the right choice?`,
  a: r`{{ValueTask<T>}} is a struct that avoids allocating a {{Task}} when the result is available synchronously (cache hit, buffered read) or when backed by a pooled {{IValueTaskSource}}.

Constraints: a ValueTask must be awaited **once**, must not be awaited concurrently, and must not be used after completion; do not call {{GetAwaiter().GetResult()}} before completion. If you need multiple awaits, call {{AsTask()}} once.

Use it for hot APIs where the synchronous path dominates and profiling shows allocation pressure (streams, channel readers, cached lookups). Default to {{Task}} for ordinary APIs: simpler, safe to await many times, and {{Task.WhenAll}} friendly.`,
  pts: [r`Avoids allocation on sync completion`, r`Single-await rule`, r`Measure first, default to Task`],
  ex: r`A repository with an in-memory cache returns {{ValueTask<User>}}: the 95% cache-hit path allocates nothing.`,
  fu: [r`What happens if you await a ValueTask twice?`],
  pit: [r`Returning ValueTask everywhere "for performance".`] },

{ id: 'q13', level: 'Intermediate', tags: ['dispose', 'gc'],
  q: r`Explain IDisposable, the Dispose pattern, and finalizers.`,
  a: r`The GC reclaims **memory** only; unmanaged resources (file handles, sockets, DB connections) need deterministic release via {{IDisposable.Dispose}} ({{using}} / {{await using}}).

The full pattern (needed only when you own unmanaged resources directly):

~~~csharp
public class Native : IDisposable
{
    private IntPtr _h; private bool _disposed;
    public void Dispose() { Dispose(true); GC.SuppressFinalize(this); }
    protected virtual void Dispose(bool disposing)
    {
        if (_disposed) return;
        if (disposing) { /* dispose managed fields */ }
        Free(_h); _h = IntPtr.Zero; _disposed = true;
    }
    ~Native() => Dispose(false); // safety net
}
~~~

Prefer wrapping handles in {{SafeHandle}} so you almost never write a finalizer. Finalizable objects survive an extra GC (finalizer queue), so they are costly. Dispose should be idempotent and not throw. Implement {{IAsyncDisposable}} for async cleanup.`,
  pts: [r`Dispose = deterministic, finalizer = safety net`, r`SuppressFinalize after Dispose`, r`Use SafeHandle`, r`Make Dispose idempotent`],
  ex: r`A service that forgot to dispose {{HttpResponseMessage}} leaked sockets under load until connections exhausted.`,
  fu: [r`Why do finalizers cost an extra GC generation?`, r`Who disposes objects created by DI?`],
  pit: [r`Implementing a finalizer on a class that only holds managed objects.`] },

{ id: 'q14', level: 'Intermediate', tags: ['gc'],
  code: r`~~~csharp
Console.WriteLine(GC.GetGeneration(new object()));                // 0
var big = new byte[90_000];                                        // >= 85,000 bytes -> LOH (gen 2)
Console.WriteLine(GC.GetGeneration(big));                          // 2
var info = GC.GetGCMemoryInfo();
Console.WriteLine($"heap={info.HeapSizeBytes / 1_048_576} MB, pause%={info.PauseTimePercentage}");
~~~
~~~xml
<PropertyGroup>
  <ServerGarbageCollector>true</ServerGarbageCollector>          <!-- per-core heaps for throughput -->
  <ConcurrentGarbageCollection>true</ConcurrentGarbageCollection> <!-- background gen2 -->
  <GarbageCollectionAdaptationMode>1</GarbageCollectionAdaptationMode> <!-- DATAS (.NET 8+): adapt heap count -->
</PropertyGroup>
~~~`,
  q: r`How does the .NET garbage collector work (generations, LOH)?`,
  a: r`The GC is **generational, compacting, mark-and-sweep** (mostly). New objects go to **Gen 0**; survivors are promoted to Gen 1 then Gen 2. Most objects die young, so frequent cheap Gen 0 collections reclaim most memory. Gen 2 collections are expensive (whole heap).

Objects of 85,000 bytes or more go to the **Large Object Heap (LOH)**, collected with Gen 2 and (by default) not compacted, so it can fragment; arrays that large should be pooled ({{ArrayPool<T>}}). There is also the **Pinned Object Heap** for long-lived pinned buffers.

Modes: **Workstation vs Server** GC (server uses a heap and thread per core, higher throughput), **concurrent / background** GC (Gen 2 mostly concurrent with the app). Containers: honour memory limits ({{GCHeapHardLimit}}), and use {{GCConserveMemory}} / {{DOTNET_gcServer}} deliberately.

Tuning order: reduce allocations first, then tune GC settings.`,
  pts: [r`Gen0/1/2 and why it works`, r`LOH threshold 85,000 bytes`, r`Server vs workstation, background GC`, r`Allocation reduction beats tuning`],
  ex: r`Latency spikes every few minutes were Gen 2 collections caused by large per-request byte arrays; pooling the buffers removed them.`,
  fu: [r`What is a card table / write barrier?`, r`How do you diagnose GC pauses?`],
  pit: [r`Calling GC.Collect() to "fix" memory.`] },

{ id: 'q15', level: 'Intermediate', tags: ['generics'],
  code: r`~~~csharp
public interface IRepository<T, in TKey> where T : class, IEntity<TKey> where TKey : notnull
{ Task<T?> GetAsync(TKey id, CancellationToken ct); }

IEnumerable<string> names = new List<string> { "a" };
IEnumerable<object> objs = names;                         // covariance (out T)
Action<object> logAny = o => Console.WriteLine(o);
Action<string> logString = logAny;                        // contravariance (in T)

static T Max<T>(T a, T b) where T : INumber<T> => a > b ? a : b;   // generic math (C# 11)
~~~`,
  q: r`Generic constraints, covariance and contravariance.`,
  a: r`Constraints ({{where T : class, new(), IComparable<T>}}, {{struct}}, {{notnull}}, {{unmanaged}}, {{allows ref struct}} in C# 13) let generic code call members and tell the JIT what it is dealing with. For value types the runtime generates **specialised code per type** (no boxing); reference types share one implementation.

**Variance** applies to interfaces and delegates only:

- **Covariant** ({{out T}}): produce values. {{IEnumerable<Dog>}} converts to {{IEnumerable<Animal>}}.
- **Contravariant** ({{in T}}): consume values. {{Action<Animal>}} converts to {{Action<Dog>}}.

Classes and {{List<T>}} are invariant because they both read and write; array covariance exists but is unsafe (runtime {{ArrayTypeMismatchException}}).`,
  pts: [r`out = produce, in = consume`, r`Variance only on interfaces and delegates`, r`Value-type generics are specialised`],
  ex: r`{{IComparer<Animal>}} can be used where {{IComparer<Dog>}} is required thanks to contravariance.`,
  fu: [r`Why is List<Dog> not a List<Animal>?`],
  pit: [r`Trying to apply variance to a class.`] },

{ id: 'q16', level: 'Intermediate', tags: ['language'],
  code: r`~~~csharp
public sealed record Order(Guid Id, decimal Total);                      // records (C# 9)
public sealed class OrderService(IOrderRepo repo, ILogger<OrderService> log) { }   // primary ctor (C# 12)
int[] ids = [1, 2, 3];  List<int> more = [.. ids, 4];                    // collection expressions (C# 12)
string status = order switch { { Total: > 1000 } => "review", { Total: 0 } => "empty", _ => "ok" };  // patterns
public required string Email { get; init; }                              // required members (C# 11)
var json = """{"id": 1, "name": "x"}""";                                  // raw string literal (C# 11)
private readonly Lock _gate = new();                                      // System.Threading.Lock (C# 13 / .NET 9)
~~~`,
  q: r`Which modern C# features (8 to 13) matter most in production code?`,
  a: r`- **Records / record structs, with-expressions**: immutable data and value equality.
- **Pattern matching** (switch expressions, property/list/relational patterns): exhaustive, readable branching.
- **Nullable reference types**, **required members**, **init**.
- **Top-level statements, global usings, file-scoped namespaces**: less ceremony.
- **Primary constructors** (classes/structs, C# 12): concise DI; note captured parameters are mutable fields-like and not readonly.
- **Collection expressions** ({{[1, 2, ..other]}}), **{{params ReadOnlySpan<T>}}** and **{{params}} collections** (C# 13).
- **{{Lock}} type** (.NET 9) for clearer, faster locking.
- **Raw string literals**, **UTF-8 literals**, **interceptors/source generators** for AOT-friendly code.

Adoption rule: enable per project via {{LangVersion}}, enforce style with {{.editorconfig}} analyzers, and avoid rewriting stable code just to modernise.`,
  pts: [r`Records + pattern matching change design style`, r`Primary constructor parameters are not readonly`, r`Enforce with analyzers`],
  ex: r`~~~csharp
decimal Fee(Order o) => o switch
{
    { Total: > 10_000, Customer.Tier: Tier.Gold } => 0m,
    { Total: > 10_000 } => o.Total * 0.001m,
    _ => 2.5m
};
~~~`,
  fu: [r`What is the catch with primary constructors and mutability?`],
  pit: [r`Treating new syntax as a goal rather than a readability gain.`] },

{ id: 'q17', level: 'Intermediate', tags: ['extensions'],
  code: r`~~~csharp
public static class StringExtensions
{
    public static string Truncate(this string value, int max) => value.Length <= max ? value : value[..max] + "...";
}
"Hello world".Truncate(5);              // "Hello..."

string? s = null;
s.Truncate(3);                           // NullReferenceException inside the extension, not at the call site
// Static dispatch: chosen by the declared type at compile time, never overridden
~~~`,
  q: r`Extension methods: strengths, limits, and traps.`,
  a: r`Extension methods are static methods called with instance syntax; the compiler rewrites {{x.Foo()}} to {{Ext.Foo(x)}}. They add behaviour to types you do not own (LINQ, fluent configuration) without inheritance.

Limits and traps:

- Resolved at **compile time** by static type; they do not override instance methods (an instance method with the same signature wins) and are not virtual.
- Work on {{null}} receivers (no NRE until you dereference), which can surprise.
- Namespace pollution and discoverability problems; ambiguity between two imported extensions.
- Do not use them to hide significant dependencies or I/O.

Good uses: LINQ-style operators, {{IServiceCollection.AddXxx}} registration, small pure helpers.`,
  pts: [r`Static dispatch, not polymorphic`, r`Instance method wins`, r`Keep pure and discoverable`],
  ex: r`{{services.AddPayments(config)}} bundles registration of a module's dependencies.`,
  fu: [r`Can extension methods access private members?`],
  pit: [r`Extension methods that perform hidden I/O.`] },

{ id: 'q18', level: 'Intermediate', tags: ['async', 'cancellation'],
  code: r`~~~csharp
app.MapGet("/report", async (ReportService svc, CancellationToken ct) => await svc.BuildAsync(ct));  // ct = RequestAborted

public async Task<Report> BuildAsync(CancellationToken ct)
{
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
    timeout.CancelAfter(TimeSpan.FromSeconds(10));                 // own deadline + caller cancellation
    var rows = await _db.Rows.ToListAsync(timeout.Token);          // pass it down to every I/O call
    foreach (var chunk in rows.Chunk(1000))
    {
        timeout.Token.ThrowIfCancellationRequested();              // cooperative check in CPU loops
        Process(chunk);
    }
    return new Report(rows.Count);
}
~~~`,
  q: r`How should cancellation be implemented with CancellationToken?`,
  a: r`Cancellation is **cooperative**: the caller signals via a {{CancellationTokenSource}}, and the callee observes the {{CancellationToken}}.

Rules:

- Accept a token as the **last parameter** in every async public method and pass it down.
- Check {{ct.ThrowIfCancellationRequested()}} in long CPU loops; pass it to I/O APIs that honour it.
- Linked tokens: {{CancellationTokenSource.CreateLinkedTokenSource(a, b)}} for timeouts + caller cancel; {{cts.CancelAfter(TimeSpan)}} for timeouts.
- {{OperationCanceledException}} is the normal outcome, not an error; do not log it as failure.
- Register cleanup with {{ct.Register}} and dispose registrations.
- In ASP.NET Core, {{HttpContext.RequestAborted}} is bound automatically to action parameters.

Cancelling does not roll back work already done; design for idempotency.`,
  pts: [r`Cooperative, last parameter, pass it down`, r`Linked tokens for timeouts`, r`Cancellation is not failure`],
  ex: r`A report endpoint cancels a 40-second SQL query when the browser disconnects, freeing a DB connection.`,
  fu: [r`What if a library method ignores the token?`],
  pit: [r`Catching OperationCanceledException and continuing as if nothing happened.`] },

{ id: 'q19', level: 'Senior', tags: ['collections'],
  code: r`~~~csharp
var byId = new Dictionary<Guid, Order>();                       // O(1) lookup by key
var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase); // O(1) membership, dedupe
var book = new SortedDictionary<decimal, int>();                // ordered price levels, O(log n)
var work = new Queue<Job>(); var pq = new PriorityQueue<Job, int>();
var config = ImmutableArray.Create("GB", "DE", "FR");           // thread-safe, read-mostly
var lookup = countries.ToFrozenDictionary(c => c.Code);          // .NET 8: fastest reads, built once
var shared = new ConcurrentDictionary<string, int>();            // concurrent writers
shared.AddOrUpdate("k", 1, (_, v) => v + 1);
~~~`,
  q: r`Choose the right collection: List, Dictionary, HashSet, SortedDictionary, Queue, ImmutableArray, ConcurrentDictionary.`,
  a: r`| Need | Choice | Notes |
|---|---|---|
| Ordered, index access | {{List<T>}} | Amortised O(1) add, O(n) insert/remove middle |
| Key lookup | {{Dictionary<K,V>}} | O(1) average; needs good GetHashCode |
| Uniqueness / membership | {{HashSet<T>}} | O(1) contains |
| Sorted iteration, range queries | {{SortedDictionary}}, {{SortedSet}} | O(log n) |
| FIFO / LIFO | {{Queue<T>}}, {{Stack<T>}} | |
| Thread-safe lookup | {{ConcurrentDictionary}} | Factory delegates may run more than once |
| Read-mostly snapshot | {{ImmutableArray}}, {{FrozenDictionary}} | Frozen: build once, fastest reads |
| Producer/consumer | {{Channel<T>}} | Bounded for back-pressure |

Pre-size ({{new List<T>(n)}}) when the count is known. Do not expose {{List<T>}} publicly; return {{IReadOnlyList<T>}}.`,
  pts: [r`Complexity of each`, r`Pre-size collections`, r`FrozenDictionary for static lookup tables`, r`Bounded channels for back-pressure`],
  ex: r`A static country-code table moved from {{Dictionary}} to {{FrozenDictionary}}, improving lookup time on a hot path.`,
  fu: [r`Why can ConcurrentDictionary.GetOrAdd call the factory twice?`],
  pit: [r`Modifying a collection while enumerating it.`] },

{ id: 'q20', level: 'Senior', tags: ['async', 'deadlock'],
  code: r`~~~csharp
// Deadlock in a context with a single-threaded SynchronizationContext (WinForms/WPF/classic ASP.NET)
public string GetData() => GetDataAsync().Result;            // blocks the context thread...
public async Task<string> GetDataAsync()
{
    var s = await _http.GetStringAsync("/x");                // ...continuation needs that same thread -> deadlock
    return s;
}
// Library fix: do not capture the context
var s = await _http.GetStringAsync("/x").ConfigureAwait(false);
// Real fix: async all the way up; ASP.NET Core has no SynchronizationContext, but .Result still starves the pool
~~~`,
  q: r`Explain the classic async deadlock and ConfigureAwait(false).`,
  a: r`Pattern: code on a thread with a single-threaded {{SynchronizationContext}} (legacy ASP.NET, WinForms, WPF) calls {{.Result}} or {{.Wait()}} on a Task. The thread blocks waiting. The awaited task finishes and wants to resume its continuation **on the captured context**, which is the blocked thread, so neither proceeds.

Fixes, in order of preference:

1. **Async all the way**: do not block on async code.
2. {{ConfigureAwait(false)}} in library code, so continuations do not need the original context.
3. As a last resort at a boundary, run on the pool: {{Task.Run(() => DoAsync()).GetAwaiter().GetResult()}}.

ASP.NET Core has **no** SynchronizationContext, so it does not deadlock this way, but blocking there still wastes pool threads and can cause **thread-pool starvation**. Use {{ConfigureAwait(false)}} in libraries; application code in ASP.NET Core does not need it.`,
  pts: [r`Blocked context thread + continuation needing it`, r`Async all the way`, r`Libraries use ConfigureAwait(false)`, r`ASP.NET Core: no context, but starvation risk`],
  ex: r`A legacy MVC 5 action called {{GetAsync().Result}} on an HttpClient wrapper and hung under load.`,
  fu: [r`What does ConfigureAwait(true) mean?`, r`How does thread-pool starvation present in production?`],
  pit: [r`Applying ConfigureAwait(false) in UI event handlers and then touching controls.`] },

{ id: 'q21', level: 'Senior', tags: ['threading'],
  code: r`~~~bash
dotnet-counters monitor -p <pid> System.Runtime --counters threadpool-queue-length,threadpool-thread-count
dotnet-dump collect -p <pid> && dotnet-dump analyze core_*.dmp -c "clrstack -all"   # look for .Result/.Wait blocking
~~~
~~~csharp
// Cause: sync-over-async on request threads
var data = _client.GetAsync(url).Result;          // blocks a pool thread per request
// Fix: async end to end; as a temporary mitigation only:
ThreadPool.SetMinThreads(workerThreads: 200, completionPortThreads: 200);
~~~`,
  q: r`How do you diagnose and fix thread-pool starvation?`,
  a: r`**Symptoms**: latency climbs, CPU is low, requests queue, work finishes in bursts about every 500 ms (the pool injects roughly one thread per half-second once saturated). {{ThreadPool.PendingWorkItemCount}} grows.

**Cause**: threads blocked on sync-over-async ({{.Result}}, {{.Wait()}}), blocking I/O, locks, or long CPU work on pool threads.

**Diagnose**: {{dotnet-counters}} (thread-pool queue length, thread count), {{dotnet-stack}} / {{dotnet-dump}} to see many threads parked in {{Task.Wait}} or {{Monitor.Enter}}, EventPipe traces.

**Fix**: remove sync-over-async, make I/O async, move long CPU work to dedicated threads or a queue, limit concurrency with {{SemaphoreSlim}} / channels, and only as a mitigation raise {{ThreadPool.SetMinThreads}}.

~~~
dotnet-counters monitor -p <pid> System.Runtime
# watch: ThreadPool Queue Length, ThreadPool Thread Count
~~~`,
  pts: [r`Low CPU + high latency = suspect starvation`, r`dotnet-counters and dump to confirm`, r`Fix the blocking, SetMinThreads only as mitigation`],
  ex: r`An API calling a sync SDK inside async controllers stalled at 300 RPS; wrapping in a dedicated bounded executor and moving to the async SDK restored throughput.`,
  fu: [r`Why does the pool inject threads slowly?`],
  pit: [r`Raising min threads and calling it solved.`] },

{ id: 'q22', level: 'Senior', tags: ['concurrency', 'locks'],
  code: r`~~~csharp
private readonly Lock _sync = new();                          // short critical section (.NET 9 Lock)
lock (_sync) { _balance += amount; }

private readonly SemaphoreSlim _gate = new(4);                // async-friendly, limits concurrency to 4
await _gate.WaitAsync(ct); try { await CallVendorAsync(ct); } finally { _gate.Release(); }

private readonly ReaderWriterLockSlim _rw = new();            // many readers, rare writers (sync code only)
_rw.EnterReadLock(); try { return _map[key]; } finally { _rw.ExitReadLock(); }

Interlocked.Increment(ref _requests);                          // single-variable atomic update
~~~`,
  q: r`lock, Monitor, SemaphoreSlim, ReaderWriterLockSlim, Interlocked: when to use each?`,
  a: r`- {{lock}} / {{Monitor}} (and the C# 13 {{System.Threading.Lock}} type): mutual exclusion, **synchronous only**, re-entrant. Never {{await}} inside {{lock}} (compile error), never lock on {{this}}, a public object or a string.
- {{SemaphoreSlim}}: limits concurrency; supports {{WaitAsync}}, so it is the async-friendly mutex ({{new SemaphoreSlim(1,1)}}).
- {{ReaderWriterLockSlim}}: many readers, one writer; worth it only when reads dominate and the critical section is not tiny; has recursion and upgrade hazards.
- {{Interlocked}}: lock-free atomic ops on a single variable ({{Increment}}, {{CompareExchange}}).
- {{Volatile}} / {{volatile}}: visibility/ordering, not atomicity of compound operations.
- {{ConcurrentDictionary}}, {{Channel<T>}}: prefer these over hand-rolled locking.

Principle: **share less**. Immutable data and message passing remove most locks.`,
  pts: [r`No await inside lock`, r`SemaphoreSlim for async mutual exclusion`, r`Interlocked for single-variable atomics`, r`Prefer immutability and channels`],
  ex: r`~~~csharp
private readonly SemaphoreSlim _gate = new(1, 1);
public async Task RefreshAsync(CancellationToken ct)
{
    await _gate.WaitAsync(ct);
    try { _token ??= await FetchTokenAsync(ct); }
    finally { _gate.Release(); }
}
~~~`,
  fu: [r`What is lock convoy and false sharing?`, r`Double-checked locking in C#?`],
  pit: [r`Locking on a Type or string, or holding a lock across I/O.`] },

{ id: 'q23', level: 'Senior', tags: ['memory', 'span'],
  q: r`What are Span<T>, Memory<T> and ref structs, and when do they matter?`,
  a: r`{{Span<T>}} is a **ref struct**: a stack-only view (pointer + length) over contiguous memory (array, stackalloc, native, string). It allows slicing without copying or allocating.

Because it may point into the stack, it cannot be boxed, stored in a class field, captured by lambdas or used across {{await}} / {{yield}}. {{Memory<T>}} is the heap-friendly counterpart that can live in fields and across awaits; get a {{Span}} from it when you need to work synchronously.

~~~csharp
ReadOnlySpan<char> line = text.AsSpan();
int comma = line.IndexOf(',');
var name = line[..comma];          // no allocation
int.TryParse(line[(comma + 1)..], out var qty);
~~~

Use in parsers, protocol handling, serialisation, and any hot path that substring-allocates.`,
  pts: [r`Zero-copy slicing`, r`ref struct restrictions`, r`Memory<T> across await`, r`Parsing hot paths benefit most`],
  ex: r`A FIX-message parser using spans processes millions of messages per second with almost no allocations.`,
  fu: [r`Why can Span not be a field of a class?`],
  pit: [r`Trying to hold a Span across an await.`] },

{ id: 'q24', level: 'Senior', tags: ['memory', 'performance'],
  code: r`~~~csharp
byte[] buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);
try
{
    int read = await stream.ReadAsync(buffer.AsMemory(0, 64 * 1024), ct);
    Process(buffer.AsSpan(0, read));                          // Rent may return a larger array: use the length you asked for
}
finally { ArrayPool<byte>.Shared.Return(buffer, clearArray: true); }   // clear if it held sensitive data

Span<byte> small = stackalloc byte[256];                       // stack, no GC; keep it small (stack overflow risk)
var sbPool = ObjectPool.Create(new StringBuilderPooledObjectPolicy());   // Microsoft.Extensions.ObjectPool
~~~`,
  q: r`How do ArrayPool, stackalloc and object pooling reduce GC pressure, and what are the risks?`,
  a: r`- **{{ArrayPool<T>.Shared.Rent(n)}}**: reuse large arrays. Risks: returned array may be **larger** than requested and **dirty** (contains old data); always {{Return}} (in {{finally}}), never use after return, clear when it held secrets ({{clearArray: true}}).
- **{{stackalloc}}** for small temporary buffers (keep under a few KB, to avoid stack overflow): {{Span<byte> b = stackalloc byte[256];}}.
- **{{ObjectPool<T>}}** (Microsoft.Extensions.ObjectPool): reuse expensive objects ({{StringBuilder}}); reset state on return.
- **{{MemoryPool<T>}}** / {{IBufferWriter<T>}} for pipelines.

Risks: use-after-return bugs, data leakage between requests, and added complexity. Introduce only where allocation profiling shows it matters; the default allocator and Gen 0 GC are very efficient.`,
  pts: [r`Rent returns bigger, dirty arrays`, r`Always return in finally`, r`stackalloc small only`, r`Profile before pooling`],
  ex: r`A serializer rents a buffer per message; use-after-return caused one customer's data to appear in another's response until buffers were wrapped in a disposable lease.`,
  fu: [r`How would you detect a use-after-return bug?`],
  pit: [r`Pooling everything and creating subtle data leaks.`] },

{ id: 'q25', level: 'Senior', tags: ['async', 'streams'],
  q: r`IAsyncEnumerable and Channels: when and why?`,
  a: r`{{IAsyncEnumerable<T>}} with {{await foreach}} streams results asynchronously, so a controller can start sending data before the whole result is ready, and memory stays flat. Use {{[EnumeratorCancellation]}} so the token flows into the iterator.

{{System.Threading.Channels}} is an async producer/consumer queue. A **bounded** channel gives **back-pressure**: producers wait ({{WriteAsync}}) or drop when the consumer is slow, preventing unbounded memory growth. Compare with {{BlockingCollection}} (blocks threads) and TPL Dataflow (heavier, more features).

~~~csharp
var ch = Channel.CreateBounded<Job>(new BoundedChannelOptions(1000) { FullMode = BoundedChannelFullMode.Wait });
// producer: await ch.Writer.WriteAsync(job, ct);
await foreach (var job in ch.Reader.ReadAllAsync(ct)) await Process(job);
~~~`,
  pts: [r`Streaming reduces memory and latency`, r`Bounded channel = back-pressure`, r`EnumeratorCancellation for tokens`],
  ex: r`An export endpoint streams 2 million rows with {{IAsyncEnumerable}} and keeps working-set under 50 MB.`,
  fu: [r`What does FullMode choose and what are the trade-offs?`],
  pit: [r`Unbounded channels that hide a slow consumer until OOM.`] },

{ id: 'q26', level: 'Senior', tags: ['memory-model'],
  code: r`~~~csharp
// Without a barrier the reader may never observe the flag (hoisted into a register) or see stale data
private bool _stop;                                   // bug
private volatile bool _stopSafe;                      // acquire/release semantics for this field
public void Worker() { while (!Volatile.Read(ref _stop)) { DoWork(); } }
public void Stop() => Volatile.Write(ref _stop, true);

// Safe publication of an initialised object
private Config? _config;
public Config Get() => LazyInitializer.EnsureInitialized(ref _config, () => Config.Load());
~~~`,
  q: r`What does the .NET memory model guarantee and when do you need volatile?`,
  a: r`Compilers and CPUs reorder and cache reads/writes. Within one thread, results look sequential, but across threads you need synchronisation to get **visibility and ordering**.

- Lock acquire/release and {{Interlocked}} operations are full or acquire/release fences, so data written before release is visible after acquire.
- {{volatile}} / {{Volatile.Read/Write}} give acquire/release semantics for that field only; it does **not** make {{i++}} atomic.
- Reference and 32/64-bit primitive reads and writes are atomic on 64-bit runtimes (aligned); {{long}} on 32-bit, {{decimal}} and large structs are not.

Typical bug: a non-volatile stop flag read in a tight loop may never see the update (JIT hoists the read). Use {{volatile bool}}, {{CancellationToken}} or an {{Interlocked}}/lock.

Rule: use higher-level primitives; reach for volatile only with a precise lock-free design in hand.`,
  pts: [r`Reordering and visibility`, r`volatile is not atomic increment`, r`Locks imply fences`, r`Prefer high-level constructs`],
  ex: r`A background worker's {{_running}} flag lacked volatile; in Release builds the loop never exited.`,
  fu: [r`Is double-checked locking safe in C#?`, r`What does Lazy<T> do for this?`],
  pit: [r`Using volatile as a general thread-safety fix.`] },

{ id: 'q27', level: 'Senior', tags: ['structs', 'performance'],
  code: r`~~~csharp
public struct Mutable { public int X; public int Get() => X; }
public readonly struct Point(int x, int y) { public int X { get; } = x; public int Y { get; } = y; public double Len() => Math.Sqrt(X * X + Y * Y); }

readonly Mutable _m;           // calling _m.Get() makes a defensive copy each time (compiler cannot prove no mutation)
readonly Point _p;             // readonly struct: no copies

static double Dist(in Point a, in Point b) => Math.Sqrt(Math.Pow(a.X - b.X, 2) + Math.Pow(a.Y - b.Y, 2)); // pass by readonly ref
~~~`,
  q: r`What are defensive copies and why do readonly struct and in matter?`,
  a: r`When you call a method on a struct held in a **readonly** context (a {{readonly}} field, an {{in}} parameter, a ref readonly), the compiler cannot prove the method will not mutate it, so it **copies the struct first** and calls the method on the copy. For large structs this silently costs time and breaks the intended "no copy" optimisation.

Marking the struct {{readonly struct}} tells the compiler every member is non-mutating, so it skips the copy. Members can also be marked {{readonly}} individually.

Practical rule: structs you pass by {{in}} or store in {{readonly}} fields should be {{readonly struct}}. Use analyzers (e.g. ErrorProne.NET or the built-in IDE0250/CA analyzers) to find defensive copies.`,
  pts: [r`Compiler copies for safety on readonly contexts`, r`readonly struct removes it`, r`Matters for large structs on hot paths`],
  ex: r`A 48-byte matrix struct passed via {{in}} was being copied on every call until marked readonly.`,
  fu: [r`How would you prove it with a benchmark?`],
  pit: [r`Adding in to everything without checking the copy behaviour.`] },

{ id: 'q28', level: 'Senior', tags: ['expression-trees', 'reflection'],
  code: r`~~~csharp
// Reflection: flexible, slow per call, not trim-safe
var value = typeof(Order).GetProperty("Total")!.GetValue(order);
// Compiled expression tree: build once, call fast
var p = Expression.Parameter(typeof(Order));
var getter = Expression.Lambda<Func<Order, decimal>>(Expression.Property(p, "Total"), p).Compile();
// Source generator: code generated at build time, AOT-friendly (System.Text.Json example)
[JsonSerializable(typeof(Order))] internal partial class AppJson : JsonSerializerContext { }
var json = JsonSerializer.Serialize(order, AppJson.Default.Order);
~~~`,
  q: r`Reflection cost, expression trees and source generators: how do you choose?`,
  a: r`- **Reflection**: flexible, slow on every call (lookup + invoke), not trimming/AOT friendly. Cache {{MethodInfo}}/{{PropertyInfo}}.
- **Compiled expression trees** ({{Expression.Lambda(...).Compile()}}) or {{DynamicMethod}}: pay once to build a delegate, then call at near-direct speed. Good for mappers, serialisers, ORMs. Compile is expensive: cache.
- **Source generators**: generate C# at **build time** (System.Text.Json source generation, regex, logging, mappers like Mapperly): no runtime cost, trim/AOT safe, debuggable output.
- **{{UnsafeAccessor}}** (.NET 8) for reaching private members without reflection cost.

Choose: source generator if the shape is known at compile time (preferred today), cached compiled delegate if truly dynamic, plain reflection for rare, non-hot paths.`,
  pts: [r`Cache reflection results`, r`Compiled delegates amortise cost`, r`Source generators are AOT friendly`, r`Choose by when the shape is known`],
  ex: r`Switching JSON to source-generated contexts removed startup reflection and made the service Native AOT compatible.`,
  fu: [r`Why do expression trees matter for EF Core?`],
  pit: [r`Compiling expression trees on every request.`] },

{ id: 'q29', level: 'Senior', tags: ['async', 'design'],
  code: r`~~~csharp
// Bad: exceptions crash the process (async void) or vanish (unobserved task), work dies on shutdown
public async void OnOrderPlaced(Order o) => await _email.SendAsync(o);
_ = _email.SendAsync(order);

// Good: hand work to a hosted consumer via a bounded channel
public sealed class EmailQueue { public Channel<Order> Channel { get; } = System.Threading.Channels.Channel.CreateBounded<Order>(1000); }
public sealed class EmailWorker(EmailQueue q, IEmailSender sender, ILogger<EmailWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await foreach (var o in q.Channel.Reader.ReadAllAsync(ct))
            try { await sender.SendAsync(o, ct); } catch (Exception ex) { log.LogError(ex, "Email failed {OrderId}", o.Id); }
    }
}
// For work that must survive restarts: outbox table + relay, not in-memory queues
~~~`,
  q: r`async void, fire-and-forget, and background work: how do you do it safely?`,
  a: r`**async void** is only for event handlers: exceptions cannot be observed by the caller and crash the process. Use {{async Task}} everywhere else.

**Fire-and-forget** ({{_ = DoAsync();}}) loses exceptions and ignores shutdown. In ASP.NET Core, work started inside a request may be cut off when the request ends or the app stops.

Safe patterns:

- {{BackgroundService}} / {{IHostedService}} reading from a {{Channel<T>}} queue.
- A durable queue (SQS, Service Bus) for work that must not be lost.
- Wrap fire-and-forget in a helper that catches, logs, and tracks tasks; honour the host's {{StoppingToken}}.
- Do not capture request-scoped services (DbContext) in background work; create a scope.

Decide durability first: if losing the work is unacceptable, an in-memory queue is the wrong tool.`,
  pts: [r`async void = event handlers only`, r`Observe exceptions`, r`In-memory queue is not durable`, r`Create scopes in background work`],
  ex: r`Sending welcome emails via {{Task.Run}} in a controller lost emails on every deployment; moving to an outbox + worker fixed it.`,
  fu: [r`What does the host do on shutdown to in-flight background tasks?`],
  pit: [r`Capturing a scoped DbContext in a background task.`] },

{ id: 'q30', level: 'Senior', tags: ['exceptions', 'async'],
  q: r`How do exceptions behave with Task.WhenAll, AggregateException and unobserved tasks?`,
  a: r`Awaiting a faulted task rethrows its **first** inner exception (not an AggregateException). {{Task.WhenAll}} collects all exceptions, but {{await}} rethrows only the first; inspect {{task.Exception.InnerExceptions}} (or the individual tasks) to see all of them.

{{.Wait()}} / {{.Result}} throw {{AggregateException}} wrapping the inner exception(s).

Unobserved faulted tasks used to crash the process in .NET 4.0; since 4.5 they are swallowed unless a {{TaskScheduler.UnobservedTaskException}} handler logs them. Do not rely on that: always await tasks.

~~~csharp
var all = Task.WhenAll(tasks);
try { await all; }
catch { foreach (var e in all.Exception!.InnerExceptions) _log.LogError(e, "task failed"); }
~~~`,
  pts: [r`await shows the first exception`, r`Inspect WhenAll task for all`, r`Never leave tasks unobserved`],
  ex: r`Three downstream calls failed; the log showed only one error until the aggregate was inspected.`,
  fu: [r`How do you run N tasks with limited parallelism?`],
  pit: [r`Assuming await Task.WhenAll reports every failure.`] },

{ id: 'q31', level: 'Senior', tags: ['parallelism'],
  q: r`Parallel.ForEach, Parallel.ForEachAsync, Task.WhenAll with a semaphore: which and when?`,
  a: r`- **{{Parallel.For/ForEach}}**: data-parallel **CPU-bound** work; partitions across pool threads; not for async I/O.
- **{{Parallel.ForEachAsync}}** (.NET 6+): async body with {{MaxDegreeOfParallelism}}; the right tool for bounded concurrent I/O over a collection.
- **{{Task.WhenAll}}** with all tasks started: simplest, but unbounded concurrency can overwhelm a dependency; gate with {{SemaphoreSlim}}.
- **PLINQ** ({{AsParallel}}): CPU-bound query pipelines; ordering and overhead trade-offs.

Always bound concurrency against downstream capacity (DB pool size, API rate limits) and propagate cancellation.

~~~csharp
await Parallel.ForEachAsync(ids, new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    async (id, token) => await _client.SyncAsync(id, token));
~~~`,
  pts: [r`CPU-bound vs I/O-bound`, r`Bound the degree of parallelism`, r`ForEachAsync for async I/O`],
  ex: r`Fan-out to 10,000 vendor calls with {{WhenAll}} triggered the vendor's rate limiter; {{ForEachAsync}} with 16 workers completed reliably.`,
  fu: [r`What is the effect of parallelism on a shared DbContext?`],
  pit: [r`Using Parallel.ForEach with async lambdas (becomes async void behaviour).`] },

{ id: 'q32', level: 'Senior', tags: ['gc', 'memory'],
  code: r`~~~bash
dotnet-counters monitor -p <pid> System.Runtime --counters gc-heap-size,gen-2-gc-count,loh-size
dotnet-gcdump collect -p <pid> -o before.gcdump      # take two dumps minutes apart under load
dotnet-gcdump collect -p <pid> -o after.gcdump
# compare types by retained size in Visual Studio / PerfView; then follow the GC roots of the growing type
dotnet-dump analyze core.dmp -c "dumpheap -stat" -c "gcroot <address>"
~~~
~~~csharp
// Classic culprits found this way
private static readonly List<RequestContext> _audit = new();             // static collection that only grows
_feed.PriceChanged += vm.OnPrice;                                         // event never unsubscribed
services.AddSingleton<ReportCache>(); /* holding scoped DbContexts */     // captive dependency
~~~`,
  q: r`How would you investigate a memory leak in a .NET service?`,
  a: r`1. **Confirm**: does Gen 2/LOH size grow after full GCs ({{dotnet-counters}}: GC heap size, Gen 2 size)? Distinguish a leak from a large working set or fragmentation.
2. **Capture**: {{dotnet-gcdump}} (lightweight, managed heap) or {{dotnet-dump collect}}; take two or three snapshots minutes apart under load.
3. **Compare**: in Visual Studio / dotMemory / PerfView, diff snapshots to find types whose count grows; follow **GC roots** to see what keeps them alive.
4. **Common culprits**: static collections/caches without eviction, event handlers not unsubscribed, {{HttpClient}} misuse, captured closures in long-lived tasks, timers, {{ThreadLocal}}, unmanaged leaks (non-disposed handles; check process memory vs GC heap).
5. **Fix and verify** with the same load test; add an alert on heap-after-GC trend.

Native/unmanaged growth shows as process memory rising while the GC heap stays flat.`,
  pts: [r`Compare snapshots, find roots`, r`Static caches and events are top suspects`, r`Check unmanaged vs managed`],
  ex: r`Root path showed a static {{Dictionary}} cache keyed by request id with no eviction; replacing it with {{MemoryCache}} and size limits stabilised memory.`,
  fu: [r`How do you leak-test in CI?`],
  pit: [r`Trusting Task Manager memory rather than GC heap metrics.`] },

{ id: 'q33', level: 'Senior', tags: ['aot', 'deployment'],
  code: r`~~~xml
<PropertyGroup>
  <PublishAot>true</PublishAot>                 <!-- native binary: fast start, small memory, no JIT -->
  <InvariantGlobalization>true</InvariantGlobalization>
  <!-- or, for JIT apps: -->
  <PublishReadyToRun>true</PublishReadyToRun>   <!-- precompiled code + JIT later (tiering) -->
  <PublishTrimmed>true</PublishTrimmed>         <!-- removes unused code; reflection needs annotations -->
</PropertyGroup>
~~~
~~~csharp
var builder = WebApplication.CreateSlimBuilder(args);       // AOT-friendly host
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJson.Default));
~~~`,
  q: r`Native AOT, trimming and ReadyToRun: what are the trade-offs?`,
  a: r`- **ReadyToRun (R2R)**: pre-compiles IL to native to cut startup; still uses the JIT for tiering and full runtime features; larger images.
- **Trimming**: removes unused assemblies/members to shrink size; breaks reflection-heavy code unless annotated ({{[DynamicallyAccessedMembers]}}) or replaced by source generators.
- **Native AOT**: compiles to a self-contained native binary: fast startup, low memory, no JIT. Limits: no runtime code generation ({{Reflection.Emit}}, dynamic expression compile), restricted reflection, not all libraries compatible, no EF Core runtime-compiled query support in all scenarios (compiled models help), ASP.NET Core minimal APIs have a supported AOT subset.

Choose AOT for serverless/containers where cold start and density matter (Lambda, sidecars, CLIs); keep JIT with tiered PGO for long-running services that benefit from runtime optimisation, since steady-state throughput can be better with the JIT.`,
  pts: [r`Startup vs steady-state trade-off`, r`Reflection is the main incompatibility`, r`Source generators enable AOT`],
  ex: r`A Lambda function moved to Native AOT and cut cold start from about 1 s to a few hundred ms.`,
  fu: [r`How do you find trim/AOT warnings in CI?`],
  pit: [r`Adopting AOT without checking every dependency.`] },

{ id: 'q34', level: 'Senior', tags: ['caching', 'concurrency'],
  q: r`Implement a thread-safe async cache with expiry and stampede protection. What subtle bugs do you guard against?`,
  a: r`The naive version ({{if (!cache.TryGetValue) value = await Load(); cache[key] = value;}}) lets 500 concurrent requests for the same cold key all call the database: a **cache stampede**.

Store the **in-flight Task**, not the value, so concurrent callers share one load:

~~~csharp
public sealed class AsyncCache<TKey, TValue> where TKey : notnull
{
    private readonly ConcurrentDictionary<TKey, Lazy<Task<Entry>>> _map = new();
    private readonly TimeProvider _clock; private readonly TimeSpan _ttl;
    private sealed record Entry(TValue Value, DateTimeOffset ExpiresAt);

    public AsyncCache(TimeSpan ttl, TimeProvider? clock = null) { _ttl = ttl; _clock = clock ?? TimeProvider.System; }

    public async Task<TValue> GetAsync(TKey key, Func<TKey, Task<TValue>> load)
    {
        while (true)
        {
            var lazy = _map.GetOrAdd(key, k => new Lazy<Task<Entry>>(() => LoadEntry(k, load)));
            try
            {
                var e = await lazy.Value.ConfigureAwait(false);
                if (e.ExpiresAt > _clock.GetUtcNow()) return e.Value;
            }
            catch { _map.TryRemove(new KeyValuePair<TKey, Lazy<Task<Entry>>>(key, lazy)); throw; } // do not cache failures
            _map.TryRemove(new KeyValuePair<TKey, Lazy<Task<Entry>>>(key, lazy));             // expired: remove only this instance
        }
    }

    private async Task<Entry> LoadEntry(TKey k, Func<TKey, Task<TValue>> load)
        => new(await load(k).ConfigureAwait(false), _clock.GetUtcNow() + _ttl);
}
~~~

### Bugs this avoids
- **Stampede**: {{Lazy<Task>}} ensures one factory call even though {{GetOrAdd}} may invoke its value factory more than once under contention.
- **Cached failures**: a faulted task is removed so the next caller retries.
- **ABA removal**: {{TryRemove(KeyValuePair)}} removes only the entry we observed, not a fresh one another thread just added.
- **Unbounded growth**: production needs size limits and eviction ({{MemoryCache}} with {{SizeLimit}}, or {{HybridCache}} in .NET 9, which provides stampede protection and L1/L2 out of the box).
- **Testability**: {{TimeProvider}} makes expiry deterministic in tests.

Also consider stale-while-revalidate (serve the old value while one caller refreshes) to hide reload latency.`,
  pts: [r`Cache the in-flight Task`, r`Lazy prevents duplicate factory runs`, r`Never cache faults`, r`Remove only the observed entry`, r`Prefer HybridCache in production`],
  ex: r`An FX-rates service fell over every 60 s when the cache expired and 2,000 requests hit the provider at once; caching the in-flight task reduced provider calls to one per key per minute.`,
  fu: [r`How would you add stale-while-revalidate?`, r`How do you bound memory?`, r`How does this change across 20 instances (distributed stampede)?`],
  pit: [r`Locking around the await with lock (does not compile) or a global SemaphoreSlim (serialises unrelated keys).`, r`Caching exceptions for the whole TTL.`],
  tip: r`Naming the "factory may run twice in GetOrAdd" detail is a strong Senior signal.` },

{ id: 'q35', level: 'Senior', tags: ['jit', 'performance'],
  code: r`~~~xml
<PropertyGroup>
  <TieredPGO>true</TieredPGO>                         <!-- default on since .NET 8 -->
  <TieredCompilation>true</TieredCompilation>
  <TieredCompilationQuickJitForLoops>true</TieredCompilationQuickJitForLoops>
</PropertyGroup>
~~~
~~~csharp
// Warm-up before taking traffic: exercise hot paths so tier-1 code is ready
app.Lifetime.ApplicationStarted.Register(() => _ = Task.Run(async () =>
{
    using var http = new HttpClient { BaseAddress = new Uri("http://localhost:8080") };
    for (var i = 0; i < 200; i++) await http.GetAsync("/products/1");
}));
~~~`,
  q: r`How do the JIT, tiered compilation and Dynamic PGO affect production performance and warm-up?`,
  a: r`The JIT compiles IL to machine code at first call. **Tiered compilation** starts with a quick, unoptimised **tier 0** (fast startup), counts calls, and recompiles hot methods at **tier 1** with full optimisation. **OSR** (on-stack replacement) lets long-running loops jump to optimised code mid-method.

**Dynamic PGO** (default since .NET 8) instruments tier-0 code, observes real behaviour (which types flow into virtual/interface calls, which branches are hot) and uses it in tier 1: guarded devirtualisation, inlining, hot/cold block layout. Typical gains are noticeable on real workloads.

Production implications:

- **Warm-up**: the first requests after start run slower code and pay JIT cost; mitigate with readiness probes that pass only after warm-up traffic, **ReadyToRun** images (precompiled, still tiered up later), or Native AOT (no JIT but no PGO either).
- **Benchmarks** must warm up (BenchmarkDotNet does); measuring the first calls measures the JIT.
- **Autoscaling**: new pods have a slower first minute; scale earlier or pre-warm.
- {{TieredPGO}}, {{TieredCompilation}} and {{TC_QuickJitForLoops}} settings exist, but defaults are right for most services.`,
  pts: [r`Tier 0 then tier 1`, r`Dynamic PGO uses real behaviour`, r`Warm-up affects autoscaling and benchmarks`, r`R2R and AOT trade-offs`],
  ex: r`p99 spiked for 40 s after every scale-out; a warm-up endpoint exercised by the readiness probe and R2R images removed the spike.`,
  fu: [r`Why can Native AOT have lower steady-state throughput than JIT with PGO?`, r`What does guarded devirtualisation do?`],
  pit: [r`Benchmarking with Stopwatch over a cold method.`, r`Disabling tiered compilation globally to "fix" warm-up.`] },

{ id: 'q36', level: 'Senior', tags: ['testing', 'time'],
  q: r`How do you design time-dependent code (expiry, schedules, cut-off times, time zones) so it is correct and testable?`,
  a: r`### Inject time
Never call {{DateTime.Now}} / {{DateTime.UtcNow}} in domain code. Inject **{{TimeProvider}}** (.NET 8): it covers {{GetUtcNow()}}, local time zone, timers and {{Task.Delay}}; tests use {{FakeTimeProvider}} to advance time deterministically.

~~~csharp
public sealed class CutoffPolicy(TimeProvider clock, TimeZoneInfo marketZone)
{
    public bool IsSameDaySettlement()
    {
        var local = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), marketZone);
        return local.TimeOfDay < new TimeSpan(16, 30, 0) && local.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday);
    }
}
// test: var t = new FakeTimeProvider(new DateTimeOffset(2026, 3, 9, 20, 29, 0, TimeSpan.Zero)); ...
~~~

### Correctness rules
- **Store and transmit UTC** ({{DateTimeOffset}} or UTC {{DateTime}}); convert to local only for display or for business rules defined in a zone (market cut-offs).
- Use **IANA/Windows zone ids**, never fixed offsets: DST changes the offset (a 16:30 New York cut-off is 20:30 or 21:30 UTC).
- Handle **DST gaps and overlaps** (02:30 may not exist or may occur twice); schedule recurring jobs in the business zone with a library that understands it (NodaTime, Quartz with time zones).
- **Business calendars** (holidays, settlement days) are data, versioned, not code.
- Use {{DateOnly}}/{{TimeOnly}} where only a date or time is meant (birthdays, value dates).

Tests cover DST transitions, month ends, leap years, and the exact cut-off instant.`,
  pts: [r`Inject TimeProvider`, r`UTC in storage and transit`, r`Zone ids, not offsets`, r`DST gaps and overlaps`, r`Calendars as data`],
  ex: r`A payment cut-off check used a fixed UTC-5 offset and processed payments for the wrong settlement day for three weeks every March and November until it used the America/New_York zone.`,
  fu: [r`Why is DateTime.Kind a source of bugs?`, r`When would you choose NodaTime over the BCL?`],
  pit: [r`Fixed offsets for named business zones.`, r`Tests that pass only on the developer machine time zone.`] },

{ id: 'q37', level: 'Principal', tags: ['design', 'api'],
  code: r`~~~csharp
public sealed class PaymentsClientOptions { public Uri BaseAddress { get; set; } = new("https://api.example.com"); }
public sealed class PaymentsClient(HttpClient http, IOptions<PaymentsClientOptions> options)   // sealed by default
{
    [Obsolete("Use CreateAsync(CreatePaymentRequest, CancellationToken)", DiagnosticId = "PAY001")]
    public Task<Payment> CreateAsync(decimal amount) => CreateAsync(new CreatePaymentRequest(amount), default);
    public Task<Payment> CreateAsync(CreatePaymentRequest request, CancellationToken ct) => throw new NotImplementedException();
}
public sealed record CreatePaymentRequest(decimal Amount, string Currency = "GBP");   // add fields without breaking callers
~~~
~~~xml
<EnablePackageValidation>true</EnablePackageValidation>
<PackageValidationBaselineVersion>3.2.0</PackageValidationBaselineVersion>
~~~`,
  q: r`How do you design a public API/library in C# that can evolve without breaking consumers?`,
  a: r`- **Minimise the surface**: {{internal}} by default; public types as {{sealed}} unless designed for inheritance.
- **Source vs binary compatibility**: adding a member to an interface breaks implementers (use default interface methods or a new interface); adding an optional parameter breaks binary compat (add an overload instead); changing a {{const}} is breaking.
- **Abstractions at boundaries**: accept the least specific input ({{IEnumerable<T>}}, {{ReadOnlySpan<T>}}), return the most useful immutable output.
- **Versioning**: SemVer, API analyzers ({{Microsoft.CodeAnalysis.PublicApiAnalyzers}}, {{PackageValidation}}) to fail CI on accidental breaks.
- **Obsolete with a path**: {{[Obsolete("Use X", error: false)]}} for at least a release cycle.
- **Extensibility points** explicit (options, strategy interfaces), not virtual-everything.
- Document nullability and thread-safety contracts.`,
  pts: [r`Small, sealed public surface`, r`Add overloads instead of optional params`, r`Automate compat checks`, r`Deprecation window`],
  ex: r`An internal shared SDK adopted PublicApiAnalyzers; two accidental breaking renames were caught in PR review.`,
  fu: [r`Why is adding an abstract member a breaking change?`],
  pit: [r`Making everything public and virtual.`] },

{ id: 'q38', level: 'Principal', tags: ['performance'],
  code: r`~~~csharp
[MemoryDiagnoser]
public class ParseBench
{
    private readonly string _csv = string.Join(',', Enumerable.Range(0, 1000));
    [Benchmark(Baseline = true)] public int Split() => _csv.Split(',').Sum(int.Parse);
    [Benchmark] public int Span()
    {
        int sum = 0;
        foreach (var range in _csv.AsSpan().Split(',')) sum += int.Parse(_csv.AsSpan()[range]);   // .NET 9
        return sum;
    }
}
// BenchmarkRunner.Run<ParseBench>();  -> compare Mean and Allocated, then confirm in a production profile
~~~`,
  q: r`How do you approach C# performance work: measurement first?`,
  a: r`1. **Define the goal** (p99 latency, throughput, memory) and measure in production-like conditions.
2. **Find the bottleneck**: CPU sampling (dotnet-trace, PerfView, Visual Studio profiler), allocation tracking, GC metrics, and distributed traces to see whether time is in your code at all (often it is the database or a remote call).
3. **Micro-benchmark** the candidate fix with **BenchmarkDotNet** (warm-up, statistical rigour, memory diagnoser). Never trust Stopwatch loops.
4. **Fix by order of payoff**: algorithm/data structure → remove I/O and N+1 → reduce allocations → batching/caching → low-level (Span, pooling, structs).
5. **Verify** end to end and guard with a perf test or an SLO alert.

Premature micro-optimisation that hurts readability is a cost; document why when you do it.`,
  pts: [r`Measure, do not guess`, r`BenchmarkDotNet for micro level`, r`Algorithm and I/O before micro-tuning`, r`Guard regressions`],
  ex: r`Profiling showed 60% of request time in a serializer; switching to source-generated System.Text.Json plus response compression cut p99 by 35%.`,
  fu: [r`What does the MemoryDiagnoser tell you?`],
  pit: [r`Optimising a method that is 1% of the profile.`] },

{ id: 'q39', level: 'Principal', tags: ['di', 'design'],
  code: r`~~~csharp
builder.Host.UseDefaultServiceProvider(o => { o.ValidateScopes = true; o.ValidateOnBuild = true; });
builder.Services.AddScoped<AppDbContext>();
builder.Services.AddSingleton<PriceCache>();     // PriceCache(AppDbContext db) -> captive dependency: throws at startup now

// Correct: singleton creates scopes when it needs scoped services
public sealed class PriceCache(IServiceScopeFactory scopes)
{
    public async Task RefreshAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        /* load prices */
    }
}
~~~`,
  q: r`Dependency-injection lifetimes and the captive-dependency problem.`,
  a: r`Lifetimes: **Transient** (new each resolve), **Scoped** (one per scope, e.g. request), **Singleton** (one for the app).

**Captive dependency**: a longer-lived service holds a shorter-lived one (a singleton injecting a scoped {{DbContext}}), keeping it alive past its scope and sharing a non-thread-safe instance across requests. Enable {{ValidateScopes}} (on by default in Development) and {{ValidateOnBuild}} to catch it.

Other rules: singletons must be thread-safe; do not resolve services from the root provider in request code (service locator); inject {{IServiceScopeFactory}} or {{IDbContextFactory<T>}} into singletons/background services to create scopes on demand; dispose of transient {{IDisposable}} created by the container are tracked until scope end (memory growth in singletons).`,
  pts: [r`Never inject shorter into longer lifetime`, r`Validate scopes and build`, r`Factory for scope creation in singletons`],
  ex: r`A singleton cache injected a scoped {{DbContext}}; concurrent requests corrupted it with "A second operation started on this context".`,
  fu: [r`Why can resolving a transient disposable from root leak?`],
  pit: [r`Using the service locator pattern for convenience.`] },

{ id: 'q40', level: 'Principal', tags: ['governance', 'quality'],
  code: r`~~~xml
<!-- Directory.Build.props in every repo (distributed via a template / shared props package) -->
<Project>
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <AnalysisLevel>latest-recommended</AnalysisLevel>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Meziantou.Analyzer" Version="2.0.163" PrivateAssets="all" />
  </ItemGroup>
</Project>
~~~`,
  q: r`How do you enforce C# quality and consistency across 30 engineers and 15 repositories?`,
  a: r`Make the right thing the automatic thing, not a review debate:

- **Central {{Directory.Build.props}} / shared package** with {{Nullable}}, {{TreatWarningsAsErrors}}, {{AnalysisMode}}, and SDK versions pinned ({{global.json}}).
- **{{.editorconfig}}** for style and analyzer severities, shipped via a shared NuGet or template repo so repos converge.
- **Analyzers** (Roslyn, Meziantou, Roslynator, SonarAnalyzer, custom for company rules such as "no {{DateTime.Now}}, use {{TimeProvider}}").
- **CI gates**: build, tests, format check ({{dotnet format --verify-no-changes}}), vulnerable-package audit ({{dotnet list package --vulnerable}}), coverage on changed code, public-API diff.
- **Templates and a paved road** ({{dotnet new}} service template with logging, health checks, OTel).
- **Review culture**: a short written standards doc with the *why*, ADRs for exceptions.

Roll out by turning rules on as warnings, fixing in batches, then promoting to errors: never a big-bang red build.`,
  pts: [r`Automate with analyzers and CI`, r`Shared build props and templates`, r`Warnings first, errors later`, r`Document the why`],
  ex: r`A custom analyzer banning {{DateTime.UtcNow}} in domain code (use {{TimeProvider}}) made time-dependent logic testable across 12 repos.`,
  fu: [r`How do you handle a team that wants to opt out?`],
  pit: [r`A 40-page style guide nobody reads and no tool enforces.`] },

{ id: 'q41', level: 'Principal', tags: ['migration', 'upgrade'],
  code: r`~~~bash
dotnet tool install -g upgrade-assistant
upgrade-assistant analyze ./src/Orders.sln --format sarif --output orders-readiness.sarif
upgrade-assistant upgrade ./src/Orders.Api/Orders.Api.csproj --targetFramework net8.0 --non-interactive
dotnet list package --vulnerable --include-transitive
dotnet list package --deprecated
~~~
~~~xml
<!-- Wave plan: libraries first via multi-targeting, then services -->
<TargetFrameworks>net48;net8.0</TargetFrameworks>
~~~`,
  q: r`Plan a migration of 40 services from .NET Framework / .NET 6 to .NET 8/9 LTS.`,
  a: r`1. **Inventory**: dependency graph, runtime/framework per service, unsupported libraries ({{try-convert}}, .NET Upgrade Assistant, {{ApiPort}}-style analysis), and business criticality. Check support end dates (.NET 6 is out of support).
2. **Order by leverage and risk**: shared libraries first (multi-target {{net8.0;netstandard2.0}} as a bridge), then leaf services, then the critical ones.
3. **Prove the path** with one low-risk service: build, containers, observability, performance baselines.
4. **Per service**: upgrade packages, fix breaking changes, run contract/integration tests, canary deploy with automatic rollback, compare latency/error/memory dashboards against the baseline.
5. **Capacity**: .NET 8 often reduces CPU/memory; re-baseline autoscaling before cutting limits.
6. **Governance**: a tracking dashboard, a deadline tied to security patching, and a freeze on new .NET Framework projects.

Success metric: services on supported runtime, zero customer-visible regressions, measured cost reduction.`,
  pts: [r`Shared libraries first with multi-targeting`, r`Pilot, then batch`, r`Canary + baseline comparison`, r`Security-patch deadline drives urgency`],
  ex: r`A bank moved 40 services in three quarters; the CPU reduction paid for the work and removed an unsupported-runtime audit finding.`,
  fu: [r`How do you handle a vendor DLL that targets .NET Framework only?`],
  pit: [r`Upgrading everything at once without a rollback path.`] },

{ id: 'q42', level: 'Principal', tags: ['architecture', 'async'],
  code: r`~~~csharp
// I/O-bound: async (frees the thread while waiting)
public async Task<Customer?> GetAsync(Guid id, CancellationToken ct) => await _db.Customers.FindAsync([id], ct);
// CPU-bound and fast: keep it synchronous (async adds a state machine for nothing)
public decimal Tax(decimal net) => decimal.Round(net * 0.2m, 2);
// CPU-bound and heavy in a web app: do not Task.Run per request; offload to a queue/worker
// Pure in-memory cache hit on an async API: ValueTask to avoid allocations
public ValueTask<Rate> RateAsync(string pair) => _cache.TryGetValue(pair, out var r) ? new(r) : new(FetchAsync(pair));
~~~`,
  q: r`Design guidelines: how should a team decide sync vs async, and when is async not worth it?`,
  a: r`Async pays off for **I/O-bound** work where threads would otherwise block (database, HTTP, queues) and for scalability under concurrency. It is not free: state-machine overhead, harder stack traces and debugging, viral signatures, and subtle context issues.

Guidelines to set:

- I/O → async end to end, never block on async ({{.Result}}).
- Pure CPU work → synchronous; offload to a dedicated pool only in UI or when you must not block a request thread.
- Libraries expose async for I/O; avoid "async wrappers over sync" (and the reverse).
- Always flow {{CancellationToken}}.
- Hot synchronous paths: {{ValueTask}} only with evidence.
- A low-concurrency internal batch tool may reasonably stay synchronous for simplicity.

State the principle and exceptions in a short ADR so reviewers argue from policy, not taste.`,
  pts: [r`Async for I/O scalability`, r`Never sync-over-async`, r`Async has real costs`, r`Write the policy down`],
  ex: r`A CLI migration tool processing one file at a time stayed synchronous; the web API using the same library used async.`,
  fu: [r`What is the cost of making a method async that always completes synchronously?`],
  pit: [r`Declaring "everything async" without understanding the exceptions.`] },

{ id: 'q43', level: 'Principal', tags: ['unsafe', 'risk'],
  code: r`~~~csharp
// Proposal under review
public static unsafe int SumUnsafe(int[] data) { fixed (int* p = data) { int s = 0; for (int i = 0; i < data.Length; i++) s += p[i]; return s; } }
// Safe alternative that is usually as fast: spans + vectorised BCL
public static int SumSafe(ReadOnlySpan<int> data) { int s = 0; foreach (var x in data) s += x; return s; } // bounds checks elided by the JIT
public static int SumVector(ReadOnlySpan<int> data) => System.Numerics.Tensors.TensorPrimitives.Sum(data); // SIMD, safe
// Decide with BenchmarkDotNet numbers against the latency budget, then isolate any unsafe code in one reviewed module
~~~`,
  q: r`A colleague proposes unsafe code / stackalloc / manual memory to hit a latency target. How do you evaluate it?`,
  a: r`Ask for evidence and weigh the maintenance risk:

1. **Is the bottleneck real and in this code?** Show the profile and the target (p99 budget).
2. **Have safe options been exhausted?** Span, pooling, structs, better algorithm, batching, caching. Most gains come from there.
3. **Quantify the gain** with BenchmarkDotNet and an end-to-end test, not a micro-benchmark alone.
4. **Contain the risk**: isolate in one small, well-tested type behind a safe API; add fuzz/property tests, bounds checks in debug, comments with invariants, and ownership (named maintainer).
5. **Consider the blast radius**: unsafe bugs cause memory corruption and security vulnerabilities, not just exceptions; and they complicate AOT/verification.

Decision: approve only with measured, material gain, a narrow contained implementation, and tests. Otherwise stay safe.`,
  pts: [r`Evidence before approval`, r`Exhaust safe alternatives`, r`Contain behind a safe API`, r`Security and maintenance cost`],
  ex: r`Span-based parsing delivered 90% of the gain; the unsafe pointer version added only 3% and was rejected.`,
  fu: [r`How would you test unsafe code?`],
  pit: [r`Approving based on a micro-benchmark with no end-to-end effect.`] },

{ id: 'q44', level: 'Principal', tags: ['nullable', 'migration'],
  code: r`~~~xml
<!-- Phase 1: project-wide annotations without warnings; Phase 2: warnings; Phase 3: errors -->
<Nullable>annotations</Nullable>
<!-- later -->
<Nullable>enable</Nullable>
<WarningsAsErrors>nullable</WarningsAsErrors>
~~~
~~~csharp
#nullable enable   // opt in file by file, starting with leaf libraries and new code
// Track progress in CI: count of files without '#nullable enable' trending to zero
~~~`,
  q: r`How do you roll out nullable reference types and other strictness changes in a large legacy codebase?`,
  a: r`Avoid the two bad extremes (ignore it forever; turn it on and drown in 12,000 warnings).

1. **Enable for new projects by default** via a template and Directory.Build.props.
2. **Legacy: file-by-file** with {{#nullable enable}} or per-project {{Nullable=enable}} while keeping warnings non-blocking; start with the **core domain/shared libraries** (most reuse, most benefit), then outward.
3. **Annotate public APIs first**: consumers get the benefit immediately.
4. **Triage warnings**: fix real bugs, annotate intent, use {{!}} only with a comment and a ticket; track the count on a dashboard and ratchet it down (a CI check that the warning count never increases).
5. **Promote to errors** per project once clean.
6. Keep runtime validation at trust boundaries; the feature is not a runtime guarantee.

Time-box it and report defects found: this justifies the effort to stakeholders.`,
  pts: [r`Core libraries first`, r`Ratchet: warning count never rises`, r`Report bugs found`],
  ex: r`A ratchet check in CI prevented new warnings while the team burned down 2,400 over six sprints.`,
  fu: [r`How do you handle generated code?`],
  pit: [r`A single mega-PR touching 800 files.`] },

{ id: 'q45', level: 'Principal', tags: ['architecture', 'decision'],
  code: r`~~~csharp
public readonly record struct Money(decimal Amount, string Currency);   // small, immutable, hot-path value
public sealed record PaymentRequested(Guid PaymentId, Money Amount, DateTimeOffset At);   // immutable event
public sealed class Payment                                                 // entity: identity + lifecycle
{
    public Guid Id { get; }
    public PaymentStatus Status { get; private set; }
    public Money Amount { get; }
    public Payment(Guid id, Money amount) => (Id, Amount, Status) = (id, amount, PaymentStatus.Created);
    public void Capture() { if (Status != PaymentStatus.Authorized) throw new InvalidOperationException(); Status = PaymentStatus.Captured; }
}
~~~`,
  q: r`Records, classes or structs for your domain model? Make the decision for a payments domain.`,
  a: r`Decide per concept, using identity and lifecycle:

- **Value objects** ({{Money}}, {{Iban}}, {{AccountNumber}}, {{OrderId}}): immutable, equality by value, validated in the constructor → {{readonly record struct}} for small ones, {{sealed record}} for larger. Strongly typed ids prevent mixing {{CustomerId}} with {{OrderId}}.
- **Entities / aggregates** ({{Payment}}, {{Account}}): identity and a lifecycle with state transitions and invariants → **classes** with private setters and behaviour methods (not records, since value equality on a mutable entity is wrong).
- **DTOs / events / commands**: {{record}} (immutable, serialisable, versionable).
- **Money amounts**: {{decimal}} (never {{double}}) with explicit currency and rounding rules.

Trade-off: records for entities invite accidental value-equality and {{with}} copies that bypass invariants. Document the convention so the model stays consistent.`,
  pts: [r`Value objects as records/structs`, r`Entities as classes with behaviour`, r`decimal for money, strongly typed ids`],
  ex: r`Mixing up two {{Guid}} parameters (customer and order) caused a production incident; strongly typed ids made it a compile error.`,
  fu: [r`How would EF Core map these value objects?`],
  pit: [r`Using double for currency.`] },

{ id: 'q46', level: 'Principal', tags: ['mentoring', 'review'],
  code: r`~~~csharp
// Review comments I would leave on this hunk
public async Task<List<Order>> GetOrders(int customerId)                  // 1. no CancellationToken
{
    var orders = _db.Orders.Where(o => o.CustomerId == customerId).ToList(); // 2. sync I/O in async method; 3. unbounded result
    foreach (var o in orders) o.Lines = _db.Lines.Where(l => l.OrderId == o.Id).ToList(); // 4. N+1 queries
    return orders;                                                          // 5. returns entities, not DTOs
}
// Suggested
public Task<List<OrderDto>> GetOrdersAsync(int customerId, int page, CancellationToken ct) =>
    _db.Orders.Where(o => o.CustomerId == customerId).OrderByDescending(o => o.CreatedAt)
       .Skip(page * 50).Take(50).Select(o => new OrderDto(o.Id, o.Total, o.Lines.Count)).ToListAsync(ct);
~~~`,
  q: r`What do you look for when reviewing a senior engineer's C# pull request?`,
  a: r`Beyond style (which tooling handles):

- **Correctness under failure**: cancellation, timeouts, retries, idempotency, partial failures.
- **Concurrency**: shared mutable state, lock scope, async misuse, captive dependencies.
- **Resource lifetime**: disposal, HttpClient usage, connections, streams.
- **Allocation and I/O on hot paths**: N+1 queries, repeated enumeration, unbounded collections.
- **API design**: surface size, naming, nullability, compatibility.
- **Testability and seams**: time, randomness, I/O behind abstractions.
- **Observability**: structured logs with correlation ids, metrics, no secrets in logs.
- **Security**: input validation, injection, authorisation checks at the right layer.
- **Operational impact**: config, migrations, rollback.

Review for **risk**, not for taste; ask questions ("what happens if this call times out?") rather than dictating, and leave non-blocking nits as such.`,
  pts: [r`Failure modes first`, r`Risk over taste`, r`Ask questions to teach`],
  ex: r`A one-line change adding {{.Result}} in a request path was caught in review before it caused starvation.`,
  fu: [r`How do you keep reviews fast?`],
  pit: [r`Bike-shedding formatting that a formatter should handle.`] },

{ id: 'q47', level: 'Principal', tags: ['synthesis'],
  code: r`~~~csharp
// Senior answer: "use ValueTask, it allocates less" (correct, local)
// Principal answer adds the constraints, the measurement and the policy:
//  - only on hot paths that usually complete synchronously (cache hits), proven by a profile
//  - consumers must await once; document it on the public API
//  - team rule encoded as an analyzer suppression list, not tribal knowledge
public ValueTask<Quote> GetQuoteAsync(string symbol, CancellationToken ct) =>
    _quotes.TryGetValue(symbol, out var q) ? ValueTask.FromResult(q) : new(FetchAsync(symbol, ct));
~~~`,
  q: r`What separates a Principal-level C# answer from a Senior one?`,
  a: r`A senior engineer knows the language features and can fix the bug in front of them.

A principal engineer additionally:

1. **Explains the mechanism**: why an await frees a thread, why a struct was copied, why GC pauses occurred, not just the rule.
2. **Reasons about failure and load**: cancellation, back-pressure, starvation, memory growth, not just the happy path.
3. **Measures before optimising** and states the cost of complexity.
4. **Designs for evolution**: API surface, compatibility, deprecation, analyzers.
5. **Scales the practice**: templates, analyzers, ADRs, migration plans that make 30 engineers write safer code by default.
6. **Names the trade-off**: AOT vs JIT throughput, async vs simplicity, pooling vs safety.

The discriminating question: "this endpoint is slow only under load and CPU is idle: what do you check?" Senior: "add caching / more instances". Principal: "thread-pool starvation from sync-over-async or a saturated downstream pool; confirm with counters and a dump, then remove the blocking and bound concurrency".`,
  pts: [r`Mechanism + failure + measurement`, r`Scale through tooling and policy`, r`Name trade-offs`],
  ex: r`Use the idle-CPU-slow-under-load scenario as a closing example in interviews.`,
  fu: [r`Which of these would you institutionalise first?`],
  pit: [r`Reciting feature lists without causal reasoning.`] },

{ id: 'q48', level: 'Principal', tags: ['async', 'pipelines'],
  q: r`Design an in-process pipeline that ingests 50,000 messages per second, enriches them via an HTTP call and writes to a database. How do you build it in C#?`,
  a: r`### Shape
Stages connected by **bounded {{Channel<T>}}s**: read → parse → enrich (I/O-bound, parallel) → batch → write. Bounded capacity gives **back-pressure**: a slow database slows the reader instead of growing memory until OOM.

~~~csharp
var parsed   = Channel.CreateBounded<Msg>(new BoundedChannelOptions(10_000) { FullMode = BoundedChannelFullMode.Wait, SingleReader = false });
var enriched = Channel.CreateBounded<Enriched>(10_000);

var enrichers = Enumerable.Range(0, 32).Select(_ => Task.Run(async () =>
{
    await foreach (var m in parsed.Reader.ReadAllAsync(ct))
        await enriched.Writer.WriteAsync(await EnrichAsync(m, ct), ct);
}, ct)).ToArray();

var writer = Task.Run(async () =>
{
    var batch = new List<Enriched>(500);
    await foreach (var e in enriched.Reader.ReadAllAsync(ct))
    {
        batch.Add(e);
        if (batch.Count == 500) { await BulkInsertAsync(batch, ct); batch.Clear(); }
    }
    if (batch.Count > 0) await BulkInsertAsync(batch, ct);
}, ct);

await Task.WhenAll(enrichers); enriched.Writer.Complete(); await writer;
~~~

### Decisions to state
- **Concurrency per stage** sized to the dependency: 32 concurrent HTTP calls because the enrichment service allows that much, not "as many as possible".
- **Batching** database writes (SqlBulkCopy / multi-row insert) with both size and time triggers so a quiet period still flushes.
- **Failure policy per stage**: retry transient errors with backoff, route poison messages to a dead-letter sink, never let one bad message kill the pipeline.
- **Completion and shutdown**: complete writers in order, drain on SIGTERM, checkpoint the source offset only after the batch commits (at-least-once, so the sink must be idempotent).
- **Observability**: queue depth per channel, stage latency histograms, throughput, error counts.

### Limits
In-process means work in channels is lost on crash; durability comes from not committing the source offset until written. For cross-process scale, use Kafka/SQS partitions instead.`,
  pts: [r`Bounded channels for back-pressure`, r`Concurrency sized to each dependency`, r`Batch writes with size and time triggers`, r`Commit source offsets after the sink commits`, r`Per-stage metrics`],
  ex: r`A market-data enrichment service using this design held memory flat at 400 MB during a downstream slowdown that previously caused OOM crashes with an unbounded {{ConcurrentQueue}}.`,
  fu: [r`How do you add a time-based flush to the batch stage?`, r`How would you preserve per-key ordering with parallel enrichers?`, r`When would you replace this with TPL Dataflow or Kafka?`],
  pit: [r`Unbounded queues that hide a slow consumer until the process dies.`, r`Committing the source offset before the write succeeds (data loss).`, r`Task.WhenAll over every message (unbounded concurrency).`],
  tip: r`Say the words "back-pressure" and "where is the durability boundary". Interviewers listen for both.` },

{ id: 'q49', level: 'Principal', tags: ['exceptions', 'architecture'],
  code: r`~~~csharp
// Expected business outcomes: result types; infrastructure faults: exceptions; boundary: ProblemDetails
public abstract record TransferResult
{
    public sealed record Ok(Guid TransferId) : TransferResult;
    public sealed record InsufficientFunds(decimal Available) : TransferResult;
    public sealed record AccountFrozen : TransferResult;
}
app.MapPost("/transfers", async (TransferCommand cmd, TransferService svc, CancellationToken ct) =>
    await svc.ExecuteAsync(cmd, ct) switch
    {
        TransferResult.Ok ok => Results.Created("/transfers/" + ok.TransferId, ok),
        TransferResult.InsufficientFunds f => Results.Problem(statusCode: 422, title: "Insufficient funds", type: "https://errors.example.com/insufficient-funds"),
        TransferResult.AccountFrozen => Results.Problem(statusCode: 409, title: "Account frozen"),
        _ => Results.Problem(statusCode: 500)
    });
builder.Services.AddProblemDetails(); app.UseExceptionHandler();   // unexpected exceptions -> 500 without leaking details
~~~`,
  q: r`Define an error-handling strategy for a large .NET codebase: exceptions versus result types, error taxonomy, and what crosses each boundary.`,
  a: r`### Taxonomy first
Classify failures, because each class needs different handling:

| Class | Example | Handling |
|---|---|---|
| **Expected business outcome** | Insufficient funds, validation failure | Return a result/discriminated outcome; map to 4xx with a stable code |
| **Transient infrastructure** | Timeout, deadlock 1205, 503 | Retry with backoff at **one** layer, then surface |
| **Permanent infrastructure** | Bad credentials, missing table | Fail fast, alert |
| **Bug / invariant violation** | Null where impossible | Exception, crash the request, log, fix the code |

### Rules
- **Exceptions for the exceptional** (bugs, infrastructure). They are expensive and invisible in signatures.
- **Result types** ({{Result<T, Error>}} or {{OneOf}}) for expected business outcomes in the domain/application layer, so callers must handle them and they cost nothing at runtime.
- **Translate at boundaries**: infrastructure exceptions are wrapped or mapped at the adapter; HTTP edge maps outcomes to RFC 9457 ProblemDetails with a stable {{type}}; message consumers map to retry, dead-letter or discard.
- **Log once**, at the boundary that handles it, with correlation id; never log-and-rethrow at every layer.
- **Never swallow**; {{catch (Exception)}} only at top-level boundaries.
- **Error codes are an API**: documented, versioned, never derived from exception messages.

### Rollout
Write it as a short ADR with examples, provide the {{Result}} type and middleware in the shared template, and add analyzers (empty catch, {{throw ex}}, catching general exceptions outside boundaries).`,
  pts: [r`Classify: business, transient, permanent, bug`, r`Results for expected outcomes, exceptions for the rest`, r`Translate at boundaries`, r`Log once`, r`Error codes are a public contract`],
  ex: r`After adopting the taxonomy, duplicate error logs fell by 70% and client teams stopped string-matching exception messages because every business failure had a stable code.`,
  fu: [r`Where exactly do retries live in your layering?`, r`How do results compose without nested if-chains?`, r`How do you migrate an exception-heavy codebase gradually?`],
  pit: [r`Using exceptions for validation in hot paths.`, r`Leaking SQL exception text to API clients.`, r`Retrying at several layers and multiplying load.`],
  trade: r`Result types make outcomes explicit but add ceremony; reserve them for the domain and application layers where outcomes are part of the contract.` },

{ id: 'q50', level: 'Principal', tags: ['code-review', 'async'],
  q: r`Code review: find the production bugs in this C# service method and explain the fixes.`,
  a: r`~~~csharp
public class ReportService
{
    private static readonly List<Report> _cache = new();
    private readonly HttpClient _http = new HttpClient();
    private readonly AppDbContext _db;                         // injected (scoped)

    public async void Generate(int customerId)
    {
        var orders = _db.Orders.Where(o => o.CustomerId == customerId);
        foreach (var o in orders)
        {
            var rate = _http.GetAsync($"https://fx/rates/{o.Currency}").Result;
            o.Total = o.Total * decimal.Parse(await rate.Content.ReadAsStringAsync());
        }
        _cache.Add(new Report(customerId, orders.Sum(o => o.Total)));
        _db.SaveChanges();
    }
}
~~~

Findings, most severe first:

1. **{{async void}}**: exceptions crash the process and callers cannot await or observe completion. Return {{Task}}.
2. **{{.Result}} inside async code**: sync-over-async; thread-pool starvation under load. {{await}} it.
3. **Mutating tracked entities and calling {{SaveChanges}}**: the report silently **overwrites order totals in the database** with converted values. Project into a DTO instead.
4. **N+1 HTTP calls** per order (and per currency): fetch distinct currencies once, in parallel with a bound, or from a cached rates service.
5. **Multiple enumeration of the {{IQueryable}}**: {{orders.Sum}} runs a second database query (and on the database it would ignore the in-memory changes). Materialise once.
6. **Static {{List}} cache**: not thread-safe, unbounded (memory leak), shared across tenants.
7. **{{new HttpClient()}}** per service instance: socket exhaustion; use {{IHttpClientFactory}} with timeouts and resilience.
8. **No {{CancellationToken}}**, no timeouts.
9. **{{decimal.Parse}} with current culture**: breaks on {{,}} decimal separators; use {{CultureInfo.InvariantCulture}} and a typed JSON response.
10. Money conversion with no rounding policy, no rate timestamp, and no audit of which rate was used.

Rewrite principle: pure query (projection) → distinct currencies → cached rates → compute in memory → return a result; persist the report separately if needed, with idempotency.`,
  pts: [r`async void and .Result`, r`Accidental persistence of tracked entities`, r`N+1 remote calls`, r`Unbounded static cache`, r`Culture-sensitive parsing of money`],
  ex: r`Finding 3 is a real class of incident: a "read-only" report job rewrote order amounts in production because entities were tracked and SaveChanges was called for an unrelated reason.`,
  fu: [r`How would you prioritise these comments in a review?`, r`Which of these would an analyzer catch automatically?`, r`How do you coach the author without demoralising them?`],
  pit: [r`Commenting only on style while missing the data-corruption bug.`, r`Listing issues without ranking by severity.`],
  tip: r`Rank findings by blast radius: data corruption and crashes before performance before style. That ordering is what reviewers at this level look for.` }
],
cheat: r`### Memory and types
- Value vs reference: copy semantics, not "stack vs heap". Struct = small, immutable, value-like; mark {{readonly struct}}.
- Boxing allocates; generics and constrained calls avoid it. Strings immutable: StringBuilder / Span for heavy work.
- GC: Gen0/1/2, LOH at 85,000 bytes, server vs workstation, background. Reduce allocations first.
- Dispose = deterministic, finalizer = safety net, SafeHandle over finalizers.

### Async and concurrency
| Rule | Why |
|---|---|
| Async all the way, never .Result | Sync-over-async deadlocks and starves the pool |
| ConfigureAwait(false) in libraries | No context needed |
| CancellationToken last param, pass down | Cooperative cancel, free resources |
| Bound concurrency (SemaphoreSlim / bounded Channel / MaxDOP) | Protect dependencies, memory |
| No await inside lock; SemaphoreSlim for async mutex | Compile and design constraint |
| ValueTask only with evidence, await once | Safety |

### LINQ
Deferred execution; materialise once; IQueryable for providers, IEnumerable in memory; filter before ToList.

### Design
Interface = capability, abstract class = shared implementation, prefer composition. internal by default, sealed by default. Records for DTOs/value objects, classes for entities. decimal for money.

### Diagnose
Memory leak: gcdump diff + GC roots. Starvation: dotnet-counters + dump. Perf: profile, BenchmarkDotNet, algorithm then I/O then allocations.

### Say this
"Await releases the thread." "Measure first." "Nullable is compile-time only." "Public const is a binary-compat hazard." "Starvation looks like low CPU and high latency."`
});
})(String.raw);
