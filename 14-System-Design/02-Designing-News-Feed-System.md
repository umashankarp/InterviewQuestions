# Module 38 — System Design: Designing a News Feed / Timeline System

> Domain: System Design | Level: Beginner → Expert | Prerequisite: [[01-System-Design-Fundamentals]] — this module applies that module's framework to one canonical, deeply-worked system design problem end-to-end.

---
# Designing a News Feed / Timeline System (AWS Architecture)

```mermaid
flowchart TB

 User[👤 Web / Mobile User]

 User --> CF[Amazon CloudFront]
 CF --> WAF[AWS WAF]
 WAF --> APIGW[Amazon API Gateway]
 APIGW --> Cognito[Amazon Cognito]

 Cognito --> ALB[Application Load Balancer]

 ALB --> PostService[Post Service - ECS/EKS]
 ALB --> FeedService[Feed Service - ECS/EKS]
 ALB --> UserService[User Service - ECS/EKS]
 ALB --> FollowService[Follow Service - ECS/EKS]
 ALB --> MediaService[Media Service - ECS/EKS]
 ALB --> NotificationService[Notification Service - ECS/EKS]

 %% Storage
 PostService --> Aurora[(Amazon Aurora)]
 UserService --> Aurora
 FollowService --> DynamoDB[(Amazon DynamoDB)]

 MediaService --> S3[(Amazon S3)]

 FeedService --> Redis[(Amazon ElastiCache Redis)]

 %% Event Driven
 PostService --> EventBridge[Amazon EventBridge]

 EventBridge --> FanoutWorker[Feed Fan-out Worker]
 EventBridge --> SearchIndexer[Search Indexer]
 EventBridge --> NotificationWorker[Notification Worker]
 EventBridge --> AnalyticsWorker[Analytics Worker]

 %% Feed Store
 FanoutWorker --> FeedDB[(Feed Store - DynamoDB)]

 %% Search
 SearchIndexer --> OpenSearch[(Amazon OpenSearch)]

 %% Notification
 NotificationWorker --> SNS[Amazon SNS]

 SNS --> EmailQueue[SQS Email Queue]
 SNS --> PushQueue[SQS Push Queue]

 EmailQueue --> EmailWorker[Lambda / ECS]
 PushQueue --> PushWorker[Lambda / ECS]

 %% Feed Read
 FeedService --> FeedDB
 FeedService --> Redis

 %% Monitoring
 PostService --> CloudWatch[Amazon CloudWatch]
 FeedService --> CloudWatch

 PostService --> XRay[AWS X-Ray]
 FeedService --> XRay

 %% Security
 PostService --> Secrets[AWS Secrets Manager]
```

---

# Feed Read Flow

```mermaid
sequenceDiagram

 participant User
 participant API as API Gateway
 participant Feed
 participant Redis
 participant FeedDB

 User->>API: GET /timeline

 API->>Feed: Get Timeline

 Feed->>Redis: Check Cache

 alt Cache Hit

 Redis-->>Feed: Timeline

 else Cache Miss

 Feed->>FeedDB: Load Timeline

 FeedDB-->>Feed: Timeline

 Feed->>Redis: Cache Timeline

 end

 Feed-->>User: News Feed
```

---

# Feed Write Flow (Fan-out on Write)

```mermaid
sequenceDiagram

 participant User
 participant Post
 participant EventBridge
 participant Fanout
 participant FeedDB

 User->>Post: Create Post

 Post->>Aurora: Save Post

 Post->>EventBridge: Publish PostCreated

 EventBridge->>Fanout: PostCreated

 Fanout->>FeedDB: Update Followers Timeline

 EventBridge->>NotificationWorker: Notify Followers

 EventBridge->>SearchIndexer: Index Post
```

---

# AWS Services Used

| Layer | AWS Service |
|---------|-------------|
| CDN | Amazon CloudFront |
| Security | AWS WAF |
| Authentication | Amazon Cognito |
| API | Amazon API Gateway |
| Load Balancer | Application Load Balancer |
| Compute | Amazon ECS / Amazon EKS |
| Database | Amazon Aurora |
| Feed Store | Amazon DynamoDB |
| Cache | Amazon ElastiCache (Redis) |
| Media Storage | Amazon S3 |
| Event Bus | Amazon EventBridge |
| Notifications | Amazon SNS |
| Queue | Amazon SQS |
| Search | Amazon OpenSearch |
| Email | Amazon SES |
| Monitoring | Amazon CloudWatch |
| Distributed Tracing | AWS X-Ray |
| Secrets | AWS Secrets Manager |


## 1. Fundamentals

### What is a news feed system, and why is it one of the most information-rich system-design interview problems?
A news feed/timeline system (Twitter's timeline, Facebook's News Feed, LinkedIn's feed) aggregates content from many sources (people/pages a user follows) into one personalized, ranked, continuously-updating stream. It's an exceptionally rich interview problem specifically because it forces a genuine trade-off decision (**fan-out-on-write vs fan-out-on-read**) with no universally correct answer, has a natural, discussable evolution path (adding ranking, media, real-time updates), and directly exercises nearly every building block (caching, load balancing, sharding, CAP trade-offs) in one cohesive system.

### Why does this matter?
Because the fan-out decision alone demonstrates whether a candidate can reason about a **genuinely asymmetric read/write problem** — the number of people who read a feed vastly exceeds the number of posts written, but a single celebrity's post must reach millions of followers' feeds, creating a "many-to-many, wildly skewed" data-distribution problem unlike the simpler CRUD systems most coding interviews implicitly assume.

### When does this matter?
Any interview or real system involving personalized content aggregation, activity feeds, or notification timelines; the depth matters because the fan-out trade-off's correct resolution genuinely depends on the specific platform's follower-count distribution (a non-functional requirement, directly the discipline), not a fixed, memorizable answer.

### How does it work (30,000-ft view)?
```
1. Requirements: post creation, follow relationships, personalized ranked feed, real-time-ish updates
2. Scale estimation: 500M users, 200M daily active, avg 200 follows/user, 5:1 read:write on feed views
3. Core decision: fan-out-on-write (push) vs fan-out-on-read (pull) vs hybrid
4. Data model: Users, Posts, Follows (graph), precomputed Feed entries (if push)
5. Ranking: chronological (simple) vs ML-ranked (engagement-optimized) -- separate concern from fan-out
```

---

## 2. Deep Dive

### 2.1 Requirements Gathering — Applying to This Specific System
**Functional**: users post content; users follow/unfollow other users; a user's feed shows posts from followed accounts, ranked/ordered; posts support likes/comments (secondary features, often explicitly deprioritized in an interview to focus time on the feed-generation core problem). **Non-functional** (the questions a strong candidate asks *before* designing): What's the follower-count distribution — is it roughly uniform (most users have similar-sized followings) or **power-law** (a small number of accounts have millions of followers, most have a few hundred)? This single question's answer almost entirely determines whether fan-out-on-write is even viable. What's the acceptable feed staleness — must a new post appear in followers' feeds within seconds, or is a few minutes acceptable? What's the read:write ratio on feed views specifically (distinct from post-creation rate)?

### 2.2 Fan-Out-on-Write (Push Model) — Mechanics and Its Fatal Flaw at Scale
On every post creation, **immediately write that post's ID into every follower's precomputed feed** (a per-user feed list, typically stored in a fast store like Redis, — a sorted set keyed by user ID, scored by post timestamp) — reading a feed becomes extremely fast (a single `ZRANGE` read of the precomputed list, no fan-out computation at read time). The **fatal flaw**: for a celebrity account with 50 million followers, a single post triggers 50 million individual writes — the **"celebrity problem"** — both a severe write-amplification cost (the "choose the structure matching the actual write pattern" theme, now showing a structure that works beautifully for typical users and catastrophically for outliers) and a latency problem (the post might take minutes to fully propagate to every follower's feed under this write load, violating any "post appears quickly" requirement for at least some followers).

### 2.3 Fan-Out-on-Read (Pull Model) — Mechanics and Its Scaling Problem in the Other Direction
On every feed **read**, query all accounts the user follows, fetch their recent posts, merge and rank them on the fly — no write amplification at all (posting is just one write, regardless of follower count), directly solving the celebrity problem. The trade-off inverts: **every feed read** now requires fanning out to potentially hundreds of followed accounts' recent posts (a scatter-gather query, directly the graph-traversal-cost concerns) and merging/ranking them in real time — for a user who checks their feed frequently (the common case, given feeds are read far more often than posts are created), this read-time cost is paid repeatedly, for every single read, unlike the push model's "pay once at write time, read is free" trade.

### 2.4 The Hybrid Model — the Actual, Production-Standard Answer
Real systems (Twitter's actual, publicly-documented architecture) use a **hybrid**: fan-out-on-write for the overwhelming majority of accounts (normal follower counts, where the celebrity problem doesn't apply), combined with fan-out-on-read specifically for celebrity/high-follower-count accounts — a user's feed-read path merges their precomputed (pushed) feed entries with a real-time pull of any followed celebrity accounts' recent posts, combining both models' strengths while avoiding both models' individual weaknesses. This hybrid answer is precisely why the "what's the follower-count distribution" question matters so much — it's what determines the threshold (e.g., "accounts with over 10,000 followers use pull instead of push") separating the two populations the hybrid model treats differently.

### 2.5 Ranking — a Separable Concern from Fan-Out
Once feed candidates are gathered (via either fan-out model), **ranking** (chronological vs. an ML-driven engagement-optimized order) is a genuinely separate architectural concern, frequently conflated with the fan-out decision in less-rigorous design discussions — a system can use fan-out-on-write for candidate generation and still apply a sophisticated ranking model at read time over that pre-gathered candidate set (re-ordering, not re-gathering) — recognizing that "how do I gather candidates" and "how do I order them" are independent design axes, each with their own trade-offs, is a genuine Staff/Principal-level distinction many candidates blur together.

## 3. Visual Architecture
```mermaid
graph TB
 subgraph "Fan-out-on-Write (push) -- normal users"
 Post1[User posts] --> FanOut[Fan-out service]
 FanOut -->|write to EVERY follower's feed| FeedCache1["Follower A's feed (Redis ZSet)"]
 FanOut --> FeedCache2["Follower B's feed (Redis ZSet)"]
 FanOut --> FeedCache3["Follower N's feed (Redis ZSet)"]
 end
 subgraph "Fan-out-on-Read (pull) -- celebrity accounts"
 Celebrity[Celebrity posts] --> CelebPostStore[(Celebrity Post Store)]
 end
 subgraph "Feed Read Path (hybrid merge)"
 UserRead[User requests feed] --> Merge["Merge: precomputed feed<br/>+ live-pulled celebrity posts"]
 FeedCache1 --> Merge
 CelebPostStore --> Merge
 Merge --> Rank[Ranking service]
 Rank --> Response[Ranked feed response]
 end
```

## 4. Production Example
**Scenario**: A growing social platform launched with pure fan-out-on-write, correctly sized for its initial user base's roughly-uniform follower-count distribution — as the platform grew and a small number of accounts (a handful of celebrities partnering with the platform) accumulated follower counts orders of magnitude above the typical user, the fan-out service began experiencing severe, sustained write-amplification spikes correlated precisely with these specific accounts' posting activity — a single post from one such account triggered a write burst large enough to degrade the fan-out service's throughput for **every** user's posts temporarily, not just the celebrity's followers, since the shared fan-out infrastructure's capacity was consumed disproportionately by these outlier events. **Investigation**: correlating fan-out-service latency spikes precisely with specific high-follower-count accounts' posting timestamps confirmed the celebrity problem as the root cause — the system had been correctly designed for its *original* follower-count distribution, but that non-functional assumption had silently become invalid as the platform's user base evolved, without a corresponding architecture review. **Fix**: implemented the hybrid model — accounts exceeding a follower-count threshold (determined empirically from the actual distribution of write-amplification incidents) switched to fan-out-on-read, with the feed-read path merging precomputed (pushed) results with live-pulled posts from these specific flagged accounts — fan-out-service load stabilized immediately, decoupled from any individual account's follower count. **Lesson**: a non-functional requirement (follower-count distribution) that was true and correctly designed-for at launch can become false as a system evolves — exactly the "requirements can be silently invalidated by growth" lesson, now demonstrated in the specific, canonical shape of the celebrity problem, and a strong argument for treating the fan-out threshold as a **monitored, adjustable** parameter (tracked via the same "actual vs. design-time assumption" comparison discipline §Advanced Q7) rather than a one-time architectural decision made permanently at launch.

## 5. Best Practices
- Ask about follower-count distribution explicitly before committing to a fan-out strategy — it's the single decision-determining non-functional requirement for this entire problem class.
- Design for the hybrid model from the start if there's any plausible chance of high-follower-count accounts existing, rather than retrofitting it reactively after a celebrity-problem incident.
- Treat ranking as a separable concern from fan-out/candidate-generation — design each independently.
- Monitor the actual follower-count distribution over time as a standing metric, since it can silently shift as a platform grows (the lesson).

## 6. Anti-patterns
- Committing to pure fan-out-on-write without considering the celebrity problem, or pure fan-out-on-read without considering the resulting read-time scatter-gather cost for the platform's actual (likely far more common) read-heavy access pattern.
- Conflating the "how do I gather feed candidates" and "how do I rank them" decisions into one inseparable design choice.
- Treating the fan-out threshold as a permanent, unmonitored architectural decision rather than a parameter that may need adjustment as the platform's user distribution evolves.
- Designing the feed-read path without an explicit plan for merging precomputed and live-pulled results consistently (ordering/deduplication across the two sources).

---

## 10. Interview Questions

### Basic (10)
1. **Q: What is fan-out-on-write?** **A:** Immediately writing a new post into every follower's precomputed feed at post-creation time.
2. **Q: What is fan-out-on-read?** **A:** Computing a user's feed at read time by querying and merging recent posts from all followed accounts.
3. **Q: What is the "celebrity problem"?** **A:** A high-follower-count account's post triggering an enormous, disproportionate write-amplification burst under a pure fan-out-on-write model.
4. **Q: What's the fundamental trade-off between push and pull fan-out?** **A:** Push pays cost at write time (proportional to follower count) with cheap reads; pull pays cost at read time (proportional to following count) with cheap writes.
5. **Q: What is the hybrid fan-out model?** **A:** Using push for normal accounts and pull for high-follower-count (celebrity) accounts, merging both at feed-read time.
6. **Q: Is ranking the same concern as fan-out?** **A:** No — fan-out is about gathering feed candidates; ranking is about ordering them, a separable design decision.
7. **Q: What data structure is commonly used for a precomputed per-user feed cache?** **A:** A Redis sorted set, scored by post timestamp.
8. **Q: What non-functional requirement most determines the fan-out strategy choice?** **A:** The follower-count distribution (uniform vs. power-law/celebrity-skewed).
9. **Q: Why is a follow relationship modeled as a graph?** **A:** It's an arbitrary many-to-many relationship between users, the same shape as any graph-modeling problem.
10. **Q: Why does fan-out-on-read scale poorly for the common case even though it solves the celebrity problem?** **A:** Feeds are read far more often than posts are created, so paying a scatter-gather cost on every single read is typically more expensive in aggregate than push's occasional, if larger, write bursts for the majority of normal accounts.

### Intermediate (10)
1. **Q: Why does asking about follower-count distribution matter more than asking about total user count for this specific design decision?** **A:** Total user count affects overall scale/sharding needs generally, but the fan-out strategy specifically depends on whether follower counts are roughly uniform (favoring pure push) or power-law-skewed (requiring a hybrid to handle celebrity accounts) — a platform could have a huge total user count with a uniform distribution and never hit the celebrity problem at all.
2. **Q: Why might a precomputed feed cache need bounding/trimming, directly connecting to the unbounded-embedding lesson?** **A:** An unbounded per-user feed list would grow indefinitely as a user follows more accounts and time passes, exactly the same "unbounded growth invisible at small scale, dominant at production scale" risk as the embedded-comments-array incident, requiring the same deliberate trimming/bounding discipline.
3. **Q: Why does the hybrid model's fan-out threshold need to be a monitored, adjustable parameter rather than a fixed constant chosen once at launch?** **A:** As demonstrated, the actual distribution of follower counts can shift as a platform grows — a threshold correctly calibrated at launch can become miscalibrated later, requiring ongoing monitoring (directly §Advanced Q7's "compare actual production numbers against design-time assumptions" discipline) rather than a permanent, unrevisited decision.
4. **Q: Why is verifying a private account's/blocked-user's authorization at feed-read time (not just fan-out-write time) necessary for correctness?** **A:** A precomputed feed entry, once pushed, reflects the authorization state *at push time* — if that state changes later (a block, a privacy setting change), the stale, already-pushed entry could incorrectly remain visible unless the read path re-verifies current authorization rather than trusting the cache's historical push decision.
5. **Q: Why does content moderation need to happen at or near post-creation time rather than purely after the fact for a fan-out-on-write system specifically?** **A:** Because fan-out-on-write immediately propagates a post into potentially millions of followers' feed caches — by the time a post-hoc moderation review flags problematic content, it may have already been widely distributed and viewed, unlike a pull-model system where un-surfaced content simply never gets fetched if flagged before any read occurs.
6. **Q: Why would ranking logic re-order rather than re-gather candidates, and why does this distinction matter for latency budgeting?** **A:** Re-ordering an already-gathered candidate set (from either fan-out model) is a bounded, predictable-cost operation over a known-size set; re-gathering (running the entire fan-out process again as part of ranking) would duplicate expensive work unnecessarily — keeping these separate lets each be latency-budgeted independently and optimized without entangling their costs.
7. **Q: Why might a system choose to shard its precomputed feed cache by user ID specifically, rather than by some other key?** **A:** User ID is the natural, high-cardinality key every feed read/write operation already uses to address the cache — sharding by any other key would require an additional lookup/mapping step, adding unnecessary indirection for no benefit, directly the same "shard by the key the dominant access pattern already uses" principle from the partition-key design.
8. **Q: Why does a globally-distributed feed system's cross-region consistency model typically lean AP (eventually consistent) rather than CP?** **A:** Users generally tolerate a brief delay before a friend's post from a different region appears in their feed (an acceptable staleness window) far more readily than they'd tolerate reduced availability (an error/failure) just to guarantee immediate cross-region consistency — the business cost of unavailability typically exceeds the cost of brief staleness for this specific use case.
9. **Q: Why is post-creation rate limiting specifically important given the fan-out architecture, beyond ordinary API abuse prevention?** **A:** Because a single post from a high-follower-count account triggers disproportionate downstream write amplification (/) — rate-limiting post creation isn't just protecting the post-creation endpoint itself, it's protecting the entire fan-out infrastructure's capacity from being consumed by a small number of expensive operations.
10. **Q: Why would you explicitly ask an interviewer about acceptable feed staleness before committing to a specific architecture?** **A:** It directly determines whether asynchronous fan-out (a background job processing the fan-out after the post-creation request returns, tolerating a brief propagation delay) or a synchronous, immediate fan-out (higher latency on the post-creation request itself, but faster propagation) is the more appropriate design choice.

### Advanced (10)
1. **Q: Diagnose the celebrity-problem production incident from first principles, and design the specific monitoring/alerting that would have caught the emerging risk before it caused a fan-out-service-wide degradation.**
 **A:** Root cause: the follower-count distribution non-functional assumption, correct at launch, silently became invalid as specific accounts grew disproportionately, with no monitoring tracking this specific metric. Safeguard: track the **maximum single-account follower count** and the **follower-count distribution's tail** (e.g., "count of accounts exceeding 100K followers") as a standing metric, alerting when any account's follower count crosses a threshold indicating it will soon trigger celebrity-problem-scale write amplification under the current pure-push model — giving the team advance warning to migrate that specific account to the pull path proactively, before its next post triggers a production-impacting fan-out burst, rather than discovering the problem reactively via a latency-spike investigation.
2. **Q: Design the specific data model and query pattern for the hybrid model's feed-read merge step, addressing correct chronological ordering across the two sources.**
 **A:** The precomputed (pushed) feed entries in the user's Redis ZSet are already timestamp-scored and sorted; the live-pulled celebrity posts (fetched via a query against the specific followed celebrity accounts' recent-posts store, itself potentially a simple time-ordered index per account) must be merged with the precomputed entries via a **k-way merge** (directly the divide-and-conquer/merge-sort structural pattern, since both input streams are already individually sorted by timestamp) rather than concatenating and re-sorting the combined set from scratch — an O(n log k) merge (k being the small number of sources being merged: 1 precomputed stream + a handful of pulled celebrity streams) is meaningfully more efficient than an O(n log n) full re-sort, directly reusing the algorithmic-technique-recognition skill in this system-design context.
3. **Q: Explain how you would handle the "unfollow" operation's interaction with an already-populated fan-out-on-write feed cache, addressing both correctness and cost.**
 **A:** Unlike post creation (which requires fanning out to potentially millions of followers), an unfollow is a single-user operation — the correct, cost-effective approach is **not** to immediately scan and remove that account's historical posts from the unfollowing user's feed cache (an expensive, unnecessary operation given feeds are typically bounded/trimmed anyway), but instead to record the unfollow in the follow-graph and apply it as a **filter at read time** for any residual cached entries from the unfollowed account until they naturally age out of the bounded feed cache — trading a small, temporary, low-stakes "might briefly still see one old post from someone I just unfollowed" inconsistency for avoiding an expensive, unnecessary cache-scrubbing operation, a deliberate, justified trade-off rather than an overlooked correctness gap.
4. **Q: Design a strategy for handling a sudden, extreme spike in post-creation rate from a specific event (e.g., a major news event causing many users to post simultaneously), distinct from the celebrity-single-account problem.**
 **A:** This is an aggregate, many-accounts-simultaneously spike rather than one account's disproportionate fan-out — the mitigation is different: ensure the fan-out **processing** itself is asynchronous (a message queue,/26's Streams-based pattern, absorbing a burst of post-creation events and processing fan-out from the queue at a sustainable rate) rather than synchronous with the post-creation request, so a traffic spike causes queue depth to grow (a monitorable, recoverable condition) rather than the fan-out service itself becoming overwhelmed and failing outright — directly the Streams-based durable-processing pattern applied to this specific burst-absorption need.
5. **Q: Explain how you would design A/B testing infrastructure for evaluating a new ranking algorithm without disrupting the underlying fan-out/candidate-gathering architecture.**
 **A:** Since ranking is a separable concern from candidate-gathering, a ranking-algorithm A/B test can operate purely on the **already-gathered candidate set**, applying either the control or experimental ranking function to the same underlying candidates for a given user (assigned to a test group) — this cleanly isolates the experiment to the ranking layer specifically, without needing to run two entirely separate fan-out pipelines, directly benefiting from the architectural separation this module emphasizes as a design principle, not just an academic distinction.
6. **Q: How would you reason about whether a specific account should be migrated to the pull-model path (Advanced Q1's monitoring trigger), beyond just a raw follower-count threshold?**
 **A:** Follower count alone is a reasonable first-pass signal, but the more precise determinant is the account's **actual posting frequency multiplied by follower count** (the true write-amplification volume) — a high-follower-count but rarely-posting account may never actually cause a problematic write burst, while a moderate-follower-count but extremely-frequent-posting account could still generate meaningful aggregate write load; a more sophisticated migration trigger considers this combined metric rather than follower count in isolation, directly the same "measure the actual cost driver precisely, not a rough proxy" discipline recurring throughout this course.
7. **Q: Explain the interaction between the follow-graph's data model and the feed system's read-time performance, specifically for the pull-model path.**
 **A:** The pull model's read-time cost is directly proportional to the number of accounts a user follows (their "following" out-degree in the follow graph) — a user following an unusually large number of accounts (an analogous "reverse celebrity problem," a power-user with thousands of follows) creates the same kind of read-time scatter-gather cost concern raises generally, now specifically bounded by that individual user's own following count rather than any other account's follower count — worth explicitly distinguishing these two, symmetric-but-distinct "power user" scenarios (many followers vs. many follows) as separate design considerations, since they stress different parts of the hybrid architecture.
8. **Q: Design a disaster-recovery strategy for the precomputed feed cache (Redis) becoming completely unavailable, distinct from a partial degradation.**
 **A:** Since the feed cache is a derived, recomputable structure (not the system of record — the underlying posts and follow-graph data, presumably in a durable database, remain the actual source of truth), a full Redis outage should trigger a fallback to a **degraded, pure-pull-model** feed-read path for all users temporarily (querying the durable post/follow-graph store directly, accepting higher latency system-wide) rather than the system becoming entirely unavailable — this fallback path, while much slower than the normal hybrid path, provides graceful degradation rather than total failure, directly §Advanced Q6's cache-unavailability-fallback discipline applied specifically to this system's feed cache.
9. **Q: A team proposes eliminating the pull-model path entirely once the celebrity-problem accounts are identified, instead simply "capping" how many followers a single fan-out operation will write to, silently dropping the rest. Evaluate this as a Principal Engineer.**
 **A:** Reject this approach — silently dropping fan-out writes for some followers means those followers simply never see the celebrity's post in their feed at all (not "eventually, with some delay," but genuinely never, unless they separately visit that account's profile), a real, user-facing functional regression, not merely a performance optimization; the hybrid pull-model approach is specifically designed to serve *every* follower correctly, just via a different mechanism (real-time pull) for the specific accounts where push doesn't scale — recommend rejecting any "solution" that silently sacrifices functional correctness (some users never seeing content they're entitled to see) in the name of a performance fix, exactly the same "don't ship based on an unverified assumption that a shortcut is acceptable" discipline §Advanced Q9.
10. **Q: As a Principal Engineer, how would you present the fan-out architecture decision (push vs. pull vs. hybrid) to non-technical product stakeholders who want to understand why this is a genuinely hard problem, not just an engineering implementation detail?**
 **A:** Frame it concretely: "if we make posting instant and cheap for everyone, we pay a cost every time someone reads their feed, which happens far more often than posting — but if we make reading instant and cheap, a single post from a very popular account could overwhelm our systems trying to deliver it to every one of their millions of followers all at once; we use a hybrid approach that gives most users the fast, cheap experience while handling popular accounts differently behind the scenes, so both problems are avoided" — translating the technical push/pull trade-off into the concrete, relatable "who pays the cost, and when" framing makes the genuine engineering complexity legible to stakeholders without requiring them to understand fan-out mechanics directly, directly this course's recurring "translate technical trade-offs into business-relevant terms" communication discipline.

---

## 11. Coding Exercises

*(System design case studies use worked design exercises rather than unit-testable code, consistent with the format for this domain.)*

### Easy — Capacity estimation for the feed system
**Problem**: Estimate the fan-out write volume for a platform with 200M daily active users, averaging 2 posts/user/day, and an average follower count of 150.
**Solution**:
```
Posts/day: 200M * 2 = 400M posts/day
Fan-out writes/day (pure push, ignoring celebrity accounts): 400M * 150 = 60 billion writes/day
≈ 694,000 writes/sec average -- a substantial, but with Redis's write throughput, a
FEASIBLE number for the 'normal' (non-celebrity) account population specifically.
```
**Discussion**: This estimate directly motivates the hybrid model's necessity — even at "normal" average follower counts, the aggregate write volume is already substantial, and this estimate explicitly **excludes** celebrity accounts, whose individual posts would each independently spike this number dramatically if included in the pure-push model, concretely justifying the architectural decision with actual numbers rather than abstract reasoning alone.

### Medium — Design the Redis data model for the precomputed feed cache
```
Feed cache key: feed:{userId}
Type: Sorted Set (ZSET)
Member: postId
Score: post timestamp (Unix epoch, enabling ZRANGE-based chronological retrieval)

ZADD feed:12345 1699999999 "post:98765" -- fan-out write: add a post to a follower's feed
ZREVRANGE feed:12345 0 49 -- read: get the 50 most recent feed entries
ZREMRANGEBYRANK feed:12345 0 -1001 -- trim: bound the feed to the most recent 1000 entries
```

### Hard — Design the hybrid feed-read merge algorithm (Advanced Q2)
```csharp
public async Task<List<FeedItem>> GetFeedAsync(string userId, int count)
{
    var precomputedTask = _redis.SortedSetRangeByScoreAsync($"feed:{userId}", order: Order.Descending, take: count);
    var celebrityAccounts = await _followGraph.GetCelebrityFollowsAsync(userId); // accounts over the pull-threshold
    var celebrityPostsTask = Task.WhenAll(celebrityAccounts.Select(c => _postStore.GetRecentPostsAsync(c, count)));

    await Task.WhenAll(precomputedTask, celebrityPostsTask); // fetch BOTH sources concurrently

    var precomputed = (await precomputedTask).Select(ParseFeedItem);
    var live = (await celebrityPostsTask).SelectMany(posts => posts);

    // k-way merge (Advanced Q2) -- both inputs already individually sorted by timestamp descending
    return MergeSortedByTimestamp(precomputed, live).Take(count).ToList;
}
```
**Discussion**: `Task.WhenAll` fetching both sources **concurrently** (the async-concurrency discipline) rather than sequentially is essential here — sequentially awaiting the precomputed feed, then the celebrity posts, would needlessly add the two operations' latencies together instead of overlapping them, directly the "use `Task.WhenAll` for independent concurrent operations" best practice applied at this system's most latency-sensitive read path.

### Expert — Design the asynchronous fan-out processing pipeline with burst absorption (Advanced Q4)
```csharp
public async Task HandlePostCreatedAsync(Post post)
{
    // Post creation itself returns IMMEDIATELY -- fan-out is NOT synchronous with the user-facing request.
    await _messageQueue.PublishAsync(new FanOutJob(post.Id, post.AuthorId));
}

// Separate, independently-scaled worker fleet consumes the queue:
public async Task ProcessFanOutJobAsync(FanOutJob job)
{
    var followerCount = await _followGraph.GetFollowerCountAsync(job.AuthorId);

    if (followerCount > CelebrityThreshold)
    {
        // Celebrity account: skip push fan-out entirely -- relies on the pull path at read time
        return;
    }

    var followers = await _followGraph.GetFollowersAsync(job.AuthorId);
    var batches = followers.Chunk(1000); // batch writes, directly's
    // lock-escalation-avoidance batching discipline, applied here
    // to Redis write-batching instead of SQL Server transactions
    foreach (var batch in batches)
    {
        await _redis.BatchAsync(batch.Select(followerId =>
                new RedisCommand("ZADD", $"feed:{followerId}", post.Timestamp, post.Id)));
    }
}
```
**Discussion**: Decoupling post-creation (synchronous, fast, user-facing) from fan-out processing (asynchronous, queue-driven, independently-scalable) is precisely Advanced Q4's burst-absorption strategy — a sudden spike in post creation grows the queue's depth (a monitorable, recoverable backpressure signal, directly the Streams consumer-group backlog-monitoring pattern) rather than directly overwhelming the fan-out write path itself, and the celebrity-threshold check inside the worker (not at post-creation time) keeps the "which accounts skip push fan-out" decision centralized and easily adjustable (Advanced Q1's monitored, adjustable threshold) without touching the post-creation code path at all.

---

## 12. System Design — Designing a News Feed / Timeline System

*Authored to the four-step standard (see Module 01 §12 for the method).*

---

### Step 1 — Understand the Problem and Establish Design Scope

#### The dialogue

> **C:** Which feed are we designing? A home timeline (posts from accounts you follow) and a user timeline (one account's own posts) are different problems — the second is trivial.
> **I:** The home timeline. Assume the user timeline is a simple indexed query.
>
> **C:** What's the follower-count distribution — roughly uniform, or power-law?
> **I:** Power-law. Median user has about 200 followers; the top accounts have tens of millions.
>
> **C:** That single answer decides the architecture, so let me pin it down: what's the largest account?
> **I:** Around 50 million followers.
>
> **C:** Scale?
> **I:** 500 million registered, 200 million DAU.
>
> **C:** How often does a user read their feed versus post?
> **I:** Assume 10 feed views per DAU per day, and 0.1 posts per DAU per day.
>
> **C:** Ordering — strictly chronological, or ranked?
> **I:** Ranked, but treat ranking as a separate service. Design candidate generation.
>
> **C:** How fresh must the feed be? If someone I follow posts now, when must I see it?
> **I:** Seconds for normal accounts. For very large accounts, tens of seconds is acceptable.
>
> **C:** Media?
> **I:** Posts can carry images and video, but assume a media service exists and gives you URLs.
>
> **C:** And out of scope?
> **I:** The ranking model itself, notifications, direct messages, and the follow graph's own storage design — assume you can query "who follows X" and "who does X follow."

The fifth and sixth answers are what make this designable: **a 500:1 read:write ratio** and a **staleness budget that differs by account size**. The second is the permission slip for the hybrid model — if freshness had to be identical for all accounts, the celebrity path would be much harder.

#### Functional requirements

1. Publish a post; it becomes visible to followers.
2. Retrieve a user's home timeline, paginated, newest-first within a ranked ordering.
3. Follow / unfollow, with the feed reflecting the change.
4. Deduplicate and consistently order results merged from two different sources.

#### Non-functional requirements

| Requirement | Target |
|---|---|
| Feed read latency | p99 < 200 ms for the first page |
| Propagation — normal accounts | p99 < 5 s from post to visible |
| Propagation — large accounts | p99 < 30 s acceptable |
| Availability — read | 99.99% (a feed that won't load is the product being down) |
| Availability — write | 99.9% |
| Consistency | Eventual, **except** a user must see their own post in their own timeline immediately |
| Durability | A published post is never lost; a *feed entry* may be lost and rebuilt |

That last row is the load-bearing one: **the feed is a derived cache, not a system of record.** Anything in it can be recomputed from posts plus the follow graph. Establishing that early licenses aggressive use of Redis with eviction, and it is the reason a lost feed entry is an annoyance rather than data loss.

#### Back-of-the-envelope estimation

```
DAU                        = 200,000,000
Feed reads/day             = 200M × 10               = 2 × 10^9
Average read QPS           = 2 × 10^9 ÷ 10^5         = 20,000 reads/s
Peak (×2)                                            = 40,000 reads/s

Posts/day                  = 200M × 0.1             = 20,000,000
Average write QPS          = 20M ÷ 10^5             = 200 posts/s
Peak (×3)                                            = 600 posts/s
```

**Fan-out amplification — the number that decides everything:**

```
Average followers ≈ 200 (median; the mean is higher and misleading — say ~500)
Push fan-out writes/s = 200 posts/s × 500 = 100,000 feed writes/s   ← sustainable
Peak                  = 600 × 500         = 300,000 feed writes/s   ← still sustainable in Redis

But ONE post by a 50M-follower account = 50,000,000 writes.
At 300,000 writes/s of spare capacity, that single post takes 166 seconds
to fully propagate — and consumes the ENTIRE fan-out capacity while doing so,
delaying every other user's post behind it.
```

Storage:

```
Feed entry ≈ 30 B (post_id + score + flags), cap 800 entries/user
Per user     = 24 KB;  × 200M DAU        ≈ 4.8 TB in Redis
Posts        = 20M/day × 1 KB metadata   ≈ 20 GB/day ≈ 7 TB/year
```

#### What the numbers tell us

1. **Push fan-out is correct for the overwhelming majority of accounts.** 100k feed writes/s is unremarkable for a Redis fleet, and it converts a 20,000/s read problem into an O(1) `ZREVRANGE`.
2. **Push fan-out is catastrophic for the tail, and the failure is not "slow" — it is *shared*.** The 166-second calculation shows one celebrity post consuming the whole fan-out budget, which is why §4's incident degraded *everyone's* posting, not just the celebrity's followers. That is the difference between a capacity problem and an isolation problem, and it is the sentence that earns the score.
3. **4.8 TB of feed cache is affordable only because the feed is bounded.** Unbounded per-user feeds would grow without limit; the 800-entry cap is a correctness requirement disguised as a memory optimisation.

The hard problem is therefore **not fan-out itself but the bimodal distribution** — and the design must isolate the two populations so that one cannot consume the other's capacity.

---

### Step 2 — Propose High-Level Design and Get Buy-In

#### The two core flows

- **Write path (post creation + fan-out)** — rare, asynchronous, and the path where the celebrity problem lives.
- **Read path (feed assembly)** — 100× more frequent, latency-critical, and where the hybrid merge happens.

#### Components

**Post Service.** Accepts and persists posts. Returns fast; does not fan out inline.

**Fan-out Service.** Consumes post events, looks up followers, and writes feed entries — **but only for accounts below the celebrity threshold**. Partitioned so a single large fan-out job cannot monopolise workers.

**Celebrity Registry.** The set of accounts above the threshold. Read on both paths. Small, hot, cached everywhere.

**Feed Store (Redis).** One sorted set per user: `feed:{user_id}`, member = `post_id`, score = ranking score or timestamp. Trimmed to 800 entries.

**Feed Read Service.** Assembles a page: read the precomputed set, pull recent posts from followed celebrities, merge, deduplicate, rank, hydrate.

**Ranking Service.** Reorders an already-gathered candidate set. Deliberately separate — §2.5's separable-concerns point made structural.

**Post Store.** Source of truth for post content; the feed stores only IDs.

**Follow Graph Service.** `followers(user)` and `following(user)`. Assumed to exist per the scope dialogue.

#### End-to-end walkthrough — publishing

1. `POST /v1/posts` → Post Service validates and writes to the post store.
2. Same transaction writes an outbox row; response returns to the client (target < 300 ms).
3. **The author's own timeline is updated synchronously** — this is what satisfies "see your own post immediately" without waiting for fan-out.
4. Outbox publisher emits `PostCreated` to Kafka, partitioned by `author_id`.
5. Fan-out Service consumes. First action: **is the author a celebrity?**
   - **Yes** → do nothing. The post is served on the read path. Cost: O(1).
   - **No** → page through followers in batches of 1,000, pipelining `ZADD` + `ZREMRANGEBYRANK` per follower.
6. Inactive followers are skipped — a user who has not opened the app in 30 days gets no feed writes, and their feed is rebuilt on next login. At a 200M/500M active ratio this removes roughly 60% of all fan-out work for free.

#### End-to-end walkthrough — reading

1. `GET /v1/feed?limit=20&cursor=…`
2. Read `feed:{user_id}` via `ZREVRANGEBYSCORE` — one round trip, ~1 ms.
3. In parallel, fetch the celebrity accounts this user follows (cached per user), and read each one's recent posts from a small per-author cache (`author_posts:{id}`, last 50).
4. **k-way merge** the two already-sorted streams — not a concatenate-and-sort. Both inputs are sorted, so merging is O(n) rather than O(n log n), and at 40,000 reads/s that difference is real money.
5. Deduplicate by `post_id` (a post can legitimately appear in both streams during a threshold transition).
6. Pass the candidate set to the ranking service — reorder only, never re-gather.
7. Hydrate post content in one batch read (`MGET`), never per-post.
8. Return with an **opaque cursor** encoding `(score, post_id)` of the last item — not an offset. Offsets break under insertion, which in a feed is constant.

#### API design

**`GET /v1/feed`**

| Param | Type | Description |
|---|---|---|
| `limit` | int | Default 20, max 50 |
| `cursor` | string | Opaque; encodes `(score, post_id)` of the last item returned |
| `include` | string[] | Optional hydration hints (`author`, `media`, `counts`) |

Response: `{ items: [...], next_cursor, has_more }`. Each item: `{ post_id, author, created_at, body, media[], counts, source }` — where `source` is `PUSHED` or `PULLED`, which is *diagnostic gold* and costs nothing.

**`POST /v1/posts`** — `{ body, media_keys[], visibility }`, header `Idempotency-Key`. Returns `{ post_id, created_at }`.

**`POST /v1/follows`** — `{ target_user_id }`. Returns `202`; backfill is asynchronous (§3.3).

#### Data model

**`post`** — Cassandra, partition `author_id`, clustering `created_at DESC`.

| Column | Type | Notes |
|---|---|---|
| `author_id`, `post_id` | Partition + clustering | Naturally supports "recent posts by author" — the celebrity read path |
| `body`, `media_keys` | text / list | |
| `created_at` | timestamp | |
| `visibility` | enum | `PUBLIC`, `FOLLOWERS`, `DELETED` |

**`feed:{user_id}`** — Redis sorted set. Member `post_id`, score = ranking score. `ZADD` then `ZREMRANGEBYRANK feed:{u} 0 -801` on every write — **the trim is not optional**, and omitting it is the single most common way this design fails in production.

**`celebrity_accounts`** — a Redis set plus in-process cache with a short TTL, refreshed by a job that recomputes membership from follower counts.

**`author_posts:{author_id}`** — Redis list, last 50 posts, maintained for *all* accounts but only *read* for celebrities.

#### Database selection, and why

| Store | Choice | Reason |
|---|---|---|
| Posts | **Cassandra** | Write-heavy, append-only, partition-by-author matches both access patterns exactly, linear scale-out. No joins needed — the feed stores IDs |
| Feed entries | **Redis sorted sets** | The access pattern *is* "top-N by score", which is `ZREVRANGE`'s native operation. Feed data is derived, so eviction is survivable — which is precisely what makes an in-memory store acceptable for 4.8 TB |
| Follow graph | **Sharded MySQL / graph store** | Out of scope per the dialogue, but note the shape: `followers(x)` needs an index on the reverse edge |
| Post content hydration | **Redis + Cassandra fallback** | Batch `MGET` on the hot path |

The decision worth defending: **the feed is not in a database.** It is a derived, bounded, evictable cache. Saying so explicitly changes what durability and consistency you owe it, and candidates who model feed entries as durable rows end up designing a far more expensive system for no benefit.

---

### Step 3 — Design Deep Dive

#### 3.1 The hybrid threshold — where it comes from, and why it must move

The threshold separating push from pull is not a constant; it is the point where a single account's fan-out cost exceeds what the shared fan-out tier can absorb without delaying others. Derive it rather than guessing:

```
Fan-out capacity            ≈ 300,000 feed writes/s
Acceptable monopolisation   ≈ 10% of capacity for ≤ 5 s  = 150,000 writes
Threshold                   ≈ 100,000 followers
```

Accounts above ~100k followers go pull. But **the distribution shifts as the platform grows** — §4's incident is exactly a threshold that was correct at launch and silently became wrong. So:

- The celebrity set is **recomputed continuously**, not configured.
- The threshold itself is a **monitored parameter** with a dashboard showing fan-out job duration distribution; when the p99 job starts consuming a growing share of capacity, the threshold is too high.
- Transitions must be handled: an account crossing the threshold upward leaves stale pushed entries in follower feeds (harmless — dedup catches them); crossing downward means its recent posts are missing from feeds until the next post, which is why the read path keeps pulling for a grace period after demotion.

#### 3.2 The merge, and the ordering trap

Merging a pushed stream (scores assigned at fan-out time) with a pulled stream (scores computed at read time) is only correct if both use the **same scoring function evaluated over the same inputs**. They usually do not, because the pushed score was computed minutes ago against then-current engagement counts.

Two workable resolutions:

- **Score at read time for both streams.** The feed store then holds `post_id` ordered by *timestamp* only, and ranking happens uniformly after the merge. Simple, correct, and costs a scoring pass over ~200 candidates per read — which at 40,000 reads/s is a real but affordable CPU line.
- **Score at write time and accept drift**, re-scoring only the top page. Cheaper, and the drift is usually below perceptual threshold.

**Recommendation: timestamp in the store, ranking after the merge.** It keeps the store's semantics simple (chronological is unambiguous), makes the two streams genuinely comparable, and preserves §2.5's separation — candidate generation and ranking stay independent, which means the ranking model can be changed without touching the fan-out path at all. That decoupling is worth more than the CPU it costs.

#### 3.3 Follow and unfollow — the backfill problem

Following someone should show their content. Three options, and the naive one is wrong:

- **Backfill on follow** — read the new followee's recent posts and inject them into the follower's feed. Correct-looking, but a user who follows 50 accounts in a session triggers 50 backfills, and a bot following thousands is a denial-of-service vector against your own fan-out tier.
- **Nothing; new posts only** — the feed looks empty for a new user, which is the worst possible first-run experience.
- **Backfill asynchronously, bounded, with a read-time union for the gap** — enqueue a bounded backfill job (last 20 posts, rate-limited per user), and until it completes, the read path unions the followee's recent posts directly.

Take the third. Unfollow is the mirror image and is easier: **do not** scrub the feed synchronously (that is another fan-out); instead filter at read time against the current following set, and let the trim eventually evict the entries. Filtering at read time is cheap because the follow set is already loaded for the celebrity pull.

#### 3.4 Failure handling

- **Fan-out consumer lag** → posts propagate slowly. Detect on **consumer lag per partition**, not aggregate, because a single celebrity's partition is exactly where lag concentrates and an average hides it.
- **Redis node loss** → those users' feeds are gone. Because the feed is derived, the correct response is **rebuild on read**, not restore from backup: a miss on `feed:{u}` triggers a synchronous, bounded pull-based assembly and repopulation. This must be rate-limited, or a node loss becomes a thundering herd against the post store.
- **Post store unavailable** → feeds render from cached hydration where possible; degrade to IDs-with-placeholders rather than an error.
- **Ranking service unavailable** → **fall back to chronological.** A worse-ordered feed is a working product; an error page is not. Making this fallback explicit is the difference between a resilient design and one that has a hidden hard dependency on an ML service.

#### 3.5 Hot spots and the read path's own tail

A celebrity's `author_posts:{id}` key is read by every one of their followers on every feed load — tens of thousands of reads per second against a single Redis key on a single shard. Mitigations: replicate the key across N shards with a random read (`author_posts:{id}:{0..15}`), or cache it in-process on the feed-read service with a 1–2 s TTL. The in-process cache is usually right: it is the same data for everyone, staleness of a second is within budget, and it removes the hot key entirely.

This is worth naming because it is the *second* celebrity problem — the write-side one is famous, the read-side one is what actually pages you.

---

### Step 4 — Wrap-Up

**What we left out**, and would be next: the ranking model (features, training, and the online/offline skew); notification fan-out (Module 20, structurally the same problem with different delivery semantics); media pipeline (Module 05); abuse and rate limiting (Modules 04, 15); multi-region feed assembly, where the follow graph's locality determines whether it is even feasible; and privacy filtering (blocked users, private accounts) which must apply at read time and interacts badly with precomputation.

**What we would measure:** fan-out job duration **distribution** — not the mean, since the mean is the metric that hid §4's incident; consumer lag per partition; feed-read p99 split by `PUSHED`/`PULLED` composition; feed cache hit rate and rebuild-on-read rate; the follower-count distribution itself, as a standing metric, because it is the assumption the whole architecture rests on; and merge dedup counts, which should be small and non-zero — zero means the pull path is not firing.

**Summary.** The design is push for the body of the distribution, pull for the tail, merged at read time with ranking applied after the merge. The estimation is what justifies it: push alone breaks on a 50-million-follower account by monopolising shared capacity, and pull alone pays a scatter-gather on every one of 40,000 reads/s. The engineering that earns the score is in the three places the naive hybrid gets wrong — deriving the threshold instead of hardcoding it, making both streams comparable before merging, and treating the feed as derived so a lost cache node is a rebuild rather than an outage.

---

### References

1. Twitter Engineering — *The Infrastructure Behind Twitter: Scale* and the timeline fan-out architecture (the canonical hybrid).
2. Raffi Krikorian — *Timelines at Scale* (QCon) — the original public description of push/pull hybridisation.
3. Facebook Engineering — *Scaling Memcache at Facebook* (NSDI '13) — hot-key handling and lease-based stampede control.
4. Instagram Engineering — *Sharding & IDs at Instagram* — time-sortable IDs, which make cursor pagination correct.
5. Redis docs — sorted sets, `ZREVRANGEBYSCORE`, `ZREMRANGEBYRANK` (the trim that bounds the feed).
6. Alex Xu — *System Design Interview Vol. 1*, ch. 11 "Design a News Feed System".
7. LinkedIn Engineering — *Feed personalization and the candidate-generation / ranking split*.
8. Cassandra docs — partition and clustering key design for time-series-shaped data.

---

## 13–17. LLD / Debugging / Decision / Case Study / Principal

*(This module predates the full 16-section template; its incident, worked exercises, and Advanced-tier Q&A collectively carry this content. §12 above was authored to the four-step standard on 2026-08-09.)*

## 18. Revision
**Key takeaways**: The fan-out decision (push vs. pull vs. hybrid) is the defining architectural choice for any feed/timeline system, determined primarily by the actual follower-count distribution — a non-functional requirement that can silently change as a platform grows (the celebrity problem). Ranking is a separable concern from candidate-gathering/fan-out — don't conflate the two design axes. Precomputed feed caches need explicit bounding/trimming (Redis ZSet + `ZREMRANGEBYRANK`), directly paralleling the unbounded-embedding lesson. Merging precomputed and live-pulled results should use an efficient k-way merge (both streams already sorted), not a full re-sort. Asynchronous, queue-based fan-out processing absorbs traffic bursts as monitorable backpressure rather than overwhelming the write path directly.

---

**Next**: Continuing autonomously to Module 39 — Designing a Chat/Messaging System (WebSockets, message ordering, delivery guarantees) as the next fully-worked system-design case study.
