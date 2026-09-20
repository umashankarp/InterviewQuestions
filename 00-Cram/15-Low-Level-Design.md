# Low-Level Design (OOD Interviews) — Cram Sheet

> Tier 2 · Source: `15-Low-Level-Design/` (2 modules, 1,224 lines) · Read: 8 min

---

## The 6-step script (use it every time)

1. **Clarify requirements** — narrower and more concrete than system design. Ask about **scale (single machine? concurrent users?), which operations matter, and what is explicitly out of scope.** Then state 4–6 functional requirements and 2–3 non-functional ones.
2. **Identify entities** — nouns from the requirements. Say what is an **Entity** (has identity) vs a **Value Object** (defined by its attributes).
3. **Find the extension points** — "what is most likely to change?" Each answer becomes a **Strategy** or a policy interface. *This is the step that is actually being graded.*
4. **Class diagram** — classes, key fields, key methods, relationships (composition vs inheritance).
5. **Scenario walkthrough** — trace one or two concrete operations end to end. **Both diagram-first and scenario-first are necessary**: the diagram shows structure, the walkthrough proves it works and exposes missing methods.
6. **Concurrency + extensibility** — what is shared mutable state, what is locked, and how would you add the feature they'll ask about next.

---

## Canonical problems and their one real insight

### Parking Lot
- Entities: `ParkingLot → Level → ParkingSpot`, `Vehicle`, `Ticket`, `Payment`.
- **Extension point: the spot-allocation policy is a Strategy** (`NearestFirst`, `ByVehicleSize`, `ByFloorBalance`) and **the pricing policy is a Strategy** (hourly, flat, day-rate, EV surcharge).
- **Composition over inheritance for vehicle types — the cautionary case:** `class Car : Vehicle`, `class Truck : Vehicle` looks fine until you need an electric truck or a disabled-badge motorbike; you get a combinatorial class explosion. **Model size/fuel/permits as attributes**, not subclasses.
- Concurrency: two cars must never be assigned the same spot → the allocation must be an atomic compare-and-set on spot state, not "find then assign."

### Elevator System
- **The insight is that it's a state machine**: `Idle → MovingUp → MovingDown → DoorsOpen`, with explicit allowed transitions.
- **Extension point: the scheduling algorithm is a Strategy** (FCFS, SCAN/elevator, look-ahead). Say this immediately — it's the whole point of the question.
- Separate `ElevatorCar` (one car's state) from `ElevatorController` (dispatch across cars) — conflating them is the common mistake.
- Requests are of two kinds: external (hall call, has a direction) and internal (car button, has a destination). Model them separately.

### Library Management
- **The central modelling insight: `Book` vs `BookCopy` vs `Loan`.** `Book` is the title/ISBN (bibliographic); `BookCopy` is the physical item with a barcode; `Loan` links a copy to a member over time. **Candidates who lend a `Book` instead of a `BookCopy` have missed the question.**
- **Borrowing rules as a composable policy, not hardcoded `if`s** — max loans, loan period, renewals, fines, member-type overrides. A list of `ILoanRule` objects evaluated in order; each returns allow/deny with a reason.
- Reservations/holds → a queue per `Book`, resolved when any copy returns.

### Chess
- **Piece behaviour — inheritance vs Strategy is a genuine, debatable trade-off.** Inheritance (`Knight : Piece` overriding `GetMoves`) is idiomatic and readable; a `IMovementStrategy` is more flexible for variants (fairy chess, custom pieces). **Say the trade-off rather than picking silently.**
- **`Move` as a Command object gives undo/redo natively** — capture the from/to, the captured piece and the previous castling/en-passant rights, and `Undo()` is trivial. This is the highest-value point in the question.
- **Where does move-legality validation belong? A genuine SRP question.** Piece-shape legality belongs to the piece; board-state legality (blocked path, own-king-in-check, castling rights, en passant) belongs to a `Board`/`RuleEngine`, because the piece doesn't know the board. Split it that way and say why.

### Others worth having ready
- **Vending machine** — State pattern (`Idle`/`HasMoney`/`Dispensing`), inventory, change-making.
- **ATM** — State + Chain of Responsibility for note dispensing; transaction atomicity.
- **Rate limiter** — Strategy over algorithms; see [[03-REST-APIs]] §8.
- **Logger** — Chain of Responsibility (levels) + Strategy (sinks) + async batching.
- **Splitwise / expense sharing** — the insight is the **balance simplification graph**, not the CRUD.
- **Notification service** — Strategy (channel) + Observer (subscribers) + template rendering; see [[14-System-Design-Problems]] §11.

---

## Patterns that appear in almost every LLD answer

| Pattern | Typical use |
|---|---|
| **Strategy** | any pluggable policy — pricing, scheduling, allocation, eviction |
| **State** | an object driving its own lifecycle transitions |
| **Factory** | creating the right concrete type from input |
| **Command** | an action as data — undo/redo, queue, audit |
| **Observer** | notifying interested parties |
| **Chain of Responsibility** | ordered handlers that may decline |
| **Singleton** | *(via DI, not `static Instance`)* |

---

## Concurrency — do not skip this

- Name the **shared mutable state** explicitly (the spot map, the inventory count, the board).
- Choose: a lock on the smallest scope · an atomic compare-and-swap · an immutable snapshot · or a single-threaded owner with a queue.
- **Prefer making the invariant atomic over locking a whole method** — "find a free spot then assign it" must be one atomic operation, or two cars get the same spot.
- Mention `ConcurrentDictionary`, `Interlocked`, `SemaphoreSlim`, and **optimistic concurrency with a version field** where appropriate.

---

## Top traps

1. Jumping to classes before clarifying requirements.
2. No extension point identified (the thing being graded).
3. A class explosion from modelling attributes as subclasses.
4. Lending a `Book` instead of a `BookCopy`.
5. Hardcoded business rules instead of composable policies.
6. Conflating the elevator car with the dispatcher.
7. Concurrency not mentioned at all.
8. A god class (`ParkingLotManager` doing everything).
9. Public setters everywhere — no encapsulated invariants.
10. No walkthrough, so missing methods go unnoticed.

---

## Interview Q&A — Lead / Principal

### Q1 · What the LLD round is grading *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"Design a vending machine / parking lot / elevator."* — 45 minutes, whiteboard or code.

**Answer (how to run it).** The classes aren't the point — **the extension points are.** A Senior candidate produces a correct class diagram; a Lead candidate identifies what is most likely to change and puts a seam there, then says why. So after clarifying requirements and naming entities, I'd explicitly say: "the two things I expect to change are the pricing policy and the allocation strategy, so both go behind interfaces — everything else can be concrete until it needs not to be."

Then two things candidates routinely skip and which I'd raise unprompted. **Concurrency**: name the shared mutable state and make the invariant atomic rather than locking a method — "find a free spot then assign it" must be one compare-and-set, or two cars get the same spot. And the **scenario walkthrough**: trace one full operation through the objects, because that's what exposes the method you forgot and proves the diagram actually works.

The anti-pattern to avoid out loud: modelling attributes as subclasses. `ElectricTruck : Truck : Vehicle` looks fine until you need a disabled-badge electric motorbike and you have a combinatorial class explosion. Size, fuel type and permits are **attributes**.

**Why it lands.** Names extension points as the graded artefact, raises concurrency unprompted, and pre-empts the inheritance explosion.
**✗ Weak answer.** A complete, correct class diagram with no seams, no concurrency and no walkthrough.
**↳ Follow-ups.** What would you change to support a second site? Where's the race condition?

---

### Q2 · Where does validation belong? *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"In your chess design, where does move-legality checking live?"* — or the equivalent SRP question in any LLD.

**Answer.** Split by what each object can actually know, which is the real single-responsibility test. A piece knows its own **movement shape** — a knight's L, a bishop's diagonal — so shape legality lives on the piece. Everything else depends on board state the piece has no access to: whether the path is blocked, whether the move leaves your own king in check, castling rights, en passant. Those belong to a `Board` or a rule engine.

That split isn't aesthetic, it's what makes the design extensible: adding a new piece type touches one class, and changing a rule about check touches one other. Put it all on the piece and every piece needs a reference to the board, which couples everything to everything and makes variants untestable.

The general form I'd state, because it transfers to every LLD: **responsibility follows information.** Put the decision where the data to make it already lives, and if a class needs to reach out for state to answer a question, that question probably belongs somewhere else.

**Why it lands.** Gives a reusable test ("responsibility follows information") rather than a chess-specific answer, and justifies it by what each change would touch.
**✗ Weak answer.** Putting all validation on the piece, or all of it in a single god `GameEngine`.
**↳ Follow-ups.** Where does undo live? How would you support a chess variant?

---

### Quick-fire (30 seconds each)

- **"Design a parking lot."** → I'd clarify first — multiple levels, vehicle types, is pricing in scope, single site or many. Then entities: ParkingLot contains Levels contains Spots; Vehicle, Ticket, Payment. The two things I'd design for change are allocation and pricing, so both are Strategies behind interfaces. Vehicle type is an *attribute set* — size, fuel, permits — not a subclass hierarchy, because otherwise an electric disabled-badge van needs its own class. And allocation has to be one atomic operation, not find-then-assign, or two cars get the same spot.
- **"How do you support undo in a chess engine?"** → Model `Move` as a Command object that captures everything needed to reverse itself — from and to squares, the captured piece, and the previous castling and en-passant rights, since those aren't recoverable from the board alone. Then undo is popping the move stack and applying the inverse, and redo is replaying. It also gives you move history, notation export and replay for free, which is why I'd reach for it even before anyone asks for undo.
- **"Where do you put validation?"** → Split by what each object can actually know. A piece knows its own movement shape, so shape legality lives there. Whether the path is blocked, whether the move leaves your own king in check, castling rights and en passant all depend on board state, so they belong to the board or a rule engine. That's a single-responsibility split, and it's also what makes variants tractable — you change one side without touching the other.

---

**Go deeper:** `15-Low-Level-Design/01`–`02` · **Related:** [[11-Design-Patterns]], [[09-OOP-SOLID]], [[12-DataStructures-Algorithms]]
