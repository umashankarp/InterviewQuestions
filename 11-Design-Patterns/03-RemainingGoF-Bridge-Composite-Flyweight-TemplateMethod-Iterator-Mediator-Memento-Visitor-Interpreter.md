# Module 186 — Design Patterns: Completing the GoF Set — Bridge, Composite, Flyweight, Template Method, Iterator, Mediator, Memento, Visitor & Interpreter

> Domain: Design Patterns | Level: Beginner → Expert | Prerequisite: [[01-Creational-Structural-Patterns]] (the 4 structural patterns already covered — Adapter/Decorator/Facade/Proxy), [[02-Behavioral-Patterns]] (Strategy/Observer/Command/Chain-of-Responsibility/State), [[../09-OOP/01-OOP-Fundamentals-Advanced]] §Advanced Q2 (Template Method's canonical example), [[../10-SOLID/01-SOLID-Principles-Deep-Dive]]

>
> **Scope note.** Modules 31 and 32 cover the **14 GoF patterns that dominate real interviews** — all five creational (Singleton, Factory Method, Abstract Factory, Builder, Prototype), the four structural workhorses (Adapter, Decorator, Facade, Proxy), and the five behavioral workhorses (Strategy, Observer, Command, Chain of Responsibility, State). This module completes the set: the remaining **3 structural** (Bridge, Composite, Flyweight) and **6 behavioral** (Template Method, Iterator, Mediator, Memento, Visitor, Interpreter) patterns, each with intent, when-to / when-NOT-to, worked C# **and** Java examples, the frequently-asked interview questions in the course's 5-part format, and the "don't confuse it with X" distinctions interviewers actually probe. §5 has the full 23-pattern quick-reference and an honest "what actually gets asked" ranking.

---

## 1. Fundamentals

### The 23-pattern map, and where each is covered

| Category | Patterns | Where covered |
|---|---|---|
| **Creational (5)** | Singleton, Factory Method, Abstract Factory, Builder, Prototype | Module 31 §2.1–2.4 |
| **Structural (7)** | Adapter, Decorator, Facade, Proxy | Module 31 §2.5–2.8 |
| | **Bridge, Composite, Flyweight** | **this module §2** |
| **Behavioral (11)** | Strategy, Observer, Command, Chain of Responsibility, State | Module 32 §2.1–2.5 |
| | Template Method | Module 09 §Advanced Q2 (canonical), + **this module §3.1** |
| | **Iterator, Mediator, Memento, Visitor, Interpreter** | **this module §3.2–3.6** |

### What actually gets asked (be honest about frequency)

Design-pattern rounds at the FinTech Principal bar are not "recite all 23." They probe **judgment** — which pattern fits a stated problem, how you'd distinguish two similar patterns, and *when not to use a pattern at all*. By real interview frequency:

- **Very common:** Singleton (+ thread-safety), Factory Method vs Abstract Factory, Builder, Strategy, Observer, Decorator, Adapter — and "distinguish Adapter / Decorator / Proxy / Facade."
- **Common:** Template Method (and "Strategy vs Template Method"), Composite, Chain of Responsibility, Command (+ undo), State.
- **Occasional:** Bridge (usually as "Bridge vs Adapter"), Mediator, Memento, Flyweight, Proxy variants.
- **Rare / academic:** Visitor (asked mainly by teams with a genuine AST/instrument-tree), Interpreter (almost never — and the right answer is usually "don't hand-roll a language").

The Principal-level differentiator is the same across all of them: **name the recurring design problem the pattern solves, cite when it's the wrong tool, and connect it to SOLID** — not draw the UML from memory.

### The one framing that ties the remaining nine together

Each of these nine is a specific answer to *"a naïve design would couple two things that should vary independently"*:

- **Bridge** — an abstraction and its implementation would explode into a `2^n` class hierarchy if inherited together.
- **Composite** — client code would have to special-case "a leaf" vs "a group of leaves."
- **Flyweight** — millions of objects would each carry a copy of the same immutable data.
- **Template Method** — every variant would re-implement (and could accidentally skip) the shared algorithm skeleton.
- **Iterator** — traversal logic would be duplicated across every consumer and would leak the collection's internal structure.
- **Mediator** — every pair of peer objects would hold a direct reference to every other.
- **Memento** — capturing an object's state for undo would force you to expose its internals.
- **Visitor** — adding a new *operation* over a type hierarchy would mean editing every type in it.
- **Interpreter** — evaluating a small domain expression would be a growing `if/switch` with no structure.

---

## 2. The Remaining Structural Patterns

### 2.1 Bridge — Decouple an Abstraction from Its Implementation So Both Vary Independently

**Intent.** Split one concept into two hierarchies — an **abstraction** (what the client uses) and an **implementation** (how it's actually done) — connected by a reference ("the bridge"), so you can extend each side without touching the other and without a combinatorial subclass explosion.

**When to use.**
- Two dimensions of variation that currently multiply: e.g. `{SummaryReport, DetailReport, RegulatoryReport}` × `{PdfRenderer, HtmlRenderer, CsvRenderer}` — inheriting both together needs 9 classes and grows as `n×m`; Bridge needs `n+m`.
- You want to swap the implementation at runtime (a report that renders to PDF now, CSV later).
- You want to hide the implementation entirely from clients (platform-specific code behind a stable abstraction).

**When NOT to use.**
- There's only ever one implementation, or the two dimensions genuinely don't vary independently — then it's needless indirection.
- The "implementation" side is a *third-party incompatible* interface you're conforming to — that's **Adapter**, not Bridge (Bridge is a design you choose up front; Adapter is a retrofit).

**C#**
```csharp
// Implementation hierarchy — "how a message is delivered"
public interface IMessageChannel { Task SendAsync(string recipient, string subject, string body); }
public sealed class EmailChannel : IMessageChannel { public Task SendAsync(string r, string s, string b) => /* ... */ Task.CompletedTask; }
public sealed class SmsChannel   : IMessageChannel { public Task SendAsync(string r, string s, string b) => /* ... */ Task.CompletedTask; }

// Abstraction hierarchy — "what kind of notification", holds a reference to an implementation (the BRIDGE)
public abstract class Notification
{
    protected readonly IMessageChannel Channel;
    protected Notification(IMessageChannel channel) => Channel = channel;
    public abstract Task NotifyAsync(string recipient);
}
public sealed class MarginCallNotification : Notification
{
    private readonly decimal _shortfall;
    public MarginCallNotification(IMessageChannel channel, decimal shortfall) : base(channel) => _shortfall = shortfall;
    public override Task NotifyAsync(string recipient) =>
        Channel.SendAsync(recipient, "URGENT: Margin Call", $"Deposit {_shortfall:C} within 24h.");
}
public sealed class TradeConfirmNotification : Notification
{
    private readonly string _tradeId;
    public TradeConfirmNotification(IMessageChannel channel, string tradeId) : base(channel) => _tradeId = tradeId;
    public override Task NotifyAsync(string recipient) =>
        Channel.SendAsync(recipient, "Trade Confirmed", $"Trade {_tradeId} settled.");
}

// n notification types + m channels = n + m classes, not n * m.
// New channel (PushChannel) or new notification type: add ONE class, touch nothing else.
var n = new MarginCallNotification(new SmsChannel(), 12_500m);
await n.NotifyAsync("+441234567890");
```

**Java**
```java
public interface MessageChannel { void send(String recipient, String subject, String body); }
public final class EmailChannel implements MessageChannel { public void send(String r, String s, String b) { /* ... */ } }
public final class SmsChannel   implements MessageChannel { public void send(String r, String s, String b) { /* ... */ } }

public abstract class Notification {
    protected final MessageChannel channel;                 // the bridge
    protected Notification(MessageChannel channel) { this.channel = channel; }
    public abstract void notify(String recipient);
}
public final class MarginCallNotification extends Notification {
    private final BigDecimal shortfall;
    public MarginCallNotification(MessageChannel channel, BigDecimal shortfall) { super(channel); this.shortfall = shortfall; }
    public void notify(String recipient) {
        channel.send(recipient, "URGENT: Margin Call", "Deposit " + shortfall + " within 24h.");
    }
}
```

**Interview Q&A**

**Q1. What is the difference between Bridge and Adapter?**
*Ideal answer:* Adapter is a *retrofit*: an incompatible class already exists (a vendor SDK) and you wrap it to conform to an interface your code expects — the wrapping was not planned by either side. Bridge is a *deliberate up-front design*: you split one concept into an abstraction hierarchy and an implementation hierarchy so both can grow independently. Adapter changes an interface after the fact; Bridge prevents a `n×m` class explosion by design.
*Why correct:* It contrasts them on *when the decision is made* (retrofit vs planned) and *what problem each targets* (interface incompatibility vs combinatorial inheritance), which is the actual distinction, not the near-identical class diagrams.
*Common mistakes:* "They're the same, one's just fancier"; saying Bridge is for third-party code (that's Adapter).
*Follow-up:* "You designed a Bridge, then a vendor implementation needs adapting to your `IMessageChannel` — what pattern is that adapter?" (Adapter — the two compose: your Bridge's implementation slot is filled by an Adapter around the vendor).

**Q2. How does Bridge relate to the Dependency Inversion Principle?**
*Ideal answer:* Bridge *is* DIP applied to a two-dimensional design: the abstraction (`Notification`) depends on an abstraction (`IMessageChannel`), not a concrete channel; both hierarchies depend on the interface between them. The "bridge" reference is constructor-injected, which is also how DIP is satisfied mechanically.
*Why correct:* It identifies Bridge as a structural realization of DIP, not an unrelated pattern.
*Common mistakes:* Treating Bridge as purely about "avoiding subclasses" without connecting it to dependency direction.
*Follow-up:* "If you only ever have one channel implementation, is Bridge still DIP-compliant, and is it worth it?" (DIP-compliant yes; worth it usually no — one implementation means the abstraction split earns nothing).

**Don't confuse Bridge with:** **Adapter** (retrofit vs planned), **Strategy** (Strategy swaps an *algorithm*; Bridge swaps an entire *implementation hierarchy* and pairs it with an abstraction hierarchy — though a one-method Bridge and a Strategy can look identical), **State** (State's implementation object represents the object's own lifecycle stage and transitions between them).

---

### 2.2 Composite — Treat Individual Objects and Compositions of Objects Uniformly

**Intent.** Arrange objects into tree structures and let client code call the same operation on a leaf and on a whole subtree without knowing which it holds.

**When to use.**
- A genuine part-whole hierarchy: a trading-limit tree (firm limit contains desk limits contain trader limits), an org chart, a UI component tree, a file system, a bill-of-materials.
- Client code would otherwise be littered with `if (node is Group) { foreach child ... } else { ... }`.

**When NOT to use.**
- The structure isn't actually a tree, or leaves and groups have genuinely different operations that can't be unified honestly — forcing a common interface then makes half the methods throw `NotSupportedException` (an ISP/LSP violation, exactly the trap from Module 09 §Advanced-adjacent and Module 10 §Expert Q4).
- The tree is shallow and fixed (two levels) — an explicit `Firm` → `List<Desk>` is clearer than a recursive abstraction.

**C#**
```csharp
public interface ILimitNode
{
    string Name { get; }
    decimal Notional { get; }                 // sum of this node's own + all descendants'
    decimal Ceiling { get; }
    bool IsBreached();
}

public sealed class TraderLimit : ILimitNode          // leaf
{
    public string Name { get; }
    public decimal Notional { get; private set; }
    public decimal Ceiling { get; }
    public TraderLimit(string name, decimal ceiling) => (Name, Ceiling) = (name, ceiling);
    public void Book(decimal amount) => Notional += amount;
    public bool IsBreached() => Notional > Ceiling;
}

public sealed class DeskLimit : ILimitNode            // composite
{
    private readonly List<ILimitNode> _children = new();
    public string Name { get; }
    public decimal Ceiling { get; }
    public DeskLimit(string name, decimal ceiling) => (Name, Ceiling) = (name, ceiling);
    public void Add(ILimitNode child) => _children.Add(child);
    public decimal Notional => _children.Sum(c => c.Notional);          // recurse
    public bool IsBreached() => Notional > Ceiling || _children.Any(c => c.IsBreached());
}

// Client code is uniform — it never checks "leaf or group":
ILimitNode fx = new DeskLimit("FX Desk", 50_000_000m);
((DeskLimit)fx).Add(new TraderLimit("alice", 10_000_000m));
((DeskLimit)fx).Add(new TraderLimit("bob",   10_000_000m));
Console.WriteLine($"{fx.Name}: {fx.Notional:C} / {fx.Ceiling:C}  breached={fx.IsBreached()}");
```

**Java**
```java
public interface LimitNode {
    String name();
    BigDecimal notional();
    BigDecimal ceiling();
    boolean isBreached();
}

public final class TraderLimit implements LimitNode {          // leaf
    private final String name; private final BigDecimal ceiling;
    private BigDecimal notional = BigDecimal.ZERO;
    public TraderLimit(String name, BigDecimal ceiling) { this.name = name; this.ceiling = ceiling; }
    public void book(BigDecimal amount) { notional = notional.add(amount); }
    public String name() { return name; }
    public BigDecimal notional() { return notional; }
    public BigDecimal ceiling() { return ceiling; }
    public boolean isBreached() { return notional.compareTo(ceiling) > 0; }
}

public final class DeskLimit implements LimitNode {            // composite
    private final String name; private final BigDecimal ceiling;
    private final List<LimitNode> children = new ArrayList<>();
    public DeskLimit(String name, BigDecimal ceiling) { this.name = name; this.ceiling = ceiling; }
    public void add(LimitNode child) { children.add(child); }
    public String name() { return name; }
    public BigDecimal notional() {
        return children.stream().map(LimitNode::notional).reduce(BigDecimal.ZERO, BigDecimal::add);
    }
    public BigDecimal ceiling() { return ceiling; }
    public boolean isBreached() {
        return notional().compareTo(ceiling) > 0 || children.stream().anyMatch(LimitNode::isBreached);
    }
}
```

**Interview Q&A**

**Q1. Where should child-management methods (`Add`/`Remove`) live — on the common interface or only on the composite?**
*Ideal answer:* Two schools. **Transparent** Composite puts `Add`/`Remove` on the common interface so all nodes are treated identically — at the cost of leaves having to no-op or throw for operations they can't support (an LSP smell). **Safe** Composite puts child management only on the composite class — clients must down-cast or type-check to add children, but leaves never lie about their capabilities. For a money-adjacent tree (trading limits, ledgers) prefer **safe** — a leaf that silently swallows `Add` is a latent bug.
*Why correct:* It names both variants, the trade-off (uniformity vs honest interfaces), and picks the safe variant for high-consequence trees with a reason.
*Common mistakes:* Only knowing the transparent form; putting `Add` on the interface and having leaves throw `NotSupportedException` without acknowledging that's an LSP violation.
*Follow-up:* "You went safe and now the client has an `if (node is DeskLimit)` to add children — hasn't Composite failed its own goal?" (No — the goal is *uniform traversal/operations* on an existing tree; construction is a separate concern and can legitimately know concrete types, often behind a builder).

**Q2. How is Composite different from Decorator? They both wrap and delegate.**
*Ideal answer:* A Decorator wraps exactly **one** component and adds behavior to it. A Composite holds **many** children and its job is aggregation/fan-out of an operation over a tree. Decorator is a chain; Composite is a tree. Intent differs: add behavior vs represent a part-whole hierarchy.
*Why correct:* It contrasts arity (one vs many) and intent (behavior addition vs hierarchy representation).
*Common mistakes:* "Both are recursive wrappers, so they're basically the same."
*Follow-up:* "Can you combine them?" (Yes — a `LoggingLimitNode` Decorator wrapping a `DeskLimit` Composite; the decorator adds logging to every recursive `IsBreached()` call).

**Don't confuse Composite with:** **Decorator** (one child + adds behavior vs many children + aggregates), **Iterator** (Iterator traverses a structure; Composite *is* the structure and often provides an iterator over itself).

---

### 2.3 Flyweight — Share Immutable State Across Many Objects to Cut Memory

**Intent.** When you need a huge number of objects that differ only in a small amount of state, split each object's state into **intrinsic** (shared, immutable, context-free — stored once in a pool) and **extrinsic** (per-object, passed in by the caller), so millions of "objects" share a handful of flyweights.

**When to use.**
- Genuinely millions of near-identical objects and memory is the bottleneck: order-book price levels, market-data ticks, glyphs in a text editor, tiles in a map, particles.
- The shared part is immutable and identifiable by a key (an instrument's `symbol` → its tick size, lot size, currency, exchange, trading hours).

**When NOT to use.**
- Object count is modest (thousands) — the pool, the intrinsic/extrinsic split, and the loss of a clean object model aren't worth it. Measure first; Flyweight is a memory optimization, not a design default.
- The "shared" state is actually mutable or per-context — then it isn't intrinsic and Flyweight doesn't apply.
- You just want to reuse expensive-to-*construct* objects (connections, buffers) — that's an **object pool**, a different concern (pool objects are checked out and mutated; flyweights are immutable and concurrently shared).

**C#**
```csharp
// Intrinsic state — shared, immutable, one per symbol. This is the flyweight.
public sealed record InstrumentSpec(string Symbol, decimal TickSize, int LotSize, string Currency, string Exchange);

public static class InstrumentSpecFactory
{
    private static readonly ConcurrentDictionary<string, InstrumentSpec> _pool = new();
    public static InstrumentSpec Get(string symbol) =>
        _pool.GetOrAdd(symbol, s => s switch
        {
            "AAPL" => new InstrumentSpec(s, 0.01m, 100, "USD", "NASDAQ"),
            "VOD.L" => new InstrumentSpec(s, 0.0025m, 1, "GBP", "LSE"),
            _ => new InstrumentSpec(s, 0.01m, 1, "USD", "UNKNOWN"),
        });
}

// The "many" objects. Extrinsic state (price, qty, side) is per-order; the spec is SHARED.
public readonly struct Order
{
    public readonly InstrumentSpec Spec;   // reference to the shared flyweight — not a copy
    public readonly decimal Price;
    public readonly int Quantity;
    public readonly bool IsBuy;
    public Order(string symbol, decimal price, int qty, bool isBuy)
        => (Spec, Price, Quantity, IsBuy) = (InstrumentSpecFactory.Get(symbol), price, qty, isBuy);

    public bool IsValidPrice() => Price % Spec.TickSize == 0;   // uses shared intrinsic state
}

// 10 million AAPL orders share ONE InstrumentSpec instance, not 10 million copies of the same 5 fields.
```

**Java**
```java
public record InstrumentSpec(String symbol, BigDecimal tickSize, int lotSize, String currency, String exchange) {}

public final class InstrumentSpecFactory {
    private static final Map<String, InstrumentSpec> POOL = new ConcurrentHashMap<>();
    public static InstrumentSpec get(String symbol) {
        return POOL.computeIfAbsent(symbol, s -> switch (s) {
            case "AAPL"  -> new InstrumentSpec(s, new BigDecimal("0.01"),   100, "USD", "NASDAQ");
            case "VOD.L" -> new InstrumentSpec(s, new BigDecimal("0.0025"),   1, "GBP", "LSE");
            default      -> new InstrumentSpec(s, new BigDecimal("0.01"),     1, "USD", "UNKNOWN");
        });
    }
}

public record Order(InstrumentSpec spec, BigDecimal price, int quantity, boolean isBuy) {
    public Order(String symbol, BigDecimal price, int qty, boolean isBuy) {
        this(InstrumentSpecFactory.get(symbol), price, qty, isBuy);   // shares the pooled flyweight
    }
    public boolean isValidPrice() { return price.remainder(spec.tickSize()).signum() == 0; }
}
```

**Interview Q&A**

**Q1. What's the difference between Flyweight and an object pool?**
*Ideal answer:* A Flyweight is **immutable and shared concurrently** by many contexts at once — no checkout, no return, no synchronization needed, because nothing mutates it. An object pool holds **mutable** objects (DB connections, byte buffers) that a caller checks out, uses exclusively, mutates, and returns; the pool exists to avoid *construction/teardown* cost, not memory duplication. Flyweight solves "too many copies of the same immutable data"; pool solves "too expensive to keep creating and destroying."
*Why correct:* It contrasts immutability/concurrent-sharing vs checkout-mutate-return, and the different cost each targets (memory vs construction).
*Common mistakes:* Calling `String.intern()` or an enum cache "an object pool"; thinking Flyweight objects can be mutated.
*Follow-up:* "`string` interning and boxed-`int` caches in the runtime — Flyweight or pool?" (Flyweight — immutable, shared, keyed).

**Q2. Where does the extrinsic state live, and why does that matter?**
*Ideal answer:* Extrinsic state lives on the *many* objects (or is passed into flyweight methods per call) — it's the context-dependent part (an order's price and quantity; a glyph's position on the page). It matters because if you accidentally push per-context state *into* the flyweight, you've broken the pattern: the shared instance now can't be shared, and concurrent readers race. The discipline is: intrinsic = identifiable by a key, never changes; extrinsic = everything else, stays outside.
*Why correct:* It defines extrinsic state, its location, and the concrete failure (a shared instance carrying per-context state) if the split is wrong.
*Common mistakes:* Storing the current price on the `InstrumentSpec`; not being able to say what "context" means for the pattern.
*Follow-up:* "The flyweight needs to compute something using extrinsic state — how do you pass it?" (as a method parameter: `spec.RoundToTick(rawPrice)`, not a field).

**Don't confuse Flyweight with:** **Object pool** (immutable-shared vs checkout-mutate-return), **Singleton** (Flyweight has *many* keyed instances in a pool; Singleton has exactly one), **Prototype** (Prototype *copies*; Flyweight deliberately *doesn't copy* — it shares).

---

## 3. The Remaining Behavioral Patterns

### 3.1 Template Method — Fix the Algorithm Skeleton in a Base Class, Let Subclasses Fill Specific Steps

**Intent.** Define the invariant structure of an algorithm once, in a non-overridable method, calling out to `abstract`/`protected` hook methods for the parts that vary — so every variant runs the same steps in the same order and cannot skip a required one.

**When to use.**
- A multi-step process with a stable sequence and a few pluggable steps: a settlement pipeline (validate → enrich → route → execute → confirm) where only routing/execution differ per rail; a report generator (fetch → format → wrap); a test-fixture lifecycle (setup → run → teardown).
- The *un-bypassable ordering and the shared framing* (header/footer, transaction boundary, audit entry) is the thing being protected.

**When NOT to use.**
- The varying steps are numerous, independent, and would benefit from runtime swapping or independent testing — prefer **Strategy** (compose the steps) or a hybrid (template method owns the skeleton, injected strategies own the steps — Module 31 §11 Expert exercise).
- Inheritance is otherwise unwelcome (you'd be adding a base class purely for this) and the sequence isn't safety-critical.

**Canonical example:** Module 09 §Advanced Q2 (`ReportGenerator` with a `final`/private `generate()` and `abstract` `fetchData`/`formatData` hooks), in both C# and Java. Summary of the mechanism:

```csharp
public abstract class SettlementPipeline
{
    // The template method — NOT virtual. A subclass cannot reorder or skip steps.
    public SettlementResult Process(SettlementInstruction instr)
    {
        if (!Validate(instr)) return SettlementResult.Rejected("validation");
        Enrich(instr);                          // hook, may be a no-op default
        var route = SelectRoute(instr);         // abstract hook — rail-specific
        var result = Execute(instr, route);     // abstract hook — rail-specific
        WriteAuditEntry(instr, result);         // shared, non-overridable, always runs
        return result;
    }

    protected virtual bool Validate(SettlementInstruction i) => i.Amount > 0 && i.Beneficiary is not null;
    protected virtual void Enrich(SettlementInstruction i) { }          // opt-in hook
    protected abstract Route SelectRoute(SettlementInstruction i);      // required hook
    protected abstract SettlementResult Execute(SettlementInstruction i, Route r);
    private void WriteAuditEntry(SettlementInstruction i, SettlementResult r) { /* always, can't be skipped */ }
}
```
```java
public abstract class SettlementPipeline {
    public final SettlementResult process(SettlementInstruction instr) {   // 'final' == subclass cannot override the skeleton
        if (!validate(instr)) return SettlementResult.rejected("validation");
        enrich(instr);
        Route route = selectRoute(instr);
        SettlementResult result = execute(instr, route);
        writeAuditEntry(instr, result);         // shared, always runs
        return result;
    }
    protected boolean validate(SettlementInstruction i) { return i.amount().signum() > 0 && i.beneficiary() != null; }
    protected void enrich(SettlementInstruction i) { }
    protected abstract Route selectRoute(SettlementInstruction i);
    protected abstract SettlementResult execute(SettlementInstruction i, Route r);
    private void writeAuditEntry(SettlementInstruction i, SettlementResult r) { /* ... */ }
}
```

**Interview Q&A**

**Q1. Strategy vs Template Method — when do you pick which?**
*Ideal answer:* Both let a piece of behavior vary. Template Method varies steps via **inheritance** — subclasses override hooks, and the base class owns an un-bypassable skeleton; it's the right choice when the *sequence and shared framing* must be guaranteed and there's exactly one axis of "which variant." Strategy varies behavior via **composition** — an injected object, swappable at runtime, independently testable, and you can compose several; it's the right choice when the varying part is a self-contained algorithm, when you need runtime swapping, or when you'd rather not introduce a base class. If you have a fixed skeleton *and* several independently-varying steps, use both: a template method calling injected strategies.
*Why correct:* It contrasts the mechanism (inheritance/hooks vs composition/injection), what each guarantees (un-bypassable skeleton vs runtime flexibility + testability), and gives the hybrid.
*Common mistakes:* "They're interchangeable"; always choosing inheritance; not mentioning that Template Method's value is the *un-skippable* skeleton.
*Follow-up:* "Your template method has five hooks and three of them are getting overridden in every subclass — what's the signal?" (the is-a relationship is decaying; those three hooks want to be injected strategies — Module 09 Expert Q7's override-ratio heuristic).

**Q2. What's the "Hollywood Principle" and how does Template Method embody it?**
*Ideal answer:* "Don't call us, we'll call you" — the framework/base class controls the flow and *calls into* your code at defined points, rather than your code driving the framework. Template Method embodies it: the client doesn't orchestrate validate-then-enrich-then-execute; it calls `process()` once and the base class calls the subclass's hooks in the right order. It's inversion of control at the method level.
*Why correct:* It states the principle and maps it precisely onto Template Method's call direction.
*Common mistakes:* Confusing it with dependency injection (related idea — IoC — but IoC-of-object-creation vs IoC-of-control-flow).
*Follow-up:* "Where else in a typical stack do you see this?" (lifecycle callbacks — `OnInit`/`@PostConstruct`, test `@BeforeEach`, middleware `next()`, event handlers).

**Don't confuse Template Method with:** **Strategy** (inheritance/skeleton vs composition/runtime-swap), **Factory Method** (Factory Method is *one hook that returns an object*; it's often *used inside* a template method), **Builder** (Builder assembles an object step-by-step at the caller's direction; Template Method runs a fixed algorithm).

---

### 3.2 Iterator — Traverse a Collection Without Exposing Its Internal Representation

**Intent.** Provide a uniform way to step through the elements of an aggregate — one element at a time, in order — without the client knowing whether it's backed by an array, a tree, a linked list, or a paged database query, and without duplicating traversal logic across consumers.

**When to use.**
- You're building a custom collection or a data source and want `foreach`/`for-each` to just work over it.
- **Lazy / streaming traversal:** iterating a result set page-by-page from a database, a file line-by-line, an infinite sequence — without materializing the whole thing in memory. This is the version that actually comes up in system design.
- Multiple independent traversals of the same structure need to be in progress at once (each iterator carries its own cursor).

**When NOT to use.**
- The data is already a `List<T>`/`array` — the built-in iterator is done; don't hand-roll one.
- You need random access, not sequential — Iterator gives you `MoveNext`, not `this[i]`.

**C#** — a lazy iterator over a large ledger query that fetches one page at a time:
```csharp
public sealed class LedgerEntryPager : IEnumerable<LedgerEntry>
{
    private readonly ILedgerStore _store;
    private readonly string _accountId;
    private readonly int _pageSize;
    public LedgerEntryPager(ILedgerStore store, string accountId, int pageSize = 500)
        => (_store, _accountId, _pageSize) = (store, accountId, pageSize);

    public IEnumerator<LedgerEntry> GetEnumerator()
    {
        var offset = 0;
        while (true)
        {
            var page = _store.Fetch(_accountId, offset, _pageSize);   // one DB round-trip per page
            if (page.Count == 0) yield break;
            foreach (var entry in page) yield return entry;           // caller sees a flat stream
            if (page.Count < _pageSize) yield break;
            offset += _pageSize;
        }
    }
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

// Caller: a flat foreach; never sees paging, never loads all 4 million rows at once.
foreach (var e in new LedgerEntryPager(store, "ACCT-123"))
    if (e.Amount < 0) { /* ... */ }
```

**Java** — no `yield`, so implement `Iterator` (or expose a `Stream`):
```java
public final class LedgerEntryPager implements Iterable<LedgerEntry> {
    private final LedgerStore store; private final String accountId; private final int pageSize;
    public LedgerEntryPager(LedgerStore store, String accountId, int pageSize) {
        this.store = store; this.accountId = accountId; this.pageSize = pageSize;
    }
    @Override public Iterator<LedgerEntry> iterator() {
        return new Iterator<>() {
            private int offset = 0;
            private List<LedgerEntry> page = List.of();
            private int idx = 0;
            private boolean exhausted = false;

            private void fillIfNeeded() {
                if (idx < page.size() || exhausted) return;
                page = store.fetch(accountId, offset, pageSize);
                idx = 0; offset += pageSize;
                if (page.size() < pageSize) exhausted = true;
                if (page.isEmpty()) exhausted = true;
            }
            @Override public boolean hasNext() { fillIfNeeded(); return idx < page.size(); }
            @Override public LedgerEntry next() {
                if (!hasNext()) throw new NoSuchElementException();
                return page.get(idx++);
            }
        };
    }
    // Idiomatic modern Java: expose a Stream<LedgerEntry> instead, via StreamSupport.stream(spliterator(), false).
}
```

**Interview Q&A**

**Q1. Iterator is built into every language — why is it still worth discussing as a pattern?**
*Ideal answer:* Because the *pattern* is "decouple traversal from the collection's internal structure," and that's exactly what you're doing when you write a custom `IEnumerable`/`Iterable` over a paged query, a tree, or an infinite sequence. The language gives you the *consumption* syntax (`foreach`) for free; you still implement the pattern whenever your data source isn't already a list. Its most valuable form in system design is **lazy/streaming** iteration that never materializes the full dataset.
*Why correct:* It distinguishes the language feature (consumption) from the pattern (custom producers) and names the high-value case (lazy streaming).
*Common mistakes:* "It's obsolete, we have `for-each`"; not knowing `yield return` builds a state machine.
*Follow-up:* "What does the C# compiler generate for a `yield return` method?" (a hidden class implementing `IEnumerator<T>` as a state machine — `MoveNext` resumes where it left off).

**Q2. What's the risk with an iterator over a mutable collection?**
*Ideal answer:* Concurrent modification. If the underlying collection changes while an iteration is in progress, most implementations throw (`InvalidOperationException` / `ConcurrentModificationException`) because the cursor's assumptions are broken. The pattern's contract usually is: don't structurally modify the source during iteration; if you must, use a snapshotting or copy-on-write collection, or collect the changes and apply them after.
*Why correct:* It names the failure (fail-fast on concurrent modification) and the valid workarounds.
*Common mistakes:* Removing from a list inside a `for-each` over it and not knowing why it throws.
*Follow-up:* "How do you remove elements during iteration safely?" (via the iterator's own `remove()` in Java; `RemoveAll`/build-a-new-list in C#).

**Don't confuse Iterator with:** **Visitor** (Iterator *walks* a structure element-by-element; Visitor *applies an operation* to each node, often over a heterogeneous tree — you can use an Iterator to drive a Visitor), **Composite** (Composite is the tree; Iterator is one way to traverse it).

---

### 3.3 Mediator — Centralize Peer-to-Peer Communication in One Coordinator

**Intent.** Replace a web of direct references between many peer objects with a single mediator that they all talk to; peers notify the mediator of events, and the mediator decides what everyone else should do. Reduces `n²` couplings to `n`.

**When to use.**
- A set of components that must coordinate but shouldn't know about each other directly: form/screen widgets (an instrument picker enabling the quantity field, the price field validating against tick size, the submit button enabling only when all valid); air-traffic-control-style coordination; a chat room routing messages; workflow steps that trigger each other.
- The coordination logic is complex, changes often, and you want it in one testable place rather than smeared across every peer.

**When NOT to use.**
- Only two or three peers with simple, stable interactions — a direct reference is clearer.
- The mediator would just be a pass-through with no real coordination logic — that's ceremony.
- **Watch the god-object risk:** one mediator coordinating unrelated domains accumulates the SRP violation it was meant to prevent (Module 32 §Advanced Q5). Scope mediators by domain.

**C#** — an order-entry screen coordinator:
```csharp
public interface IOrderEntryMediator { void Notify(object sender, string ev); }

public sealed class OrderEntryScreen : IOrderEntryMediator
{
    public InstrumentField Instrument { get; }
    public QuantityField Quantity { get; }
    public PriceField Price { get; }
    public SubmitButton Submit { get; }

    public OrderEntryScreen()
    {
        Instrument = new InstrumentField(this);
        Quantity   = new QuantityField(this);
        Price      = new PriceField(this);
        Submit     = new SubmitButton(this);
    }

    // ALL cross-widget rules live here — the widgets don't reference each other.
    public void Notify(object sender, string ev)
    {
        if (sender == Instrument && ev == "changed")
        {
            Quantity.Enabled = Instrument.HasValue;
            Price.TickSize = Instrument.Selected?.TickSize ?? 0m;
        }
        if (ev == "changed")
            Submit.Enabled = Instrument.HasValue && Quantity.IsValid && Price.IsValid;
    }
}

public sealed class InstrumentField
{
    private readonly IOrderEntryMediator _m;
    public InstrumentField(IOrderEntryMediator m) => _m = m;
    public InstrumentSpec? Selected { get; private set; }
    public bool HasValue => Selected is not null;
    public void Select(InstrumentSpec spec) { Selected = spec; _m.Notify(this, "changed"); }
}
// QuantityField / PriceField / SubmitButton likewise call _m.Notify(this, "changed") and hold NO reference to siblings.
```

**Java**
```java
public interface OrderEntryMediator { void notify(Object sender, String event); }

public final class OrderEntryScreen implements OrderEntryMediator {
    final InstrumentField instrument = new InstrumentField(this);
    final QuantityField quantity     = new QuantityField(this);
    final PriceField price           = new PriceField(this);
    final SubmitButton submit        = new SubmitButton(this);

    @Override public void notify(Object sender, String event) {
        if (sender == instrument && event.equals("changed")) {
            quantity.setEnabled(instrument.hasValue());
            price.setTickSize(instrument.selected() != null ? instrument.selected().tickSize() : BigDecimal.ZERO);
        }
        if (event.equals("changed")) {
            submit.setEnabled(instrument.hasValue() && quantity.isValid() && price.isValid());
        }
    }
}
```

**Interview Q&A**

**Q1. Mediator vs Observer — both decouple senders from receivers.**
*Ideal answer:* Observer is **one-to-many broadcast**: a subject fires an event and any number of subscribers react independently; the subject has no idea what they do and there's no coordination between them. Mediator is **many-to-many coordination**: peers report events *to the mediator*, and the mediator contains the logic deciding what *other specific peers* should do in response. Observer distributes notifications; Mediator centralizes decisions. They're often combined (peers use events to notify the mediator).
*Why correct:* It contrasts broadcast-with-no-coordination vs centralized-coordination-logic, and notes they compose.
*Common mistakes:* "Same thing"; thinking the mediator is just an event bus (an event bus is closer to Observer — a bus with routing *logic* edges toward Mediator).
*Follow-up:* "Your mediator is now 800 lines coordinating orders, positions, and notifications — what went wrong and what's the fix?" (god object; split into domain-scoped mediators — Module 32 §Advanced Q5).

**Q2. Mediator vs Facade — both introduce a central object over many components.**
*Ideal answer:* Facade provides a **simplified outward-facing interface** to a subsystem for *clients*; the subsystem components are generally unaware of the facade and still call each other directly. Mediator is **inward-facing**: the peers know only the mediator and route all inter-peer communication through it; there is no "simpler client API" goal — the goal is eliminating peer-to-peer coupling.
*Why correct:* It contrasts direction (outward client simplification vs inward peer decoupling) and whether components know the central object.
*Common mistakes:* Using "central object" as the whole definition and conflating them.
*Follow-up:* "Can a class be both?" (yes — a `CheckoutFacade` that internally coordinates inventory/payment/shipping as a mediator and also exposes one `Checkout()` method as a facade).

**Don't confuse Mediator with:** **Observer** (broadcast vs coordinate), **Facade** (outward simplification vs inward decoupling), **Command** (Command encapsulates *a request as an object*; a mediator often *dispatches* commands but isn't one).

---

### 3.4 Memento — Capture and Restore an Object's State Without Violating Encapsulation

**Intent.** Let an object hand out an opaque token ("memento") containing a snapshot of its internal state, which a caretaker stores and can later give back to restore that state — without the caretaker (or anyone else) being able to read or tamper with the internals.

**When to use.**
- Undo/redo where the action isn't cleanly invertible by a reverse operation (a complex form edit, a canvas transform, a risk-scenario "what-if"): snapshot before, restore on undo.
- Checkpoint/rollback of a transaction-like in-memory operation.
- Save-game / session state.

**When NOT to use.**
- The state is huge and changes frequently — full snapshots per step blow memory; prefer **Command** with a captured *delta* (Module 32 §Advanced Q2) so undo replays an inverse, not a whole restore.
- The object is already immutable — "restoring" is just keeping a reference to the old value; no Memento needed.

**C#** — trade-ticket editor undo. The memento is a private nested type, so only `TradeTicket` can read it:
```csharp
public sealed class TradeTicket
{
    public string Symbol { get; private set; } = "";
    public int Quantity { get; private set; }
    public decimal LimitPrice { get; private set; }
    public string Notes { get; private set; } = "";

    public void Edit(string symbol, int qty, decimal limit, string notes)
        => (Symbol, Quantity, LimitPrice, Notes) = (symbol, qty, limit, notes);

    // Opaque to the outside world — no public members.
    public sealed class Memento
    {
        internal readonly string Symbol; internal readonly int Quantity;
        internal readonly decimal LimitPrice; internal readonly string Notes;
        internal Memento(string s, int q, decimal l, string n) => (Symbol, Quantity, LimitPrice, Notes) = (s, q, l, n);
    }
    public Memento Save() => new(Symbol, Quantity, LimitPrice, Notes);
    public void Restore(Memento m) => (Symbol, Quantity, LimitPrice, Notes) = (m.Symbol, m.Quantity, m.LimitPrice, m.Notes);
}

// Caretaker — stores mementos, can't read them.
public sealed class UndoHistory
{
    private readonly Stack<TradeTicket.Memento> _stack = new();
    public void Checkpoint(TradeTicket t) => _stack.Push(t.Save());
    public void Undo(TradeTicket t) { if (_stack.Count > 0) t.Restore(_stack.Pop()); }
}
```

**Java** — the memento as a `private static` class, restored via a package-private/inner accessor:
```java
public final class TradeTicket {
    private String symbol = ""; private int quantity;
    private BigDecimal limitPrice = BigDecimal.ZERO; private String notes = "";

    public void edit(String symbol, int qty, BigDecimal limit, String notes) {
        this.symbol = symbol; this.quantity = qty; this.limitPrice = limit; this.notes = notes;
    }

    public static final class Memento {                      // opaque token
        private final String symbol; private final int quantity;
        private final BigDecimal limitPrice; private final String notes;
        private Memento(String s, int q, BigDecimal l, String n) { symbol = s; quantity = q; limitPrice = l; notes = n; }
    }
    public Memento save() { return new Memento(symbol, quantity, limitPrice, notes); }
    public void restore(Memento m) { symbol = m.symbol; quantity = m.quantity; limitPrice = m.limitPrice; notes = m.notes; }
}

public final class UndoHistory {
    private final Deque<TradeTicket.Memento> stack = new ArrayDeque<>();
    public void checkpoint(TradeTicket t) { stack.push(t.save()); }
    public void undo(TradeTicket t) { if (!stack.isEmpty()) t.restore(stack.pop()); }
}
```

**Interview Q&A**

**Q1. Memento vs Command for undo — when do you pick which?**
*Ideal answer:* Command-based undo stores enough state on each command to compute an **inverse operation** (insert → delete the inserted range); it's efficient because each undo step is a small delta, and it composes (redo replays `Execute`). Memento-based undo stores a **full snapshot** of the object before a change and restores it wholesale; it's simpler and works even when there's no clean inverse, but it costs memory proportional to state size × history depth. Pick Command when actions have natural inverses and state is large; pick Memento when actions are messy to invert or state is small.
*Why correct:* It contrasts inverse-delta vs full-snapshot, their cost profiles, and the deciding criterion (invertibility + state size).
*Common mistakes:* Treating them as unrelated; not knowing Memento snapshots the whole state.
*Follow-up:* "Can you combine them?" (yes — a Command that captures a Memento in `Execute` and restores it in `Undo` — common when a single command's effect is hard to invert precisely).

**Q2. How does Memento preserve encapsulation if it contains the object's private state?**
*Ideal answer:* The memento is an *opaque* type to everyone except the originator. Classic implementations make it a private/nested class with no public accessors (C# `internal` members on a nested type; Java a `private`-fielded `static` inner class); the caretaker holds a `Memento` reference but literally cannot read a field off it. Only the originating class's `Restore`/`save` methods touch its contents. So the state leaves the object but stays sealed.
*Why correct:* It explains the "opaque token / narrow-vs-wide interface" mechanism that keeps the state private in transit.
*Common mistakes:* Exposing public getters on the memento (then it's just a DTO and any code can tamper); serializing to a public shape without noting the encapsulation trade-off.
*Follow-up:* "You need to persist the memento to disk for crash recovery — what's the tension?" (persistence needs a readable/serializable shape, which weakens the opacity; mitigate with a serialization boundary owned by the originator, or accept the trade-off explicitly).

**Don't confuse Memento with:** **Prototype** (Prototype *clones a live object* to make another usable object; Memento produces an *opaque state token* only the originator can consume), **Command** (inverse-delta vs full snapshot), **Snapshot/event-sourcing** (event sourcing rebuilds state by replaying events; a Memento is a point-in-time full copy).

---

### 3.5 Visitor — Add New Operations Over a Fixed Type Hierarchy Without Modifying the Types

**Intent.** Move an operation that would otherwise be a method on every type in a hierarchy into a separate "visitor" object with one method per concrete type; each type has a single `Accept(visitor)` that calls back the right visitor method (**double dispatch**). Now a new operation is a new visitor class — you touch none of the types.

**When to use.**
- A **stable** set of types and a **growing** set of operations over them: an instrument hierarchy (`Bond`, `Equity`, `Option`, `Swap`) with operations `PriceVisitor`, `RiskVisitor`, `RegulatoryReportVisitor`, `CashflowVisitor`… — each operation needs type-specific logic, and you keep adding operations.
- An AST / expression tree with passes: type-check, optimize, generate code, pretty-print.
- You want each operation's logic in one cohesive place rather than scattered as a method across ten classes.

**When NOT to use.**
- The **types** change more often than the operations — Visitor makes adding a *type* painful (you must add a method to every visitor). This is the "expression problem" trade-off: Visitor optimizes for adding operations, direct methods optimize for adding types.
- The language has good **pattern matching** — a `sealed` hierarchy + exhaustive `switch` expression (C# / Java 21) gives you type-specific operation logic in one place *and* compile-time exhaustiveness, without the `Accept`/double-dispatch boilerplate. For a closed hierarchy this is usually the better modern choice (Module 32 §2.5 / §Advanced Q4).
- The hierarchy is small and operations are few — a `switch` on a type discriminator is simpler.

**C#**
```csharp
public interface IInstrumentVisitor<T>
{
    T Visit(Bond b);
    T Visit(Equity e);
    T Visit(Option o);
}
public abstract class Instrument { public abstract T Accept<T>(IInstrumentVisitor<T> v); }
public sealed class Bond   : Instrument { public decimal Face; public decimal Coupon;
    public override T Accept<T>(IInstrumentVisitor<T> v) => v.Visit(this); }        // double dispatch
public sealed class Equity : Instrument { public decimal Price; public int Shares;
    public override T Accept<T>(IInstrumentVisitor<T> v) => v.Visit(this); }
public sealed class Option : Instrument { public decimal Spot; public decimal Strike; public double Vol;
    public override T Accept<T>(IInstrumentVisitor<T> v) => v.Visit(this); }

// A new OPERATION = a new class. No Instrument subtype is touched.
public sealed class PresentValueVisitor : IInstrumentVisitor<decimal>
{
    public decimal Visit(Bond b)   => b.Face + b.Coupon;           // simplified
    public decimal Visit(Equity e) => e.Price * e.Shares;
    public decimal Visit(Option o) => BlackScholes(o.Spot, o.Strike, o.Vol);
    private static decimal BlackScholes(decimal s, decimal k, double v) => /* ... */ 0m;
}

decimal Total(IEnumerable<Instrument> book) => book.Sum(i => i.Accept(new PresentValueVisitor()));
```

**Java**
```java
public interface InstrumentVisitor<T> {
    T visit(Bond b);
    T visit(Equity e);
    T visit(Option o);
}
public sealed interface Instrument permits Bond, Equity, Option {
    <T> T accept(InstrumentVisitor<T> v);
}
public record Bond(BigDecimal face, BigDecimal coupon) implements Instrument {
    public <T> T accept(InstrumentVisitor<T> v) { return v.visit(this); }
}
public record Equity(BigDecimal price, int shares) implements Instrument {
    public <T> T accept(InstrumentVisitor<T> v) { return v.visit(this); }
}
public record Option(BigDecimal spot, BigDecimal strike, double vol) implements Instrument {
    public <T> T accept(InstrumentVisitor<T> v) { return v.visit(this); }
}

public final class PresentValueVisitor implements InstrumentVisitor<BigDecimal> {
    public BigDecimal visit(Bond b)   { return b.face().add(b.coupon()); }
    public BigDecimal visit(Equity e) { return e.price().multiply(BigDecimal.valueOf(e.shares())); }
    public BigDecimal visit(Option o) { return blackScholes(o.spot(), o.strike(), o.vol()); }
    private static BigDecimal blackScholes(BigDecimal s, BigDecimal k, double v) { return BigDecimal.ZERO; }
}

// Modern alternative for a CLOSED hierarchy — no Visitor, no accept(), compile-time exhaustive:
static BigDecimal presentValue(Instrument i) {
    return switch (i) {
        case Bond b   -> b.face().add(b.coupon());
        case Equity e -> e.price().multiply(BigDecimal.valueOf(e.shares()));
        case Option o -> blackScholes(o.spot(), o.strike(), o.vol());
    };
}
```

**Interview Q&A**

**Q1. What is the "expression problem" and how does Visitor trade off against it?**
*Ideal answer:* The expression problem is: you want to add both new *types* and new *operations* to a system without modifying existing code and without recompiling. No single conventional approach gives you both cheaply. Putting operations as methods on each type makes adding a **type** easy (implement the interface) but adding an **operation** hard (edit every type). Visitor inverts that: adding an **operation** is easy (new visitor class) but adding a **type** is hard (new method on every visitor, and every visitor must be updated). You pick Visitor when operations churn and the type set is stable.
*Why correct:* It states the problem precisely and shows Visitor as one specific corner of the trade-off with the condition for choosing it.
*Common mistakes:* Praising Visitor as universally extensible; not knowing it makes adding a type painful.
*Follow-up:* "Your instrument hierarchy gains a new subtype every quarter — is Visitor still right?" (No — the type axis is the one churning; direct methods or pattern matching fit better).

**Q2. When is a `sealed` hierarchy + exhaustive `switch` better than Visitor?**
*Ideal answer:* Almost always, for a *closed* hierarchy in a language with pattern matching (C#, Java 21+). You get the same "operation logic per type, in one place," plus **compile-time exhaustiveness** (a missed case is a compile error), without the `Accept`/double-dispatch ceremony. Visitor still wins when the hierarchy is *open* (plugins add types, so you can't `seal` it and can't have an exhaustive switch), when you're targeting an older language without pattern matching, or when a visitor needs to accumulate state across a traversal in a way that's cleaner as an object.
*Why correct:* It names the modern default (sealed + switch) and the specific residual cases where Visitor still earns its boilerplate.
*Common mistakes:* Reaching for Visitor reflexively in modern C#/Java; not knowing exhaustiveness checking exists.
*Follow-up:* "The switch approach means every operation touches the sealed set — isn't that an OCP violation for adding a type?" (Yes, deliberately — you accept it to get exhaustiveness; Module 10 §Intermediate Q3's trade-off, restated for operations).

**Don't confuse Visitor with:** **Iterator** (Iterator walks; Visitor applies type-specific logic — you often iterate *and* visit), **Strategy** (Strategy is one algorithm swappable at a point; Visitor is a family of type-dispatched methods over a hierarchy), **pattern matching** (the language-feature alternative for closed hierarchies).

---

### 3.6 Interpreter — Represent a Small Grammar as a Class Hierarchy of Expression Nodes

**Intent.** For a simple, stable domain language, model each grammar rule as a class with an `Evaluate(context)` method; compose instances into a syntax tree; evaluating the root evaluates the whole expression.

**When to use — rarely, and only when all of these hold:**
- The grammar is **tiny and stable** (a handful of operators): an eligibility rule (`amount > 10000 AND region IN ('EU','UK')`), a simple search filter, a routing predicate, a feature-flag condition.
- You control the input and it's not adversarial (or you're validating it hard).
- You genuinely need a *tree* you can build, inspect, and combine programmatically — not just "run some logic."

**When NOT to use — almost always:**
- Anything non-trivial: use a real parser generator (ANTLR), an existing expression library (`System.Linq.Dynamic`, MVEL, SpEL, CEL), a scripting engine, or a proper rules engine. Hand-rolling grammar handling is a maintenance sink and a security risk.
- Business users need to *author* rules — you want a rules engine with a UI and governance, not a class hierarchy (Module 32 §Expert Q4's argument).
- Performance-critical evaluation of the same expression many times — compile it (to a `Expression<Func<>>` / bytecode), don't tree-walk.

**C#** — a minimal, safe eligibility-rule interpreter over a fixed set of operators:
```csharp
public interface IRule { bool Evaluate(IReadOnlyDictionary<string, object> ctx); }

public sealed class GreaterThan : IRule
{
    private readonly string _field; private readonly decimal _value;
    public GreaterThan(string field, decimal value) => (_field, _value) = (field, value);
    public bool Evaluate(IReadOnlyDictionary<string, object> ctx) =>
        ctx.TryGetValue(_field, out var v) && Convert.ToDecimal(v) > _value;
}
public sealed class InSet : IRule
{
    private readonly string _field; private readonly HashSet<string> _allowed;
    public InSet(string field, params string[] allowed) => (_field, _allowed) = (field, new(allowed));
    public bool Evaluate(IReadOnlyDictionary<string, object> ctx) =>
        ctx.TryGetValue(_field, out var v) && _allowed.Contains(v?.ToString() ?? "");
}
public sealed class And : IRule
{
    private readonly IRule[] _parts;
    public And(params IRule[] parts) => _parts = parts;
    public bool Evaluate(IReadOnlyDictionary<string, object> ctx) => _parts.All(p => p.Evaluate(ctx));
}

// Build the tree in code (or from a trusted config), then evaluate:
IRule rule = new And(new GreaterThan("amount", 10_000m), new InSet("region", "EU", "UK"));
bool eligible = rule.Evaluate(new Dictionary<string, object> { ["amount"] = 25_000m, ["region"] = "EU" });
```

**Java**
```java
public interface Rule { boolean evaluate(Map<String, Object> ctx); }

public record GreaterThan(String field, BigDecimal value) implements Rule {
    public boolean evaluate(Map<String, Object> ctx) {
        Object v = ctx.get(field);
        return v != null && new BigDecimal(v.toString()).compareTo(value) > 0;
    }
}
public record InSet(String field, Set<String> allowed) implements Rule {
    public boolean evaluate(Map<String, Object> ctx) {
        Object v = ctx.get(field);
        return v != null && allowed.contains(v.toString());
    }
}
public record And(List<Rule> parts) implements Rule {
    public boolean evaluate(Map<String, Object> ctx) { return parts.stream().allMatch(p -> p.evaluate(ctx)); }
}
```

**Interview Q&A**

**Q1. When would you actually build an Interpreter instead of using a library?**
*Ideal answer:* Almost never for a real grammar — reach for ANTLR, an expression library (SpEL/MVEL/CEL/Dynamic LINQ), or a rules engine. The narrow case for hand-rolling: a *tiny, fixed* set of operators (a few comparisons + AND/OR), input you control, and a genuine need to build/inspect/combine the rule *tree* in code. Even then, keep the node set closed, evaluate against a typed context, and never `eval` arbitrary strings. If the grammar grows even slightly, migrate to a real parser.
*Why correct:* It leads with "don't," gives the narrow condition where it's defensible, and adds the safety constraints.
*Common mistakes:* Presenting Interpreter as a normal tool; hand-rolling a parser for anything with precedence, parentheses, or user-authored input.
*Follow-up:* "The rules now need parentheses and operator precedence — what do you do?" (stop; adopt a parser generator or expression library — you're building a language and shouldn't).

**Q2. What's the security concern with an Interpreter over externally-supplied expressions?**
*Ideal answer:* Same class as insecure deserialization / injection: if the expression text (or a config an attacker can influence) can select which node types get instantiated, or if a node can invoke arbitrary methods/reflection, you've built an eval surface. Mitigations: a **closed, allow-listed node set** (never reflectively instantiate by name), a typed and sandboxed evaluation context (no filesystem/network/process access), input size and depth limits (a deeply nested expression can DoS the evaluator), and validating the tree before evaluating.
*Why correct:* It classifies the risk (eval surface) and lists the concrete controls.
*Common mistakes:* Not seeing the parallel to Module 31 §8's untrusted-instantiation risk; using a full scripting engine for what should be three operators.
*Follow-up:* "How does this connect to the webhook-handler factory in Module 31 §Expert Q2?" (identical principle — the set of constructible node types is fixed at compile time by literal entries, never derived from untrusted input).

**Don't confuse Interpreter with:** **Composite** (Interpreter's node tree *is* a Composite structurally; Interpreter adds the "evaluate a grammar" semantics), **Visitor** (a Visitor is often used to *walk* an interpreter's tree for a second pass — type-check, optimize, pretty-print), **a rules engine** (the production answer for anything business-authored).

---

## 4. Frequently-Asked Cross-Pattern Interview Questions

These are the questions that come up *regardless* of which patterns a module covered — the judgment probes.

**X1. Q: "Distinguish Adapter, Decorator, Proxy, Facade, and Bridge — they all wrap something."**
*Ideal answer:* Same rough structure (wrap + delegate), different **intent**: **Adapter** — make an *incompatible* existing interface conform to what a client expects (a retrofit). **Decorator** — add behavior to an object through the *same* interface, composably stackable (one wrapped component). **Proxy** — control *access* to an object (defer creation, authorize, remote), often transparently, same interface. **Facade** — provide a *simpler* interface over a complex but already-compatible subsystem (multiple components). **Bridge** — a *deliberate up-front* split of one concept into an abstraction hierarchy and an implementation hierarchy so both vary independently. Adapter fixes an interface; Decorator adds behavior; Proxy gates access; Facade simplifies; Bridge prevents a class explosion.
*Why correct:* It gives the one-line intent per pattern and the distinguishing verb (fix / add / gate / simplify / decouple).
*Common mistakes:* Comparing class diagrams instead of intent; conflating Decorator and Proxy (both same-interface wrappers — the difference is add-behavior vs control-access).
*Follow-up:* "You have a vendor SDK, and you want to add retry + auth + logging to it behind your own interface — which patterns, in what order?" (Adapter innermost to conform the SDK to your interface; then Decorators for retry/logging; a Proxy for auth if it should be transparent/gate access — a stack).

**X2. Q: "When should you NOT use a design pattern?"**
*Ideal answer:* When the problem the pattern solves isn't actually present. Concretely: a Strategy/Bridge/DIP abstraction with exactly one implementation and no test or substitution need (premature abstraction); a Visitor over a hierarchy whose *types* churn; an Interpreter for anything a library handles; a Singleton where a DI-managed lifetime is available; Composite for a two-level fixed structure; a pattern adopted "for consistency" or to look sophisticated. The tell is being unable to name the recurring design problem and the specific pain the pattern removes *here*. Patterns are a response to demonstrated need; applied reflexively they add indirection, more files, and cognitive load for no benefit.
*Why correct:* It gives concrete "don't" cases per pattern and the diagnostic (can you name the problem it solves *here*).
*Common mistakes:* Answering only "when it's over-engineering" with no examples; treating pattern usage as an unqualified good.
*Follow-up:* "A senior engineer's PR wraps every service in three strategy interfaces 'to follow SOLID' — how do you respond in review?" (ask which of the three will realistically get a second implementation or a test fake; keep the abstractions that will, inline the rest — Module 10 §Advanced Q4).

**X3. Q: "How do design patterns relate to SOLID?"**
*Ideal answer:* Most GoF patterns are concrete mechanisms that operationalize a SOLID principle. Strategy/Bridge/State — DIP and OCP (depend on an abstraction; extend by adding a class). Decorator/Chain of Responsibility — OCP (add behavior/handlers without modifying existing code). Visitor — a *deliberate* OCP trade (open to new operations, closed to new types). Template Method — OCP via the stable skeleton + overridable hooks. Composite — LSP (leaf and composite honor one contract). Factory patterns — DIP applied to construction. A pattern that forces `NotSupportedException` stubs is failing ISP/LSP and is the wrong pattern. The value of knowing this: you can justify a pattern by the principle it upholds, and spot a misapplied one by the principle it violates.
*Why correct:* It maps specific patterns to the principle each realizes, and notes the diagnostic use (violation = wrong pattern).
*Common mistakes:* "They're unrelated"; only citing "patterns are good practice like SOLID."
*Follow-up:* "Name a pattern that deliberately violates a SOLID principle and why that's acceptable." (Visitor / sealed-exhaustive-switch violates OCP for adding a type, accepted in exchange for compile-time exhaustiveness or operation-extensibility).

**X4. Q: "Given a problem statement, how do you pick the pattern?"** *(interviewer then gives a scenario)*
*Ideal answer:* Recognize by **problem shape**, as a diagnostic question — not by matching a UML diagram:
- Guarantee a consistent *family* of related objects? → Abstract Factory.
- Complex multi-step *construction* with validation? → Builder.
- Add *independently-composable behavior* around an interface? → Decorator.
- *Bridge an incompatible* interface? → Adapter.
- *Simplify* a complex subsystem's interface? → Facade.
- *Control or defer access* to an object? → Proxy.
- Two dimensions that would *multiply into a class explosion*? → Bridge.
- A *part-whole tree* treated uniformly? → Composite.
- *Millions of objects* sharing immutable data? → Flyweight.
- *Swappable algorithm*, runtime? → Strategy.
- *One-to-many notification*? → Observer.
- A *request as an object* (queue/log/undo)? → Command.
- *Growing ordered set* of conditional handlers? → Chain of Responsibility.
- Behavior varies by *lifecycle state* with transitions? → State.
- Fixed *algorithm skeleton*, varying steps, un-bypassable? → Template Method.
- *Custom traversal* / lazy streaming of a data source? → Iterator.
- *Many peers* that shouldn't reference each other? → Mediator.
- *Snapshot/restore* state for undo without exposing internals? → Memento.
- *Growing set of operations* over a *stable* type hierarchy? → Visitor.
- Evaluate a *tiny stable grammar*? → Interpreter (usually: use a library instead).
*Why correct:* It's a question-per-pattern recognition table — the transferable skill an interviewer is probing.
*Common mistakes:* Reciting definitions; forcing a pattern where "just write the straightforward code" is the answer.
*Follow-up:* "Two patterns seem to fit — how do you break the tie?" (which *intent* matches — e.g. Decorator vs Proxy: adding behavior the caller wants, or transparently controlling access).

---

## 5. The Complete 23-Pattern Quick Reference

| Pattern | Category | Intent (one line) | Use when | Avoid when |
|---|---|---|---|---|
| **Singleton** | Creational | Exactly one instance | Genuinely global immutable/coordinated state | DI can manage the lifetime (usually) |
| **Factory Method** | Creational | Defer which concrete type to a hook | One product, subtype/config decides | A `new` would do |
| **Abstract Factory** | Creational | A consistent *family* of products | Family must not be mixed (theme, cloud provider) | Products are independent |
| **Builder** | Creational | Multi-step, validated construction | Many optional params, cross-field rules | 2–3 fields → constructor/`record` |
| **Prototype** | Creational | Create by cloning an instance | Construction is expensive / type known only as "a copy" | State is immutable (share instead) |
| **Adapter** | Structural | Make an incompatible interface conform | Retrofitting a vendor SDK to your interface | You control both sides (design a Bridge) |
| **Bridge** | Structural | Decouple abstraction from implementation | Two dimensions would multiply into `n×m` classes | One implementation ever |
| **Composite** | Structural | Uniform ops on leaves and trees | A real part-whole hierarchy | Not a tree / leaves & groups genuinely differ |
| **Decorator** | Structural | Add behavior via the same interface | Composable cross-cutting concerns | Fixed behavior / N is huge (perf) |
| **Facade** | Structural | Simplify a complex subsystem's interface | Clients need one easy entry point | The subsystem is already simple |
| **Flyweight** | Structural | Share immutable state across many objects | Millions of near-identical objects, memory-bound | Modest counts / state is mutable |
| **Proxy** | Structural | Control access to an object | Lazy init, auth, remote, transparent | No access-control need |
| **Chain of Responsibility** | Behavioral | Pass a request along handlers | Growing, ordered, runtime-configurable handlers | Fixed case set (use exhaustive `switch`) |
| **Command** | Behavioral | A request as a first-class object | Queue / log / undo / retry an action | A direct call suffices |
| **Interpreter** | Behavioral | Grammar as an expression-node tree | Tiny, stable, trusted grammar | Anything real → use a library |
| **Iterator** | Behavioral | Traverse without exposing structure | Custom / lazy / streaming data source | It's already a `List`/array |
| **Mediator** | Behavioral | Centralize peer coordination | Many peers coordinating, complex rules | 2–3 peers / god-object risk |
| **Memento** | Behavioral | Snapshot/restore state, encapsulated | Undo where actions aren't cleanly invertible | State huge & frequent (use Command deltas) |
| **Observer** | Behavioral | One-to-many notification | Publisher shouldn't know subscribers | Coordination logic needed (use Mediator) |
| **State** | Behavioral | Behavior varies by lifecycle state | Explicit state machine with transitions | 2 states + a guard |
| **Strategy** | Behavioral | Swappable algorithm behind an interface | Runtime choice, independent testing | One stable implementation |
| **Template Method** | Behavioral | Fixed skeleton, overridable steps | Un-bypassable sequence + a few hooks | Steps churn / want runtime swap (Strategy) |
| **Visitor** | Behavioral | New operations over a stable type set | Operations churn, types are fixed | Types churn / language has pattern matching |

---

## 6. Revision

**Key takeaways**
- **Bridge ≠ Adapter:** Bridge is a planned split to avoid `n×m` classes; Adapter is a retrofit for an incompatible interface.
- **Composite:** prefer the *safe* variant (child-management only on the composite) for money-adjacent trees so leaves never lie about their capabilities.
- **Flyweight ≠ object pool:** immutable + concurrently shared (memory) vs checkout-mutate-return (construction cost).
- **Template Method vs Strategy:** inheritance + un-bypassable skeleton vs composition + runtime swap + independent testing; combine them for "fixed skeleton, varying injected steps."
- **Iterator:** the language gives you *consumption*; you still implement the *pattern* for custom or lazy/streaming sources.
- **Mediator ≠ Observer ≠ Facade:** centralize coordination logic vs broadcast notifications vs simplify an outward client API.
- **Memento vs Command for undo:** full snapshot vs inverse delta; snapshot when actions are messy to invert and state is small.
- **Visitor:** optimizes for adding *operations*, punishes adding *types* (the expression problem). For a *closed* hierarchy in a modern language, `sealed` + exhaustive `switch` beats it.
- **Interpreter:** the correct answer is almost always "use a parser generator, an expression library, or a rules engine." Hand-roll only a tiny, fixed, trusted grammar, with a closed allow-listed node set.

**Interview cheat sheet**
- Lead with **intent and the recurring problem**, not the UML.
- Always be ready with **"when NOT to use it"** and **the SOLID principle it realizes (or deliberately trades)**.
- Know the **"distinguish X from Y"** pairs cold: Bridge/Adapter, Composite/Decorator, Flyweight/pool, Template Method/Strategy, Mediator/Observer/Facade, Memento/Command, Visitor/pattern-matching, Proxy/Decorator.
- For "which pattern fits this problem," use the **problem-shape question table** (§4 X4), and don't be afraid to answer "no pattern — write the straightforward code."

**Things interviewers love:** naming the trade-off a pattern makes (Visitor's expression-problem stance; Composite's transparent-vs-safe); citing a concrete "don't use it here"; connecting the pattern to SOLID and to a real system you've built.
**Things interviewers hate:** reciting definitions and drawing UML with no judgment; applying patterns reflexively; not knowing the modern language alternative (pattern matching for Visitor, DI lifetimes for Singleton, `Stream`/`IEnumerable` for Iterator); claiming a pattern has no downsides.
**Common traps:** calling Bridge "just a fancy Adapter"; putting `Add`/`Remove` on a Composite's leaf interface and throwing; storing per-context state on a Flyweight; hand-rolling an Interpreter for a grammar with precedence; using Visitor on a hierarchy whose types keep changing.

---

**This completes the `11-Design-Patterns` domain's coverage of all 23 GoF patterns.** Modules 31–32 cover the 14 highest-frequency patterns in full 16-section depth; this module completes the set with the remaining 9, each with worked C#/Java examples, the frequently-asked interview Q&A, and the distinctions interviewers probe. The recurring Principal-level lesson across all three modules: a pattern is a named response to a recurring design problem — cite the problem, cite when it's the wrong tool, connect it to SOLID, and know the modern language feature that may have superseded it.
