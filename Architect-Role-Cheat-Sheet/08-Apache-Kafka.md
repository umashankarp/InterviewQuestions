# 8. Apache Kafka — 34 Questions (Answered)

> **Method:** every definition is taken from the **Apache Kafka documentation** (kafka.apache.org/documentation) — the official design, configuration and semantics sections — supplemented by **AWS MSK** and **Confluent** documentation where operational guidance is needed. Then the architect-level trade-off. Links in **References**.

---

## Q1. What is Kafka?

**Per the Apache Kafka documentation:** *"Apache Kafka is an open-source distributed event streaming platform."* The docs define its three core capabilities:

> 1. *"To **publish** (write) and **subscribe to** (read) streams of events, including continuous import/export of your data from other systems."*
> 2. *"To **store** streams of events durably and reliably for as long as you want."*
> 3. *"To **process** streams of events as they occur or retrospectively."*

**The distinguishing property, stated plainly:** Kafka is **not a message queue** — it is a **distributed, replicated, append-only commit log**. Messages are **not deleted when consumed**; they persist for a configured retention period (time or size based), and consumers track their own position (**offset**) in the log. Everything else — replay, multiple independent consumers, stream processing, event sourcing — follows from that one design decision.

**Why it performs the way it does** (from the Kafka design docs):
- **Sequential disk I/O** — appending to a log file is one of the fastest things a disk does; Kafka deliberately relies on the OS page cache rather than an in-JVM cache.
- **Zero-copy transfer** (`sendfile`) — data goes from page cache to socket without passing through user space.
- **Batching and compression** — the producer batches records; compression is applied per batch, which compresses far better than per message.
- **Partitioned parallelism** — throughput scales with partition count, not with a single broker's capacity.

**Where it fits architecturally:** the durable event backbone of an event-driven platform — the system of record for "what happened", feeding microservices, stream processors, data lakes and analytics from one write.

---

## Q2. Explain Kafka architecture.

**Per the Kafka documentation**, a Kafka deployment is *"a distributed system consisting of servers and clients that communicate via a high-performance TCP network protocol"*.

```
 Producers ──▶ ┌──────────────────── Kafka cluster ────────────────────┐ ──▶ Consumers
               │ Broker 1        Broker 2         Broker 3             │
               │ ┌──────────┐    ┌──────────┐     ┌──────────┐         │
               │ │ P0 (L)   │    │ P0 (F)   │     │ P0 (F)   │         │  Consumer Group A
               │ │ P1 (F)   │    │ P1 (L)   │     │ P1 (F)   │         │  Consumer Group B
               │ │ P2 (F)   │    │ P2 (F)   │     │ P2 (L)   │         │  (independent offsets)
               │ └──────────┘    └──────────┘     └──────────┘         │
               │        Controller quorum (KRaft) — cluster metadata    │
               └───────────────────────────────────────────────────────┘
                                                       L = leader, F = follower
```

**Server side:**
- **Brokers** — servers that store partitions, serve reads/writes, and replicate.
- **Controller** — manages cluster metadata, partition leadership and reassignment. Historically held in **ZooKeeper**; since Kafka 3.3 the recommended and (from Kafka 4.0) the only mode is **KRaft**, where a quorum of controllers runs Kafka's own Raft implementation and stores metadata in an internal metadata log.
- **Kafka Connect** — a framework for continuous import/export to external systems (databases, S3, Elasticsearch).

**Client side:**
- **Producers** — write records to topic partitions; choose a partition by key hash, explicit partition, or the sticky partitioner.
- **Consumers** — read from partitions; organised into **consumer groups** where each partition is assigned to exactly one member of the group.
- **Kafka Streams** — a client library for stateful stream processing with exactly-once semantics.

**Logical model:** topics → partitions → ordered, immutable sequence of records, each with an offset, key, value, timestamp and headers. Partitions are replicated across brokers with one **leader** and N−1 **followers**.

---

## Q3. What is a broker?

**Per the Kafka documentation:** a broker is a Kafka **server** — *"the storage layer"* — that hosts partitions, accepts writes from producers, serves fetch requests to consumers, and participates in replication.

**What a broker actually does:**
- **Stores partition data** as **segment files** on disk (a partition is a directory; the log is split into segments with `.log`, `.index`, `.timeindex` files), appending sequentially.
- **Acts as leader** for some partitions and **follower** for others — leadership is spread across the cluster so that write load is balanced rather than concentrated.
- **Handles replication** — followers fetch from the leader exactly like a consumer does.
- **Enforces retention** — deleting or compacting segments per `retention.ms`/`retention.bytes`/`cleanup.policy`.
- **Serves metadata** so clients can discover which broker leads which partition (clients then connect directly to the leader — Kafka has no proxy layer on the data path).

**Key operational facts:**
- Each broker has a unique `broker.id`.
- **Bootstrap servers** are only a starting point for metadata discovery; clients then talk directly to partition leaders.
- Broker sizing is dominated by **disk throughput, page cache (RAM) and network**, not CPU — except when TLS or broker-side compression is enabled.
- A production cluster is **minimum 3 brokers** so that replication factor 3 is possible and one broker can be lost without losing availability of `min.insync.replicas=2`.
- Brokers should be spread across **availability zones**, with `broker.rack` set so Kafka's rack-aware replica assignment places replicas in different AZs.

---

## Q4. What is a topic?

**Per the Kafka documentation:** *"Events are organized and durably stored in topics. A topic is similar to a folder in a filesystem, and the events are the files in that folder... Topics in Kafka are always multi-producer and multi-subscriber: a topic can have zero, one, or many producers that write events to it, as well as zero, one, or many consumers that subscribe to these events."*

Critically, the docs state: *"unlike traditional messaging systems, events are not deleted after consumption. Instead, you define for how long Kafka should retain your events through a per-topic configuration setting."*

**The configuration that matters architecturally:**

| Setting | Meaning | Typical production value |
|---|---|---|
| `partitions` | Parallelism unit; **can be increased but never decreased** | Sized to target throughput and consumer count |
| `replication.factor` | Copies of each partition | **3** |
| `min.insync.replicas` | Replicas that must ack an `acks=all` write | **2** |
| `retention.ms` | How long records are kept | 7 days default; longer for replayable event logs |
| `cleanup.policy` | `delete` (time/size) or **`compact`** (keep the latest value per key) | `delete` for events, `compact` for state/changelog topics |
| `max.message.bytes` | Largest record | 1 MB default — raise deliberately, and match on the consumer |

**Log compaction is worth calling out:** with `cleanup.policy=compact`, Kafka retains **at least the last known value for each key** indefinitely, so the topic becomes a durable, replayable *snapshot of current state* rather than a window of recent events. This is how Kafka Streams state stores, `__consumer_offsets`, and change-data-capture "table" topics work.

**Naming and governance:** topics are a published contract. Use a convention (`<domain>.<entity>.<event>.<version>` — `payments.authorization.completed.v1`), enforce it, and treat topic creation as a reviewed change (disable `auto.create.topics.enable` in production — auto-created topics get default partition counts and replication factors, which is how you end up with an RF=1 topic in production).

---

## Q5. What is a partition?

**Per the Kafka documentation:** *"Topics are partitioned, meaning a topic is spread over a number of 'buckets' located on different Kafka brokers. This distributed placement of your data is very important for scalability because it allows client applications to both read and write the data from/to many brokers at the same time. When a new event is published to a topic, it is actually appended to one of the topic's partitions. Events with the same event key... are written to the same partition, and Kafka guarantees that any consumer of a given topic-partition will always read that partition's events in exactly the same order as they were written."*

**A partition is simultaneously four things — this framing scores well:**

| It is the unit of… | Because |
|---|---|
| **Ordering** | Records are ordered *within* a partition, and only there |
| **Parallelism** | One partition → at most one consumer per group; partition count caps consumer parallelism |
| **Storage/distribution** | Partitions are spread across brokers; a topic can exceed one broker's disk |
| **Replication** | Replication is defined per partition (one leader, N−1 followers) |

**Physical structure:** a partition is an ordered, immutable sequence of records on disk, split into **segments**. Only the active segment is written to; closed segments are candidates for deletion or compaction. Each record's position is its **offset**.

**Sizing guidance (the practical question behind the theory):**
- Start from throughput: measure per-partition throughput (typically 10–50 MB/s), divide target throughput, then **add headroom** — because you cannot reduce partitions later.
- Also from parallelism: partitions ≥ maximum number of consumers you expect in any group.
- **Don't over-partition:** each partition costs open file handles, memory, replication traffic and controller metadata; more partitions increase end-to-end latency and rebalance time, and increase unavailability window during a broker failure. Tens of thousands of partitions per cluster is a real operational limit (much higher with KRaft than with ZooKeeper).
- **Increasing partitions breaks key→partition affinity** (`hash(key) % partitionCount` changes), so ordering per key is broken across the change. Plan capacity up front.

---

## Q6. What is an offset?

**Per the Kafka documentation:** each record in a partition is assigned *"a sequential id number called the offset that uniquely identifies each record within the partition"*. The docs note: *"the Kafka cluster durably persists all published records... the only metadata retained on a per-consumer basis is the offset or position of that consumer in the log."*

**Three offsets you must distinguish:**

| Offset | Meaning |
|---|---|
| **Log end offset (LEO)** | The offset of the next record to be written to the partition |
| **High watermark (HW)** | The highest offset replicated to **all in-sync replicas** — consumers can only read *up to* this, which is what makes reads consistent under failover |
| **Committed offset** | The consumer group's saved position, stored in the internal `__consumer_offsets` topic |

**Consumer offset management (the part with production consequences):**
- **`enable.auto.commit=true`** (default) commits every `auto.commit.interval.ms` (5 s) — **on poll, for records already returned**. This means a crash can either lose messages (records returned but not processed, offset committed) or reprocess them. **In production I disable auto-commit** and commit explicitly after processing, to get deterministic at-least-once semantics.
- **`auto.offset.reset`** (`earliest` | `latest` | `none`) controls behaviour when there is **no committed offset** or the committed offset is out of range. `latest` on a new consumer group silently skips all existing data — a classic "why didn't my consumer see anything?" incident.
- **Offsets are per (group, topic, partition)** — which is exactly why two consumer groups read the same topic independently.
- **Seeking** — `seek()`, `seekToBeginning()`, or `kafka-consumer-groups --reset-offsets` gives you **replay**, the capability queues do not have.

**Commit order determines delivery semantics** (§7 Q10): process-then-commit = at-least-once; commit-then-process = at-most-once.

---

## Q7. What is a consumer group?

**Per the Kafka documentation:** *"Consumers label themselves with a consumer group name, and each record published to a topic is delivered to one consumer instance within each subscribing consumer group... If all the consumer instances have the same consumer group, then the records will effectively be load balanced over the consumer instances. If all the consumer instances have different consumer groups, then each record will be broadcast to all the consumer processes."*

That single paragraph gives Kafka **both** messaging models: queueing (one group, many members) and publish-subscribe (many groups).

```
topic: payments (4 partitions)

Group "ledger"        P0→c1  P1→c1  P2→c2  P3→c2      (2 consumers, work split)
Group "fraud"         P0→f1  P1→f2  P2→f3  P3→f4      (4 consumers, full parallelism)
Group "analytics"     P0..P3→a1                        (1 consumer, all partitions)

Each group has its OWN committed offsets — they do not interfere.
```

**The rules that follow:**
- **Each partition is assigned to exactly one consumer within a group** — this is what preserves per-partition ordering.
- **A consumer may hold many partitions**; a partition is never split across consumers in a group.
- **Group membership is coordinated by a broker acting as the group coordinator**, using heartbeats (`heartbeat.interval.ms`, `session.timeout.ms`) and `max.poll.interval.ms` to detect failures.
- **Adding/removing a member triggers a rebalance** (Q16).
- The **`group.id` is a durable identity** — changing it starts consumption from `auto.offset.reset`, which in production means either reprocessing everything or skipping everything. Treat `group.id` as part of the deployment contract.

---

## Q8. How does Kafka achieve scalability?

**Per the Kafka documentation's design section**, scalability comes from partitioning plus a set of deliberate performance choices:

**1. Horizontal scale through partitioning.** A topic's partitions are spread across brokers, so writes and reads are served by many machines in parallel. Adding brokers and partitions increases capacity roughly linearly. Consumers scale by adding members to a group, up to the partition count.

**2. Sequential disk I/O.** Kafka appends to a log rather than doing random writes/updates. The docs make the point that sequential disk access can outperform random memory access; this is why Kafka achieves high throughput on commodity disks.

**3. The OS page cache instead of an application cache.** Kafka writes to the filesystem and lets the kernel cache; no JVM heap pressure, no double-caching, and a broker restart doesn't cold-start the cache.

**4. Zero-copy reads.** `sendfile()` moves bytes from page cache directly to the network socket, avoiding user-space copies and context switches.

**5. Batching everywhere.** Producers batch records per partition (`batch.size`, `linger.ms`); brokers write batches; consumers fetch batches (`fetch.min.bytes`, `max.partition.fetch.bytes`). Batching amortises per-record overhead and dramatically improves compression ratios.

**6. Efficient binary protocol and compression** (`compression.type=lz4`/`zstd`) — compressed batches stay compressed on disk and are often passed through to consumers without recompression.

**7. Pull-based consumers.** Consumers fetch at their own rate, which gives natural backpressure and lets a slow consumer fall behind in a durable log rather than being overwhelmed (§7 Q16).

**The architect's caveat:** *scalability is bounded by partition count for consumption*, and partitions cannot be reduced — so partition sizing is a capacity-planning decision made in advance, not a runtime knob.

---

## Q9. How does Kafka achieve ordering?

**Per the Kafka documentation:** *"Kafka only provides a total order over records **within a partition**, not between different partitions in a topic."*

**The mechanism, in three parts:**

1. **Append-only log per partition.** Records get monotonically increasing offsets in the order the leader accepts them.
2. **Key-based partitioning.** The default partitioner computes `hash(key) % numPartitions`, so **all records with the same key go to the same partition** and therefore stay ordered relative to each other.
3. **One consumer per partition per group** — so a single consumer processes that partition's records in offset order.

**The producer-side subtlety most candidates miss:** ordering can be broken *by the producer* even within a partition. With `max.in.flight.requests.per.connection > 1` and `retries > 0`, a failed batch can be retried **after** a later batch succeeded, reordering records on the partition. The documented fix:

- Set **`enable.idempotence=true`** — the idempotent producer guarantees ordering **and** deduplication for up to 5 in-flight requests per connection, because the broker uses sequence numbers to detect and reorder/reject out-of-sequence batches. This is the correct production setting and is the default from Kafka 3.0.
- (The older manual alternative was `max.in.flight.requests.per.connection=1`, which preserves order at a heavy throughput cost.)

**And the consumer-side subtlety:** ordering is preserved only if you process records **sequentially** within a partition. Handing a partition's records to a thread pool for parallel processing destroys the guarantee. If you need parallelism *and* ordering, parallelise **by key** (a per-key queue/actor), not by record.

---

## Q10. Is Kafka ordering global?

**No.** Per the documentation quoted above, ordering is **per partition only**. There is no total order across a topic, and none across topics.

**Why not:** a global order would require a single writer and a single reader for the whole topic — that is, one partition — which eliminates all parallelism and caps throughput at one broker's capacity. Kafka's design explicitly trades global ordering for horizontal scalability.

**How to get the ordering you actually need:**

| Requirement | Solution |
|---|---|
| Order per entity (account, order, payment) — **the normal business requirement** | Use the entity ID as the **message key** → same partition → ordered |
| Order across the whole topic | **One partition** — accept the throughput ceiling. Only for genuinely low-volume, strictly-sequential streams (e.g. a control/command topic) |
| Order across multiple topics | Not provided. Merge into one topic keyed by the entity, or use a sequence number and reorder downstream |
| Global ordering at scale | Use a **logical sequence** (per-aggregate version) and make consumers order-tolerant (§5 Q13) — don't try to buy global ordering from the broker |

**The question to push back with in an interview:** *"Do you need global ordering, or ordering per entity?"* Almost always it's the latter, and stating that distinction is the answer they're looking for. Global ordering across independent accounts has no business meaning — it's an artefact of thinking in terms of a single database table.

**One more caveat:** even per-key ordering breaks if you **increase the partition count** (the hash mapping changes) or if you route a failed message to a **retry topic** while later messages for the same key continue on the main topic (§7 Q15). Both need explicit handling.

---

## Q11. How do you choose a partition key?

**The key determines the partition** (`hash(key) % partitions`), and therefore determines **ordering scope, parallelism and data distribution**. It is one of the highest-consequence design decisions in a Kafka system, and it is very hard to change later.

**The three criteria, in priority order:**

1. **Ordering requirement.** The key must be the entity whose events must stay ordered. Payments per account → `accountId`. Order lifecycle → `orderId`. Trades per instrument → `instrumentId`.
2. **Even distribution.** The key space must spread across partitions. A skewed key creates a **hot partition** — one consumer saturated while others idle, and one broker doing all the work. Check cardinality and distribution against real production data, not sample data.
3. **Sufficient cardinality.** Key cardinality must be ≫ partition count. `country` (≈200 values, heavily skewed) is a bad key; `accountId` (millions, uniform) is a good one.

**Concrete examples:**

| Domain | Good key | Bad key | Why |
|---|---|---|---|
| Payments | `accountId` | `currency` | 5 currencies → 5 hot partitions, rest idle |
| Orders | `orderId` | `status` | Status has ~6 values and changes over time |
| Market data | `symbol` | `exchange` | A handful of exchanges; symbols are numerous |
| Multi-tenant SaaS | `tenantId` (with care) | — | Watch for one whale tenant — consider `tenantId:entityId` |

**Handling skew when you can't avoid it:**
- **Composite key** — `accountId:transactionType` if that preserves the ordering you need while spreading load.
- **Salting for known hot keys** — `hotKey:{0..N}`, at the cost of losing strict ordering for that key. Only if the domain tolerates it.
- **Custom `Partitioner`** — implement `org.apache.kafka.clients.producer.Partitioner` to route hot keys specially.

**Null key:** with no key, the producer uses the **sticky partitioner** (Kafka 2.4+) — it fills a batch for one partition, then switches — which gives good batching and even distribution but **no ordering guarantee at all**. Use a null key only for genuinely order-independent records (logs, metrics).

**Monitor for skew:** bytes-in and message-count per partition, and consumer lag per partition. A single partition with 10× the lag of its peers is the signature of a bad key.

---

## Q12. What happens when consumers exceed partitions?

**The extra consumers sit idle.** Per the Kafka documentation: *"if there are more consumer instances in a consumer group than partitions, some consumer instances will get no partitions at all."*

```
Topic with 3 partitions, consumer group with 5 members:
  P0 → c1
  P1 → c2
  P2 → c3
        c4  → assigned nothing (idle)
        c5  → assigned nothing (idle)
```

**Consequences:**
- **Wasted capacity and cost** — you're paying for pods that consume nothing.
- **No throughput improvement.** Scaling consumers beyond partition count does literally nothing for throughput. This is the most common Kafka scaling misunderstanding, and the reason an HPA scaled on CPU or lag can happily scale a deployment to 20 replicas when only 6 will ever do work.
- **They are not useless, though:** idle consumers act as **standby capacity** — if an active consumer dies, a rebalance assigns its partitions to a standby immediately, shortening recovery. In an HA design, running consumers = partitions is normal, and running a couple of spares is a deliberate choice.

**The fix when you need more parallelism:** increase the partition count (with the caveats in Q5/Q10 — the key→partition mapping changes and ordering across the change is not preserved), or increase per-consumer throughput (batch processing, async I/O within a partition while preserving per-key order, more efficient handlers).

**Operational rule I set:** cap the consumer Deployment's `maxReplicas` at the topic's partition count, and alert if partition count and max replicas diverge — otherwise autoscaling silently wastes money.

---

## Q13. What happens when partitions exceed consumers?

**Consumers take multiple partitions each** — which is the normal, healthy state.

```
Topic with 12 partitions, consumer group with 3 members (RangeAssignor):
  c1 → P0, P1, P2, P3
  c2 → P4, P5, P6, P7
  c3 → P8, P9, P10, P11
```

**Consequences:**
- **Ordering is still preserved per partition** — each consumer processes each of its partitions in offset order.
- **Throughput per consumer is the sum of its partitions' load** — if one of them is hot, that consumer becomes the bottleneck.
- **Headroom to scale.** You can add consumers up to the partition count with no topic change — this is exactly why you over-provision partitions modestly at design time.
- **Uneven assignment is possible.** `RangeAssignor` (the historic default) can distribute unevenly across multiple topics; `RoundRobinAssignor` spreads better; **`CooperativeStickyAssignor` is the modern recommendation** — it both balances and minimises partition movement during rebalances (Q17).

**Design implication:** choosing partitions ≈ 2–3× your expected steady-state consumer count gives room to scale out during peaks without a topic change. Choosing 100× "just in case" costs latency, memory, file handles and rebalance time.

---

## Q14. What is consumer lag?

**Definition (per Kafka's consumer metrics and the `kafka-consumer-groups` tool):**

> **lag = log end offset (latest record in the partition) − committed offset (consumer's position)**

It is the number of records the consumer group has not yet processed, per partition, and it is **the single most important health metric in a Kafka system**.

**How to read it:**

| Pattern | Meaning |
|---|---|
| Lag ≈ 0, flat | Healthy — consumers keeping up |
| Lag spikes then drains | Normal burst absorption — this is Kafka doing its job |
| **Lag rising steadily** | **Consumers cannot keep up — the actionable alert** |
| Lag on one partition only | **Hot partition / key skew**, or one stuck consumer |
| Lag flat but non-zero and large | Consumers processing at exactly the production rate but permanently behind — usually after an outage; needs temporary extra capacity |
| Lag jumps to a huge number | Retention/offset reset, or a new consumer group starting from `earliest` |

**Measure it in time as well as records.** "500,000 records behind" means nothing to the business; **"4 minutes behind"** does. Compute lag-in-time from record timestamps, and set the SLO on that. This is the metric to put on the dashboard and in the alert.

**How to observe it:**
```bash
kafka-consumer-groups.sh --bootstrap-server broker:9092 --describe --group ledger-consumer
# TOPIC  PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG  CONSUMER-ID
```
Plus: JMX `records-lag-max` per consumer, Burrow / Kafka Lag Exporter → Prometheus, **AWS MSK's `SumOffsetLag`/`MaxOffsetLag`** CloudWatch metrics, or Confluent Control Center.

---

## Q15. How do you troubleshoot consumer lag?

**A systematic method, in the order I would actually run it:**

**1. Is it all partitions or one?**
- **One partition** → key skew (hot partition, Q11), or one stuck/slow consumer instance. Check per-partition lag and per-consumer assignment.
- **All partitions** → a global consumer-side problem or a genuine throughput deficit.

**2. Is the consumer actually running and stable?**
- Check for **frequent rebalances** (`kafka-consumer-groups --describe --state`, and rebalance metrics). A consumer stuck in a rebalance loop processes nothing (Q16–Q17).
- Check pod restarts/OOMKills, and whether `max.poll.interval.ms` is being exceeded (the broker will evict the consumer mid-batch, causing redelivery and more lag).

**3. Where is the time going inside the handler?** Profile/trace one message end-to-end:
- Slow downstream call (database, HTTP API) — usually the answer. Look at *its* p99, not yours.
- Blocking/sync-over-async, thread-pool starvation (§3 Q6).
- N+1 queries, missing index, lock contention.
- Large payload deserialization or decompression cost.

**4. Is the consumer configured to fetch efficiently?**
- `max.poll.records` too low → too many polls, per-poll overhead dominates.
- `fetch.min.bytes` / `fetch.max.wait.ms` too conservative → small fetches.
- `max.partition.fetch.bytes` too small for your record size.

**5. Did production rate change?** Compare producer rate to consumer rate. If production genuinely doubled, this is a capacity problem, not a bug.

**6. Then apply the fix, in order of leverage:**
1. **Fix the handler bottleneck** (usually a downstream call) — biggest and cheapest win.
2. **Batch the work** — process a poll's records as one bulk DB write instead of N round-trips. Often a 10× improvement.
3. **Scale consumers** — up to the partition count (Q12).
4. **Increase partitions** if consumers are already at the cap (accepting the key-mapping caveat).
5. **Parallelise within a partition by key** — dispatch to per-key workers while preserving per-key order, then commit the lowest safe offset. Powerful, but adds real complexity to offset management.
6. **Shed or tier** — route low-priority events to a separate topic with its own consumers.

**7. Prevent recurrence:** alert on lag-in-time trend, load-test the consumer at 2–3× peak, and monitor per-partition distribution to catch skew before it hurts.

---

## Q16. What causes Kafka rebalancing?

**Per the Kafka documentation**, a **group rebalance** redistributes partition assignments among group members. It is triggered by:

1. **A consumer joins** the group (scale-out, deployment rollout, restart).
2. **A consumer leaves** gracefully (`close()` sends a LeaveGroup request).
3. **A consumer is considered dead** — no heartbeat within **`session.timeout.ms`** (default 45 s).
4. **A consumer exceeds `max.poll.interval.ms`** (default 5 minutes) — the broker concludes the application is stuck and evicts it. **This is the most common cause of surprise rebalances in real systems**: a handler that occasionally takes 6 minutes evicts its own consumer, which then rejoins, triggering another rebalance.
5. **Partition count changes** for a subscribed topic.
6. **A subscribed topic is created/deleted** when using a subscription pattern (`subscribe(Pattern)`).
7. **Group coordinator failover** (broker restart).

**Why it hurts (the "stop-the-world" problem):** with the classic **eager** rebalance protocol, **all** consumers revoke **all** partitions, then the assignment is recomputed and partitions are redistributed. During that window the entire group processes nothing. With large groups and slow rejoins, this can last seconds to minutes — and if the cause was a slow handler, the rebalance recurs, producing a **rebalance storm** where the group spends most of its time rebalancing.

**Secondary damage:** uncommitted work is redelivered (duplicates — which is why idempotency is mandatory), in-flight batches are abandoned, and lag spikes.

---

## Q17. How do you minimize rebalancing problems?

**Six mitigations, each addressing a specific cause:**

**1. Use the cooperative (incremental) rebalance protocol.**
```properties
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor
```
Per the Kafka documentation, cooperative rebalancing revokes **only the partitions that must move**, so consumers keep processing their unaffected partitions throughout. This removes the stop-the-world pause and is the single biggest improvement. (Migrating from eager requires a documented two-step rolling upgrade.)

**2. Use static group membership** for rolling restarts.
```properties
group.instance.id=payments-consumer-0      # stable per pod (use the StatefulSet ordinal)
session.timeout.ms=45000
```
Per the docs, a member with a `group.instance.id` that leaves and rejoins **within `session.timeout.ms` keeps its previous assignment and does not trigger a rebalance** — which makes a normal Kubernetes rolling deploy nearly rebalance-free. This is the key setting for deployment-induced rebalances.

**3. Keep the poll loop fast — and tune the two timeouts correctly.**
- Reduce `max.poll.records` so a batch is processed well within `max.poll.interval.ms`.
- Raise `max.poll.interval.ms` only if processing genuinely needs longer.
- **Never do long retries or long blocking calls inside the poll loop** — escalate to a retry topic instead (§7 Q15).

**4. Tune heartbeats sanely.** `heartbeat.interval.ms` ≈ 1/3 of `session.timeout.ms` (e.g. 3 s / 10 s, or the modern defaults 3 s / 45 s). Too-short session timeouts cause false-positive evictions during GC pauses or brief network blips.

**5. Close consumers cleanly on shutdown.** `consumer.Close()` sends LeaveGroup, so the coordinator reassigns immediately instead of waiting for the session timeout. Combine with graceful shutdown and a `preStop` hook (§1 Q15).

**6. Avoid churn.** Don't autoscale consumers aggressively on a noisy metric; use stabilisation windows on the HPA. Every scale event is a rebalance.

**Plus: make rebalances safe rather than merely rare.** Implement `ConsumerRebalanceListener` to commit offsets in `OnPartitionsRevoked`, and always have **idempotent consumers** so the redelivery a rebalance causes is harmless.

---

## Q18. What is replication factor?

**Per the Kafka documentation:** *"Kafka replicates the log for each topic's partitions across a configurable number of servers... This allows automatic failover to these replicas when a server in the cluster fails."* The **replication factor (RF)** is the total number of copies of each partition, including the leader.

```
RF = 3, partition P0:
   Broker 1: P0 (leader)     ← handles all reads and writes
   Broker 2: P0 (follower)   ← fetches from leader
   Broker 3: P0 (follower)   ← fetches from leader
```

**Durability arithmetic:** with RF = N you can lose **N−1** brokers without losing the partition's data, and — combined with `min.insync.replicas` — you decide how many failures you can tolerate while still *accepting writes*.

| RF | `min.insync.replicas` | Broker failures tolerated (writes continue) | Data loss risk |
|---|---|---|---|
| 1 | 1 | 0 | **Total loss** if the broker dies — never in production |
| 2 | 2 | 0 (writes stop on 1 failure) | Low, but no availability headroom |
| **3** | **2** | **1** | **The production standard** |
| 5 | 3 | 2 | Higher cost; for extreme durability |

**The recommended production configuration — and be ready to justify each number:**
```properties
replication.factor=3
min.insync.replicas=2      # with acks=all: a write needs leader + 1 follower
acks=all                   # producer-side; without this, min.insync.replicas does nothing
```
Note the interaction: **`min.insync.replicas` only takes effect when the producer uses `acks=all`**. Setting one without the other is a common misconfiguration that gives a false sense of durability.

**Rack/AZ awareness:** set `broker.rack` to the availability zone so Kafka's rack-aware assignment places the three replicas in three AZs. Without it, all three replicas can land in one AZ and an AZ failure takes the partition offline — a real incident I would explicitly design against. (AWS MSK does this automatically when you deploy across three AZs.)

---

## Q19. What is ISR?

**Per the Kafka documentation:** the **ISR (In-Sync Replicas)** is *"the set of replicas that are 'caught up' to the leader"*. A follower is considered in-sync if it has fetched from the leader within **`replica.lag.time.max.ms`** (default 30 s). *"A message is considered committed when all in-sync replicas for that partition have applied it to their log,"* and **only committed messages are visible to consumers** (the high watermark).

**Why ISR exists rather than "all replicas":** requiring *every* replica to ack would make one slow or restarting broker block all writes. ISR is a dynamic quorum — replicas that fall behind are removed from the set, writes continue with the remainder, and they rejoin when caught up.

**The critical interaction with `min.insync.replicas`:**

```
RF=3, min.insync.replicas=2, acks=all

ISR = {leader, f1, f2}  → writes succeed (3 ≥ 2)
Broker with f2 dies:
ISR = {leader, f1}      → writes still succeed (2 ≥ 2)
Broker with f1 also dies:
ISR = {leader}          → producer receives NotEnoughReplicasException; writes REJECTED
```

That rejection is **correct and desirable**: Kafka chooses consistency over availability here (a CP choice) rather than accepting a write that exists on only one machine and could be lost. In a payments platform, that is precisely the behaviour you want — and you should say so.

**`unclean.leader.election.enable`** — the setting that turns this on its head. If `true`, an out-of-sync replica can be elected leader when no in-sync replica is available: the partition becomes available again, but **committed messages are silently lost**. The default is `false` and **it must stay `false` for any topic carrying business data**. This is a classic interview probe: availability vs durability, decided by one boolean.

**Monitor:** `UnderReplicatedPartitions` (should be 0), `UnderMinIsrPartitionCount` (should be 0 — non-zero means writes are being rejected), and `OfflinePartitionsCount` (should be 0).

---

## Q20. Leader vs follower?

**Per the Kafka documentation:** *"Each partition has one server which acts as the 'leader' and zero or more servers which act as 'followers'. The leader handles all read and write requests for the partition while the followers passively replicate the leader. If the leader fails, one of the followers will automatically become the new leader."*

| | **Leader** | **Follower** |
|---|---|---|
| Handles producer writes | ✅ | ❌ |
| Handles consumer reads | ✅ (by default) | ❌ (except with follower fetching — see below) |
| Replicates | Is the source | Fetches from the leader like a consumer |
| Tracks | The ISR set and the high watermark | Its own log end offset |
| On failure | A follower from the ISR is elected leader by the controller | Removed from ISR; rejoins when caught up |

**Why reads go to the leader by default:** it guarantees read-your-writes consistency and keeps the high-watermark logic simple. Kafka does not offer "read from any replica" as a consistency-relaxing option in the way a database read replica does.

**The exception worth knowing (KIP-392, Kafka 2.4+): follower fetching / rack-aware consumers.** Setting `client.rack` on the consumer and `replica.selector.class=org.apache.kafka.common.replica.RackAwareReplicaSelector` on the broker lets a consumer fetch from the **nearest replica** in its own AZ. The motivation is purely cost and latency: **cross-AZ data transfer charges** are a significant part of a large Kafka bill on AWS. Consistency is preserved because followers only serve up to the high watermark.

**Leadership balance is an operational concern:** if leadership concentrates on a few brokers (common after failures and restarts), those brokers do all the write work. `auto.leader.rebalance.enable=true` and the `kafka-leader-election` tool restore balance; monitor leader count per broker.

---

## Q21. Explain Kafka acknowledgements.

**Per the Kafka producer configuration documentation:** *"`acks` — the number of acknowledgments the producer requires the leader to have received before considering a request complete. This controls the durability of records that are sent."*

**The full write path, so you can explain what is being acknowledged:**

```
Producer ──▶ [Leader broker]
                 │ 1. append to leader's log (page cache; fsync per flush policy)
                 │ 2. followers fetch and append
                 │ 3. leader advances the high watermark once ISR has it
                 ▼
             ack returned to producer  ← at a point determined by `acks`
```

**Important nuance the docs make explicit:** an ack means the record is in the **log of the required replicas' page cache**, not necessarily fsync'd to disk. Kafka's durability model relies on **replication across machines** rather than on fsync per write — which is why `min.insync.replicas` and rack awareness matter more than disk-flush settings. (`flush.messages`/`flush.ms` exist but are generally left to the OS.)

**Related producer settings that complete the picture:**

| Setting | Purpose | Production value |
|---|---|---|
| `acks` | Durability level | `all` |
| `enable.idempotence` | Dedup + ordering on retries | `true` (default since 3.0) |
| `retries` | Retry attempts | `Integer.MAX_VALUE` with `delivery.timeout.ms` bounding total time |
| `delivery.timeout.ms` | Upper bound on send + retries | 120000 (tune to your SLA) |
| `max.in.flight.requests.per.connection` | Concurrency per connection | ≤5 with idempotence (keeps ordering) |
| `linger.ms` / `batch.size` | Batching for throughput | 5–20 ms / 32–64 KB typically |
| `compression.type` | Wire + disk efficiency | `lz4` or `zstd` |

---

## Q22. `acks=0` vs `acks=1` vs `acks=all`?

**Per the Kafka documentation, verbatim in substance:**

| `acks` | Documented behaviour | Durability | Throughput/latency | Data loss scenario |
|---|---|---|---|---|
| **`0`** | *"The producer will not wait for any acknowledgment from the server at all. The record will be immediately added to the socket buffer and considered sent."* Offset is always −1. | **None** | Highest | Any broker failure, network drop, or full buffer — silently |
| **`1`** | *"The leader will write the record to its local log but will respond without awaiting full acknowledgement from all followers."* | Leader only | Medium | **Leader fails before followers replicate → the record is lost**, and the producer already reported success |
| **`all`** (= `-1`) | *"The leader will wait for the full set of in-sync replicas to acknowledge the record. This guarantees that the record will not be lost as long as at least one in-sync replica remains alive."* | Strongest | Lowest (one extra replication round trip) | Only if **all** ISR members are lost simultaneously |

**Choosing, with the reasoning an architect gives:**

- **`acks=all` for anything with business meaning** — payments, orders, ledger entries, audit events. The added latency is a few milliseconds; the alternative is losing a financial transaction with the producer believing it succeeded. **This is non-negotiable in fintech**, and I would state it that way.
- **`acks=1`** for high-volume telemetry where losing a small fraction on a broker failure is acceptable and throughput matters.
- **`acks=0`** essentially never — I would push back on any proposal to use it for anything but fire-and-forget metrics, and even then `acks=1` is usually affordable.

**The configuration that must accompany `acks=all`:**
```properties
acks=all
enable.idempotence=true       # exactly-once per producer session, preserves ordering on retry
min.insync.replicas=2         # topic-level: reject writes if fewer than 2 replicas are in sync
replication.factor=3
```
Without `min.insync.replicas ≥ 2`, `acks=all` degenerates: if the ISR shrinks to just the leader, "all in-sync replicas" means one replica, and you're back to `acks=1` durability without noticing. **That interaction is the highest-value detail in this question.**

---

## Q23. What is producer idempotence?

**Per the Kafka documentation:** *"`enable.idempotence` — when set to `true`, the producer will ensure that exactly one copy of each message is written in the stream. If `false`, producer retries due to broker failures, etc., may write duplicates of the retried message in the stream."* The docs note this requires `max.in.flight.requests.per.connection ≤ 5`, `retries > 0`, and `acks=all`; **since Kafka 3.0 it is enabled by default.**

**Mechanism:**
1. On initialisation, the producer obtains a **Producer ID (PID)** from the broker.
2. Every record batch carries `(PID, partition, sequence number)`, with sequence numbers monotonically increasing per partition.
3. The broker tracks the last sequence number per `(PID, partition)`. A batch with a **duplicate** sequence number is **acknowledged but discarded**; a batch with a **gap** is rejected with `OutOfOrderSequenceException`.

**What this gives you:**
- ✅ **De-duplication of producer retries** — the classic "ack was lost, so I resent, and now there are two copies" problem disappears.
- ✅ **Ordering preserved on retry** even with up to 5 in-flight requests, so you get idempotence *and* throughput.

**What it explicitly does NOT give you — say this, because it's the discriminating detail:**
- ❌ **Not** deduplication across **producer sessions**. A restart yields a new PID, so a message resent by application-level logic after a restart is a *new* message to the broker.
- ❌ **Not** deduplication of application-level duplicates — if your code publishes the same logical event twice (e.g. an outbox relay re-publishing after a crash), Kafka sees two distinct records.
- ❌ **Not** atomicity across partitions or topics — that's transactions (Q24).
- ❌ **Not** end-to-end exactly-once to your database — that requires consumer-side idempotency (Q27).

**Therefore:** always turn it on (it's essentially free), but never treat it as the duplicate-handling strategy. **Consumer-side idempotency remains mandatory.**

---

## Q24. What are Kafka transactions?

**Per the Kafka documentation:** transactions *"allow atomic writes to multiple topics and partitions"* — either all records in a transaction are visible to consumers, or none are. Combined with **`isolation.level=read_committed`** on the consumer, this enables **exactly-once processing semantics (EOS)** for the **consume → process → produce** pattern.

```csharp
// Conceptual EOS loop (Confluent .NET client)
producer.InitTransactions(TimeSpan.FromSeconds(10));

while (!ct.IsCancellationRequested)
{
    var records = consumer.Consume(ct);
    producer.BeginTransaction();
    try
    {
        foreach (var r in records)
            producer.Produce("output-topic", Transform(r));

        // the consumer's offsets are committed AS PART OF the transaction
        producer.SendOffsetsToTransaction(consumer.Assignment.Select(OffsetFor),
                                          consumer.ConsumerGroupMetadata, TimeSpan.FromSeconds(10));
        producer.CommitTransaction();
    }
    catch { producer.AbortTransaction(); throw; }
}
```

**Required configuration:**
```properties
# producer
transactional.id=payments-processor-1     # stable per logical processor — enables fencing across restarts
enable.idempotence=true
acks=all
# consumer
isolation.level=read_committed            # never see records from aborted transactions
enable.auto.commit=false                  # offsets are committed by the transaction, not by the consumer
```

**How it works:** a **transaction coordinator** on a broker manages state in an internal `__transaction_state` topic; **transaction markers** (commit/abort) are written into the data partitions so consumers with `read_committed` know what to expose. The `transactional.id` provides **zombie fencing** — a restarted producer with the same ID bumps an epoch, and the old instance's writes are rejected.

**The boundary — the essential caveat:** the atomic unit is **Kafka topics + consumer offsets**, all inside Kafka. A transaction **cannot include** your PostgreSQL write or an HTTP call to a payment scheme. For those you still need the **outbox** (producer side) and **idempotent consumers** (consumer side).

**Costs:** meaningful throughput reduction (extra coordination round trips and markers), higher end-to-end latency (consumers only see committed data, so latency is tied to commit frequency), and operational complexity. **Kafka Streams sets it all up for you** with `processing.guarantee=exactly_once_v2` — if you need EOS within Kafka, using Streams is usually the right call rather than hand-rolling the loop above.

---

## Q25. Does Kafka provide DB + Kafka atomicity?

**No — explicitly and definitively no.** Kafka transactions are scoped to **Kafka topics and Kafka consumer offsets**. There is no distributed transaction between Kafka and an external database; Kafka does not participate in XA/2PC.

**The resulting problem is the dual-write problem** (§4 Q23, §7 Q25):

```
Option A — commit DB, then publish:
   DB: payment = AUTHORIZED  ✔
   crash / broker unavailable ✘
   ⇒ money moved, no event. Ledger, notifications, settlement never learn. SILENT LOSS.

Option B — publish, then commit DB:
   Kafka: PaymentAuthorized ✔
   DB commit fails ✘
   ⇒ downstream acts on a payment that does not exist. PHANTOM EVENT.
```

**Neither is acceptable for financial data**, and no Kafka configuration fixes it, because the failure is *between two systems*.

**The documented solution is the Transactional Outbox** (AWS Prescriptive Guidance; Microsoft integration-event guidance): write the business change and the event row in **one local ACID transaction**, then publish asynchronously from the outbox table via a poller or CDC (Q26).

**Anticipate the follow-up "what about Kafka Connect / Debezium — isn't that atomic?"** — Debezium reads the database's **transaction log**, so it publishes only what the database actually committed. That gives you *guaranteed publication of committed changes* (which is the property you want) but still **at-least-once** delivery to Kafka, because the connector can re-emit after a restart. So consumer-side idempotency remains mandatory. Say that plainly; it's the detail that shows you've run this in production.

---

## Q26. Why use Outbox with Kafka?

**Because Kafka cannot participate in your database transaction (Q25), and because losing an event is not an acceptable failure mode for business data.**

**The pattern:**

```sql
BEGIN TRANSACTION;
  UPDATE Accounts SET Balance = Balance - 10000 WHERE Id = @from;   -- business state
  INSERT INTO Outbox (MessageId, AggregateId, Type, Payload, OccurredAt, ProcessedAt)
       VALUES (@msgId, @from, 'FundsDebited', @json, SYSUTCDATETIME(), NULL);   -- intent to publish
COMMIT;      -- ONE local ACID transaction — both or neither
```

Then a **relay** publishes to Kafka:

| Relay type | How | Pros | Cons |
|---|---|---|---|
| **Polling publisher** | Background worker: `SELECT ... WHERE ProcessedAt IS NULL ORDER BY OccurredAt` (with `SKIP LOCKED`/`READPAST`), publish, mark processed | Simple; no extra infrastructure; easy to reason about | Polling latency; DB load; needs careful multi-instance handling |
| **CDC (log tailing)** | Debezium / AWS DMS reads the WAL/binlog and publishes | Low latency; no polling load; no publish code in the app | A connector to operate; schema/topic mapping to manage |

**What each part of the chain guarantees:**

| Concern | Mechanism |
|---|---|
| Event can never be lost | Outbox row commits with the state change |
| Event eventually reaches Kafka | Relay retries until acknowledged |
| Event survives broker failure | `acks=all`, RF=3, `min.insync.replicas=2` |
| Fewer duplicates on the wire | `enable.idempotence=true`, stable `MessageId` |
| **Effect applied once** | **Idempotent consumer with an inbox table** (Q27) |
| Ordering per entity | Publish with the aggregate ID as the Kafka key; relay preserves per-aggregate order |

**Operational details to mention:** index `(ProcessedAt, OccurredAt)`; **purge or archive** processed rows (an unbounded outbox becomes the hottest table in the database); **monitor outbox depth and the age of the oldest unprocessed row** — a stalled relay is a silent outage that no Kafka metric will show you; and make the relay's publish idempotent-friendly by carrying the same `MessageId` on every attempt.

---

## Q27. How do you handle duplicate Kafka messages?

**Accept that duplicates are inevitable** (at-least-once semantics, rebalances, retries, DLQ replays) and defend in layers:

**Layer 1 — reduce them at the producer.** `enable.idempotence=true` removes retry-induced duplicates within a session (Q23). Stable, deterministic `MessageId` from the outbox so a relay re-publish carries the same identity.

**Layer 2 — deduplicate at the consumer (the durable guarantee).**

```csharp
public async Task HandleAsync(ConsumeResult<string, PaymentAuthorized> msg, CancellationToken ct)
{
    var messageId = msg.Message.Headers.Get("message-id");     // producer-generated, stable

    await using var tx = await _db.Database.BeginTransactionAsync(ct);

    _db.InboxMessages.Add(new InboxMessage(messageId, DateTime.UtcNow));
    try { await _db.SaveChangesAsync(ct); }
    catch (DbUpdateException e) when (e.IsUniqueViolation())
    {
        await tx.RollbackAsync(ct);
        _metrics.Duplicate(msg.Topic);
        _consumer.StoreOffset(msg);          // still advance — the message IS handled
        return;
    }

    await _ledger.PostAsync(msg.Message.Value, ct);
    await _db.SaveChangesAsync(ct);
    await tx.CommitAsync(ct);                // dedup record + business effect commit TOGETHER
    _consumer.StoreOffset(msg);              // commit offset only after the work is durable
}
```

**Layer 3 — make the effect naturally idempotent.** Conditional state transitions (`WHERE Status='AUTHORIZED'`), upserts, version-guarded updates. Cheapest and most robust — no extra state to operate.

**Layer 4 — detect and reconcile.** Duplicate-rate metric plus reconciliation against the authoritative record.

**Deduplication key discipline (the part people get wrong):** use a **producer-generated, business-stable ID** — never the offset (changes on repartition/replay), never a payload hash (changes with non-semantic fields), never a consumer-generated value. Give the inbox table a retention window **longer than the maximum redelivery window** (broker retention + longest plausible outage; 7–30 days), an index on the message ID, and a purge job.

---

## Q28. How do you retry Kafka messages?

**The constraint that shapes everything:** Kafka has **no per-message acknowledgement and no built-in redelivery**. A consumer advances an offset; it cannot "nack" one record and leave it for later. Blocking on a failing message **blocks the whole partition** — and everything behind it.

**The standard tiered design:**

```
main topic ──▶ consumer
                 │ transient failure
                 ├─▶ in-memory retry ×2–3 (short backoff, must fit inside max.poll.interval.ms)
                 │ still failing
                 ├─▶ payments.authorized.retry.30s ──▶ retry consumer (delay, then re-attempt)
                 ├─▶ payments.authorized.retry.5m  ──▶ retry consumer
                 │ max attempts / non-retryable
                 └─▶ payments.authorized.dlq ──▶ alert + triage + replay tool
             ...and in ALL cases: commit the original offset and keep moving.
```

**Rules:**
1. **Classify first.** Deserialization failure, schema mismatch, validation error, business rejection → **straight to DLQ**, no retries. Only transient failures (timeouts, 503, deadlocks) get retried.
2. **Keep in-poll retries very short.** Anything approaching `max.poll.interval.ms` (default 5 min) will cause the broker to evict the consumer and trigger a rebalance — turning one bad message into a group-wide stall (Q16).
3. **Carry retry context in headers:** `retry-count`, `original-topic`, `original-partition`, `original-offset`, `first-failure-at`, `last-error`, plus the `traceparent`. Without these, the DLQ is undiagnosable.
4. **Delay properly.** A retry consumer that reads a `retry.30s` topic should check the record timestamp and `Thread.Sleep`-equivalent by *pausing the partition* (`consumer.Pause`) rather than blocking the poll loop, or use a scheduler/`ScheduledEnqueueTime`-style mechanism.
5. **Accept the ordering consequence.** Diverting a message to a retry topic **breaks per-key ordering** for that key. If ordering is required, either pause that key's processing (park subsequent messages for the key) or accept reordering — decide explicitly and document it. This is the hardest real trade-off in Kafka retry design and worth naming.
6. **Always be idempotent** — retries and replays guarantee duplicates.

---

## Q29. How do you design Kafka DLQ?

**Kafka has no native DLQ** — the Apache Kafka documentation defines none (Kafka **Connect** has `errors.deadletterqueue.topic.name` for connector errors, but that's Connect, not core). So a DLQ is an ordinary topic plus a discipline.

**Design:**

| Decision | Recommendation | Why |
|---|---|---|
| Topic naming | `<topic>.<consumer-group>.dlq` | **Per consumer group**, not per topic — if 5 consumers read one topic and one fails, only that consumer's failures should be dead-lettered |
| Partitions | Same key strategy as the source | Preserves the ability to reason about per-entity failures |
| Retention | **Long** (14–30 days), often compacted off | You need time to investigate and replay |
| Payload | **The original record, unmodified** | Replay must be byte-identical |
| Headers | `original-topic`, `partition`, `offset`, `timestamp`, `retry-count`, `error-type`, `error-message`, `stack-trace`, `failed-at`, `consumer-group`, `traceparent`, `correlation-id` | A DLQ record you cannot diagnose is a data-loss record |
| Schema | Same as source (or a wrapper carrying source + metadata) | Replay-friendly |

**Operational requirements — these are what make a DLQ real rather than decorative:**
1. **Alert on DLQ arrival rate and depth**, with a named owner. `dlq_messages_total > 0` should page someone during business hours and be on a dashboard always.
2. **A replay tool** that can filter (by time, error type, key) and re-publish to the source topic. Idempotent consumers make replay safe.
3. **Triage runbook**: is it a data problem (fix the record, replay), a code problem (fix, deploy, replay), or a dependency problem (wait, replay)?
4. **Track age of oldest DLQ message** — a DLQ with 40,000 messages nobody has looked at since March is a compliance finding in a bank, not a backlog.
5. **Never let the DLQ be the silent success path.** A consumer that dead-letters 30 % of traffic and reports "healthy" is the worst possible outcome; alert on the *ratio* of DLQ to processed.

---

## Q30. How do you secure Kafka?

**Per the Apache Kafka security documentation**, Kafka provides three independent mechanisms, and a production deployment uses all three:

**1. Encryption in transit — TLS/SSL.**
```properties
listeners=SSL://:9093
security.inter.broker.protocol=SSL
ssl.keystore.location=/etc/kafka/kafka.keystore.jks
ssl.truststore.location=/etc/kafka/kafka.truststore.jks
ssl.client.auth=required          # mutual TLS — clients present certificates
```
Disable PLAINTEXT listeners entirely in production; TLS 1.2+ only.

**2. Authentication — SSL client certificates (mTLS) or SASL.** Supported SASL mechanisms per the docs: `GSSAPI` (Kerberos), `PLAIN`, `SCRAM-SHA-256/512`, `OAUTHBEARER`. Choose:
- **mTLS** — strong, certificate-based, good for service-to-service; needs certificate lifecycle management.
- **SASL/SCRAM** — username/password with salted challenge-response; simpler operationally, credentials in a secret store.
- **SASL/OAUTHBEARER** — integrates with your existing IdP; the best fit when you already run OAuth2 (and what **AWS MSK IAM authentication** is analogous to).
- **AWS MSK** additionally offers **IAM access control**, where Kafka authorization is expressed as IAM policies — often the cleanest option on AWS because it removes credential management entirely.

**3. Authorization — ACLs.** Per the docs, the default authorizer (`AclAuthorizer`/`StandardAuthorizer` in KRaft) controls operations per principal, resource and operation:
```bash
kafka-acls.sh --add --allow-principal User:payments-service \
  --operation Write --topic payments.authorized
kafka-acls.sh --add --allow-principal User:ledger-service \
  --operation Read --topic payments.authorized --group ledger-consumer
```
Set `allow.everyone.if.no.acl.found=false` — **deny by default**. Grant least privilege: producers get `Write` on specific topics; consumers get `Read` on specific topics *and* their specific consumer group; nobody gets cluster-wide `All`.

**4. Encryption at rest.** Kafka does not encrypt the log itself; use **disk/volume encryption** (EBS with KMS, MSK encryption at rest with a CMK). For field-level protection of sensitive data, encrypt **in the payload** before producing (envelope encryption with KMS) — necessary when the data is PCI/PII and the ops team must not be able to read it.

**5. Data-classification discipline (the fintech point).** Never put PANs, CVVs, full credentials or unmasked PII on a topic. Tokenise. This keeps consumers out of PCI scope and is a far stronger control than any ACL.

**6. Audit and network.** Enable authorizer logging (who accessed what), run brokers in **private subnets** with security groups restricted to client subnets, use VPC endpoints/PrivateLink for cross-VPC access, and never expose brokers to the internet.

---

## Q31. How do you tune Kafka performance?

**Tune by role, and always measure before and after.**

**Producer (throughput vs latency):**
```properties
batch.size=65536                # bigger batches → better throughput and compression
linger.ms=10                    # wait briefly to fill batches (0 = lowest latency, worst throughput)
compression.type=lz4            # or zstd for better ratio at more CPU
buffer.memory=67108864          # total producer buffer; blocking here means you're producing too fast
acks=all                        # durability — do NOT trade this away for speed on business data
enable.idempotence=true
max.in.flight.requests.per.connection=5
```
The main lever is **`linger.ms` + `batch.size`**: batching is what turns 100k small writes into a few large sequential appends.

**Consumer (throughput):**
```properties
fetch.min.bytes=65536           # wait for a worthwhile batch rather than chatty small fetches
fetch.max.wait.ms=100
max.partition.fetch.bytes=1048576
max.poll.records=500            # balance against max.poll.interval.ms and handler speed
enable.auto.commit=false        # explicit commits after processing
```
But the biggest consumer win is almost always **in the handler**: batch the downstream writes (one bulk insert per poll instead of 500 round trips), remove N+1 queries, and stop blocking.

**Broker / cluster:**
- **Partitions:** enough for parallelism, not so many that latency, memory and rebalance time suffer.
- **Disks:** fast local NVMe or provisioned-IOPS volumes; separate log directories across disks; **never network storage with unpredictable latency for the log**.
- **Page cache:** leave most RAM to the OS; keep the JVM heap modest (commonly 6–8 GB) — Kafka is not a heap-heavy application, and a large heap means long GC pauses.
- **Network:** high bandwidth; `num.network.threads`/`num.io.threads` sized to cores; enable **rack awareness** and consider **follower fetching** to cut cross-AZ transfer cost.
- **Retention and segment size** tuned so compaction/deletion isn't constantly churning.

**Topic-level:**
- Right partition count, RF=3, `min.insync.replicas=2`, compression at the producer, and `cleanup.policy=compact` for state topics.

**Measure:** `kafka-producer-perf-test` / `kafka-consumer-perf-test` for baselines; broker JMX (`BytesInPerSec`, `RequestQueueSize`, `RequestHandlerAvgIdlePercent` — below ~0.3 means the broker is saturated); consumer lag; end-to-end latency. **Tune one variable at a time**; Kafka tuning done by changing five settings at once is indistinguishable from luck.

---

## Q32. How do you handle millions of events?

**Answer with capacity arithmetic first**, then the design — this is the "show your working" question.

**Worked example: 1,000,000 events/minute = ~16,700 events/second, average 1 KB.**
- Ingress: 16,700 × 1 KB ≈ **16.7 MB/s**; with RF=3 the cluster writes ≈ **50 MB/s** plus replication traffic.
- With ~20 MB/s of reliable throughput per partition: **≈ 3 partitions** for raw throughput — but partition count is really set by **consumer parallelism**, so if one consumer processes 1,000 events/s, I need **≥17 consumers → ≥24 partitions** (with headroom).
- Retention: 7 days × 16.7 MB/s ≈ **10 TB** raw, **30 TB** with RF=3. That drives disk sizing and cost, and is where the decision to compress (2–4× reduction) pays for itself.

**Design measures:**

1. **Partition for parallelism**, sized from consumer throughput as above, with headroom because you can't reduce later.
2. **Batch on both sides.** Producer batching + compression; consumer bulk-writes downstream (one `COPY`/bulk insert per poll, not per record). This is typically a 10× consumer improvement and the first thing I'd fix.
3. **Compress** (`lz4`/`zstd`) — reduces network, disk and cost simultaneously.
4. **Avoid hot partitions** — verify key distribution against real data (Q11).
5. **Scale consumers to the partition count**, and make handlers async, non-blocking and efficient (§3).
6. **Tier the data:** short retention on the hot topic; sink to **S3 (or a data lake) via Kafka Connect** for long-term storage and analytics; use **tiered storage** (KIP-405, available in Kafka 3.6+ and in Confluent/MSK offerings) so retention isn't bounded by broker disk.
7. **Right-size the cluster**: enough brokers to keep per-broker throughput comfortable, spread across 3 AZs, with rack awareness and follower fetching to reduce cross-AZ charges.
8. **Consider whether every event needs Kafka.** High-volume, low-value telemetry might belong in a metrics pipeline; sampling or pre-aggregation at the edge can cut volume by an order of magnitude. The cheapest event is the one you don't publish.
9. **Protect the downstream.** Kafka will happily deliver faster than your database can accept — bound consumer concurrency and batch writes, or you move the outage downstream.
10. **Monitor**: lag-in-time, per-partition skew, broker request-handler idle %, disk usage trend, and cost per million events.

---

## Q33. How would you design Kafka for a fintech platform?

**Requirements framing:** no lost or double-processed financial events; full auditability; per-account ordering; PCI-DSS scope minimised; regulatory retention; multi-AZ resilience; documented RPO/RTO.

**Cluster and topology:**
- **3 (or 5) brokers across 3 AZs**, `broker.rack` set per AZ; **KRaft** mode; **AWS MSK** (or Confluent Cloud) unless there's a specific reason to self-manage — the operational burden of self-managed Kafka is real and rarely justified.
- **RF=3, `min.insync.replicas=2`, `unclean.leader.election.enable=false`** on every business topic. That last setting is the "never silently lose committed data" guarantee, and I'd call it out explicitly.

**Topics and contracts:**
- Naming convention `<domain>.<entity>.<event>.v<major>`, e.g. `payments.authorization.completed.v1`.
- `auto.create.topics.enable=false`; topic creation via IaC (Terraform) with peer review.
- **Schema Registry with `FULL_TRANSITIVE` compatibility**, enforced in CI, Avro or Protobuf payloads.
- **Key = the aggregate ID** (`accountId` / `paymentId`) for per-entity ordering.
- **Never publish PANs, CVVs or unmasked PII** — tokenised references only. This keeps consumers out of PCI scope and is the single most valuable compliance decision in the design.

**Producer:**
- `acks=all`, `enable.idempotence=true`, bounded `delivery.timeout.ms`, `compression.type=zstd`.
- **All business events published via the Transactional Outbox** with a CDC relay (Debezium) — no direct publishing from application code on a path that also writes the database.

**Consumers:**
- `enable.auto.commit=false`, commit after processing; **inbox/dedup table committed with the effect**.
- `CooperativeStickyAssignor` + `group.instance.id` static membership for rebalance-free deploys.
- Tiered retry topics + **per-consumer-group DLQ**, alerted, with a replay tool.
- Consumer count ≤ partition count; HPA on **lag**, capped at partition count.

**Security:**
- TLS everywhere (no PLAINTEXT listener), **mTLS or MSK IAM** authentication, **ACLs deny-by-default** with least privilege per service and per consumer group, encryption at rest with a customer-managed KMS key, brokers in private subnets.

**Observability:**
- Lag **in time** per group with SLO alerts; DLQ depth/rate; under-replicated and under-min-ISR partitions; end-to-end business latency; `traceparent` propagated in message headers so traces span producer → broker → consumer; and a **business reconciliation** (authorisations published vs ledger entries posted) that must match daily.

**Data lifecycle and compliance:**
- Retention per topic driven by regulation (often 7 years for financial records) — achieved by sinking to **S3 with Object Lock / Glacier** via Kafka Connect rather than by keeping 7 years on brokers.
- **Right-to-erasure** handled by **crypto-shredding** (encrypt personal fields with a per-subject key; delete the key) — you cannot delete a single record from an immutable log, and interviewers like this answer because it shows you've thought about GDPR against an append-only store.
- Documented DR: cross-region replication (MirrorMaker 2 / MSK Replicator) with stated **RPO** (replication lag) and **RTO** (failover procedure), and **tested** at least annually.

---

## Q34. How would you troubleshoot a production Kafka outage?

**Work outside-in: impact → scope → component → cause.**

**1. Establish impact and scope (first 2 minutes).**
- Are **producers** failing (writes rejected/timeouts) or **consumers** failing (lag climbing) — or both?
- All topics or specific ones? All partitions or a subset? One AZ?
- Is customer-facing traffic affected, or only downstream processing? That determines whether you shed load or just fix forward.

**2. Check cluster health.**
```bash
kafka-topics.sh --bootstrap-server b:9092 --describe --under-replicated-partitions
kafka-topics.sh --bootstrap-server b:9092 --describe --unavailable-partitions
kafka-broker-api-versions.sh --bootstrap-server b:9092      # which brokers respond
```
Key metrics: `OfflinePartitionsCount` (>0 = partitions with no leader — critical), `UnderReplicatedPartitions`, `UnderMinIsrPartitionCount` (>0 means `acks=all` writes are being **rejected** — this is usually the direct cause of producer errors), `ActiveControllerCount` (must be exactly 1 cluster-wide).

**3. The usual root causes, in order of real-world frequency:**

| Symptom | Likely cause | Check / fix |
|---|---|---|
| `NotEnoughReplicasException`, producer errors | ISR shrunk below `min.insync.replicas` — a broker down or lagging | Broker health, disk, network; restore the broker; do **not** "fix" it by lowering `min.insync.replicas` |
| Broker down / not starting | **Disk full** (the single most common Kafka outage) | `df -h`; expand volume; reduce retention temporarily; delete old segments only via retention config, never by hand |
| High produce/fetch latency | Broker saturation | `RequestHandlerAvgIdlePercent` < 0.3, network threads busy, disk IOPS at limit |
| Consumers processing nothing | **Rebalance storm** | Group state stuck in `PreparingRebalance`; check `max.poll.interval.ms` breaches, pod restarts, OOMKills |
| Lag climbing on one partition | Key skew / one stuck consumer | Per-partition lag; consumer thread dump |
| Everything slow after a deploy | Client config change, schema change, or a slow new handler | Diff the deploy; roll back first, investigate second |
| Cluster-wide unavailability | Controller/quorum problem (KRaft), or ZooKeeper loss (older clusters) | `ActiveControllerCount`, controller logs, quorum health |
| Auth failures everywhere | Expired certificate | Certificate expiry dates — set an alert 30 days out, because this *will* happen eventually |

**4. Stabilise before you optimise.** Restore availability first: bring the broker back, add disk, roll back the bad deploy, temporarily scale consumers. Resist the urge to make config changes under pressure — especially durability settings.

**5. Verify no data was lost.** After recovery, reconcile: producer-sent counts vs broker-received vs consumer-processed vs business records. In a payments platform this is a required step, not an optional one, and it's what the incident review will ask about.

**6. Post-incident.** Blameless review, timeline, contributing factors, and concrete actions: alert thresholds that would have caught it earlier (disk at 70 %, under-min-ISR > 0, certificate expiry), runbook updates, and a game-day to test the fix.

---

## References — official documentation

| Topic | Source |
|---|---|
| Apache Kafka documentation (full) | https://kafka.apache.org/documentation/ |
| Introduction / core concepts (topics, partitions, offsets) | https://kafka.apache.org/documentation/#intro |
| Kafka design (persistence, efficiency, zero-copy) | https://kafka.apache.org/documentation/#design |
| Replication, ISR, leader election | https://kafka.apache.org/documentation/#replication |
| Message delivery semantics | https://kafka.apache.org/documentation/#semantics |
| Producer configuration (`acks`, `enable.idempotence`, batching) | https://kafka.apache.org/documentation/#producerconfigs |
| Consumer configuration (`max.poll.*`, `session.timeout.ms`, assignors) | https://kafka.apache.org/documentation/#consumerconfigs |
| Topic configuration (`min.insync.replicas`, retention, compaction) | https://kafka.apache.org/documentation/#topicconfigs |
| Consumer groups & rebalancing | https://kafka.apache.org/documentation/#intro_consumers |
| Log compaction | https://kafka.apache.org/documentation/#compaction |
| Transactions / exactly-once semantics | https://kafka.apache.org/documentation/#semantics_exactly_once |
| Security (TLS, SASL, ACLs) | https://kafka.apache.org/documentation/#security |
| KRaft mode | https://kafka.apache.org/documentation/#kraft |
| Operations & monitoring (JMX metrics) | https://kafka.apache.org/documentation/#operations |
| Kafka Connect (incl. connector DLQ) | https://kafka.apache.org/documentation/#connect |
| Kafka Streams — exactly-once v2 | https://kafka.apache.org/documentation/streams/ |
| Amazon MSK developer guide | https://docs.aws.amazon.com/msk/latest/developerguide/what-is-msk.html |
| Amazon MSK — IAM access control | https://docs.aws.amazon.com/msk/latest/developerguide/iam-access-control.html |
| Amazon MSK — monitoring (consumer lag metrics) | https://docs.aws.amazon.com/msk/latest/developerguide/monitoring.html |
| Confluent Schema Registry | https://docs.confluent.io/platform/current/schema-registry/index.html |
| Transactional outbox pattern (AWS) | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html |

---

**Previous:** [07 — Event-Driven Architecture](./07-Event-Driven-Architecture.md) | **Next:** [09 — AWS Architecture](./09-AWS-Architecture.md)
