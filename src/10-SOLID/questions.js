(function (r) {
registerTopic('10-solid', {
related: ['09-oop', '11-design-patterns', '32-clean-architecture'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['srp'],
  q: r`What does the Single Responsibility Principle really mean? Why is "a class should do one thing" a weak definition?`,
  a: r`Robert Martin's sharper wording: **a module should be responsible to one, and only one, actor**. A "reason to change" is a person or group whose requirements drive change: finance, compliance, operations.

"Do one thing" is weak because "thing" has no scale: a payroll class "does payroll". The actor framing gives a test: if the CFO's rule change and the HR rule change both force edits in the same class, the class has two responsibilities, and a change for one actor can break the other.

### How to spot violations
- Methods that change for different stakeholders (pay calculation vs hours reporting vs persistence).
- A class whose tests need unrelated fixtures (database, email, tax tables).
- Git history: the file appears in commits for unrelated features.

### The trade-off
SRP is about **cohesion around change**, not about tiny classes. Splitting one cohesive 300-line class into 15 classes for "purity" lowers comprehension. Split when you can name the different actors.`,
  code: r`~~~csharp
// Three actors in one class: Finance (pay), HR (hours report), DBAs (persistence)
public class Employee
{
    public decimal CalculatePay() => RegularHours() * Rate;   // Finance rule
    public string ReportHours() => $"{RegularHours()} h";     // HR rule
    public void Save() { /* SQL */ }                          // persistence
    private decimal RegularHours() => 0;                       // shared helper: Finance edits it, HR report silently changes
    public decimal Rate { get; init; }
}

// Separated by actor; shared data, separate reasons to change
public sealed record EmployeeData(Guid Id, decimal Rate, IReadOnlyList<Timesheet> Timesheets);
public sealed class PayCalculator   { public decimal Calculate(EmployeeData e) => 0m; }   // Finance
public sealed class HoursReporter   { public string Report(EmployeeData e) => "";    }   // HR
public sealed class EmployeeRepository { public Task SaveAsync(EmployeeData e, CancellationToken ct) => Task.CompletedTask; }
~~~`,
  pts: [r`SRP means one actor (stakeholder group) per module, not "one thing".`, r`Test it: name who would ask for each change; two names means two responsibilities.`, r`Shared helpers between actors are where accidental breakage hides.`, r`It is about cohesion around change, not about small classes.`, r`Use git change history to find classes changed for unrelated features.`],
  ex: r`An overtime rule change requested by payroll altered a shared "regular hours" method and silently changed the hours report HR sent to a regulator; splitting by actor made the two rules independent.`,
  fu: [r`How does SRP apply at service level?`, r`When would you deliberately keep two responsibilities together?`],
  pit: [r`Splitting classes by technical layer only and calling it SRP.`, r`Creating many one-method classes that must always change together.`],
  tip: r`Quote "responsible to one actor". It instantly separates you from the "do one thing" answer.` },

{ id: 'q2', level: 'Basic', tags: ['ocp'],
  q: r`Explain the Open/Closed Principle with a realistic example. Does it mean you never modify existing code?`,
  a: r`OCP: software entities should be **open for extension, closed for modification**. When a new variant arrives, you add new code instead of editing tested code paths, so existing behaviour cannot regress.

It does **not** mean never editing code: bug fixes, refactoring and design changes modify code. It means designing **the axes of change you expect** so that adding a variant along them is additive.

### Mechanisms in .NET
- Strategy interfaces registered in DI (new payment method = new class + registration).
- Decorators and middleware pipelines (new cross-cutting behaviour = new layer).
- Plugins via keyed services or assembly scanning.
- Data-driven rules (new tax rate = a row, not a code change).

### The judgement
Every extension point costs indirection. Apply OCP to axes that have **already** varied or are on the roadmap ("we will add more payment providers"), not to every conceivable change. A closed set of alternatives that rarely changes is fine as a switch.`,
  code: r`~~~csharp
// Before: every new provider edits this method (and risks breaking the others)
public decimal Fee(string provider, decimal amount) => provider switch
{
    "card" => amount * 0.029m + 0.30m,
    "sepa" => 0.35m,
    _ => throw new NotSupportedException(provider)
};

// After: adding "instant-bank" is a new class + one registration line
public interface IFeePolicy { string Provider { get; } decimal Fee(decimal amount); }
public sealed class CardFee : IFeePolicy { public string Provider => "card"; public decimal Fee(decimal a) => a * 0.029m + 0.30m; }
public sealed class SepaFee : IFeePolicy { public string Provider => "sepa"; public decimal Fee(decimal a) => 0.35m; }
public sealed class FeeCalculator(IEnumerable<IFeePolicy> policies)
{
    private readonly Dictionary<string, IFeePolicy> _byProvider = policies.ToDictionary(p => p.Provider);
    public decimal Fee(string provider, decimal amount) => _byProvider[provider].Fee(amount);
}
builder.Services.AddSingleton<IFeePolicy, CardFee>();
builder.Services.AddSingleton<IFeePolicy, SepaFee>();
~~~`,
  pts: [r`Extend by adding code along expected axes of change, not by editing tested paths.`, r`It does not forbid modification: fixes and refactors still edit code.`, r`Strategies, decorators, pipelines, plugins and data-driven rules are the mechanisms.`, r`Apply it where variation has happened or is planned, not everywhere.`, r`Each extension point costs indirection; a stable closed switch is fine.`],
  ex: r`A PSP added 14 local payment methods in a year; with the strategy registry each was an isolated PR with its own tests, and none caused a regression in card payments.`,
  fu: [r`How do you choose which axes to make extensible?`, r`How does OCP relate to feature flags?`],
  pit: [r`Building plugin frameworks for variation that never comes.`, r`Claiming OCP forbids refactoring.`] },

{ id: 'q3', level: 'Basic', tags: ['lsp'],
  q: r`What is the Liskov Substitution Principle in behavioural terms, and how do you detect violations in code reviews?`,
  a: r`LSP: **objects of a subtype must be usable wherever the base type is expected without breaking the program's correctness**. It is about **behaviour**, not signatures; the compiler only checks signatures.

Design-by-contract rules for a subtype:

- **Preconditions** cannot be strengthened (it may not demand more of callers).
- **Postconditions** cannot be weakened (it must deliver at least what the base promises).
- **Invariants** of the base must be preserved.
- No new exceptions that callers of the base do not expect.

### Review smells
- Overrides that throw {{NotSupportedException}} or do nothing.
- Callers checking concrete types: {{if (repo is CachedRepository)}}.
- Overrides that ignore parameters or return different shapes (paged vs full).
- Subclasses needing extra setup before base methods work.

### Fixes
Split interfaces by capability (ISP), prefer composition, or make the type hierarchy reflect actual behaviour (immutable shapes rather than mutable Square/Rectangle).`,
  code: r`~~~csharp
public interface IAccount { void Withdraw(decimal amount); decimal Balance { get; } }
public class CurrentAccount : IAccount
{
    public decimal Balance { get; protected set; }
    public virtual void Withdraw(decimal amount) { if (amount <= 0) throw new ArgumentOutOfRangeException(); Balance -= amount; }
}
// Violation: strengthens the precondition and throws an exception callers do not expect
public class FixedDepositAccount : CurrentAccount
{
    public override void Withdraw(decimal amount) => throw new InvalidOperationException("Locked until maturity");
}
// Fix: model the capability explicitly instead of pretending every account can withdraw
public interface IWithdrawable { Result Withdraw(decimal amount); }
public sealed class FixedDeposit { public DateOnly MaturesOn { get; init; } }                        // not withdrawable
public sealed class Current : IWithdrawable { public Result Withdraw(decimal a) => Result.Ok(); }
~~~`,
  pts: [r`Subtypes must honour the base contract's behaviour, not just its signatures.`, r`No stronger preconditions, no weaker postconditions, keep invariants.`, r`NotSupportedException overrides and type checks in callers are the review smells.`, r`Fix with capability interfaces or composition.`, r`Contract tests run against every implementation catch violations.`],
  ex: r`A batch job iterated all accounts and called Withdraw for fees; a new fixed-deposit subclass threw and aborted the whole run, so 40,000 accounts were not charged until the hierarchy was split by capability.`,
  fu: [r`How do contract tests enforce LSP across implementations?`, r`Is ReadOnlyCollection implementing IList an LSP violation?`],
  pit: [r`Saying LSP is satisfied because the code compiles.`] },

{ id: 'q4', level: 'Basic', tags: ['isp'],
  q: r`What problem does the Interface Segregation Principle solve, and how do you split a fat interface?`,
  a: r`ISP: **clients should not be forced to depend on methods they do not use**. Fat interfaces cause:

- Implementers forced to stub methods (often throwing, which is also an LSP violation).
- Recompilation and redeployment coupling: a change to a method one client uses ripples to all.
- Over-broad mocks in tests and over-broad permissions in practice (a read-only consumer can call delete).

### How to split
Group methods by **client role**, not by implementation: {{IOrderReader}} for query screens, {{IOrderWriter}} for commands, {{IOrderExporter}} for reporting. One class may implement several role interfaces; consumers depend only on what they need.

### Balance
Do not create one interface per method by reflex. A cohesive interface used whole by its clients is fine. ISP also applies to APIs and events: a "god" REST resource or event payload forces every consumer to understand everything.`,
  code: r`~~~csharp
// Fat interface: the reporting job can now delete orders, and the read replica adapter must stub writes
public interface IOrderRepository
{
    Task<Order?> GetAsync(Guid id, CancellationToken ct);
    Task<IReadOnlyList<Order>> SearchAsync(OrderFilter f, CancellationToken ct);
    Task SaveAsync(Order o, CancellationToken ct);
    Task DeleteAsync(Guid id, CancellationToken ct);
    Task<Stream> ExportCsvAsync(DateOnly from, DateOnly to, CancellationToken ct);
}

// Segregated by client role
public interface IOrderReader   { Task<Order?> GetAsync(Guid id, CancellationToken ct); Task<IReadOnlyList<Order>> SearchAsync(OrderFilter f, CancellationToken ct); }
public interface IOrderWriter   { Task SaveAsync(Order o, CancellationToken ct); Task DeleteAsync(Guid id, CancellationToken ct); }
public interface IOrderExporter { Task<Stream> ExportCsvAsync(DateOnly from, DateOnly to, CancellationToken ct); }
public sealed class SqlOrderStore : IOrderReader, IOrderWriter { /* one implementation, several roles */ }
public sealed class ReplicaOrderReader : IOrderReader { /* read replica: no write stubs needed */ }
~~~`,
  pts: [r`Clients should depend only on the methods they use.`, r`Fat interfaces force stub implementations, broad mocks and broad permissions.`, r`Split by client role (reader, writer, exporter), not by implementation.`, r`One class can implement several role interfaces.`, r`Applies to REST resources and event payloads too.`],
  ex: r`Splitting a 22-method repository into reader and writer roles let the reporting service run against a read replica with a read-only adapter and a database login that could not write.`,
  fu: [r`How does ISP relate to CQRS?`, r`When is a large interface acceptable?`],
  pit: [r`One interface per method everywhere.`, r`Splitting by implementation detail instead of by consumer need.`] },

{ id: 'q5', level: 'Basic', tags: ['dip'],
  q: r`Dependency Inversion vs dependency injection vs inversion of control: what is the difference?`,
  a: r`- **Dependency Inversion Principle (DIP)**: high-level policy should not depend on low-level details; both depend on **abstractions**, and the abstraction is **owned by the high-level module**. It is a design principle about the direction of source-code dependencies.
- **Dependency Injection (DI)**: a technique for supplying dependencies from outside (constructor parameters), so a class does not create its collaborators.
- **Inversion of Control (IoC)**: the broader idea that a framework calls your code (Hollywood principle); DI containers and ASP.NET Core's pipeline are forms of IoC.

You can use DI without DIP (injecting a concrete {{SqlOrderRepository}} defined in the infrastructure project) and DIP without a container (manual composition in {{Main}}).

### Why ownership matters
If {{IOrderRepository}} lives in the infrastructure assembly, the domain still depends on infrastructure, so the arrow has not been inverted. Put the interface in the domain/application project; the infrastructure project references the domain and implements it.`,
  code: r`~~~csharp
// Domain/application project owns the abstraction (no reference to EF, SQL or HTTP)
namespace Billing.Application;
public interface IInvoiceStore { Task SaveAsync(Invoice invoice, CancellationToken ct); }
public sealed class IssueInvoiceHandler(IInvoiceStore store, TimeProvider clock)
{
    public Task HandleAsync(IssueInvoice cmd, CancellationToken ct) =>
        store.SaveAsync(Invoice.Issue(cmd.CustomerId, cmd.Lines, clock.GetUtcNow()), ct);
}

// Infrastructure project references Billing.Application and implements the port
namespace Billing.Infrastructure;
public sealed class EfInvoiceStore(BillingDb db) : Billing.Application.IInvoiceStore
{
    public async Task SaveAsync(Invoice invoice, CancellationToken ct) { db.Invoices.Add(invoice); await db.SaveChangesAsync(ct); }
}

// Composition root (the only place that knows both)
builder.Services.AddScoped<Billing.Application.IInvoiceStore, Billing.Infrastructure.EfInvoiceStore>();
~~~`,
  pts: [r`DIP is a design rule: policy and details both depend on abstractions owned by the policy side.`, r`DI is a technique for passing dependencies in; IoC is the broader framework-calls-you idea.`, r`DI without DIP is common: injecting concrete infrastructure types.`, r`Put the interface in the domain/application project, not in infrastructure.`, r`Only the composition root knows both sides.`],
  ex: r`Moving repository interfaces from the Infrastructure project into the Application project removed the domain's reference to EF Core, letting the team unit-test 400 business rules without a database.`,
  fu: [r`How does DIP map to hexagonal architecture's ports?`, r`Is injecting ILogger<T> a DIP violation?`],
  pit: [r`Treating "we use a DI container" as proof of DIP.`, r`Interfaces defined next to their only implementation in infrastructure.`] },

{ id: 'q6', level: 'Basic', tags: ['overview', 'trade-offs'],
  q: r`Are the SOLID principles still relevant for modern .NET, functional styles and microservices?`,
  a: r`Yes, as **heuristics for managing change**, but they must be applied with judgement.

- **SRP** generalises to cohesion: services and modules aligned to one business capability and one team.
- **OCP** shows up as plugin points, middleware pipelines, event subscribers, feature flags.
- **LSP** applies to any substitutable implementation: providers behind an interface, API versions (v2 must honour v1 contracts for existing clients), mocks that behave unlike the real thing.
- **ISP** applies to API and event design: small, client-focused contracts.
- **DIP** becomes ports and adapters (hexagonal, clean architecture) and dependency direction between services (downstream depends on upstream's published contract, never its internals).

In functional code, many problems SOLID addresses disappear (immutability, functions as strategies), but the intent remains: isolate what changes.

### Where SOLID is misused
Over-engineering: interfaces for everything, deep inheritance "to be open/closed", dozens of tiny classes. The principles serve maintainability; they are not goals.`,
  code: r`~~~csharp
// Functional style still expresses OCP/DIP: behaviour passed in as functions
public static class Pricing
{
    public static decimal Apply(decimal price, IEnumerable<Func<decimal, decimal>> rules) =>
        rules.Aggregate(price, (p, rule) => rule(p));
}
var price = Pricing.Apply(100m, [p => p * 0.9m /* promo */, p => p + 4.99m /* shipping */]);

// Service-level ISP/DIP: depend on the published contract, not the provider's internals
public sealed record CustomerSummaryV1(string Id, string Name, string Segment);   // contract package, versioned
~~~`,
  pts: [r`SOLID remains useful as heuristics for managing change.`, r`Each principle has a service-level equivalent: cohesion, plugins, contract compatibility, small contracts, dependency direction.`, r`Functional style removes some problems but keeps the intent.`, r`Misuse is over-engineering: abstractions without real variation.`, r`Judge by the cost of the next change, not by compliance.`],
  ex: r`A team that "applied SOLID" with 60 interfaces in a 4,000-line service later deleted 45 of them; change lead time improved because the remaining abstractions marked real boundaries.`,
  fu: [r`Which principle matters most at microservice level?`, r`Give an example where applying SOLID made code worse.`],
  pit: [r`Reciting definitions without trade-offs.`] },

{ id: 'q7', level: 'Intermediate', tags: ['srp', 'refactoring'],
  q: r`Refactor a fat ASP.NET Core controller that validates, calculates, saves, emails and logs. What do you extract and why?`,
  a: r`A fat controller mixes HTTP concerns (binding, status codes), application orchestration, business rules and infrastructure. Each changes for a different reason and tests need the whole stack.

Target shape:

- **Endpoint/controller**: HTTP only (bind, call handler, map result to status code).
- **Validation**: a validator (FluentValidation or data annotations) or endpoint filter.
- **Application handler**: orchestrates one use case (load, call domain, save, publish).
- **Domain**: business rules on entities/value objects (pricing, state transitions).
- **Infrastructure**: repository, email sender behind interfaces.
- **Side effects**: email via a domain event handler or outbox, not inline (so a mail outage does not fail the order).

Refactor incrementally with characterisation tests at the HTTP level first, so behaviour is pinned while code moves.`,
  code: r`~~~csharp
// After: the endpoint is thin; each piece changes for one reason
app.MapPost("/orders", async (PlaceOrder cmd, PlaceOrderHandler handler, CancellationToken ct) =>
    await handler.HandleAsync(cmd, ct) switch
    {
        { IsSuccess: true } r => Results.Created("/orders/" + r.Value, new { id = r.Value }),
        var r => Results.Problem(statusCode: 422, title: r.Error)
    }).AddEndpointFilter<ValidationFilter<PlaceOrder>>();

public sealed class PlaceOrderHandler(IOrderRepository orders, IPricingService pricing, IUnitOfWork uow)
{
    public async Task<Result<Guid>> HandleAsync(PlaceOrder cmd, CancellationToken ct)
    {
        var quote = await pricing.QuoteAsync(cmd.Lines, ct);
        var order = Order.Place(cmd.CustomerId, cmd.Lines, quote);   // rules + raises OrderPlaced
        await orders.AddAsync(order, ct);
        await uow.CommitAsync(ct);                                   // saves + writes outbox (email handled async)
        return Result.Ok(order.Id);
    }
}
~~~`,
  pts: [r`Separate HTTP, orchestration, business rules and infrastructure: each has its own reason to change.`, r`Validation becomes a filter or validator, applied consistently.`, r`Business rules move into the domain where they are unit-testable.`, r`Side effects like email go through events/outbox so outages do not fail the request.`, r`Pin behaviour with HTTP-level tests before moving code.`],
  ex: r`A 900-line OrdersController was split over 6 PRs; the email outage that previously failed checkouts became a delayed notification instead.`,
  fu: [r`Would you use MediatR for the handler? Why or why not?`, r`Where do authorisation checks belong?`],
  pit: [r`Moving everything into one "OrderService" god class.`, r`Refactoring without characterisation tests.`] },

{ id: 'q8', level: 'Intermediate', tags: ['ocp', 'decorator'],
  q: r`How do decorators help you follow OCP and SRP? Implement caching and retry around a repository without touching it.`,
  a: r`A **decorator** implements the same interface as the component it wraps and adds behaviour before or after delegating. The wrapped class stays closed for modification (OCP) and keeps one responsibility (SRP); caching, retry, logging and metrics each live in their own class.

In .NET, register decorators with **Scrutor** ({{services.Decorate<TInterface, TDecorator>()}}) or manually with a factory. Order matters: registration order defines nesting (e.g. metrics outermost, then cache, then retry around the real call).

### Watch out for
- Decorators must honour the contract (LSP): a caching decorator returning stale data where the caller expects fresh data changes behaviour.
- Cache keys must include every input that affects the result (tenant, culture).
- Too many layers make stack traces harder; keep them focused.`,
  code: r`~~~csharp
public interface IFxRates { Task<decimal> GetAsync(string pair, CancellationToken ct); }
public sealed class HttpFxRates(HttpClient http) : IFxRates
{ public async Task<decimal> GetAsync(string pair, CancellationToken ct) => await http.GetFromJsonAsync<decimal>("/rates/" + pair, ct); }

public sealed class CachedFxRates(IFxRates inner, HybridCache cache) : IFxRates
{
    public async Task<decimal> GetAsync(string pair, CancellationToken ct) =>
        await cache.GetOrCreateAsync("fx:" + pair, async t => await inner.GetAsync(pair, t),
            new HybridCacheEntryOptions { Expiration = TimeSpan.FromSeconds(5) }, cancellationToken: ct);
}
public sealed class RetryingFxRates(IFxRates inner, ResiliencePipeline pipeline) : IFxRates
{
    public async Task<decimal> GetAsync(string pair, CancellationToken ct) =>
        await pipeline.ExecuteAsync(async t => await inner.GetAsync(pair, t), ct);
}

builder.Services.AddHttpClient<IFxRates, HttpFxRates>();
builder.Services.Decorate<IFxRates, RetryingFxRates>();   // Scrutor: Retrying(Http)
builder.Services.Decorate<IFxRates, CachedFxRates>();     // Cached(Retrying(Http))
~~~`,
  pts: [r`A decorator wraps the same interface and adds behaviour around the call.`, r`Each cross-cutting concern gets its own class; the core stays untouched.`, r`Registration order defines nesting; be deliberate about it.`, r`Decorators must preserve the contract, including freshness expectations.`, r`Scrutor's Decorate keeps DI registration simple.`],
  ex: r`A team added caching to an FX client with a decorator in one PR; when the vendor added rate limits, a throttling decorator went in alongside without changing the HTTP client.`,
  fu: [r`Decorator vs middleware vs MediatR pipeline behaviours?`, r`How do you test decorator order?`],
  pit: [r`Cache keys missing tenant or culture.`, r`Putting retry outside the cache (retrying cache hits pointlessly is harmless; retrying cache writes after inner success is not).`] },

{ id: 'q9', level: 'Intermediate', tags: ['dip', 'testing'],
  q: r`How does DIP make code testable? Show how you test a service that depends on time, HTTP and a database.`,
  a: r`When high-level code depends on abstractions, tests can substitute **fakes** for slow, non-deterministic or external collaborators. The three classics:

- **Time**: inject {{TimeProvider}} (.NET 8) instead of reading {{DateTime.UtcNow}}; tests use {{FakeTimeProvider}} and can advance time.
- **HTTP**: depend on an interface (or a typed {{HttpClient}}) and test with a fake implementation or a stub {{HttpMessageHandler}}; for contract confidence add a few tests against WireMock.
- **Database**: depend on a repository port; unit-test business rules with an in-memory fake, and test the real repository separately with Testcontainers (never trust the EF in-memory provider for SQL behaviour).

The value is not "mock everything"; it is that business rules can be tested **fast and deterministically**, while infrastructure is tested with real dependencies in fewer, slower tests.`,
  code: r`~~~csharp
public sealed class LatePaymentFeeService(IInvoiceStore invoices, IExchangeRates fx, TimeProvider clock)
{
    public async Task<decimal> FeeAsync(Guid invoiceId, CancellationToken ct)
    {
        var inv = await invoices.GetAsync(invoiceId, ct);
        var daysLate = (clock.GetUtcNow().Date - inv.DueDate.ToDateTime(TimeOnly.MinValue)).Days;
        if (daysLate <= 0) return 0m;
        var rate = await fx.RateAsync(inv.Currency, "GBP", ct);
        return Math.Round(inv.Amount * rate * 0.0005m * daysLate, 2);
    }
}

[Fact]
public async Task Fee_accrues_per_day_late()
{
    var clock = new FakeTimeProvider(new DateTimeOffset(2026, 10, 10, 9, 0, 0, TimeSpan.Zero));
    var invoices = new InMemoryInvoiceStore(new Invoice(Id, 1000m, "EUR", new DateOnly(2026, 10, 1)));
    var fx = new FixedRates(("EUR", "GBP", 0.85m));
    var fee = await new LatePaymentFeeService(invoices, fx, clock).FeeAsync(Id, default);
    fee.Should().Be(3.83m);   // 1000 * 0.85 * 0.0005 * 9 days
}
~~~`,
  pts: [r`Abstractions let tests replace time, HTTP and storage with deterministic fakes.`, r`Use TimeProvider and FakeTimeProvider for time.`, r`Unit-test rules with fakes; test real adapters with Testcontainers or WireMock.`, r`Do not trust the EF in-memory provider for SQL behaviour.`, r`The goal is fast, deterministic tests of business rules, not mocking everything.`],
  ex: r`Fee tests that depended on DateTime.Now failed every month-end; injecting TimeProvider made them deterministic and exposed a leap-year bug.`,
  fu: [r`Fakes vs mocks: when do you prefer each?`, r`How many integration tests are enough?`],
  pit: [r`Mocking concrete infrastructure classes with complex setups.`, r`Asserting on mock call sequences instead of outcomes.`] },

{ id: 'q10', level: 'Intermediate', tags: ['lsp', 'collections'],
  q: r`Is ReadOnlyCollection<T> implementing IList<T> an LSP violation? What does the BCL teach about interface design?`,
  a: r`{{ReadOnlyCollection<T>}} implements {{IList<T>}} but throws {{NotSupportedException}} from {{Add}}, {{Remove}} and the indexer setter. Strictly, a caller written against {{IList<T>}} that adds an item breaks: an LSP violation.

The BCL designers knew this: {{ICollection<T>.IsReadOnly}} exists so callers can check, which is a documented, weaker contract ("may be read-only"). It was a pragmatic compromise from the .NET 2.0 era, before {{IReadOnlyList<T>}} and {{IReadOnlyCollection<T>}} existed (.NET 4.5).

Lessons:

- Model capabilities separately (read vs write) so implementations never need to refuse.
- Accept the narrowest interface you need: a method that only enumerates should take {{IEnumerable<T>}} or {{IReadOnlyList<T>}}, not {{List<T>}}.
- Return read-only interfaces from domain objects so callers cannot mutate internals.`,
  code: r`~~~csharp
IList<int> list = new List<int> { 1, 2 }.AsReadOnly();
list.Add(3);                          // NotSupportedException at runtime: the IList contract was only "maybe writable"

// Accept what you need, return what you promise
public static decimal Total(IReadOnlyCollection<OrderLine> lines) => lines.Sum(l => l.Price * l.Qty);
public sealed class Order
{
    private readonly List<OrderLine> _lines = new();
    public IReadOnlyList<OrderLine> Lines => _lines;      // callers cannot Add without going through the aggregate
    public void AddLine(OrderLine line) { /* invariants */ _lines.Add(line); }
}
~~~`,
  pts: [r`Strictly yes: IList promises Add, ReadOnlyCollection throws.`, r`IsReadOnly is a documented escape hatch, a weaker contract.`, r`IReadOnlyList and IReadOnlyCollection fixed it by separating capabilities.`, r`Accept the narrowest interface a method needs.`, r`Expose read-only views of internal collections.`],
  ex: r`A library accepted List<T> parameters everywhere; changing them to IReadOnlyList<T> let callers pass arrays and immutable collections without copying.`,
  fu: [r`Why is array covariance a related problem?`],
  pit: [r`Taking List<T> parameters "for convenience".`] },

{ id: 'q11', level: 'Intermediate', tags: ['srp', 'cohesion'],
  q: r`How do you measure whether a class or module follows SRP and has good cohesion?`,
  a: r`Mix qualitative and quantitative signals:

- **Actor test**: list who requests changes to this module; more than one actor suggests a split.
- **LCOM** (lack of cohesion of methods): methods that use disjoint sets of fields indicate separable responsibilities (NDepend computes it).
- **Change coupling** from git: files in the class that always change with files in unrelated features.
- **Test fixture spread**: tests for one class needing very different setups.
- **Naming**: "Manager", "Helper", "Util", "Processor" names, or names with "And".
- **Size and complexity**: not a direct SRP measure, but large size plus high churn is a hotspot worth examining.

Never use metrics as targets; use them to find candidates, then apply judgement. A 500-line cohesive pricing engine can be healthier than ten 50-line classes that always change together.`,
  code: r`~~~bash
# Change coupling: which other files change together with OrderService.cs most often?
git log --format=format: --name-only -- src/Orders/OrderService.cs | sort | uniq -c | sort -rn | head
git log --format='%H' -- src/Orders/OrderService.cs | while read c; do git show --name-only --format= "$c"; done \
  | grep -v OrderService.cs | sort | uniq -c | sort -rn | head -15
~~~
~~~csharp
// LCOM smell: two clusters of methods touching disjoint fields -> two responsibilities
public class CustomerManager
{
    private readonly AppDb _db; private readonly ISmtpClient _smtp; private readonly ITemplateEngine _templates;
    public Task<Customer> LoadAsync(Guid id) => default!;          // uses _db
    public Task SaveAsync(Customer c) => Task.CompletedTask;       // uses _db
    public Task SendWelcomeAsync(Customer c) => Task.CompletedTask; // uses _smtp, _templates
    public Task SendStatementAsync(Customer c) => Task.CompletedTask;
}
~~~`,
  pts: [r`Ask who requests changes: more than one actor suggests a split.`, r`LCOM shows method clusters over disjoint fields.`, r`Git change coupling reveals hidden responsibilities.`, r`Generic names like Manager, Helper or Util are warning signs.`, r`Metrics find candidates; judgement decides.`],
  ex: r`An analysis of a "CustomerManager" showed two field clusters and change coupling with the marketing module; extracting a CustomerNotifier aligned the code with the marketing team that owned those changes.`,
  fu: [r`How would you apply this at microservice level?`],
  pit: [r`Treating line count as an SRP metric.`] },

{ id: 'q12', level: 'Intermediate', tags: ['isp', 'api-design'],
  q: r`How does Interface Segregation apply to REST APIs and event contracts?`,
  a: r`The same coupling problem appears at network boundaries:

- **God resources**: {{GET /customers/{id}}} returning 150 fields for every consumer. Every consumer couples to all fields; changing one field needs coordination with everyone; PII leaks to consumers that never needed it.
- **God events**: {{CustomerChanged}} with the whole customer, published for every change. Consumers must diff payloads to understand what happened.

Segregation options:

- **Purpose-specific endpoints or BFFs** ({{/customers/{id}/summary}}, a mobile BFF) shaped for consumer roles.
- **Field selection** for read APIs, with defaults small.
- **Fine-grained, intention-revealing events** ({{CustomerAddressChanged}}, {{CustomerSegmentUpgraded}}) carrying what changed.
- **Separate contracts per audience**: internal events vs external webhooks.

The trade-off: more endpoints/events to maintain and version; keep a catalogue and conventions so segregation does not become sprawl.`,
  code: r`~~~csharp
// Consumer-shaped read model instead of the full aggregate
app.MapGet("/customers/{id:guid}/summary", async (Guid id, CustomerReadDb db, CancellationToken ct) =>
    await db.Customers.Where(c => c.Id == id)
        .Select(c => new CustomerSummary(c.Id, c.DisplayName, c.Segment))     // 3 fields, no PII
        .SingleOrDefaultAsync(ct) is { } s ? Results.Ok(s) : Results.NotFound());

// Intention-revealing events instead of one CustomerChanged with everything
public sealed record CustomerAddressChanged(Guid CustomerId, Address NewAddress, DateTimeOffset At);
public sealed record CustomerSegmentUpgraded(Guid CustomerId, string From, string To, DateTimeOffset At);
public sealed record CustomerSummary(Guid Id, string DisplayName, string Segment);
~~~`,
  pts: [r`God resources and god events couple every consumer to every field.`, r`Shape endpoints and BFFs for consumer roles.`, r`Publish intention-revealing events that say what changed.`, r`Smaller contracts reduce PII exposure.`, r`Keep a catalogue so segregation does not become sprawl.`],
  ex: r`Replacing a CustomerChanged event with five specific events cut consumer processing by 90% because most consumers only cared about address changes.`,
  fu: [r`How do you avoid an explosion of endpoints?`, r`Event-carried state transfer vs notification events?`],
  pit: [r`One event type for all changes.`] },

{ id: 'q13', level: 'Intermediate', tags: ['dip', 'architecture'],
  q: r`Show dependency direction in a layered .NET solution. Which project references which, and how do you enforce it?`,
  a: r`With DIP applied (clean/hexagonal style):

- **Domain**: entities, value objects, domain services, domain events. References nothing project-specific.
- **Application**: use cases, ports (repository and gateway interfaces), DTOs. References Domain.
- **Infrastructure**: EF Core, HTTP clients, messaging adapters implementing the ports. References Application (and Domain).
- **Api/Host**: composition root, endpoints. References Application and Infrastructure (for registration only).

The key arrow: **Infrastructure -> Application**, not the reverse. Business code never sees EF Core or Azure SDK types.

Enforcement:

- Project references (the compiler enforces the absence of a reference).
- Architecture tests (NetArchTest / ArchUnitNET) for namespace-level rules within a project.
- {{internal}} visibility for infrastructure types, exposing only registration extensions.`,
  code: r`~~~csharp
[Fact]
public void Application_does_not_depend_on_infrastructure_or_ef()
{
    var result = Types.InAssembly(typeof(Billing.Application.AssemblyMarker).Assembly)
        .ShouldNot().HaveDependencyOnAny("Billing.Infrastructure", "Microsoft.EntityFrameworkCore", "Azure")
        .GetResult();
    result.IsSuccessful.Should().BeTrue(string.Join(", ", result.FailingTypeNames ?? []));
}
~~~`,
  dia: r`flowchart LR
  API[Api / Host: composition root] --> APP[Application: use cases + ports]
  API --> INF[Infrastructure: EF Core, HTTP, messaging adapters]
  INF --> APP
  APP --> DOM[Domain: entities, value objects, rules]
  INF --> DOM`,
  pts: [r`Domain references nothing; Application references Domain.`, r`Infrastructure references Application and implements its ports: that is the inversion.`, r`The host is the composition root.`, r`Enforce with project references, architecture tests and internal visibility.`, r`Business code never sees EF Core or cloud SDK types.`],
  ex: r`An architecture test caught a developer adding an EF Core using to a domain entity for a quick query; the PR was redirected to a repository method.`,
  fu: [r`Should the domain reference MediatR or logging abstractions?`, r`How do you handle EF Core attributes on entities?`],
  pit: [r`Interfaces in Infrastructure, domain referencing Infrastructure.`] },

{ id: 'q14', level: 'Intermediate', tags: ['ocp', 'strategy'],
  q: r`Strategy vs if/else chains: when is replacing conditionals with polymorphism the right call?`,
  a: r`Replace conditionals with strategies when:

- The **same branching** appears in several places (shotgun surgery on every new case).
- Branches contain **substantial, independently testable logic**.
- New cases are **expected** and should be addable without touching others (OCP), possibly by different teams.
- Selection depends on runtime data (country, product, tenant).

Keep the conditional when:

- The set of cases is **closed and stable** and appears in one place.
- Each branch is a line or two.
- Pattern matching over records expresses it clearly (closed sum types).

Also consider **data-driven rules**: if cases differ only by parameters (rates, thresholds), a table beats both conditionals and classes, and business users can change it with an audit trail.`,
  code: r`~~~csharp
// Strategy selected per country, each independently tested
public interface ITaxStrategy { string Country { get; } Money Tax(Invoice i); }
public sealed class UkVat : ITaxStrategy { public string Country => "GB"; public Money Tax(Invoice i) => i.Net * 0.20m; }
public sealed class UsSalesTax(IUsTaxRates rates) : ITaxStrategy
{ public string Country => "US"; public Money Tax(Invoice i) => i.Net * rates.For(i.ShipTo.State); }

// Data-driven when only parameters differ
public sealed record ShippingRate(string Zone, decimal Base, decimal PerKg);
public static decimal Shipping(IReadOnlyDictionary<string, ShippingRate> table, string zone, decimal kg) =>
    table[zone].Base + table[zone].PerKg * kg;

// Closed, stable set: pattern matching is fine
static string Label(PaymentStatus s) => s switch { PaymentStatus.Paid => "Paid", PaymentStatus.Failed => "Failed", _ => "Pending" };
~~~`,
  pts: [r`Use strategies when the same branching repeats or cases keep growing.`, r`Keep a switch for small, closed, single-location decisions.`, r`Prefer data-driven tables when cases differ only by parameters.`, r`Strategies make each case independently testable and ownable.`, r`Pattern matching suits closed sets of records.`],
  ex: r`Tax logic for 9 countries moved from a 600-line switch repeated in invoicing and quoting to strategies; adding Canada touched one new class and its tests.`,
  fu: [r`How do you select the strategy at runtime safely?`],
  pit: [r`Strategies for two-line branches that never change.`] },

{ id: 'q15', level: 'Intermediate', tags: ['lsp', 'testing'],
  q: r`How do you use contract tests to enforce LSP across multiple implementations of an interface?`,
  a: r`Write an **abstract test class** that specifies the behaviour every implementation must satisfy, with an abstract factory method. Each implementation gets a tiny subclass that supplies its instance. The same tests run against every implementation, including fakes used in other tests.

This catches:

- Implementations that throw where the contract says they should return empty.
- Ordering, paging or null-handling differences.
- Fakes that behave unlike the real thing (a classic source of green tests and red production).

Apply it to repositories (in-memory fake vs EF vs Dapper), payment provider adapters, cache implementations and message transports.`,
  code: r`~~~csharp
public abstract class OrderStoreContract
{
    protected abstract IOrderStore CreateStore();

    [Fact] public async Task Get_unknown_returns_null() => (await CreateStore().GetAsync(Guid.NewGuid(), default)).Should().BeNull();

    [Fact] public async Task Saved_order_round_trips()
    {
        var store = CreateStore(); var o = OrderFixtures.WithTwoLines();
        await store.SaveAsync(o, default);
        (await store.GetAsync(o.Id, default)).Should().BeEquivalentTo(o);
    }
    [Fact] public async Task List_is_newest_first()
    {
        var store = CreateStore(); await OrderFixtures.SeedThreeAsync(store);
        (await store.ListByCustomerAsync(OrderFixtures.Customer, default)).Select(x => x.CreatedAt).Should().BeInDescendingOrder();
    }
}
public sealed class InMemoryOrderStoreTests : OrderStoreContract { protected override IOrderStore CreateStore() => new InMemoryOrderStore(); }
public sealed class EfOrderStoreTests(SqlFixture db) : OrderStoreContract, IClassFixture<SqlFixture>
{ protected override IOrderStore CreateStore() => new EfOrderStore(db.CreateContext()); }
~~~`,
  pts: [r`An abstract test class defines the behaviour every implementation must meet.`, r`Each implementation (including fakes) runs the same tests.`, r`It catches null-handling, ordering and error-behaviour differences.`, r`Keeps fakes honest, so unit tests stay meaningful.`, r`Use it for repositories, provider adapters and transports.`],
  ex: r`Contract tests revealed the in-memory fake returned orders oldest-first while SQL returned newest-first; three UI tests had been passing for the wrong reason.`,
  fu: [r`How do you run contract tests against a third-party sandbox?`],
  pit: [r`Fakes with no tests of their own.`] },

{ id: 'q16', level: 'Intermediate', tags: ['dip', 'ownership'],
  q: r`Who should own an interface: the consumer or the provider? Explain with packages and microservices.`,
  a: r`DIP says the **consumer (higher-level policy)** owns the abstraction, because the abstraction expresses what the consumer needs. If the provider defines it, the consumer is coupled to the provider's view of the world and its release cycle.

Inside a solution: the application layer defines {{IPaymentGateway}}; the Stripe adapter implements it.

Across teams it depends on direction and audience:

- A **library/SDK** published for many consumers defines its own public API (provider-owned), but each consumer should still wrap it behind its own port if the dependency is volatile.
- Between **microservices**, the provider publishes a contract (OpenAPI, event schema); consumers build an **anti-corruption layer** that maps it to their own model, so provider changes stay at the edge.
- **Consumer-driven contract tests** (Pact) let consumers state which parts of the provider contract they rely on.`,
  code: r`~~~csharp
// Consumer-owned port in the Checkout application layer
namespace Checkout.Application;
public interface IFraudCheck { Task<FraudDecision> AssessAsync(CheckoutAttempt attempt, CancellationToken ct); }
public enum FraudDecision { Allow, Review, Block }

// Adapter maps the vendor's model (provider-owned SDK) into the consumer's port: anti-corruption layer
namespace Checkout.Infrastructure;
public sealed class VendorFraudCheck(VendorClient client) : Checkout.Application.IFraudCheck
{
    public async Task<Checkout.Application.FraudDecision> AssessAsync(CheckoutAttempt a, CancellationToken ct)
    {
        var score = await client.ScoreAsync(new VendorRequest { Amount = a.Amount, Ip = a.Ip, CardBin = a.Bin }, ct);
        return score.RiskScore switch { < 30 => Checkout.Application.FraudDecision.Allow, < 70 => Checkout.Application.FraudDecision.Review, _ => Checkout.Application.FraudDecision.Block };
    }
}
~~~`,
  pts: [r`The consumer owns the abstraction it depends on.`, r`Provider-owned interfaces couple consumers to provider release cycles.`, r`Wrap volatile third-party SDKs behind your own port.`, r`Across services, map provider contracts in an anti-corruption layer.`, r`Consumer-driven contract tests make reliance explicit.`],
  ex: r`Swapping fraud vendors took two weeks instead of a quarter because only the adapter referenced the old vendor SDK.`,
  fu: [r`Where does the shared "Contracts" package fit?`],
  pit: [r`Shared interface libraries owned by the provider team and used everywhere.`] },

{ id: 'q17', level: 'Intermediate', tags: ['srp', 'frontend'],
  q: r`Apply SOLID to an Angular or React front end. What do SRP and DIP look like in components?`,
  a: r`- **SRP**: separate **presentational components** (render props/inputs, emit events) from **container/smart components** (fetch data, manage state). Business rules (pricing, validation) live in plain TypeScript modules, not in components.
- **OCP**: compose UI via slots/children ({{ng-content}}, React children/render props) instead of adding flags to a component for each new case.
- **LSP**: components accepting the same props interface should behave consistently (a custom input should honour value/onChange like a native one).
- **ISP**: small prop interfaces; avoid passing whole domain objects when a component needs two fields.
- **DIP**: depend on abstractions for data access: Angular injection tokens / abstract classes for API services; React context providers or hooks wrapping an API client, so tests and storybooks can swap implementations.`,
  code: r`~~~typescript
// Angular: component depends on an abstraction provided via DI
export abstract class OrdersApi { abstract list(customerId: string): Observable<OrderSummary[]>; }
@Injectable() export class HttpOrdersApi extends OrdersApi {
  constructor(private http: HttpClient) { super(); }
  list(id: string) { return this.http.get<OrderSummary[]>('/api/customers/' + id + '/orders'); }
}
@Component({ selector: 'app-orders', template: '<app-order-table [orders]="orders()" (select)="open($event)"/>' })
export class OrdersContainer {
  private api = inject(OrdersApi);
  orders = toSignal(this.api.list('42'), { initialValue: [] });
  open(o: OrderSummary) { /* navigate */ }
}
// providers: [{ provide: OrdersApi, useClass: HttpOrdersApi }]   tests: useValue: fakeOrdersApi

// React: presentational component with a narrow props interface
type Props = { orders: { id: string; total: number }[]; onSelect: (id: string) => void };
export function OrderTable({ orders, onSelect }: Props) {
  return <table><tbody>{orders.map(o => <tr key={o.id} onClick={() => onSelect(o.id)}><td>{o.id}</td><td>{o.total}</td></tr>)}</tbody></table>;
}
~~~`,
  pts: [r`Split presentational components from data/state containers.`, r`Keep business rules in plain TypeScript modules.`, r`Compose with slots/children instead of adding flags (OCP).`, r`Narrow prop and input interfaces (ISP).`, r`Inject API abstractions via DI tokens or context so tests and stories can swap them (DIP).`],
  ex: r`Moving checkout pricing rules out of three React components into a shared module removed a bug where the cart and checkout showed different totals.`,
  fu: [r`How do signals or hooks change state-management design?`],
  pit: [r`Components with 15 boolean props for variants.`] },

{ id: 'q18', level: 'Intermediate', tags: ['ocp', 'pipelines'],
  q: r`How do ASP.NET Core middleware and endpoint filters embody OCP? When would you use each?`,
  a: r`The request pipeline is open for extension: you add behaviour by inserting middleware or filters, without editing endpoints or the framework.

- **Middleware**: applies to every request in order; knows only {{HttpContext}}. Use for cross-cutting HTTP concerns: exception handling, correlation ids, security headers, request logging, tenant resolution.
- **Endpoint filters** (minimal APIs) and **MVC filters**: run around specific endpoints with access to arguments and results. Use for validation, idempotency checks, auditing of specific operations.
- **Pipeline behaviours** (MediatR or your own decorators): around application handlers, independent of HTTP (also run from message consumers).

Choose the narrowest scope that covers the concern, and keep each extension single-purpose. Order is part of correctness (authentication before authorisation, exception handling outermost).`,
  code: r`~~~csharp
// Middleware: every request
public sealed class CorrelationIdMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext ctx)
    {
        var id = ctx.Request.Headers["X-Correlation-Id"].FirstOrDefault() ?? Guid.NewGuid().ToString("N");
        ctx.Response.Headers["X-Correlation-Id"] = id;
        using (ctx.RequestServices.GetRequiredService<ILogger<CorrelationIdMiddleware>>().BeginScope(new Dictionary<string, object> { ["CorrelationId"] = id }))
            await next(ctx);
    }
}
app.UseMiddleware<CorrelationIdMiddleware>();

// Endpoint filter: only these endpoints, with access to arguments
public sealed class IdempotencyFilter(IIdempotencyStore store) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var key = ctx.HttpContext.Request.Headers["Idempotency-Key"].ToString();
        if (string.IsNullOrEmpty(key)) return Results.Problem(statusCode: 400, title: "Idempotency-Key required");
        return await store.GetAsync(key) is { } cached ? cached : await store.SaveAsync(key, await next(ctx));
    }
}
app.MapGroup("/payments").AddEndpointFilter<IdempotencyFilter>();
~~~`,
  pts: [r`The pipeline is extended by adding middleware or filters, not editing endpoints.`, r`Middleware for every-request HTTP concerns.`, r`Endpoint/MVC filters for endpoint-specific behaviour with access to arguments.`, r`Handler behaviours for concerns shared with message consumers.`, r`Order is part of correctness.`],
  ex: r`Idempotency for 12 payment endpoints was added as one endpoint filter on a route group, with no changes to the endpoints themselves.`,
  fu: [r`Where would you put tenant resolution and why?`],
  pit: [r`Putting endpoint-specific logic in global middleware with path checks.`] },

{ id: 'q19', level: 'Senior', tags: ['srp', 'microservices'],
  q: r`How does SRP translate to service boundaries? How do you decide whether two capabilities belong in one service?`,
  a: r`At service level, SRP becomes **one business capability, owned by one team, changing for one set of stakeholders**. Signals that two capabilities belong together:

- They change together in most features (high change coupling).
- They share invariants that must hold transactionally (a single aggregate).
- They are owned by the same team and released together anyway.

Signals to separate:

- Different stakeholders and change cadences (pricing rules vs fulfilment logistics).
- Different scaling, availability or compliance needs (card data in PCI scope vs product catalogue).
- Different data ownership with only eventual-consistency needs between them.

Splitting by technical layer ("validation service", "database service") violates service-level SRP: every feature then changes several services. Use domain-driven bounded contexts and Conway's law (team boundaries) as the primary guide.`,
  code: r`~~~text
Capability pair                    Change together?   Shared invariant?   Same team?   Decision
Pricing + Promotions               often              price must apply    yes          one service (modules)
Orders + Payments                  rarely             saga is enough      no           separate services
Card vault + Payments              rarely             PCI scope           no           separate (shrink PCI scope)
"Validation service" for everyone  every feature      no                  no           anti-pattern: merge back
~~~`,
  pts: [r`Service-level SRP: one capability, one team, one set of stakeholders.`, r`Merge capabilities that change together or share transactional invariants.`, r`Separate those with different stakeholders, cadences, scaling or compliance scope.`, r`Never split by technical layer.`, r`Use bounded contexts and team boundaries as the guide.`],
  ex: r`A team merged a "Promotions" service back into "Pricing" after 80% of features touched both; release coordination disappeared.`,
  fu: [r`How do you measure change coupling across repositories?`],
  pit: [r`Entity services (CustomerService, OrderService) that every feature must change.`] },

{ id: 'q20', level: 'Senior', tags: ['lsp', 'api-versioning'],
  q: r`How does LSP apply to API versioning and backward compatibility?`,
  a: r`Think of a new API version, or a new deployment of the same version, as a **subtype** of the old one from the client's point of view. Existing clients must keep working: the new behaviour must accept everything the old one accepted (no stronger preconditions) and return at least what it promised (no weaker postconditions).

Compatible (substitutable) changes:

- Adding optional request fields; adding response fields; adding endpoints; adding enum values **only if** clients were told to tolerate unknown values.
- Relaxing validation.

Breaking (LSP-violating) changes:

- Making an optional field required; tightening validation (string length 100 to 50).
- Removing or renaming fields; changing types or units; changing semantics (amount in pounds to pence).
- New error codes for previously successful requests.

Enforce with OpenAPI diff tools in CI, consumer-driven contract tests, and deprecation with Sunset headers before removal.`,
  code: r`~~~yaml
# CI gate: block breaking changes to the published contract
- name: OpenAPI breaking-change check
  run: npx oasdiff@1.10.0 breaking openapi/published.json openapi/candidate.json --fail-on ERR
~~~
~~~csharp
// Compatible: new optional field with a default that preserves old behaviour
public sealed record CreatePayment(decimal Amount, string Currency, string? Reference = null, bool Instant = false);
// Breaking: tightening a precondition old clients already rely on
// [MaxLength(50)] public string Reference   // was 100 -> existing clients start failing with 400
~~~`,
  pts: [r`Treat each new version as a subtype that old clients must be able to use.`, r`No stronger preconditions: do not tighten validation or require new fields.`, r`No weaker postconditions: do not remove fields or change semantics or units.`, r`Additive, optional changes are compatible.`, r`Enforce with OpenAPI diff in CI and consumer contract tests.`],
  ex: r`Tightening a payment reference length from 140 to 35 characters to match a new rail broke a partner's batch uploads; the fix was to truncate at the rail adapter and keep the API contract.`,
  fu: [r`Is adding an enum value a breaking change?`],
  pit: [r`Treating validation tightening as a non-breaking "bug fix".`] },

{ id: 'q21', level: 'Senior', tags: ['dip', 'hexagonal'],
  q: r`Explain ports and adapters as DIP applied to architecture. What goes in a port, and what must not?`,
  a: r`Hexagonal architecture puts the application core at the centre with **ports**: interfaces describing what the core needs (driven ports: repositories, payment gateways, clocks) and what it offers (driving ports: use-case interfaces called by HTTP, CLI, message consumers). **Adapters** implement or call those ports at the edges.

What belongs in a port:

- Domain language types (Order, Money, CustomerId), not transport or vendor types.
- Operations phrased as the core's needs ({{ReserveStock}}, {{AuthorisePayment}}), not vendor API shapes.
- Error outcomes the core can act on (declined, unavailable), mapped from vendor errors in the adapter.

What must not leak:

- {{HttpResponseMessage}}, EF {{IQueryable}}, Azure/AWS SDK types, vendor DTOs, SQL exceptions.
- Generic CRUD that mirrors tables rather than use cases.

Benefits: swap infrastructure, test the core in isolation, and keep vendor churn at the edge.`,
  code: r`~~~csharp
// Driven port, in domain language with actionable outcomes
public interface IPaymentGateway
{
    Task<AuthorisationResult> AuthoriseAsync(PaymentId id, Money amount, CardToken token, CancellationToken ct);
}
public abstract record AuthorisationResult
{
    public sealed record Approved(string Reference) : AuthorisationResult;
    public sealed record Declined(string Reason) : AuthorisationResult;
    public sealed record Unavailable : AuthorisationResult;      // core decides: retry later, try another provider
}
// Adapter translates vendor types and errors at the edge
public sealed class StripeGateway(Stripe.PaymentIntentService intents) : IPaymentGateway
{
    public async Task<AuthorisationResult> AuthoriseAsync(PaymentId id, Money amount, CardToken token, CancellationToken ct)
    {
        try
        {
            var pi = await intents.CreateAsync(new() { Amount = amount.ToMinorUnits(), Currency = amount.Currency.ToLowerInvariant(),
                PaymentMethod = token.Value, Confirm = true, CaptureMethod = "manual" },
                new Stripe.RequestOptions { IdempotencyKey = id.ToString() }, ct);
            return pi.Status == "requires_capture" ? new AuthorisationResult.Approved(pi.Id) : new AuthorisationResult.Declined(pi.Status);
        }
        catch (Stripe.StripeException e) when (e.StripeError?.Type == "card_error") { return new AuthorisationResult.Declined(e.StripeError.Code); }
        catch (HttpRequestException) { return new AuthorisationResult.Unavailable(); }
    }
}
~~~`,
  dia: r`flowchart LR
  HTTP[HTTP endpoint adapter] --> UC[Use cases: driving ports]
  MQ[Message consumer adapter] --> UC
  UC --> CORE[Domain core]
  UC --> PG[Driven port: IPaymentGateway]
  UC --> RP[Driven port: IOrderRepository]
  PG -.implemented by.-> ST[Stripe adapter]
  RP -.implemented by.-> EF[EF Core adapter]`,
  pts: [r`Ports are core-owned interfaces; adapters implement or call them at the edge.`, r`Ports use domain language and actionable outcomes.`, r`Vendor types, IQueryable, HTTP and SDK exceptions must not leak into ports.`, r`Adapters translate errors into outcomes the core can act on.`, r`The payoff: swappable infrastructure and core tests without I/O.`],
  ex: r`Adding a second acquirer for failover was an adapter plus a routing rule, because the core only knew Approved, Declined and Unavailable.`,
  fu: [r`Driving vs driven ports?`, r`How thick should an adapter be?`],
  pit: [r`Ports returning vendor DTOs.`, r`Generic IRepository<T> with IQueryable as the "port".`] },

{ id: 'q22', level: 'Senior', tags: ['ocp', 'plugins'],
  q: r`Design a rules engine that business teams can extend (new eligibility rules) without redeploying the core. What are the trade-offs?`,
  a: r`Spectrum from least to most dynamic:

1. **Compiled strategies** discovered via DI: new rule = new class + deploy. Safest, fully testable, but needs a release.
2. **Configuration-driven rules**: rules expressed as data (thresholds, lists, combinations) in a database with versioning and approval. No deploy for parameter changes.
3. **Expression-based rules**: a constrained DSL or expression language (JSON rules, CEL, Microsoft RulesEngine with lambda expressions) evaluated at runtime.
4. **Plugins** loaded at runtime ({{AssemblyLoadContext}}): maximum flexibility, maximum risk.

Principal concerns:

- **Governance**: who can change rules, four-eyes approval, versioning, audit of which rule version decided each case (regulators ask).
- **Testing**: rule changes need test suites and simulation against historical data before activation.
- **Performance and safety**: sandboxing, timeouts, no arbitrary I/O in rules.
- **Explainability**: every decision records which rules fired.

Most organisations land on 1 + 2: code for logic, data for parameters.`,
  code: r`~~~csharp
public interface IEligibilityRule { string Id { get; } RuleOutcome Evaluate(Applicant a, RuleParameters p); }
public sealed record RuleOutcome(string RuleId, bool Passed, string Reason);
public sealed class MinIncomeRule : IEligibilityRule
{
    public string Id => "min-income";
    public RuleOutcome Evaluate(Applicant a, RuleParameters p) =>
        new(Id, a.AnnualIncome >= p.Decimal("minIncome"), "Income " + a.AnnualIncome + " vs " + p.Decimal("minIncome"));
}
public sealed class EligibilityEngine(IEnumerable<IEligibilityRule> rules, IRuleParameterStore store)
{
    public async Task<Decision> DecideAsync(Applicant a, string product, CancellationToken ct)
    {
        var set = await store.ActiveSetAsync(product, ct);                 // versioned, approved parameters
        var outcomes = rules.Where(r => set.Enabled(r.Id)).Select(r => r.Evaluate(a, set.For(r.Id))).ToList();
        return new Decision(outcomes.All(o => o.Passed), set.Version, outcomes);   // explainable + auditable
    }
}
~~~`,
  pts: [r`Range: compiled strategies, data-driven parameters, expression DSLs, runtime plugins.`, r`Most teams use code for logic and versioned data for parameters.`, r`Governance: approvals, versioning and audit of which rule version decided each case.`, r`Simulate rule changes against historical data before activation.`, r`Record which rules fired for explainability.`],
  ex: r`A lender moved credit thresholds into a versioned rule-parameter store with four-eyes approval; risk teams changed cut-offs weekly without releases, and every decision logged the parameter version.`,
  fu: [r`How would you backtest a rule change?`, r`When would you allow runtime-loaded plugins?`],
  pit: [r`Arbitrary code in rules editable from an admin UI without review.`] },

{ id: 'q23', level: 'Senior', tags: ['solid', 'code-review'],
  q: r`Code review: identify SOLID violations in this class and propose a design.`,
  a: r`~~~csharp
public class ReportService
{
    public byte[] Generate(string type, DateTime from, DateTime to, string format, bool email, string to2)
    {
        var conn = new SqlConnection(ConfigurationManager.ConnectionStrings["db"].ConnectionString);
        var rows = new SqlCommand("SELECT * FROM Sales WHERE Date BETWEEN '" + from + "' AND '" + to + "'", conn).ExecuteReader();
        byte[] output;
        if (format == "pdf") output = PdfLib.Render(rows);
        else if (format == "csv") output = CsvLib.Write(rows);
        else throw new NotSupportedException();
        if (type == "monthly") output = AddMonthlyTotals(output);
        if (email) new SmtpClient("smtp").Send(new MailMessage("r@x.com", to2, "Report", "") { Attachments = { new Attachment(new MemoryStream(output), "r." + format) } });
        return output;
    }
}
~~~

- **SRP**: data access, formatting, report business rules and email delivery in one method; four actors.
- **OCP**: every new format or report type edits the if/else chains.
- **ISP/clean parameters**: a flag argument ({{email}}) and an unrelated recipient parameter; callers that never email must pass both.
- **DIP**: news up {{SqlConnection}}, {{SmtpClient}}, static config: untestable, hard-wired.
- Plus non-SOLID defects: SQL injection, connection never disposed, {{SELECT *}}, DateTime culture formatting in SQL, synchronous I/O.

Proposed design: {{ISalesQuery}} (parameterised, async), {{IReportBuilder}} per report type, {{IReportFormatter}} per format (keyed DI), {{IReportDelivery}} (email, blob, SFTP) invoked by an application service or a separate step.`,
  code: r`~~~csharp
public interface ISalesQuery { IAsyncEnumerable<SaleRow> RangeAsync(DateOnly from, DateOnly to, CancellationToken ct); }
public interface IReportBuilder { string Type { get; } Task<Report> BuildAsync(DateOnly from, DateOnly to, CancellationToken ct); }
public interface IReportFormatter { string Format { get; } byte[] Render(Report report); }
public interface IReportDelivery { Task DeliverAsync(byte[] file, string fileName, DeliveryTarget target, CancellationToken ct); }

public sealed class GenerateReportHandler(IEnumerable<IReportBuilder> builders, IEnumerable<IReportFormatter> formatters, IReportDelivery delivery)
{
    public async Task<byte[]> HandleAsync(GenerateReport cmd, CancellationToken ct)
    {
        var report = await builders.Single(b => b.Type == cmd.Type).BuildAsync(cmd.From, cmd.To, ct);
        var file = formatters.Single(f => f.Format == cmd.Format).Render(report);
        if (cmd.Delivery is { } target) await delivery.DeliverAsync(file, cmd.Type + "." + cmd.Format, target, ct);
        return file;
    }
}
~~~`,
  pts: [r`SRP: query, formatting, report rules and delivery are four reasons to change.`, r`OCP: if/else chains on format and type must be edited for each new case.`, r`ISP: flag arguments and unrelated parameters burden every caller.`, r`DIP: newing SqlConnection and SmtpClient makes it untestable.`, r`Also flag SQL injection, undisposed connections and sync I/O, ordered by severity.`],
  ex: r`A refactor along these lines let the team add an XLSX format and SFTP delivery for a regulator in two small PRs.`,
  fu: [r`How would you make report generation asynchronous for large ranges?`],
  pit: [r`Listing principle names without proposing a concrete design.`, r`Missing the SQL injection while discussing SOLID.`],
  tip: r`Order review findings by severity: security and correctness before design principles.` },

{ id: 'q24', level: 'Senior', tags: ['solid', 'over-engineering'],
  q: r`Give an example where applying SOLID made code worse. How do you recognise over-engineering?`,
  a: r`Common examples:

- **Interface for every class** with a single implementation and no boundary: navigation doubles, nothing gains.
- **Generic repositories** over EF Core ({{IRepository<T>}} with {{IQueryable}}): an abstraction that leaks the ORM anyway and hides useful EF features.
- **Strategy and factory layers** for one algorithm "in case we need another".
- **Micro-classes**: a 40-line feature split into 9 classes across 5 folders.
- **Deep inheritance for OCP**: base classes with template methods that every subclass partly overrides.

Recognise it by:

- Abstractions with exactly one implementation and no test or boundary reason.
- Changes that touch many files for one small behaviour.
- New team members needing a walkthrough to follow a simple request.
- Speculative names ("Provider", "Factory", "Manager") without variation.

Principle: **YAGNI and the rule of three**. Introduce abstractions at boundaries and on proven variation; inline the rest.`,
  code: r`~~~csharp
// Over-engineered: 5 types to add VAT
public interface ITaxCalculatorFactory { ITaxCalculator Create(); }
public interface ITaxCalculator { decimal Calculate(decimal net); }
public sealed class TaxCalculatorFactory : ITaxCalculatorFactory { public ITaxCalculator Create() => new UkVatCalculator(); }
public sealed class UkVatCalculator : ITaxCalculator { public decimal Calculate(decimal net) => net * 0.2m; }
// + DI registrations + mocks in every test

// Enough today: a pure function; extract an interface when the second country arrives
public static class Vat { public static decimal Uk(decimal net) => decimal.Round(net * 0.20m, 2); }
~~~`,
  pts: [r`Single-implementation interfaces without a boundary reason add cost, not value.`, r`Generic repositories over EF Core usually leak and hide features.`, r`Speculative strategies and factories are YAGNI violations.`, r`Symptoms: many files per small change, hard-to-follow request paths.`, r`Abstract on proven variation or at real boundaries (rule of three).`],
  ex: r`A team deleted a generic repository layer and used EF Core directly in query handlers; code shrank by 30% and query performance improved because projections were no longer blocked by the abstraction.`,
  fu: [r`How do you convince a team to remove abstractions?`],
  pit: [r`Defending every abstraction as "SOLID".`] },

{ id: 'q25', level: 'Senior', tags: ['dip', 'di-container'],
  q: r`What design problems does a DI container hide, and how do you keep the composition root healthy?`,
  a: r`A container makes it cheap to add dependencies, which hides design problems:

- **Constructor over-injection** (8+ parameters): the class has too many responsibilities.
- **Captive dependencies**: singletons holding scoped services (DbContext) leading to concurrency bugs.
- **Service locator**: injecting {{IServiceProvider}} and resolving inside business code, hiding real dependencies.
- **Registration sprawl**: hundreds of {{AddScoped}} calls nobody understands; assembly scanning that registers more than intended.
- **Runtime failures** for missing registrations discovered in production.

Healthy composition root:

- Module registration extension methods ({{services.AddBilling()}}) owned by each module.
- {{ValidateOnBuild}} and {{ValidateScopes}} in all environments, plus a test that builds the provider.
- Explicit lifetimes with comments for singletons holding state.
- Keyed services ({{AddKeyedSingleton}}) instead of string-switch factories.
- Analysers or reviews flagging {{IServiceProvider}} injection outside infrastructure.`,
  code: r`~~~csharp
public static class BillingModule
{
    public static IServiceCollection AddBilling(this IServiceCollection s, IConfiguration cfg)
    {
        s.AddOptions<BillingOptions>().Bind(cfg.GetSection("Billing")).ValidateOnStart();
        s.AddScoped<IInvoiceStore, EfInvoiceStore>();
        s.AddKeyedSingleton<IInvoiceRenderer, PdfRenderer>("pdf");
        s.AddKeyedSingleton<IInvoiceRenderer, UblRenderer>("ubl");
        return s;
    }
}
builder.Host.UseDefaultServiceProvider(o => { o.ValidateOnBuild = true; o.ValidateScopes = true; });

[Fact] public void Container_builds() =>
    new WebApplicationFactory<Program>().Services.Should().NotBeNull();   // fails on missing or captive registrations
~~~`,
  pts: [r`Containers hide over-injection, captive dependencies and service locators.`, r`Many constructor parameters signal an SRP problem.`, r`Validate scopes and the whole graph at build time, in tests too.`, r`Group registrations per module with extension methods.`, r`Use keyed services instead of string-switch factories.`],
  ex: r`ValidateOnBuild in CI caught a singleton cache depending on a scoped DbContext that had caused intermittent "second operation started" errors in production.`,
  fu: [r`When is a third-party container (Autofac) worth it?`],
  pit: [r`Resolving from IServiceProvider in domain services.`] },

{ id: 'q26', level: 'Senior', tags: ['isp', 'cqrs'],
  q: r`How do ISP and SRP lead naturally to CQRS? When is that a good idea?`,
  a: r`Readers and writers of the same data have different needs:

- **Writers** need invariants, validation, aggregates, transactions.
- **Readers** need fast, denormalised, consumer-shaped data, paging and search.

ISP says do not force readers to depend on write methods; SRP says the two change for different reasons (UI needs vs business rules). Splitting command and query models is the natural result: **CQRS** in its simple form (separate handlers and DTOs over one database) is cheap and common.

Full CQRS with separate read stores fed by events adds eventual consistency, projections and replay concerns. Use it when:

- Read and write loads differ by orders of magnitude.
- Read shapes are very different from the write model (search, dashboards).
- Different teams own reading and writing.

Do not use it for simple CRUD.`,
  code: r`~~~csharp
// Command side: aggregate + invariants
public sealed record ApproveLoan(Guid LoanId, string ApprovedBy);
public sealed class ApproveLoanHandler(ILoanRepository loans, IUnitOfWork uow)
{
    public async Task HandleAsync(ApproveLoan cmd, CancellationToken ct)
    {
        var loan = await loans.GetAsync(cmd.LoanId, ct);
        loan.Approve(cmd.ApprovedBy);           // rules
        await uow.CommitAsync(ct);
    }
}
// Query side: thin projection straight to the DTO the screen needs
public sealed class LoanQueueQuery(AppReadDb db)
{
    public Task<List<LoanQueueItem>> PendingAsync(int page, CancellationToken ct) =>
        db.Loans.AsNoTracking().Where(l => l.Status == "PendingApproval")
          .OrderBy(l => l.SubmittedAt).Skip(page * 50).Take(50)
          .Select(l => new LoanQueueItem(l.Id, l.ApplicantName, l.Amount, l.SubmittedAt)).ToListAsync(ct);
}
~~~`,
  pts: [r`Readers and writers have different needs and change for different reasons.`, r`ISP plus SRP leads to separate command and query models.`, r`Simple CQRS (separate handlers over one database) is cheap and common.`, r`Separate read stores add eventual consistency and projections.`, r`Use full CQRS only for very different load or shape needs.`],
  ex: r`A loan-origination system used simple CQRS: command handlers on aggregates and Dapper query handlers for 30 dashboard views, with no separate read store needed.`,
  fu: [r`How do you handle read-your-writes with a separate read store?`],
  pit: [r`Event-sourced CQRS for a simple admin CRUD app.`] },

{ id: 'q27', level: 'Senior', tags: ['ocp', 'feature-flags'],
  q: r`Feature flags as an OCP mechanism: how do you avoid flag debt and if/else sprawl?`,
  a: r`Feature flags let you **extend behaviour at runtime** (release toggles, experiments, ops kill switches) without redeploying. Used naively, they reintroduce the conditionals OCP tries to remove and create combinatorial test explosions.

Practices:

- **Branch at one point**: resolve the flag once at the composition or entry point and select a strategy, rather than sprinkling {{if (flag)}} through the code.
- **Classify flags** (release, experiment, ops, permission) with owners and **expiry dates**; release flags removed within weeks.
- **Default-safe values** when the flag service is unavailable.
- **Test both paths** while a flag lives; remove the dead path when it is retired.
- **Audit** flag changes in production (who changed what, when): regulators and incident reviews need it.`,
  code: r`~~~csharp
// Resolve the flag once and choose an implementation
builder.Services.AddScoped<IPricingEngine>(sp =>
    sp.GetRequiredService<IVariantFeatureManagerSnapshot>().IsEnabledAsync("NewPricingEngine").AsTask().GetAwaiter().GetResult()
        ? sp.GetRequiredService<PricingEngineV2>()
        : sp.GetRequiredService<PricingEngineV1>());
// Better in async flows: a small router that selects per request
public sealed class PricingRouter(IVariantFeatureManager flags, PricingEngineV1 v1, PricingEngineV2 v2) : IPricingEngine
{
    public async Task<Quote> QuoteAsync(Cart c, CancellationToken ct) =>
        await (await flags.IsEnabledAsync("NewPricingEngine", ct) ? v2 : v1).QuoteAsync(c, ct);
}
~~~
~~~text
Flag register (excerpt)
NewPricingEngine   release   owner: pricing-team   created 2026-09-01   remove by 2026-11-01
KillSwitchFxFeed   ops       owner: platform       permanent, default OFF on error
~~~`,
  pts: [r`Flags extend behaviour at runtime, but scattered ifs undo OCP.`, r`Branch once at an entry point and select a strategy.`, r`Classify flags with owners and expiry dates; delete release flags quickly.`, r`Safe defaults when the flag service is down.`, r`Audit flag changes in production.`],
  ex: r`A flag register with expiry dates and a CI warning cut live flags from 340 to 60 in two quarters and removed a class of "two flags interacting" incidents.`,
  fu: [r`How do you test combinations of flags?`],
  pit: [r`Flags that live for years with both code paths untested.`] },

{ id: 'q28', level: 'Senior', tags: ['lsp', 'mocks'],
  q: r`How can mocks violate LSP and give you false confidence? What do you do instead?`,
  a: r`A mock is a substitute implementation. If it does not behave like the real dependency, tests verify code against an **imaginary contract**:

- The real repository throws on duplicate keys; the mock silently accepts.
- The real API pages results; the mock returns everything.
- The real clock moves; the mock returns a constant and hides date bugs.
- Mocks configured with {{It.IsAny}} accept calls the real dependency would reject.

Remedies:

- Prefer **fakes** (simple working implementations) over interaction mocks for collaborators with behaviour.
- Run **contract tests** against both the fake and the real implementation (see LSP contract tests).
- Use real dependencies where cheap: Testcontainers for databases and brokers, WireMock with recorded responses for HTTP.
- Reserve mocks for verifying **side effects at boundaries** (an email was sent, an event published).`,
  code: r`~~~csharp
// Mock that lies: accepts duplicates the real store rejects
var repo = new Mock<ICustomerStore>();
repo.Setup(r => r.AddAsync(It.IsAny<Customer>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

// Fake that behaves like the real thing, verified by the same contract tests as the SQL store
public sealed class InMemoryCustomerStore : ICustomerStore
{
    private readonly ConcurrentDictionary<string, Customer> _byEmail = new(StringComparer.OrdinalIgnoreCase);
    public Task AddAsync(Customer c, CancellationToken ct) =>
        _byEmail.TryAdd(c.Email, c) ? Task.CompletedTask : throw new DuplicateCustomerException(c.Email);
}
~~~`,
  pts: [r`A mock that behaves unlike the real dependency tests an imaginary contract.`, r`Prefer fakes for collaborators with behaviour.`, r`Run contract tests against fakes and real implementations.`, r`Use Testcontainers and WireMock where cheap.`, r`Keep mocks for verifying boundary side effects.`],
  ex: r`A signup flow passed every unit test with a mocked store but failed in production on duplicate emails; a fake verified by contract tests reproduced the bug immediately.`,
  fu: [r`What is the testing pyramid's role here?`],
  pit: [r`Over-specified mocks that break on every refactor.`] },

{ id: 'q29', level: 'Senior', tags: ['srp', 'events'],
  q: r`Use domain events to keep aggregates single-responsibility. How do you prevent event handlers becoming hidden coupling?`,
  a: r`Without events, an {{Order.Place()}} method or its handler accumulates side effects: loyalty points, emails, analytics, inventory. Each new stakeholder adds a line, violating SRP and OCP. Raising {{OrderPlaced}} and letting independent handlers react keeps the aggregate focused on its invariants.

Hidden-coupling risks and mitigations:

- **Invisible flow**: nobody knows what happens when an order is placed. Document handlers (generated list per event), trace them in telemetry.
- **Transactional surprises**: in-process handlers running inside the same transaction can fail the original operation; decide per handler whether it is part of the consistency boundary (same transaction) or a reaction (outbox, after commit).
- **Ordering dependencies** between handlers: if handler B depends on A's result, it is a workflow, make it explicit (saga/orchestration).
- **Event payload coupling**: handlers relying on internal entity shape; publish dedicated event records.`,
  code: r`~~~csharp
public sealed class Order : AggregateRoot
{
    public void Place()
    {
        if (Lines.Count == 0) throw new DomainException("Empty order");
        Status = OrderStatus.Placed;
        Raise(new OrderPlaced(Id, CustomerId, Total));          // the aggregate knows nothing about loyalty or email
    }
}
// Reactions, each owned and tested independently, dispatched after commit via the outbox
public sealed class AwardLoyaltyPoints(ILoyaltyService loyalty) : IDomainEventHandler<OrderPlaced>
{ public Task HandleAsync(OrderPlaced e, CancellationToken ct) => loyalty.AwardAsync(e.CustomerId, (int)e.Total.Amount, ct); }
public sealed class SendOrderConfirmation(IEmailSender email) : IDomainEventHandler<OrderPlaced>
{ public Task HandleAsync(OrderPlaced e, CancellationToken ct) => email.SendAsync(Templates.OrderConfirmation(e), ct); }
~~~`,
  pts: [r`Raising events keeps aggregates focused on their own invariants.`, r`New reactions are new handlers, not edits to the aggregate.`, r`Decide per handler: same transaction or after-commit via outbox.`, r`Dependent handlers are a workflow; make it explicit.`, r`Document and trace handlers so the flow stays visible.`],
  ex: r`Moving five side effects out of Order.Place into handlers let the marketing team own loyalty logic, and an email outage no longer rolled back orders.`,
  fu: [r`Domain events vs integration events?`],
  pit: [r`Handlers that call each other in a hidden chain.`] },

{ id: 'q30', level: 'Senior', tags: ['solid', 'legacy'],
  q: r`How do you introduce SOLID incrementally into a legacy codebase without a rewrite?`,
  a: r`1. **Find hotspots**: files with high change frequency and complexity; improvement there pays back fastest.
2. **Pin behaviour** with characterisation/approval tests at a seam (HTTP, public methods).
3. **Introduce seams** (DIP): extract interfaces for external dependencies (database, time, HTTP) so code becomes testable; use "extract and override" where necessary.
4. **Extract responsibilities** (SRP): move cohesive chunks into new classes behind the existing public API.
5. **Replace conditionals** with strategies on axes that keep changing (OCP).
6. **Strangle**: route new features through the new structure; migrate old callers gradually.
7. Keep PRs small and shippable; agree a boy-scout budget (e.g. 20% of feature work) rather than a separate rewrite project.

Michael Feathers' "Working Effectively with Legacy Code" techniques (sprout method, wrap class) are the toolkit.`,
  code: r`~~~csharp
// Sprout class: new behaviour in a new, tested class; legacy method just calls it
public class LegacyInvoiceProcessor
{
    public void Process(Invoice inv)
    {
        // ... 400 legacy lines ...
        var discount = new LoyaltyDiscount(new SqlLoyaltyStore(_conn)).For(inv.CustomerId, inv.Total);   // sprouted
        inv.Total -= discount;
        // ... more legacy ...
    }
}
public sealed class LoyaltyDiscount(ILoyaltyStore store)   // fully unit-tested
{
    public decimal For(int customerId, decimal total) => store.Tier(customerId) switch { "gold" => total * 0.05m, _ => 0m };
}

// Approval test pins legacy output before refactoring (Verify)
[Fact] public Task Legacy_invoice_output_is_stable() => Verify(new LegacyInvoiceProcessor(TestDb.Seeded()).Render(Fixtures.Invoice()));
~~~`,
  pts: [r`Start where change frequency and complexity meet.`, r`Pin behaviour with characterisation tests before moving code.`, r`Introduce seams for external dependencies first.`, r`Sprout and wrap: put new behaviour in new tested classes.`, r`Small shippable PRs and a standing refactoring budget, not a rewrite.`],
  ex: r`A 15-year-old billing module improved over three quarters with sprout classes and approval tests; defect rate in that module halved with no feature freeze.`,
  fu: [r`How do you justify the refactoring budget to product?`],
  pit: [r`Big-bang rewrite that loses undocumented behaviour.`] },

{ id: 'q31', level: 'Senior', tags: ['dip', 'cross-cutting'],
  q: r`Are logging, configuration and time "dependencies" you should invert? Where do you draw the line?`,
  a: r`Ask: **is it non-deterministic, external, or something tests must control?**

- **Time**: yes, invert ({{TimeProvider}}). Business rules around dates are bug-prone and must be testable.
- **Randomness / GUID generation**: invert when tests must be deterministic (ids in snapshots).
- **Configuration**: inject typed options ({{IOptions<T>}}) rather than reading {{IConfiguration}} keys inside business code. That is DIP for config.
- **Logging**: {{ILogger<T>}} is already an abstraction; injecting it is fine. Do not wrap it in your own ILogger abstraction; use structured logging and source-generated log methods.
- **Static pure functions** (Math, string helpers): no inversion needed.
- **Framework types** at the edges (HttpContext in endpoints): fine; keep them out of domain code.

The line: invert what varies by environment or makes tests non-deterministic; do not wrap stable, well-abstracted framework APIs.`,
  code: r`~~~csharp
public sealed partial class StatementService(IOptions<StatementOptions> options, TimeProvider clock, ILogger<StatementService> log)
{
    public Statement Build(Account a)
    {
        var periodEnd = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime).AddDays(-1);
        LogBuilding(a.Id, periodEnd);
        return new Statement(a.Id, periodEnd, options.Value.FooterText);
    }
    [LoggerMessage(Level = LogLevel.Information, Message = "Building statement for {AccountId} ending {PeriodEnd}")]
    private partial void LogBuilding(Guid accountId, DateOnly periodEnd);    // source-generated, no wrapper needed
}
~~~`,
  pts: [r`Invert what is non-deterministic, external or must be controlled in tests.`, r`Time and randomness: yes, via TimeProvider and injected generators.`, r`Configuration: typed options, not IConfiguration keys in business code.`, r`Logging: ILogger<T> is already an abstraction; do not wrap it.`, r`Pure static helpers need no inversion.`],
  ex: r`Replacing DateTime.Now with TimeProvider in a statement service exposed a bug where statements generated after midnight UTC covered the wrong day for Asian customers.`,
  fu: [r`Should domain entities log?`],
  pit: [r`Custom ILoggerWrapper abstractions that lose structured logging.`] },

{ id: 'q32', level: 'Senior', tags: ['isp', 'role-interfaces'],
  q: r`Role interfaces vs header interfaces: which do you design, and how do they affect mocking and permissions?`,
  a: r`- **Header interface**: mirrors a class's full public surface ({{IUserService}} with 25 methods). Defined by the implementer.
- **Role interface**: defines one role a client needs ({{IPasswordResetSender}}, {{IUserLookup}}). Defined by the consumer.

Role interfaces:

- Make dependencies **explicit**: the constructor shows exactly which capabilities a class uses.
- Keep mocks and fakes **small**.
- Map naturally to **permissions**: a reporting component given {{IOrderReader}} cannot delete; this can align with database roles or API scopes.
- Reduce change impact: adding a method to one role does not touch consumers of others.

One implementation can serve several roles; registration maps each role to the same instance when state must be shared.`,
  code: r`~~~csharp
public interface IUserLookup { Task<User?> ByEmailAsync(string email, CancellationToken ct); }
public interface IPasswordResetSender { Task SendResetAsync(User user, CancellationToken ct); }
public sealed class UserDirectory : IUserLookup, IPasswordResetSender { /* one implementation */ }

builder.Services.AddScoped<UserDirectory>();
builder.Services.AddScoped<IUserLookup>(sp => sp.GetRequiredService<UserDirectory>());
builder.Services.AddScoped<IPasswordResetSender>(sp => sp.GetRequiredService<UserDirectory>());

// The consumer states exactly what it uses
public sealed class ForgotPasswordHandler(IUserLookup users, IPasswordResetSender sender) { }
~~~`,
  pts: [r`Header interfaces mirror a class; role interfaces describe a client need.`, r`Prefer role interfaces defined by the consumer.`, r`They make dependencies explicit and mocks small.`, r`They align with least-privilege permissions.`, r`Map several roles to one implementation when state is shared.`],
  ex: r`Splitting IUserService into four roles showed that the notification service only needed lookups, so its database login was reduced to read-only.`,
  fu: [r`How do role interfaces interact with keyed DI?`],
  pit: [r`Registering role interfaces to different instances when they must share state.`] },

{ id: 'q33', level: 'Senior', tags: ['ocp', 'versioned-behaviour'],
  q: r`Regulations change yearly (tax rules, fee caps). How do you design code so new rule versions are added without breaking past calculations?`,
  a: r`Financial calculations must be **reproducible**: recalculating a 2024 invoice must use 2024 rules. So rules are **versioned by effective date** and new versions are added (OCP), never edited in place.

Design:

- A rule interface plus implementations per version, each with an **effective-from** date (and optional effective-to).
- A resolver selects the version by the **business date** of the transaction, not today's date.
- Parameter changes (rates) in a versioned table with effective dates and approvals; logic changes as new classes.
- Persist **which rule version** produced each result, so audits and recalculations are explainable.
- Tests per version with fixtures from the regulation's examples.

This turns yearly regulatory change into an additive release and makes back-dated corrections safe.`,
  code: r`~~~csharp
public interface IFeeCapRule { DateOnly EffectiveFrom { get; } string Version { get; } Money Cap(Money transaction); }
public sealed class FeeCap2024 : IFeeCapRule { public DateOnly EffectiveFrom => new(2024, 1, 1); public string Version => "2024.1"; public Money Cap(Money t) => t * 0.003m; }
public sealed class FeeCap2026 : IFeeCapRule { public DateOnly EffectiveFrom => new(2026, 4, 1); public string Version => "2026.1"; public Money Cap(Money t) => Money.Min(t * 0.002m, Money.Of(5m, t.Currency)); }

public sealed class FeeCapResolver(IEnumerable<IFeeCapRule> rules)
{
    private readonly IFeeCapRule[] _ordered = rules.OrderByDescending(r => r.EffectiveFrom).ToArray();
    public IFeeCapRule For(DateOnly businessDate) => _ordered.First(r => r.EffectiveFrom <= businessDate);
}
// usage: var rule = resolver.For(txn.BusinessDate); fee = Money.Min(fee, rule.Cap(txn.Amount)); record rule.Version with the fee
~~~`,
  pts: [r`Rules are versioned by effective date and added, never edited in place.`, r`Select by the transaction's business date, not today.`, r`Parameters in a versioned, approved table; logic in new classes.`, r`Persist the rule version used for every result.`, r`Test each version with the regulation's worked examples.`],
  ex: r`An interchange fee-cap change took effect mid-quarter; versioned rules let the team recalculate a disputed March batch with the March rules while April onward used the new cap.`,
  fu: [r`How do you handle a retroactive regulatory correction?`],
  pit: [r`Editing the rule in place, so historical recalculations change.`] },

{ id: 'q34', level: 'Senior', tags: ['lsp', 'async'],
  q: r`What LSP problems appear with async interfaces, cancellation and exceptions?`,
  a: r`An interface's contract includes behaviour that is easy to break silently in async code:

- **Cancellation**: the contract says the method honours {{CancellationToken}}; an implementation that ignores it makes callers' timeouts useless.
- **Synchronous blocking** in an async implementation ({{.Result}} inside) changes performance characteristics callers rely on and can starve the thread pool.
- **Exception types**: the base contract throws {{NotFoundException}}; an implementation throws {{SqlException}} or returns null instead.
- **Thread affinity / reentrancy**: one implementation is safe to call concurrently, another is not (an EF DbContext-backed implementation).
- **Idempotency**: callers retry on timeout assuming idempotency; an implementation that is not idempotent double-applies.

Document these as part of the interface contract (XML docs, contract tests), and test them for each implementation.`,
  code: r`~~~csharp
/// <summary>Returns the quote or throws QuoteNotFoundException. Honours cancellation.
/// Safe to call concurrently. Idempotent: repeated calls with the same request id return the same quote.</summary>
public interface IQuoteService { Task<Quote> GetAsync(QuoteRequest request, CancellationToken ct); }

public abstract class QuoteServiceContract
{
    protected abstract IQuoteService Create();
    [Fact] public async Task Honours_cancellation()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
        await Create().Invoking(s => s.GetAsync(QuoteFixtures.Slow, cts.Token)).Should().ThrowAsync<OperationCanceledException>();
    }
    [Fact] public async Task Same_request_id_returns_same_quote()
    {
        var s = Create(); var a = await s.GetAsync(QuoteFixtures.R1, default); var b = await s.GetAsync(QuoteFixtures.R1, default);
        b.Should().BeEquivalentTo(a);
    }
}
~~~`,
  pts: [r`Cancellation, blocking behaviour, exceptions, concurrency and idempotency are part of the contract.`, r`Ignoring the CancellationToken silently breaks callers' timeouts.`, r`Sync-over-async in an implementation changes performance guarantees.`, r`Document behavioural guarantees on the interface.`, r`Verify them with contract tests per implementation.`],
  ex: r`A vendor adapter ignored cancellation; during a vendor outage, requests hung for 100 seconds despite a 2-second budget, exhausting the thread pool.`,
  fu: [r`How do you document behavioural contracts so they are enforced?`],
  pit: [r`Assuming the signature alone defines the contract.`] },

{ id: 'q35', level: 'Senior', tags: ['srp', 'data'],
  q: r`Apply SRP to data and schemas: one table used by many features, or separate models per purpose?`,
  a: r`A shared table or entity used by many features with different needs becomes a **god table**: every feature adds columns, nullable fields multiply, and a change for one feature risks others (the data equivalent of an SRP violation).

Signals:

- Columns only meaningful for one feature or one status ({{CancellationReason}}, {{ShippingLabelUrl}} on the order header).
- Many nullable columns and status-dependent validity.
- Different features needing different indexes and retention rules on the same table.

Options:

- **Split by lifecycle/feature**: OrderHeader, OrderFulfilment, OrderCancellation with 1:1 or 1:N relations.
- **Separate read models** per purpose (CQRS projections).
- **Per-bounded-context models**: the same real-world customer represented differently in billing and marketing, each owning its data.

Balance against query complexity: excessive splitting means many joins; split where lifecycle, ownership or access patterns diverge.`,
  code: r`~~~sql
-- God table: columns for every feature and status
-- Orders(Id, ..., CancellationReason, CancelledBy, RefundAmount, LabelUrl, CarrierCode, ReturnRma, FraudScore, ...)

-- Split by lifecycle and ownership
CREATE TABLE orders.Orders        (OrderId bigint PRIMARY KEY, CustomerId bigint NOT NULL, Status varchar(20) NOT NULL, Total decimal(19,4) NOT NULL);
CREATE TABLE orders.Cancellations (OrderId bigint PRIMARY KEY REFERENCES orders.Orders, Reason varchar(200) NOT NULL, CancelledBy varchar(100) NOT NULL, CancelledAt datetime2 NOT NULL);
CREATE TABLE fulfilment.Shipments (ShipmentId bigint PRIMARY KEY, OrderId bigint NOT NULL, CarrierCode varchar(10) NOT NULL, LabelUrl varchar(400) NULL);
~~~`,
  pts: [r`God tables are the data form of an SRP violation.`, r`Signals: feature-specific nullable columns, status-dependent validity, conflicting index needs.`, r`Split by lifecycle, ownership or access pattern.`, r`Use per-context models and read projections where purposes differ.`, r`Do not over-split: joins and complexity have a cost.`],
  ex: r`Splitting a 140-column Orders table into header, fulfilment and returns tables let the fulfilment team own its schema and cut the hot header row size by 70%.`,
  fu: [r`How do you migrate a god table without downtime?`],
  pit: [r`Adding "just one more nullable column" for every feature.`] },

{ id: 'q36', level: 'Senior', tags: ['solid', 'full-stack'],
  q: r`How do you keep SOLID boundaries consistent across a .NET API and an Angular/React front end that share a domain?`,
  a: r`The front end and back end should share **contracts**, not **domain implementations**:

- The API exposes use-case-shaped endpoints and DTOs (ISP); the domain model stays inside the API.
- TypeScript clients and types are **generated** from OpenAPI, so the front end depends on the contract abstraction (DIP), not hand-written guesses.
- Business rules the UI needs for responsiveness (validation hints, price previews) are either **re-derived from the API** (a quote endpoint) or duplicated deliberately with the server as the authority.
- Front-end architecture mirrors the separation: API clients in a data-access layer (services/hooks), state management separate from presentational components (SRP).
- Contract changes follow LSP rules (additive, tolerant readers), with consumer tests in the front-end repo.`,
  code: r`~~~bash
# Generate a typed client from the API contract in the front-end build
npx @hey-api/openapi-ts@0.53.0 -i https://api.internal/openapi/v1.json -o src/app/api
~~~
~~~typescript
// The UI asks the server for authoritative prices instead of re-implementing pricing rules
export function useQuote(cart: CartLine[]) {
  return useQuery({ queryKey: ['quote', cart], queryFn: () => api.quotes.create({ body: { lines: cart } }), staleTime: 5000 });
}
// Client-side validation mirrors the server's for UX only; the server stays the authority
export const referenceMax = 35;
~~~`,
  pts: [r`Share contracts, not domain implementations, across the stack.`, r`Generate TypeScript clients from OpenAPI so the UI depends on the contract.`, r`Ask the API for authoritative calculations, or duplicate deliberately with the server as authority.`, r`Mirror SRP in the front end: data access, state and presentation separated.`, r`Evolve contracts additively with tolerant readers.`],
  ex: r`Replacing hand-written TypeScript models with generated clients removed a recurring class of bugs where the UI sent amounts in pounds and the API expected pence.`,
  fu: [r`Where do you draw the line on client-side business logic?`],
  pit: [r`Sharing a domain library between .NET and TypeScript via code translation.`] },

{ id: 'q37', level: 'Principal', tags: ['governance', 'standards'],
  q: r`How do you embed SOLID-style design quality across 20 teams without dogma or a review bottleneck?`,
  a: r`Treat design quality as an outcome, not compliance:

- **Principles with context**: a short internal guide translating SOLID into your stack ("domain owns ports", "no IServiceProvider in business code", "contracts evolve additively") with real before/after examples from your codebase.
- **Automate the objective parts**: architecture tests for dependency direction, analyzers for nullable and async misuse, OpenAPI breaking-change gates, container validation in CI.
- **Templates**: new-service templates with the intended structure already in place.
- **Lightweight review**: design reviews only for new services or bounded contexts, using a one-page template (responsibilities, ports, contracts, change axes).
- **Learning loops**: postmortems and hotspot analysis feed the guide; communities of practice share examples.
- **Measure**: lead time, change failure rate and hotspot churn per team, not "SOLID compliance".`,
  code: r`~~~yaml
# Shared CI job every service includes: the objective rules are automated
jobs:
  design-guardrails:
    uses: org/platform-workflows/.github/workflows/design-guardrails.yml@v4
    with:
      architecture-tests: tests/ArchitectureTests
      openapi: openapi/service.json
      container-validation: true
      analyzers-level: latest-recommended
~~~`,
  pts: [r`Make design quality an outcome, measured by lead time and change failure rate.`, r`Translate SOLID into stack-specific rules with real examples.`, r`Automate objective rules: architecture tests, analyzers, contract gates.`, r`Templates encode the intended structure from day one.`, r`Light design reviews for new contexts; postmortems feed the guide.`],
  ex: r`Architecture tests and a service template replaced a weekly design-approval meeting; structural review comments dropped by two-thirds while lead time improved.`,
  fu: [r`How do you handle a team that disagrees with a rule?`],
  pit: [r`Mandating SOLID compliance scores as a KPI.`] },

{ id: 'q38', level: 'Principal', tags: ['trade-offs', 'decision'],
  q: r`A senior engineer wants to add interfaces and DI for every class "to follow SOLID". Another wants none. How do you resolve it?`,
  a: r`Reframe the debate from principles to **costs and benefits for this codebase**:

1. **Agree on goals**: testability of business rules, swappable infrastructure, low change cost, readability.
2. **Define where abstractions pay**: at boundaries (I/O, vendors, time), on proven variation, and for module contracts between teams.
3. **Define where they do not**: pure domain logic, value objects, internal helpers with one implementation.
4. **Run an experiment**: refactor one module both ways, compare test effort, file count and change effort for a typical feature.
5. **Write a team rule** in an ADR with examples, and revisit after a quarter.

As a Principal, the outcome is a shared heuristic the team owns, and both engineers feel heard because the decision is evidence-based.`,
  code: r`~~~text
ADR-022: When we introduce interfaces
We introduce an interface when ANY of:
  - it crosses an I/O or vendor boundary (database, HTTP, queue, clock, file system)
  - two or more implementations exist or are scheduled this quarter
  - it is a contract between modules owned by different teams
We do NOT introduce an interface for:
  - domain entities, value objects, pure calculation classes, private helpers
Review: 2027-01-15, using lead time and test-maintenance effort for modules A and B.
~~~`,
  pts: [r`Move the debate from principles to measurable costs and benefits.`, r`Abstract at boundaries, proven variation and team contracts.`, r`Keep pure domain logic and value objects concrete.`, r`Settle disagreements with a small experiment and an ADR.`, r`Revisit the rule with data after a quarter.`],
  ex: r`A team ran a two-week comparison on one module; the boundary-only approach needed 40% fewer test doubles with the same coverage, and became the team rule.`,
  fu: [r`How do you keep the ADR from being ignored?`],
  pit: [r`Deciding by seniority instead of evidence.`] },

{ id: 'q39', level: 'Principal', tags: ['architecture', 'dependency-direction'],
  q: r`Apply DIP to an organisation's service landscape: which way should dependencies point between core, supporting and generic domains?`,
  a: r`At system level, dependencies should point **towards stability and away from volatility**:

- **Core domain services** (pricing, risk, ledger) should not depend on volatile edge systems' models. Edge systems (channels, campaigns) depend on the core's published contracts.
- **Upstream/downstream** relationships (DDD context mapping) make the direction explicit: downstream conforms, or protects itself with an anti-corruption layer.
- **Events invert runtime dependencies**: the core publishes facts; consumers subscribe. The core does not call 12 downstream systems synchronously.
- **Generic subdomains** (identity, notifications, payments rails) sit behind ports so vendors can be swapped.

Signs of inverted dependency direction: the ledger service calling the marketing system, core release blocked by a channel team, shared databases between core and edge.`,
  code: r`~~~csharp
// Core publishes a stable fact; edges subscribe (runtime dependency inverted)
public sealed record LedgerEntryPosted(Guid EntryId, string AccountId, decimal Amount, string Currency, DateTimeOffset PostedAt, int SchemaVersion = 1);
// A volatile channel (marketing) consumes it through its own anti-corruption layer
public sealed class LedgerEventTranslator
{
    public CampaignSignal? Translate(LedgerEntryPosted e) => e.Amount > 10_000 ? new CampaignSignal(e.AccountId, "high-value-deposit") : null;
}
~~~`,
  dia: r`flowchart TB
  subgraph Volatile[Volatile edge: channels, campaigns]
    MOB[Mobile BFF]
    MKT[Marketing]
  end
  subgraph Core[Stable core]
    LED[Ledger]
    RISK[Risk]
  end
  subgraph Generic[Generic: behind ports]
    IDP[Identity provider]
    NOTIF[Notifications vendor]
  end
  MOB -->|calls published API| LED
  LED -->|publishes events| BUS[(Event bus)]
  BUS --> MKT
  RISK -->|port| IDP
  LED -->|port| NOTIF`,
  pts: [r`Dependencies point towards stability: edges depend on the core, not the reverse.`, r`Make upstream/downstream explicit with context maps.`, r`Events invert runtime dependencies: the core publishes, consumers subscribe.`, r`Generic subdomains sit behind ports for vendor swaps.`, r`Core calling volatile edge systems is a smell.`],
  ex: r`A ledger that synchronously notified six channel systems on every posting had six ways to fail; publishing LedgerEntryPosted removed them from the posting path.`,
  fu: [r`How do you handle a core service that needs data owned by an edge system?`],
  pit: [r`Core services depending on campaign or channel models.`] },

{ id: 'q40', level: 'Principal', tags: ['ocp', 'platform'],
  q: r`Design a platform extension model (for example, for 30 product teams to add payment methods or report types) that stays closed for modification.`,
  a: r`Goals: teams add capabilities without changing the platform core or coordinating releases, while the platform keeps safety, consistency and observability.

Design elements:

- **Stable extension contracts** (interfaces or message contracts) versioned like public APIs; capability descriptors declare what an extension supports.
- **Registration**: extensions packaged as NuGet modules registering themselves ({{services.AddPaymentMethod<T>()}}), or as separate services discovered via a registry for language/runtime independence.
- **Platform-owned cross-cutting concerns**: authentication, idempotency, retries, metrics, audit wrapped around every extension (decorators), so extensions cannot skip them.
- **Conformance test kit**: a shared contract test suite every extension must pass in its CI.
- **Isolation**: bulkheads and circuit breakers per extension; a failing extension cannot take down the platform.
- **Governance**: lifecycle (experimental, GA, deprecated), ownership metadata, and deprecation policy.`,
  code: r`~~~csharp
public interface IPaymentMethodExtension
{
    PaymentMethodDescriptor Descriptor { get; }      // id, currencies, countries, supports refunds/3DS
    Task<AuthResult> AuthoriseAsync(AuthRequest request, CancellationToken ct);
    Task<RefundResult> RefundAsync(RefundRequest request, CancellationToken ct);
}
public static class PaymentPlatformRegistration
{
    public static IServiceCollection AddPaymentMethod<T>(this IServiceCollection s) where T : class, IPaymentMethodExtension
    {
        s.AddScoped<T>();
        s.AddScoped<IPaymentMethodExtension>(sp => new PlatformGuards(sp.GetRequiredService<T>(),   // audit, idempotency,
            sp.GetRequiredService<IAuditLog>(), sp.GetRequiredService<ResiliencePipelineProvider<string>>()));   // bulkhead per method
        return s;
    }
}
// Each team's CI: public sealed class IdealTests : PaymentMethodConformanceSuite<IdealExtension> { }
~~~`,
  pts: [r`Versioned extension contracts with capability descriptors.`, r`Extensions register themselves as modules or services.`, r`The platform wraps every extension with cross-cutting guards so none can skip them.`, r`A conformance test kit runs in every extension's CI.`, r`Isolate failures per extension and govern the lifecycle.`],
  ex: r`A payments platform let regional teams add 25 local methods in a year via a conformance kit; the core team reviewed contracts, not every implementation.`,
  fu: [r`In-process modules or separate services for extensions?`],
  pit: [r`Extensions calling platform internals directly.`] },

{ id: 'q41', level: 'Principal', tags: ['srp', 'org-design'],
  q: r`How does Conway's law interact with SRP, and what do you do when team boundaries and code boundaries disagree?`,
  a: r`Conway's law: systems mirror the communication structure of the organisation. SRP's "one actor per module" is the same idea at code level. When they disagree:

- **One module, several teams**: merge conflicts, coordination meetings, unclear ownership, slow releases. Fix by splitting the module along team responsibilities, or by assigning clear ownership with others contributing through PRs.
- **One team, many fragmented services**: high operational load and distributed-monolith symptoms. Fix by consolidating.
- **Inverse Conway manoeuvre**: deliberately shape teams around the target architecture (stream-aligned teams per business capability, platform team for shared infrastructure).

As a Principal, surface the mismatch with data (cross-team PR counts per module, release coordination, incident ownership confusion) and propose either code or team changes, working with engineering managers.`,
  code: r`~~~bash
# Which teams commit to which top-level modules? (map author emails to teams via a CODEOWNERS-style file)
git log --since=6.months --format='%ae' --name-only | awk 'NF==1 && /@/ {a=$1; next} NF {split($0,p,"/"); print a, p[1]"/"p[2]}' \
  | sort | uniq -c | sort -rn | head -30
~~~
~~~text
# CODEOWNERS makes ownership explicit and routes reviews
/src/Pricing/   @org/pricing-team
/src/Ledger/    @org/ledger-team
~~~`,
  pts: [r`Conway's law is SRP at organisation scale.`, r`Many teams in one module causes coordination drag; split or assign ownership.`, r`One team owning many fragments causes ops load; consolidate.`, r`Use the inverse Conway manoeuvre to shape teams around target architecture.`, r`Show the mismatch with commit, release and incident data.`],
  ex: r`Commit analysis showed four teams changing a shared "Core" project weekly; splitting it into owned modules with CODEOWNERS cut cross-team PR waits from days to hours.`,
  fu: [r`How do Team Topologies' interaction modes help?`],
  pit: [r`Redrawing service boundaries without changing team ownership.`] },

{ id: 'q42', level: 'Principal', tags: ['solid', 'risk'],
  q: r`In a regulated financial system, how do SOLID principles support auditability and change control?`,
  a: r`Regulators (SOX, PRA/FCA, MAS) expect controlled, traceable changes and reproducible results. SOLID helps directly:

- **SRP** limits the blast radius of a change: a change to fee rules touches the fee module, so testing and approval scope are clear.
- **OCP** with versioned rules: new regulatory versions are added, past calculations remain reproducible.
- **DIP/ports** keep regulated logic independent of infrastructure, so infrastructure upgrades do not require re-validating business rules.
- **ISP** limits who can do what: role interfaces align with least privilege and segregation of duties.
- **LSP and contract tests** give evidence that replacement components (new vendor, new database) behave like the old ones.

Pair this with process: traceability from requirement to code to test to deployment, four-eyes reviews, immutable audit logs of decisions with rule versions.`,
  code: r`~~~csharp
// Every regulated decision records inputs, rule version and outcome for audit and replay
public sealed record DecisionRecord(Guid DecisionId, string Rule, string RuleVersion, string InputsHash, string Outcome, string DecidedBy, DateTimeOffset At);
public sealed class AuditedDecision<TIn, TOut>(IRule<TIn, TOut> rule, IDecisionLog log)
{
    public async Task<TOut> DecideAsync(TIn input, string actor, CancellationToken ct)
    {
        var outcome = rule.Evaluate(input);
        await log.AppendAsync(new DecisionRecord(Guid.NewGuid(), rule.Name, rule.Version,
            Hashing.Sha256(input), JsonSerializer.Serialize(outcome), actor, DateTimeOffset.UtcNow), ct);   // append-only store
        return outcome;
    }
}
~~~`,
  pts: [r`SRP limits blast radius, making approval scope clear.`, r`Versioned rules keep past results reproducible.`, r`Ports separate regulated logic from infrastructure upgrades.`, r`Role interfaces support least privilege and segregation of duties.`, r`Contract tests evidence substitutability when components change.`],
  ex: r`During a vendor migration, contract-test evidence that the new KYC adapter behaved like the old one shortened the model-risk review from months to weeks.`,
  fu: [r`How do you prove a calculation is reproducible years later?`],
  pit: [r`Treating auditability as a logging afterthought.`] },

{ id: 'q43', level: 'Principal', tags: ['mentoring'],
  q: r`How do you teach SOLID to mid-level engineers so they apply judgement rather than rules?`,
  a: r`- **Start from pain**: show a real change in your codebase that was expensive, then show how a principle would have reduced it.
- **Teach the "why" as forces**: change axes, testability, team ownership; principles are responses to those forces.
- **Show counter-examples**: over-engineered code where the principle made things worse.
- **Practise on real PRs**: review together, ask "what is likely to change here?" and "who asks for these changes?".
- **Kata with constraints**: refactoring exercises (Gilded Rose, trip service kata) under time limits.
- **Encourage deletion**: celebrate removing unnecessary abstractions as much as adding good ones.
- **Make the heuristics explicit** in a team guide with examples, and update it from retrospectives.`,
  code: r`~~~text
Review questions I teach (instead of "does this follow SOLID?")
1. Who would ask for this code to change, and would their changes collide?
2. What is the next likely variation? Is it cheap to add?
3. Can I test the business rule without the database, clock or network?
4. Would a new teammate find the request path in under 5 minutes?
5. Which abstraction here could we delete without losing anything?
~~~`,
  pts: [r`Teach from real pain in your own codebase.`, r`Explain principles as responses to forces like change and testability.`, r`Show counter-examples where principles made code worse.`, r`Practise on real PRs and katas.`, r`Reward deletion of needless abstraction.`],
  ex: r`Replacing a SOLID lecture with five review questions improved review quality noticeably within a month; engineers started asking "who changes this?" unprompted.`,
  fu: [r`How do you assess whether mentoring worked?`],
  pit: [r`Teaching definitions with toy animal examples only.`] },

{ id: 'q44', level: 'Principal', tags: ['performance', 'trade-offs'],
  q: r`When do SOLID abstractions conflict with performance, and how do you resolve it without abandoning design?`,
  a: r`Costs of abstraction in .NET hot paths:

- **Virtual/interface dispatch** prevents inlining (unless devirtualised).
- **Allocations**: delegates, closures, small strategy objects per call, boxing of structs through interfaces.
- **Indirection layers** (decorators, mediators) adding overhead per call and per allocation.
- **Generic repositories** blocking efficient queries (projections, bulk operations).

Resolution:

- **Measure first**: most code is not hot; keep clean design there.
- **Zero-cost abstractions**: generics constrained to structs ({{where T : struct, IRule}}) are specialised by the JIT with no virtual calls; static abstract interface members; sealed classes for devirtualisation.
- **Isolate the hot path** behind a clean boundary and optimise inside it.
- **Batch at boundaries**: a port with {{GetManyAsync}} instead of N calls.
- Document deviations in an ADR with benchmarks.`,
  code: r`~~~csharp
public interface IFeeRule { decimal Apply(decimal amount); }
public readonly struct PercentFee(decimal pct) : IFeeRule { public decimal Apply(decimal a) => a * pct; }

// Interface dispatch per item
static decimal SumFees(IFeeRule rule, ReadOnlySpan<decimal> amounts) { decimal s = 0; foreach (var a in amounts) s += rule.Apply(a); return s; }
// Generic over a struct: JIT specialises, inlines Apply, no boxing, still abstract in source
static decimal SumFees<TRule>(TRule rule, ReadOnlySpan<decimal> amounts) where TRule : struct, IFeeRule
{ decimal s = 0; foreach (var a in amounts) s += rule.Apply(a); return s; }

// Batch at the port boundary instead of N round trips
public interface IPriceLookup { Task<IReadOnlyDictionary<string, decimal>> GetManyAsync(IReadOnlyCollection<string> skus, CancellationToken ct); }
~~~`,
  pts: [r`Abstraction costs: dispatch, allocations, indirection, blocked queries.`, r`Measure first; most code is not hot.`, r`Use zero-cost abstractions: struct-constrained generics, sealed types, static abstracts.`, r`Isolate and optimise the hot path behind a clean boundary.`, r`Design ports for batching to avoid chatty calls.`],
  ex: r`A fee engine processing 50 million items nightly switched rule strategies to struct generics and batch lookups; runtime fell from 40 minutes to 6 with the same rule interface.`,
  fu: [r`How do you prevent performance regressions in CI?`],
  pit: [r`Dropping all abstraction across the codebase for micro-gains.`] },

{ id: 'q45', level: 'Principal', tags: ['interview-scenario', 'design'],
  q: r`Design a notification system (email, SMS, push, in-app) applying SOLID. Where do the principles show up?`,
  a: r`Requirements: multiple channels, user preferences, templates, retries, rate limits, auditing, new channels over time.

- **SRP**: separate preference resolution, template rendering, channel delivery, scheduling/throttling and audit.
- **OCP**: channels are strategies ({{INotificationChannel}}); adding WhatsApp is a new class plus registration. Templates are data.
- **LSP**: every channel honours the same contract (idempotent by message id, returns Delivered/Failed/Retryable), verified by contract tests.
- **ISP**: producers depend on a small {{INotify}} port ({{SendAsync(NotificationRequest)}}), not on channel details or preference stores.
- **DIP**: domain services depend on {{INotify}}; vendor SDKs (Twilio, SES, FCM) live in adapters.

Delivery is asynchronous: producers write to an outbox/queue; workers resolve preferences, render and deliver with per-channel retry and DLQ.`,
  code: r`~~~csharp
public interface INotify { Task SendAsync(NotificationRequest request, CancellationToken ct); }          // producers' port
public sealed record NotificationRequest(Guid Id, Guid UserId, string TemplateId, IReadOnlyDictionary<string, string> Data);

public interface INotificationChannel
{
    string Name { get; }                                                                                 // "email", "sms", "push"
    Task<DeliveryResult> DeliverAsync(RenderedMessage message, Recipient to, CancellationToken ct);     // idempotent by message.Id
}
public sealed class Dispatcher(IPreferenceStore prefs, ITemplateRenderer renderer, IEnumerable<INotificationChannel> channels, IAuditLog audit)
{
    public async Task DispatchAsync(NotificationRequest r, CancellationToken ct)
    {
        foreach (var (channel, recipient) in await prefs.ChannelsForAsync(r.UserId, r.TemplateId, ct))
        {
            var msg = await renderer.RenderAsync(r.TemplateId, channel, r.Data, ct);
            var result = await channels.Single(c => c.Name == channel).DeliverAsync(msg with { Id = r.Id }, recipient, ct);
            await audit.RecordAsync(r.Id, channel, result, ct);
        }
    }
}
~~~`,
  dia: r`flowchart LR
  P[Producers: orders, payments] -->|INotify / outbox| Q[(Notification queue)]
  Q --> D[Dispatcher worker]
  D --> PR[Preference store]
  D --> T[Template renderer]
  D --> E[Email channel: SES]
  D --> S[SMS channel: Twilio]
  D --> PU[Push channel: FCM/APNs]
  D --> A[(Audit log)]
  E & S & PU -->|retryable| RQ[(Retry / DLQ)]`,
  pts: [r`SRP: preferences, rendering, delivery, throttling and audit are separate.`, r`OCP: channels are strategies; templates are data.`, r`LSP: every channel is idempotent and returns the same outcome types.`, r`ISP/DIP: producers depend only on a small INotify port.`, r`Deliver asynchronously with per-channel retries and DLQ.`],
  ex: r`Adding WhatsApp notifications for a bank's Latin American markets took one adapter and a preference migration, with no changes to the 18 producing services.`,
  fu: [r`How do you prevent duplicate SMS on retries?`, r`How do you rate-limit per user and per provider?`],
  pit: [r`Producers calling Twilio or SES directly.`] },

{ id: 'q46', level: 'Principal', tags: ['evolution', 'architecture'],
  q: r`How do you evolve abstractions when a principle was applied on the wrong axis (for example, splitting by technical layer)?`,
  a: r`Wrong-axis abstractions are expensive: every feature crosses many modules. Steps:

1. **Recognise it with data**: change coupling shows features touching Controllers, Services, Repositories and Validators folders together, or services that always deploy together.
2. **Choose the right axis**: business capability / use case (vertical slices, bounded contexts).
3. **Migrate incrementally**: move one feature at a time into a vertical slice (endpoint, handler, data access together), keeping shared pieces only where genuinely shared.
4. **Collapse unnecessary layers** along the way (generic services that only delegate).
5. **Re-align ownership**: teams own slices or contexts.
6. **Communicate**: an ADR describing why the axis changed, so people do not re-introduce the old structure.

Accept a transition period with both styles; consistency within a module matters more than global uniformity during migration.`,
  code: r`~~~text
Before (technical layers)                After (vertical slices)
Controllers/OrdersController.cs          Features/Orders/PlaceOrder/PlaceOrderEndpoint.cs
Services/OrderService.cs                 Features/Orders/PlaceOrder/PlaceOrderHandler.cs
Repositories/OrderRepository.cs          Features/Orders/PlaceOrder/PlaceOrderValidator.cs
Validators/OrderValidator.cs             Features/Orders/CancelOrder/...
DTOs/OrderDto.cs                         Domain/Orders/Order.cs   (shared domain stays shared)
A feature touched 5 folders              A feature touches 1 folder (+ domain when rules change)
~~~`,
  pts: [r`Wrong-axis splits make every feature cross many modules.`, r`Confirm with change-coupling data.`, r`Re-split by capability or use case (vertical slices, bounded contexts).`, r`Migrate one feature at a time and collapse delegate-only layers.`, r`Record the decision in an ADR and realign ownership.`],
  ex: r`Moving from layer folders to vertical slices over two months reduced the average files touched per feature from 9 to 3.`,
  fu: [r`How do you share cross-slice logic without recreating layers?`],
  pit: [r`A big-bang reorganisation that blocks feature work for weeks.`] },

{ id: 'q47', level: 'Principal', tags: ['evaluation', 'candidates'],
  q: r`When interviewing candidates on SOLID, what separates a Principal-level answer from a Senior one?`,
  a: r`Senior answers define the principles correctly with examples. Principal answers:

- **Lead with forces**: change axes, team ownership, testability, regulatory reproducibility; principles are tools for those.
- **Discuss trade-offs and misuse**: when an interface or strategy is waste; the cost of indirection; the rule of three.
- **Scale the ideas**: SRP to service boundaries and Conway's law, LSP to API compatibility, ISP to contracts and events, DIP to dependency direction between systems.
- **Show organisational mechanisms**: how to make good design the default (templates, architecture tests, ADRs) without bottlenecks.
- **Bring evidence**: metrics like change coupling, lead time and incident data to justify refactoring.

A quick test: ask "when would you not apply X?" Senior candidates often struggle; Principal candidates answer with specific contexts.`,
  code: r`~~~text
Prompt: "Explain OCP."
Senior: definition + strategy example.
Principal: definition + "I apply it on axes that have varied (payment methods: 14 added last year),
           not on speculative ones; each extension point costs indirection. At platform level it becomes a
           conformance-tested extension model; for regulatory rules it means versioned, additive rule sets so
           past results stay reproducible."
~~~`,
  pts: [r`Lead with forces like change, ownership and testability.`, r`Discuss misuse, costs and when not to apply each principle.`, r`Scale principles to services, contracts and organisations.`, r`Describe mechanisms that make good design the default.`, r`Back claims with data such as change coupling and lead time.`],
  ex: r`Interview panels that added "when would you not apply this?" follow-ups found it the most predictive question for senior design roles.`,
  fu: [r`How would you answer "when would you not apply DIP?"`],
  pit: [r`Treating definitions as sufficient at Principal level.`] },

{ id: 'q48', level: 'Principal', tags: ['microservices', 'contracts'],
  q: r`Shared libraries across microservices: when do they violate SOLID at system level, and what do you allow?`,
  a: r`Shared libraries become a problem when they carry **domain logic or domain models**: every service couples to one release cycle (OCP violated: changes for one service force upgrades in all), and different services' needs collide in one model (SRP violated).

Allow:

- **Technical cross-cutting libraries** with stable APIs: logging and telemetry setup, resilience defaults, auth helpers, serialization settings. Version them semantically and keep them thin.
- **Generated contract clients** from each service's published API or schema, owned by the provider, consumed at a pinned version.

Avoid:

- Shared "Common.Domain" with Customer/Order entities.
- Shared database access libraries exposing other services' tables.
- Libraries that make network calls with hidden behaviour.

Policy: duplication of small value objects across services is acceptable; coupling via shared domain code is not.`,
  code: r`~~~xml
<!-- Allowed: thin, technical, semantically versioned -->
<PackageReference Include="Company.Observability" Version="3.2.1" />
<PackageReference Include="Company.Resilience.Defaults" Version="2.0.4" />
<!-- Allowed: provider-owned generated client pinned per consumer -->
<PackageReference Include="Payments.Contracts.Client" Version="5.1.0" />
<!-- Not allowed: shared domain model that every service must upgrade together -->
<!-- <PackageReference Include="Company.Common.Domain" Version="14.7.0" /> -->
~~~`,
  pts: [r`Shared domain libraries couple release cycles and collide service needs.`, r`Allow thin technical libraries with stable, versioned APIs.`, r`Allow provider-owned generated contract clients at pinned versions.`, r`Duplicate small value objects rather than share domain code.`, r`Never share data-access code to other services' tables.`],
  ex: r`A "Common.Domain" package at version 14 forced 22 services to upgrade for a field one service needed; retiring it ended lock-step releases.`,
  fu: [r`How do you retire a widely used shared domain library?`],
  pit: [r`Shared libraries with hidden network calls or database access.`] },

{ id: 'q49', level: 'Principal', tags: ['metrics', 'outcomes'],
  q: r`How do you demonstrate to leadership that design-quality work (SOLID refactoring) is paying off?`,
  a: r`Translate design improvements into delivery and reliability outcomes:

- **Lead time for changes** in the refactored area (DORA): before and after.
- **Change failure rate** and incidents attributed to the area.
- **Hotspot churn and complexity**: fewer files touched per feature, lower complexity trend.
- **Onboarding time**: time for a new engineer to ship a first change in the area.
- **Test feedback time**: unit test suite speed after decoupling from infrastructure.
- **Cost of variants**: time to add a new payment method / report type / country.

Set a baseline before starting, report quarterly, and connect to business goals ("adding a country took 6 weeks, now 2"). Avoid vanity metrics like "number of interfaces" or "SOLID compliance".`,
  code: r`~~~text
Quarterly design-health report: Payments module
Metric                                   Q2 (baseline)   Q3      Q4
Lead time (merge to prod, median)        6.5 days        3.1     1.8
Change failure rate                      18%             11%     7%
Files touched per feature (median)       11              6       4
Time to add a payment method             6 weeks         -       2 weeks
Unit test suite time                     14 min          4 min   3 min
~~~`,
  pts: [r`Report delivery and reliability outcomes, not principle compliance.`, r`Use DORA metrics for the refactored area.`, r`Track files touched per feature and hotspot churn.`, r`Measure the cost of adding a new variant.`, r`Baseline before starting and report quarterly in business terms.`],
  ex: r`A design-health report showing payment-method onboarding dropping from 6 weeks to 2 secured another quarter of refactoring budget.`,
  fu: [r`How do you separate the effect of refactoring from other changes?`],
  pit: [r`Reporting abstract quality scores leadership cannot connect to outcomes.`] },

{ id: 'q50', level: 'Principal', tags: ['summary'],
  q: r`Summarise SOLID in a way a Principal Engineer would say it in an interview.`,
  a: r`"SOLID is five heuristics for keeping the cost of change low. I apply them to the forces in front of me:

- **SRP**: group code by who asks for changes. At system level that is bounded contexts and team ownership.
- **OCP**: make the axes that actually vary cheap to extend: strategies, pipelines, versioned rules. Leave stable code simple.
- **LSP**: substitutes must keep the behavioural contract, which includes cancellation, errors and idempotency. At system level it is backward-compatible APIs, enforced by contract tests.
- **ISP**: small, client-shaped contracts, from interfaces to REST resources and events, which also gives least privilege.
- **DIP**: dependencies point toward stable policy; the core owns its ports, vendors sit behind adapters, and events invert runtime coupling.

I avoid speculative abstraction, measure success by lead time and change failure rate, and encode the rules in templates and architecture tests rather than in review gates."`,
  code: r`~~~csharp
// The five ideas in one small slice
public interface IFeePolicy { string Method { get; } Money Fee(Money amount); }                 // OCP: new method = new class
public sealed class CardFee : IFeePolicy { public string Method => "card"; public Money Fee(Money a) => a * 0.029m; }
public interface IPaymentGateway { Task<AuthorisationResult> AuthoriseAsync(Money m, CardToken t, CancellationToken ct); } // DIP: core-owned port
public sealed class ChargeHandler(IEnumerable<IFeePolicy> fees, IPaymentGateway gateway)    // SRP: orchestration only
{
    public Task<AuthorisationResult> HandleAsync(Charge c, CancellationToken ct) =>              // ISP: depends on two small roles
        gateway.AuthoriseAsync(c.Amount + fees.Single(f => f.Method == c.Method).Fee(c.Amount), c.Token, ct);
}   // LSP: every gateway adapter passes the same contract test suite
~~~`,
  pts: [r`SOLID is about keeping the cost of change low.`, r`Each principle scales from classes to services and teams.`, r`Apply them on real axes of change, not speculatively.`, r`LSP includes behavioural contracts and API compatibility.`, r`Measure with lead time and failure rate; automate the rules.`],
  ex: r`This framing, backed by one concrete example per principle from your own systems, consistently lands better than definitions in Principal interviews.`,
  fu: [r`Which principle do you think is most overrated, and why?`],
  pit: [r`Ending with definitions and no point of view.`] }
],
cheat: r`### The five, as forces
| Principle | Real meaning | System-level form | Misuse |
|---|---|---|---|
| SRP | One actor per module | Bounded contexts, team ownership | Tiny classes that change together |
| OCP | Cheap extension on real axes of change | Plugins, pipelines, versioned rules, flags | Speculative strategies everywhere |
| LSP | Keep the behavioural contract (errors, cancellation, idempotency) | Backward-compatible APIs, contract tests | Overrides throwing NotSupported |
| ISP | Client-shaped, small contracts | Purpose-specific endpoints and events, least privilege | One interface per method |
| DIP | Core owns abstractions; details depend inward | Ports/adapters, events invert runtime coupling | Interfaces in Infrastructure; DI = DIP |

### .NET toolkit
Strategies + keyed DI · Scrutor decorators · middleware / endpoint filters · TimeProvider · IOptions + ValidateOnStart · ValidateOnBuild/ValidateScopes · NetArchTest · contract test base classes · OpenAPI diff in CI · struct-constrained generics for zero-cost abstraction.

### Smells
God controllers/services · flag arguments · switch on type in many places · IServiceProvider in business code · captive dependencies · single-implementation interfaces with no boundary · shared domain NuGet across services · god tables and god events.

### Say this
"SRP means one actor, not one thing." "I make the axes that actually vary cheap to extend." "LSP includes cancellation and idempotency." "The core owns its ports." "I judge design by lead time and change failure rate."`
});
})(String.raw);
