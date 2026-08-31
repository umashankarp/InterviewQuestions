# Module 30 — SOLID Principles Deep Dive

> Domain: SOLID | Level: Beginner → Expert | Prerequisite: [[../09-OOP/01-OOP-Fundamentals-Advanced]] (LSP is one of the five SOLID principles, already covered in depth there)

---

## 1. Fundamentals

### What is SOLID?
SOLID is an acronym for five object-oriented design principles: **S**ingle Responsibility Principle, **O**pen/Closed Principle, **L**iskov Substitution Principle, **I**nterface Segregation Principle, **D**ependency Inversion Principle — collectively describing how to design classes/modules that are easy to understand, extend, and maintain as a codebase grows, by managing **coupling** and **responsibility boundaries** deliberately.

### Why do these exist?
Each principle addresses a specific, recurring failure mode that emerges as codebases grow: classes that do too much and become hard to change safely (SRP), designs that require modifying existing, working code to add new behavior (OCP), substitutability violations (LSP), interfaces forcing unwanted coupling (ISP), and high-level business logic depending directly on low-level implementation details (DIP) — precisely the mechanism behind the entire dependency-injection discussion.

### When does this matter?
Every non-trivial codebase; the depth matters for applying these principles with genuine judgment (recognizing when a principle is being over-applied into needless abstraction, versus under-applied into a maintenance liability) rather than reciting them as slogans.

### How does it work (30,000-ft view)?
```csharp
// C# — Violates SRP: OrderProcessor computes business logic AND persists AND sends email
public class OrderProcessor
{
    public void Process(Order order) { /* validate, save to DB, send email -- three reasons to change */ }
}

// SRP-compliant: each class has ONE reason to change
public interface IOrderValidator  { bool IsValid(Order order); }
public interface IOrderRepository  { Task SaveAsync(Order order); }
public interface IOrderNotifier    { Task NotifyAsync(Order order); }
```
```java
// Java — same split. The principle is identical; only the syntax (no properties, Streams, checked
// exceptions, CompletableFuture instead of Task) changes. See §2.6 for the full mapping.
public class OrderProcessor {
    public void process(Order order) { /* validate, save, notify -- three reasons to change */ }
}

public interface OrderValidator { boolean isValid(Order order); }
public interface OrderRepository { CompletableFuture<Void> save(Order order); }
public interface OrderNotifier  { CompletableFuture<Void> notify(Order order); }
```

---

## 2. Deep Dive

### 2.1 Single Responsibility Principle — "One Reason to Change," Precisely
SRP is frequently mis-stated as "a class should do one thing" — the more precise, original formulation (Robert Martin) is **"a class should have only one reason to change"** — i.e., one class shouldn't be coupled to multiple, independently-varying **stakeholders/concerns** (a class handling both tax-calculation logic, which changes when tax law changes, and report-formatting logic, which changes when the marketing team wants a different layout, has two independent reasons to change, and should be split even if each individual method is small). The "one thing" framing is a useful mnemonic but can lead to over-splitting classes into meaninglessly tiny pieces if taken too literally without the underlying "independently-varying stakeholder" reasoning.

### 2.2 Open/Closed Principle — Open for Extension, Closed for Modification
A module should be extensible with new behavior **without modifying its existing, already-tested source code** — achieved via polymorphism/interfaces (adding a new class implementing an existing interface, rather than adding a new `if`/`switch` branch to an existing method every time a new case is needed). This directly connects to the discriminated-union discussion: a **sealed** hierarchy with exhaustive pattern matching is a **deliberate, informed violation** of OCP (adding a new case *requires* modifying every exhaustive switch) — chosen specifically because the domain benefits more from compiler-enforced exhaustiveness than from OCP's extensibility-without-modification benefit, a concrete illustration that SOLID principles sometimes trade off against each other, requiring judgment about which trade-off fits a given domain's actual needs.

### 2.3 Interface Segregation Principle — Small, Focused Interfaces
No client should be forced to depend on methods it doesn't use — a large, multi-purpose interface (`IRepository` with `GetById`, `GetAll`, `Add`, `Update`, `Delete`, `BulkImport`, `Archive`) forces every implementation to provide (or stub with `NotImplementedException`) methods irrelevant to its actual use case, and forces every *consumer* to depend on (and be recompiled/retested when) the entire interface's surface, even if it only calls one method. Splitting into focused interfaces (`IReadableRepository<T>`, `IWritableRepository<T>`) — directly the same reasoning as the covariant-reader/invariant-writer interface split — lets consumers depend on exactly what they need.

### 2.4 Dependency Inversion Principle — the Precise Distinction from "Dependency Injection"
DIP states: **high-level modules should not depend on low-level modules; both should depend on abstractions** — a business-logic class (`OrderService`) should depend on an `IOrderRepository` interface, not directly on a concrete `SqlOrderRepository` class, inverting the naive dependency direction (business logic depending on data-access details) into both depending on a shared abstraction the business logic itself defines the shape of. **Dependency Injection** is the **mechanism** commonly used to *supply* the concrete implementation satisfying that abstraction at runtime — DIP is the *design principle*; DI is one (very common, but not the only) *technique* for satisfying it. This distinction — frequently blurred, with candidates using the terms interchangeably — is a genuine, testable interview differentiator.

### 2.5 How the Five Principles Interact and Sometimes Tension Against Each Other
SRP and OCP work together (small, focused classes are easier to extend without modification); ISP and DIP work together (small interfaces make it easier for high-level modules to depend only on the abstraction slice they actually need); but LSP can tension against OCP (extending a hierarchy with a new subclass that technically satisfies OCP's "no modification needed" while violating LSP's behavioral-contract requirement — the OOP module's §4 `PriorityCustomer` case, and Advanced Q6's `Penguin : Bird`) — recognizing that these principles are not five independent, additive rules but an interacting system requiring holistic judgment is itself a Staff/Principal-level signal.

### 2.6 SOLID in C# and Java — the Same Judgment, Different Machinery

All five principles are about *coupling and responsibility boundaries*, which are language-independent. A Java-shop interviewer asks the identical questions; only the vocabulary and a few structural details shift.

| Principle / mechanism | C# | Java |
|---|---|---|
| **SRP** split | classes / `partial` types; `record` for data holders | classes; `record` (Java 16+) for data holders — no semantic difference |
| **OCP** via strategy + registry | `interface IFeeRule` + `IEnumerable<IFeeRule>` injected; `Dictionary<string,IFeeRule>` | `interface FeeRule` + `List<FeeRule>` injected; `Map<String,FeeRule>`; or the **`ServiceLoader`** SPI / a Spring `List<FeeRule>` autowire for plugin-style registration |
| **OCP** deliberate violation (exhaustive union) | `abstract record` + `switch` expression, compiler exhaustiveness | `sealed interface ... permits ...` (17+) + `switch` pattern matching exhaustiveness (21) |
| **LSP** guardrail on error contract | base method's exceptions are unchecked — LSP compliance is by documentation + contract test | a subtype **cannot** add a checked exception the interface method didn't declare (`throws`) — a compile-time partial LSP guarantee C# lacks; the flip side is the "wrap in `RuntimeException`" smell |
| **ISP** split | `IReadableRepository<T>` / `IWritableRepository<T>` / `IBulkImportable<T>` | identical: `ReadableRepository<T>` / `WritableRepository<T>` / `BulkImportable<T>`; Java's `default` methods (8+) let you evolve an interface without breaking implementers, same as C# 8 default interface methods |
| **DIP** wiring | `Microsoft.Extensions.DependencyInjection`; or manual composition root (Expert exercise) | **Spring** / Guice / Dagger; or manual composition root — the principle is unchanged, and "poor man's DI" (constructor-wire everything in `main`) satisfies DIP with zero framework in *both* languages |
| **DIP** for external systems | domain-owned `IPaymentGateway` + per-vendor adapter | domain-owned `PaymentGateway` interface + per-vendor adapter; hexagonal ports-and-adapters is the same shape |
| Constructor injection idiom | primary constructors (C# 12) or explicit ctor | explicit ctor; **avoid field injection** (`@Autowired` on a field) — it defeats `final` and hides the dependency, the Java-specific anti-pattern equivalent of a service-locator |
| Read-only exposure (ISP-as-least-privilege) | return `IReadOnlyList<T>` | return `List.copyOf(...)`; `Collections.unmodifiableList` still types as `List<T>` so it fails at *runtime*, not compile time |

**Where the languages genuinely differ for SOLID:**

- **DIP + checked exceptions (Java only).** An interface designed DIP-style — `interface Ledger { void post(Entry e); }` — that later needs an implementation which does I/O forces a choice: declare `throws LedgerException` on the interface (leaking an implementation concern into the abstraction — a DIP/anti-corruption smell, Expert Q6) or wrap in an unchecked exception in every adapter. The disciplined answer is the same as C#: the interface throws a *domain* exception (`throws SettlementRejected`) it owns, and adapters translate. C# sidesteps the syntax but faces the identical design question.
- **OCP registration mechanics.** Java has `ServiceLoader` (a JDK SPI) and Spring's "inject `List<T>` of every bean implementing `T`" — both give you the "add a class, no core edit" property more idiomatically than hand-rolling a `Dictionary`. C#'s equivalent is `services.AddSingleton<IFeeRule, X>()` per implementation (or an assembly-scanning helper). The *principle* — the core iterates a registry, never a `switch` — is identical.
- **ISP-as-least-privilege is slightly weaker in Java at the collection boundary** (runtime-throwing unmodifiable wrappers vs. compile-time-absent mutators on `IReadOnlyList<T>`), so a Java codebase leans harder on `List.copyOf` and on *never* returning the internal field.
- **`sealed` means different things.** C# `sealed` = "no subclass" (a devirtualization + fragile-base-class lever). Java `sealed` (17+) = "only *these named* subclasses" — a tool for building the closed, exhaustive hierarchy that is the *deliberate OCP violation* of §2.2. Java's "no subclass at all" is `final`.

**Everything else — SRP's "one reason to change", OCP's registry-not-switch, ISP's split-by-consumer-need, DIP's direction-of-dependency, and the tensions between them (OCP vs. LSP, over-applied DIP) — is word-for-word portable.** The Expert Q&A scenarios (settlement-core governance, fee-rule engine, `NotImplementedException`/`NotImplementedException`-equivalent trap, "DIP in letter not spirit") all translate directly; a Java implementer stubs with `throw new UnsupportedOperationException()` where the C# version throws `NotImplementedException`, and the design defect (a fat interface promising an unsupported capability) is identical.

## 3. Visual Architecture
```mermaid
classDiagram
 class OrderService {
 -IOrderRepository repository
 -IPaymentGateway gateway
 +PlaceOrder(order)
 }
 class IOrderRepository {
 <<interface>>
 +SaveAsync(order)
 }
 class IPaymentGateway {
 <<interface>>
 +ChargeAsync(amount)
 }
 class SqlOrderRepository
 class StripeGateway
 OrderService --> IOrderRepository: depends on ABSTRACTION (DIP)
 OrderService --> IPaymentGateway: depends on ABSTRACTION (DIP)
 IOrderRepository <|.. SqlOrderRepository
 IPaymentGateway <|.. StripeGateway
 note for OrderService "High-level module (business logic)\ndepends on abstractions, NOT on\nSqlOrderRepository/StripeGateway directly"
```

## 4. Production Example
**Scenario**: A codebase's `NotificationService` had grown to directly implement email-sending, SMS-sending, and push-notification logic all within one class, with a large `switch (channel)` statement dispatching to the appropriate inline logic — every time a new notification channel (Slack, in-app) was added, the team modified this same central class, and a bug introduced while adding Slack support (an off-by-one in the switch's fallthrough logic) caused SMS notifications to silently stop sending for several days, discovered only via a customer complaint, since the SMS code path itself hadn't been touched but was inadvertently affected by the modification to a shared, monolithic class. **Investigation**: root-caused to the `switch` statement's shared, easy-to-accidentally-affect structure — modifying one case's logic had an unintended side effect on an adjacent case due to a missing `break`/fallthrough interaction the change author hadn't anticipated (an OCP violation directly causing a concrete production bug, not just a "code smell"). **Fix**: refactored into an `INotificationChannel` interface with one implementation per channel (`EmailChannel`, `SmsChannel`, `SlackChannel`), each independently deployable/testable, dispatched via a `IEnumerable<INotificationChannel>` collection resolved through DI (the multiple-registration pattern) rather than a shared switch statement — adding a new channel now means adding a new class and one registration line, with **zero modification** to any existing channel's code, structurally eliminating this exact bug class going forward. **Lesson**: OCP violations aren't merely aesthetic — a shared, modification-requiring structure (a large switch statement, a monolithic class) creates a genuine, demonstrated risk that an unrelated addition inadvertently breaks working, untouched functionality, precisely because "unrelated" isn't actually true when everything lives in one, shared, frequently-modified location.

## 5. Best Practices
- Apply SRP based on "independently-varying stakeholders/concerns," not a literal "does exactly one thing" reading that risks over-splitting.
- Prefer polymorphic extension (new implementing classes) over modifying existing, shared dispatch logic (switch statements, large if-chains) for genuinely open-ended, growing case sets.
- Split large interfaces into focused ones matching actual distinct consumer needs (/the reader/writer pattern).
- Recognize DIP as the design principle and DI as one implementation technique — don't conflate the two when explaining architecture decisions.

## 6. Anti-patterns
- A monolithic class/switch statement handling an open-ended, growing set of cases, where adding a new case risks affecting existing ones (the §4 notification-service incident).
- Splitting classes so granularly (one method per class) that the codebase becomes harder, not easier, to navigate — an SRP over-application.
- A single large interface forcing every implementation to stub out irrelevant methods.
- High-level business logic directly instantiating/depending on concrete low-level classes (`new SqlOrderRepository`), rather than depending on an abstraction.

---

## 7. Performance Engineering

**DIP's indirection cost, and why it's almost never the bottleneck.** Every DIP-compliant call through an interface (`_gateway.ChargeAsync`) pays the same virtual-dispatch cost as any interface call (the sibling OOP module's §7 covers the mechanics in full) — an indirect method-table lookup the JIT generally cannot inline away, since the concrete implementation isn't known until runtime. In practice this cost (single-digit nanoseconds) is dwarfed by what the call is usually *for* — a network call to a payment gateway, a database round-trip — so DIP's abstraction layer is essentially free relative to what it wraps; the one place it's worth measuring is a tight, allocation-free, in-memory hot path (a pricing/risk-calculation loop iterating thousands of `IFeeRule`/`IRoutingRule` strategies per second) where dispatch overhead across many small, in-memory-only calls can become a measurable fraction of total time, and where `sealed` strategy implementations plus profile-guided devirtualization (OOP §7) is the right lever, not abandoning the abstraction.

**SRP-driven decomposition and allocation count.** Splitting a monolithic class into several single-responsibility collaborators (`OrderValidator`, `OrderRepository`, `OrderNotifier`) generally means more objects get constructed per logical operation than one God-object would require — each carries its own fixed object-header overhead (OOP §7's 16-byte header) and, if resolved fresh per request from a DI container rather than registered as scoped/singleton where safe, more allocations per request. This is a real, measurable cost at high request volumes, but the standard mitigation is DI lifetime management (register genuinely stateless SRP-decomposed services as `Singleton`, not `Transient`), not abandoning the decomposition — the fix targets the allocation pattern, not the design principle.

**OCP's registry/strategy-lookup cost.** A strategy registry (`Dictionary<string, IFeeRule>` resolved once at startup, looked up per transaction) is an O(1) dictionary lookup — negligible next to the switch-statement alternative it replaces, and the switch statement itself was never faster in any way that mattered; the real performance question for a rule-based OCP design is **rule-evaluation count** (iterating N registered fee rules per transaction), which scales linearly with N and is worth capping/indexing (only evaluate rules whose declared applicability — currency, region, instrument type — actually matches the transaction) once N grows large enough to matter, a genuine, measurable design concern distinct from the lookup mechanism itself.

**ISP and call-site surface size.** A narrow, segregated interface (`IReadableRepository<T>`) has no runtime performance advantage over a fat one at the call-site level (dispatch cost is identical either way) — its value is entirely at compile/build time (smaller recompilation surface when the interface changes) and code-clarity time, not runtime throughput; a candidate claiming ISP has a runtime performance benefit is conflating a build-time/maintainability property with a runtime one.

## 8. Security

**DIP as the mechanism that makes security boundaries testable.** A high-level module depending on `IPaymentGateway` rather than a concrete `StripeGateway` isn't just a testability convenience — it's what allows security-critical failure paths (a declined charge, a timeout, a fraud-flagged transaction) to be **deterministically simulated** in tests via a fake/mock implementing the same interface, rather than only being exercisable against a live vendor sandbox that may not reliably reproduce every failure mode on demand. A codebase that can't deterministically test "what happens when the payment gateway returns a fraud-hold response" because its business logic is wired directly to a concrete vendor SDK type has a genuine security-testing gap DIP directly closes.

**ISP as least-privilege applied to interfaces.** Interface Segregation is the object-oriented expression of the security principle of least privilege: a component depending on a narrow, focused interface (`IReadableRepository<T>`) is *structurally incapable* of calling a destructive operation (`DeleteAsync`) that a fat `IRepository<T>` would have exposed to it whether it needed it or not — this is a genuine, compile-time-enforced security boundary, not merely a maintainability nicety, and is precisely why a reporting/read-only service should depend on a read-only interface even if the concrete backing implementation happens to also support writes: the *dependency's declared type* is what bounds what the consuming code can possibly do, accidentally or maliciously.

**OCP and the blast radius of a compromised or buggy extension.** A polymorphic, registry-based extension point (a new `IFeeRule`, a new `INotificationChannel`) is, from a security standpoint, also a new unit of **trust boundary** — a maliciously or carelessly written new strategy implementation can only affect what its narrow interface contract allows it to affect (§8's ISP point again), and can be reviewed, sandboxed, or feature-flagged independently of the certified core, exactly the settlement-core governance benefit named in this module's own Expert Q1. Contrast this with an OCP violation (a shared, editable `switch` in the core) where a new case's bug has no equivalent containment — it runs inside the same trusted, already-certified code path as every other case, with no structural isolation at all.

**SRP and secrets/PII exposure surface.** A class conflating business logic with logging/serialization (a `PaymentProcessor` that both charges a card and logs the full request payload for "debugging") has a single, unreviewed code path with the power to accidentally leak a card number or other sensitive field into logs — splitting logging into its own single-responsibility collaborator, with an explicit, reviewed redaction step as part of *its* one job, is a direct, concrete SRP-driven security improvement, not merely an organizational one: the redaction logic has exactly one place it can be forgotten (the logger), instead of being one easily-overlooked line buried inside a large, multi-purpose method.

## 9. Scalability

**DIP as the mechanism enabling horizontal team scaling.** This module's own Expert Q2 already establishes DIP's role in vendor swappability and testability; the same abstraction boundary is equally what allows a payments team and a settlement team to develop against `IPaymentGateway`/`ILedger` in parallel, each mocking the other's abstraction rather than blocking on the other's implementation being finished — DIP is the technical precondition for parallelizable team throughput, not merely a testing convenience, directly the same "composition scales teams" point the sibling OOP module's §9 makes, generalized here to the interface-abstraction boundary specifically.

**OCP and deployment/release velocity at scale.** As the number of concurrently-shipping feature teams grows, a shared, modification-requiring core (any OCP violation) becomes a **release bottleneck**, not just a bug-risk: every team needing to add a case to a shared switch statement must coordinate around the same file/PR, serializing what should be independent, parallel releases — a registry-based OCP-compliant design decouples release cadence per extension (a new `IFeeRule` ships on its own team's schedule, registered independently) from the core's own, presumably slower, more heavily-reviewed release cadence, a genuine scalability property measured in engineering throughput, not just request throughput.

**ISP and independent service/module deployability.** A consumer depending on a narrow interface slice is unaffected by, and doesn't need to be redeployed/retested for, an unrelated change to a different slice of a fat interface it never depended on — at scale, this is what allows a large system to be decomposed into independently deployable services/modules along interface boundaries without a change to one module's surface forcing a ripple of retesting/redeployment across every consumer, directly the technical precondition the later microservices/API-gateway modules build their service-boundary discipline on.

**SRP and horizontal request-handling scale.** Classes with a single, narrow responsibility and no shared mutable state (a stateless `OrderValidator`) are trivially safe to run behind a load balancer across many horizontally-scaled instances/pods — the God-object anti-pattern this module warns against frequently accumulates incidental shared state (a cache, a connection, a counter) as more responsibilities get bolted on, which becomes a genuine horizontal-scaling hazard (state that must now be externalized, synchronized, or sharded) that a cleanly SRP-decomposed design never needed to solve in the first place, since each narrow, focused collaborator had no reason to hold onto shared state to begin with.

---

## 10. Interview Questions

### Basic (10)

**B1. Q: What does SOLID stand for?**
*Ideal answer:* Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion — five object-oriented design principles for managing coupling and responsibility boundaries as a codebase grows.
*Common mistake:* Reciting the letters without being able to say what each one *manages* (a class's reasons to change, extensibility, substitutability, unwanted interface coupling, dependency direction).
*Follow-up:* "Which two most often work together, and which two can conflict?" (SRP+OCP and ISP+DIP reinforce; OCP vs LSP can conflict — §2.5).

**B2. Q: What is the Single Responsibility Principle?**
*Ideal answer:* A class should have only one *reason to change* — one actor or stakeholder whose evolving requirements drive its modifications. A class serving both accounting rules and report formatting has two masters and will be broken by either's evolution.
*Common mistake:* Stating it as "a class should do one thing" — that framing invites over-splitting into meaningless fragments (Intermediate Q1); the unit is a *stakeholder/reason*, not a *task*.
*Follow-up:* "Two calculation methods that look structurally identical — same responsibility?" (only if they change for the same business reason; tax calc vs display formatting don't).

**B3. Q: What is the Open/Closed Principle?**
*Ideal answer:* A module should be open for extension but closed for modification — you add new behavior by adding new code (a new class implementing an existing interface), not by editing existing, already-tested source (a new `switch` branch).
*Common mistake:* Reading "closed for modification" as "never change the file" — bug fixes are fine; it's specifically about not editing working logic to add a *new case*.
*Follow-up:* "When is deliberately violating OCP the right call?" (a sealed exhaustive hierarchy — you *want* the compiler to force you to handle a new case everywhere — Intermediate Q3).

**B4. Q: What is the Interface Segregation Principle?**
*Ideal answer:* No client should be forced to depend on members it doesn't use. Split a broad interface into focused ones matching genuine distinct consumer needs, so a change to one slice doesn't recompile/retest consumers of another.
*Common mistake:* Minimizing every interface to one method regardless of whether that reflects real separate use cases (Intermediate Q6).
*Follow-up:* "How is ISP a security principle?" (least privilege — a consumer typed on `IReadableRepository<T>` structurally cannot call `Delete`).

**B5. Q: What is the Dependency Inversion Principle?**
*Ideal answer:* High-level modules shouldn't depend on low-level modules; both should depend on abstractions — and the abstraction should be shaped by the high-level module's needs, not the low-level module's API.
*Common mistake:* Stopping at "depend on interfaces" without the second half (the abstraction is *owned by* and *shaped for* the high-level module) — that's what distinguishes DIP-in-spirit from DIP-in-letter (Expert Q6).
*Follow-up:* "Your `IAuditLogger` mirrors a SIEM vendor's API shape — is that DIP?" (mechanically yes, substantively no — swapping vendors still touches call sites).

**B6. Q: Is Dependency Injection the same thing as Dependency Inversion?**
*Ideal answer:* No. DIP is the design principle (which way source dependencies point). DI is one common *mechanism* for supplying the concrete implementation that satisfies the abstraction at runtime — a container, or manual "poor man's DI" in a composition root. You can satisfy DIP with no container at all.
*Common mistake:* Using the terms interchangeably — a genuine, testable interview differentiator.
*Follow-up:* "Show DIP satisfied with zero framework." (constructor-wire concretes to abstractions in `main`/`Program.cs` — §11 Expert exercise).

**B7. Q: Which SOLID principle did the OOP module (09) already cover in depth?**
*Ideal answer:* Liskov Substitution — its `PriorityCustomer` incident, the Square/Rectangle trap, and behavioral-contract preservation are all LSP, so this module builds on that rather than re-deriving it.
*Common mistake:* Not connecting the two modules — LSP is the one SOLID letter with a full prior treatment.
*Follow-up:* "Where does LSP tension against another SOLID principle?" (OCP — an OCP-compliant new subclass can still violate LSP; Advanced Q6).

**B8. Q: What's a common symptom of an SRP violation?**
*Ideal answer:* One class needs to change for multiple unrelated reasons — a business-rule change and a report-layout change both require touching it — so its git history shows commits from several different feature areas, and every change risks the others.
*Common mistake:* Judging by line count ("the class is big") rather than by whether the reasons-to-change are independent.
*Follow-up:* "In a regulated system, why is this a *risk* concern, not just tidiness?" (a low-stakes reporting tweak drags the money-moving core into re-review/re-certification — §Expert Q3).

**B9. Q: What's a common way to achieve OCP compliance?**
*Ideal answer:* Polymorphism via an interface plus a registry: the core iterates a collection of implementations resolved at startup, and a new case is a new class + one registration line — the core is never edited.
*Common mistake:* Thinking a `switch` on an enum "is fine because it's small" — the risk is what it becomes after N feature PRs each add "just one more case" (Advanced Q7).
*Follow-up:* "Java idiom for the registry?" (`ServiceLoader`, or Spring autowiring `List<T>` of every implementation — §2.6).

**B10. Q: What's a symptom of an ISP violation?**
*Ideal answer:* An implementation is forced to stub out or throw (`NotImplementedException` in C#, `UnsupportedOperationException` in Java) for interface members it can't meaningfully support — the interface promised a capability not every implementer has.
*Common mistake:* "Fix it with a better exception message" — the fix is to segregate the interface so the false promise doesn't exist (Expert Q4).
*Follow-up:* "Why is a stub that silently returns `null`/`0` arguably worse than one that throws?" (the caller gets a plausible wrong answer instead of a loud failure).

### Intermediate (10)

**I1. Q: Why is "a class should do one thing" a risky restatement of SRP?**
*Ideal answer:* Taken literally it drives you to split classes into meaningless one-method fragments, scattering cohesive logic across many files so understanding a capability means reassembling pieces. The precise formulation — "one reason to change," tied to one independently-varying stakeholder/concern — tells you *when* a split reduces coupling versus when it just relocates it.
*Why correct:* It names the concrete failure of the loose framing (fragment proliferation) and the criterion the precise framing supplies (independent reason-to-change).
*Common mistakes:* Defending "do one thing" as a fine simplification; or over-correcting into "never split" — the point is splitting along *stakeholder* boundaries.
*Follow-up:* "You split `OrderValidator` into field- and business-rule validators — how do you check the split is real?" (do they change independently, or always together for the same policy change? — Advanced Q5).

**I2. Q: Why does a large `switch` handling a growing case set violate OCP specifically?**
*Ideal answer:* Every new case requires editing the existing, already-tested `switch` — modifying working logic rather than adding isolated new code. That shared, frequently-edited structure is where "a change to one case breaks an adjacent case" bugs come from (the §4 incident), because "unrelated" isn't true when everything lives in one method.
*Why correct:* It ties the violation to the concrete mechanism (edit-to-extend) and to the demonstrated failure mode (adjacent-case breakage).
*Common mistakes:* Saying a `switch` is "just slower" (it isn't the point); or claiming any `switch` violates OCP (a `switch` over a *fixed, closed* set is fine).
*Follow-up:* "How do you tell at review time which `switch` is an OCP risk?" (its case set is expected to grow, and git shows multiple feature PRs each adding a branch — Advanced Q7).

**I3. Q: Why can a sealed, exhaustive-switch hierarchy be a *deliberate* OCP violation, and why is that sometimes right?**
*Ideal answer:* Adding a new case genuinely forces editing every exhaustive `switch` over that hierarchy — a real OCP violation. It's accepted deliberately because the domain values *compiler-enforced exhaustiveness* (a missed case is a compile error, not a production `default:` fallthrough) more than modification-avoidance. It's the clearest example that SOLID principles trade off and require judgment.
*Why correct:* It states the violation honestly and names the specific benefit bought in exchange (compile-time exhaustiveness) and when that benefit dominates (a fixed, correctness-critical case set).
*Common mistakes:* Claiming it's not "really" an OCP violation; or using it where the case set is genuinely open/plugin-extensible (then OCP's extensibility matters more).
*Follow-up:* "Same trade-off shows up in Chain of Responsibility vs exhaustive switch — which do you pick for a fixed approval-tier set?" (exhaustive switch — you want the compiler to catch a missed tier).

**I4. Q: Why does splitting `IRepository` into `IReadableRepository`/`IWritableRepository` help both ISP and DIP?**
*Ideal answer:* ISP directly: a read-only consumer depends only on the read slice, so a change to `BulkImport`'s signature doesn't recompile it. DIP indirectly: a high-level module depending on the narrower abstraction is *more precisely* inverted — it's coupled to exactly the capability its own responsibility needs, not to a broad surface it happens to be handed.
*Why correct:* It separates the two effects (recompile blast radius vs precision of the inversion) rather than treating them as the same thing.
*Common mistakes:* Saying it's "just cleaner"; or claiming a runtime performance benefit (there is none — the value is build-time and clarity).
*Follow-up:* "Where does a third interface (`IBulkImportable<T>`) come from?" (a capability not every repo has — so callers that need it are typed on it and non-bulk repos simply don't implement it — Expert Q4).

**I5. Q: Why is DIP described as *inverting* the "naive" dependency direction?**
*Ideal answer:* The naive design has business logic depend on and call into data-access/infrastructure code — a top-down dependency. DIP flips it: both layers depend on an abstraction, and that abstraction is defined by/for the business logic's needs, so the infrastructure layer now depends on a contract the business layer owns — the reverse of the naive arrow.
*Why correct:* It identifies *what* is inverted (which layer defines and which layer conforms to the abstraction), not just "add an interface."
*Common mistakes:* Thinking DIP just means "add an interface between the layers" without noting the abstraction is owned upward; leaving the interface shaped by the infrastructure (a leaky abstraction — Expert Q6).
*Follow-up:* "What architecture does consistently applying this at the system boundary produce?" (hexagonal / ports-and-adapters — Expert Q2).

**I6. Q: Why can over-applying ISP become its own maintainability problem?**
*Ideal answer:* Split every interface to one method regardless of use cases and a type's real capability is scattered across a dozen tiny interfaces — understanding what it does means assembling fragments, and a cohesive operation gets artificially divided. ISP splits along *genuine distinct consumer needs*, not mechanically.
*Why correct:* It names the symptom (fragmented capability, hard to see the whole) and the correct boundary (real consumer-need seams).
*Common mistakes:* Treating "more interfaces" as monotonically better; ignoring that a consumer needing five of six tiny interfaces gained nothing.
*Follow-up:* "How do you find the right seam?" (group by which *set* of members actual distinct consumers use together).

**I7. Q: How does the §4 incident show OCP violations aren't merely stylistic?**
*Ideal answer:* Adding a Slack channel to a shared `switch` introduced an off-by-one in the fallthrough that silently stopped SMS notifications for days — the SMS code path itself was never touched. A concrete production outage caused directly by the shared, modification-requiring structure, not a hypothetical.
*Why correct:* It gives the causal chain (edit one case → break an adjacent untouched case) and the real consequence (silent multi-day outage found by a customer).
*Common mistakes:* Describing it as "hard to maintain" without the concrete breakage; blaming the individual bug rather than the structure that made it possible.
*Follow-up:* "The fix is per-channel classes — what new failure mode does *that* introduce?" (independently-correct handlers can still compose wrongly — the sibling behavioral-patterns module's double-discount incident).

**I8. Q: Why does SRP's "reason to change" framing require identifying stakeholders, not just code structure?**
*Ideal answer:* Two methods can be structurally identical (both "calculations") yet change for entirely different reasons — tax law vs marketing's layout preference. SRP is about *why* code changes, which is an organizational fact, not a syntactic one; you can't see it in the code shape alone.
*Why correct:* It grounds the principle in change-drivers (external, human) rather than code metrics.
*Common mistakes:* Grouping by technical similarity ("all the calculation methods together"); assuming the current file structure reflects responsibility boundaries.
*Follow-up:* "How do you discover the stakeholders for an unfamiliar class?" (look at who requests changes to it in the issue tracker / git history — the reasons-to-change are empirically visible).

**I9. Q: Why does DIP apply even without a DI container?**
*Ideal answer:* DIP constrains the *direction of source-code dependencies* — which module references which — independent of the wiring mechanism. Manual "poor man's DI" (construct concretes and pass them into constructors at a composition root) satisfies DIP fully, as long as high-level modules reference only abstractions.
*Why correct:* It separates the principle (dependency direction) from the tooling (containers), which is the exact DIP-vs-DI distinction.
*Common mistakes:* Believing "we don't use DI" means "we can't do DIP"; or thinking a container is required for testability (it isn't — constructor injection alone suffices).
*Follow-up:* "What does a container buy you over manual wiring, then?" (lifetime management, wiring at scale, decorator/interception plumbing — not DIP compliance itself).

**I10. Q: Why is it valuable to recognize that SOLID principles tension against each other?**
*Ideal answer:* Real decisions require choosing which principle's benefit matters more for a specific case — OCP's modification-avoidance vs a sealed hierarchy's compile-time exhaustiveness; DIP's substitutability vs the cost of an abstraction that will never be substituted. Presenting SOLID as five always-harmonious rules hides the judgment it exists to build, and a Staff/Principal engineer is expected to articulate the tensions explicitly.
*Why correct:* It reframes SOLID from a checklist to an interacting system requiring trade-off judgment, and names concrete tensions.
*Common mistakes:* Treating the five as independent and additive; scoring "SOLID compliance" as a single number (Advanced Q9).
*Follow-up:* "Give a case where you'd knowingly violate one SOLID principle to uphold another." (accept the sealed-hierarchy OCP violation to get exhaustiveness on a correctness-critical fixed case set).

### Advanced (10)

**A1. Q: Diagnose the §4 notification-service OCP violation from first principles, and design the code-review practice that prevents recurrence for future growing-case-set scenarios.**
*Ideal answer:* Root cause: an open-ended, growing set of cases (notification channels) implemented as one shared, modification-requiring dispatch structure (a `switch`), so adding a case meant editing working logic and an off-by-one in the fallthrough silently broke an untouched channel. Safeguard: a review heuristic that flags any `switch`/if-chain whose case set is *expected to grow* (payment methods, channels, exporters) as a strategy-pattern-refactor candidate *before* it grows large enough for adjacent-case breakage — proactive, not incident-driven.
*Why correct:* It separates the structural cause (edit-to-extend on a shared method) from the trigger bug, and the safeguard targets the growth signal at review time rather than waiting for an outage.
*Common mistakes:* Prescribing "more tests on the switch" (doesn't remove the shared-structure risk); refactoring *every* switch (a closed set is fine).
*Follow-up:* "What mechanical signal complements the human heuristic?" (branch-count growth on a dispatch method across multiple unrelated feature PRs — Advanced Q7).

**A2. Q: Explain precisely how ISP and DIP work together in a layered architecture, with a concrete example beyond a repository split.**
*Ideal answer:* A high-level `OrderService` depends on `IOrderNotifier` (DIP — depends on an abstraction, not a concrete notifier). If that interface is segregated (ISP) to exactly `NotifyOrderPlaced(order)` rather than a broad `INotificationService` with `SendMarketingEmail`/`SendPasswordReset`, the dependency is both correctly *directed* (DIP) and minimally *scoped* (ISP) — `OrderService` can't accidentally reach unrelated notification capability, and a change to marketing email doesn't touch it.
*Why correct:* It shows the two principles compounding on one dependency — DIP fixes direction, ISP fixes breadth — with a non-repository example.
*Common mistakes:* Conflating the two ("small interface" is ISP, not DIP); making the notifier interface broad because "it's all notification."
*Follow-up:* "Who defines `IOrderNotifier`'s shape — the ordering module or the notification module?" (the ordering module — DIP: the consumer owns the abstraction).

**A3. Q: Design a refactoring strategy for the §4 fix that avoids a "big bang" rewrite of the notification dispatch mechanism.**
*Ideal answer:* Extract one channel (the riskiest or simplest) into its own `INotificationChannel` implementation; the dispatcher checks interface-based channels first and falls back to the legacy `switch` for anything not yet migrated. Extract the rest one at a time in independently-reviewable changes, deleting the legacy `switch` only once every channel has moved. An "expand, don't break" migration.
*Why correct:* Both paths coexist, each step is small and reviewable, and the old path is removed only when provably unused.
*Common mistakes:* Rewriting all channels at once; deleting the `switch` before migration is complete; not having the dispatcher route to the new path first.
*Follow-up:* "How do you verify a migrated channel is behavior-equivalent before deleting its old branch?" (a characterization test capturing the old branch's output, run against the new class).

**A4. Q: Explain a scenario where naively applying DIP (an abstraction for every dependency) adds complexity with no benefit.**
*Ideal answer:* Wrapping a genuinely stable, single-implementation utility with no testing or substitution need — an `IRoundingStrategy` over `Math.Round`, or an `IClock`-style wrapper where there's truly no test that cares about time. You've added an interface, a file, and an indirection that is never substituted. DIP earns its cost only where substitutability is real: testing, multiple implementations, or decoupling from an external system.
*Why correct:* It names the criterion (genuine substitutability need) and a concrete over-abstraction that fails it — the premature-abstraction anti-pattern.
*Common mistakes:* Citing `DateTime.UtcNow`/`IClock` as the bad example (that one *is* usually justified for testability); abstracting everything "to be safe."
*Follow-up:* "How do you decide at design time whether an abstraction will be substituted?" (is there a named second implementation or a test that needs a fake *now* or clearly soon — if not, inline it and add the interface when the need appears).

**A5. Q: How do you tell genuine SRP compliance from merely scattering related logic across more files?**
*Ideal answer:* Check that each resulting class can be modified, tested, and reasoned about *independently* for its own reason-to-change. If two "split" classes always change together for the same underlying policy change (field- and business-rule validators that both move whenever the validation policy moves), the split relocated coupling without reducing it. SRP compliance is measured by independent-changeability, not class count.
*Why correct:* It gives an operational test (do they change independently?) rather than a structural one (are there more files?).
*Common mistakes:* Counting classes/lines as the metric; splitting by technical layer instead of by reason-to-change.
*Follow-up:* "You're not sure if two concerns are independent — how do you find out?" (look at whether historical changes to each came from different requesters/areas; if always the same, they're one responsibility).

**A6. Q: Explain how LSP and OCP come into direct conflict, with a concrete scenario beyond the discriminated-union example.**
*Ideal answer:* Add `Penguin : Bird` to an OCP-compliant hierarchy — you extended without modifying existing code, so OCP is satisfied. But if `Bird`'s contract implies `Fly()` is always meaningfully callable and callers rely on that, `Penguin.Fly()` throwing (or silently no-op) satisfies OCP's "no modification" while violating LSP's "substitutable without altering correctness." OCP guarantees a *non-modifying* extension, never a *correct* one — LSP must be verified independently for every OCP-compliant addition.
*Why correct:* It shows the same act (add a subclass) can pass one principle and fail the other, and states the general lesson (OCP ≠ correctness).
*Common mistakes:* Thinking "OCP-compliant" implies "safe"; fixing `Penguin` by weakening `Bird`'s contract for everyone.
*Follow-up:* "How would you model flightless birds without the violation?" (a capability interface `IFlying` that only flying birds implement — ISP + composition, the same fix as the OOP module's `IRefundable`).

**A7. Q: Design a metric or review signal that would have flagged the notification-service class as an OCP risk *before* the incident.**
*Ideal answer:* Track branch-count / cyclomatic-complexity growth over time on dispatch-shaped methods specifically. A `switch` whose branch count has climbed across multiple *unrelated* feature PRs (each adding one case) is a mechanically detectable instance of the accumulating-shared-structure risk. Flag any dispatch method past a branch threshold *and* modified by N distinct feature PRs as a refactor candidate — converting a reactive fix into a proactive one.
*Why correct:* It combines two cheap signals (branch count + PR diversity over time) that together identify a growing shared dispatch structure, and it's automatable.
*Common mistakes:* A raw complexity gate with no time/PR-diversity dimension (fires on legitimately-complex closed logic too); waiting for the incident.
*Follow-up:* "Would you make this a hard CI gate?" (no — a review flag; a hard gate gets gamed by splitting the switch cosmetically without fixing the coupling — Advanced Q9).

**A8. Q: Explain why DIP is foundational to unit testing beyond "it lets you use mocks."**
*Ideal answer:* Without DIP, a high-level module that does `new SqlOrderRepository()` internally has *no seam* to substitute a test double without editing the class under test. DIP's constructor-injected abstraction is the mechanical prerequisite that makes an isolated unit test possible at all — mocking frameworks are a convenience layered on top of that seam, not the thing that creates it.
*Why correct:* It identifies the seam (constructor + abstraction) as the enabler and frames mocks as secondary.
*Common mistakes:* Crediting the mocking framework; thinking you can test around a `new` with reflection/DI-magic (fragile, and still coupled).
*Follow-up:* "So do you need Moq/Mockito?" (no — a hand-written fake implementing the interface works; the framework just reduces boilerplate).

**A9. Q: A team proposes a CI-gated composite "SOLID compliance score" (counting interfaces, class sizes, DI usage). Evaluate this as a Principal.**
*Ideal answer:* Push back. Genuine SOLID compliance requires judgment about *actual* variability and coupling-reduction benefit (Advanced Q4/Q5), which a static count can't distinguish from benefit-free abstraction proliferation — a codebase of 200 one-method interfaces would *score well* while being worse. Recommend targeted, judgment-requiring review practices instead: the branch-count/dispatch-growth signal (A7), explicit "reason to change" discussion in design review, LSP contract checks. A single mechanical score rewards over-engineering as readily as good design and gets gamed.
*Why correct:* It names the specific failure (score can't tell good abstraction from proliferation), gives a concrete counterexample, and offers the judgment-based alternative.
*Common mistakes:* Endorsing the score "as a rough signal" (it actively misleads); proposing no alternative.
*Follow-up:* "Is *any* mechanical SOLID signal worth gating?" (narrow ones as *warnings*, not gates — e.g. a new `NotImplementedException` in an interface impl, a dispatch method past a branch+PR-diversity threshold).

**A10. Q: As a Principal, how would you teach SOLID to build genuine design judgment rather than slogan-matching?**
*Ideal answer:* Teach each principle paired with *both* a concrete production incident it would have prevented (this module's §4 for OCP; the OOP module's §4 `PriorityCustomer` case for LSP) *and* a concrete scenario where over-applying it adds needless complexity (A4's DIP over-abstraction; the over-splitting SRP concern). Presenting the failure-to-apply and the over-application failure modes together is what builds the "does this principle's benefit outweigh its cost *here*" judgment that separates a Principal's use of SOLID from rote recitation.
*Why correct:* It prescribes teaching both directions of each principle (under- and over-application) with concrete incidents, which is what develops calibrated judgment.
*Common mistakes:* Teaching each principle only as an unconditional good; using toy examples with no incident behind them.
*Follow-up:* "How do you check the teaching worked?" (in design reviews, do engineers cite the trade-off — 'we accept this OCP violation because…' — rather than just 'that's not SOLID').

### Expert (FinTech Principal Panel)

1. **Q: A payments platform constantly adds fee rules, routing rules, and promotions, and each change currently means editing the settlement core — a high-risk, heavily-regulated code path. Apply OCP so new rules are added without modifying (or re-certifying) the money-critical core, and address the governance angle.**
 **A:** Model each rule as a polymorphic **strategy** (`IFeeRule`/`IRoutingRule`) evaluated by a core engine that iterates a **registry** of rules rather than a growing `switch` (the exact anti-pattern) — adding a rule means adding a *new class* (and registering it), never editing the engine, so the settlement core is **closed for modification, open for extension**. Beyond the code, this OCP structure delivers a *governance* win specific to regulated finance: because new rules don't touch the certified core, they can be reviewed, tested, and (where the org allows) enabled via **configuration/feature flags** with their own change-control, without re-certifying the high-assurance money path — dramatically shrinking the blast radius and the compliance re-review scope of a routine fee change. Add: each rule independently unit-tested; an explicit, ordered, deterministic evaluation (rules that compose must have defined precedence — money math can't depend on undefined ordering); and an audit record of which rules applied to each transaction (regulators ask). Caveat (Advanced Q4): don't over-abstract genuinely-stable single-implementation logic into a strategy for its own sake. The Principal framing: OCP here isn't just tidy code — it isolates a volatile, frequently-changing concern (rules) from a stable, high-assurance, expensively-governed core (settlement), so change velocity on rules doesn't impose change *risk* on money movement.
 **Why correct:** Uses strategy + registry to keep the core closed, and connects OCP to the regulatory blast-radius/change-control win plus deterministic ordering and audit.
 **Common mistakes:** A growing `switch` in the settlement core; non-deterministic rule ordering; over-abstracting stable logic; no audit of applied rules.
 **Follow-ups:** "How does OCP shrink the compliance re-certification scope of a fee change?" / "How do you make composed rule evaluation deterministic?" / "Where do feature flags fit and what governs them?"

2. **Q: Your system integrates external card networks, banks, and market-data feeds. Apply DIP so this is testable and providers are swappable, and explain how this leads toward a ports-and-adapters (hexagonal) boundary.**
 **A:** The core domain (authorize, settle, price) must **depend on abstractions it owns** — `IPaymentGateway`, `IMarketDataFeed`, `ILedger` — not on a vendor SDK's concrete types (DIP). Each external system gets an **adapter** implementing the core's interface, and the interface is defined in terms of the *domain's* needs, not the vendor's API shape — an **anti-corruption layer** that keeps a provider's quirks (odd status codes, field names, retry semantics) from leaking into the core. Benefits: (1) **testability** — the domain is unit-tested against fakes/mocks with no network or vendor sandbox (DIP's real payoff, Advanced Q8), and you can simulate declines/timeouts/partial failures deterministically, which is exactly what money code must be tested against; (2) **swappability/multi-provider** — add or replace a processor by writing a new adapter, no core change (this is also OCP), enabling failover between providers and vendor migration without touching business logic; (3) **isolation from vendor outages/changes** in one place. This is precisely **hexagonal architecture**: the domain at the center, `ports` (the interfaces) at its edge, `adapters` (vendor implementations) outside — DIP is the principle, ports-and-adapters is the architecture it produces at the system boundary. The Principal framing: for a system whose correctness depends on external rails you don't control, DIP-owned domain interfaces + per-vendor adapters (an anti-corruption layer) make the core deterministically testable and vendor-independent — the money logic never knows or cares which processor it's talking to, which is both a testing and a resilience/portability property.
 **Why correct:** Applies DIP with domain-owned interfaces + adapters/anti-corruption layer, ties it to deterministic testability and provider swap/failover, and correctly identifies it as hexagonal architecture.
 **Common mistakes:** Domain depending on vendor SDK types; interfaces shaped by the vendor not the domain (leaky abstraction); no fakes so money paths are only tested against a live sandbox.
 **Follow-ups:** "Why define the interface in the domain's terms, not the vendor's?" / "How does this enable failover between two processors?" / "How does the anti-corruption layer stop vendor quirks leaking in?"

3. **Q: In a regulated settlement system, a change to reporting or notifications sometimes forces a change to — and re-testing/re-certification of — the core money-movement code, because they're entangled in one class. Frame this as an SRP problem and explain the risk-isolation payoff.**
 **A:** This is SRP viewed through its most important FinTech lens: **blast radius and change-risk isolation**. When money movement, reporting, notification, and audit all live in one class (or one method), they change together, so a low-stakes tweak (reword a notification, add a report column) drags the high-assurance settlement path into the diff — meaning re-review, re-test, and often re-certification of code that didn't functionally change, plus the genuine risk of a reporting change introducing a settlement bug. SRP says each of these is a **separate reason to change** owned by a separate component: the settlement core does money movement and nothing else; reporting, notification, and audit subscribe to its outcomes (domain events / an outbox) rather than being inlined. The payoff isn't just cleaner code — it's that the **volatile, frequently-changing, lower-assurance concerns can change freely without touching the stable, expensively-governed core**, so change velocity on the periphery doesn't impose change risk (or compliance cost) on the money path. Verify it the SRP way (Advanced Q5): the settlement core and the reporting code must be *independently changeable and testable* — if a reporting change still forces a settlement-core edit, the split isn't real. The Principal framing: in regulated finance SRP is a risk-management tool — separating concerns by their reason-to-change keeps the high-assurance core small, stable, and rarely-touched, which minimizes both the blast radius of bugs and the scope of compliance re-certification, and that isolation is worth far more than the aesthetic of "one class, one job."
 **Why correct:** Frames SRP as change-risk/blast-radius and compliance-scope isolation, separates the core from reporting/notification/audit via events, and validates via independent changeability.
 **Common mistakes:** Entangling money movement with reporting/notification; measuring SRP by file count not independent changeability; letting peripheral changes drag the core into re-certification.
 **Follow-ups:** "How do reporting/notification consume settlement outcomes without being inlined?" / "How does SRP reduce compliance re-certification scope?" / "How do you prove the split is real, not cosmetic?"

4. **Q: A `IRepository<T>` interface in a trading-limits service exposes `GetById`, `GetAll`, `Add`, `Update`, `Delete`, and `BulkImport`. A junior engineer implements a new `RiskLimitRepository`, stubs `BulkImport` with `throw new NotImplementedException`, and the PR passes review because "it compiles and the tests we wrote pass." Three months later, an unrelated batch-reconciliation job calls `BulkImport` polymorphically against a collection of `IRepository<T>` implementations and crashes in production. Diagnose using both ISP and LSP, and propose the durable fix.**
 **A:** Two SOLID violations, not one, and distinguishing them matters for the fix. The **ISP violation** is the root design flaw: `IRepository<T>` bundles a capability (`BulkImport`) not every implementation genuinely supports, forcing `RiskLimitRepository` to either implement something meaningless for its domain or stub it — there was never a clean option. The **LSP violation** is the downstream consequence: once stubbed with `NotImplementedException`, `RiskLimitRepository` is no longer safely substitutable everywhere `IRepository<T>` is used, because the interface's implicit contract ("all these operations work") is violated for this specific implementation — and this is exactly why "it compiles and passes the tests *we* wrote" was never sufficient evidence: the tests exercised only the paths `RiskLimitRepository`'s own author anticipated, not the full contract every `IRepository<T>` consumer is entitled to assume. The durable fix is ISP-driven, not a better stub: split into `IReadableRepository<T>`, `IWritableRepository<T>`, and a separate `IBulkImportable<T>` (the Hard exercise's exact segregation), so `RiskLimitRepository` simply never implements `IBulkImportable<T>` — the batch-reconciliation job's polymorphic loop then either compiles against `IEnumerable<IBulkImportable<T>>` specifically (structurally excluding `RiskLimitRepository` from ever being handed to it) or explicitly filters via `OfType<IBulkImportable<T>>`, converting a runtime crash into a compile-time-visible, correctly-scoped set of participants. The Principal framing: an interface promising a capability not every implementation can honor is a design defect that *will* eventually be exercised by a caller who reasonably trusted the interface's full contract — segregating the interface removes the possibility of the crash entirely, rather than requiring every future implementer to remember to review "for capabilities I don't support, will anyone call this."
 **Why correct:** Correctly separates the ISP root cause (a fat interface promising an unsupported capability) from the LSP consequence (a stub breaking substitutability for any caller relying on the full contract), and fixes it via segregation rather than a better exception or documentation.
 **Common mistakes:** Treating this as "the junior engineer should have implemented `BulkImport` properly" rather than recognizing the interface itself was mis-designed; fixing it with a more descriptive exception message instead of removing the false promise structurally; not recognizing "tests pass" only validates the paths the test author anticipated.
 **Follow-ups:** "How would a code-review checklist have caught this before merge?" / "Why is `NotImplementedException` almost always a design smell rather than a legitimate implementation choice?" / "How do you retrofit this fix onto a live interface with a dozen existing implementations?"

5. **Q: Your firm's compliance team mandates that every change to trade-surveillance rule logic be independently auditable — reviewable and attributable to a specific rule author, without requiring re-review of the surveillance engine itself. The current design has all rules as `if` branches inside one `SurveillanceEngine.Evaluate` method, authored collectively by the whole team in one shared file. Redesign using OCP and SRP together, and explain precisely how the redesign satisfies the audit requirement, not just "cleaner code."**
 **A:** Model each rule as its own `ISurveillanceRule` implementation (`WashTradeRule`, `SpoofingRule`, `LayeringRule`), each in its own file/class with a clear, single author and git-blame history scoped to exactly that rule's logic — OCP structurally guarantees the shared `SurveillanceEngine` (which iterates a registered collection of rules and aggregates their flags) never needs modification when a rule is added, changed, or removed, so no rule change ever touches, or requires re-review of, the engine itself. This directly satisfies the compliance requirement in a way "cleaner code" alone doesn't: the **audit trail is structural, not just cosmetic** — a compliance reviewer examining "who changed the wash-trade detection logic and when" gets a precise, scoped git history for `WashTradeRule.cs` alone, with zero unrelated diffs from other rules' evolution mixed in, because SRP ensures each rule class has exactly one reason to change (its own detection logic) and OCP ensures adding/modifying a rule never requires touching the shared engine's own, separately-certified code. Additionally, each rule can carry its own metadata (author, effective date, regulatory citation) as part of its class definition, queryable and reportable independently — something impossible when all rules live as anonymous branches inside one shared method with one collective commit history. The Principal framing: "auditable" is not an abstract virtue here — it's a specific, checkable property (can I attribute and scope a change to exactly the logic it affects, without noise from unrelated logic) that SRP+OCP deliver as a direct structural consequence, not as a byproduct that happens to also look tidier.
 **Why correct:** Ties OCP's "no core modification" and SRP's "one reason to change" directly to the concrete, checkable compliance requirement (scoped git-history attribution per rule), not just general code-quality language.
 **Common mistakes:** Describing the refactor only in terms of "cleaner" or "more maintainable" without connecting to the specific audit/attribution requirement; not addressing how rule metadata (author, regulatory citation) is captured structurally; assuming code cleanliness alone satisfies a compliance requirement without checking the actual audit need.
 **Follow-ups:** "How would you version a rule that changes its detection threshold over time, while preserving old audit history?" / "Where does rule-evaluation ordering matter, and how do you make it deterministic and auditable?" / "How does this connect to the settlement-core governance point from Expert Q1?"

6. **Q: A codebase has an `IAuditLogger` interface with a single method, `LogAsync(AuditEvent)`, injected into every service via DIP. A Principal Engineer reviewing the design flags it as "DIP in letter, not in spirit." What's the likely underlying problem, and how do you diagnose it?**
 **A:** DIP requires the abstraction to be genuinely owned by, and shaped around, the high-level module's actual needs — not merely "any interface, injected via constructor" satisfying the mechanical letter of "depend on an abstraction." The likely problem: `IAuditLogger` was probably designed by copying the concrete logging vendor's own API shape (a single generic `LogAsync(AuditEvent)` mirroring, say, a specific SIEM vendor's ingestion API) rather than being shaped around what each high-level module actually needs to express (an `OrderService` wants to say "this order was rejected for this specific regulatory reason"; a `SettlementService` wants to say "this settlement was flagged for manual review") — if `AuditEvent` is really just a thin wrapper around the vendor's own event schema, the abstraction hasn't actually inverted anything: swapping SIEM vendors still requires touching every call site's construction of `AuditEvent`, because the "abstraction" leaked the vendor's shape through it. This is the DIP equivalent of Expert Q2's "shape the interface around the domain, not the vendor" (anti-corruption layer) principle, now shown failing specifically in a supposedly-DIP-compliant design that technically has an interface and constructor injection, but not the actual decoupling DIP exists to provide. Diagnosis: check whether swapping the concrete `IAuditLogger` implementation (a different SIEM vendor, a different transport) requires touching any call site beyond the DI registration — if yes, the abstraction is vendor-shaped, not domain-shaped, and DIP is satisfied only mechanically. Fix: redesign `IAuditLogger`'s surface (and `AuditEvent`'s shape) around what the *domain* needs to express, with the concrete implementation responsible for translating that domain-shaped call into whatever the specific vendor's actual API requires.
 **Why correct:** Distinguishes DIP's mechanical form (an interface, constructor injection) from its actual substance (an abstraction shaped by the high-level module's needs, not leaking the low-level vendor's shape through it), with a concrete diagnostic test (does swapping the implementation touch call sites).
 **Common mistakes:** Treating "has an interface and uses constructor injection" as sufficient proof of DIP compliance; not checking whether the abstraction's shape actually originates from vendor API design rather than domain need; conflating this with a simple ISP fat-interface problem when the real issue is *whose vocabulary* the interface speaks.
 **Follow-ups:** "What's the concrete test for whether an abstraction is domain-shaped versus vendor-shaped?" / "How does this connect to the anti-corruption-layer discussion in Expert Q2?" / "Would splitting `IAuditLogger` into per-domain-event interfaces fix this, or is that an orthogonal ISP concern?"

7. **Q: You're brought in to review a five-year-old core-banking ledger codebase. `LedgerEntry` is a 40-method class handling posting, reversal, currency conversion, regulatory-report formatting, and notification-triggering, all touched by four different teams. Every team reports the class as "too risky to touch." Walk through how you'd apply SRP, OCP, and ISP together to de-risk it — and specifically address why a full rewrite is the wrong first move.**
 **A:** A full rewrite is the wrong first move because a 40-method, multi-team-owned class handling money movement is precisely the highest-risk code to attempt a big-bang replacement of — any behavioral drift introduced during a rewrite is maximally expensive to detect and correct in exactly this domain, and "too risky to touch" is itself evidence the team lacks the test coverage/confidence a safe rewrite would require. The de-risking path is **incremental extraction along genuine reason-to-change boundaries** (SRP), starting with the concern that changes most independently of the others and has the clearest boundary — likely regulatory-report formatting (changes on the regulator's schedule, not the ledger's) or notification-triggering (changes on the product team's schedule) — extracted into its own class behind a narrow interface, with the original `LedgerEntry` method becoming a thin delegating call, verified via characterization tests (capturing existing behavior before extraction, not after) so the extraction is provably behavior-preserving at each step. Once posting/reversal/conversion (the genuinely core, money-moving concerns) are the only logic left directly in `LedgerEntry`, apply OCP: currency-conversion logic likely already has, or will grow, a switch-shaped set of cases (per currency pair or provider) that should become a registered `ICurrencyConverter` strategy set rather than remaining inline growth inside the core class — closing the highest-risk remaining logic to future modification. Finally, apply ISP to whatever's left: the four teams likely each need only a slice of `LedgerEntry`'s full surface (posting-only, reporting-only, etc.) — segregating into role-specific interfaces (`IPostable`, `IReversible`, `ILedgerReportSource`) lets each team depend on, and be shielded from changes to, only their own slice, directly reducing the "everyone is afraid to touch it because everyone else depends on all of it" dynamic that made the class feel untouchable in the first place. The Principal framing: the fear of touching this class *is* the SOLID violation made visible as an organizational symptom — untangling it via incremental, test-verified extraction along genuine reason-to-change boundaries is both the technically safer path and the one that directly dissolves the cross-team coordination fear driving the "too risky" assessment, whereas a rewrite would recreate the same fear on day one of the new system with none of the accumulated institutional knowledge the old one has already encoded.
 **Why correct:** Sequences SRP extraction (safest, most independent concerns first, via characterization tests) before OCP (closing the genuinely core, highest-risk logic) before ISP (segregating remaining surface per team), and explicitly explains why a rewrite is riskier than incremental de-risking for exactly this domain.
 **Common mistakes:** Recommending a rewrite as the primary answer; extracting the money-moving core logic first instead of the safer peripheral concerns; not connecting "too risky to touch" to the underlying SOLID violations as a diagnostic, treating it as merely a team-culture problem.
 **Follow-ups:** "What are characterization tests, and why write them before extracting, not after?" / "How do you sequence which concern to extract first, in general?" / "How would you measure whether this de-risking effort is actually working, incrementally, rather than only at the end?"

---

## 11. Coding Exercises

### Easy — Fix an SRP violation by separating independently-varying concerns
```csharp
// C# — BEFORE: two independently-varying concerns (tax calc, display formatting) in one class
public class InvoiceProcessor
{
    public decimal CalculateTax(Invoice invoice) => invoice.Subtotal * GetTaxRate(invoice.Region);
    public string FormatForDisplay(Invoice invoice) => $"Invoice #{invoice.Id}: ${invoice.Total:F2}";
}

// AFTER: split along "reason to change" -- tax law changes independently of display formatting
public sealed class TaxCalculator   { public decimal CalculateTax(Invoice i) => i.Subtotal * GetTaxRate(i.Region); }
public sealed class InvoiceFormatter { public string FormatForDisplay(Invoice i) => $"Invoice #{i.Id}: ${i.Total:F2}"; }
```
```java
// Java — BEFORE
public class InvoiceProcessor {
    public BigDecimal calculateTax(Invoice i) { return i.subtotal().multiply(taxRate(i.region())); }
    public String formatForDisplay(Invoice i) { return "Invoice #" + i.id() + ": " + i.total().toPlainString(); }
}

// AFTER — tax law and marketing's formatting preference are different masters
public final class TaxCalculator {
    public BigDecimal calculateTax(Invoice i) { return i.subtotal().multiply(taxRate(i.region())); }
}
public final class InvoiceFormatter {
    public String formatForDisplay(Invoice i) { return "Invoice #" + i.id() + ": " + i.total().toPlainString(); }
}
```

### Medium — Fix an OCP violation with a strategy-pattern refactor
```csharp
// C#
public interface INotificationChannel
{
    string ChannelName { get; }
    Task SendAsync(Notification notification);
}

public sealed class EmailChannel : INotificationChannel
{
    public string ChannelName => "Email";
    public Task SendAsync(Notification n) => /* email-specific logic */ Task.CompletedTask;
}
public sealed class SmsChannel : INotificationChannel
{
    public string ChannelName => "SMS";
    public Task SendAsync(Notification n) => /* SMS logic -- UNTOUCHED by future additions */ Task.CompletedTask;
}

public sealed class NotificationDispatcher
{
    private readonly IEnumerable<INotificationChannel> _channels; // resolved via DI
    public NotificationDispatcher(IEnumerable<INotificationChannel> channels) => _channels = channels;

    public Task DispatchAsync(Notification n)
    {
        var channel = _channels.FirstOrDefault(c => c.ChannelName == n.PreferredChannel);
        return channel?.SendAsync(n) ?? Task.CompletedTask;
    }
}
// Adding Slack: ONE new class + ONE registration line. ZERO edits to Email/Sms channels.
```
```java
// Java — the "inject a List of every implementation" pattern (Spring autowires it;
// or build it by hand / via ServiceLoader) is the idiomatic OCP registry.
public interface NotificationChannel {
    String channelName();
    CompletableFuture<Void> send(Notification n);
}

public final class EmailChannel implements NotificationChannel {
    public String channelName() { return "Email"; }
    public CompletableFuture<Void> send(Notification n) { /* email logic */ return CompletableFuture.completedFuture(null); }
}
public final class SmsChannel implements NotificationChannel {
    public String channelName() { return "SMS"; }
    public CompletableFuture<Void> send(Notification n) { /* SMS logic — untouched by additions */ return CompletableFuture.completedFuture(null); }
}

public final class NotificationDispatcher {
    private final Map<String, NotificationChannel> byName;
    public NotificationDispatcher(List<NotificationChannel> channels) {
        this.byName = channels.stream()
            .collect(Collectors.toUnmodifiableMap(NotificationChannel::channelName, c -> c));
    }
    public CompletableFuture<Void> dispatch(Notification n) {
        NotificationChannel c = byName.get(n.preferredChannel());
        return c != null ? c.send(n) : CompletableFuture.completedFuture(null);
    }
}
// Adding SlackChannel: a new class; Spring picks it up automatically, or one line in the wiring.
```

### Hard — Fix an ISP violation by splitting a fat repository interface
```csharp
// C# — BEFORE: forces every implementation/consumer to depend on the ENTIRE surface
public interface IRepository<T>
{
    Task<T?> GetByIdAsync(string id);
    Task<IReadOnlyList<T>> GetAllAsync();
    Task AddAsync(T item);
    Task UpdateAsync(T item);
    Task DeleteAsync(string id);
    Task BulkImportAsync(IEnumerable<T> items);
}

// AFTER: segregated by actual consumer need
public interface IReadableRepository<T>
{
    Task<T?> GetByIdAsync(string id);
    Task<IReadOnlyList<T>> GetAllAsync();
}
public interface IWritableRepository<T> : IReadableRepository<T>
{
    Task AddAsync(T item);
    Task UpdateAsync(T item);
    Task DeleteAsync(string id);
}
public interface IBulkImportable<T>
{
    Task BulkImportAsync(IEnumerable<T> items);
}
// A read-only reporting service depends ONLY on IReadableRepository<T> -- never recompiled/retested
// when BulkImportAsync changes, and structurally cannot call DeleteAsync (ISP == least privilege).
```
```java
// Java — same segregation. RiskLimitRepository simply does NOT implement BulkImportable<T>,
// so the batch job that needs bulk import is typed on List<BulkImportable<T>> and can never
// be handed a repo that would throw UnsupportedOperationException at runtime.
public interface ReadableRepository<T> {
    Optional<T> findById(String id);
    List<T> findAll();
}
public interface WritableRepository<T> extends ReadableRepository<T> {
    void add(T item);
    void update(T item);
    void delete(String id);
}
public interface BulkImportable<T> {
    void bulkImport(Collection<T> items);
}

// A reporting service:
public final class LimitReport {
    private final ReadableRepository<RiskLimit> repo;   // read-only slice only
    public LimitReport(ReadableRepository<RiskLimit> repo) { this.repo = repo; }
    // 'repo' has no delete()/bulkImport() in scope at all — the narrow type IS the boundary.
}
```

### Expert — Demonstrate DIP with a composition root, no DI container required (Advanced Q9)
```csharp
// C# — business logic depends ONLY on abstractions; the wiring MECHANISM is irrelevant to DIP.
public interface IOrderRepository { Task SaveAsync(Order order); }
public interface IPaymentGateway  { Task<bool> ChargeAsync(decimal amount); }

public sealed class OrderService
{
    private readonly IOrderRepository _repository;
    private readonly IPaymentGateway _gateway;
    public OrderService(IOrderRepository repository, IPaymentGateway gateway)
        => (_repository, _gateway) = (repository, gateway);

    public async Task PlaceOrderAsync(Order order)
    {
        if (await _gateway.ChargeAsync(order.Total)) await _repository.SaveAsync(order);
    }
}

// "Poor man's DI" -- manual composition root, NO container library:
var repository   = new SqlOrderRepository(connectionString);
var gateway      = new StripeGateway(apiKey);
var orderService = new OrderService(repository, gateway); // hand-wired, DIP STILL satisfied
```
```java
// Java — identical. OrderService imports neither JdbcOrderRepository nor StripeGateway.
public interface OrderRepository { void save(Order order); }
public interface PaymentGateway  { boolean charge(BigDecimal amount); }

public final class OrderService {
    private final OrderRepository repository;
    private final PaymentGateway gateway;
    public OrderService(OrderRepository repository, PaymentGateway gateway) {
        this.repository = repository;
        this.gateway = gateway;
    }
    public void placeOrder(Order order) {
        if (gateway.charge(order.total())) repository.save(order);
    }
}

// Composition root in main() — no Spring, no Guice:
OrderRepository repository   = new JdbcOrderRepository(dataSource);
PaymentGateway  gateway      = new StripeGateway(apiKey);
OrderService    orderService = new OrderService(repository, gateway); // DIP satisfied, framework-free
```
**Discussion**: `OrderService`'s source code has zero reference to `SqlOrderRepository`/`StripeGateway` at all — DIP is fully satisfied here despite using no DI container, framework, or `Microsoft.Extensions.DependencyInjection` whatsoever, directly demonstrating Advanced Q9's point that DIP is about dependency *direction*, entirely independent of the *mechanism* (a full DI container, manual composition, or any other wiring approach) used to supply concrete implementations at the application's entry point.

---

## 12. System Design

**Scenario:** design a **rule-driven fee and routing engine** for a payments platform (directly Expert Q1's scenario, developed here to full system-design depth) that must apply an evolving, business-team-managed set of fee rules, promotions, and routing rules to every transaction, without any rule change ever requiring modification or re-certification of the settlement core.

**Requirements.**
- *Functional*: evaluate an ordered, potentially-composed set of fee/routing rules per transaction; support adding, retiring, or A/B-testing a rule without a core-engine deployment; produce a deterministic, auditable record of which rules applied and why.
- *Non-functional*: settlement core must remain a small, stable, infrequently-changed, heavily-reviewed codebase (SRP + OCP together — one core reason to change: correctness of money movement itself); rule addition must be independently deployable per rule/team (ISP + DIP); throughput target of 5,000 transactions/second at peak, each evaluated against ~50 active rules.

**Architecture.** The **settlement core** depends only on an `IEnumerable<IFeeRule>`/`IEnumerable<IRoutingRule>` abstraction (DIP) — it has no knowledge of, or compiled dependency on, any concrete rule. A **rule registry**, populated at startup (and refreshable without a full redeploy via a feature-flag-gated reload), supplies the active rule set. Each rule is its own class implementing a narrow interface (`IFeeRule { bool AppliesTo(Transaction t); Money Calculate(Transaction t); }`) — narrow specifically so ISP prevents any rule from being handed capabilities (direct ledger write access, direct network calls) it doesn't need, containing the blast radius of a buggy or malicious rule implementation (§8's OCP-blast-radius point).

**Database selection.** Rule *definitions* (metadata: author, effective date, regulatory citation, enabled/disabled flag) live in a relational store (SQL Server) — this data has strict consistency and auditability requirements (a rule's effective-date and author must never be ambiguous or eventually-consistent for compliance purposes), directly the "boring ACID store for regulated financial metadata" reasoning this repo's System-Design standard names explicitly. Rule *evaluation* happens entirely in-process against the loaded, compiled rule set — no per-transaction database round-trip for rule logic itself, since that would violate the throughput requirement.

**Caching.** The active rule set is loaded once at startup and cached in-memory as an immutable snapshot (directly the sibling OOP module's §9 immutability-enables-safe-concurrent-sharing point) — every concurrent transaction-processing thread reads the same immutable rule-set reference with zero locking; a rule-set change triggers an atomic reference swap (a new immutable snapshot replaces the old one), never an in-place mutation of the live, currently-in-use rule collection.

**Messaging/audit.** Every transaction's rule-evaluation outcome (which rules applied, in what order, with what individual contribution to the final fee) is emitted as a structured audit event to an append-only store/topic — directly satisfying Expert Q5's audit-trail requirement, and enabling the reconciliation/regulatory-reporting consumers to be built independently of the core (SRP: the core's one job is correct evaluation; audit-record consumption is a separate, independently-evolving concern).

**Scaling.** Stateless rule evaluation (§9's SRP-and-horizontal-scale point: no rule holds mutable per-transaction state across calls) means the engine scales horizontally by simply running more instances behind a load balancer, each loading the identical immutable rule-set snapshot; rule *evaluation count* (§7) is the actual per-transaction cost driver, kept bounded by indexing rules on cheap applicability predicates (currency, instrument type) evaluated before the more expensive `Calculate` step, so a transaction only pays the cost of rules that could plausibly apply to it.

**Failure handling.** A single rule implementation throwing is caught at the registry-iteration boundary and recorded as a rule-level failure (with the transaction either failing closed — rejected pending investigation — or proceeding without that specific rule's contribution, per a explicit, reviewed policy decision per rule category) — never permitted to fail the entire evaluation pipeline or affect any other rule's independent evaluation, directly the same per-unit isolation as the sibling OOP module's per-channel notification isolation.

**Monitoring.** Per-rule evaluation latency and failure-rate metrics (a slow or frequently-failing rule must be individually visible, not averaged into one aggregate "rule evaluation" metric); a rule-set-version gauge so any incident investigation can immediately determine exactly which rule-set snapshot was active at the time of a specific transaction.

**Trade-offs.** The registry/strategy design costs a small amount of indirection and an explicit rule-ordering/composition policy (rules that stack must have defined precedence — Expert Q1's determinism requirement) versus a simpler, single switch-based engine; it buys exactly what the non-functional requirements demand — independent rule deployability, a stable/rarely-touched core, contained blast radius per rule, and a structural (not merely disciplined) audit trail.

## 13. Low-Level Design

```mermaid
classDiagram
    class SettlementCore {
        -IReadOnlyList~IFeeRule~ _feeRules
        -IReadOnlyList~IRoutingRule~ _routingRules
        +Evaluate(transaction) EvaluationResult
    }
    class IFeeRule {
        <<interface>>
        +AppliesTo(transaction) bool
        +Calculate(transaction) Money
    }
    class IRoutingRule {
        <<interface>>
        +AppliesTo(transaction) bool
        +Route(transaction) RoutingDecision
    }
    class FlatFeeRule
    class PromotionalDiscountRule
    class CrossBorderRoutingRule
    class RuleRegistry {
        -ImmutableArray~IFeeRule~ _activeFeeRules
        +Snapshot() IReadOnlyList~IFeeRule~
        +Reload(newRules) void
    }
    class EvaluationResult {
        +Money TotalFee
        +RoutingDecision Route
        +IReadOnlyList~AppliedRuleRecord~ AuditTrail
    }
    SettlementCore --> IFeeRule : DIP -- depends on abstraction
    SettlementCore --> IRoutingRule : DIP -- depends on abstraction
    IFeeRule <|.. FlatFeeRule
    IFeeRule <|.. PromotionalDiscountRule
    IRoutingRule <|.. CrossBorderRoutingRule
    RuleRegistry --> IFeeRule : supplies immutable snapshot
    SettlementCore --> EvaluationResult
```

```mermaid
sequenceDiagram
    participant Client
    participant Core as SettlementCore
    participant Registry as RuleRegistry
    participant Rule as IFeeRule (PromotionalDiscountRule)

    Client->>Core: Evaluate(transaction)
    Core->>Registry: Snapshot()
    Registry-->>Core: immutable IReadOnlyList<IFeeRule>
    loop for each rule in snapshot
        Core->>Rule: AppliesTo(transaction)
        Rule-->>Core: true
        Core->>Rule: Calculate(transaction)
        Rule-->>Core: Money(discount)
        Core->>Core: append AppliedRuleRecord (audit trail)
    end
    Core-->>Client: EvaluationResult(TotalFee, AuditTrail)
```

**Design patterns used:** Strategy (`IFeeRule`/`IRoutingRule` per rule), Registry (startup-loaded, atomically-swappable immutable rule set), Composite-evaluation (the core aggregates many independent rule outcomes into one `EvaluationResult`), Null-Object-adjacent (a rule category with zero active rules simply contributes nothing, no special-casing required in the core).

**SOLID mapping:** SRP — `SettlementCore`'s one reason to change is "how rule outcomes get aggregated into a final result," never "what a specific rule computes"; each `IFeeRule` implementation's one reason to change is its own business logic. OCP — new rules are new classes plus a registry entry; `SettlementCore` is never modified to add a rule (this module's central, recurring lesson, now at full system-design scale). LSP — every `IFeeRule` implementation is safely substitutable because the interface promises only what every rule can genuinely deliver (`AppliesTo`/`Calculate`, never a capability like `Refund` some rules can't honor — directly avoiding Expert Q4's `NotImplementedException` trap). ISP — the interface is deliberately minimal, containing what any single malicious/buggy rule implementation could affect (§8). DIP — `SettlementCore` depends only on `IFeeRule`/`IRoutingRule`, never on any concrete rule or on `RuleRegistry`'s loading mechanism.

**Extensibility:** a new rule ships as an independently-reviewed, independently-deployable class plus one registry entry — zero modification to `SettlementCore`, directly satisfying the compliance/audit requirement from Expert Q5 as a structural, not disciplinary, property.

**Concurrency/thread safety:** `RuleRegistry.Snapshot` returns an immutable collection reference; a rule-set reload constructs an entirely new immutable snapshot and atomically swaps the reference (`Interlocked.Exchange` or an equivalent atomic publish) rather than mutating the live collection in place — every concurrently-evaluating transaction reads a self-consistent snapshot with zero locking required, and no transaction ever observes a rule set "half-updated" mid-reload; each `IFeeRule` implementation must itself be stateless across calls (directly the sibling OOP module's §14 incident — a rule with an instance-level mutable field registered as a shared singleton would reintroduce that exact concurrency bug here).

## 14. Production Debugging

**Incident:** a promotional discount campaign's rule (`PromotionalDiscountRule`, added independently by the marketing-integrations team, deployed without touching `SettlementCore`) begins applying a discount **twice** to a subset of cross-border transactions starting the moment a second, unrelated rule (`CrossBorderFeeWaiverRule`, added independently by a different team the same week) goes live — neither team's own tests catch it, since each team tested its own rule in isolation against `SettlementCore` with only its own rule registered.

**Investigation:** `SettlementCore`'s aggregation logic, written years earlier by neither team, summed every applicable fee-rule's `Calculate` output unconditionally — a design choice that was correct and invisible for years while every rule computed a genuinely independent, additive fee component. `PromotionalDiscountRule` and `CrossBorderFeeWaiverRule`, evaluated independently and correctly by their own unit tests, both happened to key their applicability off an overlapping condition (`transaction.IsCrossBorder && transaction.HasActivePromotion`) without either rule's author being aware the other rule existed or evaluated the same condition — each rule's *own* logic was individually correct; the *composition* of the two, summed unconditionally, double-applied the intended net discount.

**Tools:** replaying the flagged transactions against a rule-by-rule evaluation trace (the `AuditTrail` field on `EvaluationResult`, §12/§13) showed both rules' `AppliedRuleRecord` entries firing for the same transaction with overlapping intent — immediately visible once the audit trail was inspected, but invisible to either team's isolated unit test suite, since neither test suite ever exercised both rules registered simultaneously.

**Root cause:** OCP's "add a rule without modifying the core" guarantee correctly held — no rule broke another rule's *individual* correctness — but the system-design requirement §12 identified explicitly ("rules that stack must have defined precedence") had never actually been implemented; `SettlementCore`'s unconditional summation implicitly assumed every registered rule combination was mutually exclusive or genuinely additive, an assumption that held by accident for years until two independently-correct rules happened to overlap in applicability. This is precisely Expert Q1's determinism requirement, violated not by any single rule's bug but by the *composition* of two individually-correct rules — the OCP/DIP-compliant extension mechanism worked exactly as designed; the gap was a missing cross-rule invariant the design had never made explicit or enforced.

**Fix:** `SettlementCore`'s aggregation logic was changed from unconditional summation to an explicit **conflict-detection step**: before summing, the core checks whether more than one *discount-category* rule (a category each `IFeeRule` now declares as metadata, not inferred from its logic) applied to the same transaction, and if so, applies a declared, reviewed **precedence policy** (highest single discount wins, rather than summing) rather than silently combining them — directly closing the gap between "each rule is individually LSP/OCP-compliant" and "the aggregate of any combination of rules is correct," the same composition-risk distinction the sibling Distributed-Systems CRDT module names explicitly for a different domain.

**Prevention:** any new rule PR now requires declaring its discount category as part of the interface contract (`IFeeRule.Category`), and a new, mandatory **cross-rule interaction test suite** runs every currently-registered rule combination against a representative transaction set nightly — specifically designed to catch overlapping-applicability combinations neither individual team's isolated unit tests could ever surface, directly generalizing this module's Hard exercise (a contract test run across implementations) to a *combinatorial*, cross-implementation contract, not just a per-implementation one.

## 15. Architecture Decision

**Decision:** how should the fee/routing rule engine (§12–§14) prevent the double-discount class of bug from recurring — (A) revert to a single, centrally-reviewed `switch`-based engine so all rule interactions are visible in one place, (B) keep the OCP-compliant registry design but add explicit rule categories and a cross-rule interaction test suite (the fix adopted), or (C) require every new rule's PR to be reviewed against every existing rule's logic manually before merge?

| | (A) Revert to switch | (B) Categories + interaction tests (adopted) | (C) Manual cross-rule review |
|---|---|---|---|
| **Advantages** | All interactions visible in one file to one reviewer | Preserves OCP's independent-deployability benefit; interaction risk is caught mechanically, not by hoping a reviewer notices | No new tooling/process to build |
| **Disadvantages** | Reintroduces this module's own central incident (a shared, modification-requiring core, and the settlement-core governance loss from Expert Q1) — trades one bug class for a worse, already-demonstrated one | Requires upfront investment in category metadata + interaction-test infrastructure | Doesn't scale — reviewer cannot realistically hold 50+ rules' full interaction space in mind, and the bug reproduces the moment review discipline lapses once |
| **Cost/complexity** | Low to revert, but reintroduces coordination bottleneck as rule count grows | Moderate upfront (category metadata, nightly combinatorial suite) | Low to state as policy, unenforceable in practice |
| **Maintainability** | Degrades with rule count exactly as before | Stays flat — new rules add to the interaction-test matrix automatically | Degrades immediately — the same failure mode as this incident, guaranteed to recur |
| **Scalability (team)** | Poor — reverses the independent-team-deployability property this design exists for | Good — independent deployability preserved, safety net is automated | Poor — creates an unscalable, single-reviewer bottleneck |

**Recommendation:** (B) — categories plus a mechanical cross-rule interaction test suite. Option (A) is a false fix: it solves this specific incident by reintroducing the exact incident class (a shared, modification-requiring core) this entire module exists to warn against, trading independent-team deployability for a single point of coordination that will itself eventually fail under load, just via a different mechanism. Option (C) fails for the same underlying reason distributed testing/review discipline always fails at scale — it depends on a human reliably holding an unbounded, growing interaction space in their head. Option (B) is the only choice that closes the actual gap (an unstated cross-rule invariant) without sacrificing the properties (independent deployability, contained blast radius, OCP compliance) the entire architecture was built to provide.

## 17. Principal Engineer Perspective

**Business impact.** A double-applied promotional discount is a direct margin leak at transaction volume — the incident's cost is proportional to transaction count during the exposure window, and in a regulated payments context, an unintended discount discovered by a client before the firm catches it internally is also a reputational and potential compliance-disclosure event; the interaction-test-suite fix is cheap relative to either cost.

**Engineering trade-offs.** This module's throughline — OCP's independent-deployability benefit versus the coordination cost of ensuring independently-developed extensions genuinely compose correctly — is not resolved by picking one side; it's resolved by recognizing that OCP guarantees *non-interference at the modification level* (no rule's code is touched by another rule's addition) but says nothing about *semantic composition* (whether the aggregate of many independently-correct rules remains correct), and building a second, explicit mechanism (categories, interaction tests) for the guarantee OCP was never designed to provide in the first place.

**Technical leadership.** The fix converts a hard-won, incident-derived lesson (individually-correct extensions can still combine incorrectly) into a standing, automated check (the nightly interaction-test suite) rather than a lesson that lives only in the memory of the two teams involved — directly the same "compound institutional judgment via cheap, repeatable checks" discipline the sibling OOP module's §17 names, applied here to cross-team rule composition specifically.

**Cross-team communication.** The incident's root cause was not a communication failure in the usual sense — neither team needed to talk to the other for their own rule to be correct — it was a **missing shared contract** (declared discount categories) that would have let each team's rule declare its own composition-relevant metadata without needing to know about the other team's rule at all; this is the more scalable communication pattern than "teams must talk to each other before shipping" (which doesn't scale past a handful of teams) — a Principal Engineer's job is designing the *structural* mechanism (shared, declared metadata) that substitutes for direct coordination, not mandating more meetings.

**Architecture governance.** Every new `IFeeRule`/`IRoutingRule` addition now goes through a lightweight governance gate — declare a category, pass the automated interaction-test suite — that is cheap enough not to erode the independent-deployability benefit that motivated this architecture in the first place, while still closing the actual gap the incident revealed; governance that's too heavy defeats the architecture's purpose, and governance that's absent reproduces the incident — the calibration between the two is itself a Principal-level judgment call.

**Cost optimization.** §7's performance analysis already establishes that DIP's dispatch overhead is immaterial next to what it wraps (a network call, a database write) — the real, worth-optimizing cost driver in this design is rule-evaluation count at scale, and the interaction-test suite's nightly (not per-commit, not per-transaction) cadence is itself a deliberate cost/latency trade-off: catching composition bugs before they reach production without imposing combinatorial test cost on every single commit.

**Risk analysis and long-term maintainability.** The single largest long-term risk in any registry/strategy-based OCP design is exactly what this incident demonstrates: individual-unit correctness (per-rule LSP/OCP compliance) silently does not imply aggregate correctness, and that gap doesn't announce itself until two independently-correct units happen to interact — the durable mitigation is never "review more carefully" (Option C's failure mode) but building a standing, automated mechanism that scales with the system rather than with any individual engineer's attention span, which is precisely why this module pairs SRP/OCP/ISP/DIP's benefits with an equally explicit account of what each principle does *not* guarantee.

## 18. Revision
**Language note**: SOLID is about coupling and responsibility boundaries — nothing in it is C#-specific. §2.6 gives the full C#↔Java mapping and every code sample here is shown in both. The Java-specific points worth carrying into an interview: (1) inject a `List<T>` of every implementation (Spring autowire / `ServiceLoader`) as the idiomatic OCP registry; (2) `final class` = "no subclass", Java `sealed` = "only these subclasses" (the deliberate-OCP-violation tool); (3) checked exceptions give a partial compile-time LSP guarantee C# lacks, at the cost of the "wrap in `RuntimeException`" smell; (4) `Collections.unmodifiableList` throws at runtime, `List.copyOf` is a true immutable copy — prefer the latter for the ISP-as-least-privilege boundary; (5) avoid field injection (`@Autowired` on a field) — it hides the dependency and defeats `final`.

**Key takeaways**: SRP = "one reason to change" (tied to independently-varying stakeholders), not literally "does one thing." OCP = extend via new code (polymorphism), not by modifying existing, shared dispatch logic — violated OCP has demonstrated, concrete production-bug risk, not just aesthetic cost. ISP = split interfaces along genuine, distinct consumer-need boundaries, not mechanically to one method each. DIP = dependency *direction* (high-level and low-level both depend on abstractions) — distinct from Dependency Injection, which is one *mechanism* (among several, including manual composition) for supplying concrete implementations. The five principles can tension against each other (OCP vs. LSP, the exhaustiveness trade-off) — genuine mastery requires judgment about these interactions, not rote recitation.

---

**Next**: Continuing autonomously to Module 31 — Design Patterns (Creational, Structural, Behavioral) launching the `11-Design-Patterns` domain.
