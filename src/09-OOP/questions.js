(function (r) {
registerTopic('09-oop', {
related: ['10-solid', '11-design-patterns', '01-csharp'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['encapsulation'],
  q: r`What does encapsulation really protect, beyond "private fields with getters and setters"?`,
  a: r`Encapsulation protects **invariants**: rules that must always hold for an object to be valid. Private fields are only the mechanism; the point is that the only way to change state is through operations that keep the object valid.

Getters and setters for every field are **not** encapsulation: they expose the data structure and push rule enforcement to every caller.

~~~csharp
// Anaemic: anyone can set Balance to anything
public class Account { public decimal Balance { get; set; } }

// Encapsulated: invariants enforced in one place
public sealed class Account
{
    public decimal Balance { get; private set; }
    public decimal OverdraftLimit { get; }
    public Account(decimal overdraftLimit) => OverdraftLimit = overdraftLimit >= 0 ? overdraftLimit
        : throw new ArgumentOutOfRangeException(nameof(overdraftLimit));

    public void Withdraw(decimal amount)
    {
        if (amount <= 0) throw new ArgumentOutOfRangeException(nameof(amount));
        if (Balance - amount < -OverdraftLimit) throw new InvalidOperationException("Overdraft limit exceeded");
        Balance -= amount;
    }
}
~~~

Benefits at scale: one place to change a rule, impossible states become unrepresentable, and concurrency control can be added in one place.`,
  pts: [r`Protects invariants, not fields`, r`Behaviour-rich methods over setters`, r`Constructor guarantees valid state`, r`One place to change rules`],
  ex: r`A loan system allowed negative interest rates because 14 services set the rate property directly; moving validation into a value object fixed the bug class.`,
  fu: [r`How does encapsulation relate to DDD aggregates?`, r`Is an EF Core entity with private setters encapsulated?`],
  pit: [r`Equating encapsulation with auto-properties.`],
  tip: r`Use the word "invariant" in your first sentence. It is the senior signal for this question.` },

{ id: 'q2', level: 'Basic', tags: ['polymorphism'],
  q: r`Explain polymorphism and how virtual dispatch works in .NET.`,
  a: r`Polymorphism lets code work with an abstraction while the concrete behaviour is chosen at runtime (subtype polymorphism) or compile time (generics, overloads).

**Runtime dispatch** in .NET: each type has a **method table** (MT) with slots for virtual methods. A {{virtual}} or {{abstract}} method call compiles to {{callvirt}}, which loads the object's MT and calls the slot. An {{override}} replaces the slot in the derived type's table. Interface calls use **virtual stub dispatch** (a cache of stubs per call site), slightly costlier than a virtual call. The JIT can **devirtualize** when the type is known ({{sealed}} classes, dynamic PGO guarded devirtualization in .NET 8+).

Other forms:

- **Parametric** (generics): one algorithm for many types; for value types the JIT generates specialised code.
- **Ad hoc** (overloading): resolved at compile time by static types.

~~~csharp
public abstract class PaymentMethod { public abstract Task<Result> AuthorizeAsync(Money amount); }
public sealed class Card : PaymentMethod { public override Task<Result> AuthorizeAsync(Money a) => /* ... */ default!; }
public sealed class Wallet : PaymentMethod { public override Task<Result> AuthorizeAsync(Money a) => /* ... */ default!; }
~~~

Note {{new}} (method hiding) is not polymorphism: the static type decides which method runs.`,
  pts: [r`Runtime vs compile-time polymorphism`, r`Method table slots, callvirt`, r`Interface stub dispatch`, r`Devirtualization with sealed/PGO`, r`new hides, override replaces`],
  ex: r`Sealing hot-path classes in a pricing engine let the JIT devirtualize and inline calls, cutting a benchmark by 12%.`,
  fu: [r`What is the difference between override and new?`, r`Why mark classes sealed by default?`],
  pit: [r`Calling overloading "runtime polymorphism".`] },

{ id: 'q3', level: 'Basic', tags: ['inheritance', 'composition'],
  q: r`Composition over inheritance: what problem does it solve, and when is inheritance still right?`,
  a: r`Inheritance couples the subclass to the **implementation** of the base class (the "fragile base class" problem): a change in the base can break subclasses, subclasses depend on protected internals, and the hierarchy fixes one axis of variation at compile time.

Composition builds behaviour from collaborating objects behind interfaces: variations combine freely at runtime, and each part can be tested and replaced independently.

~~~csharp
// Inheritance explosion: EmailNotifier, SmsNotifier, EmailNotifierWithRetry, SmsNotifierWithRetry...
// Composition: wrap channels with behaviours
INotifier notifier = new RetryingNotifier(new LoggingNotifier(new SmsNotifier(client)), maxAttempts: 3);
~~~

Inheritance is still right when:

- There is a genuine **is-a** relationship with substitutability (LSP holds).
- A framework expects it ({{ControllerBase}}, {{BackgroundService}}, {{DbContext}}).
- You share a **template** of an algorithm with fixed steps (Template Method), within one team's control.
- Closed hierarchies modelling alternatives (a {{Shape}} with a few sealed subtypes, discriminated-union style).

Rule of thumb: inherit for **type**, compose for **behaviour reuse**.`,
  pts: [r`Fragile base class`, r`Composition combines variations`, r`Decorator-style wrapping`, r`Inherit for is-a with LSP`, r`Frameworks and template methods`],
  ex: r`A reporting module with 23 subclasses (PDF/Excel × filters × branding) was replaced with 3 composable strategies, removing the class explosion.`,
  fu: [r`How do default interface methods change this debate?`],
  pit: [r`Saying "never use inheritance".`] },

{ id: 'q4', level: 'Basic', tags: ['abstraction', 'interfaces'],
  code: r`~~~csharp
// Interface = capability/port; evolves with a default member (C# 8+)
public interface IExchangeRateProvider
{
    Task<decimal> GetRateAsync(string from, string to, CancellationToken ct);
    Task<decimal> GetMidRateAsync(string from, string to, CancellationToken ct) => GetRateAsync(from, to, ct); // added later, non-breaking
}
// Static abstract member: a factory contract usable from generic code
public interface IParsable2<TSelf> where TSelf : IParsable2<TSelf> { static abstract TSelf Parse(string s); }

// Abstract class = shared state + template method inside one module
public abstract class GatewayBase(HttpClient http)
{
    public async Task<string> SendAsync(object payload, CancellationToken ct)
    {
        var body = Sign(Serialize(payload));                 // fixed steps
        using var res = await http.PostAsync(Endpoint, body, ct);
        return await MapResponseAsync(res, ct);              // variable step
    }
    protected abstract Uri Endpoint { get; }
    protected abstract Task<string> MapResponseAsync(HttpResponseMessage res, CancellationToken ct);
    private static StringContent Serialize(object p) => new(System.Text.Json.JsonSerializer.Serialize(p));
    private static StringContent Sign(StringContent c) => c; // HMAC header omitted
}
~~~`,
  q: r`Abstract class vs interface in modern C#: how do you choose?`,
  a: r`| | Interface | Abstract class |
|---|---|---|
| Multiple | A type can implement many | Single base class |
| State | No instance fields | Fields, constructors |
| Members | Contracts; default implementations (C# 8+), static abstract members (C# 11) | Abstract and concrete members, protected helpers |
| Versioning | Adding a member breaks implementers unless it has a default | Adding a virtual member with implementation is safe |
| Value types | Structs can implement | Structs cannot inherit |

Choose an **interface** to define a capability or a port (repository, clock, payment gateway), especially across assembly or team boundaries and for testing. Choose an **abstract class** to share implementation and state among closely related types with a common lifecycle (template method), within one module.

Static abstract interface members enable generic math ({{INumber<T>}}) and factory-style contracts: {{static abstract T Create(...)}}.

Default interface methods help evolve published interfaces, but do not use them to smuggle in shared state or complex logic.`,
  pts: [r`Interfaces for capabilities and ports`, r`Abstract classes for shared implementation`, r`Default interface members for evolution`, r`Static abstract members`, r`Structs implement interfaces`],
  ex: r`A payments SDK exposed {{IPaymentGateway}} for consumers and used an internal abstract {{GatewayBase}} for shared retry and signing logic across providers.`,
  fu: [r`What does boxing have to do with interfaces on structs?`],
  pit: [r`Creating an interface for every class "for testing" with one implementation forever.`] },

{ id: 'q5', level: 'Basic', tags: ['value-objects', 'equality'],
  q: r`Entity vs value object: how do they differ and how do you implement value objects in C#?`,
  a: r`- **Entity**: identity matters and persists through change (a Customer with id 42 is the same customer after changing address). Equality by id.
- **Value object**: defined entirely by its values, immutable, equality by value, no identity (Money, Address, DateRange, Email).

C# **records** make value objects concise: value equality, immutability with {{init}}, {{with}} expressions.

~~~csharp
public sealed record Money(decimal Amount, string Currency)
{
    public Money
    {
        if (Currency is not { Length: 3 }) throw new ArgumentException("ISO 4217 code required");
        Amount = decimal.Round(Amount, 2, MidpointRounding.ToEven);
    }
    public Money Add(Money other) => other.Currency == Currency
        ? this with { Amount = Amount + other.Amount }
        : throw new InvalidOperationException("Currency mismatch");
}
~~~

Value objects eliminate **primitive obsession** (passing raw decimals and strings for money and currency), centralise validation, and make illegal states unrepresentable. Use {{readonly record struct}} for small, hot-path values to avoid allocations.

EF Core maps value objects as owned types or complex types (EF 8+).`,
  pts: [r`Entity: identity; value object: values`, r`Immutability and value equality`, r`Records and validation in constructor`, r`Avoid primitive obsession`, r`EF Core complex types`],
  ex: r`A bug where USD amounts were added to EUR amounts disappeared once Money became a value object rejecting currency mismatches.`,
  fu: [r`Record class vs record struct for value objects?`],
  pit: [r`Mutable value objects (changing one shared instance changes many entities).`] },

{ id: 'q6', level: 'Basic', tags: ['coupling', 'cohesion'],
  code: r`~~~csharp
// Control coupling (flag steers behaviour) -> split into intention-revealing methods
public void Export(Report r, bool asPdf) { if (asPdf) { /* pdf */ } else { /* csv */ } }   // smell
public void ExportPdf(Report r) { /* ... */ }
public void ExportCsv(Report r) { /* ... */ }

// Architecture test (NetArchTest) failing the build on a forbidden dependency
[Fact]
public void Domain_does_not_depend_on_infrastructure() =>
    Types.InAssembly(typeof(Order).Assembly)
         .ShouldNot().HaveDependencyOn("MyApp.Infrastructure")
         .GetResult().IsSuccessful.Should().BeTrue();
~~~
~~~bash
# change coupling: files that change together most often (code-maat / git log mining)
git log --since=12.months --name-only --pretty=format: | sort | uniq -c | sort -rn | head -20
~~~`,
  q: r`Explain coupling and cohesion and how you measure them in a codebase.`,
  a: r`- **Cohesion**: how strongly the responsibilities inside a module belong together. High cohesion = a class changes for one reason; its methods use the same fields.
- **Coupling**: how much a module depends on others' details. Low coupling = changes stay local.

Kinds of coupling from worst to best: content (reaching into internals), common (shared global state), control (passing flags that steer behaviour), stamp (passing whole objects when a field is needed), data (passing just what is needed), message (events).

Measuring:

- **Change coupling** from git history: files that always change together across modules signal hidden coupling.
- Static metrics: afferent/efferent coupling, instability (Ce/(Ca+Ce)), LCOM (lack of cohesion), cyclomatic complexity (NDepend, Roslyn analyzers).
- Dependency graphs and **architecture tests** (NetArchTest, ArchUnitNET) that fail the build on forbidden references.

High cohesion and low coupling are what make teams independent; they are an organisational property as much as a code property.`,
  pts: [r`Cohesion: one reason to change`, r`Coupling types`, r`Change coupling from git`, r`Metrics and architecture tests`, r`Enables team independence`],
  ex: r`Git change-coupling analysis showed the billing and shipping modules changed together in 70% of commits; a shared "OrderStatus" enum was the hidden coupling.`,
  fu: [r`What is connascence?`],
  pit: [r`Reducing coupling by adding interfaces everywhere without reducing knowledge sharing.`] },

{ id: 'q7', level: 'Intermediate', tags: ['lsp', 'inheritance'],
  code: r`~~~csharp
public class Rectangle { public virtual int Width { get; set; } public virtual int Height { get; set; } public int Area => Width * Height; }
public class Square : Rectangle
{
    public override int Width  { set { base.Width = value; base.Height = value; } }
    public override int Height { set { base.Width = value; base.Height = value; } }
}
static void Resize(Rectangle r) { r.Width = 5; r.Height = 4; Debug.Assert(r.Area == 20); } // fails for Square

// Fix: immutable shapes behind a common abstraction, no setters to break
public abstract record Shape { public abstract double Area { get; } }
public sealed record Rect(double W, double H) : Shape { public override double Area => W * H; }
public sealed record Sq(double Side) : Shape { public override double Area => Side * Side; }
~~~`,
  q: r`Why is Square-inherits-Rectangle a problem, and how do you spot LSP violations in real code?`,
  a: r`If {{Rectangle}} has independent {{Width}} and {{Height}} setters, a {{Square}} that keeps them equal breaks callers' expectations: code that sets width 5, height 4 expects area 20 but gets 16. The subtype strengthens preconditions/weakens postconditions, so it is not substitutable.

Real-code symptoms:

- Overrides that throw {{NotSupportedException}} or do nothing.
- Callers checking concrete types ({{if (x is ReadOnlyRepository)}}).
- Subclasses that require extra setup before base methods work.
- Collections: {{ReadOnlyCollection<T>}} implementing {{IList<T>}} and throwing on {{Add}} is a well-known BCL LSP compromise.

Fixes: model immutable shapes (no setters, so no broken postconditions), separate interfaces by capability ({{IReadOnlyList<T>}} vs {{IList<T>}}), or use composition instead of inheritance.`,
  pts: [r`Substitutability of behaviour, not just signatures`, r`Throwing overrides are a smell`, r`Type checks in callers`, r`Immutability avoids many violations`, r`Split capability interfaces`],
  ex: r`A {{CachedRepository}} subclass ignored the {{includeDeleted}} parameter; reports silently dropped deleted records until the subclass was replaced by a decorator honouring the contract.`,
  fu: [r`How do contracts (pre/postconditions) relate to LSP?`],
  pit: [r`Thinking LSP is about compile-time type compatibility only.`] },

{ id: 'q8', level: 'Intermediate', tags: ['immutability'],
  code: r`~~~csharp
public sealed record PriceQuery(string Sku, string Currency, DateOnly AsOf);   // immutable, safe dictionary key

var cache = new Dictionary<PriceQuery, decimal>();
var key = new PriceQuery("SKU-1", "EUR", DateOnly.FromDateTime(DateTime.UtcNow));
cache[key] = 9.99m;
var later = key with { Currency = "USD" };          // new instance; key unchanged

// read-heavy lookup built once at startup (.NET 8)
FrozenDictionary<string, decimal> vatRates = new Dictionary<string, decimal> { ["GB"] = 0.20m, ["DE"] = 0.19m }
    .ToFrozenDictionary();

// shallow immutability trap
public sealed class Basket { public readonly List<string> Items = new(); } // callers can still Items.Add(...)
public sealed class SafeBasket(IEnumerable<string> items) { public ImmutableArray<string> Items { get; } = items.ToImmutableArray(); }
~~~`,
  q: r`What are the benefits and costs of immutability in C# domain code?`,
  a: r`Benefits:

- **Thread safety** without locks: immutable objects can be shared freely.
- **Reasoning**: no spooky action at a distance; a value passed to a method cannot change under you.
- **Safe caching and hashing**: hash codes stay stable (mutable keys in dictionaries are a classic bug).
- **Invariants checked once** at construction.

Costs:

- **Allocations** when "changing" (new instances); usually negligible, measurable in hot loops.
- Large aggregates with many changes may be awkward; entities are often mutable through controlled methods while their value objects are immutable.
- Serialization/ORM friction (EF Core needs constructors or private setters; System.Text.Json supports constructors and {{init}}).

Tools: {{record}}, {{init}} accessors, {{required}} members, {{readonly struct}}, {{ImmutableArray<T>}} / {{FrozenDictionary}} (.NET 8) for read-heavy lookups, {{with}} expressions.

Note {{readonly}} fields of reference types are shallowly immutable: the list can still be modified.`,
  pts: [r`Thread safety and reasoning`, r`Stable hash codes`, r`Allocation cost`, r`Entities mutable via methods, values immutable`, r`Shallow vs deep immutability`],
  ex: r`A pricing cache keyed by a mutable criteria object lost entries after a caller mutated the key; making the key a record fixed it.`,
  fu: [r`What is FrozenDictionary optimised for?`],
  pit: [r`Exposing a List<T> from a "readonly" property.`] },

{ id: 'q9', level: 'Intermediate', tags: ['tell-dont-ask', 'design'],
  q: r`What is "Tell, Don't Ask" and the Law of Demeter, and when do they go too far?`,
  a: r`**Tell, Don't Ask**: instead of pulling state out of an object to make a decision, tell the object to do the work; the decision lives with the data.

~~~csharp
// Ask
if (order.Status == OrderStatus.Paid && order.Lines.All(l => l.InStock)) order.Status = OrderStatus.ReadyToShip;
// Tell
order.MarkReadyToShip();   // rules live in Order
~~~

**Law of Demeter**: a method should talk to its immediate collaborators, not reach through chains ({{order.Customer.Address.Country.TaxRules}}). Chains couple the caller to the whole object graph.

When they go too far:

- **Queries for presentation** and reporting: DTOs and read models legitimately expose data; forcing behaviour onto them is pointless.
- Wrapping every chain in forwarding methods creates bloated "middle-man" classes.
- Fluent builders and LINQ chains are not violations (they return the same kind of object).

Apply them to **domain behaviour** where invariants live, not to data transfer.`,
  pts: [r`Decisions live with data`, r`Avoid navigation chains`, r`Not for DTOs/read models`, r`Avoid middle-man bloat`, r`Fluent APIs are fine`],
  ex: r`Status transition logic duplicated in 7 controllers was moved into Order methods, fixing 3 inconsistent transition bugs.`,
  fu: [r`How does CQRS relate to Tell, Don't Ask?`],
  pit: [r`Applying Demeter mechanically to LINQ or builder chains.`] },

{ id: 'q10', level: 'Intermediate', tags: ['anemic-model'],
  code: r`~~~csharp
// Application service orchestrates; aggregate owns the rules
public sealed class ShipOrderHandler(IOrderRepository orders, IUnitOfWork uow)
{
    public async Task<Result> HandleAsync(Guid orderId, CancellationToken ct)
    {
        var order = await orders.GetAsync(orderId, ct) ?? throw new NotFoundException(orderId);
        var result = order.Ship(DateTimeOffset.UtcNow);   // business rule lives in Order
        if (result.IsFailure) return result;
        await uow.CommitAsync(ct);                         // saves + dispatches domain events
        return Result.Ok();
    }
}
public sealed partial class Order
{
    public Result Ship(DateTimeOffset at)
    {
        if (Status != OrderStatus.Paid) return Result.Fail("Only paid orders can ship");
        if (_lines.Any(l => !l.Allocated)) return Result.Fail("Stock not allocated");
        Status = OrderStatus.Shipped; ShippedAt = at; Raise(new OrderShipped(Id, at));
        return Result.Ok();
    }
}
~~~`,
  q: r`Anaemic domain model vs rich domain model: which do you use and when?`,
  a: r`- **Anaemic model**: entities are data bags; logic lives in services ({{OrderService.Ship(order)}}). Fowler calls it an anti-pattern because it gives up encapsulation, yet it is common and sometimes fine.
- **Rich model**: entities and value objects own behaviour and invariants.

Choose by complexity:

- **CRUD-heavy, simple rules** (admin screens, reference data): anaemic models with validation at the boundary are simpler and fine (Transaction Script).
- **Complex, changing business rules** (pricing, underwriting, ledger, order lifecycle): rich models keep rules cohesive and testable without infrastructure.

A pragmatic split: rich aggregates on the write side, thin DTOs/read models on the query side (CQRS-lite). Application services orchestrate (load aggregate, call method, save, publish events) without business rules.

The real anti-pattern is an anaemic model in a complex domain, where rules scatter across services and duplicate.`,
  pts: [r`Anaemic = data + services`, r`Rich = behaviour with data`, r`Match to domain complexity`, r`Application services orchestrate`, r`Read side can stay thin`],
  ex: r`An insurance quote engine moved from a 4,000-line QuoteService to rich Policy and Coverage aggregates; unit tests no longer needed a database.`,
  fu: [r`How do you keep EF Core from forcing an anaemic model?`],
  pit: [r`Dogmatically enriching CRUD screens.`] },

{ id: 'q11', level: 'Intermediate', tags: ['generics', 'variance'],
  q: r`Explain covariance and contravariance in C# generics with practical examples.`,
  a: r`Variance lets generic interfaces and delegates convert along inheritance when it is type-safe:

- **Covariance ({{out T}})**: T only appears as output. {{IEnumerable<string>}} can be used as {{IEnumerable<object>}}. Producers are covariant.
- **Contravariance ({{in T}})**: T only appears as input. An {{IComparer<object>}} can be used as {{IComparer<string>}}; an {{Action<Animal>}} as {{Action<Dog>}}. Consumers are contravariant.
- **Invariant**: {{List<T>}} (T both in and out): {{List<string>}} is not a {{List<object>}}, because adding an int would break it.

~~~csharp
public interface IHandler<in TEvent> { Task HandleAsync(TEvent e); }
IHandler<DomainEvent> auditAll = new AuditHandler();
IHandler<OrderPlaced> forOrders = auditAll;   // contravariance: a general handler handles specific events
~~~

Variance applies to interfaces and delegates with reference-type arguments only. Arrays are covariant unsafely ({{object[] a = new string[1]; a[0] = 1;}} throws {{ArrayTypeMismatchException}} at runtime), a historical design flaw that also costs a type check on every array store.`,
  pts: [r`out = covariant producers`, r`in = contravariant consumers`, r`List<T> invariant for safety`, r`Interfaces and delegates only`, r`Array covariance is unsafe`],
  ex: r`A messaging library used {{IHandler<in T>}} so a generic audit handler could subscribe to all event types without adapters.`,
  fu: [r`Why can't value types participate in variance?`],
  pit: [r`Expecting List<Derived> to convert to List<Base>.`] },

{ id: 'q12', level: 'Intermediate', tags: ['equality'],
  q: r`How do you implement equality correctly for classes, and what goes wrong?`,
  a: r`Rules:

- Override {{Equals(object)}} **and** {{GetHashCode}} consistently: equal objects must have equal hash codes.
- Implement {{IEquatable<T>}} to avoid boxing and casting.
- Hash only on fields that do not change while the object is in a hash-based collection.
- Handle null, reference equality shortcut, and type checks ({{GetType() == other.GetType()}} for non-sealed classes to keep symmetry).
- Overload {{==}} and {{!=}} if value semantics are intended.

~~~csharp
public sealed class Iban : IEquatable<Iban>
{
    public string Value { get; }
    public Iban(string value) => Value = Normalize(value);
    public bool Equals(Iban? other) => other is not null && Value == other.Value;
    public override bool Equals(object? obj) => Equals(obj as Iban);
    public override int GetHashCode() => Value.GetHashCode(StringComparison.Ordinal);
    private static string Normalize(string v) => v.Replace(" ", "").ToUpperInvariant();
}
~~~

Records generate all of this. For entities, equality by id (with care for transient entities without ids). Culture-sensitive string comparison inside equality is a common bug: use ordinal.`,
  pts: [r`Equals and GetHashCode together`, r`IEquatable<T>`, r`Hash on immutable fields`, r`Symmetry with inheritance`, r`Ordinal comparison`],
  ex: r`Entities overriding GetHashCode on a mutable property disappeared from a HashSet after being updated, causing duplicate notifications.`,
  fu: [r`How do EF Core and entity equality interact?`],
  pit: [r`Overriding Equals without GetHashCode.`] },

{ id: 'q13', level: 'Intermediate', tags: ['dependency-injection'],
  code: r`~~~csharp
var builder = WebApplication.CreateBuilder(args);
builder.Host.UseDefaultServiceProvider(o => { o.ValidateScopes = true; o.ValidateOnBuild = true; });
builder.Services.AddDbContext<AppDb>();                          // scoped
builder.Services.AddSingleton<IPriceCache, PriceCache>();        // must NOT take AppDb in its ctor
builder.Services.AddHttpClient<IFxClient, FxClient>();           // typed client, pooled handlers
builder.Services.AddKeyedSingleton<IFeePolicy, GoldFeePolicy>("gold");

// Scoped work from a singleton background service: create a scope
public sealed class SettlementWorker(IServiceScopeFactory scopes) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            /* settle a batch */ await Task.Delay(TimeSpan.FromMinutes(1), ct);
        }
    }
}
~~~`,
  q: r`How does dependency injection relate to OOP design, and what are the common lifetime mistakes?`,
  a: r`DI is the mechanism that makes **dependency inversion** practical: classes declare what they need (constructor parameters, usually abstractions), and a composition root wires implementations. This keeps classes focused, testable and replaceable.

ASP.NET Core lifetimes: **Singleton** (one per app), **Scoped** (one per request/scope), **Transient** (new each resolution).

Mistakes:

- **Captive dependency**: a singleton holding a scoped service (e.g. DbContext) → shared across requests, threading bugs. Enable {{ValidateScopes}}/{{ValidateOnBuild}}.
- Resolving from {{IServiceProvider}} inside business code (**service locator**), hiding dependencies.
- **Constructor over-injection** (8+ dependencies) signalling a class doing too much.
- Disposable transients resolved from the root container are tracked until app shutdown (memory leak).
- Using {{HttpClient}} directly instead of {{IHttpClientFactory}}/typed clients.
- Using scoped services in {{BackgroundService}} without creating a scope ({{IServiceScopeFactory}}).`,
  pts: [r`DI implements dependency inversion`, r`Composition root`, r`Captive dependencies`, r`Service locator smell`, r`Over-injection signals poor cohesion`],
  ex: r`A singleton cache service captured a scoped DbContext and threw concurrency exceptions under load; ValidateScopes caught it in tests after the fix.`,
  fu: [r`What are keyed services in .NET 8?`],
  pit: [r`Treating DI container registration as architecture.`] },

{ id: 'q14', level: 'Intermediate', tags: ['exceptions', 'design'],
  q: r`Exceptions vs result types for business failures: what do you recommend?`,
  a: r`- **Exceptions** for exceptional situations: programmer errors (invalid arguments), infrastructure failures (timeouts), violated invariants. They unwind the stack and are expensive (microseconds plus stack trace capture), so not for normal flow.
- **Result types** ({{Result<T>}}, discriminated outcomes) for **expected business outcomes**: insufficient funds, validation failures, item out of stock. They make failure explicit in the signature and force callers to handle it.

~~~csharp
public abstract record WithdrawResult
{
    public sealed record Success(Money NewBalance) : WithdrawResult;
    public sealed record InsufficientFunds(Money Available) : WithdrawResult;
    public sealed record AccountFrozen : WithdrawResult;
}
var message = result switch {
    WithdrawResult.Success s => $"Balance {s.NewBalance}",
    WithdrawResult.InsufficientFunds f => "Insufficient funds",
    WithdrawResult.AccountFrozen => "Frozen",
    _ => throw new UnreachableException() };
~~~

Map results to HTTP via ProblemDetails at the boundary. Keep consistency within a codebase; mixing styles randomly is worse than either.`,
  pts: [r`Exceptions for exceptional/infrastructure`, r`Results for expected outcomes`, r`Explicit in signatures`, r`Pattern matching on results`, r`Consistent policy`],
  ex: r`A checkout API used exceptions for "out of stock", generating 2,000 exceptions a second at peak and noisy alerts; result types removed both.`,
  fu: [r`How do you avoid result-type boilerplate?`],
  pit: [r`Catch-all try/catch for control flow.`] },

{ id: 'q15', level: 'Intermediate', tags: ['object-lifetime', 'idisposable'],
  code: r`~~~csharp
public sealed class PriceSubscriber : IDisposable
{
    private readonly IPriceFeed _feed;
    public PriceSubscriber(IPriceFeed feed) { _feed = feed; _feed.PriceChanged += OnPrice; }
    private void OnPrice(object? s, PriceEventArgs e) { /* update view model */ }
    public void Dispose() => _feed.PriceChanged -= OnPrice;   // otherwise the long-lived feed keeps us alive
}

// Async resource with deterministic cleanup
await using var conn = await dataSource.OpenConnectionAsync(ct);
await using var tx = await conn.BeginTransactionAsync(ct);

// Unmanaged handle: SafeHandle instead of a hand-written finalizer
public sealed class NativeBuffer : SafeHandleZeroOrMinusOneIsInvalid
{
    public NativeBuffer(nint size) : base(true) => SetHandle(Marshal.AllocHGlobal(size));
    protected override bool ReleaseHandle() { Marshal.FreeHGlobal(handle); return true; }
}
~~~`,
  q: r`How do object lifetime and IDisposable fit into OOP design?`,
  a: r`Objects owning **unmanaged or scarce resources** (sockets, file handles, DB connections, timers, event subscriptions) must release them deterministically; the GC only reclaims memory and finalizers are non-deterministic and costly.

Design rules:

- **Ownership is explicit**: whoever creates a disposable owns it, unless ownership is transferred and documented. DI-created services are disposed by the container.
- Implement {{IDisposable}}/{{IAsyncDisposable}} when you own disposables; the full dispose pattern with a finalizer only if you directly own unmanaged handles (prefer {{SafeHandle}}).
- **Event subscriptions** keep subscribers alive (the publisher references the handler): unsubscribe in Dispose or use weak events.
- {{using}}/{{await using}} declarations for scoped usage.
- Avoid disposing objects you did not create (e.g. injected HttpClient).

Leaks from forgotten disposal show up as growing handle counts, socket exhaustion, or connection pool timeouts, not just memory.`,
  pts: [r`GC is memory only`, r`Explicit ownership`, r`SafeHandle over finalizers`, r`Events keep subscribers alive`, r`await using for async resources`],
  ex: r`A WPF trading screen leaked 2 GB a day because view models subscribed to a static price feed and never unsubscribed.`,
  fu: [r`When do you need a finalizer?`],
  pit: [r`Disposing an injected singleton dependency.`] },

{ id: 'q16', level: 'Intermediate', tags: ['static', 'design'],
  code: r`~~~csharp
// Hidden static dependency -> injected TimeProvider (.NET 8)
public sealed class InterestCalculator(TimeProvider clock)
{
    public decimal AccruedToday(decimal principal, decimal annualRate)
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var days = DateTime.IsLeapYear(today.Year) ? 366 : 365;
        return decimal.Round(principal * annualRate / days, 2, MidpointRounding.ToEven);
    }
}
// Test with a fake clock (Microsoft.Extensions.TimeProvider.Testing)
var clock = new FakeTimeProvider(new DateTimeOffset(2024, 2, 29, 0, 0, 0, TimeSpan.Zero));
new InterestCalculator(clock).AccruedToday(36_600m, 0.10m).Should().Be(10.00m);

// Fine as static: pure function / factory
public static class Luhn { public static bool IsValid(ReadOnlySpan<char> digits) { /* pure */ return true; } }
~~~`,
  q: r`When are static classes and members appropriate, and when do they hurt?`,
  a: r`Appropriate:

- **Pure functions** without state or I/O: math helpers, parsing, extension methods.
- **Constants** and immutable lookup data.
- Factory methods on a type ({{Money.Zero(currency)}}, {{Guid.CreateVersion7()}}).
- Performance-critical stateless utilities.

Harmful:

- **Hidden dependencies**: {{DateTime.UtcNow}}, static loggers, static config readers make code non-deterministic and hard to test. Inject {{TimeProvider}} (.NET 8) and options instead.
- **Mutable static state**: shared across requests and threads, a concurrency and test-isolation hazard.
- Static service locators ({{ServiceLocator.Get<T>()}}).

Rule: static is fine for things that would be the same in every test and every tenant; anything environment-dependent should be injected.`,
  pts: [r`Pure functions and constants`, r`Factory methods`, r`Hidden dependencies hurt testing`, r`TimeProvider for time`, r`No mutable static state`],
  ex: r`Interest calculations using DateTime.Now failed tests around midnight and daylight-saving changes; injecting TimeProvider made them deterministic.`,
  fu: [r`How do you test code that uses TimeProvider?`],
  pit: [r`A static mutable cache shared across tenants.`] },

{ id: 'q17', level: 'Intermediate', tags: ['pattern-matching', 'modern-csharp'],
  q: r`How has modern C# (records, pattern matching) changed OOP design?`,
  a: r`C# now supports a blend of OO and functional styles:

- **Records** for immutable data and value objects.
- **Pattern matching** (switch expressions, property and list patterns) lets you write behaviour **outside** a closed hierarchy, which is the **visitor pattern without the boilerplate**.

Trade-off known as the **expression problem**:

- OO virtual methods: easy to add **new types**, hard to add **new operations** (touch every class).
- Pattern matching over a closed set of records: easy to add **new operations**, hard to add **new types** (update every switch).

~~~csharp
public abstract record Shape;
public sealed record Circle(double R) : Shape;
public sealed record Rect(double W, double H) : Shape;
static double Area(Shape s) => s switch {
    Circle c => Math.PI * c.R * c.R,
    Rect r => r.W * r.H,
    _ => throw new UnreachableException() };
~~~

Use virtual methods when types vary and are open for extension (plugins, providers). Use records + pattern matching for closed sets of alternatives (commands, events, results) where operations vary.`,
  pts: [r`Records for data`, r`Pattern matching replaces visitor`, r`Expression problem`, r`Open types → virtual methods`, r`Closed alternatives → switch`],
  ex: r`A rules engine modelling events as records with switch-based handlers made adding new reports trivial while the event set stayed stable.`,
  fu: [r`How would discriminated unions (proposed) improve this?`],
  pit: [r`Type-switching over an open hierarchy of plugins.`] },

{ id: 'q18', level: 'Intermediate', tags: ['interfaces', 'design'],
  code: r`~~~csharp
// Header interface (mirrors the class, one implementation forever) - ceremony
public interface IOrderTotalsCalculator { decimal Subtotal(Order o); decimal Tax(Order o); decimal Total(Order o); }

// Role interface owned by the consumer, at a real boundary
public interface IExchangeRates { Task<decimal> RateAsync(Currency from, Currency to, CancellationToken ct); }
public sealed class CheckoutPricing(IExchangeRates rates) { /* depends only on what it needs */ }

// Pure domain logic: test the real class, no interface needed
var totals = new OrderTotals(lines, TaxRate.Of(0.20m));
totals.Total.Should().Be(Money.Of(120m, Currency.GBP));
~~~`,
  q: r`When should you introduce an interface, and when is it ceremony?`,
  a: r`Introduce an interface when there is a reason:

- A **boundary** to infrastructure or an external system (ports: repositories, payment gateways, clocks, message bus).
- **Multiple implementations** exist or are planned (strategies, providers).
- **Decoupling** of teams or assemblies, so one side can change independently.
- A **seam for testing** behaviour that is slow, non-deterministic or external.

Ceremony:

- {{IFoo}}/{{Foo}} pairs for every class with one implementation forever, especially for pure domain logic that can be tested directly.
- Interfaces mirroring the class's entire public surface (header files).

Prefer **role interfaces** defined by the consumer (small, intention-revealing: {{IExchangeRateProvider}}) over **header interfaces** defined by the implementer. Modern mocking and DI do not require interfaces for concrete classes with virtual members, but interfaces at boundaries still communicate design intent.`,
  pts: [r`Interfaces at boundaries`, r`Multiple implementations`, r`Consumer-owned role interfaces`, r`Avoid header interfaces`, r`Test seams for external behaviour`],
  ex: r`A team removed 140 single-implementation interfaces from their domain layer; tests became simpler by testing real domain objects directly.`,
  fu: [r`Where should the interface live: consumer or provider assembly?`],
  pit: [r`Mocking value objects or domain logic via interfaces.`] },

{ id: 'q19', level: 'Senior', tags: ['aggregates', 'ddd'],
  dia: r`classDiagram
  class Order {
    <<aggregate root>>
    +Id: OrderId
    +CustomerId: CustomerId
    +Status
    +AddLine()
    +Place()
    +Ship()
  }
  class OrderLine {
    <<entity>>
    +ProductId
    +Qty
    +Price: Money
  }
  class Money {
    <<value object>>
    +Amount
    +Currency
  }
  class Customer {
    <<aggregate root>>
    +Id: CustomerId
  }
  Order "1" *-- "0..100" OrderLine : owns, same transaction
  OrderLine --> Money
  Order ..> Customer : references by id only`,
  q: r`How do you design object boundaries (aggregates) so invariants hold under concurrency?`,
  a: r`An **aggregate** is a cluster of objects treated as one unit for consistency, with one **root** controlling access. Rules:

- **Invariants inside one aggregate** are enforced transactionally; invariants across aggregates are eventually consistent.
- **Reference other aggregates by id**, not object references, so they load and save independently.
- **Keep aggregates small**: large aggregates (Customer with all orders) cause contention and load cost.
- **One aggregate per transaction** as a default.
- **Optimistic concurrency** on the root (row version) so concurrent changes conflict instead of overwriting.

~~~csharp
public sealed class Order
{
    private readonly List<OrderLine> _lines = new();
    public IReadOnlyList<OrderLine> Lines => _lines;
    public OrderId Id { get; }
    public CustomerId CustomerId { get; }   // id reference, not Customer object
    public void AddLine(ProductId p, int qty, Money price)
    {
        if (Status != OrderStatus.Draft) throw new DomainException("Order is not editable");
        if (_lines.Count >= 100) throw new DomainException("Too many lines");
        _lines.Add(new OrderLine(p, qty, price));
    }
    public OrderStatus Status { get; private set; }
}
~~~

Choosing boundaries: ask "which rules must be true at commit time?" and group only that data.`,
  pts: [r`Root controls access`, r`Transactional invariants inside`, r`Reference by id`, r`Small aggregates`, r`Optimistic concurrency`],
  ex: r`A Customer aggregate containing all orders caused lock contention for big B2B customers; splitting orders into their own aggregate removed conflicts.`,
  fu: [r`How do you enforce a rule spanning two aggregates?`],
  pit: [r`Giving aggregates navigation properties to other aggregates for convenience.`] },

{ id: 'q20', level: 'Senior', tags: ['inheritance', 'orm'],
  code: r`~~~csharp
public abstract class Payment { public Guid Id { get; set; } public decimal Amount { get; set; } }
public sealed class CardPayment : Payment { public string Last4 { get; set; } = ""; }
public sealed class BankTransfer : Payment { public string Iban { get; set; } = ""; }

protected override void OnModelCreating(ModelBuilder b)
{
    // TPH (default): one table + discriminator
    b.Entity<Payment>().HasDiscriminator<string>("Kind")
        .HasValue<CardPayment>("card").HasValue<BankTransfer>("bank");
    // TPC alternative (EF 7+): b.Entity<Payment>().UseTpcMappingStrategy();  // needs keys unique across tables
    // TPT alternative:          b.Entity<Payment>().UseTptMappingStrategy();  // joins on every query

    // TPH subtype-required column enforced in the DB with a check constraint
    b.Entity<Payment>().ToTable(t => t.HasCheckConstraint("CK_Card_Last4", "[Kind] <> 'card' OR [Last4] IS NOT NULL"));
}
~~~`,
  q: r`How do inheritance hierarchies map to the database (TPH, TPT, TPC) and what are the trade-offs?`,
  a: r`EF Core supports:

| Strategy | Storage | Pros | Cons |
|---|---|---|---|
| TPH (table per hierarchy) | One table + discriminator | Fast queries, no joins, default | Many nullable columns, weaker constraints |
| TPT (table per type) | Base table + table per subtype | Normalised, constraints per subtype | Joins on every query; slow for polymorphic queries |
| TPC (table per concrete type, EF 7+) | One table per concrete type | No joins for concrete queries, constraints | Polymorphic queries use UNION; key generation must be unique across tables (sequences) |

Guidance: TPH for most hierarchies (performance); TPC when subtypes have many distinct required columns and you mostly query concrete types; avoid TPT for hot paths.

Bigger point: deep inheritance in persistence models often signals modelling the wrong thing. Consider composition (a {{PaymentMethod}} with a type and a JSON details column) or separate aggregates.`,
  pts: [r`TPH default, discriminator`, r`TPT joins`, r`TPC unions and shared key space`, r`Nullable column trade-off`, r`Question deep hierarchies`],
  ex: r`A TPT hierarchy of 9 policy types produced 9-way joins for a simple list page (2 s); moving to TPH brought it to 40 ms.`,
  fu: [r`How do you enforce subtype-specific NOT NULL in TPH?`],
  pit: [r`Choosing TPT for elegance without measuring queries.`] },

{ id: 'q21', level: 'Senior', tags: ['domain-events', 'design'],
  q: r`How do domain events fit into an object-oriented domain model?`,
  a: r`A domain event records something meaningful that happened ({{OrderPlaced}}, {{PaymentFailed}}). Aggregates **raise** events as part of state changes; the application layer **dispatches** them after (or within) the transaction.

~~~csharp
public abstract class AggregateRoot
{
    private readonly List<IDomainEvent> _events = new();
    public IReadOnlyCollection<IDomainEvent> DomainEvents => _events;
    protected void Raise(IDomainEvent e) => _events.Add(e);
    public void ClearEvents() => _events.Clear();
}
public sealed class Order : AggregateRoot
{
    public void Place() { /* invariants */ Status = OrderStatus.Placed; Raise(new OrderPlaced(Id, Total)); }
}
~~~

Benefits: decouples side effects (emails, loyalty points) from core logic, makes cross-aggregate rules explicit, provides an audit trail.

Dispatch choices: in-process handlers in the same transaction (consistency, but coupling and longer transactions) vs **outbox** for integration events to other services (reliable, eventual). Keep **domain events** (internal, rich) distinct from **integration events** (public contracts, versioned).`,
  pts: [r`Aggregates raise, application dispatches`, r`Decouple side effects`, r`In-process vs outbox`, r`Domain vs integration events`, r`Versioned public contracts`],
  ex: r`Loyalty-point logic embedded in the Order class moved to an OrderPlaced handler; the Order model shrank and the loyalty team owned its own code.`,
  fu: [r`Should handlers run before or after commit?`],
  pit: [r`Publishing integration events from inside entity methods.`] },

{ id: 'q22', level: 'Senior', tags: ['performance', 'allocation'],
  code: r`~~~csharp
[MemoryDiagnoser]
public class DispatchBench
{
    private readonly IPricer _iface = new FastPricer();
    private readonly FastPricer _sealed = new();
    [Benchmark] public decimal ViaInterface() => _iface.Price(100m);
    [Benchmark] public decimal ViaSealed() => _sealed.Price(100m);   // devirtualized + inlinable
}
public interface IPricer { decimal Price(decimal x); }
public sealed class FastPricer : IPricer { public decimal Price(decimal x) => x * 1.2m; }

// Zero-cost abstraction: generic over a struct constraint is specialised by the JIT (no boxing, no virtual call)
static decimal Apply<TRule>(TRule rule, decimal x) where TRule : struct, IRule => rule.Apply(x);
public interface IRule { decimal Apply(decimal x); }
public readonly struct Vat20 : IRule { public decimal Apply(decimal x) => x * 1.2m; }
~~~`,
  q: r`How do OOP choices affect performance in .NET hot paths?`,
  a: r`- **Allocations**: many small objects increase GC pressure; use structs/{{readonly record struct}} for small values, pooling ({{ArrayPool}}), {{Span<T>}} for slicing without copies.
- **Virtual and interface dispatch** blocks inlining unless devirtualized: {{sealed}} classes, avoiding interfaces in tight loops, or generic constraints over structs (the JIT specialises generic code for value types: zero-cost abstraction).
- **Boxing**: structs passed as {{object}} or non-generic interfaces allocate; use generics.
- **LINQ and closures** allocate delegates and enumerators; fine in most code, avoid in per-request hot loops.
- **Deep object graphs** hurt cache locality; arrays of structs are faster to scan than lists of objects.
- **Exceptions** for control flow are expensive.

Measure with BenchmarkDotNet and profilers (dotnet-trace, PerfView) before changing design: clarity first, then targeted optimisation of measured hot paths.`,
  pts: [r`Allocation and GC pressure`, r`Sealed and devirtualization`, r`Generic specialisation for structs`, r`Boxing`, r`Measure with BenchmarkDotNet`],
  ex: r`A market-data parser converted tick objects to a struct array and Span-based parsing; GC pauses dropped from 30 ms to under 2 ms.`,
  fu: [r`Why does the JIT specialise generics only for value types?`],
  pit: [r`Micro-optimising code that is not on a hot path.`] },

{ id: 'q23', level: 'Senior', tags: ['thread-safety'],
  code: r`~~~csharp
public sealed class TokenCache(ITokenClient client)
{
    private readonly ConcurrentDictionary<string, Lazy<Task<Token>>> _tokens = new();
    public Task<Token> GetAsync(string audience) =>
        _tokens.GetOrAdd(audience, a => new Lazy<Task<Token>>(() => client.FetchAsync(a))).Value; // fetched once
}

public sealed class Throttle
{
    private readonly SemaphoreSlim _gate = new(1, 1);            // async-friendly mutual exclusion
    public async Task RunAsync(Func<Task> work, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try { await work(); } finally { _gate.Release(); }
    }
}

private readonly Lock _sync = new();   // .NET 9 System.Threading.Lock
private long _count;
public void Add(int n) { lock (_sync) { _count += n; } }
public void Inc() => Interlocked.Increment(ref _count);
~~~`,
  q: r`How do you design classes to be thread-safe?`,
  a: r`Prefer designs that avoid shared mutable state:

1. **Immutability**: immutable objects are thread-safe by construction.
2. **Confinement**: state owned by one thread or one request scope (scoped services, actors, channels).
3. **Thread-safe collections**: {{ConcurrentDictionary}}, {{Channel<T>}}, {{ImmutableInterlocked}}.
4. **Synchronisation** when sharing is necessary: {{lock}} (or the .NET 9 {{System.Threading.Lock}} type) around compound operations; {{Interlocked}} for counters; {{SemaphoreSlim}} for async code (never {{lock}} around {{await}}).

Design rules:

- Document thread-safety guarantees on public types.
- Do not expose internal mutable collections.
- Avoid check-then-act races ({{if (!dict.ContainsKey(k)) dict[k] = v}}); use {{GetOrAdd}}/{{TryAdd}}.
- Beware {{GetOrAdd}} factories running more than once; wrap with {{Lazy<T>}} when creation must happen once.
- Keep lock scopes small and never call out to unknown code while holding a lock (deadlocks).`,
  pts: [r`Immutability and confinement first`, r`Concurrent collections`, r`SemaphoreSlim for async`, r`Check-then-act races`, r`Lazy for single creation`],
  ex: r`A token cache using GetOrAdd called the identity provider 50 times on cold start; GetOrAdd with Lazy<Task<Token>> made it once.`,
  fu: [r`Why can't you await inside a lock?`],
  pit: [r`Assuming a ConcurrentDictionary makes compound logic atomic.`] },

{ id: 'q24', level: 'Senior', tags: ['api-design', 'versioning'],
  code: r`~~~xml
<!-- Package validation: fail the build on breaking API changes against the last release -->
<PropertyGroup>
  <EnablePackageValidation>true</EnablePackageValidation>
  <PackageValidationBaselineVersion>2.4.0</PackageValidationBaselineVersion>
</PropertyGroup>
~~~
~~~csharp
public sealed class PaymentClientOptions        // options object: new settings never change signatures
{
    public Uri BaseAddress { get; set; } = new("https://api.example.com");
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(10);
}
public sealed class PaymentClient               // sealed by default
{
    public PaymentClient(PaymentClientOptions options) { }
    [Obsolete("Use CaptureAsync(CaptureRequest, CancellationToken).", DiagnosticId = "PAY001")]
    public Task CaptureAsync(Guid id) => CaptureAsync(new CaptureRequest(id), default);
    public Task CaptureAsync(CaptureRequest request, CancellationToken ct) => Task.CompletedTask;
}
public sealed record CaptureRequest(Guid PaymentId);
~~~`,
  q: r`How do you design public class libraries (NuGet packages) so they can evolve without breaking consumers?`,
  a: r`- **Minimise public surface**: {{internal}} by default; every public type is a commitment.
- **Seal classes** unless designed for inheritance (unsealing later is non-breaking; sealing later is breaking).
- **Prefer adding** to changing: new overloads, optional parameters (careful: default values are compiled into callers), new types.
- **Interfaces are hard to evolve**: adding members breaks implementers; use default interface members or abstract base classes when consumers implement your abstractions.
- **Options objects** instead of long parameter lists, so new settings do not change signatures.
- **Semantic versioning** and API compatibility checks in CI ({{Microsoft.DotNet.ApiCompat}} / package validation baseline).
- **Obsolete before remove** ({{[Obsolete]}} with diagnostic ids) across a major version.
- Avoid exposing third-party types in your public API (you inherit their breaking changes).`,
  pts: [r`Small public surface`, r`Sealed by default`, r`Additive evolution`, r`Options objects`, r`API compatibility checks in CI`],
  ex: r`An internal SDK exposed Newtonsoft types publicly; migrating to System.Text.Json became a breaking change for 40 services. The replacement wrapped serialization behind its own abstractions.`,
  fu: [r`Why are optional parameter defaults a versioning hazard?`],
  pit: [r`Making everything public "in case someone needs it".`] },

{ id: 'q25', level: 'Senior', tags: ['testing', 'design'],
  code: r`~~~csharp
// Functional core: pure, no mocks needed
public static class Pricing
{
    public static Money Quote(Cart cart, IReadOnlyList<Promotion> promos, TaxRate tax)
    {
        var subtotal = cart.Lines.Aggregate(Money.Zero(cart.Currency), (s, l) => s + l.Price * l.Qty);
        var discount = promos.Where(p => p.AppliesTo(cart)).Select(p => p.Discount(subtotal)).DefaultIfEmpty(Money.Zero(cart.Currency)).Max()!;
        return (subtotal - discount) * (1 + tax.Rate);
    }
}
[Fact] public void Best_promotion_wins() =>
    Pricing.Quote(Cart.Of(("SKU", 2, 50m)), [Promotion.Percent(10), Promotion.Fixed(5)], TaxRate.Zero)
           .Should().Be(Money.Of(90m, Currency.GBP));

// Imperative shell: thin, tested with integration tests (WebApplicationFactory + Testcontainers)
public sealed class QuoteEndpoint(ICartStore carts, IPromotionStore promos)
{
    public async Task<Money> HandleAsync(Guid cartId, CancellationToken ct) =>
        Pricing.Quote(await carts.GetAsync(cartId, ct), await promos.ActiveAsync(ct), TaxRate.Of(0.2m));
}
~~~`,
  q: r`How does testability reveal design quality in OOP code?`,
  a: r`Hard-to-test code usually signals design problems:

| Test pain | Design smell | Fix |
|---|---|---|
| Needs many mocks | Too many responsibilities / dependencies | Split class, extract domain logic |
| Must set up deep object graphs | Law of Demeter violations | Pass what is needed |
| Tests depend on time, randomness, environment | Hidden static dependencies | Inject TimeProvider, random, config |
| Tests break on refactoring | Tests coupled to implementation (verifying calls) | Test behaviour and outcomes |
| Needs a database for business rules | Logic in infrastructure | Move rules into domain objects |

Good OOP design yields a **functional core, imperative shell**: pure domain logic tested with fast unit tests and no mocks; thin orchestration and adapters tested with integration tests (Testcontainers, WebApplicationFactory).

Mocks are for boundaries you own (ports), not for every collaborator.`,
  pts: [r`Mock count signals responsibilities`, r`Hidden dependencies`, r`Behaviour over interaction tests`, r`Functional core, imperative shell`, r`Mocks at ports`],
  ex: r`A pricing class needing 9 mocks was split into a pure calculator (no mocks) and an orchestrator (2 fakes); test code halved.`,
  fu: [r`When are interaction-based tests appropriate?`],
  pit: [r`Adding interfaces only to enable mocking.`] },

{ id: 'q26', level: 'Senior', tags: ['strategy', 'polymorphism'],
  q: r`Replace a growing switch statement on a type code with polymorphism: when and how?`,
  a: r`A switch on a type code repeated in several places ({{switch (customer.Tier)}} for discounts, limits, fees) is a smell: each new tier requires editing every switch (shotgun surgery).

Refactor to polymorphism (Strategy) when the **set of types changes** and behaviour per type is **cohesive**:

~~~csharp
public interface IFeePolicy { Money Fee(Money amount); bool Supports(CustomerTier tier); }
public sealed class FeeCalculator(IEnumerable<IFeePolicy> policies)
{
    public Money Calculate(CustomerTier tier, Money amount) =>
        policies.Single(p => p.Supports(tier)).Fee(amount);
}
~~~

Or keyed DI services (.NET 8: {{[FromKeyedServices("gold")]}}).

Keep the switch when the set is **closed and stable**, the switch appears in **one** place, or operations vary more than types (pattern matching on records, see the expression problem). Data-driven rules (tiers in configuration tables) beat both when business users change values often.`,
  pts: [r`Repeated switches = shotgun surgery`, r`Strategy per type`, r`Keyed DI services`, r`Keep switch for closed, single-use cases`, r`Data-driven rules for frequent changes`],
  ex: r`Adding a "platinum" tier required changes in 11 files; strategy classes per tier made the next tier a single new class.`,
  fu: [r`How do you choose between code and configuration for rules?`],
  pit: [r`Replacing a single small switch with five classes.`] },

{ id: 'q27', level: 'Senior', tags: ['null-safety'],
  code: r`~~~csharp
#nullable enable
public sealed class CustomerService(ICustomerRepository repo, ILogger<CustomerService>? logger = null)
{
    private readonly ILogger _log = logger ?? NullLogger<CustomerService>.Instance;   // Null Object

    public bool TryFind(string email, [NotNullWhen(true)] out Customer? customer)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);              // runtime guard at the boundary
        customer = repo.FindByEmail(email);
        return customer is not null;
    }
}
if (svc.TryFind("a@b.com", out var c)) Console.WriteLine(c.Name);    // no warning: c is non-null here

public sealed class CreateCustomerRequest { public required string Email { get; init; } public string? Phone { get; init; } }
~~~
~~~xml
<PropertyGroup><Nullable>enable</Nullable><WarningsAsErrors>nullable</WarningsAsErrors></PropertyGroup>
~~~`,
  q: r`How do nullable reference types and the Null Object pattern improve OO designs?`,
  a: r`**Nullable reference types** (NRT) make nullability part of the type system: {{string}} means non-null, {{string?}} may be null; the compiler warns on dereferencing maybe-null values. Treat warnings as errors in new code ({{<Nullable>enable</Nullable>}}, {{<WarningsAsErrors>nullable</WarningsAsErrors>}}).

Design benefits: constructor-required dependencies are non-null, optional data is explicit, and APIs communicate intent. Use attributes like {{[NotNullWhen(true)]}} for Try-patterns.

**Null Object pattern**: provide a do-nothing implementation instead of null ({{NullLogger.Instance}}, a {{NoDiscount}} policy) so callers do not branch on null.

Caveats: NRT is compile-time only (no runtime guarantees; deserialized data and reflection can still produce nulls), so validate at boundaries ({{ArgumentNullException.ThrowIfNull}}, model validation, {{required}} members).`,
  pts: [r`NRT encodes nullability`, r`Warnings as errors`, r`Flow attributes`, r`Null Object removes branches`, r`Validate at runtime boundaries`],
  ex: r`Enabling NRT in a payments library surfaced 37 possible null dereferences, 4 of them real production bug paths.`,
  fu: [r`How do you migrate a large codebase to NRT incrementally?`],
  pit: [r`Silencing warnings with the null-forgiving operator everywhere.`] },

{ id: 'q28', level: 'Senior', tags: ['god-class', 'refactoring'],
  code: r`~~~csharp
// 1. Characterisation (snapshot) test pins today's behaviour before any refactoring (Verify library)
[Fact]
public Task Process_order_behaviour_is_unchanged()
{
    var result = new OrderManager(TestDb.Seeded()).Process(OrderFixtures.Complex());
    return Verify(result);   // approved snapshot committed to git
}

// 2. Extract one responsibility behind the existing API
public partial class OrderManager
{
    private readonly PriceCalculator _pricing = new();          // extracted, now unit-testable
    public decimal CalculateTotal(Order o) => _pricing.Total(o); // old public method delegates
}
public sealed class PriceCalculator
{
    public decimal Total(Order o) => o.Lines.Sum(l => l.UnitPrice * l.Quantity) - o.Discount;
}
~~~`,
  q: r`You inherit a 6,000-line "OrderManager" god class. How do you refactor it safely?`,
  a: r`1. **Characterisation tests** around current behaviour (approval/snapshot tests, integration tests through public entry points), so refactoring cannot silently change behaviour.
2. **Map responsibilities**: group methods by the fields they use and the reasons they change (pricing, validation, persistence, notifications). Git history shows which areas change most: start there.
3. **Extract cohesive classes** behind the existing public API (pricing → {{PriceCalculator}}, notifications → event handlers), moving one responsibility at a time with small commits.
4. **Introduce seams** for infrastructure (repositories, clocks, gateways) to make extracted logic testable.
5. **Move business rules into domain objects** (rich model) where invariants belong.
6. **Strangle** callers onto the new classes, then delete the old methods.
7. Keep the system shippable after every step; measure with change frequency and defect rates, not lines removed.

Avoid the big-bang rewrite: it loses undocumented behaviour and stalls delivery.`,
  pts: [r`Characterisation tests first`, r`Group by fields and change reasons`, r`Prioritise by change frequency`, r`Extract one responsibility at a time`, r`No big-bang rewrite`],
  ex: r`An OrderManager refactor over 3 months, done in 120 small PRs behind the same API, cut order-related bug reports by 60% with no freeze.`,
  fu: [r`How do you get product to accept refactoring time?`],
  pit: [r`Rewriting from scratch in a parallel branch for 6 months.`] },

{ id: 'q29', level: 'Senior', tags: ['generics', 'constraints'],
  q: r`How do you use generics and constraints to build reusable but safe abstractions?`,
  a: r`Generics provide type-safe reuse without boxing or casting. Constraints express what the algorithm needs:

- {{where T : class}} / {{struct}} / {{notnull}} / {{unmanaged}}
- {{where T : IEntity}} (interface capabilities), {{new()}} (parameterless constructor)
- {{where T : INumber<T>}} with static abstract members for generic math.

~~~csharp
public static T Sum<T>(ReadOnlySpan<T> values) where T : INumber<T>
{
    var total = T.Zero;
    foreach (var v in values) total += v;
    return total;
}
public interface IRepository<TAggregate, in TId> where TAggregate : AggregateRoot<TId> where TId : notnull
{
    Task<TAggregate?> GetAsync(TId id, CancellationToken ct);
    Task SaveAsync(TAggregate aggregate, CancellationToken ct);
}
~~~

Pitfalls: over-generic abstractions ({{IRepository<T>}} with {{IQueryable}} leaking persistence), deeply nested generic types that obscure intent, and generic base classes forcing inheritance. Strongly-typed ids ({{OrderId}} vs {{CustomerId}} record structs) prevent mixing ids with the same primitive type.`,
  pts: [r`Constraints express needs`, r`Generic math with static abstracts`, r`Strongly-typed ids`, r`Avoid leaky generic repositories`, r`Readability over cleverness`],
  ex: r`Strongly-typed ids caught a bug where a merchant id was passed where a customer id was expected, at compile time.`,
  fu: [r`Why is a generic repository exposing IQueryable controversial?`],
  pit: [r`Generic abstractions with one usage.`] },

{ id: 'q30', level: 'Senior', tags: ['events', 'delegates'],
  code: r`~~~csharp
// Isolate handler failures: invoke subscribers one by one
public event EventHandler<OrderPlacedArgs>? OrderPlaced;
protected void OnOrderPlaced(OrderPlacedArgs e)
{
    foreach (var h in OrderPlaced?.GetInvocationList().Cast<EventHandler<OrderPlacedArgs>>() ?? [])
    {
        try { h(this, e); }
        catch (Exception ex) { _log.LogError(ex, "Handler {Handler} failed", h.Method.Name); }
    }
}

// Async notifications: explicit async handler interface instead of async void events
public interface INotificationHandler<in T> { Task HandleAsync(T notification, CancellationToken ct); }
public sealed class Publisher(IEnumerable<INotificationHandler<OrderPlacedArgs>> handlers)
{
    public Task PublishAsync(OrderPlacedArgs e, CancellationToken ct) =>
        Task.WhenAll(handlers.Select(h => h.HandleAsync(e, ct)));
}
~~~`,
  q: r`Events, delegates and observers in C#: what are the design pitfalls?`,
  a: r`- **Memory leaks**: a publisher holds references to subscribers through its delegate list; long-lived publishers (static, singleton) keep short-lived subscribers alive. Unsubscribe deterministically, use weak events, or scope subscriptions.
- **Exceptions**: if one handler throws, later handlers do not run (multicast invocation stops). Invoke handlers individually with error handling if isolation matters.
- **Threading**: handlers run on the raiser's thread; UI frameworks need marshalling; check-then-invoke races are solved by {{Handler?.Invoke(...)}}.
- **Async**: {{async void}} event handlers swallow exceptions into the synchronisation context and cannot be awaited; for async notifications use explicit async interfaces or {{Channel<T>}}.
- **Ordering and coupling**: in-process events hide control flow; overuse makes flows hard to follow.

For cross-component notifications in services, prefer explicit mediator/handler interfaces or domain events dispatched by the application layer; for cross-service, messaging.`,
  pts: [r`Publisher keeps subscribers alive`, r`One throwing handler stops others`, r`Raiser's thread`, r`async void dangers`, r`Prefer explicit handlers in services`],
  ex: r`A singleton price feed with event subscribers from per-request objects leaked memory steadily until a restart every night became routine.`,
  fu: [r`How do weak events work?`],
  pit: [r`Using async void handlers for business logic.`] },

{ id: 'q31', level: 'Senior', tags: ['configuration', 'options'],
  q: r`How do you design configuration objects in .NET to stay type-safe and valid?`,
  a: r`Use the **Options pattern**: bind configuration sections to strongly-typed classes, validate at startup, and inject {{IOptions<T>}} (static), {{IOptionsSnapshot<T>}} (per request, reloadable), or {{IOptionsMonitor<T>}} (singleton with change notifications).

~~~csharp
public sealed class PaymentGatewayOptions
{
    [Required, Url] public string BaseUrl { get; init; } = "";
    [Range(1, 60)] public int TimeoutSeconds { get; init; } = 10;
    [Required] public string MerchantId { get; init; } = "";
}
builder.Services.AddOptions<PaymentGatewayOptions>()
    .BindConfiguration("PaymentGateway")
    .ValidateDataAnnotations()
    .Validate(o => !o.BaseUrl.StartsWith("http:"), "TLS required")
    .ValidateOnStart();
~~~

Principles: fail fast at startup rather than at the first request; group settings by component (cohesion); no secrets in appsettings (Key Vault/Secrets Manager providers); avoid injecting {{IConfiguration}} into business classes (hidden dependency on keys and strings). The source-generated options validator (.NET 8) avoids reflection for AOT.`,
  pts: [r`Strongly typed options`, r`ValidateOnStart`, r`IOptions vs Snapshot vs Monitor`, r`Secrets from vaults`, r`No IConfiguration in business classes`],
  ex: r`A typo in a timeout setting caused a production outage on first request; ValidateOnStart would have failed the deploy instead.`,
  fu: [r`When do you need IOptionsMonitor?`],
  pit: [r`Reading configuration keys with magic strings throughout the code.`] },

{ id: 'q32', level: 'Senior', tags: ['solid-tension', 'design'],
  code: r`~~~csharp
// "DRY" across bounded contexts couples two teams' release cycles:
// shared NuGet Company.Domain { class Customer { ...40 properties used differently by Billing and Shipping... } }

// Deliberate duplication: each context owns a small model of what it needs
namespace Billing  { public sealed record Customer(CustomerId Id, string LegalName, VatNumber? Vat, Address BillingAddress); }
namespace Shipping { public sealed record Recipient(CustomerId Id, string DisplayName, Address DeliveryAddress, string? Phone); }

// Rule of three: inline until the third real variation appears, then extract the abstraction
~~~`,
  q: r`When do OOP principles conflict with each other or with simplicity, and how do you decide?`,
  a: r`Common tensions:

- **DRY vs decoupling**: sharing code between two bounded contexts couples them; duplication may be cheaper than the wrong abstraction.
- **Open/closed vs YAGNI**: designing extension points for variations that never come adds complexity now.
- **Encapsulation vs performance or serialization**: private setters vs ORMs and serializers, immutability vs allocation in hot loops.
- **Small classes (SRP) vs comprehension**: 40 tiny classes can be harder to follow than one cohesive 300-line class.
- **Abstractions vs debuggability**: indirection hides control flow.

Decision approach:

- Optimise for the **likely change** (what has changed historically? what does the roadmap say?).
- Prefer **reversible** simple designs; add abstraction on the second or third concrete need (rule of three).
- Measure the cost of change (lead time, defects) rather than principle compliance.

Principles are heuristics serving maintainability, not goals.`,
  pts: [r`DRY vs coupling`, r`OCP vs YAGNI`, r`SRP vs comprehension`, r`Optimise for likely change`, r`Rule of three`],
  ex: r`A shared "Common.Domain" library used by 12 services made every change a coordinated release; duplicating small value objects per service restored independence.`,
  fu: [r`What is "the wrong abstraction"?`],
  pit: [r`Treating SOLID compliance as the success metric.`] },

{ id: 'q33', level: 'Senior', tags: ['state-machines'],
  q: r`How do you model object lifecycles and state transitions cleanly?`,
  a: r`Entities with lifecycles (orders, payments, loans) need **explicit state machines**: valid states, allowed transitions, guards and side effects.

Options:

- **Methods per transition** on the aggregate ({{Authorize}}, {{Capture}}, {{Refund}}) with guard checks: simplest and keeps invariants in the domain.
- **State pattern**: a class per state when behaviour differs significantly per state.
- **Transition table** (data-driven, or a library such as Stateless) when there are many states and transitions or they must be visualised.

~~~csharp
public void Capture(Money amount)
{
    if (Status is not PaymentStatus.Authorized) throw new DomainException("Only authorized payments can be captured");
    if (amount > AuthorizedAmount) throw new DomainException("Capture exceeds authorization");
    Status = amount == AuthorizedAmount ? PaymentStatus.Captured : PaymentStatus.PartiallyCaptured;
    Raise(new PaymentCaptured(Id, amount));
}
~~~

Persist state with optimistic concurrency, record transitions (history table or events) for audit, and generate a diagram from the transition table so business and engineering share one picture.`,
  pts: [r`Explicit states and transitions`, r`Guards in transition methods`, r`State pattern or tables when complex`, r`Concurrency on transitions`, r`Audit history`],
  ex: r`A refund issued for a payment that was never captured exposed missing guards; explicit transition methods with tests closed the gap.`,
  fu: [r`How do you handle out-of-order webhook events in a state machine?`],
  pit: [r`Public status setters allowing any transition.`] },

{ id: 'q34', level: 'Senior', tags: ['serialization', 'encapsulation'],
  code: r`~~~csharp
public sealed class Order
{
    private readonly List<OrderLine> _lines = new();
    public IReadOnlyCollection<OrderLine> Lines => _lines.AsReadOnly();
    public OrderId Id { get; private set; }
    public Money Total { get; private set; } = null!;
    private Order() { }                                   // for EF materialisation only
    public static Order Create(OrderId id) => new() { Id = id, Total = Money.Zero(Currency.GBP) };
}
public sealed class OrderConfig : IEntityTypeConfiguration<Order>
{
    public void Configure(EntityTypeBuilder<Order> b)
    {
        b.Property(o => o.Id).HasConversion(id => id.Value, v => new OrderId(v));    // strongly-typed id
        b.ComplexProperty(o => o.Total);                                              // value object (EF 8)
        b.Navigation(o => o.Lines).UsePropertyAccessMode(PropertyAccessMode.Field);   // maps _lines
    }
}
// API contract is a DTO, never the entity
public sealed record OrderDto(Guid Id, decimal Total, string Currency, int LineCount);
~~~`,
  q: r`How do you keep rich domain objects encapsulated while using EF Core and System.Text.Json?`,
  a: r`EF Core:

- Map **private fields** as backing fields ({{HasField}}, {{UsePropertyAccessMode}}), private setters, and private parameterless constructors for materialisation.
- **Owned types / complex types** for value objects; value converters for strongly-typed ids.
- Expose collections as {{IReadOnlyCollection<T>}} backed by a private {{List<T>}} that EF maps by convention.

System.Text.Json:

- **Do not serialize domain entities** as API contracts: map to DTOs. This avoids leaking internals and couples the API to the domain model otherwise.
- For messages and value objects, use constructor-based deserialization ({{[JsonConstructor]}}), {{init}} properties, and source generation.

Principle: persistence and transport are adapters; the domain model should not be bent into a data bag to satisfy them. Where the cost is high, use separate persistence models and map, accepting the mapping code.`,
  pts: [r`Backing fields and private setters`, r`Owned/complex types for value objects`, r`Read-only collection exposure`, r`DTOs for API contracts`, r`Separate persistence models when needed`],
  ex: r`An API returned EF entities directly; adding a navigation property leaked customer emails into a public endpoint. DTO mapping removed the class of leak.`,
  fu: [r`Is AutoMapper worth it?`],
  pit: [r`Making all setters public so EF and JSON work.`] },

{ id: 'q35', level: 'Senior', tags: ['mixins', 'extension-methods'],
  code: r`~~~csharp
// Good: composition-root registration on a type you do not own
public static class PaymentsServiceCollectionExtensions
{
    public static IServiceCollection AddPayments(this IServiceCollection services, IConfiguration cfg)
    {
        services.AddOptions<PaymentOptions>().Bind(cfg.GetSection("Payments")).ValidateOnStart();
        services.AddHttpClient<IPaymentGateway, StripeGateway>();
        return services;
    }
}
// Static dispatch: chosen by declared type, never overridden
public static class ShapeExt { public static string Describe(this Shape s) => "shape"; }
Shape s = new Circle(1); s.Describe();   // always "shape" even if a CircleExt exists for Circle

// Bad: business rules hidden in extensions on an entity (anaemic model by stealth)
public static class PolicyExtensions { public static decimal Premium(this Policy p) => p.SumInsured * 0.01m; }
~~~`,
  q: r`Extension methods: good design tool or hidden coupling?`,
  a: r`Good uses:

- Adding **fluent, cohesive helpers** to types you do not own ({{IServiceCollection.AddPayments()}} for DI registration).
- **LINQ-style** operations on interfaces.
- **Domain-specific** readability ({{amount.ToMinorUnits()}}) when the type cannot be changed.

Risks:

- They look like instance methods but cannot access private state and cannot be overridden (no polymorphism; dispatch is static by declared type).
- Name collisions and discoverability: behaviour depends on which namespaces are imported.
- **Business logic** hidden in static extension classes on entities creates an anaemic model by stealth.
- Hard to mock (they are static), so external dependencies inside extensions hurt testing.

C# 14 extension members (extension blocks with properties) broaden the feature; the same guidance applies.

Use them for syntax convenience on types you do not own; put domain behaviour on domain types.`,
  pts: [r`Great for DI registration and fluent APIs`, r`Static dispatch, no polymorphism`, r`Namespace-dependent behaviour`, r`Do not hide domain logic`, r`Hard to mock dependencies`],
  ex: r`A "PolicyExtensions" class with 90 methods held most underwriting rules; moving them into the Policy aggregate made rules discoverable and testable.`,
  fu: [r`Why can't extension methods be virtual?`],
  pit: [r`Extensions that call databases or services.`] },

{ id: 'q36', level: 'Senior', tags: ['frontend', 'typescript'],
  code: r`~~~typescript
// Branded types give nominal-like safety in a structural type system
type OrderId = string & { readonly __brand: 'OrderId' };
type CustomerId = string & { readonly __brand: 'CustomerId' };
const asOrderId = (v: string) => v as OrderId;
function cancel(id: OrderId) { /* ... */ }
// cancel(customerId);  // compile error

// Domain logic as pure, framework-free functions shared by Angular and React screens
export interface Line { unitPrice: number; qty: number }
export const subtotal = (lines: readonly Line[]) => lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);

// Angular: state in an injectable service with signals; component stays presentational
@Injectable({ providedIn: 'root' })
export class CartStore {
  private readonly lines = signal<Line[]>([]);
  readonly total = computed(() => subtotal(this.lines()));
  add(line: Line) { this.lines.update(ls => [...ls, line]); }   // immutable update
}
// React: composition via a hook, not inheritance
export function useCartTotal(lines: Line[]) { return useMemo(() => subtotal(lines), [lines]); }
~~~`,
  q: r`How do OOP ideas carry over to TypeScript in Angular or React front ends?`,
  a: r`- **TypeScript is structurally typed**: an object matches an interface if it has the right shape, unlike C#'s nominal typing. Value objects need branded types to prevent mixing ({{type OrderId = string & { readonly brand: unique symbol }}}).
- **Angular** embraces classes: services with DI (singletons per injector), components as classes; encapsulate state in services or signal stores, keep components presentational.
- **React** favours **composition of functions**: hooks for reusable behaviour, components composed rather than inherited (React explicitly recommends composition over inheritance).
- **Immutability** is central in both (change detection with OnPush/signals; React state updates by new references).
- **Domain logic** belongs in plain TypeScript modules (pure functions or small classes), not in components, so it is testable and shareable.

Full-stack consistency: share contracts via OpenAPI-generated TypeScript clients from the .NET API, rather than hand-written duplicates.`,
  pts: [r`Structural vs nominal typing`, r`Branded types`, r`Angular DI services`, r`React composition and hooks`, r`Domain logic outside components`],
  ex: r`An Angular app moved pricing rules from three components into a pure TypeScript module shared by the checkout and quote screens, removing inconsistencies.`,
  fu: [r`How do you generate TypeScript clients from ASP.NET Core?`],
  pit: [r`Class inheritance hierarchies of React components.`] },

{ id: 'q37', level: 'Principal', tags: ['architecture', 'modularity'],
  code: r`~~~csharp
// Modular monolith: module exposes a small public contract; everything else is internal
namespace Billing.Contracts { public interface IBillingModule { Task<InvoiceId> IssueInvoiceAsync(IssueInvoice cmd, CancellationToken ct); } }
namespace Billing.Internal  { internal sealed class InvoiceService : Billing.Contracts.IBillingModule { /* ... */ } }

// Architecture test: no module references another module's internals
[Fact] public void Orders_only_uses_billing_contracts() =>
    Types.InAssembly(typeof(Orders.AssemblyMarker).Assembly)
        .ShouldNot().HaveDependencyOn("Billing.Internal")
        .GetResult().IsSuccessful.Should().BeTrue();
~~~`,
  dia: r`flowchart LR
  subgraph Host[Single deployable: ASP.NET Core host]
    O[Orders module] -->|IBillingModule contract| B[Billing module]
    O -->|OrderPlaced event via in-process bus| S[Shipping module]
    B --- BDB[(billing schema)]
    O --- ODB[(orders schema)]
    S --- SDB[(shipping schema)]
  end
  S -. later extracted .-> SS[Shipping service]`,
  q: r`How do OOP principles scale up to modules, services and teams?`,
  a: r`The same ideas apply at larger granularity:

| Class-level | Module/service-level |
|---|---|
| Encapsulation | Information hiding behind a module's public API; no shared database tables |
| Cohesion | Bounded contexts: things that change together live together |
| Low coupling | Asynchronous events, stable contracts, no shared libraries with domain logic |
| Interfaces | Published APIs and event schemas, versioned |
| Dependency inversion | Domain at the centre; infrastructure adapters at the edges (hexagonal) |

Conway's law adds the organisational dimension: module boundaries should match team boundaries, or communication overhead appears in the code.

In .NET, a **modular monolith** applies this inside one deployable: projects per module with internal types, explicit public contracts, architecture tests enforcing no cross-module internals, and messaging between modules. It gives most benefits of microservices without distributed-system costs, and modules can be extracted later.`,
  pts: [r`Information hiding at module level`, r`Bounded contexts as cohesion`, r`Contracts and versioning`, r`Conway's law`, r`Modular monolith`],
  ex: r`A team split a monolith into 6 internal modules with architecture tests; two modules later became services with minimal change because boundaries were already clean.`,
  fu: [r`How do you enforce module boundaries in a single .NET solution?`],
  pit: [r`Microservices that share a domain-model NuGet package.`] },

{ id: 'q38', level: 'Principal', tags: ['technical-debt'],
  code: r`~~~bash
# Hotspots = change frequency x complexity. Change frequency per file over the last year:
git log --since=12.months --format=format: --name-only -- '*.cs' | grep -v '^$' | sort | uniq -c | sort -rn | head -15
# Combine with complexity (e.g. lines or cyclomatic complexity from an analyzer) and defect-linked commits:
git log --since=12.months --grep='fix\|bug' --format=format: --name-only -- '*.cs' | sort | uniq -c | sort -rn | head -15
~~~`,
  q: r`How do you decide whether to invest in improving the object model of a legacy system?`,
  a: r`Treat it as an investment with returns:

1. **Hotspot analysis**: combine change frequency (git) with complexity; code that is both complex and frequently changed is where design debt costs most. Stable ugly code can stay ugly.
2. **Cost of delay**: lead time for changes in that area, defect rate, incident count, onboarding time.
3. **Upcoming roadmap**: will the area change significantly in the next 6 to 12 months?
4. **Options**: incremental refactoring alongside features (boy-scout rule with budget), focused refactoring sprints, strangler replacement for a module.
5. **Success metrics**: lead time, defects, change failure rate for that area.

Communicate in business terms: "changes to fee calculation take 3 weeks and cause 40% of our production defects; 6 weeks of refactoring reduces this to days."`,
  pts: [r`Hotspots: complexity × change frequency`, r`Quantify cost of delay`, r`Align with roadmap`, r`Incremental over big-bang`, r`Business-language metrics`],
  ex: r`Hotspot analysis showed 4% of files caused 52% of defects; targeted refactoring of those files was funded instead of a rewrite.`,
  fu: [r`How do you prevent the debt from returning?`],
  pit: [r`Refactoring stable code nobody touches.`] },

{ id: 'q39', level: 'Principal', tags: ['standards', 'governance'],
  code: r`~~~ini
# .editorconfig shared by every repo (excerpt)
[*.cs]
dotnet_diagnostic.CA1852.severity = warning   # seal internal types with no subtypes
dotnet_diagnostic.CA2000.severity = warning   # dispose objects before losing scope
dotnet_diagnostic.CA1062.severity = none      # superseded by nullable reference types
dotnet_style_prefer_auto_properties = true:suggestion
csharp_style_prefer_primary_constructors = true:suggestion
~~~
~~~xml
<!-- Directory.Build.props applied to all projects -->
<Project><PropertyGroup>
  <Nullable>enable</Nullable><TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  <AnalysisLevel>latest-recommended</AnalysisLevel><EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
</PropertyGroup></Project>
~~~`,
  q: r`How do you establish object-design standards across many .NET teams without stifling them?`,
  a: r`- **Principles with examples, not rules without context**: a short guide (value objects for money and ids, encapsulated aggregates, result types for business failures, sealed by default, no service locator) with real before/after code from your systems.
- **Automate what can be automated**: Roslyn analyzers and {{.editorconfig}} (nullable warnings as errors, CA rules), architecture tests (NetArchTest) for layering, API compatibility checks for shared packages.
- **Templates**: solution templates ({{dotnet new}}) that start teams with the right structure.
- **Review culture**: design reviews for new domains; pairing and mob sessions on tricky modelling.
- **Leave room for judgement**: standards describe defaults; deviations are documented in ADRs.
- **Measure** outcomes (defect rates, lead time), not compliance counts.`,
  pts: [r`Principles with real examples`, r`Analyzers and architecture tests`, r`Project templates`, r`Design reviews and pairing`, r`ADRs for deviations`],
  ex: r`A shared template with analyzers and architecture tests made new services consistent; review comments about structure dropped sharply.`,
  fu: [r`How do you handle a team whose code breaks the standards but works well?`],
  pit: [r`A 60-page coding standard nobody reads.`] },

{ id: 'q40', level: 'Principal', tags: ['fintech', 'domain-model'],
  q: r`Model money, currency and rounding for a multi-currency payments system.`,
  a: r`Requirements: exact arithmetic, currency safety, correct rounding per currency, FX conversions with traceability.

~~~csharp
public readonly record struct Currency(string Code, int MinorUnits)   // ISO 4217: JPY 0, USD 2, KWD 3
{
    public static readonly Currency USD = new("USD", 2), JPY = new("JPY", 0), KWD = new("KWD", 3);
}
public readonly record struct Money(decimal Amount, Currency Currency)
{
    public static Money Of(decimal amount, Currency c) => new(decimal.Round(amount, c.MinorUnits, MidpointRounding.ToEven), c);
    public static Money operator +(Money a, Money b) => a.Currency == b.Currency
        ? Of(a.Amount + b.Amount, a.Currency) : throw new CurrencyMismatchException(a.Currency, b.Currency);
    public long ToMinorUnits() => (long)(Amount * (decimal)Math.Pow(10, Currency.MinorUnits));
}
public sealed record FxConversion(Money Source, Money Target, decimal Rate, string RateSource, DateTimeOffset RateTime);
~~~

Design decisions:

- {{decimal}}, never {{double}}; store minor units ({{long}}) or decimals with explicit scale.
- **Rounding policy** explicit (banker's rounding vs half-up per regulation/contract) and applied at defined points (per line vs per total matters).
- **Allocation** (splitting 100.00 three ways) distributes remainders deterministically so totals match.
- FX conversions recorded with rate, source and timestamp for audit.
- No implicit conversions between currencies; comparisons across currencies throw.`,
  pts: [r`decimal / minor units`, r`Currency with minor-unit precision`, r`Explicit rounding policy and points`, r`Deterministic allocation`, r`Auditable FX conversions`],
  ex: r`Per-line vs per-invoice rounding differences produced cents of reconciliation breaks daily until the rounding point was standardised in the Money model.`,
  fu: [r`How do you split 100.00 into three equal parts?`],
  pit: [r`Using double or rounding only at display time.`] },

{ id: 'q41', level: 'Principal', tags: ['interview-scenario', 'code-review'],
  q: r`Code review: critique this class design.`,
  a: r`~~~csharp
public class CustomerManager
{
    public static List<Customer> Cache = new();
    public SqlConnection Conn = new SqlConnection(Config.Cs);
    public bool SendEmails = true;

    public void Process(Customer c, int type)
    {
        if (type == 1) { c.Discount = 0.1; }
        else if (type == 2) { c.Discount = 0.2; }
        Conn.Open();
        new SqlCommand("UPDATE Customers SET Discount=" + c.Discount + " WHERE Id=" + c.Id, Conn).ExecuteNonQuery();
        if (SendEmails) new SmtpClient("smtp").Send("x@y.com", c.Email, "Discount", "You got " + c.Discount);
        Cache.Add(c);
    }
}
~~~

Findings:

1. **Multiple responsibilities** (pricing rules, persistence, email, caching): split into a discount policy, a repository, a notifier, and an application service.
2. **Static mutable public cache**: thread-unsafe, unbounded growth, shared across tenants.
3. **Public fields** and a long-lived connection field: no encapsulation, connection never disposed or pooled correctly.
4. **Type codes** (1, 2) as ints: use an enum or strategy; magic numbers.
5. **double for discount** and a **public setter** on Customer.Discount: invariants (0 to 50%) not enforced.
6. **SQL injection** via string concatenation (even with numbers, the pattern is dangerous); use parameters or EF Core.
7. **Flag argument** ({{SendEmails}}) controlling behaviour: control coupling.
8. **Synchronous I/O** in what will be a web request; SmtpClient is obsolete-ish (use a provider/MailKit, outbox for emails).
9. **Static Config access**: hidden dependency; inject options.
10. No transaction or failure handling: email sent even if the update fails partially; no idempotency.`,
  pts: [r`Split responsibilities`, r`No static mutable state`, r`Encapsulate invariants`, r`Parameters, async I/O`, r`Outbox for side effects`],
  ex: r`A class like this caused a production incident where the static cache grew to 6 GB and leaked customer data between tenants.`,
  fu: [r`How would you sequence these fixes?`],
  pit: [r`Listing style nits before correctness and security.`] },

{ id: 'q42', level: 'Principal', tags: ['plugin-architecture', 'extensibility'],
  dia: r`flowchart LR
  API[Payments API] --> R[Provider router: currency, country, cost, health]
  R --> P1[Stripe adapter]
  R --> P2[Adyen adapter]
  R --> P3[Local bank adapter]
  P1 --> CB1[Circuit breaker + HttpClient]
  P2 --> CB2[Circuit breaker + HttpClient]
  P3 --> CB3[Circuit breaker + HttpClient]
  subgraph Core[Core domain]
    SM[Payment state machine]
  end
  P1 & P2 & P3 -->|mapped statuses via anti-corruption layer| SM`,
  q: r`Design an extensible plugin architecture for payment providers in .NET.`,
  a: r`Goals: add a provider (Stripe, Adyen, a local bank) without changing core code; isolate provider failures; keep the core testable.

Design:

- **Core contract** (port) in the core assembly:

~~~csharp
public interface IPaymentProvider
{
    string Name { get; }
    ProviderCapabilities Capabilities { get; }        // refunds, partial capture, 3DS, currencies
    Task<AuthorizeResult> AuthorizeAsync(AuthorizeRequest request, CancellationToken ct);
    Task<CaptureResult> CaptureAsync(CaptureRequest request, CancellationToken ct);
    Task<WebhookEvent> ParseWebhookAsync(HttpRequest request, CancellationToken ct);
}
~~~

- **Adapters** per provider in separate projects/packages, registered via DI ({{services.AddStripeProvider(...)}}) or keyed services; routing policy selects a provider by currency, country, cost and health.
- **Capabilities** declared explicitly instead of throwing NotSupported (LSP).
- **Anti-corruption layer**: provider-specific statuses mapped to the core's state machine.
- **Resilience per provider**: separate HttpClients, timeouts, circuit breakers (bulkheads).
- **Contract tests** each adapter must pass (a shared test suite), plus sandbox integration tests.
- Runtime-loaded plugins ({{AssemblyLoadContext}}) only if third parties ship them; otherwise compile-time composition is simpler and safer.`,
  pts: [r`Core port interface`, r`Capabilities instead of NotSupported`, r`Anti-corruption mapping`, r`Bulkheads per provider`, r`Shared contract test suite`],
  ex: r`Adding a new acquirer took 3 weeks instead of 3 months once the adapter contract and test suite existed.`,
  fu: [r`How do you route between providers dynamically?`],
  pit: [r`Provider-specific if/else scattered through the core.`] },

{ id: 'q43', level: 'Principal', tags: ['functional', 'oop'],
  code: r`~~~csharp
// OO where invariants live: the trade lifecycle aggregate
public sealed class Trade
{
    public TradeStatus Status { get; private set; }
    public void Confirm() { if (Status != TradeStatus.Booked) throw new DomainException("Not booked"); Status = TradeStatus.Confirmed; }
}
// Functional where data is transformed: pure exposure pipeline over immutable records
public sealed record Position(string Counterparty, decimal Notional, decimal Mtm);
public static IReadOnlyDictionary<string, decimal> Exposure(IEnumerable<Position> ps) =>
    ps.GroupBy(p => p.Counterparty)
      .ToDictionary(g => g.Key, g => g.Sum(p => Math.Max(p.Mtm, 0m)));
// Messages across services: immutable event contracts
public sealed record TradeConfirmed(Guid TradeId, DateTimeOffset At, int SchemaVersion = 1);
~~~`,
  q: r`Is OOP still the right paradigm for modern .NET systems? Make the case.`,
  a: r`Modern .NET is **multi-paradigm**, and strong teams choose per layer:

- **Domain with invariants and lifecycles**: OO aggregates and value objects (encapsulation) shine.
- **Data transformations, pipelines, calculations**: functional style (pure functions, immutable records, LINQ, pattern matching) is simpler and more testable.
- **Distributed systems**: services communicate with messages and immutable events; objects do not cross the wire, data does.
- **Concurrency**: immutability and message passing (channels, actors like Orleans) beat shared mutable objects.

OOP's lasting value is **encapsulation and modularity**; inheritance hierarchies are less central than in the 2000s. F# and functional C# patterns (records, results, pattern matching) complement rather than replace it.

The Principal answer: choose the paradigm by the problem's shape and the team's ability to maintain it, and keep consistency within each module.`,
  pts: [r`Multi-paradigm per layer`, r`OO for invariants`, r`Functional for transformations`, r`Messages across services`, r`Encapsulation is the lasting value`],
  ex: r`A risk platform used OO aggregates for trade lifecycle and pure functional pipelines for exposure calculations; both were easier to test than the previous all-OO design.`,
  fu: [r`Where would you use F# in a C# shop?`],
  pit: [r`Ideological answers ("OOP is dead" or "everything must be a class").`] },

{ id: 'q44', level: 'Principal', tags: ['mentoring'],
  code: r`~~~csharp
// Before: speculative "flexibility" for one export format
public interface IExportStrategyFactoryProvider { IExportStrategyFactory Get(); }
public interface IExportStrategyFactory { IExportStrategy Create(ExportContext ctx); }
public interface IExportStrategy { Task ExportAsync(ExportContext ctx); }
// ... plus registrations, a context bag and 4 more classes, for CSV only

// After: say what it does; abstract when the second real format arrives
public sealed class CsvExporter(IReportQuery query)
{
    public async Task WriteAsync(Stream output, ReportFilter filter, CancellationToken ct)
    {
        await using var w = new StreamWriter(output);
        await foreach (var row in query.RowsAsync(filter, ct)) await w.WriteLineAsync(row.ToCsv());
    }
}
~~~`,
  q: r`How do you mentor mid-level engineers who over-engineer with patterns and abstractions?`,
  a: r`- **Find the root**: often they equate seniority with patterns or fear future changes. Acknowledge the intent (flexibility, quality).
- **Teach cost awareness**: every abstraction has a reading cost, debugging cost and onboarding cost. Ask "what change does this make easier, and how likely is it?"
- **Use concrete code**: refactor together from the over-engineered version to a simpler one and compare readability and test effort.
- **Rule of three** and "make the change easy, then make the easy change": abstract when the second or third variation arrives.
- **Review questions instead of verdicts**: "what would we lose by inlining this interface?"
- **Model the behaviour**: show your own simple designs and explain when you added abstraction later.
- **Celebrate deletions** and simplifications in reviews and demos.`,
  pts: [r`Understand motivation`, r`Abstractions have costs`, r`Refactor together`, r`Rule of three`, r`Ask questions in reviews`],
  ex: r`A pairing session collapsing a 7-layer "flexible" export framework into 2 classes convinced a team more than any guideline document.`,
  fu: [r`How do you balance this with engineers who under-design?`],
  pit: [r`Rejecting designs without explaining trade-offs.`] },

{ id: 'q45', level: 'Principal', tags: ['system-design', 'lld'],
  code: r`~~~csharp
public enum SpotSize { Small = 1, Medium = 2, Large = 3 }
public sealed record Vehicle(string Plate, SpotSize Needs);                 // size as data, no subclass per vehicle
public sealed class Spot(int id, SpotSize size)
{
    private int _occupied;                                                  // 0 free, 1 taken
    public int Id { get; } = id; public SpotSize Size { get; } = size;
    public bool TryOccupy() => Interlocked.CompareExchange(ref _occupied, 1, 0) == 0;   // atomic claim
    public void Release() => Volatile.Write(ref _occupied, 0);
}
public interface ISpotAllocator { Spot? Allocate(Vehicle v, IReadOnlyList<Spot> spots); }
public sealed class NearestFit : ISpotAllocator
{
    public Spot? Allocate(Vehicle v, IReadOnlyList<Spot> spots) =>
        spots.Where(s => s.Size >= v.Needs).OrderBy(s => s.Size).FirstOrDefault(s => s.TryOccupy());
}
public interface IPricingPolicy { Money Price(Ticket t, DateTimeOffset exit); }
public sealed record Ticket(Guid Id, string Plate, int SpotId, DateTimeOffset Entered);
~~~`,
  dia: r`classDiagram
  class ParkingLot {
    +Enter(Vehicle) Ticket
    +Exit(Ticket) Payment
  }
  class Level {
    +Spots: List~Spot~
  }
  class Spot {
    +Id
    +Size
    +TryOccupy() bool
    +Release()
  }
  class Vehicle {
    +Plate
    +Needs: SpotSize
  }
  class Ticket {
    +Id
    +SpotId
    +Entered
  }
  class ISpotAllocator {
    <<interface>>
    +Allocate(Vehicle, Spots) Spot
  }
  class IPricingPolicy {
    <<interface>>
    +Price(Ticket, exit) Money
  }
  ParkingLot "1" *-- "many" Level
  Level "1" *-- "many" Spot
  ParkingLot --> ISpotAllocator
  ParkingLot --> IPricingPolicy
  ISpotAllocator <|.. NearestFit
  IPricingPolicy <|.. HourlyPricing
  Ticket --> Spot`,
  q: r`Design the object model for a parking-lot style LLD question, and explain what interviewers look for at Principal level.`,
  a: r`Core model:

- {{ParkingLot}} (root) → {{Level}} → {{Spot}} (size: Small/Medium/Large; status).
- {{Vehicle}} as data with a size requirement, not a class hierarchy per vehicle type (size drives behaviour).
- {{Ticket}} (entry time, spot, vehicle plate), {{Payment}} with a {{IPricingPolicy}} strategy (hourly, flat, weekend).
- {{SpotAllocator}} strategy (nearest to entrance, by level, EV spots).
- Concurrency: spot allocation must be atomic (lock per level, or compare-and-set on spot status; in a distributed version, a database conditional update).

What separates a Principal answer:

- **Clarify requirements** first (multiple entrances? EV charging? reservations? payment types?).
- Choose **composition and strategies** for variation points that actually vary (pricing, allocation), not deep inheritance.
- Address **concurrency and failure** (two cars assigned one spot; payment failure at exit).
- Discuss **extensibility trade-offs** and what you deliberately left simple.
- Bridge to the real system: persistence, APIs, events (spot freed), observability.`,
  pts: [r`Clarify requirements`, r`Composition and strategies`, r`Vehicle size as data`, r`Atomic allocation`, r`Bridge to real system concerns`],
  ex: r`Candidates who model Car/Truck/Motorbike subclasses with no behaviour differences score lower than those modelling size as data with a strategy for allocation.`,
  fu: [r`How does the design change for 1,000 lots with a central reservation system?`],
  pit: [r`Jumping into class diagrams before clarifying requirements.`] },

{ id: 'q46', level: 'Principal', tags: ['security', 'design'],
  code: r`~~~csharp
// Parse, don't validate: once you hold an Email, it is valid
public sealed record Email
{
    public string Value { get; }
    private Email(string v) => Value = v;
    public static bool TryParse(string? raw, [NotNullWhen(true)] out Email? email)
    {
        email = raw is { Length: <= 254 } && System.Net.Mail.MailAddress.TryCreate(raw.Trim(), out var a)
            ? new Email(a.Address.ToLowerInvariant()) : null;
        return email is not null;
    }
}
// Secret that never leaks into logs
public readonly record struct Secret(string Value) { public override string ToString() => "***"; }

// Request DTO prevents over-posting (no IsAdmin / IsVerified properties to bind)
public sealed record UpdateProfileRequest(string DisplayName, string? Phone);

// Authorisation inside the domain method
public void Refund(Money amount, Actor by)
{
    if (!by.HasPermission(Permission.Refund) || amount > by.RefundLimit) throw new ForbiddenException();
    /* ... */
}
~~~`,
  q: r`How can object design improve security?`,
  a: r`- **Types that cannot be invalid**: an {{Email}}, {{Iban}} or {{SanitizedHtml}} type validated at construction; code accepting these types cannot receive unvalidated input ("parse, don't validate").
- **Separate types for trust levels**: {{UntrustedInput}} vs domain types; {{SecureString}} is obsolete, but distinct types for secrets ({{Secret<T>}} with redacted {{ToString}}) prevent logging leaks.
- **Encapsulated authorisation**: aggregate methods take the acting principal and check rules (a {{Refund}} method requiring a role/limit), so no endpoint can forget.
- **Immutability** prevents time-of-check/time-of-use bugs on shared objects.
- **Least exposure**: internal by default, DTOs instead of entities (avoid over-posting/mass assignment, where binders set properties like {{IsAdmin}}).
- **Redaction** attributes and logging of structured data with classification ({{Microsoft.Extensions.Compliance.Redaction}}).`,
  pts: [r`Parse, don't validate`, r`Types for trust levels and secrets`, r`Authorisation in domain methods`, r`DTOs prevent over-posting`, r`Redaction`],
  ex: r`A mass-assignment bug let users set {{IsVerified}} via JSON on an entity-bound endpoint; dedicated request DTOs closed it.`,
  fu: [r`How does .NET's redaction library work?`],
  pit: [r`Binding request bodies directly to EF entities.`] },

{ id: 'q47', level: 'Principal', tags: ['interview-scenario'],
  code: r`~~~csharp
// The decision "how tax is calculated" is likely to change -> hide it behind one interface
public interface ITaxPolicy { Money TaxFor(Invoice invoice); }
public sealed class UkVatPolicy : ITaxPolicy { public Money TaxFor(Invoice i) => i.Net * 0.20m; }
public sealed class Invoice(ITaxPolicy tax)
{
    public Money Net { get; private set; } = Money.Zero(Currency.GBP);
    public Money Gross => Net + tax.TaxFor(this);    // callers never know how tax is computed
}
// A tax-rule change now touches one class instead of every caller that multiplied by 0.2
~~~`,
  q: r`An interviewer asks: "What is the most important OOP concept?" Answer at Principal level.`,
  a: r`**Encapsulation (information hiding)**, because it is what makes change cheap.

Parnas's 1972 insight: decompose systems by **design decisions likely to change**, and hide each decision behind an interface. Everything else follows:

- Polymorphism is a way to hide which implementation is used.
- Abstraction defines what is visible.
- Inheritance is a reuse mechanism that often **breaks** encapsulation (fragile base class), which is why we prefer composition.

At scale, the same idea defines good module and service boundaries: a team can change its internals without coordinating with others. Most expensive failures I have seen (shared databases, shared domain libraries, leaked entities in APIs) are encapsulation failures at a higher level.

So I evaluate designs by asking: "what is likely to change, and how many places must change when it does?"`,
  pts: [r`Encapsulation / information hiding`, r`Parnas: hide decisions likely to change`, r`Inheritance can break encapsulation`, r`Scales to services and teams`, r`Change-cost lens`],
  ex: r`A tax-rule change that touched 60 files in one system and 1 file in another illustrates the difference encapsulation makes.`,
  fu: [r`How do you identify decisions likely to change?`],
  pit: [r`Listing the four pillars without prioritising or justifying.`] },

{ id: 'q48', level: 'Principal', tags: ['performance', 'trade-offs'],
  code: r`~~~csharp
// Clean boundary, data-oriented core: no allocations, no virtual calls in the loop
public sealed class TickProcessor
{
    private readonly Tick[] _buffer = new Tick[1 << 16];
    public double Vwap(ReadOnlySpan<Tick> ticks)
    {
        double pv = 0, v = 0;
        foreach (ref readonly var t in ticks) { pv += t.Price * t.Size; v += t.Size; }
        return v == 0 ? 0 : pv / v;
    }
}
[StructLayout(LayoutKind.Sequential)] public readonly record struct Tick(double Price, double Size, long Ts);

// Benchmark gate in CI (BenchmarkDotNet) catches regressions
[MemoryDiagnoser] public class VwapBench { [Benchmark] public double Run() => new TickProcessor().Vwap(Data.Ticks); }
~~~`,
  q: r`A latency-critical component (market data, pricing) conflicts with clean OO design. How do you balance them?`,
  a: r`- **Isolate the hot path**: keep the core loop data-oriented (arrays of structs, spans, no allocations, no virtual calls) behind a clean, encapsulated boundary. The rest of the system uses ordinary OO design.
- **Measure first**: profile with production-like loads; most code is not hot.
- **Document the exception** in an ADR: why this module looks different, what invariants it maintains, how it is tested (property tests, benchmarks in CI with regression thresholds).
- **Keep correctness checks** (bounds, validation) at the boundary rather than inside the loop.
- **Use modern .NET features** that preserve abstraction at zero cost: generics over structs, {{static abstract}} interface members, {{ref struct}}, source generators instead of reflection, SIMD via {{Vector<T>}}.

The goal is a system where 95% of the code optimises for change and 5% optimises for nanoseconds, with a clear boundary between them.`,
  pts: [r`Isolate the hot path`, r`Profile first`, r`ADR for the exception`, r`Benchmarks in CI`, r`Zero-cost abstractions`],
  ex: r`An FX pricing engine kept a struct-based core with benchmark regression gates; the surrounding services used standard DDD-style design.`,
  fu: [r`How do you prevent performance regressions over time?`],
  pit: [r`Applying hot-path tricks across the whole codebase.`] },

{ id: 'q49', level: 'Principal', tags: ['legacy', 'migration'],
  code: r`~~~csharp
// Integration event contract: versioned, additive changes only
public sealed record OrderPlacedV1(Guid OrderId, decimal Total, string Currency);
public sealed record OrderPlacedV2(Guid OrderId, decimal Total, string Currency, string Channel = "web"); // expand

// Consumer-side anti-corruption layer translates to its own model
public sealed class OrderPlacedTranslator
{
    public LoyaltyAccrual Translate(OrderPlacedV2 e) => new(e.OrderId, Points: (int)Math.Floor(e.Total));
}
// Telemetry on old contract usage drives the contract phase
meter.CreateCounter<long>("contracts.orderplaced.v1.published").Add(1);
~~~`,
  q: r`How do you evolve an object model while many services and teams depend on it?`,
  a: r`- **Separate internal model from contracts**: consumers depend on DTOs/events/APIs, not on your classes. If a shared NuGet "domain" package exists, plan to retire it.
- **Expand/contract** for contract changes: add new fields/types, support both, migrate consumers, then remove the old.
- **Version contracts** (event schema versions, API versions) with compatibility checks in CI (schema registry rules, API diff tools).
- **Consumer-driven contract tests** (Pact) so you know who uses what.
- **Deprecation policy** with timelines and telemetry on old-contract usage.
- **Anti-corruption layers** in consumers that translate your model to theirs, so your internal changes stay internal.

Internally, refactor freely behind the contracts; the contract is the encapsulation boundary.`,
  pts: [r`Contracts separate from internal model`, r`Expand/contract`, r`Versioning with CI checks`, r`Consumer-driven contract tests`, r`Telemetry-driven deprecation`],
  ex: r`Retiring a shared "Company.Domain" NuGet used by 25 services took two quarters but ended lock-step releases.`,
  fu: [r`How long should you support an old contract?`],
  pit: [r`Shipping domain classes as a shared library across services.`] },

{ id: 'q50', level: 'Principal', tags: ['summary'],
  code: r`~~~csharp
// The philosophy in one aggregate
public sealed record LoanId(Guid Value);                                     // illegal mixing of ids impossible
public sealed class Loan                                                      // sealed: compose, do not inherit
{
    public LoanId Id { get; }
    public Money Principal { get; }
    public LoanStatus Status { get; private set; } = LoanStatus.Applied;      // explicit state machine
    public Loan(LoanId id, Money principal) =>
        (Id, Principal) = (id, principal.Amount > 0 ? principal : throw new DomainException("Principal must be positive"));
    public Result Approve(Underwriter by)                                     // behaviour protects invariants
        => Status == LoanStatus.Applied && by.Limit >= Principal
            ? Result.Ok(() => Status = LoanStatus.Approved)
            : Result.Fail("Cannot approve");
}
~~~`,
  q: r`Summarise your object-design philosophy in a way an interview panel will remember.`,
  a: r`1. **Model the domain's invariants, not its data.** Objects exist to protect rules.
2. **Hide what is likely to change.** Encapsulation at every level: class, module, service.
3. **Compose behaviour; inherit only types.** Sealed by default.
4. **Make illegal states unrepresentable**: value objects, strongly-typed ids, explicit state machines, nullable reference types.
5. **Choose the paradigm per problem**: OO for lifecycles, functional for transformations, messages across boundaries.
6. **Abstractions earn their place** through real variation or boundaries, not speculation.
7. **Design for testability and observability** as a consequence of good boundaries.
8. **Optimise for the team that maintains it**: readable over clever, consistent over perfect.

I measure design quality by the cost and risk of the next change.`,
  pts: [r`Invariants over data`, r`Hide likely changes`, r`Composition, sealed by default`, r`Illegal states unrepresentable`, r`Measure by cost of change`],
  ex: r`Applying these principles to a lending platform reduced the average time to implement a new product rule from weeks to days.`,
  fu: [r`Which principle would you drop under deadline pressure, and why?`],
  pit: [r`Reciting definitions without a point of view.`] }
],
cheat: r`### Pillars, ranked
Encapsulation (protect invariants; hide decisions likely to change) > polymorphism (runtime choice behind abstractions) > abstraction > inheritance (reuse that often breaks encapsulation).

### C# specifics
callvirt + method table slots; interface stub dispatch; sealed enables devirtualization. override replaces, new hides. Variance: out = producers, in = consumers; arrays covariant unsafely. Records for value objects; readonly record struct for hot paths; pattern matching for closed sets (expression problem).

### Design heuristics
| Smell | Fix |
|---|---|
| Getters/setters everywhere | Behaviour methods, private setters |
| Repeated type switches | Strategy / keyed services |
| Deep inheritance | Composition, decorators |
| Overrides throwing NotSupported | Capability interfaces (LSP) |
| Many mocks per test | Split responsibilities, functional core |
| Static DateTime/config | TimeProvider, Options pattern |
| Entities in API | DTOs (over-posting) |

### Domain modelling
Entities (identity) vs value objects (values, immutable). Aggregates: small, reference by id, optimistic concurrency, one per transaction. Domain events raised by aggregates, outbox for integration events. Explicit state machines. Money = decimal + currency + rounding policy.

### Say this
"Encapsulation protects invariants." "Inherit types, compose behaviour." "Make illegal states unrepresentable." "Abstractions must earn their place." "I judge a design by the cost of the next change."`
});
})(String.raw);
