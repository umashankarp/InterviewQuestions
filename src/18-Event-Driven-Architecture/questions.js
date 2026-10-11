(function (r) {
registerTopic('18-event-driven-architecture', {
related: ['19-kafka', '37-outbox', '35-event-sourcing'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['fundamentals'],
  q: r`What is event-driven architecture, and what problems does it solve compared with request/response?`,
  a: r`In an event-driven architecture (EDA), components communicate by **publishing events** (facts that happened: {{OrderPlaced}}) to a broker; **consumers subscribe** and react independently. Producers do not know who consumes.

Problems it solves:

- **Temporal decoupling**: consumers can be down; events wait in the broker.
- **Fan-out without coupling**: new consumers (analytics, notifications, fraud) subscribe without changing the producer.
- **Load levelling**: bursts are absorbed by queues/logs; consumers process at their pace.
- **Responsiveness**: the producer finishes quickly; side effects happen asynchronously.
- **Auditability and replay** (with logs like Kafka): rebuild projections, onboard new consumers from history.

Costs: eventual consistency, harder end-to-end reasoning and debugging, duplicates and ordering concerns, schema evolution, operational overhead of brokers, and the risk of "event spaghetti" where flows are invisible.`,
  code: r`~~~csharp
// Producer publishes a fact; it does not know or care who listens
public sealed record OrderPlaced(Guid OrderId, Guid CustomerId, decimal Total, string Currency, DateTimeOffset PlacedAt);
db.Outbox.Add(OutboxMessage.From(new OrderPlaced(order.Id, order.CustomerId, order.Total, order.Currency, clock.GetUtcNow())));
await db.SaveChangesAsync(ct);
// Independent consumers, added without touching the producer
public sealed class AwardLoyaltyPoints : IConsumer<OrderPlaced> { public Task Consume(ConsumeContext<OrderPlaced> c) => Task.CompletedTask; }
public sealed class FraudScreening : IConsumer<OrderPlaced> { public Task Consume(ConsumeContext<OrderPlaced> c) => Task.CompletedTask; }
~~~`,
  dia: r`flowchart LR
  P[Orders service] -->|OrderPlaced| B[(Event broker)]
  B --> C1[Loyalty]
  B --> C2[Fraud]
  B --> C3[Notifications]
  B --> C4[Analytics]`,
  pts: [r`Producers publish facts; consumers subscribe independently.`, r`Temporal decoupling, fan-out and load levelling.`, r`Replay and audit with log-based brokers.`, r`Costs: eventual consistency, debugging, duplicates, ordering, schemas.`, r`Beware invisible "event spaghetti" flows.`],
  ex: r`A retailer added fraud screening and loyalty as new OrderPlaced subscribers without a single change to the orders service.`,
  fu: [r`When is request/response still better?`],
  pit: [r`Using events where the caller needs an immediate answer.`],
  tip: r`Name both the decoupling benefits and the consistency cost. Interviewers listen for balance.` },

{ id: 'q2', level: 'Basic', tags: ['event-types'],
  q: r`Explain event notification, event-carried state transfer, event sourcing and CQRS. How do they relate?`,
  a: r`Martin Fowler's four patterns often called "event-driven":

- **Event notification**: a thin event signals something changed ({{CustomerUpdated { id }}}); consumers call back for details. Low coupling on data, runtime dependency on the publisher's API.
- **Event-carried state transfer (ECST)**: events carry the data consumers need ({{CustomerUpdated { id, name, address, version }}}); consumers keep local copies. No callbacks; larger events; data duplication.
- **Event sourcing**: the service stores its state as a sequence of events; current state is derived by replay. A persistence pattern inside a service.
- **CQRS**: separate write and read models; often fed by events, but can exist without them.

They combine: an event-sourced service may publish integration events (ECST) that feed CQRS read models elsewhere. Keep **internal domain/event-sourcing events** separate from **public integration events**.`,
  code: r`~~~csharp
public sealed record CustomerChangedNotification(Guid CustomerId, DateTimeOffset At);                       // notification
public sealed record CustomerChanged(Guid CustomerId, string Name, Address Address, long Version, DateTimeOffset At);  // ECST
public sealed record AddressCorrected(Guid CustomerId, Address Old, Address New, string Reason);           // internal event-sourcing event
~~~`,
  pts: [r`Notification: thin events, consumers call back.`, r`ECST: events carry data; consumers keep copies.`, r`Event sourcing: events are the service's storage.`, r`CQRS: separate read and write models.`, r`Keep internal events separate from public integration events.`],
  ex: r`Switching from notifications to ECST removed 5,000 callback requests per minute to the customer service during peaks.`,
  fu: [r`When is notification preferable to ECST?`],
  pit: [r`Calling every event-driven system "event sourcing".`] },

{ id: 'q3', level: 'Basic', tags: ['broker-types'],
  q: r`Message queues vs event streams (logs): how do they differ, and which do you use for what?`,
  a: r`| | Queue (RabbitMQ, SQS, Service Bus queues) | Stream/log (Kafka, Kinesis, Event Hubs) |
|---|---|---|
| Consumption | Message removed after ack; competing consumers | Retained; each consumer group tracks its own offset |
| Replay | No | Yes, rewind offsets |
| Fan-out | Via topics/exchanges creating copies | Natural: many groups read the same log |
| Ordering | Per queue/session | Per partition |
| Per-message features | Delays, priorities, TTL, DLQ, per-message ack | Offsets, compaction, high throughput |
| Typical use | Commands, task distribution | Event streams, CDC, analytics, replay |

Choose queues for work distribution with rich per-message semantics; choose logs when many independent consumers need the full history, high throughput, ordering per key and replay. Many enterprises use Service Bus/RabbitMQ for commands and Kafka/Event Hubs for events.`,
  code: r`~~~csharp
// Queue: a command to one worker pool
await serviceBusSender.SendMessageAsync(new ServiceBusMessage(BinaryData.FromObjectAsJson(new GenerateInvoice(orderId))) { MessageId = cmdId }, ct);
// Log: an event for many consumer groups, keyed for per-order ordering
await kafkaProducer.ProduceAsync("orders.events.v1", new Message<string, string> { Key = orderId.ToString(), Value = json }, ct);
~~~`,
  pts: [r`Queues remove messages after acknowledgement; logs retain them.`, r`Logs give replay and natural fan-out via consumer groups.`, r`Queues give delays, priorities and per-message handling.`, r`Ordering is per queue/session or per partition.`, r`Commands on queues, events on logs is a common split.`],
  ex: r`A bank used Service Bus for statement-generation commands and Event Hubs (Kafka API) for payment events consumed by 9 systems.`,
  fu: [r`Can Kafka be used as a work queue?`],
  pit: [r`Expecting replay from a queue.`] },

{ id: 'q4', level: 'Basic', tags: ['event-design'],
  q: r`How do you design a good integration event?`,
  a: r`Guidelines:

- **Past-tense name** describing a business fact ({{PaymentCaptured}}, not {{UpdatePayment}}).
- **Envelope** with metadata: event id (unique, for dedupe), type, version, occurred-at time, producer, correlation and causation ids, tenant.
- **Payload** with stable identifiers and the data consumers need (ECST) but not internal implementation details or full entity dumps.
- **Explicit units** (amounts as decimal strings or minor units with currency; UTC timestamps; ISO codes).
- **Versioning** (schema version) and backward-compatible evolution.
- **No sensitive data unless required**; classify PII.
- **Partition key** chosen for ordering needs (entity id).
- Consider the CloudEvents standard for interoperability.`,
  code: r`~~~json
{
  "specversion": "1.0",
  "id": "evt_01J9Z6K3Q4M8",
  "source": "payments-service",
  "type": "com.example.payments.payment-captured.v2",
  "time": "2026-10-11T09:15:22.481Z",
  "subject": "payment/pay_981",
  "datacontenttype": "application/json",
  "correlationid": "ord_4411",
  "tenantid": "t-77",
  "data": { "paymentId": "pay_981", "orderId": "ord_4411", "amountMinor": 12999, "currency": "GBP", "method": "card", "capturedAt": "2026-10-11T09:15:22.401Z" }
}
~~~`,
  pts: [r`Past-tense business facts.`, r`Envelope: id, type, version, time, correlation, tenant.`, r`Payload with stable ids and needed data, no internals.`, r`Explicit units, UTC and ISO codes.`, r`Version, partition key, minimal PII; consider CloudEvents.`],
  ex: r`Adding correlation ids to every event cut the time to trace a failed checkout across 7 services from hours to minutes.`,
  fu: [r`What belongs in the envelope vs the payload?`],
  pit: [r`Publishing ORM entity serialisations as events.`] },

{ id: 'q5', level: 'Basic', tags: ['delivery-semantics'],
  q: r`What delivery guarantees do brokers provide, and what must consumers do?`,
  a: r`Most brokers provide **at-least-once** delivery by default: a message is redelivered until acknowledged, so duplicates happen (consumer crash after processing but before ack, network issues, rebalances).

**At-most-once** (ack before processing) risks loss; rarely acceptable for business events.

**Exactly-once** exists only within boundaries (Kafka transactions for read-process-write within Kafka; stream processors with checkpoints and transactional sinks).

Consumers must therefore be **idempotent**:

- Inbox table of processed event ids in the same transaction as the effects.
- Upserts keyed by entity and version.
- Natural idempotency (set state, not increment).

Also handle **out-of-order** events (versions) and **poison messages** (retries, DLQ).`,
  code: r`~~~csharp
public async Task Consume(ConsumeContext<PaymentCaptured> ctx)
{
    await using var tx = await db.Database.BeginTransactionAsync();
    if (!await db.TryInsertInboxAsync(ctx.MessageId!.Value)) return;              // duplicate delivery -> no effect
    var order = await db.Orders.FindAsync(ctx.Message.OrderId);
    order!.MarkPaid(ctx.Message.PaymentId);
    await db.SaveChangesAsync(); await tx.CommitAsync();                        // effects and inbox entry commit together
}
~~~`,
  pts: [r`At-least-once is the norm: duplicates happen.`, r`At-most-once risks loss.`, r`Exactly-once only within specific boundaries.`, r`Consumers must be idempotent (inbox, versioned upserts).`, r`Handle ordering and poison messages too.`],
  ex: r`A consumer rebalance in Kafka redelivered 4,000 events; the inbox table made it a non-event.`,
  fu: [r`Why do rebalances cause duplicates?`],
  pit: [r`Assuming the broker guarantees exactly-once processing.`] },

{ id: 'q6', level: 'Basic', tags: ['choreography', 'orchestration'],
  q: r`Choreography vs orchestration in event-driven workflows: how do you choose?`,
  a: r`- **Choreography**: each service reacts to events and emits new ones; no central coordinator. Pros: loose coupling, simple for short flows, services autonomous. Cons: the overall process is implicit and spread across services; hard to see status, handle timeouts and change the flow; risk of cyclic dependencies.
- **Orchestration**: a coordinator (saga orchestrator, workflow engine) tells services what to do via commands and tracks state. Pros: explicit flow, central visibility, timeouts and compensations in one place. Cons: the orchestrator is another component to build and operate; risk of a "god" orchestrator holding business rules.

Rule of thumb: choreography for simple reactions and broadcasting facts (notifications, analytics); orchestration for multi-step business processes with ordering, compensation and SLAs (checkout, onboarding, loan origination). Mixed approaches are common.`,
  code: r`~~~csharp
// Choreography: each service reacts on its own
public sealed class ReserveOnOrderPlaced(IInventory inv) : IConsumer<OrderPlaced>
{ public Task Consume(ConsumeContext<OrderPlaced> c) => inv.ReserveAsync(c.Message.OrderId, c.CancellationToken); }   // then publishes StockReserved

// Orchestration: one state machine drives the steps
Initially(When(OrderPlaced).Send(c => new ReserveStock(c.Saga.CorrelationId)).TransitionTo(Reserving));
During(Reserving, When(StockReserved).Send(c => new CapturePayment(c.Saga.CorrelationId)).TransitionTo(Paying));
~~~`,
  dia: r`flowchart TB
  subgraph Choreography
    O1[Orders] -->|OrderPlaced| I1[Inventory]
    I1 -->|StockReserved| P1[Payments]
    P1 -->|PaymentCaptured| O1
  end
  subgraph Orchestration
    OR[Checkout orchestrator] -->|ReserveStock| I2[Inventory]
    I2 -->|StockReserved| OR
    OR -->|CapturePayment| P2[Payments]
    P2 -->|PaymentCaptured| OR
  end`,
  pts: [r`Choreography: autonomous reactions, implicit flow.`, r`Orchestration: explicit flow, central visibility.`, r`Choreography for simple reactions and broadcasting.`, r`Orchestration for multi-step processes with compensation and SLAs.`, r`Keep business rules out of a god orchestrator.`],
  ex: r`A 9-step onboarding flow in choreography was impossible to debug; moving to an orchestrated workflow made stuck applications visible within a day.`,
  fu: [r`How do you visualise a choreographed flow?`],
  pit: [r`Choreographing a long process with timeouts and compensations.`] },

{ id: 'q7', level: 'Intermediate', tags: ['ordering', 'partitioning'],
  q: r`How do you preserve ordering of events per entity, and what happens on retries and rebalances?`,
  a: r`- **Partition by entity key** (order id, account id): Kafka guarantees order within a partition; Service Bus sessions and SQS FIFO message groups give per-group order.
- **Producer side**: idempotent producers ({{enable.idempotence=true}}) keep order with retries; outbox relays must publish in commit order per aggregate.
- **Consumer side**: process a partition sequentially (or parallelise by key within a partition, preserving per-key order); commit offsets after processing.
- **Rebalances**: partitions move between consumer instances; in-flight work may be redelivered; use cooperative rebalancing and idempotency.
- **Retries**: retrying a failed message in place blocks the partition (preserves order); sending it to a retry topic breaks order for that key unless subsequent messages for the same key are also parked.
- **Defence in depth**: event versions so consumers drop stale updates.`,
  code: r`~~~csharp
var config = new ProducerConfig { BootstrapServers = brokers, EnableIdempotence = true, Acks = Acks.All, MaxInFlight = 5 };
using var producer = new ProducerBuilder<string, string>(config).Build();
await producer.ProduceAsync("accounts.events", new Message<string, string> { Key = accountId, Value = json });   // same key -> same partition

var consumerConfig = new ConsumerConfig { GroupId = "balances-view", EnableAutoCommit = false,
    PartitionAssignmentStrategy = PartitionAssignmentStrategy.CooperativeSticky };
~~~`,
  pts: [r`Partition or group by entity key for per-entity order.`, r`Idempotent producers keep order across retries.`, r`Process partitions sequentially; commit after processing.`, r`Rebalances and retry topics can break order: plan for it.`, r`Versions in events as a safety net.`],
  ex: r`Balance projections went wrong when a retry topic reordered events for an account; parking subsequent events for that key fixed it.`,
  fu: [r`How do you parallelise within a partition safely?`],
  pit: [r`Random partition keys for entity events.`] },

{ id: 'q8', level: 'Intermediate', tags: ['schema-evolution'],
  q: r`How do you evolve event schemas without breaking consumers?`,
  a: r`- **Schema registry** (Confluent, Apicurio, Azure Schema Registry) with Avro/Protobuf/JSON Schema and compatibility modes: BACKWARD (new schema reads old data), FORWARD (old consumers read new data), FULL.
- **Safe changes**: add optional fields with defaults; add new event types.
- **Breaking changes**: removing/renaming fields, changing types or semantics. Handle with a **new event version/type** (or topic), dual publishing during migration, and deprecation of the old one.
- **Tolerant readers**: consumers ignore unknown fields and handle unknown enum values.
- **Upcasting** in consumers or projections: transform old event versions to the latest shape when reading (especially for event sourcing).
- **CI checks** against the registry before deploying producers.`,
  code: r`~~~json
{
  "type": "record", "name": "PaymentCaptured", "namespace": "com.example.payments",
  "fields": [
    { "name": "paymentId", "type": "string" },
    { "name": "amountMinor", "type": "long" },
    { "name": "currency", "type": "string" },
    { "name": "method", "type": ["null", "string"], "default": null }
  ]
}
~~~
~~~bash
# CI: fail if the new schema is not backward compatible with the latest registered version
curl -s -X POST -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  --data @payment-captured.avsc.json "$REGISTRY/compatibility/subjects/payments.payment-captured-value/versions/latest" | jq -e '.is_compatible'
~~~`,
  pts: [r`Use a schema registry with compatibility rules.`, r`Additive optional fields are safe.`, r`Breaking changes need new versions and dual publishing.`, r`Tolerant readers and upcasting.`, r`Check compatibility in CI.`],
  ex: r`A registry compatibility check blocked a producer deploy that changed amount from decimal to string, which would have broken 6 consumers.`,
  fu: [r`BACKWARD vs FORWARD compatibility: which do you choose?`],
  pit: [r`Changing field meaning without changing the name or version.`] },

{ id: 'q9', level: 'Intermediate', tags: ['outbox', 'cdc'],
  q: r`How do you publish events reliably from a service that also writes to a database?`,
  a: r`Avoid dual writes. Options:

- **Transactional outbox + polling relay**: insert the event in an outbox table in the same transaction; a background relay publishes and marks it sent. Simple; adds polling latency and DB load.
- **Outbox + CDC (Debezium)**: CDC reads committed outbox rows from the transaction log and publishes them, routing by aggregate type and key. Low latency, no polling.
- **CDC on business tables**: exposes internal schema as an event contract; usually avoid, or transform carefully.
- **Event sourcing**: the event store is the source of truth; publishing from it (subscriptions) is natural.

All yield at-least-once publication; downstream idempotency is required. Monitor relay lag and outbox size.`,
  code: r`~~~json
{
  "name": "orders-outbox",
  "config": {
    "connector.class": "io.debezium.connector.sqlserver.SqlServerConnector",
    "database.hostname": "sql.internal", "database.names": "Orders",
    "table.include.list": "dbo.Outbox",
    "transforms": "outbox",
    "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
    "transforms.outbox.table.field.event.key": "AggregateId",
    "transforms.outbox.route.by.field": "AggregateType",
    "transforms.outbox.route.topic.replacement": "$\{routedByValue}.events"
  }
}
~~~`,
  dia: r`flowchart LR
  SVC[Orders service] -->|one transaction| DB[(Orders + Outbox)]
  DB -->|transaction log| DBZ[Debezium outbox router]
  DBZ --> K[(Kafka: orders.events)]
  K --> C1[Consumers: idempotent]`,
  pts: [r`Never publish and write the database as separate steps.`, r`Outbox with a polling relay: simple, some latency.`, r`Outbox with CDC: low latency, no polling.`, r`Avoid exposing internal tables via CDC.`, r`At-least-once: consumers must dedupe; monitor relay lag.`],
  ex: r`Moving from a polling relay to Debezium cut event latency from 2 seconds to under 100 ms and removed polling load from the database.`,
  fu: [r`What happens to outbox ordering with multiple relay instances?`],
  pit: [r`Publishing inside the transaction before commit.`] },

{ id: 'q10', level: 'Intermediate', tags: ['dlq', 'retries'],
  q: r`How do you handle failures when consuming events: retries, retry topics, dead-letter queues?`,
  a: r`- **Classify** errors: transient (dependency down, timeout) vs permanent (bad data, schema mismatch, business rule).
- **In-place retries** with backoff for short transient errors.
- **Retry topics/queues with delays** (Kafka: {{orders.retry.1m}}, {{orders.retry.10m}}) for longer outages without blocking the main stream; note ordering implications.
- **Dead-letter queue/topic** for permanent failures or exhausted retries, storing the original message, error details and metadata.
- **Alerting** on DLQ arrivals and retry backlogs.
- **Replay tooling** to inspect, fix and republish DLQ messages with audit.
- **Circuit breaking** consumers when a dependency is down (pause consumption instead of burning retries).`,
  code: r`~~~csharp
// Kafka consumer with retry-topic routing (simplified)
try { await handler.HandleAsync(msg, ct); consumer.Commit(cr); }
catch (TransientException ex)
{
    var attempt = int.Parse(Header(cr, "x-attempt") ?? "0") + 1;
    var topic = attempt switch { 1 => "payments.retry.1m", 2 => "payments.retry.10m", 3 => "payments.retry.1h", _ => "payments.dlq" };
    await producer.ProduceAsync(topic, WithHeaders(cr.Message, ("x-attempt", attempt.ToString()), ("x-error", ex.Message)));
    consumer.Commit(cr);
}
catch (PermanentException ex)
{
    await producer.ProduceAsync("payments.dlq", WithHeaders(cr.Message, ("x-error", ex.Message), ("x-failed-at", DateTimeOffset.UtcNow.ToString("O"))));
    consumer.Commit(cr);
}
~~~`,
  dia: r`flowchart LR
  T[(payments)] --> C[Consumer]
  C -->|transient| R1[(retry.1m)] --> C
  C -->|still failing| R2[(retry.10m)] --> C
  C -->|exhausted / permanent| DLQ[(payments.dlq)]
  DLQ --> OPS[Alert + replay tool]`,
  pts: [r`Separate transient from permanent errors.`, r`In-place retries for brief glitches.`, r`Delayed retry topics for longer outages.`, r`DLQ with full context, alerts and replay tooling.`, r`Pause consumption when dependencies are down.`],
  ex: r`A downstream outage sent 30,000 events through retry topics; all were processed automatically once the dependency recovered, with zero manual replays.`,
  fu: [r`How do retry topics affect per-key ordering?`],
  pit: [r`Silently dropping messages that fail.`] },

{ id: 'q11', level: 'Intermediate', tags: ['eventual-consistency', 'ux'],
  q: r`How do you deal with eventual consistency in the user experience?`,
  a: r`- **Return the result of the command** directly (the created/updated resource) so the UI shows the user's change immediately.
- **Optimistic UI**: render the expected state and reconcile when confirmation arrives (or roll back on failure).
- **Explicit pending states**: "Payment processing", "Order received, confirmation shortly".
- **Push updates**: WebSockets/SignalR/SSE notify the UI when downstream processing completes.
- **Read-your-writes** routing: read from the write model or primary for the user's own recent changes.
- **Show freshness**: "updated 10 seconds ago" for dashboards.
- **Design the business process** for asynchrony: emails confirm later, receipts follow.

Explain to product owners that eventual consistency is usually seconds, and agree which screens need stronger guarantees.`,
  code: r`~~~csharp
// Server pushes completion to the browser when the saga finishes
public sealed class OrderConfirmedNotifier(IHubContext<OrdersHub> hub) : IConsumer<OrderConfirmed>
{
    public Task Consume(ConsumeContext<OrderConfirmed> c) =>
        hub.Clients.User(c.Message.CustomerId.ToString()).SendAsync("orderConfirmed", c.Message.OrderId);
}
~~~
~~~typescript
// Angular: show pending immediately, update on push
this.orders.update(list => [{ id, status: 'PENDING' }, ...list]);
this.hub.on('orderConfirmed', (orderId: string) => this.orders.update(list => list.map(o => o.id === orderId ? { ...o, status: 'CONFIRMED' } : o)));
~~~`,
  pts: [r`Return the command result so the UI shows the change.`, r`Optimistic UI with reconciliation.`, r`Explicit pending states in the product.`, r`Push completion via WebSockets or SSE.`, r`Read-your-writes routing and freshness indicators.`],
  ex: r`Adding a "processing" state and a SignalR push removed most "my order disappeared" support tickets after moving to async processing.`,
  fu: [r`When is eventual consistency unacceptable in UX?`],
  pit: [r`Redirecting to a page that reads a not-yet-updated read model.`] },

{ id: 'q12', level: 'Intermediate', tags: ['event-storming'],
  q: r`What is event storming, and how does it help design event-driven systems?`,
  a: r`**Event storming** (Alberto Brandolini) is a collaborative workshop where domain experts and engineers map a business process using sticky notes:

- **Domain events** (orange): things that happened, past tense, along a timeline.
- **Commands** (blue): what triggers events.
- **Actors/users** (yellow), **policies** (lilac: "whenever X happens, do Y"), **external systems** (pink), **read models** (green), **aggregates** (yellow, large), **hotspots** (red: questions, conflicts).

Outcomes:

- Shared understanding of the process and language.
- Candidate **bounded contexts** (where language and ownership change) and **aggregates** (consistency boundaries).
- The **events** and **policies** that become integration events and event handlers/sagas.
- Hotspots to resolve before building.

It is fast, inclusive and surfaces business rules engineers would otherwise guess.`,
  code: r`~~~text
Timeline (excerpt, checkout)
[Customer] -> (Place order) -> [Order] -> OrderPlaced
Policy: whenever OrderPlaced -> (Reserve stock) -> [Inventory] -> StockReserved | StockUnavailable
Policy: whenever StockReserved -> (Authorise payment) -> [Payment] -> PaymentAuthorised | PaymentDeclined
Hotspot: what if payment is declined after stock reserved? -> compensation: release stock within 15 min
Bounded contexts emerging: Ordering | Inventory | Payments | Fulfilment
~~~`,
  pts: [r`A collaborative workshop mapping events on a timeline.`, r`Commands, actors, policies, external systems, read models, aggregates.`, r`Reveals bounded contexts and aggregates.`, r`Policies become handlers and sagas.`, r`Hotspots surface unresolved business rules.`],
  ex: r`A two-day event storming session found that "order" meant three different things, leading to three bounded contexts and far fewer integration bugs.`,
  fu: [r`Big picture vs design-level event storming?`],
  pit: [r`Running it with engineers only, without domain experts.`] },

{ id: 'q13', level: 'Intermediate', tags: ['idempotency', 'dedupe'],
  q: r`Design deduplication for event consumers at high volume.`,
  a: r`Approaches:

- **Inbox table** with a unique key on event id, inserted in the same transaction as effects. Retention by time (keep ids longer than any redelivery/replay window), partitioned or TTL-based cleanup.
- **Natural idempotency**: upsert by entity id with version checks (apply only if newer). No extra storage; works when events carry full state.
- **Deterministic effect ids**: derive ids of created records from the event id (unique constraint rejects duplicates).
- **Bloom-filter pre-check** for very high volumes, followed by the exact check on "maybe".
- **Per-partition watermarks**: if event ids are ordered per partition (offsets), track the last processed offset per partition in the same transaction as effects (Kafka transactional patterns).

Choose based on whether effects are in a transactional store and on volume.`,
  code: r`~~~sql
-- Inbox with time-based retention (PostgreSQL partitioned by day; drop old partitions)
CREATE TABLE inbox (event_id uuid NOT NULL, consumer text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id, received_at)) PARTITION BY RANGE (received_at);
-- Versioned upsert: naturally idempotent and order-safe
INSERT INTO account_view (account_id, balance, version) VALUES ($1, $2, $3)
ON CONFLICT (account_id) DO UPDATE SET balance = EXCLUDED.balance, version = EXCLUDED.version
WHERE account_view.version < EXCLUDED.version;
~~~`,
  pts: [r`Inbox table with unique ids in the same transaction.`, r`Versioned upserts are naturally idempotent.`, r`Deterministic ids for created records.`, r`Bloom filters for huge volumes, exact check on maybe.`, r`Offset tracking in the same transaction as effects.`],
  ex: r`Switching a projection from an inbox table to versioned upserts removed 2 billion inbox rows a month with the same correctness.`,
  fu: [r`How long must inbox records be kept?`],
  pit: [r`Dedupe checks in a separate transaction from effects.`] },

{ id: 'q14', level: 'Intermediate', tags: ['observability'],
  q: r`How do you observe and debug event-driven flows?`,
  a: r`- **Trace context propagation** through messages (W3C traceparent in headers), with producer and consumer spans linked; tools show the full flow across services and brokers.
- **Correlation and causation ids** in event envelopes, logged everywhere.
- **Metrics**: publish rate, consumer lag (Kafka), queue depth and age of oldest message (queues), processing latency (event time to processed), error and retry rates, DLQ size.
- **Flow visualisation**: event catalogue (AsyncAPI, EventCatalog) showing producers and consumers; service maps from traces.
- **Business-level monitors**: "orders placed but not confirmed within 5 minutes" (saga stuck detection).
- **Event replay** in non-production to reproduce issues.`,
  code: r`~~~promql
# Kafka consumer lag per group (via kafka-exporter / Burrow)
sum by (consumergroup, topic) (kafka_consumergroup_lag) > 10000
# End-to-end latency: event time to processed (custom histogram recorded by consumers)
histogram_quantile(0.99, sum by (le, consumer) (rate(event_processing_delay_seconds_bucket[5m])))
# Stuck business flow: orders pending confirmation for over 5 minutes (custom gauge)
max(orders_pending_confirmation_oldest_age_seconds) > 300
~~~`,
  pts: [r`Propagate trace context in message headers.`, r`Correlation and causation ids in envelopes.`, r`Lag, queue age, processing delay, retries, DLQ size.`, r`Event catalogue and service maps for visibility.`, r`Business monitors for stuck flows.`],
  ex: r`An "oldest unconfirmed order" alert caught a stalled consumer group 20 minutes before customers noticed.`,
  fu: [r`What is the difference between correlation and causation ids?`],
  pit: [r`Monitoring broker health but not consumer lag.`] },

{ id: 'q15', level: 'Intermediate', tags: ['asyncapi', 'catalogue'],
  q: r`How do you document and govern events across an organisation?`,
  a: r`- **AsyncAPI** specifications per service describing channels, messages, schemas and bindings (Kafka, AMQP).
- **Schema registry** as the source of truth for payload schemas with compatibility rules.
- **Event catalogue** (EventCatalog, Backstage plugins) listing events, owners, producers, consumers, versions, examples and business meaning.
- **Ownership**: each event type has one owning team.
- **Naming conventions**: {{<domain>.<entity>.<event>.v<n>}} for topics/types.
- **Lifecycle**: proposal/review for new public events, deprecation process with consumer notification and telemetry.
- **Data classification** of fields (PII) recorded in the catalogue.`,
  code: r`~~~yaml
asyncapi: 3.0.0
info: { title: Payments events, version: 2.1.0, contact: { name: team-payments } }
channels:
  paymentCaptured:
    address: payments.payment-captured.v2
    messages:
      PaymentCaptured:
        contentType: application/json
        payload: { $ref: './schemas/payment-captured-v2.json' }
        examples: [ { payload: { paymentId: pay_981, orderId: ord_4411, amountMinor: 12999, currency: GBP } } ]
operations:
  publishPaymentCaptured: { action: send, channel: { $ref: '#/channels/paymentCaptured' } }
~~~`,
  pts: [r`AsyncAPI specs per service.`, r`Schema registry as source of truth.`, r`Event catalogue with owners, producers and consumers.`, r`Naming conventions and lifecycle processes.`, r`Record PII classification per field.`],
  ex: r`An event catalogue revealed 40 consumers of a topic believed to have 3, which changed a planned breaking change into a versioned migration.`,
  fu: [r`How do you discover undocumented consumers?`],
  pit: [r`Events with no owner and unknown consumers.`] },

{ id: 'q16', level: 'Intermediate', tags: ['security'],
  q: r`How do you secure an event-driven system?`,
  a: r`- **Authentication** of producers and consumers to the broker (mTLS, SASL/OAuth, managed identities).
- **Authorisation (ACLs)** per topic/queue: who may produce and who may consume; least privilege.
- **Encryption in transit** (TLS) and at rest (broker storage encryption with managed keys).
- **Payload protection**: avoid PII in events; when necessary, field-level encryption or tokenisation; consumers decrypt only if authorised.
- **Message integrity**: signatures for events crossing trust boundaries (partners, webhooks).
- **Tenant isolation**: per-tenant topics or tenant ids enforced by consumers.
- **Audit**: broker access logs; who produced what.
- **Retention and erasure**: retention policies aligned with data protection; crypto-shredding for logs that cannot be modified.`,
  code: r`~~~bash
# Kafka ACLs: payments may produce to its topic; only ledger and analytics may consume
kafka-acls --bootstrap-server $BROKERS --command-config admin.properties --add \
  --allow-principal User:payments-svc --operation Write --topic payments.payment-captured.v2
kafka-acls --bootstrap-server $BROKERS --command-config admin.properties --add \
  --allow-principal User:ledger-svc --allow-principal User:analytics-svc --operation Read \
  --topic payments.payment-captured.v2 --group ledger --group analytics
~~~`,
  pts: [r`Authenticate producers and consumers to the broker.`, r`Least-privilege ACLs per topic and group.`, r`TLS in transit, encryption at rest.`, r`Minimise PII; encrypt or tokenise sensitive fields.`, r`Signatures across trust boundaries; audit and retention.`],
  ex: r`Topic ACLs prevented a compromised analytics credential from producing fake payment events.`,
  fu: [r`How do you handle GDPR erasure in an immutable log?`],
  pit: [r`One shared broker credential for all services.`] },

{ id: 'q17', level: 'Intermediate', tags: ['testing'],
  q: r`How do you test event-driven services?`,
  a: r`- **Unit tests** for handlers (given event, expect state changes and emitted events).
- **Component tests** with a real broker in a container (Testcontainers Kafka/RabbitMQ) or an in-memory harness (MassTransit test harness).
- **Contract tests** for events: schema compatibility checks and consumer-driven contracts (Pact supports message contracts).
- **Idempotency and ordering tests**: deliver duplicates and out-of-order events; assert final state.
- **Saga tests**: simulate each failure branch and timeouts with fake clocks.
- **End-to-end smoke tests** for critical flows in staging; synthetic events in production for monitoring.
- **Replay tests**: replay a day of production events (anonymised) into a new projection version and compare.`,
  code: r`~~~csharp
[Fact]
public async Task Duplicate_and_out_of_order_events_converge()
{
    var view = new AccountViewProjector(new InMemoryAccountViews());
    var e1 = new AccountUpdated(Acc, Balance: 100, Version: 1);
    var e2 = new AccountUpdated(Acc, Balance: 80, Version: 2);
    await view.HandleAsync(e2); await view.HandleAsync(e1); await view.HandleAsync(e2);   // out of order + duplicate
    (await view.GetAsync(Acc)).Should().BeEquivalentTo(new { Balance = 80m, Version = 2 });
}
~~~`,
  pts: [r`Unit-test handlers with given/expect.`, r`Component tests with real brokers or harnesses.`, r`Schema and message contract tests.`, r`Explicit duplicate, ordering and failure-branch tests.`, r`Replay production-like streams into new versions.`],
  ex: r`An out-of-order test exposed a projection bug that only appeared after Kafka rebalances in production.`,
  fu: [r`How do you test timeouts in sagas?`],
  pit: [r`Testing only the happy path with perfectly ordered single deliveries.`] },

{ id: 'q18', level: 'Intermediate', tags: ['webhooks'],
  q: r`How do you publish events to external partners via webhooks reliably and securely?`,
  a: r`- **Outbox -> dispatcher**: events for partners are stored and delivered by a dispatcher service, never from the request path.
- **At-least-once delivery** with retries and exponential backoff over hours/days; per-endpoint queues so one slow partner does not block others.
- **Signatures**: HMAC over timestamp + body with a per-partner secret; include a timestamp to prevent replay; support secret rotation (two active secrets).
- **Idempotency**: unique event ids so partners dedupe.
- **Ordering**: not guaranteed by HTTP; include sequence numbers/versions or recommend fetching the latest state.
- **Endpoint health**: disable endpoints after repeated failures and notify the partner; provide a replay UI/API.
- **Security**: HTTPS only, SSRF protection (validate URLs, block private IP ranges), payload minimisation.`,
  code: r`~~~csharp
static string Sign(byte[] secret, string timestamp, string body) =>
    Convert.ToHexString(HMACSHA256.HashData(secret, Encoding.UTF8.GetBytes(timestamp + "." + body))).ToLowerInvariant();

var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
var req = new HttpRequestMessage(HttpMethod.Post, endpoint.Url) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
req.Headers.Add("Webhook-Id", evt.Id);
req.Headers.Add("Webhook-Timestamp", ts);
req.Headers.Add("Webhook-Signature", "v1," + Sign(endpoint.CurrentSecret, ts, body));
// Receivers: verify signature with constant-time comparison, reject timestamps older than 5 minutes, dedupe on Webhook-Id
~~~`,
  pts: [r`Dispatch from an outbox, not the request path.`, r`Per-endpoint queues with long backoff retries.`, r`HMAC signatures with timestamps and secret rotation.`, r`Event ids for dedupe; no ordering guarantees over HTTP.`, r`Disable failing endpoints, offer replay, prevent SSRF.`],
  ex: r`Per-partner delivery queues stopped one partner's 30-second timeouts from delaying webhooks to 400 others.`,
  fu: [r`How do partners verify signatures safely?`],
  pit: [r`Calling partner webhooks synchronously during checkout.`] },

{ id: 'q19', level: 'Senior', tags: ['event-sourcing'],
  q: r`When does event sourcing pay off, and what are its hardest problems?`,
  a: r`Event sourcing stores every state change as an immutable event; current state is a fold over events.

Pays off when:

- **History is the domain**: ledgers, trading, order lifecycles, insurance claims, audit-heavy workflows.
- You need **temporal queries** ("state as of last month") and full audit.
- Multiple **projections** must be built and rebuilt from the same facts.
- Debugging by replaying exactly what happened.

Hardest problems:

- **Event schema evolution** forever (upcasting, versioning).
- **Projections**: rebuild time, eventual consistency, idempotency.
- **Large streams**: snapshots needed.
- **GDPR erasure** in immutable logs (crypto-shredding, separate PII stores).
- **Querying** current state requires projections.
- **Team learning curve** and tooling.

Use it selectively for the parts of the domain where it fits; do not make the entire system event-sourced by default.`,
  code: r`~~~csharp
// Marten (PostgreSQL) event sourcing in .NET
await using var session = store.LightweightSession();
session.Events.Append(accountId, new FundsDeposited(accountId, 100m), new FundsWithdrawn(accountId, 30m));
await session.SaveChangesAsync();
var account = await session.Events.AggregateStreamAsync<Account>(accountId);                         // current state
var asOf = await session.Events.AggregateStreamAsync<Account>(accountId, timestamp: new DateTimeOffset(2026, 9, 30, 23, 59, 59, TimeSpan.Zero));  // temporal query
~~~`,
  pts: [r`Use where history is the domain or audit is essential.`, r`Temporal queries and rebuildable projections are key benefits.`, r`Schema evolution and projections are ongoing costs.`, r`Snapshots for long streams; crypto-shredding for erasure.`, r`Apply selectively, not system-wide.`],
  ex: r`A claims platform used event sourcing for the claim lifecycle and plain CRUD for reference data, keeping complexity where it paid off.`,
  fu: [r`How do you rebuild a projection without downtime?`],
  pit: [r`Event-sourcing CRUD admin screens.`] },

{ id: 'q20', level: 'Senior', tags: ['cqrs', 'projections'],
  q: r`How do you build and operate CQRS read models (projections) fed by events?`,
  a: r`Design:

- One projection per query need (order summary list, customer 360, dashboards) in the store best suited (SQL, Elasticsearch/OpenSearch, Redis, MongoDB).
- Projections are **idempotent** and **order-tolerant** (versions per entity).
- Track **checkpoints** (last processed position) in the same transaction as projection writes when possible.

Operations:

- **Rebuild** by replaying events from the log/event store into a new projection version (blue/green projections), then switch reads.
- **Lag monitoring**: projection position vs head; expose freshness to clients.
- **Schema changes** in projections handled by rebuilds rather than in-place migrations.
- **Failure handling**: poison events to DLQ without stopping all projections.
- **Backfill** for new projections from history (Kafka retention or event store).`,
  code: r`~~~csharp
public sealed class OrderSummaryProjection(ReadDb db) : IConsumer<OrderPlaced>, IConsumer<OrderShipped>
{
    public async Task Consume(ConsumeContext<OrderPlaced> c)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO order_summaries (order_id, customer_id, total, status, version) VALUES ({c.Message.OrderId}, {c.Message.CustomerId}, {c.Message.Total}, 'PLACED', {c.Message.Version})
            ON CONFLICT (order_id) DO UPDATE SET total = EXCLUDED.total, status = EXCLUDED.status, version = EXCLUDED.version
            WHERE order_summaries.version < EXCLUDED.version
            """);
    }
    public async Task Consume(ConsumeContext<OrderShipped> c) =>
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE order_summaries SET status = 'SHIPPED', version = {c.Message.Version} WHERE order_id = {c.Message.OrderId} AND version < {c.Message.Version}");
}
~~~`,
  dia: r`flowchart LR
  ES[(Event log / store)] --> P1[Projection v1: SQL order list]
  ES --> P2[Projection: OpenSearch search]
  ES --> P3[Projection v2: rebuilding]
  P1 --> Q[Query API]
  P2 --> Q
  P3 -. switch when caught up .-> Q`,
  pts: [r`One projection per query need, in the best-fit store.`, r`Idempotent, version-checked updates.`, r`Checkpoints with projection writes.`, r`Rebuild via replay into a new version, then switch.`, r`Monitor lag and expose freshness.`],
  ex: r`A blue/green projection rebuild let a team change an order search index schema with zero downtime.`,
  fu: [r`How long can a rebuild take, and how do you speed it up?`],
  pit: [r`Migrating projection schemas in place instead of rebuilding.`] },

{ id: 'q21', level: 'Senior', tags: ['sagas', 'timeouts'],
  q: r`How do you handle timeouts and stuck processes in event-driven workflows?`,
  a: r`Events may never arrive (consumer bug, lost message, external system silent). Every waiting state needs a **timeout**:

- **Scheduled messages / timers**: when entering a waiting state, schedule a timeout event (MassTransit Schedule, Service Bus scheduled messages, workflow engine timers).
- **On timeout**: query the source of truth (the PSP for payment status), retry the command, compensate, or escalate to humans.
- **Stuck detection**: monitors on process age per state (oldest saga in AwaitingPayment).
- **Unknown outcomes**: model them explicitly (state UNKNOWN), resolve via status queries and reconciliation; never assume failure.
- **Operational tooling**: view, retry, cancel or force-complete stuck instances with audit.`,
  code: r`~~~csharp
Schedule(() => PaymentTimeout, s => s.PaymentTimeoutToken, cfg => cfg.Delay = TimeSpan.FromMinutes(10));
During(AwaitingPayment,
    When(PaymentCaptured).Unschedule(PaymentTimeout).TransitionTo(Confirmed),
    When(PaymentTimeout.Received)
        .Send(c => new QueryPaymentStatus(c.Saga.CorrelationId))          // ask the source of truth
        .TransitionTo(VerifyingPayment));
During(VerifyingPayment,
    When(PaymentStatusReported, c => c.Message.Status == "CAPTURED").TransitionTo(Confirmed),
    When(PaymentStatusReported, c => c.Message.Status == "NOT_FOUND").Send(c => new ReleaseStock(c.Saga.CorrelationId)).Finalize());
~~~`,
  pts: [r`Every waiting state needs a timeout.`, r`On timeout, query the source of truth before acting.`, r`Model unknown outcomes explicitly.`, r`Monitor process age per state.`, r`Operator tooling for stuck instances with audit.`],
  ex: r`Payment-timeout handling with status queries resolved 99.9% of silent PSP callbacks automatically.`,
  fu: [r`How do you avoid timeouts firing after completion?`],
  pit: [r`Waiting states with no timeout.`] },

{ id: 'q22', level: 'Senior', tags: ['kafka-vs-rabbitmq', 'decision'],
  q: r`Kafka, RabbitMQ, Azure Service Bus or AWS SQS/SNS/EventBridge: how do you choose for an event-driven platform?`,
  a: r`| Need | Good fit |
|---|---|
| High-throughput event streams, replay, many consumers, stream processing, CDC | Kafka (MSK, Confluent, Event Hubs Kafka API) |
| Rich routing, per-message ack, priorities, complex topologies, on-prem | RabbitMQ (quorum queues, streams) |
| Enterprise messaging on Azure: sessions, transactions, scheduled messages, DLQ | Azure Service Bus |
| Serverless AWS integration, simple queues and fan-out | SQS + SNS |
| Event routing by content between AWS services/SaaS, schemas, archive/replay | Amazon EventBridge / Azure Event Grid |

Decision factors: throughput and retention needs, replay, ordering, routing complexity, operational model (managed vs self-hosted), cloud alignment, team skills, cost model, compliance (data residency).

Many organisations standardise on two: a log (Kafka) for event streaming and a queue service for commands/tasks.`,
  code: r`~~~text
Platform decision (excerpt)
Payments, orders, ledger events (replay, 9 consumers, 20 K msg/s peak) -> Event Hubs (Kafka API), 7-day retention + capture to lake
Commands to workers (invoices, statements; delays, sessions, DLQ)       -> Azure Service Bus Premium
Cross-SaaS triggers (CRM, ticketing)                                     -> Event Grid
Not chosen: self-hosted RabbitMQ (ops cost), self-hosted Kafka (ops cost; managed preferred)
~~~`,
  pts: [r`Kafka for streams, replay and many consumers.`, r`RabbitMQ and Service Bus for rich messaging and commands.`, r`SQS/SNS and EventBridge/Event Grid for cloud-native routing.`, r`Decide on throughput, replay, ordering, routing, ops and cost.`, r`Standardising on a log plus a queue is common.`],
  ex: r`A bank consolidated five messaging technologies to Event Hubs and Service Bus, halving operational toil.`,
  fu: [r`What does EventBridge offer that SNS does not?`],
  pit: [r`Choosing a broker by popularity without requirements.`] },

{ id: 'q23', level: 'Senior', tags: ['stream-processing'],
  q: r`When do you need stream processing (Kafka Streams, Flink, Azure Stream Analytics), and what problems does it solve?`,
  a: r`Use stream processing when you need **continuous computation over event streams** with state:

- Real-time aggregations (payments per merchant per minute), windowed metrics.
- Joins between streams (payments with fraud signals) or stream-table joins (enrich with reference data).
- Pattern detection (velocity rules, sequences).
- Continuous ETL into analytics stores.
- Materialising views from streams.

Problems solved by the frameworks: partitioned state with fault tolerance (checkpoints, changelogs), event-time windows with watermarks and late data handling, exactly-once processing within the pipeline, scaling by partitions, backpressure.

Simple consumer services suffice for per-event reactions; reach for stream processors when you need windows, joins or large keyed state.`,
  code: r`~~~sql
-- Azure Stream Analytics: card velocity (more than 5 transactions per card in 10 minutes, sliding)
SELECT CardToken, COUNT(*) AS Txns, System.Timestamp() AS WindowEnd
INTO [velocity-alerts]
FROM [card-transactions] TIMESTAMP BY EventTime
GROUP BY CardToken, SlidingWindow(minute, 10)
HAVING COUNT(*) > 5
~~~`,
  pts: [r`Continuous computation with state over streams.`, r`Windows, joins, pattern detection and continuous ETL.`, r`Frameworks give fault-tolerant state and event-time semantics.`, r`Exactly-once within the pipeline.`, r`Plain consumers suffice for per-event reactions.`],
  ex: r`A card issuer moved velocity rules from database polling to a streaming job, cutting detection time from 5 minutes to 2 seconds.`,
  fu: [r`How do watermarks handle late events?`],
  pit: [r`Building windowing and state recovery by hand in consumers.`] },

{ id: 'q24', level: 'Senior', tags: ['backpressure', 'scaling'],
  q: r`How do you scale consumers and handle backlogs in event-driven systems?`,
  a: r`- **Scale out consumers** up to the number of partitions (Kafka) or with competing consumers (queues); autoscale on lag/queue length (KEDA).
- **Increase partitions** proactively (Kafka repartitioning changes key distribution; plan ahead).
- **Batch processing** in consumers (bulk database writes) to raise throughput.
- **Parallelism within a partition by key** when order is per key, not per partition.
- **Prioritise**: separate topics/queues for urgent vs bulk work.
- **Backpressure**: let lag grow rather than overloading downstream databases; set rate limits on consumers.
- **Drop or compact stale work**: deadlines on messages; compacted topics for latest-state-only data.
- **Capacity planning**: consumer throughput tests; alert on lag growth rate, not just absolute lag.`,
  code: r`~~~yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: ledger-projector }
spec:
  scaleTargetRef: { name: ledger-projector }
  minReplicaCount: 2
  maxReplicaCount: 24                      # = partition count of the topic
  triggers:
    - type: kafka
      metadata: { bootstrapServers: kafka:9092, consumerGroup: ledger-projector, topic: payments.events, lagThreshold: "5000" }
~~~`,
  pts: [r`Scale consumers up to partitions; autoscale on lag.`, r`Plan partition counts ahead.`, r`Batch writes and parallelise by key.`, r`Separate urgent from bulk streams.`, r`Let lag absorb overload; drop stale work; alert on lag growth.`],
  ex: r`KEDA scaling on lag plus 500-row batch inserts cleared a 12-million-event backlog in 40 minutes after an outage.`,
  fu: [r`Why can adding partitions break ordering?`],
  pit: [r`Scaling consumers beyond partition count expecting more throughput.`] },

{ id: 'q25', level: 'Senior', tags: ['data-governance', 'gdpr'],
  q: r`How do you handle personal data and GDPR erasure in event logs and event-sourced systems?`,
  a: r`Immutable logs conflict with the right to erasure. Strategies:

- **Minimise PII in events**: use ids; consumers fetch personal details from the owning service when needed.
- **Separate PII store**: events reference a subject id; personal data lives in a mutable store that can be erased.
- **Crypto-shredding**: encrypt PII fields with a per-subject key; deleting the key renders all copies unreadable (logs, backups, projections).
- **Retention limits**: topic retention aligned with legal needs; compacted topics with tombstones for latest-state data.
- **Erasure events** ({{CustomerErased}}) so every projection and consumer deletes or anonymises its copies, with a completion tracker.
- **Data catalogue** listing where PII flows.`,
  code: r`~~~csharp
// Crypto-shredding: PII encrypted per subject; erasure deletes the key
public sealed record CustomerRegistered(Guid CustomerId, string EncryptedName, string EncryptedEmail, string KeyId);
public async Task<CustomerRegistered> BuildEventAsync(Customer c, CancellationToken ct)
{
    var key = await keys.GetOrCreateSubjectKeyAsync(c.Id, ct);
    return new CustomerRegistered(c.Id, Encrypt(key, c.Name), Encrypt(key, c.Email), key.Id);
}
public async Task EraseAsync(Guid customerId, CancellationToken ct)
{
    await keys.DestroySubjectKeyAsync(customerId, ct);                            // all historical events become unreadable
    await publisher.Publish(new CustomerErased(customerId, DateTimeOffset.UtcNow), ct);   // projections delete their copies
}
~~~`,
  pts: [r`Keep PII out of events where possible.`, r`Reference a separate, erasable PII store.`, r`Crypto-shred per-subject keys for immutable copies.`, r`Retention and compaction with tombstones.`, r`Erasure events with completion tracking.`],
  ex: r`Crypto-shredding let a bank honour erasure requests across seven years of event history without rewriting logs.`,
  fu: [r`How do you prove erasure completed everywhere?`],
  pit: [r`Full customer profiles in every event.`] },

{ id: 'q26', level: 'Senior', tags: ['anti-patterns'],
  q: r`What are common event-driven architecture anti-patterns?`,
  a: r`- **Event spaghetti / pinball**: long, invisible chains of events triggering events; nobody understands the flow. Fix: orchestration for processes, catalogue and tracing.
- **Commands disguised as events** ({{SendEmailRequested}} published to a specific consumer): couples publisher to consumer behaviour.
- **Entity CRUD events** ({{CustomerTableRowUpdated}}) exposing internal schema.
- **Fat events with everything** including PII; or **anaemic events** forcing callbacks for every use.
- **Dual writes** without outbox.
- **Non-idempotent consumers**.
- **Synchronous expectations**: waiting for an event in the same request to return a response.
- **Ignoring ordering/versioning** in projections.
- **No DLQ / silent drops**.
- **Shared topics owned by nobody**, no schema governance.
- **Using events for queries** (request/reply over topics) where a direct API is simpler.`,
  code: r`~~~csharp
// Anti-pattern: waiting for an asynchronous event inside an HTTP request
app.MapPost("/orders", async (PlaceOrder cmd, IBus bus, IEventWaiter waiter) =>
{
    await bus.Publish(new OrderRequested(cmd));
    var confirmed = await waiter.WaitForAsync<OrderConfirmed>(e => e.RequestId == cmd.RequestId, TimeSpan.FromSeconds(30));   // fragile, ties up threads
    return Results.Ok(confirmed);
});
// Better: 202 Accepted + status resource or push notification when OrderConfirmed arrives
~~~`,
  pts: [r`Event spaghetti and invisible flows.`, r`Commands disguised as events; CRUD row events.`, r`Fat PII events or anaemic events forcing callbacks.`, r`Dual writes, non-idempotent consumers, silent drops.`, r`Synchronous waits on async events; unowned topics.`],
  ex: r`An "order updated" CRUD event with 140 fields was split into 6 intention-revealing events, cutting consumer bugs sharply.`,
  fu: [r`How do you refactor an event spaghetti system?`],
  pit: [r`Request/reply over topics for simple queries.`] },

{ id: 'q27', level: 'Senior', tags: ['multi-tenancy', 'partitioning'],
  q: r`How do you design topics, partitions and keys for a large multi-tenant event platform?`,
  a: r`- **Topic per event type** (or per domain stream), not per tenant, unless isolation/regulation requires it (thousands of topics are costly).
- **Key by entity id** (order id) for per-entity order; include tenant id in the envelope/headers.
- **Partition count** sized for peak consumer throughput and future growth (changing later reorders keys).
- **Hot tenants**: large tenants can create hot partitions if keyed by tenant; key by entity within tenant; for very large tenants, dedicated topics or clusters.
- **Isolation tiers**: shared topics for small tenants, dedicated topics/namespaces/clusters for regulated or enterprise tenants.
- **Quotas** per producer/consumer (Kafka quotas) against noisy neighbours.
- **Retention and residency** per region: regional clusters for data residency.`,
  code: r`~~~bash
# Kafka quotas: cap a heavy tenant's producer client to 10 MB/s and its consumers to 20 MB/s
kafka-configs --bootstrap-server $BROKERS --alter --add-config 'producer_byte_rate=10485760,consumer_byte_rate=20971520' \
  --entity-type clients --entity-name tenant-acme-producer
kafka-topics --bootstrap-server $BROKERS --create --topic orders.events.v1 --partitions 48 --replication-factor 3 \
  --config retention.ms=604800000 --config min.insync.replicas=2
~~~`,
  pts: [r`Topics per event type, not per tenant by default.`, r`Key by entity; carry tenant in headers.`, r`Size partitions for growth; changes reorder keys.`, r`Isolation tiers for regulated or huge tenants.`, r`Quotas and regional clusters for noisy neighbours and residency.`],
  ex: r`A SaaS platform moved from 3,000 per-tenant topics to 40 shared topics with tenant headers, cutting broker metadata overhead and costs.`,
  fu: [r`How do you migrate a topic to more partitions safely?`],
  pit: [r`Keying by tenant id and creating hot partitions.`] },

{ id: 'q28', level: 'Senior', tags: ['consistency', 'read-your-writes'],
  q: r`A consumer must make decisions based on data owned by another service, known only through events. How do you avoid acting on stale data?`,
  a: r`- **Accept bounded staleness** where the decision tolerates it (recommendations, notifications).
- **Versioned local copies**: track the version/time of the copied data; if the decision requires freshness beyond a threshold, query the owner.
- **Authoritative check at the decision point**: for critical decisions (credit limit, stock), call the owner synchronously or send a command that the owner validates (the owner rejects if conditions are not met).
- **Event ordering by key** and gap detection to know your copy is complete.
- **Embed the needed facts in the triggering event** (event-carried state at the time of the event), so decisions use consistent data.
- **Reconciliation** for decisions made on stale data.`,
  code: r`~~~csharp
// Decision requiring fresh, authoritative data: ask the owner to decide (command), do not decide on a cached copy
public async Task Consume(ConsumeContext<OrderPlaced> ctx)
{
    var copy = await localLimits.GetAsync(ctx.Message.CustomerId);
    if (copy is not null && copy.AsOf > DateTimeOffset.UtcNow.AddMinutes(-5) && copy.Available >= ctx.Message.Total * 10)
    {
        await ctx.Publish(new CreditPreApproved(ctx.Message.OrderId));               // clearly safe on a recent copy
        return;
    }
    await ctx.Send(new ReserveCredit(ctx.Message.OrderId, ctx.Message.CustomerId, ctx.Message.Total));   // owner validates atomically
}
~~~`,
  pts: [r`Tolerate staleness only where decisions allow it.`, r`Track versions and freshness of local copies.`, r`Let the owner validate critical decisions via commands.`, r`Embed decision facts in triggering events.`, r`Reconcile decisions made on stale data.`],
  ex: r`A credit check moved from a 15-minute-stale local copy to a ReserveCredit command, eliminating over-limit approvals.`,
  fu: [r`How do you detect gaps in a local copy?`],
  pit: [r`Approving payments against an event-fed copy of a balance.`] },

{ id: 'q29', level: 'Senior', tags: ['cdc', 'legacy'],
  q: r`How do you use change data capture to integrate legacy systems into an event-driven architecture?`,
  a: r`Legacy systems often cannot publish events. **CDC** reads their database transaction logs (Debezium for SQL Server/PostgreSQL/MySQL/Oracle/Db2, AWS DMS, Azure SQL CDC) and emits change events without modifying the application.

Design:

- Treat raw CDC events as **internal/technical** (table-shaped, before/after images).
- Build an **anti-corruption layer** (a stream processor or translation service) that converts raw changes into meaningful **domain/integration events** (CustomerAddressChanged), filtering noise and joining related tables.
- Handle **transactions spanning tables** (use transaction metadata to group changes).
- **Snapshots** for initial loads; schema changes in the legacy DB break pipelines, so monitor and version.
- Load on the legacy database (log reading is usually light, snapshots are not).

This enables strangler migrations: new services consume legacy changes and gradually take over capabilities.`,
  code: r`~~~csharp
// Translating raw CDC (table rows) into a domain event in an anti-corruption layer
public sealed class LegacyCustomerTranslator(IProducer<string, string> producer)
{
    public async Task OnChangeAsync(DebeziumChange<LegacyCustRow> change, CancellationToken ct)
    {
        if (change.Op != "u" || change.Before is null || change.After is null) return;
        if (change.Before.ADDR_LINE1 == change.After.ADDR_LINE1 && change.Before.POSTCODE == change.After.POSTCODE) return;   // not an address change
        var evt = new CustomerAddressChanged(change.After.CUST_NO.Trim(),
            new Address(change.After.ADDR_LINE1.Trim(), change.After.POSTCODE.Trim(), MapCountry(change.After.CTRY_CD)), change.TsMs);
        await producer.ProduceAsync("customers.address-changed.v1", new Message<string, string> { Key = evt.CustomerId, Value = JsonSerializer.Serialize(evt) }, ct);
    }
}
~~~`,
  dia: r`flowchart LR
  LEG[(Legacy DB)] -->|transaction log| DBZ[Debezium CDC]
  DBZ --> RAW[(raw.legacy.customers)]
  RAW --> ACL[Anti-corruption translator]
  ACL --> DOM[(customers.address-changed.v1)]
  DOM --> NEW[New services]`,
  pts: [r`CDC emits changes without modifying legacy apps.`, r`Raw CDC events are technical, table-shaped.`, r`Translate to domain events in an anti-corruption layer.`, r`Group multi-table transactions; plan snapshots.`, r`Enables strangler migrations.`],
  ex: r`A mainframe-backed customer database fed a CDC translator, letting 12 new services react to address changes without touching COBOL code.`,
  fu: [r`How do you handle legacy schema changes?`],
  pit: [r`Publishing raw table changes as public contracts.`] },

{ id: 'q30', level: 'Senior', tags: ['compacted-topics', 'state'],
  q: r`What are compacted topics, and how do you use them for reference data and state distribution?`,
  a: r`A **log-compacted** Kafka topic keeps at least the **latest value per key**, removing older values over time. A message with a **null value (tombstone)** deletes the key after compaction.

Uses:

- **Reference data distribution**: currencies, product catalogue, configuration: consumers rebuild a full local table by reading the topic from the beginning, then stay updated.
- **State snapshots** for event-carried state transfer (latest customer profile per id).
- **Changelog topics** for stream-processing state stores (Kafka Streams).
- **CDC of current state**.

Considerations: compaction is asynchronous (consumers may see older values until compacted, so use versions); combine with time retention ({{cleanup.policy=compact,delete}}) when history must expire; tombstones must be retained long enough ({{delete.retention.ms}}) for slow consumers to see deletions.`,
  code: r`~~~bash
kafka-topics --bootstrap-server $BROKERS --create --topic reference.currencies.v1 --partitions 6 --replication-factor 3 \
  --config cleanup.policy=compact --config min.compaction.lag.ms=60000 --config delete.retention.ms=86400000
~~~
~~~csharp
// Consumer builds a local table from a compacted topic on startup
var table = new ConcurrentDictionary<string, Currency>();
consumer.Assign(partitions.Select(p => new TopicPartitionOffset(p, Offset.Beginning)));
while (!caughtUp) { var cr = consumer.Consume(ct); if (cr.Message.Value is null) table.TryRemove(cr.Message.Key, out _); else table[cr.Message.Key] = Parse(cr.Message.Value); }
~~~`,
  pts: [r`Compaction keeps the latest value per key.`, r`Tombstones delete keys.`, r`Great for reference data, latest state and changelogs.`, r`Compaction is asynchronous; use versions.`, r`Tune tombstone retention for slow consumers.`],
  ex: r`Distributing FX reference data via a compacted topic let 30 services bootstrap a full local table in seconds without calling a reference API.`,
  fu: [r`compact vs compact,delete cleanup policies?`],
  pit: [r`Short delete.retention.ms causing consumers to miss deletions.`] },

{ id: 'q31', level: 'Senior', tags: ['serverless', 'cloud-events'],
  q: r`How do serverless event-driven architectures (Azure Functions, AWS Lambda with EventBridge/SQS) change design decisions?`,
  a: r`- **Triggers and bindings** connect functions to queues, topics, blob events and schedules; the platform handles scaling to zero and parallelism.
- **Concurrency control** is critical: unbounded scale-out can overwhelm downstream databases; set max concurrency, batch sizes and reserved concurrency.
- **Idempotency** is mandatory (at-least-once triggers, retries on timeouts).
- **Execution limits**: timeouts (minutes), payload sizes, cold starts (.NET: use isolated worker, ReadyToRun/Native AOT, or Flex/Premium plans; Lambda SnapStart for .NET).
- **Orchestration** via Durable Functions or Step Functions for multi-step flows.
- **Observability** through Application Insights / CloudWatch / X-Ray with correlation.
- **Cost model**: pay per execution; long-running or steady high throughput may be cheaper on containers.`,
  code: r`~~~csharp
// Azure Functions isolated worker: Service Bus trigger with batch processing and explicit idempotency
[Function("ProcessPayments")]
public async Task Run([ServiceBusTrigger("payments", Connection = "ServiceBus", IsBatched = true)] ServiceBusReceivedMessage[] messages,
                      ServiceBusMessageActions actions, CancellationToken ct)
{
    foreach (var m in messages)
    {
        if (await inbox.SeenAsync(m.MessageId, ct)) { await actions.CompleteMessageAsync(m, ct); continue; }
        await handler.HandleAsync(m.Body.ToObjectFromJson<PaymentEvent>()!, ct);
        await inbox.MarkAsync(m.MessageId, ct);
        await actions.CompleteMessageAsync(m, ct);
    }
}
// host.json: "maxConcurrentCalls": 16, "maxMessageBatchSize": 50  -> bound pressure on the database
~~~`,
  pts: [r`Triggers and bindings handle wiring and scaling.`, r`Bound concurrency to protect downstream systems.`, r`Idempotency is mandatory.`, r`Mind execution limits and cold starts.`, r`Durable/Step Functions for multi-step flows; compare costs at steady load.`],
  ex: r`An unbounded Lambda consumer opened 3,000 database connections during a backlog; reserved concurrency of 50 stabilised it.`,
  fu: [r`When is serverless more expensive than containers?`],
  pit: [r`Letting serverless consumers scale without limits against a relational database.`] },

{ id: 'q32', level: 'Senior', tags: ['event-replay'],
  q: r`How do you use event replay safely (rebuild projections, onboard new consumers, recover from bugs)?`,
  a: r`Replay re-processes historical events. Safety rules:

- **Idempotent consumers** (replay delivers events already processed).
- **Side-effect isolation**: replays must not send emails, charge cards or call partners again. Separate pure state projections from side-effecting handlers; disable side effects during replay (replay mode flag or separate consumer group).
- **New consumer group** or new projection version for rebuilds, then switch.
- **Retention**: logs must retain enough history (or archive to object storage/event store for full history).
- **Schema evolution**: replayed old events need upcasters.
- **Throughput**: replay at controlled rates to avoid overloading databases; batch writes.
- **Correctness checks**: compare rebuilt projection with the current one (counts, checksums) before switching.`,
  code: r`~~~bash
# Rebuild a projection into a new consumer group from the beginning
kafka-consumer-groups --bootstrap-server $BROKERS --group order-summary-v2 --topic orders.events.v1 --reset-offsets --to-earliest --execute
# Replay a time range for a fixed consumer (bug fix), side effects disabled via config
kubectl set env deploy/order-projector REPLAY_MODE=true
kafka-consumer-groups --bootstrap-server $BROKERS --group order-projector --topic orders.events.v1 \
  --reset-offsets --to-datetime 2026-10-10T08:00:00.000 --execute
~~~`,
  pts: [r`Replay requires idempotent consumers.`, r`Never repeat side effects during replay.`, r`Use new groups or projection versions, then switch.`, r`Ensure retention or archives cover the history.`, r`Throttle and verify before switching.`],
  ex: r`A replay accidentally resent 40,000 emails because side effects were in the projection consumer; separating them made future replays safe.`,
  fu: [r`How do you archive Kafka topics for long-term replay?`],
  pit: [r`Replaying into consumers that send emails or call payment APIs.`] },

{ id: 'q33', level: 'Senior', tags: ['frontend', 'real-time'],
  q: r`How do you bring event-driven updates to Angular/React front ends (SignalR, SSE, WebSockets)?`,
  a: r`Server components consume backend events and push relevant updates to connected clients:

- **SignalR** (.NET): abstraction over WebSockets/SSE/long polling, groups (per user, per account), scale-out via Azure SignalR Service or a Redis backplane.
- **Server-Sent Events**: simple one-way streaming over HTTP; works well through proxies; automatic reconnect.
- **WebSockets**: bidirectional, lower-level.

Design:

- A **push gateway** service subscribes to domain events and maps them to user-facing notifications (authorisation: only push data the user may see).
- Clients **reconnect** and **resync** (fetch latest state after reconnect, since pushes may be missed).
- Updates carry **versions** so clients ignore stale ones.
- Throttle/coalesce high-frequency streams (prices) on the server.`,
  code: r`~~~csharp
public sealed class PaymentStatusPusher(IHubContext<AccountHub> hub) : IConsumer<PaymentStatusChanged>
{
    public Task Consume(ConsumeContext<PaymentStatusChanged> c) =>
        hub.Clients.Group("account:" + c.Message.AccountId).SendAsync("paymentStatus", new { c.Message.PaymentId, c.Message.Status, c.Message.Version });
}
~~~
~~~typescript
// React: resync on reconnect, ignore stale versions
const conn = new signalR.HubConnectionBuilder().withUrl('/hubs/account').withAutomaticReconnect().build();
conn.on('paymentStatus', (u: { paymentId: string; status: string; version: number }) =>
  setPayments(ps => ps.map(p => p.id === u.paymentId && u.version > p.version ? { ...p, status: u.status, version: u.version } : p)));
conn.onreconnected(() => queryClient.invalidateQueries({ queryKey: ['payments'] }));   // fetch missed updates
await conn.start();
~~~`,
  pts: [r`A push gateway maps backend events to user notifications.`, r`SignalR, SSE or WebSockets depending on needs.`, r`Authorise every push.`, r`Resync after reconnect; pushes can be missed.`, r`Versions to ignore stale updates; throttle high-frequency streams.`],
  ex: r`Pushing payment status changes via SignalR replaced 5-second polling from 200,000 clients, cutting API load by 90%.`,
  fu: [r`How do you scale SignalR to millions of connections?`],
  pit: [r`Assuming every push is delivered and never resyncing.`] },

{ id: 'q34', level: 'Senior', tags: ['ordering', 'saga'],
  q: r`How do you handle a sequence of events for the same entity arriving out of order across different topics?`,
  a: r`Different topics/partitions have no ordering relationship. Strategies:

- **Single stream per entity** where order matters (one topic for all order lifecycle events, keyed by order id).
- **State machine with buffering**: if an event arrives for a state not yet reached (Shipped before Paid), store it and apply when the prerequisite arrives (with a timeout).
- **Version/sequence per entity** across all its events; apply in sequence, buffer gaps.
- **Idempotent, commutative updates** where possible (set flags rather than transitions).
- **Re-fetch authoritative state** when confused (call the owner's API).
- **Reconcile** periodically.`,
  code: r`~~~csharp
public async Task ApplyAsync(OrderEvent e, CancellationToken ct)
{
    var view = await db.OrderViews.FindAsync([e.OrderId], ct) ?? new OrderView(e.OrderId);
    if (e.Sequence <= view.LastSequence) return;                                  // duplicate / stale
    if (e.Sequence > view.LastSequence + 1)
    {
        db.PendingEvents.Add(PendingEvent.From(e));                               // buffer until the gap is filled
        await db.SaveChangesAsync(ct);
        return;
    }
    view.Apply(e);
    foreach (var next in await db.PendingEvents.Where(p => p.OrderId == e.OrderId).OrderBy(p => p.Sequence).ToListAsync(ct))
    {
        if (next.Sequence != view.LastSequence + 1) break;
        view.Apply(next.ToEvent()); db.PendingEvents.Remove(next);
    }
    await db.SaveChangesAsync(ct);
}
~~~`,
  pts: [r`Topics and partitions have no cross-ordering.`, r`One stream per entity where order matters.`, r`Per-entity sequences with buffering of gaps.`, r`Commutative updates and authoritative re-fetch.`, r`Timeouts on buffered events and reconciliation.`],
  ex: r`Buffering out-of-sequence shipment events fixed orders occasionally showing "delivered" then "paid".`,
  fu: [r`How long should you buffer before re-fetching?`],
  pit: [r`Assuming events from two topics arrive in production order.`] },

{ id: 'q35', level: 'Senior', tags: ['cost', 'operations'],
  q: r`How do you operate brokers and event platforms reliably and cost-effectively?`,
  a: r`- **Managed services** (Confluent Cloud, MSK, Event Hubs, Service Bus) unless you have strong reasons and skills to self-host.
- **Capacity**: partitions, throughput units, storage retention sized from measured rates with headroom; quotas per client.
- **Durability settings**: replication factor 3, {{min.insync.replicas=2}}, {{acks=all}} for business events.
- **Retention**: tiered storage or archiving to object storage for long history; shorter hot retention.
- **Monitoring**: broker health, under-replicated partitions, consumer lag, request latency, disk usage.
- **Upgrades and DR**: rolling upgrades, cross-region replication (MirrorMaker 2, Cluster Linking, geo-DR) where required.
- **Cost**: retention and replication drive storage; cross-AZ traffic from consumers (fetch from follower / rack awareness); unused topics; compression (zstd/lz4).
- **Platform team** offering self-service topic creation with guardrails.`,
  code: r`~~~bash
kafka-topics --bootstrap-server $BROKERS --create --topic payments.events.v1 --partitions 24 --replication-factor 3 \
  --config min.insync.replicas=2 --config compression.type=zstd --config retention.ms=604800000
# Producer settings for business events: acks=all, enable.idempotence=true
# Consumers in the same AZ as a replica: client.rack=eu-west-1a (fetch-from-follower cuts cross-AZ traffic cost)
~~~`,
  pts: [r`Prefer managed brokers.`, r`Size partitions, throughput and retention from data with headroom.`, r`RF=3, min ISR 2, acks=all for business events.`, r`Monitor replication, lag, latency and disk.`, r`Cut cost with compression, tiered storage and rack-aware consumers.`],
  ex: r`Enabling rack-aware fetching and zstd compression cut a Kafka platform's cross-AZ data transfer bill by 60%.`,
  fu: [r`What does min.insync.replicas protect against?`],
  pit: [r`acks=1 for financial events.`] },

{ id: 'q36', level: 'Senior', tags: ['request-reply'],
  q: r`When is request/reply over messaging appropriate, and how do you implement it correctly?`,
  a: r`Request/reply over a broker (send a request message, receive a reply on a reply queue correlated by id) is useful when:

- The responder is only reachable via messaging (network boundaries, legacy mainframe MQ).
- You want load levelling and durability for requests that can tolerate seconds of latency.
- Long-running operations where replies come back later (asynchronous replies to a callback queue).

Implementation:

- **Correlation id** in requests; responders copy it to replies.
- **Reply-to address** per client instance or a shared reply queue with correlation-based routing.
- **Timeouts** on the requester; handle late replies (ignore or reconcile).
- **Idempotent responders**.

Avoid using it for simple synchronous queries between services that can call each other directly: it adds latency and complexity.`,
  code: r`~~~csharp
// MassTransit request client: correlation and reply addressing handled by the library
public sealed class CreditCheckService(IRequestClient<CheckCredit> client)
{
    public async Task<CreditDecision> CheckAsync(Guid customerId, decimal amount, CancellationToken ct)
    {
        try
        {
            var response = await client.GetResponse<CreditDecision>(new CheckCredit(customerId, amount), ct, RequestTimeout.After(s: 5));
            return response.Message;
        }
        catch (RequestTimeoutException) { return CreditDecision.Refer("credit service timeout"); }   // explicit timeout outcome
    }
}
~~~`,
  pts: [r`Useful across messaging-only boundaries and for durable, levelled requests.`, r`Correlation ids and reply-to addresses.`, r`Timeouts with explicit outcomes; handle late replies.`, r`Idempotent responders.`, r`Prefer direct calls for simple synchronous queries.`],
  ex: r`Credit checks against a mainframe exposed only via MQ used request/reply with 5-second timeouts and a "refer to underwriter" fallback.`,
  fu: [r`How do you route replies to the right instance?`],
  pit: [r`Request/reply over topics for every internal query.`] },

{ id: 'q37', level: 'Principal', tags: ['architecture-decision'],
  q: r`When would you not choose an event-driven architecture?`,
  a: r`Avoid or limit EDA when:

- **Strong consistency is required across operations** that a single database transaction can handle (keep them in one service/database).
- **Simple CRUD applications** with one team: events add complexity without benefit.
- **Synchronous user interactions** needing immediate, authoritative answers (a quote, validation).
- **The team lacks operational maturity** for brokers, observability and failure handling, and no managed platform exists.
- **Low volume, few consumers**: direct API calls are simpler.
- **Debuggability and auditability requirements** cannot be met yet (no tracing or catalogue).

EDA is a tool for decoupling and scale; use it at integration points where those properties matter, not as the default for every interaction.`,
  code: r`~~~text
Decision table
Interaction                                  Choice
Validate IBAN while user types                synchronous API
Place order -> notify, loyalty, analytics      event (outbox)
Admin edits reference data (one consumer)     direct call or nightly sync
Ledger posting + balance update               single DB transaction (no events between them)
Fraud features from all payments              event stream + stream processing
~~~`,
  pts: [r`Keep strongly consistent operations in one transaction.`, r`Simple CRUD with one team does not need events.`, r`Immediate authoritative answers need synchronous calls.`, r`Without operational maturity, EDA hurts.`, r`Use events at integration points where decoupling matters.`],
  ex: r`A team removed events between two tightly coupled modules of the same service and replaced them with one transaction, fixing intermittent inconsistencies.`,
  fu: [r`What prerequisites would you require before adopting EDA?`],
  pit: [r`Making every interaction an event.`] },

{ id: 'q38', level: 'Principal', tags: ['platform', 'governance'],
  q: r`Design an enterprise event platform strategy for 40 teams.`,
  a: r`- **Technology standard**: one streaming platform (Kafka-compatible) and one queueing service, both managed.
- **Self-service with guardrails**: topic creation through a portal/GitOps with naming conventions, partition/retention defaults, ACLs, quotas and cost tags.
- **Schema registry and compatibility rules** enforced in CI; event catalogue with ownership.
- **Client libraries / service defaults**: producers with outbox, idempotent producers, consumers with inbox, retries, DLQ, tracing, metrics.
- **Data governance**: PII classification, retention policies, erasure processes, residency (regional clusters).
- **Observability**: lag dashboards per consumer group, DLQ alerts, end-to-end latency.
- **Operating model**: platform team owns brokers and tooling; product teams own their events and consumers; architecture guild for public event standards.
- **Lifecycle**: deprecation, unused topic cleanup, cost showback.`,
  code: r`~~~yaml
# GitOps topic request (reviewed by owners; applied by the platform operator)
apiVersion: platform.example.com/v1
kind: EventTopic
metadata: { name: payments.payment-captured.v2 }
spec:
  owner: team-payments
  partitions: 24
  retention: 7d
  schema: { registry: payments.payment-captured-value, compatibility: BACKWARD_TRANSITIVE }
  dataClassification: confidential
  pii: false
  consumers: [ledger, notifications, analytics]
  region: eu-west
~~~`,
  pts: [r`Standardise on a managed log and a managed queue.`, r`Self-service topics with guardrails via GitOps.`, r`Schema registry, catalogue and ownership.`, r`Client libraries with outbox, inbox, DLQ and tracing.`, r`Governance for PII, residency, lifecycle and cost.`],
  ex: r`A GitOps topic workflow cut topic provisioning from 2 weeks (tickets) to 1 hour while enforcing naming, ACLs and retention.`,
  fu: [r`How do you charge teams for platform usage?`],
  pit: [r`Every team running its own broker.`] },

{ id: 'q39', level: 'Principal', tags: ['interview-scenario', 'payments'],
  q: r`Design an event-driven payments processing pipeline (authorisation, capture, settlement, ledger, notifications).`,
  a: r`### Flow
1. **Payments API** (sync) creates a payment intent (idempotency key), authorises with the PSP, persists state + outbox {{PaymentAuthorised}}.
2. **Capture orchestrator** (saga) captures on shipment events ({{OrderShipped}} -> {{CapturePayment}} command) with timeouts and unknown-outcome handling.
3. **Ledger service** consumes {{PaymentCaptured}}, {{RefundIssued}} and posts double-entry journals idempotently (journal key = event id).
4. **Settlement service** ingests PSP settlement files, emits {{SettlementReceived}}; **reconciliation** matches ledger vs settlement, emitting breaks to an operations queue.
5. **Notifications** and **analytics** subscribe to payment events.
6. **Fraud** stream processing consumes authorisations for velocity features.

### Properties
Partition key = payment id; schemas in a registry; PII minimised (tokens, not card data); DLQ + replay; reconciliation as the backstop.`,
  code: r`~~~csharp
// Ledger consumer: idempotent by event id, posts balanced journal
public async Task Consume(ConsumeContext<PaymentCaptured> c)
{
    var journalKey = "evt:" + c.MessageId;
    if (await ledger.ExistsAsync(journalKey)) return;
    await ledger.PostAsync(new Journal(journalKey, c.Message.CapturedAt,
    [
        new Posting("psp-receivable:" + c.Message.Psp, c.Message.AmountMinor, c.Message.Currency),
        new Posting("merchant-payable:" + c.Message.MerchantId, -(c.Message.AmountMinor - c.Message.FeeMinor), c.Message.Currency),
        new Posting("fee-income", -c.Message.FeeMinor, c.Message.Currency)
    ]));
}
~~~`,
  dia: r`flowchart LR
  API[Payments API] -->|PaymentAuthorised| BUS[(Event bus)]
  ORD[Orders] -->|OrderShipped| BUS
  BUS --> CAP[Capture saga] --> PSP[PSP]
  CAP -->|PaymentCaptured| BUS
  BUS --> LED[Ledger: double entry]
  SET[Settlement file ingest] -->|SettlementReceived| BUS
  BUS --> REC[Reconciliation] --> OPS[Ops break queue]
  BUS --> NOT[Notifications]
  BUS --> FR[Fraud streaming]
  BUS --> AN[Analytics]`,
  pts: [r`Sync intent creation; async capture via a saga.`, r`Ledger posts idempotent, balanced journals from events.`, r`Settlement ingestion and reconciliation close the loop.`, r`Notifications, fraud and analytics subscribe independently.`, r`Payment-id keys, schemas, minimal PII, DLQ and replay.`],
  ex: r`A marketplace's event-driven payments pipeline reconciled 2 million daily payments with under 50 manual breaks.`,
  fu: [r`What happens if the ledger consumer is down for an hour?`],
  pit: [r`Updating the ledger synchronously inside the payments API.`] },

{ id: 'q40', level: 'Principal', tags: ['migration'],
  q: r`How do you introduce event-driven integration into an organisation that uses nightly batch files and point-to-point APIs?`,
  a: r`1. **Identify high-value integration points**: where batch latency hurts (fraud, customer notifications, inventory), or point-to-point APIs create fragile coupling.
2. **Stand up the platform** (managed broker, schema registry, catalogue, client libraries) with a platform team.
3. **Pilot** with one producer and a few consumers; prove outbox, idempotency, monitoring and operations.
4. **Bridge legacy**: CDC on legacy databases translated into domain events; file-to-event adapters for batch sources; keep batch for systems that need it.
5. **Migrate consumers incrementally** from batch/polling to events, running both until confidence is high (compare outputs).
6. **Standards and enablement**: event design guidelines, training, office hours.
7. **Measure**: latency reduction, coupling reduction, incident trends.

Do not replace all batch: some reconciliations and regulatory reports remain batch by nature.`,
  code: r`~~~csharp
// File-to-event adapter: a nightly legacy file becomes per-record events for new consumers
public async Task ProcessFileAsync(Stream file, CancellationToken ct)
{
    await foreach (var row in CsvReader.ReadAsync<LegacyPaymentRow>(file, ct))
    {
        var evt = new PaymentSettled(row.Reference, row.AmountMinor, row.Currency, row.ValueDate);
        await outbox.AddAsync(evt, messageId: DeterministicId("settled", row.Reference), ct);   // re-running the file is idempotent
    }
    await outbox.FlushAsync(ct);
}
~~~`,
  pts: [r`Start where batch latency or coupling hurts most.`, r`Build the platform and prove it with a pilot.`, r`Bridge legacy with CDC and file-to-event adapters.`, r`Migrate consumers incrementally with parallel runs.`, r`Keep batch where it is the right tool.`],
  ex: r`A bank replaced nightly fraud files with streamed authorisation events, cutting fraud detection time from 18 hours to seconds.`,
  fu: [r`How do you convince teams to adopt events?`],
  pit: [r`Big-bang replacement of all batch interfaces.`] },

{ id: 'q41', level: 'Principal', tags: ['resilience', 'dr'],
  q: r`How do you design disaster recovery for an event platform (Kafka) and the services around it?`,
  a: r`- **Within a region**: multi-AZ clusters with replication factor 3, {{min.insync.replicas=2}}, rack awareness.
- **Cross-region**: replicate topics (MirrorMaker 2, Confluent Cluster Linking, Event Hubs geo-replication); decide active-passive (consumers fail over) or active-active (per-region topics with aggregation).
- **Offsets**: consumer offsets must be translated/replicated so consumers resume near where they left off; accept some reprocessing (idempotency).
- **Ordering and duplicates** after failover: expect duplicates; per-key ordering may be disturbed briefly.
- **Producers** fail over via DNS/bootstrap configuration; outbox relays resume from the outbox (no loss).
- **Schema registry and ACLs** replicated too.
- **Drills**: measure RPO (unreplicated messages lost) and RTO (consumers resumed).`,
  code: r`~~~properties
# MirrorMaker 2 (connect-mirror-maker.properties): replicate payments topics from primary to DR and sync consumer offsets
clusters = primary, dr
primary.bootstrap.servers = kafka-primary:9092
dr.bootstrap.servers = kafka-dr:9092
primary->dr.enabled = true
primary->dr.topics = payments\..*, orders\..*
primary->dr.sync.group.offsets.enabled = true
primary->dr.emit.checkpoints.interval.seconds = 10
replication.factor = 3
~~~`,
  dia: r`flowchart LR
  subgraph P[Primary region]
    PR[Producers + outbox relays] --> K1[(Kafka cluster)]
    K1 --> C1[Consumers]
  end
  subgraph D[DR region]
    K2[(Kafka replica cluster)] --> C2[Consumers standby]
  end
  K1 -->|MirrorMaker 2 / cluster linking + offset sync| K2`,
  pts: [r`Multi-AZ with RF 3, min ISR 2 and acks=all.`, r`Replicate topics, offsets, schemas and ACLs cross-region.`, r`Expect duplicates and brief ordering disturbance; consumers are idempotent.`, r`Outbox relays resume without loss.`, r`Drill and measure RPO/RTO.`],
  ex: r`A failover drill showed consumers reprocessing 90 seconds of events after offset translation; idempotent consumers made it harmless.`,
  fu: [r`Active-active Kafka across regions: what are the pitfalls?`],
  pit: [r`Replicating topics but forgetting consumer offsets and schemas.`] },

{ id: 'q42', level: 'Principal', tags: ['interview-scenario', 'incident'],
  q: r`Consumers of a critical topic are 6 hours behind during peak trading. Lead the incident.`,
  a: r`### Stabilise
1. Declare the incident; identify impact (which business processes depend on this consumer: positions, risk limits).
2. Check consumer health: errors, retries, poison messages blocking partitions, slow downstream (database), rebalancing storms.
3. Quick wins: scale consumers up to partition count; increase batch sizes; temporarily disable non-critical consumers competing for the same database; skip/park poison messages to DLQ.
4. If downstream is the bottleneck, apply backpressure and prioritise critical event types (separate topic or filter) .

### Communicate
Business impact and expected catch-up time (lag / net consumption rate).

### Recover and learn
Catch up, verify projections (counts), reconcile decisions made on stale data (risk checks), postmortem: capacity planning for peak, alerts on lag growth rate, load tests at peak volumes, partition count review.`,
  code: r`~~~bash
kafka-consumer-groups --bootstrap-server $BROKERS --describe --group positions-projector   # lag per partition
kubectl scale deploy/positions-projector --replicas=24                                       # up to partition count
kubectl set env deploy/positions-projector BATCH_SIZE=2000 MAX_POLL_RECORDS=2000
# Catch-up estimate: lag 18,000,000 / (consume 9,000 - produce 4,000 msg/s) = 3,600 s ≈ 1 hour
~~~`,
  pts: [r`Identify business impact first.`, r`Find the bottleneck: errors, poison messages, downstream, rebalances.`, r`Scale to partitions, batch, park poison messages, prioritise.`, r`Communicate catch-up time from lag and net consumption rate.`, r`Reconcile stale decisions; postmortem on capacity and alerts.`],
  ex: r`A positions consumer fell behind due to a slow index after a migration; batching and an index fix caught up in 50 minutes, and risk checks were re-run for the window.`,
  fu: [r`How do you alert on lag growth rather than absolute lag?`],
  pit: [r`Restarting consumers repeatedly, causing rebalance storms.`] },

{ id: 'q43', level: 'Principal', tags: ['data-mesh', 'analytics'],
  q: r`How do event streams relate to data mesh and analytics platforms?`,
  a: r`- **Operational events as data products**: domain teams publish well-defined, documented, versioned event streams that analytics can consume (a data mesh "output port").
- **Streaming ingestion** into the lakehouse (Kafka Connect, Event Hubs Capture, Kinesis Firehose) in open formats.
- **Domain ownership**: the team that owns the events owns their quality, schema and SLOs (freshness, completeness).
- **Data contracts**: explicit agreements on schema, semantics, PII and SLAs between producers and analytical consumers.
- **Self-serve platform**: catalogue, lineage, access control, quality monitoring.
- **Separation**: analytical needs should not drive operational event design into bloated events; derive analytical datasets downstream.`,
  code: r`~~~yaml
# Data contract for an event stream consumed by analytics
dataProduct: payments.payment-captured
owner: team-payments
schema: registry://payments.payment-captured-value/v3
semantics:
  amountMinor: "captured amount in minor units of currency, after partial captures"
  capturedAt: "UTC time PSP confirmed capture"
quality:
  freshness: "p99 < 60s from capture to topic"
  completeness: "reconciled daily against PSP settlement; breaks < 0.01%"
pii: none
retention: "7 days hot; archived to lake indefinitely"
~~~`,
  pts: [r`Event streams can be domain data products.`, r`Stream into the lakehouse in open formats.`, r`Domain teams own quality, schema and SLOs.`, r`Data contracts define semantics, PII and SLAs.`, r`Derive analytical datasets downstream of lean events.`],
  ex: r`Publishing data contracts for payment events let the analytics team stop reverse-engineering semantics from database dumps.`,
  fu: [r`Who pays for analytical consumption of operational streams?`],
  pit: [r`Bloating operational events to serve every analytics query.`] },

{ id: 'q44', level: 'Principal', tags: ['code-review'],
  q: r`Code review: what is wrong with this event consumer?`,
  a: r`~~~csharp
public class OrderShippedConsumer : IConsumer<OrderShipped>
{
    private static int _processed;
    public async Task Consume(ConsumeContext<OrderShipped> ctx)
    {
        try
        {
            var order = await _db.Orders.FindAsync(ctx.Message.OrderId);
            order.Status = "SHIPPED";
            await _email.SendAsync(order.CustomerEmail, "Your order shipped");
            await _db.SaveChangesAsync();
            await _http.PostAsync("https://partner.example.com/notify", Json(order));
            _processed++;
        }
        catch (Exception ex) { _logger.LogError(ex, "failed"); }
    }
}
~~~

1. **Swallowed exceptions**: the message is acknowledged as successful; failures are silently lost (no retry, no DLQ).
2. **Not idempotent**: redelivery sends duplicate emails and partner notifications.
3. **Side effects before commit**: email sent before {{SaveChangesAsync}}; if saving fails, the customer was told it shipped.
4. **Partner HTTP call inline** without timeouts/retries; slow partner blocks consumption; should be its own outbox-driven dispatcher.
5. **No ordering/version check**: an older event could overwrite a newer status (e.g. Delivered -> Shipped).
6. **Null handling**: order may not exist yet (event before projection).
7. **Static mutable counter**: not thread-safe; use metrics.
8. Status as a magic string.`,
  code: r`~~~csharp
public sealed class OrderShippedConsumer(OrdersDb db, IOutbox outbox, Counter<long> processed) : IConsumer<OrderShipped>
{
    public async Task Consume(ConsumeContext<OrderShipped> ctx)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ctx.CancellationToken);
        if (!await db.Inbox.TryAddAsync(ctx.MessageId!.Value, ctx.CancellationToken)) return;           // idempotent
        var order = await db.Orders.FindAsync([ctx.Message.OrderId], ctx.CancellationToken) ?? throw new OrderNotYetKnownException(ctx.Message.OrderId);  // retried
        if (!order.TryMarkShipped(ctx.Message.Version)) return;                                         // stale event ignored
        await outbox.AddAsync(new SendShippedEmail(order.Id), ctx.CancellationToken);                   // side effects after commit
        await outbox.AddAsync(new NotifyPartner(order.Id), ctx.CancellationToken);
        await db.SaveChangesAsync(ctx.CancellationToken); await tx.CommitAsync(ctx.CancellationToken);
        processed.Add(1);
    }   // exceptions propagate -> retries -> DLQ
}
~~~`,
  pts: [r`Swallowed exceptions acknowledge failures.`, r`No idempotency: duplicate emails and notifications.`, r`Side effects before commit.`, r`Inline partner calls without resilience.`, r`No version checks; static mutable state.`],
  ex: r`A consumer like this silently dropped 2% of shipment updates for a month because exceptions were logged and swallowed.`,
  fu: [r`How would you test this consumer's failure paths?`],
  pit: [r`Catch-all blocks in message handlers.`] },

{ id: 'q45', level: 'Principal', tags: ['organisation', 'ownership'],
  q: r`Who should own events, topics and consumers in a large organisation, and how do you handle shared topics?`,
  a: r`- **Producer owns the event**: schema, semantics, quality, versioning and deprecation. Only the owner publishes to its topics.
- **Consumers own their consumption**: consumer groups, idempotency, failure handling, lag SLOs.
- **Platform team owns the brokers and tooling**, not the events.
- **No shared "integration" topics** written by many teams; if several teams emit the same concept, it signals unclear domain ownership: resolve by assigning ownership or publishing separate events.
- **Consumer registration** in the catalogue so producers know who depends on them.
- **Change process**: producers announce changes; breaking changes need versioning and migration windows; consumers commit to migrating.`,
  code: r`~~~text
Ownership matrix
Asset                                 Owner                 Responsibilities
payments.payment-captured.v2 topic    team-payments         schema, semantics, quality SLOs, deprecation
consumer group ledger-postings        team-finance          idempotency, lag SLO, DLQ handling
Kafka clusters, registry, tooling     platform-streaming    availability, upgrades, quotas, self-service
Event standards                       architecture guild    naming, envelope, compatibility policy
~~~`,
  pts: [r`Producers own events and their schemas.`, r`Consumers own their processing and SLOs.`, r`Platform owns brokers and tooling.`, r`Avoid multi-writer shared topics.`, r`Register consumers; manage changes with versioning.`],
  ex: r`A topic written by four teams had conflicting semantics; assigning one owner and splitting events ended recurring data-quality incidents.`,
  fu: [r`How do you handle a consumer that blocks a producer's deprecation?`],
  pit: [r`Integration topics owned by nobody.`] },

{ id: 'q46', level: 'Principal', tags: ['performance', 'cost'],
  q: r`How do you estimate capacity and cost for an event platform?`,
  a: r`Inputs: events/s (average, peak), average size, retention, replication factor, number of consumer groups (fan-out multiplies read throughput), cross-AZ/cross-region replication, compression ratio.

Calculations:

- **Ingress** = events/s x size (after compression).
- **Storage** = ingress x retention x replication factor (+ overhead).
- **Egress/read** = ingress x number of consumer groups (+ replication traffic).
- **Partitions**: max(producer throughput needs, consumer parallelism needs); typical partition handles several MB/s; consumer parallelism bounded by partitions.

Then map to the provider's pricing (throughput units/CKUs, storage, networking). Model growth scenarios and optimise: compression, shorter retention plus archiving, fewer consumer groups via shared projections, rack-aware fetching.`,
  code: r`~~~text
Payments stream estimate
Peak 20,000 events/s x 1.2 KB = 24 MB/s raw; zstd ~4x -> 6 MB/s ingress
Retention 7 days: 6 MB/s x 604,800 s = 3.6 TB x RF 3 = 10.9 TB stored (+10% overhead)
Consumer groups 9 -> read 54 MB/s; replication 12 MB/s
Partitions: consumers need 24-way parallelism at peak; producer side fine -> 24 partitions (48 for 2-year growth)
Archive to lake (Parquet) for long-term replay instead of 90-day hot retention: saves ~110 TB hot storage
~~~`,
  pts: [r`Ingress = rate x size after compression.`, r`Storage = ingress x retention x replication.`, r`Egress multiplies by consumer groups.`, r`Partitions sized for consumer parallelism and growth.`, r`Optimise with compression, archiving and fewer duplicate consumers.`],
  ex: r`Archiving to Parquet and keeping 7 days hot cut a streaming platform's storage bill by 70% while preserving full replay.`,
  fu: [r`How do consumer groups affect broker load?`],
  pit: [r`Sizing only by producer throughput and ignoring fan-out.`] },

{ id: 'q47', level: 'Principal', tags: ['regulated', 'audit'],
  q: r`How do you use events to meet audit and regulatory requirements in financial services?`,
  a: r`- **Immutable business event history**: events (or event-sourced streams) record what happened, when and by whom; strong evidence for audits when protected (append-only, access-controlled, hash-chained or WORM-archived).
- **Complete lineage**: correlation and causation ids link customer actions to downstream effects (payment -> ledger -> report).
- **Regulatory reporting feeds**: transaction reporting (MiFID II, EMIR, CAT), AML monitoring fed by streams with completeness controls (counts reconciled against sources).
- **Retention policies** aligned with regulation (5 to 10 years) using archives; legal holds.
- **Replayability**: reproduce reports or decisions as of a past date.
- **Controls**: data quality checks, reconciliation evidence, change management for schemas.

Balance with data protection: minimise PII, crypto-shred where erasure applies, and document lawful bases for retention.`,
  code: r`~~~sql
-- Completeness control: every captured payment in the ledger appears in the regulatory feed
SELECT l.payment_id
FROM ledger_captures l
LEFT JOIN regulatory_feed r ON r.payment_id = l.payment_id
WHERE l.captured_at >= $day AND l.captured_at < $day + interval '1 day' AND r.payment_id IS NULL;
-- Zero rows = complete; any row = break raised to compliance operations
~~~`,
  pts: [r`Events give immutable, timestamped evidence when protected.`, r`Correlation ids provide lineage.`, r`Regulatory feeds need completeness controls.`, r`Retention, legal holds and replay for reproducibility.`, r`Balance audit retention with data protection.`],
  ex: r`A broker reproduced a disputed transaction report from 18 months earlier by replaying archived events, satisfying the regulator within a day.`,
  fu: [r`How do you prove a regulatory feed is complete?`],
  pit: [r`Treating broker retention as the audit archive.`] },

{ id: 'q48', level: 'Principal', tags: ['mentoring', 'adoption'],
  q: r`How do you help teams adopt event-driven design well?`,
  a: r`- **Start with event storming** with domain experts so events reflect business facts.
- **Design guidelines** with examples: naming, envelope, ECST vs notification, versioning, PII, partition keys.
- **Paved road libraries** for outbox, inbox, retries, DLQ, tracing.
- **Review new public events** lightly (guild), focusing on semantics and ownership.
- **Hands-on workshops**: duplicates, ordering, replay and failure handling labs.
- **Observability defaults** so teams see their flows.
- **Share incidents** related to events as learning material.
- **Caution against overuse**: show where synchronous or transactional solutions are better.`,
  code: r`~~~text
Public event review checklist (15 minutes, async in the PR)
[ ] Past-tense business fact, owned by this team
[ ] Envelope: id, type+version, time, correlation, tenant
[ ] Payload: needed data only, explicit units, no internal ids leaking
[ ] PII classified and minimised
[ ] Partition key and ordering need stated
[ ] Compatibility mode and deprecation plan
[ ] Known consumers registered in the catalogue
~~~`,
  pts: [r`Event storming with domain experts first.`, r`Guidelines with concrete examples.`, r`Paved-road libraries for the hard parts.`, r`Light reviews of public events.`, r`Hands-on failure labs and shared incidents.`],
  ex: r`A replay-and-duplicates workshop changed how three teams wrote consumers more than any guideline document.`,
  fu: [r`How do you prevent over-eager event adoption?`],
  pit: [r`Mandating events everywhere without guidance.`] },

{ id: 'q49', level: 'Principal', tags: ['interview-scenario', 'real-time'],
  q: r`Design a real-time order status tracking system for customers (web and mobile) across fulfilment, carriers and payments.`,
  a: r`### Sources
Orders (placed, cancelled), Payments (authorised, captured, refunded), Fulfilment (picked, packed), Carriers (webhooks: in transit, out for delivery, delivered), Returns.

### Design
- Each owner publishes integration events; carrier webhooks normalised by a **carrier integration service** into {{ShipmentStatusChanged}} events (idempotent by carrier event id, ordered by carrier timestamp with sequence handling).
- **Order tracking projection** consumes all events and maintains a timeline per order (version per order, out-of-order buffering).
- **Query API/BFF** serves the timeline; **push gateway** (SignalR/SSE, mobile push) notifies customers of key milestones, respecting preferences.
- **Freshness**: show last-updated times; resync on reconnect.
- **Scale**: partition by order id; projection store with fast key lookups (DynamoDB/Cosmos/Redis + SQL).
- **Reconciliation**: daily check against carrier APIs for stuck shipments.`,
  code: r`~~~csharp
public sealed record TimelineEntry(string Status, DateTimeOffset At, string Source);
public sealed class OrderTimeline(Guid orderId)
{
    public Guid OrderId { get; } = orderId;
    public List<TimelineEntry> Entries { get; } = new();
    public void Apply(string status, DateTimeOffset at, string source)
    {
        if (Entries.Any(e => e.Status == status && e.Source == source)) return;          // idempotent
        Entries.Add(new TimelineEntry(status, at, source));
        Entries.Sort((a, b) => a.At.CompareTo(b.At));                                    // tolerate out-of-order arrival
    }
    public string Current => Entries.Count == 0 ? "UNKNOWN" : Entries[^1].Status;
}
~~~`,
  dia: r`flowchart LR
  ORD[Orders] --> BUS[(Event bus)]
  PAY[Payments] --> BUS
  FUL[Fulfilment] --> BUS
  CARR[Carrier webhooks] --> CI[Carrier integration: normalise, dedupe] --> BUS
  BUS --> PROJ[Order timeline projection] --> STORE[(Timeline store)]
  STORE --> API[Tracking API / BFF]
  BUS --> PUSH[Push gateway: SignalR + mobile push] --> USERS[Customers]
  API --> USERS`,
  pts: [r`Owners publish events; carrier webhooks are normalised and deduped.`, r`A timeline projection per order tolerates out-of-order events.`, r`Query API plus push gateway for real-time updates.`, r`Show freshness and resync on reconnect.`, r`Partition by order; reconcile stuck shipments.`],
  ex: r`A real-time tracking timeline cut "where is my order" contacts by 35% for an online retailer.`,
  fu: [r`How do you handle carriers that send status updates out of order?`],
  pit: [r`Polling every carrier API per customer page view.`] },

{ id: 'q50', level: 'Principal', tags: ['summary'],
  q: r`Summarise your principles for event-driven architecture as a Principal Engineer.`,
  a: r`"I use events where decoupling, fan-out and replay create value, and I make them safe by default:

- Events are business facts owned by one team, designed with a clear envelope, versioned schemas and minimal PII.
- Publishing goes through an outbox; consuming is idempotent with versions for ordering; failures go through retries and DLQs with replay tooling.
- Long processes are orchestrated with timeouts and compensations; simple reactions are choreographed.
- Eventual consistency is designed into the user experience and business process, with authoritative checks where decisions require them.
- Everything is observable end to end: trace context in messages, lag and stuck-flow alerts, an event catalogue.
- I keep strongly consistent operations in one transaction and avoid events where a direct call or batch is simpler."`,
  code: r`~~~csharp
// The principles in one handler: owned event, inbox idempotency, version check, outbox for follow-ups, failures propagate
public async Task Consume(ConsumeContext<PaymentCaptured> ctx)
{
    await using var tx = await db.Database.BeginTransactionAsync(ctx.CancellationToken);
    if (!await db.Inbox.TryAddAsync(ctx.MessageId!.Value, ctx.CancellationToken)) return;
    var order = await db.Orders.SingleAsync(o => o.Id == ctx.Message.OrderId, ctx.CancellationToken);
    if (order.TryMarkPaid(ctx.Message.PaymentId, ctx.Message.Version))
        await outbox.AddAsync(new OrderPaid(order.Id, order.Version), ctx.CancellationToken);
    await db.SaveChangesAsync(ctx.CancellationToken); await tx.CommitAsync(ctx.CancellationToken);
}
~~~`,
  pts: [r`Events where decoupling, fan-out and replay add value.`, r`Owned, versioned, lean events.`, r`Outbox in, idempotent consumers out, DLQ and replay.`, r`Orchestrate processes; design eventual consistency into UX.`, r`Observable end to end; transactions where consistency must be atomic.`],
  ex: r`Teams that adopted these defaults saw event-related incidents shift from lost or duplicated data to brief, self-healing lag.`,
  fu: [r`What is the first thing you check when an event flow misbehaves?`],
  pit: [r`Treating events as a universal integration answer.`] }
],
cheat: r`### Concepts
Events = past-tense facts, many subscribers. Commands = requests to one owner. Notification vs event-carried state transfer vs event sourcing vs CQRS. Queues (tasks, per-message ack) vs logs (replay, consumer groups, per-partition order).

### Reliability toolkit
Outbox (polling or CDC) · inbox / versioned upserts · at-least-once + idempotency = exactly-once effects · partition by entity key · idempotent producers · retries -> retry topics -> DLQ + replay · timeouts on every waiting state · reconciliation.

### Design rules
| Topic | Rule |
|---|---|
| Naming | domain.entity.event.vN, past tense |
| Envelope | id, type, version, time, source, correlation, tenant (CloudEvents) |
| Payload | needed data, explicit units, minimal PII |
| Evolution | schema registry, additive changes, new version for breaking |
| Ordering | per key; versions in consumers; buffer gaps |
| Ownership | producer owns event; consumers own processing; platform owns brokers |

### Operations
Trace context in headers · lag + oldest-message + stuck-flow alerts · KEDA scaling on lag · RF 3, min ISR 2, acks=all · compaction for latest state · archive to lake for long replay · cross-region replication with offset sync · cost = ingress x retention x RF + fan-out reads.

### Say this
"Events are facts, commands are requests." "Outbox in, idempotent consumers out." "Order is per key, never global." "Every waiting state needs a timeout." "Keep atomic invariants in one transaction."`
});
})(String.raw);
