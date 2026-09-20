# Data Structures & Algorithms — Cram Sheet

> Tier 2 · Source: `12-Data-Structures/` + `13-Algorithms/` (4 modules, 1,800 lines) · Read: 10 min
> At Principal level coding rounds are usually **medium difficulty with a clean-code and trade-off discussion**. Pattern recognition beats memorising solutions.

---

## 1. Complexity cheat table

| Structure | Access | Search | Insert | Delete | Notes |
|---|---|---|---|---|---|
| Array | O(1) | O(n) | O(n) | O(n) | cache-friendly — often beats "better" structures at small n |
| Dynamic array (`List<T>`) | O(1) | O(n) | O(1)* | O(n) | *amortised; doubles on growth |
| Linked list | O(n) | O(n) | O(1) | O(1) | pointer chasing kills cache locality |
| Hash table (`Dictionary`) | — | **O(1)** | O(1) | O(1) | O(n) worst case with a bad hash |
| BST (balanced) / `SortedDictionary` | O(log n) | O(log n) | O(log n) | O(log n) | ordered iteration, range queries |
| Heap / `PriorityQueue` | O(1) peek | O(n) | O(log n) | O(log n) | top-k, scheduling, Dijkstra |
| Trie | — | O(k) | O(k) | O(k) | prefix search, autocomplete |
| Graph (adj. list) | — | — | O(1) | O(V+E) | sparse; adjacency matrix for dense |

**.NET mapping:** `Dictionary`/`HashSet` · `List<T>` · `LinkedList<T>` · `Queue<T>`/`Stack<T>` · `SortedDictionary`(tree)/`SortedList`(array) · `PriorityQueue<TElement,TPriority>` (.NET 6+) · `ConcurrentDictionary`/`ConcurrentQueue`/`Channel<T>`.

---

## 2. The patterns (recognise these and most problems collapse)

| Pattern | Signal in the question | Examples |
|---|---|---|
| **Two pointers** | sorted array, pair/triplet, in-place | two-sum-sorted, 3-sum, remove duplicates, palindrome |
| **Sliding window** | contiguous subarray/substring, "longest/shortest … with" | longest substring without repeats, max sum size-k, min window |
| **Fast & slow pointers** | linked list cycle, middle element | cycle detection, find middle, happy number |
| **Hash map for O(1) lookup** | "have I seen this", counting, grouping | two-sum, anagram groups, first unique |
| **Prefix sum** | repeated range-sum queries, subarray sums | subarray sum equals k, range sum |
| **Binary search** | sorted, **or a monotonic answer space** | search rotated, find peak, **min capacity to ship in D days** |
| **BFS** | shortest path in an **unweighted** graph, level order | word ladder, rotting oranges, level-order traversal |
| **DFS / backtracking** | all combinations/permutations/paths, constraints | subsets, N-queens, sudoku, word search |
| **Heap / top-k** | "k largest/smallest/most frequent", merge k lists | top-k frequent, merge k sorted, median stream (two heaps) |
| **Dynamic programming** | count the ways / min-max / optimal, overlapping subproblems | coin change, edit distance, LIS, knapsack, house robber |
| **Union-Find** | connectivity, grouping, cycle in undirected graph | number of islands, redundant connection, accounts merge |
| **Topological sort** | dependency order, DAG, "course schedule" | build order, task scheduling |
| **Monotonic stack** | "next greater/smaller element", histogram | daily temperatures, largest rectangle |
| **Interval merge** | overlapping ranges, meeting rooms | merge intervals, insert interval, min meeting rooms (heap) |

**"Binary search on the answer" is the highest-value under-used pattern** — if you can check "is X feasible?" in O(n) and feasibility is monotonic, binary search X.

---

## 3. Sorting & searching

| Algorithm | Avg | Worst | Space | Stable |
|---|---|---|---|---|
| Quick sort | O(n log n) | **O(n²)** | O(log n) | no |
| Merge sort | O(n log n) | O(n log n) | **O(n)** | **yes** |
| Heap sort | O(n log n) | O(n log n) | O(1) | no |
| Counting/radix | O(n+k) | O(n+k) | O(k) | yes | *(bounded integer keys only)*

- **.NET `Array.Sort`/`List.Sort` = introsort** (quicksort → heapsort on deep recursion, insertion sort for small) and is **unstable**. **`OrderBy` (LINQ) is a stable merge sort.** That difference is a real interview question.
- **Binary search invariants:** use `lo + (hi - lo) / 2` to avoid overflow; be explicit about `[lo, hi]` vs `[lo, hi)`.

---

## 4. Graphs

- **BFS** = queue, shortest path in unweighted graphs, level by level. **DFS** = stack/recursion, path existence, cycle detection, topological order.
- **Dijkstra** — non-negative weights, priority queue, O((V+E) log V). **Bellman-Ford** — handles negative weights, detects negative cycles, O(VE). **A\*** — Dijkstra + heuristic.
- **Topological sort** — Kahn's algorithm (in-degree queue) or DFS post-order. Only on a DAG; **a cycle means no valid order** (that's how you detect one).
- **Union-Find** with path compression + union by rank ≈ O(α(n)) ≈ O(1).
- **MST** — Kruskal (sort edges + union-find) or Prim (heap).

---

## 5. Interview execution (this matters more than the algorithm at your level)

1. **Restate and clarify** — input size, ranges, duplicates, sorted?, empty/null, expected output on no-answer, memory constraints.
2. **Work an example by hand**, including an edge case.
3. **State the brute force and its complexity** — then improve. Never jump straight to the optimal without naming the baseline.
4. **Say the approach and complexity before coding**, and get agreement.
5. **Write clean code:** meaningful names, extracted helpers, guard clauses. **At Principal level readability is being graded.**
6. **Trace your code on the example** — find your own bug before they do.
7. **Then discuss trade-offs:** time/space, what changes at 10⁹ elements, what changes if it's streaming, is it parallelisable, and what you'd actually write in production (usually: use the BCL).

**Edge cases to check every time:** empty · single element · all identical · already sorted · reverse sorted · negatives/zero · overflow · duplicates · null.

---

## Top traps

1. Coding before clarifying constraints.
2. Not stating the brute force first.
3. Forgetting overflow in `(lo + hi) / 2`.
4. Off-by-one in binary search bounds.
5. Mutating a collection while iterating.
6. Claiming `Array.Sort` is stable.
7. Ignoring the recursion-stack space in the complexity answer.
8. Using recursion where depth could be 10⁵ (stack overflow).
9. Not handling the no-answer case.
10. Optimising complexity while writing unreadable code.

---

## Interview Q&A — Lead / Principal

### Q1 · What the coding round is actually grading at this level *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** any medium LeetCode-style problem, with an interviewer watching how you work.

**Answer (how to run it).** At Lead/Principal the algorithm is rarely the hard part — they're grading **communication, judgement and code quality** under mild pressure. Run it as: **clarify** (input size and ranges, duplicates, sorted, empty/null, expected output when there's no answer, memory limits) → **work a small example by hand including an edge case** → **state the brute force and its complexity out loud**, then improve from it, because jumping straight to the optimal removes the interviewer's ability to follow your reasoning → **state the approach and complexity and get agreement before typing** → write it cleanly with real names and extracted helpers → **trace your own code on the example** and find your bug before they do.

Then the part that distinguishes the level: finish with trade-offs. What changes at 10⁹ elements, what changes if the input is streaming rather than in memory, is it parallelisable, and **what would you actually write in production** — which is usually "use the BCL, this is `PriorityQueue<T>`." A candidate who hand-rolls a heap and then says they'd never ship it scores higher than one who doesn't notice.

**Why it lands.** Treats it as a collaboration, names complexity before coding, self-debugs, and ends on production judgement rather than the puzzle.
**✗ Weak answer.** Silent coding, then "done" — even with a correct optimal solution.
**↳ Follow-ups.** How would this change if the data didn't fit in memory? What's the .NET type you'd use?

---

### Q2 · When the "optimal" answer is wrong *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"You've got an O(n log n) solution. Can you do better?"* — or a code review where someone has over-optimised.

**Answer.** Sometimes, and I'd want to know whether it's worth it before doing it. Big-O describes growth, not cost, and constants and memory access patterns dominate at realistic sizes — a linear scan over a contiguous array frequently beats a "better" pointer-chasing structure well past the point the notation suggests, because of cache locality. So the honest answer to "can you do better" is often "asymptotically yes, and at our n it would be slower and harder to read — here's the threshold where it flips."

In review terms, that's the judgement I'd apply: an O(n) solution that's five lines and obvious beats an O(log n) one that's forty lines and subtle, unless n is genuinely large or it's on a hot path with a measurement behind it. Readability is a correctness property over a codebase's lifetime.

And the practical version: in .NET the answer is usually the BCL. `Array.Sort` is introsort and **unstable**; `OrderBy` is a stable merge sort — so if equal elements must keep their order, that choice is the whole answer, and knowing it matters more than being able to implement either.

**Why it lands.** Separates asymptotic from actual cost, gives a review criterion, and lands on a concrete .NET distinction.
**✗ Weak answer.** Always pursuing the lower complexity, or dismissing complexity analysis entirely.
**↳ Follow-ups.** Where's the threshold? When have you chosen the slower algorithm deliberately?

---

### Quick-fire (30 seconds each)

- **"How do you approach a problem you haven't seen?"** → Pattern-match on the signal rather than the surface. Contiguous subarray means sliding window; "k largest" means a heap; sorted input or a monotonic feasibility check means binary search — including binary search on the answer, which is the one people forget. Dependencies mean topological sort. I'll state the brute force and its complexity first so there's an agreed baseline, then say which pattern I think applies and why, and only then write code.
- **"When would you not use a Dictionary?"** → When n is small — an array scan wins on cache locality well past the point the big-O suggests, often up to a few dozen elements. When I need ordering or range queries, where a sorted structure is right. When keys are mutable, because mutating a key after insertion loses the entry permanently. And when memory matters, since a hash table carries real overhead per entry. Also worth naming: a bad `GetHashCode` degrades it to O(n), which is a genuine production failure mode.
- **"Quick sort or merge sort?"** → Quick sort in practice for in-memory arrays — better constants and O(log n) space — but its O(n²) worst case matters on adversarial input, which is why .NET uses introsort and falls back to heapsort on deep recursion. Merge sort when I need stability or I'm sorting something external or a linked list, at the cost of O(n) space. In .NET specifically: `Array.Sort` is introsort and unstable, `OrderBy` is a stable merge sort — so if equal elements must keep their order, that choice is the answer.

---

**Go deeper:** `12-Data-Structures/`, `13-Algorithms/` · **Related:** [[01-CSharp]], [[15-Low-Level-Design]]
