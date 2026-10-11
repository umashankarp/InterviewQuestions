(function (r) {
registerTopic('16-distributed-systems', {
related: ['14-system-design', '17-microservices', '36-saga'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['fallacies'],
  q: r`What are the fallacies of distributed computing, and how does each show up in a .NET microservice?`,
  a: r`Peter Deutsch's (and James Gosling's) eight fallacies are assumptions that break in production:

| Fallacy | How it bites | Mitigation |
|---|---|---|
| The network is reliable | Calls fail, time out, partially succeed | Timeouts, retries with idempotency, outbox |
| Latency is zero | Chatty calls multiply latency | Batch, cache, async, fewer hops |
| Bandwidth is infinite | Large payloads saturate links | Paging, compression, projections |
| The network is secure | Interception, spoofing | mTLS, zero trust, authn/authz on every hop |
| Topology doesn't change | Pods move, IPs change | Service discovery, DNS TTLs, health checks |
| There is one administrator | Different teams/clouds/policies | Contracts, SLAs, observability across boundaries |
| Transport cost is zero | Serialisation CPU, egress fees | Efficient formats (protobuf), locality |
| The network is homogeneous | Mixed protocols, versions | Standards, versioned contracts, gateways |

The most dangerous consequence: a **timeout does not mean failure**. The remote side may have completed the operation. Design every remote write to be idempotent and every critical flow to be reconcilable.`,
  code: r`~~~csharp
// Each fallacy has a line of defence in the HTTP client configuration
builder.Services.AddHttpClient<ILedgerClient, LedgerClient>(c =>
{
    c.BaseAddress = new Uri("https://ledger.internal");               // discovery via DNS, not hard-coded IPs
    c.DefaultRequestVersion = HttpVersion.Version20;                  // multiplexing reduces connection overhead
})
.AddStandardResilienceHandler(o =>
{
    o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(2);               // latency is not zero
    o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(6);
    o.Retry.MaxRetryAttempts = 2;                                     // network is not reliable (idempotent calls only)
});
// Remote writes carry an idempotency key, so a retry after a timeout cannot double-apply
request.Headers.Add("Idempotency-Key", command.Id.ToString());
~~~`,
  pts: [r`Networks fail, add latency, and change topology.`, r`A timeout is an unknown outcome, not a failure.`, r`Idempotency, timeouts and retries with backoff are the baseline.`, r`Secure every hop; do not trust the network.`, r`Reduce chattiness and payload size; mind egress cost.`],
  ex: r`A payments service retried a timed-out transfer without an idempotency key and debited customers twice; adding keys and reconciliation removed the class of bug.`,
  fu: [r`Which fallacy causes the most production incidents in your experience?`],
  pit: [r`Treating a remote call like a local method call.`],
  tip: r`Say "a timeout is an unknown outcome". It immediately signals distributed-systems maturity.` },

{ id: 'q2', level: 'Basic', tags: ['consistency-models'],
  q: r`Explain the main consistency models: linearizability, sequential, causal, read-your-writes, eventual.`,
  a: r`From strongest to weakest:

- **Linearizability (strong consistency)**: every operation appears to take effect atomically at a single point between its start and end; all clients see the same order, consistent with real time. Example: a single-leader database read from the leader; etcd.
- **Sequential consistency**: all clients see the same order of operations, but not necessarily matching real time.
- **Causal consistency**: operations that are causally related (a reply after a post) are seen in order by everyone; concurrent operations may be seen in different orders.
- **Session guarantees**: read-your-writes, monotonic reads, monotonic writes, writes-follow-reads: guarantees within one client session (Cosmos DB session consistency, MongoDB causal sessions).
- **Eventual consistency**: if writes stop, replicas converge; no ordering guarantees meanwhile.

Stronger models cost latency and availability (coordination). Choose per use case: balances and uniqueness need linearizable operations; profile views and feeds work with session or eventual consistency.`,
  code: r`~~~csharp
// Cosmos DB lets you choose per client/request; session consistency gives read-your-writes for a user
var client = new CosmosClient(endpoint, credential, new CosmosClientOptions { ConsistencyLevel = ConsistencyLevel.Session });
var write = await container.UpsertItemAsync(profile, new PartitionKey(profile.UserId));
var read = await container.ReadItemAsync<Profile>(profile.UserId, new PartitionKey(profile.UserId),
    new ItemRequestOptions { SessionToken = write.Headers.Session });   // guarantees this read sees the write
~~~`,
  pts: [r`Linearizable: single real-time order, as if one copy.`, r`Sequential: one order for all, not tied to real time.`, r`Causal: cause-effect order preserved for everyone.`, r`Session guarantees: read-your-writes and monotonic reads per client.`, r`Eventual: convergence only; choose per use case.`],
  ex: r`Switching a profile service from strong to session consistency in Cosmos DB halved latency while users still always saw their own edits.`,
  fu: [r`Is linearizability the same as serializability?`],
  pit: [r`Using "strong consistency" loosely without saying which guarantee.`] },

{ id: 'q3', level: 'Basic', tags: ['timeouts', 'retries'],
  q: r`How do you choose timeouts and retries for remote calls?`,
  a: r`**Timeouts** come from the **caller's latency budget**, propagated down the call chain:

- Set per-attempt timeouts slightly above the callee's p99 (or p99.9) latency, and a total timeout within the caller's SLO.
- Propagate deadlines ({{CancellationToken}}, gRPC deadlines) so downstream work stops when the caller gives up.
- Different timeouts for connect vs response.

**Retries**:

- Only for **transient** failures (timeouts, 503, 429, connection resets) and only for **idempotent** operations or with idempotency keys.
- **Exponential backoff with jitter**; cap attempts (2 to 3) and respect {{Retry-After}}.
- Retry at **one layer** (usually the edge-most client) to avoid multiplicative amplification.
- Use **retry budgets** (retries limited to ~10% of requests) and circuit breakers to avoid retry storms during outages.
- **Hedging** (send a second request after the p95) for idempotent reads to cut tail latency.`,
  code: r`~~~csharp
// Budget: API SLO 800 ms. Downstream pricing p99 = 120 ms -> attempt timeout 200 ms, 2 retries max, total 600 ms
builder.Services.AddHttpClient<IPricing, PricingClient>()
    .AddResilienceHandler("pricing", p =>
    {
        p.AddTimeout(TimeSpan.FromMilliseconds(600));
        p.AddRetry(new HttpRetryStrategyOptions { MaxRetryAttempts = 2, Delay = TimeSpan.FromMilliseconds(50),
            BackoffType = DelayBackoffType.Exponential, UseJitter = true });
        p.AddTimeout(TimeSpan.FromMilliseconds(200));
    });
// Deadline propagation: the request's cancellation token flows to every downstream call
app.MapGet("/quote", (IPricing pricing, CancellationToken requestAborted) => pricing.QuoteAsync(requestAborted));
~~~`,
  pts: [r`Derive timeouts from the caller's latency budget and callee p99.`, r`Propagate deadlines through the call chain.`, r`Retry only transient errors on idempotent operations.`, r`Exponential backoff with jitter, capped attempts, one retry layer.`, r`Retry budgets, circuit breakers and hedging for tails.`],
  ex: r`Three layers each retrying three times turned one user request into 27 calls during an outage; consolidating retries at one layer stopped the storm.`,
  fu: [r`What is request hedging and when is it unsafe?`],
  pit: [r`Infinite or default 100-second timeouts.`] },

{ id: 'q4', level: 'Basic', tags: ['idempotency'],
  q: r`Why is idempotency the most important property in distributed systems, and how do you implement it?`,
  a: r`Networks force retries (lost responses, timeouts, redeliveries). If an operation is idempotent, repeating it has the same effect as doing it once, so retries are safe. This is how systems achieve "exactly-once effects" on top of at-least-once delivery.

Implementations:

- **Natural idempotency**: PUT/DELETE semantics, "set status to X", upserts keyed by natural ids.
- **Idempotency keys** for commands: store the key with the result atomically with the state change; duplicates return the stored result.
- **Inbox / processed-message table** for consumers, in the same transaction as the handler's effects.
- **Conditional writes / versions**: apply only if the current version matches (prevents stale or duplicate updates).
- **Deterministic ids**: derive ids from inputs so re-creating produces the same row (unique constraint rejects duplicates).

Pass idempotency keys to external providers too; their own retries must be safe.`,
  code: r`~~~csharp
public async Task HandleAsync(PaymentCaptured msg, CancellationToken ct)
{
    await using var tx = await db.Database.BeginTransactionAsync(ct);
    var inserted = await db.Database.ExecuteSqlInterpolatedAsync(
        $"INSERT INTO inbox (message_id, received_at) VALUES ({msg.MessageId}, now()) ON CONFLICT DO NOTHING", ct);
    if (inserted == 0) return;                                       // duplicate delivery: effects already applied
    db.LedgerEntries.AddRange(Posting.For(msg));
    await db.SaveChangesAsync(ct);
    await tx.CommitAsync(ct);
}
~~~`,
  pts: [r`Retries are inevitable; idempotency makes them safe.`, r`Exactly-once effects = at-least-once delivery + idempotency.`, r`Idempotency keys stored atomically with results.`, r`Inbox tables for consumers; conditional writes and deterministic ids.`, r`Pass keys to external providers.`],
  ex: r`An inbox table in the same transaction as ledger postings made a Kafka consumer safe to replay after a bad offset reset.`,
  fu: [r`How long do you keep idempotency records?`],
  pit: [r`Checking for duplicates in a separate transaction from the effects.`] },

{ id: 'q5', level: 'Basic', tags: ['replication'],
  q: r`Compare single-leader, multi-leader and leaderless replication.`,
  a: r`| | Single-leader | Multi-leader | Leaderless |
|---|---|---|---|
| Writes go to | One leader | Any of several leaders | Any replica (quorum) |
| Conflicts | None (serial writes) | Yes: concurrent writes on different leaders | Yes: concurrent writes |
| Read scaling | Replicas (with lag) | Local leaders | Quorum reads |
| Failover | Promote a follower | Other leaders keep working | No failover needed |
| Examples | PostgreSQL, SQL Server AG, MySQL, MongoDB | Multi-region active-active, CouchDB, Cosmos multi-write | Cassandra, DynamoDB-style |

Single-leader is simplest and fits most OLTP. Multi-leader suits multi-region writes or offline clients, but needs conflict resolution (LWW, CRDTs, custom merge). Leaderless favours availability and write latency with tunable quorums, at the cost of reasoning about stale reads and conflicts.

Replication lag affects all async setups: plan for read-your-writes and monotonic reads.`,
  code: r`~~~text
Single-leader async: write -> leader commit -> ack client -> ship WAL to followers (lag ms..s)
Failover risk: writes acked by the old leader but not shipped are lost (RPO > 0) unless replication is synchronous
Leaderless N=3, W=2, R=2: overlapping quorums -> a read sees at least one replica with the latest acknowledged write
~~~`,
  dia: r`flowchart TB
  subgraph SL[Single-leader]
    L[(Leader)] --> F1[(Follower)]
    L --> F2[(Follower)]
  end
  subgraph ML[Multi-leader]
    L1[(Leader EU)] <--> L2[(Leader US)]
  end
  subgraph LL[Leaderless quorum]
    C[Client] --> R1[(Replica 1)]
    C --> R2[(Replica 2)]
    C --> R3[(Replica 3)]
  end`,
  pts: [r`Single-leader: no write conflicts, simplest, failover needed.`, r`Multi-leader: local writes in several places, conflict resolution required.`, r`Leaderless: quorum reads and writes, high availability.`, r`Async replication means lag and possible data loss on failover.`, r`Pick by write locality, availability and conflict tolerance.`],
  ex: r`A global CRM moved from multi-leader to single-leader per region-owned account after conflicting edits corrupted customer records.`,
  fu: [r`How does synchronous replication change RPO and latency?`],
  pit: [r`Multi-leader for data that cannot tolerate conflicts, like balances.`] },

{ id: 'q6', level: 'Basic', tags: ['partitioning'],
  q: r`How do you partition (shard) data, and what makes a good partition key?`,
  a: r`Strategies:

- **Hash partitioning**: hash(key) mod N (or consistent hashing): even distribution, no range scans across keys.
- **Range partitioning**: key ranges per partition: efficient range queries, risk of hot ranges (time-based keys).
- **Directory-based**: a lookup table maps keys (tenants) to partitions: flexible moves, extra lookup and a critical metadata service.
- **Geographic**: by region for residency and latency.

A good partition key:

- Appears in most queries (so they hit one partition).
- Has high cardinality and even load (no hot keys).
- Keeps related data together (transactions stay single-partition).
- Is stable (changing it means moving data).

Plan for **rebalancing** (virtual partitions mapped to nodes) and **hot keys** (salting, splitting large tenants).`,
  code: r`~~~csharp
// Virtual partitions: 1,024 logical partitions mapped to physical shards via a directory
public sealed class ShardDirectory(IReadOnlyDictionary<int, string> partitionToShard)
{
    public string ShardFor(string tenantId)
    {
        var partition = (int)(System.IO.Hashing.XxHash3.HashToUInt64(Encoding.UTF8.GetBytes(tenantId)) % 1024);
        return partitionToShard[partition];               // moving a partition = update the map + copy data
    }
}
~~~`,
  pts: [r`Hash for even spread, range for scans, directory for flexibility.`, r`The key should appear in most queries.`, r`High cardinality and even load avoid hot partitions.`, r`Keep transactional data in one partition.`, r`Virtual partitions make rebalancing manageable.`],
  ex: r`Partitioning by tenant with 1,024 virtual partitions let a SaaS platform move its largest customer onto dedicated hardware in hours.`,
  fu: [r`How do you handle a tenant that outgrows a partition?`],
  pit: [r`Time-based partition keys receiving all current writes.`] },

{ id: 'q7', level: 'Intermediate', tags: ['consensus', 'raft'],
  q: r`What problem does consensus solve, and how do Raft and Paxos achieve it?`,
  a: r`Consensus lets a group of nodes agree on a value (or a sequence of values, a replicated log) despite failures, so they behave like one reliable state machine. Uses: leader election, configuration, distributed locks, replicated databases.

**Raft** (designed for understandability):

- Terms and randomised election timeouts; a candidate wins with a majority of votes; voters only vote for candidates with logs at least as up to date.
- The leader replicates log entries; an entry is committed when stored on a majority; committed entries are never lost because any new leader must have them.

**Paxos**: proposers, acceptors and learners; two phases (prepare/promise, accept/accepted) with ballot numbers; Multi-Paxos uses a stable leader to skip phase one. Same majority-intersection idea; harder to implement correctly.

Constraints: 2f + 1 nodes tolerate f failures; every write needs a majority round trip; odd cluster sizes; spread across failure domains.`,
  code: r`~~~bash
# etcd (Raft) health and leadership: 3 members across 3 zones tolerate 1 failure
etcdctl --endpoints=$ENDPOINTS endpoint status --write-out=table
etcdctl --endpoints=$ENDPOINTS endpoint health
# Leader election primitive used by many controllers
etcdctl elect settlement-scheduler "$(hostname)"
~~~`,
  dia: r`sequenceDiagram
  participant F1 as Follower A
  participant F2 as Follower B
  participant F3 as Follower C
  Note over F1,F3: leader crashed, timeouts randomised
  F2->>F1: RequestVote(term 5)
  F2->>F3: RequestVote(term 5)
  F1-->>F2: vote granted
  F3-->>F2: vote granted
  Note over F2: majority -> leader for term 5
  F2->>F1: AppendEntries (heartbeat)
  F2->>F3: AppendEntries (heartbeat)`,
  pts: [r`Consensus makes nodes agree on a replicated log despite failures.`, r`Raft: randomised elections, majority votes, majority commit.`, r`Paxos: ballots and two phases with the same majority idea.`, r`2f+1 nodes tolerate f failures; writes pay a quorum round trip.`, r`Odd sizes across failure domains.`],
  ex: r`A Kubernetes control plane with etcd spread over two zones lost quorum when one zone failed; three zones fixed it.`,
  fu: [r`Why can't a 4-node cluster tolerate 2 failures?`],
  pit: [r`Building your own consensus instead of using etcd/ZooKeeper/Consul.`] },

{ id: 'q8', level: 'Intermediate', tags: ['failure-detection'],
  q: r`How do distributed systems detect failures, and why is "is the node dead?" fundamentally uncertain?`,
  a: r`A node cannot distinguish a **crashed** peer from a **slow** one or a **network partition**: all look like missing responses. Failure detection is therefore probabilistic.

Mechanisms:

- **Heartbeats with timeouts**: simple; the timeout trades detection speed against false positives (GC pauses trigger false failovers).
- **Phi accrual detector** (Cassandra, Akka): outputs a suspicion level based on the heartbeat inter-arrival distribution, adapting to network conditions.
- **Gossip-based membership** (SWIM, Serf/Consul): nodes probe random peers and ask others to probe indirectly before declaring failure, reducing false positives.
- **Health checks** in orchestrators (liveness/readiness) and load balancers.

Consequences: false positives cause split brain or unnecessary failovers, so pair detection with **fencing** (fencing tokens, STONITH) and leases with expiry so a falsely suspected node cannot keep acting as leader.`,
  code: r`~~~csharp
// Lease-based leadership: a paused leader loses its lease and must stop; fencing tokens reject stale leaders downstream
while (!ct.IsCancellationRequested)
{
    var lease = await leases.TryAcquireAsync("ledger-writer", ttl: TimeSpan.FromSeconds(15), ct);
    if (lease is null) { await Task.Delay(TimeSpan.FromSeconds(5), ct); continue; }
    while (await lease.RenewAsync(ct))                                    // renew every ~5 s
        await writer.ProcessBatchAsync(fencingToken: lease.Token, ct);     // storage rejects tokens lower than the latest seen
}
~~~`,
  pts: [r`Crashed, slow and partitioned look identical from outside.`, r`Heartbeats plus timeouts trade speed against false positives.`, r`Phi accrual and gossip (SWIM) reduce false positives.`, r`Pair detection with leases and fencing tokens.`, r`GC pauses and network blips cause false failovers.`],
  ex: r`A 4-second GC pause made a cluster declare its leader dead; the old leader resumed and wrote stale data until fencing tokens were added.`,
  fu: [r`What is STONITH?`],
  pit: [r`Very aggressive timeouts causing failover flapping.`] },

{ id: 'q9', level: 'Intermediate', tags: ['split-brain', 'fencing'],
  q: r`What is split brain, and how do you prevent it?`,
  a: r`Split brain happens when a partition (or false failure detection) leads two nodes to believe they are the leader/primary and both accept writes, causing divergent data that is hard or impossible to reconcile.

Prevention:

- **Quorum-based decisions**: only the side with a majority can elect a leader or accept writes (Raft, etcd, MongoDB replica sets, SQL Server AG with quorum witnesses).
- **Leases with expiry**: a leader acts only while its lease is valid; it must stop before the lease could be granted to another.
- **Fencing tokens**: every new leader gets a higher token; storage/downstream rejects writes with older tokens.
- **STONITH** ("shoot the other node in the head"): forcibly power off the old primary in cluster managers.
- **Witness/tiebreaker** in a third failure domain for two-node clusters.
- **Primary stops accepting writes** when it cannot reach a quorum (Redis {{min-replicas-to-write}}, MongoDB step-down).`,
  code: r`~~~sql
-- Fencing at the storage layer: only accept writes from the newest leadership epoch
UPDATE settlement_state SET last_batch = $batch, epoch = $epoch
WHERE id = 1 AND epoch <= $epoch;          -- a stale leader (lower epoch) updates 0 rows and must stop
~~~`,
  dia: r`flowchart LR
  subgraph SideA[Partition side A: 2 of 3 nodes]
    N1[(Node 1)] --- N2[(Node 2)]
  end
  subgraph SideB[Partition side B: 1 of 3 nodes]
    N3[(Old leader)]
  end
  SideA -->|majority: elects new leader, epoch 8| W[Writes accepted]
  N3 -->|no quorum: steps down, epoch 7 rejected| X[Writes refused]`,
  pts: [r`Split brain: two leaders accept writes during a partition.`, r`Only a majority side may elect or accept writes.`, r`Leases and fencing tokens stop stale leaders.`, r`STONITH and witnesses for small clusters.`, r`Primaries should stop writing without quorum.`],
  ex: r`A two-node database cluster without a witness promoted both nodes during a network blip; a file-share witness in a third site prevented recurrence.`,
  fu: [r`How do you reconcile data after a split brain?`],
  pit: [r`Two-node clusters with no tiebreaker.`] },

{ id: 'q10', level: 'Intermediate', tags: ['distributed-locks'],
  q: r`When are distributed locks appropriate, and how do you implement them safely?`,
  a: r`Use distributed locks to **avoid duplicate work** (efficiency) or to provide mutual exclusion for **correctness**; the bar differs.

- **Efficiency locks** (only one node runs the nightly report): Redis {{SET NX PX}} or a database lease is fine; occasional double execution is tolerable if jobs are idempotent.
- **Correctness locks** (only one writer to a resource): need a consensus-backed store (etcd, ZooKeeper, Consul) **plus fencing tokens** checked by the resource, because a lock holder can pause (GC, VM freeze) beyond its lease and wake up believing it still holds the lock.

Better alternatives often exist:

- Database constraints and conditional updates.
- Partitioning work so each key has a single owner (Kafka partitions, actor models).
- Idempotent operations that make concurrency harmless.

Always set lease TTLs, renew while working, and release with compare-and-delete.`,
  code: r`~~~csharp
// Database-backed lease with fencing: simple and transactional
public async Task<long?> TryAcquireAsync(string name, string owner, TimeSpan ttl, CancellationToken ct)
{
    // returns the new fencing token if acquired, null otherwise
    return await db.Database.SqlQuery<long?>($"""
        UPDATE leases SET owner = {owner}, expires_at = now() + {ttl}, token = token + 1
        WHERE name = {name} AND (expires_at < now() OR owner = {owner})
        RETURNING token
        """).SingleOrDefaultAsync(ct);
}
~~~`,
  pts: [r`Distinguish efficiency locks from correctness locks.`, r`Efficiency: Redis or DB leases with idempotent jobs.`, r`Correctness: consensus store plus fencing tokens.`, r`Often constraints, partitioned ownership or idempotency remove the need.`, r`TTLs, renewal and compare-and-delete release.`],
  ex: r`A team replaced a Redis lock around ledger writes with a unique constraint and conditional updates, eliminating rare double postings after GC pauses.`,
  fu: [r`Why is Redlock controversial?`],
  pit: [r`Relying on a Redis lock alone to protect money movement.`] },

{ id: 'q11', level: 'Intermediate', tags: ['messaging', 'delivery-guarantees'],
  q: r`Explain at-most-once, at-least-once and exactly-once delivery. Can you really get exactly-once?`,
  a: r`- **At-most-once**: send and do not retry; messages may be lost, never duplicated (acknowledge before processing).
- **At-least-once**: retry until acknowledged; never lost, possibly duplicated (acknowledge after processing).
- **Exactly-once delivery** across arbitrary networks is impossible in general (two generals problem). What systems offer is **exactly-once processing/effects** within boundaries:
  - Kafka transactions: consume-process-produce within Kafka atomically (offsets and output messages committed together).
  - Stream processors (Flink) with checkpoints plus transactional sinks.
  - Idempotent consumers: at-least-once delivery + deduplication = exactly-once effects.

Practical rule: assume at-least-once everywhere, make consumers idempotent, and use outbox for producing. When effects leave the boundary (emails, external APIs), use idempotency keys at the external system or accept rare duplicates with compensation.`,
  code: r`~~~csharp
// Kafka exactly-once within Kafka: read-process-write in a transaction
producer.InitTransactions(TimeSpan.FromSeconds(10));
while (true)
{
    var cr = consumer.Consume(ct);
    producer.BeginTransaction();
    producer.Produce("payments.enriched", new Message<string, string> { Key = cr.Message.Key, Value = Enrich(cr.Message.Value) });
    producer.SendOffsetsToTransaction([new TopicPartitionOffset(cr.TopicPartition, cr.Offset + 1)], consumer.ConsumerGroupMetadata, TimeSpan.FromSeconds(10));
    producer.CommitTransaction();               // output and consumed offset commit atomically
}
// Consumers downstream use isolation.level=read_committed
~~~`,
  pts: [r`At-most-once may lose; at-least-once may duplicate.`, r`Exactly-once delivery is impossible in general.`, r`Exactly-once effects: at-least-once + idempotency.`, r`Kafka transactions give exactly-once inside Kafka.`, r`External side effects need idempotency keys or compensation.`],
  ex: r`A stream job claimed exactly-once but wrote to a database without idempotency; a restart duplicated aggregates until upserts keyed by window were used.`,
  fu: [r`What does read_committed isolation do in Kafka?`],
  pit: [r`Believing a broker setting makes downstream side effects exactly-once.`] },

{ id: 'q12', level: 'Intermediate', tags: ['ordering'],
  q: r`How do you guarantee message ordering in distributed systems, and what does it cost?`,
  a: r`Total ordering across everything requires a single sequencer: a throughput and availability bottleneck. Most systems need **ordering per entity** instead:

- **Kafka**: order is guaranteed within a partition; key messages by entity id (order id, account id) so all events for one entity go to one partition. Keep {{max.in.flight}} with idempotent producers to preserve order on retries.
- **Service Bus / SQS FIFO**: sessions or message group ids give per-group ordering.
- **RabbitMQ**: per queue with a single consumer (or consistent-hash exchange for per-key queues).

Costs and caveats:

- Parallelism is limited to the number of partitions/groups; a hot key serialises.
- A poison message blocks its partition/session: dead-letter it promptly.
- Consumers that process in parallel within a partition lose ordering.
- Even with ordered delivery, use **version numbers** in events so consumers can reject stale updates (defence in depth).`,
  code: r`~~~csharp
// Per-entity ordering: key by account id
await producer.ProduceAsync("accounts.events", new Message<string, string> { Key = accountId, Value = json }, ct);
// Consumer defence: ignore out-of-date versions
public async Task HandleAsync(AccountUpdated e, CancellationToken ct)
{
    var rows = await db.Database.ExecuteSqlInterpolatedAsync(
        $"UPDATE account_view SET balance = {e.Balance}, version = {e.Version} WHERE id = {e.AccountId} AND version < {e.Version}", ct);
    if (rows == 0) logger.LogDebug("Stale or duplicate event {Version} ignored", e.Version);
}
~~~`,
  pts: [r`Total order needs a single sequencer: expensive.`, r`Order per entity: key by entity id (partition, session, group).`, r`Parallelism is bounded by partitions; hot keys serialise.`, r`Poison messages block ordered lanes: DLQ them.`, r`Version checks in consumers as defence in depth.`],
  ex: r`Account balance projections went wrong when events for one account landed in different partitions; keying by account id fixed ordering.`,
  fu: [r`How do retries break ordering in Kafka producers?`],
  pit: [r`Expecting global ordering from a multi-partition topic.`] },

{ id: 'q13', level: 'Intermediate', tags: ['backpressure'],
  q: r`What is backpressure, and how do you implement it across services?`,
  a: r`Backpressure is how a system signals upstream to slow down when downstream cannot keep up, instead of buffering unboundedly and failing (memory exhaustion, timeouts, cascading collapse).

Mechanisms:

- **Bounded queues/channels**: producers block or get rejected when full ({{Channel.CreateBounded}} with {{FullMode.Wait}}).
- **HTTP 429/503 with Retry-After**: services shed load explicitly; clients back off.
- **Concurrency limits** per downstream (bulkheads); adaptive concurrency limits based on latency.
- **Pull-based consumption** (Kafka, SQS): consumers fetch only what they can process; lag grows instead of crashing consumers (alert on lag).
- **Load shedding**: drop low-priority work first.
- **Reactive streams** semantics (demand signalling) in streaming frameworks.

Design the system so overload degrades gracefully: queue lag and rejected non-critical requests rather than total failure.`,
  code: r`~~~csharp
// Bounded in-process pipeline: producers wait when the buffer is full
var channel = Channel.CreateBounded<Payment>(new BoundedChannelOptions(5_000) { FullMode = BoundedChannelFullMode.Wait });
// Service-level backpressure: reject quickly when saturated
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status503ServiceUnavailable;
    o.AddConcurrencyLimiter("inflight", l => { l.PermitLimit = 500; l.QueueLimit = 200; l.QueueProcessingOrder = QueueProcessingOrder.OldestFirst; });
    o.OnRejected = (ctx, _) => { ctx.HttpContext.Response.Headers.RetryAfter = "2"; return ValueTask.CompletedTask; };
});
~~~`,
  pts: [r`Backpressure tells producers to slow down.`, r`Bounded buffers instead of unbounded queues.`, r`429/503 with Retry-After at service boundaries.`, r`Pull-based consumers let lag grow safely.`, r`Shed low-priority work first; alert on lag.`],
  ex: r`An unbounded in-memory queue in an ingestion API caused OOM crashes during spikes; a bounded channel plus 503s kept it alive and let clients retry.`,
  fu: [r`What is adaptive concurrency limiting?`],
  pit: [r`Unbounded buffers that hide overload until memory runs out.`] },

{ id: 'q14', level: 'Intermediate', tags: ['two-phase-commit'],
  q: r`How does two-phase commit work, and why is it rarely used across microservices?`,
  a: r`**2PC**: a coordinator asks all participants to **prepare** (vote yes after making changes durable and holding locks); if all vote yes, it tells them to **commit**, otherwise **abort**.

Problems in microservice environments:

- **Blocking**: if the coordinator fails after prepare, participants hold locks until it recovers.
- **Latency and availability**: every participant must be up; locks span network round trips.
- **Support**: many brokers, NoSQL stores and HTTP APIs cannot participate (no XA).
- **Coupling**: services must share a transaction protocol and coordinator.

Where it is used: within one database engine (distributed transactions across shards in Spanner/CockroachDB use consensus-backed variants), MSDTC across SQL Server instances in legacy systems, Kafka transactions internally.

Across services, use **sagas** (local transactions + compensations), **outbox** for reliable messaging, and **reconciliation**.`,
  code: r`~~~csharp
// Legacy-style distributed transaction (avoid across services): escalates to a coordinator, holds locks across both
using var scope = new TransactionScope(TransactionScopeAsyncFlowOption.Enabled);
await ordersDb.SaveAsync(order);
await billingDb.SaveAsync(invoice);     // second resource -> distributed transaction (where supported at all)
scope.Complete();
// Preferred: local transaction + outbox, then a saga step in the billing service
await using var tx = await ordersDb.Database.BeginTransactionAsync(ct);
ordersDb.Orders.Add(order); ordersDb.Outbox.Add(OutboxMessage.From(new OrderPlaced(order.Id, order.Total)));
await ordersDb.SaveChangesAsync(ct); await tx.CommitAsync(ct);
~~~`,
  dia: r`sequenceDiagram
  participant C as Coordinator
  participant A as Participant A
  participant B as Participant B
  C->>A: prepare
  C->>B: prepare
  A-->>C: yes (locks held)
  B-->>C: yes (locks held)
  C->>A: commit
  C->>B: commit
  Note over A,B: if C crashes after prepare, A and B block holding locks`,
  pts: [r`2PC: prepare (vote, lock) then commit or abort.`, r`Blocks if the coordinator fails after prepare.`, r`Requires all participants up and XA support.`, r`Used inside databases and some engines, not across services.`, r`Across services: sagas, outbox and reconciliation.`],
  ex: r`A legacy system's MSDTC transactions across three databases caused hours-long blocking after a coordinator crash; migrating to sagas removed the dependency.`,
  fu: [r`What is three-phase commit and why is it not common?`],
  pit: [r`Proposing 2PC across HTTP services.`] },

{ id: 'q15', level: 'Intermediate', tags: ['caching', 'consistency'],
  q: r`What consistency problems do caches introduce in distributed systems, and how do you manage them?`,
  a: r`Problems:

- **Staleness**: cached data lags the source of truth.
- **Race on invalidation**: a reader loads old data, a writer updates and deletes the key, then the reader writes old data back into the cache.
- **Thundering herd** on expiry of hot keys.
- **Inconsistent caches across nodes** (L1 caches in each pod).
- **Cache as a hidden dependency**: when it fails, the database receives full load.

Management:

- Define a **staleness budget** per data type; never cache data used for authoritative decisions (balances for withdrawals).
- Delete-on-write plus TTLs; **versioned values** (set only if newer); CDC-driven invalidation to catch all writers.
- Single-flight / early refresh against stampedes; TTL jitter.
- Short L1 TTLs plus pub/sub invalidation.
- Capacity-plan the database for cache failure (or protect it with bulkheads).`,
  code: r`~~~csharp
// Versioned cache write: only overwrite with newer data (prevents the stale write-back race)
var script = LuaScript.Prepare(@"
  local v = tonumber(redis.call('HGET', @key, 'ver') or '-1')
  if v >= tonumber(@ver) then return 0 end
  redis.call('HSET', @key, 'ver', @ver, 'data', @data)
  redis.call('PEXPIRE', @key, @ttl)
  return 1");
await redis.ScriptEvaluateAsync(script, new { key = (RedisKey)("acct-view:" + id), ver = row.Version, data = json, ttl = 60_000 });
~~~`,
  pts: [r`Caches trade freshness for speed: set a staleness budget.`, r`The delete-then-repopulate race needs versions or TTLs.`, r`CDC invalidation covers all writers.`, r`Protect against stampedes and cache outages.`, r`Never decide money from a cache.`],
  ex: r`A versioned cache write fixed a bug where customers occasionally saw their previous address for hours after updating it.`,
  fu: [r`How do you measure cache staleness?`],
  pit: [r`Caching balances used for authorisation decisions.`] },

{ id: 'q16', level: 'Intermediate', tags: ['service-discovery', 'load-balancing'],
  q: r`How do service discovery and client-side vs server-side load balancing work?`,
  a: r`**Service discovery** maps a logical service name to healthy instances:

- **DNS-based**: Kubernetes Services (ClusterIP), cloud DNS; simple, but DNS caching and TTLs delay updates.
- **Registry-based**: Consul, Eureka, etcd: instances register with health checks; clients query.
- **Platform-based**: service meshes (Istio/Linkerd) and their control planes push endpoint lists to sidecar proxies.

**Load balancing**:

- **Server-side**: an L4/L7 load balancer in front (ALB, Azure Load Balancer, Kubernetes Service via kube-proxy). Simple for clients; an extra hop.
- **Client-side**: the client (or sidecar) knows all endpoints and balances itself (gRPC client-side LB, YARP, Envoy): fewer hops, smarter algorithms (least requests, P2C), but requires a discovery feed.

For gRPC/HTTP2 long-lived connections, L4 balancing pins connections to a few pods: use L7/client-side balancing or headless services.`,
  code: r`~~~csharp
// .NET service discovery (Microsoft.Extensions.ServiceDiscovery) with client-side resolution
builder.Services.AddServiceDiscovery();
builder.Services.AddHttpClient<IInventory, InventoryClient>(c => c.BaseAddress = new Uri("https+http://inventory"))
    .AddServiceDiscovery();              // resolves "inventory" to endpoints (config, DNS SRV, or platform)
// gRPC client-side round robin over a headless Kubernetes service
var channel = GrpcChannel.ForAddress("dns:///pricing-headless.default.svc.cluster.local:5001",
    new GrpcChannelOptions { Credentials = ChannelCredentials.SecureSsl, ServiceConfig = new ServiceConfig { LoadBalancingConfigs = { new RoundRobinConfig() } } });
~~~`,
  pts: [r`Discovery maps names to healthy instances: DNS, registries or mesh control planes.`, r`Server-side LB is simple but adds a hop.`, r`Client-side LB enables smarter algorithms with a discovery feed.`, r`HTTP/2 and gRPC need L7 or client-side balancing.`, r`Health checks drive which endpoints receive traffic.`],
  ex: r`A gRPC service behind a ClusterIP sent 90% of traffic to two pods because connections were long-lived; client-side round robin over a headless service balanced it.`,
  fu: [r`Why does DNS caching hurt failover?`],
  pit: [r`L4 load balancing for long-lived HTTP/2 connections.`] },

{ id: 'q17', level: 'Intermediate', tags: ['observability', 'tracing'],
  q: r`How does distributed tracing work across HTTP and messaging, and what does it reveal that logs do not?`,
  a: r`A **trace** represents one request's journey; it consists of **spans** (operations) with parent-child relationships, timing and attributes. Context (trace id, span id, flags) propagates via the **W3C traceparent** header on HTTP/gRPC and via message headers on queues.

OpenTelemetry in .NET: {{ActivitySource}}/{{Activity}} create spans; instrumentation libraries cover ASP.NET Core, HttpClient, SQL clients, Redis, gRPC, Kafka and Service Bus clients. For messaging, producers inject context into message headers; consumers extract it and start a span linked to (or child of) the producer span.

What traces reveal:

- Where time goes across services (critical path).
- Fan-out and N+1 calls between services.
- Which dependency failed and how errors propagate.
- Queue time (time between publish and consume).

Sampling: head-based (decide at the start) is cheap; tail-based (decide after completion, keeping errors and slow traces) is more useful but needs a collector tier.`,
  code: r`~~~csharp
private static readonly ActivitySource Source = new("Payments");
// Producer: inject trace context into Kafka headers
using (var span = Source.StartActivity("publish payments.captured", ActivityKind.Producer))
{
    var headers = new Headers();
    Propagators.DefaultTextMapPropagator.Inject(new PropagationContext(span!.Context, Baggage.Current), headers,
        (h, k, v) => h.Add(k, Encoding.UTF8.GetBytes(v)));
    await producer.ProduceAsync("payments.captured", new Message<string, string> { Key = id, Value = json, Headers = headers });
}
// Consumer: extract and continue the trace
var parent = Propagators.DefaultTextMapPropagator.Extract(default, msg.Headers,
    (h, k) => h.TryGetLastBytes(k, out var b) ? [Encoding.UTF8.GetString(b)] : []);
using var consume = Source.StartActivity("consume payments.captured", ActivityKind.Consumer, parent.ActivityContext);
~~~`,
  pts: [r`Traces are trees of timed spans for one request.`, r`W3C traceparent propagates context over HTTP and message headers.`, r`OpenTelemetry instruments most .NET libraries automatically.`, r`Traces reveal critical paths, fan-out, failures and queue time.`, r`Tail-based sampling keeps errors and slow traces.`],
  ex: r`A trace showed a checkout calling the pricing service 37 times per request (N+1 across services); batching cut p99 by 600 ms.`,
  fu: [r`Span links vs parent-child for batch consumers?`],
  pit: [r`Losing trace context across message brokers.`] },

{ id: 'q18', level: 'Intermediate', tags: ['crdt'],
  q: r`What are CRDTs, and when would you use them?`,
  a: r`**Conflict-free replicated data types** are data structures that can be updated independently on different replicas and **merged automatically** to the same result, regardless of order or duplication (merge is commutative, associative and idempotent).

Examples:

- **G-Counter / PN-Counter**: per-replica counters summed (increments/decrements).
- **G-Set, OR-Set**: add-only or add/remove sets with unique tags.
- **LWW-Register**: last-writer-wins by timestamp (simple, can lose concurrent updates).
- **Sequences/text CRDTs** (RGA, Yjs, Automerge) for collaborative editing.

Use when you need availability and local writes in multiple places (multi-region active-active counters, offline-first mobile apps, collaborative documents, shopping carts) and the data's semantics fit a CRDT. Do not use for invariants like "balance >= 0" (needs coordination). Redis Enterprise active-active and Azure Cosmos DB (custom merge) offer CRDT-like features.`,
  code: r`~~~csharp
// PN-Counter: each replica increments its own slot; merge takes per-replica max
public sealed record PnCounter(ImmutableDictionary<string, long> P, ImmutableDictionary<string, long> N)
{
    public static PnCounter Empty => new(ImmutableDictionary<string, long>.Empty, ImmutableDictionary<string, long>.Empty);
    public PnCounter Increment(string replica, long by = 1) => this with { P = P.SetItem(replica, P.GetValueOrDefault(replica) + by) };
    public PnCounter Decrement(string replica, long by = 1) => this with { N = N.SetItem(replica, N.GetValueOrDefault(replica) + by) };
    public long Value => P.Values.Sum() - N.Values.Sum();
    public PnCounter Merge(PnCounter o) => new(MaxMerge(P, o.P), MaxMerge(N, o.N));     // commutative, idempotent
    private static ImmutableDictionary<string, long> MaxMerge(ImmutableDictionary<string, long> a, ImmutableDictionary<string, long> b) =>
        a.Keys.Union(b.Keys).ToImmutableDictionary(k => k, k => Math.Max(a.GetValueOrDefault(k), b.GetValueOrDefault(k)));
}
~~~`,
  pts: [r`CRDTs merge concurrent updates deterministically without coordination.`, r`Merge must be commutative, associative and idempotent.`, r`Counters, sets, registers and text sequences exist.`, r`Great for active-active counters, offline apps and collaboration.`, r`Not for invariants like non-negative balances.`],
  ex: r`A global "likes" counter used a PN-counter per region, removing cross-region write latency while converging within a second.`,
  fu: [r`Why can LWW registers lose data?`],
  pit: [r`Using CRDTs where business invariants require coordination.`] },

{ id: 'q19', level: 'Senior', tags: ['cap-in-practice'],
  q: r`Give concrete examples of CP and AP choices in real systems you would build, and how you would explain them to product owners.`,
  a: r`Translate CAP into user-facing behaviour during failures:

| Feature | Choice | Behaviour during partition |
|---|---|---|
| Money transfer | CP | "Transfers temporarily unavailable" rather than risk overdrafts or double spending |
| Inventory reservation for last items | CP | Checkout may fail; no overselling |
| Product browsing | AP | Slightly stale prices/stock shown; final check at checkout |
| Shopping cart | AP | Cart edits always accepted; merge on reconnect |
| Notifications preferences | AP | Eventually consistent; a notification might use old settings |
| Login with existing session | AP-ish | Cached tokens accepted; revocation delayed |

For product owners, explain the trade-off as: "during a rare network problem between our data centres, do we prefer to **refuse** this action or to **accept it and fix inconsistencies later**?" Attach business cost: overselling 10 items vs losing 2 minutes of checkout.`,
  code: r`~~~csharp
// CP path: conditional write on the authoritative store; fail fast when it is unreachable
app.MapPost("/transfers", async (TransferCmd c, ILedger ledger, CancellationToken ct) =>
{
    try { return Results.Ok(await ledger.TransferAsync(c, ct)); }
    catch (LedgerUnavailableException) { return Results.Problem(statusCode: 503, title: "Transfers temporarily unavailable"); }
});
// AP path: accept cart edits locally, merge later
app.MapPost("/cart/items", async (CartItem i, ILocalCartStore carts, ClaimsPrincipal u) =>
{ await carts.AppendAsync(u.UserId(), i); return Results.Accepted(); });   // replicated asynchronously, merged (add-wins set)
~~~`,
  pts: [r`Frame CAP as refuse vs accept-and-fix-later during failures.`, r`Money and last-item inventory are CP.`, r`Browsing, carts and preferences are AP.`, r`Attach business cost to each option.`, r`Final authoritative checks happen at commit points.`],
  ex: r`A product owner chose AP for the cart and CP for payment after seeing the cost of each failure mode in a one-page comparison.`,
  fu: [r`What is the "final check" pattern?`],
  pit: [r`One consistency choice for the whole system.`] },

{ id: 'q20', level: 'Senior', tags: ['clocks', 'time'],
  q: r`Why are wall clocks dangerous in distributed systems, and what do you use instead?`,
  a: r`Wall clocks (NTP-synchronised) drift, jump forwards or backwards on corrections, differ between machines by milliseconds or more, and leap seconds and VM pauses add surprises. Consequences:

- **Last-writer-wins** by timestamp can discard the actual latest write.
- Ordering events across servers by timestamp can be wrong.
- Lease expiry based on local clocks can let two nodes believe they hold a lease.
- Measuring durations with wall time can produce negative values.

Use instead:

- **Monotonic clocks** for durations and timeouts ({{Stopwatch}}, {{TimeProvider.GetTimestamp()}}).
- **Logical clocks** (Lamport, vector clocks) or **hybrid logical clocks** for ordering and causality.
- **Database-assigned sequences / versions** and log offsets for ordering within a system.
- **Fencing tokens** instead of trusting lease timing.
- Bounded-uncertainty clocks (TrueTime, AWS Time Sync with ClockBound) where external consistency matters.`,
  code: r`~~~csharp
// Durations: monotonic, never wall clock
var start = TimeProvider.System.GetTimestamp();
await DoWorkAsync();
var elapsed = TimeProvider.System.GetElapsedTime(start);
// Ordering: use the database's version/sequence, not DateTime.UtcNow from app servers
public sealed record AccountChanged(Guid AccountId, long Version, decimal Balance);   // version assigned in the DB transaction
~~~`,
  pts: [r`Wall clocks drift, jump and disagree across machines.`, r`Timestamp-based LWW can drop the real latest write.`, r`Monotonic clocks for durations and timeouts.`, r`Logical/hybrid clocks or DB sequences for ordering.`, r`Fencing tokens instead of trusting lease timing.`],
  ex: r`An NTP correction moved a server clock back 2 seconds and a timestamp-ordered event log showed refunds before their payments; switching to sequence numbers fixed ordering.`,
  fu: [r`How does Spanner's TrueTime work?`],
  pit: [r`Ordering cross-service events by DateTime.UtcNow.`] },

{ id: 'q21', level: 'Senior', tags: ['outbox', 'dual-write'],
  q: r`Explain the dual-write problem and the patterns that solve it (outbox, CDC, listen-to-yourself).`,
  a: r`**Dual write**: a service updates its database and publishes a message (or updates a cache/search index) as two separate operations. If one succeeds and the other fails (crash, timeout), systems diverge: an order exists but no event was published, or an event was published for an order that rolled back.

Solutions:

- **Transactional outbox**: write the business change and an outbox row in the same local transaction; a relay publishes outbox rows and marks them sent (at-least-once).
- **Change data capture (CDC)**: read the database transaction log (Debezium) and publish changes, either of business tables or of an outbox table (outbox + CDC is a strong combination).
- **Listen to yourself**: publish the event first to a log (Kafka) and have the service update its own database by consuming it (event sourcing style); the log is the source of truth.

All give at-least-once publication; consumers must be idempotent.`,
  code: r`~~~csharp
// Outbox relay: publish committed outbox rows, mark them sent; safe to run on several instances with SKIP LOCKED
public async Task RelayBatchAsync(CancellationToken ct)
{
    await using var tx = await db.Database.BeginTransactionAsync(ct);
    var batch = await db.Outbox.FromSqlRaw("SELECT * FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED").ToListAsync(ct);
    foreach (var m in batch)
    {
        await producer.ProduceAsync(m.Topic, new Message<string, string> { Key = m.AggregateId, Value = m.Payload }, ct);
        m.SentAt = DateTimeOffset.UtcNow;
    }
    await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);    // a crash before commit republishes: consumers dedupe
}
~~~`,
  dia: r`flowchart LR
  S[Service] -->|one local transaction| DB[(Business tables + outbox)]
  DB -->|relay polling or CDC| R[Outbox relay / Debezium]
  R --> B[(Broker)]
  B --> C1[Consumer 1: idempotent]
  B --> C2[Consumer 2: idempotent]`,
  pts: [r`Dual writes diverge when one of two operations fails.`, r`Outbox: business change and message in one local transaction.`, r`CDC publishes from the transaction log.`, r`Listen-to-yourself makes the log the source of truth.`, r`All are at-least-once: consumers must be idempotent.`],
  ex: r`Reconciliation found 0.1% of orders had no OrderPlaced event under dual writes; the outbox brought it to zero.`,
  fu: [r`Polling relay vs CDC: trade-offs?`],
  pit: [r`Publishing inside the database transaction before commit.`] },

{ id: 'q22', level: 'Senior', tags: ['sagas'],
  q: r`How do sagas maintain consistency across services, and what anomalies remain?`,
  a: r`A saga splits a business transaction into **local transactions** per service, each publishing an event or replying to an orchestrator; if a later step fails, **compensating transactions** undo earlier steps semantically (refund, release stock).

Coordination styles:

- **Choreography**: services react to each other's events; simple for few steps, hard to see the whole flow.
- **Orchestration**: a process manager (state machine, Temporal workflow) commands each step; explicit flow, timeouts and visibility.

Remaining anomalies (no isolation):

- **Dirty reads**: others see intermediate states (stock reserved, later released).
- **Lost updates** and **write skew** between concurrent sagas.

Countermeasures: semantic locks (PENDING statuses), commutative updates, version checks, reordering steps (pivot transaction placement), and reconciliation. Every step must be idempotent and every compensation retried until success or escalated.`,
  code: r`~~~csharp
// Orchestrated saga step with compensation on failure (simplified)
public async Task<OrderResult> PlaceAsync(Order o, CancellationToken ct)
{
    await inventory.ReserveAsync(o.Id, o.Lines, ct);                                  // step 1 (compensable)
    try
    {
        var payment = await payments.AuthoriseAsync(o.Id, o.Total, idempotencyKey: "auth-" + o.Id, ct);   // step 2 (compensable)
        if (payment is not AuthResult.Approved) { await inventory.ReleaseAsync(o.Id, ct); return OrderResult.Declined; }
        await orders.ConfirmAsync(o.Id, ct);                                          // pivot: after this, only forward
        return OrderResult.Confirmed;
    }
    catch { await inventory.ReleaseAsync(o.Id, ct); throw; }                           // compensation (idempotent, retried)
}
~~~`,
  dia: r`sequenceDiagram
  participant O as Orchestrator
  participant I as Inventory
  participant P as Payments
  participant S as Orders
  O->>I: Reserve
  I-->>O: Reserved
  O->>P: Authorise
  P-->>O: Declined
  O->>I: Release (compensation)
  O->>S: Mark cancelled`,
  pts: [r`Local transactions per service plus compensations.`, r`Choreography for simple flows; orchestration for complex ones.`, r`No isolation: dirty reads, lost updates, write skew.`, r`Semantic locks, commutative updates and versions mitigate.`, r`Idempotent steps, retried compensations, reconciliation.`],
  ex: r`A travel booking saga used orchestration with explicit timeouts; abandoned hotel holds were released automatically after 15 minutes.`,
  fu: [r`What is a pivot transaction?`],
  pit: [r`Assuming compensations always succeed.`] },

{ id: 'q23', level: 'Senior', tags: ['multi-region', 'replication'],
  q: r`How do you replicate data across regions while keeping latency and correctness acceptable?`,
  a: r`Options:

- **Async replication, single writer region**: low write latency, RPO = replication lag (seconds), RTO = failover time. Most common.
- **Synchronous replication across regions**: RPO 0 but every write pays cross-region latency (tens to 100+ ms); usually only for small critical data or with consensus databases (Spanner, CockroachDB, Cosmos DB strong).
- **Partitioned ownership** (home region per customer/tenant): writes stay local to the owner; other regions read replicas; failover moves ownership.
- **Multi-writer with conflict resolution** (CRDTs, LWW, custom merge) for conflict-tolerant data.

Engineering details: idempotent replication consumers, monitoring replication lag, replicating configuration/secrets/keys, data residency rules (some data must never leave a region), and regular failover drills with measured RPO/RTO.`,
  code: r`~~~text
Latency maths for synchronous cross-region commit (London <-> Frankfurt ~15 ms RTT, London <-> Virginia ~75 ms RTT)
Consensus write across 3 regions (LDN, FRA, VA), leader in LDN: majority = LDN + FRA -> +15 ms per commit
Same with leader in VA: majority = VA + closest (LDN) -> +75 ms per commit
Implication: place the leader near most writers; keep a third region for quorum, not for every write
~~~`,
  dia: r`flowchart LR
  subgraph EU[Region EU: home for EU customers]
    EA[API] --> ED[(DB primary: EU data)]
  end
  subgraph US[Region US: home for US customers]
    UA[API] --> UD[(DB primary: US data)]
  end
  ED -->|async replica for DR| UDR[(EU replica in US)]
  UD -->|async replica for DR| EDR[(US replica in EU)]`,
  pts: [r`Async single-writer: low latency, RPO equals lag.`, r`Synchronous cross-region: RPO 0 at a latency cost per write.`, r`Home-region ownership keeps writes local without conflicts.`, r`Multi-writer only for conflict-tolerant data.`, r`Replicate config and keys, respect residency, drill failovers.`],
  ex: r`A bank kept customer ledgers in their home region and replicated asynchronously to a DR region, measuring RPO under 2 seconds in quarterly drills.`,
  fu: [r`How do you fail back after a regional failover?`],
  pit: [r`Ignoring that DR replicas may violate data residency.`] },

{ id: 'q24', level: 'Senior', tags: ['quorum'],
  q: r`Explain quorum reads and writes (N, R, W). When do R + W > N guarantees break?`,
  a: r`With N replicas, a write is acknowledged after W replicas confirm and a read queries R replicas. If **R + W > N**, read and write sets overlap, so a read sees at least one replica with the latest acknowledged write (then picks the newest version).

Typical settings: N=3, W=2, R=2 (balanced); W=1, R=3 (fast writes); W=3, R=1 (fast reads, writes fail if any replica down).

Where the guarantee weakens:

- **Sloppy quorums / hinted handoff**: writes may go to substitute nodes outside the preferred N, so overlap is not guaranteed.
- **Concurrent writes**: the read sees conflicting versions; resolution (LWW, vector clocks) may drop one.
- **Failed writes** that reached some replicas: a later read may see a value from a write that the client believes failed.
- **Clock-based LWW** with skewed clocks picks the wrong winner.
- Not linearizable by default: readers can see a newer value then an older one unless read repair is synchronous.`,
  code: r`~~~csharp
// Cassandra (DataStax C# driver): choose consistency per statement
var insert = new SimpleStatement("INSERT INTO balances_view (account_id, balance, version) VALUES (?, ?, ?)", id, bal, ver)
    .SetConsistencyLevel(ConsistencyLevel.LocalQuorum);
var read = new SimpleStatement("SELECT balance, version FROM balances_view WHERE account_id = ?", id)
    .SetConsistencyLevel(ConsistencyLevel.LocalQuorum);     // RF=3 in this DC: W=2, R=2 -> overlap within the DC
~~~`,
  pts: [r`R + W > N makes read and write sets overlap.`, r`Tune N, R, W for latency vs availability.`, r`Sloppy quorums and hinted handoff weaken the overlap.`, r`Concurrent writes still need conflict resolution.`, r`Quorums alone are not linearizable.`],
  ex: r`A team using ONE/ONE consistency saw balances "go backwards" on refresh; LOCAL_QUORUM for both fixed it within each region.`,
  fu: [r`What is read repair?`],
  pit: [r`Assuming quorum means strongly consistent under every failure.`] },

{ id: 'q25', level: 'Senior', tags: ['event-driven', 'consistency'],
  q: r`In an event-driven architecture, how do you handle out-of-order, duplicate and missing events?`,
  a: r`- **Duplicates**: idempotent consumers (inbox table, dedupe by event id, upserts keyed by entity and version).
- **Out of order**: key events by entity so they land in one partition (ordered per entity); include a **version/sequence** per entity and ignore older versions; or buffer briefly and reorder within a window.
- **Missing events** (gaps): detect via per-entity sequence numbers (version jumps from 5 to 7); fetch the current state from the source (API) or request replay; periodic **reconciliation** jobs compare projections with sources.
- **Late events**: decide policy (apply if newer, ignore if older) and for aggregates, watermarks.
- **Schema changes**: versioned events, tolerant readers.

Event-carried state (full entity snapshots with versions) is more robust than deltas: applying the newest snapshot is idempotent and order-insensitive.`,
  code: r`~~~csharp
public async Task HandleAsync(CustomerUpdatedV2 e, CancellationToken ct)
{
    var current = await db.CustomerView.FindAsync([e.CustomerId], ct);
    if (current is not null && e.Version <= current.Version) return;                          // duplicate or stale
    if (current is not null && e.Version > current.Version + 1)
        logger.LogWarning("Gap for {Customer}: {From} -> {To}; snapshot applied, reconciliation queued", e.CustomerId, current.Version, e.Version);
    db.CustomerView.Update(CustomerView.From(e));                                             // full snapshot: order-insensitive
    await db.SaveChangesAsync(ct);
}
~~~`,
  pts: [r`Idempotent consumers handle duplicates.`, r`Partition by entity and use versions for ordering.`, r`Detect gaps with sequence numbers; fetch or reconcile.`, r`Snapshots with versions are order-insensitive.`, r`Version event schemas; tolerant readers.`],
  ex: r`Switching a projection from delta events to versioned snapshots ended a recurring drift that required weekly rebuilds.`,
  fu: [r`When are delta events better than snapshots?`],
  pit: [r`Projections that apply deltas without version checks.`] },

{ id: 'q26', level: 'Senior', tags: ['resilience', 'cascading-failures'],
  q: r`How do cascading failures happen, and how do you prevent them?`,
  a: r`A cascade starts when one component slows or fails and its callers consume resources waiting (threads, connections, memory), retry aggressively, and fail in turn, spreading outage across the system.

Common triggers: a slow database, a dependency outage, a retry storm, a bad deploy, sudden load, GC pauses.

Prevention:

- **Timeouts** everywhere (bounded waiting).
- **Bulkheads**: separate pools/limits per dependency so one cannot exhaust all resources.
- **Circuit breakers**: fail fast when a dependency is unhealthy.
- **Retry discipline**: budgets, jitter, one layer.
- **Load shedding and rate limiting**: reject early, prioritise critical traffic.
- **Graceful degradation**: optional features fail closed (no recommendations) while core flows continue.
- **Capacity headroom** and autoscaling with sensible limits.
- **Cells/shuffle sharding** to limit blast radius.
- **Testing**: chaos experiments and load tests of failure modes.`,
  code: r`~~~csharp
// Bulkheads: each dependency gets its own concurrency budget, so a slow one cannot starve the rest
builder.Services.AddHttpClient<IRecommendations, RecommendationsClient>()
    .AddResilienceHandler("recs", p => p.AddConcurrencyLimiter(50).AddTimeout(TimeSpan.FromMilliseconds(150))
        .AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions { FailureRatio = 0.3, MinimumThroughput = 20, BreakDuration = TimeSpan.FromSeconds(20) }));
builder.Services.AddHttpClient<IPayments, PaymentsClient>()
    .AddResilienceHandler("payments", p => p.AddConcurrencyLimiter(200).AddTimeout(TimeSpan.FromSeconds(3)));
~~~`,
  dia: r`flowchart LR
  U[Users] --> API[Checkout API]
  API -->|bulkhead 200, timeout 3s| PAY[Payments]
  API -->|bulkhead 50, timeout 150ms, breaker| REC[Recommendations: slow]
  REC -. breaker open -> empty list .-> API
  API --> OK[Checkout keeps working]`,
  pts: [r`Cascades spread through exhausted resources and retry storms.`, r`Timeouts and bulkheads bound the damage.`, r`Circuit breakers fail fast; retries are budgeted.`, r`Shed load and degrade optional features.`, r`Cells, headroom and chaos tests limit blast radius.`],
  ex: r`A slow recommendation service took down checkout via thread starvation until bulkheads and a 150 ms timeout made it optional.`,
  fu: [r`What is a metastable failure?`],
  pit: [r`Shared HTTP connection pools across all dependencies with no limits.`] },

{ id: 'q27', level: 'Senior', tags: ['leader-election'],
  q: r`How do you implement leader election for a singleton task (scheduler, partition coordinator) in a .NET service running on Kubernetes?`,
  a: r`Options:

- **Kubernetes Lease objects** (coordination.k8s.io): instances compete to update a Lease with holder identity and renew time; client libraries implement leader election. Native and cheap.
- **Database lease row** with conditional updates and an incrementing token.
- **Blob lease** (Azure Storage) or **DynamoDB conditional writes** with TTL.
- **Consensus stores** (etcd/Consul/ZooKeeper) for strong guarantees.

Key requirements:

- **Lease duration** and **renew interval** (renew at ~1/3 of duration).
- **Stop work** immediately when renewal fails (cancellation token tied to leadership).
- **Fencing tokens** passed to downstream writes, so a paused former leader cannot corrupt state.
- **Idempotent work**, since brief overlaps are possible.
- Observability: metric for who is leader, leadership changes.`,
  code: r`~~~csharp
public sealed class LeaderGuardedWorker(ILeaseClient leases, ISettlementRunner runner, ILogger<LeaderGuardedWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            var lease = await leases.TryAcquireAsync("settlement", Environment.MachineName, TimeSpan.FromSeconds(30), stop);
            if (lease is null) { await Task.Delay(TimeSpan.FromSeconds(10), stop); continue; }
            using var leadership = CancellationTokenSource.CreateLinkedTokenSource(stop);
            var renewal = Task.Run(async () =>
            {
                while (!leadership.IsCancellationRequested)
                {
                    await Task.Delay(TimeSpan.FromSeconds(10), leadership.Token);
                    if (!await lease.RenewAsync(leadership.Token)) { log.LogWarning("Lost leadership"); leadership.Cancel(); }
                }
            });
            try { await runner.RunAsync(fencingToken: lease.Token, leadership.Token); }   // work stops when leadership ends
            catch (OperationCanceledException) when (!stop.IsCancellationRequested) { }
        }
    }
}
~~~`,
  pts: [r`Use platform leases (Kubernetes Lease, blob leases) or consensus stores.`, r`Renew at about a third of the lease duration.`, r`Tie work cancellation to losing leadership.`, r`Pass fencing tokens downstream.`, r`Keep work idempotent; expose leadership metrics.`],
  ex: r`A settlement scheduler on three pods used Kubernetes Leases; during a node failure leadership moved in 20 seconds and the fencing token rejected one late write from the old pod.`,
  fu: [r`How short can a lease be before false failovers increase?`],
  pit: [r`Continuing work after a failed renewal.`] },

{ id: 'q28', level: 'Senior', tags: ['data-consistency', 'reconciliation'],
  q: r`Why is reconciliation essential even in well-designed distributed systems? Design a reconciliation process.`,
  a: r`Even with outbox, idempotency and sagas, some failures have **no detector**: a bug that skips an event, a provider that succeeded without notifying you, manual database fixes, partial data loss after failover, clock or rounding differences. Reconciliation compares independent sources of truth to find divergence.

Process:

1. **Define pairs** to compare (orders vs payments, ledger vs PSP settlement file, inventory vs warehouse counts, projections vs sources).
2. **Extract** snapshots at a consistent cut-off (as-of time, with allowances for in-flight items).
3. **Match** by keys with tolerance rules (amounts, dates).
4. **Classify breaks**: missing on one side, mismatched values, duplicates, timing (resolves automatically next run).
5. **Auto-resolve** known patterns (replay missing events, mark timing differences), route the rest to an operations queue with SLAs.
6. **Report** metrics (break counts, ageing) and alert on thresholds.
7. **Learn**: recurring break types become bug fixes.`,
  code: r`~~~sql
-- Orders marked PAID without a captured payment (and vice versa), excluding the last 15 minutes of in-flight activity
SELECT o.order_id, o.status, p.status AS payment_status
FROM orders o
FULL OUTER JOIN payments p ON p.order_id = o.order_id
WHERE COALESCE(o.updated_at, p.updated_at) < now() - interval '15 minutes'
  AND ((o.status = 'PAID' AND (p.status IS DISTINCT FROM 'CAPTURED'))
    OR (p.status = 'CAPTURED' AND (o.status IS DISTINCT FROM 'PAID')));
~~~`,
  pts: [r`Some failures have no detector; reconciliation finds them.`, r`Compare independent sources at a consistent cut-off.`, r`Classify breaks and auto-resolve known patterns.`, r`Route the rest to an operations queue with SLAs.`, r`Turn recurring breaks into bug fixes.`],
  ex: r`Nightly orders-vs-payments reconciliation found 40 captured payments with unfulfilled orders after a consumer bug; customers were shipped or refunded within a day.`,
  fu: [r`How do you choose the in-flight allowance window?`],
  pit: [r`Believing idempotency makes reconciliation unnecessary.`] },

{ id: 'q29', level: 'Senior', tags: ['actors', 'orleans'],
  q: r`What is the actor model, and when would you use Microsoft Orleans or Akka.NET?`,
  a: r`In the actor model, an **actor** owns its state privately and processes messages **one at a time**; actors communicate only via messages. This removes shared-memory locking and maps naturally to entities (an account, a device, a game session).

**Orleans** (virtual actors / grains): grains are identified by keys, activated on demand, placed across a cluster automatically, persisted via storage providers, and deactivated when idle. The runtime handles location transparency and failover.

Use when:

- Many independent stateful entities with frequent interactions (IoT devices, gaming, chat rooms, per-account rate limiters, shopping carts).
- You need low-latency in-memory state with persistence and automatic distribution.

Caveats: single-threaded per grain can become a hotspot for very hot entities; cross-grain transactions are limited; at-least-once message semantics need idempotency; operational familiarity required.`,
  code: r`~~~csharp
public interface IDeviceGrain : IGrainWithStringKey { Task RecordAsync(Reading r); Task<DeviceStatus> GetStatusAsync(); }
public sealed class DeviceGrain([PersistentState("device", "store")] IPersistentState<DeviceState> state) : Grain, IDeviceGrain
{
    public async Task RecordAsync(Reading r)                     // runs single-threaded per device: no locks
    {
        state.State.Last = r;
        state.State.Count++;
        if (r.Temperature > 80) state.State.Alarm = true;
        if (state.State.Count % 100 == 0) await state.WriteStateAsync();
    }
    public Task<DeviceStatus> GetStatusAsync() => Task.FromResult(new DeviceStatus(state.State.Last, state.State.Alarm));
}
// Caller: location-transparent
var device = grainFactory.GetGrain<IDeviceGrain>("device-42");
await device.RecordAsync(reading);
~~~`,
  pts: [r`Actors own state and process messages one at a time.`, r`No shared-memory locks; maps well to entities.`, r`Orleans grains are virtual: activated, placed and persisted automatically.`, r`Great for many independent stateful entities.`, r`Watch hot actors, cross-actor transactions and idempotency.`],
  ex: r`A telematics platform modelled 2 million vehicles as Orleans grains, processing 150,000 updates per second on a 12-node cluster.`,
  fu: [r`How does Orleans handle a silo failure?`],
  pit: [r`Putting a global singleton grain in the hot path.`] },

{ id: 'q30', level: 'Senior', tags: ['testing', 'chaos'],
  q: r`How do you test distributed systems for correctness and resilience?`,
  a: r`- **Contract tests** between services (consumer-driven, Pact) and schema compatibility checks for events.
- **Integration tests with real dependencies** (Testcontainers: databases, Kafka, Redis) including failure injection (stop a container mid-test).
- **Deterministic simulation** where feasible: run components in a single process with simulated network and clock (FoundationDB-style); powerful for consensus and workflow logic.
- **Property-based tests** of invariants (no money created or lost across random sequences of operations).
- **Jepsen-style tests**: partitions, clock skew and crashes while checking linearizability/consistency claims.
- **Chaos engineering in production-like environments**: kill pods, add latency, drop packets, fail a zone (Azure Chaos Studio, AWS FIS, Chaos Mesh), with hypotheses and blast-radius limits.
- **Game days** and failover drills with measured RTO/RPO.
- **Load tests** to find saturation points and metastable failure behaviour.`,
  code: r`~~~yaml
# Chaos Mesh: inject 300 ms latency between checkout and payments for 5 minutes in staging
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata: { name: payments-latency }
spec:
  action: delay
  mode: all
  selector: { namespaces: [staging], labelSelectors: { app: payments } }
  delay: { latency: "300ms", jitter: "50ms" }
  direction: to
  target: { selector: { namespaces: [staging], labelSelectors: { app: checkout } }, mode: all }
  duration: "5m"
~~~`,
  pts: [r`Contract tests and schema checks between services.`, r`Integration tests with real dependencies and injected failures.`, r`Property-based and simulation tests for invariants.`, r`Jepsen-style partition and clock tests for consistency claims.`, r`Chaos experiments, game days and load tests.`],
  ex: r`A latency-injection experiment revealed checkout had no timeout on a payments call; the fix landed before the next peak.`,
  fu: [r`What is deterministic simulation testing?`],
  pit: [r`Only testing happy paths with mocked dependencies.`] },

{ id: 'q31', level: 'Senior', tags: ['gossip', 'membership'],
  q: r`How do gossip protocols work, and where are they used?`,
  a: r`In a gossip (epidemic) protocol, each node periodically exchanges state with a few random peers. Information spreads exponentially: with n nodes, updates reach all nodes in O(log n) rounds, without a central coordinator.

Uses:

- **Membership and failure detection** (SWIM, Consul/Serf, Cassandra): who is alive, suspected or dead.
- **Cluster metadata dissemination** (ring ownership in Cassandra, Redis Cluster bus).
- **Anti-entropy**: replicas exchange summaries (Merkle trees) to repair divergence.
- **Aggregations** (approximate averages, counts).

Properties: scalable and robust (no single point of failure), eventually consistent, bandwidth bounded by fan-out and frequency. Trade-offs: convergence is probabilistic and not instant; misbehaving nodes can spread bad state without safeguards.`,
  code: r`~~~csharp
// Simplified gossip round: merge membership views by highest incarnation number
public sealed record Member(string Id, string State, long Incarnation);   // Alive / Suspect / Dead
public static Dictionary<string, Member> Merge(Dictionary<string, Member> mine, IEnumerable<Member> theirs)
{
    foreach (var m in theirs)
        if (!mine.TryGetValue(m.Id, out var cur) || m.Incarnation > cur.Incarnation || (m.Incarnation == cur.Incarnation && Rank(m.State) > Rank(cur.State)))
            mine[m.Id] = m;
    return mine;
}
static int Rank(string s) => s switch { "Dead" => 3, "Suspect" => 2, _ => 1 };
// Every second: pick 3 random peers, send my view, merge theirs -> converges in O(log n) rounds
~~~`,
  pts: [r`Nodes exchange state with random peers periodically.`, r`Updates reach everyone in O(log n) rounds.`, r`Used for membership, failure detection, metadata and anti-entropy.`, r`No central coordinator; robust and scalable.`, r`Convergence is probabilistic and eventual.`],
  ex: r`Consul's gossip-based membership let a 2,000-node fleet detect failed agents within seconds without a central health checker.`,
  fu: [r`How does SWIM reduce false positives?`],
  pit: [r`Expecting gossip to give instant, consistent membership.`] },

{ id: 'q32', level: 'Senior', tags: ['distributed-transactions', 'newsql'],
  q: r`When would you use a distributed SQL database (Spanner, CockroachDB, YugabyteDB, Cosmos DB strong) instead of sharding a traditional database?`,
  a: r`Distributed SQL databases provide horizontal scale **and** ACID transactions across shards/regions using consensus (Raft/Paxos) per data range and distributed transaction protocols, with SQL interfaces.

Choose them when:

- You need **strong consistency across partitions** (global uniqueness, multi-entity transactions) at a scale or geographic spread one primary cannot handle.
- **Multi-region writes** with no conflict-resolution code and automatic failover.
- Operational simplicity of automatic rebalancing vs hand-managed shards.

Costs:

- **Latency**: every write needs a quorum; cross-region transactions pay round trips.
- **Compatibility**: not identical to PostgreSQL/SQL Server; some features differ.
- **Cost and expertise**; contention on hot rows is still a problem.

Hand-sharding a traditional database remains attractive when access is naturally partitioned (by tenant) and cross-shard transactions are rare.`,
  code: r`~~~sql
-- CockroachDB: pin a table's leaseholders to the region of its rows (lower latency for local users)
ALTER DATABASE bank SET PRIMARY REGION "europe-west1";
ALTER DATABASE bank ADD REGION "us-east1";
ALTER TABLE accounts SET LOCALITY REGIONAL BY ROW;          -- each row lives in its crdb_region
-- A transfer between an EU and a US account is still ACID, but pays cross-region consensus latency
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 'eu-1' AND balance >= 100;
UPDATE accounts SET balance = balance + 100 WHERE id = 'us-7';
COMMIT;
~~~`,
  pts: [r`Distributed SQL gives ACID across shards and regions via consensus.`, r`Use for strong cross-partition consistency and multi-region writes.`, r`Costs: quorum latency, compatibility differences, expertise.`, r`Hot rows still contend.`, r`Hand-sharding fits naturally partitioned workloads.`],
  ex: r`A global loyalty programme moved to a distributed SQL database to keep point balances consistent across regions without custom conflict handling.`,
  fu: [r`What is a leaseholder in CockroachDB?`],
  pit: [r`Expecting single-region latency for cross-region transactions.`] },

{ id: 'q33', level: 'Senior', tags: ['stream-processing'],
  q: r`How do stream processors (Flink, Kafka Streams) achieve fault-tolerant, stateful processing?`,
  a: r`Key mechanisms:

- **Partitioned state**: state (counts, windows, joins) is partitioned by key, co-located with the input partitions.
- **Checkpointing / snapshots**: Flink periodically takes consistent snapshots of operator state plus input offsets (Chandy-Lamport-style barriers); on failure, it restores state and rewinds input to the snapshot offsets.
- **Changelog topics** (Kafka Streams): state stores are backed by compacted Kafka topics; a restarted instance rebuilds state from the changelog (standby replicas speed this up).
- **Exactly-once**: Kafka transactions (Kafka Streams {{processing.guarantee=exactly_once_v2}}) or Flink two-phase commit sinks.
- **Event time and watermarks** for correct windowing with late data.
- **Rescaling** by redistributing key groups/partitions.

Operational concerns: state size (RocksDB backends), checkpoint duration, recovery time, schema evolution of state, and backpressure.`,
  code: r`~~~text
Kafka Streams (Java/Kotlin, conceptually): exactly-once windowed count per merchant
props.put("processing.guarantee", "exactly_once_v2")
builder.stream("payments", Consumed.with(...))
       .groupByKey()
       .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofMinutes(1)))
       .count(Materialized.as("payments-per-minute-store"))   // RocksDB store + changelog topic
       .toStream().to("payments-per-minute")
~~~`,
  pts: [r`State is partitioned by key alongside input partitions.`, r`Checkpoints snapshot state plus offsets for recovery.`, r`Kafka Streams backs state stores with changelog topics.`, r`Exactly-once via Kafka transactions or 2PC sinks.`, r`Event time, watermarks and rescaling by key groups.`],
  ex: r`A fraud-feature pipeline in Flink recovered from a node loss in 40 seconds by restoring RocksDB state from the last checkpoint.`,
  fu: [r`What limits recovery time for large state?`],
  pit: [r`Storing processor state in an external database per event without batching.`] },

{ id: 'q34', level: 'Senior', tags: ['api-consistency', 'pagination'],
  q: r`How do you keep reads consistent across multiple services (API composition, read models) when each service owns its data?`,
  a: r`Options:

- **API composition** (BFF/aggregator): query each service and join in memory. Simple; latency adds up; data may be from slightly different moments; partial failures need handling.
- **CQRS read models / materialised views**: a projection service consumes events from all owners and maintains a denormalised view for the query. Fast reads; eventual consistency; projections must handle duplicates and ordering.
- **Data replication of reference data** into consumers (with ownership remaining at the source).
- **Snapshot consistency** for reports: query each source as of the same timestamp/version where supported (temporal tables, event offsets).

Communicate staleness explicitly (as-of timestamps in responses), and use a **final authoritative check** at the moment of an important decision (place order).`,
  code: r`~~~csharp
// Read model maintained from events of three owners, with an "as of" for transparency
public sealed record CustomerOverview(Guid CustomerId, string Name, int OpenOrders, decimal Balance, DateTimeOffset AsOf);
public sealed class OverviewProjector(ReadDb db) :
    IConsumer<CustomerRenamed>, IConsumer<OrderPlaced>, IConsumer<OrderClosed>, IConsumer<BalanceChanged>
{
    public Task Consume(ConsumeContext<OrderPlaced> c) => db.UpsertAsync(c.Message.CustomerId, v => v with { OpenOrders = v.OpenOrders + 1, AsOf = c.Message.At });
    public Task Consume(ConsumeContext<OrderClosed> c) => db.UpsertAsync(c.Message.CustomerId, v => v with { OpenOrders = v.OpenOrders - 1, AsOf = c.Message.At });
    public Task Consume(ConsumeContext<BalanceChanged> c) => db.UpsertIfNewerAsync(c.Message.CustomerId, c.Message.Version, v => v with { Balance = c.Message.Balance, AsOf = c.Message.At });
    public Task Consume(ConsumeContext<CustomerRenamed> c) => db.UpsertAsync(c.Message.CustomerId, v => v with { Name = c.Message.Name });
}
~~~`,
  pts: [r`API composition: simple, slower, mixed moments in time.`, r`Read models: fast, eventually consistent, built from events.`, r`Replicate reference data with clear ownership.`, r`Expose as-of timestamps.`, r`Make final authoritative checks at decision points.`],
  ex: r`A customer-360 screen moved from composing 6 APIs (1.2 s) to a read model (40 ms) with an "updated 3 s ago" indicator.`,
  fu: [r`How do you rebuild a read model from scratch?`],
  pit: [r`Treating composed reads as a consistent snapshot.`] },

{ id: 'q35', level: 'Senior', tags: ['security', 'zero-trust'],
  q: r`How do you secure communication between services in a distributed system (zero trust)?`,
  a: r`Zero trust: never trust network location; authenticate and authorise every call.

- **Service identity**: workload identities (SPIFFE IDs, Kubernetes service accounts, managed identities) instead of shared secrets.
- **mTLS** between services (often via a service mesh) for encryption and peer authentication, with automatic certificate rotation.
- **Authorisation**: service-to-service policies (mesh AuthorizationPolicy: only checkout may call payments/charge), plus user context propagation (token exchange, on-behalf-of) for end-user authorisation in downstream services.
- **Least privilege** for data access (per-service database users, scoped cloud IAM).
- **Secrets** in vaults with short-lived credentials.
- **Network policies** as defence in depth (deny by default).
- **Audit and anomaly detection** on service-to-service calls.`,
  code: r`~~~yaml
# Istio: require mTLS and allow only checkout to call the payments charge endpoint
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata: { name: default, namespace: payments }
spec: { mtls: { mode: STRICT } }
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata: { name: charge-only-from-checkout, namespace: payments }
spec:
  selector: { matchLabels: { app: payments } }
  action: ALLOW
  rules:
    - from: [ { source: { principals: ["cluster.local/ns/checkout/sa/checkout"] } } ]
      to: [ { operation: { methods: ["POST"], paths: ["/charges"] } } ]
~~~`,
  pts: [r`Never trust the network; authenticate every call.`, r`Workload identities instead of shared secrets.`, r`mTLS with automatic rotation, often via a mesh.`, r`Service-level authorisation plus propagated user context.`, r`Least-privilege data access, vaults, network policies and audit.`],
  ex: r`Mesh authorisation policies blocked a compromised internal tool from calling the payments service directly during a penetration test.`,
  fu: [r`What is token exchange (on-behalf-of)?`],
  pit: [r`Shared API keys between all internal services.`] },

{ id: 'q36', level: 'Senior', tags: ['performance', 'tail-latency'],
  q: r`Why does tail latency dominate in distributed systems, and how do you reduce it?`,
  a: r`When a request fans out to many services or shards, its latency is the **maximum** of their latencies. If each call has a 1% chance of being slow (p99), a request calling 100 services has a 63% chance of hitting at least one slow call (1 - 0.99^100). Tail latency of components becomes median latency of the system.

Sources: GC pauses, queueing, noisy neighbours, cold caches, retries, network jitter, lock contention.

Techniques:

- **Hedged requests**: send a second request after the p95 delay to another replica; use the first response (idempotent reads only).
- **Tied requests**: send to two replicas, cancel the other when one starts processing.
- **Reduce fan-out**: aggregate data, cache, fewer hops.
- **Micro-partitioning and load balancing** away from slow nodes (P2C, outlier ejection).
- **Timeouts with fallbacks** for optional components.
- **Reduce variance at the source**: GC tuning, avoiding synchronous I/O, right-sized pools.
- Measure p99/p99.9, not averages.`,
  code: r`~~~csharp
// Hedging for idempotent reads (Microsoft.Extensions.Http.Resilience)
builder.Services.AddHttpClient<ICatalogClient, CatalogClient>()
    .AddStandardHedgingHandler(o =>
    {
        o.Hedging.MaxHedgedAttempts = 1;
        o.Hedging.Delay = TimeSpan.FromMilliseconds(80);        // ~p95 of the catalog service
    });
// Fan-out maths: P(at least one slow) = 1 - 0.99^N -> N=10: 9.6%, N=100: 63%
~~~`,
  pts: [r`Fan-out makes component tails the system's typical latency.`, r`1 - 0.99^N: 100 calls -> 63% chance of a slow one.`, r`Hedged or tied requests cut tails for idempotent reads.`, r`Reduce fan-out; eject slow nodes; timeouts with fallbacks.`, r`Measure p99 and p99.9, not averages.`],
  ex: r`Hedging catalogue reads after 80 ms cut a product page's p99 from 900 ms to 220 ms with 4% extra load.`,
  fu: [r`Why must hedging be limited to idempotent operations?`],
  pit: [r`Tuning averages while users suffer p99s.`] },

{ id: 'q37', level: 'Principal', tags: ['architecture-decision'],
  q: r`How do you decide whether a problem needs a distributed solution at all?`,
  a: r`Distribution adds partial failures, consistency trade-offs, operational complexity and cost. Before distributing, ask:

- **Does one machine suffice?** Modern servers (100+ cores, TBs of RAM, NVMe) handle enormous workloads; a single well-tuned database often serves tens of thousands of transactions per second.
- **What drives distribution?** Availability (needs redundancy, but replication is not the same as distributed processing), scale beyond one node, geographic latency, team autonomy, fault isolation, regulatory separation.
- **Can managed services absorb the distribution** (managed databases with replicas, serverless queues) so your code stays simple?
- **What is the cost of a coordination failure?** Money, safety, compliance.

Prefer: a modular monolith on a replicated database, queues for async work, and caches, then distribute specific components when a measured force requires it. Document the trigger in an ADR.`,
  code: r`~~~text
Decision record: fraud feature computation
Requirement: 3,000 TPS, features over 24 h windows, p99 < 10 ms reads
Option A: single PostgreSQL + Redis, features computed in-process per event      -> fits on 1 primary + replicas (load test 9,000 TPS)
Option B: Kafka + Flink + Aerospike cluster                                     -> 4 new technologies, 2 FTE to operate
Decision: A now; trigger for B: sustained > 8,000 TPS or features needing multi-day state beyond Redis memory budget
~~~`,
  pts: [r`Distribution adds partial failure, consistency issues and cost.`, r`One large machine often suffices.`, r`Name the force: availability, scale, latency, isolation, autonomy.`, r`Let managed services carry distribution where possible.`, r`Distribute specific components on measured triggers.`],
  ex: r`A team avoided a planned Kafka/Flink platform after load-testing a single PostgreSQL instance at three times forecast volume.`,
  fu: [r`What signals tell you a single node is no longer enough?`],
  pit: [r`Distributing for résumé-driven reasons.`] },

{ id: 'q38', level: 'Principal', tags: ['incident', 'metastable'],
  q: r`Explain metastable failures and how you recover a system stuck in one.`,
  a: r`A **metastable failure** is a state where the system stays overloaded even after the original trigger disappears, because of a **sustaining feedback loop**:

- Retries: timeouts cause retries, which add load, which causes more timeouts.
- Cache loss: a cold cache sends load to the database, slowing everything, so caches never warm.
- Queue backlog: consumers process stale work whose clients already gave up, wasting capacity.
- Connection storms: reconnecting clients overload authentication.

Recovery requires **breaking the loop**, not just removing the trigger:

- Shed load aggressively (rate limits, reject non-critical traffic, waiting rooms).
- Disable retries or increase backoff via config/feature flags.
- Drop stale queued work (deadlines on messages).
- Warm caches gradually; restore traffic in steps.
- Scale out only if the loop is broken, otherwise new capacity is consumed by amplification.

Prevention: retry budgets, deadlines on work, load shedding by priority, admission control, and testing overload behaviour.`,
  code: r`~~~csharp
// Drop work whose deadline has passed: do not spend capacity on requests nobody is waiting for
public async Task HandleAsync(ConsumeContext<PriceRequest> ctx)
{
    if (ctx.Message.Deadline < DateTimeOffset.UtcNow) { metrics.ExpiredDropped.Add(1); return; }
    await pricing.ComputeAsync(ctx.Message, ctx.CancellationToken);
}
// Emergency switch (feature flag) to stop client-side retries during recovery
if (await flags.IsEnabledAsync("disable-retries")) pipeline = ResiliencePipeline.Empty;
~~~`,
  pts: [r`Metastable: overload persists after the trigger is gone.`, r`Sustaining loops: retries, cold caches, stale backlogs, reconnect storms.`, r`Recover by breaking the loop: shed load, stop retries, drop stale work.`, r`Restore traffic gradually; scaling alone may not help.`, r`Prevent with retry budgets, deadlines and admission control.`],
  ex: r`After a 2-minute database blip, a system stayed down for an hour due to retry amplification; disabling retries via a flag recovered it in 5 minutes.`,
  fu: [r`How would you test for metastable behaviour?`],
  pit: [r`Adding capacity while retry amplification continues.`] },

{ id: 'q39', level: 'Principal', tags: ['governance', 'standards'],
  q: r`What distributed-systems standards would you set for 30 teams building services?`,
  a: r`Standards that prevent the most common incidents, shipped as defaults:

- **Timeouts and resilience**: every outbound call through a shared client package with timeouts, retries with jitter at one layer, circuit breakers and bulkheads.
- **Idempotency**: required for all commands and consumers (idempotency keys, inbox).
- **Messaging**: outbox for publishing; versioned event schemas in a registry with compatibility checks; DLQs with alerting and replay tooling.
- **Observability**: OpenTelemetry tracing across HTTP and messaging, RED metrics, SLOs per service.
- **Consistency**: documented consistency per data type; no shared databases between services.
- **Time**: UTC, monotonic clocks for durations, no cross-service ordering by wall clock.
- **Security**: workload identity, mTLS, least privilege.
- **Operations**: health checks, graceful shutdown, runbooks, game days.

Enforce with templates, linters, contract tests and architecture reviews for new services, measured by incident categories.`,
  code: r`~~~xml
<!-- Every service references the platform package that wires resilience, telemetry and idempotency defaults -->
<PackageReference Include="Company.Platform.ServiceDefaults" Version="5.4.0" />
~~~
~~~csharp
var builder = WebApplication.CreateBuilder(args);
builder.AddCompanyServiceDefaults();     // OTel, health checks, resilience handlers, outbox, inbox, problem details, mTLS config
~~~`,
  pts: [r`Shared resilience defaults for all outbound calls.`, r`Mandatory idempotency, outbox and versioned schemas.`, r`End-to-end tracing and SLOs.`, r`Documented consistency; no shared databases.`, r`Ship standards as defaults and measure incident categories.`],
  ex: r`A service-defaults package (similar to .NET Aspire's) eliminated "missing timeout" incidents across 30 services within two quarters.`,
  fu: [r`How do you roll out a breaking change to the shared package?`],
  pit: [r`Standards documents without automation.`] },

{ id: 'q40', level: 'Principal', tags: ['interview-scenario', 'design'],
  q: r`Design a globally distributed rate limiter for an API used across 5 regions with a single global quota per customer.`,
  a: r`### Trade-off
Exact global limits require coordination on every request (cross-region latency). Most businesses accept slight overshoot for low latency.

### Design
- **Local enforcement** in each region with a **local budget** (a share of the global quota) using token buckets in a regional Redis.
- **Periodic synchronisation**: every few seconds, regions report consumption to a coordinator (or a global datastore) and receive updated shares based on recent demand (regions with more traffic get more tokens).
- **Bounded overshoot**: worst case = sum of unsynchronised local spending within one sync interval; tune interval and shares.
- **Strict mode** for high-value quotas: route the customer's requests to a home region, or use a strongly consistent global store with higher latency.
- **Failure**: if sync fails, regions keep enforcing their last shares (fail safe), not unlimited.
- **Observability**: global usage dashboards, overshoot metrics.`,
  code: r`~~~csharp
// Each region periodically rebalances its share of a customer's global quota by recent demand
public sealed class QuotaSync(IGlobalQuotaStore global, IRegionalBuckets buckets, string region) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        while (await timer.WaitForNextTickAsync(ct))
        {
            var usage = buckets.DrainUsageCounters();                                  // per customer, last 5 s
            var shares = await global.ReportAndGetSharesAsync(region, usage, ct);      // coordinator splits quota by demand
            foreach (var (customer, perSecond) in shares) buckets.SetRate(customer, perSecond);
        }
    }
}
// Worst-case overshoot per customer ~= sum over regions of (local burst + rate x 5 s drift)
~~~`,
  dia: r`flowchart LR
  subgraph R1[Region 1]
    G1[Gateway] --> B1[(Regional token buckets)]
  end
  subgraph R2[Region 2]
    G2[Gateway] --> B2[(Regional token buckets)]
  end
  subgraph R3[Region 3]
    G3[Gateway] --> B3[(Regional token buckets)]
  end
  B1 & B2 & B3 -->|usage every 5s| CO[Global quota coordinator]
  CO -->|new shares by demand| B1 & B2 & B3`,
  pts: [r`Exact global limits cost a cross-region round trip per request.`, r`Enforce locally with shares of the global quota.`, r`Sync usage periodically and rebalance shares by demand.`, r`Bound and monitor overshoot; strict mode via home region.`, r`On sync failure keep last shares, never unlimited.`],
  ex: r`A global API enforced partner quotas with 5-second share rebalancing; measured overshoot stayed under 2% while adding no request latency.`,
  fu: [r`How do you handle a customer that switches regions suddenly?`],
  pit: [r`A synchronous call to one central region on every request.`] },

{ id: 'q41', level: 'Principal', tags: ['interview-scenario', 'payments'],
  q: r`A payment provider call times out. Walk through how your distributed design guarantees the customer is charged exactly once.`,
  a: r`1. **Before calling**: the payment intent is persisted with a unique idempotency key and state {{AUTHORISING}} (so a crash leaves evidence).
2. **Call the provider with the same idempotency key** (Stripe/Adyen deduplicate on it).
3. **Timeout**: the outcome is **unknown**. Do not mark failed, do not retry on another provider. Set state {{UNKNOWN}}.
4. **Resolve**: retry the same call with the same key (safe because of provider idempotency) or query the provider's status by reference; webhooks may also arrive (deduplicated by event id).
5. **Customer experience**: show "processing"; do not let the user pay again for the same order (the order is locked to this payment intent).
6. **Backstop**: nightly reconciliation against the provider settlement report catches anything still unresolved (charged but recorded as failed, or vice versa) and triggers refunds or fulfilment.
7. **Downstream**: the PaymentCaptured event goes through the outbox; consumers are idempotent.`,
  code: r`~~~csharp
public async Task<PaymentState> AuthoriseAsync(Guid intentId, CancellationToken ct)
{
    var intent = await repo.GetAsync(intentId, ct);
    intent.MarkAuthorising(); await repo.SaveAsync(intent, ct);                        // evidence before the remote call
    try
    {
        var res = await psp.AuthoriseAsync(intent.ToRequest(), idempotencyKey: intent.Id.ToString(), ct).WaitAsync(TimeSpan.FromSeconds(8), ct);
        intent.Apply(res);
    }
    catch (TimeoutException) { intent.MarkUnknown(); await statusPoller.ScheduleAsync(intent.Id, TimeSpan.FromSeconds(30), ct); }
    await repo.SaveWithOutboxAsync(intent, ct);
    return intent.State;
}
~~~`,
  dia: r`sequenceDiagram
  participant C as Checkout
  participant P as Payment service
  participant DB as Payments DB
  participant X as Provider
  C->>P: authorise intent 42
  P->>DB: state AUTHORISING (key 42)
  P->>X: authorise (Idempotency-Key 42)
  X--xP: timeout
  P->>DB: state UNKNOWN
  P-->>C: processing
  P->>X: GET status / retry with key 42
  X-->>P: authorised (no duplicate charge)
  P->>DB: state AUTHORISED + outbox event`,
  pts: [r`Persist the intent and key before the remote call.`, r`Use the same idempotency key with the provider on every retry.`, r`A timeout is UNKNOWN, never failed; no failover to another provider.`, r`Resolve via status query, retries with the same key, or webhooks.`, r`Nightly reconciliation is the final backstop.`],
  ex: r`This flow resolved 99.97% of timeouts automatically within minutes; the rest were fixed by reconciliation with zero double charges.`,
  fu: [r`What if the provider does not support idempotency keys?`],
  pit: [r`Marking the payment failed and letting the customer pay again.`] },

{ id: 'q42', level: 'Principal', tags: ['data-ownership', 'boundaries'],
  q: r`How do you define data ownership and contracts between services to avoid a distributed monolith?`,
  a: r`Symptoms of a distributed monolith: services must deploy together, share databases, make chains of synchronous calls for every request, and break each other with schema changes.

Principles:

- **Single owner per data entity**; only the owner writes it; others get data through **published contracts** (APIs, events) or replicated read models.
- **Boundaries by business capability** (bounded contexts), not by entity or technical layer.
- **Asynchronous integration** for most cross-service flows; synchronous calls only where the caller truly needs an immediate answer.
- **Versioned contracts** with backward compatibility and consumer-driven tests.
- **Autonomy test**: can each service be deployed, scaled and fail independently? Can a team change its schema without coordinating?
- **Reference data** replicated with clear ownership and update events.`,
  code: r`~~~yaml
# Contract registry entry: owner, schema, compatibility, consumers (checked in CI)
event: payments.payment-captured
version: 3
owner: team-payments
compatibility: BACKWARD_TRANSITIVE
schema: schemas/payments/payment-captured-v3.avsc
consumers: [orders, ledger, notifications, analytics]
breaking-change-policy: new major topic + 90-day dual publishing
~~~`,
  pts: [r`One owner per data entity; others use contracts or replicas.`, r`Boundaries by business capability.`, r`Prefer asynchronous integration.`, r`Versioned, compatibility-checked contracts.`, r`Test autonomy: deploy, scale and fail independently.`],
  ex: r`Replacing four services' direct reads of the orders database with an OrderPlaced event stream let the orders team change its schema without a cross-team release.`,
  fu: [r`How do you migrate consumers off a shared database?`],
  pit: [r`Entity services (CustomerService, ProductService) that every flow calls synchronously.`] },

{ id: 'q43', level: 'Principal', tags: ['dr', 'resilience'],
  q: r`How do you define and validate RPO and RTO for a distributed financial system, including regulators' expectations?`,
  a: r`- **Business impact first**: identify important business services (payments, trading, customer access) and set **impact tolerances** (maximum tolerable disruption) with the business, per regulations such as DORA and UK operational resilience rules.
- **Map dependencies**: each service's data stores, third parties, networks and people; RPO/RTO per component must support the service-level tolerance.
- **Design**: synchronous replication where RPO 0 is required (ledger), async for less critical data; automated failover where RTO is minutes; runbooks for manual steps.
- **Validate**: regular failover tests (game days, region evacuations), backup restore tests, measuring actual RPO (data lost) and RTO (time to recover), including third-party dependencies.
- **Evidence**: test reports, issues found and remediated, board-level reporting.
- **Severe but plausible scenarios**: cloud region loss, cyberattack (ransomware: immutable backups), third-party failure.`,
  code: r`~~~text
Important business service: Faster Payments outbound
Impact tolerance: max 2 h disruption, 0 lost payments
Components:      Payments API (RTO 15 min), Ledger DB (RPO 0 sync standby, RTO 10 min), Scheme gateway (vendor, RTO 1 h)
Last test (2026-09-14): region failover RTO 22 min (target 15) -> action: pre-scale DR compute; RPO 0 verified
Ransomware scenario: immutable backups restored to isolated account in 3 h 10 min (target 4 h) -> pass
~~~`,
  pts: [r`Start from important business services and impact tolerances.`, r`Map all dependencies including third parties.`, r`Choose replication and failover per component to meet tolerances.`, r`Test regularly and measure actual RPO/RTO.`, r`Keep evidence and cover severe but plausible scenarios.`],
  ex: r`A failover test revealed DR compute took 20 minutes to scale; pre-provisioning brought RTO within tolerance before the regulator's review.`,
  fu: [r`What is a severe but plausible scenario?`],
  pit: [r`RPO/RTO targets that were never tested end to end.`] },

{ id: 'q44', level: 'Principal', tags: ['evaluation', 'claims'],
  q: r`A vendor claims their database is "strongly consistent, highly available and partition tolerant". How do you evaluate the claim?`,
  a: r`- **Ask precise questions**: which consistency model (linearizable per key? serializable transactions? across regions?), under which failure scenarios, with which configuration and latency costs.
- **CAP reality check**: during a partition, a system must reject some operations (CP) or return possibly stale data (AP). "All three" usually means high availability under common failures, not during partitions, or different guarantees per operation.
- **Read the documentation and papers**: replication protocol (Raft/Paxos?), commit rules, read paths (follower reads?), clock assumptions.
- **Independent evidence**: Jepsen analyses, published postmortems, customer references at your scale.
- **Test it yourself**: partition and clock-skew tests in a staging cluster with a linearizability checker; failover drills measuring data loss.
- **Contract**: SLAs, data-loss commitments, support response.`,
  code: r`~~~text
Evaluation checklist for "strong + HA + PT"
[ ] Consistency model named precisely (linearizable single-key? strict serializable multi-key?)
[ ] Behaviour during minority partition: reads? writes? stale reads possible?
[ ] Clock assumptions (bounded skew? NTP? TrueTime-like?)
[ ] Default vs tuned settings (are defaults weaker than the marketing claim?)
[ ] Jepsen report or equivalent independent test, issues fixed?
[ ] Our own test: partition the leader's AZ during load, run a linearizability checker (e.g. Knossos/Porcupine)
~~~`,
  pts: [r`Ask for the precise consistency model and failure scenarios.`, r`CAP means trade-offs during partitions.`, r`Read protocol details and clock assumptions.`, r`Look for independent analyses like Jepsen.`, r`Run your own partition and failover tests.`],
  ex: r`A database marketed as strongly consistent defaulted to follower reads; enabling leader reads cost 30% throughput, which changed the business case.`,
  fu: [r`What does a linearizability checker do?`],
  pit: [r`Accepting marketing claims without failure testing.`] },

{ id: 'q45', level: 'Principal', tags: ['organisation', 'operations'],
  q: r`How do you organise on-call and incident response for a large distributed system?`,
  a: r`- **Ownership**: each service has an owning team with on-call; a platform team owns shared infrastructure; clear escalation paths.
- **SLO-based alerting**: page on user-impacting symptoms (burn rates), not raw resource metrics; reduce noise.
- **Incident roles**: incident commander, communications lead, operations/scribe; severity levels with response expectations.
- **Tooling**: dashboards per user journey, distributed tracing, runbooks linked from alerts, feature flags and rollback buttons, status pages.
- **Cross-team incidents**: shared incident channels, a dependency map to find the failing component quickly.
- **Postmortems**: blameless, with contributing factors and owned actions; track action completion; share learnings across teams.
- **Sustainability**: limits on pages per shift, follow-the-sun where possible, compensating time off, reliability work prioritised by error budget policy.`,
  code: r`~~~text
Error budget policy (excerpt)
SLO: checkout availability 99.95% / 30 days (budget ~21.6 min)
If budget burned > 50% in a week: freeze risky releases for checkout, prioritise reliability backlog
If budget exhausted: only fixes and reliability work until budget recovers; director sign-off for exceptions
Pages per on-call shift > 2 for 2 weeks: alert review mandatory
~~~`,
  pts: [r`Clear service ownership with on-call and escalation.`, r`Page on SLO burn, not resource noise.`, r`Defined incident roles and severities.`, r`Runbooks, tracing, flags and rollback at hand.`, r`Blameless postmortems with tracked actions; sustainable rotations.`],
  ex: r`An error-budget policy shifted a team from feature work to reliability for two sprints, halving incidents in the following quarter.`,
  fu: [r`How do you prevent alert fatigue?`],
  pit: [r`Central operations teams paging for services they do not own.`] },

{ id: 'q46', level: 'Principal', tags: ['cost', 'trade-offs'],
  q: r`How do you reason about the cost of consistency and availability in distributed designs?`,
  a: r`Every "nine" and every consistency upgrade has a price:

- **Availability**: multi-AZ roughly doubles database cost (standby); multi-region adds compute, data transfer and operational complexity; active-active adds conflict handling engineering.
- **Consistency**: synchronous replication increases write latency (affecting throughput and user experience); consensus stores need 3 to 5 nodes; strong consistency in global databases costs more request units/latency.
- **Durability**: more replicas and backups, longer retention.
- **Engineering cost**: reconciliation, idempotency, testing, on-call skills.

Approach: tier services by business criticality (tier 0: payments/ledger; tier 2: recommendations) with different SLOs and architectures; quantify downtime cost per hour vs infrastructure cost; choose consistency per data type. Present the trade-off as an investment decision: "+$X/month buys RTO from 2 h to 15 min for a service losing $Y/hour when down."`,
  code: r`~~~text
Tiering example
Tier 0 (ledger, payments):   99.99%, RPO 0, RTO 15 min, multi-AZ sync + warm DR region   cost index 3.0x
Tier 1 (orders, accounts):   99.95%, RPO 1 min, RTO 1 h, multi-AZ + backups cross-region   cost index 1.8x
Tier 2 (recommendations):    99.9%,  RPO 24 h, RTO 4 h, single AZ + daily backup            cost index 1.0x
Downtime cost: tier 0 ~$250k/h, tier 2 ~$2k/h -> invest accordingly
~~~`,
  pts: [r`Every nine and consistency upgrade has infrastructure and engineering cost.`, r`Tier services by criticality with different architectures.`, r`Quantify downtime cost against infrastructure cost.`, r`Choose consistency per data type.`, r`Present resilience as an investment decision.`],
  ex: r`Tiering let a company drop multi-region for internal tools and fund a warm DR region for payments within the same budget.`,
  fu: [r`How do you get business owners to agree on tiers?`],
  pit: [r`One availability target for everything.`] },

{ id: 'q47', level: 'Principal', tags: ['migration', 'consistency'],
  q: r`How do you migrate a live system from a single database to partitioned/distributed storage without downtime or data loss?`,
  a: r`1. **Prepare the application**: introduce a data-access abstraction routing by partition key; ensure every query includes the key (or define scatter-gather paths).
2. **Choose the key and layout** with load analysis; create virtual partitions mapped to physical shards.
3. **Replicate**: copy existing data to the new layout with a backfill, and keep it in sync with CDC from the old database.
4. **Verify**: row counts and checksums per partition; shadow reads comparing old and new results.
5. **Cut over reads** gradually (by tenant or percentage) behind feature flags.
6. **Cut over writes**: a short write freeze per partition (or dual-write with reconciliation, carefully), switch the routing to the new store, then stop CDC.
7. **Rollback plan**: reverse replication until confidence is high.
8. **Clean up** the old schema after a stabilisation period.

Migrate tenant by tenant to limit blast radius.`,
  code: r`~~~csharp
// Routing with per-tenant cutover flags: old store until the tenant is migrated
public sealed class TenantRouter(IOldStore oldStore, IShardedStore newStore, IMigrationState migration) : IOrderStore
{
    public async Task<Order?> GetAsync(TenantId t, OrderId id, CancellationToken ct) =>
        await migration.IsReadMigratedAsync(t, ct) ? await newStore.GetAsync(t, id, ct) : await oldStore.GetAsync(t, id, ct);
    public async Task SaveAsync(TenantId t, Order o, CancellationToken ct)
    {
        if (await migration.IsWriteMigratedAsync(t, ct)) await newStore.SaveAsync(t, o, ct);
        else await oldStore.SaveAsync(t, o, ct);      // CDC copies to the new store until cutover
    }
}
~~~`,
  pts: [r`Route through an abstraction; include the partition key everywhere.`, r`Backfill plus CDC keeps the new layout in sync.`, r`Verify with checksums and shadow reads.`, r`Cut over reads, then writes, per tenant with flags.`, r`Keep reverse replication for rollback; clean up later.`],
  ex: r`A SaaS company moved 3,000 tenants to a sharded cluster over six weeks with per-tenant cutovers of under a minute each.`,
  fu: [r`How do you handle cross-tenant queries during migration?`],
  pit: [r`Big-bang migration of all data in one maintenance window.`] },

{ id: 'q48', level: 'Principal', tags: ['mentoring'],
  q: r`How do you build distributed-systems competence in a team that mostly built monoliths?`,
  a: r`- **Mental models first**: fallacies, partial failure, idempotency, consistency per data type, time and ordering; short sessions with real incidents.
- **Paved road**: provide resilient defaults (client packages, outbox/inbox libraries, tracing) so correctness does not depend on everyone mastering details from day one.
- **Design reviews** with a checklist (timeouts, retries, idempotency, ordering, failure modes, reconciliation).
- **Hands-on labs**: break things in staging (chaos experiments) and watch traces; failover drills.
- **Reading group**: Designing Data-Intensive Applications chapters, Jepsen reports, postmortems from your industry.
- **Pair seniors with teams** on the first distributed features.
- **Celebrate simplicity**: not every feature needs a new service or Kafka topic.`,
  code: r`~~~text
Design review checklist (distributed features)
[ ] What happens if each remote call times out? (unknown outcome handling)
[ ] Are all commands and consumers idempotent? How?
[ ] How are messages published (outbox?) and ordered (key?)
[ ] What consistency does each data item need? Who owns it?
[ ] Which failures have no detector? What reconciles them?
[ ] Timeouts, retries (one layer), breakers, bulkheads configured?
[ ] Traces across every hop? SLOs and alerts?
~~~`,
  pts: [r`Teach mental models with real incidents.`, r`Provide resilient defaults so teams start safe.`, r`Review designs with a distributed-systems checklist.`, r`Hands-on chaos labs and failover drills.`, r`Reading groups and pairing; value simplicity.`],
  ex: r`Chaos labs where engineers watched traces during injected failures changed how a team designed retries more than any guideline document.`,
  fu: [r`How do you measure the team's improvement?`],
  pit: [r`Expecting every engineer to implement outbox and idempotency from scratch.`] },

{ id: 'q49', level: 'Principal', tags: ['code-review'],
  q: r`Code review: find the distributed-systems bugs in this order handler.`,
  a: r`~~~csharp
public async Task<IActionResult> PlaceOrder(OrderDto dto)
{
    var order = new Order(dto);
    await _db.Orders.AddAsync(order);
    await _db.SaveChangesAsync();
    await _bus.PublishAsync(new OrderPlaced(order.Id));            // after commit
    var paid = await _http.PostAsJsonAsync("http://payments/charge", new { order.Id, order.Total });
    if (!paid.IsSuccessStatusCode) { order.Status = "FAILED"; await _db.SaveChangesAsync(); return BadRequest(); }
    _cache.Remove("orders:" + dto.CustomerId);
    return Ok(order);
}
~~~

1. **Dual write**: commit then publish; a crash between them loses the event. Use an outbox.
2. **No idempotency**: client retries create duplicate orders; the payments call has no idempotency key, so retries can double charge.
3. **Timeout = failure**: a timeout or 5xx after the charge succeeded marks the order FAILED while money was taken; outcome may be unknown.
4. **No timeout/cancellation** on the HTTP call; no resilience policy; hard-coded URL.
5. **Synchronous chain** in the request: checkout availability depends on payments; consider an orchestrated saga with 202 Accepted.
6. **Event published before payment** outcome: consumers may ship an unpaid order.
7. **Cache invalidation after** other operations; if anything throws earlier, the cache is stale (and order matters relative to commit).
8. Returning the entity directly (over-exposure), {{"FAILED"}} magic strings.`,
  code: r`~~~csharp
public async Task<IResult> PlaceOrder([FromHeader(Name = "Idempotency-Key")] string key, OrderDto dto, CancellationToken ct)
{
    if (await _db.Orders.SingleOrDefaultAsync(o => o.IdempotencyKey == key, ct) is { } existing) return Results.Ok(existing.ToResponse());
    var order = Order.Place(dto, key);                                        // status: PendingPayment
    _db.Orders.Add(order);
    _db.Outbox.Add(OutboxMessage.From(new OrderPendingPayment(order.Id, order.Total)));   // saga starts asynchronously
    await _db.SaveChangesAsync(ct);                                           // unique IdempotencyKey index
    return Results.Accepted("/orders/" + order.Id, order.ToResponse());
}
// Payment saga step uses Idempotency-Key = order.Id with the PSP; timeouts -> Unknown -> status query; OrderPaid published via outbox
~~~`,
  pts: [r`Dual write between commit and publish.`, r`No idempotency for orders or payment calls.`, r`Timeouts treated as failures despite possible charges.`, r`Synchronous chain and premature event publication.`, r`Fix with idempotency keys, outbox, saga and 202 Accepted.`],
  ex: r`A handler like this produced double charges and ghost orders during a payments slowdown; the saga-based redesign removed both.`,
  fu: [r`How would you migrate existing clients to 202 Accepted semantics?`],
  pit: [r`Fixing only the missing timeout.`] },

{ id: 'q50', level: 'Principal', tags: ['summary'],
  q: r`Summarise the distributed-systems principles you apply as a Principal Engineer.`,
  a: r`"I assume the network lies and design for it:

- Every remote call has a deadline; a timeout is an unknown outcome, resolved by idempotent retries, status queries and reconciliation.
- Exactly-once effects come from at-least-once delivery plus idempotency; events leave via an outbox; consumers keep an inbox.
- I choose consistency per data type: coordination for money and uniqueness, eventual consistency with explicit staleness for everything else.
- I avoid wall-clock ordering; I use versions, sequences, leases with fencing tokens.
- I contain failures with timeouts, bulkheads, breakers, load shedding and cells, and I test them with chaos and game days.
- I keep things undistributed until a measured force requires otherwise, and I make the safe patterns the default for every team."`,
  code: r`~~~csharp
// The principles, compressed into one remote call
var result = await pipeline.ExecuteAsync(async ct =>                         // deadline + retries with jitter + breaker
    await ledger.PostAsync(journal, idempotencyKey: journal.Id.ToString(), ct), requestAborted);
if (result is PostResult.Unknown) await reconciler.EnqueueAsync(journal.Id);   // unknown outcomes get resolved, not guessed
~~~`,
  pts: [r`Deadlines everywhere; timeouts are unknown outcomes.`, r`At-least-once + idempotency; outbox and inbox.`, r`Consistency chosen per data type.`, r`Versions, sequences and fencing instead of wall clocks.`, r`Contain and test failures; distribute only when needed.`],
  ex: r`Teams that adopted these defaults saw distributed-systems incidents shift from data corruption to brief, self-healing degradations.`,
  fu: [r`Which principle is hardest to retrofit?`],
  pit: [r`Listing technologies instead of principles.`] }
],
cheat: r`### Core truths
Network is unreliable · timeout = unknown outcome · partial failure is normal · clocks lie · exactly-once effects = at-least-once + idempotency · some failures have no detector -> reconcile.

### Consistency
| Model | Use |
|---|---|
| Linearizable | Balances, uniqueness, locks (with fencing) |
| Causal / session | User sees own writes, ordered conversations |
| Eventual | Feeds, catalogues, analytics (state a staleness budget) |
CAP: during partitions choose refuse (CP) or accept-and-fix (AP) per data type. PACELC: otherwise latency vs consistency.

### Mechanisms
Replication (single-leader / multi-leader / leaderless N,R,W) · partitioning (hash/range/directory + virtual partitions) · consensus (Raft: majority votes + majority commit, 2f+1) · failure detection (heartbeats, phi accrual, SWIM gossip) · leases + fencing tokens · outbox/CDC · inbox · sagas with compensations · CRDTs for mergeable data · vector/Lamport/HLC clocks.

### Resilience
Deadlines propagated · retries at one layer, jitter, budgets · circuit breakers · bulkheads · load shedding · backpressure (bounded queues, 429/503) · hedging for tails (1 - 0.99^N) · cells · chaos tests and game days · beware metastable loops.

### Say this
"A timeout is an unknown outcome." "Consistency per data type." "Exactly-once is at-least-once plus idempotency." "Fence stale leaders." "Reconciliation catches what no detector sees."`
});
})(String.raw);
