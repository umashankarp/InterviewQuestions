# Module 40 — System Design: Designing a Distributed Rate Limiter & API Gateway

> Domain: System Design | Level: Beginner → Expert | Prerequisite: [[01-System-Design-Fundamentals]], [[../03-REST-APIs/02-API-Security-Rate-Limiting]] (rate-limiting algorithms), [[../01-CSharp/02-Async-Await-Internals]] §Expert Q6 (the original distributed rate limiter introduced early in this course)

---
# Distributed Rate Limiter & API Gateway (AWS)

```mermaid
flowchart LR

 Client[Client]

 Client --> CloudFront[CloudFront]

 CloudFront --> WAF[AWS WAF]

 WAF --> APIGateway[API Gateway]

 APIGateway --> Auth[Cognito / JWT]

 Auth --> RateLimiter[Rate Limiter]

 RateLimiter --> Redis[(ElastiCache Redis)]

 RateLimiter -->|Allowed| ALB[Application Load Balancer]

 RateLimiter -->|429 Too Many Requests| Reject[Reject Request]

 ALB --> ECS[ECS / EKS Microservices]

 ECS --> Aurora[(Aurora)]

 ECS --> DynamoDB[(DynamoDB)]

 ECS --> EventBridge[EventBridge]

 EventBridge --> SNS[SNS]

 SNS --> SQS[SQS]

 ECS --> CloudWatch[CloudWatch]
```

## Request Flow

```
Client
 │
 ▼
CloudFront
 │
AWS WAF
 │
API Gateway
 │
Authentication
 │
Rate Limiter (Redis)
 │
 ┌──────────────┐
 │ Allowed? │
 └──────┬───────┘
 │Yes
 ▼
 Load Balancer
 │
 ECS / EKS Services
 │
Aurora / DynamoDB
 │
 EventBridge
 │
 SNS → SQS
```

### AWS Services Used

- CloudFront
- AWS WAF
- API Gateway
- Amazon Cognito
- ElastiCache (Redis)
- Application Load Balancer
- ECS / EKS
- Aurora
- DynamoDB
- EventBridge
- SNS
- SQS
- CloudWatch

**Interview explanation (30 seconds):**
1. Client requests go through **CloudFront** and **AWS WAF** for caching and protection.
2. **API Gateway** authenticates the request using **Cognito/JWT**.
3. A **distributed rate limiter** checks request counts in **Redis**.
4. If the limit is exceeded, the client receives **HTTP 429**.
5. Valid requests are routed through the **ALB** to **ECS/EKS microservices**.
6. Services store data in **Aurora/DynamoDB**, publish events to **EventBridge**, and send asynchronous notifications using **SNS + SQS**.
7. **CloudWatch** monitors logs, metrics, and alarms.

## 1. Fundamentals

### What is an API Gateway, and why does the rate limiter belong inside it architecturally?
An **API Gateway** is a single, centralized entry point sitting in front of a system's backend services, handling cross-cutting concerns (authentication, rate limiting, request routing, response transformation, observability) **once**, centrally, rather than requiring every individual backend service to reimplement them independently. The rate limiter belongs architecturally inside (or immediately adjacent to) the gateway specifically because §Advanced Q4's "short-circuit before expensive work" principle demands rejecting over-limit requests **before** they consume any backend capacity at all — placing rate limiting deep inside a backend service, after routing/authentication/business-logic have already run, defeats this cost-avoidance purpose entirely.

### Why does this matter?
Because this module is the direct, full-system synthesis of content spread across (the original distributed rate limiter introduced in the very first async-await module), (REST API rate-limiting algorithms and OWASP-adjacent security concerns), and (Redis as the shared, atomic-operation-capable backing store) — recognizing that these three earlier modules' content **is** this system-design problem, not separate, unrelated material, is exactly the kind of cross-module synthesis a Staff/Principal system-design interview specifically rewards.

### When does this matter?
Any system with multiple backend services needing consistent, centrally-enforced cross-cutting policies (rate limiting, authentication, routing); the depth matters for correctly designing the gateway itself as a highly-available, low-latency-overhead component (since **every single request** passes through it, making the gateway's own performance/availability a multiplier on the entire system's), not merely as a thin, assumed-infallible proxy.

### How does it work (30,000-ft view)?
```
Client -> API Gateway [TLS termination, auth, rate limit, routing] -> Backend Service A / B / C
 |
 v
 Redis (shared rate-limit state)
```

---

## 2. Deep Dive

### 2.1 The Gateway as a System, Not a Single Box — Its Own Scaling and Availability Requirements
Because **every** request to the entire system passes through the gateway, it must itself be horizontally scaled (a fleet of gateway instances behind a load balancer) and highly available (a gateway outage is a **total system outage**, regardless of how healthy the backend services behind it are) — this is precisely why the gateway's own rate-limiting state cannot be held in-process (the exact "per-replica in-memory limiting is trivially bypassable across a fleet" concern) and must use Redis (or an equivalent shared store) for genuinely fleet-wide-consistent enforcement.

### 2.2 Rate-Limiting Algorithm Choice, Revisited at Full-System Scale
The algorithm choices (fixed window, sliding window, token bucket, leaky bucket) apply directly here, but at gateway scale, the **atomicity and latency cost of the shared-state check** (the Lua-script-based atomic token bucket) becomes a first-class system-design concern in its own right: every single request now pays this Redis round-trip cost, meaning the rate limiter's own latency contribution to the overall latency budget must be explicitly minimized — a poorly-optimized rate-limiter check (e.g., multiple sequential Redis round-trips instead of one atomic Lua script) directly multiplies latency across literally every request the entire system serves.

### 2.3 Multi-Tier Rate Limiting — Global, Per-Tenant, Per-User, Per-Endpoint, Simultaneously
A production-grade gateway typically enforces **multiple, simultaneous** rate-limit tiers: a global limit (protecting the overall system from aggregate overload), a per-tenant/per-API-key limit (a business/contractual limit, directly §Advanced Q1's contractual-limit design), a per-user limit (preventing one abusive user within a tenant from consuming the tenant's entire allotment), and a per-endpoint limit (some endpoints being far more expensive than others, warranting a stricter individual limit regardless of the caller's overall quota) — each tier requires its **own** Redis key/counter, and a request must pass **all applicable tiers'** checks to proceed, directly the same "AND across independent requirements" logic the authorization-policy evaluation established, now applied to rate-limit tiers instead of authorization requirements.

### 2.4 Routing and Service Discovery — the Gateway's Second Core Responsibility
Beyond rate limiting, the gateway routes incoming requests to the correct backend service based on path/header matching (the Layer-7 routing concept, now at the system's outermost edge rather than within one application's own middleware pipeline) — this requires a **service discovery** mechanism (a registry of currently-healthy backend service instances and their locations, updated as instances scale up/down or fail health checks, the health-check discipline) so the gateway always routes to a genuinely available backend, not a stale or unhealthy one.

### 2.5 The Gateway as a Single Point of Failure — and How to Avoid It Actually Being One
Despite being architecturally "the one entry point," a well-designed gateway is **not** a single point of failure in the availability sense — it's a horizontally-scaled **fleet** behind a load balancer, with no individual gateway instance being uniquely necessary; the actual single-point-of-failure risk shifts to the **shared dependencies** the entire gateway fleet relies on (the Redis cluster backing rate-limit state, the service-discovery registry) — meaning those shared dependencies' own availability design (Redis Sentinel/Cluster HA,/) becomes the actual critical-path availability concern for the whole system, not the gateway "box" itself.

## 3. Visual Architecture
```mermaid
graph TB
 Client --> LB[Load Balancer]
 LB --> GW1[Gateway Instance 1]
 LB --> GW2[Gateway Instance 2]
 LB --> GW3[Gateway Instance N]
 GW1 --> RedisCluster[("Redis Cluster<br/>(rate-limit state, Cluster)")]
 GW2 --> RedisCluster
 GW1 --> ServiceDiscovery["Service Discovery<br/>(healthy backend registry)"]
 GW1 -->|"passed ALL rate-limit tiers"| BackendA[Backend Service A]
 GW1 -->|"passed ALL rate-limit tiers"| BackendB[Backend Service B]
 GW1 -.->|"429 + Retry-After"| RejectedClient["Rejected request<br/>(never reaches backend)"]
```

## 4. Production Example
**Scenario**: A platform's API gateway enforced per-tenant rate limits correctly, but during a major, unexpected traffic spike (a viral marketing event driving a huge surge of legitimate, well-behaved traffic from many different tenants simultaneously, each individually well within their own per-tenant limit), the **aggregate** request volume across all tenants combined overwhelmed the backend services' actual capacity — no individual tenant was "at fault" or exceeding their own limit, but the sum of many tenants' legitimate, within-limit traffic exceeded what the backend fleet could handle, causing widespread latency degradation and errors across the entire platform, affecting even tenants who were sending very little traffic themselves. **Investigation**: confirmed via gateway logs that per-tenant rate limits were all correctly enforced and none were being exceeded — the gap was the **absence of a global, aggregate rate-limit tier** that would have proactively shed excess load (via 429s to some requests) once total system-wide load approached backend capacity, regardless of how that load was distributed across individual tenants. **Fix**: added a global rate-limit tier (checked in addition to, not instead of, the existing per-tenant tiers) sized to the backend fleet's actual measured capacity, with a graceful-degradation policy (§Advanced Q6) shedding load proportionally across tenants once the global limit is approached, rather than allowing unconstrained aggregate growth to overwhelm the backend regardless of per-tenant compliance. **Lesson**: multi-tier rate limiting isn't merely a "more thorough" version of single-tier limiting — the global tier specifically protects against a failure mode (aggregate overload from many individually-compliant sources) that no combination of per-tenant/per-user limits alone can prevent, directly demonstrating why "AND across all applicable tiers" must genuinely include a global tier, not just business-relevant per-tenant/per-user tiers, for the gateway to actually protect the backend's real, finite capacity.

## 5. Best Practices
- Implement rate limiting as an atomic, single-round-trip operation (a Lua script) to minimize its latency contribution to every request the gateway processes.
- Enforce multiple simultaneous rate-limit tiers (global, per-tenant, per-user, per-endpoint) — never rely on per-tenant/per-user limits alone to protect against aggregate overload (the incident).
- Scale the gateway itself as a stateless, horizontally-scaled fleet, with all shared state (rate limits, service discovery) externalized to Redis/a dedicated registry.
- Design the gateway's shared dependencies (Redis, service discovery) with the same HA rigor as the gateway fleet itself, since they're the actual availability-critical-path components.

## 6. Anti-patterns
- Relying solely on per-tenant/per-user rate limits without a global, aggregate tier, leaving the system vulnerable to legitimate-but-uncoordinated aggregate overload (the incident).
- Implementing rate-limit checks via multiple sequential Redis round-trips instead of one atomic Lua script, multiplying unnecessary latency across every request.
- Treating the gateway as a single, non-scaled instance, making it a genuine availability bottleneck for the entire system.
- Placing rate-limiting logic deep inside individual backend services rather than centrally at the gateway, both duplicating logic across services and failing to reject over-limit requests before they consume backend capacity.

---

## 10. Interview Questions

### Basic (10)
1. **Q: What is an API Gateway?** **A:** A single, centralized entry point handling cross-cutting concerns (auth, rate limiting, routing) for a system's backend services.
2. **Q: Why does rate limiting belong at the gateway rather than inside individual backend services?** **A:** To reject over-limit requests before they consume any backend capacity, and to enforce the policy once, centrally, rather than duplicating it across every service.
3. **Q: Why can't the gateway's rate-limit state be held in-process per instance?** **A:** Each instance would only see its own slice of traffic, allowing the effective limit to multiply by the number of gateway instances — genuine fleet-wide enforcement requires shared state (Redis).
4. **Q: What are the typical simultaneous rate-limit tiers a gateway enforces?** **A:** Global, per-tenant, per-user, and per-endpoint.
5. **Q: What does service discovery provide to the gateway?** **A:** A registry of currently-healthy backend service instances and their locations, for correct request routing.
6. **Q: Is the gateway a single point of failure?** **A:** Not if correctly designed as a horizontally-scaled, stateless fleet — the actual availability-critical components are its shared dependencies (Redis, service discovery).
7. **Q: Why is minimizing the rate-limit check's latency especially important at the gateway tier?** **A:** Every single request passes through the gateway, so even a small per-request overhead is multiplied across 100% of the system's traffic.
8. **Q: Where should TLS typically be terminated in a gateway architecture?** **A:** At the gateway, centralizing the CPU cost of TLS handshake/decryption at one tier.
9. **Q: What's a global rate-limit tier for, distinct from per-tenant limits?** **A:** Protecting against aggregate overload from many individually-compliant tenants/users combined, which no per-tenant limit alone can prevent.
10. **Q: What HTTP status code and header should a rate-limited request receive?** **A:** 429 Too Many Requests, with a `Retry-After` header.

### Intermediate (10)
1. **Q: Why must a request pass all applicable rate-limit tiers, not just one, to proceed?** **A:** Each tier protects against a different failure mode (one abusive user within a tenant, one tenant exceeding its contractual limit, aggregate system overload) — passing only one tier's check wouldn't protect against the failure modes the other tiers specifically address.
2. **Q: Why does an atomic Lua script matter more at the gateway tier than it might elsewhere?** **A:** The gateway processes the system's entire request volume — any inefficiency (e.g., multiple sequential Redis round-trips instead of one atomic script) is multiplied across every single request, making this optimization disproportionately high-leverage compared to optimizing a less-frequently-exercised code path.
3. **Q: Why did the incident occur despite every individual tenant correctly staying within their own rate limit?** **A:** No global, aggregate tier existed to catch the case where many individually-compliant tenants' combined traffic exceeded backend capacity — per-tenant compliance says nothing about the system-wide aggregate load those compliant tenants collectively generate.
4. **Q: Why should backend services not blindly trust an unauthenticated internal header claiming a request was already authenticated at the gateway?** **A:** A compromised or misconfigured internal network could allow a malicious actor to directly reach a backend service and spoof such a header, bypassing the gateway's authentication entirely — a genuinely secure mechanism (a signed assertion) is needed instead of implicit trust.
5. **Q: Why is the Redis cluster backing the gateway's rate-limit state potentially the single highest-throughput component in the entire system?** **A:** Every request passing through the gateway triggers at least one rate-limit check against Redis — the Redis cluster's request volume is therefore equal to (or a small multiple of, accounting for multiple tiers) the system's total aggregate request rate.
6. **Q: Why might a globally-distributed system use regional gateway deployments rather than one centralized global gateway?** **A:** Routing every request through one, potentially-distant, centralized gateway adds unnecessary latency for geographically-distant users — regional gateways (each with regional Redis backing) keep the gateway hop close to the client, at the cost of needing a strategy for genuinely global (not just regional) rate limits if those are required.
7. **Q: Why doesn't an excellent gateway architecture alone guarantee a scalable overall system?** **A:** The gateway protects backend services from being overwhelmed, but the backend services themselves must still be independently, adequately scaled (the full scaling ladder) — the gateway is a protective/routing layer, not a substitute for backend capacity planning.
8. **Q: Why is caching cacheable GET responses at the gateway tier valuable beyond what a CDN alone provides?** **A:** A CDN typically focuses on static/semi-static assets; gateway-tier caching can serve dynamic-but-cacheable API responses (e.g., a frequently-requested, infrequently-changing resource) without the request reaching any backend service at all, extending the same latency/load benefit to a broader class of content.
9. **Q: Why is DDoS resilience described as requiring more than just application-level rate limiting alone?** **A:** A sufficiently large-scale volumetric attack can overwhelm network/connection capacity before an application-aware rate limiter (which must first accept and process a connection/request to evaluate it) even gets a chance to reject it — genuine DDoS resilience typically requires infrastructure-level protection beneath the application layer.
10. **Q: Why is service discovery necessary in addition to a simple load balancer for gateway-to-backend routing?** **A:** The gateway needs to route to the *correct* backend service (among potentially many different services) based on the request's path/content, and needs awareness of which specific instances of that service are currently healthy — a distinct concern from a load balancer's typically simpler "distribute traffic across replicas of one service" function.

### Advanced (10)
1. **Q: Diagnose the aggregate-overload production incident from first principles, and design the specific capacity-planning process that should have caught this gap before it caused an incident.**
 **A:** Root cause: rate-limiting design that enumerated business-relevant tiers (per-tenant, contractually meaningful) without separately asking "what is the actual, measured capacity of our backend fleet, and do we have a tier protecting against exceeding *that*, independent of how traffic is distributed across tenants?" — these are two different questions requiring two different tiers. Safeguard: require any rate-limiting design to explicitly document both the business-driven tiers (per-tenant contracts) **and** a capacity-driven global tier sized to the backend's actual measured throughput ceiling (from load testing, §Advanced Q7's discipline), with the global tier's absence requiring explicit, documented justification (e.g., "backend capacity is provably always well above any plausible aggregate demand") rather than being silently omitted by default.
2. **Q: Design the specific Lua script and Redis data structure for checking all four rate-limit tiers (global, per-tenant, per-user, per-endpoint) in a single atomic operation, minimizing round-trips.**
 **A:**
 ```lua
 -- KEYS[1..4] = global, tenant, user, endpoint bucket keys; ARGV = capacity/refill params per tier
 local function checkAndConsume(key, capacity, refillRate, now)
 local bucket = redis.call("HMGET", key, "tokens", "lastRefill")
 local tokens = tonumber(bucket[1]) or capacity
 local lastRefill = tonumber(bucket[2]) or now
 tokens = math.min(capacity, tokens + (now - lastRefill) * refillRate)
 if tokens < 1 then return false end
 redis.call("HMSET", key, "tokens", tokens - 1, "lastRefill", now)
 return true
 end

 local now = tonumber(ARGV[1])
 -- Check tiers in order from CHEAPEST-to-fail to most-expensive-to-fail is a common optimization,
 -- but correctness requires ALL must pass -- if any fails, reject without consuming tokens from
 -- tiers already checked (requires either a two-phase check-then-commit, or accepting the tokens
 -- already consumed for passed tiers as a deliberate, small, acceptable inefficiency).
 if not checkAndConsume(KEYS[1], tonumber(ARGV[2]), tonumber(ARGV[3]), now) then return 0 end -- global
 if not checkAndConsume(KEYS[2], tonumber(ARGV[4]), tonumber(ARGV[5]), now) then return 0 end -- tenant
 if not checkAndConsume(KEYS[3], tonumber(ARGV[6]), tonumber(ARGV[7]), now) then return 0 end -- user
 if not checkAndConsume(KEYS[4], tonumber(ARGV[8]), tonumber(ARGV[9]), now) then return 0 end -- endpoint
 return 1
 ```
 Running all four checks within **one** `EVAL` call means the entire multi-tier decision is made in a single Redis round-trip, directly addressing the latency-multiplication concern — the noted trade-off (consuming tokens from earlier-checked tiers even if a later tier ultimately rejects the request) is a deliberate, small, generally-acceptable inefficiency versus the complexity of a true multi-phase check-then-commit-only-if-all-pass protocol.
3. **Q: Explain how you would design the gateway-to-backend trust mechanism (Intermediate Q4) concretely, using a signed internal assertion.**
 **A:** The gateway, having already authenticated the original caller, generates a short-lived, internally-signed token (e.g., a JWT signed with a key only the gateway and backend services share/trust, distinct from any externally-issued token) asserting the verified caller identity/claims, attached as an internal header on the request forwarded to the backend — the backend service verifies this internal signature before trusting the claimed identity, exactly preventing the header-spoofing risk Intermediate Q4 raises, since a request reaching the backend directly (bypassing the gateway) would lack a validly-signed internal assertion and should be rejected by the backend's own verification check as a defense-in-depth measure, not relying solely on network-level "only the gateway can reach backend services" isolation (which is a valuable but not sole line of defense).
4. **Q: Design a strategy for gracefully degrading the global rate-limit tier's threshold dynamically based on real-time backend health signals, rather than a fixed, static limit.**
 **A:** Feed backend health-check/capacity signals (the health-check discipline — e.g., aggregate backend CPU/connection-pool utilization, or simply the backend's own p99 latency trending upward) into a control loop that dynamically adjusts the global tier's token-bucket refill rate downward as backend stress increases and back upward as it recovers — directly §Advanced Q5's adaptive-rate-limiting concept, now specifically applied at the gateway's global tier to proactively shed load in response to *actual observed* backend stress rather than only a fixed, worst-case-provisioned static threshold, trading a more complex control system for more efficient utilization of backend capacity under normal, non-stressed conditions.
5. **Q: Explain how you would test the multi-tier rate limiter's correctness under the specific failure mode (many individually-compliant sources aggregating to overload), before deploying to production.**
 **A:** A load test specifically simulating **many distinct, individually-within-limit tenant/user identities** generating traffic simultaneously (not a single load-generating identity, which would only ever test the per-tenant/per-user tiers, never the aggregate/global tier) — asserting that once aggregate load approaches the configured global-tier threshold, the system begins shedding load (429s) proportionally, protecting backend latency/error rates, rather than allowing unconstrained aggregate growth — directly designed to reproduce and verify the fix for exactly the incident class before it can recur, the same "test the specific failure mode that caused the incident, not just the general feature" discipline recurring throughout this course.
6. **Q: How would you reason about whether the API Gateway should also handle response transformation/aggregation (e.g., calling multiple backend services and combining their results into one response for the client) versus keeping it purely a routing/policy-enforcement layer?**
 **A:** This is the **Backend-for-Frontend (BFF)** pattern question — a gateway handling response aggregation takes on additional responsibility beyond pure cross-cutting-concern enforcement, becoming more like the Facade pattern for the entire backend estate; the trade-off is centralizing aggregation logic conveniently for clients versus growing the gateway's own complexity/blast-radius (a bug in aggregation logic now affects the single, most-critical-path component in the system) — many architectures deliberately keep the core gateway (auth, rate limiting, routing) separate from a distinct BFF layer (aggregation, client-specific response shaping) specifically to keep the highest-availability-criticality component (the gateway) as simple and low-risk as possible, pushing more complex, service-specific logic to a separate tier.
7. **Q: Explain a scenario where the gateway's own rate-limiting logic itself needs to be rate-limited or circuit-broken, and why this isn't a contradictory or unnecessary precaution.**
 **A:** If the Redis cluster backing rate-limit state becomes slow/degraded (not fully unavailable, which would trigger the fail-open/fail-closed decision §Advanced Q8, but simply high-latency), every gateway instance's rate-limit check could itself become a bottleneck, adding significant latency to every request — a circuit breaker around the rate-limiter's own Redis calls (falling back to a simpler, local/degraded rate-limiting mode, or fail-open, once Redis latency exceeds a threshold) prevents the *protective mechanism itself* from becoming the system's primary availability/latency problem — a subtle but real "who watches the watchmen" consideration for any centrally-enforced protective mechanism.
8. **Q: A team proposes eliminating the API Gateway entirely, having each backend service handle its own authentication, rate limiting, and routing independently "for simplicity and to avoid a single point of failure." Evaluate this as a Principal Engineer.**
 **A:** Push back — eliminating the gateway doesn't eliminate the underlying cross-cutting concerns, it **duplicates** them across every backend service (each now needing its own auth/rate-limiting implementation, directly reintroducing the "every team reimplements the same hard-won lesson independently, sometimes incorrectly" risk this course has repeatedly flagged,/,/) — and the "avoid a single point of failure" framing misunderstands the point: a correctly-designed, horizontally-scaled gateway fleet is not a single point of failure at all, while the proposed alternative (many independent implementations) is arguably a *worse* reliability posture, since a security/rate-limiting bug fixed in the gateway once benefits every service immediately, whereas the same bug independently reimplemented in N services requires N separate fixes, each potentially discovered and remediated at different times.
9. **Q: Design a canary/gradual-rollout strategy for deploying a change to the gateway's rate-limiting logic, given that a bug here has system-wide, not service-specific, blast radius.**
 **A:** Given the gateway's uniquely high blast radius (Advanced Q8), deploy rate-limiter logic changes with an especially conservative canary strategy — route a small percentage of gateway instances (or, more granularly, a small percentage of traffic via a feature-flag-gated code path within the existing gateway fleet) to the new logic first, monitoring error rates/latency/throttling-rate metrics closely before progressively increasing the rollout percentage — directly the API-versioning-deprecation gradual-rollout discipline and §Advanced Q9's "climb the scaling/change ladder progressively" principle, now applied specifically to the component whose failure mode is uniquely system-wide rather than scoped to one service.
10. **Q: As a Principal Engineer, how would you structure an organization-wide "gateway feature request" process, given that every backend team will eventually want the gateway to handle some cross-cutting concern specific to their service?**
 **A:** Establish clear criteria for what belongs in the shared, central gateway (genuinely cross-cutting, applicable to many/most services — authentication, standard rate-limiting tiers, TLS termination) versus what belongs in a service-specific layer or the BFF tier (Advanced Q6) instead (business-logic-specific transformations, a single service's unusual authentication variant) — requiring any proposed gateway feature to demonstrate it's genuinely shared/cross-cutting, not a one-off need for a single team's convenience, since the gateway's uniquely high blast radius (Advanced Q8/Q9) makes it a poor place for narrow, single-service-specific logic that would otherwise unnecessarily grow the most critical, hardest-to-safely-change component in the entire system's complexity and risk surface.

---

## 11. Coding Exercises

*(System design case studies use worked design exercises, consistent with this domain's format.)*

### Easy — Capacity estimation for the gateway's Redis rate-limit backing store
**Problem**: Estimate Redis operations/sec needed if the gateway serves 50,000 requests/sec system-wide, with 4 rate-limit tiers checked per request via one atomic Lua script.
**Solution**:
```
Redis EVAL calls/sec: 50,000 (ONE atomic script call per request, regardless of tier COUNT within it,
 per the Advanced Q2 single-round-trip design)
Internal Redis operations within each EVAL (4 tiers * ~2 ops each): ~8 internal ops * 50,000/sec
 = 400,000 internal Redis ops/sec -- well within a well-provisioned
 Redis Cluster's capacity, but a number worth
 explicitly stating to justify the Cluster-sharding decision.
```

### Medium — Multi-tier rate-limit configuration schema
```csharp
public record RateLimitTier(string Name, int Capacity, double RefillRatePerSecond);

public class MultiTierRateLimitConfig
{
    public RateLimitTier Global { get; init; } = new("global", 50_000, 45_000 / 1.0); // the fix
    public Dictionary<string, RateLimitTier> PerTenant { get; init; } = new; // contractual limits
    public RateLimitTier PerUserDefault { get; init; } = new("user-default", 100, 100 / 60.0);
    public Dictionary<string, RateLimitTier> PerEndpoint { get; init; } = new; // e.g., stricter for /reports
}
```

### Hard — Circuit breaker around the rate limiter's own Redis dependency (Advanced Q7)
```csharp
public class ResilientRateLimiter
{
    private readonly IDistributedRateLimiter _redisLimiter;
    private readonly CircuitBreaker _circuitBreaker; // e.g., Polly's CircuitBreakerPolicy

    public async Task<bool> ShouldAllowAsync(string key)
    {
        try
        {
            return await _circuitBreaker.ExecuteAsync(=> _redisLimiter.CheckAsync(key));
        }
        catch (BrokenCircuitException)
        {
            // Redis is degraded/unavailable -- FAIL OPEN for this gateway, per the deliberate
            // documented choice §Advanced Q8 (most APIs prefer availability
            // over strict enforcement during a rate-limiter-infrastructure outage).
            _logger.LogWarning("Rate limiter circuit OPEN -- failing open for key {Key}", key);
            return true;
        }
    }
}
```

### Expert — Full gateway request pipeline synthesizing every tier and concern from this module
```csharp
public class GatewayPipeline
{
    public async Task<HttpResponseMessage> HandleAsync(HttpRequest request)
    {
        // 1. Reject malformed/oversized requests EARLIEST
        if (!IsValidRequestShape(request)) return Reject(400);

        // 2. Authenticate -- establishes caller identity for subsequent tiers
        var principal = await _authenticator.AuthenticateAsync(request);
        if (principal is null) return Reject(401);

        // 3. Multi-tier rate limiting, ALL must pass (Advanced Q2's single atomic check)
        string tenantId = principal.GetTenantId;
        bool allowed = await _rateLimiter.ShouldAllowAsync(
            globalKey: "global", tenantKey: $"tenant:{tenantId}",
                userKey: $"user:{principal.UserId}", endpointKey: $"endpoint:{request.Path}");
        if (!allowed) return Reject(429, retryAfter: "60");

        // 4. Route to the correct, healthy backend
        var backend = await _serviceDiscovery.ResolveHealthyInstanceAsync(request.Path);
        if (backend is null) return Reject(503);

        // 5. Attach signed internal trust assertion (Advanced Q3) and forward
        var internalToken = _internalTokenSigner.Sign(principal);
        return await _httpClient.ForwardAsync(backend, request, internalToken);
    }
}
```
**Discussion**: The explicit, numbered ordering here is itself the key design artifact — directly mirroring the middleware-ordering discipline (validation/rejection as early and cheap as possible, expensive operations gated behind cheaper checks) now expressed at the full-system-gateway level, synthesizing input validation, authentication, multi-tier rate limiting (this module's core topic), service discovery, and secure internal trust propagation (Advanced Q3) into one cohesive, correctly-sequenced pipeline.

---

## 12. System Design — Designing an API Gateway with Multi-Tier Rate Limiting

*Authored to the four-step standard (see Module 01 §12 for the method). For the limiter **algorithms** themselves — fixed/sliding window, token bucket, GCRA, and their distributed-correctness proofs — see Module 15; this section designs the **system** that runs them.*

---

### Step 1 — Understand the Problem and Establish Design Scope

#### The dialogue

> **C:** What is the gateway responsible for? "API gateway" covers everything from a reverse proxy to a full service mesh ingress.
> **I:** TLS termination, authentication, rate limiting, routing to backends, and request/response observability. No protocol translation, no response aggregation.
>
> **C:** Is this multi-tenant — do we have paying customers with contractual limits?
> **I:** Yes. Tenants have plan-based quotas that appear in a contract.
>
> **C:** So limits are a billing artefact, not just an abuse control. Do we need per-user limits inside a tenant too?
> **I:** Yes — one bad integration inside a tenant shouldn't consume the tenant's whole quota.
>
> **C:** And per-endpoint? Some endpoints are far more expensive than others.
> **I:** Yes.
>
> **C:** Scale?
> **I:** 50,000 requests/sec peak across roughly 5,000 tenants and 200 backend services.
>
> **C:** What latency budget does the gateway get? It's on every request, so its overhead multiplies.
> **I:** Under 5 ms at p99 for the gateway's own processing, excluding the backend call.
>
> **C:** When the rate-limit store is unavailable, do we fail open or fail closed?
> **I:** Good question — that's part of what I want you to design.
>
> **C:** Last one: are limits enforced globally across the fleet, or is approximate per-instance enforcement acceptable?
> **I:** Contractual limits must be fleet-accurate. Abuse limits can be approximate.

That last exchange is the hinge. **"Contractual" and "abuse" limits have different correctness requirements**, and recognising that lets you use a cheap approximate mechanism for the high-volume case and an exact one only where money is involved — which is what makes the 5 ms budget achievable.

#### Functional requirements

1. Terminate TLS; authenticate the caller (API key, JWT, or mTLS) and resolve tenant/user identity.
2. Enforce four simultaneous limit tiers: global, per-tenant, per-user, per-endpoint. A request must pass **all** applicable tiers.
3. Route to the correct backend using service discovery over healthy instances only.
4. Return `429` with `Retry-After` and `X-RateLimit-*` headers on rejection.
5. Emit per-request telemetry (latency, status, tenant, route) without adding meaningful latency.
6. Support runtime policy changes (a plan upgrade takes effect in seconds, not at next deploy).

#### Non-functional requirements

| Requirement | Target |
|---|---|
| Gateway added latency | p99 < 5 ms, p50 < 1 ms |
| Throughput | 50,000 req/s peak, headroom to 100,000 |
| Availability | **99.99%** — the gateway's availability is the ceiling on every backend's |
| Limit accuracy — contractual | Exact within a window; over-admission is a revenue leak, under-admission is a customer complaint |
| Limit accuracy — abuse | ±5% acceptable |
| Policy propagation | < 10 s from admin change to fleet-wide effect |
| Failure mode | Explicitly chosen per tier, not accidental |

#### Back-of-the-envelope estimation

The estimation here is about **latency budget**, not capacity — and that inversion is itself the insight.

```
Peak throughput            = 50,000 req/s
Gateway instances (4 vCPU, ~5,000 req/s each, TLS-heavy)
                           = 50,000 ÷ 5,000        = 10 instances
                           + N+2 redundancy + AZ spread ≈ 15 instances
```

Now the part that decides the design:

```
Latency budget                                       = 5 ms  (p99)
  TLS handshake (amortised over keep-alive)          ≈ 0.1 ms
  Auth: JWT verify (cached JWKS, no network)         ≈ 0.2 ms
  Routing + service discovery (in-memory table)      ≈ 0.05 ms
  Telemetry (async, off the hot path)                ≈ 0
  Remaining for rate limiting                        ≈ 4 ms

Redis round trip within an AZ                        ≈ 0.4–0.8 ms (p99 higher: ~2 ms)
Four tiers × one round trip each                     = 4 × 2 ms = 8 ms  ← BLOWS THE BUDGET
Four tiers in ONE Lua script                         = 1 × 2 ms = 2 ms  ← fits
```

State size:

```
Tenants 5,000 × endpoints 200 × window keys ~2   ≈ 2,000,000 keys
Per key ≈ 100 B                                  ≈ 200 MB   ← trivially fits in Redis
```

#### What the numbers tell us

1. **Capacity is a non-issue.** Fifteen instances. Anyone who spends the round designing gateway autoscaling has missed the problem.
2. **The design is entirely determined by the latency budget**, and specifically by the arithmetic above: the naive implementation — one Redis call per tier — is **four times over budget**, and the fix (one atomic script evaluating all tiers) is therefore not an optimisation but a requirement. This is the sentence the whole design turns on.
3. **200 MB of state means the limiter's data can live anywhere** — including replicated into each gateway's memory, which opens the door to the local-lease design in §3.2 that removes the Redis hop from the common path entirely.

The hard problem is **paying for fleet-accurate enforcement without paying a network round trip per tier per request** — plus the failure §4 exposes, that per-tenant limits are structurally blind to aggregate backend capacity.

---

### Step 2 — Propose High-Level Design and Get Buy-In

#### Two planes, and keeping them separate

- **Data plane** — the request path. Must be fast, must not block on anything it can avoid, and must degrade rather than fail.
- **Control plane** — policy definition, tenant plans, route configuration, discovery. Slow, transactional, and **never on the request path**. A control-plane outage must not stop traffic; it must only freeze policy changes.

Conflating these is the most common architectural error in gateway design, and stating the split up front is worth real credit.

#### Components

**Edge load balancer (L4 or cloud NLB).** Distributes to gateway instances. Deliberately dumb — the intelligence is one layer in.

**Gateway instances (data plane).** Stateless. Pipeline: TLS → auth → identity resolution → **rate limit** → route → proxy → telemetry.

**Limiter.** A local token-lease cache plus a Redis-backed authority (§3.2).

**Policy Store (control plane).** Tenant plans, per-endpoint costs, tier definitions. PostgreSQL, published to gateways via a watch/stream.

**Service Registry.** Healthy backend instances per route. Consul/Envoy xDS/cloud service discovery, cached in-memory on each gateway with a health-aware refresh.

**Redis Cluster.** The shared limiter state. Sharded by limit key so tiers spread across nodes.

**Telemetry pipeline.** Async, buffered, lossy-by-design — telemetry must never apply backpressure to the request path.

#### End-to-end walkthrough — one request

1. Client connects; edge LB routes to a gateway instance; TLS terminates (session resumption keeps the handshake amortised).
2. Gateway extracts credentials. JWT is verified against a **cached JWKS** — never a network call per request.
3. Identity resolves to `(tenant_id, user_id, plan_id)`, cached locally with a short TTL.
4. Route match on path/method produces `(service, endpoint_id, cost_weight)`. Endpoints have **weights**, so an expensive search endpoint consumes 10 tokens while a cheap lookup consumes 1 — a single mechanism that replaces a proliferation of per-endpoint limits.
5. **One limiter call evaluates all four tiers atomically** and returns allow/deny plus remaining quota per tier.
6. Denied → `429` with `Retry-After`, `X-RateLimit-Limit/Remaining/Reset`, and the **tier that rejected** named in the body. Telling the caller *which* limit they hit is what turns a support ticket into a self-service fix.
7. Allowed → select a healthy backend instance (least-request, from the in-memory registry), proxy with a per-route timeout and retry budget.
8. Response streams back; telemetry is emitted asynchronously.

#### API design

**The proxied request** carries no gateway-specific input, but the response contract matters:

| Header | Example | Notes |
|---|---|---|
| `X-RateLimit-Limit` | `1000` | The binding tier's limit |
| `X-RateLimit-Remaining` | `847` | |
| `X-RateLimit-Reset` | `1723200000` | Unix seconds |
| `Retry-After` | `12` | On `429` only; the single most useful header for well-behaved clients |
| `X-RateLimit-Scope` | `tenant` | Which tier bound — `global`\|`tenant`\|`user`\|`endpoint` |

**Control-plane API — `PUT /admin/v1/policies/{tenant_id}`**

| Field | Type | Description |
|---|---|---|
| `plan_id` | string | Named plan the tenant is on |
| `overrides` | object[] | `{ tier, scope_id, limit, window_seconds, burst }` |
| `enforcement` | enum | `ENFORCE` \| `SHADOW` — shadow mode counts and reports but never rejects |
| `effective_from` | RFC3339 | |

`SHADOW` is worth calling out unprompted: **you never turn on a new limit in enforce mode.** You run it in shadow, look at how many requests *would* have been rejected, and only then enforce. Every limit rollout that skipped this step is an incident.

**`GET /admin/v1/policies/{tenant_id}/usage`** — current consumption per tier, for support and for the customer's own dashboard.

#### Data model

**`plan`** (PostgreSQL) — `plan_id`, `name`, and per-tier defaults.

**`policy`** — `policy_id`, `tenant_id`, `tier`, `scope_id` (nullable — null means all), `limit`, `window_seconds`, `burst`, `enforcement`, `effective_from`, `version`.

**`endpoint`** — `endpoint_id`, `service`, `method`, `path_pattern`, `cost_weight`, `default_limit`.

**Redis key schema** — the part that is actually load-bearing:

```
rl:g:{window}                        global
rl:t:{tenant_id}:{window}            per-tenant
rl:u:{tenant_id}:{user_id}:{window}  per-user
rl:e:{tenant_id}:{endpoint_id}:{w}   per-endpoint
```

All four keys for a request are hashed to the **same Redis slot** using a hash tag on `tenant_id` — `rl:{...}` — so one Lua script can touch all of them atomically. Without co-location, a cluster-mode Redis rejects the multi-key script outright, and this is the detail that separates a design that works from one that only works on a single node.

#### Store selection, and why

| Store | Choice | Reason |
|---|---|---|
| Limiter state | **Redis Cluster** | Needs atomic read-modify-write with sub-ms latency and TTL semantics. Lua gives atomicity across the four tiers in one round trip — the requirement the estimation derived |
| Policy | **PostgreSQL** | Small, relational, transactional, audited. Read once and cached; never on the hot path |
| Discovery | **In-memory, fed by xDS/Consul** | A network call per request to a registry would blow the budget by itself |
| Telemetry | **Kafka → columnar store** | Async, high volume, analytical access |

The decision worth defending: **limiter state is not durable and should not be.** If Redis loses its state, the worst case is one window of over-admission. Choosing a durable store for it would trade the latency budget for a guarantee nobody needs — and §3.4 makes the failure behaviour explicit rather than accidental.

---

### Step 3 — Design Deep Dive

#### 3.1 All tiers in one atomic operation

```lua
-- KEYS: global, tenant, user, endpoint (co-located by hash tag)
-- ARGV: now_ms, cost, then {limit, window_ms, burst} per tier
for i = 1, 4 do
  local limit  = tonumber(ARGV[3 + (i-1)*3])
  if limit > 0 then
    local used = tonumber(redis.call('GET', KEYS[i]) or '0')
    if used + cost > limit then
      return {0, i, limit - used}      -- denied, and BY WHICH TIER
    end
  end
end
for i = 1, 4 do
  if tonumber(ARGV[3 + (i-1)*3]) > 0 then
    redis.call('INCRBY', KEYS[i], cost)
    redis.call('PEXPIRE', KEYS[i], tonumber(ARGV[4 + (i-1)*3]))
  end
end
return {1, 0, 0}
```

Two properties make this correct rather than merely fast. It is **check-all-then-commit-all**: a request that fails tier 3 must not have consumed tiers 1 and 2, or a heavily-rejected tenant would silently burn the global budget. And it returns **which tier denied**, which is what populates `X-RateLimit-Scope` and makes the system debuggable from the client side.

(The algorithm shown is a counter for brevity; Module 15 derives why a sliding-window-log or GCRA is preferable and what each costs.)

#### 3.2 Removing the round trip: local leases

Even 2 ms × 50,000 req/s is 100 CPU-seconds/s of waiting and a hard dependency on Redis for every request. The refinement is **batched leases**: a gateway instance atomically claims a block of tokens from Redis (say 100), spends them locally, and re-claims when low.

| | Per-request Redis | Local leases |
|---|---|---|
| Redis ops/s at 50k req/s | 50,000 | ~500 |
| Added p99 latency | ~2 ms | ~0.01 ms (amortised) |
| Accuracy | Exact | Over-admits by up to `lease_size × instances` at a window boundary |
| Redis outage behaviour | Every request affected | Requests continue until leases exhaust |

The over-admission is bounded and computable: 15 instances × 100 tokens = 1,500 requests worst case. For an abuse limit of 100,000/hour, that is 1.5% — inside the stated ±5%. For a **contractual** limit it may not be acceptable, which is exactly why the dialogue's last question mattered.

**Recommendation: leases for global/abuse tiers with lease size scaled to the limit; exact per-request evaluation for contractual tenant tiers.** Hybrid, justified by the requirement rather than uniform for tidiness. And the lease size must shrink as remaining quota shrinks — a tenant with 200 requests left must not have 15 instances each holding 100.

#### 3.3 The gap §4 exposed: nobody is limiting the *backend*

Every per-tenant limit can be satisfied while the sum across tenants destroys the backend. Per-tenant limiting is a **fairness and billing** mechanism; it is structurally incapable of protecting capacity, because it has no knowledge of capacity. The fix is a second, orthogonal control:

- **Concurrency limiting, not rate limiting, at the backend boundary.** Rate is the wrong unit — what saturates a backend is in-flight work. Cap in-flight requests per backend service and use an adaptive algorithm (AIMD or gradient, à la Netflix's concurrency-limits) that discovers the ceiling from observed latency rather than from a configured number that will be wrong within a quarter.
- **Load shedding by priority when the cap binds.** Shed in a stated order: free tier → batch/async endpoints → interactive reads → writes. Never shed uniformly; uniform shedding means your most valuable traffic fails at the same rate as your least.
- **Queue with a deadline, not an unbounded buffer.** A request that has already waited past its client's timeout should be dropped, not served — serving it burns capacity for a response nobody will read.

Naming this as *a different control with a different unit* rather than "tune the tenant limits down" is the Staff-level answer, and it is what §4's team actually lacked.

#### 3.4 Failure modes, chosen deliberately

| Failure | Naive behaviour | Designed behaviour |
|---|---|---|
| Redis unavailable | Every request errors, or every request passes | **Per tier**: abuse tiers fail *open* on local leases and last-known limits; contractual tiers fail *open* with a counted, alerted "unenforced" flag — because rejecting paying customers is worse than a brief over-admission. The count is what makes it a decision instead of a leak |
| Policy store unavailable | Gateway can't start / can't route | Gateway serves **last-known-good policy from local cache indefinitely**; only *changes* stall. Startup must be able to boot from cached policy, or a control-plane outage becomes a total outage on the next deploy |
| Service registry stale | Routes to dead instances | Health-check-driven passive eviction on connection failure, plus outlier detection; a route with zero healthy instances returns `503` fast rather than hanging |
| One backend slow | Threads/connections pile up, gateway degrades for *all* routes | **Per-route connection pools and concurrency caps** — bulkheads. Without them, one slow backend takes down the gateway and therefore every other backend |
| Gateway instance dies | Connections dropped | Stateless; LB removes it; clients retry. A non-event *because* nothing per-request lives in gateway memory |

The bulkhead row deserves emphasis: the most common real gateway outage is not the gateway failing but **one slow dependency consuming a shared resource pool**, which is Module 01 §3.4's cache-pool lesson at a different layer.

#### 3.5 Policy propagation without a hot-path lookup

Policy changes must take effect in under 10 seconds without the gateway reading Postgres per request. Mechanism: the control plane writes a versioned policy snapshot; gateways subscribe to a change stream (or long-poll a version endpoint); on change they fetch the delta and swap an immutable in-memory map. Swapping an immutable map means the request path never takes a lock, which matters at 50,000 req/s.

Two safeguards worth stating: **version every snapshot and expose the active version per instance**, so a partially-propagated fleet is visible rather than mysterious; and **validate before swap**, because a malformed policy that all 15 instances accept simultaneously is a fleet-wide outage delivered in under 10 seconds — the propagation speed you built is also the blast radius you built.

---

### Step 4 — Wrap-Up

**What we left out:** authentication protocol depth (Modules 40, 41); request/response transformation and API versioning; WebSocket and gRPC proxying, which break the request/response assumptions here; multi-region gateways and the question of whether limits are per-region or global (they cannot be both cheap and global); caching at the gateway; canary routing and traffic shifting; and WAF/bot management, which is an adjacent but genuinely different problem.

**What we would measure:** gateway added latency p50/p99 **as its own metric**, separated from backend time, because a blended number hides the gateway entirely; `429` rate by tier and tenant, with **shadow-mode counters** for unenforced policies; limiter store latency and error rate; lease over-admission estimate; per-route backend concurrency versus its adaptive cap; policy version distribution across the fleet; and — the one people forget — **the ratio of `429`s to `503`s**, because a healthy system rejects deliberately at the gateway rather than collapsing at the backend, and a rising `503`:`429` ratio means the limits are set above the capacity they are supposed to protect.

**Summary.** Fifteen stateless instances, four limit tiers evaluated in one atomic script, leases where approximation is acceptable and exact evaluation where money is involved, an orthogonal adaptive **concurrency** control at the backend boundary because rate limiting cannot see capacity, per-route bulkheads, and a control plane that is never on the request path. The estimation is what forces it: the naive four-round-trip design is four times over a 5 ms budget, and that single arithmetic result determines nearly every decision downstream.

---

### References

1. Alex Xu — *System Design Interview Vol. 1*, ch. 4 "Design a Rate Limiter".
2. Netflix — *Performance Under Load: Adaptive Concurrency Limits* (the AIMD/gradient approach in §3.3).
3. Stripe Engineering — *Scaling your API with rate limiters* (tiered limits and the load-shedder distinction).
4. Envoy Proxy docs — global rate limiting service, circuit breaking, outlier detection, and xDS for config propagation.
5. Redis docs — Lua scripting atomicity, cluster hash tags (the key co-location requirement in §2).
6. IETF draft — *RateLimit header fields for HTTP* (`RateLimit-Limit`/`Remaining`/`Reset`).
7. Google SRE Book, ch. 21 *Handling Overload* and ch. 22 *Addressing Cascading Failures* — the shedding and bulkhead arguments.
8. Kong / AWS API Gateway quota documentation — real-world tier semantics and their stated accuracy caveats.
9. Module 15 of this folder — the limiter algorithms themselves, including GCRA and distributed-correctness proofs.

---

## 13–17. LLD / Debugging / Decision / Case Study / Principal

*(This module predates the full 16-section template; its incident, worked exercises, and Advanced-tier Q&A collectively carry this content. §12 above was authored to the four-step standard on 2026-08-09.)*

## 18. Revision
**Key takeaways**: The API Gateway centralizes cross-cutting concerns (auth, rate limiting, routing) once, rather than duplicating them per backend service — its own latency/availability directly multiplies across the entire system's traffic, making it a uniquely high-leverage (and high-blast-radius) component. Multi-tier rate limiting (global, per-tenant, per-user, per-endpoint) must include a global, aggregate tier specifically to protect against many individually-compliant sources overwhelming backend capacity in aggregate — per-tenant/per-user limits alone cannot prevent this failure mode. The gateway itself is not a single point of failure when correctly horizontally-scaled and stateless; its shared dependencies (Redis, service discovery) are the actual availability-critical components requiring the most rigorous HA design. Every optimization/correctness decision at the gateway tier (atomic Lua-script rate checks, signed internal trust assertions, early request rejection) is amplified in importance by being multiplied across 100% of the system's traffic.

---

**Next**: This completes the `14-System-Design` domain (Modules 37–40), synthesizing content from across this entire course into four fully-worked, end-to-end system-design case studies. Continuing autonomously to `15-Low-Level-Design`.
