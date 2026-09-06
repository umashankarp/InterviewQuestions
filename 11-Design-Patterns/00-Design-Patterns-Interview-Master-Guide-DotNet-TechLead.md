# Design Patterns Interview Master Guide — .NET Technical Lead

> Domain: Design Patterns | Audience: 14+ yrs, C#/.NET, interviewing for **Technical Lead / Architect**
> Scope: **15 patterns only** — the 14 GoF patterns that actually get asked in .NET interviews, plus Repository / Unit of Work
> **Every example is from one payment platform**, so the patterns compose rather than sitting in isolation.
> Companion: [[../17-Microservices/00-Microservices-Interview-Master-Guide-DotNet-TechLead-Architect]] — the distributed patterns (Saga, Outbox, CQRS, Circuit Breaker…)

---

## How to read this guide

Every pattern follows the same shape:

**Star rating** → **Problem** → **Diagram** → **Interface** → **Implementations** → **Wiring it up** → **When to use?** → **When NOT to use?** → **Where .NET already does this** → **Classic example** → **Interview Q&A** → **Don't confuse with**

| Rating | Meaning |
|---|---|
| ⭐⭐⭐⭐⭐ | Near-certain. Expect it in most loops, and expect follow-ups |
| ⭐⭐⭐⭐ | Very likely. Know it cold |
| ⭐⭐⭐ | Comes up. Know the intent and one .NET example |

### The running domain

```
                    Merchant / Checkout
                            |
                    PaymentProcessor
                            |
        ┌───────────────────┼───────────────────┐
   Payment Method      Payment Gateway      Payment Lifecycle
   ├── Card            ├── Stripe           Initiated
   ├── UPI             ├── Adyen              → Authorized
   ├── Wallet          └── Razorpay            → Captured
   └── NetBanking                              → Settled | Failed | Refunded
```

One domain is deliberate: you will be asked to *compare* patterns, and comparisons land far better when both sides come from the same system.

### The 15 patterns

| # | Pattern | Rating | Payment example |
|---|---|---|---|
| 1 | [Factory Method](#1-factory-method-) | ⭐⭐⭐⭐ | Pick the gateway by country |
| 2 | [Abstract Factory](#2-abstract-factory-) | ⭐⭐⭐ | A provider's matched authorizer + refunder + webhook validator |
| 3 | [Builder](#3-builder-) | ⭐⭐⭐⭐ | Construct a validated `PaymentRequest` |
| 4 | [Singleton](#4-singleton-) | ⭐⭐⭐⭐⭐ | Merchant configuration cache |
| 5 | [Adapter](#5-adapter-) | ⭐⭐⭐⭐ | Stripe SDK → `IPaymentGateway` |
| 6 | [Decorator](#6-decorator-) | ⭐⭐⭐⭐⭐ | Idempotency + retry + logging around authorisation |
| 7 | [Facade](#7-facade-) | ⭐⭐⭐ | One `PayAsync` over the whole payment subsystem |
| 8 | [Proxy](#8-proxy-) | ⭐⭐⭐ | Authorisation check before a refund |
| 9 | [Strategy](#9-strategy-) | ⭐⭐⭐⭐⭐ | Card / UPI / Wallet processing |
| 10 | [Observer](#10-observer-) | ⭐⭐⭐⭐ | Payment status change → ledger, notify, analytics |
| 11 | [Command](#11-command-) | ⭐⭐⭐⭐ | Capture / refund as queued, retryable operations |
| 12 | [Chain of Responsibility](#12-chain-of-responsibility-) | ⭐⭐⭐⭐⭐ | Refund approval tiers |
| 13 | [Mediator](#13-mediator-) | ⭐⭐⭐⭐ | Checkout screen coordination |
| 14 | [State](#14-state-) | ⭐⭐⭐ | The payment lifecycle |
| 15 | [Repository / Unit of Work](#15-repository--unit-of-work-) | ⭐⭐⭐⭐⭐ | The Payment aggregate |

**Removed** — Prototype, Bridge, Composite, Flyweight, Template Method, Iterator, Memento, Visitor, Interpreter. All nine are absorbed into the C# language (`record`/`with`, `yield return`, `ArrayPool<T>`), rare in .NET application code, or effectively never asked.

**The one move most candidates miss:** name where **.NET already implements the pattern**. Every section has it.

---

# 1. Factory Method ⭐⭐⭐⭐

**Problem**

Suppose a payment must route to a different gateway depending on the merchant's country. The caller needs an `IPaymentGateway` — it must not know whether it gets Stripe, Adyen or Razorpay, and adding a fourth must not edit every call site.

```
        PaymentProcessor
              |
        (asks factory)
              |
      IPaymentGatewayFactory
        /     |      \
   Stripe   Adyen   Razorpay
   (US,CA) (GB,DE)   (IN)
```

**Interface:**

```csharp
public interface IPaymentGatewayFactory
{
    IPaymentGateway Create(string countryCode);
}
```

**Implementation:**

```csharp
public class PaymentGatewayFactory : IPaymentGatewayFactory
{
    private readonly IServiceProvider _sp;
    public PaymentGatewayFactory(IServiceProvider sp) => _sp = sp;

    public IPaymentGateway Create(string countryCode) => countryCode switch
    {
        "US" or "CA"          => _sp.GetRequiredService<StripeGateway>(),
        "GB" or "DE" or "FR"  => _sp.GetRequiredService<AdyenGateway>(),
        "IN"                  => _sp.GetRequiredService<RazorpayGateway>(),
        _ => throw new NotSupportedException($"No gateway configured for '{countryCode}'.")
    };
}
```

**The modern .NET 8+ way — keyed services, no hand-written factory:**

```csharp
builder.Services.AddKeyedScoped<IPaymentGateway, StripeGateway>("US");
builder.Services.AddKeyedScoped<IPaymentGateway, AdyenGateway>("GB");
builder.Services.AddKeyedScoped<IPaymentGateway, RazorpayGateway>("IN");

public class PaymentProcessor
{
    private readonly IServiceProvider _sp;
    public PaymentProcessor(IServiceProvider sp) => _sp = sp;

    public Task<AuthorizationResult> AuthorizeAsync(Payment payment)
        => _sp.GetRequiredKeyedService<IPaymentGateway>(payment.CountryCode).AuthorizeAsync(payment);
}
```

**When to use?**

When the concrete type is a **policy decision** — which gateway, which region, which merchant tier. The test: *would adding a gateway force this call site to change?*

**When NOT to use?**

- One gateway, no realistic second — ceremony.
- The container can already pick it by registration.
- A `static` factory whose `switch` every new gateway must edit — you relocated the problem.

**Where .NET already does this**

`ILoggerFactory.CreateLogger` · `IHttpClientFactory.CreateClient` · `IServiceScopeFactory.CreateScope` · `IDbContextFactory<T>.CreateDbContext`

**Classic example:**

```
Payment Gateway
 ├── Stripe        (US, CA)
 ├── Adyen         (GB, DE, FR)
 ├── Razorpay      (IN)
 └── SandboxFake   (test)
```

**Interview Q&A**

**Q. Factory vs `new StripeGateway()`?**
`new` when the caller owns the type — a `Money`, a `PaymentRequest`. Factory when the type is a runtime policy decision, like which acquirer processes this transaction.

**Q. Isn't the `switch` an OCP violation?**
A *contained* one — one place changes instead of every payment call site. If gateways arrive often, move to keyed DI so adding one is additive.

**Q. Risk of injecting `IServiceProvider`?**
Service Locator — the dependency vanishes from the signature. Fine *inside a factory*; never let it leak into `PaymentProcessor`.

**Don't confuse with:** **Abstract Factory** (a *family*) · **Builder** (assembles one known type) · **Strategy** (picks an *algorithm*)

---

# 2. Abstract Factory ⭐⭐⭐

**Problem**

Suppose each provider gives you three collaborating pieces: an **authorizer**, a **refund processor**, and a **webhook signature validator**. A Stripe authorizer with an Adyen webhook validator isn't just wrong — the signature will never verify, and you find out in production.

```
      IPaymentProviderFactory
        /                  \
  StripeProvider      AdyenProvider
   /    |    \          /    |    \
Auth Refund Webhook  Auth Refund Webhook
   (all Stripe)         (all Adyen)
```

**The distinguishing feature:** Factory Method creates **one** product. Abstract Factory creates a **family**, and what it buys is **consistency within that family**.

**Interface:**

```csharp
public interface IPaymentProviderFactory
{
    IPaymentAuthorizer CreateAuthorizer();
    IRefundProcessor   CreateRefundProcessor();
    IWebhookValidator  CreateWebhookValidator();
}
```

**Implementations:**

```csharp
public class StripeProviderFactory : IPaymentProviderFactory
{
    public IPaymentAuthorizer CreateAuthorizer()       => new StripeAuthorizer();
    public IRefundProcessor   CreateRefundProcessor()  => new StripeRefundProcessor();
    public IWebhookValidator  CreateWebhookValidator() => new StripeWebhookValidator();  // HMAC-SHA256, Stripe-Signature
}

public class RazorpayProviderFactory : IPaymentProviderFactory
{
    public IPaymentAuthorizer CreateAuthorizer()       => new RazorpayAuthorizer();
    public IRefundProcessor   CreateRefundProcessor()  => new RazorpayRefundProcessor();
    public IWebhookValidator  CreateWebhookValidator() => new RazorpayWebhookValidator(); // different scheme, header
}
```

**When to use?**

Products **genuinely related**, where a mismatch is a defect: a provider's authorizer/refunder/validator triple, a DB provider's connection/command/parameter set.

**When NOT to use?**

- Products aren't related — an ISP violation wearing a pattern's name.
- Only one provider will ever exist.
- DI can select the family per environment. Reach for the explicit factory when the provider is chosen **per transaction at runtime**.

**The trade-off to state:** adding a **new product** (say `CreateDisputeHandler()`) forces **every** factory to change. Open to new *families*, closed to new *products* — the inverse of what people assume.

**Where .NET already does this**

`DbProviderFactory` — `CreateConnection()`, `CreateCommand()`, `CreateParameter()`, all same-provider. `SqlClientFactory.Instance`, `NpgsqlFactory.Instance`.

**Classic example:**

```
Payment Provider Family
 ├── Stripe   ──→ StripeAuthorizer + StripeRefundProcessor + StripeWebhookValidator
 ├── Adyen    ──→ AdyenAuthorizer  + AdyenRefundProcessor  + AdyenWebhookValidator
 └── Razorpay ──→ RazorpayAuthorizer + RazorpayRefundProcessor + RazorpayWebhookValidator

 Mixing across rows = a webhook that never verifies.
```

**Interview Q&A**

**Q. Real example where consistency mattered?**
Exactly this. Webhook validation is provider-specific — different header, HMAC scheme, payload canonicalisation. A mismatched pair fails silently until a webhook arrives in production.

**Q. Why is DI often better in .NET?**
Register the family per merchant profile; consumers inject products directly. Same consistency, one less indirection.

**Don't confuse with:** **Factory Method** (one product) · **Builder** (one object, many steps) · **Facade** (doesn't create matched sets)

---

# 3. Builder ⭐⭐⭐⭐

**Problem**

Suppose you must construct a `PaymentRequest` with many optional fields and rules spanning several of them:

```csharp
new PaymentRequest(amount, currency, method, customerId, token, mandateId,
                   captureMode, idempotencyKey, threeDsMode, metadata, ...)
```

Unreadable, breaks callers when extended, and cannot express *"recurring requires a mandate"* or *"delayed capture is card-only."*

```
PaymentRequestBuilder
  .For(Money.Inr(2500))
  .UsingUpi("user@bank")
  .WithIdempotencyKey(key)
        |
      Build()   ← ALL validation happens here, once
        |
  PaymentRequest  (immutable)
```

**Implementation:**

```csharp
public class PaymentRequestBuilder
{
    private Money _amount;
    private PaymentMethod _method;
    private string _instrument;          // card token, VPA, wallet id
    private string _idempotencyKey;
    private string _mandateId;
    private CaptureMode _capture = CaptureMode.Immediate;

    public PaymentRequestBuilder For(Money amount)           { _amount = amount; return this; }
    public PaymentRequestBuilder UsingCard(string token)     { _method = PaymentMethod.Card;   _instrument = token; return this; }
    public PaymentRequestBuilder UsingUpi(string vpa)        { _method = PaymentMethod.Upi;    _instrument = vpa;   return this; }
    public PaymentRequestBuilder UsingWallet(string id)      { _method = PaymentMethod.Wallet; _instrument = id;    return this; }
    public PaymentRequestBuilder WithIdempotencyKey(string k){ _idempotencyKey = k; return this; }
    public PaymentRequestBuilder Recurring(string mandateId) { _mandateId = mandateId; return this; }
    public PaymentRequestBuilder CaptureLater()              { _capture = CaptureMode.Manual; return this; }

    public PaymentRequest Build()
    {
        if (_amount is null || _amount.MinorUnits <= 0)
            throw new InvalidOperationException("A positive amount is required.");
        if (string.IsNullOrWhiteSpace(_instrument))
            throw new InvalidOperationException("A payment method must be selected.");
        if (string.IsNullOrWhiteSpace(_idempotencyKey))
            throw new InvalidOperationException("An idempotency key is mandatory for all payments.");

        // Cross-field rules — what an object initializer cannot express:
        if (_mandateId is not null && _method == PaymentMethod.Wallet)
            throw new InvalidOperationException("Recurring is not supported for wallets.");
        if (_capture == CaptureMode.Manual && _method != PaymentMethod.Card)
            throw new InvalidOperationException("Delayed capture is card-only.");

        return new PaymentRequest(_amount, _method, _instrument, _idempotencyKey, _mandateId, _capture);
    }
}
```

**Usage:**

```csharp
var request = new PaymentRequestBuilder()
    .For(Money.Inr(2500))
    .UsingCard(cardToken)
    .WithIdempotencyKey(Guid.CreateVersion7().ToString())
    .CaptureLater()
    .Build();
```

**The modern C# alternative:**

```csharp
public record PaymentRequest
{
    public required Money Amount { get; init; }
    public required PaymentMethod Method { get; init; }
    public required string IdempotencyKey { get; init; }
    public string MandateId { get; init; }
}
```

> `required` handles **presence**. A Builder handles **multi-step, conditional, cross-field-validated** construction. "Delayed capture is card-only" is exactly what `required` cannot express.

**When to use?** Many optional parameters; branching construction; cross-field invariants; an immutable result.

**When NOT to use?** Fewer than four or five parameters; no cross-field rules; plain DTOs (`record` + `with`); a "builder" with no validation in `Build()`.

**Where .NET already does this**

`WebApplicationBuilder` · `ConfigurationBuilder` · `DbContextOptionsBuilder` · `ResiliencePipelineBuilder` (Polly v8)

> **The trap:** `StringBuilder` is **NOT** the Builder pattern. It's a mutable buffer — no separation of construction from representation, no `Build()` validation. Interviewers use it as a probe.

**Classic example:**

```
PaymentRequest
 ├── Amount + Currency      (required)
 ├── Method                 (required — Card | UPI | Wallet | NetBanking)
 ├── IdempotencyKey         (required — every payment must be replay-safe)
 ├── MandateId              (optional — required IF recurring)
 └── CaptureMode            (optional — Manual is card-only)
        ↓
     Build() → validate cross-field rules → immutable request
```

**Interview Q&A**

**Q. Builder vs object initializer vs `required`?**
Initializer for simple all-optional. `required` for compile-time presence. Builder when construction is a *process* with branches and cross-field validation.

**Q. Do you need a Director?**
A static helper (`PaymentRequestBuilder.SimpleCardPayment(amount, token)`) reads better in C#. Know what it is; say you wouldn't normally write one.

**Q. Thread safety?**
A fluent builder returning `this` isn't thread-safe, and reusing one instance for two payments leaks the wrong amount or idempotency key between them. Reset in `Build()`, or document single-use.

**Don't confuse with:** **Factory** (decides *which gateway*) · **Abstract Factory** (a family) · **Fluent interface** (a syntax style)

---

# 4. Singleton ⭐⭐⭐⭐⭐

**The answer that gets you hired**

> *"In a DI codebase I don't write the Singleton pattern — I register a singleton lifetime. Same guarantee, but the dependency stays visible, injectable and mockable. The classic static-`Instance` form is a Service Locator with one instance, and it's the pattern I'm most likely to **remove** rather than add."*

**Problem**

Suppose merchant configuration — supported methods, per-method limits, MDR rates, BIN ranges — is expensive to load and genuinely process-global.

```
   Classic Singleton                  DI Singleton
   ─────────────────                  ────────────
   MerchantConfig.Instance            ctor(IMerchantConfig cfg)
        ↓                                    ↓
   invisible dependency               visible dependency
   can't substitute in tests          substitutable
   state leaks across tests           scoped by container
```

**Implementation — the DI form:**

```csharp
builder.Services.AddSingleton<IMerchantConfiguration, MerchantConfiguration>();

public class PaymentProcessor
{
    private readonly IMerchantConfiguration _config;
    public PaymentProcessor(IMerchantConfiguration config) => _config = config;

    public bool IsMethodAllowed(string merchantId, PaymentMethod method)
        => _config.SupportedMethods(merchantId).Contains(method);
}
```

**Implementation — the classic form (write it correctly if asked):**

```csharp
public sealed class BinRangeCache
{
    // Lazy<T> is thread-safe by default. Do NOT hand-write double-checked locking.
    private static readonly Lazy<BinRangeCache> _instance = new(() => new BinRangeCache());
    public static BinRangeCache Instance => _instance.Value;
    private BinRangeCache() { }
}
```

## The three failure modes you must name

**1. Mutable state on a singleton.**

```csharp
public class MerchantConfiguration          // registered AddSingleton
{
    public string CurrentMerchantId { get; set; }   // ☠ SHARED ACROSS ALL REQUESTS
}
```

Request A sets `"merchant-A"` → pre-empted → Request B sets `"merchant-B"` → Request A resumes and reads `"merchant-B"`. **Merchant A gets Merchant B's limits and MDR rates.** See §16.1.

> **Rule:** singleton lifetime ⇒ every instance field `readonly` and immutable, or explicitly synchronised.

**2. The captive dependency — the #1 DI bug.**

A singleton injecting a **scoped** service captures the first scope's instance forever. Injecting `PaymentDbContext` into a singleton means one merchant's transactions written under another's scope.

```csharp
builder.Host.UseDefaultServiceProvider(o =>
{
    o.ValidateScopes  = true;   // catches captive dependencies
    o.ValidateOnBuild = true;   // at startup, not on the first payment
});
```

Fix: inject `IServiceScopeFactory`, create a scope per unit of work.

**3. Initialisation deadlock.**

Blocking on async work in a static constructor (loading the BIN table over HTTP) can deadlock. A **failed type initialiser is permanently poisoned** — every later access throws `TypeInitializationException`, so one transient blip at startup takes payments down until restart. Never do I/O in a static constructor.

**When to use?** Process-global **immutable** reference data — currency tables, BIN ranges, rate cards; a connection pool.

**When NOT to use?** Almost everywhere else. Mutable per-request state ⇒ never a singleton.

**Where .NET already does this**

`services.AddSingleton<T>()` · `IMemoryCache` · `ILoggerFactory` · `IOptions<T>` (singleton) vs `IOptionsSnapshot<T>` (scoped) vs `IOptionsMonitor<T>` (singleton + change notification)

**Classic example:**

```
DI Lifetimes in a payment service
 ├── Singleton  → MerchantConfiguration, BinRangeCache, currency table
 ├── Scoped     → PaymentDbContext, the unit of work for one transaction
 └── Transient  → PaymentRequestBuilder, stateless validators

 Danger: Singleton ──injects──> Scoped   =  captive dependency
```

**Interview Q&A**

**Q. Is Singleton an anti-pattern?**
Not the *guarantee* — one merchant-config instance is correct. The *static global access* is: it hides dependencies and defeats testing.

**Q. Thread safety?**
`Lazy<T>` or a `static readonly` field. Double-checked locking needs `volatile` and is easy to get wrong — which is why `Lazy<T>` exists.

**Q. Singleton + `DbContext`?**
Captive dependency. Not thread-safe, holds a change tracker → concurrency exceptions, unbounded tracker growth, cross-request leakage. In payments that's a correctness and compliance problem. Use `IDbContextFactory<T>`.

**Don't confuse with:** **Static class** (no interface/lifetime) · **Monostate** (hidden sharing — worse) · **Flyweight** (shares for *memory*)

---

# 5. Adapter ⭐⭐⭐⭐

**Problem**

Suppose you own `IPaymentGateway`, but Stripe's SDK exposes `StripeClient.PaymentIntents.CreateAsync(...)` with its own types, status strings and exceptions. Without an adapter that shape leaks everywhere and swapping acquirer becomes a whole-codebase change.

```
  PaymentProcessor
        |
  IPaymentGateway          ← YOUR interface
        |
  StripeGatewayAdapter     ← translates
        |
   StripeClient (SDK)      ← THEIR interface
```

**Interface:**

```csharp
public interface IPaymentGateway
{
    Task<AuthorizationResult> AuthorizeAsync(Money amount, string token, CancellationToken ct);
}
```

**Implementation:**

```csharp
public class StripeGatewayAdapter : IPaymentGateway
{
    private readonly StripeClient _client;
    public StripeGatewayAdapter(StripeClient client) => _client = client;

    public async Task<AuthorizationResult> AuthorizeAsync(Money amount, string token, CancellationToken ct)
    {
        try
        {
            var intent = await _client.PaymentIntents.CreateAsync(new PaymentIntentCreateOptions
            {
                Amount        = amount.MinorUnits,                  // 1. our Money → their long
                Currency      = amount.Currency.ToLowerInvariant(),
                PaymentMethod = token,
                Confirm       = true
            }, cancellationToken: ct);

            return intent.Status switch                             // 2. their status → our result
            {
                "succeeded"               => AuthorizationResult.Approved(intent.Id),
                "requires_action"         => AuthorizationResult.ThreeDsRequired(intent.NextAction?.RedirectToUrl?.Url),
                "requires_payment_method" => AuthorizationResult.Declined(intent.LastPaymentError?.DeclineCode),
                _                         => AuthorizationResult.Pending(intent.Id)
            };
        }
        catch (StripeException ex)                                  // 3. their error → our error
        {
            throw new PaymentGatewayException(ex.StripeError?.Code, ex);
        }
    }
}
```

> **A good adapter translates three things:** the **call shape**, the **data types**, and the **failure model**. Most candidates mention only the first. In payments the failure model matters most — decline codes, soft vs hard declines, retryable vs not are all provider-specific. If `StripeException` escapes, you haven't adapted anything.

**When to use?** Integrating any acquirer SDK, legacy switch, or bank API behind your own abstraction.

**When NOT to use?**
- You control both sides.
- One-to-one pass-through.
- **The leaky adapter:** if `IPaymentGateway` has `CreatePaymentIntent`, Stripe shaped your abstraction. The giveaway is that porting to Adyen requires renaming your own interface.

**Where .NET already does this**

`StreamReader` over `Stream` · `ILogger` provider adapters (Serilog/NLog) · `JsonConverter<T>` · EF Core database providers

**Classic example:**

```
IPaymentGateway
 ├── StripeGatewayAdapter    ──→ Stripe SDK      (PaymentIntents, StripeException)
 ├── AdyenGatewayAdapter     ──→ Adyen SDK       (PaymentsApi, resultCode)
 ├── RazorpayGatewayAdapter  ──→ Razorpay SDK    (Order/Payment, error codes)
 └── FakeGatewayAdapter      ──→ in-memory       (tests)
```

**Interview Q&A**

**Q. Adapter vs Facade?**
Adapter makes **incompatible** compatible — shape changes, scope doesn't. Facade makes **complex** simpler — scope narrows. The Stripe adapter wraps one SDK; the facade in §7 wraps five services.

**Q. How do you test an adapter?**
Contract tests against the provider's **sandbox** — you need real decline codes and real 3DS redirects, which a mock can't give you. Unit tests over a mocked SDK verify only translation logic, the smaller half of the risk.

**Q. Object vs class adapter?**
C# supports only the **object adapter** (composition) — no multiple inheritance.

**Don't confuse with:** **Facade** (simplifies) · **Decorator** (same interface in/out) · **Proxy** (controls access) · **Bridge** (designed together up front)

---

# 6. Decorator ⭐⭐⭐⭐⭐

**Problem**

Suppose every authorisation needs **idempotency**, **retry** and **logging**. One `EnhancedPaymentGateway` means testing retry requires mocking through idempotency and logging, and none is reusable for `IRefundProcessor`. Inheritance gives combinatorial explosion.

```
LoggingDecorator
   └── IdempotencyDecorator
          └── RetryDecorator
                 └── StripeGatewayAdapter   ← the real gateway

  Every layer implements the SAME IPaymentGateway.
```

**Interface:**

```csharp
public interface IPaymentGateway
{
    Task<AuthorizationResult> AuthorizeAsync(PaymentRequest request, CancellationToken ct);
}
```

**Implementations:**

```csharp
public class IdempotencyDecorator : IPaymentGateway
{
    private readonly IPaymentGateway _inner;
    private readonly IIdempotencyStore _store;

    public IdempotencyDecorator(IPaymentGateway inner, IIdempotencyStore store)
    {
        _inner = inner; _store = store;
    }

    public async Task<AuthorizationResult> AuthorizeAsync(PaymentRequest r, CancellationToken ct)
    {
        // A duplicate submit must NEVER charge the customer twice.
        var existing = await _store.GetAsync(r.IdempotencyKey, ct);
        if (existing is not null) return existing;

        var result = await _inner.AuthorizeAsync(r, ct);
        await _store.SaveAsync(r.IdempotencyKey, result, ct);
        return result;
    }
}

public class LoggingGatewayDecorator : IPaymentGateway
{
    private readonly IPaymentGateway _inner;
    private readonly ILogger<LoggingGatewayDecorator> _log;

    public LoggingGatewayDecorator(IPaymentGateway inner, ILogger<LoggingGatewayDecorator> log)
    {
        _inner = inner; _log = log;
    }

    public async Task<AuthorizationResult> AuthorizeAsync(PaymentRequest r, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            var result = await _inner.AuthorizeAsync(r, ct);
            _log.LogInformation("Auth {Key} {Status} in {Ms}ms", r.IdempotencyKey, result.Status, sw.ElapsedMilliseconds);
            return result;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Auth {Key} failed after {Ms}ms", r.IdempotencyKey, sw.ElapsedMilliseconds);
            throw;
        }
    }
}
```

**Wiring it up — Scrutor:**

```csharp
services.AddScoped<IPaymentGateway, StripeGatewayAdapter>();
services.Decorate<IPaymentGateway, RetryGatewayDecorator>();
services.Decorate<IPaymentGateway, IdempotencyDecorator>();
services.Decorate<IPaymentGateway, LoggingGatewayDecorator>();   // last registered = outermost
```

> **Order is the design — and in payments it's a correctness question.** Idempotency must sit **outside** retry: a retried attempt reuses the same key, so the store short-circuits the duplicate. Put idempotency *inside* retry and a timeout on attempt one followed by a retry produces **two authorisations against one card**. That's a real double charge, and it's the best follow-up in this pattern.

**When to use?** Multiple **independent** cross-cutting concerns around one operation, each independently testable and reusable across `IRefundProcessor`, `IPayoutService`.

**When NOT to use?**
- Concerns aren't independent.
- One decoration that will never compose.
- **A wide interface** — ten methods makes each decorator nine methods of pass-through noise. Segregate the interface instead.

**Where .NET already does this**

`GZipStream`/`CryptoStream`/`BufferedStream` over `Stream` (canonical BCL) · `DelegatingHandler` in the `HttpClient` pipeline · Polly v8 strategies · Scrutor `.Decorate<T>()`

**Classic example:**

```
IPaymentGateway
 └── StripeGatewayAdapter           (the real acquirer call)
      └── RetryDecorator            (+ transient failure handling)
           └── IdempotencyDecorator (+ duplicate-charge protection)  ← MUST be outside retry
                └── LoggingDecorator (+ audit trail)
```

**Interview Q&A**

**Q. Decorator vs Proxy — structure is identical.**
Intent. Decorator **adds behaviour**, caller opted in. Proxy **controls access**, caller unaware. Secondary tell: a Decorator is *handed* its component; a Proxy often creates its own subject.

**Q. Decorator vs middleware?**
Same idea, different altitude. A decorator wraps a *typed interface* and **always** delegates; middleware wraps a *pipeline step* and **may short-circuit**.

**Q. What breaks silently?**
A dropped `CancellationToken` means a cancelled checkout still charges the card. Decorators changing the contract (returning `null` where the gateway never does) violate LSP.

**Don't confuse with:** **Proxy** (access vs behaviour) · **Adapter** (changes the interface) · **CoR** (may decline)

---

# 7. Facade ⭐⭐⭐

**Problem**

Suppose taking a payment requires validation, fraud scoring, authorisation, ledger posting and notification — each its own service with sequencing rules and compensation. Every caller reproducing that choreography is duplication, and getting the order wrong means charging a card you never recorded.

```
        Checkout API
             |
      PaymentFacade          ← one method: PayAsync(request)
     /    |     |     |    \
Validate Fraud Gateway Ledger Notify
```

**Implementation:**

```csharp
public class PaymentFacade
{
    private readonly IPaymentValidator _validator;
    private readonly IFraudScorer _fraud;
    private readonly IPaymentGateway _gateway;
    private readonly ILedgerService _ledger;
    private readonly INotificationService _notify;

    public PaymentFacade(
        IPaymentValidator validator, IFraudScorer fraud, IPaymentGateway gateway,
        ILedgerService ledger, INotificationService notify)
    {
        _validator = validator; _fraud = fraud; _gateway = gateway;
        _ledger = ledger;       _notify = notify;
    }

    public async Task<PaymentResult> PayAsync(PaymentRequest request, CancellationToken ct)
    {
        _validator.EnsureValid(request);

        var score = await _fraud.ScoreAsync(request, ct);
        if (score.IsDecline) return PaymentResult.Blocked(score.Reason);

        var auth = await _gateway.AuthorizeAsync(request, ct);
        if (!auth.IsApproved) return PaymentResult.Declined(auth.DeclineCode);

        try
        {
            await _ledger.PostAuthorizationAsync(request, auth, ct);   // record BEFORE confirming
        }
        catch
        {
            await _gateway.VoidAsync(auth.Id, CancellationToken.None); // compensate — never hold
            throw;                                                     // an auth we didn't record
        }

        await _notify.PaymentConfirmedAsync(request.CustomerId, auth.Id, ct);
        return PaymentResult.Success(auth.Id);
    }
}
```

> **What keeps a Facade honest:** it must **not** be the only way in. A reconciliation job needing only the ledger, or a risk tool needing only fraud scoring, must not be forced through `PayAsync`.

**When to use?** A complex subsystem with non-obvious sequencing used by many callers who all need the same flow — checkout, subscription billing, a mobile SDK.

**When NOT to use?**
- It accretes unrelated operations (payouts, disputes, KYC).
- One-to-one pass-through.
- **Be honest about the label:** the class above owns business rules and a compensation path, which makes it an **application service**. Interviewers notice.

**Where .NET already does this**

`HttpClient` over handlers + pooling + DNS · `File.ReadAllTextAsync` · `WebApplication`

**Classic example:**

```
PaymentFacade.PayAsync(request)      ← one call
        ↓  hides
Validate → FraudScore → Authorize → PostToLedger → Notify
                                         ↓ on failure
                                    VoidAuthorization (compensate)
```

**Interview Q&A**

**Q. Facade vs Mediator?**
Facade faces **outward** to *clients*; subsystem services may still call each other. Mediator faces **inward** to *peers*, who then know only the mediator. A class can be both.

**Q. When is it an anti-pattern?**
Sole entry point (bottleneck); accreted responsibilities; or leaking — signatures full of `StripePaymentIntent` have simplified nothing.

**Q. Where does compensation belong?**
In whatever owns the business transaction. Past a couple of compensations it should become an explicit **Saga**, not a longer `try/catch`.

**Don't confuse with:** **Adapter** (translates) · **Mediator** (inward) · **Proxy** (same interface as subject)

---

# 8. Proxy ⭐⭐⭐

**Problem**

Suppose every refund above a threshold must be authorised, and you cannot rely on every caller — checkout, back-office, batch reconciliation, support tool — remembering to check.

```
   Support Tool / API
          |
   IRefundProcessor          ← same interface
          |
 AuthorizingRefundProxy      ← checks, then delegates
          |
   RefundProcessor           ← the real subject
```

**The four variants:**

| Variant | Purpose | Payment example |
|---|---|---|
| **Protection** | Authorise before delegating | Refunds above a threshold need an approver |
| **Virtual / lazy** | Defer expensive creation | Lazy-load the card-vault / HSM client |
| **Remote** | Stand in for another process | The acquirer's gRPC/HTTP client stub |
| **Caching** | Memoise an expensive lookup | BIN → issuer/country |

**Interface:**

```csharp
public interface IRefundProcessor
{
    Task<RefundResult> RefundAsync(PaymentId paymentId, Money amount, CancellationToken ct);
}
```

**Implementation:**

```csharp
public class AuthorizingRefundProxy : IRefundProcessor
{
    private readonly IRefundProcessor _inner;
    private readonly IAuthorizationService _authz;
    private readonly ClaimsPrincipal _user;

    public AuthorizingRefundProxy(IRefundProcessor inner, IAuthorizationService authz, ClaimsPrincipal user)
    {
        _inner = inner; _authz = authz; _user = user;
    }

    public async Task<RefundResult> RefundAsync(PaymentId paymentId, Money amount, CancellationToken ct)
    {
        var result = await _authz.AuthorizeAsync(_user, new RefundRequest(paymentId, amount), "IssueRefund");
        if (!result.Succeeded)
            throw new ForbiddenException($"User may not refund {amount} on {paymentId}.");

        return await _inner.RefundAsync(paymentId, amount, ct);
    }
}
```

The value is **structural**: no caller can issue an unauthorised refund, because no call site bypasses the proxy.

**When to use?** Non-skippable access control (refunds, payouts, card-data reads); deferred expensive construction; a remote acquirer; transparent caching.

**When NOT to use?**
- The rule is a domain invariant — "you cannot refund more than was captured" belongs on the `Payment` aggregate.
- **EF Core lazy-loading proxies** — the standard route to N+1.
- The proxy does so much it's really a decorator.

**Where .NET already does this**

`Lazy<T>` · EF Core `UseLazyLoadingProxies()` · gRPC/Refit generated clients · `DispatchProxy`, `Castle.DynamicProxy`

**Classic example:**

```
Proxy variants in a payment platform
 ├── AuthorizingRefundProxy   → protection (approver required above threshold)
 ├── Lazy<CardVaultClient>    → virtual    (defer an expensive HSM connection)
 ├── Acquirer gRPC stub       → remote     (another process)
 └── CachingBinLookupProxy    → caching    (BIN → issuer, changes rarely)
```

**Interview Q&A**

**Q. Proxy vs Decorator, in five seconds.**
Decorator adds behaviour, caller opted in. Proxy controls access, caller can't tell.

**Q. Danger of a remote proxy?**
It makes an acquirer call look like a method call — latency, partial failure, timeouts and retries become invisible, which is how you get double charges. Keep remoteness in the signature: `Task<T>`, `CancellationToken`.

**Q. Why avoid EF lazy-loading proxies?**
Loading 500 payments and touching `payment.Refunds` in a loop is 501 queries — silent, no exception, just a settlement job that degrades monthly.

**Don't confuse with:** **Decorator** (behaviour vs access) · **Adapter** (changes interface) · **Facade** (narrower new interface)

---

# 9. Strategy ⭐⭐⭐⭐⭐

One of the most important patterns for .NET interviews.

**Problem**

Suppose payment calculation differs by payment type.

```
    PaymentProcessor
           |
        Strategy
       /    |     \
    Card   UPI   Wallet
```

**Interface:**

```csharp
public interface IPaymentStrategy
{
    Task ProcessAsync(Payment payment);
}
```

**Implementations:**

```csharp
public class CardPaymentStrategy : IPaymentStrategy
{
    public Task ProcessAsync(Payment payment)
    {
        // Card processing — tokenize, 3DS challenge, authorise, capture
    }
}

public class UpiPaymentStrategy : IPaymentStrategy
{
    public Task ProcessAsync(Payment payment)
    {
        // UPI processing — validate VPA, raise collect request, await callback
    }
}

public class WalletPaymentStrategy : IPaymentStrategy
{
    public Task ProcessAsync(Payment payment)
    {
        // Wallet processing — balance check, debit, top-up if short
    }
}
```

**The context:**

```csharp
public class PaymentProcessor
{
    private readonly IPaymentStrategy _strategy;
    public PaymentProcessor(IPaymentStrategy strategy) => _strategy = strategy;

    public Task ProcessAsync(Payment payment) => _strategy.ProcessAsync(payment);
}
```

**Selecting it — keyed DI (.NET 8+):**

```csharp
builder.Services.AddKeyedScoped<IPaymentStrategy, CardPaymentStrategy>(PaymentMethod.Card);
builder.Services.AddKeyedScoped<IPaymentStrategy, UpiPaymentStrategy>(PaymentMethod.Upi);
builder.Services.AddKeyedScoped<IPaymentStrategy, WalletPaymentStrategy>(PaymentMethod.Wallet);
builder.Services.AddKeyedScoped<IPaymentStrategy, NetBankingPaymentStrategy>(PaymentMethod.NetBanking);

var strategy = sp.GetRequiredKeyedService<IPaymentStrategy>(payment.Method);
await strategy.ProcessAsync(payment);
```

> **The synthesis that reframes the question:** *"In modern C#, Strategy and 'inject an interface' are the same pattern from two eras. Most DI registrations in a well-factored codebase are Strategies."*

**When to use?**

When you have multiple algorithms/behaviors that can be swapped — and the choice belongs to the caller or configuration, not the object. Payment methods, MDR fee calculation, settlement schedules, per-acquirer retry policies.

**When NOT to use?**
- Two branches that will never become three.
- Strategies needing wildly different inputs — the interface is wrong.
- A `switch` every new method must edit — use keyed registration.

**Where .NET already does this**

`IComparer<T>`, `IEqualityComparer<T>` · `Func<>`/`Predicate<>` in LINQ · `IAuthorizationHandler` · `JsonNamingPolicy` · Polly retry-delay generators

**Classic example:**

```
Payment
 ├── Credit Card
 ├── Debit Card
 ├── UPI
 └── Wallet
```

```
MDR Fee Calculation          Settlement Schedule
 ├── FlatRate                 ├── T+0  (instant)
 ├── PercentageOfValue        ├── T+1
 ├── TieredByVolume           ├── T+2
 └── InterchangePlusPlus      └── Weekly
```

**Interview Q&A**

**Q. Strategy vs State?**
The payment **method** is a Strategy — customer-chosen, fixed for the transaction. The payment **status** is a State (§14) — the payment drives Initiated → Authorized → Captured, each state knowing its successor. Strategy has no transitions; State is *defined* by them.

**Q. When is it over-engineering?**
One payment method. Or strategies sharing so much code they should be one template with a parameter — if Card and Debit Card differ by a fee constant, that's a parameter.

**Q. Class per strategy, or a delegate?**
For stateless single-method strategies like fee calculation, `Func<Money, Money>` by key is right. A class when it carries dependencies — `CardPaymentStrategy` needs a gateway, 3DS service and vault.

**Don't confuse with:** **State** (§14) · **Command** (§11) · **Template Method** (inheritance-based step variation)

---

# 10. Observer ⭐⭐⭐⭐

**Problem**

Suppose a payment changing status must notify several independent consumers — ledger, customer email, analytics, fraud model — without the payment service knowing who they are.

```
      PaymentEventPublisher  (subject)
                |
        PaymentStatusChanged
        /       |       \        \
   Ledger  Notification Analytics Fraud   (observers)
```

**The .NET answer:** C# `event` **is** the Observer pattern as a language feature.

> Asked *"does this codebase use Observer?"* — for almost any C# codebase the answer is **"yes, via its events"**, not "no, we have no `IObserver` interfaces."

**Tier 1 — an event:**

```csharp
public class PaymentEventPublisher
{
    public event EventHandler<PaymentStatusChanged> StatusChanged;

    public void Publish(PaymentStatusChanged e)
        => StatusChanged?.Invoke(this, e);      // ?. is the thread-safe delegate read
}

publisher.StatusChanged += (sender, e) => ledger.PostAsync(e.PaymentId, e.NewStatus);
```

**Tier 2 — `IObservable<T>` (Rx) for composition:**

```csharp
using var subscription = publisher.AsObservable()
    .Where(e => e.NewStatus == PaymentStatus.Failed)
    .Buffer(TimeSpan.FromMinutes(1))                    // batch failures for an alert
    .Subscribe(onNext: RaiseFailureSpikeAlert, onError: LogFailure, onCompleted: Close);
```

**Tier 3 — `Channel<T>` for backpressure:**

```csharp
var channel = Channel.CreateBounded<PaymentStatusChanged>(new BoundedChannelOptions(10_000)
{
    FullMode = BoundedChannelFullMode.Wait     // never DROP a payment event — apply backpressure
});

await foreach (var e in channel.Reader.ReadAllAsync(ct))
    await ledger.PostAsync(e.PaymentId, e.NewStatus, ct);
```

> **The Tech Lead distinction:** an `event` has **no backpressure and no error channel**. A slow ledger subscriber blocks the publisher; an exception in the notification handler stops the ledger handler running at all. For payment events, where losing one means a missing ledger entry, use `Channel<T>` — or better, don't use in-process events for anything that must survive a crash. That's the **Outbox**, and saying so is the mature answer.

## ⚠ The event memory leak — the #1 follow-up

```csharp
public class PaymentStatusWidget : IDisposable
{
    private readonly PaymentEventPublisher _publisher;

    public PaymentStatusWidget(PaymentEventPublisher publisher)
    {
        _publisher = publisher;
        _publisher.StatusChanged += OnStatusChanged;      // subscribe
    }

    public void Dispose()
        => _publisher.StatusChanged -= OnStatusChanged;   // ← MUST unsubscribe, or it leaks
}
```

> **Rule:** any subscription **crossing a lifetime boundary** needs guaranteed `-=` in `Dispose`, or the weak-event pattern. Matching lifetimes carry no such risk.

This caused a real 6 GB leak — see §16.2.

**When to use?** One-to-many **in-process** notification where losing a notification on crash is acceptable.

**When NOT to use?**
- Anything that must survive a crash — a payment captured but never posted to the ledger is a reconciliation break. Use the **Outbox**.
- Across a process boundary — that's messaging.
- When ordering between subscribers matters.
- When you need a *response*.

**Where .NET already does this**

`event`/delegate · `IObservable<T>`/`IObserver<T>` · `INotifyPropertyChanged` · `IChangeToken` · `CancellationToken.Register`

**Classic example:**

```
PaymentCaptured
 ├── LedgerPoster        (double-entry posting)      ← must not be lost → Outbox
 ├── NotificationSender  (email / SMS receipt)
 ├── AnalyticsCollector  (conversion funnel)
 └── FraudModelFeeder    (behavioural signal)
```

**Interview Q&A**

**Q. `event` vs `IObservable<T>` vs `Channel<T>`?**
`event` for simple in-process with matching lifetimes. `IObservable<T>` for composition plus completion/error. `Channel<T>` for **backpressure** — the only one that says what happens when the ledger can't keep up.

**Q. Preventing the leak?**
`IDisposable` + `-=`, with `Dispose` *guaranteed* not assumed. Weak events where timing is unreliable. A Roslyn analyser flagging `+=` with no matching `-=`.

**Q. If one handler throws?**
It stops the rest — a failing analytics handler silently prevents ledger posting. Use `GetInvocationList()` with per-delegate try/catch, or the Outbox.

**Don't confuse with:** **Mediator** (§13) · **Pub/Sub messaging** (durable) · **Command** (a request, not a notification)

---

# 11. Command ⭐⭐⭐⭐

**Problem**

Suppose capture, refund and payout must be **queued, retried after an acquirer outage, and fully audited** — and some reversible. A direct method call gives none of that.

```
   Invoker (PaymentOperationQueue)
             |
       IPaymentCommand
      /      |       \
 Capture  Refund   Payout      ← each knows Execute AND Compensate
             |
   Receiver (IPaymentGateway)
```

> **Why it's worth the ceremony:** once the operation is *data*, everything you can do to data becomes available — persist, queue, replay, audit, reverse. Exactly why the **Outbox** stores serialised commands as rows.

**Interface:**

```csharp
public interface IPaymentCommand
{
    Task ExecuteAsync(CancellationToken ct);
    Task CompensateAsync(CancellationToken ct);
}
```

**Implementation:**

```csharp
public class CapturePaymentCommand : IPaymentCommand
{
    private readonly IPaymentGateway _gateway;
    private readonly PaymentId _paymentId;
    private readonly Money _amount;
    private string _captureId;              // state Compensate needs

    public CapturePaymentCommand(IPaymentGateway gateway, PaymentId paymentId, Money amount)
    {
        _gateway = gateway; _paymentId = paymentId; _amount = amount;
    }

    public async Task ExecuteAsync(CancellationToken ct)
    {
        var result = await _gateway.CaptureAsync(_paymentId, _amount, ct);
        _captureId = result.CaptureId;      // capture the id AT EXECUTE TIME, not construction
    }

    // You cannot "undo" a capture — you compensate with a refund.
    public Task CompensateAsync(CancellationToken ct)
        => _gateway.RefundAsync(_captureId, _amount, ct);
}
```

**The invoker:**

```csharp
public class PaymentOperationQueue
{
    private readonly Channel<IPaymentCommand> _queue = Channel.CreateUnbounded<IPaymentCommand>();

    public ValueTask EnqueueAsync(IPaymentCommand c) => _queue.Writer.WriteAsync(c);

    public async Task RunAsync(CancellationToken ct)
    {
        await foreach (var command in _queue.Reader.ReadAllAsync(ct))
        {
            try   { await command.ExecuteAsync(ct); }
            catch (TransientGatewayException) { await EnqueueAsync(command); }   // retry
            catch (Exception)                 { await command.CompensateAsync(ct); throw; }
        }
    }
}
```

> **The payment-specific point that impresses:** GoF's `Undo()` assumes you can reverse an operation. **In payments you cannot** — a capture that reached the acquirer is a real movement of money. You **compensate** with a refund, a *new* transaction with its own id and audit trail. Saying that unprompted is the bridge to the Saga pattern.

**When to use?** Operations that must be **queueable, retryable, auditable, or reversible** — capture/refund queues, payout batches, the Outbox, scheduled subscription billing.

**When NOT to use?** When you need none of those. Beware `AuthorizePaymentCommand` → `AuthorizePaymentHandler` wrapping a three-line method.

**Where .NET already does this**

MediatR `IRequest`/`IRequestHandler` · Hangfire / Quartz · WPF `ICommand` · the **Outbox** table

**Classic example:**

```
Payment Operations
 ├── AuthorizeCommand   → Compensate: void the authorisation
 ├── CaptureCommand     → Compensate: refund (a NEW transaction, not an undo)
 ├── RefundCommand      → Compensate: none possible — money has left
 └── PayoutCommand      → Compensate: reversal request to the bank
```

**Interview Q&A**

**Q. Command vs Strategy?**
Strategy is **how** to process a payment (Card vs UPI, §9). Command is **what to do** — capture ₹2,500 on payment X — deferrable. Strategies aren't queued or retried.

**Q. Is MediatR the Command pattern?**
Mostly — `IRequest` is a command object, `IRequestHandler` its receiver. What it calls a *mediator* is an in-process **dispatcher**; pipeline behaviours are Decorator/CoR. It moved to a commercial licence — Wolverine or plain handler interfaces are the alternatives.

**Q. Making a payment command idempotent?**
Carry the idempotency key **on the command**; the receiver checks it — the decorator in §6. A retried command must reuse the key, or the retry is a second charge.

**Don't confuse with:** **Strategy** · **Mediator** (routes commands) · **Saga** (a sequence of commands with compensations)

---

# 12. Chain of Responsibility ⭐⭐⭐⭐⭐

Critical for .NET, because **ASP.NET Core middleware is this pattern**.

**Problem**

Suppose refunds route by amount to progressively senior approvers. As a nested `if/else if`, inserting a tier means placing a branch in exactly the right position — and an off-by-one silently lets an amount range **skip approval entirely**. (Real incident — §16.3.)

```
Refund ──→ AutoApprove ──→ Support ──→ Manager ──→ Finance ──→ CFO
             (≤1k)         (≤10k)     (≤50k)     (≤500k)    (rest)

   Each handler: approve it, or pass it on.
```

**Interface:**

```csharp
public interface IRefundApprovalHandler
{
    Task<ApprovalResult> HandleAsync(RefundRequest request, CancellationToken ct);
}
```

**Implementations:**

```csharp
public class SupportApprovalHandler : IRefundApprovalHandler
{
    private readonly IRefundApprovalHandler _next;
    private readonly decimal _limit;

    public SupportApprovalHandler(IRefundApprovalHandler next, decimal limit)
    {
        _next = next; _limit = limit;
    }

    public Task<ApprovalResult> HandleAsync(RefundRequest r, CancellationToken ct)
    {
        if (r.Amount <= _limit)
            return Task.FromResult(ApprovalResult.RequiresRole("SupportAgent"));

        return _next.HandleAsync(r, ct);        // pass it on
    }
}

public class CfoApprovalHandler : IRefundApprovalHandler
{
    // Terminal handler — no _next. ALWAYS terminate the chain explicitly.
    public Task<ApprovalResult> HandleAsync(RefundRequest r, CancellationToken ct)
        => Task.FromResult(ApprovalResult.RequiresRole("CFO"));
}
```

**Wiring it up — ordering becomes data you can read and test:**

```csharp
services.AddSingleton<IReadOnlyList<IRefundApprovalHandler>>(sp =>
[
    new AutoApproveHandler(limit:     1_000m),
    new SupportApprovalHandler(limit: 10_000m),
    new ManagerApprovalHandler(limit: 50_000m),
    new FinanceApprovalHandler(limit: 500_000m),
    new CfoApprovalHandler()                       // terminal
]);
```

**The same pattern as a payment risk chain:**

```
AmountLimitCheck → VelocityCheck → BlacklistCheck → DeviceFingerprintCheck → ThreeDsDecision
```

**The framework version you already use:**

```csharp
app.UseExceptionHandler();     // each middleware may handle,
app.UseAuthentication();       // or call next(),
app.UseAuthorization();        // or short-circuit and return
app.UseRateLimiter();          // ← 429s the request, chain stops
app.MapControllers();
```

**When to use?** A growing, **ordered** set of conditional cases where any one may claim the request and **stop** the chain.

**When NOT to use?**
- One handler, known statically — a dictionary lookup.
- Every handler must run — that's a pipeline or decorator stack.
- Order encodes undocumented business rules — put it in a named, tested list.

**Where .NET already does this**

**ASP.NET Core middleware** · `DelegatingHandler` · `IEndpointFilter` · MVC action/exception filters

**Classic example:**

```
Refund Approval
 ├── Auto        ≤ 1,000      (no human)
 ├── Support     ≤ 10,000
 ├── Manager     ≤ 50,000
 ├── Finance     ≤ 500,000
 └── CFO         > 500,000    (terminal — always claims what's left)
```

**Interview Q&A**

**Q. CoR vs Decorator?**
A Decorator **always** delegates. A CoR handler **may decline** — the support tier claims the refund and stops. Middleware is CoR precisely because it can choose not to call `next`.

**Q. How do you test a chain?**
Each handler with a mocked `next`, **plus parameterised boundary tests across the assembled chain** — one per threshold, asserting who claims a refund at exactly the limit and one unit either side. That suite would have caught the approval-skip bug.

**Q. Most common bug?**
An unhandled request falling off the end silently. Always terminate explicitly.

**Don't confuse with:** **Decorator** (always delegates) · **Pipeline** (every stage runs) · **Mediator** (dispatches to *the* handler)

---

# 13. Mediator ⭐⭐⭐⭐

**Problem**

Suppose a checkout screen has widgets that must coordinate: choosing a method shows the right instrument input, saved cards only apply to Card, 3DS only for Card, Pay enables only when method and amount are valid. Every widget referencing every other = `n²` couplings.

```
   BEFORE (n² couplings)              AFTER (n couplings)

   MethodSelector ←→ SavedCards        MethodSelector ─┐
         ↕      ╳        ↕             SavedCards     ─┼→ CheckoutMediator
     AmountField ←→ PayButton          AmountField    ─┤
                                       PayButton      ─┘
```

**Interface:**

```csharp
public interface ICheckoutMediator
{
    void Notify(object sender, string ev);
}
```

**Implementation:**

```csharp
public class CheckoutScreen : ICheckoutMediator
{
    public PaymentMethodSelector MethodSelector { get; }
    public SavedCardList         SavedCards     { get; }
    public AmountField           Amount         { get; }
    public ThreeDsPrompt         ThreeDs        { get; }
    public PayButton             Pay            { get; }

    public CheckoutScreen()
    {
        MethodSelector = new PaymentMethodSelector(this);
        SavedCards     = new SavedCardList(this);
        Amount         = new AmountField(this);
        ThreeDs        = new ThreeDsPrompt(this);
        Pay            = new PayButton(this);
    }

    // ALL cross-widget rules live HERE. Widgets hold no reference to one another.
    public void Notify(object sender, string ev)
    {
        if (sender == MethodSelector && ev == "changed")
        {
            var method = MethodSelector.Selected;
            SavedCards.Visible = method == PaymentMethod.Card;
            ThreeDs.Visible    = method == PaymentMethod.Card;
            Amount.MaxAllowed  = method == PaymentMethod.Wallet ? 10_000m : 500_000m;
        }

        if (ev == "changed")
            Pay.Enabled = MethodSelector.HasSelection && Amount.IsValid;
    }
}

public class PaymentMethodSelector
{
    private readonly ICheckoutMediator _mediator;
    public PaymentMethodSelector(ICheckoutMediator m) => _mediator = m;

    public PaymentMethod? Selected { get; private set; }
    public bool HasSelection => Selected is not null;

    public void Select(PaymentMethod method)
    {
        Selected = method;
        _mediator.Notify(this, "changed");     // tells the mediator, not its siblings
    }
}
```

## The MediatR clarification — say this precisely

> MediatR is predominantly an **in-process command/query dispatcher**. `IRequest`/`IRequestHandler` is **Command** (§11); pipeline behaviours are **Decorator**/**CoR** (§6, §12); `INotification` is **Observer** (§10). It's mediator-*shaped* only in that senders never reference handlers. What it lacks is the GoF Mediator's defining feature — **coordination logic in the mediator deciding what other peers should do**, like `CheckoutScreen.Notify` above.

That distinction lands immediately, and sets up the honest take: MediatR buys handler discovery and a behaviour pipeline, and costs indirection that makes "go to definition" stop working. Since it moved to a commercial licence, that trade deserves a decision rather than a default.

**When to use?** Many peers coordinating without knowing each other — checkout screens, multi-step wizards, workflow steps — where coordination logic is complex and changes often.

**When NOT to use?**
- Two or three peers with stable interactions.
- The mediator would be pass-through.
- ⚠ **God-object risk:** one mediator across payments, payouts, disputes and KYC accumulates the SRP violation it was meant to prevent. **Scope by domain.**

**Where .NET already does this**

MediatR / Wolverine · SignalR hubs · the classic UI form coordinator

**Classic example:**

```
Checkout Screen (mediator)
 ├── MethodSelector ─┐
 ├── SavedCards      ─┤
 ├── AmountField     ─┼→ CheckoutMediator decides what each widget does
 ├── ThreeDsPrompt   ─┤
 └── PayButton       ─┘

 Widgets never talk to each other. Only to the mediator.
```

**Interview Q&A**

**Q. Mediator vs Observer?**
Observer is **broadcast** — `PaymentCaptured` fires, ledger/notifier/analytics react independently (§10). Mediator is **coordination** — widgets report in, and the mediator decides what other *specific* widgets do. **Observer distributes notifications; Mediator centralises decisions.** They compose.

**Q. 800-line mediator across payments, payouts and disputes?**
God object. Split by bounded context — and check whether some coordination is really domain logic belonging on the `Payment` aggregate.

**Q. Mediator vs Facade?**
Facade faces outward — the checkout API calls `PaymentFacade.PayAsync` (§7). Mediator faces inward — widgets know only the mediator.

**Don't confuse with:** **Observer** · **Facade** · **Command** · **Event bus** (routing without coordination is closer to Observer)

---

# 14. State ⭐⭐⭐

**Problem**

Suppose a `Payment` behaves differently by status — `Capture()`, `Refund()`, `Cancel()` all mean different things. As a `switch` on an enum inside every method, each new status edits every method, and illegal transitions are prevented only by whichever `if` someone remembered.

```
Initiated ──Authorize──→ Authorized ──Capture──→ Captured ──Settle──→ Settled
    │                         │                      │
  Cancel                   Cancel/Void            Refund
    ↓                         ↓                      ↓
 Cancelled                Cancelled              Refunded

  Capturing an Initiated payment must be IMPOSSIBLE, not just discouraged.
```

**Interface:**

```csharp
public interface IPaymentState
{
    IPaymentState Authorize(Payment payment);
    IPaymentState Capture(Payment payment, Money amount);
    IPaymentState Refund(Payment payment, Money amount);
    IPaymentState Cancel(Payment payment);
}
```

**Implementations:**

```csharp
public class InitiatedState : IPaymentState
{
    public IPaymentState Authorize(Payment p) { p.RecordAuthorization(); return new AuthorizedState(); }
    public IPaymentState Capture(Payment p, Money a) => throw new InvalidOperationException("Cannot capture before authorisation.");
    public IPaymentState Refund(Payment p, Money a)  => throw new InvalidOperationException("Nothing to refund.");
    public IPaymentState Cancel(Payment p)           { p.ReleaseReservation(); return new CancelledState(); }
}

public class AuthorizedState : IPaymentState
{
    public IPaymentState Authorize(Payment p)        => throw new InvalidOperationException("Already authorised.");
    public IPaymentState Capture(Payment p, Money a) { p.RecordCapture(a); return new CapturedState(); }
    public IPaymentState Refund(Payment p, Money a)  => throw new InvalidOperationException("Void the authorisation instead.");
    public IPaymentState Cancel(Payment p)           { p.VoidAuthorization(); return new CancelledState(); }
}

public class CapturedState : IPaymentState
{
    public IPaymentState Authorize(Payment p)        => throw new InvalidOperationException("Already captured.");
    public IPaymentState Capture(Payment p, Money a) => throw new InvalidOperationException("Already captured.");
    public IPaymentState Refund(Payment p, Money a)  { p.RecordRefund(a); return new RefundedState(); }
    public IPaymentState Cancel(Payment p)           => throw new InvalidOperationException("Refund it instead — money has moved.");
}
```

`AuthorizedState.Refund()` is the **only** place encoding "you void an authorisation, you don't refund it."

**The modern C# alternative — lead with this:**

```csharp
public abstract record PaymentState
{
    public sealed record Initiated                                : PaymentState;
    public sealed record Authorized(string AuthId)                : PaymentState;
    public sealed record Captured(string CaptureId, Money Amount) : PaymentState;
    public sealed record Settled(DateOnly SettledOn)              : PaymentState;
    public sealed record Refunded(Money Amount)                   : PaymentState;
    public sealed record Cancelled(string Reason)                 : PaymentState;
    private PaymentState() { }                 // closes the hierarchy to this file
}

public static PaymentState Capture(PaymentState current, Money amount) => current switch
{
    PaymentState.Authorized a => new PaymentState.Captured(Gateway.Capture(a.AuthId, amount), amount),
    PaymentState.Initiated    => throw new InvalidOperationException("Not authorised."),
    PaymentState.Captured c   => c,                          // idempotent — a retry is safe
    PaymentState.Settled      => throw new InvalidOperationException("Already settled."),
    PaymentState.Refunded     => throw new InvalidOperationException("Already refunded."),
    PaymentState.Cancelled    => throw new InvalidOperationException("Payment cancelled."),
    _ => throw new UnreachableException()
};
```

> **The trade-off:** the record-and-switch form gives **compile-time exhaustiveness** but a **closed** set — adding `Disputed` means recompiling every transition, and the compiler lists exactly which ones you forgot. The polymorphic form gives **open extensibility** but no compiler check.
>
> For a payment lifecycle — closed and regulated — choose **exhaustiveness**.

**When to use?** Several modes with genuinely different behaviour, where illegal transitions must be prevented structurally.

**When NOT to use?**
- Two states — a `bool` and an `if`.
- No behavioural difference, only data.
- It's a **distributed** workflow with persistence and compensation across services — that's a **Saga**. A payment spanning authorisation, ledger and settlement is a Saga; the status *within* the payment service is a State machine.

**Where .NET already does this**

`async`/`await` compiler state machine · `TaskStatus` · Polly circuit breaker (Closed → Open → Half-Open) · `HttpConnection` lifecycle

**Classic example:**

```
Payment Lifecycle
 ├── Initiated    → Authorize | Cancel
 ├── Authorized   → Capture   | Void
 ├── Captured     → Settle    | Refund
 ├── Settled      → Refund
 ├── Refunded     → (terminal)
 └── Cancelled    → (terminal)
```

**Interview Q&A**

**Q. State vs Strategy?**
The customer chooses a **method** — Strategy (§9), fixed. The payment drives its own **status** — State, each knowing its successors.

**Q. Where does the transition guard go?**
In the state itself. With records + `switch`, adding `Disputed` makes the compiler list every unhandled transition — exactly the safety net a regulated flow needs.

**Q. How do you persist state objects?**
Persist a **status discriminator plus its data** (`auth_id`, `capture_id`, `settled_on`) and rehydrate. State objects holding mutable references create cycles and serialise badly.

**Don't confuse with:** **Strategy** · **Command** · **Saga** (State's durable, distributed cousin)

---

# 15. Repository / Unit of Work ⭐⭐⭐⭐⭐

Not GoF (Fowler), and one of the most likely questions you'll get.

**Intent**

- **Repository** — a **collection-like interface** so the domain doesn't know how persistence works.
- **Unit of Work** — track affected objects, coordinate writes, commit **atomically**.

## The central .NET argument — lead with this

> **`DbContext` IS a Unit of Work. `DbSet<T>` IS a Repository.** EF Core already implements both. Wrapping EF in a generic `IRepository<T>` + `IUnitOfWork` reimplements what you have — usually worse.

```
        PaymentDbContext          ← Unit of Work (change tracker + SaveChanges)
        /       |        \
DbSet<Payment>  DbSet<Refund>  DbSet<Settlement>     ← Repositories
```

The change tracker accumulates adds/modifies/deletes; `SaveChangesAsync()` commits in **one transaction** — exactly what you need when a capture writes a `Payment`, a `Transaction` and a `LedgerEntry` together.

## ⚠ The generic-repository anti-pattern

```csharp
public interface IRepository<T> where T : class
{
    IQueryable<T> Query();                    // ← THE LEAK
    Task<T> GetByIdAsync(int id);
    Task AddAsync(T entity);
    void Remove(T entity);
    Task<int> SaveChangesAsync();             // ← UoW smeared across every repository
}
```

**Four concrete objections:**

1. **`IQueryable<T>` leaks the ORM.** Callers compose queries the repository can't see, inheriting deferred execution, client-side evaluation, translation failure and `DbContext` lifetime. Real bug: a method returned `IQueryable<Payment>` from a `using`-scoped context; a settlement job enumerated it **after** disposal → intermittent `ObjectDisposedException`.
2. **Lowest common denominator.** No `Include`, projection, split queries, `AsNoTracking` or compiled queries — a settlement scan over millions of rows loses them, or you punch holes until the abstraction is meaningless.
3. **`SaveChanges` per repository breaks atomicity.** A capture touching `IPaymentRepository` and `ILedgerRepository` becomes **two transactions** — payment captured with no ledger entry is a reconciliation break.
4. **It rarely delivers the swap it promises.**

> **The rule that incident produced:** *no public repository or service method returns `IQueryable<T>`.* Return `IReadOnlyList<T>` or DTOs — or accept an `ISpecification<T>`.

## When a repository IS worth writing

- **A DDD aggregate boundary** — `IPaymentRepository`, never `IRepository<Transaction>`. A `Payment` with its transactions and refunds must load and save as a unit, or you persist a refund whose parent was never updated. EF won't enforce that; the repository does.
- **Domain-intent query names** — `UnsettledOlderThanAsync(asOf)` documents a business concept; a raw LINQ chain gets copy-pasted into three settlement jobs.
- **Hiding a genuinely non-EF store** — Dapper for a high-volume settlement read, Cosmos for the event store. That's an Adapter (§5) with a collection-shaped interface.
- **Hexagonal / Clean Architecture** — the interface is the **port**, the EF class the **adapter**.

**Interface:**

```csharp
// Domain layer — the port. Aggregate-scoped, intent-named, NO IQueryable.
public interface IPaymentRepository
{
    Task<Payment> GetAsync(PaymentId id, CancellationToken ct);
    Task<Payment> GetByIdempotencyKeyAsync(string key, CancellationToken ct);
    Task<IReadOnlyList<Payment>> UnsettledOlderThanAsync(DateOnly asOf, CancellationToken ct);
    void Add(Payment payment);
    // No SaveChanges — committing is the unit of work's job.
}
```

**Implementation:**

```csharp
public class PaymentRepository : IPaymentRepository
{
    private readonly PaymentDbContext _db;
    public PaymentRepository(PaymentDbContext db) => _db = db;

    public Task<Payment> GetAsync(PaymentId id, CancellationToken ct) =>
        _db.Payments
           .Include(p => p.Transactions)      // the aggregate loads as a UNIT
           .Include(p => p.Refunds)
           .FirstOrDefaultAsync(p => p.Id == id, ct);

    public Task<Payment> GetByIdempotencyKeyAsync(string key, CancellationToken ct) =>
        _db.Payments.FirstOrDefaultAsync(p => p.IdempotencyKey == key, ct);

    public async Task<IReadOnlyList<Payment>> UnsettledOlderThanAsync(DateOnly asOf, CancellationToken ct) =>
        await _db.Payments
                 .AsNoTracking()               // read-only scan: skip the change tracker
                 .Where(p => p.Status == PaymentStatus.Captured && p.CapturedOn < asOf)
                 .ToListAsync(ct);             // MATERIALISED — no IQueryable escapes

    public void Add(Payment payment) => _db.Payments.Add(payment);
}
```

**The Unit of Work — wrap it thinly if at all:**

```csharp
public interface IUnitOfWork
{
    Task<int> CommitAsync(CancellationToken ct);
}

public class EfUnitOfWork : IUnitOfWork
{
    private readonly PaymentDbContext _db;
    public EfUnitOfWork(PaymentDbContext db) => _db = db;

    public Task<int> CommitAsync(CancellationToken ct) => _db.SaveChangesAsync(ct);
}
```

> **Say this out loud:** *"`EfUnitOfWork` is a one-line wrapper over `SaveChangesAsync`. I'd only introduce it to keep the domain free of an EF reference in Clean Architecture. In a pragmatic layered app I'd inject `DbContext` and skip it."*

**Transactions beyond one `SaveChanges` — the Outbox:**

```csharp
await using var tx = await db.Database.BeginTransactionAsync(ct);
try
{
    payment.Capture(amount);                                        // domain state change
    db.OutboxMessages.Add(OutboxMessage.For(new PaymentCaptured(payment.Id, amount)));
    await db.SaveChangesAsync(ct);     // payment state + intent-to-publish commit TOGETHER
    await tx.CommitAsync(ct);
}
catch { await tx.RollbackAsync(ct); throw; }
```

That's how you avoid §10's failure — a payment captured but the ledger never notified because an in-process handler threw. At-least-once delivery, so consumers must be idempotent. Full treatment in the microservices guide.

**Specification, when you need composable queries:**

```csharp
public interface ISpecification<T>
{
    Expression<Func<T, bool>> Criteria { get; }
    IReadOnlyList<Expression<Func<T, object>>> Includes { get; }
}

Task<IReadOnlyList<Payment>> ListAsync(ISpecification<Payment> spec, CancellationToken ct);
```

Composable and testable; the `IQueryable` and `DbContext` lifetime never escape.

**Classic example:**

```
Payment Aggregate
 ├── Payment          (root)
 ├── Transactions     (auth, capture, void)
 └── Refunds

 Loads and saves as ONE unit.

Application → IPaymentRepository (port) → PaymentRepository (adapter) → DbContext → SQL Server
```

**Interview Q&A**

**Q. Do you use Repository with EF Core?**
Not generically. `DbContext` is already a UoW and `DbSet<T>` a Repository. I use **aggregate-scoped, intent-named** repositories where there's a domain reason — the Payment aggregate is one, because payment + transactions + refunds must load and save together — and inject `DbContext` directly for straightforward CRUD.

**Q. What's wrong with `IQueryable<T>` on the interface?**
It hides nothing and leaks everything. We had an intermittent `ObjectDisposedException` in a settlement job from exactly that.

**Q. Where does `SaveChanges` belong?**
Above the repositories, in whatever owns the business transaction. Never per-repository, or capture and ledger posting become two transactions — and a crash between them leaves money captured and unrecorded.

**Q. Concurrency?**
Optimistic with `rowversion`. But for payments the **idempotency key** is the more important control — a unique index on it is what actually prevents a double charge under concurrent submits.

**Q. Testing?**
Domain logic against an in-memory fake of the **interface**. Repository implementations against a **real database via Testcontainers** — the EF In-Memory provider doesn't enforce the unique index on the idempotency key, so it will pass a double-charge test that fails in production.

**Don't confuse with:** **DAO** (per-table CRUD) · **Active Record** (entity persists itself) · **CQRS** (the settlement read model bypasses the repository for a Dapper query — bypassing for reads is a **strength**)

---

# 16. Three production incidents to have ready

## 16.1 Singleton with mutable state → cross-merchant config leak

A merchant-configuration service, `AddSingleton` because the config load was expensive and process-global. A later refactor added a mutable `CurrentMerchantId` field to avoid threading the merchant ID through layers. Three weeks later: **Merchant B's transactions evaluated against Merchant A's limits.**

**Mechanism.** Request A sets `"merchant-A"` → pre-empted → Request B sets `"merchant-B"` → Request A resumes and reads `"merchant-B"`.

**Why it took days.** Intermittent, load-dependent; never reproducible in single-request QA.

**Found by.** Reviewing every `AddSingleton` for non-`readonly` instance fields. One match, correlating with the refactor commit.

**Fixed by.** Field removed; merchant ID passed explicitly. A **Roslyn analyser** now fails the build on any non-`readonly` instance field in a singleton-registered class, plus a concurrent-isolation load test.

> The convenience of a shared field is never worth the cross-tenant risk. The fix for "too many parameters through too many layers" is a **scoped context object**.

## 16.2 Observer without unsubscription → 6 GB memory leak

A long-lived `PaymentEventPublisher` singleton raised `StatusChanged` on every transition. Each per-session `PaymentStatusWidget` subscribed in its constructor; disposal never called `-=`. Over three days the working set grew from ~400 MB to **over 6 GB**, with `OutOfMemoryException` restarts at peak.

**Mechanism.** The invocation list holds a **strong reference** to every subscriber ever attached, plus everything each transitively referenced.

**Found by.** `dotnet-gcdump` — an implausible live count of `PaymentStatusWidget`, each retained through `StatusChanged`'s invocation list.

**Fixed by.** `IDisposable` with explicit `-=`, session close audited to **guarantee** `Dispose`. Weak events where timing couldn't be guaranteed. A Roslyn analyser flags `+=` with no matching `-=`.

> Any subscription **crossing a lifetime boundary** needs guaranteed disposal or a weak event.

## 16.3 Nested `if/else` refund tiers → refunds skipped approval

Refund approval as a deeply nested `if/else if` on thresholds. Inserting a "Finance" tier required exact placement; an **off-by-one let refunds in a specific range skip approval entirely** for several days — caught by an unrelated finance audit, after real money had gone out unapproved.

**Fixed by.** Chain of Responsibility — an explicit **ordered list**, each handler independently testable, boundaries visible in review. Plus parameterised boundary tests per threshold.

> A growing, ordered set of conditional cases is CoR's textbook case. In refunds, getting it wrong is money leaving unapproved.

---

# 17. The confusion matrix

| Pair | The distinction |
|---|---|
| **Adapter vs Facade** | Adapter makes *incompatible* compatible (Stripe SDK → `IPaymentGateway`). Facade makes *complex* simpler (`PayAsync` over five services) |
| **Decorator vs Proxy** | Decorator **adds behaviour**, caller opted in (idempotency). Proxy **controls access**, caller unaware (refund authorisation) |
| **Decorator vs CoR** | Decorator **always** delegates. A CoR handler **may decline** — the support tier claims the refund and stops |
| **Strategy vs State** | Payment **method** is a Strategy (customer-chosen, fixed). Payment **status** is a State (self-driven transitions) |
| **Mediator vs Observer** | `PaymentCaptured` broadcasts (Observer). The checkout screen **decides** what each widget does (Mediator) |
| **Mediator vs Facade** | Facade faces *outward* to the checkout API. Mediator faces *inward* to the widgets |
| **Factory vs Abstract Factory** | One gateway vs a **matched provider family** (authorizer + refunder + validator) |
| **Builder vs Factory** | Factory chooses *which gateway*. Builder assembles *one `PaymentRequest`* over validated steps |
| **Command vs Strategy** | Command is *capture ₹2,500 on payment X* (queueable). Strategy is *how UPI works* |
| **Repository vs DAO** | Repository is aggregate-scoped (Payment + transactions + refunds). DAO is table-scoped CRUD |

---

# 18. Where .NET already implements these

| Pattern | Already in .NET as |
|---|---|
| Factory Method | `ILoggerFactory`, `IHttpClientFactory`, `IServiceScopeFactory`, `IDbContextFactory<T>`, keyed DI |
| Abstract Factory | `DbProviderFactory` |
| Builder | `WebApplicationBuilder`, `ConfigurationBuilder`, `DbContextOptionsBuilder`, `ResiliencePipelineBuilder` |
| Singleton | `services.AddSingleton<T>()`, `IMemoryCache`, `IOptions<T>` |
| Adapter | `StreamReader` over `Stream`, `ILogger` providers, `JsonConverter<T>`, EF Core providers |
| Decorator | `GZipStream`/`CryptoStream`/`BufferedStream`, `DelegatingHandler`, Polly, Scrutor |
| Facade | `HttpClient`, `File.ReadAllTextAsync`, `WebApplication` |
| Proxy | `Lazy<T>`, EF lazy-loading proxies, gRPC/Refit clients, `DispatchProxy` |
| Strategy | `IComparer<T>`, `IEqualityComparer<T>`, `Func<>`/`Predicate<>`, `IAuthorizationHandler` |
| Observer | `event`/delegate, `IObservable<T>`, `INotifyPropertyChanged`, `IChangeToken` |
| Command | MediatR `IRequest`, Hangfire jobs, WPF `ICommand`, the Outbox table |
| Chain of Responsibility | **ASP.NET Core middleware**, `DelegatingHandler`, `IEndpointFilter`, MVC filters |
| Mediator | MediatR / Wolverine, SignalR hubs |
| State | `async`/`await` state machine, `TaskStatus`, Polly circuit breaker |
| Repository / UoW | **`DbSet<T>` / `DbContext`** — already both |

---

# 19. Red flags

| Said | Heard |
|---|---|
| "Singleton is great for shared state" | Hasn't debugged a cross-tenant leak |
| "I always use a generic `IRepository<T>` with EF" | Hasn't read what `DbContext` already does |
| "MediatR is the Mediator pattern" | Hasn't looked past the package name |
| "`StringBuilder` is the Builder pattern" | Name-matched instead of intent-matched |
| "We use the Observer pattern" — as if separate from events | Learned patterns from a book, not from C# |
| Retry without idempotency in a payment flow | Will ship a double charge |
| "Undo the capture" | Doesn't understand money movement is compensated, not reversed |
| A pattern answer with no *when not to use* | Will over-engineer |
| Can't name a single .NET framework example | Hasn't connected theory to the platform |
| Never having *removed* an abstraction | Hasn't felt the cost side |

---

# 20. Cheat sheet

**Creational**

| Pattern | One line | Payment example |
|---|---|---|
| Factory Method ⭐⭐⭐⭐ | One product, type deferred. Keyed DI is the modern form | Gateway by country |
| Abstract Factory ⭐⭐⭐ | A **family**, with a consistency guarantee | Authorizer + refunder + webhook validator |
| Builder ⭐⭐⭐⭐ | Multi-step, validated construction | `PaymentRequest` cross-field rules |
| Singleton ⭐⭐⭐⭐⭐ | `AddSingleton`, not `static Instance`. Every field `readonly` | Merchant config, BIN cache |

**Structural**

| Pattern | One line | Payment example |
|---|---|---|
| Adapter ⭐⭐⭐⭐ | Incompatible → compatible. Shape, types **and failure model** | Stripe SDK → `IPaymentGateway` |
| Decorator ⭐⭐⭐⭐⭐ | Same interface, adds behaviour. **Idempotency outside retry** | Idempotency + retry + logging |
| Facade ⭐⭐⭐ | Complex → simple, not the *only* way in | `PayAsync` over five services |
| Proxy ⭐⭐⭐ | Controls access: protection, virtual, remote, caching | Refund authorisation |

**Behavioral**

| Pattern | One line | Payment example |
|---|---|---|
| Strategy ⭐⭐⭐⭐⭐ | Interchangeable algorithm. "Inject an interface" **is** Strategy | Card / UPI / Wallet |
| Observer ⭐⭐⭐⭐ | `event` **is** Observer. **Unsubscribe across lifetimes** | `PaymentCaptured` → ledger |
| Command ⭐⭐⭐⭐ | Request as data. **Compensate, don't undo** | Capture / refund queue |
| CoR ⭐⭐⭐⭐⭐ | Handlers may decline. **ASP.NET Core middleware.** Terminate | Refund approval tiers |
| Mediator ⭐⭐⭐⭐ | n² → n. **MediatR is mostly a dispatcher** | Checkout widgets |
| State ⭐⭐⭐ | Object drives its own transitions. `sealed record` + `switch` | Initiated → Authorized → Captured |

**Persistence**

| Pattern | One line | Payment example |
|---|---|---|
| Repository / UoW ⭐⭐⭐⭐⭐ | **`DbContext` is a UoW, `DbSet<T>` is a Repository.** Never return `IQueryable<T>` | The Payment aggregate |

---

**This guide is the whole folder.** The three source modules covering all 23 GoF patterns were removed on 2026-09-06 once this guide superseded them. Restore with `git checkout 8deee37 -- 11-Design-Patterns/` if the nine dropped patterns are ever needed.

**Next:** the distributed patterns — Saga, Outbox, Idempotency, CQRS, Circuit Breaker, Retry, Bulkhead, API Gateway, Service Discovery, Strangler Fig, Sidecar — are in [[../17-Microservices/00-Microservices-Interview-Master-Guide-DotNet-TechLead-Architect]].
