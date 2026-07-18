# Module 103 — Performance Engineering: Caching Strategies & Data Access Performance

> Domain: Performance Engineering | Level: Beginner → Expert | Prerequisite: [[01-PerformanceProfiling-BottleneckDiagnosis]] §Advanced Q6 (the cache-hit-rate silent-degradation finding this module formalizes), [[02-LoadTesting-CapacityPlanning-Benchmarking]] (capacity/load-testing discipline this module's cache-layer sizing reuses), [[../07-Redis]] modules (this module's distributed-caching patterns build directly on Redis's data structures and persistence model)
>
> **Note on format:** Per the standing user preference (see `CLAUDE.md`), this module covers only the 40 most-frequently-asked interview questions (10 per level), without the full 15-section deep-dive template.

---

## Interview Questions

### Basic (10)

1. **Q: What is caching, and why does it improve performance?**
   **A:** Caching stores a copy of expensive-to-compute or expensive-to-fetch data in a faster-access location, so subsequent requests for the same data can be served from the cache instead of repeating the original, slower operation.
   **Why correct:** States the mechanism (storing a faster-access copy) and the reason it helps (avoiding repeated, expensive work).
   **Common mistakes:** Assuming caching is free — it always introduces a consistency trade-off (the copy can become stale) in exchange for speed.
   **Follow-ups:** "What's the fundamental trade-off caching always introduces?" (Consistency — a cached value can diverge from the current, true source-of-truth value until invalidated or refreshed.)

2. **Q: What is the difference between cache-aside and read-through caching?**
   **A:** In cache-aside, the application explicitly checks the cache, and on a miss, fetches from the source and populates the cache itself. In read-through, the cache sits in front of the data source and handles the miss-and-populate logic transparently — the application only ever talks to the cache.
   **Why correct:** States who owns the miss-handling logic (application vs. cache layer) as the defining distinction.
   **Common mistakes:** Treating the two as interchangeable, missing that cache-aside requires explicit application code for every access path while read-through centralizes that logic.
   **Follow-ups:** "Which is more common in practice, and why?" (Cache-aside — it requires no specialized caching infrastructure beyond a simple key-value store, and gives the application explicit control over caching logic.)

3. **Q: What is write-through versus write-behind (write-back) caching?**
   **A:** Write-through writes to the cache and the underlying data source synchronously, in the same operation. Write-behind (write-back) writes to the cache immediately but defers the write to the underlying data source asynchronously, improving write latency at the cost of a window where the source of truth is out of date.
   **Why correct:** States the synchronous-vs-deferred distinction and the specific trade-off (write latency vs. durability window) each implies.
   **Common mistakes:** Assuming write-behind is a strict improvement, without recognizing its durability risk if the cache fails before the deferred write completes.
   **Follow-ups:** "What's the risk of write-behind specifically?" (Data loss if the cache node crashes before the deferred write to the durable data source has completed.)

4. **Q: What is a cache TTL (time to live), and what's the trade-off in setting it too short or too long?**
   **A:** TTL is the duration a cached value is considered valid before automatic expiration. Too short a TTL causes excessive cache misses and repeated, expensive source-fetches (reducing the cache's benefit); too long a TTL risks serving stale data for an extended period after the underlying source changes.
   **Why correct:** States both failure directions of the trade-off precisely.
   **Common mistakes:** Setting a single, arbitrary TTL uniformly across all data, without considering each data type's actual staleness tolerance and change frequency.
   **Follow-ups:** "How would you choose an appropriate TTL for a specific data type?" (Based on that data's actual observed change frequency and the application's tolerance for staleness — frequently-changing, freshness-critical data warrants a much shorter TTL than rarely-changing, staleness-tolerant data.)

5. **Q: What is cache invalidation, and why is it considered a hard problem?**
   **A:** Cache invalidation is removing or updating a cached value when the underlying source data changes, so the cache doesn't continue serving stale data indefinitely. It's hard because correctly identifying every cache entry affected by a given underlying change (especially across complex, multi-entity relationships) is often non-trivial, and getting it wrong produces silent, hard-to-detect staleness bugs.
   **Why correct:** States the mechanism and the specific reason for its difficulty (identifying the full, correct blast radius of affected cache entries).
   **Common mistakes:** Assuming a short TTL alone is a sufficient substitute for genuine, event-driven invalidation.
   **Follow-ups:** "What's a simpler alternative to precise, surgical invalidation?" (A shorter TTL as a safety net, accepting some staleness window, when precise invalidation is too complex to implement correctly for a given data relationship.)

6. **Q: What is a CDN, and what does it cache?**
   **A:** A Content Delivery Network is a geographically-distributed network of caching servers (edge nodes) placed close to end users, caching static (and sometimes dynamic) content so requests are served from a nearby edge location rather than traveling to the origin server every time.
   **Why correct:** States the geographic-distribution mechanism and its purpose (reducing network latency to the origin).
   **Common mistakes:** Assuming a CDN only caches static assets (images, JS/CSS) — many modern CDNs also support caching dynamic API responses with appropriate cache-control headers.
   **Follow-ups:** "What HTTP mechanism controls CDN caching behavior?" (Cache-Control and related headers (ETag, Expires) on the origin's response, instructing the CDN how long and under what conditions to cache a given response.)

7. **Q: What is database connection pooling, and why does it matter for performance?**
   **A:** Connection pooling maintains a reusable set of already-established database connections rather than opening and closing a new connection per request — since establishing a connection (TCP handshake, authentication) is comparatively expensive, reusing pooled connections avoids paying that cost on every single request.
   **Why correct:** States the mechanism and the specific cost (connection-establishment overhead) it avoids.
   **Common mistakes:** Sizing a connection pool arbitrarily without considering the database server's own maximum-connection limit, per Module 102 Advanced Q7.
   **Follow-ups:** "What happens if the application requests more connections than the pool's configured maximum?" (Requests queue, waiting for a connection to become available — appearing as increased latency rather than an outright failure, until a configured wait-timeout is exceeded.)

8. **Q: What is pagination, and why is offset-based pagination problematic at scale?**
   **A:** Pagination retrieves a large result set in smaller, sequential pages rather than all at once. Offset-based pagination (`OFFSET n LIMIT m`) requires the database to scan and discard all `n` preceding rows on every page request, making later pages progressively slower as the offset grows — a real, scaling performance problem for deep pagination.
   **Why correct:** States the specific mechanism (scan-and-discard cost growing with offset) causing the scaling problem.
   **Common mistakes:** Assuming pagination performance is uniform regardless of page depth, missing that offset-based pagination specifically degrades as the offset increases.
   **Follow-ups:** "What's the standard alternative?" (Keyset/cursor-based pagination — using the last-seen row's key value to fetch the next page directly via an indexed range condition, avoiding the scan-and-discard cost entirely.)

9. **Q: What is a read replica, and how does it help read-heavy workloads?**
   **A:** A read replica is a copy of a primary database kept synchronized (typically asynchronously) that serves read-only queries, offloading read traffic from the primary so it can focus on handling writes — increasing overall read capacity by distributing read load across multiple replica instances.
   **Why correct:** States the mechanism (a synchronized, read-only copy) and its specific benefit (read-load distribution).
   **Common mistakes:** Assuming a read replica is always perfectly up to date, ignoring replication lag's consistency implications.
   **Follow-ups:** "What consistency risk does a read replica introduce?" (Replication lag — a read against a replica may return data slightly older than the primary's current state, risking a "read-your-own-write" consistency violation if not accounted for.)

10. **Q: What is denormalization, and what performance trade-off does it make?**
    **A:** Denormalization duplicates or restructures data (e.g., storing a computed aggregate or a joined field directly) to optimize read performance, at the cost of increased storage and more complex, error-prone write logic needed to keep the duplicated data consistent with its source.
    **Why correct:** States the mechanism and the specific trade-off (read speed vs. write complexity/consistency risk).
    **Common mistakes:** Assuming denormalization is purely beneficial without weighing the added write-side consistency-maintenance burden it introduces.
    **Follow-ups:** "When is denormalization a reasonable trade-off?" (When read volume vastly exceeds write volume for the specific data, and the consistency-maintenance cost is manageable — e.g., a well-understood, infrequently-changing aggregate.)

### Intermediate (10)

1. **Q: What is cache stampede (thundering herd), and how do you prevent it?**
   **A:** When a popular cache entry expires, many concurrent requests simultaneously experience a cache miss and all attempt to recompute/refetch the same expensive value at once, overwhelming the underlying data source. Prevention: use a lock/mutex so only one request recomputes the value while others wait for the result, or use a "stale-while-revalidate" pattern serving the stale value while one request refreshes it in the background.
   **Why correct:** States the specific failure mechanism (many concurrent recomputations) and two concrete prevention techniques.
   **Common mistakes:** Assuming a cache alone prevents this — the stampede specifically occurs at the moment of expiration, when the cache temporarily provides no protection at all.
   **Follow-ups:** "Why is 'stale-while-revalidate' often preferable to a blocking lock?" (It avoids making every waiting request block on the recomputation — most requests get a fast, slightly-stale response immediately while one request refreshes the value in the background.)

2. **Q: How would you design cache keys to avoid collisions and support easy invalidation?**
   **A:** Include every parameter that affects the cached value's content in the key (e.g., a query's filter parameters, a user's tenant ID, an API version), using a consistent, structured naming convention (e.g., `entity:id:version`) that also enables pattern-based bulk invalidation (e.g., invalidating every key matching `invoice:123:*` when invoice 123 changes).
   **Why correct:** States both requirements (full parameter inclusion to avoid collision, structured naming to enable bulk invalidation).
   **Common mistakes:** Omitting a parameter that affects the cached content from the key, causing two different results to collide under the identical cache key.
   **Follow-ups:** "What's the risk of an overly generic cache key?" (Two logically distinct requests could collide on the same key, causing one user/context to incorrectly receive another's cached data — directly Module 97 §2.2's IDOR risk recurring in caching form if the key doesn't include the requesting principal's identity where relevant.)

3. **Q: What's the risk of caching data that's part of a security/authorization decision?**
   **A:** If an authorization check's result (or the underlying data an authorization decision depends on) is cached without properly scoping the cache key to the requesting principal, a stale or incorrectly-shared cache entry could grant one user access to another's data — directly recreating Module 97 §4's IDOR vulnerability class through a caching-layer mechanism rather than a missing authorization check.
   **Why correct:** Connects caching's key-scoping risk directly to an already-established course finding (broken object-level authorization).
   **Common mistakes:** Caching an authorization decision or a resource's data without including the requesting principal's identity in the cache key, risking cross-principal data leakage via cache collision.
   **Follow-ups:** "How would you mitigate this specific risk?" (Always include the authenticated principal's identity as part of the cache key for any data whose access is principal-scoped, and re-verify authorization on every request regardless of cache hit/miss status, never skipping the authorization check just because a cached value exists.)

4. **Q: How does eventual consistency in a distributed cache affect application design?**
   **A:** A distributed cache (e.g., a Redis cluster) may briefly return different values from different nodes during replication/propagation delay, meaning the application must be designed to tolerate a brief window of inconsistency rather than assuming every read immediately reflects the most recent write across the entire cluster.
   **Why correct:** States the specific consistency behavior and its design implication (tolerance for brief inconsistency).
   **Common mistakes:** Assuming a distributed cache provides the same immediate, strong consistency as a single-node, in-process cache.
   **Follow-ups:** "What application pattern helps tolerate this?" (Designing idempotent, retry-safe operations and avoiding critical business logic that assumes an immediately, globally-consistent cache read.)

5. **Q: What is the difference between LRU, LFU, and TTL-based cache eviction policies?**
   **A:** LRU (Least Recently Used) evicts the entry that hasn't been accessed for the longest time. LFU (Least Frequently Used) evicts the entry accessed the fewest total times. TTL-based eviction removes an entry once its explicit expiration time is reached, regardless of access pattern.
   **Why correct:** States each policy's specific eviction criterion precisely.
   **Common mistakes:** Assuming LRU and LFU are interchangeable — a rarely-but-recently-accessed item survives under LRU but could still be evicted under LFU if its total access count is low.
   **Follow-ups:** "When would LFU be preferable to LRU?" (When a small set of consistently popular items should be protected from eviction even during a temporary burst of one-off accesses to unrelated items, which LRU alone could otherwise evict them in favor of.)

6. **Q: How do you handle cache invalidation across multiple cache layers (browser cache, CDN, application cache, database query cache)?**
   **A:** Each layer needs its own explicit invalidation/expiration strategy — invalidating only the application-level cache while a CDN or browser cache still serves a longer-lived, stale copy produces an inconsistent experience; use consistent versioning (e.g., a version/hash embedded in the resource URL) so a genuine content change produces a new, distinct cache key at every layer simultaneously, rather than relying on each layer's independent TTL to eventually, separately expire.
   **Why correct:** States the multi-layer risk and the specific technique (versioned URLs) that invalidates consistently across every layer at once.
   **Common mistakes:** Invalidating only the layer closest to the application, assuming that alone resolves staleness, while a farther-out layer (CDN, browser) continues serving an old, cached version.
   **Follow-ups:** "Why is versioned-URL invalidation more reliable than relying on each layer's TTL?" (A new URL is treated as an entirely new resource by every caching layer, guaranteeing an immediate cache miss and fresh fetch everywhere, rather than waiting for each layer's independent TTL to separately expire on its own schedule.)

7. **Q: What is keyset/cursor-based pagination, and why is it preferred over offset-based pagination at scale?**
   **A:** Keyset pagination fetches the next page using a `WHERE key > last_seen_key ORDER BY key LIMIT n` condition against an indexed column, rather than an offset — this lets the database use the index to jump directly to the correct starting point, with performance independent of how deep into the result set the page is, unlike offset-based pagination's scan-and-discard cost.
   **Why correct:** States the specific query mechanism and why its performance doesn't degrade with page depth.
   **Common mistakes:** Assuming keyset pagination is a drop-in replacement with identical semantics — it doesn't support jumping to an arbitrary page number directly, only sequential next/previous navigation from a known cursor.
   **Follow-ups:** "What UX limitation does keyset pagination impose compared to offset pagination?" (It doesn't naturally support "jump to page 50" navigation — only sequential paging from a cursor — a real trade-off for UIs that want arbitrary page-number access.)

8. **Q: How would you decide what to cache versus what not to cache?**
   **A:** Cache data that is expensive to compute/fetch relative to how cheap it is to serve from cache, is read far more frequently than it changes, and whose staleness tolerance matches an acceptable TTL or invalidation strategy — avoid caching data that changes as often as it's read (minimal benefit), or data whose staleness carries a genuinely unacceptable risk (e.g., a real-time account balance in some contexts) without a robust, immediate invalidation mechanism.
   **Why correct:** States concrete criteria (cost-to-benefit ratio, read/write ratio, staleness tolerance) rather than a blanket rule.
   **Common mistakes:** Applying a blanket "cache everything" or "cache nothing" policy rather than evaluating each data type's specific access pattern and staleness tolerance.
   **Follow-ups:** "What's a red flag suggesting a specific piece of data shouldn't be cached?" (A read/write ratio close to 1:1 — meaning the cache would need to be invalidated almost as often as it's read, providing minimal net benefit while adding invalidation-correctness risk.)

9. **Q: What is a negative cache (caching "not found" results), and why is it useful?**
   **A:** Caching the fact that a specific lookup returned no result, so a repeated request for the same non-existent key doesn't repeatedly hit the expensive underlying data source only to confirm "still not found" every time — particularly valuable against a pattern of repeated lookups for keys known (or likely) not to exist.
   **Why correct:** States the specific mechanism and the repeated-miss cost it avoids.
   **Common mistakes:** Caching only positive (found) results, missing that a flood of repeated lookups for non-existent keys can itself become a real performance/load problem without negative caching.
   **Follow-ups:** "What's a risk of negative caching if not carefully TTL'd?" (If the underlying data is later created, a too-long negative-cache TTL could continue incorrectly reporting "not found" for longer than acceptable after the data actually became available.)

10. **Q: How does connection-pool sizing interact with database max-connection limits under high concurrency?**
    **A:** Each application instance's connection pool consumes a share of the database server's own finite maximum-connection limit — with many horizontally-scaled application instances, the aggregate connection demand across all instances can exceed the database's actual limit even if each individual instance's pool seems modestly sized, requiring careful, fleet-wide connection budgeting rather than sizing each instance's pool in isolation.
    **Why correct:** States the aggregate, fleet-wide constraint that individual, per-instance pool sizing can overlook.
    **Common mistakes:** Sizing each application instance's connection pool independently without considering the total aggregate demand across every horizontally-scaled instance combined.
    **Follow-ups:** "What architectural pattern helps manage this at scale?" (A connection-pooling proxy/multiplexer (e.g., PgBouncer for PostgreSQL) sitting between many application instances and the database, multiplexing many logical application connections over a smaller, bounded number of actual database connections.)

### Advanced (10)

1. **Q: Design a cache invalidation strategy for a system with complex, multi-entity relationships, where a cached view depends on several underlying entities.**
   **A:** Maintain an explicit dependency/tag registry mapping each cached view's key to the set of underlying entity IDs it depends on; on any entity's change, look up and invalidate every cached view tagged with that entity's ID, rather than attempting to infer dependencies implicitly or relying on a uniform TTL alone — directly analogous to a build system's dependency graph, applied to cache invalidation specifically.
   **Why correct:** Proposes a concrete, explicit dependency-tracking mechanism rather than an implicit or purely time-based approach.
   **Common mistakes:** Relying on a single, uniform TTL across every cached view regardless of its actual dependency complexity, accepting more staleness risk than an explicit dependency-tracking approach would require.
   **Follow-ups:** "What's the cost of this explicit dependency-tracking approach?" (Additional bookkeeping overhead — maintaining the tag registry itself, and ensuring every code path that changes an entity correctly triggers the corresponding tagged invalidations, a correctness burden proportional to the relationship's actual complexity.)

2. **Q: How would you prevent a cache stampede specifically during a cold cache after a full cache-cluster restart?**
   **A:** Pre-warm the cache proactively before routing real traffic to it (replaying recent, representative access patterns or the most popular keys from before the restart) rather than allowing the first wave of real production traffic to hit an entirely empty cache simultaneously; alternatively, apply request-rate limiting/queuing at the origin data store specifically during the cache's warm-up window, bounding the origin's load regardless of how many concurrent cache misses occur.
   **Why correct:** Proposes two concrete, complementary mitigations (proactive pre-warming, origin-side rate limiting during warm-up) specifically for the cold-cache-after-restart scenario.
   **Common mistakes:** Relying solely on the per-key stampede protection (Intermediate Q1's lock/stale-while-revalidate) designed for a single popular key's expiration, which doesn't address the fundamentally larger blast radius of an entirely empty cache after a full restart.
   **Follow-ups:** "Why is a full cache-cluster restart categorically worse than a single key's expiration?" (Every key is simultaneously cold, not just one popular one — meaning the stampede risk applies across the system's entire working set at once, not a single, isolated hot key.)

3. **Q: Design a multi-region caching strategy for a globally-distributed application.**
   **A:** Use region-local caches (colocated with each region's application instances) for low-latency reads, backed by a mechanism propagating invalidation events across regions (e.g., a pub/sub invalidation broadcast) when the underlying source-of-truth data changes in any region — accepting a brief, bounded cross-region propagation delay as an explicit consistency trade-off, rather than either forcing every read through a single, centralized cache (reintroducing cross-region latency) or allowing regions to silently diverge indefinitely with no invalidation-propagation mechanism at all.
   **Why correct:** Proposes a concrete architecture (region-local caches, pub/sub cross-region invalidation) with an explicit, acknowledged consistency trade-off.
   **Common mistakes:** Either centralizing caching entirely (sacrificing the latency benefit multi-region deployment is meant to provide) or maintaining fully independent, unsynchronized regional caches with no cross-region invalidation mechanism at all.
   **Follow-ups:** "What's the risk if the cross-region invalidation broadcast itself fails silently?" (A region continues serving stale data indefinitely with no signal anything is wrong — directly this course's recurring "silent degradation of a verification/propagation mechanism" theme, requiring its own monitored health signal.)

4. **Q: How would you detect and diagnose a silently degraded cache hit rate in production, extending Module 101 Advanced Q6's finding?**
   **A:** Continuously monitor and alert on the cache's actual hit-rate metric against an established baseline (directly Module 94's alerting discipline, applied to cache health specifically) — a sudden or gradual hit-rate drop, even while the application continues functioning correctly and returning correct results, signals the cache is silently providing less of its intended performance benefit, discoverable only via this active metric, never via functional correctness testing alone.
   **Why correct:** Directly extends the already-established prior-module finding into a concrete, monitored metric and alerting design.
   **Common mistakes:** Monitoring only functional correctness (the application still returns correct data) without a dedicated, alerted cache-hit-rate metric, missing a silent performance-benefit degradation entirely.
   **Follow-ups:** "What could cause a hit-rate degradation with no code change at all?" (A shift in the actual traffic pattern — increased request diversity/cardinality (Module 93 §2.3's cardinality concept, applied to cache keys) reducing the fraction of requests that hit an already-warm cache entry, purely due to changing usage patterns rather than any deployment.)

5. **Q: How do you handle cache consistency when using a cache-aside pattern with concurrent writes — the race condition between a database write and cache invalidation?**
   **A:** A classic race: Request A reads a stale value from the DB (about to be overwritten by a concurrent Request B), Request B writes the new value and invalidates the cache, then Request A's now-stale read populates the cache with the old value *after* the invalidation — leaving the cache permanently stale until the next write. Mitigate by invalidating the cache key immediately *before* the database write commits (or using a short TTL as a safety net bounding how long this race's damage persists), or by using a versioned cache-write (only accepting a cache-populate write if it matches the currently-expected data version, rejecting a stale write that arrives out of order).
   **Why correct:** States the precise race-condition sequence and two concrete mitigations (invalidate-before-write ordering, versioned writes) addressing it.
   **Common mistakes:** Assuming invalidating the cache immediately after a database write is sufficient, without recognizing a concurrent, in-flight read from before the write can still repopulate the cache with stale data afterward.
   **Follow-ups:** "Why doesn't a short TTL alone fully solve this race?" (It bounds the *duration* of staleness but doesn't prevent the race from occurring at all — for any window shorter than the TTL, incorrect, stale data is still served with no signal anything is wrong.)

6. **Q: Design a read-replica lag mitigation strategy for a system where stale reads are sometimes unacceptable (read-your-own-writes consistency).**
   **A:** Route a specific request back to the primary (or a replica confirmed to have caught up past the write's commit point) immediately following that same session's own write, for a bounded window — rather than requiring every read in the system to always hit the primary (defeating the replica's purpose) or accepting stale reads universally (violating read-your-own-writes for exactly the cases where it matters).
   **Why correct:** Proposes a targeted, session-scoped mitigation rather than an all-or-nothing approach.
   **Common mistakes:** Either routing all reads to the primary as a blanket fix (eliminating the replica's scaling benefit) or ignoring the consistency requirement for the specific, sensitive cases where it genuinely matters.
   **Follow-ups:** "How would you determine a replica has 'caught up past the write's commit point'?** (Track a monotonically-increasing log-sequence/commit-position marker from the write, and only route a read-your-own-write request to a replica confirmed to have replicated past that specific marker.)

7. **Q: How would you decide between denormalization/precomputed aggregates versus caching to solve a read-performance problem?**
   **A:** Denormalization is appropriate when the expensive computation's result needs to be durably queryable (survives a cache eviction/restart, participates in further relational queries/joins) and the write-side consistency maintenance is manageable; caching is appropriate when the result is derived, disposable, and acceptable to recompute from scratch after an eviction — the two aren't mutually exclusive and are often combined (a denormalized, precomputed value that's also cached for even faster repeated access).
   **Why correct:** States the specific criterion (durability/queryability need vs. disposability) distinguishing when each approach fits.
   **Common mistakes:** Treating denormalization and caching as competing, mutually-exclusive alternatives rather than recognizing they solve overlapping but distinct problems, often combined.
   **Follow-ups:** "What's a risk unique to denormalization that caching doesn't share?" (Denormalized data can silently drift out of sync with its source if the write-side update logic has a bug, persisting incorrect data durably — whereas a cache's staleness is bounded by TTL/invalidation and, worst case, resolved by simply evicting and recomputing.)

8. **Q: Design a rate-limited cache-refill strategy avoiding overwhelming the origin data store during a partial cache outage.**
   **A:** Apply a token-bucket or similar rate limiter specifically on the path from cache-miss to origin-fetch, bounding the maximum rate of origin requests regardless of how many concurrent cache misses are occurring — requests exceeding the limiter's capacity queue or receive a graceful degradation response (a slightly stale fallback, or an explicit "temporarily degraded" signal) rather than all flooding the origin simultaneously and risking a cascading overload of the very system the cache exists to protect.
   **Why correct:** Proposes a concrete rate-limiting mechanism specifically protecting the origin during exactly the failure scenario a cache's absence is most dangerous.
   **Common mistakes:** Assuming the origin can absorb the full, unbounded load of every cache miss simultaneously during a cache outage, without an explicit rate-limiting safeguard.
   **Follow-ups:** "What's the risk of not having this safeguard?" (A cache outage cascading into an origin-data-store outage as well, since the origin was never designed or provisioned to handle the cache's full, normally-absorbed request volume directly.)

9. **Q: How does compression interact with caching, and when is it counterproductive?**
   **A:** Compressing a cached value reduces its memory/network footprint (allowing more entries to fit in a fixed cache size, and faster network transfer) at the cost of CPU time to compress/decompress on every write/read — counterproductive when the cached value is small (compression overhead exceeds any size benefit) or when the cache is CPU-bound rather than memory/network-bound, in which case compression adds CPU cost without addressing the actual bottleneck.
   **Why correct:** States the trade-off precisely and identifies the specific conditions (small values, CPU-bound systems) where it backfires.
   **Common mistakes:** Applying compression uniformly to every cached value regardless of size or the system's actual bottleneck (memory/network vs. CPU).
   **Follow-ups:** "How would you decide whether compression is worthwhile for a specific cache?" (Measure the actual trade-off empirically — compare cache capacity/network-transfer improvement against the added CPU cost under realistic load, per this module's broader "measure, don't assume" principle.)

10. **Q: Critique "cache everything" as a default performance strategy.**
    **A:** Caching every piece of data uniformly ignores each data type's actual read/write ratio and staleness tolerance (Intermediate Q8) — caching frequently-changing data provides little benefit while adding invalidation-correctness risk, and caching data involved in security/authorization decisions without careful key-scoping risks Module 97-style cross-principal data leakage (Intermediate Q3). "Cache everything" also adds blanket architectural complexity (cache-key design, invalidation logic, monitoring) across the entire system rather than concentrating that complexity where it delivers genuine, measured benefit.
    **Why correct:** Identifies multiple, specific, already-established risks a blanket caching strategy ignores rather than a vague "it's not always good" statement.
    **Common mistakes:** Treating caching as a universally beneficial default to apply everywhere, rather than a deliberate, risk-proportionate decision made per data type based on its actual access pattern and sensitivity.
    **Follow-ups:** "How would you communicate this critique to a team proposing to cache an entire database's worth of entities uniformly?" (Present the specific, concrete risks — invalidation-correctness burden for frequently-changing data, and cross-principal leakage risk for authorization-sensitive data — rather than an abstract "that seems like too much caching" objection.)

### Expert (10)

1. **Q: Design a caching architecture for a system with strict data-freshness/regulatory requirements (e.g., financial pricing data) that also needs high throughput.**
   **A:** Use a very short TTL or, preferably, event-driven invalidation triggered directly by the pricing-update event itself (never a TTL alone for regulatory-critical freshness), combined with a versioned cache-read protocol where the client can specify the minimum acceptable data version/timestamp, allowing the system to explicitly reject (rather than silently serve) a cached value older than the caller's stated freshness requirement — achieving high throughput for the common case (recent, valid cached data) while providing an explicit, auditable mechanism refusing to silently serve unacceptably stale data for regulatory-sensitive reads.
   **Why correct:** Proposes event-driven invalidation over TTL-only for regulatory freshness, plus an explicit, auditable staleness-rejection mechanism rather than silent best-effort caching.
   **Common mistakes:** Relying on a very short TTL alone as "good enough" for regulatory freshness requirements, without an explicit mechanism to reject serving a cached value that happens to still be technically within TTL but insufficiently fresh for a specific, sensitive use case.
   **Follow-ups:** "Why is an explicit, auditable rejection mechanism specifically important for regulatory contexts?" (It provides a demonstrable, provable guarantee (rather than a probabilistic, TTL-based approximation) that stale data was never silently served for a use case with an explicit freshness requirement — directly relevant to compliance audit evidence, Module 100's governance theme.)

2. **Q: How would you approach cache invalidation in an event-driven architecture using domain events?**
   **A:** Subscribe the caching layer to the same domain events (published via the outbox pattern, Module 37, ensuring reliable delivery) that represent an entity's state change, triggering targeted invalidation of every cache entry tagged with that entity's ID (Advanced Q1's dependency-tag registry) — directly reusing the event-driven architecture's own reliable-delivery guarantee as the invalidation-triggering mechanism, rather than building a separate, ad hoc invalidation-detection mechanism disconnected from the system's actual event stream.
   **Why correct:** Connects cache invalidation directly to an already-established, reliable event-delivery mechanism (the outbox pattern) rather than inventing a parallel mechanism.
   **Common mistakes:** Building a separate, polling-based or ad hoc cache-invalidation detection mechanism when the system already has a reliable, event-driven change-notification stream that could trigger invalidation directly and more efficiently.
   **Follow-ups:** "What's the risk if the cache-invalidation subscriber falls behind or fails to process events?" (The cache silently serves increasingly stale data with no functional error — directly this course's recurring silent-degradation risk, requiring the subscriber's own processing lag/health to be independently monitored, not assumed healthy.)

3. **Q: Critique relying on TTL-only invalidation for a system with unpredictable underlying-data change frequency.**
   **A:** A fixed TTL implicitly assumes a roughly-known, stable change frequency to calibrate against — when underlying data change frequency is genuinely unpredictable (bursty, event-driven, or highly variable across different entities), any single, fixed TTL either serves unacceptably stale data during an unusually rapid-change period or unnecessarily sacrifices cache-hit benefit during a stable, rarely-changing period, since the TTL can't adapt to actual, real-time change behavior. Event-driven invalidation (Expert Q2) sidesteps this entirely by invalidating exactly when a change genuinely occurs, regardless of frequency variability.
   **Why correct:** States the specific reason TTL-only invalidation struggles under variable change frequency, and identifies the structurally superior alternative already established.
   **Common mistakes:** Assuming a sufficiently short, "safe" TTL adequately handles any change-frequency variability, without recognizing this either sacrifices cache benefit unnecessarily during stable periods or still risks unacceptable staleness during an unusually rapid-change burst that even a short TTL doesn't fully bound.
   **Follow-ups:** "Under what circumstance is TTL-only invalidation still a reasonable, pragmatic choice despite this critique?" (When event-driven invalidation's engineering cost/complexity genuinely isn't justified by the data's actual staleness sensitivity — a pragmatic, risk-proportionate trade-off, not a universal recommendation against TTL ever being used.)

4. **Q: How would you design a caching layer's own capacity planning and load testing, applying Modules 101/102 specifically to caching?**
   **A:** Load-test the caching layer itself at realistic concurrency and key-cardinality (distinct-key count, not merely request volume — a high-cardinality workload with low hit rate stresses the cache very differently than a low-cardinality, high-hit-rate one), specifically measuring cache-server CPU/memory/network saturation points and the resulting cliff pattern (Module 101 Advanced Q8) — treating the cache as its own system requiring the identical measure-don't-assume discipline this course has established for every other component, rather than assuming a cache is inherently, infinitely scalable simply because it's "just a cache."
   **Why correct:** Directly applies the already-established profiling/load-testing discipline to the caching layer specifically, naming the specific dimension (key cardinality, not just request volume) unique to cache-load characterization.
   **Common mistakes:** Assuming a caching layer is inherently lightweight and doesn't require the same rigorous load-testing/capacity-planning discipline applied to the primary data store or application tier.
   **Follow-ups:** "Why does key cardinality matter as much as raw request volume for cache capacity planning?" (A high-cardinality workload (many distinct keys, low repeat rate) provides little caching benefit and stresses cache memory/eviction machinery very differently than a low-cardinality, highly-repeated-key workload — the same request volume can produce very different cache-layer load characteristics depending on key diversity.)

5. **Q: Design a strategy for cache warming after a deployment/restart to avoid a cold-cache stampede in production, extending Advanced Q2.**
   **A:** Before routing live production traffic to a newly-restarted cache instance/cluster, proactively populate it with the most valuable, highest-traffic keys (identified from recent access-frequency data) via a dedicated warming job — using either a replayed sample of recent real traffic or a direct, targeted pre-fetch of known-hot keys — and gate the restart's traffic cutover on the warming job's completion (or a partial, monitored threshold of warm-cache coverage), rather than exposing production traffic to an empty cache immediately upon restart.
   **Why correct:** Proposes a concrete, gated warming process tied to a measurable completion signal, directly avoiding Advanced Q2's cold-cache-stampede risk structurally.
   **Common mistakes:** Restarting a cache cluster and immediately routing full production traffic to it, relying purely on Intermediate Q1's per-key stampede protection to absorb the resulting, much larger-scale, entirely-cold-cache miss storm.
   **Follow-ups:** "How would you determine which keys are 'most valuable' to pre-warm, without unbounded time to warm every possible key?" (Rank by recent access frequency/recency from before the restart — directly Module 101's profiling discipline, applied to identifying the cache's own actual hot working set.)

6. **Q: How does the CAP theorem inform trade-offs in distributed cache design (e.g., Redis Cluster's consistency model)?**
   **A:** Under a network partition, a distributed cache must choose between remaining available (continuing to serve reads/writes on both sides of the partition, risking divergent, inconsistent data) or remaining strictly consistent (refusing to serve on the minority/unreachable side, sacrificing availability) — most distributed caches, including Redis Cluster's default configuration, favor availability with eventual consistency, accepting a brief window of potential inconsistency in exchange for continued service during a partition, a deliberate design choice aligned with caching's inherently approximate, staleness-tolerant nature rather than a strict source-of-truth requirement.
   **Why correct:** Correctly applies CAP's partition-tolerance trade-off specifically to distributed caching's typical, deliberate availability-favoring design choice.
   **Common mistakes:** Assuming a distributed cache provides the same strong-consistency guarantee a primary, authoritative data store would, without recognizing caching's typical, deliberate trade-off toward availability under partition.
   **Follow-ups:** "Why is favoring availability over strict consistency usually the right default specifically for a cache, as opposed to a system of record?" (A cache is, by definition, a derived, disposable copy of a true source of truth — briefly serving stale or inconsistent cached data is a bounded, recoverable risk, unlike a system of record where the same inconsistency could represent genuine, unrecoverable data loss or corruption.)

7. **Q: How would you diagnose a "split-brain" cache-consistency bug where different application instances see different cached values for the same key?**
   **A:** Check whether the cache infrastructure itself is genuinely partitioned or misconfigured (different application instances connecting to different, unsynchronized cache nodes/clusters due to a routing or configuration error) versus a legitimate, bounded eventual-consistency propagation delay (Intermediate Q4) that will self-resolve shortly — the diagnostic distinction is whether the divergence persists indefinitely (a genuine partition/misconfiguration) or resolves within the expected, bounded propagation window (normal, tolerable eventual consistency behavior).
   **Why correct:** States the specific diagnostic distinction (persistent divergence vs. bounded, self-resolving delay) and what each implies about root cause.
   **Common mistakes:** Assuming any observed inconsistency between instances is automatically a genuine bug, without first checking whether it falls within the cache's normal, expected eventual-consistency propagation window.
   **Follow-ups:** "What configuration error commonly causes a genuine, persistent split-brain in a distributed cache deployment?" (Different application instances or deployment groups pointing at different cache cluster endpoints/shards due to a configuration drift or a rollout that only partially updated the cache-connection configuration across the fleet — directly Module 96's golden-path-drift risk recurring for cache-endpoint configuration specifically.)

8. **Q: What is the architectural cost of introducing caching (increased complexity), and how do you decide it's worth it?**
   **A:** Caching adds genuine, ongoing complexity: invalidation logic that must stay correct as the underlying data model evolves, additional infrastructure to operate and monitor, and a whole new category of "correct but stale" bugs distinct from ordinary functional bugs — worth it only when the measured performance benefit (via actual profiling/load-testing, not assumption) exceeds this ongoing complexity cost, and when the specific data's staleness tolerance and read/write ratio (Intermediate Q8) genuinely justify it.
   **Why correct:** Names the specific, ongoing complexity costs (invalidation correctness, new bug category, operational overhead) and ties the decision back to this module's established, measured-benefit criteria.
   **Common mistakes:** Treating caching as an unconditionally worthwhile addition without weighing its genuine, ongoing complexity and correctness-maintenance cost against the actual, measured performance benefit it provides.
   **Follow-ups:** "What's a sign that a caching layer's complexity cost has exceeded its actual benefit?" (A pattern of recurring, hard-to-diagnose staleness bugs, or a measured hit rate low enough that the caching layer's operational and correctness overhead isn't justified by its actual, delivered performance improvement.)

9. **Q: How would you design monitoring/alerting for cache health, directly extending Module 94's alert-liveness discipline to cache-hit-rate specifically?**
   **A:** Monitor cache hit rate, eviction rate, and cache-server resource saturation continuously, with a multi-window burn-rate-style alert (Module 94 §2.4) on hit-rate degradation specifically — a short-window, sharp drop triggering a fast-response alert (a likely code/configuration regression), and a longer-window, gradual decline triggering a lower-urgency investigation (a likely traffic-pattern or data-cardinality shift) — plus a periodic, scheduled liveness canary confirming the cache-invalidation pipeline itself (Expert Q2's event subscriber) is actively processing events and not silently stalled.
   **Why correct:** Directly and explicitly reapplies Module 94's multi-window alerting design and liveness-canary pattern to cache-specific health metrics.
   **Common mistakes:** Monitoring only a single, static hit-rate threshold with no multi-window design, risking either excessive false alerts from normal noise or slow detection of a genuine, sharp regression.
   **Follow-ups:** "Why does the invalidation pipeline itself need its own separate liveness canary, distinct from the hit-rate metric?" (A stalled invalidation pipeline could, paradoxically, show a *high* hit rate — since stale data is technically still "hits" — meaning hit-rate monitoring alone wouldn't reveal a stopped-invalidation bug; a distinct, dedicated liveness check specifically confirming invalidation events are actively being processed is required to catch this different failure mode.)

10. **Q: Deliver a capstone-style synthesis connecting caching and data-access performance to this course's recurring "declared ≠ actual" theme.**
    **A:** A cache "working correctly" is at least three independent, separately-verifiable claims: it returns functionally correct data (testable via ordinary functional tests), it provides genuine performance benefit (only verifiable via a monitored hit-rate metric, since a near-zero-hit-rate cache can still return entirely correct data), and its invalidation pipeline is actively, currently functioning (only verifiable via a dedicated liveness canary, since a stalled invalidation pipeline can silently coexist with an apparently-healthy hit-rate metric). Exactly as this course has traced across telemetry coverage, alerting, runbooks, and security tooling, a cache's own health is a multi-layered claim, and confirming one layer provides zero evidence about the others.
    **Why correct:** Precisely decomposes "the cache is working" into three independently-necessary, separately-verified claims, directly mirroring this course's now-comprehensively-established recursive verification theme.
    **Common mistakes:** Treating "the cache returns correct data" as sufficient evidence the caching layer is working as intended, without separately verifying its actual performance benefit and its invalidation pipeline's continued liveness.
    **Follow-ups:** "Why is this three-layer decomposition specifically valuable for a candidate to state proactively in an interview about caching?" (It demonstrates the ability to apply this course's central, recurring verification discipline to a concrete, specific technical area unprompted, rather than only describing caching's mechanics in isolation — precisely the kind of cross-cutting synthesis distinguishing senior-level engineering judgment.)
