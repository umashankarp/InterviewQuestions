# Distributed Systems — Cram Sheet

> Tier 1 · Source: `16-Distributed-Systems/` (6 modules, 3,497 lines) · Read: 15 min

---

## 1. Consensus & Raft

- **Consensus problem:** N nodes agree on one value despite crashes and message loss. Requires **safety** (never two different decisions) + **liveness** (eventually decides). **FLP impossibility:** no deterministic algorithm guarantees both in a fully asynchronous network — real systems use timeouts to sidestep it.
- **Raft** (chosen over Paxos for understandability) — three roles: **leader · follower · candidate**.
  - **Leader election:** randomised election timeout → candidate increments `term`, requests votes → majority wins. Randomisation is what prevents perpetual split votes.
  - **Log replication:** all writes go to the leader → appended → replicated → **committed once a majority has it** → applied to the state machine.
  - **Terms** are logical clocks; a node seeing a higher term immediately steps down.
  - Needs **2f+1 nodes to tolerate f failures** (3 nodes → 1 failure; 5 → 2).
- Where it runs in real life: etcd, Consul, ZooKeeper (ZAB), Kafka KRaft, CockroachDB.

---

## 2. Quorums

- `N` replicas, `W` write quorum, `R` read quorum. **`W + R > N` ⇒ read and write sets overlap ⇒ you read the latest write.**
- Standard: `N=3, W=2, R=2`. `W=N, R=1` = fast reads, slow/fragile writes. `W=1, R=1` = fast, eventually consistent.
- **Sloppy quorum + hinted handoff** (Dynamo) — accept writes on *any* N healthy nodes during a partition, hand off later. Buys availability, weakens the overlap guarantee.
- **Read repair** and **anti-entropy (Merkle trees)** converge replicas in the background.

---

## 3. 2PC vs Saga

| | 2PC | Saga |
|---|---|---|
| Atomicity | true ACID across nodes | **no** — eventual, via compensation |
| Blocking | **yes** — coordinator failure leaves in-doubt locks held | non-blocking |
| Availability | product of all participants | per-service |
| Isolation | provided | **none** — intermediate states are visible |
| Use | single DB, XA within one trust boundary | microservices |

- **Why 2PC is avoided at scale:** it's a *blocking* protocol. If the coordinator dies between prepare and commit, participants hold locks indefinitely, and availability multiplies downward across every participant.
- **Saga:** a sequence of local transactions, each with a **compensating action**. Choreography (events, decentralised) or orchestration (a coordinator).
- **Saga's hard part is not the happy path — it's that compensation can also fail**, and that intermediate states are visible to users (no isolation). Mitigate with **semantic locks** (a `PENDING` status) and by ordering the *pivot* transaction (the irreversible one) as late as possible.

---

## 4. Logical Time

- Physical clocks drift and skew → **never order distributed events by wall-clock timestamp.**
- **Lamport clocks:** counter per node, `max(local, received)+1`. Gives `a → b ⇒ L(a) < L(b)`, but **not the converse** — cannot detect concurrency.
- **Vector clocks:** one counter per node. Compare element-wise: if neither dominates, the events are **concurrent** — that's a conflict you must resolve. Cost: size grows with node count.
- **Hybrid Logical Clocks (HLC)** — close to physical time and causally correct; what CockroachDB/YugabyteDB use.

---

## 5. Failure Detection & Idempotency

- **The fundamental ambiguity: you cannot distinguish a crashed node from a slow node or a partitioned network.** Every failure detector is a guess.
- **Timeout tuning is precision/recall:** short timeout = fast detection, more false positives (killing healthy nodes). Long = fewer false positives, slower recovery. **Phi-accrual** failure detectors output a *suspicion level* instead of a boolean.
- **Idempotency generalised:** the operation, not just the HTTP call. Key requirements — the key must be **client-supplied**, **stable across retries**, and **scoped to the effect** (not to the transport).
- **The dedup store must be transactionally co-located with the effect.** If the dedup record and the side effect commit separately, you have a dual-write problem again.
- **The dedup store needs a retention policy** — and beyond that boundary, a very late retry silently re-executes. Name that window.

---

## 6. Outbox & the Dual-Write Problem

- **Dual write** = writing to the database and publishing to a broker as two separate operations. Either can fail after the other succeeds → permanent inconsistency. **There is no retry that fixes this**, because you don't know which one landed.
- **Outbox:** insert the business row **and** an outbox row in **one local ACID transaction**. A relay (polling or CDC on the transaction log) reads the outbox and publishes, marking rows sent.
- Guarantees **at-least-once** delivery → **consumers must be idempotent**. Publishing can duplicate; the local transaction cannot.
- Trade-offs: added latency (polling interval), the outbox table grows (needs pruning), and the relay is a component to operate. CDC removes the polling cost but adds infrastructure.

---

## 7. CAP · PACELC · Split Brain

- **CAP's incompleteness:** it only describes behaviour *during a partition*. It says nothing about the 99.9% of the time there is no partition — which is where the real trade-off lives.
- **PACELC:** *if* **P**artition → **A** or **C**; **E**lse → **L**atency or **C**onsistency.
  - DynamoDB/Cassandra = **PA/EL**. HBase/MongoDB(default) = **PC/EC**. Spanner = **PC/EC** (pays latency with TrueTime).
- **Consistency spectrum (strong → weak):** linearizable → sequential → causal → read-your-writes → monotonic reads → monotonic writes → eventual.
- **"Eventually consistent" is a necessary but insufficient claim** — it says nothing about *how long*, or which anomalies are visible meanwhile. Always state the convergence bound and the session guarantees you provide.
- **Split brain:** two nodes both believe they're leader. A lease is **not** sufficient — the old leader may be GC-paused, not dead, and wakes up still holding a "valid" lease.
- **Fencing tokens are the mechanical defence:** a monotonically increasing number issued with the lock; **the storage layer rejects any write with a lower token**. Protection must live at the resource, not at the client.

---

## 8. CRDTs

- **Requirement:** merge must be **commutative, associative, idempotent** — a join-semilattice. Then replicas converge regardless of message order or duplication.
- **CvRDT (state-based)** ships the whole state and merges; **CmRDT (op-based)** ships operations, needs exactly-once causal delivery.
- **Catalogue:** G-Counter · PN-Counter · G-Set · 2P-Set · LWW-Register · OR-Set · RGA/sequence (collaborative text).
- **What CRDTs cannot do — the scope limit that matters:** they guarantee *convergence*, not *correct business semantics*. They cannot enforce a global invariant like "balance must never go negative," because no replica can see the global state. **So: never a CRDT for a ledger.**
- Alternatives: application-level conflict resolution (you write the merge rule) or **single-writer routing** (partition ownership so conflicts cannot occur) — often the simplest correct answer.
- **Tombstone growth** — deletes must be remembered forever to stay idempotent. Retention is a recurring problem at the metadata layer.

---

## 9. Storage Engines: B-Tree vs LSM

| | B-Tree | LSM-Tree |
|---|---|---|
| Writes | in-place, random I/O | **sequential** (memtable → SSTable) |
| Reads | direct, predictable | may check many levels |
| Best for | read-heavy, range scans | **write-heavy** |
| Used by | SQL Server, PostgreSQL, MySQL(InnoDB) | Cassandra, RocksDB, DynamoDB, LevelDB |

- **The amplification triangle — you cannot minimise all three:** **read amplification** (extra reads per lookup), **write amplification** (bytes written per byte of data), **space amplification** (disk used per byte of data). B-trees favour read; LSMs favour write; compaction strategy trades the rest.
- **Compaction:** *size-tiered* (fewer writes, worse read/space) vs *levelled* (better read/space, more write amplification). **Compaction debt** is a real production failure — writes outpace compaction, read amplification grows, latency collapses.
- **Bloom filter** — a probabilistic set: **no false negatives, tunable false positives**. It answers "definitely not here" so an LSM read can skip an SSTable entirely. This is what makes LSM reads tractable. Size ≈ 10 bits/key for ~1% FPR.

---

## 10. Tail Latency

- **Averages hide the experience that matters.** If a user request touches 100 services, they experience your p99, not your p50.
- **Tail-at-scale maths:** `P(slow) = 1 − (1−p)^n`. With p=1% and n=100, **63%** of requests hit at least one slow component.
- **Sources of tail latency:** GC pauses · queueing · shared resource contention · background compaction/maintenance · cold caches · retries · **power/thermal throttling** · head-of-line blocking.
- **Hedged requests** — send to a second replica after waiting `p95`, take the first response, cancel the other. **The timing nuance: hedge at p95, not immediately**, or you double your load for nothing.
- **Hedging is a controlled retry** and needs retry's discipline: a budget (cap hedges at ~5% of traffic), backpressure awareness, and cancellation.
- **Hedging is structurally safe for reads and structurally dangerous for writes** — a hedged write is a duplicate write unless it's idempotent.
- Other mitigations: **tied requests**, micro-partitioning, selective replication, and **"good enough" responses with a deadline**.

---

## Top traps

1. Claiming exactly-once delivery on the wire.
2. Ordering distributed events by wall-clock timestamp.
3. A lease without a **fencing token** to stop split brain.
4. 2PC across microservices.
5. Dual write (DB + broker) without an outbox.
6. "Eventually consistent" with no bound and no session guarantees.
7. A CRDT used where a global invariant must hold (a ledger).
8. Reasoning about availability from the mean, not the tail.
9. Hedging writes.
10. Quorum maths wrong — `W+R > N` is the whole rule.

---

## Interview Q&A — Lead / Principal

### Q1 · The message that was published but not saved *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"Downstream services occasionally process an order that doesn't exist in our database. How?"*

**Answer.** A **dual write**. The code saves to the database and publishes to the broker as two separate operations — and the publish succeeded while the transaction rolled back, or the save committed and the publish failed leaving the opposite inconsistency. The important point is that **no retry fixes this**, because when the process dies between the two you don't know which landed. It's not a bug in the retry logic; the design has no atomic boundary.

Fix is the **transactional outbox**: insert the business row and an outbox row in **one local ACID transaction**, then a relay polls the outbox — or reads the transaction log via CDC — and publishes, marking rows sent. The atomic part is now local, so it can't diverge, and you never need 2PC. That gives **at-least-once** delivery, so consumers must be idempotent — dedupe on the event id, with the dedupe record written in the same transaction as the effect. I'd also make sure the relay handles a poison message without blocking the whole stream, and that the outbox table is pruned, or it becomes the largest table in the system.

**Why it lands.** Names dual write as a *design* flaw rather than a retry bug, and follows through to consumer idempotency and the relay's own failure modes.
**✗ Weak answer.** "Add retries" or "use a distributed transaction."
**↳ Follow-ups.** Polling vs CDC — which and why? What ordering does the outbox guarantee?

---

### Q2 · Split brain in production *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"After a network blip, two instances both believed they were the leader and both wrote. How is that possible when we use a lock with a TTL?"*

**Answer.** Because a lease proves nothing at the moment of the write. The old leader wasn't dead — it was **GC-paused or partitioned** — and while it was frozen the lease expired and a new leader was elected. Then it woke up, still holding what it believes is a valid lease, and wrote. Every lock system has this property, because the lock service and the protected resource are different systems and the client's view of time is not authoritative.

The only real defence is a **fencing token**: a monotonically increasing number issued with the lease, carried on every write, and **checked by the storage layer, which rejects anything with a lower token**. Protection has to live at the resource. If the storage can't do that — many can't — then the operation itself must be idempotent or guarded by a conditional write, so a stale writer is harmless.

Detection matters too, because split brain is often discovered from the *data*, days later. I'd emit the current epoch on every write and alarm on any write carrying a stale epoch, so the system tells us rather than a reconciliation finding it.

**Why it lands.** Explains why a lease is insufficient, names fencing tokens at the *resource*, and adds a detector for a failure usually found late.
**✗ Weak answer.** "Shorten the TTL" — narrows the window, never closes it.
**↳ Follow-ups.** What if the datastore can't check a token? How does Raft avoid this internally?

---

### Q3 · Explaining eventual consistency to the business *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"The head of operations says 'I don't want eventual consistency, I want the data to be correct.' Respond."*

**Answer.** I'd start by agreeing with the goal and separating two things that sound identical. Eventual consistency isn't "sometimes wrong" — it's "correct, with a delay." The data converges; the question is only how long, and whether anyone can observe an intermediate state that matters to them. Framed that way it becomes a business decision with a number rather than an engineering preference.

Then I'd make it concrete per use case: the account balance shown after a transfer must be immediately correct, so that path is strongly consistent and we pay for it in latency and availability. The monthly statement dashboard can be ten seconds behind and nobody can tell. So we don't buy one consistency model, we buy it where it's needed, and **I'd ask them which specific screens have a cost if they're two seconds stale** — usually it's far fewer than "all of them."

And I'd be honest about the alternative: strong consistency everywhere means during a network partition we stop accepting writes. That's a real trade — in payments, refusing a transaction is sometimes correct and sometimes worse than a brief inconsistency, and that choice belongs to them, not to me. What I'd insist on is that **"eventually" gets a number** — a stated convergence bound we monitor and alert on — because an unbounded claim is the thing that's actually unacceptable.

**Why it lands.** Reframes without dismissing, converts it to a per-screen business question, states the real cost of the alternative, and insists on a bounded SLO.
**✗ Weak answer.** "CAP theorem means we have to" — technically-flavoured and answers nothing they asked.
**↳ Follow-ups.** What's your convergence SLO and how do you measure it? Which flows did you make strongly consistent?

---

### Q4 · Why is exactly-once impossible? *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"Our vendor claims exactly-once delivery. Do you believe them?"*

**Answer.** Not as stated on the wire. The sender cannot distinguish "the message was lost" from "the acknowledgement was lost", so it must either retry — risking a duplicate — or not retry, risking loss. There's no third option, and that's a property of the network, not of the implementation. What vendors usually mean is either dedupe within their own system over a bounded window, or an atomic consume-transform-produce cycle *inside* their boundary — Kafka's transactions are exactly this, and they cover a write back to Kafka, not a write to my database or an HTTP call to a payment provider.

So the correct framing is the identity: **exactly-once = at-least-once (retry) AND at-most-once (idempotency at the effect)**. The dedupe has to live where the side effect happens, with the dedupe record committed in the *same transaction* as the effect — if those two can diverge, you've just reintroduced the dual-write problem one layer down. And the dedupe store needs a retention window, beyond which a very late retry re-executes; I'd state that window explicitly rather than let it be discovered.

**Why it lands.** Explains the impossibility from the network property, scopes what vendors actually deliver, and gives the co-location rule plus the retention limit.
**✗ Weak answer.** "Yes, Kafka has exactly-once semantics."
**↳ Follow-ups.** Where exactly does the dedupe record live? What retention, and what happens past it?

---

### Quick-fire (30 seconds each)

- **"Why avoid 2PC in microservices?"** → It's blocking. The coordinator holds participants' locks between prepare and commit, so a coordinator failure leaves in-doubt transactions holding locks indefinitely, and your availability becomes the product of every participant's. Sagas give up atomicity and isolation in exchange for non-blocking, per-service availability — you compensate instead of rolling back, and you accept that intermediate states are visible.
- **"How does the outbox pattern work and what does it buy?"** → It removes the dual-write problem. You insert the business row and an outbox row in one local ACID transaction, so they can't diverge, then a relay polls or CDCs the outbox and publishes. That's at-least-once, so consumers must be idempotent — but the atomic part is now local, and you never need 2PC.
- **"Explain split brain and how you prevent it."** → Two nodes both believing they're leader, typically after a GC pause or partition rather than a crash. A lease isn't enough because the paused leader wakes up thinking it's still valid. The fix is a fencing token: a monotonically increasing number handed out with the lock, which the *storage layer* checks and rejects if it's lower. Protection has to live at the resource, not the client.

---

**Go deeper:** `16-Distributed-Systems/01`–`06` · **Related:** [[14-System-Design-Core]], [[17-Microservices]], [[34-CQRS-EventSourcing-Saga-Outbox]], [[34-CQRS-EventSourcing-Saga-Outbox]]
