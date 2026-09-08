# 5. Distributed Systems — 20 Questions (Answered)

> **Method:** each answer opens with the definition as stated in the primary source — **Azure Architecture Center**, **Microsoft Learn**, the **AWS Builders' Library** / **AWS Well-Architected Framework**, **W3C Trace Context**, and the original CAP formulation (Brewer / Gilbert & Lynch) — then adds architect-level analysis. Links in **References**.

---

## Q1. What makes distributed systems difficult?

**Per the AWS Builders' Library ("Challenges with distributed systems"):** distributed systems are hard because they must cope with *"the possibility of partial failure"* — where *"some parts of the system are working and others are not, and the system as a whole must continue to make correct progress"* — combined with unbounded latency, message loss, duplication and reordering.

**The canonical framing — the Fallacies of Distributed Computing** (Deutsch/Gosling, cited throughout Microsoft and AWS architecture guidance). Every one of these is *false*, and each false assumption produces a specific class of production bug:

| Fallacy | Reality | Bug it causes |
|---|---|---|
| The network is reliable | Packets drop; connections reset | No retry/idempotency → lost or duplicated work |
| Latency is zero | Every hop costs 0.5 ms–500 ms | Chatty services; p99 collapse |
| Bandwidth is infinite | Payload size matters | Over-fetching; timeouts on large responses |
| The network is secure | It is not | No mTLS, no authZ between services |
| Topology doesn't change | Pods/instances move constantly | Hard-coded IPs; stale connection pools |
| There is one administrator | Many teams, many clouds | Uncoordinated change; no ownership |
| Transport cost is zero | Serialization + egress cost real money | Cross-AZ/cross-region data charges |
| The network is homogeneous | Mixed protocols, MTUs, versions | Subtle interop failures |

**The three deeper problems underneath them:**

1. **Partial failure.** In a monolith, a call either returns or the process dies. In a distributed system a call can time out having *actually succeeded* — you cannot distinguish "failed" from "succeeded but the response was lost". This single fact is why idempotency, reconciliation and compensation exist.
2. **No global clock and no global state.** You cannot ask "what is the state of the system right now?" — there is no *now* (Q14). Ordering must be established logically, not by timestamps.
3. **Emergent behaviour.** Retry storms, metastable failures, thundering herds, cascading failure — properties of the *system* that no single component exhibits. AWS documents these explicitly as the reason for backoff, jitter, circuit breakers and load shedding.

---

## Q2. Explain CAP theorem.

**Per the formal statement (Gilbert & Lynch's proof of Brewer's conjecture), as cited in Azure and AWS documentation:** a distributed data store can provide at most **two** of the following three guarantees simultaneously:

- **C — Consistency** (specifically **linearizability**): every read receives the most recent write or an error.
- **A — Availability**: every non-failing node returns a non-error response, without a guarantee that it is the most recent write.
- **P — Partition tolerance**: the system continues to operate despite arbitrary message loss between nodes.

**The correct reading — and the thing most candidates get wrong:** *"pick two" is misleading.* **Network partitions are not optional** — they happen, so **P is mandatory** for any real distributed system. The theorem is therefore a statement about what you do *during a partition*:

> **When a partition occurs, you must choose: fail the request (CP) or serve possibly-stale data (AP).** When there is no partition, you can have both C and A.

**CP vs AP with real systems:**

| Choice | Behaviour during a partition | Examples | Use when |
|---|---|---|---|
| **CP** | Reject/block requests on the minority side rather than serve stale or divergent data | ZooKeeper, etcd, Consul, HBase, MongoDB (default majority writes), **Kafka with `acks=all` + `min.insync.replicas`** | Correctness is non-negotiable: ledgers, balances, order matching, leader election, configuration |
| **AP** | Every node keeps answering; reconcile later | Cassandra, DynamoDB (eventually consistent reads), Riak, DNS | Availability matters more than freshness: catalogues, session state, feeds, metrics, shopping carts |

**PACELC — the extension you should mention to score well:** *if there is a **P**artition, choose **A** or **C**; **E**lse (normal operation), choose **L**atency or **C**onsistency.* This captures the everyday trade-off CAP omits: even with no partition, synchronous cross-region replication costs latency. DynamoDB global tables, Aurora Global Database and Cosmos DB's five consistency levels are all PACELC choices in product form.

**Architect's answer in a fintech context:** *"Different subsystems make different choices in the same platform. The ledger is CP — I would rather reject a debit than double-spend. The customer's transaction-history view is AP — a few seconds of staleness is fine and availability matters more."*

---

## Q3. Strong consistency vs eventual consistency?

**Per Microsoft Learn (Azure Cosmos DB consistency levels — the clearest official taxonomy):** consistency is a **spectrum**, not a binary: **Strong → Bounded staleness → Session → Consistent prefix → Eventual**, with each level trading latency/availability for guarantees.
**Per AWS (DynamoDB developer guide):** reads are *eventually consistent by default*; a **strongly consistent read** *"returns a result that reflects all writes that received a successful response prior to the read"*, costs twice the read capacity, has higher latency, and **is not available across Regions**.

| | Strong consistency | Eventual consistency |
|---|---|---|
| Guarantee | A read always reflects the latest committed write (linearizable) | Reads may be stale; replicas converge if writes stop |
| Cost | Coordination (quorum/consensus) → higher latency, lower availability under partition | Low latency, high availability, cheap |
| Failure behaviour | Unavailable on the minority side of a partition | Keeps serving |
| Geo-distribution | Expensive (cross-region round trips) | Natural |
| Examples | RDBMS single-writer, DynamoDB strongly-consistent read, etcd, Kafka `acks=all` reads from leader | DynamoDB default reads, read replicas, CQRS read models, DNS, S3 cross-region replication |

**The intermediate levels worth naming (Cosmos DB terminology, applicable generally):**
- **Bounded staleness** — stale by at most *k* versions or *t* seconds. Gives a quantified SLA on staleness, which is often exactly what a business needs.
- **Session consistency** — a client always reads its own writes ("read-your-writes"). The default in Cosmos DB and the pragmatic choice for user-facing apps: the user who just made a payment sees it, even if another user doesn't for 200 ms.
- **Consistent prefix** — you never see writes out of order, only possibly behind.

**Practical architecture guidance:** choose per-operation, not per-system.
- Balance check before a debit → **strong** (read from the primary).
- Transaction list on a statement page → **eventual** (read replica) with session consistency so the user's own new transaction appears.
- Fraud scoring on recent activity → **bounded staleness** with an explicit, monitored bound.

And when you use eventual consistency, the design obligations are: make it visible in the UX ("processing…"), make handlers idempotent, handle out-of-order arrival (Q13), and reconcile.

---

## Q4. What is distributed consensus?

**Definition (as used in etcd/Kubernetes and AWS documentation):** consensus is the problem of getting a set of nodes to **agree on a single value (or an ordered log of values) despite failures**. The safety properties are: *agreement* (no two nodes decide differently), *validity* (the decided value was proposed), and *termination* (nodes eventually decide) — with the **FLP impossibility result** showing that termination cannot be guaranteed in a fully asynchronous system with even one faulty node, which is why real algorithms use timeouts/failure detectors and guarantee safety always, liveness usually.

**The algorithms:**
- **Paxos** — the original; correct, notoriously hard to implement.
- **Raft** — designed for understandability; the one to discuss. Uses **leader election** (randomised election timeouts), a **replicated log** (the leader appends and replicates entries), and **commitment by majority quorum**. Implemented by **etcd** (and therefore Kubernetes), Consul, CockroachDB, TiKV.
- **ZAB** — ZooKeeper's atomic broadcast, similar guarantees.
- **Kafka's KRaft** — Kafka's own Raft implementation replacing ZooKeeper for metadata/controller quorum (per the Apache Kafka documentation).

**The quorum arithmetic you must be able to state:** a cluster of *N* nodes tolerates ⌊(N−1)/2⌋ failures and requires a majority ⌊N/2⌋+1 to make progress.

| N | Majority | Failures tolerated |
|---|---|---|
| 3 | 2 | 1 |
| 5 | 3 | 2 |
| 7 | 4 | 3 |

This is why etcd clusters are 3 or 5 nodes and why **even numbers are pointless** (4 nodes tolerate the same 1 failure as 3, with more coordination cost).

**Where you meet it as an architect:** Kubernetes control plane (etcd), leader election for singleton workloads, Kafka controller/ISR management, distributed locks (Q5), and configuration stores. **Guidance: don't implement consensus — use a system that has.** Writing your own Raft is a decade of other people's bugs.

---

## Q5. What is distributed locking?

**Definition:** a mutual-exclusion primitive across processes/nodes so that only one holder can execute a critical section at a time — used for singleton jobs, leader election, and preventing concurrent mutation of a shared resource.

**Implementations and their official positions:**
- **Kubernetes**: `Lease` objects in `coordination.k8s.io` — the documented, supported mechanism for leader election (used by the control-plane components themselves).
- **etcd / Consul / ZooKeeper**: consensus-backed locks with sessions and TTLs — the correct choice when you need real safety.
- **Redis**: `SET key value NX PX <ttl>`; the **Redlock** algorithm is documented by Redis for multi-node locking, but it is explicitly contested (Kleppmann's critique) and Redis's own docs note the safety caveats. Treat Redis locks as an *efficiency* optimisation ("try not to do the work twice"), **not** as a *correctness* guarantee.
- **Database**: `SELECT ... FOR UPDATE`, advisory locks (`pg_advisory_lock`), or a `Leases` table with a conditional update. Simple, transactional, and often the right answer.
- **DynamoDB**: conditional writes with a TTL — a well-documented lock pattern in AWS guidance.
- **Blob/S3 leases**: Azure Blob leases are a first-class documented lock primitive.

**The three failure modes you must name:**
1. **Lock holder dies while holding the lock** → needs a **TTL/lease**, not an indefinite lock.
2. **Lock expires while the holder is still working** (GC pause, network stall) → **two processes believe they hold it**. The mitigation is a **fencing token**: a monotonically increasing number issued with the lock, which the protected resource checks and rejects if lower than the last seen. Without fencing, no distributed lock is safe.
3. **Clock skew / partition** breaks TTL reasoning across nodes (Q14).

**Architect's strong answer:** *"Prefer designs that don't need distributed locks."* Alternatives that are safer and scale better: **partitioning by key** (Kafka partitions or a consistent-hash shard guarantee single-writer per key without any lock), **optimistic concurrency** (version/ETag compare-and-swap), **idempotency** (make duplicate execution harmless), and **single-writer per aggregate** (the DDD approach). Use a lock only for genuine singletons — a nightly batch, a leader-elected scheduler — and always with a lease and a fencing token.

---

## Q6. How do you handle network failures?

**Per AWS Builders' Library and Azure Architecture Center**, the documented pattern set is: **timeouts → retries with exponential backoff and jitter → circuit breaker → fallback/graceful degradation → load shedding**, backed by **idempotency** so retries are safe.

**The layered response:**

1. **Timeouts on every call.** No timeout = infinite hang = thread/connection exhaustion. Budget them so they *decrease* down the chain (§3 Q13).
2. **Retries — transient only, bounded, jittered, idempotent only** (§4 Q27).
3. **Circuit breakers** to stop hammering a dead dependency (§4 Q29).
4. **Bulkheads** so one dependency's failure can't consume all resources (§4 Q30).
5. **Fallbacks / graceful degradation** — cached or stale data, a default, a reduced feature set, or a queued "we'll finish this later" (Q19).
6. **Load shedding** — reject fast with 429/503 when overloaded; AWS's guidance is explicit that *"it is better to reject some requests quickly than to accept all of them and fail slowly."*
7. **Asynchronous messaging** where the interaction allows it — a durable queue survives the network being down entirely, which is the strongest form of network-failure tolerance.
8. **Idempotency + reconciliation** — because a timeout does not tell you whether the operation happened (Q7).

**Health checking nuance (AWS Builders' Library, "Implementing health checks"):** shallow health checks miss dependency failures; deep health checks can cause **correlated failure** where all instances fail health checks simultaneously and the whole fleet is removed from service. The documented mitigation is *fail-open* behaviour at the load balancer: if **all** targets are unhealthy, route to all of them anyway rather than to none. This is exactly why liveness probes must not check dependencies (§10 Q15).

---

## Q7. How do you handle partial failures?

**Per the AWS Builders' Library:** partial failure is the defining property of distributed systems — *"some components fail while others continue"* — and the critical case is the **indeterminate outcome**: a request times out and the caller **cannot know** whether it succeeded.

**The state machine you must reason about:**

```
 Caller sends request ──▶ ??? ──▶ three possible truths:
   (a) request never arrived          → safe to retry
   (b) arrived, succeeded, reply lost → retry would DUPLICATE
   (c) arrived, failed                → safe to retry
 The caller cannot distinguish (a)/(b)/(c) from a timeout.
```

**The engineering answers:**

1. **Idempotency keys.** Make (b) harmless: the retry returns the original result instead of performing the work again (§14 Q14). This is the primary answer.
2. **Status/query endpoints.** Provide `GET /payments/{idempotencyKey}` so a caller in doubt can *ask* rather than guess. Payment schemes call this an inquiry/echo API.
3. **Sagas with compensation** for multi-step operations where a middle step failed (§4 Q18–Q21).
4. **Reconciliation.** Compare your state against the counterparty's authoritative record (settlement file, statement, ledger export) on a schedule; classify breaks as auto-correctable, investigate, or manual. **In financial systems this is mandatory** — it is the control that catches everything the code missed.
5. **Explicit intermediate states.** Model `PENDING`/`UNKNOWN`/`IN_DOUBT` in the domain rather than forcing a binary success/fail. An "in doubt" payment is a real business state with a real operational process behind it.
6. **Timeout budgets and dead-man switches** — if a saga step hasn't reported within X, take a documented action (query, compensate, or escalate).
7. **Design for at-least-once everywhere** and make every effect idempotent, so partial failure degrades to duplicate work rather than incorrect state.

---

## Q8. What is split brain?

**Definition:** during a network partition, **two subsets of a cluster each believe they are the authoritative primary**, and both accept writes. When the partition heals, the two divergent histories conflict — and in a financial system that can mean the same funds spent twice.

```
        ── partition ──
 [A][B] │ [C][D][E]
  ▲                ▲
 thinks it's       also thinks
 the leader        it's the leader
   ⇒ both accept writes ⇒ divergent state
```

**The documented preventions:**

1. **Quorum / majority (the primary answer).** Only a partition holding a **strict majority** may accept writes; the minority side steps down. This is why Raft/etcd/ZooKeeper require ⌊N/2⌋+1 (Q4) and why an even-numbered cluster is a mistake — 2 vs 2 has no majority and the whole cluster becomes unavailable (which is *safe*, just unavailable).
2. **Fencing (STONITH / fencing tokens).** Forcibly isolate or power off the demoted node, or require a monotonically increasing token that the storage layer enforces so stale leaders' writes are rejected.
3. **Leases with TTL.** A leader must continuously renew its lease; if it cannot reach the quorum, it must stop acting as leader *before* the lease expires — this is precisely what Kubernetes `Lease`-based leader election does.
4. **`min.insync.replicas` in Kafka** (per Kafka docs): with `acks=all`, a partition leader that cannot reach enough in-sync replicas **rejects writes** rather than accepting divergent ones — a direct, configurable split-brain guard.
5. **Witness/tiebreaker nodes** in two-datacentre designs, placed in a third failure domain — the standard answer to "we only have two data centres."
6. **Single-writer designs.** Partition by key so only one node may write a given key; no split brain is possible for that key.

**Recovery when it does happen:** you need a documented conflict-resolution policy — last-writer-wins (lossy), CRDTs (convergent by construction), version vectors with application merge, or manual reconciliation. For money, the correct answer is almost always "prevent it with a quorum" rather than "merge it afterwards."

---

## Q9. What is idempotency in distributed systems?

**Per RFC 9110 (HTTP semantics):** *"a request method is considered idempotent if the intended effect on the server of multiple identical requests with that method is the same as the effect for a single such request."*
**Per AWS documentation (e.g. EC2 client tokens, Lambda Powertools idempotency, SQS):** clients supply a **client token / idempotency key** so that *"if you retry a request, the service returns the result of the original request rather than performing the operation again."*

**Why it is *the* foundational property here:** networks force at-least-once delivery; at-least-once means duplicates; duplicates are only safe if effects are idempotent. Therefore:

> **exactly-once *effect* = at-least-once *delivery* + idempotent *processing*.**

That identity is the single most important sentence in distributed-systems interviews, and it recurs in §7, §8 and §14.

**Where you must apply it:**
- **API layer** — `Idempotency-Key` header on every non-idempotent POST (payments, transfers, orders).
- **Message consumers** — de-duplication store keyed on a stable message ID, committed with the work (§4 Q25).
- **Saga steps and compensations** — both will be retried.
- **Event handlers building read models** — use versions so replays don't double-apply.
- **Batch jobs** — a re-run must not double-post.

**Design techniques:** absolute rather than relative updates (`SET balance = 500` vs `balance = balance + 100`); conditional updates guarded by current state (`WHERE Status='AUTHORIZED'`); upserts with a business key; optimistic concurrency versions; and de-duplication tables with a retention window that exceeds the maximum redelivery window.

---

## Q10. How do you guarantee exactly-once business processing?

**Start by stating the impossibility precisely, then give the engineering answer** — this is the highest-signal question in the section.

**Per the Apache Kafka documentation and general distributed-systems theory:** exactly-once *message delivery* is impossible across an unreliable network (the Two Generals problem). What Kafka provides is **exactly-once *processing semantics* (EOS)** within its own boundary: idempotent producers + transactions spanning consume→process→produce, so the *read-process-write* cycle is atomic **with respect to Kafka topics and the consumer offsets**. It does **not** extend to your database or to an external HTTP API.

**So the practical guarantee you engineer is:**

> **exactly-once effect = at-least-once delivery + idempotent, transactional processing + reconciliation.**

**The concrete recipe:**

1. **At-least-once delivery.** Producer with `acks=all`, `enable.idempotence=true`, retries; durable outbox on the producing side so nothing is lost (§4 Q22).
2. **Idempotent consumption with an atomic dedup+work commit.** The processed-message record and the business change commit in **one local transaction** (§4 Q25). If they can't be in one transaction (e.g. the effect is an external API call), use an idempotency key at that API and record the outcome.
3. **Commit offsets after the work, never before.** Committing first turns a crash into *lost* messages (at-most-once).
4. **Idempotency at every external boundary** — the payment scheme, the notification provider, the ledger.
5. **Ordering where it matters** — partition by aggregate key so per-entity operations are serialised.
6. **Reconciliation and monitoring** — a scheduled comparison against the authoritative record, with break classification. This is what makes the guarantee *auditable* rather than merely *claimed*.

**The sentence to close on:** *"I don't promise exactly-once delivery — that isn't achievable. I promise exactly-once **effect**, built from at-least-once delivery plus idempotent processing, and I prove it with reconciliation."*

---

## Q11. At-most-once vs at-least-once vs exactly-once?

**Per the Apache Kafka documentation ("Message Delivery Semantics"), which defines all three:**

| Semantic | Definition | Mechanism | Failure mode | Use for |
|---|---|---|---|---|
| **At-most-once** | Messages may be lost but are never redelivered | Commit offset / ack **before** processing; producer `acks=0`, no retries | **Data loss** | Metrics, telemetry, logs, cache warming — anything where loss is cheaper than duplication |
| **At-least-once** | Messages are never lost but may be redelivered | Commit offset / ack **after** processing; producer retries | **Duplicates** | The default and correct choice for almost all business processing |
| **Exactly-once** | Each message affects state exactly once | Kafka transactions (EOS) within Kafka; **or** at-least-once + idempotent consumer for anything crossing a boundary | Complexity, throughput cost, and it does not extend beyond the transactional boundary | Financial ledgers, billing, stateful stream processing |

**The decision that produces each semantic is literally one line of code — the order of "commit" and "process":**

```csharp
// AT-MOST-ONCE: offset committed first — a crash here loses the message
consumer.Commit(msg);
await ProcessAsync(msg);

// AT-LEAST-ONCE: processed first — a crash here redelivers the message
await ProcessAsync(msg);
consumer.Commit(msg);
```

**Kafka's exactly-once support, stated accurately:** `enable.idempotence=true` (deduplicates producer retries per partition via producer ID + sequence number), `transactional.id` with `initTransaction`/`beginTransaction`/`sendOffsetsToTransaction`/`commitTransaction` (atomic consume-process-produce), and `isolation.level=read_committed` on consumers so they never see aborted-transaction records. Kafka Streams sets this up with `processing.guarantee=exactly_once_v2`.

**The architect's caveat, always:** EOS is exactly-once **within Kafka**. The moment you write to PostgreSQL or call Visa, you are back to at-least-once and you need idempotency at that boundary.

---

## Q12. How do you handle duplicate requests?

**At the API layer, the documented pattern is the idempotency key** (Stripe's public API design, AWS client tokens, and the IETF `Idempotency-Key` header draft all specify the same shape):

```http
POST /v1/payments
Idempotency-Key: 8f14e45f-ea8d-4f0b-bd3e-2b1a9c9f0a11
Content-Type: application/json
```

**Server algorithm — state each step:**

```
1. Extract key. Missing on a non-idempotent POST → 400 (make it mandatory).
2. Atomically INSERT (key, requestHash, status='IN_PROGRESS') with the key as PRIMARY KEY.
   - Insert succeeds  → this is the first attempt: proceed.
   - PK violation     → a previous attempt exists: go to 3.
3. Load the existing record:
   - status = COMPLETED and requestHash matches → return the STORED response (same status code + body).
   - status = IN_PROGRESS                       → return 409 Conflict (or 425 Too Early) — a retry is in flight.
   - requestHash DIFFERS for the same key       → 422 Unprocessable — the client reused a key for
                                                   different content; this is a client bug and must be surfaced.
4. On completion, store the response body + status against the key, atomically with the business work.
5. Expire keys after a documented TTL (24h–7d) and say so in the API docs.
```

**Critical details that separate a good answer from a great one:**
- **Store the request fingerprint (hash)**, not just the key — otherwise a client that reuses a key for a different payment silently gets the wrong response.
- **The response must be stored with the business transaction** (same DB transaction), or a crash after commit but before storing leaves the retry to re-execute.
- **Scope the key** to the client/tenant so two customers cannot collide.
- **Concurrent duplicates** (two identical requests in flight) are handled by the atomic insert in step 2 — this is why it must be an insert with a uniqueness constraint, not a read-then-write.

**Complementary layers:** natural idempotency in the domain (conditional state transitions), client-side deduplication, and gateway-level replay protection with nonces + timestamps for security-sensitive endpoints (§16 Q24).

---

## Q13. How do you handle out-of-order events?

**Why it happens:** multiple partitions/queues, parallel consumers, retries, redeliveries after a DLQ replay, and multiple producers. Ordering is only guaranteed **within a Kafka partition** (per the Kafka docs: *"Kafka only provides a total order over records within a partition, not between different partitions in a topic"*) or within a FIFO queue's message group (per the SQS FIFO docs).

**Six strategies, in the order I would consider them:**

1. **Design the ordering guarantee in.** Partition by the entity key (`accountId`, `orderId`) so all events for one entity land on one partition and are consumed in order by one consumer. **This is the primary answer** — it converts a global-ordering problem into a per-key one, which is all the business actually needs. SQS FIFO's `MessageGroupId` is the same idea.
2. **Version / sequence numbers.** Each event carries a monotonic version per aggregate; the consumer applies only if `event.version == currentVersion + 1`, buffers if higher (gap), and discards if lower (stale). This is exactly how event-sourced projections stay correct.
3. **Idempotent, commutative updates.** Design the effect so order doesn't matter — set-based operations, last-write-wins with a timestamp/version, CRDTs. `SET status = X WHERE version < n` is naturally safe.
4. **Buffering / reordering window.** Hold events briefly and sort by sequence — used in stream processing with **watermarks** and **allowed lateness** (Kafka Streams / Flink event-time processing). Bounded memory, bounded delay; you must define what happens to events arriving after the window.
5. **State machines that tolerate arrival order.** Model the aggregate so that receiving `Settled` before `Authorized` is a legal (if odd) transition that parks the entity in a `PENDING_PRIOR_EVENT` state until the gap fills.
6. **Detect and repair.** Alert on sequence gaps; reconcile against the source.

**Explicitly reject** the naive approach: **do not order by wall-clock timestamp across producers** — clock skew makes it wrong (Q14). Order by a logical sequence (per-aggregate version, Lamport clock, or Kafka offset within a partition).

---

## Q14. How do you handle clock differences?

**The problem:** there is no global clock. NTP typically keeps servers within a few milliseconds but can drift to seconds; VMs suffer clock jumps on migration; leap seconds and daylight-saving transitions cause discontinuities. Therefore **you cannot order distributed events by comparing wall-clock timestamps**, and "which write is newer" is not answerable by timestamp alone.

**The documented mitigations:**

1. **Logical clocks for ordering.**
   - **Lamport timestamps** — a counter incremented on each event and carried in messages; gives a consistent *total* order (with tie-breaking) but cannot detect concurrency.
   - **Vector clocks / version vectors** — detect true concurrency and conflicts (used by Dynamo-style stores).
   - **Per-aggregate version numbers** — the simplest and usually sufficient (Q13).
2. **Sequence numbers from a single authority** — a Kafka partition offset, a database sequence, or a monotonic ID service (Snowflake-style IDs embed a timestamp *and* a sequence).
3. **Tight time synchronisation where you genuinely need time.** **AWS Time Sync Service** (documented in the EC2 user guide) provides NTP via the link-local 169.254.169.123 address, with **microsecond-accurate clocks** and **ClockBound** for bounded-error time on supported instances. Google's TrueTime and AWS's ClockBound both work by exposing an **error interval** — "the time is somewhere in [earliest, latest]" — which lets you make *safe* decisions ("A definitely happened before B") rather than guesses.
4. **Always store and transmit UTC**, ISO-8601 with an explicit offset, and never do business logic on local times. Store the user's time zone separately if you need to render it.
5. **Use monotonic clocks for durations.** `Stopwatch` / `Environment.TickCount64` / `CLOCK_MONOTONIC` are immune to NTP adjustments; `DateTime.UtcNow` is not. Measuring elapsed time with wall-clock is a real bug (an NTP step backwards yields negative durations).
6. **Design tolerance into protocols.** JWT validation has a `ClockSkew` allowance (default 5 minutes in .NET — tighten it deliberately); TOTP accepts ±1 window; certificate validity has margins.
7. **Monitor drift** — export NTP offset as a metric and alert; clock skew is an invisible cause of very confusing bugs.

---

## Q15. What is correlation ID?

**Definition and standard:** a unique identifier attached to a logical business operation and propagated across every service, message and log line it touches, so the whole flow can be reconstructed. The **W3C Trace Context** specification standardises the wire format for this — the `traceparent` header carrying `version-trace-id-parent-id-trace-flags`, plus `tracestate` for vendor data. .NET implements it natively via `System.Diagnostics.Activity` (per Microsoft Learn's distributed-tracing documentation).

**Distinguish the three identifiers — a common follow-up:**

| ID | Scope | Purpose |
|---|---|---|
| **Trace ID** | The whole distributed trace | Ties all spans across all services together |
| **Span ID** | One operation within one service | Parent/child structure of the trace |
| **Correlation ID** | The **business** operation (may span multiple traces, hours apart) | Ties an async workflow — order → payment → settlement → notification — into one narrative |

They overlap but are not the same: a trace usually ends when a request ends; a correlation/business ID lives for the life of the transaction, including days-later settlement.

**Implementation rules:**
- **Accept it if provided** (`traceparent`, or an `X-Correlation-ID` from an edge gateway), **generate it if not**, at the outermost boundary.
- **Propagate it on every hop** — HTTP headers automatically via OpenTelemetry; **message headers manually** for Kafka/SQS (this is the hop people forget, and it breaks the trace exactly where it's most needed).
- **Put it on every log line** (log scopes / enrichers) and **return it to the client** in the response and in error `ProblemDetails`, so a support ticket contains the key that finds the logs.
- **Store it against business records** (the payment row keeps the correlation ID) so you can go from a customer complaint to the full technical trace.

---

## Q16. How do you trace a distributed transaction?

**Per Microsoft Learn ("Distributed tracing in .NET") and the OpenTelemetry specification:** instrument with `ActivitySource`/OpenTelemetry, propagate **W3C Trace Context**, export spans via OTLP to a backend (Jaeger, Tempo, X-Ray, Application Insights, Datadog), and correlate with logs and metrics.

**The end-to-end method:**

1. **Instrument automatically first.** `AddAspNetCoreInstrumentation`, `AddHttpClientInstrumentation`, `AddSqlClientInstrumentation`, plus the Kafka/messaging instrumentation. This gets you 80 % of the picture for free.
2. **Add business spans** for meaningful operations with low-cardinality names and high-value tags (`payment.id`, `payment.scheme`, `saga.id`, `tenant.id`) — never PII or PANs.
3. **Propagate through the broker.** Inject `traceparent` into Kafka message headers on publish; extract and set as parent link on consume. Without this the trace terminates at the broker.
4. **Link, don't nest, for async fan-out.** Use span **links** when one event triggers many independent consumers, so the trace tree stays meaningful.
5. **Sample intelligently.** Head-based ratio sampling is cheap; **tail-based sampling in the OpenTelemetry Collector** keeps 100 % of errors and slow traces — the right choice at volume.
6. **Correlate the three pillars.** Logs carry `trace_id`; metrics carry exemplars pointing at traces; traces link to logs. One click from "p99 spiked" to "this exact request."
7. **Add a business-level view.** For a saga, maintain a queryable saga state store keyed by correlation ID — traces expire, but the business audit trail must not. In regulated finance you also need an immutable audit log (§17 Q14) that outlives your APM retention.

**AWS-specific:** X-Ray with the ADOT (AWS Distro for OpenTelemetry) collector; note X-Ray's own header (`X-Amzn-Trace-Id`) and configure propagation for both formats when traffic crosses API Gateway/ALB/Lambda.

---

## Q17. How do you design for failure?

**Per the AWS Well-Architected Framework (Reliability Pillar), the design principles are explicit:** *automatically recover from failure, test recovery procedures, scale horizontally to increase aggregate availability, stop guessing capacity,* and *manage change through automation.* Azure's Well-Architected Framework (Reliability pillar) states the same in terms of *"design for failure — assume components will fail and design so the application continues to function."*

**The checklist I would present:**

**1. Eliminate single points of failure.** Multiple instances, multiple AZs (minimum 3 for quorum-based systems), multi-region for the highest tiers. Redundancy at every layer including the "obvious" ones — NAT gateways, DNS, CI/CD.

**2. Isolate blast radius.** Bulkheads, cell-based architecture, shuffle sharding, per-tenant partitioning, separate critical from non-critical workloads.

**3. Degrade gracefully, don't fail totally.** Define, per feature, what "reduced service" means (Q19).

**4. Make everything retryable and idempotent** so automated recovery is safe.

**5. Bound everything.** Timeouts, retries, queue depths, concurrency, payload sizes, result-set sizes. Unbounded anything is an outage waiting for load.

**6. Prefer asynchronous, durable communication** for anything that doesn't need a synchronous answer — a queue survives a downstream outage; an HTTP call does not.

**7. Automate detection and recovery.** Health checks, auto-scaling, auto-healing (Kubernetes restarts, ASG replacement), automated rollback on SLO breach.

**8. Make state recoverable.** Backups *tested by restore*, point-in-time recovery, event logs/audit trails, and documented RPO/RTO per data class (§9 Q45).

**9. Test the failure paths.** Chaos engineering (AWS Fault Injection Service, Azure Chaos Studio), game days, dependency-failure drills, regular DR exercises. AWS's principle is *"test recovery procedures"* — an untested DR plan is a document, not a capability.

**10. Observe and alert on symptoms, not causes.** SLOs and error budgets; alert on customer-visible degradation, not on CPU.

**Closing statement:** *"I design assuming every dependency will be slow, unavailable or wrong at some point — and I decide, in advance and in writing, what the system does in each case."*

---

## Q18. How do you implement retries safely?

**Safety has four conditions — state them as conditions, then show the code:**

1. **The operation must be idempotent** (natively, or via an idempotency key). Retrying a non-idempotent money movement is how double-charges happen.
2. **Only transient failures are retried.** Timeouts, connection resets, 429, 502/503/504, DB deadlocks/throttling. Never 4xx business errors.
3. **Bounded attempts + bounded total time**, with **exponential backoff and jitter** (per AWS's published guidance, jitter is what actually prevents synchronised retry waves).
4. **A circuit breaker outside the retry** so a persistently failing dependency isn't hammered, and **retries at exactly one layer** so they don't multiply.

```csharp
builder.Services.AddHttpClient<ILedgerClient, LedgerClient>()
    .AddResilienceHandler("ledger", b => b
        .AddTimeout(TimeSpan.FromSeconds(10))                       // total budget (outermost)
        .AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
        {
            FailureRatio = 0.5, MinimumThroughput = 20,
            SamplingDuration = TimeSpan.FromSeconds(30),
            BreakDuration = TimeSpan.FromSeconds(15)
        })
        .AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = 3,
            BackoffType = DelayBackoffType.Exponential,
            UseJitter = true,
            ShouldHandle = args => ValueTask.FromResult(
                args.Outcome.Result?.StatusCode is HttpStatusCode.RequestTimeout
                    or HttpStatusCode.TooManyRequests
                    or HttpStatusCode.BadGateway
                    or HttpStatusCode.ServiceUnavailable
                    or HttpStatusCode.GatewayTimeout
                || args.Outcome.Exception is HttpRequestException or TimeoutRejectedException)
        })
        .AddTimeout(TimeSpan.FromSeconds(2)));                      // per-attempt (innermost)
```

**Additional rules:**
- **Honour `Retry-After`** when the server sends it — it is the server telling you the correct backoff.
- **Send the same idempotency key on every attempt** of the same logical operation (a new key per attempt defeats the whole mechanism).
- **Retry budgets** (a token bucket capping retries at ~10 % of base traffic) for the strongest storm protection (§4 Q28).
- **For messages**, prefer a delayed retry topic/queue over in-process sleeping — in-process retries hold a consumer slot and block the partition.
- **Log and meter retries** (`retry_count`, `retry_exhausted`) — a rising retry rate is an early warning that precedes an outage.

---

## Q19. How do you design graceful degradation?

**Per the Azure Well-Architected Framework and AWS Builders' Library:** the goal is that *partial failure produces partial functionality*, not total failure. AWS frames the associated tactic as **static stability** — *"a system that continues to operate correctly when a dependency is impaired, without needing to make changes"* — for example by pre-provisioning capacity and relying on cached/last-known-good data rather than on a control plane being available.

**The method:**

1. **Classify every feature by criticality.**
   | Tier | Example (payments platform) | Behaviour when its dependency fails |
   |---|---|---|
   | **Critical** | Authorise a payment, check balance | Must work; multi-AZ, redundant paths; failure = incident |
   | **Important** | Transaction history, statements | Serve cached/stale with a "last updated" marker |
   | **Nice-to-have** | Recommendations, spending insights, marketing banners | Hide the component entirely; never let it fail the page |

2. **Define the fallback per dependency, in writing**, before the incident:
   - **Cache/stale data** — serve the last known good value, labelled as such.
   - **Default value** — a conservative default (e.g. apply the standard fee if the pricing service is down).
   - **Queue for later** — accept the request, return 202, process when the dependency recovers. Best answer for writes.
   - **Reduced fidelity** — skip enrichment, return the core fields only.
   - **Feature flag off** — kill switch for a non-critical feature; also the fastest incident mitigation you have.
   - **Fail closed** — for security and fraud decisions, degrade to *deny*, never to *allow*. Say this explicitly in a fintech interview: a fraud-service outage must not become an open door.

3. **Implement with circuit breakers + fallbacks**, so degradation is automatic and fast rather than a 30-second timeout per request.

4. **Shed load deliberately** under overload: prioritise critical traffic, reject low-priority requests with 429/503 fast, and keep the queue short.

5. **Make degradation visible** — to users ("balances may be delayed"), to operators (a metric per degraded mode, alerting on it), and to the business (a dashboard of which features are currently degraded).

6. **Test it.** Chaos/game-day exercises that actually disable a dependency in a pre-production (or carefully scoped production) environment. Degradation paths that have never run *do not work* — that is the most common finding in a real game day.

---

## Q20. How do you design a highly available distributed system?

**Frame it with the availability arithmetic first, then the architecture — per the AWS Well-Architected Reliability Pillar's workload-availability guidance.**

| Availability | Downtime/year | Typical design |
|---|---|---|
| 99.9 % | 8.8 h | Multi-AZ, single region, automated failover |
| 99.95 % | 4.4 h | Multi-AZ + read replicas + fast failover + canary deploys |
| 99.99 % | 52.6 min | Multi-AZ everything, cell-based isolation, no manual steps in recovery |
| 99.999 % | 5.3 min | Multi-region active-active, extreme automation, very few dependencies |

**Two arithmetic facts to state:**
- **Serial dependencies multiply:** 4 services at 99.9 % in a chain = 99.6 %. Reduce hard dependencies, or make them soft (degradable).
- **Redundant components add nines:** two independent 99 % components in parallel = 99.99 %, *if* their failures are truly independent — which is why correlated failure (shared AZ, shared config push, shared dependency) is the real enemy.

**The design:**

1. **Redundancy everywhere, across failure domains.** ≥3 AZs; N+2 capacity so you survive an AZ loss *and* a deployment simultaneously. Multi-region for tier-1.
2. **Stateless compute** behind health-checked load balancers, auto-scaled, auto-healed.
3. **Data tier HA:** synchronous replication within a region (RDS Multi-AZ / Aurora), asynchronous cross-region (read replicas / global tables) with an explicit RPO. Quorum-based stores sized 3 or 5.
4. **Isolation:** cells/shards/shuffle sharding so one bad tenant or one bad partition affects a bounded fraction of customers.
5. **Static stability** — the system keeps working when the control plane is unavailable; pre-provision capacity rather than depending on scaling *during* an event.
6. **Asynchronous, durable messaging** for cross-service state changes, so a downstream outage becomes latency rather than failure.
7. **Resilience patterns at every call:** timeouts, jittered retries, circuit breakers, bulkheads, load shedding, graceful degradation.
8. **Correctness under partition decided per subsystem** (CP for the ledger, AP for browse/read paths) — and documented.
9. **Safe change:** canary/blue-green, automated rollback on SLO breach, expand/contract migrations, feature flags. **Change is the leading cause of outages** — most availability comes from deployment discipline, not from more replicas.
10. **Operational readiness:** SLOs + error budgets, alerting on symptoms, runbooks linked from alerts, tested DR with real RPO/RTO numbers, and regular game days.

**Closing line:** *"Availability is a property of the whole socio-technical system. The architecture buys you the ceiling; deployment discipline, observability and tested recovery decide whether you actually reach it."*

---

## References — official documentation

| Topic | Source |
|---|---|
| Challenges with distributed systems (AWS Builders' Library) | https://aws.amazon.com/builders-library/challenges-with-distributed-systems/ |
| AWS Well-Architected Framework — Reliability Pillar | https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html |
| Azure Well-Architected Framework — Reliability | https://learn.microsoft.com/azure/well-architected/reliability/ |
| Data consistency primer / CAP guidance (Azure) | https://learn.microsoft.com/azure/architecture/guide/design-principles/ |
| Cosmos DB consistency levels (the consistency spectrum) | https://learn.microsoft.com/azure/cosmos-db/consistency-levels |
| DynamoDB read consistency | https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html |
| etcd / Raft in Kubernetes | https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/ |
| Kubernetes leader election (`Lease`) | https://kubernetes.io/docs/concepts/architecture/leases/ |
| Redis distributed locks (and caveats) | https://redis.io/docs/latest/develop/use/patterns/distributed-locks/ |
| Kafka — message delivery semantics | https://kafka.apache.org/documentation/#semantics |
| Kafka — idempotent producer & transactions | https://kafka.apache.org/documentation/#producerconfigs_enable.idempotence |
| Kafka — ordering within a partition | https://kafka.apache.org/documentation/#intro_topics |
| Amazon SQS FIFO queues (ordering, dedup) | https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues.html |
| HTTP semantics — idempotent methods (RFC 9110) | https://www.rfc-editor.org/rfc/rfc9110#name-idempotent-methods |
| Timeouts, retries and backoff with jitter (AWS) | https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/ |
| Exponential backoff and jitter (AWS blog) | https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ |
| Implementing health checks (AWS Builders' Library) | https://aws.amazon.com/builders-library/implementing-health-checks/ |
| Static stability using Availability Zones (AWS) | https://aws.amazon.com/builders-library/static-stability-using-availability-zones/ |
| Workload isolation using shuffle sharding (AWS) | https://aws.amazon.com/builders-library/workload-isolation-using-shuffle-sharding/ |
| Using load shedding to avoid overload (AWS) | https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/ |
| W3C Trace Context specification | https://www.w3.org/TR/trace-context/ |
| Distributed tracing in .NET | https://learn.microsoft.com/dotnet/core/diagnostics/distributed-tracing |
| OpenTelemetry specification | https://opentelemetry.io/docs/specs/otel/ |
| AWS Time Sync Service / ClockBound | https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/set-time.html |
| Retry / Circuit Breaker / Bulkhead patterns | https://learn.microsoft.com/azure/architecture/patterns/ |

---

**Previous:** [04 — Microservices](./04-Microservices.md) | **Next:** [06 — Design Patterns](./06-Design-Patterns.md)
