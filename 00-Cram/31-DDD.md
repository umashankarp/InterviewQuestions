# Domain-Driven Design — Cram Sheet

> Tier 2 · Source: `31-Domain-Driven-Design/` (4 modules, 3,221 lines) · Read: 12 min

---

## 1. Strategic DDD

- **Ubiquitous Language** — one language shared by developers and domain experts, **inside a bounded context**. The same word legitimately means different things in different contexts ("Customer" in Sales ≠ "Customer" in Billing), and forcing one definition is the failure.
- **Bounded Context** = the boundary within which a model and its language are consistent. **This is the primary candidate for a microservice boundary.**
- **The "unified enterprise model" temptation is the classic strategic failure** — one canonical `Customer` for the whole firm. It becomes a lowest-common-denominator model that serves nobody and couples every team.

**Context Map vocabulary (know these names):**
| Relationship | Meaning |
|---|---|
| **Partnership** | two contexts succeed or fail together; coordinated releases |
| **Shared Kernel** | a deliberately shared model subset — high coupling, use sparingly |
| **Customer–Supplier** | downstream's needs are prioritised in upstream's planning |
| **Conformist** | downstream adopts upstream's model wholesale, no translation |
| **Anti-Corruption Layer (ACL)** | downstream translates, protecting its own model — **the default for integrating a legacy system** |
| **Open Host Service** | upstream publishes a well-defined protocol for many consumers |
| **Published Language** | a shared interchange format (e.g. FpML, ISO 20022) |
| **Separate Ways** | no integration — sometimes the right answer |

- **EF Core hidden cost:** a `DbContext` that spans bounded contexts silently re-couples them. **One `DbContext` per bounded context.**

---

## 2. Tactical DDD

- **Entity vs Value Object — the classification test:** does identity matter beyond the attributes? Two £50 notes are interchangeable (**Value Object**); two customers with identical details are not (**Entity**).
  - Value Objects: **immutable**, equality by value, no ID, freely replaceable. In C#: `record` or EF Core **owned types / complex types**. `Money`, `Address`, `DateRange`.
  - Entities: identity (`OrderId`), mutable, lifecycle.
- **Aggregate = the enforced consistency boundary.** One **Aggregate Root** is the only entry point; external objects reference it **by ID only**, never by object reference into its interior.
- **Rules to state:**
  1. Invariants are enforced **inside** one aggregate, in one transaction.
  2. **One aggregate per transaction** — changes across aggregates are eventually consistent (via domain events).
  3. Reference other aggregates **by identity**, not by navigation property.
- **Aggregate sizing is the recurring cost axis:** too large → change-tracking overhead, lock contention, concurrency conflicts on unrelated fields. Too small → you can no longer enforce the invariant in one transaction. **Size it to the invariant, not to the data model.**
- **EF Core implications:** `AsNoTracking()` is correct for queries but **bypasses the aggregate's invariants** — never load a tracked aggregate with it and then mutate. Oversized aggregates make change tracking measurably expensive.

---

## 3. Domain Events · Domain Services · Repositories

- **A Domain Event is a notification mechanism, not (by default) a storage mechanism.** That is the difference from Event Sourcing.
- **C# mechanics:** the aggregate collects events in a private list during the transaction; the infrastructure (a `SaveChanges` interceptor or MediatR) **dispatches them after the transaction commits**. Raising inside the aggregate, dispatching outside, is the pattern.
- **In-process vs cross-service:** in-process handlers can run in the same transaction. **For cross-service events the Outbox is not optional** — publishing to a broker inside the same logical operation is a dual write.
- Keep events **out of the persisted shape** (EF `Ignore`).
- **Domain Service** — logic that genuinely belongs to no single entity (e.g. a transfer between two accounts). **Stateless**, and therefore safe as Singleton/Transient; it must not hold per-request state.
- **Repository** is **aggregate-scoped**, not table-scoped — it returns whole aggregates. **N+1 across aggregates** is the recurring performance trap; solve with an explicit read model, not by loading aggregates in a loop.

---

## 4. In Practice

- **Sequencing, not pattern selection, is the actual skill.** Which context do you extract first? Answer: the one with the clearest boundary and the highest pain — usually a read-heavy or an independently-scaling capability, never the ledger first.
- **Start with a modular monolith.** Get the boundaries right in one deployable, *then* extract. Extracting a wrong boundary is far more expensive than moving a namespace.
- **Core / Supporting / Generic subdomains** — invest your best people in **Core** (competitive differentiation), buy Generic (auth, email, payments infrastructure).
- **Event Storming** is the workshop technique for discovering boundaries with domain experts.
- **Context-map governance at platform scale** — one fitness function isn't enough; you need per-relationship checks plus a human review of new couplings.

---

## Top traps

1. One canonical enterprise-wide model.
2. Anaemic domain model — entities as property bags, all logic in services. (Be ready to defend when that's *fine*: genuine CRUD.)
3. Aggregates sized to the data model, not the invariant.
4. Object references between aggregates instead of IDs.
5. Multiple aggregates modified in one transaction.
6. One `DbContext` across bounded contexts.
7. Publishing a cross-service domain event without an outbox.
8. `AsNoTracking()` on an aggregate you intend to mutate.
9. Extracting microservices before the boundaries are proven.
10. Applying tactical DDD to a CRUD subdomain (all cost, no benefit).

---

## Interview Q&A — Lead / Principal

### Q1 · The aggregate that became a bottleneck *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Our `Customer` aggregate contains orders, addresses, preferences and payment methods. Saves are slow and we get concurrency conflicts on unrelated changes. Why?"*

**Answer.** The aggregate was sized to the **data model** rather than to an **invariant**, which is the single most common tactical DDD mistake. Because everything lives inside one consistency boundary, EF loads and change-tracks the whole graph on every operation, and the concurrency token covers the entire aggregate — so updating a delivery address conflicts with someone updating a preference, even though those two facts have no business relationship at all.

The fix is to ask, for each part: **what rule must be true at commit time?** "An order's lines must sum to its total" is a real invariant, so that belongs inside `Order`. "A customer has a preferred language" is not an invariant involving orders, so it doesn't need to share a transaction. Split into `Customer`, `Order` and `PaymentMethod` as separate aggregates, referencing each other **by ID only**, never by navigation property. Changes that span them become eventually consistent via domain events — and that's a deliberate business decision to state, not a technical compromise.

The rule of thumb I'd give: **one aggregate per transaction**, and if a single aggregate is so large that unrelated fields contend on the same version token, the invariant you think you're protecting probably isn't real.

**Why it lands.** Diagnoses invariant-vs-data-model, gives the test question, and names the ID-reference rule plus the eventual-consistency consequence.
**✗ Weak answer.** "Use `AsNoTracking` / add an index" — treats a modelling problem as a performance one.
**↳ Follow-ups.** What if a rule genuinely spans two aggregates? How do you enforce it then?

---

### Q2 · Is DDD worth it here? *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"A team has applied full tactical DDD — aggregates, value objects, domain events — to a reference-data CRUD service. Thoughts?"*

**Answer.** It's cost with no return, and I'd say so plainly while being careful about how — the team did something difficult and did it competently, they just applied it to the wrong subdomain. Tactical DDD buys you a place to enforce complex invariants. Reference data has none: it's create, read, update, delete, with no business rules to protect. So they've added aggregates, mapping layers and event plumbing that a future maintainer must understand, in exchange for nothing.

The framing I'd use is the subdomain split: invest your strongest modelling in the **core domain** — the thing the business competes on, where the invariants are genuinely subtle and getting them wrong costs money. **Supporting** subdomains get pragmatic implementations. **Generic** subdomains — auth, notifications, reference data — get bought or built simply. An anaemic model with a service layer is the *correct* answer for CRUD, and being willing to say that is what makes the DDD advocacy credible elsewhere.

What I'd actually do: not force a rewrite, because churn for purity is its own waste. Leave it, stop the pattern spreading by making the subdomain classification explicit in the architecture guidance, and redirect that team's modelling energy to the core domain where it will pay.

**Why it lands.** Names the subdomain split, defends anaemic models where appropriate, and declines a rewrite-for-purity — judgement over doctrine.
**✗ Weak answer.** "Great, they're following best practice" or "make them rewrite it."
**↳ Follow-ups.** How do you classify a subdomain? What's the cost of getting the core domain wrong?

---

### Quick-fire (30 seconds each)

- **"How do you decide an aggregate boundary?"** → By the invariant, not the data. Everything that must be *transactionally* consistent goes inside one aggregate, and everything else references it by ID and becomes eventually consistent via domain events. Then I check the cost: if the aggregate is so big that unrelated fields contend on the same concurrency token, the invariant is probably not really required — and if it's so small I can't enforce the rule in one transaction, I've split too far.
- **"When is DDD not worth it?"** → In generic or supporting subdomains — CRUD, reporting, configuration. Tactical DDD buys you a place to enforce complex invariants; if there are no complex invariants you're paying ceremony for nothing, and an anaemic model with a service layer is the honest, cheaper answer. I'd reserve the full pattern set for the core domain that actually differentiates the business.
- **"Bounded context vs microservice?"** → A bounded context is a *model* boundary; a microservice is a *deployment* boundary. A context is the best available candidate for a service, but they're not the same decision — several contexts can live in one modular monolith. I'd get the context boundaries right in-process first, because moving a namespace is cheap and unpicking a wrongly-split service is not.

---

**Go deeper:** `31-Domain-Driven-Design/01`–`04` · **Related:** [[17-Microservices]], [[32-Clean-Hexagonal-Architecture]], [[34-CQRS-EventSourcing-Saga-Outbox]]
