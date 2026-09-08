# 7. Event-Driven Architecture — 25 Questions (Answered)

> **Method:** definitions are taken from the **Azure Architecture Center (Event-Driven Architecture style)**, **Microsoft Learn (.NET microservices e-book — event-driven communication)**, **AWS (Event-Driven Architecture / EventBridge / SNS-SQS documentation)** and the **Apache Kafka documentation**, then extended with architect-level trade-offs. Links in **References**.

---

## Q1. What is Event-Driven Architecture?

**Per Azure Architecture Center ("Event-driven architecture style"):** *"An event-driven architecture consists of event producers that generate a stream of events, and event consumers that listen for the events... Producers are decoupled from consumers — a producer doesn't know which consumers are listening. Consumers are also decoupled from each other, and every consumer sees all of the events."*

**Per AWS ("What is an Event-Driven Architecture?"):** *"An event-driven architecture uses events to trigger and communicate between decoupled services... An event is a change in state, or an update... Event-driven architectures have three key components: event producers, event routers, and event consumers."*

**The two documented delivery models (Azure names both):**

| Model | Behaviour | Technology |
|---|---|---|
| **Pub/sub** | The messaging infrastructure tracks subscriptions; each event is delivered to each subscriber **once**; events are **not replayable** after delivery | Azure Event Grid, **Amazon SNS**, **EventBridge** |
| **Event streaming** | Events are written to a **durable, ordered log**; consumers track their own position and can **re-read from any offset**; events persist for a retention period | **Apache Kafka**, Amazon Kinesis, Azure Event Hubs |

That distinction matters enormously in design: streaming gives you replay, late-joining consumers and reprocessing; pub/sub does not.

**The properties that follow from the definition:**
- **Producer autonomy** — the producer publishes a fact and moves on; it doesn't know or care who consumes.
- **Temporal decoupling** — consumers can be down; the event waits (durably, in a log or queue).
- **Extensibility** — add a fifth consumer of `PaymentAuthorized` (say, a new fraud model) with **zero change to the producer**. This is the single biggest practical benefit.
- **Eventual consistency** — the inevitable cost.

---

## Q2. Event vs command?

**Per Microsoft Learn (.NET microservices e-book) and the Azure messaging guidance**, the distinction is one of **intent and coupling**:

| | **Command** | **Event** |
|---|---|---|
| Meaning | *"Do this"* — an instruction | *"This happened"* — a statement of fact |
| Tense | Imperative: `AuthorizePayment` | **Past tense**: `PaymentAuthorized` |
| Receivers | **Exactly one** | **Zero to many** |
| Sender knows receiver? | **Yes** — it addresses a specific handler | **No** |
| Can it be rejected? | **Yes** — the handler may refuse | **No** — it already happened; you can't reject history |
| Coupling | Higher (sender depends on the receiver's contract) | Lower |
| Transport | Queue (SQS, RabbitMQ queue, Service Bus queue) | Topic / log (SNS, EventBridge, Kafka topic) |
| Failure meaning | The instruction wasn't carried out | A consumer failed to *react*; the fact still stands |

```csharp
// Command — imperative, one handler, may be rejected
public sealed record AuthorizePayment(Guid PaymentId, Money Amount, string IdempotencyKey);

// Event — past tense, immutable fact, any number of subscribers
public sealed record PaymentAuthorized(Guid PaymentId, Money Amount, string AuthCode, DateTimeOffset OccurredAt);
```

**Why the naming discipline matters:** a message named `UpdateLedger` published to a topic is a command masquerading as an event — the producer now knows the ledger exists and depends on it, which reintroduces exactly the coupling EDA removes. Enforcing past-tense event names in review is a cheap, high-value architectural control.

---

## Q3. Event vs message?

**"Message" is the general term; "event" is one kind of message.** Per Microsoft's messaging guidance, a **message** is any payload sent from a sender to a receiver via a messaging infrastructure; the **three message types** are:

| Type | Contains | Contract owner | Example |
|---|---|---|---|
| **Command** | An instruction + parameters | The **receiver** defines it | `AuthorizePayment` |
| **Event** | A fact about something that happened | The **producer** defines it | `PaymentAuthorized` |
| **Document / query-reply** | Data with no instruction or claim of change | Shared | `CustomerRecord`, `RateResponse` |

**Per Azure's own framing:** *"a message is raw data produced by a service to be consumed... The producer of the message has an expectation about how the consumer handles the message. An event is a lightweight notification of a condition or a state change. The publisher has no expectation about how the event is handled."* That sentence — **expectation vs no expectation** — is the cleanest way to state the difference in an interview.

**Practical consequence for contract ownership:** because the *receiver* owns a command's contract, changing it requires coordinating with senders. Because the *producer* owns an event's contract, changing it requires care with **all** consumers (which is why event versioning and Schema Registry compatibility rules exist — Q18–Q20).

---

## Q4. Event notification vs event-carried state?

These are two of the four commonly-named event styles (Fowler's taxonomy, widely reflected in Microsoft and AWS guidance):

**1. Event Notification — a thin "something happened, go look":**
```json
{ "eventType": "PaymentAuthorized", "paymentId": "p_123", "occurredAt": "2026-09-07T10:22:31Z" }
```
- ✅ Tiny payloads; no data duplication; the producer's schema stays private.
- ❌ Every consumer must **call back** to the producer to get details → the producer becomes a synchronous dependency of all its consumers (**you've reintroduced coupling**), N callbacks per event, and a race where the callback reads a *newer* state than the event described.

**2. Event-Carried State Transfer — the event carries the data consumers need:**
```json
{ "eventType": "PaymentAuthorized", "paymentId": "p_123", "amountMinor": 12500, "currency": "GBP",
  "merchantId": "m_9", "authCode": "A1B2C3", "occurredAt": "2026-09-07T10:22:31Z", "version": 7 }
```
- ✅ Consumers are **fully autonomous** — no callback, works even if the producer is down, no read amplification, and the event is a point-in-time snapshot (correct by construction).
- ❌ Larger payloads; data duplicated across services; the event schema becomes a **published contract** that is hard to change; potential leakage of the producer's model.

**The other two styles to name:** **Event Sourcing** (events are the system of record — §13) and **CQRS** (events build read models — §14).

**My default recommendation:** **event-carried state transfer for cross-service events**, carrying the *consumer-relevant subset* of state (not the producer's whole internal model), plus a version/sequence number and the entity ID so a consumer can still fetch more if it truly needs to. Reserve pure notification for very high-volume, low-value signals, or where payload data is sensitive (a PCI/PII concern — don't broadcast card data to five services just for convenience).

---

## Q5. What are the benefits of EDA?

**Per AWS and Azure documentation, the stated benefits:**

1. **Loose coupling / independent evolution.** Producers don't know consumers. AWS's phrasing: *"Event-driven architectures... allow you to add new consumers without modifying producers."* This is the benefit that compounds — the fifth consumer costs nothing to the producer team.
2. **Independent scaling.** Each consumer scales to its own throughput needs; a slow consumer doesn't slow the producer.
3. **Resilience / temporal decoupling.** The broker buffers durably: a consumer outage becomes a backlog (lag), not a failed transaction. This converts hard dependencies into soft ones.
4. **Load levelling.** The queue absorbs spikes (Azure's **Queue-Based Load Levelling** pattern) so downstream systems see a smoothed rate rather than the peak.
5. **Responsiveness / lower perceived latency.** The producer returns as soon as the event is durably written; the work happens asynchronously (accept → 202 → process).
6. **Auditability and replay** (with a log-based broker) — the event stream is a durable record you can reprocess to rebuild state, backfill a new consumer, or investigate an incident.
7. **Real-time reactivity** — the natural fit for fraud detection, risk limits, notifications and streaming analytics.
8. **Polyglot / team autonomy** — consumers can be any language, owned by any team, deployed on any cadence.

**In a fintech framing:** one `PaymentAuthorized` event feeds the ledger, fraud scoring, the notification service, regulatory reporting, the data lake and the customer's live balance — six consumers, one publish, and the payment service knows about none of them.

---

## Q6. When should you NOT use EDA?

Azure's guidance is explicit that EDA introduces *"eventual consistency, complexity in debugging, and duplicate/out-of-order message handling."* Concretely, avoid it when:

1. **You need an immediate, synchronous answer.** Card authorisation, balance checks, login — the caller is waiting and the response *is* the point. Use request/response.
2. **Strong consistency is required across the operation.** If the business cannot tolerate a window where two services disagree, an asynchronous event is the wrong mechanism (or you need a saga with explicit pending states, which is more work than a synchronous call).
3. **Simple point-to-point with one consumer and no buffering need.** A broker adds infrastructure, operational burden and latency for no benefit — a direct call is honest and simpler.
4. **The team/platform isn't ready.** EDA needs distributed tracing through the broker, correlation IDs, DLQ handling, schema governance, consumer-lag monitoring and replay tooling. Without those, debugging is genuinely awful.
5. **Small systems / small teams.** The coordination benefit is nil; the operational cost is not.
6. **Strict global ordering across entities is required.** You can get per-key ordering cheaply, global ordering only by giving up parallelism (one partition) — usually the wrong trade.
7. **The "event" is really a command with one receiver and a required response.** Don't dress up an RPC as an event; you'll get the coupling of RPC plus the complexity of messaging.

**The balanced position:** most real systems are **hybrid** — synchronous where the user is waiting, asynchronous for everything downstream. Saying that explicitly is the mature answer.

---

## Q7. What is asynchronous communication?

**Per Microsoft Learn (.NET microservices e-book):** asynchronous communication means *"the client sends a message but doesn't wait for a response"*; the sender and receiver are **temporally decoupled** — *"the client doesn't need to wait for the service to be available."* Microsoft's guidance states asynchronous message-based communication *"is the preferred approach for communication between microservices."*

**The two axes (from the same source):** synchronous vs asynchronous **protocol**, and single-receiver vs multiple-receiver:

- **Async, single receiver** — a **command** on a queue. One consumer, competing-consumers scaling, per-message retry and DLQ. (SQS, RabbitMQ, Service Bus queue.)
- **Async, multiple receivers** — an **event** on a topic/log. Fan-out, independent consumer positions. (SNS, EventBridge, Kafka, Event Hubs.)

**Key mechanics to state:**
- **Durability is the point.** The message is persisted by the broker before the producer's call returns, so a consumer crash loses nothing.
- **Delivery is at-least-once** in every mainstream broker → **consumers must be idempotent** (Q11).
- **Backpressure is natural** — the queue/log grows and lag becomes the visible signal, instead of the producer being blocked or the consumer collapsing.
- **The trade** is eventual consistency, harder debugging (needs correlation + tracing through the broker), and duplicate/ordering concerns.

**Anti-pattern to name:** *asynchronous request-response over a broker* — publishing a request and waiting for a reply message with a correlation ID. It's occasionally justified (long-running work), but it usually recreates synchronous coupling with extra latency and complexity. Prefer HTTP/gRPC when you need a reply.

---

## Q8. What is eventual consistency?

**Per Microsoft Learn (.NET microservices e-book):** *"When we use eventual consistency driven by integration events, the data across microservices will not be immediately consistent, but will become consistent after a short period."* Azure's data-consistency guidance adds that eventual consistency means *"if no new updates are made, eventually all replicas/consumers will converge to the same value."*

**In an EDA specifically:** after `PaymentAuthorized` is published, there is a window — usually milliseconds, occasionally minutes if a consumer is lagging — during which the payment service says "authorised" and the ledger service has not yet posted the entry. Both are *correct*; they are just at different points in the same sequence.

**How to design for it — this is the part that matters:**

1. **Make it explicit in the domain model.** Statuses like `PENDING`, `PROCESSING`, `AWAITING_SETTLEMENT` are not workarounds; they are honest models of reality.
2. **Make it explicit in the UX.** "Your transfer is being processed — funds usually arrive within 30 seconds." Users tolerate stated delays; they don't tolerate a balance that appears wrong.
3. **Read-your-own-writes where it matters.** Session consistency (route the user's reads to the primary or to a store updated synchronously for their own actions) so the person who just paid sees their payment.
4. **Bound the staleness and monitor it.** Publish a metric for end-to-end lag; alert when it exceeds the business tolerance. "Eventually" must have a number attached, or it isn't an engineering statement.
5. **Idempotent, order-tolerant consumers** (Q11, Q17) so convergence actually happens.
6. **Reconciliation** to catch the cases that don't converge.
7. **Decide where you cannot accept it.** Invariants that must hold instantly (don't let a balance go negative) belong **inside one aggregate in one service with a local ACID transaction** — not across an event boundary. This is the single most important design rule in the section.

---

## Q9. How do you handle failures in EDA?

**Classify the failure first, then apply the matching mechanism** — per the retry/DLQ guidance in the Azure Architecture Center, AWS SQS/EventBridge docs and the Kafka documentation:

| Failure | Example | Handling |
|---|---|---|
| **Transient** | Downstream 503, DB deadlock, timeout | Retry in place with exponential backoff + jitter (bounded) |
| **Persistent-but-recoverable** | Dependency down for minutes | **Retry topic/queue** with a delay; don't block the partition |
| **Poison message** | Malformed payload, unknown schema | **DLQ** + alert; never retry forever (Q13) |
| **Business rejection** | Insufficient funds | Not a technical failure — publish a *rejection event*, trigger compensation |
| **Publish failure** | Broker unavailable when producing | **Outbox** so the event is never lost (Q25) |
| **Consumer crash mid-processing** | Pod evicted | At-least-once redelivery + **idempotent consumer** |
| **Slow consumer** | Lag builds | Scale consumers (≤ partition count), optimise handler, backpressure |

**The reliability spine:**
1. **Outbox on the producer** — the event is written in the same transaction as the state change, so it cannot be lost (§4 Q22).
2. **At-least-once delivery** from the broker.
3. **Idempotent consumers with an inbox/dedup table** — the durable guarantee (Q11).
4. **Bounded retry → delayed retry → DLQ**, with alerting and a documented replay procedure.
5. **Monitoring**: consumer lag, DLQ depth, processing latency, retry rate, end-to-end event age.
6. **Reconciliation** against the authoritative record for anything financial.

**The rule to state plainly:** *"in an event-driven system, failure handling is not an exception path — it is the main path. Every consumer is written assuming duplicates, out-of-order arrival and transient dependency failure."*

---

## Q10. At-least-once delivery?

**Per the Apache Kafka documentation ("Message Delivery Semantics"):** at-least-once means *"messages are never lost but may be redelivered."* It is achieved by acknowledging/committing the offset **after** processing. **Per AWS:** *"Amazon SQS standard queues provide at-least-once delivery, which means that each message is delivered at least once"*; SNS and EventBridge state the same.

**Why it is the universal default:** the alternative to redelivery is loss. Given a network can drop an acknowledgement, a broker must choose: re-send (duplicates) or don't (loss). Every serious broker chooses re-send for business data.

**The one line of code that decides the semantic:**

```csharp
// AT-LEAST-ONCE — process first, then commit. A crash between them redelivers.
await HandleAsync(message, ct);
consumer.Commit(message);

// AT-MOST-ONCE — commit first. A crash between them LOSES the message.
consumer.Commit(message);
await HandleAsync(message, ct);
```

**Sources of duplicates, so you know what you're defending against:** consumer crash after processing but before commit; consumer-group **rebalance** before commit; producer retry after a lost ack (mitigated by Kafka's `enable.idempotence=true`); SQS visibility timeout expiring while still processing; a manual DLQ replay.

**Therefore the standing obligation:** *at-least-once delivery + idempotent processing = exactly-once effect.* Everything in Q11–Q12 follows from this.

---

## Q11. How do you achieve idempotent event processing?

**Per the AWS and Azure guidance on message consumers:** because delivery is at-least-once, *"consumers should be idempotent"* — the consumer must produce the same end state whether it sees a message once or five times.

**Technique 1 — inbox / de-duplication table, committed with the work (the general answer):**

```csharp
public async Task HandleAsync(PaymentAuthorized evt, CancellationToken ct)
{
    await using var tx = await _db.Database.BeginTransactionAsync(ct);

    // unique constraint on MessageId does the dedup atomically
    _db.InboxMessages.Add(new InboxMessage(evt.MessageId, nameof(PaymentAuthorized), DateTime.UtcNow));
    try { await _db.SaveChangesAsync(ct); }
    catch (DbUpdateException e) when (e.IsUniqueViolation())
    {
        await tx.RollbackAsync(ct);
        _metrics.DuplicateEvent(nameof(PaymentAuthorized));
        return;                                    // already processed — drop silently
    }

    await _ledger.PostAsync(evt.PaymentId, evt.Amount, ct);   // the business effect
    await _db.SaveChangesAsync(ct);
    await tx.CommitAsync(ct);                                  // dedup record + effect commit TOGETHER
}
```

**The essential property:** the de-duplication record and the business effect must commit in **one local transaction**. If they're separate, a crash between them re-opens the duplicate window — and that's precisely the bug this pattern exists to close.

**Technique 2 — natural idempotency (best when available).** Make the effect absolute rather than relative:
```sql
UPDATE Payments SET Status='SETTLED', SettledAt=@t
 WHERE Id=@id AND Status='AUTHORIZED';     -- second execution affects 0 rows: harmless
```
Upserts (`MERGE`, `INSERT ... ON CONFLICT DO NOTHING`) and conditional state transitions need no extra store at all.

**Technique 3 — version-based application.** The event carries the aggregate version; apply only if `event.Version == current.Version + 1`. Handles duplicates *and* out-of-order events (Q17) in one mechanism — the standard approach for building projections.

**Technique 4 — idempotency at the external boundary.** If the effect is an outbound API call (charge a card, send an SMS), pass an idempotency key derived from the event ID so the *provider* deduplicates.

**Operational details:** the inbox table needs a **retention/TTL longer than the maximum possible redelivery window** (broker retention + your longest outage; 7–30 days typical), an index on `MessageId`, and a purge job. Redis is a valid fast pre-filter but is *not transactional with your database* — keep the durable check in the DB.

---

## Q12. How do you handle duplicate events?

**Layered defence — name all four layers:**

**1. Reduce duplicates at the producer.**
- Kafka: **`enable.idempotence=true`** — per the Kafka docs, the producer is assigned a producer ID and sequence numbers so the broker discards duplicates caused by producer retries (per partition, per producer session). Note it does *not* deduplicate an application that publishes the same logical event twice.
- Outbox with a **stable, deterministic MessageId** per business event, so a relay re-publish carries the same ID.
- SQS FIFO: `MessageDeduplicationId` gives a 5-minute deduplication window (per the SQS docs).

**2. Deduplicate at the consumer** — the inbox table (Q11). This is the durable guarantee and the one you rely on.

**3. Make effects naturally idempotent** — conditional updates, upserts, set-based operations. Cheapest and most robust; no extra state to manage.

**4. Detect and reconcile** — a duplicate-rate metric, plus reconciliation against the authoritative record for financial data.

**Choosing the deduplication key — get this wrong and the whole scheme fails:**
- ✅ A **producer-generated, business-stable ID**: `messageId` from the outbox, or `{aggregateId}:{eventType}:{version}`.
- ❌ The Kafka **offset** — changes on repartitioning and replay.
- ❌ A **payload hash** — changes when a non-semantic field (a timestamp, a trace ID) changes, so genuine duplicates look distinct.
- ❌ A consumer-generated ID — different per delivery, so it deduplicates nothing.

**Also decide the semantics of a duplicate:** for most events, silently drop and count a metric. For a *suspicious* duplicate (same key, different payload — Q12 §5), that's a producer bug: log at Warning and alert, don't swallow it.

---

## Q13. How do you handle poison messages?

**Definition (used consistently in Azure Service Bus, AWS SQS and Kafka guidance):** a **poison message** is one that a consumer cannot process successfully no matter how many times it retries — malformed payload, unknown schema version, a reference to data that doesn't exist, or a bug in the handler. Left alone in an ordered log, it **blocks the partition forever**; in a queue, it consumes retry capacity indefinitely.

**The handling policy:**

1. **Bounded retries.** Per Azure Service Bus, `MaxDeliveryCount` (default 10) auto-moves the message to the DLQ. SQS uses a **redrive policy** with `maxReceiveCount`. Kafka has no built-in DLQ — you must implement it (Q14).
2. **Classify before retrying.** A deserialization failure or a validation error will never succeed — send it to the DLQ **immediately**, don't burn 10 retries proving it. Only transient failures deserve retries.
3. **Move it out of the way.** Poison message → DLQ; the consumer commits the offset and continues. In Kafka this is essential: **do not block the partition**, because one bad message would stall every subsequent message for that key.
4. **Preserve full context.** The DLQ record must carry the original payload, headers, the failure reason and stack, the retry count, the original topic/partition/offset, and the correlation/trace ID. A DLQ entry you can't diagnose is useless.
5. **Alert.** DLQ depth > 0 is an actionable alert with an owner. A DLQ nobody watches is a data-loss mechanism with extra steps.
6. **Have a documented replay procedure** — fix the bug or the data, then replay from the DLQ back to the source topic with idempotency protecting you against double-processing.

**The failure mode to avoid, stated plainly:** *"the worst outcome isn't a poison message — it's a consumer that retries it forever, blocks the partition, builds unbounded lag, and takes down a business process because of one malformed record."*

---

## Q14. What is a DLQ?

**Per Amazon SQS documentation:** *"Dead-letter queues... are queues that source queues can target for messages that can't be processed (consumed) successfully"*, configured via a **redrive policy** specifying the DLQ ARN and `maxReceiveCount`. **Per Azure Service Bus:** every queue/subscription has an auto-created **dead-letter sub-queue** for messages exceeding `MaxDeliveryCount`, expired messages, or messages that fail filter evaluation.

**Kafka has no native DLQ** — the Kafka documentation defines no such construct. You implement it as an ordinary topic (`payments.authorized.dlq`) that your consumer produces to on terminal failure, then commits the original offset. (Kafka Connect does provide `errors.deadletterqueue.topic.name` for connector-level errors.)

**The standard three-tier topology:**

```
 main topic ──▶ consumer ──fail──▶ retry topic (delay 30s) ──▶ retry consumer
                                          │
                                       fail again
                                          ▼
                              retry topic (delay 5m) ──▶ …
                                          │
                                    max attempts
                                          ▼
                                        DLQ ──▶ alert + human/automated triage
```

**What must be true of a DLQ:**
- **Monitored and alerted** with a named owner. Depth, age of the oldest message, and arrival rate.
- **Rich context** on every entry (Q13, point 4).
- **A replay tool** that can re-publish selected messages to the source topic, with idempotency making replay safe.
- **Retention long enough** to investigate (14 days on SQS max; a Kafka DLQ topic can be configured longer).
- **Not a black hole.** The most common real-world failure is a DLQ with 40,000 messages nobody has looked at since March.

**Design note:** consider **per-consumer-group DLQs**. If five consumers read one topic and one of them fails, only that consumer's failures should be dead-lettered — a shared DLQ conflates unrelated problems.

---

## Q15. How do you implement retries?

**Per Azure Architecture Center's Retry pattern and AWS's retry guidance**, applied to messaging:

**1. Classify the failure.** Retry transient only (timeouts, 503, throttling, deadlocks). Never retry deserialization errors, validation failures, or business rejections — they will never succeed (Q13).

**2. Retry in place, briefly.** 2–3 immediate attempts with short exponential backoff **and jitter**, for blips. Keep this short — you are holding a consumer slot and, in Kafka, blocking the partition.

**3. Then move to a delayed retry, out of band.** Non-blocking retry topics/queues with increasing delays (30 s → 5 min → 30 min). Options:
   - Kafka: dedicated retry topics per delay tier, consumed by a delaying consumer.
   - SQS: re-enqueue with `DelaySeconds`, or a separate delay queue.
   - Service Bus: `ScheduledEnqueueTimeUtc` for a native delayed message.

**4. Then DLQ** after a documented maximum (Q14).

**5. Guard the critical Kafka constraint:** in-consumer retries must complete within **`max.poll.interval.ms`** (default 5 minutes) or the broker considers the consumer dead and triggers a **rebalance** — which causes redelivery, more duplicates, and often a cascading rebalance storm. This is a genuine production trap and worth naming: *long retries belong in a retry topic, not in the poll loop.*

```csharp
// keep in-poll work short; escalate to a retry topic instead of sleeping
try
{
    await _handler.HandleAsync(evt, ct);
}
catch (Exception ex) when (IsTransient(ex) && attempt < 3)
{
    await _producer.ProduceAsync($"{topic}.retry.30s", WithRetryHeaders(msg, attempt + 1, ex), ct);
}
catch (Exception ex)
{
    await _producer.ProduceAsync($"{topic}.dlq", WithFailureContext(msg, ex), ct);
}
finally { consumer.Commit(msg); }     // always advance — never block the partition
```

**6. Preserve ordering semantics deliberately.** Moving a message to a retry topic **breaks per-key ordering** for that key. If order matters for that entity, you must either pause the key (park subsequent messages for that key) or accept the reordering — decide explicitly and document it.

---

## Q16. What is backpressure?

**Definition (as used in the Kafka, Reactive Streams and .NET Channels documentation):** backpressure is the mechanism by which a **slow consumer signals a fast producer to slow down**, so that excess work does not accumulate without bound.

**How it manifests per technology:**

| Layer | Mechanism | Visible signal |
|---|---|---|
| **Kafka** | **Pull-based consumption** — consumers fetch at their own rate; `max.poll.records` bounds each batch; the log absorbs the difference | **Consumer lag** |
| **SQS** | Long polling + `MaxNumberOfMessages`; visibility timeout | `ApproximateAgeOfOldestMessage`, queue depth |
| **Service Bus** | Prefetch count, concurrent-call limits | Active message count |
| **.NET `Channel<T>`** | `BoundedChannelOptions` + `FullMode.Wait` — the **writer awaits** | Channel full |
| **HTTP API** | Rate limiting → **429 + `Retry-After`** | 429 rate |
| **TCP** | Receive window | Zero-window events |

**Why Kafka's pull model is architecturally significant:** a push-based broker must either buffer in the consumer (risking OOM) or drop. Kafka's consumers pull, so a slow consumer simply falls behind in a **durable, observable, replayable log** — the backlog is on disk, bounded by retention, and measurable as lag. That is the cleanest form of backpressure in a distributed system, and it's a strong point to make when comparing Kafka to traditional queues.

```csharp
// bounded channel: the producer is forced to wait — real backpressure, bounded memory
var channel = Channel.CreateBounded<PaymentEvent>(new BoundedChannelOptions(5_000)
{
    FullMode = BoundedChannelFullMode.Wait
});
await channel.Writer.WriteAsync(evt, ct);   // suspends when full instead of growing the heap
```

**The principle to state:** *"unbounded buffering is not resilience, it's deferred failure. Every buffer in the design needs a bound and a documented behaviour at that bound: block, shed, or spill to durable storage."*

---

## Q17. How do you handle out-of-order events?

**Why it happens:** ordering is guaranteed only **within a Kafka partition** (per the Kafka docs: *"Kafka only provides a total order over records within a partition, not between different partitions"*) or within an **SQS FIFO message group**. Parallel consumers, retries, retry topics, DLQ replays and multiple producers all reorder.

**Six strategies, in the order I'd apply them:**

1. **Partition by entity key** — `accountId`, `orderId`, `paymentId`. All events for one entity land on one partition, consumed in order by one consumer in the group. **This is the primary answer**: it converts a global-ordering problem into a per-key one, which is what the business actually requires. (SQS FIFO's `MessageGroupId` is the same idea.)
2. **Version / sequence numbers per aggregate.** Apply only if `event.Version == current.Version + 1`; **buffer** if higher (a gap — an earlier event is still in flight); **discard** if lower or equal (stale/duplicate). This handles duplicates and reordering with one mechanism and is how event-sourced projections stay correct.
3. **Idempotent, commutative or last-write-wins updates.** `UPDATE ... WHERE Version < @incoming` is order-safe by construction. Design the effect so order doesn't matter wherever the domain allows.
4. **State machines that tolerate arrival order** — a `Settled` arriving before `Authorized` parks the entity in a waiting state rather than throwing.
5. **Windowed reordering** — buffer briefly and sort by sequence, with **watermarks** and **allowed lateness** (Kafka Streams / Flink event-time semantics). Bounded memory, bounded delay, and an explicit policy for late arrivals.
6. **Detect and repair** — alert on sequence gaps; reconcile.

**Explicitly reject** ordering by producer wall-clock timestamp: clock skew makes it wrong (§5 Q14). Order by a logical sequence — per-aggregate version or partition offset.

---

## Q18. How do you version events?

**The core constraint:** an event is a **published contract** consumed by systems you may not control and, with a log-based broker, **old events remain in the log forever** (or for the retention period) — so old versions must stay readable. Confluent's Schema Registry documentation and Microsoft's integration-event guidance both frame versioning around **compatibility rules** rather than version numbers alone.

**The strategies:**

**1. Additive-only evolution (the default and the best).** Add optional fields with defaults; never remove or rename a field; never change a field's type; never tighten validation. This preserves **backward compatibility**: new consumers read old events, old consumers ignore new fields.

```json
// v1
{ "eventType":"PaymentAuthorized", "schemaVersion":1, "paymentId":"p1", "amountMinor":12500, "currency":"GBP" }
// v2 — additive only: old consumers still work
{ "eventType":"PaymentAuthorized", "schemaVersion":2, "paymentId":"p1", "amountMinor":12500, "currency":"GBP",
  "merchantCategoryCode":"5411" }
```

**2. Explicit version in the event** — `schemaVersion` field and/or a header. Always include it; it costs nothing and makes every later decision possible.

**3. New event type for a breaking change** — publish `PaymentAuthorizedV2` **alongside** `PaymentAuthorized` for a transition period. Producers dual-publish; consumers migrate one at a time; the old type is retired once traffic is zero. This is the safest breaking-change mechanism and the one I'd recommend for cross-team events.

**4. Upcasting on read** — the consumer (or a shared library) transforms v1 payloads into the current shape at deserialization. Essential in **event sourcing**, where you cannot rewrite history (§13 Q15–Q16).

**5. Weak/tolerant reader** — consumers ignore unknown fields and tolerate missing optional ones. `System.Text.Json` does this by default; make it a written rule, because a consumer that throws on an unknown field turns every additive change into an outage.

**Governance:** register schemas, enforce compatibility in CI, keep a consumer registry per event type so you know who breaks, and monitor traffic per version so you know when it's safe to retire one.

---

## Q19. How do you evolve event schemas?

**Per Confluent Schema Registry documentation, the compatibility modes define exactly what evolution is permitted:**

| Mode | Rule | Who upgrades first | Allowed changes |
|---|---|---|---|
| **BACKWARD** (default) | New **schema** can read data written by the **previous** schema | **Consumers** first | Delete fields; add **optional** fields |
| **FORWARD** | Previous schema can read data written by the new schema | **Producers** first | Add fields; delete **optional** fields |
| **FULL** | Both | Either | Add/delete **optional** fields only |
| **BACKWARD/FORWARD/FULL_TRANSITIVE** | Same, checked against **all** previous versions, not just the last | Either | Safest for long-lived logs |
| **NONE** | No checking | — | Anything (don't) |

**My standing recommendation for a durable event log: `FULL_TRANSITIVE`** — because with Kafka retention (or event sourcing) you may read events written years ago by a producer that no longer exists, so compatibility with the *immediately previous* version is not enough.

**The safe evolution procedure (expand/contract, mirrored from database migrations):**

```
1. EXPAND    — add the new optional field; producers start writing BOTH old and new.
2. MIGRATE   — consumers updated one by one to read the new field, falling back to the old.
3. VERIFY    — monitor per-version traffic until the old field is unused by all consumers.
4. CONTRACT  — stop writing the old field; later, remove it from the schema.
```
Each step is independently deployable and independently reversible — which is the whole point.

**Breaking changes that require a new event type instead:** renaming a field, changing its type or units (**minor units to major units is a catastrophic silent change in a payment system**), changing the meaning of an existing field, or making an optional field required. **Never change semantics under a stable name** — a consumer that keeps parsing successfully but now computes the wrong number is far worse than one that fails loudly.

**Operational supports:** contract tests between producer and consumer in CI, schema checks as a build gate, a documented consumer registry, and dashboards of message counts by schema version.

---

## Q20. What is Schema Registry?

**Per Confluent's documentation:** Schema Registry *"provides a centralized repository for managing and validating schemas for topic message data"*, storing versioned schemas (Avro, Protobuf, JSON Schema), assigning each a **globally unique schema ID**, and **enforcing compatibility rules** when a new version is registered.

**How it works on the wire:**
```
Producer: serialize with schema → register/lookup schema → prepend 5-byte header
          [magic byte 0x00][4-byte schema ID][Avro/Protobuf payload]
Consumer: read the schema ID → fetch (and cache) the schema → deserialize correctly
```
The schema itself is **not** in every message — only the ID — so payloads stay small while remaining self-describing.

**Why it matters architecturally:**
1. **Compatibility enforcement at registration time** — an incompatible schema is rejected in CI/deploy, *before* it can break consumers in production. This is the key control: it turns a runtime outage into a build failure.
2. **A single source of truth** for what events exist and what they contain — genuine documentation that cannot drift.
3. **Compact binary payloads** with strong typing (Avro/Protobuf) instead of verbose, untyped JSON.
4. **Safe evolution** through the documented compatibility modes (Q19).
5. **Governance and discovery** — subjects, versions, ownership, and an audit trail of schema change.

**Managed options:** Confluent Schema Registry, **AWS Glue Schema Registry** (integrates with MSK, Kinesis, Lambda — supports Avro, JSON Schema and Protobuf with compatibility modes), Azure Schema Registry in Event Hubs.

**Practical guidance:** set `FULL_TRANSITIVE` for long-retention topics; wire schema compatibility checks into the producer's CI pipeline; use the subject naming strategy deliberately (`TopicNameStrategy` by default, `RecordNameStrategy` when one topic carries multiple event types); and cache schemas client-side (the clients do this automatically) so the registry is not on the hot path.

---

## Q21. How do you monitor event-driven systems?

**The four questions your monitoring must answer**, mapped to concrete signals:

**1. Is anything falling behind?**
- **Consumer lag per group per partition** — the single most important EDA metric. Kafka exposes `records-lag-max`; SQS exposes `ApproximateAgeOfOldestMessage` (better than depth, because it's time-based and directly maps to business impact).
- Alert on **lag *trend*, not absolute value** — steadily rising lag is the actionable signal; a spike that drains is normal.

**2. Is anything failing?**
- **DLQ depth and arrival rate** (alert on > 0 with an owner).
- **Processing error rate** and **retry rate** per consumer.
- **Rebalance frequency** in Kafka — frequent rebalances mean duplicates and stalls (§8 Q16–Q17).

**3. How long does the business process actually take?**
- **End-to-end latency**: `event.OccurredAt` → effect committed. This is the number the business cares about, and it must be measured across the whole chain, not per hop.
- **Event age at consumption** as a histogram, per consumer.

**4. Is the data correct?**
- **Duplicate-detection rate**, **sequence-gap detection**, **reconciliation break counts**.
- **Business metrics** — payments authorised vs ledger entries posted per hour should match. A divergence is an integrity alarm that no technical metric would catch.

**Tracing:** propagate **W3C `traceparent` in message headers** and set the consumed message's span parent, so a trace spans producer → broker → consumer. Without this, traces stop at the broker — exactly where you need them. Use **span links** for fan-out so the trace tree stays sane.

**Logging:** every log line carries `correlationId`, `messageId`, `eventType`, `topic/partition/offset`, `consumerGroup`, and the aggregate ID.

**Dashboards and alerting posture:** alert on **symptoms with business meaning** (lag age > SLA, DLQ > 0, end-to-end latency p99 breach, reconciliation break), not on CPU. And run a periodic **synthetic event** end-to-end to prove the whole pipeline works when volume is low.

---

## Q22. EDA vs Event Sourcing?

**They are frequently confused and are genuinely different things.**

| | **Event-Driven Architecture** | **Event Sourcing** |
|---|---|---|
| Scope | **Integration between services** | **Persistence inside one service/aggregate** |
| Definition (source) | Azure: producers emit events; consumers react | Azure: *"use an append-only store to record the full series of events that describe actions taken on data"* |
| Source of truth | Each service's own database (current state) | **The event log itself** |
| Events are | Notifications of things that happened (often a *subset* of state) | The **complete, authoritative** history — state is derived by replaying them |
| Can you delete/lose events? | Yes, after consumers process them (retention) | **No** — losing events loses the data itself |
| Granularity | Coarse, integration-level ("PaymentAuthorized") | Fine, domain-level ("AmountChanged", "AddressCorrected") |
| Adoption | Common, incrementally adoptable | Rare, high commitment, hard to reverse |

**Key insight to state:** **you can have EDA without Event Sourcing** (the normal case — services store current state in tables and publish integration events via an outbox), and **you can have Event Sourcing without EDA** (a single service persists as events internally and exposes only a REST API). They compose well, but neither implies the other.

**Two different event vocabularies, which is where confusion starts:**
- **Domain events** (internal, fine-grained, event-sourced): `PaymentAmountCorrected`, `LimitRaised`.
- **Integration events** (external, coarse, published): `PaymentAuthorized` — a deliberately reduced, stable, public contract.

Publishing your internal domain events as integration events is a documented anti-pattern: it couples every consumer to your internal model and makes refactoring impossible. **Translate at the boundary.**

---

## Q23. Kafka vs traditional message queues?

**Per the Apache Kafka documentation:** Kafka is *"a distributed event streaming platform"* where *"events are organized and durably stored in topics"*, and *"unlike traditional messaging systems, Kafka doesn't delete messages after consumption — they are retained per a configurable retention period."* Consumers track their own **offset**.

| | **Kafka (log)** | **Traditional queue (RabbitMQ, SQS, Service Bus)** |
|---|---|---|
| Storage model | **Append-only, partitioned, durable log** | Queue; message **removed on ack** |
| After consumption | Message **remains** until retention expires | Message is **deleted** |
| **Replay** | ✅ Reset offset, re-read history | ❌ Gone |
| Multiple independent consumers | ✅ Each consumer group has its own offset | Requires fan-out to separate queues (SNS→SQS, exchange→queues) |
| Ordering | Guaranteed **per partition** | Per queue (RabbitMQ), per message group (SQS FIFO) |
| Throughput | Very high (sequential disk I/O, zero-copy, batching) | Lower, but ample for most workloads |
| Consumption model | **Pull** (natural backpressure) | Push (RabbitMQ) or pull (SQS) |
| Per-message operations | ❌ No per-message ack, no selective retry, no native DLQ, no priority | ✅ Per-message ack, DLQ, TTL, delay, priority, selective redelivery |
| Scaling unit | **Partitions** (consumers ≤ partitions) | Competing consumers, effectively unbounded |
| Operational weight | Higher (brokers, partitions, KRaft/ZooKeeper, rebalancing) | Lower (especially managed SQS) |

**How to choose — the decision I'd articulate:**
- **Kafka** when you need: replay/reprocessing, multiple independent consumers of the same stream, event history as an asset, stream processing (Kafka Streams/Flink), very high throughput, or per-key ordering at scale.
- **A queue** when you need: work distribution to competing consumers, per-message retry/DLQ/TTL/priority, simple task offloading, or minimal operational overhead. **SQS + SNS is the right default on AWS for most task-and-fan-out workloads** and is dramatically cheaper to run than MSK.

**Most mature platforms use both**: Kafka as the event backbone and event history; queues for task processing and per-message workflow semantics. Saying that — rather than picking a winner — is the correct architect answer.

---

## Q24. How would you design an event-driven payment system?

**Requirements framing first:** authorise a card payment synchronously (customer waiting, ~2 s budget), then perform ledger posting, fraud analysis, notification, regulatory reporting and settlement asynchronously. Non-functionals: no lost or double payments, full audit trail, PCI-DSS scope minimised, per-account ordering, end-to-end reconciliation.

**Architecture:**

```
                 ┌──────────────────────────────────────────────────────────────┐
Client ──HTTPS──▶│ API Gateway (authN, rate limit, WAF) ──▶ Payment API         │
                 └───────────────┬──────────────────────────────────────────────┘
                                 │ 1. validate + idempotency key
                                 │ 2. SYNCHRONOUS auth to the scheme (Visa/Mastercard)
                                 │ 3. ONE local tx: persist payment + outbox row
                                 ▼
                        ┌────────────────┐        ┌──────────────┐
                        │ Payments DB    │◀──CDC──│ Outbox relay │──▶ Kafka
                        │ payments+outbox│        └──────────────┘
                        └────────────────┘                 │
   ┌─────────────────────────────────────────────────────┬─┴───────────────┬──────────────────┐
   ▼                        ▼                            ▼                 ▼                  ▼
Ledger consumer      Fraud consumer            Notification consumer  Reporting consumer   Data lake
(double-entry,       (score, may emit          (email/SMS/push,       (regulatory, S3)     (analytics)
 idempotent)          FraudSuspected)           at-least-once safe)
```

**Key decisions and their justification:**

1. **Authorisation is synchronous; everything else is asynchronous.** The customer needs the yes/no now; the ledger, notifications and reporting do not need to be on that critical path. This alone cuts p99 dramatically and removes four failure modes from the customer's experience.
2. **Idempotency key mandatory on `POST /payments`** — the client retries safely; the server stores the response against the key (§14 Q14).
3. **Outbox, not a direct publish.** The payment row and the `PaymentAuthorized` event commit in one local transaction; a CDC relay (Debezium/DMS) publishes to Kafka. Eliminates the dual-write problem: no lost events, no phantom events (§4 Q23).
4. **Partition by `accountId`** so all events for one account are ordered on one partition — the ledger must apply them in order.
5. **Every consumer is idempotent** with an inbox table committed alongside its effect (Q11). At-least-once + idempotency = exactly-once effect.
6. **`acks=all`, `enable.idempotence=true`, `min.insync.replicas=2`, RF=3** on the producer/topic — durability first for money (§8 Q21–Q23).
7. **Retry topics + DLQ per consumer group**, alerted, with a replay tool.
8. **Event-carried state transfer** with a *reduced, stable* public schema — no PAN, no CVV, ever. Tokenised card reference only, which keeps consumers out of PCI scope. This is a compliance decision, not a design preference.
9. **Schema Registry with `FULL_TRANSITIVE`** compatibility, enforced in CI.
10. **Saga (orchestrated) for the multi-step flows** — refunds, chargebacks, failed settlement — with compensating transactions and a queryable saga state store.
11. **Reconciliation** against the scheme's nightly settlement file: classify breaks (auto-correct / investigate / manual), with a break dashboard. **This is the control that proves correctness**, and no fintech design is complete without it.
12. **Observability:** correlation ID from the API through every event; W3C trace context in Kafka headers; consumer lag, DLQ depth, end-to-end latency, and a business metric (authorisations vs ledger postings per hour) that must match.

---

## Q25. How do you guarantee reliable event publication?

**The problem, stated precisely:** you must atomically (a) change state in your database and (b) publish an event. These are two systems with no shared transaction — the **dual-write problem**. Both orderings fail (§4 Q23):

- Commit DB then publish → crash between them = **state changed, event lost** (silent data loss; downstream never learns).
- Publish then commit DB → commit fails = **event about a state that doesn't exist** (phantom event; downstream acts on a fiction).

**The documented solution: the Transactional Outbox pattern** (AWS Prescriptive Guidance; Azure/Microsoft integration-event guidance).

```sql
BEGIN TRANSACTION;
  UPDATE Payments SET Status = 'AUTHORIZED', AuthCode = @auth WHERE Id = @id;
  INSERT INTO Outbox (MessageId, AggregateId, Type, Payload, OccurredAt, ProcessedAt)
       VALUES (@messageId, @id, 'PaymentAuthorized', @json, SYSUTCDATETIME(), NULL);
COMMIT;                       -- ONE local ACID transaction: the state and the intent to publish
```

Then a **message relay** publishes:
- **Polling publisher** — a background worker selects unprocessed rows (`WHERE ProcessedAt IS NULL ORDER BY OccurredAt`, with `SKIP LOCKED`/`READPAST` for multiple instances), publishes, marks processed. Simple, no extra infrastructure, adds polling latency and DB load.
- **CDC (transaction-log tailing)** — Debezium / AWS DMS reads the database's write-ahead log and publishes. Lower latency, no polling load, no application code in the publish path; costs a connector to operate. **Preferred at scale.**

**The complete reliability chain — say all five links:**

| Link | Mechanism | Guarantee |
|---|---|---|
| State + intent | Outbox in one local transaction | Event can never be lost |
| Relay → broker | Retry until acknowledged | At-least-once publication |
| Broker durability | Kafka `acks=all`, RF≥3, `min.insync.replicas=2` (or SQS/SNS managed durability) | Event survives broker failure |
| Producer dedup | `enable.idempotence=true`, stable `MessageId` | Fewer duplicates |
| Consumer | **Inbox/dedup table committed with the effect** | Exactly-once **effect** |

**Plus the assurance layer:** monitor outbox depth and oldest-unprocessed age (a stalled relay is a silent outage), alert on it, and reconcile business counts end-to-end.

**The closing sentence:** *"I can't guarantee exactly-once delivery — nobody can. I guarantee that no event is ever lost, using an outbox committed with the state change, and that no event is ever applied twice, using an idempotent consumer — and I verify both with reconciliation."*

---

## References — official documentation

| Topic | Source |
|---|---|
| Event-driven architecture style (Azure Architecture Center) | https://learn.microsoft.com/azure/architecture/guide/architecture-styles/event-driven |
| What is an event-driven architecture? (AWS) | https://aws.amazon.com/event-driven-architecture/ |
| Asynchronous message-based communication (.NET microservices) | https://learn.microsoft.com/dotnet/architecture/microservices/architect-microservice-container-applications/asynchronous-message-based-communication |
| Integration events & eventual consistency (.NET microservices) | https://learn.microsoft.com/dotnet/architecture/microservices/multi-container-microservice-net-applications/integration-event-based-microservice-communications |
| Messages, events and commands (Azure messaging guidance) | https://learn.microsoft.com/azure/architecture/guide/technology-choices/messaging |
| Apache Kafka — Introduction & core concepts | https://kafka.apache.org/documentation/#intro |
| Kafka — message delivery semantics | https://kafka.apache.org/documentation/#semantics |
| Kafka — idempotent producer | https://kafka.apache.org/documentation/#producerconfigs_enable.idempotence |
| Amazon SQS — dead-letter queues & redrive | https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html |
| Amazon SQS FIFO queues (ordering & dedup) | https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues.html |
| Amazon EventBridge | https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html |
| Azure Service Bus dead-lettering | https://learn.microsoft.com/azure/service-bus-messaging/service-bus-dead-letter-queues |
| Queue-Based Load Levelling pattern | https://learn.microsoft.com/azure/architecture/patterns/queue-based-load-leveling |
| Retry pattern | https://learn.microsoft.com/azure/architecture/patterns/retry |
| Transactional outbox pattern (AWS) | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html |
| Event Sourcing pattern | https://learn.microsoft.com/azure/architecture/patterns/event-sourcing |
| Confluent Schema Registry — concepts & compatibility | https://docs.confluent.io/platform/current/schema-registry/index.html |
| Schema evolution and compatibility modes | https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html |
| AWS Glue Schema Registry | https://docs.aws.amazon.com/glue/latest/dg/schema-registry.html |
| W3C Trace Context (propagation through messaging) | https://www.w3.org/TR/trace-context/ |
| .NET `System.Threading.Channels` (backpressure) | https://learn.microsoft.com/dotnet/core/extensions/channels |

---

**Previous:** [06 — Design Patterns](./06-Design-Patterns.md) | **Next:** [08 — Apache Kafka](./08-Apache-Kafka.md)
