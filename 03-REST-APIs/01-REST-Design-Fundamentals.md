# Module 15 — REST APIs: Design Fundamentals, HTTP Semantics & Versioning

> Domain: REST APIs | Level: Beginner → Expert | Prerequisite: [[../02-DotNet-AspNetCore/03-MinimalAPIs-vs-Controllers-ModelBinding]] (DTOs, mass-assignment), [[../02-DotNet-AspNetCore/04-Authentication-Authorization-Deep-Dive]]

---

## 1. Fundamentals
**REST** (Representational State Transfer, Roy Fielding's 2000 dissertation) is an architectural style for networked systems built on: resources identified by URIs, a uniform interface (standard HTTP methods with well-defined semantics), statelessness (each request contains everything needed to process it — no server-side session dependency), and representations (JSON/XML) transferred between client and server. It exists because ad-hoc, RPC-style HTTP APIs (endpoints named like remote procedure calls — `/getUser`, `/updateUserStatus`) don't leverage HTTP's own built-in semantics (caching, idempotency, status codes), forcing every client to learn bespoke, inconsistent conventions per API. REST's uniform interface lets HTTP infrastructure (caches, proxies, load balancers) and generic client tooling work correctly without API-specific knowledge.

## 2. Deep Dive

### 2.1 HTTP Method Semantics — Precisely
- **GET**: safe (no side effects) and idempotent (repeating it produces the same result) — must never be used for state-changing operations; caches/proxies/prefetchers may call it speculatively, so a GET with side effects is a genuine correctness/security hazard.
- **POST**: neither safe nor idempotent by default — creates a new resource or triggers a non-idempotent action; calling it twice may create two resources.
- **PUT**: idempotent (calling it N times with the same body produces the same end state as calling it once) — a full **replacement** of the resource at the given URI.
- **PATCH**: partial update — idempotency is **not guaranteed** by the method itself and depends on the patch semantics used (a JSON Merge Patch replacing specific fields is typically idempotent; a JSON Patch `"op": "add"` to an array is not).
- **DELETE**: idempotent — deleting an already-deleted resource should return the same successful outcome (or a 404, per API convention), not an error indicating "delete failed."

### 2.2 Idempotency — the Precise Definition and Why It Matters for Reliability
Idempotency means **the same request, executed multiple times, produces the same end state as executing it once** — this is the single most important property for building **reliable retry logic** (Module 2's retry-with-backoff patterns) on top of an unreliable network: a client that times out waiting for a response to a PUT/DELETE genuinely doesn't know if the request succeeded — safely retrying requires the operation to be idempotent, or the retry could cause an unintended duplicate side effect. For genuinely non-idempotent operations that must tolerate retries (POST creating a payment), the standard solution is an explicit **idempotency key** (a client-generated unique ID sent in a header, e.g., `Idempotency-Key`) that the server persists and checks — a repeated request with the same key returns the original result without re-executing the side effect.

### 2.3 Status Code Semantics Beyond the Basics
- **200 vs 201 vs 204**: 200 (OK, has a body), 201 (Created, includes a `Location` header pointing to the new resource), 204 (No Content — success, deliberately no body, common for DELETE/PUT).
- **400 vs 422**: 400 (malformed request — can't even be parsed/understood), 422 (Unprocessable Entity — well-formed but semantically invalid, e.g., a business-rule validation failure) — a distinction many APIs blur, but a precise API design keeps them separate.
- **409 Conflict**: the request conflicts with the resource's current state (e.g., optimistic-concurrency version mismatch, §2.5) — distinct from 400/422, since the request itself is valid, just conflicting with concurrent state.

### 2.4 Versioning Strategies
- **URI versioning** (`/v1/orders`): simplest, most visible, but "pollutes" the URI (arguably violating REST's "URI identifies a resource, not a version of an API" purity) and requires duplicating route definitions.
- **Header versioning** (`Api-Version: 2` or `Accept: application/vnd.company.v2+json`): keeps URIs stable/pure, but less discoverable/debuggable (can't just paste a URL in a browser to see a specific version).
- **Query-string versioning** (`?api-version=2`): a middle ground, easy to test manually, but easy to omit accidentally (silently falling back to a default version).
No universal "correct" choice — the trade-off is discoverability/simplicity (URI) vs. REST purity/cache-friendliness (header) vs. ease-of-testing (query string); most large-scale APIs (Stripe, GitHub) use header-based versioning specifically for its cache-key cleanliness and REST-purity properties.

### 2.5 Optimistic Concurrency via ETags
`ETag` (a version/hash identifier for a resource's current state) combined with `If-Match`/`If-None-Match` conditional request headers implements optimistic concurrency control over HTTP itself: a client GETs a resource (receiving its `ETag`), later PUTs an update with `If-Match: <etag>` — the server rejects with `412 Precondition Failed` if the resource has changed since the client's GET, preventing a classic lost-update race (two clients concurrently reading, modifying, and blindly overwriting) without any application-level locking.

### 2.6 HATEOAS — Hypermedia as the Engine of Application State
The often-unimplemented "fourth constraint" — responses include **links** to related/next-available actions (`"actions": {"cancel": {"href": "/orders/123/cancel"}}`), letting clients navigate the API's state machine dynamically rather than hardcoding URL construction logic. Genuinely powerful for long-lived API consumers that must tolerate URL-structure evolution, but adds real payload/complexity overhead most REST APIs in practice skip entirely — a legitimate, common "level 2, not level 3, Richardson Maturity Model" pragmatic choice worth explicitly justifying rather than treating as an oversight.

## 3. Visual Architecture
```
GET /orders/123        -> 200 { ... }  (ETag: "abc123")
PUT /orders/123         -> 412 Precondition Failed (If-Match: "abc123" doesn't match current "xyz789")
POST /payments          -> 201 Created (Idempotency-Key: "client-generated-uuid")
POST /payments (retry, same Idempotency-Key) -> 201 Created (SAME result, no duplicate charge)
```

## 4. Production Example
**Scenario**: A payments API without idempotency-key support experienced duplicate charges during a mobile-network flakiness period — clients retrying a timed-out POST created genuine duplicate payment records, since POST is non-idempotent by HTTP semantics and no application-level deduplication existed. **Fix**: implemented `Idempotency-Key` header support — the server persists (key → result) mappings with a TTL, returning the cached original result for a repeated key instead of re-processing. **Lesson**: idempotency isn't automatic for POST — it must be deliberately engineered for any operation that must tolerate client retries, exactly Module 2's retry-safety discipline applied at the API-contract level.

## 5. Best Practices
- Use idempotency keys for any POST that triggers a real-world side effect a client might need to safely retry.
- Distinguish 400 (malformed) from 422 (semantically invalid) consistently.
- Use ETags/conditional requests for any resource subject to concurrent updates.
- Choose a versioning strategy deliberately and document the trade-off, rather than defaulting without consideration.

## 6. Anti-patterns
- RPC-style endpoints (`/getUserById`, `/doUpdateStatus`) instead of resource-oriented URIs with proper HTTP methods.
- Using GET for state-changing operations (breaks caching/prefetching assumptions, a genuine correctness hazard).
- Returning 200 for everything (including errors) with an in-body "success: false" flag instead of using HTTP status codes correctly.
- Treating PATCH as automatically idempotent without verifying the actual patch semantics used.

---

## 10. Interview Questions

### Basic (10)

1. **Q: What makes an HTTP method idempotent?**
   **A:** Repeating the same request multiple times produces the same end state as executing it once.

2. **Q: Is POST idempotent by default?**
   **A:** No — calling it twice can create two separate resources/side effects unless the application explicitly implements idempotency (e.g., via an idempotency key).

3. **Q: What's the difference between 201 Created and 204 No Content?**
   **A:** 201 indicates a resource was created and typically includes a `Location` header pointing to it, usually with a body; 204 indicates success with deliberately no response body.

4. **Q: What is an ETag?**
   **A:** An identifier representing a resource's current version/state, used with conditional requests (`If-Match`/`If-None-Match`) for caching and optimistic concurrency control.

5. **Q: What does HATEOAS stand for?**
   **A:** Hypermedia as the Engine of Application State — responses include links to related/available actions so clients can navigate dynamically instead of hardcoding URLs.

6. **Q: Name three API versioning strategies.**
   **A:** URI versioning (`/v1/orders`), header versioning (`Api-Version: 2`), and query-string versioning (`?api-version=2`).

7. **Q: What's the difference between 400 and 401?**
   **A:** 400 means the request is malformed/invalid; 401 means the caller isn't authenticated.

8. **Q: Should a GET request ever have side effects?**
   **A:** No — GET must be safe and idempotent; caches and prefetchers may call it speculatively.

9. **Q: What does "stateless" mean in the REST architectural style?**
   **A:** Each request contains everything needed to process it — the server holds no client-session state between requests.

10. **Q: What is a "resource" in REST terms?**
    **A:** Any named piece of information/entity a client can address via a URI (e.g., an order, a customer) and act on via standard HTTP methods.

### Intermediate (10)

1. **Q: Why isn't PATCH's idempotency guaranteed by the method itself?**
   **A:** It depends on the actual patch semantics used — a JSON Merge Patch replacing specific fields is typically idempotent, but a JSON Patch `"op": "add"` appending to an array is not, since repeating it adds another element each time.

2. **Q: How does `If-Match` prevent a lost-update race?**
   **A:** The client sends the ETag it last observed; the server rejects the update with 412 if the resource's current ETag doesn't match, meaning someone else modified it since the client last read it — preventing a blind overwrite.

3. **Q: Why is header-based versioning generally more cache-friendly than URI versioning?**
   **A:** The URI (the natural cache key for HTTP-level caches/CDNs) stays identical across versions; version-specific caching, if needed, can be layered on top of the `Vary` header instead of fragmenting cache keys by baked-in version paths.

4. **Q: What's the precise difference between 400 and 422?**
   **A:** 400 means the request couldn't even be parsed/understood (malformed syntax); 422 means the request is well-formed but semantically invalid (e.g., fails a business rule).

5. **Q: Why must idempotency keys be scoped per-client rather than globally?**
   **A:** A global key namespace would let one client guess or reuse another client's key to retrieve their cached result — scoping per authenticated principal prevents this cross-client leakage.

6. **Q: Why is DELETE considered idempotent even though deleting an already-deleted resource might seem like it "does nothing" the second time?**
   **A:** Idempotency is about end state, not identical response codes — the end state ("this resource no longer exists") is the same after one or many DELETE calls, even if the API conventionally returns 404 instead of 204 on a repeat call.

7. **Q: What's the risk of using sequential integer IDs in REST resource URIs?**
   **A:** It enables enumeration — an attacker can iterate through IDs to probe for resources, making authorization checks (not obscurity) the only real defense; using GUIDs doesn't fix missing authorization but does remove the trivial enumeration vector.

8. **Q: Why would an API choose query-string versioning over header versioning despite header versioning's cache advantages?**
   **A:** Query-string versions are trivially testable by pasting a URL into a browser or a simple `curl` command, valuable for developer experience/debuggability even at the cost of slightly less clean caching semantics.

9. **Q: What's the relationship between HATEOAS and the Richardson Maturity Model?**
   **A:** HATEOAS is level 3 (the highest) of the model; most production REST APIs stop at level 2 (proper resources + HTTP verbs, without hypermedia links) — a common, often deliberate, pragmatic trade-off rather than an incomplete implementation.

10. **Q: Why does conditional GET (`If-None-Match` → 304) reduce backend load, not just client bandwidth?**
    **A:** A 304 response can often be served entirely by an intermediary cache/CDN without the request ever reaching the origin server at all, and even when it does reach the origin, a 304 avoids re-serializing/re-transferring the full resource body.

### Advanced (10)

1. **Q: Design an idempotency-key implementation, including storage, TTL, and handling a duplicate request that arrives while the original is still in flight.**
   **A:** Persist a keyed record (client ID + idempotency key → status: `InProgress`/`Completed` + cached response) in a shared store (Redis, for fleet-wide consistency); on a new request, atomically check-and-set the key to `InProgress` if absent; if a duplicate arrives while still `InProgress`, return `409 Conflict` (not process it again, and not silently wait) since the original might still fail, making the "final" result ambiguous; once the original completes, update the record to `Completed` with the cached response, returned verbatim for any future duplicate within the TTL window.

2. **Q: Explain exactly why REST's statelessness constraint enables horizontal scaling at the architecture level.**
   **A:** Because no request depends on server-held session state from a prior request, any replica can handle any request without needing to know anything about which replica handled previous requests from the same client — this is what makes a simple round-robin load balancer sufficient, without sticky sessions or a shared state-synchronization mechanism, directly enabling elastic, uncoordinated horizontal scaling.

3. **Q: Design a versioning-deprecation strategy that communicates sunset dates to clients without abruptly breaking them.**
   **A:** Use the `Deprecation` response header (indicating a version is deprecated, with a date) and the `Sunset` header (the date it will actually stop being served), both attached to responses from the deprecated version starting well in advance; combine with proactive, automated monitoring of which clients are still calling the deprecated version (via API-key/version telemetry) to directly notify remaining consumers before the sunset date, rather than relying solely on passive header-based communication.

4. **Q: Diagnose and fix a lost-update race using ETags end-to-end.**
   **A:** Symptom: two users editing the same record concurrently, with the second save silently overwriting the first's changes with no error. Fix: the GET response includes an `ETag`; the client's subsequent PUT/PATCH sends `If-Match: <etag>`; the server compares it against the resource's current ETag before applying the update, returning `412 Precondition Failed` if they don't match — forcing the client to re-fetch the latest version and either re-apply or merge their change, rather than blindly overwriting.

5. **Q: Architect a fully idempotent payments API with correct concurrent-duplicate-request handling and outbox-pattern interaction.**
   **A:** A shared idempotency-key middleware (as in Advanced Q1) wraps every state-changing endpoint; the actual payment-processing logic and the idempotency-record update, plus the outbox-table insert for downstream event publication (a later module's Outbox pattern), all commit within a **single database transaction** — ensuring the payment, the idempotency record marking it complete, and the "PaymentProcessed" event-to-be-published are atomically consistent; a crash between charging and recording would otherwise either lose the idempotency guarantee or lose the event, and the single-transaction design eliminates that entire failure window.

6. **Q: Why is `409 Conflict` the correct response for a duplicate in-flight idempotency-key request rather than blocking/waiting for the original to finish?**
   **A:** Blocking would tie up the calling client's connection/thread for an unknown duration and couldn't guarantee the original will even succeed — returning 409 immediately gives the client clear, fast feedback ("this exact request is already being processed, don't retry blindly right now"), letting the client's own backoff/retry logic (Module 2) decide when to check back, rather than the server silently holding a connection open.

7. **Q: How would you design idempotency-key expiration (TTL) to balance storage cost against protection against delayed retries?**
   **A:** Choose a TTL comfortably longer than the client's expected retry window (e.g., 24 hours) but not indefinite — balancing the storage cost of retained records against the residual risk that a very late retry (after TTL expiry) would be treated as a brand-new request; document the TTL as part of the API contract so clients know the window within which retries are guaranteed safe.

8. **Q: Explain a scenario where blindly trusting a client-supplied idempotency key without additional validation creates a correctness bug.**
   **A:** If a client accidentally reuses the same idempotency key for two genuinely *different* logical requests (a client-side bug, not malice), the second request would incorrectly receive the first's cached result instead of being processed — mitigating this requires the server to also validate that the *request body* matches what was originally recorded for that key (returning an error, not silently serving a mismatched cached result, if the key matches but the payload differs).

9. **Q: How would you extend ETag-based optimistic concurrency to a bulk-update endpoint modifying multiple resources at once?**
   **A:** Require each item in the batch to carry its own ETag (or a version number) in the request payload, and process the batch transactionally with a per-item concurrency check — either failing the entire batch atomically on any single conflicting item (simpler, but a null single stale item blocks unrelated ones) or applying successful items and reporting per-item conflicts in a structured multi-status response (more complex, but more forgiving) — the choice is itself a deliberate API-design/business trade-off worth stating explicitly.

10. **Q: Design a strategy for safely rolling out a breaking API change using version headers without a hard cutover.**
    **A:** Introduce the new version as a new value for the version header while continuing to serve the old version unchanged for existing clients; run both concurrently for an extended overlap period; use the `Deprecation`/`Sunset` headers (Advanced Q3) plus proactive telemetry-driven outreach to migrate remaining clients; only remove the old version's code path once telemetry confirms zero remaining traffic, converting what could be a risky hard cutover into a monitored, gradual migration.

---

## 11. Coding Exercises

### Easy — Correct 201 with Location header
```csharp
app.MapPost("/orders", async (CreateOrderRequest request, IOrderService service) =>
{
    var order = await service.CreateAsync(request);
    return Results.Created($"/orders/{order.Id}", order); // Location header + 201, not a bare 200
});
```

### Medium — ETag generation and `If-Match` validation
```csharp
app.MapPut("/orders/{id}", async (string id, UpdateOrderRequest request, HttpRequest http, IOrderRepository repo) =>
{
    var order = await repo.GetByIdAsync(id);
    if (order is null) return Results.NotFound();

    var currentETag = $"\"{order.Version}\"";
    if (http.Headers.IfMatch.Count > 0 && http.Headers.IfMatch[0] != currentETag)
        return Results.StatusCode(StatusCodes.Status412PreconditionFailed);

    order.ApplyUpdate(request);
    order.Version++;
    await repo.SaveAsync(order);
    return Results.Ok(order);
});
```

### Hard — Idempotency-key middleware with concurrent-duplicate handling
```csharp
public class IdempotencyMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IDistributedCache _cache;

    public IdempotencyMiddleware(RequestDelegate next, IDistributedCache cache) { _next = next; _cache = cache; }

    public async Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Headers.TryGetValue("Idempotency-Key", out var key) || string.IsNullOrEmpty(key))
        {
            await _next(context);
            return;
        }

        string cacheKey = $"idem:{context.User.FindFirstValue(ClaimTypes.NameIdentifier)}:{key}";
        var existing = await _cache.GetStringAsync(cacheKey);

        if (existing == "InProgress")
        {
            context.Response.StatusCode = StatusCodes.Status409Conflict;
            return;
        }
        if (existing is not null)
        {
            context.Response.StatusCode = StatusCodes.Status200OK;
            await context.Response.WriteAsync(existing); // cached final response
            return;
        }

        await _cache.SetStringAsync(cacheKey, "InProgress", new DistributedCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5)
        });

        var originalBody = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;

        await _next(context);

        buffer.Seek(0, SeekOrigin.Begin);
        var responseText = await new StreamReader(buffer).ReadToEndAsync();
        await _cache.SetStringAsync(cacheKey, responseText, new DistributedCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(24)
        });

        buffer.Seek(0, SeekOrigin.Begin);
        await buffer.CopyToAsync(originalBody);
    }
}
```
**Discussion**: The response-body-buffering pattern here directly reuses the request-body-buffering technique from the Minimal-APIs-vs-Controllers module (`EnableBuffering`/position-reset), applied to the *response* side instead — swapping `context.Response.Body` temporarily, capturing the written content, then replaying it both into the cache and back to the real output stream.

### Expert — Combined optimistic-concurrency + idempotency-key payment flow
```csharp
app.MapPost("/payments", async (
    ProcessPaymentRequest request, HttpRequest http, IPaymentService service, IIdempotencyStore idemStore) =>
{
    if (!http.Headers.TryGetValue("Idempotency-Key", out var key))
        return Results.BadRequest("Idempotency-Key header is required.");

    var existing = await idemStore.TryGetAsync(key!, request); // validates body hash matches, per Advanced Q8
    if (existing is { Status: IdempotencyStatus.InProgress }) return Results.StatusCode(409);
    if (existing is { Status: IdempotencyStatus.Completed }) return Results.Ok(existing.CachedResult);
    if (existing is { Status: IdempotencyStatus.KeyReusedWithDifferentPayload })
        return Results.Conflict("Idempotency-Key was reused with a different request payload.");

    await idemStore.MarkInProgressAsync(key!, request);

    // Payment charge, idempotency-record completion, and outbox event insert -- ONE transaction (Advanced Q5).
    var result = await service.ProcessPaymentInSingleTransactionAsync(request, key!);
    return Results.Created($"/payments/{result.PaymentId}", result);
});
```
**Discussion**: `TryGetAsync` returning a `KeyReusedWithDifferentPayload` case is the concrete fix for Advanced Q8's bug scenario — comparing a hash of the incoming request body against what was originally recorded for that key, rejecting a mismatch explicitly rather than silently serving a wrong cached result.

---

## 12. System Design
A payments platform's idempotency middleware (Hard/Expert exercises) is the module's central production pattern — every non-idempotent, side-effect-triggering endpoint routes through it, with per-client-scoped keys and a short-TTL cache backed by Redis for fleet-wide consistency (Module 12 §9's distributed-cache reasoning applied here).

## 13. Low-Level Design
A shared `IIdempotencyStore` abstraction (used identically by the Expert exercise) centralizes key-validation, in-progress-tracking, and payload-hash-comparison logic once, reusable across every non-idempotent endpoint in a codebase, rather than each team re-implementing subtly different idempotency logic independently.

## 14. Production Debugging
The signature incident for this module: duplicate payment charges from unhandled POST retries during network flakiness (§4) — diagnosed by correlating duplicate charges with client-side retry logs showing a timeout on the original request followed by an identical retry with no idempotency key at all.

## 15. Architecture Decision
Header-based versioning is recommended as the default for new large-scale/long-lived public APIs (cache-key cleanliness, REST purity); URI versioning remains acceptable for simpler, smaller APIs prioritizing discoverability/manual testability over those concerns.

## 16. Enterprise Case Study
Stripe's and GitHub's publicly-documented API versioning approaches (both header/date-based) are directly citable, large-scale precedents for the header-versioning recommendation in §15 — both explicitly chose this specifically to avoid URI fragmentation across API versions at massive integration scale.

## 17. Principal Engineer Perspective
Treat idempotency-key support as a mandatory, non-negotiable requirement for any payment/order-creation endpoint from day one — retrofitting it after a duplicate-charge incident (§4) is far more disruptive (requiring careful backfill/reconciliation of already-affected records) than building it into the initial design.

## 18. Revision
**Key takeaways**: Idempotent = same request repeated → same end state (GET, PUT, DELETE; not POST by default). Idempotency keys make POST safely retryable. ETags + `If-Match` prevent lost updates. 400 = malformed, 422 = semantically invalid, 409 = conflicts with current state. Versioning strategy is a genuine trade-off, not a solved question.

---

**Next**: Continuing autonomously to Module 16 — API Security & Rate Limiting Patterns (throttling, API gateways, request signing).
