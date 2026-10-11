(function (r) {
registerTopic('12-data-structures', {
related: ['13-algorithms', '01-csharp', '07-redis'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['arrays', 'list'],
  q: r`How does List<T> work internally, and what are the real costs of Add, Insert and Remove?`,
  a: r`{{List<T>}} wraps a contiguous array {{_items}} plus a {{_size}} count.

- **Add**: amortised O(1). When full, it allocates a new array of double capacity and copies (O(n) for that call). Doubling makes the average cost per add constant.
- **Insert/RemoveAt in the middle**: O(n), because elements shift ({{Array.Copy}}).
- **Index access**: O(1), bounds-checked.
- **Contains / IndexOf**: O(n) linear scan using {{EqualityComparer<T>.Default}}.
- **Remove(item)**: O(n) search + shift.

Hidden costs: growth copies and the old arrays become garbage; arrays over 85,000 bytes land on the Large Object Heap. Pre-size with the constructor capacity when the count is known, and use {{CollectionsMarshal.AsSpan(list)}} for allocation-free iteration in hot paths (do not modify the list while holding the span).`,
  code: r`~~~csharp
var trades = new List<Trade>(capacity: expectedCount);   // avoids log2(n) regrow-and-copy steps
foreach (var t in source) trades.Add(t);                  // amortised O(1)

trades.Insert(0, first);                                  // O(n): shifts every element
trades.RemoveAt(0);                                       // O(n)
var q = new Queue<Trade>();                               // use a queue for FIFO instead: O(1) both ends

Span<Trade> span = CollectionsMarshal.AsSpan(trades);    // no enumerator allocation, no version checks
decimal notional = 0; foreach (ref readonly var t in span) notional += t.Price * t.Qty;
~~~`,
  pts: [r`List<T> is a growable array; Add is amortised O(1) through capacity doubling.`, r`Insert and remove in the middle are O(n) because elements shift.`, r`Contains and IndexOf are linear scans.`, r`Pre-size when the count is known to avoid copies and LOH churn.`, r`CollectionsMarshal.AsSpan gives allocation-free iteration on hot paths.`],
  ex: r`A pricing job removing items from the front of a 2-million-element List took 40 minutes (O(n²)); switching to a Queue made it seconds.`,
  fu: [r`Why does doubling give amortised O(1) and not adding a fixed amount?`, r`What happens if you modify a list during foreach?`],
  pit: [r`Using RemoveAt(0) in a loop as a queue.`, r`Calling Contains inside a loop over another list (O(n·m)).`],
  tip: r`Say "amortised O(1)" and explain the doubling. It is the expected senior answer.` },

{ id: 'q2', level: 'Basic', tags: ['hash-table', 'dictionary'],
  q: r`How does Dictionary<TKey,TValue> work, and what makes lookups O(1) or not?`,
  a: r`.NET's {{Dictionary}} uses **separate chaining with arrays**: a {{buckets}} array of indices into an {{entries}} array; each entry stores hash code, key, value and {{next}} index for collisions.

Lookup: compute {{GetHashCode()}}, map to a bucket (modulo a prime size, or fast modulo), walk the chain comparing hash codes then {{Equals}}.

O(1) average requires:

- A **good hash distribution**: a constant or poorly distributed {{GetHashCode}} degrades to O(n) chains.
- **Immutable keys** while stored: mutating a key's hashed fields loses the entry.
- A reasonable load: it resizes (to the next prime above double) when full; resizing rehashes everything (O(n)).

Since .NET Core, string keys use **randomised hashing** per process, which defends against hash-flooding DoS. Pass the right comparer ({{StringComparer.OrdinalIgnoreCase}}) rather than lower-casing keys.`,
  code: r`~~~csharp
var byIban = new Dictionary<string, Account>(capacity: 100_000, StringComparer.OrdinalIgnoreCase);
if (byIban.TryGetValue(iban, out var acc)) { /* one lookup */ }
ref var count = ref CollectionsMarshal.GetValueRefOrAddDefault(counts, key, out _);   // update in place: one hash lookup
count++;

// Bad key: mutable, and a hash that ignores most fields -> collisions
public sealed class BadKey { public string Country = ""; public int Id; public override int GetHashCode() => Country.Length; }
// Good key: immutable record with generated Equals/GetHashCode
public readonly record struct AccountKey(string Country, long Number);
~~~`,
  pts: [r`Buckets point into an entries array; collisions chain via next indices.`, r`O(1) average needs good hash distribution and immutable keys.`, r`Resizing rehashes everything; pre-size large dictionaries.`, r`String keys use randomised hashing against hash flooding.`, r`Use comparers and TryGetValue / GetValueRefOrAddDefault for single lookups.`],
  ex: r`A cache keyed by a class whose GetHashCode returned the country code length put 90% of keys in 3 buckets; lookups went from microseconds to milliseconds until a record key was used.`,
  fu: [r`Separate chaining vs open addressing?`, r`What is hash flooding?`],
  pit: [r`ContainsKey followed by the indexer (two lookups).`, r`Mutating a key object after insertion.`] },

{ id: 'q3', level: 'Basic', tags: ['big-o', 'complexity'],
  q: r`Explain Big-O for common operations across arrays, linked lists, hash tables, balanced trees and heaps. Why does Big-O not tell the whole story?`,
  a: r`| Structure | Access by index | Search | Insert | Delete | Notes |
|---|---|---|---|---|---|
| Array / List<T> | O(1) | O(n) | O(1) end*, O(n) middle | O(n) | Cache-friendly |
| Linked list | O(n) | O(n) | O(1) at known node | O(1) at known node | Pointer chasing |
| Hash table | n/a | O(1) avg, O(n) worst | O(1) avg | O(1) avg | No ordering |
| Balanced BST (SortedDictionary) | O(log n) | O(log n) | O(log n) | O(log n) | Ordered, range queries |
| Binary heap (PriorityQueue) | n/a | O(n) | O(log n) | O(log n) min | Peek min O(1) |
| Sorted array | O(1) | O(log n) | O(n) | O(n) | Fast read, slow write |

(* amortised)

Big-O hides **constants and memory behaviour**: an array scan of 1,000 items can beat a hash lookup with an expensive hash; linked lists lose to arrays in practice because of cache misses; allocations and GC matter in .NET. Measure with BenchmarkDotNet for real decisions, and consider data size, access pattern and concurrency.`,
  code: r`~~~csharp
[MemoryDiagnoser]
public class LookupBench
{
    private int[] _arr = Enumerable.Range(0, 16).ToArray();
    private HashSet<int> _set = Enumerable.Range(0, 16).ToHashSet();
    [Benchmark] public bool ArrayContains() => Array.IndexOf(_arr, 13) >= 0;   // O(n) but tiny n and contiguous
    [Benchmark] public bool HashContains() => _set.Contains(13);               // O(1) but hashing overhead
}
// For 16 ints the linear scan is typically as fast or faster; at 10,000 the hash set wins by orders of magnitude
~~~`,
  pts: [r`Know the table: arrays O(1) index, hash O(1) average, trees O(log n), heaps O(log n) insert.`, r`Hash tables give no ordering; trees give ordering and range queries.`, r`Big-O hides constants, cache locality and allocation costs.`, r`Small n often favours simple arrays.`, r`Benchmark real decisions.`],
  ex: r`Replacing a LinkedList-based order book with arrays of price levels cut matching latency by 3x purely from cache locality.`,
  fu: [r`What does amortised mean precisely?`, r`Why are linked lists slow on modern CPUs?`],
  pit: [r`Choosing a structure by Big-O alone for tiny collections.`] },

{ id: 'q4', level: 'Basic', tags: ['stack', 'queue'],
  q: r`Stacks and queues: implementations in .NET and real uses. Solve "valid parentheses".`,
  a: r`- **Stack<T>** (LIFO): array-backed, push/pop O(1) amortised. Uses: undo history, expression parsing, DFS, call-stack simulation, matching brackets.
- **Queue<T>** (FIFO): circular buffer, enqueue/dequeue O(1) amortised. Uses: BFS, work queues, rate-limiting windows.
- **PriorityQueue<TElement,TPriority>** (.NET 6+): binary min-heap. Uses: schedulers, Dijkstra, top-K.
- **Concurrent** variants: {{ConcurrentQueue<T>}}, {{ConcurrentStack<T>}}, and {{Channel<T>}} for async producer/consumer with backpressure.

Valid parentheses: push opening brackets, pop on closing and check the match; the string is valid if the stack is empty at the end. O(n) time, O(n) space.`,
  code: r`~~~csharp
public static bool IsValid(string s)
{
    var stack = new Stack<char>();
    foreach (var c in s)
    {
        switch (c)
        {
            case '(' or '[' or '{': stack.Push(c); break;
            case ')' when stack.Count == 0 || stack.Pop() != '(': return false;
            case ']' when stack.Count == 0 || stack.Pop() != '[': return false;
            case '}' when stack.Count == 0 || stack.Pop() != '{': return false;
        }
    }
    return stack.Count == 0;
}
// IsValid("{[()]}") == true; IsValid("([)]") == false
~~~`,
  pts: [r`Stack is LIFO, Queue is FIFO; both O(1) amortised and array-backed.`, r`PriorityQueue is a binary heap for schedulers and Dijkstra.`, r`Use ConcurrentQueue or Channel for concurrent producers and consumers.`, r`Bracket matching: push opens, pop on close, empty at the end.`, r`O(n) time and O(n) space.`],
  ex: r`A rules-expression parser in a pricing engine used a stack-based shunting-yard algorithm to evaluate user-defined formulas safely without eval.`,
  fu: [r`How would you implement a queue with two stacks?`, r`Min-stack with O(1) getMin?`],
  pit: [r`Popping without checking for an empty stack.`] },

{ id: 'q5', level: 'Basic', tags: ['hashset', 'two-sum'],
  q: r`Solve Two Sum in O(n), then explain how HashSet/Dictionary make many "find a pair" problems linear.`,
  a: r`Brute force checks every pair: O(n²). The linear approach stores each number's index in a dictionary; for each element, check whether {{target - x}} was already seen.

Pattern: **trade space for time with a hash structure** ("complement lookup"). It generalises to:

- Detect duplicates ({{HashSet.Add}} returns false).
- Subarray sum equals k (prefix sums in a dictionary).
- First non-repeating character (count map).
- Anagram grouping (sorted key or frequency signature as the dictionary key).

If the input is sorted, a **two-pointer** approach gives O(n) time and O(1) space instead.`,
  code: r`~~~csharp
public static (int, int)? TwoSum(int[] nums, int target)
{
    var seen = new Dictionary<int, int>(nums.Length);
    for (var i = 0; i < nums.Length; i++)
    {
        if (seen.TryGetValue(target - nums[i], out var j)) return (j, i);
        seen.TryAdd(nums[i], i);          // keep the first index for duplicates
    }
    return null;
}
// Sorted input: two pointers, O(1) extra space
public static (int, int)? TwoSumSorted(int[] a, int target)
{
    int l = 0, r = a.Length - 1;
    while (l < r) { var s = a[l] + a[r]; if (s == target) return (l, r); if (s < target) l++; else r--; }
    return null;
}
~~~`,
  pts: [r`Store seen values in a dictionary and look up the complement: O(n) time, O(n) space.`, r`Brute force is O(n²).`, r`The pattern generalises to duplicates, prefix sums and anagrams.`, r`For sorted input, two pointers give O(1) space.`, r`Clarify duplicates and whether indices or values are required.`],
  ex: r`A reconciliation job matching debits to credits of equal amount used the complement-lookup pattern over 3 million entries in seconds instead of hours.`,
  fu: [r`Three-sum in O(n²)?`, r`Return all pairs, not just one?`],
  pit: [r`Inserting before checking, so an element pairs with itself.`] },

{ id: 'q6', level: 'Basic', tags: ['strings', 'stringbuilder'],
  q: r`Why are strings immutable in .NET, and how do you build and parse strings efficiently?`,
  a: r`Strings are immutable UTF-16 sequences: every modification creates a new string. Benefits: thread safety, safe dictionary keys, interning, security (a validated string cannot change).

Costs: concatenation in a loop is O(n²) in copying and allocations.

Efficient options:

- {{StringBuilder}}: mutable buffer for repeated appends.
- {{string.Create}} / {{string.Join}} / interpolated string handlers (C# 10 builds interpolations efficiently).
- **Spans** ({{ReadOnlySpan<char>}}) for parsing and slicing without allocating substrings: {{MemoryExtensions.Split}} (.NET 9), {{int.Parse(span)}}.
- {{SearchValues<char>}} (.NET 8) for fast multi-character searches.
- Ordinal comparisons ({{StringComparison.Ordinal}}) for identifiers: faster and culture-independent.`,
  code: r`~~~csharp
// O(n^2): each += copies everything so far
string csv = ""; foreach (var t in trades) csv += t.Id + "," + t.Price + "\n";
// O(n)
var sb = new StringBuilder(trades.Count * 32);
foreach (var t in trades) sb.Append(t.Id).Append(',').Append(t.Price).Append('\n');

// Allocation-free parsing with spans: "EURUSD,1.0842,1000000"
static (string Pair, decimal Rate, long Qty) Parse(ReadOnlySpan<char> line)
{
    Span<Range> parts = stackalloc Range[3];
    line.Split(parts, ',');
    return (line[parts[0]].ToString(), decimal.Parse(line[parts[1]], CultureInfo.InvariantCulture), long.Parse(line[parts[2]]));
}
private static readonly SearchValues<char> Separators = SearchValues.Create(",;|\t");
int idx = line.AsSpan().IndexOfAny(Separators);
~~~`,
  pts: [r`Strings are immutable: safe to share and use as keys.`, r`Concatenation in a loop is O(n²); use StringBuilder.`, r`Spans parse and slice without allocating substrings.`, r`SearchValues and ordinal comparisons speed up searching.`, r`Use invariant culture for machine-readable formats.`],
  ex: r`A file parser rewritten with spans processed 2 GB of trade files with 95% fewer allocations and half the CPU.`,
  fu: [r`What is string interning and when does it help?`],
  pit: [r`Culture-sensitive parsing of decimals from files.`] },

{ id: 'q7', level: 'Intermediate', tags: ['linked-list', 'lru'],
  q: r`Design an LRU cache with O(1) get and put. Implement it in C#.`,
  a: r`Combine a **hash map** (key -> node) for O(1) lookup with a **doubly linked list** ordered by recency for O(1) move-to-front and evict-from-back.

- Get: find node in the map, move it to the front, return value.
- Put: if present, update and move to front; else add to front, and if over capacity remove the tail node and its map entry.

Production considerations: thread safety (lock, or sharded caches), memory bounds by size not count, TTLs, and stampede protection. In real .NET services you would use {{MemoryCache}} (size limits, expiration) or {{HybridCache}}; the LRU implementation tests data-structure fluency.`,
  code: r`~~~csharp
public sealed class LruCache<TKey, TValue>(int capacity) where TKey : notnull
{
    private readonly Dictionary<TKey, LinkedListNode<(TKey Key, TValue Value)>> _map = new(capacity);
    private readonly LinkedList<(TKey Key, TValue Value)> _list = new();
    private readonly Lock _gate = new();

    public bool TryGet(TKey key, out TValue value)
    {
        lock (_gate)
        {
            if (!_map.TryGetValue(key, out var node)) { value = default!; return false; }
            _list.Remove(node); _list.AddFirst(node);              // O(1) move to front
            value = node.Value.Value; return true;
        }
    }
    public void Put(TKey key, TValue value)
    {
        lock (_gate)
        {
            if (_map.TryGetValue(key, out var existing)) { _list.Remove(existing); _map.Remove(key); }
            else if (_map.Count == capacity) { var lru = _list.Last!; _list.RemoveLast(); _map.Remove(lru.Value.Key); }   // evict
            _map[key] = _list.AddFirst((key, value));
        }
    }
}
~~~`,
  pts: [r`Hash map for O(1) lookup plus doubly linked list for O(1) recency updates.`, r`Move to front on get; evict from the tail on overflow.`, r`Lock or shard for thread safety.`, r`Bound by size, add TTLs in production.`, r`Use MemoryCache or HybridCache in real services.`],
  ex: r`An FX service used a small LRU of per-currency-pair rate objects; profiling later showed the lock was contended, so it was sharded by pair hash.`,
  fu: [r`LRU vs LFU: when is LFU better?`, r`How would you make it lock-free?`],
  pit: [r`Using List<T> and Remove for recency (O(n)).`] },

{ id: 'q8', level: 'Intermediate', tags: ['heap', 'priority-queue', 'top-k'],
  q: r`Find the top K most frequent items in a large stream. Compare heap, sorting and bucket approaches.`,
  a: r`Step 1: count frequencies with a dictionary (O(n)).

Step 2 options:

- **Sort all distinct items** by count: O(m log m) for m distinct items. Simple.
- **Min-heap of size K**: push each item; if the heap exceeds K, pop the minimum. O(m log K): much better when K is small.
- **Bucket sort** by frequency (index = count): O(m) when counts are bounded by n.
- **Streaming / bounded memory**: Count-Min Sketch + heap, or Space-Saving algorithm for approximate heavy hitters (Redis Top-K, analytics systems).

.NET's {{PriorityQueue<TElement, TPriority>}} is a min-heap.`,
  code: r`~~~csharp
public static IReadOnlyList<string> TopK(IEnumerable<string> items, int k)
{
    var counts = new Dictionary<string, int>();
    foreach (var it in items) CollectionsMarshal.GetValueRefOrAddDefault(counts, it, out _)++;

    var heap = new PriorityQueue<string, int>();            // min-heap by count
    foreach (var (item, count) in counts)
    {
        heap.Enqueue(item, count);
        if (heap.Count > k) heap.Dequeue();                  // drop the smallest: O(log k)
    }
    var result = new List<string>(k);
    while (heap.Count > 0) result.Add(heap.Dequeue());
    result.Reverse();                                        // most frequent first
    return result;
}
// O(n + m log k) time, O(m + k) space
~~~`,
  pts: [r`Count frequencies first with a dictionary.`, r`A size-K min-heap gives O(m log K).`, r`Sorting is O(m log m); bucket sort can be O(m).`, r`For unbounded streams use approximate structures (Count-Min, Space-Saving).`, r`PriorityQueue in .NET is a min-heap.`],
  ex: r`A fraud dashboard showing top merchants by declined volume used Redis Top-K for the live view and exact counts in the nightly warehouse.`,
  fu: [r`How would you do top K across 50 servers?`],
  pit: [r`Max-heap of all items when only K are needed.`] },

{ id: 'q9', level: 'Intermediate', tags: ['trees', 'bst'],
  q: r`Binary search trees vs balanced trees (red-black, AVL, B-trees): what does SortedDictionary use, and when do you need ordering?`,
  a: r`A plain **BST** gives O(log n) only when balanced; sorted inserts degrade it to a linked list (O(n)). **Self-balancing** trees fix this:

- **Red-black trees**: looser balance, fewer rotations on insert/delete. .NET's {{SortedDictionary}} and {{SortedSet}} are red-black trees.
- **AVL trees**: stricter balance, faster lookups, more rotations.
- **B-trees / B+trees**: high fan-out nodes sized to disk pages; minimise I/O. Used by databases (SQL Server, PostgreSQL indexes) and file systems.

{{SortedList<K,V>}} is a sorted array: O(log n) lookup, O(n) insert, compact memory, fast for read-mostly data.

Use ordered structures when you need: range queries (all prices between x and y), min/max, ordered iteration, floor/ceiling (nearest key). Otherwise a hash table is faster.`,
  code: r`~~~csharp
// Order book side: price levels kept sorted; best bid = max, range queries for depth
var bids = new SortedDictionary<decimal, long>(Comparer<decimal>.Create((a, b) => b.CompareTo(a)));  // descending
bids[101.25m] = 500; bids[101.30m] = 200; bids[101.20m] = 900;
var best = bids.First();                                   // 101.30 x 200

// SortedSet range view: all events in a time window, O(log n + k)
var events = new SortedSet<DateTimeOffset>();
var window = events.GetViewBetween(DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow);
~~~`,
  pts: [r`Unbalanced BSTs degrade to O(n) on sorted input.`, r`SortedDictionary and SortedSet are red-black trees: O(log n).`, r`B-trees power database indexes by matching node size to pages.`, r`SortedList is a sorted array: fast reads, slow inserts.`, r`Use ordered structures for ranges, min/max and ordered iteration.`],
  ex: r`A market-data replay tool used SortedSet.GetViewBetween to pull events in time windows instead of scanning a list each second.`,
  fu: [r`Why do databases use B+trees rather than binary trees?`],
  pit: [r`Using SortedList for write-heavy workloads.`] },

{ id: 'q10', level: 'Intermediate', tags: ['graphs', 'bfs-dfs'],
  q: r`Represent a graph and implement BFS and DFS. When do you use each in real systems?`,
  a: r`Representations:

- **Adjacency list** ({{Dictionary<Node, List<Node>>}}): O(V + E) memory; standard for sparse graphs.
- **Adjacency matrix**: O(V²) memory; O(1) edge check; dense graphs only.

Traversals, both O(V + E):

- **BFS** (queue): shortest path in unweighted graphs, level-by-level exploration ("degrees of separation", nearest available driver in hops).
- **DFS** (stack/recursion): reachability, cycle detection, topological sort, connected components.

Real uses: dependency resolution (build/deploy order via topological sort), fraud rings (connected components of shared devices/cards), org hierarchies, network routing, permission inheritance.

Watch recursion depth in DFS on large graphs (use an explicit stack) and always track visited nodes.`,
  code: r`~~~csharp
public static int? ShortestHops(Dictionary<string, List<string>> g, string from, string to)
{
    var visited = new HashSet<string> { from };
    var q = new Queue<(string Node, int Dist)>(); q.Enqueue((from, 0));
    while (q.Count > 0)
    {
        var (node, d) = q.Dequeue();
        if (node == to) return d;
        foreach (var n in g.GetValueOrDefault(node, []))
            if (visited.Add(n)) q.Enqueue((n, d + 1));
    }
    return null;
}
// Iterative DFS: connected component containing 'start' (e.g. accounts sharing devices)
public static HashSet<string> Component(Dictionary<string, List<string>> g, string start)
{
    var seen = new HashSet<string>(); var stack = new Stack<string>(); stack.Push(start);
    while (stack.Count > 0) { var n = stack.Pop(); if (!seen.Add(n)) continue; foreach (var m in g.GetValueOrDefault(n, [])) stack.Push(m); }
    return seen;
}
~~~`,
  pts: [r`Adjacency lists for sparse graphs, matrices for dense ones.`, r`BFS with a queue finds shortest paths in unweighted graphs.`, r`DFS with a stack finds reachability, cycles, components and topological order.`, r`Both are O(V + E) with a visited set.`, r`Use an explicit stack to avoid recursion depth limits.`],
  ex: r`A fraud team found rings of 40+ accounts linked through shared devices by computing connected components nightly.`,
  fu: [r`How do you detect a cycle in a directed graph?`],
  pit: [r`Forgetting the visited set on cyclic graphs.`] },

{ id: 'q11', level: 'Intermediate', tags: ['trie', 'autocomplete'],
  q: r`Implement a trie for prefix search / autocomplete. What are its memory trade-offs?`,
  a: r`A **trie** stores strings character by character; each node has children keyed by character and a flag for "end of word". Insert and lookup cost O(L) where L is the word length, independent of how many words are stored. Prefix search walks to the prefix node then enumerates its subtree.

Trade-offs:

- Memory heavy: a node per character with a child map. Compress with **radix trees** (merge single-child chains) or use arrays for small alphabets.
- Great for autocomplete, IP routing (longest prefix match), dictionary checks, BIN-range lookups.
- For large-scale search, an inverted index (Elasticsearch/OpenSearch) or a sorted array with binary search for prefixes is often simpler.

For top-N suggestions, store the top-N popular completions at each node to avoid subtree traversal.`,
  code: r`~~~csharp
public sealed class Trie
{
    private sealed class Node { public Dictionary<char, Node> Next { get; } = new(); public bool End; }
    private readonly Node _root = new();
    public void Insert(string word)
    {
        var n = _root;
        foreach (var c in word) { if (!n.Next.TryGetValue(c, out var child)) n.Next[c] = child = new Node(); n = child; }
        n.End = true;
    }
    public IEnumerable<string> WithPrefix(string prefix, int max = 10)
    {
        var n = _root;
        foreach (var c in prefix) if (!n.Next.TryGetValue(c, out n!)) yield break;
        var stack = new Stack<(Node Node, string Text)>(); stack.Push((n, prefix)); var count = 0;
        while (stack.Count > 0 && count < max)
        {
            var (node, text) = stack.Pop();
            if (node.End) { yield return text; count++; }
            foreach (var (c, child) in node.Next.OrderByDescending(kv => kv.Key)) stack.Push((child, text + c));
        }
    }
}
~~~`,
  pts: [r`A trie stores strings by character path; lookup is O(L) in word length.`, r`Prefix search walks to the prefix node then enumerates.`, r`Memory heavy; radix trees compress single-child chains.`, r`Used for autocomplete, longest-prefix match, BIN-range lookups.`, r`At scale, inverted indexes or sorted arrays may be simpler.`],
  ex: r`A card-processing service mapped card BINs to issuers with a prefix trie, resolving the longest matching prefix in microseconds.`,
  fu: [r`How would you rank suggestions by popularity?`],
  pit: [r`Building a trie for 10 million words in a per-request scope.`] },

{ id: 'q12', level: 'Intermediate', tags: ['sliding-window', 'arrays'],
  q: r`Solve "longest substring without repeating characters" and explain the sliding-window pattern.`,
  a: r`A **sliding window** maintains a range [left, right] over a sequence and moves the boundaries to keep an invariant, avoiding re-scanning: each element enters and leaves the window at most once, giving O(n).

For the longest substring without repeats: extend {{right}}; if the character was seen inside the window, move {{left}} to one past its last position; track the max window length. A dictionary (or an int array for ASCII) stores last positions.

The pattern solves: max sum subarray of size k, smallest subarray with sum >= target, rate limiting over time windows, moving averages, and "at most K distinct" problems.`,
  code: r`~~~csharp
public static int LongestUnique(string s)
{
    var last = new Dictionary<char, int>();
    int best = 0, left = 0;
    for (var right = 0; right < s.Length; right++)
    {
        if (last.TryGetValue(s[right], out var prev) && prev >= left) left = prev + 1;   // shrink past the duplicate
        last[s[right]] = right;
        best = Math.Max(best, right - left + 1);
    }
    return best;
}
// LongestUnique("abcabcbb") == 3 ("abc"); O(n) time, O(min(n, alphabet)) space

// Fixed-size window: max sum of k consecutive transactions
public static decimal MaxWindowSum(decimal[] a, int k)
{ decimal sum = a[..k].Sum(), best = sum; for (var i = k; i < a.Length; i++) { sum += a[i] - a[i - k]; best = Math.Max(best, sum); } return best; }
~~~`,
  pts: [r`A sliding window moves left and right bounds to keep an invariant.`, r`Each element enters and leaves once: O(n).`, r`Track last positions to jump the left bound past duplicates.`, r`Fixed windows subtract the element leaving and add the one entering.`, r`The pattern applies to rate limits, moving averages and constrained subarrays.`],
  ex: r`A velocity check ("more than 5 transactions in 10 minutes") used a sliding window over each card's ordered timestamps.`,
  fu: [r`Longest substring with at most K distinct characters?`],
  pit: [r`Moving left backwards when the duplicate is outside the window.`] },

{ id: 'q13', level: 'Intermediate', tags: ['immutable', 'frozen'],
  q: r`Immutable and frozen collections in .NET: ImmutableList, ImmutableArray, FrozenDictionary. When do you use each?`,
  a: r`- **ImmutableArray<T>**: a struct wrapping an array; O(1) index, very fast reads, but every "modification" copies the whole array (O(n)). Best for small or rarely changed data shared across threads.
- **ImmutableList<T> / ImmutableDictionary**: persistent balanced trees; "modifications" return a new version sharing most nodes (O(log n)), but reads are slower (pointer chasing) than arrays/hash tables. Best when you need many versions or frequent copy-on-write updates.
- **FrozenDictionary / FrozenSet** (.NET 8): built once, optimised for read speed (analyses keys to pick an optimal hashing strategy). Expensive to create, fastest lookups. Best for configuration and reference data loaded at startup.
- **ReadOnlyCollection / IReadOnlyList**: read-only **views** over mutable collections, not immutable.

Thread-safe publication: swap a reference to a new immutable/frozen instance atomically ({{Volatile.Write}} or {{Interlocked.Exchange}}) when reference data refreshes.`,
  code: r`~~~csharp
// Reference data: build once, read millions of times
private FrozenDictionary<string, Currency> _currencies = LoadCurrencies().ToFrozenDictionary(c => c.Code);
public Currency Get(string code) => Volatile.Read(ref _currencies)[code];
public void Refresh(IEnumerable<Currency> fresh) =>
    Interlocked.Exchange(ref _currencies, fresh.ToFrozenDictionary(c => c.Code));   // atomic swap, readers never see a half-built map

// Copy-on-write config snapshots shared across threads
ImmutableArray<string> allowed = ["GB", "IE", "DE"];
var withFr = allowed.Add("FR");                      // new array; 'allowed' unchanged
~~~`,
  pts: [r`ImmutableArray: fastest immutable reads, O(n) per change.`, r`ImmutableList/Dictionary: persistent trees, cheap versions, slower reads.`, r`FrozenDictionary/FrozenSet: slow to build, fastest lookups for static data.`, r`ReadOnlyCollection is a view, not immutable.`, r`Refresh reference data by atomically swapping a new instance.`],
  ex: r`Switching a BIN lookup table from Dictionary to FrozenDictionary cut lookup time by about 40% on a path called 20,000 times per second.`,
  fu: [r`What is structural sharing?`],
  pit: [r`Using ImmutableList in hot read paths expecting array speed.`] },

{ id: 'q14', level: 'Intermediate', tags: ['concurrent-collections'],
  q: r`ConcurrentDictionary internals and pitfalls: when is it the right tool?`,
  a: r`{{ConcurrentDictionary}} uses **fine-grained lock striping** for writes (a lock per group of buckets) and **lock-free reads**. Reads never block; writes to different stripes proceed in parallel.

Pitfalls:

- **GetOrAdd / AddOrUpdate factories may run more than once** under contention (only one result is stored). Wrap expensive or side-effecting factories in {{Lazy<T>}}.
- **Compound operations are not atomic**: check-then-act across two calls races. Use the atomic APIs ({{TryAdd}}, {{TryUpdate}} with comparison, {{AddOrUpdate}}).
- **Count, Keys, Values, ToArray** take all locks: expensive and blocking; avoid in hot paths.
- **Enumeration** is safe but not a snapshot (may see concurrent changes).
- Values that are mutable objects still need their own synchronisation.

Alternatives: immutable snapshots with atomic swap for read-mostly data; {{Channel<T>}} for producer/consumer; sharding by key into single-threaded owners (actors).`,
  code: r`~~~csharp
private readonly ConcurrentDictionary<string, Lazy<Task<AccessToken>>> _tokens = new();
public Task<AccessToken> GetTokenAsync(string audience) =>
    _tokens.GetOrAdd(audience, a => new Lazy<Task<AccessToken>>(() => _idp.FetchAsync(a))).Value;   // fetched exactly once

// Atomic counter update without races
private readonly ConcurrentDictionary<string, long> _hits = new();
public void Hit(string route) => _hits.AddOrUpdate(route, 1, (_, v) => v + 1);

// Race: two calls, not atomic
// if (!_hits.ContainsKey(route)) _hits[route] = 0;  _hits[route]++;
~~~`,
  pts: [r`Lock-striped writes and lock-free reads.`, r`GetOrAdd factories can run more than once: wrap in Lazy.`, r`Use the atomic APIs; check-then-act races.`, r`Count, Keys and ToArray take all locks.`, r`Mutable values still need their own synchronisation.`],
  ex: r`A token cache called the identity provider 60 times on a cold start under load until GetOrAdd was combined with Lazy<Task>.`,
  fu: [r`How does lock striping work?`],
  pit: [r`Calling Count in a hot path.`] },

{ id: 'q15', level: 'Intermediate', tags: ['intervals', 'sorting'],
  q: r`Merge overlapping intervals and detect booking conflicts. What structure do you use at scale?`,
  a: r`### Merge intervals
Sort by start (O(n log n)), then sweep: if the next interval starts before the current one ends, extend the end; otherwise emit the current and start a new one.

### Conflict check for one new booking
With intervals sorted by start, binary search for the neighbours and check overlap (O(log n)). In a sorted tree ({{SortedSet}} with a comparer), find floor and ceiling.

### At scale
- **Interval trees** answer "which intervals overlap X" in O(log n + k).
- **Databases**: PostgreSQL range types with GiST exclusion constraints guarantee no overlaps under concurrency; SQL Server needs a check with locking or a unique slot model.
- **Discretised slots** (15-minute buckets) turn overlap checks into unique-key inserts, simple and concurrency-safe.

Remember half-open intervals [start, end) so back-to-back bookings do not conflict.`,
  code: r`~~~csharp
public readonly record struct Interval(DateTime Start, DateTime End);   // half-open [Start, End)
public static List<Interval> Merge(IEnumerable<Interval> input)
{
    var sorted = input.OrderBy(i => i.Start).ToList();
    var result = new List<Interval>();
    foreach (var cur in sorted)
    {
        if (result.Count > 0 && cur.Start <= result[^1].End)
            result[^1] = result[^1] with { End = cur.End > result[^1].End ? cur.End : result[^1].End };
        else result.Add(cur);
    }
    return result;
}
public static bool Overlaps(Interval a, Interval b) => a.Start < b.End && b.Start < a.End;
~~~
~~~sql
-- PostgreSQL: the database guarantees no overlapping bookings per room, even under concurrency
ALTER TABLE bookings ADD CONSTRAINT no_overlap EXCLUDE USING gist (room_id WITH =, during WITH &&);
~~~`,
  pts: [r`Sort by start, then sweep and extend overlapping ends.`, r`Use half-open intervals so adjacent bookings do not clash.`, r`Interval trees answer overlap queries in O(log n + k).`, r`Let the database enforce no-overlap (exclusion constraints) under concurrency.`, r`Discrete slots turn overlap checks into unique inserts.`],
  ex: r`A meeting-room system double-booked rooms under concurrent requests until an exclusion constraint replaced the application-side overlap check.`,
  fu: [r`Minimum number of rooms needed for a set of meetings?`],
  pit: [r`Closed intervals making back-to-back bookings conflict.`] },

{ id: 'q16', level: 'Intermediate', tags: ['memory', 'structs'],
  q: r`Arrays of structs vs arrays of classes: how does memory layout affect performance?`,
  a: r`- **Array of classes**: the array holds references; each object lives elsewhere on the heap with a header (~16 bytes on 64-bit) plus fields. Iterating chases pointers, causing cache misses; each object is GC-tracked.
- **Array of structs**: values stored contiguously inline. Iteration is sequential memory access (CPU prefetching), no per-element headers, and no GC tracking for the elements (if the struct contains no references).

Use structs for small, immutable, value-like data in large collections (ticks, points, money amounts). Keep them small (16 bytes is a common guideline), make them {{readonly}}, and pass large ones by {{in}}/{{ref}} to avoid copies.

**Structure of arrays** (separate arrays per field) can beat array of structs when you only read a few fields (column-oriented, like columnstore indexes), and enables SIMD.`,
  code: r`~~~csharp
public sealed class TickClass { public double Price; public double Size; public long Ts; }   // ~40 bytes each + pointer
public readonly record struct Tick(double Price, double Size, long Ts);                       // 24 bytes inline

var objs = new TickClass[1_000_000];   // 1M separate heap objects, pointer chasing on scan
var vals = new Tick[1_000_000];        // one contiguous 24 MB block, sequential scan

// Structure of arrays: only touch the columns you need; SIMD-friendly
public sealed class TickColumns(int n) { public double[] Price = new double[n]; public double[] Size = new double[n]; public long[] Ts = new long[n]; }
static double Notional(TickColumns c) => System.Numerics.Tensors.TensorPrimitives.Dot(c.Price, c.Size);
~~~`,
  pts: [r`Arrays of classes hold references to scattered objects; scans miss the cache.`, r`Arrays of structs are contiguous, header-free and GC-light.`, r`Keep structs small, readonly and pass large ones by in or ref.`, r`Structure of arrays wins when reading few fields and enables SIMD.`, r`Measure with BenchmarkDotNet before redesigning.`],
  ex: r`A risk engine moving positions from classes to struct arrays cut a full-portfolio revaluation from 2.1 s to 0.6 s and halved GC time.`,
  fu: [r`What is false sharing?`],
  pit: [r`Large mutable structs copied by value everywhere.`] },

{ id: 'q17', level: 'Intermediate', tags: ['prefix-sum'],
  q: r`Prefix sums: solve "count subarrays summing to K" and explain where prefix sums appear in production.`,
  a: r`A **prefix sum** array {{P[i] = a[0] + ... + a[i-1]}} turns any range sum into {{P[r] - P[l]}} in O(1) after O(n) preprocessing.

Subarrays summing to K: a subarray (l, r] sums to K when {{P[r] - P[l] = K}}. Walk once, keep a dictionary counting how many times each prefix value occurred, and for each new prefix add the count of {{prefix - K}}. O(n) time and space, and works with negative numbers (unlike sliding windows).

Production equivalents: running balances (prefix sums of transactions), cumulative metrics, summed-area tables for 2D ranges, Fenwick/segment trees when values update.`,
  code: r`~~~csharp
public static int CountSubarraysWithSum(int[] a, int k)
{
    var seen = new Dictionary<long, int> { [0] = 1 };   // empty prefix
    long prefix = 0; var count = 0;
    foreach (var x in a)
    {
        prefix += x;
        if (seen.TryGetValue(prefix - k, out var c)) count += c;
        seen[prefix] = seen.GetValueOrDefault(prefix) + 1;
    }
    return count;
}
// CountSubarraysWithSum([1, 2, 3, -2, 2], 3) == 3  -> [1,2], [3], [3,-2,2]

// Range sums in O(1) after O(n) setup, e.g. turnover between two days
long[] P = new long[daily.Length + 1];
for (var i = 0; i < daily.Length; i++) P[i + 1] = P[i] + daily[i];
long Turnover(int fromDay, int toDayExclusive) => P[toDayExclusive] - P[fromDay];
~~~`,
  pts: [r`Prefix sums make any range sum O(1) after O(n) setup.`, r`Count subarrays summing to K with a dictionary of prefix counts.`, r`Works with negative numbers, unlike sliding windows.`, r`Running balances are prefix sums.`, r`Use Fenwick or segment trees when values change.`],
  ex: r`A reporting API answered arbitrary date-range turnover queries in O(1) from a daily prefix-sum table instead of scanning transactions.`,
  fu: [r`2D prefix sums for rectangle queries?`],
  pit: [r`Forgetting the initial {0: 1} entry.`] },

{ id: 'q18', level: 'Intermediate', tags: ['fenwick', 'segment-tree'],
  q: r`When do you need a Fenwick tree or segment tree instead of prefix sums?`,
  a: r`Prefix sums are static: an update at position i forces rebuilding O(n) prefix values. When values change and you still need fast range queries:

- **Fenwick tree (binary indexed tree)**: point update and prefix query in O(log n), tiny code, O(n) memory. Supports sums (and other invertible operations).
- **Segment tree**: range query and point update in O(log n) for any associative operation (sum, min, max, gcd); with **lazy propagation**, also range updates in O(log n).

Use cases: live leaderboards by score buckets, order-book depth by price level with frequent updates, rolling analytics, rate counters over buckets.

In production, often a database, Redis sorted sets, or columnstore handles this; implement these trees for in-memory hot paths (matching engines, risk aggregation) or interviews.`,
  code: r`~~~csharp
public sealed class Fenwick(int n)
{
    private readonly long[] _t = new long[n + 1];
    public void Add(int i, long delta) { for (i++; i < _t.Length; i += i & -i) _t[i] += delta; }        // O(log n)
    public long PrefixSum(int i) { long s = 0; for (i++; i > 0; i -= i & -i) s += _t[i]; return s; }  // sum of [0..i]
    public long RangeSum(int l, int r) => PrefixSum(r) - (l > 0 ? PrefixSum(l - 1) : 0);
}
// Order-book depth: volume per price tick, updated on every order, queried for "volume within 10 ticks of best"
var depth = new Fenwick(100_000);
depth.Add(priceTick, +500);    // new order
depth.Add(priceTick, -200);    // partial fill
long near = depth.RangeSum(bestTick - 10, bestTick);
~~~`,
  pts: [r`Prefix sums are static; updates cost O(n).`, r`Fenwick trees: point update and prefix query in O(log n).`, r`Segment trees support any associative operation and range updates with lazy propagation.`, r`Use them for frequently updated range aggregates in memory.`, r`Often a database or Redis covers the need in production.`],
  ex: r`A matching engine tracked depth per price tick with a Fenwick tree, answering depth queries in microseconds during bursts of 50,000 updates per second.`,
  fu: [r`How does i & -i work?`],
  pit: [r`Off-by-one errors from 0- vs 1-based indexing.`] },

{ id: 'q19', level: 'Senior', tags: ['b-tree', 'database-internals'],
  q: r`Why do databases use B+trees, and how does that explain index design rules?`,
  a: r`A **B+tree** keeps keys sorted in nodes sized to a disk page (8 KB in SQL Server/PostgreSQL). High fan-out (hundreds of keys per node) means a billion rows need only 3 to 4 levels, so a lookup is 3 to 4 page reads, most of them cached. Leaf pages are linked, making range scans sequential.

This explains classic index rules:

- **Seek vs scan**: a seek walks root to leaf (O(log n)); a scan reads leaves.
- **Composite key order**: the tree is sorted by the first column, then the second; equality columns first, range columns last.
- **Narrow keys**: more keys per page, fewer levels, smaller indexes (and the clustering key is copied into every non-clustered index in SQL Server).
- **Random keys (GUIDv4)** insert into random leaf pages: page splits, fragmentation, cache misses; sequential keys append at the right edge.
- **Covering indexes** avoid the extra lookup from leaf to base row.`,
  code: r`~~~text
Fan-out: 8 KB page / ~16-byte key+pointer ≈ 500 entries per node
Levels for 1,000,000,000 rows: log_500(1e9) ≈ 3.3 -> 4 levels -> 4 page reads per lookup (root+intermediate usually cached)
~~~
~~~sql
-- Equality first, then range: the B+tree can seek straight to (customer, from) and scan forward
CREATE INDEX IX_Orders_Customer_Date ON dbo.Orders (CustomerId, OrderDate) INCLUDE (Total);
SELECT OrderDate, Total FROM dbo.Orders WHERE CustomerId = 42 AND OrderDate >= '2026-01-01';
~~~`,
  pts: [r`B+tree nodes are page-sized with high fan-out: billions of rows in 3 to 4 levels.`, r`Leaves are linked, so range scans are sequential.`, r`Composite indexes sort by first column then second: equality first, range last.`, r`Narrow, sequential keys keep trees small and avoid page splits.`, r`Covering indexes avoid the extra base-row lookup.`],
  ex: r`Changing a random GUID primary key to a sequential bigint cut insert latency by 60% and halved index size on a 500-million-row table.`,
  fu: [r`B-tree vs LSM-tree: when does each win?`],
  pit: [r`Putting the range column first in a composite index.`] },

{ id: 'q20', level: 'Senior', tags: ['lsm-tree', 'storage'],
  q: r`What is an LSM-tree and why do Cassandra, RocksDB and Kafka-like systems favour append-only structures?`,
  a: r`A **Log-Structured Merge tree** buffers writes in an in-memory sorted structure (memtable) and a write-ahead log; when full, the memtable is flushed as an immutable sorted file (SSTable). Background **compaction** merges SSTables, discarding overwritten and deleted keys (tombstones).

Why append-only:

- **Writes are sequential**: much faster than random B-tree page updates, especially on disks and with high write rates.
- **Immutability** simplifies concurrency, replication and snapshots.

Costs:

- **Read amplification**: a key may be in several SSTables; mitigated by **Bloom filters** per SSTable and caches.
- **Write amplification** from compaction; **space amplification** before compaction.
- Compaction storms can hurt latency.

B-trees (SQL Server, PostgreSQL) favour read-heavy, update-in-place OLTP; LSM-trees (Cassandra, ScyllaDB, RocksDB, DynamoDB's storage, many time-series stores) favour write-heavy workloads. Kafka is a simpler append-only log with segment files and offset indexes.`,
  code: r`~~~text
Write path:  client -> WAL (sequential append) -> memtable (sorted, in memory)
             memtable full -> flush to SSTable L0 (immutable, sorted)
             compaction: L0+L1 -> merged L1 (drops overwritten keys and expired tombstones)
Read path:   memtable -> (Bloom filter says "maybe") SSTable L0 -> L1 -> ... first hit wins
~~~`,
  dia: r`flowchart LR
  W[Write] --> WAL[(WAL: sequential append)]
  W --> MT[Memtable: sorted, in memory]
  MT -->|flush when full| L0[(SSTable L0)]
  L0 -->|compaction| L1[(SSTable L1)]
  L1 -->|compaction| L2[(SSTable L2)]
  R[Read] --> MT
  R -->|Bloom filter check| L0
  R --> L1
  R --> L2`,
  pts: [r`LSM-trees buffer writes in a memtable and flush immutable sorted files.`, r`Compaction merges files and drops overwritten and deleted keys.`, r`Sequential writes make LSM-trees great for write-heavy workloads.`, r`Reads may touch several files; Bloom filters reduce that.`, r`B-trees suit read-heavy OLTP; LSM-trees suit high write rates.`],
  ex: r`An IoT platform moved telemetry from SQL Server to Cassandra after write throughput saturated B-tree page latches at 200,000 inserts per second.`,
  fu: [r`What are tombstones and why can they hurt reads?`],
  pit: [r`Ignoring compaction when capacity planning disk space.`] },

{ id: 'q21', level: 'Senior', tags: ['bloom-filter', 'probabilistic'],
  q: r`How does a Bloom filter work, how do you size it, and where would you use one?`,
  a: r`A **Bloom filter** is a bit array of m bits with k hash functions. Insert sets k bits; a query checks those k bits: if any is 0 the item is **definitely absent**; if all are 1 it is **probably present** (false positives possible, false negatives impossible). No deletes (use a counting or Cuckoo filter for that).

Sizing for n items and false-positive rate p:

- m = -n ln p / (ln 2)² bits; k = (m / n) ln 2.
- About **9.6 bits per item for 1%**, 14.4 bits for 0.1%.

Uses:

- Skip disk reads for absent keys (LSM-tree SSTables, Cassandra, RocksDB).
- Cache penetration protection (reject lookups for ids that do not exist).
- Deduplication of crawled URLs or processed event ids (with acceptable false positives).
- "Has this password appeared in breaches?" checks client-side.`,
  code: r`~~~csharp
public sealed class BloomFilter
{
    private readonly ulong[] _bits; private readonly int _m, _k;
    public BloomFilter(int expectedItems, double fpRate)
    {
        _m = (int)Math.Ceiling(-expectedItems * Math.Log(fpRate) / (Math.Log(2) * Math.Log(2)));
        _k = Math.Max(1, (int)Math.Round((double)_m / expectedItems * Math.Log(2)));
        _bits = new ulong[(_m + 63) / 64];
    }
    public void Add(ReadOnlySpan<byte> item) { foreach (var i in Indexes(item)) _bits[i >> 6] |= 1UL << (i & 63); }
    public bool MightContain(ReadOnlySpan<byte> item) { foreach (var i in Indexes(item)) if ((_bits[i >> 6] & (1UL << (i & 63))) == 0) return false; return true; }
    private IEnumerable<int> Indexes(ReadOnlySpan<byte> item)
    {
        var h = System.IO.Hashing.XxHash128.HashToUInt128(item);        // double hashing: h1 + i*h2
        ulong h1 = (ulong)h, h2 = (ulong)(h >> 64);
        var result = new int[_k];
        for (var i = 0; i < _k; i++) result[i] = (int)((h1 + (ulong)i * h2) % (ulong)_m);
        return result;
    }
}
// 10 M ids at 1% FP: m ≈ 95.9 M bits ≈ 12 MB, k ≈ 7
~~~`,
  pts: [r`Bit array plus k hashes: no false negatives, tunable false positives.`, r`About 9.6 bits per item for 1% false positives.`, r`No deletes; use counting or Cuckoo filters if needed.`, r`Used to skip disk reads and block cache penetration.`, r`Never use where a false positive has a serious business cost without a fallback check.`],
  ex: r`An API gateway used a Bloom filter of valid merchant ids to drop enumeration attacks before they reached the database.`,
  fu: [r`How would you scale a Bloom filter across nodes?`],
  pit: [r`Undersizing the filter so the false-positive rate climbs past expectations.`] },

{ id: 'q22', level: 'Senior', tags: ['consistent-hashing'],
  q: r`Explain consistent hashing with virtual nodes. Why not just use hash(key) mod N?`,
  a: r`With {{hash(key) mod N}}, changing N (adding or removing a server) remaps almost **every** key: caches go cold, data must move massively.

**Consistent hashing** maps both servers and keys onto a ring (hash space). A key belongs to the first server clockwise. Adding or removing a server only moves the keys in the affected arc: about 1/N of keys.

**Virtual nodes**: each physical server gets many points on the ring (e.g. 100 to 200). This smooths load distribution, and when a server leaves, its keys spread across many servers rather than one neighbour. Weighting (more vnodes) handles heterogeneous capacity.

Used by Cassandra, DynamoDB (internally), Redis Cluster (with fixed hash slots, a related idea), CDNs, sharded caches, and load balancers with session affinity. **Rendezvous (highest random weight) hashing** is a simpler alternative with similar properties.`,
  code: r`~~~csharp
public sealed class HashRing(int virtualNodes = 150)
{
    private readonly SortedDictionary<uint, string> _ring = new();
    private uint[] _keys = [];
    public void AddNode(string node)
    {
        for (var i = 0; i < virtualNodes; i++) _ring[Hash(node + "#" + i)] = node;
        _keys = _ring.Keys.ToArray();
    }
    public void RemoveNode(string node)
    {
        for (var i = 0; i < virtualNodes; i++) _ring.Remove(Hash(node + "#" + i));
        _keys = _ring.Keys.ToArray();
    }
    public string NodeFor(string key)
    {
        var h = Hash(key);
        var idx = Array.BinarySearch(_keys, h);
        if (idx < 0) idx = ~idx;                      // first point clockwise
        if (idx == _keys.Length) idx = 0;             // wrap around
        return _ring[_keys[idx]];
    }
    private static uint Hash(string s) => System.IO.Hashing.XxHash32.HashToUInt32(Encoding.UTF8.GetBytes(s));
}
~~~`,
  dia: r`flowchart LR
  K1[key A] -->|clockwise| N1[Server 1 vnode]
  K2[key B] -->|clockwise| N2[Server 2 vnode]
  K3[key C] -->|clockwise| N3[Server 3 vnode]
  N1 --- N2 --- N3 --- N1
  ADD[Add Server 4] -.only keys in its arc move.-> N2`,
  pts: [r`mod N remaps nearly all keys when N changes.`, r`Consistent hashing moves only about 1/N of keys.`, r`Virtual nodes smooth distribution and spread failover load.`, r`Weights handle servers of different capacity.`, r`Rendezvous hashing is a simpler alternative.`],
  ex: r`A cache cluster using mod N lost 90% of hits every time a node was added; consistent hashing reduced that to about 10%.`,
  fu: [r`How does Redis Cluster's hash-slot model differ?`],
  pit: [r`Few virtual nodes causing hot servers.`] },

{ id: 'q23', level: 'Senior', tags: ['skip-list'],
  q: r`What is a skip list, and why does Redis use one for sorted sets?`,
  a: r`A **skip list** is a sorted linked list with extra "express lane" levels: each node is promoted to higher levels with probability p (typically 1/2 or 1/4). Search starts at the top level and drops down, giving **expected O(log n)** search, insert and delete.

Why Redis uses it for sorted sets (combined with a hash table for member -> score):

- Simple to implement and reason about compared with balanced trees.
- Efficient **range operations** (ZRANGEBYSCORE) by walking the bottom level.
- Rank queries supported by storing span widths per link.
- Good concurrency properties in lock-free variants (Java's ConcurrentSkipListMap).

Trade-offs: probabilistic balance (worst case O(n) is astronomically unlikely), more pointers per node than a tree.`,
  code: r`~~~text
Level 3:  head ----------------------------> 50 ------------------------> nil
Level 2:  head ----------> 20 -------------> 50 -----------> 80 --------> nil
Level 1:  head --> 10 --> 20 --> 30 --> 40 -> 50 --> 60 --> 80 --> 90 -> nil
Search 60: L3 head->50 (next nil, drop), L2 50->80 too far (drop), L1 50->60 found: ~log n steps
~~~
~~~csharp
// .NET has no built-in skip list; SortedSet (red-black tree) covers the same ordered-set needs
var leaderboard = new SortedSet<(long Score, string Player)>(Comparer<(long, string)>.Create((a, b) =>
    b.Item1 != a.Item1 ? b.Item1.CompareTo(a.Item1) : string.CompareOrdinal(a.Item2, b.Item2)));
~~~`,
  pts: [r`A skip list layers express lanes over a sorted linked list.`, r`Expected O(log n) search, insert and delete.`, r`Redis sorted sets pair a skip list with a hash table.`, r`Range walks and rank queries are natural.`, r`Simpler than balanced trees; balance is probabilistic.`],
  ex: r`Understanding the skip list explained why ZRANGEBYSCORE with LIMIT stays fast even on 50-million-member leaderboards.`,
  fu: [r`How does a skip list support rank queries?`],
  pit: [r`Claiming skip lists are worst-case O(log n).`] },

{ id: 'q24', level: 'Senior', tags: ['ring-buffer'],
  q: r`Ring buffers: how do they work and why are they used in high-performance systems (logging, market data, the LMAX Disruptor)?`,
  a: r`A **ring buffer** is a fixed-size array with head and tail indices that wrap around (index mod capacity, or bit-masking when capacity is a power of two). Writes and reads are O(1) with no allocations after construction.

Why high-performance systems use them:

- **No GC pressure**: slots are preallocated and reused.
- **Cache-friendly** sequential memory.
- **Bounded**: natural backpressure or overwrite-oldest semantics.
- **Single-producer/single-consumer** variants can be lock-free with memory barriers only.

Examples: the LMAX Disruptor (trading), audio buffers, in-memory "last N" logs, network card queues, {{Queue<T>}} itself (a growable circular buffer), and {{System.Threading.Channels}} bounded channels conceptually.

Pitfalls: overwrite policy must be explicit; false sharing between head and tail counters (pad them onto separate cache lines).`,
  code: r`~~~csharp
public sealed class RingBuffer<T>(int capacityPowerOfTwo)
{
    private readonly T[] _items = new T[capacityPowerOfTwo];
    private readonly int _mask = capacityPowerOfTwo - 1;
    private long _head, _tail;                     // head = next write, tail = next read (single producer, single consumer)
    public bool TryWrite(T item)
    {
        var h = Volatile.Read(ref _head);
        if (h - Volatile.Read(ref _tail) == _items.Length) return false;    // full: caller applies backpressure
        _items[h & _mask] = item;
        Volatile.Write(ref _head, h + 1);                                    // publish after the write
        return true;
    }
    public bool TryRead(out T item)
    {
        var t = Volatile.Read(ref _tail);
        if (t == Volatile.Read(ref _head)) { item = default!; return false; }
        item = _items[t & _mask];
        Volatile.Write(ref _tail, t + 1);
        return true;
    }
}
~~~`,
  pts: [r`Fixed array with wrapping head and tail: O(1), zero allocations.`, r`Power-of-two capacity allows bit-mask indexing.`, r`Bounded by design: backpressure or overwrite-oldest.`, r`SPSC variants are lock-free with memory barriers.`, r`Watch false sharing between counters.`],
  ex: r`A market-data gateway replaced a ConcurrentQueue with an SPSC ring buffer and cut p99 latency from 80 µs to 12 µs at 1 million messages per second.`,
  fu: [r`What is false sharing and how do you pad against it?`],
  pit: [r`Multi-producer use of an SPSC ring buffer.`] },

{ id: 'q25', level: 'Senior', tags: ['graphs', 'topological-sort'],
  q: r`Topological sort: solve dependency ordering (builds, migrations, service startup) and detect cycles.`,
  a: r`A **topological order** of a directed acyclic graph lists nodes so every edge goes from earlier to later. **Kahn's algorithm**:

1. Compute in-degrees.
2. Queue all nodes with in-degree 0.
3. Pop a node, append to the order, decrement neighbours' in-degrees, enqueue those reaching 0.
4. If the order contains fewer nodes than the graph, there is a **cycle**.

O(V + E). Using a priority queue instead of a queue gives a deterministic order (useful for reproducible builds).

Production uses: build systems (MSBuild project graph), database migration ordering, Terraform resource graphs, Helm/Kubernetes dependency startup, task schedulers (DAGs in Airflow), spreadsheet recalculation.`,
  code: r`~~~csharp
public static List<string> TopoSort(Dictionary<string, List<string>> deps)   // node -> nodes that depend on it
{
    var indeg = deps.Keys.Concat(deps.Values.SelectMany(v => v)).Distinct().ToDictionary(n => n, _ => 0);
    foreach (var (_, outs) in deps) foreach (var m in outs) indeg[m]++;
    var ready = new PriorityQueue<string, string>(indeg.Where(kv => kv.Value == 0).Select(kv => (kv.Key, kv.Key)));
    var order = new List<string>();
    while (ready.TryDequeue(out var n, out _))
    {
        order.Add(n);
        foreach (var m in deps.GetValueOrDefault(n, [])) if (--indeg[m] == 0) ready.Enqueue(m, m);
    }
    if (order.Count != indeg.Count) throw new InvalidOperationException("Cycle detected: " + string.Join(",", indeg.Where(kv => kv.Value > 0).Select(kv => kv.Key)));
    return order;
}
// deps: { "Domain": ["Application"], "Application": ["Api", "Infrastructure"], "Infrastructure": ["Api"] }
// -> Domain, Application, Infrastructure, Api
~~~`,
  pts: [r`Topological order puts every dependency before its dependants.`, r`Kahn's algorithm uses in-degrees and a queue: O(V + E).`, r`Leftover nodes mean a cycle; report them.`, r`A priority queue makes the order deterministic.`, r`Used by build systems, migrations, Terraform and DAG schedulers.`],
  ex: r`A deployment orchestrator for 60 microservices computed startup waves with Kahn's algorithm and failed fast with the cycle members listed when a team introduced a circular dependency.`,
  fu: [r`How do you compute parallel "waves" of independent tasks?`],
  pit: [r`Silently returning a partial order when a cycle exists.`] },

{ id: 'q26', level: 'Senior', tags: ['graphs', 'dijkstra'],
  q: r`Implement Dijkstra's shortest path. Where does it apply in business systems, and when do you need A* or Bellman-Ford?`,
  a: r`**Dijkstra** finds shortest paths from a source in graphs with **non-negative** weights: repeatedly take the unvisited node with the smallest tentative distance (min-heap) and relax its edges. O((V + E) log V) with a binary heap.

- **A***: Dijkstra plus a heuristic estimating remaining distance (straight-line distance on maps); explores far fewer nodes for point-to-point routing.
- **Bellman-Ford**: handles **negative weights** and detects negative cycles: O(VE). Classic finance use: **currency arbitrage** detection (weights = -log(rate); a negative cycle means arbitrage).

Business uses: delivery routing, network latency routing, cheapest payment routing across rails/correspondent banks (cost as weight), supply-chain lead times.`,
  code: r`~~~csharp
public static Dictionary<string, decimal> Dijkstra(Dictionary<string, List<(string To, decimal Cost)>> g, string source)
{
    var dist = new Dictionary<string, decimal> { [source] = 0 };
    var pq = new PriorityQueue<string, decimal>(); pq.Enqueue(source, 0);
    while (pq.TryDequeue(out var node, out var d))
    {
        if (d > dist[node]) continue;                               // stale queue entry
        foreach (var (to, cost) in g.GetValueOrDefault(node, []))
        {
            var nd = d + cost;
            if (!dist.TryGetValue(to, out var cur) || nd < cur) { dist[to] = nd; pq.Enqueue(to, nd); }
        }
    }
    return dist;
}
// Cheapest route for a cross-border payment: nodes = banks/rails, cost = fees + FX spread
~~~`,
  pts: [r`Dijkstra: min-heap of tentative distances, non-negative weights only.`, r`O((V + E) log V) with a binary heap.`, r`A* adds a heuristic for faster point-to-point routing.`, r`Bellman-Ford handles negative weights and detects negative cycles.`, r`Negative cycles in -log(rate) graphs reveal FX arbitrage.`],
  ex: r`A cross-border payments router chose the cheapest correspondent-bank path with Dijkstra on fee-plus-spread weights, saving basis points on every transfer.`,
  fu: [r`How would you include time-of-day cut-off windows?`],
  pit: [r`Using Dijkstra with negative edge weights.`] },

{ id: 'q27', level: 'Senior', tags: ['union-find'],
  q: r`What is Union-Find (disjoint set), and where does it beat graph traversal?`,
  a: r`**Union-Find** maintains a partition of elements into disjoint sets with two operations:

- {{Find(x)}}: representative of x's set.
- {{Union(a, b)}}: merge the sets.

With **path compression** and **union by rank/size**, both run in nearly constant amortised time (inverse Ackermann).

It beats repeated BFS/DFS when edges arrive **incrementally** and you need connectivity answers along the way: entity resolution (merge customer records sharing email/phone/device), fraud ring detection as links stream in, Kruskal's minimum spanning tree, network connectivity, grouping duplicate accounts.

It does not support splitting sets efficiently; for deletions you rebuild or use other structures.`,
  code: r`~~~csharp
public sealed class UnionFind
{
    private readonly Dictionary<string, string> _parent = new();
    private readonly Dictionary<string, int> _size = new();
    public string Find(string x)
    {
        if (!_parent.ContainsKey(x)) { _parent[x] = x; _size[x] = 1; }
        while (_parent[x] != x) { _parent[x] = _parent[_parent[x]]; x = _parent[x]; }   // path halving
        return x;
    }
    public void Union(string a, string b)
    {
        string ra = Find(a), rb = Find(b);
        if (ra == rb) return;
        if (_size[ra] < _size[rb]) (ra, rb) = (rb, ra);                                  // union by size
        _parent[rb] = ra; _size[ra] += _size[rb];
    }
}
// Entity resolution: accounts sharing any identifier end up in one cluster
var uf = new UnionFind();
foreach (var a in accounts) { uf.Union(a.Id, "email:" + a.Email); uf.Union(a.Id, "device:" + a.DeviceId); }
var clusters = accounts.GroupBy(a => uf.Find(a.Id));
~~~`,
  pts: [r`Union-Find tracks disjoint sets with Find and Union.`, r`Path compression plus union by size gives near-constant amortised time.`, r`Ideal for incremental connectivity as links arrive.`, r`Used in entity resolution, fraud clustering and Kruskal's MST.`, r`It does not support splitting sets.`],
  ex: r`A KYC team merged 30 million customer records into identity clusters by unioning on shared emails, phones and devices in minutes.`,
  fu: [r`How would you distribute this over a cluster?`],
  pit: [r`No path compression, giving long chains.`] },

{ id: 'q28', level: 'Senior', tags: ['hyperloglog', 'count-min'],
  q: r`HyperLogLog and Count-Min Sketch: how do they work at a high level, and what accuracy do you get?`,
  a: r`**HyperLogLog (HLL)** estimates distinct counts. Hash each item; use the first bits to pick one of m registers; in each register keep the maximum number of leading zeros seen in the remaining bits. Rare long runs of zeros indicate many distinct items. A harmonic mean across registers gives the estimate. Standard error ≈ **1.04 / √m**: with m = 16,384 registers (Redis uses this, 12 KB), error ≈ 0.81%. HLLs **merge** by taking register maxima, so daily sketches combine into weekly ones.

**Count-Min Sketch** estimates frequencies: a d × w matrix of counters with d hash functions; increment one counter per row; the estimate is the **minimum** across rows. It never underestimates; overestimation is bounded by ε·N with w = e/ε and confidence 1 - δ with d = ln(1/δ). Used for heavy hitters, rate limiting by key at scale, and hot-key detection.`,
  code: r`~~~csharp
public sealed class CountMinSketch(int width, int depth)
{
    private readonly long[,] _t = new long[depth, width];
    public void Add(string key, long n = 1) { for (var d = 0; d < depth; d++) _t[d, Index(key, d)] += n; }
    public long Estimate(string key) { var min = long.MaxValue; for (var d = 0; d < depth; d++) min = Math.Min(min, _t[d, Index(key, d)]); return min; }
    private int Index(string key, int seed) => (int)(System.IO.Hashing.XxHash32.HashToUInt32(Encoding.UTF8.GetBytes(key), seed) % (uint)width);
}
// width = 2,719 (e ≈ 2.718 / 0.001) and depth = 7 -> estimates within 0.1% of total count with 99.9% confidence, ~150 KB
~~~
~~~text
Redis: PFADD uniq:2026-10-10 user:42 ; PFCOUNT uniq:2026-10-10 ; PFMERGE uniq:week uniq:2026-10-04 ... uniq:2026-10-10
~~~`,
  pts: [r`HLL estimates distinct counts from leading-zero runs across registers.`, r`Error ≈ 1.04/√m: Redis HLL is ~0.81% in 12 KB.`, r`HLLs merge by register maxima.`, r`Count-Min estimates frequencies; never underestimates.`, r`Use them where approximate answers are acceptable and memory is tight.`],
  ex: r`A payments analytics service tracked distinct cards per merchant per day for 2 million merchants in HLLs, using a few GB instead of hundreds.`,
  fu: [r`Why does Count-Min take the minimum?`],
  pit: [r`Using approximate counts for billing.`] },

{ id: 'q29', level: 'Senior', tags: ['caching', 'eviction'],
  q: r`Compare LRU, LFU, FIFO, TTL and W-TinyLFU eviction. Which do you choose for which workload?`,
  a: r`- **FIFO**: evict oldest inserted; cheap, ignores access patterns.
- **LRU**: evict least recently used; good for recency-heavy workloads; vulnerable to **scan pollution** (one big scan evicts the hot set).
- **LFU**: evict least frequently used; protects popular items; slow to adapt when popularity shifts unless counts decay.
- **TTL**: time-based expiry; required for correctness of stale data regardless of policy.
- **W-TinyLFU** (Caffeine in Java; similar ideas in modern caches): a small LRU "window" for new items plus a frequency sketch (Count-Min) admission filter for the main segment; near-optimal hit rates across workloads and scan resistant.
- **ARC / 2Q**: balance recency and frequency with ghost lists.

.NET {{MemoryCache}} evicts by priority, expiration and compaction percentage (not pure LRU); Redis offers approximated LRU and LFU ({{allkeys-lfu}}). Choose LFU-like policies for skewed popularity (product catalogue), LRU for session-like recency, and always TTLs for freshness.`,
  code: r`~~~csharp
builder.Services.AddMemoryCache(o => { o.SizeLimit = 50_000; o.CompactionPercentage = 0.2; });
cache.Set("product:" + id, product, new MemoryCacheEntryOptions
{
    Size = 1,                                            // counts toward SizeLimit
    AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10),
    SlidingExpiration = TimeSpan.FromMinutes(2),
    Priority = product.IsBestSeller ? CacheItemPriority.High : CacheItemPriority.Normal
});
~~~
~~~ini
# Redis: frequency-based eviction for a skewed catalogue cache
maxmemory-policy allkeys-lfu
lfu-decay-time 1
~~~`,
  pts: [r`LRU suits recency but suffers scan pollution.`, r`LFU protects popular items but must decay counts.`, r`W-TinyLFU combines a recency window with a frequency admission filter.`, r`TTL is about freshness, independent of eviction.`, r`Pick by workload skew and measure hit ratio.`],
  ex: r`Switching a catalogue cache from LRU to LFU raised the hit ratio from 82% to 94% because nightly export scans no longer flushed best sellers.`,
  fu: [r`What is scan pollution?`],
  pit: [r`Choosing an eviction policy without measuring hit ratios.`] },

{ id: 'q30', level: 'Senior', tags: ['graphs', 'fraud'],
  q: r`How would you store and query relationships for fraud detection (shared devices, cards, addresses)? Graph database or relational?`,
  a: r`Model: entities (accounts, cards, devices, addresses, IPs) as nodes and "used"/"shares" as edges. Questions: "accounts within 2 hops of a known fraudster", "connected components above size 10", "new account linked to a device seen with chargebacks".

Options:

- **Relational with recursive CTEs or adjacency tables**: fine for 1 to 2 hops with good indexes; deeper traversals get expensive.
- **Graph database** (Neo4j, Amazon Neptune, Azure Cosmos DB Gremlin, TigerGraph): index-free adjacency makes multi-hop traversals fast; good for interactive investigation and real-time 2 to 3 hop checks.
- **In-memory structures** (adjacency lists, Union-Find for components) computed in batch/stream jobs for features fed into ML models.

Typical architecture: events stream into a graph store and a feature store; real-time scoring uses precomputed features (component size, distance to known fraud) plus limited hops; investigators use the graph DB UI.`,
  code: r`~~~sql
-- Relational: accounts within 2 hops of a flagged account via shared devices
WITH hop1 AS (SELECT DISTINCT u2.AccountId FROM DeviceUse u1 JOIN DeviceUse u2 ON u2.DeviceId = u1.DeviceId WHERE u1.AccountId = @flagged),
     hop2 AS (SELECT DISTINCT u4.AccountId FROM hop1 h JOIN DeviceUse u3 ON u3.AccountId = h.AccountId JOIN DeviceUse u4 ON u4.DeviceId = u3.DeviceId)
SELECT AccountId FROM hop1 UNION SELECT AccountId FROM hop2;
~~~
~~~text
// Cypher (Neo4j): same question, any depth up to 3
MATCH (f:Account {id: $flagged})-[:USED*1..3]-(a:Account) WHERE a <> f RETURN DISTINCT a.id
~~~`,
  pts: [r`Model entities as nodes and shared usage as edges.`, r`Relational works for shallow hops with good indexes.`, r`Graph databases make multi-hop traversals fast.`, r`Precompute graph features (component size, distance to fraud) for real-time scoring.`, r`Investigators need an interactive graph view.`],
  ex: r`A neobank's graph features (shared device with a charged-back account within 2 hops) became the top predictor in its onboarding fraud model.`,
  fu: [r`How do you keep graph features fresh in real time?`],
  pit: [r`Running deep traversals synchronously in the payment authorisation path.`] },

{ id: 'q31', level: 'Senior', tags: ['time-series', 'storage'],
  q: r`Which data structures suit time-series data (metrics, ticks), and how do TSDBs compress it?`,
  a: r`Characteristics: append-mostly, ordered by time, queried by ranges and aggregates, huge volume.

Structures and techniques:

- **Time-partitioned chunks** (hourly/daily blocks) for retention by dropping chunks.
- **Columnar layout** per series: timestamps and values stored separately.
- **Delta-of-delta encoding** for timestamps (regular intervals compress to almost nothing).
- **XOR (Gorilla) compression** for floating values: consecutive values often share bits; Facebook's Gorilla achieves ~1.37 bytes per point.
- **Downsampling / rollups** (1s -> 1m -> 1h) with retention per resolution.
- **Inverted index on labels/tags** to find series (Prometheus).
- **Ring buffers** for in-memory recent windows.

Products: Prometheus/Mimir, InfluxDB, TimescaleDB (PostgreSQL hypertables), Azure Data Explorer, kdb+ in trading, MongoDB time-series collections.`,
  code: r`~~~text
Timestamps (every 10 s): 1000, 1010, 1020, 1030, 1041
Deltas:                        10,   10,   10,   11
Delta-of-delta:                       0,    0,    1    -> mostly zeros, encoded in 1 bit each
Values: 101.25, 101.25, 101.26 -> XOR with previous: 0, small bit pattern -> few bits per value
~~~
~~~sql
-- TimescaleDB: hypertable chunks + automatic compression + continuous aggregate rollups
SELECT create_hypertable('ticks', 'ts', chunk_time_interval => interval '1 day');
ALTER TABLE ticks SET (timescaledb.compress, timescaledb.compress_segmentby = 'symbol');
SELECT add_compression_policy('ticks', interval '7 days');
~~~`,
  pts: [r`Time-series data is append-mostly and range-queried.`, r`Partition into time chunks for retention.`, r`Delta-of-delta for timestamps and XOR (Gorilla) for values compress dramatically.`, r`Downsample to rollups with tiered retention.`, r`Index series by labels to find them quickly.`],
  ex: r`Moving tick history to a columnar compressed store cut storage from 40 TB to 3 TB and made 1-year backtests 10x faster.`,
  fu: [r`What is the high-cardinality problem in Prometheus?`],
  pit: [r`Unbounded label cardinality (user ids as labels).`] },

{ id: 'q32', level: 'Senior', tags: ['merkle-tree'],
  q: r`What is a Merkle tree, and where is it used (replication, audit logs, blockchains)?`,
  a: r`A **Merkle tree** hashes data blocks at the leaves; each parent hashes its children; the root hash summarises the whole dataset. Properties:

- Any change in a leaf changes the root: **tamper evidence**.
- Two replicas can find differences by comparing roots, then only descending into subtrees whose hashes differ: **O(log n) comparisons** to locate divergent ranges (anti-entropy repair in Cassandra and DynamoDB-style systems).
- **Inclusion proofs**: prove an item is in the set with log n sibling hashes (Certificate Transparency logs, blockchains, git objects).

Financial uses: tamper-evident audit logs (publish daily root hashes), proving that an exported ledger matches the system of record, efficient reconciliation between large datasets.`,
  code: r`~~~csharp
public static byte[] MerkleRoot(IReadOnlyList<byte[]> leaves)
{
    if (leaves.Count == 0) return SHA256.HashData([]);
    var level = leaves.Select(l => SHA256.HashData(l)).ToList();
    while (level.Count > 1)
    {
        var next = new List<byte[]>((level.Count + 1) / 2);
        for (var i = 0; i < level.Count; i += 2)
        {
            var right = i + 1 < level.Count ? level[i + 1] : level[i];         // duplicate last if odd
            next.Add(SHA256.HashData([.. level[i], .. right]));
        }
        level = next;
    }
    return level[0];
}
// Daily: root over all ledger entries of the day -> stored in a separate system / sent to auditors
~~~`,
  dia: r`flowchart TB
  R[Root hash] --> H12[H12 = hash H1+H2]
  R --> H34[H34 = hash H3+H4]
  H12 --> H1[H1 = hash tx1]
  H12 --> H2[H2 = hash tx2]
  H34 --> H3[H3 = hash tx3]
  H34 --> H4[H4 = hash tx4]`,
  pts: [r`Leaves are hashed; parents hash children; the root summarises everything.`, r`Any change alters the root: tamper evidence.`, r`Replicas find divergent ranges in O(log n) comparisons.`, r`Inclusion proofs need only log n sibling hashes.`, r`Used in anti-entropy repair, transparency logs, git and audit trails.`],
  ex: r`A broker published a daily Merkle root of its trade audit log to a regulator, making any later alteration of history detectable.`,
  fu: [r`How does Cassandra use Merkle trees in repair?`],
  pit: [r`Hashing without domain separation between leaves and nodes (second-preimage tricks).`] },

{ id: 'q33', level: 'Senior', tags: ['spatial', 'geohash'],
  q: r`How do you index spatial data for "nearby" queries (geohash, quadtree, R-tree, H3)?`,
  a: r`- **Geohash**: interleaves latitude/longitude bits into a base-32 string; shared prefixes mean nearby cells. Easy to index with B-trees and prefixes. Edge cases at cell boundaries: query the cell plus its 8 neighbours.
- **Quadtree**: recursively splits space into four quadrants; adapts to density (more splits where points cluster).
- **R-tree**: groups nearby objects into bounding rectangles; great for shapes and polygons (PostGIS GiST, SQL Server spatial indexes).
- **H3** (Uber): hexagonal hierarchical grid; uniform neighbour distances, good for aggregation and surge-pricing-style analytics.
- **S2** (Google): sphere-based cells used by many services.

Choose by query: point-nearby with simple infra (geohash in Redis/DynamoDB), polygons and complex shapes (R-tree/PostGIS), analytics and aggregation (H3).`,
  code: r`~~~sql
-- PostGIS with a GiST (R-tree-like) index: ATMs within 2 km, nearest first
CREATE INDEX ix_atms_geo ON atms USING gist (location);
SELECT id, name, ST_Distance(location, ST_MakePoint(-0.1278, 51.5074)::geography) AS metres
FROM atms
WHERE ST_DWithin(location, ST_MakePoint(-0.1278, 51.5074)::geography, 2000)
ORDER BY location <-> ST_MakePoint(-0.1278, 51.5074)::geography LIMIT 10;
~~~
~~~text
Redis: GEOADD atms -0.1278 51.5074 atm:42 ; GEOSEARCH atms FROMLONLAT -0.12 51.50 BYRADIUS 2 km ASC COUNT 10
~~~`,
  pts: [r`Geohash prefixes give nearby cells; check neighbours at boundaries.`, r`Quadtrees adapt to point density.`, r`R-trees index shapes and polygons (PostGIS GiST).`, r`H3 hexagons suit aggregation and analytics.`, r`Choose by query type and existing infrastructure.`],
  ex: r`A card-fraud rule flagging "impossible travel" used H3 cells to compare transaction locations cheaply in a streaming job.`,
  fu: [r`Why do geohash queries need neighbour cells?`],
  pit: [r`Computing distances for every row without a spatial index.`] },

{ id: 'q34', level: 'Senior', tags: ['collections', 'choosing'],
  q: r`You are reviewing code that uses the wrong collections. Give a decision guide for .NET collections.`,
  a: r`| Need | Use | Avoid |
|---|---|---|
| Ordered list, index access | {{List<T>}} / arrays | LinkedList (cache misses) |
| Fast membership | {{HashSet<T>}} | {{List.Contains}} in loops |
| Key lookup | {{Dictionary<K,V>}} | Linear search over a list of pairs |
| Static lookup built once | {{FrozenDictionary}} / {{FrozenSet}} | Rebuilding dictionaries per request |
| FIFO / LIFO | {{Queue<T>}} / {{Stack<T>}} | {{RemoveAt(0)}} on lists |
| Priority scheduling, top-K | {{PriorityQueue<E,P>}} | Sorting on every insert |
| Ordered keys, ranges | {{SortedDictionary}} / {{SortedSet}} | Sorting a dictionary repeatedly |
| Concurrent key/value | {{ConcurrentDictionary}} | Dictionary + lock everywhere |
| Producer/consumer | {{Channel<T>}} | Polling loops on a ConcurrentQueue |
| Immutable snapshots | {{ImmutableArray}} / Frozen* | Exposing mutable lists |
| Large buffers | {{ArrayPool<T>}}, spans | Allocating new arrays per call |
| Read-only API surface | {{IReadOnlyList<T>}} | Returning List<T> |`,
  code: r`~~~csharp
// Before: O(n*m) and allocations per request
var blocked = _repo.BlockedCountries();                         // List<string> loaded every call
var flagged = payments.Where(p => blocked.Contains(p.Country)).ToList();
// After: load once, O(1) membership, fast reads
private readonly FrozenSet<string> _blocked = repo.BlockedCountries().ToFrozenSet(StringComparer.OrdinalIgnoreCase);
var flagged2 = payments.Where(p => _blocked.Contains(p.Country)).ToList();
~~~`,
  pts: [r`Lists and arrays for index access; avoid linked lists for performance.`, r`HashSet and Dictionary for membership and lookups.`, r`Frozen collections for static reference data.`, r`PriorityQueue, SortedSet and Channel for scheduling, ranges and pipelines.`, r`Expose read-only interfaces; pool large buffers.`],
  ex: r`A code review replacing List.Contains with a FrozenSet in a payment screening loop cut CPU for that endpoint by 70%.`,
  fu: [r`When is LinkedList<T> actually the right choice?`],
  pit: [r`Loading reference lists from the database on every request.`] },

{ id: 'q35', level: 'Senior', tags: ['frontend', 'data-structures'],
  q: r`Which data-structure choices matter in Angular/React front ends (normalised state, maps, virtual lists)?`,
  a: r`- **Normalised state**: store entities by id ({{Record<string, Order>}} or {{Map}}) plus id arrays for order, instead of nested duplicated objects. Updates touch one place; lookups are O(1). (Redux Toolkit's {{createEntityAdapter}}, NgRx Entity.)
- **Immutable updates**: new references for changed objects so change detection (OnPush, signals, React memo) works; structural sharing keeps it cheap.
- **Sets and Maps** for selections and lookups instead of {{array.includes}} in render loops.
- **Virtualised lists** (CDK virtual scroll, react-window) render only visible rows: O(visible) DOM nodes for 100,000-row lists.
- **Memoised selectors** ({{computed}} signals, {{useMemo}}, reselect) avoid recomputing derived data.
- **Tries or indexes** for client-side typeahead over large static lists.`,
  code: r`~~~typescript
// Normalised orders state with O(1) updates and stable references for unchanged rows
type OrdersState = { byId: Record<string, Order>; ids: string[]; selected: Set<string> };
function updateStatus(s: OrdersState, id: string, status: Order['status']): OrdersState {
  return { ...s, byId: { ...s.byId, [id]: { ...s.byId[id], status } } };   // only one entity object changes
}
// Angular signals: derived data computed once per change, not per render
readonly orders = signal<OrdersState>(initial);
readonly pendingTotal = computed(() => this.orders().ids.map(id => this.orders().byId[id])
  .filter(o => o.status === 'PENDING').reduce((s, o) => s + o.total, 0));
~~~`,
  pts: [r`Normalise entities by id with separate ordering arrays.`, r`Immutable updates keep change detection correct and cheap.`, r`Use Set and Map for selections and lookups.`, r`Virtualise long lists to render only visible rows.`, r`Memoise derived data with computed signals or selectors.`],
  ex: r`A trade blotter with 50,000 rows went from 4-second freezes to smooth scrolling after normalising state and adding virtual scrolling.`,
  fu: [r`When is a global store unnecessary?`],
  pit: [r`Deeply nested state with duplicated entities.`] },

{ id: 'q36', level: 'Senior', tags: ['order-book', 'design'],
  q: r`Design the data structures for a limit order book with price-time priority. What are the operations and complexities?`,
  a: r`Operations: add order, cancel order, match incoming orders against the best opposite price, query best bid/ask and depth.

Structures:

- **Per side, price levels in sorted order**: a sorted map (red-black tree) from price to level, or, for bounded tick ranges, an **array indexed by price tick** with a pointer to the best level (O(1) best price, very cache friendly).
- **Per price level, a FIFO queue** of orders (time priority): a linked list or array-backed queue.
- **Order id index**: hash map from order id to its node for O(1) cancel.

Complexities: add O(log P) with a tree (O(1) with tick arrays), cancel O(1), best price O(1), match O(1) per filled order.

Production concerns: single-threaded matching per instrument (deterministic, no locks), event sourcing of order events for recovery, and preallocated object pools to avoid GC pauses.`,
  code: r`~~~csharp
public sealed class OrderBookSide(bool isBid)
{
    private readonly SortedDictionary<long, LinkedList<Order>> _levels =                       // price tick -> FIFO queue
        new(Comparer<long>.Create((a, b) => isBid ? b.CompareTo(a) : a.CompareTo(b)));
    private readonly Dictionary<long, LinkedListNode<Order>> _byId = new();                    // O(1) cancel

    public void Add(Order o)
    {
        if (!_levels.TryGetValue(o.PriceTick, out var q)) _levels[o.PriceTick] = q = new LinkedList<Order>();
        _byId[o.Id] = q.AddLast(o);                                                           // time priority
    }
    public bool Cancel(long orderId)
    {
        if (!_byId.Remove(orderId, out var node)) return false;
        var q = node.List!; q.Remove(node);
        if (q.Count == 0) _levels.Remove(node.Value.PriceTick);
        return true;
    }
    public (long Price, LinkedList<Order> Queue)? Best => _levels.Count == 0 ? null : (_levels.First().Key, _levels.First().Value);
}
public sealed record Order(long Id, long PriceTick, long Qty, DateTimeOffset At);
~~~`,
  pts: [r`Sorted price levels per side; FIFO queue per level for time priority.`, r`Hash map from order id to node for O(1) cancels.`, r`Tick-indexed arrays give O(1) best price for bounded ranges.`, r`Single-threaded matching per instrument for determinism.`, r`Event-source order events and pool objects to avoid GC pauses.`],
  ex: r`A crypto exchange's matching engine moved from a tree to tick-indexed arrays for liquid pairs, cutting median match latency from 9 µs to 2 µs.`,
  fu: [r`How do you recover the book after a crash?`],
  pit: [r`Using a List per level with RemoveAt for cancels (O(n)).`] },

{ id: 'q37', level: 'Principal', tags: ['system-design', 'data-structures'],
  q: r`How do data-structure choices drive system design? Give examples where the right structure changed the architecture.`,
  a: r`Architectural decisions often reduce to "which data structure, where":

- **Rate limiting at scale**: sliding-window logs (sorted sets) vs counters vs token buckets determine memory and Redis load.
- **Leaderboards**: sorted sets (skip lists) make rank queries O(log n); a relational ORDER BY does not scale for live ranks.
- **Deduplication of events**: an exact set grows forever; a Bloom filter or time-bucketed sets bound memory with accepted error.
- **Distinct counts** for analytics: HyperLogLog turns terabytes into kilobytes, enabling real-time dashboards.
- **Sharding**: consistent hashing vs range partitioning determines rebalancing cost and hot spots.
- **Storage engines**: B-tree vs LSM-tree drives database choice for read-heavy vs write-heavy workloads.
- **Search**: inverted indexes push you to OpenSearch rather than LIKE queries.

Principal skill: recognise the structure behind the requirement and choose infrastructure that implements it natively.`,
  code: r`~~~text
Requirement                                   Structure            Infrastructure that provides it
"Unique visitors per merchant, real time"      HyperLogLog          Redis PFADD/PFCOUNT
"Rank of player among 50 M, live"              Skip list/sorted set Redis ZADD/ZREVRANK
"Has this event id been processed?" (huge)     Bloom + exact store  Redis BF + DB unique key
"Distribute sessions across cache nodes"       Consistent hashing   Redis Cluster slots / client ring
"Nearby drivers"                               Geohash / R-tree     Redis GEO / PostGIS
"Full-text search with relevance"              Inverted index       OpenSearch / Azure AI Search
~~~`,
  pts: [r`Many architecture choices are data-structure choices in disguise.`, r`Recognise the structure behind each requirement.`, r`Pick infrastructure that implements it natively.`, r`Approximate structures trade accuracy for huge memory savings.`, r`Storage engine structure (B-tree vs LSM) drives database selection.`],
  ex: r`A real-time fraud dashboard became feasible only after switching distinct-card counts from SQL COUNT DISTINCT to HyperLogLog in Redis.`,
  fu: [r`Give an example where the wrong structure caused an outage.`],
  pit: [r`Treating infrastructure choices as unrelated to data structures.`] },

{ id: 'q38', level: 'Principal', tags: ['interview-scenario'],
  q: r`Design an in-memory rate limiter for an API gateway handling 200,000 requests per second across 10,000 API keys. Which structures?`,
  a: r`Requirements: per-key limits (e.g. 1,000 requests/minute), low latency (< 50 µs per check), bounded memory, accuracy close to exact, distributed across gateway nodes.

Per node:

- **Token bucket per key**: two numbers (tokens, last refill timestamp) in a struct; O(1) check; memory ~32 bytes per key -> 10,000 keys is trivial.
- Store buckets in a **ConcurrentDictionary** or, better, **striped arrays** indexed by key hash to avoid allocation and contention; update atomically with {{Interlocked.CompareExchange}} on packed values, or lock per stripe.

Across nodes:

- **Local limits as a share** of the global limit (limit / nodes) with periodic rebalancing: no network calls per request, slight inaccuracy.
- **Central store** (Redis Lua token bucket) for exactness at the cost of a network hop; batch decrements (lease tokens in chunks of 50) to cut calls.

Evict idle keys with a timestamp wheel or periodic sweep. Return {{429}} with {{Retry-After}}.`,
  code: r`~~~csharp
public sealed class TokenBuckets(int stripes, double ratePerSec, double burst)
{
    private struct Bucket { public double Tokens; public long LastTicks; }
    private readonly Dictionary<string, Bucket>[] _shards = Enumerable.Range(0, stripes).Select(_ => new Dictionary<string, Bucket>()).ToArray();
    private readonly Lock[] _locks = Enumerable.Range(0, stripes).Select(_ => new Lock()).ToArray();

    public bool TryTake(string key, long nowTicks)
    {
        var s = (int)((uint)key.GetHashCode() % (uint)_shards.Length);
        lock (_locks[s])
        {
            ref var b = ref CollectionsMarshal.GetValueRefOrAddDefault(_shards[s], key, out var existed);
            if (!existed) { b.Tokens = burst; b.LastTicks = nowTicks; }
            b.Tokens = Math.Min(burst, b.Tokens + (nowTicks - b.LastTicks) / (double)TimeSpan.TicksPerSecond * ratePerSec);
            b.LastTicks = nowTicks;
            if (b.Tokens < 1) return false;
            b.Tokens -= 1; return true;
        }
    }
}
~~~`,
  pts: [r`A token bucket per key is two numbers and an O(1) check.`, r`Stripe state by key hash to reduce contention and allocation.`, r`Local share of the global limit avoids per-request network calls.`, r`Redis Lua buckets give exactness; lease tokens in chunks to cut round trips.`, r`Evict idle keys and return 429 with Retry-After.`],
  ex: r`A gateway that called Redis on every request added 1 ms p50; leasing tokens in chunks of 50 cut Redis calls by 98% with under 2% limit overshoot.`,
  fu: [r`How would you implement a sliding-window log instead, and what does it cost?`],
  pit: [r`A global lock around all buckets.`] },

{ id: 'q39', level: 'Principal', tags: ['memory', 'gc'],
  q: r`Your service holds a 20 GB in-memory index and suffers long GC pauses. What data-structure changes do you consider?`,
  a: r`GC cost scales with the number of **live references** the GC must trace, especially in gen 2. A 20 GB heap of millions of small objects is expensive to mark.

Options:

- **Fewer, larger objects**: arrays of structs instead of object graphs; replace {{Dictionary<string, Obj>}} with struct arrays plus a compact index.
- **Avoid references inside structs** (strings) where possible: store string data in one big char/byte pool with offsets.
- **Off-heap / unmanaged memory** ({{NativeMemory.Alloc}}, memory-mapped files) for the bulk data, with a managed façade; GC no longer scans it.
- **Frozen / pinned object heap** (POH) for long-lived buffers that interop with native code.
- **GC settings**: Server GC, {{GCHeapAffinitizeMask}}, regions (default since .NET 7), concurrent GC, and DATAS for container density. Consider {{GCSettings.LatencyMode = SustainedLowLatency}} for latency-sensitive periods.
- **Move the index out of process**: Redis, a dedicated search engine, or a memory-mapped file-based index.

Measure with dotnet-counters (gc-heap-size, time-in-gc), GC traces in PerfView, and heap dumps for object counts before changing.`,
  code: r`~~~csharp
// Before: millions of small objects with string references (GC must trace each)
Dictionary<string, Instrument> byIsin;            // 30 M entries: 30 M Instrument objects + 30 M strings
// After: struct records in one array + an open-addressed index of int positions; strings in one UTF-8 pool
public readonly record struct InstrumentRow(int IsinOffset, int IsinLength, double Price, int IssuerId);
public sealed class InstrumentStore
{
    private InstrumentRow[] _rows = [];            // one large array, no per-row object headers
    private byte[] _isinPool = [];                 // all ISIN bytes contiguously
    private int[] _slots = [];                     // open addressing: hash(isin) -> row index (-1 empty)
    // lookups compare spans over _isinPool; the GC sees 3 arrays instead of 60 M objects
}
~~~
~~~bash
dotnet-counters monitor -n Pricing --counters System.Runtime[time-in-gc,gc-heap-size,gen-2-gc-count]
~~~`,
  pts: [r`GC cost scales with live references, not bytes alone.`, r`Replace object graphs with struct arrays and pooled string storage.`, r`Off-heap or memory-mapped storage removes data from GC tracing.`, r`Tune GC mode, regions and latency modes for the workload.`, r`Measure with counters, traces and heap dumps first.`],
  ex: r`A reference-data service cut gen-2 pauses from 1.8 s to 40 ms by moving 25 M instruments from objects to struct arrays with a pooled ISIN buffer.`,
  fu: [r`What is the Pinned Object Heap?`],
  pit: [r`Raising container memory limits as the only fix.`] },

{ id: 'q40', level: 'Principal', tags: ['probabilistic', 'trade-offs'],
  q: r`When is it acceptable to use approximate data structures in a financial institution, and how do you govern that?`,
  a: r`Acceptable where an approximate answer **informs** rather than **decides** a financial outcome, or where it filters before an exact check:

- **Analytics and dashboards**: distinct customers (HLL), top merchants (Top-K).
- **Pre-filters**: Bloom filters for "definitely not in the sanctions list hash set" **followed by an exact check** on "maybe".
- **Operational protection**: approximate rate limiting, hot-key detection.
- **Fraud features**: approximate velocity counts as model inputs, where the model tolerates noise.

Not acceptable for: balances, billing, regulatory reports, limits that are contractually binding, or any decision a customer can dispute without an exact record.

Governance:

- Document the error bounds and where each approximate structure is used (data catalogue).
- Validate periodically against exact computation (sample audits).
- Make the exact data available for disputes.
- Model-risk review when approximations feed decision models.`,
  code: r`~~~csharp
// Approximate pre-filter, exact decision
public async Task<ScreeningResult> ScreenAsync(string normalisedName, CancellationToken ct)
{
    if (!_bloom.MightContain(Encoding.UTF8.GetBytes(normalisedName))) return ScreeningResult.Clear;   // definitely not listed
    return await _exactSanctionsIndex.ContainsAsync(normalisedName, ct)                               // exact check on "maybe"
        ? ScreeningResult.PotentialMatch : ScreeningResult.Clear;
}
~~~`,
  pts: [r`Use approximations to inform, not to decide financial outcomes.`, r`Pair Bloom filters with an exact check on "maybe".`, r`Never approximate balances, billing, regulatory reports or binding limits.`, r`Document error bounds and validate against exact computation.`, r`Keep exact data for disputes; model-risk review where relevant.`],
  ex: r`A bank used Bloom-filter pre-screening to skip 97% of exact sanctions lookups while every potential match still went through the exact list and human review.`,
  fu: [r`How would you explain HyperLogLog error to a risk committee?`],
  pit: [r`Using approximate counts for fee calculations.`] },

{ id: 'q41', level: 'Principal', tags: ['code-review'],
  q: r`Code review: identify the data-structure and complexity problems in this reconciliation code.`,
  a: r`~~~csharp
public List<string> FindUnmatched(List<LedgerEntry> ledger, List<BankLine> bank)
{
    var unmatched = new List<string>();
    foreach (var l in ledger)
    {
        bool found = false;
        foreach (var b in bank)
            if (b.Reference == l.Reference && b.Amount == l.Amount) { found = true; bank.Remove(b); break; }
        if (!found && !unmatched.Contains(l.Reference)) unmatched.Add(l.Reference);
    }
    return unmatched;
}
~~~

1. **O(n·m) nested loop**: 2 M x 2 M comparisons; build a dictionary of bank lines by (Reference, Amount) for O(n + m).
2. **bank.Remove(b)**: O(m) shift each time, and it **mutates the caller's list**, a hidden side effect.
3. **unmatched.Contains**: O(k) per check; use a HashSet.
4. Amount equality on {{decimal}} is fine, but if these were doubles it would be wrong; also currency is ignored in the match key.
5. Duplicates: two bank lines with the same reference and amount should match two ledger entries; use a count or a queue per key, not a set.
6. String comparison should be ordinal and normalised (trim, case) as agreed with operations.`,
  code: r`~~~csharp
public static IReadOnlyList<string> FindUnmatched(IReadOnlyList<LedgerEntry> ledger, IReadOnlyList<BankLine> bank)
{
    var available = new Dictionary<(string Ref, decimal Amount, string Ccy), int>();
    foreach (var b in bank)
        CollectionsMarshal.GetValueRefOrAddDefault(available, (b.Reference.Trim().ToUpperInvariant(), b.Amount, b.Currency), out _)++;
    var unmatched = new List<string>();
    var seen = new HashSet<string>(StringComparer.Ordinal);
    foreach (var l in ledger)
    {
        var key = (l.Reference.Trim().ToUpperInvariant(), l.Amount, l.Currency);
        ref var count = ref CollectionsMarshal.GetValueRefOrNullRef(available, key);
        if (!Unsafe.IsNullRef(ref count) && count > 0) { count--; continue; }      // consume one match (handles duplicates)
        if (seen.Add(l.Reference)) unmatched.Add(l.Reference);
    }
    return unmatched;   // O(n + m), inputs untouched
}
~~~`,
  pts: [r`Nested loops make it O(n·m); index one side in a dictionary.`, r`List.Remove inside the loop is O(m) and mutates the caller's data.`, r`List.Contains for dedupe is O(k); use a HashSet.`, r`Include currency in the match key and handle duplicate lines with counts.`, r`Normalise references consistently.`],
  ex: r`This exact pattern took 11 hours on month-end volumes; the dictionary version ran in 4 seconds.`,
  fu: [r`How would you add a tolerance match on value dates?`],
  pit: [r`Fixing complexity but still mutating the input list.`] },

{ id: 'q42', level: 'Principal', tags: ['interview-scenario', 'design'],
  q: r`Design a deduplication service for 1 billion events per day where each event id must be processed once within a 7-day window.`,
  a: r`Scale: 1 B/day ≈ 11,600 events/s average, peaks ~50,000/s; 7 days = 7 B ids. Storing 7 B 16-byte ids exactly is ~112 GB plus overhead.

Design:

- **Exact layer**: partitioned key-value store (DynamoDB / Cassandra / Redis cluster) with conditional insert ({{attribute_not_exists}} / SET NX) and TTL 7 days. Partition by event-id hash. Conditional insert is the dedupe decision: atomic and exact.
- **Bloom-filter front layer** per time bucket (one per hour, rotating) to answer "definitely new" without hitting the store for most events; on "maybe seen", go to the exact store. At 1% false positives, about 1.2 bytes per id.
- **Time-bucketed structures**: drop whole buckets after 7 days instead of per-key expiry.
- **Stream partitioning by event id** (Kafka key) so the same id always reaches the same consumer instance: allows a local in-memory cache for very recent ids.
- **Idempotent downstream**: dedupe is defence in depth; side effects remain idempotent.`,
  code: r`~~~text
Capacity: 7 B ids x (16 B id + ~40 B store overhead) ≈ 390 GB in the exact store (partitioned)
Bloom per hour: 50 M ids/hour at 1% FP -> 9.6 bits/id ≈ 60 MB/hour, 168 hours ≈ 10 GB in memory across consumers
Exact-store calls avoided: ~99% of genuinely new events skip it; duplicates and false positives go to the store
~~~
~~~csharp
public async Task<bool> IsFirstTimeAsync(string eventId, CancellationToken ct)
{
    var bytes = Encoding.UTF8.GetBytes(eventId);
    if (!_hourlyBlooms.Any(b => b.MightContain(bytes))) { _currentBloom.Add(bytes); return await _store.TryInsertAsync(eventId, ttl: TimeSpan.FromDays(7), ct); }
    return await _store.TryInsertAsync(eventId, TimeSpan.FromDays(7), ct);   // conditional insert decides exactly
}
~~~`,
  pts: [r`Do the arithmetic: billions of ids need partitioned storage.`, r`An exact conditional insert with TTL is the source of truth.`, r`Time-bucketed Bloom filters skip most store calls.`, r`Partition the stream by event id for locality.`, r`Keep downstream side effects idempotent as defence in depth.`],
  ex: r`An ad-tech platform cut deduplication store costs by 80% with hourly Bloom filters in front of DynamoDB conditional writes.`,
  fu: [r`What happens to deduplication during a region failover?`],
  pit: [r`Relying on a Bloom filter alone to decide (false positives drop real events).`] },

{ id: 'q43', level: 'Principal', tags: ['mentoring', 'interviews'],
  q: r`How do you assess data-structure skills in candidates for Lead/Principal roles without LeetCode trivia?`,
  a: r`Assess applied judgement:

- **Realistic problems**: "this reconciliation takes 11 hours; here is the code" (complexity analysis and refactoring), "design a rate limiter's state", "pick storage for a leaderboard".
- **Trade-off discussion**: ask for two approaches and when each wins (memory vs CPU, exact vs approximate, read vs write heavy).
- **Scaling the structure**: what changes at 100x data? In-memory to distributed (sharding, consistent hashing).
- **Production concerns**: concurrency, GC, persistence, failure.
- **Code review exercise**: spot wrong collections and O(n²) patterns.
- Still check fundamentals (hash tables, trees, heaps, Big-O) quickly, since they underpin every answer.

Principal signals: they quantify (back-of-envelope sizes), name the infrastructure that implements the structure, and discuss governance of approximations.`,
  code: r`~~~text
Interview exercise (45 min)
1. Read FindUnmatched (nested loops, List.Remove). What is the complexity? Fix it.      (15 min)
2. Volumes grow 50x and data no longer fits in memory. Redesign.                        (15 min)
3. Operations wants a "probably duplicate" flag in real time. Which structure, what error, how governed? (15 min)
Signals: quantifies sizes, handles duplicates, mentions partitioning/streaming, exact check after approximate filter.
~~~`,
  pts: [r`Use realistic problems from your domain, not puzzles.`, r`Ask for two approaches and when each wins.`, r`Push to 100x scale and production concerns.`, r`Include a code-review exercise.`, r`Principal signals: quantification, infrastructure mapping, governance.`],
  ex: r`Replacing a LeetCode-hard round with a reconciliation code-review exercise improved hiring signal for senior backend roles according to post-hire performance reviews.`,
  fu: [r`How do you calibrate interviewers?`],
  pit: [r`Puzzle-only interviews that ignore production judgement.`] },

{ id: 'q44', level: 'Principal', tags: ['hashing', 'security'],
  q: r`Hash functions in practice: when do you use non-cryptographic hashes, cryptographic hashes, HMACs and password hashes?`,
  a: r`| Purpose | Use | .NET |
|---|---|---|
| Hash tables, sharding, Bloom filters, checksums for corruption | Fast non-cryptographic hash | {{XxHash64}}, {{XxHash3}}, {{Crc32}} (System.IO.Hashing) |
| Integrity against tampering, content addressing, Merkle trees | Cryptographic hash | {{SHA256.HashData}} |
| Authenticate messages with a shared secret (webhooks, API signing) | HMAC | {{HMACSHA256.HashData}} |
| Store passwords | Slow, salted password hash | PBKDF2 ({{Rfc2898DeriveBytes.Pbkdf2}}), ASP.NET Identity's hasher, Argon2 via libraries |
| Pseudonymise identifiers (PAN, national id) | Keyed hash (HMAC) or tokenisation | HMAC with a vault-held key |

Pitfalls: string.GetHashCode is randomised per process (never persist it); MD5/SHA-1 are broken for security; a plain SHA-256 of a card number is reversible by brute force (small space): use HMAC with a secret key or tokenisation; compare MACs with constant-time comparison ({{CryptographicOperations.FixedTimeEquals}}).`,
  code: r`~~~csharp
ulong shard = System.IO.Hashing.XxHash3.HashToUInt64(Encoding.UTF8.GetBytes(customerId)) % 64;    // fast, stable across processes
byte[] digest = SHA256.HashData(fileBytes);                                                          // integrity / content address
byte[] mac = HMACSHA256.HashData(webhookSecret, Encoding.UTF8.GetBytes(timestamp + "." + body));   // authenticity
bool valid = CryptographicOperations.FixedTimeEquals(mac, Convert.FromHexString(signatureHeader));  // constant-time compare
byte[] pwd = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations: 600_000, HashAlgorithmName.SHA256, outputLength: 32);
byte[] panToken = HMACSHA256.HashData(vaultKey, Encoding.ASCII.GetBytes(pan));                       // keyed pseudonym, not plain SHA-256
~~~`,
  pts: [r`Non-cryptographic hashes for tables, sharding and filters.`, r`SHA-256 for integrity and content addressing.`, r`HMAC for authenticity with shared secrets; compare in constant time.`, r`Slow salted hashes (PBKDF2, Argon2) for passwords.`, r`Never persist string.GetHashCode; never plain-hash small spaces like PANs.`],
  ex: r`A team sharded data with string.GetHashCode; after a restart, keys landed on different shards. XxHash3 fixed it.`,
  fu: [r`Why is plain SHA-256 of a PAN unsafe?`],
  pit: [r`Using MD5 or unsalted SHA for passwords.`] },

{ id: 'q45', level: 'Principal', tags: ['caching', 'distributed'],
  q: r`Design the data structures for a distributed session store serving 5 million concurrent users with failover.`,
  a: r`Sizing: 5 M sessions x ~2 KB = 10 GB plus overhead -> ~15 to 20 GB; with replication x2.

Structures and placement:

- **Hash of session fields** per session key ({{session:{id}}}) in Redis Cluster: O(1) access, partial updates without rewriting blobs, TTL per key (sliding expiry on activity).
- **Sharding** by hash slot (consistent placement), with replicas per shard for failover.
- **Secondary index** for "all sessions of user X" (needed for "log out everywhere"): a set per user. Put the user id in a **hash tag** in both keys ({{session:{userId}:{sid}}} and {{user-sessions:{userId}}}) so a user's sessions and index live in the same cluster slot and can be changed atomically.
- **Small, compact payloads**: ids and claims, not object graphs; MessagePack serialisation.
- **Revocation list** for JWT-based sessions if any (set with TTL = token lifetime).

Failover: replicas promote automatically; async replication can lose the last few writes (users may need to re-authenticate): acceptable for sessions, not for carts (persist carts in a database).`,
  code: r`~~~text
HSET session:{u42}:s9f3 uid u42 tenant t7 roles "trader" csrf 9a1c issued 1760090000
EXPIRE session:{u42}:s9f3 1800                      # sliding: refreshed on activity
SADD user-sessions:{u42} s9f3                        # same hash tag -> same slot as the user's sessions
EXPIRE user-sessions:{u42} 86400
# log out everywhere: SMEMBERS user-sessions:{u42} -> DEL each session:{u42}:<sid> in one MULTI (same slot)
~~~`,
  pts: [r`Size first: 5 M sessions x 2 KB is about 10 GB before overhead and replicas.`, r`Hash per session for partial updates and per-key TTLs.`, r`Co-locate a user's sessions and index with hash tags.`, r`Keep payloads compact; persist important state (carts) elsewhere.`, r`Accept that async replication can drop the last writes on failover.`],
  ex: r`A trading portal implemented "log out all devices" in one atomic operation by hash-tagging session keys by user id.`,
  fu: [r`How would you migrate sessions between clusters without logging everyone out?`],
  pit: [r`Storing entire user profiles in sessions.`] },

{ id: 'q46', level: 'Principal', tags: ['search', 'inverted-index'],
  q: r`Explain the inverted index and why databases struggle with full-text search. How does this shape your architecture?`,
  a: r`An **inverted index** maps each term to a **postings list** of documents (and positions) containing it. Query "trail shoe" intersects the postings for "trail" and "shoe" and ranks by relevance (BM25 uses term frequency, inverse document frequency and length normalisation).

Building it involves **analysis**: tokenisation, lower-casing, stemming, stop words, synonyms, n-grams for partial matching.

Relational B-tree indexes cannot serve {{LIKE '%shoe%'}} (no prefix to seek) or relevance ranking, so databases either scan or provide a separate full-text engine (SQL Server Full-Text, PostgreSQL tsvector + GIN).

Architecture: for serious search (relevance tuning, facets, typo tolerance, scale) use a dedicated engine (OpenSearch, Elasticsearch, Azure AI Search) fed by **CDC or outbox events**, accepting eventual consistency; keep the database as the source of truth and rebuild indexes from it.`,
  code: r`~~~text
Documents:  1 "red trail shoe"   2 "blue road shoe"   3 "trail jacket"
Inverted:   red -> [1]   trail -> [1, 3]   shoe -> [1, 2]   blue -> [2]   road -> [2]   jacket -> [3]
Query "trail shoe" (AND): [1, 3] ∩ [1, 2] = [1]
~~~
~~~sql
-- PostgreSQL built-in inverted index for moderate needs
CREATE INDEX ix_products_search ON products USING gin (to_tsvector('english', name || ' ' || description));
SELECT id FROM products WHERE to_tsvector('english', name || ' ' || description) @@ websearch_to_tsquery('english', 'trail shoe');
~~~`,
  dia: r`flowchart LR
  APP[.NET API] -->|writes| DB[(SQL database: source of truth)]
  DB -->|CDC / outbox| SYNC[Indexer]
  SYNC --> OS[(OpenSearch inverted index)]
  UI[Search UI] --> QAPI[Search API] --> OS`,
  pts: [r`An inverted index maps terms to postings lists of documents.`, r`Analysis (tokenising, stemming, synonyms) shapes matching.`, r`BM25 ranks by term frequency, rarity and length.`, r`B-trees cannot serve contains-queries or relevance.`, r`Use a search engine fed by CDC/outbox; the database stays the source of truth.`],
  ex: r`Moving product search from LIKE queries to OpenSearch cut search latency from 2.3 s to 60 ms and added typo tolerance.`,
  fu: [r`How do you reindex with zero downtime?`],
  pit: [r`Treating the search index as the system of record.`] },

{ id: 'q47', level: 'Principal', tags: ['concurrency', 'lock-free'],
  q: r`When are lock-free data structures worth their complexity in .NET?`,
  a: r`Lock-free structures use atomic operations (compare-and-swap via {{Interlocked}}) instead of locks so threads never block each other. Benefits: no deadlocks, progress under contention, lower tail latency when a lock holder could be descheduled.

Worth it when:

- Contention is high and critical sections are tiny (counters, single-producer/single-consumer queues, reference swaps).
- Latency tails matter (trading, market data, telemetry pipelines).
- You can use proven implementations: {{ConcurrentQueue}}, {{Channel}}, {{Interlocked}} counters, {{ImmutableInterlocked}} for copy-on-write swaps.

Not worth it when:

- Contention is low: a {{lock}} (especially .NET 9's {{Lock}}) is fast uncontended.
- Operations are compound and complex: correctness (ABA problem, memory ordering) is very hard to verify.

Practical approach: prefer **avoiding sharing** (partition data per thread/actor, immutable snapshots); use BCL concurrent types; write custom lock-free code only with benchmarks proving the need and stress tests (and ideally model checking).`,
  code: r`~~~csharp
// Lock-free copy-on-write swap of an immutable snapshot
private ImmutableDictionary<string, decimal> _limits = ImmutableDictionary<string, decimal>.Empty;
public void SetLimit(string account, decimal limit) =>
    ImmutableInterlocked.AddOrUpdate(ref _limits, account, limit, (_, _) => limit);   // CAS loop inside
public decimal Limit(string account) => Volatile.Read(ref _limits).GetValueOrDefault(account);

// Lock-free counter
private long _processed;
public void Processed() => Interlocked.Increment(ref _processed);

// Custom CAS loop: atomic max
static void AtomicMax(ref long target, long value)
{ long cur; do { cur = Volatile.Read(ref target); if (value <= cur) return; } while (Interlocked.CompareExchange(ref target, value, cur) != cur); }
~~~`,
  pts: [r`Lock-free structures use CAS instead of locks: no blocking or deadlocks.`, r`Worth it for high contention, tiny critical sections and tail-latency goals.`, r`Prefer BCL concurrent types and immutable snapshot swaps.`, r`Uncontended locks are cheap; avoid custom lock-free code without evidence.`, r`Beware ABA and memory-ordering bugs; stress test.`],
  ex: r`A telemetry agent replaced a locked queue with a Channel and dropped p99 enqueue latency from 2 ms to 15 µs under 64-thread contention.`,
  fu: [r`What is the ABA problem?`],
  pit: [r`Hand-rolled lock-free structures without stress tests.`] },

{ id: 'q48', level: 'Principal', tags: ['data-modelling', 'trade-offs'],
  q: r`Normalised vs denormalised data: how do data-structure principles apply to database and API design?`,
  a: r`Normalisation (one fact in one place) optimises **writes and consistency**; denormalisation (copies shaped for reads) optimises **reads and availability**. The same trade-off as normalised front-end state vs view models.

Guidelines:

- **System of record normalised** (relational, constraints, one owner per fact).
- **Read models denormalised** per access pattern (CQRS projections, document stores, search indexes, caches), rebuilt from the source.
- **Duplicated data needs an owner and an update path** (events, CDC) plus a staleness budget.
- **Immutable facts** (price at time of purchase) should be copied, not referenced: they must not change when the source changes.
- In NoSQL, model for access patterns (denormalise deliberately); in APIs, shape responses for consumers (BFF) rather than exposing normalised tables.`,
  code: r`~~~sql
-- System of record: normalised
CREATE TABLE products (id bigint PRIMARY KEY, name nvarchar(200), price decimal(19,4));
CREATE TABLE order_lines (order_id bigint, product_id bigint REFERENCES products, qty int,
  unit_price decimal(19,4) NOT NULL,      -- deliberate copy: the price paid is an immutable fact
  PRIMARY KEY (order_id, product_id));
-- Read model: denormalised for the "my orders" screen, rebuilt from events
CREATE TABLE order_summaries (order_id bigint PRIMARY KEY, customer_id bigint, placed_at datetime2,
  item_count int, total decimal(19,4), first_item_name nvarchar(200));
~~~`,
  pts: [r`Normalise the system of record for consistent writes.`, r`Denormalise read models per access pattern.`, r`Every copy needs an owner, an update path and a staleness budget.`, r`Copy immutable facts like the price paid.`, r`Shape APIs for consumers instead of exposing tables.`],
  ex: r`A "my orders" screen joining 7 tables at 900 ms became a single-row read at 5 ms from a projection, while the normalised order schema stayed authoritative.`,
  fu: [r`How do you rebuild a corrupted read model?`],
  pit: [r`Referencing the current product price in historical orders.`] },

{ id: 'q49', level: 'Principal', tags: ['performance', 'leadership'],
  q: r`How do you build a culture where engineers choose data structures deliberately, without micro-optimising everything?`,
  a: r`- **Make complexity visible**: performance budgets per endpoint, load tests in CI on production-like data volumes, and dashboards of p95/p99 per route.
- **Review checklists** with a few data-structure questions: "lookup in a loop?", "collection sized?", "unbounded growth?", "allocation in hot path?".
- **Analysers**: Roslyn rules flagging {{List.Contains}} inside loops, missing capacity, LINQ in hot paths (where agreed).
- **Shared building blocks**: vetted caches, rate limiters, dedupe services, so teams reuse correct structures.
- **Benchmarks as artefacts**: BenchmarkDotNet results attached to performance PRs; regressions caught in CI for critical libraries.
- **Teach with incidents**: postmortems that trace back to an O(n²) or an unbounded dictionary become training material.
- **Focus on hot paths**: agree that clarity wins elsewhere.`,
  code: r`~~~yaml
# Nightly perf gate: benchmark critical libraries and fail on >10% regression
- name: Benchmarks
  run: dotnet run -c Release --project bench/Pricing.Bench -- --filter '*' --exporters json --artifacts ./bench-out
- name: Compare with baseline
  run: dotnet tool run resultscomparer --base ./baseline --diff ./bench-out --threshold 10%
~~~`,
  pts: [r`Make complexity visible with budgets, load tests and dashboards.`, r`Add a few data-structure questions to review checklists.`, r`Provide vetted shared building blocks.`, r`Benchmark critical paths and gate regressions in CI.`, r`Optimise hot paths; keep clarity elsewhere.`],
  ex: r`After postmortems on two O(n²) incidents became a 30-minute workshop, similar issues dropped to zero over the following year.`,
  fu: [r`How do you choose which paths are "hot"?`],
  pit: [r`Blanket micro-optimisation rules that hurt readability.`] },

{ id: 'q50', level: 'Principal', tags: ['summary'],
  q: r`Summarise how a Principal Engineer thinks about data structures.`,
  a: r`"I treat data structures as the core of system design, not an interview topic:

- I start from the access pattern and the numbers: size, read/write ratio, latency target, concurrency.
- I know the costs behind the APIs: amortised growth, hashing, cache locality, GC pressure, and I measure rather than guess.
- I map requirements to structures and then to infrastructure that implements them natively: B-trees vs LSM-trees, sorted sets, HyperLogLog, Bloom filters, inverted indexes, consistent hashing.
- I use approximate structures where they inform, never where they decide money, and I document error bounds.
- I keep systems of record normalised and read models denormalised with clear ownership.
- I make good choices the default with shared components, review checklists and performance gates."`,
  code: r`~~~csharp
// Access pattern -> structure -> complexity, in one place
var blocked  = repo.BlockedBins().ToFrozenSet();                          // membership, static: O(1), fastest reads
var byId     = new Dictionary<Guid, Order>(expected);                     // key lookup: O(1) avg, pre-sized
var topK     = new PriorityQueue<string, int>();                          // top-K: O(n log k)
var ladder   = new SortedDictionary<decimal, long>();                     // ordered ranges: O(log n)
var pipeline = Channel.CreateBounded<Event>(10_000);                      // producer/consumer with backpressure
~~~`,
  pts: [r`Start from access patterns and numbers.`, r`Know the hidden costs: growth, hashing, locality, GC.`, r`Map structures to infrastructure that implements them.`, r`Approximate structures inform, never decide money.`, r`Normalised sources, denormalised read models, shared defaults.`],
  ex: r`This framing, with one quantified example (an 11-hour reconciliation cut to seconds), lands strongly in Principal interviews.`,
  fu: [r`Which data structure has had the biggest impact in your career?`],
  pit: [r`Answering only with textbook complexity tables.`] }
],
cheat: r`### Complexity table
| Structure | Lookup | Insert | Delete | Ordered | .NET |
|---|---|---|---|---|---|
| Array/List | O(1) index, O(n) search | O(1)* end, O(n) middle | O(n) | by index | List<T>, T[] |
| Hash table | O(1) avg | O(1) avg | O(1) avg | no | Dictionary, HashSet, Frozen* |
| Red-black tree | O(log n) | O(log n) | O(log n) | yes | SortedDictionary, SortedSet |
| Sorted array | O(log n) | O(n) | O(n) | yes | SortedList |
| Binary heap | min O(1) | O(log n) | O(log n) | partial | PriorityQueue |
| Linked list | O(n) | O(1) at node | O(1) at node | insertion | LinkedList (rarely best) |

### Patterns
Complement lookup (two-sum) · sliding window · two pointers · prefix sums (+ Fenwick/segment tree when updating) · BFS (shortest hops) / DFS (components, cycles) · topological sort (Kahn) · Dijkstra (non-negative), Bellman-Ford (negative, arbitrage) · Union-Find (incremental connectivity) · size-K heap for top-K · interval merge with half-open ranges.

### System structures
B+tree (OLTP indexes) vs LSM-tree (write-heavy) · Bloom filter (~9.6 bits/item @1%) · HyperLogLog (0.81% in 12 KB) · Count-Min (never under) · consistent hashing + vnodes · skip list (Redis ZSET) · ring buffer · Merkle tree · inverted index · geohash/R-tree/H3 · W-TinyLFU.

### .NET performance
Pre-size collections · CollectionsMarshal spans/refs · structs and struct arrays · FrozenDictionary for static data · ConcurrentDictionary + Lazy for single creation · Channels for pipelines · avoid GC-heavy object graphs for huge in-memory indexes.

### Say this
"Access pattern first, then structure, then infrastructure." "Big-O hides constants and cache misses." "Approximate structures inform, never decide money." "Normalised source, denormalised read models."`
});
})(String.raw);
