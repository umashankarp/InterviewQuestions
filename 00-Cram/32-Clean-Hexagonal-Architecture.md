# Clean · Hexagonal · Onion Architecture — Cram Sheet

> Tier 2 · Source: `32-Clean-Architecture/` + `33-Hexagonal-Architecture/` (6 modules, 3,859 lines) · Read: 10 min

---

## 1. They are the same idea with different vocabulary

**The one rule all three share: the Dependency Rule — source-code dependencies point *inward* only.** Domain knows nothing about infrastructure. Everything else is naming.

| Clean | Hexagonal (Cockburn) | Onion |
|---|---|---|
| Entities | — (inside the hexagon) | Domain Model |
| Use Cases | Application / inside | Domain Services + Application Services |
| Interface Adapters | **Adapters** | Infrastructure |
| Frameworks & Drivers | outside | outside |
| (interfaces on the inside) | **Ports** | interfaces |

- **Where they genuinely differ: the granularity of the inner structure.** Clean prescribes named rings; Hexagonal says only "inside vs outside"; Onion is in between. **Testability is mechanically identical regardless of the vocabulary.**
- **Primary (driving) adapters** call in — controllers, CLI, message consumers, background services. **Secondary (driven) adapters** are called out to — repositories, HTTP clients, brokers.

---

## 2. The Dependency Rule, concretely

- **It is a compile-time fact, not documentation.** In .NET the enforcement primitive is the **project-reference graph**:
  ```
  Domain            → (references nothing)
  Application       → Domain
  Infrastructure    → Application, Domain
  Api / Web         → Application, Infrastructure (composition root only)
  ```
  If `Domain` cannot compile a reference to EF Core, the rule is enforced by the compiler rather than by a code reviewer.
- **Dependency Inversion is the mechanism:** the *interface* (`IOrderRepository`) lives in the **inner** ring; the *implementation* lives outside. At runtime control flows outward; at compile time the dependency points inward. **Say both halves** — that's the question.
- **What must never cross inward:** EF entities/`DbContext`, `HttpContext`, framework attributes, SQL, JSON attributes, DTOs from an external API. What *does* cross: plain domain objects and simple DTOs.
- **Fitness functions** make it permanent: **NetArchTest** / ArchUnitNET assertions in CI that inspect assembly references and fail the build. Without that, the rule decays within months.

---

## 3. The C# mechanics

- **Port → Adapter resolution is just DI:** `services.AddScoped<IOrderRepository, SqlOrderRepository>()` in the **composition root** (the only place that knows both sides).
- **Adapter substitution for testing** — swap the secondary adapter for an in-memory or fake implementation; the entire application core is testable with no database, no HTTP, no broker. **This is the actual payoff** — not "we could swap databases," which almost never happens.
- **Environment-scoped composition roots** — real adapters in production, simulators in test — with **one shared contract-test suite run against every adapter** so they cannot drift.
- **Lifetime mismatch / captive dependency** is the recurring bug here too: a Singleton adapter capturing a Scoped port. Enable `ValidateScopes`/`ValidateOnBuild`.
- **MediatR** is commonly used as the Input Boundary (use-case dispatch) — but be ready to say it is **mostly a dispatcher**, not the Mediator pattern in the GoF sense.

---

## 4. The honest costs (say these — it's what separates a real answer)

- **Interface dispatch and DTO mapping cost essentially nothing** at ordinary throughput; don't pretend otherwise in either direction. The one place it might matter is a genuine hot loop at very high message rates.
- **Over-prescribing for a small team** — four projects, three mapping layers and an interface per class, for a CRUD app with one developer. This is the common real-world failure, and it is worse than under-prescribing.
- **Under-prescribing for a large multi-team codebase** — no enforced boundary means the domain slowly acquires framework dependencies and becomes untestable.
- **Solution build/restore time** grows with physical project separation.
- **"Three adapters, one contract-test suite, forever"** is a compounding maintenance tax — every new port multiplies it.
- **The framework's gravity pulls toward the inner rings** — it is always slightly easier to reference EF Core from the domain. The fitness function is what resists it.

---

## Top traps

1. Treating the dependency rule as documentation instead of a compile-time reference graph.
2. EF entities used as domain entities and then leaked outward as API contracts.
3. Returning `IQueryable<T>` from a repository — leaks infrastructure and the `DbContext` lifetime.
4. Interfaces defined in the Infrastructure project (inverts the inversion).
5. An interface per class with exactly one implementation, forever.
6. Claiming the benefit is "swap the database" rather than testability.
7. No architecture test → decay within months.
8. Saying Clean/Hexagonal/Onion are fundamentally different.
9. Captive dependency across a port boundary.
10. Applying the full structure to a CRUD service.

---

## 30-second answers

- **"Clean vs Hexagonal vs Onion?"** → Same rule, different vocabulary. All three say source dependencies point inward, achieved by putting the interface in the inner ring and the implementation outside. They differ only in how prescriptive they are about the inner structure — Clean names the rings, Hexagonal just says inside and outside. Testability is mechanically identical, so I'd pick whichever vocabulary the team already uses rather than argue about it.
- **"How do you actually enforce the dependency rule?"** → With the project-reference graph, so the compiler enforces it: Domain references nothing, Application references Domain, Infrastructure references both, and only the composition root wires ports to adapters. Then an architecture test — NetArchTest in CI — asserts it, because the framework's gravity is always toward referencing EF Core from the domain and a code reviewer will eventually let one through.
- **"Isn't this over-engineering?"** → Often, yes — and that's the failure I'd guard against harder than the opposite. For a single-team CRUD service, four projects and three mapping layers cost real velocity for no invariant worth protecting. I'd apply it where there's genuine domain complexity or multiple teams, and I'd justify it on testability — running the whole application core with no database — not on the hypothetical of swapping a database, which nobody ever does.

---

**Go deeper:** `32-Clean-Architecture/01`–`04`, `33-Hexagonal-Architecture/01`–`02` · **Related:** [[31-DDD]], [[09-OOP-SOLID]], [[11-Design-Patterns]]
