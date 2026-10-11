(function (r) {
registerTopic('11-design-patterns', {
related: ['10-solid', '15-low-level-design', '09-oop'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['strategy'],
  q: r`Explain the Strategy pattern with a production example. How does it differ from simply passing a delegate?`,
  a: r`**Strategy** encapsulates interchangeable algorithms behind a common interface so the client selects behaviour at runtime without conditionals.

In modern C# a **delegate** ({{Func<decimal, decimal>}}) is a lightweight strategy. Choose an interface when the strategy:

- Has **several related methods** or metadata (name, supported currencies).
- Needs **dependencies** injected (repositories, HTTP clients).
- Must be **discoverable and registered** (DI, keyed services, plugins).
- Benefits from a named type for testing and logging.

Choose a delegate for a single, stateless function passed at a call site (sorting comparers, LINQ predicates, small pricing rules).

### Selection
Strategies are selected by a key (country, payment method, tenant tier) via a dictionary or keyed DI. Fail loudly for unknown keys rather than falling back silently.`,
  code: r`~~~csharp
public interface IShippingCost { string Carrier { get; } Money Quote(Parcel p, Address to); }
public sealed class RoyalMail : IShippingCost { public string Carrier => "royalmail"; public Money Quote(Parcel p, Address to) => Money.Of(3.20m + p.WeightKg * 0.8m, "GBP"); }
public sealed class Dhl(IDhlRates rates) : IShippingCost { public string Carrier => "dhl"; public Money Quote(Parcel p, Address to) => rates.For(to.Country, p.WeightKg); }

builder.Services.AddKeyedSingleton<IShippingCost, RoyalMail>("royalmail");
builder.Services.AddKeyedSingleton<IShippingCost, Dhl>("dhl");
app.MapGet("/quote/{carrier}", ([FromRoute] string carrier, IServiceProvider sp, Parcel p, Address to) =>
    sp.GetKeyedService<IShippingCost>(carrier) is { } s ? Results.Ok(s.Quote(p, to)) : Results.NotFound());

// Delegate as a lightweight strategy
static IEnumerable<Order> SortBy(IEnumerable<Order> o, Func<Order, decimal> key) => o.OrderByDescending(key);
~~~`,
  pts: [r`Strategy puts interchangeable algorithms behind one interface, selected at runtime.`, r`Use a delegate for a single stateless function; an interface when there are dependencies, metadata or registration.`, r`Select by key with a dictionary or keyed DI.`, r`Fail loudly on unknown keys.`, r`Each strategy is independently testable and ownable.`],
  ex: r`A checkout supported 6 carriers via shipping strategies; adding a carrier for a new market touched only a new class and its registration.`,
  fu: [r`Strategy vs State pattern?`, r`How do you choose a strategy based on several attributes?`],
  pit: [r`Strategies with one implementation "for the future".`, r`Silent fallback to a default strategy for unknown keys.`],
  tip: r`Mention that a Func is the lightest strategy: it shows you know when not to build classes.` },

{ id: 'q2', level: 'Basic', tags: ['factory'],
  q: r`Factory Method vs Abstract Factory vs a static factory method: when do you use each in .NET?`,
  a: r`- **Static factory method** on a type ({{Money.Of(...)}}, {{Order.Create(...)}}): named construction with validation, can return cached instances or subtypes. Most common in modern code.
- **Factory Method**: a base class defines a creation method subclasses override, letting a framework create objects without knowing concrete types. Rare in application code today.
- **Abstract Factory**: creates **families of related objects** that must be used together (a cloud provider's blob client + queue client + key client; a UI theme's widgets).
- **DI container factories**: {{IHttpClientFactory}}, {{IDbContextFactory<T>}}, keyed services and {{Func<T>}} factories registered in DI cover most runtime-creation needs.

Use a factory when construction is non-trivial (validation, choice of subtype, pooling) or when the caller must create objects at runtime while staying decoupled from concrete classes.`,
  code: r`~~~csharp
// Static factory: validated, named construction
public sealed record Email
{
    public string Value { get; }
    private Email(string v) => Value = v;
    public static Email Parse(string raw) => MailAddress.TryCreate(raw, out var a) ? new(a.Address.ToLowerInvariant()) : throw new FormatException();
}
// Abstract factory: a consistent family per cloud
public interface ICloudFactory { IBlobStore CreateBlobStore(); IQueue CreateQueue(string name); }
public sealed class AwsFactory(IAmazonS3 s3, IAmazonSQS sqs) : ICloudFactory
{ public IBlobStore CreateBlobStore() => new S3BlobStore(s3); public IQueue CreateQueue(string n) => new SqsQueue(sqs, n); }
public sealed class AzureFactory(BlobServiceClient b, QueueServiceClient q) : ICloudFactory
{ public IBlobStore CreateBlobStore() => new AzureBlobStore(b); public IQueue CreateQueue(string n) => new StorageQueue(q.GetQueueClient(n)); }

// Framework factories you should use rather than reinvent
public sealed class Exporter(IDbContextFactory<AppDb> dbs, IHttpClientFactory http) { }
~~~`,
  pts: [r`Static factory methods give named, validated construction and are the most common form.`, r`Abstract Factory creates families of objects that must match.`, r`Factory Method lets subclasses decide the concrete type; rare in app code now.`, r`Prefer IHttpClientFactory, IDbContextFactory and keyed DI over hand-rolled factories.`, r`Use factories when construction is non-trivial or happens at runtime.`],
  ex: r`A multi-cloud document service used an abstract factory per provider so blob, queue and key clients always came from the same cloud and credentials.`,
  fu: [r`Factory vs Builder?`, r`How does DI reduce the need for factories?`],
  pit: [r`Factories that just call new with no logic.`] },

{ id: 'q3', level: 'Basic', tags: ['singleton'],
  q: r`Why is the classic Singleton considered an anti-pattern, and what do you use instead in .NET?`,
  a: r`The GoF Singleton (private constructor + static {{Instance}}) creates:

- **Hidden global state** and hidden dependencies: callers reach {{Config.Instance}} instead of declaring needs.
- **Testing pain**: cannot substitute, state leaks between tests.
- **Lifetime coupling**: you cannot have one instance per tenant or per test later.
- Thread-safety bugs in hand-written lazy initialisation.

Instead, **register a singleton lifetime in DI** ({{AddSingleton}}): one instance per container, injected explicitly, replaceable in tests. If you truly need a lazily created static (pure, immutable data), use {{Lazy<T>}} or a static readonly field, which the runtime initialises thread-safely.

Singleton lifetime is still correct for thread-safe, stateless or shared-cache services: {{HttpClient}} handlers via the factory, {{ConnectionMultiplexer}}, {{MongoClient}}, compiled regexes.`,
  code: r`~~~csharp
// Classic singleton: hidden global dependency
public sealed class RateCache
{
    public static RateCache Instance { get; } = new();
    private RateCache() { }
    public decimal Get(string pair) => 1m;
}
var r = RateCache.Instance.Get("EURUSD");          // untestable, unswappable

// DI singleton lifetime: explicit dependency, replaceable in tests
builder.Services.AddSingleton<IRateCache, RateCache2>();
public sealed class Quoter(IRateCache rates) { }

// Thread-safe lazy static for pure data
private static readonly Lazy<FrozenDictionary<string, int>> MinorUnits =
    new(() => LoadIso4217().ToFrozenDictionary(x => x.Code, x => x.Digits));
~~~`,
  pts: [r`Classic Singleton hides dependencies and global state.`, r`It makes testing and per-tenant lifetimes hard.`, r`Use a DI singleton lifetime instead: explicit and replaceable.`, r`Lazy<T> or static readonly for pure, immutable data.`, r`Singleton lifetime is right for thread-safe shared clients.`],
  ex: r`A static ConfigurationManager singleton blocked running tests in parallel; replacing it with injected options removed flaky tests overnight.`,
  fu: [r`What makes a service safe to register as a singleton?`],
  pit: [r`Singleton services holding per-request or per-user state.`] },

{ id: 'q4', level: 'Basic', tags: ['decorator'],
  q: r`Explain the Decorator pattern and give three uses in a .NET service.`,
  a: r`A **decorator** implements the same interface as the object it wraps and adds behaviour before/after delegating. Decorators compose: caching(retry(logging(real))).

Common .NET uses:

1. **Caching** around a repository or HTTP client.
2. **Resilience** (retry, circuit breaker) around external calls; {{HttpClient}} {{DelegatingHandler}}s are decorators.
3. **Telemetry/auditing**: timing, metrics, audit logs around use cases.
4. **Authorisation** checks around application services.
5. Stream decorators in the BCL: {{GZipStream}} wrapping {{FileStream}}, {{BufferedStream}}.

Benefits: open/closed, single responsibility per decorator, composition at registration time. Costs: ordering mistakes, deeper call stacks, decorators that subtly change the contract (stale cache data).`,
  code: r`~~~csharp
// HttpClient handlers are decorators around the network call
public sealed class SigningHandler(IHmacSigner signer) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        req.Headers.Add("X-Signature", signer.Sign(req));          // before
        var res = await base.SendAsync(req, ct);                   // delegate
        return res;                                                // after (could log, map errors)
    }
}
builder.Services.AddTransient<SigningHandler>();
builder.Services.AddHttpClient<IPartnerApi, PartnerApi>().AddHttpMessageHandler<SigningHandler>().AddStandardResilienceHandler();

// Stream decorators from the BCL
await using var file = File.Create("export.csv.gz");
await using var gzip = new GZipStream(file, CompressionLevel.Optimal);
await using var writer = new StreamWriter(gzip);
~~~`,
  pts: [r`A decorator wraps the same interface and adds behaviour around the call.`, r`Uses: caching, resilience, telemetry, auditing, authorisation.`, r`HttpClient DelegatingHandlers and BCL streams are decorators.`, r`Composition order matters.`, r`Decorators must not silently change the contract.`],
  ex: r`Request signing for a bank partner API was added as a DelegatingHandler; no call site changed.`,
  fu: [r`Decorator vs Proxy vs Adapter?`],
  pit: [r`Logging decorators that log full request bodies with PII.`] },

{ id: 'q5', level: 'Basic', tags: ['adapter'],
  q: r`What is the Adapter pattern, and how does it relate to an anti-corruption layer?`,
  a: r`An **adapter** converts one interface into another that a client expects. It lets incompatible components work together without changing either.

In service architecture the same idea at larger scale is an **anti-corruption layer (ACL)**: an adapter plus translation that protects your domain model from a foreign model (legacy system, vendor API, another bounded context). The ACL maps names, types, units, statuses and errors so the foreign concepts never leak inward.

Typical .NET adapters:

- A vendor SDK wrapped behind your port ({{IPaymentGateway}} implemented by a Stripe adapter).
- Legacy SOAP services exposed through a modern interface.
- Mapping a third-party status code set to your domain enum.

Keep adapters thin in behaviour but thorough in translation, and test them against recorded vendor responses.`,
  code: r`~~~csharp
// Our port
public interface ISanctionsScreening { Task<ScreeningResult> ScreenAsync(Party party, CancellationToken ct); }
public enum ScreeningResult { Clear, PotentialMatch, Blocked }

// Adapter + anti-corruption mapping for a vendor's SOAP API
public sealed class VendorScreeningAdapter(VendorSoapClient client) : ISanctionsScreening
{
    public async Task<ScreeningResult> ScreenAsync(Party p, CancellationToken ct)
    {
        var resp = await client.CheckEntityAsync(new CheckEntityRequest { FullName = p.LegalName, Dob = p.DateOfBirth?.ToString("yyyyMMdd"), Ctry = p.CountryIso2 });
        return resp.ResultCode switch
        {
            "00" => ScreeningResult.Clear,
            "10" or "11" => ScreeningResult.PotentialMatch,     // fuzzy hits need human review
            "99" => ScreeningResult.Blocked,
            _ => throw new UnexpectedVendorResponseException(resp.ResultCode)
        };
    }
}
~~~`,
  pts: [r`An adapter converts an interface into the one the client expects.`, r`An anti-corruption layer is an adapter plus model translation at a boundary.`, r`Map names, units, statuses and errors so foreign concepts stay out.`, r`Wrap vendor SDKs behind your own ports.`, r`Test adapters against recorded vendor responses.`],
  ex: r`Swapping a sanctions-screening vendor required only a new adapter; the onboarding flow saw the same three outcomes.`,
  fu: [r`Where should an anti-corruption layer live in a microservice?`],
  pit: [r`Leaking vendor status codes into domain logic.`] },

{ id: 'q6', level: 'Basic', tags: ['observer', 'events'],
  q: r`Observer pattern in .NET: events, IObservable, and in-process mediators. When do you use which?`,
  a: r`The **Observer** pattern lets subjects notify subscribers without knowing them.

.NET options:

- **C# events/delegates**: simple in-process notifications (UI, component events). Watch memory leaks (publisher keeps subscribers alive) and exceptions stopping later handlers.
- **IObservable / Rx.NET**: streams of events with composition (filter, throttle, buffer, window). Good for real-time data (prices, telemetry).
- **Mediator / notification handlers** (MediatR {{INotification}} or your own dispatcher): decoupled in-process domain event handling with DI-resolved handlers.
- **Channels** ({{System.Threading.Channels}}): producer/consumer with backpressure.
- **Message brokers**: observer across processes (Kafka, Service Bus) with durability.

Choose by **scope** (in-process vs cross-service), **durability** (can a missed notification be tolerated?) and **composition needs** (Rx for time-based operators).`,
  code: r`~~~csharp
// Rx: throttle a price stream to one update per symbol per 250 ms for the UI
IObservable<PriceTick> ticks = feed.Ticks;
var uiUpdates = ticks.GroupBy(t => t.Symbol)
    .SelectMany(g => g.Sample(TimeSpan.FromMilliseconds(250)))
    .Subscribe(t => hub.Clients.Group(t.Symbol).SendAsync("px", t));

// Channel: backpressured in-process observer
var channel = Channel.CreateBounded<OrderPlaced>(new BoundedChannelOptions(1000) { FullMode = BoundedChannelFullMode.Wait });
await channel.Writer.WriteAsync(new OrderPlaced(orderId), ct);
await foreach (var e in channel.Reader.ReadAllAsync(ct)) await loyalty.AwardAsync(e, ct);
~~~`,
  pts: [r`Observer decouples subjects from subscribers.`, r`Events for simple in-process notifications; watch leaks and exceptions.`, r`Rx for composable, time-based event streams.`, r`Mediator handlers and channels for decoupled in-process reactions with backpressure.`, r`Brokers when notifications must survive process failure.`],
  ex: r`A trading UI throttled price ticks with Rx Sample, cutting SignalR traffic by 90% without losing the latest price.`,
  fu: [r`How do you avoid memory leaks with events?`],
  pit: [r`Using in-process events for notifications that must not be lost.`] },

{ id: 'q7', level: 'Intermediate', tags: ['builder'],
  q: r`When is the Builder pattern worth it in C#, given object initialisers, records and required members?`,
  a: r`Modern C# removes most simple builder needs: object initialisers, {{required}} members, records with {{with}}, and optional parameters.

Builders are still valuable when:

- Construction has **multiple steps with validation across fields** ("if card payment then CVV required").
- You want a **fluent DSL** that reads like configuration ({{WebApplication.CreateBuilder}}, {{HostBuilder}}, Polly {{ResiliencePipelineBuilder}}).
- The final object is **immutable** but assembled incrementally.
- **Test data builders**: readable fixtures with sensible defaults ({{An.Order().WithLines(3).Paid().Build()}}).

Avoid builders that merely mirror properties with setters; they add code without adding validation or readability.`,
  code: r`~~~csharp
// Test data builder: readable intent, sensible defaults
public sealed class OrderBuilder
{
    private Guid _customer = Guid.NewGuid(); private readonly List<OrderLine> _lines = new(); private bool _paid;
    public OrderBuilder ForCustomer(Guid id) { _customer = id; return this; }
    public OrderBuilder WithLines(int n) { for (var i = 0; i < n; i++) _lines.Add(new("SKU-" + i, 1, 10m)); return this; }
    public OrderBuilder Paid() { _paid = true; return this; }
    public Order Build()
    {
        var o = Order.Create(_customer, _lines.Count > 0 ? _lines : [new("SKU-0", 1, 10m)]);
        if (_paid) o.MarkPaid("test-ref");
        return o;
    }
}
public static class An { public static OrderBuilder Order() => new(); }
var order = An.Order().WithLines(3).Paid().Build();

// Framework builders you already use
var pipeline = new ResiliencePipelineBuilder().AddRetry(new() { MaxRetryAttempts = 3 }).AddTimeout(TimeSpan.FromSeconds(2)).Build();
~~~`,
  pts: [r`Initialisers, required members and records cover most simple construction.`, r`Use builders for multi-step, cross-field-validated construction.`, r`Fluent DSLs for configuration are builders (host, resilience pipelines).`, r`Test data builders make fixtures readable with defaults.`, r`Avoid builders that only mirror setters.`],
  ex: r`Test data builders cut a payment test suite's setup code by half and made each test's intent obvious.`,
  fu: [r`How do you enforce required steps in a fluent builder at compile time?`],
  pit: [r`Builders that allow building invalid objects.`] },

{ id: 'q8', level: 'Intermediate', tags: ['template-method'],
  q: r`Template Method vs Strategy: which do you prefer and why?`,
  a: r`- **Template Method**: a base class defines the algorithm skeleton; subclasses override steps. Uses **inheritance**.
- **Strategy**: the varying step is an injected object. Uses **composition**.

Prefer Strategy in most application code: varying steps can be combined independently, tested in isolation, and swapped at runtime; inheritance couples subclasses to base-class internals (fragile base class).

Template Method still fits when:

- A framework defines the lifecycle ({{BackgroundService.ExecuteAsync}}, {{DelegatingHandler.SendAsync}}, {{ControllerBase}}).
- The skeleton is stable and owned by one team, with few, well-defined hooks.

A hybrid is common: a small base class handles invariant steps (logging, error handling) and delegates the variable work to injected strategies.`,
  code: r`~~~csharp
// Template method: fixed import skeleton, subclasses supply parsing
public abstract class FileImporter
{
    public async Task<ImportResult> ImportAsync(Stream file, CancellationToken ct)
    {
        var rows = await ParseAsync(file, ct);                 // variable step
        var valid = rows.Where(Validate).ToList();             // hook with default
        await SaveAsync(valid, ct);                            // fixed step
        return new ImportResult(rows.Count, valid.Count);
    }
    protected abstract Task<IReadOnlyList<Row>> ParseAsync(Stream file, CancellationToken ct);
    protected virtual bool Validate(Row r) => r.Amount > 0;
    protected abstract Task SaveAsync(IReadOnlyList<Row> rows, CancellationToken ct);
}
// Strategy alternative: compose parser and validator
public sealed class Importer(IRowParser parser, IRowValidator validator, IRowSink sink)
{
    public async Task<ImportResult> ImportAsync(Stream f, CancellationToken ct)
    { var rows = await parser.ParseAsync(f, ct); var ok = rows.Where(validator.IsValid).ToList(); await sink.SaveAsync(ok, ct); return new(rows.Count, ok.Count); }
}
~~~`,
  pts: [r`Template Method varies steps via inheritance; Strategy via composition.`, r`Prefer Strategy: independent, testable, runtime-swappable variations.`, r`Template Method fits framework lifecycles and stable skeletons.`, r`Hybrid: small base for invariants, strategies for variable work.`, r`Watch the fragile base class problem.`],
  ex: r`A file-import framework with 12 subclasses each overriding different hooks was refactored into parser, validator and sink strategies; new formats became a parser class only.`,
  fu: [r`How does this relate to the Hollywood principle?`],
  pit: [r`Deep template hierarchies with many optional hooks.`] },

{ id: 'q9', level: 'Intermediate', tags: ['chain-of-responsibility', 'pipelines'],
  q: r`Chain of Responsibility: how do ASP.NET Core middleware, HttpClient handlers and validation pipelines implement it?`,
  a: r`**Chain of Responsibility** passes a request along a chain of handlers; each handler decides to process it, pass it on, or short-circuit.

In .NET:

- **ASP.NET Core middleware**: each component calls {{next(context)}} or short-circuits (authentication failure returns 401 without reaching the endpoint).
- **HttpClient DelegatingHandlers**: outbound chain (auth header, logging, retry).
- **MediatR pipeline behaviours / endpoint filters**: validation, transactions, caching around handlers.
- **Approval or rules chains**: business rules evaluated in order until one decides (fraud rules: allowlist, blocklist, velocity, model score).

Design points: order is behaviour; each link should do one thing; make short-circuit results explicit and observable (log which link decided).`,
  code: r`~~~csharp
public interface IFraudRule { Task<FraudDecision?> EvaluateAsync(Payment p, CancellationToken ct); }   // null = pass to next
public sealed class AllowlistRule(IAllowlist list) : IFraudRule
{ public async Task<FraudDecision?> EvaluateAsync(Payment p, CancellationToken ct) => await list.ContainsAsync(p.CardFingerprint, ct) ? FraudDecision.Allow : null; }
public sealed class VelocityRule(IVelocityStore v) : IFraudRule
{ public async Task<FraudDecision?> EvaluateAsync(Payment p, CancellationToken ct) => await v.CountLastHourAsync(p.CardFingerprint, ct) > 5 ? FraudDecision.Review : null; }

public sealed class FraudChain(IEnumerable<IFraudRule> rules, ILogger<FraudChain> log)   // registration order = chain order
{
    public async Task<FraudDecision> DecideAsync(Payment p, CancellationToken ct)
    {
        foreach (var rule in rules)
            if (await rule.EvaluateAsync(p, ct) is { } d) { log.LogInformation("{Rule} decided {Decision}", rule.GetType().Name, d); return d; }
        return FraudDecision.Allow;
    }
}
~~~`,
  pts: [r`Each handler processes, passes on, or short-circuits.`, r`Middleware, DelegatingHandlers and pipeline behaviours are chains.`, r`Order is behaviour; make it explicit and tested.`, r`Each link should do one thing.`, r`Log which link decided for observability and audit.`],
  ex: r`A fraud chain logged the deciding rule for every payment, which let analysts see that one velocity rule produced 60% of manual reviews and tune it.`,
  fu: [r`How do you test the order of a chain?`],
  pit: [r`Hidden dependencies between links that break when order changes.`] },

{ id: 'q10', level: 'Intermediate', tags: ['state'],
  q: r`Use the State pattern for a payment lifecycle. When is a simple enum + switch better?`,
  a: r`The **State** pattern models each state as an object implementing the operations allowed in that state; transitions replace the current state object. It removes large switch statements repeated across operations.

Use the State pattern when behaviour differs **substantially** per state and many operations depend on state. Use an **enum + guarded transition methods** when:

- Operations mostly just check "is this transition allowed?".
- You need the state persisted as a simple column (ORM friendliness).
- A transition table makes rules visible at a glance.

A pragmatic middle ground: an enum persisted on the entity plus a **transition table** (data or a library such as Stateless) that enforces allowed transitions and triggers, generating a diagram for documentation.`,
  code: r`~~~csharp
public enum PaymentStatus { Created, Authorised, Captured, Refunded, Voided, Failed }
public sealed class Payment
{
    private static readonly Dictionary<(PaymentStatus, string), PaymentStatus> Transitions = new()
    {
        [(PaymentStatus.Created, "authorise")] = PaymentStatus.Authorised,
        [(PaymentStatus.Created, "fail")] = PaymentStatus.Failed,
        [(PaymentStatus.Authorised, "capture")] = PaymentStatus.Captured,
        [(PaymentStatus.Authorised, "void")] = PaymentStatus.Voided,
        [(PaymentStatus.Captured, "refund")] = PaymentStatus.Refunded,
    };
    public PaymentStatus Status { get; private set; } = PaymentStatus.Created;
    private void Fire(string trigger) =>
        Status = Transitions.TryGetValue((Status, trigger), out var next) ? next
               : throw new InvalidOperationException($"Cannot {trigger} a {Status} payment");
    public void Authorise() => Fire("authorise");
    public void Capture() => Fire("capture");
    public void Refund() => Fire("refund");
}
~~~`,
  dia: r`stateDiagram-v2
  [*] --> Created
  Created --> Authorised: authorise
  Created --> Failed: fail
  Authorised --> Captured: capture
  Authorised --> Voided: void
  Captured --> Refunded: refund
  Failed --> [*]
  Voided --> [*]
  Refunded --> [*]`,
  pts: [r`State pattern: one object per state with the operations allowed there.`, r`Use it when behaviour differs substantially per state.`, r`Enum plus a transition table is simpler and ORM-friendly.`, r`Make the allowed transitions explicit, tested and diagrammed.`, r`Persist state with optimistic concurrency.`],
  ex: r`A refund bug (refunding an authorised-but-not-captured payment) disappeared once a transition table rejected the move.`,
  fu: [r`How do you handle out-of-order webhook events in this state machine?`],
  pit: [r`Public status setters that bypass transitions.`] },

{ id: 'q11', level: 'Intermediate', tags: ['repository', 'unit-of-work'],
  q: r`Repository and Unit of Work with EF Core: useful abstraction or redundant layer?`,
  a: r`EF Core's {{DbContext}} already **is** a Unit of Work (change tracking, {{SaveChanges}} as one transaction) and {{DbSet<T>}} is a generic repository. Wrapping them in generic {{IRepository<T>}} + {{IUnitOfWork}} often:

- Leaks {{IQueryable}} anyway, or hides useful features (projections, {{AsNoTracking}}, split queries, bulk {{ExecuteUpdate}}).
- Adds a layer with no behaviour.

Repositories **are** worth it when they are **aggregate-specific and use-case-shaped**:

- {{IOrderRepository.GetForCheckoutAsync(id)}} loading exactly the aggregate with its invariant-relevant children.
- Keeping the domain/application layer free of EF types (DIP), so domain tests do not need a database.

Recommended split: repositories for **write-side aggregates**; direct DbContext/Dapper **query handlers** for reads; {{DbContext.SaveChangesAsync}} (or a thin {{IUnitOfWork}} that also dispatches domain events and writes the outbox) for commits.`,
  code: r`~~~csharp
// Aggregate-specific repository: intention-revealing, no IQueryable leak
public interface IOrderRepository
{
    Task<Order?> GetForUpdateAsync(OrderId id, CancellationToken ct);
    Task AddAsync(Order order, CancellationToken ct);
}
public sealed class EfOrderRepository(OrdersDb db) : IOrderRepository
{
    public Task<Order?> GetForUpdateAsync(OrderId id, CancellationToken ct) =>
        db.Orders.Include(o => o.Lines).SingleOrDefaultAsync(o => o.Id == id, ct);
    public async Task AddAsync(Order order, CancellationToken ct) => await db.Orders.AddAsync(order, ct);
}
// Thin unit of work: commit + outbox in one SaveChanges
public sealed class EfUnitOfWork(OrdersDb db) : IUnitOfWork
{
    public async Task CommitAsync(CancellationToken ct)
    {
        foreach (var e in db.ChangeTracker.Entries<AggregateRoot>().SelectMany(x => x.Entity.PopEvents()))
            db.Outbox.Add(OutboxMessage.From(e));
        await db.SaveChangesAsync(ct);
    }
}
// Reads bypass repositories: projections straight to DTOs
public Task<List<OrderRow>> ListAsync(Guid customerId, CancellationToken ct) =>
    db.Orders.AsNoTracking().Where(o => o.CustomerId == customerId).Select(o => new OrderRow(o.Id, o.Total)).ToListAsync(ct);
~~~`,
  pts: [r`DbContext is already a unit of work; DbSet is already a generic repository.`, r`Generic repositories over EF usually leak or hide features.`, r`Aggregate-specific repositories keep the domain free of EF and express intent.`, r`Reads go straight to projections; writes go through repositories.`, r`A thin unit of work can add outbox writes and domain event dispatch.`],
  ex: r`Removing a generic repository layer let a team use projections and ExecuteUpdate, cutting a batch job from 20 minutes to 90 seconds.`,
  fu: [r`How do you test repositories?`, r`Specification pattern: worth it?`],
  pit: [r`IRepository<T> exposing IQueryable to controllers.`] },

{ id: 'q12', level: 'Intermediate', tags: ['mediator', 'mediatr'],
  q: r`Mediator pattern and MediatR: what problem does it solve and when is it unnecessary indirection?`,
  a: r`The **Mediator** pattern centralises communication so components do not reference each other directly. MediatR applies it to **request/handler dispatch**: controllers send a command; a handler is resolved by type; pipeline behaviours wrap every request.

Benefits:

- Thin endpoints; one handler per use case (vertical slices).
- Cross-cutting behaviours (validation, logging, transactions) applied uniformly.
- Same handlers callable from HTTP, message consumers and jobs.

Costs:

- **Indirection**: "go to definition" from the controller lands on {{Send}}, not the handler.
- Runtime resolution errors instead of compile-time.
- Performance overhead (small) and allocation per request.
- **Licensing**: MediatR moved to a commercial licence for newer versions (2025); evaluate terms or alternatives.

Alternatives: inject handlers directly ({{PlaceOrderHandler}}), minimal API endpoint filters, source-generated mediators (Mediator by martinothamar), or Wolverine. For small services, direct handler injection is often clearer.`,
  code: r`~~~csharp
// With a mediator
public sealed record PlaceOrder(Guid CustomerId, List<LineDto> Lines) : IRequest<Guid>;
public sealed class PlaceOrderHandler(IOrderRepository repo, IUnitOfWork uow) : IRequestHandler<PlaceOrder, Guid>
{
    public async Task<Guid> Handle(PlaceOrder cmd, CancellationToken ct)
    { var o = Order.Create(cmd.CustomerId, cmd.Lines); await repo.AddAsync(o, ct); await uow.CommitAsync(ct); return o.Id.Value; }
}
app.MapPost("/orders", (PlaceOrder cmd, ISender sender, CancellationToken ct) => sender.Send(cmd, ct));

// Without: direct injection, compile-time navigation, cross-cutting via endpoint filters
app.MapPost("/orders", (PlaceOrder cmd, PlaceOrderHandler h, CancellationToken ct) => h.Handle(cmd, ct))
   .AddEndpointFilter<ValidationFilter<PlaceOrder>>();
~~~`,
  pts: [r`Mediator dispatches requests to handlers and wraps them with pipeline behaviours.`, r`Good for vertical slices and uniform cross-cutting concerns.`, r`Costs: indirection, runtime resolution, small overhead, licence terms.`, r`Alternatives: direct handler injection, endpoint filters, source-generated mediators.`, r`Choose based on team size and how many entry points share handlers.`],
  ex: r`A team removed MediatR from a 15-endpoint service and injected handlers directly; navigation improved and nothing else changed. A 300-handler platform kept a source-generated mediator for uniform behaviours.`,
  fu: [r`How would you implement a transaction behaviour?`],
  pit: [r`Handlers sending other commands through the mediator in long hidden chains.`] },

{ id: 'q13', level: 'Intermediate', tags: ['proxy'],
  q: r`Proxy vs Decorator vs Adapter: how do you tell them apart in real code?`,
  a: r`All three wrap another object; the **intent** differs:

| Pattern | Interface | Intent | Examples |
|---|---|---|---|
| Adapter | Different from the wrapped object | Make an incompatible interface fit | Vendor SDK behind your port |
| Decorator | Same | Add behaviour | Caching, retry, metrics |
| Proxy | Same | Control access to the real object | Lazy loading, remote proxy (gRPC client), security proxy, EF Core lazy-loading proxies |

Proxies in .NET: EF Core lazy-loading proxies (Castle DynamicProxy subclasses entities), {{DispatchProxy}} for generated interface proxies, gRPC/WCF client stubs (remote proxy), Azure SDK clients.

Remote proxies hide the network: callers may forget that calls can fail, be slow or partially succeed. Make that visible in the interface (async, cancellation, explicit error results).`,
  code: r`~~~csharp
// DispatchProxy: a generated proxy that times every interface call
public class TimingProxy<T> : DispatchProxy where T : class
{
    public T Target { get; set; } = default!; public ILogger Log { get; set; } = default!;
    protected override object? Invoke(MethodInfo? method, object?[]? args)
    {
        var sw = Stopwatch.StartNew();
        try { return method!.Invoke(Target, args); }
        finally { Log.LogDebug("{Method} took {Ms} ms", method!.Name, sw.ElapsedMilliseconds); }
    }
    public static T Create(T target, ILogger log)
    { var p = Create<T, TimingProxy<T>>(); ((TimingProxy<T>)(object)p).Target = target; ((TimingProxy<T>)(object)p).Log = log; return p; }
}
// Note: for async methods, time the returned Task's completion, not the synchronous return
~~~`,
  pts: [r`Adapter changes the interface; Decorator and Proxy keep it.`, r`Decorator adds behaviour; Proxy controls access (lazy, remote, security).`, r`EF lazy-loading proxies and gRPC clients are proxies.`, r`Remote proxies hide the network; make failure visible in signatures.`, r`DispatchProxy generates interface proxies at runtime.`],
  ex: r`EF Core lazy-loading proxies caused an N+1 storm in an API serialiser; disabling them and using explicit includes fixed a 4-second endpoint.`,
  fu: [r`Why can lazy-loading proxies be dangerous in web APIs?`],
  pit: [r`Treating a remote proxy as if calls were local and cheap.`] },

{ id: 'q14', level: 'Intermediate', tags: ['facade'],
  q: r`When is a Facade helpful, and when does it become a god object?`,
  a: r`A **Facade** provides a simple interface to a complex subsystem: one call for a common use case instead of orchestrating many classes.

Helpful when:

- A subsystem (e.g. a document-generation stack: templates, PDF rendering, storage, signing) has many moving parts but clients need a few use cases.
- You want to **limit what other modules can touch** (a module's public API in a modular monolith is a facade).
- Integrating a legacy system behind a stable surface.

It becomes a god object when it accumulates every operation of the subsystem, contains business logic itself, or is used as a dumping ground. Keep facades **thin, use-case oriented, and free of business rules** (delegate them), and split them by client need (ISP).`,
  code: r`~~~csharp
// Module facade: the only public entry point to the Documents module
public interface IDocumentsModule
{
    Task<DocumentRef> GenerateStatementAsync(Guid accountId, DateOnly month, CancellationToken ct);
    Task<Stream> DownloadAsync(DocumentRef doc, CancellationToken ct);
}
internal sealed class DocumentsFacade(ITemplateStore templates, IPdfRenderer pdf, IBlobStore blobs, IDocumentSigner signer, IStatementData data)
    : IDocumentsModule
{
    public async Task<DocumentRef> GenerateStatementAsync(Guid accountId, DateOnly month, CancellationToken ct)
    {
        var model = await data.LoadAsync(accountId, month, ct);
        var html = await templates.RenderAsync("statement-v3", model, ct);
        var signed = await signer.SignAsync(await pdf.RenderAsync(html, ct), ct);
        return await blobs.SaveAsync("statements/" + accountId + "/" + month.ToString("yyyy-MM") + ".pdf", signed, ct);
    }
    public Task<Stream> DownloadAsync(DocumentRef doc, CancellationToken ct) => blobs.OpenAsync(doc, ct);
}
~~~`,
  pts: [r`A facade offers a simple, use-case interface over a complex subsystem.`, r`Module public APIs in a modular monolith are facades.`, r`Keep facades thin and free of business rules.`, r`Split facades by client need to avoid god objects.`, r`Good for wrapping legacy subsystems behind stable surfaces.`],
  ex: r`A documents module exposed two facade methods; 14 internal classes could be refactored freely without affecting the 8 modules that generated statements.`,
  fu: [r`Facade vs API gateway?`],
  pit: [r`Facades with 60 methods covering every internal operation.`] },

{ id: 'q15', level: 'Intermediate', tags: ['command'],
  q: r`Explain the Command pattern and how it shows up in CQRS, queues and undo.`,
  a: r`A **Command** turns a request into an object: it can be queued, logged, retried, scheduled, serialised, validated and undone.

Where it shows up:

- **CQRS commands** ({{ApproveLoan}} record + handler): intent is explicit and auditable.
- **Message queues**: a command message sent to exactly one handler (vs events, which are broadcast facts).
- **Background jobs**: Hangfire/Quartz jobs are serialised commands.
- **Undo/redo** in UIs: each command stores what is needed to reverse it.
- **Outbox**: commands persisted before sending guarantee delivery.

Design: commands are **imperative** ({{CapturePayment}}), validated before execution, carry an **id** for idempotency, and contain the actor for audit.`,
  code: r`~~~csharp
public sealed record CapturePayment(Guid CommandId, Guid PaymentId, decimal Amount, string RequestedBy);   // serialisable intent
public sealed class CapturePaymentHandler(IPaymentRepository payments, IProcessedCommands processed, IUnitOfWork uow)
{
    public async Task HandleAsync(CapturePayment cmd, CancellationToken ct)
    {
        if (!await processed.TryMarkAsync(cmd.CommandId, ct)) return;     // idempotent on redelivery
        var p = await payments.GetAsync(cmd.PaymentId, ct);
        p.Capture(cmd.Amount, cmd.RequestedBy);
        await uow.CommitAsync(ct);
    }
}
// The same command can arrive via HTTP, a queue or a scheduler
await sender.SendAsync(new ServiceBusMessage(JsonSerializer.Serialize(cmd)) { MessageId = cmd.CommandId.ToString() }, ct);
~~~`,
  pts: [r`A command is a request turned into an object: queueable, loggable, retryable.`, r`CQRS commands, queue messages and background jobs are commands.`, r`Commands go to one handler; events are broadcast facts.`, r`Carry an id for idempotency and the actor for audit.`, r`Name commands imperatively.`],
  ex: r`Persisting payment commands with ids made retries after timeouts safe and gave auditors a full record of who requested each capture.`,
  fu: [r`Command vs event: how do you name and route them?`],
  pit: [r`Commands without ids, so redelivery double-executes.`] },

{ id: 'q16', level: 'Intermediate', tags: ['specification'],
  q: r`What is the Specification pattern, and is it worth using with EF Core?`,
  a: r`A **Specification** encapsulates a business rule or query criterion as an object that can be combined ({{And}}, {{Or}}, {{Not}}) and evaluated in memory or translated to a query.

Useful when:

- The same business criterion ("eligible for premium support") is used in several queries and in-memory checks.
- Criteria are combined dynamically (search screens with many filters).
- You want rules named in domain language and unit-tested.

With EF Core, specs typically hold an {{Expression<Func<T, bool>>}} so they translate to SQL; libraries like Ardalis.Specification add includes, ordering and paging.

Not worth it for one-off queries: a plain LINQ query in a query handler is clearer. Also be careful that specifications do not become a way to rebuild a generic repository with unbounded queries.`,
  code: r`~~~csharp
public abstract class Spec<T>
{
    public abstract Expression<Func<T, bool>> ToExpression();
    public bool IsSatisfiedBy(T x) => ToExpression().Compile()(x);
    public Spec<T> And(Spec<T> other) => new AndSpec<T>(this, other);
}
public sealed class AndSpec<T>(Spec<T> a, Spec<T> b) : Spec<T>
{
    public override Expression<Func<T, bool>> ToExpression()
    {
        var l = a.ToExpression(); var r = b.ToExpression();
        var p = Expression.Parameter(typeof(T));
        var body = Expression.AndAlso(Expression.Invoke(l, p), Expression.Invoke(r, p));
        return Expression.Lambda<Func<T, bool>>(body, p);
    }
}
public sealed class PremiumEligible : Spec<Customer>
{ public override Expression<Func<Customer, bool>> ToExpression() => c => c.AnnualRevenue >= 1_000_000m && !c.IsSuspended; }
public sealed class InRegion(string region) : Spec<Customer>
{ public override Expression<Func<Customer, bool>> ToExpression() => c => c.Region == region; }

var spec = new PremiumEligible().And(new InRegion("EMEA"));
var list = await db.Customers.Where(spec.ToExpression()).ToListAsync(ct);   // translated to SQL
var ok = spec.IsSatisfiedBy(customer);                                      // same rule in memory
~~~`,
  pts: [r`Specifications name business criteria as composable objects.`, r`One rule can run in memory and translate to SQL via expressions.`, r`Useful for reused criteria and dynamic filters.`, r`Overkill for one-off queries.`, r`Do not let specs become an unbounded generic-repository query API.`],
  ex: r`An eligibility rule used in five reports and the API stayed consistent after it was captured once as a specification.`,
  fu: [r`Why can Expression.Invoke fail to translate in some providers?`],
  pit: [r`Compiling expressions on every in-memory check in a hot loop.`] },

{ id: 'q17', level: 'Intermediate', tags: ['object-pool', 'flyweight'],
  q: r`Object Pool and Flyweight: when do they help performance in .NET?`,
  a: r`- **Object Pool**: reuse expensive objects instead of allocating them repeatedly. In .NET: {{ArrayPool<T>}}, {{ObjectPool<T>}} (Microsoft.Extensions.ObjectPool), {{DbContext}} pooling, HTTP connection pools, {{StringBuilder}} pooling. Helps when objects are expensive to create or cause GC pressure at high rates. Risks: returning objects with stale state, leaking pooled objects, using after return.
- **Flyweight**: share immutable intrinsic state among many objects (string interning, cached immutable value objects like currency definitions, glyph objects in editors). Reduces memory for large numbers of similar objects.

Both are optimisations: measure with allocation profiling (BenchmarkDotNet {{MemoryDiagnoser}}, dotnet-counters GC metrics) before applying.`,
  code: r`~~~csharp
// Object pool: reuse StringBuilders in a hot formatting path
private static readonly ObjectPool<StringBuilder> Pool = new DefaultObjectPoolProvider().CreateStringBuilderPool();
public static string FormatLine(Trade t)
{
    var sb = Pool.Get();
    try { return sb.Append(t.Id).Append(',').Append(t.Price).Append(',').Append(t.Qty).ToString(); }
    finally { Pool.Return(sb); }   // the policy clears it
}
// Flyweight: one shared immutable Currency per ISO code
public sealed record Currency(string Code, int MinorUnits)
{
    private static readonly FrozenDictionary<string, Currency> All =
        new[] { new Currency("GBP", 2), new Currency("JPY", 0), new Currency("KWD", 3) }.ToFrozenDictionary(c => c.Code);
    public static Currency Of(string code) => All[code];
}
~~~`,
  pts: [r`Object pools reuse expensive or high-churn objects.`, r`.NET already pools arrays, DbContexts and connections.`, r`Flyweight shares immutable state among many objects.`, r`Risks: stale state, leaks, use-after-return.`, r`Measure allocations before applying either.`],
  ex: r`Pooling buffers in a market-data parser cut gen-0 collections by 80% at 200,000 messages per second.`,
  fu: [r`When does pooling make performance worse?`],
  pit: [r`Pooling cheap objects and adding contention.`] },

{ id: 'q18', level: 'Intermediate', tags: ['composite', 'visitor'],
  q: r`Composite and Visitor: when do they fit, and how does C# pattern matching change Visitor?`,
  a: r`- **Composite** treats individual objects and groups uniformly: a pricing bundle containing products and other bundles; an org chart; a rules tree ({{And(rule, Or(rule, rule))}}). Clients call {{Price()}} on any node.
- **Visitor** adds operations to a stable object structure without changing its classes (double dispatch). Classic use: ASTs, expression trees ({{ExpressionVisitor}} in .NET), document models.

Modern C# **pattern matching** over a closed hierarchy of records often replaces Visitor: a {{switch}} expression implements an operation over all node types in one place, without accept/visit boilerplate. Use the classic Visitor when the structure is extended by others or you need {{ExpressionVisitor}}-style tree rewriting.`,
  code: r`~~~csharp
// Composite: products and bundles priced uniformly
public abstract record CatalogItem { public abstract Money Price(); }
public sealed record Product(string Sku, Money Unit) : CatalogItem { public override Money Price() => Unit; }
public sealed record Bundle(string Name, IReadOnlyList<CatalogItem> Items, decimal DiscountPct) : CatalogItem
{ public override Money Price() => Items.Select(i => i.Price()).Aggregate((a, b) => a + b) * (1 - DiscountPct); }

// Pattern matching as a lightweight visitor over a closed rule tree
public abstract record Rule;
public sealed record AmountOver(decimal Limit) : Rule;
public sealed record CountryIs(string Iso) : Rule;
public sealed record And(Rule L, Rule R) : Rule;
public sealed record Or(Rule L, Rule R) : Rule;
static bool Eval(Rule r, Payment p) => r switch
{
    AmountOver a => p.Amount > a.Limit,
    CountryIs c => p.Country == c.Iso,
    And x => Eval(x.L, p) && Eval(x.R, p),
    Or x => Eval(x.L, p) || Eval(x.R, p),
    _ => throw new UnreachableException()
};
static string Describe(Rule r) => r switch { And x => "(" + Describe(x.L) + " AND " + Describe(x.R) + ")", Or x => "(" + Describe(x.L) + " OR " + Describe(x.R) + ")", _ => r.ToString() };
~~~`,
  pts: [r`Composite treats leaves and groups uniformly (bundles, trees).`, r`Visitor adds operations to a stable structure via double dispatch.`, r`Pattern matching over records replaces most visitors.`, r`ExpressionVisitor remains the tool for rewriting LINQ expression trees.`, r`Choose by whether types or operations change more often.`],
  ex: r`A fraud rules tree modelled as records with pattern-matching evaluators supported adding a "describe" and an "explain" operation without touching node types.`,
  fu: [r`What is double dispatch?`],
  pit: [r`Full visitor boilerplate for a three-node closed hierarchy.`] },

{ id: 'q19', level: 'Senior', tags: ['resilience', 'circuit-breaker'],
  q: r`Explain retry, circuit breaker, bulkhead and timeout as patterns. How do they combine, and in what order?`,
  a: r`- **Timeout**: bound how long you wait; without it nothing else works.
- **Retry** (with exponential backoff and jitter): recover from transient faults; only for idempotent operations.
- **Circuit breaker**: stop calling a failing dependency for a period, failing fast and letting it recover; half-open probes test recovery.
- **Bulkhead**: isolate resources (concurrency limits, separate pools) so one slow dependency cannot exhaust all threads/connections.
- **Fallback**: degraded response (cached value, default) when the call fails.
- **Hedging**: send a second request after a delay to cut tail latency (idempotent reads only).

Typical order from outside in: **total timeout -> retry -> circuit breaker -> per-attempt timeout -> bulkhead -> call**. The breaker sits inside retry so retries stop when the circuit opens; the per-attempt timeout makes each try bounded; the total timeout caps the whole operation within the caller's budget.

In .NET 8+, {{Microsoft.Extensions.Http.Resilience}} ({{AddStandardResilienceHandler}}) provides a sensible default pipeline built on Polly v8.`,
  code: r`~~~csharp
builder.Services.AddHttpClient<IPricingClient, PricingClient>()
    .AddResilienceHandler("pricing", p =>
    {
        p.AddTimeout(TimeSpan.FromSeconds(3));                                     // total budget
        p.AddRetry(new HttpRetryStrategyOptions { MaxRetryAttempts = 2, BackoffType = DelayBackoffType.Exponential, UseJitter = true,
            ShouldHandle = args => ValueTask.FromResult(args.Outcome.Result?.StatusCode is HttpStatusCode.ServiceUnavailable or HttpStatusCode.TooManyRequests
                                                         || args.Outcome.Exception is HttpRequestException) });
        p.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions { FailureRatio = 0.5, MinimumThroughput = 20,
            SamplingDuration = TimeSpan.FromSeconds(30), BreakDuration = TimeSpan.FromSeconds(15) });
        p.AddTimeout(TimeSpan.FromMilliseconds(800));                              // per attempt
        p.AddConcurrencyLimiter(100);                                              // bulkhead
    });
~~~`,
  dia: r`flowchart LR
  C[Caller] --> T1[Total timeout 3s]
  T1 --> R[Retry x2, backoff + jitter]
  R --> CB[Circuit breaker]
  CB --> T2[Attempt timeout 800ms]
  T2 --> B[Bulkhead: 100 concurrent]
  B --> D[Dependency]
  CB -. open: fail fast .-> F[Fallback / cached value]`,
  pts: [r`Timeouts first: without them nothing else is safe.`, r`Retry only idempotent operations, with exponential backoff and jitter.`, r`Circuit breakers fail fast and let dependencies recover.`, r`Bulkheads stop one slow dependency exhausting shared resources.`, r`Order: total timeout, retry, breaker, attempt timeout, bulkhead.`],
  ex: r`A pricing dependency outage used to take down checkout via thread starvation; a bulkhead plus breaker kept checkout up with cached prices.`,
  fu: [r`How do retries cause retry storms across layers?`, r`When would you use hedging?`],
  pit: [r`Retrying non-idempotent POSTs.`, r`Retries at every layer multiplying load (3 x 3 x 3).`] },

{ id: 'q20', level: 'Senior', tags: ['outbox', 'messaging-patterns'],
  q: r`Which messaging patterns (outbox, inbox, competing consumers, dead letter) does every event-driven .NET service need?`,
  a: r`- **Transactional outbox**: write domain changes and outgoing messages in one database transaction; a relay publishes later. Prevents lost or phantom events from dual writes.
- **Inbox / idempotent consumer**: record processed message ids (unique constraint) in the same transaction as the handler's changes, so redeliveries are no-ops.
- **Competing consumers**: several instances consume from one queue/partition group for throughput; ordering only within a partition/session key.
- **Dead-letter queue (DLQ)**: messages that fail after N attempts are moved aside with error details, alerted on, and replayed after fixes.
- **Retry with delay**: transient failures retried with backoff (scheduled redelivery), not tight loops.
- **Correlation/causation ids**: trace a flow across services.

Libraries (MassTransit, NServiceBus, Wolverine) implement these; know them well enough to configure and debug.`,
  code: r`~~~csharp
builder.Services.AddMassTransit(x =>
{
    x.AddConsumer<OrderPlacedConsumer>(c => c.UseMessageRetry(r => r.Exponential(5, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(1), TimeSpan.FromSeconds(2))));
    x.AddEntityFrameworkOutbox<OrdersDb>(o => { o.UseSqlServer(); o.UseBusOutbox(); });     // outbox for publishing
    x.UsingRabbitMq((ctx, cfg) =>
    {
        cfg.UseDelayedRedelivery(r => r.Intervals(TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(30)));
        cfg.ConfigureEndpoints(ctx);                     // failures after retries -> <queue>_error (dead letter)
    });
});
// Consumer-side inbox (MassTransit: UseEntityFrameworkOutbox on the receive endpoint also deduplicates)
~~~`,
  dia: r`flowchart LR
  API[Service A] -->|1 tx: state + outbox row| DB[(DB A)]
  DB --> RL[Outbox relay] --> BR[(Broker)]
  BR --> C1[Consumer B instance 1]
  BR --> C2[Consumer B instance 2]
  C1 & C2 -->|1 tx: inbox id + changes| DBB[(DB B)]
  BR -->|after N failures| DLQ[(Dead letter)] --> OPS[Alert + replay]`,
  pts: [r`Outbox: state and outgoing messages in one transaction.`, r`Inbox: processed-id record in the handler's transaction for idempotency.`, r`Competing consumers scale out; ordering only per key.`, r`DLQ with alerts and replay for poison messages.`, r`Delayed retries and correlation ids complete the set.`],
  ex: r`A team found 0.2% lost events with publish-after-commit and 1% duplicate side effects on redelivery; outbox plus inbox brought both to zero.`,
  fu: [r`How do you replay a dead-lettered message safely?`],
  pit: [r`At-least-once delivery without idempotent consumers.`] },

{ id: 'q21', level: 'Senior', tags: ['saga', 'process-manager'],
  q: r`Saga vs process manager vs routing slip: how do these coordination patterns differ?`,
  a: r`- **Saga**: a long-running business transaction made of local transactions with compensations. Can be choreographed (events) or orchestrated.
- **Process manager**: a component that maintains state for a process and decides the next step from incoming messages: the orchestrated form of a saga (MassTransit state machines, NServiceBus sagas, Temporal workflows).
- **Routing slip**: the message carries its itinerary (list of steps); each step processes and forwards to the next, recording compensation info (MassTransit Courier). No central coordinator; good for linear, dynamic pipelines.

Choose:

- Branching logic, timeouts, human steps: **process manager**.
- Linear steps whose list varies per message (document processing variants): **routing slip**.
- Few steps across autonomous services with simple reactions: **choreography**.`,
  code: r`~~~csharp
// Routing slip with MassTransit Courier: itinerary travels with the message
var builder = new RoutingSlipBuilder(NewId.NextGuid());
builder.AddActivity("ReserveStock", new Uri("queue:reserve-stock_execute"), new { OrderId = id, Lines = lines });
builder.AddActivity("ChargeCard",   new Uri("queue:charge-card_execute"),   new { OrderId = id, Amount = total });
if (giftWrap) builder.AddActivity("GiftWrap", new Uri("queue:gift-wrap_execute"), new { OrderId = id });   // dynamic step
await bus.Execute(builder.Build());

public sealed class ChargeCardActivity : IActivity<ChargeArgs, ChargeLog>
{
    public async Task<ExecutionResult> Execute(ExecuteContext<ChargeArgs> ctx)
    { var chargeId = await Charge(ctx.Arguments); return ctx.Completed(new ChargeLog(chargeId)); }      // log used for compensation
    public async Task<CompensationResult> Compensate(CompensateContext<ChargeLog> ctx)
    { await Refund(ctx.Log.ChargeId); return ctx.Compensated(); }
}
~~~`,
  pts: [r`Saga: local transactions plus compensations.`, r`Process manager: a stateful orchestrator deciding next steps.`, r`Routing slip: the itinerary travels with the message.`, r`Process managers for branching, timeouts and human steps.`, r`Routing slips for linear pipelines whose steps vary per message.`],
  ex: r`A document-processing platform used routing slips because each document type had a different step list; order checkout used a process manager for its timeouts and branches.`,
  fu: [r`How is compensation recorded in a routing slip?`],
  pit: [r`Choreographing a complex, branching process.`] },

{ id: 'q22', level: 'Senior', tags: ['cqrs', 'event-sourcing'],
  q: r`CQRS and Event Sourcing as patterns: what does each give you, and why are they often over-applied?`,
  a: r`- **CQRS**: separate write model (commands, invariants) from read model (queries, projections). Simple form: separate handlers/DTOs over one database. Advanced form: separate read stores updated from events.
- **Event Sourcing**: persist state as an append-only sequence of events; current state is a fold over events. Gives full history, audit, temporal queries and the ability to build new projections from the past.

Over-application costs:

- Eventual consistency between write and read models (UX and support complexity).
- Event schema versioning forever; replay and snapshot management.
- Debugging and tooling gaps; harder onboarding.
- GDPR erasure in immutable logs (crypto-shredding needed).

Apply event sourcing to domains where history **is** the domain (ledgers, trading, audit-heavy workflows) and simple CQRS where read and write needs diverge. Default to neither for CRUD.`,
  code: r`~~~csharp
// Event-sourced aggregate: state = fold over events
public sealed class Account
{
    public decimal Balance { get; private set; }
    private readonly List<object> _pending = new();
    public static Account Rehydrate(IEnumerable<object> history) { var a = new Account(); foreach (var e in history) a.Apply(e); return a; }
    public void Withdraw(decimal amount)
    {
        if (amount > Balance) throw new InvalidOperationException("Insufficient funds");
        Raise(new Withdrawn(amount, DateTimeOffset.UtcNow));
    }
    private void Raise(object e) { Apply(e); _pending.Add(e); }
    private void Apply(object e) { switch (e) { case Deposited d: Balance += d.Amount; break; case Withdrawn w: Balance -= w.Amount; break; } }
    public IReadOnlyList<object> PendingEvents => _pending;
}
public sealed record Deposited(decimal Amount, DateTimeOffset At);
public sealed record Withdrawn(decimal Amount, DateTimeOffset At);
~~~`,
  pts: [r`CQRS separates write invariants from read shapes.`, r`Event sourcing stores state as an append-only event log.`, r`Benefits: history, audit, temporal queries, new projections from the past.`, r`Costs: eventual consistency, event versioning, replay, erasure.`, r`Use event sourcing where history is the domain; neither for CRUD.`],
  ex: r`A wallet ledger used event sourcing for auditability; the merchant-settings admin app next to it stayed plain CRUD.`,
  fu: [r`How do you version events?`, r`How do you handle GDPR erasure with event sourcing?`],
  pit: [r`Event sourcing a CRUD admin screen.`] },

{ id: 'q23', level: 'Senior', tags: ['strangler', 'migration-patterns'],
  q: r`Strangler Fig, Branch by Abstraction and Parallel Run: how do you use them to modernise a legacy system?`,
  a: r`- **Strangler Fig**: put a routing layer (YARP, API gateway) in front of the legacy system; move routes/features one by one to the new system until the old one can be removed.
- **Branch by Abstraction**: inside a codebase, introduce an abstraction over the component to replace, move callers to it, implement the new version behind it, switch (feature flag), then delete the old one. No long-lived branches.
- **Parallel Run (shadowing)**: run old and new implementations on the same inputs, serve the old result, compare outputs and log differences until confidence is high.
- **Dark launching / canary**: send a small share of real traffic to the new path.

These combine: strangle at the edge, branch by abstraction internally, parallel-run critical calculations (pricing, interest, tax) before switching.`,
  code: r`~~~csharp
// Branch by abstraction + parallel run for an interest calculator
public interface IInterestCalculator { decimal Accrue(Account a, DateOnly day); }
public sealed class ParallelRunInterest(LegacyInterest oldCalc, NewInterest newCalc, IFeatureManager flags, ILogger<ParallelRunInterest> log)
    : IInterestCalculator
{
    public decimal Accrue(Account a, DateOnly day)
    {
        var legacy = oldCalc.Accrue(a, day);
        var modern = newCalc.Accrue(a, day);
        if (legacy != modern) log.LogWarning("Interest mismatch {Account} {Day} legacy={Legacy} new={New}", a.Id, day, legacy, modern);
        return flags.IsEnabledAsync("NewInterestEngine").GetAwaiter().GetResult() ? modern : legacy;   // switch when mismatches reach zero
    }
}
~~~
~~~json
{ "ReverseProxy": { "Routes": {
    "statements-new": { "ClusterId": "new-platform", "Match": { "Path": "/api/statements/{**rest}" } },
    "everything-else": { "ClusterId": "legacy", "Match": { "Path": "{**catch-all}" } } } } }
~~~`,
  pts: [r`Strangler Fig moves features behind a router one by one.`, r`Branch by Abstraction replaces internals without long-lived branches.`, r`Parallel Run compares old and new outputs before switching.`, r`Canary and dark launches limit blast radius.`, r`Combine them: strangle at the edge, branch internally, parallel-run critical maths.`],
  ex: r`A bank parallel-ran a new interest engine for two months, fixed 7 rounding differences, then switched with zero customer-visible changes.`,
  fu: [r`How do you decommission the legacy system safely?`],
  pit: [r`Big-bang cutovers of calculation engines without parallel runs.`] },

{ id: 'q24', level: 'Senior', tags: ['caching-patterns'],
  q: r`Compare cache-aside, read-through, write-through, write-behind and refresh-ahead as patterns. Which do you use for what?`,
  a: r`| Pattern | How | Good for | Risk |
|---|---|---|---|
| Cache-aside | App reads cache, loads DB on miss, deletes on write | General purpose | Stale reads, stampedes |
| Read-through | Cache library loads via a factory | Centralised loading ({{HybridCache}}) | Same as cache-aside |
| Write-through | Write cache and DB synchronously | Data read right after writes | Write latency, caching unread data |
| Write-behind | Write cache, persist asynchronously | Very high write rates (counters, telemetry) | Data loss on crash |
| Refresh-ahead | Refresh hot keys before expiry | Predictable hot keys | Wasted refreshes |

Combine with **stampede protection** (single-flight), **TTL jitter**, **versioned keys**, and a defined **staleness budget** per data type. Never use write-behind for money.`,
  code: r`~~~csharp
// Read-through with stampede protection (HybridCache)
public ValueTask<Product> GetAsync(int id, CancellationToken ct) =>
    cache.GetOrCreateAsync("product:v3:" + id, t => repo.LoadAsync(id, t),
        new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(10) }, tags: ["product:" + id], cancellationToken: ct);
// Write: update DB, then invalidate by tag (cache-aside invalidation)
public async Task UpdateAsync(Product p, CancellationToken ct) { await repo.SaveAsync(p, ct); await cache.RemoveByTagAsync("product:" + p.Id, ct); }

// Refresh-ahead for a known hot key
public sealed class FxRefresher(HybridCache cache, IFxApi fx) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(4));
        while (await timer.WaitForNextTickAsync(ct)) await cache.SetAsync("fx:EURUSD", await fx.GetAsync("EURUSD", ct), cancellationToken: ct);
    }
}
~~~`,
  pts: [r`Cache-aside and read-through are the defaults.`, r`Write-through suits read-after-write; write-behind risks data loss.`, r`Refresh-ahead keeps known hot keys warm.`, r`Add single-flight, TTL jitter and versioned keys.`, r`Define a staleness budget per data type; never write-behind money.`],
  ex: r`Refresh-ahead for 40 FX pairs removed the latency spike every 5 seconds when the cached rate expired.`,
  fu: [r`How do you invalidate caches across services?`],
  pit: [r`Write-behind for financial balances.`] },

{ id: 'q25', level: 'Senior', tags: ['api-patterns', 'bff', 'gateway'],
  q: r`API Gateway, Backend-for-Frontend and Aggregator patterns: what does each solve, and where do they go wrong?`,
  a: r`- **API Gateway**: single entry point for external clients; routing, TLS, authentication, rate limiting, request size limits. Should stay free of business logic.
- **Backend-for-Frontend (BFF)**: one backend per client type (web, mobile, partner) shaping responses and handling client-specific concerns (token handling for SPAs, payload size for mobile). Owned by the client team.
- **Aggregator / API composition**: one call that fans out to several services and composes the result (dashboard, home screen).

Where they go wrong:

- Gateway accumulating business rules and becoming a distributed monolith's choke point.
- One shared "BFF" for all clients (just another gateway).
- Aggregators doing sequential calls (latency adds up) or failing entirely when one dependency fails: use parallel calls, timeouts and partial responses.`,
  code: r`~~~csharp
// Aggregator in a mobile BFF: parallel fan-out with per-call timeouts and partial results
app.MapGet("/bff/home", async (IAccountsApi accounts, IOffersApi offers, INotificationsApi notes, ClaimsPrincipal u, CancellationToken ct) =>
{
    var id = u.CustomerId();
    var a = accounts.SummaryAsync(id, ct);
    var o = WithTimeout(offers.TopAsync(id, ct), TimeSpan.FromMilliseconds(300), fallback: Array.Empty<Offer>());
    var n = WithTimeout(notes.UnreadAsync(id, ct), TimeSpan.FromMilliseconds(300), fallback: 0);
    await Task.WhenAll(a, o, n);
    return Results.Ok(new { balance = a.Result.Balance, offers = o.Result, unread = n.Result, partial = o.IsFaulted || n.IsFaulted });
});
static async Task<T> WithTimeout<T>(Task<T> t, TimeSpan limit, T fallback)
{ try { return await t.WaitAsync(limit); } catch { return fallback; } }
~~~`,
  dia: r`flowchart LR
  WEB[Web SPA] --> BW[Web BFF]
  MOB[Mobile app] --> BM[Mobile BFF]
  PART[Partners] --> GW[API gateway: auth, quotas]
  BW & BM & GW --> ACC[Accounts]
  BW & BM --> OFF[Offers]
  BM --> NOT[Notifications]`,
  pts: [r`Gateway: routing, TLS, auth and quotas; no business logic.`, r`BFF: one backend per client type, owned by the client team.`, r`Aggregator: fan out in parallel and compose.`, r`Use timeouts and partial responses in aggregators.`, r`A shared BFF for every client is just another gateway.`],
  ex: r`A mobile home screen dropped from 1.4 s to 380 ms when its BFF switched from sequential calls to parallel fan-out with partial results.`,
  fu: [r`Who should own the BFF?`],
  pit: [r`Business rules creeping into the gateway.`] },

{ id: 'q26', level: 'Senior', tags: ['anti-patterns'],
  q: r`Name the design anti-patterns you see most often in .NET codebases and how you fix each.`,
  a: r`| Anti-pattern | Symptom | Fix |
|---|---|---|
| God class / service | 3,000-line OrderService | Split by responsibility/use case |
| Anaemic domain (in complex domains) | Rules scattered in services | Move behaviour into aggregates |
| Service locator | {{IServiceProvider}} in business code | Constructor injection |
| Generic repository over EF | Leaky {{IQueryable}} | Aggregate repositories + query handlers |
| Primitive obsession | Strings/decimals for ids and money | Value objects, strongly-typed ids |
| Sync over async | {{.Result}}, {{.Wait()}} | Async end to end |
| Exceptions for flow | Exceptions for "not found"/"declined" | Result types |
| Distributed monolith | Services must deploy together | Re-draw boundaries, async contracts |
| Golden hammer | Kafka/microservices/patterns for everything | Choose by requirements |
| Shotgun surgery | One change touches 12 files | Cohesion by feature |

Fix incrementally, prioritised by hotspots (change frequency x pain).`,
  code: r`~~~csharp
// Primitive obsession -> strongly-typed ids and value objects
public void Refund(Guid paymentId, Guid customerId, decimal amount, string currency) { }   // easy to swap ids/currency by mistake
public readonly record struct PaymentId(Guid Value);
public readonly record struct CustomerId(Guid Value);
public void Refund(PaymentId payment, CustomerId customer, Money amount) { }               // compiler catches swaps

// Sync over async -> async end to end
var rates = _client.GetRatesAsync().Result;                 // thread-pool starvation under load
var rates2 = await _client.GetRatesAsync(ct);
~~~`,
  pts: [r`Common: god classes, anaemic models in complex domains, service locators, generic repositories.`, r`Also primitive obsession, sync-over-async, exceptions for flow.`, r`At system level: distributed monoliths and golden hammers.`, r`Each has a standard fix.`, r`Prioritise by hotspot analysis, not by aesthetics.`],
  ex: r`Strongly-typed ids caught 6 parameter-order bugs at compile time during a payments refactor.`,
  fu: [r`Which anti-pattern is most expensive in your experience?`],
  pit: [r`Fixing anti-patterns in stable code nobody changes.`] },

{ id: 'q27', level: 'Senior', tags: ['ddd-patterns'],
  q: r`Which DDD tactical patterns (entity, value object, aggregate, domain service, domain event, factory, repository) matter most, and how do they map to C#?`,
  a: r`- **Value object**: immutable, equality by value ({{record}} / {{readonly record struct}}): Money, Email, DateRange.
- **Entity**: identity and lifecycle (class with an id, behaviour methods, private setters).
- **Aggregate**: consistency boundary with a root; invariants enforced inside; reference other aggregates by id; one aggregate per transaction by default.
- **Domain service**: domain logic that does not belong to one entity (transfer between two accounts, pricing across products).
- **Domain event**: something that happened, raised by aggregates, dispatched after (or with) commit.
- **Factory**: creation of complex aggregates (static {{Create}} methods mostly).
- **Repository**: load/save aggregates; one per aggregate root.

The highest-value ones are value objects and aggregates: they remove primitive obsession and make invariants enforceable.`,
  code: r`~~~csharp
public readonly record struct DateRange(DateOnly Start, DateOnly End)
{ public DateRange { if (End < Start) throw new ArgumentException("End before start"); } public int Days => End.DayNumber - Start.DayNumber + 1; }

public sealed class Booking : AggregateRoot                                     // aggregate root
{
    public BookingId Id { get; }
    public RoomId RoomId { get; }                                               // reference by id
    public DateRange Stay { get; private set; }
    private Booking(BookingId id, RoomId room, DateRange stay) { Id = id; RoomId = room; Stay = stay; }
    public static Booking Create(RoomId room, DateRange stay) { var b = new Booking(new(Guid.NewGuid()), room, stay); b.Raise(new BookingCreated(b.Id, room, stay)); return b; }
    public void Extend(DateOnly newEnd) { Stay = Stay with { End = newEnd }; Raise(new BookingExtended(Id, newEnd)); }
}
public sealed class AvailabilityService(IBookingRepository bookings)           // domain service spanning bookings
{ public async Task<bool> IsFreeAsync(RoomId room, DateRange r, CancellationToken ct) => !await bookings.OverlapsAsync(room, r, ct); }
~~~`,
  pts: [r`Value objects and aggregates deliver the most value.`, r`Records map naturally to value objects.`, r`Aggregates enforce invariants and reference others by id.`, r`Domain services hold logic spanning entities.`, r`Repositories load and save whole aggregates.`],
  ex: r`Introducing a DateRange value object removed 11 duplicated "end before start" checks and two bugs where one was missing.`,
  fu: [r`How do you enforce an invariant across two aggregates?`],
  pit: [r`Large aggregates containing everything related.`] },

{ id: 'q28', level: 'Senior', tags: ['idempotency-pattern'],
  q: r`Implement the Idempotency pattern for HTTP APIs and message consumers. What are the subtle cases?`,
  a: r`Idempotency means repeating an operation has the same effect as doing it once. Needed because networks force retries.

### HTTP
Client sends {{Idempotency-Key}}; the server stores key + request hash + response atomically with the business change; duplicates replay the stored response.

### Messaging
Store processed message ids (inbox) in the same transaction as the handler's changes; a duplicate is detected and skipped.

### Subtle cases
- **Concurrent duplicates**: two identical requests in flight; a unique constraint, not a "check then insert", decides.
- **Same key, different payload**: reject (422) rather than replay.
- **In-progress state**: a crash between reservation and completion; allow takeover after a lease timeout.
- **External side effects** (charging a card): pass your idempotency key to the provider too.
- **Retention**: keys must live longer than any client retry window.
- **Natural idempotency**: "set status to X" is naturally idempotent; "add 10" is not, so convert to "apply transaction T" with a unique id.`,
  code: r`~~~csharp
public async Task<IResult> HandleAsync(string key, TransferRequest req, AppDb db, CancellationToken ct)
{
    var hash = Hashing.Sha256(req);
    await using var tx = await db.Database.BeginTransactionAsync(ct);
    var existing = await db.Idempotency.SingleOrDefaultAsync(i => i.Key == key, ct);
    if (existing is not null)
        return existing.RequestHash == hash ? Results.Json(existing.Response, statusCode: existing.Status)
                                            : Results.Problem(statusCode: 422, title: "Key reused with a different body");
    var transfer = Transfer.Create(req);
    db.Transfers.Add(transfer);
    db.Idempotency.Add(new IdempotencyRecord(key, hash, 201, transfer.ToDto()));   // PK on Key: concurrent duplicate fails
    try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
    catch (DbUpdateException e) when (e.IsUniqueViolation()) { return Results.Conflict(); }   // the other request won; client retries and gets the replay
    return Results.Created("/transfers/" + transfer.Id, transfer.ToDto());
}
~~~`,
  pts: [r`Repeating the operation must have the effect of doing it once.`, r`HTTP: key + request hash + stored response, saved atomically with the change.`, r`Messaging: inbox of processed ids in the handler's transaction.`, r`A unique constraint, not check-then-insert, resolves concurrent duplicates.`, r`Pass keys to external providers; retain keys past the retry window.`],
  ex: r`A mobile app's retry-on-timeout created duplicate transfers until the API stored idempotency records with a unique key in the same transaction.`,
  fu: [r`How long should keys be retained?`],
  pit: [r`Storing the key in Redis only for financial operations.`] },

{ id: 'q29', level: 'Senior', tags: ['patterns', 'frontend'],
  q: r`Which design patterns matter most in Angular and React front ends?`,
  a: r`- **Observer**: RxJS observables (Angular), signals; React state subscriptions.
- **Container/Presentational** (smart/dumb components): separation of data/state from rendering.
- **Facade**: an Angular service or React hook wrapping store and API calls behind a simple surface ({{useCart()}}).
- **Strategy**: pluggable validators, formatters, payment-method components.
- **Composite**: component trees; recursive menus and trees.
- **Adapter**: mapping API DTOs to view models at the edge.
- **Mediator / store**: NgRx, Redux Toolkit, Zustand: centralised state with actions (command pattern) and reducers.
- **Decorator**: Angular decorators are metadata; HTTP interceptors are chain-of-responsibility decorators around requests.
- **Higher-order components / render props / custom hooks**: composition for cross-cutting UI behaviour.`,
  code: r`~~~typescript
// Angular HTTP interceptor: chain of responsibility around every request
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).accessToken();
  return next(token ? req.clone({ setHeaders: { Authorization: 'Bearer ' + token } }) : req);
};

// React facade hook: components use a simple surface, not the store and API directly
export function useCart() {
  const qc = useQueryClient();
  const cart = useQuery({ queryKey: ['cart'], queryFn: api.getCart });
  const add = useMutation({ mutationFn: api.addLine, onSuccess: () => qc.invalidateQueries({ queryKey: ['cart'] }) });
  return { lines: cart.data?.lines ?? [], total: cart.data?.total ?? 0, add: add.mutate, busy: add.isPending };
}
~~~`,
  pts: [r`Observer via RxJS and signals is the backbone of reactive UIs.`, r`Container/presentational separates data from rendering.`, r`Facade hooks or services hide stores and APIs from components.`, r`Interceptors are chain-of-responsibility decorators for HTTP.`, r`Stores apply command and mediator ideas to UI state.`],
  ex: r`Introducing a useCart facade let a team swap Redux for React Query without touching 40 components.`,
  fu: [r`When is a global store unnecessary?`],
  pit: [r`Components calling fetch and managing global state directly.`] },

{ id: 'q30', level: 'Senior', tags: ['patterns', 'concurrency'],
  q: r`Concurrency patterns in .NET: producer/consumer, pipeline, scatter-gather, and actor. When do you use each?`,
  a: r`- **Producer/consumer**: decouple production from processing with a bounded buffer and backpressure: {{Channel<T>}}, {{BlockingCollection}}.
- **Pipeline**: stages connected by channels or TPL Dataflow blocks, each stage with its own parallelism (parse -> enrich -> write).
- **Scatter-gather**: fan out independent calls, then combine ({{Task.WhenAll}}, {{Parallel.ForEachAsync}} with a degree of parallelism).
- **Actor model**: state owned by an actor processing messages one at a time; no locks (Orleans grains, Akka.NET, Proto.Actor). Great for many independent stateful entities (devices, accounts, game sessions).
- **Async locks / semaphores** for limiting concurrency to scarce resources.

Always bound concurrency and buffers; unbounded queues hide overload until memory runs out.`,
  code: r`~~~csharp
// Pipeline with bounded channels: parse -> enrich (4 workers) -> write in batches
var parsed = Channel.CreateBounded<Trade>(10_000);
var enriched = Channel.CreateBounded<EnrichedTrade>(10_000);
var produce = Task.Run(async () => { await foreach (var line in ReadLinesAsync(file, ct)) await parsed.Writer.WriteAsync(Parse(line), ct); parsed.Writer.Complete(); });
var enrich = Parallel.ForEachAsync(parsed.Reader.ReadAllAsync(ct), new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = ct },
    async (t, c) => await enriched.Writer.WriteAsync(await refData.EnrichAsync(t, c), c))
    .ContinueWith(_ => enriched.Writer.Complete());
var write = Task.Run(async () =>
{
    var batch = new List<EnrichedTrade>(1000);
    await foreach (var e in enriched.Reader.ReadAllAsync(ct)) { batch.Add(e); if (batch.Count == 1000) { await sink.BulkInsertAsync(batch, ct); batch.Clear(); } }
    if (batch.Count > 0) await sink.BulkInsertAsync(batch, ct);
});
await Task.WhenAll(produce, enrich, write);
~~~`,
  pts: [r`Producer/consumer with bounded channels gives backpressure.`, r`Pipelines connect stages with their own parallelism.`, r`Scatter-gather fans out independent work and combines results.`, r`Actors own state and process messages serially without locks.`, r`Always bound concurrency and buffers.`],
  ex: r`A trade-import pipeline with bounded channels processed 5 million rows in 4 minutes with flat memory, replacing a version that loaded everything into a list and crashed at month-end.`,
  fu: [r`When would you choose Orleans?`],
  pit: [r`Unbounded Task.WhenAll over millions of items.`] },

{ id: 'q31', level: 'Senior', tags: ['patterns', 'multi-tenancy'],
  q: r`Which patterns help build multi-tenant systems safely (tenant context, isolation, noisy neighbours)?`,
  a: r`- **Tenant context** resolved once per request (from the token, never from untrusted headers) and flowed via a scoped service.
- **Global query filters** (EF Core {{HasQueryFilter}}) or database row-level security so every query is tenant-scoped by default.
- **Strategy per tenant tier**: different limits, features or storage per plan via strategies/keyed services.
- **Bulkheads per tenant** (separate rate limiters, queues or pools) so one tenant cannot starve others.
- **Shard/cell routing**: tenant-to-database or tenant-to-cell mapping in a directory, enabling moving large tenants.
- **Decorators** enforcing tenant checks around repositories.
- **Tenant-aware caching**: tenant id in every cache key.

Test isolation with automated cross-tenant access tests.`,
  code: r`~~~csharp
public sealed class TenantContext { public string Id { get; set; } = ""; public string Tier { get; set; } = "standard"; }
builder.Services.AddScoped<TenantContext>();
app.Use(async (ctx, next) =>
{
    var t = ctx.RequestServices.GetRequiredService<TenantContext>();
    t.Id = ctx.User.FindFirstValue("tenant_id") ?? throw new UnauthorizedAccessException();   // from the token
    t.Tier = ctx.User.FindFirstValue("tenant_tier") ?? "standard";
    await next();
});
public sealed class AppDb(DbContextOptions<AppDb> o, TenantContext tenant) : DbContext(o)
{ protected override void OnModelCreating(ModelBuilder b) => b.Entity<Invoice>().HasQueryFilter(i => i.TenantId == tenant.Id); }

builder.Services.AddRateLimiter(o => o.AddPolicy("per-tenant", ctx => RateLimitPartition.GetTokenBucketLimiter(
    ctx.User.FindFirstValue("tenant_id") ?? "anon",
    _ => new TokenBucketRateLimiterOptions { TokenLimit = 200, TokensPerPeriod = 100, ReplenishmentPeriod = TimeSpan.FromSeconds(1) })));
~~~`,
  pts: [r`Resolve tenant context once, from the token.`, r`Default tenant scoping via global filters or row-level security.`, r`Per-tenant bulkheads and rate limits contain noisy neighbours.`, r`A tenant directory enables routing and moving large tenants.`, r`Tenant id in every cache key; automated cross-tenant tests.`],
  ex: r`A global query filter plus per-tenant rate limits let a SaaS platform onboard a tenant 50 times larger than average without affecting others.`,
  fu: [r`How do you bypass the filter safely for admin reports?`],
  pit: [r`Tenant id taken from a request header the client controls.`] },

{ id: 'q32', level: 'Senior', tags: ['patterns', 'code-review'],
  q: r`Code review: this code uses several patterns. What is wrong with how they are applied?`,
  a: r`~~~csharp
public class PaymentServiceFactory
{
    private static PaymentServiceFactory _instance;
    public static PaymentServiceFactory Instance => _instance ??= new PaymentServiceFactory();
    public IPaymentService Create(string type)
    {
        if (type == "card") return new CardPaymentService(new SqlConnection(Config.Cs), new HttpClient());
        if (type == "paypal") return new PayPalService(new HttpClient());
        return null;
    }
}
public class CardPaymentService : IPaymentService
{
    public virtual Task<bool> Pay(decimal amt) { /* ... */ return Task.FromResult(true); }
    public virtual Task<bool> Refund(decimal amt) => throw new NotImplementedException();
}
~~~

1. **Hand-rolled, non-thread-safe singleton** ({{??=}} races) hiding a global dependency; register the factory in DI instead.
2. **Factory newing dependencies**: {{new HttpClient()}} per call causes socket exhaustion; {{new SqlConnection}} with static config; use DI (keyed services) and {{IHttpClientFactory}}.
3. **Returning null** for unknown types: fail loudly with a clear exception or return a result.
4. **LSP violation**: {{Refund}} throws {{NotImplementedException}}; split capabilities ({{IRefundable}}) or implement it.
5. **bool results** for payments lose decline reasons; use a result type.
6. Missing {{CancellationToken}}, idempotency key, and money as {{decimal}} without currency.

Fix: keyed DI registrations per payment method, typed HttpClients, capability interfaces, and a rich result type.`,
  code: r`~~~csharp
public interface IPaymentMethod { Task<PaymentResult> PayAsync(Money amount, string idempotencyKey, CancellationToken ct); }
public interface IRefundable { Task<RefundResult> RefundAsync(PaymentRef payment, Money amount, CancellationToken ct); }
public sealed class CardPayments(HttpClient http, IPaymentStore store) : IPaymentMethod, IRefundable { /* ... */ }
public sealed class PayPalPayments(HttpClient http) : IPaymentMethod { /* refunds not supported: no false promise */ }

builder.Services.AddHttpClient<CardPayments>();
builder.Services.AddHttpClient<PayPalPayments>();
builder.Services.AddKeyedScoped<IPaymentMethod>("card", (sp, _) => sp.GetRequiredService<CardPayments>());
builder.Services.AddKeyedScoped<IPaymentMethod>("paypal", (sp, _) => sp.GetRequiredService<PayPalPayments>());
~~~`,
  pts: [r`Hand-rolled singletons race and hide dependencies; use DI lifetimes.`, r`Factories newing HttpClient cause socket exhaustion; use IHttpClientFactory.`, r`Never return null for unknown keys; fail loudly.`, r`NotImplemented overrides violate LSP; use capability interfaces.`, r`Rich result types instead of bool for payments.`],
  ex: r`This exact factory caused socket exhaustion during a sale (thousands of HttpClient instances); typed clients fixed it.`,
  fu: [r`How would you add a new method like Apple Pay now?`],
  pit: [r`Commenting only on naming and missing the socket exhaustion.`] },

{ id: 'q33', level: 'Senior', tags: ['event-patterns'],
  q: r`Event notification vs event-carried state transfer vs event sourcing: which event pattern do you choose?`,
  a: r`- **Event notification**: thin event ({{OrderPlaced { orderId }}}); consumers call back for details. Small payloads, but creates runtime coupling and load on the publisher.
- **Event-carried state transfer**: event contains the state consumers need ({{OrderPlaced { orderId, customerId, lines, total }}}); consumers keep local copies. Autonomy and no callbacks, at the cost of larger payloads, schema evolution and data duplication (including PII copies).
- **Event sourcing**: events are the system of record within a service; not the same as integration events, which should be designed separately.

Choose notification when consumers rarely need details or data is sensitive; state transfer when consumers need data to act independently and availability matters. Version events, keep them backward compatible, and publish through an outbox.`,
  code: r`~~~csharp
// Notification: tiny, consumers call back
public sealed record OrderPlacedNotification(Guid OrderId, DateTimeOffset At);
// Event-carried state transfer: consumers act without calling back
public sealed record OrderPlacedV2(Guid OrderId, Guid CustomerId, IReadOnlyList<OrderLineDto> Lines, decimal Total, string Currency,
                                   DateTimeOffset At, int SchemaVersion = 2);
// Consumer keeping a local copy for autonomy
public sealed class OrderProjection(ShippingDb db) : IConsumer<OrderPlacedV2>
{
    public async Task Consume(ConsumeContext<OrderPlacedV2> c)
    {
        db.PendingShipments.Add(new(c.Message.OrderId, c.Message.Lines.Sum(l => l.Qty)));
        await db.SaveChangesAsync();
    }
}
~~~`,
  pts: [r`Notification: thin events, consumers call back; coupling at runtime.`, r`State transfer: events carry data, consumers act autonomously.`, r`Event sourcing is internal persistence, not an integration contract.`, r`Choose by sensitivity of data and need for autonomy.`, r`Version events and publish via an outbox.`],
  ex: r`Switching shipping from callbacks to event-carried state removed 3,000 requests per minute against the orders API during peaks.`,
  fu: [r`How do you avoid PII sprawl with event-carried state?`],
  pit: [r`Publishing internal event-sourcing events as public contracts.`] },

{ id: 'q34', level: 'Senior', tags: ['patterns', 'testing'],
  q: r`Which patterns make testing easier (test doubles, builders, object mothers, humble object)?`,
  a: r`- **Test doubles**: dummy, stub (canned answers), fake (working lightweight implementation), spy (records calls), mock (verifies interactions). Prefer fakes and stubs for state-based tests; mocks for boundary interactions.
- **Test data builders** and **object mothers**: readable creation of valid objects with defaults ({{An.Order().Paid().Build()}}).
- **Humble object**: move logic out of hard-to-test boundaries (controllers, UI, background service loops) into plain classes; the boundary becomes thin and needs few tests.
- **Ports and adapters**: test the core with fakes, adapters with integration tests.
- **Approval/snapshot tests** for complex outputs (documents, API responses).
- **Contract tests** for substitutable implementations.`,
  code: r`~~~csharp
// Humble object: the hosted service loop is trivial; the logic is a plain, tested class
public sealed class SettlementWorker(SettlementProcessor processor, TimeProvider clock) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5), clock);
        while (await timer.WaitForNextTickAsync(ct)) await processor.RunOnceAsync(ct);
    }
}
public sealed class SettlementProcessor(ISettlementStore store, IBankFiles files)
{
    public async Task<int> RunOnceAsync(CancellationToken ct)
    { var pending = await store.PendingAsync(ct); foreach (var p in pending) await files.SubmitAsync(p, ct); return pending.Count; }
}
[Fact] public async Task Submits_all_pending()
{
    var store = new FakeSettlementStore(3); var files = new SpyBankFiles();
    (await new SettlementProcessor(store, files).RunOnceAsync(default)).Should().Be(3);
    files.Submitted.Should().HaveCount(3);
}
~~~`,
  pts: [r`Know the double types: stub, fake, spy, mock; prefer fakes and stubs.`, r`Builders and object mothers make fixtures readable.`, r`Humble object: keep boundaries thin and logic in plain classes.`, r`Ports let you test the core with fakes and adapters for real.`, r`Snapshot and contract tests cover complex outputs and substitutes.`],
  ex: r`Extracting a SettlementProcessor from a BackgroundService made the settlement logic testable in milliseconds instead of via timing-dependent integration tests.`,
  fu: [r`When are mocks the right choice?`],
  pit: [r`Testing logic through timers and hosted services.`] },

{ id: 'q35', level: 'Senior', tags: ['patterns', 'distributed'],
  q: r`Which distributed-systems patterns do you reach for first (sidecar, ambassador, leader election, cell-based architecture)?`,
  a: r`- **Sidecar**: a helper process alongside the app container (service mesh proxy, log shipper, Dapr) providing cross-cutting capabilities without app changes.
- **Ambassador**: a sidecar specialised for outbound calls (retries, auth, routing to legacy systems).
- **Leader election**: one active instance for singleton work (schedulers, partition assignment) using leases (Kubernetes Lease objects, Azure Blob leases, DynamoDB conditional writes).
- **Sharding / partitioning**: split data and load by key.
- **Cell-based architecture**: deploy independent copies of the full stack (cells) each serving a subset of customers, limiting blast radius; a thin routing layer maps customers to cells.
- **Bulkhead and backpressure** at system level (queues, rate limits).

Reach for them when a requirement demands it: blast-radius limits (cells), single-active work (leader election), platform-wide cross-cutting (sidecars).`,
  code: r`~~~csharp
// Leader election with a lease: only the holder runs the nightly scheduler
public sealed class LeaderScheduler(IDistributedLease lease, ISettlementRunner runner, ILogger<LeaderScheduler> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await using var held = await lease.TryAcquireAsync("settlement-leader", TimeSpan.FromSeconds(30), ct);
            if (held is null) { await Task.Delay(TimeSpan.FromSeconds(10), ct); continue; }
            log.LogInformation("Became leader");
            while (await held.RenewAsync(ct)) await runner.RunDueJobsAsync(held.FencingToken, ct);   // fencing token guards stale leaders
        }
    }
}
~~~`,
  dia: r`flowchart TB
  R[Cell router: customer -> cell] --> C1
  R --> C2
  R --> C3
  subgraph C1[Cell 1: customers A-H]
    A1[API] --> D1[(DB)]
  end
  subgraph C2[Cell 2: customers I-Q]
    A2[API] --> D2[(DB)]
  end
  subgraph C3[Cell 3: customers R-Z]
    A3[API] --> D3[(DB)]
  end`,
  pts: [r`Sidecars and ambassadors add cross-cutting capabilities without app changes.`, r`Leader election with leases and fencing tokens for single-active work.`, r`Cells limit blast radius by serving subsets of customers.`, r`Sharding splits data and load by key.`, r`Adopt each pattern because a requirement demands it.`],
  ex: r`A payments provider moved to cells after a bad deploy took down all merchants; afterwards, incidents affected one cell (12% of merchants).`,
  fu: [r`How do you migrate a customer between cells?`],
  pit: [r`Leader election without fencing tokens.`] },

{ id: 'q36', level: 'Senior', tags: ['patterns', 'data'],
  q: r`Data access patterns: Unit of Work, Identity Map, Lazy Load, CQRS read models, and Materialised View. Where do they appear in EF Core?`,
  a: r`- **Unit of Work**: {{DbContext}} tracks changes and commits them in {{SaveChanges}} as one transaction.
- **Identity Map**: within a context, one tracked instance per key; loading the same row twice returns the same object. Also why long-lived contexts grow and go stale.
- **Lazy Load**: navigation properties loaded on access (proxies or {{ILazyLoader}}); convenient, but causes N+1 queries. Prefer explicit {{Include}} or projections.
- **Query Object / Specification**: LINQ queries composed as objects.
- **Materialised view / read model**: precomputed query results (indexed views, SQL materialised views, projection tables) for read-heavy screens.
- **Optimistic Offline Lock**: concurrency tokens ({{[Timestamp]}} rowversion) detecting conflicting updates.

Knowing the patterns explains EF behaviour: why {{AsNoTracking}} is faster (no identity map), why a context per request (unit of work scope), why disabled lazy loading in APIs.`,
  code: r`~~~csharp
public sealed class Account { public Guid Id { get; set; } public decimal Limit { get; set; } [Timestamp] public byte[] Version { get; set; } = []; }

await using var db = factory.CreateDbContext();                 // unit of work scope
var a1 = await db.Accounts.FindAsync(id);
var a2 = await db.Accounts.SingleAsync(a => a.Id == id);
ReferenceEquals(a1, a2).Should().BeTrue();                      // identity map
a1!.Limit = 5000;
try { await db.SaveChangesAsync(); }                            // optimistic offline lock via rowversion
catch (DbUpdateConcurrencyException) { /* reload, merge or report conflict */ }

var rows = await db.Accounts.AsNoTracking().Select(a => new { a.Id, a.Limit }).ToListAsync();   // no identity map, no tracking cost
~~~`,
  pts: [r`DbContext is a unit of work with an identity map.`, r`Lazy loading causes N+1; prefer explicit includes or projections.`, r`Concurrency tokens implement optimistic offline locks.`, r`AsNoTracking skips the identity map for faster reads.`, r`Materialised read models serve heavy read screens.`],
  ex: r`A long-lived DbContext in a background job grew to 2 GB via its identity map; a context per batch fixed memory.`,
  fu: [r`Why should DbContext be short-lived?`],
  pit: [r`Lazy loading enabled in web APIs.`] },

{ id: 'q37', level: 'Principal', tags: ['architecture-patterns', 'decision'],
  q: r`How do you decide which architectural pattern to use (layered, hexagonal, vertical slice, modular monolith, microservices) for a new system?`,
  a: r`Start from forces, not fashion:

- **Domain complexity**: rich, changing rules favour hexagonal/clean cores; CRUD favours simple layered or vertical slices.
- **Team topology**: one team -> modular monolith; several autonomous teams with clear domain boundaries -> services aligned to those boundaries.
- **Scalability and availability differences** between parts: separate deployables only where needs differ materially.
- **Change cadence**: parts that change at very different rates benefit from separation.
- **Operational maturity**: microservices need CI/CD, observability, on-call, platform support.
- **Regulatory scope**: isolate PCI or regulated components to shrink audit scope.

Default for most new products: a **modular monolith** with hexagonal modules and vertical slices inside, strict module boundaries enforced by tests, and extraction to services when a force justifies it. Record the decision and the triggers for revisiting it in an ADR.`,
  code: r`~~~text
ADR-001: Initial architecture for Lending Platform
Forces: 2 teams (8 engineers); complex underwriting rules; card data out of scope (tokenised); 10 req/s at launch.
Decision: Modular monolith (Origination, Underwriting, Servicing, Documents modules), hexagonal core per module,
          vertical slices for endpoints; modules communicate via in-process contracts and outbox events.
Triggers to extract a service: a module needs independent scaling >10x others, a separate team owns it,
          or it enters regulated scope (e.g. payments).
~~~`,
  pts: [r`Choose from forces: domain complexity, teams, scaling, change cadence, ops maturity, regulation.`, r`Default to a modular monolith with hexagonal modules.`, r`Extract services only when a force justifies it.`, r`Enforce module boundaries with tests from day one.`, r`Record the decision and its revisit triggers in an ADR.`],
  ex: r`A lending startup ran a modular monolith for two years and extracted only Documents (heavy PDF workload) and Payments (PCI scope) as services.`,
  fu: [r`What signals tell you a module should become a service?`],
  pit: [r`Starting with 20 microservices for a team of 6.`] },

{ id: 'q38', level: 'Principal', tags: ['patterns', 'governance'],
  q: r`How do you create a pattern catalogue for your organisation without it becoming shelfware?`,
  a: r`- **Harvest, do not invent**: document patterns already working in your systems, with links to real code and the problems they solved.
- **Problem-first format**: context, forces, solution, consequences, when not to use, example repo/PR, owner.
- **Executable patterns**: templates, NuGet packages or libraries implementing them (outbox, idempotency middleware, resilience defaults), so adoption is a package reference, not a re-implementation.
- **Decision trees** for common choices (sync vs async, which messaging pattern, cache pattern).
- **Lightweight governance**: a guild reviews additions; deprecated patterns are marked with migration guidance.
- **Feedback**: link postmortems to patterns; track adoption and incidents per pattern.
- **Keep it small**: 20 well-maintained patterns beat 150 stale pages.`,
  code: r`~~~text
Pattern: Transactional outbox (status: Recommended, owner: platform-messaging)
Problem: services lose or duplicate events when they save state and publish separately.
Use when: a state change must reliably produce an event or command.
Do not use when: the event is best-effort telemetry.
Implementation: Company.Messaging.Outbox 4.x (EF Core interceptor + relay); see orders-service PR #812.
Consequences: extra table + relay; at-least-once delivery -> consumers must use Company.Messaging.Inbox.
Incidents prevented: INC-2291 (lost OrderPlaced events), INC-2410.
~~~`,
  pts: [r`Harvest proven patterns from your own systems.`, r`Use a problem-first format including when not to use it.`, r`Ship patterns as packages and templates, not just documents.`, r`Light guild governance with deprecation guidance.`, r`Keep the catalogue small and tied to incidents and examples.`],
  ex: r`Shipping the outbox and idempotency patterns as internal packages took adoption from 4 to 31 services in two quarters.`,
  fu: [r`How do you retire a pattern that is now discouraged?`],
  pit: [r`A wiki of GoF definitions with no organisational context.`] },

{ id: 'q39', level: 'Principal', tags: ['patterns', 'payments-design'],
  q: r`Design a payment orchestration component. Which patterns do you combine and why?`,
  a: r`Requirements: multiple providers, routing by cost/country/health, retries and failover, idempotency, webhooks, reconciliation, audit.

Patterns:

- **Strategy + Adapter**: one adapter per provider implementing a common {{IPaymentProvider}} port with capability descriptors.
- **Chain of responsibility / rules**: routing rules choose the provider (country, currency, BIN, cost, success rate).
- **State machine**: payment lifecycle with guarded transitions.
- **Idempotency**: keys at API and provider level.
- **Circuit breaker + bulkhead** per provider; **failover** to the next eligible provider only for safe states (not after an ambiguous authorisation).
- **Outbox** for events; **inbox** for webhooks (deduplicated by provider event id).
- **Reconciliation job** against settlement files.
- **Decorator** for audit logging and metrics around adapters.`,
  code: r`~~~csharp
public sealed class PaymentOrchestrator(IEnumerable<IPaymentProvider> providers, IRoutingPolicy routing, IPaymentStore store)
{
    public async Task<PaymentResult> AuthoriseAsync(PaymentIntent intent, CancellationToken ct)
    {
        foreach (var provider in routing.Rank(intent, providers))                       // cost, success rate, health
        {
            var result = await provider.AuthoriseAsync(intent, idempotencyKey: intent.Id + ":" + provider.Name, ct);
            await store.RecordAttemptAsync(intent.Id, provider.Name, result, ct);       // audit trail per attempt
            switch (result)
            {
                case PaymentResult.Approved or PaymentResult.Declined: return result;   // final: never fail over a decline
                case PaymentResult.Unknown: return result;                              // ambiguous: resolve via status query, do NOT try another provider
                case PaymentResult.ProviderUnavailable: continue;                       // safe to fail over
            }
        }
        return new PaymentResult.ProviderUnavailable();
    }
}
~~~`,
  dia: r`flowchart LR
  API[Payments API] --> O[Orchestrator]
  O --> RP[Routing policy chain]
  O --> SM[Payment state machine]
  O --> A1[Stripe adapter]
  O --> A2[Adyen adapter]
  O --> A3[Local acquirer adapter]
  A1 & A2 & A3 --> CB[Breaker + bulkhead per provider]
  WH[Webhooks] --> IN[(Inbox dedupe)] --> SM
  SM --> OB[(Outbox)] --> EV[Events]
  REC[Reconciliation vs settlement files] --> SM`,
  pts: [r`Strategy and adapter per provider behind one port.`, r`Routing rules as a chain ranking eligible providers.`, r`State machine for lifecycle; idempotency at both API and provider level.`, r`Fail over only on unavailability, never after a decline or an unknown outcome.`, r`Inbox for webhooks, outbox for events, reconciliation as the backstop.`],
  ex: r`Routing by success rate and cost across three acquirers raised authorisation rates by 1.8 points and cut fees, with failover only on provider unavailability.`,
  fu: [r`Why is failing over after a timeout dangerous?`],
  pit: [r`Retrying an ambiguous authorisation on a second provider (double charge).`] },

{ id: 'q40', level: 'Principal', tags: ['patterns', 'legacy-integration'],
  q: r`Integrating a mainframe or legacy core banking system: which integration patterns do you use?`,
  a: r`- **Anti-corruption layer**: translate legacy record formats, codes and semantics into your domain model; nothing legacy leaks inward.
- **Facade / gateway service**: one modern API over the legacy interfaces (MQ, CICS, files, SOAP).
- **Messaging bridge**: legacy MQ to Kafka/Service Bus with transformation.
- **Change data capture** from legacy databases to stream changes without modifying the legacy app.
- **Batch file integration** with reconciliation where the legacy system only speaks files.
- **Caching / read models** to offload read traffic from expensive mainframe MIPS.
- **Strangler Fig** to move capabilities out over time.
- **Circuit breakers and queues** to protect the legacy system from modern traffic spikes (it often cannot scale).

Plus operational patterns: idempotent requests (legacy may lack it), correlation ids carried into legacy logs, and parallel run for migrated calculations.`,
  code: r`~~~csharp
// Anti-corruption layer over a fixed-width legacy record from a core banking system
public sealed class CoreBankingAccountAdapter(ILegacyMqClient mq) : IAccountDirectory
{
    public async Task<AccountSummary> GetAsync(AccountNumber acc, CancellationToken ct)
    {
        var reply = await mq.RequestAsync("ACCTINQ", acc.Value.PadLeft(12, '0'), TimeSpan.FromSeconds(2), ct);
        return new AccountSummary(
            Number: acc,
            Status: reply[12..14] switch { "AC" => AccountStatus.Active, "DO" => AccountStatus.Dormant, "CL" => AccountStatus.Closed, var s => throw new UnknownLegacyCode(s) },
            Balance: Money.Of(decimal.Parse(reply[14..29], CultureInfo.InvariantCulture) / 100m, reply[29..32]),   // implied 2 decimals
            OpenedOn: DateOnly.ParseExact(reply[32..40], "yyyyMMdd", CultureInfo.InvariantCulture));
    }
}
~~~`,
  pts: [r`Anti-corruption layer translates legacy formats and semantics.`, r`Facade or gateway service exposes one modern API.`, r`CDC and messaging bridges avoid modifying the legacy app.`, r`Read models and caches offload costly legacy reads.`, r`Protect legacy capacity with queues and breakers; strangle over time.`],
  ex: r`A bank cut mainframe MIPS costs by 25% by serving balance enquiries from a CDC-fed read model, keeping postings on the mainframe.`,
  fu: [r`How do you test against a legacy system you cannot run locally?`],
  pit: [r`Exposing legacy codes and fixed-width semantics in new APIs.`] },

{ id: 'q41', level: 'Principal', tags: ['patterns', 'trade-offs'],
  q: r`A team wants to adopt event sourcing, CQRS, sagas and microservices for a new internal tool. How do you respond?`,
  a: r`Ask what problem each pattern solves **for this tool**:

- Is history/audit the core of the domain (event sourcing)? Or would an audit table suffice?
- Do read and write needs diverge significantly (CQRS)? Or are they the same screens?
- Are there multi-service business transactions (sagas)? Only if there are multiple services.
- Do independent teams need independent deployment (microservices)? Usually not for an internal tool built by one team.

Each pattern adds accidental complexity: eventual consistency, versioning, distributed debugging, ops overhead. Propose the simplest architecture meeting the requirements (modular monolith, relational DB, audit table, simple CQRS-style handlers), with explicit **triggers** that would justify adding each pattern later, and offer the team a contained place to learn (one module) if growth is the goal.`,
  code: r`~~~text
Requirement check
Need                          Evidence             Pattern justified?
Full history of changes        audit 2 entities     No: temporal tables / audit log
Different read/write shapes    3 list screens       Simple CQRS handlers only
Cross-service transactions     one service          No sagas
Independent deploys            one team             No microservices
Proposal: modular monolith + SQL Server temporal tables + vertical slices; revisit if a second team joins.
~~~`,
  pts: [r`Ask which problem each pattern solves for this tool.`, r`Every pattern adds accidental complexity and operations cost.`, r`Propose the simplest architecture that meets the requirements.`, r`Define triggers that would justify each pattern later.`, r`Offer a contained place to learn if growth is the goal.`],
  ex: r`An internal approvals tool shipped in 6 weeks as a modular monolith with temporal tables, instead of the 5-month event-sourced microservice plan.`,
  fu: [r`How do you avoid demotivating engineers who want to learn these patterns?`],
  pit: [r`Saying no without explaining forces or offering alternatives.`] },

{ id: 'q42', level: 'Principal', tags: ['patterns', 'observability'],
  q: r`Which patterns make a distributed system observable by design?`,
  a: r`- **Correlation and causation ids** propagated across HTTP and messages (W3C trace context).
- **Distributed tracing** with spans per hop (OpenTelemetry), including message publish/consume links.
- **Structured logging** with consistent fields (tenant, order id, trace id), not free text.
- **RED/USE metrics** per service and dependency; business metrics (orders placed, payments declined).
- **Health check pattern** (liveness/readiness) and synthetic monitoring of key journeys.
- **Audit logging** as a separate, immutable stream for who-did-what.
- **Log aggregation and exemplars** linking metrics to traces.
- **Semantic events**: emit domain-meaningful events for operations ("PaymentDeclined, reason=insufficient_funds") enabling dashboards and alerts on business outcomes.

Bake these into templates and shared packages so every service has them by default.`,
  code: r`~~~csharp
// Business metric + trace tag + structured log on a domain outcome
private static readonly Meter Meter = new("Payments");
private static readonly Counter<long> Declines = Meter.CreateCounter<long>("payments.declined");
public void OnDeclined(Payment p, string reason)
{
    Declines.Add(1, new("reason", reason), new("provider", p.Provider), new("currency", p.Currency));
    Activity.Current?.SetTag("payment.decline_reason", reason);
    _log.LogInformation("Payment {PaymentId} declined by {Provider}: {Reason}", p.Id, p.Provider, reason);
}
// Messages carry trace context so consumer spans link to the producer
msg.ApplicationProperties["traceparent"] = Activity.Current?.Id;
~~~`,
  pts: [r`Propagate trace context across HTTP and messages.`, r`Trace every hop with OpenTelemetry.`, r`Structured logs with consistent fields.`, r`RED/USE plus business metrics.`, r`Ship observability in templates so it is the default.`],
  ex: r`A payments-declined-by-reason metric spotted an acquirer issue 20 minutes before customers complained.`,
  fu: [r`How do you trace through a Kafka hop?`],
  pit: [r`Logging free-text messages without identifiers.`] },

{ id: 'q43', level: 'Principal', tags: ['patterns', 'security'],
  q: r`Which security design patterns do you apply by default?`,
  a: r`- **Defence in depth**: gateway auth + service authorisation + data-level controls (RLS).
- **Least privilege**: role interfaces, scoped tokens, per-service database logins, short-lived credentials.
- **Policy enforcement point / decision point**: centralised, testable authorisation logic (ASP.NET Core policies, OPA, OpenFGA).
- **Secure by default**: deny-by-default authorisation fallback policy, HTTPS-only, secure cookie defaults.
- **Token exchange / BFF** for SPAs: tokens stay server-side.
- **Secrets broker**: Key Vault / Secrets Manager with managed identities, no secrets in config.
- **Input validation at boundaries** and **output encoding**; parse-don't-validate value objects.
- **Audit trail**: immutable, separate from operational logs.
- **Tokenisation** to keep sensitive data (PAN) out of most systems.
- **Fail closed** for authorisation decisions.`,
  code: r`~~~csharp
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())      // deny by default
    .AddPolicy("refunds:approve", p => p.RequireClaim("scope", "refunds.approve")
        .AddRequirements(new AmountLimitRequirement(10_000m)));                                    // PDP in code, unit-testable
builder.Configuration.AddAzureKeyVault(new Uri(vaultUri), new DefaultAzureCredential());           // secrets broker + managed identity
app.MapPost("/refunds/{id}/approve", (Guid id) => Results.NoContent()).RequireAuthorization("refunds:approve");
~~~`,
  pts: [r`Defence in depth from gateway to data.`, r`Least privilege and short-lived credentials everywhere.`, r`Centralised, testable authorisation decisions; deny by default; fail closed.`, r`Keep tokens server-side for SPAs; secrets in a broker.`, r`Tokenise sensitive data and keep an immutable audit trail.`],
  ex: r`A deny-by-default fallback policy caught 9 endpoints a team had forgotten to protect during a migration.`,
  fu: [r`What is the confused deputy problem?`],
  pit: [r`Allow-by-default authorisation with opt-in checks.`] },

{ id: 'q44', level: 'Principal', tags: ['patterns', 'evaluation'],
  q: r`How do you evaluate whether a pattern actually improved a system after adoption?`,
  a: r`Define expected outcomes **before** adoption and measure after:

| Pattern | Expected outcome | Metric |
|---|---|---|
| Outbox | No lost events | Reconciliation mismatches, missing-event incidents |
| Circuit breaker + bulkhead | Contain dependency failures | Blast radius of dependency incidents, error rate during outages |
| Strategy for providers | Faster integrations | Lead time per new provider |
| Caching | Lower latency and cost | p95, DB CPU, hit ratio |
| CQRS read models | Faster screens | Query latency, DB load |
| Cells | Smaller blast radius | % customers affected per incident |

Also watch **costs**: added latency, operational toil, onboarding time, incident types introduced by the pattern (e.g. stale caches, stuck sagas). Review after a quarter and be willing to remove a pattern that did not pay.`,
  code: r`~~~text
Pattern review: circuit breakers on outbound payment providers (adopted Q2)
Expected: provider outages no longer degrade checkout for other methods.
Before (Q1): 3 provider incidents, checkout error rate peaked at 34%, 47 min avg impact.
After (Q3):  4 provider incidents, checkout error rate peaked at 6% (affected method only), 9 min avg impact.
New costs: 2 false-open events from aggressive thresholds -> FailureRatio tuned 0.3 -> 0.5.
Decision: keep; standardise thresholds in the resilience package.
~~~`,
  pts: [r`Define expected outcomes and metrics before adopting a pattern.`, r`Measure reliability, lead time, latency and cost impacts.`, r`Track new failure modes the pattern introduces.`, r`Review after a quarter.`, r`Remove patterns that do not pay for themselves.`],
  ex: r`A team removed a CQRS read store after measuring that screens were no faster than with indexed queries on the primary, eliminating a projection pipeline.`,
  fu: [r`How do you attribute an improvement to a pattern rather than other changes?`],
  pit: [r`Adopting patterns without success criteria.`] },

{ id: 'q45', level: 'Principal', tags: ['patterns', 'mentoring'],
  q: r`How do you teach design patterns so engineers recognise problems rather than collect solutions?`,
  a: r`- **Problem-first**: present a real problem from your codebase (a growing switch, a flaky integration), let engineers propose solutions, then name the pattern they arrived at.
- **Forces and consequences**: every pattern discussion includes when not to use it and what it costs.
- **Refactoring katas**: Gilded Rose, Tennis, payments katas; refactor towards a pattern only when the code demands it.
- **Pattern smells in reviews**: "this factory has one product", "this decorator changes the contract".
- **Modern equivalents**: show how delegates, records, pattern matching and DI replace classic boilerplate.
- **Systems view**: link code patterns to architectural ones (decorator to middleware to sidecar).
- **Celebrate simplification**: removing a pattern is as valued as adding one.`,
  code: r`~~~csharp
// Kata step: the code tells you when a pattern is needed
// Iteration 1 (one carrier): no pattern
decimal Shipping(Parcel p) => 3.20m + p.WeightKg * 0.8m;
// Iteration 3 (third carrier, repeated switch in two places): now Strategy pays for itself
public interface IShipping { string Carrier { get; } decimal Quote(Parcel p); }
~~~`,
  pts: [r`Start from real problems and name the pattern afterwards.`, r`Always discuss forces, costs and when not to use it.`, r`Use refactoring katas to apply patterns only when code demands them.`, r`Show modern C# replacements for classic boilerplate.`, r`Value simplification as highly as new abstractions.`],
  ex: r`A problem-first workshop series reduced "pattern for its own sake" review comments by half within a quarter.`,
  fu: [r`How do you assess pattern understanding in interviews?`],
  pit: [r`Teaching the GoF catalogue as a checklist.`] },

{ id: 'q46', level: 'Principal', tags: ['patterns', 'interview-scenario'],
  q: r`Design an extensible document-generation service (statements, invoices, tax forms) for 30 product teams. Which patterns?`,
  a: r`Forces: many document types, different templates and data sources per type, versioning for regulatory forms, high volume at month-end, signed PDFs, audit.

- **Template Method / pipeline** for the fixed flow: gather data -> render -> post-process (sign, watermark) -> store -> notify.
- **Strategy** per document type for data gathering and template selection (registered by product teams as plugins with a conformance test kit).
- **Builder** for assembling complex document models.
- **Versioned templates** (data, not code) with effective dates; documents record template version.
- **Command + queue** for asynchronous generation at scale (competing consumers, priority queues for on-demand vs batch).
- **Idempotency** by (document type, subject, period) so reruns do not duplicate.
- **Decorator** for audit, metrics and signing.
- **Facade** API: {{Generate}}, {{GetStatus}}, {{Download}}.`,
  code: r`~~~csharp
public interface IDocumentType
{
    string Type { get; }                                                       // "statement", "invoice", "1099"
    Task<object> GatherDataAsync(DocumentRequest r, CancellationToken ct);     // strategy owned by product team
    string TemplateId(DocumentRequest r);                                      // versioned by effective date
}
public sealed class GenerationPipeline(IEnumerable<IDocumentType> types, ITemplateEngine templates, IPdfRenderer pdf, ISigner signer, IDocStore store)
{
    public async Task<DocumentRef> RunAsync(DocumentRequest r, CancellationToken ct)
    {
        var key = r.Type + ":" + r.SubjectId + ":" + r.Period;                  // idempotency key
        if (await store.FindAsync(key, ct) is { } existing) return existing;
        var type = types.Single(t => t.Type == r.Type);
        var html = await templates.RenderAsync(type.TemplateId(r), await type.GatherDataAsync(r, ct), ct);
        var signed = await signer.SignAsync(await pdf.RenderAsync(html, ct), ct);
        return await store.SaveAsync(key, signed, new DocMeta(type.TemplateId(r), DateTimeOffset.UtcNow), ct);
    }
}
~~~`,
  dia: r`flowchart LR
  T[Product teams] -->|register IDocumentType plugins| P[Generation pipeline]
  API[Facade API: Generate / Status / Download] --> Q[(Queue: on-demand + batch priorities)]
  Q --> W[Workers] --> P
  P --> TE[Versioned template engine]
  P --> R[PDF renderer]
  P --> S[Signer]
  P --> ST[(Document store + metadata)]
  ST --> N[Notify / events]`,
  pts: [r`Fixed pipeline with type-specific strategies registered by teams.`, r`Versioned templates as data with effective dates.`, r`Commands on queues with competing consumers for month-end volume.`, r`Idempotency by type, subject and period.`, r`Facade API and decorators for audit, metrics and signing.`],
  ex: r`A bank's statement run of 4 million PDFs moved from a 30-hour batch to 5 hours with queued workers, and product teams added 12 new document types without platform changes.`,
  fu: [r`How do you regenerate a document with the original template years later?`],
  pit: [r`Template changes in place, so old documents cannot be reproduced.`] },

{ id: 'q47', level: 'Principal', tags: ['patterns', 'reliability'],
  q: r`Which patterns reduce blast radius in a large platform, and how do you prioritise them?`,
  a: r`Blast-radius patterns, roughly from cheapest to most expensive:

1. **Timeouts, retries with jitter, circuit breakers, bulkheads** in every client (shared resilience package).
2. **Rate limiting and load shedding** at gateways and services (protect the core under overload).
3. **Feature flags and kill switches** for risky functionality.
4. **Progressive delivery**: canary releases with automatic rollback on SLO burn.
5. **Asynchronous decoupling** (queues/events) for non-critical paths.
6. **Shuffle sharding**: assign each customer a random subset of resources so one bad customer affects few others.
7. **Cells**: independent stack copies per customer segment.
8. **Multi-region** active/passive or active/active.

Prioritise by incident history (what actually caused outages), customer impact and cost. Most organisations get most of the benefit from 1 to 4.`,
  code: r`~~~yaml
# Progressive delivery with automatic rollback (Argo Rollouts excerpt)
strategy:
  canary:
    steps:
      - setWeight: 5
      - pause: { duration: 10m }
      - analysis: { templates: [ { templateName: error-rate-slo } ] }   # rolls back if error budget burns
      - setWeight: 25
      - pause: { duration: 20m }
      - setWeight: 100
~~~
~~~csharp
// Load shedding: reject early when the service is saturated
builder.Services.AddRateLimiter(o => o.AddConcurrencyLimiter("shed", l => { l.PermitLimit = 400; l.QueueLimit = 100; }));
~~~`,
  pts: [r`Start with client resilience: timeouts, breakers, bulkheads.`, r`Add rate limiting, load shedding and kill switches.`, r`Progressive delivery with automatic rollback limits bad deploys.`, r`Shuffle sharding and cells for large multi-tenant platforms.`, r`Prioritise by incident history and cost.`],
  ex: r`Analysis of 18 months of incidents showed 60% were bad deploys; canary with automatic rollback cut their impact more than any architectural change.`,
  fu: [r`What is shuffle sharding?`],
  pit: [r`Building multi-region before having basic timeouts.`] },

{ id: 'q48', level: 'Principal', tags: ['patterns', 'ai'],
  q: r`Which design patterns apply to integrating LLMs into .NET applications?`,
  a: r`- **Adapter / port** around model providers ({{IChatClient}} from Microsoft.Extensions.AI) so models can be swapped.
- **Decorator** pipeline: caching, rate limiting, telemetry, content safety, retries around the chat client ({{ChatClientBuilder}} middleware).
- **Strategy** for model routing (cheap model for classification, larger model for reasoning).
- **Retrieval-augmented generation**: a retriever port, chunking strategies, re-ranking.
- **Chain of responsibility / guardrails**: input validation, PII redaction, output validation (schema, policy) before returning.
- **Tool/function calling** as commands with authorisation checks per tool.
- **Circuit breaker and fallback** to a smaller model or a non-AI path.
- **Evaluation harness** (test pattern): golden datasets and automated scoring on every prompt change.`,
  code: r`~~~csharp
// Microsoft.Extensions.AI: decorator-style middleware around a model adapter
IChatClient client = new ChatClientBuilder(new AzureOpenAIClient(endpoint, new DefaultAzureCredential()).GetChatClient("gpt-4o-mini").AsIChatClient())
    .UseDistributedCache(cache)                 // decorator: cache identical prompts
    .UseOpenTelemetry()                          // decorator: traces + token metrics
    .UseFunctionInvocation()                     // tool calling
    .Build();
var reply = await client.GetResponseAsync(
    [new(ChatRole.System, "Classify the complaint into one of: billing, fraud, service."), new(ChatRole.User, Redact(text))],
    new ChatOptions { Temperature = 0, ResponseFormat = ChatResponseFormat.Json }, ct);
var category = Validate(reply.Text);             // output guardrail before use
~~~`,
  pts: [r`Adapter over model providers keeps models swappable.`, r`Decorator middleware for caching, telemetry, safety and retries.`, r`Strategy for routing between models by task and cost.`, r`Guardrail chains on input and output; authorise every tool call.`, r`Evaluation harnesses gate prompt and model changes.`],
  ex: r`Routing simple classification to a small model and complex cases to a larger one cut LLM spend by 70% at the same accuracy on the evaluation set.`,
  fu: [r`How do you test non-deterministic LLM output?`],
  pit: [r`Calling a provider SDK directly from business code.`] },

{ id: 'q49', level: 'Principal', tags: ['patterns', 'decision-records'],
  q: r`How do you document pattern choices so future engineers understand them?`,
  a: r`- **Architecture Decision Records (ADRs)** in the repository: context, forces, options considered, decision, consequences, and **revisit triggers**.
- **Code-level signposts**: brief comments where a pattern is non-obvious ("routing slip because steps vary per document type; see ADR-014").
- **Diagrams as code** (Mermaid, Structurizr) next to the code, generated where possible (state machines from code).
- **Fitness functions**: architecture tests that encode the decision (dependency rules, required decorators), so it is enforced, not just documented.
- **Onboarding walkthroughs** that trace one request through the patterns.

Avoid documenting what the code says; document **why**, especially rejected alternatives, which stop the same debate recurring every year.`,
  code: r`~~~text
docs/adr/0014-routing-slips-for-document-pipeline.md
Status: Accepted (2026-03-02)
Context: 30 document types; step lists differ per type (sign, watermark, translate, archive).
Options: (a) one orchestrated state machine per type (b) routing slip (c) hard-coded pipeline
Decision: (b) routing slips via MassTransit Courier.
Consequences: + teams add steps without central changes; - harder to see full flow -> trace dashboard required.
Revisit if: steps need branching/human approval (then use a process manager).
~~~`,
  pts: [r`Record decisions as ADRs with options, consequences and revisit triggers.`, r`Leave short signposts in code pointing to ADRs.`, r`Keep diagrams as code next to the implementation.`, r`Encode decisions as architecture tests (fitness functions).`, r`Document the why and rejected alternatives.`],
  ex: r`An ADR recording why routing slips were chosen ended a recurring debate and helped a new team extend the pipeline correctly.`,
  fu: [r`How do you keep ADRs current?`],
  pit: [r`Wikis that drift from the code.`] },

{ id: 'q50', level: 'Principal', tags: ['summary'],
  q: r`Summarise your view of design patterns as a Principal Engineer.`,
  a: r`"Patterns are a shared vocabulary for recurring forces, not a checklist.

- I start from the problem: what varies, what fails, what must be reproducible, who owns what.
- At code level I mostly use Strategy, Decorator, Adapter, Factory methods, State machines and Command; modern C# (delegates, records, pattern matching, DI) removes most GoF boilerplate.
- At system level the high-value patterns are outbox/inbox, idempotency, resilience (timeouts, breakers, bulkheads), sagas/process managers, anti-corruption layers, strangler fig, BFF and cells.
- Every pattern has costs; I add them on evidence and define how we will know they paid off.
- I make good patterns the default by shipping them as packages and templates, and I document why in ADRs."`,
  code: r`~~~csharp
// The vocabulary in one flow: adapter (port), decorator (resilience), strategy (routing), command (idempotent), outbox
public sealed class CapturePaymentHandler(IPaymentRouter router, IPaymentStore store, IOutbox outbox)
{
    public async Task HandleAsync(CapturePayment cmd, CancellationToken ct)                      // command with id
    {
        if (await store.AlreadyProcessedAsync(cmd.CommandId, ct)) return;                           // idempotency
        var provider = router.For(cmd);                                                            // strategy
        var result = await provider.CaptureAsync(cmd.PaymentId, cmd.Amount, cmd.CommandId.ToString(), ct);  // adapter + resilience decorators
        await store.SaveAsync(cmd, result, ct);
        await outbox.AddAsync(new PaymentCaptured(cmd.PaymentId, cmd.Amount), ct);                 // outbox, same transaction
    }
}
~~~`,
  pts: [r`Patterns are vocabulary for forces, not a checklist.`, r`Code-level favourites: Strategy, Decorator, Adapter, State, Command.`, r`System-level essentials: outbox/inbox, idempotency, resilience, sagas, ACLs, strangler.`, r`Add patterns on evidence with success criteria.`, r`Ship them as packages and templates; record why in ADRs.`],
  ex: r`This framing, with one real incident each pattern prevented, consistently scores well with Principal-level interview panels.`,
  fu: [r`Which GoF pattern do you think is least relevant today?`],
  pit: [r`Reciting the GoF catalogue without context.`] }
],
cheat: r`### Code-level patterns (modern .NET form)
| Pattern | Use for | .NET form |
|---|---|---|
| Strategy | Interchangeable algorithms | Interface + keyed DI, or Func |
| Decorator | Add behaviour around a call | Scrutor Decorate, DelegatingHandler |
| Adapter / ACL | Fit foreign interfaces, protect the model | Port + adapter class |
| Factory | Non-trivial or runtime creation | Static Create, IHttpClientFactory, IDbContextFactory |
| Builder | Multi-step validated construction, test data | Fluent builder, host builders |
| State | Lifecycle rules | Enum + transition table or state objects |
| Command | Queueable, auditable intent | Record + handler + id |
| Chain of responsibility | Ordered handlers that may short-circuit | Middleware, endpoint filters, rule chains |
| Observer | Notifications | Events, Rx, Channels, brokers |
| Composite / Visitor | Trees, operations over them | Records + pattern matching |

### System-level patterns
Outbox + inbox · idempotency keys · timeout/retry/breaker/bulkhead (Polly v8) · saga / process manager / routing slip · CQRS · event notification vs state transfer · BFF / aggregator / gateway · strangler fig · branch by abstraction · parallel run · leader election with fencing · cells · shuffle sharding.

### Anti-patterns
Singleton globals · service locator · generic repository over EF · factories newing HttpClient · NotImplemented overrides · god facades · write-behind for money · failover after an ambiguous outcome.

### Say this
"Patterns are vocabulary for forces." "A Func is the lightest strategy." "DbContext is already a unit of work." "Never fail over after an unknown outcome." "I add a pattern on evidence and measure whether it paid."`
});
})(String.raw);
