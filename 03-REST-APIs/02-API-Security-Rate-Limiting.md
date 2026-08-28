# Module 16 — REST APIs: API Security & Rate Limiting Patterns

> Domain: REST APIs | Level: Beginner → Expert | Prerequisite: [[01-REST-Design-Fundamentals]] (idempotency), [[../02-DotNet-AspNetCore/04-Authentication-Authorization-Deep-Dive]], [[../01-CSharp/02-Async-Await-Internals]] §Expert Q6 (distributed rate limiting)

---

## 1. Fundamentals

### What is API security, and what is rate limiting?
API security is the set of practices protecting an API's endpoints, data, and downstream systems from unauthorized access, abuse, and resource exhaustion — spanning authentication/authorization, input validation, transport security (TLS), and abuse-prevention mechanisms. **Rate limiting** is a specific abuse-prevention mechanism: capping how many requests a given caller (or the system overall) may make within a time window, protecting the API and its downstream dependencies from being overwhelmed — whether by a malicious attacker, a buggy client in a retry loop, or simply legitimate traffic exceeding provisioned capacity.

### Why do these exist?
Any publicly (or even internally, cross-team) reachable API is a genuine attack surface — without deliberate security controls, it's vulnerable to credential attacks, injection, data exposure, and resource-exhaustion abuse. Rate limiting exists specifically because **without it, a single caller (malicious or merely buggy) can consume unbounded capacity**, degrading service for every other caller — this is true even for entirely well-intentioned callers (§Expert Q6's thundering-herd/retry-storm scenario).

### When does this matter?
Every externally-facing (and most internally-facing, cross-team) API needs both; the depth matters for correctly implementing rate limiting that's actually effective at fleet scale (not just per-replica, which is trivially bypassable by spreading requests across replicas) and for recognizing the specific, common API-security vulnerability classes (broken object-level authorization, mass assignment, excessive data exposure) that dominate real-world API breaches.

### How does it work (30,000-ft view)?
```csharp
builder.Services.AddRateLimiter(options =>
    {
        options.AddTokenBucketLimiter("per-client", opt =>
            {
                opt.TokenLimit = 100;
                opt.TokensPerPeriod = 100;
                opt.ReplenishmentPeriod = TimeSpan.FromMinutes(1);
        });
});
app.UseRateLimiter;
app.MapGet("/orders", GetOrders).RequireRateLimiting("per-client");
```

---

## 2. Deep Dive

### 2.1 The OWASP API Security Top 10 — Why It's Distinct from the General OWASP Top 10
The OWASP API Security Top 10 exists as a **separate** list from the general OWASP Top 10 because APIs have distinctive risk patterns not centered in traditional web-app security: **Broken Object Level Authorization (BOLA/IDOR)** — the single most common API vulnerability — occurs when an API checks *authentication* but not *per-object authorization* (exactly the resource-based authorization gap, restated as an industry-recognized top vulnerability class); **Excessive Data Exposure** — returning a full internal entity/DTO with more fields than the client actually needs, relying on the client to "just not display" sensitive fields, rather than the server withholding them; **Broken Function Level Authorization** — a caller reaching an admin-only *operation* (not just a specific object) they shouldn't; **Mass Assignment** — directly the over-posting vulnerability, now recognized as an API-specific OWASP category in its own right.

### 2.2 Rate Limiting Algorithms — Precise Trade-offs
- **Fixed window**: count requests per fixed time bucket (e.g., per calendar minute) — simple, but has a **boundary-burst problem**: a client can send the full limit at 11:59:59 and another full limit at 12:00:01, doubling the effective allowed rate right at the window boundary.
- **Sliding window (log or counter-based)**: tracks requests within a continuously-moving window, avoiding the boundary-burst problem at the cost of more state (a log of timestamps, or a weighted blend of the current and previous fixed windows).
- **Token bucket**: a bucket holds tokens, refilled at a steady rate, consumed per request — naturally allows **bursts** up to the bucket's capacity while enforcing a steady-state average rate, the most commonly used algorithm for API rate limiting specifically because it models "occasional bursts are fine, sustained abuse isn't" well.
- **Leaky bucket**: requests queue and are processed at a strictly constant output rate — smooths bursts entirely (no burst allowance) at the cost of added latency for bursty-but-legitimate traffic.

### 2.3 Distributed Rate Limiting — the Fleet-Scale Requirement
A per-replica, in-memory rate limiter (`System.Threading.RateLimiting`'s built-in limiters used with default, local state) only limits **that specific replica's** view of a client's traffic — across N horizontally-scaled replicas, a client could receive N times the intended limit by simply having requests load-balanced across replicas. Genuine fleet-wide rate limiting requires **shared, external state** (a Redis-backed atomic counter/token-bucket, evaluated via a Lua script for atomicity) — directly the pattern first introduced §Expert Q6, now contextualized as the standard, necessary architecture for any rate limit meant to apply to a caller's *aggregate* traffic across an entire fleet, not just one replica's slice of it.

### 2.4 Rate Limit Response Contract — `429` and `Retry-After`
A rate-limited response should return `429 Too Many Requests` with a `Retry-After` header (seconds, or an HTTP date) telling the well-behaved client exactly when to retry — this directly enables correct client-side backoff (the retry patterns) rather than the client guessing an arbitrary backoff interval; omitting `Retry-After` forces every client to implement its own guessed backoff strategy, often producing exactly the synchronized-retry-storm problem (§Expert Q7) rate limiting exists to prevent in the first place.

### 2.5 Input Validation as a Security Boundary
Every API input boundary must validate: type/shape (model binding), size limits (request body size caps, preventing a single oversized payload from being a resource-exhaustion vector — directly the `stackalloc`-sizing caution generalized to any input-driven allocation), and business-rule validity (422) — treating client input as untrusted by default, never assuming a "friendly" first-party client always sends well-formed data, since any input boundary is also reachable by a malicious or compromised caller regardless of who the API was originally designed for.

## 3. Visual Architecture
```mermaid
graph LR
 Client -->|request + API key| Gateway["API Gateway / Rate Limiter"]
 Gateway -->|check token bucket| Redis[(Shared Redis Store)]
 Redis -->|tokens available| Gateway
 Gateway -->|within limit| App[Application]
 Gateway -->|exceeded| Reject["429 + Retry-After"]
 App --> AuthZ["Resource-based Authorization<br/>(BOLA prevention)"]
 AuthZ --> DTO["Narrow response DTO<br/>(excessive-exposure prevention)"]
```

## 4. Production Example
**Scenario**: A partner API experienced a BOLA (Broken Object Level Authorization) vulnerability — an endpoint `GET /invoices/{id}` checked only that the caller was *authenticated* (any valid API key), never that the requested invoice actually belonged to *that specific* caller's account, allowing any partner to enumerate and read every other partner's invoices by simply incrementing the ID. **Investigation**: found via a routine security audit (not an incident) specifically testing this exact pattern across every resource-ID-accepting endpoint. **Fix**: added resource-based authorization (the exact pattern) verifying `invoice.PartnerId == currentPartnerId` before returning data, across every affected endpoint, plus a systemic audit of the entire API surface for the same gap. **Lesson**: BOLA is the single most common real-world API vulnerability precisely because "the endpoint requires authentication" is trivially confused with "the endpoint enforces authorization" — they are not the same, and this module's OWASP-API-Top-10 framing exists specifically to keep that distinction front-of-mind.

## 5. Best Practices
- Enforce resource-based (per-object) authorization on every endpoint accepting a resource identifier — never rely on authentication alone.
- Return narrowly-scoped response DTOs, never full internal entities, closing the excessive-data-exposure gap.
- Use token-bucket rate limiting backed by a shared store (Redis) for genuine fleet-wide enforcement.
- Always return `429` with `Retry-After` for rate-limited requests.
- Validate and cap request body size at the edge, before any business logic executes.

## 6. Anti-patterns
- Checking authentication but not per-object authorization (BOLA, the incident).
- Returning full domain entities directly from API endpoints (mass assignment on the way in, excessive exposure on the way out — both the concerns).
- Per-replica-only (in-memory) rate limiting in a horizontally-scaled deployment, trivially bypassed by load-balanced traffic spreading.
- Omitting `Retry-After` on 429 responses, forcing clients into guessed, potentially-synchronized backoff.

---

## 7. Performance Engineering

**CPU:** A Redis-backed distributed rate limiter adds a network round-trip (and Lua-script execution cost on the Redis side) to every rate-limited request — at scale, this is real, additive latency on the hot path; a common mitigation is a **local, short-TTL cache of "definitely under limit"** results (e.g., cache a "not yet at 80% of limit" verdict for a few hundred milliseconds per client key) to avoid a Redis round-trip on every single request when a client is nowhere near its limit, falling back to the authoritative Redis check only as usage approaches the threshold.

**Memory:** A sliding-window-log rate limiter (storing every request timestamp per client) has memory cost proportional to request volume within the window — at high QPS per client this can be substantial; a counter-based sliding window (blending two adjacent fixed-window counts) trades exactness for O(1) memory per client key, the standard production compromise.

**Latency:** JWT signature verification (RS256/ES256 asymmetric) is meaningfully more CPU-expensive per request than HS256 symmetric verification — at very high request volume, this becomes a measurable per-request cost; caching the verified-token result (keyed by token hash, bounded by the token's own expiry) for the remainder of a short-lived token's validity window avoids re-verifying the same token's signature on every request within a burst.

**Throughput:** Token-bucket rate limiting's burst allowance is itself a throughput-shaping decision — sizing the bucket capacity too small forces legitimate bursty clients (a batch job, a UI page loading 10 resources concurrently) into artificial 429s; sizing it too large defeats the limiter's abuse-prevention purpose. This is a genuine tuning exercise informed by real traffic-pattern data, not a one-size-fits-all default.

**Benchmarking:** Load-test rate-limiting and authorization checks under realistic **concurrent multi-client** traffic, not single-client sequential requests — the fleet-scale correctness property (§2.3) and any lock-contention behavior in the shared Redis store only surface under genuine concurrency, mirroring this course's recurring "test at representative scale" theme.

**Caching:** Authorization decisions that are expensive to compute (a multi-hop entitlement lookup) but change infrequently are candidates for a short-TTL cache — but cache invalidation must be explicit and immediate for security-sensitive authorization changes (a revoked entitlement must not remain effective for the cache's TTL), making authorization caching a narrower, more carefully-scoped optimization than general-purpose response caching.

## 8. Security — Beyond §1–§6: Token Replay, Distributed Bypass, and Credential Stuffing

This section goes past the module's core BOLA/rate-limiting/OWASP-API-Top-10 coverage in §1–§6 into three additional, frequently-tested threat classes.

**OAuth2 token replay:** A stolen bearer access token (leaked via logging, a compromised proxy, or a browser-extension exfiltration) is fully usable by an attacker until it expires — bearer tokens carry no built-in binding to the legitimate holder. Mitigations: (1) **short-lived access tokens** (minutes, not hours) with refresh-token rotation, bounding the replay window; (2) **sender-constrained tokens** — DPoP (Demonstrating Proof-of-Possession) or mTLS-bound tokens, where the token is cryptographically bound to a client-held key, so a stolen token alone is useless without the corresponding private key; (3) **audience and `jti` (JWT ID) tracking** to detect and reject a token being replayed against an unexpected audience or replayed after a legitimate one-time-use scenario has already consumed it; (4) refresh-token **reuse detection** — if a rotated-away refresh token is ever presented again, that's a strong signal of token theft, and the correct response is to revoke the entire token family, not just reject the single replayed token.

**Distributed rate-limit bypass:** Beyond the fleet-scale (per-replica-state) bypass already covered in §2.3, attackers actively exploit **key-selection gaps**: rotating through many API keys/accounts (if self-service signup is cheap), distributing requests across a botnet's IP pool, or exploiting a rate limiter keyed only on IP when the API is behind a shared corporate NAT/CDN edge (making the limiter's effective granularity far coarser than intended, in both directions — see Advanced Q6). A further, subtler bypass: **rate-limiting inconsistency across a heterogeneous edge** — if some traffic reaches the API via a CDN/WAF layer that itself enforces a *different* limit than the origin's application-level limiter, the two layers' disagreement can be probed and exploited to find the more permissive path. Mitigation is a **single source of truth for rate-limit state** (the Redis-backed shared store) consulted identically regardless of which edge path a request took, plus layered velocity controls keyed on multiple dimensions simultaneously (identity, IP, device fingerprint) so no single dimension's bypass fully defeats the control.

**Credential stuffing:** Attackers replay large lists of previously-breached username/password pairs (sourced from unrelated third-party breaches) against a login endpoint, relying on password reuse across services. Generic rate limiting on the login endpoint helps but is insufficient alone — the same distributed-bypass techniques above apply, and a determined attacker paces requests below any single-IP/single-account threshold while trying many accounts. Defenses layer: (1) **per-account** *and* **per-IP** velocity limits on login attempts, tuned independently; (2) **breached-credential screening** at signup/login time (checking submitted passwords against a known-breached-password corpus, e.g., via a k-anonymity API pattern, and forcing a reset if matched); (3) **anomaly-based detection** — a spike in distinct-account login attempts from one IP/device, or a spike in failed logins with high password-list diversity, is the actual signal, exactly mirroring the card-testing detection logic (Expert Q1) applied here to the authentication surface instead of the payment-authorization surface; (4) **CAPTCHA/step-up authentication** triggered adaptively once anomaly signals fire, rather than imposed unconditionally on every login (which degrades legitimate-user experience for no benefit against a determined, distributed attacker); (5) **MFA** as the durable structural defense — even a successful credential-stuffing match is insufficient to authenticate if a second factor is required.

## 9. Scalability

**Horizontal scaling:** Every rate-limiting and authorization mechanism in this module must work correctly when the API is scaled to N replicas — the fleet-scale requirement (§2.3) is the central scalability constraint, and any design that implicitly assumes single-instance state (an in-memory `Dictionary` counter) breaks silently, not loudly, the moment a second replica is added.

**Caching/replication:** The shared Redis rate-limit store itself needs its own HA posture — a Redis primary/replica setup with automatic failover (Redis Sentinel or a managed equivalent) so the rate limiter's own infrastructure isn't a single point of failure for the entire API (directly Advanced Q8's fail-open/fail-closed design question).

**Partitioning:** For very high request volume, the shared rate-limit store can itself be partitioned/sharded by client-key hash across multiple Redis instances, avoiding a single Redis instance becoming the throughput bottleneck for the entire fleet's rate-limit checks.

**Load balancing:** Rate-limit and authorization checks should be **stateless from the load balancer's perspective** — any replica can serve any request, since the authoritative state lives in the shared store, not on a specific replica — preserving the load balancer's freedom to route without sticky-session constraints.

**High availability:** The fail-open-vs-fail-closed decision (Advanced Q8) is fundamentally an availability-vs-security trade-off decision made explicit at the architecture level — for a money-movement API, this is a business-risk decision requiring sign-off, not a default an infrastructure team should make silently.

**Disaster recovery:** A regional failover for a multi-region API must carry rate-limit and token-revocation state with it (or accept a defined, bounded window of degraded enforcement during failover) — an unaddressed gap here means a DR failover silently resets every client's rate-limit counters or, worse, temporarily fails to enforce a just-revoked token's revocation.

---

## 10. Interview Questions

### Basic (10)
1. **Q: What is BOLA?** **A:** Broken Object Level Authorization — an API checks authentication but not whether the caller is authorized to access the *specific* requested object.
2. **Q: What is mass assignment?** **A:** Binding a request body directly onto a rich entity type, letting a client set unintended fields.
3. **Q: What status code should a rate-limited request return?** **A:** 429 Too Many Requests — a distinct, machine-recognizable signal (separate from 4xx client errors and 5xx server failures) that well-behaved clients and SDKs interpret as "back off and retry later," ideally accompanied by a `Retry-After` header.
4. **Q: What header tells a client when to retry after a 429?** **A:** `Retry-After` — expressed as either seconds-to-wait or an HTTP date; emitting it (ideally with jittered values) shapes client behavior into coordinated backoff instead of leaving every client to guess and hammer the API in synchronized retry waves.
5. **Q: What's the boundary-burst problem with fixed-window rate limiting?** **A:** A client can send the full limit at the very end of one window and again at the very start of the next, doubling the effective rate at the boundary.
6. **Q: What does a token bucket allow that a leaky bucket doesn't?** **A:** Bursts up to the bucket's capacity, while still enforcing a steady-state average rate.
7. **Q: Why doesn't a per-replica in-memory rate limiter work correctly at fleet scale?** **A:** Each replica only sees its own slice of a client's traffic, so the effective limit multiplies by replica count.
8. **Q: What is excessive data exposure?** **A:** Returning more fields in a response than the client legitimately needs, relying on the client not to misuse them rather than the server withholding them.
9. **Q: Why is the OWASP API Security Top 10 a separate list from the general OWASP Top 10?** **A:** APIs have distinctive risk patterns (BOLA, mass assignment, broken function-level authorization) not centered in traditional web-app security concerns.
10. **Q: What should an API do with an oversized request body?** **A:** Reject it early via a configured size limit, before it reaches business logic.

### Intermediate (10)
1. **Q: Why is BOLA the most common real-world API vulnerability?** **A:** Because "requires authentication" is easily and commonly confused with "enforces authorization" — an endpoint can correctly reject unauthenticated callers while still failing to check whether the authenticated caller owns the specific requested resource.
2. **Q: How does a sliding-window rate limiter avoid the fixed-window boundary-burst problem?** **A:** It tracks requests within a continuously-moving window (via a timestamp log or a weighted blend of adjacent fixed windows) rather than resetting a hard counter at fixed boundaries, so there's no single instant where two full allowances stack.
3. **Q: Why is Redis (or another shared store) required for genuine fleet-wide rate limiting?** **A:** It provides the single, shared, atomically-updatable counter/bucket state every replica reads and writes to, so a client's aggregate usage across the whole fleet is correctly tracked, not just one replica's local view.
4. **Q: What's the security risk of omitting per-object authorization even when using a resource ID that "looks unguessable" (a GUID)?** **A:** Unguessability isn't authorization — an attacker with a leaked/logged/observed GUID (e.g., from a referrer header, a shared link, or another vulnerability) can still access the resource if no ownership check exists; GUIDs reduce enumeration risk but do not substitute for authorization.
5. **Q: Why should a rate limiter's response include `Retry-After` instead of leaving clients to guess their backoff interval?** **A:** It gives the client an authoritative, server-determined retry time, preventing every client from independently guessing (and potentially synchronizing on) their own backoff interval, which itself can create a retry storm.
6. **Q: What's the difference between rate limiting a specific endpoint versus rate limiting a client's aggregate usage across an entire API?** **A:** Per-endpoint limiting protects that specific operation's cost profile (useful if one endpoint is disproportionately expensive); aggregate limiting protects overall fair-usage/capacity allocation across a client's entire traffic — many production systems apply both simultaneously, at different granularities.
7. **Q: Why is returning a full domain entity from an endpoint a security concern even if the client "shouldn't" read certain fields?** **A:** Relying on client-side restraint (not displaying a field) provides no actual security — any caller can inspect the raw HTTP response directly, so genuinely sensitive fields must be withheld server-side, not merely hidden in the client UI.
8. **Q: How would you rate-limit differently for authenticated versus unauthenticated traffic on the same endpoint?** **A:** Key the rate limiter by authenticated user/API-key identity when present (a higher, per-identity limit) and fall back to IP-based limiting for unauthenticated requests (typically a stricter limit, since IP-based keying is coarser and more easily shared among unrelated legitimate users behind NAT).
9. **Q: What's a realistic scenario where request-size limiting itself becomes a rate-limiting-adjacent concern?** **A:** An attacker sending many moderately large (but individually within-limit) payloads can still exhaust bandwidth/parsing capacity faster than small payloads would — request-size limits and rate limits are complementary controls, not substitutes for each other.
10. **Q: Why does a security audit specifically test BOLA by attempting to access another tenant's/user's resource with a valid but different identity, rather than just checking "does authentication work"?** **A:** Because authentication working correctly says nothing about whether authorization is also correctly enforced per-resource — the only way to verify BOLA protection is to actually attempt cross-account access and confirm it's denied, exactly mirroring the contract-consistency testing philosophy from earlier modules (test the actual behavior, not just the presence of a mechanism).

### Advanced (10)
1. **Q: Design a token-bucket rate limiter backed by Redis with correct atomicity under concurrent requests.**
 **A:** Use a Redis Lua script (executed atomically server-side) that reads the current token count and last-refill timestamp, computes the number of tokens to add based on elapsed time, caps at the bucket capacity, and atomically decrements if a token is available — all within one atomic script execution, avoiding the read-then-write race that a naive "GET count, check, SET count" sequence (non-atomic across two round-trips) would be vulnerable to under concurrent requests from the same client.
2. **Q: Explain how you would systematically audit an existing large API surface for BOLA vulnerabilities.**
 **A:** Enumerate every endpoint accepting a resource identifier (route parameter or body field); for each, write an automated test authenticating as User/Tenant A and attempting to access a resource known to belong to User/Tenant B, asserting a 403/404 (not the actual data) — run this systematically across the entire endpoint inventory rather than spot-checking, since BOLA gaps are endpoint-specific and one fixed instance doesn't imply others are also fixed.
3. **Q: How would you design rate limiting to protect a third-party API with its own strict, contractual rate limit, across a fleet of your own services calling it?** **A:** Directly §Expert Q6's distributed proactive rate limiter — a shared, Redis-backed token bucket sized to the third party's actual contractual limit, checked by every calling replica before issuing the outbound call, combined with local per-replica bounded concurrency and retry-with-backoff as defense-in-depth beneath the proactive limiter.
4. **Q: A team argues excessive data exposure isn't a real risk for an internal-only API since "we control both sides." Push back with a concrete scenario.**
 **A:** Internal APIs are frequently consumed by more teams/services over time than originally anticipated, and a full-entity response (including, e.g., internal cost data, other customers' aggregate data, or soon-to-be-deprecated fields) becomes an unintended, hard-to-track dependency the moment any other team starts parsing fields "just in case" — when the API owner later wants to remove or restrict that field, they discover an undocumented internal consumer depends on it; narrow, intentional response contracts prevent this accidental coupling regardless of whether the API is "internal only."
5. **Q: Design a rate-limiting strategy that adapts dynamically based on current system load (adaptive rate limiting) rather than a fixed threshold.**
 **A:** Monitor a leading load indicator (CPU, database connection-pool utilization, downstream dependency latency) and dynamically adjust the token-bucket refill rate/capacity downward as load increases — trading strict predictability for graceful degradation under genuine system stress, at the cost of a less deterministic, harder-to-document contract for API consumers (a real trade-off to discuss explicitly, not a strictly superior approach).
6. **Q: Explain why a rate limiter keyed purely by IP address is both under- and over-inclusive, and how would you address each failure mode.**
 **A:** Under-inclusive: a determined attacker distributes requests across many IPs (a botnet), evading any single-IP threshold entirely — address via behavioral/anomaly-based detection layered on top, not IP-keying alone. Over-inclusive: many legitimate users can share one IP (corporate NAT, mobile carrier-grade NAT), so an aggressive per-IP limit can collectively throttle many unrelated innocent users — address via combining IP-based limiting (for unauthenticated traffic) with authenticated-identity-based limiting (a much more precise key) wherever authentication is available.
7. **Q: How would you design an API's error responses to avoid leaking information useful for a BOLA/enumeration attack?** **A:** Return an identical `404 Not Found` (not a distinguishing `403 Forbidden`) for both "resource doesn't exist" and "resource exists but you're not authorized to see it" — returning a distinguishing 403 confirms the resource's existence to an attacker probing IDs, information a pure 404 doesn't reveal (directly the 401-vs-403 information-hiding discussion, applied here to 403-vs-404).
8. **Q: A payment API's rate limiter is itself becoming a single point of failure (the Redis-backed limiter's own outage blocks all traffic). How would you design around this?** **A:** Implement a fail-open-with-monitoring or fail-closed decision deliberately per business risk: for most APIs, briefly failing open (allowing requests through without rate-limiting enforcement) during a rate-limiter-infrastructure outage is preferable to a full API outage, provided it's paired with aggressive alerting on the rate-limiter's own health and a fast-acting circuit breaker reverting to fail-open only for a bounded window; for an API where unbounded abuse during any gap is unacceptable (e.g., a scarce, expensive third-party pass-through), fail-closed may be the correct, deliberate choice instead — the decision should be explicit and documented, not a default neither team consciously chose.
9. **Q: Explain how excessive data exposure and mass assignment are two sides of the same underlying architectural mistake.**
 **A:** Both stem from binding directly to/from a rich internal entity type instead of a dedicated, narrowly-scoped DTO at the API boundary — mass assignment is the input-side manifestation (a client sets fields it shouldn't), excessive exposure is the output-side manifestation (a client reads fields it shouldn't); the single, unifying fix (dedicated request/response DTOs) addresses both simultaneously.
10. **Q: As a Principal Engineer, how would you make BOLA prevention structurally enforced across an organization rather than dependent on every team remembering to add resource-based authorization checks?** **A:** Combine: (a) a shared repository/service-layer base class or helper (the `IResourceAuthorizationHelper`) making the correct pattern the path of least resistance; (b) mandatory automated BOLA-probing tests (Advanced Q2) as a required CI gate for any endpoint accepting a resource identifier; (c) an architecture-review checklist item requiring explicit justification for any endpoint that intentionally omits per-object authorization (e.g., genuinely public resources) — converting "remember to check ownership" from tribal knowledge into layered, automated, and governance-enforced protection.

### Expert (FinTech Principal Panel)

1. **Q: Your card-authorization API is being used for "card testing" — attackers running many small auths to validate stolen card numbers (and BIN enumeration). Your per-IP/per-key rate limits don't stop it. Why not, and what actually defends against this?**
 **A:** Generic rate limiting keys on the *caller* (IP/API key), but card testing distributes across many IPs/keys and stays under per-caller thresholds while abusing many *cards* — so the abused dimension isn't the caller, it's the card/BIN/velocity of attempts, which caller-keyed limits don't see. Defenses are **fraud/velocity controls**, distinct from security rate limiting: (1) **velocity limits keyed on the resource under attack** — attempts per card, per BIN, per device, per shipping/billing tuple, over rolling windows; (2) **anomaly detection** — a spike in low-value auths, high decline ratios, or many distinct cards from one device/session is the actual signal; (3) **device fingerprinting / proof-of-work / CAPTCHA** on suspicious flows to break automation; (4) **decline-rate circuit breakers** that tighten automatically when the auth-decline ratio spikes; (5) feed confirmed abuse back into a shared block/deny list. Also **don't leak an oracle** — uniform responses/timing so an attacker can't distinguish "valid card, wrong CVV" from "invalid card" (that turns your API into a card validator). The Principal framing: rate limiting protects *capacity and fairness per caller*; card testing is a *fraud* problem on the card dimension — you need velocity + anomaly + device signals + non-oracle responses, and treating it as "just tune the rate limit" fails because you're limiting the wrong dimension.
 **Why correct:** Explains why caller-keyed limits miss card-dimension abuse and prescribes velocity/anomaly/device controls + decline circuit breakers + non-oracle responses.
 **Common mistakes:** Assuming rate limiting stops card testing; leaking a validity oracle via distinct responses/timing; keying controls only on caller, never on card/BIN/device.
 **Follow-ups:** "What dimensions do you key velocity limits on?" / "How does your API avoid becoming a card-validation oracle?" / "Rate limiting vs. fraud controls — where's the line?"

2. **Q: Design the defense-in-depth layering for a public, internet-facing money-movement API. Name each layer, what it stops, and why no single layer suffices.**
 **A:** Layer controls so a bypass of one is caught by the next, from edge inward: (1) **Edge/WAF + DDoS protection + TLS/mTLS** — volumetric attacks, known exploit patterns, transport security; (2) **Authentication** (sender-constrained tokens/mTLS for high value) — proves *who*; (3) **Rate limiting** (per-identity + per-IP) — caller fairness/capacity; (4) **Authorization** — coarse function-level (`[Authorize]`) *and* per-object BOLA checks (the most common real gap) — proves *allowed to touch this object*; (5) **Input validation + size/depth limits + DTO binding** — mass assignment, injection, DoS payloads; (6) **Fraud/velocity controls** — abuse on the money/card dimension (Q1); (7) **Idempotency + transactional integrity** — no double-charge; (8) **Output minimization** — no excessive data exposure; (9) **Audit + observability** — detect and prove. No single layer suffices because each addresses a different threat class and each *will* occasionally be bypassed (a valid token can be stolen, an auth check can be forgotten on one endpoint, a fraud model has false negatives) — defense-in-depth means the blast radius of any one failure is bounded by the others. The Principal framing: security for a money API is a *layered system* with an explicit threat per layer and no single point of total trust; the design goal is that compromising one control still leaves an attacker facing the rest.
 **Why correct:** Enumerates distinct layers each mapped to a threat class and articulates why single-layer trust is unsafe (each layer fails sometimes; layering bounds blast radius).
 **Common mistakes:** Treating auth *or* rate limiting as "the" security; forgetting per-object authorization; no fraud layer; relying on a single control.
 **Follow-ups:** "Which layer most commonly has the real-world gap?" (per-object authorization / BOLA) / "How does idempotency function as a security control?" / "What's the blast radius if a token is stolen, under this stack?"

3. **Q: The same transaction resource is consumed by a customer app, a partner integrator, and internal ops — each should see a *different subset* of fields (e.g., only ops sees the internal risk score; PAN is masked for everyone but tokenized-vault access). How do you design field-level authorization beyond "use a DTO"?**
 **A:** A single response DTO isn't enough when the *same* resource must expose different fields to different audiences — you need **scope/role-driven field authorization**. Approaches: (1) **audience-specific representations** — distinct DTOs/projections per consumer scope (customer view, partner view, ops view), selected by the caller's scope/role, so each audience only ever gets its allowed fields and adding a sensitive field can't accidentally leak to a narrower audience; (2) **field-level policy** — a serialization layer that includes/redacts individual fields based on the caller's scopes (useful when field visibility is fine-grained), with a **default-deny** posture (a new field is hidden unless explicitly allowed for a scope); (3) **always mask/tokenize the most sensitive data** (PAN, full account number) at rest and in every representation, exposing raw values only through a separately-authorized vault path with its own audit. Enforce with tests asserting each scope's response contains *only* its permitted fields (the output-side analogue of BOLA testing). The Principal framing: "use a DTO" solves accidental full-entity exposure, but multi-audience financial data needs *scope-driven, default-deny field authorization* so that who-you-are determines which fields you receive — and the crown-jewel fields (PAN) are masked/tokenized universally with vault-gated, audited access.
 **Why correct:** Moves past a single DTO to scope-driven, default-deny field authorization with audience-specific projections, universal masking/tokenization of crown-jewel data, and per-scope output tests.
 **Common mistakes:** One DTO for all audiences; opt-out (default-visible) field exposure; exposing raw PAN anywhere instead of tokenizing; no per-scope output assertions.
 **Follow-ups:** "Default-deny vs. default-allow for new fields — why does it matter?" / "How do you expose a PAN only to an authorized, audited path?" / "How would you test that the partner scope never sees the internal risk score?"

---

## 11. Coding Exercises

### Easy — Add resource-based authorization closing a BOLA gap
```csharp
// BEFORE (vulnerable): only checks authentication
app.MapGet("/invoices/{id}", async (string id, IInvoiceRepository repo) =>
    {
        var invoice = await repo.GetByIdAsync(id);
        return invoice is null? Results.NotFound: Results.Ok(invoice);
}).RequireAuthorization;

// AFTER (fixed): checks ownership too
app.MapGet("/invoices/{id}", async (string id, IInvoiceRepository repo, ClaimsPrincipal user) =>
    {
        var invoice = await repo.GetByIdAsync(id);
        var currentPartnerId = user.FindFirstValue("partner_id");
        if (invoice is null || invoice.PartnerId!= currentPartnerId)
            return Results.NotFound; // 404, not 403 -- avoids confirming existence (Advanced Q7)
        return Results.Ok(invoice);
}).RequireAuthorization;
```

### Medium — Token-bucket rate limiting with `Retry-After`
```csharp
builder.Services.AddRateLimiter(options =>
    {
        options.OnRejected = async (context, ct) =>
        {
            context.HttpContext.Response.Headers.RetryAfter = "60";
            context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
            await context.HttpContext.Response.WriteAsJsonAsync(new { error = "rate_limit_exceeded" }, ct);
        };
        options.AddTokenBucketLimiter("api", opt =>
            {
                opt.TokenLimit = 100; opt.TokensPerPeriod = 100; opt.ReplenishmentPeriod = TimeSpan.FromMinutes(1);
        });
});
```

### Hard — Distributed Redis-backed token bucket (Advanced Q1)
```lua
-- Redis Lua script: atomic token-bucket check-and-decrement
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2]) -- tokens per second
local now = tonumber(ARGV[3])

local bucket = redis.call("HMGET", key, "tokens", "lastRefill")
local tokens = tonumber(bucket[1]) or capacity
local lastRefill = tonumber(bucket[2]) or now

local elapsed = math.max(0, now - lastRefill)
tokens = math.min(capacity, tokens + elapsed * refillRate)

if tokens < 1 then
 redis.call("HMSET", key, "tokens", tokens, "lastRefill", now)
 return 0 -- rejected
else
 tokens = tokens - 1
 redis.call("HMSET", key, "tokens", tokens, "lastRefill", now)
 return 1 -- allowed
end
```
**Discussion**: Running this as a single Lua script executed atomically by Redis (`EVAL`) is what prevents the read-then-write race a naive two-round-trip implementation would suffer under concurrent requests from the same client — exactly Advanced Q1's requirement.

### Expert — DTO-based mass-assignment/excessive-exposure prevention with automated BOLA test
```csharp
public record InvoiceResponse(string Id, decimal Amount, DateTime DueDate); // narrow, no PartnerId, no internal cost fields

// Automated BOLA regression test (Advanced Q2's pattern):
[Fact]
public async Task GetInvoice_Should_Return_404_For_Other_Partners_Invoice
{
    var clientA = _factory.CreateAuthenticatedClient(partnerId: "partner-a");
    var invoiceOwnedByB = await SeedInvoiceAsync(partnerId: "partner-b");

    var response = await clientA.GetAsync($"/invoices/{invoiceOwnedByB.Id}");

    Assert.Equal(HttpStatusCode.NotFound, response.StatusCode); // NOT the invoice data, NOT a 403
}
```

---

## 12–17. System Design / LLD / Debugging / Decision / Case Study / Principal

A partner API platform enforces resource-based authorization on every endpoint (mandatory checklist item), narrow response DTOs everywhere, and Redis-backed token-bucket rate limiting keyed by authenticated partner identity, with automated BOLA-probing tests as a CI gate. The production-debugging signature pattern for this module is exactly the incident — diagnosed by systematically testing cross-tenant access on every resource-ID-accepting endpoint, not by waiting for a reported breach. Principal-level guidance: BOLA and mass assignment/excessive exposure are the two highest-value, most mechanically-auditable API vulnerability classes — invest in automated, CI-enforced testing for both before investing in more exotic security controls, since these two categories dominate real-world API breach statistics.

## 18. Revision
**Key takeaways**: BOLA = authentication without per-object authorization, the #1 real-world API vulnerability. Mass assignment (input) and excessive data exposure (output) are the same architectural mistake (binding directly to rich entities) manifesting on both sides of the API boundary. Token bucket = the standard rate-limiting algorithm, allowing bursts while enforcing steady-state limits. Distributed (Redis-backed, Lua-atomic) rate limiting is required for genuine fleet-wide enforcement — per-replica limiting is trivially bypassed. Always return 429 + `Retry-After`; return 404 (not 403) to avoid confirming a resource's existence to an unauthorized caller.

---

**Next**: Continuing autonomously to Module 17 — API Documentation, Contract Testing & OpenAPI (completing the `03-REST-APIs` domain) before advancing to `04-SQL-Server`.
