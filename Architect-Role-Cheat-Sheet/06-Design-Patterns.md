# 6. Design Patterns — 30 Questions (Answered)

> **Method:** GoF patterns are defined using the **original intent statement from *Design Patterns: Elements of Reusable Object-Oriented Software*** (Gamma, Helm, Johnson, Vlissides), which is the wording Microsoft Learn also uses. Cloud/distributed patterns are defined from the **Azure Architecture Center — Cloud Design Patterns** catalogue and **AWS Prescriptive Guidance**. Then: C# implementation, when to use, when not to, and the trade-off. Links in **References**.

---

## Q1. What are design patterns?

**Per GoF:** *"Design patterns are descriptions of communicating objects and classes that are customized to solve a general design problem in a particular context."* Each pattern is documented as **Name, Intent, Motivation, Applicability, Structure, Participants, Consequences, Implementation**.

**The three GoF categories:**

| Category | Concern | Patterns |
|---|---|---|
| **Creational** (5) | *How objects are created* — decoupling construction from use | Abstract Factory, Builder, Factory Method, Prototype, Singleton |
| **Structural** (7) | *How objects are composed* into larger structures | Adapter, Bridge, Composite, Decorator, Facade, Flyweight, Proxy |
| **Behavioural** (11) | *How objects interact* and distribute responsibility | Chain of Responsibility, Command, Interpreter, Iterator, Mediator, Memento, Observer, State, Strategy, Template Method, Visitor |

**Beyond GoF**, an architect must also know: **enterprise patterns** (Fowler's PoEAA — Repository, Unit of Work, Data Mapper, Domain Model), **DDD tactical patterns** (Aggregate, Value Object, Specification, Domain Event), and **cloud/distributed patterns** (Azure Architecture Center — Circuit Breaker, Retry, Saga, CQRS, Sidecar, Ambassador, Strangler Fig, Bulkhead, Outbox, Cache-Aside…). Questions 22–29 here are from that last group.

**What patterns actually give you:**
- **A shared vocabulary.** "Put a decorator around it" replaces five minutes of explanation. This is the largest practical benefit and the reason they matter in architecture reviews.
- **Known consequences.** The GoF format documents the *costs*, not just the benefits — which is what makes them design tools rather than recipes.
- **Recognisable structure** — a reader who knows the pattern understands the code faster.

**And the caution to voice:** patterns are **discovered when a force exists**, not applied preemptively. GoF's own Applicability sections are conditional ("use when…"). Applying a pattern with no force present produces ceremony, indirection and a codebase that is *harder* to change — the classic over-engineering failure. Many GoF patterns are also partially or fully subsumed by language features in modern C# (Strategy → `Func<>`/delegates, Iterator → `IEnumerable`/`yield`, Observer → `IObservable`/events, Command → delegates/records, Singleton → DI container lifetime).

---

## Q2. Factory pattern?

**Per GoF (Factory Method):** *"Define an interface for creating an object, but let subclasses decide which class to instantiate. Factory Method lets a class defer instantiation to subclasses."*
(The commonly used **Simple Factory** is not a GoF pattern — it's a static method or class that centralises `new` — but interviewers use "Factory pattern" loosely for both. Say so, then define both.)

```csharp
// --- Simple Factory (not GoF, but the everyday form) ---
public interface IPaymentProcessor { Task<Result> ProcessAsync(Payment p, CancellationToken ct); }

public sealed class PaymentProcessorFactory(IServiceProvider sp) : IPaymentProcessorFactory
{
    public IPaymentProcessor Create(PaymentMethod method) => method switch
    {
        PaymentMethod.Card         => sp.GetRequiredService<CardProcessor>(),
        PaymentMethod.BankTransfer => sp.GetRequiredService<AchProcessor>(),
        PaymentMethod.Wallet       => sp.GetRequiredService<WalletProcessor>(),
        _ => throw new NotSupportedException($"Unsupported method {method}")
    };
}

// --- Factory Method (GoF): the creator hierarchy decides the product ---
public abstract class SettlementJob
{
    protected abstract ISettlementFileParser CreateParser();   // factory method
    public async Task RunAsync(Stream file)                    // template algorithm
        => await Post(CreateParser().Parse(file));
}
public sealed class VisaSettlementJob : SettlementJob
{
    protected override ISettlementFileParser CreateParser() => new VisaCtfParser();
}
```

**Use when:** the concrete type depends on runtime data (a payment method, a tenant, a file format); construction is non-trivial; or you want the creation decision in one auditable place.

**Don't use when:** you have exactly one implementation and no variation — a `new` or a DI registration is clearer. Also, **in .NET the DI container is already a factory**: prefer keyed services (`AddKeyedScoped<IPaymentProcessor, CardProcessor>("card")`, .NET 8+) or an injected `Func<PaymentMethod, IPaymentProcessor>` before hand-rolling a factory class.

**Trade-off:** centralises and clarifies creation; adds a type and a level of indirection, and a `switch` that must be maintained (mitigated by keyed DI or a registry keyed on an enum/`ProcessorFor` attribute).

---

## Q3. Factory vs Abstract Factory?

**Per GoF (Abstract Factory):** *"Provide an interface for creating families of related or dependent objects without specifying their concrete classes."*

| | Factory Method | Abstract Factory |
|---|---|---|
| Creates | **One** product | A **family** of related products |
| Mechanism | Inheritance — a subclass overrides the creation method | Composition — you inject a factory object |
| Varies | The single product type | The whole product family, consistently |
| Signature | `IProduct Create()` | `IProductA CreateA(); IProductB CreateB();` |

**Abstract Factory example — a market-region family where the pieces must match:**

```csharp
public interface IPaymentStackFactory                    // abstract factory
{
    IPaymentProcessor CreateProcessor();
    IFraudScorer      CreateFraudScorer();
    IComplianceCheck  CreateComplianceCheck();
}

public sealed class UkPaymentStackFactory : IPaymentStackFactory   // concrete family: UK
{
    public IPaymentProcessor CreateProcessor()     => new FasterPaymentsProcessor();
    public IFraudScorer      CreateFraudScorer()   => new UkFraudScorer();
    public IComplianceCheck  CreateComplianceCheck() => new FcaComplianceCheck();
}

public sealed class UsPaymentStackFactory : IPaymentStackFactory   // concrete family: US
{
    public IPaymentProcessor CreateProcessor()     => new AchProcessor();
    public IFraudScorer      CreateFraudScorer()   => new UsFraudScorer();
    public IComplianceCheck  CreateComplianceCheck() => new OfacComplianceCheck();
}
```

**The point of Abstract Factory is the *consistency constraint*:** you must never pair a UK processor with a US compliance check. The factory makes the incompatible combination unrepresentable.

**When to use which:** one varying product → Factory Method (or simple factory). A set of products that must vary **together** → Abstract Factory. In practice, in .NET, Abstract Factory is frequently replaced by registering a whole configured module per region/tenant in DI, which achieves the same guarantee with less ceremony.

---

## Q4. Builder pattern?

**Per GoF:** *"Separate the construction of a complex object from its representation so that the same construction process can create different representations."*

```csharp
public sealed class PaymentRequestBuilder
{
    private readonly PaymentRequest _r = new();

    public PaymentRequestBuilder ForAmount(decimal amount, string currency)
        { _r.Amount = amount; _r.Currency = currency; return this; }
    public PaymentRequestBuilder From(string debtorIban) { _r.DebtorIban = debtorIban; return this; }
    public PaymentRequestBuilder To(string creditorIban) { _r.CreditorIban = creditorIban; return this; }
    public PaymentRequestBuilder WithIdempotencyKey(string key) { _r.IdempotencyKey = key; return this; }
    public PaymentRequestBuilder Scheduled(DateOnly date) { _r.ExecutionDate = date; return this; }

    public PaymentRequest Build()
    {
        // validation of the COMPLETE object happens once, here
        if (_r.Amount <= 0) throw new InvalidOperationException("Amount must be positive");
        if (string.IsNullOrEmpty(_r.IdempotencyKey)) throw new InvalidOperationException("Idempotency key required");
        return _r;
    }
}
```

**Use when:** many optional parameters (avoiding the "telescoping constructor" of 8 overloads), construction requires validation across fields, or you want an immutable object built step by step. You already use builders daily: `WebApplicationBuilder`, `StringBuilder`, `ConfigurationBuilder`, EF Core's `ModelBuilder`, Polly's `ResiliencePipelineBuilder` — Microsoft's own APIs are full of them.

**Don't use when:** the object has ≤4 parameters — C# **named and optional arguments**, **object initialisers**, and **`required` init properties** (C# 11) cover that case with no extra type:
```csharp
var r = new PaymentRequest { Amount = 100m, Currency = "GBP", IdempotencyKey = key };  // required props enforce completeness
```

**Trade-off:** excellent readability and immutability support; costs an extra class and can hide missing-field errors until `Build()` unless you use `required` members or a staged/fluent-typed builder that makes illegal orders uncompilable.

---

## Q5. Singleton pattern?

**Per GoF:** *"Ensure a class has only one instance and provide a global point of access to it."*

```csharp
// Classic thread-safe C# form (Lazy<T> handles the locking and memory barriers correctly)
public sealed class ConfigCache
{
    private static readonly Lazy<ConfigCache> _instance = new(() => new ConfigCache());
    public static ConfigCache Instance => _instance.Value;
    private ConfigCache() { }
}
```

**But the answer an architect gives:** *"In .NET I almost never implement the GoF Singleton. I register the type as a singleton in the DI container."*

```csharp
builder.Services.AddSingleton<IConfigCache, ConfigCache>();   // one instance, injected, testable, replaceable
```

This gives the same single-instance guarantee **without** the two things that make GoF Singleton harmful: the global static access point and the hard-coded self-construction. The class stays a normal class with a constructor, so it can be unit-tested, mocked, and given a different lifetime in a different host.

**Legitimate uses of a single instance:** connection multiplexers (`IConnectionMultiplexer` for Redis — the docs are explicit that it must be shared), Kafka producers, `HttpMessageHandler` pools, caches, metric registries, compiled mapper/serializer configurations, clocks.

---

## Q6. Why can Singleton be dangerous?

Six concrete reasons, in the order they bite:

1. **Global mutable state.** A singleton with mutable fields is shared across every concurrent request. Without correct synchronisation it is a data race; in a multi-tenant system, that is a **data-leak security incident** (request A sees request B's tenant), not merely a bug.
2. **Hidden dependencies.** `ConfigCache.Instance` called from deep inside a method is invisible in the constructor signature. You cannot see the dependency graph, and you cannot substitute it. This is the Service Locator anti-pattern wearing a different hat.
3. **Untestable.** Static state persists between tests, so tests become order-dependent and flaky. There is no seam to inject a fake.
4. **Captive dependencies.** A singleton that captures a scoped service (a `DbContext`) extends that service's lifetime to the whole application — non-thread-safe object shared across requests, unbounded change-tracker growth, held connections. .NET's `ValidateScopes`/`ValidateOnBuild` exists specifically to catch this (§1 Q7).
5. **Lifetime and shutdown problems.** Static singletons are constructed by the CLR on first use with no ordering guarantees, aren't disposed deterministically, and complicate graceful shutdown.
6. **It violates SRP and often OCP.** The class takes on responsibility for its own lifetime *and* its business behaviour, and its concrete type is baked into every call site.

**The mitigations:** use DI singleton registration (removes 2, 3, 5); make the instance **immutable or genuinely thread-safe** (`ConcurrentDictionary`, `Interlocked`, immutable snapshots) (removes 1); never inject scoped services into singletons — inject `IServiceScopeFactory` and create a scope per unit of work (removes 4).

---

## Q7. Adapter pattern?

**Per GoF:** *"Convert the interface of a class into another interface clients expect. Adapter lets classes work together that couldn't otherwise because of incompatible interfaces."*

```csharp
// What our domain wants (the "port", owned by the application layer)
public interface IPaymentGateway
{
    Task<AuthorizationResult> AuthorizeAsync(Money amount, Card card, CancellationToken ct);
}

// What the vendor SDK gives us (incompatible, and we don't control it)
public sealed class LegacyVisaSdk
{
    public VisaResponse SubmitTransaction(string amountInCents, string pan, string expiry, string mid);
}

// Adapter: translates our contract to theirs, and their model/errors back to ours
public sealed class VisaGatewayAdapter(LegacyVisaSdk sdk, IOptions<VisaOptions> opts) : IPaymentGateway
{
    public async Task<AuthorizationResult> AuthorizeAsync(Money amount, Card card, CancellationToken ct)
    {
        var resp = await Task.Run(() => sdk.SubmitTransaction(
            amount.MinorUnits.ToString(), card.Pan, card.Expiry.ToString("MMyy"), opts.Value.MerchantId), ct);

        return resp.Code switch                       // vendor error codes → OUR domain vocabulary
        {
            "00" => AuthorizationResult.Approved(resp.AuthCode),
            "51" => AuthorizationResult.Declined(DeclineReason.InsufficientFunds),
            "05" => AuthorizationResult.Declined(DeclineReason.DoNotHonour),
            _    => AuthorizationResult.Failed(resp.Code, resp.Message)
        };
    }
}
```

**Use when:** integrating a third-party SDK, a legacy system, or a vendor whose model you must not let leak into your domain. In DDD terms this is the **Anti-Corruption Layer**, and it is the single most valuable structural pattern in enterprise integration — it means swapping Visa for Adyen touches one class.

**Trade-off:** one more class per integration and a small translation cost; in exchange, the vendor's model, exceptions and quirks are contained at the boundary. Always worth it for external dependencies.

**Adapter vs Facade vs Proxy:** Adapter changes the interface (incompatible → compatible); Facade simplifies a complex subsystem behind a new, smaller interface; Proxy keeps the **same** interface and adds control (Q10).

---

## Q8. Decorator pattern?

**Per GoF:** *"Attach additional responsibilities to an object dynamically. Decorators provide a flexible alternative to subclassing for extending functionality."*

```csharp
// Base implementation
public sealed class PaymentGateway : IPaymentGateway { /* real call */ }

// Decorator: same interface, wraps another instance, adds behaviour
public sealed class CachingPaymentGateway(IPaymentGateway inner, IMemoryCache cache) : IPaymentGateway
{
    public async Task<AuthorizationResult> AuthorizeAsync(Money a, Card c, CancellationToken ct)
        => await cache.GetOrCreateAsync(Key(a, c), _ => inner.AuthorizeAsync(a, c, ct));
}

public sealed class LoggingPaymentGateway(IPaymentGateway inner, ILogger<LoggingPaymentGateway> log) : IPaymentGateway
{
    public async Task<AuthorizationResult> AuthorizeAsync(Money a, Card c, CancellationToken ct)
    {
        using var _ = log.BeginScope("Authorize {Amount}", a);
        var sw = Stopwatch.StartNew();
        var r = await inner.AuthorizeAsync(a, c, ct);
        log.LogInformation("Authorize -> {Outcome} in {Ms}ms", r.Outcome, sw.ElapsedMilliseconds);
        return r;
    }
}

// Composition (Scrutor makes this declarative)
services.AddScoped<IPaymentGateway, PaymentGateway>()
        .Decorate<IPaymentGateway, CachingPaymentGateway>()
        .Decorate<IPaymentGateway, RetryingPaymentGateway>()
        .Decorate<IPaymentGateway, LoggingPaymentGateway>();      // outermost
```

**Why it's powerful:** it is **Open/Closed in its purest form** — you add caching, retry, logging, metrics, authorisation or encryption **without modifying the original class and without a class explosion from subclassing** (3 optional features = 8 subclasses, but only 3 decorators).

**Where you already use it:** ASP.NET Core **middleware is a decorator chain over `RequestDelegate`**; `Stream` decorators (`GZipStream`, `CryptoStream`, `BufferedStream`); MediatR `IPipelineBehavior<,>`; `DelegatingHandler` in `HttpClient`.

**Trade-off:** many small objects, and debugging a deep stack of decorators can be confusing (the stack trace shows five wrappers). Order matters and is easy to get wrong — put logging outermost so it sees retries, and caching outside retry so a cache hit skips it.

---

## Q9. Facade pattern?

**Per GoF:** *"Provide a unified interface to a set of interfaces in a subsystem. Facade defines a higher-level interface that makes the subsystem easier to use."*

```csharp
// A "simple" onboarding operation actually touches six subsystems
public sealed class CustomerOnboardingFacade(
    IKycService kyc, ISanctionsScreening sanctions, IAccountService accounts,
    ICardIssuer cards, INotificationService notify, IAuditLog audit)
{
    public async Task<OnboardingResult> OnboardAsync(OnboardingRequest req, CancellationToken ct)
    {
        var kycResult = await kyc.VerifyAsync(req.Identity, ct);
        if (!kycResult.Passed) return OnboardingResult.Rejected(kycResult.Reason);

        if (await sanctions.IsSanctionedAsync(req.Identity, ct))
            return OnboardingResult.Rejected("Sanctions match");

        var account = await accounts.OpenAsync(req.Product, ct);
        var card    = await cards.IssueAsync(account.Id, ct);
        await notify.SendWelcomeAsync(req.Email, account, ct);
        await audit.RecordAsync("CustomerOnboarded", account.Id, ct);

        return OnboardingResult.Success(account, card);
    }
}
```

**Use when:** a subsystem is complex and most clients need only a common subset; you want to decouple clients from subsystem internals; or you're layering a legacy system behind a modern interface (a facade is often step one of a strangler-fig migration).

**Facade vs Adapter:** Adapter makes an *existing* interface fit an *expected* one (interface conversion). Facade invents a *new, simpler* interface over *many* components (simplification). Adapter usually wraps one thing; facade wraps several.

**Trade-off / risk:** a facade can become a **god object** as more operations are added, and it can hide capability that some clients legitimately need. Mitigate by keeping the facade thin (orchestration only, no business rules), and by leaving the subsystem accessible for advanced clients — GoF explicitly notes that the facade should not prevent direct use of the subsystem.

---

## Q10. Proxy pattern?

**Per GoF:** *"Provide a surrogate or placeholder for another object to control access to it."* GoF names four variants: **remote proxy** (a local representative for a remote object), **virtual proxy** (defer expensive creation), **protection proxy** (control access rights), and **smart reference** (extra actions on access — reference counting, locking, lazy loading).

```csharp
// Protection proxy: same interface, enforces access before delegating
public sealed class AuthorizingLedgerService(ILedgerService inner, IUserContext user, IAuthorizationService authz)
    : ILedgerService
{
    public async Task<Statement> GetStatementAsync(Guid accountId, CancellationToken ct)
    {
        var ok = await authz.AuthorizeAsync(user.Principal, accountId, "account:read");
        if (!ok.Succeeded) throw new ForbiddenException();
        return await inner.GetStatementAsync(accountId, ct);
    }
}
```

**Where proxies appear in .NET, often invisibly:**
- **Remote proxy:** a gRPC/WCF/refit-generated client — you call a local object, it does a network call.
- **Virtual proxy:** EF Core **lazy-loading proxies** (`UseLazyLoadingProxies`) — a navigation property is a proxy that hits the database on first access. (Also the source of N+1 queries — §11 Q11.)
- **Protection proxy:** authorization decorators; Kubernetes/Istio **sidecar proxies** intercepting traffic.
- **Smart reference:** `Lazy<T>`, `WeakReference<T>`, `Castle.DynamicProxy` interceptors used by AOP libraries.

**Proxy vs Decorator — the distinction interviewers probe:** structurally identical (same interface, wraps an instance); the difference is **intent**. A **Decorator adds behaviour** the caller wants (logging, caching, retry) and is usually composed dynamically by the caller. A **Proxy controls access** to the subject (permissions, laziness, remoting, lifetime) and typically *owns* or *creates* the subject, and the caller may not even know it's there.

---

## Q11. Strategy pattern?

**Per GoF:** *"Define a family of algorithms, encapsulate each one, and make them interchangeable. Strategy lets the algorithm vary independently from clients that use it."*

```csharp
public interface IFeeStrategy { decimal Calculate(Money amount, Merchant m); }

public sealed class InterchangePlusFee : IFeeStrategy
{
    public decimal Calculate(Money a, Merchant m) => a.Amount * 0.003m + 0.10m + m.InterchangeRate * a.Amount;
}
public sealed class BlendedFee : IFeeStrategy
{
    public decimal Calculate(Money a, Merchant m) => a.Amount * m.BlendedRate;
}
public sealed class FlatFee : IFeeStrategy
{
    public decimal Calculate(Money a, Merchant m) => m.FlatFeeAmount;
}

// Context selects at runtime; adding a pricing model requires NO change here (OCP)
public sealed class FeeCalculator(IReadOnlyDictionary<PricingModel, IFeeStrategy> strategies)
{
    public decimal For(Money amount, Merchant m) => strategies[m.PricingModel].Calculate(amount, m);
}
```

**Use when:** you have multiple ways to do one thing, selected at runtime; you're replacing a growing `switch`/`if-else` over behaviour; or algorithms need to be independently testable and independently deployable-by-configuration.

**Modern C# note:** for a single-method strategy, a **delegate is the lightweight form** — `Func<Money, Merchant, decimal>` — and is often better. Use an interface when the strategy has multiple members, needs DI dependencies, or when the *name* of the type is valuable documentation.

**Registration in .NET:** keyed DI (`AddKeyedScoped<IFeeStrategy, BlendedFee>(PricingModel.Blended)`) or a dictionary built from all registered implementations (`IEnumerable<IFeeStrategy>` + a `Handles` property) — the latter means adding a strategy requires no change to the selection code at all.

**Trade-off:** one class per algorithm; clients must know which strategy to select (mitigated by a factory or keyed resolution). Massive win when variation is real; over-engineering when there is exactly one algorithm.

---

## Q12. Strategy vs Factory?

They answer **different questions** and are commonly used together:

| | Strategy | Factory |
|---|---|---|
| Category | **Behavioural** | **Creational** |
| Question answered | *"How should this operation be performed?"* | *"Which object should be created?"* |
| Varies | The algorithm/behaviour | The instantiation |
| Lifetime | The strategy is typically held and reused | The factory produces and forgets |
| Typical use | Fee calculation, sorting, compression, routing rules | Choosing a processor per payment method, a parser per file format |

**How they compose:** a **factory creates the strategy**.

```csharp
var strategy = _feeStrategyFactory.Create(merchant.PricingModel);   // Factory: which one?
var fee      = strategy.Calculate(amount, merchant);                // Strategy: how to compute?
```

**The distinction in one line:** *Factory decides **what to build**; Strategy decides **how to behave**. If your "factory" returns different objects that all do the same job differently, you are really selecting a strategy — and the factory is just the selection mechanism.*

**Interviewer's trap:** "isn't a factory with a switch the same as a strategy with a switch?" — No. The factory's switch returns *objects*; removing it doesn't change behaviour, only construction. The strategy's purpose is to *eliminate* a behavioural switch from the business logic by polymorphism. If you have both switches in the same place, you've implemented one pattern twice.

---

## Q13. Observer pattern?

**Per GoF:** *"Define a one-to-many dependency between objects so that when one object changes state, all its dependents are notified and updated automatically."*

```csharp
// Modern .NET: events, IObservable<T>, or an in-process mediator — all Observer
public sealed class PaymentAuthorizedNotification : INotification            // MediatR
{
    public required Guid PaymentId { get; init; }
    public required Money Amount { get; init; }
}

public sealed class UpdateLedgerHandler : INotificationHandler<PaymentAuthorizedNotification> { … }
public sealed class SendReceiptHandler  : INotificationHandler<PaymentAuthorizedNotification> { … }
public sealed class UpdateFraudModelHandler : INotificationHandler<PaymentAuthorizedNotification> { … }

// Publisher knows none of them:
await mediator.Publish(new PaymentAuthorizedNotification { … }, ct);
```

**Why it matters:** the subject is decoupled from the observers — you add a new reaction to "payment authorised" without touching the payment code. This is the **Open/Closed Principle applied to reactions**, and it is the in-process ancestor of event-driven architecture.

**Forms in .NET:** C# `event` (§2 Q6), `IObservable<T>`/`IObserver<T>` with Rx, `IChangeToken`, `INotifyPropertyChanged`, MediatR notifications, and — across processes — a message broker (Kafka/SNS), which is Observer at system scale.

**Production cautions:**
- **Memory leaks** — the subject holds strong references to observers; unsubscribe or use weak events (§2 Q6).
- **Synchronous and in-process** — a slow observer blocks the subject; an observer that throws can break the notification chain. Decide whether handlers must be isolated.
- **No durability, no retry, no ordering guarantee across handlers.** For anything that must not be lost, publish a real event to a broker via the **Outbox** pattern rather than relying on in-process observers.
- **Ordering dependencies between observers are a design smell** — if handler B requires handler A to have run, you have a workflow, not a set of observers; use an orchestrator.

---

## Q14. Chain of Responsibility?

**Per GoF:** *"Avoid coupling the sender of a request to its receiver by giving more than one object a chance to handle the request. Chain the receiving objects and pass the request along the chain until an object handles it."*

```csharp
public abstract class PaymentValidator
{
    private PaymentValidator? _next;
    public PaymentValidator SetNext(PaymentValidator next) { _next = next; return next; }

    public async Task<ValidationResult> ValidateAsync(Payment p, CancellationToken ct)
    {
        var result = await CheckAsync(p, ct);
        if (!result.IsValid) return result;                       // short-circuit on failure
        return _next is null ? ValidationResult.Valid : await _next.ValidateAsync(p, ct);
    }
    protected abstract Task<ValidationResult> CheckAsync(Payment p, CancellationToken ct);
}

public sealed class AmountLimitValidator  : PaymentValidator { … }
public sealed class SanctionsValidator    : PaymentValidator { … }
public sealed class VelocityValidator     : PaymentValidator { … }
public sealed class BalanceValidator      : PaymentValidator { … }
```

**Where you use it every day:** the **ASP.NET Core middleware pipeline** is Chain of Responsibility (each component may handle/short-circuit or pass on), as are MVC **filters**, `DelegatingHandler` chains in `HttpClient`, and MediatR `IPipelineBehavior`.

**Use when:** multiple handlers may process a request, the handler isn't known statically, the set/order of handlers should be configurable, or you want each check independently testable and independently addable.

**Trade-off:** a request may fall off the end unhandled (design a terminal handler or a default); debugging requires understanding the chain's composition; and ordering is significant but not always obvious — document it. Modern C# often replaces the abstract-class chain with a `List<Func<T, Task<Result>>>` composed in DI, which is simpler and just as testable.

---

## Q15. Command pattern?

**Per GoF:** *"Encapsulate a request as an object, thereby letting you parameterize clients with different requests, queue or log requests, and support undoable operations."*

```csharp
public sealed record TransferFundsCommand(
    Guid FromAccount, Guid ToAccount, Money Amount, string IdempotencyKey) : IRequest<TransferResult>;

public sealed class TransferFundsHandler(ILedger ledger, IUnitOfWork uow)
    : IRequestHandler<TransferFundsCommand, TransferResult>
{
    public async Task<TransferResult> Handle(TransferFundsCommand cmd, CancellationToken ct)
    {
        await ledger.DebitAsync(cmd.FromAccount, cmd.Amount, ct);
        await ledger.CreditAsync(cmd.ToAccount, cmd.Amount, ct);
        await uow.SaveChangesAsync(ct);
        return TransferResult.Completed();
    }
}
```

**What making the request an object buys you** — this list *is* the answer:
- **Queueing and deferral** — a command can be serialized and put on a queue for later execution.
- **Logging and audit** — the command is a record of intent; store it and you have an audit trail of *what was asked*, not just what happened. Essential in regulated systems.
- **Retry** — re-execute the same command object.
- **Undo** — pair each command with its inverse (this is GoF's motivating example, and it's what **compensating transactions** in a saga really are).
- **Decoupling** — the invoker (a controller) knows nothing about the receiver (the ledger).
- **Cross-cutting pipelines** — validation, authorization, transactions, logging as `IPipelineBehavior<TRequest,TResponse>` applied to *all* commands uniformly.

**Where it appears architecturally:** it is the **C in CQRS** (§14 Q1–Q3); it is the message you put on a queue in asynchronous messaging; and `ICommand` in WPF/MVVM is the same pattern.

**Trade-off:** a class per operation (verbose for trivial CRUD); indirection between caller and logic. The payoff scales with how much cross-cutting behaviour you apply uniformly — which is why MediatR-style command pipelines earn their keep in large systems and feel like overhead in small ones.

---

## Q16. Mediator pattern?

**Per GoF:** *"Define an object that encapsulates how a set of objects interact. Mediator promotes loose coupling by keeping objects from referring to each other explicitly, and it lets you vary their interaction independently."*

```
WITHOUT mediator: n objects, up to n(n-1)/2 connections   WITH mediator: n connections
   A ── B                                                     A   B
   │ ╳  │                                                      \ /
   C ── D                                                    [Mediator]
                                                                / \
                                                               C   D
```

```csharp
// MediatR: controllers depend on IMediator, never on handlers
[HttpPost]
public async Task<IActionResult> Transfer(TransferRequest req, CancellationToken ct)
{
    var result = await _mediator.Send(new TransferFundsCommand(req.From, req.To, req.Amount, req.Key), ct);
    return result.IsSuccess ? Ok(result) : BadRequest(result.Error);
}
```

**Use when:** many components interact in complex ways and the coupling is the problem; you want interaction logic in one place; or you want a uniform pipeline (validation, logging, transactions) around all interactions.

**Mediator vs Observer:** Observer is one-to-many *broadcast* — the subject doesn't care who listens. Mediator is many-to-many *coordination* — it knows the participants and directs the interaction. MediatR confusingly does both (`Send` = mediator/command, `Publish` = observer/notification).

**The honest architect's caveat, which scores well:** MediatR is widely used in .NET as a way to get a request pipeline and to keep controllers thin — that is a legitimate benefit. But it is not "decoupling" in a strong sense; it replaces a compile-time dependency on a handler with a runtime lookup, which can *hurt* navigability ("where is this handled?"). Use it when you genuinely want the pipeline (validation/logging/transaction behaviours applied uniformly); don't add it purely to avoid injecting a service. And a *mediator that accumulates business rules* becomes a god object — keep the mediator dumb and the handlers smart.

---

## Q17. State pattern?

**Per GoF:** *"Allow an object to alter its behavior when its internal state changes. The object will appear to change its class."*

```csharp
public abstract class PaymentState
{
    public abstract PaymentState Authorize(Payment p);
    public abstract PaymentState Capture(Payment p);
    public abstract PaymentState Refund(Payment p);
}

public sealed class PendingState : PaymentState
{
    public override PaymentState Authorize(Payment p) { p.AuthCode = Gateway.Auth(p); return new AuthorizedState(); }
    public override PaymentState Capture(Payment p) => throw new InvalidStateTransition("Cannot capture a pending payment");
    public override PaymentState Refund(Payment p)  => throw new InvalidStateTransition("Cannot refund a pending payment");
}

public sealed class AuthorizedState : PaymentState
{
    public override PaymentState Authorize(Payment p) => this;                     // idempotent
    public override PaymentState Capture(Payment p) { Gateway.Capture(p); return new CapturedState(); }
    public override PaymentState Refund(Payment p)  { Gateway.Void(p);    return new VoidedState(); }
}
```

**Why it matters in finance:** payment, order, loan and trade lifecycles are state machines with **legal and illegal transitions**, and illegal transitions are the bugs that cost money (capturing an already-refunded payment, settling a cancelled trade). Encoding transitions in types makes the illegal ones **impossible to invoke**, rather than merely guarded by an `if` someone forgot to write.

**State vs Strategy — the classic follow-up:** structurally almost identical (context delegates to a polymorphic object). The differences are intent and control: **Strategy** is chosen by the *client* and doesn't change itself; **State** transitions are driven by the *states themselves* as the object's lifecycle progresses, and states know about each other.

**Alternatives in modern C#:** a `switch` expression over a state enum with exhaustiveness checking; or a declarative state-machine library (Stateless, MassTransit's saga state machines) — which additionally gives you persistence, timeouts and visualisation, and is what I'd reach for in a real workflow. The GoF class-per-state form is best when each state carries substantial distinct behaviour.

---

## Q18. Repository pattern?

**Per Fowler (PoEAA), the definition Microsoft Learn also uses:** *"Mediates between the domain and data mapping layers using a collection-like interface for accessing domain objects."* Microsoft's .NET microservices e-book adds: *"the Repository pattern... isolates the application/domain layer from the details of data access."*

```csharp
// The interface belongs to the DOMAIN/APPLICATION layer (dependency inversion — §2 Q19)
public interface IPaymentRepository
{
    Task<Payment?> GetByIdAsync(PaymentId id, CancellationToken ct);
    Task<IReadOnlyList<Payment>> GetPendingSettlementAsync(DateOnly date, CancellationToken ct);
    Task AddAsync(Payment payment, CancellationToken ct);
    // NOTE: no SaveChanges here — that's the Unit of Work's job (Q19)
}
```

**Design rules that matter more than the pattern itself:**
- **One repository per aggregate root**, not per table. Microsoft's guidance is explicit: *"you should only define one repository per aggregate root."* A `IOrderRepository` returns whole `Order` aggregates including line items — not a separate `IOrderLineRepository`.
- **Return domain objects or explicit results — never `IQueryable`.** Exposing `IQueryable` leaks persistence into the caller and lets a caller trigger a table scan or lazy-load N+1 (§2 Q11).
- **Intention-revealing methods** (`GetPendingSettlementAsync`) beat a generic `Find(Expression<Func<T,bool>>)`, which is just `IQueryable` with extra steps.
- **Avoid the generic `IRepository<T>` with 12 methods.** It becomes a lowest-common-denominator abstraction that leaks and that nobody can change safely.

**Benefits:** testability (in-memory fake for domain tests), a single place for query optimisation, and a boundary that keeps EF Core out of the domain.
**Criticism (be prepared to argue both sides — Q20):** with EF Core the abstraction is thin and can be redundant.

---

## Q19. Unit of Work?

**Per Fowler (PoEAA):** *"Maintains a list of objects affected by a business transaction and coordinates the writing out of changes and the resolution of concurrency problems."*

```csharp
public interface IUnitOfWork
{
    Task<int> SaveChangesAsync(CancellationToken ct);
    Task<IDisposable> BeginTransactionAsync(CancellationToken ct);
}

// A single business operation touching two aggregates, committed atomically
public async Task<Result> HandleAsync(TransferCommand cmd, CancellationToken ct)
{
    var from = await _accounts.GetByIdAsync(cmd.From, ct);
    var to   = await _accounts.GetByIdAsync(cmd.To, ct);

    from.Debit(cmd.Amount);        // domain logic; changes tracked, not yet written
    to.Credit(cmd.Amount);

    await _outbox.AddAsync(new TransferCompleted(cmd.Id), ct);   // event in the SAME transaction
    await _uow.SaveChangesAsync(ct);                             // ONE commit: both accounts + outbox
    return Result.Ok();
}
```

**Why it exists:** it defines the **transactional boundary of a business operation** rather than leaving each repository to save independently (which would produce partial writes). It also enables change tracking, batching of SQL statements, and — critically — writing the **outbox record in the same transaction as the business data** (§4 Q22), which is how you get reliable event publication.

**Relationship to Repository:** repositories collect the changes; the Unit of Work commits them. Repositories should therefore *not* expose `SaveChanges` — otherwise every repository call becomes its own transaction and atomicity is lost.

**In .NET:** `DbContext` **is** a Unit of Work (see Q20). An explicit `IUnitOfWork` interface is usually just a thin wrapper over it whose real value is keeping `DbContext` out of the application layer's signature.

---

## Q20. Does EF Core already implement Repository/Unit of Work concepts?

**Yes — and Microsoft's documentation states it explicitly.** Per Microsoft Learn: *"`DbContext` is a combination of the Unit of Work and Repository patterns"* — `DbSet<T>` is a repository (a collection-like interface over an aggregate/entity set), and `DbContext` with its change tracker plus `SaveChanges()` is the Unit of Work (it tracks affected objects and coordinates writing them out in one transaction, including concurrency resolution).

**So should you add your own layer on top? The honest architect's answer is "it depends, and here are the conditions":**

**Arguments for adding your own repository/UoW:**
1. **Dependency inversion** — the domain/application layer shouldn't reference `Microsoft.EntityFrameworkCore`. The interface lives in the domain; the EF implementation lives in infrastructure. This is the strongest argument and the one Microsoft's own clean-architecture samples follow.
2. **Aggregate-oriented API** — `IOrderRepository.GetWithLinesAsync(id)` encodes the correct `Include`/loading strategy in one place, instead of every caller inventing its own (and forgetting one, producing an N+1).
3. **Query centralisation** — complex queries live somewhere reviewable and optimisable rather than scattered across handlers.
4. **Testability** — mocking `IPaymentRepository` is trivial; mocking `DbContext`/`DbSet` is painful, and the EF **in-memory provider is explicitly not recommended by Microsoft for testing** (it doesn't enforce relational constraints and behaves differently from a real database).
5. **Swap potential** — real, if rare (e.g. moving a read path to Dapper for performance).

**Arguments against:**
1. **It's a leaky abstraction.** Change tracking, lazy loading, `Include`, `AsNoTracking`, `AsSplitQuery` and transaction scope all leak through anyway.
2. **You will not swap the ORM.** Being honest about this removes the most-cited justification.
3. **Generic repositories actively hurt** — they either restrict you (no composition) or degenerate into `IQueryable` passthroughs.
4. **Extra code with no behaviour** for simple CRUD services.

**My position, stated as guidance:** *"For a domain-rich service using Clean Architecture — yes, use explicit aggregate repositories and treat `DbContext` as the Unit of Work behind an interface, because the value is dependency direction and aggregate-correct loading, not ORM portability. For a CRUD service or a read model — use `DbContext` directly and skip the ceremony. Never write a generic `IRepository<T>`."* Also worth adding: for **read/query paths** (the Q in CQRS), bypass the repository entirely and use projections or Dapper — Microsoft's own eShop reference architecture does exactly this.

---

## Q21. Dependency Injection pattern?

**Per Microsoft Learn (.NET dependency injection):** *"Dependency injection in .NET is a built-in part of the framework... DI is a technique for achieving Inversion of Control (IoC) between classes and their dependencies."* The container is `IServiceProvider`, populated from an `IServiceCollection` of `ServiceDescriptor`s.

**The three injection forms** (Fowler's taxonomy):
- **Constructor injection** — dependencies are required and supplied at construction. **The default and the only one you should normally use**: it makes dependencies explicit, enables `readonly` fields, and makes an incompletely-configured object impossible.
- **Property/setter injection** — optional dependencies. Not supported by the built-in .NET container by design.
- **Method injection** — passed per call. Used by ASP.NET Core middleware `InvokeAsync` and `[FromServices]` parameters to inject scoped services into singleton components (§1 Q3).

```csharp
public sealed class PaymentService(                       // primary constructor, C# 12
    IPaymentRepository repository,
    IPaymentGateway gateway,
    IEventPublisher publisher,
    TimeProvider clock,
    ILogger<PaymentService> logger) : IPaymentService
{ … }
```

**Why it matters architecturally:** DI is the *mechanism* by which Dependency Inversion (§2 Q19) is realised at runtime — the composition root binds abstractions to implementations in one place (`Program.cs`), so the rest of the code depends only on contracts. It also gives you lifetime management, disposal, and a single place to see the whole object graph.

**Rules I enforce:** constructor injection only; no Service Locator (`IServiceProvider` injected into business classes); `ValidateOnBuild`/`ValidateScopes` on in every environment; interfaces introduced at boundaries you actually need to isolate, not reflexively; and lifetimes chosen deliberately (§1 Q5–Q7).

---

## Q22. Specification pattern?

**Per Evans & Fowler ("Specifications", and the DDD literature Microsoft Learn references):** a Specification encapsulates a **business rule as a first-class object** that can answer *"does this candidate satisfy the rule?"*, and that can be **combined** with And/Or/Not — solving the problem that business rules otherwise get duplicated across validation, selection and construction.

```csharp
public abstract class Specification<T>
{
    public abstract Expression<Func<T, bool>> ToExpression();          // translatable to SQL
    public bool IsSatisfiedBy(T candidate) => ToExpression().Compile()(candidate);   // in-memory check

    public Specification<T> And(Specification<T> other) => new AndSpecification<T>(this, other);
    public Specification<T> Or(Specification<T> other)  => new OrSpecification<T>(this, other);
    public Specification<T> Not() => new NotSpecification<T>(this);
}

public sealed class HighValuePaymentSpec(decimal threshold) : Specification<Payment>
{
    public override Expression<Func<Payment, bool>> ToExpression() => p => p.Amount > threshold;
}
public sealed class UnsettledSpec : Specification<Payment>
{
    public override Expression<Func<Payment, bool>> ToExpression() => p => p.SettledAt == null;
}

// One rule, three uses — no duplication
var needsReview = new HighValuePaymentSpec(10_000m).And(new UnsettledSpec());
var rows  = await db.Payments.Where(needsReview.ToExpression()).ToListAsync(ct);   // querying (SQL)
var check = needsReview.IsSatisfiedBy(payment);                                    // validation (in memory)
```

**Use when:** the same business rule is needed for *querying*, *validating* and *describing intent*; rules combine in many permutations; or rules are configured per tenant/product and must be composable at runtime.

**Value:** the rule has a **name** (`HighValuePaymentSpec`), a **test**, and **one definition** — instead of the same predicate copy-pasted into a repository query, a validator and a UI filter, drifting apart over time. That drift is a genuine compliance risk in finance.

**Trade-off:** more types; expression-tree specifications must stay EF-translatable (no method calls EF can't convert); and over-composition produces unreadable rule trees. Use it where rules are genuinely shared and volatile; a plain LINQ predicate is fine where they aren't.

---

## Q23. CQRS pattern?

**Per Azure Architecture Center ("CQRS pattern"):** *"CQRS stands for Command and Query Responsibility Segregation, a pattern that separates read and update operations for a data store. Implementing CQRS in your application can maximize its performance, scalability, and security."*

```
                 ┌──── Commands ────▶ Write model ──▶ Write store (normalised, ACID)
   Client ───────┤                          │
                 └──── Queries ─────▶ Read model ◀── (events / replication / projection)
                                              └────▶ Read store (denormalised, fast)
```

**Levels of adoption — say which one you mean, because "CQRS" is used for all three:**
1. **Separate models in one codebase, one database.** Commands use rich domain entities; queries use flat DTO projections (or Dapper). *This is the 90 % case, and it's cheap.*
2. **Separate read store**, kept current by events or replication. Adds eventual consistency and real scaling benefits.
3. **Full CQRS + Event Sourcing** — the write side stores events, projections build read models (§13).

**Benefits (as documented):** independent scaling of reads and writes (typically 10:1+ ratios); read schemas optimised per query with no joins; simpler write model focused on invariants; separate security models for read vs write.

**Costs:** more code, two models to keep aligned, and — at level 2+ — **eventual consistency the UI must handle** ("your payment is processing"). Azure's guidance explicitly warns that CQRS *"adds complexity"* and should not be applied to a whole system indiscriminately.

**When to apply it:** a bounded context with a high read:write ratio, complex reporting needs, or genuinely different consistency requirements between reads and writes. **Not** for simple CRUD — Azure's documentation says this plainly.

---

## Q24. Saga pattern?

**Per Azure Architecture Center:** *"A saga is a sequence of local transactions. Each local transaction updates the database and publishes a message or event that triggers the next local transaction in the saga. If a local transaction fails, the saga executes a series of compensating transactions that undo the changes made by the preceding local transactions."*

Full treatment in **§4 Q18–Q21** and **§14 Q5–Q8**. Summary for this catalogue:

- **Problem it solves:** with database-per-service, ACID transactions cannot span services, and 2PC is rejected for microservices (blocking, coordinator SPOF, availability coupling).
- **Two forms:** **choreography** (services react to each other's events; no coordinator) and **orchestration** (a central state machine issues commands). Orchestration is preferred for business-critical, multi-step, observable workflows.
- **Key property:** the saga provides **A**tomicity (all-or-compensated), **C**onsistency and **D**urability, but **not Isolation** — intermediate states are visible, so you need semantic locks/status fields and the documented countermeasures.
- **Compensation ≠ rollback** — it is a new, forward transaction that semantically offsets the earlier one, and it remains visible in the audit history (which regulators require).
- **Implementations:** MassTransit / NServiceBus sagas, Dapr Workflow, **AWS Step Functions**, Azure Durable Functions.

---

## Q25. Outbox pattern?

**Per AWS Prescriptive Guidance ("Transactional outbox"):** the pattern *"lets you reliably publish messages by storing them in an outbox table in the same transaction as the business data, and publishing them asynchronously"* — solving the **dual-write problem** (you cannot atomically write to a database and to a message broker).

Full treatment in **§4 Q22–Q23** and **§14 Q9–Q12**. Summary:

```sql
BEGIN TRANSACTION;
  UPDATE Accounts SET Balance = Balance - 100 WHERE Id = @from;
  INSERT INTO Outbox (MessageId, Type, Payload, OccurredAt) VALUES (@msgId, 'FundsDebited', @json, SYSUTCDATETIME());
COMMIT;                       -- one local ACID transaction: state + intent to publish
-- a separate relay (poller or CDC) publishes and marks processed
```

- **Guarantee:** at-least-once publication → **consumers must be idempotent**.
- **Relay options:** polling publisher (simple, easy to operate) or **CDC** reading the transaction log (Debezium, AWS DMS — lower latency, no polling load, more infrastructure).
- **Operational notes:** index on `(ProcessedAt, OccurredAt)`, purge/archive processed rows, preserve per-aggregate ordering, use `SKIP LOCKED`/`READPAST` for multiple relay instances.
- **Complement:** the **Inbox** pattern on the consumer side (a processed-message table) completes the reliability story.

---

## Q26. Circuit Breaker pattern?

**Per Azure Architecture Center:** *"Handle faults that might take a variable amount of time to recover from when connecting to a remote service or resource... acts as a proxy for operations that might fail... [and] prevents an application from repeatedly trying to execute an operation that's likely to fail."*

Full treatment in **§4 Q29**. Catalogue summary:

- **States:** **Closed** (calls pass, failures counted) → **Open** (calls fail fast without contacting the dependency) → **Half-Open** (limited trial calls) → Closed on success, Open on failure.
- **Configuration that matters:** failure **ratio** over a sampling window (not a raw count), a **minimum throughput** so small samples don't trip it, a break duration, and **one breaker per dependency**.
- **Why fail-fast helps both sides:** the caller stops burning threads and latency budget; the dependency gets the load relief it needs to recover.
- **Always pair with a fallback** (cached data, default, queued-for-later) — that's what converts fail-fast into graceful degradation.
- **Composition order:** timeout (inner) → retry → circuit breaker (outer), so exhausted retries feed the breaker.
- **.NET implementation:** `Microsoft.Extensions.Http.Resilience` / Polly v8 `AddCircuitBreaker`.
- **Alert on breaker state transitions** — an opening breaker is a first-class incident signal.

---

## Q27. Bulkhead pattern?

**Per Azure Architecture Center:** *"Isolate elements of an application into pools so that if one fails, the others will continue to function. This pattern is named Bulkhead because it resembles the sectioned partitions of a ship's hull."*

Full treatment in **§4 Q30**. Catalogue summary:

- **Failure prevented:** one slow dependency consuming a *shared* resource (thread pool, connection pool, memory) and taking down unrelated functionality.
- **Levels:** per-dependency concurrency limiters and connection pools (in-process); separate worker pools/channels per workload class; separate deployments for critical vs non-critical; separate node pools/clusters/databases (infrastructure); **cell-based architecture and shuffle sharding** per AWS for tenant-level blast-radius reduction.
- **Key design choice:** limits are **per dependency**, and each needs a queue policy — reject fast (preferred) or bounded wait. Unbounded queues convert overload into OOM.
- **Complements:** timeouts bound *duration*; bulkheads bound *resource consumption*; circuit breakers bound *continued attempts*. You need all three.

---

## Q28. Sidecar pattern?

**Per Azure Architecture Center ("Sidecar pattern"):** *"Deploy components of an application into a separate process or container to provide isolation and encapsulation... A sidecar is deployed alongside a parent application, providing supporting features. The sidecar shares the same lifecycle as the parent application — created and retired alongside the parent."*

```yaml
# Kubernetes: two containers in one Pod — same lifecycle, same network namespace, shared volumes
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: payments-api            # the application
      image: acme/payments:1.4.2
    - name: envoy                   # sidecar: mTLS, retries, telemetry (service mesh)
      image: envoyproxy/envoy:v1.29
    - name: fluent-bit              # sidecar: log shipping
      image: fluent/fluent-bit:3.0
```

**Why the Pod is the right unit (per the Kubernetes docs):** containers in a Pod share the network namespace (`localhost`), can share volumes, and are scheduled and scaled together — exactly the properties a sidecar needs.

**Typical sidecars:** service-mesh data plane (Envoy/linkerd2-proxy) for mTLS, retries, circuit breaking and telemetry; log shippers (Fluent Bit); metrics exporters; config/secret sync (Secrets Store CSI, `git-sync`); proxies for legacy protocols; **Dapr** for building-block APIs.

**Benefits:** language-agnostic capability (one Envoy serves .NET, Java and Python services identically); independent versioning of the cross-cutting concern; no application code changes.
**Costs — say these too:** resource overhead per Pod (CPU/memory × replica count), added network hop latency, startup-ordering issues (mitigated by Kubernetes **native sidecar containers**, `restartPolicy: Always` on an init container, GA in 1.29+), and upgrade choreography across the fleet.

**When not to:** small deployments where a library is simpler; latency-critical paths where an extra proxy hop is unacceptable.

---

## Q29. Strangler Fig pattern?

**Per Azure Architecture Center ("Strangler Fig pattern"):** *"Incrementally migrate a legacy system by gradually replacing specific pieces of functionality with new applications and services. As features from the legacy system are replaced, the new system eventually replaces all of the old system's features, strangling the old system and allowing you to decommission it."* AWS Prescriptive Guidance publishes the same pattern for monolith modernisation.

```
Phase 1: all traffic → Monolith
Phase 2: Facade/router in front:  /payments → NEW service ; everything else → Monolith
Phase 3: more routes migrate one at a time
Phase 4: Monolith decommissioned; facade may remain as the API gateway
```

**The mechanism:** an **interception layer** (API gateway, reverse proxy, YARP, ALB listener rules, or a facade in the monolith itself) routes each capability to either the old or the new implementation, switchable per route and per percentage of traffic.

**Why it is the default migration strategy:**
- **Incremental value** — the first slice ships in weeks, not years.
- **Low risk** — each slice is independently testable and independently reversible (route back to the monolith).
- **No big-bang cutover** — the failure mode of rewrites, and the reason most rewrites fail.
- **Business continuity** — the legacy system keeps running throughout.

**Hard parts to acknowledge:**
- **Data.** The new service needs data still owned by the monolith. Options: temporary shared database with strict boundaries, **CDC** replication into the new store, an API back into the monolith, or dual-write with reconciliation. This is where most strangler migrations get stuck, and saying so shows real experience.
- **Coexistence period** — two systems, two on-call surfaces, sometimes duplicated logic; keep it as short as possible and *plan the decommission from day one*.
- **The facade must not become permanent hidden complexity** (though it often becomes the legitimate API gateway).
- **Discipline** — the failure mode is a migration that stalls at 60 % and stays there for years, leaving you with *both* systems forever.

---

## Q30. How do you decide which pattern to use?

**Answer with a decision process, not a lookup table** — this is the question that tests whether you use patterns or are used by them.

**1. Start from the force, not the pattern.** Name the actual pressure: *"this `switch` grows every time we add a payment method"* (→ Strategy/Factory), *"we need retries and caching around a call without editing the class"* (→ Decorator), *"a vendor SDK's model is leaking into our domain"* (→ Adapter/ACL), *"we can't atomically write the DB and publish"* (→ Outbox). **No force, no pattern.**

**2. Apply YAGNI and the Rule of Three.** The first occurrence: write it directly. The second: note the duplication. The third: abstract. Speculative generality is more expensive than duplication, because the wrong abstraction is harder to remove than a copy-paste.

**3. Check whether the language already solves it.** Modern C# subsumes several GoF patterns: Strategy → `Func<>`; Iterator → `IEnumerable`/`yield`; Observer → `event`/`IObservable`; Command → records + delegates; Singleton → DI lifetime; Template Method → often better as an injected delegate; Factory → keyed DI. Using a heavyweight class hierarchy where a delegate suffices is a smell.

**4. Weigh the consequences section, not just the intent.** Every pattern adds indirection, types and a learning cost. Ask: *what does this cost the next person reading it, and is the flexibility one we will actually use?*

**5. Match the pattern's scope to the problem's scope.** GoF patterns are class-level. Distributed problems (partial failure, dual writes, cross-service transactions) need **cloud patterns** — Circuit Breaker, Retry, Saga, Outbox, CQRS, Bulkhead — and no amount of clever OO will substitute.

**6. Prefer patterns your team already knows,** or budget for teaching. An unfamiliar pattern applied silently is indistinguishable from complexity.

**7. Record the decision.** An ADR stating the force, the options considered, the choice and the consequences is worth more than the pattern itself — it's what lets someone in two years know whether the force still exists.

**The one-line version:** *"Patterns are answers. I make sure I have the question first — and I write down what the question was."*

---

## References — official documentation

| Topic | Source |
|---|---|
| Cloud Design Patterns catalogue (Azure Architecture Center) | https://learn.microsoft.com/azure/architecture/patterns/ |
| CQRS pattern | https://learn.microsoft.com/azure/architecture/patterns/cqrs |
| Saga pattern | https://learn.microsoft.com/azure/architecture/patterns/saga |
| Transactional outbox (AWS Prescriptive Guidance) | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html |
| Circuit Breaker pattern | https://learn.microsoft.com/azure/architecture/patterns/circuit-breaker |
| Bulkhead pattern | https://learn.microsoft.com/azure/architecture/patterns/bulkhead |
| Sidecar pattern | https://learn.microsoft.com/azure/architecture/patterns/sidecar |
| Ambassador pattern | https://learn.microsoft.com/azure/architecture/patterns/ambassador |
| Strangler Fig pattern | https://learn.microsoft.com/azure/architecture/patterns/strangler-fig |
| Strangler fig for monolith modernisation (AWS) | https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-decomposing-monoliths/strangler-fig.html |
| Kubernetes Pods & sidecar containers | https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/ |
| Design a DDD-oriented microservice (aggregates, repositories) | https://learn.microsoft.com/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ |
| Infrastructure persistence layer — Repository per aggregate | https://learn.microsoft.com/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design |
| `DbContext` as Unit of Work + Repository | https://learn.microsoft.com/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design#the-repository-pattern |
| EF Core testing guidance (why not InMemory) | https://learn.microsoft.com/ef/core/testing/ |
| Dependency injection in .NET | https://learn.microsoft.com/dotnet/core/extensions/dependency-injection |
| Keyed DI services (.NET 8) | https://learn.microsoft.com/dotnet/core/extensions/dependency-injection#keyed-services |
| .NET resilience (Polly v8 / `Microsoft.Extensions.Resilience`) | https://learn.microsoft.com/dotnet/core/resilience/ |

---

**Previous:** [05 — Distributed Systems](./05-Distributed-Systems.md) | **Next:** [07 — Event-Driven Architecture](./07-Event-Driven-Architecture.md)
