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

**Q1. What does `List<T>` actually do when it grows?**
**A:** It holds a backing array with a `Capacity` that is usually larger than `Count`. When an add would exceed capacity, it allocates a new array of double the size, copies every existing element, and discards the old one. So building a large list without pre-sizing allocates a sequence of progressively larger arrays and copies most elements several times, and once the array exceeds 85,000 bytes each new one lands on the Large Object Heap. Passing an expected capacity to the constructor eliminates all of it.
*Follow-up: `Count` is 10 and `Capacity` is 1,024 after removals. What do you do, and when does it matter?*

**Q2. How does `Dictionary<K,V>` find an item?**
**A:** It computes the key's hash code, maps it to a bucket index, and follows a chain of entries in that bucket comparing keys with `Equals` until it finds a match. Lookup is O(1) *on average*, and that average depends entirely on the hash function distributing keys evenly — a poor or constant hash puts everything in one bucket and degrades lookup to a linear scan while the code still reads as a hash lookup. When the load factor is exceeded it resizes, rehashing every entry.
*Follow-up: Someone's `GetHashCode` returns a constant. What's the observable behaviour and how would you spot it?*

**Q3. What is the contract between `Equals` and `GetHashCode`, and what breaks if you violate it?**
**A:** Equal objects must produce equal hash codes; unequal objects may collide but ideally do not. Violating it breaks every hash-based collection silently: an item is inserted into the bucket for one hash and looked up in the bucket for another, so it is present in the collection and cannot be found. Nothing throws — the collection simply behaves as though the item is not there, which gets diagnosed as a data problem. Overriding one without the other is the common form of this bug.
*Follow-up: You add `Equals` to a record-like class and tests start failing intermittently in a `HashSet`. What happened?*

**Q4. When would you use `HashSet<T>` over `List<T>`?**
**A:** Whenever membership testing matters. `List<T>.Contains` is a linear scan; `HashSet<T>.Contains` is constant-time on average. The classic transformation is a loop over collection A checking membership in collection B: with a list that is O(n·m), and converting B to a `HashSet` makes it O(n+m). `HashSet<T>` also gives efficient set operations — union, intersection, except — that are dramatically faster than the LINQ equivalents over lists. The trade is that it does not preserve order and cannot hold duplicates.
*Follow-up: You need both ordering and fast membership. What do you use?*

**Q5. `SortedDictionary` versus `SortedList` — what's the actual difference?**
**A:** `SortedDictionary` is a red-black tree: O(log n) insert, delete and lookup, with per-node allocation and poor cache locality. `SortedList` is two parallel arrays: O(log n) lookup by binary search, but O(n) insert and delete because elements shift, with much lower memory overhead and excellent cache locality. So `SortedList` wins when the collection is built once and then read heavily, and `SortedDictionary` wins when insertions and removals are frequent and interleaved with lookups.
*Follow-up: You need sorted order and frequent inserts, and the collection has 50 items. Does the asymptotic analysis still decide it?*

**Q6. Why is `LinkedList<T>` almost always the wrong choice?**
**A:** Its advantage is O(1) insertion and removal given a node reference, but obtaining that reference requires a traversal, and every node is a separate heap object holding two pointers plus the value. On modern hardware, sequential access through an array is dramatically faster than pointer-chasing because of cache prefetching, so `List<T>` outperforms `LinkedList<T>` even for operations where the asymptotics favour the list. It also allocates far more and increases GC pressure. It earns its place only when you hold node references and splice frequently.
*Follow-up: You need a queue with efficient removal from both ends. What do you use?*

**Q7. What happens if you modify a collection while enumerating it?**
**A:** Standard collections maintain a version counter that increments on structural modification, and the enumerator checks it on each `MoveNext`, throwing `InvalidOperationException` if it changed. This is a deliberate fail-fast: continuing would produce undefined results such as skipped or repeated elements. The correct patterns are to iterate over a copy, collect the items to modify and act afterwards, or iterate backwards by index when removing from a list. Concurrent collections behave differently — they enumerate a moment-in-time snapshot instead of throwing.
*Follow-up: Why does removing during a `for` loop by index skip elements, and how do you fix it?*

**Q8. What does `IReadOnlyList<T>` guarantee, and what doesn't it?**
**A:** It guarantees that *the holder of that reference* cannot mutate through it. It does not guarantee the underlying data is immutable: if it is backed by a `List<T>` that someone else still references, the contents can change underneath, including during enumeration. So it communicates intent and prevents accidental mutation, but it is not a thread-safety or immutability guarantee — `ImmutableArray<T>` is what provides that. Confusing the two is a common source of concurrency bugs in code that looks defensive.
*Follow-up: How would you return a genuinely safe snapshot from a property?*

**Q9. What's the difference between `ImmutableArray<T>` and `ImmutableList<T>`?**
**A:** `ImmutableArray<T>` is a thin struct wrapper over an array — reads are as fast as array access with excellent locality, but every mutation copies the entire array, so it is O(n) per change. `ImmutableList<T>` is a balanced tree, so mutations are O(log n) and share structure with the previous version, but reads and enumeration are considerably slower and allocate more. Use the array for build-once, read-many data and the list when you genuinely need incremental persistent updates.
*Follow-up: You must build an `ImmutableArray<T>` of a million items. How do you avoid quadratic behaviour?*

**Q10. What are `FrozenDictionary` and `FrozenSet` for?**
**A:** They are built once, at higher construction cost, in exchange for faster reads than the mutable equivalents — the construction analyses the keys and picks an optimised lookup strategy. They fit lookup tables that are populated at startup and then read for the process lifetime: routing tables, configuration maps, permission sets. They are the wrong choice for anything that changes, since there is no cheap mutation. Recognising them signals awareness that read-only-after-init is a distinct case worth optimising for.
*Follow-up: How would you decide whether the construction cost is worth it?*

---

## 3. Intermediate (10 Q&A)

**Q1. A method is fast in testing and takes minutes in production with no error. Where do you look first?**
**A:** For accidental quadratic behaviour, which is the signature of exactly this profile — fine at hundreds of items, catastrophic at hundreds of thousands, with no exception and no single slow line. The usual forms are a `Contains`/`Any`/`FirstOrDefault` on a list inside a loop over another collection, repeated `Insert(0, …)` or `Remove` on a large list, string concatenation in a loop, or building an immutable collection item by item. A profiler shows the method as hot but not why; reading the loop bodies for nested linear operations is faster than instrumenting.
*Follow-up: The nested lookup is on a property, not the whole object. How does that change the fix?*

**Q2. How do you choose the right collection for a given requirement?**
**A:** By enumerating the operations and their frequencies first, then matching against the cost model — membership testing pushes toward a hash set, ordered iteration toward a sorted structure, index access toward a list, FIFO toward a queue. Then apply the secondary considerations that often dominate at real sizes: memory overhead per element, cache locality, allocation profile, and whether it will be shared across threads. The failure I see most is choosing by name or habit — `List<T>` for everything — and only discovering the mismatch when the data grows.
*Follow-up: The requirements say "ordered, unique, fast lookup, frequent inserts". What do you build?*

**Q3. What are the real memory costs of a `Dictionary<K,V>`?**
**A:** Considerably more than the payload. Each entry carries the hash code, a next-index for chaining, the key and the value, and the dictionary maintains a separate bucket array — so a `Dictionary<int,int>` with a million entries costs several times the eight megabytes the data suggests. On top of that, resizing allocates a new pair of arrays and rehashes everything, and beyond a size threshold those arrays land on the LOH. This is why capacity planning from payload size is consistently wrong and why pre-sizing large dictionaries matters for more than speed.
*Follow-up: You need a memory-efficient map of a million integers. What are your options?*

**Q4. When is a custom `IEqualityComparer<T>` the right tool?**
**A:** When you need equality semantics different from the type's own — case-insensitive or ordinal string keys, comparing entities by a business key rather than identity, or keying on a subset of fields. It is the correct alternative to overriding `Equals` on a type you do not own or where the type's natural equality is right for other purposes. For string keys specifically, passing an explicit `StringComparer` is important for both correctness and performance: the ordinal comparers are substantially faster than culture-aware ones, and the default is not always what people assume.
*Follow-up: A dictionary keyed by user-supplied strings behaves differently on a Turkish-locale server. What's happening?*

**Q5. How do concurrent collections differ semantically from their non-concurrent counterparts?**
**A:** Individual operations are thread-safe, but the collection-level semantics weaken: enumeration returns a moment-in-time snapshot rather than throwing on modification, `Count` is a relatively expensive operation and immediately stale, and composite operations you write yourself are still races. `ConcurrentDictionary` in particular is striped internally, so different keys can be modified in parallel, but that is why `Count` must consult every stripe. The practical implication is that any decision made from `Count` or from an enumeration is based on data that was true at some point and may not be now.
*Follow-up: You need to process every item in a `ConcurrentDictionary` exactly once. How?*

**Q6. How does collection choice affect GC behaviour?**
**A:** Through allocation count and object survival. Node-based structures allocate one object per element, so a large `LinkedList` or `SortedDictionary` creates hundreds of thousands of small objects that must be traced on every collection. Array-backed structures allocate one large object, which is cheaper to trace but goes to the LOH past 85 KB, where it is swept rather than compacted and can fragment. Repeated growth compounds this by allocating and abandoning successive arrays. Pre-sizing and choosing array-backed structures for large data both reduce GC pressure meaningfully.
*Follow-up: A cache holds a million small objects in a dictionary. What's the GC consequence, and what would you change?*

**Q7. What's the right return type for a method that produces a collection?**
**A:** One that states the consumption contract. `IReadOnlyList<T>` says "materialised, safe to enumerate repeatedly, do not mutate". `IEnumerable<T>` says "possibly lazy, possibly expensive to enumerate twice, possibly tied to a resource's lifetime" — which is honest for a streaming source and misleading for an already-materialised list. `IAsyncEnumerable<T>` says "streams, consume within the resource's scope". The failure is defaulting to `IEnumerable<T>` everywhere, because it forces every caller to guess whether `.Count()` is free or re-runs a database query.
*Follow-up: You return `IReadOnlyList<T>` but the caller casts it back to `List<T>` and mutates it. How do you prevent that?*

**Q8. How would you optimise a hot path that builds and discards collections per request?**
**A:** First check whether the collection is needed at all — a `Count`, an `Any`, or an aggregate frequently does not require materialising anything. Then pre-size to eliminate growth reallocation, since that is the single largest win and costs one constructor argument. Then consider pooling the backing storage via `ArrayPool<T>` if the collections are large, and returning a `Span<T>` or a struct enumerator to avoid the interface boxing. I would apply those in that order and stop when the profile flattens, because the later steps trade real readability for diminishing returns.
*Follow-up: Why does returning `IEnumerable<T>` from a hot method allocate where a `List<T>` return might not?*

**Q9. What are the trade-offs of exposing a collection as a property?**
**A:** Exposing a mutable collection directly hands callers the ability to change your object's state without going through any method that could enforce invariants — the encapsulation is gone regardless of how careful the rest of the class is. Returning a read-only wrapper prevents mutation through that reference but still shares the underlying instance, so it can change under an enumerating caller. Returning a defensive copy is genuinely safe but allocates per access, which matters on a hot path. The design answer is usually to expose behaviour rather than the collection — `AddItem`, `Items.Count` — so the object retains control.
*Follow-up: The collection is large and read frequently. Copy, wrap, or expose behaviour?*

**Q10. How do you handle a collection that must be both large and searchable by several keys?**
**A:** Multiple index structures over the same objects — a primary collection plus dictionaries mapping each secondary key to the item or its index — which is exactly what a database does and is the right model here. The cost is memory and the obligation to keep every index consistent on insert, update and delete, which is where bugs live, so the mutation path should be encapsulated in one type rather than distributed. If the requirement grows beyond a few indexes or needs range queries and ordering, that is a signal the data belongs in an actual database rather than in process memory.
*Follow-up: One of the secondary keys is not unique. How does that change the structure?*

---

## 4. Expert / Architect (10 Q&A)

**Q1. How do you reason about in-memory data structures when the dataset approaches the size of available RAM?**
**A:** The considerations shift from asymptotics to memory layout and GC behaviour. Per-object overhead dominates: a million small objects cost far more in headers, references and tracing than the same data in a few large arrays of value types, and the latter is also dramatically cheaper for the collector to trace since object *count*, not byte count, drives mark cost. So the design move is structure-of-arrays rather than array-of-structures, value types over reference types, and pre-sized array-backed collections. Beyond a certain live-set size the honest answer is that a tracing collector is the wrong tool and the data belongs off-heap or out of process.
*Follow-up: At roughly what live-set size would you start that conversation, and on what evidence?*

**Q2. How do you set collection-usage standards across a large codebase?**
**A:** Focus on the small number of rules that prevent asymptotic disasters, because those are the ones with catastrophic rather than marginal cost: no linear lookups inside loops, pre-size when the count is known, return types that state their consumption contract, and no sharing of non-concurrent collections across threads. Deliver them as analyzers and reviewed exemplars rather than a style document. I would deliberately not standardise on a preferred collection type, since the right choice is workload-dependent and a blanket rule produces the wrong structure somewhere. The goal is to make the expensive mistakes hard, not to homogenise the easy decisions.
*Follow-up: Which of those would you enforce with an analyzer, and which needs human judgement?*

**Q3. How would you design an in-memory cache's data structure for a high-throughput service?**
**A:** From the access pattern and the eviction policy together, since they are coupled: an LRU needs both a hash map for lookup and an ordering structure for recency, and naive implementations serialise on the ordering structure and destroy concurrency. `ConcurrentDictionary` for the map plus an approximate or sampled eviction strategy usually beats an exact LRU under contention, because exactness costs a global lock. I would also bound it explicitly — an unbounded cache is a memory leak with a friendly name — and consider whether entries should be immutable so readers need no synchronisation at all.
*Follow-up: Your exact-LRU implementation has a lock that's now the throughput ceiling. What do you replace it with?*

**Q4. What's the architectural significance of collection choice in a public API?**
**A:** The type you expose is a contract you cannot change without breaking consumers, and it constrains their code as much as yours. Returning a concrete `List<T>` permits mutation and locks you into that implementation; returning `IEnumerable<T>` gives you freedom but forces every consumer to defend against multiple enumeration; returning `IReadOnlyList<T>` is usually the honest middle for materialised results. Accepting `IEnumerable<T>` as a *parameter* is generally right because it is permissive — but then you must not enumerate it twice, which is a discipline the signature does not enforce.
*Follow-up: You accept `IEnumerable<T>` and need to enumerate it twice. What do you do and what do you document?*

**Q5. How do collections interact with serialisation and API contracts?**
**A:** The runtime type frequently leaks into the wire format and into consumer expectations — a `Dictionary` serialises as an object with arbitrary key order, and a `HashSet` loses ordering entirely, so a contract that quietly depends on order breaks non-deterministically. Polymorphic or interface-typed collection properties complicate deserialisation, and null-versus-empty-collection distinctions cause perennial confusion at boundaries. I would fix collection shapes explicitly in contract types, prefer arrays or lists on the wire, decide the null-versus-empty convention once for the whole API, and cover it with round-trip contract tests.
*Follow-up: A consumer depends on the order of a serialised dictionary. How do you handle that discovery?*

**Q6. How would you approach a memory problem traced to collection overhead?**
**A:** Quantify it before acting: measure objects and bytes per collection type from a heap dump, because intuition about which collection dominates is usually wrong. Then apply the levers in order of leverage — eliminate collections that are cached but never read, pre-size to remove growth waste, replace node-based structures with array-backed ones, replace reference elements with value types where the semantics allow, and pool or share where duplicates exist. Structural changes such as moving the data out of process come last. The point to make to stakeholders is that this is usually a design saving rather than a hardware purchase.
*Follow-up: The dump shows 40% of the heap in one dictionary that is genuinely needed. Now what?*

**Q7. When should data move out of in-memory collections entirely?**
**A:** When the live set is large and long-lived, because GC pause cost scales with the number of live objects to trace — a large in-memory index of small objects is pathological for a tracing collector regardless of tuning. Also when the data must survive a restart, be shared between instances, or support queries the structure cannot serve efficiently, such as ranges over multiple keys. The intermediate option worth considering first is restructuring into few large arrays of value types, which keeps the data in process while cutting object count by orders of magnitude — often that is sufficient and much cheaper than adding a datastore.
*Follow-up: A team wants to add Redis to solve this. When would you push back?*

**Q8. How do you evaluate a proposal to write a custom collection type?**
**A:** Sceptically, because the BCL types are heavily optimised, well-tested and understood by every engineer who will maintain the code, and a custom structure is a permanent comprehension and correctness cost. The cases that genuinely justify it are a specific access pattern the BCL does not serve — a specialised index, a lock-free ring buffer for a measured hot path, a memory layout the standard types cannot express. I would require a benchmark against the standard alternative on realistic data, a thorough test suite including adversarial and concurrent cases, an owner, and containment behind a small interface so it can be replaced.
*Follow-up: The custom type is 3x faster on a benchmark. What else do you need before approving it?*

**Q9. How does collection design change under NativeAOT or a trimmed deployment?**
**A:** Reflection-based construction and serialisation of collection types can break under trimming, so anything discovering or instantiating generic collections dynamically needs to become explicit or source-generated. Generic instantiation over many value types also multiplies generated code, so a heavily generic collection layer inflates binary size in a way it did not under JIT. On the other hand the value of pre-sizing and array-backed structures increases, since startup and memory footprint are usually why AOT was chosen. I would treat the collection layer as one of the specific areas to audit before committing to AOT.
*Follow-up: How would you find dynamic collection instantiation in a large codebase?*

**Q10. What separates an excellent answer from an adequate one when someone chooses a data structure?**
**A:** An adequate answer names a suitable type and its Big-O. An excellent one enumerates the actual operations and their frequencies first, then reasons about constant factors and memory layout as well as asymptotics — knowing that a `List` beats a `LinkedList` in practice, and that a `SortedList` beats a `SortedDictionary` for build-once-read-many. It states the thread-safety contract, the allocation profile, and what happens at ten and at ten million items. And it names the point at which the in-memory answer stops being right at all. The distinguishing quality is reasoning about real hardware and real data volumes rather than about complexity classes in isolation.
*Follow-up: Given that, what would you ask before choosing a structure for a "cache of user permissions"?*
