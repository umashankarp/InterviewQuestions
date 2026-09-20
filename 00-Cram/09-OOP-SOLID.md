# OOP & SOLID — Cram Sheet

> Tier 2 · Source: `09-OOP/` + `10-SOLID/` (2 modules, 1,254 lines) · Read: 8 min
> At 14+ years you are not asked *what* these are — you are asked **when you'd violate them**. Have that answer.

---

## 1. The four pillars

- **Encapsulation** — hide state, expose behaviour. The real test: can an object be put into an invalid state from outside? Public setters on a domain entity fail it.
- **Abstraction** — expose *what*, hide *how*. An abstraction that leaks its implementation (a repository returning `IQueryable`) isn't one.
- **Inheritance** — an "is-a" relationship **plus behavioural substitutability**. Rare in good modern code.
- **Polymorphism** — same interface, different behaviour. **Runtime** (virtual/override, interface dispatch) vs **compile-time** (overloading, generics).

**Composition over inheritance** — the default. Inheritance couples you to the parent's implementation *and* its future changes ("the fragile base class problem"); composition lets you swap behaviour and test in isolation. Use inheritance only for genuine is-a with real substitutability; otherwise inject the behaviour.

**C# specifics worth stating:** `virtual`/`override`/`new` (hiding, not overriding — a classic trick question: the declared type decides which `new` method runs) · `abstract` vs `interface` (an interface is a contract with no state; an abstract class can carry shared state and a template method) · **default interface methods** (C# 8+) blur this · `sealed` prevents further derivation and lets the JIT devirtualise.

---

## 2. SOLID — with the violation case

| | Principle | The real meaning | When you'd violate it |
|---|---|---|---|
| **S** | **Single Responsibility** | one reason to change — grouped by **actor/stakeholder**, not "does one thing" | a tiny, stable class; splitting would produce two files that always change together |
| **O** | **Open/Closed** | extend without modifying — via polymorphism or composition | when you don't yet know the axis of variation. **Premature OCP is speculative generality** — wait for the second case |
| **L** | **Liskov Substitution** | a subtype must be usable **wherever the base is, without the caller knowing** | never deliberately — an LSP violation is a design error, not a trade-off |
| **I** | **Interface Segregation** | clients shouldn't depend on methods they don't use | a genuinely cohesive interface; over-segregating gives you 12 one-method interfaces and no meaning |
| **D** | **Dependency Inversion** | both depend on an abstraction; **the abstraction is owned by the high-level module** | stable framework types (`string`, `DateTime`, `List<T>`) — don't abstract what will never change |

**The most-asked details:**
- **SRP is about the *actor*.** A class serving both the accounting department and the reporting team has two reasons to change, even if it "does one thing."
- **LSP's classic example: `Square : Rectangle`.** Setting width on a `Square` also changes height, so a caller written against `Rectangle` breaks. **Signs of violation:** a subclass throwing `NotSupportedException`, strengthening preconditions, weakening postconditions, or callers doing `if (x is Derived)`.
- **DIP is not "use interfaces everywhere."** The inversion is about **who owns the abstraction** — `IOrderRepository` belongs in the domain, next to the code that uses it, not in the infrastructure project. That's the whole point, and it's what most candidates miss.

---

## 3. Related principles you should name

- **DRY** — don't repeat *knowledge*. **Coincidentally identical code is not duplication**; deduplicating it couples two things that change for different reasons. Over-applied DRY is a top cause of bad coupling.
- **KISS / YAGNI** — build for known requirements. The cost of a wrong abstraction exceeds the cost of a little duplication.
- **Law of Demeter** — talk to immediate collaborators; `a.B().C().D()` couples you to a whole graph.
- **Tell, Don't Ask** — `order.Approve()` rather than reading state, deciding outside, and writing it back. This is the cure for anaemic models.
- **Composition root** — the one place that wires everything.

---

## Top traps

1. Reciting definitions with no violation case.
2. DIP described as "use an interface."
3. SRP as "does one thing" instead of "one reason to change / one actor."
4. One interface per class, forever (ISP taken to absurdity).
5. Deep inheritance hierarchies.
6. `new` vs `override` confusion.
7. DRY applied to coincidental similarity.
8. Public setters on domain entities.
9. Speculative OCP before the second case exists.
10. Never having *removed* an abstraction.

---

## 30-second answers

- **"When would you violate SOLID?"** → Open/Closed most often. Building an extension point before you know the axis of variation is speculative generality, and a wrong abstraction is more expensive than the duplication it removed — so I wait for the second real case before I generalise. Interface Segregation too: taken literally you end up with a dozen one-method interfaces that obscure the design. The one I wouldn't knowingly violate is Liskov, because that's a correctness error rather than a trade-off.
- **"Inheritance or composition?"** → Composition by default. Inheritance couples you to the base class's implementation *and* to its future changes, which is the fragile base class problem, and it fixes the variation axis permanently at compile time. I use inheritance only for a genuine is-a with real substitutability — and in C# I'd reach for an interface plus injected behaviour, or a sealed record hierarchy with pattern matching, long before a deep class tree.
- **"What's Dependency Inversion really?"** → Not "use interfaces" — it's about *who owns the abstraction*. The high-level policy defines the interface it needs, in its own module, and the low-level detail implements it. So `IOrderRepository` lives in the domain next to the code that consumes it, and the infrastructure project references the domain to implement it. That's what inverts the dependency: at runtime control flows outward, at compile time the arrow points inward.

---

**Go deeper:** `09-OOP/01`, `10-SOLID/01` · **Related:** [[11-Design-Patterns]], [[32-Clean-Hexagonal-Architecture]], [[15-Low-Level-Design]]
