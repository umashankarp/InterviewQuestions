(function (r) {
registerTopic('15-low-level-design', {
related: ['11-design-patterns', '10-solid', '14-system-design'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['method'],
  q: r`How do you approach a low-level design (LLD) interview question?`,
  a: r`A structured approach:

1. **Clarify requirements and scope**: core use cases, actors, constraints (concurrency, persistence, scale of in-memory data), what is out of scope.
2. **Identify entities and responsibilities** from nouns and verbs; assign behaviour to the object that owns the data (encapsulation).
3. **Define relationships**: composition vs association, and interfaces at variation points (strategies for pricing, allocation, notification).
4. **Sketch a class diagram** with key fields and methods, then the **sequence** of a core use case.
5. **Handle state and concurrency**: state machines, thread safety (locks, atomic operations), idempotency.
6. **Write core code** for the trickiest part, not boilerplate.
7. **Discuss extensibility and trade-offs**: which changes are cheap (new vehicle type, new pricing), testing strategy, what you simplified.

Principal-level signals: modelling variation correctly (strategy vs inheritance), invariants enforced in the domain, concurrency handled explicitly, and pragmatic simplicity.`,
  code: r`~~~text
LLD checklist on the whiteboard
1. Requirements: use cases, actors, constraints, out of scope
2. Entities + responsibilities (who owns which data and rules)
3. Relationships + interfaces at variation points
4. Class diagram + sequence for the main flow
5. State machine + concurrency (locks / CAS / idempotency)
6. Code the hard part
7. Extensibility, testing, trade-offs
~~~`,
  pts: [r`Clarify use cases, actors, constraints and scope first.`, r`Assign behaviour to the object that owns the data.`, r`Put interfaces at real variation points.`, r`Draw class and sequence diagrams for the main flow.`, r`Handle state, concurrency and extensibility explicitly.`],
  ex: r`Candidates who code the concurrency-sensitive part (atomic allocation) rather than getters and setters stand out in LLD rounds.`,
  fu: [r`How much code should you write in an LLD interview?`],
  pit: [r`Starting with a giant inheritance hierarchy.`],
  tip: r`Ask "what is likely to change?" early. It tells you where interfaces belong.` },

{ id: 'q2', level: 'Basic', tags: ['class-relationships'],
  q: r`Explain association, aggregation, composition, dependency and inheritance in class design, with UML notation.`,
  a: r`- **Dependency**: a class uses another temporarily (parameter, local variable). Dashed arrow.
- **Association**: a structural link (an Order references a Customer). Solid line.
- **Aggregation**: whole-part where parts can exist independently (a Team has Players). Hollow diamond.
- **Composition**: whole-part where parts' lifecycle is owned by the whole (an Order owns OrderLines; deleting the order deletes lines). Filled diamond. In DDD terms: inside the aggregate.
- **Inheritance (generalisation)**: is-a relationship. Hollow triangle arrow.
- **Realisation**: a class implements an interface. Dashed line with hollow triangle.

Design guidance: prefer composition and interfaces over inheritance; reference other aggregates by id rather than object associations; keep dependencies pointing towards abstractions.`,
  code: r`~~~csharp
public sealed class Order                                   // composition: Order owns its lines
{
    private readonly List<OrderLine> _lines = new();
    public CustomerId CustomerId { get; }                   // association by id (another aggregate)
    public Order(CustomerId customer) => CustomerId = customer;
    public void Price(IPricingPolicy pricing) { }           // dependency: used, not stored
}
public sealed class OrderLine(string sku, int qty);
public interface IPricingPolicy { decimal Price(Order o); } // realisation by concrete policies
~~~`,
  dia: r`classDiagram
  class Order {
    +CustomerId CustomerId
    +Price(IPricingPolicy)
  }
  class OrderLine {
    +Sku
    +Qty
  }
  class IPricingPolicy {
    <<interface>>
    +Price(Order) decimal
  }
  class StandardPricing
  Order "1" *-- "many" OrderLine : composition
  Order ..> IPricingPolicy : dependency
  IPricingPolicy <|.. StandardPricing : realisation`,
  pts: [r`Dependency is temporary use; association is a structural link.`, r`Aggregation: parts live independently; composition: the whole owns part lifecycles.`, r`Inheritance is is-a; realisation implements an interface.`, r`Prefer composition and interfaces.`, r`Reference other aggregates by id.`],
  ex: r`Modelling OrderLine as composed by Order (not shared) made deletion and invariants simple in an ordering service.`,
  fu: [r`How does composition map to EF Core owned types?`],
  pit: [r`Object references between aggregates that load huge graphs.`] },

{ id: 'q3', level: 'Basic', tags: ['parking-lot'],
  q: r`Design a parking lot system (multiple levels, spot sizes, tickets, payment).`,
  a: r`### Requirements
Multiple levels; spot sizes (small, medium, large); vehicles need a minimum size; entry issues a ticket; exit computes a fee by pricing policy; show availability; concurrent entries at multiple gates.

### Classes
- {{ParkingLot}} (facade): {{Enter(vehicle)}}, {{Exit(ticket)}}.
- {{Level}} with {{Spot}}s; {{Spot}} has size and an atomic occupied flag.
- {{Vehicle}} as data with a required size (no subclass per vehicle type unless behaviour differs).
- {{ISpotAllocator}} strategy (nearest, by level, EV-first).
- {{Ticket}} (id, spot, entry time); {{IPricingPolicy}} (hourly, flat, weekend).
- {{IPaymentProcessor}} for exit.

### Concurrency
Two gates must not assign the same spot: claim spots with compare-and-swap (or a lock per level). Availability counts maintained atomically.`,
  code: r`~~~csharp
public enum SpotSize { Small = 1, Medium = 2, Large = 3 }
public sealed record Vehicle(string Plate, SpotSize Needs);
public sealed class Spot(string id, SpotSize size)
{
    private int _taken;
    public string Id { get; } = id; public SpotSize Size { get; } = size;
    public bool TryTake() => Interlocked.CompareExchange(ref _taken, 1, 0) == 0;
    public void Free() => Volatile.Write(ref _taken, 0);
    public bool IsFree => Volatile.Read(ref _taken) == 0;
}
public sealed record Ticket(Guid Id, string Plate, Spot Spot, DateTimeOffset EnteredAt);
public sealed class ParkingLot(IReadOnlyList<Spot> spots, ISpotAllocator allocator, IPricingPolicy pricing, TimeProvider clock)
{
    private readonly ConcurrentDictionary<Guid, Ticket> _active = new();
    public Ticket? Enter(Vehicle v)
    {
        var spot = allocator.Allocate(v, spots);                          // allocator calls TryTake atomically
        if (spot is null) return null;
        var t = new Ticket(Guid.NewGuid(), v.Plate, spot, clock.GetUtcNow());
        _active[t.Id] = t; return t;
    }
    public decimal Exit(Guid ticketId)
    {
        if (!_active.TryRemove(ticketId, out var t)) throw new InvalidOperationException("Unknown or used ticket");
        t.Spot.Free();
        return pricing.Fee(t.EnteredAt, clock.GetUtcNow(), t.Spot.Size);
    }
}
public interface ISpotAllocator { Spot? Allocate(Vehicle v, IReadOnlyList<Spot> spots); }
public interface IPricingPolicy { decimal Fee(DateTimeOffset entered, DateTimeOffset exited, SpotSize size); }
~~~`,
  dia: r`classDiagram
  class ParkingLot {
    +Enter(Vehicle) Ticket
    +Exit(ticketId) decimal
  }
  class Spot {
    +Id
    +Size
    +TryTake() bool
    +Free()
  }
  class Ticket {
    +Id
    +Plate
    +EnteredAt
  }
  class ISpotAllocator {
    <<interface>>
    +Allocate(Vehicle, Spots) Spot
  }
  class IPricingPolicy {
    <<interface>>
    +Fee(entered, exited, size) decimal
  }
  ParkingLot "1" *-- "many" Spot
  ParkingLot --> ISpotAllocator
  ParkingLot --> IPricingPolicy
  Ticket --> Spot`,
  pts: [r`Vehicle size as data, not a subclass per vehicle type.`, r`Strategies for spot allocation and pricing.`, r`Atomic spot claims prevent double assignment across gates.`, r`Tickets track active sessions; exit frees spots and prices.`, r`A facade (ParkingLot) exposes Enter and Exit.`],
  ex: r`A real car-park system used per-level locking and atomic counters to show live availability on entrance displays.`,
  fu: [r`How would you add reservations or EV charging spots?`],
  pit: [r`Car, Truck, Motorcycle subclasses with no behavioural difference.`] },

{ id: 'q4', level: 'Basic', tags: ['vending-machine', 'state'],
  q: r`Design a vending machine using the State pattern.`,
  a: r`### Requirements
Select product, insert money, dispense, return change, cancel, handle out-of-stock and insufficient funds, admin restock.

### Design
- {{VendingMachine}} holds inventory, current balance and a current {{IState}}.
- States: {{Idle}}, {{HasMoney}}, {{Dispensing}}, {{OutOfService}}. Each state implements the operations it allows and transitions.
- {{Inventory}} with slots (product, price, quantity).
- {{ChangeCalculator}} strategy (greedy works for canonical coin sets; DP for general).

Why State: operations behave differently per state (inserting money while dispensing is rejected), and the state classes keep each behaviour cohesive instead of switch statements in every method. For a small machine, an enum + transition table is also acceptable.`,
  code: r`~~~csharp
public interface IVendingState
{
    IVendingState InsertMoney(VendingMachine m, decimal amount);
    IVendingState Select(VendingMachine m, string slot);
    IVendingState Cancel(VendingMachine m);
}
public sealed class Idle : IVendingState
{
    public IVendingState InsertMoney(VendingMachine m, decimal a) { m.Balance += a; return new HasMoney(); }
    public IVendingState Select(VendingMachine m, string s) => throw new InvalidOperationException("Insert money first");
    public IVendingState Cancel(VendingMachine m) => this;
}
public sealed class HasMoney : IVendingState
{
    public IVendingState InsertMoney(VendingMachine m, decimal a) { m.Balance += a; return this; }
    public IVendingState Select(VendingMachine m, string slot)
    {
        var item = m.Inventory.Get(slot);
        if (item.Quantity == 0) throw new InvalidOperationException("Sold out");
        if (m.Balance < item.Price) throw new InvalidOperationException("Insufficient funds");
        m.Inventory.Take(slot); m.Dispense(item.Name);
        m.ReturnChange(m.Balance - item.Price); m.Balance = 0;
        return new Idle();
    }
    public IVendingState Cancel(VendingMachine m) { m.ReturnChange(m.Balance); m.Balance = 0; return new Idle(); }
}
public sealed class VendingMachine(Inventory inventory)
{
    private IVendingState _state = new Idle();
    public decimal Balance { get; set; }
    public Inventory Inventory { get; } = inventory;
    public void Insert(decimal a) => _state = _state.InsertMoney(this, a);
    public void Select(string slot) => _state = _state.Select(this, slot);
    public void Cancel() => _state = _state.Cancel(this);
    public void Dispense(string name) { /* hardware */ }
    public void ReturnChange(decimal amount) { /* coin hoppers */ }
}
~~~`,
  dia: r`stateDiagram-v2
  [*] --> Idle
  Idle --> HasMoney: insert money
  HasMoney --> HasMoney: insert more
  HasMoney --> Idle: select (dispense + change)
  HasMoney --> Idle: cancel (refund)
  Idle --> OutOfService: fault
  OutOfService --> Idle: repaired`,
  pts: [r`States implement the operations they allow and return the next state.`, r`Removes repeated switch statements across operations.`, r`Inventory and change calculation are separate collaborators.`, r`Greedy change works for canonical coins; DP otherwise.`, r`An enum + transition table is fine for small machines.`],
  ex: r`Kiosk software used state objects so adding a "card payment pending" state did not touch the cash states.`,
  fu: [r`How do you handle a power failure mid-dispense?`],
  pit: [r`A god class with switch statements in every method.`] },

{ id: 'q5', level: 'Basic', tags: ['logger', 'singleton'],
  q: r`Design a logging library: levels, multiple sinks, formatting, thread safety and performance.`,
  a: r`### Requirements
Log levels, structured messages, multiple sinks (console, file, remote), per-category filtering, minimal overhead on hot paths, non-blocking writes, thread safety.

### Design
- {{ILogger}} with {{Log(level, template, args)}} and {{IsEnabled(level)}} (cheap checks before formatting).
- {{ILogSink}} strategy per destination; a {{CompositeSink}} fans out.
- **Async pipeline**: log calls enqueue entries into a bounded channel; a background worker batches writes to sinks (decouples application threads from I/O). Policy when full: drop debug entries, or block.
- **Formatter** strategy (JSON, text).
- **Configuration**: minimum levels per category, reloadable.
- **Structured data**: message template plus properties for querying.

In real .NET code, use {{Microsoft.Extensions.Logging}} with providers (Serilog, OpenTelemetry) and source-generated {{LoggerMessage}}; this design explains how they work.`,
  code: r`~~~csharp
public sealed record LogEntry(DateTimeOffset At, LogLevel Level, string Category, string Template, object?[] Args);
public interface ILogSink { ValueTask WriteBatchAsync(IReadOnlyList<LogEntry> batch, CancellationToken ct); }
public sealed class AsyncLogger(string category, LogLevel min, ChannelWriter<LogEntry> writer)
{
    public bool IsEnabled(LogLevel l) => l >= min;
    public void Log(LogLevel l, string template, params object?[] args)
    {
        if (!IsEnabled(l)) return;                                        // no formatting cost when disabled
        if (!writer.TryWrite(new LogEntry(DateTimeOffset.UtcNow, l, category, template, args)) && l >= LogLevel.Warning)
            writer.WriteAsync(new LogEntry(DateTimeOffset.UtcNow, l, category, template, args)).AsTask().Wait();   // keep warnings, drop debug when full
    }
}
public sealed class LogPump(ChannelReader<LogEntry> reader, IReadOnlyList<ILogSink> sinks) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var batch = new List<LogEntry>(256);
        await foreach (var e in reader.ReadAllAsync(ct))
        {
            batch.Add(e);
            if (batch.Count == 256 || !reader.TryPeek(out _)) { foreach (var s in sinks) await s.WriteBatchAsync(batch, ct); batch.Clear(); }
        }
    }
}
~~~`,
  pts: [r`Cheap IsEnabled checks before formatting.`, r`Sinks are strategies; a composite fans out.`, r`Bounded channel and background batching decouple I/O.`, r`Explicit policy when the buffer is full.`, r`Structured templates with properties.`],
  ex: r`A trading service's synchronous file logging added 2 ms per request; an async channel-based pipeline removed it.`,
  fu: [r`How would you guarantee audit logs are never dropped?`],
  pit: [r`Synchronous network logging on the request path.`] },

{ id: 'q6', level: 'Basic', tags: ['library-management'],
  q: r`Design a library management system (books, copies, members, loans, reservations, fines).`,
  a: r`### Entities
- {{Book}} (ISBN, title, authors) vs {{BookCopy}} (barcode, status): distinguishing the work from physical copies is the key modelling insight.
- {{Member}} with membership type and limits.
- {{Loan}} (copy, member, issued, due, returned) and {{Reservation}} (book, member, queue position, expiry).
- {{FinePolicy}} strategy (per day, capped, by membership type).

### Use cases
Search catalogue; issue a copy (check member limits, unpaid fines, reservations); return (compute fines, notify next reservation holder); renew (only if no reservation queue); reserve.

### Rules and concurrency
Copy status transitions ({{Available -> OnLoan -> Available}}, {{Reserved}}, {{Lost}}) enforced in one place; issuing a copy must atomically change its status to prevent double loans; reservation queue FIFO per book.`,
  code: r`~~~csharp
public enum CopyStatus { Available, OnLoan, ReservedForPickup, Lost }
public sealed class BookCopy(string barcode, string isbn)
{
    public string Barcode { get; } = barcode; public string Isbn { get; } = isbn;
    public CopyStatus Status { get; private set; } = CopyStatus.Available;
    public int Version { get; private set; }                                   // optimistic concurrency
    public void Issue() { if (Status is not (CopyStatus.Available or CopyStatus.ReservedForPickup)) throw new InvalidOperationException("Copy not available"); Status = CopyStatus.OnLoan; Version++; }
    public void Return(bool hasReservation) { Status = hasReservation ? CopyStatus.ReservedForPickup : CopyStatus.Available; Version++; }
}
public interface IFinePolicy { decimal Fine(DateOnly due, DateOnly returned, MembershipType type); }
public sealed class CappedDailyFine : IFinePolicy
{
    public decimal Fine(DateOnly due, DateOnly returned, MembershipType t) =>
        Math.Min(Math.Max(0, returned.DayNumber - due.DayNumber) * (t == MembershipType.Student ? 0.10m : 0.25m), 10m);
}
~~~`,
  dia: r`classDiagram
  class Book {
    +Isbn
    +Title
  }
  class BookCopy {
    +Barcode
    +Status
    +Issue()
    +Return(hasReservation)
  }
  class Member {
    +Id
    +Type
    +MaxLoans
  }
  class Loan {
    +Copy
    +Member
    +DueDate
    +ReturnedAt
  }
  class Reservation {
    +Book
    +Member
    +Position
  }
  class IFinePolicy {
    <<interface>>
  }
  Book "1" o-- "many" BookCopy
  Member "1" --> "many" Loan
  Loan --> BookCopy
  Reservation --> Book
  Loan ..> IFinePolicy`,
  pts: [r`Separate Book (the work) from BookCopy (physical item).`, r`Loans and reservations are first-class entities.`, r`Copy status transitions enforced in one place.`, r`Fine calculation is a strategy.`, r`Atomic status changes prevent double loans.`],
  ex: r`Separating title from copy let a university library show "3 of 5 copies available" and queue reservations per title rather than per copy.`,
  fu: [r`How do you handle a reservation not collected within 3 days?`],
  pit: [r`One Book class with a quantity field and no copy identity.`] },

{ id: 'q7', level: 'Intermediate', tags: ['elevator'],
  q: r`Design an elevator system for a building with multiple elevators.`,
  a: r`### Requirements
N floors, M elevators; hall calls (up/down) and car calls (destination); dispatch to minimise wait; direction and door states; capacity; maintenance mode; emergency stop.

### Classes
- {{Elevator}}: current floor, direction, state ({{Idle}}, {{MovingUp}}, {{MovingDown}}, {{DoorsOpen}}, {{Maintenance}}), sorted sets of pending stops above and below.
- {{Dispatcher}} with an {{IDispatchStrategy}} (nearest suitable car, SCAN/LOOK, zoning, destination dispatch).
- {{Request}} (floor, direction or destination).
- {{ElevatorController}} runs a loop per elevator (step: move one floor or open doors).

### Scheduling
LOOK algorithm per car: continue in the current direction serving stops until none remain ahead, then reverse. Dispatcher scores each car for a hall call: same direction and approaching costs least; idle cars next; cars moving away cost most.

### Concurrency
Requests arrive concurrently; each elevator's state is owned by its own loop (actor-like), receiving requests through a channel to avoid shared-state locking.`,
  code: r`~~~csharp
public enum Direction { Up, Down, Idle }
public sealed class Elevator(int id, int floors)
{
    public int Id { get; } = id; public int Floor { get; private set; } public Direction Dir { get; private set; } = Direction.Idle;
    private readonly SortedSet<int> _up = new(), _down = new(Comparer<int>.Create((a, b) => b.CompareTo(a)));
    public void AddStop(int floor) { if (floor > Floor) _up.Add(floor); else if (floor < Floor) _down.Add(floor); }
    public void Step()                                                            // LOOK algorithm, one tick
    {
        if (Dir != Direction.Down && _up.Count > 0) { Dir = Direction.Up; Floor++; if (_up.Remove(Floor)) OpenDoors(); }
        else if (_down.Count > 0) { Dir = Direction.Down; Floor--; if (_down.Remove(Floor)) OpenDoors(); }
        else Dir = Direction.Idle;
    }
    public int Cost(int floor, Direction want) => Dir switch
    {
        Direction.Idle => Math.Abs(Floor - floor),
        Direction.Up when want == Direction.Up && floor >= Floor => floor - Floor,
        Direction.Down when want == Direction.Down && floor <= Floor => Floor - floor,
        _ => Math.Abs(Floor - floor) + 2 * floors                                 // moving away: expensive
    };
    private void OpenDoors() { }
}
public sealed class Dispatcher(IReadOnlyList<Elevator> cars)
{ public void HallCall(int floor, Direction d) => cars.MinBy(c => c.Cost(floor, d))!.AddStop(floor); }
~~~`,
  dia: r`classDiagram
  class Dispatcher {
    +HallCall(floor, dir)
  }
  class IDispatchStrategy {
    <<interface>>
    +Choose(cars, request) Elevator
  }
  class Elevator {
    +Floor
    +Direction
    +State
    +AddStop(floor)
    +Step()
  }
  class Request {
    +Floor
    +Direction
  }
  Dispatcher --> IDispatchStrategy
  Dispatcher "1" --> "many" Elevator
  Dispatcher ..> Request`,
  pts: [r`Per-elevator state and stop sets above and below.`, r`LOOK: serve stops in the current direction, then reverse.`, r`Dispatcher scores cars per hall call via a strategy.`, r`Each elevator processes requests serially (actor-like).`, r`Model maintenance and emergency states explicitly.`],
  ex: r`Destination dispatch (passengers enter destinations in the lobby) cut average journey time in a high-rise by grouping riders by floor.`,
  fu: [r`How would you test the dispatcher?`],
  pit: [r`Global locks around all elevator state.`] },

{ id: 'q8', level: 'Intermediate', tags: ['splitwise'],
  q: r`Design an expense-sharing app (like Splitwise): groups, splits, balances and settle-up.`,
  a: r`### Entities
{{User}}, {{Group}}, {{Expense}} (payer(s), amount, currency, split), {{Split}} strategy (equal, exact amounts, percentages, shares), {{Settlement}}.

### Balances
Store expenses as immutable records; compute **net balance per user per group** (paid minus owed). Keep an incrementally updated balance table for speed, rebuildable from expenses.

### Simplify debts
Reduce the number of transactions: compute each user's net balance, then repeatedly match the largest creditor with the largest debtor (greedy with heaps). This yields at most n-1 transfers (not always the theoretical minimum, which is NP-hard, but good in practice).

### Money correctness
Integer minor units, deterministic remainder allocation (largest remainder) so splits sum exactly; currency per expense with conversion at settlement time.`,
  code: r`~~~csharp
public interface ISplitStrategy { IReadOnlyDictionary<string, long> Split(long totalMinor, IReadOnlyList<string> users); }
public sealed class EqualSplit : ISplitStrategy
{
    public IReadOnlyDictionary<string, long> Split(long total, IReadOnlyList<string> users)
    {
        var each = total / users.Count; var rem = total % users.Count;
        return users.Select((u, i) => (u, each + (i < rem ? 1 : 0))).ToDictionary(x => x.u, x => x.Item2);   // sums exactly
    }
}
public static List<(string From, string To, long Amount)> SimplifyDebts(IReadOnlyDictionary<string, long> net)
{
    var creditors = new PriorityQueue<string, long>(Comparer<long>.Create((a, b) => b.CompareTo(a)));
    var debtors = new PriorityQueue<string, long>(Comparer<long>.Create((a, b) => b.CompareTo(a)));
    foreach (var (u, n) in net) { if (n > 0) creditors.Enqueue(u, n); else if (n < 0) debtors.Enqueue(u, -n); }
    var result = new List<(string, string, long)>();
    while (creditors.TryDequeue(out var c, out var cAmt) && debtors.TryDequeue(out var d, out var dAmt))
    {
        var pay = Math.Min(cAmt, dAmt); result.Add((d, c, pay));
        if (cAmt > pay) creditors.Enqueue(c, cAmt - pay);
        if (dAmt > pay) debtors.Enqueue(d, dAmt - pay);
    }
    return result;
}
~~~`,
  pts: [r`Expenses are immutable records; balances are derived.`, r`Split types are strategies (equal, exact, percentage, shares).`, r`Integer minor units with exact remainder allocation.`, r`Greedy heap matching simplifies debts to at most n-1 transfers.`, r`Handle multiple currencies explicitly.`],
  ex: r`A travel app's percentage splits lost a cent per expense until it switched to minor units and deterministic remainders.`,
  fu: [r`Why is minimising the number of transactions NP-hard?`],
  pit: [r`Storing balances only, with no expense history.`] },

{ id: 'q9', level: 'Intermediate', tags: ['atm'],
  q: r`Design an ATM system: card authentication, withdrawal, cash dispensing and failure handling.`,
  a: r`### Components
- {{ATM}} with hardware abstractions: {{ICardReader}}, {{IPinPad}}, {{ICashDispenser}}, {{IReceiptPrinter}} (ports, so tests use fakes).
- {{ATMSession}} state machine: {{Idle -> CardInserted -> Authenticated -> TransactionSelected -> Dispensing -> Completed}}, with timeout and cancel transitions.
- {{IBankGateway}} for PIN verification (via HSM, never PIN in clear), authorisation and reversal.
- {{CashCassettes}} with denominations; dispensing algorithm chooses notes (DP when cassettes are constrained).

### Critical failure handling
Withdrawal is a two-phase interaction: **authorise** (bank holds funds), **dispense**, then **confirm**. If dispensing fails or is partial, send a **reversal** for the undispensed amount. Every step is journaled locally (electronic journal) so reconciliation can resolve disputes; idempotent request ids for retries over unreliable links.`,
  code: r`~~~csharp
public async Task<WithdrawResult> WithdrawAsync(Session s, long amountMinor, CancellationToken ct)
{
    var notes = _cassettes.Plan(amountMinor) ?? throw new InvalidOperationException("Cannot dispense this amount");
    var auth = await _bank.AuthoriseAsync(new AuthRequest(s.CardToken, amountMinor, RequestId: s.NextRequestId()), ct);
    if (!auth.Approved) return WithdrawResult.Declined(auth.Reason);
    _journal.Record("AUTHORISED", auth.Reference, amountMinor);
    var dispensed = await _dispenser.DispenseAsync(notes, ct);                         // may be partial on jam
    _journal.Record("DISPENSED", auth.Reference, dispensed.AmountMinor);
    if (dispensed.AmountMinor < amountMinor)
        await _bank.ReverseAsync(auth.Reference, amountMinor - dispensed.AmountMinor, ct);   // give back what was not paid out
    else
        await _bank.ConfirmAsync(auth.Reference, ct);
    return WithdrawResult.Ok(dispensed.AmountMinor);
}
~~~`,
  dia: r`stateDiagram-v2
  [*] --> Idle
  Idle --> CardInserted: insert card
  CardInserted --> Authenticated: PIN ok (HSM)
  CardInserted --> Idle: 3 failures / cancel (retain card)
  Authenticated --> Dispensing: withdrawal authorised
  Dispensing --> Completed: full dispense, confirm
  Dispensing --> Reversing: jam / partial
  Reversing --> Completed: reversal sent
  Completed --> Idle: card returned`,
  pts: [r`Hardware behind interfaces for testability.`, r`Session state machine with timeouts and cancel paths.`, r`Authorise, dispense, then confirm or reverse.`, r`Local electronic journal for reconciliation and disputes.`, r`PINs verified via HSM; idempotent request ids.`],
  ex: r`An ATM network's partial-dispense reversals cut customer disputes for jammed cash by 90%.`,
  fu: [r`What if the network fails after dispensing but before confirmation?`],
  pit: [r`Debiting before dispensing with no reversal path.`] },

{ id: 'q10', level: 'Intermediate', tags: ['lru-cache', 'lld'],
  q: r`Design an in-memory cache class with TTL, size limits, eviction policy and thread safety.`,
  a: r`### Requirements
{{Get}}, {{Set(key, value, ttl)}}, {{Remove}}; max entries or bytes; eviction policy (LRU by default, pluggable); expiry; thread-safe; metrics (hits, misses, evictions).

### Design
- {{ICache<K,V>}} interface; {{IEvictionPolicy<K>}} strategy (LRU, LFU) notified on access/insert and asked for victims.
- Storage: dictionary of entries (value, expiresAt, size).
- Expiry: lazy on access plus a periodic sweeper (timer) to reclaim memory.
- Thread safety: a lock around dictionary + policy updates (simple, correct); for high contention, shard into N segments by key hash, each with its own lock and policy.
- Stampede protection: optional {{GetOrAdd}} with per-key single-flight.

Production note: {{MemoryCache}}/{{HybridCache}} provide this; the exercise tests decomposition and concurrency.`,
  code: r`~~~csharp
public interface IEvictionPolicy<TKey> { void Touched(TKey key); void Added(TKey key); void Removed(TKey key); TKey Victim(); }
public sealed class LruPolicy<TKey> : IEvictionPolicy<TKey> where TKey : notnull
{
    private readonly LinkedList<TKey> _order = new(); private readonly Dictionary<TKey, LinkedListNode<TKey>> _nodes = new();
    public void Touched(TKey k) { var n = _nodes[k]; _order.Remove(n); _order.AddFirst(n); }
    public void Added(TKey k) => _nodes[k] = _order.AddFirst(k);
    public void Removed(TKey k) { if (_nodes.Remove(k, out var n)) _order.Remove(n); }
    public TKey Victim() => _order.Last!.Value;
}
public sealed class BoundedCache<TKey, TValue>(int capacity, IEvictionPolicy<TKey> policy, TimeProvider clock) where TKey : notnull
{
    private readonly Dictionary<TKey, (TValue Value, DateTimeOffset Expires)> _map = new();
    private readonly Lock _gate = new();
    public bool TryGet(TKey key, out TValue value)
    {
        lock (_gate)
        {
            if (_map.TryGetValue(key, out var e) && e.Expires > clock.GetUtcNow()) { policy.Touched(key); value = e.Value; return true; }
            if (_map.Remove(key)) policy.Removed(key);                     // lazy expiry
            value = default!; return false;
        }
    }
    public void Set(TKey key, TValue value, TimeSpan ttl)
    {
        lock (_gate)
        {
            if (_map.ContainsKey(key)) policy.Removed(key);
            else if (_map.Count >= capacity) { var v = policy.Victim(); _map.Remove(v); policy.Removed(v); }
            _map[key] = (value, clock.GetUtcNow() + ttl); policy.Added(key);
        }
    }
}
~~~`,
  pts: [r`Interface plus pluggable eviction policy.`, r`Lazy expiry on access plus a periodic sweeper.`, r`One lock for simplicity; shard by key hash for contention.`, r`Inject TimeProvider for deterministic tests.`, r`Expose metrics; use MemoryCache/HybridCache in production.`],
  ex: r`A sharded in-process cache with 16 segments removed lock contention that had capped a pricing service at 30% CPU.`,
  fu: [r`How would you add size-based (bytes) limits?`],
  pit: [r`Unbounded caches that grow until the process is killed.`] },

{ id: 'q11', level: 'Intermediate', tags: ['rate-limiter', 'lld'],
  q: r`Design a rate limiter library (class level) supporting multiple algorithms and per-client rules.`,
  a: r`### Requirements
Per-client keys, multiple algorithms (token bucket, sliding window), rules per endpoint/plan, thread-safe, testable with a fake clock, pluggable storage (in-memory, Redis).

### Design
- {{IRateLimiter}}: {{TryAcquire(key, permits) -> Decision (allowed, retryAfter, remaining)}}.
- {{IRateLimitAlgorithm}} strategy operating on a {{IRateLimitStore}} (in-memory dictionary or Redis with Lua).
- {{RuleResolver}} maps request context (client id, endpoint, plan) to a rule (algorithm + parameters).
- {{TimeProvider}} injected for deterministic tests.
- Decorator or middleware integrates with HTTP (headers, 429).

Thread safety: per-key state updated atomically (lock per key stripe or CAS); Redis implementation uses Lua for atomic read-modify-write.`,
  code: r`~~~csharp
public sealed record Decision(bool Allowed, TimeSpan RetryAfter, long Remaining);
public interface IRateLimitAlgorithm { Decision Evaluate(ref BucketState state, Rule rule, DateTimeOffset now, int permits); }
public struct BucketState { public double Tokens; public DateTimeOffset Last; public bool Initialised; }
public sealed record Rule(double RatePerSecond, double Burst);

public sealed class TokenBucket : IRateLimitAlgorithm
{
    public Decision Evaluate(ref BucketState s, Rule r, DateTimeOffset now, int permits)
    {
        if (!s.Initialised) { s.Tokens = r.Burst; s.Last = now; s.Initialised = true; }
        s.Tokens = Math.Min(r.Burst, s.Tokens + (now - s.Last).TotalSeconds * r.RatePerSecond); s.Last = now;
        if (s.Tokens >= permits) { s.Tokens -= permits; return new(true, TimeSpan.Zero, (long)s.Tokens); }
        return new(false, TimeSpan.FromSeconds((permits - s.Tokens) / r.RatePerSecond), 0);
    }
}
public sealed class InMemoryRateLimiter(IRateLimitAlgorithm algo, Func<string, Rule> rules, TimeProvider clock)
{
    private readonly Dictionary<string, BucketState> _state = new(); private readonly Lock _gate = new();
    public Decision TryAcquire(string key, int permits = 1)
    {
        lock (_gate) { ref var s = ref CollectionsMarshal.GetValueRefOrAddDefault(_state, key, out _); return algo.Evaluate(ref s, rules(key), clock.GetUtcNow(), permits); }
    }
}
~~~`,
  pts: [r`One limiter interface with pluggable algorithms and stores.`, r`Rules resolved from request context.`, r`Atomic per-key updates: locks/CAS in memory, Lua in Redis.`, r`Inject TimeProvider for deterministic tests.`, r`Return remaining and retry-after for HTTP headers.`],
  ex: r`A shared rate-limit library with in-memory and Redis stores let teams start local and switch to global limits by configuration.`,
  fu: [r`How would you stripe locks to reduce contention?`],
  pit: [r`Using DateTime.UtcNow directly, making tests flaky.`] },

{ id: 'q12', level: 'Intermediate', tags: ['pub-sub', 'lld'],
  q: r`Design an in-process publish/subscribe event bus with typed events, async handlers and error isolation.`,
  a: r`### Requirements
Publish typed events; multiple subscribers per event type; async handlers; one failing handler must not stop others; optional ordering; subscribe/unsubscribe; DI-friendly.

### Design
- {{IEventBus}}: {{PublishAsync<TEvent>(event)}}.
- {{IEventHandler<in TEvent>}} resolved from DI (contravariance allows handlers for base event types).
- Dispatcher resolves handlers, invokes them (sequentially or in parallel by configuration), catches and logs exceptions per handler, records metrics.
- Optional {{Channel}}-based async dispatch for fire-and-forget with backpressure.
- For cross-process or durable delivery, use a broker + outbox; this in-process bus is for decoupling within a service (domain events).`,
  code: r`~~~csharp
public interface IEventHandler<in TEvent> { Task HandleAsync(TEvent e, CancellationToken ct); }
public sealed class EventBus(IServiceProvider sp, ILogger<EventBus> log)
{
    public async Task PublishAsync<TEvent>(TEvent e, CancellationToken ct) where TEvent : notnull
    {
        var handlers = sp.GetServices<IEventHandler<TEvent>>();
        foreach (var h in handlers)
        {
            try { await h.HandleAsync(e, ct); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            { log.LogError(ex, "Handler {Handler} failed for {Event}", h.GetType().Name, typeof(TEvent).Name); }   // isolate failures
        }
    }
}
builder.Services.AddScoped<IEventHandler<OrderPlaced>, AwardLoyalty>();
builder.Services.AddScoped<IEventHandler<OrderPlaced>, SendConfirmation>();
builder.Services.AddScoped<EventBus>();
~~~`,
  pts: [r`Typed handlers resolved from DI.`, r`Isolate failures per handler and log them.`, r`Choose sequential or parallel invocation deliberately.`, r`Channels add backpressure for async dispatch.`, r`Use a broker plus outbox for durable, cross-process delivery.`],
  ex: r`An in-process bus decoupled five side effects from order placement; a failing loyalty handler no longer blocked confirmation emails.`,
  fu: [r`How would you guarantee handlers run after the database commit?`],
  pit: [r`Using an in-process bus for events that must survive crashes.`] },

{ id: 'q13', level: 'Intermediate', tags: ['bank-account', 'concurrency'],
  q: r`Design a bank account class hierarchy (current, savings) with deposits, withdrawals, interest and thread safety.`,
  a: r`### Modelling choices
- Model **behavioural differences** with policies rather than deep inheritance: an {{Account}} has an {{IOverdraftPolicy}}, {{IInterestPolicy}} and {{IWithdrawalLimitPolicy}} chosen by product. A small {{AccountType}} enum or product configuration selects the policies.
- **Transactions are records** (append-only); the balance is derived and cached.
- **Money** as a value object ({{decimal}} + currency).

### Rules
Withdrawal checks overdraft and daily limits; savings may restrict withdrawals per month; interest accrues daily via a policy and posts monthly.

### Concurrency
In memory: lock per account; in a database: conditional updates with versions. Transfers between accounts lock in a consistent order (by id) to avoid deadlocks.`,
  code: r`~~~csharp
public interface IOverdraftPolicy { bool Allows(decimal newBalance); }
public sealed record NoOverdraft : IOverdraftPolicy { public bool Allows(decimal b) => b >= 0; }
public sealed record ArrangedOverdraft(decimal Limit) : IOverdraftPolicy { public bool Allows(decimal b) => b >= -Limit; }
public interface IInterestPolicy { decimal DailyAccrual(decimal balance); }

public sealed class Account(Guid id, string currency, IOverdraftPolicy overdraft, IInterestPolicy interest)
{
    private readonly Lock _gate = new();
    private readonly List<Txn> _txns = new();
    public Guid Id { get; } = id;
    public decimal Balance { get; private set; }
    public void Deposit(decimal amount, string reference) { lock (_gate) Post(amount, reference); }
    public void Withdraw(decimal amount, string reference)
    {
        lock (_gate)
        {
            if (!overdraft.Allows(Balance - amount)) throw new InsufficientFundsException(Id, amount);
            Post(-amount, reference);
        }
    }
    private void Post(decimal amount, string reference) { _txns.Add(new Txn(Guid.NewGuid(), amount, reference, DateTimeOffset.UtcNow)); Balance += amount; }
    public static void Transfer(Account from, Account to, decimal amount)
    {
        var (first, second) = from.Id.CompareTo(to.Id) < 0 ? (from, to) : (to, from);   // consistent lock order
        lock (first._gate) lock (second._gate) { from.Withdraw(amount, "transfer:" + to.Id); to.Deposit(amount, "transfer:" + from.Id); }
    }
}
public sealed record Txn(Guid Id, decimal Amount, string Reference, DateTimeOffset At);
~~~`,
  pts: [r`Use policies for product differences instead of deep inheritance.`, r`Transactions are append-only records; balance is derived.`, r`Money as a value object with currency.`, r`Lock per account; consistent lock order for transfers.`, r`In databases, use conditional updates and versions.`],
  ex: r`Adding a new account product became configuration (choose policies) instead of a new subclass.`,
  fu: [r`How would you handle interest posting at month-end for millions of accounts?`],
  pit: [r`SavingsAccount overriding Withdraw to throw (LSP violation).`] },

{ id: 'q14', level: 'Intermediate', tags: ['notification', 'lld'],
  q: r`Design the classes for a notification service with channels, templates, preferences and retries.`,
  a: r`### Classes
- {{NotificationRequest}} (id, user, template, data, priority).
- {{IPreferenceProvider}}: which channels a user allows for a template category; quiet hours.
- {{ITemplateRenderer}}: renders subject/body per channel and locale.
- {{INotificationChannel}} strategy per channel (Email, SMS, Push) returning a {{DeliveryResult}} (Delivered, Retryable, Permanent).
- {{RetryPolicy}} (exponential backoff, max attempts).
- {{NotificationDispatcher}}: orchestrates preference resolution, rendering, sending, retry scheduling and audit.
- {{IDeliveryLog}}: records attempts for idempotency and auditing.

### Extensibility
Adding WhatsApp = new channel class + registration; adding a template = data. Deduplicate by notification id before sending.`,
  code: r`~~~csharp
public abstract record DeliveryResult
{
    public sealed record Delivered(string ProviderId) : DeliveryResult;
    public sealed record Retryable(string Reason) : DeliveryResult;
    public sealed record Permanent(string Reason) : DeliveryResult;
}
public interface INotificationChannel { string Name { get; } Task<DeliveryResult> SendAsync(RenderedMessage m, CancellationToken ct); }
public sealed class NotificationDispatcher(IPreferenceProvider prefs, ITemplateRenderer renderer,
    IEnumerable<INotificationChannel> channels, IDeliveryLog log, IRetryScheduler retries)
{
    private readonly Dictionary<string, INotificationChannel> _byName = channels.ToDictionary(c => c.Name);
    public async Task DispatchAsync(NotificationRequest n, CancellationToken ct)
    {
        foreach (var channel in await prefs.ChannelsAsync(n.UserId, n.Template, ct))
        {
            if (await log.AlreadyDeliveredAsync(n.Id, channel, ct)) continue;               // idempotent
            var msg = await renderer.RenderAsync(n, channel, ct);
            var result = await _byName[channel].SendAsync(msg, ct);
            await log.RecordAsync(n.Id, channel, result, ct);
            if (result is DeliveryResult.Retryable) await retries.ScheduleAsync(n, channel, ct);
        }
    }
}
~~~`,
  pts: [r`Channels are strategies returning rich results.`, r`Preferences and templates are separate collaborators.`, r`A dispatcher orchestrates; it holds no channel specifics.`, r`Delivery log gives idempotency and audit.`, r`Retryable vs permanent failures drive retry scheduling.`],
  ex: r`Classifying provider errors as retryable vs permanent stopped endless retries of invalid phone numbers and cut SMS costs.`,
  fu: [r`How do you add per-user rate limits?`],
  pit: [r`A boolean success flag that hides retryability.`] },

{ id: 'q15', level: 'Intermediate', tags: ['task-scheduler', 'lld'],
  q: r`Design an in-process task scheduler class (delayed and recurring tasks, cancellation, concurrency limits).`,
  a: r`### API
{{Schedule(task, at)}}, {{ScheduleRecurring(task, interval or cron)}}, {{Cancel(id)}}; max concurrent executions; error handling per task.

### Design
- Priority queue (min-heap) of {{ScheduledTask}} by next run time.
- A single dispatcher loop waits until the earliest due time (or a signal when an earlier task is added), then hands due tasks to an execution pool bounded by a {{SemaphoreSlim}}.
- Recurring tasks compute the next run after completion (or fixed-rate from scheduled time) and are re-queued.
- Cancellation via ids (tombstones checked when dequeued) and {{CancellationToken}} passed to running tasks.
- {{TimeProvider}} injected for deterministic tests ({{FakeTimeProvider}} advances time).
- Graceful shutdown: stop accepting, wait for running tasks with a timeout.`,
  code: r`~~~csharp
public sealed record ScheduledTask(Guid Id, Func<CancellationToken, Task> Work, TimeSpan? Every);
public sealed class TaskScheduler(TimeProvider clock, int maxConcurrency) : IAsyncDisposable
{
    private readonly PriorityQueue<ScheduledTask, DateTimeOffset> _queue = new();
    private readonly HashSet<Guid> _cancelled = new();
    private readonly SemaphoreSlim _slots = new(maxConcurrency), _wake = new(0);
    private readonly Lock _gate = new();
    private readonly CancellationTokenSource _stop = new();
    public Guid Schedule(Func<CancellationToken, Task> work, DateTimeOffset at, TimeSpan? every = null)
    {
        var t = new ScheduledTask(Guid.NewGuid(), work, every);
        lock (_gate) _queue.Enqueue(t, at); _wake.Release(); return t.Id;
    }
    public void Cancel(Guid id) { lock (_gate) _cancelled.Add(id); }
    public async Task RunAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            ScheduledTask? due = null; TimeSpan wait = Timeout.InfiniteTimeSpan;
            lock (_gate)
                if (_queue.TryPeek(out var next, out var at))
                { var d = at - clock.GetUtcNow(); if (d <= TimeSpan.Zero) due = _queue.Dequeue(); else wait = d; }
            if (due is null) { try { await _wake.WaitAsync(wait, _stop.Token); } catch (OperationCanceledException) { } continue; }
            lock (_gate) if (_cancelled.Remove(due.Id)) continue;
            await _slots.WaitAsync(_stop.Token);
            _ = Task.Run(async () =>
            {
                try { await due.Work(_stop.Token); }
                finally { _slots.Release(); if (due.Every is { } e) lock (_gate) { _queue.Enqueue(due, clock.GetUtcNow() + e); _wake.Release(); } }
            });
        }
    }
    public ValueTask DisposeAsync() { _stop.Cancel(); return ValueTask.CompletedTask; }
}
~~~`,
  pts: [r`Min-heap of tasks ordered by next run time.`, r`One dispatcher loop that wakes early when an earlier task arrives.`, r`Bound concurrency with a semaphore.`, r`Cancellation via tombstones and tokens; graceful shutdown.`, r`Inject TimeProvider for deterministic tests.`],
  ex: r`A FakeTimeProvider-based test suite verified a month of recurring schedules in milliseconds.`,
  fu: [r`Fixed-rate vs fixed-delay scheduling?`],
  pit: [r`One Timer per task for thousands of tasks.`] },

{ id: 'q16', level: 'Intermediate', tags: ['shopping-cart', 'pricing'],
  q: r`Design a shopping cart with pricing rules, promotions and taxes that is easy to extend.`,
  a: r`### Model
- {{Cart}} (aggregate) with {{CartLine}}s (product id, quantity, unit price snapshot).
- {{PricingEngine}} applies a **pipeline** of {{IPricingRule}}s in a defined order: base price -> line promotions (buy 2 get 1) -> cart promotions (10% over 100) -> coupons -> shipping -> tax.
- Each rule receives a {{PricingContext}} (lines, customer segment, coupons, region) and returns adjustments with reasons (for display and audit).
- {{ITaxCalculator}} per jurisdiction (often external: Avalara/Vertex).
- Rules configured as data (promotion definitions with validity periods) where possible.

### Concerns
Determinism and order of application; stacking rules (exclusive vs combinable promotions); rounding per line vs total; price snapshot at checkout so totals do not change unexpectedly; explaining the price breakdown to customers.`,
  code: r`~~~csharp
public sealed record Adjustment(string RuleId, string Description, decimal Amount);
public interface IPricingRule { int Order { get; } IEnumerable<Adjustment> Apply(PricingContext ctx); }
public sealed class BuyXGetYFree(string sku, int x, int y) : IPricingRule
{
    public int Order => 10;
    public IEnumerable<Adjustment> Apply(PricingContext ctx)
    {
        var line = ctx.Lines.FirstOrDefault(l => l.Sku == sku);
        if (line is null) yield break;
        var free = line.Qty / (x + y) * y;
        if (free > 0) yield return new("B" + x + "G" + y + ":" + sku, "Buy " + x + " get " + y + " free", -free * line.UnitPrice);
    }
}
public sealed class PricingEngine(IEnumerable<IPricingRule> rules, ITaxCalculator tax)
{
    public PriceBreakdown Price(PricingContext ctx)
    {
        var adjustments = rules.OrderBy(r => r.Order).SelectMany(r => r.Apply(ctx)).ToList();
        var net = ctx.Lines.Sum(l => l.UnitPrice * l.Qty) + adjustments.Sum(a => a.Amount);
        var taxAmount = tax.Calculate(net, ctx.Region);
        return new PriceBreakdown(net, taxAmount, decimal.Round(net + taxAmount, 2, MidpointRounding.AwayFromZero), adjustments);
    }
}
~~~`,
  pts: [r`Cart aggregate with price snapshots per line.`, r`Pricing as an ordered pipeline of rules.`, r`Rules return explainable adjustments.`, r`Promotions as data with validity and stacking rules.`, r`Tax via a jurisdiction strategy or external service.`],
  ex: r`An e-commerce team added 30 promotion types as data and rules without changing the engine, and customers saw itemised discounts.`,
  fu: [r`How do you prevent promotion stacking abuse?`],
  pit: [r`Promotions hard-coded as if/else in checkout.`] },

{ id: 'q17', level: 'Intermediate', tags: ['file-system', 'composite'],
  q: r`Design an in-memory file system (directories, files, paths, size calculation).`,
  a: r`### Model (Composite pattern)
- {{FsNode}} abstract: name, parent, created/modified.
- {{FileNode}}: content (or size) and extension.
- {{DirectoryNode}}: children dictionary by name.
- Operations: {{mkdir -p}}, {{ls}}, {{createFile}}, {{read/write}}, {{move}}, {{delete}} (recursive), {{find}} by predicate, {{size}} (recursive sum, optionally cached with invalidation).

### Path resolution
Split path by separator, walk from root, handle {{.}} and {{..}}, validate names.

### Extensions
Permissions (owner, read/write), symbolic links (cycle detection), quotas, concurrency (read-write lock per directory, or a global lock for simplicity).`,
  code: r`~~~csharp
public abstract class FsNode(string name) { public string Name { get; set; } = name; public DirectoryNode? Parent { get; set; } public abstract long Size { get; } }
public sealed class FileNode(string name) : FsNode(name) { public byte[] Content { get; set; } = []; public override long Size => Content.LongLength; }
public sealed class DirectoryNode(string name) : FsNode(name)
{
    public Dictionary<string, FsNode> Children { get; } = new(StringComparer.Ordinal);
    public override long Size => Children.Values.Sum(c => c.Size);                  // composite: recursive
}
public sealed class InMemoryFs
{
    private readonly DirectoryNode _root = new("");
    public DirectoryNode MkdirP(string path)
    {
        var dir = _root;
        foreach (var part in path.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (!dir.Children.TryGetValue(part, out var child)) dir.Children[part] = child = new DirectoryNode(part) { Parent = dir };
            dir = child as DirectoryNode ?? throw new IOException(part + " is a file");
        }
        return dir;
    }
    public IEnumerable<FileNode> Find(DirectoryNode start, Func<FileNode, bool> predicate)
    {
        var stack = new Stack<DirectoryNode>(); stack.Push(start);
        while (stack.Count > 0)
            foreach (var c in stack.Pop().Children.Values)
                if (c is DirectoryNode d) stack.Push(d); else if (c is FileNode f && predicate(f)) yield return f;
    }
}
~~~`,
  pts: [r`Composite: files and directories share an abstract node.`, r`Directories hold children by name.`, r`Path resolution walks from the root, handling . and ..`, r`Size is recursive; cache it with invalidation if needed.`, r`Use iterative traversal for deep trees.`],
  ex: r`A document-management prototype used the same composite model to compute folder sizes and enforce quotas per tenant.`,
  fu: [r`How would you add symbolic links safely?`],
  pit: [r`Separate unrelated classes for files and folders with duplicated logic.`] },

{ id: 'q18', level: 'Intermediate', tags: ['undo-redo', 'command'],
  q: r`Design undo/redo for a document or form editor.`,
  a: r`Use the **Command pattern**: each user action is an object with {{Execute()}} and {{Undo()}}.

- **Undo stack** and **redo stack**: executing a new command pushes it on undo and clears redo; undo pops from undo, calls {{Undo()}}, pushes to redo; redo reverses.
- **Command merging**: consecutive typing commands merged into one (coalescing) for sensible undo granularity.
- **Memento** alternative: store snapshots of state (simpler, more memory); often combined (snapshot every N commands).
- **Limits**: cap stack size.
- **Collaboration**: multi-user undo is harder (operational transforms or CRDTs).

In front ends (Angular/React), immutable state makes undo straightforward: keep a history of previous state objects (structural sharing keeps memory reasonable).`,
  code: r`~~~csharp
public interface IEditCommand { void Execute(); void Undo(); bool TryMerge(IEditCommand next) => false; }
public sealed class InsertText(Document doc, int pos, string text) : IEditCommand
{
    private string _text = text;
    public void Execute() => doc.Insert(pos, _text);
    public void Undo() => doc.Delete(pos, _text.Length);
    public bool TryMerge(IEditCommand next) { if (next is InsertText n && n.Pos == pos + _text.Length) { _text += n.Text; return true; } return false; }
    public int Pos => pos; public string Text => _text;
}
public sealed class History(int max = 200)
{
    private readonly LinkedList<IEditCommand> _undo = new(); private readonly Stack<IEditCommand> _redo = new();
    public void Do(IEditCommand c)
    {
        c.Execute(); _redo.Clear();
        if (_undo.Last?.Value.TryMerge(c) == true) return;
        _undo.AddLast(c); if (_undo.Count > max) _undo.RemoveFirst();
    }
    public void Undo() { if (_undo.Last is { } n) { _undo.RemoveLast(); n.Value.Undo(); _redo.Push(n.Value); } }
    public void Redo() { if (_redo.TryPop(out var c)) { c.Execute(); _undo.AddLast(c); } }
}
~~~
~~~typescript
// Front end with immutable state: history of snapshots
type History<T> = { past: T[]; present: T; future: T[] };
const undo = <T,>(h: History<T>): History<T> => h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h;
~~~`,
  pts: [r`Commands with Execute and Undo; undo and redo stacks.`, r`New commands clear the redo stack.`, r`Merge consecutive commands for sensible granularity.`, r`Mementos (snapshots) are a simpler alternative.`, r`Immutable front-end state makes undo cheap.`],
  ex: r`A payment-template editor's undo merged keystrokes into word-level steps, matching users' expectations.`,
  fu: [r`How does undo work in collaborative editing?`],
  pit: [r`Unbounded history leaking memory.`] },

{ id: 'q19', level: 'Senior', tags: ['order-matching', 'lld'],
  q: r`Design the classes for a limit order book and matching engine for one instrument.`,
  a: r`### Classes
- {{Order}} (id, side, price, quantity, remaining, timestamp/sequence, type: limit/market, time-in-force).
- {{PriceLevel}}: FIFO queue of orders at one price.
- {{BookSide}}: price levels sorted (bids descending, asks ascending) + order id index.
- {{OrderBook}}: two sides; {{Add}}, {{Cancel}}, {{Match}}.
- {{MatchingEngine}}: consumes sequenced commands, matches with price-time priority, emits {{Trade}} and {{BookUpdate}} events.

### Matching
Incoming buy limit at P: while best ask <= P and quantity remains: fill against the oldest order at the best ask; produce trades at the resting order's price; remove filled resting orders. Remaining quantity rests on the bid side (or is cancelled for IOC/market orders).

### Engineering
Single-threaded per instrument (determinism); events sequenced for replay; integer prices in ticks (no floating point); validation and self-trade prevention.`,
  code: r`~~~csharp
public sealed class Order(long id, Side side, long priceTicks, long qty, long seq)
{ public long Id = id; public Side Side = side; public long Price = priceTicks; public long Remaining = qty; public long Seq = seq; }
public enum Side { Buy, Sell }
public sealed record Trade(long BuyId, long SellId, long Price, long Qty, long Seq);

public sealed class OrderBook
{
    private readonly SortedDictionary<long, Queue<Order>> _bids = new(Comparer<long>.Create((a, b) => b.CompareTo(a)));
    private readonly SortedDictionary<long, Queue<Order>> _asks = new();
    public IEnumerable<Trade> Submit(Order o)
    {
        var (book, crosses) = o.Side == Side.Buy ? (_asks, (Func<long, bool>)(p => p <= o.Price)) : (_bids, p => p >= o.Price);
        while (o.Remaining > 0 && book.Count > 0)
        {
            var (price, queue) = book.First();
            if (!crosses(price)) break;
            var resting = queue.Peek();
            var qty = Math.Min(o.Remaining, resting.Remaining);
            o.Remaining -= qty; resting.Remaining -= qty;
            yield return o.Side == Side.Buy ? new Trade(o.Id, resting.Id, price, qty, o.Seq) : new Trade(resting.Id, o.Id, price, qty, o.Seq);
            if (resting.Remaining == 0) { queue.Dequeue(); if (queue.Count == 0) book.Remove(price); }
        }
        if (o.Remaining > 0) Rest(o);                                   // limit order rests (IOC would cancel instead)
    }
    private void Rest(Order o)
    {
        var side = o.Side == Side.Buy ? _bids : _asks;
        if (!side.TryGetValue(o.Price, out var q)) side[o.Price] = q = new Queue<Order>();
        q.Enqueue(o);
    }
}
~~~`,
  dia: r`classDiagram
  class MatchingEngine {
    +Process(SequencedCommand)
  }
  class OrderBook {
    +Submit(Order) Trades
    +Cancel(orderId)
  }
  class BookSide {
    +BestPrice
    +Levels
  }
  class PriceLevel {
    +Price
    +FifoOrders
  }
  class Order {
    +Id
    +Side
    +Price
    +Remaining
    +Seq
  }
  MatchingEngine --> OrderBook
  OrderBook "1" *-- "2" BookSide
  BookSide "1" *-- "many" PriceLevel
  PriceLevel "1" o-- "many" Order`,
  pts: [r`Price levels sorted per side; FIFO queue per level.`, r`Match while prices cross; trade at the resting order's price.`, r`Remaining quantity rests or cancels by order type.`, r`Integer ticks, sequenced input, single thread per instrument.`, r`Order id index for O(1) cancels.`],
  ex: r`A broker's internal crossing engine matched client orders with price-time priority and replayed its sequenced log to rebuild the book after restarts.`,
  fu: [r`How do you implement self-trade prevention?`],
  pit: [r`Decimal or double prices with rounding issues.`] },

{ id: 'q20', level: 'Senior', tags: ['payment-processor', 'lld'],
  q: r`Design the classes for a payment processing module supporting multiple providers, retries and refunds.`,
  a: r`### Classes
- {{Payment}} aggregate: id, amount ({{Money}}), status (state machine), attempts, provider reference, idempotency key.
- {{IPaymentProvider}} port with {{Authorize}}, {{Capture}}, {{Refund}}, {{GetStatus}}; adapters per provider; a {{ProviderCapabilities}} descriptor.
- {{IProviderRouter}} strategy selecting a provider (currency, country, cost, health).
- {{PaymentService}} application service orchestrating: load/create payment idempotently, route, call provider, apply result to the aggregate, persist with outbox events.
- {{WebhookHandler}} with inbox deduplication applying provider events to the aggregate.
- {{RefundPolicy}}: partial refunds, limits, time windows.

### Correctness
State transitions guarded in the aggregate; unknown outcomes (timeouts) put the payment in {{PendingConfirmation}} and trigger status queries, never a blind retry on another provider.`,
  code: r`~~~csharp
public enum PaymentStatus { Created, Authorised, Captured, PartiallyRefunded, Refunded, Failed, PendingConfirmation }
public sealed class Payment
{
    public Guid Id { get; } public Money Amount { get; } public Money Refunded { get; private set; }
    public PaymentStatus Status { get; private set; } = PaymentStatus.Created;
    public string? ProviderRef { get; private set; }
    public Payment(Guid id, Money amount) { Id = id; Amount = amount; Refunded = Money.Zero(amount.Currency); }
    public void Apply(AuthResult r) => (Status, ProviderRef) = r switch
    {
        AuthResult.Approved a when Status == PaymentStatus.Created => (PaymentStatus.Authorised, a.Ref),
        AuthResult.Declined when Status == PaymentStatus.Created => (PaymentStatus.Failed, null),
        AuthResult.Unknown when Status == PaymentStatus.Created => (PaymentStatus.PendingConfirmation, null),
        _ => throw new InvalidOperationException("Invalid transition from " + Status)
    };
    public void Refund(Money m)
    {
        if (Status is not (PaymentStatus.Captured or PaymentStatus.PartiallyRefunded)) throw new InvalidOperationException("Not refundable");
        if (Refunded + m > Amount) throw new InvalidOperationException("Refund exceeds captured amount");
        Refunded += m; Status = Refunded == Amount ? PaymentStatus.Refunded : PaymentStatus.PartiallyRefunded;
    }
}
~~~`,
  dia: r`classDiagram
  class PaymentService {
    +CreateAsync(cmd)
    +CaptureAsync(id)
    +RefundAsync(id, amount)
  }
  class Payment {
    +Status
    +Amount
    +Apply(result)
    +Refund(amount)
  }
  class IPaymentProvider {
    <<interface>>
    +Authorize()
    +Capture()
    +Refund()
    +GetStatus()
  }
  class IProviderRouter {
    <<interface>>
    +Select(payment) IPaymentProvider
  }
  class WebhookHandler {
    +HandleAsync(event)
  }
  PaymentService --> Payment
  PaymentService --> IProviderRouter
  IProviderRouter --> IPaymentProvider
  WebhookHandler --> Payment
  IPaymentProvider <|.. StripeAdapter
  IPaymentProvider <|.. AdyenAdapter`,
  pts: [r`Payment aggregate with a guarded state machine.`, r`Provider port with adapters and capability descriptors.`, r`Router strategy chooses providers.`, r`Webhooks deduplicated via an inbox.`, r`Unknown outcomes go to pending confirmation, never blind failover.`],
  ex: r`Modelling PendingConfirmation explicitly let a PSP integration recover from timeouts via status queries without double charges.`,
  fu: [r`Where do you enforce refund limits: aggregate or service?`],
  pit: [r`Booleans instead of explicit states and results.`] },

{ id: 'q21', level: 'Senior', tags: ['rule-engine', 'lld'],
  q: r`Design a configurable rule engine for loan eligibility (rules editable by business users, explainable decisions).`,
  a: r`### Classes
- {{Rule}}: id, condition (expression tree), outcome (pass/fail/refer), reason code, priority, effective dates.
- {{Condition}} composite: {{And}}, {{Or}}, {{Not}}, leaf comparisons ({{Field op Value}}) over a typed {{Facts}} object.
- {{RuleSet}} versioned with approval status.
- {{RuleEngine}}: evaluates active rules for a product in priority order; aggregates outcomes (any fail = decline, any refer = manual review).
- {{DecisionRecord}}: inputs hash, rule set version, fired rules, outcome, reasons.
- {{IRuleRepository}} loads rule sets (JSON stored in DB), validated against a schema of allowed fields and operators.

### Safety
No arbitrary code in rules; whitelisted fields/operators; simulation against historical applications before activation; four-eyes approval; versioning so past decisions are reproducible.`,
  code: r`~~~csharp
public abstract record Condition { public abstract bool Eval(Facts f); }
public sealed record And(Condition L, Condition R) : Condition { public override bool Eval(Facts f) => L.Eval(f) && R.Eval(f); }
public sealed record Or(Condition L, Condition R) : Condition { public override bool Eval(Facts f) => L.Eval(f) || R.Eval(f); }
public sealed record Compare(string Field, string Op, decimal Value) : Condition
{
    public override bool Eval(Facts f) => Op switch
    {
        ">=" => f.Number(Field) >= Value, "<" => f.Number(Field) < Value, "==" => f.Number(Field) == Value,
        _ => throw new NotSupportedException("Operator " + Op + " not allowed")
    };
}
public sealed record Rule(string Id, int Priority, Condition When, string Outcome, string Reason);
public sealed class RuleEngine
{
    public DecisionRecord Decide(Facts facts, RuleSet set)
    {
        var fired = set.Rules.OrderBy(r => r.Priority).Where(r => r.When.Eval(facts)).ToList();
        var outcome = fired.Any(r => r.Outcome == "DECLINE") ? "DECLINE" : fired.Any(r => r.Outcome == "REFER") ? "REFER" : "APPROVE";
        return new DecisionRecord(Guid.NewGuid(), set.Version, facts.Hash(), outcome, fired.Select(r => r.Id + ":" + r.Reason).ToList());
    }
}
~~~`,
  pts: [r`Conditions as a composite expression tree over typed facts.`, r`Rules versioned, approved and effective-dated.`, r`Whitelisted fields and operators; no arbitrary code.`, r`Decision records capture version, fired rules and reasons.`, r`Simulate rule changes against history before activation.`],
  ex: r`Risk analysts changed affordability thresholds weekly through an approved rule-set workflow, and every decision could be replayed for regulators.`,
  fu: [r`How would you compile rules for performance?`],
  pit: [r`Letting business users write C# scripts executed in production.`] },

{ id: 'q22', level: 'Senior', tags: ['booking-system', 'concurrency'],
  q: r`Design the classes for a movie ticket booking system (shows, seats, holds, payments).`,
  a: r`### Classes
- {{Movie}}, {{Cinema}}, {{Screen}} (seat layout), {{Show}} (movie, screen, start time, pricing).
- {{ShowSeat}}: seat in a show with status ({{Available}}, {{Held}}, {{Booked}}), {{HeldBy}}, {{HoldExpiresAt}}, version.
- {{Booking}}: show, seats, customer, amount, status ({{Pending}}, {{Confirmed}}, {{Cancelled}}), payment reference.
- {{SeatLockService}}: holds seats atomically for N minutes.
- {{PricingStrategy}}: by seat category, time, demand.
- {{BookingService}}: hold -> pay -> confirm, or release on failure/expiry.

### Concurrency
Holding multiple seats must be all-or-nothing: in a database, a single transaction with conditional updates for each seat; in memory, lock seats in a consistent order. Expired holds released by a sweeper or lazily on the next hold attempt.`,
  code: r`~~~csharp
public enum SeatStatus { Available, Held, Booked }
public sealed class ShowSeat(string seatId)
{
    public string SeatId { get; } = seatId;
    public SeatStatus Status { get; private set; } = SeatStatus.Available;
    public Guid? HeldBy { get; private set; } public DateTimeOffset HoldExpires { get; private set; }
    public bool TryHold(Guid booking, DateTimeOffset now, TimeSpan ttl)
    {
        if (Status == SeatStatus.Booked || (Status == SeatStatus.Held && HoldExpires > now)) return false;
        (Status, HeldBy, HoldExpires) = (SeatStatus.Held, booking, now + ttl); return true;
    }
    public void Confirm(Guid booking) { if (Status != SeatStatus.Held || HeldBy != booking) throw new InvalidOperationException("Hold lost"); Status = SeatStatus.Booked; }
}
public sealed class Show(IEnumerable<ShowSeat> seats)
{
    private readonly SortedDictionary<string, ShowSeat> _seats = new(seats.ToDictionary(s => s.SeatId), StringComparer.Ordinal);
    private readonly Lock _gate = new();
    public bool TryHoldAll(IReadOnlyCollection<string> ids, Guid booking, DateTimeOffset now, TimeSpan ttl)
    {
        lock (_gate)                                                     // all-or-nothing under one lock per show
        {
            if (!ids.All(id => _seats[id].Status == SeatStatus.Available || (_seats[id].Status == SeatStatus.Held && _seats[id].HoldExpires <= now))) return false;
            foreach (var id in ids) _seats[id].TryHold(booking, now, ttl);
            return true;
        }
    }
}
~~~`,
  pts: [r`Separate Screen layout from per-show seat state.`, r`Seat holds with expiry; confirm only if the hold is still yours.`, r`Multi-seat holds are all-or-nothing.`, r`Lock per show (or transaction with conditional updates).`, r`Pricing strategy and booking state machine.`],
  ex: r`Moving from per-seat optimistic retries to all-or-nothing holds removed partial bookings where users got 2 of 4 seats.`,
  fu: [r`How would you scale this for a stadium on-sale?`],
  pit: [r`Holding seats one by one and leaving partial holds on failure.`] },

{ id: 'q23', level: 'Senior', tags: ['inventory', 'reservation'],
  q: r`Design an inventory reservation module for e-commerce (reserve on checkout, release on timeout, multiple warehouses).`,
  a: r`### Model
- {{StockItem}} per (SKU, warehouse): {{OnHand}}, {{Reserved}}; {{Available = OnHand - Reserved}}.
- {{Reservation}}: id (idempotency), order id, lines (sku, warehouse, qty), status ({{Active}}, {{Committed}}, {{Released}}, {{Expired}}), expires at.
- {{IAllocationStrategy}}: choose warehouses (nearest to customer, cost, split shipments).

### Operations
- **Reserve**: for each line, conditional increment of Reserved if Available >= qty; all-or-nothing per order (transaction); idempotent by reservation id.
- **Commit** on shipment: decrement OnHand and Reserved.
- **Release** on cancel or payment failure; **expire** via sweeper.

### Concurrency and scale
Conditional updates in the database are the source of truth; caches show approximate availability; hot SKUs during flash sales may use sharded stock counters (split OnHand into N buckets).`,
  code: r`~~~sql
-- Reserve atomically; zero rows -> insufficient stock for this line -> roll back the whole order
UPDATE stock_items SET reserved = reserved + $qty, version = version + 1
WHERE sku = $sku AND warehouse_id = $wh AND on_hand - reserved >= $qty;
-- Commit on shipment
UPDATE stock_items SET on_hand = on_hand - $qty, reserved = reserved - $qty WHERE sku = $sku AND warehouse_id = $wh;
~~~
~~~csharp
public sealed class ReservationService(InventoryDb db, IAllocationStrategy allocate, TimeProvider clock)
{
    public async Task<ReservationResult> ReserveAsync(Guid reservationId, Order order, CancellationToken ct)
    {
        if (await db.Reservations.FindAsync([reservationId], ct) is { } existing) return ReservationResult.From(existing);   // idempotent
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        foreach (var line in await allocate.PlanAsync(order, ct))
            if (await db.TryReserveAsync(line.Sku, line.WarehouseId, line.Qty, ct) == 0) { await tx.RollbackAsync(ct); return ReservationResult.OutOfStock(line.Sku); }
        db.Reservations.Add(new Reservation(reservationId, order.Id, clock.GetUtcNow().AddMinutes(15)));
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return ReservationResult.Ok(reservationId);
    }
}
~~~`,
  pts: [r`Available = OnHand - Reserved per SKU and warehouse.`, r`Reserve with conditional updates, all-or-nothing per order.`, r`Idempotent reservations with expiry.`, r`Commit on shipment; release on cancel or timeout.`, r`Sharded counters for flash-sale hot SKUs.`],
  ex: r`A flash sale oversold by 300 units with read-then-write logic; conditional updates fixed overselling permanently.`,
  fu: [r`How do you reconcile with warehouse management systems?`],
  pit: [r`Decrementing stock at add-to-cart time.`] },

{ id: 'q24', level: 'Senior', tags: ['chess', 'game-design'],
  q: r`Design the classes for a chess game. Where do polymorphism and validation belong?`,
  a: r`### Classes
- {{Game}}: board, players, turn, status (active, check, checkmate, stalemate, draw), move history.
- {{Board}}: 8x8 squares, piece placement, helpers (path clear, square attacked).
- {{Piece}} abstract with {{Color}} and {{PossibleMoves(board, from)}}; subclasses King, Queen, Rook, Bishop, Knight, Pawn. Here **inheritance fits**: pieces are genuine subtypes with different movement behaviour.
- {{Move}}: from, to, promotion, special flags (castling, en passant).
- {{MoveValidator}}: legal moves = pseudo-legal moves that do not leave own king in check.
- {{IMoveHistory}} for undo and repetition detection.

### Design notes
Special rules (castling rights, en passant, promotion) depend on history; keep them in the game/validator, not in pieces. Use value types for squares. For performance engines use bitboards; for an interview, clarity first.`,
  code: r`~~~csharp
public readonly record struct Square(int File, int Rank) { public bool OnBoard => File is >= 0 and < 8 && Rank is >= 0 and < 8; }
public enum Color { White, Black }
public abstract class Piece(Color color)
{
    public Color Color { get; } = color;
    public abstract IEnumerable<Square> PseudoLegalTargets(Board b, Square from);
    protected IEnumerable<Square> Slide(Board b, Square from, (int df, int dr)[] dirs)
    {
        foreach (var (df, dr) in dirs)
            for (var s = new Square(from.File + df, from.Rank + dr); s.OnBoard; s = new Square(s.File + df, s.Rank + dr))
            {
                var p = b[s];
                if (p is null) { yield return s; continue; }
                if (p.Color != Color) yield return s;              // capture
                break;
            }
    }
}
public sealed class Rook(Color c) : Piece(c) { public override IEnumerable<Square> PseudoLegalTargets(Board b, Square f) => Slide(b, f, [(1, 0), (-1, 0), (0, 1), (0, -1)]); }
public sealed class Bishop(Color c) : Piece(c) { public override IEnumerable<Square> PseudoLegalTargets(Board b, Square f) => Slide(b, f, [(1, 1), (1, -1), (-1, 1), (-1, -1)]); }
// Legal = pseudo-legal moves after which the mover's king is not attacked (checked by MoveValidator on a copy of the board)
~~~`,
  pts: [r`Pieces are a genuine hierarchy: inheritance fits here.`, r`Board provides geometry helpers; Game owns turn and status.`, r`Legal moves = pseudo-legal minus those leaving the king in check.`, r`History-dependent rules live in the game/validator.`, r`Value types for squares; clarity before bitboards.`],
  ex: r`Separating pseudo-legal generation from legality checking made special rules (castling through check) easy to test in isolation.`,
  fu: [r`How would you detect threefold repetition?`],
  pit: [r`Putting castling and en passant logic inside piece classes.`] },

{ id: 'q25', level: 'Senior', tags: ['meeting-scheduler'],
  q: r`Design a meeting room scheduler (book rooms, find free slots for attendees, recurring meetings).`,
  a: r`### Classes
- {{Room}} (capacity, equipment), {{Person}} (calendar), {{Meeting}} (organizer, attendees, room, interval, recurrence rule).
- {{Calendar}}: sorted intervals per person/room ({{SortedSet}} by start) supporting overlap checks and free-slot queries.
- {{RecurrenceRule}} (RRULE-like: daily/weekly, until/count, exceptions) expanded into occurrences in a window.
- {{SchedulerService}}: book (check room and attendee conflicts atomically), find common free slots (merge busy intervals of all attendees, then find gaps of the required length within working hours and time zones).

### Concerns
Half-open intervals; time zones and DST (store UTC plus the organiser's time zone for recurrence); concurrency on room booking (lock per room or database exclusion constraint); performance by limiting search windows.`,
  code: r`~~~csharp
public readonly record struct Slot(DateTimeOffset Start, DateTimeOffset End) { public bool Overlaps(Slot o) => Start < o.End && o.Start < End; }
public static IEnumerable<Slot> CommonFreeSlots(IEnumerable<IEnumerable<Slot>> busyCalendars, Slot window, TimeSpan length)
{
    var busy = busyCalendars.SelectMany(c => c).Where(s => s.Overlaps(window)).OrderBy(s => s.Start).ToList();
    var cursor = window.Start;
    foreach (var b in busy)
    {
        if (b.Start - cursor >= length) yield return new Slot(cursor, b.Start);   // gap before this busy interval
        if (b.End > cursor) cursor = b.End;
    }
    if (window.End - cursor >= length) yield return new Slot(cursor, window.End);
}
~~~`,
  pts: [r`Calendars as sorted half-open intervals.`, r`Free slots: merge everyone's busy intervals and find gaps.`, r`Recurrence rules expanded within a window.`, r`Store UTC plus time zone for recurrences across DST.`, r`Room booking must be atomic (lock or exclusion constraint).`],
  ex: r`A global team scheduler found meeting slots across London, New York and Singapore by merging busy calendars within each person's working hours.`,
  fu: [r`How do you handle an exception to one occurrence of a recurring meeting?`],
  pit: [r`Storing recurring meetings as local times without zones.`] },

{ id: 'q26', level: 'Senior', tags: ['url-shortener', 'lld'],
  q: r`LLD of a URL shortener service: classes, interfaces and code generation.`,
  a: r`### Classes
- {{ShortLink}} (code, target URL, owner, created, expires, status).
- {{ICodeGenerator}} strategy: random base62, counter-based (encoded ids), or custom alias validation.
- {{ILinkRepository}}: {{TryAdd(link)}} (fails on duplicate code), {{Get(code)}}.
- {{IUrlValidator}}: scheme allow-list, length limits, malware/phishing check port.
- {{ShortenerService}}: create (validate, generate code, retry on collision up to N times), resolve (cache-aside), disable.
- {{IClickRecorder}}: async click events.

### Code generation trade-offs
Random codes: no coordination, collision checks; counter-based: no collisions, predictable (enumerable), needs a distributed counter or id ranges per instance (hi-lo allocation).`,
  code: r`~~~csharp
public interface ICodeGenerator { string Next(); }
public sealed class RandomBase62(int length = 7) : ICodeGenerator
{
    private const string Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    public string Next() => string.Create(length, 0, (span, _) => { for (var i = 0; i < span.Length; i++) span[i] = Alphabet[RandomNumberGenerator.GetInt32(62)]; });
}
public sealed class ShortenerService(ICodeGenerator codes, ILinkRepository repo, IUrlValidator validator, TimeProvider clock)
{
    public async Task<ShortLink> CreateAsync(string url, string owner, string? alias, CancellationToken ct)
    {
        await validator.EnsureSafeAsync(url, ct);
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var link = new ShortLink(alias ?? codes.Next(), url, owner, clock.GetUtcNow());
            if (await repo.TryAddAsync(link, ct)) return link;                // conditional insert
            if (alias is not null) throw new AliasTakenException(alias);
        }
        throw new InvalidOperationException("Could not allocate a unique code");
    }
}
~~~`,
  pts: [r`Code generation is a strategy: random vs counter-based.`, r`Repository TryAdd as the uniqueness guarantee.`, r`Validate URLs and scan for malicious links.`, r`Retry on collision with a bound.`, r`Record clicks asynchronously.`],
  ex: r`Switching from sequential to random codes stopped competitors enumerating a company's marketing links.`,
  fu: [r`How does hi-lo id allocation work?`],
  pit: [r`Check-then-insert uniqueness without a unique constraint.`] },

{ id: 'q27', level: 'Senior', tags: ['coupon-engine'],
  q: r`Design a coupon/discount engine with eligibility rules, stacking, usage limits and fraud prevention.`,
  a: r`### Classes
- {{Coupon}}: code, type (percentage, fixed, free shipping), value, validity window, usage limits (global, per customer), stackability group, minimum basket, eligible SKUs/categories/segments.
- {{IEligibilityRule}} chain: date, segment, basket minimum, product scope, first-order-only.
- {{ICouponRedemptionStore}}: atomic redemption counting ({{redeemed < limit}}) per coupon and per customer; reservations at checkout, confirmation on payment, release on failure.
- {{StackingPolicy}}: exclusive vs combinable groups, best-discount selection.
- {{DiscountCalculator}}: computes allocation across lines (for refunds and tax).

### Fraud
Rate-limit code attempts, unique single-use codes for high value, tie coupons to accounts, detect abuse patterns (many accounts, same device).`,
  code: r`~~~sql
-- Atomic redemption with a global cap and a per-customer cap
BEGIN;
  UPDATE coupons SET redeemed = redeemed + 1 WHERE code = $code AND redeemed < max_redemptions AND now() BETWEEN valid_from AND valid_to;
  -- 0 rows -> exhausted or expired -> ROLLBACK
  INSERT INTO coupon_redemptions (code, customer_id, order_id, status) VALUES ($code, $cust, $order, 'RESERVED');
  -- unique (code, customer_id) WHERE status <> 'RELEASED' enforces once per customer
COMMIT;
~~~
~~~csharp
public interface IEligibilityRule { Eligibility Check(Coupon c, Basket b, Customer cu); }
public sealed record Eligibility(bool Ok, string? Reason) { public static readonly Eligibility Yes = new(true, null); }
public sealed class MinimumBasket : IEligibilityRule
{ public Eligibility Check(Coupon c, Basket b, Customer cu) => b.Subtotal >= c.MinimumBasket ? Eligibility.Yes : new(false, "Spend " + c.MinimumBasket + " to use this code"); }
~~~`,
  pts: [r`Coupons as data with validity, scope, limits and stacking groups.`, r`Eligibility as a chain of rules with clear reasons.`, r`Atomic redemption counting with global and per-customer caps.`, r`Reserve at checkout, confirm on payment, release on failure.`, r`Rate-limit attempts and detect abuse patterns.`],
  ex: r`A retailer's 10,000-use coupon was redeemed 14,000 times due to a read-then-write counter; atomic conditional updates fixed it.`,
  fu: [r`How do you allocate a basket-level discount across lines for refunds?`],
  pit: [r`Counting redemptions after payment only.`] },

{ id: 'q28', level: 'Senior', tags: ['concurrency', 'thread-safety'],
  q: r`In LLD interviews, how do you demonstrate thread safety convincingly?`,
  a: r`- **Identify shared mutable state** explicitly (spots, seats, balances, counters, caches).
- **Name the race** (two gates claim the same spot; two withdrawals overdraw) and the invariant at risk.
- **Choose the mechanism**:
  - Atomic CAS ({{Interlocked}}) for single fields.
  - A lock per aggregate (per account, per show) for compound invariants; consistent lock order for multiple aggregates.
  - Concurrent collections for indexes.
  - Single-threaded ownership (actor/channel per entity) to avoid locks.
  - Database conditional updates/optimistic concurrency when state is persisted.
- **Keep critical sections small** and free of I/O.
- **Discuss failure**: what happens if a thread dies holding a lease? (timeouts, expiry)
- **Test**: concurrent stress tests asserting invariants (e.g. 1,000 parallel reservations never exceed stock).`,
  code: r`~~~csharp
[Fact]
public async Task Parallel_reservations_never_oversell()
{
    var stock = new Stock(sku: "A", onHand: 100);
    var results = await Task.WhenAll(Enumerable.Range(0, 1_000).Select(_ => Task.Run(() => stock.TryReserve(1))));
    results.Count(ok => ok).Should().Be(100);          // exactly the available quantity
    stock.Available.Should().Be(0);
}
public sealed class Stock(string sku, int onHand)
{
    private int _available = onHand;
    public int Available => Volatile.Read(ref _available);
    public bool TryReserve(int qty)
    {
        while (true)
        {
            var cur = Volatile.Read(ref _available);
            if (cur < qty) return false;
            if (Interlocked.CompareExchange(ref _available, cur - qty, cur) == cur) return true;   // CAS loop
        }
    }
}
~~~`,
  pts: [r`Name the shared state, the race and the invariant at risk.`, r`Pick CAS, per-aggregate locks, concurrent collections, actors or DB conditions.`, r`Keep critical sections small and I/O-free.`, r`Consider failure while holding locks or leases.`, r`Prove it with concurrent stress tests.`],
  ex: r`A 1,000-task stress test exposed an oversell bug in a "thread-safe" stock class that used a check-then-decrement under two separate locks.`,
  fu: [r`When would you use an actor model instead of locks?`],
  pit: [r`Saying "make it synchronized" without naming the invariant.`] },

{ id: 'q29', level: 'Senior', tags: ['api-design', 'lld'],
  q: r`How do you design the public API of a reusable component (method signatures, errors, async) in an LLD discussion?`,
  a: r`- **Intention-revealing names** and small surfaces: {{ReserveAsync(orderId, lines)}} not {{Process(data, flag)}}.
- **Inputs as value objects** (Money, Sku, strongly-typed ids) to prevent misuse.
- **Results**: explicit result types for expected business outcomes (OutOfStock, Reserved) and exceptions for programmer errors and infrastructure failures.
- **Async and cancellation**: {{Task}}/{{ValueTask}} with {{CancellationToken}} for I/O-bound operations.
- **Idempotency** parameters for operations that may be retried.
- **Immutability** of returned data; read-only collections.
- **Versioning and extension**: options objects, interfaces for strategies, sealed implementations.
- **Documentation of behavioural contract**: thread safety, idempotency, exceptions, ordering.`,
  code: r`~~~csharp
/// <summary>Reserves stock for all lines or none. Idempotent per reservationId. Thread-safe.</summary>
public interface IInventory
{
    Task<ReservationOutcome> ReserveAsync(ReservationId reservationId, IReadOnlyList<ReservationLine> lines, CancellationToken ct);
    Task ReleaseAsync(ReservationId reservationId, CancellationToken ct);
}
public sealed record ReservationLine(Sku Sku, Quantity Quantity);
public abstract record ReservationOutcome
{
    public sealed record Reserved(ReservationId Id, DateTimeOffset ExpiresAt) : ReservationOutcome;
    public sealed record OutOfStock(IReadOnlyList<Sku> Skus) : ReservationOutcome;
}
public readonly record struct Quantity { public int Value { get; } public Quantity(int v) => Value = v > 0 ? v : throw new ArgumentOutOfRangeException(nameof(v)); }
~~~`,
  pts: [r`Intention-revealing, small API surfaces.`, r`Value objects for inputs prevent misuse.`, r`Result types for business outcomes; exceptions for errors.`, r`Async with cancellation; idempotency parameters.`, r`Document thread safety and behavioural contracts.`],
  ex: r`Replacing bool Reserve(string sku, int qty) with a typed outcome API removed a class of bugs where callers ignored false returns.`,
  fu: [r`When is an exception better than a result type?`],
  pit: [r`Boolean flags and magic strings in public methods.`] },

{ id: 'q30', level: 'Senior', tags: ['extensibility'],
  q: r`An interviewer asks "now add X" (a new vehicle type, payment method, report). How do you show your design absorbs change?`,
  a: r`Walk through the change against your design:

1. **Which classes change?** Ideally: add one new class (strategy, state, rule) plus one registration line; no edits to stable classes (OCP).
2. **Which tests change?** Only new tests for the new class; existing tests untouched.
3. **Data changes?** New enum values or configuration rows; migration needs.
4. **Cross-cutting impact?** Pricing, permissions, reporting, UI.

If the change forces edits across many classes, say so and refactor the design live: extract the variation point into an interface or move from inheritance to composition. Interviewers value recognising a design flaw and fixing it more than pretending the original design was perfect.

Also push back if a requested extension contradicts invariants or adds disproportionate complexity, proposing a simpler alternative.`,
  code: r`~~~csharp
// "Add EV charging spots" against the parking-lot design:
public sealed class EvSpot(string id, SpotSize size, IChargingPort port) : Spot(id, size) { public IChargingPort Port { get; } = port; }
public sealed class EvFirstAllocator(ISpotAllocator fallback) : ISpotAllocator          // new strategy, decorates the default
{
    public Spot? Allocate(Vehicle v, IReadOnlyList<Spot> spots) =>
        v.IsElectric ? spots.OfType<EvSpot>().FirstOrDefault(s => s.IsFree && s.Size >= v.Needs && s.TryTake()) ?? fallback.Allocate(v, spots)
                     : fallback.Allocate(v, spots);
}
public sealed class EvChargingPricing(IPricingPolicy parking, decimal perKwh) : IPricingPolicy { /* parking fee + energy */ }
// Changed: 0 existing classes (Spot unsealed for this case, or composition with a ChargingCapability). Added: 3 classes + registrations.
~~~`,
  pts: [r`Walk the change through classes, tests, data and cross-cutting concerns.`, r`Ideal: add a class and a registration, edit nothing stable.`, r`If many edits are needed, refactor the variation point live.`, r`Admitting and fixing a design flaw scores well.`, r`Push back on extensions that break invariants.`],
  ex: r`A candidate who noticed their Vehicle hierarchy could not absorb EVs and refactored to capabilities live received the strongest feedback of the panel.`,
  fu: [r`How would you add a feature that cuts across all strategies?`],
  pit: [r`Adding if (type == "new") branches in several classes.`] },

{ id: 'q31', level: 'Senior', tags: ['persistence', 'lld'],
  q: r`How do you take an in-memory LLD to a persisted design (repositories, transactions, concurrency)?`,
  a: r`- **Aggregates become persistence units**: load and save whole aggregates via repositories; one aggregate per transaction by default.
- **Identity**: generated ids (UUIDv7/sequences); strongly-typed ids mapped with value converters.
- **Concurrency**: in-memory locks become **optimistic concurrency** (row version) or conditional updates; retries on conflict for commutative operations.
- **Invariants spanning aggregates**: database constraints (unique, exclusion) or sagas.
- **Collections**: child entities mapped as owned/related rows; value objects as complex/owned types.
- **Events**: domain events written to an outbox in the same transaction.
- **Queries**: separate read models/projections for listing screens.
- **Time and expiry**: holds and leases become columns with expiry checked in queries plus a sweeper job.`,
  code: r`~~~csharp
public sealed class SeatConfiguration : IEntityTypeConfiguration<ShowSeat>
{
    public void Configure(EntityTypeBuilder<ShowSeat> b)
    {
        b.HasKey(s => new { s.ShowId, s.SeatId });
        b.Property(s => s.Status).HasConversion<string>().HasMaxLength(10);
        b.Property<byte[]>("RowVersion").IsRowVersion();                  // optimistic concurrency replaces the in-memory lock
    }
}
try { await db.SaveChangesAsync(ct); }
catch (DbUpdateConcurrencyException) { return HoldResult.Conflict; }       // someone else held the seat first
~~~`,
  pts: [r`Aggregates map to transactional persistence units.`, r`Locks become optimistic concurrency or conditional updates.`, r`Cross-aggregate invariants via DB constraints or sagas.`, r`Outbox for events; read models for queries.`, r`Expiry becomes columns plus sweepers.`],
  ex: r`Persisting the booking LLD with row versions turned a lock-based prototype into a horizontally scalable service with no double bookings.`,
  fu: [r`When is pessimistic locking justified?`],
  pit: [r`Keeping in-memory locks after scaling to multiple instances.`] },

{ id: 'q32', level: 'Senior', tags: ['testing', 'lld'],
  q: r`How do you make an LLD testable, and what tests would you write for it?`,
  a: r`Design for testability:

- Inject time ({{TimeProvider}}), randomness and I/O ports.
- Keep domain logic pure where possible (functional core), with orchestration separate.
- Small interfaces at variation points so fakes are easy.

Tests to write:

- **Unit tests** for each strategy, state transition and invariant (including illegal transitions).
- **Property-based tests** for invariants (allocations sum, no double booking across random sequences).
- **Concurrency stress tests** for shared state.
- **Contract tests** that every strategy implementation must pass.
- **Scenario tests** of end-to-end use cases (enter, park, pay, exit) with fakes.
- **Time-based tests** advancing a fake clock (hold expiry, fines).`,
  code: r`~~~csharp
[Fact]
public void Hold_expires_after_ttl()
{
    var clock = new FakeTimeProvider(DateTimeOffset.Parse("2026-10-10T18:00:00Z"));
    var seat = new ShowSeat("A1");
    seat.TryHold(Guid.NewGuid(), clock.GetUtcNow(), TimeSpan.FromMinutes(10)).Should().BeTrue();
    seat.TryHold(Guid.NewGuid(), clock.GetUtcNow(), TimeSpan.FromMinutes(10)).Should().BeFalse();   // still held
    clock.Advance(TimeSpan.FromMinutes(11));
    seat.TryHold(Guid.NewGuid(), clock.GetUtcNow(), TimeSpan.FromMinutes(10)).Should().BeTrue();    // expired hold can be taken
}
[Theory]
[InlineData(PaymentStatus.Created, "refund")]
[InlineData(PaymentStatus.Failed, "capture")]
public void Illegal_transitions_throw(PaymentStatus from, string action) =>
    FluentActions.Invoking(() => PaymentFixtures.In(from).Perform(action)).Should().Throw<InvalidOperationException>();
~~~`,
  pts: [r`Inject time, randomness and I/O ports.`, r`Unit-test strategies, transitions and invariants including illegal paths.`, r`Property-based tests for invariants.`, r`Concurrency stress tests for shared state.`, r`Scenario tests with fakes and a fake clock.`],
  ex: r`Fake-clock tests caught a fine-calculation bug at month boundaries that manual testing never hit.`,
  fu: [r`How many tests would you show in an interview?`],
  pit: [r`Designs that read DateTime.Now internally.`] },

{ id: 'q33', level: 'Senior', tags: ['splitwise', 'snake-ladder', 'games'],
  q: r`Design a snakes-and-ladders (or simple board game) engine that supports new rules and multiple players.`,
  a: r`### Classes
- {{Game}}: players, board, turn order, status, winner.
- {{Board}}: size, jumps (snakes and ladders as a dictionary from start to end cell).
- {{IDice}} strategy (single, double, loaded for tests).
- {{Player}}: name, position.
- {{IRule}} pipeline applied after each roll: move, apply jumps, exact-landing-to-win rule, extra turn on six, three sixes forfeit, etc.
- {{IGameObserver}} for UI/events.

### Extensibility
New rules are new {{IRule}} implementations in the pipeline; board configurations are data; deterministic tests with a fixed-sequence dice.`,
  code: r`~~~csharp
public interface IDice { int Roll(); }
public sealed class FixedDice(params int[] rolls) : IDice { private int _i; public int Roll() => rolls[_i++ % rolls.Length]; }
public sealed class TurnContext(Player p, int roll, Board board) { public Player Player = p; public int Roll = roll; public Board Board = board; public bool ExtraTurn; public bool Won; }
public interface IRule { void Apply(TurnContext t); }
public sealed class MoveRule : IRule
{ public void Apply(TurnContext t) { var target = t.Player.Position + t.Roll; if (target <= t.Board.Size) t.Player.Position = target; } }   // exact landing
public sealed class JumpRule : IRule
{ public void Apply(TurnContext t) { if (t.Board.Jumps.TryGetValue(t.Player.Position, out var to)) t.Player.Position = to; } }
public sealed class WinRule : IRule { public void Apply(TurnContext t) => t.Won = t.Player.Position == t.Board.Size; }
public sealed class SixGivesExtraTurn : IRule { public void Apply(TurnContext t) => t.ExtraTurn = t.Roll == 6; }
public sealed class Game(Board board, IReadOnlyList<Player> players, IDice dice, IReadOnlyList<IRule> rules)
{
    private int _turn;
    public Player? PlayTurn()
    {
        var p = players[_turn]; var ctx = new TurnContext(p, dice.Roll(), board);
        foreach (var r in rules) r.Apply(ctx);
        if (ctx.Won) return p;
        if (!ctx.ExtraTurn) _turn = (_turn + 1) % players.Count;
        return null;
    }
}
~~~`,
  pts: [r`Board as data; dice as a strategy for deterministic tests.`, r`Turn rules as an ordered pipeline.`, r`New rules are new classes, not edits.`, r`Observers for UI and events.`, r`Fixed dice make every scenario testable.`],
  ex: r`The rule-pipeline design let a team add "three sixes forfeits the turn" as one class with its own tests.`,
  fu: [r`How do rule ordering dependencies affect the pipeline?`],
  pit: [r`All rules in one PlayTurn method with nested ifs.`] },

{ id: 'q34', level: 'Senior', tags: ['frontend', 'lld'],
  q: r`Low-level design in the front end: design a reusable data table component in Angular or React (sorting, filtering, paging, selection).`,
  a: r`### Separation
- **Headless state** (sorting, filtering, pagination, selection) in a hook/service/store, independent of rendering (like TanStack Table).
- **Presentational components**: table, header cell, row, pagination controls; accept data and callbacks via typed props/inputs.
- **Column definitions** as configuration: key, header, cell renderer (template/render function), sortable, filter type.
- **Data source strategy**: client-side (in-memory) vs server-side (query parameters to an API with cursor/offset pagination).

### Concerns
Virtualisation for large datasets; accessibility (table semantics, aria-sort, keyboard navigation); stable row keys; memoisation; URL synchronisation of state for deep links; typed generics ({{Table<T>}}).`,
  code: r`~~~typescript
export interface Column<T> { key: keyof T & string; header: string; sortable?: boolean; render?: (row: T) => React.ReactNode }
export interface Query { sort?: { key: string; dir: 'asc' | 'desc' }; page: number; pageSize: number; filter?: string }
export function useTableState(initial: Query) {
  const [query, setQuery] = useState(initial);
  return {
    query,
    toggleSort: (key: string) => setQuery(q => ({ ...q, page: 0, sort: q.sort?.key === key && q.sort.dir === 'asc' ? { key, dir: 'desc' } : { key, dir: 'asc' } })),
    setPage: (page: number) => setQuery(q => ({ ...q, page })),
    setFilter: (filter: string) => setQuery(q => ({ ...q, filter, page: 0 })),
  };
}
export function DataTable<T extends { id: string }>({ rows, columns, query, onSort }: { rows: T[]; columns: Column<T>[]; query: Query; onSort: (k: string) => void }) {
  return (
    <table>
      <thead><tr>{columns.map(c => <th key={c.key} aria-sort={query.sort?.key === c.key ? (query.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        {c.sortable ? <button onClick={() => onSort(c.key)}>{c.header}</button> : c.header}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}>{columns.map(c => <td key={c.key}>{c.render ? c.render(r) : String(r[c.key])}</td>)}</tr>)}</tbody>
    </table>
  );
}
~~~`,
  pts: [r`Headless state separate from rendering.`, r`Columns as typed configuration with custom renderers.`, r`Client-side or server-side data source strategy.`, r`Accessibility, virtualisation and stable keys.`, r`Sync table state with the URL for deep links.`],
  ex: r`A headless table hook was reused across 30 admin screens with different renderers, and server-side paging was a data-source swap.`,
  fu: [r`How would you build the same in Angular with signals?`],
  pit: [r`A table component with 40 boolean props.`] },

{ id: 'q35', level: 'Senior', tags: ['feature-flags', 'lld'],
  q: r`Design a feature-flag evaluation library (targeting rules, percentage rollouts, consistent bucketing).`,
  a: r`### Classes
- {{Flag}}: key, enabled, variants, default variant, rules (ordered), rollout percentages, version.
- {{Rule}}: conditions on context attributes (tenant, country, plan, user id list) -> variant.
- {{EvaluationContext}}: user id, tenant, attributes.
- {{IFlagStore}}: snapshot of flags (local cache refreshed by polling or streaming).
- {{Evaluator}}: first matching rule wins; otherwise percentage rollout via **consistent hashing** of (flag key + user id) into 0..9999 buckets so the same user always gets the same variant; fallback to default.
- {{EvaluationResult}}: variant, reason (rule id / rollout / default), flag version, for audit and debugging.

### Concerns
Evaluate locally (no network per check); safe defaults on store failure; audit changes; avoid PII in contexts sent to vendors.`,
  code: r`~~~csharp
public sealed record EvaluationContext(string UserId, string? Tenant, IReadOnlyDictionary<string, string> Attributes);
public sealed record Flag(string Key, bool Enabled, string Default, IReadOnlyList<FlagRule> Rules, IReadOnlyList<(string Variant, int Weight)> Rollout, int Version);
public sealed record FlagRule(string Id, string Attribute, IReadOnlySet<string> Values, string Variant);
public sealed record EvaluationResult(string Variant, string Reason, int Version);

public static class Evaluator
{
    public static EvaluationResult Evaluate(Flag f, EvaluationContext ctx)
    {
        if (!f.Enabled) return new(f.Default, "disabled", f.Version);
        foreach (var r in f.Rules)
            if (ctx.Attributes.TryGetValue(r.Attribute, out var v) && r.Values.Contains(v)) return new(r.Variant, "rule:" + r.Id, f.Version);
        var bucket = (int)(System.IO.Hashing.XxHash32.HashToUInt32(Encoding.UTF8.GetBytes(f.Key + ":" + ctx.UserId)) % 10_000);   // stable per user
        var acc = 0;
        foreach (var (variant, weight) in f.Rollout) { acc += weight; if (bucket < acc) return new(variant, "rollout", f.Version); }   // weights out of 10,000
        return new(f.Default, "default", f.Version);
    }
}
~~~`,
  pts: [r`Flags with ordered targeting rules and weighted rollouts.`, r`Consistent hashing of flag key plus user id for stable bucketing.`, r`Evaluate locally from a cached snapshot.`, r`Return reasons and versions for debugging and audit.`, r`Safe defaults when the store is unavailable.`],
  ex: r`Hashing flag key with user id (not user id alone) prevented the same 10% of users being in every experiment.`,
  fu: [r`How do you avoid flags interacting badly?`],
  pit: [r`Random() per request, flipping users between variants.`] },

{ id: 'q36', level: 'Senior', tags: ['workflow', 'approval'],
  q: r`Design an approval workflow engine (maker-checker, multi-level approvals by amount, delegation, audit).`,
  a: r`### Classes
- {{ApprovalRequest}}: subject (payment, limit change), amount, requester, status, current step, history.
- {{ApprovalPolicy}}: ordered steps based on amount/type (for example, up to 10K: one approver; up to 1M: two including a manager; above: committee).
- {{ApprovalStep}}: required role(s), number of approvals, SLA, escalation rules.
- {{IApproverResolver}}: finds eligible approvers (roles, delegations, out-of-office), excluding the requester (segregation of duties).
- {{ApprovalEngine}}: records decisions, advances steps, escalates on SLA breach, emits events.
- {{AuditTrail}}: immutable decision records.

### Rules
Four-eyes: approver != requester; one person cannot approve twice in the same request; delegation time-bounded and audited; changes to the subject after approval invalidate approvals (hash of the subject at approval time).`,
  code: r`~~~csharp
public sealed class ApprovalRequest(Guid id, string requester, decimal amount, string subjectHash, ApprovalPolicy policy)
{
    private readonly List<Decision> _decisions = new();
    public ApprovalStatus Status { get; private set; } = ApprovalStatus.Pending;
    public int Step { get; private set; }
    public void Approve(string approver, IReadOnlySet<string> approverRoles, string currentSubjectHash, DateTimeOffset at)
    {
        if (Status != ApprovalStatus.Pending) throw new InvalidOperationException("Not pending");
        if (approver == requester) throw new SegregationOfDutiesException();                         // four-eyes
        if (_decisions.Any(d => d.Approver == approver)) throw new InvalidOperationException("Already approved");
        if (currentSubjectHash != subjectHash) throw new InvalidOperationException("Subject changed since submission");
        var step = policy.Steps[Step];
        if (!step.Roles.Overlaps(approverRoles)) throw new UnauthorizedAccessException();
        _decisions.Add(new Decision(approver, Step, "APPROVED", at));
        if (_decisions.Count(d => d.Step == Step) >= step.Required) { Step++; if (Step == policy.Steps.Count) Status = ApprovalStatus.Approved; }
    }
}
~~~`,
  pts: [r`Policies define steps by amount and type.`, r`Enforce segregation of duties: requester cannot approve.`, r`Invalidate approvals if the subject changes (hash).`, r`Delegation, escalation and SLAs are explicit.`, r`Immutable audit trail of decisions.`],
  ex: r`Hashing the payment at approval time stopped a fraud pattern where a beneficiary was edited after the checker approved.`,
  fu: [r`How would you support parallel approvals at one step?`],
  pit: [r`Approvals that survive edits to the approved object.`] },

{ id: 'q37', level: 'Principal', tags: ['evaluation', 'interviewing'],
  q: r`What separates a Principal-level LLD answer from a Senior one?`,
  a: r`Senior answers produce clean classes and patterns. Principal answers additionally:

- **Model variation correctly**: data vs subclasses vs strategies, justified by what is likely to change.
- **Protect invariants** in the domain with explicit state machines and value objects.
- **Handle concurrency and failure explicitly**: atomic operations, idempotency, expiry, unknown outcomes.
- **Bridge to production**: persistence and optimistic concurrency, events/outbox, observability, configuration.
- **Keep it simple**: avoid speculative abstractions; name what they would add later.
- **Communicate**: drive the discussion, state trade-offs, invite constraints, adapt quickly when requirements change.
- **Testing strategy** that proves the invariants (property and concurrency tests).`,
  code: r`~~~text
Prompt: "Design a parking lot."
Senior:    Vehicle hierarchy, Spot, Ticket, strategies; clean code.
Principal: + "vehicle size is data; allocation and pricing are the axes of change"
           + atomic spot claims across gates, lost-ticket and payment-failure flows
           + persistence with row versions, events for displays, metrics for occupancy
           + "I am not building reservations now; adding them means a Reservation aggregate and a hold state"
~~~`,
  pts: [r`Model variation from likely change.`, r`Protect invariants with state machines and value objects.`, r`Explicit concurrency, idempotency and failure handling.`, r`Bridge to persistence, events and observability.`, r`Simplicity with named future extensions; strong communication.`],
  ex: r`Panels consistently rate candidates higher when they say what they are deliberately not building and why.`,
  fu: [r`How do you recover when the interviewer finds a flaw?`],
  pit: [r`Pattern-stuffing to look senior.`] },

{ id: 'q38', level: 'Principal', tags: ['interview-scenario', 'ledger'],
  q: r`LLD: design a double-entry ledger library used by several services (accounts, journals, posting rules, balances).`,
  a: r`### Domain model
- {{LedgerAccount}}: id, type (asset, liability, income, expense, equity), currency, normal balance side, status.
- {{JournalEntry}}: id, idempotency key, effective date, description, postings, metadata (source system, reference).
- {{Posting}}: account, amount (signed or debit/credit), currency.
- **Invariant**: postings in a journal sum to zero **per currency**; accounts must be open and match the posting currency.
- {{IPostingRule}}: maps a business event (PaymentCaptured) to a journal template (debit receivable, credit revenue, credit fees).
- {{LedgerService}}: {{Post(journal)}} validates, persists atomically, updates balances; {{Reverse(journalId)}} creates an opposite journal (never edits).
- {{BalanceQuery}}: balance as of a date (sum of postings up to date, with snapshots for speed).

### Concerns
Append-only storage, idempotency, high-volume hot accounts (sub-accounts), multi-currency with FX accounts, period closing (no postings into closed periods), auditability.`,
  code: r`~~~csharp
public sealed record Posting(LedgerAccountId Account, decimal Amount, string Currency);   // + debit, - credit
public sealed class JournalEntry
{
    public Guid Id { get; } public string IdempotencyKey { get; } public DateOnly EffectiveDate { get; }
    public IReadOnlyList<Posting> Postings { get; }
    public JournalEntry(Guid id, string key, DateOnly effective, IReadOnlyList<Posting> postings)
    {
        if (postings.Count < 2) throw new LedgerException("A journal needs at least two postings");
        foreach (var g in postings.GroupBy(p => p.Currency))
            if (g.Sum(p => p.Amount) != 0) throw new LedgerException("Journal does not balance in " + g.Key);
        (Id, IdempotencyKey, EffectiveDate, Postings) = (id, key, effective, postings);
    }
    public JournalEntry Reverse(Guid newId, DateOnly date) =>
        new(newId, "reversal:" + Id, date, Postings.Select(p => p with { Amount = -p.Amount }).ToList());
}
public interface IPostingRule<in TEvent> { JournalEntry Map(TEvent e); }
public sealed class PaymentCapturedRule : IPostingRule<PaymentCaptured>
{
    public JournalEntry Map(PaymentCaptured e) => new(Guid.CreateVersion7(), "pay-capture:" + e.PaymentId, e.Date,
    [ new(Accounts.PspReceivable, e.Gross, e.Currency), new(Accounts.MerchantPayable, -(e.Gross - e.Fee), e.Currency), new(Accounts.FeeIncome, -e.Fee, e.Currency) ]);
}
~~~`,
  dia: r`classDiagram
  class LedgerService {
    +Post(JournalEntry)
    +Reverse(journalId)
  }
  class JournalEntry {
    +Id
    +IdempotencyKey
    +EffectiveDate
    +Reverse()
  }
  class Posting {
    +Account
    +Amount
    +Currency
  }
  class LedgerAccount {
    +Id
    +Type
    +Currency
  }
  class IPostingRule {
    <<interface>>
    +Map(event) JournalEntry
  }
  LedgerService --> JournalEntry
  JournalEntry "1" *-- "2..*" Posting
  Posting --> LedgerAccount
  IPostingRule ..> JournalEntry`,
  pts: [r`Journals with postings that sum to zero per currency.`, r`Posting rules map business events to journal templates.`, r`Append-only with reversals instead of edits.`, r`Idempotency keys on journals; closed periods enforced.`, r`Balances as of a date with snapshots; sub-accounts for hot spots.`],
  ex: r`A shared ledger library gave six payment services consistent accounting; finance closed months two days faster because postings were uniform.`,
  fu: [r`How do you model FX conversions?`],
  pit: [r`Allowing updates to posted journals.`] },

{ id: 'q39', level: 'Principal', tags: ['interview-scenario', 'kyc'],
  q: r`LLD: design a KYC onboarding workflow component (document checks, sanctions screening, risk scoring, manual review).`,
  a: r`### Model
- {{Application}} aggregate: applicant data, documents, check results, risk score, status ({{Started -> ChecksRunning -> AutoApproved | ManualReview -> Approved | Rejected}}).
- {{ICheck}} strategy per check type: identity document verification (vendor), liveness, address verification, sanctions/PEP screening, adverse media; each returns {{CheckResult}} (Pass, Fail, Refer + evidence).
- {{CheckOrchestrator}}: runs checks (parallel where independent), handles vendor timeouts with retries, stores evidence references.
- {{RiskScorer}}: rules/scorecard combining results and attributes (country risk, product) -> risk band and reason codes.
- {{DecisionPolicy}}: auto-approve low risk with all passes; refer anything else to manual review.
- {{ReviewCase}}: assigned analyst, notes, decision, four-eyes for high risk.

### Concerns
Data minimisation and retention, audit trails, vendor abstraction, versioned policies, periodic re-screening.`,
  code: r`~~~csharp
public abstract record CheckResult(string CheckType)
{
    public sealed record Pass(string Type, string EvidenceRef) : CheckResult(Type);
    public sealed record Fail(string Type, string Reason, string EvidenceRef) : CheckResult(Type);
    public sealed record Refer(string Type, string Reason, string EvidenceRef) : CheckResult(Type);
}
public interface ICheck { string Type { get; } Task<CheckResult> RunAsync(Application app, CancellationToken ct); }
public sealed class CheckOrchestrator(IEnumerable<ICheck> checks, ResiliencePipeline vendorPipeline)
{
    public async Task<IReadOnlyList<CheckResult>> RunAsync(Application app, CancellationToken ct) =>
        await Task.WhenAll(checks.Select(c => vendorPipeline.ExecuteAsync(async t => await c.RunAsync(app, t), ct).AsTask()));
}
public sealed class DecisionPolicy(string version)
{
    public (string Outcome, string[] Reasons) Decide(IReadOnlyList<CheckResult> results, RiskBand band) =>
        results.Any(r => r is CheckResult.Fail) ? ("REJECT", results.OfType<CheckResult.Fail>().Select(f => f.Reason).ToArray())
        : results.All(r => r is CheckResult.Pass) && band == RiskBand.Low ? ("AUTO_APPROVE", [])
        : ("MANUAL_REVIEW", results.OfType<CheckResult.Refer>().Select(f => f.Reason).Append("risk:" + band).ToArray());
}
~~~`,
  pts: [r`Checks as strategies returning pass, fail or refer with evidence.`, r`Orchestrator runs independent checks in parallel with resilience.`, r`Risk scoring and a versioned decision policy with reason codes.`, r`Manual review cases with four-eyes for high risk.`, r`Data minimisation, retention, audit and re-screening.`],
  ex: r`A digital bank auto-approved 78% of applicants in under 3 minutes while all referrals carried evidence links for analysts.`,
  fu: [r`How do you handle a vendor outage during onboarding?`],
  pit: [r`Storing raw identity documents longer than required.`] },

{ id: 'q40', level: 'Principal', tags: ['lld-to-hld'],
  q: r`How do you connect low-level design decisions to high-level architecture (and vice versa)?`,
  a: r`- **Aggregates define consistency boundaries**, which become transaction and often service/data ownership boundaries in HLD.
- **Ports in LLD** become integration contracts (APIs, events) in HLD; adapters become infrastructure components.
- **State machines** in LLD drive event design (each transition can publish an event) and saga design across services.
- **Concurrency mechanisms** in LLD (locks, CAS) become database constraints, partitioning keys and single-writer ownership at scale.
- **Variation points** (strategies) may become plugins, separate deployables or configuration services.
- HLD constraints flow down: latency budgets shape LLD (no synchronous calls in hot paths), data residency shapes aggregate placement, and team ownership shapes module boundaries.

A Principal moves between levels fluently: "this invariant lives inside one aggregate, so we can keep it in one database transaction; that one spans services, so we need a saga and reconciliation."`,
  code: r`~~~text
LLD element                 ->  HLD consequence
Order aggregate (lines)     ->  Orders service owns orders tables; one transaction per order change
Payment state machine       ->  PaymentAuthorised/Captured events; saga with Orders and Inventory
ISpotAllocator strategy     ->  allocation config per site in a config service
CAS on seat status          ->  conditional UPDATE / exclusion constraint; partition by show id
IPaymentProvider port       ->  provider adapters as separate deployable with its own scaling and secrets
~~~`,
  pts: [r`Aggregates become transaction and ownership boundaries.`, r`Ports become contracts; adapters become infrastructure.`, r`State machines drive events and sagas.`, r`In-memory concurrency becomes constraints and partition keys.`, r`HLD constraints like latency and residency shape LLD.`],
  ex: r`Recognising that "seat hold" was a single-aggregate invariant let a team partition by show and avoid distributed locks entirely.`,
  fu: [r`When does a strategy deserve its own service?`],
  pit: [r`Designing classes with no thought for where data lives.`] },

{ id: 'q41', level: 'Principal', tags: ['code-review', 'lld'],
  q: r`Code review: critique this LLD implementation of a ticket reservation service.`,
  a: r`~~~csharp
public class TicketService
{
    public static Dictionary<int, bool> Seats = new();
    public bool Book(int seatId, string user, double price)
    {
        if (Seats.ContainsKey(seatId) && Seats[seatId]) return false;
        Thread.Sleep(50);                          // call payment gateway
        Seats[seatId] = true;
        File.AppendAllText("bookings.txt", user + "," + seatId + "," + price + "\n");
        return true;
    }
}
~~~

1. **Race condition**: check-then-act on a shared static dictionary; two threads book the same seat. Also {{Dictionary}} is not thread-safe (corruption).
2. **Static mutable state**: shared across tests and instances; lost on restart; does not scale out.
3. **Payment inside the critical path without a hold**: the seat is not held during payment; payment failure handling is missing; no idempotency.
4. **double for money**; no currency.
5. **Booleans** hide reasons (sold, held, payment declined).
6. **File I/O for persistence**: no transactions, concurrency issues, no audit integrity.
7. No validation of seat existence; no time limit on holds; no cancellation.

Redesign: ShowSeat with hold/confirm states and expiry; repository with atomic conditional updates; payment through an idempotent service; result types; Money; events for confirmation.`,
  code: r`~~~csharp
public sealed class BookingService(ISeatRepository seats, IPaymentService payments, TimeProvider clock)
{
    public async Task<BookingResult> BookAsync(ShowId show, SeatId seat, CustomerId customer, Money price, string idempotencyKey, CancellationToken ct)
    {
        var bookingId = BookingId.From(idempotencyKey);
        if (!await seats.TryHoldAsync(show, seat, bookingId, clock.GetUtcNow().AddMinutes(10), ct)) return BookingResult.Unavailable;
        var payment = await payments.ChargeAsync(customer, price, idempotencyKey, ct);
        if (payment is not PaymentResult.Approved) { await seats.ReleaseAsync(show, seat, bookingId, ct); return BookingResult.PaymentDeclined; }
        return await seats.TryConfirmAsync(show, seat, bookingId, ct) ? BookingResult.Confirmed(bookingId) : BookingResult.HoldExpiredRefunding;
    }
}
~~~`,
  pts: [r`Check-then-act race on a non-thread-safe static dictionary.`, r`No hold during payment, no idempotency, no failure path.`, r`double for money and booleans hiding reasons.`, r`File appends are not a persistence strategy.`, r`Redesign with holds, conditional updates, idempotent payments and result types.`],
  ex: r`This pattern double-sold seats during a concert on-sale until replaced with conditional holds.`,
  fu: [r`What if the hold expires while payment is still processing?`],
  pit: [r`Fixing only thread safety and ignoring the payment flow.`] },

{ id: 'q42', level: 'Principal', tags: ['lld', 'performance'],
  q: r`An LLD must handle 1 million operations per second in memory (for example, a rate limiter or order book). What changes in your design?`,
  a: r`- **Avoid contention**: shard state by key across cores (N partitions, each owned by one thread/actor), or lock striping; avoid global locks.
- **Avoid allocations**: structs, pooled objects, preallocated arrays, ring buffers; no LINQ or closures in hot loops.
- **Data layout**: arrays of structs for cache locality; integer keys instead of strings where possible (intern or map ids).
- **Batching**: process inputs in batches to amortise synchronisation.
- **Lock-free single-writer** patterns (each partition has one writer; readers use snapshots).
- **Measure** with BenchmarkDotNet and profilers; set allocation and latency budgets per operation.
- **Keep the design clean at the boundary**: the high-performance core sits behind the same interface used by the rest of the system.`,
  code: r`~~~csharp
// Partitioned single-writer design: each partition owns its state; producers route by key hash
public sealed class PartitionedLimiter
{
    private readonly Channel<(int KeyId, TaskCompletionSource<bool> Reply)>[] _inboxes;
    private readonly long[][] _tokens;                                   // per-partition arrays indexed by local key id
    public PartitionedLimiter(int partitions, int keysPerPartition)
    {
        _inboxes = Enumerable.Range(0, partitions).Select(_ => Channel.CreateBounded<(int, TaskCompletionSource<bool>)>(65_536)).ToArray();
        _tokens = Enumerable.Range(0, partitions).Select(_ => new long[keysPerPartition]).ToArray();
        for (var p = 0; p < partitions; p++) { var part = p; _ = Task.Run(() => RunPartition(part)); }
    }
    public ValueTask<bool> TryAcquireAsync(int keyId)
    {
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _inboxes[keyId % _inboxes.Length].Writer.TryWrite((keyId / _inboxes.Length, tcs));
        return new ValueTask<bool>(tcs.Task);
    }
    private async Task RunPartition(int p)
    {
        await foreach (var (local, reply) in _inboxes[p].Reader.ReadAllAsync())
        {
            ref var t = ref _tokens[p][local];                            // single writer: no locks
            if (t > 0) { t--; reply.SetResult(true); } else reply.SetResult(false);
        }
    }
}
~~~`,
  pts: [r`Partition state by key with single-writer ownership.`, r`Eliminate allocations in hot paths.`, r`Arrays of structs and integer keys for locality.`, r`Batch to amortise synchronisation.`, r`Measure against per-operation budgets; keep a clean boundary.`],
  ex: r`A partitioned single-writer rate limiter reached 4 million checks per second on 16 cores where a locked dictionary peaked at 600,000.`,
  fu: [r`How do you rebalance partitions?`],
  pit: [r`Optimising with unsafe code before removing contention.`] },

{ id: 'q43', level: 'Principal', tags: ['mentoring', 'lld'],
  q: r`How do you coach engineers to produce better low-level designs in day-to-day work, not just interviews?`,
  a: r`- **Design before code for non-trivial features**: a one-page design note with responsibilities, class sketch, state machine, concurrency and test plan; reviewed in 20 minutes.
- **Pair on the hard parts** (invariants, concurrency) rather than reviewing after the fact.
- **Use real incidents** as LLD case studies (race conditions, missing states).
- **Katas** with evolving requirements (add a rule each iteration) to practise extensibility.
- **Review checklist**: invariants in the domain? states explicit? concurrency handled? time injected? result types? tests for illegal transitions?
- **Show alternatives**: present two designs and discuss trade-offs.
- **Celebrate simplicity**: reward deleting unnecessary abstractions.`,
  code: r`~~~text
Design note template (one page)
Problem + use cases:
Entities and responsibilities:
State machine (diagram):
Invariants and where they are enforced:
Concurrency: shared state, mechanism, failure while holding:
Variation points (what will change):
Test plan: invariants, illegal transitions, concurrency, time:
Not doing now (and trigger to add):
~~~`,
  pts: [r`Lightweight design notes before non-trivial features.`, r`Pair on invariants and concurrency.`, r`Turn incidents into case studies.`, r`Practise with evolving-requirement katas.`, r`Use a review checklist and reward simplicity.`],
  ex: r`One-page design notes cut rework on complex features noticeably; reviewers caught missing states before code existed.`,
  fu: [r`How do you stop design notes becoming bureaucracy?`],
  pit: [r`Big design documents for small features.`] },

{ id: 'q44', level: 'Principal', tags: ['interview-scenario', 'cache'],
  q: r`LLD: design a multi-tenant configuration service client library (typed settings, hot reload, safe defaults, validation).`,
  a: r`### Requirements
Typed configuration per service and tenant; hot reload without restarts; validation before activation; safe fallback on failure; audit of changes; low-latency reads.

### Classes
- {{ConfigSnapshot}}: immutable, versioned settings (dictionary of typed sections) per tenant.
- {{IConfigSource}}: remote store (polling with ETags or streaming); {{FileSource}} for local fallback.
- {{ConfigValidator}}: schema and business validation; invalid updates rejected and alerted.
- {{ConfigProvider}}: holds the current snapshot (atomic reference swap), exposes {{Get<T>(tenant)}}, raises change notifications.
- {{IOptionsMonitor<T>}} integration for .NET services.

### Behaviour
Start with last-known-good from disk cache; refresh in background; validate then swap atomically; never apply partially; keep previous snapshot for rollback; metrics on version and refresh failures.`,
  code: r`~~~csharp
public sealed record ConfigSnapshot(long Version, FrozenDictionary<string, JsonElement> Sections);
public sealed class ConfigProvider(IConfigSource remote, ILastKnownGoodStore lkg, IConfigValidator validator, ILogger<ConfigProvider> log) : BackgroundService
{
    private ConfigSnapshot _current = lkg.Load();                                       // start with last known good
    public T Get<T>(string section) => Volatile.Read(ref _current).Sections[section].Deserialize<T>()!;
    public event Action<ConfigSnapshot>? Changed;
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        while (await timer.WaitForNextTickAsync(ct))
        {
            try
            {
                var next = await remote.FetchIfNewerAsync(Volatile.Read(ref _current).Version, ct);
                if (next is null) continue;
                var errors = validator.Validate(next);
                if (errors.Count > 0) { log.LogError("Rejected config v{Version}: {Errors}", next.Version, errors); continue; }
                Interlocked.Exchange(ref _current, next); lkg.Save(next); Changed?.Invoke(next);   // atomic, whole snapshot
            }
            catch (Exception ex) { log.LogWarning(ex, "Config refresh failed; keeping v{Version}", _current.Version); }
        }
    }
}
~~~`,
  pts: [r`Immutable, versioned snapshots swapped atomically.`, r`Validate before activation; never apply partially.`, r`Start from last-known-good; keep serving on refresh failures.`, r`Change notifications and IOptionsMonitor integration.`, r`Metrics and audit of versions.`],
  ex: r`A bad configuration push (malformed JSON) was rejected by the client validator, so 200 services kept running on the previous version instead of crashing.`,
  fu: [r`How do you roll out configuration progressively?`],
  pit: [r`Applying config keys one by one, exposing half-updated state.`] },

{ id: 'q45', level: 'Principal', tags: ['security', 'lld'],
  q: r`How do you build security into low-level design (authorisation in the domain, secrets, input handling)?`,
  a: r`- **Authorisation close to the data**: domain methods or application services check the actor's permissions on the specific object (ownership, limits), not only at the controller.
- **Value objects that validate** at construction (parse, don't validate): {{Iban}}, {{Email}}, {{Amount}} with limits.
- **Least-privilege interfaces**: read-only interfaces for components that should not mutate.
- **No secrets in objects that get logged**: wrap secrets in types with redacted {{ToString}}; use secret providers via DI.
- **Immutable audit events** for sensitive operations, emitted by the domain.
- **Safe defaults**: deny unless explicitly allowed; explicit state machines prevent skipping steps (approval before release).
- **Avoid deserialising untrusted input into domain entities** (over-posting); map DTOs explicitly.
- **Constant-time comparisons** for secrets and signatures.`,
  code: r`~~~csharp
public sealed class Payment
{
    public void Release(Actor actor)
    {
        if (Status != PaymentStatus.Approved) throw new InvalidOperationException("Not approved");     // cannot skip approval
        if (!actor.Can(Permission.ReleasePayments) || Amount > actor.ReleaseLimit) throw new ForbiddenException();
        if (actor.Id == CreatedBy) throw new SegregationOfDutiesException();
        Status = PaymentStatus.Released;
        Raise(new PaymentReleased(Id, actor.Id, DateTimeOffset.UtcNow));                               // audit event
    }
}
public readonly record struct ApiSecret(string Value) { public override string ToString() => "***redacted***"; }
~~~`,
  pts: [r`Authorise on the specific object in the domain or application layer.`, r`Validating value objects reject bad input at construction.`, r`State machines prevent skipped steps.`, r`Redact secrets in types; never log them.`, r`Emit immutable audit events; map DTOs explicitly.`],
  ex: r`Moving release-limit checks into the Payment aggregate closed a gap where a batch endpoint bypassed the controller-level check.`,
  fu: [r`What is the confused deputy problem in LLD?`],
  pit: [r`Authorisation only in controllers while batch jobs call the domain directly.`] },

{ id: 'q46', level: 'Principal', tags: ['interview-scenario', 'logging'],
  q: r`LLD: design an audit-log component that is tamper-evident and guaranteed not to lose entries.`,
  a: r`### Requirements
Every sensitive action recorded (who, what, when, before/after, request id); no loss even if downstream logging fails; tamper evidence; queryable; retention policies.

### Design
- {{AuditEvent}} record (immutable) with actor, action, resource, outcome, timestamp, correlation id, data hashes (not raw sensitive data).
- **Write in the same transaction** as the business change (audit table or outbox), so audit and action commit together; asynchronous shipping to a central immutable store (WORM storage, append-only database, SIEM).
- **Hash chaining**: each event stores the hash of the previous event in its stream (per tenant/day); periodic anchoring of the chain head to an external system makes tampering detectable.
- **Integrity verification job** recomputes chains.
- **Access controls**: write-only for applications, read for auditors; no update/delete.
- **Retention** by regulation with legal holds.`,
  code: r`~~~csharp
public sealed record AuditEvent(Guid Id, string Stream, long Sequence, string Actor, string Action, string Resource,
                                string Outcome, DateTimeOffset At, string CorrelationId, string PayloadHash, string PrevHash)
{
    public string Hash => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        string.Join('|', Id, Stream, Sequence, Actor, Action, Resource, Outcome, At.ToString("O"), CorrelationId, PayloadHash, PrevHash))));
}
public sealed class AuditWriter(AppDb db)
{
    public async Task AppendAsync(string stream, string actor, string action, string resource, string outcome, object payload, string correlationId, CancellationToken ct)
    {
        var last = await db.Audit.Where(a => a.Stream == stream).OrderByDescending(a => a.Sequence).FirstOrDefaultAsync(ct);   // within the business transaction
        var e = new AuditEvent(Guid.CreateVersion7(), stream, (last?.Sequence ?? 0) + 1, actor, action, resource, outcome, DateTimeOffset.UtcNow,
            correlationId, Hashing.Sha256Json(payload), last?.Hash ?? "GENESIS");
        db.Audit.Add(e);                       // unique (Stream, Sequence) prevents forks under concurrency
    }
}
~~~`,
  pts: [r`Write audit events in the same transaction as the action.`, r`Ship asynchronously to immutable central storage.`, r`Hash-chain events and anchor chain heads externally.`, r`Verify integrity periodically.`, r`Write-only access for apps; retention and legal holds.`],
  ex: r`A hash-chain verification job detected a manual database edit to a limit-change record during an internal audit.`,
  fu: [r`How do you avoid contention on the per-stream sequence?`],
  pit: [r`Fire-and-forget audit logging that silently drops on errors.`] },

{ id: 'q47', level: 'Principal', tags: ['generic-design'],
  q: r`How do you decide between generic, reusable designs and specific, simple ones in LLD?`,
  a: r`- **Rule of three**: write specific code first; generalise when you see the third concrete case and know what actually varies.
- **Cost of generality**: more parameters, more abstractions, harder debugging, slower onboarding; generic frameworks often fit no case perfectly.
- **Where generic pays off**: genuine platform needs used by many teams (resilience, outbox, auditing, ledger posting), with a clear owner and versioning.
- **Specific code wins** for business logic unique to one domain; duplication across bounded contexts is often healthier than a shared abstraction that couples them.
- **Design for replaceability rather than generality**: clean boundaries make it easy to generalise later.

In interviews, say explicitly which parts you keep specific and which are worth generalising, and why.`,
  code: r`~~~csharp
// Specific first: one clear rule
public static decimal LateFee(Invoice i, DateOnly today) => today > i.DueDate ? Math.Min(i.Amount * 0.02m, 25m) : 0m;

// Generalise only when three products need different fee rules and the variation is clear
public interface ILateFeePolicy { decimal Fee(Invoice i, DateOnly today); }
public sealed record PercentCapped(decimal Pct, decimal Cap) : ILateFeePolicy
{ public decimal Fee(Invoice i, DateOnly t) => t > i.DueDate ? Math.Min(i.Amount * Pct, Cap) : 0m; }
public sealed record FlatPerDay(decimal PerDay, int GraceDays) : ILateFeePolicy
{ public decimal Fee(Invoice i, DateOnly t) => Math.Max(0, t.DayNumber - i.DueDate.DayNumber - GraceDays) * PerDay; }
~~~`,
  pts: [r`Write specific code first; generalise on the third real case.`, r`Generality has costs in complexity and onboarding.`, r`Platform concerns used by many teams justify generic designs.`, r`Duplication across bounded contexts can beat shared abstractions.`, r`Design for replaceability rather than speculative generality.`],
  ex: r`A "generic workflow engine" built for one approval flow became a maintenance burden; later teams used a simple state machine per domain instead.`,
  fu: [r`How do you retire an over-generic framework?`],
  pit: [r`Building a framework before the second use case exists.`] },

{ id: 'q48', level: 'Principal', tags: ['interview-scenario', 'stream-processing'],
  q: r`LLD: design a pluggable data-import pipeline (CSV, Excel, JSON, bank statement formats) with validation, transformation and error reporting.`,
  a: r`### Stages
1. {{ISourceReader}} per format (streaming rows, not loading files in memory).
2. {{IRowMapper<T>}} maps raw rows to typed records (format-specific mapping profiles as data).
3. {{IValidator<T>}} chain: field-level and cross-field rules, collecting all errors per row.
4. {{ITransformer<T>}} enrichments (FX conversion, reference-data lookups).
5. {{ISink<T>}} writes valid rows in batches (bulk insert), idempotent via deterministic row ids.
6. {{ImportReport}}: counts, errors with row numbers and reasons, downloadable error file.

### Design concerns
Streaming with bounded memory; partial success policy (reject whole file vs accept valid rows); idempotent re-runs; progress reporting; pluggable formats registered by key; security (file size limits, formula injection in CSV exports, malware scanning).`,
  code: r`~~~csharp
public interface ISourceReader { string Format { get; } IAsyncEnumerable<RawRow> ReadAsync(Stream s, CancellationToken ct); }
public interface IRowMapper<T> { Result<T> Map(RawRow row); }
public interface IValidator<T> { IEnumerable<string> Validate(T item); }
public interface ISink<T> { Task WriteBatchAsync(IReadOnlyList<T> batch, CancellationToken ct); }
public sealed class ImportPipeline<T>(IEnumerable<ISourceReader> readers, IRowMapper<T> mapper, IEnumerable<IValidator<T>> validators, ISink<T> sink)
{
    public async Task<ImportReport> RunAsync(string format, Stream file, CancellationToken ct)
    {
        var report = new ImportReport(); var batch = new List<T>(1000);
        await foreach (var raw in readers.Single(r => r.Format == format).ReadAsync(file, ct))
        {
            var mapped = mapper.Map(raw);
            if (!mapped.IsSuccess) { report.Error(raw.LineNumber, mapped.Error); continue; }
            var errors = validators.SelectMany(v => v.Validate(mapped.Value)).ToList();
            if (errors.Count > 0) { report.Error(raw.LineNumber, string.Join("; ", errors)); continue; }
            batch.Add(mapped.Value); report.Accepted++;
            if (batch.Count == 1000) { await sink.WriteBatchAsync(batch, ct); batch.Clear(); }
        }
        if (batch.Count > 0) await sink.WriteBatchAsync(batch, ct);
        return report;
    }
}
~~~`,
  pts: [r`Reader, mapper, validator, transformer and sink stages as strategies.`, r`Stream rows with bounded memory; batch writes.`, r`Collect all errors per row with line numbers.`, r`Idempotent re-runs via deterministic row ids.`, r`Explicit partial-success policy and file security checks.`],
  ex: r`A treasury import pipeline added three new bank statement formats by writing readers and mapping profiles only.`,
  fu: [r`How do you handle a 5 GB file?`],
  pit: [r`Loading entire files into memory before validation.`] },

{ id: 'q49', level: 'Principal', tags: ['trade-offs', 'communication'],
  q: r`How do you communicate an LLD to stakeholders (other teams, reviewers, product) effectively?`,
  a: r`- **Start with the problem and invariants**, not class lists: "seats must never be double-sold; holds expire in 10 minutes."
- **Diagrams at the right level**: a state diagram and one sequence diagram usually explain more than a full class diagram.
- **Show the variation points** and how a likely change would be implemented.
- **State trade-offs and non-goals** explicitly.
- **Concrete examples**: walk a scenario with real values, including a failure (payment declined, hold expired).
- **Tailor**: product cares about behaviour and edge cases; reviewers about invariants, concurrency and testing; other teams about contracts and events.
- **Keep it living**: diagrams as code next to the code; ADRs for decisions.`,
  code: r`~~~text
Design review outline (15 minutes)
1. Problem + invariants (2 min)
2. State diagram of a booking (3 min)
3. Sequence: happy path + payment declined + hold expired (5 min)
4. Variation points: pricing, seat allocation (2 min)
5. Trade-offs, non-goals, open questions (3 min)
~~~`,
  pts: [r`Lead with the problem and invariants.`, r`State and sequence diagrams before full class diagrams.`, r`Show variation points and one likely change.`, r`Walk a failure scenario with real values.`, r`Tailor to the audience; keep diagrams as code.`],
  ex: r`A 15-minute review structured this way surfaced a product requirement (group bookings) that changed the hold model before coding started.`,
  fu: [r`How much of the design should be written down?`],
  pit: [r`Presenting a 40-class UML diagram first.`] },

{ id: 'q50', level: 'Principal', tags: ['summary'],
  q: r`Summarise your approach to low-level design as a Principal Engineer.`,
  a: r`"I design objects around invariants and likely change:

- Clarify use cases and constraints, then assign behaviour to the objects that own the data.
- Make state explicit with state machines and value objects so illegal states cannot occur.
- Put interfaces only at real variation points, and prefer composition and data over inheritance.
- Handle concurrency and failure explicitly: atomic operations, holds with expiry, idempotency, unknown outcomes.
- Keep it testable: injected time and I/O, property and concurrency tests.
- Bridge to production: persistence with optimistic concurrency, events via outbox, observability.
- Stay simple, name what I am not building, and communicate with state and sequence diagrams."`,
  code: r`~~~csharp
// The approach in a few lines: value object, state machine, atomic claim, explicit outcome
public readonly record struct Money(decimal Amount, string Currency);
public enum HoldState { Available, Held, Sold }
public sealed class Seat
{
    private int _state;                                                       // 0 Available, 1 Held, 2 Sold
    public bool TryHold() => Interlocked.CompareExchange(ref _state, 1, 0) == 0;
    public bool TryConfirm() => Interlocked.CompareExchange(ref _state, 2, 1) == 1;
    public void Release() => Interlocked.CompareExchange(ref _state, 0, 1);
}
~~~`,
  pts: [r`Design around invariants and likely change.`, r`Explicit states and value objects.`, r`Interfaces only at real variation points.`, r`Explicit concurrency, idempotency and failure handling.`, r`Testable, production-ready, simple, well communicated.`],
  ex: r`This approach, demonstrated on one well-chosen example with a failure path, consistently scores strongly in LLD rounds.`,
  fu: [r`Which LLD problem best shows your strengths?`],
  pit: [r`Treating LLD as drawing classes for every noun.`] }
],
cheat: r`### Method
Requirements -> entities and responsibilities -> relationships + interfaces at variation points -> class + sequence diagrams -> state machine + concurrency -> code the hard part -> extensibility, tests, trade-offs.

### Modelling rules
Behaviour lives with the data · value objects for money, ids, quantities · state machines for lifecycles · composition over inheritance (inherit only true subtypes like chess pieces) · reference other aggregates by id · result types for business outcomes · inject TimeProvider and I/O ports.

### Concurrency toolkit
CAS (Interlocked) for single fields · lock per aggregate, consistent lock order for many · holds with expiry · idempotency keys · single-writer partitions for high throughput · DB conditional updates / row versions when persisted · stress tests asserting invariants.

### Classic LLD problems
Parking lot (size as data, atomic spot claim) · vending machine (State) · elevator (LOOK + dispatcher strategy) · library (Book vs BookCopy) · Splitwise (minor units, greedy settle-up) · ATM (authorise, dispense, confirm/reverse) · LRU/TTL cache · rate limiter · pub/sub bus · bank account (policies, lock order) · order book (price levels, FIFO) · booking (all-or-nothing holds) · inventory (OnHand - Reserved) · coupons (atomic redemption) · rule engine (expression tree, versioned) · approvals (four-eyes, subject hash) · ledger (zero-sum journals, reversals) · audit log (same transaction, hash chain).

### Say this
"Size is data, not a subclass." "The invariant lives in the aggregate." "Holds expire." "Unknown outcomes are a state." "Here is what I am not building, and the trigger to add it."`
});
})(String.raw);
