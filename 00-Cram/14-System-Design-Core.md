# System Design — Core Method & Building Blocks

> Tier 1 (highest weight) · Source: `14-System-Design/` (23 files, 22,295 lines) · Read: 25 min · **Drill daily**
> Companion sheet: [[14-System-Design-Problems]]

---

## 1. The four-step spine (use these headings out loud)

1. **Understand the problem, establish scope.** Ask questions, narrow the vague prompt. Then state: functional requirements · non-functional requirements · back-of-envelope estimate · **and what the numbers imply the *actual* hard problem is.** Never skip that last sentence — it is what separates Staff framing from Senior.
2. **High-level design, get buy-in.** Name the core flows and treat them separately. Component glossary in plain language → diagram → numbered end-to-end walkthrough of one request → API endpoints with parameter tables → data model as real table schemas with **status lifecycles** spelled out.
3. **Deep dive** (the bulk). Happy path → failure. Every topic gets a diagram or a worked trace, not prose.
4. **Wrap-up.** What you did not cover and would do next; closing diagram.

**Clock (45 min):** ~7 requirements · ~10 high-level · ~20 deep dive · ~5 wrap. Say the number of minutes you're allocating at the start — interviewers read that as seniority.

---

## 2. Estimation constants — MEMORISE THIS BLOCK

```
TIME
  1 day   ≈ 86,400 s ≈ 10^5 s      ← the single most useful approximation
  1 month ≈ 2.5 × 10^6 s
  1 year  ≈ 3 × 10^7 s

LATENCY (order of magnitude)
  L1 cache ref                 ~1 ns
  Main memory ref              ~100 ns
  SSD random read              ~100 µs
  Network RTT, same DC         ~0.5 ms
  Disk seek (spinning)         ~10 ms
  Network RTT, cross-region    ~50–150 ms  (NY↔LON ~70ms, NY↔SG ~230ms)
  ⇒ memory ~1000× faster than SSD; same-DC ~100× faster than cross-region

THROUGHPUT (per commodity node, conservative)
  Redis                  ~100k ops/s
  RDBMS write, tuned     ~5–10k writes/s     ← the number that forces sharding
  RDBMS read w/ index    ~50k reads/s
  Kafka partition        ~10 MB/s sustained
  Web/app server         ~5–10k req/s (async, I/O bound)
  WebSocket conns        ~50k concurrent/node

SIZES
  UUID 16 B · timestamp 8 B · int64 8 B
  "typical" row ~1 KB (state this assumption) · photo ~1 MB · 1 min 1080p ~50 MB
```

**The three derivations:**
```
① QPS       = DAU × actions/user/day ÷ 10^5
   Peak QPS  = avg × 2–10   (consumer social ~3×; market-open trading 50×+)
② Storage/yr = writes/s × record-size × 3×10^7 × replication (×3)
③ Bandwidth  = QPS × payload-size
```

**Worked aloud in 90 seconds:**
> "50M DAU, 10 feed loads each → 500M reads/day ÷ 10^5 = **5,000 reads/s avg**, ~**15,000 peak** at 3×. Writes: 10% post once/day → 5M/day → **50 writes/s**, trivial. So this is a **100:1 read-heavy** system — the hard problem is read fan-out, not write throughput, and storage at ~2 TB/yr is not interesting."

**The actual skill is retiring numbers.** A candidate who computes storage and never mentions it again did arithmetic. A candidate who says "therefore storage is not a driver" is designing. **If a number eliminates nothing, you wasted time computing it.**

**Fourth derived number — tail amplification under fan-out:**
```
P(at least one slow) = 1 − (1 − p)^n
n = 10 backends, p = 1%  ⇒  1 − 0.99^10 ≈ 9.6%
⇒ your p99 backend is now roughly your p90 request
```
Consequences to state in any scatter-gather: **adding shards makes the tail worse** (n grows), and the fixes are structural — hedged requests, deadline with partial results, or keep n small.

**Availability arithmetic:** 99.9% = 43 min/month · 99.99% = 4.3 min/month · 99.999% = 26 s/month. Series dependencies **multiply** (five 99.9% services in a chain = 99.5%).

---

## 3. The level ladder — say the Staff/Principal layer

**"How do you keep the cache consistent with the database?"**

- **Senior** (correct, complete, insufficient): "Cache-aside with TTL. Invalidate on write. Accept a small staleness window."
- **Staff** (adds failure + second-order effects): "…but invalidation is a *distributed operation that can fail*, so **TTL is the backstop, not the optimisation**. Two problems: thundering herd on hot-key expiry → probabilistic early expiry / single-flight; and the invalidate-then-write race → write-through or versioned keys. I'd alarm on hit-rate *and* on staleness, because a cache that silently serves stale data looks healthy."
- **Principal** (adds organisational + lifecycle framing): "…plus, the real question is **whether this cache should exist**. It's a permanent operational liability — a second source of truth with its own failure modes, and every future engineer on this write path must know it exists. I'd want the DB-only latency number first, and I'd want to know who owns it in three years."

> **The pattern: Senior answers the question. Staff answers how it fails and how you'd know. Principal questions whether the thing should exist, who maintains it, and what it costs over years.**

**Other signals that cap you at Senior if missing:** operability (how is it deployed, monitored, rolled back), and never saying "buy, don't build" when that's the honest answer. **Over-engineering is penalised more harshly than under-engineering.**

**Handling pushback — answer with a threshold, not a defence:** "You're right that breaks — at about 50k writes/sec. We're at 500, so I'd take the simpler design now and here's the trigger that says migrate."

---

## 4. Load Balancing

- **L4** (TCP) = fast, connection-level, no content awareness. **L7** (HTTP) = routes on path/header/cookie, TLS termination, retries. AWS: **NLB = L4**, **ALB = L7**.
- Algorithms: round robin · weighted · **least connections** (best for uneven request cost) · least response time · **consistent hashing** (cache affinity, minimal reshuffle on node change).
- **The health check that lies:** a check hitting `/health` that only returns 200 from the web tier says nothing about the database. The opposite failure is a check that *does* test the DB — one DB blip then removes the **entire fleet** at once. Rule: **liveness must not check dependencies; readiness may, but must fail a *fraction* of the fleet, not all of it.**
- Sticky sessions are acceptable when the state is genuinely expensive to rebuild (WebSockets) and you have connection draining; otherwise they break autoscaling and rolling deploys.

---

## 5. Caching

| Pattern | Write path | Notes |
|---|---|---|
| **Cache-aside (lazy)** | app writes DB, invalidates cache | default; stale window; cache miss on first read |
| **Read-through** | cache library loads on miss | same as aside but hidden in the client |
| **Write-through** | write cache + DB synchronously | consistent, slower writes |
| **Write-behind** | write cache, flush async | fast, **can lose data** |
| **Refresh-ahead** | proactively refresh before TTL | good for predictable hot keys |

- **Thundering herd / cache stampede** — a hot key expires, N requests all miss and hit the DB. Fixes: **single-flight / request coalescing**, probabilistic early expiry, a short lock, or never expiring hot keys (refresh-ahead).
- **Eviction:** LRU (default) · LFU (better for skew) · TTL. **Hot-key problem:** one key exceeds a single node's capacity → replicate the key across nodes with a suffix, or cache it locally in-process.
- **When caching does NOT help:** write-heavy workloads, low-reuse (long-tail) access, or when the cache miss path is what you actually need to make fast.
- **Cache invalidation failure is invisible** — alert on staleness, not just hit rate.

---

## 6. The database scaling ladder (in order — the order is the answer)

1. **Indexes & query tuning** (almost always the real fix)
2. **Connection pooling**
3. **Caching**
4. **Read replicas** — scales reads only; introduces **replication lag** → read-your-own-writes breaks
5. **Vertical scaling** — cheapest in engineering time; has a hard ceiling
6. **Functional partitioning** (split by table/domain — the microservices move)
7. **Sharding** — **the rung of last resort**

**Sharding strategies:**
| Strategy | Pro | Con |
|---|---|---|
| Range | range queries work | hotspots (sequential keys) |
| Hash | even distribution | no range queries; resharding is painful |
| **Consistent hashing** | minimal movement on node change | needs virtual nodes for balance |
| Directory/lookup | flexible, easy rebalance | the lookup is a SPOF + extra hop |
| Geo | residency, latency | skew by region |

- **What you lose when you shard:** cross-shard joins, cross-shard transactions, global uniqueness, global `ORDER BY`/aggregation, and easy rebalancing. **Say this before proposing it.**
- **Celebrity/hot shard** — one key dominates. Fixes: split the key (`userId#bucket`), dedicated shard, or cache in front.

---

## 7. CAP · PACELC · Consistency

- **CAP says:** *during a network partition*, choose consistency or availability. It says nothing when there is no partition — that's the most common misuse.
- **PACELC** is the more useful statement: **if Partition → A or C; Else → Latency or Consistency.** Most real systems' everyday behaviour is the "else" branch.
- Consistency models to name: strong · **linearizable** · sequential · **causal** · **read-your-writes** · **monotonic reads** · eventual.
- **Monotonic reads** is the one candidates miss — "I saw the post, refreshed, and it vanished" is a monotonicity failure, and it is *stronger* than eventual consistency.
- **Quorum:** `W + R > N` gives strong-ish reads. `N=3, W=2, R=2` is the standard. `W=1` = fast, lossy. `R=1` = fast, possibly stale.
- **Split brain** → **fencing tokens** (a monotonically increasing epoch the storage layer checks) — a lease alone is not enough, because the old leader may be paused, not dead.
- **Exactly-once is not a wire-level delivery guarantee.** Say: **at-least-once delivery plus idempotent, atomic handling can give an effectively-once business effect** — bounded by the deduplication-retention window.

---

## 8. Queues & async

- **Queue (single receiver, SQS/RabbitMQ)** vs **log (multi-receiver, replayable, Kafka)** — pick by "does more than one consumer need this, and does anyone need to replay?"
- What "decoupling" actually costs: eventual consistency, ordering concerns, duplicate delivery, a DLQ to operate, backpressure design, and a much harder debugging story.
- **Retry classification first:** retryable (transient, 5xx, timeout) vs non-retryable (4xx, validation) — retrying a non-retryable error forever is a common outage.
- Retry strategies: immediate · fixed · incremental · **exponential backoff + jitter** (jitter is mandatory, or you build a synchronised retry storm) · cancel.
- **DLQ is not a dustbin** — it needs an owner, an alarm, and a replay path.
- **Backpressure**: bounded queues, reject early, shed load. An unbounded queue converts a throughput problem into an out-of-memory crash.

---

## 9. Failure & operability (the Staff/Principal signal)

- **Blast radius:** cells / bulkheads / shuffle sharding. **Circuit breaker** (closed → open → half-open) + timeout + bounded retry + fallback.
- **Load shedding happens *before* autoscaling** — autoscaling takes minutes; the overload is now. Shed by priority, protect the critical path.
- **Metastable failure:** the system stays broken after the trigger is removed, because retries now *are* the load. Fix: shed, cap retries, add jitter, drop the queue.
- **The readiness check that removed the whole fleet** — a dependency-checking readiness probe applied to every replica at once.
- **Little's Law:** `L = λ × W` (concurrency = arrival rate × latency). This is why **rate limiting ≠ concurrency limiting**, and how you size pools.
- **Observability:** measure the **invariant**, not the mechanism. Name what has **no detector** — "a silent cache-invalidation failure has no detector here; I'd add a sampled read-back comparison." Saying this unprompted is a Principal signal.
- **SLI/SLO:** define "broken" from the *user's* perspective ("cannot buy") not the component's ("service B returned 500").

---

## 10. Multi-region

- **Physics first:** cross-region RTT is 50–150 ms and cannot be engineered away. That single fact determines whether synchronous cross-region writes are possible (they usually are not).
- Topologies: **active-passive** (simple, RPO/RTO > 0) · **active-active read, single-region write** (common, sane) · **active-active write** (needs conflict resolution — CRDTs, LWW, or partitioned ownership).
- **Data residency (GDPR/PCI/local rules)** may force per-region storage and *forbid* global replication — this is often the real constraint in fintech, not latency.
- State the **RPO** (how much data may be lost) and **RTO** (how long to recover) as numbers.

---

## 11. The Principal's design review — five questions

1. What is the **hard problem** here, and does the design address *that*?
2. **How does it fail**, and how would you know? What has no detector?
3. What does it cost — in money, and in **operational burden over years**?
4. What is the **simpler** thing, and what threshold makes it insufficient?
5. Should this exist at all, or should we **buy**?

---

## Top traps

1. Designing before estimating — or estimating and never using the number.
2. "Use CAP: we chose AP" as a slogan, with no partition scenario described.
3. Claiming exactly-once delivery.
4. A health check that either lies or takes down the fleet.
5. Sharding proposed before indexes, cache and replicas.
6. Ignoring replication lag → read-your-writes breaks.
7. Unbounded queues and unbounded retries (no jitter).
8. No mention of deploy, rollback, or monitoring → capped at Senior.
9. Over-engineering for a scale the numbers don't support.
10. Never saying "buy, don't build."

---

## Interview Q&A — Lead / Principal

These are **execution** questions — the ones that decide your level regardless of which system you're asked to design. Problem-specific answers are in [[14-System-Design-Problems]].

### Q1 · Opening a deliberately vague prompt *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"Design a system for processing payments."* — and nothing else.

**Answer.** I'd spend the first five minutes narrowing it, out loud, because the prompt is vague on purpose and jumping to boxes is the failure being tested. Questions in order: who are the users — consumers, merchants, internal? Which flows are in scope — pay-in only, or pay-out and refunds too? Single or multi-currency, single or multi-region? What's delegated to a third party — are we PCI-scoped or using a hosted payment page? And what volume?

Then I'd state back: functional requirements as a list, non-functional as a list, and a back-of-envelope estimate with the arithmetic shown. **The sentence that matters is the one after the numbers** — "at 10 TPS, throughput is trivially easy, so the hard problem here is *correctness*: idempotent effects, reconciliation and auditability, not scale." Skipping that concluding implication is what makes an answer read as Senior; the numbers exist to eliminate architectures, and if a number eliminates nothing I shouldn't have computed it.

**Why it lands.** Demonstrates the script, and the explicit "therefore the hard problem is X" is the single strongest early signal.
**✗ Weak answer.** Starting with "I'd use microservices and Kafka" before establishing what's being built.
**↳ Follow-ups.** What would change if it were 10,000 TPS? What did you deliberately leave out of scope?

---

### Q2 · The estimation that changes the design *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"50 million daily active users, each loading their feed 10 times a day. Size it."*

**Answer.** 50M × 10 = 500M reads/day. Over 10⁵ seconds that's **5,000 reads/sec average**, and I'd apply a 3× multiplier for a consumer social peak — call it **15,000/sec**. Writes: if 10% post once a day, 5M writes/day, **about 50 writes/sec** — trivially small. So this is a **100:1 read-heavy** system, and the hard problem is read fan-out, not write throughput. At roughly 1 KB per post, storage is ~2 TB/year before replication, which is not interesting, so I'm retiring it as a driver.

The skill being tested is that last move — retiring numbers. A candidate who computes storage and never mentions it again did arithmetic; one who says "therefore storage isn't a driver" is designing. I'd also state the multiplier and why I chose it, because a market-open trading system peaks 50× against a flat overnight baseline, not 3×, and picking the wrong shape invalidates everything downstream.

**Why it lands.** Arithmetic shown, peak multiplier justified, numbers explicitly retired, hard problem named.
**✗ Weak answer.** Computing every number and using none of them.
**↳ Follow-ups.** What if it fans out to 100 shards — what happens to your tail? Where does the 3× come from?

---

### Q3 · The cache-consistency question, at three levels *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"How do you keep the cache consistent with the database?"* — deceptively simple, and the classic level-discriminator.

**Answer.** Mechanically: cache-aside with a TTL, invalidate on write. But that's the Senior answer, and I'd keep going, because the interesting part is that **invalidation is a distributed operation that can fail** — so the TTL is the *backstop*, not the optimisation. Two concrete problems follow. A thundering herd when a hot key expires, which I'd solve with single-flight plus jittered TTLs. And the invalidate-then-write race, where a concurrent read repopulates the cache with the old value between the invalidate and the commit — solved with write-through, versioned keys, or delayed double-invalidation. I'd alarm on **staleness**, not just hit rate, because a cache serving stale data looks perfectly healthy on every dashboard.

The Principal layer: the real question is **whether this cache should exist**. It's a permanent operational liability — a second source of truth with its own failure modes, and every engineer who touches this write path for the next three years has to know it's there. So I'd want the database-only latency number first, and I'd want to know who owns this in three years. If the answer is "nobody," I'd rather fix the query.

**Why it lands.** Explicitly walks the three levels. Practise this one — it's the most reliable way to demonstrate the ladder.
**✗ Weak answer.** Stopping after "cache-aside with a TTL."
**↳ Follow-ups.** How do you verify the cache is genuinely optional? What's your staleness SLO?

---

### Q4 · "What breaks first at 10×?" *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"Your design works today. Traffic goes up 10×. What breaks first?"*

**Answer.** I'd answer with a specific component and a specific number rather than "we'd scale horizontally." Usually the ordering is: the **single-writer database** first, because a tuned relational instance tops out around 5–10k writes/sec and that's the number that forces sharding; then **connection pool exhaustion**, which often bites before the database itself does; then whatever is **stateful** — sticky sessions, a WebSocket tier, a leader; then **tail latency under fan-out**, because adding shards increases *n* and `1−(1−p)ⁿ` makes the p99 worse, not better.

The part worth adding: at 10× the failure is often not capacity but **metastability** — the system stays broken after the trigger passes because retries become the load. So I'd want load shedding ahead of autoscaling, since autoscaling takes minutes and the overload is now, plus retry budgets and jitter. And I'd name the **trigger** rather than pre-building for it: "we're at 500 writes/sec, the migration trigger is sustained 3,000, and here's the two-week runway that gives us."

**Why it lands.** Ordered, numeric, names metastability, and gives a trigger instead of speculative engineering.
**✗ Weak answer.** "We'd add more instances" — the answer the question exists to reject.
**↳ Follow-ups.** Why does adding shards make the tail worse? What do you shed first?

---

### Q5 · Handling pushback *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"That won't work — your queue will fall over."* — often when it actually would work.

**Answer.** The highest-variance thirty seconds in the interview, and the move is to **answer with a threshold rather than defend**. Something like: "You're right that it breaks — at roughly 50,000 messages/sec, when the consumer can no longer keep up with a single partition. We're at 500, so I'd take the simpler design now, and the trigger to revisit is sustained lag growth over a five-minute window." That does three things: concedes the valid part, quantifies where it becomes true, and shows I know what to watch.

If they're right and I was wrong, I say so immediately and adjust — a candidate who recovers cleanly from a mid-design error scores *better* than one who was never challenged, because the interviewer learns how I behave when I'm wrong. What loses is defending a position past the point the evidence supports it, or silently capitulating without understanding why.

**Why it lands.** Threshold-not-defence is the specific technique; being explicit about handling being wrong is a strong senior signal.
**✗ Weak answer.** Either caving instantly or arguing without a number.
**↳ Follow-ups.** What if I told you we're already at 40,000/sec?

---

### Q6 · Operability — the signal whose absence caps you *(Principal)* ⭐⭐⭐⭐
**Asked as:** Often *not* asked directly — the interviewer just waits to see whether you raise it.

**Answer.** Bring it up unprompted, before the wrap-up. For any design: how does it deploy, how does it roll back, what are the SLIs, what pages someone, and who owns it. Then the move that reads as Principal — **name what has no detector**: "a silent cache-invalidation failure has no detector in this design; a stale read looks identical to a fresh one, so I'd add a sampled read-back comparison against the source." Or "if the reconciliation job silently stops running, everything looks green — so I'd alert on the *absence* of a run, not on its failures."

The general form is that most monitoring detects things being *wrong* and almost none detects things being *absent* or *silently stale*. Saying that, and then proposing the detector, is the most reliable single move for reading above Senior — more reliable than any depth of mechanism.

**Why it lands.** The "what has no detector" move is the highest-leverage sentence in the whole domain.
**✗ Weak answer.** Finishing the design with no mention of deploy, rollback, monitoring or ownership.
**↳ Follow-ups.** What's your SLI here, and what does "broken" mean to the user?

---

### Q7 · When the honest answer is "buy, don't build" *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"Design a notification service / feature-flag system / search engine."*

**Answer.** I'd design it properly — they asked, and refusing to engage reads as evasion — but I'd say the buy option out loud early and then proceed: "Before I design this, worth noting that Twilio and SendGrid solve 90% of this and I'd expect to buy unless there's a residency or volume constraint. Assuming we're building, here's how." That single sentence demonstrates commercial judgement without dodging the exercise.

The conditions that genuinely flip it to build: data residency or an air-gapped environment; a latency budget that forbids an external call; volume where the licence exceeds the engineering cost; or it's genuinely core differentiation. Against that, the five-year cost of building is never v1 — it's maintenance, on-call, the audit trail a regulator asks for, and the feature the vendor already has that we'll want in eighteen months.

**Why it lands.** Answers the question *and* shows the commercial frame. Never saying "buy" is a documented level-cap.
**✗ Weak answer.** Either designing it with no commercial comment, or refusing to design it.
**↳ Follow-ups.** What's the exit cost if the vendor is acquired? What would you build in-house around it?

---

### Q8 · Reviewing someone else's bad architecture *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"Here's a design a team proposed. Critique it."*

**Answer.** I'd structure the critique rather than list flaws, because how you deliver it is half of what's being assessed. First, what's **right** — genuinely, not as a softener; a review that opens with problems loses the room and I'd be modelling how I'd run this with a real team. Then findings **ordered by severity**, separated into correctness (data loss, a broken invariant, a security gap), operability (no rollback, no detection), and preference (naming, structure) — and I'd say explicitly which are blocking and which are not, because a reviewer who flags everything at the same weight gets ignored.

For each blocking finding: the failure scenario concretely, not "this might not scale." Then the threshold where it matters and a proposed alternative — a critique without an alternative is an obstacle. And I'd end with the one question that most needs answering, because the point is to leave the team able to proceed, not to have won.

**Why it lands.** Structure, severity separation, and explicitly modelling how they'd run a real review — which is what the question is actually probing.
**✗ Weak answer.** An unordered list of everything wrong.
**↳ Follow-ups.** What if the team disagrees with your blocking finding?

---

### Q9 · Multi-region and the number you must state *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Make it multi-region."*

**Answer.** Physics first: cross-region RTT is **50–150 ms** and cannot be engineered away, so synchronous cross-region writes are usually off the table and that fact — not preference — determines the topology. Then: what does the *data* allow? Active-passive is simplest with a non-zero RPO and RTO. Active-active reads with single-region writes is the common sane answer. Active-active writes needs genuine conflict resolution — CRDTs, last-writer-wins, or partitioned ownership — and for anything with a money invariant, partitioned ownership is the only one I'd accept, because a CRDT converges but cannot enforce "balance never goes negative."

Then state **RPO and RTO as numbers**, and say what you actually test — an untested DR plan has an RTO of infinity. And in financial services I'd raise **data residency** early, because GDPR or local rules may *forbid* replication, which constrains the design harder than latency does.

**Why it lands.** Physics-first, data-determines-topology, explicit RPO/RTO, and residency as the real constraint in finance.
**✗ Weak answer.** "Active-active in three regions" with no conflict-resolution story.
**↳ Follow-ups.** How do you fail back? What's your RPO during a regional failure?

---

### Q10 · Why is over-engineering penalised more than under-engineering? *(Principal)* ⭐⭐⭐
**Asked as:** *"Would you use Kafka here?"* — for a system doing 50 events/sec.

**Answer.** No, and I'd say why in cost terms. At 50 events/sec a database table with a polling relay, or a managed queue, does the job with a fraction of the operational surface. Kafka brings a cluster to run, partition and retention decisions, consumer-group rebalancing, and a body of knowledge the team needs — permanently. Under-engineering is visible and fixable: you hit a limit, you migrate, and the trigger is measurable. Over-engineering is invisible and compounding — you pay the complexity every day, nobody can point at the cost, and it never gets removed.

So my position: build for the current order of magnitude, name the trigger for the next one, and be able to state the migration path. "We're at 50/sec; at sustained 5,000/sec with more than two independent consumers needing replay, Kafka earns its place, and the migration is a publisher swap behind the same interface." That's a decision with a tripwire rather than a guess.

**Why it lands.** Explains the asymmetry, then gives the trigger and the migration path rather than just refusing.
**✗ Weak answer.** Reaching for Kafka/Kubernetes/microservices because they're the expected answer.
**↳ Follow-ups.** What would you use instead? How would you know when to move?

---

---

**Go deeper:** `14-System-Design/01`, `16` (playbook), `21` (scaling ladder) · **Next:** [[14-System-Design-Problems]]
