(function (r) {
registerTopic('03-rest-apis', {
related: ['02-dotnet-aspnetcore', '38-api-gateway', '41-oauth2-oidc-jwt-pkce'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['fundamentals'],
  code: r`~~~http
GET /accounts/42/transactions?from=2026-10-01 HTTP/1.1
Accept: application/json

HTTP/1.1 200 OK
Cache-Control: private, max-age=30
ETag: "tx-42-v918"
Content-Type: application/json

{ "items": [ { "id": "t-981", "amount": "12.50", "currency": "GBP" } ],
  "links": { "self": "/accounts/42/transactions?from=2026-10-01", "next": "/accounts/42/transactions?cursor=eyJpZCI6OTgxfQ" } }
~~~
Resources identified by URIs, a uniform interface (methods + status codes), stateless requests, cacheable responses, and links to next states.`,
  q: r`What is REST and what are its constraints?`,
  a: r`REST (Representational State Transfer, Fielding 2000) is an architectural style for networked systems, not a protocol. Its constraints:

- **Client-server** separation.
- **Stateless**: each request carries everything needed; no server-side session between requests.
- **Cacheable**: responses declare whether they may be cached.
- **Uniform interface**: resource identification by URI, manipulation through representations, self-descriptive messages, and hypermedia (HATEOAS).
- **Layered system**: proxies, gateways, CDNs can sit between client and server.
- **Code on demand** (optional).

Most "REST APIs" are really *resource-oriented HTTP APIs* (Richardson maturity level 2): resources plus HTTP verbs plus status codes, without hypermedia. Say so honestly; it shows you know the difference.`,
  pts: [r`Style, not a protocol`, r`Stateless and cacheable are the scaling constraints`, r`Most APIs stop at maturity level 2`],
  ex: r`{{GET /orders/42}} returns a JSON representation of order 42; the server stores no per-client conversation state, so any replica can answer.`,
  fu: [r`What does stateless mean for authentication?`, r`What is the Richardson maturity model?`],
  pit: [r`Calling any JSON-over-HTTP API "RESTful".`] },

{ id: 'q2', level: 'Basic', tags: ['http', 'methods'],
  code: r`~~~text
Method   Safe  Idempotent  Typical use
GET      yes   yes         read
HEAD     yes   yes         metadata / existence
OPTIONS  yes   yes         CORS preflight, capabilities
PUT      no    yes         full replace at a known URI
DELETE   no    yes         remove (second call: 404 or 204, state unchanged)
POST     no    no          create / commands  -> make it retry-safe with Idempotency-Key
PATCH    no    no*         partial update (*idempotent if JSON Merge Patch of absolute values)
~~~
~~~csharp
app.MapPut("/customers/{id:guid}", (Guid id, CustomerDto dto) => Results.NoContent());   // same request twice = same state
app.MapPost("/payments", (CreatePayment p) => Results.Created("/payments/p-1", null));   // needs idempotency for retries
~~~`,
  q: r`Explain HTTP methods and their safety and idempotency.`,
  a: r`| Method | Safe | Idempotent | Typical use |
|---|---|---|---|
| GET | yes | yes | Read a resource |
| HEAD | yes | yes | Headers only |
| OPTIONS | yes | yes | Capabilities, CORS preflight |
| PUT | no | yes | Replace a resource at a known URI |
| DELETE | no | yes | Remove |
| POST | no | **no** | Create / run an action |
| PATCH | no | not guaranteed | Partial update |

**Safe** = no state change expected. **Idempotent** = repeating the request has the same effect on the server as sending it once (the response may differ, e.g. DELETE then 404).

Idempotency drives retry behaviour: clients and proxies may retry idempotent requests automatically. POST needs an {{Idempotency-Key}} to be retry-safe.`,
  pts: [r`Safe vs idempotent are different`, r`PUT replaces, PATCH modifies`, r`POST is not retry-safe by default`],
  ex: r`Setting an order's shipping address with PUT can be retried freely; "charge the card" via POST cannot without a key.`,
  fu: [r`Is DELETE idempotent if the second call returns 404?`],
  pit: [r`Using GET for operations that change state.`] },

{ id: 'q3', level: 'Basic', tags: ['http', 'status'],
  code: r`~~~csharp
app.MapPost("/orders", async (CreateOrder cmd, OrderService svc, CancellationToken ct) =>
    await svc.CreateAsync(cmd, ct) switch
    {
        { IsSuccess: true } r => Results.Created("/orders/" + r.Id, r.Order),                  // 201 + Location
        { Error: "validation" } r => Results.ValidationProblem(r.Errors),                         // 400 with field errors
        { Error: "conflict" } => Results.Problem(statusCode: 409, title: "Order already exists"),
        { Error: "rule" } r => Results.Problem(statusCode: 422, title: r.Message),               // business rule violated
        _ => Results.Problem(statusCode: 500)
    });
// 401 = not authenticated, 403 = authenticated but not allowed, 404 also for "exists but not yours" (avoid enumeration)
// 429 + Retry-After for rate limits, 503 + Retry-After for planned unavailability
~~~`,
  q: r`Which HTTP status codes should an API use and when?`,
  a: r`- **200** OK; **201** Created (+ {{Location}}); **202** Accepted (async); **204** No Content.
- **301/302/304**: redirects and Not Modified (conditional GET).
- **400** malformed request; **401** unauthenticated; **403** authenticated but forbidden; **404** not found (also used to hide existence); **405** wrong method; **406/415** content negotiation; **409** conflict (state, duplicate, version); **410** gone; **412** precondition failed (ETag); **422** semantically invalid; **429** rate limited (+ {{Retry-After}}).
- **500** unexpected; **502/504** upstream failure/timeout; **503** unavailable (+ {{Retry-After}}).

Rules: 4xx = client can fix it, 5xx = server problem and retryable by policy. Never return 200 with an error body. Return an error body in a consistent shape (RFC 9457 problem details).`,
  pts: [r`401 vs 403`, r`409 vs 422`, r`202 for async work`, r`Never 200 with an error`],
  ex: r`{{POST /payments}} with a duplicate idempotency key and different body returns 422; an existing identical request returns the original 201 response.`,
  fu: [r`When do you return 404 instead of 403?`],
  pit: [r`Using 500 for validation errors.`] },

{ id: 'q4', level: 'Basic', tags: ['pagination'],
  code: r`~~~csharp
// Cursor (keyset) pagination: stable under inserts, O(page) cost
app.MapGet("/transactions", async (string? cursor, AppDb db, CancellationToken ct) =>
{
    var (afterTs, afterId) = Cursor.Decode(cursor);                         // opaque, signed
    var page = await db.Transactions
        .Where(t => afterTs == null || t.PostedAt < afterTs || (t.PostedAt == afterTs && t.Id < afterId))
        .OrderByDescending(t => t.PostedAt).ThenByDescending(t => t.Id)
        .Take(51).ToListAsync(ct);
    var hasMore = page.Count > 50; page = page.Take(50).ToList();
    return Results.Ok(new { items = page, next = hasMore ? Cursor.Encode(page[^1].PostedAt, page[^1].Id) : null });
});
// Offset: OFFSET 100000 LIMIT 50 scans and discards 100,000 rows and shifts when rows are inserted
~~~`,
  q: r`Offset versus cursor pagination: which and why?`,
  a: r`**Offset/limit** ({{?page=3&size=50}}): simple, supports jumping to a page and totals. Problems: cost grows with offset (the database scans and discards rows), and results shift when rows are inserted or deleted between requests (duplicates or skips).

**Cursor/keyset** ({{?after=<opaque>&limit=50}}): the cursor encodes the last seen sort key; the query is {{WHERE (created_at, id) > (@t, @id) ORDER BY created_at, id LIMIT 50}}. Stable under concurrent writes and constant cost with a proper index. Cannot jump to arbitrary pages.

Return a {{next}} cursor (opaque, signed or encoded), a hard maximum page size, and a deterministic total order with a unique tiebreaker. Use offset for small admin tables, cursors for feeds and large datasets.`,
  pts: [r`Offset cost grows, results drift`, r`Keyset needs a unique ordered key`, r`Opaque cursors, capped page size`],
  ex: r`An orders feed with 40 million rows moved to keyset paging and dropped page-1000 latency from seconds to milliseconds.`,
  fu: [r`How would you provide a total count cheaply?`],
  pit: [r`Sorting by a non-unique column without a tiebreaker.`] },

{ id: 'q5', level: 'Basic', tags: ['security'],
  code: r`~~~csharp
builder.Services.AddAuthentication().AddJwtBearer(o => { o.Authority = "https://login.example.com"; o.Audience = "orders-api"; });
builder.Services.AddAuthorization(o => o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
builder.Services.AddRateLimiter(o => o.AddFixedWindowLimiter("per-client", w => { w.PermitLimit = 100; w.Window = TimeSpan.FromMinutes(1); }));
app.UseHttpsRedirection(); app.UseHsts();
app.MapGet("/orders/{id}", async (Guid id, ClaimsPrincipal user, AppDb db) =>
    await db.Orders.SingleOrDefaultAsync(o => o.Id == id && o.CustomerId == user.CustomerId()) is { } o
        ? Results.Ok(o.ToDto()) : Results.NotFound())                       // object-level check, not just "logged in"
   .RequireRateLimiting("per-client");
~~~`,
  q: r`How do you secure a REST API at a basic level?`,
  a: r`- **TLS only**; HSTS; no secrets in URLs (they land in logs).
- **Authenticate** with OAuth2/OIDC bearer tokens (short-lived JWT or opaque tokens); API keys only identify an application, not a user.
- **Authorise** on the server per request: scopes plus object-level checks (is this *your* order?).
- **Validate input** (type, length, range, allow-list); parameterised queries.
- **Rate limit** and set payload size limits.
- **CORS** with explicit origins for browser clients.
- **Do not leak** internals in errors; log security events; no PII in logs.
- Keep dependencies patched; follow the **OWASP API Security Top 10** (BOLA, broken auth, excessive data exposure, mass assignment, security misconfiguration, SSRF).`,
  pts: [r`TLS, tokens, object-level authorisation`, r`Rate limit and size limit`, r`OWASP API Top 10`],
  ex: r`BOLA (broken object level authorization), where {{GET /invoices/123}} works for any logged-in user, is the most common API breach pattern.`,
  fu: [r`Why are API keys not user authentication?`],
  pit: [r`Only checking that a token exists, not whose data is requested.`] },

{ id: 'q6', level: 'Basic', tags: ['crud'],
  code: r`~~~http
PUT /customers/42            (full replacement: omitted fields are cleared)
{ "name": "Asha Rao", "email": "asha@example.com", "phone": null }

PATCH /customers/42          Content-Type: application/merge-patch+json   (RFC 7396)
{ "phone": "+44 20 7946 0000" }

PATCH /customers/42          Content-Type: application/json-patch+json    (RFC 6902)
[ { "op": "test", "path": "/version", "value": 7 }, { "op": "replace", "path": "/email", "value": "a@b.com" } ]

POST /customers/42/close     (command: not a field update; side effects, audit, rules)
~~~`,
  q: r`PUT versus PATCH versus POST for updates.`,
  a: r`- **PUT** replaces the whole resource with the supplied representation (idempotent). Missing fields are reset or rejected; clients must send the full state.
- **PATCH** applies a partial change. Formats: **JSON Merge Patch** (RFC 7396: send the fields to change; {{null}} deletes) or **JSON Patch** (RFC 6902: list of operations {{add/remove/replace}}). Not inherently idempotent (for example "increment").
- **POST** for creation under a collection, or for command-style operations that are not simple state replacement.

Use {{If-Match}}/ETag with both PUT and PATCH to avoid lost updates. Prefer small, intention-revealing commands ({{POST /orders/42/ship}}) over PATCH of a status field when business rules apply to the transition.`,
  pts: [r`PUT = full replace`, r`PATCH formats: merge vs JSON Patch`, r`ETag for concurrency`, r`Commands for business transitions`],
  ex: r`Updating a customer's phone number: PATCH with merge patch {{"phone": "+1555"}}.`,
  fu: [r`How do you distinguish "set to null" from "not provided" in a DTO?`],
  pit: [r`PATCH semantics implemented as PUT, wiping omitted fields.`] },

{ id: 'q7', level: 'Intermediate', tags: ['caching'],
  code: r`~~~csharp
app.MapGet("/products/{id}", async (int id, HttpContext http, ICatalog c) =>
{
    var p = await c.GetAsync(id);
    var etag = new EntityTagHeaderValue("\"" + p.Version + "\"");
    if (http.Request.GetTypedHeaders().IfNoneMatch.Any(t => t.Compare(etag, useStrongComparison: false)))
        return Results.StatusCode(304);                                          // client copy is current: no body
    http.Response.GetTypedHeaders().ETag = etag;
    http.Response.Headers.CacheControl = "public, max-age=60, stale-while-revalidate=120";
    return Results.Ok(p);
});
~~~`,
  q: r`How does HTTP caching and conditional requests work for APIs?`,
  a: r`The server sends {{Cache-Control: max-age=60}} plus a validator: {{ETag}} (opaque version) or {{Last-Modified}}. After expiry the client revalidates with {{If-None-Match: "abc"}}; if unchanged the server answers **304 Not Modified** with no body, saving bandwidth and compute.

Directives: {{public}} vs {{private}} (shared cache vs user only), {{no-store}} (never store), {{no-cache}} (store but always revalidate), {{stale-while-revalidate}}, {{s-maxage}} for CDNs. Use {{Vary: Accept-Encoding, Authorization}} correctly.

For writes, use **{{If-Match}}** for optimistic concurrency: a mismatch returns **412 Precondition Failed**. CDN-cache public read-mostly resources; do not cache per-user data in shared caches.`,
  pts: [r`ETag + 304 saves work`, r`no-cache is not no-store`, r`If-Match for lost-update prevention`, r`private vs public`],
  ex: r`A product catalogue endpoint with {{s-maxage=300}} and ETags served most traffic from the CDN.`,
  fu: [r`How would you generate an ETag cheaply?`],
  pit: [r`Serving one user's response to another through a shared cache.`] },

{ id: 'q8', level: 'Intermediate', tags: ['errors'],
  q: r`What does a good error model look like?`,
  a: r`Use **RFC 9457 Problem Details** ({{application/problem+json}}):

~~~json
{
  "type": "https://api.example.com/problems/insufficient-funds",
  "title": "Insufficient funds",
  "status": 422,
  "detail": "Account 123 has 10.00 available, 25.00 required.",
  "instance": "/payments/987",
  "traceId": "00-4bf92f35...",
  "errors": [{ "field": "amount", "code": "exceeds_balance" }]
}
~~~

Principles: a stable machine-readable {{type}}/code that clients branch on (never parse {{detail}}), human-readable message safe to display, field-level errors for validation, a {{traceId}} for support, consistent shape for every error including 404/405/500, and no internals or stack traces. Document the error catalogue in the OpenAPI spec.`,
  pts: [r`Problem Details standard`, r`Machine-readable codes`, r`Trace id`, r`Never leak internals`],
  ex: r`Clients switched on {{type}} to show a "top up" prompt for insufficient funds without string-matching messages.`,
  fu: [r`How do you localise error messages?`],
  pit: [r`Different error shapes per endpoint.`] },

{ id: 'q9', level: 'Intermediate', tags: ['versioning'],
  code: r`~~~http
GET /v1/orders/981                      URL versioning: explicit, cache-friendly
GET /orders/981   Api-Version: 2026-10-01   header/date versioning (Stripe-style)

HTTP/1.1 200 OK
Deprecation: @1767225600                RFC 9745
Sunset: Thu, 01 Jan 2027 00:00:00 GMT   RFC 8594
Link: </docs/migrate-v2>; rel="deprecation"
~~~
Additive changes (new optional fields, new endpoints) need no new version; removals, renames, type or semantic changes do.`,
  q: r`How do you version a REST API and manage breaking changes?`,
  a: r`**Prefer additive evolution**: add optional fields, new endpoints, new enum values (and tell clients to tolerate unknown values). Only version when breaking.

Versioning mechanisms:

| Style | Example | Notes |
|---|---|---|
| URI | {{/v2/orders}} | Visible, cache and gateway friendly, most common |
| Header | {{Api-Version: 2}} | Clean URLs, harder to test in a browser |
| Media type | {{Accept: application/vnd.x.v2+json}} | Pure but heavy |
| Date-based | {{Stripe-Version: 2024-06-20}} | Pin per client, evolve continuously |

Breaking: remove/rename a field, change type or meaning, tighten validation, change defaults or error codes. Publish a **deprecation policy** ({{Deprecation}}, {{Sunset}} headers, changelog), support at most two majors, track usage per version/client, and use **consumer-driven contract tests** to know who you would break.`,
  pts: [r`Additive first`, r`Tolerant readers`, r`Sunset policy`, r`Know your consumers`],
  ex: r`Telemetry showed one partner still on v1 at 0.5% of traffic; a dated sunset and direct outreach retired it.`,
  fu: [r`What is Postel's law and its limits?`],
  pit: [r`Adding a required request field in a minor version.`] },

{ id: 'q10', level: 'Intermediate', tags: ['idempotency'],
  code: r`~~~csharp
app.MapPost("/payments", async ([FromHeader(Name = "Idempotency-Key")] string key, CreatePayment req, AppDb db, CancellationToken ct) =>
{
    var hash = Hashing.Sha256(req);
    var existing = await db.IdempotencyRecords.FindAsync([key], ct);
    if (existing is not null)
        return existing.RequestHash != hash ? Results.Problem(statusCode: 422, title: "Idempotency-Key reused with a different body")
             : Results.Text(existing.ResponseBody, "application/json", statusCode: existing.StatusCode);   // replay
    await using var tx = await db.Database.BeginTransactionAsync(ct);
    var payment = Payment.Create(req);
    db.Payments.Add(payment);
    db.IdempotencyRecords.Add(new(key, hash, 201, JsonSerializer.Serialize(payment.ToDto())));      // unique PK on key
    await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);                                          // concurrent duplicate -> unique violation -> 409
    return Results.Created("/payments/" + payment.Id, payment.ToDto());
});
~~~`,
  q: r`How do you make POST requests safe to retry?`,
  a: r`Network timeouts leave the client not knowing whether the server acted. Make writes retry-safe with an **idempotency key**:

1. Client generates a UUID and sends {{Idempotency-Key}}.
2. Server atomically records {{(key, hash(request), state)}} with the business write (unique constraint on key).
3. Repeat with the same key and body returns the **original stored response** (same status and body); same key with a different body returns an error (422/409); a concurrent in-flight duplicate gets 409 or waits.
4. Keys expire after a window (e.g. 24 h).

Alternative designs: client-supplied resource ids with **PUT** (naturally idempotent), natural business keys with unique constraints, or optimistic concurrency. For asynchronous operations, return {{202}} plus a status URL.`,
  pts: [r`Key + request hash`, r`Atomic with the write`, r`Same key different body = error`, r`PUT with client id is idempotent`],
  ex: r`Stripe's API uses this model: retrying a charge with the same key never double-charges.`,
  fu: [r`Where do you store the keys at scale?`],
  pit: [r`Storing the key after performing the side effect, outside the transaction.`] },

{ id: 'q11', level: 'Intermediate', tags: ['async'],
  code: r`~~~http
POST /reports            -> 202 Accepted
Location: /operations/op-77
Retry-After: 5

GET /operations/op-77    -> 200 { "status": "running", "percent": 40 }
GET /operations/op-77    -> 303 See Other   Location: /reports/r-12      (when done)
~~~`,
  dia: r`sequenceDiagram
  participant C as Client
  participant API as API
  participant Q as Queue
  participant W as Worker
  C->>API: POST /reports
  API->>Q: enqueue job op-77
  API-->>C: 202 Location /operations/op-77
  W->>Q: take job
  C->>API: GET /operations/op-77
  API-->>C: 200 running
  W->>API: store result r-12, status done
  C->>API: GET /operations/op-77
  API-->>C: 303 Location /reports/r-12`,
  q: r`How do you expose long-running operations?`,
  a: r`Do not hold a connection open. Pattern:

1. {{POST /reports}} → **202 Accepted** with {{Location: /reports/jobs/77}} and optional {{Retry-After}}.
2. {{GET /reports/jobs/77}} → {{200}} with {{status: queued | running | succeeded | failed}}, progress, and on success a link to the result ({{303 See Other}} or a {{resultUrl}}).
3. Optional **webhook** callback or server push (SSE/WebSocket) for completion.
4. Support {{DELETE}} (cancel), idempotent creation, expiry of job records, and clear error reporting in the status resource.

This pairs with a worker and queue behind the API and survives client disconnects, deploys and timeouts.`,
  pts: [r`202 + status resource`, r`Webhook or push for completion`, r`Cancellation and expiry`],
  ex: r`A CSV export of 5 million rows is queued; the client polls every few seconds then downloads from a pre-signed URL.`,
  fu: [r`Polling vs webhooks vs SSE trade-offs?`],
  pit: [r`Increasing the HTTP timeout to 10 minutes.`] },

{ id: 'q12', level: 'Intermediate', tags: ['webhooks'],
  code: r`~~~csharp
// Signing outgoing webhooks: receivers verify HMAC and timestamp (replay protection)
var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
var sig = Convert.ToHexString(HMACSHA256.HashData(secret, Encoding.UTF8.GetBytes(ts + "." + body))).ToLowerInvariant();
request.Headers.Add("Webhook-Id", evt.Id);                 // receivers dedupe by id
request.Headers.Add("Webhook-Timestamp", ts);
request.Headers.Add("Webhook-Signature", "v1=" + sig);
// Retry schedule with backoff: 1m, 5m, 30m, 2h, 6h, 24h -> then disable endpoint and notify the owner
~~~`,
  dia: r`flowchart LR
  S[Service] -->|outbox| O[(Outbox)] --> D[Dispatcher]
  D -->|signed POST| R[Customer endpoint]
  D -->|failure| RQ[(Retry queue with backoff)] --> D
  RQ -->|max attempts| DLQ[(Dead letter + alert + replay UI)]`,
  q: r`Design a webhook delivery system. What can go wrong?`,
  a: r`Webhooks push events to customer endpoints. Design for an unreliable receiver:

- **At-least-once** delivery with an event id; receivers must dedupe.
- **Signature** ({{HMAC-SHA256}} over timestamp + body with a per-endpoint secret; reject old timestamps to stop replay).
- **Retries** with exponential backoff and jitter over hours/days; then disable the endpoint and notify the owner.
- **Timeouts** short (5-10 s); 2xx = success; respond fast and process asynchronously on the receiver.
- **Ordering is not guaranteed**: include sequence/version or have receivers fetch current state.
- **Observability**: delivery log and manual redelivery in a portal.
- **SSRF protection**: validate target URLs, block private ranges.
- **Rate and concurrency limits** per customer so one slow endpoint cannot starve the workers.`,
  pts: [r`At-least-once + event ids`, r`HMAC signatures with timestamp`, r`Backoff and auto-disable`, r`SSRF protection`],
  ex: r`A customer's endpoint was down for 6 hours; retries delivered everything afterwards and the receiver deduped by event id.`,
  fu: [r`Why include the timestamp in the signed payload?`],
  pit: [r`Delivering from the request path of the original operation.`] },

{ id: 'q13', level: 'Intermediate', tags: ['graphql', 'grpc'],
  code: r`~~~text
Same read in three styles
REST:    GET /customers/42/orders?limit=10&fields=id,total
GraphQL: query { customer(id: 42) { orders(first: 10) { id total } } }
gRPC:    rpc ListOrders(ListOrdersRequest) returns (ListOrdersResponse);   // binary, HTTP/2, codegen
~~~`,
  q: r`REST versus GraphQL versus gRPC: how do you choose?`,
  a: r`| | REST | GraphQL | gRPC |
|---|---|---|---|
| Fit | Public/partner APIs, resource CRUD | Many client types needing flexible shapes | Internal service-to-service, streaming |
| Payload | Fixed per endpoint | Client chooses fields | Protobuf, compact |
| Caching | Native HTTP caching | Harder (POST, per-field) | Not HTTP-cache friendly |
| Over/under-fetching | Common | Solved | Fixed by contract |
| Pitfalls | Chatty, versioning | N+1 resolvers, query cost, authorization per field | Browser support, debugging |
| Tooling | Mature | Good | Strong codegen |

Rule of thumb: **REST for external, gRPC for internal, GraphQL for a BFF/aggregation layer** serving diverse UIs. Whatever you choose, enforce query depth/cost limits (GraphQL), deadlines (gRPC), and rate limits.`,
  pts: [r`REST external, gRPC internal, GraphQL as BFF`, r`GraphQL needs cost limits and dataloaders`, r`Caching favours REST`],
  ex: r`A mobile team used GraphQL over several REST services to cut round trips on a dashboard screen from 9 to 1.`,
  fu: [r`How do you prevent expensive GraphQL queries?`],
  pit: [r`Adopting GraphQL for a simple CRUD API.`] },

{ id: 'q14', level: 'Intermediate', tags: ['hateoas'],
  q: r`What is HATEOAS and is it worth it?`,
  a: r`HATEOAS (hypermedia as the engine of application state) means responses contain **links to the next valid actions**, so clients discover transitions instead of hard-coding URLs.

~~~json
{ "id": 42, "status": "pending",
  "_links": { "self": {"href": "/orders/42"}, "cancel": {"href": "/orders/42/cancel", "method": "POST"}, "pay": {"href": "/orders/42/pay"} } }
~~~

Benefits: servers can change URIs, the available links encode business state (no "cancel" link once shipped), less duplicated client logic. Costs: larger payloads, extra design, few client libraries consume it, and most teams hard-code URLs anyway.

Pragmatic stance: include a few links where **workflow state drives UI** (pagination links, available actions); do not make it a religion. Know it to answer the maturity-model question.`,
  pts: [r`Links express available transitions`, r`Rarely fully adopted`, r`Pragmatic use for pagination/actions`],
  ex: r`Pagination {{next}}/{{prev}} links let clients follow cursors without building URLs.`,
  fu: [r`Which formats standardise links (HAL, JSON:API, Siren)?`],
  pit: [r`Claiming full REST while hard-coding every URL.`] },

{ id: 'q15', level: 'Intermediate', tags: ['security', 'authz'],
  code: r`~~~csharp
// BOLA: the id is trusted without checking ownership
app.MapGet("/statements/{id}", (Guid id, AppDb db) => db.Statements.Find(id));                       // vulnerable
app.MapGet("/statements/{id}", async (Guid id, AppDb db, ClaimsPrincipal u) =>
    await db.Statements.Where(s => s.Id == id && s.AccountId == u.AccountId()).SingleOrDefaultAsync() is { } s
        ? Results.Ok(s.ToDto()) : Results.NotFound());                                              // fixed

// Mass assignment: binding straight to the entity lets clients set IsAdmin/CreditLimit
app.MapPut("/users/{id}", (Guid id, User user) => { /* vulnerable */ });
public sealed record UpdateProfile(string DisplayName, string? Phone);                                // explicit DTO
~~~`,
  q: r`Explain BOLA and mass assignment and how to prevent them.`,
  a: r`**BOLA (Broken Object Level Authorization, OWASP API #1)**: the endpoint takes an object id from the client ({{GET /accounts/123}}) and returns it without checking that the caller may access *that* object.

Prevention: authorise per object on the server (compare owner/tenant to the caller's claims), scope queries by owner ({{WHERE id = @id AND customer_id = @caller}}), use unguessable ids as defence in depth (not as the control), and test every endpoint with a second user's token.

**Mass assignment**: binding request JSON straight onto an entity lets the client set fields it should not ({{isAdmin}}, {{price}}, {{ownerId}}). Prevention: bind to **DTOs with only writable fields**, never to entities; use allow-lists; make sensitive properties impossible to set via the model.`,
  pts: [r`Check ownership per object`, r`Scope queries by caller`, r`DTO allow-lists`, r`Test with two users`],
  ex: r`A refund API accepted {{amount}} and {{approved}} in the body; mapping the body to a command with only {{reason}} removed the hole.`,
  fu: [r`How would you test for BOLA automatically?`],
  pit: [r`Assuming obscure ids protect data.`] },

{ id: 'q16', level: 'Intermediate', tags: ['rate-limiting'],
  code: r`~~~csharp
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("per-api-key", ctx => RateLimitPartition.GetTokenBucketLimiter(
        ctx.Request.Headers["X-Api-Key"].ToString(),
        _ => new TokenBucketRateLimiterOptions { TokenLimit = 200, TokensPerPeriod = 100, ReplenishmentPeriod = TimeSpan.FromSeconds(1) }));
    o.OnRejected = (ctx, _) => { ctx.HttpContext.Response.Headers.RetryAfter = "1"; return ValueTask.CompletedTask; };
});
app.MapGroup("/v1").RequireRateLimiting("per-api-key");
// Per-instance limiter; for a global quota use the gateway or a Redis token bucket
~~~`,
  q: r`How do you design rate limiting and quotas?`,
  a: r`Decide the **dimension** (API key, user, tenant, IP), the **algorithm**, and the **response**.

- **Fixed window**: simple, bursty at boundaries. **Sliding window**: smoother. **Token bucket**: allows bursts up to bucket size at a steady refill rate (good default). **Leaky bucket**: smooths output. **Concurrency limit**: caps in-flight requests.
- Enforce at the **gateway/edge** with a shared store (Redis) for global limits; in-app limits protect individual instances.
- Respond **429** with {{Retry-After}} and {{RateLimit-Limit/Remaining/Reset}} headers; log and alert on sustained abuse.
- Differentiate **rate** (per second) from **quota** (per month, billing) and from **cost-based** limits for expensive endpoints.
- Tier limits per plan; allow bursts; protect auth endpoints more strictly.`,
  pts: [r`Token bucket default`, r`Global limits need shared state`, r`429 + Retry-After`, r`Rate vs quota vs cost`],
  ex: r`Login and password-reset endpoints had a strict per-IP and per-account limit to slow credential stuffing.`,
  fu: [r`How do you avoid a Redis outage disabling the API?`],
  pit: [r`Limiting by IP only, behind a shared NAT.`] },

{ id: 'q17', level: 'Intermediate', tags: ['concurrency'],
  code: r`~~~csharp
app.MapPut("/accounts/{id}/limits", async (Guid id, LimitsDto dto, HttpContext http, AppDb db) =>
{
    var acc = await db.Accounts.FindAsync(id);
    if (acc is null) return Results.NotFound();
    if (http.Request.Headers.IfMatch.ToString() != "\"" + acc.Version + "\"")
        return Results.StatusCode(412);                                     // Precondition Failed: someone changed it
    acc.UpdateLimits(dto);
    try { await db.SaveChangesAsync(); }                                    // Version is a rowversion concurrency token
    catch (DbUpdateConcurrencyException) { return Results.StatusCode(412); }
    http.Response.Headers.ETag = "\"" + acc.Version + "\"";
    return Results.NoContent();
});
// Missing If-Match on a write: 428 Precondition Required
~~~`,
  q: r`How do you prevent lost updates in an API?`,
  a: r`Use **optimistic concurrency** with a version:

1. {{GET /orders/42}} returns {{ETag: "7"}} (a version or hash).
2. The client sends {{PUT /orders/42}} with {{If-Match: "7"}}.
3. The server compares to the stored version inside the write ({{UPDATE ... WHERE id = 42 AND version = 7}}, check rows affected). On mismatch return **412 Precondition Failed** (or 409); the client refetches and retries.

Require {{If-Match}} (428 Precondition Required if missing) on resources where lost updates matter. In SQL Server use {{rowversion}}; in EF Core a concurrency token. For counters and commutative operations use atomic server-side updates instead ({{SET balance = balance - @x}}).`,
  pts: [r`Version/ETag + If-Match`, r`412 on mismatch`, r`Atomic updates for counters`],
  ex: r`Two support agents editing the same customer record: the second save fails with 412 and shows the merge dialog instead of silently overwriting.`,
  fu: [r`Pessimistic locking in APIs: when and why not?`],
  pit: [r`Last-write-wins on financial data.`] },

{ id: 'q18', level: 'Intermediate', tags: ['testing'],
  code: r`~~~csharp
// Consumer-driven contract test (PactNet): the consumer defines what it relies on
pact.UponReceiving("a request for order 981").WithRequest(HttpMethod.Get, "/orders/981")
    .WillRespond().WithStatus(HttpStatusCode.OK)
    .WithJsonBody(new { id = Match.Type("981"), total = Match.Decimal(12.5m), currency = Match.Regex("GBP", "^[A-Z]{3}$") });
await pact.VerifyAsync(async ctx => { var o = await new OrdersClient(ctx.MockServerUri).GetAsync("981"); o.Total.Should().Be(12.5m); });
~~~
~~~bash
npx oasdiff@1.10.0 breaking openapi/main.json openapi/pr.json --fail-on ERR   # block breaking spec changes in CI
~~~`,
  q: r`How do you test REST APIs and prevent breaking consumers?`,
  a: r`- **Unit tests** for domain logic.
- **API/integration tests** against the real pipeline and a real database (containers), asserting status codes, headers, bodies, errors, authorisation (including negative tests with another user's token).
- **Contract tests**: **consumer-driven (Pact)** so the provider's CI fails when a change breaks a recorded consumer expectation; **OpenAPI diff** for public APIs.
- **Schema validation** of live responses against the spec in tests.
- **Non-functional**: load tests (k6, NBomber) on critical endpoints, security scans (ZAP), and fuzzing (Schemathesis generates tests from the spec).
- **Production**: synthetic checks, canary releases, per-client error-rate dashboards.`,
  pts: [r`Negative authorisation tests`, r`Consumer-driven contracts`, r`Spec-based fuzzing`],
  ex: r`Schemathesis found a 500 on an unusual unicode query parameter in an hour.`,
  fu: [r`What does Pact verify and who runs it?`],
  pit: [r`Only testing the happy path with an admin token.`] },

{ id: 'q19', level: 'Senior', tags: ['filtering'],
  code: r`~~~http
GET /orders?status=PAID,REFUNDED&createdAt[gte]=2026-10-01&sort=-createdAt,id&fields=id,total,status&limit=50
POST /orders:batchCancel     { "ids": ["o-1","o-2","o-3"] }
207 Multi-Status             { "results": [ { "id": "o-1", "status": 200 }, { "id": "o-2", "status": 409, "error": "already shipped" } ] }
~~~
~~~csharp
// Allow-list filters and sort fields: never pass client strings into dynamic SQL/LINQ
static readonly Dictionary<string, Expression<Func<Order, object>>> Sortable = new()
{ ["createdAt"] = o => o.CreatedAt, ["total"] = o => o.Total, ["id"] = o => o.Id };
~~~`,
  q: r`How do you design filtering, sorting, field selection and bulk operations?`,
  a: r`- **Filtering**: simple equality as query params ({{?status=open&customerId=42}}); richer operators via a consistent convention ({{?createdAt[gte]=2026-01-01}}) or a defined filter syntax; whitelist filterable fields (each needs an index).
- **Sorting**: {{?sort=-createdAt,name}}; always add a unique tiebreaker for stable paging.
- **Field selection / expansion**: {{?fields=id,total}}, {{?expand=customer}} to avoid over-fetching and N+1 round trips, with limits to prevent expensive joins.
- **Bulk**: {{POST /orders:batch}} or a collection POST with an array; return per-item results (207 Multi-Status or a structured body); cap batch size; decide atomic vs partial semantics and document it.

Everything user-controlled must be validated and bounded, or it becomes a denial-of-service vector.`,
  pts: [r`Whitelist and index filterable fields`, r`Bound expansion and batch size`, r`Per-item results for bulk`],
  ex: r`Unbounded {{?expand=*}} let a client trigger a 12-table join; adding an expansion allow-list fixed it.`,
  fu: [r`When is GraphQL a better answer?`],
  pit: [r`Free-form filter strings translated directly into SQL.`] },

{ id: 'q20', level: 'Senior', tags: ['evolution', 'compatibility'],
  code: r`~~~json
// v1 response stays valid for old clients; new fields are additive and optional
{ "id": "o-981", "total": "12.50", "currency": "GBP",
  "status": "PAID",
  "paymentMethod": { "type": "card", "last4": "4242" } }
~~~
~~~typescript
// Tolerant reader on the client: ignore unknown fields and unknown enum values
type Status = 'PAID' | 'REFUNDED' | (string & {});
function label(s: Status) { return s === 'PAID' ? 'Paid' : s === 'REFUNDED' ? 'Refunded' : 'Processing'; }
~~~`,
  q: r`What are the rules for evolving an API without breaking clients?`,
  a: r`**Server side (what you may change)**: add optional request fields, add response fields, add endpoints, add enum values *only if* clients are told to tolerate unknown values from day one, loosen validation.

**Never without a new version**: remove or rename fields, change types/units/semantics, make an optional field required, tighten validation, change status codes or error types, change default sort or pagination, alter idempotency or ordering guarantees.

**Client side (tolerant reader)**: ignore unknown fields, do not rely on field order, treat enums as open, follow links and cursors rather than constructing them.

Process: publish the compatibility policy, run OpenAPI diff in CI, keep usage analytics per endpoint/client, announce deprecations with dates and migration guides, and offer a sandbox. For large ecosystems use **date-based versions** pinned per account so each client upgrades on its own schedule.`,
  pts: [r`Additive changes only`, r`Tolerant readers`, r`Deprecation with dates and telemetry`],
  ex: r`A new enum value {{PENDING_REVIEW}} crashed a partner's strict switch; the policy now states enums are open sets.`,
  fu: [r`How do you retire a version with 200 external consumers?`],
  pit: [r`Changing semantics without changing the shape (silent break).`] },

{ id: 'q21', level: 'Senior', tags: ['performance'],
  code: r`~~~csharp
builder.Services.AddResponseCompression(o => o.EnableForHttps = true);
builder.Services.AddOutputCache();
app.MapGet("/catalog/{id}", async (int id, AppDb db, CancellationToken ct) =>
    await db.Products.AsNoTracking().Where(p => p.Id == id)
        .Select(p => new ProductDto(p.Id, p.Name, p.Price))                 // project only what the response needs
        .SingleOrDefaultAsync(ct))
   .CacheOutput(p => p.Expire(TimeSpan.FromSeconds(30)));
// Plus: HTTP/2 or HTTP/3, keep-alive, connection pooling, avoid chatty N+1 client calls (composite endpoints / BFF)
~~~`,
  q: r`How do you make an API fast at scale?`,
  a: r`Work from measurement (traces, p95/p99 by endpoint), then:

1. **Reduce round trips**: expansion/batching, composite endpoints for UIs, HTTP/2 multiplexing.
2. **Cache**: CDN for public data, ETags/304, server-side caches with stampede protection.
3. **Shrink payloads**: field selection, compression (Brotli), pagination, avoid nested bloat.
4. **Fix the data layer**: indexes, no N+1, projections, read replicas, connection pooling.
5. **Async/offload** heavy work to queues; return 202.
6. **Protect**: rate limits, timeouts, bulkheads, circuit breakers, load shedding (reject early with 503 + Retry-After when saturated instead of queueing forever).
7. **Edge**: TLS session reuse, keep-alives, geographic proximity (CDN, regional deployments).

Tail latency matters more than averages: a request fanning out to ten services is only as fast as the slowest.`,
  pts: [r`p99 not average`, r`Fewer round trips, smaller payloads`, r`Load shedding beats unbounded queues`],
  ex: r`Adding {{?fields=}} and Brotli cut a mobile list response from 400 KB to 25 KB.`,
  fu: [r`What is the tail-at-scale problem?`],
  pit: [r`Optimising the average while p99 burns.`] },

{ id: 'q22', level: 'Senior', tags: ['gateway'],
  code: r`~~~yaml
# Gateway (cross-cutting, coarse): TLS, authN, quotas, routing, request size limits, WAF
routes:
  - path: /payments/**
    upstream: payments-svc
    plugins: [ jwt-auth, rate-limit: { per: api_key, limit: 1000/min }, request-size: 1MB ]
# Service (domain, fine-grained): object-level authorisation, validation, business rules, idempotency
~~~`,
  dia: r`flowchart LR
  C[Clients] --> GW[API gateway: TLS, auth, quotas, routing, WAF]
  GW --> O[Orders service: object authz, rules]
  GW --> P[Payments service: idempotency, rules]
  GW --> CAT[Catalog service]`,
  q: r`What belongs in an API gateway versus in the services?`,
  a: r`**Gateway (cross-cutting, coarse-grained)**: TLS termination, authentication (token validation), coarse authorisation/scopes, rate limiting and quotas, request size limits, routing and versioning, CORS, WAF, request/response logging and tracing headers, protocol translation, response caching, canary routing.

**Services (domain-specific)**: business validation, fine-grained and object-level authorisation, data access, business error semantics, idempotency, transactions.

Anti-patterns: business logic or orchestration in the gateway (it becomes a distributed monolith's brain and a deployment bottleneck), duplicating authorisation decisions, and trusting the gateway alone (services must still authenticate callers; use mTLS or signed internal tokens). See the API Gateway topic for BFF and aggregation.`,
  pts: [r`Gateway = cross-cutting`, r`Services own business rules`, r`Zero trust inside`],
  ex: r`Object-level checks stayed in the Orders service; the gateway only verified the token and scope.`,
  fu: [r`Do you need a gateway with a service mesh?`],
  pit: [r`Gateway-hosted orchestration logic.`] },

{ id: 'q23', level: 'Senior', tags: ['tenancy', 'security'],
  code: r`~~~csharp
// Client credentials with certificate-bound tokens (mTLS) for partners
builder.Services.AddAuthentication(CertificateAuthenticationDefaults.AuthenticationScheme)
    .AddCertificate(o => { o.AllowedCertificateTypes = CertificateTypes.Chained; o.RevocationMode = X509RevocationMode.Online; })
    .AddJwtBearer("partner", o => { o.Authority = issuer; o.Audience = "partner-api"; });
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("payouts:write", p => p.AddAuthenticationSchemes("partner").RequireClaim("scope", "payouts:write")
        .RequireAssertion(ctx => ctx.User.HasClaim("cnf_x5t", CurrentClientCertThumbprint())));   // token bound to the cert
~~~`,
  q: r`How do you secure machine-to-machine and partner APIs?`,
  a: r`- **Authentication**: OAuth2 **client credentials** with short-lived tokens (or mTLS-bound / private_key_jwt client auth for higher assurance); rotate secrets; one client per integration. Avoid shared static API keys, or if you offer them, hash at rest, scope them, allow rotation and expiry, and show last-used.
- **Authorisation**: scopes per client plus tenant binding; deny by default.
- **Transport**: TLS 1.2+, optionally mTLS with certificate pinning to a CA you control; IP allow-lists as an extra layer, not the only one.
- **Message integrity** for webhooks and sensitive inbound calls: HMAC or HTTP Message Signatures with replay protection.
- **Governance**: onboarding with least privilege, quotas, audit logs of every call, anomaly alerts, and an offboarding path that revokes everything.`,
  pts: [r`Client credentials or mTLS`, r`Scopes and tenant binding`, r`Signed messages with replay protection`],
  ex: r`Financial partners authenticate with mTLS plus client-credentials tokens bound to the certificate.`,
  fu: [r`What is token binding / DPoP?`],
  pit: [r`One shared API key for all partners.`] },

{ id: 'q24', level: 'Senior', tags: ['consistency'],
  code: r`~~~http
POST /orders                 -> 201 Created
Location: /orders/o-981
ETag: "v1"
Consistency-Token: 0/16B3A28    (commit LSN / version the client can send back)

GET /orders?customerId=42
Consistency-Token: 0/16B3A28    -> server reads from a replica only if it has replayed past that point, else primary
~~~
~~~typescript
// Or: optimistic UI shows the created order immediately from the 201 response body
setOrders(prev => [created, ...prev]);
~~~`,
  q: r`How do you handle eventual consistency in an API (read-after-write)?`,
  a: r`When writes propagate asynchronously (CQRS read models, replicas, search indexes) a client may not see its own write. Options:

- **Return the created representation** from the write and let the UI use it, rather than re-reading.
- **Read-your-writes** routing: send the caller's reads to the primary for a short window (session token with a version/LSN; "wait until read model version >= v").
- **202 + status/polling** where the effect is truly asynchronous, with an explicit {{pending}} state.
- **Version tokens**: write returns {{version: 42}}; reads accept {{If-Version-At-Least: 42}} and either wait briefly or return 409/425.
- Document consistency guarantees per endpoint and show pending states in the UI.

Being explicit is the point: hidden eventual consistency becomes support tickets.`,
  pts: [r`Return the new state from writes`, r`Read-your-writes via version tokens`, r`Document guarantees`],
  ex: r`After {{POST /orders}} the UI showed the order from the response body; the list view caught up a second later.`,
  fu: [r`What is replica lag and how does it surface?`],
  pit: [r`Redirecting to a list that does not include the new item yet.`] },

{ id: 'q25', level: 'Senior', tags: ['multi-tenancy'],
  code: r`~~~csharp
// Tenant comes from the token, never from the URL or a header the client controls
app.MapGet("/invoices/{id}", async (Guid id, AppDb db, ClaimsPrincipal user) =>
{
    var tenant = user.FindFirstValue("tenant_id")!;
    return await db.Invoices.Where(i => i.TenantId == tenant && i.Id == id).Select(i => i.ToDto()).SingleOrDefaultAsync()
        is { } dto ? Results.Ok(dto) : Results.NotFound();
}).RequireRateLimiting("per-tenant");
~~~`,
  q: r`How do you design APIs for multi-tenant SaaS?`,
  a: r`- **Tenant identification**: derive from the authenticated token (claim) or a verified host/subdomain; never trust a tenant id in the body or a client header without checking it against the token.
- **Isolation**: every query scoped by tenant (global filters + tests), tenant-aware cache keys and rate limits, row-level security as defence in depth.
- **Per-tenant configuration**: limits, features, rate plans, data residency routing.
- **Noisy neighbour** control: per-tenant quotas and concurrency limits, fair queuing for background jobs.
- **Observability** per tenant (usage, errors, latency) for support and billing.
- **Lifecycle**: onboarding, export, deletion with auditable evidence.

Test with automated cross-tenant access attempts on every endpoint.`,
  pts: [r`Tenant from the token`, r`Scope everything`, r`Per-tenant limits and metrics`],
  ex: r`A cache key missing tenant id served one tenant's settings to another in a staging test; the cache wrapper now injects the tenant prefix.`,
  fu: [r`How do you let a support engineer impersonate safely?`],
  pit: [r`Accepting {{tenantId}} from the request body.`] },

{ id: 'q26', level: 'Senior', tags: ['observability'],
  code: r`~~~promql
# RED per route: rate, errors, duration (OpenTelemetry http.server.request.duration)
sum(rate(http_server_request_duration_seconds_count{route="/payments"}[5m]))
sum(rate(http_server_request_duration_seconds_count{route="/payments",http_response_status_code=~"5.."}[5m]))
  / sum(rate(http_server_request_duration_seconds_count{route="/payments"}[5m]))
histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{route="/payments"}[5m])))
~~~
Alert on SLO burn rate (e.g. 2% of the monthly error budget in 1 hour), not on raw thresholds.`,
  q: r`What do you instrument and alert on for an API?`,
  a: r`Use the **RED** method per endpoint and per client: **R**ate, **E**rrors, **D**uration (p50/p95/p99), plus saturation (threads, connections, queue depth) from the **USE** method.

- Separate **4xx (client)** from **5xx (our fault)**; alert on 5xx rate and latency SLO burn, not on every 4xx.
- **SLIs/SLOs** (e.g. 99.9% of requests under 300 ms, 99.95% success) with error-budget burn alerts (fast and slow windows).
- **Traces** with propagated context; **structured logs** with request id, tenant, client, status; no PII.
- **Business metrics** (payments succeeded, signups) to detect silent failures.
- **Synthetic probes** from outside; dependency health.
- Dashboards per consumer to answer "is it us or them?" quickly.`,
  pts: [r`RED + saturation`, r`SLO burn-rate alerts`, r`Business metrics catch silent failures`],
  ex: r`Burn-rate alerting paged on a slow latency leak 40 minutes before customers noticed.`,
  fu: [r`Why alert on burn rate rather than a static threshold?`],
  pit: [r`Alerting on average latency.`] },

{ id: 'q27', level: 'Senior', tags: ['events', 'async-api'],
  code: r`~~~yaml
asyncapi: 3.0.0
info: { title: Orders events, version: 1.2.0 }
channels:
  orderPlaced:
    address: orders.placed.v1
    messages:
      OrderPlaced:
        payload:
          type: object
          required: [orderId, total, currency, occurredAt]
          properties: { orderId: { type: string }, total: { type: string }, currency: { type: string }, occurredAt: { type: string, format: date-time } }
operations:
  publishOrderPlaced: { action: send, channel: { $ref: '#/channels/orderPlaced' } }
~~~`,
  q: r`When should an API be event-driven (AsyncAPI, webhooks, streams) instead of request/response?`,
  a: r`Prefer request/response when the caller needs the answer now and the work is quick. Prefer **events/async** when:

- processing is slow or variable and callers should not wait;
- many consumers need to react independently (fan-out);
- you must absorb bursts (queue as buffer) and decouple availability;
- the interaction is a notification ("order shipped") rather than a question.

Expose events via webhooks (to external parties), a broker/stream (Kafka, SNS/SQS, Service Bus) internally, or server push (SSE/WebSocket) for live UIs; describe them with **AsyncAPI** and manage schemas with a registry and compatibility rules. Costs: eventual consistency, ordering and duplication concerns, harder debugging; mitigate with idempotent consumers, correlation ids and replayable logs.`,
  pts: [r`Slow, fan-out, bursty, notification`, r`AsyncAPI + schema registry`, r`Idempotent consumers`],
  ex: r`{{POST /orders}} returns 201 quickly; shipping, email and analytics react to an {{OrderPlaced}} event.`,
  fu: [r`How do you version event schemas?`],
  pit: [r`Using events for simple queries.`] },

{ id: 'q28', level: 'Senior', tags: ['standards'],
  code: r`~~~yaml
# Spectral ruleset enforcing the style guide in CI
extends: ["spectral:oas"]
rules:
  paths-kebab-case: { given: "$.paths[*]~", then: { function: pattern, functionOptions: { match: "^(/[a-z0-9-{}]+)+$" } }, severity: error }
  money-as-string: { given: "$..properties[?(@property.match(/amount|total|price/))]", then: { field: type, function: pattern, functionOptions: { match: "^string$" } }, severity: error }
  problem-details-errors: { given: "$.paths[*][*].responses[?(@property >= 400)].content", then: { field: "application/problem+json", function: truthy } }
~~~`,
  q: r`Which API design rules would you put in an organisation-wide style guide?`,
  a: r`Short, enforceable, and linted in CI (Spectral):

- Naming (plural nouns, camelCase, kebab-case paths), standard fields ({{id}}, {{createdAt}}, {{updatedAt}}), ISO 8601 UTC dates, money format, enum policy (open sets).
- Standard **pagination, filtering, sorting** conventions.
- Standard **error format** (RFC 9457) and an error-code registry.
- **Idempotency** rules for unsafe operations; concurrency via ETags.
- **Versioning and deprecation** policy with dates.
- **Security baseline**: OAuth2, scopes naming, no secrets in URLs, rate limits, PII handling.
- **Observability baseline**: trace headers, request ids, standard logs.
- **Documentation**: OpenAPI required, examples, changelog.
- Review process for new public APIs (design review), with a fast path for internal ones.

The guide wins when tooling enforces it and teams helped write it.`,
  pts: [r`Lint it in CI`, r`Error and pagination standards`, r`Design review for public APIs`],
  ex: r`A Spectral ruleset failed builds on missing {{operationId}} and non-standard error responses.`,
  fu: [r`How do you handle legacy APIs that violate the guide?`],
  pit: [r`A PDF guide with no tooling.`] },

{ id: 'q29', level: 'Senior', tags: ['bff'],
  code: r`~~~csharp
// BFF endpoint composes three backend calls into the one shape the mobile home screen needs
app.MapGet("/bff/home", async (IAccountsApi accounts, IOffersApi offers, INotificationsApi notes, ClaimsPrincipal u, CancellationToken ct) =>
{
    var a = accounts.SummaryAsync(u.CustomerId(), ct);
    var o = offers.ForCustomerAsync(u.CustomerId(), ct);
    var n = notes.UnreadCountAsync(u.CustomerId(), ct);
    await Task.WhenAll(a, o, n);
    return Results.Ok(new { balance = a.Result.Balance, offers = o.Result.Take(3), unread = n.Result });
});
~~~`,
  dia: r`flowchart LR
  WEB[Web SPA] --> BW[Web BFF]
  MOB[Mobile app] --> BM[Mobile BFF]
  BW & BM --> A[Accounts API]
  BW & BM --> O[Offers API]
  BW & BM --> N[Notifications API]`,
  q: r`What is a BFF and how does it relate to REST API design?`,
  a: r`A **Backend For Frontend** is a server-side layer dedicated to one client experience (web, iOS, partner portal). It aggregates calls to domain services, shapes payloads to the screen, and in browser apps can hold OAuth tokens server-side and issue an HttpOnly session cookie so the SPA never touches access tokens.

It lets domain APIs stay resource-oriented and stable while UI-specific composition (one call per screen) lives where the UI team controls it. Pitfalls: duplicating business logic, becoming a shared monolith (one BFF per client type, owned by that frontend team), and an extra hop of latency (keep calls parallel, cache).`,
  pts: [r`One BFF per client experience`, r`Server-side token handling for SPAs`, r`No business logic duplication`],
  ex: r`The mobile BFF returns a ready-to-render home screen payload in one call, built from four services in parallel.`,
  fu: [r`How is a BFF different from an API gateway?`],
  pit: [r`A single generic BFF for all clients.`] },

{ id: 'q30', level: 'Senior', tags: ['resilience'],
  code: r`~~~typescript
// Angular HttpClient: retry only idempotent requests, with backoff and jitter, honour Retry-After
this.http.get<Order[]>('/api/orders').pipe(
  timeout(5000),
  retry({ count: 3, delay: (err, attempt) => {
    if (err.status && ![429, 502, 503, 504].includes(err.status)) return throwError(() => err);
    const ra = Number(err.headers?.get('Retry-After'));
    return timer(ra ? ra * 1000 : Math.min(8000, 2 ** attempt * 200) * (0.5 + Math.random()));
  } }));
~~~`,
  q: r`How should API clients behave: retries, timeouts, backoff, circuit breaking?`,
  a: r`Publish **client guidance** as part of the API contract:

- Set **timeouts** (connect + total); never wait forever.
- **Retry** only idempotent requests (or those with an idempotency key) on timeouts, 429, 502-504; honour {{Retry-After}}; exponential backoff with **full jitter**; cap attempts and total time.
- Do **not** retry 4xx except 408/429.
- **Circuit breaker** to stop hammering during outages; **bulkhead** per dependency.
- **Deduplicate** on the server side regardless.
- Propagate {{traceparent}} and deadlines.
- Provide SDKs that implement this correctly so every client does not reinvent it.

Server side, protect yourself too: load shedding, rate limits, and {{Retry-After}} so retries spread out rather than synchronise.`,
  pts: [r`Retry only what is safe`, r`Jitter prevents synchronised storms`, r`Ship SDKs with correct defaults`],
  ex: r`After an outage thousands of clients retried at the same second; adding jitter and Retry-After flattened the recovery spike.`,
  fu: [r`What is a retry budget?`],
  pit: [r`Immediate fixed-interval retries.`] },

{ id: 'q31', level: 'Senior', tags: ['data', 'privacy'],
  code: r`~~~csharp
public sealed record CustomerDto(string Id, string Name, [property: Sensitive] string MaskedIban);
static string Mask(string iban) => iban[..4] + new string('*', iban.Length - 8) + iban[^4..];
// Never put PII in URLs (they end up in logs, proxies, browser history)
//   bad:  GET /customers?email=asha@example.com
//   good: POST /customers/search { "email": "asha@example.com" }
builder.Services.AddHttpLogging(o => { o.LoggingFields = HttpLoggingFields.RequestPath | HttpLoggingFields.ResponseStatusCode; }); // no bodies
~~~`,
  q: r`How do you handle PII and sensitive data in API design?`,
  a: r`- **Data minimisation**: return only what the caller needs; field-level permissions; separate endpoints/scopes for sensitive fields.
- **Masking and tokenisation**: show last 4 digits of a PAN; use tokens for card numbers; keep raw PAN out of your systems (PCI scope).
- **Never in URLs** (logged by proxies, browsers, referrers); use bodies or headers.
- **Logs and traces**: redact by default with allow-listed fields.
- **Encryption** in transit and at rest; field-level encryption for the most sensitive attributes with key management.
- **Rights and retention**: export, deletion/erasure (GDPR), retention schedules, audit of access.
- **Environments**: no production PII in lower environments (synthetic or masked data).`,
  pts: [r`Minimise and mask`, r`No PII in URLs or logs`, r`Retention and erasure`],
  ex: r`An error log contained full request bodies including addresses; a redaction filter in the logging pipeline fixed it centrally.`,
  fu: [r`How do you implement erasure with immutable event logs?`],
  pit: [r`Putting email addresses in query strings.`] },

{ id: 'q32', level: 'Senior', tags: ['migration'],
  code: r`~~~csharp
// Track who still calls v1 before the sunset date
app.MapGroup("/v1").AddEndpointFilter(async (ctx, next) =>
{
    var client = ctx.HttpContext.User.FindFirstValue("client_id") ?? "anonymous";
    V1Usage.Add(1, new KeyValuePair<string, object?>("client_id", client));            // dashboard per consumer
    ctx.HttpContext.Response.Headers["Sunset"] = "Thu, 01 Jan 2027 00:00:00 GMT";
    return await next(ctx);
});
// v1 implemented as an adapter over v2 internally, so only one code path holds the logic
~~~`,
  q: r`How do you migrate consumers from API v1 to v2 with minimal pain?`,
  a: r`1. **Design v2 for the consumers' needs**, with a published migration guide (field mapping, behaviour differences) and a sandbox.
2. **Run both versions** from shared domain logic; translate at the edge (mapping layers) so fixes apply to both.
3. **Measure**: dashboards of traffic per version and per client; identify the long tail early.
4. **Communicate** with dated milestones: announce, deprecation headers ({{Deprecation}}, {{Sunset}}), email and portal notices, brown-out windows (temporary short outages of v1) to surface forgotten consumers.
5. **Support**: office hours, SDK updates, code samples, compatibility shims for the hardest cases.
6. **Retire** on the date with a rollback plan and a final reminder; keep a read-only archive if auditors need it.

Treat it as a product launch with owners and metrics.`,
  pts: [r`Translate at the edge`, r`Per-client usage telemetry`, r`Brown-outs find forgotten consumers`],
  ex: r`Two one-hour brown-outs revealed an internal batch job nobody remembered, weeks before sunset.`,
  fu: [r`What if a regulator-mandated client cannot migrate?`],
  pit: [r`Switching v1 off on the announced day without telemetry.`] },

{ id: 'q33', level: 'Senior', tags: ['full-stack', 'spa', 'resilience'],
  code: r`~~~typescript
// React Query: optimistic update with rollback, retries only for network/5xx
const mutation = useMutation({
  mutationFn: (o: NewOrder) => api.post('/orders', o, { headers: { 'Idempotency-Key': o.clientId } }),
  onMutate: async (o) => {
    await qc.cancelQueries({ queryKey: ['orders'] });
    const prev = qc.getQueryData<Order[]>(['orders']);
    qc.setQueryData<Order[]>(['orders'], old => [{ ...o, status: 'pending' }, ...(old ?? [])]);
    return { prev };
  },
  onError: (_e, _o, ctx) => qc.setQueryData(['orders'], ctx?.prev),       // roll back
  onSettled: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  retry: (n, e: any) => n < 3 && (!e.status || e.status >= 500),
});
~~~`,
  q: r`Full-stack: how should an Angular or React client handle API errors, retries, optimistic updates and slow networks?`,
  a: r`### Error handling
- One HTTP layer (Angular {{HttpInterceptor}}, a fetch wrapper/TanStack Query in React) that maps **ProblemDetails** to a typed error, attaches correlation ids, and handles 401 (refresh or redirect) centrally.
- Distinguish: **validation (400/422)** → show field errors; **conflict (409/412)** → refetch and show "changed by someone else"; **429/503** → backoff and inform; **5xx** → retry if safe, else a friendly message with the trace id.

### Retries
Only for idempotent requests or those with an {{Idempotency-Key}} generated **once per user action** (stored with the pending action so a retry reuses it); exponential backoff with jitter; honour {{Retry-After}}; cap attempts.

### Optimistic updates
Apply the change in the UI immediately, send the request, and **roll back** with a clear message on failure. Use it for low-risk actions (like, rename). Do **not** fake success for money movement: show a pending state until the server confirms.

### Slow and flaky networks
Request cancellation on navigation (Angular {{takeUntilDestroyed}}, {{AbortController}}), debounced search, stale-while-revalidate caching of reads, skeleton loaders, and disabling double-submit while a request is in flight.`,
  pts: [r`Centralised HTTP error mapping`, r`Idempotency key per user action`, r`Optimistic UI only for low-risk actions`, r`Cancellation and double-submit protection`],
  ex: r`A transfer screen generated the idempotency key when the user pressed "Send" and reused it on automatic retry, so a flaky mobile connection never produced duplicate transfers.`,
  fu: [r`How do you test these behaviours?`, r`Where do you keep server state: component state, a store, or a query cache?`],
  pit: [r`Generating a new idempotency key on every retry.`, r`Optimistic "success" for payments.`] },

{ id: 'q34', level: 'Senior', tags: ['caching', 'finance'],
  code: r`~~~http
GET /fx/rates/EURUSD
HTTP/1.1 200 OK
Cache-Control: public, max-age=5
Content-Type: application/json
{ "pair": "EURUSD", "rate": "1.0842", "asOf": "2026-10-10T09:31:05Z", "source": "ECB-indicative", "indicative": true }

GET /accounts/42/balance
Cache-Control: no-store                       (balances used for decisions are never cached)
~~~`,
  q: r`What financial data may an API cache, for how long, and how do you communicate staleness?`,
  a: r`Classify data by **tolerance for staleness** and **cost of being wrong**:

| Data | Caching | Notes |
|---|---|---|
| Reference data (currencies, bank codes, holiday calendars) | Hours, CDN/shared caches, ETags | Versioned, invalidated on publish |
| Market prices / FX indicative rates | Seconds; include {{asOf}} timestamp | Quotes for execution need a firm price with expiry |
| Account balances | Not in shared caches; short private cache at most | Show {{asOf}}; payments check balance at the source of truth |
| Transaction history | Immutable past entries cacheable; recent window short | Pending vs posted states |
| Personal data | {{private, no-store}} in shared caches | Regulatory and privacy reasons |

Communicate staleness explicitly: an {{asOf}} field in the payload, {{Cache-Control}} max-age, {{Age}} header from caches, and a {{quoteId}} with {{expiresAt}} for executable prices (the client must accept a quote, not a cached price).

Decisions (payment authorisation, limit checks, trade execution) always go to the source of truth inside a transaction; caches only serve display.`,
  pts: [r`Classify by staleness tolerance and cost of error`, r`asOf timestamps on volatile data`, r`Executable quotes with expiry`, r`Decisions use the source of truth`],
  ex: r`An FX widget shows indicative rates cached for 2 seconds; the booking flow requests a firm quote valid for 30 seconds and books only against that quote id.`,
  fu: [r`How do you invalidate a reference-data cache across CDN and services?`, r`What is "last look" and why does it exist?`],
  pit: [r`Caching balances in a shared CDN cache.`, r`Executing against a cached display price.`] },

{ id: 'q35', level: 'Senior', tags: ['mobile', 'performance'],
  code: r`~~~csharp
// Minimum supported client version, communicated explicitly
app.Use(async (ctx, next) =>
{
    if (Version.TryParse(ctx.Request.Headers["X-App-Version"], out var v) && v < new Version(4, 12))
    {
        ctx.Response.StatusCode = 426;                                   // Upgrade Required
        await ctx.Response.WriteAsJsonAsync(new { type = "https://errors.example.com/upgrade-required", minVersion = "4.12" });
        return;
    }
    await next();
});
// Compact payloads, delta sync endpoints (?since=token), idempotent writes with client-generated ids
~~~`,
  q: r`How do you design APIs for mobile apps on unreliable networks with many old app versions in the wild?`,
  a: r`### Network realities
- **Fewer round trips**: screen-oriented endpoints or a BFF that aggregates; HTTP/2 or HTTP/3.
- **Small payloads**: field selection, compression, pagination; avoid sending what the screen does not show.
- **Resumable and retry-safe**: idempotency keys on writes, resumable uploads (chunked, tus protocol or multipart upload to object storage), cursor-based sync ({{GET /changes?since=token}}) for offline-first apps.
- **Timeouts and backoff** in the SDK; offline queue for user actions with conflict handling.

### Version sprawl
Users do not update quickly, so expect app versions from 18 months ago:
- Strict **backward compatibility** and long-lived API versions; track usage by {{User-Agent}}/app version header.
- **Minimum supported version** endpoint with a forced-upgrade path for security fixes.
- **Remote config / feature flags** to disable features server-side for broken old versions.
- Never change semantics of existing fields; add new ones.

### Security
Certificate pinning (with a rotation plan), token storage in Keychain/Keystore, device attestation for high-risk actions (App Attest / Play Integrity).`,
  pts: [r`Aggregate per screen, shrink payloads`, r`Delta sync with change tokens`, r`Expect very old clients`, r`Min-version and remote config`, r`Pinning with a rotation plan`],
  ex: r`A banking app's change-feed endpoint let the app sync only new transactions since the last token, reducing data transfer by 90% versus full refreshes.`,
  fu: [r`How do you handle a breaking security change when 5% of users have an old app?`, r`What are the risks of certificate pinning?`],
  pit: [r`Pinning a leaf certificate with no backup pin, bricking the app at renewal.`, r`Assuming everyone runs the latest app version.`] },

{ id: 'q36', level: 'Senior', tags: ['audit', 'regulatory'],
  code: r`~~~http
GET /positions/ACC-42?asOf=2026-09-30T23:59:59Z&knownAt=2026-10-05T00:00:00Z   bitemporal: valid time + transaction time
POST /trades/T-77/corrections   { "reason": "price error", "correctedPrice": "101.25" }   -> new version, original kept
GET  /trades/T-77/history       -> v1 (original), v2 (correction), each with actor and timestamp
~~~
~~~sql
CREATE TABLE trade_versions (trade_id text, version int, valid_from timestamptz, recorded_at timestamptz DEFAULT now(),
  price numeric(19,6), actor text, reason text, PRIMARY KEY (trade_id, version));   -- append-only, no UPDATE grants
~~~`,
  q: r`How do you design APIs for regulatory reporting and audit: immutable records, corrections and "as of" queries?`,
  a: r`Regulators ask "what did you know, and when?" so the API must expose **history**, not just current state.

- **Immutable records**: submitted reports, trades and postings are never updated in place; corrections are new records that **amend** or **cancel** an earlier one, linked by id ({{amends: "rpt_123"}}).
- **Bitemporal model**: {{validFrom/validTo}} (when the fact was true in the business) and {{recordedFrom/recordedTo}} (when the system knew it). The API supports {{?asOf=2026-06-30}} (business time) and {{?knownAt=2026-07-02T09:00Z}} (system time).
- **Versioned resources**: {{GET /reports/{id}/versions}} with each submission, who submitted it, and the payload hash.
- **Evidence**: hashes/signatures of submitted payloads, timestamps from a trusted clock, acknowledgements from the regulator stored with the record.
- **Access and retention**: read access audited, retention per regulation (often 5-7+ years), legal hold, and PII minimisation.

Implementation in SQL Server/PostgreSQL: temporal or ledger tables for system time, explicit validity columns for business time, append-only tables with reversal records.`,
  pts: [r`Append-only with amend/cancel links`, r`Bitemporal: asOf and knownAt`, r`Versions with hashes and acknowledgements`, r`Retention and legal hold`],
  ex: r`A trade-reporting API answered an inquiry about a position as reported on a specific date even though it had been corrected twice since, because every version was retained with its submission timestamp.`,
  fu: [r`How do you handle GDPR erasure for immutable records?`, r`What is the difference between business time and system time?`],
  pit: [r`Overwriting a submitted report to fix an error.`, r`Only keeping current state.`] },

{ id: 'q37', level: 'Principal', tags: ['design'],
  code: r`~~~csharp
// Payment intent state machine + idempotent create + provider idempotency + reconciliation
public enum PaymentStatus { RequiresConfirmation, Processing, Succeeded, Failed, Unknown }
app.MapPost("/payment-intents", ([FromHeader(Name = "Idempotency-Key")] string key, CreateIntent req, PaymentsService s, CancellationToken ct)
    => s.CreateAsync(key, req, ct));
app.MapPost("/payment-intents/{id}/confirm", async (string id, PaymentsService s, CancellationToken ct) =>
{
    var r = await s.ConfirmAsync(id, ct);   // calls PSP with the same idempotency key; timeout -> status Unknown
    return r.Status == PaymentStatus.Unknown ? Results.Accepted("/payment-intents/" + id, r) : Results.Ok(r);
});
// Unknown is resolved by polling the PSP / webhooks / nightly settlement reconciliation, never by charging again
~~~`,
  dia: r`sequenceDiagram
  participant C as Client
  participant API as Payments API
  participant DB as Payments DB
  participant PSP as Card processor
  C->>API: POST /payment-intents (Idempotency-Key K)
  API->>DB: insert intent + key K (unique)
  API-->>C: 201 intent pi_1
  C->>API: POST /payment-intents/pi_1/confirm
  API->>PSP: authorise (idempotency key pi_1)
  PSP--xAPI: timeout
  API->>DB: status UNKNOWN
  API-->>C: 202 processing
  PSP-->>API: webhook authorised
  API->>DB: status SUCCEEDED`,
  q: r`Design a payments API that clients can retry safely and that survives partial failures.`,
  a: r`### Resources and flow
- {{POST /payments}} with {{Idempotency-Key}}, body {{amount, currency, sourceId, orderId}} → **201** with {{status: pending}} (or **202** if processing continues asynchronously) and {{Location}}.
- {{GET /payments/{id} }} for status; webhook {{payment.succeeded | payment.failed}} to the merchant.
- {{POST /payments/{id}/refunds}} (own idempotency key) and {{POST /payments/{id}/capture}} for auth/capture.

### Key design decisions
- **Amount as integer minor units or string + ISO 4217 currency**; never floats.
- **State machine** {{requires_confirmation → processing → succeeded | failed | canceled}} with only legal transitions enforced server-side.
- **Idempotency** persisted atomically with the payment row; the processor call carries a derived key; an **unknown** processor outcome is resolved by query then reconciliation.
- **Webhooks** signed, retried, at-least-once; merchants dedupe by event id.
- **Errors** machine-readable ({{card_declined}}, {{insufficient_funds}}), with retryable vs non-retryable flagged.
- **Security**: PCI scope minimised via tokenisation; mTLS/OAuth client credentials for merchants; rate limits; audit trail.

See the Saga and System Design topics for the internal flow.`,
  pts: [r`Idempotency-Key everywhere writes happen`, r`Explicit state machine`, r`Minor units + currency`, r`Webhooks as the async truth`],
  ex: r`A client timed out after a 30 s processor delay; retrying with the same key returned the same payment id instead of a second charge.`,
  fu: [r`How do you handle the processor returning "unknown"?`],
  pit: [r`Returning 200 for a payment whose outcome is still unknown.`] },

{ id: 'q38', level: 'Principal', tags: ['pagination', 'search'],
  code: r`~~~sql
-- Keyset pagination with a covering index on the sort key + tiebreaker
CREATE INDEX ix_tx_account_posted ON transactions (account_id, posted_at DESC, id DESC) INCLUDE (amount, description);
SELECT id, posted_at, amount, description FROM transactions
WHERE account_id = $1 AND (posted_at, id) < ($2, $3)
ORDER BY posted_at DESC, id DESC LIMIT 50;
-- Free-text search goes to a search index (OpenSearch) fed by CDC; totals are estimates ("about 1.2 M results")
~~~`,
  q: r`Design pagination, sorting and search for a 500-million-row dataset.`,
  a: r`- **Keyset pagination** on an indexed, unique, ordered key; opaque cursor; hard max page size; no deep offsets.
- **Sorting** only on indexed columns (whitelist); composite indexes matching filter+sort order; avoid sort on computed fields.
- **Totals**: avoid exact counts (full scans); offer approximate counts ({{hasMore}}), cached counts, or counts capped at N ("10,000+").
- **Search**: use a purpose-built engine (OpenSearch/Elasticsearch, or PostgreSQL full-text) fed from the source of truth through events/CDC; accept index lag and document it; cursor pagination with {{search_after}}.
- **Protection**: query timeouts, cost limits, rate limits per client, and a rejection path for unindexed filter combinations.
- **Export** large sets via async jobs (files), not pages.`,
  pts: [r`Keyset + indexes`, r`Approximate counts`, r`Search engine fed by CDC`, r`Async export for bulk`],
  ex: r`Replacing {{COUNT(*)}} with a capped count ({{LIMIT 10001}}) removed a multi-second query from every list call.`,
  fu: [r`How do you keep a search index consistent with the database?`],
  pit: [r`Offering arbitrary sort and filter combinations without indexes.`] },

{ id: 'q39', level: 'Principal', tags: ['governance', 'platform'],
  code: r`~~~yaml
# Reusable CI workflow every API repo calls: lint, breaking-change check, publish to the catalogue
jobs:
  api-governance:
    uses: org/platform-workflows/.github/workflows/api-governance.yml@v3
    with:
      spec: openapi/service.json
      ruleset: https://api-standards.internal/spectral.yaml
      fail-on-breaking: true
~~~`,
  q: r`How do you govern API quality across 40 teams without becoming a bottleneck?`,
  a: r`Combine **paved road + automated guardrails + lightweight review**:

- **Standards as code**: Spectral rulesets, shared OpenAPI templates, SDK generators, shared libraries for errors, pagination, idempotency, auth.
- **Tiered review**: public/partner/regulated APIs get a design review (async via PR on the spec, 2-day SLA); internal APIs self-certify against the linter; breaking-change detection blocks merge.
- **Catalogue and ownership**: every API registered (owner, SLO, consumers, lifecycle stage) in a developer portal.
- **Feedback loops**: consumer satisfaction, time-to-first-call, breaking-change incidents, deprecation compliance.
- **Community**: guild of API champions, shared examples, office hours.
- **Escalation**: documented path for justified deviations (ADR).

Measure outcomes (breaking incidents, consistency score, integration time), not review counts.`,
  pts: [r`Automation first, review by risk`, r`Catalogue with owners`, r`Measure outcomes`],
  ex: r`Linting removed 80% of review comments; designers focused on resource modelling and compatibility.`,
  fu: [r`How do you handle a team that ships without review?`],
  pit: [r`A central review board every API must pass.`] },

{ id: 'q40', level: 'Principal', tags: ['strategy', 'product'],
  code: r`~~~text
API product scorecard (reviewed monthly with consumers)
Adoption: active consumers 37 (+5)      Time-to-first-call: 22 min (target < 30)
Reliability: SLO 99.95% (actual 99.97%) Support tickets per 1k consumers: 3.1
Deprecations in flight: v1 (12 consumers left, sunset 2027-01-01)
Top requests from consumers: webhooks for refunds, bulk endpoint
~~~`,
  q: r`How do you treat an API as a product, and what changes in your decisions?`,
  a: r`An API is a **contract with customers** you do not control, so decisions shift from "is it elegant" to "what will it cost to be wrong".

- **Consumers first**: interview integrators, define personas (partner dev, mobile team), measure time to first successful call and support load.
- **Stability over cleverness**: conservative additive evolution, long deprecation windows, compatibility tests as a release gate.
- **Developer experience**: accurate docs, runnable examples, sandbox, SDKs, status page, changelog, clear errors.
- **Lifecycle management**: alpha/beta/GA labels, ownership, roadmap, deprecation policy, SLAs and SLOs.
- **Commercials**: quotas, plans, metering, billing accuracy, abuse controls.
- **Metrics**: adoption, retention, error rates per consumer, support tickets, revenue.

Make trade-offs visible to product leadership: every public field is a long-term liability.`,
  pts: [r`Consumers and DX first`, r`Stability as a feature`, r`Lifecycle, SLAs, metering`],
  ex: r`A payments provider's strict versioning and excellent docs became a sales advantage.`,
  fu: [r`How would you price API usage?`],
  pit: [r`Shipping fields "we might need later".`] },

{ id: 'q41', level: 'Principal', tags: ['incident'],
  code: r`~~~bash
# 1. Mitigate: roll back the deploy or re-enable the old behaviour behind a flag
kubectl rollout undo deploy/partner-api -n prod
# 2. Find what changed in the contract
npx oasdiff@1.10.0 changelog openapi/release-41.json openapi/release-42.json
# 3. Prevent: breaking-change gate in CI and consumer contract tests for top partners
~~~`,
  q: r`An API change shipped on Friday broke a major partner. Walk through your response and the follow-up.`,
  a: r`**Contain**: confirm impact (which partners, which endpoints) from per-client error metrics; roll back or feature-flag off the change immediately; open an incident with a single coordinator and a communication lead; notify the partner proactively with facts and ETA.

**Diagnose** after recovery: what exact contract changed (diff the responses), why tests/contract checks missed it (was the partner covered by a consumer-driven test? was the change "compatible" in our rules but breaking in their parser?), and why the rollout reached 100% (no canary per client, no per-client alert).

**Fix the system**: add a consumer contract test for that partner, OpenAPI diff gating, canary releases with per-client error monitors, a no-Friday-deploys guard for high-risk changes (or stronger automatic rollback), and a clear compatibility policy shared with partners (open enums, tolerant parsing).

**Relationship**: blameless review shared with the partner, credits if contractual, and a named contact. Trust is rebuilt by transparency and prevention, not apology.`,
  pts: [r`Rollback first`, r`Per-client visibility`, r`Contract tests for key consumers`, r`Transparent comms`],
  ex: r`A numeric field changed from integer to decimal string; a partner's strict parser failed. A Pact test would have caught it.`,
  fu: [r`How do you decide whether to roll back or hotfix forward?`],
  pit: [r`Debugging in production while the partner is down.`] },

{ id: 'q42', level: 'Principal', tags: ['decision'],
  code: r`~~~graphql
# Where GraphQL helps: many clients composing different views of a rich graph
query { customer(id: "42") { name accounts { iban balance } recentOrders(first: 5) { id total } } }
# Costs to price in: query cost limits, persisted queries, field-level authorisation, N+1 (DataLoader), caching
~~~
~~~csharp
builder.Services.AddGraphQLServer().AddQueryType<Query>().AddMaxExecutionDepthRule(8).ModifyCostOptions(o => o.MaxFieldCost = 2000); // Hot Chocolate
~~~`,
  q: r`Your CTO wants to standardise on GraphQL for all new APIs. How do you respond?`,
  a: r`Engage with the goal behind the proposal (fewer round trips for UIs? frontend velocity? a unified graph?) and test it against costs.

**Where GraphQL helps**: many client types with varied data needs, aggregation across services (as a BFF/federation layer), rapid UI iteration.

**Where it hurts**: simple CRUD and machine-to-machine APIs (REST/gRPC are simpler), HTTP caching and CDN use, rate limiting by cost, authorization at field level, N+1 resolver pitfalls, observability granularity (everything is POST /graphql), file upload and streaming awkwardness, and a steep operational learning curve.

Recommendation: **adopt GraphQL where its benefits are proven (a BFF over domain services), keep REST for partner/public and CRUD services, gRPC internally.** Propose a time-boxed pilot on one product area with success metrics (round trips, frontend delivery time, p95), query-cost limiting and persisted queries from day one, and a decision review after the pilot.`,
  pts: [r`Find the underlying goal`, r`Match tool to client need`, r`Pilot with metrics`, r`Cost limits and persisted queries`],
  ex: r`The pilot cut mobile home-screen calls from 9 to 1 but showed the partner API gained nothing; the standard became "GraphQL for BFFs".`,
  fu: [r`How would you secure GraphQL against expensive queries?`],
  pit: [r`Rejecting the idea by reflex rather than by evidence.`] },

{ id: 'q43', level: 'Principal', tags: ['cost', 'platform'],
  code: r`~~~text
Annual API platform cost model (example)
Gateway (managed, 2 regions, 3 B req/yr)        $X
Identity provider (MAU / M2M tokens)             $Y
Observability (logs 8 TB, traces 10% sampled)    $Z   <- usually the biggest surprise
Developer portal + docs + SDK generation         $W
Support/on-call (2 FTE x share)                  $V
Cost per 1 M calls = total / volume -> compare per product and per consumer tier
~~~`,
  q: r`How do you reason about the total cost of an API platform (gateway, auth, observability, support)?`,
  a: r`Break cost into **build, run, and change**:

- **Run**: gateway/WAF per-request fees, compute, egress, logging/tracing ingestion (often the surprise), identity provider MAUs, certificates, on-call.
- **Build**: SDKs, portal, docs, test infrastructure.
- **Change**: breaking-change handling, migrations, support tickets, partner onboarding time.

Levers: sampling and log tiering, caching at the CDN, compression, right-sized gateways, self-service onboarding to cut support hours, deprecating unused endpoints (usage telemetry), and consolidating duplicate APIs. Compare managed gateways (priced per million calls; cheap to start, expensive at scale) with self-hosted (ops cost). Report cost per million requests and per active consumer so trade-offs are comparable.`,
  pts: [r`Observability ingestion is a hidden cost`, r`Retire unused endpoints`, r`Unit economics per request/consumer`],
  ex: r`Trace sampling and log-level tiering cut the observability bill by 40% with no loss of incident-debugging power.`,
  fu: [r`At what scale does a self-hosted gateway beat a managed one?`],
  pit: [r`Looking only at compute and ignoring support and logging.`] },

{ id: 'q44', level: 'Principal', tags: ['security', 'risk'],
  code: r`~~~csharp
// Systematic fix: resource-based authorisation in one place, required for every endpoint that takes an id
public sealed class OwnerRequirement : IAuthorizationRequirement;
public sealed class AccountOwnerHandler(AppDb db) : AuthorizationHandler<OwnerRequirement, AccountRef>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext ctx, OwnerRequirement r, AccountRef res)
    {
        if (await db.AccountOwners.AnyAsync(o => o.AccountId == res.Id && o.CustomerId == ctx.User.CustomerId())) ctx.Succeed(r);
    }
}
// + architecture test: every endpoint with an {id} route parameter must carry the Owner policy
~~~`,
  q: r`A pentest reports BOLA on 14 endpoints. How do you fix it systematically, not endpoint by endpoint?`,
  a: r`Treat the recurrence as a **design flaw in the platform**, not 14 bugs.

1. **Contain**: patch the highest-risk endpoints first (money, PII); add temporary detective controls (alert on one token accessing many distinct object ids).
2. **Root cause**: authorisation was a per-developer convention. Why was it forgettable?
3. **Make it structural**: central authorisation layer (policy engine such as OPA/Cedar, or resource-based handlers in the framework pipeline); repository methods that **require** a caller scope (no {{GetById(id)}} without owner); query filters by tenant/owner; deny-by-default fallback policy so an unannotated endpoint fails closed.
4. **Prevent regression**: automated authorisation tests that call every endpoint with a second user's token (generated from the OpenAPI spec), architecture tests forbidding unscoped repository access, and security review checklist items.
5. **Verify**: re-test, then run the same scan quarterly; track metric "endpoints without a policy" to zero.`,
  pts: [r`Fix the class of bug`, r`Fail closed by default`, r`Spec-driven authorisation tests`],
  ex: r`A repository API that required a {{CallerContext}} made the unsafe call impossible to write.`,
  fu: [r`What are the trade-offs of an external policy engine?`],
  pit: [r`Patching 14 endpoints and moving on.`] },

{ id: 'q45', level: 'Principal', tags: ['architecture'],
  code: r`~~~csharp
// The contract is its own type; the domain can change behind a mapping
public sealed record OrderResponseV1(string Id, string Total, string Currency, string Status);   // stable
internal static class OrderMapping
{
    public static OrderResponseV1 ToV1(this Order o) =>
        new(o.Id.ToString(), o.Total.Amount.ToString("0.00", CultureInfo.InvariantCulture), o.Total.Currency,
            o.Status switch { OrderStatus.Settled or OrderStatus.Captured => "PAID", OrderStatus.Refunded => "REFUNDED", _ => "PENDING" });
}
~~~`,
  q: r`How do you design APIs that remain stable while the domain model behind them changes?`,
  a: r`Separate **public contract** from **internal model**: map at the boundary with explicit DTOs; never expose entity or event shapes directly. The contract models *what consumers need to do*, not how you store it.

Techniques: anti-corruption layer / mapping per version, **stable identifiers** (opaque ids independent of database keys), **capability-oriented** fields instead of leaked implementation (e.g. {{status}} enum with documented meanings, not a bitmask of internal flags), expand/contract data migrations behind the scenes, feature flags for new behaviour, and compatibility tests that replay recorded consumer traffic against new builds.

Resist the "thin CRUD over tables" API that locks your schema into the contract forever.`,
  pts: [r`DTOs and mapping at the boundary`, r`Opaque stable ids`, r`Do not leak the schema`],
  ex: r`The team split the {{Customer}} table in two internally with no public API change because the contract had been DTO-based.`,
  fu: [r`How do you test that a refactor did not change the contract?`],
  pit: [r`Auto-generating the API from the database schema.`] },

{ id: 'q46', level: 'Principal', tags: ['leadership'],
  code: r`~~~text
Contract disagreement worksheet (both teams fill it, then decide)
Option A (producer): GET /customers/{id} returns full profile
Option B (consumer): GET /customers/{id}/summary returns 6 fields
Criteria: consumer latency budget, data exposure (PII), producer change cost, other consumers affected
Decision rule agreed upfront: consumer needs win on shape; producer owns semantics and naming
Record as ADR, add a contract test so the agreement is executable
~~~`,
  q: r`How do you resolve a disagreement between two teams about an API contract?`,
  a: r`1. **Separate positions from needs**: ask each team for the use cases, volumes, latency and failure scenarios behind their position.
2. **Make the trade-off concrete**: write both options as short examples (request/response, sequence), estimate effort, run a one-day spike if facts are missing, and compare against agreed criteria (consumer simplicity, evolvability, performance, security, cost).
3. **Decide who decides**: the provider owns the contract, but consumers must be heard; if they deadlock, escalate to an architecture forum with a one-page ADR, time-boxed.
4. **Record the decision** with reasons and the conditions that would reopen it.
5. **Disagree and commit**: align on the outcome, track an agreed metric, and schedule a review.

Keep it about the customer's outcome and the system, not about team status.`,
  pts: [r`Needs over positions`, r`Concrete examples and a spike`, r`ADR and revisit trigger`],
  ex: r`A one-day spike showed the "simple" bulk endpoint failed at 10,000 items; the teams agreed on an async job design.`,
  fu: [r`When do you override a team's preference?`],
  pit: [r`Deciding by seniority.`] },

{ id: 'q47', level: 'Principal', tags: ['limits'],
  code: r`~~~text
Need                                   HTTP/REST alone?   Use instead / add
Push to client in real time            no                 WebSockets / SSE / SignalR
Many consumers react to one change     no                 events (Kafka, EventBridge) + AsyncAPI
Atomic change across services          no                 saga + outbox
Very high-throughput internal RPC      weak               gRPC (HTTP/2, protobuf)
Flexible client-driven queries         weak               GraphQL or a search API
Guaranteed delivery when offline       no                 queue / durable messaging
~~~`,
  q: r`What can a REST/HTTP API design not give you, and where do you need something else?`,
  a: r`Be honest about limits:

- **No transactions across calls**: multi-step business operations need sagas, idempotency and compensations.
- **No exactly-once**: only at-least-once plus idempotency.
- **No ordering or delivery guarantees** for webhooks and async effects.
- **Not ideal for streams, bidirectional or very chatty low-latency calls**: use WebSocket/SSE/gRPC streaming.
- **Hypermedia and discoverability rarely exploited**, so contracts are still out-of-band.
- **Caching and consistency are in tension**: stale reads are a feature of the model.
- **Authorisation is not provided by the protocol**; it is easy to get wrong.
- **Silent failures** (a 200 with a wrong value) have no detector except business reconciliation and monitoring.

Naming these limits shows judgement about when to reach for events, streaming or a different protocol.`,
  pts: [r`No cross-call transactions`, r`No exactly-once`, r`Silent wrongness needs business monitors`],
  ex: r`A checkout needing payment, stock and shipping used a saga with idempotent REST calls instead of pretending a single request is atomic.`,
  fu: [r`Which signals tell you REST is the wrong fit?`],
  pit: [r`Promising atomicity across several HTTP calls.`] },

{ id: 'q48', level: 'Principal', tags: ['synthesis'],
  code: r`~~~http
Senior: POST /transfers -> 201
Principal adds: Idempotency-Key, 202 + operation resource when the rail is async, explicit error taxonomy (problem+json types),
                consistency semantics (when is the balance updated?), versioning and deprecation policy, SLOs, abuse limits.
POST /transfers
Idempotency-Key: 3f0c...
-> 202 Accepted  Location: /transfers/tr-9  { "status": "pending", "expectedSettlement": "2026-10-10T16:00:00Z" }
~~~`,
  q: r`What separates a Principal-level API design answer from a Senior one?`,
  a: r`A senior engineer designs clean resources, picks the right verbs and status codes, and documents with OpenAPI.

A principal engineer additionally:

1. **Designs for retries and partial failure**: idempotency keys, unknown outcomes, async resources, webhooks with signatures.
2. **Treats the contract as a long-term liability**: additive evolution, tolerant readers, deprecation telemetry, consumer-driven tests.
3. **Builds security structurally**: deny-by-default, object-level authorisation in the platform, not per endpoint.
4. **Thinks in tail latency, cost and operations**: p99, load shedding, observability spend, support burden.
5. **Scales the practice**: standards as code, paved road, tiered review.
6. **States limits** (no cross-call atomicity) and picks the right tool per interaction (REST, gRPC, events).

The discriminating question: "a client times out on POST /payments and retries; what happens?" Senior: "return 409 if duplicate". Principal: "the idempotency key makes the retry return the original result; an unknown processor outcome is resolved by status query and reconciliation, and the client is told the payment is pending, never failed".`,
  pts: [r`Retry safety, evolution, structural security, operations`, r`Name the limits`],
  ex: r`Use the timeout-and-retry payment scenario to close an API-design interview answer.`,
  fu: [r`Which of these would you institutionalise first?`],
  pit: [r`Perfect resource naming with no failure model.`] },

{ id: 'q49', level: 'Principal', tags: ['bulk', 'payments', 'async'],
  code: r`~~~http
POST /payment-batches          Content-Type: application/json   Idempotency-Key: batch-2026-10-10-001
{ "fileName": "payroll-oct.json", "itemCount": 50000, "uploadUrl": true }
-> 201 { "batchId": "b-77", "uploadUrl": "https://files.../b-77?sig=...", "status": "awaiting_file" }
PUT  <uploadUrl>               (file goes to object storage, not through the API)
GET  /payment-batches/b-77     -> { "status": "validated", "valid": 49870, "invalid": 130, "errorsUrl": "/payment-batches/b-77/errors" }
POST /payment-batches/b-77/approve   (four-eyes: different user than the submitter)
GET  /payment-batches/b-77/items?status=failed&cursor=...
~~~`,
  dia: r`flowchart LR
  C[Corporate client] -->|1 create batch| API[Batch API]
  C -->|2 upload file| S3[(Object storage)]
  S3 -->|event| V[Validator workers]
  V -->|per-item results| DB[(Batch DB)]
  C -->|3 approve, 4-eyes| API
  API --> Q[(Queue)] --> E[Payment executors] --> RAIL[Payment rail]
  E --> DB
  RAIL -->|status files| R[Reconciliation] --> DB`,
  q: r`Design an API for corporate clients to submit a bulk payment file (50,000 payments). Cover validation, partial failure, idempotency and status.`,
  a: r`### Resources
- {{POST /payment-batches}} with {{Idempotency-Key}}: returns **201** with a batch id and a pre-signed upload URL (or accepts the file directly up to a size limit). Large files go straight to object storage, not through the API process.
- {{POST /payment-batches/{id}/submit}}: starts processing → **202** with {{Location}} to the status resource.
- {{GET /payment-batches/{id} }}: {{status: received | validating | rejected | awaiting_approval | processing | completed | completed_with_errors}}, counts (accepted, rejected, settled, failed), checksum, totals per currency.
- {{GET /payment-batches/{id}/items?status=rejected&cursor=...}}: per-item results with stable error codes.
- Webhooks: {{batch.validated}}, {{batch.completed}}, {{payment.failed}}.

### Processing rules
1. **File-level validation** first (format, checksum, control totals, duplicate file detection by hash + client reference). A wrong control total rejects the whole file: banks expect this.
2. **Item-level validation** (account formats such as IBAN check digits, sanctions screening, limits) produces per-item rejects without blocking valid items, if the client's policy allows partial acceptance (make it an explicit option: {{all_or_nothing}} vs {{partial}}).
3. **Approval workflow** (maker-checker) for corporate banking before release.
4. **Idempotency per item**: each payment carries a client end-to-end reference that is unique per client; resubmitted files do not double-pay.
5. Execution via queue with throttling per rail (SEPA, ACH, Faster Payments); final status from rail confirmations and reconciliation.

### Non-functional
Size limits, malware scan, encryption at rest, audit trail of who uploaded and who approved, retention, and downloadable result report.`,
  pts: [r`Upload to object storage, process asynchronously`, r`File-level vs item-level validation`, r`Explicit partial vs all-or-nothing policy`, r`Per-item idempotency via client reference`, r`Maker-checker and audit`],
  ex: r`A treasury client re-uploaded the same payroll file after a timeout; duplicate-file detection on hash plus client reference rejected it before any payment executed.`,
  fu: [r`How would you support cancellation of a batch already partially executed?`, r`How do you report results back in the client's own format (ISO 20022 pain.002)?`],
  pit: [r`Processing the file synchronously in the upload request.`, r`One idempotency key for the whole file but none per payment.`],
  tip: r`Mentioning control totals, maker-checker and per-item references signals real banking experience.` },

{ id: 'q50', level: 'Principal', tags: ['authorization', 'security'],
  code: r`~~~csharp
// Coarse checks at the gateway (scopes); fine-grained decisions in the service via a policy engine
app.MapPost("/accounts/{id}/payments", async (string id, PaymentReq req, IAuthorizationService authz, ClaimsPrincipal u) =>
{
    var decision = await authz.AuthorizeAsync(u, new PaymentResource(id, req.Amount), "can-pay");  // RBAC role + ABAC limits + ReBAC "is signatory of"
    return decision.Succeeded ? Results.Accepted() : Results.Forbid();
});
// ReBAC check delegated to OpenFGA / SpiceDB: check(user:asha, signatory, account:42)
~~~`,
  dia: r`flowchart LR
  C[Client] --> GW[Gateway: token valid, scopes]
  GW --> S[Payments service PEP]
  S -->|check| PDP[Policy decision point: OPA / OpenFGA]
  PDP --> REL[(Relationships: user signatory of account)]
  PDP --> ATTR[(Attributes: limits, risk, time)]
  S --> DB[(Payments)]`,
  q: r`Design the authorisation model for an API platform: RBAC, ABAC or relationship-based (ReBAC)? Where is the decision enforced?`,
  a: r`### Models
| Model | Decision based on | Good for | Weakness |
|---|---|---|---|
| **RBAC** | Roles (Admin, Approver) | Coarse permissions, simple orgs | Role explosion; no ownership |
| **ABAC** | Attributes of user, resource, context (region, amount, time) | Limits, data residency, risk rules | Policies get complex; harder to audit |
| **ReBAC** | Relationships (user is member of org that owns account) | Multi-tenant SaaS, sharing, hierarchies | Needs a relationship store (Zanzibar-style: OpenFGA, SpiceDB) |

Real platforms combine them: RBAC for capabilities ({{payments:approve}}), ReBAC for "which objects" (accounts the user's organisation owns), ABAC for conditions (amount above 10,000 requires a second approver; data must stay in the EU).

### Enforcement architecture
- **Gateway**: authenticate, check coarse scopes.
- **Service**: object-level decisions with a **policy decision point** (in-process library or OPA/Cedar/OpenFGA sidecar) and the service as **policy enforcement point**; filter queries, not just single fetches (list endpoints must only return permitted objects).
- **Policy as code**: versioned, reviewed, unit-tested, with decision logs for audit.
- **Deny by default** and fail closed if the policy engine is unavailable (with caching to keep latency low).

### Trade-offs
Externalised policy gives consistency and auditability across 40 services, at the cost of latency, a new critical dependency, and data synchronisation for relationships.`,
  pts: [r`Combine RBAC, ReBAC, ABAC`, r`Object-level decisions in the service`, r`Filter list queries by permission`, r`Policy as code with decision logs`, r`Fail closed`],
  ex: r`A corporate banking API used roles for capabilities, OpenFGA for organisation-to-account relationships, and ABAC rules for dual approval above a threshold; auditors received decision logs per approval.`,
  fu: [r`How do you make list endpoints efficient with ReBAC?`, r`What happens to authorisation when the policy engine is down?`],
  pit: [r`Role checks only, no object ownership checks (BOLA).`, r`Authorising single fetches but not list/search endpoints.`] }
],
cheat: r`### Methods
GET/HEAD/OPTIONS safe+idempotent · PUT/DELETE idempotent · POST not idempotent (use {{Idempotency-Key}}) · PATCH merge-patch or JSON Patch.

### Status codes
201+Location · 202 async · 204 · 304 · 400 · 401 vs 403 · 404 · 409 conflict · 412 precondition · 422 semantic · 429+Retry-After · 5xx ours.

### Design
| Concern | Rule |
|---|---|
| URIs | Plural nouns, shallow nesting, actions as sub-resources |
| Paging | Keyset with opaque cursor, capped size, unique tiebreaker |
| Errors | RFC 9457 problem+json, stable code, traceId |
| Concurrency | ETag + If-Match, 412 |
| Caching | ETag/304, Cache-Control, Vary, private vs public |
| Money / time | Minor units or string + ISO 4217; ISO 8601 UTC |
| Async | 202 + status resource + webhook |
| Versioning | Additive first; sunset policy; open enums |

### Security
TLS · OAuth2 tokens · object-level authorisation (BOLA) · DTOs against mass assignment · rate limits · CORS explicit · no PII in URLs/logs · SSRF guards for webhooks.

### Choose protocol
REST external · gRPC internal · GraphQL as BFF · events/webhooks for async fan-out.

### Say this
"Idempotency key stored atomically with the write." "Tolerant reader and open enums." "Fail closed on authorisation." "Load shedding beats unbounded queues."`
});
})(String.raw);
