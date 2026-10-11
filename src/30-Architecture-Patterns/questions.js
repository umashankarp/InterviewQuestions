(function (r) {
registerTopic('30-architecture-patterns', {
related: ['32-clean-architecture', '33-hexagonal-architecture', '31-domain-driven-design'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['quality-attributes', 'architecture-definition', 'trade-offs'],
  q: r`What is software architecture, really? Explain quality attributes, architecturally significant requirements, and why "it depends" must be followed by a trade-off analysis.`,
  a: r`**Architecture** is the set of decisions that are **expensive to change later** and that shape how a system meets its **quality attributes**: structure (components and their boundaries), communication (sync, async), data ownership, deployment topology, and the constraints teams work within. Grady Booch's line fits: architecture represents the significant design decisions, where significance is measured by cost of change.

**Quality attributes** (ISO/IEC 25010 and common practice): performance efficiency (latency, throughput), availability and resilience, scalability, security, maintainability and modifiability, testability, deployability, observability/operability, interoperability, usability, cost efficiency, compliance and auditability.

**Architecturally significant requirements (ASRs)**: requirements that drive structure. Usually non-functional and specific:
- "Authorise card payments in under 300 ms p99 at 3,000 TPS peak."
- "Recover payment processing within 15 minutes after a region failure, losing at most 5 seconds of data."
- "Keep EU customer data within the EU."
- "Deploy each product area independently, several times a day."
Vague requirements ("must be scalable") are useless until quantified as **quality attribute scenarios**: source, stimulus, environment, artefact, response, response measure.

**Trade-offs are the core**: attributes conflict — consistency vs availability under partitions, latency vs durability, security controls vs usability, flexibility vs simplicity, cost vs resilience. A senior answer never stops at "it depends"; it names **what it depends on**, the options, and the consequences of each, then recommends one for this context.

**Architecture is also socio-technical**: team structure, skills, organisational constraints, budget and time shape what is feasible (Conway's law). The best architecture for a 6-person team differs from that for 300 engineers.`,
  code: r`~~~text
Quality attribute scenario (availability)
Source:      AWS Availability Zone
Stimulus:    complete failure of one AZ during peak (3,000 TPS)
Environment: normal operations, business hours
Artefact:    card authorisation service
Response:    traffic served from remaining AZs without manual action
Measure:     < 0.1% failed authorisations, recovery < 60 s, no data loss

Quality attribute scenario (modifiability)
Stimulus:    product adds a new payment method (e.g., account-to-account)
Response:    implemented without changing the authorisation core
Measure:     delivered in < 4 weeks by one team, no coordinated release with other teams
~~~`,
  dia: r`flowchart LR
  BIZ[Business goals + constraints] --> ASR[Architecturally significant requirements]
  ASR --> QAS[Quality attribute scenarios - measurable]
  QAS --> OPT[Options: styles, patterns, technologies]
  OPT --> TO[Trade-off analysis]
  TO --> DEC[Decision + ADR]
  DEC --> FIT[Fitness functions verify over time]`,
  pts: [r`Architecture = significant, expensive-to-change decisions shaping quality attributes.`, r`Quantify quality attributes as scenarios with response measures.`, r`ASRs, usually non-functional, drive structure.`, r`Attributes conflict; name what "it depends" on and recommend.`, r`Architecture is socio-technical: teams, skills, budget shape it.`],
  ex: r`A payments RFP said "highly available"; turning it into scenarios (AZ loss, PSP outage, region loss with RTO 15 min) showed the team needed multi-AZ static stability and PSP failover, not the active-active multi-region design first proposed.`,
  fu: [r`How do you elicit quality attributes from business stakeholders?`, r`Which quality attributes most often conflict in payment systems?`],
  pit: [r`Unquantified "-ilities".`, r`Answering "it depends" without the analysis.`, r`Ignoring team and organisational constraints.`] },

{ id: 'q2', level: 'Basic', tags: ['architectural-styles', 'selection', 'comparison'],
  q: r`Compare the main architectural styles — layered, modular monolith, microservices, event-driven, serverless, space-based, microkernel — and explain how you select one for a given system.`,
  a: r`| Style | Strengths | Weaknesses | Fits |
|---|---|---|---|
| **Layered (n-tier)** | simple, familiar, good for small apps | changes cut across layers; tends to a big ball of mud; one deployable | small/medium CRUD apps, internal tools |
| **Modular monolith** | strong module boundaries, one deployable, simple ops, transactions | needs discipline to keep boundaries; scales as one unit | most new products and mid-size teams |
| **Microservices** | independent deployability and scaling, team autonomy, fault isolation | distributed-system complexity, data consistency, ops cost | large orgs with many teams and clear domain boundaries |
| **Event-driven** | loose coupling, scalability, responsiveness, audit trails | eventual consistency, harder debugging and ordering | reactive workflows, integrations, high-volume streams |
| **Serverless** | no servers to manage, scale to zero, pay per use | cold starts, limits, vendor lock-in, harder local testing | spiky/event workloads, glue, small teams |
| **Space-based** | extreme elasticity via in-memory grids, removes DB bottleneck | complex, costly, data consistency/replication challenges | ticketing, auctions, sudden massive spikes |
| **Microkernel (plugin)** | extensible core with plug-ins | plugin contract design; versioning | product platforms, rules engines, IDEs |

Styles combine: a modular monolith publishing events; microservices with serverless functions for glue; a microkernel inside a service.

**Selection process**
1. Identify **ASRs and top 3 quality attributes** (for example: deployability, scalability, consistency).
2. Consider **constraints**: team size and skills, organisation (number of teams), time to market, budget, regulatory requirements, existing estate.
3. Rate candidate styles against the attributes (a style characteristics matrix, as in *Fundamentals of Software Architecture*), then validate with key scenarios.
4. Prefer the **simplest style that meets the requirements**, keep an evolution path (modular monolith → extract services when justified).
5. Record the decision and revisit triggers in an ADR.

**Common mistake**: choosing microservices because large tech companies use them, without the organisational scale, platform maturity or domain clarity that make them pay off.`,
  code: r`~~~text
Style selection matrix (1 = poor, 5 = excellent) for "merchant onboarding portal", 3 teams
Attribute (weight)        Layered  Modular monolith  Microservices  Serverless
Deployability (20)           2           3                5              4
Simplicity / cost (25)       5           4                2              3
Scalability (10)             2           3                5              5
Consistency (20)             4           5                2              2
Team autonomy (15)           2           4                5              3
Operability (10)             4           4                2              3
Weighted score              3.3         3.95             3.35           3.15
Decision: modular monolith, revisit if > 6 teams or if onboarding volume grows 10x
~~~`,
  dia: r`flowchart TD
  Q[New system] --> ASR[Top quality attributes + constraints]
  ASR --> T{Many teams needing independent deploys?}
  T -->|no| MM[Modular monolith - default]
  T -->|yes, clear domains, mature platform| MS[Microservices]
  ASR --> EV{Event-heavy, reactive flows?}
  EV -->|yes| EDA[Add event-driven integration]
  ASR --> SP{Spiky, event-triggered, small scope?}
  SP -->|yes| SL[Serverless components]`,
  pts: [r`Each style trades simplicity, deployability, scalability and consistency differently.`, r`Styles combine within one system.`, r`Select from quality attributes and constraints, not fashion.`, r`Prefer the simplest style with an evolution path.`, r`Record decisions and revisit triggers in ADRs.`],
  ex: r`A 12-engineer fintech chose a modular monolith over the 15 microservices first sketched; it shipped in 5 months and later extracted only the payment-processing module as a service when volume demanded it.`,
  fu: [r`What signals would make you move from modular monolith to microservices?`, r`When is a layered architecture still the right answer?`],
  pit: [r`Microservices by default.`, r`Choosing without naming the driving quality attributes.`, r`Ignoring team size and platform maturity.`] },

{ id: 'q3', level: 'Basic', tags: ['layered-architecture', 'n-tier', 'sinkhole'],
  q: r`Explain the layered (n-tier) architecture: layers and their responsibilities, closed versus open layers, the architecture sinkhole anti-pattern, and the classic problems in .NET applications built this way.`,
  a: r`**Typical layers**
1. **Presentation**: controllers/minimal APIs, Razor/Blazor UI, Angular/React frontends (in a separate deployable).
2. **Business/application**: services implementing use cases and business rules.
3. **Persistence/data access**: repositories, EF Core DbContext, queries.
4. **Database**.

**Closed vs open layers**
- **Closed**: a request must pass through each layer in order (presentation → business → persistence). Provides **layers of isolation**: changing the persistence technology does not affect presentation.
- **Open**: a layer may be bypassed (for example a shared services layer). Openness should be deliberate and documented, or layering erodes.

**Strengths**: simple to understand, natural separation of technical concerns, familiar to most developers, fine for small and medium applications.

**Weaknesses and anti-patterns**
- **Architecture sinkhole**: requests pass through layers that do nothing but forward calls (controller → service → repository with no logic). Some is fine; if most requests are pass-through, the layering adds cost without value (an "80/20" rule of thumb is often cited).
- **Technical partitioning** instead of domain partitioning: a feature change touches every layer folder ("Controllers", "Services", "Repositories") — high change cost, poor cohesion by business capability.
- **Anaemic domain model**: entities as data bags, logic scattered in services.
- **Database-centric design**: the schema drives everything; business layer depends on EF entities and the database.
- **Big ball of mud over time**: without enforced boundaries, everything references everything.
- Scales and deploys as one unit.

**Evolution**: organise by **feature/module first** (vertical slices or modules), apply layering inside modules where it helps, invert dependencies so the domain does not depend on infrastructure (Clean/Hexagonal architecture), and enforce boundaries with architecture tests.`,
  code: r`~~~csharp
// Sinkhole: every layer just forwards - three classes, zero added value
public class AccountsController(IAccountService svc) : ControllerBase
{
    [HttpGet("{id}")] public Task<AccountDto> Get(Guid id) => svc.GetAsync(id);
}
public class AccountService(IAccountRepository repo) : IAccountService
{
    public Task<AccountDto> GetAsync(Guid id) => repo.GetAsync(id);      // no business logic
}

// Feature-oriented alternative for simple reads: one cohesive slice, no pass-through layers
public static class GetAccount
{
    public static void Map(IEndpointRouteBuilder app) =>
        app.MapGet("/accounts/{id:guid}", async (Guid id, AppDbContext db, CancellationToken ct) =>
            await db.Accounts.AsNoTracking().Where(a => a.Id == id)
                .Select(a => new AccountDto(a.Id, a.Iban, a.Balance)).SingleOrDefaultAsync(ct)
            is { } dto ? Results.Ok(dto) : Results.NotFound());
}
~~~`,
  dia: r`flowchart TB
  P[Presentation: controllers / UI] --> B[Business: services, rules]
  B --> D[Persistence: repositories, EF Core]
  D --> DB[(Database)]
  S[Shared services - open layer] -.bypass allowed.-> D
  P -.sinkhole: pass-through calls.-> D`,
  pts: [r`Layers separate presentation, business, persistence, database.`, r`Closed layers isolate change; open layers must be deliberate.`, r`Sinkhole: layers that only forward calls add cost.`, r`Technical partitioning spreads features across layers; prefer domain/feature partitioning.`, r`Evolve with modules, dependency inversion and enforced boundaries.`],
  ex: r`A loans application had 300 service classes that only forwarded to repositories; reorganising by feature with vertical slices removed a third of the code and made changes local to one folder.`,
  fu: [r`How would you enforce that the presentation layer never touches EF Core directly?`, r`When is a pass-through layer still justified?`],
  pit: [r`Treating layers as the only form of modularity.`, r`Anaemic domain models with logic in services.`, r`Letting the database schema drive the whole design.`] },

{ id: 'q4', level: 'Basic', tags: ['monolith', 'modular-monolith', 'microservices'],
  q: r`Monolith, modular monolith or microservices for a new product? Explain what each really means, the decisive factors, and the cost of getting it wrong in either direction.`,
  a: r`**Definitions**
- **Monolith (unstructured)**: one deployable with weak internal boundaries; modules share data and call each other freely.
- **Modular monolith**: one deployable, but internally split into **modules aligned to business capabilities** with explicit public APIs, private internals and owned data (separate schemas); boundaries enforced by tooling.
- **Microservices**: independently deployable services, each owning its data, communicating over the network, typically owned by separate teams.

**Decisive factors**
| Factor | Favours modular monolith | Favours microservices |
|---|---|---|
| Team count | 1-4 teams | many teams needing independent release cadence |
| Domain clarity | still discovering boundaries | stable, well-understood boundaries |
| Scaling needs | uniform load | parts with very different scale/latency/availability needs |
| Platform maturity | limited CI/CD, observability, on-call | mature platform, automation, SRE practices |
| Consistency | many cross-module transactions | business tolerates eventual consistency between areas |
| Compliance isolation | not required | need to isolate PCI scope or regulated components |

**Cost of getting it wrong**
- **Microservices too early**: distributed monolith — services that must deploy together, chatty synchronous calls, distributed transactions, duplicated infrastructure, slow delivery and high operational cost; boundaries drawn before understanding the domain are expensive to move.
- **Monolith too long**: one deployable that many teams fight over (merge conflicts, release trains), cannot scale parts independently, a failure in one area takes everything down, technology upgrades require big-bang efforts.

**Pragmatic path**: start with a **modular monolith** with strict boundaries (separate schemas, internal events, architecture tests). Extract a module into a service when there is a concrete driver (team autonomy, scaling, isolation, different technology). Good modules make extraction cheap; bad modules make both architectures painful.`,
  code: r`~~~csharp
// Modular monolith: each module registers itself and exposes only a public contract
public interface IPaymentsModule                       // Payments.Contracts assembly (public)
{
    Task<PaymentResult> AuthoriseAsync(AuthoriseCommand cmd, CancellationToken ct);
}

// Payments module internals are 'internal' and own their schema
internal sealed class PaymentsDbContext(DbContextOptions<PaymentsDbContext> o) : DbContext(o)
{
    protected override void OnModelCreating(ModelBuilder b) => b.HasDefaultSchema("payments");
}

// Program.cs
builder.Services.AddPaymentsModule(builder.Configuration);    // registers internals + IPaymentsModule
builder.Services.AddOnboardingModule(builder.Configuration);  // Onboarding calls IPaymentsModule, never PaymentsDbContext
~~~`,
  dia: r`flowchart LR
  subgraph MM[Modular monolith - one deployable]
    ON[Onboarding module] -->|public API / in-process events| PAY[Payments module]
    PAY --> SP[(schema payments)]
    ON --> SO[(schema onboarding)]
  end
  PAY -.extract when justified.-> SVC[Payments service + own DB]`,
  pts: [r`Modular monolith: one deployable with enforced, capability-aligned modules and owned data.`, r`Microservices pay off with many teams, clear domains, divergent scaling and a mature platform.`, r`Too-early microservices create distributed monoliths.`, r`Too-late extraction creates contention and coupled releases.`, r`Start modular, extract with concrete drivers.`],
  ex: r`A neobank started with 40 microservices and 8 engineers; release coordination consumed most of their time. Consolidating into a modular monolith with 6 modules doubled delivery speed, and two modules were later extracted for scale.`,
  fu: [r`How do you keep a modular monolith from decaying into a ball of mud?`, r`What makes a module easy to extract later?`],
  pit: [r`Equating "monolith" with "bad".`, r`Microservices sharing one database.`, r`Extracting services without a driver.`] },

{ id: 'q5', level: 'Basic', tags: ['coupling', 'cohesion', 'connascence'],
  q: r`Define coupling and cohesion precisely. Explain afferent and efferent coupling, temporal, deployment and data coupling between services, and connascence as a vocabulary for coupling strength.`,
  a: r`**Cohesion**: how strongly the elements inside a module belong together (changing for the same reasons). High cohesion = a module does one coherent job (for example "payment authorisation" rather than "utilities").

**Coupling**: how much a module depends on others. Some coupling is necessary; the goal is **loose coupling between modules and high cohesion within them**, so most changes stay local.

**Metrics**
- **Afferent coupling (Ca)**: how many modules depend on this one (responsibility — changes affect many).
- **Efferent coupling (Ce)**: how many modules this one depends on (fragility).
- **Instability** I = Ce / (Ca + Ce): 0 = stable (many dependents, few dependencies), 1 = unstable. Stable modules should be abstract (interfaces/contracts) — Robert Martin's stable abstractions principle.

**Coupling types between services**
- **Temporal coupling**: A needs B to be available at the same time (synchronous calls). Reduce with asynchronous messaging, caching, or designing to degrade.
- **Deployment coupling**: services must be deployed together (shared libraries with breaking changes, lockstep schema changes) — a distributed monolith signal.
- **Data coupling**: shared databases or shared schemas; one team's schema change breaks another.
- **Semantic/domain coupling**: shared understanding of a concept (a "Customer" model shared everywhere).
- **Implementation coupling**: depending on internal details rather than a contract.
- **Location coupling**: hard-coded endpoints.

**Connascence** (Meilir Page-Jones): two components are connascent if a change in one requires a change in the other. Weaker to stronger:
- **Static**: name → type → meaning (magic values) → position (argument order) → algorithm (both sides must use the same hashing/encryption).
- **Dynamic**: execution order → timing → values (must change together) → identity (must reference the same instance).
Rules: prefer weaker forms, keep strong connascence **inside** a module, reduce degree (how many components) and increase locality.

**Practical use**: architecture reviews ask "what must change together, and are those things in the same module/team?"`,
  code: r`~~~csharp
// Connascence of meaning (magic values) across services: both sides must agree what "3" means
public record PaymentStatusChanged(Guid PaymentId, int Status);      // 3 = settled? 4 = refunded?

// Weaker: connascence of name/type - an explicit, versioned contract
public enum PaymentStatus { Pending = 0, Authorised = 1, Settled = 2, Refunded = 3 }
public record PaymentStatusChangedV1(Guid PaymentId, PaymentStatus Status, DateTimeOffset OccurredAt);

// Connascence of position: easy to swap two decimals silently
public Fee Calculate(decimal amount, decimal rate) => new(amount * rate);
// Weaker: named, typed parameters
public Fee Calculate(Money amount, FeeRate rate) => new(amount.Value * rate.Value);
~~~`,
  dia: r`flowchart LR
  subgraph HighCohesion[Payments module - high cohesion]
    A[Authorise] --- C[Capture]
    C --- R[Refund]
  end
  HighCohesion -->|contract, async events| LED[Ledger module]
  HighCohesion -.shared DB = data coupling.-> SHARED[(Shared tables)]
  LED -.shared DB.-> SHARED`,
  pts: [r`Cohesion = belongs together; coupling = depends on others.`, r`Afferent, efferent coupling and instability guide where abstractions belong.`, r`Watch temporal, deployment, data and semantic coupling between services.`, r`Connascence ranks coupling strength; keep strong forms local.`, r`Ask what must change together and whether it lives together.`],
  ex: r`Two services exchanged an integer status code; when one team added a new status, the other team's service misclassified refunds as settlements. An explicit, versioned enum contract removed the connascence of meaning.`,
  fu: [r`Is temporal coupling always bad?`, r`How would you measure coupling in a .NET solution?`],
  pit: [r`Calling every dependency "coupling" without distinguishing types.`, r`Shared domain models across services.`, r`Utility modules with low cohesion.`] },

{ id: 'q6', level: 'Basic', tags: ['c4-model', 'documentation', '4plus1', 'diagrams'],
  q: r`How do you document and communicate architecture? Explain the C4 model, the 4+1 view model, diagrams as code, and what documentation is actually worth maintaining.`,
  a: r`**C4 model** (Simon Brown): hierarchical diagrams for different audiences.
1. **System context**: the system, its users and external systems (PSPs, core banking, identity provider) — for everyone, including executives.
2. **Container**: deployable/runnable units (SPA, API, worker, database, message broker) and how they communicate — for architects, developers, ops.
3. **Component**: major components inside a container — for developers of that container.
4. **Code**: classes (usually generated or omitted).
Supplementary: **deployment** diagrams (where containers run: regions, clusters), **dynamic** diagrams (sequence of a key flow).

**4+1 view model** (Kruchten): logical, development, process, physical views + scenarios tying them together — useful to remember that one diagram cannot show everything.

**Diagrams as code**: Structurizr DSL, Mermaid, PlantUML stored in the repository — versioned, reviewed in PRs, regenerated consistently; avoids stale images in wikis.

**What is worth maintaining (keep it lean)**
- C4 context and container diagrams per system (rarely change, high value).
- **ADRs** for significant decisions (why, not just what).
- Key **quality attribute scenarios** and how the design meets them.
- Interface contracts (OpenAPI, AsyncAPI, protobuf) — generated or validated in CI.
- Runbooks and operational docs for production systems.
- A short "architecture overview" README: purpose, constraints, main flows, where to start.

Avoid exhaustive component/class diagrams by hand — they go stale. Prefer generating what can be generated (dependency graphs, API docs) and documenting intent and decisions.

**Communicating**: tailor to the audience (executives: context and risks; engineers: containers and flows), use consistent notation with legends, and tell the story of a key scenario (a payment's journey) rather than presenting a box-and-arrow wall.`,
  code: r`~~~text
workspace "Payments Platform" {
  model {
    merchant = person "Merchant" "Accepts card payments"
    psp      = softwareSystem "PSP / Acquirer" "External card processing" "External"
    payments = softwareSystem "Payments Platform" {
      spa    = container "Merchant Portal" "Angular SPA" "TypeScript"
      api    = container "Payments API" "Authorise, capture, refund" ".NET 8 / ASP.NET Core"
      ledger = container "Ledger Service" "Double-entry postings" ".NET 8"
      db     = container "Payments DB" "Payments, outbox" "PostgreSQL" "Database"
      broker = container "Event Broker" "Domain events" "Kafka" "Queue"
    }
    merchant -> spa "Uses"
    spa -> api "Calls" "HTTPS/JSON"
    api -> psp "Authorises payments" "HTTPS"
    api -> db "Reads/writes"
    api -> broker "Publishes PaymentCaptured"
    broker -> ledger "Delivers events"
  }
  views { container payments { include * autolayout lr } }
}
~~~`,
  dia: r`flowchart LR
  M[Merchant] --> SPA[Merchant Portal - Angular SPA]
  SPA -->|HTTPS JSON| API[Payments API - .NET 8]
  API -->|HTTPS| PSP[PSP / Acquirer - external]
  API --> DB[(Payments DB - PostgreSQL)]
  API -->|PaymentCaptured| K[[Kafka]]
  K --> LED[Ledger Service]`,
  pts: [r`C4: context, container, component, code — plus deployment and dynamic views.`, r`One diagram cannot show everything (4+1 reminder).`, r`Diagrams as code in the repo stay current and reviewable.`, r`Maintain context/container diagrams, ADRs, scenarios, contracts, runbooks.`, r`Tailor to the audience and tell scenario stories.`],
  ex: r`A bank replaced 80 stale Visio diagrams with Structurizr DSL in each repo plus ADRs; onboarding engineers reported understanding the payments flow in a day instead of a week.`,
  fu: [r`What would you show a regulator versus a new developer?`, r`How do you keep diagrams in sync with reality?`],
  pit: [r`Box-and-arrow diagrams without legends or labels.`, r`Hand-maintained class diagrams.`, r`Documenting what without why.`] },

{ id: 'q7', level: 'Intermediate', tags: ['modular-monolith', 'dotnet', 'boundaries', 'architecture-tests'],
  q: r`Design a modular monolith in .NET: module structure, public contracts versus internals, data ownership per module, inter-module communication (in-process calls and events), and enforcing boundaries automatically.`,
  a: r`**Module structure** (per business capability: Payments, Onboarding, Ledger, Notifications)
- {{Module.Contracts}}: public interfaces, DTOs, integration events — the only assembly other modules reference.
- {{Module.Core}} / internals: domain model, application services, infrastructure — {{internal}} types.
- A host project composes modules ({{AddPaymentsModule()}}), maps endpoints, and wires infrastructure.

**Data ownership**
- Each module owns its tables in a **separate schema** (or separate database) with its own DbContext and migrations.
- **No cross-module joins or foreign keys**; modules access others' data only through their contracts or through events and local read models. This keeps extraction possible.

**Communication**
- **Synchronous in-process calls** through contract interfaces for queries/commands that need immediate answers (cheap, no network).
- **Integration events** for side effects in other modules ("PaymentCaptured" → Ledger posts entries, Notifications sends receipt). Use an **outbox** per module even in-process, so events are not lost if the process crashes after commit; an in-process dispatcher or a broker delivers them.
- Avoid a shared "Common" project that becomes a dumping ground; share only true primitives (Money, Result types).

**Enforcing boundaries**
- {{internal}} visibility by default; contracts public.
- **Architecture tests** (NetArchTest, ArchUnitNET) in CI: modules may not reference other modules' internals; domain does not reference infrastructure.
- Separate DbContexts with schema-restricted database users per module (database-level enforcement).
- Code ownership (CODEOWNERS) per module.

**Benefits**: single deployment and transactions within a module, simple operations, low latency; clear seams for later extraction into services when justified.`,
  code: r`~~~csharp
// Architecture test (NetArchTest): Onboarding may use Payments.Contracts but never Payments internals
[Fact]
public void Onboarding_does_not_depend_on_payments_internals()
{
    var result = Types.InAssembly(typeof(OnboardingModule).Assembly)
        .ShouldNot().HaveDependencyOnAny("Payments.Core", "Payments.Infrastructure")
        .GetResult();
    Assert.True(result.IsSuccessful, string.Join(", ", result.FailingTypeNames ?? []));
}

// Integration event published via the module's outbox, handled by another module
public sealed record PaymentCaptured(Guid PaymentId, Guid MerchantId, long AmountMinor, string Currency);

internal sealed class PostLedgerEntriesOnPaymentCaptured(LedgerDbContext db) : IIntegrationEventHandler<PaymentCaptured>
{
    public async Task HandleAsync(PaymentCaptured e, CancellationToken ct)
    {
        if (await db.Postings.AnyAsync(p => p.SourceEventId == e.PaymentId, ct)) return;   // idempotent
        db.Postings.AddRange(LedgerEntries.For(e));
        await db.SaveChangesAsync(ct);
    }
}
~~~`,
  dia: r`flowchart LR
  subgraph HOST[Host - one deployable]
    ONB[Onboarding module] -->|IPaymentsModule contract| PAY[Payments module]
    PAY -->|outbox: PaymentCaptured| BUS[In-process / broker dispatcher]
    BUS --> LED[Ledger module]
    BUS --> NOT[Notifications module]
  end
  PAY --> S1[(schema payments)]
  LED --> S2[(schema ledger)]
  ONB --> S3[(schema onboarding)]`,
  pts: [r`Modules per capability with public contracts and internal implementations.`, r`Each module owns its schema; no cross-module joins or FKs.`, r`In-process calls for queries; integration events with an outbox for side effects.`, r`Enforce with internal visibility, architecture tests, schema-restricted DB users.`, r`Clear seams make later service extraction cheap.`],
  ex: r`A lending platform built as a modular monolith extracted its Payments module into a service in three weeks because it already had its own schema, contracts and outbox — no shared tables to untangle.`,
  fu: [r`Do you need a message broker inside a modular monolith?`, r`How do you handle reporting that needs data from several modules?`],
  pit: [r`A shared Common project holding domain models.`, r`Cross-module foreign keys and joins.`, r`Boundaries enforced only by convention.`] },

{ id: 'q8', level: 'Intermediate', tags: ['event-driven', 'broker-topology', 'mediator-topology', 'event-types'],
  q: r`Event-driven architecture as a style: event notification versus event-carried state transfer versus event sourcing, broker versus mediator topologies, and the trade-offs you accept.`,
  a: r`**Event types (Martin Fowler's distinctions)**
- **Event notification**: "OrderPlaced {orderId}" — minimal payload; consumers call back for details if needed. Low coupling on data, but callbacks create temporal coupling and load on the source.
- **Event-carried state transfer (ECST)**: the event contains the data consumers need ("CustomerAddressChanged {customerId, address...}"); consumers keep local copies. Fewer callbacks and better availability; larger payloads, data duplication, schema evolution care.
- **Event sourcing**: events are the **system of record** for an aggregate's state (rebuild state by replaying) — an internal persistence pattern, not an integration style (covered in the Event Sourcing topic).
- (Also: **CQRS** read models fed by events.)

**Topologies (Fundamentals of Software Architecture)**
- **Broker topology**: no central coordinator; services react to events and publish new ones (choreography). Highly decoupled and scalable, but the overall workflow is implicit — hard to see, monitor and change; error handling is distributed.
- **Mediator topology**: a mediator (orchestrator/workflow engine) receives an initiating event and coordinates steps, sending commands to services. Clear control of the workflow, error handling and state; the mediator can become a bottleneck or a god component.
- Many systems mix: choreography between bounded contexts, orchestration within a complex business process (sagas).

**Trade-offs you accept**
- **Eventual consistency** and UX implications (pending states).
- **Ordering and duplicates**: at-least-once delivery → idempotent consumers; ordering only per partition/key.
- **Observability**: tracing across async hops (trace context in headers), event catalogues.
- **Schema evolution**: versioning, compatibility rules, schema registry.
- **Debugging and testing** are harder; contract tests for events.

**When it fits**: many independent reactions to business facts, integration between teams/contexts, high-volume streams, audit needs. When not: simple request/response CRUD where synchronous calls are clearer.`,
  code: r`~~~csharp
// Event notification: consumers must call back for details
public sealed record OrderPlaced(Guid OrderId, DateTimeOffset OccurredAt);

// Event-carried state transfer: consumers keep a local copy without calling back
public sealed record CustomerAddressChanged(
    Guid CustomerId, string Line1, string City, string PostCode, string CountryCode,
    int Version, DateTimeOffset OccurredAt);

// Consumer maintains a local projection, idempotent by version
public async Task HandleAsync(CustomerAddressChanged e, CancellationToken ct)
{
    var local = await _db.CustomerAddresses.FindAsync([e.CustomerId], ct);
    if (local is not null && local.Version >= e.Version) return;          // duplicate or out-of-order
    _db.Upsert(new CustomerAddress(e.CustomerId, e.Line1, e.City, e.PostCode, e.CountryCode, e.Version));
    await _db.SaveChangesAsync(ct);
}
~~~`,
  dia: r`flowchart LR
  subgraph Broker[Broker topology - choreography]
    O1[Orders] -->|OrderPlaced| B1[[Broker]]
    B1 --> P1[Payments]
    P1 -->|PaymentCaptured| B1
    B1 --> S1[Shipping]
  end
  subgraph Mediator[Mediator topology - orchestration]
    O2[Orders] -->|OrderPlaced| MED[Order workflow mediator]
    MED -->|Capture payment| P2[Payments]
    MED -->|Ship| S2[Shipping]
  end`,
  pts: [r`Event notification, event-carried state transfer and event sourcing are different things.`, r`Broker topology decouples but hides the workflow; mediator topology centralises control.`, r`Mix: choreography between contexts, orchestration within complex processes.`, r`Accept eventual consistency, duplicates, ordering limits and schema evolution work.`, r`Use where many reactions to business facts exist, not for simple CRUD.`],
  ex: r`A card-onboarding flow built purely with choreography across 9 services became impossible to change; introducing an orchestrator for the onboarding saga made the process visible and cut failure investigation time from hours to minutes.`,
  fu: [r`When does event-carried state transfer become a data consistency problem?`, r`How do you document event flows for other teams?`],
  pit: [r`Calling every event-driven system "event sourcing".`, r`Choreographing complex business processes with no visibility.`, r`Non-idempotent consumers.`] },

{ id: 'q9', level: 'Intermediate', tags: ['serverless', 'cost-model', 'lock-in', 'architecture-style'],
  q: r`Serverless as an architecture style: what changes in design, the cost model, operational trade-offs, vendor lock-in, and when it is the wrong choice.`,
  a: r`**What serverless means**: managed compute and services where you do not manage servers, capacity scales automatically (often to zero), and you pay per use — functions (Lambda, Azure Functions), serverless containers (Cloud Run, Container Apps, Fargate), and managed backends (DynamoDB/Cosmos serverless, SQS/Service Bus, EventBridge/Event Grid, Step Functions/Durable Functions, API Gateway).

**Design changes**
- **Event-driven decomposition**: functions triggered by HTTP, queues, streams, schedules, storage events.
- **Statelessness**: state in managed stores; no in-memory sessions or local files.
- **Fine-grained deployment units** and per-function IAM permissions (least privilege).
- **Orchestration** with workflow services for multi-step processes.
- **Idempotency** everywhere (at-least-once triggers, retries).

**Cost model**
- Pay per request and execution time (GB-seconds) — very cheap for spiky or low-volume workloads, potentially expensive at **sustained high throughput** compared with reserved containers/VMs.
- Hidden costs: API gateway per-request fees, data transfer, logging volume, NAT for VPC-attached functions, many small resources to manage.
- Do the arithmetic: requests/month × duration × memory vs container cost at expected utilisation.

**Operational trade-offs**
- Pros: no patching, built-in scaling and HA, fast to start, cost aligned with usage.
- Cons: cold starts (mitigations exist), execution limits (time, payload, concurrency), harder local testing and debugging, distributed tracing across many functions, quotas, observability costs.

**Vendor lock-in**: business logic can stay portable (hexagonal design: function handler as an adapter), but triggers, workflows and IAM are provider-specific. Accept lock-in consciously where the productivity gain is large; keep an exit plan for critical systems.

**Wrong choice when**: steady high-throughput, latency-critical paths where cold starts or per-request costs hurt; long-running computations; workloads needing specialised hardware or fine-grained runtime control; teams lacking event-driven design skills; strict portability mandates.`,
  code: r`~~~text
Cost comparison (illustrative arithmetic, check current prices)
Workload: 50 M requests/month, 120 ms avg, 512 MB
Lambda compute: 50e6 x 0.12 s x 0.5 GB = 3.0e6 GB-s  -> ~3.0e6 x 0.0000167 = ~ $50 + requests 50 x $0.20 = ~$10
API Gateway (HTTP API): 50 M x ~$1.00 per million = ~ $50
=> ~ $110/month: serverless wins

Workload: 5 B requests/month (~1,900 rps sustained), 120 ms, 512 MB
Lambda: ~$5,000 compute + ~$1,000 requests + API GW ~$4,000 => ~ $10,000/month
Containers: ~ 12 vCPU sustained on Fargate/EC2 with headroom => ~ $1,500-3,000/month
=> containers likely cheaper at sustained high throughput
~~~
~~~csharp
// Keep logic portable: the function is a thin adapter over an application service
public class AuthoriseFunction(IAuthorisationService service)
{
    [Function("Authorise")]
    public async Task<IActionResult> Run([HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequest req)
        => new OkObjectResult(await service.AuthoriseAsync(await req.ReadFromJsonAsync<AuthoriseRequest>()));
}
~~~`,
  dia: r`flowchart LR
  C[Client] --> GW[API Gateway]
  GW --> F1[Function: Authorise]
  F1 --> DB[(Serverless DB)]
  F1 -->|event| Q[(Queue)]
  Q --> F2[Function: Notify]
  SCHED[Schedule] --> F3[Function: Reconcile]
  F3 --> WF[Workflow service - multi-step]`,
  pts: [r`Serverless = managed, auto-scaling, pay-per-use compute and services.`, r`Design stateless, event-driven, idempotent, least-privilege units.`, r`Cheap for spiky/low volume; do the arithmetic for sustained high throughput.`, r`Trade-offs: cold starts, limits, testing, observability.`, r`Keep business logic portable; accept platform lock-in consciously.`],
  ex: r`A statement-generation workload running 3 hours a month on always-on VMs moved to queue-triggered functions and cut its cost by 92%; the card authorisation path stayed on containers for predictable latency and cost.`,
  fu: [r`How would you test a serverless workflow locally and in CI?`, r`At what point would you move a function to a container?`],
  pit: [r`Ignoring API gateway and logging costs.`, r`Serverless for sustained, latency-critical hot paths without analysis.`, r`Business logic tightly bound to function triggers.`] },

{ id: 'q10', level: 'Intermediate', tags: ['soa', 'esb', 'microservices', 'canonical-model'],
  q: r`SOA with an Enterprise Service Bus versus microservices: what differs in philosophy and practice, what went wrong with many ESB programmes, and where integration platforms still make sense today.`,
  a: r`**Classic SOA/ESB**
- Services exposed (often SOAP/WSDL) and integrated through a central **ESB** that performs routing, transformation, orchestration, protocol mediation and sometimes business rules.
- Emphasis on **enterprise reuse**: shared services, a **canonical data model** for the whole enterprise, central governance.

**Microservices**
- **Smart endpoints, dumb pipes**: business logic lives in services; the transport (HTTP, a message broker) just moves messages.
- Services aligned to bounded contexts, owned by autonomous teams, independently deployable, owning their data.
- Prefer **decentralised governance** with standards for interoperability (APIs, events, observability) rather than central control.

**What went wrong with many ESB programmes**
- The ESB accumulated **business logic and orchestration**, becoming a central bottleneck owned by an integration team — every change required that team, slowing delivery.
- The **canonical data model** forced every system to agree on one model of "Customer" or "Account", producing bloated schemas and coupling everyone to every change.
- Single point of failure and performance bottleneck; heavyweight tooling and licensing.
- Reuse goals led to shared services with many consumers, making change risky.

**Where integration platforms still make sense**
- Integrating **packaged applications and SaaS** (ERP, CRM, core banking packages) that you cannot change: iPaaS (MuleSoft, Azure Logic Apps/Integration Services, Boomi) or integration services with connectors.
- Protocol and format mediation for legacy (MQ, files, SWIFT messages, EDI).
- B2B/partner integration, managed file transfer.
- Keep business logic out of the integration layer; treat integrations as products with owners; use **anti-corruption layers** at the boundary of your domain.

**Modern equivalents done right**: API gateways (thin, cross-cutting concerns), event brokers (Kafka, Service Bus) as dumb pipes, workflow engines owned by domain teams, and bounded-context-specific models translated at boundaries.`,
  code: r`~~~csharp
// Anti-corruption layer instead of a canonical enterprise model: translate the core banking package's
// "Party" model into the Onboarding context's own Customer model at the boundary
public sealed class CoreBankingCustomerTranslator
{
    public Customer ToCustomer(CoreBankingParty party) => new(
        Id: CustomerId.From(party.PartyRef),
        Name: new PersonName(party.Names.Given, party.Names.Family),
        Residency: CountryCode.Parse(party.Addresses.Single(a => a.Type == "RES").Country),
        RiskRating: party.KycFlags.Contains("PEP") ? RiskRating.High : RiskRating.Standard);
}
~~~`,
  dia: r`flowchart TB
  subgraph ESB[Classic SOA]
    A1[App A] --> BUS[ESB: routing, transform, orchestration, rules]
    A2[App B] --> BUS
    BUS --> A3[App C]
    CDM[Canonical data model] -.-> BUS
  end
  subgraph MS[Microservices]
    S1[Service A - own model] -->|events| K[[Broker - dumb pipe]]
    K --> S2[Service B - own model]
    S2 -->|ACL| PKG[Packaged core banking]
  end`,
  pts: [r`SOA/ESB centralised integration logic; microservices keep logic in services with dumb pipes.`, r`ESBs often became bottlenecks with business logic and central teams.`, r`Enterprise canonical models couple everyone to every change.`, r`Integration platforms still fit packaged apps, legacy protocols and B2B.`, r`Use anti-corruption layers and context-specific models.`],
  ex: r`A bank's ESB held 1,200 transformations and orchestrations owned by a 15-person team with a 6-week backlog; moving domain logic back into services and using the integration platform only for core-banking adapters cut integration lead time to days.`,
  fu: [r`Is an API gateway an ESB in disguise?`, r`When is a canonical model useful?`],
  pit: [r`Business rules in the integration layer.`, r`One enterprise-wide data model.`, r`Dismissing integration platforms entirely for packaged software.`] },

{ id: 'q11', level: 'Intermediate', tags: ['microkernel', 'plugin-architecture', 'assemblyloadcontext', 'rules-engine'],
  q: r`Explain the microkernel (plug-in) architecture: core versus plug-ins, contracts and registries, plug-in isolation, versioning, and how you would implement it in .NET (for example, pluggable payment methods or fee rules).`,
  a: r`**Structure**
- **Core system**: minimal functionality and the general flow (for example: validate payment → choose method → execute → record).
- **Plug-in components**: independent modules that extend the core with specific behaviour (a payment method, a country-specific tax/fee rule, a file format parser).
- **Contracts**: interfaces/schemas between core and plug-ins; a **registry** that discovers plug-ins (configuration, assembly scanning, DI registrations, or remote service lookup).

**Where it fits**: product platforms with many variations (payment methods per market, insurance products), rules engines, data import pipelines with many formats, IDEs/browsers, white-label products. Also as an internal style inside a service.

**Design considerations**
- **Stable contracts** in a separate package; plug-ins depend on the contract, never on core internals.
- **Isolation**: plug-ins should not crash the core — validate inputs, timeouts, exception boundaries; for untrusted plug-ins use process isolation (separate service or container) instead of in-process loading.
- **Versioning**: contract versions with compatibility rules; core supports N and N-1.
- **Configuration**: which plug-ins are active per tenant/market (feature flags or configuration).
- **Testing**: contract test suite that every plug-in must pass.

**.NET implementation options**
- **Compile-time plug-ins** via DI: each plug-in is a class library registering implementations of {{IPaymentMethod}}; the core resolves {{IEnumerable<IPaymentMethod>}} and selects by key ({{keyed services}} in .NET 8). Simple, safe, redeploy to add plug-ins.
- **Runtime-loaded plug-ins**: {{AssemblyLoadContext}} with {{AssemblyDependencyResolver}} to load plug-in assemblies and their dependencies in isolation (collectible contexts allow unloading); share only the contract assembly with the default context to avoid type-identity issues.
- **Out-of-process plug-ins**: each plug-in as a service behind a common API — strongest isolation and independent deployment, at network cost.`,
  code: r`~~~csharp
// Contract package
public interface IPaymentMethod
{
    string Key { get; }                                   // "card", "sepa", "ideal"
    bool Supports(PaymentRequest request);
    Task<PaymentOutcome> ExecuteAsync(PaymentRequest request, CancellationToken ct);
}

// Plug-in registration (compile-time) with .NET 8 keyed services
builder.Services.AddKeyedSingleton<IPaymentMethod, CardPaymentMethod>("card");
builder.Services.AddKeyedSingleton<IPaymentMethod, SepaPaymentMethod>("sepa");

// Core selects the plug-in; failures are contained
public sealed class PaymentProcessor(IServiceProvider sp, ILogger<PaymentProcessor> log)
{
    public async Task<PaymentOutcome> ProcessAsync(PaymentRequest req, CancellationToken ct)
    {
        var method = sp.GetKeyedService<IPaymentMethod>(req.MethodKey)
                     ?? throw new UnsupportedPaymentMethodException(req.MethodKey);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(10));
        try { return await method.ExecuteAsync(req, cts.Token); }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            log.LogError(ex, "Plug-in {Key} failed", req.MethodKey);
            return PaymentOutcome.Failed("plugin_error");
        }
    }
}

// Runtime loading (isolated) - share only the contract assembly with the default context
var ctx = new PluginLoadContext(Path.Combine(pluginDir, "Bank.Payments.Ideal.dll"));
var asm = ctx.LoadFromAssemblyName(new AssemblyName("Bank.Payments.Ideal"));
var plugin = (IPaymentMethod)Activator.CreateInstance(asm.GetTypes().Single(t => typeof(IPaymentMethod).IsAssignableFrom(t)))!;
~~~`,
  dia: r`flowchart LR
  CORE[Core: validate, select, execute, record] -->|IPaymentMethod contract| REG[Plug-in registry]
  REG --> P1[Card plug-in]
  REG --> P2[SEPA plug-in]
  REG --> P3[iDEAL plug-in - runtime loaded, isolated ALC]
  REG --> P4[Untrusted partner plug-in - out of process]`,
  pts: [r`Minimal core plus plug-ins via stable contracts and a registry.`, r`Fits product variations, rules engines, format parsers.`, r`Contain plug-in failures; isolate untrusted plug-ins out of process.`, r`Version contracts; contract test suite for plug-ins.`, r`.NET: keyed DI services, AssemblyLoadContext, or out-of-process services.`],
  ex: r`A PSP added 14 local payment methods across Europe as plug-ins implementing one contract; the core authorisation flow did not change, and each method shipped behind a per-market flag.`,
  fu: [r`What problems arise when a plug-in loads a different version of a shared dependency?`, r`When would you move plug-ins out of process?`],
  pit: [r`Plug-ins depending on core internals.`, r`Untrusted code loaded in-process.`, r`Unversioned contracts.`] },

{ id: 'q12', level: 'Intermediate', tags: ['pipes-and-filters', 'pipelines', 'batch', 'streaming'],
  q: r`Explain the pipes-and-filters style and how it applies to batch and streaming data pipelines (for example, processing settlement files or transaction streams): filter types, backpressure, error handling and idempotency.`,
  a: r`**Concept**: processing is split into independent **filters** (each performs one transformation) connected by **pipes** (channels). Filters are composable, reusable and individually testable; pipelines can be reconfigured.

**Filter types**: **producer/source** (reads files, streams), **transformer** (map/enrich/normalise), **tester** (filter/validate/route), **consumer/sink** (write to DB, publish events).

**Applications**: ETL/ELT, file processing (settlement files, statements), stream processing (Kafka Streams, Flink), compilers, middleware pipelines (ASP.NET Core middleware is a pipes-and-filters chain), message processing chains.

**Batch example — settlement file reconciliation**
1. Source: read the PSP settlement file from object storage (stream, do not load fully in memory).
2. Parse and validate each record (schema, checksums); invalid records to a **quarantine** output with reasons.
3. Normalise (currency, amounts in minor units, timezones).
4. Match against internal ledger records.
5. Sink: matched → mark settled; breaks → exceptions queue for investigation.

**Design concerns**
- **Backpressure**: bounded channels between stages so a slow sink slows the source instead of exhausting memory ({{System.Threading.Channels}} with bounded capacity, TPL Dataflow {{BoundedCapacity}}, reactive streams).
- **Parallelism** per stage (degree of parallelism) while preserving order where required (partition by key).
- **Error handling**: per-record errors go to dead-letter/quarantine without stopping the pipeline; systemic errors stop it with clear alerts.
- **Idempotency and restartability**: checkpoint progress (file offset, record ID), make sinks idempotent (upserts keyed by business IDs), support re-running a whole file safely.
- **Observability**: counts in/out per stage, error rates, lag.
- **Schema evolution** of records between stages.`,
  code: r`~~~csharp
// Bounded channels give backpressure between stages; quarantine bad records instead of failing the run
var parsed  = Channel.CreateBounded<SettlementRecord>(new BoundedChannelOptions(1_000) { FullMode = BoundedChannelFullMode.Wait });
var matched = Channel.CreateBounded<MatchResult>(1_000);

var source = Task.Run(async () =>
{
    await foreach (var line in ReadLinesAsync(fileStream, ct))
    {
        if (SettlementRecord.TryParse(line, out var rec, out var error)) await parsed.Writer.WriteAsync(rec, ct);
        else await quarantine.WriteAsync(line, error, ct);
    }
    parsed.Writer.Complete();
}, ct);

var matcher = Task.Run(async () =>
{
    await foreach (var rec in parsed.Reader.ReadAllAsync(ct))
        await matched.Writer.WriteAsync(await ledger.MatchAsync(rec.Normalise(), ct), ct);
    matched.Writer.Complete();
}, ct);

var sink = Task.Run(async () =>
{
    await foreach (var m in matched.Reader.ReadAllAsync(ct))
        await (m.IsMatch ? ledger.MarkSettledAsync(m, ct) : breaks.RaiseAsync(m, ct));   // idempotent by record id
}, ct);

await Task.WhenAll(source, matcher, sink);
~~~`,
  dia: r`flowchart LR
  SRC[Source: settlement file stream] -->|bounded pipe| PARSE[Parse + validate]
  PARSE -->|invalid| QUA[(Quarantine)]
  PARSE -->|bounded pipe| NORM[Normalise]
  NORM --> MATCH[Match vs ledger]
  MATCH -->|matched| SET[Sink: mark settled]
  MATCH -->|break| EXC[Sink: exceptions queue]`,
  pts: [r`Independent filters connected by pipes: composable and testable.`, r`Source, transformer, tester and sink filters.`, r`Bounded pipes provide backpressure.`, r`Quarantine per-record errors; stop on systemic errors.`, r`Checkpoint and idempotent sinks for restartability.`],
  ex: r`A settlement reconciliation job loaded entire files into memory and crashed on month-end files of 4 GB; a streaming pipes-and-filters design with bounded channels processed them in constant memory.`,
  fu: [r`How do you preserve ordering while parallelising a stage?`, r`How would you make a re-run of the same file safe?`],
  pit: [r`Unbounded queues between stages.`, r`Failing the whole run on one bad record.`, r`Non-idempotent sinks.`] },

{ id: 'q13', level: 'Intermediate', tags: ['space-based', 'data-grid', 'elasticity'],
  q: r`What is space-based architecture? Explain processing units, in-memory data grids, data pumps and writers, the problems it solves (extreme, spiky load), and its consistency and cost trade-offs.`,
  a: r`**Problem it addresses**: in classic designs, the **database is the bottleneck** under extreme, unpredictable spikes (ticket sales opening, flash sales, auctions, market-open bursts). Scaling web/app tiers does not help if every request hits the same database.

**Structure** (named after "tuple spaces")
- **Processing units**: application instances that hold the data they need in an **in-memory data grid** (replicated or partitioned across units) — requests are served from memory.
- **Virtualised middleware**: messaging grid (request routing), data grid (replication between processing units), processing grid (orchestration of multi-unit requests), deployment manager (starts/stops units based on load).
- **Data pumps**: asynchronously send updates from the grid to the database (via queues).
- **Data writers / readers**: persist updates to the database and reload data into the grid on start-up or failure.
The database is removed from the synchronous request path.

**Benefits**: near-linear elasticity (add processing units in seconds), very low latency, survives database slowness.

**Trade-offs**
- **Consistency**: replicated caches lead to **data collisions** (two units updating the same item concurrently) — mitigated by partitioning (each key owned by one unit), versioning, or limiting writes; durability depends on asynchronous persistence (data loss risk if the grid fails before pumping).
- **Memory size**: the hot data set must fit in memory across units.
- **Complexity and cost**: specialised products (Hazelcast, Apache Ignite, GridGain, Coherence, Redis-based designs), operational expertise, testing difficulty.
- Not suited to large relational datasets with complex queries, or systems requiring strong consistency on every write (core ledgers).

**Lighter alternatives often enough**: CDN and edge caching, read replicas, cache-aside with Redis, queue-based load levelling (accept orders into a queue, process at a sustainable rate), virtual waiting rooms for ticket drops.

**In finance**: market-data distribution and pricing caches use similar ideas; for booking money movements, a durable ledger write remains in the path.`,
  code: r`~~~csharp
// Partitioned in-memory ownership: each processing unit owns a slice of seat inventory (no cross-unit write collisions)
public sealed class SeatInventoryUnit(int unitId, int unitCount, IInventoryPump pump)
{
    private readonly ConcurrentDictionary<string, int> _available = new();

    public bool Owns(string eventId) => (uint)eventId.GetHashCode() % (uint)unitCount == (uint)unitId;

    public bool TryReserve(string eventId, int seats, string orderId)
    {
        var ok = false;
        _available.AddOrUpdate(eventId, 0, (_, current) =>
        {
            ok = current >= seats;
            return ok ? current - seats : current;
        });
        if (ok) pump.Enqueue(new SeatsReserved(eventId, seats, orderId));   // async persistence to the database
        return ok;
    }
}
~~~`,
  dia: r`flowchart LR
  U[Users - spike] --> MG[Messaging grid - routes by key]
  MG --> PU1[Processing unit 1 + in-memory data]
  MG --> PU2[Processing unit 2 + in-memory data]
  MG --> PU3[Processing unit N]
  PU1 -->|data pump async| Q[(Queue)]
  PU2 -->|data pump| Q
  Q --> DW[Data writer] --> DB[(Database)]
  DB --> DR[Data reader - reload on start]
  DR --> PU1
  DM[Deployment manager] -.scale units.-> PU3`,
  pts: [r`Removes the database from the synchronous path using in-memory data grids.`, r`Processing units, data grid, data pumps, writers and readers.`, r`Elastic and low latency under extreme spikes.`, r`Trade-offs: collisions, async durability, memory limits, complexity, cost.`, r`Often simpler alternatives suffice: caching, queues, waiting rooms.`],
  ex: r`A ticketing platform used partitioned in-memory inventory per event with asynchronous persistence to survive 400,000 users at sale opening; payments for the reserved seats still went through a durable, idempotent payment service.`,
  fu: [r`How do you prevent data loss if a processing unit dies before pumping updates?`, r`Why is space-based architecture unsuitable for a core ledger?`],
  pit: [r`Using it where caching and queues would suffice.`, r`Ignoring data collisions in replicated grids.`, r`Assuming asynchronous persistence is durable.`] },

{ id: 'q14', level: 'Intermediate', tags: ['cell-based', 'blast-radius', 'architecture-style'],
  q: r`Describe cell-based architecture as a general style (independent of cloud provider): what a cell contains, cell routing, sizing, and how it changes deployment, failure handling and data ownership.`,
  a: r`**Idea**: partition the whole system into **cells** — complete, independent copies of the stack (compute, data stores, queues), each serving a subset of customers/tenants/accounts. A thin **routing layer** maps each request to its cell by a partition key.

**What a cell contains**: all services needed to serve its customers end to end, its own databases and caches (data for its tenants only), its own messaging, ideally its own account/subscription or cluster for isolation. Shared global services are kept minimal (routing, identity, global configuration).

**Routing**: a cell router resolves partition key (tenant id, merchant id, account range) → cell, using a mapping store cached locally; it must be extremely simple and highly available (static stability: keep serving from the last known mapping if the store fails).

**Sizing**: define a maximum tested cell size (tenants, TPS, data volume) via load tests; when a cell approaches its limit, create a new cell and place new tenants there or migrate some.

**Effects**
- **Failure handling**: failures (bad deploys, poison data, noisy tenants, resource exhaustion) are contained to one cell — blast radius = 1/N of customers.
- **Deployment**: deploy cell by cell in waves (canary cell first) — progressive delivery at the architecture level.
- **Scaling**: add cells rather than scaling one giant system; each cell stays within known limits.
- **Data**: each tenant's data lives in exactly one cell; **cross-cell queries** (global reporting, cross-tenant analytics) go through aggregation pipelines or a separate analytics store.
- **Tenant migration** between cells is a deliberate data-migration capability (copy, sync, cut over, verify).

**Costs**: duplicated infrastructure per cell, more complex operations (N copies to monitor and upgrade), global features (search across tenants, cross-cell transfers) become harder, and the router is a critical component.

**When**: large multi-tenant SaaS, payments platforms, systems where availability for most customers during partial failures is essential. Not for small systems.`,
  code: r`~~~csharp
// Cell routing middleware: route by merchant id using a locally cached mapping (static stability)
public sealed class CellRoutingMiddleware(RequestDelegate next, ICellMap map, IHttpForwarder forwarder, HttpMessageInvoker http)
{
    public async Task InvokeAsync(HttpContext ctx)
    {
        var merchantId = ctx.User.FindFirst("merchant_id")?.Value;
        if (merchantId is null) { ctx.Response.StatusCode = 401; return; }

        var cell = map.Resolve(merchantId);            // in-memory map refreshed in background; last-known-good on failure
        if (cell is null) { ctx.Response.StatusCode = 404; return; }

        ctx.Response.Headers["X-Cell"] = cell.Name;      // observability: which cell served the request
        await forwarder.SendAsync(ctx, cell.BaseUrl, http);
    }
}
~~~`,
  dia: r`flowchart TB
  C[Clients] --> R[Thin cell router - cached mapping]
  R -->|tenants 1-500| C1[Cell 1: services + DB + queues]
  R -->|tenants 501-1000| C2[Cell 2]
  R -->|tenants 1001+| C3[Cell 3]
  C1 --> AGG[Analytics aggregation - cross-cell reporting]
  C2 --> AGG
  C3 --> AGG
  DEP[Deploy waves: canary cell first] -.-> C1`,
  pts: [r`Cells are complete, independent stacks serving subsets of customers.`, r`A thin, statically stable router maps partition keys to cells.`, r`Size cells by tested limits; add cells to scale.`, r`Failures and deployments are contained per cell.`, r`Cross-cell queries and tenant migration need dedicated mechanisms; costs are real.`],
  ex: r`A merchant-services platform split into 12 cells; a malformed batch upload from one large merchant exhausted one cell's queue workers while 92% of merchants were unaffected, and the cell recovered within 20 minutes.`,
  fu: [r`How would you handle a payment between tenants in different cells?`, r`What belongs in the global (non-cell) layer?`],
  pit: [r`Logic-heavy routers.`, r`Shared databases across cells.`, r`No tenant migration capability.`] },

{ id: 'q15', level: 'Intermediate', tags: ['bff', 'api-composition', 'frontend', 'spa'],
  q: r`Explain the Backend-for-Frontend (BFF) pattern and API composition for Angular/React and mobile clients: responsibilities, BFF versus API gateway, security benefits (token handling), and the risks of BFF sprawl.`,
  a: r`**Problem**: generic backend APIs designed for all clients force each frontend to make many calls, over-fetch data and implement aggregation logic; different clients (web SPA, mobile app, partner API) have different needs and release cadences.

**BFF**: a backend **dedicated to one client experience** (web BFF, mobile BFF), owned ideally by the frontend team. Responsibilities:
- **Aggregation/composition**: call several downstream services and shape one response for a screen.
- **Client-specific shaping**: field selection, pagination, formatting for the UI.
- **Protocol translation**: gRPC/events internally, REST/GraphQL to the client.
- **Session and token handling** for browser clients.
- Client-specific caching and feature flag evaluation.

**BFF vs API gateway**: the gateway handles **cross-cutting** concerns for all traffic (TLS, rate limiting, authentication, routing, WAF); a BFF contains **client-specific** composition logic. They are usually layered: gateway → BFFs → domain services.

**Security benefit for SPAs**: storing OAuth tokens in browser JavaScript exposes them to XSS. A **BFF with server-side token handling** keeps access/refresh tokens on the server; the browser only holds a secure, **HttpOnly, SameSite** session cookie. The BFF performs the OIDC flow (confidential client), attaches access tokens to downstream calls and needs CSRF protection (SameSite plus anti-forgery tokens for state-changing requests). This pattern is recommended for high-security SPAs (banking).

**API composition considerations**: parallelise downstream calls, set timeouts and partial-response strategies (return what is available with indicators), avoid long chains of synchronous calls (latency adds up), cache reference data.

**Risks**
- **BFF sprawl**: one BFF per small variation; duplicated logic.
- **Business logic creep**: BFFs must not own domain rules — keep them thin.
- **Fan-out latency and failures** if composition is not designed carefully.
- Ownership confusion if backend teams own frontend-specific BFFs.

**Alternatives**: GraphQL (one flexible API for multiple clients, with its own complexity: query cost control, caching), or well-designed coarse-grained APIs.`,
  code: r`~~~csharp
// Web BFF (ASP.NET Core + YARP + cookie session): tokens stay server-side, SPA uses an HttpOnly cookie
builder.Services.AddAuthentication(o => { o.DefaultScheme = "cookie"; o.DefaultChallengeScheme = "oidc"; })
    .AddCookie("cookie", o => { o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Strict; o.Cookie.SecurePolicy = CookieSecurePolicy.Always; })
    .AddOpenIdConnect("oidc", o =>
    {
        o.Authority = "https://login.bank.example"; o.ClientId = "web-bff"; o.ClientSecret = builder.Configuration["Oidc:Secret"];
        o.ResponseType = "code"; o.UsePkce = true; o.SaveTokens = true;      // tokens stored in the server-side session
        o.Scope.Add("accounts.read"); o.Scope.Add("offline_access");
    });

// Composition endpoint for the dashboard screen: parallel downstream calls with timeouts
app.MapGet("/bff/dashboard", async (AccountsClient accounts, PaymentsClient payments, CancellationToken ct) =>
{
    var a = accounts.GetSummaryAsync(ct);
    var p = payments.GetRecentAsync(10, ct);
    await Task.WhenAll(a, p);
    return Results.Ok(new DashboardVm(a.Result, p.Result));
}).RequireAuthorization();
~~~`,
  dia: r`flowchart LR
  SPA[Angular SPA - HttpOnly session cookie] --> GW[API Gateway: TLS, WAF, rate limits]
  MOB[Mobile app] --> GW
  GW --> WBFF[Web BFF: OIDC, tokens server-side, composition]
  GW --> MBFF[Mobile BFF]
  WBFF --> ACC[Accounts service]
  WBFF --> PAY[Payments service]
  MBFF --> ACC`,
  pts: [r`A BFF serves one client experience: composition, shaping, translation.`, r`Gateway = cross-cutting; BFF = client-specific; layer them.`, r`BFF with server-side tokens and HttpOnly cookies protects SPAs from token theft via XSS.`, r`Design composition with parallel calls, timeouts and partial responses.`, r`Avoid sprawl and domain logic in BFFs.`],
  ex: r`A bank's Angular app called 14 APIs to render its dashboard and stored tokens in localStorage; a web BFF reduced it to one call and moved tokens server-side, closing a penetration-test finding.`,
  fu: [r`How does a BFF change CSRF considerations?`, r`When is GraphQL a better choice than BFFs?`],
  pit: [r`Business rules inside BFFs.`, r`Tokens stored in localStorage for banking SPAs.`, r`Sequential fan-out calls adding latency.`] },

{ id: 'q16', level: 'Intermediate', tags: ['micro-frontends', 'module-federation', 'angular', 'react'],
  q: r`Micro-frontends: when are they justified, how do you integrate them (build-time, Module Federation, web components, iframes, server-side composition), and what costs and pitfalls do they bring for Angular/React teams?`,
  a: r`**Idea**: split a large frontend into independently developed and deployed parts owned by different teams, mirroring microservices on the backend (often aligned to the same business domains).

**Justified when**: many teams (for example 5+) work on one large web application and block each other; parts need independent release cadences; gradual migration from a legacy framework (AngularJS → Angular/React) is needed. **Not justified** for a small team or a modest app — the overhead outweighs benefits.

**Integration approaches**
| Approach | How | Pros | Cons |
|---|---|---|---|
| **Build-time packages** | each part published as an npm package, composed at build | simple, type-safe | not independent deployment (shell must rebuild) |
| **Module Federation** (Webpack/Rspack, Native Federation for Angular) | shell loads remote bundles at runtime | independent deploys, shared dependencies | version mismatches, runtime failures, complex config |
| **Web components** (custom elements) | each team ships framework-agnostic elements | technology independence, encapsulation (Shadow DOM) | inter-component communication, styling, SSR complexity |
| **iframes** | separate apps embedded | strong isolation | poor UX integration, routing/size/accessibility issues |
| **Server-side / edge composition** | templates stitched on server/edge (ESI, SSR frameworks) | performance, SEO | infrastructure complexity |

**Cross-cutting concerns to standardise**
- A **shell application** owning routing, authentication/session, layout and navigation.
- **Design system** (shared component library, tokens) for consistent UX and accessibility.
- **Shared dependencies policy** (framework versions, singletons such as Angular core/React), and a strategy for upgrades.
- **Communication**: URL/routing, custom events, a minimal shared state; avoid tight coupling via shared global stores.
- **Performance budgets**: duplicated frameworks and bundles hurt load time; lazy loading.
- Observability and error boundaries per micro-frontend; contract tests for remote module interfaces.

**Pitfalls**: inconsistent UX, bundle bloat, version hell, a "distributed monolith frontend" where everything must deploy together anyway, and complex local development. Often a **modular monolith frontend** (Nx monorepo with enforced module boundaries, lazy-loaded feature modules) gives most benefits with less cost.`,
  code: r`~~~typescript
// Angular shell loading a remote "payments" micro-frontend via Native Federation (lazy route)
import { loadRemoteModule } from '@angular-architects/native-federation';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./home/home.component').then(m => m.HomeComponent) },
  {
    path: 'payments',
    loadChildren: () =>
      loadRemoteModule('payments', './routes')            // remote deployed independently by the payments team
        .then(m => m.PAYMENTS_ROUTES)
        .catch(() => import('./fallback/unavailable.routes').then(m => m.UNAVAILABLE_ROUTES)) // degrade gracefully
  }
];

// federation.manifest.json (per environment, not baked into the build)
// { "payments": "https://cdn.bank.example/mfe/payments/2.14.0/remoteEntry.json" }
~~~`,
  dia: r`flowchart TB
  SHELL[Shell app: routing, auth, layout, design system]
  SHELL -->|runtime load| MFE1[Payments MFE - team A, own deploy]
  SHELL -->|runtime load| MFE2[Accounts MFE - team B]
  SHELL -->|runtime load| MFE3[Cards MFE - team C]
  DS[Shared design system + dependency policy] -.-> MFE1
  DS -.-> MFE2
  DS -.-> MFE3
  MFE1 --> BFF1[Payments BFF]`,
  pts: [r`Justified by many teams and independent release needs, or gradual framework migration.`, r`Integration options: build-time, Module Federation, web components, iframes, server-side composition.`, r`Standardise shell, design system, shared dependencies, communication and budgets.`, r`Pitfalls: inconsistent UX, bundle bloat, version hell, frontend distributed monolith.`, r`A modular monolith frontend in an Nx monorepo is often enough.`],
  ex: r`A bank with 9 teams on one Angular portal moved to Native Federation micro-frontends with a shared design system; release coordination meetings disappeared, but they enforced a single Angular major version across remotes to avoid runtime conflicts.`,
  fu: [r`How do you upgrade Angular across 8 independently deployed micro-frontends?`, r`How do micro-frontends share authentication state?`],
  pit: [r`Micro-frontends for a single small team.`, r`No design system, causing inconsistent UX.`, r`Multiple framework copies loaded in one page.`] },

{ id: 'q17', level: 'Intermediate', tags: ['adr', 'decision-records', 'governance'],
  q: r`Write and manage Architecture Decision Records: what goes in an ADR, when to write one, where they live, how they evolve (superseding), and how ADRs support governance and onboarding.`,
  a: r`**What an ADR is**: a short document capturing one **architecturally significant decision**, its context and consequences, at the time it was made (Michael Nygard's format). It preserves the **why**, which code cannot.

**Typical sections**
- **Title** and number (ADR-0042: Use PostgreSQL for the payments ledger).
- **Status**: proposed, accepted, deprecated, superseded by ADR-00xx.
- **Context**: forces at play — requirements, constraints, quality attributes, assumptions.
- **Options considered** with pros/cons (and why rejected).
- **Decision**: what we chose.
- **Consequences**: positive and negative, risks, follow-up work, what becomes easier/harder.
- Optional: compliance/governance notes, revisit triggers, links (PoCs, benchmarks, threat models).

**When to write one**: decisions that are costly to reverse or affect multiple teams — architectural style, data stores, messaging, integration patterns, security model, cloud services, major libraries/frameworks, API standards, cross-cutting patterns (outbox, idempotency). Not for every small choice.

**Where they live**: in the **repository** of the system they affect ({{docs/adr/}}) as Markdown, reviewed through pull requests — close to the code, versioned. Organisation-wide decisions in a central architecture repo. Tools: adr-tools, Log4brains, Backstage TechDocs.

**Evolution**: ADRs are **immutable records** — when a decision changes, write a new ADR that **supersedes** the old one and update the old one's status. The history explains how the architecture got here.

**Governance and onboarding**
- Review proposed ADRs openly (RFC style) with affected teams — lightweight governance instead of review boards for everything.
- New engineers read ADRs to understand constraints and avoid relitigating settled decisions.
- Auditors and regulators can see reasoning for risk-relevant decisions (data residency, encryption, outsourcing).`,
  code: r`~~~markdown
# ADR-0042: Use PostgreSQL (Aurora) for the payments ledger
Status: Accepted (2026-08-14) - supersedes ADR-0011 (DynamoDB for ledger)
## Context
- Double-entry postings, strong consistency, complex reconciliation queries, auditors query by date ranges.
- 3,000 TPS peak; RPO < 5 s, RTO < 15 min; EU residency; team has strong SQL skills.
## Options
1. DynamoDB: scales trivially; complex queries and multi-item invariants harder; reporting via exports.
2. Aurora PostgreSQL: ACID, rich queries, mature tooling; single writer, needs capacity planning.
3. EventStoreDB/event-sourced ledger: audit-friendly; new skills, operational risk.
## Decision
Aurora PostgreSQL with a write-optimised schema, outbox for events, read replicas for reporting.
## Consequences
+ Transactional integrity for postings; reconciliation in SQL; familiar operations.
- Vertical write ceiling (~revisit at 10,000 TPS); Global Database for DR adds cost.
Revisit when: sustained > 8,000 TPS, or multi-region active-active becomes a requirement.
~~~`,
  dia: r`flowchart LR
  PROP[Proposed ADR in PR] --> REV[Review with affected teams]
  REV --> ACC[Accepted - merged to docs/adr]
  ACC --> CODE[Implementation + fitness functions]
  ACC -->|context changes| NEW[New ADR supersedes]
  NEW --> ACC2[Old ADR status: superseded]`,
  pts: [r`ADRs capture context, options, decision and consequences — the why.`, r`Write them for costly-to-reverse or cross-team decisions.`, r`Store them as Markdown in the repo, reviewed via PRs.`, r`Immutable: supersede rather than edit.`, r`Support lightweight governance, onboarding and audit.`],
  ex: r`New engineers kept proposing to move a ledger to NoSQL; a superseding ADR documenting why the team moved from DynamoDB to PostgreSQL ended a recurring debate and saved weeks of re-analysis.`,
  fu: [r`How do you avoid ADRs becoming bureaucracy?`, r`Who should approve an ADR?`],
  pit: [r`ADRs for trivial decisions.`, r`Editing old ADRs instead of superseding.`, r`Documenting decisions without alternatives and consequences.`] },

{ id: 'q18', level: 'Intermediate', tags: ['integration-styles', 'sync-vs-async', 'shared-database', 'file-transfer'],
  q: r`Compare integration styles between systems — synchronous request/response (REST, gRPC), asynchronous messaging and events, file transfer, and shared databases — and choose for several scenarios in a bank.`,
  a: r`| Style | Coupling | Latency | Reliability | Typical use |
|---|---|---|---|---|
| **Sync REST/gRPC** | temporal coupling (both up), contract coupling | immediate answer | caller handles timeouts/retries; cascading failures risk | queries, commands needing immediate result (authorise payment, check balance) |
| **Async messaging/events** | decoupled in time; contract (schema) coupling | eventual | broker buffers; retries, DLQs; at-least-once | notifications, workflows, propagating state, high volume |
| **File transfer** (batch) | loose, schedule-based | hours | depends on process; reconciliation needed | settlement files, regulatory reporting, legacy/partner exchange |
| **Shared database** | very tight (schema coupling, hidden dependencies) | immediate | single point of contention | **avoid** between independently owned systems; acceptable within one module |

(Enterprise Integration Patterns catalogued these as file transfer, shared database, remote procedure invocation and messaging.)

**Scenario choices**
- **Card authorisation from the API to the risk engine**: synchronous gRPC with a tight timeout and fallback rule (approve low-risk under thresholds if the engine is unavailable, per policy) — the decision is needed now.
- **Payment captured → ledger posting, notifications, analytics**: asynchronous events (outbox + broker) — multiple consumers, resilience to consumer downtime.
- **End-of-day settlement with the acquirer**: file transfer (secure SFTP/managed file transfer) with checksums, then reconciliation — the partner's interface dictates it.
- **Customer data needed by several services**: event-carried state transfer into local read models, or a synchronous query to the owning service with caching — never a shared customer table.
- **Regulatory reporting**: data pipeline from event streams/CDC into a reporting store, then generated files.

**Hybrid patterns**: request/reply over messaging, asynchronous request with polling or webhook callback (202 Accepted + status URL), CDC from legacy databases to events (Debezium) as a bridge when the legacy system cannot publish events.`,
  code: r`~~~csharp
// Async request pattern for a long-running operation: 202 + status URL instead of holding a connection
app.MapPost("/v1/statements", async (StatementRequest req, IOutbox outbox, AppDbContext db, CancellationToken ct) =>
{
    var job = new StatementJob(Guid.NewGuid(), req.AccountId, req.Month, "QUEUED");
    db.StatementJobs.Add(job);
    outbox.Add(new GenerateStatementRequested(job.Id, req.AccountId, req.Month));   // same transaction
    await db.SaveChangesAsync(ct);
    return Results.Accepted($"/v1/statements/{job.Id}", new { job.Id, job.Status });
});

app.MapGet("/v1/statements/{id:guid}", async (Guid id, AppDbContext db) =>
    await db.StatementJobs.FindAsync(id) is { } j ? Results.Ok(j) : Results.NotFound());
~~~`,
  dia: r`flowchart LR
  API[Payments API] -->|sync gRPC, 150 ms timeout| RISK[Risk engine]
  API -->|outbox events| BRK[[Broker]]
  BRK --> LED[Ledger]
  BRK --> NOT[Notifications]
  SETT[Acquirer settlement] -->|SFTP file nightly| REC[Reconciliation job]
  LEG[(Legacy core DB)] -->|CDC| BRK
  X[Shared database between teams] -.avoid.-> LED`,
  pts: [r`Sync calls for immediate answers; manage timeouts and cascading failures.`, r`Async events for multiple consumers and resilience.`, r`File transfer where partners or batch processes require it, with reconciliation.`, r`Avoid shared databases across independently owned systems.`, r`Hybrids: 202 + status, request/reply over messaging, CDC bridges.`],
  ex: r`A bank replaced nightly shared-database reads by eight systems from the core banking schema with CDC events; schema changes in the core no longer broke downstream teams, and data arrived in seconds instead of overnight.`,
  fu: [r`When would you use request/reply over a message broker?`, r`How do you integrate with a legacy system that cannot publish events?`],
  pit: [r`Shared databases between teams.`, r`Long synchronous call chains.`, r`File transfers without checksums and reconciliation.`] },

{ id: 'q19', level: 'Senior', tags: ['evolutionary-architecture', 'fitness-functions', 'archunit'],
  q: r`What is evolutionary architecture? Explain fitness functions (atomic vs holistic, triggered vs continuous), give concrete examples for a .NET system, and how they keep architecture from eroding.`,
  a: r`**Evolutionary architecture** (Ford, Parsons, Kua): an architecture that supports **guided, incremental change** across multiple dimensions. Instead of predicting the future, make change cheap and protect the important characteristics automatically.

**Fitness functions**: objective, automated (where possible) checks that measure how well the architecture meets a characteristic — architecture's equivalent of unit tests.

**Categories**
- **Atomic** (one characteristic, one context: "domain assembly has no reference to EF Core") vs **holistic** (several characteristics together: "a full checkout under load stays below 400 ms p99 with security headers present").
- **Triggered** (run on events: CI build, deployment) vs **continuous** (always running in production: SLO monitors, synthetic checks).
- **Static** (code structure, dependencies) vs **dynamic** (runtime metrics).

**Examples for a .NET payments system**
| Characteristic | Fitness function |
|---|---|
| Modularity | NetArchTest/ArchUnitNET: modules do not reference other modules' internals; domain has no infrastructure dependencies |
| Layering | controllers never reference DbContext directly |
| API compatibility | OpenAPI diff in CI fails on breaking changes without version bump |
| Event contracts | schema registry compatibility check (BACKWARD) |
| Performance | k6/NBomber test in CI: p99 < 300 ms at baseline load; regression > 10% fails |
| Security | dependency scan has no critical CVEs; required security headers present; no secrets in repo |
| Availability | production SLO burn-rate alerts (continuous) |
| Deployability | build + test pipeline under 15 minutes; deploy frequency tracked |
| Data residency | policy as code: resources only in EU regions |
| Cost | cost per transaction below threshold (monthly) |

**Preventing erosion**: architecture decisions (ADRs) become executable constraints; violations fail builds early instead of being found in reviews months later. Fitness functions evolve with the architecture (when an ADR changes, update the functions).

**Practical tips**: start with a few high-value checks, make failures readable (what rule, why, link to ADR), allow explicit, reviewed exceptions, and track trends (for example, coupling metrics over time).`,
  code: r`~~~csharp
// Fitness functions as tests (ArchUnitNET + xUnit)
private static readonly Architecture Arch = new ArchLoader()
    .LoadAssemblies(typeof(Payment).Assembly, typeof(PaymentsDbContext).Assembly, typeof(PaymentsController).Assembly)
    .Build();

[Fact]
public void Domain_does_not_depend_on_infrastructure() =>
    Types().That().ResideInNamespace("Payments.Domain", useRegularExpressions: false)
        .Should().NotDependOnAny(Types().That().ResideInNamespace("Microsoft.EntityFrameworkCore", false))
        .Because("ADR-0007: domain model must be persistence-ignorant")
        .Check(Arch);

[Fact]
public void Controllers_do_not_use_dbcontext_directly() =>
    Classes().That().HaveNameEndingWith("Controller")
        .Should().NotDependOnAny(Classes().That().AreAssignableTo(typeof(DbContext)))
        .Because("ADR-0012: controllers go through application services")
        .Check(Arch);
~~~`,
  dia: r`flowchart LR
  ADR[ADRs: decisions] --> FF[Fitness functions]
  FF --> CI[Triggered: CI - arch tests, API diff, perf, scans]
  FF --> PROD[Continuous: SLOs, synthetics, cost]
  CI -->|violation| FAIL[Build fails with rule + ADR link]
  PROD -->|breach| ALERT[Alert / review]
  ADR -->|superseded| FF`,
  pts: [r`Evolutionary architecture supports guided incremental change.`, r`Fitness functions are automated checks of architectural characteristics.`, r`Atomic vs holistic, triggered vs continuous, static vs dynamic.`, r`Examples: architecture tests, API diffs, performance budgets, policy as code, SLOs.`, r`Executable decisions prevent erosion; readable failures and reviewed exceptions.`],
  ex: r`An architecture test revealed 140 places where controllers queried EF Core directly in a supposedly layered system; after a cleanup, the test kept the count at zero for two years.`,
  fu: [r`Which fitness function would you introduce first in a legacy system?`, r`How do you handle a necessary exception to a fitness function?`],
  pit: [r`Architecture rules that live only in wiki pages.`, r`Fitness functions with cryptic failures.`, r`Too many checks at once, causing teams to disable them.`] },

{ id: 'q20', level: 'Senior', tags: ['strangler-fig', 'migration', 'routing', 'cdc'],
  q: r`Execute a strangler fig migration of a legacy .NET monolith in detail: choosing the first slice, routing at the edge, data synchronisation (CDC, dual writes, events), handling shared data, and knowing when you are done.`,
  a: r`**Pattern**: build new functionality around the legacy system, gradually routing traffic to new components until the legacy part can be removed — instead of a big-bang rewrite.

**1. Choose the first slice**
- A capability with **clear boundaries**, **business value**, and **manageable data dependencies** (for example statements, notifications, or a new product feature) — not the core ledger first.
- Prefer slices that are read-heavy or have few writers; avoid slices that require changing the monolith's core transactional logic initially.

**2. Routing**
- Place a **routing facade** at the edge (API gateway, YARP reverse proxy, or load balancer rules): requests for migrated routes go to the new service, the rest to the monolith.
- Route by path, then by tenant/percentage for gradual cut-over; keep the old path available for rollback.
- For internal calls inside the monolith, introduce an abstraction (interface) that can call the new service (branch by abstraction).

**3. Data synchronisation**
- **Legacy remains source of truth initially**: new service reads via **CDC** (Debezium/SQL Server CDC) into its own store — read models without changing the monolith.
- **Transition ownership**: when the new service takes over writes, publish events back so the monolith (or its reports) stays consistent, or keep a sync process until the monolith no longer needs the data.
- **Avoid naive dual writes** (writing to both databases from application code without a transaction) — inconsistencies when one write fails. Use outbox/CDC-based synchronisation and reconciliation checks.
- **Shared tables**: identify all readers/writers (database dependency analysis, query logs) before moving ownership; expose data through APIs/events instead of direct table access.

**4. Verify**: parallel runs (compare outputs of old and new for the same inputs), reconciliation reports, observability on both paths.

**5. Done means**: legacy code paths deleted, legacy tables dropped or archived, routing rules simplified, on-call and runbooks updated. Many strangler efforts stall with both systems running forever — track a burn-down of remaining legacy capabilities and set a decommissioning date.`,
  code: r`~~~csharp
// YARP routing facade: migrated routes go to new services, a percentage canary for one route, the rest to legacy
builder.Services.AddReverseProxy().LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));
~~~
~~~json
{
  "ReverseProxy": {
    "Routes": {
      "statements": { "ClusterId": "statements-new", "Match": { "Path": "/api/statements/{**rest}" } },
      "legacy":     { "ClusterId": "monolith", "Order": 1000, "Match": { "Path": "{**catch-all}" } }
    },
    "Clusters": {
      "statements-new": { "Destinations": { "d1": { "Address": "http://statements-svc:8080/" } } },
      "monolith":       { "Destinations": { "d1": { "Address": "http://legacy-portal:80/" } } }
    }
  }
}
~~~`,
  dia: r`flowchart LR
  U[Users] --> F[Routing facade - YARP / gateway]
  F -->|/api/statements| NEW[Statements service]
  F -->|everything else| MONO[Legacy monolith]
  MONO --> LDB[(Legacy DB)]
  LDB -->|CDC| NDB[(Statements read store)]
  NEW --> NDB
  NEW -->|events when owning writes| MONO
  REC[Reconciliation / parallel run] -.compare.-> NEW`,
  pts: [r`Start with a bounded, valuable slice with manageable data dependencies.`, r`Route at the edge; gradual cut-over by path, tenant or percentage.`, r`CDC for read models; outbox/events when ownership moves; avoid naive dual writes.`, r`Verify with parallel runs and reconciliation.`, r`Define done as deletion of legacy code and data; track burn-down.`],
  ex: r`A lender strangled its statements module first using CDC from the legacy SQL Server; after three months of parallel comparison, the legacy statement code and 11 tables were deleted.`,
  fu: [r`How do you handle a capability whose data is written by many legacy modules?`, r`What makes strangler programmes stall?`],
  pit: [r`Starting with the most entangled core capability.`, r`Application-level dual writes without consistency checks.`, r`Never decommissioning the legacy path.`] },

{ id: 'q21', level: 'Senior', tags: ['branch-by-abstraction', 'parallel-run', 'scientist', 'migration'],
  q: r`Explain branch by abstraction and parallel run (dark launching comparisons). How would you replace a fee-calculation engine inside a monolith without a long-lived branch, and verify the new engine on real traffic?`,
  a: r`**Branch by abstraction** (for changes *inside* a codebase, where routing at the edge does not help)
1. Introduce an **abstraction** (interface) in front of the component to replace; make all callers use it (refactoring, no behaviour change).
2. Implement the **new** component behind the same abstraction, merged to main continuously (trunk-based), disabled by default.
3. **Switch** callers to the new implementation gradually (feature flag per caller, tenant or percentage).
4. Remove the old implementation and possibly the abstraction once complete.
No long-lived branches; the system is always releasable.

**Parallel run (shadow comparison)**
- For each real request, run the **old implementation (authoritative)** and the **new implementation (candidate)**, return the old result, and **compare** results asynchronously, logging mismatches.
- Libraries: GitHub's Scientist (Ruby) and **Scientist.NET** for .NET, or custom code with sampling.
- Measure mismatch rate by category, latency of both, exceptions. Investigate mismatches: bugs in the new engine, bugs discovered in the old one, or acceptable differences (rounding policy changes — decide explicitly).

**Fee engine example**
- {{IFeeCalculator}} abstraction; {{LegacyFeeCalculator}} wraps existing code; {{RulesFeeCalculator}} is new.
- Phase 1: parallel run on 100% of traffic in production for read-only computation (no side effects), compare results.
- Phase 2: when mismatch rate is zero (or only accepted differences) for an agreed period covering month-end and edge cases, switch authoritative calculation to the new engine for one merchant segment via flag.
- Phase 3: expand, then delete legacy code.

**Cautions**: parallel runs must be **side-effect free** for the candidate (no payments, no emails, no writes to shared state) or use sandboxes; account for extra CPU/latency (run candidate async or sampled); protect sensitive data in mismatch logs.`,
  code: r`~~~csharp
public interface IFeeCalculator { Fee Calculate(FeeContext ctx); }

// Parallel run: legacy result is authoritative; candidate compared and logged, never returned
public sealed class ExperimentFeeCalculator(LegacyFeeCalculator legacy, RulesFeeCalculator candidate,
    IFeatureFlags flags, ILogger<ExperimentFeeCalculator> log, Meter meter) : IFeeCalculator
{
    private readonly Counter<long> _mismatch = meter.CreateCounter<long>("fee_engine_mismatch_total");

    public Fee Calculate(FeeContext ctx)
    {
        if (flags.IsEnabled("fees.rules-engine.authoritative", ctx.MerchantId))
            return candidate.Calculate(ctx);                              // phase 2+: switched segments

        var control = legacy.Calculate(ctx);
        try
        {
            var trial = candidate.Calculate(ctx);                         // pure function: no side effects
            if (trial.AmountMinor != control.AmountMinor)
            {
                _mismatch.Add(1, new KeyValuePair<string, object?>("product", ctx.Product));
                log.LogWarning("Fee mismatch {Merchant} {Product}: legacy={Legacy} new={New}",
                    ctx.MerchantId, ctx.Product, control.AmountMinor, trial.AmountMinor);
            }
        }
        catch (Exception ex) { log.LogError(ex, "Candidate fee engine failed"); }
        return control;
    }
}
~~~`,
  dia: r`flowchart LR
  CALL[Callers] --> ABS[IFeeCalculator abstraction]
  ABS --> EXP[Experiment wrapper]
  EXP -->|authoritative| OLD[Legacy fee calculator]
  EXP -->|shadow, compare| NEW[Rules fee engine]
  EXP --> MET[Mismatch metrics + logs]
  FLAG[Flag per merchant segment] -->|switch| NEW`,
  pts: [r`Branch by abstraction replaces internals on trunk via an interface and flags.`, r`Parallel run compares old and new on real traffic, returning the old result.`, r`Measure mismatches, latency and errors; resolve each mismatch category.`, r`Switch authoritative implementation gradually by segment.`, r`Candidates must be side-effect free; protect data in logs.`],
  ex: r`A parallel run of a new fee engine found 0.3% mismatches, half of which were long-standing rounding bugs in the legacy engine affecting merchant invoices; finance approved the corrected behaviour before cut-over.`,
  fu: [r`How do you run a parallel comparison for an operation with side effects?`, r`How long should a parallel run last?`],
  pit: [r`Long-lived feature branches for replacements.`, r`Candidates that write to shared state.`, r`Ignoring mismatches as noise.`] },

{ id: 'q22', level: 'Senior', tags: ['anti-corruption-layer', 'legacy', 'vendor', 'translation'],
  q: r`Design an anti-corruption layer between a new payments domain and a legacy core banking system (or vendor API): responsibilities, translation of models and semantics, error and status mapping, and where the ACL should live.`,
  a: r`**Purpose** (from DDD): protect a bounded context's model from being shaped by another system's model, especially legacy or third-party systems with awkward semantics. The ACL translates both ways so the new domain speaks its own language.

**Responsibilities**
- **Model translation**: legacy "Party/Arrangement/Posting codes" → domain "Customer/Account/Transfer"; flatten or enrich structures; units and formats (amounts in cents vs decimals, local time vs UTC, status codes).
- **Semantic translation**: map meanings, not just fields — a legacy status "07" may mean "pending compliance review" in one product and "rejected" in another depending on a flag.
- **Protocol adaptation**: SOAP, MQ, fixed-width files, mainframe CICS/IMS gateways → domain interfaces (async messaging, HTTP).
- **Error and status mapping**: legacy error codes → domain exceptions/results with retry classification (transient vs permanent vs unknown outcome).
- **Resilience**: timeouts, retries with idempotency (legacy systems often lack idempotency — use business references and check-before-retry), circuit breakers, bulkheads, rate limiting to protect fixed-capacity systems.
- **Data quality defences**: validate and sanitise legacy data; handle nulls, encodings (EBCDIC), duplicates.
- **Observability**: log translations and correlation IDs; metrics per legacy operation.

**Structure**: a **facade** (domain-facing interface: {{ICoreBanking.PostTransferAsync}}), **adapters** (protocol clients), **translators** (mapping), and optionally a **separate deployable** (integration service) when several contexts need the same legacy capability or when the legacy protocol requires special infrastructure (MQ clients, VPN, certificates).

**Where it lives**
- Inside the bounded context (an infrastructure adapter) when only one context integrates.
- As a dedicated integration service owned by the team closest to the legacy system when multiple contexts use it — but keep it a translator, not a new home for business logic.

**Testing**: contract tests against recorded legacy responses, a simulator for the legacy system in CI, and reconciliation in production.`,
  code: r`~~~csharp
// Domain-facing port
public interface ICoreBankingLedger
{
    Task<PostingResult> PostTransferAsync(Transfer transfer, CancellationToken ct);
}

// ACL adapter: translation + error semantics + check-before-retry for a non-idempotent legacy API
internal sealed class CoreBankingLedgerAdapter(LegacySoapClient soap, ILogger<CoreBankingLedgerAdapter> log) : ICoreBankingLedger
{
    public async Task<PostingResult> PostTransferAsync(Transfer t, CancellationToken ct)
    {
        var request = new LegacyPostingRequest
        {
            TxnRef     = t.Id.ToString("N")[..16].ToUpperInvariant(),      // legacy max 16 chars, our business reference
            DebitAcct  = LegacyAccount.From(t.From), CreditAcct = LegacyAccount.From(t.To),
            AmountCcy  = t.Amount.Currency, AmountCents = t.Amount.MinorUnits,
            ValueDate  = t.ValueDate.ToString("yyyyMMdd")
        };
        try
        {
            var resp = await soap.PostAsync(request, ct);
            return resp.ReturnCode switch
            {
                "00" => PostingResult.Posted(resp.JournalId),
                "07" when resp.ReasonFlag == "C" => PostingResult.PendingReview(),
                "51" => PostingResult.Rejected(RejectReason.InsufficientFunds),
                "91" => PostingResult.Transient("core unavailable"),
                _    => PostingResult.Rejected(RejectReason.Other(resp.ReturnCode))
            };
        }
        catch (TimeoutException)
        {
            // Unknown outcome: query by reference before any retry (legacy API is not idempotent)
            var existing = await soap.FindByTxnRefAsync(request.TxnRef, ct);
            return existing is null ? PostingResult.Transient("timeout, not posted") : PostingResult.Posted(existing.JournalId);
        }
    }
}
~~~`,
  dia: r`flowchart LR
  DOM[Payments domain - Transfer, Account] -->|ICoreBankingLedger port| ACL[Anti-corruption layer]
  ACL --> TR[Translator: models, units, statuses]
  ACL --> AD[Adapter: SOAP/MQ, timeouts, check-before-retry]
  AD --> CORE[Legacy core banking]
  ACL --> OBS[Correlation + metrics]`,
  pts: [r`An ACL protects your model from legacy or vendor models.`, r`Translate models, units and semantics, not just fields.`, r`Map errors into retry classes; handle unknown outcomes with check-before-retry.`, r`Add resilience to protect fixed-capacity legacy systems.`, r`Keep ACLs translators; separate deployable only when shared or infrastructure-heavy.`],
  ex: r`A legacy core returned status "07" for both compliance holds and rejections depending on a flag; encoding that semantic rule in the ACL stopped the new payments service from treating held transfers as failed and re-submitting them.`,
  fu: [r`How do you test an ACL when the legacy system has no test environment?`, r`When does an ACL become a liability?`],
  pit: [r`Letting legacy terms leak into the domain model.`, r`Blind retries against non-idempotent legacy APIs.`, r`Business logic accumulating in the ACL.`] },

{ id: 'q23', level: 'Senior', tags: ['data-migration', 'dual-writes', 'cdc', 'verification'],
  q: r`Migrate data ownership from a legacy database to a new service with zero downtime: why naive dual writes fail, CDC-based migration, backfill, verification and reconciliation, cut-over and rollback.`,
  a: r`**Why naive dual writes fail**: the application writes to the old and new databases in sequence without a shared transaction. Any failure between the two writes (crash, timeout, network error) leaves them inconsistent; concurrent updates can be applied in different orders; retries can duplicate. Over millions of operations, divergence is guaranteed.

**Safer migration sequence**
1. **Prepare**: design the new schema/model; build the new service in read-only mode.
2. **Backfill**: copy historical data in batches (snapshot) with idempotent upserts, throttled to protect the legacy database.
3. **Sync ongoing changes with CDC** from the legacy database (Debezium/SQL Server CDC/DMS) into the new store, transforming as needed — preserves order per key and survives restarts via offsets. Start CDC **before** the snapshot finishes and reconcile overlap (CDC from a recorded log position).
4. **Verify continuously**: row counts, checksums/hashes per partition, sampled field-by-field comparisons, business-level reconciliation (balances match), mismatch dashboards.
5. **Shadow reads**: serve reads from the new store for internal comparison, then for a percentage of users.
6. **Cut over writes**: switch the writer to the new service (brief write freeze of seconds/minutes if needed, or per-tenant cut-over). Then **reverse sync**: the new service publishes changes (outbox/CDC) back to the legacy database for remaining legacy readers and as a **rollback path**.
7. **Decommission**: once no consumers read the legacy data, stop reverse sync, archive and drop.

**Alternatives**: transactional outbox in the legacy app (if you can change it) to emit events in the same transaction; **write to new, CDC to old** after cut-over.

**Rollback**: until decommissioning, keep the legacy store updated by reverse sync so routing writes back to the legacy system is possible; define rollback criteria and rehearse.

**Risks**: schema mismatches and data quality issues found late (profile data early), CDC lag during peaks, hot partitions, time zone/precision differences (money!), and long-running coexistence.`,
  code: r`~~~sql
-- Verification: compare per-day aggregates between legacy and new stores (run continuously, alert on drift)
SELECT l.booking_date,
       l.txn_count  AS legacy_count,  n.txn_count  AS new_count,
       l.sum_minor  AS legacy_sum,    n.sum_minor  AS new_sum,
       CASE WHEN l.txn_count = n.txn_count AND l.sum_minor = n.sum_minor THEN 'OK' ELSE 'DRIFT' END AS status
FROM   legacy_daily_totals l
FULL JOIN new_daily_totals n ON n.booking_date = l.booking_date
WHERE  coalesce(l.booking_date, n.booking_date) >= current_date - 30
ORDER  BY 1 DESC;
~~~
~~~csharp
// CDC consumer: idempotent upsert keyed by business id, version check prevents out-of-order overwrite
public async Task HandleAsync(LegacyTxnChanged e, CancellationToken ct)
{
    var rows = await _db.Database.ExecuteSqlInterpolatedAsync($"""
        INSERT INTO transactions (txn_id, account_id, amount_minor, currency, status, source_lsn)
        VALUES ({e.TxnId}, {e.AccountId}, {e.AmountMinor}, {e.Currency}, {e.Status}, {e.Lsn})
        ON CONFLICT (txn_id) DO UPDATE SET amount_minor = EXCLUDED.amount_minor, status = EXCLUDED.status, source_lsn = EXCLUDED.source_lsn
        WHERE transactions.source_lsn < EXCLUDED.source_lsn
        """, ct);
}
~~~`,
  dia: r`flowchart LR
  LEG[(Legacy DB - writer)] -->|snapshot backfill| NEW[(New service DB)]
  LEG -->|CDC ongoing| NEW
  VER[Verification: counts, checksums, balances] -.compare.-> LEG
  VER -.compare.-> NEW
  CUT[Cut-over: writes to new service] --> NEW
  NEW -->|reverse sync - rollback path| LEG`,
  pts: [r`Naive dual writes diverge on partial failures and races.`, r`Backfill plus CDC from a recorded log position keeps the new store in sync.`, r`Verify continuously with counts, checksums and business reconciliation.`, r`Shadow reads, then cut over writes with reverse sync as the rollback path.`, r`Decommission legacy only when no readers remain.`],
  ex: r`A card platform migrated 2 billion transactions to a new store with CDC and daily balance reconciliation; verification caught a timezone conversion bug affecting 0.01% of records before any customer saw it.`,
  fu: [r`How do you handle CDC lag spikes during month-end?`, r`What would make you abort the cut-over?`],
  pit: [r`Application-level dual writes as the migration strategy.`, r`Verification only by row counts.`, r`No rollback path after cut-over.`] },

{ id: 'q24', level: 'Senior', tags: ['trade-off-analysis', 'atam', 'decision-matrix', 'risk-storming'],
  q: r`How do you perform rigorous architecture trade-off analysis? Explain ATAM-style evaluation, weighted decision matrices, sensitivity and trade-off points, risk storming, and how to avoid analysis paralysis.`,
  a: r`**ATAM (Architecture Tradeoff Analysis Method, SEI)** — a structured evaluation:
1. Present business drivers and the architecture.
2. Elicit **quality attribute scenarios** and prioritise them (utility tree: attribute → refinement → scenario, rated by business importance and difficulty).
3. Analyse how architectural approaches satisfy high-priority scenarios.
4. Identify **sensitivity points** (decisions that strongly affect one attribute — partition count affects throughput), **trade-off points** (decisions affecting several attributes in opposite directions — synchronous replication improves durability, worsens latency), **risks** and **non-risks**.
5. Summarise risk themes linked to business drivers.
Full ATAM is heavyweight; lightweight versions (a half-day workshop) capture most of the value.

**Weighted decision matrix**: criteria derived from the prioritised attributes and constraints (consistency, latency, operability, cost, team skills, lock-in, time to market), weights agreed **before** scoring, options scored with evidence (benchmarks, PoCs, references). Do **sensitivity analysis**: does the winner change if weights shift slightly? If yes, the decision is close — look for decisive criteria or reversible choices.

**Risk storming** (Simon Brown): participants independently mark risks on architecture diagrams (likelihood × impact), then converge; quickly surfaces unknowns (single points of failure, unproven technology, data migration risks).

**Other tools**: pre-mortems ("it is a year later and this failed — why?"), cost of delay, spike/PoC for the riskiest assumption, comparison against reference architectures.

**Avoiding analysis paralysis**
- Distinguish **one-way doors** (hard to reverse: data store for a ledger, cloud provider) from **two-way doors** (easy to change) — spend analysis effort only on one-way doors (q25).
- Time-box decisions; define the "last responsible moment".
- Test the riskiest assumption with a small experiment instead of more discussion.
- Decide, document (ADR) with revisit triggers, and monitor with fitness functions.`,
  code: r`~~~text
Utility tree (excerpt) - payments platform
Availability
  (H,M) AZ failure at peak: < 0.1% failed authorisations, recovery < 60 s
  (H,H) Region failure: RTO 15 min, RPO 5 s
Performance
  (H,M) 3,000 TPS peak, p99 < 300 ms for authorisation
Modifiability
  (M,L) New payment method added by one team within 4 weeks
Security
  (H,M) Compromised API credential cannot initiate payouts above limits without step-up

Sensitivity point: Kafka partition count -> consumer parallelism -> settlement throughput
Trade-off point:  synchronous cross-region replication -> RPO 0 but +40 ms latency on every write
Risk:             single PSP for EU cards (no failover)        Non-risk: stateless API tier scaling
~~~`,
  dia: r`flowchart LR
  DRV[Business drivers] --> UT[Utility tree: prioritised scenarios]
  UT --> AN[Analyse approaches vs scenarios]
  AN --> SP[Sensitivity points]
  AN --> TP[Trade-off points]
  AN --> RK[Risks / non-risks]
  RK --> DM[Decision matrix + sensitivity analysis]
  DM --> ADR[ADR + revisit triggers]`,
  pts: [r`ATAM: scenarios, utility tree, sensitivity and trade-off points, risks.`, r`Weighted matrices with weights agreed first and sensitivity analysis.`, r`Risk storming and pre-mortems surface unknowns quickly.`, r`Spend analysis effort on one-way doors; time-box and spike risky assumptions.`, r`Decide, document and monitor.`],
  ex: r`A lightweight ATAM workshop for a new payouts platform identified that synchronous cross-region replication would push p99 latency past the SLO; the team chose asynchronous replication with reconciliation, accepting a 5-second RPO approved by the business.`,
  fu: [r`How do you prevent stakeholders from gaming decision-matrix weights?`, r`When is a full ATAM worth the effort?`],
  pit: [r`Matrices with weights chosen after scoring.`, r`Analysing two-way-door decisions at length.`, r`Ignoring sensitivity analysis on close results.`] },

{ id: 'q25', level: 'Senior', tags: ['reversibility', 'one-way-doors', 'last-responsible-moment', 'options'],
  q: r`How do reversibility and timing shape architecture decisions? Explain one-way versus two-way doors, the last responsible moment, options thinking, and techniques that make decisions cheaper to reverse.`,
  a: r`**One-way vs two-way doors** (Amazon's framing)
- **Two-way doors**: reversible at low cost — a library choice behind an interface, a feature behind a flag, an internal API between two services owned by one team. Decide fast, delegate, learn.
- **One-way doors**: costly or impossible to reverse — the data store for a core ledger, public API contracts with external partners, a cloud provider for regulated workloads, data models that propagate into many systems, regulatory commitments. Slow down, analyse, involve the right people.

**Last responsible moment**: delay irreversible decisions until the point where **not deciding** starts eliminating important options or blocking progress — you gain information meanwhile. Not "as late as possible": waiting too long has its own cost (teams build on assumptions anyway).

**Options thinking**: architecture creates options (the ability, not the obligation, to do something later). Options have value when uncertainty is high and cost little to keep open (an abstraction over a payment provider; a modular monolith with clear seams). Do not buy options you will never exercise (speculative generality).

**Techniques that improve reversibility**
- **Abstractions at volatile boundaries** (ports and adapters for external providers, storage, messaging) — but only where change is plausible.
- **Feature flags** and **progressive delivery** for behaviour changes.
- **Versioned APIs and events**, tolerant readers, additive changes.
- **Expand/contract** for schemas.
- **Modular boundaries** that keep data ownership local (extraction later is cheaper).
- **Strangler and branch-by-abstraction** for replacement.
- **Data portability**: open formats, export capabilities, avoiding proprietary features in core data unless justified.
- **Contracts with exit clauses** for vendors (regulatory exit strategies under DORA).
- **Spikes and PoCs** to buy information before committing.

**Cost framing for stakeholders**: decision cost = analysis cost + cost of being wrong × probability of being wrong. Reversible designs lower the cost of being wrong, which lets teams decide faster.`,
  code: r`~~~csharp
// Keep a plausible-to-change boundary reversible: the domain depends on a port, not a provider SDK
public interface IPaymentProvider
{
    Task<AuthorisationResult> AuthoriseAsync(AuthorisationRequest request, CancellationToken ct);
}

// Two adapters can coexist; routing by flag makes the provider switch a two-way door
public sealed class RoutingPaymentProvider(IFeatureFlags flags,
    [FromKeyedServices("adyen")] IPaymentProvider adyen,
    [FromKeyedServices("stripe")] IPaymentProvider stripe) : IPaymentProvider
{
    public Task<AuthorisationResult> AuthoriseAsync(AuthorisationRequest req, CancellationToken ct) =>
        flags.IsEnabled("psp.stripe", req.MerchantId) ? stripe.AuthoriseAsync(req, ct) : adyen.AuthoriseAsync(req, ct);
}
~~~`,
  dia: r`flowchart TD
  D[Decision] --> R{Reversible cheaply?}
  R -->|two-way door| FAST[Decide fast, delegate, learn]
  R -->|one-way door| SLOW[Analyse, involve stakeholders, ADR]
  SLOW --> LRM[Decide at last responsible moment]
  SLOW --> MAKE[Make it reversible: ports, flags, versioning, expand/contract]
  MAKE --> FAST`,
  pts: [r`Separate one-way doors from two-way doors and spend effort accordingly.`, r`Decide irreversible matters at the last responsible moment, not later.`, r`Architecture creates options; buy only those with real value.`, r`Ports, flags, versioning, expand/contract and modular data increase reversibility.`, r`Lower the cost of being wrong to decide faster.`],
  ex: r`Keeping the PSP behind a port with a routing adapter turned a forced provider change (pricing dispute) into a three-week gradual migration instead of a six-month rewrite.`,
  fu: [r`Which decisions in a payments platform are true one-way doors?`, r`How do you avoid speculative generality while keeping options?`],
  pit: [r`Treating every decision as irreversible.`, r`Abstracting everything "just in case".`, r`Delaying decisions until teams build on guesses.`] },

{ id: 'q26', level: 'Senior', tags: ['architecture-governance', 'principles', 'review-boards', 'guardrails'],
  q: r`Set up architecture governance for 30 teams without becoming an ivory tower: principles, standards, review forums, guardrails, inner source, and how architects stay connected to delivery.`,
  a: r`**Goals of governance**: consistency where it matters (security, interoperability, operability, compliance), good decisions on one-way doors, knowledge sharing — while preserving team autonomy and speed.

**Layers of governance (lightest first)**
1. **Principles** (a handful, with rationale): "Each service owns its data", "Async by default between bounded contexts", "No shared databases", "Security and observability by default", "Prefer managed services".
2. **Standards and paved roads**: API guidelines (OpenAPI, versioning, error format), event standards (schema registry, naming), golden templates, approved data stores/messaging — encoded in platforms and templates so following them is easiest.
3. **Guardrails as code**: fitness functions, policy as code, CI checks (API breaking-change detection, architecture tests), cloud policies — automatic and consistent.
4. **Decision records**: teams write ADRs; significant ones are reviewed openly (RFC process) by affected teams and architects.
5. **Review forums** for genuinely high-impact decisions only (new data store types, cross-domain integration patterns, regulated data, major vendor choices): an architecture advisory forum that gives advice and recorded decisions — time-boxed, published agendas, open to everyone.

**Avoiding the ivory tower**
- Architects **embedded** with domains, contributing code, pairing, joining design sessions — not just reviewing documents.
- Advice-process model: anyone can make a decision after seeking advice from affected people and experts.
- Measure governance by outcomes (fewer incidents from integration issues, lead time unaffected), not by number of reviews.
- Exceptions process: time-bound, explicit; recurring exceptions trigger standard updates.

**Inner source and communities**: shared libraries and platform components accept contributions; guilds/communities of practice (API, data, security) evolve standards; architecture katas and design reviews as learning.

**Tech radar**: adopt/trial/assess/hold for technologies, maintained collaboratively — guidance without mandates for every choice.`,
  code: r`~~~markdown
# Architecture principles (v3) - Payments & Banking Platforms
1. Services own their data. No shared databases across team boundaries.            (ADR-0003)
2. Async events between bounded contexts; sync calls only for immediate decisions.  (ADR-0009)
3. Every public API: OpenAPI, versioned, problem-details errors, idempotency keys for writes. (STD-API-01)
4. Security by default: workload identity, no long-lived secrets, encryption everywhere. (STD-SEC-02)
5. Observable by default: OpenTelemetry traces, SLOs for tier 0/1 journeys.          (STD-OPS-01)
6. Prefer managed services; self-host only with an ADR showing why.                 (ADR-0015)
Exceptions: time-bound, recorded in /exceptions with owner and expiry.
Advisory forum: Thursdays 30 min, agenda public; decisions published as ADRs.
~~~`,
  dia: r`flowchart TB
  P[Principles] --> S[Standards + paved roads]
  S --> G[Guardrails as code: fitness functions, policies]
  G --> T[Teams decide - ADRs, advice process]
  T -->|one-way doors| F[Advisory forum - open, time-boxed]
  F --> ADR[Published decisions]
  ARCH[Embedded architects] -.pair, code, advise.-> T
  T -->|exceptions, feedback| S`,
  pts: [r`Governance aims for consistency where it matters, not control everywhere.`, r`Principles, paved roads, guardrails as code, ADRs, forums for high-impact decisions.`, r`Embed architects in delivery; use an advice process.`, r`Time-bound exceptions feed standard updates.`, r`Inner source, guilds and a tech radar spread knowledge.`],
  ex: r`A bank replaced a weekly architecture review board (6-week queue) with guardrails as code, an open RFC process and a 30-minute advisory forum; decision lead time fell to days while integration incidents dropped.`,
  fu: [r`How do you handle a team that ignores a principle?`, r`What decisions should never be fully delegated to teams?`],
  pit: [r`Review boards for every change.`, r`Standards without paved roads or automation.`, r`Architects disconnected from code and production.`] },

{ id: 'q27', level: 'Senior', tags: ['data-architecture', 'database-per-service', 'reporting', 'data-mesh'],
  q: r`Design data architecture across services: database per service versus shared database, polyglot persistence, handling cross-service queries and reporting (API composition, CQRS views, data warehouse/lakehouse), and where data mesh fits.`,
  a: r`**Database per service**: each service owns its schema and is the only one that reads/writes it directly. Others access the data via APIs or events. Enables independent deployment, technology choice and scaling; prevents hidden coupling. "Per service" can mean separate schemas on a shared server (cheaper) as long as access is enforced.

**Shared database**: simple joins and transactions, but schema changes break unknown consumers, ownership blurs, and performance contention spreads. Acceptable inside one service or modular monolith module; not across teams.

**Polyglot persistence**: choose stores by access pattern — relational for transactional integrity (ledger), document or key-value for flexible/high-scale lookups (session, profiles), search engines for full-text, time-series for metrics, graph for relationships (fraud rings). Cost: more technologies to operate and secure; standardise a small approved set.

**Cross-service queries**
- **API composition**: a composer (BFF/gateway) calls several services and joins in memory — fine for small result sets; latency and availability multiply.
- **CQRS read models / materialised views**: services subscribe to events and maintain query-optimised views (for example an "account overview" view combining accounts, cards, recent payments) — fast reads, eventual consistency.
- **Event-carried state transfer** for local copies of reference data.

**Reporting and analytics**
- Do not query operational databases for heavy analytics.
- Stream events/CDC into a **data warehouse or lakehouse** (Snowflake, BigQuery, Databricks, Synapse/Fabric) with modelled datasets; regulatory reporting from curated layers with lineage.

**Data mesh**: domain teams own **data products** (curated, documented, with SLAs and quality checks) published for analytical consumption, with a self-serve data platform and federated governance. Fits large organisations where a central data team is a bottleneck; requires data engineering capability in domains and strong platform support — not a starting point for small organisations.

**Governance**: data classification, ownership catalogue, lineage, retention and residency policies, PII handling (masking, tokenisation) across all copies.`,
  code: r`~~~csharp
// Read model maintained from events: account overview for the customer portal (no cross-service joins at query time)
public sealed class AccountOverviewProjection(OverviewDbContext db) :
    IEventHandler<AccountOpened>, IEventHandler<CardIssued>, IEventHandler<PaymentCaptured>
{
    public async Task HandleAsync(AccountOpened e, CancellationToken ct)
    {
        db.Overviews.Add(new AccountOverview { AccountId = e.AccountId, CustomerId = e.CustomerId, Iban = e.Iban });
        await db.SaveChangesAsync(ct);
    }
    public async Task HandleAsync(CardIssued e, CancellationToken ct)
    {
        var o = await db.Overviews.FindAsync([e.AccountId], ct);
        if (o is null || o.CardIds.Contains(e.CardId)) return;          // idempotent
        o.CardIds.Add(e.CardId); await db.SaveChangesAsync(ct);
    }
    public async Task HandleAsync(PaymentCaptured e, CancellationToken ct)
    {
        var o = await db.Overviews.FindAsync([e.AccountId], ct);
        if (o is null || o.LastPaymentEventId >= e.Sequence) return;
        o.RecentPayments.Insert(0, new RecentPayment(e.PaymentId, e.AmountMinor, e.Currency, e.OccurredAt));
        o.RecentPayments = o.RecentPayments.Take(10).ToList(); o.LastPaymentEventId = e.Sequence;
        await db.SaveChangesAsync(ct);
    }
}
~~~`,
  dia: r`flowchart LR
  ACC[Accounts svc] --> DB1[(Accounts DB)]
  CRD[Cards svc] --> DB2[(Cards DB)]
  PAY[Payments svc] --> DB3[(Payments DB)]
  ACC -->|events| BUS[[Event broker]]
  CRD -->|events| BUS
  PAY -->|events| BUS
  BUS --> VIEW[(Account overview read model)]
  BUS --> LAKE[(Lakehouse - curated data products)]
  LAKE --> REG[Regulatory reporting]
  VIEW --> BFF[Portal BFF]`,
  pts: [r`Each service owns its data; others use APIs or events.`, r`Shared databases only within one ownership boundary.`, r`Polyglot persistence by access pattern, from a small approved set.`, r`Cross-service queries via API composition or event-fed read models.`, r`Analytics via warehouse/lakehouse; data mesh for large orgs with mature platforms.`],
  ex: r`A bank's customer portal joined five services' tables directly; after moving to an event-fed overview read model, the portal's p99 dropped from 1.8 s to 120 ms and schema changes stopped breaking it.`,
  fu: [r`How do you handle GDPR erasure across event-fed copies?`, r`When is API composition better than a read model?`],
  pit: [r`Shared databases across teams.`, r`Analytics queries on operational databases.`, r`Adopting data mesh without platform and domain capability.`] },

{ id: 'q28', level: 'Senior', tags: ['caching-architecture', 'invalidation', 'cdn', 'consistency'],
  q: r`Design a caching architecture across layers — browser, CDN, gateway, application (in-memory and distributed), database — including invalidation strategies, consistency trade-offs, stampede protection, and what must never be cached in a bank.`,
  a: r`**Layers**
| Layer | Examples | Good for |
|---|---|---|
| Browser/client | HTTP cache headers, service worker, SPA state | static assets, user-specific data briefly |
| CDN/edge | CloudFront, Front Door, Cloudflare | static assets, public content, public reference data |
| Gateway/reverse proxy | API gateway caching, output caching | public or shared API responses |
| Application in-memory | {{IMemoryCache}}, {{HybridCache}} (L1) | hot reference data per instance |
| Distributed cache | Redis/Valkey (L2) | shared data across instances, sessions, rate limits |
| Database | buffer pool, materialised views, read replicas | query acceleration |

**Patterns**: cache-aside (most common), read-through/write-through (via caching libraries or providers), write-behind (risky for money), refresh-ahead for hot keys.

**Invalidation strategies**
- **TTL** (time-based): simple; bounded staleness.
- **Explicit invalidation on write**: delete keys after updates (delete rather than set to avoid races); publish invalidation events to all instances for L1 caches (Redis pub/sub, backplane).
- **Versioned keys**: include a version or hash in the key (asset fingerprints, {{config:v42}}), making old entries irrelevant.
- **Event-driven refresh**: consumers update caches from domain events.

**Consistency trade-offs**: every cache is a replica; decide acceptable staleness per data type (FX reference rates: seconds; product catalogue: minutes; account balance: none for decisions). Use cache for **display**, not for **decisions** that move money.

**Stampede protection**: request coalescing/single-flight ({{HybridCache}} does this), per-key locks, jittered TTLs, stale-while-revalidate, pre-warming.

**Never (or very carefully) cache in a bank**
- Authorisation decisions and balances used for spending checks — read from the system of record.
- Idempotency records only in cache (losing them means double charges).
- Personalised responses in shared caches without identity in the key (data leaks across customers).
- Sensitive data (PAN, tokens) in browser caches or CDN logs ({{Cache-Control: no-store}}).
- Security-relevant permission data for too long (revocation delays) — short TTLs plus invalidation.`,
  code: r`~~~csharp
// .NET 9 HybridCache: L1 in-memory + L2 Redis, stampede protection built in, tag-based invalidation
builder.Services.AddStackExchangeRedisCache(o => o.Configuration = builder.Configuration["Redis"]);
builder.Services.AddHybridCache(o => o.DefaultEntryOptions = new HybridCacheEntryOptions
{
    Expiration = TimeSpan.FromMinutes(5), LocalCacheExpiration = TimeSpan.FromSeconds(30)
});

public sealed class MerchantConfigService(HybridCache cache, IMerchantRepository repo)
{
    public ValueTask<MerchantConfig> GetAsync(string merchantId, CancellationToken ct) =>
        cache.GetOrCreateAsync($"merchant-config:v2:{merchantId}",
            async token => await repo.GetConfigAsync(merchantId, token),      // only one caller loads on a miss
            tags: [$"merchant:{merchantId}"], cancellationToken: ct);

    public async Task UpdateAsync(MerchantConfig cfg, CancellationToken ct)
    {
        await repo.SaveAsync(cfg, ct);
        await cache.RemoveByTagAsync($"merchant:{cfg.MerchantId}", ct);       // invalidate after the write commits
    }
}
~~~`,
  dia: r`flowchart LR
  B[Browser cache] --> CDN[CDN / edge]
  CDN --> GW[Gateway output cache]
  GW --> APP[App: L1 in-memory]
  APP --> L2[(L2 Redis)]
  L2 --> DB[(System of record)]
  EVT[Domain events / invalidation messages] -.invalidate.-> APP
  EVT -.invalidate.-> L2
  DEC[Balance checks, idempotency] -->|bypass cache| DB`,
  pts: [r`Cache at the right layer for each data type.`, r`TTL, delete-on-write, versioned keys and event-driven invalidation.`, r`Each cache is a replica: decide staleness per data type; never decide money from caches.`, r`Protect against stampedes with coalescing, jitter and stale-while-revalidate.`, r`Never cache balances for decisions, idempotency-only state, or personalised data without identity keys.`],
  ex: r`A bank cached card spending limits for 10 minutes to cut database load; customers could exceed limits after a change. Limits moved to the system of record with a 5-second local cache only for display.`,
  fu: [r`How do you invalidate L1 caches across 50 instances?`, r`What does HybridCache add over IDistributedCache?`],
  pit: [r`Caching decision-critical financial data.`, r`Shared caches keyed without user identity.`, r`Synchronised TTL expiry causing stampedes.`] },

{ id: 'q29', level: 'Senior', tags: ['resilience', 'bulkhead', 'circuit-breaker', 'load-shedding'],
  q: r`Design resilience into an architecture: timeouts, retries with budgets, circuit breakers, bulkheads, load shedding, backpressure, graceful degradation and fallbacks — and how these interact to prevent cascading failures.`,
  a: r`**Cascading failure anatomy**: a slow dependency makes callers wait; threads/connections pile up; callers become slow; their callers wait — the whole system degrades. Retries add load at the worst moment (retry storms).

**Patterns and how they combine**
- **Timeouts** on every remote call, set from the dependency's latency SLO and the caller's own budget (deadline propagation: a 2-second request cannot give a downstream call 5 seconds).
- **Retries** only for transient, idempotent operations, with **exponential backoff + jitter** and a **retry budget** (for example retries may add at most 10% extra load); retry at one layer only.
- **Circuit breakers**: after a failure ratio threshold, stop calling for a period (fail fast), then probe (half-open). Protects the dependency and frees caller resources.
- **Bulkheads**: isolate resources per dependency or per tenant/priority (separate connection pools, thread pools, concurrency limits, separate deployments/cells) so one failing dependency cannot consume everything.
- **Load shedding**: reject excess requests early (429/503 with Retry-After) when saturated, prioritising critical traffic (payments over statement downloads); admission control at the edge.
- **Backpressure**: bounded queues and flow control so producers slow down instead of exhausting memory.
- **Graceful degradation / fallbacks**: serve cached or default responses, disable non-essential features (recommendations), queue writes for later, switch to a secondary provider (PSP failover).
- **Hedged requests** (send a second request after p95 latency) for idempotent reads — reduce tail latency at extra cost.

**Order inside a call path (.NET resilience pipelines)**: outer total timeout → retry (with jitter, limited) → circuit breaker → attempt timeout → concurrency limiter (bulkhead). The standard resilience handler in .NET (Microsoft.Extensions.Http.Resilience, built on Polly v8) packages sensible defaults.

**Design-level resilience**: asynchronous integration where possible, static stability (q36 AWS), cells, idempotency for safe retries, and **testing** with chaos experiments and fault injection.`,
  code: r`~~~csharp
// Resilience pipeline for PSP calls: total timeout, limited retries with jitter, breaker, per-attempt timeout, bulkhead
builder.Services.AddHttpClient<IPspClient, PspClient>()
    .AddResilienceHandler("psp", p =>
    {
        p.AddTimeout(TimeSpan.FromSeconds(4));                                       // total budget for the call
        p.AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = 2, BackoffType = DelayBackoffType.Exponential, UseJitter = true,
            ShouldHandle = args => ValueTask.FromResult(args.Outcome.Result?.StatusCode is HttpStatusCode.ServiceUnavailable
                                                        || args.Outcome.Exception is HttpRequestException)  // only transient
        });
        p.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
        {
            FailureRatio = 0.3, MinimumThroughput = 50, SamplingDuration = TimeSpan.FromSeconds(30), BreakDuration = TimeSpan.FromSeconds(20)
        });
        p.AddTimeout(TimeSpan.FromMilliseconds(1200));                               // per attempt
        p.AddConcurrencyLimiter(permitLimit: 200, queueLimit: 50);                   // bulkhead for this dependency
    });

// Load shedding at the edge: rate limiter rejects early with 429 for non-critical routes
builder.Services.AddRateLimiter(o => o.AddConcurrencyLimiter("statements", c => { c.PermitLimit = 100; c.QueueLimit = 0; }));
~~~`,
  dia: r`flowchart LR
  IN[Incoming requests] --> SHED[Load shedding / admission control]
  SHED --> APP[Service]
  APP --> TO[Total timeout]
  TO --> RT[Retry with jitter + budget]
  RT --> CB[Circuit breaker]
  CB --> AT[Attempt timeout]
  AT --> BH[Bulkhead: concurrency limit]
  BH --> DEP[PSP dependency]
  CB -->|open| FB[Fallback: secondary PSP / queue / degrade]`,
  pts: [r`Cascades come from waiting, resource exhaustion and retry storms.`, r`Timeouts everywhere with deadline propagation; retries only for transient idempotent calls, with budgets.`, r`Circuit breakers fail fast; bulkheads isolate resources.`, r`Load shedding, backpressure and graceful degradation keep core functions alive.`, r`Combine in a deliberate order and test with fault injection.`],
  ex: r`During a PSP slowdown, a payments API without bulkheads exhausted its connection pool and failed balance queries too; per-dependency concurrency limits and a circuit breaker with secondary-PSP fallback contained the next slowdown to payments only.`,
  fu: [r`How do you set a timeout for a dependency with a 1-second p99?`, r`Why retry at only one layer?`],
  pit: [r`No timeouts or default 100-second HttpClient timeouts.`, r`Retries without jitter or budgets.`, r`One shared pool for all dependencies.`] },

{ id: 'q30', level: 'Senior', tags: ['scalability', 'statelessness', 'sharding', 'partitioning'],
  q: r`Design for scalability: vertical versus horizontal scaling, stateless services, partitioning and sharding strategies (key-based, range, directory), read replicas, hot keys, and the limits of each.`,
  a: r`**Vertical vs horizontal**
- **Vertical** (bigger machines): simple, no code changes; hard ceilings, cost grows non-linearly, single point of failure. Often right for databases up to a point.
- **Horizontal** (more instances): near-linear scaling for stateless components; requires distributing state and load.

**Stateless services**: keep no client state in process memory (sessions, uploads, caches that must be consistent) — store it in shared stores. Any instance can serve any request; autoscaling and rolling deployments become easy. Sticky sessions are a smell for scalability and resilience.

**Scaling data**
- **Read replicas**: offload reads (reports, dashboards) — replication lag means reads may be stale; read-your-writes needs routing to the primary or session consistency tokens.
- **Caching** (q28) and **CQRS read models** for read-heavy paths.
- **Partitioning/sharding** for write scale and data volume:
  - **Key/hash-based**: hash(customerId) mod N or consistent hashing — even distribution; range queries across keys are expensive; resharding needs consistent hashing or virtual partitions.
  - **Range-based**: by date or ID ranges — good for range queries and archiving; risk of hot partitions (all new writes to the latest range).
  - **Directory/lookup-based**: a mapping service tenant → shard — flexible placement and migration of large tenants; the directory is a critical dependency (cache it).
  - **Entity/tenant-based**: shard by tenant (aligns with multi-tenancy and cells).
- Choose the **partition key** to keep transactions within one shard (an account's postings on the same shard) — cross-shard transactions need sagas or are avoided.

**Hot keys/partitions**: one merchant generating 30% of traffic, one instrument at market open. Mitigations: split the key (key + bucket suffix with aggregation), dedicated shards/cells for large tenants, caching for read hot spots, queue-based load levelling for write spikes.

**Limits**: coordination costs (distributed locks, consensus) cap scale; Amdahl's law — serial parts (a single sequence generator, a global lock) bound speed-up. Design to avoid global serialisation points (use per-partition sequences, timestamps with IDs like ULID/UUIDv7 where appropriate).`,
  code: r`~~~csharp
// Directory-based shard routing with a cached map; accounts stay on one shard so postings remain single-shard transactions
public sealed class ShardRouter(IShardDirectory directory, IMemoryCache cache)
{
    public async ValueTask<string> ConnectionFor(Guid accountId, CancellationToken ct)
    {
        var shard = await cache.GetOrCreateAsync($"shard:{accountId}", async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);
            return await directory.GetShardAsync(accountId, ct)      // explicit mapping supports moving large tenants
                   ?? ShardForNewAccount(accountId);                  // default: consistent hash for new accounts
        });
        return shard!.ConnectionString;
    }

    private static Shard ShardForNewAccount(Guid id) => ConsistentHashRing.Default.GetNode(id.ToString());
}
~~~`,
  dia: r`flowchart LR
  LB[Load balancer] --> S1[Stateless API]
  LB --> S2[Stateless API]
  S1 --> ROUTER[Shard router - cached directory]
  S2 --> ROUTER
  ROUTER --> SH1[(Shard 1: accounts A)]
  ROUTER --> SH2[(Shard 2: accounts B)]
  ROUTER --> SH3[(Shard 3: large tenant)]
  SH1 --> RR1[(Read replica)]
  S1 --> CACHE[(Redis cache)]`,
  pts: [r`Vertical is simple with ceilings; horizontal needs distributed state.`, r`Stateless services enable autoscaling and easy deployments.`, r`Read replicas and caches for reads; partitioning for write scale.`, r`Hash, range, directory and tenant sharding trade distribution, queries and flexibility.`, r`Choose keys to keep transactions single-shard; mitigate hot keys; avoid global serial points.`],
  ex: r`A ledger sharded by hash of account kept each account's postings on one shard; when one corporate client grew to 25% of volume, the directory moved it to a dedicated shard without touching other accounts.`,
  fu: [r`How do you reshard a live system?`, r`How do you provide read-your-writes with read replicas?`],
  pit: [r`Sticky sessions holding state in memory.`, r`Partition keys that force cross-shard transactions.`, r`Range sharding on timestamps without hot-partition planning.`] },

{ id: 'q31', level: 'Senior', tags: ['consistency', 'eventual-consistency', 'sagas', 'ux'],
  q: r`Make consistency decisions at the architecture level: strong versus eventual consistency per use case, sagas versus distributed transactions, designing user experiences for eventual consistency, and the invariants that must stay strongly consistent in finance.`,
  a: r`**Principle**: choose consistency **per invariant and per use case**, not per system. Strong consistency everywhere kills availability and scalability; eventual consistency everywhere breaks business rules.

**Must be strongly consistent (in finance)**
- **Balance invariants for spending decisions**: an account cannot go below its limit due to concurrent debits → single-writer per account, database transactions/row locks or optimistic concurrency within one store.
- **Double-entry ledger postings**: debits equal credits atomically.
- **Idempotency records** for payment requests.
- **Uniqueness constraints** (one active mandate per reference).
Keep each invariant **inside one aggregate/service/database** so local ACID transactions enforce it.

**Can be eventually consistent**
- Read models (account overview, transaction history views), notifications, analytics, search indexes, loyalty points, cross-context propagation (customer address changes to marketing).

**Sagas vs distributed transactions (2PC)**
- 2PC/XA across services: blocking protocol, coordinator dependency, poor availability, rarely supported by modern brokers/cloud databases — avoid across services.
- **Sagas**: a sequence of local transactions with compensating actions (orchestrated or choreographed); accept intermediate states (pending) and design compensations (refund, release reservation). Combine with the outbox for reliable messaging and idempotent steps.
- Use **reservation patterns** (hold funds, then capture) to keep invariants while spanning services.

**UX for eventual consistency**
- Show explicit states: "Payment submitted — processing", "Pending", with timestamps.
- **Read-your-own-writes** for the user who made the change: return the created resource from the command response, update the UI optimistically, or route that user's reads to the primary briefly.
- Avoid confusing flows: do not show an old balance after a transfer without context; show "pending" amounts separately (available vs ledger balance).
- Notifications/websockets to update when processing completes.

**Communicating to stakeholders**: express consistency as business rules ("a customer may see a transfer in history up to 2 seconds after confirmation, but can never overspend").`,
  code: r`~~~csharp
// Strong consistency where it matters: optimistic concurrency on the account aggregate (single store)
public async Task<DebitResult> DebitAsync(Guid accountId, Money amount, string idempotencyKey, CancellationToken ct)
{
    var strategy = _db.Database.CreateExecutionStrategy();
    return await strategy.ExecuteAsync(async () =>
    {
        await using var tx = await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        if (await _db.Debits.AnyAsync(d => d.IdempotencyKey == idempotencyKey, ct)) return DebitResult.Duplicate;

        var account = await _db.Accounts.SingleAsync(a => a.Id == accountId, ct);
        if (account.Available < amount.Minor) return DebitResult.InsufficientFunds;
        account.Available -= amount.Minor;                          // RowVersion concurrency token on Account
        _db.Debits.Add(new Debit(accountId, amount.Minor, idempotencyKey));
        _db.Outbox.Add(OutboxMessage.From(new AccountDebited(accountId, amount.Minor)));   // eventual propagation
        await _db.SaveChangesAsync(ct);                             // DbUpdateConcurrencyException -> retried by strategy
        await tx.CommitAsync(ct);
        return DebitResult.Ok;
    });
}
~~~`,
  dia: r`flowchart LR
  CMD[Transfer request] --> ACC[Account service: local ACID - balance invariant]
  ACC -->|outbox event| BUS[[Broker]]
  BUS --> HIST[History read model - eventual]
  BUS --> NOTIF[Notifications - eventual]
  BUS --> SAGA[Cross-bank transfer saga: reserve, send, capture or release]
  UI[UI: shows Pending, read-your-writes from command response] --> CMD`,
  pts: [r`Choose consistency per invariant and use case.`, r`Keep financial invariants inside one aggregate/store with ACID.`, r`Sagas with compensations and reservations instead of 2PC across services.`, r`Design UX with explicit pending states and read-your-own-writes.`, r`Explain consistency to stakeholders as business rules.`],
  ex: r`A neobank's balance check read from an eventually consistent view and allowed concurrent overspending during a promotion; moving the check to the account aggregate with optimistic concurrency closed the gap while history views stayed eventual.`,
  fu: [r`How would you show available versus ledger balance in the UI?`, r`When is a distributed transaction acceptable?`],
  pit: [r`Spending decisions on eventually consistent views.`, r`2PC across microservices.`, r`UIs that hide pending states and confuse customers.`] },

{ id: 'q32', level: 'Senior', tags: ['api-styles', 'rest', 'grpc', 'graphql', 'asyncapi', 'versioning'],
  q: r`Choose API styles across an organisation — REST, gRPC, GraphQL, asynchronous APIs — and define an organisation-wide API strategy: contracts, versioning, compatibility checks, discoverability and governance.`,
  a: r`**Styles and fit**
| Style | Strengths | Weaknesses | Typical use |
|---|---|---|---|
| **REST/HTTP JSON** | ubiquitous, cacheable, tooling, easy for partners and browsers | over/under-fetching, chatty for complex screens | public/partner APIs, most service APIs |
| **gRPC** (HTTP/2, protobuf) | efficient, typed contracts, streaming, code generation | browser support needs gRPC-Web, harder debugging, less suited to public APIs | internal service-to-service, low latency, streaming |
| **GraphQL** | clients query exactly what they need, one endpoint for many screens | query cost control, caching complexity, authorisation per field, N+1 resolvers | aggregation layer for rich UIs (often as BFF) |
| **Async APIs** (events/messages) | decoupling, scalability | eventual consistency, harder discovery | domain events, integrations, notifications |

**Organisation-wide strategy**
- **Contract-first** where it matters: OpenAPI for HTTP, protobuf for gRPC, **AsyncAPI** + schema registry (Avro/JSON Schema/Protobuf) for events; contracts in Git with review.
- **Design guidelines**: resource naming, pagination, filtering, error format (RFC 9457 problem details), idempotency keys for unsafe operations, standard headers (correlation IDs, traceparent), security (OAuth scopes), rate limits.
- **Versioning**: prefer **evolution without breaking changes** (additive fields, tolerant readers); major versions only for breaking changes, with deprecation policy (Sunset/Deprecation headers, timelines, consumer tracking). For events: compatibility modes in the schema registry (BACKWARD/FULL).
- **Automated compatibility checks** in CI: OpenAPI diff (oasdiff), buf breaking for protobuf, schema registry compatibility checks — fail on unintended breaking changes.
- **Discoverability**: an API catalogue/developer portal (Backstage, APIM portal) with ownership, docs, SLAs, examples, sandbox.
- **Lifecycle governance**: design reviews for public/partner APIs, linting (Spectral) for consistency, usage analytics to know who depends on what before deprecating.

**Public/partner APIs in finance**: stricter — versioned URLs, long deprecation windows, strong authentication (mTLS, OAuth with fine scopes, FAPI profiles for open banking), idempotency, webhooks with signatures and retries.`,
  code: r`~~~yaml
# CI: fail the build on unintended breaking API changes (OpenAPI) and event schema incompatibility
- name: OpenAPI breaking-change check
  run: oasdiff breaking origin/main:api/openapi.yaml api/openapi.yaml --fail-on ERR
- name: Lint API against org style guide
  run: spectral lint api/openapi.yaml --ruleset https://api-standards.bank.example/spectral.yaml
- name: Protobuf breaking-change check
  run: buf breaking proto --against '.git#branch=main,subdir=proto'
- name: Event schema compatibility
  run: |
    curl -sf -X POST "$SCHEMA_REGISTRY/compatibility/subjects/payments.payment-captured-value/versions/latest" \
      -H "Content-Type: application/vnd.schemaregistry.v1+json" \
      --data "{\"schema\": $(jq -Rs . < schemas/payment-captured.avsc)}" | jq -e '.is_compatible == true'
~~~`,
  dia: r`flowchart LR
  PARTNER[Partners] -->|REST + OAuth/mTLS| GW[API gateway]
  SPA[SPA] -->|GraphQL / REST| BFF[BFF]
  BFF -->|gRPC| SVC1[Service A]
  SVC1 -->|gRPC| SVC2[Service B]
  SVC1 -->|events AsyncAPI| BUS[[Broker + schema registry]]
  CAT[API catalogue / portal] -.discover.-> PARTNER
  CI[CI: oasdiff, buf, registry checks] -.guards.-> SVC1`,
  pts: [r`REST for broad and partner use, gRPC internal, GraphQL for rich UI aggregation, async APIs for events.`, r`Contract-first with OpenAPI, protobuf, AsyncAPI and a schema registry.`, r`Evolve without breaking; version and deprecate deliberately.`, r`Automate compatibility checks and linting in CI.`, r`Catalogue APIs with ownership; stricter rules for public financial APIs.`],
  ex: r`An oasdiff check blocked a release that renamed a response field used by 30 partner integrations; the team added the new field alongside the old one and deprecated it with a 12-month Sunset header.`,
  fu: [r`When would you expose GraphQL to partners?`, r`How do you know which consumers still use an old API version?`],
  pit: [r`Breaking changes without version bumps.`, r`GraphQL without query cost limits.`, r`No owner or catalogue for internal APIs.`] },

{ id: 'q33', level: 'Senior', tags: ['operability', 'observability', 'design-for-operations'],
  q: r`Design for operability from the start: what architectural decisions make a system easy to run, observe, diagnose and recover — and how you review a design for operational readiness.`,
  a: r`**Operability** = how easily operators (often the same team) can deploy, observe, diagnose, scale, recover and change the system safely. It must be designed in; bolting it on later is expensive.

**Architectural decisions that help**
- **Observability by design**: OpenTelemetry tracing across sync and async hops (context propagation in headers), structured logs with correlation IDs, RED/USE metrics, business metrics (payments authorised per minute by PSP), exemplars linking metrics to traces.
- **SLOs per user journey** defined at design time, with burn-rate alerts.
- **Health model**: liveness vs readiness, dependency health, degraded modes reported explicitly.
- **Safe deployment**: stateless services, backward-compatible contracts, feature flags, progressive delivery, fast rollback.
- **Explicit failure modes**: timeouts, circuit breakers, dead-letter queues with redrive tooling, idempotent processing so replays are safe.
- **Operational controls**: runtime configuration, kill switches, rate limits, maintenance modes, the ability to pause consumers or drain a queue.
- **Data repair tooling**: reconciliation jobs, admin APIs for correcting states (audited), replay from events/outbox.
- **Capacity visibility**: saturation metrics, load tests with known limits, autoscaling policies tied to meaningful signals.
- **Dependency mapping**: know and document dependencies, their SLOs and fallback behaviour.
- **Security operations**: audit logs, secrets rotation without downtime, break-glass procedures.

**Operational readiness review (before go-live)**
- SLOs and alerts defined, dashboards built, runbooks for top failure scenarios, on-call rota trained.
- Load and failure tests done (dependency down, AZ loss, queue backlog).
- Backups and restores tested; DR procedure rehearsed.
- Logging free of sensitive data; retention configured.
- Rollback tested; feature flags in place for risky features.
- Capacity plan and cost estimate; ownership and escalation paths documented.

**Principle**: "you build it, you run it" makes teams feel the operational cost of their designs, which improves designs.`,
  code: r`~~~csharp
// Operability hooks designed in: business metrics, explicit degraded state, and a consumer kill switch
private static readonly Meter Meter = new("Payments");
private static readonly Counter<long> Authorised = Meter.CreateCounter<long>("payments_authorised_total");
private static readonly Histogram<double> PspLatency = Meter.CreateHistogram<double>("psp_latency_ms");

public async Task<AuthResult> AuthoriseAsync(AuthRequest req, CancellationToken ct)
{
    var sw = Stopwatch.StartNew();
    var result = await _psp.AuthoriseAsync(req, ct);
    PspLatency.Record(sw.Elapsed.TotalMilliseconds, new("psp", result.Provider), new("outcome", result.Outcome));
    if (result.Approved) Authorised.Add(1, new("psp", result.Provider), new("method", req.Method));
    return result;
}

// Ops can pause settlement consumption during an incident without redeploying
if (await _flags.GetBooleanValueAsync("ops.settlement-consumer.paused", false))
{
    await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
    continue;
}
~~~`,
  dia: r`flowchart LR
  SVC[Service] -->|traces, metrics, logs| OTEL[OpenTelemetry]
  OTEL --> OBS[Dashboards + SLO burn alerts]
  SVC --> HEALTH[Health: live, ready, degraded]
  SVC --> CTRL[Ops controls: flags, kill switches, pause consumers]
  SVC --> DLQ[(DLQ + redrive tooling)]
  SVC --> REPAIR[Reconciliation + audited repair APIs]
  ORR[Operational readiness review] -.gate.-> PROD[Go-live]`,
  pts: [r`Operability must be designed in, not bolted on.`, r`Observability, SLOs, health models, safe deployment, explicit failure handling.`, r`Operational controls: flags, kill switches, pausing consumers, redrive tools.`, r`Data repair and reconciliation tooling for incidents.`, r`Operational readiness reviews gate go-live.`],
  ex: r`A settlement service launched with a consumer kill switch and DLQ redrive tooling; when a PSP sent malformed files, operators paused consumption, fixed parsing and redrove 12,000 messages without a deployment or data loss.`,
  fu: [r`What would you put in an operational readiness checklist for a tier-0 service?`, r`How do you design audited data repair tools?`],
  pit: [r`Treating observability as an afterthought.`, r`No way to pause or replay processing.`, r`Going live without tested restores and runbooks.`] },

{ id: 'q34', level: 'Senior', tags: ['security-architecture', 'zero-trust', 'defence-in-depth', 'authorization'],
  q: r`Apply security architecture patterns to a distributed system: zero trust, defence in depth, where authentication and authorisation happen (gateway versus service), token propagation, secrets, data protection, and threat modelling.`,
  a: r`**Zero trust**: never trust by network location; authenticate and authorise every request, use least privilege, assume breach, verify continuously.

**Defence in depth (layers)**
1. Edge: WAF, DDoS protection, TLS, bot protection, rate limits.
2. Identity: strong user authentication (MFA, passkeys), OAuth 2.0/OIDC tokens, short-lived credentials.
3. Gateway: token validation (signature, issuer, audience, expiry), coarse-grained authorisation (scopes), request validation, size limits.
4. Service: **fine-grained authorisation** (object-level: can this user access account 42?), input validation, business rules (limits, step-up for high-risk actions).
5. Service-to-service: mTLS with workload identities (mesh/SPIFFE) and/or OAuth client credentials; network segmentation (NetworkPolicies, security groups) as a secondary control.
6. Data: encryption at rest and in transit, field-level encryption/tokenisation for sensitive data (PAN, national IDs), least-privilege database users, masking in non-production.
7. Detection and response: audit logs, anomaly detection, SIEM, incident playbooks.

**Authorisation placement**: the gateway checks **who** (authenticated, token valid, scope present); services check **what on which object**. Relying only on the gateway leads to broken object level authorisation (BOLA), the top API risk. Centralised policy engines (OPA, Cedar, OpenFGA for relationship-based access) can externalise complex rules while enforcement stays in services.

**Token propagation**: forward the user's token (or exchange it — OAuth token exchange — for a downstream-scoped token) so downstream services know the end user; avoid services using all-powerful system credentials to act for users. Keep tokens short-lived; never log them.

**Secrets**: workload identity instead of secrets; vault for the rest; rotation (see DevOps q10).

**Threat modelling**: STRIDE (spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege) on data-flow diagrams at design time, especially for trust boundaries (internet → gateway, service → PSP, admin tools). Track mitigations as backlog items; revisit when architecture changes.

**Financial specifics**: transaction signing and step-up authentication for high-risk operations (PSD2 strong customer authentication), separation of duties for admin actions, tamper-evident audit trails.`,
  code: r`~~~csharp
// Gateway validated the token and scope; the service still enforces object-level authorisation (prevents BOLA)
app.MapGet("/v1/accounts/{accountId:guid}/transactions", async (Guid accountId, ClaimsPrincipal user,
    IAuthorizationService authz, ITransactionQueries q, CancellationToken ct) =>
{
    var access = await authz.AuthorizeAsync(user, accountId, "AccountReader");   // policy checks ownership / mandate
    if (!access.Succeeded) return Results.NotFound();                              // do not reveal existence
    return Results.Ok(await q.GetRecentAsync(accountId, 50, ct));
}).RequireAuthorization("scope:transactions.read");

public sealed class AccountReaderHandler(IAccountAccess access) : AuthorizationHandler<AccountReaderRequirement, Guid>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext ctx, AccountReaderRequirement req, Guid accountId)
    {
        var subject = ctx.User.FindFirst("sub")?.Value;
        if (subject is not null && await access.CanReadAsync(subject, accountId)) ctx.Succeed(req);
    }
}
~~~`,
  dia: r`flowchart LR
  USER[User - MFA] --> EDGE[WAF, TLS, rate limits]
  EDGE --> GW[Gateway: token validation, scopes]
  GW --> SVC[Service: object-level authZ, business rules]
  SVC -->|mTLS + exchanged token| DOWN[Downstream service]
  SVC --> DB[(Data: encryption, tokenised PAN, least-privilege user)]
  SVC --> AUDIT[Tamper-evident audit log]
  TM[Threat model STRIDE at trust boundaries] -.-> GW`,
  pts: [r`Zero trust: authenticate and authorise every request; assume breach.`, r`Defence in depth from edge to data and detection.`, r`Gateway checks identity and scopes; services enforce object-level authorisation.`, r`Propagate or exchange user tokens; mTLS and workload identity between services.`, r`Threat-model trust boundaries; step-up and audit for high-risk financial actions.`],
  ex: r`A penetration test accessed other customers' transactions by changing an account ID because only the gateway checked authentication; adding object-level authorisation policies in the service closed the BOLA vulnerability.`,
  fu: [r`When would you use OAuth token exchange?`, r`Where should a policy engine like OPA sit?`],
  pit: [r`Authorisation only at the gateway.`, r`Trusting internal network traffic.`, r`Long-lived, over-privileged service credentials acting for users.`] },

{ id: 'q35', level: 'Senior', tags: ['distributed-monolith', 'anti-pattern', 'coupling'],
  q: r`What is a distributed monolith? List its symptoms and root causes, how to diagnose it with data, and a plan to fix it — including when merging services is the right answer.`,
  a: r`**Definition**: a system split into multiple deployables that still behave as one unit — services cannot change or deploy independently — combining the complexity of distribution with the coupling of a monolith.

**Symptoms**
- Releases require coordinating many services ("release trains", deploy order runbooks).
- A change to one feature touches 4-5 services and teams.
- Long synchronous call chains; one service's outage takes down many.
- Shared database or shared tables across services.
- Shared libraries containing domain models that force simultaneous upgrades.
- Integration tests only work with the entire system running; no service can be tested alone.
- Chatty communication (dozens of calls per user request).

**Root causes**
- Service boundaries drawn by **technical layers** (UI service, business service, data service) or by entities (Customer service, Account service) rather than business capabilities.
- Splitting before understanding the domain; copying org charts of another company.
- Shared data ownership; lack of contracts and versioning discipline.
- Synchronous request/response used for everything.

**Diagnosing with data**
- **Change coupling**: analyse version control — which services change together in the same PRs/releases (CodeScene-style temporal coupling analysis).
- **Runtime coupling**: distributed traces showing call graphs and fan-out per request; latency contributions.
- **Deployment coupling**: how often deployments must be coordinated.
- **Data coupling**: database access logs showing services reading others' tables.

**Fix plan**
1. Identify **bounded contexts** (event storming, domain analysis) and map current services onto them.
2. **Merge** services that always change together and share data into one service/module (often the right first move — fewer, better-bounded services).
3. Split data ownership: each context owns its tables; replace shared-table reads with APIs/events.
4. Replace synchronous chains with events for non-immediate interactions; introduce async workflows (sagas).
5. Introduce contracts with versioning and consumer-driven contract tests; remove shared domain libraries.
6. Measure improvement: change coupling, coordinated deployments, lead time.`,
  code: r`~~~bash
# Change-coupling analysis from Git history: which services change together in the same commit
git log --since="6 months ago" --name-only --pretty=format:'---' -- services/ \
 | awk '/^---/{ if (n) { for (a in s) for (b in s) if (a < b) pair[a" "b]++ }; delete s; n=0; next }
        /^services\//{ split($0, p, "/"); s[p[2]]=1; n++ }
        END { for (k in pair) print pair[k], k }' \
 | sort -rn | head -10
# Output example:  412 customer-service account-service   <- always change together: merge or redraw boundary
~~~`,
  dia: r`flowchart LR
  subgraph Distributed_monolith[Before]
    UI[UI service] -->|sync| BIZ[Business service]
    BIZ -->|sync| DATA[Data service]
    CUST[Customer svc] --> SHARED[(Shared DB)]
    ACCT[Account svc] --> SHARED
  end
  subgraph After
    ONB[Onboarding context - own data] -->|events| ACCTS[Accounts context - own data]
    ACCTS -->|events| PAYS[Payments context - own data]
  end`,
  pts: [r`Distributed monolith = many deployables that must change and deploy together.`, r`Symptoms: coordinated releases, chatty sync chains, shared databases and libraries.`, r`Causes: technical or entity boundaries, premature splitting, shared data.`, r`Diagnose with change coupling, traces, deployment and data access data.`, r`Fix by redrawing boundaries around contexts, merging where needed, owning data and going async.`],
  ex: r`Git analysis showed a bank's customer and account services changed together in 80% of commits and shared tables; merging them into one onboarding service halved lead time and removed a weekly coordinated release.`,
  fu: [r`How do you convince leadership that merging services is progress?`, r`What role do consumer-driven contracts play in the fix?`],
  pit: [r`Splitting further to fix coupling.`, r`Boundaries by technical layer or entity.`, r`Shared domain libraries across services.`] },

{ id: 'q36', level: 'Senior', tags: ['anti-patterns', 'big-ball-of-mud', 'golden-hammer', 'shared-libraries'],
  q: r`Describe the architecture anti-patterns you most often see in enterprise .NET estates — big ball of mud, golden hammer, lava flow, god service, chatty services, shared kernel misuse, resume-driven architecture — with symptoms and remedies.`,
  a: r`| Anti-pattern | Symptoms | Remedy |
|---|---|---|
| **Big ball of mud** | no discernible structure; everything references everything; fear of change | identify modules/bounded contexts, enforce boundaries with architecture tests, refactor incrementally (strangler inside the codebase) |
| **Golden hammer** | one technology for every problem (everything in SQL Server stored procedures, everything on Kafka, everything microservices) | choose by requirements; tech radar; ADRs with alternatives |
| **Lava flow** | dead or unknown code nobody dares remove; obsolete experiments in production | usage telemetry, code coverage in production, feature flag cleanup, deletion as a habit |
| **God service / god class** | one service or class with many responsibilities and most changes | split by capability; extract cohesive modules |
| **Chatty services** | dozens of fine-grained calls per request, high latency | coarser APIs, composition/BFF, events and local read models, merge over-split services |
| **Shared kernel misuse / shared domain libraries** | a "Common.Domain" NuGet package used by all services; upgrades force lockstep deployments | share only stable primitives; contracts per service; tolerate duplication across contexts |
| **Anaemic domain model** | entities are property bags; business rules scattered in services and controllers | rich domain model where complexity warrants (DDD tactical patterns) |
| **Architecture by implication** | no documented decisions; everyone assumes different things | ADRs, C4 diagrams, fitness functions |
| **Resume-driven architecture** | adopting trendy tech without need (service mesh for 3 services, Kubernetes for one app) | decision matrices tied to quality attributes; reversible experiments |
| **Accidental complexity via frameworks** | heavy generic repositories, unit-of-work wrappers over EF Core, MediatR for everything | use the platform directly where it fits; add abstractions with clear value |
| **Integration database** | many apps share one database as their integration mechanism | APIs/events, ownership per context |

**How to address them in practice**: make problems visible (metrics: change coupling, hotspots — files with high churn and complexity, incident causes), prioritise by business impact, fix incrementally with fitness functions to prevent regression, and change incentives (time for refactoring, deletion celebrated).`,
  code: r`~~~csharp
// Accidental complexity: generic repository over EF Core hides useful capabilities (projections, AsNoTracking, includes)
public interface IRepository<T> { Task<T?> GetByIdAsync(Guid id); Task<IEnumerable<T>> GetAllAsync(); void Add(T e); }
// ...every query loads full entities, N+1 problems appear, and DbContext is wrapped for no gain.

// Simpler, intention-revealing alternative: queries written against DbContext where they are used
public sealed class RecentTransactionsQuery(AppDbContext db)
{
    public Task<List<TxnDto>> ExecuteAsync(Guid accountId, CancellationToken ct) =>
        db.Transactions.AsNoTracking()
          .Where(t => t.AccountId == accountId)
          .OrderByDescending(t => t.BookedAt).Take(50)
          .Select(t => new TxnDto(t.Id, t.AmountMinor, t.Currency, t.BookedAt))
          .ToListAsync(ct);
}
~~~`,
  dia: r`flowchart LR
  VIS[Make visible: change coupling, hotspots, incident causes] --> PRI[Prioritise by business impact]
  PRI --> FIX[Incremental refactoring + boundaries]
  FIX --> FF[Fitness functions prevent regression]
  FF --> CULT[Incentives: time for refactoring, deletion celebrated]
  CULT --> VIS`,
  pts: [r`Know the common anti-patterns and their symptoms.`, r`Remedies: boundaries, right tool per problem, deletion, coarser APIs, contracts.`, r`Avoid shared domain libraries and integration databases.`, r`Resist resume-driven and framework-driven accidental complexity.`, r`Make problems visible, fix incrementally, prevent regression.`],
  ex: r`Hotspot analysis showed 4% of a monolith's files caused 60% of production defects; focused refactoring of those files, guarded by architecture tests, cut defect rates by half within two quarters.`,
  fu: [r`How do you justify refactoring time to product owners?`, r`When is a shared library across services acceptable?`],
  pit: [r`Big-bang rewrites to escape a ball of mud.`, r`Wrapping EF Core in generic repositories by default.`, r`Adopting technologies without a driving requirement.`] },

{ id: 'q37', level: 'Principal', tags: ['architecture-design', 'digital-bank', 'drivers', 'style-selection'],
  q: r`You are the founding architect of a new digital bank product (current accounts, cards, payments) with 25 engineers at launch and a regulator to satisfy in 12 months. Walk through how you arrive at the architecture.`,
  a: r`**1. Drivers and constraints**
- Business: launch in 12 months with a minimum viable product, then add products quickly; differentiate on customer experience.
- Regulatory: licence requirements (operational resilience, outsourcing/cloud notifications, DORA in the EU, PCI DSS for cards, data protection, audit trails, safeguarding).
- Organisation: 25 engineers (~4 teams), likely growing to 100+; a mix of .NET and Angular/React skills.
- Quality attributes (top): correctness of money movement, availability of payments and card authorisation, security, auditability, time to market, modifiability.

**2. Buy vs build boundaries (biggest decisions)**
- **Buy/partner**: card processing (issuer processor), payment scheme connectivity (agency banking or a payments partner), KYC/AML screening providers, core banking or ledger platform (evaluate cloud-native cores vs building a ledger).
- **Build**: customer experience (apps, onboarding flows), product logic, orchestration, data and analytics, integration layer with anti-corruption layers to vendors.

**3. Style**
- A **modular monolith** (or a small number of services) for the product domain at launch: Onboarding, Accounts, Payments, Cards, Notifications as modules with owned schemas and integration events via an outbox — fast delivery, simple operations, transactions where needed.
- Extract services where drivers are clear from day one: **card authorisation adapter** (strict latency/availability, PCI scope isolation), **ledger** if built in-house (strong consistency, independent scaling and audit), and vendor integration adapters.
- **Event-driven** integration for downstream effects (notifications, analytics, fraud signals); **orchestrated sagas** for multi-step flows with vendors (onboarding, payments with compensations).

**4. Cross-cutting**
- Cloud with multi-AZ static stability, warm standby DR region per impact tolerances; IaC; managed databases (PostgreSQL), managed messaging (Kafka or cloud queues).
- Security: identity provider with strong customer authentication, BFF for the web app, workload identity, tokenisation of card data, audit logging.
- Observability and SLOs from day one; CI/CD with automated evidence (regulators and auditors).
- Data platform for regulatory reporting (CDC/events into a warehouse).

**5. Governance**: ADRs for one-way doors (ledger, core vendor, cloud), fitness functions for module boundaries, an evolution roadmap (expected extractions at 50 and 100 engineers).

**6. Risks and mitigations**: vendor dependency (exit plans, ACLs), regulatory timelines (engage early, show resilience testing), team growth (clear module ownership).`,
  code: r`~~~text
Launch architecture (summary)
Clients:        iOS/Android apps, Angular web (via web BFF, tokens server-side)
Edge:           CDN + WAF -> API gateway (OAuth, rate limits)
Product core:   Modular monolith (.NET 8): Onboarding | Accounts | Payments | Notifications  (own schemas, outbox)
Services:       Card-auth adapter (PCI-scoped account, < 150 ms p99) | Ledger service (Aurora PostgreSQL, double entry)
Vendors (ACLs): Issuer processor | Payments partner / scheme access | KYC/AML provider
Integration:    Kafka (domain events) ; orchestrated sagas for onboarding and outbound payments
Data:           CDC + events -> lakehouse -> regulatory reporting
Resilience:     multi-AZ, warm standby region (RTO 1 h launch target -> 15 min year 2), quarterly DR tests
Evolution:      extract Payments at ~50 engineers; Cards domain service when card products expand
~~~`,
  dia: r`flowchart LR
  APP[Mobile + Angular via BFF] --> GW[Gateway]
  GW --> MM[Modular monolith: Onboarding, Accounts, Payments, Notifications]
  MM -->|outbox events| K[[Kafka]]
  K --> LED[Ledger service - double entry]
  K --> DATA[Lakehouse - regulatory reporting]
  ISS[Issuer processor] --> CA[Card-auth adapter - PCI scope]
  CA --> LED
  MM -->|ACL| KYC[KYC/AML vendor]
  MM -->|ACL| PAYP[Payments partner / schemes]`,
  pts: [r`Start from drivers: money correctness, availability, security, auditability, time to market.`, r`Decide buy vs build boundaries first: processors, schemes, KYC, core/ledger.`, r`Modular monolith for product domains; extract services with clear drivers (card auth, ledger).`, r`Events and orchestrated sagas for integration; ACLs for vendors.`, r`Resilience, security, observability and evidence from day one; plan evolution.`],
  ex: r`A European challenger bank launched in 11 months with a modular monolith plus separate card-authorisation and ledger services; it extracted Payments as a service only after crossing 60 engineers and 2 million customers.`,
  fu: [r`Would you build or buy the ledger, and why?`, r`How would the architecture change if launching in three countries at once?`],
  pit: [r`Fifty microservices for 25 engineers.`, r`Vendor models leaking into the domain.`, r`Treating regulatory requirements as an afterthought.`] },

{ id: 'q38', level: 'Principal', tags: ['microservices-decision', 'organisation', 'when-not-to'],
  q: r`The CTO wants to "move to microservices" for a 12-year-old .NET monolith maintained by 40 engineers. How do you evaluate the request, what alternatives do you offer, and what plan do you recommend?`,
  a: r`**Understand the underlying problem**: "microservices" is a solution; ask what hurts. Typical answers: slow releases (monthly trains), teams blocking each other, scaling issues in specific areas, outages where one bug takes down everything, technology upgrade pain (.NET Framework), difficulty hiring for an old stack.

**Gather evidence**
- Delivery metrics (lead time, deployment frequency, change failure rate) and where time goes (value stream).
- Change coupling and hotspots in the codebase; build/test durations; incident causes.
- Runtime profile: which parts need independent scaling or availability.
- Organisation: team structure, ownership, platform maturity (CI/CD, observability, on-call).

**Options**
| Option | Addresses | Cost/risk |
|---|---|---|
| Improve the monolith's delivery (CI, test automation, trunk-based, feature flags, faster builds) | slow releases, quality | low; often the biggest immediate win |
| **Modularise** (modular monolith: bounded contexts, owned schemas, enforced boundaries, team ownership per module) | team contention, change coupling | medium; foundation for any extraction |
| Upgrade runtime (.NET Framework → modern .NET) | tech debt, hiring, performance, containerisation | medium-high, can be incremental |
| **Selective extraction** of services with strong drivers (scaling, availability, compliance isolation, distinct team) | specific bottlenecks | medium per service |
| Full rewrite into many microservices | everything, in theory | highest risk; usually fails or stalls |

**Recommendation pattern**
1. Quick wins on delivery (pipeline, tests, flags) — 3 months.
2. Domain discovery (event storming) → target bounded contexts and team ownership.
3. Modularise inside the monolith with architecture tests and schema separation; upgrade the runtime in parallel.
4. Extract 1-3 services where justified (strangler fig), building platform capabilities (CI/CD templates, observability, messaging) along the way.
5. Re-evaluate with metrics; continue extraction only where the benefit is demonstrated.

**Framing to the CTO**: commit to the outcomes (deploy daily, independent teams, resilience), not the label; show a staged plan with measurable milestones and stop points.`,
  code: r`~~~text
Proposal: "Outcomes first, services where they pay"
Outcome targets (12 months)          Baseline   Target
Deployment frequency                 monthly    daily for 3 of 5 domains
Lead time (median)                   21 days    < 3 days
Teams blocked by other teams' code   ~45%       < 15% of changes (change-coupling metric)
Incidents taking down whole system   4/quarter  <= 1/quarter
Plan
Q1: CI under 15 min, flaky tests fixed, trunk-based + flags, deploy pipeline per environment
Q2: Event storming -> 5 bounded contexts, module boundaries + architecture tests, schemas split
Q3: .NET 8 migration of modules; extract Payments (scaling + PCI isolation) via strangler
Q4: Review metrics; extract Notifications only if team autonomy benefit shown
~~~`,
  dia: r`flowchart LR
  REQ[Move to microservices] --> WHY[What hurts? metrics + evidence]
  WHY --> QW[Delivery quick wins]
  QW --> MOD[Modular monolith + ownership]
  MOD --> UPG[Runtime upgrade]
  MOD --> EXT[Selective extraction - strangler]
  EXT --> REVIEW[Re-evaluate with metrics]
  REVIEW -->|benefit shown| EXT`,
  pts: [r`Treat "microservices" as a solution; find the real problems first.`, r`Use delivery metrics, change coupling, runtime and org data.`, r`Offer options: delivery fixes, modularisation, runtime upgrade, selective extraction.`, r`Recommend staged plans with measurable outcomes and stop points.`, r`Commit to outcomes, not the label.`],
  ex: r`An insurer's CTO asked for microservices; analysis showed releases were slow mainly due to a 4-hour test suite and manual approvals. Fixing those first delivered weekly releases in 3 months, after which only two services were extracted.`,
  fu: [r`What would convince you that full microservices is the right answer here?`, r`How do you handle the CTO if they insist?`],
  pit: [r`Accepting the label without diagnosing the problem.`, r`Big-bang rewrites.`, r`Extracting services without platform capabilities.`] },

{ id: 'q39', level: 'Principal', tags: ['legacy-modernisation', 'mainframe', 'core-banking', 'strategy'],
  q: r`Define a modernisation strategy for a bank whose core runs on a mainframe (COBOL, batch-heavy) with dozens of channel applications depending on it. What options exist, and how do you sequence change while protecting the core?`,
  a: r`**Reality check**: mainframe cores are reliable, run critical batch (interest, statements, settlement), and embody decades of rules — but changes are slow, skills are scarce, MIPS costs are high, and channels need real-time APIs.

**Options (often combined)**
| Option | Description | Fit |
|---|---|---|
| **Encapsulate** | expose core functions via APIs (z/OS Connect, CICS web services, integration layer) with ACLs | first step for channel modernisation |
| **Offload reads** | CDC from DB2/VSAM (vendor CDC tools) into cloud read stores; channels read from there | reduces MIPS, improves availability of reads |
| **Hollow out (strangler)** | move capabilities out piece by piece (customer data, payments, product catalogue) to new services; core keeps the rest | long-term, lowest risk per step |
| **Replatform** | rehost COBOL on other platforms (emulation, automated conversion) | reduces mainframe cost; does not modernise design |
| **Replace with new core** | migrate to a modern core banking platform (cloud-native vendor) product by product or customer cohort | strategic, large programme; progressive migration essential |

**Sequencing that protects the core**
1. **API layer and event layer** around the core: stable contracts for channels; protect the core with rate limiting and queues (fixed capacity).
2. **Read offload via CDC** to serve balances/transaction history from modern stores (eventually consistent, with clear freshness indicators) — cuts load and improves availability.
3. **New products on a new platform** (greenfield products don't need the old core) — "new core alongside old".
4. **Migrate capabilities or customer cohorts** progressively: dual-running, reconciliation between old and new ledgers, cut-over per product/cohort with rollback options.
5. Retire mainframe components when nothing depends on them; keep regulators informed (major change notifications, operational resilience).

**Risks and controls**: data quality and semantics (EBCDIC, packed decimals, implicit rules — profile early), batch dependencies (end-of-day windows), knowledge loss (pair mainframe experts with new teams, document rules as tests), reconciliation for every migration step, regulatory notification of material changes.`,
  code: r`~~~csharp
// Reading offloaded balances from a CDC-fed store, with explicit freshness so channels can show "as of" times
public sealed record BalanceView(string AccountNumber, long AvailableMinor, long LedgerMinor, DateTimeOffset AsOf);

app.MapGet("/v1/accounts/{accountNumber}/balance", async (string accountNumber, BalanceStore store, CancellationToken ct) =>
{
    var view = await store.GetAsync(accountNumber, ct);
    if (view is null) return Results.NotFound();
    var stale = DateTimeOffset.UtcNow - view.AsOf > TimeSpan.FromMinutes(2);
    return Results.Ok(new { view.AvailableMinor, view.LedgerMinor, asOf = view.AsOf, stale });   // UI shows "as of 10:42"
});
// Spending decisions still go through the core (or its successor), never through this read store.
~~~`,
  dia: r`flowchart LR
  CH[Channels: mobile, web, branch] --> API[API + event layer - ACLs, rate limits]
  API -->|writes, decisions| MF[Mainframe core - COBOL, batch]
  MF -->|CDC| RS[(Cloud read stores)]
  API -->|reads| RS
  NEWP[New products] --> NC[New core platform]
  MF <-->|reconciliation during cohort migration| NC`,
  pts: [r`Mainframe cores are reliable but slow to change and costly.`, r`Options: encapsulate, offload reads, strangle, replatform, replace.`, r`Start with API/event layers and CDC read offload, protecting fixed capacity.`, r`New products on a new core; migrate capabilities or cohorts with reconciliation.`, r`Manage data semantics, batch dependencies, knowledge transfer and regulatory notifications.`],
  ex: r`A bank offloaded 85% of channel read traffic from its mainframe to a CDC-fed store, cutting MIPS costs substantially and enabling 24/7 balance views during batch windows, while payments still posted to the core.`,
  fu: [r`How do you migrate customers between cores without double-processing interest?`, r`What do you tell the regulator before a core migration?`],
  pit: [r`Big-bang core replacement.`, r`Spending decisions on CDC read copies.`, r`Losing mainframe experts before rules are captured.`] },

{ id: 'q40', level: 'Principal', tags: ['communication', 'executives', 'regulators', 'storytelling'],
  q: r`How do you communicate architecture decisions and risks to executives, boards and regulators? Explain framing, level of detail, quantifying risk and cost, handling disagreement, and what artefacts you bring.`,
  a: r`**Know the audience's questions**
- **Executives/boards**: What does it enable for the business? What does it cost (now and run-rate)? What are the risks and how likely? What are the options and your recommendation? What decision do you need from us, by when?
- **Regulators**: Is the firm in control? Are important business services resilient within impact tolerances? Are third-party/concentration risks managed (exit strategies)? Is data protected and auditable? Has it been tested?
- **Engineers**: how it works and what changes for them (different document).

**Framing**
- Start with the **decision and recommendation**, then reasons (pyramid principle).
- Speak in **business outcomes and risk**: "reduces time to launch a new product from 9 months to 3", "limits the impact of a provider outage to 5% of customers", rather than technology names.
- Present **options** (including "do nothing") with trade-offs, cost and risk — executives decide between options, not on a single proposal.

**Quantifying**
- Cost: one-off and run costs, people, opportunity cost; ranges with assumptions.
- Risk: likelihood × impact in business terms (customer harm, revenue, regulatory sanctions, reputational), current vs residual risk after mitigation.
- Value: revenue, cost savings, risk reduction, speed (cost of delay).
- Use scenarios: "if region X fails, payments resume in 15 minutes with at most 5 seconds of data loss — tested quarterly".

**Artefacts**
- One-page decision memo (context, options, recommendation, cost, risks, decision needed).
- A context diagram (C4 level 1) and a simple risk heat map.
- For regulators: evidence — test results (DR drills, chaos exercises), control descriptions, incident history and lessons, exit plans.

**Handling disagreement**: surface trade-offs openly, document dissent in the ADR, propose experiments to resolve uncertainty, escalate with clear options rather than positions; once decided, commit and execute.`,
  code: r`~~~markdown
# Decision memo: Secondary PSP for EU card payments
Decision needed: approve EUR 1.1 M (one-off) + EUR 240 k/year by 30 Nov.
Recommendation: Option B - active secondary PSP with automatic failover.
Why: 3 PSP outages in 12 months cost ~EUR 2.4 M in failed payments and breached our 2-hour impact tolerance once.
Options
  A. Do nothing             cost 0      residual risk HIGH (expected loss ~EUR 2 M/yr, regulatory finding likely)
  B. Secondary PSP failover cost 1.1 M  residual risk LOW  (outage impact < 5 min, tested monthly)
  C. Multi-PSP smart routing cost 2.3 M residual risk LOW  (+ fee optimisation ~EUR 300 k/yr, 9 months longer)
Risks of B: integration complexity (mitigated by existing ACL), reconciliation of two settlement files.
Evidence: outage timeline, impact tolerance assessment, PoC results from sandbox.
~~~`,
  dia: r`flowchart LR
  DEC[Decision + recommendation first] --> OPT[Options incl. do nothing]
  OPT --> Q[Quantify: cost, risk, value]
  Q --> EV[Evidence: tests, incidents, PoCs]
  EV --> ASK[Explicit ask + deadline]
  AUD[Audience: exec, board, regulator, engineers] -.tailor.-> DEC`,
  pts: [r`Tailor to the audience's questions; executives want outcomes, cost, risk and the decision needed.`, r`Lead with the recommendation; present options including do nothing.`, r`Quantify cost, risk and value in business terms with assumptions.`, r`Bring evidence: tests, incidents, control descriptions, exit plans.`, r`Surface disagreement, document dissent, commit once decided.`],
  ex: r`A board rejected a "modernise the platform" request twice; reframed as reducing payment outage losses with three costed options and incident evidence, the secondary-PSP proposal was approved in one meeting.`,
  fu: [r`How would you explain eventual consistency risk to a board?`, r`What evidence convinces a regulator about operational resilience?`],
  pit: [r`Technology-first presentations.`, r`A single option with no alternatives.`, r`Unquantified risks.`] },

{ id: 'q41', level: 'Principal', tags: ['technical-debt', 'prioritisation', 'debt-register', 'quantification'],
  q: r`Run a technical debt strategy at the architecture level: identifying and classifying debt, quantifying its cost, prioritising against features, funding models, and preventing new debt.`,
  a: r`**What counts**: technical debt is the gap between the current design and one that would make likely future changes cheap — plus deferred maintenance (outdated runtimes, unsupported libraries), architectural erosion (broken boundaries), and operational debt (manual processes, missing observability). Not every imperfection is debt worth paying.

**Classification** (Fowler's quadrant helps): deliberate vs inadvertent, prudent vs reckless. Also by type: code, architecture, infrastructure, test, security, data, documentation/knowledge.

**Identify**
- Hotspot analysis (high churn × complexity), change coupling, defect density per component.
- Incident postmortems (recurring contributing factors).
- Delivery friction surveys; lead time per component; build/test durations.
- End-of-life inventory: runtimes, frameworks, OS, databases, libraries (support dates).
- Security findings backlog.

**Quantify ("interest" and "principal")**
- **Interest**: ongoing cost — extra engineering time per change in the affected area, incident costs, slower onboarding, cloud cost overhead, risk exposure (end-of-support components, compliance findings).
- **Principal**: cost to fix.
- Express in business terms: "Payments changes take 2.5x longer than comparable areas; that costs ~3 engineer-months per quarter" or "the .NET Framework app blocks containerisation, costing EUR 400 k/year in VM licences and support".

**Prioritise**: high-interest, low-principal first; debt on the path of upcoming roadmap work (pay it as part of the feature); risk-driven items with deadlines (end of support, regulatory). Ignore debt in stable areas nobody changes.

**Funding models**
- A standing capacity allocation (for example 15-20% per team) for continuous improvement.
- Dedicated initiatives for large items (runtime upgrades) with business cases.
- "Boy scout" improvements within feature work.
- Error budget policies redirecting capacity when reliability suffers.

**Preventing new debt**: fitness functions, definition of done (tests, observability, docs), ADRs recording deliberate debt with repayment triggers, platform upgrades automated (Renovate), regular architecture reviews of hotspots.

**Debt register**: visible, owned, prioritised list reviewed quarterly with product leadership.`,
  code: r`~~~text
Technical debt register (excerpt)
ID   Item                                   Type          Interest (per quarter)                   Principal    Priority  Trigger/date
TD-7 Payments module shares tables w/ Ledger architecture  ~3 eng-months extra + 2 incidents/yr     8 eng-weeks  HIGH      before Q2 payouts feature
TD-9 .NET Framework 4.8 statements app      runtime/EOL   VM licences EUR 100k + no containers     14 eng-weeks HIGH      ahead of platform migration
TD-12 Flaky integration suite (11% flake)   test          ~40 h/quarter reruns + slower releases  3 eng-weeks  HIGH      now (cheap)
TD-15 Legacy reporting SQL in stored procs  code          low (rarely changed)                    10 eng-weeks LOW       revisit if reporting changes
~~~`,
  dia: r`flowchart LR
  ID[Identify: hotspots, incidents, EOL inventory, surveys] --> Q[Quantify interest + principal]
  Q --> P[Prioritise: high interest, low principal, on roadmap path, risk deadlines]
  P --> F[Fund: capacity allocation, initiatives, boy scout]
  F --> PREV[Prevent: fitness functions, DoD, ADRs with triggers]
  PREV --> REG[Debt register reviewed quarterly]
  REG --> ID`,
  pts: [r`Debt = gap that makes likely changes expensive, plus deferred maintenance and erosion.`, r`Identify with hotspots, coupling, incidents and EOL inventories.`, r`Quantify interest and principal in business terms.`, r`Prioritise high-interest debt on the roadmap path and risk deadlines; ignore stable areas.`, r`Fund continuously and prevent new debt with fitness functions and ADRs.`],
  ex: r`Quantifying that a shared Payments/Ledger schema cost 3 engineer-months per quarter and caused two incidents a year got an 8-week separation project approved ahead of new features.`,
  fu: [r`How do you get product managers to value debt reduction?`, r`Is all legacy code technical debt?`],
  pit: [r`Treating all imperfections as debt to fix.`, r`Unquantified "we need a refactoring sprint" requests.`, r`No mechanism to prevent new debt.`] },

{ id: 'q42', level: 'Principal', tags: ['build-vs-buy', 'saas', 'vendor-evaluation', 'core-capabilities'],
  q: r`Evaluate build versus buy versus SaaS for a core capability (for example a ledger, KYC/AML screening, or a payments hub). What criteria do you use, how do you assess vendors architecturally, and how do you integrate safely?`,
  a: r`**Strategic lens**: build what differentiates you; buy what is commodity or highly regulated/specialised; partner where scale or licences matter (scheme access, card processing).

**Criteria**
| Criterion | Questions |
|---|---|
| **Differentiation** | does this capability create competitive advantage or is it table stakes? |
| **Fit** | functional coverage for current and 3-year needs; configurability vs customisation |
| **Architecture** | APIs (REST/events), webhooks, multi-tenancy model, data model fit, extensibility, cloud deployment options, latency/availability SLAs, scalability evidence |
| **Data** | ownership, export (full, in open formats), residency, retention, access to raw events for analytics |
| **Security and compliance** | certifications (SOC 2, ISO 27001, PCI DSS), regulatory acceptance, audit rights, encryption and key management (BYOK) |
| **Resilience** | DR capability, RTO/RPO, incident history, status transparency |
| **Total cost** | licences/fees (per transaction scaling), integration and run costs, internal team needs, switching costs |
| **Vendor risk** | financial stability, roadmap, customer base, support quality, concentration risk (DORA third-party register, exit strategy) |
| **Time to market** | months to production with this option |
| **Lock-in and exit** | contract terms, data portability, parallel-run feasibility |

**Architectural assessment practices**: reference calls with similar firms, PoC with real scenarios (including failure scenarios and performance tests), API/sandbox evaluation by engineers, security review, review of their architecture documents and SLA history.

**Safe integration**
- **Anti-corruption layer** so the vendor model does not leak into your domains.
- **Your own system of record** for critical data where needed (for example keep your own ledger of payments even if the hub processes them), with **reconciliation** against vendor data.
- Idempotent integration, webhooks with signatures and retries, event replay ability.
- Feature flags/routing to switch or dual-run vendors; exit plan tested at least on paper.
- Monitoring of vendor SLAs from your side (synthetic checks, latency/error metrics).

**Building instead**: justified when differentiation is high, vendors cannot meet requirements (latency, flexibility), or costs at scale favour ownership — with eyes open about the long-term engineering investment (a ledger is a product you must run forever).`,
  code: r`~~~text
Vendor evaluation scorecard - KYC/AML screening (weights sum to 100)
Criterion                   Weight  Vendor A  Vendor B  Build
Functional fit (3 yr)         15       4         5        3
API/events + sandbox          10       5         3        5
Data export + residency (EU)  10       4         4        5
Compliance certifications     15       5         4        2
Resilience / SLA history      10       4         3        3
TCO (5 yr)                    15       3         4        2
Time to market                10       5         4        1
Exit / lock-in                15       3         4        5
Weighted total                        4.05      3.95     3.15
Next: PoC both vendors with 5,000 real (masked) profiles incl. failure + latency tests
~~~`,
  dia: r`flowchart LR
  DOM[Onboarding domain] -->|port| ACL[ACL: translate, idempotency, retries]
  ACL --> V1[Vendor A - primary]
  ACL -.dual run / switch.-> V2[Vendor B - exit option]
  V1 -->|signed webhooks| ACL
  DOM --> SOR[(Own record of screening decisions)]
  REC[Reconciliation vs vendor reports] -.-> SOR`,
  pts: [r`Build what differentiates; buy commodity or specialised regulated capabilities.`, r`Evaluate fit, architecture, data, compliance, resilience, TCO, vendor risk, exit.`, r`Assess with references, PoCs including failure tests, and security reviews.`, r`Integrate behind ACLs, keep your own records, reconcile, and keep switching options.`, r`Building means owning and running it forever.`],
  ex: r`A payments firm chose a SaaS KYC provider but kept its own record of screening decisions and an ACL; when the vendor raised prices 40%, it dual-ran a second vendor for a month and switched with no domain changes.`,
  fu: [r`When would you build your own ledger?`, r`How do DORA's third-party requirements change vendor selection?`],
  pit: [r`Letting vendor models shape the domain.`, r`No data export or exit plan.`, r`Evaluating on features only, ignoring resilience and TCO.`] },

{ id: 'q43', level: 'Principal', tags: ['regulatory-design', 'auditability', 'data-residency', 'retention'],
  q: r`Design architecture for regulatory requirements: auditability and tamper-evident trails, data residency, retention and erasure (GDPR versus record-keeping), explainability of automated decisions, and operational resilience.`,
  a: r`**Auditability**
- Record **who did what, when, from where, and why** for business actions (payments, limit changes, admin actions) — an append-only audit log separate from application logs.
- **Tamper evidence**: write-once storage (S3 Object Lock / Azure immutable blobs), hash chaining of audit records, restricted access, regular integrity verification.
- Event-sourced or append-only ledgers naturally provide history; otherwise use temporal tables (SQL Server system-versioned) or change data capture into an audit store.
- Correlate audit events with technical traces (correlation IDs) for investigations.

**Data residency**
- Classify data (personal, payment, confidential); map flows (including logs, backups, analytics, support tools, LLM services).
- Constrain regions with policy as code; regional deployments or cells for jurisdiction-specific data; avoid replicating regulated data to non-compliant regions (DR within the same jurisdiction).

**Retention and erasure**
- Conflicting obligations: GDPR right to erasure vs financial record-keeping (often 5-10 years under AML/financial regulations). Resolve per data category: keep what law requires (transactions) and erase/anonymise what is not required (marketing data).
- Implement retention policies at the storage level (lifecycle rules) and in applications; **crypto-shredding** (per-subject encryption keys deleted on erasure) for data in immutable stores or event logs.
- Track all copies (read models, caches, analytics, backups) in a data catalogue so erasure is complete.

**Explainability of automated decisions** (credit, fraud, AML): log inputs, model/rule versions, outputs and reasons for each decision; reproducibility (re-run with the same version); human review paths; model governance (validation, monitoring for drift and bias).

**Operational resilience**: identify important business services, set impact tolerances, map dependencies (including third parties), design for them (redundancy, failover, degraded modes), and test severe but plausible scenarios regularly (DORA, UK operational resilience rules).

**Evidence**: architecture documents, control mappings, test results, and automated compliance reports — produced continuously rather than at audit time.`,
  code: r`~~~csharp
// Append-only, hash-chained audit records (stored in an immutable/WORM-backed store)
public sealed record AuditRecord(long Sequence, DateTimeOffset At, string Actor, string Action, string Resource,
    string ReasonCode, string CorrelationId, string PayloadHash, string PreviousHash)
{
    public string Hash => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        $"{Sequence}|{At:O}|{Actor}|{Action}|{Resource}|{ReasonCode}|{CorrelationId}|{PayloadHash}|{PreviousHash}")));
}

// Crypto-shredding: personal fields encrypted with a per-customer key; erasure = delete the key
public async Task EraseCustomerAsync(Guid customerId, CancellationToken ct)
{
    await _keyStore.DeleteKeyAsync($"customer-{customerId}", ct);    // PII in events/backups becomes unreadable
    await _audit.AppendAsync("system", "GDPR_ERASURE", $"customer/{customerId}", "ART17", ct);
}
~~~`,
  dia: r`flowchart LR
  ACT[Business action] --> APP[Service]
  APP --> AUD[(Audit store: append-only, hash-chained, WORM)]
  APP --> DATA[(Operational data - per-subject keys)]
  DATA --> COPIES[Read models, analytics, backups - catalogued]
  ERASE[Erasure request] --> KEYS[Delete subject key - crypto-shred]
  DEC[Automated decision] --> EXPL[Inputs, model version, reasons logged]
  POL[Residency policy as code] -.-> DATA`,
  pts: [r`Append-only, tamper-evident audit trails correlated with traces.`, r`Classify data and enforce residency across all flows and copies.`, r`Reconcile erasure with record-keeping; crypto-shredding for immutable stores.`, r`Log inputs, versions and reasons for automated decisions.`, r`Design and test for operational resilience; produce evidence continuously.`],
  ex: r`A bank's event-sourced customer service could not delete personal data from its event log; per-customer encryption keys with crypto-shredding satisfied GDPR erasure while transaction records required for AML stayed intact.`,
  fu: [r`How do you prove an audit log has not been tampered with?`, r`How do you handle erasure in backups?`],
  pit: [r`Using application logs as audit trails.`, r`Forgetting copies in analytics and caches during erasure.`, r`Automated decisions without recorded reasons or versions.`] },

{ id: 'q44', level: 'Principal', tags: ['shared-platforms', 'reuse', 'coupling', 'internal-products'],
  q: r`Design reusable shared capabilities (notifications, documents, identity, payments orchestration) for many product teams without creating a central bottleneck or tight coupling. When is reuse a trap?`,
  a: r`**Why share**: avoid duplicating complex, regulated or operationally heavy capabilities (identity, notifications with compliance rules, document generation and storage, payments orchestration with PSP integrations), ensure consistency, reduce cost.

**When reuse is a trap**
- Sharing **domain logic** that differs subtly per product — the shared component accumulates flags and special cases, every change needs coordination (the "enterprise reuse" failure of SOA).
- Shared libraries with domain models that force lockstep upgrades.
- A central team that becomes a queue for every product change.
- Premature reuse: generalising after one use case.
Rule of thumb: **reuse infrastructure and genuinely generic capabilities; duplicate domain-specific logic** (each bounded context models its own concepts).

**Designing shared capabilities as internal products**
- **Clear, generic contracts**: a notification service accepts "send template X to recipient Y via channel preferences" — not product-specific logic.
- **Self-service**: APIs, SDKs, templates managed by product teams themselves (template editor, configuration), not tickets.
- **Extension points** instead of special cases: product teams provide templates, rules or plug-ins within limits.
- **Multi-tenancy and isolation**: per-product quotas, priorities, and observability so one product's spike does not hurt others (bulkheads, separate queues).
- **Versioned APIs** and deprecation policies; backward compatibility.
- **SLOs** published; on-call ownership; capacity planning with consumers.
- **Product management**: roadmap based on consumer needs; inner-source contributions for features the core team cannot prioritise.
- **Asynchronous integration** where possible (requests via events/queues) to reduce temporal coupling.

**Funding and ownership**: a platform/capability team funded centrally, with consumer feedback loops and adoption metrics; optional adoption where alternatives are reasonable, mandatory where compliance requires (identity, audit).`,
  code: r`~~~csharp
// Generic, self-service notification contract: products own templates and preferences, not code in the shared service
public sealed record SendNotification(
    string Product,                       // tenant for quotas, priorities, metrics
    string TemplateKey,                   // template managed by the product team in the template registry
    Guid RecipientCustomerId,
    IReadOnlyDictionary<string, string> Data,
    NotificationPriority Priority,        // Transactional (OTP, payment alerts) vs Marketing
    string IdempotencyKey);

// Products publish commands to a queue (async, decoupled); the shared service applies channel preferences,
// consent rules, rate limits per product, and records delivery outcomes as events.
await sender.SendMessageAsync(new ServiceBusMessage(BinaryData.FromObjectAsJson(cmd))
{
    MessageId = cmd.IdempotencyKey,
    ApplicationProperties = { ["product"] = cmd.Product, ["priority"] = cmd.Priority.ToString() }
});
~~~`,
  dia: r`flowchart LR
  P1[Cards product] -->|SendNotification| Q[(Queue - per-priority)]
  P2[Payments product] -->|SendNotification| Q
  P3[Lending product] -->|SendNotification| Q
  Q --> NS[Notification service: consent, preferences, quotas per product]
  NS --> CH[Channels: push, SMS, email]
  TPL[Template registry - self-service per product] --> NS
  NS -->|delivery events| P1`,
  pts: [r`Share generic, regulated or operationally heavy capabilities; duplicate domain logic.`, r`Reuse becomes a trap when shared components accumulate product-specific logic.`, r`Design as internal products: generic contracts, self-service, extension points.`, r`Isolate consumers with quotas and priorities; version APIs; publish SLOs.`, r`Fund centrally with feedback loops; mandate only where compliance requires.`],
  ex: r`A bank's shared notification service once contained 300 product-specific if-statements; moving to self-service templates, per-product quotas and a generic contract let product teams ship new messages without the platform team.`,
  fu: [r`How do you decide whether a capability should be shared?`, r`How do you prevent a marketing campaign from delaying OTP messages?`],
  pit: [r`Shared services full of product-specific branches.`, r`Ticket-driven central teams.`, r`Shared domain model libraries.`] },

{ id: 'q45', level: 'Principal', tags: ['architecture-review', 'critique', 'microservices-design'],
  q: r`Review this proposal: 22 microservices for a merchant onboarding product (one per entity: Merchant, Address, BankAccount, Document, Owner...), synchronous REST between them, one shared PostgreSQL database "for simplicity", a shared NuGet package with all entity classes, Kubernetes plus a service mesh, built by two teams in six months. Critique it and propose an alternative.`,
  a: r`**Overall verdict**: high risk of a distributed monolith that will miss the six-month target; the decomposition, data strategy and infrastructure choices do not match the team size or the domain.

**Critique**
1. **Entity-based decomposition**: services per noun (Address, Owner, Document) create chatty interactions — onboarding a merchant touches most services for every step; boundaries do not align with business capabilities or team ownership.
2. **Synchronous REST chains**: latency and availability multiply (22 services each at 99.9% in a chain is far below 99.9% overall); cascading failures; no clear transaction boundaries.
3. **Shared database**: removes the main benefit of services (independent change); schema changes break other services; ownership unclear. Combined with services, it is the worst of both worlds.
4. **Shared NuGet with all entities**: deployment coupling — every model change forces upgrades across services.
5. **Kubernetes + service mesh for two teams**: significant platform effort (cluster ops, mesh upgrades, security) diverts capacity from product delivery.
6. **Team size**: two teams cannot own and operate 22 services (on-call, upgrades, observability); cognitive load too high.
7. **Missing**: domain analysis, workflow/saga design for onboarding (KYC, document checks, approvals), idempotency, integration with KYC vendors (ACLs), audit trail, SLOs, failure modes.

**Alternative proposal**
- **Domain analysis** (event storming) → bounded contexts: Merchant Application (the onboarding workflow), Compliance (KYC/AML, documents, risk decision), Merchant Account (approved merchant setup, settlement details), plus integration adapters (KYC vendor, document verification).
- **Modular monolith** with 3 modules (or 2-3 services if team boundaries demand), each owning its schema; **orchestrated workflow** (Durable Functions/Temporal/Step Functions or an in-app process manager) for the onboarding saga with explicit states; events (outbox) to notify other systems.
- Managed container platform (ECS/Container Apps/App Service) instead of self-managed Kubernetes + mesh; managed PostgreSQL.
- Contracts per module; no shared entity package; ACLs for vendors.
- SLOs, audit trail, idempotency keys, document storage with encryption and retention.
- Evolution path: extract Compliance as a service when other products need it or volume demands.

**How to deliver the critique**: acknowledge goals (scalability, modern stack), use concrete failure scenarios and estimates, propose an alternative with a plan, and agree on decision criteria — not a "no".`,
  code: r`~~~text
Availability arithmetic for a synchronous chain
Each service availability: 99.9%   Services in the request path: 8
Combined availability ~ 0.999^8 = 0.992  -> ~ 99.2% (~ 5.8 hours of failures per month vs 43 minutes target)

Alternative module map (modular monolith, 2 teams)
Team A: Merchant Application module (workflow/saga, UI APIs)       schema: application
Team B: Compliance module (KYC adapter, documents, risk decision)  schema: compliance
Team A: Merchant Account module (approved merchant, settlement)    schema: merchant_account
Integration: outbox events -> MerchantApproved -> Payments, CRM, Billing
~~~`,
  dia: r`flowchart LR
  subgraph Proposed
    M[Merchant svc] -->|REST| A[Address svc]
    M -->|REST| B[BankAccount svc]
    M -->|REST| D[Document svc]
    M -->|REST| O[Owner svc]
    A --> SDB[(Shared PostgreSQL)]
    B --> SDB
    D --> SDB
  end
  subgraph Alternative
    APP[Merchant Application module - saga] --> COMP[Compliance module]
    APP --> MA[Merchant Account module]
    COMP -->|ACL| KYC[KYC vendor]
    APP -->|outbox: MerchantApproved| K[[Events]]
  end`,
  pts: [r`Entity-per-service plus sync chains plus shared DB equals a distributed monolith.`, r`Shared entity packages create deployment coupling.`, r`Platform complexity (Kubernetes + mesh) must match team capacity.`, r`Alternative: bounded contexts, modular monolith, orchestrated onboarding saga, managed platform.`, r`Critique with scenarios and numbers, and offer a plan with decision criteria.`],
  ex: r`A similar onboarding proposal was reworked into a 3-module monolith with a workflow engine; it launched in five months with two teams, and the Compliance module was extracted a year later for reuse by lending.`,
  fu: [r`What would change your recommendation toward more services?`, r`How do you deliver this critique to a senior engineer who wrote the proposal?`],
  pit: [r`Decomposing by entities.`, r`Shared databases across services.`, r`Infrastructure ambition beyond team capacity.`] },

{ id: 'q46', level: 'Principal', tags: ['architecture-kata', 'market-data', 'trading', 'design-under-constraints'],
  q: r`Architecture kata: design a real-time market-data and pricing platform for a brokerage (prices to 200,000 web/mobile clients, internal pricing engines, audit of prices quoted). Show your structured approach under constraints.`,
  a: r`**Structured approach (works for any kata)**: clarify requirements and constraints → identify quality attributes and scenarios → propose components and flows → address the hard parts → risks and trade-offs → evolution.

**Clarify**
- Sources: exchange feeds and vendor feeds (Bloomberg/Refinitiv-like), ~50,000 instruments, bursts of 500,000 updates/s at market open.
- Consumers: 200,000 concurrent clients each subscribed to ~20 instruments; internal pricing engines (spreads, FX conversion); order management needs the **quoted price** for best execution and audit.
- Constraints: latency to clients < 250 ms p99 (retail), < 10 ms internal for pricing; licence restrictions on redistribution (entitlements per user); audit of quoted prices for regulatory obligations (best execution, record-keeping).

**Quality attributes**: low latency, high throughput fan-out, availability during market hours, entitlement enforcement, auditability, cost efficiency (fan-out bandwidth).

**Design**
1. **Ingestion**: feed handlers per source normalise to an internal tick format; sequence numbers and gap detection; publish to a low-latency log (Kafka with partitioning by instrument, or specialised middleware for ultra-low latency).
2. **Pricing engines** consume ticks, compute client prices (spread, markups, FX), publish priced quotes with a **quote ID** and pricing version.
3. **Conflation**: clients do not need every tick — conflate per instrument to e.g. 4 updates/s for retail (latest value wins), cutting fan-out by orders of magnitude.
4. **Distribution tier**: WebSocket/SSE gateway cluster (stateless, horizontally scaled, sticky per connection), subscription management, entitlement checks per subscription, backpressure per client (drop to latest for slow clients).
5. **Audit**: every quote sent to a client recorded (quote ID, price, timestamp, client) in an append-only store; orders reference the quote ID so execution can be checked against quoted prices.
6. **Caching**: latest price snapshot per instrument in memory/Redis for new subscribers.

**Hard parts and trade-offs**
- Fan-out math: 200,000 clients × 20 instruments × 4 updates/s = **16 million messages/s** at peak without conflation sharing; group subscriptions per gateway node and multicast within the node to cut work.
- Slow consumers: per-connection bounded buffers with conflation; disconnect abusers.
- Consistency vs latency: client quotes are indicative; executable prices re-validated at order time (last look within tolerance).
- Availability: active-active gateways across AZs; feed handler redundancy (A/B feeds).`,
  code: r`~~~csharp
// Per-client conflation with bounded buffering: slow clients receive the latest price, never an unbounded backlog
public sealed class ClientStream(WebSocket socket)
{
    private readonly ConcurrentDictionary<string, PriceQuote> _latest = new();     // one slot per instrument
    private readonly Channel<string> _dirty = Channel.CreateBounded<string>(new BoundedChannelOptions(64)
        { FullMode = BoundedChannelFullMode.DropOldest });

    public void OnQuote(PriceQuote q)                     // called by the gateway's fan-out loop
    {
        _latest[q.Instrument] = q;                        // conflation: overwrite older value
        _dirty.Writer.TryWrite(q.Instrument);
    }

    public async Task PumpAsync(CancellationToken ct)
    {
        await foreach (var instrument in _dirty.Reader.ReadAllAsync(ct))
            if (_latest.TryRemove(instrument, out var q))
                await socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(q), WebSocketMessageType.Text, true, ct);
    }
}
public sealed record PriceQuote(string Instrument, decimal Bid, decimal Ask, string QuoteId, int PricingVersion, DateTimeOffset At);
~~~`,
  dia: r`flowchart LR
  FEEDS[Exchange + vendor feeds A/B] --> FH[Feed handlers: normalise, gap detection]
  FH --> LOG[[Low-latency log - partition by instrument]]
  LOG --> PE[Pricing engines: spreads, FX, quote IDs]
  PE --> CONF[Conflation per instrument]
  CONF --> GWS[WebSocket gateways x N - entitlements, backpressure]
  GWS --> CL[200k clients]
  PE --> AUD[(Quote audit store - append-only)]
  OMS[Order management] -->|quote ID check| AUD
  PE --> SNAP[(Latest price snapshot)]
  SNAP --> GWS`,
  pts: [r`Structure: clarify, quality attributes, components and flows, hard parts, trade-offs, evolution.`, r`Normalise feeds with gap detection; partition by instrument.`, r`Conflate updates and manage slow consumers with bounded buffers.`, r`Enforce entitlements and audit every quote with IDs referenced by orders.`, r`Do the fan-out arithmetic; separate indicative and executable prices.`],
  ex: r`A brokerage cut its distribution tier's bandwidth by 90% by conflating retail price streams to 4 updates per second per instrument, while professional clients kept full tick streams under separate entitlements.`,
  fu: [r`How would you guarantee best-execution evidence for a disputed trade?`, r`What changes for professional clients needing every tick?`],
  pit: [r`Sending every tick to every client.`, r`Unbounded per-client buffers.`, r`Ignoring market-data licensing and entitlements.`] },

{ id: 'q47', level: 'Principal', tags: ['socio-technical', 'boundaries', 'ownership', 'cognitive-load'],
  q: r`Align architecture with organisation: how do you draw service and module boundaries considering team ownership and cognitive load, when do you merge or split services, and how do you handle components nobody owns?`,
  a: r`**Principle**: architecture and organisation co-evolve (Conway's law). Boundaries should let a team deliver most changes **without coordinating** with other teams, and the total system a team owns must fit its **cognitive capacity** (understand, change, operate, be on call).

**Drawing boundaries**
- Start from the **business domain** (bounded contexts from event storming, capability maps), then check team fit: can one team own this context end to end (code, data, operations)?
- Prefer **fewer, larger** services per team over many tiny ones; a team of 6-8 typically owns a small number of services well.
- Align **data ownership** with team ownership.
- Consider **change cadence**: things that change together belong together; things changing at different rates can be separated.
- Consider **quality attributes**: different scaling, availability or compliance needs (PCI scope) may justify separate deployables even within one team.

**When to merge**
- Services that always change together (change coupling), share data, or have chatty interactions.
- One team owns many tiny services and spends its time on maintenance and upgrades.
- Boundaries drawn by technical layer or entity.

**When to split**
- A service owned by multiple teams with frequent merge conflicts and coordination.
- Parts with clearly different scaling/availability/security needs.
- Cognitive load exceeds team capacity (on-call burden, onboarding time).
- A distinct subdomain emerging with its own language and roadmap.

**Orphaned components** (nobody owns them): common after reorganisations — a risk for security patches, incidents and audits.
- Maintain a **service catalogue** with mandatory ownership metadata; CI fails without an owner.
- Assign every component to a team (even if it means a temporary "caretaker" assignment), with an explicit decision: invest, maintain, or decommission.
- Include ownership health in reviews: components without recent changes, no on-call, outdated dependencies.

**Measuring fit**: % of changes requiring multiple teams, coordinated deployments, on-call load per team, onboarding time, incidents with unclear ownership.`,
  code: r`~~~yaml
# catalog-info.yaml (Backstage) - CI rejects components without owner and lifecycle
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: merchant-application
  annotations: { pagerduty.com/service-id: P4X8Y2Z, sonarqube.org/project-key: merchant-application }
spec:
  type: service
  lifecycle: production
  owner: team-merchant-onboarding          # required
  system: merchant-onboarding
  dependsOn: [component:compliance, resource:merchant-db]
  providesApis: [merchant-application-api]
~~~`,
  dia: r`flowchart TB
  DOM[Bounded contexts from domain analysis] --> FIT{One team can own end to end?}
  FIT -->|yes| OWN[Team owns code, data, operations]
  FIT -->|too big| SPLIT[Split by subdomain / quality attributes]
  CC[Change coupling + chatty calls] --> MERGE[Merge services]
  CAT[Service catalogue - ownership mandatory] --> ORPH[Orphans: invest, maintain, decommission]
  MET[Metrics: cross-team changes, on-call load] -.-> FIT`,
  pts: [r`Boundaries should let teams deliver without coordination within cognitive limits.`, r`Start from domain contexts, then check team fit and data ownership.`, r`Merge on change coupling and chattiness; split on multi-team contention or divergent needs.`, r`Every component has an owner in a catalogue; decide on orphans explicitly.`, r`Measure cross-team changes, coordinated deployments and on-call load.`],
  ex: r`After a reorganisation, 37 services had no owner; a catalogue with mandatory ownership found three with critical unpatched vulnerabilities, two were decommissioned and the rest assigned with maintenance budgets.`,
  fu: [r`How many services should one team own?`, r`How do you handle a component that two teams both need to change often?`],
  pit: [r`Boundaries ignoring team structure.`, r`Teams owning dozens of tiny services.`, r`Unowned components in production.`] },

{ id: 'q48', level: 'Principal', tags: ['architecture-health', 'metrics', 'fitness-dashboards'],
  q: r`How do you measure architecture health across a large estate? Define metrics for modularity, coupling, deployability, reliability, security posture and cost, and how you use them without creating vanity dashboards.`,
  a: r`**Principle**: measure the properties the architecture is supposed to deliver (the quality attributes and business goals), trend them per system/domain, and act on the outliers.

**Metric families**
| Property | Metrics | Sources |
|---|---|---|
| **Modularity/coupling** | change coupling between components, architecture-test violations, dependency cycles, instability/abstractness per module, cross-module calls | Git analysis, ArchUnitNET/NetArchTest, static analysis |
| **Deployability** | deployment frequency and lead time per service, % coordinated deployments, build/test duration | CI/CD events |
| **Reliability** | SLO attainment per journey, change failure rate, recovery time, incident counts by cause | SLO platform, incident tool |
| **Operability** | alert actionability, on-call pages per team, runbook coverage | paging tool, catalogue |
| **Security posture** | open critical/high vulnerabilities in running workloads and age, secrets findings, policy violations, long-lived credentials count | scanners, cloud posture tools |
| **Currency** | % components on supported runtimes/frameworks, dependency age, end-of-life components | SBOMs, catalogue |
| **Cost efficiency** | cost per transaction/customer per domain, idle cost | FinOps tooling |
| **Ownership** | % components with owners, orphaned services | service catalogue |

**Using them well**
- **Per-domain scorecards** (for example in Backstage) showing trends, not league tables; each metric links to the underlying evidence.
- Agree **thresholds** that trigger action (for example any tier-0 service on an unsupported runtime is a risk item; change coupling above X between two services triggers a boundary review).
- Review quarterly with domain leads; turn findings into roadmap items and technical debt register entries.
- Combine with qualitative input (developer surveys, incident reviews).
- Avoid vanity: no single "architecture score", no metrics without an action owner, no measuring what is easy instead of what matters.`,
  code: r`~~~text
Domain scorecard - Payments (Q3)                     Trend   Threshold      Status
Change coupling with Ledger (shared commits)          31% ->  < 15%          ACTION: boundary review (ADR-0051)
Architecture test violations                          0       0              OK
Deploys/week (median service)                         9  ^    >= 5           OK
Coordinated deployments                               2  v    0              WATCH
SLO attainment card authorisation                     99.97%  >= 99.95%      OK
Change failure rate                                   8%  v   < 10%          OK
Critical vulns in running images (oldest)             1 (12d) 0 > 7d         ACTION
Components on supported runtime                       92% ^   100% tier 0/1  ACTION: statements app (.NET Fx)
Cost per authorisation                                0.21c v trend down     OK
Components with owner                                 100%    100%           OK
~~~`,
  dia: r`flowchart LR
  GIT[Git history] --> SC[Domain scorecards]
  ARCH[Architecture tests] --> SC
  CICD[CI/CD events] --> SC
  SLO[SLO + incidents] --> SC
  SEC[Scanners + posture] --> SC
  SBOM[SBOMs + catalogue] --> SC
  FIN[FinOps] --> SC
  SC --> REV[Quarterly review with domain leads]
  REV --> ACT[Roadmap items + debt register]`,
  pts: [r`Measure the properties the architecture should deliver.`, r`Families: coupling, deployability, reliability, operability, security, currency, cost, ownership.`, r`Per-domain scorecards with trends and evidence links.`, r`Thresholds trigger actions with owners.`, r`No single architecture score; combine with qualitative input.`],
  ex: r`A quarterly scorecard showed Payments and Ledger changing together in 31% of commits; a boundary review moved fee calculation into Payments and the coupling fell to 9% the next quarter.`,
  fu: [r`Which single metric best signals a distributed monolith?`, r`How do you stop scorecards becoming league tables?`],
  pit: [r`One aggregate "architecture score".`, r`Metrics without action owners.`, r`Measuring only what tools emit easily.`] },

{ id: 'q49', level: 'Principal', tags: ['yagni', 'future-proofing', 'extensibility', 'ai-components'],
  q: r`Balance future-proofing against YAGNI: how do you design for change without speculative generality, where extension points are worth it, and how would you incorporate new capabilities such as LLM-based components into an existing architecture safely?`,
  a: r`**The tension**: designing for every possible future adds complexity now (abstractions, configuration, generic engines) that may never pay off; designing only for today can make plausible changes very expensive.

**Guidelines**
- **Design for known likely changes**, not imagined ones: ask "what changed in the last two years and what is on the roadmap?" (new payment methods: likely; switching databases: rare).
- **Keep things simple and cheap to change** rather than "configurable for anything": clear modules, tests, good naming, small functions — modifiability comes mostly from code quality and boundaries.
- **Rule of three**: generalise after the third concrete case, not the first.
- **Abstractions at volatile boundaries**: external providers (PSPs, KYC vendors, LLM providers), infrastructure that may change (messaging), regulatory rules that change by market — ports and adapters there pay off.
- **Avoid**: generic workflow/rules engines built in-house for one use case, plugin systems without second plugin, configuration DSLs replacing code, deep inheritance hierarchies for flexibility.
- **Reversibility** (q25) is a better goal than prediction.

**Incorporating LLM-based components safely**
- Treat the LLM as an **external, probabilistic dependency** behind a port ({{IDocumentSummariser}}, {{ITransactionCategoriser}}) with adapters per provider/model — models and vendors change frequently.
- **Guardrails**: input/output validation, schema-constrained outputs (structured outputs), prompt-injection defences (never let model output trigger privileged actions without checks), PII redaction before sending data out, data residency controls.
- **Human in the loop** for decisions with customer or regulatory impact (credit, complaints, AML); LLMs for assistance (drafting, summarising, classification with confidence thresholds).
- **Evaluation**: offline test sets and regression evaluations per model/prompt version, online monitoring (quality, latency, cost, refusals), versioning of prompts and models with audit records (explainability, q43).
- **Resilience and cost**: timeouts, fallbacks (rules-based or "manual review"), caching, rate limits, budgets; asynchronous processing for non-interactive tasks.
- Start with narrow, measurable use cases; architecture should make it easy to swap or remove the component.`,
  code: r`~~~csharp
// LLM capability behind a port with validation, redaction, fallback and audit - easy to swap or remove
public interface ITransactionCategoriser
{
    Task<CategoryResult> CategoriseAsync(TransactionDescription tx, CancellationToken ct);
}

public sealed class LlmTransactionCategoriser(ILlmClient llm, IPiiRedactor redactor, RulesCategoriser fallback,
    IAuditLog audit, ILogger<LlmTransactionCategoriser> log) : ITransactionCategoriser
{
    private static readonly HashSet<string> Allowed = ["groceries", "travel", "utilities", "salary", "transfers", "other"];

    public async Task<CategoryResult> CategoriseAsync(TransactionDescription tx, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(2));
        try
        {
            var reply = await llm.CompleteJsonAsync<CategoryReply>(
                promptId: "categorise-v3", input: redactor.Redact(tx.Text), cts.Token);    // no PII leaves the bank
            if (reply is null || !Allowed.Contains(reply.Category) || reply.Confidence < 0.8)
                return await fallback.CategoriseAsync(tx, ct);                               // validated or fallback
            await audit.RecordAsync("categorise", tx.Id, "categorise-v3", reply.Category, reply.Confidence, ct);
            return new CategoryResult(reply.Category, reply.Confidence, Source: "llm:categorise-v3");
        }
        catch (Exception ex) when (ex is TimeoutException or OperationCanceledException or LlmUnavailableException)
        {
            log.LogWarning(ex, "LLM unavailable, using rules");
            return await fallback.CategoriseAsync(tx, ct);
        }
    }
}
~~~`,
  dia: r`flowchart LR
  DOM[Domain: categorisation use case] -->|port| ADP[LLM adapter: redact, validate, audit]
  ADP --> LLM[LLM provider / model - versioned prompts]
  ADP -->|timeout, low confidence| RULES[Rules-based fallback]
  ADP --> AUD[(Audit: prompt + model version, output)]
  EVAL[Offline evaluations + online monitoring] -.-> ADP`,
  pts: [r`Design for known likely changes; prefer simplicity and reversibility over prediction.`, r`Generalise after the third case; abstractions at volatile boundaries.`, r`Avoid in-house generic engines and speculative plugin systems.`, r`Put LLMs behind ports with guardrails, redaction, validation, fallbacks and audit.`, r`Evaluate continuously; humans in the loop for impactful decisions.`],
  ex: r`A bank introduced LLM-based transaction categorisation behind a port with confidence thresholds and a rules fallback; when it switched model providers six months later, only the adapter and evaluation suite changed.`,
  fu: [r`How do you test an LLM-based component in CI?`, r`Which banking decisions should never be delegated to an LLM?`],
  pit: [r`Building generic frameworks for single use cases.`, r`Letting model output trigger privileged actions directly.`, r`Sending customer PII to external models without controls.`] },

{ id: 'q50', level: 'Principal', tags: ['principles', 'summary'],
  q: r`Summarise the architecture principles you would apply as a Principal Engineer or Architect in a financial-services organisation.`,
  a: r`"My architecture principles fit on one page:

- **Start from quality attributes and constraints**: quantified scenarios, team and regulatory realities; name the trade-offs and recommend.
- **Simplest architecture that meets the needs, with an evolution path**: modular monolith by default, services where drivers are concrete; boundaries from the domain and team ownership.
- **Own your data; integrate by contract**: no shared databases across teams; versioned APIs and events; anti-corruption layers for legacy and vendors.
- **Consistency by invariant**: strong where money and rules demand it, eventual elsewhere with honest UX; sagas, outbox and idempotency for cross-boundary work.
- **Design for failure and operations**: timeouts, bulkheads, circuit breakers, graceful degradation, static stability; observability, SLOs and operational controls from day one.
- **Secure by design**: zero trust, defence in depth, object-level authorisation, audit trails, data protection and residency.
- **Make decisions reversible where possible, deliberate where not**: one-way doors get analysis and ADRs; the rest get speed.
- **Evolve deliberately**: fitness functions, strangler and branch-by-abstraction migrations, parallel runs, technical debt managed with numbers.
- **Govern lightly and automatically**: principles, paved roads, guardrails as code, open decision records; architects close to delivery.
- **Communicate in business terms**: options, cost, risk and evidence for executives and regulators."`,
  code: r`~~~text
Drivers       : quantified quality attribute scenarios, constraints, team topology
Style         : modular monolith default -> extract services with concrete drivers
Data          : database per context, contracts (OpenAPI/AsyncAPI/protobuf), ACLs
Consistency   : ACID inside aggregates, sagas + outbox + idempotency across
Resilience    : timeouts, retries w/ budget, breakers, bulkheads, load shedding, cells
Operability   : OTel, SLOs, kill switches, DLQ redrive, readiness reviews
Security      : zero trust, object-level authZ, audit trails, residency, crypto-shredding
Decisions     : one-way vs two-way doors, ADRs, last responsible moment
Evolution     : fitness functions, strangler, branch by abstraction, parallel run, debt register
Governance    : principles + paved roads + guardrails as code + advisory forum
~~~`,
  pts: [r`Quality attributes and constraints drive decisions.`, r`Simplest fitting style with an evolution path; domain- and team-aligned boundaries.`, r`Data ownership, contracts, consistency by invariant.`, r`Design for failure, operations and security from day one.`, r`Reversible decisions, deliberate evolution, light automated governance, business communication.`],
  ex: r`Applying these principles, a bank delivered a new payments product on a modular monolith in seven months, extracted two services with clear drivers within a year, and passed its regulator's resilience review with tested evidence.`,
  fu: [r`Which principle is hardest to keep under delivery pressure?`],
  pit: [r`Principles without fitness functions and governance behind them.`] }
],
cheat: r`### Foundations
Architecture = significant, costly-to-change decisions shaping quality attributes · quantify as scenarios (source, stimulus, environment, artefact, response, measure) · trade-offs, not "it depends" · socio-technical: teams and constraints matter.

### Styles
| Style | Use when |
|---|---|
| Layered | small/medium apps; beware sinkhole, technical partitioning |
| Modular monolith | default for most products; modules with contracts + own schemas |
| Microservices | many teams, clear domains, divergent scaling, mature platform |
| Event-driven | many reactions to business facts; broker vs mediator topology |
| Serverless | spiky/event workloads; do the cost maths for sustained load |
| Microkernel | product variations, plug-ins via stable contracts |
| Pipes & filters | data pipelines; bounded pipes, quarantine, idempotent sinks |
| Space-based | extreme spikes; in-memory grids, async persistence |
| Cell-based | blast-radius isolation for large multi-tenant systems |

### Coupling & boundaries
Cohesion within, loose coupling between · temporal, deployment, data, semantic coupling · connascence: keep strong forms local · boundaries from bounded contexts + team ownership + data ownership · distributed monolith = deploy together, sync chains, shared DB → merge/redraw.

### Integration & data
Sync for immediate answers, async events for reactions, files for batch partners, never shared DBs across teams · event notification vs event-carried state transfer vs event sourcing · BFF (server-side tokens for SPAs) · database per service, read models, lakehouse for analytics · cache by layer; never decide money from caches.

### Resilience, consistency, security
Timeouts + deadline propagation, retries with jitter and budgets, circuit breakers, bulkheads, load shedding, degradation · strong consistency for financial invariants inside one aggregate; sagas + outbox elsewhere; pending-state UX · zero trust, gateway authN + service object-level authZ (BOLA), audit trails.

### Evolution & governance
Fitness functions (ArchUnitNET/NetArchTest, API diffs, perf budgets, policies) · strangler fig with CDC, branch by abstraction, parallel run, ACLs · data migration: backfill + CDC + verification + reverse sync; no naive dual writes · ADRs (immutable, superseded) · ATAM: sensitivity and trade-off points · one-way vs two-way doors · governance: principles, paved roads, guardrails as code, advisory forum · C4 diagrams as code.

### Say this
"Simplest architecture that meets the quality attributes, with an evolution path." "Services own their data." "Strong consistency for money, eventual for views." "Make decisions reversible or make them deliberately." "Architecture decisions should be executable as fitness functions."`
});
})(String.raw);
