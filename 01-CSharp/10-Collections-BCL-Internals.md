# Module — C# Advanced: Collections & BCL Internals

> Domain: C# | Level: Beginner → Expert | Prerequisite: [[01-CLR-JIT-GC-Memory-Management]] (allocation, LOH), [[06-Generics-Variance]] (generic instantiation, constraints), [[09-Threading-Concurrency-Memory-Model]] (concurrent collections)

---

## 1. Topic Description

### Definition

The BCL collection types are not interchangeable containers — each is a specific data structure with a specific cost model, memory layout and thread-safety contract, and choosing among them is a design decision rather than a matter of taste. `List<T>` is a growable array; `Dictionary<TKey,TValue>` is an open-addressing-with-chaining hash table over a bucket array; `SortedDictionary` is a tree while `SortedList` is a pair of arrays. Understanding the *internals* — growth and resizing, hashing and collisions, enumeration and versioning, and where each allocates — is what lets you predict behaviour at a million items rather than discovering it there.

### Core sub-concepts

- **Interface hierarchy** — `IEnumerable<T>`, `ICollection<T>`, `IList<T>`, `IReadOnlyList<T>`, `ISet<T>`, `IDictionary<K,V>`, and what each communicates about cost and mutability.
- **`List<T>` internals** — backing array, capacity versus count, doubling growth, `EnsureCapacity`, `TrimExcess`, and the LOH threshold for large element counts.
- **`Dictionary<K,V>` internals** — bucket array, entry array, hash code to bucket mapping, collision chaining, resize on load, and insertion-order enumeration as an implementation detail rather than a guarantee.
- **Hashing contracts** — `GetHashCode`/`Equals` consistency, hash distribution and clustering, `IEqualityComparer<T>`, `StringComparer` and ordinal versus culture-aware comparison.
- **`HashSet<T>` and set operations** — `UnionWith`, `IntersectWith`, `ExceptWith`, and their asymptotic advantages over LINQ equivalents.
- **Sorted structures** — `SortedDictionary` (red-black tree, O(log n) insert) versus `SortedList` (arrays, O(n) insert, O(log n) lookup, lower memory, better cache locality).
- **Queues, stacks and linked lists** — `Queue<T>`/`Stack<T>` as circular and simple arrays, `LinkedList<T>` and why it is almost always the wrong choice on modern hardware.
- **`ArraySegment<T>`, `Span<T>` and arrays** — the difference between a collection and a view; multi-dimensional versus jagged arrays and their layout.
- **Enumeration mechanics** — the enumerator as a struct for concrete types versus boxed via the interface, the version field and `InvalidOperationException` on modification during enumeration.
- **Capacity, allocation and growth** — pre-sizing to avoid repeated array allocation and copying; the quadratic behaviour of naive growth patterns.
- **Concurrent collections** — `ConcurrentDictionary` striping, `ConcurrentQueue`/`Stack`/`Bag` segment behaviour, `BlockingCollection`, and their weaker enumeration semantics (moment-in-time snapshots).
- **Immutable collections** — `ImmutableArray<T>` (array wrapper, cheap reads, O(n) mutation) versus `ImmutableList<T>` (balanced tree, O(log n) mutation, slower reads), and builders.
- **Frozen collections** — `FrozenDictionary`/`FrozenSet` for build-once, read-many lookup tables.
- **Comparison and ordering** — `IComparable<T>`, `IComparer<T>`, sort stability, and consistency between equality and ordering.
- **Choosing a collection** — asymptotic cost, memory overhead per element, cache locality, allocation profile and thread-safety requirements.

### Where it fits

Collections sit between the language features covered elsewhere in this folder and every layer above: they are what LINQ operates over, what the GC's allocation profile is largely made of, and what concurrency primitives are usually protecting. The relationships are concrete — a `Dictionary` resize is an LOH allocation once it grows past the threshold, the choice between `IEnumerable<T>` and `IReadOnlyList<T>` as a return type determines whether multiple enumeration is free or catastrophic, and a collection shared between threads is exactly the shared mutable state that `09` is about. Upward, collection choice determines API shape, memory footprint and the complexity class of hot code paths.

### Why it matters at scale

Collection mistakes are asymptotic, so they are invisible in development and severe in production. A `List<T>.Contains` inside a loop is O(n²) — instant on a hundred items, and a hung request on a hundred thousand, with no error and no obvious culprit in a profiler beyond "this method is slow". Repeated `Insert(0, item)` or `Remove` on a large list shifts the whole array on every call, producing the same shape. A `Dictionary` keyed by a type with a poor `GetHashCode` — or one that returns a constant — degrades to a linked-list scan while looking like an O(1) lookup in the code. And at the memory level, a `Dictionary<int, int>` with a million entries costs far more than eight megabytes because of per-entry overhead, so capacity planning based on payload size is consistently wrong.

### Common pitfalls / anti-patterns

- **`List<T>.Contains` or `Any()` inside a loop over another collection** — an accidental O(n²) join; converting the inner collection to a `HashSet<T>` makes it O(n) and is usually a one-line fix.
- **Not pre-sizing a collection whose final size is known** — `List<T>` doubles its backing array and copies on each growth, so building a million-element list allocates roughly twenty arrays and copies most elements repeatedly; `new List<T>(capacity)` eliminates it.
- **A type with a mutable `GetHashCode` used as a dictionary key** — mutating a participating field after insertion moves the entry's logical bucket, so the key is present but unreachable, and may also be found by an unrelated lookup.
- **Overriding `Equals` without `GetHashCode` (or vice versa)** — the collection silently misbehaves rather than failing; items are inserted and then not found, which is diagnosed as a data bug rather than a contract violation.
- **Relying on `Dictionary` enumeration order** — insertion order is an implementation artefact, not a guarantee, and changes when the dictionary resizes or entries are removed; code depending on it breaks non-deterministically.
- **Using `LinkedList<T>` for "fast insertion"** — the asymptotics look better but every node is a separate heap allocation with terrible cache locality, so an array-backed `List<T>` beats it in practice for almost all real sizes.
- **Sharing a `List<T>` or `Dictionary<K,V>` across threads with "only one writer"** — these types are not safe for concurrent read and write; a resize during enumeration can produce corrupted reads or infinite loops, not merely stale data.
- **`ConcurrentDictionary.Count` or enumeration used for logic** — both take snapshots and are relatively expensive, and any decision based on the count is racy by the time it is acted on.
- **Returning `IEnumerable<T>` from a method that has already materialised its data** — callers cannot tell whether enumerating twice is free or re-runs a query, so the return type communicates nothing.
- **Building an `ImmutableArray<T>` item by item** — each add copies the entire array, producing quadratic behaviour where a builder-then-freeze is linear.

---

## 2. Beginner (10 Q&A)

**Q1. How many array allocations does this cause?**
```csharp
var list = new List<int>();
for (int i = 0; i < 1_000_000; i++) list.Add(i);
```
**A:** Around twenty. `List<T>` doubles its backing array when full and copies everything across, so you allocate 4, 8, 16 … up to over a million elements, copying most of them repeatedly. Once the array passes 85,000 bytes each new one lands on the Large Object Heap. `new List<int>(1_000_000)` eliminates all of it — one allocation, no copying.
*Follow-up: `Count` is 10 and `Capacity` is 1,024 after removals. Does that matter?*

**Q2. What's wrong here?**
```csharp
class Point { public int X, Y;
    public override bool Equals(object o) => o is Point p && p.X == X && p.Y == Y; }
var set = new HashSet<Point>();
set.Add(new Point { X = 1, Y = 2 });
Console.WriteLine(set.Contains(new Point { X = 1, Y = 2 }));
```
**A:** Prints `False`. `Equals` was overridden but `GetHashCode` wasn't, so the two points hash to different buckets and the lookup never even reaches the equality check. Nothing throws — the collection just behaves as though the item isn't there, which gets diagnosed as a data bug. Equal objects must return equal hash codes; that's the contract every hash-based collection depends on.
*Follow-up: You fix `GetHashCode`, then someone mutates `X` after insertion. What now?*

**Q3. What's the complexity of this, and how would you fix it?**
```csharp
foreach (var order in orders)          // 50,000
    if (blockedCustomers.Contains(order.CustomerId))   // List<int>, 10,000
        Reject(order);
```
**A:** O(n·m) — `List<T>.Contains` is a linear scan, so that's up to 500 million comparisons. Convert `blockedCustomers` to a `HashSet<int>` and `Contains` becomes O(1), making the whole thing O(n+m). This is the single most common accidental-quadratic shape in .NET: fine on hundreds of items, a hung request on tens of thousands, with no error and nothing obviously wrong in the code.
*Follow-up: What if you need both ordering and fast membership?*

**Q4. How does `Dictionary<K,V>` find an item?**
**A:** Hashes the key, maps it to a bucket index, then walks a chain of entries in that bucket comparing keys with `Equals` until it matches. O(1) *on average*, and that average depends entirely on the hash distributing keys evenly — a poor or constant hash puts everything in one bucket and turns lookup into a linear scan while the code still reads like a hash lookup. When the load factor is exceeded it resizes and rehashes every entry.
*Follow-up: How would you spot a constant `GetHashCode` in production?*

**Q5. Can you rely on `Dictionary` enumeration order?**
**A:** No. Insertion order happens to be preserved in many cases, but it's an implementation artefact, not a guarantee — it changes when the dictionary resizes or when entries are removed and slots are reused. Code depending on it breaks non-deterministically after a data-volume change, which is a miserable bug to chase. If order matters, use an ordered structure or sort explicitly.
*Follow-up: Which collection would you use if you need insertion order and fast lookup?*

**Q6. `SortedDictionary` or `SortedList`?**
**A:** `SortedDictionary` is a red-black tree — O(log n) insert, delete and lookup, one allocation per node, poor cache locality. `SortedList` is two parallel arrays — O(log n) lookup by binary search, but O(n) insert and delete because elements shift, with much lower memory and excellent locality. So `SortedList` wins when it's built once and read heavily; `SortedDictionary` wins when inserts and removals are frequent and interleaved.
*Follow-up: 50 items, sorted, frequent inserts. Does the asymptotic analysis still decide it?*

**Q7. Why is `LinkedList<T>` almost always the wrong choice?**
**A:** Its advantage is O(1) insertion given a node reference — but getting that reference means traversing, and every node is a separate heap object holding two pointers plus the value. On modern hardware, sequential array access is dramatically faster than pointer-chasing because of cache prefetching, so `List<T>` beats `LinkedList<T>` even where the asymptotics favour the list. It also allocates far more and adds GC pressure. It earns its place only when you hold node references and splice frequently.
*Follow-up: You need efficient add and remove at both ends. What do you use?*

**Q8. Why does this throw, and what are the fixes?**
```csharp
foreach (var item in list)
    if (item.Expired) list.Remove(item);
```
**A:** Collections keep a version counter that increments on structural modification, and the enumerator checks it on each `MoveNext` — so this throws `InvalidOperationException`. That's deliberate fail-fast: continuing would skip or repeat elements. Fixes: iterate a copy, collect what to remove and act afterwards, iterate backwards by index, or use `RemoveAll` with a predicate, which is the cleanest here.
*Follow-up: Why does removing inside a `for` loop by index skip elements?*

**Q9. What does `IReadOnlyList<T>` actually guarantee?**
**A:** Only that the holder of *that reference* can't mutate through it. If it's backed by a `List<T>` someone else still references, the contents can change underneath you — including during enumeration. So it communicates intent and prevents accidental mutation, but it's not an immutability or thread-safety guarantee; `ImmutableArray<T>` is what gives you that. Confusing the two produces concurrency bugs in code that looks defensive.
*Follow-up: How do you return a genuinely safe snapshot from a property?*

**Q10. What are `FrozenDictionary` and `FrozenSet` for?**
**A:** Build-once, read-many lookup tables. They cost more to construct — the construction analyses the keys and picks an optimised lookup strategy — in exchange for faster reads than the mutable equivalents. They fit things populated at startup and read for the process lifetime: routing tables, config maps, permission sets. Wrong choice for anything that changes, since there's no cheap mutation.
*Follow-up: How would you decide whether the construction cost is worth it?*

---

## 3. Intermediate (10 Q&A)

**Q1. A method is instant in testing and takes minutes in production, with no error. Where do you look first?**
**A:** Accidental quadratic behaviour — that profile is its signature. Usual forms: a `Contains`/`Any`/`FirstOrDefault` on a list inside a loop over another collection; repeated `Insert(0, …)` or `Remove` on a large list; string concatenation in a loop; building an immutable collection item by item. A profiler shows the method as hot but not why, so reading the loop bodies for nested linear operations is faster than instrumenting.
*Follow-up: The nested lookup is on a property rather than the whole object. Does that change the fix?*

**Q2. How do you choose the right collection?**
**A:** Enumerate the operations and their frequencies first, then match against the cost model — membership testing pushes toward a hash set, ordered iteration toward a sorted structure, index access toward a list, FIFO toward a queue. Then apply the secondary considerations that often dominate at real sizes: memory overhead per element, cache locality, allocation profile, and whether it'll be shared across threads. The failure I see most is choosing by habit — `List<T>` for everything — and discovering the mismatch when the data grows.
*Follow-up: "Ordered, unique, fast lookup, frequent inserts." What do you build?*

**Q3. What does a `Dictionary<int,int>` with a million entries actually cost?**
**A:** Far more than the 8 MB the payload suggests. Each entry carries a hash code, a next-index for chaining, the key and the value, and there's a separate bucket array on top — so several times the nominal size. Resizing allocates a new pair of arrays and rehashes everything, and past a threshold those arrays land on the LOH. This is why capacity planning from payload size is consistently wrong, and why pre-sizing a large dictionary matters for more than speed.
*Follow-up: You need a memory-efficient map of a million integers. Options?*

**Q4. When would you pass a custom `IEqualityComparer<T>`?**
**A:** When you need equality different from the type's own — case-insensitive or ordinal string keys, comparing entities by a business key rather than identity, keying on a subset of fields. It's the right alternative to overriding `Equals` on a type you don't own or where natural equality is correct for other purposes. For string keys specifically, passing an explicit `StringComparer` matters for both correctness and speed: the ordinal comparers are substantially faster than culture-aware ones, and the default isn't always what people assume.
*Follow-up: A dictionary keyed by user strings behaves differently on a Turkish-locale server. What's happening?*

**Q5. How do concurrent collections differ semantically from the ordinary ones?**
**A:** Individual operations are thread-safe but the collection-level semantics weaken. Enumeration returns a moment-in-time snapshot rather than throwing on modification. `Count` is comparatively expensive and immediately stale — `ConcurrentDictionary` is striped internally, so counting means consulting every stripe. And any composite operation you write yourself is still a race. The practical implication: any decision made from `Count` or from an enumeration is based on data that was true at some point and may not be now.
*Follow-up: You need to process every item in a `ConcurrentDictionary` exactly once. How?*

**Q6. How does collection choice affect GC behaviour?**
**A:** Through allocation count and survival. Node-based structures allocate one object per element, so a large `LinkedList` or `SortedDictionary` creates hundreds of thousands of small objects the collector must trace on every collection. Array-backed structures allocate one large object — cheaper to trace, but past 85 KB it's on the LOH, swept rather than compacted, and can fragment. Repeated growth compounds it by allocating and abandoning successive arrays. Pre-sizing and preferring array-backed structures for large data both reduce GC pressure meaningfully.
*Follow-up: A cache holds a million small objects in a dictionary. What's the GC consequence?*

**Q7. What's the right return type for a method producing a collection?**
**A:** One that states the consumption contract. `IReadOnlyList<T>` says "materialised, safe to enumerate repeatedly, don't mutate". `IEnumerable<T>` says "possibly lazy, possibly expensive to enumerate twice, possibly tied to a resource's lifetime" — honest for a streaming source, misleading for an already-materialised list. `IAsyncEnumerable<T>` says "streams, consume within scope". The failure is defaulting to `IEnumerable<T>` everywhere, which forces every caller to guess whether `.Count()` is free or re-runs a database query.
*Follow-up: You return `IReadOnlyList<T>` and the caller casts back to `List<T>` and mutates it. Prevention?*

**Q8. How would you optimise a hot path that builds and discards collections per request?**
**A:** First check whether the collection is needed at all — a `Count`, an `Any`, or an aggregate often doesn't require materialising anything. Then pre-size, which is the biggest single win for one constructor argument. Then consider pooling the backing storage via `ArrayPool<T>` if they're large, and returning a `Span<T>` or a struct enumerator to avoid interface boxing. Apply in that order and stop when the profile flattens, because the later steps trade real readability for diminishing returns.
*Follow-up: Why does returning `IEnumerable<T>` from a hot method allocate where returning `List<T>` might not?*

**Q9. What are the trade-offs of exposing a collection as a property?**
**A:** Exposing a mutable collection hands callers the ability to change your object's state without going through anything that could enforce invariants — the encapsulation is simply gone. A read-only wrapper prevents mutation through that reference but still shares the underlying instance, so it can change under an enumerating caller. A defensive copy is genuinely safe and allocates per access, which matters on a hot path. Usually the right answer is exposing behaviour rather than the collection — `AddItem`, `Items.Count` — so the object keeps control.
*Follow-up: The collection is large and read frequently. Copy, wrap, or expose behaviour?*

**Q10. You need a large collection searchable by several keys. How do you structure it?**
**A:** Multiple index structures over the same objects — a primary collection plus dictionaries mapping each secondary key to the item — which is what a database does and is the right model here. The cost is memory plus the obligation to keep every index consistent on insert, update and delete, which is where bugs live, so the mutation path should be encapsulated in one type rather than spread around. If it grows past a few indexes or needs range queries and ordering, that's a signal the data belongs in an actual database rather than in process memory.
*Follow-up: One of the secondary keys isn't unique. How does that change it?*

---

## 4. Expert / Architect (10 Q&A)

**Q1. How do you reason about in-memory structures when the dataset approaches available RAM?**
**A:** The considerations shift from asymptotics to memory layout and GC behaviour. Per-object overhead dominates: a million small objects cost far more in headers, references and tracing than the same data in a few large arrays of value types — and object *count*, not byte count, drives mark cost. So the move is structure-of-arrays rather than array-of-structures, value types over reference types, pre-sized array-backed collections. Beyond a certain live-set size the honest answer is that a tracing collector is the wrong tool and the data belongs off-heap or out of process.
*Follow-up: At roughly what live-set size would you start that conversation, and on what evidence?*

**Q2. How do you set collection-usage standards across a large codebase?**
**A:** Focus on the small number of rules that prevent asymptotic disasters, since those have catastrophic rather than marginal cost: no linear lookups inside loops, pre-size when the count is known, return types that state their consumption contract, no sharing of non-concurrent collections across threads. Deliver as analyzers and reviewed exemplars rather than a style document. I'd deliberately *not* standardise on a preferred collection type, because the right choice is workload-dependent and a blanket rule produces the wrong structure somewhere. Make the expensive mistakes hard; leave the easy decisions alone.
*Follow-up: Which of those would you enforce with an analyzer, and which needs human judgement?*

**Q3. How would you design an in-memory cache's data structure for a high-throughput service?**
**A:** From the access pattern and the eviction policy together, because they're coupled: an LRU needs a hash map for lookup *and* an ordering structure for recency, and naive implementations serialise on the ordering structure and destroy concurrency. `ConcurrentDictionary` plus an approximate or sampled eviction strategy usually beats an exact LRU under contention, because exactness costs a global lock. Bound it explicitly — an unbounded cache is a memory leak with a friendly name — and consider making entries immutable so readers need no synchronisation at all.
*Follow-up: Your exact-LRU implementation's lock is now the throughput ceiling. What replaces it?*

**Q4. What's the architectural significance of collection choice in a public API?**
**A:** The type you expose is a contract you can't change without breaking consumers, and it constrains their code as much as yours. Returning a concrete `List<T>` permits mutation and locks you into that implementation. Returning `IEnumerable<T>` gives you freedom and forces every consumer to defend against multiple enumeration. `IReadOnlyList<T>` is usually the honest middle for materialised results. Accepting `IEnumerable<T>` as a *parameter* is generally right because it's permissive — but then you mustn't enumerate it twice, and the signature doesn't enforce that.
*Follow-up: You accept `IEnumerable<T>` and need to enumerate twice. What do you do and what do you document?*

**Q5. How do collections interact with serialisation and API contracts?**
**A:** The runtime type leaks into the wire format and into consumer expectations — a `Dictionary` serialises as an object with arbitrary key order, a `HashSet` loses ordering entirely, so a contract quietly depending on order breaks non-deterministically. Interface-typed collection properties complicate deserialisation, and null-versus-empty distinctions cause perennial confusion at boundaries. I'd fix collection shapes explicitly in contract types, prefer arrays or lists on the wire, decide the null-versus-empty convention once for the whole API, and cover it with round-trip contract tests.
*Follow-up: A consumer depends on the order of a serialised dictionary. How do you handle that discovery?*

**Q6. A memory problem traces to collection overhead. How do you approach it?**
**A:** Quantify before acting — measure objects and bytes per collection type from a heap dump, because intuition about which one dominates is usually wrong. Then apply levers in order of leverage: eliminate collections cached but never read, pre-size to remove growth waste, replace node-based structures with array-backed ones, replace reference elements with value types where semantics allow, pool or share where duplicates exist. Structural changes like moving data out of process come last. The point to make to stakeholders is that this is usually a design saving rather than a hardware purchase.
*Follow-up: The dump shows 40% of the heap in one dictionary that's genuinely needed. Now what?*

**Q7. When should data leave in-memory collections entirely?**
**A:** When the live set is large and long-lived, because GC pause cost scales with live objects to trace — a large in-memory index of small objects is pathological for a tracing collector regardless of tuning. Also when it must survive a restart, be shared between instances, or support queries the structure can't serve efficiently. The intermediate option worth trying first is restructuring into few large arrays of value types, which keeps the data in process while cutting object count by orders of magnitude — often that's sufficient and much cheaper than adding a datastore.
*Follow-up: A team wants to add Redis to solve this. When would you push back?*

**Q8. How do you evaluate a proposal to write a custom collection type?**
**A:** Sceptically. The BCL types are heavily optimised, well-tested and understood by everyone who'll maintain the code, so a custom structure is a permanent comprehension and correctness cost. Genuine justifications are a specific access pattern the BCL doesn't serve — a specialised index, a lock-free ring buffer for a measured hot path, a memory layout the standard types can't express. I'd require a benchmark against the standard alternative on realistic data, a thorough test suite including adversarial and concurrent cases, a named owner, and containment behind a small interface so it can be replaced.
*Follow-up: It's 3x faster on a benchmark. What else do you need before approving?*

**Q9. How does collection design change under NativeAOT or trimming?**
**A:** Reflection-based construction and serialisation of collection types can break under trimming, so anything discovering or instantiating generic collections dynamically has to become explicit or source-generated. Generic instantiation over many value types multiplies generated code, so a heavily generic collection layer inflates binary size in a way it didn't under JIT. Conversely the value of pre-sizing and array-backed structures increases, since startup and footprint are usually why AOT was chosen. I'd treat the collection layer as one of the specific areas to audit before committing.
*Follow-up: How would you find dynamic collection instantiation in a large codebase?*

**Q10. What separates an excellent answer from an adequate one when choosing a data structure?**
**A:** An adequate answer names a suitable type and its Big-O. An excellent one enumerates the actual operations and frequencies first, then reasons about constant factors and memory layout as well as asymptotics — knowing `List` beats `LinkedList` in practice, and `SortedList` beats `SortedDictionary` for build-once-read-many. It states the thread-safety contract, the allocation profile, and what happens at ten items and at ten million. And it names the point where the in-memory answer stops being right at all. The distinguishing quality is reasoning about real hardware and real data volumes rather than complexity classes in isolation.
*Follow-up: Given that, what would you ask before choosing a structure for "a cache of user permissions"?*

---
