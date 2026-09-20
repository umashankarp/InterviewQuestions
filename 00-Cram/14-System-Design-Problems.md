# System Design — Problem Recall Cards

> Tier 1 · Source: `14-System-Design/02`–`22` · Read: 25 min · One card per problem
> Prereq sheet: [[14-System-Design-Core]]

**How to use:** cover everything but the title. Say the *hard problem* first, then the two or three decisions, then the trap. If you can do that for all 20, you can hold any system design interview.

---

## 1. News Feed / Timeline

- **Hard problem:** read fan-out (100:1 read-heavy). Writes are trivial.
- **Fan-out on write (push):** precompute each follower's feed at post time. Fast reads. **Fatal flaw: the celebrity** — 100M followers = 100M writes for one post.
- **Fan-out on read (pull):** merge at read time. Cheap writes, slow reads, fails for users following thousands.
- **Answer = hybrid**, with a **follower-count threshold** (~10k–100k): push for normal users, pull for celebrities, **merge at read**. State the threshold and that it's tunable.
- The merge is a **k-way merge** over sorted-by-time lists.
- **Ranking is a separable concern** from fan-out — do not conflate them.
- **Unfollow is handled at read time**, deliberately — unwinding a precomputed feed is far more expensive than filtering.
- At-least-once fan-out + **idempotent writes** (feed entry keyed by `(userId, postId)`).
- **Metric that lies:** feed-load latency looks fine while fan-out lag grows — measure **time-to-visible**, not just p99 latency.

## 2. Chat / Messaging

- **Hard problem:** delivery guarantees + ordering + connection state, not throughput.
- **WebSocket** (full duplex). SSE is server→client only; long-polling is the fallback.
- **Connection registry:** `userId → server instance`, in **Redis** (read on every send, trivial KV shape, no transactions). Crash without deregister → **TTL + heartbeat**, so stale entries expire rather than relying on cleanup that by definition can't run.
- Best routing = **hybrid**: consistent hashing for the initial connection, registry for actual current location (pure hashing has no answer after a failover).
- **Ordering: per-conversation sequence numbers, never wall-clock timestamps** (clock skew across servers).
- **Offline:** queue per recipient, deliver on reconnect (the Redis Streams / consumer-group pattern).
- Delivery: at-least-once + **client-side dedupe by message id** = effective exactly-once.
- Stateful tier scaling → connection draining on deploy is a first-class design item.

## 3. Rate Limiter / API Gateway

- **Hard problem:** atomic multi-tier enforcement, and the gateway itself being the highest-blast-radius component in the estate.
- **The gateway is a system, not a box.** In: authn, rate limiting, routing, TLS, request/response transformation. **Out:** business logic, orchestration, data aggregation.
- **Tiers:** global → per-tenant → per-user → per-endpoint → **outbound (the tier everyone forgets — protecting *them* from *you*)**. Check all tiers in **one atomic round trip** (a Redis Lua script) or you get partial decrements and **silent quota corruption**.
- Algorithms: fixed window (2× edge burst) · sliding log (exact, memory-heavy) · sliding counter · **token bucket (default)** · leaky bucket · **GCRA** (virtual scheduling, O(1) state).
- **Don't charge for retries** — idempotency-aware limiting.
- **Local token leases** beat the round trip: each node leases N tokens, refreshes asynchronously. Approximate but fast.
- **Hot key** is what actually pages you — one tenant/key exceeds a single Redis slot.
- **Rate ≠ concurrency** (Little's Law). **Rate, quota and entitlement are three different systems.**
- Failure posture per tier: fail-open for non-critical tiers, fail-closed at the **pre-authentication boundary**; application rate limiting is **not** DDoS protection (that's upstream/L3-L4).

## 4. YouTube / Video Streaming

- **Hard problem:** the transcoding pipeline and CDN economics — *not* the upload.
- **Chunked, resumable upload** (multipart, presigned URLs straight to object storage — never through your app tier).
- **Transcoding: decompose along the grain of the work** — split the video into segments, transcode in parallel, DAG per rendition.
- **ABR (adaptive bitrate)** is client-driven: the manifest (HLS/DASH) lists renditions; the player picks by measured bandwidth.
- **The CDN *is* the system**, not a cache on top of it — >95% of bytes never touch your origin.
- **Popularity-driven renditions:** don't transcode every rendition for every video up front; generate on demand for the long tail, tier cold storage.
- **View counts** = high-write counter → batch/aggregate in a stream, never `UPDATE ... SET count = count + 1`.
- **Time-to-first-rendition is a queueing problem** — prioritise the lowest rendition so playback can start.

## 5. Instagram

- **Point of the question: name what you reuse.** Feed = problem 1, media pipeline = problem 4 adapted.
- **Stories: TTL as a structural property** (a separate store that expires), not an application-level `WHERE expires_at > now()` filter.
- **Stories are not fanned out** — the estimate shows read-time assembly is cheaper for a 24h window.
- **Close friends: resolve at creation, validate at the boundary** (both, not either).
- **Highlights: copy, never extend the TTL** — otherwise the expiry property stops being structural.
- **Explore is a recommendation problem, not a graph traversal.**
- **Consistency per content type** — a like can be eventually consistent; a **block must not be**. The stale-block failure (you blocked someone and still see them) has three origins; the most likely is a cached authorization decision.
- **Monotonicity** — content must not disappear on refresh. Stronger than eventual consistency.
- Story views: rows vs **bitmaps** at scale.

## 6. Amazon / E-commerce

- **Hard problem: overselling.** Inventory correctness, not catalogue reads.
- **Reserve, don't decrement at checkout**: conditional update (`WHERE qty >= n`) or a reservation row with a TTL. Flash sale = **contention on one logical key** → shard the counter into N buckets, or a queue-based serialiser.
- **"Only 3 left" shows consistency is not a binary switch** — display may be stale; the *reserve* must not be.
- **Cart is eventually consistent; checkout is not.** That transition is the design hinge.
- **Checkout idempotency key** on every attempt.
- **Saga** across inventory → payment → fulfilment, with **compensation** (release reservation, refund). Choose granularity deliberately.
- Payments: keep PCI scope out (hosted fields / tokenisation); handle price-mismatch between cart and charge explicitly.
- **Physical reality:** at some point inventory stops being a data problem (warehouse pick failures) — reconcile, don't pretend.
- **SLO framing:** "broken" = customers cannot buy, not "service B is 500ing."

## 7. WhatsApp — E2E & Multi-Device

- **Never reinvent the crypto.** Signal protocol: X3DH key agreement + **Double Ratchet** (forward secrecy + post-compromise security).
- **The device, not the user, is the cryptographic identity** — encrypt per device.
- **Sender keys** for groups: encrypt once with a group key distributed pairwise, instead of N pairwise encryptions per message.
- **Revocation ≠ removing access** — you must rotate the sender key; history the member already has stays theirs.
- **Device linking + safety numbers** detect an injected device; the server can always *attempt* injection, so verification must be user-visible.
- **State honestly what this cannot do:** no server-side search, no server-side content moderation, backup is the weak point, metadata is still visible.
- **Refuse the backdoor** — an exceptional-access mechanism is a vulnerability for everyone. Good answer to the "what would you tell the regulator" question.

## 8. URL Shortener + Distributed IDs

- **Estimation eliminates three architectures** — run it first. Read-dominated, tiny payloads.
- **ID generation, five options:** UUID (too long, random) · DB auto-increment (SPOF/bottleneck) · **DB ticket server with ranges** · **Snowflake** (timestamp + machine id + sequence — sortable, coordination-free) · hash of the URL (collisions).
- **Base62** (`[a-zA-Z0-9]`) — 7 chars ≈ 3.5 trillion. Alphabet choice matters (ambiguous characters, profanity filtering).
- **301 vs 302 is a trap:** 301 is cached by the browser forever → you lose analytics and cannot revoke. **Use 302** unless you're certain.
- Analytics **strictly off the critical path** (fire into a queue).
- **Custom alias is the only genuine race** — unique constraint.
- **Revoke by destination, not by code** (one bad URL may have many codes).
- Keyspace exhaustion → migrating 6→7 chars is a real planned migration.
- **Staff-separating question:** should you build this at all? A managed service or a CDN redirect rule may be the honest answer.

## 9. Payments & Double-Entry Ledger

- **Hard problem: correctness, not throughput** (10 TPS is common — say so).
- **Double-entry derived, not inherited:** every transaction writes ≥2 entries summing to zero, sharing a transaction id. Enforce in one transaction + a **nightly assertion** (a CHECK cannot span rows).
- **Append-only, always forward** — refunds/chargebacks/corrections are *new* entries, never updates or deletes.
- **Balance:** derived is correct but slows; stored is fast but drifts. **Honest middle = stored cached projection + ledger as truth + scheduled reconciliation.**
- **Money = `DECIMAL`, never float.** Store the currency and its minor-unit scale.
- **Idempotency is the single most important mechanic** — `Idempotency-Key` + unique constraint; replay the stored response.
- **Auth/capture split** = two ledger events (or one, deliberately).
- **Settlement/reconciliation against the provider's file is mandatory even if they claim idempotency.** Classify breaks: auto-fixable / manual / investigate.
- **Outbox** for event publishing — never 2PC.
- **The indeterminate state** — you don't know if the external side succeeded. Design for it: a pending state + reconciliation, never a guess.
- **Verify the verifier** — who checks the integrity checker?
- **Failures with no detector** — name them.

## 10. Search / Typeahead

- **Inverted index:** term → posting list of doc ids.
- **The analysis chain is where correctness lives** — tokenise, lowercase, stem, synonyms, stop words. **Index and query must use the same chain.**
- **Ranking:** TF-IDF → **BM25**. The formula matters less than the signals (recency, popularity, personalisation).
- **Typeahead:** trie / **FST**, precomputed top-k per prefix, served from memory. Not a search query.
- **Freshness vs cost** is the central tension — near-real-time indexing costs segment merges.
- **Scatter-gather tail** — more shards = worse tail (see the fan-out formula).
- **Entitlements must never be best-effort** — filter *in* the index (or post-filter with a top-k refill), never in the UI.
- **Lexical vs vector search** — hybrid wins; vector alone loses exact-match.
- **Changing the analysis chain is a full reindex + relevance regression** — the migration everyone underestimates.
- **Interleaving beats A/B testing** for ranking changes (same user sees both, removes population variance).
- "All metrics green but search feels bad" → you're measuring the mechanism, not relevance. Need judgement lists / NDCG.

## 11. Notification & Alerting

- **Fan-out amplification chain:** event → users → channels → devices. **Expand it as late as possible.**
- **Check consent/preferences at dispatch time**, not at enqueue time (the unsubscribe race against replica lag).
- **Dedupe scope trap** — dedupe key must include the channel and the window, or you suppress a legitimate second notification.
- **Push token lifecycle quietly rots** — handle unregistered tokens, or sender reputation degrades.
- **Sender reputation is a shared-fate resource** across all your tenants/teams.
- **Storms → coalesce + priority lanes.** OTP must never queue behind a marketing campaign.
- **Failure modes that present as success** — the defining hazard: the provider returns 200 and never delivers. Reconcile against delivery receipts.
- **Ordering:** take a position — most notifications don't need it; **supersession** (newest wins) is usually better than ordering.
- **Evidentiary strength** — proving notice was given is a legal requirement in finance/insurance.

## 12. Real-Time Portfolio Risk Engine *(fintech)*

- **The work is a product:** positions × risk factors × scenarios. That multiplication *is* the capacity plan.
- **Historical simulation** (replay actual past scenarios) vs **Monte Carlo** (generate paths) — different workload shapes, not just different math.
- **The risk-factor dependency graph has a silent failure mode** — a stale factor produces a plausible-but-wrong number with no error.
- **Determinism and reproducibility are non-negotiable** — same inputs must give the same number, years later, for the regulator.
- **Snapshot pinning** makes the "mixed-vintage inputs" failure *inexpressible*, rather than detected.
- **Bad ticks: reject at ingestion, never at consumption.**
- **"We want sub-second risk"** → answer with the latency/accuracy trade: fewer scenarios, incremental revaluation, or approximation. Name what precision you're giving up.
- **DR: inputs outrank outputs** — you can recompute results, you cannot recreate a market snapshot.

## 13. Market Data Distribution *(fintech)*

- **Three consumption models, one pipeline:** real-time streaming · snapshot/conflated · historical tick archive.
- **Feed handlers + normalisation is where correctness is decided.**
- **The canonical identifier invariant: a resolver must never guess.** An unmapped instrument is quarantined, not approximated.
- **Conflation = deliberate, bounded data loss** — say it that way; a slow consumer gets the latest, not a backlog.
- **Snapshot + incremental with a sequence barrier** (the classic join-the-stream problem).
- **Gap detection is mandatory** — loss here is permanent, there is no retransmit for a missed multicast.
- **Bitemporality** — late, out-of-order and *corrected* ticks. `(valid_time, transaction_time)`.
- **Economics are inverted:** the data is far more expensive than the infrastructure; entitlements and per-consumer billing are first-class.
- "Stale price" investigation → attribution across hops is the observability requirement.

## 14. Order Management / Trade Lifecycle *(fintech)*

- **OMS (owns order state, compliance, allocation) ≠ EMS (execution, venue routing).**
- **The order state machine is not textbook** — partial fills, amendments, and rejects make it a graph, not a line.
- **FIX:** execution reports, `ClOrdID` chains (every amend creates a new id linked to the original), session sequence numbers.
- **Idempotency under retransmission, and the scope trap** — dedupe on `(session, seqnum)` is not the same as dedupe on business identity.
- **The amendment race: optimistic application is wrong** — an amend may cross with a fill. Serialise per order.
- **Pre-trade checks are a latency/correctness bind** — every check costs microseconds on the critical path.
- **Event-source the order** — the audit trail *is* the requirement, not a nice-to-have.
- **Daily reconciliation against the venue is the only ground truth.**
- **Best execution: record the counterfactual**, not just the outcome.
- **Recovery priority: order state is authoritative** — restore it before anything else.

## 15. Multi-Tenant Analytics Platform *(fintech)*

- **Isolation is the product, not hygiene.**
- **Isolation spectrum:** shared table + `TenantId` → schema per tenant → database per tenant → cluster per tenant. Cost vs blast radius.
- **Defence in depth — no single load-bearing mechanism.** Row-level security *and* a query-layer filter *and* a test suite that tries to cross tenants.
- **The incident pattern: a protection whose exceptions were invisible** (an admin bypass flag nobody could enumerate).
- **Noisy neighbours are harder here because the load is legitimate.**
- **Aggregates leak too** — inference risk from counts and averages.
- **Support access must be exceptional and expiring, never standing.**
- **Leak detection is genuinely weak** — say so, and propose a canary-record detector.

## 16. Regulatory Reporting *(fintech)*

- **Completeness is the hard problem, not transformation.** You must prove you reported *everything*.
- **The deadline is a hard architectural constraint** (T+1 by 23:59 drives the whole design).
- **Validate in layers** — regulator rejection is far too late; validate at ingest, enrich, pre-submit.
- **The repair loop needs first-class design** — breaks will happen daily; who fixes them, with what tool, by when.
- **Amendments and cancellations mean reporting what you previously reported** — bitemporal again.
- **The archive is evidence, not storage** — immutable, timestamped, reproducible.
- **The signal that looks like a quiet day** = zero reports submitted because the feed broke. Alert on *absence*.

## 17. Insurance Platform *(fintech)*

- **Three systems, not one:** policy administration · underwriting · claims. Conflating them fails.
- **Bitemporality is mandatory** — you adjudicate a claim against the policy *as it was* on the loss date.
- **The rating engine is a pure function with a regulator attached** — versioned, reproducible, explainable.
- **Underwriting needs an explainability obligation** — a model that cannot explain a decline is not deployable.
- **Indemnity arithmetic: order of operations decides the payment** (deductible before or after limit changes the number).
- **Reserving — the largest number on the balance sheet is an estimate.**
- **Documents are the contract.**
- **Catastrophe is the one genuine capacity problem** (a hurricane = a year of claims in a week).

## 18. Scaling Ladder (single server → millions)

Rungs, in order: single server → **split web/DB** → load balancer → replication → cache → CDN → stateless web tier → multiple DCs → message queues → **observability & automation** → sharding (last resort).

- **Observability is deliberately placed late in the list but should be done early** — the ordering is a trap in the source material; note it.
- **"Why did scaling out make it slower?"** — added coordination, a shared bottleneck (the DB, a lock), cold caches per node, or cross-AZ latency.
- **Verify a cache is optional** by turning it off in a controlled test; if the system dies, it's not a cache, it's a dependency.

## 19. Interview Execution

See [[14-System-Design-Core]] §1–3. The three things that most often cap a candidate at Senior:
1. No estimate, or an estimate that eliminates nothing.
2. No failure analysis and no "what has no detector."
3. No operability — deploy, rollback, monitoring, ownership.

## 20. Batch → Intraday Migration *(capstone)*

- **What batch provided implicitly must now be engineered:** a consistent cut-off point, ordering, a natural retry window, and "everything is complete by 6am."
- **Dependency order is the migration constraint — upstream first.**
- **The hybrid period *is* the migration**, not a phase of it. Both run; reconcile continuously.
- **"It reconciled for six weeks" is not proof** — you need coverage of the rare paths (month-end, corporate actions, holidays).
- **Change semantics separately from changing the schedule** — never both at once.
- **Some batches should stay batch.** Say which and why.
- **Rollback must be designed**, and some consumers genuinely cannot accept intraday updates.

---

## The five recurring principles (say these, they transfer everywhere)

1. **Estimate to eliminate.** A number that retires an architecture earns its place.
2. **Exactly-once = at-least-once + idempotency.** Never claim it on the wire.
3. **Reconcile against external truth** — even when the other side claims correctness.
4. **Append-only, always forward** for anything financial or audited.
5. **Name what has no detector.** Then build the detector.

---

**Go deeper:** `14-System-Design/02`–`22` · **Related:** [[16-Distributed-Systems]], [[17-Microservices]], [[04-SQL-Server]], [[21-AWS]]
