# Module 41 — System Design: Designing YouTube / a Video Streaming Platform

> Domain: System Design | Level: Beginner → Expert | Prerequisite: [[01-System-Design-Fundamentals]], [[02-Designing-News-Feed-System]] (recommendation/ranking parallels), [[../07-Redis/01-Data-Structures-Caching-Patterns]] (counters for view-count aggregation)

---

## 1. Fundamentals

### What makes a video-streaming platform a distinct system-design problem from everything covered so far?
YouTube's core challenge is **large, immutable binary content** (video files, often gigabytes each) that must be (a) ingested and processed (transcoded into multiple resolutions/formats) asynchronously and reliably, (b) stored durably and cost-efficiently at massive aggregate scale (exabytes), and (c) **streamed** to millions of concurrent viewers with low startup latency and adaptive quality — a fundamentally different data shape than the small, structured records (orders, messages, posts) every prior system-design module has centered on.

### Why does this matter?
Because it forces genuinely new architectural concerns this course hasn't yet addressed head-on: **chunked/resumable upload** for large files, an **asynchronous transcoding pipeline** (directly extending the asynchronous fan-out-processing pattern to a far more compute-intensive workload), and **CDN-centric delivery** as the *primary* serving mechanism rather than an optimization layered on top (the CDN discussion, here promoted to the system's central design decision rather than a secondary latency win).

### When does this matter?
Any system serving large media content at scale (video, audio, large file downloads); the depth matters for correctly separating the **write path** (upload → transcode → store) from the **read path** (CDN-served streaming, decoupled entirely from the write path's complexity) and for reasoning about adaptive bitrate streaming as a client-driven, not server-driven, mechanism.

### How does it work (30,000-ft view)?
```
1. Upload: client -> chunked/resumable upload -> raw video landed in object storage (e.g., S3-equivalent)
2. Transcode: async pipeline generates multiple resolutions/bitrates + thumbnails, stored in object storage
3. Publish: metadata (title, description, available renditions) written to a database; video marked "ready"
4. Stream: client requests a manifest (list of available quality levels) -> CDN serves video chunks,
 client adaptively switches quality based on its own measured bandwidth
```

---

## 2. Deep Dive

### 2.1 Chunked, Resumable Upload — Why Large Files Can't Use an Ordinary HTTP POST
A multi-gigabyte video file cannot be reliably uploaded as a single HTTP request — any network interruption partway through would require restarting the entire upload from scratch, and many infrastructure components (load balancers, gateways, the own gateway tier) impose practical request-size/duration limits. The standard solution: the client splits the file into chunks (e.g., 5-10MB each), uploads each independently (with retry-per-chunk, directly the retry-with-backoff pattern applied per chunk rather than the whole file), and the server reassembles/acknowledges completion once all chunks arrive — directly analogous to §Advanced Q2's external-merge-sort chunking discipline, here applied to network transfer instead of disk-bound sorting, and to the idempotency-key pattern (each chunk upload should be idempotent, safely retryable without corrupting the reassembled file).

### 2.2 The Transcoding Pipeline — Asynchronous, Compute-Intensive Fan-Out
Once a raw video is uploaded, it must be transcoded into multiple resolutions (240p, 480p, 720p, 1080p, 4K) and formats/codecs, each transcoding job being CPU/GPU-intensive and taking anywhere from seconds to hours depending on video length and target quality. This is architecturally a **fan-out** problem (one input video, many independent output renditions) processed via a **message-queue-driven worker fleet** (directly §Advanced Q4's asynchronous, burst-absorbing fan-out pipeline, and the Streams-based durable job processing) — each rendition is an independent job that can be retried, parallelized across many workers, and monitored independently (a failed 1080p transcode shouldn't block the 480p rendition from becoming available, letting a video go "live" progressively as lower-resolution renditions complete first, even before the highest-quality rendition finishes).

### 2.3 Adaptive Bitrate Streaming — Client-Driven Quality Switching
Rather than the server deciding what quality to send, standard streaming protocols (HLS, DASH) have the server publish a **manifest** listing all available quality renditions (each broken into small, independently-requestable segments, typically a few seconds each) — the **client** continuously measures its own actual download throughput and **dynamically switches** which rendition it requests for the *next* segment, seamlessly adapting to changing network conditions (a viewer's bandwidth dropping mid-video) without an interruption or manual quality change — this client-driven model is precisely why the transcoding pipeline must produce multiple discrete quality levels upfront, rather than the server attempting to dynamically re-encode on the fly per viewer (computationally infeasible at this scale).

### 2.4 CDN as the Primary Delivery Mechanism, Not a Cache Layered on Top
Unlike the CDN discussion (framed as a latency-optimization layered onto an origin-server-centric design), a video platform's CDN **is** the primary serving path for the overwhelming majority of view traffic — the origin (object storage) is touched only on a genuine cache miss (a video's first view in a given geographic region, or an unpopular, rarely-viewed video), with the CDN absorbing the vast majority of aggregate bandwidth (video content is enormous relative to typical API response sizes, making origin-server-direct-serving at this scale economically and technically infeasible) — this reframes the CDN from "nice latency win" to "the actual system," directly informing why video URLs are typically CDN-domain URLs from the start, not origin URLs with a CDN transparently interposed.

### 2.5 View-Count Aggregation — a High-Write-Volume Counter Problem
Every video view increments a counter — at YouTube's scale, this is an extremely high-frequency write operation that **cannot** be a synchronous, strongly-consistent database increment on every single view (the row-level locking/contention concerns from the SQL Server modules would make this a severe bottleneck) — the standard approach: buffer view events into a message queue/stream, aggregate counts in batches (e.g., incrementing an in-memory or Redis counter, the atomic `INCR`, per short time window), and periodically flush aggregated batch totals to the durable, authoritative datastore — trading strict, real-time-exact view counts for a system that can actually sustain the write volume, directly the same "batch high-frequency writes rather than synchronously persisting each individually" discipline behind lock-escalation-avoidance batching, now applied to counter aggregation instead of bulk updates.

## 3. Visual Architecture
```mermaid
graph TB
 subgraph "Write Path (upload + transcode)"
 Client1[Uploader] -->|chunked, resumable| RawStorage[("Raw Video Storage")]
 RawStorage --> Queue["Transcoding Job Queue"]
 Queue --> Worker1["Transcode Worker (240p)"]
 Queue --> Worker2["Transcode Worker (1080p)"]
 Worker1 --> RenditionStorage[("Rendition Storage + CDN Origin")]
 Worker2 --> RenditionStorage
 RenditionStorage --> Metadata[("Video Metadata DB<br/>-- marks renditions ready")]
 end
 subgraph "Read Path (streaming)"
 Client2[Viewer] -->|request manifest| Metadata
 Client2 -->|adaptive segment requests| CDN["CDN Edge (primary serving path)"]
 CDN -.->|cache miss only| RenditionStorage
 end
 subgraph "View-count aggregation"
 Client2 -->|view event| ViewQueue["View Event Stream"]
 ViewQueue --> Aggregator["Batch Aggregator (Redis counters)"]
 Aggregator -->|periodic flush| Metadata
 end
```

## 4. Production Example
**Scenario**: A video platform's transcoding pipeline processed all resolutions for a given video as a **single, monolithic job** (one worker handling 240p through 4K sequentially for one video before moving to the next video in the queue) — under normal upload volume this worked adequately, but during a period of unusually high upload volume (a coordinated content-creator upload event), the queue backed up severely: videos took hours to become available in **any** resolution, since even the fastest, cheapest rendition (240p) was blocked behind the same job's slower, more expensive renditions (1080p, 4K) for every video ahead of it in the queue. **Investigation**: confirmed the monolithic per-video job design meant a single video's total processing time (dominated by its most expensive rendition) gated when *any* of its renditions became available, and this blocking effect compounded across the backlog — even videos whose 240p rendition could have been ready in seconds were stuck behind other videos' multi-hour 4K transcodes. **Fix**: split the transcoding pipeline into independent, per-rendition jobs — a video's 240p job is entirely independent of its 1080p job, allowing a low-resolution rendition to complete and make the video watchable (at lower quality) within moments of upload, while higher-resolution renditions continue processing in the background, with the video's available-quality-levels list in the metadata store updated incrementally as each rendition completes. **Lesson**: a monolithic job design that bundles genuinely independent work (each resolution rendition) creates unnecessary head-of-line blocking — decomposing into independent, separately-queued, separately-prioritizable jobs (directly the "match the structure to the actual independence of the work" theme and the fan-out-job-independence principle) is what allows a system to make partial progress visible to users quickly, rather than an all-or-nothing wait for the single slowest component of a bundled unit of work.

## 5. Best Practices
- Decompose the transcoding pipeline into independent, per-rendition jobs, never a single monolithic per-video job (the incident) — allowing partial availability as soon as any individual rendition completes.
- Use chunked, resumable upload with per-chunk retry for any large-file ingestion path.
- Treat the CDN as the primary serving mechanism for video content, not a secondary optimization — design URLs and cache-control headers with CDN-first serving as the default assumption.
- Aggregate high-frequency counters (view counts, likes) via batched, eventually-consistent updates rather than synchronous per-event database writes.

## 6. Anti-patterns
- A monolithic, all-renditions-in-one-job transcoding design causing unnecessary head-of-line blocking (the incident).
- Synchronous, per-view database increments for view counts, creating an unsustainable write-contention bottleneck at scale.
- Serving video content directly from origin storage without a CDN, both economically and technically infeasible at meaningful scale.
- Attempting server-side, per-viewer dynamic quality selection instead of the standard client-driven adaptive-bitrate model.

---

## 10. Interview Questions

### Basic (10)
1. **Q: Why can't a large video file be uploaded as a single HTTP request?** **A:** Network interruptions would require restarting the entire upload; infrastructure components often impose practical size/duration limits — chunked, resumable upload solves both.
2. **Q: What is transcoding?** **A:** Converting an uploaded video into multiple resolutions/formats/bitrates for adaptive delivery.
3. **Q: What is adaptive bitrate streaming?** **A:** A client-driven mechanism where the player dynamically switches between available quality renditions based on its own measured network throughput.
4. **Q: Why is the CDN considered the primary delivery mechanism for video, not just a cache?** **A:** Video content volume is enormous; serving it directly from origin at scale is both economically and technically infeasible — the CDN absorbs the vast majority of actual serving traffic.
5. **Q: Why can't view counts be incremented synchronously on the database for every single view?** **A:** The write volume at scale would create severe database contention — counts are instead batched/aggregated asynchronously.
6. **Q: What is a manifest, in adaptive streaming terms?** **A:** A file listing all available quality renditions and their segment locations, which the client uses to make streaming decisions.
7. **Q: Why should transcoding be split into independent per-rendition jobs rather than one monolithic per-video job?** **A:** To avoid a video's fastest, cheapest rendition being blocked behind its slowest, most expensive rendition, allowing partial availability sooner.
8. **Q: What is a signed URL used for in this context?** **A:** Allowing a CDN to serve access-controlled content by validating a time-limited, cryptographically-signed URL without needing to understand the platform's own authorization logic.
9. **Q: Why might older, rarely-viewed videos use different storage than recently-uploaded, popular ones?** **A:** Storage tiering by access frequency — hot content on fast/CDN-adjacent storage, cold content on cheaper archival storage.
10. **Q: What two protocols are commonly used for adaptive bitrate streaming?** **A:** HLS (Apple's, dominant for device compatibility) and DASH (the MPEG standard) — both segment video into small chunks encoded at multiple bitrate "ladder" renditions listed in a manifest, letting the *client* switch quality per segment based on measured bandwidth, over plain HTTP that CDNs cache natively.

### Intermediate (10)
1. **Q: Why does per-chunk retry (not whole-file retry) matter for upload reliability?** **A:** A network interruption only requires retrying the specific failed chunk, not re-uploading gigabytes of already-successfully-transferred data — directly the retry-with-backoff pattern applied at chunk granularity.
2. **Q: Why is the transcoding pipeline architecturally similar to the asynchronous fan-out processing?** **A:** Both decouple an expensive, independent-per-item operation (fan-out to followers; transcoding to a specific rendition) from the triggering event via a message queue, allowing independent scaling, retry, and burst absorption.
3. **Q: Why does client-driven adaptive bitrate switching avoid the need for server-side per-viewer dynamic encoding?** **A:** Since all renditions are pre-generated upfront by the transcoding pipeline, the client simply requests whichever pre-existing rendition's segments match its current measured bandwidth — no real-time encoding decision is needed server-side at all.
4. **Q: Why does view-count aggregation trade exactness for sustainability, and is this an acceptable trade-off?** **A:** Batched, eventually-consistent counts might be briefly inaccurate (a few seconds/minutes behind the true real-time count) but the alternative (synchronous, exact per-view increments) doesn't scale — for a metric like view count, brief inexactness is an entirely acceptable, standard trade-off, unlike a genuinely financial counter.
5. **Q: Why does a signed URL's expiration matter for security, not just its signature?** **A:** Without expiration, a leaked/shared signed URL would grant indefinite access to the content — a short expiration window limits the exposure of a leaked URL to a bounded time period.
6. **Q: Why might content moderation run as part of the transcoding pipeline rather than as a separate, later process?** **A:** Running it as another independent job within the same fan-out structure lets it gate public availability (or flag for review) using the same infrastructure already processing the video, rather than requiring an entirely separate system to be built and coordinated.
7. **Q: Why is "time-to-first-frame" a distinct metric from ordinary API request latency?** **A:** It specifically measures the user-perceived delay before playback visibly begins, influenced by manifest-fetch time and initial segment delivery — a video-specific UX metric with no direct analog in a typical request/response API.
8. **Q: Why might a platform choose not to pre-generate every resolution for every uploaded video upfront?** **A:** Storage/compute cost for renditions that may rarely or never be requested (e.g., 4K for an obscure, rarely-viewed video) can be avoided by generating them on-demand only when actually requested, trading a first-request latency cost for reduced storage/compute expenditure on unpopular content.
9. **Q: Why does the read path (streaming) scale largely independently of the write path (upload/transcode)?** **A:** They're architecturally decoupled — the read path serves already-transcoded, CDN-cached content with no dependency on the write path's current load, meaning a surge in uploads doesn't directly degrade streaming performance for existing content, and vice versa.
10. **Q: Why does DRM integration represent a genuinely additional architectural layer, not just a configuration option?** **A:** It requires encryption of content, license-server validation as part of the playback flow, and coordination with the adaptive-bitrate mechanism itself — a meaningfully more complex requirement than standard, unencrypted content delivery.

### Advanced (10)
1. **Q: Diagnose the monolithic-transcoding-job production incident from first principles, and design the job-prioritization strategy that would further improve on the basic per-rendition-job fix.**
 **A:** Beyond simply splitting into independent per-rendition jobs (the baseline fix), prioritize the queue itself so that **every video's lowest-resolution rendition** is processed before **any video's highest-resolution rendition**, system-wide (a priority-queue-based scheduling policy, rather than simple FIFO-per-job-type) — this ensures that during a backlog, the maximum number of videos become minimally watchable as quickly as possible, rather than a strict FIFO ordering that could still let one video's 240p job wait behind another video's already-queued (but lower-priority) 1080p job.
2. **Q: Design the metadata schema tracking a video's per-rendition availability state, supporting the "watchable at lower quality while higher quality still processes" requirement.**
 **A:**
 ```
 Video: { id, title, status: "processing" | "partially_ready" | "ready", uploadedAt }
 Renditions: { videoId, resolution, status: "queued" | "processing" | "ready" | "failed", cdnUrl }
 ```
 The video's overall `status` becomes `"partially_ready"` as soon as **any** rendition reaches `"ready"` (making it watchable, at whatever quality is currently available), transitioning to fully `"ready"` once all intended renditions complete — the client's manifest request simply reflects whichever renditions currently have `status: "ready"`, naturally supporting progressive quality availability without any special-case logic beyond querying current rendition state.
3. **Q: Explain how you would design a strategy for handling a transcoding job that fails repeatedly (a corrupted upload, an unsupported codec), avoiding an infinite retry loop.**
 **A:** Directly §Advanced Q7's dead-letter-queue pattern — track a per-job retry count, and after a configured maximum, move the job to a dead-letter queue for manual/automated investigation rather than continuing to retry indefinitely, surfacing the failure to the uploader (a "your video couldn't be processed, please check the file format" notification) rather than leaving it silently stuck in a perpetual retry state.
4. **Q: Design a strategy for pre-warming CDN edge caches for an anticipated high-demand event (a scheduled video premiere), rather than relying purely on reactive, first-request cache population.**
 **A:** Proactively push the video's renditions to CDN edge nodes in advance of the scheduled release time (a CDN "pre-fetch"/"pre-warm" API call, if the CDN provider supports it, or a synthetic traffic pattern simulating requests from each target edge region shortly before release) — directly the same "proactive versus reactive" distinction as §Advanced Q1's claims-transformation caching discussion, here applied to avoid every viewer in a newly-popular region experiencing an origin-fetch cache-miss penalty simultaneously at the exact moment of peak anticipated demand.
5. **Q: How would you design the view-count aggregation system to also support near-real-time "live viewer count" for a live-streaming feature, which has a stricter freshness requirement than on-demand video view counts?**
 **A:** Live viewer count needs a shorter aggregation window (seconds, not minutes) and a different underlying mechanism — rather than batching for eventual database persistence, use a Redis-based, TTL-expiring per-viewer "heartbeat" key (directly §Advanced Q2's connection-registry-heartbeat pattern, here repurposed for presence/viewer-counting instead of connection routing) with the current live count computed as a fast `SCARD`/count of currently-non-expired heartbeat keys — trading the on-demand system's batched-for-durability approach for a live, ephemeral, Redis-native presence-counting mechanism better suited to this stricter freshness requirement.
6. **Q: Explain the trade-off between generating a large number of discrete quality renditions (more storage/compute cost, finer-grained adaptive-bitrate switching) versus a small number of coarse renditions (less cost, coarser quality steps).**
 **A:** More renditions let the adaptive-bitrate client more precisely match its available bandwidth (smaller quality "jumps" when switching), improving perceived smoothness, but linearly increases transcoding compute cost and storage footprint per video; fewer renditions reduce cost but risk a more jarring quality transition (or wasted bandwidth if the closest available rendition is meaningfully lower quality than the client's actual capacity supports) — most platforms settle on an empirically-tuned handful of renditions (e.g., 5-6 resolution tiers) balancing this cost/quality-granularity trade-off, rather than either extreme.
7. **Q: Design a strategy for handling copyright/content-identification matching (e.g., YouTube's Content ID system) within this architecture, without significantly slowing down the time-to-availability for legitimate uploads.**
 **A:** Run content-fingerprint matching (comparing the uploaded video's audio/video fingerprint against a database of known copyrighted content) as **another independent, parallel job** within the same transcoding fan-out structure (/Advanced Q1) rather than a serial, gating step before transcoding begins — a video can become watchable via its lowest-resolution rendition while content-ID matching runs concurrently in the background, with any resulting copyright action (a claim, a takedown) applied after the fact if a match is found, rather than delaying every single upload's availability by the fingerprint-matching step's own processing time.
8. **Q: A team proposes storing every video's every rendition, indefinitely, on the fastest available storage tier "to guarantee the best possible playback experience for every video regardless of age or popularity." Evaluate this as a Principal Engineer.**
 **A:** Push back on the cost implications — this ignores the power-law popularity distribution where the overwhelming majority of storage/serving cost should be justified by actual, ongoing view volume, not applied uniformly regardless of demand; recommend storage tiering as the standard, cost-effective approach, reserving the "guarantee best experience regardless of age" goal specifically for content genuinely expected to have sustained long-tail demand (evaluated via actual view-history data, not a blanket policy) — directly this course's recurring "match infrastructure investment to demonstrated, measured need" discipline (§Advanced Q9), now applied to storage-tiering economics specifically.
9. **Q: Explain how you would design the system to gracefully handle a viewer's network condition degrading mid-playback, beyond simply "the client switches to a lower rendition."**
 **A:** The client's adaptive-bitrate logic should also maintain a small local buffer of upcoming segments (a few seconds ahead of current playback position) specifically to absorb brief network hiccups without an immediately visible playback stall — the buffer size itself is a genuine trade-off (a larger buffer better tolerates brief network drops but increases startup latency and memory usage, and delays the client's own reaction time to a *sustained* quality-appropriate-rendition switch) — a complete answer addresses both the quality-switching mechanism and this buffering trade-off together, since they jointly determine the actual viewer-perceived resilience to changing network conditions.
10. **Q: As a Principal Engineer, how would you decide whether to build a custom CDN/edge infrastructure versus using a third-party CDN provider for a growing video platform?**
 **A:** Weigh the platform's actual scale/growth trajectory (a third-party CDN's pay-as-you-go model is typically far more cost-effective and operationally simpler at low-to-moderate scale) against the potential for custom infrastructure to provide meaningfully better cost-efficiency or control at truly massive, sustained scale (which is why YouTube, Netflix, and similarly enormous platforms have historically built significant custom CDN/edge infrastructure) — recommend starting with a mature third-party CDN provider by default (directly this course's recurring "don't build custom infrastructure without a demonstrated, measured need the off-the-shelf option can't meet," §Advanced Q9/ §Advanced Q8's recurring theme), revisiting the build-vs-buy decision only once actual, sustained scale and cost data justify the very substantial investment custom CDN infrastructure requires.

---

## 11. Coding Exercises

*(System design case studies use worked design exercises, consistent with this domain's format.)*

### Easy — Capacity estimation for storage growth
**Problem**: Estimate 5-year storage growth for a platform receiving 500 hours of video uploaded per minute, averaging 1GB/hour of raw footage before transcoding, with transcoding producing renditions totaling roughly 2x the raw footage size.
**Solution**:
```
Raw upload volume: 500 hours/min * 1GB/hour = 500 GB/min raw
Per day: 500 GB/min * 1440 min = 720 TB/day raw
Total (including transcoded renditions, ~2x raw): 720 TB * 3 (raw + renditions) ≈ 2.16 PB/day
Over 5 years: 2.16 PB/day * 365 * 5 ≈ 3,942 PB (~3.9 Exabytes)
```
**Discussion**: This exabyte-scale number immediately justifies both storage tiering and the "don't pre-generate every rendition for every video indefinitely" trade-off (/Advanced Q8) as economic necessities, not optional optimizations — at this scale, uniform "store everything on the fastest tier forever" is simply not economically viable.

### Medium — Per-rendition transcoding job queue design (the fix)
```csharp
public record TranscodeJob(string VideoId, string Resolution, int Priority); // Priority: lower resolution = higher priority (Advanced Q1)

public class TranscodeJobScheduler
{
    private readonly PriorityQueue<TranscodeJob, int> _queue = new; // the array-backed heap

    public void Enqueue(TranscodeJob job) => _queue.Enqueue(job, job.Priority);

    public async Task ProcessNextAsync(ITranscodeWorker worker)
    {
        if (_queue.TryDequeue(out var job, out _))
        {
            await worker.TranscodeAsync(job.VideoId, job.Resolution);
            await _metadataStore.MarkRenditionReadyAsync(job.VideoId, job.Resolution); // Advanced Q2's schema
        }
    }
}
```

### Hard — Signed URL generation and validation for access-controlled content
```csharp
public class SignedUrlService
{
    private readonly byte[] _signingKey;

    public string GenerateSignedUrl(string videoPath, TimeSpan validFor)
    {
        long expiryUnixTime = DateTimeOffset.UtcNow.Add(validFor).ToUnixTimeSeconds;
        string dataToSign = $"{videoPath}:{expiryUnixTime}";
        string signature = ComputeHmacSha256(dataToSign, _signingKey);
        return $"https://cdn.example.com{videoPath}?expires={expiryUnixTime}&sig={signature}"
    }

    // CDN edge-side validation logic (conceptually -- CDNs typically support this via an edge function):
    public bool ValidateSignedUrl(string videoPath, long expires, string providedSignature)
    {
        if (DateTimeOffset.UtcNow.ToUnixTimeSeconds > expires) return false; // expired
        string expectedSignature = ComputeHmacSha256($"{videoPath}:{expires}", _signingKey);
        return CryptographicOperations.FixedTimeEquals(// constant-time comparison -- avoids a timing attack
            Encoding.UTF8.GetBytes(expectedSignature), Encoding.UTF8.GetBytes(providedSignature));
    }
}
```
**Discussion**: `FixedTimeEquals` (constant-time string comparison) is a deliberate, security-relevant detail — a naive `==`/`Equals` comparison could leak timing information about how many leading characters of the signature matched, a genuine (if narrow) timing-attack vector directly analogous to the authentication-timing-side-channel discussion, here applied to signature validation instead of password comparison.

### Expert — Batched view-count aggregation pipeline
```csharp
public class ViewCountAggregator: BackgroundService
{
    private readonly IConnectionMultiplexer _redis;
    private readonly IVideoMetadataStore _metadataStore;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); // batch flush interval

            var db = _redis.GetDatabase;
            var dirtyVideoIds = await db.SetMembersAsync("dirty-view-counts");

            foreach (var videoId in dirtyVideoIds)
            {
                long count = (long)await db.StringGetAsync($"views:{videoId}");
                await _metadataStore.SetViewCountAsync(videoId.ToString, count); // periodic flush to durable store
            }
            await db.KeyDeleteAsync("dirty-view-counts"); // reset dirty-tracking for the next batch window
        }
    }
}

// On each view event (called from the request-handling path, NOT this background service):
public async Task RecordViewAsync(string videoId)
{
    var db = _redis.GetDatabase;
    await db.StringIncrementAsync($"views:{videoId}"); // fast, atomic
    await db.SetAddAsync("dirty-view-counts", videoId); // track which videos need their next flush
}
```
**Discussion**: The "dirty set" tracking (only flushing videos that actually received views since the last batch, not scanning every video in the system every 30 seconds) is the key efficiency detail — directly the same "only process what actually changed" principle as the replication-slot/WAL mechanics and the Streams consumer-group tracking, here applied to make the periodic flush's cost proportional to actual view activity rather than total video catalog size.

---

## 12. System Design — Designing a Video Streaming Platform

*Authored to the four-step standard (see Module 01 §12 for the method).*

---

### Step 1 — Understand the Problem and Establish Design Scope

#### The dialogue

> **C:** Video-on-demand or live streaming? They share almost nothing below the manifest.
> **I:** VOD only. Live is out of scope.
>
> **C:** Who uploads — a small set of studios, or every user?
> **I:** Every user. Creator-uploaded, arbitrary length and quality.
>
> **C:** Scale, on both sides? Upload volume and watch volume are separate problems.
> **I:** 500 hours uploaded per minute. 1 billion watch-hours per day.
>
> **C:** Global?
> **I:** Yes, worldwide.
>
> **C:** Do we need DRM and paid content?
> **I:** No DRM. Assume public and unlisted videos only; access control is a signed-URL problem at most.
>
> **C:** How quickly must a video be watchable after upload?
> **I:** Ideally minutes. It's acceptable for high resolutions to arrive later than low ones.
>
> **C:** That's useful — it means renditions can publish progressively. Do we need exact view counts?
> **I:** Approximate is fine, but they must not drift permanently or be gameable.
>
> **C:** Out of scope?
> **I:** Recommendations, comments, search, monetisation, and the mobile player itself.

The seventh answer is worth more than it looks: **"low resolutions may publish before high ones"** converts transcoding from a blocking, monolithic job into an independently-schedulable fan-out — which is exactly the defect §4 documents, pre-empted by one clarifying question.

#### Functional requirements

1. Resumable upload of arbitrarily large files.
2. Transcode into a rendition ladder (240p…4K) plus thumbnails, asynchronously and independently.
3. Package for adaptive streaming (HLS/DASH) and publish a manifest.
4. Stream to players worldwide with low startup latency and adaptive quality.
5. Track view counts at high write volume without exact-per-view durability.
6. Publish progressively: a video becomes watchable as soon as *any* rendition is ready.

#### Non-functional requirements

| Requirement | Target |
|---|---|
| Playback start time | p95 < 2 s |
| Rebuffer ratio | < 0.5% of playback time |
| Upload durability | **Zero loss** of an acknowledged upload — the creator cannot re-shoot |
| Time-to-first-rendition | p95 < 10 min for a 10-minute video |
| Availability — playback | 99.99% |
| Availability — upload | 99.9% (a failed upload is retryable; a failed playback is churn) |
| Storage durability | 11 nines (object storage class) |
| Cost | **A first-class requirement here**, not an afterthought — see the estimation |

#### Back-of-the-envelope estimation

**Ingest:**

```
Upload rate       = 500 hours/min × 60 × 24        = 720,000 hours/day
Source bitrate    ≈ 10 Mbps                        ≈ 4.5 GB/hour
Raw ingest        = 720,000 × 4.5 GB               ≈ 3.2 PB/day
```

**Transcode compute — the number that sizes the fleet:**

```
Ladder: 240p, 480p, 720p, 1080p, 4K  (5 renditions)
Transcode speed ≈ 0.5× realtime per core for the mid ladder,
much worse for 4K; blended ≈ 1.5 core-hours per source-hour per rendition
Compute = 720,000 h/day × 5 × 1.5 core-h            = 5,400,000 core-hours/day
        ÷ 24                                        ≈ 225,000 cores sustained
```

**Storage:**

```
Renditions ≈ 1.5× source across the ladder          ≈ 6.75 GB/source-hour
Per day    = 720,000 × 6.75 GB                      ≈ 4.9 PB/day
Per year                                             ≈ 1.8 EB/year
```

**Egress — the number that dominates everything:**

```
Watch      = 1 × 10^9 hours/day
Avg bitrate ≈ 3 Mbps                                 ≈ 1.35 GB/hour
Egress     = 10^9 × 1.35 GB                          ≈ 1.35 EB/day
In bits/s  = 1.35 × 10^18 × 8 ÷ 86,400               ≈ 125 Tbps sustained
Peak (×2)                                            ≈ 250 Tbps
```

#### What the numbers tell us

Three conclusions, and the third is the one that reorders the whole design:

1. **Egress is the system.** 125 Tbps cannot originate from your servers at any price — it is roughly the capacity of a large tier-1 network. The CDN is therefore not an optimisation layered on an origin design; **the origin is a fallback for the CDN**, and every URL a player sees is a CDN URL from the start.
2. **Transcoding is the second-largest cost and it is elastic**, which makes it the natural home for spot/preemptible capacity and for priority scheduling — a fundamentally different operational posture from the always-on serving tier.
3. **Most of the stored bytes will never be watched.** Upload is 720,000 hours/day; watch is 1 billion hours/day concentrated overwhelmingly on a small popular set. Generating a 4K rendition for every upload therefore spends the most expensive compute and the most expensive storage on content with, in the median case, near-zero views. **Generate the ladder on demand above a popularity threshold** — this single decision is worth more than every other optimisation in the design combined, and it falls directly out of the estimation.

The hard problem is not "how do we stream video" — it is **cost-shaped**: routing bytes so they never touch your application tier, and refusing to do expensive work for content nobody will watch.

---

### Step 2 — Propose High-Level Design and Get Buy-In

#### The two core flows

- **Write path (upload → transcode → publish)** — slow, asynchronous, compute-heavy, failure-tolerant.
- **Read path (manifest → segments → CDN)** — enormous, latency-sensitive, and **completely decoupled** from the write path. The two share only object storage and a metadata record.

Stating that decoupling first is what allows every subsequent decision to be made independently on each side.

#### Components

**Upload Service.** Issues pre-signed multipart upload URLs. **Bytes never traverse the application tier** — the client uploads directly to object storage. At 3.2 PB/day, any design that proxies upload bytes has already failed.

**Raw Store.** Object storage bucket for source files; lifecycle-transitioned to cold storage after transcoding succeeds, and retained (not deleted) so the ladder can be regenerated when a codec changes.

**Transcode Orchestrator.** Splits a video into **per-rendition, per-segment jobs**. Emits them to priority queues. Tracks completion per rendition.

**Transcode Workers.** Autoscaled, largely on spot capacity, GPU-accelerated for the expensive tiers.

**Packager.** Produces HLS/DASH segments and per-rendition playlists; writes the master manifest.

**Metadata Service.** Video record, rendition availability, publish state.

**Manifest Service.** Serves the master manifest. Thin, cacheable, and the only dynamic thing on the read path.

**CDN (multi-vendor).** Serves segments and thumbnails. Origin-shielded so a cold popular video does not stampede object storage.

**View Pipeline.** Kafka → stream aggregation → periodic flush to durable counters.

#### End-to-end walkthrough — upload to playable

1. Client calls `POST /v1/videos` → gets `video_id` and a multipart upload session.
2. Client uploads 8 MB parts directly to object storage, retrying **per part**, with parts idempotent by part number. A dropped connection at 90% costs one part, not the upload.
3. Client calls `POST /v1/videos/{id}/complete` with the part ETags; object storage assembles the source.
4. Metadata state → `UPLOADED`. An event goes to the orchestrator.
5. Orchestrator probes the source (duration, resolution, codec) and **decides the initial ladder**: 240p/480p/720p always; 1080p if the source supports it; **4K only on demand** (§3.5).
6. Orchestrator splits the source into ~30-second chunks and emits `chunks × renditions` independent jobs to priority queues — **cheap renditions to a high-priority queue**, expensive ones to a lower one. This is the fix §4 arrived at the hard way.
7. Workers transcode chunks in parallel; a chunk failure retries only that chunk.
8. As each rendition's chunks complete, the packager stitches its playlist and marks the rendition available.
9. **On the first rendition completing, state → `PARTIALLY_READY` and the video is publishable.** The master manifest lists only ready renditions and is re-published as more arrive.
10. Client plays: fetch master manifest (CDN-cached, short TTL) → pick a rendition → fetch segments (CDN-cached, effectively immutable, long TTL).

#### API design

**`POST /v1/videos`**

| Field | Type | Description |
|---|---|---|
| `title`, `description` | string | |
| `visibility` | enum | `PUBLIC` \| `UNLISTED` \| `PRIVATE` |
| `file_size`, `content_type` | int/string | Sizes the multipart plan |

Response: `{ video_id, upload_id, part_size, part_urls[], expires_at }`.

**`PUT {presigned_part_url}`** — client → object storage directly. Returns an `ETag` per part.

**`POST /v1/videos/{id}/complete`** — `{ upload_id, parts: [{ part_number, etag }] }` → `202`.

**`GET /v1/videos/{id}`**

| Field | Type | Description |
|---|---|---|
| `status` | enum | `UPLOADING`, `UPLOADED`, `TRANSCODING`, `PARTIALLY_READY`, `READY`, `FAILED` |
| `available_renditions` | string[] | Grows over time — the progressive-publish contract made explicit in the API |
| `manifest_url` | string | **CDN URL**, never an origin URL |
| `thumbnail_urls` | object | |
| `duration_seconds` | int | |

**`POST /v1/videos/{id}/views`** — fire-and-forget beacon: `{ session_id, position_seconds, watched_seconds }`. Note it reports *watched seconds*, not a boolean view — which is what makes the count both meaningful and much harder to game.

#### Data model

**`video`** (PostgreSQL — small, relational, transactional):

| Column | Type | Notes |
|---|---|---|
| `video_id` | uuid PK | |
| `creator_id`, `title`, `description`, `visibility` | | |
| `status` | enum | The lifecycle above |
| `source_key`, `duration_seconds`, `source_codec` | | |
| `created_at`, `published_at` | timestamptz | |

**`rendition`** — `(video_id, rendition_id)`, `resolution`, `bitrate`, `codec`, `status`, `playlist_key`, `segment_count`, `bytes`, `completed_at`. One row per ladder step; **this table is why progressive publish works** — the manifest is a projection of the ready rows.

**`transcode_job`** — `(video_id, rendition_id, chunk_index)`, `status`, `attempts`, `worker_id`, `error`. Chunk-level granularity is what makes retries cheap.

**`view_counter`** — Cassandra/DynamoDB, `video_id → count`, updated by batched increments; plus a `view_event` stream retained for recomputation and fraud analysis.

**Storage key layout** — content-addressed and immutable:

```
raw/{video_id}/source
hls/{video_id}/{rendition}/playlist.m3u8
hls/{video_id}/{rendition}/seg-{n}.ts
hls/{video_id}/master.m3u8        ← the only mutable object; short TTL
```

Immutable segment keys mean segments can be cached at the edge **forever**, which is the cheapest consistency model available and the reason the master manifest is the only thing with a short TTL.

#### Store selection, and why

| Store | Choice | Reason |
|---|---|---|
| Video/rendition metadata | **PostgreSQL** | Small (hundreds of GB), relational, needs transactions for state transitions. Nothing about this workload justifies more |
| Media bytes | **Object storage (S3-class)** | 1.8 EB/year, 11-nines durability, lifecycle tiering, and — decisively — it can be a CDN origin |
| View counts | **Cassandra/DynamoDB + stream aggregation** | Extremely high write volume with no read-modify-write per event; approximate is acceptable per requirements |
| Job state | **PostgreSQL or a workflow engine** | Millions of small rows with state machines; needs exactly-once-ish transitions |
| Delivery | **Multi-vendor CDN** | 125 Tbps. Multi-vendor is not redundancy theatre here — it is negotiating leverage and genuine regional coverage |

---

### Step 3 — Design Deep Dive

#### 3.1 Resumable upload, correctly

Multipart upload with client-side retry per part. The details that matter: **parts are idempotent by number**, so a retried part overwrites rather than appends; the upload session has a TTL and abandoned sessions are garbage-collected by a lifecycle rule (otherwise incomplete multipart uploads accumulate as invisible, billable storage — a real and commonly-missed cost leak); and the client must verify the assembled object's checksum, because a silently corrupted source produces five corrupted renditions and a support ticket that looks like a transcode bug.

#### 3.2 Per-rendition, per-chunk jobs — and why the queue must be split

§4's incident was a monolithic per-video job. The fix is two-dimensional decomposition: **by rendition** (independent outputs) and **by chunk** (independent inputs). Both are needed — rendition-only decomposition still leaves a 4-hour 4K job as one unit.

The subtlety beyond the decomposition is **queue separation by cost**. If cheap and expensive jobs share a queue, an upload burst of long 4K videos still delays every 240p job behind it — the same head-of-line blocking, one level down. Separate queues with separate worker pools (and separate autoscaling) make the fast path structurally fast rather than statistically fast.

Chunk boundaries must land on **keyframes (GOP boundaries)**, or the chunks cannot be stitched without re-encoding at the seams. This is the kind of domain detail that distinguishes someone who has built a pipeline from someone who has read about one.

#### 3.3 Adaptive bitrate: what the server owes the client

The server publishes a master manifest listing renditions with bandwidth and resolution; the **client** measures throughput and buffer level and chooses the next segment's rendition. Server-side responsibilities are narrow but strict:

- **Segment duration** ≈ 2–6 s. Shorter means faster adaptation and lower startup latency, but more requests and more per-segment overhead. 4 s is a defensible default; state the trade-off rather than asserting the number.
- **Every rendition must be segment-aligned** — segment *n* covers the same time range in every rendition, or switching mid-stream produces a visible glitch or a gap.
- **The lowest rendition must be reachable on genuinely bad networks.** A ladder starting at 720p is unusable on the connections most of the world's viewers actually have — and this is a design decision with a market-size consequence, not a technical detail.

#### 3.4 CDN strategy and the cold-popular problem

A brand-new video that goes viral is a cache miss everywhere at once: thousands of edges simultaneously request the same segments from the origin, and object storage sees a stampede on a handful of keys.

- **Origin shield**: a mid-tier cache between edges and origin, so N edges collapse into one origin fetch per segment.
- **Pre-warming** for content with predictable demand (scheduled premieres, known-large creators) — push segments to edges before the traffic arrives.
- **Tiered storage by popularity**: hot content on the fastest storage class, the long tail on infrequent-access, cold archives for content untouched in a year. Given that most uploads are watched almost never, this is a very large line item.

#### 3.5 The popularity-driven ladder — the biggest cost lever

Falling directly out of the estimation's third conclusion:

1. On upload, generate only the cheap ladder (240p/480p/720p). Time-to-watchable is short and cost is small.
2. Track views. When a video crosses a threshold (say 1,000 views, or a rising velocity), enqueue 1080p; at a higher threshold, 4K.
3. For videos that never cross it — the overwhelming majority — the expensive renditions are **never generated at all**.

The trade-off is honest and must be stated: the first thousand viewers of what becomes a hit see a lower maximum quality than they would have. Given that the alternative is generating 4K for hundreds of thousands of hours a day of content nobody watches, that is a trade worth making — and framing it as a *stated, measured* trade rather than a silent degradation is what makes it a design decision instead of a corner cut.

#### 3.6 View counting without a synchronous increment

Client beacons → Kafka → windowed aggregation → periodic flush of batched increments.

- **Deduplicate by `session_id`** within a window so a page refresh is not a view.
- **Require a watch-time threshold** (e.g., 30 s or 30% of duration) before counting — this is both a quality signal and the primary anti-gaming control.
- **The event stream is retained** so counts can be *recomputed* after a fraud rule changes. A counter you can only increment is a counter you can never correct, and view-count fraud rules change constantly.
- Display counts are read from a cache with a short TTL; exactness at the second is neither achievable nor required.

#### 3.7 Failure handling

- **A chunk transcode fails** → retry that chunk; after N attempts, fail that *rendition* only. Other renditions still publish. The video remains watchable.
- **All renditions fail** → `FAILED` with a creator-visible reason. Silent failure here is a creator-trust event, not just a bug.
- **Spot instance reclaimed mid-job** → chunk-level granularity means at most one chunk of work is lost; this is what makes spot capacity viable for 225,000 cores.
- **CDN vendor degradation in a region** → shift traffic to the secondary vendor via DNS/steering. Multi-vendor is what makes this a routing change rather than an outage.
- **Object storage regional issue** → playback continues from CDN caches for popular content and fails for the cold tail — a graceful, popularity-weighted degradation that is worth naming as a *designed* property rather than an accident.

---

### Step 4 — Wrap-Up

**What we left out:** live streaming (a different ingest, packaging, and latency model end to end); DRM and licence servers; recommendations and search (Module 19); comments and community; monetisation and ad insertion, which changes manifest generation substantially; per-title and per-scene encoding optimisation, which is where the next large cost win lives; captions and multi-language audio; and copyright matching.

**What we would measure:** playback start time and **rebuffer ratio segmented by region, ISP, and device** — the aggregate is useless because failures here are always concentrated (this folder's recurring finding); CDN offload ratio, the single most economically significant number in the design; time-to-first-rendition p95, split by rendition; transcode cost per source-hour and spot-reclamation rate; queue depth **per priority class**, since a blended depth hides exactly the head-of-line problem §4 suffered; and renditions generated versus renditions ever watched, which is the metric that justifies §3.5 and would flag if the threshold drifted wrong.

**Summary.** Bytes go client → object storage → CDN and never through the application tier; transcoding is decomposed by rendition *and* chunk onto cost-separated queues so cheap renditions publish first; the expensive half of the ladder is generated only for content that earns it; and the read path is decoupled from the write path entirely, sharing only an immutable object store and a small metadata record. The estimation drives all of it: 125 Tbps of egress makes the CDN the system, and the gap between 720,000 upload-hours and a view distribution concentrated on a tiny fraction makes on-demand rendition generation the largest single lever available.

---

### References

1. Alex Xu — *System Design Interview Vol. 1*, ch. 14 "Design YouTube".
2. Netflix Technology Blog — *Per-Title Encode Optimization* and *Dynamic Optimizer* (the next step beyond a fixed ladder).
3. Netflix Technology Blog — *Open Connect* CDN architecture and ISP embedding.
4. RFC 8216 — HTTP Live Streaming (HLS); ISO/IEC 23009-1 — MPEG-DASH.
5. AWS — *Amazon S3 Multipart Upload* and lifecycle policies for incomplete uploads (the cost leak in §3.1).
6. YouTube Engineering — *Vitess* and the metadata-scaling story.
7. Facebook Engineering — *Under the hood: Broadcasting live video* (for contrast with the VOD path designed here).
8. Twitter/X Engineering — *Cache-aside and origin shielding for media at scale*.
9. Google SRE Book, ch. 22 — cascading failure, applied here to origin stampede on cold-popular content.

---

## 13–17. LLD / Debugging / Decision / Case Study / Principal

*(This module predates the full 16-section template; its incident, worked exercises, and Advanced-tier Q&A collectively carry this content. §12 above was authored to the four-step standard on 2026-08-09.)*

## 18. Revision
**Key takeaways**: Video platforms are fundamentally a large-binary-content problem, requiring chunked/resumable upload, an asynchronous, independently-job-per-rendition transcoding pipeline (never monolithic —), and CDN-primary (not CDN-as-cache) delivery. Adaptive bitrate streaming is client-driven, requiring pre-generated discrete quality renditions, not server-side dynamic encoding. View-count and similar high-frequency counters must be batched/aggregated asynchronously (Redis counters + periodic flush), never synchronously written per-event. Storage tiering by access-frequency/popularity (a power-law distribution, directly paralleling the celebrity-account skew) is an economic necessity at this scale, not an optional optimization.

---

**Next**: Continuing autonomously to Module 42 — Designing Instagram (Photo/Video Sharing, Stories & Feed).
