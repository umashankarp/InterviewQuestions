# Event-Driven Architecture — Cram Sheet

> Tier 1 · Source: `18-Event-Driven-Architecture/` (8 modules, 4,729 lines) · Read: 18 min

---

## 1. Event Styles

| | **Event Notification** (thin) | **Event-Carried State Transfer** (fat) |
|---|---|---|
| Payload | ids only — `OrderPlaced { orderId }` | full state — `OrderPlaced { order, customer, items }` |
| Consumer | calls back to fetch details | self-sufficient, no callback |
| Coupling | runtime coupling (availability) | schema coupling (payload shape) |
| Risk | chatty; producer must stay up | stale data; large payloads; hard to evolve |

**Choose by:** does the consumer need to work when the producer is down? → state transfer. Is the payload large, sensitive, or changing fast? → notification. A common middle: notification + a versioned snapshot the consumer can fetch later.

---

## 2. Choreography vs Orchestration

- **Choreography** — each service reacts to events independently. No central coordinator. **Pro:** loose coupling, easy to add a consumer. **Con:** the workflow exists nowhere; nobody can answer "where is order 123 in the process?" Debugging is archaeology.
- **Orchestration** — a coordinator explicitly drives the steps. **Pro:** the workflow is visible, testable, and has a status you can query. **Con:** the orchestrator is a coupling point and can grow into a god service.
- **The mature answer:** choreography for *notification* ("something happened, react if you care"), orchestration for *business transactions with a defined outcome* (payment, onboarding, trade settlement). Use orchestration wherever someone will ask "what's the status?"

---

## 3. Topics vs Queues

- **Queue** = competing consumers, one message → **one** consumer. Work distribution.
- **Topic/log** = pub-sub, one message → **every** subscriber group. Broadcast + replay.
- Pick by: *does more than one independent consumer need this, and does anyone need to replay history?*

---

## 4. Schema Evolution

- **Schema registry** enforces compatibility **before an event ever ships** — this is the point: fail at CI/publish time, not in a consumer at 3am.
- **Compatibility modes:**
  - **BACKWARD** — new *consumer* can read old data. (Safe: add optional fields, delete fields.) Upgrade **consumers first**.
  - **FORWARD** — old consumer can read new data. (Safe: add fields, delete optional fields.) Upgrade **producers first**.
  - **FULL** — both. Only additive optional changes.
- **The practical rule:** additive-only, every new field optional with a default, never reuse a field name or tag, never change a type. Consumers are **tolerant readers**.

---

## 5. Ordering & Partitioning

- **You get per-key ordering, not global ordering.** Global ordering means one partition, which means no parallelism.
- Choose the partition key to match the ordering requirement: `accountId` for ledger events, `orderId` for order lifecycle.
- **Key skew = hot partition.** One key exceeding a partition's throughput is the classic failure. Mitigate with a composite key, or accept the skew and isolate it.
- **Increasing partition count re-maps keys** (`hash % N`), so ordering across the change is broken. Plan partitions generously up front; you cannot decrease them.

---

## 6. Delivery Semantics

- **At-most-once** — ack before processing. Fast, loses messages.
- **At-least-once** — ack after processing. **The default and the correct choice.** Duplicates happen.
- **"Exactly-once" is not a delivery property.** State the identity: **`exactly-once = at-least-once (retry) AND at-most-once (idempotent consumer)`**. The dedupe lives in the consumer, not the wire.
- **Kafka's "exactly-once semantics" is narrower than the name suggests:** it covers a consume-transform-produce cycle *within Kafka* (idempotent producer + transactions spanning the offset commit and the output write). It does **not** make a side effect in your database or an external HTTP call exactly-once.
- **Internal vs external idempotency are different problems:** internal you control both sides; external you must reconcile because the third party's view is authoritative.

---

## 7. Dead Letter Queues

- A **poison message** (unprocessable, fails forever) blocks the partition behind it — head-of-line blocking. The DLQ isolates it so the stream continues.
- **A DLQ is not a dustbin.** It needs: an owner, an alarm on depth, a documented triage process, and a **replay path**.
- Preserve the original message plus failure metadata (error, attempt count, timestamps, trace id).
- **Retry then DLQ:** bounded retries with backoff first; DLQ only for non-transient failures.

---

## 8. Event Replay

- A retained, durable log lets you **rebuild a consumer's state from scratch** — the operational superpower over a queue.
- Uses: fixing a consumer bug, building a new read model, backfilling a new service, disaster recovery.
- **Replay requires idempotent consumers and a way to reset offsets.** Also: replaying into a system with side effects (emails, payments) needs a guard, or you re-send everything.

---

## 9. Stream Processing

- **Event time vs processing time — everything rests on this.** Event time = when it happened; processing time = when you saw it. Out-of-order and late data are normal, not exceptional.
- **Windows:** *tumbling* (fixed, non-overlapping — "per minute") · *hopping/sliding* (overlapping — "5-min window every 1 min") · *session* (gap-based — user activity bursts).
- **Watermarks** decide when to stop waiting for late data: "I believe I've seen everything up to time T." Too aggressive → dropped data; too lax → unbounded state and delayed results.
- **Late data — three strategies:** drop · **side output** (route to a late-data stream) · **allowed lateness + update the emitted result** (requires downstream to handle restatements).
- **State stores + checkpointing:** local state (RocksDB), periodically checkpointed, restored on failure. Recovery time is proportional to state size — a real operational constraint.
- **Stream-stream joins need bounds** — an unbounded join buffers forever. Always a windowed join.

---

## 10. Backpressure & Consumer Lag

- **Lag is a position, not an error.** It's the offset distance between the log head and the consumer. Non-zero lag is normal.
- **The retention boundary is where lag becomes loss** — if lag exceeds retention, the data the consumer needed is gone. **Alert on `retention_remaining − lag`, not on lag alone.**
- **Four distinct causes of lag** (diagnose before you scale): (1) producer spike; (2) consumer slowed down (a downstream dependency, GC, a bad deploy); (3) partition skew — one key hot; (4) rebalancing storm — consumers never make progress.
- **Adding consumers only helps if partitions > consumers.** Beyond partition count, extra consumers sit idle. This is the most common wrong fix.
- **Head-of-line blocking:** one slow key delays everything behind it in the partition. Fix with priority lanes / separate topics, not more threads.
- **Catch-up thundering herd:** a recovered consumer floods downstream at full speed. Rate-limit the catch-up.

---

## 11. Cross-Region Event Distribution

- **Replication is a second pipeline, not an extension of the first** — it has its own lag, failure modes and monitoring.
- **Ordering survives per-partition, not globally**, and only if the replicator preserves partitioning.
- **Offsets do not survive replication.** Failover must resume **by timestamp or by content (a business key)**, never by offset — this is the mistake that silently reprocesses or skips.
- **RPO is a property of replication lag at the moment of failure.** Measure it continuously; that number *is* your RPO.
- **Active-active needs a conflict-resolution discipline**, not just bidirectional links.
- **Origin tagging prevents replication loops** (an event replicated back to where it came from).
- **Data residency makes replication selective**, not blanket — filter at the replicator.

---

## 12. Testing & Chaos

- **Mocked integration tests systematically miss this domain's real failures** — duplicates, reordering, late data, schema drift, partial consumption. The mock always behaves.
- **Consumer-driven contract tests** decouple deployability from schema agreement.
- **Replay-based testing** — validate a new consumer against a captured slice of real production events. The highest-value technique here.
- **Chaos for pipelines: inject the conditions, not the symptoms** — duplicate messages, reorder within a partition, delay a consumer, kill a broker, publish a bad schema.
- **Testing choreographed flows end-to-end is hard precisely because there is no central place to query status** — which is itself an argument for orchestration where it matters.
- **Pre-production testing has limits** — production verification (reconciliation, sampled assertions) remains necessary.

---

## Top traps

1. Claiming exactly-once delivery.
2. Alerting on lag without the retention boundary.
3. Adding consumers beyond the partition count.
4. Global ordering as a requirement (kills parallelism).
5. Increasing partitions and breaking key→partition mapping.
6. DLQ with no owner, alarm, or replay path.
7. Choreography for a workflow someone will ask the status of.
8. Ordering by processing time instead of event time.
9. Resuming cross-region failover by offset.
10. Unbounded stream-stream joins.

---

## Interview Q&A — Lead / Principal

### Q1 · Consumer lag is growing *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"It's 2am. Consumer lag on the settlement topic has been climbing for an hour. What do you do?"*

**Answer.** First question isn't "why" — it's **how much runway is left**, because that determines whether this is an incident or a ticket. Lag against **retention** is the number: once lag exceeds retention, the data the consumer needed is deleted and the loss is permanent and unrecoverable. So I want `retention_remaining − lag` and a trend, and if that's measured in minutes I'm buying time first — extending retention on the topic, which is usually a live config change — before diagnosing anything.

Then which of four causes: a **producer spike** (check inbound rate), the **consumer slowed down** (a bad deploy, a downstream dependency, GC), **partition skew** where one key is hot so one consumer is saturated while others idle, or a **rebalance storm** where processing exceeds `max.poll.interval.ms` so the group never stabilises and nothing progresses. Each has a different fix, which is why diagnosing before acting matters.

The common wrong move is adding consumers — that only helps if partitions exceed consumers, and beyond partition count extra consumers sit idle doing nothing. If it's skew, more consumers change nothing at all.

And afterwards: alert on **`retention_remaining`**, not on lag, because lag is a position and non-zero lag is normal, so a lag alert gets tuned into noise and ignored.

**Why it lands.** Runway before cause, buys time first, four causes with distinct fixes, and fixes the alerting so the next one pages correctly.
**✗ Weak answer.** "Scale out the consumer group."
**↳ Follow-ups.** What if lag already exceeded retention? How do you catch up without overwhelming downstream?

---

### Q2 · Schema evolution across teams *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"A producer team wants to rename a field in an event consumed by six other teams. How do you handle it?"*

**Answer.** You don't rename — a rename in a shared event contract is a remove plus an add, and it breaks every consumer that hasn't deployed. The mechanism is **expand–contract on the schema**: add the new field alongside the old, producers populate both, consumers migrate at their own pace, and only when telemetry shows nobody reads the old field do you remove it. That telemetry is what makes it finishable rather than open-ended.

The structural control is a **schema registry with a compatibility mode enforced at publish time**, so the incompatible change fails in CI rather than in a consumer at 3am. Choose the mode deliberately: **BACKWARD** means new consumers can read old data, so you upgrade consumers first; **FORWARD** means old consumers can read new data, so producers go first. With six independent consumers and no coordinated release, **FULL** is what you want — additive, optional fields only — because it removes the ordering requirement entirely.

The cultural half: consumers must be **tolerant readers** that ignore unknown fields, or every additive change becomes breaking anyway. I'd verify that's true before relying on it, because it's usually assumed rather than tested — and I'd add a consumer-driven contract test so the producer's CI knows what six teams actually depend on.

**Why it lands.** Refuses the rename, gives expand–contract with a completion signal, picks the compatibility mode with the reason, and checks the tolerant-reader assumption rather than assuming it.
**✗ Weak answer.** "Version the event to v2" — sometimes right, but it doubles the topic and doesn't remove the coordination.
**↳ Follow-ups.** What if a consumer never migrates? Where does the registry sit in CI?

---

### Q3 · Choreography or orchestration for a payment flow *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"Order → payment → inventory → shipping. Events or an orchestrator?"*

**Answer.** Orchestration, and the deciding argument is a question someone will ask within a week of launch: *"where is order 12345 right now?"* With pure choreography the workflow exists nowhere — it's an emergent property of six services reacting to each other — so answering that means reconstructing it from logs across all six, and there's no place to put a timeout, a retry policy, or a compensation. With an orchestrator the saga state is a persisted aggregate you can query, test and visualise.

The cost I'd state honestly: the orchestrator is a coupling point and can grow into a god service if business logic leaks into it. The discipline is that it coordinates — it decides *what happens next*, never *how* each step works — and each step's logic stays in its owning service.

Where choreography is right: notification-style events where consumers are genuinely optional and independent, and adding a seventh consumer shouldn't require changing anything. "Order placed → update the recommendation index" is choreography; "order placed → take money" is orchestration. Most real systems are both, and saying that is better than picking a side.

**Why it lands.** Decides on an operational question rather than a preference, names the god-service risk with the discipline that prevents it, and splits by event type.
**✗ Weak answer.** "Choreography, it's more loosely coupled" — true and insufficient for a money flow.
**↳ Follow-ups.** Where does saga state live? What happens if the orchestrator dies mid-saga?

---

### Quick-fire (30 seconds each)

- **"How do you get exactly-once processing?"** → You don't get it on the wire. You get at-least-once delivery from retries plus at-most-once effect from an idempotent consumer — that composition is exactly-once. Concretely: a stable business-derived idempotency key, and a dedupe record written in the *same transaction* as the side effect. Kafka's EOS only covers consume-transform-produce inside Kafka; it does nothing for your database write or an outbound API call.
- **"Consumer lag is growing — what do you do?"** → First establish how much runway is left: lag against retention, because that's where lag becomes permanent loss. Then diagnose which of four causes it is — producer spike, consumer slowdown, partition skew, or a rebalance storm — because the fix differs. Adding consumers only helps if I have spare partitions, which is the most common wrong first move.
- **"Choreography or orchestration?"** → Choreography for notifications where consumers are optional and independent. Orchestration for any business transaction with a defined outcome, because someone will eventually ask "where is this order?" and with pure choreography the workflow exists nowhere — you'd be reconstructing it from logs across five services.

---

**Go deeper:** `18-Event-Driven-Architecture/01`–`08` · **Related:** [[19-Kafka-RabbitMQ]], [[34-CQRS-EventSourcing-Saga-Outbox]], [[34-CQRS-EventSourcing-Saga-Outbox]], [[34-CQRS-EventSourcing-Saga-Outbox]]
