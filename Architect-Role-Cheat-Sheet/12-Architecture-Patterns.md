# 12. Architecture Patterns — 24 Questions (Answered)

> **Method:** cloud and distributed patterns are defined using the **official summary from the Azure Architecture Center — Cloud Design Patterns catalogue**, quoted verbatim; layered/Clean/Hexagonal/Onion are defined from their **originating sources** (Cockburn's *Ports and Adapters*, Palermo's *Onion Architecture*, Martin's *Clean Architecture*) and **Microsoft Learn**'s architecture guidance; **AWS Prescriptive Guidance** and the **AWS Well-Architected Framework** where the pattern is operational. Then the architect-level analysis: what it costs, when it is wrong, and how to choose. Several of these patterns are implemented in detail in **Module 4 (Microservices)** and **Module 6 (Design Patterns)** — those are cross-referenced rather than repeated. Links in **References**.

---

## Q1. What is Layered Architecture?

**Layered (n-tier) architecture** organises code into horizontal layers, each with a defined responsibility, where **each layer depends only on the layer beneath it**.

```
┌──────────────────────────────────────┐
│ Presentation  (Controllers, DTOs)    │
├──────────────────────────────────────┤
│ Application   (services, use cases)  │
├──────────────────────────────────────┤
│ Domain        (entities, rules)      │
├──────────────────────────────────────┤
│ Infrastructure (EF Core, HTTP, files)│  ← everything above eventually depends on this
└──────────────────────────────────────┘
```

**Rules:** dependencies point **downward** only; a layer may be *closed* (must pass through) or *open* (may be skipped); each layer has a single, named responsibility.

**Why it survives despite being unfashionable:**
- **Universally understood.** Any engineer can navigate it on day one — a real and underrated architectural property.
- **Cheap.** No abstractions to maintain, no interfaces that exist only to satisfy a rule.
- **Adequate.** For a CRUD application with modest business logic, it is genuinely the right answer, and pretending otherwise costs money.

**Its structural flaw, and the reason Clean/Hexagonal/Onion exist:** the **domain sits on top of infrastructure**, so the business rules depend on EF Core, on the database schema, on HTTP clients. Change the persistence technology and the domain changes with it. Test the domain and you need a database. The dependency direction is exactly backwards from what a long-lived codebase wants.

**The other failure mode is the "sinkhole":** a request that passes through four layers, each of which does nothing but forward the call, adds ceremony without value. If your application service is `return _repository.GetById(id);` for eighty endpoints, the layers are costing you more than they give.

**When I would choose it:** small-to-medium CRUD services, internal tools, teams without deep architectural experience, and anything where the domain logic is genuinely thin. **When I would not:** a rich domain (pricing, settlement, risk), a long-lived core system, or anywhere the persistence choice is likely to change. Saying "layered is right here" when it is, is a stronger answer than reflexively proposing Clean Architecture for a lookup service.

---

## Q2. What is Clean Architecture?

**Clean Architecture** (Robert C. Martin, 2012/2017) organises a system into concentric circles governed by one rule — **the Dependency Rule**: *source code dependencies must point only inward, toward higher-level policies.* Nothing in an inner circle may know anything about an outer circle.

```
        ┌─────────────────────────────────────────────┐
        │  Frameworks & Drivers                       │  EF Core, ASP.NET Core, Kafka client
        │  ┌───────────────────────────────────────┐  │
        │  │  Interface Adapters                   │  │  Controllers, Presenters, Repositories (impl)
        │  │  ┌─────────────────────────────────┐  │  │
        │  │  │  Application Business Rules     │  │  │  Use cases / interactors
        │  │  │  ┌───────────────────────────┐  │  │  │
        │  │  │  │  Enterprise Business Rules│  │  │  │  Entities — the domain
        │  │  │  └───────────────────────────┘  │  │  │
        │  │  └─────────────────────────────────┘  │  │
        │  └───────────────────────────────────────┘  │
        └─────────────────────────────────────────────┘
                    dependencies point INWARD →
```

**The mechanism that makes it work is dependency inversion.** The use case needs to save an order; it cannot depend on EF Core. So the **interface is declared in the inner circle** and **implemented in the outer**:

```csharp
// Application layer — the interface lives here, with the code that needs it
public interface IOrderRepository { Task<Order?> GetAsync(OrderId id, CancellationToken ct); }

// Infrastructure layer — the implementation lives out here, depending inward
internal sealed class EfOrderRepository(AppDbContext db) : IOrderRepository { … }
```
At runtime, DI wires the outer implementation into the inner abstraction. **Compile-time dependency points inward; runtime flow points outward.** Being able to state that distinction cleanly is what the question is testing.

**What it buys:**
- **The domain is testable with no infrastructure** — no database, no HTTP, no mocking framework gymnastics. This is the largest practical benefit.
- **Deferred and reversible technology decisions** — swap EF Core for Dapper, SQL Server for PostgreSQL, REST for gRPC, without touching business rules.
- **The domain is readable as a description of the business**, not as a description of the database.

**What it costs, and this must be said:** more projects, more interfaces, more mapping between layers (entity ↔ DTO ↔ view model), and a higher barrier for new joiners. For a CRUD service, it is pure overhead. The honest position is that **Clean Architecture pays for itself in proportion to the richness and longevity of the domain** — which is why it is the right default for a ledger, a pricing engine or a settlement service, and the wrong default for a reference-data lookup API.

---

## Q3. What is Hexagonal Architecture?

**Hexagonal Architecture** — Alistair Cockburn's original name is **Ports and Adapters** (2005) — states its intent as: *"Allow an application to equally be driven by users, programs, automated test or batch scripts, and to be developed and tested in isolation from its eventual run-time devices and databases."*

```
            driving (primary) side          driven (secondary) side
   REST controller ─┐                                    ┌─▶ EF Core adapter ─▶ PostgreSQL
   gRPC service ────┼─▶ [ Port ] ┌──────────────┐ [Port]─┼─▶ Kafka adapter ───▶ broker
   CLI / test ──────┘            │  APPLICATION │        └─▶ HTTP adapter ────▶ payment provider
   scheduler ──────────────────▶ │  + DOMAIN    │
                                 └──────────────┘
```

**The two concepts:**
- A **port** is an interface owned by the application, expressed in the application's own language. **Driving (primary) ports** are the API the application offers (`IAuthorisePayment`). **Driven (secondary) ports** are what the application requires from the world (`IPaymentGateway`, `IOrderRepository`).
- An **adapter** is a technology-specific implementation of a port. A REST controller is a driving adapter; an EF Core repository is a driven adapter.

**The insight that distinguishes it from layering:** the hexagon has **no top or bottom**. A layered diagram implies UI is "above" and database is "below", which suggests they are different kinds of thing. Cockburn's point is that they are the **same** kind of thing — both are just external actors talking to the application through ports. That symmetry is why the shape is a polygon rather than a stack, and saying so is the mark of someone who has read the original rather than a blog summary.

**The practical payoff:** the application can be driven by a test harness exactly as it is driven by HTTP, because both are just adapters on driving ports. You test the *entire application* — real use cases, real domain logic — with in-memory adapters, and get the coverage of an integration test at the speed of a unit test. That is the single most valuable thing this style gives you.

**In .NET**, a hexagonal solution looks like: `Domain` (entities, value objects, domain services — no dependencies), `Application` (use cases + **port interfaces**), `Adapters.Web`/`Adapters.Persistence`/`Adapters.Messaging`, and a `Host` composition root that wires them. The dependency direction is enforced by project references, and ideally by an **ArchUnitNET** test so the rule is checked by CI rather than by code review.

---

## Q4. What is Onion Architecture?

**Onion Architecture** (Jeffrey Palermo, 2008) predates Clean Architecture and expresses the same core idea with an explicit domain-centric emphasis. Palermo's rule: *"All coupling is toward the centre"*, and the centre is the **Domain Model**.

```
     ┌──────────────────────────────────────────────┐
     │ Infrastructure / UI / Tests                  │  ← all outermost, all peers
     │  ┌────────────────────────────────────────┐  │
     │  │ Application Services                   │  │
     │  │  ┌──────────────────────────────────┐  │  │
     │  │  │ Domain Services                  │  │  │
     │  │  │  ┌────────────────────────────┐  │  │  │
     │  │  │  │ Domain Model (entities)    │  │  │  │  ← the centre; depends on nothing
     │  │  │  └────────────────────────────┘  │  │  │
     │  │  └──────────────────────────────────┘  │  │
     │  └────────────────────────────────────────┘  │
     └──────────────────────────────────────────────┘
```

**Its distinctive contributions:**

1. **Interfaces belong to the inner layers, implementations to the outer.** Palermo's formulation put repository *interfaces* in the domain — the point being that the domain declares its needs, and infrastructure serves them.
2. **The domain model is the centre, not the database.** Onion was written explicitly as a reaction to database-first, data-centric design in the .NET world of the time, where the schema drove the object model. That historical context is worth knowing, because it explains the emphasis.
3. **Infrastructure, UI and tests are all peers in the outermost ring.** Tests are not a special case; they are just another consumer.

**The .NET solution structure it produced** is the one still used widely today:
```
MyApp.Domain            → entities, value objects, domain events, repository interfaces
MyApp.Application       → use cases, application services, DTOs, port interfaces
MyApp.Infrastructure    → EF Core, external clients, messaging (references Domain + Application)
MyApp.Api               → controllers, DI composition root
```

**Why it matters in a .NET interview specifically:** the "Clean Architecture" solution templates most .NET teams use (Ardalis, Jason Taylor) are structurally **Onion**, with Clean Architecture's vocabulary layered on top. Knowing that these are the same idea from different authors — and being able to say so without pretending they are three unrelated architectures — is the point of the next question.

---

## Q5. Clean vs Hexagonal vs Onion?

**They are three formulations of one idea: the domain must not depend on infrastructure; dependencies point inward; abstractions are owned by the inner layers and implemented by the outer.** Anyone who presents them as three competing architectures has missed the point, and any interviewer worth their salt is testing exactly that.

| | **Hexagonal (2005)** | **Onion (2008)** | **Clean (2012)** |
|---|---|---|---|
| Author | Alistair Cockburn | Jeffrey Palermo | Robert C. Martin |
| Core metaphor | **Ports and adapters** — symmetric hexagon, no top or bottom | **Concentric rings** — all coupling toward the centre | **Concentric circles** + the **Dependency Rule** |
| Emphasises | **Testability and driver-symmetry** — UI and DB are the same kind of thing | **Domain-model centrality**; a reaction to database-first design | **A general, layered synthesis**, with named roles (entities, use cases, adapters) |
| Distinctive vocabulary | Driving/driven ports, adapters | Domain model / domain services / application services | Entities, Use Cases, Interface Adapters, Frameworks & Drivers |
| Prescriptiveness | Least — two concepts, that's all | Moderate | Most — names the rings and their contents |

**What they genuinely share:**
- Dependency inversion at the architectural boundary.
- The domain has **no** framework, database or transport dependencies.
- Interfaces are declared where they are *needed* (inside) and implemented where the technology lives (outside).
- Business logic is testable without infrastructure.
- Infrastructure is a **detail**, swappable in principle.

**What actually differs — and it is mostly vocabulary and emphasis:** Hexagonal is the most minimal and the most useful as a *thinking tool* (is this a driving or a driven port?). Onion is the most explicit about the domain being the centre. Clean is the most prescriptive and the best known, and it generalises the other two while adding the screaming-architecture idea that the folder structure should reveal the *domain*, not the framework.

**How I answer this in an interview:** *"They're the same architecture with different diagrams. I'd describe what I actually do — a domain project with no dependencies, an application project that owns the port interfaces, infrastructure projects that implement them, and a host that composes them — and I'd enforce the dependency direction with an architecture test in CI rather than with a diagram on a wiki. The label matters less than whether the rule is actually enforced."*

**And the caveat that shows judgement:** all three are **application-level** architectures, not system-level ones. They tell you nothing about service boundaries, data ownership, consistency or deployment. A microservices platform where every service is beautifully Clean inside can still be a distributed monolith outside. The system-level decisions — bounded contexts, database-per-service, event flows — are the ones covered in Module 4, and they matter more.

---

## Q6. What is Modular Monolith?

A **modular monolith** is a **single deployable unit** internally divided into **strongly-bounded, loosely-coupled modules** — each owning its own domain model, its own data, and a published interface, with no module reaching into another's internals.

```
┌──────────────── ONE deployable process ────────────────┐
│  ┌──────────┐   ┌──────────┐   ┌──────────┐            │
│  │ Payments │   │ Ledger   │   │ Customer │            │
│  │  ┌────┐  │   │  ┌────┐  │   │  ┌────┐  │            │
│  │  │data│  │   │  │data│  │   │  │data│  │  ← separate schemas,
│  │  └────┘  │   │  └────┘  │   │  └────┘  │     no cross-module joins
│  └────┬─────┘   └────┬─────┘   └────┬─────┘            │
│       └── in-process contracts / events ──┘            │
└────────────────────────────────────────────────────────┘
             ONE database instance, N schemas
             ONE deployment, ONE transaction scope available
```

**The rules that make it modular rather than just "a monolith with folders":**
1. **Each module owns its data.** Separate schema; **no cross-module foreign keys or joins**. Another module asks via a public interface or an event — never by querying its tables. This is the rule that everything else depends on.
2. **A published contract per module** — a public API surface, everything else `internal`. In .NET this is enforced with assembly boundaries and `InternalsVisibleTo` discipline.
3. **Communication via in-process interfaces or an in-process event bus** (MediatR notifications, Wolverine, or a simple mediator), not by reaching into another module's services directly.
4. **Enforced by tooling, not goodwill** — separate projects, `internal` visibility, and **architecture tests** (NetArchTest/ArchUnitNET) that fail the build when a module references another's internals. Without enforcement, a modular monolith degrades into a big ball of mud in about six months.

**Why it has become the recommended default:** it gives you most of what people actually want from microservices — clear ownership, independent development, bounded contexts, and a domain model that isn't a mess — **without** the distributed-systems tax: no network failures between modules, no eventual consistency, no distributed tracing to answer "where did the request go", no per-service pipeline, and **real ACID transactions across modules when you genuinely need them**.

**And it is the right on-ramp.** If the modules are properly bounded, extracting one into a service later is a contained piece of work — replace the in-process call with an HTTP/queue adapter behind the same interface. If they are *not* properly bounded, you were never ready for microservices anyway, and finding that out cheaply is a feature.

**Its real limits, stated honestly:** one deployment (so one team's bug can take down everything, and release cadence is shared), one technology stack, one scaling unit (you scale the whole thing even if only payments is hot), and a shared process — a memory leak in one module affects all. Those are the conditions that eventually justify extraction.

---

## Q7. Modular Monolith vs Microservices?

| | **Modular Monolith** | **Microservices** |
|---|---|---|
| Deployment | **One unit** | **Independent per service** |
| Module/service communication | **In-process** — fast, reliable, typed | **Network** — slow, fallible, versioned |
| Transactions | **ACID across modules** available | **Sagas and compensation** (Module 4 Q18–Q21) |
| Consistency | Strong | **Eventual**, by default |
| Data | One database, separate schemas | **Database per service** (Q20) |
| Scaling | The whole application | **Per service** |
| Technology | One stack | Per-service choice |
| Failure isolation | **None** — one process | **Real**, if you build it |
| Team autonomy | Shared release train | **Independent deploys** |
| Debugging | A stack trace | **Distributed tracing**, and you must build it |
| Operational cost | **Low** | **High** — pipelines, observability, service mesh, on-call per service |
| Refactoring boundaries | **Cheap** — a compiler-checked rename | **Expensive** — a versioned contract change across teams |

**The decision criteria that actually matter — and note that only the first is technical:**

1. **Team topology.** Microservices exist to let **teams deploy independently**. One team of eight does not need them and will pay for them anyway. Conway's Law is the real driver: service boundaries should mirror team boundaries.
2. **Differential scaling needs.** If one component genuinely needs 50 instances while the rest need 3, that is a real argument for extraction.
3. **Differential availability or compliance requirements.** A PCI-scoped component isolated from everything else is a legitimate reason to split.
4. **Are your boundaries stable and proven?** Microservices make boundaries **expensive to change**. Get them wrong and you have a distributed monolith — all the cost, none of the benefit. A modular monolith lets you discover the right boundaries cheaply first.
5. **Operational maturity.** Can you run CI/CD, distributed tracing, centralised logging, service discovery, contract testing and per-service on-call? If not, microservices will make you slower, not faster.

**My default recommendation, stated plainly:** *start with a modular monolith; extract services when a specific, named pressure justifies it.* This is not conservatism — it is what most large organisations, including Amazon in several well-documented cases, have converged on after over-splitting. Extraction from a well-modularised monolith is a manageable project; recombining a distributed monolith is not.

**When to skip straight to microservices:** many teams that must ship independently from day one, a genuine polyglot requirement, hard regulatory isolation between domains, or an organisation that already has the platform and the operational muscle. Then the answer is different — and it should be justified by *those* facts, not by fashion.

---

## Q8. What is CQRS?

**Per the Azure Architecture Center:** CQRS is *"Separate operations that read data from those that update data by using distinct interfaces."*

CQRS — **Command Query Responsibility Segregation**, from Greg Young, building on Bertrand Meyer's Command-Query Separation — separates the **write model** from the **read model**.

```
                     ┌──────────────┐
  Command ─────────▶ │ Write model  │ ──▶ normalised store (ACID, invariants)
  (change state,     │ (domain,     │            │
   returns nothing)  │  validation) │            │ events / projections
                     └──────────────┘            ▼
  Query ───────────────────────────────▶ ┌──────────────┐
  (return data,                          │ Read model(s)│ ── denormalised, per query
   changes nothing)                      └──────────────┘
```

**The levels of CQRS, because "do you use CQRS?" is an ambiguous question and a good answer disambiguates it:**

| Level | What is separated | Cost |
|---|---|---|
| **1. Code-level** | Separate command and query handlers/methods, one database, one model | Almost none — this is just good structure (MediatR `IRequest`/`IRequestHandler`) |
| **2. Model-level** | Separate write model (rich domain, EF Core) and read model (DTOs via Dapper/raw SQL), **one database** | Low; often the sweet spot |
| **3. Store-level** | **Separate databases** — writes to Aurora, reads from DynamoDB/OpenSearch/Redis, synced by events | High: eventual consistency, projection code, replay/rebuild machinery |

Most teams saying "we use CQRS" mean level 1 or 2. **Level 3 is where the real trade-offs live**, and where the interview question is aimed.

**Why separate at all:** reads and writes have genuinely different characteristics. Writes need a normalised model that enforces invariants and is optimised for consistency. Reads need denormalised shapes optimised for specific queries, at a volume that is often 100:1 against writes. Forcing both through one model means the model is a compromise that serves neither well — the classic symptom being an ORM entity with fifteen `Include`s to render one screen.

**Concretely in .NET:**
```csharp
// Write side — rich domain, EF Core, invariants enforced
public sealed record AuthorisePayment(PaymentId Id, Money Amount) : IRequest;

// Read side — bypass the ORM entirely; one purpose-built query
public sealed record GetPaymentSummary(PaymentId Id) : IRequest<PaymentSummaryDto>;
// handler: await connection.QuerySingleAsync<PaymentSummaryDto>(sql, new { id });
```

**Note what CQRS is *not*:** it is not Event Sourcing (Q11) — they pair well and are frequently conflated, but each is usable without the other. And it is not "two databases" by definition; that is only level 3.

---

## Q9. When should CQRS be used?

Use it when the **read and write workloads genuinely differ** in a way a single model cannot serve. Concretely:

| Signal | Why CQRS helps |
|---|---|
| **Read:write ratio is heavily skewed** (100:1 or more) | Read models scale independently, cached and denormalised, without compromising write integrity |
| **The write model is complex; the reads are simple projections** | A rich aggregate protects invariants; a flat DTO serves the UI. Forcing one model to do both produces a bad version of each |
| **Many different read shapes** over the same data — dashboards, search, exports, statements | Each gets a purpose-built read model instead of a query with nine joins |
| **Read and write need different stores** — full-text search, graph traversal, time series | Only separate stores can serve these; the write store stays relational |
| **Reads and writes need different scaling or availability** | Reads can stay up (from a replica or cache) while writes are degraded |
| **Different security/audit requirements** per side | Command handlers become the single place to authorise and audit state change |
| **You are already event-driven** | Read models are just another consumer of the events you already publish |
| **Collaborative domains with contention** | Task-based commands (`ChangeShippingAddress`) express intent better than "save this whole object", reducing lost updates |

**The .NET/EF-specific signal worth naming:** when you find yourself fighting the ORM on the read side — projections, `AsNoTracking`, split queries, and still slow — that is the concrete moment level-2 CQRS pays. Keep EF Core for the write model where change tracking earns its cost, and use **Dapper or raw SQL for reads**. This alone, with no eventual consistency and no second database, resolves a large share of real performance problems (Module 11 Q10, Q12).

**A fintech example where level 3 is genuinely justified:** the ledger is a normalised, ACID, relational write model — non-negotiable for correctness. But the merchant dashboard needs "transactions by merchant by day with running totals", the ops team needs full-text search over transaction metadata, and the reconciliation process needs a daily flat file. Three read models, each built by projecting the ledger's events, each independently scalable, and **none of them able to slow down the write path**. That last property — protecting the write path from read load — is often the real reason.

---

## Q10. When should CQRS NOT be used?

**Default to not using level-3 CQRS.** It is the pattern most often applied where it does not belong, and being able to say when it is wrong is more valuable in an interview than being able to describe it.

**Don't use it when:**

1. **The domain is simple CRUD.** If the read model is the write model with different capitalisation, CQRS adds handlers, projections and a consistency problem in exchange for nothing. Most administrative screens, reference-data services and internal tools are in this category.
2. **You cannot tolerate eventual consistency, and you haven't designed for it.** With separate stores, a user who writes and immediately reads may **not see their own change**. In a payments UI that produces "I paid and my balance didn't change" support tickets. You can mitigate (read-your-writes routing, returning the command result rather than re-querying, a consistency token) — but you must *choose* to, and each mitigation is work.
3. **The team hasn't done it before and there is no strong driver.** CQRS with separate stores means writing and operating projections: rebuilds, replay, ordering, idempotency, poison messages, lag monitoring. That is a real system, not a code style.
4. **Read and write loads are similar.** The main justification evaporates.
5. **Consistency is a regulatory requirement** for that specific data. A regulatory report generated from a lagging projection is a report that can be wrong at the moment it is filed.
6. **You are applying it because it appeared in a diagram.** CQRS + Event Sourcing + microservices adopted together, without a driver, is the most reliable way to make a small system unmaintainable.

**What the costs actually are:**
- **Eventual consistency** and every UX and correctness consequence of it.
- **Projection infrastructure** — code, deployment, monitoring, and a tested rebuild path (which you *will* need, because projections have bugs).
- **Duplicated data** and the storage/cost that comes with it.
- **Harder debugging** — "the dashboard is wrong" now has three possible causes: the write, the event, or the projection.

**The graduated answer that scores well:** *"I'd use level 1 almost always — separate command and query handlers is just good structure. Level 2 — a rich domain model for writes and Dapper for reads against the same database — is my default when reads get complex, and it costs nothing in consistency. I'd only go to level 3 with separate stores when there is a specific, stated driver: a read volume the write store can't serve, a query shape it can't answer, or an availability requirement it can't meet. And I'd say so explicitly rather than adopting it because it's on the architecture poster."*

---

## Q11. What is Event Sourcing?

**Per the Azure Architecture Center:** Event Sourcing is *"Use an append-only store to record a full series of events that describe actions taken on data in a domain."*

Instead of storing **current state** and overwriting it, you store the **sequence of state-changing events**. Current state is derived by replaying them.

```
Traditional (state-oriented):
  accounts: { id: A1, balance: 150 }        ← UPDATE overwrites; history is lost

Event-sourced:
  events for A1:
    1  AccountOpened      { initial: 0     }
    2  MoneyDeposited     { amount: 200    }
    3  MoneyWithdrawn     { amount:  50    }
    → current balance = 0 + 200 − 50 = 150   ← derived, and every step is evidence
```

**The core mechanics** (covered in depth in Module 13):
- **Events are immutable facts, in the past tense** — `PaymentAuthorised`, not `AuthorisePayment`. You never update or delete one; a mistake is corrected by appending a **compensating event**.
- **The event store is append-only**, ordered per aggregate stream.
- **Rehydration**: load the stream, fold the events to rebuild the aggregate.
- **Snapshots** avoid replaying thousands of events for a long-lived aggregate.
- **Projections** build read models from the stream — which is why Event Sourcing and CQRS pair so naturally.
- **Optimistic concurrency** via an expected stream version on append.

**Why it is compelling in financial services specifically:**
- **The audit trail is the system**, not a side-effect you have to remember to write. Every state change is recorded with its cause, actor and time — which is exactly what SOX, MiFID II and an internal audit function want, and it cannot drift from reality because it *is* reality.
- **Temporal queries** — "what was this position at 16:00 on Tuesday?" is a replay, not an archaeology project.
- **A ledger is already an event-sourced system.** Double-entry bookkeeping has been append-only immutable events since the fifteenth century; Event Sourcing is that idea in software. Making that connection lands well with a banking panel.
- **New read models over historical data** — a question nobody asked when the system was built can be answered by replaying from the beginning.
- **Debugging by replay** — reproduce the exact sequence that produced a bug.

**The costs, which are substantial:** schema/event **versioning** is a permanent obligation (those events must be readable in ten years); querying requires projections because you cannot ad-hoc query a stream; **eventual consistency** on every read model; GDPR erasure conflicts with immutability (the answer is **crypto-shredding** — encrypt personal data with a per-subject key and destroy the key); and the whole team must think in events. It is a significant commitment, and Q12 and Module 13 Q25 cover when it is worth it.

---

## Q12. Event Sourcing vs traditional CRUD?

| | **CRUD (state-oriented)** | **Event Sourcing** |
|---|---|---|
| Stores | **Current state** | **The sequence of changes** |
| Update | `UPDATE` — **overwrites and destroys** the prior value | `APPEND` — nothing is ever lost |
| History | Only if you build audit tables (which drift, and can be bypassed) | **Inherent and complete** |
| "Why is it this value?" | **Unanswerable** | Answered by reading the stream |
| Query | Direct SQL over current state | **Projections required** |
| Consistency | Strong, immediate | Strong within a stream; **eventual** on read models |
| Temporal queries | Effectively impossible | Natural — replay to a point in time |
| Storage | Small — one row per entity | **Large and growing** — every change, forever |
| Complexity | **Low, universally understood** | **High** — versioning, projections, snapshots, rebuilds |
| Fixing bad data | `UPDATE` it | **Append a correction** — the error remains visible, which is usually correct in finance |
| Team ramp-up | Immediate | Weeks, and needs discipline to sustain |

**The philosophical difference worth articulating:** CRUD stores **conclusions**; Event Sourcing stores **evidence**. In CRUD, `balance = 150` is asserted and the reasoning is gone. In Event Sourcing, the reasoning *is* the data and the balance is derived. In any domain where the reasoning is auditable, disputed, or regulated, that inversion is the whole value.

**The most under-appreciated consequence:** in CRUD, an `UPDATE` **destroys information you did not know you needed**. The business asks in 2028 "how many customers changed their address within 30 days of a chargeback?" — in a CRUD system the data no longer exists and the question is unanswerable at any price. In an event-sourced system it is a new projection over existing events. Events are the only design that lets you answer future questions with past data.

**When CRUD is the right answer — and it usually is:** reference data, configuration, user profiles, CMS content, anything where history is genuinely uninteresting and the cost of versioning and projections buys nothing. Do not event-source a country-code lookup table.

**When Event Sourcing earns its cost:** ledgers and accounts, order/payment lifecycles, trading and positions, insurance policies, regulatory-reporting sources, and any domain where **the sequence of changes is itself the business record**.

**The pragmatic middle ground, which is what I would usually propose:** event-source the **core domain only** — the ledger, the payment lifecycle — and keep everything else CRUD. Publish domain events from the CRUD services too, for integration purposes, without event-sourcing their storage. That gives you auditability and integration where it matters and simplicity everywhere else, which is almost always the right shape.

---

## Q13. What is API Gateway pattern?

The API Gateway is a **single entry point** that sits between clients and back-end services, handling cross-cutting concerns so services don't have to. The Azure Architecture Center decomposes it into **three** patterns, which is the precise way to answer:

| Pattern | Official summary |
|---|---|
| **Gateway Routing** | *"Route requests to multiple services by using a single endpoint."* |
| **Gateway Aggregation** | *"Use a gateway to aggregate multiple individual requests into a single request."* |
| **Gateway Offloading** | *"Offload shared or specialized service functionality to a gateway proxy."* |

```
                    ┌─────────────────────────────┐
   Clients ───────▶ │  API Gateway                │──▶ payments-service
                    │  • routing                  │──▶ accounts-service
                    │  • TLS termination          │──▶ customer-service
                    │  • authn / token validation │──▶ …
                    │  • rate limiting            │
                    │  • aggregation              │
                    └─────────────────────────────┘
```

**What belongs in it** (covered in Module 4 Q14): routing, TLS termination, **authentication** and token validation, rate limiting and throttling, request/response logging and correlation-ID injection, protocol translation (REST↔gRPC), response caching, API versioning, and CORS.

**What does not** (Module 4 Q15): **business logic**, domain validation, orchestration of business workflows, data transformation that encodes domain rules, and per-service authorisation decisions that need domain knowledge. The moment business rules enter the gateway, it becomes a shared component every team must change to ship a feature — a distributed monolith with a single choke point, and the exact thing microservices were meant to avoid.

**The trade-offs to state:**
- **It is a single point of failure** — so it must be highly available, multi-AZ, and horizontally scaled.
- **It adds a hop** — 1–30 ms depending on the implementation.
- **It can become a bottleneck for teams**, not just traffic, if every change requires a gateway change.
- **Versioning the gateway config** becomes its own release process.

**Implementations:** AWS API Gateway (managed, per-request pricing, rich features), an **ALB** (cheaper at volume, fewer features — Module 9 Q37), **YARP** (a .NET reverse proxy, if you want the gateway in your own stack), Kong, NGINX, Envoy, Azure API Management.

**Gateway vs service mesh** (Module 4 Q13): the gateway handles **north-south** traffic (clients → system); the mesh handles **east-west** (service ↔ service). They are complementary, not alternatives.

---

## Q14. What is BFF pattern?

**Per the Azure Architecture Center:** Backends for Frontends is *"Create separate backend services for specific frontend applications or interfaces."*

```
Web SPA ─────▶ Web BFF ────┐
Mobile app ──▶ Mobile BFF ─┼──▶ payments · accounts · customer · pricing
Partner API ─▶ Partner BFF ┘
```

**The problem it solves:** one general-purpose API serving several very different clients degrades into a compromise that serves none of them. The mobile client wants a small, aggregated payload over a high-latency link; the web SPA wants rich data and can make several calls; the partner integration wants a stable, versioned, conservative contract. A single API accumulates query parameters, optional fields and conditional logic until every client change risks breaking another.

**A BFF is owned by the front-end team** and is free to be exactly what that client needs — that ownership is the point, not the extra tier.

**What it does well:**
- **Aggregation** — one mobile call replaces six chatty round trips, which is the single largest latency win available on a mobile network.
- **Client-shaped payloads** — send the eight fields the screen renders, not the whole entity.
- **Client-specific auth** — cookie/session for the browser (with the token kept server-side, which is also the current OAuth guidance for SPAs), bearer tokens for mobile, mTLS + client credentials for partners.
- **Decoupled release cadence** — the mobile team ships a BFF change without coordinating with every downstream service team.

**Its costs:** **N BFFs to build and operate**, code duplication across them (resist the urge to "share" a common BFF library — that recreates the shared-API problem you were escaping), one more network hop, and a risk of business logic leaking in. A BFF should **aggregate, shape and adapt** — not decide.

**When to use it:** genuinely different client types with genuinely different needs, mobile clients where round trips are expensive, or separate front-end teams that need release autonomy. **When not to:** one client type; or as a rebranding of "an API layer" for its own sake.

**BFF vs API Gateway:** the gateway is **one shared** component doing cross-cutting concerns for everyone; a BFF is **one per client type** doing client-specific composition. Common production shape: gateway at the edge for TLS, authn and rate limiting, BFFs behind it for composition. **GraphQL is an alternative** to BFFs for the aggregation problem — one endpoint, each client requests exactly the fields it needs — at the cost of query-complexity management, caching difficulty and N+1 risk on the server (Module 11 Q11).

---

## Q15. What is Sidecar pattern?

**Per the Azure Architecture Center:** Sidecar is *"Deploy components into a separate process or container to provide isolation and encapsulation."* Its Well-Architected pillars are listed as **Security** and **Operational Excellence**.

The name comes from a motorcycle sidecar: attached to the main vehicle, sharing its journey, but a separate compartment.

```
┌──────────── Pod / host ─────────────┐
│  ┌──────────────┐  ┌─────────────┐  │
│  │ Application  │  │  Sidecar    │  │  shares: network namespace (localhost),
│  │ (your .NET   │◀▶│  (proxy,    │  │          lifecycle, volumes,
│  │  service)    │  │   agent)    │  │          and often the node's resources
│  └──────────────┘  └─────────────┘  │
└─────────────────────────────────────┘
```

**Why not just a library?** Because a sidecar is **language-agnostic, independently deployable and independently upgradable**. A shared library must be built for every language in the estate, and upgrading it means rebuilding and redeploying every service. A sidecar is upgraded by rolling the sidecar. In a polyglot organisation that difference is decisive.

**Real uses:**

| Sidecar | Purpose |
|---|---|
| **Envoy / Linkerd proxy** | Service mesh data plane — **mTLS**, retries, timeouts, circuit breaking, traffic shifting, telemetry (Q21) |
| **Log/metric collectors** (Fluent Bit, ADOT collector) | Ship telemetry without the app knowing where it goes |
| **Secrets agents** (Vault agent, Secrets Store CSI) | Fetch and refresh secrets outside the application |
| **`dotnet-monitor`** | On-demand dumps, traces and counters from a production .NET process |
| **Dapr** | Distributed-application building blocks — pub/sub, state, bindings — over HTTP/gRPC on localhost |
| **Config watchers / cache warmers** | Cross-cutting concerns with no business logic |

**Costs to state:** resource overhead **per pod** (a mesh proxy at ~50–100 MB across a thousand pods is real memory and real money), added latency on every hop (typically sub-millisecond but not zero), more moving parts to debug, and startup/shutdown ordering problems. Kubernetes addressed the ordering issue in v1.29 by modelling **sidecars as init containers with `restartPolicy: Always`**, which finally guarantees the sidecar starts before and outlives the app container (Module 10 Q2).

**Related patterns:** **Ambassador** (Q16) is a sidecar specialised for *outbound* calls; **Adapter/Envoy** is a sidecar that normalises the app's telemetry to a standard format. Sidecars are also how a **service mesh** is implemented — though ambient/sidecar-less meshes now exist precisely to avoid the per-pod overhead.

---

## Q16. What is Ambassador pattern?

**Per the Azure Architecture Center:** Ambassador is *"Create helper services that send network requests on behalf of a consumer service or application."* Its pillars are **Reliability** and **Security**.

An ambassador is a **sidecar specialised for outbound connectivity**: the application makes a simple local call, and the ambassador handles everything difficult about talking to the remote system.

```
┌──────── Pod ─────────┐
│ App ──▶ localhost ──▶│ Ambassador ──▶ external service
└──────────────────────┘     │
                             ├── retries with backoff and jitter
                             ├── circuit breaking
                             ├── timeouts
                             ├── TLS / mTLS, certificate handling
                             ├── service discovery and load balancing
                             └── metrics, tracing, logging
```

**Why it exists:** all of that resilience logic must otherwise be implemented **in every service, in every language**, and kept consistent. Getting retry-with-jitter, circuit breaking and connection pooling right once, in a proxy, is far more reliable than getting it right in nine codebases — and it lets you change a timeout policy without redeploying a single application.

**Where it is genuinely useful:**
- **Legacy or third-party integrations** — an ambassador terminates mTLS, handles a bank's certificate rotation, or speaks an awkward protocol, so the application makes a plain local HTTP call.
- **Polyglot estates** — one implementation of the resilience policy for all languages.
- **Adding resilience to code you cannot change** — a vendor binary or a legacy service gets circuit breaking and observability without modification.
- **Centralised egress policy** — every outbound call routed, logged and controlled in one place, which is a control auditors like.

**Ambassador vs Sidecar vs Service Mesh:** Ambassador is a *kind* of sidecar (outbound-focused); a **service mesh is essentially an ambassador plus an inbound proxy, deployed fleet-wide with a control plane**. If you already run a mesh, you have this pattern; a standalone ambassador is for the cases the mesh doesn't cover — a specific legacy protocol, or a workload outside the mesh.

**The .NET-specific counterpoint worth making:** in a homogeneous .NET estate, `Microsoft.Extensions.Http.Resilience` (Polly) gives you retries, jitter, circuit breaking, hedging and timeouts **in-process**, with no extra container, no extra hop and no extra memory. The ambassador's advantages — language independence, upgrade without redeploy, uniform policy — are worth the overhead in a polyglot organisation and often are not in a single-stack one. Being able to say *"in our stack, Polly is the better answer; in a polyglot platform, the ambassador is"* is a stronger response than describing the pattern approvingly.

---

## Q17. What is Bulkhead pattern?

**Per the Azure Architecture Center:** Bulkhead is *"Isolate elements of an application into pools so that if one fails, the others continue to function."*

The metaphor is a ship's hull, divided into watertight compartments: a breach floods one compartment, not the vessel.

**The failure it prevents — resource exhaustion cascading across unrelated features:**

```
WITHOUT bulkheads — one shared thread pool / connection pool
  Payment provider becomes slow (10 s responses)
  → all 200 threads block on payment calls
  → account lookups, statements, login: no threads left
  → the ENTIRE service is down because ONE dependency degraded

WITH bulkheads — partitioned pools
  Payments pool (50) saturates and starts rejecting fast
  → account lookups (50), statements (50), login (50) are UNAFFECTED
  → the service is degraded, not down
```

**Ways to partition, from coarse to fine:**

| Level | Mechanism |
|---|---|
| **Physical** | Separate services, clusters, or **AWS cells** (Q22) per tenant/domain |
| **Process** | Separate pods/instances per workload class, with resource limits |
| **Connection pool** | A separate `HttpClient` and connection pool per downstream dependency |
| **Concurrency** | `SemaphoreSlim` / Polly's `RateLimiter` capping in-flight calls per dependency |
| **Thread/queue** | Separate worker pools per queue or priority tier |

```csharp
// Polly bulkhead: at most 50 concurrent calls to the payment provider,
// 10 queued; everything beyond that is rejected immediately.
builder.Services.AddHttpClient<PaymentProviderClient>()
    .AddResilienceHandler("pp", b => b
        .AddConcurrencyLimiter(permitLimit: 50, queueLimit: 10)
        .AddCircuitBreaker(new() { FailureRatio = 0.5, SamplingDuration = TimeSpan.FromSeconds(30) })
        .AddTimeout(TimeSpan.FromSeconds(3)));
```

**The essential insight — and the reason this pattern is more important than it looks:** bulkheads convert **total failure into partial failure**. Without them, the blast radius of any dependency's degradation is the whole service. With them, it is one feature. That is the difference between "payments are delayed" and "the bank's app is down", and it is exactly the distinction a regulator asks about after an incident.

**Pair it with:** **timeouts** (so a call cannot occupy a bulkhead slot indefinitely), **circuit breakers** (so a known-bad dependency stops consuming slots at all), and **fallbacks** (so rejection degrades gracefully). Bulkhead alone limits the damage; the combination prevents it. See Module 4 Q30 and Module 6 Q27 for the implementation detail.

---

## Q18. What is Circuit Breaker pattern?

**Per the Azure Architecture Center:** Circuit Breaker *"Handle faults that might take a variable amount of time to fix when an application connects to a remote service or resource."*

Popularised by Michael Nygard in *Release It!*, it wraps a remote call in a state machine that stops calling a failing dependency.

```
        failure threshold exceeded
 ┌────────┐ ──────────────────────▶ ┌────────┐
 │ CLOSED │                          │  OPEN  │  fail fast, no call attempted
 │ (calls │ ◀────────────────────── │        │
 │  pass) │      trial succeeds      └────┬───┘
 └────────┘                               │ after break duration
      ▲                              ┌────▼──────┐
      └───────────────────────────── │ HALF-OPEN │ allow a limited trial
              trial fails → OPEN     └───────────┘
```

**Why it matters more than retries:** a retry assumes the fault is **transient and independent**. When a dependency is genuinely down or overloaded, retrying makes it worse (Module 11 Q27). The circuit breaker recognises a **sustained** fault and stops calling — which does two things at once:
1. **Protects the caller** — fails in microseconds instead of occupying a thread and a connection for a 30-second timeout, which is what prevents the caller's own resource exhaustion.
2. **Protects the callee** — removes load so it can actually recover. A struggling service that keeps receiving full traffic never recovers.

**Configuration, and the trade-off in each knob:** failure threshold (too sensitive → trips on noise; too lax → never protects), sampling window, break duration (too short → hammers a recovering service; too long → outage extended past recovery), and half-open trial volume. In .NET, `AddStandardResilienceHandler` gives you a sensible default pipeline of rate limiter → total timeout → retry → circuit breaker → attempt timeout, in that order — and the **order matters**: the retry must be *inside* the breaker so the breaker sees the outcome of the whole retry sequence, not each attempt.

**The part most candidates omit — the fallback.** An open circuit means you must decide what to return. Options: serve stale cached data, return a degraded response, queue the work for later, or fail explicitly with a clear error. **In a payment flow the right answer is usually to queue and return "pending", not to fail** — because a payment that cannot be confirmed is an ambiguous outcome that must be reconciled either way, and queuing keeps it in a known state.

**Where to put it:** in the client library (Polly), or in a **service-mesh/ambassador proxy** (Envoy outlier detection). Mesh-level breakers apply uniformly and need no code change; in-process breakers give finer, business-aware control over the fallback. Most mature platforms use both. See Module 4 Q29 and Module 6 Q26 for implementation.

---

## Q19. What is Strangler Fig pattern?

**Per the Azure Architecture Center:** Strangler Fig *"Incrementally migrate a legacy system by gradually replacing pieces of functionality with new applications and services."*

Named by Martin Fowler after the strangler fig, which grows around a host tree, gradually replacing it until the original is gone and the fig stands on its own.

```
Phase 1                  Phase 2                      Phase 3
 client                   client                       client
   │                        │                            │
   ▼                        ▼                            ▼
[ facade ]              [ facade ]                   [ facade ]
   │                    ╱        ╲                       │
   ▼                   ▼          ▼                      ▼
[ MONOLITH ]      [monolith]  [new svc]              [new services]
                                                    (monolith retired)
```

**The mechanism:** put a **facade/proxy** in front of the legacy system so clients are unaware of what is behind it. Then, one capability at a time: build it new, route that capability's traffic to the new implementation, verify, and remove the old code. Repeat until nothing routes to the legacy system, then delete it.

**Why it is almost always right versus a big-bang rewrite:**

| | **Big-bang rewrite** | **Strangler Fig** |
|---|---|---|
| Value delivered | **At the end, if ever** | **Continuously, from the first slice** |
| Risk | Enormous, concentrated in one cutover | Small, per slice, and each is reversible |
| Rollback | Effectively impossible | **Flip the route back** |
| Feature freeze on the legacy system | Usually required — and business rarely accepts it | Not required; both evolve |
| Learning | All assumptions validated at the end | Each slice teaches you before the next |
| Historical record | Notoriously high failure rate | The industry default for good reason |

**Doing it well — the parts that are actually hard:**

1. **Choose the first slice carefully.** Something valuable enough to prove the approach, small enough to finish, and loosely coupled enough to extract. A read-only capability is an ideal first slice: no write consistency problem.
2. **Data is the hard part, not code.** Options: the new service reads from the legacy database (fast, but couples you to its schema — acceptable *temporarily*), CDC-based synchronisation, dual writes (avoid — dual-write is exactly the problem the outbox exists to solve), or a clean cutover of ownership per capability. Decide per slice, and write down when the temporary coupling ends.
3. **An anti-corruption layer** at the boundary — Azure's ACL pattern, *"a façade or adapter layer between a modern application and a legacy system"* — so the legacy model's concepts do not leak into the new domain. Without it you rebuild the legacy design with new syntax.
4. **Route with feature flags and percentage-based traffic shifting**, so you can canary a slice and roll back instantly.
5. **Run both and compare** for critical logic — send traffic to both implementations, serve the legacy result, and **log the differences**. This "dark launch"/parity-testing step is how you migrate a pricing or interest-calculation engine without discovering the discrepancies in production.
6. **Actually delete the old code.** The failure mode of this pattern is a permanent hybrid: both systems running for years, two things to maintain, nobody willing to fund the last 10 %. **Set an explicit decommissioning date per slice and hold it**, or the migration never ends.

**Where the facade lives:** an API gateway, an ALB with path rules, a reverse proxy (YARP, NGINX), or an event router for asynchronous flows.

---

## Q20. What is Database-per-Service?

**Database-per-service** means each microservice **exclusively owns its data store** — no other service may read or write it directly; all access goes through that service's API or its published events. Covered in Module 4 Q7/Q8; here is the architectural framing.

```
┌────────────┐    ┌────────────┐    ┌────────────┐
│ Payments   │    │ Ledger     │    │ Customer   │
│ service    │    │ service    │    │ service    │
└─────┬──────┘    └─────┬──────┘    └─────┬──────┘
      │ ONLY owner       │ ONLY owner      │ ONLY owner
   ┌──▼──┐            ┌──▼──┐           ┌──▼──┐
   │ DB  │            │ DB  │           │ DB  │      ← no cross-database joins,
   └─────┘            └─────┘           └─────┘         no shared tables, ever
```

**Why it is non-negotiable for real microservices:** a shared database recreates every coupling microservices exist to remove. With a shared schema, a migration must be coordinated across teams, one service's query can lock another's writes, nobody can change a table without checking who else reads it, and independent deployment becomes a fiction. **Shared database = distributed monolith**, and it is the single most common reason a microservices migration fails to deliver.

**What "own" permits:** separate database *instances*, or (pragmatically) separate **schemas on a shared instance** with per-schema credentials and no cross-schema access. The logical boundary is what matters; the physical separation is a cost/isolation decision you can tighten later. Be explicit that a shared instance means a shared failure domain and shared noisy-neighbour risk.

**What it costs, and each has a named answer:**

| Cost | Answer |
|---|---|
| **No cross-service joins** | API composition, or a read model built from events (CQRS, Q8) |
| **No distributed ACID transactions** | **Saga with compensation** (Module 4 Q18–Q21) |
| **Dual-write problem** — write DB *and* publish event atomically | **Transactional outbox** (Module 4 Q22) |
| **Data duplication** across services | Accepted deliberately; each copy is a **read model**, not a second source of truth |
| **Eventual consistency** | A product decision, surfaced in the UX, not hidden |
| **Reporting across services** | A data lake / warehouse fed by events — never by querying service databases |
| **More databases to operate** | Managed services; the operational cost is real and should be stated |

**The polyglot-persistence upside:** because each service owns its store, each can choose the right one — Aurora PostgreSQL for the ledger, DynamoDB for idempotency keys and session state, OpenSearch for search, Redis for hot reads, S3 for documents (Module 9 Q31). That freedom is a genuine benefit, though it should be exercised sparingly — every additional data technology is another thing to operate, back up, patch and be paged about.

**The pragmatic transition:** during a strangler migration (Q19), a temporary shared database is acceptable **if** you name it as temporary, enforce a schema-per-service boundary immediately, and set a date for physical separation. Permanent "temporary" sharing is how a distributed monolith is born.

---

## Q21. What is Service Mesh?

A **service mesh** is a dedicated infrastructure layer that handles **service-to-service (east-west) communication**, moving cross-cutting network concerns out of application code and into a proxy fleet managed by a control plane.

```
        ┌──────────── Control plane (Istio/Linkerd) ────────────┐
        │  policy, identity/certificates, config, telemetry     │
        └───┬──────────────────┬──────────────────┬─────────────┘
            ▼                  ▼                  ▼
   ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
   │ Svc A │ proxy  │◀│ Svc B │ proxy  │▶│ Svc C │ proxy  │   ← data plane
   └────────────────┘ └────────────────┘ └────────────────┘
                all traffic flows through the proxies
```

**What it provides:**

| Capability | Detail |
|---|---|
| **Automatic mTLS** | Every service gets a workload identity (SPIFFE) and a rotating certificate; **all east-west traffic is encrypted and mutually authenticated with no application code**. This is usually the reason a bank adopts one |
| **L7 traffic management** | Canary and blue/green by percentage, header-based routing, mirroring/shadowing, fault injection |
| **Resilience** | Retries, timeouts, circuit breaking (outlier detection), rate limiting — uniformly, changeable without redeploy |
| **Observability** | Golden metrics, distributed traces and access logs for **every** call, automatically and consistently |
| **Authorization** | L7 policy — "service A may call `POST /payments` on service B, and nothing else" — which NetworkPolicy (L3/L4) cannot express (Module 10 Q26) |

**The cost, and it is real:** a sidecar proxy per pod (~50–100 MB memory and some CPU each — at 1,000 pods that is 50–100 GB of memory doing no business work), added latency per hop, a control plane to operate and upgrade, and a substantial new set of concepts and failure modes for the on-call engineer. A misconfigured mesh is a very confusing outage.

**The 2026 nuance worth raising:** **sidecar-less / ambient modes** (Istio ambient with ztunnel + waypoint proxies, Linkerd's lightweight micro-proxy, Cilium's eBPF-based mesh) exist specifically to remove the per-pod overhead — mTLS and L4 policy at the node level, with an L7 proxy only where needed. If a panel asks about mesh adoption today, the mature answer includes "and I'd evaluate ambient mode, because the sidecar tax was the main argument against adoption."

**When it is worth it:** many services (dozens+), polyglot stacks, a hard mTLS/zero-trust requirement, a need for uniform traffic policy and progressive delivery, and a platform team to own it.
**When it is not:** a handful of services, a homogeneous .NET estate where `Microsoft.Extensions.Http.Resilience` and OpenTelemetry already give you resilience and observability in-process, or no team to operate it. **Start with NetworkPolicies and library-based resilience; adopt a mesh when mTLS or L7 policy becomes a stated requirement** — Module 4 Q13 and Module 10 Q30.

---

## Q22. What is Cell-based architecture?

**Cell-based architecture** partitions a system into multiple **complete, independent, isolated instances of the whole stack** — *cells* — each serving a subset of users or tenants. It is the **bulkhead pattern applied at the system level**, and AWS uses it internally as a core availability technique. The Azure equivalent in the pattern catalogue is **Deployment Stamps**: *"Deploy multiple independent copies of application components, including data stores."*

```
                    ┌───── Cell router (thin, highly available) ─────┐
                    │  maps customer → cell; the ONLY shared thing   │
                    └──┬──────────────┬──────────────┬───────────────┘
                       ▼              ▼              ▼
                 ┌──────────┐   ┌──────────┐   ┌──────────┐
                 │  Cell 1  │   │  Cell 2  │   │  Cell 3  │
                 │ API+svc  │   │ API+svc  │   │ API+svc  │
                 │ database │   │ database │   │ database │   ← fully independent
                 │ cache    │   │ cache    │   │ cache    │      stacks
                 └──────────┘   └──────────┘   └──────────┘
                 customers A–H   customers I–P   customers Q–Z
```

**What it buys — and each of these is hard to get any other way:**

1. **Bounded blast radius.** A failure — a bad deploy, a poison record, a hot tenant, data corruption, a cache stampede — affects **one cell**, so `1/N` of customers. With 10 cells, a total cell failure is a 10 % incident rather than a 100 % one. This is the entire point.
2. **Safe, incremental deployment.** Deploy to one cell, observe, then proceed. A regression is caught at 10 % exposure, and rollback is a routing change. It is canary deployment with a genuine isolation boundary rather than a shared-fate one.
3. **Predictable scaling.** You scale by **adding cells**, each a known, tested quantity. Cell capacity is measured once and multiplied — which makes capacity planning arithmetic rather than extrapolation (Module 11 Q7).
4. **Noisy-neighbour containment.** One tenant's traffic spike consumes their cell's capacity, not everyone's.
5. **Tenant-specific placement** — a regulated or high-value customer can get a dedicated cell; data-residency requirements map naturally onto cells per Region.

**The hard parts:**
- **The cell router must be extremely simple and extremely reliable** — it is the one shared component, and therefore the one thing whose failure is global. Keep it thin (a mapping lookup and a route), version it conservatively, and prefer data-plane mechanisms over control-plane ones.
- **Cell migration** — moving a tenant between cells requires data migration and a routing cutover.
- **Cross-cell operations** are hard by design; if your domain needs frequent cross-tenant transactions, cells fit badly.
- **Cost and operational overhead** — N copies of everything, and per-cell headroom means lower average utilisation. **Cell size is the central trade-off:** smaller cells mean smaller blast radius and worse economics.
- **Fleet management** — you now operate N environments; this only works with strong automation and per-cell observability.

**Where it fits:** large multi-tenant SaaS, and any platform where availability requirements make a global blast radius unacceptable — which describes most systemically important financial infrastructure. It is a mature-scale pattern: do not build cells for three customers, but *do* design tenant identity and data partitioning early so cells remain possible later.

---

## Q23. How do you select an architecture pattern?

**Per the Azure Architecture Center's own guidance:** *"Choose a pattern based on the problem you need to solve, not the technology you want to use. Begin with a specific constraint or risk in your workload... A pattern is a good fit when its problem statement matches the challenge you face and when the trade-offs it introduces are ones you can accept."*

That is the whole answer, and everything below is how I operationalise it.

**1. Start from the driving quality attribute, not the pattern.** Patterns are answers; you need the question first. Which non-functional requirement is actually binding?

| Driver | Patterns it points to |
|---|---|
| **Availability / blast radius** | Bulkhead, Circuit Breaker, **Cells/Deployment Stamps**, multi-AZ, Queue-Based Load Levelling |
| **Read scalability** | CQRS, Materialised View, Cache-Aside, read replicas, CDN |
| **Write scalability** | Sharding, event-driven writes, partitioning |
| **Auditability / temporal queries** | **Event Sourcing** |
| **Team autonomy / independent deploy** | Microservices, Database-per-Service, BFF |
| **Domain complexity / longevity** | Clean/Hexagonal/Onion, DDD, Modular Monolith |
| **Legacy migration** | **Strangler Fig**, Anti-Corruption Layer |
| **Cross-cutting concerns in a polyglot estate** | Sidecar, Ambassador, Service Mesh, Gateway Offloading |
| **Overload / spiky traffic** | Throttling, Rate Limiting, Queue-Based Load Levelling, Competing Consumers |

**2. Name the trade-off you are accepting.** Every pattern trades something. CQRS trades consistency for scalability. Microservices trade simplicity for autonomy. Event Sourcing trades queryability for auditability. Caching trades freshness for latency. **If you cannot name what the pattern costs, you do not understand it well enough to adopt it** — and an interviewer will assume the same.

**3. Apply the constraints in order.**
- **Team**: size, skills, operational maturity, on-call capacity. This constrains more than anything technical.
- **Domain**: is the complexity real, or is this CRUD with ambition?
- **Scale**: what are the actual numbers? Design for 10× current load, not 1000×.
- **Regulatory**: audit, residency, availability, change control.
- **Time and money**: the perfect architecture delivered late is worse than the adequate one delivered now.

**4. Prefer the simplest thing that meets the requirement, and be able to say what would change your mind.** *"Modular monolith now; we extract the payments module when the payments team is independently staffed or when it needs separate scaling — whichever comes first."* That sentence is what senior architecture judgement sounds like: a decision, a rationale, and a named trigger for revisiting it.

**5. Patterns compose — and the docs say so explicitly:** Retry with Circuit Breaker; Queue-Based Load Levelling with Competing Consumers; Gateway Routing + Aggregation + Offloading behind one endpoint; Saga built on Compensating Transaction. Most real designs are five or six patterns working together, and the composition is where the skill is.

**6. Record the decision.** An **ADR** — context, options considered, decision, consequences — so that in two years someone can see *why*, not just *what*. In a regulated environment this is also change-management evidence.

**7. Know the anti-patterns.** The Azure catalogue maintains a companion antipatterns list, and the framing there is exactly right: *"Antipatterns often start as reasonable designs that work in testing or at low scale, but they degrade reliability or performance as load increases."* Recognising one in an existing system is often more valuable than adding a new pattern to a new one.

---

## Q24. How would you migrate a monolith to microservices?

A staged programme, not a project — and the first move is to challenge the premise.

**Step 0 — Confirm you should.** *"Why microservices?"* If the answer is "the monolith is slow to change", the cause might be poor modularity, a slow test suite, or a shared database — none of which microservices fix, and all of which they make harder. Valid drivers: teams that must deploy independently, components with genuinely different scaling or availability needs, or regulatory isolation. **If the drivers don't hold, a modular monolith (Q6) delivers most of the benefit at a fraction of the cost**, and saying so is a stronger answer than an enthusiastic migration plan.

**Step 1 — Establish the platform first.** Extracting services before you can operate them produces a distributed system you cannot debug. Prerequisites: CI/CD per service, containerisation, centralised structured logging, **distributed tracing with correlation IDs**, metrics and alerting, service discovery, secrets management, and an on-call model. This step is unglamorous and is where most migrations should spend their first quarter.

**Step 2 — Find the boundaries before writing any code.** Use **DDD**: event storming with domain experts to find bounded contexts (Module 4 Q4–Q5). Cross-check against reality: which tables are always written together; which modules change together in git history; which teams own what. **Boundaries follow the business and the team topology — never the technical layers** (Module 4 Q6). Getting this wrong is the single largest risk in the whole programme.

**Step 3 — Modularise inside the monolith first.** Before extracting anything, enforce module boundaries *in-process*: separate assemblies, `internal` visibility, **no cross-module database joins**, communication via published interfaces and in-process events, and architecture tests in CI. This is where you discover that your intended boundaries are wrong — at a cost of a refactor rather than a distributed rewrite.

**Step 4 — Put a facade in front (Strangler Fig, Q19).** An API gateway or reverse proxy routes all traffic, so clients never know what is behind it and routing changes are instant and reversible.

**Step 5 — Extract the first service, chosen deliberately.** Criteria: loosely coupled, clearly bounded, valuable, and preferably **read-mostly** so you avoid the write-consistency problem on your first attempt. Then:
1. Build the new service with its own database.
2. **Migrate data ownership** — CDC or backfill + sync; use a **transactional outbox** for events, never dual writes.
3. Route a small percentage of traffic through the facade; **shadow-run and compare results** before serving them.
4. Increase traffic; monitor; be ready to route back.
5. **Delete the old code.** This step is mandatory and is the one that gets skipped.

**Step 6 — Repeat, in order of value and risk.** Extract the components with the strongest driver first — the one needing independent scaling, or the one a separate team owns. Do not extract everything; some of the monolith may correctly remain a monolith forever.

**Step 7 — Handle the cross-cutting hard parts as they arise.**

| Problem | Answer |
|---|---|
| Distributed transactions | **Saga + compensation** (Module 4 Q17–Q21) |
| Atomic write + publish | **Outbox** (Module 4 Q22–Q23) |
| Duplicate delivery | **Idempotency** (Module 4 Q24–Q26) |
| Cross-service queries | API composition or **CQRS read models** |
| Shared reference data | Replicate via events; one owner, many read-only copies |
| Reporting | A data lake fed by events — **never** cross-service database queries |
| Legacy concepts leaking | **Anti-corruption layer** at the boundary |
| Cascading failure | Timeouts, retries with jitter, **circuit breakers, bulkheads** |

**Step 8 — Measure whether it worked.** Deployment frequency, lead time, change-failure rate, MTTR (the DORA metrics), plus incident blast radius and cost per transaction. If deployment frequency has not improved after extracting five services, the migration is not delivering its stated benefit and that should trigger a re-plan — not more extraction.

**The failure modes to name, because they are what actually happens:**
- **The distributed monolith** — services that must be deployed together, still sharing a database. Worse than the monolith in every dimension.
- **Over-splitting** — nano-services where a single business operation crosses eleven network hops.
- **The permanent hybrid** — migration stalls at 60 %, both systems run forever, nobody funds the finish. Prevent it with a per-slice decommissioning date and an owner.
- **Skipping the platform** — extracting services you cannot trace, deploy or monitor independently.

**The framing to close on:** this is an **organisational** change delivered through technical means. The architecture will end up mirroring the communication structure of the teams (Conway's Law), so if the team structure does not change, the architecture will not either — you will have distributed the monolith rather than decomposed it.

---

## References — official documentation

| Topic | Source |
|---|---|
| Azure Architecture Center — Cloud Design Patterns catalogue | https://learn.microsoft.com/en-us/azure/architecture/patterns/ |
| Ambassador pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/ambassador |
| Anti-Corruption Layer pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer |
| Backends for Frontends pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends |
| Bulkhead pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead |
| Circuit Breaker pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker |
| CQRS pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs |
| Deployment Stamps pattern (cells) | https://learn.microsoft.com/en-us/azure/architecture/patterns/deployment-stamp |
| Event Sourcing pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing |
| Gateway Aggregation / Offloading / Routing | https://learn.microsoft.com/en-us/azure/architecture/patterns/gateway-routing |
| Materialized View pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view |
| Saga pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/saga |
| Sharding pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/sharding |
| Sidecar pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/sidecar |
| Strangler Fig pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig |
| Throttling / Rate Limiting / Queue-Based Load Levelling | https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling |
| Antipatterns for cloud applications | https://learn.microsoft.com/en-us/azure/architecture/antipatterns/ |
| Architecture styles (n-tier, microservices, event-driven) | https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/ |
| Microsoft Learn — .NET microservices architecture e-book | https://learn.microsoft.com/en-us/dotnet/architecture/microservices/ |
| Microsoft Learn — common web application architectures (Clean Architecture) | https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures |
| Microsoft Learn — DDD-oriented microservice design | https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ |
| Microsoft Learn — modernize with the Strangler Fig pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig |
| Cockburn — Hexagonal Architecture (Ports and Adapters) | https://alistair.cockburn.us/hexagonal-architecture/ |
| Palermo — The Onion Architecture | https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/ |
| Martin — The Clean Architecture | https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html |
| Fowler — StranglerFigApplication | https://martinfowler.com/bliki/StranglerFigApplication.html |
| Fowler — CQRS | https://martinfowler.com/bliki/CQRS.html |
| Fowler — Event Sourcing | https://martinfowler.com/eaaDev/EventSourcing.html |
| Fowler — BoundedContext | https://martinfowler.com/bliki/BoundedContext.html |
| microservices.io — pattern catalogue (Richardson) | https://microservices.io/patterns/index.html |
| AWS Prescriptive Guidance — Cloud design patterns | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/introduction.html |
| AWS Well-Architected — Reliability pillar | https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html |
| AWS whitepaper — Reducing the scope of impact with cell-based architecture | https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/reducing-scope-of-impact-with-cell-based-architecture.html |
| AWS Prescriptive Guidance — Strangler fig pattern | https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-decomposing-monoliths/strangler-fig.html |
| AWS Prescriptive Guidance — transactional outbox | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html |
| Istio — ambient mode | https://istio.io/latest/docs/ambient/overview/ |
| Linkerd documentation | https://linkerd.io/2/overview/ |

---

**Previous:** [11 — Performance Engineering](./11-Performance-Engineering.md) | **Next:** [13 — Event Sourcing](./13-Event-Sourcing.md)
