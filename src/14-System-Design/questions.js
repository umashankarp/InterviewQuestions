(function (r) {
registerTopic('14-system-design', {
related: ['16-distributed-systems', '17-microservices', '15-low-level-design'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['method', 'framework'],
  q: r`How do you structure a system design interview answer at Principal level?`,
  a: r`A repeatable four-step structure (the one used by most strong candidates and the System Design Interview books):

1. **Clarify scope and requirements** (5 to 8 minutes): users, core use cases, explicitly out of scope; functional and non-functional requirements (latency, availability, consistency, durability, compliance); single vs multi-region.
2. **Estimate** (back-of-the-envelope): QPS (average and peak), storage growth, bandwidth, and **say what the numbers imply** (for example "10 writes/s means correctness, not throughput, is the hard problem").
3. **High-level design**: components, data flow for each core use case, API sketch, data model; get buy-in.
4. **Deep dive** into the 2 or 3 hardest parts: consistency and failure handling, hot spots, scaling the bottleneck, security; then **wrap up** with trade-offs, what you would monitor, and what you left out.

Principal-level signals: driving the conversation, naming trade-offs with numbers, designing for failure (idempotency, retries, reconciliation), operational concerns (observability, rollout, cost), and knowing what not to build.`,
  code: r`~~~text
Template I write on the whiteboard
1. Requirements: F1..F4 | NFR: p99 < 200 ms, 99.95% avail, RPO 0 for money, EU data residency
2. Estimates:    DAU 5 M, 20 actions/day -> 100 M/day -> ~1,200 QPS avg, ~6,000 peak; 1 KB each -> 100 GB/day
                 Implication: reads dominate 50:1 -> cache + replicas; writes need idempotency, not sharding
3. High level:   client -> CDN -> gateway -> services -> DB/cache/queue; one flow per use case
4. Deep dive:    (a) idempotent writes (b) hot keys (c) multi-region failover
5. Wrap-up:      metrics/alerts, rollout, cost, what I did not cover
~~~`,
  dia: r`flowchart LR
  A[1 Clarify requirements] --> B[2 Estimate and state implications]
  B --> C[3 High-level design + APIs + data model]
  C --> D[4 Deep dive: hardest 2-3 parts]
  D --> E[Wrap-up: trade-offs, monitoring, gaps]`,
  pts: [r`Clarify scope, functional and non-functional requirements first.`, r`Estimate QPS, storage and bandwidth, then state what the numbers imply.`, r`Design the high level per core use case with APIs and data model.`, r`Deep dive into the hardest two or three parts, especially failure handling.`, r`Close with trade-offs, monitoring and what you left out.`],
  ex: r`Candidates who said "at 10 TPS the problem is correctness, not scale" and then designed idempotency and reconciliation scored far above those who drew Kafka and sharding immediately.`,
  fu: [r`How do you handle an interviewer who keeps changing requirements?`, r`How do you decide what to deep dive?`],
  pit: [r`Drawing boxes before agreeing requirements.`, r`Skipping the implication of the estimates.`],
  tip: r`Say the implication of your numbers out loud. It is the single strongest Staff/Principal signal in system design.` },

{ id: 'q2', level: 'Basic', tags: ['estimation'],
  q: r`Walk through back-of-the-envelope estimation for a service with 10 million daily active users. Which numbers should you know?`,
  a: r`Useful constants:

- 1 day ≈ 86,400 s ≈ 10^5 s (use 10^5 for quick maths).
- Peak ≈ 2 to 5x average (higher for event-driven spikes).
- Latency ladder: L1 ~1 ns, RAM ~100 ns, SSD random read ~100 µs, same-AZ network round trip ~0.5 ms, cross-region ~50 to 150 ms.
- A single modern database primary: thousands to tens of thousands of simple writes/s; Redis ~100K ops/s per shard; Kafka partition ~10 MB/s+.

Example: 10 M DAU, each 30 reads and 3 writes per day.

- Reads: 300 M/day / 10^5 ≈ 3,000 QPS avg, ~10,000 peak.
- Writes: 30 M/day / 10^5 ≈ 300 QPS avg, ~1,000 peak.
- Storage: 30 M writes x 1 KB = 30 GB/day ≈ 11 TB/year (+ indexes, replicas x3).

Implications: read-heavy (10:1) -> caching and replicas; writes fit one well-sized primary; storage growth suggests partitioning or archiving within a couple of years.`,
  code: r`~~~text
DAU 10,000,000
Reads/day  = 10 M x 30 = 300 M  -> 300e6 / 1e5 = 3,000 QPS avg, x3 peak = ~9,000 QPS
Writes/day = 10 M x 3  =  30 M  ->  30e6 / 1e5 =   300 QPS avg, x3 peak =   ~900 QPS
Storage    = 30 M x 1 KB = 30 GB/day -> ~11 TB/year raw -> ~33 TB with 3 replicas, + ~30% indexes
Bandwidth  = 9,000 QPS x 5 KB response = 45 MB/s egress at peak
~~~`,
  pts: [r`Use 10^5 seconds per day for quick maths.`, r`Peak is 2 to 5x average.`, r`Know the latency ladder and rough per-node capacities.`, r`Compute QPS, storage, bandwidth with arithmetic shown.`, r`Conclude with implications: read/write ratio, scaling pressure, growth horizon.`],
  ex: r`An estimate showing 900 write QPS at peak stopped a team from sharding prematurely; a single primary with read replicas and caching carried them for three years.`,
  fu: [r`How would a marketing push notification change the peak?`],
  pit: [r`Presenting numbers without drawing conclusions.`] },

{ id: 'q3', level: 'Basic', tags: ['cap', 'pacelc'],
  q: r`Explain CAP and PACELC in practical terms. How do they guide database and architecture choices?`,
  a: r`**CAP**: during a network **P**artition, a distributed system must choose between **C**onsistency (every read sees the latest write, or errors) and **A**vailability (every request gets a response, possibly stale). Partitions are not optional in distributed systems, so the real choice is C or A during partitions.

**PACELC** adds the normal case: if Partitioned, choose A or C; **E**lse, choose **L**atency or **C**onsistency. Synchronous replication across zones/regions buys consistency with latency.

Examples:

- Single-primary relational DB with synchronous standby: PC/EC (consistent, slower writes, unavailable for writes if the primary is unreachable).
- DynamoDB/Cassandra default: PA/EL (available, low latency, eventually consistent); tunable per request.
- Spanner/CockroachDB: PC/EC with consensus latency.

Guidance: choose per **data type**, not per system: balances and inventory reservations need consistency; product catalogue, recommendations and feeds tolerate staleness.`,
  code: r`~~~text
Data type                       Choice    Mechanism
Account balance / ledger        CP / EC   single-writer primary, sync replica, conditional writes
Inventory reservation           CP        conditional decrement in one partition
Product catalogue               AP / EL   replicas + caches, TTL staleness budget
Social feed / recommendations   AP / EL   eventually consistent fan-out
Session data                    AP        replicated cache, re-login acceptable on loss
~~~`,
  pts: [r`During a partition you choose consistency or availability.`, r`PACELC adds the latency vs consistency trade-off in normal operation.`, r`Synchronous replication buys consistency with latency.`, r`Choose per data type, not per whole system.`, r`Money and reservations need consistency; feeds and catalogues tolerate staleness.`],
  ex: r`A retailer kept inventory reservations on a strongly consistent store while serving the catalogue from eventually consistent replicas and CDN, getting both correctness and speed.`,
  fu: [r`Is a single-node database CA?`, r`What does "tunable consistency" mean in Cassandra?`],
  pit: [r`Claiming a distributed system can be CA.`] },

{ id: 'q4', level: 'Basic', tags: ['scaling'],
  q: r`Vertical vs horizontal scaling, stateless services and the scaling ladder. What do you do first?`,
  a: r`- **Vertical scaling**: bigger machines. Simple, no code changes; limited by the largest instance and creates a large failure domain.
- **Horizontal scaling**: more instances behind a load balancer. Requires **stateless** services (state in databases, caches, object storage), enabling autoscaling and resilience.

A pragmatic scaling ladder:

1. Fix inefficiencies (queries, indexes, N+1, allocations).
2. Stateless app tier + load balancer + autoscaling.
3. Caching (CDN for static and cacheable responses, Redis for hot data).
4. Read replicas for read-heavy databases.
5. Asynchronous processing with queues for non-interactive work.
6. Vertical scale of the database.
7. Functional partitioning (split by bounded context / service).
8. Data partitioning / sharding.
9. Multi-region.

Each step adds operational cost; climb only as far as requirements demand.`,
  code: r`~~~yaml
# Stateless .NET API autoscaled on CPU and RPS (Kubernetes HPA)
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: orders-api }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: orders-api }
  minReplicas: 3
  maxReplicas: 40
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 60 } }
~~~`,
  dia: r`flowchart LR
  U[Users] --> CDN
  CDN --> LB[Load balancer]
  LB --> A1[API pod 1]
  LB --> A2[API pod 2]
  LB --> A3[API pod N]
  A1 & A2 & A3 --> R[(Redis cache)]
  A1 & A2 & A3 --> P[(Primary DB)]
  A1 & A2 & A3 --> RR[(Read replicas)]
  A1 & A2 & A3 --> Q[(Queue)] --> W[Workers]`,
  pts: [r`Vertical scaling is simple but bounded and a big failure domain.`, r`Horizontal scaling needs stateless services.`, r`Fix inefficiencies before adding infrastructure.`, r`Climb the ladder: cache, replicas, async, split, shard, multi-region.`, r`Each rung adds operational cost.`],
  ex: r`A team avoided a sharding project by adding a CDN, Redis and two read replicas, which cut primary load by 85%.`,
  fu: [r`What makes a service not stateless?`],
  pit: [r`Sticky in-memory sessions blocking horizontal scaling.`] },

{ id: 'q5', level: 'Basic', tags: ['caching', 'cdn'],
  q: r`Where can you cache in a web system, and how do you decide what to cache where?`,
  a: r`Cache layers from client inward:

- **Browser/HTTP cache**: Cache-Control, ETags for static assets and safe GETs.
- **CDN / edge**: static assets, images, video segments, cacheable API responses (anonymous product data); purge by surrogate keys.
- **API gateway / reverse proxy** response caching.
- **Application in-process (L1)**: hottest data, seconds of staleness.
- **Distributed cache (L2, Redis)**: shared across instances.
- **Database buffer pool** and materialised views.

Decide with: read/write ratio, staleness tolerance, personalisation (cache keys by user/tenant), data sensitivity (never cache sensitive personal data at shared layers), and invalidation ownership. Measure hit ratios per layer.`,
  code: r`~~~csharp
// Public, cacheable product data: CDN + browser
app.MapGet("/products/{id}", (int id, HttpContext http, ICatalog c) =>
{
    http.Response.Headers.CacheControl = "public, max-age=60, stale-while-revalidate=300";
    http.Response.Headers["Surrogate-Key"] = "product-" + id;      // targeted CDN purge on change
    return c.GetAsync(id);
});
// Personal data: never shared caches
app.MapGet("/me/statements", (ClaimsPrincipal u, IStatements s, HttpContext http) =>
{
    http.Response.Headers.CacheControl = "private, no-store";
    return s.ListAsync(u.CustomerId());
});
~~~`,
  dia: r`flowchart LR
  B[Browser cache] --> CDN[CDN edge cache]
  CDN --> GW[Gateway response cache]
  GW --> API[API with L1 memory cache]
  API --> RC[(Redis L2)]
  RC --> DB[(Database + buffer pool)]`,
  pts: [r`Cache at browser, CDN, gateway, in-process, distributed cache and database.`, r`Decide by read/write ratio and staleness tolerance.`, r`Key personalised data correctly; never share sensitive data across users.`, r`Every cache needs an invalidation owner and a TTL.`, r`Measure hit ratio per layer.`],
  ex: r`Adding surrogate-key CDN caching to an e-commerce product API cut origin traffic by 80% during sales.`,
  fu: [r`How do you purge CDN caches on price changes?`],
  pit: [r`Caching authenticated responses at a shared CDN without varying by user.`] },

{ id: 'q6', level: 'Basic', tags: ['sync-vs-async'],
  q: r`When should communication between components be synchronous vs asynchronous?`,
  a: r`**Synchronous (HTTP/gRPC)** when the caller needs the answer to proceed and the user is waiting: read queries, validations, authorisation checks. Costs: temporal coupling (if the callee is down, the caller fails), latency adds up across chains, cascading failures.

**Asynchronous (queues, events)** when:

- The work can complete later (emails, reports, notifications, downstream projections).
- You need to absorb spikes (queue as buffer) or decouple availability.
- Several consumers react to the same fact (events).
- Long-running processes (sagas, approvals).

Hybrid patterns: accept a request synchronously, return **202 Accepted** with a status resource, process asynchronously; or reply synchronously with the core result and publish events for side effects via the outbox.

Rule of thumb: keep the synchronous critical path short (few hops), push everything else to async with idempotent consumers.`,
  code: r`~~~csharp
// Sync for what the user needs now; async for side effects via outbox
app.MapPost("/orders", async (PlaceOrder cmd, OrdersDb db, CancellationToken ct) =>
{
    var order = Order.Place(cmd);
    db.Orders.Add(order);
    db.Outbox.Add(OutboxMessage.From(new OrderPlaced(order.Id, order.Total)));   // email, loyalty, analytics later
    await db.SaveChangesAsync(ct);
    return Results.Created("/orders/" + order.Id, new { order.Id, order.Status });
});
// Long work: 202 + status resource
app.MapPost("/reports", async (ReportRequest r, IJobQueue q) =>
    Results.Accepted("/reports/jobs/" + await q.EnqueueAsync(r)));
~~~`,
  dia: r`sequenceDiagram
  participant U as User
  participant API as Orders API
  participant DB as Orders DB
  participant B as Broker
  participant E as Email service
  U->>API: POST /orders
  API->>DB: insert order + outbox (one tx)
  API-->>U: 201 Created
  DB-->>B: relay publishes OrderPlaced
  B-->>E: OrderPlaced
  E->>E: send confirmation (retry if needed)`,
  pts: [r`Synchronous when the caller needs the answer now.`, r`Asynchronous for deferrable work, spikes, fan-out and long processes.`, r`Sync chains add latency and cascade failures.`, r`Use 202 + status resources for long operations.`, r`Short synchronous critical path; side effects via outbox.`],
  ex: r`Moving confirmation emails and loyalty updates off the checkout path cut p99 from 1.8 s to 350 ms and removed email outages from checkout incidents.`,
  fu: [r`How do you show progress to users for async work?`],
  pit: [r`Long synchronous chains across five services.`] },

{ id: 'q7', level: 'Intermediate', tags: ['url-shortener'],
  q: r`Design a URL shortener (100 M new URLs per month, 10 B redirects per month).`,
  a: r`### Requirements and estimates
Create short links, redirect, optional custom alias and expiry, click analytics. 100 M/month ≈ 40 writes/s; 10 B/month ≈ 3,900 reads/s average, ~40,000 peak. 100 M x 12 months x 5 years x 500 bytes ≈ 3 TB. **Read-heavy (100:1); redirect latency and availability matter most.**

### Key design
- **Short code generation**: random base62 (7 chars = 3.5 trillion codes) with a conditional insert to handle collisions, or a distributed ID generator encoded in base62 (no collisions, but predictable). Avoid a single central counter.
- **Storage**: key-value store (DynamoDB/Cassandra) keyed by code; or relational with a unique index.
- **Redirect path**: CDN/edge caches 301/302 responses; Redis for hot codes; the store for misses. 301 is cacheable by browsers (less analytics); 302 gives tracking.
- **Analytics**: emit click events to a stream (Kafka/Kinesis), aggregate asynchronously; never increment counters synchronously on the redirect path (hot keys).
- **Abuse**: rate limits, malware/phishing URL scanning, link expiry.`,
  code: r`~~~csharp
app.MapGet("/{code:regex(^[0-9A-Za-z]{{7}}$)}", async (string code, HybridCache cache, ILinkStore store, IClickStream clicks, HttpContext http) =>
{
    var target = await cache.GetOrCreateAsync("link:" + code, async ct => await store.GetAsync(code, ct));
    if (target is null) return Results.NotFound();
    clicks.Publish(new Click(code, DateTimeOffset.UtcNow, http.Request.Headers.UserAgent.ToString()));   // fire into a buffered stream
    http.Response.Headers.CacheControl = "public, max-age=300";
    return Results.Redirect(target, permanent: false);                                                   // 302 keeps analytics
});
static string NewCode() { Span<char> c = stackalloc char[7]; const string a = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    for (var i = 0; i < 7; i++) c[i] = a[RandomNumberGenerator.GetInt32(62)]; return new string(c); }   // insert with attribute_not_exists, retry on collision
~~~`,
  dia: r`flowchart LR
  U[Browser] --> CDN[CDN: cached redirects]
  CDN -->|miss| API[Redirect service]
  API --> RC[(Redis hot codes)]
  API --> KV[(DynamoDB code -> URL)]
  API --> ST[Click stream Kinesis/Kafka] --> AGG[Aggregator] --> AN[(Analytics store)]
  C[Create API] -->|conditional insert| KV
  C --> SCAN[URL safety scan]`,
  pts: [r`100:1 read-heavy: optimise the redirect path with CDN and cache.`, r`Random base62 codes with conditional inserts avoid a central counter.`, r`Key-value store keyed by code.`, r`302 for analytics, 301 for maximum caching.`, r`Clicks go to a stream, aggregated asynchronously.`],
  ex: r`A marketing-link platform served 95% of redirects from the CDN, keeping its database at a few hundred reads per second.`,
  fu: [r`How do you support custom aliases without conflicts?`, r`How do you delete links reliably from CDN caches?`],
  pit: [r`Synchronous click counters on the redirect path.`] },

{ id: 'q8', level: 'Intermediate', tags: ['rate-limiter'],
  q: r`Design a distributed rate limiter for a public API (per API key and per IP).`,
  a: r`### Requirements
Limits per key (e.g. 1,000/min, burst 100) and per IP; low latency (< 2 ms added); accurate enough across many gateway instances; clear 429 responses with Retry-After and rate-limit headers; configurable per plan.

### Design
- **Algorithm**: token bucket or GCRA (exact rate, bounded burst, tiny state).
- **Where**: at the gateway/edge so rejected traffic never reaches services.
- **State**: Redis with a Lua script per check (atomic), keys per (key, window); or local buckets per instance with a share of the global limit to avoid a network hop, periodically reconciled.
- **Rules**: stored in configuration (per plan, per endpoint) and cached in the gateway.
- **Failure mode**: if Redis is down, fail open with local limits (availability) or fail closed for abuse-prone endpoints.
- **Observability**: rejections per key, top limited keys, Redis latency.`,
  code: r`~~~lua
-- GCRA in Redis: KEYS[1]=key, ARGV: now_ms, emission_interval_ms, burst_ms. Returns 0 allowed or retry_after_ms
local tat = tonumber(redis.call('GET', KEYS[1]) or ARGV[1])
local now, ei, burst = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local new_tat = math.max(tat, now) + ei
local allow_at = new_tat - burst - ei
if now < allow_at then return allow_at - now end
redis.call('SET', KEYS[1], new_tat, 'PX', math.ceil(new_tat - now))
return 0
~~~`,
  dia: r`flowchart LR
  C[Clients] --> E[Edge / API gateway]
  E -->|check key + IP| RL[Rate-limit module]
  RL --> R[(Redis cluster: GCRA state)]
  RL -->|rules| CFG[(Plan config cache)]
  E -->|allowed| S[Backend services]
  E -->|429 + Retry-After| C`,
  pts: [r`Token bucket or GCRA: exact rate, bounded burst, tiny state.`, r`Enforce at the edge so rejected traffic never reaches services.`, r`Redis Lua for atomic global checks, or local shares to avoid network hops.`, r`Decide fail-open vs fail-closed per endpoint.`, r`Return 429 with Retry-After and rate-limit headers.`],
  ex: r`A payments API moved limits from each service to the gateway with GCRA in Redis; bot traffic stopped reaching the database tier entirely.`,
  fu: [r`How do you rate limit across regions?`],
  pit: [r`Per-instance limits multiplied by instance count without adjustment.`] },

{ id: 'q9', level: 'Intermediate', tags: ['notification-system'],
  q: r`Design a notification system (email, SMS, push) for 50 million users.`,
  a: r`### Requirements
Multiple channels, user preferences and quiet hours, templates and localisation, priority (OTP vs marketing), retries, deduplication, rate limiting per user and provider, delivery tracking, auditing.

### Design
- **Ingestion API** for producer services: idempotent ({{notificationId}}), validated, writes to a queue per priority.
- **Preference service**: channel opt-ins, quiet hours, frequency caps (cached).
- **Template service**: versioned templates per locale.
- **Channel workers** per channel and priority, calling providers (SES/SendGrid, Twilio, FCM/APNs) through adapters with circuit breakers and failover providers.
- **Retry queues** with backoff; DLQ for permanent failures.
- **Tracking**: delivery receipts via provider webhooks, stored per notification; analytics events.
- **Priorities**: OTP/transactional on separate queues and capacity so marketing blasts cannot delay them.

Scale: a campaign to 50 M users is 50 M messages: fan out in batches, respect provider throughput (SMS often tens to hundreds per second per sender id).`,
  code: r`~~~csharp
public sealed record NotificationRequest(Guid NotificationId, Guid UserId, string Template, Priority Priority,
                                         IReadOnlyDictionary<string, string> Data, string? DedupeKey);
app.MapPost("/notifications", async (NotificationRequest n, INotificationStore store, IQueueRouter queues, CancellationToken ct) =>
{
    if (!await store.TryCreateAsync(n, ct)) return Results.Accepted();                 // idempotent by NotificationId / DedupeKey
    await queues.For(n.Priority).SendAsync(n, ct);                                      // separate queues: transactional vs marketing
    return Results.Accepted("/notifications/" + n.NotificationId);
});
~~~`,
  dia: r`flowchart LR
  P[Producer services] --> API[Notification API: idempotent]
  API --> QH[(High priority queue: OTP)]
  API --> QL[(Low priority queue: marketing)]
  QH & QL --> D[Dispatcher: preferences, quiet hours, templates]
  D --> EM[Email workers] --> SES[Email provider]
  D --> SM[SMS workers] --> TW[SMS provider + fallback]
  D --> PU[Push workers] --> FCM[FCM / APNs]
  SES & TW & FCM -->|receipts webhooks| TR[(Delivery tracking)]
  D -->|failed| RQ[(Retry / DLQ)]`,
  pts: [r`Idempotent ingestion and deduplication keys.`, r`Separate queues and capacity per priority so OTPs are never delayed by campaigns.`, r`Preferences, quiet hours and frequency caps before sending.`, r`Provider adapters with breakers and failover.`, r`Delivery tracking via webhooks; retries and DLQ.`],
  ex: r`A bank isolated OTP SMS onto a dedicated queue and provider route after a marketing campaign delayed login codes by 20 minutes.`,
  fu: [r`How do you schedule notifications in each user's time zone?`],
  pit: [r`One shared queue for OTPs and marketing.`] },

{ id: 'q10', level: 'Intermediate', tags: ['id-generation'],
  q: r`Design a unique ID generator for a distributed system. Compare UUIDs, database sequences, Snowflake IDs and ULID/UUIDv7.`,
  a: r`| Option | Ordered | Coordination | Size | Notes |
|---|---|---|---|---|
| UUIDv4 | no | none | 128-bit | Random: poor B-tree locality |
| DB sequence / identity | yes | the database | 64-bit | Simple; single point / bottleneck across shards |
| Ticket server (Flickr) | yes | central service | 64-bit | Two servers with odd/even for HA |
| Snowflake (time + worker id + sequence) | k-sorted | worker id assignment | 64-bit | ~4,096 ids/ms per worker; clock skew risk |
| ULID / UUIDv7 | time-ordered | none | 128-bit | Sortable, no coordination |

Choose by: need for ordering (index locality, pagination by id), size constraints (64-bit for some systems), coordination tolerance, and exposure (do not expose sequential ids publicly if enumeration is a risk).

Snowflake pitfalls: clock moving backwards (refuse or wait), worker-id uniqueness (lease from ZooKeeper/etcd or derive from pod ordinal), epoch choice.`,
  code: r`~~~csharp
public sealed class SnowflakeIds(int workerId)                  // 41 bits time | 10 bits worker | 12 bits sequence
{
    private static readonly long Epoch = new DateTimeOffset(2024, 1, 1, 0, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds();
    private long _lastMs = -1, _seq;
    private readonly Lock _gate = new();
    public long Next()
    {
        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (now < _lastMs) throw new InvalidOperationException("Clock moved backwards");
            if (now == _lastMs) { _seq = (_seq + 1) & 4095; if (_seq == 0) while ((now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) <= _lastMs) { } }
            else _seq = 0;
            _lastMs = now;
            return ((now - Epoch) << 22) | ((long)workerId << 12) | _seq;
        }
    }
}
var v7 = Guid.CreateVersion7();   // .NET 9: time-ordered 128-bit, no coordination
~~~`,
  pts: [r`UUIDv4 needs no coordination but hurts index locality.`, r`Sequences are simple but centralised.`, r`Snowflake gives 64-bit k-sorted ids with worker ids; watch clock skew.`, r`ULID/UUIDv7 are time-ordered with no coordination.`, r`Avoid exposing enumerable ids publicly.`],
  ex: r`A messaging platform used Snowflake ids so messages sorted by id matched send order, enabling cheap cursor pagination.`,
  fu: [r`How do you assign worker ids in Kubernetes?`],
  pit: [r`Ignoring clock rollback in Snowflake generators.`] },

{ id: 'q11', level: 'Intermediate', tags: ['database-choice'],
  q: r`How do you choose databases in a system design (relational, key-value, document, wide-column, search, time-series, graph)?`,
  a: r`Start from **access patterns and consistency needs**:

| Need | Choose |
|---|---|
| Transactions, constraints, ad hoc queries, money | Relational (PostgreSQL, SQL Server, Aurora) |
| Massive key lookups, predictable latency, serverless | Key-value (DynamoDB, Redis for ephemeral) |
| Flexible documents read by id, rich queries | Document (MongoDB, Cosmos DB) |
| Very high write throughput, time-ordered, multi-DC | Wide-column (Cassandra, ScyllaDB) |
| Full-text search, facets | Search engine (OpenSearch, Azure AI Search) |
| Metrics, ticks | Time-series (Prometheus, Timescale, InfluxDB) |
| Relationship traversals | Graph (Neo4j, Neptune) |
| Analytics over large history | Columnar warehouse / lakehouse |

Then consider team skills, operational burden (managed services), cost model, and data residency. Polyglot persistence is fine **per service**, but each extra engine costs expertise and operations; one relational database plus cache and search covers most products.`,
  code: r`~~~text
E-commerce example
Orders, payments, inventory       -> PostgreSQL (ACID, constraints, reporting)
Cart, sessions                    -> Redis (ephemeral, fast) with cart backup in PostgreSQL
Product catalogue (varied attrs)  -> PostgreSQL jsonb or MongoDB
Search                            -> OpenSearch fed by CDC
Clickstream                       -> Kafka -> data lake (Parquet) -> warehouse
~~~`,
  pts: [r`Start from access patterns and consistency needs.`, r`Relational for transactions and money; key-value for massive lookups.`, r`Search engines, time-series and graph stores for specialised queries.`, r`Consider skills, operations, cost and residency.`, r`Polyglot per service, but each engine has an operational cost.`],
  ex: r`A startup replaced four specialised databases with PostgreSQL plus Redis and OpenSearch, halving on-call load without losing features.`,
  fu: [r`When would you choose Cassandra over DynamoDB?`],
  pit: [r`Choosing NoSQL because it "scales" without access patterns.`] },

{ id: 'q12', level: 'Intermediate', tags: ['replication', 'partitioning'],
  q: r`Replication vs partitioning (sharding): what problems does each solve, and how do they combine?`,
  a: r`- **Replication**: copies of the same data on several nodes. Solves **availability** (failover), **read scaling** and **geographic latency**. Modes: single-leader (async/sync), multi-leader (conflicts), leaderless quorum (Dynamo-style R + W > N).
- **Partitioning/sharding**: splitting data across nodes so each holds a subset. Solves **write scaling** and **storage capacity**. Strategies: range (good for scans, risk of hot ranges), hash (even spread, no range scans), directory/lookup (flexible, extra hop), geographic.

Combined: each shard is a replica set (e.g. MongoDB, Redis Cluster, Cassandra, Citus).

Hard parts:

- Choosing a **shard key** that matches queries and spreads load (avoid hot partitions).
- **Cross-shard queries and transactions** (scatter-gather, sagas).
- **Rebalancing** when adding shards (consistent hashing, virtual shards).
- Replication lag and read-your-writes.`,
  code: r`~~~text
Leaderless quorum: N = 3 replicas, W = 2, R = 2 -> R + W > N -> reads overlap the latest write
Hash sharding: shard = hash(customer_id) % 256 virtual shards -> map virtual shards to 8 physical nodes
               adding node 9 moves ~1/9 of virtual shards, not every key
~~~`,
  dia: r`flowchart TB
  R[Router: shard = hash customer_id] --> S1
  R --> S2
  R --> S3
  subgraph S1[Shard 1]
    P1[(Primary)] --> R1a[(Replica)]
    P1 --> R1b[(Replica)]
  end
  subgraph S2[Shard 2]
    P2[(Primary)] --> R2a[(Replica)]
  end
  subgraph S3[Shard 3]
    P3[(Primary)] --> R3a[(Replica)]
  end`,
  pts: [r`Replication solves availability, read scaling and locality.`, r`Partitioning solves write scaling and capacity.`, r`Production systems combine them: each shard is a replica set.`, r`The shard key must match queries and spread load.`, r`Cross-shard operations and rebalancing are the hard parts.`],
  ex: r`A multi-tenant SaaS sharded by tenant id into 256 virtual shards over 8 database clusters, moving tenants between clusters without application changes.`,
  fu: [r`Range vs hash partitioning for time-series data?`],
  pit: [r`Sharding by a monotonically increasing key, creating a hot shard.`] },

{ id: 'q13', level: 'Intermediate', tags: ['message-queue', 'kafka'],
  q: r`Queue vs log (RabbitMQ/SQS vs Kafka): how do you choose in a system design?`,
  a: r`| | Queue (RabbitMQ, SQS, Service Bus) | Log (Kafka, Kinesis, Event Hubs) |
|---|---|---|
| Model | Messages consumed and removed | Append-only, retained by time/size |
| Consumers | Competing consumers per queue | Consumer groups, each reads the full stream |
| Replay | No (once acknowledged) | Yes, reset offsets |
| Ordering | Per queue/session (with limits) | Per partition |
| Routing | Rich (exchanges, filters) | Topics + keys |
| Typical use | Commands, task distribution, work queues | Event streams, many consumers, analytics, CDC |

Choose a **queue** for task distribution with per-message acknowledgement, delays, priorities and DLQs. Choose a **log** when multiple independent consumers need the same events, you need replay (rebuilding projections), high throughput, or stream processing. Many platforms run both.`,
  code: r`~~~csharp
// Command to one worker: queue (Azure Service Bus)
await sender.SendMessageAsync(new ServiceBusMessage(BinaryData.FromObjectAsJson(new GenerateStatement(accountId, month)))
{ MessageId = commandId.ToString(), SessionId = accountId.ToString() }, ct);
// Fact for many consumers: log (Kafka), keyed for per-entity ordering
await producer.ProduceAsync("payments.events.v1", new Message<string, string> { Key = paymentId, Value = json }, ct);
~~~`,
  dia: r`flowchart LR
  subgraph Queue[Queue: competing consumers]
    Q[(Queue)] --> W1[Worker 1]
    Q --> W2[Worker 2]
  end
  subgraph Log[Log: independent consumer groups]
    T[(Topic partitions)] --> G1[Billing group]
    T --> G2[Analytics group]
    T --> G3[Search indexer group]
  end`,
  pts: [r`Queues distribute tasks; messages disappear after acknowledgement.`, r`Logs retain events for many consumer groups and replay.`, r`Queues offer routing, delays, priorities and DLQs.`, r`Logs offer throughput, ordering per partition and stream processing.`, r`Many platforms use both: commands on queues, facts on logs.`],
  ex: r`A bank used Service Bus for statement-generation commands and Kafka for payment events consumed by eight downstream systems.`,
  fu: [r`How do you get ordering in a queue system?`],
  pit: [r`Using Kafka as a delayed task queue.`] },

{ id: 'q14', level: 'Intermediate', tags: ['api-design', 'gateway'],
  q: r`Design the API layer of a large system: gateway, BFFs, versioning, authentication and rate limiting.`,
  a: r`- **Edge**: CDN/WAF for DDoS protection, TLS termination, bot management.
- **API gateway**: routing, authentication (validate tokens), coarse authorisation (scopes), quotas/rate limits, request size limits, request ids. No business logic.
- **BFFs** per client type (web, mobile, partners): shape responses, aggregate calls, handle client-specific auth (cookie sessions for SPAs).
- **Services**: fine-grained authorisation (object ownership), validation, business logic.
- **Contracts**: OpenAPI/AsyncAPI, versioning policy (additive changes, deprecation with Sunset headers), consumer-driven contract tests.
- **Cross-cutting**: idempotency keys for writes, pagination standards, ProblemDetails errors, correlation ids propagated end to end.`,
  code: r`~~~http
POST /v1/payments HTTP/1.1
Authorization: Bearer eyJ...
Idempotency-Key: 6f1c...
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01

HTTP/1.1 201 Created
Location: /v1/payments/pay_981
RateLimit-Limit: 1000
RateLimit-Remaining: 997
~~~`,
  dia: r`flowchart LR
  WEB[Web SPA] --> CDN[CDN + WAF]
  MOB[Mobile] --> CDN
  PART[Partners] --> CDN
  CDN --> GW[API gateway: authN, scopes, quotas]
  GW --> BW[Web BFF]
  GW --> BM[Mobile BFF]
  GW --> PAPI[Partner API]
  BW & BM & PAPI --> S1[Orders]
  BW & BM & PAPI --> S2[Payments]
  BW & BM --> S3[Catalog]`,
  pts: [r`Edge: CDN, WAF, DDoS protection, TLS.`, r`Gateway: authentication, scopes, quotas; no business logic.`, r`BFFs per client type shape and aggregate.`, r`Services own fine-grained authorisation and rules.`, r`Standard contracts: versioning, idempotency, errors, pagination, tracing.`],
  ex: r`Introducing BFFs let the mobile team cut home-screen calls from 9 to 1 while partners kept a stable, versioned API.`,
  fu: [r`How do you prevent the gateway becoming a bottleneck team?`],
  pit: [r`Business rules creeping into gateway plugins.`] },

{ id: 'q15', level: 'Intermediate', tags: ['observability'],
  q: r`What observability do you design into a system from day one?`,
  a: r`- **SLOs** for key user journeys (availability and latency), with error budgets.
- **Metrics**: RED per service (rate, errors, duration), USE for resources (utilisation, saturation, errors), business metrics (orders/min, payments declined by reason), queue depths and consumer lag.
- **Distributed tracing** with W3C trace context across HTTP and messaging (OpenTelemetry), sampling strategy (head plus tail for errors/slow requests).
- **Structured logs** with trace ids, tenant/order ids; no PII; retention by class.
- **Dashboards** per journey and per service; **alerts** on SLO burn rates and symptoms rather than raw CPU.
- **Synthetic monitoring** of critical flows from outside.
- **Audit logs** separate from operational logs.

Bake into templates and shared libraries so every service emits the same signals.`,
  code: r`~~~yaml
# SLO burn-rate alert (Prometheus): 2% of a 30-day error budget burned in 1 hour
- alert: CheckoutSLOFastBurn
  expr: |
    (sum(rate(http_server_request_duration_seconds_count{route="/checkout",http_response_status_code=~"5.."}[1h]))
      / sum(rate(http_server_request_duration_seconds_count{route="/checkout"}[1h]))) > (14.4 * 0.001)
  for: 5m
  labels: { severity: page }
~~~`,
  dia: r`flowchart LR
  SVC[Services: OTel SDK] -->|OTLP| COL[OpenTelemetry Collector]
  COL --> M[(Metrics: Prometheus/Mimir)]
  COL --> T[(Traces: Tempo/Jaeger)]
  COL --> L[(Logs: Loki/Elastic)]
  M & T & L --> G[Dashboards + SLO alerts]
  SYN[Synthetic checks] --> G`,
  pts: [r`Define SLOs per journey with error budgets.`, r`RED, USE and business metrics.`, r`Distributed tracing across HTTP and messages.`, r`Structured logs without PII, linked by trace id.`, r`Alert on SLO burn rate; bake into templates.`],
  ex: r`Burn-rate alerting replaced 40 noisy CPU and memory alerts and still caught every customer-impacting incident earlier.`,
  fu: [r`How do you trace across Kafka?`],
  pit: [r`Alerting on CPU instead of user-facing symptoms.`] },

{ id: 'q16', level: 'Intermediate', tags: ['file-storage'],
  q: r`Design a file storage and sharing service (like Dropbox/OneDrive) at a high level.`,
  a: r`### Core flows
Upload, download, sync across devices, share, version history.

### Design
- **Metadata service** (relational): files, folders, versions, permissions, sharing links; strongly consistent.
- **Block storage**: files split into chunks (e.g. 4 MB), each identified by its **content hash**; stored in object storage (S3/Blob). Deduplication across users and versions: identical chunks stored once.
- **Upload**: client chunks the file, asks which chunk hashes are missing, uploads only those directly to object storage via **pre-signed URLs**, then commits the new version in metadata.
- **Sync**: devices subscribe to change notifications (long polling/WebSocket) and fetch changed metadata, then download missing chunks.
- **Conflicts**: concurrent edits create conflicted copies (or last-writer-wins with version history).
- **Security**: encryption at rest, per-tenant keys for enterprise, malware scanning, audit of sharing.
- **CDN** for downloads of popular shared files.`,
  code: r`~~~csharp
app.MapPost("/files/{fileId}/versions/prepare", async (Guid fileId, PrepareUpload req, IChunkIndex chunks, IBlobPresigner presigner) =>
{
    var missing = await chunks.MissingAsync(req.ChunkHashes);                       // dedupe: only new chunks are uploaded
    var urls = missing.ToDictionary(h => h, h => presigner.PutUrl("chunks/" + h, TimeSpan.FromMinutes(15)));
    return Results.Ok(new { uploadUrls = urls });
});
app.MapPost("/files/{fileId}/versions", async (Guid fileId, CommitVersion req, MetadataDb db) =>
{
    db.Versions.Add(new FileVersion(fileId, req.Version, req.ChunkHashes, req.Size, req.Sha256));   // atomic metadata commit
    await db.SaveChangesAsync();
    return Results.Created("/files/" + fileId + "/versions/" + req.Version, null);
});
~~~`,
  dia: r`flowchart LR
  CL[Desktop/mobile client: chunk + hash] -->|1 which chunks missing?| META[Metadata service]
  META --> MDB[(Metadata DB: files, versions, ACLs)]
  CL -->|2 upload missing chunks via pre-signed URLs| OBJ[(Object storage: chunks by hash)]
  CL -->|3 commit version| META
  META -->|change events| NOTIF[Notification service] -->|WebSocket| OTHER[Other devices]
  OTHER -->|download chunks| CDN[CDN] --> OBJ`,
  pts: [r`Separate strongly consistent metadata from bulk chunk storage.`, r`Content-hashed chunks give deduplication and resumable uploads.`, r`Clients upload directly to object storage via pre-signed URLs.`, r`Change notifications drive sync across devices.`, r`Handle conflicts and keep version history; encrypt and audit.`],
  ex: r`Chunk-level dedupe meant re-uploading a 2 GB file with a small edit transferred only two 4 MB chunks.`,
  fu: [r`How do you implement delta sync for very large files?`],
  pit: [r`Streaming file bytes through the API servers.`] },

{ id: 'q17', level: 'Intermediate', tags: ['chat'],
  q: r`Design a chat system (1:1 and group chat) for 10 million concurrent users.`,
  a: r`### Requirements
Real-time delivery, ordering per conversation, history, delivery/read receipts, presence, push notifications for offline users, groups up to a few thousand.

### Design
- **Connection gateways** holding WebSocket connections (each ~100K to 500K connections tuned); a **session registry** maps user -> gateway (Redis).
- **Message service**: assigns per-conversation sequence numbers (ordering), persists, then routes to recipients' gateways or to push notifications if offline.
- **Storage**: wide-column store (Cassandra/ScyllaDB) partitioned by conversation id, clustered by message id/time: efficient "latest N messages" and writes at scale.
- **Fan-out**: for groups, the message is stored once; delivery fans out to online members via their gateways.
- **Presence**: heartbeats with TTL in Redis; publish changes only to interested contacts (throttled).
- **Idempotency**: client message ids to deduplicate retries; acknowledgements per hop.
- **Multi-region**: users connect to the nearest region; cross-region routing for conversations spanning regions.`,
  code: r`~~~csharp
public sealed class ChatHub(IMessageService messages) : Hub
{
    public async Task Send(Guid conversationId, Guid clientMessageId, string text)
    {
        var msg = await messages.AppendAsync(conversationId, Context.UserIdentifier!, clientMessageId, text);   // idempotent, seq assigned
        await Clients.Group("conv:" + conversationId).SendAsync("message", msg);                              // fan-out to online members
    }
}
~~~
~~~sql
-- Cassandra: messages partitioned by conversation, newest first
CREATE TABLE messages (conversation_id uuid, message_id timeuuid, sender_id uuid, body text,
  PRIMARY KEY ((conversation_id), message_id)) WITH CLUSTERING ORDER BY (message_id DESC);
~~~`,
  dia: r`flowchart LR
  A[Client A] -->|WebSocket| G1[Gateway 1]
  B[Client B] -->|WebSocket| G2[Gateway 2]
  G1 --> MS[Message service: seq + persist]
  MS --> CS[(Cassandra: messages by conversation)]
  MS --> REG[(Redis: user -> gateway, presence)]
  MS -->|route| G2
  MS -->|offline| PN[Push notifications]`,
  pts: [r`Gateways hold WebSocket connections; a registry maps users to gateways.`, r`Per-conversation sequence numbers give ordering.`, r`Wide-column storage partitioned by conversation.`, r`Fan-out to online members; push to offline users.`, r`Client message ids make retries idempotent.`],
  ex: r`A support-chat platform moved message storage to Cassandra partitioned by conversation and kept p99 history loads under 30 ms at billions of messages.`,
  fu: [r`How do you handle very large groups (100K members)?`],
  pit: [r`Global ordering across all conversations.`] },

{ id: 'q18', level: 'Intermediate', tags: ['search-autocomplete'],
  q: r`Design search autocomplete (typeahead) for a site with 50 million searches per day.`,
  a: r`### Requirements
Top 5 to 10 suggestions per prefix, p99 < 50 ms, popularity-ranked, updated daily (or near real time for trending), personalised optionally.

### Design
- **Data collection**: search logs streamed to a data pipeline; aggregate query frequencies (with decay for recency) in batch (daily) or streaming (trending).
- **Index build**: a trie (or prefix -> top-K table) where each node stores its top-K completions; built offline and published as an immutable snapshot.
- **Serving**: autocomplete service loads the snapshot in memory (sharded by prefix range if large); results cached at the CDN/edge for popular prefixes.
- **Client**: debounce keystrokes (100 to 200 ms), cancel stale requests, cache recent results.
- **Filtering**: remove offensive or sensitive suggestions; respect locale.

Estimate: 50 M searches x ~5 keystrokes = 250 M requests/day ≈ 3,000 QPS avg, ~10,000 peak: in-memory lookups handle it on few nodes; CDN absorbs much more.`,
  code: r`~~~csharp
// Serving from an immutable prefix -> top-K map, swapped atomically when a new build is published
private FrozenDictionary<string, string[]> _index = FrozenDictionary<string, string[]>.Empty;
app.MapGet("/suggest", (string q, HttpContext http) =>
{
    var key = q.Trim().ToLowerInvariant();
    if (key.Length is 0 or > 50) return Results.Ok(Array.Empty<string>());
    http.Response.Headers.CacheControl = "public, max-age=300";
    return Results.Ok(Volatile.Read(ref _index).GetValueOrDefault(key, []));
});
public void Publish(IEnumerable<(string Prefix, string[] Top)> build) =>
    Interlocked.Exchange(ref _index, build.ToFrozenDictionary(x => x.Prefix, x => x.Top));
~~~`,
  dia: r`flowchart LR
  U[Browser: debounce 150ms] --> CDN[CDN cache by prefix]
  CDN -->|miss| AC[Autocomplete service: in-memory prefix -> top K]
  LOGS[Search logs] --> K[Kafka] --> AGG[Daily + trending aggregation]
  AGG --> BUILD[Index builder] -->|snapshot| S3[(Object storage)]
  S3 -->|load + atomic swap| AC`,
  pts: [r`Aggregate query popularity offline (daily) and streaming (trending).`, r`Store top-K completions per prefix; build offline.`, r`Serve from memory with atomic snapshot swaps.`, r`Cache popular prefixes at the CDN; debounce on the client.`, r`Filter sensitive suggestions; localise.`],
  ex: r`Precomputed per-prefix top-10 lists served from memory delivered 4 ms p99, with 70% of requests answered by the CDN.`,
  fu: [r`How do you personalise suggestions without losing cacheability?`],
  pit: [r`Running LIKE 'prefix%' queries against the search database per keystroke.`] },

{ id: 'q19', level: 'Senior', tags: ['payment-system'],
  q: r`Design a payment system for an e-commerce platform (pay-in via card processors, pay-out to sellers).`,
  a: r`### Scope (clarify)
Card payments via a PSP (Stripe/Adyen) with hosted payment fields (keeps us mostly out of PCI scope); multi-currency display, settlement in one currency; pay-outs to sellers; refunds. ~1 M payments/day ≈ 12 TPS: **correctness, not throughput, is the design driver.**

### Components
- **Payment service**: payment intents and state machine ({{CREATED -> AUTHORISED -> CAPTURED -> SETTLED}}, plus {{FAILED}}, {{REFUNDED}}), idempotency keys.
- **PSP adapters**: call the processor with our idempotency key; handle 3-D Secure redirects; receive **webhooks** (deduplicated by event id).
- **Ledger**: double-entry, append-only; every money movement posts balanced entries (customer, merchant/seller, fees, PSP receivable).
- **Wallet/balance** per seller derived from the ledger.
- **Pay-out service**: scheduled transfers to sellers' bank accounts via a pay-out provider, with holds and risk checks.
- **Reconciliation**: daily settlement files from the PSP and bank statements matched against the ledger; breaks investigated.
- **Outbox/events** to notify orders, notifications and analytics.

### Exactly-once effects
At-least-once delivery + idempotency at every hop (API key, PSP idempotency key, webhook event ids, ledger unique journal keys) + reconciliation as the backstop.`,
  code: r`~~~sql
CREATE TABLE payments (
  id uuid PRIMARY KEY, order_id uuid NOT NULL, idempotency_key text NOT NULL UNIQUE,
  amount_minor bigint NOT NULL, currency char(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('CREATED','AUTHORISED','CAPTURED','SETTLED','FAILED','REFUNDED')),
  psp text NOT NULL, psp_reference text NULL, version int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ledger_entries (
  journal_id uuid NOT NULL, account text NOT NULL, amount_minor bigint NOT NULL, currency char(3) NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (journal_id, account));   -- each journal sums to zero
CREATE TABLE psp_webhook_inbox (event_id text PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL);
~~~`,
  dia: r`flowchart LR
  CK[Checkout] -->|Idempotency-Key| PS[Payment service]
  PS --> PDB[(Payments DB + outbox)]
  PS -->|create/confirm, idempotency key| PSP[PSP adapter] --> EXT[Stripe / Adyen]
  EXT -->|webhooks| WH[Webhook handler: inbox dedupe] --> PS
  PS -->|post journals| LED[(Double-entry ledger)]
  LED --> WAL[Seller balances]
  WAL --> PO[Pay-out service] --> BANK[Pay-out provider / bank]
  SETTLE[PSP settlement files + bank statements] --> REC[Reconciliation] --> LED
  PDB -->|outbox| EV[Events: orders, notifications]`,
  pts: [r`At ~12 TPS, correctness is the driver, not throughput.`, r`Payment state machine with idempotency keys at every hop.`, r`Double-entry, append-only ledger for every money movement.`, r`Webhooks deduplicated; hosted fields minimise PCI scope.`, r`Daily reconciliation against PSP and bank files is mandatory.`],
  ex: r`A marketplace found 0.03% of payments in an unknown state after PSP timeouts; status queries plus nightly reconciliation resolved every one without double charges.`,
  fu: [r`What do you do when the PSP times out during capture?`, r`How do you handle FX for multi-currency pay-ins?`],
  pit: [r`Storing amounts as floating point.`, r`Treating the PSP's idempotency as a reason to skip reconciliation.`],
  tip: r`State "exactly-once = at-least-once + idempotency" and show the idempotency key at each hop. That is what payment-system interviewers look for.` },

{ id: 'q20', level: 'Senior', tags: ['ledger', 'wallet'],
  q: r`Design a digital wallet (balances, top-ups, P2P transfers) that never loses or creates money.`,
  a: r`### Invariants
Balances never negative (unless overdraft allowed); every transfer debits one account and credits another atomically; history immutable and auditable; operations idempotent.

### Design
- **Ledger as source of truth**: double-entry journal with entries per account; balance = sum of entries (cached in a balance table updated in the same transaction).
- **Transfer**: in one database transaction, insert the journal (unique idempotency key), conditionally debit the source ({{balance >= amount}}), credit the destination, lock accounts in a consistent order (by id) to avoid deadlocks.
- **Scale**: partition accounts by id; transfers across partitions become a two-step saga (debit with a hold/pending entry, credit, then finalise) or use a database supporting distributed transactions (Spanner/CockroachDB). Hot accounts (merchant) use sub-accounts.
- **Top-ups/withdrawals**: external rails with pending states and reconciliation.
- **Event sourcing** is a natural fit (journal = event log), with snapshots for balances.
- **Audit**: append-only tables, no UPDATE/DELETE grants, daily balance proofs (sum of balances = sum of entries).`,
  code: r`~~~sql
BEGIN;
  INSERT INTO journals (id, idempotency_key, type) VALUES ($1, $2, 'P2P');            -- unique key: retry-safe
  UPDATE balances SET amount = amount - $amt, version = version + 1
   WHERE account_id = $from AND amount >= $amt;                                          -- 0 rows -> insufficient funds -> ROLLBACK
  UPDATE balances SET amount = amount + $amt, version = version + 1 WHERE account_id = $to;
  INSERT INTO entries (journal_id, account_id, amount) VALUES ($1, $from, -$amt), ($1, $to, $amt);   -- sums to zero
COMMIT;
-- Daily proof
SELECT (SELECT SUM(amount) FROM balances) = (SELECT SUM(amount) FROM entries) AS balanced;
~~~`,
  dia: r`sequenceDiagram
  participant C as Client
  participant W as Wallet API
  participant DB as Ledger DB
  C->>W: POST /transfers (Idempotency-Key)
  W->>DB: BEGIN
  W->>DB: insert journal (unique key)
  W->>DB: debit source if balance >= amount
  W->>DB: credit destination
  W->>DB: insert balanced entries
  W->>DB: COMMIT
  W-->>C: 201 transfer id
  Note over DB: nightly: sum(balances) == sum(entries)`,
  pts: [r`The double-entry ledger is the source of truth; balances are derived and cached.`, r`One transaction: idempotent journal, conditional debit, credit, balanced entries.`, r`Lock accounts in consistent order to avoid deadlocks.`, r`Cross-partition transfers become sagas with holds; hot accounts get sub-accounts.`, r`Append-only data and daily balance proofs.`],
  ex: r`A wallet startup's nightly proof caught a bug where a reversal path updated the balance without writing entries, before customers noticed.`,
  fu: [r`How would you scale to 50,000 transfers per second?`],
  pit: [r`Updating balances without journal entries.`] },

{ id: 'q21', level: 'Senior', tags: ['news-feed'],
  q: r`Design a news feed (social or activity feed) for 100 million users. Fan-out on write or on read?`,
  a: r`- **Fan-out on write (push)**: when a user posts, write the post id into each follower's feed cache. Reads are instant; writes cost proportional to followers. Problematic for celebrities with millions of followers.
- **Fan-out on read (pull)**: build the feed at read time by merging recent posts from followees. Cheap writes; expensive reads for users following many accounts.
- **Hybrid** (what large platforms do): push for normal users; for "celebrity" accounts, pull their posts at read time and merge.

Other components:

- **Feed store**: per-user list of post ids (Redis sorted sets or Cassandra), capped (e.g. 800 latest).
- **Post store**: posts by id (KV/document), media in object storage + CDN.
- **Ranking**: optional ML ranking service over candidate posts.
- **Pagination**: cursor by score/time.
- **Async fan-out workers** consuming post events from Kafka.`,
  code: r`~~~csharp
public async Task OnPostCreated(PostCreated e, CancellationToken ct)
{
    if (await _social.FollowerCountAsync(e.AuthorId, ct) > 100_000) return;      // celebrity: pulled at read time
    await foreach (var batch in _social.FollowersAsync(e.AuthorId, batchSize: 1000, ct))
    {
        var b = _redis.CreateBatch();
        foreach (var f in batch)
        {
            _ = b.SortedSetAddAsync("feed:" + f, e.PostId, e.CreatedAt.ToUnixTimeMilliseconds());
            _ = b.SortedSetRemoveRangeByRankAsync("feed:" + f, 0, -801);        // keep the latest 800
        }
        b.Execute();
    }
}
~~~`,
  dia: r`flowchart LR
  P[User posts] --> PS[Post service] --> PDB[(Post store)]
  PS --> K[(Kafka post events)] --> FO[Fan-out workers]
  FO -->|normal authors| FC[(Feed cache per user)]
  R[Read feed] --> FS[Feed service]
  FS --> FC
  FS -->|celebrity followees| PDB
  FS --> RANK[Ranking] --> R`,
  pts: [r`Push gives fast reads, costly writes; pull is the opposite.`, r`Hybrid: push for normal users, pull for celebrities.`, r`Feeds store capped lists of post ids.`, r`Asynchronous fan-out from a post event stream.`, r`Cursor pagination and optional ranking.`],
  ex: r`An internal enterprise activity feed used push fan-out except for company-wide announcement accounts, which were merged at read time.`,
  fu: [r`How do you handle a user unfollowing someone?`],
  pit: [r`Pure push fan-out for accounts with millions of followers.`] },

{ id: 'q22', level: 'Senior', tags: ['ticket-booking', 'concurrency'],
  q: r`Design a ticket booking system for a big concert (1 million users competing for 50,000 seats).`,
  a: r`### Hard problems
A massive burst at on-sale time; no double-selling; fairness; holding seats while users pay.

### Design
- **Virtual waiting room**: admit users at a controlled rate (queue tokens) so backend load is bounded; protects the inventory system and gives fairness.
- **Seat inventory** in a strongly consistent store: reserve with a **conditional update** ({{status = 'AVAILABLE'}} -> {{HELD}} with {{held_until}}); unique constraints prevent double booking. For general admission, a counter decremented conditionally.
- **Holds with TTL** (e.g. 10 minutes); a sweeper releases expired holds; payment must complete within the hold.
- **Payment**: idempotent; on success convert HELD -> SOLD in a transaction; on failure release.
- **Read path**: seat maps served from cache, refreshed frequently; final check happens at reservation.
- **Bot protection**: CAPTCHA, device fingerprinting, purchase limits per account.`,
  code: r`~~~sql
-- Hold a seat atomically; zero rows means someone else got it
UPDATE seats SET status = 'HELD', held_by = $user, held_until = now() + interval '10 minutes', version = version + 1
WHERE event_id = $event AND seat_id = $seat AND (status = 'AVAILABLE' OR (status = 'HELD' AND held_until < now()));
-- Confirm after payment
UPDATE seats SET status = 'SOLD', order_id = $order WHERE event_id = $event AND seat_id = $seat AND status = 'HELD' AND held_by = $user;
~~~`,
  dia: r`flowchart LR
  U[1M users] --> WR[Virtual waiting room: admits N/sec]
  WR --> API[Booking API]
  API --> SC[(Seat map cache)]
  API -->|conditional hold| INV[(Seat inventory: strongly consistent)]
  API --> PAY[Payment service]
  PAY -->|success| INV
  SW[Hold sweeper] -->|release expired holds| INV`,
  pts: [r`A waiting room bounds load and adds fairness.`, r`Conditional updates make double booking impossible.`, r`Holds with TTL and a sweeper.`, r`Idempotent payment converts holds to sales atomically.`, r`Cache seat maps but check at reservation; fight bots.`],
  ex: r`A ticketing platform's waiting room admitted 2,000 users per second, keeping the inventory database at steady load while 800,000 users queued.`,
  fu: [r`How do you choose the admission rate?`],
  pit: [r`Read-then-write seat checks without atomic conditions.`] },

{ id: 'q23', level: 'Senior', tags: ['distributed-cache'],
  q: r`Design a distributed cache (like a simplified Redis Cluster or Memcached tier).`,
  a: r`### Requirements
GET/SET/DELETE with TTL, millions of ops/s, sub-millisecond latency, horizontal scaling, failover.

### Design
- **Partitioning**: consistent hashing (ring with virtual nodes) or fixed hash slots (16,384 like Redis) mapped to nodes; clients or a proxy route keys.
- **Node internals**: in-memory hash table, LRU/LFU eviction with memory limits, TTL via lazy + periodic expiry, single-threaded event loop or sharded locks.
- **Replication**: each shard has replicas (async); failover via a coordinator (Sentinel-like) or consensus (etcd) for membership.
- **Cluster membership**: gossip or a config service; clients refresh slot maps on MOVED-style redirects.
- **Hot keys**: client-side L1 caching, key replication.
- **Operations**: monitoring hit ratio, memory, evictions; rolling upgrades; resharding by moving slots.

Clarify durability: a cache may lose data on failover; anything requiring durability belongs elsewhere.`,
  code: r`~~~csharp
// Client-side routing with fixed slots (Redis-like): slot -> node map refreshed on redirect
public sealed class SlotRouter(IReadOnlyList<CacheNode> nodes)
{
    private CacheNode[] _slotMap = Enumerable.Range(0, 16384).Select(i => nodes[i * nodes.Count / 16384]).ToArray();
    public CacheNode NodeFor(string key) => _slotMap[Crc16(HashTagOrKey(key)) % 16384];
    public void OnMoved(int slot, CacheNode newOwner) => _slotMap[slot] = newOwner;    // update after resharding
    private static string HashTagOrKey(string k) { var s = k.IndexOf('{'); var e = k.IndexOf('}', s + 1); return s >= 0 && e > s + 1 ? k[(s + 1)..e] : k; }
    private static int Crc16(string s) => (int)(System.IO.Hashing.Crc32.HashToUInt32(Encoding.UTF8.GetBytes(s)) & 0x3FFF);   // illustrative
}
~~~`,
  dia: r`flowchart LR
  APP[App with client library: slot map] --> N1[(Node A: slots 0-5460)]
  APP --> N2[(Node B: slots 5461-10922)]
  APP --> N3[(Node C: slots 10923-16383)]
  N1 --> N1R[(Replica A)]
  N2 --> N2R[(Replica B)]
  N3 --> N3R[(Replica C)]
  CFG[Membership / failover coordinator] -.-> N1 & N2 & N3`,
  pts: [r`Partition with consistent hashing or fixed slots.`, r`In-memory hash table with eviction and TTL handling.`, r`Async replicas with coordinated failover.`, r`Clients route by slot map and refresh on redirects.`, r`Handle hot keys; never treat the cache as durable.`],
  ex: r`Moving from mod-N sharding to fixed slots let a team add cache nodes during peak without a cold-cache storm.`,
  fu: [r`How do you reshard live?`],
  pit: [r`Storing data that must survive in a cache tier.`] },

{ id: 'q24', level: 'Senior', tags: ['key-value-store'],
  q: r`Design a highly available key-value store (Dynamo-style).`,
  a: r`### Requirements
put/get, high availability and partition tolerance, tunable consistency, horizontal scale, multi-datacenter.

### Design (Dynamo principles)
- **Partitioning** with consistent hashing and virtual nodes.
- **Replication** to N successor nodes on the ring (N = 3), across racks/AZs.
- **Quorums**: write to W, read from R; R + W > N gives read-your-writes in the absence of failures; choose W=1/R=1 for latency, W=2/R=2 for stronger reads.
- **Conflict handling**: vector clocks (or last-writer-wins with timestamps) detect concurrent writes; clients or CRDTs resolve.
- **Sloppy quorum and hinted handoff** keep writes available during node failures.
- **Anti-entropy** with Merkle trees repairs divergent replicas; read repair on reads.
- **Membership/failure detection** via gossip.
- **Storage engine**: LSM-tree (memtable + SSTables + compaction, Bloom filters).`,
  code: r`~~~text
N=3, W=2, R=2  (R + W > N)
put(k, v): coordinator sends to 3 replicas, acknowledges client after 2 acks
get(k):    coordinator reads 2 replicas; if versions differ -> return latest (or siblings) and read-repair the stale one
Node down: write goes to the next healthy node with a "hint" -> handed back when the owner recovers
~~~`,
  dia: r`flowchart LR
  C[Client] --> CO[Coordinator node]
  CO -->|write| R1[(Replica 1)]
  CO -->|write| R2[(Replica 2)]
  CO -->|write| R3[(Replica 3)]
  R1 -. gossip .- R2
  R2 -. gossip .- R3
  R1 -. Merkle anti-entropy .- R3`,
  pts: [r`Consistent hashing with virtual nodes for partitioning.`, r`Replicate to N nodes across failure domains.`, r`Tunable quorums: R + W > N for stronger reads.`, r`Vector clocks or LWW for conflicts; hinted handoff for availability.`, r`Merkle-tree anti-entropy and read repair; LSM storage.`],
  ex: r`Tuning a Cassandra keyspace from QUORUM to LOCAL_QUORUM removed cross-region latency from writes while keeping per-region consistency.`,
  fu: [r`Why can last-writer-wins lose data?`],
  pit: [r`Assuming quorum reads give linearisability under all failures.`] },

{ id: 'q25', level: 'Senior', tags: ['metrics-monitoring'],
  q: r`Design a metrics monitoring and alerting system (like a simplified Prometheus/Datadog).`,
  a: r`### Requirements
Ingest millions of data points per second from many hosts, store with retention and downsampling, query/visualise, alert reliably.

### Design
- **Collection**: agents or SDKs push via OTLP, or a scraper pulls (Prometheus model); buffering at agents for resilience.
- **Ingestion**: stateless receivers -> Kafka (buffer, replay) -> writers.
- **Storage**: time-series database partitioned by series hash and time blocks; compression (delta-of-delta, XOR); inverted index on labels; **cardinality limits** per tenant.
- **Downsampling**: raw for 15 days, 1-minute rollups for 13 months, hourly for years.
- **Query layer**: fan-out across shards, merge, cache.
- **Alerting**: rule evaluator running queries on schedules, deduplication and grouping, routing (PagerDuty, Slack), silences, escalation; the alerting path must be more reliable than what it monitors (separate failure domain, meta-monitoring).`,
  code: r`~~~yaml
# Alert rule evaluated every 30 s; grouped and routed by the alert manager
groups:
  - name: payments
    rules:
      - alert: PaymentsDeclineRateHigh
        expr: sum(rate(payments_declined_total[5m])) / sum(rate(payments_attempted_total[5m])) > 0.15
        for: 10m
        labels: { severity: page, team: payments }
        annotations: { runbook: "https://runbooks.internal/payments/decline-rate" }
~~~`,
  dia: r`flowchart LR
  H[Hosts / services: OTel agents] --> RX[Ingestion receivers]
  RX --> K[(Kafka buffer)]
  K --> W[TSDB writers] --> TS[(Time-series store: compressed blocks + label index)]
  TS --> DS[Downsampler] --> TS
  Q[Query service] --> TS
  DASH[Dashboards] --> Q
  AE[Alert evaluator] --> Q
  AE --> AM[Alert manager: dedupe, route, silence] --> PG[PagerDuty / Slack]`,
  pts: [r`Buffer ingestion through a durable queue.`, r`Compress time-series and index labels; cap cardinality.`, r`Downsample with tiered retention.`, r`Fan-out queries across shards.`, r`Alerting needs its own failure domain and meta-monitoring.`],
  ex: r`A cardinality explosion (user ids as labels) took down a self-hosted Prometheus; per-tenant series limits and relabelling prevented a repeat.`,
  fu: [r`Push vs pull collection: trade-offs?`],
  pit: [r`Unbounded label cardinality.`] },

{ id: 'q26', level: 'Senior', tags: ['job-scheduler'],
  q: r`Design a distributed job scheduler (cron-like and on-demand jobs, millions of jobs per day).`,
  a: r`### Requirements
Schedule one-off and recurring jobs, execute at-least-once with idempotency, retries with backoff, priorities, visibility (status, logs), multi-tenant fairness, no single point of failure.

### Design
- **Job store** (relational): job definitions, schedules (cron + time zone), next run time, state.
- **Scheduler**: partitioned pollers claim due jobs with {{FOR UPDATE SKIP LOCKED}} (or leases), compute next run for recurring jobs, and enqueue executions. Use a time-bucketed index ({{next_run_at}}) for efficient polling.
- **Execution queue** per priority/tenant; **workers** pull, execute with timeouts and heartbeats; long jobs extend leases.
- **Retries**: exponential backoff, max attempts, DLQ.
- **Exactly-once effects**: idempotent job handlers keyed by execution id.
- **Misfire policy**: run once on recovery, skip, or catch up.
- **Observability**: execution history, durations, failure rates.`,
  code: r`~~~sql
-- Claim due jobs without contention between scheduler instances
WITH due AS (
  SELECT id FROM jobs
  WHERE next_run_at <= now() AND status = 'SCHEDULED'
  ORDER BY next_run_at LIMIT 500
  FOR UPDATE SKIP LOCKED)
UPDATE jobs j SET status = 'ENQUEUED', locked_by = $instance, locked_until = now() + interval '1 minute'
FROM due WHERE j.id = due.id
RETURNING j.id, j.type, j.payload, j.cron, j.time_zone;
~~~`,
  dia: r`flowchart LR
  API[Job API] --> JS[(Job store: next_run_at index)]
  S1[Scheduler 1] -->|SKIP LOCKED claim| JS
  S2[Scheduler 2] -->|SKIP LOCKED claim| JS
  S1 & S2 --> Q[(Execution queues by priority)]
  Q --> W1[Worker pool]
  W1 -->|heartbeat / result| JS
  W1 -->|failed after N| DLQ[(DLQ)]`,
  pts: [r`Persist jobs with next-run indexes.`, r`Multiple schedulers claim due jobs with SKIP LOCKED or leases.`, r`Queues per priority/tenant; workers with timeouts and heartbeats.`, r`Retries with backoff, DLQ, idempotent handlers.`, r`Explicit misfire policy and time-zone-aware schedules.`],
  ex: r`A fintech's reminder scheduler moved from in-memory timers on one VM to a SKIP LOCKED design; deploys no longer dropped scheduled payments reminders.`,
  fu: [r`How do you handle DST for "9:00 every day local time"?`],
  pit: [r`Single scheduler instance as a single point of failure.`] },

{ id: 'q27', level: 'Senior', tags: ['proximity', 'ride-hailing'],
  q: r`Design the matching/proximity part of a ride-hailing service (drivers update location every 4 seconds).`,
  a: r`### Estimates
500,000 active drivers / 4 s = 125,000 location updates/s; rider requests ~5,000/s at peak. **Location updates dominate; they are ephemeral.**

### Design
- **Location service**: drivers send updates to gateways; latest positions stored in an in-memory geo index sharded by city/region (Redis GEO per cell, or H3 cells -> driver sets). No durable DB write per update (sample to a stream for analytics).
- **Matching service**: on a ride request, query nearby available drivers (k-nearest within radius, expanding rings), filter by status/vehicle type, rank by ETA (routing service), offer to the best driver with a timeout, then next.
- **Driver state**: available / offered / on-trip, updated atomically to avoid double assignment (conditional update/lock per driver).
- **Trip service**: durable trip records, state machine, payments integration.
- **Real-time updates** to riders via WebSockets.`,
  code: r`~~~csharp
public async Task<DriverId?> MatchAsync(RideRequest r, CancellationToken ct)
{
    foreach (var radiusKm in new[] { 1.0, 2.0, 4.0 })                                         // expanding search
    {
        var nearby = await _geo.SearchAsync(r.CityCell, r.Pickup, radiusKm, count: 20, ct);
        foreach (var d in await _eta.RankAsync(r.Pickup, nearby, ct))
            if (await _drivers.TryOfferAsync(d, r.Id, offerTtl: TimeSpan.FromSeconds(15), ct))   // atomic AVAILABLE -> OFFERED
                if (await _offers.WaitForAcceptAsync(d, r.Id, TimeSpan.FromSeconds(15), ct)) return d;
    }
    return null;
}
~~~`,
  dia: r`flowchart LR
  D[Driver apps] -->|location every 4s| GW[Location gateways]
  GW --> GEO[(Geo index per city cell: Redis GEO / H3)]
  GW --> ST[Sampled location stream] --> AN[Analytics]
  R[Rider app] --> M[Matching service]
  M --> GEO
  M --> ETA[ETA / routing service]
  M -->|atomic offer| DS[(Driver state)]
  M --> TRIP[Trip service] --> TDB[(Trips DB)]`,
  pts: [r`Location updates dominate and are ephemeral: keep them in memory.`, r`Shard the geo index by city or cell.`, r`Expanding-radius search, rank by ETA.`, r`Atomic driver state transitions prevent double assignment.`, r`Durable trip records with a state machine.`],
  ex: r`Moving driver locations from a database to per-city Redis GEO indexes cut matching latency from 900 ms to 40 ms.`,
  fu: [r`How do you handle drivers near city boundaries?`],
  pit: [r`Writing every location update to a relational database.`] },

{ id: 'q28', level: 'Senior', tags: ['web-crawler'],
  q: r`Design a web crawler that fetches 1 billion pages per month politely.`,
  a: r`### Estimates
1 B/month ≈ 400 pages/s; 500 KB average -> 200 MB/s download, ~500 TB/month raw (compress, dedupe).

### Design
- **URL frontier**: prioritised queues (importance, freshness) and **politeness queues per host** (one connection per host, crawl delay, robots.txt).
- **Fetchers**: distributed workers with async I/O, DNS caching, timeouts, retries.
- **Content processing**: parse, extract links, normalise URLs, detect duplicates (URL seen-set with Bloom filter + exact store; content fingerprint with SimHash for near-duplicates).
- **Storage**: raw content in object storage, metadata in a database, extracted data to a pipeline.
- **Recrawl scheduling** based on change frequency.
- **Traps and safety**: max depth, URL length limits, spider-trap detection, respecting robots.txt and legal constraints.`,
  code: r`~~~csharp
// Politeness: one in-flight request per host, with a crawl delay
private readonly ConcurrentDictionary<string, SemaphoreSlim> _hostGates = new();
public async Task<string?> FetchAsync(Uri url, CancellationToken ct)
{
    if (!await _robots.IsAllowedAsync(url, ct)) return null;
    var gate = _hostGates.GetOrAdd(url.Host, _ => new SemaphoreSlim(1, 1));
    await gate.WaitAsync(ct);
    try
    {
        var res = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        return res.IsSuccessStatusCode ? await res.Content.ReadAsStringAsync(ct) : null;
    }
    finally { _ = Task.Delay(await _robots.CrawlDelayAsync(url.Host, ct), CancellationToken.None).ContinueWith(_ => gate.Release()); }
}
~~~`,
  dia: r`flowchart LR
  SEED[Seed URLs] --> FR[URL frontier: priority + per-host queues]
  FR --> F[Fetchers: async, robots-aware]
  F --> OBJ[(Raw pages in object storage)]
  F --> P[Parser: links + content]
  P --> DD[Dedupe: Bloom seen-set + SimHash]
  DD --> FR
  P --> IDX[Downstream indexing]`,
  pts: [r`Prioritised frontier with per-host politeness queues.`, r`Respect robots.txt and crawl delays.`, r`Deduplicate URLs (Bloom + exact) and content (SimHash).`, r`Raw content to object storage; metadata to a database.`, r`Guard against spider traps; recrawl by change frequency.`],
  ex: r`A compliance team's crawler monitoring regulator websites used per-host politeness and change-frequency scheduling to catch new publications within an hour.`,
  fu: [r`How do you distribute the frontier across machines?`],
  pit: [r`Hammering a single host with parallel requests.`] },

{ id: 'q29', level: 'Senior', tags: ['multi-region'],
  q: r`How do you design a system for multi-region availability? Active-passive vs active-active.`,
  a: r`- **Active-passive**: one region serves traffic; another is a warm or hot standby with replicated data. Simpler consistency (single writer); RTO = failover time; RPO = replication lag.
- **Active-active**: all regions serve traffic. Lower latency for global users and higher availability, but writes in several regions need conflict handling or partitioned ownership.

Active-active approaches:

- **Partition by home region**: each user/tenant/account is owned by one region (writes go there); others read replicas. Avoids conflicts.
- **Conflict-free data types / LWW** for tolerant data (preferences, carts).
- **Globally consistent databases** (Spanner, CockroachDB, Cosmos DB strong consistency) with latency costs.

Supporting pieces: global traffic management (Route 53, Front Door, Global Accelerator) with health checks; replicated secrets, config and keys; deployment pipelines per region; regular failover drills.`,
  code: r`~~~csharp
// Home-region routing: writes for an account go to its owning region
public sealed class RegionalRouter(IReadOnlyDictionary<string, HttpClient> regions, string localRegion, IAccountDirectory directory)
{
    public async Task<HttpClient> ForWriteAsync(string accountId, CancellationToken ct) =>
        regions[(await directory.HomeRegionAsync(accountId, ct)) ?? localRegion];      // cached directory lookup
    public HttpClient ForRead() => regions[localRegion];                               // local replica, bounded staleness
}
~~~`,
  dia: r`flowchart TB
  GTM[Global traffic manager: latency + health routing] --> EU
  GTM --> US
  subgraph EU[Region EU]
    EAPI[API] --> EDB[(DB: home for EU accounts)]
  end
  subgraph US[Region US]
    UAPI[API] --> UDB[(DB: home for US accounts)]
  end
  EDB <-->|async replication of non-home data| UDB`,
  pts: [r`Active-passive: single writer, failover sets RTO and RPO.`, r`Active-active: lower latency, but write conflicts must be designed.`, r`Partition ownership by home region to avoid conflicts.`, r`Use CRDT/LWW only for tolerant data; global databases cost latency.`, r`Replicate config, secrets and keys; drill failovers regularly.`],
  ex: r`A payments firm ran active-active with account home regions; a regional outage moved writes for affected accounts after a controlled failover, with no conflicting balances.`,
  fu: [r`What is the cost of active-active?`],
  pit: [r`Active-active writes to the same records in two regions with last-writer-wins for balances.`] },

{ id: 'q30', level: 'Senior', tags: ['consistency', 'read-your-writes'],
  q: r`Users see stale data after updating their profile because reads hit replicas or caches. Design a fix.`,
  a: r`Options, from simplest:

- **Read from primary after write** for that user for a short window (sticky routing for N seconds via a cookie or session flag).
- **Return the updated resource in the write response**; the UI uses it directly (optimistic UI) instead of re-reading.
- **Consistency tokens**: the write returns a version or log position (LSN); subsequent reads include it, and the read path uses a replica only if it has caught up, otherwise the primary.
- **Cache invalidation on write**: delete affected keys after commit; or write-through for the user's own data.
- **Version check in the client**: ignore responses older than the version already shown.

Choose based on how widespread the problem is and infrastructure: tokens are the most precise; sticky primary reads are the quickest fix.`,
  code: r`~~~csharp
app.MapPut("/me/profile", async (ProfileUpdate u, ProfileDb primary, HttpContext http, HybridCache cache, CancellationToken ct) =>
{
    var p = await primary.UpdateAsync(http.User.UserId(), u, ct);
    await cache.RemoveAsync("profile:" + p.UserId, ct);
    http.Response.Cookies.Append("rw-primary-until", DateTimeOffset.UtcNow.AddSeconds(10).ToUnixTimeSeconds().ToString(),
        new CookieOptions { HttpOnly = true, Secure = true, SameSite = SameSiteMode.Strict });
    return Results.Ok(p);                                     // client renders the fresh data immediately
});
app.MapGet("/me/profile", async (HttpContext http, ProfileDb primary, ProfileReplica replica, CancellationToken ct) =>
{
    var stickToPrimary = long.TryParse(http.Request.Cookies["rw-primary-until"], out var until) && until > DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    return await (stickToPrimary ? primary.GetAsync(http.User.UserId(), ct) : replica.GetAsync(http.User.UserId(), ct));
});
~~~`,
  pts: [r`Return updated data from the write and render it directly.`, r`Route a user's reads to the primary briefly after a write.`, r`Consistency tokens (LSN/version) give precise read-your-writes.`, r`Invalidate caches after commit.`, r`Clients ignore responses older than what they show.`],
  ex: r`A banking app's "address not updated" complaints vanished after the update endpoint returned the new profile and reads stuck to the primary for 10 seconds.`,
  fu: [r`How do you implement consistency tokens with PostgreSQL replicas?`],
  pit: [r`Increasing cache TTL or replica count, worsening staleness.`] },

{ id: 'q31', level: 'Senior', tags: ['hotel-reservation'],
  q: r`Design a hotel reservation system (search availability, book rooms, avoid overbooking, support cancellations).`,
  a: r`### Model
Inventory per hotel, room type and **date** (not per physical room for most chains): {{room_type_inventory(hotel_id, room_type, date, total, reserved)}}. A booking for 3 nights reserves one unit on 3 dates.

### Booking
In one transaction: for each date, {{UPDATE ... SET reserved = reserved + 1 WHERE reserved < total (+ overbooking allowance)}}; if any date fails, roll back. Idempotency key on reservation creation. Optimistic concurrency with version columns or conditional updates; lock rows in date order to avoid deadlocks.

### Search
Availability search reads from a cache or read replica (eventually consistent, refreshed by booking events); final confirmation always checks the primary.

### Other concerns
Cancellations release inventory; payment holds vs pay-at-hotel; channel managers (OTAs) sync inventory with idempotent updates; overbooking policies configurable per hotel; scale by partitioning by hotel.`,
  code: r`~~~sql
BEGIN;
  INSERT INTO reservations (id, idempotency_key, hotel_id, room_type, check_in, check_out, guest_id, status)
  VALUES ($id, $key, $hotel, $type, $in, $out, $guest, 'CONFIRMED');                     -- unique idempotency_key
  UPDATE room_type_inventory SET reserved = reserved + 1
  WHERE hotel_id = $hotel AND room_type = $type AND date >= $in AND date < $out
    AND reserved + 1 <= total * (1 + overbook_pct);
  -- application checks updated row count == number of nights, otherwise ROLLBACK (sold out on some date)
COMMIT;
~~~`,
  dia: r`flowchart LR
  G[Guest / OTA] --> SR[Search service] --> AC[(Availability cache / replica)]
  G --> RS[Reservation service]
  RS -->|tx: reserve each night| INV[(Inventory per hotel, type, date)]
  RS --> PAY[Payment holds]
  RS -->|events| SYNC[Channel manager sync] --> OTA[OTAs]
  RS -->|events| AC`,
  pts: [r`Model inventory per hotel, room type and date.`, r`Reserve all nights in one transaction with conditional updates.`, r`Idempotency keys on reservations.`, r`Search from caches/replicas; confirm against the primary.`, r`Partition by hotel; sync channels idempotently.`],
  ex: r`Switching from per-room locking to date-level inventory counters removed booking deadlocks and handled peak holiday traffic.`,
  fu: [r`How do you handle overbooking intentionally?`],
  pit: [r`Checking availability in one query and reserving in another without conditions.`] },

{ id: 'q32', level: 'Senior', tags: ['stock-exchange'],
  q: r`Design the core of a stock exchange or trading venue (order entry, matching, market data).`,
  a: r`### Requirements
Ultra-low latency (microseconds), deterministic matching (price-time priority), fairness, durability of every order event, market data dissemination, risk checks.

### Design
- **Order gateways** (FIX/binary protocols): authenticate, validate, apply pre-trade risk checks (limits, fat-finger), sequence.
- **Sequencer**: assigns a global sequence number to every inbound event; the event log is the source of truth (event sourcing).
- **Matching engine**: single-threaded per instrument/partition, in memory, deterministic; consumes sequenced events, produces executions and book updates.
- **Replication**: primary and hot standby engines consume the same sequenced stream (state machine replication), enabling instant failover.
- **Market data publisher**: multicast/UDP or streaming of book updates and trades, with sequence numbers and recovery channels.
- **Post-trade**: drop copies, clearing, settlement, persistence of the journal.

Techniques: ring buffers (Disruptor), kernel bypass networking, no GC in hot paths (object pooling, structs), co-location.`,
  code: r`~~~csharp
// Deterministic matching loop over a sequenced input stream (single thread per instrument)
public void Run(IRingBuffer<SequencedEvent> input, IOutput output)
{
    while (input.TryRead(out var ev))
    {
        switch (ev.Payload)
        {
            case NewOrder o:   foreach (var fill in _book.Match(o)) output.Publish(new Execution(ev.Seq, fill)); _book.RestIfRemaining(o); break;
            case CancelOrder c: output.Publish(_book.Cancel(c.OrderId) ? new Cancelled(ev.Seq, c.OrderId) : new CancelReject(ev.Seq, c.OrderId)); break;
        }
        output.Publish(new BookUpdate(ev.Seq, _book.TopOfBook()));
    }
}
~~~`,
  dia: r`flowchart LR
  T[Traders] --> GW[Order gateways: auth, risk checks]
  GW --> SEQ[Sequencer: global sequence numbers]
  SEQ --> LOG[(Event journal)]
  SEQ --> ME[Matching engine primary]
  SEQ --> MEB[Matching engine hot standby]
  ME --> MD[Market data publisher] --> SUBS[Subscribers]
  ME --> PT[Post-trade: clearing, drop copy]`,
  pts: [r`Sequence every inbound event; the journal is the source of truth.`, r`Single-threaded, deterministic matching per instrument.`, r`Hot standby replays the same stream for instant failover.`, r`Pre-trade risk checks at the gateways.`, r`Low-latency techniques: ring buffers, no GC, kernel bypass.`],
  ex: r`LMAX's architecture (single-threaded business logic on a ring buffer with event sourcing) processed millions of orders per second on one thread.`,
  fu: [r`How do you guarantee fairness between gateways?`],
  pit: [r`Multi-threaded matching on one book with locks.`] },

{ id: 'q33', level: 'Senior', tags: ['ad-click-aggregation'],
  q: r`Design an ad-click (or card-transaction) aggregation system that reports counts per minute with exactly-once results.`,
  a: r`### Requirements
Ingest ~1 M events/s, aggregate per campaign (or merchant) per minute, query recent minutes within seconds, correct even with duplicates and late events, recompute historically if logic changes.

### Design
- **Ingestion**: events to Kafka partitioned by campaign id; producers idempotent.
- **Stream processing** (Flink/Kafka Streams): event-time tumbling windows, watermarks for late events, keyed state; checkpointing + transactional sinks for exactly-once results.
- **Deduplication**: event ids within a window (state with TTL).
- **Sink**: aggregated rows into an OLAP store (ClickHouse, Druid, Pinot) for fast queries.
- **Raw archive**: events in a data lake for reprocessing (Lambda/Kappa: replay the log to recompute).
- **Reconciliation**: batch recomputation compares with streaming results; alerts on drift (critical for billing).
- **Hot keys**: big campaigns split with salting and pre-aggregation.`,
  code: r`~~~sql
-- ClickHouse: aggregated per minute, idempotent inserts via ReplacingMergeTree keyed by window
CREATE TABLE clicks_per_minute (
  campaign_id UInt64, minute DateTime, clicks UInt64, version UInt64
) ENGINE = ReplacingMergeTree(version) ORDER BY (campaign_id, minute);
SELECT campaign_id, sum(clicks) FROM clicks_per_minute FINAL
WHERE minute >= now() - INTERVAL 15 MINUTE GROUP BY campaign_id;
~~~`,
  dia: r`flowchart LR
  SRC[Click / transaction sources] --> K[(Kafka partitioned by campaign)]
  K --> F[Flink: event-time windows, dedupe, checkpoints]
  F -->|transactional sink| OLAP[(ClickHouse / Druid)]
  K --> LAKE[(Data lake raw archive)]
  LAKE --> BATCH[Batch recompute] --> RECON[Reconcile vs streaming]
  Q[Dashboards / billing] --> OLAP`,
  pts: [r`Partition events by aggregation key.`, r`Event-time windows with watermarks for late data.`, r`Checkpoints plus transactional sinks give exactly-once results.`, r`Archive raw events for replay and recomputation.`, r`Reconcile streaming against batch for billing-grade numbers.`],
  ex: r`An ad platform found a 0.4% overcount from client retries; event-id deduplication in the stream and batch reconciliation fixed billing disputes.`,
  fu: [r`Lambda vs Kappa architecture?`],
  pit: [r`Processing-time windows for billing metrics.`] },

{ id: 'q34', level: 'Senior', tags: ['email-service', 'large-files'],
  q: r`Design a video upload and streaming service at a high level.`,
  a: r`### Upload path
Client uploads directly to object storage via **multipart pre-signed URLs** (resumable); an event triggers processing. Metadata in a database.

### Processing
A **transcoding pipeline** (DAG): validate, extract metadata, transcode into multiple resolutions/bitrates (H.264/H.265/AV1), package into HLS/DASH segments, generate thumbnails, run moderation. Parallelise by splitting video into chunks; workers on GPU/CPU autoscaled from a queue.

### Streaming
Segments served from a **CDN**; clients use **adaptive bitrate** streaming to switch quality based on bandwidth. Manifests per video; DRM for protected content.

### Scale and cost
Storage tiers (hot for popular, cold for long tail), CDN costs dominate egress; popularity-driven pre-warming; encoding cost vs storage trade-offs (encode fewer renditions for unpopular videos).`,
  code: r`~~~csharp
app.MapPost("/videos", async (CreateVideo req, IAmazonS3 s3, VideoDb db) =>
{
    var id = Guid.CreateVersion7();
    var upload = await s3.InitiateMultipartUploadAsync(new() { BucketName = "raw-videos", Key = "raw/" + id });
    var partUrls = Enumerable.Range(1, req.Parts).Select(n => s3.GetPreSignedURL(new GetPreSignedUrlRequest
    { BucketName = "raw-videos", Key = "raw/" + id, Verb = HttpVerb.PUT, Expires = DateTime.UtcNow.AddHours(2), UploadId = upload.UploadId, PartNumber = n })).ToList();
    db.Videos.Add(new Video(id, req.Title, "UPLOADING")); await db.SaveChangesAsync();
    return Results.Ok(new { id, upload.UploadId, partUrls });     // client uploads parts directly, then calls /complete
});
~~~`,
  dia: r`flowchart LR
  C[Client] -->|multipart pre-signed upload| RAW[(Raw object storage)]
  RAW -->|event| Q[(Transcode queue)]
  Q --> TW[Transcoding workers: renditions + HLS/DASH]
  TW --> OUT[(Segments storage)]
  TW --> META[(Metadata DB)]
  OUT --> CDN[CDN]
  V[Viewers: adaptive bitrate] --> CDN`,
  pts: [r`Direct multipart uploads to object storage via pre-signed URLs.`, r`Transcoding as a parallel pipeline into multiple renditions.`, r`Package as HLS/DASH and serve via CDN with adaptive bitrate.`, r`Metadata separate from media.`, r`Manage cost with storage tiers and selective encoding.`],
  ex: r`Splitting videos into 10-second chunks for parallel transcoding cut processing time for a 1-hour video from 40 minutes to 4.`,
  fu: [r`How do you handle live streaming differently?`],
  pit: [r`Streaming video through API servers.`] },

{ id: 'q35', level: 'Senior', tags: ['security-design'],
  q: r`How do you build security into a system design (not bolt it on)?`,
  a: r`Address security per layer as part of the design:

- **Identity and access**: OIDC/OAuth2 for users and services, short-lived tokens, mTLS or workload identity between services, least-privilege IAM, object-level authorisation in services.
- **Data protection**: classify data; encryption in transit (TLS 1.2+) and at rest (KMS with key rotation), field-level encryption or tokenisation for sensitive data (PAN, national ids), data residency.
- **Network**: private subnets, no public databases, WAF and DDoS protection at the edge, egress controls.
- **Secrets**: vaults with managed identities, no secrets in code or images.
- **Application**: input validation, output encoding, idempotency and rate limits against abuse, secure defaults (deny by default).
- **Supply chain**: SBOMs, dependency scanning, signed images, pinned base images.
- **Detection and response**: audit logs, anomaly detection, incident runbooks.
- **Threat modelling** (STRIDE) at design time for new flows.`,
  code: r`~~~text
STRIDE quick pass for "partner payout API"
Spoofing          -> mTLS + OAuth client credentials with certificate-bound tokens
Tampering         -> TLS, signed request bodies (HMAC), immutable audit log
Repudiation       -> audit records with actor, request id, signature
Info disclosure   -> field-level encryption of bank details, scoped responses
Denial of service -> per-partner quotas, WAF, request size limits
Elevation         -> object-level authz: partner can only pay out from its own accounts; four-eyes over threshold
~~~`,
  dia: r`flowchart LR
  U[Users / partners] --> WAF[CDN + WAF + DDoS]
  WAF --> GW[Gateway: OAuth2, mTLS for partners]
  GW --> SVC[Services: object-level authz]
  SVC -->|workload identity| DB[(Encrypted DB, private subnet)]
  SVC --> KMS[KMS / Key Vault]
  SVC --> TOK[Tokenisation vault for PAN]
  SVC --> AUD[(Immutable audit log)]`,
  pts: [r`Design identity, data protection, network and secrets per layer.`, r`Least privilege and object-level authorisation everywhere.`, r`Tokenise or field-encrypt sensitive data; mind residency.`, r`Secure the supply chain and keep secrets in vaults.`, r`Threat-model new flows with STRIDE; log for audit and detection.`],
  ex: r`A STRIDE review of a new payout API found that partners could request payouts from any account id; object-level checks were added before launch.`,
  fu: [r`How do you reduce PCI scope in a design?`],
  pit: [r`Relying on the network perimeter for authorisation.`] },

{ id: 'q36', level: 'Senior', tags: ['data-pipeline', 'cdc'],
  q: r`Design the data platform that feeds analytics and ML from operational systems without hurting them.`,
  a: r`- **Change data capture** from operational databases (Debezium, DMS, native CDC) or **outbox events** into a streaming backbone (Kafka/Event Hubs). Never run analytics queries on OLTP primaries.
- **Landing zone** in a data lake (object storage) in open formats (Parquet/Delta/Iceberg), partitioned by date.
- **Processing layers**: bronze (raw), silver (cleaned, deduplicated, conformed), gold (business aggregates) with Spark/Databricks/Synapse or dbt on a warehouse.
- **Serving**: warehouse (Snowflake, BigQuery, Redshift, Synapse) for BI; feature store for ML; reverse ETL back to operational tools.
- **Governance**: data catalogue, lineage, data contracts between producers and consumers, PII classification with masking and access controls, retention and erasure propagation.
- **Quality**: tests on pipelines (freshness, volume, schema, uniqueness), alerting.`,
  code: r`~~~sql
-- dbt-style silver model: deduplicate CDC events, keep the latest version per order
SELECT * FROM (
  SELECT o.*, ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY source_lsn DESC) AS rn
  FROM bronze.orders_cdc o
  WHERE op <> 'd')
WHERE rn = 1;
~~~`,
  dia: r`flowchart LR
  OLTP[(Operational DBs)] -->|CDC| K[(Kafka)]
  SVC[Services] -->|outbox events| K
  K --> BR[(Bronze: raw Parquet/Delta)]
  BR --> SI[(Silver: cleaned, deduped)]
  SI --> GO[(Gold: business aggregates)]
  GO --> WH[Warehouse / BI]
  SI --> FS[Feature store] --> ML[ML models]
  CAT[Catalogue, lineage, PII policies] -.-> BR & SI & GO`,
  pts: [r`Capture changes via CDC or outbox; never query OLTP primaries for analytics.`, r`Land raw data in open formats in a lake.`, r`Bronze, silver, gold layers with tested transformations.`, r`Serve via warehouse, feature store and reverse ETL.`, r`Governance: contracts, lineage, PII controls, erasure propagation.`],
  ex: r`Moving BI from OLTP read replicas to a CDC-fed lakehouse removed nightly report-induced slowdowns and gave analysts hourly-fresh data.`,
  fu: [r`What is a data contract?`],
  pit: [r`Analytics teams reading service databases directly.`] },

{ id: 'q37', level: 'Principal', tags: ['trade-offs', 'decision'],
  q: r`How do you present and decide trade-offs in a system design (for example, consistency vs latency, build vs buy)?`,
  a: r`- **Make options explicit**: at least two credible designs, including the simplest one.
- **Criteria tied to requirements**: latency SLOs, availability, RPO/RTO, cost, team skills, time to market, compliance, operational burden, reversibility.
- **Quantify**: estimated latency, monthly cost, failure modes and blast radius, effort in engineer-weeks.
- **Reversibility** (one-way vs two-way doors): spend more analysis on irreversible choices (data models, vendor lock-in), move fast on reversible ones.
- **Recommend** with reasons and the conditions that would change the decision.
- **Record** as an ADR; revisit at agreed triggers.

In interviews, narrate this briefly: "Option A gives strong consistency at +40 ms per write; B gives 5 ms writes but needs reconciliation. For balances I choose A; for activity feeds B."`,
  code: r`~~~text
Decision: search for 30 M products
                     A: PostgreSQL FTS         B: OpenSearch (managed)
p95 latency          180 ms                    40 ms
Facets / typo        limited                   strong
Monthly cost         +$0 (existing DB)         +$6,500
Ops burden           low                       medium (sync pipeline, cluster)
Freshness            transactional             ~2 s via CDC
Reversibility        easy to move later        moderate
Recommendation: B, because search conversion is a top business KPI and facets are required; revisit if traffic < 50 QPS
~~~`,
  pts: [r`Present at least two credible options including the simplest.`, r`Use criteria tied to requirements and quantify them.`, r`Weigh reversibility: analyse one-way doors more.`, r`Recommend with reasons and reversal conditions.`, r`Record decisions as ADRs.`],
  ex: r`A quantified search options table settled a month-long debate in one architecture review.`,
  fu: [r`What is a one-way door decision?`],
  pit: [r`Presenting a single option as inevitable.`] },

{ id: 'q38', level: 'Principal', tags: ['interview-scenario', 'payments'],
  q: r`Design a cross-border payments platform (remittances) handling FX, compliance checks and multiple payout rails.`,
  a: r`### Flows
Quote (FX rate + fees, valid for N minutes) -> create transfer (idempotent) -> fund (card/bank pull) -> compliance (KYC, sanctions, AML rules) -> FX conversion -> payout via local rails (SEPA, Faster Payments, SWIFT, mobile money) -> status tracking -> reconciliation.

### Components
- **Quote service**: rates from liquidity providers with spreads; quotes stored with expiry and locked rate.
- **Transfer orchestrator**: saga/state machine (Temporal or MassTransit) with compensations (refund funding if payout impossible).
- **Compliance service**: sanctions screening (fuzzy matching), risk scoring, manual review queue; holds transfers.
- **Ledger**: multi-currency double-entry with FX accounts (positions per currency).
- **Treasury/liquidity**: pre-funded accounts per corridor; monitors balances; rebalances.
- **Payout adapters** per rail/partner with idempotency, cut-off times, status polling/webhooks.
- **Reconciliation** per partner and per currency daily.
- **Regulatory**: data residency, reporting (suspicious activity reports), audit trails.`,
  code: r`~~~csharp
public enum TransferState { Quoted, Created, Funded, InCompliance, OnHold, Converted, PayoutSent, Completed, Refunded, Failed }
public sealed record Quote(Guid Id, string FromCcy, string ToCcy, decimal Rate, decimal Fee, DateTimeOffset ExpiresAt, string LiquidityProvider);
// Ledger postings for a GBP -> INR transfer (each journal balances per currency via FX position accounts)
// GBP: Customer funding  -1000.00 | GBP clearing +1000.00
// GBP: GBP clearing      -990.00  | FX position GBP +990.00 | Fee income +10.00
// INR: FX position INR   -104,000 | Payout clearing INR +104,000
~~~`,
  dia: r`flowchart LR
  U[Sender app] --> Q[Quote service] --> LP[Liquidity providers]
  U --> T[Transfer orchestrator: saga]
  T --> F[Funding: card / open banking]
  T --> C[Compliance: sanctions, AML, review queue]
  T --> FX[FX conversion]
  T --> L[(Multi-currency ledger)]
  T --> P[Payout adapters] --> R1[SEPA] & R2[UPI / IMPS] & R3[SWIFT]
  P -->|status| T
  REC[Reconciliation per partner/currency] --> L
  TR[Treasury: pre-funded corridor balances] --> P`,
  pts: [r`Quotes lock rates with expiry; transfers are idempotent sagas.`, r`Compliance can hold transfers; manual review is part of the flow.`, r`Multi-currency double-entry ledger with FX position accounts.`, r`Payout adapters per rail with cut-offs, status tracking and idempotency.`, r`Treasury pre-funding and daily reconciliation per partner.`],
  ex: r`A remittance company's corridor reconciliation found a partner silently returning failed payouts days later; the saga added a "returned" state and automatic refunds.`,
  fu: [r`What happens if a quote expires during compliance review?`],
  pit: [r`Treating payout as synchronous and final.`] },

{ id: 'q39', level: 'Principal', tags: ['reliability', 'failure-modes'],
  q: r`Walk through how a system design fails: what failure modes do you design for, and how?`,
  a: r`Go through failure classes explicitly:

| Failure | Design response |
|---|---|
| Instance crash | Stateless services, multiple instances, health checks |
| Dependency slow | Timeouts, circuit breakers, bulkheads, fallbacks |
| Dependency down | Graceful degradation, queues to buffer, retries with jitter |
| Database failover | Retries on transient errors, idempotency, connection pools that reconnect |
| Message duplicate / out of order | Idempotent consumers, sequence/version checks |
| Lost message | Outbox, acknowledgements, reconciliation |
| Overload | Rate limiting, load shedding, autoscaling, backpressure |
| Bad deploy | Canary, feature flags, fast rollback |
| Data corruption / human error | Backups, PITR, delayed replicas, append-only data |
| Zone / region loss | Multi-AZ by default, multi-region where justified |
| Unknown outcome (timeout) | Status queries, reconciliation, explicit Unknown states |

Then state which failures have **no detector** (silent data drift, a provider succeeding without telling you) and how reconciliation or invariants catch them.`,
  code: r`~~~csharp
// Degrade gracefully: recommendations are optional, checkout is not
app.MapGet("/product/{id}", async (int id, ICatalog catalog, IRecommendations recs, CancellationToken ct) =>
{
    var product = await catalog.GetAsync(id, ct);                                         // critical
    var related = await recs.ForAsync(id, ct).WaitAsync(TimeSpan.FromMilliseconds(150), ct)
                            .ContinueWith(t => t.IsCompletedSuccessfully ? t.Result : [], ct); // optional: empty on failure
    return Results.Ok(new { product, related });
});
~~~`,
  pts: [r`Walk through failure classes explicitly.`, r`Timeouts, breakers, bulkheads and graceful degradation for dependencies.`, r`Idempotency and outbox for messaging failures.`, r`Canary and rollback for bad deploys; PITR for human error.`, r`Name failures with no detector and catch them with reconciliation.`],
  ex: r`A failure-mode table in a design review revealed that a recommendation outage would fail product pages; making it optional prevented a future Sev-1.`,
  fu: [r`Which failures have no detector in your current system?`],
  pit: [r`Designing only the happy path.`] },

{ id: 'q40', level: 'Principal', tags: ['cost', 'finops'],
  q: r`How do you incorporate cost into system design decisions?`,
  a: r`- **Model cost early** alongside latency: compute (instances, serverless invocations), storage (hot/cold), data transfer (cross-AZ, cross-region, internet egress, NAT gateways), managed service premiums, observability (often surprisingly large), licences.
- **Unit economics**: cost per transaction/user/report; track it as a metric.
- **Design levers**: caching and CDNs to cut origin and egress; async and batch processing on cheaper capacity (spot); storage tiering and retention; right-sizing; serverless for spiky low-volume workloads vs containers for steady high volume; avoiding chatty cross-AZ traffic; compressing payloads.
- **Trade-offs**: reliability costs money (multi-region doubles some costs); choose per SLO tier.
- **Feedback**: cost dashboards per service with ownership; anomaly alerts.`,
  code: r`~~~text
Monthly cost estimate: notification service at 300 M messages/month
Compute:   12 pods x 2 vCPU (steady) ........................ $1,100
Queue:     300 M x 2 ops x $0.40/M ........................... $240
SMS:       20 M SMS x $0.0075 ................................ $150,000   <- dominant: optimise channel mix (push first)
Email:     200 M x $0.10/1,000 ............................... $20,000
Logs:      2 TB/month ingestion .............................. $1,000
Unit cost: ~$0.00058 per notification; target after push-first policy: $0.00031
~~~`,
  pts: [r`Model compute, storage, transfer, managed premiums, observability and licences.`, r`Track unit costs as metrics.`, r`Use caching, batching, tiering, spot and right-sizing as levers.`, r`Match reliability spend to SLO tiers.`, r`Give teams cost dashboards and anomaly alerts.`],
  ex: r`A cost model showed SMS was 85% of a notification platform's bill; routing to push first when the app was installed cut costs by 40%.`,
  fu: [r`Where do cross-AZ costs hide in Kubernetes?`],
  pit: [r`Ignoring data-transfer costs in multi-region designs.`] },

{ id: 'q41', level: 'Principal', tags: ['migration', 'evolution'],
  q: r`How do you evolve a running system to a new architecture (for example monolith to services, or single region to multi-region) without a big bang?`,
  a: r`- **Define the target and the reasons** (with measurable goals) and an ordered roadmap of independently valuable steps.
- **Strangler fig at the edge**: route traffic by path/feature to new components via a gateway/proxy.
- **Branch by abstraction internally**; feature flags for switching.
- **Data migration**: dual writes are risky; prefer CDC replication from old to new store, backfill, shadow reads comparing results, then flip writes with a short freeze; keep reverse replication for rollback.
- **Parallel runs** for critical calculations.
- **One step at a time** with rollback plans and success metrics; keep the system shippable throughout.
- **Communicate**: timeline, risks, freeze windows, ownership changes.

Multi-region: first make one region resilient (multi-AZ, automation, infrastructure as code), then add a passive region with replicated data and drills, then active-active for selected workloads.`,
  code: r`~~~csharp
// Shadow reads during a datastore migration: serve old, compare new, log mismatches
public async Task<Account?> GetAsync(Guid id, CancellationToken ct)
{
    var legacy = await _oldStore.GetAsync(id, ct);
    if (_flags.IsEnabled("accounts-shadow"))
        _ = Task.Run(async () =>
        {
            var modern = await _newStore.GetAsync(id, CancellationToken.None);
            if (!AccountComparer.Same(legacy, modern)) _metrics.ShadowMismatch.Add(1);
        });
    return _flags.IsEnabled("accounts-read-new") ? await _newStore.GetAsync(id, ct) : legacy;
}
~~~`,
  dia: r`flowchart LR
  C[Clients] --> GW[Gateway / proxy]
  GW -->|migrated routes| NEW[New services]
  GW -->|everything else| OLD[Monolith]
  OLD --> ODB[(Old DB)]
  ODB -->|CDC| NDB[(New DB)]
  NEW --> NDB`,
  pts: [r`Set measurable goals and a roadmap of independently valuable steps.`, r`Strangler fig at the edge; branch by abstraction inside.`, r`Migrate data with CDC, backfill, shadow reads and a short write freeze.`, r`Keep rollback paths and parallel-run critical maths.`, r`Make one region resilient before going multi-region.`],
  ex: r`A retailer moved checkout out of a monolith over 9 months with shadow reads and CDC; customers saw no outage.`,
  fu: [r`Why are dual writes dangerous?`],
  pit: [r`Big-bang cutovers of data stores.`] },

{ id: 'q42', level: 'Principal', tags: ['ai-systems', 'rag'],
  q: r`Design an enterprise RAG (retrieval-augmented generation) assistant over internal documents with access control.`,
  a: r`### Requirements
Answer questions from policies, wikis and tickets; cite sources; respect document permissions; keep data in region; evaluate quality; control cost.

### Design
- **Ingestion pipeline**: connectors (SharePoint, Confluence, file shares) -> parse -> chunk by structure -> embed -> index into a vector + keyword store (Azure AI Search, OpenSearch, pgvector) with **ACL metadata** (groups allowed) per chunk; incremental updates and deletions.
- **Query flow**: authenticate user -> resolve groups -> hybrid search filtered by ACLs -> re-rank -> build prompt with top chunks -> LLM -> answer with citations -> guardrails (PII redaction, policy filters).
- **Security**: permission trimming at retrieval (never rely on the LLM to filter), tenant/region isolation, prompt-injection defences (treat retrieved text as data), audit logging of questions and sources.
- **Quality**: evaluation set with expected answers; metrics: retrieval recall@k, groundedness, citation accuracy; human feedback loop.
- **Cost/latency**: semantic caching for repeated questions (scoped by permissions), model routing (small model for simple questions).`,
  code: r`~~~csharp
public async Task<Answer> AskAsync(ClaimsPrincipal user, string question, CancellationToken ct)
{
    var groups = await _directory.GroupsOfAsync(user.UserId(), ct);
    var hits = await _search.HybridAsync(question, top: 30, filter: Acl.AnyOf(groups), ct);   // permission trimming at retrieval
    var context = (await _reranker.RerankAsync(question, hits, top: 6, ct)).ToList();
    var reply = await _chat.GetResponseAsync(Prompt.Build(question, context), new ChatOptions { Temperature = 0 }, ct);
    var answer = Guardrails.Check(reply.Text, context);                                          // groundedness + PII
    await _audit.LogAsync(user.UserId(), question, context.Select(c => c.DocId), ct);
    return answer with { Citations = context.Select(c => c.Source).ToList() };
}
~~~`,
  dia: r`flowchart LR
  SRC[SharePoint / Confluence / tickets] --> ING[Ingestion: parse, chunk, embed, ACL tags]
  ING --> IDX[(Hybrid index: vectors + keywords + ACLs)]
  U[User] --> API[Assistant API: authN]
  API --> DIR[Directory groups]
  API -->|ACL-filtered hybrid search| IDX
  API --> RR[Re-ranker]
  API --> LLM[LLM: answer with citations]
  API --> GR[Guardrails + audit]
  EVAL[Evaluation set + feedback] -.-> API`,
  pts: [r`Index chunks with ACL metadata; trim by permissions at retrieval.`, r`Hybrid search plus re-ranking, then grounded generation with citations.`, r`Treat retrieved content as data to resist prompt injection.`, r`Evaluate retrieval and groundedness on a labelled set.`, r`Control cost with scoped semantic caching and model routing.`],
  ex: r`An HR assistant initially leaked restricted policy snippets because filtering happened after retrieval; moving ACL filters into the search query fixed it.`,
  fu: [r`How do you keep the index in sync with permission changes?`],
  pit: [r`Asking the LLM to ignore documents the user cannot see.`] },

{ id: 'q43', level: 'Principal', tags: ['interview-scenario', 'banking'],
  q: r`Design a real-time fraud detection system for card authorisations (decision within 100 ms).`,
  a: r`### Constraints
Authorisation path budget ~100 ms end to end; fraud scoring gets ~20 to 40 ms. Peak 20,000 TPS. False positives cost revenue and customer trust; false negatives cost chargebacks.

### Design
- **Synchronous scoring service** in the auth path: fetches features from an **online feature store** (Redis/Aerospike) with single-digit ms latency, runs rules + an ML model (in-process, e.g. ONNX/LightGBM), returns approve/decline/step-up (3-D Secure) with reason codes.
- **Streaming feature computation** (Flink/Kafka Streams): velocity counts per card/device/merchant, distinct countries, amount deviations, graph features from batch jobs, written to the feature store.
- **Fallback**: if scoring times out, apply a conservative rule set (fail open for low amounts, step-up or decline for high risk) rather than blocking all payments.
- **Feedback loop**: chargebacks and analyst decisions labelled for retraining; model monitoring for drift.
- **Case management** for analysts with explanations.
- **Shadow mode** for new models before enforcement; champion/challenger.`,
  code: r`~~~csharp
public async Task<FraudDecision> ScoreAsync(AuthRequest a, CancellationToken ct)
{
    using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
    budget.CancelAfter(TimeSpan.FromMilliseconds(30));                                  // hard latency budget
    try
    {
        var f = await _features.GetAsync(a.CardToken, a.DeviceId, a.MerchantId, budget.Token);   // Redis, ~2 ms
        var rule = _rules.Evaluate(a, f);
        if (rule is not null) return rule;                                               // hard rules first (blocklists)
        var score = _model.Predict(FeatureVector.From(a, f));                            // in-process ONNX, ~1 ms
        return score > 0.92 ? FraudDecision.Decline("R-ML-HIGH") : score > 0.75 ? FraudDecision.StepUp("R-ML-MED") : FraudDecision.Approve();
    }
    catch (OperationCanceledException) when (!ct.IsCancellationRequested)
    { return a.Amount < 50m ? FraudDecision.Approve("FALLBACK") : FraudDecision.StepUp("FALLBACK"); }   // safe degradation
}
~~~`,
  dia: r`flowchart LR
  NET[Card network] --> AUTH[Authorisation service]
  AUTH -->|30 ms budget| FS[Fraud scoring: rules + model]
  FS --> OFS[(Online feature store)]
  TX[(Transaction stream)] --> SP[Stream processing: velocity features] --> OFS
  BATCH[Batch graph features] --> OFS
  FS -->|decisions| CM[Case management]
  CB[Chargebacks + analyst labels] --> TRAIN[Model training] --> FS`,
  pts: [r`Hard latency budget for scoring inside the authorisation path.`, r`Online feature store fed by streaming and batch feature pipelines.`, r`Rules plus an in-process model with reason codes.`, r`Safe fallback when scoring times out.`, r`Feedback loop, drift monitoring, shadow and champion/challenger models.`],
  ex: r`An issuer's fallback rule set kept approving low-value payments during a feature-store outage, avoiding a full card outage while limiting risk.`,
  fu: [r`How do you prevent training/serving skew?`],
  pit: [r`Synchronous calls to slow databases for features in the auth path.`] },

{ id: 'q44', level: 'Principal', tags: ['governance', 'architecture-review'],
  q: r`You are reviewing another team's system design. What do you look for, and how do you give feedback?`,
  a: r`Review checklist:

- **Requirements fit**: are SLOs, volumes and compliance needs explicit and is the design sized to them (not over/under)?
- **Data**: ownership, consistency per data type, schema evolution, retention, PII.
- **Failure modes**: timeouts, retries, idempotency, outbox, reconciliation, blast radius, degradation.
- **Operations**: observability, deployment and rollback, runbooks, on-call ownership, capacity plan.
- **Security**: authN/Z, secrets, encryption, threat model.
- **Cost**: estimates and unit economics.
- **Simplicity**: could fewer components meet the requirements? Are new technologies justified?
- **Evolution**: what changes are likely, and are they cheap?

Feedback style: ask questions before asserting, separate must-fix (correctness, security, compliance) from suggestions, reference standards, and offer to pair on the hard parts. Record decisions and follow up on must-fix items.`,
  code: r`~~~text
Review notes: Merchant Payouts v2
MUST    Payout creation not idempotent: retries can double pay. Add Idempotency-Key + unique constraint.
MUST    No reconciliation with the payout provider's daily file.
SHOULD  Consumer has no DLQ; poison messages will block the partition.
SHOULD  Cost: Kafka + Flink for 3 TPS. Would a queue + worker meet the SLO? Please compare.
QUESTION What is the RPO for the payouts database? Is cross-region replication in scope?
PRAISE  Clear state machine and runbook links.
~~~`,
  pts: [r`Check requirements fit, data ownership and consistency choices.`, r`Probe failure modes, idempotency and reconciliation.`, r`Check operations, security and cost.`, r`Challenge unnecessary complexity.`, r`Ask before asserting; separate must-fix from suggestions; follow up.`],
  ex: r`A review question about idempotency on payout creation prevented a double-payout bug that would have hit thousands of sellers.`,
  fu: [r`How do you handle a team that disagrees with a must-fix item?`],
  pit: [r`Reviews that only comment on technology choices.`] },

{ id: 'q45', level: 'Principal', tags: ['capacity-planning'],
  q: r`How do you capacity-plan a system for a 10x traffic event (Black Friday, IPO day, salary day)?`,
  a: r`1. **Forecast** the peak per critical journey with business input (marketing plans, historical peaks), and add headroom.
2. **Map journeys to dependencies** and find the binding constraint per hop (database writes, third-party rate limits, connection pools, Kafka partitions, CDN).
3. **Load test** production-like environments at 1x, 3x, 10x with realistic traffic shapes; find knees in latency.
4. **Fix and scale**: caching, pre-scaling (autoscaling reacts too slowly for step changes), database instance upgrades, partition counts, warm pools, CDN pre-warming, provider quota increases (requested weeks ahead).
5. **Protect**: rate limiting, load shedding of non-critical features (feature flags), waiting rooms, queues.
6. **Operational readiness**: freeze risky changes, war room, dashboards, runbooks, on-call staffing, rollback plans.
7. **Review afterwards** with actual vs forecast.`,
  code: r`~~~text
Black Friday plan: checkout journey
Forecast peak: 4,000 orders/min (10x normal) -> 67 orders/s; each order = 6 DB writes + 3 PSP calls
Binding constraints found in load test at 6x: PSP rate limit (150 req/s) and DB connection pool (100)
Actions: PSP quota raised to 600 req/s (requested 6 weeks ahead); pool to 300 + PgBouncer;
         pre-scale API to 60 pods at 06:00; disable recommendations widget above 80% CPU (flag);
         waiting room threshold 5,000 concurrent checkouts; change freeze 72 h before
~~~`,
  pts: [r`Forecast per journey with business input and headroom.`, r`Find the binding constraint at each hop.`, r`Load test to 10x and find latency knees.`, r`Pre-scale and raise third-party quotas early.`, r`Shed non-critical load, freeze changes, staff a war room.`],
  ex: r`A load test at 6x revealed a PSP rate limit that would have capped checkout; the quota increase requested weeks earlier saved the peak day.`,
  fu: [r`Why does autoscaling alone fail for step-change traffic?`],
  pit: [r`Load testing only the API tier, not third parties and databases.`] },

{ id: 'q46', level: 'Principal', tags: ['regulated-systems'],
  q: r`What changes in a system design when it is subject to financial regulation (PCI DSS, SOX, DORA, data residency)?`,
  a: r`- **Scope reduction**: keep regulated data in as few components as possible (tokenisation for PAN; segment the cardholder data environment).
- **Auditability**: immutable audit logs of access and changes, with retention; traceability from requirement to deployment (change management).
- **Segregation of duties**: separate roles for deploying, approving and accessing production data; four-eyes approvals for sensitive operations.
- **Resilience requirements** (DORA, PRA operational resilience): impact tolerances for important business services, tested recovery, third-party risk management, incident reporting timelines.
- **Data residency and privacy**: in-region storage and processing, cross-border transfer controls, erasure processes.
- **Security controls**: encryption, key management with HSMs where required, vulnerability management SLAs, penetration testing.
- **Model/algorithm governance** for automated decisions.

Design implication: build these into the platform (paved road) so product teams inherit compliance rather than reinventing it.`,
  code: r`~~~yaml
# Policy-as-code guardrail (OPA/Gatekeeper style): regulated workloads may only run in approved regions with encryption
package guardrails
deny[msg] {
  input.resource.labels["data-class"] == "pci"
  not input.resource.region in {"eu-west-1", "eu-central-1"}
  msg := "PCI workloads must run in approved EU regions"
}
deny[msg] {
  input.resource.kind == "Database"
  not input.resource.spec.encryptionAtRest
  msg := "Databases must be encrypted at rest"
}
~~~`,
  pts: [r`Reduce regulated scope through tokenisation and segmentation.`, r`Immutable audit logs and traceable change management.`, r`Segregation of duties and four-eyes approvals.`, r`Resilience tolerances, tested recovery and third-party risk (DORA).`, r`Residency and privacy controls built into the platform.`],
  ex: r`Tokenising card numbers at the edge shrank a merchant's PCI scope from 40 services to 3, cutting audit effort by months.`,
  fu: [r`What is an impact tolerance under UK operational resilience rules?`],
  pit: [r`Treating compliance as documentation after the design is done.`] },

{ id: 'q47', level: 'Principal', tags: ['simplicity'],
  q: r`An interviewer says "your design is over-engineered". How do you respond, and how do you design for simplicity?`,
  a: r`Respond by **re-anchoring on requirements**: "Which requirement do you think does not justify component X?" Then walk the numbers: if the load is 50 requests/s, Kafka, sharding and multi-region active-active are not justified; a single region, managed relational database, a queue and a cache may meet the SLO with room to grow.

Designing for simplicity:

- Start with the simplest design that meets requirements, then add components only to address a named requirement or risk.
- Prefer managed services and fewer technologies.
- Use a modular monolith before microservices.
- Make future scaling steps possible (stateless services, clean data boundaries, outbox) without building them now.
- State explicitly what you would add, and at which trigger (for example "shard when write QPS exceeds 5,000 or data exceeds 5 TB").

This shows judgement: knowing what not to build is a Principal skill.`,
  code: r`~~~text
Simplest design meeting: 50 req/s, 99.9%, single country, 2 TB in 3 years
- 1 region, 2 AZs; containerised .NET API (3 replicas) behind a load balancer
- Managed PostgreSQL (primary + standby), Redis cache, managed queue for async work
- Outbox for events, OpenTelemetry, IaC
Triggers to evolve: >2,000 write QPS -> partition by tenant; regulator requires 2-region RTO < 1h -> warm standby region
~~~`,
  pts: [r`Re-anchor on requirements and numbers.`, r`Start with the simplest design that meets them.`, r`Add components only for named requirements or risks.`, r`Keep future scaling possible without building it now.`, r`State the triggers that would justify each addition.`],
  ex: r`A candidate who removed Kafka and sharding after recomputing the load, and listed triggers for adding them, received a strong hire for judgement.`,
  fu: [r`What design choices keep future scaling cheap?`],
  pit: [r`Defending every component instead of revisiting requirements.`] },

{ id: 'q48', level: 'Principal', tags: ['organisation', 'conway'],
  q: r`How do team structure and ownership influence system design at scale?`,
  a: r`Conway's law: systems mirror the communication structures of the organisations that build them. Implications:

- **Service boundaries should match team boundaries**: a service owned by several teams becomes a coordination bottleneck; a team owning many unrelated services is overloaded.
- **Stream-aligned teams** own business capabilities end to end (APIs, data, on-call); **platform teams** provide paved roads (CI/CD, observability, databases as a service); **enabling teams** help adoption; **complicated-subsystem teams** own specialised components (risk models, matching engines).
- **Interaction modes**: collaboration (temporary), X-as-a-service (stable APIs), facilitation.
- **Cognitive load** limits how many services/technologies a team can own.

As a Principal, propose architecture and team changes together (inverse Conway manoeuvre), with clear ownership, on-call and APIs between teams.`,
  code: r`~~~text
Ownership map (excerpt)
Capability          Services                       Team (stream-aligned)    On-call
Checkout            checkout-api, cart             Checkout                 Checkout
Payments            payments-api, psp-adapters     Payments                 Payments
Ledger              ledger, reconciliation         Finance Platform         Finance Platform
Platform            k8s, CI/CD, observability      Platform (as a service)  Platform
Shared library      company-resilience            Platform (enabling)      n/a
~~~`,
  pts: [r`Systems mirror organisational communication (Conway's law).`, r`Align service boundaries with team ownership.`, r`Stream-aligned, platform, enabling and complicated-subsystem teams.`, r`Respect cognitive load limits.`, r`Change architecture and team structure together.`],
  ex: r`Merging two services always changed together, owned by two teams, into one service owned by one team removed a weekly release-coordination meeting.`,
  fu: [r`What is the inverse Conway manoeuvre?`],
  pit: [r`Microservices split along team-agnostic technical layers.`] },

{ id: 'q49', level: 'Principal', tags: ['interview-scenario', 'end-to-end'],
  q: r`Design a core banking "accounts and payments" platform for a digital bank launching in two countries.`,
  a: r`### Scope
Current accounts, card payments (issuing via a processor), domestic transfers (instant rails), statements, KYC onboarding, two countries with data residency, 99.95% availability, RPO 0 for ledger.

### Architecture (modular, service-oriented)
- **Onboarding/KYC** (identity verification vendor, sanctions, risk), **Customer** profiles.
- **Ledger** (double-entry, append-only, strongly consistent, per-country deployment for residency), **Accounts** (products, limits, interest), **Balances** (derived).
- **Payments**: domestic rails adapters (Faster Payments/SEPA Instant), card authorisation service (processor webhooks, real-time decisioning with fraud scoring), payment orchestration sagas.
- **Statements/documents**, **Notifications**.
- **Integration**: outbox events on Kafka; reconciliation per rail and processor; regulatory reporting from a data platform.
- **Channels**: mobile/web via BFFs; open banking APIs.
- **Platform**: Kubernetes or managed containers per country, IaC, OpenTelemetry, secrets in HSM-backed vaults.

### Key decisions
Ledger on a relational database with synchronous standby (RPO 0) per country; card authorisation path with tight latency budget and stand-in rules; idempotency everywhere; daily reconciliation; DR drills.`,
  code: r`~~~text
Card authorisation latency budget (processor requires response in 1.5 s; target 300 ms)
gateway 10 ms -> auth service 20 ms -> fraud score 30 ms -> balance check + hold (ledger) 40 ms -> response 10 ms = ~110 ms p50
Stand-in: if ledger unavailable, processor stand-in limits apply; holds reconciled when ledger recovers
~~~`,
  dia: r`flowchart TB
  APP[Mobile / web] --> BFF[BFFs]
  OB[Open banking TPPs] --> OBAPI[Open banking API]
  BFF & OBAPI --> GW[Gateway]
  GW --> ONB[Onboarding / KYC]
  GW --> ACC[Accounts]
  GW --> PAY[Payment orchestration]
  PROC[Card processor] --> AUTH[Card authorisation] --> FR[Fraud scoring]
  AUTH --> LED[(Ledger per country: sync standby)]
  PAY --> RAILS[Instant rails adapters]
  PAY --> LED
  ACC --> LED
  LED -->|outbox| K[(Kafka)]
  K --> STM[Statements] & NTF[Notifications] & DP[Data platform / regulatory reporting]
  REC[Reconciliation: rails + processor] --> LED`,
  pts: [r`Per-country deployment of the ledger for residency, with RPO 0.`, r`Double-entry append-only ledger as the core.`, r`Card authorisation with a strict latency budget and stand-in rules.`, r`Payment sagas over rails adapters with idempotency and reconciliation.`, r`Events via outbox to statements, notifications and reporting.`],
  ex: r`A digital bank launched in two EU countries with this shape; separate per-country ledgers satisfied residency while shared services ran with tenant-country routing.`,
  fu: [r`Build vs buy the core ledger?`, r`How do you handle interest accrual at scale?`],
  pit: [r`A single global ledger ignoring residency requirements.`] },

{ id: 'q50', level: 'Principal', tags: ['summary'],
  q: r`Summarise what a Principal Engineer brings to a system design discussion.`,
  a: r`"I bring structure, numbers and judgement:

- I clarify requirements and state what the estimates imply, so we solve the real problem (often correctness or operability, not scale).
- I choose data stores and consistency per data type, and design for failure: idempotency at every hop, outbox, reconciliation, timeouts, graceful degradation.
- I keep the design as simple as the requirements allow and name the triggers for adding complexity.
- I make operations first-class: SLOs, observability, deployment safety, capacity and cost.
- I account for security, compliance and residency from the start.
- I align architecture with team ownership and document decisions with trade-offs, so the design survives contact with the organisation."`,
  code: r`~~~text
My whiteboard checklist
[ ] Requirements + out of scope       [ ] Estimates + implication
[ ] Core flows + APIs + data model    [ ] Consistency per data type
[ ] Failure modes + idempotency       [ ] Reconciliation / invariants
[ ] SLOs + observability              [ ] Security + compliance
[ ] Cost + capacity                   [ ] Ownership + evolution triggers
~~~`,
  dia: r`flowchart LR
  REQ[Requirements + numbers] --> DES[Simplest design that meets them]
  DES --> FAIL[Failure modes: idempotency, outbox, reconciliation]
  FAIL --> OPS[SLOs, observability, deploy safety]
  OPS --> SEC[Security, compliance, residency]
  SEC --> ORG[Ownership, ADRs, evolution triggers]`,
  pts: [r`Structure: requirements, estimates with implications, design, deep dive, wrap-up.`, r`Consistency chosen per data type; failure designed in.`, r`Simplicity with explicit evolution triggers.`, r`Operations, security, compliance and cost are first-class.`, r`Architecture aligned with ownership and recorded decisions.`],
  ex: r`Closing a design interview with this checklist and two named trade-offs consistently signals Principal-level judgement.`,
  fu: [r`Which part of this checklist do teams most often skip?`],
  pit: [r`Ending a design discussion without trade-offs or open risks.`] }
],
cheat: r`### Method
1 Requirements (functional, NFRs, out of scope) -> 2 Estimates + implication -> 3 High-level design (flows, APIs, data model) -> 4 Deep dive (hardest 2-3 parts) -> 5 Wrap-up (trade-offs, monitoring, gaps).

### Numbers
1 day ≈ 10^5 s · peak = 2-5x avg · RAM 100 ns · SSD 100 µs · same-AZ RTT 0.5 ms · cross-region 50-150 ms · Redis ~100K ops/s/shard · Kafka partition ~10 MB/s.

### Building blocks
| Need | Block |
|---|---|
| Read-heavy | CDN, cache (L1/L2), read replicas |
| Write-heavy | Partitioning, LSM stores, batching, queues |
| Async work | Queue (tasks) or log (events, replay) |
| Exactly-once effects | At-least-once + idempotency keys + reconciliation |
| Reliable events | Transactional outbox + idempotent consumers |
| Multi-step workflows | Saga / process manager / durable workflow |
| Search | Inverted index fed by CDC |
| Real time | WebSockets/SSE gateways + registry |
| Global | Home-region ownership, global traffic manager |

### Classic designs
URL shortener · rate limiter · notifications · ID generator · chat · feed (hybrid fan-out) · autocomplete · payments + ledger · wallet · ticket booking (waiting room + conditional holds) · hotel reservation (inventory per date) · KV store (quorums) · distributed cache · metrics/alerting · job scheduler (SKIP LOCKED) · ride matching (geo index) · crawler · ad-click aggregation · video · RAG assistant · fraud scoring.

### Say this
"The numbers say correctness, not scale, is the hard part." "Consistency per data type." "Exactly-once = at-least-once + idempotency." "Reconciliation catches what no detector sees." "Here is the trigger for adding that complexity."`
});
})(String.raw);
