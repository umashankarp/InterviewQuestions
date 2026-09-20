# Kafka & RabbitMQ — Cram Sheet

> Tier 1/2 · Source: `19-Kafka/` + `20-RabbitMQ/` (3 modules, 1,533 lines) · Read: 12 min

---

## 1. The comparison (the question you will actually be asked)

| | **Kafka** | **RabbitMQ** |
|---|---|---|
| Model | distributed **append-only log** | **broker with routing** (exchanges → queues) |
| Consumption | consumers track an **offset**; messages stay | broker **removes on ack** |
| Replay | ✔ native, rewind the offset | ✖ (only via a DLQ/shovel trick) |
| Routing | dumb broker, smart consumer | **rich routing: direct/topic/fanout/headers** |
| Ordering | per-partition | per-queue (broken by competing consumers) |
| Throughput | very high (sequential disk, zero-copy, batching) | high, but lower |
| Per-message TTL / priority | ✖ | ✔ |
| Best for | event streaming, replay, multi-consumer, analytics | task queues, RPC, complex routing, per-message control |

**One-line answer:** *Kafka is a durable log you read from; RabbitMQ is a router that hands work out and forgets it.* Choose Kafka when more than one consumer needs the data or anyone might need to replay; choose RabbitMQ when you need per-message routing, priority or TTL, and the message is a task, not a fact.

---

## 2. Kafka Architecture

- **Topic → partitions → ordered, immutable, append-only log.** The partition is the unit of **both ordering and parallelism**.
- **Partition key** → `hash(key) % partitions` decides placement. Same key ⇒ same partition ⇒ ordered.
- **Replication:** each partition has one **leader** and N-1 followers. All reads and writes go to the leader.
- **ISR (in-sync replicas)** = replicas caught up within `replica.lag.time.max.ms`. A follower that falls behind drops out of the ISR; leader election only picks from the ISR (unless you enable unclean election, which **trades durability for availability** — say that explicitly).
- **`min.insync.replicas`** — the number of replicas that must acknowledge. Combined with `acks=all`, this is what actually gives durability. `min.insync.replicas=2` with RF=3 is the standard production setting.

**`acks` — the producer's durability/latency trade:**
| | Guarantee | Risk |
|---|---|---|
| `acks=0` | fire and forget | silent loss |
| `acks=1` | leader wrote it | **loss if the leader dies before replication** |
| `acks=all` | all ISR wrote it | slowest, safe (**use with `min.insync.replicas ≥ 2`**) |

- **Zero-copy (`sendfile`)** and sequential disk writes are why Kafka is fast — it is not held in memory, it relies on the page cache.

---

## 3. Consumer Groups & Rebalancing

- **A consumer group is Kafka's competing-consumers mechanism.** Each partition is assigned to exactly **one** consumer in the group.
- **Therefore: max useful parallelism = partition count.** Extra consumers sit idle. (Most-common wrong answer to "how do I speed up my consumer.")
- **Rebalancing** triggers on: a consumer joining, leaving, crashing, or **exceeding `max.poll.interval.ms`** (slow processing looks like death).
  - **Eager (stop-the-world)** rebalance pauses the whole group. **Cooperative/incremental** rebalance only moves the affected partitions — prefer it.
  - **Static membership** (`group.instance.id`) avoids a rebalance on a rolling restart.
  - A **rebalance storm** = consumers never finish a poll cycle, so the group never stabilises. Fix by raising `max.poll.interval.ms`, lowering `max.poll.records`, or making processing faster.
- **Offsets** are stored in the internal `__consumer_offsets` topic.
  - **Commit *after* processing = at-least-once** (the default, correct choice).
  - Commit *before* = at-most-once (loses on crash).
  - Auto-commit is a trap: it commits on a timer regardless of whether processing succeeded.

---

## 4. Kafka Exactly-Once & Transactions

- **Idempotent producer** (`enable.idempotence=true`, now default) — the broker dedupes by `(producerId, sequenceNumber)` **within a producer session**. Stops duplicates from producer retries only.
- **Transactions** — atomically commit a **consume-transform-produce** cycle: the output records *and* the consumer offset commit land together. Consumers must set `isolation.level=read_committed`.
- **The scope limit to state:** this is exactly-once **inside Kafka**. A side effect in your database or an outbound HTTP call is not covered. For those you still need an idempotency key at the effect.

---

## 5. Kafka Streams · ksqlDB · Log Compaction

- **Kafka Streams is a library, not a cluster** — it runs inside your app, scales by adding instances, keeps local state in RocksDB backed by a changelog topic. No separate processing cluster to operate (the key advantage over Flink/Spark for many teams).
- **ksqlDB** — SQL over streams; good for simple transformations and for non-Java teams.
- **Log compaction** — retain only the **latest value per key**, forever. Turns a topic into a durable changelog / materialisable table.
  - Use for: state snapshots, CDC, configuration, a rebuildable lookup table.
  - **Tombstone** = a record with a `null` value, which deletes the key (and is itself retained for `delete.retention.ms`).
  - **Compacted vs time retention:** compaction for "current state per key"; time/size retention for "a window of events."

---

## 6. RabbitMQ

- **Exchanges are the routing layer Kafka has no equivalent for.** Producers publish to an exchange, never directly to a queue; bindings decide where it lands.

| Exchange | Routing |
|---|---|
| **Direct** | exact routing-key match |
| **Topic** | pattern match — `order.*.created`, `#` = many words, `*` = one |
| **Fanout** | to every bound queue, ignores the key |
| **Headers** | match on header attributes instead of the key |

- **Acknowledgment is consumer-driven**: the message is removed only on `basic.ack`. **`ack` on delivery = at-most-once; `ack` after processing = at-least-once.**
- **`nack`/`reject`** with `requeue=true` (retry) or `requeue=false` (→ dead-letter exchange). **`requeue=true` on a poison message creates an infinite hot loop** — the classic RabbitMQ outage.
- **Durability needs three independent settings, and all are required:** a **durable queue** + **persistent messages** (`delivery_mode=2`) + **publisher confirms**. Setting only one gives you no guarantee at all — this is the #1 RabbitMQ interview trap.
- **Dead Letter Exchange (DLX)** — where messages go on reject, TTL expiry, or queue overflow. Combine a DLX with a per-message TTL to build a **delayed-retry queue**.
- **Prefetch (`basic.qos`)** — how many unacked messages a consumer may hold. Unlimited prefetch destroys fair dispatch and blows up memory; a small prefetch (1–30) is the usual answer.
- **Quorum queues** (Raft-based) are the modern replicated queue; classic mirrored queues are deprecated.

---

## Top traps

1. More consumers than partitions → idle consumers.
2. `acks=1` and calling it durable.
3. `acks=all` **without** `min.insync.replicas ≥ 2` (RF=3 with only the leader in the ISR still acks).
4. Auto-commit offsets → silent message loss on crash.
5. Slow processing → `max.poll.interval.ms` exceeded → rebalance storm.
6. Increasing partitions breaks existing key→partition ordering.
7. Claiming Kafka EOS covers external side effects.
8. RabbitMQ `requeue=true` on a poison message → infinite loop.
9. Durable queue but non-persistent messages (or no publisher confirms).
10. Unbounded RabbitMQ prefetch.

---

## Interview Q&A — Lead / Principal

### Q1 · The messages that vanished *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"After a broker failure we're missing about 4,000 events. `acks` was set to 1 and replication factor is 3. Explain."*

**Answer.** `acks=1` means the **leader** acknowledged and nothing more. If the leader dies before followers replicate, those writes are gone — replication factor 3 doesn't help if you never waited for the replicas. That's the direct cause of the 4,000.

The full durable configuration is three settings that must agree, and quoting all three is the answer: **`acks=all`** *and* **`min.insync.replicas=2`** with RF=3 — `acks=all` alone is insufficient, because if only the leader is in the ISR then "all" means one. Plus **`unclean.leader.election.enable=false`**, or an out-of-sync replica can be promoted and silently truncate the log. Producer-side, `enable.idempotence=true` with retries, so producer retries don't create duplicates.

On the consumer side, the mirror-image loss: **auto-commit** commits offsets on a timer regardless of whether processing succeeded, so a crash mid-processing skips those messages permanently. Disable it and commit after processing — which gives at-least-once and therefore requires idempotent handling.

Then the thing I'd raise unprompted: `min.insync.replicas=2` means that losing two brokers stops **writes**. That's a deliberate availability-for-durability trade, and someone senior should have agreed it rather than it being a default nobody chose.

**Why it lands.** All three durability settings and why any one alone fails, the consumer-side mirror, and surfaces the availability trade as a decision.
**✗ Weak answer.** "Set `acks=all`" alone.
**↳ Follow-ups.** What happens when two brokers are down? Where would you accept `acks=1`?

---

### Q2 · Increasing partitions broke ordering *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"We increased partitions from 12 to 24 to add consumer throughput. Now account events are being processed out of order. Why?"*

**Answer.** Partition assignment is `hash(key) % partitionCount`, so **changing the count remaps every key**. An account whose events used to land on partition 3 now lands on 17, and events already in 3 are still being consumed — so two partitions hold events for the same account and nothing preserves order between them. Kafka only ever guarantees **per-partition** ordering; you inherited ordering-per-key from the stable mapping, and increasing partitions dissolved it.

Recovery: the cleanest is to drain — stop producing, let consumers fully catch up so no key has in-flight events on two partitions, then resume. If draining isn't acceptable, you need consumer-side ordering by sequence number or version per key, which is real work.

Prevention: **over-provision partitions up front**, because you can add but never remove them, and they're cheap relative to this problem. And if throughput was the goal, I'd check the diagnosis first — more partitions only help if consumers were the bottleneck *and* consumers already equalled partitions. If one key is hot, more partitions change nothing at all, because the hot key still maps to exactly one.

**Why it lands.** Explains the remap precisely, gives a recovery path, and challenges whether more partitions addressed the actual bottleneck.
**✗ Weak answer.** "Kafka guarantees ordering" — only per partition, which is the point.
**↳ Follow-ups.** How many partitions would you start with? What if the hot key is one large customer?

---

### Quick-fire (30 seconds each)

- **"Kafka or RabbitMQ?"** → Kafka if the data is a *fact* that more than one consumer needs, or anyone might need to replay — it's a retained log, consumers hold an offset. RabbitMQ if the message is a *task* for exactly one worker and I need routing, priority or per-message TTL — it's a router that deletes on ack. Replay and multi-consumer fan-out are the deciding capabilities; rich routing and per-message control are the counterweight.
- **"How do you guarantee no message loss in Kafka?"** → On the producer, `acks=all` with `enable.idempotence` and retries. On the broker, replication factor 3 with `min.insync.replicas=2`, and unclean leader election disabled — otherwise an out-of-sync replica can be elected and silently truncate. On the consumer, disable auto-commit and commit offsets only after processing succeeds, which gives at-least-once and therefore requires idempotent handling.
- **"Why is my consumer lag growing?"** → Establish runway first — lag against retention, because past that point the data is gone. Then find which of four causes: producer spike, consumer slowdown, partition skew, or a rebalance storm from processing exceeding `max.poll.interval.ms`. Adding consumers only helps if partitions exceed consumers, so that's rarely the right first move.

---

**Go deeper:** `19-Kafka/01`–`02`, `20-RabbitMQ/01` · **Related:** [[18-Event-Driven-Architecture]], [[34-CQRS-EventSourcing-Saga-Outbox]]
