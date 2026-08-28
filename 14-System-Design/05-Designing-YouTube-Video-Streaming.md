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

## 7. Performance Engineering

**CPU:** Transcoding is the CPU/GPU-bound workload in this system — each rendition is effectively a compressed-video encode loop, and encoder efficiency (x264/x265/AV1 preset choice) trades CPU-seconds directly against output bitrate for a given perceptual quality. A "slower" encoder preset produces a smaller file at the same quality, which then lowers egress cost for the life of the video — meaning the CPU/cost trade-off here is made once at transcode time but paid (or saved) on every subsequent view, often thousands of times over. Profile at the codec/kernel level (frames-per-second per core for a given preset/resolution), not at the service level, since "the transcode service is CPU-bound" is a fact everyone already knows and tells you nothing about where the next optimization is.

**Memory:** A worker must never hold a full source file in memory — streaming/chunked decode (feeding the encoder a bounded window of frames rather than the whole file) keeps memory flat regardless of video length, which is exactly what §14's incident got wrong. Manifest and metadata services are comparatively memory-trivial; the CDN edge tier's memory profile is dominated by its own cache-eviction policy (typically LRU/LFU-hybrid), not by this system's code.

**GC/Allocations:** Transcode workers are usually thin C#/Go/Rust orchestration wrapping a native encoder (ffmpeg/libx264) via process invocation or a P/Invoke boundary — the managed-heap allocation profile that matters is in the *orchestration* layer (job polling, chunk-boundary bookkeeping, metadata updates), not the encode loop itself, which runs outside the GC entirely. The view-count aggregator (§2.5) is the genuine managed-allocation hot path — its `dirty-view-counts` batching (§11's Expert exercise) exists specifically to bound allocation and flush cost to actual activity rather than total catalog size.

**Latency:** Two distinct latency metrics, easily conflated: **time-to-first-frame** (manifest fetch + first segment download, a read-path number, target sub-2s) and **time-to-first-rendition** (upload-complete to first watchable quality, a write-path number, target minutes). Optimizing one does nothing for the other — a common interview trap is treating "video platform latency" as a single number.

**Throughput:** Transcode fleet throughput = `workers × (frames/sec per worker)`; capacity-plan with Little's Law against upload arrival rate, sized for burst (a coordinated creator upload event, §4) rather than average upload rate — average-rate sizing is precisely what the §4 incident's queue backlog exposed. CDN throughput is not a capacity-planning concern of this system at all — it is the CDN vendor's, which is exactly why egress being "the system" (§12 Step 1) means vendor contract terms are a first-class architectural input, not a procurement afterthought.

**Benchmarking:** Benchmark the transcode fleet against a realistic **duration and codec mix**, not a synthetic uniform corpus — a benchmark built entirely from short, simple-content clips will never surface the long-tail cost of feature-length or highly-detailed (high-motion, high-entropy) source video, which can be an order of magnitude more expensive per second to encode at a given quality target.

**Caching:** The CDN cache-hit ratio is the single most important performance number in the whole system (§12's "CDN offload ratio" metric) — segment keys are immutable and cacheable near-indefinitely, so a low hit ratio almost always indicates either an origin-shield misconfiguration or a genuinely cold-and-scattered catalog (many videos, each rarely viewed) rather than a cacheability problem with the content itself.

---

## 8. Security

**Threats:** Unauthorized redistribution/scraping of paid or access-restricted content; leaked or brute-forceable signed URLs granting unintended access; malicious/malformed uploads designed to exploit the transcoder (a crafted file targeting a codec-library vulnerability — a real, recurring CVE class in video-processing libraries); DDoS against the origin/manifest tier; and content-moderation evasion (copyright-infringing or policy-violating uploads slipping past automated matching, §12 Step 4's "what we left out").

**Mitigations:** Signed, time-limited URLs (§11's Hard exercise) for any access-restricted content, with the signing key never exposed to a CDN edge in plaintext form; transcode workers run the actual decode/encode in a sandboxed, resource-limited container (CPU/memory/time caps) specifically because the input is untrusted, attacker-controllable binary data — treat every uploaded file as hostile input until transcoded, the same discipline as never trusting client-supplied data in any other system; rate-limit the upload endpoint per account to bound the blast radius of a compromised or abusive account; run content-fingerprint matching (§12 Step 4) as a background, non-gating check so moderation doesn't have to choose between speed and safety.

**OWASP mapping:** Broken Object-Level Authorization is the dominant risk for unlisted/private video access — a client that can enumerate or guess `video_id`s and receive a valid manifest for a video it isn't authorized to view is a BOLA finding, not a theoretical one; this is exactly why `GET /v1/videos/{id}`'s `manifest_url` must be gated by the same authorization check the API layer applies, never derivable purely from a guessable ID.

**AuthN/AuthZ:** Upload and management endpoints require standard session/token auth; playback authorization for restricted content is enforced **at manifest-issuance time** (the manifest itself embeds a short-lived signed URL scoped to that viewer's session) rather than relying on the CDN to independently re-check authorization per segment request — the CDN edge should never need to understand the platform's authorization model at all, only validate a signature it was handed.

**Secrets:** The URL-signing key (§11's Hard exercise) is the single most sensitive secret in the read path — its compromise grants indefinite forgeable access to every asset it can sign for, which is why it lives in a managed secrets store with rotation support, and why signature validation uses constant-time comparison (`FixedTimeEquals`, §11) rather than a naive equality check that leaks timing information.

**Encryption:** Source and rendition assets encrypted at rest in object storage (standard for any object-storage-backed system at this scale); in-transit encryption (TLS) for both upload and CDN-served segments is non-negotiable given upload/download traffic traverses public networks; DRM (out of scope per §12 Step 1, but worth naming) would add per-segment content encryption with license-server-mediated key delivery — a materially larger architectural addition, not a configuration toggle.

---

## 9. Scalability

**Horizontal scaling:** Both halves of the system scale horizontally and independently — transcode workers scale with queue depth (stateless, pull-based, per §3's priority-queue design), and CDN edges scale by the vendor's own global footprint, which is precisely why §12 Step 1 concludes egress cannot be solved by *this system* scaling at all — it has to be delegated.

**Vertical scaling:** Relevant mainly for the highest-tier renditions (4K/GPU-accelerated encode benefits from larger, GPU-equipped instances) — not a primary lever for the metadata or manifest tiers, which are throughput-bound by request volume, not per-request compute.

**Caching:** The CDN *is* the scaling mechanism for the read path, not an optimization layered onto it (§2.4) — origin shielding (§12 §3.4) is what prevents a popularity spike from translating into an origin-storage stampede, collapsing N simultaneous edge cache-misses into one origin fetch.

**Replication/Partitioning:** Object storage partitions naturally by key (`{video_id}/...`, §12's storage layout) with no manual sharding required; the metadata database partitions by `video_id` if it ever outgrows a single primary — unlikely relative to the media-bytes volume, since metadata rows are tiny compared to the assets they describe.

**Load balancing:** Pull-based work distribution for transcode jobs (workers pull from priority queues) rather than push-assignment, which naturally load-balances heterogeneous job costs (a 240p job and a 4K job) across a heterogeneous worker fleet without a central scheduler needing to predict job duration in advance.

**High Availability:** Losing a transcode worker mid-job loses at most one chunk of work (§12 §3.2's chunk-granularity design) — trivially re-queued. Losing the manifest/metadata tier is more serious since it gates new playback starts (already-buffered playback continues from CDN cache); it should run multi-AZ with automated failover, consistent with any other read-critical metadata service in this course.

**Disaster Recovery:** Object storage's own cross-region replication is the DR mechanism for media bytes (11-nines durability, §12); the metadata database needs standard backup/PITR since it's comparatively small but is the only record of which renditions exist and where — losing it without a backup effectively orphans the media bytes even though they physically survive.

**CAP theorem:** The metadata/video-state store favors consistency (a video's status transition, e.g., `PARTIALLY_READY` → `READY`, must not be read as stale by the client polling for availability) while the view-count store favors availability (§2.5 — an approximate, eventually-consistent count is an explicit, accepted trade-off) — two data types in the same system, deliberately opposite CAP postures, chosen per-store rather than uniformly.

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

### Expert (10)
1. **Q: The back-of-the-envelope estimation (§12 Step 1) concludes egress, not storage or compute, is "the system." Walk through why a candidate who instead optimizes storage cost first has misread the problem, and what interview signal that mistake sends.**
 **A:** At ~125 Tbps sustained egress against ~1.8 EB/year of storage growth, egress is the number with no path to being solved by *this system's own* engineering — it can only be delegated to a CDN vendor, which reframes nearly every subsequent decision (URL structure, cache-control, origin shielding, popularity-driven rendition generation) around minimizing origin traffic and maximizing edge cache-hit ratio. A candidate who leads with storage-tiering optimizations has correctly identified a real cost lever (§12 Step 1's third conclusion) but the wrong *primary* one — it signals they can optimize a component without first establishing which component the estimation says actually dominates, exactly the "estimate first, then let the estimate choose the hard problem" discipline this format is built to test.
2. **Q: Design a strategy for migrating an existing catalog of billions of already-transcoded videos to a new, more efficient codec (e.g., AV1) without a "stop the world" re-transcode of the entire library, given the popularity-driven ladder means most videos were never transcoded to every tier.**
 **A:** Treat codec migration as an extension of the popularity-driven ladder decision (§12 §3.5), not a separate project — re-transcode into the new codec on the same view-triggered schedule already governing rendition generation (hot content migrates first, naturally, as it crosses view thresholds and gets re-requested), while cold, rarely-viewed content is migrated lazily on next-request or left on the legacy codec indefinitely if it never crosses the threshold again. The player/manifest must support serving mixed-codec renditions during the multi-year transition window (client capability negotiation via the manifest, offering the new codec only to clients that declare support), and the metadata schema's `rendition` table (§12) needs a `codec` column from day one specifically so this migration doesn't require a schema change under pressure later.
3. **Q: A regulator or court order requires a specific video be made permanently unavailable in one country but not others. Design this given the CDN-primary delivery model where content, once cached at an edge, is largely outside your direct control.**
 **A:** Geo-restriction must be enforced at the manifest layer, not relied upon at the CDN edge alone — the manifest service checks the requesting client's region against a per-video restriction list before returning `manifest_url`, so a restricted region never receives a playable manifest regardless of what's cached at nearby edges; additionally, issue a CDN purge/invalidation for the specific segment keys in the affected region's edge nodes (most CDN vendors support geo-scoped invalidation) so already-cached copies don't continue serving stale, unrestricted access during the TTL window. The genuinely hard residual risk — a client that already downloaded/cached segments locally before the restriction took effect — is out of this system's control entirely and should be explicitly named as a limitation, not silently assumed solved.
4. **Q: Explain why "time-to-first-rendition" (§7) is fundamentally a queueing-theory problem, and derive what happens to it during the §4 incident's upload burst using Little's Law.**
 **A:** Time-to-first-rendition is dominated by queue wait time, not encode time, once the system is under load — Little's Law (`L = λW`, average jobs in system = arrival rate × average time in system) means that if arrival rate `λ` (uploads/sec) exceeds the fleet's sustained service rate even briefly, queue length `L` grows unboundedly for the duration of the burst, and every job's wait time `W` grows with it — which is exactly why §4's fix (splitting into independent, priority-ordered per-rendition jobs) doesn't reduce total work at all, it only reorders the queue so the *cheapest* jobs' wait time stays bounded even while the queue overall is backed up, trading fairness for the metric that actually matters to viewers (can I watch *something* soon).
5. **Q: Design the monitoring and alerting that would have caught the §4 monolithic-job incident before it became user-visible, going beyond "queue depth is high."**
 **A:** A single aggregate queue-depth metric is exactly what would have stayed misleadingly normal-looking during the incident (total throughput wasn't zero, it was just badly ordered) — the actionable signal is **queue depth and wait-time percentile, segmented by rendition tier**, specifically watching for the 240p queue's P95 wait time diverging upward from its historical baseline even while aggregate throughput looks healthy; alerting on that divergence (not on an absolute threshold) catches the head-of-line-blocking failure mode structurally, the same "segment before you alert, don't trust the aggregate" discipline as the risk-engine module's straggler incident (task-duration distribution skew, not mean).
6. **Q: A Principal Engineer is asked to justify, to a finance stakeholder skeptical of infrastructure spend, why the platform should invest in origin-shield caching (§12 §3.4) before a single incident has occurred. Construct that argument.**
 **A:** Frame it as bounding a known, quantifiable tail risk rather than a speculative improvement: without origin shielding, a viral video's cold-start moment produces a fan-out of simultaneous origin requests proportional to the number of distinct edge locations receiving first-time traffic — a number that scales with the CDN's own footprint, not with anything this system controls — meaning the worst-case origin load is effectively unbounded by design. Origin shielding caps that fan-out at "one origin fetch per shield region regardless of edge count," converting an open-ended tail risk into a fixed, budgeted cost — the argument is the same one made for circuit breakers and bulkheads elsewhere in this course: the investment is insurance against a rare, severe, and otherwise-uncapped failure mode, not a routine efficiency gain, and its value is realized precisely on the one day it's needed.
7. **Q: Compare fan-out-on-write (push every rendition to every configured CDN region proactively) versus the pull/cache-miss model this design uses, for the transcoding-to-delivery handoff specifically.**
 **A:** Proactively pushing every rendition to every CDN region on completion guarantees zero cold-start latency anywhere but multiplies transfer cost by the number of regions for content that, per §12 Step 1's third conclusion, mostly will never be watched in most of those regions — nearly all of that push traffic would be wasted. The pull/cache-miss model (this design's default) pays a one-time, per-region cold-start cost only for regions that actually request the content, which is strictly cheaper in aggregate given the power-law popularity distribution — push is justified only as the targeted pre-warming exception (§12 §3.4) for content with *known*, high-confidence anticipated demand (a scheduled premiere), never as the default delivery mechanism, exactly mirroring the fan-out-on-write-vs-read trade-off from the news-feed module now applied to CDN distribution instead of follower feeds.
8. **Q: The view-count pipeline (§2.5, §11) uses Redis `INCR` plus a "dirty set" batched flush. Identify the failure mode if a Redis node is lost between an `INCR` and the next flush cycle, and design the fix.**
 **A:** Any views accumulated in that Redis node's counter since the last successful flush are lost outright — Redis's default configuration prioritizes throughput over durability for exactly this kind of hot counter, and the batching window (30s, §11) is also the exposure window for data loss on node failure. Since view counts are explicitly an approximate, eventually-consistent metric (§2.5's stated trade-off), the pragmatic fix is not to make the counter durable (which would reintroduce the synchronous-write bottleneck this design exists to avoid) but to make loss bounded and recoverable: enable Redis AOF persistence with a short fsync interval to shrink the exposure window, and retain the raw view-event stream (Kafka, §12 §3.6) independently so counts can be *recomputed* from the durable event log if a divergence is detected — the counter is a fast, lossy cache of a truth that lives elsewhere, not the truth itself.
9. **Q: As a Principal Engineer, how would you decide whether per-title/per-scene encoding optimization (§12 Step 4's "next largest cost win") is worth building, versus continuing to ship a fixed rendition ladder?**
 **A:** The fixed ladder encodes every video in a content category at the same bitrate targets regardless of actual visual complexity, meaning simple, low-motion content (a static talking-head video) is measurably over-provisioned relative to what its perceptual quality actually requires — per-title encoding closes that gap but requires a materially more complex, per-video encoding-parameter search (or a trained model predicting good parameters) rather than a fixed preset, meaningfully increasing transcode-pipeline engineering complexity and per-video encode time. The Principal-level judgment: **quantify the gap first** — measure aggregate bitrate savings achievable on a representative sample before committing engineering investment, exactly the same "don't build custom infrastructure without a demonstrated, measured need" discipline (§Advanced Q10) applied to an encoding optimization rather than a build-vs-buy CDN decision — if the sample shows a large, broad-based savings (as Netflix's public per-title encoding results have shown), the investment is justified; if savings concentrate in a narrow content category, a narrower, lower-complexity fix targeting just that category may capture most of the value at a fraction of the cost.
10. **Q: Synthesize this module's central lesson (independent, decomposed jobs) with the news-feed module's fan-out lesson and the risk-engine module's straggler incident. What single principle do all three share, and why does it recur across such different systems?**
 **A:** All three are instances of the same underlying principle: **a system's unit of work should match the actual, independent grain of the problem, not an administratively convenient bundling of it** — a monolithic per-video transcode job bundles genuinely independent renditions (this module, §4); naive synchronous fan-out bundles a celebrity's millions of independent follower-feed writes into one blocking operation (the news-feed module); and position-count-based task partitioning bundled a handful of 4,000×-more-expensive exotic-option positions into ordinary-sized blocks, hiding a severe cost skew inside an innocuous-looking count (the risk-engine module). It recurs because "bundle by what's administratively easy to enumerate" (one video, one fan-out call, one position count) is almost always the first design that gets built, and only reveals its head-of-line-blocking or straggler failure mode once real-world skew (in cost, in popularity, in complexity) appears in production — meaning the fix is rarely "add more capacity" and is almost always "decompose the unit of work along the dimension that's actually skewed."

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

## 13. Low-Level Design

**Requirements:** A video's renditions must publish independently as each completes (§12 Step 1's "low resolutions may publish before high ones"); a failed rendition must never block sibling renditions; job cost must be schedulable by priority; the design must support the popularity-driven ladder (§12 §3.5) without special-casing it into the core pipeline.

**Class diagram:**
```mermaid
classDiagram
    class Video {
        +VideoId Id
        +VideoStatus Status
        +SourceKey Source
        +MarkPartiallyReady()
        +MarkReady()
    }
    class Rendition {
        +VideoId VideoId
        +Resolution Resolution
        +RenditionStatus Status
        +string PlaylistKey
    }
    class TranscodeJob {
        +VideoId VideoId
        +Resolution Resolution
        +int ChunkIndex
        +int Priority
        +Execute() ChunkResult
    }
    class ITranscodeWorker {
        <<interface>>
        +TranscodeAsync(job) Task~ChunkResult~
    }
    class TranscodeOrchestrator {
        +SplitIntoJobs(video) IEnumerable~TranscodeJob~
        +OnChunkComplete(result)
    }
    class IRenditionStore {
        <<interface>>
        +MarkChunkReadyAsync(job)
        +MarkRenditionReadyAsync(videoId, resolution)
    }
    class PriorityJobQueue {
        +Enqueue(job, priority)
        +TryDequeue() TranscodeJob
    }

    TranscodeOrchestrator --> TranscodeJob : creates
    TranscodeOrchestrator --> PriorityJobQueue
    ITranscodeWorker --> TranscodeJob : executes
    ITranscodeWorker --> IRenditionStore : reports completion
    Rendition --> Video
    TranscodeJob --> Rendition
```

**Sequence diagram:** upload-complete → publish, showing why progressive availability falls out of the object model rather than special-case logic:

```mermaid
sequenceDiagram
    participant U as Upload Service
    participant O as Orchestrator
    participant Q as PriorityJobQueue
    participant W as Worker
    participant S as RenditionStore
    participant M as Metadata/Manifest

    U->>O: video uploaded (source probed)
    O->>O: SplitIntoJobs (per rendition x per chunk)
    O->>Q: enqueue jobs (240p/480p/720p high priority, 1080p/4K low)
    loop per chunk job, in priority order
        Q->>W: dequeue job
        W->>W: transcode chunk
        W->>S: MarkChunkReadyAsync(job)
    end
    S->>S: all chunks for a rendition ready?
    S->>M: MarkRenditionReadyAsync(videoId, resolution)
    M->>M: Video.Status -> PARTIALLY_READY (first rendition ready)
    Note over M: manifest republished, listing only READY renditions
```

**Design patterns used:** Fork-Join (per-rendition, per-chunk fan-out and completion aggregation, directly the same shape as the risk-engine grid's task fan-out); Strategy (`ITranscodeWorker` implementations swappable per codec — x264/x265/AV1 — without touching the orchestrator); State (`Video.Status`'s `UPLOADING → UPLOADED → TRANSCODING → PARTIALLY_READY → READY | FAILED` lifecycle, each transition guarded so an invalid jump, e.g. `READY` before any rendition completes, is structurally unrepresentable); Priority Queue / Scheduling pattern (§12 §3.2's cost-separated queues); Observer (rendition-completion events driving both the manifest republish and, independently, the popularity-tracking pipeline that decides when to enqueue 1080p/4K, without those two concerns being coupled to each other).

**SOLID mapping:** Single Responsibility (`TranscodeOrchestrator` splits and schedules; `ITranscodeWorker` only transcodes; `IRenditionStore` only persists state — none overlap, mirroring the risk-engine's task/aggregator/store separation); Open/Closed (a new codec adds an `ITranscodeWorker` implementation; a new rendition tier adds a ladder entry — neither requires touching the orchestrator's splitting logic); Liskov (every `ITranscodeWorker` implementation must honor the same chunk-idempotency contract — a retried chunk must produce an equivalent result — or the priority-queue retry logic silently corrupts output); Interface Segregation (`IRenditionStore`'s chunk-completion write path is separate from the read path the manifest service uses, since the manifest service should never need write access); Dependency Inversion (the orchestrator depends on `ITranscodeWorker` and `IRenditionStore` abstractions, never a concrete codec library or storage SDK, which is what let §14's fix swap the decode strategy without touching orchestration).

**Extensibility:** Adding a new rendition tier (e.g., 8K) is a ladder-configuration change plus a new `ITranscodeWorker` registration — no change to job splitting, priority scheduling, or the progressive-publish logic, since those already operate generically over "some set of renditions." Adding the popularity-driven on-demand ladder (§12 §3.5) required no change to this core model at all — it is implemented entirely as an additional producer of `TranscodeJob`s triggered by a view-threshold event, reusing the exact same queue and worker infrastructure as the initial upload-triggered jobs.

**Concurrency/thread safety:** Jobs are independent and share no mutable state — workers require no locking between each other. The one shared-state concern is "has every chunk of this rendition completed," which must be an atomic, race-free check (a chunk-count decrement or an atomic set-membership check) since two workers could complete a rendition's last two chunks concurrently and both observe "all chunks ready" simultaneously without it — the fix is the same idempotent, atomic-completion-check discipline as the risk engine's append-only result store: completion is derived by querying current state, not by trusting a single worker's local view of it.

---

## 14. Production Debugging

**Incident:** Transcode workers began being OOM-killed in clusters, concentrated on jobs processing 4K source uploads, during a period when a popular creator tier started uploading longer-form, higher-resolution content. The OOM kills were not correlated with any single video but recurred whenever multiple 4K transcode jobs landed on the same worker node concurrently — a pattern that took longer to see than it should have, because each individual job's logs showed nothing unusual up to the moment of the kill.

**Root cause:** The transcode worker's decode step read the **entire source file into an in-memory buffer** before beginning the encode loop, rather than streaming frames through a bounded decode window — a design that "worked" for the 480p/720p content the pipeline was originally built and load-tested against, where a full source file fit comfortably in a worker's memory budget even a few times over. A multi-gigabyte 4K source file, multiplied by two or three such jobs scheduled concurrently on the same node (the scheduler had no per-job memory-cost awareness, only CPU-slot awareness), exceeded the container memory limit and triggered the kernel OOM killer — mid-job, with no graceful shutdown, no partial-chunk checkpoint, and no distinguishing log line, because the process was killed externally rather than failing internally.

**Investigation:** Container orchestrator event logs showed OOM-kill events clustering on specific nodes, not specific videos — the first clue that this was a *co-scheduling* problem, not a single-video problem. Correlating killed-job metadata against source resolution showed every incident involved at least one 4K source job. A memory profile of a single, isolated 4K transcode job (run deliberately in isolation to reproduce) showed peak resident memory several times larger than the container limit divided by the node's normal per-job concurrency — confirming the full-file-buffering behavior directly, once someone thought to check memory shape rather than assuming "transcoding is just CPU-bound" (§7's stated risk of profiling only at the service level).

**Tools:** Container/orchestrator OOM-kill event logs (the primary signal); per-job memory profiling in isolation to confirm peak resident set size; job-scheduling logs cross-referenced against node placement to confirm the co-scheduling pattern; source-resolution metadata joined against failure records.

**Fix:** Replaced full-file buffering with a streaming decode (piping the source through the encoder in a bounded window of frames, memory flat regardless of source file size or duration) and added a per-job estimated-memory-cost tag (derived from source resolution and duration, the same idea as the risk engine's cost-based task partitioning) that the scheduler uses to bound *concurrent memory commitment* per node, not just concurrent CPU-slot count — a 4K job now reserves proportionally more of a node's scheduling budget than a 240p job, preventing the co-scheduling collision that caused the cluster.

**Prevention:** (1) Load-test the transcode fleet against a realistic **resolution and duration mix** including the heaviest real content (§7's benchmarking guidance), not a corpus that happens to match what the pipeline was originally built for. (2) Alert on per-node memory headroom trending toward the limit under normal job mix, not only on OOM-kill events after the fact — headroom erosion is the leading indicator, the kill is the lagging one. (3) Require any new transcode-worker code path handling source files to declare its memory-scaling behavior (flat/streaming vs. proportional-to-file-size) explicitly in review, since "reads the whole file" is exactly the kind of quietly-reasonable-until-it-isn't decision that a targeted review checklist item catches far more reliably than hoping someone notices during a code read.

---

## 15. Architecture Decision

**Context:** Deciding how many rendition tiers to generate, and when, for each uploaded video — the decision with the largest compute-cost and storage-cost consequences in the entire system (§12 Step 1's third conclusion).

**Option A — Generate the full ladder (240p through 4K) for every upload, upfront:**
*Advantages:* Simplest possible mental model — every video has every rendition available the moment transcoding finishes; no popularity-tracking machinery, no on-demand job triggering, no risk of a viewer requesting a rendition that doesn't exist yet.
*Disadvantages:* Spends the most expensive compute (4K/1080p encoding) and the most expensive storage on the overwhelming majority of uploads that, per the estimation, will receive near-zero views — the single largest cost inefficiency available in this design.
*Cost:* Very high compute and storage. *Complexity:* Low. *Maintainability:* High. *Scalability:* Poor — cost scales linearly with upload volume regardless of actual demand.

**Option B — Popularity-driven, on-demand ladder generation (recommended, and the design §12 §3.5 adopts):**
*Advantages:* Generates expensive renditions only for content that demonstrably earns them (crosses a view threshold), which given the power-law view distribution captures the large majority of the cost savings available; cheap renditions still publish immediately (§4's fix preserved), so time-to-watchable is unaffected.
*Disadvantages:* Requires view-tracking and threshold-triggering infrastructure; the first viewers of what becomes a hit see a lower ceiling on quality until the threshold is crossed and the higher tier finishes generating — a real, user-visible trade-off that must be stated, not hidden.
*Cost:* Moderate compute (most of the savings realized), moderate storage. *Complexity:* Moderate — additional event-driven trigger logic layered on the existing job infrastructure, not a parallel system. *Maintainability:* Good, since it reuses the exact same queue/worker infrastructure as upload-triggered jobs (§13's extensibility point). *Scalability:* Excellent — cost tracks actual demand rather than upload volume.

**Option C — Fully on-demand, just-in-time transcoding per playback request (no pre-generated ladder at all):**
*Advantages:* Zero wasted compute — nothing is ever generated that isn't immediately requested; theoretically minimal storage footprint.
*Disadvantages:* Introduces transcode latency into the *read path* for every first-time-quality-request, directly violating the sub-2-second playback-start non-functional requirement (§12 Step 1) for any rendition not already cached; makes the read path's latency depend on the write path's compute availability, breaking the deliberate read/write decoupling this design is built around (§12 Step 2's opening framing).
*Cost:* Potentially lower storage, but unpredictable and spiky compute demand tied directly to viewing traffic. *Complexity:* High — requires a low-latency transcode path fundamentally different from the batch pipeline, essentially two transcoding systems. *Maintainability:* Poor. *Scalability:* Fails the latency requirement outright at meaningful concurrent-viewer counts.

**Recommendation: Option B.** Option A's simplicity is real and defensible at small scale — a platform with modest upload volume and a compute budget that can absorb generating every tier for every video should not build the additional popularity-tracking machinery Option B requires, exactly the same "is this within budget" threshold question the risk-engine module's Architecture Decision poses for full-recomputation-versus-incremental. At this module's estimated scale (§12 Step 1), Option A's cost is prohibitive and Option C's latency violation is disqualifying on its own, making Option B's threshold-triggered middle ground the only one that satisfies both the cost constraint and the sub-2-second playback requirement simultaneously.

---

## 17. Principal Engineer Perspective

**Business impact:** This system's economics are dominated by a single line item — egress — meaning the platform's unit economics per view are set largely by CDN contract terms and encoding efficiency, not by feature velocity. A Principal Engineer framing investment here should lead with "this reduces cost-per-view by X%," a number a finance stakeholder can directly compare against subscriber/ad revenue per view, rather than "this makes transcoding faster," which has no obvious revenue connection on its own.

**Engineering trade-offs:** The defining trade-off, recurring through §7, §12 §3.5, and §15, is compute/storage cost versus content availability completeness — generating every rendition for every video buys simplicity and completeness at a cost that doesn't scale; generating on-demand buys cost-proportionality at the price of a stated, real degradation for early viewers of soon-to-be-popular content. Recognizing this as a spectrum with a genuine threshold (not a binary build-everything-or-nothing choice) is the senior insight; treating "more available renditions" as an unqualified good is the junior one.

**Technical leadership:** The controls that prevent this system's worst failure modes — chunk-level idempotency, per-rendition independence, cost-aware scheduling — share the property that they cost engineering discipline continuously and are invisible when working, exactly like the risk-engine module's reconciliation controls. A Principal Engineer's job is ensuring a future "let's simplify the job model, it's overcomplicated" refactor doesn't quietly reintroduce the monolithic-job or full-file-buffering failure modes this module's two incidents already paid to discover.

**Cross-team communication:** Creators, viewers, finance, and legal/moderation are four audiences with different definitions of "the system working" — a creator wants fast time-to-watchable regardless of resolution tier; a viewer wants their specific requested quality available; finance wants egress and compute cost bounded; moderation wants content-ID and policy checks to run without becoming a publish bottleneck. §12 Step 1's dialogue exists precisely to surface which of these the interviewer (standing in for a real stakeholder) actually prioritizes before design work begins, rather than discovering the conflict after building something that serves the wrong one.

**Architecture governance:** The popularity-threshold values (§12 §3.5) and the rendition-priority ordering (§12 §3.2) are exactly the kind of decision that looks like an arbitrary tuning parameter to a future engineer and is in fact load-bearing — these should be recorded as ADRs with the cost/quality trade-off data that justified the specific threshold chosen, so a future "let's just lower the threshold, more quality is better" change is made with the original cost analysis in hand, not against a blank slate.

**Cost optimization:** Beyond the popularity-driven ladder itself, the highest-leverage remaining levers are per-title/per-scene encoding (§10 Expert Q9) and storage tiering by access recency — both are modeling/policy changes rather than infrastructure spend, and both should be quantified against a representative content sample before investment, the same discipline applied throughout this course to distinguish a justified optimization from a speculative one.

**Risk analysis:** The dominant risk class here is not outage but **silent cost or quality drift** — a codec regression that quietly increases average bitrate 10%, a popularity threshold that's drifted wrong as the catalog's view distribution shifts, a CDN cache-hit ratio degrading gradually as content ages past its shield TTL — each produces no user-visible failure and no alert unless specifically instrumented for, and each compounds continuously at this system's scale. A Principal Engineer's risk register for this system should weight these drift metrics at least as heavily as availability, which is a genuinely counter-intuitive prioritization to defend to stakeholders trained to think of "risk" as "outage."

**Long-term maintainability:** The artifacts most likely to decay silently are the popularity thresholds (as the catalog's overall view distribution shifts with platform growth), the codec/rendition ladder itself (as client device capabilities and network conditions evolve over years), and the cost-estimation model feeding the scheduler's memory-aware placement (§14's fix) as new codecs and resolutions are added. Each needs an owner and a periodic review cadence — without one, the system's cost efficiency erodes gradually enough that no single change looks alarming, exactly the shape of drift a purely incident-driven operating model will miss until the aggregate cost impact is large.

## 18. Revision
**Key takeaways**: Video platforms are fundamentally a large-binary-content problem, requiring chunked/resumable upload, an asynchronous, independently-job-per-rendition transcoding pipeline (never monolithic —), and CDN-primary (not CDN-as-cache) delivery. Adaptive bitrate streaming is client-driven, requiring pre-generated discrete quality renditions, not server-side dynamic encoding. View-count and similar high-frequency counters must be batched/aggregated asynchronously (Redis counters + periodic flush), never synchronously written per-event. Storage tiering by access-frequency/popularity (a power-law distribution, directly paralleling the celebrity-account skew) is an economic necessity at this scale, not an optional optimization.

---

**Next**: Continuing autonomously to Module 42 — Designing Instagram (Photo/Video Sharing, Stories & Feed).
