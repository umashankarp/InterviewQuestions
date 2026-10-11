(function (r) {
registerTopic('13-algorithms', {
related: ['12-data-structures', '29-performance-engineering', '14-system-design'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['binary-search'],
  q: r`Implement binary search correctly, and explain the variants interviewers use (first/last occurrence, search on answer).`,
  a: r`Binary search halves a sorted search space each step: O(log n). Correctness traps:

- **Overflow**: {{mid = lo + (hi - lo) / 2}}, not {{(lo + hi) / 2}}.
- **Loop invariant**: decide whether {{hi}} is inclusive or exclusive and keep it consistent.
- **Termination**: always shrink the range.

Variants:

- **Lower bound** (first index with value >= target) and **upper bound** (first > target) for first/last occurrence and counting duplicates.
- **Binary search on the answer**: when a predicate is monotonic ("can we ship all parcels in D days with capacity C?"), search the smallest C that satisfies it.
- **Rotated arrays**, peak finding.

.NET: {{Array.BinarySearch}} / {{List.BinarySearch}} return the bitwise complement of the insertion point when not found.`,
  code: r`~~~csharp
// Lower bound: first index i with a[i] >= target (a.Length if none). Half-open [lo, hi).
static int LowerBound(int[] a, int target)
{
    int lo = 0, hi = a.Length;
    while (lo < hi) { var mid = lo + (hi - lo) / 2; if (a[mid] < target) lo = mid + 1; else hi = mid; }
    return lo;
}
static int CountOf(int[] a, int x) => LowerBound(a, x + 1) - LowerBound(a, x);

// Binary search on the answer: minimum capacity to ship weights within 'days' (monotonic predicate)
static int MinCapacity(int[] w, int days)
{
    int lo = w.Max(), hi = w.Sum();
    while (lo < hi)
    {
        var mid = lo + (hi - lo) / 2;
        int needed = 1, load = 0;
        foreach (var x in w) { if (load + x > mid) { needed++; load = 0; } load += x; }
        if (needed <= days) hi = mid; else lo = mid + 1;
    }
    return lo;
}
~~~`,
  pts: [r`Halve a sorted space each step: O(log n).`, r`Use lo + (hi - lo) / 2 and a consistent inclusive/exclusive invariant.`, r`Lower and upper bound give first/last occurrence and counts.`, r`Binary search on the answer works whenever the predicate is monotonic.`, r`Array.BinarySearch returns ~insertionPoint when not found.`],
  ex: r`A capacity-planning tool binary-searched the smallest instance count meeting a latency SLO in a simulator, instead of trying every count.`,
  fu: [r`Search in a rotated sorted array?`, r`Why must the predicate be monotonic?`],
  pit: [r`Infinite loops from mid rounding with inclusive bounds.`],
  tip: r`State your invariant ("hi is exclusive") before coding. It prevents off-by-one bugs and impresses interviewers.` },

{ id: 'q2', level: 'Basic', tags: ['sorting'],
  q: r`Which sorting algorithm does .NET use, and when do stability and custom comparers matter?`,
  a: r`{{Array.Sort}} / {{List.Sort}} use **introsort**: quicksort that switches to heapsort when recursion gets too deep (guaranteeing O(n log n) worst case) and to insertion sort for small partitions. It is **unstable**: equal elements may be reordered.

LINQ's {{OrderBy}} is **stable** (it sorts keys with indices), allocates more, and is lazy.

Stability matters when you sort by one key after another (sort by time, then stably by priority keeps time order within each priority) and for deterministic output (reports, pagination).

Custom comparers: implement {{IComparer<T>}} consistently (antisymmetric, transitive) or sorting may throw or behave unpredictably. Culture-aware string sorting differs from ordinal; choose deliberately.

Complexity reminders: comparison sorts are Ω(n log n); counting/radix sort can be O(n) for bounded integer keys.`,
  code: r`~~~csharp
var trades = LoadTrades();
trades.Sort((a, b) => a.Price.CompareTo(b.Price));                      // introsort, unstable, in place

var ordered = trades.OrderBy(t => t.Priority).ThenBy(t => t.ReceivedAt)   // stable, deterministic
                    .ThenBy(t => t.Id).ToList();

// Comparer must be consistent; this one breaks transitivity with NaN prices
Comparison<Trade> bad = (a, b) => a.Px < b.Px ? -1 : 1;                   // never returns 0 -> undefined behaviour
Comparison<Trade> good = (a, b) => a.Px.CompareTo(b.Px);                  // handles NaN and equality

Array.Sort(names, StringComparer.Ordinal);                                 // byte-order, culture-independent
~~~`,
  pts: [r`Array.Sort uses introsort: O(n log n) worst case, unstable.`, r`LINQ OrderBy is stable but allocates more.`, r`Stability matters for multi-key sorts and deterministic output.`, r`Comparers must be consistent or sorting misbehaves.`, r`Counting/radix sort beat n log n for bounded integer keys.`],
  ex: r`A report paginated by an unstable sort on a non-unique column showed some rows on two pages and others on none; adding an id tiebreaker fixed it.`,
  fu: [r`Why is quicksort O(n²) in the worst case and how does introsort avoid it?`],
  pit: [r`Comparers that never return 0.`] },

{ id: 'q3', level: 'Basic', tags: ['recursion'],
  q: r`Recursion vs iteration in C#: when is recursion appropriate, and how do you avoid stack overflows?`,
  a: r`Recursion expresses problems defined in terms of smaller subproblems (trees, divide and conquer, backtracking) clearly. Costs in .NET:

- Each call uses stack space (default 1 MB for the main thread in many hosts, smaller in some); deep recursion (hundreds of thousands of levels) causes **StackOverflowException**, which **cannot be caught** and kills the process.
- No guaranteed tail-call optimisation in C#.
- Call overhead compared with loops.

Guidelines:

- Recursion for bounded-depth structures (balanced trees, JSON with known limits).
- Convert to iteration with an explicit {{Stack<T>}} for unbounded or adversarial depth (deep graphs, user-supplied nested data).
- Enforce maximum depth when parsing external input (System.Text.Json has {{MaxDepth}}).
- Memoise overlapping subproblems (dynamic programming) to avoid exponential time.`,
  code: r`~~~csharp
// Recursive: clear for bounded depth
static int Depth(Node? n) => n is null ? 0 : 1 + Math.Max(Depth(n.Left), Depth(n.Right));

// Iterative with an explicit stack: safe for adversarial depth
static int DepthIterative(Node? root)
{
    if (root is null) return 0;
    var max = 0; var stack = new Stack<(Node Node, int D)>(); stack.Push((root, 1));
    while (stack.Count > 0)
    {
        var (n, d) = stack.Pop(); max = Math.Max(max, d);
        if (n.Left is not null) stack.Push((n.Left, d + 1));
        if (n.Right is not null) stack.Push((n.Right, d + 1));
    }
    return max;
}
var opts = new JsonSerializerOptions { MaxDepth = 32 };   // bound recursion on untrusted input
~~~`,
  pts: [r`Recursion is natural for trees, divide and conquer and backtracking.`, r`StackOverflowException cannot be caught; it kills the process.`, r`C# has no guaranteed tail-call optimisation.`, r`Use an explicit stack for unbounded or adversarial depth.`, r`Bound depth on external input and memoise overlapping subproblems.`],
  ex: r`A malicious deeply nested JSON payload crashed an API process via recursive parsing until depth limits were enforced.`,
  fu: [r`How would you convert an in-order traversal to iteration?`],
  pit: [r`Recursive processing of user-supplied trees without a depth limit.`] },

{ id: 'q4', level: 'Basic', tags: ['two-pointers'],
  q: r`Two-pointer technique: solve "remove duplicates from a sorted array in place" and "container with most water".`,
  a: r`Two pointers move through a sequence (from the same end at different speeds, or from both ends) to avoid nested loops, giving O(n).

- **Same direction (slow/fast)**: compaction, removing duplicates, partitioning, cycle detection in linked lists (Floyd).
- **Opposite ends**: pair sums in sorted arrays, palindromes, "container with most water", trapping rain water.

For "container with most water": start at both ends; the area is limited by the shorter line, so move the pointer at the shorter line inward (moving the taller can never increase area). O(n) instead of O(n²).`,
  code: r`~~~csharp
// Same direction: keep unique values at the front, return new length
static int Dedupe(int[] a)
{
    if (a.Length == 0) return 0;
    var write = 1;
    for (var read = 1; read < a.Length; read++)
        if (a[read] != a[write - 1]) a[write++] = a[read];
    return write;
}
// Opposite ends: max area between two lines
static long MaxArea(int[] h)
{
    int l = 0, r = h.Length - 1; long best = 0;
    while (l < r)
    {
        best = Math.Max(best, (long)Math.Min(h[l], h[r]) * (r - l));
        if (h[l] < h[r]) l++; else r--;          // move the limiting side
    }
    return best;
}
~~~`,
  pts: [r`Two pointers replace nested loops with a single pass.`, r`Slow/fast pointers for compaction, dedupe and cycle detection.`, r`Opposite-end pointers for sorted pair problems and areas.`, r`Move the pointer that limits the result.`, r`O(n) time, O(1) extra space.`],
  ex: r`A data-cleansing step deduplicated sorted daily price files in place, avoiding a second 2 GB buffer.`,
  fu: [r`Detect a cycle in a linked list and find its start?`],
  pit: [r`Moving the taller pointer in the container problem.`] },

{ id: 'q5', level: 'Basic', tags: ['complexity-analysis'],
  q: r`How do you analyse the time and space complexity of code in a review, including hidden costs in LINQ and .NET APIs?`,
  a: r`Count how work grows with input size, including **hidden** loops:

- {{list.Contains}}, {{IndexOf}}, {{Remove(item)}}, {{Any}} with predicates: O(n).
- LINQ {{Count()}} on a non-collection enumerable: O(n); {{ElementAt}}: O(n); {{OrderBy}}: O(n log n) and allocates; {{ToList}} inside loops: O(n) each time.
- {{string.Concat}} in loops: O(n²) copying.
- Repeated enumeration of an {{IEnumerable}} re-runs the query (including database queries for {{IQueryable}}).
- Recursion without memoisation can be exponential.
- Space: copies ({{ToArray}}, {{Split}}), recursion depth, caches.

Then ask: what is n in production (10 or 10 million)? Constants and allocations matter at small n; growth matters at large n.`,
  code: r`~~~csharp
// Looks linear, is O(n*m) + repeated query execution
IEnumerable<Customer> active = db.Customers.Where(c => c.Active);       // IQueryable: runs on every enumeration
foreach (var o in orders)                                               // n
    if (active.Any(c => c.Id == o.CustomerId))                          // DB round trip per order!
        Process(o);

// Fixed: materialise once into a HashSet: O(n + m), one query
var activeIds = db.Customers.Where(c => c.Active).Select(c => c.Id).ToHashSet();
foreach (var o in orders) if (activeIds.Contains(o.CustomerId)) Process(o);
~~~`,
  pts: [r`Look for hidden loops: Contains, IndexOf, Remove, Any, Count().`, r`Repeated enumeration of IQueryable re-runs database queries.`, r`String concatenation in loops is O(n²).`, r`Count space too: copies, recursion depth, caches.`, r`Always ask what n is in production.`],
  ex: r`A code review caught an IQueryable enumerated inside a loop that issued 40,000 database queries per batch run.`,
  fu: [r`What is the complexity of OrderBy().First() vs MinBy()?`],
  pit: [r`Assuming LINQ calls are O(1).`] },

{ id: 'q6', level: 'Basic', tags: ['hashing', 'anagrams'],
  q: r`Group anagrams and find the first non-repeating character. What is the general "frequency map" technique?`,
  a: r`A **frequency map** counts occurrences in a dictionary (or an int array for small alphabets) in one pass, enabling O(n) answers to "how many", "which repeats", "are these equal multisets".

- **First non-repeating character**: count all, then scan again for the first with count 1. O(n).
- **Group anagrams**: anagrams share the same sorted letters or the same 26-count signature; use it as a dictionary key. Sorting each word costs O(k log k); a count signature costs O(k).
- **Valid anagram**: compare frequency arrays.

Use {{int[26]}} or {{stackalloc}} spans for ASCII lower-case for speed; dictionaries for Unicode.`,
  code: r`~~~csharp
static int FirstUnique(string s)
{
    Span<int> counts = stackalloc int[128];            // ASCII
    foreach (var c in s) counts[c]++;
    for (var i = 0; i < s.Length; i++) if (counts[s[i]] == 1) return i;
    return -1;
}
static IEnumerable<List<string>> GroupAnagrams(IEnumerable<string> words)
{
    var groups = new Dictionary<string, List<string>>();
    foreach (var w in words)
    {
        Span<int> sig = stackalloc int[26];
        foreach (var c in w) sig[c - 'a']++;
        var key = string.Join(',', sig.ToArray());       // O(k) signature instead of sorting
        if (!groups.TryGetValue(key, out var g)) groups[key] = g = new List<string>();
        g.Add(w);
    }
    return groups.Values;
}
~~~`,
  pts: [r`Count occurrences in one pass with a dictionary or array.`, r`First unique: count, then scan for count 1.`, r`Anagram groups share a sorted or count signature key.`, r`Count signatures are O(k); sorting is O(k log k).`, r`Use arrays/spans for small alphabets.`],
  ex: r`A name-matching pre-step grouped transposed customer names (anagram-like typos) to suggest duplicate records for review.`,
  fu: [r`How would you handle Unicode and case-insensitivity?`],
  pit: [r`Nested loops comparing every pair of words.`] },

{ id: 'q7', level: 'Intermediate', tags: ['dynamic-programming'],
  q: r`Explain dynamic programming with the coin change problem (minimum coins and number of ways).`,
  a: r`Dynamic programming solves problems with **overlapping subproblems** and **optimal substructure** by storing subproblem results.

Approach:

1. Define the state: {{dp[a]}} = minimum coins to make amount a.
2. Transition: {{dp[a] = min(dp[a - c] + 1)}} over coins c.
3. Base case: {{dp[0] = 0}}.
4. Order: compute a from 0 up (bottom-up) or memoise recursion (top-down).

Minimum coins: O(amount x coins) time, O(amount) space.
Number of ways (combinations): iterate coins in the outer loop so each combination is counted once: {{ways[a] += ways[a - c]}}.

Note the greedy approach (largest coin first) is only optimal for canonical coin systems (like GBP/USD denominations); DP works for any system.`,
  code: r`~~~csharp
static int MinCoins(int[] coins, int amount)
{
    var dp = new int[amount + 1];
    Array.Fill(dp, int.MaxValue); dp[0] = 0;
    for (var a = 1; a <= amount; a++)
        foreach (var c in coins)
            if (c <= a && dp[a - c] != int.MaxValue) dp[a] = Math.Min(dp[a], dp[a - c] + 1);
    return dp[amount] == int.MaxValue ? -1 : dp[amount];
}
static long Ways(int[] coins, int amount)
{
    var ways = new long[amount + 1]; ways[0] = 1;
    foreach (var c in coins)                       // coins outer: combinations, not permutations
        for (var a = c; a <= amount; a++) ways[a] += ways[a - c];
    return ways[amount];
}
// MinCoins([1, 3, 4], 6) == 2 (3+3); greedy would pick 4+1+1 = 3 coins
~~~`,
  pts: [r`DP needs overlapping subproblems and optimal substructure.`, r`Define state, transition, base case and evaluation order.`, r`Coin change: dp[a] = min(dp[a - c] + 1), O(amount x coins).`, r`Counting ways: coins in the outer loop to avoid permutations.`, r`Greedy only works for canonical coin systems.`],
  ex: r`A cash-dispensing ATM algorithm used DP to choose note combinations when some cassettes were empty, where greedy failed.`,
  fu: [r`How do you reconstruct which coins were used?`],
  pit: [r`Assuming greedy is always optimal.`] },

{ id: 'q8', level: 'Intermediate', tags: ['dynamic-programming', 'strings'],
  q: r`Edit distance (Levenshtein) and longest common subsequence: how do they work, and where are they used in business systems?`,
  a: r`**Edit distance**: minimum insertions, deletions and substitutions to turn string A into B. DP table {{d[i][j]}} = distance between prefixes; {{d[i][j] = min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i] != b[j]))}}. O(n·m) time; O(min(n, m)) space with two rows.

**LCS**: longest sequence present in both in order; similar DP. Underlies diff tools.

Business uses:

- **Fuzzy name matching** for sanctions screening, customer deduplication, payee matching (often normalised and combined with Jaro-Winkler and phonetic algorithms).
- Typo-tolerant search.
- Diffing documents and configuration changes for audit.

At scale, avoid computing distance against every record: block candidates first (same first letter/phonetic key, n-gram index), then compute exact distances.`,
  code: r`~~~csharp
static int Levenshtein(ReadOnlySpan<char> a, ReadOnlySpan<char> b)
{
    if (a.Length < b.Length) { var t = a; a = b; b = t; }
    Span<int> prev = stackalloc int[b.Length + 1], cur = stackalloc int[b.Length + 1];
    for (var j = 0; j <= b.Length; j++) prev[j] = j;
    for (var i = 1; i <= a.Length; i++)
    {
        cur[0] = i;
        for (var j = 1; j <= b.Length; j++)
            cur[j] = Math.Min(Math.Min(prev[j] + 1, cur[j - 1] + 1), prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
        cur.CopyTo(prev);
    }
    return prev[b.Length];
}
// Levenshtein("MOHAMMED", "MUHAMMAD") == 2 -> candidate match for review in screening
~~~`,
  pts: [r`Edit distance DP: insert, delete, substitute over prefix pairs.`, r`O(n·m) time; two rows give O(min(n, m)) space.`, r`LCS underlies diff tools.`, r`Used for fuzzy matching in screening, dedupe and search.`, r`At scale, block candidates before computing distances.`],
  ex: r`A sanctions-screening service blocked candidates by phonetic key, then computed edit distance, cutting comparisons from billions to thousands per name.`,
  fu: [r`What is Jaro-Winkler and why is it popular for names?`],
  pit: [r`Comparing every name against every list entry.`] },

{ id: 'q9', level: 'Intermediate', tags: ['greedy'],
  q: r`When does a greedy algorithm give the optimal answer? Solve interval scheduling and explain why greedy works.`,
  a: r`A greedy algorithm makes the locally best choice at each step without revisiting. It is optimal only when the problem has the **greedy-choice property** (a global optimum includes a locally optimal choice) and **optimal substructure**. Prove it (exchange argument) or test it; otherwise use DP.

**Interval scheduling (max non-overlapping meetings)**: sort by **end time** and take each meeting that starts after the last chosen one ends. Exchange argument: picking the earliest-ending meeting leaves the most room for the rest. O(n log n).

Other greedy successes: Huffman coding, Dijkstra, Kruskal/Prim, activity selection, fractional knapsack. Greedy failures: 0/1 knapsack, coin change with non-canonical coins.`,
  code: r`~~~csharp
public readonly record struct Meeting(int Start, int End);
static List<Meeting> MaxMeetings(IEnumerable<Meeting> ms)
{
    var chosen = new List<Meeting>(); var lastEnd = int.MinValue;
    foreach (var m in ms.OrderBy(m => m.End))
        if (m.Start >= lastEnd) { chosen.Add(m); lastEnd = m.End; }
    return chosen;
}
// Minimum rooms needed (sweep line): +1 at start, -1 at end, track the running maximum
static int MinRooms(IEnumerable<Meeting> ms)
{
    var events = ms.SelectMany(m => new[] { (m.Start, 1), (m.End, -1) }).OrderBy(e => e.Item1).ThenBy(e => e.Item2);
    int cur = 0, best = 0; foreach (var (_, d) in events) best = Math.Max(best, cur += d); return best;
}
~~~`,
  pts: [r`Greedy is optimal only with the greedy-choice property and optimal substructure.`, r`Prove with an exchange argument or fall back to DP.`, r`Interval scheduling: sort by end time, take compatible meetings.`, r`Sweep line computes the minimum rooms needed.`, r`Greedy fails for 0/1 knapsack and non-canonical coins.`],
  ex: r`A batch-window planner maximised the number of reconciliation jobs in a nightly window with earliest-finish-first scheduling.`,
  fu: [r`Why does sorting by start time fail?`],
  pit: [r`Using greedy without checking optimality.`] },

{ id: 'q10', level: 'Intermediate', tags: ['backtracking'],
  q: r`Backtracking: generate all subsets/permutations and solve constraint problems. How do you prune?`,
  a: r`Backtracking explores a decision tree depth-first, building a partial solution and undoing the last choice when it cannot lead to a valid solution.

Template: choose -> explore -> un-choose. Complexity is often exponential (2^n subsets, n! permutations), so **pruning** is essential:

- Check constraints as early as possible (partial sums exceeding the target).
- Sort input to cut branches early (skip duplicates, stop when the remaining values are too large).
- Bound with the best solution found so far (branch and bound).
- Memoise repeated states where possible (turning it into DP).

Business examples: combinations of invoices that sum to a payment (reconciliation of partial payments), rostering, configuration solvers. For large instances use constraint solvers (Google OR-Tools) or heuristics instead.`,
  code: r`~~~csharp
// Which open invoices sum exactly to a received payment? (subset sum with pruning)
static List<decimal>? MatchInvoices(decimal[] invoices, decimal payment)
{
    Array.Sort(invoices);
    var pick = new List<decimal>();
    bool Search(int start, decimal remaining)
    {
        if (remaining == 0) return true;
        for (var i = start; i < invoices.Length; i++)
        {
            if (invoices[i] > remaining) break;                              // sorted: no later value fits either
            if (i > start && invoices[i] == invoices[i - 1]) continue;       // skip duplicate branches
            pick.Add(invoices[i]);
            if (Search(i + 1, remaining - invoices[i])) return true;
            pick.RemoveAt(pick.Count - 1);                                   // un-choose
        }
        return false;
    }
    return Search(0, payment) ? pick : null;
}
~~~`,
  pts: [r`Backtracking: choose, explore, un-choose.`, r`Search spaces are exponential, so prune early.`, r`Sort to stop early and skip duplicate branches.`, r`Branch and bound and memoisation cut further.`, r`For large instances use constraint solvers or heuristics.`],
  ex: r`A cash-application tool matched a customer's lump-sum payment to the exact set of open invoices it covered, pruning by sorted amounts.`,
  fu: [r`How would you cap runtime for large invoice sets?`],
  pit: [r`No pruning on inputs of 40+ items.`] },

{ id: 'q11', level: 'Intermediate', tags: ['graphs', 'cycle-detection'],
  q: r`Detect cycles in directed and undirected graphs. Where does this matter in production systems?`,
  a: r`- **Directed graphs**: DFS with three colours (white unvisited, grey on the current path, black finished). Reaching a grey node means a back edge, a cycle. Kahn's topological sort also detects cycles (not all nodes processed).
- **Undirected graphs**: DFS tracking the parent (an edge to a visited node that is not the parent is a cycle), or Union-Find (an edge joining two nodes already in the same set).

Production relevance:

- Dependency graphs (package references, service startup, migrations, DI registrations).
- Workflow/saga definitions that must terminate.
- Org hierarchies or approval chains with data-entry loops.
- Deadlock detection (wait-for graphs in databases).
- Circular references in ownership structures (company A owns B owns A) in KYC.`,
  code: r`~~~csharp
static bool HasCycle(Dictionary<string, List<string>> g)
{
    var state = new Dictionary<string, int>();               // 0 white, 1 grey, 2 black
    bool Dfs(string n)
    {
        state[n] = 1;
        foreach (var m in g.GetValueOrDefault(n, []))
        {
            var s = state.GetValueOrDefault(m);
            if (s == 1) return true;                         // back edge to the current path
            if (s == 0 && Dfs(m)) return true;
        }
        state[n] = 2; return false;
    }
    return g.Keys.Any(n => state.GetValueOrDefault(n) == 0 && Dfs(n));
}
// KYC: company ownership chain A -> B -> C -> A is circular ownership and must be flagged
~~~`,
  pts: [r`Directed: three-colour DFS; a grey neighbour means a cycle.`, r`Kahn's algorithm also detects cycles.`, r`Undirected: parent-aware DFS or Union-Find.`, r`Matters for dependencies, workflows, hierarchies and deadlocks.`, r`Use iterative DFS for very deep graphs.`],
  ex: r`A KYC beneficial-ownership tool flagged circular shareholding structures that hid the ultimate owner.`,
  fu: [r`How does SQL Server detect deadlocks?`],
  pit: [r`Using a single visited set for directed cycle detection.`] },

{ id: 'q12', level: 'Intermediate', tags: ['matrix', 'bfs'],
  q: r`Grid problems: count islands and find the shortest path in a grid. Which traversal and why?`,
  a: r`Treat each cell as a node with up to 4 (or 8) neighbours.

- **Number of islands**: for each unvisited land cell, run BFS/DFS to mark the whole island, counting launches. O(rows x cols).
- **Shortest path in an unweighted grid**: BFS from the start; the first time you reach the target is the shortest. Multi-source BFS (start from all sources at once) solves "distance to nearest X" for every cell.
- **Weighted grids**: Dijkstra or A* with Manhattan-distance heuristic.

Implementation details: bounds checks, direction arrays, marking visited when **enqueuing** (not when dequeuing) to avoid duplicates, and iterative BFS to avoid recursion limits on large grids.`,
  code: r`~~~csharp
static int Islands(char[][] grid)
{
    int rows = grid.Length, cols = grid[0].Length, count = 0;
    int[] dr = [1, -1, 0, 0], dc = [0, 0, 1, -1];
    for (var r = 0; r < rows; r++)
    for (var c = 0; c < cols; c++)
    {
        if (grid[r][c] != '1') continue;
        count++; grid[r][c] = '0';
        var q = new Queue<(int, int)>(); q.Enqueue((r, c));
        while (q.Count > 0)
        {
            var (y, x) = q.Dequeue();
            for (var k = 0; k < 4; k++)
            {
                int ny = y + dr[k], nx = x + dc[k];
                if (ny < 0 || nx < 0 || ny >= rows || nx >= cols || grid[ny][nx] != '1') continue;
                grid[ny][nx] = '0'; q.Enqueue((ny, nx));   // mark when enqueuing
            }
        }
    }
    return count;
}
~~~`,
  pts: [r`Cells are nodes with 4 or 8 neighbours.`, r`Islands: launch BFS/DFS per unvisited land cell.`, r`Unweighted shortest path: BFS; multi-source BFS for nearest-X distances.`, r`Weighted: Dijkstra or A* with Manhattan heuristic.`, r`Mark visited on enqueue; prefer iteration on large grids.`],
  ex: r`A warehouse robot planner used multi-source BFS to precompute distances from every charging station across the floor grid.`,
  fu: [r`How would you count islands in a grid too large for memory?`],
  pit: [r`Marking visited on dequeue, causing duplicate work.`] },

{ id: 'q13', level: 'Intermediate', tags: ['merge', 'k-way'],
  q: r`Merge k sorted lists or files efficiently. Where does k-way merge appear in real systems?`,
  a: r`Use a **min-heap** holding the current head of each list: pop the smallest, output it, push the next element from the same list. O(N log k) for N total elements, O(k) memory.

Real systems:

- **External sorting**: sort chunks that fit in memory, write them as runs, then k-way merge the runs.
- **LSM-tree compaction**: merging SSTables.
- **Merging sorted logs/events** from multiple partitions or regions by timestamp.
- **Combining sorted query results** from shards (scatter-gather with ordered results).
- Time-ordered market data from multiple venues.`,
  code: r`~~~csharp
static IEnumerable<T> MergeSorted<T>(IReadOnlyList<IEnumerator<T>> sources, IComparer<T> cmp)
{
    var heap = new PriorityQueue<int, T>(cmp);                  // element: source index, priority: current value
    for (var i = 0; i < sources.Count; i++) if (sources[i].MoveNext()) heap.Enqueue(i, sources[i].Current);
    while (heap.TryDequeue(out var src, out var value))
    {
        yield return value;
        if (sources[src].MoveNext()) heap.Enqueue(src, sources[src].Current);
    }
}
// Merge per-shard, per-day sorted trade files into one time-ordered stream without loading them all
var merged = MergeSorted(files.Select(f => ReadTrades(f).GetEnumerator()).ToList(), Comparer<Trade>.Create((a, b) => a.Ts.CompareTo(b.Ts)));
~~~`,
  pts: [r`A min-heap of list heads merges k sorted lists in O(N log k).`, r`Memory is O(k), so inputs can stream from disk.`, r`External sort = sorted runs + k-way merge.`, r`LSM compaction and sharded ordered queries use the same idea.`, r`Ties need a stable rule (source index) for determinism.`],
  ex: r`A regulator report needed one time-ordered trade file from 64 shard exports; a streaming k-way merge did it in minutes with 50 MB of memory.`,
  fu: [r`How would you deduplicate during the merge?`],
  pit: [r`Concatenating and re-sorting everything in memory.`] },

{ id: 'q14', level: 'Intermediate', tags: ['randomized', 'sampling'],
  q: r`Reservoir sampling and random shuffling: how do you sample fairly from a stream of unknown size?`,
  a: r`**Reservoir sampling** (Algorithm R) keeps k items: fill the reservoir with the first k; for item i (i > k, 1-based), replace a random reservoir slot with probability k/i. Every item ends up in the sample with equal probability k/n, using O(k) memory and one pass.

**Fisher-Yates shuffle**: for i from n-1 down to 1, swap a[i] with a[random 0..i]. Unbiased, O(n). .NET 8 has {{Random.Shared.Shuffle(span)}}.

Uses: sampling transactions for audit and QA, sampling logs and traces (head-based sampling is simpler; reservoir gives uniform samples over a window), A/B test assignment checks, test data generation.

For security-sensitive randomness (tokens, lottery-like selection with audit), use {{RandomNumberGenerator}}, not {{Random}}.`,
  code: r`~~~csharp
static T[] Reservoir<T>(IEnumerable<T> stream, int k, Random rng)
{
    var sample = new T[k]; var i = 0;
    foreach (var item in stream)
    {
        if (i < k) sample[i] = item;
        else { var j = rng.Next(i + 1); if (j < k) sample[j] = item; }   // keep with probability k/(i+1)
        i++;
    }
    return i < k ? sample[..i] : sample;
}
// Audit: uniform sample of 500 payments from today's stream, reproducible with a recorded seed
var picked = Reservoir(todaysPayments, 500, new Random(seed));
// Unbiased shuffle (.NET 8)
Random.Shared.Shuffle(cards.AsSpan());
// Auditable, unpredictable selection
int winner = RandomNumberGenerator.GetInt32(entrants.Count);
~~~`,
  pts: [r`Reservoir sampling keeps a uniform sample of k from a stream in one pass.`, r`Replace with probability k/i for the i-th item.`, r`Fisher-Yates gives unbiased shuffles; .NET 8 has Random.Shuffle.`, r`Record seeds for reproducible audit samples.`, r`Use RandomNumberGenerator when unpredictability matters.`],
  ex: r`An operations team pulled a statistically fair daily QA sample of payments from a Kafka stream without storing the full day.`,
  fu: [r`How do you sample uniformly across distributed partitions?`],
  pit: [r`OrderBy(x => Random.Next()) shuffles (biased and slow).`] },

{ id: 'q15', level: 'Intermediate', tags: ['string-matching'],
  q: r`String searching: naive, KMP, Rabin-Karp, and Aho-Corasick. When would you use each?`,
  a: r`- **Naive**: O(n·m) worst case but fast in practice for short patterns; .NET's {{IndexOf}} is heavily vectorised (SIMD) and usually the right choice for one pattern.
- **KMP**: O(n + m) using a prefix table to avoid re-scanning; guarantees linear time for adversarial input.
- **Rabin-Karp**: rolling hash to compare windows; good for multiple patterns of the same length and plagiarism/duplicate chunk detection.
- **Aho-Corasick**: builds an automaton from **many patterns** and finds all occurrences in one pass, O(n + total matches). Ideal for keyword screening (sanctions terms in payment references, PII detection, profanity filters).
- **Regex**: flexible; use {{RegexOptions.NonBacktracking}} or timeouts for untrusted input to avoid ReDoS. Source-generated regex ({{[GeneratedRegex]}}) for performance.

For many fixed patterns, .NET 8's {{SearchValues<string>}} provides an optimised multi-string search.`,
  code: r`~~~csharp
// Multi-pattern screening of free-text payment references (.NET 9 SearchValues<string>)
private static readonly SearchValues<string> Watchlist =
    SearchValues.Create(["IRAN ", "DPRK", "CRIMEA", "SYRIA"], StringComparison.OrdinalIgnoreCase);
static bool NeedsReview(string reference) => reference.AsSpan().ContainsAny(Watchlist);

// Safe regex for untrusted input: source-generated, non-backtracking, with a timeout
public static partial class Patterns
{
    [GeneratedRegex(@"^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$", RegexOptions.NonBacktracking, matchTimeoutMilliseconds: 50)]
    public static partial Regex Iban();
}
~~~`,
  pts: [r`For one pattern, the vectorised IndexOf is usually best.`, r`KMP guarantees linear time on adversarial input.`, r`Rabin-Karp uses rolling hashes for same-length patterns.`, r`Aho-Corasick or SearchValues find many patterns in one pass.`, r`Protect regex from ReDoS with NonBacktracking and timeouts.`],
  ex: r`A payments screening step checking 3,000 keywords per message moved from a loop of IndexOf calls to a multi-pattern matcher, cutting CPU by 90%.`,
  fu: [r`What is ReDoS and how does catastrophic backtracking happen?`],
  pit: [r`Backtracking regexes on user-supplied input without timeouts.`] },

{ id: 'q16', level: 'Intermediate', tags: ['bit-manipulation'],
  q: r`Which bit-manipulation tricks are worth knowing, and where do they appear in production code?`,
  a: r`- {{x & (x - 1)}} clears the lowest set bit (power-of-two check: {{x > 0 && (x & (x - 1)) == 0}}).
- {{x & -x}} isolates the lowest set bit (Fenwick trees).
- {{BitOperations.PopCount}}, {{LeadingZeroCount}}, {{TrailingZeroCount}}, {{Log2}}: hardware-accelerated in .NET.
- Masks for modulo by powers of two: {{i & (n - 1)}} (ring buffers, hash tables).
- XOR tricks: find the single non-duplicated number; swap without temp (avoid in real code).
- Bit flags enums ({{[Flags]}}) for permissions and feature sets.
- Bitmaps for compact boolean sets (daily active users, Bloom filters, Roaring bitmaps in analytics).
- Packing several small values into one {{long}} for atomic updates with {{Interlocked}}.`,
  code: r`~~~csharp
[Flags] public enum Permissions : ushort { None = 0, View = 1, Initiate = 2, Approve = 4, Release = 8, Admin = 0x8000 }
var p = Permissions.View | Permissions.Initiate;
bool canApprove = (p & Permissions.Approve) != 0;                 // segregation of duties checks
bool isPowerOfTwo(int x) => x > 0 && (x & (x - 1)) == 0;
int slot = hash & (capacity - 1);                                   // capacity is a power of two
int distinctFlags = BitOperations.PopCount((uint)p);

// Pack (count, lastTicks) into one long for a lock-free update
static long Pack(int count, int seconds) => ((long)count << 32) | (uint)seconds;
static (int Count, int Seconds) Unpack(long v) => ((int)(v >> 32), (int)v);
~~~`,
  pts: [r`x & (x - 1) clears the lowest bit; x & -x isolates it.`, r`BitOperations provides hardware-accelerated counts and logs.`, r`Power-of-two masks replace modulo in hot paths.`, r`Flags enums and bitmaps represent sets compactly.`, r`Packing values into a long enables atomic multi-field updates.`],
  ex: r`Daily-active-user tracking for 30 million users fit in 3.75 MB per day as a bitmap, with set-intersection queries for retention cohorts.`,
  fu: [r`What are Roaring bitmaps?`],
  pit: [r`Flags enums without explicit powers of two.`] },

{ id: 'q17', level: 'Intermediate', tags: ['math', 'money'],
  q: r`Algorithms for money: rounding, allocation of remainders, and why floating point fails.`,
  a: r`- **Binary floating point** (double) cannot represent 0.1 exactly; sums drift (0.1 + 0.2 = 0.30000000000000004). Use {{decimal}} (base-10, 28 to 29 significant digits) or integer minor units ({{long}} pence/cents).
- **Rounding modes**: banker's rounding ({{MidpointRounding.ToEven}}) reduces bias in large aggregates; half-up ({{AwayFromZero}}) is often mandated for customer-facing amounts. Specify explicitly; the default for {{Math.Round}} is ToEven.
- **Rounding point**: round per line vs per total changes results; agree with finance and apply consistently.
- **Allocation (splitting)**: dividing 100.00 into three shares cannot be 33.33 x 3; allocate the remainder deterministically (largest remainder method) so parts sum exactly to the total.
- **Currency precision** varies (JPY 0 decimals, KWD 3).
- **FX conversion**: apply rate, then round in the target currency; record rate and timestamp.`,
  code: r`~~~csharp
Console.WriteLine(0.1 + 0.2 == 0.3);                 // False (double)
Console.WriteLine(0.1m + 0.2m == 0.3m);              // True (decimal)

// Split an amount into weighted parts that sum exactly (largest remainder)
static long[] Allocate(long totalMinor, IReadOnlyList<decimal> weights)
{
    var sum = weights.Sum();
    var raw = weights.Select(w => totalMinor * w / sum).ToArray();
    var parts = raw.Select(x => (long)Math.Floor(x)).ToArray();
    var remainder = totalMinor - parts.Sum();
    foreach (var i in Enumerable.Range(0, parts.Length).OrderByDescending(i => raw[i] - parts[i]).ThenBy(i => i).Take((int)remainder))
        parts[i]++;
    return parts;
}
// Allocate(10_000, [1, 1, 1]) -> [3334, 3333, 3333]; sums to 10,000 pence exactly
var fee = decimal.Round(amount * 0.0175m, 2, MidpointRounding.AwayFromZero);   // explicit rounding mode
~~~`,
  pts: [r`Never use double for money; use decimal or integer minor units.`, r`Choose and document the rounding mode; Math.Round defaults to banker's.`, r`Agree whether to round per line or per total.`, r`Allocate remainders deterministically so parts sum to the total.`, r`Respect currency precision and record FX rates.`],
  ex: r`A split-payment feature dropped a cent on every three-way split until the largest-remainder allocation was introduced; reconciliation breaks disappeared.`,
  fu: [r`How do you handle rounding in currency conversion chains?`],
  pit: [r`Rounding at display time only.`] },

{ id: 'q18', level: 'Intermediate', tags: ['scheduling', 'heap'],
  q: r`Design a job scheduler that runs tasks at their due times. Which algorithms and structures do you use?`,
  a: r`In-memory core: a **min-heap by due time** (PriorityQueue). The loop peeks the earliest job, waits until its due time (or until a new earlier job arrives), runs it, and reschedules recurring jobs.

Alternative: **timing wheel** (hashed wheel timer): an array of buckets for time slots; adding/removing timers is O(1); used for millions of timeouts (network libraries, Kafka's purgatory).

Production scheduler requirements go further:

- **Persistence**: jobs stored in a database so restarts do not lose them (Quartz.NET, Hangfire).
- **Distributed safety**: only one node runs a given job (row locks, leases, {{FOR UPDATE SKIP LOCKED}}).
- **Misfire policy**: what to do with jobs missed during downtime.
- **Idempotency** and retries with backoff.
- Time zones and DST for calendar schedules (cron in UTC or explicit zones).`,
  code: r`~~~csharp
public sealed class InMemoryScheduler(TimeProvider clock) : BackgroundService
{
    private readonly PriorityQueue<Func<CancellationToken, Task>, DateTimeOffset> _jobs = new();
    private readonly SemaphoreSlim _signal = new(0);
    private readonly Lock _gate = new();
    public void Schedule(DateTimeOffset due, Func<CancellationToken, Task> job) { lock (_gate) _jobs.Enqueue(job, due); _signal.Release(); }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            Func<CancellationToken, Task>? job = null; TimeSpan wait = Timeout.InfiniteTimeSpan;
            lock (_gate)
                if (_jobs.TryPeek(out var next, out var due))
                {
                    var delay = due - clock.GetUtcNow();
                    if (delay <= TimeSpan.Zero) job = _jobs.Dequeue(); else wait = delay;
                }
            if (job is not null) { _ = job(ct); continue; }
            await _signal.WaitAsync(wait, ct);          // wake early if an earlier job is scheduled
        }
    }
}
~~~`,
  pts: [r`A min-heap by due time is the simple core.`, r`Timing wheels give O(1) for millions of timers.`, r`Persist jobs so restarts do not lose them.`, r`Use leases or row locks so one node runs each job.`, r`Define misfire, retry, idempotency and time-zone policies.`],
  ex: r`A payments-reminder service on Hangfire used SQL storage and distributed locks so 6 instances never sent duplicate reminders.`,
  fu: [r`How do DST changes break cron schedules?`],
  pit: [r`In-memory timers for business-critical scheduled payments.`] },

{ id: 'q19', level: 'Senior', tags: ['external-sort', 'big-data'],
  q: r`Sort a 500 GB file of transactions on a machine with 16 GB of RAM. Walk through the algorithm and its costs.`,
  a: r`**External merge sort**:

1. **Run generation**: read chunks that fit in memory (~8 to 12 GB leaving headroom), sort each in memory, write sorted runs to disk. 500 GB / 10 GB ≈ 50 runs.
2. **K-way merge**: open all runs with buffered readers, merge with a min-heap of run heads, write output sequentially. 50 runs x 64 MB buffers ≈ 3.2 GB of buffers: one merge pass suffices.

I/O cost: each byte is read and written twice (runs + merge) = ~2 TB of I/O; sequential I/O dominates. Optimisations:

- Larger runs via replacement selection (runs twice memory size on average).
- Compression of runs (CPU for I/O).
- Parallel run sorting on multiple cores; parallel merge if multiple disks.
- If keys are integers in a bounded range, a radix/bucket approach can avoid full comparisons.

In practice, consider whether you need a sort at all (aggregation via hashing, database bulk load with a clustered index, Spark/Databricks for distributed sort).`,
  code: r`~~~csharp
// Phase 1: sorted runs
var runs = new List<string>();
foreach (var chunk in ReadChunks("tx.csv", maxBytes: 10L << 30))           // ~10 GB per chunk
{
    var rows = chunk.Select(Parse).ToArray();
    Array.Sort(rows, (a, b) => a.Timestamp.CompareTo(b.Timestamp));
    var path = Path.Combine(tmp, "run-" + runs.Count + ".bin");
    WriteRun(path, rows); runs.Add(path);
}
// Phase 2: single k-way merge pass with buffered readers
var readers = runs.Select(p => ReadRun(p, bufferBytes: 64 << 20).GetEnumerator()).ToList();
using var output = new BinaryWriter(File.Create("tx.sorted.bin", 1 << 20));
foreach (var tx in MergeSorted(readers, Comparer<Tx>.Create((a, b) => a.Timestamp.CompareTo(b.Timestamp))))
    WriteTx(output, tx);
~~~`,
  pts: [r`Generate sorted runs that fit in memory, then k-way merge.`, r`50 runs with 64 MB buffers merge in a single pass.`, r`I/O: each byte read and written about twice; keep it sequential.`, r`Replacement selection, compression and parallelism help.`, r`Ask whether a sort is needed at all.`],
  ex: r`A regulatory backfill sorted 2 years of trades (700 GB) on one VM overnight with external merge sort, avoiding a Spark cluster for a one-off job.`,
  fu: [r`How many merge passes for 5,000 runs?`],
  pit: [r`Trying to load the whole file into memory.`] },

{ id: 'q20', level: 'Senior', tags: ['mapreduce', 'distributed'],
  q: r`Explain MapReduce-style processing. How would you count transactions per merchant across 10 TB of data?`,
  a: r`MapReduce splits work into:

1. **Map**: each worker reads a partition and emits key/value pairs ({{merchantId, 1}}), ideally **pre-aggregating locally** (combiner) to cut network traffic.
2. **Shuffle**: pairs are partitioned by key hash so all values for a key reach the same reducer.
3. **Reduce**: sum the values per key.

Key concerns:

- **Data skew**: one huge merchant overloads one reducer; mitigate with salting (split the key into merchant#0..n, reduce, then combine) or adaptive query execution.
- **Shuffle cost** dominates: combiners and columnar formats (Parquet) reduce it.
- **Fault tolerance**: tasks are deterministic and re-runnable.

Modern equivalents: Spark/Databricks, Azure Synapse, AWS Glue/EMR, BigQuery/Snowflake SQL (which do this internally). In SQL it is just {{GROUP BY merchant_id}} on a distributed engine.`,
  code: r`~~~sql
-- Spark SQL / Databricks: the engine performs map (partial agg), shuffle and reduce
SELECT merchant_id, COUNT(*) AS txns, SUM(amount) AS volume
FROM delta.\x60/lake/transactions\x60
WHERE txn_date >= '2026-01-01'
GROUP BY merchant_id;
~~~
~~~csharp
// The same shape in-process with partitions: local pre-aggregation then merge (combiner idea)
var partials = partitions.AsParallel().Select(p =>
{
    var local = new Dictionary<string, long>();
    foreach (var t in p) CollectionsMarshal.GetValueRefOrAddDefault(local, t.MerchantId, out _)++;
    return local;
});
var totals = new Dictionary<string, long>();
foreach (var part in partials) foreach (var (k, v) in part) CollectionsMarshal.GetValueRefOrAddDefault(totals, k, out _) += v;
~~~`,
  pts: [r`Map emits key/value pairs; shuffle groups by key; reduce aggregates.`, r`Combiners pre-aggregate to cut shuffle traffic.`, r`Data skew overloads single reducers; salt hot keys.`, r`Tasks must be deterministic to retry on failure.`, r`Spark and cloud SQL engines implement this for you.`],
  ex: r`A merchant analytics job with one marketplace producing 30% of rows ran 6x faster after salting that key across 16 reducers.`,
  fu: [r`How does Spark's adaptive query execution handle skew?`],
  pit: [r`Ignoring skew until one task runs for hours.`] },

{ id: 'q21', level: 'Senior', tags: ['streaming', 'windowing'],
  q: r`Streaming algorithms: tumbling, sliding and session windows, watermarks and late events. How do you compute "payments per merchant per minute" correctly?`,
  a: r`Window types:

- **Tumbling**: fixed, non-overlapping (each minute).
- **Hopping/sliding**: fixed size, overlapping (5-minute window every minute).
- **Session**: activity separated by inactivity gaps.

Correctness challenges:

- **Event time vs processing time**: aggregate by when the payment happened, not when it arrived.
- **Out-of-order and late events**: a **watermark** estimates how far event time has progressed ("no events older than T - 2 minutes expected"); windows close after the watermark passes; later events go to a side output or trigger corrections.
- **Exactly-once results** require idempotent sinks or transactional writes with checkpointing (Flink, Kafka Streams).
- **State size**: keyed state per merchant per window; TTL and compaction.

Tools: Kafka Streams, Apache Flink, Azure Stream Analytics, Spark Structured Streaming. In .NET, Kafka consumers with your own windowing are possible but tricky; prefer a stream processor for complex cases.`,
  code: r`~~~sql
-- Azure Stream Analytics: per-merchant counts per minute by event time, tolerating 2 minutes of lateness
SELECT MerchantId, System.Timestamp() AS WindowEnd, COUNT(*) AS Payments, SUM(Amount) AS Volume
INTO [merchant-minute]
FROM [payments] TIMESTAMP BY EventTime
GROUP BY MerchantId, TumblingWindow(minute, 1)
-- job config: late arrival tolerance 00:02:00, out-of-order tolerance 00:00:30
~~~
~~~csharp
// Event-time bucketing in plain C#: bucket by the event's own timestamp
static DateTimeOffset MinuteBucket(DateTimeOffset eventTime) => new(eventTime.Year, eventTime.Month, eventTime.Day, eventTime.Hour, eventTime.Minute, 0, TimeSpan.Zero);
~~~`,
  pts: [r`Tumbling, hopping/sliding and session windows suit different questions.`, r`Aggregate by event time, not arrival time.`, r`Watermarks decide when a window can close; late events need a policy.`, r`Exactly-once needs checkpoints plus idempotent or transactional sinks.`, r`Manage keyed state size with TTLs.`],
  ex: r`A fraud dashboard undercounted bursts until it switched from processing-time to event-time windows; mobile payments arriving late after reconnect were previously dropped into the wrong minute.`,
  fu: [r`How do you correct a published window when a late event arrives?`],
  pit: [r`Windowing by processing time for business metrics.`] },

{ id: 'q22', level: 'Senior', tags: ['load-balancing'],
  q: r`Load-balancing algorithms: round robin, least connections, power of two choices, consistent hashing. Which and why?`,
  a: r`- **Round robin / weighted round robin**: simple, even request counts; ignores request cost and server state.
- **Least connections / least outstanding requests**: adapts to slow requests and slow servers; needs accurate in-flight counts.
- **Power of two random choices (P2C)**: pick two servers at random, send to the less loaded. Nearly as good as global least-loaded with tiny coordination cost; used by Envoy, YARP ({{PowerOfTwoChoices}}), Finagle.
- **Latency-aware (EWMA)**: prefer servers with lower recent latency.
- **Consistent hashing / ring hash / Maglev**: route the same key to the same backend for cache affinity and sticky sessions, with minimal remapping on changes.
- **Locality-aware**: prefer same-zone backends to cut cross-AZ cost and latency, with spillover.

Combine with health checks, outlier ejection and slow-start for new instances (warm-up).`,
  code: r`~~~csharp
// Power of two choices
public sealed class P2CBalancer(IReadOnlyList<Backend> backends)
{
    public Backend Pick()
    {
        var a = backends[Random.Shared.Next(backends.Count)];
        var b = backends[Random.Shared.Next(backends.Count)];
        return a.InFlight <= b.InFlight ? a : b;
    }
}
~~~
~~~json
{ "ReverseProxy": { "Clusters": { "pricing": {
    "LoadBalancingPolicy": "PowerOfTwoChoices",
    "HealthCheck": { "Active": { "Enabled": true, "Interval": "00:00:05", "Path": "/health/ready" }, "Passive": { "Enabled": true } },
    "Destinations": { "a": { "Address": "http://pricing-a:8080" }, "b": { "Address": "http://pricing-b:8080" }, "c": { "Address": "http://pricing-c:8080" } } } } } }
~~~`,
  pts: [r`Round robin is simple but ignores cost and state.`, r`Least outstanding requests adapts to slow servers.`, r`Power of two choices gets near-optimal balance cheaply.`, r`Consistent hashing gives key affinity with minimal remapping.`, r`Add health checks, outlier ejection, slow start and zone awareness.`],
  ex: r`Switching a gRPC fleet from round robin to P2C cut p99 latency by 35% because slow GC pauses on one node no longer received an equal share.`,
  fu: [r`Why does round robin perform badly with long-lived connections?`],
  pit: [r`Sticky sessions that pin load to a few hot servers.`] },

{ id: 'q23', level: 'Senior', tags: ['backoff', 'retry'],
  q: r`Exponential backoff with jitter: why is jitter essential, and which variant do you use?`,
  a: r`Without jitter, clients that failed together retry together, creating synchronised **retry storms** that keep a recovering service down (thundering herd).

Variants (from the well-known AWS analysis):

- **Exponential**: delay = base x 2^attempt, capped.
- **Full jitter**: delay = random(0, min(cap, base x 2^attempt)). Spreads retries widely; usually best for reducing total load.
- **Equal jitter**: half fixed, half random.
- **Decorrelated jitter**: delay = min(cap, random(base, previous x 3)).

Also:

- Cap the number of attempts and total time (retry budget).
- Respect {{Retry-After}} headers.
- Retry only idempotent operations / with idempotency keys.
- Use **retry budgets / token buckets** at service level so retries cannot exceed, say, 10% of traffic.

Polly v8's {{UseJitter = true}} implements a decorrelated jitter variant.`,
  code: r`~~~csharp
static TimeSpan FullJitter(int attempt, TimeSpan baseDelay, TimeSpan cap)
{
    var exp = Math.Min(cap.TotalMilliseconds, baseDelay.TotalMilliseconds * Math.Pow(2, attempt));
    return TimeSpan.FromMilliseconds(Random.Shared.NextDouble() * exp);
}
// attempt 0..5 with base 100 ms, cap 5 s -> random in [0,100], [0,200], [0,400], [0,800], [0,1600], [0,3200] ms

var pipeline = new ResiliencePipelineBuilder<HttpResponseMessage>()
    .AddRetry(new() { MaxRetryAttempts = 4, BackoffType = DelayBackoffType.Exponential, UseJitter = true,
        Delay = TimeSpan.FromMilliseconds(200), MaxDelay = TimeSpan.FromSeconds(5),
        DelayGenerator = args => ValueTask.FromResult(args.Outcome.Result?.Headers.RetryAfter?.Delta) })   // honour Retry-After
    .Build();
~~~`,
  pts: [r`Without jitter, synchronised retries create storms.`, r`Full jitter usually minimises total load.`, r`Cap attempts and total time.`, r`Honour Retry-After and retry only idempotent operations.`, r`Use retry budgets so retries stay a small share of traffic.`],
  ex: r`After a database failover, 2,000 pods retrying every 1 s in lockstep kept it overloaded for 12 minutes; full jitter brought recovery to under a minute in the next drill.`,
  fu: [r`What is a retry budget?`],
  pit: [r`Retries at every layer multiplying load.`] },

{ id: 'q24', level: 'Senior', tags: ['rate-limiting', 'algorithms'],
  q: r`Compare rate-limiting algorithms: fixed window, sliding log, sliding window counter, token bucket, leaky bucket, GCRA.`,
  a: r`| Algorithm | Memory per key | Accuracy | Bursts | Notes |
|---|---|---|---|---|
| Fixed window counter | 1 counter | Allows 2x at boundaries | yes | Simplest |
| Sliding log | One timestamp per request | Exact | controlled | Memory grows with limit |
| Sliding window counter | 2 counters | Approximate (weighted) | smoothed | Good default for APIs |
| Token bucket | tokens + timestamp | Exact rate, bounded burst | up to bucket size | Most common for APIs |
| Leaky bucket (queue) | queue | Smooth output | absorbed | Shapes traffic |
| GCRA | 1 timestamp (TAT) | Exact, like token bucket | configurable | Very compact; used by many gateways |

Choose token bucket or GCRA for API quotas with burst allowance, sliding window counter when you want smooth limits with tiny state, leaky bucket for shaping outbound traffic to a fragile partner. ASP.NET Core ships fixed window, sliding window, token bucket and concurrency limiters.`,
  code: r`~~~csharp
// GCRA: one "theoretical arrival time" per key
public sealed class Gcra(TimeSpan emissionInterval, TimeSpan burstTolerance)
{
    private readonly ConcurrentDictionary<string, long> _tat = new();     // ticks
    public bool Allow(string key, long nowTicks)
    {
        while (true)
        {
            var tat = _tat.GetOrAdd(key, nowTicks);
            var newTat = Math.Max(tat, nowTicks) + emissionInterval.Ticks;
            if (newTat - nowTicks > burstTolerance.Ticks + emissionInterval.Ticks) return false;   // too early
            if (_tat.TryUpdate(key, newTat, tat)) return true;                                    // CAS
        }
    }
}
// 100 req/s with bursts of 20: new Gcra(TimeSpan.FromMilliseconds(10), TimeSpan.FromMilliseconds(200))
builder.Services.AddRateLimiter(o => o.AddSlidingWindowLimiter("api", w => { w.PermitLimit = 600; w.Window = TimeSpan.FromMinutes(1); w.SegmentsPerWindow = 6; }));
~~~`,
  pts: [r`Fixed windows allow double bursts at boundaries.`, r`Sliding logs are exact but memory-heavy.`, r`Sliding window counters are a cheap smooth approximation.`, r`Token bucket and GCRA give exact rates with bounded bursts.`, r`Leaky buckets shape outbound traffic.`],
  ex: r`A partner API that could only take 50 req/s smoothly was protected with a leaky-bucket outbound queue, ending their weekly overload complaints.`,
  fu: [r`How do you implement GCRA in Redis atomically?`],
  pit: [r`Fixed windows for strict partner limits.`] },

{ id: 'q25', level: 'Senior', tags: ['caching', 'algorithms'],
  q: r`Describe probabilistic early expiration (XFetch) and request coalescing as algorithms for cache stampede prevention.`,
  a: r`**XFetch**: each cached value stores its computation time (delta) and expiry. On read, recompute early if {{now - delta x beta x ln(rand()) >= expiry}}. Because {{ln(rand())}} is negative, the term pushes "now" forward randomly; the closer to expiry, the more likely one reader refreshes early, while others still get cached data. Expected result: usually exactly one early refresh, no stampede, no locks. Beta > 1 favours earlier refreshes.

**Request coalescing (single-flight)**: concurrent misses for the same key share one in-flight computation (a dictionary of {{Task}}s). Across instances, use a short distributed lock or accept one computation per instance.

**Stale-while-revalidate**: serve stale content and refresh in the background.

Combine: XFetch or stale-while-revalidate to avoid synchronous misses, single-flight to collapse concurrent ones, TTL jitter to avoid mass expiry.`,
  code: r`~~~csharp
public sealed record CachedValue<T>(T Value, double ComputeMs, DateTimeOffset Expiry);
static bool ShouldRecompute<T>(CachedValue<T> v, DateTimeOffset now, double beta = 1.0) =>
    now.AddMilliseconds(-v.ComputeMs * beta * Math.Log(Random.Shared.NextDouble())) >= v.Expiry;

// Single-flight: one computation per key per process
private readonly ConcurrentDictionary<string, Lazy<Task<object>>> _inflight = new();
public async Task<T> SingleFlightAsync<T>(string key, Func<Task<T>> compute)
{
    var lazy = _inflight.GetOrAdd(key, _ => new Lazy<Task<object>>(async () => (object)(await compute())!));
    try { return (T)await lazy.Value; }
    finally { _inflight.TryRemove(new KeyValuePair<string, Lazy<Task<object>>>(key, lazy)); }
}
~~~`,
  pts: [r`XFetch refreshes early with rising probability near expiry.`, r`Usually one reader refreshes; others keep serving cached data.`, r`Single-flight collapses concurrent misses into one computation.`, r`Stale-while-revalidate serves stale data during refresh.`, r`Combine with TTL jitter.`],
  ex: r`An exchange-rate cache with XFetch removed periodic latency spikes at expiry without adding distributed locks.`,
  fu: [r`What does beta control?`],
  pit: [r`Distributed locks on every cache miss.`] },

{ id: 'q26', level: 'Senior', tags: ['consensus', 'raft'],
  q: r`Explain the Raft consensus algorithm at a level suitable for a Principal interview. Where do you meet it in practice?`,
  a: r`Raft keeps a replicated log consistent across a cluster (typically 3 or 5 nodes) despite failures:

- **Leader election**: nodes start as followers; if they hear no heartbeat within a randomised timeout, they become candidates and request votes. A node with a majority of votes for a term becomes leader. Randomised timeouts avoid split votes. Voters only vote for candidates whose log is at least as up to date as theirs.
- **Log replication**: the leader appends client commands to its log and replicates them; an entry is **committed** once stored on a majority. Committed entries are applied to the state machine in order.
- **Safety**: at most one leader per term; committed entries are never lost because any new leader must have them (majority overlap).
- A cluster of 2f + 1 nodes tolerates f failures; writes need a majority round trip, so latency depends on the quorum.

Where you meet it: etcd (Kubernetes), Consul, CockroachDB, TiKV, Kafka KRaft (controller quorum), RabbitMQ quorum queues, MongoDB replica-set elections (Raft-like).`,
  code: r`~~~text
5-node cluster, leader L (term 7)
client write x=1 -> L appends at index 42 -> AppendEntries to F1..F4
F1, F2 ack -> L has 3/5 (majority) -> index 42 committed -> applied -> client acknowledged
L crashes -> F3 times out first (randomised 150-300 ms) -> RequestVote(term 8, lastIndex 42)
F1, F2 grant (their logs are not newer) -> F3 leader for term 8 with index 42 intact
~~~`,
  dia: r`sequenceDiagram
  participant C as Client
  participant L as Leader
  participant F1 as Follower 1
  participant F2 as Follower 2
  C->>L: write x=1
  L->>F1: AppendEntries(index 42)
  L->>F2: AppendEntries(index 42)
  F1-->>L: ack
  F2-->>L: ack
  L->>L: majority -> commit 42
  L-->>C: ok`,
  pts: [r`Leader election with randomised timeouts and majority votes per term.`, r`Entries commit once stored on a majority.`, r`A new leader must hold all committed entries: majority overlap.`, r`2f+1 nodes tolerate f failures; writes pay a quorum round trip.`, r`Found in etcd, Consul, Kafka KRaft, RabbitMQ quorum queues, CockroachDB.`],
  ex: r`Understanding Raft quorums explained why a 2-zone etcd deployment lost write availability when one zone failed, and led to a 3-zone layout.`,
  fu: [r`Why are clusters sized with odd numbers?`, r`Raft vs Paxos?`],
  pit: [r`Deploying consensus clusters across only two failure domains.`] },

{ id: 'q27', level: 'Senior', tags: ['distributed', 'clocks'],
  q: r`Logical clocks: Lamport timestamps, vector clocks and hybrid logical clocks. Why can you not rely on wall-clock time to order events?`,
  a: r`Wall clocks drift and jump (NTP corrections, leap seconds, VM pauses); two servers may disagree by milliseconds or more, so "latest timestamp wins" can discard the true latest write.

- **Lamport clock**: a counter incremented on each event and set to max(local, received) + 1 on message receipt. Gives an ordering consistent with causality (if A happened before B then L(A) < L(B)), but cannot tell whether two events were concurrent.
- **Vector clock**: one counter per node; comparing vectors tells whether A happened before B, B before A, or they are **concurrent** (conflict). Used for conflict detection (Dynamo-style stores, CRDTs). Size grows with node count.
- **Hybrid logical clocks (HLC)**: physical time plus a logical counter; close to wall time, monotonic, captures causality. Used by CockroachDB, MongoDB cluster time.
- **TrueTime** (Spanner): bounded clock uncertainty with waiting to guarantee external consistency.

Practical rules: use database-assigned sequences or versions for ordering within a system; use idempotency and conditional writes instead of timestamps for conflict resolution.`,
  code: r`~~~csharp
public sealed class LamportClock
{
    private long _t;
    public long Tick() => Interlocked.Increment(ref _t);                       // local event / send
    public long Receive(long remote)                                           // on message receipt
    {
        long cur, next;
        do { cur = Volatile.Read(ref _t); next = Math.Max(cur, remote) + 1; } while (Interlocked.CompareExchange(ref _t, next, cur) != cur);
        return next;
    }
}
// Vector clock comparison: concurrent if neither dominates
static string Compare(int[] a, int[] b)
{
    bool aLe = a.Zip(b).All(p => p.First <= p.Second), bLe = b.Zip(a).All(p => p.First <= p.Second);
    return aLe && !bLe ? "a happened before b" : bLe && !aLe ? "b happened before a" : aLe && bLe ? "equal" : "concurrent (conflict)";
}
~~~`,
  pts: [r`Wall clocks drift and jump; timestamp ordering can lose writes.`, r`Lamport clocks respect causality but cannot detect concurrency.`, r`Vector clocks detect concurrent (conflicting) updates.`, r`Hybrid logical clocks stay close to wall time and monotonic.`, r`Prefer database versions and conditional writes for ordering.`],
  ex: r`A multi-region profile store using last-writer-wins by server time lost address changes made seconds apart in two regions; version-based conditional writes fixed it.`,
  fu: [r`How does Spanner's TrueTime provide external consistency?`],
  pit: [r`Ordering financial events by DateTime.UtcNow from different servers.`] },

{ id: 'q28', level: 'Senior', tags: ['matching', 'reconciliation'],
  q: r`Design the matching algorithm for reconciliation with exact, tolerance and many-to-one matches. How do you keep it deterministic and fast?`,
  a: r`Run **passes from strictest to loosest**, removing matched items after each pass:

1. **Exact**: reference + amount + currency via hash join. O(n + m).
2. **Normalised exact**: cleaned references (strip spaces, prefixes, case).
3. **Tolerance**: same amount and currency, value date within N days; resolve ambiguity one-to-one by closest date then stable id order (deterministic).
4. **Many-to-one**: one bank line equals the sum of several ledger entries for the same counterparty within a window; subset-sum with pruning, bounded by candidate count (fallback to manual).
5. **Fuzzy references**: edit distance on candidates blocked by amount, flagged for human confirmation.

Determinism: stable ordering everywhere, versioned rules, results stored per run with the rule that matched. Speed: index by (amount, currency) buckets; never compare everything with everything.`,
  code: r`~~~csharp
public sealed record Match(string LedgerId, string BankId, string Rule);
public static List<Match> Reconcile(List<Ledger> ledger, List<Bank> bank)
{
    var matches = new List<Match>();
    var openBank = bank.OrderBy(b => b.Id).ToList();
    // Pass 1: exact (hash join)
    var exact = openBank.ToLookup(b => (b.Ref, b.Amount, b.Ccy));
    foreach (var l in ledger.OrderBy(l => l.Id))
        if (exact[(l.Ref, l.Amount, l.Ccy)].FirstOrDefault(b => !b.Matched) is { } b) { b.Matched = l.Matched = true; matches.Add(new(l.Id, b.Id, "EXACT")); }
    // Pass 2: amount + currency within 3 days, closest date, deterministic tie-break
    var byAmount = openBank.Where(b => !b.Matched).ToLookup(b => (b.Amount, b.Ccy));
    foreach (var l in ledger.Where(l => !l.Matched).OrderBy(l => l.Id))
    {
        var cand = byAmount[(l.Amount, l.Ccy)].Where(b => !b.Matched && Math.Abs((b.ValueDate.DayNumber - l.ValueDate.DayNumber)) <= 3)
                                              .OrderBy(b => Math.Abs(b.ValueDate.DayNumber - l.ValueDate.DayNumber)).ThenBy(b => b.Id).FirstOrDefault();
        if (cand is not null) { cand.Matched = l.Matched = true; matches.Add(new(l.Id, cand.Id, "AMOUNT_DATE_3D")); }
    }
    return matches;   // remaining unmatched -> many-to-one pass -> fuzzy suggestions -> manual queue
}
~~~`,
  pts: [r`Run passes from strict to loose, removing matched items.`, r`Hash joins for exact passes: O(n + m).`, r`Bucket by amount and currency for tolerance passes.`, r`Deterministic tie-breaks and versioned rules per run.`, r`Bound many-to-one subset sums; send the rest to humans.`],
  ex: r`A treasury team's automated match rate rose from 71% to 96% with five ordered passes, and auditors could see which rule matched every pair.`,
  fu: [r`How do you handle a bank line that pays 3 invoices minus a fee?`],
  pit: [r`Greedy fuzzy matching that steals the true match from a later item.`] },

{ id: 'q29', level: 'Senior', tags: ['graph-algorithms', 'pagerank'],
  q: r`Where do graph algorithms like PageRank, community detection and shortest paths add value in fraud and risk systems?`,
  a: r`- **Connected components / Union-Find**: clusters of accounts sharing devices, cards, emails: fraud rings and synthetic identities.
- **PageRank / centrality**: influential nodes in a transaction network (mule hubs receiving from many victims, then forwarding).
- **Community detection** (Louvain, label propagation): groups that transact mostly among themselves (collusion, money-laundering layering).
- **Shortest paths / k-hop neighbourhoods**: distance from a new account to known fraud; exposure through ownership chains.
- **Cycle detection**: circular transfers (round-tripping) and circular ownership.
- **Temporal motifs**: rapid in-and-out flows within hours (mule behaviour).

These typically run in batch (Spark GraphFrames, Neo4j GDS, TigerGraph) producing features for real-time models, since full-graph algorithms are too slow for synchronous authorisation.`,
  code: r`~~~csharp
// Simple PageRank over a transfer graph (batch feature: "how central is this account in money flows")
static Dictionary<string, double> PageRank(Dictionary<string, List<string>> outLinks, int iterations = 20, double d = 0.85)
{
    var nodes = outLinks.Keys.Concat(outLinks.Values.SelectMany(v => v)).Distinct().ToList();
    var rank = nodes.ToDictionary(n => n, _ => 1.0 / nodes.Count);
    for (var it = 0; it < iterations; it++)
    {
        var next = nodes.ToDictionary(n => n, _ => (1 - d) / nodes.Count);
        foreach (var (src, outs) in outLinks)
            if (outs.Count > 0) foreach (var dst in outs) next[dst] += d * rank[src] / outs.Count;
        rank = next;
    }
    return rank;   // accounts receiving from many sources rank high: candidate mule hubs
}
~~~`,
  pts: [r`Components reveal rings sharing identifiers.`, r`Centrality finds hub accounts in money flows.`, r`Community detection finds collusive groups.`, r`k-hop distance to known fraud is a strong feature.`, r`Run in batch and feed features to real-time models.`],
  ex: r`An AML team's PageRank feature surfaced mule hub accounts that rule-based monitoring missed because each individual transfer was small.`,
  fu: [r`How would you compute these incrementally on streaming data?`],
  pit: [r`Running full-graph algorithms inside the authorisation path.`] },

{ id: 'q30', level: 'Senior', tags: ['optimisation', 'knapsack'],
  q: r`0/1 knapsack: DP solution, and real problems that reduce to it (budget allocation, batch packing).`,
  a: r`Choose items with weights and values to maximise value without exceeding capacity W. Greedy by value/weight fails for 0/1 (works only for fractional).

DP: {{dp[w]}} = best value with capacity w; iterate items, and for each, capacities from W down to weight (descending so each item is used once): {{dp[w] = max(dp[w], dp[w - wi] + vi)}}. O(n·W) time, O(W) space: **pseudo-polynomial** (fine when W is moderate, e.g. thousands).

Real problems:

- Selecting projects/features within an engineering budget (value = expected benefit).
- Packing payments into a batch file with a size or amount cap.
- Choosing which cached objects to keep within memory.
- Allocating limited marketing spend.

For large W or many constraints, use integer programming solvers (OR-Tools) or heuristics.`,
  code: r`~~~csharp
static (int Value, List<int> Picked) Knapsack(int[] weight, int[] value, int capacity)
{
    var dp = new int[capacity + 1];
    var take = new bool[weight.Length, capacity + 1];
    for (var i = 0; i < weight.Length; i++)
        for (var w = capacity; w >= weight[i]; w--)                      // descending: each item once
            if (dp[w - weight[i]] + value[i] > dp[w]) { dp[w] = dp[w - weight[i]] + value[i]; take[i, w] = true; }
    var picked = new List<int>();
    for (int i = weight.Length - 1, w = capacity; i >= 0; i--) if (take[i, w]) { picked.Add(i); w -= weight[i]; }
    return (dp[capacity], picked);
}
// Engineering quarter: capacity 40 engineer-weeks, initiatives with cost (weeks) and value (score)
~~~`,
  pts: [r`0/1 knapsack: maximise value under a capacity; greedy fails.`, r`DP over capacity, iterating capacities downward.`, r`O(n·W) is pseudo-polynomial: fine for moderate W.`, r`Track choices to reconstruct the selected items.`, r`Large or multi-constraint versions need solvers or heuristics.`],
  ex: r`A platform team used knapsack DP to choose the reliability initiatives that fit 40 engineer-weeks while maximising estimated incident-minutes avoided.`,
  fu: [r`How do you handle two constraints (cost and people)?`],
  pit: [r`Iterating capacity upward, which reuses items.`] },

{ id: 'q31', level: 'Senior', tags: ['caching', 'lru-algorithms'],
  q: r`Explain how to choose batch sizes, timeouts and concurrency algorithmically (Little's Law, queueing) for a .NET worker.`,
  a: r`**Little's Law**: L = λ × W (items in system = arrival rate x time in system). If a worker processes 2,000 messages/s and each takes 50 ms end to end, about 100 messages are in flight: you need ~100 concurrent slots (threads/async operations) to keep up.

Queueing insights:

- As utilisation approaches 100%, waiting time grows sharply (M/M/1: W = 1 / (μ - λ)). Keep utilisation around 60 to 80% for stable latency.
- **Batching** amortises fixed costs (round trips, commits): throughput up, latency up. Choose a batch size and a max wait (e.g. 500 items or 50 ms, whichever first).
- **Concurrency limits** should match downstream capacity (database connections), not CPU count, for I/O-bound work.
- **Adaptive concurrency** (AIMD, Netflix concurrency-limits / gradient algorithms) adjusts limits from observed latency.`,
  code: r`~~~csharp
// Batch by size or time, whichever comes first
static async IAsyncEnumerable<List<T>> Batch<T>(ChannelReader<T> reader, int maxSize, TimeSpan maxWait, [EnumeratorCancellation] CancellationToken ct)
{
    var batch = new List<T>(maxSize);
    while (await reader.WaitToReadAsync(ct))
    {
        using var window = CancellationTokenSource.CreateLinkedTokenSource(ct); window.CancelAfter(maxWait);
        try { while (batch.Count < maxSize && await reader.WaitToReadAsync(window.Token)) while (batch.Count < maxSize && reader.TryRead(out var item)) batch.Add(item); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { }
        if (batch.Count > 0) { yield return batch; batch = new List<T>(maxSize); }
    }
}
// Little's Law sizing: 2,000 msg/s x 0.05 s = 100 in flight -> MaxDegreeOfParallelism ≈ 100, capped by DB pool (e.g. 80)
~~~`,
  pts: [r`Little's Law: in-flight = arrival rate x time in system.`, r`Latency explodes as utilisation nears 100%; target 60 to 80%.`, r`Batch by size or time to amortise fixed costs.`, r`Size I/O concurrency to downstream capacity, not CPU count.`, r`Adaptive limits tune concurrency from observed latency.`],
  ex: r`A consumer stuck at 400 msg/s with 8 parallel handlers reached 3,000 msg/s after Little's Law sizing to 64 handlers and 200-item batched inserts.`,
  fu: [r`What is AIMD?`],
  pit: [r`Setting concurrency equal to core count for I/O-bound work.`] },

{ id: 'q32', level: 'Senior', tags: ['hashing', 'idempotency'],
  q: r`Algorithms for idempotency and deduplication: content hashing, deterministic ids and UUIDv5/v7. When do you use each?`,
  a: r`- **Client-supplied idempotency keys**: the client decides what "the same request" means; best for APIs.
- **Content hashing** (SHA-256 of a canonical representation): deduplicates identical payloads (file uploads, webhook bodies). Requires canonicalisation (field order, whitespace, number formats) or tiny differences produce new hashes.
- **Deterministic ids (UUIDv5)**: name-based UUIDs from a namespace + natural key (e.g. bank file name + line number). Re-importing the same file yields the same ids, so inserts are naturally idempotent with a unique key.
- **UUIDv7**: time-ordered random ids for new entities; good index locality in many databases (not SQL Server's uniqueidentifier ordering), not for dedupe.
- **Natural keys** from the domain (provider event id, trade id + version) are often the best dedupe key.`,
  code: r`~~~csharp
// UUIDv5-style deterministic id: same namespace + name -> same id on every import
static Guid DeterministicId(Guid ns, string name)
{
    Span<byte> nsBytes = stackalloc byte[16]; ns.TryWriteBytes(nsBytes, bigEndian: true, out _);
    var hash = SHA1.HashData([.. nsBytes, .. Encoding.UTF8.GetBytes(name)]);
    hash[6] = (byte)((hash[6] & 0x0F) | 0x50);    // version 5
    hash[8] = (byte)((hash[8] & 0x3F) | 0x80);    // RFC 4122 variant
    return new Guid(hash.AsSpan(0, 16), bigEndian: true);
}
var lineId = DeterministicId(BankFilesNamespace, fileName + ":" + lineNumber);   // re-import -> same id -> unique key rejects duplicate
var newOrderId = Guid.CreateVersion7();                                           // time-ordered id for new entities
~~~`,
  pts: [r`Client idempotency keys define sameness for APIs.`, r`Content hashes need canonicalisation first.`, r`Deterministic (v5) ids make re-imports naturally idempotent.`, r`UUIDv7 is for ordered new ids, not dedupe.`, r`Natural domain keys are often the best dedupe keys.`],
  ex: r`Deterministic line ids made a bank-statement import safe to rerun after partial failures; duplicate rows became impossible.`,
  fu: [r`How do you canonicalise JSON for hashing?`],
  pit: [r`Hashing JSON without canonicalisation.`] },

{ id: 'q33', level: 'Senior', tags: ['search-ranking'],
  q: r`How do relevance ranking algorithms (TF-IDF, BM25, vector similarity, hybrid) work at a level useful for system design?`,
  a: r`- **TF-IDF**: score = term frequency in the document x log(N / documents containing the term). Rare terms matter more.
- **BM25**: TF-IDF with term-frequency **saturation** (k1) and **document length normalisation** (b); the default in Lucene/OpenSearch/Elasticsearch.
- **Vector similarity**: embed queries and documents into vectors; rank by cosine similarity or dot product. Captures meaning and synonyms; approximate nearest neighbour (HNSW) indexes make it fast.
- **Hybrid search**: combine lexical (BM25, great for exact ids, codes, names) with semantic scores, often via **Reciprocal Rank Fusion** (score = Σ 1/(k + rank)).
- **Re-ranking**: a cross-encoder or LLM re-scores the top 50 for precision.

Design implications: lexical for codes and ids (IBANs, SKUs), semantic for natural language, hybrid for most enterprise search and RAG; evaluate with labelled queries (nDCG, recall@k).`,
  code: r`~~~csharp
// Reciprocal Rank Fusion of lexical and vector result lists
static List<string> Rrf(IReadOnlyList<string> bm25, IReadOnlyList<string> vector, int k = 60)
{
    var score = new Dictionary<string, double>();
    for (var i = 0; i < bm25.Count; i++) score[bm25[i]] = score.GetValueOrDefault(bm25[i]) + 1.0 / (k + i + 1);
    for (var i = 0; i < vector.Count; i++) score[vector[i]] = score.GetValueOrDefault(vector[i]) + 1.0 / (k + i + 1);
    return score.OrderByDescending(kv => kv.Value).Select(kv => kv.Key).ToList();
}
static double Cosine(ReadOnlySpan<float> a, ReadOnlySpan<float> b) => System.Numerics.Tensors.TensorPrimitives.CosineSimilarity(a, b);
~~~`,
  pts: [r`TF-IDF weights rare terms; BM25 adds saturation and length normalisation.`, r`Vector similarity captures meaning via embeddings and ANN indexes.`, r`Hybrid search fuses lexical and semantic results (RRF).`, r`Re-rank the top results for precision.`, r`Evaluate with labelled queries: nDCG, recall@k.`],
  ex: r`A support-knowledge search improved answer recall@5 from 61% to 84% by moving from BM25 only to hybrid RRF with re-ranking.`,
  fu: [r`Why does pure vector search fail on exact codes like IBANs?`],
  pit: [r`Shipping search ranking changes without an evaluation set.`] },

{ id: 'q34', level: 'Senior', tags: ['caching', 'consistency', 'algorithms'],
  q: r`Explain the two generals problem and FLP impossibility briefly. What do they mean for engineers designing payments?`,
  a: r`- **Two generals**: over an unreliable channel, two parties cannot achieve certainty that both agree (the last acknowledgement can always be lost). Consequence: a client can never be sure whether a timed-out request succeeded.
- **FLP impossibility**: in a fully asynchronous system with even one crash failure, no deterministic consensus algorithm can guarantee termination. Practical systems (Raft, Paxos) use timeouts and randomisation, assuming partial synchrony.

Engineering consequences for payments:

- Treat **timeouts as unknown outcomes**, not failures. Never automatically retry on a different provider after an ambiguous result.
- Make operations **idempotent** so retries are safe; pass idempotency keys to providers.
- **Query status** and **reconcile** against the source of truth (settlement files) to resolve unknowns.
- Prefer protocols with explicit states (pending, unknown) over booleans.
- Design user experiences that show "processing" rather than guessing.`,
  code: r`~~~csharp
public enum Outcome { Succeeded, Failed, Unknown }
public async Task<Outcome> ChargeAsync(Charge c, CancellationToken ct)
{
    try
    {
        var r = await _psp.ChargeAsync(c, idempotencyKey: c.Id.ToString(), ct).WaitAsync(TimeSpan.FromSeconds(10), ct);
        return r.Approved ? Outcome.Succeeded : Outcome.Failed;
    }
    catch (TimeoutException) { return Outcome.Unknown; }           // two generals: we cannot know; do not guess
}
// Unknown -> poll PSP status with the same key, then nightly reconciliation; never "retry elsewhere"
~~~`,
  pts: [r`Two generals: certainty of agreement over a lossy channel is impossible.`, r`FLP: no deterministic consensus guarantees termination in a purely async system.`, r`Treat timeouts as unknown outcomes.`, r`Idempotency, status queries and reconciliation resolve unknowns.`, r`Model explicit pending and unknown states.`],
  ex: r`A payment app that treated timeouts as failures and offered "try another card" produced double charges; modelling Unknown and querying status ended them.`,
  fu: [r`How do Raft and Paxos work around FLP in practice?`],
  pit: [r`Booleans for success where three states exist.`] },

{ id: 'q35', level: 'Senior', tags: ['algorithms', 'frontend'],
  q: r`Algorithms in front-end performance: debouncing, throttling, virtualisation and diffing. How do they work?`,
  a: r`- **Debounce**: run a function only after input has been quiet for N ms (search-as-you-type): reduces API calls from one per keystroke to one per pause.
- **Throttle**: run at most once per N ms (scroll, resize, price ticks).
- **Virtualisation**: render only rows visible in the viewport plus a buffer; compute visible range from scroll offset and row height: O(visible) DOM nodes.
- **Diffing / reconciliation**: React compares element trees with heuristics (same type and key = update, otherwise replace) to make updates O(n) rather than O(n³) tree edit distance; stable keys are essential.
- **Memoisation**: avoid recomputing derived data ({{useMemo}}, Angular {{computed}} signals, pure pipes).
- **Request cancellation**: cancel stale requests ({{switchMap}} in RxJS, AbortController) so out-of-order responses do not overwrite newer results.`,
  code: r`~~~typescript
// Angular + RxJS: debounce typing, cancel stale requests, ignore duplicates
this.results$ = this.query.valueChanges.pipe(
  debounceTime(250),
  map(q => q.trim()),
  distinctUntilChanged(),
  filter(q => q.length >= 2),
  switchMap(q => this.api.search(q))        // cancels the previous in-flight request
);
// React: stable keys make diffing correct and cheap
{orders.map(o => <OrderRow key={o.id} order={o} />)}   // never key={index} for reorderable lists
~~~`,
  pts: [r`Debounce waits for quiet; throttle caps the rate.`, r`Virtualisation renders only visible rows.`, r`React diffing relies on element type and stable keys.`, r`Memoise derived data.`, r`Cancel stale requests (switchMap, AbortController).`],
  ex: r`A customer-search box went from 12 API calls per typed name to 1 with debounce + switchMap, and stopped showing stale results.`,
  fu: [r`Why is key={index} harmful?`],
  pit: [r`mergeMap for search, letting slow old responses overwrite new ones.`] },

{ id: 'q36', level: 'Senior', tags: ['live-coding', 'approach'],
  q: r`How do you approach a live coding problem in a senior interview so that the interviewer sees senior judgement?`,
  a: r`1. **Clarify**: inputs, sizes, edge cases (empty, duplicates, negatives, Unicode), expected output, performance needs.
2. **State a brute force** and its complexity quickly; it anchors correctness.
3. **Improve**: identify the bottleneck and the pattern (hash map, two pointers, sliding window, heap, DP, graph traversal). Say the target complexity.
4. **Code cleanly**: meaningful names, small helper functions, guard clauses; narrate intent, not keystrokes.
5. **Test out loud**: walk through a normal case and edge cases; fix bugs calmly.
6. **Discuss production**: input validation, concurrency, memory for large inputs (streaming), observability, how it would scale across machines.

Seniors who skip clarification or production discussion often score lower than they expect, even with correct code.`,
  code: r`~~~csharp
// Example narration skeleton for "find duplicate transaction ids in a large file"
// Clarify: file size? (40 GB) ids format? (UUID) need all duplicates or any? (all, with counts)
// Brute force: nested loop O(n^2) -> impossible at this size.
// In memory: HashSet O(n) -> 40 GB of ids does not fit.
// Plan: partition ids by hash into 256 files (streaming), then dedupe each partition in memory.
static void PartitionIds(string input, string dir)
{
    var writers = Enumerable.Range(0, 256).Select(i => new StreamWriter(Path.Combine(dir, i + ".txt"))).ToArray();
    foreach (var line in File.ReadLines(input)) writers[System.IO.Hashing.XxHash32.HashToUInt32(Encoding.ASCII.GetBytes(line)) & 255].WriteLine(line);
    foreach (var w in writers) w.Dispose();
}
// Then for each partition: GroupBy id where count > 1 (fits in memory). Discuss: parallelism, disk space, checksums.
~~~`,
  pts: [r`Clarify inputs, sizes and edge cases first.`, r`State the brute force and its complexity.`, r`Name the pattern and target complexity, then code cleanly.`, r`Test aloud with edge cases.`, r`Close with production and scale considerations.`],
  ex: r`Candidates who asked "how big is the file?" and partitioned by hash consistently outscored those who wrote a perfect in-memory HashSet solution.`,
  fu: [r`How do you recover if you get stuck?`],
  pit: [r`Coding immediately without clarifying constraints.`] },

{ id: 'q37', level: 'Principal', tags: ['algorithms', 'architecture'],
  q: r`Give examples where an algorithmic insight changed an architecture or saved significant cost.`,
  a: r`- **Streaming instead of materialising**: replacing "load all then process" with k-way merges or partitioned processing let jobs run on small machines instead of large clusters.
- **Pre-aggregation (combiners, rollups)**: computing per-minute aggregates at ingest turned expensive dashboard queries into cheap lookups.
- **Approximate algorithms** (HyperLogLog, Count-Min, sampling) made real-time analytics feasible within memory budgets.
- **Indexing the right side of a join**: O(n·m) reconciliations to O(n + m) hash joins.
- **Consistent hashing** reduced cache-miss storms during scaling.
- **Batching and Little's Law sizing** multiplied throughput without new hardware.
- **Power-of-two load balancing** cut tail latency without centralised coordination.

The Principal skill is spotting that a problem is an instance of a known algorithm, then quantifying the gain.`,
  code: r`~~~text
Case: nightly risk aggregation (positions x scenarios)
Before: for each of 2,000 scenarios, reload 3 M positions from SQL and revalue -> 6 billion row reads, 9 hours, large VM
Insight: positions do not change between scenarios -> load once into struct arrays, vectorise revaluation,
         partition by book across cores; scenarios applied as deltas (pre-aggregated sensitivities)
After:   3 M row reads, 35 minutes on a VM one-quarter the size; cost -80%
~~~`,
  pts: [r`Many architecture wins are algorithmic insights.`, r`Stream rather than materialise; pre-aggregate at ingest.`, r`Approximate where acceptable for huge memory savings.`, r`Fix join and lookup complexity before scaling hardware.`, r`Quantify the gain to make the case.`],
  ex: r`Recognising a risk run as "load once, apply deltas" cut a 9-hour batch to 35 minutes and avoided a cluster purchase.`,
  fu: [r`How do you find these opportunities systematically?`],
  pit: [r`Scaling infrastructure before examining the algorithm.`] },

{ id: 'q38', level: 'Principal', tags: ['interview-scenario', 'design'],
  q: r`Design an algorithm and service to detect duplicate payments (same beneficiary, amount, within 24 hours) at 20,000 payments per second.`,
  a: r`Define "duplicate" with the business: same debtor account, same beneficiary (normalised IBAN), same amount and currency, within 24 hours; possibly fuzzy reference.

Algorithm:

- Compute a **dedupe key** = hash(debtor, beneficiary IBAN, amount, currency).
- Maintain, per key, the timestamps of recent payments within 24 hours (sorted set or ring of timestamps).
- On a new payment: if the key has an entry within the window -> flag as potential duplicate (do not auto-reject; route to confirmation), then add the timestamp.

At 20,000/s:

- **Partition by key hash** (Kafka partition key = dedupe key) so each key's state lives on one consumer: no distributed locking.
- **State**: in-memory with a changelog/checkpoint (Kafka Streams/Flink state store) or Redis sorted sets with TTL. Memory: 20,000/s x 86,400 s = 1.7 B entries per day: too many for naive storage. Store only per-key latest timestamp + count (~40 bytes) with TTL 24 h, or a time-bucketed Bloom filter pre-check followed by an exact store lookup on "maybe".
- **Latency**: synchronous check in the payment path must be < 5 ms: local state lookups, not database queries.`,
  code: r`~~~csharp
public sealed class DuplicateDetector(IDatabase redis)
{
    public async Task<bool> IsPotentialDuplicateAsync(Payment p)
    {
        var key = "dup:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            p.DebtorAccount + "|" + Iban.Normalise(p.BeneficiaryIban) + "|" + p.Amount.ToString(CultureInfo.InvariantCulture) + "|" + p.Currency)))[..32];
        var now = p.CreatedAt.ToUnixTimeMilliseconds();
        var tx = redis.CreateTransaction();
        _ = tx.SortedSetRemoveRangeByScoreAsync(key, 0, now - 86_400_000);       // drop entries older than 24 h
        var recent = tx.SortedSetLengthAsync(key);
        _ = tx.SortedSetAddAsync(key, p.Id.ToString(), now);
        _ = tx.KeyExpireAsync(key, TimeSpan.FromHours(25));
        await tx.ExecuteAsync();
        return await recent > 0;                                                 // flag for confirmation, never silently drop
    }
}
~~~`,
  pts: [r`Agree the business definition of duplicate first.`, r`Hash a normalised dedupe key; keep recent timestamps per key with TTL.`, r`Partition by key hash so state is local; no distributed locks.`, r`Do the memory arithmetic; store compact state.`, r`Flag for confirmation instead of rejecting automatically.`],
  ex: r`A corporate-payments platform caught accidental double submissions of payroll files (worth millions) by flagging same-beneficiary, same-amount pairs within 24 hours for maker-checker confirmation.`,
  fu: [r`How would you add fuzzy matching on references?`],
  pit: [r`Database queries per payment in the synchronous path at 20,000/s.`] },

{ id: 'q39', level: 'Principal', tags: ['performance', 'measurement'],
  q: r`How do you decide whether algorithmic optimisation is worth the engineering effort?`,
  a: r`Use evidence and economics:

1. **Measure**: profile production (CPU, allocations, I/O waits) to find where time goes. Most wins come from a few hotspots.
2. **Size the opportunity**: latency SLO breaches, compute cost (instances x hours), batch window risk, user impact.
3. **Estimate the change**: complexity class change (O(n²) -> O(n log n)) usually beats micro-tuning; constant-factor wins matter only on hot paths.
4. **Consider alternatives**: caching, pre-computation, moving work off the request path, buying hardware (sometimes cheapest).
5. **Cost of complexity**: will the optimised code be harder to maintain? Encapsulate it and add benchmarks/tests.
6. **Decide and track**: before/after metrics in a short write-up.

Typical triggers: batch windows at risk, SLO breaches, cloud costs growing faster than traffic, or algorithmic growth that will break at forecast volume.`,
  code: r`~~~text
Optimisation proposal: settlement matcher
Evidence: p95 batch duration 5h40m (window 6h); profile: 78% CPU in MatchCandidates (O(n*m))
Forecast: volumes +40% next year -> batch exceeds window in ~4 months
Change: bucket candidates by (amount, currency) -> O(n + m) expected; 3 dev-weeks
Benefit: batch ~25 min; removes need for 2 extra large VMs (~$X/yr); eliminates window risk
Risk: matching rule regressions -> parallel run 2 weeks comparing outputs
~~~`,
  pts: [r`Profile production first; optimise hotspots only.`, r`Size the opportunity in SLOs, cost and risk.`, r`Complexity-class changes beat micro-tuning.`, r`Consider caching, precomputation or hardware as alternatives.`, r`Encapsulate optimised code with benchmarks and track results.`],
  ex: r`A forecast that a settlement batch would exceed its window in four months justified three weeks of algorithmic work and avoided a missed settlement deadline.`,
  fu: [r`When is buying hardware the right answer?`],
  pit: [r`Optimising code paths that are not on the profile.`] },

{ id: 'q40', level: 'Principal', tags: ['correctness', 'testing'],
  q: r`How do you verify the correctness of complex algorithms (matching, pricing, scheduling) in production systems?`,
  a: r`- **Property-based testing** (FsCheck, CsCheck): generate thousands of inputs and assert invariants (allocations always sum to the total; matched items never appear twice; schedule never overlaps).
- **Reference implementations / oracles**: compare the optimised algorithm with a slow, obviously-correct version on random inputs.
- **Golden datasets**: real anonymised cases with expected outputs agreed with the business (regression suite).
- **Parallel runs / shadow mode** in production before switching algorithms.
- **Metamorphic testing**: transformations with predictable effects (shuffling input order must not change totals).
- **Invariant checks in production**: cheap assertions with alerts (debits = credits, counts reconcile).
- **Formal methods** for critical concurrent protocols (TLA+ for consensus or distributed workflows).`,
  code: r`~~~csharp
// Property-based test with CsCheck: allocation always sums exactly and differs by at most 1 minor unit
[Fact]
public void Allocation_sums_to_total_and_is_fair() =>
    Gen.Select(Gen.Long[0, 10_000_000], Gen.Int[1, 20])
       .Sample((total, parts) =>
       {
           var result = Money.Allocate(total, Enumerable.Repeat(1m, parts).ToArray());
           return result.Sum() == total && result.Max() - result.Min() <= 1;
       });

// Oracle test: fast matcher vs naive matcher on random inputs
[Fact]
public void Fast_matcher_agrees_with_naive() =>
    GenReconInputs.Sample(input => FastMatcher.Run(input).SetEquals(NaiveMatcher.Run(input)));
~~~`,
  pts: [r`Property-based tests assert invariants over generated inputs.`, r`Compare optimised code to a slow, obviously correct oracle.`, r`Golden datasets agreed with the business guard regressions.`, r`Shadow or parallel runs in production before switching.`, r`Invariant alerts in production; formal methods for critical protocols.`],
  ex: r`Property-based tests found an allocation bug for 17-way splits that example-based tests had missed for two years.`,
  fu: [r`What is metamorphic testing?`],
  pit: [r`Only hand-picked example tests for numeric algorithms.`] },

{ id: 'q41', level: 'Principal', tags: ['scaling', 'algorithms'],
  q: r`An algorithm that works on one machine must now process 100x the data. Walk through how you scale it.`,
  a: r`1. **Profile and fix complexity** on one machine first (cheapest).
2. **Stream instead of load**: process in chunks, keep memory bounded.
3. **Parallelise within the machine**: partition data, use all cores ({{Parallel.ForEachAsync}}, data-parallel loops, SIMD).
4. **Partition across machines** by a key that keeps related data together (customer, account) so most work is local; avoid cross-partition joins.
5. **Map/shuffle/reduce** for aggregations; combiners to cut network.
6. **Handle skew**: hot keys split or processed separately.
7. **Make tasks idempotent and restartable** with checkpoints, so failures do not restart everything.
8. **Choose the platform**: Spark/Databricks for batch, Flink/Kafka Streams for streaming, or an MPP database where SQL suffices.

Quantify each step: memory per partition, network shuffle size, time per partition, and the cost of the cluster vs the business deadline.`,
  code: r`~~~csharp
// Step 3: in-machine partition parallelism with bounded concurrency and per-partition checkpoints
await Parallel.ForEachAsync(partitions, new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount, CancellationToken = ct },
    async (partition, token) =>
    {
        if (await checkpoints.IsDoneAsync(partition.Id, token)) return;          // restartable
        var result = ProcessStreaming(partition.Read());                        // bounded memory
        await sink.WriteAsync(partition.Id, result, token);                     // idempotent write keyed by partition
        await checkpoints.MarkDoneAsync(partition.Id, token);
    });
~~~`,
  pts: [r`Fix complexity on one machine first.`, r`Stream to bound memory.`, r`Parallelise across cores, then partition across machines by locality key.`, r`Handle skew and use combiners.`, r`Idempotent, checkpointed tasks; quantify cost against deadlines.`],
  ex: r`A KYC rescreening of 80 million customers moved from a 3-day single-node job to 4 hours by partitioning by country and checkpointing per partition.`,
  fu: [r`How do you choose a partition key?`],
  pit: [r`Jumping to a cluster while an O(n²) step remains.`] },

{ id: 'q42', level: 'Principal', tags: ['ai', 'algorithms'],
  q: r`What algorithmic concepts should a Principal understand about LLM and vector-search systems (tokenisation, ANN indexes, chunking)?`,
  a: r`- **Tokenisation**: text is split into subword tokens (BPE); cost and context limits are in tokens, not characters; numbers and non-English text often use more tokens.
- **Embeddings**: vectors where similar meanings are close; similarity via cosine/dot product.
- **ANN indexes**: exact nearest-neighbour search is O(n·d); **HNSW** (hierarchical navigable small-world graphs) gives fast approximate search with tunable recall (ef_search) and high memory; **IVF** (clustering + probing) and **product quantisation** trade recall for memory.
- **Chunking**: split documents into passages (by structure, ~200 to 800 tokens with overlap); chunk size affects recall and context cost.
- **Hybrid retrieval and re-ranking** improve precision.
- **Sampling** (temperature, top-p) controls randomness; temperature 0 for deterministic extraction.
- **Evaluation**: recall@k for retrieval, groundedness/faithfulness for generation, on labelled sets.

These decide cost, latency and quality more than model choice alone.`,
  code: r`~~~csharp
// Structure-aware chunking with overlap (token counts via a tokenizer such as Microsoft.ML.Tokenizers)
static IEnumerable<string> Chunk(IReadOnlyList<string> paragraphs, Tokenizer tok, int maxTokens = 500, int overlapTokens = 60)
{
    var current = new List<string>(); var count = 0;
    foreach (var p in paragraphs)
    {
        var n = tok.CountTokens(p);
        if (count + n > maxTokens && current.Count > 0)
        {
            yield return string.Join("\n", current);
            var tail = current[^1]; current = [tail]; count = Math.Min(tok.CountTokens(tail), overlapTokens);   // overlap
        }
        current.Add(p); count += n;
    }
    if (current.Count > 0) yield return string.Join("\n", current);
}
~~~`,
  pts: [r`Costs and limits are in tokens; tokenisation varies by language and content.`, r`ANN indexes (HNSW, IVF, PQ) trade recall, speed and memory.`, r`Chunk by structure with overlap; size affects recall and cost.`, r`Hybrid retrieval plus re-ranking improves precision.`, r`Evaluate retrieval and generation on labelled sets.`],
  ex: r`Re-chunking policy documents by section headings instead of fixed 1,000-character windows raised retrieval recall@5 from 58% to 81%.`,
  fu: [r`How does HNSW's ef_search parameter trade recall for latency?`],
  pit: [r`Fixed-size chunks that split tables and clauses mid-way.`] },

{ id: 'q43', level: 'Principal', tags: ['leadership', 'hiring'],
  q: r`How should algorithm skills be weighted when hiring Lead/Principal engineers, and how do you test them fairly?`,
  a: r`Algorithms matter as **reasoning about cost and correctness**, not as memorised puzzle solutions.

Weighting for Lead/Principal: system design, architecture judgement, leadership and production experience dominate; algorithmic reasoning is a gate (can they spot O(n²), choose the right structure, reason about scale) rather than the main signal.

Fair testing:

- Realistic problems from your domain (reconciliation, rate limiting, scheduling) rather than obscure puzzles.
- Allow the candidate's language, an editor with autocompletion, and documentation lookups.
- Evaluate clarification, approach, complexity reasoning, testing and production discussion with a rubric, not just "passed all tests".
- Calibrate interviewers with shared rubrics and example answers; avoid trick questions that reward recent practice over experience.
- Consider take-home or pairing formats for candidates who perform poorly under live pressure, with time limits respected.`,
  code: r`~~~text
Rubric (algorithmic round, Lead/Principal)          1 (weak) ........ 4 (strong)
Clarifies constraints and edge cases                 asks nothing      asks sizes, duplicates, failure modes
Reasoning about complexity                           none              states bottleneck and target, both time and space
Code quality                                         works by accident clear names, small functions, guards
Testing                                              none              walks edge cases, finds own bugs
Production and scale                                 none              streaming, partitioning, idempotency, observability
~~~`,
  pts: [r`Algorithms matter as cost and correctness reasoning.`, r`For senior roles they are a gate, not the main signal.`, r`Use realistic domain problems and normal tooling.`, r`Score with a rubric covering clarification, reasoning, testing and production.`, r`Calibrate interviewers and offer fair alternative formats.`],
  ex: r`Replacing puzzle rounds with a reconciliation exercise and rubric reduced interviewer disagreement and improved the correlation with on-the-job performance.`,
  fu: [r`How do you prevent rubric drift across interviewers?`],
  pit: [r`Rejecting experienced architects over an obscure DP puzzle.`] },

{ id: 'q44', level: 'Principal', tags: ['algorithms', 'risk'],
  q: r`Monte Carlo simulation: how would you implement a Value-at-Risk (VaR) calculation efficiently in .NET?`,
  a: r`Monte Carlo VaR: simulate many scenarios of market factor moves, revalue the portfolio under each, and take the loss at the chosen percentile (e.g. 99%).

Algorithm:

1. Model factor returns (e.g. correlated normal via Cholesky decomposition of the covariance matrix).
2. Generate N scenarios (10,000 to 100,000).
3. Revalue: for linear portfolios, P&L = sensitivities · factor moves (fast dot products); for options, full or approximate revaluation.
4. Sort P&L or use a selection algorithm (nth element) to get the 99th percentile loss: O(N) with quickselect.

Efficiency in .NET:

- Struct arrays and spans; **SIMD** via {{TensorPrimitives}} or {{Vector<T>}}.
- Parallelise scenarios across cores ({{Parallel.For}} with per-thread RNG).
- Reproducibility: seeded RNG per partition for audit; record seeds and model versions.
- Variance reduction (antithetic variates) to need fewer scenarios.
- Scale out across machines or GPUs for large books.`,
  code: r`~~~csharp
static double MonteCarloVaR(double[] sensitivities, double[,] cholesky, int scenarios, double confidence, int seed)
{
    int f = sensitivities.Length; var pnl = new double[scenarios];
    Parallel.For(0, scenarios, new ParallelOptions(), () => (Rng: new Random(seed ^ Environment.CurrentManagedThreadId), Z: new double[f], X: new double[f]),
        (s, _, st) =>
        {
            for (var i = 0; i < f; i++) st.Z[i] = Gaussian(st.Rng);
            for (var i = 0; i < f; i++) { double v = 0; for (var j = 0; j <= i; j++) v += cholesky[i, j] * st.Z[j]; st.X[i] = v; }   // correlate
            pnl[s] = System.Numerics.Tensors.TensorPrimitives.Dot(sensitivities, st.X);                                          // SIMD dot
            return st;
        }, _ => { });
    Array.Sort(pnl);
    return -pnl[(int)Math.Floor((1 - confidence) * scenarios)];      // 99% VaR = loss at the 1st percentile
}
static double Gaussian(Random r) { var u1 = 1.0 - r.NextDouble(); var u2 = r.NextDouble(); return Math.Sqrt(-2 * Math.Log(u1)) * Math.Cos(2 * Math.PI * u2); }
~~~
Note: for audit-grade reproducibility use per-partition seeds that do not depend on thread ids.`,
  pts: [r`Simulate correlated factor moves, revalue, take the loss percentile.`, r`Cholesky decomposition correlates independent normals.`, r`Linear portfolios: P&L is a dot product, SIMD-friendly.`, r`Parallelise scenarios with per-partition seeded RNGs for reproducibility.`, r`Quickselect or sort for the percentile; variance reduction cuts scenario counts.`],
  ex: r`A risk team cut an overnight VaR run from 3 hours to 12 minutes with struct arrays, SIMD dot products and parallel scenarios, and could rerun intraday.`,
  fu: [r`Historical vs parametric vs Monte Carlo VaR?`],
  pit: [r`Non-reproducible random seeds in regulatory calculations.`] },

{ id: 'q45', level: 'Principal', tags: ['algorithms', 'fairness'],
  q: r`Scheduling and fairness algorithms for multi-tenant platforms: weighted fair queuing, deficit round robin, priority aging.`,
  a: r`Problem: many tenants share workers or bandwidth; a heavy tenant must not starve others, and paid tiers may deserve more share.

- **Weighted fair queuing (WFQ)**: each tenant gets a share proportional to its weight; approximated by virtual finish times.
- **Deficit round robin (DRR)**: per-tenant queues; each round adds a quantum (weighted) to a tenant's deficit counter; it may send items while the deficit covers their cost. O(1) per item, handles variable-size work.
- **Priority with aging**: strict priorities starve low priorities; aging gradually raises waiting items' priority.
- **Token buckets per tenant** for rate fairness at ingress.
- **Shuffle sharding** to isolate noisy tenants on worker subsets.

Use cases: job platforms (report generation), message processing with per-tenant queues, API gateways, export services.`,
  code: r`~~~csharp
public sealed class DeficitRoundRobin<T>(Func<T, int> cost)
{
    private readonly Dictionary<string, (Queue<T> Q, int Quantum, int Deficit)> _tenants = new();
    private readonly List<string> _order = new(); private int _next;
    public void Enqueue(string tenant, T item, int quantum)
    {
        if (!_tenants.TryGetValue(tenant, out var t)) { t = (new Queue<T>(), quantum, 0); _order.Add(tenant); }
        t.Q.Enqueue(item); _tenants[tenant] = t;
    }
    public IEnumerable<T> NextRound()
    {
        for (var n = 0; n < _order.Count; n++, _next = (_next + 1) % _order.Count)
        {
            var name = _order[_next]; var t = _tenants[name];
            if (t.Q.Count == 0) { t.Deficit = 0; _tenants[name] = t; continue; }
            t.Deficit += t.Quantum;                                        // weighted quantum per round
            while (t.Q.Count > 0 && cost(t.Q.Peek()) <= t.Deficit) { var item = t.Q.Dequeue(); t.Deficit -= cost(item); yield return item; }
            _tenants[name] = t;
        }
    }
}
~~~`,
  pts: [r`Fairness prevents heavy tenants starving others.`, r`WFQ shares capacity by weight.`, r`Deficit round robin is O(1) and handles variable work sizes.`, r`Aging prevents starvation under strict priorities.`, r`Combine with per-tenant token buckets and shuffle sharding.`],
  ex: r`A reporting platform where one tenant's 10,000-report batch blocked everyone moved to per-tenant DRR queues; small tenants' wait times fell from hours to seconds.`,
  fu: [r`How do you pick quanta for tiers?`],
  pit: [r`One global FIFO queue for all tenants.`] },

{ id: 'q46', level: 'Principal', tags: ['algorithms', 'data-quality'],
  q: r`Entity resolution at scale (matching customer records across systems): which algorithms and pipeline?`,
  a: r`Pipeline:

1. **Standardise**: normalise names (case, accents, titles), addresses (postal standards), phones (E.164), emails, dates.
2. **Blocking**: group candidates cheaply to avoid n² comparisons: phonetic keys (Soundex, Double Metaphone), postcode + surname prefix, email domain, sorted neighbourhood, or LSH (MinHash) for fuzzy text.
3. **Pairwise scoring** within blocks: Jaro-Winkler for names, edit distance, exact matches on strong identifiers (national id, email), weighted (Fellegi-Sunter probabilistic matching) or ML classifiers.
4. **Clustering**: link pairs above a threshold and form entities with Union-Find (transitive closure), with safeguards against chaining unrelated records.
5. **Survivorship**: rules choose the best value per attribute for the golden record.
6. **Human review** for the grey zone; feedback improves thresholds.
7. **Incremental** processing for new records, plus periodic full re-runs.`,
  code: r`~~~csharp
// Blocking + scoring + clustering, simplified
var blocks = customers.GroupBy(c => (Phonetic.DoubleMetaphone(c.LastName), c.Postcode[..Math.Min(4, c.Postcode.Length)]));
var uf = new UnionFind();
foreach (var block in blocks)
{
    var list = block.ToList();
    for (var i = 0; i < list.Count; i++)
    for (var j = i + 1; j < list.Count; j++)
    {
        var score = 0.5 * JaroWinkler(list[i].FullName, list[j].FullName)
                  + 0.3 * (list[i].DateOfBirth == list[j].DateOfBirth ? 1 : 0)
                  + 0.2 * (Phone.E164(list[i].Phone) == Phone.E164(list[j].Phone) ? 1 : 0);
        if (score >= 0.92) uf.Union(list[i].Id, list[j].Id);           // auto-link
        else if (score >= 0.80) reviewQueue.Add((list[i].Id, list[j].Id, score));
    }
}
~~~`,
  pts: [r`Standardise fields before matching.`, r`Blocking avoids n² comparisons.`, r`Score pairs with string similarity and strong identifiers.`, r`Cluster with Union-Find, guarding against chaining.`, r`Survivorship rules, human review for the grey zone, incremental updates.`],
  ex: r`A bank merging three core systems resolved 42 million records into 29 million customers; blocking reduced comparisons from 10^15 to 10^9.`,
  fu: [r`How do you prevent a chain of weak links merging unrelated people?`],
  pit: [r`No blocking, or blocking keys so strict they miss true matches.`] },

{ id: 'q47', level: 'Principal', tags: ['algorithms', 'compliance'],
  q: r`How do you make algorithmic decisions explainable and auditable (credit, fraud, matching) for regulators?`,
  a: r`- **Prefer interpretable algorithms** where decisions affect customers: rules, scorecards, monotonic gradient boosting with reason codes, over opaque models when explanations are required (e.g. credit adverse action notices).
- **Reason codes**: return the top factors behind each decision ("velocity in last hour", "new device").
- **Versioning**: algorithm/model version, parameters, thresholds and data snapshot recorded per decision.
- **Reproducibility**: deterministic algorithms or recorded seeds; ability to replay a past decision with the same inputs and version.
- **Decision logs**: immutable records with inputs (or hashes and references), outputs, reasons, actor and time.
- **Testing and monitoring**: bias/fairness checks, drift monitoring, back-testing; model-risk governance (SR 11-7 style validation).
- **Human-in-the-loop** for borderline cases with recorded overrides.`,
  code: r`~~~csharp
public sealed record Decision(Guid Id, string Subject, string Outcome, IReadOnlyList<string> ReasonCodes,
                              string AlgorithmVersion, string ParametersHash, DateTimeOffset At);
public Decision Score(Application a)
{
    var reasons = new List<string>();
    var score = 600;
    if (a.MonthsAtAddress < 6) { score -= 40; reasons.Add("R01: short time at address"); }
    if (a.DebtToIncome > 0.45m) { score -= 70; reasons.Add("R07: high debt-to-income"); }
    var outcome = score >= _params.ApproveThreshold ? "APPROVE" : score >= _params.ReferThreshold ? "REFER" : "DECLINE";
    return new Decision(Guid.NewGuid(), a.Id, outcome, reasons, "scorecard-2026.3", _params.Hash, _clock.GetUtcNow());   // appended to an immutable log
}
~~~`,
  pts: [r`Prefer interpretable algorithms where customers are affected.`, r`Return reason codes with every decision.`, r`Record algorithm version, parameters and data references per decision.`, r`Make decisions replayable; log immutably.`, r`Monitor bias and drift; keep humans in the loop for borderline cases.`],
  ex: r`A lender answered a regulator's challenge on 300 declined applications within a day by replaying each decision with its recorded scorecard version and reason codes.`,
  fu: [r`How do you explain a gradient-boosted model's decision?`],
  pit: [r`Overwriting model parameters without versioning.`] },

{ id: 'q48', level: 'Principal', tags: ['algorithms', 'cost'],
  q: r`How do algorithm choices affect cloud cost, and how do you make engineers cost-aware?`,
  a: r`Cloud bills are proportional to work: CPU-seconds, memory GB-hours, I/O operations, network egress and requests. Algorithms change all of them:

- O(n²) jobs consume compute exponentially with growth.
- Chatty algorithms (per-item API or database calls) multiply request and I/O charges (DynamoDB RCUs, S3 GETs, API Gateway requests).
- Shuffles in distributed jobs drive network and runtime.
- Full scans vs indexed lookups change database tiers.
- Compression and columnar formats trade CPU for storage and I/O.

Making engineers cost-aware:

- **Unit cost metrics** per feature (cost per 1,000 payments, per report).
- Cost estimates in design docs alongside latency.
- Dashboards attributing cost to services (tags).
- Review checklists: batching, pagination, caching, data formats.
- Celebrate cost wins like performance wins.`,
  code: r`~~~text
Cost estimate in a design doc: nightly statement generation
Approach A: per-customer queries (3 M customers x 4 queries) = 12 M DB calls -> 2.5 h on 8 vCPU DB, ~$X/month
Approach B: set-based extraction per branch (1,200 queries) + parallel render workers
            -> 25 min DB time on the same instance, render on spot instances -> ~$X/4 per month
Decision: B; unit cost target $0.0004 per statement, tracked on the FinOps dashboard
~~~`,
  pts: [r`Cloud cost tracks CPU, memory, I/O, requests and egress.`, r`Complexity growth, chatty calls and shuffles dominate bills.`, r`Put cost estimates in design documents.`, r`Track unit costs per business operation.`, r`Celebrate cost wins like performance wins.`],
  ex: r`Batching DynamoDB reads in a statement job cut its monthly request cost by 85% with a two-day change.`,
  fu: [r`How do you attribute shared platform costs to teams?`],
  pit: [r`Per-item cloud API calls in large batch loops.`] },

{ id: 'q49', level: 'Principal', tags: ['code-review'],
  q: r`Code review: find the algorithmic problems in this "top customers by revenue" endpoint.`,
  a: r`~~~csharp
app.MapGet("/top-customers", async (AppDb db, int n) =>
{
    var customers = await db.Customers.ToListAsync();
    var result = new List<(Customer, decimal)>();
    foreach (var c in customers)
    {
        var revenue = db.Orders.Where(o => o.CustomerId == c.Id).ToList().Sum(o => o.Total);
        result.Add((c, revenue));
        result = result.OrderByDescending(x => x.Item2).ToList();
    }
    return result.Take(n);
});
~~~

1. **N+1 queries**: one orders query per customer (millions of round trips), and each loads all orders into memory before summing.
2. **Sorting inside the loop**: O(n² log n) total.
3. **Loads all customers** into memory for a top-N question.
4. Synchronous {{ToList}} on the orders query inside an async handler.
5. No bound on {{n}}; no caching for an expensive, slowly changing ranking.

Fix: push aggregation to the database ({{GROUP BY}} + {{ORDER BY}} + {{TOP n}}), with an index on (CustomerId) INCLUDE (Total), or a precomputed daily revenue table; cap n; cache for minutes.`,
  code: r`~~~csharp
app.MapGet("/top-customers", async (AppDb db, HybridCache cache, int n, CancellationToken ct) =>
{
    n = Math.Clamp(n, 1, 100);
    return await cache.GetOrCreateAsync("top-customers:" + n, async t =>
        await db.Orders.GroupBy(o => o.CustomerId)
            .Select(g => new { CustomerId = g.Key, Revenue = g.Sum(o => o.Total) })
            .OrderByDescending(x => x.Revenue).Take(n)
            .Join(db.Customers, x => x.CustomerId, c => c.Id, (x, c) => new TopCustomer(c.Id, c.Name, x.Revenue))
            .ToListAsync(t),
        new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(10) }, cancellationToken: ct);
});
~~~`,
  pts: [r`N+1 queries and loading every order into memory.`, r`Sorting inside the loop makes it O(n² log n).`, r`Push GROUP BY, ORDER BY and TOP to the database.`, r`Bound n and cache slowly changing rankings.`, r`Consider a precomputed revenue table for large volumes.`],
  ex: r`This endpoint pattern took 14 minutes on a production-sized database; the set-based version returned in 300 ms and 5 ms when cached.`,
  fu: [r`How would you make this real time?`],
  pit: [r`Fixing only the sort and leaving the N+1.`] },

{ id: 'q50', level: 'Principal', tags: ['summary'],
  q: r`Summarise how a Principal Engineer applies algorithms in real systems.`,
  a: r`"I use algorithms to reason about cost, correctness and scale:

- I start from sizes and growth: what is n today and in two years, and which part of the work grows fastest.
- I recognise problem shapes: hash joins, sliding windows, heaps for top-K, graph traversals, DP, greedy with proof, k-way merges, consistent hashing.
- I respect distributed realities: unknown outcomes, logical time, consensus quorums, jittered backoff, idempotency.
- I prefer set-based and streaming designs over per-item loops and full materialisation.
- I verify with property-based tests, oracles and parallel runs, and I make regulated decisions explainable and reproducible.
- I tie optimisation to evidence: profiles, SLOs, cloud cost and business deadlines."`,
  code: r`~~~csharp
// The habits in one snippet: bounded streaming, hash join, heap top-K, deterministic output
var bankByKey = bankLines.ToLookup(b => (b.Ref, b.Amount, b.Ccy));                       // hash join O(n + m)
var unmatched = ledger.Where(l => !bankByKey[(l.Ref, l.Amount, l.Ccy)].Any());
var top = new PriorityQueue<Ledger, decimal>();
foreach (var u in unmatched) { top.Enqueue(u, u.Amount); if (top.Count > 20) top.Dequeue(); }   // top-20 by amount, O(n log 20)
var report = top.UnorderedItems.Select(x => x.Element).OrderByDescending(x => x.Amount).ThenBy(x => x.Id);   // deterministic
~~~`,
  pts: [r`Reason from sizes and growth.`, r`Recognise standard problem shapes.`, r`Respect distributed-systems realities.`, r`Prefer set-based and streaming designs.`, r`Verify rigorously and tie optimisation to evidence.`],
  ex: r`Telling one story where an algorithmic insight cut a batch from hours to minutes, with numbers, is the strongest close in an algorithms discussion.`,
  fu: [r`Which algorithm have you used most in production?`],
  pit: [r`Treating algorithms as interview-only knowledge.`] }
],
cheat: r`### Pattern recognition
| Problem shape | Technique | Complexity |
|---|---|---|
| Pair/complement, duplicates, counts | Hash map / set | O(n) |
| Sorted pairs, compaction | Two pointers | O(n) |
| Contiguous ranges with a constraint | Sliding window | O(n) |
| Range sums (static / with updates) | Prefix sums / Fenwick | O(1) query / O(log n) |
| Top-K, scheduling, merges | Heap (PriorityQueue) | O(n log k) |
| Monotonic predicate | Binary search on answer | O(log range · check) |
| Overlapping subproblems | Dynamic programming | states x transitions |
| Locally optimal = globally optimal (proved) | Greedy | O(n log n) |
| Enumerate with constraints | Backtracking + pruning | exponential, pruned |
| Connectivity / shortest hops | BFS/DFS, Union-Find | O(V + E) |
| Weighted paths | Dijkstra / A* / Bellman-Ford | O((V+E) log V) / O(VE) |
| Dependencies | Topological sort (Kahn) | O(V + E) |

### Systems algorithms
External merge sort · MapReduce (combiners, skew salting) · stream windows + watermarks · P2C load balancing · exponential backoff with full jitter · token bucket / GCRA · XFetch + single-flight · Raft (majority commit, randomised elections) · Lamport/vector/HLC clocks · reservoir sampling · Aho-Corasick / SearchValues · Little's Law sizing · DRR fairness.

### Money and correctness
decimal or minor units · explicit rounding mode and point · largest-remainder allocation · timeouts = unknown outcome · property-based tests + oracles + parallel runs · reason codes and versioned, replayable decisions.

### Say this
"What is n, and how fast does it grow?" "Index one side, then join." "Timeouts are unknown outcomes." "Jitter or you get a retry storm." "Prove the greedy choice or use DP."`
});
})(String.raw);
