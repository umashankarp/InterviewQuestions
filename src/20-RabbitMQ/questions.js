(function (r) {
registerTopic('20-rabbitmq', {
related: ['19-kafka', '18-event-driven-architecture', '37-outbox'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['fundamentals', 'amqp'],
  q: r`Walk through RabbitMQ's AMQP 0-9-1 model: producers, exchanges, bindings, queues, consumers and virtual hosts. Why does the producer never write to a queue directly?`,
  a: r`RabbitMQ is a **smart broker, simple consumer** system. The broker owns routing; consumers just read and acknowledge.

- **Producer** publishes a message with a **routing key** to an **exchange**. It never names a queue (even the "publish to queue" shortcut goes through the nameless default exchange).
- **Exchange** decides where the message goes, using its **type** (direct, topic, fanout, headers) and its **bindings**.
- **Binding** is a rule "exchange E routes to queue Q when the key matches pattern P". One message can be copied into zero, one or many queues.
- **Queue** stores messages until a consumer **acknowledges** them; then they are deleted. A queue is the unit of ordering and the unit of throughput (one queue is served by one leader process).
- **Consumer** subscribes to a queue, receives pushed deliveries up to its prefetch limit, and acks or nacks each one.
- **Virtual host (vhost)** is a namespace with its own exchanges, queues, users and permissions. Use one per environment, tenant or bounded context, not one per team whim.

**Why decouple through exchanges?** The producer's contract is "I emit {{payments.eu.captured}}". Who consumes it is a topology decision made by bindings, so a new audit service can bind its own queue without a producer deployment. That is the core value: **routing is configuration, not code**.

The consequence interviewers probe: a message routed to **no** queue is silently dropped unless you use {{mandatory}} or an alternate exchange (see q11).`,
  code: r`~~~text
Producer --publish(routingKey="payments.eu.captured")--> [Exchange: payments (topic)]
                                                          |- binding "payments.*.captured" -> [Queue: ledger]   -> ledger consumers
                                                          |- binding "payments.eu.#"       -> [Queue: eu-audit] -> audit consumers
                                                          '- (no match)                    -> dropped unless mandatory / alternate-exchange
~~~`,
  dia: r`flowchart LR
  P[Producer: payments-api] -->|routing key payments.eu.captured| X{{Exchange: payments - topic}}
  X -->|payments.*.captured| Q1[(Queue: ledger)]
  X -->|payments.eu.#| Q2[(Queue: eu-audit)]
  Q1 --> C1[Ledger consumer 1]
  Q1 --> C2[Ledger consumer 2]
  Q2 --> C3[Audit consumer]`,
  pts: [r`Producers publish to exchanges with a routing key; never directly to queues.`, r`Exchange type plus bindings copy a message into zero or more queues.`, r`Queues hold messages until acked; a queue is the unit of order and throughput.`, r`Vhosts isolate topology and permissions.`, r`Routing is configuration, so new consumers need no producer change.`],
  ex: r`A card issuer added a fraud-scoring service by binding a new queue to the existing {{payments}} topic exchange; the payments API was not redeployed.`,
  fu: [r`What happens to a message no binding matches?`, r`How is the default exchange different from a direct exchange?`],
  pit: [r`Describing RabbitMQ as "a queue" and ignoring exchanges and bindings.`, r`Assuming a message published to an exchange with no bindings is stored somewhere.`],
  tip: r`Say "smart broker, simple consumer" and contrast it with Kafka's "dumb broker, smart consumer" in one sentence; it frames every later answer.` },

{ id: 'q2', level: 'Basic', tags: ['exchanges', 'routing'],
  q: r`Compare direct, topic, fanout and headers exchanges. How do topic wildcards work, and how would you design routing keys for a payments domain?`,
  a: r`| Type | Matching rule | Typical use |
|---|---|---|
| **Direct** | routing key equals binding key exactly | commands to a named worker: {{ledger.post}} |
| **Topic** | dot-separated words; {{*}} = exactly one word, {{#}} = zero or more | events by domain/region/type |
| **Fanout** | ignores the key, copies to every bound queue | cache invalidation, broadcast |
| **Headers** | matches message headers, {{x-match: all}} or {{any}} | routing on attributes that do not fit a key |
| **Default** | nameless direct exchange; key = queue name | simple work queues, demos |

**Topic wildcards:** binding {{payments.*.captured}} matches {{payments.eu.captured}} but not {{payments.eu.card.captured}}; {{payments.#}} matches both and also {{payments}}.

**Designing keys** is designing an API. A good scheme is {{<domain>.<region>.<event>[.<version>]}} — for example {{payments.eu.captured.v1}}:
- order words from **most to least stable** so wildcards stay meaningful;
- keep the vocabulary closed and documented (a schema registry or a topology repo);
- never put ids or amounts in keys (unbounded cardinality, PII in logs, useless for binding).

**Performance notes:** direct and fanout are cheapest; topic matching uses a trie and is fine for thousands of bindings; headers exchanges are the slowest and hardest to reason about, so prefer them only when the attribute set is genuinely multi-dimensional. **Exchange-to-exchange bindings** let you compose: a fanout "audit tap" exchange bound to several domain exchanges.`,
  code: r`~~~csharp
// RabbitMQ.Client 7.x
await channel.ExchangeDeclareAsync("payments", ExchangeType.Topic, durable: true);
await channel.QueueDeclareAsync("ledger", durable: true, exclusive: false, autoDelete: false,
    arguments: new Dictionary<string, object?> { ["x-queue-type"] = "quorum" });
await channel.QueueBindAsync("ledger", "payments", "payments.*.captured.v1");
await channel.QueueBindAsync("ledger", "payments", "payments.*.refunded.v1");

// headers exchange: route EU gold-tier items regardless of key
await channel.ExchangeDeclareAsync("payments.attrs", ExchangeType.Headers, durable: true);
await channel.QueueBindAsync("vip-review", "payments.attrs", routingKey: "",
    arguments: new Dictionary<string, object?> { ["x-match"] = "all", ["region"] = "EU", ["tier"] = "gold" });
~~~`,
  dia: r`flowchart LR
  P[Publisher] -->|payments.eu.captured.v1| T{{topic: payments}}
  T -->|payments.*.captured.v1| L[(ledger)]
  T -->|payments.eu.#| A[(eu-audit)]
  T -->|payments.us.#| U[(us-audit)]
  F{{fanout: cache.invalidate}} --> N1[(node-1 cache q)]
  F --> N2[(node-2 cache q)]`,
  pts: [r`Direct = exact, topic = word patterns, fanout = everyone, headers = attributes.`, r`{{*}} matches one word, {{#}} zero or more.`, r`Routing keys are a public contract: stable words first, closed vocabulary, version suffix.`, r`No ids or PII in routing keys.`, r`Headers exchanges are slowest; use only for multi-dimensional routing.`],
  ex: r`A PSP standardised on {{domain.region.event.vN}}; regulators' audit feeds became one {{#.eu.#}}-style binding per region instead of code in every producer.`,
  fu: [r`How would you route by region and merchant tier at once?`, r`What does an exchange-to-exchange binding buy you?`],
  pit: [r`Putting a customer id in the routing key "for flexibility".`, r`Confusing {{*}} and {{#}}.`] },

{ id: 'q3', level: 'Basic', tags: ['connections', 'channels', 'dotnet'],
  q: r`Connection versus channel: what is each, how should a .NET service manage them, and what changed in RabbitMQ.Client 7?`,
  a: r`- A **connection** is a TCP (usually TLS) socket plus AMQP handshake and authentication. It is expensive: a few hundred KB of broker memory, file descriptors, heartbeats, and a handshake that can take tens of milliseconds. Open **one or two long-lived connections per process** (often one for publishing and one for consuming, so publisher flow control cannot stall consumers).
- A **channel** is a lightweight virtual session multiplexed inside a connection. Every operation happens on a channel. Channels are **not safe for concurrent use**: interleaving frames from two threads corrupts the protocol. Use one channel per consumer, and either one channel per publishing thread or a small pool.

**Anti-pattern:** opening a connection per message (common in naive web APIs). It causes connection churn, exhausts file descriptors and can trigger broker memory alarms — an outage caused by the client.

**RabbitMQ.Client 7.x** (the current major) is **async end to end**: {{CreateConnectionAsync}}, {{CreateChannelAsync}}, {{BasicPublishAsync}}, {{AsyncEventingBasicConsumer.ReceivedAsync}}. Publisher confirms are configured when the channel is created ({{CreateChannelOptions}}), and with confirmation tracking the publish task completes only when the broker confirms. Automatic connection and topology recovery remain on by default.

**In ASP.NET Core:** register the {{IConnection}} as a singleton created at startup, expose a publisher service that owns its channels, and run consumers in {{BackgroundService}}s, each with its own channel. Set {{ClientProvidedName}} so the management UI shows which app owns each connection.`,
  code: r`~~~csharp
builder.Services.AddSingleton<IConnection>(_ =>
{
    var factory = new ConnectionFactory
    {
        Uri = new Uri(builder.Configuration["Rabbit:Uri"]!),            // amqps://... from secret store
        ClientProvidedName = "payments-api",
        AutomaticRecoveryEnabled = true,                                // default true
        TopologyRecoveryEnabled = true,
        NetworkRecoveryInterval = TimeSpan.FromSeconds(5)
    };
    return factory.CreateConnectionAsync().GetAwaiter().GetResult();   // once, at startup
});

public sealed class Publisher(IConnection conn) : IAsyncDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IChannel? _ch;
    public async Task PublishAsync(string exchange, string key, ReadOnlyMemory<byte> body, BasicProperties props, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);                                      // channel is not thread-safe
        try
        {
            _ch ??= await conn.CreateChannelAsync(new CreateChannelOptions(
                publisherConfirmationsEnabled: true, publisherConfirmationTrackingEnabled: true), ct);
            await _ch.BasicPublishAsync(exchange, key, mandatory: true, props, body, ct);
        }
        finally { _gate.Release(); }
    }
    public async ValueTask DisposeAsync() { if (_ch is not null) await _ch.CloseAsync(); }
}
~~~`,
  pts: [r`Connection = TCP + TLS + auth, expensive, long-lived.`, r`Channel = cheap multiplexed session, not thread-safe.`, r`Separate publishing and consuming connections.`, r`Client 7 is fully async; confirms configured per channel.`, r`Name connections for operability.`],
  ex: r`An API that opened a connection per HTTP request created 4,000 connections per minute at peak and tripped the broker's memory alarm; a singleton connection fixed it.`,
  fu: [r`Why separate publish and consume connections?`, r`How would you pool channels for a high-throughput publisher?`],
  pit: [r`Sharing one channel across concurrent tasks.`, r`Connection per message.`] },

{ id: 'q4', level: 'Basic', tags: ['acknowledgements', 'delivery-semantics'],
  q: r`Explain consumer acknowledgements: auto-ack vs manual ack, ack/nack/reject, redelivery, and what delivery guarantee you actually get.`,
  a: r`- **Auto-ack** ({{autoAck: true}}): the broker considers the message done as soon as it is written to the socket. If the consumer crashes mid-processing, the message is **lost**. Delivery guarantee: **at-most-once**.
- **Manual ack**: the consumer calls {{BasicAck}} after processing succeeds. Until then the delivery is **unacked** and owned by that channel. If the channel or connection closes, every unacked message is **requeued** and redelivered with {{Redelivered = true}}. Guarantee: **at-least-once**.
- **Nack/Reject** with {{requeue: true}} puts the message back (often at the head, so it can loop); with {{requeue: false}} it is dropped or **dead-lettered** if the queue has a DLX. {{BasicNack}} supports {{multiple}}; {{BasicReject}} does not.
- **multiple: true** acks every delivery tag up to this one on the channel — useful for batch processing, dangerous if processing is concurrent and out of order.
- **Delivery tags are per channel.** Acking on a different channel is a protocol error that closes the channel.

**What you really get is at-least-once**, because the window between "side effect done" and "ack received by broker" can always be broken by a crash or network blip. So the handler must be **idempotent** (dedupe on message id, an inbox table, or naturally idempotent upserts). {{Redelivered}} is a hint, not a guarantee: a message can be a duplicate without it (publisher retries) and can be flagged without being processed.

**Order of operations:** process -> commit DB transaction -> ack. Never ack before the commit.`,
  code: r`~~~csharp
await channel.BasicQosAsync(prefetchSize: 0, prefetchCount: 20, global: false);
var consumer = new AsyncEventingBasicConsumer(channel);
consumer.ReceivedAsync += async (_, ea) =>
{
    try
    {
        var cmd = JsonSerializer.Deserialize<PostLedgerEntry>(ea.Body.Span)!;
        await handler.HandleAsync(cmd, ea.BasicProperties.MessageId!);   // idempotent: inbox keyed by MessageId
        await channel.BasicAckAsync(ea.DeliveryTag, multiple: false);    // ack AFTER the DB commit
    }
    catch (JsonException)
    {
        await channel.BasicRejectAsync(ea.DeliveryTag, requeue: false);  // poison -> DLX
    }
    catch (Exception ex) when (IsTransient(ex))
    {
        await channel.BasicNackAsync(ea.DeliveryTag, multiple: false, requeue: false); // -> retry queue via DLX
    }
};
await channel.BasicConsumeAsync("ledger", autoAck: false, consumer: consumer);
~~~`,
  dia: r`sequenceDiagram
  participant Q as Queue ledger
  participant C as Consumer
  participant DB as Ledger DB
  Q->>C: deliver tag 42
  C->>DB: insert entry + inbox row (one transaction)
  DB-->>C: committed
  C->>Q: basic.ack 42
  Note over C,Q: crash before ack -> message requeued, redelivered=true
  Q->>C: redeliver tag 43 (same message)
  C->>DB: inbox row exists -> skip
  C->>Q: basic.ack 43`,
  pts: [r`Auto-ack = at-most-once; manual ack = at-least-once.`, r`Unacked messages requeue when the channel closes.`, r`Ack after the commit; handlers must be idempotent.`, r`Delivery tags are channel-scoped.`, r`{{Redelivered}} is only a hint.`],
  ex: r`A refund service using auto-ack lost 300 refunds during a pod eviction; switching to manual ack plus an inbox table made restarts harmless.`,
  fu: [r`When is auto-ack acceptable?`, r`What is the risk of {{multiple: true}} with concurrent handlers?`],
  pit: [r`Acking before the database commit.`, r`Trusting {{Redelivered}} as the only duplicate check.`] },

{ id: 'q5', level: 'Basic', tags: ['durability', 'persistence'],
  q: r`After a broker restart, messages are gone. Explain RabbitMQ's durability settings and how to make a message survive a restart and a node loss.`,
  a: r`Three **independent** settings all have to be right — and they protect different things:

1. **Durable exchange** — the exchange definition (and its bindings) survives restart. A transient exchange vanishes, bindings with it, and publishes are dropped as unroutable.
2. **Durable queue** — the queue definition survives restart. A non-durable queue is deleted with its contents.
3. **Persistent message** — {{DeliveryMode = Persistent}} (2). A transient message in a durable classic queue may be lost on restart.

Durability only covers **restart**. A **node loss** (disk gone, VM terminated) still loses data on a single-node classic queue. For that you need **replication**: **quorum queues** (Raft, replicated to a majority before confirm) — classic mirrored queues were removed in RabbitMQ 4.0. Quorum queues are always durable and always persist messages.

And durability only covers messages the broker **accepted**. A message lost between publisher and broker is a publisher-side problem solved with **publisher confirms** (q6). The complete chain is: confirms + durable topology + persistent messages + quorum queues + manual consumer acks.

**Cost:** persistence means fsync and disk I/O; quorum queues add a replication round trip. For genuinely disposable data (telemetry, cache invalidations) transient messages on classic queues are legitimate — make it an explicit decision.`,
  code: r`~~~csharp
await channel.ExchangeDeclareAsync("payments", ExchangeType.Topic, durable: true, autoDelete: false);
await channel.QueueDeclareAsync("ledger", durable: true, exclusive: false, autoDelete: false,
    arguments: new Dictionary<string, object?> { ["x-queue-type"] = "quorum" });   // replicated (Raft)

var props = new BasicProperties
{
    DeliveryMode = DeliveryModes.Persistent,      // 2
    MessageId = cmd.Id.ToString(),
    ContentType = "application/json"
};
await channel.BasicPublishAsync("payments", "payments.eu.captured.v1", mandatory: true, props, body);
~~~`,
  pts: [r`Durable exchange, durable queue and persistent message are separate settings.`, r`Durability survives restart; replication (quorum queues) survives node loss.`, r`Confirms cover the publisher-to-broker hop.`, r`Mirrored classic queues were removed in 4.0.`, r`Transient messages are a deliberate choice for disposable data.`],
  ex: r`A settlement queue declared durable but published with default (transient) properties lost a night's instructions in a patching restart; the fix was persistent delivery plus quorum queues.`,
  fu: [r`Is a quorum queue's message persistent even if the publisher marks it transient?`, r`What does an fsync cost at 5,000 msg/s?`],
  pit: [r`Believing durable queue alone means durable messages.`, r`Equating restart durability with node-loss durability.`] },

{ id: 'q6', level: 'Basic', tags: ['publisher-confirms', 'reliability'],
  q: r`What are publisher confirms, why are they preferred over AMQP transactions, and how do you publish reliably from .NET?`,
  a: r`By default **{{basic.publish}} is fire-and-forget**: the call returns when the bytes are in the client's socket buffer. A broker crash, a network drop or a full disk alarm can lose the message with no error.

**Publisher confirms** ({{confirm.select}}) make the broker acknowledge each publish:
- **ack** once the message is routed and, for persistent messages to durable queues, written to disk — for quorum queues, accepted by a **majority** of replicas;
- **nack** if the broker could not take responsibility (internal error, {{reject-publish}} overflow);
- confirms are asynchronous and can cover many messages ({{multiple}}), so throughput stays high.

**AMQP transactions** ({{tx.select}}/{{tx.commit}}) give similar safety but are synchronous and commonly 100x+ slower. Use confirms.

**Unroutable messages** are *confirmed* (the broker did its job — routed to nobody). Detect them with {{mandatory: true}}: the broker returns the message ({{basic.return}}) before the confirm. In Client 7 with tracking enabled, the publish task throws ({{PublishException}}, with {{IsReturn}} for returns) on nack or return.

**Reliable publish recipe:**
1. confirms on the channel; await (or batch-await) each publish with a timeout;
2. {{mandatory: true}} or an alternate exchange;
3. retry on nack/timeout/connection loss — which can **duplicate**, so set a stable {{MessageId}} for consumer dedupe;
4. tie the publish to the business commit with a **transactional outbox** (q20); confirms alone do not solve dual writes.

**Throughput:** awaiting each confirm serially gives one round trip per message (~1–2k msg/s on a LAN). Keep a bounded number in flight (Client 7 exposes a rate limiter for outstanding confirms) or publish a batch and await the batch.`,
  code: r`~~~csharp
await using var ch = await conn.CreateChannelAsync(new CreateChannelOptions(
    publisherConfirmationsEnabled: true, publisherConfirmationTrackingEnabled: true));

var pending = new List<ValueTask>();
foreach (var evt in batch)                        // e.g. 200 rows from the outbox
{
    var props = new BasicProperties { MessageId = evt.Id.ToString(), DeliveryMode = DeliveryModes.Persistent };
    pending.Add(ch.BasicPublishAsync("payments", evt.RoutingKey, mandatory: true, props, evt.Body));
}
try
{
    foreach (var p in pending) await p;           // completes on broker ack
    await outbox.MarkPublishedAsync(batch);       // only after confirms
}
catch (PublishException ex)                       // nack or basic.return (ex.IsReturn)
{
    logger.LogWarning(ex, "Publish failed; batch stays in outbox and will be retried");
}
~~~`,
  dia: r`sequenceDiagram
  participant App as Outbox relay
  participant B as Broker
  participant R as Quorum replicas
  App->>B: publish m1..m200 (mandatory)
  B->>R: replicate
  R-->>B: majority written
  B-->>App: basic.ack multiple up to 200
  App->>App: mark outbox rows published
  Note over App,B: nack, return or timeout -> rows stay unpublished -> retry later (duplicates possible)`,
  pts: [r`Plain publish is fire-and-forget.`, r`Confirms ack after persist/replicate; nack on failure.`, r`Unroutable messages are still confirmed — use mandatory or an alternate exchange.`, r`Prefer confirms over transactions for performance.`, r`Retries duplicate; stable MessageId plus idempotent consumers.`],
  ex: r`A broker failover during a deploy silently dropped about 0.1% of payment events from a fire-and-forget publisher; confirms plus the outbox reduced it to zero, verified by nightly reconciliation.`,
  fu: [r`Why is an unroutable message acked?`, r`How many confirms would you keep in flight?`],
  pit: [r`Thinking confirms solve the database-plus-broker dual write.`, r`Awaiting each confirm serially in a hot path.`] },

{ id: 'q7', level: 'Intermediate', tags: ['prefetch', 'qos', 'performance'],
  q: r`What does prefetch (basic.qos) control, how do you choose a value, and what goes wrong at both extremes?`,
  a: r`RabbitMQ **pushes** messages to consumers. {{basic.qos(prefetchCount)}} caps **unacknowledged deliveries per consumer** (with {{global: false}}, the usual setting). It is simultaneously:
- **flow control** — a slow consumer is not flooded;
- **fair dispatch** — the broker gives work to whoever has free slots instead of strict round-robin;
- a **latency buffer** — messages are already in the client while the previous one is processed.

**Choosing a value — use Little's law.** To keep a consumer busy you need enough messages in flight to cover the round trip:
- prefetch ≈ (network round trip + processing time) / processing time, times the handler's concurrency.
- Example: 2 ms round trip, 20 ms processing, sequential handler → (2+20)/20 ≈ 1.1, so 2–5 is plenty. Fast 0.5 ms handlers with 1 ms RTT → around 3–10 per concurrent slot; batch handlers that process 100 at a time need prefetch ≥ 100.

**Extremes:**
- **Unlimited (0)** — the broker dumps the whole queue into one consumer's memory; other consumers idle; a crash triggers a mass redelivery; client OOM is possible.
- **1** — strict fairness but one round trip per message, so throughput collapses on high-latency links.
- **Too high with slow handlers** — messages sit in one client for minutes, may hit {{consumer_timeout}}, and starve newly scaled-out consumers (autoscaling looks broken).

In .NET 7.x, {{ConsumerDispatchConcurrency}} lets one channel process several deliveries concurrently; prefetch must be at least that number, and you lose per-queue ordering. Typical production starting points: 10–50, tuned by measuring throughput, consumer utilisation (the management UI shows it) and memory.`,
  code: r`~~~csharp
var factory = new ConnectionFactory { Uri = uri, ConsumerDispatchConcurrency = 8 };   // 8 handlers in parallel per channel
await using var conn = await factory.CreateConnectionAsync();
await using var ch = await conn.CreateChannelAsync();
await ch.BasicQosAsync(prefetchSize: 0, prefetchCount: 32, global: false);           // >= concurrency, with headroom
// Little's law check: RTT 2 ms, handler 40 ms -> (2 + 40) / 40 = ~1.05 per slot -> 8 slots * 2-4 = 16-32
~~~`,
  pts: [r`Prefetch caps unacked deliveries per consumer.`, r`It provides flow control and fair dispatch.`, r`Size by (RTT + processing) / processing times concurrency.`, r`Unlimited hoards and risks OOM; 1 is latency-bound.`, r`Measure consumer utilisation, not guesses.`],
  ex: r`Scaling a KYC document consumer from 2 to 10 pods did nothing because prefetch was 1,000 and the first two pods held the whole backlog; prefetch 10 spread work immediately.`,
  fu: [r`What is consumer utilisation in the management UI?`, r`How does prefetch interact with {{consumer_timeout}}?`],
  pit: [r`Leaving prefetch unlimited.`, r`Concurrency higher than prefetch, which leaves handlers idle.`] },

{ id: 'q8', level: 'Intermediate', tags: ['dlx', 'dead-letter'],
  q: r`When is a message dead-lettered, what does the x-death header contain, and how do you configure dead-lettering — arguments or policies?`,
  a: r`A queue with a **dead-letter exchange** (DLX) republishes a message to that exchange when:
1. it is **rejected or nacked with {{requeue=false}}**;
2. its **TTL expires** (per-queue {{x-message-ttl}} or per-message {{expiration}});
3. the queue's **length limit** is exceeded with {{overflow: drop-head}} (the head is dead-lettered) or {{reject-publish-dlx}};
4. a quorum queue's **delivery limit** is exceeded (poison protection; since RabbitMQ 4.0 quorum queues default to a delivery limit of 20).

The dead-lettered copy keeps its body and properties, gets the dead-letter routing key if configured (otherwise its original key), and an **{{x-death}}** header array with one entry per (queue, reason): {{queue}}, {{reason}} ({{rejected}}, {{expired}}, {{maxlen}}, {{delivery_limit}}), {{count}}, {{exchange}}, {{routing-keys}}, {{time}}. Use {{count}} to drive retry limits and the original queue to drive redrive.

**Arguments vs policies:** {{x-dead-letter-exchange}} as a queue argument is fixed at declaration — changing it means deleting the queue. A **policy** (regex on queue names) can be changed at runtime and applied to many queues. Prefer **policies** for DLX, TTL, length limits and delivery limits; keep arguments for things that must be fixed, like {{x-queue-type}}. Arguments take precedence over policies, which surprises teams that mix both.

**Safety:** quorum queues support **at-least-once dead-lettering** ({{dead-letter-strategy: at-least-once}}, requires {{overflow: reject-publish}}); the default is at-most-once — the DLX publish is not confirmed, so a dead-lettered message can be lost if the target is unavailable.`,
  code: r`~~~bash
# Policy: all ledger queues dead-letter to payments.dlx, at-least-once, delivery limit 5
rabbitmqctl set_policy -p payments ledger-dlx "^ledger(\..+)?$" \
  '{"dead-letter-exchange":"payments.dlx","dead-letter-strategy":"at-least-once","overflow":"reject-publish","delivery-limit":5}' \
  --apply-to queues --priority 10

rabbitmqctl list_queues -p payments name policy messages_ready messages_unacknowledged
~~~`,
  pts: [r`Triggers: reject/nack without requeue, TTL expiry, length overflow, delivery limit.`, r`{{x-death}} records queue, reason, count, exchange and keys.`, r`Prefer policies for mutable settings; arguments override policies.`, r`Quorum queues offer at-least-once dead-lettering.`, r`Since 4.0 quorum queues default to delivery limit 20.`],
  ex: r`A bank changed its DLX target across 140 queues with one policy update instead of 140 delete-and-recreate operations.`,
  fu: [r`Why does at-least-once dead-lettering need reject-publish overflow?`, r`How would you route dead letters back to their source queue?`],
  pit: [r`Hard-coding DLX in queue arguments and then needing to change it.`, r`Assuming dead-lettering itself can never lose a message.`] },

{ id: 'q9', level: 'Intermediate', tags: ['retry', 'backoff', 'dlx'],
  q: r`Design retries with exponential backoff in RabbitMQ without blocking consumers. Compare TTL retry queues, the delayed-message plugin and framework redelivery.`,
  a: r`**Never retry by sleeping in the handler** (holds a prefetch slot and a thread) or by **nack with requeue** (immediate hot loop that hammers a failing dependency).

**Option A — TTL retry queues (no plugin):**
- work queue {{ledger}} has DLX {{ledger.retry.x}};
- the consumer classifies the failure, then republishes to a retry tier ({{ledger.retry.10s}}, {{.1m}}, {{.10m}}) and acks the original (or nacks so the DLX moves it);
- each retry queue has {{x-message-ttl}} and dead-letters back to the work queue when the TTL expires;
- attempts are counted from {{x-death}} or a custom header; after N, publish to {{ledger.parking}} (the DLQ) and alert.
Use **one queue per delay tier**: per-message TTL only expires messages at the *head* of a queue, so mixed delays in one queue block each other.

**Option B — delayed-message exchange plugin** ({{x-delayed-message}} exchange, {{x-delay}} header): simple and arbitrary delays, but delayed messages live on **one node** and are **not replicated**; unsuitable for very large volumes or long delays, and lost if that node is lost. Note: it is a community plugin, not part of the core broker.

**Option C — framework redelivery** (MassTransit {{UseMessageRetry}} for immediate in-memory retries plus {{UseDelayedRedelivery}} for second-level retries; NServiceBus recoverability): same mechanism, standardised across teams, with error queues and headers built in.

**Classification is the real design:** transient (timeouts, 503, deadlocks) → retry with backoff and jitter; permanent (validation, unknown account) → straight to parking with the reason; unknown → limited retries. Retries **reorder** messages; if order matters, park the key, not just the message (q19).`,
  code: r`~~~csharp
static readonly (string Queue, int Ms)[] Tiers = [("ledger.retry.10s", 10_000), ("ledger.retry.1m", 60_000), ("ledger.retry.10m", 600_000)];

foreach (var (q, ms) in Tiers)
    await ch.QueueDeclareAsync(q, durable: true, exclusive: false, autoDelete: false, arguments: new Dictionary<string, object?>
    {
        ["x-queue-type"] = "quorum",
        ["x-message-ttl"] = ms,
        ["x-dead-letter-exchange"] = "",          // default exchange
        ["x-dead-letter-routing-key"] = "ledger"  // back to the work queue when the delay ends
    });

async Task RetryOrParkAsync(BasicDeliverEventArgs ea, Exception ex)
{
    int attempt = ea.BasicProperties.Headers?.TryGetValue("x-attempt", out var a) == true ? Convert.ToInt32(a) : 0;
    var props = new BasicProperties(ea.BasicProperties) { Headers = new Dictionary<string, object?>(ea.BasicProperties.Headers ?? new Dictionary<string, object?>()) };
    props.Headers["x-attempt"] = attempt + 1;
    props.Headers["x-last-error"] = ex.GetType().Name;
    var target = attempt < Tiers.Length && IsTransient(ex) ? Tiers[attempt].Queue : "ledger.parking";
    await pubCh.BasicPublishAsync("", target, mandatory: true, props, ea.Body);   // confirmed channel
    await ch.BasicAckAsync(ea.DeliveryTag, false);                               // ack only after the retry copy is confirmed
}
~~~`,
  dia: r`flowchart LR
  W[(ledger)] --> C[Consumer]
  C -->|transient, attempt 1| R1[(retry.10s TTL)]
  C -->|transient, attempt 2| R2[(retry.1m TTL)]
  C -->|transient, attempt 3| R3[(retry.10m TTL)]
  R1 -->|TTL expired, DLX| W
  R2 -->|TTL expired, DLX| W
  R3 -->|TTL expired, DLX| W
  C -->|permanent or attempts exhausted| P[(ledger.parking DLQ)]
  P --> O[Ops: alert, inspect, redrive]`,
  pts: [r`No sleeping handlers, no requeue loops.`, r`One TTL queue per delay tier, dead-lettering back to the work queue.`, r`Delayed-message plugin is single-node and unreplicated.`, r`Classify transient vs permanent; park permanent failures immediately.`, r`Retries reorder messages.`],
  ex: r`During a core-banking outage, a three-tier backoff (10 s / 1 min / 10 min) let 40,000 postings drain automatically after recovery instead of flooding the core with requeue loops.`,
  fu: [r`Why can per-message TTL in one shared retry queue block?`, r`Where does jitter go in a queue-based backoff?`],
  pit: [r`{{BasicNack(requeue: true)}} as a retry strategy.`, r`Acking the original before the retry copy is confirmed.`] },

{ id: 'q10', level: 'Intermediate', tags: ['queue-types', 'quorum', 'streams'],
  q: r`Compare classic queues, quorum queues and streams. Which do you pick for payments commands, cache invalidation and an audit feed that needs replay?`,
  a: r`| | Classic | Quorum | Stream |
|---|---|---|---|
| Storage | single node | Raft-replicated (3 or 5) | replicated append-only log |
| Consumption | destructive (ack deletes) | destructive | **non-destructive**, by offset |
| Data safety on node loss | lost | safe with majority | safe with majority |
| Poison handling | none built-in | delivery limit | n/a (consumers track offset) |
| Priorities | up to 255 levels (keep ≤ 10) | two levels (normal/high) since 4.0 | no |
| Non-durable/exclusive | yes | no (always durable) | no |
| Best for | transient, temporary, reply queues | business messages, HA | fan-out, replay, huge backlogs |

**Choices:**
- **Payments commands** → **quorum**: data safety on node loss, delivery limit for poison messages, at-least-once dead-lettering.
- **Cache invalidation** → **classic, non-durable, exclusive/auto-delete per instance** bound to a fanout: losing one is harmless, and quorum overhead buys nothing.
- **Audit feed with replay** → **stream** (or Kafka if this is the dominant workload): consumers can attach at {{first}}, a timestamp or an offset; retention by size/age.

**Quorum queue costs:** every message is written on a majority; memory and disk per replica; more network. They need a 3+ node cluster (odd size). Classic mirrored queues are **gone in 4.0**, so "HA classic" is no longer an option.

**Streams caveats:** retention is by size/time, not consumption, so a stream is not a work queue — there are no competing consumers per message, except via **Super Streams** (partitioned streams with single active consumer per partition).`,
  code: r`~~~csharp
// payments commands: quorum
await ch.QueueDeclareAsync("payments.commands", true, false, false,
    new Dictionary<string, object?> { ["x-queue-type"] = "quorum", ["x-quorum-initial-group-size"] = 3 });

// cache invalidation: server-named exclusive classic queue per instance
var q = await ch.QueueDeclareAsync(queue: "", durable: false, exclusive: true, autoDelete: true);
await ch.QueueBindAsync(q.QueueName, "cache.invalidate", "");

// audit: stream with 30-day / 200 GB retention
await ch.QueueDeclareAsync("audit.payments", true, false, false, new Dictionary<string, object?>
{ ["x-queue-type"] = "stream", ["x-max-age"] = "30D", ["x-max-length-bytes"] = 200_000_000_000L });
~~~`,
  pts: [r`Classic = single node; quorum = Raft replicated; stream = replayable log.`, r`Quorum for business-critical messages; delivery limit for poison.`, r`Classic exclusive queues for transient per-instance needs.`, r`Streams for replay and fan-out, not work distribution.`, r`Mirrored classic queues were removed in 4.0.`],
  ex: r`A broker estate moved 600 mirrored queues to quorum queues ahead of 4.0 and simultaneously moved per-pod cache queues to transient classic, cutting replication traffic by a third.`,
  fu: [r`Why can't a quorum queue be exclusive?`, r`When would you use RabbitMQ Streams instead of Kafka?`],
  pit: [r`Quorum queues for short-lived reply queues.`, r`Treating a stream like a work queue.`] },

{ id: 'q11', level: 'Intermediate', tags: ['unroutable', 'mandatory', 'alternate-exchange'],
  q: r`How do you make sure messages that match no binding are not silently lost? Compare mandatory/returns with alternate exchanges.`,
  a: r`An exchange that finds **no matching binding** drops the message, and with confirms it still **acks** — the broker did what it was asked. Causes in practice: a consumer team deleted its queue, a typo in a routing key, a new event version nobody binds yet, a topology deployment out of order.

**mandatory + basic.return:**
- the publisher sets {{mandatory: true}}; if unroutable, the broker sends {{basic.return}} (reply code 312 NO_ROUTE) **before** the confirm;
- the producer learns synchronously and can fail the request, retry later or log;
- downside: every producer must handle returns correctly.

**Alternate exchange (AE):**
- declared on the exchange ({{alternate-exchange}} argument or policy); unroutable messages go to the AE — typically a fanout to an {{unrouted}} queue;
- centrally enforced, no producer code; operations alert when {{unrouted}} depth > 0;
- if the message reaches the AE, it is considered routed, so {{mandatory}} does not fire.

**Recommendation:** both, for different purposes. An **AE on every domain exchange via policy** as the safety net and audit trail; **mandatory** in producers where a missing route must fail the business operation (a payment command with no worker is an incident, not a log line). And treat topology as code (q47) so bindings exist before producers deploy.`,
  code: r`~~~csharp
await ch.ExchangeDeclareAsync("payments.unrouted", ExchangeType.Fanout, durable: true);
await ch.QueueDeclareAsync("payments.unrouted", true, false, false,
    new Dictionary<string, object?> { ["x-queue-type"] = "quorum" });
await ch.QueueBindAsync("payments.unrouted", "payments.unrouted", "");

await ch.ExchangeDeclareAsync("payments", ExchangeType.Topic, durable: true,
    arguments: new Dictionary<string, object?> { ["alternate-exchange"] = "payments.unrouted" });

// Producer that must fail loudly instead (exchange without AE):
try { await confirmedCh.BasicPublishAsync("payments.commands", "ledger.post", mandatory: true, props, body); }
catch (PublishException ex) when (ex.IsReturn) { throw new InvalidOperationException("No consumer bound for ledger.post"); }
~~~`,
  pts: [r`Unroutable messages are dropped yet confirmed.`, r`mandatory returns the message to the publisher (312 NO_ROUTE).`, r`Alternate exchanges catch unroutable messages centrally.`, r`AE delivery counts as routed, so mandatory does not fire.`, r`Alert on unrouted depth; deploy topology before producers.`],
  ex: r`A routing-key typo ({{payment.}} vs {{payments.}}) went unnoticed for two days until an alternate exchange was added; the next typo paged within minutes.`,
  fu: [r`How does a return interact with a confirm?`, r`How do you apply an AE to 50 exchanges?`],
  pit: [r`Assuming an ack means "a consumer will see it".`] },

{ id: 'q12', level: 'Intermediate', tags: ['patterns', 'competing-consumers'],
  q: r`Explain the work-queue (competing consumers) pattern. How does RabbitMQ distribute work, and how do you scale consumers safely in Kubernetes?`,
  a: r`**Competing consumers:** many consumer instances subscribe to **one queue**; each message goes to exactly one of them. It gives load balancing, horizontal scale and resilience (a dead instance's unacked messages go to the others).

**Distribution:** the queue round-robins deliveries among consumers that have **free prefetch slots**. With prefetch set sensibly, a slow consumer naturally gets less work. **Consumer priorities** ({{x-priority}} consumer argument) can prefer local or bigger consumers.

**What you give up:** ordering across messages (two consumers process in parallel) and the ability to assume a single processor — handlers must be idempotent and avoid in-memory state.

**Scaling in Kubernetes:**
- autoscale on **queue depth and message age**, not CPU: KEDA's RabbitMQ scaler on {{QueueLength}} or {{MessageRate}};
- cap max replicas by the **downstream** capacity (DB connections, PSP rate limits) — scaling consumers beyond what the database can take moves the queue into the database;
- graceful shutdown: on SIGTERM stop consuming ({{BasicCancel}}), finish in-flight, ack, close (q36); set {{terminationGracePeriodSeconds}} above the longest handler;
- keep prefetch low enough that new pods actually receive work.

**Throughput ceiling:** a single queue is one Erlang process on one leader node — tens of thousands of small messages per second at best. Beyond that, shard into several queues (q31).`,
  code: r`~~~yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: ledger-consumer }
spec:
  scaleTargetRef: { name: ledger-consumer }
  minReplicaCount: 2
  maxReplicaCount: 12          # bounded by ledger DB connection pool, not by queue depth
  triggers:
    - type: rabbitmq
      metadata:
        protocol: amqp
        queueName: ledger
        mode: QueueLength
        value: "200"           # target ready messages per replica
      authenticationRef: { name: rabbitmq-auth }
~~~`,
  dia: r`flowchart LR
  P1[API pod] --> X{{payments exchange}}
  P2[API pod] --> X
  X --> Q[(ledger queue)]
  Q -->|prefetch 20| C1[consumer pod 1]
  Q -->|prefetch 20| C2[consumer pod 2]
  Q -->|prefetch 20| C3[consumer pod 3]
  K[KEDA scaler] -.->|reads depth| Q
  K -.->|scales| C3
  C1 --> DB[(Ledger DB)]
  C2 --> DB
  C3 --> DB`,
  pts: [r`Many consumers, one queue, each message to one consumer.`, r`Dispatch respects free prefetch slots.`, r`No ordering across consumers; idempotent stateless handlers.`, r`Autoscale on depth/age, cap by downstream capacity.`, r`One queue has a throughput ceiling; shard beyond it.`],
  ex: r`KEDA scaled a statement-generation queue from 2 to 30 pods at month end; capping at 12 kept the reporting database below 70% CPU.`,
  fu: [r`What metric best predicts SLA breach: depth or age?`, r`How do consumer priorities work?`],
  pit: [r`Autoscaling on CPU for I/O-bound consumers.`, r`Unbounded max replicas that overload the database.`] },

{ id: 'q13', level: 'Intermediate', tags: ['pub-sub', 'topology', 'naming'],
  q: r`Design a publish/subscribe topology for domain events consumed by several services. How do you name exchanges and queues, and who owns what?`,
  a: r`**Pattern:** one **topic exchange per producing domain** (owned by the producer), and **one queue per consuming service per purpose** (owned by the consumer), each bound with the keys that service cares about.

- {{payments}} (topic, owned by Payments) — routing keys {{payments.<region>.<event>.v<n>}}.
- {{ledger.payments-events}} (quorum queue, owned by Ledger) bound to {{payments.*.captured.v1}} and {{payments.*.refunded.v1}}.
- {{notifications.payments-events}} owned by Notifications, bound to {{payments.#}}.

**Why a queue per consumer service:** each service gets its own copy, its own backlog, its own DLQ and its own scaling. Two services sharing one queue are competing consumers and would *split* the events between them — a classic mistake.

**Ownership rules (write them down):**
- producers own exchanges and the **event contract** (schema + routing keys); they must not create consumer queues;
- consumers own their queues, bindings, DLQ and retry tiers;
- naming: {{<consumer-service>.<source>[.<purpose>]}} for queues, {{<domain>}} for exchanges, {{<queue>.dlq}}/{{<queue>.retry.<delay>}} for recovery queues;
- permissions enforce it: a service's user can configure only names matching its own prefix (q29).

**Versioning:** add {{.v2}} keys alongside {{.v1}}; consumers migrate their bindings; the producer publishes both until the last v1 binding is gone (visible in the management API).`,
  code: r`~~~csharp
// Consumer-side topology, declared by the Ledger service at startup (idempotent declarations)
const string Q = "ledger.payments-events";
await ch.QueueDeclareAsync(Q, true, false, false, new Dictionary<string, object?> { ["x-queue-type"] = "quorum" });
foreach (var key in new[] { "payments.*.captured.v1", "payments.*.refunded.v1" })
    await ch.QueueBindAsync(Q, exchange: "payments", routingKey: key);
await ch.QueueDeclareAsync(Q + ".dlq", true, false, false, new Dictionary<string, object?> { ["x-queue-type"] = "quorum" });
// DLX itself applied by policy "^ledger\." -> keeps topology changes out of code
~~~`,
  dia: r`flowchart LR
  PAY[Payments service] --> X{{payments - topic}}
  X -->|payments.*.captured.v1| L[(ledger.payments-events)]
  X -->|payments.#| N[(notifications.payments-events)]
  X -->|payments.eu.#| A[(audit-eu.payments-events)]
  L --> LS[Ledger service]
  N --> NS[Notification service]
  A --> AS[EU audit service]`,
  pts: [r`One exchange per producing domain; one queue per consuming service.`, r`Sharing a queue between services splits events between them.`, r`Producers own exchanges and contracts; consumers own queues and DLQs.`, r`Naming conventions plus permission regexes enforce ownership.`, r`Version via new routing keys published in parallel.`],
  ex: r`Two teams shared {{payment-events}} and each saw roughly half the events; the fix was a queue per service and a naming rule enforced by vhost permissions.`,
  fu: [r`How do you know when the last v1 consumer has migrated?`, r`Should consumers declare exchanges?`],
  pit: [r`Several services consuming from one queue expecting a copy each.`] },

{ id: 'q14', level: 'Intermediate', tags: ['rpc', 'request-reply'],
  q: r`How do you implement request/reply (RPC) over RabbitMQ, and when should you refuse to?`,
  a: r`**Mechanics:**
- the client sets {{ReplyTo}} and a unique {{CorrelationId}} on the request;
- the server processes and publishes the reply to the default exchange with routing key = {{ReplyTo}} and the same {{CorrelationId}};
- the client matches replies by correlation id and enforces a **timeout**.

**Reply queue options:**
- **Direct reply-to** ({{amq.rabbitmq.reply-to}}): a pseudo-queue, no declaration, very cheap; the client must consume from it with **auto-ack before publishing**, on the same channel; replies are lost if the client goes away.
- An **exclusive auto-delete** queue per client instance — more overhead, survives slow replies within the connection's life.
- Never a per-request queue: queue creation churn hurts the broker.

**Set an {{expiration}}** on requests so stale requests (a price quote nobody waits for any more) are discarded instead of processed after the caller timed out.

**When to refuse:** RPC over a broker hides synchronous coupling: the caller still waits, and now has two hops, a timeout that does not cancel the server, and harder tracing. If the caller needs an answer now, use **HTTP/gRPC** with deadlines. Messaging RPC is reasonable when the server must sit behind a firewall that only allows outbound broker connections, or when requests must queue during server restarts and callers can tolerate it.`,
  code: r`~~~csharp
private readonly ConcurrentDictionary<string, TaskCompletionSource<byte[]>> _pending = new();

public async Task InitAsync()
{
    var replies = new AsyncEventingBasicConsumer(_ch);
    replies.ReceivedAsync += (_, ea) =>
    {
        if (ea.BasicProperties.CorrelationId is { } id && _pending.TryRemove(id, out var tcs)) tcs.TrySetResult(ea.Body.ToArray());
        return Task.CompletedTask;
    };
    await _ch.BasicConsumeAsync("amq.rabbitmq.reply-to", autoAck: true, consumer: replies);   // before any publish
}

public async Task<byte[]> CallAsync(byte[] request, TimeSpan timeout, CancellationToken ct)
{
    var id = Guid.NewGuid().ToString("N");
    var tcs = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
    _pending[id] = tcs;
    var props = new BasicProperties { CorrelationId = id, ReplyTo = "amq.rabbitmq.reply-to", Expiration = ((int)timeout.TotalMilliseconds).ToString() };
    await _ch.BasicPublishAsync("", "fx.quote.requests", mandatory: true, props, request, ct);
    try { return await tcs.Task.WaitAsync(timeout, ct); }
    finally { _pending.TryRemove(id, out _); }
}
~~~`,
  pts: [r`ReplyTo + CorrelationId + client timeout.`, r`Direct reply-to is cheapest: consume with auto-ack before publishing.`, r`Never one queue per request.`, r`Set expiration so stale requests are skipped.`, r`Prefer HTTP/gRPC unless there is a real reason.`],
  ex: r`An FX quoting engine behind a one-way firewall served quotes via RabbitMQ RPC with a 2 s expiration, so quotes were never priced after the client had given up.`,
  fu: [r`Why must the reply-to consumer exist before publishing?`, r`How do you trace an RPC across the broker?`],
  pit: [r`No timeout, leaking pending requests.`, r`Using RPC to make an asynchronous architecture "feel" synchronous.`] },

{ id: 'q15', level: 'Intermediate', tags: ['ttl', 'length-limits', 'overflow'],
  q: r`Explain message TTL, queue TTL and length limits with overflow behaviours. How do you use them to protect the broker and the business?`,
  a: r`**Message TTL**
- per queue: {{x-message-ttl}} (or policy {{message-ttl}}); per message: {{expiration}} property (string, milliseconds). The lower wins.
- expired messages are discarded or dead-lettered. Classic queues expire only at the **head**, so a long-TTL message can shield short-TTL ones behind it.
- use for **staleness**: a quote valid for 5 s, a push notification irrelevant after 10 min.

**Queue TTL** ({{x-expires}}): deletes an **unused** queue (no consumers, no redeclare) after the period — cleanup for abandoned per-client queues.

**Length limits** ({{x-max-length}} messages, {{x-max-length-bytes}}) with {{x-overflow}}:
- {{drop-head}} (default) — drops or dead-letters the oldest; fine for "latest matters" data like telemetry;
- {{reject-publish}} — new publishes are **nacked** (with confirms), so producers see backpressure and the outbox holds the data; right for business messages;
- {{reject-publish-dlx}} — also dead-letters the rejected message (classic queues).

**Why limits matter:** an unbounded queue is a time bomb. A stopped consumer lets a queue grow until the node hits its **memory or disk alarm**, which **blocks every publisher on the node** — one team's dead consumer becomes a platform outage. A length limit converts that into a local, visible failure.

**Sizing:** limit = (expected peak backlog duration) × (publish rate) × safety factor, e.g. 2 h of outage × 50 msg/s × 2 ≈ 720,000 messages.`,
  code: r`~~~bash
# Business queues: bounded, push back on producers, dead-letter safely
rabbitmqctl set_policy -p payments bounded "^ledger\." \
  '{"max-length":720000,"overflow":"reject-publish","dead-letter-exchange":"payments.dlx"}' --apply-to queues

# Telemetry: keep only the newest 100k, drop the oldest silently
rabbitmqctl set_policy -p telemetry latest-only "^metrics\." '{"max-length":100000,"overflow":"drop-head","message-ttl":600000}' --apply-to queues
~~~`,
  pts: [r`Message TTL for staleness; queue TTL for cleanup of unused queues.`, r`Classic queues expire messages only at the head.`, r`drop-head for latest-wins data; reject-publish for business data.`, r`Unbounded queues end in node-wide alarms.`, r`Size limits from rate × tolerated outage × safety factor.`],
  ex: r`A dead analytics consumer once filled a node's disk and blocked payment publishers; after a 1 M message reject-publish limit, the same failure only paged the analytics team.`,
  fu: [r`What do publishers see when reject-publish triggers?`, r`Why is drop-head dangerous for commands?`],
  pit: [r`Unbounded queues for optional consumers.`, r`Mixing per-message TTLs in a classic queue.`] },

{ id: 'q16', level: 'Intermediate', tags: ['priority', 'queues'],
  q: r`How do priority queues work in RabbitMQ, and what problems do they cause in production?`,
  a: r`**Classic queues:** declare {{x-max-priority}} (1–255, recommend ≤ 10) and set {{Priority}} on messages. Internally the queue keeps a sub-queue per level, so each level costs memory and CPU; messages without a priority are treated as 0.

**Quorum queues (4.0+)** support **two** priority levels: priority 0–4 is normal, 5 and above is high; delivery is weighted (roughly two high per one normal) rather than strict, so normal messages are not starved.

**Production problems:**
- **Priority only applies to messages waiting in the queue.** With a large prefetch, low-priority messages are already sitting in consumers' buffers, so a newly arrived high-priority message waits behind them. Priority queues need **low prefetch** to mean anything.
- **Starvation** of low priority under constant high-priority load (classic, strict).
- **Hidden coupling**: priorities get inflated ("everything is high").

**Often better:** **separate queues** per class of service — {{payments.instant}} and {{payments.batch}} — with dedicated consumers and capacity. That gives isolation (a batch flood cannot touch instant payments), independent scaling and clear SLOs, which is what the business actually wants.`,
  code: r`~~~csharp
// Separate queues per class of service, rather than one priority queue
await ch.QueueBindAsync("payments.instant", "payments.commands", "payments.instant.*");
await ch.QueueBindAsync("payments.batch",   "payments.commands", "payments.batch.*");

// If a priority queue is truly needed (quorum, 4.0+):
var props = new BasicProperties { Priority = 9, DeliveryMode = DeliveryModes.Persistent };   // >= 5 -> high
await pub.BasicPublishAsync("payments.commands", "payments.instant.sepa", mandatory: true, props, body);
await consumerCh.BasicQosAsync(0, prefetchCount: 2, global: false);   // low prefetch so priority is honoured
~~~`,
  pts: [r`Classic: x-max-priority, keep levels ≤ 10.`, r`Quorum (4.0+): two levels, weighted not strict.`, r`High prefetch defeats priority.`, r`Strict priority can starve low-priority work.`, r`Separate queues per service class often beat priorities.`],
  ex: r`Instant payments shared a priority queue with nightly batch files and missed a 10 s SLA during batch runs; splitting the queues fixed it without touching priorities.`,
  fu: [r`Why does prefetch defeat priority?`, r`How would you guarantee capacity for instant payments?`],
  pit: [r`Prefetch 500 on a priority queue.`, r`Using 255 priority levels.`] },

{ id: 'q17', level: 'Intermediate', tags: ['masstransit', 'dotnet', 'outbox'],
  q: r`Configure MassTransit on RabbitMQ for a .NET service: consumers, retries, redelivery, the EF Core outbox and error queues. What does it create for you?`,
  a: r`MassTransit maps **message types to exchanges** and **endpoints to queues**:
- each message type gets a **fanout exchange** named after its type (for example {{Payments.Contracts:PaymentCaptured}});
- each receive endpoint gets a queue plus an exchange of the same name bound to the message-type exchanges it consumes;
- failures go to {{<queue>_error}} (with exception headers) and unconsumed types to {{<queue>_skipped}}.

**Retry layers:**
- {{UseMessageRetry}} — immediate/in-memory retries while holding the message (short transient blips; keep total time well below the consumer timeout);
- {{UseDelayedRedelivery}} — second-level retries that return the message to the broker with a delay (minutes), freeing the consumer;
- after both are exhausted → {{_error}} queue.

**Outbox (EF Core):**
- **bus outbox**: messages published from an API controller are written to the outbox table in the same {{SaveChanges}} transaction, then delivered by a background service — no dual writes;
- **consumer outbox / inbox**: messages published by a consumer are held until the consumer's transaction commits, and the inbox dedupes redelivered messages by message id.

**Trade-offs:** fast, consistent conventions across teams; but the topology is opinionated (many exchanges), behaviour is hidden in configuration, and **MassTransit v9 moved to a commercial licence** — v8 remains open source. Decide licensing explicitly.`,
  code: r`~~~csharp
builder.Services.AddMassTransit(x =>
{
    x.AddConsumer<PaymentCapturedConsumer, PaymentCapturedConsumerDefinition>();
    x.AddEntityFrameworkOutbox<LedgerDbContext>(o =>
    {
        o.UseSqlServer();
        o.UseBusOutbox();                                // API publishes go through the outbox
        o.DuplicateDetectionWindow = TimeSpan.FromDays(7);   // inbox dedupe
    });
    x.UsingRabbitMq((ctx, cfg) =>
    {
        cfg.Host(new Uri(builder.Configuration["Rabbit:Uri"]!));
        cfg.UseDelayedRedelivery(r => r.Intervals(TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(15)));
        cfg.UseMessageRetry(r => r.Exponential(3, TimeSpan.FromMilliseconds(200), TimeSpan.FromSeconds(5), TimeSpan.FromMilliseconds(200)));
        cfg.ConfigureEndpoints(ctx);
    });
});

public sealed class PaymentCapturedConsumerDefinition : ConsumerDefinition<PaymentCapturedConsumer>
{
    protected override void ConfigureConsumer(IReceiveEndpointConfigurator ep, IConsumerConfigurator<PaymentCapturedConsumer> c, IRegistrationContext ctx)
    {
        ep.PrefetchCount = 32;
        ep.UseEntityFrameworkOutbox<LedgerDbContext>(ctx);   // consumer outbox + inbox
        if (ep is IRabbitMqReceiveEndpointConfigurator rmq) rmq.SetQuorumQueue();
    }
}
~~~`,
  pts: [r`Message types become fanout exchanges; endpoints become queues.`, r`Immediate retry, then delayed redelivery, then _error.`, r`Bus outbox removes dual writes; consumer inbox dedupes.`, r`Set quorum queues and prefetch per endpoint.`, r`v9 is commercial; v8 is open source.`],
  ex: r`A team replaced 1,500 lines of hand-rolled retry, DLQ and outbox code with MassTransit configuration and a single EF migration.`,
  fu: [r`Where would you put a circuit breaker?`, r`How do you redrive messages from an _error queue?`],
  pit: [r`Long in-memory retries that exceed the consumer timeout.`, r`Ignoring the licensing change.`] },

{ id: 'q18', level: 'Intermediate', tags: ['idempotency', 'inbox', 'efcore'],
  q: r`At-least-once delivery means duplicates. Implement an idempotent RabbitMQ consumer in .NET with EF Core, and explain the edge cases.`,
  a: r`**Sources of duplicates:** publisher retries after a lost confirm, consumer crash after commit but before ack, channel closure with unacked messages, redrive from a DLQ, and upstream replays.

**Inbox pattern:** a table {{ProcessedMessages(Consumer, MessageId)}} with a unique key. In **one database transaction**: insert the inbox row, apply the business change, commit; then ack. A duplicate violates the unique key → treat as already processed → ack.

**Edge cases:**
- **The id must be stable across retries** — generate {{MessageId}} at the source (outbox row id), not at publish time.
- **Scope the key by consumer** — two consumers in the same database must not block each other.
- **Side effects outside the DB** (calling a PSP, sending email) are not covered by the transaction: pass an idempotency key downstream (for example the message id as the PSP's {{Idempotency-Key}}), or record "intent" and use a state machine.
- **Retention:** keep inbox rows at least as long as the maximum redelivery/replay window (days), then purge in batches.
- **Natural idempotency** is better when available: {{UPSERT}} by business key, "set status = Captured where status = Authorized" (a conditional update), or a version check.
- **Concurrent duplicates** (two consumers get copies simultaneously): the unique key makes the second transaction fail — catch the unique violation, not just a pre-check.`,
  code: r`~~~csharp
public async Task HandleAsync(PaymentCaptured evt, string messageId, CancellationToken ct)
{
    await using var tx = await _db.Database.BeginTransactionAsync(ct);
    _db.Inbox.Add(new InboxRow { Consumer = "ledger", MessageId = messageId, ProcessedAt = DateTime.UtcNow });
    _db.Postings.Add(Posting.From(evt));
    try
    {
        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }
    catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2627 or 2601 })   // unique violation
    {
        await tx.RollbackAsync(ct);
        _log.LogInformation("Duplicate {MessageId} ignored", messageId);   // already processed -> caller acks
    }
}
// modelBuilder.Entity<InboxRow>().HasKey(x => new { x.Consumer, x.MessageId });
~~~`,
  pts: [r`Duplicates come from publish retries, crashes before ack and redrives.`, r`Inbox row and business change in one transaction, then ack.`, r`Stable source-generated MessageId, scoped per consumer.`, r`External side effects need downstream idempotency keys.`, r`Rely on the unique constraint, not a pre-check.`],
  ex: r`A ledger consumer double-posted 17 entries after a broker failover; adding an inbox with a composite key made later failovers produce only "duplicate ignored" logs.`,
  fu: [r`How long do you keep inbox rows?`, r`How do you make an email send idempotent?`],
  pit: [r`Check-then-insert without a unique constraint.`, r`Generating MessageId at publish time, so retries get new ids.`] },

{ id: 'q19', level: 'Senior', tags: ['ordering', 'single-active-consumer', 'sharding'],
  q: r`A ledger requires per-account ordering, but one consumer cannot keep up. How do you get both ordering and parallelism in RabbitMQ?`,
  a: r`**Why order breaks:** a queue is FIFO, but with competing consumers two messages for the same account run in parallel; requeues and redeliveries also move messages; retries through delay queues re-enter later. RabbitMQ guarantees order only for one publisher → one queue → one consumer, without requeue.

**Partition by key:**
1. A **consistent-hash exchange** ({{x-consistent-hash}}, plugin bundled with the broker) hashes the routing key (account id) or a header onto N bound queues, weighted by the binding key.
2. Each shard queue {{ledger.shard.0..N-1}} has **Single Active Consumer** ({{x-single-active-consumer: true}}): many consumers attach for failover, but only one receives at a time.
3. Prefetch and concurrency per consumer must preserve order: process sequentially (or partition further in memory by account).
Different accounts proceed in parallel across shards; one account is always serialised.

**Alternatives:** **Super Streams** (partitioned streams with SAC per partition, built-in key routing) — closer to Kafka partitions; or an in-process **per-key mailbox** when the bottleneck is in one consumer.

**Failure handling must respect order:** a failing message cannot just go to a retry queue while later messages for the same account continue. Either block the shard (retry in place, with backoff, and alert) or **park the key**: record that the account is parked, divert its subsequent messages to the parking queue too, and replay in order after the fix.

**Resharding** changes the key mapping (consistent hashing limits movement, but some keys move): drain or pause, then change bindings.`,
  code: r`~~~csharp
await ch.ExchangeDeclareAsync("ledger.sharded", "x-consistent-hash", durable: true);
for (var i = 0; i < 8; i++)
{
    var q = $"ledger.shard.{i}";
    await ch.QueueDeclareAsync(q, true, false, false, new Dictionary<string, object?>
    {
        ["x-queue-type"] = "quorum",
        ["x-single-active-consumer"] = true
    });
    await ch.QueueBindAsync(q, "ledger.sharded", routingKey: "1");   // weight 1 per shard
}
// publish with routing key = account id -> same account always lands on the same shard
await pub.BasicPublishAsync("ledger.sharded", routingKey: posting.AccountId, mandatory: true, props, body);
~~~`,
  dia: r`flowchart LR
  P[Posting publisher] -->|key = accountId| H{{x-consistent-hash}}
  H --> S0[(shard 0 SAC)]
  H --> S1[(shard 1 SAC)]
  H --> S7[(shard 7 SAC)]
  S0 --> A0[active consumer]
  S0 -.standby.-> B0[standby consumer]
  S1 --> A1[active consumer]
  S7 --> A7[active consumer]`,
  pts: [r`Order holds only for a single consumer without requeues.`, r`Consistent-hash exchange shards by account id.`, r`Single Active Consumer per shard gives order plus failover.`, r`Failures must block or park the key, not skip ahead.`, r`Super Streams are the built-in partitioned alternative.`],
  ex: r`A card ledger moved from one queue at 900 msg/s to 16 hashed SAC shards at 11,000 msg/s with strict per-card order.`,
  fu: [r`What happens to in-flight order when the active consumer fails over?`, r`How do you reshard safely?`],
  pit: [r`Sending a failed message to a retry queue while later messages for the key proceed.`, r`ConsumerDispatchConcurrency > 1 on an ordered shard.`] },

{ id: 'q20', level: 'Senior', tags: ['outbox', 'dual-write', 'reliability'],
  q: r`Implement the transactional outbox with RabbitMQ in .NET. How does the relay publish safely, and what guarantees result?`,
  a: r`**Problem:** "save order, then publish event" is a **dual write**. Crash between them → event lost; publish first → event for a rolled-back order.

**Outbox:**
1. In the same DB transaction as the business change, insert an {{OutboxMessages}} row (id, type, routing key, payload, created_at, published_at null).
2. A **relay** (BackgroundService) polls unpublished rows in order, publishes them with **confirms** and {{mandatory}}, and marks them published **after** the confirm.
3. If the relay crashes after the confirm but before marking, the row is published again → **duplicates**; consumers dedupe by MessageId (= outbox row id).

**Relay details that interviewers probe:**
- **Concurrency:** several relay instances must not publish the same rows — use {{UPDLOCK, READPAST}} (SQL Server) or {{FOR UPDATE SKIP LOCKED}} (PostgreSQL), or a single leader.
- **Ordering:** with skip-locked parallel relays, order across rows is not guaranteed; if per-aggregate order matters, order by sequence and partition the relay by aggregate.
- **Batching:** publish 100–500 rows and await all confirms — throughput goes from ~1k to tens of thousands per second.
- **Latency:** poll interval (100–500 ms) or CDC (Debezium) instead of polling.
- **Cleanup:** purge published rows after N days; index on {{(PublishedAt, Id)}}.

**Guarantee:** at-least-once publication that is atomic with the business change; exactly-once *effect* only with idempotent consumers.`,
  code: r`~~~csharp
protected override async Task ExecuteAsync(CancellationToken ct)
{
    while (!ct.IsCancellationRequested)
    {
        await using var db = _dbFactory.CreateDbContext();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var batch = await db.Outbox
            .FromSqlRaw("SELECT TOP (200) * FROM OutboxMessages WITH (UPDLOCK, READPAST, ROWLOCK) WHERE PublishedAt IS NULL ORDER BY Id")
            .ToListAsync(ct);
        if (batch.Count == 0) { await tx.CommitAsync(ct); await Task.Delay(250, ct); continue; }

        var publishes = batch.Select(m => _ch.BasicPublishAsync(m.Exchange, m.RoutingKey, mandatory: true,
            new BasicProperties { MessageId = m.Id.ToString(), Type = m.Type, DeliveryMode = DeliveryModes.Persistent }, m.Payload, ct).AsTask());
        await Task.WhenAll(publishes);                    // confirms (throws on nack/return -> tx rolls back, rows retried)

        foreach (var m in batch) m.PublishedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }
}
~~~`,
  dia: r`sequenceDiagram
  participant API as Payments API
  participant DB as SQL Server
  participant R as Outbox relay
  participant B as RabbitMQ
  API->>DB: BEGIN, insert Payment and OutboxMessage, COMMIT
  R->>DB: select unpublished rows (UPDLOCK, READPAST)
  R->>B: publish batch (confirms, mandatory)
  B-->>R: acks
  R->>DB: set PublishedAt, COMMIT
  Note over R,B: crash after ack, before COMMIT -> republish -> consumer inbox dedupes`,
  pts: [r`Outbox row in the same transaction as the business change.`, r`Relay marks published only after confirms.`, r`Skip-locked or leader election for multiple relays.`, r`Batching for throughput; CDC for latency.`, r`At-least-once publish; consumers dedupe.`],
  ex: r`An order service lost about 40 events a month to dual writes; the outbox plus nightly reconciliation of orders versus events brought that to zero.`,
  fu: [r`Polling vs CDC for the relay?`, r`How do you preserve per-aggregate order with parallel relays?`],
  pit: [r`Marking rows published before the confirm.`, r`Holding the DB transaction open across slow publishes without a timeout.`] },

{ id: 'q21', level: 'Senior', tags: ['quorum-queues', 'raft', 'internals'],
  q: r`How do quorum queues work internally (Raft, leaders, majority writes), what do they cost, and how do you operate them?`,
  a: r`**Raft per queue:** each quorum queue is its own Raft group with a **leader** and followers on different nodes (initial group size usually 3, sometimes 5). Publishes go to the leader, which appends to its log and replicates; the message is **committed once a majority** has written it to disk, and only then is the publisher confirm sent. Consumers are served from the leader.

**Failure behaviour:**
- leader node lost → followers elect a new leader within seconds; committed messages survive; publishers/consumers reconnect (client recovery);
- **minority** of replicas available → the queue is **unavailable** (no writes, no reads) — Raft chooses consistency over availability;
- a lagging replica catches up from the leader's log or a snapshot.

**Costs:**
- every message written on 3 disks and sent over the network twice;
- memory: the log is kept until snapshots; very long queues with large messages increase disk and recovery time — keep queues short and use streams for large backlogs;
- per-queue Raft overhead: thousands of quorum queues are fine, hundreds of thousands are not.

**Operations:**
- odd cluster sizes (3, 5); replicas spread across AZs;
- **leader balance**: after restarts leaders cluster on surviving nodes → {{rabbitmq-queues rebalance quorum}};
- **membership**: {{rabbitmq-queues grow <node> all}} after adding a node; {{shrink}} before removing one;
- rolling upgrades with {{rabbitmq-upgrade drain}} (maintenance mode moves leaders away);
- monitor replica lag, leader distribution, Raft WAL/segment disk usage.`,
  code: r`~~~bash
rabbitmq-queues quorum_status ledger -p payments          # members, leader, commit index per replica
rabbitmq-queues check_if_node_is_quorum_critical          # would stopping this node lose a majority?
rabbitmq-upgrade drain                                    # maintenance mode before a rolling upgrade
# ... upgrade node ...
rabbitmq-upgrade revive
rabbitmq-queues rebalance quorum                          # spread leaders across nodes again
rabbitmq-queues grow rabbit@node-4 all                    # add replicas on a new node
~~~`,
  dia: r`sequenceDiagram
  participant P as Publisher
  participant L as Leader node-1
  participant F1 as Follower node-2
  participant F2 as Follower node-3
  P->>L: publish
  L->>L: append to log, fsync
  L->>F1: append entries
  L->>F2: append entries
  F1-->>L: written
  Note over L: majority 2 of 3 -> committed
  L-->>P: confirm ack
  F2-->>L: written later`,
  pts: [r`Each quorum queue is a Raft group; confirm after majority write.`, r`Minority partition makes the queue unavailable, not inconsistent.`, r`Costs: 3x disk writes, network, per-queue overhead.`, r`Keep quorum queues short; streams for big backlogs.`, r`Rebalance leaders, grow/shrink membership, drain before upgrades.`],
  ex: r`After an AZ outage all leaders ended up on two nodes, which then ran hot; a scheduled {{rebalance quorum}} after maintenance became part of the runbook.`,
  fu: [r`Why is a 2-node cluster a bad idea for quorum queues?`, r`What does {{check_if_node_is_quorum_critical}} protect against?`],
  pit: [r`Stopping two of three nodes for maintenance at once.`, r`Using quorum queues as multi-million-message storage.`] },

{ id: 'q22', level: 'Senior', tags: ['streams', 'super-streams', 'replay'],
  q: r`What are RabbitMQ Streams and Super Streams? How do you consume one from .NET, and when do they replace Kafka?`,
  a: r`A **stream** is a replicated, append-only log inside RabbitMQ. Messages are **not removed when consumed**; each consumer reads from an **offset** ({{first}}, {{last}}, {{next}}, a number or a timestamp), and retention is by size/age ({{x-max-length-bytes}}, {{x-max-age}}, split into segments).

**Two ways to consume:**
- **AMQP 0-9-1**: {{basic.consume}} with argument {{x-stream-offset}}; manual ack and a prefetch are **required** (acks act as flow control, not deletion). Simple, works with existing clients.
- **Stream protocol** (port 5552, {{RabbitMQ.Stream.Client}}): much higher throughput (batching, sub-entries, server-side offset tracking, deduplication for producers via publishing id).

**Super Streams** = a set of partition streams behind a direct exchange, routed by a hash of the key, with **single active consumer per partition** across a consumer group — effectively Kafka-style partitions inside RabbitMQ.

**When they fit:** you already run RabbitMQ, need replay/fan-out for a moderate number of consumers (audit, read-model rebuilds, late joiners), retention of days, and do not want another platform. **When Kafka still wins:** very high throughput across many teams, long retention with tiered storage, a big connector/stream-processing ecosystem (Kafka Connect, Streams, Flink), transactional read-process-write.

**Operational note:** streams store on disk and replicate like quorum queues; size retention explicitly or they fill disks.`,
  code: r`~~~csharp
// AMQP 0-9-1 consumption of a stream, replaying from 24 hours ago
await ch.BasicQosAsync(0, prefetchCount: 500, global: false);          // required for streams
var consumer = new AsyncEventingBasicConsumer(ch);
consumer.ReceivedAsync += async (_, ea) =>
{
    await readModel.ApplyAsync(ea.Body, ea.BasicProperties.Headers?["x-stream-offset"]);
    await ch.BasicAckAsync(ea.DeliveryTag, multiple: false);            // flow control, not deletion
};
await ch.BasicConsumeAsync("audit.payments", autoAck: false, consumerTag: "", noLocal: false, exclusive: false,
    arguments: new Dictionary<string, object?> { ["x-stream-offset"] = new AmqpTimestamp(DateTimeOffset.UtcNow.AddHours(-24).ToUnixTimeSeconds()) },
    consumer: consumer);
~~~`,
  pts: [r`Streams are replayable logs with offset-based, non-destructive reads.`, r`AMQP consumption needs manual ack and prefetch; the stream protocol is faster.`, r`Super Streams add Kafka-like partitions with SAC per partition.`, r`Good for replay and fan-out within an existing RabbitMQ estate.`, r`Kafka wins on scale, ecosystem and long retention.`],
  ex: r`A broker team rebuilt a reconciliation read model from a 14-day RabbitMQ stream after a bug fix, avoiding a new Kafka cluster for one use case.`,
  fu: [r`Where is a stream consumer's offset stored?`, r`How does producer deduplication work in streams?`],
  pit: [r`Unbounded stream retention.`, r`Expecting competing consumers on a plain stream.`] },

{ id: 'q23', level: 'Senior', tags: ['flow-control', 'alarms', 'backpressure'],
  q: r`Explain memory and disk alarms, credit-based flow control and blocked connections. How should a .NET publisher behave when the broker blocks it?`,
  a: r`**Alarms:**
- **memory high watermark** ({{vm_memory_high_watermark}}, default 0.6 of available RAM; often set absolute in containers) — when exceeded the node **blocks all publishing connections cluster-wide** until memory drops;
- **disk free limit** ({{disk_free_limit}}, default 50 MB — far too low for production; set e.g. 2–5 GB or a multiple of RAM) — same effect.
Consumers keep working (that is how the backlog drains); only publishes are blocked.

**Credit-based flow control:** inside the broker, each process grants credit to the one feeding it; a slow queue (disk, replication) back-pressures the channel and connection, which show state **flow**. Brief flow is normal; sustained flow means the queue is the bottleneck.

**What the client sees:** a {{connection.blocked}} notification, after which writes on that connection simply stall — {{BasicPublishAsync}} does not complete. In RabbitMQ.Client 7, subscribe to {{ConnectionBlockedAsync}}/{{ConnectionUnblockedAsync}}.

**Correct publisher behaviour:**
- **separate connections** for publishing and consuming, or a blocked publisher can stall the consumers that would drain memory;
- **timeouts** on publishes — never let HTTP requests hang behind a blocked connection;
- when blocked, **fail fast or buffer durably**: the outbox naturally absorbs it (rows stay unpublished); APIs that publish synchronously should return 503/202 rather than hang;
- expose a health signal ("broker blocked") for readiness and alerting.

**Root causes to fix:** unbounded queues, slow consumers, huge messages, too many connections/channels, lazy disk sizing.`,
  code: r`~~~csharp
var blocked = 0;
conn.ConnectionBlockedAsync += (_, e) => { Interlocked.Exchange(ref blocked, 1); _log.LogError("Broker blocked publishers: {Reason}", e.Reason); return Task.CompletedTask; };
conn.ConnectionUnblockedAsync += (_, _) => { Interlocked.Exchange(ref blocked, 0); return Task.CompletedTask; };

public async Task<bool> TryPublishAsync(ReadOnlyMemory<byte> body, BasicProperties props, CancellationToken ct)
{
    if (Volatile.Read(ref blocked) == 1) return false;                         // caller keeps it in the outbox
    using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
    cts.CancelAfter(TimeSpan.FromSeconds(5));                                   // never hang an HTTP request
    try { await _ch.BasicPublishAsync("payments", "payments.eu.captured.v1", true, props, body, cts.Token); return true; }
    catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return false; }
}
~~~`,
  pts: [r`Memory and disk alarms block all publishers on the cluster.`, r`Default disk_free_limit is unsafe for production.`, r`Credit flow back-pressures slow queues; sustained "flow" signals a bottleneck.`, r`Separate publish/consume connections; publish timeouts.`, r`Outbox absorbs blocking; never hang requests.`],
  ex: r`A payments API had 2,000 threads hung on a blocked connection during a memory alarm; publish timeouts and the outbox turned the next alarm into a few minutes of delayed events.`,
  fu: [r`Why does the consumer connection matter during an alarm?`, r`How would you set the watermark for a container with a 4 GB limit?`],
  pit: [r`One shared connection for publishing and consuming.`, r`Publishing synchronously in the request path without a timeout.`] },

{ id: 'q24', level: 'Senior', tags: ['recovery', 'resilience', 'dotnet'],
  q: r`How does automatic connection and topology recovery work in RabbitMQ.Client, and what still breaks during a broker failover?`,
  a: r`**Automatic recovery** (on by default) reconnects after a network failure or broker restart, every {{NetworkRecoveryInterval}}, then **recreates channels** and — with **topology recovery** — re-declares exchanges, queues and bindings the client declared, and re-registers consumers.

**What still breaks:**
- **In-flight unacked deliveries** are redelivered to someone else; acks for old delivery tags after recovery are invalid (tags restart on new channels) — the client guards against stale acks, but your handler must not assume its ack landed.
- **Unconfirmed publishes** at the moment of failure are in an unknown state: republish (duplicates) — the outbox handles this.
- **Server-named and exclusive queues** are recreated with *new* names; anything that stored the old name (a reply-to address) is stale.
- **Initial connection failure is not retried** by automatic recovery — wrap startup in your own retry (Polly) and fail readiness until connected.
- **Recovery can mask outages**: the app keeps trying while health checks say "healthy"; expose recovery state.
- **Channel-level errors** (404 queue not found, 406 precondition failed from a mismatched declaration) close the channel and are **not** recovered as network errors — they are bugs.
- With multiple broker hosts, provide all endpoints ({{AmqpTcpEndpoint}} list) or a load balancer so recovery can reach a healthy node.

**Pattern:** treat recovery as a convenience, not a guarantee; correctness comes from confirms, outbox, manual acks and idempotency.`,
  code: r`~~~csharp
var factory = new ConnectionFactory { AutomaticRecoveryEnabled = true, TopologyRecoveryEnabled = true, NetworkRecoveryInterval = TimeSpan.FromSeconds(5), ClientProvidedName = "ledger-consumer" };
var endpoints = new[] { new AmqpTcpEndpoint("rabbit-0.rabbit"), new AmqpTcpEndpoint("rabbit-1.rabbit"), new AmqpTcpEndpoint("rabbit-2.rabbit") };

var retry = new ResiliencePipelineBuilder().AddRetry(new RetryStrategyOptions
{ MaxRetryAttempts = 10, BackoffType = DelayBackoffType.Exponential, UseJitter = true, Delay = TimeSpan.FromSeconds(1) }).Build();

IConnection conn = await retry.ExecuteAsync(async ct => await factory.CreateConnectionAsync(endpoints, ct));   // first connect is on you
conn.ConnectionShutdownAsync += (_, e) => { _health.Degraded($"rabbit shutdown: {e.ReplyText}"); return Task.CompletedTask; };
conn.RecoverySucceededAsync += (_, _) => { _health.Healthy(); return Task.CompletedTask; };
~~~`,
  pts: [r`Recovery reconnects, recreates channels, redeclares topology and consumers.`, r`Unacked deliveries redeliver; unconfirmed publishes are unknown.`, r`Initial connection is not retried automatically.`, r`Server-named queues get new names after recovery.`, r`Channel exceptions (404/406) are bugs, not network failures.`],
  ex: r`A service that cached its server-named reply queue name silently lost all RPC replies after every broker restart until it re-read the name on recovery.`,
  fu: [r`What is a 406 PRECONDITION_FAILED on declare, and why is it common in migrations?`, r`How do you expose recovery state to Kubernetes?`],
  pit: [r`Assuming recovery gives exactly-once.`, r`No retry around the first connection.`] },

{ id: 'q25', level: 'Senior', tags: ['poison-messages', 'error-handling'],
  q: r`Design end-to-end poison-message handling: error classification, delivery limits, parking queues, alerting and redrive.`,
  a: r`### Classify every failure
| Class | Examples | Action |
|---|---|---|
| **Permanent** | deserialisation error, schema violation, unknown account | park immediately with reason; no retries |
| **Transient** | timeout, 503, deadlock, broker blip | retry with backoff tiers (q9) |
| **Unknown** | unexpected exception | limited retries, then park |
| **Business rejection** | insufficient funds | not an error — publish a domain event (PaymentRejected) and ack |

### Backstops
- quorum queue **delivery limit** (4.0 default 20; set lower, e.g. 5) catches crash loops where the consumer dies before it can classify (OOM on a huge message);
- dead-letter with **at-least-once** strategy so the parked message itself is not lost.

### Parking queue contents
Original body and headers, plus {{x-error-type}}, {{x-error-message}}, {{x-attempts}}, {{x-original-queue}}, {{x-failed-at}}, correlation/trace id. Never strip context — triage depends on it.

### Operations
- **alert** on parking depth > 0 for tier-0 flows and on growth rate for others; a DLQ nobody watches is a data-loss mechanism with extra steps;
- an **owner** per parking queue (the consuming team);
- **redrive tooling**: inspect, fix (code or data), then move messages back with shovel (management UI or {{rabbitmqctl}}), rate-limited, idempotent consumers make it safe;
- retention: parking queues have TTL/length limits plus export to storage for audit;
- dashboards of reasons, not just counts: a spike in one error type is a deploy bug.`,
  code: r`~~~bash
# Redrive: move parked messages back to the work queue with a dynamic shovel (deletes itself when empty)
rabbitmqctl set_parameter -p payments shovel redrive-ledger \
  '{"src-protocol":"amqp091","src-uri":"amqp://","src-queue":"ledger.parking",
    "dest-protocol":"amqp091","dest-uri":"amqp://","dest-queue":"ledger",
    "src-delete-after":"queue-length","ack-mode":"on-confirm","prefetch-count":50}'
rabbitmqctl shovel_status -p payments
~~~`,
  pts: [r`Classify permanent, transient, unknown and business outcomes.`, r`Delivery limit catches crash loops.`, r`Park with full context headers.`, r`Alert, assign owners, build redrive tooling.`, r`Business rejections are events, not errors.`],
  ex: r`A malformed batch from a partner bank crashed consumers in a loop; after delivery limits and parking with reasons, the same batch produced one alert and zero downtime.`,
  fu: [r`How do you redrive only messages with one error type?`, r`Who approves redriving payment messages?`],
  pit: [r`Treating insufficient funds as an exception that retries.`, r`DLQs without alerts or owners.`] },

{ id: 'q26', level: 'Senior', tags: ['consumer-timeout', 'long-running'],
  q: r`A consumer processes reports that take 45 minutes and the channel keeps closing with PRECONDITION_FAILED. Explain why and design long-running work properly.`,
  a: r`**Why:** RabbitMQ enforces a **delivery acknowledgement timeout** ({{consumer_timeout}}, default 30 minutes). A delivery not acked in time closes the channel with {{PRECONDITION_FAILED - delivery acknowledgement timed out}}; the message is requeued and redelivered — so the report starts again, possibly in a loop, and the original run may still be finishing (duplicates).

**Bad fixes:** raising {{consumer_timeout}} globally (masks stuck consumers everywhere); auto-ack (loses the job on crash).

**Good designs:**
1. **Claim, ack, then work.** The consumer records the job in a jobs table ({{Status = Running}}, lease expiry, owner), **acks**, then processes. A watchdog re-queues jobs whose lease expired. The broker is the trigger, the DB is the source of truth for job state.
2. **Split the work**: break the report into chunk messages (per account range) processed independently, with an aggregator — parallel, retryable at chunk level, each under a minute.
3. **Per-queue timeout** (RabbitMQ 3.12+ allows {{x-consumer-timeout}} as a queue argument/policy) when the work genuinely must hold the message, sized from the p99.9 duration, not the average.
4. **Workflow engine** (Durable Task, Temporal) for multi-step long processes with checkpoints.

**Also:** long processing holds a prefetch slot — keep prefetch 1 for such queues, and make cancellation (SIGTERM during deploys) resumable rather than restarting from zero.`,
  code: r`~~~csharp
consumer.ReceivedAsync += async (_, ea) =>
{
    var cmd = JsonSerializer.Deserialize<GenerateStatement>(ea.Body.Span)!;
    var claimed = await _jobs.TryClaimAsync(cmd.JobId, owner: Environment.MachineName, lease: TimeSpan.FromMinutes(10));
    await _ch.BasicAckAsync(ea.DeliveryTag, false);           // job durable in DB; broker no longer holds it
    if (!claimed) return;                                     // duplicate or already running
    _ = Task.Run(() => _runner.RunWithLeaseRenewalAsync(cmd.JobId, _stopping));   // renews lease every 2 min
};
// Watchdog: UPDATE Jobs SET Status='Pending' WHERE Status='Running' AND LeaseExpiresAt < SYSUTCDATETIME()  -> republish
~~~`,
  pts: [r`consumer_timeout default 30 min closes the channel and redelivers.`, r`Do not raise it globally or switch to auto-ack.`, r`Claim in DB, ack, process with a lease and watchdog.`, r`Split large jobs into chunks.`, r`Per-queue timeout only when holding is truly needed.`],
  ex: r`Month-end statement generation looped for three hours after crossing the 30-minute timeout; switching to claim-and-ack with leases ended the reruns.`,
  fu: [r`How do you limit concurrent long jobs after acking?`, r`How do you make a chunked job's completion exactly-once?`],
  pit: [r`Holding a message for an hour on an unacked delivery.`, r`Raising the cluster-wide timeout to 24 hours.`] },

{ id: 'q27', level: 'Senior', tags: ['clustering', 'network-partitions'],
  q: r`How does a RabbitMQ cluster behave under a network partition? Compare partition handling modes and what quorum queues change.`,
  a: r`**Cluster basics:** nodes share **metadata** (exchanges, bindings, users, policies) — in 4.x via the Raft-based **Khepri** store replacing Mnesia — while each queue's data lives with its leader/replicas. Clients connect to any node; operations on a queue are proxied to its leader.

**Partition handling for classic metadata (Mnesia era) — {{cluster_partition_handling}}:**
- {{ignore}} — both sides keep running: split brain, divergent state; only for very reliable networks;
- {{pause_minority}} — nodes on the minority side pause (stop serving) → no split brain, but a 2-node cluster can pause everything; use odd sizes across 3 AZs;
- {{autoheal}} — after the partition heals, the "losing" side restarts and its divergent changes are discarded → availability first, possible loss.

**Quorum queues and streams** use Raft per queue, so they are safe regardless: only the side with a majority of a queue's replicas serves it; the minority side refuses (clients reconnect elsewhere). With Khepri, metadata changes also need a majority.

**Practical design:**
- 3 or 5 nodes across 3 availability zones in one region (low-latency links); never stretch a cluster across regions — use federation/shovel (q28);
- {{pause_minority}} for any remaining classic workloads;
- clients with multiple endpoints, publisher confirms and outbox so a paused node causes retries, not loss;
- alert on partitions and on nodes in maintenance or paused state.`,
  code: r`~~~ini
# rabbitmq.conf
cluster_partition_handling = pause_minority
cluster_formation.peer_discovery_backend = k8s
cluster_formation.k8s.host = kubernetes.default.svc
vm_memory_high_watermark.relative = 0.6
disk_free_limit.absolute = 5GB
# check: rabbitmq-diagnostics cluster_status   (lists partitions and running nodes)
~~~`,
  dia: r`flowchart LR
  subgraph AZ1
    N1[node-1 leader of ledger]
  end
  subgraph AZ2
    N2[node-2 replica]
  end
  subgraph AZ3
    N3[node-3 replica]
  end
  N1 x--x|partition| N2
  N2 --- N3
  N2 -->|majority side elects new leader| N2
  N1 -->|minority: queue unavailable| N1`,
  pts: [r`Metadata is cluster-wide; queue data lives on leader/replicas.`, r`ignore = split brain, pause_minority = consistency, autoheal = availability.`, r`Quorum queues serve only on the majority side.`, r`3 or 5 nodes across AZs; never across regions.`, r`Clients need multiple endpoints, confirms and an outbox.`],
  ex: r`A two-node cluster with pause_minority stopped entirely when one AZ link flapped; a third node in a third AZ made the same flap invisible to clients.`,
  fu: [r`Why is autoheal risky for financial data?`, r`What does Khepri change?`],
  pit: [r`Two-node clusters.`, r`Stretching a cluster across regions.`] },

{ id: 'q28', level: 'Senior', tags: ['federation', 'shovel', 'multi-region'],
  q: r`Compare Federation and Shovel for moving messages between brokers or regions. How would you link an EU and a US cluster?`,
  a: r`**Federation** — the downstream broker **pulls** from upstream brokers, configured by policy:
- **federated exchange**: messages published to the upstream exchange are copied to the downstream exchange *for the routing keys downstream has bindings for* — publish once, consume in many regions;
- **federated queue**: a downstream queue fetches from the upstream queue only when it has idle consumers — load distribution across clusters.
- loosely coupled, tolerant of WAN latency and outages (it buffers upstream), supports multiple upstreams.

**Shovel** — a client inside a broker that **consumes from a source and republishes to a destination** (queue or exchange, AMQP 0-9-1 or 1.0):
- static (config) or dynamic (runtime parameter);
- point-to-point, explicit, good for **migrations, redrives** (q25) and one-way replication;
- acks configurable ({{on-confirm}} for safety).

**EU ↔ US design (data residency matters):**
- separate clusters per region; producers and consumers stay local;
- **only events that may legally leave the region** are exchanged — a dedicated {{global-events}} exchange, federated in each direction; PII-bearing events stay regional or are tokenised before crossing;
- loop prevention: federation's max-hops (1);
- messages crossing regions are at-least-once: consumers dedupe by MessageId;
- monitor link status and the upstream buffer depth; a broken link silently accumulates backlog.`,
  code: r`~~~bash
# On the US cluster: pull EU's global-events exchange
rabbitmqctl set_parameter -p payments federation-upstream eu \
  '{"uri":"amqps://federation:***@rabbit-eu.example.com","ack-mode":"on-confirm","max-hops":1,"expires":86400000}'
rabbitmqctl set_policy -p payments federate-global "^global-events$" '{"federation-upstream":"eu"}' --apply-to exchanges
rabbitmqctl eval 'rabbit_federation_status:status().'   # or: rabbitmqctl federation_status
~~~`,
  dia: r`flowchart LR
  subgraph EU[EU cluster]
    EP[EU producers] --> EG{{global-events}}
    EP --> EL{{payments - PII, EU only}}
  end
  subgraph US[US cluster]
    UG{{global-events}} --> UQ[(us consumers)]
  end
  UG -. federation link pulls .-> EG`,
  pts: [r`Federation pulls by policy; exchanges replicate bound keys, queues share load.`, r`Shovel consumes and republishes point-to-point.`, r`Shovels suit migrations and redrives.`, r`Separate regional clusters; only residency-safe events cross.`, r`Cross-region delivery is at-least-once; monitor link backlog.`],
  ex: r`A payments firm federated only tokenised settlement events from the EU to the US cluster; card PANs and names never left the EU, which satisfied its data-residency review.`,
  fu: [r`How do you prevent message loops with bidirectional federation?`, r`Federation or Kafka MirrorMaker-style replication?`],
  pit: [r`A stretched cluster across regions.`, r`Federating everything, including PII.`] },

{ id: 'q29', level: 'Senior', tags: ['security', 'permissions', 'tls'],
  q: r`Secure a production RabbitMQ estate for a regulated bank: transport, authentication, authorisation, management access and secrets.`,
  a: r`**Transport:** TLS 1.2+ on AMQP (5671), the management API, inter-node (Erlang distribution) and federation links; disable plain 5672 except on loopback. mTLS for service identities where possible.

**Authentication:**
- delete or disable **guest** (it is loopback-only by default; keep it that way or remove it);
- one user per **application**, never per team or shared;
- prefer **OAuth 2.0** ({{rabbitmq_auth_backend_oauth2}}, scopes like {{rabbitmq.write:payments/payments}}) or x509 certificates over static passwords; otherwise passwords in a vault with rotation;
- LDAP/OIDC for humans on the management UI.

**Authorisation (per vhost):** three regexes — **configure** (declare/delete), **write** (publish, bind *to* the queue), **read** (consume, bind *from* the exchange).
- producers: configure nothing, write their own exchange only;
- consumers: configure their own prefixed queues, read those queues;
- **topic permissions** restrict which routing keys a user may publish on topic exchanges.

**Management and ops:** management UI on an internal network behind SSO; role tags ({{monitoring}} for dashboards, {{administrator}} only for the platform team, break-glass audited); disable unused plugins.

**Audit and compliance:** log authentication failures and permission changes; export definitions to Git for change control; encrypt sensitive payload fields at the application layer (the broker sees plaintext otherwise); no PANs in messages or headers (PCI scope).`,
  code: r`~~~bash
rabbitmqctl delete_user guest
rabbitmqctl add_vhost payments
rabbitmqctl add_user payments-api "$(vault kv get -field=pw secret/rabbit/payments-api)"
# configure / write / read
rabbitmqctl set_permissions -p payments payments-api "^$" "^payments$" "^$"                          # publish only
rabbitmqctl set_permissions -p payments ledger-svc "^ledger\..*" "^ledger\..*" "^ledger\..*"           # own queues only
rabbitmqctl set_topic_permissions -p payments payments-api payments "^payments\.(eu|us)\..*" "^$"     # allowed keys
rabbitmqctl set_user_tags ops-dashboard monitoring
~~~`,
  pts: [r`TLS everywhere, including inter-node and federation.`, r`No guest; one identity per app; prefer OAuth2 or certificates.`, r`Configure/write/read regexes plus topic permissions enforce ownership.`, r`Management UI internal, SSO, least-privilege tags.`, r`Definitions in Git; encrypt sensitive fields; no PANs.`],
  ex: r`A penetration test found a shared administrator account used by six services; per-app users with regex permissions limited each service to its own queues.`,
  fu: [r`What does the write permission on a queue allow?`, r`How do OAuth scopes map to vhosts and resources?`],
  pit: [r`Shared administrator credentials in app config.`, r`Plaintext AMQP inside the "trusted" network.`] },

{ id: 'q30', level: 'Senior', tags: ['monitoring', 'observability', 'alerting'],
  q: r`Which RabbitMQ metrics and alerts matter in production, and how do you trace a message end to end?`,
  a: r`**Collect** with the built-in Prometheus plugin ({{rabbitmq_prometheus}}, port 15692; aggregated {{/metrics}} plus {{/metrics/per-object}} or {{/metrics/detailed}} for per-queue series) and the official Grafana dashboards.

**Queue health (per business queue):**
- **ready** and **unacked** depth; **age of the oldest message** (the SLO signal — depth without rate is meaningless);
- publish vs deliver/ack rate — growing gap = falling behind;
- **redelivery rate** — crash loops or nack loops;
- **consumer count** = 0 on a business queue — page;
- DLQ/parking depth > 0 for tier-0 flows — page.

**Broker health:**
- memory and disk **alarms** (page immediately — publishers are blocked);
- memory used vs watermark, free disk vs limit, file descriptors, Erlang processes;
- **connection and channel churn** (opened/closed per second) — buggy clients;
- quorum queue leader distribution and replica lag; partitions; nodes in maintenance.

**Alert on symptoms first** (age, consumer count, alarms), causes second.

**Tracing:** propagate W3C {{traceparent}} in message headers. RabbitMQ.Client 7 has built-in OpenTelemetry instrumentation ({{RabbitMQ.Client.OpenTelemetry}} package) that creates publish/receive spans and injects context; MassTransit and NServiceBus emit spans too. Log MessageId and CorrelationId on every handler so one payment can be followed from API → broker → ledger.`,
  code: r`~~~yaml
groups:
- name: rabbitmq
  rules:
  - alert: RabbitMQAlarm
    expr: rabbitmq_alarms_memory_used_watermark == 1 or rabbitmq_alarms_free_disk_space_watermark == 1
    for: 1m
    labels: { severity: page }
  - alert: LedgerQueueNoConsumers
    expr: rabbitmq_detailed_queue_consumers{queue="ledger"} == 0
    for: 2m
    labels: { severity: page }
  - alert: LedgerBacklogGrowing
    expr: rabbitmq_detailed_queue_messages_ready{queue="ledger"} > 10000 and deriv(rabbitmq_detailed_queue_messages_ready{queue="ledger"}[10m]) > 0
    for: 10m
    labels: { severity: ticket }
~~~`,
  pts: [r`Depth, age, rates, redeliveries, consumer count, DLQ depth per queue.`, r`Alarms, memory, disk, fds, churn, leader balance per broker.`, r`Alert on symptoms: age, zero consumers, alarms.`, r`Prometheus plugin with per-object metrics.`, r`traceparent in headers; built-in OTel instrumentation in Client 7.`],
  ex: r`An alert on "ledger has zero consumers for 2 minutes" caught a bad deployment 40 minutes before the depth alert would have fired.`,
  fu: [r`Why is message age better than depth for SLOs?`, r`How do you measure age when the broker does not export it per message?`],
  pit: [r`Alerting only on queue depth thresholds.`, r`No alert on DLQ depth.`] },

{ id: 'q31', level: 'Senior', tags: ['scaling', 'throughput', 'performance'],
  q: r`A single queue tops out around 15,000 msg/s and the business needs 60,000. How do you scale RabbitMQ throughput?`,
  a: r`**Why a ceiling:** a queue is served by one Erlang process on one node (for quorum queues, one Raft leader). Adding nodes or consumers does not raise that one queue's limit beyond what its process and disk/replication can sustain.

**Levers, in order:**
1. **Remove waste first:** small messages (KBs, claim check for large), batch publishing with pipelined confirms, sensible prefetch, no per-message connections/channels, efficient serialisation, multiple-ack in batch consumers.
2. **Shard the queue:** N queues via a **consistent-hash exchange** (if per-key order matters) or simple routing-key sharding; spread queue leaders across nodes (quorum: leader placement / rebalance). Throughput scales roughly with shards until nodes saturate.
3. **Scale nodes** so shard leaders have CPU/disk headroom — fast disks (NVMe), separate volumes, sized for replication traffic.
4. **Choose the right type:** classic for disposable high-rate data; quorum for durability (lower ceiling); **streams / Super Streams** for very high-rate append workloads.
5. **Question the fit:** at sustained 60k+ msg/s with replay needs, Kafka may be the right tool.

**Back-of-envelope:** 60,000 msg/s target, ~12,000 msg/s per quorum queue measured on this hardware → 5 shards minimum, 8 for headroom (N+1 node failure and bursts). Validate with **PerfTest** at production message size, durability and replication — vendor benchmarks are not your workload.`,
  code: r`~~~bash
# Benchmark with your real message size and durability settings (RabbitMQ PerfTest)
docker run -it --rm pivotalrabbitmq/perf-test:latest \
  --uri amqp://perf:***@rabbit-0:5672/perf \
  --queue-pattern 'ledger.shard.%d' --queue-pattern-from 1 --queue-pattern-to 8 \
  --producers 16 --consumers 16 --size 1200 --quorum-queue \
  --confirm 200 --multi-ack-every 50 --qos 100 --time 300
~~~`,
  pts: [r`One queue = one process/leader = a throughput ceiling.`, r`Remove waste: batch confirms, small messages, prefetch, connection reuse.`, r`Shard queues (consistent hash) and spread leaders.`, r`Size nodes for replication; benchmark with PerfTest.`, r`At very high rates with replay, consider streams or Kafka.`],
  ex: r`A market-data fan-out moved from one classic queue to 8 hashed quorum shards plus batch confirms and went from 14k to 70k msg/s on the same three nodes.`,
  fu: [r`What happens to ordering when you add shards?`, r`How do you place leaders evenly?`],
  pit: [r`Adding consumers to a queue that is already broker-bound.`, r`Benchmarking with transient messages and non-replicated queues.`] },

{ id: 'q32', level: 'Senior', tags: ['claim-check', 'large-messages'],
  q: r`A team wants to send 25 MB loan-document payloads through RabbitMQ. What happens, and what do you recommend?`,
  a: r`**What happens with large messages:**
- broker memory pressure — messages pass through memory and replication buffers; a few hundred 25 MB messages can trigger the **memory alarm** and block every publisher;
- quorum replication triples the network and disk cost;
- heartbeats and frame-level head-of-line blocking slow every other channel on the connection;
- the default {{max_message_size}} is 16 MB in recent versions (512 MB hard maximum), so 25 MB is rejected anyway unless raised — and raising it is the wrong fix.

**Claim-check pattern:**
1. upload the document to object storage (S3/Azure Blob) with server-side encryption and a lifecycle policy;
2. publish a small message containing a reference: URI/key, size, **SHA-256 hash**, content type, and the business ids;
3. the consumer fetches with its own identity (pre-signed URL with short expiry, or IAM role), verifies the hash, processes;
4. deletion follows retention rules, not consumption (multiple consumers, replays, audit).

**Security bonus:** sensitive documents stay in an access-controlled, audited store rather than being copied into every queue, DLQ and log. **Ordering** is unaffected; **atomicity**: upload first, then outbox-publish the reference; orphaned blobs are cleaned by lifecycle rules.

**Rule of thumb:** keep messages under ~128 KB; tens of KB is typical; anything larger is a claim check.`,
  code: r`~~~csharp
public async Task SubmitAsync(LoanApplication app, Stream pdf, CancellationToken ct)
{
    var key = $"loan-docs/{app.Id}/{Guid.NewGuid():N}.pdf";
    using var sha = SHA256.Create();
    await using var hashing = new CryptoStream(pdf, sha, CryptoStreamMode.Read);
    await _blobs.GetBlobClient(key).UploadAsync(hashing, new BlobUploadOptions { HttpHeaders = new() { ContentType = "application/pdf" } }, ct);

    _db.Outbox.Add(OutboxMessage.For("loans", "loans.document.uploaded.v1", new LoanDocumentUploaded(
        app.Id, BlobKey: key, Sha256: Convert.ToHexString(sha.Hash!), SizeBytes: pdf.Length)));
    await _db.SaveChangesAsync(ct);          // message is ~300 bytes, not 25 MB
}
~~~`,
  pts: [r`Large messages cause memory alarms, replication cost and head-of-line blocking.`, r`Default max_message_size is 16 MB; do not raise it as a fix.`, r`Claim check: store in blob storage, send reference plus hash.`, r`Better security and audit for sensitive documents.`, r`Keep messages in the tens of KB.`],
  ex: r`A mortgage platform pushing scanned PDFs through RabbitMQ hit memory alarms weekly; claim check reduced average message size from 4 MB to 400 bytes.`,
  fu: [r`Who deletes the blob, and when?`, r`How do you secure blob access for consumers?`],
  pit: [r`Raising max_message_size to make the error go away.`, r`No integrity hash on the referenced object.`] },

{ id: 'q33', level: 'Senior', tags: ['delayed-messages', 'scheduling'],
  q: r`The business wants "send a payment reminder in 3 days" and "retry this charge at 09:00 tomorrow". Can RabbitMQ schedule messages, and should it?`,
  a: r`**Options inside RabbitMQ:**
- **TTL + DLX queues** — fixed delay tiers only; per-message TTL in one queue blocks at the head; a 3-day message sits in broker storage for 3 days.
- **Delayed-message exchange plugin** ({{x-delayed-message}}, {{x-delay}} header) — arbitrary delays, but delayed messages are stored on **one node, not replicated**, not visible/cancellable through normal queue tools, and performance degrades with very many scheduled messages. A node loss loses them.

**Why a broker is a poor scheduler for business timers:**
- **cancellation** — the customer paid, so cancel the reminder; you cannot delete one message from the middle of a queue;
- **rescheduling** and **visibility** ("what reminders are pending for this customer?") — impossible to query;
- **long horizons** keep data in broker storage, inflate backups, and survive migrations badly;
- **audit** — regulators may ask which reminders were scheduled and why.

**Recommendation:** store timers as **data** — a {{ScheduledActions(Id, DueAt, Type, Payload, Status)}} table (indexed on DueAt, Status) or a scheduler (Quartz.NET with a persistent job store, Hangfire, cloud schedulers, a workflow engine's durable timers). A poller publishes due items through the outbox. Use broker delays only for **short technical delays** (retry backoff in seconds to minutes).`,
  code: r`~~~sql
CREATE TABLE ScheduledActions (
  Id          UNIQUEIDENTIFIER PRIMARY KEY,
  DueAt       DATETIME2 NOT NULL,
  Type        VARCHAR(100) NOT NULL,         -- 'PaymentReminder'
  Payload     NVARCHAR(MAX) NOT NULL,
  Status      VARCHAR(20) NOT NULL DEFAULT 'Pending',   -- Pending -> Published | Cancelled
  CustomerId  UNIQUEIDENTIFIER NOT NULL);
CREATE INDEX IX_Due ON ScheduledActions (Status, DueAt) INCLUDE (Type);

-- cancel when the customer pays
UPDATE ScheduledActions SET Status = 'Cancelled' WHERE CustomerId = @c AND Type = 'PaymentReminder' AND Status = 'Pending';
-- poller: move due rows into the outbox in one transaction
~~~`,
  pts: [r`TTL+DLX = fixed tiers; delayed plugin = single-node, unreplicated.`, r`Brokers cannot cancel, query or reschedule a pending message.`, r`Business timers belong in a table or durable scheduler.`, r`Publish due items via the outbox.`, r`Broker delays only for short retry backoff.`],
  ex: r`A lender lost a day of scheduled collection reminders when the node holding delayed-plugin messages was replaced; moving timers to a table made them auditable and cancellable.`,
  fu: [r`How do you scale a due-items poller across instances?`, r`What about time zones and business days?`],
  pit: [r`Multi-day delays in the delayed-message plugin.`, r`No cancellation path for scheduled actions.`] },

{ id: 'q34', level: 'Senior', tags: ['contracts', 'versioning', 'headers'],
  q: r`How do you design and evolve message contracts on RabbitMQ: envelope, headers, serialisation and versioning across many teams?`,
  a: r`**Use AMQP properties for what they are for:**
- {{MessageId}} (dedupe), {{CorrelationId}} (business flow), {{Type}} (message type and version), {{ContentType}} ({{application/json}}, {{application/cloudevents+json}}, protobuf), {{Timestamp}}, {{AppId}} (producer), {{DeliveryMode}};
- headers for cross-cutting context: {{traceparent}}, {{tenant}}, {{causation-id}}, {{schema-version}}.
- Consider **CloudEvents** (AMQP binding) for a standard envelope across brokers.

**Versioning rules:**
- **additive changes only** within a version: new optional fields; consumers ignore unknown fields ({{tolerant reader}});
- **breaking change → new type/version** ({{payments.captured.v2}}, {{Type = PaymentCaptured.v2}}), published in parallel with v1 until consumers migrate;
- never change the meaning of an existing field (amount in pounds → pence is a new field);
- amounts as **decimal strings or minor units with currency**, never floats; timestamps in UTC ISO-8601.

**Governance:** schemas in a shared repository (JSON Schema/protobuf) with CI compatibility checks; consumer-driven contract tests (Pact supports messages); a catalogue of event types and owners (AsyncAPI documents the exchanges, routing keys and payloads).

**Serialisation choice:** JSON for interoperability and debuggability; protobuf/Avro for size and strict schemas at high volume.`,
  code: r`~~~csharp
public sealed record PaymentCapturedV1(Guid PaymentId, string Amount, string Currency, DateTimeOffset CapturedAt);

var props = new BasicProperties
{
    MessageId = outboxRow.Id.ToString(),
    CorrelationId = payment.OrderId.ToString(),
    Type = "payments.PaymentCaptured.v1",
    ContentType = "application/json",
    AppId = "payments-api",
    Timestamp = new AmqpTimestamp(DateTimeOffset.UtcNow.ToUnixTimeSeconds()),
    DeliveryMode = DeliveryModes.Persistent,
    Headers = new Dictionary<string, object?> { ["traceparent"] = Activity.Current?.Id, ["tenant"] = "uk-retail" }
};
var json = JsonSerializer.SerializeToUtf8Bytes(new PaymentCapturedV1(payment.Id, "125.50", "GBP", DateTimeOffset.UtcNow));
~~~`,
  pts: [r`Use MessageId, CorrelationId, Type, ContentType properly.`, r`Additive changes in a version; tolerant readers.`, r`Breaking change = new versioned type published in parallel.`, r`Money as decimal string or minor units plus currency.`, r`Schema repo, CI compatibility checks, AsyncAPI, contract tests.`],
  ex: r`A renamed field broke three consumers in production; afterwards, JSON Schema compatibility checks in CI blocked such changes at PR time.`,
  fu: [r`How do you know which consumers still use v1?`, r`JSON or protobuf for 20k msg/s?`],
  pit: [r`Floating-point amounts.`, r`Changing field semantics without a new version.`] },

{ id: 'q35', level: 'Senior', tags: ['testing', 'testcontainers'],
  q: r`How do you test RabbitMQ producers and consumers in .NET with confidence — unit, integration and failure scenarios?`,
  a: r`**Test pyramid for messaging:**
- **Unit:** handlers are plain classes taking a message and returning effects; test business logic without a broker. Keep RabbitMQ code in thin adapters.
- **Integration with a real broker:** **Testcontainers** spins up {{rabbitmq:4.x-management}} per test run; declare the real topology (the same code or definitions file used in production), publish, and assert the consumer's database effect. Mocks of {{IChannel}} test your assumptions, not the broker's behaviour.
- **Contract tests:** schema compatibility and consumer-driven message contracts (Pact) between teams.
- **Failure tests (the valuable ones):**
  - duplicate delivery → effect applied once (inbox);
  - poison message → lands in parking with reason headers, other messages continue;
  - consumer crash before ack → redelivered, processed once;
  - broker restart mid-publish → outbox republishes, nothing lost;
  - unroutable publish → mandatory return / AE capture.
- **Performance:** PerfTest or a k6-style harness against a production-like cluster.

**Practicalities:** await conditions with timeouts and polling (eventual), unique vhost or queue names per test for isolation, and avoid {{Thread.Sleep}}-based tests that flake.`,
  code: r`~~~csharp
public sealed class LedgerConsumerTests : IAsyncLifetime
{
    private readonly RabbitMqContainer _rabbit = new RabbitMqBuilder().WithImage("rabbitmq:4.1-management").Build();
    public Task InitializeAsync() => _rabbit.StartAsync();
    public Task DisposeAsync() => _rabbit.DisposeAsync().AsTask();

    [Fact]
    public async Task Duplicate_delivery_posts_once()
    {
        await using var app = new LedgerTestHost(_rabbit.GetConnectionString());   // real topology + consumer + in-memory SQLite
        await app.StartAsync();
        var msg = new PostLedgerEntry(Guid.NewGuid(), "ACC-1", "100.00", "GBP");
        await app.PublishAsync(msg, messageId: "m-1");
        await app.PublishAsync(msg, messageId: "m-1");                                  // duplicate

        await Eventually.AssertAsync(async () => Assert.Equal(1, await app.Db.Postings.CountAsync()), TimeSpan.FromSeconds(10));
    }
}
~~~`,
  pts: [r`Handlers as pure logic; thin broker adapters.`, r`Testcontainers with the real topology for integration tests.`, r`Contract tests for cross-team messages.`, r`Test duplicates, poison, crash-before-ack, restarts, unroutable.`, r`Poll with timeouts; no sleeps.`],
  ex: r`A "crash before ack" integration test exposed that the inbox row was written in a separate transaction from the posting, before it reached production.`,
  fu: [r`How do you simulate a broker restart in a test?`, r`How do you test topology changes?`],
  pit: [r`Mocking IChannel and calling it an integration test.`, r`Sleep-based assertions.`] },

{ id: 'q36', level: 'Senior', tags: ['graceful-shutdown', 'kubernetes', 'hosted-service'],
  q: r`Implement graceful shutdown for a RabbitMQ consumer BackgroundService running in Kubernetes. What goes wrong without it?`,
  a: r`**Without it:** on SIGTERM the process exits with deliveries in flight. Partially processed messages are redelivered (fine if idempotent, but side effects may be half done), prefetched-but-unstarted messages bounce, and if the pod is killed mid-transaction you rely entirely on idempotency. Deploys cause redelivery spikes and duplicate external calls.

**Correct sequence:**
1. Kubernetes sends SIGTERM; the host signals {{stoppingToken}} / {{StopAsync}}.
2. **Cancel the consumer** ({{BasicCancelAsync}}) — no new deliveries arrive; prefetched but not started messages are released by closing the channel (or nack-requeue them).
3. **Wait for in-flight handlers** to finish (track them; bounded by a timeout below the grace period).
4. Ack completed deliveries; close channel, then connection.
5. Exit before {{terminationGracePeriodSeconds}} (default 30 s) or Kubernetes sends SIGKILL.

**Settings:** {{HostOptions.ShutdownTimeout}} slightly below the pod grace period; grace period above p99 handler time; a {{preStop}} sleep of a few seconds if the service also serves HTTP (lets endpoints deregister). Long jobs use claim-and-ack (q26) so shutdown never waits 45 minutes.

**Readiness:** report not-ready when the connection is down or recovering, so dashboards show reality; liveness should not depend on the broker (or every pod restarts during a broker blip).`,
  code: r`~~~csharp
public sealed class LedgerConsumer(IConnection conn, IServiceScopeFactory scopes, ILogger<LedgerConsumer> log) : BackgroundService
{
    private readonly ConcurrentDictionary<ulong, Task> _inFlight = new();
    private IChannel _ch = default!; private string _tag = "";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _ch = await conn.CreateChannelAsync(cancellationToken: stoppingToken);
        await _ch.BasicQosAsync(0, 20, false, stoppingToken);
        var consumer = new AsyncEventingBasicConsumer(_ch);
        consumer.ReceivedAsync += (_, ea) => _inFlight[ea.DeliveryTag] = HandleAsync(ea);
        _tag = await _ch.BasicConsumeAsync("ledger", autoAck: false, consumer, stoppingToken);
        await Task.Delay(Timeout.Infinite, stoppingToken).ContinueWith(_ => { });
    }

    public override async Task StopAsync(CancellationToken ct)
    {
        await _ch.BasicCancelAsync(_tag);                                        // 1. stop new deliveries
        await Task.WhenAll(_inFlight.Values).WaitAsync(TimeSpan.FromSeconds(20)); // 2. drain in-flight
        await _ch.CloseAsync();                                                  // 3. unstarted prefetched msgs return to queue
        await base.StopAsync(ct);
    }

    private async Task HandleAsync(BasicDeliverEventArgs ea)
    {
        try { using var s = scopes.CreateScope(); await s.ServiceProvider.GetRequiredService<LedgerHandler>().HandleAsync(ea); await _ch.BasicAckAsync(ea.DeliveryTag, false); }
        catch (Exception ex) { log.LogError(ex, "failed"); await _ch.BasicNackAsync(ea.DeliveryTag, false, requeue: false); }
        finally { _inFlight.TryRemove(ea.DeliveryTag, out _); }
    }
}
// Program.cs: builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(25));  // pod grace 30s
~~~`,
  pts: [r`Cancel consumer, drain in-flight, ack, close channel, close connection.`, r`Shutdown timeout below terminationGracePeriodSeconds.`, r`Long work uses claim-and-ack so shutdown is quick.`, r`Readiness reflects broker connectivity; liveness does not.`, r`Without it, deploys cause redelivery spikes and half-done side effects.`],
  ex: r`Each deploy caused around 200 redeliveries and duplicate SMS sends; graceful drain dropped deploy-time redeliveries to near zero.`,
  fu: [r`Why must liveness not depend on the broker?`, r`What happens to prefetched messages on channel close?`],
  pit: [r`Shutdown timeout longer than the pod grace period.`, r`Liveness probe failing whenever the broker reconnects.`] },

{ id: 'q37', level: 'Principal', tags: ['architecture-decision', 'kafka', 'comparison'],
  q: r`RabbitMQ or Kafka? Walk an architecture review board through the decision for a payments platform, and explain when you would run both.`,
  a: r`### Compare on the properties that drive the decision
| | RabbitMQ | Kafka |
|---|---|---|
| Model | smart broker routes, deletes on ack | log; consumers track offsets |
| Replay | no (streams: yes) | yes, by offset or time |
| Ordering | per queue, single consumer | per partition |
| Routing | rich: exchanges, patterns, headers | topic + key |
| Per-message features | ack/nack, TTL, priority, DLX, delays | none per message; retry topics by convention |
| Throughput | tens of thousands/s per queue; scale by sharding | millions/s per cluster |
| Consumer scaling | competing consumers, no partition limit | bounded by partition count |
| Ops footprint | smaller cluster, simpler | larger platform: Connect, registry, tiered storage |

### Map workloads, not products
- **Commands / work distribution** (capture this payment, send this SMS, generate this statement): per-message retry, delay, priority, DLQ, elastic competing consumers → **RabbitMQ** (or SQS/Service Bus).
- **Domain event streams** consumed by many teams, **replay** to build read models, **CDC**, analytics, audit, long retention → **Kafka**.

### Running both
Common and legitimate: RabbitMQ for **commands within** a bounded context, Kafka for **events between** contexts. Cost is two platforms to run, secure and monitor; justify it with workload volume and team capability. If you can afford only one: Kafka if the event backbone and replay matter most; RabbitMQ (with streams) if workloads are mostly task queues and volume is moderate.

### What the board should hear
Decision criteria, an ADR, the operational owner, the cost, the exit path, and what you explicitly will **not** use each product for.`,
  code: r`~~~text
ADR-031: Messaging platforms for Payments
Decision: RabbitMQ (quorum queues) for commands inside bounded contexts; Kafka for cross-context domain events.
Drivers : per-message retry/delay/DLQ for commands; replay + many consumers + CDC for events.
Rules   : no Kafka for request/reply or task queues; no RabbitMQ for analytics feeds or replay.
Owners  : Platform team runs both; domains own topology/schemas via GitOps.
Cost    : 3-node RabbitMQ per region + existing Kafka; ~0.5 FTE ops.
Revisit : if command volume > 50k msg/s sustained, or if Kafka queues (KIP-932) mature for our needs.
~~~`,
  dia: r`flowchart LR
  API[Payments API] -->|outbox: commands| RMQ[(RabbitMQ quorum queues)]
  RMQ --> W1[Capture worker]
  RMQ --> W2[Notification worker]
  W1 -->|outbox: domain events| K[(Kafka payments.events)]
  K --> L[Ledger]
  K --> F[Fraud analytics]
  K --> RM[Read models - replayable]
  K --> DW[Data lake]`,
  pts: [r`Smart broker vs log is the core difference.`, r`Commands and tasks → RabbitMQ; event streams and replay → Kafka.`, r`Running both is common; justify the operational cost.`, r`Decide per workload with an ADR and explicit non-uses.`, r`RabbitMQ Streams and Kafka share-groups blur the line — revisit.`],
  ex: r`A PSP used RabbitMQ for 30 command queues and Kafka for 12 event topics; the ADR's "no request/reply on Kafka" rule stopped a team from building a synchronous quote service on topics.`,
  fu: [r`What would make you consolidate to one platform?`, r`Where do Kafka share groups (queues for Kafka) change this?`],
  pit: [r`Choosing by benchmark throughput alone.`, r`Using Kafka as a task queue with per-message retries.`] },

{ id: 'q38', level: 'Principal', tags: ['system-design', 'payments', 'reliability'],
  q: r`Design reliable payment-command processing on RabbitMQ for 2,000 commands/s at peak, with no lost or double-charged payments.`,
  a: r`### Scope and numbers
2,000 cmd/s peak, ~1 KB each → 2 MB/s, trivially within RabbitMQ's capacity. A 3-node cluster with a few sharded quorum queues has 5–10x headroom. **The numbers say correctness, not throughput, is the design driver**: no loss, no double charge, explainable to auditors.

### Flow
1. **API** validates, writes {{Payment(status=Pending)}} and an **outbox** row in one transaction, returns 202 with the payment id. Client {{Idempotency-Key}} is unique-indexed, so double submits return the same payment.
2. **Outbox relay** publishes {{payments.capture.v1}} with confirms + mandatory to {{payments.commands}} (topic exchange with an alternate exchange).
3. **Quorum queues** {{payments.capture.shard.N}} via consistent hash on payment id; SAC where per-payment order matters.
4. **Capture worker**: inbox dedupe by MessageId → calls the PSP with **{{Idempotency-Key = paymentId}}** → records the result and emits {{PaymentCaptured}}/{{PaymentFailed}} via the outbox → acks.
5. **Failures**: transient (PSP 5xx, timeout) → backoff tiers; unknown outcome (timeout after send) → **do not blindly retry a new charge**; query the PSP by idempotency key, or rely on its idempotency; permanent → parking + alert.
6. **Reconciliation** nightly against the PSP settlement file: every capture we recorded vs every capture the PSP reports; breaks classified and worked.

### Guarantees
- No loss: outbox + confirms + quorum + manual ack.
- No double charge: client idempotency key at the API, inbox at the worker, **PSP idempotency key** at the external boundary, reconciliation as the detector of last resort.
- Audit: append-only payment state history and message ids in logs.`,
  code: r`~~~csharp
public async Task HandleAsync(CapturePayment cmd, string messageId, CancellationToken ct)
{
    if (!await _inbox.TryBeginAsync("capture", messageId, ct)) return;                 // duplicate delivery
    var payment = await _db.Payments.SingleAsync(p => p.Id == cmd.PaymentId, ct);
    if (payment.Status is PaymentStatus.Captured or PaymentStatus.Failed) return;      // already final

    var result = await _psp.CaptureAsync(new CaptureRequest(cmd.PaymentId, cmd.AmountMinor, cmd.Currency),
                                         idempotencyKey: cmd.PaymentId.ToString(), ct); // PSP dedupes retries
    payment.Apply(result);                                                              // Captured | Failed | Unknown
    _db.Outbox.Add(OutboxMessage.For("payments", $"payments.{payment.Region}.{payment.Status.ToString().ToLowerInvariant()}.v1", payment.ToEvent()));
    await _db.SaveChangesAsync(ct);                                                     // state + inbox + outbox: one tx
}
~~~`,
  dia: r`flowchart LR
  C[Client] -->|Idempotency-Key| API[Payments API]
  API -->|tx: payment + outbox| DB[(Payments DB)]
  R[Outbox relay] --> DB
  R -->|confirms, mandatory| X{{payments.commands}}
  X --> Q1[(capture shard 0..N quorum)]
  Q1 --> W[Capture worker - inbox]
  W -->|Idempotency-Key = paymentId| PSP[PSP]
  W -->|tx: state + outbox| DB
  W -.transient.-> RT[(retry tiers)]
  RT -.TTL.-> Q1
  W -.permanent.-> PK[(parking + alert)]
  REC[Nightly reconciliation] --> DB
  REC --> SF[PSP settlement file]`,
  pts: [r`2,000/s is small; correctness drives the design.`, r`Outbox in, confirms, quorum queues, inbox, outbox out.`, r`Idempotency keys at API, worker and PSP boundary.`, r`Unknown outcomes are queried, not blindly retried.`, r`Reconciliation against settlement files detects what code cannot.`],
  ex: r`A PSP timeout storm produced 1,100 "unknown" captures; because retries reused the payment id as the PSP idempotency key, zero customers were double-charged and reconciliation confirmed it the next morning.`,
  fu: [r`What if the PSP does not support idempotency keys?`, r`How do you surface "unknown" payments to customers?`],
  pit: [r`Retrying a timed-out charge with a new request id.`, r`Skipping reconciliation because "the pipeline is exactly-once".`] },

{ id: 'q39', level: 'Principal', tags: ['incident', 'backlog'],
  q: r`Incident: the ledger queue has grown from 0 to 2 million messages in 40 minutes during market open. Lead the response.`,
  a: r`### Stabilise (first 10 minutes)
- **Protect the broker**: check memory/disk headroom and alarms — if the cluster blocks, every service is affected. If needed, apply/raise a length limit with {{reject-publish}} on this queue so producers back-pressure into their outboxes rather than taking the node down.
- **Communicate**: incident channel, severity, business impact ("ledger postings delayed ~N minutes; no data loss expected"), next update time.

### Diagnose (rate, not just depth)
- **Consumers present?** Zero consumers → deployment/crash; check pods, logs, the last release.
- **Ack rate dropped or publish rate spiked?** Publish 5x normal → upstream event (market open, a replay, a misbehaving producer re-sending). Ack rate fell → consumers slow.
- **Redelivery rate high?** Crash or nack loop on poison messages → check the parking queue and errors.
- **Downstream:** ledger DB latency, locks, connection pool exhaustion, a slow dependency; prefetch/concurrency changes.

### Mitigate by cause
- slow DB → fix the DB issue first; scaling consumers into a struggling DB makes it worse;
- poison loop → deploy classification fix or lower the delivery limit to park offenders;
- genuine load → scale consumers within DB capacity; defer non-critical consumers;
- rogue producer → throttle via permissions/policy or stop it.

### Recover and learn
Drain rate × time = ETA to normal; tell the business. Post-incident: alert on **age** and **ack-rate drop** (not only depth), capacity tests for market open, per-producer rate limits.`,
  code: r`~~~bash
rabbitmqctl list_queues -p payments name messages_ready messages_unacknowledged consumers consumer_utilisation \
  message_stats.publish_details.rate message_stats.ack_details.rate message_stats.redeliver_details.rate | sort -k2 -nr | head
rabbitmq-diagnostics memory_breakdown -n rabbit@node-1 --unit gb
rabbitmq-diagnostics alarms
rabbitmqctl list_connections name user peer_host recv_oct_details.rate | sort -k4 -nr | head   # who is publishing hardest
# emergency guard: bounded queue, producers get nacks instead of the node alarming
rabbitmqctl set_policy -p payments ledger-guard "^ledger$" '{"max-length":3000000,"overflow":"reject-publish"}' --apply-to queues --priority 100
~~~`,
  pts: [r`Protect the broker first: alarms affect everyone.`, r`Diagnose rates: publish spike vs ack drop vs redelivery loop.`, r`Fix downstream bottlenecks before scaling consumers.`, r`Communicate impact and ETA.`, r`Afterwards alert on age and ack-rate drops.`],
  ex: r`A market-open spike was a producer replaying a day of events after a bad deploy; rate-limiting that producer's user and parking the duplicates cleared the backlog in 25 minutes.`,
  fu: [r`How do you compute the drain ETA?`, r`When would you purge a queue, and who approves?`],
  pit: [r`Scaling consumers into an overloaded database.`, r`Purging a queue of financial messages to "recover".`] },

{ id: 'q40', level: 'Principal', tags: ['incident', 'memory-alarm'],
  q: r`Incident: a memory alarm fires, all publishers across 30 services hang, and APIs time out. Root-cause it and prevent it platform-wide.`,
  a: r`### What is happening
A node crossed {{vm_memory_high_watermark}}; RabbitMQ **blocked publishing connections** to protect itself. Services that publish synchronously in request paths, without timeouts and on the same connection as their consumers, hang — so a broker protection mechanism became a multi-service outage.

### Immediate actions
1. {{rabbitmq-diagnostics memory_breakdown}} — where is memory: queue processes (a huge classic backlog?), connections/channels (churn, thousands of connections), binaries (large messages), Raft/quorum (long quorum queues), plugins (management stats).
2. Remove the cause: restart/fix the stuck consumer so the backlog drains, close abusive connections, drop/park oversized messages.
3. Do **not** just raise the watermark: risks OOM-killing the node, which is far worse.

### Typical root causes
- an unbounded queue behind a dead consumer;
- 25 MB messages (claim check missing);
- connection-per-request clients (tens of thousands of connections);
- management stats collection on a huge topology.

### Platform-wide prevention
- **Policies by default**: max-length and overflow on every queue; max message size;
- client standard library: singleton connections, separate publish/consume connections, publish timeouts, outbox, blocked-connection handling;
- per-vhost limits ({{max-connections}}, {{max-queues}}) and per-user connection limits;
- alerts at 70–80% of watermark, not at the alarm;
- container memory sized with the watermark in mind (absolute value, headroom for Erlang GC);
- a game day that triggers an alarm deliberately and verifies that services degrade gracefully.`,
  code: r`~~~bash
rabbitmq-diagnostics memory_breakdown --unit mb | head -20
rabbitmqctl list_queues name messages memory --sort memory | tail -5 2>/dev/null || rabbitmqctl list_queues name messages memory
rabbitmqctl list_connections user peer_host | sort | uniq -c | sort -nr | head     # connection hogs per user/host
# Guard rails
rabbitmqctl set_vhost_limits -p payments '{"max-connections": 2000, "max-queues": 1500}'
rabbitmqctl set_user_limits payments-api '{"max-connections": 50, "max-channels": 500}'
rabbitmqctl set_policy -p payments default-bounds ".*" '{"max-length-bytes":2000000000,"overflow":"reject-publish"}' --apply-to queues --priority 0
~~~`,
  pts: [r`Memory alarm blocks publishers cluster-wide by design.`, r`memory_breakdown shows queues, connections, binaries or Raft as the cause.`, r`Never just raise the watermark.`, r`Default policies, vhost/user limits and client standards prevent recurrence.`, r`Alert before the alarm and rehearse degradation.`],
  ex: r`One reporting service opening 18,000 connections caused a bank-wide publisher block; per-user connection limits turned the repeat into a single service's error.`,
  fu: [r`How do vhost limits interact with autoscaling?`, r`What should a payments API return while the broker is blocked?`],
  pit: [r`Raising vm_memory_high_watermark to 0.9 under pressure.`, r`Treating the broker as infinitely elastic.`] },

{ id: 'q41', level: 'Principal', tags: ['migration', 'upgrade', 'quorum'],
  q: r`You must upgrade from RabbitMQ 3.x with classic mirrored queues to 4.x, where mirroring no longer exists. Plan the migration with zero message loss.`,
  a: r`### Constraints
4.0 **removed classic queue mirroring**; mirrored queues would become single-node classic queues — silently losing HA. Queue type cannot be changed in place ({{x-queue-type}} is immutable), and redeclaring with different arguments gives **406 PRECONDITION_FAILED**.

### Plan
1. **Inventory** via definitions export: every queue, its policies (ha-mode), arguments, consumers, owners. Classify: needs replication → quorum (or stream); transient → classic non-mirrored.
2. **Check feature gaps** per queue: exclusive/auto-delete (not supported by quorum), priorities (quorum: 2 levels), global QoS (not supported by quorum), per-message TTL behaviour, non-durable — fix clients first.
3. **Choose the method:**
   - **Blue-green clusters (preferred for regulated estates):** stand up a new 4.x cluster with quorum topology from definitions-as-code; move **consumers** to consume from both, switch **producers** to the new cluster, then **shovel** the residual backlog from old queues to new; decommission old. Rollback = point producers back.
   - **In-place per queue:** create {{ledger.v2}} (quorum), bind it, move consumers, unbind the old one, shovel remaining messages, delete old.
4. **Upgrade path**: clients to RabbitMQ.Client 7 (async API changes), enable required **feature flags** on 3.13 before 4.0, validate MassTransit/NServiceBus support for quorum queue settings.
5. **Verification**: message counts in/out per queue during cut-over, reconciliation of business totals, synthetic canary messages through every route.

### Governance
Change freeze windows outside market hours, rehearsal in a prod-like environment, per-queue owner sign-off, documented rollback.`,
  code: r`~~~bash
# 1. Inventory: which queues rely on mirroring policies?
rabbitmqadmin export defs-3x.json
jq '.policies[] | select(.definition["ha-mode"] != null) | {vhost, name, pattern}' defs-3x.json
# 2. Per-queue migration with a shovel for the backlog
rabbitmqctl set_parameter -p payments shovel migrate-ledger \
 '{"src-protocol":"amqp091","src-uri":"amqp://","src-queue":"ledger","dest-protocol":"amqp091","dest-uri":"amqp://","dest-queue":"ledger.v2","src-delete-after":"queue-length","ack-mode":"on-confirm"}'
# 3. Before upgrading 3.13 -> 4.x
rabbitmqctl enable_feature_flag all
~~~`,
  dia: r`flowchart LR
  subgraph OLD[3.13 cluster - mirrored classic]
    OQ[(ledger)]
  end
  subgraph NEW[4.x cluster - quorum]
    NQ[(ledger quorum)]
  end
  P[Producers] -->|step 2: switch| NQ
  P -.step 0: before.-> OQ
  C[Consumers] -->|step 1: consume both| OQ
  C --> NQ
  OQ -->|step 3: shovel residual backlog| NQ`,
  pts: [r`4.0 removed mirroring; queue type is immutable.`, r`Inventory and classify queues; fix feature gaps first.`, r`Blue-green with shovel is safest; per-queue v2 also works.`, r`Feature flags and client upgrades are part of the path.`, r`Verify with counts, reconciliation and canaries.`],
  ex: r`A broker estate of 1,400 queues migrated over six weekends using blue-green clusters; per-queue message counts matched exactly and no producer saw an error.`,
  fu: [r`How do consumers avoid duplicates while consuming from both clusters?`, r`What does a rollback look like after producers switched?`],
  pit: [r`Upgrading in place and discovering queues lost replication.`, r`Redeclaring a queue with a new type and crashing clients with 406.`] },

{ id: 'q42', level: 'Principal', tags: ['multi-tenancy', 'platform', 'noisy-neighbour'],
  q: r`You run RabbitMQ as a shared platform for 40 teams. How do you design tenancy, isolation and fair use?`,
  a: r`### Isolation levels (pick per risk tier)
| Level | Isolation | Cost |
|---|---|---|
| Shared vhost, prefixes | naming only | cheapest, weakest |
| **vhost per domain/team** | topology, permissions, limits | the sensible default |
| Dedicated cluster | CPU, memory, disk, upgrades | for tier-0 or regulated workloads |

Tier-0 payments get a **dedicated cluster**: a memory alarm caused by an analytics team must never block payments publishers (alarms are node-wide, not vhost-wide).

### Fair use inside a shared cluster
- **vhost limits** ({{max-connections}}, {{max-queues}}) and **user limits** ({{max-connections}}, {{max-channels}});
- default **policies**: bounded queues, message TTL for non-critical vhosts, max message size;
- **queue leader placement** spread across nodes; heavy tenants' queues on a node subset if needed;
- quotas reviewed with owners; usage dashboards per vhost (show-back or charge-back).

### Self-service with guard rails
- topology as code (q47): teams PR their exchanges/queues/policies; CI validates naming, limits, quorum for durable queues, DLX present;
- an internal client library with safe defaults;
- onboarding docs: the reliability checklist (confirms, outbox, manual ack, idempotency).

### Platform team responsibilities
Upgrades, capacity, SLOs for the broker itself (availability, publish latency), incident response, and saying **no** to unsafe patterns (connection per request, unbounded queues) with data.`,
  code: r`~~~bash
for team in payments ledger cards notifications; do
  rabbitmqctl add_vhost "$team"
  rabbitmqctl set_vhost_limits -p "$team" '{"max-connections": 1000, "max-queues": 500}'
  rabbitmqctl set_policy -p "$team" platform-defaults ".*" \
    '{"max-length-bytes":1000000000,"overflow":"reject-publish","dead-letter-exchange":"platform.dlx"}' --apply-to queues --priority 0
done
rabbitmqctl set_user_limits notifications-svc '{"max-connections": 20, "max-channels": 200}'
~~~`,
  pts: [r`vhost per domain is the default isolation unit.`, r`Alarms are node-wide, so tier-0 needs dedicated clusters.`, r`Vhost/user limits and default policies enforce fair use.`, r`Topology as code with CI guard rails.`, r`The platform team owns broker SLOs and safe defaults.`],
  ex: r`Moving payments to a dedicated cluster after a marketing campaign's queue backlog blocked payment publishers ended cross-team incidents.`,
  fu: [r`How do you charge back broker costs?`, r`What are the broker's own SLOs?`],
  pit: [r`One giant vhost for everyone.`, r`Assuming vhosts isolate resource exhaustion.`] },

{ id: 'q43', level: 'Principal', tags: ['exactly-once', 'semantics'],
  q: r`A stakeholder insists the new system must deliver every message "exactly once". What do you tell them, and what do you build?`,
  a: r`### The honest statement
No broker gives exactly-once **delivery** across a network: a crash between "processed" and "ack received" forces a choice between redelivering (at-least-once) or not (at-most-once). What we can deliver is **exactly-once effect**:

**exactly-once = at-least-once delivery + idempotent processing (at-most-once effect)**

### What RabbitMQ contributes (the at-least-once half)
- publisher confirms + mandatory + outbox → nothing lost between the app and the broker;
- quorum queues + persistent messages → nothing lost in the broker;
- manual acks after commit → nothing lost in the consumer.

### What the application contributes (the at-most-once half)
- stable MessageId from the source; inbox/dedupe in the same transaction as the effect;
- natural idempotency (conditional updates, upserts, state machines);
- **idempotency keys at external boundaries** (PSP, bank APIs) — the hardest part, because our transaction cannot include their system;
- reconciliation as the detector for whatever slips through.

### Worked scenarios
1. **Double submit** by a customer → API idempotency key returns the original payment.
2. **Consumer crash after commit, before ack** → redelivery → inbox hit → ack, no double posting.
3. **PSP call succeeded but response lost** → retry with the same PSP idempotency key → PSP returns the original result.

### What to tell the stakeholder
"The customer-visible outcome will be exactly once; internally messages may be delivered more than once and are deduplicated, and reconciliation proves it daily." That is a testable promise.`,
  code: r`~~~csharp
// The two halves in one handler
consumer.ReceivedAsync += async (_, ea) =>
{
    var id = ea.BasicProperties.MessageId ?? throw new InvalidOperationException("MessageId required");
    await using var tx = await db.Database.BeginTransactionAsync();
    var fresh = await db.Database.ExecuteSqlInterpolatedAsync(
        $"INSERT INTO Inbox (Consumer, MessageId) SELECT 'ledger', {id} WHERE NOT EXISTS (SELECT 1 FROM Inbox WITH (UPDLOCK, HOLDLOCK) WHERE Consumer='ledger' AND MessageId={id})") == 1;
    if (fresh) await ledger.PostAsync(Deserialize(ea.Body));     // at-most-once effect
    await tx.CommitAsync();
    await ch.BasicAckAsync(ea.DeliveryTag, false);               // at-least-once delivery
};
~~~`,
  pts: [r`Exactly-once delivery is not available; exactly-once effect is.`, r`Exactly-once = at-least-once + idempotency.`, r`Broker side: confirms, quorum, manual acks.`, r`App side: inbox, natural idempotency, external idempotency keys.`, r`Reconciliation proves the promise.`],
  ex: r`An architecture review replaced a vague "exactly-once" requirement with three testable scenarios and a daily reconciliation report, which auditors accepted as evidence.`,
  fu: [r`What if the external API has no idempotency support?`, r`How long must the dedupe window be?`],
  pit: [r`Claiming a broker setting provides exactly-once.`, r`Forgetting the external side effect.`] },

{ id: 'q44', level: 'Principal', tags: ['capacity-planning', 'sizing'],
  q: r`Size a RabbitMQ cluster for 8,000 msg/s average, 25,000 msg/s peak, 2 KB messages, quorum queues and a requirement to absorb a 2-hour consumer outage.`,
  a: r`### Throughput
- Peak 25,000 msg/s × 2 KB = **50 MB/s ingress**. Quorum replication to 2 followers → ~100 MB/s inter-node; deliveries to consumers another 50 MB/s; total network per busiest node well under 1 GB/s, but **disk write** is the constraint: each replica writes 50 MB/s plus WAL/segment overhead.
- Per-queue ceiling (measured, say ~10k msg/s for 2 KB quorum on this hardware) → peak needs ≥ 3 queues; plan **6–8 shards** for N+1 and bursts.

### Backlog storage
- 2-hour outage at average rate: 8,000 × 7,200 = **57.6 M messages** × 2 KB ≈ **115 GB per replica**.
- At peak rate it would be ~360 GB — decide with the business which applies, and set length limits to match.
- Quorum queues are not designed for very long backlogs (memory, recovery time); if multi-hour backlogs at this scale are a real requirement, consider streams for the buffer or design producers to hold data in their outboxes.

### Node sizing (starting point, validate with PerfTest)
- 3 nodes (or 5 for two-failure tolerance) across 3 AZs;
- NVMe disks sized for backlog × 1.5 plus headroom above {{disk_free_limit}} (≥ 500 GB each);
- 16–32 GB RAM, watermark 0.6, alert at 70% of it;
- 8+ vCPU; one node lost must still carry peak (N+1).

### Statement for the review
"At 25k/s the bottleneck is disk and per-queue throughput, not network; we shard to 8 queues, size disks for a 2-hour average-rate backlog, and validate with PerfTest before go-live."`,
  code: r`~~~text
Ingress peak      = 25,000 msg/s x 2 KB         = 50 MB/s
Replication       = 50 MB/s x 2 followers       = 100 MB/s inter-node
Disk per replica  = ~50 MB/s sustained writes (+ WAL overhead)
Shards            = 25,000 / 10,000 per queue   = 2.5 -> 3 minimum -> 8 with N+1 and burst headroom
Backlog (avg)     = 8,000 x 7,200 s             = 57.6 M msgs x 2 KB = ~115 GB per replica
Disk per node     = 115 GB x 1.5 + free-limit headroom  -> 500 GB NVMe
Cluster           = 3 nodes x (8 vCPU, 32 GB RAM, 500 GB NVMe) across 3 AZs; validate with PerfTest
~~~`,
  pts: [r`Start from bytes per second, then replication multiplier.`, r`Disk and per-queue throughput are the usual limits.`, r`Backlog = rate × outage × size, per replica.`, r`Very long quorum backlogs are a smell; consider streams or outbox buffering.`, r`N+1 sizing and PerfTest validation.`],
  ex: r`A sizing exercise showed a two-hour backlog needed 115 GB per node, not the 50 GB provisioned; the disk was resized before a consumer outage could block all publishers.`,
  fu: [r`What changes with 5 replicas?`, r`How long does a node take to recover with 100 GB of quorum data?`],
  pit: [r`Sizing only for average throughput.`, r`Forgetting the replication multiplier.`] },

{ id: 'q45', level: 'Principal', tags: ['disaster-recovery', 'multi-region'],
  q: r`Design disaster recovery for a RabbitMQ-based payments platform across two regions. What are the realistic RPO and RTO, and how do you recover in-flight messages?`,
  a: r`### Facts that shape the design
- RabbitMQ clusters must not span regions; there is **no built-in synchronous cross-region replication** of queues.
- Federation/shovel replication is **asynchronous** → messages in flight at failure are at risk; RPO > 0 for broker contents.

### Pattern: the database is the source of truth; the broker is rebuildable
- Business state and the **outbox** live in a database with cross-region replication (synchronous or near-synchronous for tier-0).
- On regional failover: bring up the standby region's RabbitMQ cluster (pre-provisioned, topology from Git), promote the DB, and **re-run the outbox relay from the last confirmed-and-acknowledged point** — or, more simply, replay outbox rows from a time window before the failure.
- Consumers are idempotent (inbox replicated with the DB), so replaying the overlap window is safe.

### Targets (typical)
- **RPO** for business data = DB replication RPO (seconds or zero); broker contents themselves are treated as disposable.
- **RTO** = DB promotion + broker standby activation + DNS/connection switch: 15–30 minutes, rehearsed.

### Optional: warm standby replication
Federate or shovel tier-0 queues to the DR region for faster resumption, accepting duplicates (dedupe) and possible small loss covered by outbox replay.

### Prove it
Quarterly failover tests with reconciliation of message counts and business totals; a written runbook with decision rights (who declares disaster).`,
  code: r`~~~sql
-- After failover: republish everything not provably consumed, from a safety window
UPDATE OutboxMessages
SET    PublishedAt = NULL                          -- relay in DR region will publish again
WHERE  CreatedAt >= DATEADD(MINUTE, -30, @FailoverAt);   -- overlap window; consumers dedupe via Inbox

-- Verify after drain
SELECT COUNT(*) FROM Payments WHERE Status = 'Pending' AND CreatedAt < DATEADD(MINUTE, -15, SYSUTCDATETIME());
~~~`,
  dia: r`flowchart LR
  subgraph R1[Primary region]
    A1[Apps] --> D1[(DB + outbox + inbox)]
    A1 --> B1[(RabbitMQ cluster)]
  end
  subgraph R2[DR region]
    A2[Apps - standby] --> D2[(DB replica)]
    A2 --> B2[(RabbitMQ standby - topology from Git)]
  end
  D1 ==>|DB replication| D2
  B1 -.optional federation of tier-0.-> B2
  D2 -->|failover: replay outbox window| B2`,
  pts: [r`No synchronous cross-region queue replication.`, r`Treat the DB and outbox as the source of truth.`, r`Failover replays an outbox window; idempotent consumers absorb duplicates.`, r`RPO follows DB replication; RTO is rehearsed in minutes.`, r`Quarterly tests with reconciliation.`],
  ex: r`A DR test replayed a 30-minute outbox window into the standby region; 4,200 duplicates were absorbed by inboxes, and totals reconciled to the penny.`,
  fu: [r`Why not stretch the cluster with high-latency links?`, r`Who has authority to trigger failover?`],
  pit: [r`Treating federation as zero-RPO replication.`, r`Unrehearsed runbooks.`] },

{ id: 'q46', level: 'Principal', tags: ['frameworks', 'build-vs-buy', 'licensing'],
  q: r`Raw RabbitMQ.Client, MassTransit, NServiceBus or Wolverine: how do you choose for a 15-team .NET organisation?`,
  a: r`### What a framework gives you
Consistent topology conventions, retries and delayed redelivery, error queues, outbox/inbox, sagas, serialisation, OpenTelemetry, testing harnesses — features every team otherwise rebuilds slightly differently.

### Options
| | Raw client | MassTransit | NServiceBus | Wolverine |
|---|---|---|---|---|
| Licence | open source | v8 OSS; **v9 commercial** | commercial | open source |
| Learning curve | low API, high design | moderate | moderate | moderate |
| Outbox/inbox, sagas | build yourself | yes | yes (mature) | yes |
| Support | community | vendor (v9) | vendor | community/vendor |
| Transport portability | none | many | many | several |

### Decision criteria
- **Number of teams and consistency need**: 15 teams → a framework or a strong internal library, never 15 bespoke implementations.
- **Licensing and support** budgets; regulated firms often prefer a supported product.
- **Lock-in and abstraction leakage**: frameworks impose topology conventions; check they fit your naming, permissions and quorum standards.
- **Performance-critical infrastructure paths** (market-data fan-out) may still use the raw client.

### Recommendation pattern
One standard framework for business messaging, configured centrally (an internal package with safe defaults: quorum queues, prefetch, outbox, OTel), plus documented exceptions for raw-client use. Review licensing at each major version — the MassTransit v9 change is exactly the kind of risk architecture governance exists to catch.`,
  code: r`~~~csharp
// Internal package: one line for teams, safe defaults inside
public static IServiceCollection AddBankMessaging<TDb>(this IServiceCollection s, IConfiguration cfg, Action<IBusRegistrationConfigurator> consumers) where TDb : DbContext =>
    s.AddMassTransit(x =>
    {
        consumers(x);
        x.AddEntityFrameworkOutbox<TDb>(o => { o.UseSqlServer(); o.UseBusOutbox(); });
        x.AddConfigureEndpointsCallback((ctx, _, ep) =>
        {
            ep.PrefetchCount = 32;
            ep.UseEntityFrameworkOutbox<TDb>(ctx);
            if (ep is IRabbitMqReceiveEndpointConfigurator r) r.SetQuorumQueue();
        });
        x.UsingRabbitMq((ctx, c) =>
        {
            c.Host(new Uri(cfg["Rabbit:Uri"]!));
            c.UseDelayedRedelivery(r => r.Intervals(TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(10)));
            c.UseMessageRetry(r => r.Incremental(3, TimeSpan.FromMilliseconds(200), TimeSpan.FromMilliseconds(500)));
            c.ConfigureEndpoints(ctx);
        });
    });
~~~`,
  pts: [r`Frameworks standardise retries, outbox, sagas and telemetry.`, r`Licensing: MassTransit v9 and NServiceBus are commercial.`, r`Many teams need one standard, wrapped in an internal package.`, r`Raw client for infrastructure or performance-critical paths.`, r`Re-review licensing and fit at major versions.`],
  ex: r`A bank wrapped its chosen framework in an internal package; 15 teams onboarded with identical retry, outbox and quorum settings, and the audit found one configuration instead of fifteen.`,
  fu: [r`How would you exit a framework if licensing changes?`, r`What goes in the internal package vs team code?`],
  pit: [r`Every team hand-rolling retries and outboxes.`, r`Adopting a framework without checking its licence roadmap.`] },

{ id: 'q47', level: 'Principal', tags: ['governance', 'gitops', 'topology'],
  q: r`How do you govern RabbitMQ topology across many teams: topology as code, change control, drift and auditability?`,
  a: r`### Problem
Topology declared by application code at startup is convenient, but leads to drift, mismatched arguments ({{406}} on deploy), orphaned queues, and no audit trail of who changed a policy.

### Topology as code
- A Git repository per platform (or per vhost) with **definitions**: vhosts, users (without secrets), permissions, exchanges, queues, bindings, policies.
- Applied by a pipeline: {{rabbitmqadmin import}}, the **Kubernetes Messaging Topology Operator** (CRDs for Queue, Exchange, Binding, Policy, Permission), or Terraform's RabbitMQ provider.
- Applications run with **no configure permission** in production (they cannot create topology), which forces changes through the repo.

### Change control (what regulators expect)
- PR review by the owning team and the platform team; CI validation: naming rules, quorum for durable queues, DLX and length limits present, no {{.*}} permissions;
- changes linked to change tickets; automated deployment records; separation of duties (author ≠ approver);
- **drift detection**: nightly export compared with Git; unexpected objects alert.

### Lifecycle
Ownership labels (via naming or a catalogue), deprecation process for exchanges/routing keys, cleanup of unused queues (zero consumers and zero traffic for 30 days → notify owner → delete).

### Dev experience
Developers still declare topology freely in dev/test (same definitions applied by the test harness) so the workflow stays fast.`,
  code: r`~~~yaml
apiVersion: rabbitmq.com/v1beta1
kind: Queue
metadata: { name: ledger-payments-events, namespace: ledger }
spec:
  name: ledger.payments-events
  vhost: payments
  type: quorum
  durable: true
  rabbitmqClusterReference: { name: payments-rmq, namespace: messaging }
---
apiVersion: rabbitmq.com/v1beta1
kind: Binding
metadata: { name: ledger-captured, namespace: ledger }
spec:
  vhost: payments
  source: payments
  destination: ledger.payments-events
  destinationType: queue
  routingKey: "payments.*.captured.v1"
  rabbitmqClusterReference: { name: payments-rmq, namespace: messaging }
~~~`,
  pts: [r`Startup-declared topology drifts and lacks audit.`, r`Definitions in Git via operator, Terraform or import.`, r`Apps have no configure permission in production.`, r`PR review, CI rules, change tickets, drift detection.`, r`Ownership, deprecation and cleanup lifecycle.`],
  ex: r`An auditor asked who changed a DLX policy in March; with topology in Git the answer was a PR link with approver and change ticket in under a minute.`,
  fu: [r`How do you handle emergency changes during an incident?`, r`How do you detect unused queues safely?`],
  pit: [r`Admin-level application credentials in production.`, r`No drift detection.`] },

{ id: 'q48', level: 'Principal', tags: ['compliance', 'pci', 'audit'],
  q: r`What must a RabbitMQ-based system do to satisfy PCI DSS, SOX-style change control and data-protection requirements?`,
  a: r`### Data in messages
- **No PANs, CVVs or full track data** in messages, headers, logs or DLQs: tokenise at the edge; RabbitMQ then stays out of (or minimally in) PCI scope. If cardholder data must transit, encrypt fields at the application layer and treat the whole broker estate, its backups and its admins as in scope.
- Minimise PII; prefer ids; field-level encryption with key rotation; remember DLQs, parking queues, shovels and federation copies are all **copies** of the data.

### Security controls
TLS everywhere, per-app identities, least privilege, MFA/SSO for the management UI, audit of admin actions, vulnerability patching on a defined cadence, network segmentation of broker subnets.

### Change management and evidence
Topology and policies in Git with approvals (q47); deployment records; quarterly access reviews of users and permissions; configuration baselines checked for drift.

### Retention and erasure
- brokers are transient storage: messages should not live for months; DLQs have TTLs and export to controlled storage when needed;
- the **audit trail** (who did what to which payment) belongs in an append-only store or the database, **not** in queues;
- erasure requests (GDPR) are easier when the broker never stores data long term.

### Resilience evidence
DR tests, reconciliation reports, incident postmortems — regulators (DORA in the EU, for example) increasingly expect documented resilience testing of critical third-party and internal platforms.`,
  code: r`~~~csharp
// Tokenise before the message exists; encrypt remaining sensitive fields
var token = await _vault.TokeniseAsync(card.Pan, ct);                      // PAN never leaves the CDE
var evt = new CardPaymentAuthorised(PaymentId: p.Id, CardToken: token, Last4: card.Pan[^4..],
                                    HolderNameEnc: _crypto.Encrypt(card.HolderName, keyId: "pii-2026-10"),
                                    AmountMinor: p.AmountMinor, Currency: p.Currency);
// Message contains token + last4 + encrypted PII: broker, DLQs and logs stay out of cardholder-data scope
~~~`,
  pts: [r`Tokenise PANs before messaging; keep the broker out of PCI scope.`, r`DLQs, shovels and federation are copies of data too.`, r`Security controls plus evidence: access reviews, Git approvals, drift checks.`, r`Brokers are transient; audit trails live elsewhere.`, r`Resilience testing evidence is increasingly regulated.`],
  ex: r`Tokenising at the API gateway removed 12 RabbitMQ nodes and their backups from a PCI assessment's scope.`,
  fu: [r`What counts as cardholder data under PCI DSS?`, r`How do you handle a GDPR erasure for data sitting in a DLQ?`],
  pit: [r`Logging full message bodies with PII at debug level.`, r`Using queues as the audit log.`] },

{ id: 'q49', level: 'Principal', tags: ['migration', 'kafka', 'strangler'],
  q: r`Leadership wants to move event streaming from RabbitMQ to Kafka. Plan the migration so nothing breaks and teams move independently.`,
  a: r`### First, challenge the scope
Move **event streams** that need replay, many consumers or analytics; keep **command/work queues** on RabbitMQ unless there is a reason. Write the target-state ADR (q37) and get agreement on what moves.

### Migration pattern (strangler, per event type)
1. **Dual publish from the outbox**: the relay publishes each event to RabbitMQ (existing) *and* Kafka (new), same MessageId and schema. One outbox, two relays → no new dual-write problem.
2. **Consumers migrate one by one** to Kafka, with idempotent handlers (the inbox dedupes the overlap). Run shadow mode first: consume from Kafka, compare results, do not write.
3. **Verify** per consumer: counts and business totals equal across both paths for a period.
4. **Cut over** consumers; remove their RabbitMQ bindings.
5. When no RabbitMQ bindings remain for the event type (management API shows zero), stop publishing it there.
6. Retire old topology through the governance process.

### Semantics that change — make teams aware
- **Ordering** becomes per partition (choose keys carefully);
- no per-message TTL, priority or delayed redelivery — retries become **retry topics or parking**;
- consumer scaling is bounded by **partitions**;
- offsets and **consumer lag** replace queue depth in dashboards and alerts.

### Programme management
Per-team migration backlog, a platform-provided client library, office hours, a dashboard of migration progress, and an explicit deadline for the dual-publish period (it costs money and complexity).`,
  code: r`~~~csharp
// One outbox, two relays during migration
foreach (var row in batch)
{
    var rabbit = _rabbit.BasicPublishAsync("payments", row.RoutingKey, mandatory: true,
                    new BasicProperties { MessageId = row.Id.ToString(), Type = row.Type, DeliveryMode = DeliveryModes.Persistent }, row.Payload).AsTask();
    var kafka = _kafka.ProduceAsync("payments.events.v1", new Message<string, byte[]>
    {
        Key = row.AggregateId, Value = row.Payload,
        Headers = new Headers { { "message-id", Encoding.UTF8.GetBytes(row.Id.ToString()) }, { "type", Encoding.UTF8.GetBytes(row.Type) } }
    });
    await Task.WhenAll(rabbit, kafka);          // mark published only when both confirm
}
~~~`,
  dia: r`flowchart LR
  OB[(Outbox)] --> R1[Relay to RabbitMQ]
  OB --> R2[Relay to Kafka]
  R1 --> X{{RabbitMQ payments}}
  R2 --> K[(Kafka payments.events.v1)]
  X --> C1[Consumer A - not yet migrated]
  K --> C2[Consumer B - migrated]
  K -.shadow mode.-> C3[Consumer C - comparing]
  X --> C3`,
  pts: [r`Move event streams, not necessarily command queues.`, r`Dual publish from one outbox with the same MessageId.`, r`Consumers migrate independently, shadow first, idempotent.`, r`Teach the semantic changes: partitions, no per-message TTL/delay.`, r`Time-box dual publishing and track progress.`],
  ex: r`A bank migrated 22 consumers over four months with dual publishing; reconciliation per consumer before cut-over caught a key-ordering assumption in one team's service.`,
  fu: [r`How do you migrate a consumer that relies on delayed redelivery?`, r`What if a consumer needs ordering across two event types?`],
  pit: [r`Big-bang cut-over of all consumers.`, r`Two separate outboxes, recreating the dual-write problem.`] },

{ id: 'q50', level: 'Principal', tags: ['principles', 'summary'],
  q: r`Summarise the RabbitMQ principles you would enforce as the Principal Engineer of a payments organisation.`,
  a: r`"My RabbitMQ standards fit on one page:

- **Right tool:** RabbitMQ for commands and work distribution with per-message retry, delay and routing; Kafka (or streams) for replayable event streams.
- **Nothing lost:** outbox → publisher confirms + mandatory/alternate exchange → durable topology, persistent messages, **quorum queues** → manual ack after commit.
- **Nothing doubled:** stable MessageIds, inbox or natural idempotency, idempotency keys at every external boundary, reconciliation as the final detector.
- **Failures are designed:** classify errors, tiered backoff, delivery limits, parking queues with owners, alerts and redrive tooling.
- **Broker protected:** bounded queues by default, claim check for large payloads, singleton connections, separate publish/consume connections, publish timeouts, vhost and user limits.
- **Order only where needed:** consistent-hash shards with single active consumer, and failure handling that respects order.
- **Operable:** alerts on message age, zero consumers, alarms and DLQ depth; OpenTelemetry tracing; graceful shutdown; rehearsed DR with outbox replay.
- **Governed:** topology as code, no configure permission for apps in prod, drift detection, tokenised data, framework standard with reviewed licensing."`,
  code: r`~~~csharp
// The standards, expressed as defaults
var factory = new ConnectionFactory { AutomaticRecoveryEnabled = true, ClientProvidedName = appName };   // singleton, named
var publishCh = await publishConn.CreateChannelAsync(new CreateChannelOptions(true, true));              // confirms + tracking
await consumeCh.BasicQosAsync(0, 32, false);                                                             // bounded prefetch
await consumeCh.BasicConsumeAsync(queue, autoAck: false, consumer);                                     // manual ack after commit
// Topology (Git): quorum queues, DLX + delivery-limit + max-length policies, alternate exchanges, no app configure permission
~~~`,
  pts: [r`Right tool for commands vs streams.`, r`Outbox, confirms, quorum, manual ack: nothing lost.`, r`Idempotency everywhere plus reconciliation: nothing doubled.`, r`Designed failure handling and broker protection.`, r`Observability, DR and governance as standards.`],
  ex: r`Publishing these standards as an internal package plus a topology repository took a payments estate from monthly messaging incidents to roughly one a year.`,
  fu: [r`Which one standard would you enforce first in a legacy estate?`],
  pit: [r`Treating RabbitMQ defaults as production-ready.`] }
],
cheat: r`### Core model
Producer -> **exchange** (direct · topic · fanout · headers) -> **bindings** -> **queues** -> consumers ack. Topic wildcards: {{*}} one word, {{#}} zero or more. Unroutable = dropped unless {{mandatory}} or alternate exchange. Connection = TCP (singleton); channel = cheap, not thread-safe.

### Reliability chain
| Hop | Control |
|---|---|
| App -> broker | outbox + publisher confirms + mandatory/AE |
| In broker | durable exchange + quorum queue + persistent message |
| Broker -> consumer | manual ack after commit; inbox/idempotency |
| External side effects | idempotency keys + reconciliation |

### Queue types
Classic: single node, transient/exclusive use · **Quorum**: Raft, majority confirm, delivery limit (4.0 default 20), 2 priorities · **Stream**: replayable log, offsets, Super Streams. Mirrored classic queues **removed in 4.0**.

### Failure handling
Classify permanent / transient / unknown · tiered TTL retry queues -> DLX back to work queue · parking queue with reason headers, owner, alert, shovel redrive · never {{nack(requeue: true)}} loops · business timers in a table, not the delayed plugin.

### Performance & ops
Prefetch ≈ (RTT + work)/work × concurrency · one queue = one process ceiling -> shard (consistent hash + SAC) · claim check above ~128 KB · bounded queues (reject-publish) · memory/disk alarms block **all** publishers · separate publish/consume connections, publish timeouts · consumer_timeout 30 min -> claim-and-ack for long jobs.

### Operate & govern
Alert on message age, zero consumers, alarms, DLQ depth · Prometheus plugin + OTel traceparent · topology as code, apps without configure permission · vhost/user limits · TLS, no guest, tokenised data · Federation/Shovel across regions, never stretched clusters · DR = DB + outbox replay.

### Say this
"Smart broker, simple consumer." "Exactly-once = at-least-once + idempotency." "A dead consumer plus an unbounded queue is a platform outage." "Commands on RabbitMQ, event streams on Kafka."`
});
})(String.raw);
