(function (r) {
registerTopic('19-kafka', {
related: ['18-event-driven-architecture', '20-rabbitmq', '37-outbox'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['fundamentals', 'architecture'],
  q: r`Explain Kafka's core architecture: topics, partitions, brokers, offsets and consumer groups.`,
  a: r`Kafka is a **distributed, partitioned, replicated commit log**.

- **Topic**: a named stream of records.
- **Partition**: an ordered, append-only log; the unit of parallelism, ordering and replication. Each record gets a monotonically increasing **offset** within its partition.
- **Broker**: a server storing partition replicas. Each partition has one **leader** (serves reads/writes) and **followers** that replicate it.
- **Producer**: appends records; the **key** is hashed (murmur2) to choose the partition, so all records with the same key land in the same partition, in order.
- **Consumer group**: a set of consumers sharing work; each partition is assigned to exactly one consumer in the group. Different groups read independently, each tracking its own committed offsets (stored in the {{__consumer_offsets}} topic).
- **Retention**: records are kept by time/size (or compaction), not deleted on consumption, so consumers can replay.
- **Metadata/controller**: KRaft (Kafka 3.3+ production-ready, ZooKeeper removed in 4.0) manages cluster metadata via a Raft quorum.

Consequences: ordering is per partition only; maximum consumer parallelism per group equals the partition count.`,
  code: r`~~~csharp
var producer = new ProducerBuilder<string, string>(new ProducerConfig { BootstrapServers = "kafka:9092", Acks = Acks.All, EnableIdempotence = true }).Build();
await producer.ProduceAsync("payments.events.v1", new Message<string, string> { Key = paymentId, Value = json });   // same key -> same partition

using var consumer = new ConsumerBuilder<string, string>(new ConsumerConfig
{ BootstrapServers = "kafka:9092", GroupId = "ledger", AutoOffsetReset = AutoOffsetReset.Earliest, EnableAutoCommit = false }).Build();
consumer.Subscribe("payments.events.v1");
var cr = consumer.Consume(ct);
Console.WriteLine($"partition {cr.Partition.Value} offset {cr.Offset.Value}");
~~~`,
  dia: r`flowchart LR
  P[Producer] -->|key hash| T0[Partition 0]
  P --> T1[Partition 1]
  P --> T2[Partition 2]
  subgraph G1[Consumer group: ledger]
    C1[Consumer A]
    C2[Consumer B]
  end
  subgraph G2[Consumer group: analytics]
    C3[Consumer C]
  end
  T0 --> C1
  T1 --> C1
  T2 --> C2
  T0 --> C3
  T1 --> C3
  T2 --> C3`,
  pts: [r`Kafka is a partitioned, replicated append-only log.`, r`Partitions give ordering, parallelism and replication; offsets identify records.`, r`Keys determine partitions, so per-key order is preserved.`, r`Each partition goes to one consumer per group; groups read independently.`, r`Retention, not consumption, deletes data, which enables replay.`],
  ex: r`A payments platform keyed events by payment id across 24 partitions, giving per-payment order and 24-way parallelism for the ledger consumer group.`,
  fu: [r`What limits a consumer group's parallelism?`, r`What changed with KRaft?`],
  pit: [r`Expecting global ordering across a topic.`],
  tip: r`Saying "ordering is per partition, parallelism is per partition" in one sentence shows you understand the central trade-off.` },

{ id: 'q2', level: 'Basic', tags: ['replication', 'durability'],
  q: r`How does Kafka replication work, and what do acks, ISR and min.insync.replicas guarantee?`,
  a: r`Each partition has a **replication factor** (typically 3): one leader, followers fetching from it.

- **ISR (in-sync replicas)**: replicas caught up within {{replica.lag.time.max.ms}}. Only ISR members can become leader (unless unclean election is enabled).
- **High watermark**: the offset up to which all ISR members have the data; consumers only see records below it.
- **acks** (producer):
  - {{acks=0}}: no wait; data loss likely.
  - {{acks=1}}: leader wrote it; lost if the leader dies before followers copy.
  - {{acks=all}}: all current ISR members have it.
- **min.insync.replicas=2** with {{acks=all}}: writes fail ({{NotEnoughReplicas}}) if fewer than 2 replicas are in sync, so an acknowledged write exists on at least 2 brokers.
- **unclean.leader.election.enable=false** (default): never elect an out-of-sync replica, preferring unavailability to loss.

Standard durable configuration: RF=3, min ISR=2, acks=all, idempotent producer. This tolerates one broker failure without losing availability or acknowledged data.`,
  code: r`~~~bash
kafka-topics --bootstrap-server $B --create --topic ledger.postings.v1 --partitions 12 --replication-factor 3 \
  --config min.insync.replicas=2 --config unclean.leader.election.enable=false
kafka-topics --bootstrap-server $B --describe --topic ledger.postings.v1
# Topic: ledger.postings.v1 Partition: 0 Leader: 2 Replicas: 2,3,1 Isr: 2,3,1
kafka-topics --bootstrap-server $B --describe --under-replicated-partitions   # should be empty
~~~`,
  dia: r`sequenceDiagram
  participant P as Producer (acks=all)
  participant L as Leader (broker 2)
  participant F1 as Follower (broker 3)
  participant F2 as Follower (broker 1)
  P->>L: produce batch
  F1->>L: fetch
  F2->>L: fetch
  L-->>F1: records
  L-->>F2: records
  Note over L: high watermark advances when ISR has the data
  L-->>P: ack`,
  pts: [r`Leader plus followers; only in-sync replicas can lead.`, r`acks=all waits for every in-sync replica.`, r`min.insync.replicas=2 refuses writes that would exist on one broker only.`, r`Unclean election off: unavailability rather than data loss.`, r`RF 3, min ISR 2, acks=all tolerates one broker failure.`],
  ex: r`A trading firm running acks=1 lost acknowledged fills during a broker crash; moving to acks=all with min ISR 2 closed the gap at a 2 ms latency cost.`,
  fu: [r`What happens to producers when ISR shrinks to 1?`],
  pit: [r`RF 3 with min.insync.replicas=1, which still allows single-copy writes.`] },

{ id: 'q3', level: 'Basic', tags: ['partitioning', 'keys'],
  q: r`How do you choose partition keys and the number of partitions?`,
  a: r`**Keys**: choose the entity whose events must stay ordered (account id, order id, instrument). Consequences:

- Same key, same partition, in order.
- Skewed keys (one huge merchant, a hot instrument) create hot partitions; consider composite keys or splitting the heavy key if per-key order allows.
- Null keys: sticky partitioning spreads records with no ordering guarantees.

**Partition count**:

- Throughput: target / per-partition throughput (producer and consumer side; a partition commonly handles a few to tens of MB/s, but measure).
- Consumer parallelism: partitions ≥ peak consumer instances needed.
- Growth headroom: adding partitions later **changes the key-to-partition mapping** (hash mod N), breaking per-key ordering for in-flight keys, so over-provision moderately (2-3x).
- Costs of too many: more open files, longer leader elections, more memory per partition for clients, larger metadata. Thousands per broker are fine with KRaft, but avoid tens of thousands without need.`,
  code: r`~~~text
Sizing: card authorisations
Peak 30,000 msg/s x 800 B = 24 MB/s
Measured consumer throughput (DB-bound ledger writer): 1,500 msg/s per instance -> 20 instances at peak
Producer per partition fine at > 10 MB/s
Partitions = max(20 consumers, 24/10 MB) = 20 -> choose 48 for 2x growth + headroom (cannot re-key cleanly later)
Key = card token (velocity rules need per-card order); top card < 0.01% of traffic -> no hot partition
~~~`,
  pts: [r`Key by the entity that needs ordering.`, r`Watch for skewed keys creating hot partitions.`, r`Partitions sized by throughput and consumer parallelism.`, r`Adding partitions later remaps keys; plan headroom.`, r`Too many partitions cost memory, files and failover time.`],
  ex: r`Keying market data by exchange made one partition carry 70% of traffic; keying by instrument spread load evenly while keeping per-instrument order.`,
  fu: [r`How would you add partitions to a keyed topic safely?`],
  pit: [r`Keying by a low-cardinality field such as country.`] },

{ id: 'q4', level: 'Basic', tags: ['consumers', 'offsets'],
  q: r`How do consumer offset commits work, and how do they affect delivery semantics?`,
  a: r`The consumer group stores the **next offset to read** per partition in {{__consumer_offsets}}.

- **Commit after processing** -> **at-least-once**: a crash after processing but before commit causes redelivery.
- **Commit before processing** -> **at-most-once**: a crash after commit but before processing loses the record.
- **Auto-commit** ({{enable.auto.commit=true}}) commits periodically in the background on poll; it can commit offsets of records still being processed (loss) or not yet committed ones (duplicates). Prefer manual commits for business processing, or in the .NET client use {{EnableAutoOffsetStore=false}} and store offsets only after processing, letting auto-commit flush stored offsets.
- **Exactly-once effects**: idempotent processing, or store offsets transactionally with results (same DB transaction), or Kafka transactions for Kafka-to-Kafka pipelines.

Commit frequency trades throughput (fewer commits) against reprocessing after failures.`,
  code: r`~~~csharp
var config = new ConsumerConfig
{
    BootstrapServers = brokers, GroupId = "ledger-writer",
    EnableAutoCommit = true, AutoCommitIntervalMs = 5000,
    EnableAutoOffsetStore = false                         // only offsets we explicitly store get committed
};
using var c = new ConsumerBuilder<string, string>(config).Build();
c.Subscribe("payments.events.v1");
while (!ct.IsCancellationRequested)
{
    var cr = c.Consume(ct);
    await handler.HandleAsync(cr.Message, ct);            // idempotent processing
    c.StoreOffset(cr);                                    // marks offset+1 as safe to commit
}
~~~`,
  pts: [r`Committed offset = next record to read per partition.`, r`Commit after processing gives at-least-once.`, r`Commit before processing gives at-most-once.`, r`Avoid naive auto-commit; store offsets after processing.`, r`Exactly-once effects need idempotency or transactional offsets.`],
  ex: r`Naive auto-commit lost 300 payment events when a pod was OOM-killed; switching to StoreOffset after processing made recovery lossless.`,
  fu: [r`Why can auto-commit lose messages?`],
  pit: [r`Committing offsets of a batch before all items finish.`] },

{ id: 'q5', level: 'Basic', tags: ['rebalancing'],
  q: r`What is a consumer group rebalance, why does it hurt, and how do you minimise it?`,
  a: r`A **rebalance** redistributes partitions among a group's consumers when membership or subscriptions change: consumer joins/leaves, crash, missed heartbeats ({{session.timeout.ms}}), or exceeding {{max.poll.interval.ms}} between polls.

Why it hurts: with the classic **eager** protocol every consumer revokes all partitions, pausing the whole group; in-flight work is redelivered (duplicates); frequent rebalances ("storms") stall consumption.

Mitigations:

- **Cooperative sticky assignor** (incremental rebalancing): only moved partitions are revoked.
- **Static membership** ({{group.instance.id}}): a restarting pod rejoins with its identity without triggering a rebalance within the session timeout (good for rolling deploys).
- **Keep poll loops fast**: process within {{max.poll.interval.ms}}; reduce {{max.poll.records}} for slow handlers or hand work off while pausing partitions.
- **Commit on revocation** (partitions-revoked handler) to reduce duplicates.
- **New consumer rebalance protocol** (KIP-848, {{group.protocol=consumer}}, GA in Kafka 4.0): broker-driven incremental assignment, no global synchronisation barrier.`,
  code: r`~~~csharp
var config = new ConsumerConfig
{
    BootstrapServers = brokers, GroupId = "positions",
    PartitionAssignmentStrategy = PartitionAssignmentStrategy.CooperativeSticky,
    GroupInstanceId = Environment.GetEnvironmentVariable("POD_NAME"),   // static membership (StatefulSet name)
    SessionTimeoutMs = 45000, MaxPollIntervalMs = 300000
};
using var c = new ConsumerBuilder<string, string>(config)
    .SetPartitionsRevokedHandler((consumer, revoked) => consumer.Commit())   // flush progress before losing partitions
    .Build();
~~~`,
  pts: [r`Rebalances reassign partitions on membership changes or slow polls.`, r`Eager rebalances pause the whole group and cause duplicates.`, r`Use cooperative sticky assignment and static membership.`, r`Keep processing within max.poll.interval.ms.`, r`KIP-848 moves assignment to the broker incrementally.`],
  ex: r`A 40-pod consumer group rebalanced 40 times during each rolling deploy; static membership plus cooperative sticky reduced deploy-time lag from 8 minutes to seconds.`,
  fu: [r`What triggers max.poll.interval.ms violations?`],
  pit: [r`Long synchronous processing inside the poll loop with default settings.`] },

{ id: 'q6', level: 'Basic', tags: ['retention', 'compaction'],
  q: r`Explain retention policies: delete vs compact, and when to use each.`,
  a: r`- **cleanup.policy=delete**: segments older than {{retention.ms}} (or beyond {{retention.bytes}} per partition) are deleted. Used for event streams where history beyond a window is not needed in Kafka (archive elsewhere).
- **cleanup.policy=compact**: the log cleaner keeps at least the latest record per key; older values for that key are eventually removed. A **tombstone** (null value) deletes the key after {{delete.retention.ms}}. Used for latest-state topics: reference data, CDC of current rows, Kafka Streams changelogs, {{__consumer_offsets}}.
- **compact,delete**: compaction plus time-based deletion.

Notes: retention works at the **segment** level (the active segment is never deleted or compacted), so data may live longer than configured; compaction is asynchronous, consumers can still see older values; **tiered storage** (KIP-405, GA in 3.9) offloads old segments to object storage to keep long retention cheap.`,
  code: r`~~~bash
# Event history: 7 days hot, older segments tiered to object storage, 1 year total
kafka-configs --bootstrap-server $B --alter --entity-type topics --entity-name payments.events.v1 \
  --add-config retention.ms=31536000000,remote.storage.enable=true,local.retention.ms=604800000
# Latest state per key
kafka-topics --bootstrap-server $B --create --topic accounts.state.v1 --partitions 12 --replication-factor 3 \
  --config cleanup.policy=compact --config min.cleanable.dirty.ratio=0.3 --config delete.retention.ms=86400000
~~~`,
  pts: [r`delete removes old segments by time or size.`, r`compact keeps the latest value per key; tombstones delete keys.`, r`compact,delete combines both.`, r`Retention is per segment, so data can outlive the setting.`, r`Tiered storage makes long retention affordable.`],
  ex: r`Tiered storage let an exchange keep a year of order events replayable in Kafka while local disks held only 7 days.`,
  fu: [r`Why might a deleted key still be readable?`],
  pit: [r`Using compaction for topics without meaningful keys.`] },

{ id: 'q7', level: 'Intermediate', tags: ['idempotent-producer', 'exactly-once'],
  q: r`How does the idempotent producer work, and what does it not protect against?`,
  a: r`With {{enable.idempotence=true}} (default since Kafka 3.0 clients) the producer gets a **producer id (PID)** and attaches a **sequence number** per partition to each batch. The broker rejects duplicates (same PID, partition, sequence) and detects gaps. Result: retries after network errors do not create duplicates, and ordering holds with up to 5 in-flight requests.

It requires {{acks=all}}, retries > 0 and {{max.in.flight.requests.per.connection <= 5}}.

It does **not** protect against:

- **Application-level resends**: your code calls Produce twice for the same business event (e.g. after a crash and restart, a new PID is assigned). Dedupe at consumers or use deterministic keys/ids.
- **Duplicates across producer restarts** unless you use transactions with a stable {{transactional.id}}.
- **Consumer-side duplicates** from reprocessing.

So the idempotent producer handles retry duplicates within a session; end-to-end exactly-once still needs transactions or idempotent consumers.`,
  code: r`~~~csharp
var config = new ProducerConfig
{
    BootstrapServers = brokers,
    EnableIdempotence = true,             // PID + per-partition sequence numbers
    Acks = Acks.All,
    MaxInFlight = 5,
    MessageSendMaxRetries = int.MaxValue,
    DeliveryTimeoutMs = 120000,           // bound total time instead of retry count
    LingerMs = 5, CompressionType = CompressionType.Zstd
};
// Business-level dedupe still required: include a stable event id header
var msg = new Message<string, string> { Key = orderId, Value = json, Headers = new Headers { { "event-id", Encoding.UTF8.GetBytes(eventId) } } };
~~~`,
  pts: [r`PID plus per-partition sequence numbers let brokers drop duplicate batches.`, r`Keeps order with up to 5 in-flight requests.`, r`Requires acks=all and retries.`, r`Does not stop application-level resends or restarts duplicating.`, r`End-to-end needs transactions or idempotent consumers.`],
  ex: r`Enabling idempotence removed duplicate fills caused by network retries, but a relay restart still duplicated events until consumers deduped on event id.`,
  fu: [r`What is OutOfOrderSequenceException?`],
  pit: [r`Claiming the idempotent producer gives exactly-once end to end.`] },

{ id: 'q8', level: 'Intermediate', tags: ['transactions', 'eos'],
  q: r`Explain Kafka transactions and exactly-once semantics for read-process-write.`,
  a: r`Kafka transactions let a producer **atomically write to multiple partitions and commit consumer offsets** in one transaction.

Flow:

1. {{InitTransactions}} with a stable {{transactional.id}}: the coordinator fences older producers with the same id (zombie fencing via epoch).
2. {{BeginTransaction}}, produce output records, {{SendOffsetsToTransaction}} for the consumed input offsets.
3. {{CommitTransaction}}: the coordinator writes commit markers to all partitions.
4. Consumers with {{isolation.level=read_committed}} see only committed records (they read up to the last stable offset).

This gives **exactly-once for Kafka-to-Kafka** pipelines (consume, transform, produce). It does **not** cover external side effects (database writes, HTTP calls): for those use idempotent writes or store offsets in the same database transaction.

Costs: extra latency per commit (batch many records per transaction), coordinator load, read_committed consumers wait for open transactions (long transactions delay them).`,
  code: r`~~~csharp
using var producer = new ProducerBuilder<string, string>(new ProducerConfig
{ BootstrapServers = b, TransactionalId = "fx-enricher-" + partitionGroup, EnableIdempotence = true }).Build();
producer.InitTransactions(TimeSpan.FromSeconds(30));
using var consumer = new ConsumerBuilder<string, string>(new ConsumerConfig
{ BootstrapServers = b, GroupId = "fx-enricher", EnableAutoCommit = false, IsolationLevel = IsolationLevel.ReadCommitted }).Build();
consumer.Subscribe("trades.raw");
while (!ct.IsCancellationRequested)
{
    var batch = ConsumeBatch(consumer, max: 500, TimeSpan.FromMilliseconds(100));
    if (batch.Count == 0) continue;
    producer.BeginTransaction();
    try
    {
        foreach (var cr in batch) producer.Produce("trades.enriched", new Message<string, string> { Key = cr.Message.Key, Value = Enrich(cr.Message.Value) });
        producer.SendOffsetsToTransaction(batch.Select(cr => new TopicPartitionOffset(cr.TopicPartition, cr.Offset + 1)), consumer.ConsumerGroupMetadata, TimeSpan.FromSeconds(10));
        producer.CommitTransaction();
    }
    catch (KafkaException) { producer.AbortTransaction(); RewindToCommitted(consumer); }
}
~~~`,
  dia: r`sequenceDiagram
  participant App as Processor
  participant TC as Transaction coordinator
  participant Out as Output partitions
  participant CO as Consumer offsets topic
  App->>TC: InitTransactions (fence zombies)
  App->>TC: BeginTransaction
  App->>Out: produce records
  App->>CO: SendOffsetsToTransaction
  App->>TC: CommitTransaction
  TC->>Out: commit markers
  TC->>CO: commit markers
  Note over Out: read_committed consumers now see records`,
  pts: [r`Transactions atomically write outputs and consumed offsets.`, r`transactional.id plus epochs fence zombie producers.`, r`read_committed consumers see only committed data.`, r`Exactly-once covers Kafka-to-Kafka only.`, r`Batch per transaction; long transactions delay readers.`],
  ex: r`An FX enrichment stream moved to transactions and eliminated duplicate enriched trades that previously appeared after every rebalance.`,
  fu: [r`How do you get exactly-once into a SQL database?`],
  pit: [r`Assuming transactions make database writes exactly-once.`] },

{ id: 'q9', level: 'Intermediate', tags: ['producer-performance'],
  q: r`How do you tune a Kafka producer for throughput and latency?`,
  a: r`Key settings:

- **linger.ms**: wait up to N ms to fill batches (5-20 ms often doubles throughput with small latency cost).
- **batch.size**: max bytes per partition batch (e.g. 64-256 KB for throughput).
- **compression.type**: zstd or lz4 (batches compress better; reduces network and disk).
- **acks=all + idempotence** for durability; latency cost is one replication round-trip.
- **max.in.flight.requests.per.connection**: up to 5 keeps ordering with idempotence.
- **buffer.memory / queue.buffering.max.messages** (librdkafka): backpressure when brokers are slow; Produce blocks or throws when full.
- **Asynchronous produce**: in .NET use {{Produce}} with a delivery handler (or many concurrent {{ProduceAsync}}) rather than awaiting each message sequentially.
- **One producer instance per process** (thread-safe, maintains batching and connections).

Measure: record-send-rate, batch-size-avg, compression-rate, request-latency, record-retry-rate.`,
  code: r`~~~csharp
var producer = new ProducerBuilder<string, byte[]>(new ProducerConfig
{
    BootstrapServers = b, Acks = Acks.All, EnableIdempotence = true,
    LingerMs = 10, BatchSize = 262144, CompressionType = CompressionType.Zstd,
    QueueBufferingMaxKbytes = 1048576
}).Build();
// Anti-pattern: await each send in a loop (one round-trip per message)
// foreach (var m in msgs) await producer.ProduceAsync(topic, m);
// Better: fire and track deliveries
foreach (var m in msgs)
    producer.Produce(topic, m, report => { if (report.Error.IsError) failures.Enqueue((m, report.Error)); });
producer.Flush(TimeSpan.FromSeconds(30));
~~~`,
  pts: [r`linger.ms and batch.size create efficient batches.`, r`zstd or lz4 compression cuts network and disk.`, r`Keep acks=all with idempotence for business data.`, r`Produce asynchronously; do not await each message.`, r`Reuse one producer per process and watch its metrics.`],
  ex: r`Changing a market-data publisher from awaiting each ProduceAsync to batched Produce raised throughput from 2,000 to 180,000 msg/s.`,
  fu: [r`What happens when the producer buffer fills?`],
  pit: [r`Creating a new producer per message or request.`] },

{ id: 'q10', level: 'Intermediate', tags: ['consumer-performance'],
  q: r`A consumer cannot keep up. How do you increase consumer throughput?`,
  a: r`1. **Measure where time goes**: deserialisation, external calls (database), commits, GC.
2. **Scale out** up to the partition count (more instances in the group).
3. **Batch work**: consume many records, write to the database in bulk (COPY, SqlBulkCopy, multi-row upserts), commit offsets once per batch.
4. **Parallelism within a partition by key**: dispatch records to N workers keyed by record key, preserving per-key order; commit only the contiguous processed offset (or use a library such as Confluent Parallel Consumer pattern).
5. **Fetch tuning**: {{fetch.min.bytes}}, {{fetch.max.wait.ms}}, {{max.partition.fetch.bytes}} for larger fetches.
6. **Avoid per-message synchronous I/O**: cache reference data, async pipelines with bounded concurrency.
7. **Increase partitions** if instances are already maxed (plan for key remapping).

Track lag and lag growth rate; scale on lag (KEDA).`,
  code: r`~~~csharp
// Batch consume + bulk write + one offset store per batch
var buffer = new List<ConsumeResult<string, string>>(1000);
while (!ct.IsCancellationRequested)
{
    var cr = consumer.Consume(TimeSpan.FromMilliseconds(50));
    if (cr is not null) buffer.Add(cr);
    if (buffer.Count >= 1000 || (cr is null && buffer.Count > 0))
    {
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        await using var writer = await conn.BeginBinaryImportAsync("COPY staging_postings (event_id, account, amount) FROM STDIN (FORMAT BINARY)", ct);
        foreach (var r in buffer) { var p = Parse(r.Message.Value); await writer.StartRowAsync(ct); await writer.WriteAsync(p.EventId, ct); await writer.WriteAsync(p.Account, ct); await writer.WriteAsync(p.Amount, ct); }
        await writer.CompleteAsync(ct);
        await MergeStagingAsync(conn, ct);                  // INSERT ... ON CONFLICT (event_id) DO NOTHING
        foreach (var last in buffer.GroupBy(x => x.TopicPartition).Select(g => g.Last())) consumer.StoreOffset(last);
        buffer.Clear();
    }
}
~~~`,
  pts: [r`Profile first: I/O, deserialisation, commits.`, r`Scale out to the partition count.`, r`Batch database writes and offset commits.`, r`Parallelise by key within partitions when order is per key.`, r`Tune fetches and scale on lag.`],
  ex: r`Switching a ledger consumer from per-row inserts to COPY batches raised throughput from 800 to 25,000 records/s per instance.`,
  fu: [r`How do you commit offsets safely with parallel processing?`],
  pit: [r`Adding consumers beyond the partition count.`] },

{ id: 'q11', level: 'Intermediate', tags: ['schema-registry'],
  q: r`How do you use a schema registry with Kafka in .NET, and which compatibility mode do you choose?`,
  a: r`A schema registry stores versioned schemas per **subject** (by default {{<topic>-value}}). Serializers register/look up the schema and prefix each message with a magic byte and **schema id**; deserializers fetch the writer schema by id.

Formats: **Avro** (compact, strong evolution rules), **Protobuf** (good .NET codegen, field numbers), **JSON Schema** (readable, weaker evolution).

Compatibility modes:

- **BACKWARD** (default): consumers using the new schema can read data written with the previous one. Upgrade consumers first. Allowed: delete fields, add fields with defaults.
- **FORWARD**: old consumers can read new data. Upgrade producers first.
- **FULL**: both.
- **_TRANSITIVE** variants check against all prior versions, which matters for replay of old data.

For event topics with replay and many independent consumers, **FULL_TRANSITIVE** or **BACKWARD_TRANSITIVE** is safest. Set {{auto.register.schemas=false}} in production; register schemas from CI.`,
  code: r`~~~csharp
var registry = new CachedSchemaRegistryClient(new SchemaRegistryConfig { Url = registryUrl, BasicAuthUserInfo = creds });
var producer = new ProducerBuilder<string, PaymentCaptured>(producerConfig)
    .SetValueSerializer(new ProtobufSerializer<PaymentCaptured>(registry, new ProtobufSerializerConfig
    {
        AutoRegisterSchemas = false,                  // CI registers; prod only uses
        UseLatestVersion = true,
        SubjectNameStrategy = SubjectNameStrategy.Topic
    }))
    .Build();
var consumer = new ConsumerBuilder<string, PaymentCaptured>(consumerConfig)
    .SetValueDeserializer(new ProtobufDeserializer<PaymentCaptured>().AsSyncOverAsync())
    .Build();
~~~`,
  pts: [r`Messages carry a schema id; registry stores versions per subject.`, r`Avro, Protobuf or JSON Schema with different evolution rules.`, r`BACKWARD: upgrade consumers first; FORWARD: producers first.`, r`Transitive modes protect replay of old data.`, r`Disable auto-registration in production; register from CI.`],
  ex: r`FULL_TRANSITIVE compatibility let a team replay two years of trade events through a new consumer without a single deserialisation failure.`,
  fu: [r`TopicNameStrategy vs RecordNameStrategy?`],
  pit: [r`Auto-registering schemas from production producers.`] },

{ id: 'q12', level: 'Intermediate', tags: ['connect', 'cdc'],
  q: r`What is Kafka Connect, and how do you run it reliably?`,
  a: r`**Kafka Connect** is a framework for moving data between Kafka and external systems with **connectors**: sources (Debezium CDC, JDBC, S3) and sinks (JDBC, Elasticsearch/OpenSearch, S3, Snowflake).

Concepts:

- **Workers** in distributed mode form a cluster; connector configs, offsets and status live in Kafka topics.
- **Tasks** are the parallel units of a connector.
- **Converters** (Avro/Protobuf/JSON with schema registry) and **Single Message Transforms** (SMTs) for lightweight changes (routing, field masking).
- **Error handling**: {{errors.tolerance}}, dead-letter topics for sinks, logging.

Reliability: run on Kubernetes (Strimzi) or managed (Confluent, MSK Connect); monitor task status and lag; version connector configs in Git; size tasks to partitions; secure credentials via config providers (vaults). Exactly-once source support exists for some connectors (KIP-618).`,
  code: r`~~~json
{
  "name": "payments-to-opensearch",
  "config": {
    "connector.class": "io.confluent.connect.elasticsearch.ElasticsearchSinkConnector",
    "topics": "payments.events.v1",
    "tasks.max": "6",
    "connection.url": "https://search.internal:9200",
    "key.ignore": "false",
    "write.method": "upsert",
    "behavior.on.malformed.documents": "warn",
    "errors.tolerance": "all",
    "errors.deadletterqueue.topic.name": "dlq.payments-to-opensearch",
    "errors.deadletterqueue.context.headers.enable": "true",
    "transforms": "mask",
    "transforms.mask.type": "org.apache.kafka.connect.transforms.MaskField$Value",
    "transforms.mask.fields": "cardholderName"
  }
}
~~~`,
  pts: [r`Connect moves data via source and sink connectors.`, r`Distributed workers store config, offsets and status in Kafka.`, r`Converters with schema registry; SMTs for light transforms.`, r`DLQs and error tolerance for sinks.`, r`Run on Strimzi or managed; configs in Git; monitor tasks.`],
  ex: r`A Debezium source plus OpenSearch sink replaced a nightly search reindex with sub-second updates.`,
  fu: [r`When is an SMT the wrong tool?`],
  pit: [r`Complex business logic in SMT chains.`] },

{ id: 'q13', level: 'Intermediate', tags: ['security'],
  q: r`How do you secure a Kafka cluster?`,
  a: r`- **Encryption in transit**: TLS listeners for clients and inter-broker traffic.
- **Authentication**: mTLS, SASL/SCRAM, or SASL/OAUTHBEARER (OIDC, managed identities; MSK IAM auth; Event Hubs Entra ID).
- **Authorisation**: ACLs per principal on topics (Read, Write, Describe), consumer groups and transactional ids; deny by default ({{allow.everyone.if.no.acl.found=false}}); prefixed ACLs per team namespace.
- **Encryption at rest**: disk/volume encryption (cloud KMS); client-side field encryption for highly sensitive fields.
- **Network**: private endpoints/VPC only; no public brokers.
- **Quotas** per client to contain abuse.
- **Audit logs** of authorisation decisions (Confluent audit logs, MSK CloudTrail).
- **Secrets** for Connect via config providers; rotate credentials.`,
  code: r`~~~csharp
var config = new ConsumerConfig
{
    BootstrapServers = "broker1:9093,broker2:9093",
    SecurityProtocol = SecurityProtocol.SaslSsl,
    SaslMechanism = SaslMechanism.OAuthBearer,
    SaslOauthbearerMethod = SaslOauthbearerMethod.Oidc,
    SaslOauthbearerClientId = "ledger-svc",
    SaslOauthbearerClientSecret = secretFromVault,
    SaslOauthbearerTokenEndpointUrl = "https://login.example.com/oauth2/token",
    SslCaLocation = "/etc/ssl/certs/ca.pem",
    GroupId = "ledger"
};
~~~
~~~bash
kafka-acls --bootstrap-server $B --command-config admin.properties --add --allow-principal User:ledger-svc \
  --operation Read --topic payments. --resource-pattern-type prefixed --group ledger
~~~`,
  pts: [r`TLS everywhere, including inter-broker.`, r`Authenticate with mTLS, SCRAM or OAuth/OIDC.`, r`Least-privilege ACLs, deny by default, prefixed per team.`, r`Encrypt at rest; field-level encryption for sensitive data.`, r`Private networking, quotas, audit logs and secret rotation.`],
  ex: r`Moving from a shared SCRAM user to per-service OIDC identities let a bank show auditors exactly which service could read cardholder topics.`,
  fu: [r`How do ACLs apply to transactional producers?`],
  pit: [r`PLAINTEXT listeners inside a "trusted" network.`] },

{ id: 'q14', level: 'Intermediate', tags: ['monitoring'],
  q: r`Which Kafka metrics do you monitor and alert on?`,
  a: r`**Cluster health**:

- Under-replicated partitions and under-min-ISR partitions (data-loss risk): alert if > 0.
- Offline partitions, active controller count (exactly 1 with KRaft quorum healthy).
- Request latency (produce/fetch p99), request queue time, network/IO thread idle ratio.
- Disk usage and growth, ISR shrink/expand rate.

**Clients**:

- **Consumer lag** per group/partition, and lag **growth rate** / time-based lag (seconds behind).
- Producer error and retry rates, record send rate, request latency.
- Rebalance frequency.

**Business**: end-to-end latency (event time to processed), DLQ counts.

Tools: JMX exporter + Prometheus/Grafana, Burrow or kafka-lag-exporter for lag, Confluent Control Center, CloudWatch for MSK, Azure Monitor for Event Hubs.`,
  code: r`~~~promql
# Under-replicated partitions (any is bad)
sum(kafka_server_replicamanager_underreplicatedpartitions) > 0
# Time-based consumer lag (kafka-lag-exporter) for critical groups
max by (group) (kafka_consumergroup_group_max_lag_seconds{group=~"ledger|positions"}) > 60
# Lag growing for 10 minutes
deriv(sum by (group) (kafka_consumergroup_group_lag)[10m:1m]) > 0
# Produce p99 latency
histogram_quantile(0.99, sum by (le) (rate(kafka_network_requestmetrics_totaltimems_bucket{request="Produce"}[5m])))
~~~`,
  pts: [r`Alert on under-replicated and under-min-ISR partitions.`, r`Track controller health, request latency and thread idle ratios.`, r`Consumer lag in seconds and its growth rate.`, r`Producer errors, retries and rebalance frequency.`, r`End-to-end latency and DLQ counts for business impact.`],
  ex: r`A lag-in-seconds alert caught a stuck positions consumer 15 minutes before the risk desk noticed stale exposures.`,
  fu: [r`Why is lag in seconds better than lag in messages?`],
  pit: [r`Monitoring brokers but not consumer lag.`] },

{ id: 'q15', level: 'Intermediate', tags: ['dotnet', 'hosted-service'],
  q: r`How do you implement a robust Kafka consumer as a .NET BackgroundService?`,
  a: r`Concerns:

- **Dedicated thread**: {{Consume}} is blocking; run the loop on a long-running task, not on the thread pool with sync-over-async.
- **Graceful shutdown**: on cancellation, finish the current record/batch, store/commit offsets, call {{Close()}} to leave the group cleanly (fast rebalance).
- **Error handling**: transient errors retried with backoff; permanent ones to DLQ; never swallow and commit silently; crash-and-restart for fatal errors.
- **DI scopes**: create a scope per record/batch for scoped services (DbContext).
- **Observability**: trace context from headers, metrics for processing time and errors.
- **Health checks**: report unhealthy if the loop has not progressed for a period.
- **Configuration** via options, with static membership from the pod name.`,
  code: r`~~~csharp
public sealed class PaymentsConsumer(IServiceScopeFactory scopes, IOptions<KafkaOptions> opt, ILogger<PaymentsConsumer> log) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stop) => Task.Factory.StartNew(() => Run(stop), TaskCreationOptions.LongRunning);

    private void Run(CancellationToken stop)
    {
        using var consumer = new ConsumerBuilder<string, string>(opt.Value.ToConsumerConfig()).Build();
        consumer.Subscribe("payments.events.v1");
        try
        {
            while (!stop.IsCancellationRequested)
            {
                var cr = consumer.Consume(stop);
                using var activity = KafkaTracing.StartConsumeActivity(cr);           // traceparent from headers
                using var scope = scopes.CreateScope();
                scope.ServiceProvider.GetRequiredService<IPaymentHandler>().HandleAsync(cr.Message, stop).GetAwaiter().GetResult();
                consumer.StoreOffset(cr);
            }
        }
        catch (OperationCanceledException) { }
        finally { consumer.Close(); }                                                    // commit stored offsets and leave group
    }
}
~~~`,
  pts: [r`Run the blocking loop on a long-running dedicated thread.`, r`Graceful shutdown: finish work, commit, Close the consumer.`, r`Retry transient errors, DLQ permanent ones, never swallow.`, r`Scoped DI per record or batch.`, r`Tracing, metrics and a progress-based health check.`],
  ex: r`Adding consumer.Close() on shutdown cut rebalance pauses during deployments from 45 seconds (session timeout) to under 2.`,
  fu: [r`How do you detect a stuck consume loop?`],
  pit: [r`Running Consume inside an async loop on the thread pool.`] },

{ id: 'q16', level: 'Intermediate', tags: ['ordering', 'retries'],
  q: r`How do you handle a failing record without blocking the partition or breaking per-key ordering?`,
  a: r`Options:

- **Blocking retry**: retry in place with backoff. Preserves order; blocks the whole partition (all keys) while failing. Fine for brief transient errors.
- **Non-blocking retry topics** ({{orders.retry.1m}}, {{.10m}}, then DLQ): unblocks the partition but breaks order for that key if later records are processed first.
- **Key-aware parking**: when a record for key K fails, park it and **all subsequent records for K** in a retry store until K is fixed; other keys continue. Preserves per-key order without blocking the partition. More complex (state store).
- **Pause the partition** when a shared dependency is down (consumer.Pause/Resume), avoiding pointless retries.

Choose based on whether ordering matters for the domain (account balances: yes; notifications: no).`,
  code: r`~~~csharp
// Key-aware parking: once a key fails, its later records go to the park store in order
public async Task HandleAsync(ConsumeResult<string, string> cr, CancellationToken ct)
{
    if (await parked.IsParkedAsync(cr.Message.Key, ct))
    {
        await parked.AppendAsync(cr.Message.Key, cr, ct);         // keep order behind the failed record
        return;
    }
    try { await handler.HandleAsync(cr.Message, ct); }
    catch (TransientException) when (Attempts(cr) < 3) { throw; }   // blocking retry for short glitches
    catch (Exception ex)
    {
        await parked.ParkAsync(cr.Message.Key, cr, ex, ct);       // replayed in order by a recovery worker
    }
}
~~~`,
  pts: [r`Blocking retries keep order but stall the partition.`, r`Retry topics unblock but break per-key order.`, r`Key-aware parking keeps per-key order without stalling others.`, r`Pause partitions when a shared dependency is down.`, r`Choose by whether the domain needs ordering.`],
  ex: r`Key-aware parking fixed balance projections that went wrong when retry topics let a later debit overtake an earlier credit.`,
  fu: [r`How does a recovery worker replay parked keys?`],
  pit: [r`Retry topics for order-sensitive account events.`] },

{ id: 'q17', level: 'Intermediate', tags: ['kafka-vs-queues'],
  q: r`Kafka vs RabbitMQ vs Azure Service Bus: when is Kafka the wrong choice?`,
  a: r`Kafka is excellent for high-throughput event streams, replay, many consumer groups, stream processing and CDC.

It is the wrong (or awkward) choice when you need:

- **Per-message features**: delayed delivery, priorities, per-message TTL, per-message acknowledgement and selective redelivery (queues do this natively).
- **Competing consumers beyond partition count** for task queues with uneven processing times (Kafka parallelism is bounded by partitions, though Kafka 4.x "share groups" (KIP-932, early access) begin to address this).
- **Complex routing** by headers/patterns (RabbitMQ exchanges).
- **Request/reply** and transactions with sessions (Service Bus).
- **Very low volume** with simple needs where operating Kafka is overhead.
- **Many tiny topics** per tenant/user.

Common split: Kafka for events and streams; Service Bus/RabbitMQ/SQS for commands and work queues.`,
  code: r`~~~text
Requirement                                     Kafka   RabbitMQ  Service Bus
Replay last 7 days for a new consumer            yes     streams   no
20 consumer groups on the same stream            yes     copies    copies (subscriptions)
Delay message for 30 minutes                     no      plugin    yes (scheduled)
Priority queue                                   no      yes       no
Per-message DLQ after N deliveries               manual  yes       yes
Ordered per session/key                          yes     limited   yes (sessions)
1M msg/s sustained                               yes     hard      premium units
~~~`,
  pts: [r`Kafka excels at streams, replay and fan-out.`, r`Queues win for delays, priorities and per-message ack.`, r`Kafka parallelism is bounded by partitions.`, r`Complex routing and request/reply favour RabbitMQ or Service Bus.`, r`Many organisations use Kafka plus a queue service.`],
  ex: r`A team built delayed retries on Kafka with polling topics; moving those commands to Service Bus scheduled messages removed 2,000 lines of code.`,
  fu: [r`What are Kafka share groups?`],
  pit: [r`Using Kafka as a priority job queue.`] },

{ id: 'q18', level: 'Intermediate', tags: ['testing'],
  q: r`How do you test Kafka producers and consumers in .NET?`,
  a: r`- **Unit tests**: isolate handlers from Kafka (handler takes a message object); test serialisation separately.
- **Integration tests** with **Testcontainers** (Kafka in KRaft mode, schema registry container): produce, consume, assert effects; verify offsets and DLQ behaviour.
- **Failure tests**: duplicates (produce the same record twice), out-of-order versions, poison messages, consumer restart mid-batch (assert no loss), rebalance (start a second consumer).
- **Contract tests**: schema compatibility checks against the registry in CI.
- **Performance tests**: producer and consumer throughput under realistic message sizes; lag under load.
- Avoid timing-based sleeps: poll with timeouts until expected state.`,
  code: r`~~~csharp
public sealed class LedgerConsumerTests : IAsyncLifetime
{
    private readonly KafkaContainer _kafka = new KafkaBuilder().WithImage("confluentinc/cp-kafka:7.7.1").Build();
    public Task InitializeAsync() => _kafka.StartAsync();
    public Task DisposeAsync() => _kafka.DisposeAsync().AsTask();

    [Fact]
    public async Task Duplicate_events_post_once()
    {
        using var p = new ProducerBuilder<string, string>(new ProducerConfig { BootstrapServers = _kafka.GetBootstrapAddress() }).Build();
        var evt = Json(new PaymentCaptured("pay_1", 100));
        await p.ProduceAsync("payments", new Message<string, string> { Key = "pay_1", Value = evt });
        await p.ProduceAsync("payments", new Message<string, string> { Key = "pay_1", Value = evt });
        await using var app = await StartConsumerAsync(_kafka.GetBootstrapAddress());
        await Eventually(async () => (await app.Ledger.CountAsync("pay_1")).Should().Be(1), TimeSpan.FromSeconds(20));
    }
}
~~~`,
  pts: [r`Unit-test handlers without Kafka.`, r`Testcontainers for real broker and registry tests.`, r`Test duplicates, ordering, poison messages and restarts.`, r`Schema compatibility checks in CI.`, r`Poll for expected state instead of sleeping.`],
  ex: r`A restart-mid-batch test exposed offsets committed before the database write; fixing it removed a rare production data loss.`,
  fu: [r`How do you simulate a rebalance in a test?`],
  pit: [r`Only testing with mocked IProducer and IConsumer interfaces.`] },

{ id: 'q19', level: 'Senior', tags: ['streams', 'stateful'],
  q: r`Explain stateful stream processing with Kafka Streams or Flink: state stores, changelogs, windows.`,
  a: r`Stateful operators (aggregations, joins, windows) keep **local state** per partition:

- **Kafka Streams**: state in RocksDB stores, each backed by a compacted **changelog topic**; on failure or rebalance, a new instance restores state from the changelog (standby replicas speed this). Exactly-once via transactions ({{processing.guarantee=exactly_once_v2}}).
- **Flink**: state in memory/RocksDB with periodic **checkpoints** to durable storage (barrier-based snapshots); recovery restores checkpoints and rewinds Kafka offsets; two-phase-commit sinks give end-to-end exactly-once.

**Windows**: tumbling, hopping, sliding, session; based on **event time** with **grace periods**/watermarks for late data.

**Joins**: stream-stream (windowed), stream-table (enrichment with a KTable from a compacted topic), table-table.

Operational concerns: state size and restore time, repartition topics created when re-keying, co-partitioning requirements for joins, upgrading topologies.

.NET note: Kafka Streams is JVM; .NET options include Streamiz (community), Flink via SQL/Java, or managed services (ksqlDB, Azure Stream Analytics).`,
  code: r`~~~sql
-- Flink SQL: per-merchant 1-minute tumbling totals with event time and 10s allowed lateness
CREATE TABLE payments (
  merchant_id STRING, amount_minor BIGINT, event_time TIMESTAMP(3),
  WATERMARK FOR event_time AS event_time - INTERVAL '10' SECOND
) WITH ('connector' = 'kafka', 'topic' = 'payments.events.v1', 'properties.bootstrap.servers' = 'kafka:9092',
        'format' = 'avro-confluent', 'avro-confluent.url' = 'http://registry:8081', 'scan.startup.mode' = 'group-offsets');

INSERT INTO merchant_minute_totals
SELECT merchant_id, window_start, SUM(amount_minor) AS total_minor, COUNT(*) AS txns
FROM TABLE(TUMBLE(TABLE payments, DESCRIPTOR(event_time), INTERVAL '1' MINUTE))
GROUP BY merchant_id, window_start, window_end;
~~~`,
  dia: r`flowchart LR
  IN[(payments topic)] --> T1[Task partition 0]
  IN --> T2[Task partition 1]
  T1 --- S1[(RocksDB state)]
  T2 --- S2[(RocksDB state)]
  S1 -->|changelog| CL[(compacted changelog topic)]
  S2 -->|changelog| CL
  T1 --> OUT[(merchant totals)]
  T2 --> OUT
  CL -. restore on failover .-> T3[New task instance]`,
  pts: [r`Stateful operators keep partitioned local state.`, r`Kafka Streams backs state with changelog topics; Flink with checkpoints.`, r`Event-time windows with watermarks or grace for late data.`, r`Stream-table joins enrich with compacted reference data.`, r`Watch restore time, repartitioning and co-partitioning.`],
  ex: r`A card issuer computed per-card velocity windows in Flink with 2-second detection latency and checkpoint-based recovery under a minute.`,
  fu: [r`Why must joined topics be co-partitioned?`],
  pit: [r`Using processing time for financial aggregations.`] },

{ id: 'q20', level: 'Senior', tags: ['exactly-once', 'database'],
  q: r`How do you achieve exactly-once effects from Kafka into a relational database?`,
  a: r`Kafka transactions do not span your database. Options:

1. **Idempotent writes**: unique constraint on event id (or natural key) with {{INSERT ... ON CONFLICT DO NOTHING}} / {{MERGE}}; versioned upserts for state. Offsets committed after the database commit; redelivery is harmless.
2. **Offsets stored in the database**: write results and the consumed offset per partition in the **same database transaction**; on startup/assignment, seek to the stored offsets (ignore Kafka-committed offsets). Gives exactly-once without unique ids, but you manage offsets yourself.
3. **Inbox table** keyed by event id in the same transaction.

Option 2 is classic for high-volume sinks where per-record dedupe keys are costly; option 1 is simplest when events have ids.`,
  code: r`~~~csharp
// Offsets stored transactionally with results; seek on assignment
var consumer = new ConsumerBuilder<string, string>(config)
    .SetPartitionsAssignedHandler((c, parts) =>
        parts.Select(tp => new TopicPartitionOffset(tp, offsets.GetNextOffset(tp) ?? Offset.Beginning)).ToList())
    .Build();

while (!ct.IsCancellationRequested)
{
    var batch = ConsumeBatch(consumer, 500);
    await using var tx = await conn.BeginTransactionAsync(ct);
    await WritePostingsAsync(conn, tx, batch, ct);
    foreach (var g in batch.GroupBy(b => b.TopicPartition))
        await conn.ExecuteAsync("""
            INSERT INTO kafka_offsets (topic, partition, next_offset) VALUES (@t, @p, @o)
            ON CONFLICT (topic, partition) DO UPDATE SET next_offset = EXCLUDED.next_offset
            """, new { t = g.Key.Topic, p = g.Key.Partition.Value, o = g.Last().Offset.Value + 1 }, tx);
    await tx.CommitAsync(ct);                                   // results and offsets atomically
}
~~~`,
  pts: [r`Kafka transactions stop at Kafka.`, r`Idempotent writes keyed by event id plus commit-after.`, r`Or store offsets in the same database transaction and seek on assignment.`, r`Inbox tables are a third option.`, r`Choose by volume and availability of event ids.`],
  ex: r`Storing offsets with ledger postings in one SQL transaction gave a clearing system exactly-once posting across rebalances and crashes.`,
  fu: [r`What happens at rebalance with database-stored offsets?`],
  pit: [r`Committing Kafka offsets before the database transaction commits.`] },

{ id: 'q21', level: 'Senior', tags: ['incident', 'lag'],
  q: r`Consumer lag is growing on a critical topic. Walk through your investigation.`,
  a: r`1. **Scope**: one partition or all? One group or all groups on the topic?
   - **One partition**: hot key, poison record being retried, or a stuck consumer instance.
   - **All partitions of one group**: consumer-side slowness (downstream database, external API, GC, deploy regression) or rebalancing storms.
   - **All groups**: producer spike or broker problems (fetch latency, disk, under-replication).
2. **Check rebalances** (logs, metrics); max.poll.interval violations.
3. **Check processing time** per record (traces/metrics) and downstream saturation.
4. **Check production rate**: is it a traffic spike (market open, batch job)?
5. **Act**: scale consumers (up to partitions), skip/park poison records, fix the slow dependency, increase batch sizes, roll back the regression.
6. **Estimate catch-up**: lag / (consume rate - produce rate) and communicate.`,
  code: r`~~~bash
kafka-consumer-groups --bootstrap-server $B --describe --group positions
# GROUP     TOPIC        PARTITION CURRENT-OFFSET LOG-END-OFFSET LAG     CONSUMER-ID
# positions trades.v1    7         88,120,004     91,540,330     3420326 positions-3
# positions trades.v1    8         90,004,112     90,004,190     78      positions-4
# -> one partition lagging: inspect consumer positions-3 and the key distribution on partition 7
kafka-console-consumer --bootstrap-server $B --topic trades.v1 --partition 7 --offset 88120004 --max-messages 1 --property print.key=true
~~~`,
  pts: [r`Scope it: one partition, one group, or everything.`, r`One partition suggests hot keys or poison records.`, r`One group suggests consumer or downstream slowness or rebalances.`, r`All groups suggests a producer spike or broker problems.`, r`Act, then estimate and communicate catch-up time.`],
  ex: r`Lag on one partition traced to a malformed trade retried forever; parking it to the DLQ cleared 3.4 million records of lag in 6 minutes.`,
  fu: [r`How do you prevent a single poison record from causing this?`],
  pit: [r`Scaling consumers when only one partition lags.`] },

{ id: 'q22', level: 'Senior', tags: ['broker-internals', 'performance'],
  q: r`Why is Kafka fast? Explain the storage and I/O design.`,
  a: r`- **Sequential append-only logs**: writes are sequential disk appends; reads are mostly sequential scans.
- **OS page cache**: Kafka relies on the page cache rather than an in-process cache; recently written data is read from memory by tailing consumers.
- **Zero-copy** ({{sendfile}}): data moves from page cache to the socket without copying into user space (not with TLS, which needs encryption in user space; still efficient).
- **Batching end to end**: producers batch and compress; brokers store batches as-is; consumers fetch batches. Compression ratio applies on disk and network.
- **Segment files with sparse indexes**: offset and time indexes map offsets to file positions; deletion removes whole segments.
- **Partitioning** spreads load across brokers and disks.
- **Simple broker**: no per-message state tracking for consumers (offsets are just numbers).

Implications: give brokers plenty of RAM for page cache, avoid swap, use fast disks (or tiered storage), and keep consumers tailing (catch-up reads from disk are slower and can evict hot data).`,
  code: r`~~~text
Broker log directory (one partition)
/var/kafka/data/payments.events.v1-7/
  00000000000088000000.log        <- segment (batches of records, compressed)
  00000000000088000000.index      <- sparse offset -> file position index
  00000000000088000000.timeindex  <- timestamp -> offset index
  00000000000091000000.log        <- active segment (appends here)
  leader-epoch-checkpoint
Retention deletes whole segments: retention applies when a segment is closed (segment.ms / segment.bytes)
~~~`,
  pts: [r`Sequential appends and reads.`, r`Page cache instead of an in-process cache.`, r`Zero-copy transfer where TLS is not used.`, r`Batches and compression end to end.`, r`Segments with sparse indexes; simple broker state.`],
  ex: r`A backfill consumer reading months-old data evicted the page cache and raised produce latency for live traffic; tiered storage and quotas isolated it.`,
  fu: [r`Why does TLS reduce the benefit of zero-copy?`],
  pit: [r`Giving brokers a huge JVM heap and little page cache.`] },

{ id: 'q23', level: 'Senior', tags: ['multi-region', 'replication'],
  q: r`How do you run Kafka across regions (DR or active-active)?`,
  a: r`Options:

- **Stretch cluster** across regions: synchronous replication; only viable with low inter-region latency (< ~10-20 ms, e.g. metro); simple semantics, latency cost.
- **Asynchronous replication between clusters**: MirrorMaker 2, Confluent Cluster Linking/Replicator, MSK Replicator, Event Hubs geo-replication.
  - **Active-passive**: producers write to primary; DR cluster receives replicas; consumers fail over with translated offsets (MM2 checkpoints) or replicated offsets (cluster linking preserves offsets). RPO = replication lag.
  - **Active-active**: each region produces locally to region-prefixed topics (MM2 prefixes {{primary.orders}}); consumers read both local and remote topics; aggregation handles cross-region ordering (none guaranteed across regions).
- **Considerations**: avoid replication loops, schema registry replication, ACLs and topic configs sync, idempotent consumers (duplicates after failover), client failover via DNS/bootstrap updates, testing.`,
  code: r`~~~properties
# MirrorMaker 2 active-active (each region replicates the other, prefixes avoid loops)
clusters = ldn, nyc
ldn.bootstrap.servers = kafka.ldn:9092
nyc.bootstrap.servers = kafka.nyc:9092
ldn->nyc.enabled = true
nyc->ldn.enabled = true
ldn->nyc.topics = orders\..*
nyc->ldn.topics = orders\..*
replication.policy.class = org.apache.kafka.connect.mirror.DefaultReplicationPolicy   # ldn.orders.v1 in nyc
sync.group.offsets.enabled = true
# Consumers in nyc subscribe to pattern "(ldn\.)?orders\.v1" to see both regions
~~~`,
  dia: r`flowchart LR
  subgraph LDN[London]
    PL[Producers] --> KL[(orders.v1)]
    RL[(nyc.orders.v1)]
    CL[Consumers] --> KL
    CL --> RL
  end
  subgraph NYC[New York]
    PN[Producers] --> KN[(orders.v1)]
    RN[(ldn.orders.v1)]
    CN[Consumers] --> KN
    CN --> RN
  end
  KL -->|MM2| RN
  KN -->|MM2| RL`,
  pts: [r`Stretch clusters only with low inter-region latency.`, r`Async replication via MM2, cluster linking or managed replicators.`, r`Active-passive: RPO equals replication lag; offsets must be translated.`, r`Active-active: region-prefixed topics; no cross-region ordering.`, r`Replicate schemas and ACLs; consumers must be idempotent.`],
  ex: r`An exchange used cluster linking for DR so consumer offsets were identical in the DR cluster, cutting failover RTO from 40 to 8 minutes.`,
  fu: [r`What is the RPO of async replication, and how do you measure it?`],
  pit: [r`Active-active writes to the same topic name in both regions causing loops.`] },

{ id: 'q24', level: 'Senior', tags: ['outbox', 'debezium'],
  q: r`How do you publish domain events from a .NET service to Kafka reliably?`,
  a: r`Use the **transactional outbox**:

1. In the same database transaction as the business change, insert an outbox row (id, aggregate type, aggregate id as key, event type, payload, headers).
2. A relay publishes outbox rows to Kafka:
   - **Debezium outbox event router** (CDC on the outbox table): low latency, preserves commit order, no polling.
   - **Polling relay** in .NET: select unpublished rows ordered by id, produce with the aggregate id as key, mark published. Use one relay per partition of work or locking ({{FOR UPDATE SKIP LOCKED}}) and keep per-aggregate order.
3. Producer settings: idempotent, acks=all.
4. Consumers dedupe by event id (relays can publish twice).
5. Clean up published outbox rows periodically.`,
  code: r`~~~csharp
// Polling relay preserving per-aggregate order
public async Task PublishBatchAsync(CancellationToken ct)
{
    await using var tx = await db.Database.BeginTransactionAsync(ct);
    var rows = await db.Outbox.FromSqlRaw("""
        SELECT * FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED
        """).ToListAsync(ct);
    foreach (var row in rows)
    {
        await producer.ProduceAsync(row.Topic, new Message<string, string>
        {
            Key = row.AggregateId, Value = row.Payload,
            Headers = new Headers { { "event-id", row.Id.ToByteArray() }, { "event-type", Encoding.UTF8.GetBytes(row.EventType) } }
        }, ct);
        row.PublishedAt = DateTimeOffset.UtcNow;
    }
    await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
}
~~~`,
  pts: [r`Write the event to an outbox in the business transaction.`, r`Relay via Debezium CDC or a polling publisher.`, r`Key by aggregate id to keep per-aggregate order.`, r`Idempotent producer; consumers dedupe on event id.`, r`Clean up published rows.`],
  ex: r`An outbox relay replaced "save then publish" code that lost about one event per 10,000 during pod restarts.`,
  fu: [r`Can SKIP LOCKED break per-aggregate order with multiple relays?`],
  pit: [r`Producing to Kafka inside the database transaction scope and assuming atomicity.`] },

{ id: 'q25', level: 'Senior', tags: ['capacity', 'sizing'],
  q: r`Size a Kafka cluster for a given workload.`,
  a: r`Inputs: peak ingress MB/s, consumer groups (fan-out), retention, replication factor, partition count, headroom for broker failure and rebalancing.

Steps:

1. **Storage** = ingress x retention x RF (+ ~20% overhead), per broker within disk targets (keep < 60-70% used).
2. **Network out** = ingress x (RF - 1) replication + ingress x consumer groups (minus page-cache hits do not reduce network).
3. **Per-broker load** with one broker down (N-1) must stay within NIC and disk throughput limits.
4. **Partitions per broker** within comfortable limits; leader balance.
5. **Memory**: page cache to hold the tailing window (e.g. last few minutes of ingress per broker).
6. Validate with **load tests** ({{kafka-producer-perf-test}}, {{kafka-consumer-perf-test}}) at realistic message sizes and acks=all.`,
  code: r`~~~text
Workload: 50 MB/s peak ingress (after compression), RF 3, 6 consumer groups, 3 days local retention
Storage: 50 MB/s x 259,200 s x 3 = 38.9 TB -> +20% = 46.7 TB; 6 brokers -> 7.8 TB each -> 12 TB disks (65% used)
Network in per broker: (50 x 3) / 6 = 25 MB/s
Network out: replication 100 MB/s + consumers 300 MB/s = 400 MB/s cluster -> 67 MB/s per broker; with one broker down 80 MB/s
NIC 10 Gbps = 1,250 MB/s -> fine; disk throughput 25 MB/s write per broker -> fine
Page cache: 5 minutes of ingress = 15 GB per broker -> 64 GB RAM brokers, 6 GB JVM heap
~~~
~~~bash
kafka-producer-perf-test --topic perf --num-records 50000000 --record-size 1024 --throughput -1 \
  --producer-props bootstrap.servers=$B acks=all linger.ms=10 batch.size=262144 compression.type=zstd
~~~`,
  pts: [r`Storage = ingress x retention x RF plus overhead.`, r`Network out includes replication and every consumer group.`, r`Size for N-1 brokers.`, r`Page cache for the tailing window; modest JVM heap.`, r`Validate with perf tests at real sizes and acks=all.`],
  ex: r`Sizing for N-1 revealed that losing one broker would saturate disks; adding two brokers before go-live avoided a market-open outage.`,
  fu: [r`How do consumer groups affect broker CPU?`],
  pit: [r`Sizing storage without multiplying by the replication factor.`] },

{ id: 'q26', level: 'Senior', tags: ['operations', 'reassignment'],
  q: r`How do you perform broker maintenance, upgrades and partition reassignment safely?`,
  a: r`- **Rolling restarts/upgrades** one broker at a time; wait for under-replicated partitions to return to zero before the next; controlled shutdown migrates leadership first.
- **Upgrades**: follow version upgrade notes (metadata version / {{inter.broker.protocol.version}} bump after all brokers upgraded); upgrade clients compatible across versions.
- **Partition reassignment** (adding brokers, rebalancing disks): {{kafka-reassign-partitions}} or Cruise Control; **throttle** replication bandwidth to protect live traffic; move in batches; verify completion and remove throttles.
- **Preferred leader election** after maintenance to rebalance leaders.
- **Automation**: Strimzi/Cruise Control on Kubernetes, managed services (MSK, Confluent Cloud) handle much of this.
- **Change windows** and monitoring during operations (produce latency, ISR).`,
  code: r`~~~bash
# Move partitions to new brokers 7 and 8 with a replication throttle of 50 MB/s
kafka-reassign-partitions --bootstrap-server $B --topics-to-move-json-file topics.json --broker-list "1,2,3,4,5,6,7,8" --generate > plan.json
kafka-reassign-partitions --bootstrap-server $B --reassignment-json-file plan.json --execute --throttle 52428800
kafka-reassign-partitions --bootstrap-server $B --reassignment-json-file plan.json --verify   # also removes throttles when done
kafka-leader-election --bootstrap-server $B --election-type preferred --all-topic-partitions
~~~`,
  pts: [r`Rolling restarts; wait for zero under-replicated partitions.`, r`Bump protocol/metadata versions only after all brokers upgrade.`, r`Throttle reassignments and move in batches.`, r`Preferred leader election afterwards.`, r`Automate with Cruise Control, Strimzi or managed services.`],
  ex: r`An unthrottled reassignment saturated broker NICs and tripled produce latency; rerunning at 50 MB/s took longer but was invisible to clients.`,
  fu: [r`What does Cruise Control optimise?`],
  pit: [r`Restarting the next broker while partitions are still under-replicated.`] },

{ id: 'q27', level: 'Senior', tags: ['large-messages'],
  q: r`How do you handle large messages (documents, images, big payloads) with Kafka?`,
  a: r`Kafka's default max message size is about 1 MB ({{message.max.bytes}}); large messages hurt broker memory, replication and consumer latency.

Options:

- **Claim check pattern**: store the payload in object storage (S3/Blob) and send a reference (URI, hash, size, encryption key id) in the event. Preferred.
- **Compression** for moderately large text payloads.
- **Chunking**: split into ordered chunks with the same key and reassemble; complex, error-prone.
- **Raise limits** carefully ({{message.max.bytes}}, {{max.request.size}}, {{fetch.max.bytes}}, replica fetch settings) only for modest increases.

Claim check details: access control on the blob, lifecycle/retention aligned with the topic, integrity hash, and consumers tolerant of missing blobs (retry, DLQ).`,
  code: r`~~~csharp
// Claim check: payload to Blob storage, reference to Kafka
var blobName = $"statements/{statementId}.pdf";
await container.GetBlobClient(blobName).UploadAsync(pdfStream, overwrite: false, ct);
var evt = new StatementGenerated(statementId, accountId, BlobUri: container.Uri + "/" + blobName,
    Sha256: Convert.ToHexString(SHA256.HashData(pdfBytes)), SizeBytes: pdfBytes.Length);
await producer.ProduceAsync("statements.generated.v1", new Message<string, string> { Key = accountId, Value = JsonSerializer.Serialize(evt) }, ct);
~~~`,
  pts: [r`Default limit is about 1 MB for good reasons.`, r`Prefer the claim check pattern with object storage.`, r`Compression helps moderately large text.`, r`Chunking is complex; raising limits only modestly.`, r`Secure blobs, align retention and verify hashes.`],
  ex: r`Moving 5 MB trade confirmations to blob storage with claim-check events cut broker replication traffic by 90%.`,
  fu: [r`How do you keep blob and event retention consistent?`],
  pit: [r`Setting message.max.bytes to 50 MB.`] },

{ id: 'q28', level: 'Senior', tags: ['tracing', 'observability'],
  q: r`How do you propagate tracing and correlation through Kafka in .NET?`,
  a: r`- **Producer**: start an activity ({{ActivityKind.Producer}}) and inject W3C {{traceparent}}/{{tracestate}} into Kafka headers using the OpenTelemetry propagator.
- **Consumer**: extract the context from headers and start a consumer activity linked to (or parented by) the producer span. For batch processing, use **span links** to each message's context.
- **Semantic conventions**: messaging.system=kafka, messaging.destination.name, messaging.kafka.message.key, partition, offset.
- **Correlation ids** in the event envelope for business tracing across asynchronous hops.
- **Lag-aware traces**: record the time between produce timestamp and consume to show queueing delay.

Libraries: Confluent.Kafka has OpenTelemetry instrumentation packages in the community; or wrap produce/consume as shown.`,
  code: r`~~~csharp
static readonly ActivitySource Source = new("Payments.Kafka");
static readonly TextMapPropagator Propagator = Propagators.DefaultTextMapPropagator;

// Produce
using (var act = Source.StartActivity("payments.events.v1 publish", ActivityKind.Producer))
{
    var headers = new Headers();
    Propagator.Inject(new PropagationContext(act?.Context ?? default, Baggage.Current), headers, (h, k, v) => h.Add(k, Encoding.UTF8.GetBytes(v)));
    act?.SetTag("messaging.system", "kafka").SetTag("messaging.destination.name", "payments.events.v1");
    await producer.ProduceAsync("payments.events.v1", new Message<string, string> { Key = key, Value = json, Headers = headers });
}
// Consume
var parent = Propagator.Extract(default, cr.Message.Headers, (h, k) => h.TryGetLastBytes(k, out var b) ? [Encoding.UTF8.GetString(b)] : []);
using var consumeAct = Source.StartActivity("payments.events.v1 process", ActivityKind.Consumer, parent.ActivityContext);
consumeAct?.SetTag("messaging.kafka.partition", cr.Partition.Value).SetTag("messaging.kafka.offset", cr.Offset.Value)
          .SetTag("queue.delay_ms", (DateTime.UtcNow - cr.Message.Timestamp.UtcDateTime).TotalMilliseconds);
~~~`,
  pts: [r`Inject W3C trace context into Kafka headers on produce.`, r`Extract and parent or link consumer spans.`, r`Use span links for batch processing.`, r`Follow messaging semantic conventions.`, r`Record queueing delay between produce and consume.`],
  ex: r`Linking producer and consumer spans revealed that 80% of a settlement flow's latency was Kafka queueing during batch windows, not processing.`,
  fu: [r`Parent-child vs links for consumer spans?`],
  pit: [r`Traces that stop at the producer.`] },

{ id: 'q29', level: 'Senior', tags: ['managed-kafka'],
  q: r`Self-managed Kafka vs MSK vs Confluent Cloud vs Azure Event Hubs: how do you choose?`,
  a: r`| Option | Strengths | Limits |
|---|---|---|
| Self-managed (VMs/Strimzi) | Full control, any version/config, cost at scale | Operations, upgrades, skills, on-call |
| Amazon MSK (provisioned/serverless) | AWS-native, IAM auth, managed brokers, tiered storage | You still size brokers/partitions; serverless limits |
| Confluent Cloud | Fully managed, schema registry, connectors, Flink, cluster linking, governance | Cost, vendor dependency |
| Azure Event Hubs (Kafka API) | Kafka protocol on a PaaS, Entra ID, Capture to storage | Not full Kafka: no compaction on some tiers historically, limited Kafka admin APIs, Streams/transactions support varies by tier |

Decide on: required Kafka features (transactions, compaction, Streams, Connect), throughput and partitions, cloud alignment, compliance (residency, private networking, BYOK), team skills, total cost including people. Validate feature support of Kafka-compatible services against your client usage.`,
  code: r`~~~csharp
// Same Confluent.Kafka client against Event Hubs (Kafka endpoint) with Entra ID OAuth
var config = new ProducerConfig
{
    BootstrapServers = "payments-ns.servicebus.windows.net:9093",
    SecurityProtocol = SecurityProtocol.SaslSsl,
    SaslMechanism = SaslMechanism.OAuthBearer
};
var producer = new ProducerBuilder<string, string>(config)
    .SetOAuthBearerTokenRefreshHandler(async (client, _) =>
    {
        var token = await new DefaultAzureCredential().GetTokenAsync(new TokenRequestContext(["https://payments-ns.servicebus.windows.net/.default"]));
        client.OAuthBearerSetToken(token.Token, token.ExpiresOn.ToUnixTimeMilliseconds(), "ledger-svc");
    }).Build();
~~~`,
  pts: [r`Self-managed: control and cost at scale, heavy operations.`, r`MSK: AWS-native managed brokers, you still size.`, r`Confluent Cloud: fullest managed ecosystem at a price.`, r`Event Hubs: Kafka protocol on PaaS; verify feature support.`, r`Decide on features, compliance, skills and total cost.`],
  ex: r`A team's Kafka Streams app failed on a Kafka-compatible service lacking full transaction support; testing feature compatibility first would have caught it.`,
  fu: [r`What Kafka features do you verify on a compatible service?`],
  pit: [r`Assuming "Kafka-compatible" means every feature works.`] },

{ id: 'q30', level: 'Senior', tags: ['ksqldb', 'stream-sql'],
  q: r`Build a real-time aggregation or enrichment pipeline over Kafka. Which tools and patterns?`,
  a: r`Pattern: **stream-table join** for enrichment plus **windowed aggregation**:

- Reference data (merchants, instruments) in a **compacted topic** materialised as a table.
- Event stream (payments, trades) joined to the table by key (co-partitioned or broadcast/global table).
- Windowed aggregations by key with event time.
- Output to topics consumed by dashboards/alerts or sinks.

Tools: Flink SQL (most capable, managed by Confluent/AWS Managed Flink), ksqlDB (simple SQL over Kafka Streams), Kafka Streams (JVM), Spark Structured Streaming, Azure Stream Analytics. For .NET teams, SQL-based managed options often beat writing JVM code.

Watch: re-keying creates repartition topics; late data handling; state size; exactly-once settings; schema evolution of joined tables.`,
  code: r`~~~sql
-- ksqlDB: enrich payments with merchant risk tier and compute 5-minute totals per tier
CREATE TABLE merchants (merchant_id STRING PRIMARY KEY, risk_tier STRING)
  WITH (KAFKA_TOPIC='reference.merchants.v1', VALUE_FORMAT='AVRO');
CREATE STREAM payments WITH (KAFKA_TOPIC='payments.events.v1', VALUE_FORMAT='AVRO', TIMESTAMP='captured_at');
CREATE STREAM payments_enriched AS
  SELECT p.payment_id, p.merchant_id, p.amount_minor, m.risk_tier
  FROM payments p JOIN merchants m ON p.merchant_id = m.merchant_id EMIT CHANGES;
CREATE TABLE tier_totals AS
  SELECT risk_tier, SUM(amount_minor) AS total_minor, COUNT(*) AS txns
  FROM payments_enriched WINDOW TUMBLING (SIZE 5 MINUTES, GRACE PERIOD 30 SECONDS)
  GROUP BY risk_tier EMIT CHANGES;
~~~`,
  dia: r`flowchart LR
  REF[(reference.merchants: compacted)] --> TBL[Merchants table]
  PAY[(payments.events)] --> JOIN[Stream-table join]
  TBL --> JOIN
  JOIN --> ENR[(payments_enriched)]
  ENR --> WIN[5-min tumbling windows by tier]
  WIN --> OUT[(tier_totals)] --> DASH[Risk dashboard]`,
  pts: [r`Reference data as compacted topics materialised to tables.`, r`Stream-table joins for enrichment.`, r`Event-time windowed aggregations.`, r`Flink SQL or ksqlDB often suit .NET teams.`, r`Mind repartitioning, late data and state size.`],
  ex: r`A risk team built a merchant-tier exposure dashboard in ksqlDB in two weeks without writing a JVM service.`,
  fu: [r`Global table vs partitioned table joins?`],
  pit: [r`Joining streams that are not co-partitioned.`] },

{ id: 'q31', level: 'Senior', tags: ['data-loss', 'failure-modes'],
  q: r`List the ways data can be lost or duplicated in a Kafka pipeline, and the controls for each.`,
  a: r`**Loss**:

- Producer acks=0/1 with leader failure -> acks=all, min ISR 2.
- Unclean leader election -> disabled.
- Producer buffer dropped on crash (fire-and-forget without flush or outbox) -> outbox, flush on shutdown, check delivery reports.
- Consumer commits before processing / auto-commit -> commit after processing.
- Retention shorter than consumer downtime -> retention aligned with recovery time objectives, lag alerts.
- Swallowed exceptions in handlers -> DLQ, alerts.
- Compaction removing intermediate states consumers needed -> use delete policy for event history.

**Duplicates**:

- Producer retries without idempotence -> idempotent producer.
- Application resends/relay restarts -> event ids + consumer dedupe.
- Consumer crash before commit / rebalances -> idempotent consumers.
- Replays and DR failover -> idempotency.

**Reordering**: retry topics, partition count changes, multiple producers for one key, max in-flight > 5 without idempotence.`,
  code: r`~~~text
Pipeline durability checklist (payments)
[x] Producer: acks=all, enable.idempotence=true, delivery reports checked, outbox relay
[x] Topic: RF 3, min.insync.replicas=2, unclean.leader.election.enable=false, retention 7d >> max consumer outage (4h SLO)
[x] Consumer: offsets stored after processing, inbox on event id, no catch-all swallow, DLQ + alert
[x] Reconciliation: daily count/amount match source DB vs ledger
~~~`,
  pts: [r`Loss: weak acks, unclean election, unflushed producers, early commits.`, r`Loss: retention shorter than outages, swallowed exceptions.`, r`Duplicates: retries, resends, rebalances, replays.`, r`Reordering: retry topics, repartitioning, multiple producers.`, r`Controls plus reconciliation as the backstop.`],
  ex: r`A durability checklist review found a 24-hour retention topic whose consumer had a 48-hour recovery SLO; retention was raised before an incident exposed it.`,
  fu: [r`How do you detect loss you did not prevent?`],
  pit: [r`Trusting Kafka defaults for business-critical data.`] },

{ id: 'q32', level: 'Senior', tags: ['multi-tenancy', 'quotas'],
  q: r`How do you run a shared Kafka platform for many teams?`,
  a: r`- **Naming conventions and ownership**: {{<domain>.<entity>.<event>.v<n>}}; owner metadata per topic.
- **Self-service provisioning** through GitOps (Strimzi KafkaTopic/KafkaUser CRDs, Terraform providers) with guardrails: defaults for RF/min ISR, max partitions, retention limits.
- **Prefixed ACLs** per team namespace; service principals per application.
- **Quotas** (produce/consume byte rates, request rates) per client/user to contain noisy neighbours.
- **Schema registry governance**: compatibility defaults, CI checks.
- **Observability per team**: lag dashboards, topic usage, cost showback.
- **Lifecycle**: detect unused topics (no produce/consume for 90 days), deprecate and delete.
- **Separate clusters** for very different SLOs (tier-0 payments vs analytics).`,
  code: r`~~~yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: payments.payment-captured.v2
  labels: { strimzi.io/cluster: core, owner: team-payments }
spec:
  partitions: 24
  replicas: 3
  config: { min.insync.replicas: 2, retention.ms: 604800000, compression.type: zstd }
---
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaUser
metadata: { name: ledger-svc, labels: { strimzi.io/cluster: core } }
spec:
  authentication: { type: tls }
  authorization:
    type: simple
    acls:
      - { resource: { type: topic, name: payments., patternType: prefix }, operations: [Read, Describe] }
      - { resource: { type: group, name: ledger }, operations: [Read] }
  quotas: { consumerByteRate: 20971520 }
~~~`,
  pts: [r`Naming and ownership conventions.`, r`GitOps self-service with guardrails.`, r`Prefixed ACLs and per-service principals.`, r`Quotas against noisy neighbours.`, r`Schema governance, showback, lifecycle and tiered clusters.`],
  ex: r`Strimzi CRDs in Git reduced topic provisioning from a week-long ticket to a reviewed pull request merged in an hour.`,
  fu: [r`When do you split into multiple clusters?`],
  pit: [r`One admin credential shared by every team.`] },

{ id: 'q33', level: 'Senior', tags: ['event-sourcing'],
  q: r`Can you use Kafka as an event store for event sourcing?`,
  a: r`Partially. Kafka gives durable, ordered (per partition), replayable logs, but event sourcing needs:

- **Per-aggregate streams with optimistic concurrency**: "append event N+1 only if the aggregate is at version N". Kafka has no conditional append per key; concurrent writers can interleave.
- **Efficient load of one aggregate's events**: Kafka can only scan partitions, not fetch by key; you need a materialised store.
- **Infinite retention** for some aggregates (tiered storage helps).

Common approach: use a database-backed event store (EventStoreDB/KurrentDB, Marten on PostgreSQL, SQL tables with unique (aggregate_id, version)) for the write side and **publish events to Kafka** for integration and projections. Kafka-only event sourcing works when a single writer per partition is guaranteed (e.g. Kafka Streams processors owning keys) and state is rebuilt in local stores.`,
  code: r`~~~sql
-- Write side in SQL with optimistic concurrency; Kafka gets the events via outbox/CDC
CREATE TABLE events (
  aggregate_id uuid NOT NULL, version int NOT NULL, type text NOT NULL, payload jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (aggregate_id, version));
-- Append fails with a unique violation if another writer already appended version 8
INSERT INTO events (aggregate_id, version, type, payload) VALUES ($1, 8, 'FundsWithdrawn', $2);
~~~`,
  pts: [r`Kafka lacks conditional appends per aggregate.`, r`Kafka cannot fetch one key's events efficiently.`, r`Use a database event store for the write side.`, r`Publish events to Kafka for integration and projections.`, r`Kafka-only works with single-writer-per-key processors.`],
  ex: r`A team moved its write side from Kafka to PostgreSQL with version constraints after concurrent writers produced impossible account histories.`,
  fu: [r`How does Kafka Streams guarantee a single writer per key?`],
  pit: [r`Loading an aggregate by scanning a whole partition.`] },

{ id: 'q34', level: 'Senior', tags: ['consumer-patterns', 'pause'],
  q: r`How do you implement backpressure and dependency-aware pausing in a Kafka consumer?`,
  a: r`Kafka consumers pull, so backpressure is natural if you stop polling, but you must still poll within {{max.poll.interval.ms}} to stay in the group.

Techniques:

- **Pause/Resume** partitions: call {{Pause}} when downstream is unhealthy or internal queues are full; keep calling {{Consume}} (returns nothing for paused partitions) to keep membership; {{Resume}} when healthy.
- **Bounded internal channels** between the poll loop and worker tasks; pause when the channel is full.
- **Circuit breaker** around the dependency drives pause/resume.
- **Rate limiting** consumers to protect shared databases.
- Reduce {{max.poll.records}} so each poll's work is bounded.`,
  code: r`~~~csharp
var channel = Channel.CreateBounded<ConsumeResult<string, string>>(new BoundedChannelOptions(2000) { FullMode = BoundedChannelFullMode.Wait });
while (!ct.IsCancellationRequested)
{
    var unhealthy = breaker.State == CircuitState.Open || channel.Reader.Count > 1800;
    if (unhealthy && !paused) { consumer.Pause(consumer.Assignment); paused = true; }
    else if (!unhealthy && paused) { consumer.Resume(consumer.Assignment); paused = false; }
    var cr = consumer.Consume(TimeSpan.FromMilliseconds(100));     // keeps the group membership alive while paused
    if (cr is not null) await channel.Writer.WriteAsync(cr, ct);
}
// Workers read from the channel, process with the breaker-protected client, and report completed offsets back
~~~`,
  pts: [r`Stop fetching without leaving the group via Pause/Resume.`, r`Keep polling to respect max.poll.interval.ms.`, r`Bounded channels between polling and workers.`, r`Breakers drive pausing when dependencies fail.`, r`Limit max.poll.records and rate to protect databases.`],
  ex: r`Pausing partitions while a downstream ledger database failed over avoided 400,000 pointless retries and a DLQ flood.`,
  fu: [r`How are offsets committed when workers finish out of order?`],
  pit: [r`Sleeping in the poll loop and getting kicked out of the group.`] },

{ id: 'q35', level: 'Senior', tags: ['compaction', 'cdc', 'table'],
  q: r`How do you build a local cache or "table" from a compacted Kafka topic in a .NET service?`,
  a: r`1. Assign all partitions of the compacted topic (no consumer group needed, or a unique group per instance).
2. Seek to the beginning, read until the **high watermark** captured at start (to know when you are caught up); mark the cache ready (readiness probe).
3. Apply upserts; null values (tombstones) remove keys.
4. Keep consuming for updates.
5. Use versions in values to ignore stale updates.
6. Large tables: persist a local snapshot (RocksDB/SQLite) with the offset to avoid full reloads on restart.

This is the KTable/GlobalKTable pattern without Kafka Streams.`,
  code: r`~~~csharp
public async Task BootstrapAsync(CancellationToken ct)
{
    var md = admin.GetMetadata("reference.instruments.v1", TimeSpan.FromSeconds(10));
    var parts = md.Topics[0].Partitions.Select(p => new TopicPartition("reference.instruments.v1", p.PartitionId)).ToList();
    var end = parts.ToDictionary(tp => tp, tp => consumer.QueryWatermarkOffsets(tp, TimeSpan.FromSeconds(10)).High.Value);
    consumer.Assign(parts.Select(tp => new TopicPartitionOffset(tp, Offset.Beginning)));
    var done = new HashSet<TopicPartition>(parts.Where(tp => end[tp] == 0));
    while (done.Count < parts.Count)
    {
        var cr = consumer.Consume(ct);
        if (cr.Message.Value is null) _table.TryRemove(cr.Message.Key, out _); else _table[cr.Message.Key] = Parse(cr.Message.Value);
        if (cr.Offset.Value + 1 >= end[cr.TopicPartition]) done.Add(cr.TopicPartition);
    }
    _ready = true;                                                // readiness probe passes now
}
~~~`,
  pts: [r`Assign all partitions and read from the beginning.`, r`Capture high watermarks to know when caught up.`, r`Tombstones delete; versions ignore stale values.`, r`Gate readiness on bootstrap completion.`, r`Snapshot large tables locally with offsets.`],
  ex: r`A pricing service loaded 2 million instruments from a compacted topic in 20 seconds at startup, removing its dependency on a reference API.`,
  fu: [r`What if the table does not fit in memory?`],
  pit: [r`Marking the service ready before the table is loaded.`] },

{ id: 'q36', level: 'Senior', tags: ['ordering', 'repartition'],
  q: r`You must increase partitions on a keyed topic with order-sensitive consumers. How?`,
  a: r`Adding partitions changes {{hash(key) mod N}}, so new records for an existing key may go to a different partition than older, unprocessed ones: ordering breaks during the transition.

Safe approaches:

1. **New topic** with more partitions: producers write to the new topic from a cut-over point; consumers drain the old topic fully, then switch to the new topic (per-key order preserved because old records are all processed first). Coordinate with a marker or timestamp.
2. **Drain-and-switch in place**: pause producers briefly, let consumers catch up to zero lag, add partitions, resume. Requires a producer pause window.
3. **Accept temporary reordering** if consumers use versions and can reorder or tolerate it.

Option 1 is the standard for critical streams; it also allows schema or key changes at the same time.`,
  code: r`~~~text
Migration: trades.v1 (24 partitions) -> trades.v2 (96 partitions)
1. Create trades.v2 (96p), deploy consumers able to read both (v1 first, then v2)
2. Producers switch to trades.v2 at T (feature flag); last v1 offsets recorded per partition
3. Consumers finish trades.v1 up to recorded end offsets (lag 0), then start trades.v2 from the beginning
4. Verify counts per key window; decommission trades.v1 after retention
~~~`,
  pts: [r`Adding partitions remaps keys and breaks per-key order.`, r`Safest: migrate to a new topic and drain the old one first.`, r`Alternative: pause producers, drain, add partitions, resume.`, r`Or accept reordering with version-tolerant consumers.`, r`Over-provision partitions to avoid this.`],
  ex: r`A trading platform moved to a 96-partition topic over a weekend using drain-and-switch with zero ordering violations.`,
  fu: [r`How do consumers know the old topic is drained?`],
  pit: [r`Running kafka-topics --alter --partitions on a live order-sensitive topic.`] },

{ id: 'q37', level: 'Principal', tags: ['interview-scenario', 'market-data'],
  q: r`Design a market-data distribution platform on Kafka for a trading firm (ticks from exchanges to pricing, risk and UI).`,
  a: r`### Requirements
Hundreds of thousands of ticks/s at peak, low latency (milliseconds) for pricing, many consumers (pricing engines, risk, analytics, UI), per-instrument ordering, replay for analytics and incident investigation.

### Design
- **Feed handlers** normalise exchange protocols (ITCH, FIX/FAST) into a canonical tick schema (Protobuf/SBE), keyed by instrument.
- **Topics**: {{md.ticks.<asset-class>}} with high partition counts; **conflated topics** (latest per instrument every 100 ms) for UI/risk; compacted {{md.snapshot}} for latest state.
- **Producer tuning**: low linger for latency-critical feeds, lz4 compression, acks=all where durability matters (or acks=1 for ultra-low latency with replay from feed recovery).
- **Consumers**: pricing engines with static assignment per instrument range; UI via a push gateway (WebSockets) from conflated topics.
- **Latency tiering**: truly microsecond paths (market making) stay off Kafka (multicast/shared memory); Kafka serves the millisecond tier and distribution.
- **Replay**: tiered storage for history; analytics consumers read from object storage via Kafka.`,
  code: r`~~~csharp
// Conflation service: latest tick per instrument emitted every 100 ms
var latest = new ConcurrentDictionary<string, byte[]>();
_ = Task.Run(async () =>
{
    using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(100));
    while (await timer.WaitForNextTickAsync(ct))
        foreach (var key in latest.Keys)
            if (latest.TryRemove(key, out var tick))
                producer.Produce("md.ticks.equities.conflated", new Message<string, byte[]> { Key = key, Value = tick });
}, ct);
while (!ct.IsCancellationRequested) { var cr = consumer.Consume(ct); latest[cr.Message.Key] = cr.Message.Value; }
~~~`,
  dia: r`flowchart LR
  EX[Exchange feeds] --> FH[Feed handlers: normalise]
  FH --> RAW[(md.ticks.equities: raw)]
  RAW --> PR[Pricing engines]
  RAW --> CONF[Conflation 100 ms]
  CONF --> CT[(md.ticks.conflated)]
  CT --> RISK[Risk]
  CT --> PUSH[WebSocket gateway] --> UI[Trader UI]
  RAW --> SNAP[(md.snapshot: compacted)]
  RAW --> TS[(Tiered storage)] --> AN[Analytics / replay]`,
  pts: [r`Normalise feeds; key by instrument for per-instrument order.`, r`Raw, conflated and compacted snapshot topics serve different consumers.`, r`Tune producers for latency; keep microsecond paths off Kafka.`, r`Push gateway for UIs from conflated streams.`, r`Tiered storage for replay and analytics.`],
  ex: r`Conflating to 100 ms for the UI cut WebSocket traffic by 95% while pricing engines still consumed every tick.`,
  fu: [r`How do you measure end-to-end tick latency?`],
  pit: [r`Sending every tick to browser clients.`] },

{ id: 'q38', level: 'Principal', tags: ['platform-strategy'],
  q: r`Your organisation runs five Kafka clusters with inconsistent practices. What is your strategy?`,
  a: r`1. **Inventory**: clusters, versions, topics, owners, consumers, ACLs, configs, costs, incidents.
2. **Assess risk**: unsupported versions (ZooKeeper-based clusters approaching end of life), durability settings (RF, min ISR), security gaps, missing monitoring.
3. **Target state**: a small number of clusters by tier/region (tier-0 transactional, analytics, edge), managed or operator-based, KRaft, standard configs, self-service via GitOps, schema registry, monitoring and lag alerting.
4. **Migration plan**: prioritise by risk; migrate topics with MirrorMaker 2/cluster linking, dual-write or drain-and-switch; consumers move with offset translation.
5. **Standards**: naming, retention, client libraries with safe defaults, security.
6. **Operating model**: platform team ownership, SLOs for the platform, showback.
7. **Measure**: incidents, provisioning time, cost per GB, adoption.`,
  code: r`~~~text
Cluster rationalisation plan
Cluster        Version          Risk                             Action
legacy-zk-1    2.8 (ZooKeeper)  EOL, RF 2 topics, PLAINTEXT      migrate to core-tier0 via cluster linking (Q1)
analytics-01   3.4              no quotas, 40% unused topics     clean up, tiered storage, merge into analytics (Q2)
payments-a     3.6              good                             becomes core-tier0 (KRaft migration Q1)
team-x-dev     3.2              shared prod creds                decommission; use dev namespace on platform
emea-edge      3.7              residency requirement             keep, standardise configs + GitOps
~~~`,
  pts: [r`Inventory clusters, topics, owners and risks.`, r`Prioritise unsupported versions and durability or security gaps.`, r`Target a few tiered clusters with standards and self-service.`, r`Migrate with replication and offset translation.`, r`Platform ownership, SLOs and outcome metrics.`],
  ex: r`Consolidating five clusters into two tiers removed a ZooKeeper EOL risk and cut platform cost by 30%.`,
  fu: [r`How do you migrate consumers between clusters without data loss?`],
  pit: [r`Big-bang cluster migrations without replication.`] },

{ id: 'q39', level: 'Principal', tags: ['interview-scenario', 'payments'],
  q: r`Design a Kafka-based pipeline for card authorisation events feeding fraud detection, ledger and customer notifications with strict correctness.`,
  a: r`### Flow
1. **Authorisation service** writes the authorisation and an outbox row in one transaction; Debezium publishes to {{cards.authorisations.v1}} keyed by card token (per-card ordering for fraud velocity).
2. **Fraud streaming** (Flink): windowed features per card and merchant; scores published to {{fraud.scores.v1}}; high-risk signals trigger card blocks via commands.
3. **Ledger consumer**: idempotent postings keyed by authorisation id; offsets in the same DB transaction.
4. **Notifications**: idempotent by event id; can tolerate seconds of delay.
5. **Settlement/clearing files** reconcile against the ledger nightly.

### Properties
RF 3, min ISR 2, acks=all; schema registry FULL_TRANSITIVE; PCI scope minimised (tokens only, no PAN); topic ACLs; lag SLOs per consumer (fraud < 2 s, ledger < 30 s); DLQ with replay; DR via cluster linking.`,
  code: r`~~~json
{
  "authorisationId": "auth_7f3c",
  "cardToken": "tok_4c1e9a",
  "merchantId": "m_2231",
  "mcc": "5411",
  "amountMinor": 4599,
  "currency": "GBP",
  "decision": "APPROVED",
  "responseCode": "00",
  "occurredAt": "2026-10-11T10:02:17.381Z",
  "schemaVersion": 3
}
~~~`,
  dia: r`flowchart LR
  AUTH[Authorisation service] -->|tx + outbox| DB[(Auth DB)]
  DB -->|Debezium| T[(cards.authorisations.v1 key=cardToken)]
  T --> FR[Flink fraud features] --> FS[(fraud.scores.v1)] --> BLK[Card block commands]
  T --> LED[Ledger consumer: offsets in DB tx]
  T --> NOT[Notifications: idempotent]
  CLR[Clearing files] --> REC[Nightly reconciliation]
  LED --> REC`,
  pts: [r`Outbox plus CDC for loss-free publication.`, r`Key by card token for per-card fraud ordering.`, r`Ledger exactly-once via offsets in the DB transaction.`, r`Tokens only to minimise PCI scope; ACLs per topic.`, r`Lag SLOs per consumer, DLQ, reconciliation and DR.`],
  ex: r`An issuer's pipeline like this processed 15,000 authorisations/s with fraud scoring under 1.5 s p99 and zero ledger breaks across a year of audits.`,
  fu: [r`How do you block a card fast enough when fraud is detected?`],
  pit: [r`Putting full PANs in Kafka topics.`] },

{ id: 'q40', level: 'Principal', tags: ['governance', 'data'],
  q: r`How do you govern data in Kafka for regulatory compliance (retention, PII, lineage)?`,
  a: r`- **Classification** of topics and fields (public, internal, confidential, PII, PCI) recorded in the catalogue/schema metadata.
- **Retention policies** per classification and regulation; legal holds via archiving to WORM storage rather than infinite Kafka retention.
- **PII minimisation**: tokens/ids in events; encryption of sensitive fields (client-side, per-subject keys for crypto-shredding).
- **Access control** by classification: restricted topics need approvals; audit logs of access.
- **Lineage**: producers/consumers registered; data flows into lakes tracked (OpenLineage).
- **Residency**: regional clusters; replication policies respect jurisdictions.
- **Erasure**: compacted topics with tombstones for latest-state data; crypto-shredding for logs; erasure events to consumers.
- **Evidence**: periodic access reviews, configuration drift detection, documented controls for auditors.`,
  code: r`~~~json
{
  "type": "record", "name": "CustomerContactChanged", "namespace": "com.bank.customer",
  "doc": "classification=confidential; pii=true; retention=P30D; owner=team-customer",
  "fields": [
    { "name": "customerId", "type": "string" },
    { "name": "emailEncrypted", "type": "bytes", "doc": "pii=email; encryption=per-subject-key" },
    { "name": "keyId", "type": "string" },
    { "name": "changedAt", "type": { "type": "long", "logicalType": "timestamp-millis" } }
  ]
}
~~~`,
  pts: [r`Classify topics and fields in schemas and catalogues.`, r`Retention by regulation; archive to WORM for long holds.`, r`Minimise and encrypt PII; crypto-shred for erasure.`, r`Access control and audit by classification; lineage tracking.`, r`Regional clusters for residency; evidence for auditors.`],
  ex: r`Field-level classification in schemas let a bank automatically block PII topics from replicating to a non-EU analytics cluster.`,
  fu: [r`How do you enforce classification at topic creation?`],
  pit: [r`Infinite retention as an audit strategy.`] },

{ id: 'q41', level: 'Principal', tags: ['incident', 'broker-failure'],
  q: r`During peak trading, produce latency spikes and some producers get NotEnoughReplicas errors. Lead the response.`,
  a: r`### Diagnose quickly
- **NotEnoughReplicas** means ISR fell below min.insync.replicas for some partitions: followers are lagging or a broker is down.
- Check: broker health (one broker down or slow disk?), under-replicated partitions by broker, network saturation, GC pauses, disk latency, recent changes (reassignment running, upgrade, config).

### Mitigate
- If a broker is degraded (bad disk), restart or remove it; leadership moves to healthy replicas.
- If a reassignment or backfill consumer is saturating resources, throttle or stop it.
- Producers retry automatically (idempotent, delivery timeout); ensure apps do not drop messages on errors (outbox buffers).
- **Do not** lower min.insync.replicas or enable unclean election under pressure for tier-0 data: that trades a latency incident for a data-loss incident.

### Follow-up
Capacity headroom (N-1), throttles on operations during market hours, disk monitoring, change freeze windows.`,
  code: r`~~~bash
kafka-topics --bootstrap-server $B --describe --under-min-isr-partitions
kafka-topics --bootstrap-server $B --describe --under-replicated-partitions | awk '{print $6}' | sort | uniq -c   # which leaders/brokers
kafka-reassign-partitions --bootstrap-server $B --list                                                           # running reassignments?
kafka-configs --bootstrap-server $B --alter --entity-type brokers --entity-default --add-config leader.replication.throttled.rate=20971520,follower.replication.throttled.rate=20971520
~~~`,
  pts: [r`NotEnoughReplicas means ISR dropped below the minimum.`, r`Check brokers, disks, network, GC and running operations.`, r`Isolate the degraded broker or throttle heavy operations.`, r`Never weaken durability settings under pressure for tier-0 data.`, r`Follow up with N-1 headroom and operation freezes.`],
  ex: r`An unscheduled partition reassignment during market open starved follower replication; throttling it restored ISR in 3 minutes.`,
  fu: [r`When is lowering min.insync.replicas acceptable?`],
  pit: [r`Enabling unclean leader election to "get writes flowing".`] },

{ id: 'q42', level: 'Principal', tags: ['architecture-decision', 'cost'],
  q: r`A team proposes Kafka for a workload of 50 messages per second with one consumer. How do you respond?`,
  a: r`Evaluate requirements, not the technology:

- **What do they need?** Durable delivery to one consumer, maybe retries and DLQ: a managed queue (SQS, Service Bus, RabbitMQ) does this with less operational cost and richer per-message features.
- **Is replay, fan-out or stream processing coming?** If the organisation already has a Kafka platform with self-service, using it can be cheap and consistent; future consumers and replay are benefits.
- **Cost**: dedicated Kafka for 50 msg/s is wasteful; shared platform topics are fine.
- **Skills and operations**: who runs it? On-call?
- **Latency/ordering needs**: both options can satisfy them at this scale.

Recommendation: if a shared, well-run Kafka platform exists and replay/fan-out are plausible, use it; otherwise use a managed queue. Record the decision in an ADR.`,
  code: r`~~~text
ADR-112: Messaging for invoice generation requests
Context: 50 msg/s peak, 1 consumer, needs delayed retries + DLQ, no replay need identified
Options: shared Kafka platform topic | Azure Service Bus queue | direct HTTP
Decision: Service Bus queue (scheduled retries, DLQ, sessions not needed)
Consequences: no replay; if analytics needs these events later, publish InvoiceGenerated to Kafka from the worker
~~~`,
  pts: [r`Decide from requirements, not fashion.`, r`One consumer and retries fit a managed queue.`, r`Replay, fan-out or streaming favour Kafka.`, r`A shared platform changes the cost equation.`, r`Record the decision and its revisit triggers in an ADR.`],
  ex: r`A team that chose Service Bus for invoice commands later published InvoiceGenerated events to the shared Kafka platform when analytics needed them.`,
  fu: [r`What would change your recommendation?`],
  pit: [r`A dedicated Kafka cluster for a tiny workload.`] },

{ id: 'q43', level: 'Principal', tags: ['kraft', 'upgrade'],
  q: r`How do you plan the migration from ZooKeeper-based Kafka to KRaft?`,
  a: r`Context: KRaft replaces ZooKeeper with a Raft-based metadata quorum inside Kafka; Kafka 4.0 removes ZooKeeper mode entirely, so ZooKeeper clusters must migrate (via a 3.x bridge release supporting migration, e.g. 3.9).

Plan:

1. **Upgrade** to a 3.x version supporting ZK-to-KRaft migration (3.9 recommended); bring all brokers and clients to supported versions.
2. **Deploy a KRaft controller quorum** (3 or 5 controllers, separate from brokers for large clusters).
3. **Migration mode**: enable migration; controllers copy metadata from ZooKeeper; brokers restarted in migration mode (dual-write metadata to ZK and KRaft).
4. **Roll brokers** to KRaft mode; verify; **finalise** (disable ZK dual-write); decommission ZooKeeper. Rollback is possible until finalisation.
5. **Then upgrade to 4.x**; check client compatibility (very old clients/protocols removed in 4.0) and removed configs.

Risk controls: rehearsal on a staging copy, change windows outside market hours, monitoring of controller metrics, managed services (MSK, Confluent) may handle this for you.`,
  code: r`~~~properties
# controller.properties (KRaft controller during migration)
process.roles=controller
node.id=3000
controller.quorum.bootstrap.servers=ctrl1:9093,ctrl2:9093,ctrl3:9093
controller.listener.names=CONTROLLER
zookeeper.metadata.migration.enable=true
zookeeper.connect=zk1:2181,zk2:2181,zk3:2181
# brokers in migration mode: same two migration settings + controller quorum, then restart brokers without zookeeper.connect
~~~`,
  pts: [r`Kafka 4.0 removes ZooKeeper; migration is mandatory.`, r`Upgrade to a migration-capable 3.x release first.`, r`Deploy a controller quorum; migrate metadata in dual-write mode.`, r`Roll brokers to KRaft, then finalise; rollback until finalisation.`, r`Check client compatibility before moving to 4.x.`],
  ex: r`A bank rehearsed the KRaft migration three times on a staging replica and completed production in one weekend window with no client impact.`,
  fu: [r`How many controllers do you run and why?`],
  pit: [r`Jumping to Kafka 4.0 with ZooKeeper-mode clusters and very old clients.`] },

{ id: 'q44', level: 'Principal', tags: ['code-review'],
  q: r`Code review: what is wrong with this Kafka producer service?`,
  a: r`~~~csharp
public class TradePublisher
{
    public async Task Publish(Trade trade)
    {
        var config = new ProducerConfig { BootstrapServers = "kafka:9092" };
        using var producer = new ProducerBuilder<Null, string>(config).Build();
        try
        {
            await producer.ProduceAsync("trades", new Message<Null, string> { Value = JsonSerializer.Serialize(trade) });
        }
        catch (Exception) { }
        _db.Trades.Add(trade);
        await _db.SaveChangesAsync();
    }
}
~~~

1. **Producer per call**: expensive (connections, metadata, threads), no batching; producers are thread-safe and should be singletons.
2. **No key** (Null): trades for the same instrument/order land on random partitions, losing ordering.
3. **Dual write** with publish before the database save: the event can exist for a trade that was never saved (or vice versa). Use an outbox.
4. **Swallowed exceptions**: failed publishes silently ignored.
5. **Default durability**: modern clients default to acks=all and idempotence, but make it explicit for business events and check delivery reports.
6. **No schema**: raw JSON without registry/versioning; serialising the domain entity leaks internals.
7. **No headers**: no event id, type, correlation or trace context.
8. Hard-coded bootstrap servers; no TLS/auth.`,
  code: r`~~~csharp
public sealed class TradeService(TradingDb db)
{
    public async Task BookAsync(Trade trade, CancellationToken ct)
    {
        db.Trades.Add(trade);
        db.Outbox.Add(OutboxMessage.Create(topic: "trades.booked.v1", key: trade.InstrumentId,
            evt: new TradeBooked(trade.Id, trade.InstrumentId, trade.Quantity, trade.Price, trade.BookedAt)));
        await db.SaveChangesAsync(ct);                        // trade + event atomically; relay publishes with a singleton producer
    }
}
// Relay: singleton IProducer<string, TradeBooked> with acks=all, idempotence, Protobuf serializer, event-id + traceparent headers, SASL_SSL
~~~`,
  pts: [r`Producer per call: no batching, heavy resource use.`, r`Null keys lose per-instrument ordering.`, r`Dual write without an outbox.`, r`Swallowed exceptions hide failures.`, r`No schema, headers, security or explicit durability.`],
  ex: r`Code like this created 400 producers per second during a trading peak and exhausted broker connection limits.`,
  fu: [r`How do you test the relay end to end?`],
  pit: [r`Only fixing the producer lifetime.`] },

{ id: 'q45', level: 'Principal', tags: ['latency', 'tuning'],
  q: r`How do you minimise end-to-end latency in Kafka for latency-sensitive flows?`,
  a: r`End-to-end latency = producer batching + network + broker append + replication (acks=all) + consumer fetch wait + processing.

Levers:

- **Producer**: {{linger.ms=0-1}}, smaller batches; lz4 (faster) or no compression for tiny messages.
- **Durability trade-off**: acks=all adds a replication round trip (sub-ms to few ms in one AZ/region); keep it for business data; consider rack placement and fast networks.
- **Broker**: fast disks, page cache sized, avoid noisy neighbours (separate cluster for latency tier), tune {{num.network.threads}}/{{num.io.threads}}, keep partitions per broker reasonable.
- **Consumer**: {{fetch.min.bytes=1}}, low {{fetch.max.wait.ms}}, keep consumers tailing; avoid large {{max.poll.records}} if per-record latency matters.
- **Processing**: avoid synchronous I/O per record; pre-warm caches; GC tuning (.NET server GC, avoid allocations).
- **Topology**: co-locate producers, brokers and consumers in the same region/AZ where allowed.

Measure with timestamps in records and histograms (p50/p99/p99.9), not averages.`,
  code: r`~~~csharp
var lowLatencyProducer = new ProducerConfig { BootstrapServers = b, Acks = Acks.All, EnableIdempotence = true, LingerMs = 0, CompressionType = CompressionType.Lz4, SocketNagleDisable = true };
var lowLatencyConsumer = new ConsumerConfig { BootstrapServers = b, GroupId = "pricing", FetchMinBytes = 1, FetchWaitMaxMs = 5, EnableAutoCommit = true, EnableAutoOffsetStore = false };
// Measure: record e2e latency from the producer timestamp
var e2eMs = (DateTime.UtcNow - cr.Message.Timestamp.UtcDateTime).TotalMilliseconds;
latencyHistogram.Record(e2eMs, new KeyValuePair<string, object?>("topic", cr.Topic));
~~~`,
  pts: [r`Latency sums batching, network, replication, fetch wait and processing.`, r`Low linger and fast compression for latency.`, r`Keep acks=all for business data; optimise topology instead.`, r`Low fetch wait and tailing consumers.`, r`Measure percentiles from record timestamps.`],
  ex: r`Setting linger to 0, fetch wait to 5 ms and moving consumers into the brokers' AZ cut pricing p99 from 45 ms to 6 ms.`,
  fu: [r`What is the latency cost of acks=all in practice?`],
  pit: [r`Optimising averages and ignoring p99.9.`] },

{ id: 'q46', level: 'Principal', tags: ['share-groups', 'future'],
  q: r`What recent Kafka developments matter for architects (KRaft, tiered storage, KIP-848, share groups)?`,
  a: r`- **KRaft** (ZooKeeper removed in 4.0): simpler operations, faster controller failover, higher partition limits. Migration planning required.
- **Tiered storage** (KIP-405, production-ready in 3.9): old segments in object storage; long retention cheaply; faster broker replacement (less local data). Changes cost and replay design.
- **New consumer rebalance protocol** (KIP-848, GA in 4.0): incremental, broker-driven assignments; fewer stop-the-world rebalances; requires client support.
- **Queues for Kafka / share groups** (KIP-932, early access in 4.0, preview in 4.1): cooperative consumption with per-record acknowledgement, letting more consumers than partitions process a topic; narrows the gap with traditional queues (not yet for production in those releases; verify status before relying on it).
- **Eligible leader replicas** (KIP-966) and other durability improvements.

Architectural impact: fewer reasons to run separate queue systems in the future, cheaper long retention changes archive strategies, and fewer rebalance pain points. Adopt via managed services' support timelines and test client compatibility.`,
  code: r`~~~properties
# Consumer opting into the new rebalance protocol (Kafka 4.0+ brokers and clients supporting KIP-848)
group.protocol=consumer
# Topic using tiered storage: 1 day local, 1 year total
remote.storage.enable=true
local.retention.ms=86400000
retention.ms=31536000000
~~~`,
  pts: [r`KRaft replaces ZooKeeper; migration needed for 4.x.`, r`Tiered storage makes long retention cheap.`, r`KIP-848 brings incremental broker-driven rebalances.`, r`Share groups add queue-like consumption, still maturing.`, r`Adopt via managed-service timelines and compatibility tests.`],
  ex: r`Tiered storage let a firm drop a separate S3 archive pipeline for replay, since consumers could read a year of history directly through Kafka.`,
  fu: [r`Would share groups replace RabbitMQ in your estate?`],
  pit: [r`Betting production designs on early-access features.`] },

{ id: 'q47', level: 'Principal', tags: ['interview-scenario', 'cdc', 'migration'],
  q: r`Use Kafka to migrate a core banking database to a new platform with zero downtime.`,
  a: r`1. **CDC from the legacy database** (Debezium or vendor CDC) into raw topics; initial snapshot plus streaming changes.
2. **Translation layer** converts raw table changes into domain events or target-schema records (anti-corruption).
3. **New platform consumes** and builds its state; idempotent upserts keyed by business keys; offsets stored transactionally.
4. **Verification**: continuous reconciliation (counts, balances, checksums per account) between legacy and new; discrepancies investigated.
5. **Read cutover** gradually (shadow reads, compare responses, then serve from new).
6. **Write cutover**: per product or segment; for a period, the new system becomes the writer and publishes changes back to legacy (reverse CDC) for systems not yet migrated.
7. **Rollback plan** at each stage; regulatory sign-off with evidence.

Kafka's value: durable buffer, replay after fixes, fan-out to verification and other consumers, decoupled pace.`,
  code: r`~~~sql
-- Continuous reconciliation: balances per account, legacy vs new (run per partition of account ids)
SELECT l.account_no, l.ledger_balance AS legacy, n.balance AS new_platform, l.ledger_balance - n.balance AS diff
FROM legacy_snapshot.accounts l
FULL JOIN newcore.accounts n ON n.account_no = l.account_no
WHERE coalesce(l.ledger_balance, 0) <> coalesce(n.balance, 0);
-- Zero rows across all buckets for 30 consecutive days = gate for write cutover
~~~`,
  dia: r`flowchart LR
  LEG[(Legacy core DB)] -->|CDC| RAW[(raw.legacy.*)]
  RAW --> ACL[Translation / ACL]
  ACL --> EVT[(core.events)]
  EVT --> NEW[New core platform]
  EVT --> REC[Reconciliation]
  LEG --> REC
  NEW --> REC
  NEW -. after write cutover: reverse CDC .-> LEG`,
  pts: [r`CDC with snapshot plus streaming changes.`, r`Translate raw changes in an anti-corruption layer.`, r`Idempotent consumption with transactional offsets.`, r`Continuous reconciliation gates each cutover.`, r`Reverse sync and rollback plans during transition.`],
  ex: r`A bank migrated 9 million accounts over 6 months with CDC through Kafka and 30 days of zero-diff reconciliation before each product cutover.`,
  fu: [r`How do you handle legacy schema changes mid-migration?`],
  pit: [r`Cutting over writes before reconciliation proves parity.`] },

{ id: 'q48', level: 'Principal', tags: ['team-enablement'],
  q: r`How do you make many .NET teams use Kafka correctly?`,
  a: r`- **Internal client library / service defaults**: wraps Confluent.Kafka with safe defaults (acks=all, idempotence, static membership, cooperative sticky), outbox relay, inbox dedupe, retry/DLQ patterns, tracing, metrics, health checks, graceful shutdown.
- **Templates** for producer and consumer services.
- **Guardrails**: topic provisioning via GitOps with defaults, schema registry checks in CI, ACLs.
- **Docs and labs**: ordering, rebalances, duplicates, replay, poison messages; failure-injection labs.
- **Reviews** of new topics/events for keys, partitions, retention and schemas.
- **Observability out of the box**: lag dashboards per consumer group, alert templates.
- **Office hours and incident reviews** shared across teams.`,
  code: r`~~~csharp
// What a team writes with the internal library: the hard parts are defaults
builder.Services.AddKafkaPlatform(builder.Configuration)                // TLS/OIDC, safe producer/consumer defaults, OTel
    .AddOutboxPublisher<OrdersDb>()                                    // relay from the EF Core outbox
    .AddConsumer<PaymentCapturedHandler, PaymentCaptured>("payments.payment-captured.v2", c =>
    {
        c.GroupId = "orders";
        c.Inbox<OrdersDb>();                                           // dedupe on event-id
        c.Retry(3, TimeSpan.FromSeconds(1)).ThenDeadLetter();          // DLQ topic + alert
        c.OrderingByKey();                                             // key-aware parking on failure
    });
~~~`,
  pts: [r`A platform client library with safe defaults.`, r`Templates, GitOps topics and CI schema checks.`, r`Hands-on labs for failure modes.`, r`Light reviews of keys, partitions and retention.`, r`Observability and shared incident learning.`],
  ex: r`After an internal Kafka library rollout, duplicate-processing incidents across 30 teams fell from monthly to none in two quarters.`,
  fu: [r`How do you keep the library from becoming a bottleneck?`],
  pit: [r`Every team hand-rolling consumer loops.`] },

{ id: 'q49', level: 'Principal', tags: ['cost'],
  q: r`Kafka costs are rising fast. Where do you look and what do you change?`,
  a: r`Cost drivers: broker compute and storage (retention x RF), network (cross-AZ replication and consumer fetches, cross-region replication), managed-service units (CKUs, partitions, throughput), and connectors.

Actions:

- **Retention**: shorten hot retention; use tiered storage or lake archives for history.
- **Compression**: zstd at producers (often 3-5x on JSON).
- **Serialization**: move JSON to Avro/Protobuf (smaller payloads).
- **Cross-AZ traffic**: fetch-from-follower (rack awareness) for consumers; on some clouds this is the biggest line item.
- **Unused topics and consumer groups**: delete; detect via metrics.
- **Partition sprawl**: over-partitioned topics on managed services that bill per partition.
- **Duplicate consumers** reading the same stream to build the same projection: share it.
- **Showback** per team/topic to drive ownership.`,
  code: r`~~~properties
# Broker: rack awareness for fetch-from-follower
broker.rack=eu-west-1a
replica.selector.class=org.apache.kafka.common.replica.RackAwareReplicaSelector
# Consumer in the same AZ
client.rack=eu-west-1a
# Producer: compression
compression.type=zstd
~~~`,
  pts: [r`Find the drivers: storage, network, managed units, connectors.`, r`Shorten hot retention; tier the rest.`, r`Compress and use compact binary formats.`, r`Fetch from followers to cut cross-AZ traffic.`, r`Remove unused topics and duplicate consumers; show back costs.`],
  ex: r`Rack-aware fetching plus zstd cut a firm's MSK network bill by 55% in one month.`,
  fu: [r`How would you build cost showback per topic?`],
  pit: [r`Cutting replication factor to save money on tier-0 data.`] },

{ id: 'q50', level: 'Principal', tags: ['summary'],
  q: r`Summarise your Kafka principles as a Principal Engineer.`,
  a: r`"Kafka is a durable, partitioned log, and I design around its two facts: ordering and parallelism are per partition, and delivery is at-least-once unless I build otherwise.

- Keys follow the entity that needs ordering; partitions are sized for consumer parallelism with headroom, because repartitioning breaks order.
- Durability is explicit: RF 3, min ISR 2, acks=all, idempotent producers, unclean election off.
- Publishing goes through an outbox; consumers are idempotent, store offsets after or with their effects, and route failures to retries and DLQs with replay.
- Rebalances are minimised (cooperative, static membership, fast poll loops) and lag is monitored in seconds.
- Schemas are governed through a registry with transitive compatibility.
- I use Kafka for streams, fan-out and replay, and a queue service where per-message semantics fit better."`,
  code: r`~~~csharp
// Principles as configuration
var producer = new ProducerConfig { Acks = Acks.All, EnableIdempotence = true, LingerMs = 5, CompressionType = CompressionType.Zstd };
var consumer = new ConsumerConfig
{
    EnableAutoOffsetStore = false,                                        // store after processing
    PartitionAssignmentStrategy = PartitionAssignmentStrategy.CooperativeSticky,
    GroupInstanceId = Environment.GetEnvironmentVariable("POD_NAME"),
    IsolationLevel = IsolationLevel.ReadCommitted
};
// Topic: --replication-factor 3 --config min.insync.replicas=2 --config unclean.leader.election.enable=false
~~~`,
  pts: [r`Ordering and parallelism are per partition.`, r`Key by the ordered entity; size partitions with headroom.`, r`Explicit durability: RF 3, min ISR 2, acks=all, idempotence.`, r`Outbox in, idempotent consumers out, DLQ and replay.`, r`Minimise rebalances, monitor lag in seconds, govern schemas.`],
  ex: r`Applying these defaults across a payments estate turned Kafka incidents from data problems into brief, self-healing lag.`,
  fu: [r`What is the first Kafka metric you look at in an incident?`],
  pit: [r`Treating Kafka as a magic exactly-once queue.`] }
],
cheat: r`### Core model
Topic -> partitions (ordered logs, offsets) on brokers; leader + followers (ISR); key hash -> partition; consumer group = one consumer per partition; retention not consumption deletes data; KRaft metadata (ZooKeeper removed in 4.0).

### Durability defaults
RF 3 · min.insync.replicas 2 · acks=all · enable.idempotence=true · unclean.leader.election.enable=false · outbox for publishing.

### Delivery semantics
| Goal | How |
|---|---|
| At-least-once | store/commit offsets after processing |
| Exactly-once Kafka->Kafka | transactions + read_committed |
| Exactly-once into DB | idempotent upserts or offsets in the same DB transaction |
| No retry duplicates | idempotent producer (PID + sequence) |

### Consumers
Scale up to partitions · cooperative sticky + static membership · poll within max.poll.interval.ms · batch writes · Pause/Resume for backpressure · key-aware parking for order-sensitive retries · Close() on shutdown.

### Operations
Alert: under-replicated / under-min-ISR partitions, lag in seconds and growth · throttle reassignments · tiered storage for long retention · rack-aware fetch to cut cross-AZ cost · schema registry with transitive compatibility · new topic + drain to repartition.

### Say this
"Ordering and parallelism are both per partition." "Exactly-once stops at Kafka's edge." "Never weaken min ISR under pressure." "Adding partitions remaps keys."`
});
})(String.raw);
