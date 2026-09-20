# Redis — Cram Sheet

> Tier 2 · Source: `07-Redis/` (2 modules, 948 lines) · Read: 8 min

---

## 1. Data structures & complexity

| Type | Ops | Use |
|---|---|---|
| **String** | `GET/SET/INCR` O(1) | cache, counters, rate limits, locks |
| **Hash** | `HGET/HSET` O(1) | an object without re-serialising the whole thing |
| **List** | `LPUSH/RPOP` O(1), `LRANGE` O(n) | simple queue, recent-items |
| **Set** | `SADD/SISMEMBER` O(1), `SINTER` O(n) | unique membership, tags, dedupe |
| **Sorted Set (ZSET)** | `ZADD` O(log n), `ZRANGEBYSCORE` O(log n + m) | **leaderboards, rate limiting, delayed queues, time-ordered indexes** |
| **HyperLogLog** | `PFADD/PFCOUNT` O(1) | approximate unique counts, ~12 KB fixed, 0.81% error |
| **Bitmap** | `SETBIT/BITCOUNT` | daily-active flags, feature bits |
| **Stream** | `XADD/XREADGROUP` | durable log + consumer groups |

**ZSET is the answer to more interview questions than any other type** — sliding-window rate limiter, leaderboard, priority queue, time-series index.

---

## 2. Atomicity & Lua

- **Redis is single-threaded for command execution** — each command is atomic by construction. (I/O is multi-threaded in 6+, but execution is not.)
- **`MULTI/EXEC` is not a rollback transaction** — commands are queued and run sequentially; a runtime error in one does **not** roll back the others. It gives isolation, not atomicity-with-rollback.
- **Lua scripts (`EVAL`) run atomically** and are the correct tool for **check-and-act** logic: distributed rate limiting, conditional decrement, and anything where a read then a write would race.
- **Distributed lock:** `SET key value NX PX 30000` (unique value), release with a **Lua compare-and-delete** so you never delete someone else's lock. **State the honest caveat:** Redlock is contested — a lock is a *performance optimisation*, not a correctness guarantee, unless the protected resource checks a **fencing token**.

---

## 3. Eviction & Persistence

- **`maxmemory-policy`:** `noeviction` (writes error — the safe default for a data store) · `allkeys-lru` (**the usual cache choice**) · `allkeys-lfu` (better under skew) · `volatile-*` (only keys with a TTL) · `allkeys-random`.
- **A `volatile-lru` policy with no TTLs set behaves like `noeviction`** — writes start failing. Classic incident.
- **Persistence:**
  - **RDB** — point-in-time fork+snapshot. Compact, fast restart, **loses everything since the last snapshot**. The fork can double memory briefly.
  - **AOF** — append every write. `appendfsync everysec` is the practical setting (≤1s loss); `always` is durable and slow. Rewrites compact it.
  - **Both together** is the usual production answer.
- **"It's just a cache" can be wrong** — if the cache holds session state, rate-limit counters or an idempotency store, losing it is a correctness event, not a latency event. **Ask what a cold restart does to the system.**

---

## 4. Cluster & HA

- **Cluster: 16,384 hash slots** distributed across masters. Key → `CRC16(key) mod 16384`. **Multi-key operations only work within one slot** — use **hash tags** `{userId}:profile` / `{userId}:orders` to co-locate.
- **Sentinel** — monitoring + automatic failover for **non-clustered** deployments (a quorum of sentinels agrees the master is down and promotes a replica). Cluster has failover built in.
- **Replication is asynchronous** → a failover can lose the most recent writes. Same trade-off as every other async-replicated store. `WAIT` gives a weak acknowledgement, not a guarantee.
- **Hot key:** one key exceeding a node's capacity. Cluster does not help (it's one slot). Fixes: client-side local cache, replicate the key under N suffixes, or move it out of Redis.

---

## 5. Pub/Sub vs Streams

| | Pub/Sub | Streams |
|---|---|---|
| Persistence | **none** — fire and forget | **durable log**, retained |
| Offline subscriber | **message lost** | reads it later |
| Replay | ✖ | ✔ |
| Consumer groups | ✖ | ✔ (`XREADGROUP`, pending list, `XACK`, `XCLAIM`) |

- **Pub/Sub's fundamental limitation is the exam question:** at-most-once, no persistence, no replay. Fine for cache invalidation and presence fan-out; **wrong for anything that must not be lost.**
- **Streams** close that gap: consumer groups, per-consumer pending entries, explicit ack, and `XAUTOCLAIM` to recover a dead consumer's messages. Effectively "Kafka-lite" inside Redis.

---

## Top traps

1. `MULTI/EXEC` described as a rollback transaction.
2. Pub/Sub used where delivery must be guaranteed.
3. `volatile-lru` with no TTLs → writes fail.
4. Multi-key ops across cluster slots (no hash tag).
5. A distributed lock treated as a correctness guarantee without fencing.
6. `KEYS *` in production (O(n), blocks the single thread) — use `SCAN`.
7. Treating cache loss as a latency-only event.
8. Assuming replication is synchronous.
9. No TTL on cache keys → unbounded memory.
10. Cluster assumed to solve a hot key.

---

## Interview Q&A — Lead / Principal

**Answer frame:** headline → mechanism → trade-off + threshold → failure mode **and how you'd know** → *(Principal)* should it exist / who owns it.

### Q1 · Cache stampede *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Every hour on the hour, database CPU spikes to 100% for 30 seconds. Cache hit rate drops at the same moment."*

**Answer.** A cache **stampede**, and the hourly pattern tells you the TTLs were all set at the same time — populated together at deploy or by a scheduled warm-up — so they expire together. Every concurrent request misses simultaneously and hits the database at once, a thundering herd proportional to your traffic.

Layered fixes. **Single-flight / request coalescing** is primary: on a miss, one request rebuilds and the rest wait for it rather than all querying. **Jitter the TTL** ±10% so expiries spread — alone this fixes the hourly pattern. **Probabilistic early expiry**, where refresh probability rises as the entry nears expiry, so the rebuild happens before the cliff under normal load. For genuinely hot keys, **refresh-ahead** — never let them expire.

The deeper question is whether the cache is load-bearing. If a 30-second cache gap takes the database to 100%, it isn't an optimisation, it's a **dependency** — and I'd want to know what happens on a cold start after a Redis failover, which is the same event without the 30-second bound. If the answer is "we fall over," that's a capacity and degradation-mode gap, not a caching one.

**Why it lands.** Reads the hourly pattern as the diagnostic, four layered fixes, then escalates to "is this a cache or a dependency."
**✗ Weak answer.** "Increase the TTL" — delays and enlarges the herd.
**↳ Follow-ups.** How do you implement single-flight across 20 replicas? What's your cold-start plan?

---

### Q2 · Is Redis durable enough for this? *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"We're storing idempotency keys in Redis. Someone says that's fine because Redis has persistence. Do you agree?"*

**Answer.** No — a good example of "it's just a cache" being wrong. Redis persistence is configurable but never absolute: **RDB** is a periodic fork-and-snapshot, so a crash loses everything since the last one; **AOF** with `appendfsync everysec` bounds loss to about a second, `always` is durable and slow. On top of that **replication is asynchronous**, so a failover can lose recent acknowledged writes.

For idempotency keys that matters directly: losing the key means a retry that should have been deduplicated gets **re-executed** — in payments, a double charge. So the dedup record must be **transactionally co-located with the effect**: same database, same transaction as the payment write. If they can diverge you have a dual-write problem and the idempotency guarantee is only probabilistic.

Redis is right for rate-limit counters, session data you can afford to lose, and cached reads. It's wrong for the record that decides whether money moves. I'd also ask what the **retention window** is, because a retry arriving after expiry re-executes regardless of the store — a limit worth stating rather than discovering.

**Why it lands.** Answers with the specific consequence, gives the transactional-co-location rule, draws the line on what Redis *is* right for.
**✗ Weak answer.** "Enable AOF and it's fine."
**↳ Follow-ups.** What does `WAIT` actually give you? Where would you put the keys instead?

---

### Q3 · Is a Redis distributed lock safe? *(Principal)* ⭐⭐⭐
**Asked as:** *"We use a Redis lock so only one worker processes a batch. Is that safe?"*

**Answer.** Safe enough for *efficiency*, not for *correctness* — and that distinction is the whole answer. Mechanics first: `SET key token NX PX 30000` with a unique token, released via a **Lua compare-and-delete** so you never delete a lock someone else now holds. Without that, a slow worker whose lock expired deletes the new holder's lock on completion.

Even done correctly the guarantee is bounded. The holder can be **GC-paused or partitioned** past its TTL, wake up believing it still holds the lock, and write — while a second worker legitimately holds it. No lock service prevents that, because the lock and the protected resource are different systems. The only real fix is a **fencing token**: a monotonically increasing number issued with the lock, which **the resource checks and rejects if lower**. Protection lives at the resource, not the client.

So: if processing the batch twice is merely wasteful, the Redis lock is fine and I wouldn't over-engineer. If it moves money or corrupts state, the lock isn't the control — make the operation **idempotent**, or put the invariant in the database with a unique constraint or conditional update. I'd also note Redlock across multiple nodes is contested in the literature and I wouldn't rely on it for correctness either.

**Why it lands.** Fixes the mechanics, explains why mechanics aren't enough, names fencing tokens, gives a decision rule based on consequence.
**✗ Weak answer.** "Yes, use Redlock" — the question is testing whether you know the limits.
**↳ Follow-ups.** What TTL? How would a fencing token work against a SQL table?

---

### Quick-fire (30 seconds each)

- **"Redis Pub/Sub or Streams?"** → Pub/Sub is fire-and-forget with no persistence, so any subscriber that's offline simply misses the message and there's no replay — fine for cache invalidation or presence, wrong for anything that matters. Streams give a durable retained log with consumer groups, pending-entry tracking and explicit acks, so a consumer can restart and pick up where it left off, and a dead consumer's messages can be claimed by another. If the question involves losing a message being a problem, it's Streams.
- **"How do you build a distributed rate limiter on Redis?"** → A Lua script so the check-and-decrement is atomic — otherwise every replica races and you enforce N times the limit. For a sliding window I'd use a sorted set keyed per client: remove entries older than the window, count, and add the new one, all in one script. Token bucket works too and allows bursts. And I'd be honest that at very high rates you move to local token leases with async refresh, trading exactness for the round trip.
- **"Is Redis durable?"** → Configurably, but never fully. RDB is a point-in-time fork snapshot, so a crash loses everything since the last one; AOF appends every write, and `everysec` bounds loss to about a second while `always` is durable but slow. Most production setups run both. The more important question is what a cold, empty Redis does to the system — if it holds sessions, rate limits or idempotency keys, losing it is a correctness incident, not just a cache miss storm.

---

**Go deeper:** `07-Redis/01`–`02` · **Related:** [[14-System-Design-Core]], [[29-Performance-Engineering]], [[18-Event-Driven-Architecture]]
