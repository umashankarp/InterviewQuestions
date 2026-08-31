# Module 37 — System Design: Fundamentals, Scalability Building Blocks & Load Balancing

> Domain: System Design | Level: Beginner → Expert | Prerequisite: Nearly the entire course — this module is where C#/.NET internals (Modules 1-14), data-layer engines (Modules 18-28), and CS fundamentals (Modules 29-36) get synthesized into architecture-level decisions. Cross-references throughout are extensive and deliberate.

---

## 1. Fundamentals

### What is system design, and why is it evaluated differently from coding interviews?
System design is the practice of architecting a software system to meet a set of **functional requirements** (what it must do) and **non-functional requirements** (how well it must do it — latency, availability, consistency, cost, scale) under real-world constraints (budget, team size, time-to-market). It's evaluated differently from coding interviews specifically because there is **no single correct answer** — every design is a negotiated set of trade-offs, and what's being evaluated is the **quality of the trade-off reasoning**, not whether a candidate arrives at "the" solution.

### Why does this matter?
Because most real system-design failures aren't caused by not knowing a specific technology — they're caused by **skipping the requirements-gathering step** and designing for assumed, unstated requirements that turn out to be wrong (over-engineering for a scale that will never materialize, or under-engineering for a consistency/availability need that was never explicitly discussed) — precisely why this module treats requirements-gathering as foundational, not a formality to rush through before "the real design work."

### When does this matter?
Every System Design interview and every real architecture decision of consequence; the depth matters because a Staff/Principal-level interview specifically probes whether a candidate can **drive** the requirements conversation (asking the right clarifying questions unprompted) rather than waiting to be told constraints, and whether they can justify **why** a specific building block (a load balancer, a cache, a queue) is needed for *this* system's actual requirements, not recite it as a checklist item.

### How does it work (30,000-ft view)?
```
1. Clarify functional requirements (what must the system do)
2. Clarify non-functional requirements (scale, latency, availability, consistency)
3. Estimate capacity (back-of-envelope: QPS, storage, bandwidth)
4. High-level architecture (draw boxes: clients, load balancer, services, data stores, caches, queues)
5. Deep-dive on 1-2 components the interviewer signals interest in
6. Identify bottlenecks and failure modes; discuss trade-offs explicitly
```

---

## 2. Deep Dive

### 2.1 Requirements Gathering — the Single Highest-Leverage Skill in This Entire Domain
Functional requirements (e.g., "users can post updates, follow other users, see a feed") are usually straightforward to elicit. **Non-functional requirements** are where most candidates under-invest, and where most real production incidents actually originate (this course's entire incident log — the cascading restart, the captive-dependency leak, the blocking-chain incident — traces back to an *unstated or unexamined* non-functional requirement): **Scale** (how many users, requests/sec, data volume — order of magnitude matters far more than precision), **Latency** (p50/p99 targets, and for *which* operations — read latency and write latency frequently have very different tolerances), **Availability** (99.9% vs 99.99% — each additional "nine" costs meaningfully more engineering effort and money), **Consistency** (can reads be eventually consistent,/24/26's recurring theme, or must they be strongly consistent), and **Read/write ratio** (a read-heavy system and a write-heavy system have almost entirely different optimal architectures — caching helps enormously for the former, barely at all for the latter).

### 2.2 Back-of-the-Envelope Capacity Estimation — Precisely Why It Matters
Estimating QPS (queries per second), storage growth, and bandwidth **before** designing components is what prevents both over-engineering (designing a globally-sharded, multi-region system for a workload that fits comfortably on a single well-tuned database server plus the query-optimization toolkit from the SQL Server/PostgreSQL modules) and under-engineering (missing that a seemingly-modest per-user data volume, multiplied by an actual target user count, produces a storage/throughput requirement that changes the entire architecture). The specific numbers matter less than the **order of magnitude** and the discipline of actually doing the estimation rather than designing on vibes — a system designed for 100 req/s and one designed for 100,000 req/s are different systems, and skipping this estimation step is how a candidate ends up defending an architecture mismatched to the actual (or assumed) scale.

### 2.3 Load Balancing — Algorithms and the Layer at Which They Operate
A load balancer distributes incoming requests across multiple backend replicas — the mechanism directly enabling the horizontal scaling this entire course has referenced repeatedly (the stateless-replica theme, the graceful-shutdown/readiness-probe-driven traffic routing). **Layer 4** (transport-layer, TCP/UDP) load balancing is faster (no request-content inspection) but coarser (routes based on IP/port only); **Layer 7** (application-layer, HTTP) load balancing can route based on request content (URL path, headers — enabling API-gateway-style routing, the rate-limiting/auth-scheme-scoping concerns) at the cost of more per-request processing overhead. **Algorithms**: round-robin (simple, ignores backend load), least-connections (routes to the currently-least-busy backend, better under uneven request durations), and consistent hashing (routes based on a hash of the request key, critical for cache-affinity and the exact same hash-slot/shard-key reasoning from Modules 23/25/27 — ensuring the same client/key consistently reaches the same backend, enabling effective per-backend caching).

### 2.4 Caching Strategies — Cache-Aside, Write-Through, Write-Behind
**Cache-aside** (lazy loading): application checks the cache first, falls back to the database on a miss, populating the cache afterward — the most common pattern, and the one the Redis module's stampede-resistant caching implementation builds on. **Write-through**: writes go to the cache and the database synchronously together — keeps the cache always consistent with the database, at the cost of added write latency. **Write-behind** (write-back): writes go to the cache immediately, asynchronously flushed to the database later — lowest write latency, but risks data loss if the cache fails before flushing (directly the same durability-vs-latency trade-off as MongoDB's write-concern discussion, now at the caching layer). Cache invalidation strategy (TTL-based, event-driven via a message queue, or explicit invalidation on write) must be chosen deliberately — "cache invalidation is one of the two hard problems in computer science" is a cliché precisely because getting it wrong (serving stale data indefinitely, or thrashing the cache with unnecessary invalidations) is a common, real failure mode.

### 2.5 CAP Theorem — the Foundational Trade-off Underlying Every Distributed Data Decision in This Course
The CAP theorem states a distributed system can provide at most **two of three** guarantees simultaneously during a network partition: **Consistency** (every read receives the most recent write), **Availability** (every request receives a non-error response), **Partition tolerance** (the system continues operating despite network partitions between nodes). Since partitions are an unavoidable reality in any real distributed system (partition tolerance isn't optional), the actual practical choice is **CP vs AP** during a partition — this is precisely the theoretical foundation underlying every consistency-model discussion across this course's data-layer modules: PostgreSQL's synchronous replication (CP-leaning), MongoDB's write concern (tunable per-operation), DynamoDB's eventual-vs-strong-consistency reads (explicitly exposing the CAP trade-off as a per-request parameter) — recognizing that all of these earlier, engine-specific discussions are **instances of the same underlying CAP trade-off** is exactly the kind of cross-module synthesis a Staff/Principal system-design interview rewards.

## 3. Visual Architecture

### Generic Scalable Web Application Architecture
```mermaid
graph TB
 Client[Clients] --> DNS[DNS / GeoDNS]
 DNS --> CDN[CDN -- static assets, cached responses]
 CDN --> LB["Load Balancer (L7)"]
 LB --> App1[App Server Replica 1]
 LB --> App2[App Server Replica 2]
 LB --> App3[App Server Replica N]
 App1 --> Cache["Distributed Cache (Redis)"]
 App1 --> Queue["Message Queue (async work)"]
 App1 --> Primary[("Primary DB (writes)")]
 Primary -.->|async replication| Replica1[("Read Replica 1")]
 Primary -.->|async replication| Replica2[("Read Replica 2")]
 App2 --> Replica1
 Queue --> Worker[Background Worker Fleet]
 Worker --> Primary
```

### CAP Theorem Trade-off Space
```
 Consistency
 /\
 / \
 / \
 / CP \ <- SQL Server RCSI-off, synchronous PostgreSQL replication,
 / zone \ MongoDB w:"majority" reads -- correctness over availability
 /----------\ during a partition
 / \
 / AP zone \ <- DynamoDB eventually-consistent reads, MongoDB w:1,
 / \ async replication defaults -- availability over strict
 Availability -------- Partition consistency during a partition
 Tolerance
 (not optional in a real distributed system)
```

## 4. Production Example
**Scenario**: A team designing a new social-feed feature skipped explicit non-functional-requirements discussion, defaulting to "we'll use strongly-consistent reads everywhere, like our existing order-processing system" (reusing an architectural pattern from a genuinely different, consistency-critical domain) — the feed feature launched with every feed-read going through the primary database with strong consistency, and under real user load (a much higher read volume than the order-processing system's, since every user loads their feed on every app open) the primary database became a severe bottleneck, with read latency degrading the entire platform including unrelated, genuinely consistency-critical order-processing traffic sharing the same database. **Investigation**: a post-incident architecture review revealed the feed feature's actual requirement was **never explicitly discussed** — feed content being a few seconds stale is entirely acceptable (a classic AP-leaning, eventually-consistent use case) — the strong-consistency choice was an unexamined default carried over from a different feature's genuinely different requirement, not a deliberate decision for this specific feature. **Fix**: redesigned the feed-read path to use read replicas (the eventual-consistency read-scaling pattern from the relational-database modules) with a short-TTL cache layer (cache-aside), reserving strong consistency exclusively for the order-processing paths that actually need it — read latency and database load both improved dramatically, and the unrelated order-processing traffic's performance stabilized once no longer contending with the feed feature's disproportionate read volume on the same primary database. **Lesson**: the single most common, most costly system-design mistake is skipping explicit non-functional-requirements discussion and defaulting to a pattern borrowed from a different feature's different actual requirements — this is precisely why requirements-gathering is this module's leading, not trailing, concern, and why a Staff/Principal-level system-design interview specifically rewards a candidate who proactively asks "does this specific read path need strong consistency, or is eventual consistency acceptable here" rather than applying one consistency model uniformly across an entire system by default.
## 10. Interview Questions

### Basic (10)
1. **Q: What's the difference between functional and non-functional requirements?** **A:** Functional requirements describe what the system must do; non-functional requirements describe how well it must do it (scale, latency, availability, consistency).
2. **Q: Why is back-of-envelope capacity estimation important before designing?** **A:** It ensures the architecture matches the actual order-of-magnitude scale needed, preventing both over-engineering and under-engineering.
3. **Q: What's the difference between Layer 4 and Layer 7 load balancing?** **A:** Layer 4 routes based on IP/port (transport layer, faster, coarser); Layer 7 routes based on request content (application layer, e.g., HTTP path/headers, more flexible but more overhead).
4. **Q: What is cache-aside?** **A:** The application checks the cache first, falls back to the database on a miss, and populates the cache afterward.
5. **Q: What are the three guarantees in the CAP theorem?** **A:** Consistency, Availability, Partition tolerance — a distributed system can provide at most two during a network partition.
6. **Q: Why is partition tolerance not really "optional" in CAP theorem trade-off discussions?** **A:** Network partitions are an unavoidable reality in any real distributed system, so the practical choice is actually between consistency and availability during a partition.
7. **Q: What's the difference between write-through and write-behind caching?** **A:** Write-through writes to cache and database synchronously (consistent, higher latency); write-behind writes to cache immediately and flushes to the database asynchronously (lower latency, risk of data loss).
8. **Q: What is consistent hashing used for in load balancing?** **A:** Routing requests based on a hash of a key so the same client/key consistently reaches the same backend, enabling cache affinity.
9. **Q: What's the first, cheapest lever on the "database scaling ladder"?** **A:** Vertical scaling and query/index optimization, before read replicas, caching, or sharding.
10. **Q: Why should a system-design answer avoid applying one uniform consistency model across an entire system?** **A:** Different data types/access patterns have genuinely different consistency requirements (a social feed vs. a financial transaction) — a uniform default is usually wrong for at least some part of the system.

### Intermediate (10)
1. **Q: Why does a Staff/Principal-level interview specifically reward proactively asking clarifying questions about non-functional requirements, rather than waiting to be told?** **A:** It demonstrates the candidate recognizes that most real design failures stem from unstated/unexamined requirements, and that driving this conversation is itself a core system-design skill, not a formality.
2. **Q: Why can a p50 latency metric look excellent while p99 tells a very different story for a cache-aside-based system?** **A:** Cache-aside produces a bimodal latency distribution — p50 is dominated by fast cache hits, while p99 is dominated by slow cache misses (full database round-trips), especially under a cold cache — averaging or looking only at p50 hides this.
3. **Q: Why does routing reads to replicas require a plan for "read-your-writes" paths specifically?** **A:** Asynchronous replication means a replica can briefly lag behind the primary — a read immediately following a write on that same replica might not yet reflect it, requiring either routing that specific read to the primary or using a consistency mechanism that accounts for the lag (the exact concern, here at the read-replica architecture level).
4. **Q: Why is sharding described as "the hardest-to-reverse" scaling lever, and why should it be a later, not first, resort?** **A:** Changing a shard key after data is distributed requires substantial data migration/redistribution (the recurring warning from the partitioning modules); the earlier, cheaper levers (vertical scaling, read replicas, caching) should be exhausted first since they're far less operationally risky and disruptive to reverse or adjust.
5. **Q: Why does statelessness matter for horizontal scaling specifically?** **A:** A stateless application server can have any request routed to it by a load balancer without correctness risk; a server holding request-affinity state (in-process session data) constrains routing (requiring sticky sessions) and complicates adding/removing replicas safely.
6. **Q: Why is cross-region replication fundamentally asynchronous, not a configuration choice?** **A:** The speed of light imposes a hard physical latency floor on any synchronous round-trip between distant regions — waiting for synchronous cross-region acknowledgment on every write would make write latency unacceptably high for most workloads, making asynchronous (eventually consistent) cross-region replication the practical default.
7. **Q: Why should rate limiting be considered part of the system's architecture, not just an API implementation detail?** **A:** Placing rate limiting at the load balancer/API-gateway layer lets abusive/excessive traffic be rejected before it ever reaches application servers, directly protecting downstream capacity — treating it as a deep implementation detail misses this "reject cheaply, as early as possible" architectural opportunity.
8. **Q: Why does auto-scaling's effectiveness depend on application startup time?** **A:** If new replicas take a long time to become ready (JIT warm-up, connection-pool establishment,/14's discussions), auto-scaling reacts too slowly to actually absorb a sudden load spike, potentially causing throttling/degradation during the gap between scale-out triggering and new capacity actually becoming available.
9. **Q: Why is a CDN considered both a latency and a load-reduction mechanism simultaneously?** **A:** Serving a cached response from a geographically-close edge node both reduces the physical-distance latency to the client and means the origin server never even receives that request, reducing its load — a rare case where one mechanism directly improves two different non-functional properties at once.
10. **Q: Why might a system-design candidate's answer be considered incomplete even if the high-level architecture diagram is correct?** **A:** If they haven't explicitly addressed non-functional trade-offs (consistency choice per data type, latency budget allocation across components, failure-mode handling) the diagram alone doesn't demonstrate the actual trade-off reasoning being evaluated — the diagram is necessary but not sufficient.

### Advanced (10)
1. **Q: Diagnose the feed-feature production incident from first principles, and design the requirements-gathering practice that would have caught it before implementation.**
 **A:** Root cause: an unexamined default (strong consistency, borrowed from an unrelated feature's genuinely different requirement) applied without ever explicitly asking "what consistency/staleness tolerance does *this specific* feature actually need." Safeguard: mandate an explicit, per-major-data-type consistency requirement discussion as a standing section of any new feature's design document (directly this course's recurring shared-template governance pattern) — requiring the design to state, for each significant read/write path, whether strong or eventual consistency is acceptable and *why*, making an unexamined default structurally visible (an empty/unjustified answer in this section is itself a red flag) rather than silently absent from the design entirely.
2. **Q: Design a latency budget for a request with a 200ms p99 target, touching a load balancer, an authentication check, a cache lookup, and (on a cache miss) a database query — allocate specific budgets and justify them.**
 **A:** Load balancer overhead: ~2ms (network-layer routing, minimal processing); authentication check: ~10ms (a cached/fast claims check, per the lesson about NOT putting an uncached database call here); cache lookup: ~5ms (Redis is typically sub-millisecond, budgeted generously here); remaining ~183ms budgeted for the cache-miss database path (the query-optimization target from the SQL Server modules) — explicitly reserving the *majority* of the budget for the slowest, least-predictable component (the database) rather than distributing evenly, since database query time is both the largest and most variable component; this budget should be **validated under load** (not just calculated on paper) via the load-testing discipline this course has repeatedly emphasized (§Advanced Q7).
3. **Q: Explain how you would design a system-wide security review checklist mapped explicitly to an architecture diagram's layers, generalizing the "defense in depth per layer" guidance into an actionable review process.**
 **A:** For each layer in the architecture diagram (edge/CDN, load balancer, application servers, cache, database, message queue), require an explicit, documented answer to: what authentication/authorization applies here (if any), is traffic encrypted at this hop, what rate-limiting/abuse-prevention exists here, and what happens if this specific component is compromised (blast-radius analysis) — converting "we have security" into a per-component, mechanically-checkable set of answers, directly the same "walk through every layer explicitly" discipline this course has applied to middleware pipelines, DI lifetimes, and now full system architectures.
4. **Q: Design a multi-region architecture for a global e-commerce platform, addressing the CAP-theorem trade-off explicitly for both the product catalog (read-heavy, rarely-changing) and the shopping cart (read-write, session-scoped).**
 **A:** Product catalog: replicate to every region (AP-leaning, eventual consistency acceptable — a product's price/description being a few seconds stale across regions is a negligible risk), served from regional read replicas/CDN-cached responses for minimal latency; shopping cart: since it's inherently session-scoped to one user's current activity, route a given user's cart operations consistently to their **home region** (via consistent-hashing-style regional affinity) rather than attempting cross-region strong consistency for it at all — sidestepping the CAP trade-off for this specific data type by ensuring it's never actually accessed from multiple regions simultaneously for the same user, rather than trying to solve cross-region strong consistency for a use case that doesn't structurally require it.
5. **Q: Explain why a system-design candidate proposing "just add a cache" as a universal fix for a slow-database-read problem might be giving an incomplete answer, and what additional analysis you'd expect.**
 **A:** Caching helps specifically for **repeated reads of the same, relatively-stable data** — if the actual read pattern is highly unique/rarely-repeated queries (poor cache-hit-rate potential, directly §Advanced Q9's DAX-cache-hit-rate-analysis concern), adding a cache provides little benefit while adding real operational complexity (cache invalidation, the eviction-policy design) — a complete answer should address *why* caching would actually help for this specific access pattern (citing an expected cache-hit rate, even approximately) rather than proposing it as a reflexive, universal database-performance fix.
6. **Q: How would you design the failure-handling/graceful-degradation strategy for a system where the cache layer becomes unavailable, generalizing/28's DAX-fallback pattern to the system-design level?**
 **A:** The application layer must explicitly catch cache-connectivity failures and fall back to querying the database directly (at higher latency, but functional) rather than treating the cache as an unconditional, single-point-of-failure dependency — but this fallback path itself needs capacity planning: if the cache normally absorbs 90% of read traffic, a cache outage means the database suddenly receives 10x its normal load, potentially causing a **cascading failure** (the database, unprepared for this load, degrades or fails too) — a complete answer addresses both the fallback mechanism *and* whether the database has (or needs) enough headroom/its own protective rate-limiting to survive a full cache-bypass scenario without collapsing.
7. **Q: Design a strategy for validating a proposed system architecture's capacity estimates against reality once the system is actually built and receiving production traffic, rather than treating the initial back-of-envelope numbers as fixed.**
 **A:** Instrument the system from day one with the same metrics the capacity estimation was based on (actual QPS, actual data-growth rate, actual read/write ratio) and establish a standing review comparing actual production numbers against the original design-time estimates at regular intervals — a significant, sustained divergence (actual QPS 10x the original estimate, or a read/write ratio that inverted from what was assumed) is a concrete, actionable signal that the architecture may need to move to the next rung of the scaling ladder sooner than originally planned, converting capacity planning into an ongoing, data-driven practice rather than a one-time, design-phase estimate treated as permanently valid.
8. **Q: Explain how you would reason about whether a proposed system genuinely needs strong consistency for its core transactional writes, versus whether eventual consistency with a compensating mechanism (a later Saga-pattern module) would suffice.**
 **A:** Ask whether the business can tolerate a **temporarily inconsistent intermediate state that is later corrected** (e.g., an order briefly showing as "processing" across two systems before eventual consistency catches up, with a compensating action if something fails partway) versus requiring an **atomic, all-or-nothing guarantee with no observable intermediate state ever** (a bank transfer where partial completion is never acceptable, even momentarily) — the former can genuinely be built on eventual consistency plus compensation (trading some complexity for better availability/scalability); the latter genuinely needs strong consistency (a database transaction,/24's ACID guarantees) — this is the same "is this a genuine hard requirement, or an assumed default" analysis (/Advanced Q1) applied specifically to the strong-vs-eventual-consistency decision for a transactional workflow.
9. **Q: A team proposes designing every new service with global, multi-region, active-active deployment "for maximum availability and to future-proof against growth," regardless of the specific service's actual current requirements. Evaluate this as a Principal Engineer.**
 **A:** Push back on blanket, unexamined application of the most complex, most expensive architecture pattern available — active-active multi-region deployment introduces substantial complexity (conflict resolution for concurrent writes across regions, cross-region data-consistency trade-offs, meaningfully higher infrastructure cost) that's only justified for services with a **demonstrated, current** need for that level of availability/geographic distribution; recommend the same "climb the scaling ladder progressively, driven by actual demonstrated need" discipline applied here — most new services should start simpler (single-region, well-architected for their actual current scale) and evolve toward multi-region specifically when growth *actually* demands it, not preemptively "future-proofing" against growth that may never materialize, exactly this course's recurring "don't design for hypothetical future requirements" principle (stated in this course's very first guidance) now applied at the full-system-architecture scale.
10. **Q: As a Principal Engineer, how would you teach a team to conduct requirements-gathering rigorously for system design, given how easy it is to skip or rush given interview/deadline time pressure?**
 **A:** Provide a standing, concrete checklist (this course's recurring shared-template governance pattern) of the specific non-functional dimensions that must be explicitly addressed for any new system/feature (scale, latency per operation type, availability target, consistency per data type, read/write ratio) — framed not as a bureaucratic formality but as **directly preventing the exact class of incident this module's demonstrates** (an unexamined default causing a real, costly production problem) — and pair this with training that explicitly walks through as a case study, since a concrete, memorable incident ("we skipped this exact step and it cost us X") is far more effective at building genuine behavioral change than an abstract "always gather requirements" instruction alone, directly the same pedagogical principle this course has applied throughout (pairing every principle with both a production incident demonstrating its violation and a concrete fix).

### Expert (10)
1. **Q: A payments platform's design review states "we use eventual consistency for the ledger because it improves availability." Evaluate this as a Principal Engineer sitting on the review.**
 **A:** Reject the framing outright before discussing mechanics. A ledger's defining property is that every debit has a matching credit and the running balance is never observably wrong — that's a correctness invariant, not a staleness tolerance, and CAP's "eventual consistency" trade is about *how long a stale read can be tolerated*, not about whether the write itself can be lost, reordered, or double-applied. The reviewer should ask the concrete question the statement dodges: "if two concurrent debits both read the same starting balance and both commit, what prevents the account going negative?" — if the answer is "eventual consistency resolves it," that's wrong; eventual consistency describes read staleness, not write-write conflict resolution. A ledger needs CP writes (a transactional primary, or an appropriately fenced distributed-transaction pattern) even if downstream *read* views (a dashboard showing "recent transactions") can legitimately be eventually consistent — the same "consistency per data type/operation, not per system" discipline (§9.4), but the reviewer's job here is to catch a case where that discipline is being invoked to justify something it doesn't actually permit.
2. **Q: Design the specific mechanism by which a system proves — to an auditor, not just to itself — that its stated availability SLO (99.95%) was actually met over the last quarter, rather than merely asserting it.**
 **A:** Availability must be measured from the client's vantage point, not the server's — a server reporting 100% uptime while its load balancer's health checks were failing, or while a specific region was unreachable due to a DNS/network issue upstream of the server, is not evidence of client-observed availability. The mechanism: synthetic external probes (from multiple independent network vantage points, not from inside the same cloud provider/region) hitting the actual public endpoint at a fixed interval, logging success/failure and latency, with the SLO computed from that external, tamper-resistant log — plus an explicit, pre-agreed definition of what counts as a "failure" (a 5xx response? a timeout past what threshold? a degraded-but-200 response?) since ambiguity here is exactly where a post-hoc SLO dispute happens. An auditor accepts this because the measurement is independent of the system being measured — a server self-reporting its own uptime is grading its own exam.
3. **Q: A team proposes a single, shared Redis cluster serving both a latency-critical, low-volume payment-authorization cache and a high-volume, latency-tolerant content-feed cache, to "save infrastructure cost." Evaluate this.**
 **A:** Reject on isolation grounds, independent of raw capacity math. A shared cache means the feed cache's traffic pattern (high volume, bursty, tolerant of eviction) can starve the authorization cache's working set out of memory under eviction pressure, or a feed-driven traffic spike can saturate the cluster's connection/CPU budget and add queueing latency to the authorization path — turning a low-stakes system's load spike into a high-stakes system's latency incident. This is the same "a cache whose loss takes down something load-bearing is not a cache, it's a load-bearing dependency wearing a cache costume" lesson (Module 02 §3.4), generalized to noisy-neighbor risk between two *different* workloads sharing one resource pool rather than one workload's cache dependency. The infrastructure-cost savings from one shared cluster are real but small relative to the blast-radius risk; recommend physically separate cache resources (or at minimum separate resource pools/quotas within the cluster) for workloads with materially different criticality, exactly the bulkhead pattern.
4. **Q: Explain why "we tested this and it handled 10x our current peak load" can still be a false sense of security, and design a load test that would actually validate it.**
 **A:** A load test that simply replays 10x the current *request volume* against the *current* data shape validates throughput but not the failure modes that actually take systems down — it typically uses uniformly-distributed synthetic keys (missing hot-key/hot-partition effects, §7.4), runs for a short duration (missing slow leaks — connection pool exhaustion, memory growth, cache-eviction-driven hit-rate decay that only manifests after sustained load), and rarely exercises the failure paths concurrently with load (does auto-scaling actually trigger fast enough under *this* specific load-ramp shape, per §Intermediate Q8?). A load test that actually validates 10x readiness replays the *real* skewed access pattern, runs long enough to expose slow degradation, and includes at least one injected failure (a replica killed, a cache node dropped) mid-test to validate that the failure-handling paths (§12 §3.4-style) work under load, not just in isolation at idle.
5. **Q: A Staff engineer argues a new internal service should skip authentication entirely because "it's only called by other internal services inside our VPC, and the perimeter is already authenticated." As a Principal Engineer, how do you respond?**
 **A:** Push back — "inside the VPC" is a network-topology property, not an identity property, and conflating the two is exactly §8.3's "internal traffic is safe by default" gap. A compromised host anywhere inside that VPC (a dependency-confusion attack against one unrelated service, a misconfigured debug endpoint left open) can now call this unauthenticated internal service with zero additional effort — the perimeter authenticating *external* traffic says nothing about *lateral* movement once any single internal host is compromised. The recommendation is mutual service-to-service authentication (mTLS or signed service tokens) as a standing default for any service handling non-trivial data or state changes, treating "internal" as a convenience for network routing, never as a substitute for authorization — this is precisely the zero-trust argument, and it should be made concrete with "which specific internal service, if compromised, would this decision let move laterally to *this* one" rather than an abstract policy statement.
6. **Q: Design the capacity-planning process for a system whose load is driven by an external, uncontrollable event (a market-moving news event for a trading platform, a viral post for a social platform) rather than steady organic growth.**
 **A:** Steady-growth capacity planning (extrapolate last quarter's trend) fails here because the relevant load spikes are step-functions triggered by events with no advance warning and no historical growth curve to extrapolate from — the planning question changes from "how much capacity will we need next quarter" to "what is our largest plausible instantaneous multiplier over baseline, and can we absorb it." The answer combines: (a) auto-scaling with pre-warmed capacity for the *known* fast-reacting components (§Intermediate Q8's cold-start concern is amplified here — scaling reactively to a true step-function spike is often too slow), (b) an explicit, tested **load-shedding** policy at the edge (§8.2) that degrades gracefully — serving cached/stale responses, rejecting non-critical traffic — rather than allowing every component to degrade uncontrollably together, and (c) treating the historically-largest observed spike multiplier as a standing, revisited input to capacity headroom planning (was our worst day 8x baseline? then headroom should target meaningfully above 8x, not "current average plus a comfortable margin").
7. **Q: A system's design document states "the database is our source of truth" but the system also maintains a search index, a cache, and a data warehouse copy of the same data. Explain the specific failure mode this invites if not addressed explicitly, and how you'd address it.**
 **A:** "Source of truth" stated once, in prose, doesn't prevent the derived copies from silently drifting from that source over time (a failed cache invalidation, a search-indexer consumer that fell behind and silently stopped, an ETL job into the warehouse that partially failed) — and because each derived copy usually *looks* internally consistent (the search index returns *something*, just possibly stale or wrong), drift is invisible until a user notices a discrepancy or a reconciliation job explicitly checks. The fix is to make "source of truth" an *enforced*, monitored property, not a documentation claim: every derived copy's update path should be driven by the same durable event stream (the outbox pattern, §12's `PostCreated` outbox row) rather than a best-effort direct write, and a standing reconciliation job should periodically sample-compare the derived copies against the source and alert on divergence beyond a small tolerance — converting "we assume these stay in sync" into "we verify these stay in sync," the same reconciliation discipline recurring across this course's data-consistency treatments.
8. **Q: As a Principal Engineer evaluating a proposed architecture, how do you distinguish a genuinely necessary complexity (e.g., the hybrid fan-out model in Module 02) from unnecessary, prematurely-adopted complexity, given that both are justified in the design document with plausible-sounding reasoning?**
 **A:** Demand that the complexity be justified by a **specific, quantified, currently-true** constraint from the actual estimation (§12 Step 1's numbers), not a hypothetical or a "we might need this eventually" — Module 02's hybrid model is justified by an actual, stated follower-count distribution and an actual write-amplification calculation showing pure push breaks (166 seconds to propagate one celebrity post while starving all other traffic); a design proposing that same complexity "in case we get a viral account someday" without a current distribution to point to is adopting the same complexity on speculation, and speculation is exactly what §Advanced Q9 in this module argues against (active-active multi-region "for maximum availability... to future-proof"). The test: ask the proposer to show the specific number from *their* system's actual or credibly-projected estimation that the simpler design fails on — if they can't produce one, the complexity is premature.
9. **Q: A production incident review concludes "the root cause was a bug in the retry logic." As a Principal Engineer, why is this conclusion usually incomplete, and what question do you ask next?**
 **A:** "A bug in the retry logic" identifies the *proximate* mechanism but not why the system's design allowed that mechanism's failure to cause the actual customer-facing incident — the next question is "what made this retry bug's blast radius as large as it was," which usually surfaces a genuine architectural gap: no circuit breaker to stop the retries once the downstream was clearly failing, no bulkhead isolating this retry storm's resource consumption from unrelated traffic, no rate limit on retry volume, or a downstream with no independent capacity headroom to absorb the retry amplification. Stopping at "fix the retry bug" fixes this specific incident's trigger while leaving the structural gap (nothing bounds the blast radius of *any* single component's misbehavior) available for the next, differently-triggered incident — a Principal-level postmortem review pushes past the proximate cause to the structural, reusable prevention, exactly the pattern this course's incident analyses consistently apply (root cause *and* the systemic safeguard that should have contained it).
10. **Q: Design the review process a Principal Engineer would run for any new system-design document before it's approved for build, distilled to the smallest set of questions that catches the largest fraction of real-world design failures.**
 **A:** Five questions, each mapped to a documented failure mode in this module: (1) "For each major data type, is the consistency requirement stated explicitly, and is it justified by an actual stated need rather than a default?" (§4's incident). (2) "Where are the actual capacity numbers, and what specific number in this design would break first as load grows — and by how much before it does?" (§12 Step 1, §9.1). (3) "For every component in the diagram, what happens to the rest of the system when *this one* fails or degrades?" (§Advanced Q6, §12 §3.4). (4) "Where does this design add complexity beyond the simplest version that meets the stated requirements, and what specific, current constraint justifies that complexity?" (§Expert Q8). (5) "How will we know, in production, if any of the above assumptions turn out to be wrong?" (§Advanced Q7's actual-vs-estimated monitoring discipline). A document that can't answer all five concretely isn't ready for build regardless of how polished its architecture diagram is — the diagram was never what was being evaluated.

---

## 11. Coding Exercises

*(System Design interviews are typically whiteboard/discussion-based rather than coding-based — this section instead provides structured design exercises with worked solutions, the standard format for this domain.)*

### Easy — Back-of-envelope capacity estimation for a URL shortener
**Problem**: Estimate QPS and storage for a URL-shortening service expecting 100 million new URLs/month and a 100:1 read:write ratio.
**Solution**:
```
Writes: 100,000,000 / (30 days * 86,400 sec) ≈ 38.6 writes/sec average
Reads (100:1 ratio): ≈ 3,860 reads/sec average
Storage per URL: ~500 bytes (original URL + short code + metadata) * 100M/month * 12 months (5-year retention) ≈ 3TB over 5 years
Peak traffic (assume 3x average): ~116 writes/sec, ~11,580 reads/sec peak
```
**Discussion**: These numbers directly inform the design: 3TB over 5 years fits comfortably on a single well-indexed database (no sharding needed, the indexing toolkit suffices); ~11,580 peak reads/sec strongly suggests a cache layer given the high read:write ratio and the fact that short-code lookups are an ideal cache-hit pattern (immutable once created) — the estimation directly justifies *which* rungs of the scaling ladder are actually needed, avoiding both under- and over-engineering.

### Medium — Design a cache-aside layer with stampede protection for the URL shortener's lookup path
**Problem**: Design the read path for resolving a short code to its original URL, given the traffic profile above.
**Solution**: Directly reuses the stampede-resistant cache-aside pattern (double-checked locking via Redis `SET NX`) — since short-code-to-URL mappings are immutable once created, cache with a long TTL (or no TTL at all, invalidating only on the rare "delete/deactivate a short URL" event) and a stampede-protection lock for the cache-population path specifically to handle a sudden burst of first-time lookups for a newly-viral shortened URL.

### Hard — Design a shard-key strategy if the URL shortener's storage requirement grows 100x
**Problem**: If projected growth changes to 10 billion URLs (300TB), design a sharding strategy.
**Solution**: Directly reuses §Advanced Q2's single-table/partition-key design discipline — shard by a hash of the short code itself (high cardinality, evenly distributed, and the natural key every lookup already uses, avoiding the low-cardinality hot-partition mistake) — `shard = hash(shortCode) mod shardCount`, with the read/write path computing the target shard directly from the short code with no separate lookup service needed, exactly mirroring the Redis Cluster hash-slot mechanism and the MongoDB sharding, now applied at the full-system-design level.

### Expert — Design the full failure-mode/graceful-degradation strategy for the URL shortener at scale
**Problem**: Design behavior for cache unavailability, a database replica lagging significantly, and a sudden 10x traffic spike.
**Solution**: Cache unavailable → fall back to direct database reads (§Expert exercise's fallback pattern), with the database's own connection pool sized/rate-limited to survive a full cache-bypass scenario without cascading failure (Advanced Q6); replica lag exceeding a threshold → the read-routing layer falls back to the primary for that specific request rather than serving known-stale data past an acceptable threshold (§Advanced Q6's graceful-degradation pattern); traffic spike → auto-scaling reacts (with pre-warmed/ReadyToRun-compiled application instances to minimize cold-start lag,/9's discussion) while the load-balancer/API-gateway layer applies rate limiting to shed excess load gracefully (returning 429s with `Retry-After`) rather than allowing the entire system to degrade uncontrollably for every user simultaneously.

---

## 12. System Design — The Four-Step Method, Worked End-to-End

*This section defines the method every case-study module in this folder follows, then works it end-to-end on the canonical opening prompt. Read it before Modules 02–20; each of those is this same four-step structure applied to a different problem.*

### The method

Almost every system-design interview, and every useful design document, has the same four movements. Naming them explicitly is worth real points, because it tells the interviewer you have a process rather than a memorised answer.

| Step | What you produce | Typical share of a 45-min round | The failure if you skip it |
|---|---|---|---|
| **1. Understand the problem and establish scope** | A dialogue that narrows the prompt; functional and non-functional requirements; back-of-envelope estimation | 8–10 min | You design for requirements nobody asked for — §4's incident exactly |
| **2. Propose high-level design and get buy-in** | Component list, architecture diagram, end-to-end walkthrough, API surface, data model | 12–15 min | You deep-dive a component the interviewer doesn't care about |
| **3. Design deep dive** | The hard problems: failure, consistency, hot spots, the bottleneck your own estimation exposed | 15–18 min | You produce a boxes-and-arrows diagram with no engineering in it |
| **4. Wrap up** | What you left out; what you'd measure; what you'd do next | 3–5 min | You run out of clock mid-sentence and the interviewer scores an unfinished design |

Two rules govern the whole thing. **Step 1's estimation must end in a conclusion** — not a number, but a sentence of the form *"these numbers mean the hard problem here is X"* — because that sentence is what makes Step 3 targeted instead of generic. And **every design decision gets a stated reason**; "we'd use Redis" scores nothing, "we'd use Redis because the read/write ratio is 100:1 and the working set is 40 GB, which fits in memory" scores.

---

### Step 1 — Understand the Problem and Establish Design Scope

**The prompt:** *"Design a system that supports 10 million users."*

This is the most common opener in the industry and it is deliberately meaningless. Ten million users doing *what*, how often, reading or writing? The entire value of Step 1 is converting it into a problem that can be designed.

#### The dialogue

> **C:** What do the users actually do? I need the dominant access pattern before I can size anything.
> **I:** It's a content platform — users read articles and posts, and a small fraction create them.
>
> **C:** So it's read-heavy. Roughly what ratio?
> **I:** Assume 100 reads per write.
>
> **C:** Are the 10 million users registered users or daily actives? Those differ by an order of magnitude and it changes the design.
> **I:** 10 million registered, 20% daily active.
>
> **C:** How many requests does a daily active user make?
> **I:** About 30 page views a day.
>
> **C:** Is content personalised per user, or is the same content served to everyone?
> **I:** Mostly the same — it's a public site. Personalisation is limited to a small header.
>
> **C:** What's the tolerance for staleness? Can a reader see content that's a few seconds old?
> **I:** Yes for content. No for the user's own writes — if I publish a post I expect to see it immediately.
>
> **C:** Availability target?
> **I:** 99.9%. It's a content site, not a payment system.
>
> **C:** And what's out of scope?
> **I:** Search, recommendations, and the mobile app's offline behaviour. Assume a web client.

Notice what the fourth and fifth questions bought: "mostly the same content for everyone" makes the response **cacheable at the edge**, and "no for the user's own writes" is a **read-your-own-writes** requirement that will rule out naive replica reads. Two sentences of dialogue eliminated an entire branch of the design space.

#### Functional requirements

1. Serve article/post content to anonymous and logged-in readers.
2. Allow authenticated users to create and edit posts.
3. Show a small personalised header (name, notification count) on every page.
4. Serve media (images) attached to posts.

#### Non-functional requirements

| Requirement | Target | Where it came from |
|---|---|---|
| Read latency | p99 < 200 ms | Stated indirectly — "content site" implies web-page expectations |
| Write latency | p99 < 1 s | Writes are rare; users tolerate a publish taking a moment |
| Availability | 99.9% (≈ 43 min/month) | Explicit |
| Consistency — content reads | Eventual, seconds | Explicit |
| Consistency — own writes | **Read-your-own-writes** | Explicit, and the constraint that shapes the caching design |
| Durability | No published post may be lost | Implied; state it anyway |
| Read/write ratio | 100:1 | Explicit |

#### Back-of-the-envelope estimation

Use the standard shortcut: **one day ≈ 10⁵ seconds** (86,400 rounded up — the error is 16%, far below the precision anyone needs).

```
DAU                     = 10,000,000 × 20%          = 2,000,000
Page views/day          = 2,000,000 × 30            = 60,000,000
Average read QPS        = 60,000,000 ÷ 10^5         = 600 reads/s
Peak (×3 diurnal)       =                             1,800 reads/s
Write QPS               = 600 ÷ 100                 = 6 writes/s
Peak writes             =                             18 writes/s
```

Storage:

```
Posts/day       = 6 writes/s × 10^5 s              ≈ 600,000
Post size (text + metadata)                        ≈ 5 KB
Text storage/day = 600,000 × 5 KB                  ≈ 3 GB/day  ≈ 1.1 TB/year
Images: 20% of posts carry one, ~800 KB after processing
                 = 120,000 × 800 KB                ≈ 96 GB/day ≈ 35 TB/year
```

Bandwidth:

```
Read egress = 1,800 reads/s × ~300 KB/page (mostly images) ≈ 540 MB/s ≈ 4.3 Gbps
```

Cache working set — the number that decides the architecture:

```
Apply the 80/20 rule: 20% of posts serve 80% of reads.
Active posts (say the trailing 90 days) = 600,000 × 90        = 54,000,000
Hot 20%                                                       = 10,800,000
× 5 KB text                                                   ≈ 54 GB
```

#### What the numbers tell us

Three conclusions, and stating them out loud is the entire point of Step 1:

1. **This is not a high-QPS system.** 1,800 reads/s and 18 writes/s is *small* — a single well-tuned PostgreSQL instance handles that comfortably. Any answer that opens with sharding, multi-region, or a NoSQL migration has over-engineered before it began, which is exactly the failure §4 documents.
2. **The bandwidth and storage are dominated by images, not by the application.** 4.3 Gbps of egress and 35 TB/year is 97% media. So the highest-leverage decision in the whole design is *media does not go through the application* — object storage plus a CDN — and that decision is worth more than every database optimisation combined.
3. **The 54 GB hot text working set fits in memory.** That is the fact that makes a cache the right answer rather than a hopeful one. Had it come out at 5 TB, the design would need a different shape.

The hard problem here is therefore **not scale — it is read-your-own-writes across a cache and a replica set**, because that is the one requirement the obvious architecture violates.

---

### Step 2 — Propose High-Level Design and Get Buy-In

#### The two flows

- **Read flow** — dominant (100:1), cacheable, tolerant of seconds-old staleness, and the path the SLO is written against.
- **Write flow** — rare, must be durable, and must be immediately visible *to its own author*.

Designing these separately is what makes the read-your-own-writes problem visible rather than accidental.

#### Components

**CDN.** Serves images and cacheable HTML/JSON at the edge. Absorbs the 4.3 Gbps that would otherwise hit your origin. Non-negotiable given the estimation.

**Load balancer (L7).** Terminates TLS, health-checks the app tier, routes by path. Layer 7 rather than Layer 4 because we want path-based routing (`/api/*` vs `/static/*`) and header-aware behaviour — §2.3's distinction applied.

**Stateless app servers.** No session state in process; horizontal scaling is then trivial and a lost instance is a non-event. Session state lives in the cache tier.

**Distributed cache (Redis).** Cache-aside for post content (§2.4). Sized for the 54 GB working set with headroom — say 96 GB across three nodes.

**Primary database (PostgreSQL).** All writes. Single primary is correct at 18 writes/s and stating *why* — rather than sharding reflexively — is the point.

**Read replicas.** Two async replicas absorb read traffic that misses cache.

**Object storage (S3) + processing queue.** Images upload directly to object storage via pre-signed URLs; a worker fleet generates derivatives asynchronously.

**Message queue + workers.** Async work: image processing, notification fan-out, cache warming.

#### End-to-end walkthrough — reading a post

1. Browser requests `https://example.com/posts/abc123`.
2. DNS resolves to the CDN edge nearest the user.
3. CDN checks its cache. **Hit** → served from the edge in ~20 ms; the origin never sees the request. This is where most of the 1,800 reads/s actually terminate.
4. **Miss** → CDN forwards to the load balancer.
5. LB selects a healthy app server (least-connections, since page render times vary).
6. App server checks Redis for `post:abc123`. **Hit** → render and return.
7. **Miss** → read from a replica, populate Redis with a TTL, return.
8. Response carries `Cache-Control: public, max-age=60, stale-while-revalidate=300` so the CDN can serve it to everyone else.
9. The personalised header is fetched by a **separate** client-side call to `/api/me`, marked `Cache-Control: private, no-store` — which is what keeps the page itself cacheable at the edge. Baking the header into the HTML would make every page unique per user and destroy the CDN hit rate, a mistake that is invisible in development and catastrophic in production.

#### End-to-end walkthrough — publishing a post

1. Client `POST`s to `/api/v1/posts`.
2. App server authenticates, validates, writes to the **primary**.
3. In the same transaction, an outbox row is written for downstream fan-out.
4. Cache entry for the author's post list is invalidated (not updated — see §2.4's invalidation discussion).
5. A cookie or session flag records `last_write_at` for this user.
6. Response returns the created post.
7. Asynchronously: the outbox publisher emits an event; workers warm caches and fan out notifications.

#### API design

**`GET /api/v1/posts/{id}`**

| Field | Type | Description |
|---|---|---|
| `id` | string | Post identifier |
| `title`, `body_html` | string | Rendered content |
| `author` | object | `{ id, display_name, avatar_url }` — denormalised to avoid an N+1 read |
| `published_at` | RFC3339 | |
| `media` | array | `{ url, width, height }`, URLs pointing at the CDN, never at the app |

Response headers: `Cache-Control: public, max-age=60, stale-while-revalidate=300`, `ETag`.

**`POST /api/v1/posts`**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | |
| `body_markdown` | string | yes | Rendered server-side; never store client-rendered HTML |
| `media_keys` | string[] | no | Object-storage keys from the pre-signed upload, **not** file bytes |
| `status` | enum | yes | `DRAFT` \| `PUBLISHED` |

Header: `Idempotency-Key` — a double-submitted publish must not create two posts.

**`POST /api/v1/media/upload-url`** returns `{ upload_url, key, expires_at }` — a pre-signed URL so bytes go **client → object storage directly**, never through the app tier. This single decision removes 4.3 Gbps from your servers.

#### Data model

**`post`** — PostgreSQL.

| Column | Type | Notes |
|---|---|---|
| `post_id` | uuid PK | |
| `author_id` | bigint | Indexed |
| `title` | text | |
| `body_markdown` | text | Source of truth |
| `body_html` | text | Rendered once at write, not per read — 100:1 ratio makes this obviously correct |
| `status` | enum | `DRAFT`, `PUBLISHED`, `DELETED` — soft delete, so a cached copy can be invalidated rather than dangling |
| `published_at`, `updated_at` | timestamptz | Index on `(status, published_at DESC)` for listings |

**`media`** — `media_id`, `post_id`, `storage_key`, `width`, `height`, `processing_status`.

**Cache keys** — `post:{id}` (TTL 300 s), `user:{id}:posts` (TTL 60 s), `session:{token}` (TTL = session lifetime).

#### Database selection, and why

**PostgreSQL, single primary, two replicas.** The justification is the estimation, not preference: 18 writes/s and ~1 TB/year of text is comfortably inside one instance for years. Relational fits the data (posts, authors, media have real relationships), ACID makes the outbox pattern possible, and the operational maturity of Postgres is worth more than any benchmark difference at this scale. Choosing Cassandra or DynamoDB here would trade away joins and transactions to solve a scaling problem the numbers say you do not have — which is §6's second anti-pattern in concrete form.

---

### Step 3 — Design Deep Dive

#### 3.1 Read-your-own-writes across cache and replicas — the actual hard problem

The architecture as drawn is broken for the one consistency requirement that was stated. The author publishes → the write lands on the primary → the next read goes to a replica that has not caught up, or to a cache entry populated before the write. The author sees their post missing and publishes again.

Three fixes, in ascending order of sophistication:

| Approach | Mechanism | Cost |
|---|---|---|
| **Read from primary always** | Simple; no staleness | Wastes the replicas entirely; the read scaling you built is unused |
| **Sticky-primary window** | After a write, route *that user's* reads to the primary for N seconds via a session flag | Small primary load increase; needs a sensible N |
| **Replica lag token** | The write returns the primary's LSN/WAL position; the client sends it back; the read path picks a replica caught up past it, or falls through to the primary | Most precise; requires client cooperation and replica-position visibility |

**Recommendation: the sticky-primary window**, sized from *observed* p99 replication lag with a large margin (if lag p99 is 80 ms, use 5 s). It is a few lines of code, needs no client changes, and is correct as long as the window exceeds lag — which must be **asserted and monitored**, not assumed, because a config value whose correctness depends on a runtime property nobody watches will drift.

The cache has the same problem and needs the same discipline: **invalidate on write, do not update on write.** Updating means the cache now contains a value that came from application logic rather than from the database, so the two can diverge silently. Invalidation is self-correcting.

#### 3.2 The cache stampede

At 1,800 reads/s, a popular post's cache entry expiring means potentially thousands of concurrent requests all missing and all hitting the database with the same query — a *stampede* (or dog-pile). The database sees a 1,000× spike for one key.

Mitigations, layered:

- **Per-key locking on miss** — the first miss acquires a short lock and repopulates; the others wait briefly or serve stale. This is the primary fix.
- **Stale-while-revalidate** — serve the expired value while one request refreshes in the background. Requires storing a soft-expiry alongside the hard one.
- **Jittered TTLs** — never a fixed 300 s; use 300 s ± 10%, so a batch of entries populated together does not expire together.

The last one matters more than it looks: a deploy that warms the cache uniformly creates a synchronised expiry cliff five minutes later, which is a self-inflicted incident on a timer.

#### 3.3 Where the bottleneck moves as you grow

The design should state its own next failure, which is what distinguishes a design from a diagram:

| Growth | First thing that breaks | The fix |
|---|---|---|
| 10× reads | CDN hit rate collapses if personalisation leaks into cacheable HTML | Keep the personalised call separate; raise TTLs; add edge compute if needed |
| 10× writes (180/s) | Primary write throughput is still fine; the **outbox publisher** and index maintenance become the pressure | Batch the publisher; review index count on the write path |
| 100× writes (1,800/s) | Single primary genuinely saturates | Shard — **by `author_id`**, because no query in this design joins across authors. Choosing a boundary that queries don't cross makes sharding cheap; choosing one they do cross buys distributed transactions |
| 10× storage | Nothing — object storage is effectively unbounded | Lifecycle policies to move cold media to cheaper tiers |

Naming the shard key *in advance*, while explaining that you are not sharding *yet*, is the answer interviewers are actually probing for.

#### 3.4 Failure handling

- **A replica dies** → LB health checks remove it; read capacity drops 50%; cache absorbs it. Non-event.
- **The primary dies** → automated failover promotes a replica. Writes are unavailable for the failover window (tens of seconds); **reads continue** from cache and the surviving replica. This asymmetry is worth stating: the 99.9% target is comfortably met because the read path does not depend on the primary.
- **Redis dies entirely** → every read falls through to the replicas. At 1,800 reads/s the replicas can absorb it *if* the connection pool doesn't collapse first — so cap pool size and shed load rather than queueing unboundedly. A cache whose loss takes down the database is not a cache, it is a load-bearing dependency wearing a cache costume.
- **Object storage is degraded** → images fail; pages still render. Degrade to placeholder images rather than failing the page — a partial page is worth far more than an error.

#### 3.5 Consistency, restated per data type

The module's central lesson (§2.5, §4) applied concretely: **content reads are AP** (eventual, cached, served stale under stress); **a user's own writes are CP-flavoured** (routed to the primary for a window); **media is immutable** and therefore has no consistency problem at all — which is why content-addressed storage keys are worth using: an immutable object can be cached forever, and "cache forever" is the cheapest consistency model there is.

---

### Step 4 — Wrap-Up

**What we deliberately left out**, and would be the next questions: search (a separate index with its own freshness/latency trade-off — Module 19); recommendations and ranking (Module 02); rate limiting and abuse (Modules 04 and 15); multi-region and the latency-vs-consistency choice it forces; schema migrations under load; and the analytics pipeline.

**What we would measure:** CDN hit ratio (the single most economically significant metric in this design — a 5-point drop is a 25% origin-traffic increase); cache hit ratio and stampede-lock contention; replication lag p99, **alerted against the sticky-window value**, because that relationship is what keeps §3.1 correct; p99 read latency segmented by cache-hit/miss, since a blended number hides a collapsing hit rate; and write-path error rate.

**Summary.** The design is deliberately boring: CDN, load balancer, stateless app tier, cache, one primary, two replicas, object storage for media. That is the correct outcome, and the estimation is what proves it. The engineering that actually earns the score is in three places — keeping personalisation out of the cacheable response, routing bytes around the app tier entirely, and solving read-your-own-writes explicitly instead of discovering it in production.

---

### References

1. Alex Xu — *System Design Interview Vol. 1*, ch. 1 "Scale from Zero to Millions of Users" and Vol. 2's four-step framework, which this section's structure follows.
2. Martin Fowler — *Patterns of Enterprise Application Architecture* (cache-aside, identity map).
3. AWS — *Amazon CloudFront Developer Guide*: cache keys, `Cache-Control`, and origin shielding.
4. RFC 5861 — `stale-while-revalidate` and `stale-if-error` HTTP cache extensions.
5. PostgreSQL docs — *Hot Standby and Streaming Replication*, `pg_last_wal_replay_lsn` (the lag-token mechanism of §3.1).
6. Redis docs — key eviction policies and the `SET NX PX` lock used for stampede protection.
7. Facebook Engineering — *Scaling Memcache at Facebook* (NSDI '13) — leases and stampede control at scale.
8. Google SRE Book, ch. 22 — *Addressing Cascading Failures* (why an unbounded pool turns a cache outage into a database outage).
9. Eric Brewer — *CAP Twelve Years Later: How the "Rules" Have Changed* — the per-operation reading of CAP this module argues for.

---

## 13. Low-Level Design

**Requirements**: the read path from §12 Step 2 — CDN → app server → cache-aside → replica, with the read-your-own-writes correction from §12 §3.1 — implemented so the sticky-primary window and cache invalidation are enforced consistently regardless of which app-server replica handles a given request, and so the stampede-protection lock (§12 §3.2) is correct under concurrent misses on the same key.

**Class diagram:**
```mermaid
classDiagram
 class PostReadRequest {
 +string PostId
 +string UserId
 }
 class IPostCache {
 <<interface>>
 +GetAsync(postId) Post
 +SetAsync(postId, post, ttl) Task
 +InvalidateAsync(postId) Task
 }
 class IStickyWriteTracker {
 <<interface>>
 +RecordWriteAsync(userId) Task
 +ShouldRouteToPrimary(userId) bool
 }
 class IReadRouter {
 <<interface>>
 +ResolveDataSource(userId) DataSource
 }
 class ICacheStampedeLock {
 <<interface>>
 +TryAcquireAsync(key) bool
 +ReleaseAsync(key) Task
 }
 class PostReadService {
 -IPostCache cache
 -IStickyWriteTracker writeTracker
 -IReadRouter router
 -ICacheStampedeLock lock
 +HandleAsync(PostReadRequest) Post
 }
 PostReadService --> IPostCache
 PostReadService --> IStickyWriteTracker
 PostReadService --> IReadRouter
 PostReadService --> ICacheStampedeLock
```

**Sequence diagram** (cache miss, post-write sticky window active):
```mermaid
sequenceDiagram
 participant Client
 participant Service as PostReadService
 participant Tracker as IStickyWriteTracker
 participant Cache as IPostCache
 participant Lock as ICacheStampedeLock
 participant Router as IReadRouter
 participant DB

 Client->>Service: GetPost(postId, userId)
 Service->>Tracker: ShouldRouteToPrimary(userId)?
 Tracker-->>Service: true (recent write, window not expired)
 Service->>Cache: GetAsync(postId)
 Cache-->>Service: miss
 Service->>Lock: TryAcquireAsync(postId)
 Lock-->>Service: acquired
 Service->>Router: ResolveDataSource -- forced to PRIMARY (sticky)
 Router-->>Service: Primary
 Service->>DB: Query primary
 DB-->>Service: Post
 Service->>Cache: SetAsync(postId, post, jitteredTtl)
 Service->>Lock: ReleaseAsync(postId)
 Service-->>Client: Post
```

**Design patterns used**: **Strategy** (`IReadRouter` — primary vs. replica selection is swappable and independently testable from the rest of the read path); **Decorator** (cache-aside wraps the underlying data-access call rather than being baked into it, so the stampede lock can be layered on independently); **Lock/Mutex-via-cache** (`ICacheStampedeLock`, implemented as Redis `SET NX PX`, §12 §3.2); **Circuit Breaker** (implicit at `IPostCache` — a cache-unavailable exception routes to the fallback data path from §12 §3.4, rather than propagating).

**SOLID mapping**: Single Responsibility (the tracker only tracks recency of writes, the router only resolves which data source to use, the cache only caches — none overlap, exactly why the sticky-window logic can be unit-tested without a real cache or database); Open/Closed (swapping the sticky-window strategy for a replica-lag-token strategy, §12 §3.1's third option, means implementing a new `IReadRouter` without touching `PostReadService`); Liskov (any `IPostCache` implementation must honor "a miss returns null, never throws for a routine miss" — a Redis-backed and an in-memory-fallback implementation must be interchangeable under this contract); Interface Segregation (`IPostCache` doesn't expose administrative operations like flush/scan that only an ops tool needs); Dependency Inversion (`PostReadService` depends on the four interfaces, never on `RedisClient` or `SqlConnection` directly — enabling the entire read path to be tested with in-memory fakes).

**Extensibility**: adding the replica-lag-token approach (§12 §3.1's third, most precise option) is a new `IReadRouter` implementation plus a small addition to the write path to return the primary's LSN — no change to `PostReadService`, `IPostCache`, or the stampede lock.

**Concurrency/thread safety**: the stampede lock is the only place concurrent correctness is genuinely at risk — implemented as an atomic `SET NX PX` against Redis (not an in-process lock, since requests are served by many stateless replicas), it guarantees only one concurrent miss on a given key populates the cache while others either wait briefly or serve a stale value, per §12 §3.2. The sticky-write tracker is read-heavy and eventually-consistent-tolerant itself — a tracker read that's a few hundred milliseconds stale merely widens the effective sticky window slightly, which is safe in the direction that matters (never *shorter* than intended).

---

## 14. Production Debugging

**Incident**: A content platform (the system from §12) began receiving a low but steady stream of user complaints: "I published a post and it briefly disappeared, then came back." Support initially dismissed it as a client-side rendering glitch. It persisted for weeks, concentrated in reports from users on mobile networks.

**Root cause**: The sticky-primary window (§12 §3.1) was implemented as a client-side cookie flag, not a server-tracked value — the read path checked "does this request carry a `recent_write=true` cookie" to decide whether to route to the primary. Mobile clients on cellular networks frequently switch between CDN edge PoPs and, in a specific edge case, retried a request without the cookie after a network hiccup (a standard mobile HTTP client behavior under connection re-establishment) — silently falling back to the default replica-read path mid-window, hitting a replica that hadn't yet caught up, and rendering the post as briefly missing before a subsequent, cookie-bearing request self-corrected.

**Investigation**: Client-side rendering was ruled out first (the team could not reproduce on any single stable connection) — the pattern only appeared once request logs were correlated by `user_id` across consecutive requests, revealing that the "missing" read was consistently a request **without** the sticky cookie, sandwiched between two requests that had it. Cross-referencing with mobile-network telemetry confirmed the missing-cookie requests correlated with connection re-establishment events, not with any specific device or app version — ruling out a client bug and pointing at the mechanism carrying the sticky signal itself.

**Tools**: request-log correlation by `user_id` across a short time window (not single-request tracing, since the bug only appears *across* a sequence of requests); mobile network telemetry cross-reference; a synthetic repro harness that simulated a cookie-dropped retry against the real read path, which reproduced the missing-post behavior deterministically once the hypothesis was formed.

**Fix**: moved the sticky-write signal server-side — keyed by `user_id` in a small, fast, short-TTL store (the same Redis cluster, a `sticky:{user_id}` key set on write, checked on read) rather than trusting a client-supplied cookie to survive an unreliable mobile network round-trip. The read path now derives the routing decision entirely from server state, making it immune to any client-side signal loss.

**Prevention**: (1) never place a correctness-load-bearing signal (as opposed to a pure optimization hint) in client-controlled state that can be dropped by network conditions outside the server's control — a lesson generalizable well beyond this incident. (2) Added a synthetic monitor that periodically writes as a synthetic user and immediately reads, alerting if the read-your-own-writes guarantee is ever violated in production, converting a support-ticket-driven discovery into an automatically-detected one. (3) Documented the sticky-window mechanism's trust boundary explicitly in the design doc, so a future engineer modifying the read path sees the constraint rather than rediscovering it via a second incident.

---

## 15. Architecture Decision

**Context**: extending §12 §3.1's three-option table into a full comparison, since the choice of how to guarantee read-your-own-writes is the single decision that determines both the correctness story and the operational complexity of the entire read path.

**Option A — Always read from the primary:**
*Advantages*: Trivially correct — no staleness window to reason about, no client- or server-side sticky state to maintain, nothing to get wrong the way §14's incident got wrong.
*Disadvantages*: Discards the entire purpose of having read replicas — at 1,800 reads/s peak (§12 Step 1), routing every read to one primary reintroduces the exact bottleneck replicas exist to remove, and the design's read-scaling story collapses to "we don't scale reads."
*Cost*: Low engineering cost, high infrastructure cost (a much larger primary, or a primary that becomes the ceiling on read throughput). *Complexity*: Very low. *Maintainability*: Very high. *Scalability*: Poor — reintroduces a single-instance bottleneck for the platform's dominant traffic.

**Option B — Sticky-primary window (recommended, as in §12):**
*Advantages*: Routes only the small fraction of reads that are actually at risk (a user reading immediately after their own write) to the primary; the vast majority of read traffic still benefits fully from replicas and cache. Cheap to implement once state is server-side (§14's fix).
*Disadvantages*: Introduces a window parameter that must be sized from *observed* replication lag and kept correct as that lag drifts (§12 §3.1's monitoring requirement); a naive client-side implementation is fragile, as §14 demonstrates.
*Cost*: Low infrastructure cost (a small Redis key per active writer); moderate engineering cost (getting the state-tracking mechanism right). *Complexity*: Moderate. *Maintainability*: High, contingent on the window being monitored against actual lag rather than set once and forgotten. *Scalability*: Excellent — cost scales with write rate (§12's 18 writes/s peak), not read rate.

**Option C — Replica-lag token (LSN/WAL-position handoff):**
*Advantages*: The most precise option — a read is routed to *any* replica that has caught up past the write's exact position, rather than unconditionally to the primary for a fixed window; no wasted primary reads once a replica catches up early.
*Disadvantages*: Requires the client (or a client-transparent proxy) to carry the token across requests, and requires the read path to query replica replay position before routing — meaningfully more moving parts than a window, and a bug in the token-plumbing has the same "silent correctness violation" failure shape as §14's incident, just in a different mechanism.
*Cost*: Low infrastructure cost; highest engineering cost of the three. *Complexity*: High. *Maintainability*: Moderate — correctness depends on the token surviving every hop, an assumption that must be actively defended (§14's lesson generalized: any correctness-load-bearing token needs a server-side, not purely client-relayed, source of truth wherever possible). *Scalability*: Excellent, and marginally better than B under very bursty write patterns from a single user.

**Recommendation**: **Option B**, server-side, as corrected in §14 — it captures nearly all of Option C's benefit (only a small fraction of reads pay the primary-routing cost) at meaningfully lower engineering and operational complexity, and its one real risk (a window sized wrong, or a state-tracking bug) is fully mitigated by keeping the signal server-side and monitoring the window against observed replication lag. Option C is worth proposing as a *future* evolution if the platform's write pattern becomes bursty enough that a fixed window starts wasting meaningful primary capacity — but adopting it now, before that constraint is demonstrated, would be exactly the premature-complexity pattern §Expert Q8 warns against.

---

## 17. Principal Engineer Perspective

**Business impact**: requirements-gathering discipline and read/write consistency correctness are invisible when done right and extremely visible (in the form of user-facing bugs, like §14's disappearing posts, or capacity incidents, like §4's) when skipped — a Principal Engineer's case for investing time in this module's practices is best made concrete: "the incident like §4 cost us a primary-database-wide latency degradation affecting unrelated, revenue-critical traffic; the fifteen minutes of requirements discussion that would have prevented it costs fifteen minutes." Business stakeholders fund prevention far more readily when it's anchored to a specific, previously-paid cost rather than an abstract "best practice."

**Engineering trade-offs**: the recurring trade-off across this entire module is between the **simplest correct design** and the **most scalable design** — Option A vs. B vs. C in §15 is one concrete instance, and the database-scaling ladder (§9.1) is the general form of the same trade-off, climbed one rung at a time as actual, measured need demonstrates it, never preemptively. A Principal Engineer's specific value is holding this line under pressure from engineers who want to build the more sophisticated version because it's more technically interesting, not because the numbers demand it.

**Technical leadership**: the practices that prevent the incidents in this module (requirements checklists, per-layer security review, monitored capacity assumptions) share a property that makes them organizationally fragile — they cost continuous discipline and produce nothing visible when working, exactly as Module 09 §17 notes for its own domain. A Principal Engineer's job is making these mechanically enforced (a required section in every design doc template, an automated synthetic monitor like §14's fix) rather than reliant on any individual engineer remembering to apply them.

**Cross-team communication**: a system-design decision's non-functional trade-offs (staleness tolerance, availability target, consistency guarantee) are frequently invisible to the product stakeholders who set the original requirement — translating "we chose eventual consistency for the feed" into "content may take a few seconds to appear everywhere, but the site stays fast and available even under heavy load" (§Expert Q10's translation discipline) is what lets a non-technical stakeholder actually evaluate whether the trade-off is acceptable, rather than rubber-stamping a decision they didn't understand.

**Architecture governance**: every non-obvious decision in this module's worked example (why PostgreSQL over a NoSQL migration, why the sticky window over always-primary, why the CDN split from the app tier) should be recorded as an ADR with its numeric justification (§12 Step 1's actual estimation), specifically because each will look like unnecessary caution to a future engineer facing pressure to "just make it faster" without the original numbers in front of them.

**Cost optimization**: the highest-leverage cost decision in this module's worked system is routing media bytes around the application tier entirely (§12 Step 2's pre-signed-upload-URL decision) — a single architectural choice that removes 4.3 Gbps of egress from the app tier's cost and capacity envelope. Principal-level cost optimization is usually found in decisions like this one (what doesn't need to touch expensive compute at all) far more often than in tuning the expensive compute that remains.

**Risk analysis**: the dominant risk pattern across this module is **silent correctness drift** — an assumption (follower distribution, replication lag, a client-carried cookie's reliability) that was true when the system launched becoming false as the system evolves, with no mechanism to detect the drift until a user or an incident surfaces it. A Principal Engineer's risk register for any system built on this module's patterns should weight "do we have an automated check that our core assumptions still hold" above almost any other line item, because that single class of gap explains both incidents documented in this module and its sibling.

**Long-term maintainability**: the artifacts most likely to decay silently are exactly the ones with no natural trigger to revisit them — a sticky-window duration set from lag observed at launch, a capacity plan sized from year-one traffic, a security review conducted once before the initial ship. Each needs an explicit owner and a recurring review cadence tied to a measurable signal (observed lag, observed QPS, time since last review) rather than being revisited only when something breaks.

---

## 18. Revision
**Key takeaways**: Requirements-gathering (especially non-functional requirements — scale, latency, availability, consistency, read/write ratio) is the single highest-leverage system-design skill, and skipping it is the most common, most costly real-world mistake. Back-of-envelope capacity estimation should drive architecture choices, preventing both over- and under-engineering. CAP theorem is the theoretical foundation underlying every consistency-model decision across this course's data-layer modules (PostgreSQL, MongoDB, DynamoDB) — recognize these as instances of one underlying trade-off, not separate concerns. The database-scaling ladder (vertical/query-optimization → read replicas → caching → sharding) should be climbed progressively, driven by demonstrated need, not preemptively. Latency budgets, defense-in-depth security review, and graceful-degradation/failure-mode planning should be explicit, addressed-per-component parts of any system-design answer, not afterthoughts.

---

**Next**: Continuing autonomously to Module 38 — Designing Specific Systems (URL Shortener, Rate Limiter, News Feed, Chat System) as fully-worked, end-to-end case studies applying this module's framework.
