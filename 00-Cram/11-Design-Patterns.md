# Design Patterns — Cram Sheet

> Tier 1 · Source: `11-Design-Patterns/00` (1,934 lines) · Read: 12 min
> ⭐ = interview frequency. Every example is a payment system — reuse it.

---

## Creational

| Pattern | One line | Payment example | .NET already does it |
|---|---|---|---|
| **Factory Method** ⭐⭐⭐⭐ | One product, concrete type deferred. **Keyed DI is the modern form** | gateway by country | `ILoggerFactory`, `IHttpClientFactory`, `IDbContextFactory<T>` |
| **Abstract Factory** ⭐⭐⭐ | A **family**, with a consistency guarantee | authorizer + refunder + webhook validator, all same provider | `DbProviderFactory` |
| **Builder** ⭐⭐⭐⭐ | Multi-step, **validated** construction | `PaymentRequest` cross-field rules | `WebApplicationBuilder`, `ConfigurationBuilder` |
| **Singleton** ⭐⭐⭐⭐⭐ | `AddSingleton`, **not** `static Instance`. Every field `readonly` | merchant config, BIN cache | `services.AddSingleton<T>()`, `IMemoryCache` |

## Structural

| Pattern | One line | Payment example | .NET already does it |
|---|---|---|---|
| **Adapter** ⭐⭐⭐⭐ | Incompatible → compatible. Shape, types **and failure model** | Stripe SDK → `IPaymentGateway` | `StreamReader`, `JsonConverter<T>` |
| **Decorator** ⭐⭐⭐⭐⭐ | Same interface, adds behaviour. **Idempotency goes *outside* retry** | idempotency + retry + logging | `GZipStream`, `DelegatingHandler`, Polly, Scrutor |
| **Facade** ⭐⭐⭐ | Complex → simple, but **not the only way in** | `PayAsync` over five services | `HttpClient`, `File.ReadAllTextAsync` |
| **Proxy** ⭐⭐⭐ | **Controls access**: protection, virtual, remote, caching | refund authorisation | `Lazy<T>`, EF lazy-loading proxies, Refit |

## Behavioural

| Pattern | One line | Payment example | .NET already does it |
|---|---|---|---|
| **Strategy** ⭐⭐⭐⭐⭐ | Interchangeable algorithm. **"Inject an interface" *is* Strategy** | Card / UPI / Wallet | `IComparer<T>`, `Func<>`, `IAuthorizationHandler` |
| **Observer** ⭐⭐⭐⭐ | **`event` *is* Observer.** Unsubscribe across lifetimes | `PaymentCaptured` → ledger | `event`, `IObservable<T>`, `IChangeToken` |
| **Command** ⭐⭐⭐⭐ | Request as data (queueable, loggable). **Compensate, don't undo** | capture / refund queue | MediatR `IRequest`, Hangfire, **the Outbox table** |
| **Chain of Responsibility** ⭐⭐⭐⭐⭐ | Handlers **may decline**. Must terminate | refund approval tiers | **ASP.NET Core middleware**, `IEndpointFilter`, MVC filters |
| **Mediator** ⭐⭐⭐⭐ | n² → n. **MediatR is mostly a dispatcher** | checkout widgets | MediatR, SignalR hubs |
| **State** ⭐⭐⭐ | Object drives its **own** transitions. `sealed record` + `switch` | Initiated → Authorized → Captured | `async` state machine, Polly circuit breaker |
| **Repository / UoW** ⭐⭐⭐⭐⭐ | Aggregate-scoped, not table-scoped | Payment + transactions + refunds | **`DbSet<T>` / `DbContext` — already both** |

---

## The confusion matrix (this is where interviews are won)

| Pair | The distinction |
|---|---|
| **Adapter vs Facade** | Adapter makes *incompatible* compatible. Facade makes *complex* simpler. |
| **Decorator vs Proxy** | Decorator **adds behaviour**, caller opted in. Proxy **controls access**, caller unaware. |
| **Decorator vs CoR** | Decorator **always** delegates. A CoR handler **may decline** and stop the chain. |
| **Strategy vs State** | Payment *method* = Strategy (chosen externally, fixed). Payment *status* = State (self-driven transitions). |
| **Mediator vs Observer** | Observer **broadcasts** (`PaymentCaptured`). Mediator **decides** what each participant does. |
| **Mediator vs Facade** | Facade faces *outward* (to the API caller). Mediator faces *inward* (between components). |
| **Factory vs Abstract Factory** | One product vs a **matched family** with a consistency guarantee. |
| **Builder vs Factory** | Factory chooses *which*. Builder assembles *one* object over validated steps. |
| **Command vs Strategy** | Command = "capture £2,500 on payment X" (data, queueable). Strategy = "how UPI works". |
| **Repository vs DAO** | Repository = aggregate-scoped. DAO = table-scoped CRUD. |

---

## Three production incidents to have ready

1. **Singleton with mutable state → cross-merchant config leak.** A `static` cache keyed wrong, or a `Singleton` holding a `Scoped` dependency. Fix: every field `readonly`, state keyed explicitly, `ValidateScopes` on.
2. **Observer without unsubscription → multi-GB memory leak.** A long-lived publisher keeps every subscriber alive (lapsed listener). Fix: explicit unsubscribe, weak events, or a mediator with scoped handlers.
3. **Nested `if/else` refund tiers → refunds skipped approval.** A new tier was added and the branch order meant high-value refunds matched an earlier arm. Fix: Chain of Responsibility with an explicit terminal handler, plus an exhaustiveness test.

---

## Red flags (what NOT to say)

| Said | Heard |
|---|---|
| "Singleton is great for shared state" | hasn't debugged a cross-tenant leak |
| "I always use a generic `IRepository<T>` with EF" | hasn't read what `DbContext` already does |
| "MediatR is the Mediator pattern" | name-matched, didn't look past the package |
| "`StringBuilder` is the Builder pattern" | matched the name, not the intent |
| "We use the Observer pattern" — as if separate from `event` | learned from a book, not from C# |
| Retry without idempotency in a payment flow | will ship a double charge |
| "Undo the capture" | money movement is **compensated, never reversed** |
| A pattern answer with no *when not to use* | will over-engineer |
| Can't name a .NET framework example | theory not connected to the platform |
| Never having **removed** an abstraction | hasn't felt the cost side |

---

## Interview Q&A — Lead / Principal

### Q1 · The retry that double-charged *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"We wrapped our payment client in a retry decorator and an idempotency decorator. Customers are being double-charged. Why?"*

**Answer.** The decorators are in the wrong order. If **retry wraps idempotency**, each retry attempt passes through the idempotency decorator afresh and generates a **new key** — so the provider sees three distinct requests and charges three times. The idempotency decorator must be **outside** the retry, so the key is generated once and every retry carries the same one, which is what lets the provider deduplicate.

That's the concrete bug, and the general principle worth stating: **decorator order is semantics, not style.** Each layer's position changes behaviour, so the composition needs to be explicit and tested — I'd want an integration test asserting that three retries produce one charge, because this is invisible in code review and only shows up in money.

Two related orderings I'd check in the same review: the **circuit breaker** should sit outside retry (otherwise the breaker counts retries as separate failures and trips on a single logical call), and **logging/telemetry** outermost so it records the whole operation including retries rather than each attempt separately.

**Why it lands.** Diagnoses the ordering precisely, generalises to "order is semantics", and adds the breaker and telemetry positions unprompted.
**✗ Weak answer.** "Add idempotency" — it's already there; the composition is the bug.
**↳ Follow-ups.** Where does the key come from? How would you test the ordering?

---

### Q2 · Too many patterns *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"A PR introduces an abstract factory, a strategy and a mediator for a feature with one implementation. How do you handle the review?"*

**Answer.** I'd push back, and carefully, because the author is applying things they've learned and a blunt rejection teaches them to stop thinking rather than to think better. The substance: **an interface with exactly one implementation and no second one in sight is indirection, not abstraction.** It adds a file to navigate, a layer to step through when debugging, and it fixes the variation axis before we know what varies — which is the expensive mistake, because a wrong abstraction costs more than the duplication it removed.

The question I'd ask in the review is "what's the second implementation, and when does it arrive?" If there's a real answer — a second payment provider next quarter — the abstraction is justified now. If the answer is "we might need it," that's YAGNI and I'd ask for the direct implementation, noting that introducing the pattern later is a small, safe refactor with the tests already in place.

The framing I'd give the team: **being able to say what a pattern costs is the senior skill, not knowing its name.** And I'd mention that I've deleted abstractions before and the code got shorter with nothing lost — because engineers rarely see removal modelled, and over-engineering is penalised harder than under-engineering precisely because it's invisible and compounding.

**Why it lands.** Handles the human side, gives a concrete decision test, and models removing abstractions — which almost nobody mentions.
**✗ Weak answer.** Approving it as "good practice", or rejecting with "over-engineered" and no criterion.
**↳ Follow-ups.** When would you reverse and add the abstraction? How do you teach this without discouraging them?

---

### Quick-fire (30 seconds each)

- **"Which pattern do you use most?"** → Strategy and Decorator, because in .NET they're barely "patterns" — injecting an interface *is* Strategy, and `DelegatingHandler`/Polly *is* Decorator. The judgement is in the ordering: on a payment client the idempotency decorator has to sit **outside** the retry decorator, or each retry generates a new key and you double-charge.
- **"Repository over EF Core — yes or no?"** → Usually no. `DbContext` is already a Unit of Work and `DbSet<T>` is already a Repository, so a generic `IRepository<T>` adds a layer that mostly forwards, and leaking `IQueryable` through it causes `ObjectDisposedException`. I'd add a repository only when it's **aggregate-scoped** and hides a genuine decision — and I'd pass specifications as `Expression<Func<T,bool>>`, never a live `IQueryable`.
- **"When would you remove a pattern?"** → When there's one implementation and no second one coming — an interface with a single implementer is indirection, not abstraction. I've deleted a factory that only ever returned one type; the code got shorter and nothing was lost. Being able to say what a pattern *costs* is the point.

---

**Go deeper:** `11-Design-Patterns/00` · **Related:** [[09-OOP-SOLID]], [[09-OOP-SOLID]], [[32-Clean-Hexagonal-Architecture]], [[15-Low-Level-Design]]
