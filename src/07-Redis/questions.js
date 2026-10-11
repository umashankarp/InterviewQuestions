(function (r) {
registerTopic('07-redis', {
related: ['08-dynamodb', '14-system-design', '29-performance-engineering'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['internals', 'threading'],
  code: r`~~~bash
# Find what blocks the single command thread
redis-cli SLOWLOG GET 10
redis-cli --latency-history -i 5          # client-observed latency over time
redis-cli INFO commandstats | sort -t= -k3 -rn | head   # usec_per_call per command
# Disable O(n) footguns for application users (ACL, Redis 6+)
redis-cli ACL SETUSER app on >s3cret ~app:* +@all -@dangerous -keys
# Iterate safely instead of KEYS
redis-cli --scan --pattern 'user:*' --count 1000 | head
~~~`,
  q: r`Redis is single-threaded. Why is it so fast, and what does single-threaded actually mean today?`,
  a: r`Redis executes **commands** on one main thread using an event loop (epoll/kqueue). It is fast because:

- Data lives in **memory** with purpose-built structures (listpacks, skiplists, hash tables, intsets).
- **No locks** on the data path: commands run one at a time, so each command is atomic.
- Non-blocking I/O multiplexes thousands of connections.
- Most commands are O(1) or O(log n).

Since Redis 6, **I/O threads** can read sockets and write replies in parallel, but command execution remains single-threaded. Background threads handle lazy freeing ({{UNLINK}}), fsync of the AOF, and closing files. Persistence uses a **forked child** process (copy-on-write).

Consequences you must design for:

- One slow command (KEYS on 10 M keys, a big {{SMEMBERS}}, a heavy Lua script) blocks **every** client.
- A single instance is CPU-bound on one core: scale with **cluster sharding** or more instances, not bigger CPUs.
- Throughput of ~100 K to 1 M ops/s per instance depending on payload size and pipelining.`,
  pts: [r`Single-threaded command execution`, r`In-memory structures, no locks`, r`I/O threads since 6.0`, r`One slow command blocks all`, r`Scale out with sharding`],
  ex: r`A support tool ran {{KEYS user:*}} on a 30 M-key production instance and froze checkout for 9 seconds; {{rename-command KEYS ""}} and SCAN-based tooling prevented a repeat.`,
  fu: [r`What does fork() cost with a 50 GB dataset?`, r`What is Redis's latency doctor?`],
  pit: [r`Saying Redis is entirely single-threaded (persistence and I/O threads exist).`, r`Running O(n) commands on big keys in production.`],
  tip: r`Mention that atomicity per command comes from single-threaded execution. It links performance to correctness.` },

{ id: 'q2', level: 'Basic', tags: ['data-structures'],
  code: r`~~~csharp
IDatabase db = mux.GetDatabase();
await db.StringIncrementAsync("pageviews:2026-10-10");                       // counter
await db.HashSetAsync("user:42", [new("name", "Asha"), new("tier", "gold")]); // object fields
await db.ListLeftPushAsync("recent:user:42", "sku-9"); await db.ListTrimAsync("recent:user:42", 0, 19);
await db.SetAddAsync("tags:sku-9", ["red", "sale"]);
await db.SortedSetIncrementAsync("lb:week:2026-W41", "player:7", 120);     // leaderboard
await db.HyperLogLogAddAsync("uniq:visitors:2026-10-10", "ip:203.0.113.5");  // ~0.81% error, 12 KB
await db.StringSetBitAsync("dau:2026-10-10", 42, true);                     // bitmap per user id
await db.StreamAddAsync("orders", [new("id", "981"), new("type", "placed")]); // durable log
~~~`,
  q: r`Which Redis data types would you use for which problems?`,
  a: r`| Type | Use cases | Key commands |
|---|---|---|
| String | Cache values, counters, flags, distributed lock token | GET/SET EX NX, INCR, INCRBY |
| Hash | Object fields (session, user profile) | HSET, HGET, HINCRBY |
| List | Simple queues, recent items | LPUSH, RPOP, BLMOVE, LTRIM |
| Set | Unique members, tags, dedup | SADD, SISMEMBER, SINTER |
| Sorted set | Leaderboards, priority queues, time-ordered indexes, sliding-window rate limits | ZADD, ZRANGE, ZRANGEBYSCORE, ZREMRANGEBYSCORE |
| Stream | Durable append log, consumer groups | XADD, XREADGROUP, XACK |
| Bitmap / bitfield | Daily active users, feature flags per id | SETBIT, BITCOUNT |
| HyperLogLog | Approximate unique counts (0.81% error, 12 KB) | PFADD, PFCOUNT |
| Geo | Nearby search | GEOADD, GEOSEARCH |
| JSON, Search, TimeSeries, Bloom | Redis Stack / modules (Redis 8 includes many by default) | JSON.SET, FT.SEARCH |

Choose the structure that makes the operation O(1)/O(log n) server-side rather than pulling data into the app.`,
  pts: [r`Strings, hashes, lists, sets, sorted sets`, r`Streams for logs with consumer groups`, r`HyperLogLog and bitmaps for analytics`, r`Server-side operations beat client-side`],
  ex: r`A gaming leaderboard of 20 M players used a sorted set: rank lookups with ZREVRANK in microseconds instead of a SQL ORDER BY over the whole table.`,
  fu: [r`How would you build a sliding-window rate limiter with sorted sets?`],
  pit: [r`Storing whole objects as JSON strings and rewriting them for one-field changes.`] },

{ id: 'q3', level: 'Basic', tags: ['caching'],
  code: r`~~~csharp
// Cache-aside read
public async Task<Product?> GetAsync(int id, CancellationToken ct)
{
    var key = "product:v2:" + id;
    var cached = await _db.StringGetAsync(key);
    if (cached.HasValue) return JsonSerializer.Deserialize<Product>(cached!);
    var p = await _repo.GetAsync(id, ct);
    if (p is not null)
        await _db.StringSetAsync(key, JsonSerializer.Serialize(p), TimeSpan.FromMinutes(10) + Jitter());
    return p;
}
// Write: update the database first, then DELETE the key (do not SET it)
public async Task UpdatePriceAsync(int id, decimal price, CancellationToken ct)
{
    await _repo.UpdatePriceAsync(id, price, ct);
    await _db.KeyDeleteAsync("product:v2:" + id);
}
static TimeSpan Jitter() => TimeSpan.FromSeconds(Random.Shared.Next(0, 60));
~~~`,
  q: r`Explain cache-aside, read-through, write-through and write-behind.`,
  a: r`- **Cache-aside (lazy loading)**: app reads cache; on a miss reads the DB and populates the cache with a TTL. On writes, update DB then **delete** the cache key. Most common; the cache holds only what is used.
- **Read-through**: the cache library loads from the DB on a miss (e.g. a .NET {{HybridCache.GetOrCreateAsync}} factory). Same semantics, centralised.
- **Write-through**: writes go to cache and DB synchronously. Fresh cache, higher write latency, caches data that may never be read.
- **Write-behind (write-back)**: write to cache, persist to DB asynchronously. Fast writes, but risk of data loss and complex failure handling. Rarely right for business data.

Why **delete** rather than update the cache on write: two concurrent writers updating the cache can leave it with the older value; deleting forces the next reader to load the truth. Even delete has a race (a reader loads old data just before the delete and writes it back after); bound it with TTLs or versioned values.`,
  pts: [r`Cache-aside is default`, r`Delete on write, not update`, r`Write-through: fresh but slower writes`, r`Write-behind: data loss risk`, r`TTLs bound staleness`],
  ex: r`A pricing service updated cache values on write; two concurrent price changes left the cache with the old price for hours. Switching to delete-on-write plus a 5-minute TTL fixed it.`,
  fu: [r`Describe the cache-aside race in detail.`],
  pit: [r`Caching without TTLs ("we will invalidate correctly").`] },

{ id: 'q4', level: 'Basic', tags: ['persistence'],
  code: r`~~~ini
# redis.conf for a state-bearing instance (sessions, streams)
appendonly yes
appendfsync everysec          # lose at most ~1 s on crash
aof-use-rdb-preamble yes      # fast restarts
save 900 1                    # plus an RDB snapshot for backups
# for a pure cache: no persistence at all
# appendonly no
# save ""
~~~
~~~bash
redis-cli INFO persistence | grep -E 'rdb_last_bgsave_status|aof_last_write_status|latest_fork_usec'
~~~`,
  q: r`How does Redis persistence work: RDB, AOF, and when do you use each?`,
  a: r`- **RDB snapshots**: a forked child writes a compact point-in-time file ({{SAVE}} rules or {{BGSAVE}}). Fast restarts, small files, but you lose writes since the last snapshot. Fork with large datasets can cause latency spikes and copy-on-write memory growth (up to 2× under heavy writes).
- **AOF (append-only file)**: logs every write. {{appendfsync everysec}} (default, lose at most ~1 s), {{always}} (slow), {{no}} (OS decides). AOF is rewritten in the background to compact it; since 7.0 it is a multi-part AOF with a base RDB.
- **Both** (common): AOF for durability, RDB for backups and faster restarts.
- **None**: pure cache where data can be rebuilt.

Even with AOF always, Redis is not a replacement for a durable database for critical data: replication is asynchronous, so a failover can lose acknowledged writes.`,
  pts: [r`RDB: snapshots, fast restart, loses recent writes`, r`AOF everysec: ~1 s loss`, r`Fork and copy-on-write memory`, r`Async replication can still lose writes`],
  ex: r`A cache cluster with RDB every 5 minutes doubled memory during snapshots under heavy writes and got OOM-killed; disabling persistence for a rebuildable cache fixed it.`,
  fu: [r`How do you size memory headroom for fork?`],
  pit: [r`Treating Redis with AOF as a system of record for money.`] },

{ id: 'q5', level: 'Basic', tags: ['eviction', 'memory'],
  code: r`~~~ini
# cache instance
maxmemory 12gb                 # node has 16 GB: headroom for fragmentation, buffers, fork
maxmemory-policy allkeys-lfu
# state instance (locks, queues, rate limits)
maxmemory-policy noeviction    # fail writes loudly instead of silently dropping state
~~~
~~~bash
redis-cli INFO stats | grep -E 'evicted_keys|expired_keys|keyspace_(hits|misses)'
redis-cli INFO memory | grep -E 'used_memory_human|maxmemory_human|mem_fragmentation_ratio'
~~~`,
  q: r`What happens when Redis runs out of memory? Explain eviction policies.`,
  a: r`When {{used_memory}} reaches {{maxmemory}}, Redis applies {{maxmemory-policy}}:

| Policy | Behaviour |
|---|---|
| noeviction | Writes fail with OOM error (reads still work) |
| allkeys-lru / allkeys-lfu | Evict least recently / least frequently used of all keys |
| volatile-lru / volatile-lfu | Same, only keys with a TTL |
| allkeys-random / volatile-random | Random |
| volatile-ttl | Keys closest to expiry first |

LRU/LFU are **approximated** by sampling ({{maxmemory-samples}}, default 5).

Choice: a pure cache uses **allkeys-lfu** (or lru). A mixed instance (cache plus sessions/locks that must not vanish) is a smell: separate them, or use volatile-* with TTLs only on cache keys. Queues, locks and rate-limit state should run with **noeviction** so you get errors instead of silent data loss.

Also set {{maxmemory}} below the container/VM limit (leave room for fragmentation, replication buffers, fork) or the OS OOM killer ends the process.`,
  pts: [r`maxmemory + policy`, r`allkeys-lfu for caches`, r`noeviction for queues/locks`, r`Sampling-based approximation`, r`Leave headroom below RAM`],
  ex: r`Sessions and cache shared one instance with allkeys-lru; a cache spike evicted sessions and logged out thousands of users. Splitting instances solved it.`,
  fu: [r`What is memory fragmentation ratio?`],
  pit: [r`Leaving maxmemory unset in a container.`] },

{ id: 'q6', level: 'Basic', tags: ['dotnet', 'stackexchange-redis'],
  q: r`How should a .NET service use StackExchange.Redis correctly?`,
  a: r`- One **{{ConnectionMultiplexer}}** per application (singleton). It multiplexes all commands over few connections and is thread-safe. Creating one per request is the most common production bug.
- Use **async** methods; StackExchange.Redis pipelines automatically across concurrent callers.
- Configure {{abortConnect=false}} so startup does not fail when Redis is briefly unavailable; set {{connectTimeout}}, {{syncTimeout}}/{{asyncTimeout}}.
- Read timeout exceptions carefully: they include {{qs}} (queued), {{in}} (bytes waiting to be read), thread-pool busy counts. High {{Busy}} worker threads with low min threads means **thread-pool starvation**, not a slow Redis.
- Avoid large values (over ~100 KB): they block the multiplexer pipe for everyone.
- In ASP.NET Core, use {{IDistributedCache}} via {{AddStackExchangeRedisCache}} or **{{HybridCache}}** (.NET 9) for L1 + L2 with stampede protection.

~~~csharp
builder.Services.AddSingleton<IConnectionMultiplexer>(
    ConnectionMultiplexer.Connect("redis:6379,abortConnect=false,ssl=true,password=..."));
builder.Services.AddStackExchangeRedisCache(o => o.Configuration = cfg);
builder.Services.AddHybridCache();
~~~`,
  pts: [r`Singleton multiplexer`, r`Async and automatic pipelining`, r`abortConnect=false`, r`Timeouts often mean thread-pool starvation`, r`HybridCache for L1+L2`],
  ex: r`Intermittent RedisTimeoutException with Busy=200, Min=8 workers turned out to be sync-over-async in the API starving the thread pool, not Redis.`,
  fu: [r`What does HybridCache add over IDistributedCache?`],
  pit: [r`ConnectionMultiplexer.Connect inside a request handler.`] },

{ id: 'q7', level: 'Intermediate', tags: ['caching', 'stampede'],
  code: r`~~~csharp
// .NET 9 HybridCache: L1 + L2 with built-in stampede protection (one factory call per key per process)
public sealed class HomePageService(HybridCache cache, ICatalogRepository repo)
{
    public ValueTask<IReadOnlyList<ProductCard>> GetFeaturedAsync(CancellationToken ct) =>
        cache.GetOrCreateAsync("home:featured:v3",
            async token => await repo.GetFeaturedAsync(token),
            new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(5), LocalCacheExpiration = TimeSpan.FromSeconds(30) },
            cancellationToken: ct);
}
// Probabilistic early refresh (XFetch): refresh before expiry with rising probability
static bool ShouldRefreshEarly(TimeSpan computeTime, DateTimeOffset expiry, double beta = 1.0) =>
    DateTimeOffset.UtcNow.AddMilliseconds(-computeTime.TotalMilliseconds * beta * Math.Log(Random.Shared.NextDouble())) >= expiry;
~~~`,
  q: r`What is a cache stampede and how do you prevent it?`,
  a: r`When a hot key expires, many concurrent requests miss at once and all hit the database, which can collapse it (the **thundering herd** / dog-pile).

Defences, often combined:

- **Request coalescing / single-flight**: only one caller per key loads; others wait for that result. In-process with {{HybridCache}} or a {{Lazy<Task>}} map; across instances with a short Redis lock ({{SET lock:key token NX PX 5000}}).
- **Probabilistic early refresh** (XFetch): refresh a little before expiry with probability increasing as expiry nears, so one request refreshes while others still get the cached value.
- **Stale-while-revalidate**: keep a logical expiry inside the value; serve stale while one background refresh runs.
- **TTL jitter**: add randomness so keys populated together do not expire together.
- **Never expire very hot keys**; refresh them on change events instead.
- Protect the DB with concurrency limits (bulkhead) as the last line.`,
  pts: [r`Hot key expiry → herd`, r`Single-flight per key`, r`Early probabilistic refresh`, r`Serve stale while revalidating`, r`TTL jitter`],
  ex: r`A home-page product list expiring every 60 s caused DB CPU spikes to 100% every minute; HybridCache single-flight plus jitter flattened the graph.`,
  fu: [r`What happens if the process holding the refresh lock dies?`],
  pit: [r`Identical TTLs on keys populated by a batch warm-up.`] },

{ id: 'q8', level: 'Intermediate', tags: ['distributed-lock'],
  q: r`How do you implement a distributed lock with Redis, and what are its limits?`,
  a: r`Single-instance lock:

~~~text
SET lock:invoice:42 <random-token> NX PX 30000     # acquire with TTL
-- release only if we still own it (Lua, atomic compare-and-delete)
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end
~~~

Rules: random token per holder, TTL so a crashed holder releases, compare-and-delete release, renew (extend) for long work.

Limits:

- **Not safe for correctness under failures**: a GC pause or network delay longer than the TTL lets two holders run; async replication can lose the lock on failover.
- **Redlock** (majority of 5 independent masters) reduces failover risk but still relies on timing assumptions (the Kleppmann critique).
- For correctness, add a **fencing token**: a monotonically increasing number with each lock grant, checked by the protected resource (the DB rejects writes with an older token).

Use Redis locks for **efficiency** (avoid duplicate work). For **correctness**, rely on DB constraints, conditional writes, or a consensus system (etcd, ZooKeeper).`,
  pts: [r`SET NX PX with token`, r`Compare-and-delete release`, r`Pauses can break mutual exclusion`, r`Fencing tokens`, r`Efficiency vs correctness locks`],
  ex: r`A nightly settlement job ran twice after a 40 s GC pause outlived its 30 s lock; a unique constraint on (settlement_date) was the real protection.`,
  fu: [r`Explain the Redlock debate.`],
  pit: [r`DEL without checking the token (releasing someone else's lock).`],
  tip: r`Saying "efficiency vs correctness" and "fencing token" is the Staff-level signal here.` },

{ id: 'q9', level: 'Intermediate', tags: ['rate-limiting'],
  q: r`Design a rate limiter using Redis.`,
  a: r`Algorithms:

- **Fixed window**: {{INCR key:minute}} + {{EXPIRE}}. Simple, allows 2× bursts at window edges.
- **Sliding window log**: sorted set of timestamps per client; remove old, count, add. Exact but memory grows with limit.
- **Sliding window counter**: weighted current + previous window counts. Good approximation, cheap.
- **Token bucket**: tokens refill at a rate, burst up to capacity. Store tokens and last refill time in a hash; update atomically in Lua.

~~~lua
-- token bucket: KEYS[1]=bucket, ARGV: capacity, refill_per_ms, now_ms, cost
local b = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local cap, rate, now, cost = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local tokens = tonumber(b[1]) or cap
local ts = tonumber(b[2]) or now
tokens = math.min(cap, tokens + (now - ts) * rate)
local allowed = tokens >= cost
if allowed then tokens = tokens - cost end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate))
return allowed and 1 or 0
~~~

Lua makes read-compute-write atomic. Return {{429}} with {{Retry-After}} and {{RateLimit-*}} headers. Decide fail-open vs fail-closed if Redis is down (fail-open with a local limiter is common for APIs; fail-closed for expensive or abusive operations). ASP.NET Core's built-in rate limiter is per-instance; Redis makes it global.`,
  pts: [r`Fixed, sliding log, sliding counter, token bucket`, r`Lua for atomicity`, r`429 + Retry-After`, r`Fail-open vs fail-closed`, r`Global vs per-instance`],
  ex: r`A public payments API used a Redis token bucket per API key at the gateway, with a local fallback limiter when Redis was unreachable.`,
  fu: [r`How do you rate limit in a Redis Cluster with keys per client?`],
  pit: [r`GET then SET from the app (race between instances).`] },

{ id: 'q10', level: 'Intermediate', tags: ['transactions', 'lua'],
  code: r`~~~csharp
// WATCH-style optimistic check in StackExchange.Redis
var tx = db.CreateTransaction();
tx.AddCondition(Condition.HashEqual("seat:12A", "status", "free"));
_ = tx.HashSetAsync("seat:12A", [new("status", "held"), new("by", userId)]);
_ = tx.KeyExpireAsync("seat:12A", TimeSpan.FromMinutes(10));
bool committed = await tx.ExecuteAsync();     // false -> someone else changed it

// Lua: conditional logic, atomic on the server
var hold = LuaScript.Prepare(@"
  local avail = tonumber(redis.call('GET', @stock) or '0')
  if avail < tonumber(@qty) then return 0 end
  redis.call('DECRBY', @stock, @qty)
  redis.call('SET', @hold, @qty, 'EX', 900)
  return 1");
var ok = (int)await db.ScriptEvaluateAsync(hold, new { stock = (RedisKey)"stock:{sku9}", hold = (RedisKey)"hold:{sku9}:o1", qty = 2 });
~~~`,
  q: r`MULTI/EXEC, WATCH, Lua scripts and Functions: how do you get atomicity in Redis?`,
  a: r`- **MULTI/EXEC**: queues commands and executes them sequentially without interleaving. No rollback: if one command fails at runtime (wrong type), others still run. You cannot use a read result to decide a later command inside the transaction.
- **WATCH**: optimistic concurrency. WATCH keys, read, MULTI, write, EXEC; EXEC aborts (returns null) if a watched key changed. Retry on abort.
- **Lua scripts** ({{EVAL}}/{{EVALSHA}}): run atomically on the server with conditional logic. Must declare all keys in {{KEYS}} (required for cluster routing; all keys must hash to one slot). Keep scripts short: they block everything while running.
- **Functions** (Redis 7+): named, persisted libraries of Lua code loaded once with {{FUNCTION LOAD}}, replicated and persisted. Better than shipping scripts from every client.

In StackExchange.Redis, {{ITransaction}} with {{AddCondition}} implements WATCH-like checks, and {{ScriptEvaluateAsync}} with {{LuaScript.Prepare}} handles scripts.`,
  pts: [r`MULTI/EXEC: no interleaving, no rollback`, r`WATCH for optimistic checks`, r`Lua for conditional atomic logic`, r`Keys must share a slot in cluster`, r`Functions in Redis 7`],
  ex: r`An inventory hold used a Lua script: check available count, decrement, add a hold with TTL, all atomic in one call.`,
  fu: [r`What happens if a Lua script runs for 5 seconds?`],
  pit: [r`Expecting MULTI/EXEC to roll back on error.`] },

{ id: 'q11', level: 'Intermediate', tags: ['replication', 'sentinel'],
  code: r`~~~ini
# sentinel.conf (3+ sentinels on separate hosts)
sentinel monitor payments-cache 10.0.1.10 6379 2      # quorum 2
sentinel down-after-milliseconds payments-cache 5000
sentinel failover-timeout payments-cache 60000
# redis.conf on the master: stop accepting writes when isolated from replicas
min-replicas-to-write 1
min-replicas-max-lag 10
~~~
~~~csharp
var mux = await ConnectionMultiplexer.ConnectAsync("sentinel1:26379,sentinel2:26379,sentinel3:26379,serviceName=payments-cache,abortConnect=false");
~~~`,
  dia: r`flowchart LR
  App[.NET app] -->|ask master address| S1[Sentinel 1]
  App --> S2[Sentinel 2]
  App --> S3[Sentinel 3]
  App -->|reads/writes| M[(Master)]
  M -- async replication --> R1[(Replica 1)]
  M -- async replication --> R2[(Replica 2)]
  S1 & S2 & S3 -. monitor and vote .-> M`,
  q: r`Explain Redis replication and Sentinel-based failover.`,
  a: r`**Replication** is asynchronous: replicas receive a full sync (RDB) then a stream of commands; a replication backlog allows partial resync after short disconnects. {{WAIT numreplicas timeout}} blocks until N replicas acknowledge, reducing (not eliminating) loss.

**Sentinel** processes (at least 3, on separate hosts) monitor the master. When a quorum agrees the master is down, they elect a leader Sentinel that promotes a replica and reconfigures others. Clients ask Sentinels for the current master address.

Data loss windows:

- Writes acknowledged by the old master but not replicated are lost on failover.
- In a partition, the old master may accept writes from clients on its side; {{min-replicas-to-write 1}} and {{min-replicas-max-lag 10}} make it stop accepting writes when it cannot reach replicas, bounding loss.

Managed services (ElastiCache, Azure Cache for Redis, Memorystore) handle failover; Kubernetes operators exist but stateful Redis on K8s needs care.`,
  pts: [r`Async replication`, r`WAIT reduces loss`, r`Sentinel quorum and promotion`, r`min-replicas-to-write bounds split-brain writes`, r`Prefer managed services`],
  ex: r`During an AZ network partition, an isolated master kept accepting writes for 40 s that were discarded on rejoin; min-replicas-to-write closed that window.`,
  fu: [r`How does a client discover the new master?`],
  pit: [r`Running a single Sentinel.`] },

{ id: 'q12', level: 'Intermediate', tags: ['cluster', 'sharding'],
  code: r`~~~bash
redis-cli -c CLUSTER KEYSLOT "cart:{user42}"       # same slot as...
redis-cli -c CLUSTER KEYSLOT "wishlist:{user42}"   # ...this one, thanks to the hash tag
redis-cli -c MGET "cart:{user42}" "wishlist:{user42}"   # works: single slot
redis-cli -c MGET "cart:user42" "wishlist:user42"       # CROSSSLOT error in cluster mode
~~~`,
  dia: r`flowchart LR
  C[Client caches slot map] -->|CRC16 key mod 16384| N1
  C --> N2
  C --> N3
  subgraph Cluster
    N1[(Master A slots 0-5460)] --- R1[(Replica A)]
    N2[(Master B slots 5461-10922)] --- R2[(Replica B)]
    N3[(Master C slots 10923-16383)] --- R3[(Replica C)]
  end
  N1 -. MOVED / ASK redirect .-> C`,
  q: r`How does Redis Cluster shard data, and what limits does it impose?`,
  a: r`Redis Cluster splits the keyspace into **16,384 hash slots**: {{slot = CRC16(key) mod 16384}}. Each master owns a range of slots and has replicas. Clients cache the slot map; a wrong node replies {{MOVED}} (permanent) or {{ASK}} (during migration).

Limits:

- **Multi-key operations** (MGET, transactions, Lua, SINTER, RENAME) only work if all keys are in the same slot. Use **hash tags**: only the part inside {{{...}}} is hashed, so {{cart:{user42}}} and {{wishlist:{user42}}} land together.
- Only database 0.
- A **hot key** cannot be split across nodes: one node takes all its load.
- Big keys make slot migration slow.
- Cluster bus traffic grows with node count; practical sizes are tens to low hundreds of nodes.

Hash tags trade flexibility for skew risk: tagging by tenant puts a huge tenant on one node.`,
  pts: [r`16,384 slots via CRC16`, r`MOVED / ASK redirects`, r`Hash tags for co-location`, r`Hot keys cannot be split`, r`Multi-key ops need one slot`],
  ex: r`A Lua script touching user and session keys failed with CROSSSLOT after moving to cluster mode; hash tags on the user id fixed it.`,
  fu: [r`How do you reshard with minimal impact?`],
  pit: [r`Hash-tagging everything with one constant tag (all data on one node).`] },

{ id: 'q13', level: 'Intermediate', tags: ['streams', 'messaging'],
  code: r`~~~csharp
// Pub/Sub: fire-and-forget fan-out (missed while disconnected)
var sub = mux.GetSubscriber();
await sub.SubscribeAsync(RedisChannel.Literal("cache-invalidate"), (_, key) => _local.Remove((string)key!));
await sub.PublishAsync(RedisChannel.Literal("cache-invalidate"), "product:v2:42");

// Reliable list queue: atomically move to a processing list, remove after success
var job = await db.ListMoveAsync("jobs:pending", "jobs:processing:w1", ListSide.Right, ListSide.Left);
/* process */ await db.ListRemoveAsync("jobs:processing:w1", job);
~~~`,
  q: r`Redis Streams vs Pub/Sub vs Lists for messaging.`,
  a: r`| | Pub/Sub | Lists (LPUSH/BLMOVE) | Streams |
|---|---|---|---|
| Persistence | None: offline subscribers miss messages | Yes (in memory) | Yes, append log |
| Fan-out | Yes, to connected subscribers | No, one consumer per message | Yes via multiple consumer groups |
| Consumer groups / acks | No | Manual (reliable queue via BLMOVE to processing list) | Built in: XREADGROUP, XACK, pending entries list |
| Replay | No | No | Yes by id |
| Use | Live notifications, cache invalidation signals | Simple job queues | Event log, work queues with acks |

Streams details: {{XADD}} with {{MAXLEN ~ n}} to cap length; consumers in a group get distinct messages; unacked messages stay in the **PEL**; {{XAUTOCLAIM}} reassigns messages from dead consumers after an idle time.

Compared with Kafka: Streams are memory-bound, single-node per key (no partitioned stream across the cluster without manual sharding), weaker durability. Good for modest volumes and low latency; Kafka for durable, high-volume event backbones.`,
  pts: [r`Pub/Sub is fire-and-forget`, r`Lists for simple queues`, r`Streams: consumer groups, PEL, replay`, r`XAUTOCLAIM for dead consumers`, r`Kafka for durable high volume`],
  ex: r`SignalR backplane over Redis Pub/Sub fits because missed messages only matter to connected clients; order processing used Streams with acks.`,
  fu: [r`How do you handle poison messages in Streams?`],
  pit: [r`Using Pub/Sub for business events that must not be lost.`] },

{ id: 'q14', level: 'Intermediate', tags: ['ttl', 'expiry'],
  code: r`~~~csharp
// SET without an expiry clears an existing TTL: keep it explicitly
await db.StringSetAsync("session:abc", payload, expiry: null, keepTtl: true);
// Spread expirations: base TTL plus jitter
var ttl = TimeSpan.FromHours(24) + TimeSpan.FromMinutes(Random.Shared.Next(-120, 120));
await db.StringSetAsync("warm:product:42", json, ttl);
// Delete big keys without blocking the main thread
await db.KeyDeleteAsync("big:hash", CommandFlags.FireAndForget);   // DEL blocks; prefer UNLINK:
await db.ExecuteAsync("UNLINK", "big:hash");
~~~
~~~ini
lazyfree-lazy-expire yes
lazyfree-lazy-eviction yes
~~~`,
  q: r`How does key expiration work internally, and what problems can it cause?`,
  a: r`Redis expires keys two ways:

- **Lazy**: on access, an expired key is deleted and treated as missing.
- **Active**: a background cycle (10 times a second by default) samples keys with TTLs and deletes expired ones, repeating while many are expired, with a CPU time budget.

Problems:

- **Mass expiry**: millions of keys with the same TTL expire together, the active cycle consumes CPU and latency spikes; plus the stampede on the data source. Use **jitter**.
- **Memory from expired but not yet reclaimed keys**: memory can stay high until the cycle catches up.
- **Replicas** do not expire keys independently; they wait for the master's DEL (but reads on replicas hide logically expired keys).
- {{SET}} without {{KEEPTTL}} removes the TTL: an overwrite can make a cache key permanent. ({{KEEPTTL}} option or always pass EX.)
- Deleting big keys synchronously blocks: use {{UNLINK}} and {{lazyfree-lazy-expire yes}}.`,
  pts: [r`Lazy + active expiry`, r`Mass expiry spikes`, r`TTL jitter`, r`SET resets TTL`, r`UNLINK and lazyfree`],
  ex: r`A nightly warm-up set 8 M keys with a 24 h TTL; the next night latency spiked during mass expiry. Jitter of ±2 h smoothed it.`,
  fu: [r`How do you find keys without TTLs?`],
  pit: [r`Overwriting a key with SET and losing its expiry.`] },

{ id: 'q15', level: 'Intermediate', tags: ['sessions'],
  q: r`How do you store ASP.NET Core sessions or auth state in Redis safely?`,
  a: r`ASP.NET Core session ({{AddSession}}) over {{IDistributedCache}} stores session bytes in Redis keyed by a session id cookie. Data Protection keys must also be shared across instances, otherwise cookies issued by one pod cannot be decrypted by another:

~~~csharp
builder.Services.AddStackExchangeRedisCache(o => o.Configuration = cs);
builder.Services.AddSession(o => { o.IdleTimeout = TimeSpan.FromMinutes(20); o.Cookie.HttpOnly = true;
                                   o.Cookie.SecurePolicy = CookieSecurePolicy.Always; });
builder.Services.AddDataProtection()
    .PersistKeysToStackExchangeRedis(mux, "DataProtection-Keys")
    .ProtectKeysWithCertificate(cert);   // encrypt keys at rest
~~~

Design points:

- Keep sessions small (ids and flags, not object graphs).
- Session instance with **noeviction** (or a dedicated instance) so sessions are not evicted as cache.
- TLS and auth (ACL users), private network.
- Consider stateless tokens (JWT) vs server sessions: server sessions allow instant revocation; Redis makes that cheap.
- Plan for Redis outage: sessions lost means users log in again; acceptable for most apps, not for checkout mid-flow (persist carts in the DB).`,
  pts: [r`IDistributedCache-backed session`, r`Shared Data Protection keys`, r`Small sessions, noeviction`, r`TLS + ACL`, r`Revocation advantage`],
  ex: r`After scaling to 3 pods, users got random antiforgery errors because Data Protection keys were per pod; persisting keys to Redis fixed it.`,
  fu: [r`Server sessions vs JWT for a banking app?`],
  pit: [r`Storing the shopping cart only in session.`] },

{ id: 'q16', level: 'Intermediate', tags: ['pipelining', 'performance'],
  q: r`What is pipelining and how does it differ from batching or transactions?`,
  a: r`Without pipelining, each command pays a network round trip (RTT). 1,000 commands × 0.5 ms RTT = 500 ms. **Pipelining** sends many commands without waiting for replies, then reads replies together: 1,000 commands in a few ms.

- Pipelining is **not atomic**: other clients' commands may interleave.
- MULTI/EXEC is atomic and usually pipelined too.
- Variadic commands ({{MGET}}, {{HMSET}}, {{ZADD}} with many members) reduce both round trips and per-command overhead.

StackExchange.Redis pipelines automatically when you issue concurrent async calls; use {{IBatch}} to group explicitly:

~~~csharp
var batch = db.CreateBatch();
var tasks = ids.Select(id => batch.StringGetAsync("price:" + id)).ToArray();
batch.Execute();
var prices = await Task.WhenAll(tasks);
~~~

Do not build a single pipeline with millions of commands: memory on both sides grows; chunk into a few thousand.`,
  pts: [r`RTT dominates small commands`, r`Pipelining is not atomic`, r`Variadic commands`, r`IBatch / automatic pipelining in .NET`, r`Chunk huge batches`],
  ex: r`A recommendation endpoint doing 300 sequential GETs (150 ms) switched to MGET and took 2 ms.`,
  fu: [r`How does pipelining work in Redis Cluster?`],
  pit: [r`Awaiting each call in a loop.`] },

{ id: 'q17', level: 'Intermediate', tags: ['security'],
  q: r`How do you secure Redis?`,
  a: r`- **Network isolation**: private subnets/VPC, security groups; never internet-exposed (bots scan for open 6379 constantly and use {{CONFIG SET dir}} tricks to write files).
- **Authentication**: ACL users (Redis 6+) with per-service users and least-privilege command and key-pattern permissions instead of one shared {{requirepass}}. IAM auth on ElastiCache / Entra ID on Azure Cache where available.
- **TLS** in transit; encryption at rest on managed services.
- **Disable dangerous commands** for app users: {{FLUSHALL}}, {{FLUSHDB}}, {{KEYS}}, {{CONFIG}}, {{DEBUG}} via ACL categories ({{-@dangerous}}).
- **Data minimisation**: no secrets or raw PII in cache when avoidable; if cached, short TTLs and encryption at the app layer.
- Rotate credentials via secret managers.

~~~text
ACL SETUSER orders-api on >secret ~orders:* ~cache:orders:* +@read +@write -@dangerous
~~~`,
  pts: [r`Never public`, r`ACL users with key patterns`, r`TLS`, r`Block dangerous commands`, r`Minimise sensitive data`],
  ex: r`A dev Redis exposed to the internet was wiped and replaced with a ransom note key within hours.`,
  fu: [r`What is the risk of caching JWTs or card tokens?`],
  pit: [r`One shared password for every service.`] },

{ id: 'q18', level: 'Intermediate', tags: ['big-keys', 'hot-keys'],
  code: r`~~~bash
redis-cli --bigkeys -i 0.01        # SCAN-based, sleeps between batches
redis-cli --memkeys
redis-cli MEMORY USAGE "user:42:events" SAMPLES 0
redis-cli --hotkeys                # requires maxmemory-policy *-lfu
~~~
~~~csharp
// Hot key mitigation: N copies, read a random one
const int Copies = 8;
await Task.WhenAll(Enumerable.Range(0, Copies).Select(i => db.StringSetAsync("deal:today:c" + i, json, TimeSpan.FromMinutes(5))));
var value = await db.StringGetAsync("deal:today:c" + Random.Shared.Next(Copies));
~~~`,
  q: r`How do you detect and fix big keys and hot keys?`,
  a: r`**Big keys** (a 50 MB string, a hash with 5 M fields) cause slow commands, blocking deletes, replication spikes, uneven cluster memory and slow slot migration.

Detect: {{redis-cli --bigkeys}} / {{--memkeys}} (SCAN-based), {{MEMORY USAGE key}}, slowlog entries, offline RDB analysis.
Fix: split into buckets ({{user:42:events:2026-10}}), paginate with {{HSCAN}}/{{ZRANGE}} limits, delete with {{UNLINK}}, cap collections ({{LTRIM}}, {{XADD MAXLEN}}).

**Hot keys** (one key receiving a large share of traffic) overload one node regardless of cluster size.

Detect: {{redis-cli --hotkeys}} (needs LFU policy), client-side metrics, MONITOR sampling briefly (expensive).
Fix: **local in-process cache** (L1, a few seconds TTL) in front of Redis; **replicate the key** across N copies ({{key:copy:0..7}}) and read a random copy; read from replicas; for counters, shard the counter and sum.`,
  pts: [r`Big keys block and skew`, r`--bigkeys, MEMORY USAGE`, r`Split and cap collections`, r`Hot keys: L1 cache, key copies`, r`Sharded counters`],
  ex: r`A flash-sale product key took 400 K reads/s on one shard; a 1-second L1 cache in the .NET pods cut Redis load by 99%.`,
  fu: [r`How does HybridCache help with hot keys?`],
  pit: [r`Adding cluster nodes to fix a hot key.`] },

{ id: 'q19', level: 'Senior', tags: ['cache-consistency'],
  code: r`~~~csharp
// Versioned set-if-newer: an old load can never overwrite a newer value
var setIfNewer = LuaScript.Prepare(@"
  local cur = redis.call('HGET', @key, 'v')
  if cur and tonumber(cur) >= tonumber(@ver) then return 0 end
  redis.call('HSET', @key, 'v', @ver, 'data', @data)
  redis.call('EXPIRE', @key, @ttl)
  return 1");
await db.ScriptEvaluateAsync(setIfNewer, new { key = (RedisKey)"customer:42", ver = row.RowVersion, data = json, ttl = 600 });

// CDC consumer (Debezium event from the customers table) invalidates every writer's changes
public async Task HandleAsync(CustomerChanged evt) => await db.KeyDeleteAsync("customer:" + evt.CustomerId);
~~~`,
  dia: r`flowchart LR
  API[Customer API] -->|write| DB[(SQL database)]
  Batch[KYC batch job] -->|write| DB
  DB -->|transaction log| DBZ[Debezium CDC]
  DBZ --> K[Kafka topic customers]
  K --> INV[Invalidator service]
  INV -->|DEL customer:id| R[(Redis)]
  API -->|cache-aside reads| R`,
  q: r`How do you keep a Redis cache consistent with the database in a microservices system?`,
  a: r`Perfect consistency between two systems without a distributed transaction is impossible; decide the **staleness budget** per data type, then pick a mechanism:

1. **TTL only**: staleness ≤ TTL. Simple; fine for catalogue data.
2. **Delete on write** in the writing service: low staleness, but misses writes from other paths (batch jobs, other services) and has the concurrent-read race.
3. **Delayed double delete**: delete, write DB, delete again after ~replication lag. Reduces the race.
4. **CDC-driven invalidation**: Debezium/change streams read the DB log and delete or update keys. Catches every write path, ordered per key; latency of the CDC pipeline.
5. **Versioned values**: store {{version}} with the value; set only if newer (Lua compare). Prevents older loads overwriting newer ones.
6. **Do not cache** data where staleness is unacceptable (balances used for authorisation).

Always pair with TTLs as a safety net, and measure staleness (sample comparisons).`,
  pts: [r`Define staleness budget per data type`, r`Delete-on-write race`, r`CDC invalidation catches all writers`, r`Versioned set-if-newer`, r`TTL safety net`],
  ex: r`A customer-profile cache was invalidated only by the profile API; a nightly KYC batch updated the DB directly and caches served old addresses for days until CDC invalidation was added.`,
  fu: [r`How do you measure cache staleness in production?`],
  pit: [r`Claiming write-through gives strong consistency.`],
  tip: r`Opening with "what staleness can the business accept?" frames the answer at Principal level.` },

{ id: 'q20', level: 'Senior', tags: ['incident', 'latency'],
  code: r`~~~bash
redis-cli SLOWLOG GET 20
redis-cli INFO persistence | grep latest_fork_usec      # fork time in microseconds
redis-cli LATENCY DOCTOR
redis-cli --intrinsic-latency 30                         # run on the host: VM/hypervisor jitter
cat /sys/kernel/mm/transparent_hugepage/enabled           # should be [never]
~~~
~~~text
StackExchange.Redis timeout message to read:
Timeout performing GET (5000ms), inst: 0, qu: 0, qs: 312, in: 0, ...
IOCP: (Busy=0,Free=1000,Min=8,Max=1000), WORKER: (Busy=250,Free=32517,Min=8,Max=32767)
-> qs high + WORKER Busy far above Min = thread-pool starvation in the app, not a slow Redis
~~~`,
  q: r`Redis latency spikes to hundreds of milliseconds every few minutes. Investigate.`,
  a: r`Candidates and how to check:

1. **Slow commands**: {{SLOWLOG GET 50}}: KEYS, big {{HGETALL}}/{{SMEMBERS}}, long Lua scripts, {{DEL}} on big keys.
2. **Fork for persistence**: {{INFO persistence}} ({{latest_fork_usec}}), RDB schedule or AOF rewrite timing matches spikes. Fork of a large dataset on VMs without huge pages disabled can take hundreds of ms. Fix: disable THP, schedule saves, persist on a replica only, or disable persistence for caches.
3. **Mass expiry or eviction**: {{expired_keys}}, {{evicted_keys}} rate spikes.
4. **Swapping**: {{INFO memory}} vs RSS; any swap is catastrophic.
5. **Network/client side**: client thread-pool starvation (.NET timeout messages show it), large values clogging the pipe, cross-AZ latency.
6. **Noisy neighbour / CPU steal** on shared VMs.

Tools: {{LATENCY DOCTOR}}, {{LATENCY HISTORY}}, {{--latency}} and {{--intrinsic-latency}} from redis-cli, and correlate with app-side traces.`,
  pts: [r`SLOWLOG`, r`Fork timing`, r`Expiry/eviction bursts`, r`Swap`, r`Client-side starvation`, r`LATENCY DOCTOR`],
  ex: r`Spikes every 5 minutes matched RDB saves; moving persistence to the replica eliminated them on the master.`,
  fu: [r`Why disable transparent huge pages for Redis?`],
  pit: [r`Blaming Redis without checking client thread-pool metrics.`] },

{ id: 'q21', level: 'Senior', tags: ['leaderboard', 'design'],
  code: r`~~~csharp
const long MaxTs = 9_999_999_999L;
// score = points * 10^10 + (MaxTs - unixSeconds): equal points -> earlier achiever ranks higher
static double Score(long points, DateTimeOffset at) => points * 10_000_000_000d + (MaxTs - at.ToUnixTimeSeconds());

await db.SortedSetAddAsync("lb:all", "player:7", Score(1200, DateTimeOffset.UtcNow));
long? rank = await db.SortedSetRankAsync("lb:all", "player:7", Order.Descending);   // 0-based
var top = await db.SortedSetRangeByRankWithScoresAsync("lb:all", 0, 99, Order.Descending);
// weekly board from daily boards
await db.SortedSetCombineAndStoreAsync(SetOperation.Union, "lb:week:2026-W41",
    Enumerable.Range(6, 7).Select(d => (RedisKey)("lb:day:2026-10-" + d.ToString("00"))).ToArray());
~~~
Note: points are kept small enough that the combined score stays under 2^53 so doubles remain exact.`,
  q: r`Design a real-time leaderboard for 50 million players with daily, weekly and all-time rankings.`,
  a: r`Core: **sorted sets**, score = points, member = player id.

- {{ZINCRBY lb:all playerId points}} on each score event; {{ZREVRANK}} for a player's rank (O(log n)); {{ZREVRANGE 0 99 WITHSCORES}} for the top 100.
- Daily/weekly boards as separate keys: {{lb:day:2026-10-10}}, {{lb:week:2026-W41}} with TTLs after the period ends; or compute weekly with {{ZUNIONSTORE}} of daily sets.
- **Ties**: encode tiebreakers in the score (points × 10^6 + (MAX_TS - timestamp)) so earlier achievers rank higher; double precision allows 53-bit integers exactly.
- **Size**: 50 M members × ~100 bytes ≈ 5 GB per board: fits, but one sorted set lives on one node and one key. Shard by region/bracket if needed, or keep exact top-N in Redis and approximate ranks for the long tail (percentile buckets).
- **Durability**: Redis is the serving layer; the score events go to Kafka and a database as the source of truth, so the board can be rebuilt.
- **Friends leaderboard**: {{ZMSCORE}} for friend ids and sort client-side.`,
  pts: [r`Sorted sets with ZINCRBY/ZREVRANK`, r`Period keys + TTL`, r`Composite score for ties`, r`Single key = single node limit`, r`Rebuildable from source of truth`],
  ex: r`A mobile game served 30 K rank lookups per second from one sorted set per board on a 3-shard cluster, rebuilding from Kafka after a failover in minutes.`,
  fu: [r`How would you show "your rank among 50 M" cheaply at very high QPS?`],
  pit: [r`Computing ranks with SQL ORDER BY on each request.`] },

{ id: 'q22', level: 'Senior', tags: ['multi-level-cache', 'dotnet'],
  dia: r`flowchart LR
  subgraph Pod1[API pod 1]
    L1a[L1 MemoryCache 30s]
  end
  subgraph Pod2[API pod 2]
    L1b[L1 MemoryCache 30s]
  end
  L1a -->|miss| R[(Redis L2 10 min)]
  L1b -->|miss| R
  R -->|miss| DB[(Database)]
  W[Writer] -->|update| DB
  W -->|publish invalidate| PS[Redis Pub/Sub]
  PS --> L1a
  PS --> L1b`,
  q: r`How do you design a two-level (in-process + Redis) cache in .NET, and how do you invalidate L1 across pods?`,
  a: r`L1 (MemoryCache in each pod) gives sub-microsecond reads and absorbs hot keys; L2 (Redis) is shared and survives pod restarts.

**HybridCache** (.NET 9) provides L1 + L2 with stampede protection, serialization and tag-based invalidation:

~~~csharp
var product = await cache.GetOrCreateAsync($"product:{id}",
    async ct => await repo.GetAsync(id, ct),
    new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(10), LocalCacheExpiration = TimeSpan.FromSeconds(30) },
    tags: new[] { "catalog" }, cancellationToken: ct);
~~~

Keep keys namespaced and versioned ({{product:v2:42}}) so a model change never deserializes old shapes.

**Cross-pod L1 invalidation**: L1 cannot be reached directly, so:

- Keep **L1 TTLs short** (seconds), so staleness is bounded.
- Publish invalidation messages via Redis **Pub/Sub** (or keyspace notifications / client-side caching with {{CLIENT TRACKING}} in RESP3) and evict locally on receipt. Pub/Sub can drop messages during disconnects, so short TTL remains the safety net.

Use L1 only for data where seconds of staleness are acceptable.`,
  pts: [r`L1 for latency and hot keys`, r`HybridCache with stampede protection`, r`Short L1 TTL`, r`Pub/Sub or client tracking for invalidation`, r`Messages can be lost: TTL is the net`],
  ex: r`Adding a 30-second L1 cut p99 from 3 ms to 0.2 ms for product reads and reduced Redis CPU by 70%.`,
  fu: [r`What is Redis server-assisted client-side caching?`],
  pit: [r`Long L1 TTLs on data that changes frequently.`] },

{ id: 'q23', level: 'Senior', tags: ['idempotency'],
  code: r`~~~csharp
public async Task<IResult> CreatePaymentAsync(string idemKey, PaymentRequest req, CancellationToken ct)
{
    var key = "idem:" + req.MerchantId + ":" + idemKey;
    var hash = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(req)));
    if (!await _redis.StringSetAsync(key, "IN_PROGRESS|" + hash, TimeSpan.FromHours(24), When.NotExists))
    {
        var parts = ((string)(await _redis.StringGetAsync(key))!).Split('|', 3);   // STATE|hash|response
        if (parts[1] != hash) return Results.UnprocessableEntity();                 // same key, different payload
        return parts[0] == "IN_PROGRESS" ? Results.Conflict() : Results.Content(parts[2], "application/json");
    }
    // authoritative guard: unique constraint on (merchant_id, idempotency_key) in the same DB transaction
    var result = await _payments.CreateAsync(req, idemKey, ct);
    await _redis.StringSetAsync(key, "DONE|" + hash + "|" + JsonSerializer.Serialize(result), TimeSpan.FromHours(24));
    return Results.Ok(result);
}
~~~`,
  q: r`Use Redis to implement API idempotency keys. What can go wrong?`,
  a: r`Flow for {{Idempotency-Key}} on a POST:

1. {{SET idem:{key} "IN_PROGRESS" NX EX 86400}}: if it fails, the key exists: return the stored response if complete, or 409 if still in progress.
2. Process the request.
3. Store the response (status, body hash/body) under the key with the same TTL.

Pitfalls:

- **Redis is not durable enough for money**: a failover can lose the key, and a retry then executes twice. For payments, the **authoritative** idempotency record must be in the database (unique constraint in the same transaction as the business write); Redis is a fast front check.
- **Crash between step 1 and 3** leaves IN_PROGRESS: add a shorter lock TTL or a lease, and allow takeover after expiry.
- **Different payload with same key**: store a request hash and reject mismatches (422).
- **Scope** keys per client/tenant to avoid collisions.
- TTL must exceed the client's retry window.`,
  pts: [r`SET NX as fast guard`, r`Store response for replay`, r`Database is the authoritative record`, r`Handle in-progress crashes`, r`Payload hash mismatch`],
  ex: r`A team relied solely on Redis idempotency; a failover during a retry storm produced 23 duplicate transfers. A DB unique constraint on the key made duplicates impossible.`,
  fu: [r`How do you return the original response for a duplicate?`],
  pit: [r`Treating Redis SET NX as an exactly-once guarantee.`] },

{ id: 'q24', level: 'Senior', tags: ['streams', 'consumer-groups'],
  q: r`Build a reliable work queue with Redis Streams consumer groups.`,
  a: r`~~~text
XGROUP CREATE jobs workers $ MKSTREAM
XADD jobs MAXLEN ~ 1000000 * type invoice id 42            # producer
XREADGROUP GROUP workers w1 COUNT 10 BLOCK 5000 STREAMS jobs >   # consumer
XACK jobs workers 1696940000000-0                          # after processing
XAUTOCLAIM jobs workers w2 60000 0-0 COUNT 10              # reclaim stuck messages
~~~

Reliability details:

- Messages stay in the **pending entries list (PEL)** until XACK, so a crashed consumer's messages can be reclaimed with XAUTOCLAIM after an idle time.
- **Delivery count** in XPENDING lets you route poison messages to a dead-letter stream after N attempts.
- Processing must be **idempotent** (at-least-once).
- Cap length with {{MAXLEN ~}} (approximate trimming is cheap); ensure consumers keep up or messages are trimmed before processing.
- Persistence: AOF everysec and replication; still possible to lose the last second on failover.

In .NET, run consumers as {{BackgroundService}} with graceful shutdown, metrics on lag ({{XINFO GROUPS}} lag field in 7.0+) and PEL size.`,
  pts: [r`XREADGROUP + XACK`, r`PEL and XAUTOCLAIM`, r`Delivery count → DLQ`, r`Idempotent processing`, r`MAXLEN trimming risk`],
  ex: r`A PDF generation service used Streams; a consumer crash left 300 messages pending, auto-claimed by peers after 60 s with no manual intervention.`,
  fu: [r`When would you move this to RabbitMQ or SQS?`],
  pit: [r`Never acking and letting the PEL grow forever.`] },

{ id: 'q25', level: 'Senior', tags: ['managed-services'],
  code: r`~~~bash
# ElastiCache Valkey replication group, multi-AZ with automatic failover
aws elasticache create-replication-group --replication-group-id payments-cache \
  --engine valkey --engine-version 8.0 --cache-node-type cache.r7g.large \
  --num-node-groups 3 --replicas-per-node-group 1 --automatic-failover-enabled --multi-az-enabled \
  --transit-encryption-enabled --at-rest-encryption-enabled
# MemoryDB when Redis must be the durable primary store
aws memorydb create-cluster --cluster-name ledger-hot --node-type db.r7g.large --acl-name app-acl --tls-enabled
~~~`,
  q: r`Compare ElastiCache/MemoryDB, Azure Cache for Redis/Azure Managed Redis and self-hosted Redis.`,
  a: r`| | ElastiCache (Redis OSS / Valkey) | MemoryDB | Azure Cache / Azure Managed Redis | Self-hosted |
|---|---|---|---|---|
| Purpose | Cache, ephemeral data | Durable primary DB (multi-AZ transaction log) | Cache; Enterprise tiers add modules, active geo-replication | Anything |
| Durability | Async replication, snapshots | Writes durable across AZs before ack | Persistence options per tier | Your config |
| Ops | Managed failover, patching | Managed | Managed | You own everything |
| Cost | Moderate | Higher write latency and cost | Tier-dependent | Cheapest licence, most toil |

Notes: after Redis's 2024 licence change, AWS and others back **Valkey** (BSD fork); ElastiCache supports Valkey with lower pricing. Redis 8 returned to an OSI licence option (AGPL) alongside others; check licence terms for your use.

Choose: ElastiCache/Azure Cache for caching and sessions; MemoryDB when you truly need Redis as a durable primary store; self-hosted only with a strong platform team or special requirements.`,
  pts: [r`ElastiCache for cache`, r`MemoryDB for durable Redis`, r`Valkey fork after licence change`, r`Managed beats self-hosted for most`],
  ex: r`A team moved a rate-limit and session tier to ElastiCache Valkey, cutting cost by about 20% with no code changes.`,
  fu: [r`What does MemoryDB's durability cost in latency?`],
  pit: [r`Using a cache tier as the only copy of business data.`] },

{ id: 'q26', level: 'Senior', tags: ['memory-optimization'],
  code: r`~~~csharp
// Hash bucketing: 1 M small string keys -> ~1 K hashes in compact listpack encoding
static (string Key, string Field) Bucket(long userId) => ("users:" + (userId / 1000), (userId % 1000).ToString());
var (k, f) = Bucket(1_234_567);
await db.HashSetAsync(k, f, packedProfile);
~~~
~~~ini
hash-max-listpack-entries 1024     # keep buckets under this to stay compact
hash-max-listpack-value 64
activedefrag yes
~~~`,
  q: r`How do you reduce Redis memory usage?`,
  a: r`- **Small encodings**: small hashes, lists, sets and sorted sets use compact **listpack/intset** encodings until thresholds ({{hash-max-listpack-entries 128}}, {{-value 64}}). Grouping many small values into hashes (bucketing ids: {{user:1234}} → hash {{users:12}} field {{34}}) can cut memory several times.
- **Shorter keys** and compact serialization (MessagePack/protobuf instead of JSON, compression for large values).
- **Right data structure**: bitmaps for boolean-per-id, HyperLogLog for counts, Bloom filters for membership.
- **TTL everything** that is cache; find keys without TTL via SCAN + TTL sampling.
- **Fragmentation**: {{mem_fragmentation_ratio}} > 1.5 means wasted memory; enable {{activedefrag}}.
- **Separate workloads** to right-size each instance.

Measure with {{MEMORY USAGE}}, {{INFO memory}}, and RDB analysis tools before optimising.`,
  pts: [r`Listpack/intset small encodings`, r`Hash bucketing`, r`Compact serialization`, r`Probabilistic structures`, r`Active defrag`],
  ex: r`Moving 100 M feature-flag booleans from string keys to bitmaps reduced memory from 9 GB to 12 MB.`,
  fu: [r`Why does a JSON string cost more than a hash of fields?`],
  pit: [r`Storing large JSON blobs and fetching them for one field.`] },

{ id: 'q27', level: 'Senior', tags: ['geo', 'search'],
  q: r`How would you build "find drivers near me" with Redis?`,
  a: r`Geo commands store positions in a sorted set using a 52-bit geohash as the score:

~~~text
GEOADD drivers:available -0.1278 51.5074 driver:42
GEOSEARCH drivers:available FROMLONLAT -0.12 51.50 BYRADIUS 3 km ASC COUNT 20 WITHDIST
~~~

Design concerns:

- **Update rate**: drivers send location every 4 s; 100 K drivers = 25 K writes/s. One geo key lives on one node: shard by city or grid cell ({{drivers:{london}}}).
- **Staleness**: remove drivers who stopped reporting: a separate sorted set {{drivers:lastseen}} scored by timestamp, periodically removing stale entries from the geo set.
- **Status**: available vs busy as separate keys, moved atomically (Lua) on assignment.
- **Matching** beyond distance (ETA, rating) happens in the app on the candidate set.
- **Durability**: positions are ephemeral; trips and assignments go to the database.

For complex queries (polygons, filters), use Redis Search geo fields or PostGIS.`,
  pts: [r`GEOADD/GEOSEARCH on sorted sets`, r`Shard per city/cell`, r`Expire stale positions`, r`Atomic status moves`, r`Ephemeral vs durable data`],
  ex: r`A delivery platform kept courier positions in per-city geo keys, serving matching queries in under 2 ms at peak.`,
  fu: [r`How do you handle drivers near a city boundary?`],
  pit: [r`A single global geo key for all drivers worldwide.`] },

{ id: 'q28', level: 'Senior', tags: ['session-affinity', 'signalr'],
  dia: r`flowchart LR
  C1[Browser A] -->|WebSocket| S1[ASP.NET Core server 1]
  C2[Browser B] -->|WebSocket| S2[ASP.NET Core server 2]
  S1 -->|publish| R[(Redis Pub/Sub backplane)]
  R -->|fan-out to every server| S1
  R --> S2
  S2 -->|deliver to local connections| C2`,
  q: r`How does Redis serve as a SignalR backplane, and what are its limits?`,
  a: r`With multiple ASP.NET Core instances, a client connected to server A must receive messages sent from server B. The Redis backplane publishes every message via **Pub/Sub**; every server receives it and forwards it to its local connections.

~~~csharp
builder.Services.AddSignalR().AddStackExchangeRedis(cs, o => o.Configuration.ChannelPrefix = RedisChannel.Literal("chat"));
~~~

Limits:

- Every server receives every message: throughput is bounded by the slowest server and Redis Pub/Sub throughput; it does not scale linearly with servers.
- Pub/Sub is fire-and-forget: messages during a Redis disconnect are lost.
- Sticky sessions are still required unless clients use WebSockets only (negotiate + transport on same server).
- Redis Cluster Pub/Sub broadcasts across all nodes (sharded Pub/Sub, {{SSUBSCRIBE}} in 7.0, helps).

Alternatives at scale: **Azure SignalR Service** (offloads connections), or a dedicated messaging fan-out tier.`,
  pts: [r`Pub/Sub broadcast to all servers`, r`Messages lost on disconnect`, r`Sticky sessions`, r`Sharded Pub/Sub`, r`Azure SignalR Service at scale`],
  ex: r`A trading dashboard with 200 K connections moved from a Redis backplane to Azure SignalR Service when Pub/Sub fan-out saturated the Redis node.`,
  fu: [r`How do you guarantee delivery of important notifications?`],
  pit: [r`Using the backplane for messages that must not be lost.`] },

{ id: 'q29', level: 'Senior', tags: ['outage', 'resilience'],
  code: r`~~~csharp
// Redis is optional on the read path: short timeout, breaker, fall through with a bulkhead
builder.Services.AddResiliencePipeline("redis", p => p
    .AddTimeout(TimeSpan.FromMilliseconds(50))
    .AddCircuitBreaker(new() { FailureRatio = 0.5, MinimumThroughput = 50, BreakDuration = TimeSpan.FromSeconds(10) }));

public async Task<Product?> GetAsync(int id, CancellationToken ct)
{
    try { var hit = await _pipeline.ExecuteAsync(async t => await _db.StringGetAsync("product:v2:" + id), ct); if (hit.HasValue) return Deserialize(hit); }
    catch (Exception ex) when (ex is BrokenCircuitException or TimeoutRejectedException or RedisException) { _metrics.CacheBypass(); }
    using var lease = await _dbBulkhead.AcquireAsync(1, ct);       // cap concurrent DB fall-through
    if (!lease.IsAcquired) throw new ServiceBusyException();        // shed instead of collapsing the DB
    return await _repo.GetAsync(id, ct);
}
~~~`,
  q: r`Redis goes down. What should happen to your application?`,
  a: r`Decide per use case **before** the outage:

| Use | Behaviour on Redis outage |
|---|---|
| Cache | Fall through to the DB **with protection**: concurrency limits, L1 cache, shed non-critical traffic, or the DB collapses (cache was hiding load) |
| Sessions | Users re-authenticate; acceptable for most apps |
| Rate limiting | Fail open with local limits, or fail closed for abuse-prone endpoints |
| Locks | Jobs pause (fail closed) |
| Queues/Streams | Producers buffer or fail; use the outbox so nothing is lost |
| Feature flags | Use last known values in memory |

Implementation: short timeouts (Redis call budget of a few ms), a **circuit breaker** around Redis calls to stop hammering a failing node, metrics on fallback rates.

Test it: chaos experiments (block Redis, fail over the primary) under load. The most common surprise is the database falling over when the cache disappears; capacity-plan the DB for some cold-cache load or use a warm standby cache.`,
  pts: [r`Decide behaviour per use case`, r`Cache loss overloads the DB`, r`Short timeouts + circuit breaker`, r`Fail-open vs fail-closed`, r`Chaos test`],
  ex: r`A cache cluster failover took 90 s; the SQL database hit 100% CPU because every request missed. Concurrency limits and an L1 cache kept the next failover invisible.`,
  fu: [r`How do you warm a cold cache safely?`],
  pit: [r`Assuming "fall back to the database" works at full traffic.`] },

{ id: 'q30', level: 'Senior', tags: ['observability'],
  code: r`~~~csharp
// Client-side metrics for Redis calls via OpenTelemetry
builder.Services.AddOpenTelemetry()
    .WithTracing(t => t.AddRedisInstrumentation())       // OpenTelemetry.Instrumentation.StackExchangeRedis
    .WithMetrics(m => m.AddMeter("cache").AddOtlpExporter());
var hits = meter.CreateCounter<long>("cache.hits"); var misses = meter.CreateCounter<long>("cache.misses");
~~~
~~~bash
redis-cli INFO stats | grep -E 'keyspace_hits|keyspace_misses|evicted_keys|rejected_connections'
redis-cli INFO cpu | grep used_cpu_sys_main_thread
~~~`,
  q: r`What do you monitor on Redis in production?`,
  a: r`- **Latency**: server-side command latency (INFO commandstats, latency monitor), client-side p99 from .NET instrumentation (OpenTelemetry Redis instrumentation).
- **Memory**: used vs maxmemory, fragmentation ratio, evictions/s (unexpected evictions on a non-cache instance are an incident).
- **Hit ratio** for caches: keyspace hits/misses; sudden drops after deploys indicate key format changes.
- **Connections**: connected clients, rejected connections, blocked clients.
- **CPU**: main thread CPU near 100% means saturation regardless of host CPU.
- **Replication**: link status, offset lag, full resyncs.
- **Persistence**: last save status, fork time, AOF rewrite.
- **Slowlog** entries rate.
- **Keys**: count, expiring keys, big-key scans weekly.

Alert on: memory > 85% (or evictions on non-cache), replication broken, CPU of main thread sustained > 80%, latency SLO breach, rejected connections.`,
  pts: [r`Client and server latency`, r`Memory, evictions, fragmentation`, r`Hit ratio`, r`Main-thread CPU`, r`Replication and persistence`],
  ex: r`A hit ratio drop from 95% to 40% right after a deploy revealed a cache-key format change; rollback restored it before the DB saturated.`,
  fu: [r`Why is host CPU misleading for Redis?`],
  pit: [r`Alerting only on host metrics.`] },

{ id: 'q31', level: 'Senior', tags: ['feature-flags', 'config'],
  code: r`~~~csharp
// Local evaluation from an in-memory snapshot, refreshed by a sentinel key (Azure App Configuration)
builder.Configuration.AddAzureAppConfiguration(o => o.Connect(new Uri(endpoint), new DefaultAzureCredential())
    .UseFeatureFlags(f => f.SetRefreshInterval(TimeSpan.FromSeconds(30))));
builder.Services.AddFeatureManagement();

app.MapPost("/checkout", async (IFeatureManager features) =>
    await features.IsEnabledAsync("NewFraudCheck") ? NewFlow() : OldFlow());   // no network call per check
~~~`,
  q: r`Is Redis a good store for feature flags and configuration?`,
  a: r`It can serve them fast, but the requirements matter more than speed:

- **Reads**: every request checks flags; read from an **in-memory snapshot** in each pod, refreshed via Pub/Sub or polling, not a Redis call per check.
- **Durability and audit**: flags change production behaviour; changes need an audit trail, approvals, and history. Redis alone gives none; keep the source of truth in a database or a flag service (LaunchDarkly, Azure App Configuration, AWS AppConfig) with Redis or the SDK cache as distribution.
- **Availability**: if Redis is down, use last-known values; never default to "on" for risky features.
- **Targeting rules** (percentages, tenants) evaluated locally with consistent hashing on user id.

Microsoft.FeatureManagement with Azure App Configuration gives a .NET-native approach with sentinel-key refresh.`,
  pts: [r`Local snapshot per pod`, r`Source of truth with audit elsewhere`, r`Last-known values on outage`, r`Local evaluation of targeting`],
  ex: r`A flag stored only in Redis was flipped by a script during an incident; nobody could tell who changed what. Moving to App Configuration added audit and approvals.`,
  fu: [r`How do you roll out a flag to 5% of users consistently?`],
  pit: [r`Calling Redis for every flag check in a hot path.`] },

{ id: 'q32', level: 'Senior', tags: ['probabilistic'],
  code: r`~~~csharp
await db.HyperLogLogAddAsync("uniq:cards:merchant:77:2026-10-10", cardFingerprint);
long distinctCards = await db.HyperLogLogLengthAsync("uniq:cards:merchant:77:2026-10-10");
await db.HyperLogLogMergeAsync("uniq:cards:merchant:77:2026-W41", weekDayKeys);

// Bloom filter (Redis Stack / Redis 8): skip DB lookups for ids that certainly do not exist
await db.ExecuteAsync("BF.RESERVE", "bf:order-ids", "0.001", "100000000");
await db.ExecuteAsync("BF.ADD", "bf:order-ids", orderId);
bool mightExist = (int)await db.ExecuteAsync("BF.EXISTS", "bf:order-ids", requestedId) == 1;
~~~`,
  q: r`When would you use HyperLogLog, Bloom filters or Count-Min sketches?`,
  a: r`Probabilistic structures trade exactness for tiny, fixed memory:

- **HyperLogLog** ({{PFADD}}, {{PFCOUNT}}, {{PFMERGE}}): approximate distinct counts with ~0.81% standard error in 12 KB, mergeable across days/regions. Daily unique visitors, unique cards per merchant.
- **Bloom filter** ({{BF.ADD}}, {{BF.EXISTS}} in Redis Stack/8): "definitely not present" or "probably present". Avoid DB lookups for non-existent keys (cache penetration protection), check whether a username might be taken, dedupe crawled URLs. False positive rate configurable; no deletes (use Cuckoo filter if needed).
- **Count-Min sketch** / **Top-K**: approximate frequencies and heavy hitters (hot keys, top merchants by volume) in bounded memory.

Use them where an approximate answer is acceptable and say so in the requirements; never for money or authorisation.`,
  pts: [r`HLL: distinct counts, 12 KB, mergeable`, r`Bloom: no false negatives`, r`Count-Min / Top-K for heavy hitters`, r`Not for exact business decisions`],
  ex: r`A fraud team tracked distinct cards per device per day with HLL across 200 M devices for a fraction of the memory of sets.`,
  fu: [r`How does a Bloom filter prevent cache penetration?`],
  pit: [r`Using HLL where an exact count is legally required.`] },

{ id: 'q33', level: 'Senior', tags: ['cache-penetration'],
  code: r`~~~csharp
// Penetration: cache the miss briefly
var cached = await db.StringGetAsync("order:" + id);
if (cached == "__NULL__") return null;
if (cached.HasValue) return Deserialize(cached);
var order = await repo.FindAsync(id, ct);
await db.StringSetAsync("order:" + id, order is null ? "__NULL__" : Serialize(order),
    order is null ? TimeSpan.FromSeconds(60) : TimeSpan.FromMinutes(10) + Jitter());
return order;
~~~`,
  q: r`Explain cache penetration, cache breakdown and cache avalanche, with fixes.`,
  a: r`- **Penetration**: requests for keys that exist neither in cache nor DB (often malicious, random ids) always hit the DB. Fixes: cache **negative results** briefly ({{product:999 = NULL}} with a 60 s TTL), Bloom filter of valid ids, input validation, rate limiting.
- **Breakdown (hot key expiry)**: one very hot key expires and the herd hits the DB. Fixes: single-flight, early refresh, never-expire for hot keys with event-driven refresh.
- **Avalanche**: many keys expire at once (same TTL) or the cache cluster fails, so the DB receives the full load. Fixes: TTL jitter, multi-AZ replicated cache, L1 caches, DB-side protection (bulkheads, load shedding), warm-up procedures.

Name them as distinct failure modes with distinct fixes; interviewers often probe whether you mix them up.`,
  pts: [r`Penetration: missing keys → negative caching, Bloom`, r`Breakdown: hot key → single-flight`, r`Avalanche: mass expiry/outage → jitter, HA, shedding`],
  ex: r`A bot enumerating random order ids pushed 20 K QPS to the DB; negative caching plus rate limiting by client cut it to near zero.`,
  fu: [r`How long should a negative cache entry live?`],
  pit: [r`Caching negative results forever (new items invisible).`] },

{ id: 'q34', level: 'Senior', tags: ['serialization', 'dotnet'],
  code: r`~~~csharp
[JsonSerializable(typeof(Product))]
internal partial class CacheJson : JsonSerializerContext { }

var bytes = JsonSerializer.SerializeToUtf8Bytes(product, CacheJson.Default.Product);  // source-generated, AOT-safe
await db.StringSetAsync("product:v3:" + product.Id, bytes, TimeSpan.FromMinutes(10)); // version in the key
var p = JsonSerializer.Deserialize(await db.StringGetAsync("product:v3:" + id), CacheJson.Default.Product);

// HybridCache: plug a serializer per type
builder.Services.AddHybridCache().AddSerializer<Product, ProtobufSerializer<Product>>();
~~~`,
  q: r`How should you serialize objects for Redis from .NET?`,
  a: r`- **System.Text.Json** with source generators: fast, no reflection, trim/AOT friendly. Good default.
- **MessagePack** or **protobuf**: smaller and faster for high-volume caches.
- **Compression** (Brotli/LZ4) for values over a few KB; measure CPU vs memory/bandwidth saved.
- **Versioning**: include a schema version in the key ({{product:v3:42}}) so deploys with changed shapes do not deserialize old values incorrectly; old keys expire naturally.
- **Hashes** instead of blobs when you update individual fields frequently.
- Never use {{BinaryFormatter}} (removed in .NET 9; insecure deserialization).
- HybridCache lets you plug {{IHybridCacheSerializer}} per type.

Big values block the multiplexer pipe; keep values small (under ~100 KB) or split.`,
  pts: [r`STJ source-gen default`, r`MessagePack/protobuf for volume`, r`Version in the key`, r`No BinaryFormatter`, r`Keep values small`],
  ex: r`A deploy that renamed a property caused deserialization of old cached values to null out prices; versioned keys prevented recurrence.`,
  fu: [r`How do you roll out a cache format change with zero errors?`],
  pit: [r`Sharing a cached type across services that deploy independently.`] },

{ id: 'q35', level: 'Senior', tags: ['multi-region'],
  code: r`~~~csharp
// Per-region share of a global limit instead of cross-region coordination
var regionWeight = new Dictionary<string, double> { ["eu-west-1"] = 0.5, ["us-east-1"] = 0.35, ["ap-southeast-1"] = 0.15 };
int regionalLimit = (int)Math.Ceiling(10_000 * regionWeight[currentRegion]);
bool allowed = await _limiter.TryAcquireAsync("rl:" + tenantId + ":" + currentRegion, regionalLimit, TimeSpan.FromMinutes(1));
~~~`,
  dia: r`flowchart LR
  subgraph EU[eu-west-1]
    A1[API] --> C1[(Regional cache)]
    A1 --> D1[(Regional DB replica)]
  end
  subgraph US[us-east-1]
    A2[API] --> C2[(Regional cache)]
    A2 --> D2[(Regional DB replica)]
  end
  BUS[Global event bus] -->|invalidate key| C1
  BUS -->|invalidate key| C2
  P[(Primary DB)] -->|CDC| BUS`,
  q: r`How do you use Redis in a multi-region active-active architecture?`,
  a: r`Options:

- **Regional caches, no replication**: each region has its own cache filled from its regional DB replica. Simplest; invalidations must be published to every region (via a global event bus or CDC per region).
- **Global datastore with one writer** (ElastiCache Global Datastore): primary region writes, secondary regions read with ~1 s lag; promote on regional failure.
- **Active-active CRDT** (Redis Enterprise / Azure Managed Redis active geo-replication): writes in any region, conflict-free replicated data types merge (counters add, sets union, strings last-writer-wins).

Guidance: caches rarely need cross-region replication; rebuild from regional data. For counters and rate limits that must be global, use CRDTs or accept per-region limits (limit/N per region). Never rely on cross-region Redis for strongly consistent state (locks, balances).`,
  pts: [r`Regional caches + broadcast invalidation`, r`Global Datastore single writer`, r`CRDT active-active`, r`Per-region limits`, r`No cross-region locks`],
  ex: r`A global API split a 10,000 req/min tenant limit into per-region quotas weighted by traffic, avoiding cross-region coordination.`,
  fu: [r`How do CRDT counters resolve concurrent increments?`],
  pit: [r`A distributed lock spanning regions through replicated Redis.`] },

{ id: 'q36', level: 'Senior', tags: ['vector', 'ai'],
  code: r`~~~csharp
// Semantic cache lookup scoped by tenant and prompt version (Redis Query Engine vector index)
// FT.CREATE idx:semcache ON HASH PREFIX 1 sc: SCHEMA tenant TAG promptVer TAG vec VECTOR HNSW 6 TYPE FLOAT32 DIM 1536 DISTANCE_METRIC COSINE
float[] q = await embeddings.EmbedAsync(userPrompt, ct);
var res = await db.ExecuteAsync("FT.SEARCH", "idx:semcache",
    "(@tenant:{" + tenantId + "} @promptVer:{v7})=>[KNN 1 @vec $B AS dist]",
    "PARAMS", "2", "B", ToBytes(q), "RETURN", "2", "answer", "dist", "DIALECT", "2");
// accept only if dist < 0.08 (threshold tuned on a labelled evaluation set)
~~~`,
  q: r`Can Redis serve as a vector store or semantic cache for LLM applications?`,
  a: r`Yes. Redis Query Engine (Redis Stack / Redis 8) supports vector fields with FLAT or HNSW indexes, and **Vector Sets** were added in Redis 8. Uses:

- **Semantic cache**: embed the user prompt, search for a previous prompt within a similarity threshold, return its cached answer. Cuts LLM cost and latency for repeated questions. Risks: a too-loose threshold returns wrong answers; cache must be scoped by tenant, user permissions and model/prompt version; personal data in prompts needs TTLs.
- **RAG retrieval** for small to medium corpora with low latency, combined with metadata filters (tenant, document type).
- **Conversation memory**: recent turns per session with TTL.

Trade-offs vs pgvector or a dedicated vector DB: memory cost (everything in RAM), fewer features for large-scale ANN tuning, but excellent latency.`,
  pts: [r`Vector index in Redis Query Engine`, r`Semantic cache with similarity threshold`, r`Scope by tenant and model version`, r`Memory cost`],
  ex: r`An internal HR assistant's semantic cache answered 35% of queries without an LLM call, after tuning the threshold to avoid mismatched answers.`,
  fu: [r`How would you evaluate a semantic cache's precision?`],
  pit: [r`A global semantic cache that leaks one user's answer to another.`] },

{ id: 'q37', level: 'Principal', tags: ['architecture-decision'],
  code: r`~~~text
ADR-031: Orders service system of record
Decision: Aurora PostgreSQL is the system of record. Redis (ElastiCache) caches order status (TTL 60 s)
          and holds the idempotency fast-path.
Rejected: Redis as primary (async replication can drop acknowledged writes on failover; RAM cost of
          multi-year history; no ad hoc queries for support/reporting).
Revisit if: p99 write latency requirement < 2 ms at > 50 K TPS -> evaluate MemoryDB with RPO 0.
~~~`,
  q: r`A team wants to use Redis as the primary database for a new orders service. Your response?`,
  a: r`Assess against requirements rather than reacting:

- **Durability**: orders are business records. Standard Redis replication is async; AOF everysec loses up to a second; failover can drop acknowledged writes. **MemoryDB** fixes durability (multi-AZ transactional log) at higher write latency and cost.
- **Query needs**: orders need lookups by customer, status, date ranges, reporting. Redis requires hand-built secondary indexes (sorted sets) that you must keep consistent, or Redis Query Engine.
- **Data volume and cost**: everything in RAM; years of orders get expensive versus disk-based databases.
- **Operational maturity**: backups, PITR, audit, schema evolution, tooling for support teams.
- **Team skill**.

Recommendation usually: PostgreSQL/SQL Server/DynamoDB as the system of record, Redis for caching hot order status and idempotency fast-path. If extreme latency truly requires Redis as primary, choose MemoryDB, define RPO/RTO explicitly, keep an event stream to a durable store for audit and analytics, and document it in an ADR.`,
  pts: [r`Durability and RPO`, r`Query and index needs`, r`RAM cost over time`, r`Ops and audit`, r`MemoryDB if truly needed`],
  ex: r`A team that used Redis as an order store lost 2 minutes of orders during a failover; the business impact justified moving to a durable database within a quarter.`,
  fu: [r`What evidence would change your recommendation?`],
  pit: [r`Saying "Redis cannot persist" (it can; the issue is guarantees).`] },

{ id: 'q38', level: 'Principal', tags: ['system-design', 'design'],
  code: r`~~~csharp
// Different volatility, different layers
app.MapGet("/products/{id:int}", async (int id, HybridCache cache, ICatalog catalog, HttpContext http, CancellationToken ct) =>
{
    var p = await cache.GetOrCreateAsync("product:v2:" + id, t => catalog.GetAsync(id, t),
        new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(10), LocalCacheExpiration = TimeSpan.FromSeconds(20) },
        tags: ["product:" + id], cancellationToken: ct);
    http.Response.Headers.CacheControl = "public, max-age=30, stale-while-revalidate=60";   // CDN layer
    http.Response.Headers["Surrogate-Key"] = "product-" + id;                               // targeted purge
    return Results.Ok(new { p.Id, p.Name, p.Price, StockBand = p.Stock > 10 ? "in-stock" : p.Stock > 0 ? "low" : "out" });
});
// price change event: await cache.RemoveByTagAsync("product:" + id); await cdn.PurgeAsync("product-" + id);
~~~`,
  q: r`Design the caching strategy for a high-traffic e-commerce product page (100 K req/s peak).`,
  a: r`Layered caches, each absorbing most of the traffic:

1. **CDN** for static assets and, where possible, the anonymous product HTML/JSON with short TTL (30 to 60 s) and surrogate-key purge on change.
2. **API gateway / response cache** for identical anonymous API responses.
3. **L1 in-process** (HybridCache, 10 to 30 s) in each pod for product, price, availability summary.
4. **L2 Redis** cluster for product documents (10 min TTL with jitter), versioned keys.
5. **Database / services** for misses only.

Data split by volatility: product content (minutes OK), price (seconds; invalidated by price events), stock (show "in stock / low stock" bands from cache; the exact check happens at checkout against the inventory service, never from cache).

~~~mermaid
flowchart LR
  U[Users] --> CDN
  CDN --> GW[API gateway]
  GW --> API[Product API pods + L1]
  API --> RC[(Redis cluster L2)]
  API --> DB[(Catalogue DB)]
  EV[Price/stock events] --> INV[Invalidator]
  INV --> RC
  INV --> CDN
~~~

Protection: single-flight, TTL jitter, negative caching for bad ids, concurrency limits to the DB. Measure hit ratio at each layer and DB QPS at peak.`,
  pts: [r`CDN → L1 → Redis → DB`, r`Split by volatility`, r`Exact stock checked at checkout`, r`Event-driven invalidation including CDN`, r`Stampede protection`],
  ex: r`During Black Friday, the CDN absorbed 80%, L1 15%, Redis 4.9% and the DB saw 0.1% of product traffic.`,
  fu: [r`How do personalised prices affect caching?`],
  pit: [r`Caching exact stock and selling from the cached value.`] },

{ id: 'q39', level: 'Principal', tags: ['cost'],
  code: r`~~~bash
# Memory by key prefix from an RDB snapshot (redis-rdb-tools style analysis)
rdb -c memory dump.rdb --bytes 1024 -f mem.csv
awk -F, 'NR>1 { split($3, p, ":"); s[p[1]] += $4 } END { for (k in s) print s[k], k }' mem.csv | sort -rn | head
# Keys without TTL (sampled)
redis-cli --scan --count 1000 | head -100000 | while read k; do [ "$(redis-cli TTL "$k")" = "-1" ] && echo "$k"; done | cut -d: -f1 | sort | uniq -c | sort -rn
~~~`,
  q: r`Your Redis bill doubled in a year. How do you bring it down?`,
  a: r`1. **Inventory**: which clusters, which services, what data types, memory by key prefix (RDB analysis), hit ratios, peak CPU.
2. **Common findings**:

- Keys without TTL accumulating (old sessions, abandoned carts, idempotency keys from years ago).
- Low hit-ratio caches: data cached that is rarely read twice; remove or shorten TTL.
- Oversized replicas: three replicas where one suffices for availability.
- Big JSON blobs instead of compact encodings; no compression.
- Non-production clusters sized like production and running 24/7.
- Persistence on pure caches (extra memory headroom for fork).

3. **Levers**: TTL policy enforced in the client library, reserved nodes, Valkey-based tiers (cheaper), data tiering (ElastiCache r6gd with SSD for cold values), right-sizing after cleanup, consolidating small clusters.
4. **Governance**: per-team cost showback, key-prefix ownership, alerts on keys without TTL.

Report savings against a baseline and keep the SLOs unchanged.`,
  pts: [r`Memory by prefix analysis`, r`Keys without TTL`, r`Low hit-ratio caches`, r`Valkey, reserved nodes, data tiering`, r`Showback and ownership`],
  ex: r`An analysis found 40% of memory was idempotency keys with no TTL from three years of traffic; adding a 48 h TTL halved the cluster.`,
  fu: [r`How do you safely add TTLs to existing keys?`],
  pit: [r`Scaling down without understanding the working set (hit ratio collapses).`] },

{ id: 'q40', level: 'Principal', tags: ['incident', 'postmortem'],
  code: r`~~~csharp
// Connect to the cluster configuration endpoint, never a node address
var opts = ConfigurationOptions.Parse("payments-cache.abc123.clustercfg.euw1.cache.amazonaws.com:6379,ssl=true,abortConnect=false");
opts.ReconnectRetryPolicy = new ExponentialRetry(deltaBackOffMilliseconds: 500, maxDeltaBackOffMilliseconds: 10_000);
opts.ConnectTimeout = 3000; opts.AsyncTimeout = 1000;
var mux = await ConnectionMultiplexer.ConnectAsync(opts);
mux.ConnectionFailed += (_, e) => log.LogWarning("Redis connection failed {Endpoint} {Type}", e.EndPoint, e.FailureType);
~~~
~~~bash
# Monthly staging drill
aws elasticache test-failover --replication-group-id payments-cache --node-group-id 0001
~~~`,
  q: r`A Redis failover caused a 20-minute outage although failover itself took 30 seconds. Lead the postmortem.`,
  a: r`Reconstruct the timeline, then ask why recovery took 19.5 minutes longer than the infrastructure:

Likely contributing factors:

- **Client reconnection**: clients cached the old primary IP (DNS TTL, connection strings pointing at a node rather than the configuration endpoint), or the multiplexer did not reconfigure (old StackExchange.Redis versions, {{abortConnect=true}} after restarts).
- **Cold cache / DB overload**: the new primary was empty if replication had broken earlier (nobody alerted), so all traffic hit the DB, which saturated.
- **Retry storms**: tight retry loops from hundreds of pods amplified load.
- **Thread-pool starvation** in .NET from sync Redis calls during timeouts.

Actions (owner, date):

- Use cluster/configuration endpoints, current client versions, test failover in staging monthly.
- Alert on replication link down and on hit ratio.
- Exponential backoff with jitter and circuit breakers.
- DB protection under cache loss (bulkheads, L1).
- Async-only Redis usage enforced via analyzers.

Blameless framing: the system allowed a 30-second event to become a 20-minute outage; fix the system.`,
  pts: [r`Explain the gap between infra and user recovery`, r`Client endpoint and reconnection`, r`Replication health alerting`, r`Retry storms`, r`Concrete owned actions`],
  ex: r`Monthly failover drills in staging reduced user-visible impact of a production failover from 20 minutes to under 1 minute.`,
  fu: [r`How do you test failover regularly without risk?`],
  pit: [r`Concluding "Redis failed" without client-side analysis.`] },

{ id: 'q41', level: 'Principal', tags: ['platform', 'governance'],
  code: r`~~~csharp
// Shared package: prefixes and TTLs are not optional
public sealed class OwnedCache(IDatabase db, string servicePrefix)
{
    public Task<bool> SetAsync(string key, RedisValue value, TimeSpan ttl) =>
        ttl <= TimeSpan.Zero ? throw new ArgumentException("TTL required") : db.StringSetAsync(servicePrefix + ":" + key, value, ttl);
    public Task<RedisValue> GetAsync(string key) => db.StringGetAsync(servicePrefix + ":" + key);
}
services.AddOwnedRedisCache("orders");   // registers multiplexer, OpenTelemetry, TLS, ACL creds from Secrets Manager
~~~`,
  q: r`How do you standardise Redis usage across many teams?`,
  a: r`- **Shared client package**: configures the multiplexer (singleton, timeouts, TLS, ACL creds from secret store, OpenTelemetry), enforces **key prefixes** per service, requires TTLs (API without TTL needs explicit opt-out), and provides HybridCache defaults.
- **Instance separation by purpose**: caches (allkeys-lfu, no persistence) vs state (noeviction, AOF, replicas). No mixed instances.
- **Provisioning module**: Terraform for ElastiCache/Azure with multi-AZ, encryption, alarms, parameter groups.
- **Guidelines** with examples: cache-aside, stampede protection, idempotency limits, lock caveats (efficiency vs correctness).
- **Reviews** only for new state-bearing uses (locks, queues, primary data), not for caches.
- **Monitoring** dashboards per cluster and per key prefix; big-key scans weekly.
- **Cost showback** per service.`,
  pts: [r`Shared client with prefixes and TTLs`, r`Cache vs state instances`, r`Terraform paved road`, r`Guidelines on locks and idempotency`, r`Showback`],
  ex: r`Mandatory key prefixes made it possible to attribute 100% of memory to owners and cut unowned keys to zero.`,
  fu: [r`How do you migrate existing services to the shared package?`],
  pit: [r`One giant shared Redis for every team.`] },

{ id: 'q42', level: 'Principal', tags: ['fintech', 'design'],
  code: r`~~~csharp
// Velocity check: cards per device in a sliding hour (sorted set by timestamp)
var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
var key = "vel:device:" + deviceId;
var batch = db.CreateBatch();
_ = batch.SortedSetRemoveRangeByScoreAsync(key, 0, now - 3_600_000);
_ = batch.SortedSetAddAsync(key, cardToken, now);           // token, never the PAN
var countTask = batch.SortedSetLengthAsync(key);
_ = batch.KeyExpireAsync(key, TimeSpan.FromHours(2));
batch.Execute();
if (await countTask > 5) return RiskDecision.Review;          // accelerates the decision; the ledger decides money
~~~`,
  dia: r`flowchart LR
  T[Card transaction] --> F[Fraud service]
  F -->|velocity, device features| R[(Redis)]
  F -->|score| A[Authorisation service]
  A -->|holds, balances| L[(Relational ledger)]
  A --> PSP[Card network]`,
  q: r`In a payments platform, where is Redis appropriate and where is it dangerous?`,
  a: r`**Appropriate**:

- Rate limiting and velocity checks for fraud (cards per device per hour), with HLL/sorted sets, accepting rare inaccuracy on failover.
- Caching reference data (BIN tables, merchant configuration, FX rates with timestamps).
- Idempotency fast-path in front of the DB constraint.
- Session state and short-lived tokens (3-D Secure challenge state) with TTLs.
- Real-time dashboards and feature flags distribution.

**Dangerous**:

- Balances, ledger entries, authorisation holds as the only copy.
- Locks protecting money movement without DB-level fencing.
- Caching card data (PAN) at all: expands PCI scope; use tokens.
- Stale FX rates used for pricing without timestamp checks.

Principle: Redis can **accelerate** decisions and **filter** traffic; the **system of record** decides money movement.`,
  pts: [r`Velocity checks and rate limits`, r`Reference data caching`, r`Never the only copy of balances`, r`No PAN in Redis`, r`Accelerate, do not decide`],
  ex: r`A fraud engine computed velocity features in Redis at 50 K TPS; settlement and balances lived in a relational ledger.`,
  fu: [r`How would you make the velocity counters survive a failover?`],
  pit: [r`Authorising payments against a cached balance.`] },

{ id: 'q43', level: 'Principal', tags: ['licensing', 'strategy'],
  code: r`~~~bash
# Compatibility smoke test against Valkey before switching engines
docker run -d --name valkey -p 6380:6379 valkey/valkey:8.0
dotnet test tests/Cache.IntegrationTests -e REDIS_CONNECTION=localhost:6380
# list modules used today: anything here needs a separate plan
redis-cli MODULE LIST
~~~`,
  q: r`How should an organisation respond to Redis licensing changes (Redis vs Valkey)?`,
  a: r`Context: in 2024 Redis moved from BSD to source-available licences (RSALv2/SSPL), prompting the Linux Foundation **Valkey** fork backed by AWS, Google and others. In 2025 Redis 8 added AGPLv3 as an option. Managed providers now offer Valkey (often cheaper) and Redis-compatible services.

Principal-level response:

1. **Assess exposure**: do you self-host, embed Redis in a product you distribute, or offer it as a service? Most internal users of managed services are unaffected legally.
2. **Feature dependencies**: modules (Search, JSON, TimeSeries) and Redis 8 features vs what Valkey supports (Valkey has its own additions); client compatibility (StackExchange.Redis works with both).
3. **Cost**: Valkey tiers on ElastiCache are priced lower.
4. **Decision**: for plain caching, Valkey is a low-risk migration (wire compatible); for module-heavy uses, evaluate carefully.
5. **Avoid lock-in in code**: stick to core commands behind an abstraction where feasible.

Involve legal for distribution scenarios; document as an ADR.`,
  pts: [r`Licence change and Valkey fork`, r`Assess exposure by usage model`, r`Module dependencies`, r`Cost advantage`, r`Legal review for distribution`],
  ex: r`A company moved 30 ElastiCache clusters to Valkey with a configuration change, saving about 20%, while keeping one Redis Enterprise cluster for search modules.`,
  fu: [r`What tests prove compatibility before migration?`],
  pit: [r`Panic migration without checking module usage.`] },

{ id: 'q44', level: 'Principal', tags: ['interview-scenario'],
  code: r`~~~csharp
// The proposal (dangerous): key ignores the tenant/user, so results leak across callers
public class AutoCacheInterceptor : DbCommandInterceptor { /* key = hash(CommandText + parameters) */ }

// Explicit, owned caching for one hot, stale-tolerant query instead
public Task<IReadOnlyList<PriceListRow>> GetPriceListAsync(TenantId tenant, CancellationToken ct) =>
    _cache.GetOrCreateAsync("pricelist:" + tenant.Value, t => _repo.LoadAsync(tenant, t),
        new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(5) }, tags: ["pricelist:" + tenant.Value], cancellationToken: ct).AsTask();
~~~`,
  q: r`An engineer proposes caching all database queries automatically with a generic interceptor. Review it.`,
  a: r`Concerns:

- **Invalidation**: a generic cache does not know which writes affect which queries; staleness becomes unbounded or invalidation becomes "flush everything".
- **Correctness**: queries inside transactions, permission-filtered queries (user A's results served to user B if the key misses user context), and read-after-write flows break.
- **Low hit ratio**: most queries with unique parameters are never reused; memory wasted.
- **Security**: sensitive data copied into Redis without classification.
- **Debuggability**: bugs that disappear when caches are flushed.

Counter-proposal: profile first (which queries are hot, repeated and tolerant of staleness), then **explicit** caching for those few with clear keys, TTLs and invalidation owners; use HybridCache with tags for grouped invalidation; EF Core second-level caching only for reference data. Agree measurable goals (DB CPU -40%, p99 -30%).

Deliver as a design discussion with data, acknowledging the goal (reduce DB load).`,
  pts: [r`Generic caching breaks invalidation`, r`Authorisation leakage risk`, r`Low hit ratio`, r`Profile then cache explicitly`, r`Measurable goals`],
  ex: r`A generic interceptor in a B2B portal served one customer's price list to another because the cache key ignored the tenant claim.`,
  fu: [r`Where would EF Core second-level caching be reasonable?`],
  pit: [r`Approving it because it is easy to implement.`] },

{ id: 'q45', level: 'Principal', tags: ['kubernetes'],
  code: r`~~~yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: redis-pdb }
spec:
  maxUnavailable: 1
  selector: { matchLabels: { app: redis } }
---
# StatefulSet excerpt: spread across zones, guaranteed QoS
spec:
  template:
    spec:
      topologySpreadConstraints:
        - { maxSkew: 1, topologyKey: topology.kubernetes.io/zone, whenUnsatisfiable: DoNotSchedule, labelSelector: { matchLabels: { app: redis } } }
      containers:
        - name: redis
          image: redis:7.4
          args: ["--maxmemory", "3gb", "--maxmemory-policy", "allkeys-lfu", "--save", ""]
          resources: { requests: { memory: 4Gi, cpu: "1" }, limits: { memory: 4Gi, cpu: "1" } }
~~~`,
  q: r`Should you run Redis on Kubernetes yourself?`,
  a: r`It is possible (operators, StatefulSets, persistent volumes) but consider:

- **Statefulness**: pod rescheduling, PV attachment across zones, and node drains interact with Redis failover; misconfigured disruption budgets cause simultaneous loss of primary and replica.
- **Memory limits**: container OOM kills if maxmemory headroom is wrong; fork doubles memory under writes.
- **Networking**: cluster mode clients need stable addressing ({{cluster-announce-ip}}), which is awkward with pod IPs.
- **Operations**: upgrades, backups, monitoring, security patching are now yours.

Reasonable uses: ephemeral caches per environment, dev/test, sidecar caches, or a strong platform team with an operator they trust. For production state and shared caches, managed services usually cost less once engineering time is counted.

If you do it: dedicated node pool, anti-affinity across zones, PodDisruptionBudgets, guaranteed QoS (requests = limits), no persistence for caches, and failover drills.`,
  pts: [r`Stateful complexity`, r`OOM and fork headroom`, r`Cluster addressing`, r`Ops burden`, r`Managed for production state`],
  ex: r`A team's self-hosted Redis lost both primary and replica during a node pool upgrade because anti-affinity and PDBs were missing.`,
  fu: [r`How do you calculate total cost of ownership?`],
  pit: [r`Running production Redis as a Deployment without persistence planning.`] },

{ id: 'q46', level: 'Principal', tags: ['leadership'],
  code: r`~~~text
Cache proposal checklist (PR template section)
[ ] Measured problem: p95 = ___ ms / DB CPU = ___%  (query/index fixes tried? ___)
[ ] Read:write ratio = ___ : 1
[ ] Staleness budget = ___ s, invalidation owner = ___
[ ] Cold-cache test: DB survives ___ x traffic with empty cache? (load test link)
[ ] Contains permissions/PII? key scoped by tenant/user? TTL = ___
[ ] Success metric: hit ratio >= ___% on the dashboard ___
~~~`,
  q: r`How do you teach teams when not to cache?`,
  a: r`Give a decision checklist, because "add a cache" is a reflex fix:

1. Is there a measured problem (latency, DB load, cost)? Fix the query/index first.
2. Is the data read many times per write (high read:write ratio)?
3. What staleness is acceptable, and who owns invalidation?
4. What happens if the cache is empty or wrong? Can the DB survive cold-cache load?
5. Does the cached data carry permissions or personal data?
6. How will we know it works (hit ratio target, metrics)?

Do not cache: data used for authorisation or money decisions, rarely repeated queries, highly personalised data with low reuse, or data whose invalidation nobody owns.

Reinforce with reviews, an internal guide with incidents as examples, and dashboards showing hit ratios so useless caches are visible.`,
  pts: [r`Caching as a reflex is risky`, r`Checklist before caching`, r`Cold-cache survivability`, r`Permissions in cached data`, r`Make hit ratios visible`],
  ex: r`Publishing hit ratios per cache led teams to delete 11 caches with under 10% hit ratio, removing complexity and cost.`,
  fu: [r`How do you get buy-in without being a gatekeeper?`],
  pit: [r`Treating caching as free performance.`] },

{ id: 'q47', level: 'Principal', tags: ['capacity-planning'],
  code: r`~~~bash
memtier_benchmark -s redis.internal -p 6379 --tls --protocol=resp3 \
  --data-size=2048 --ratio=1:9 --pipeline=8 -c 50 -t 8 --test-time=300 --key-pattern=G:G
~~~
~~~text
Keys 120 M x (avg value 600 B + ~90 B overhead) = ~83 GB
+ 20% fragmentation = 100 GB; target <= 70% used -> 143 GB of node memory
r7g.xlarge (~26 GB usable) -> 6 shards by memory
Throughput: 900 K ops/s peak / ~150 K ops/s per shard at 70% -> 6 shards by CPU
Plan 8 shards (lose a node + resharding headroom), 1 replica each
~~~`,
  q: r`How do you capacity-plan a Redis cluster?`,
  a: r`Inputs: key count and average value size by prefix, growth rate, ops/s by command type at peak, payload sizes, replication factor, persistence mode.

Memory: data + overhead (~50 to 100 bytes per key for dict entries and metadata, more for small objects) + fragmentation (10 to 30%) + replication and client output buffers + fork copy-on-write headroom if persisting (up to 2× under heavy writes). Keep used memory under ~70 to 75% of node memory.

CPU: Redis main thread per shard; plan peak ops per shard under ~70% of measured capacity for your command mix (benchmark with {{memtier_benchmark}} using realistic value sizes and pipelining).

Network: large values make bandwidth the limit before CPU.

Shards = max(memory-driven, throughput-driven) count, plus headroom for losing a node and for resharding. Re-evaluate quarterly from metrics.`,
  pts: [r`Per-key overhead and fragmentation`, r`Fork headroom`, r`Ops per shard on one core`, r`Benchmark realistic sizes`, r`Max of memory and throughput needs`],
  ex: r`A capacity model predicted network saturation before memory for 8 KB values at peak; the team compressed values and avoided adding shards.`,
  fu: [r`What is the cost of resharding live?`],
  pit: [r`Sizing by raw data size alone.`] },

{ id: 'q48', level: 'Principal', tags: ['architecture-decision'],
  code: r`~~~csharp
// Producers write to an outbox; the relay owns the transport, so the backbone can change
public interface IEventTransport { Task PublishAsync(OutboxMessage m, CancellationToken ct); }
public sealed class RedisStreamTransport(IDatabase db) : IEventTransport
{
    public Task PublishAsync(OutboxMessage m, CancellationToken ct) =>
        db.StreamAddAsync("events:" + m.Topic, [new("id", m.Id.ToString()), new("body", m.Payload)], maxLength: 1_000_000, useApproximateMaxLength: true);
}
public sealed class KafkaTransport(IProducer<string, string> p) : IEventTransport
{
    public Task PublishAsync(OutboxMessage m, CancellationToken ct) =>
        p.ProduceAsync(m.Topic, new Message<string, string> { Key = m.AggregateId, Value = m.Payload }, ct);
}
~~~`,
  q: r`Redis Streams, Kafka or RabbitMQ for a new event backbone? Make the call.`,
  a: r`| Need | Redis Streams | Kafka | RabbitMQ |
|---|---|---|---|
| Durability / retention | Memory-bound, short retention | Disk, days to forever, replay | Disk, until consumed |
| Throughput | High per node, single key per stream | Very high, partitioned | High |
| Ordering | Per stream | Per partition | Per queue |
| Replay / new consumers | Limited by retention | Native | No (once consumed) |
| Routing | Minimal | Topics/partitions | Rich exchanges |
| Ops | Easy if Redis exists | Heavier (managed: MSK, Confluent, Event Hubs) | Moderate |

For an **organisation-wide event backbone** (many consumers, replay, audit, analytics): **Kafka** (managed). For **task queues** with routing and per-message acks: RabbitMQ or SQS/Service Bus. Redis Streams fit **local, low-latency, modest-volume** work queues inside a service that already runs Redis.

State the decision, the reversal condition, and the migration path (abstract producers behind an outbox so changing transports is contained).`,
  pts: [r`Kafka for backbone and replay`, r`RabbitMQ/SQS for task queues`, r`Streams for local modest workloads`, r`Outbox abstraction eases change`],
  ex: r`A team started with Redis Streams for notifications; when audit replay became a requirement, they moved to Kafka via the outbox relay with no producer changes.`,
  fu: [r`What would make you choose Streams for a core flow?`],
  pit: [r`Choosing Redis Streams because "we already have Redis" for a durable backbone.`] },

{ id: 'q49', level: 'Principal', tags: ['code-review'],
  q: r`Code review: find the problems in this caching code.`,
  a: r`~~~csharp
public async Task<Account> GetAccount(int id)
{
    var redis = ConnectionMultiplexer.Connect(_cs);
    var db = redis.GetDatabase();
    var json = db.StringGet("account" + id);
    if (json.HasValue) return JsonSerializer.Deserialize<Account>(json);
    var acc = await _repo.Load(id);
    db.StringSet("account" + id, JsonSerializer.Serialize(acc));
    return acc;
}
public async Task Withdraw(int id, decimal amt)
{
    var acc = await GetAccount(id);
    if (acc.Balance < amt) throw new InvalidOperationException();
    await _repo.UpdateBalance(id, acc.Balance - amt);
}
~~~

1. **Connect per call**: socket and thread exhaustion; use a singleton multiplexer.
2. **Sync calls** ({{StringGet}}, {{StringSet}}) inside async code: thread-pool starvation under load.
3. **No TTL**: values live forever; balances never refresh.
4. **Money decision on cached data**: Withdraw reads a possibly stale cached balance, then writes {{balance - amt}}: lost updates and overdrafts. Use an atomic conditional DB update; do not cache balances for decisions.
5. **No invalidation** after UpdateBalance.
6. **Key design**: no separator, version or tenant scope; use {{acct:v1:{tenant}:42}} so format changes and tenants never collide.
7. **Null handling**: caching a null for a missing account or throwing on deserialize.
8. **Stampede**: no single-flight for hot accounts.
9. Sensitive data in cache without classification/encryption.`,
  pts: [r`Singleton multiplexer, async calls`, r`TTL and invalidation`, r`Never decide money on cache`, r`Atomic DB update`, r`Key versioning and scope`],
  ex: r`A similar pattern let customers withdraw twice within a cache window during a promotion.`,
  fu: [r`Rewrite Withdraw correctly.`],
  pit: [r`Only fixing the connection and missing the stale-balance decision.`] },

{ id: 'q50', level: 'Principal', tags: ['strategy', 'summary'],
  code: r`~~~csharp
// The principles in one snippet: owner prefix, TTL, staleness budget, decide in the DB
public async Task<decimal> GetDisplayBalanceAsync(AccountId id, CancellationToken ct)
{
    var cached = await _cache.GetAsync("balance-display:" + id);                 // display only, 5 s staleness
    if (cached.HasValue) return (decimal)cached;
    var bal = await _ledger.GetBalanceAsync(id, ct);
    await _cache.SetAsync("balance-display:" + id, (double)bal, TimeSpan.FromSeconds(5));
    return bal;
}
public Task<WithdrawResult> WithdrawAsync(AccountId id, Money m, CancellationToken ct) =>
    _ledger.ConditionalDebitAsync(id, m, ct);                                     // never decided from cache
~~~`,
  q: r`Summarise your Principal-level principles for using Redis.`,
  a: r`1. **Redis accelerates; the system of record decides.** Money, inventory and authorisation decisions come from durable stores with constraints.
2. **Every cached item has an owner, a TTL and a staleness budget.**
3. **Separate by purpose**: cache instances (evictable) vs state instances (noeviction, replicated, persisted).
4. **Design for Redis being gone**: timeouts, breakers, DB protection, fail-open/closed per use.
5. **Locks are for efficiency**; correctness needs fencing or DB constraints.
6. **Avoid O(n) on big keys**; watch hot keys; one slow command blocks everyone.
7. **Cluster-aware design** from the start: hash tags deliberately, no cross-slot assumptions.
8. **Measure**: hit ratio, latency, memory by prefix, cost per service.
9. **Pave the road**: shared client library, Terraform modules, guidelines with real incidents.

These principles turn Redis from a source of mysterious incidents into a predictable platform component.`,
  pts: [r`Accelerate, not decide`, r`Owner, TTL, staleness budget`, r`Cache vs state separation`, r`Design for absence`, r`Measure and pave the road`],
  ex: r`Adopting these principles as an engineering standard reduced Redis-related incidents from monthly to rare.`,
  fu: [r`Which principle is most often violated and why?`],
  pit: [r`Listing commands instead of principles.`] }
],
cheat: r`### Model
Single-threaded command execution (atomic per command), I/O threads, forked persistence. One slow command blocks all. Scale out with Cluster (16,384 slots, hash tags for co-location, no cross-slot multi-key ops, hot keys cannot split).

### Data types
String (cache, counters, locks) · Hash (objects) · List (simple queue) · Set · Sorted set (leaderboards, rate limits, time indexes) · Stream (consumer groups, PEL, XAUTOCLAIM) · HLL · Bitmap · Geo · Bloom/JSON/Search (Stack / Redis 8).

### Caching
Cache-aside + delete on write + TTL with jitter. Stampede: single-flight, early refresh, stale-while-revalidate. Penetration: negative cache, Bloom. Avalanche: jitter, HA, shedding. L1 + L2 via HybridCache. CDC invalidation catches all writers.

### Durability
RDB (snapshots) / AOF everysec (~1 s) / both. Replication async: failover can lose acknowledged writes. WAIT and min-replicas-to-write reduce loss. MemoryDB for durable Redis.

### Locks and idempotency
SET key token NX PX + compare-and-delete in Lua. Efficiency, not correctness; fencing tokens or DB constraints for correctness. Idempotency fast-path in Redis, authoritative in DB.

### .NET
Singleton ConnectionMultiplexer, async only, abortConnect=false, timeouts often = thread-pool starvation, small values, versioned keys, Data Protection keys shared.

### Ops
maxmemory below RAM, allkeys-lfu for caches, noeviction for state. Watch main-thread CPU, evictions, hit ratio, fragmentation, replication. SLOWLOG, LATENCY DOCTOR, --bigkeys/--hotkeys.

### Say this
"Redis accelerates, the database decides." "Every key has an owner and a TTL." "Locks for efficiency, constraints for correctness." "What happens when Redis is gone?"`
});
})(String.raw);
