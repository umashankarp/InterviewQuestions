# Module 15 — REST APIs: Design Fundamentals, HTTP Semantics & Versioning

> Domain: REST APIs | Level: Beginner → Expert | Prerequisite: [[../02-DotNet-AspNetCore/03-MinimalAPIs-vs-Controllers-ModelBinding]] (DTOs, mass-assignment), [[../02-DotNet-AspNetCore/04-Authentication-Authorization-Deep-Dive]]

---

## 1. Topic Description

### Definition

REST is an architectural style in which state is exposed as **resources** identified by URIs, manipulated through **representations**, using HTTP's uniform interface — where the method carries the semantics (safe, idempotent, cacheable), the status code carries the outcome, and headers carry metadata such as caching directives, concurrency tokens and content negotiation. In practice, "REST design" at senior level is less about conformance to Fielding's constraints and more about designing a **contract that survives** — one whose clients can retry safely, page consistently, handle errors programmatically, and keep working when the provider changes.

### Core sub-concepts

- **Resource modelling** — nouns over verbs, sub-resources, and how to model genuinely action-shaped operations (`approve`, `cancel`, `retry`).
- **HTTP method semantics** — safe versus idempotent versus cacheable; why `PUT`/`DELETE` are idempotent and `POST` is not.
- **Status code selection** — 201 with `Location`, 202 for async, 400 versus 422, 401 versus 403, 409, 412/428, 429 with `Retry-After`.
- **Idempotency keys** — making non-idempotent operations retry-safe; storage, retention, and the concurrent-duplicate case.
- **Conditional requests and optimistic concurrency** — `ETag`, `If-Match`, `If-None-Match`, 412, and last-write-wins as the alternative.
- **Pagination** — offset versus cursor/keyset; stability under concurrent writes; server-enforced maximum page size.
- **Versioning strategies** — URI path, header, media type; operability versus purity; contract-versus-implementation versioning.
- **Breaking versus non-breaking change** — the classification, including the enum-addition trap and client tolerance rules.
- **Error contract design** — machine-readable code, safe human message, correlation ID, field-level validation lists, `ProblemDetails`.
- **PUT versus PATCH** — full replacement versus partial modification, and specifying a patch format.
- **Async and long-running operations** — 202 plus a status resource, webhooks, and status-record retention.
- **Bulk operations** — all-or-nothing versus per-item outcomes, batch bounds, and client-supplied item references.
- **Caching and content negotiation** — `Cache-Control`, `Vary`, and private-versus-shared responses.
- **Wire-format conventions for time and money** — ISO-8601 with offsets; minor units or decimal strings with an explicit currency.
- **HATEOAS** — what it promises, why it is rarely adopted, and the state-dependent-actions subset that is genuinely useful.

### Where it fits

The REST contract is the integration surface between a service and everything that consumes it — SPAs, mobile clients, partner systems, and other services. Below it sit the framework's routing, binding and serialisation; above it sit clients whose code you cannot change on your schedule. That asymmetry is the whole point: an internal implementation can be rewritten in a sprint, while a published contract with many consumers takes years to change, so contract decisions deserve disproportionate design effort.

### Why it matters at scale

Every distributed client retries, so an API without an idempotency mechanism *will* produce duplicate orders and double charges — not as an edge case but as normal operation under packet loss. Offset pagination over a mutating dataset silently gives clients duplicated and missing rows, corrupting any consumer doing reconciliation. An unbounded list endpoint is a denial-of-service primitive requiring no attacker skill. And a contract coupled to internal entities means every domain refactor becomes a coordinated multi-team migration, which is how organisations end up unable to change code they own.

### Common pitfalls / anti-patterns

- **Returning 200 with an error body** — clients cannot branch on status, so every consumer must parse the body to know whether the call worked, and infrastructure-level error metrics become meaningless.
- **No idempotency mechanism on state-changing operations** — an ambiguous timeout leaves the client choosing between a duplicate and a lost operation, and duplicates reach production immediately.
- **Offset pagination over an actively-written collection** — inserts and deletes shift rows between requests, so a client walking pages sees some rows twice and misses others entirely.
- **Unbounded list endpoints** — the client controls how much work the server does; one request can exhaust memory or saturate the database.
- **`DELETE` that returns 404 on a repeat call** — breaks idempotency in practice, because a retrying client interprets the 404 as failure rather than as "already done".
- **`NOT`-versioned breaking changes shipped as additive** — adding a required field, tightening validation, or changing an enum's meaning breaks clients while looking like a minor change in the diff.
- **Serialising domain entities as the response type** — every internal rename is an external break, and every field added to the entity is exposed by default.
- **Money as a JSON floating-point number** — binary floats cannot represent decimal fractions exactly, so rounding errors accumulate in a financial contract.

> Scope note: authentication, authorization, rate-limiting enforcement and transport security belong to `02-API-Security-Rate-Limiting`; OpenAPI, SDK generation and contract testing to `03-API-Documentation-Contract-Testing`. Framework-level model binding and endpoint style live in `02-DotNet-AspNetCore/03-MinimalAPIs-vs-Controllers-ModelBinding`.

---

## 2. Beginner (10 Q&A)


**Q1. What does it mean for a method to be safe versus idempotent, and why does the distinction matter operationally?**
**A:** Safe means it does not change state — `GET`, `HEAD`, `OPTIONS` — so intermediaries may cache and prefetch it freely. Idempotent means repeating it produces the same end state as doing it once, which is true of `PUT` and `DELETE` but not `POST`. It matters because retries are unavoidable: a client that times out does not know whether the server acted, so for idempotent operations a retry is safe, and for `POST` it is a potential duplicate. Every distributed system retries, so an API that ignores this distinction will produce duplicate records in production.
*Follow-up: `DELETE` on an already-deleted resource — 404 or 204? Justify your answer.*

**Q2. Walk me through choosing between 400, 401, 403, 404, 409 and 422.**
**A:** 400 for a malformed request the server cannot parse or that violates the syntactic contract; 401 for missing or invalid authentication with a challenge; 403 for authenticated but not permitted; 404 for a resource that does not exist *or* that the caller may not know exists; 409 for a conflict with current state, such as a concurrency or uniqueness violation; 422 for a syntactically valid request that fails a semantic or business rule. The distinctions matter because clients branch on them — conflating 400 and 422 stops a client distinguishing "fix your code" from "fix your data," and conflating 401 and 403 causes infinite re-authentication loops.
*Follow-up: When would you deliberately return 404 instead of 403, and what's the trade-off?*

**Q3. How should a `POST` that creates a resource respond?**
**A:** 201 Created with a `Location` header pointing at the new resource, and usually the created representation in the body so the client does not need a second round trip. Returning 200 with just an ID works but loses the standard semantics that clients and tooling understand. If creation is asynchronous, 202 Accepted with a status resource is the honest answer — returning 201 for something that has not been created yet means clients will immediately `GET` a URL that 404s.
*Follow-up: The resource is created asynchronously and may fail. What does the client's flow look like?*

**Q4. Explain optimistic concurrency with ETags.**
**A:** The server returns an `ETag` representing the resource's current version; the client sends it back on an update as `If-Match`. If the resource has changed since, the ETag no longer matches and the server responds 412 Precondition Failed, so the client knows to re-read and retry rather than blindly overwriting. Without it you have last-write-wins, where two concurrent edits silently discard one — a data-loss bug that is invisible in testing and common in production. Requiring `If-Match` on updates, and returning 428 when it is absent, makes the protection mandatory rather than optional.
*Follow-up: What do you use as the ETag value, and what's wrong with hashing the whole representation?*

**Q5. Offset versus cursor pagination — what's the actual difference in behaviour?**
**A:** Offset pagination (`?page=3&size=50`) is simple and allows jumping to a page, but it is computed against the dataset at query time: if rows are inserted or deleted between requests, items shift, so a client walking pages sees duplicates and misses others. It also degrades on large offsets because the database must skip rows. Cursor pagination passes an opaque marker representing the last item's position, so results are stable under concurrent writes and performance is constant. For anything mutating or large, cursor is the correct choice; offset is acceptable for small, static datasets where random page access matters.
*Follow-up: A client needs "jump to page 50." How do you support that with cursors, or do you refuse?*

**Q6. What is an idempotency key and when do you need one?**
**A:** A client-generated unique value sent with a non-idempotent request — conventionally in an `Idempotency-Key` header — that the server records with the result. A retry with the same key returns the original outcome instead of performing the operation again. You need it whenever the operation has real-world side effects that must not be duplicated: payments, orders, notifications, anything charging money or sending something. Without it, an ambiguous timeout leaves the client with only bad options: retry and risk a duplicate, or do not retry and risk losing the operation.
*Follow-up: How long do you retain idempotency keys, and what happens when the same key arrives with a different body?*

**Q7. What are the main versioning strategies and their trade-offs?**
**A:** URI path versioning (`/v2/orders`) is explicit, cache-friendly and trivially visible in logs and routing, at the cost of being unRESTful in purist terms and duplicating URLs for unchanged resources. Header or media-type versioning keeps URIs stable and is more elegant, but is invisible in logs and browser testing and easy for clients to get wrong. Query-parameter versioning is easy but interacts badly with caching. In practice URI versioning wins on operability for most organisations — you can route, log, monitor and deprecate by version trivially — and operability usually matters more than purity.
*Follow-up: How do you avoid duplicating the entire API surface when only one endpoint changes?*

**Q8. What makes a change breaking, and what does not?**
**A:** Breaking: removing or renaming a field, changing a type, making an optional field required, adding a required request field, tightening validation, changing status codes for existing conditions, or changing the meaning of an existing value. Non-breaking: adding an optional request field, adding a response field (if clients tolerate unknown fields), adding a new endpoint, or adding a new enum value *if* clients were told to handle unknowns. The last one is the trap: adding an enum value breaks any client that switches exhaustively, which is why the tolerance rules must be documented from day one rather than assumed.
*Follow-up: You must remove a field that a client still uses. What's the process?*

**Q9. What should an error response contain?**
**A:** A machine-readable code the client can branch on, a human-readable message for developers, a correlation ID for support, and — for validation failures — a structured list of field-level problems rather than only the first. `ProblemDetails` gives a standard shape worth adopting so clients learn it once. What it must not contain is stack traces, internal type names, SQL, or anything revealing internal structure, both because it is an information-disclosure risk and because clients will start depending on it. The message is for humans; the code is the contract.
*Follow-up: How do you version error codes as the API evolves?*

**Q10. When is `PUT` the right choice versus `PATCH`?**
**A:** `PUT` replaces the resource entirely with the supplied representation, which makes it idempotent and simple, but requires the client to send the whole object and risks wiping fields it did not know about. `PATCH` applies a partial modification, which is more efficient and avoids clobbering, but is not inherently idempotent and needs a defined patch format — JSON Patch or JSON Merge Patch — because "send the fields you want to change" leaves absent-versus-null ambiguous. For most APIs I would offer `PUT` for full replacement and a well-specified `PATCH` where partial updates are genuinely needed, rather than an ad hoc partial `PUT`.
*Follow-up: How do you make `PATCH` idempotent, and does it need to be?*

---

## 3. Intermediate (10 Q&A)


**Q1. A client reports duplicate orders after a network blip. Walk me through the diagnosis and the fix.**
**A:** The client timed out, did not know whether the `POST` succeeded, and retried — and since `POST` is not idempotent, the server created a second order. This is a design gap rather than a bug: any API without an idempotency mechanism will produce duplicates under real network conditions. The fix is an idempotency key stored with the request outcome, so a repeat returns the original result; the subtleties are choosing the storage with the right durability, deciding the retention window, and handling the concurrent case where the retry arrives while the first request is still in flight, which needs a lock or a uniqueness constraint rather than a read-then-write.
*Follow-up: Two identical requests arrive simultaneously with the same key. What exactly happens?*

**Q2. How would you design pagination for an endpoint over a large, actively-written dataset?**
**A:** Cursor-based, with the cursor encoding a stable sort key — typically an indexed monotonic column plus a tiebreaker for uniqueness — so results are consistent under concurrent inserts and the database can seek rather than skip. I would make the cursor opaque so its encoding can change without breaking clients, enforce a maximum page size server-side regardless of what is requested, and always return a next-cursor rather than requiring clients to construct one. I would also decide explicitly what "consistent" means: a cursor walk gives a stable-ish view but is not a snapshot, and clients doing reconciliation need to know that.
*Follow-up: A client needs a genuine point-in-time snapshot of a million rows. What do you offer instead?*

**Q3. How do you model an operation that isn't naturally a resource — "approve", "cancel", "retry"?**
**A:** Either as a sub-resource representing the *outcome* (`POST /orders/{id}/cancellation`) or as a state transition via `PATCH` on a status field, depending on whether the action has its own attributes and history. I would resist contorting a genuinely action-shaped operation into a pure resource model, because the result is worse for consumers than a pragmatic action endpoint. The considerations that actually matter are idempotency, whether the action is auditable and therefore deserves its own record, and whether the transition can be expressed such that a retry is safe. Purity is worth much less than a client being able to safely retry a cancellation.
*Follow-up: "Approve" must be recorded with who and when. Does that change your modelling?*

**Q4. How would you handle an operation that takes minutes to complete?**
**A:** Return 202 Accepted immediately with a `Location` pointing at a status resource, do the work asynchronously, and let the client poll or receive a webhook. Holding a connection for minutes breaks under load-balancer idle timeouts, wastes a request slot, and leaves the client with no recovery path if the connection drops. The status resource should expose progress, a terminal outcome, and a link to the result — and it needs a retention policy so status records do not accumulate forever. If clients object to polling, webhooks or server-sent events are the alternative, each with their own delivery-guarantee complexity.
*Follow-up: The client can't accept webhooks and polling is too chatty. What else can you offer?*

**Q5. How do you version an API in practice without doubling your maintenance burden?**
**A:** By versioning the *contract*, not the implementation: one internal model with mapping layers per supported version, so v1 and v2 are two projections rather than two codebases. Support a small number of versions with a published deprecation policy and actual telemetry on who uses what, because the maintenance burden comes from versions you cannot retire, not from versions you support. I would also avoid versioning where an additive change suffices, since most changes teams think require a new version do not. The organisational half is having an owner empowered to sunset a version, otherwise you accumulate them permanently.
*Follow-up: One large client refuses to migrate off v1. How do you handle it?*

**Q6. What's your approach to designing a bulk endpoint?**
**A:** Decide the failure semantics first, since that is the whole design: all-or-nothing (transactional, simple for clients, but one bad item fails everything) or per-item outcomes (a 207-style response with a result per item, more complex but usually what clients actually need). Then bound it: a maximum batch size, its own rate limit, and its own idempotency treatment — a retried batch must not partially reapply. I would also make sure the response identifies items by a client-supplied reference rather than by index, because index-based correlation breaks the moment anything reorders. Bulk endpoints are where partial-failure handling gets skipped and then discovered in production.
*Follow-up: A batch of 1,000 has 3 failures. What exactly does the client receive, and what should it do?*

**Q7. How do you decide response shape — nesting, expansion and field selection?**
**A:** Default to a shape that serves the common case in one round trip without being enormous, then offer explicit expansion (`?expand=customer`) for related data rather than either always including it or forcing N+1 calls. Sparse fieldsets (`?fields=`) help large representations but add caching and testing complexity, so I would add them when there is evidence of need. What I would avoid is a response whose shape depends on the caller in undocumented ways, because that makes the contract untestable. The underlying principle is that the API should not force clients into chatty patterns, and should not ship kilobytes nobody reads.
*Follow-up: Expansion lets a client request three levels of nesting. What's the risk and how do you bound it?*

**Q8. How should an API behave under overload?**
**A:** Reject quickly and honestly: 429 with `Retry-After` for rate limiting and 503 for capacity, rather than queuing and timing out — a fast rejection lets clients back off, while a slow timeout consumes resources on both sides and triggers retry storms. The contract should document the limits, the headers that expose remaining quota, and the expected backoff behaviour, because a client that does not know the rules will hammer you. I would also differentiate limits by cost, since a cheap read and an expensive report should not share one budget.
*Follow-up: Clients ignore `Retry-After` and retry immediately. What do you do?*

**Q9. What does "consumer-first" API design mean in practice?**
**A:** Designing from the client's use cases and writing the client code first, before the implementation — which surfaces awkwardness immediately, such as needing four calls to render one screen. It also means naming things in the domain language consumers use rather than the internal one, and being willing to shape endpoints around workflows rather than around your database. The failure it prevents is an API that is a thin projection of internal tables, which is convenient to build and expensive for every consumer forever. The practical technique is a design review with an actual consumer team before implementation, not after.
*Follow-up: The consumer wants an endpoint that's awkward for your data model. How do you decide?*

**Q10. How do you handle time and money in an API contract?**
**A:** Time as ISO-8601 with explicit offsets, always UTC on the wire, never a naive local timestamp — and be precise about whether a field is an instant or a calendar date, because those need different types and different handling. Money as a minor-unit integer or a string decimal plus an explicit currency code, never a floating-point number, because binary floats cannot represent decimal fractions exactly and the errors accumulate. These sound like details and are actually among the most common sources of real financial defects, which is why they belong in a shared contract convention rather than being decided per endpoint.
*Follow-up: A client sends an amount as a JSON number and it's 0.1 + 0.2. What breaks and where?*

---

## 4. Expert / Architect (10 Q&A)


**Q1. How do you govern API design across an organisation without becoming a bottleneck?**
**A:** Encode the standard rather than reviewing every case: a written style guide backed by an automated linter on the OpenAPI document in CI, checking naming, status codes, pagination, error shapes and versioning. Provide templates and a shared library implementing the conventions so the default path is compliant. Reserve human review for genuinely new patterns and for public-facing APIs, and make the review a design conversation early rather than an approval gate late. The governance failure I would design against is a central body reviewing everything, which becomes a queue and gets routed around; the linter scales and the humans focus on judgement.
*Follow-up: A team's API passes the linter but is badly designed. What does that tell you about your standard?*

**Q2. Public API versus internal API — what genuinely changes?**
**A:** The cost of change and therefore the required rigour. A public API's contract must be treated as immutable in practice, with long deprecation windows, formal versioning, published SLAs, and defensive design against clients you cannot contact. An internal API with a known set of consumers can evolve much faster with coordinated changes, and over-engineering it with public-API ceremony wastes real time. The mistake in both directions is common: teams ship internal APIs to external partners without hardening, and apply public-API process to an internal endpoint with one consumer. I would classify each API explicitly and attach the appropriate process to the classification.
*Follow-up: An internal API acquires an external consumer without anyone noticing. How do you prevent that?*

**Q3. How would you plan a breaking change across an API with many unknown consumers?**
**A:** Start from measurement, because you cannot plan a migration you cannot observe: instrument usage per field and per client so you know who is actually affected rather than guessing. Then run both versions in parallel with a published timeline, communicate through every channel you have, add deprecation headers so client tooling surfaces the warning, and consider a temporary shim that translates old requests to the new behaviour. Brownout testing — briefly disabling the old version during announced windows — is effective at flushing out consumers who ignored every notice. The organisational reality is that a deprecation without an owner and a date never completes, so both must be assigned at the start.
*Follow-up: On cutover day 5% of traffic is still on v1 from unidentified clients. What do you do?*

**Q4. When is REST the wrong choice, and what would you use instead?**
**A:** For high-volume internal service-to-service calls where latency and payload size matter, gRPC's binary protocol and streaming are materially better and the contract is enforced by generated code. For clients that need flexible, aggregated reads across many resources — typically rich UIs — GraphQL removes over-fetching and round trips at the cost of caching complexity, unbounded query cost and a harder security model. For event distribution, neither: that is messaging. REST remains right for public, cacheable, broadly-consumable APIs where ubiquity and tooling matter most. I would choose per boundary rather than organisation-wide, while being conscious that each additional style is a permanent operational and skills cost.
*Follow-up: A team proposes GraphQL for a public API. What are your specific concerns?*

**Q5. How does API design interact with multi-tenancy and data isolation?**
**A:** The tenant must never be a client-supplied parameter — it comes from the authenticated principal, because any design where a client can name the tenant is one missing check away from cross-tenant access. Resource identifiers should be non-sequential and non-guessable so enumeration is not trivially possible, though that is defence in depth rather than a control. Rate limits and quotas need to be per tenant so one tenant cannot exhaust shared capacity, and error messages must not confirm the existence of another tenant's resources, which is why 404 is often the right response to an unauthorised access attempt. These are contract-level decisions, not implementation details.
*Follow-up: A partner integration genuinely needs to act across tenants. How do you model that?*

**Q6. How would you approach the caching design for a read-heavy public API?**
**A:** Make cacheability an explicit design property: correct `Cache-Control` directives per resource class, `ETag`s for conditional requests so unchanged resources cost a 304 rather than a full payload, and `Vary` set correctly so caches do not serve one caller's response to another — which is the mechanism behind real cross-user data leaks through CDNs. Personalised responses must be marked private or not cached at all. I would push aggressively for caching at the edge for genuinely shared resources, since it removes load and latency simultaneously, and be equally aggressive about excluding anything user-specific, since a caching bug there is a security incident rather than a performance one.
*Follow-up: A response varies by a header you forgot to declare in `Vary`. What's the worst outcome?*

**Q7. What's your position on HATEOAS?**
**A:** Theoretically appealing and rarely worth the cost. The premise is that clients discover capabilities from links rather than hardcoding URLs, which would decouple client and server — but in practice clients hardcode anyway, generated SDKs do not use the links, and the added payload and complexity buy nothing measurable. Where it does earn its place is workflow-heavy APIs where the available *actions* legitimately vary by state, since returning the permitted transitions is genuinely useful and hard to express otherwise. My position is to include state-dependent action links where they carry real information, and to skip the full hypermedia model, which almost no consumer will exploit.
*Follow-up: How would you convey "this order can now be cancelled but not amended" without full HATEOAS?*

**Q8. How do you design an API that must be operable during partial failures of its own dependencies?**
**A:** By deciding, per endpoint, what a degraded but useful response looks like and encoding that in the contract — returning core data with a documented indication that an enrichment is unavailable is far better than a 500, and it must be part of the contract so clients handle it rather than being surprised. That requires distinguishing essential from non-essential dependencies at design time, applying timeouts and circuit breakers so a slow dependency cannot consume the request budget, and making sure the client can tell the difference between "no data" and "data unavailable" — a distinction that is frequently lost and causes clients to cache emptiness. I would also make sure retry guidance is explicit in the response, since clients otherwise invent their own.
*Follow-up: An enrichment service is down. Do you return 200 with partial data or 503? Justify.*

**Q9. How do you decide the granularity of API resources in a microservices architecture?**
**A:** Resource granularity should follow the consumer's needs and the service boundary, not the database schema — exposing one resource per table forces clients into chatty orchestration and leaks your internal model. Where a consumer genuinely needs a composite view spanning services, that aggregation belongs in a purpose-built layer (a BFF or an aggregation service) rather than in each client or in a service reaching across a boundary. The tension to manage is that aggregation layers accumulate logic and become a coupling point of their own, so I would keep them thin and client-specific rather than building one universal aggregator that every team must change.
*Follow-up: Three client teams want three different aggregations. One BFF or three?*

**Q10. What do you look at first to judge whether an API will age well?**
**A:** Whether the contract is separable from the implementation — if the response types are the domain entities, the API will break every time the model changes, and that single fact predicts most future pain. Then: is there a versioning and deprecation policy with an owner; are errors machine-readable and consistent; is pagination bounded and stable; is there an idempotency story for state-changing operations; and can the team enumerate their consumers. An API that scores well on those can evolve for years; one that does not will accumulate compatibility shims until nobody dares change it. I would raise these at design time, because retrofitting them after a hundred consumers exist is a multi-year programme rather than a refactor.
*Follow-up: You inherit an API failing most of those tests with 200 consumers. What's your first move?*

---

## 5. Reference Material

> Retained from the original module: deep-dive internals, diagrams, production examples, exercises, system/low-level design, debugging walkthroughs and the Principal Engineer perspective.

### 1. Fundamentals
**REST** (Representational State Transfer, Roy Fielding's 2000 dissertation) is an architectural style for networked systems built on: resources identified by URIs, a uniform interface (standard HTTP methods with well-defined semantics), statelessness (each request contains everything needed to process it — no server-side session dependency), and representations (JSON/XML) transferred between client and server. It exists because ad-hoc, RPC-style HTTP APIs (endpoints named like remote procedure calls — `/getUser`, `/updateUserStatus`) don't leverage HTTP's own built-in semantics (caching, idempotency, status codes), forcing every client to learn bespoke, inconsistent conventions per API. REST's uniform interface lets HTTP infrastructure (caches, proxies, load balancers) and generic client tooling work correctly without API-specific knowledge.

### 2. Deep Dive

#### 2.1 HTTP Method Semantics — Precisely
- **GET**: safe (no side effects) and idempotent (repeating it produces the same result) — must never be used for state-changing operations; caches/proxies/prefetchers may call it speculatively, so a GET with side effects is a genuine correctness/security hazard.
- **POST**: neither safe nor idempotent by default — creates a new resource or triggers a non-idempotent action; calling it twice may create two resources.
- **PUT**: idempotent (calling it N times with the same body produces the same end state as calling it once) — a full **replacement** of the resource at the given URI.
- **PATCH**: partial update — idempotency is **not guaranteed** by the method itself and depends on the patch semantics used (a JSON Merge Patch replacing specific fields is typically idempotent; a JSON Patch `"op": "add"` to an array is not).
- **DELETE**: idempotent — deleting an already-deleted resource should return the same successful outcome (or a 404, per API convention), not an error indicating "delete failed."

#### 2.2 Idempotency — the Precise Definition and Why It Matters for Reliability
Idempotency means **the same request, executed multiple times, produces the same end state as executing it once** — this is the single most important property for building **reliable retry logic** (the retry-with-backoff patterns) on top of an unreliable network: a client that times out waiting for a response to a PUT/DELETE genuinely doesn't know if the request succeeded — safely retrying requires the operation to be idempotent, or the retry could cause an unintended duplicate side effect. For genuinely non-idempotent operations that must tolerate retries (POST creating a payment), the standard solution is an explicit **idempotency key** (a client-generated unique ID sent in a header, e.g., `Idempotency-Key`) that the server persists and checks — a repeated request with the same key returns the original result without re-executing the side effect.

#### 2.3 Status Code Semantics Beyond the Basics
- **200 vs 201 vs 204**: 200 (OK, has a body), 201 (Created, includes a `Location` header pointing to the new resource), 204 (No Content — success, deliberately no body, common for DELETE/PUT).
- **400 vs 422**: 400 (malformed request — can't even be parsed/understood), 422 (Unprocessable Entity — well-formed but semantically invalid, e.g., a business-rule validation failure) — a distinction many APIs blur, but a precise API design keeps them separate.
- **409 Conflict**: the request conflicts with the resource's current state (e.g., optimistic-concurrency version mismatch) — distinct from 400/422, since the request itself is valid, just conflicting with concurrent state.

#### 2.4 Versioning Strategies
- **URI versioning** (`/v1/orders`): simplest, most visible, but "pollutes" the URI (arguably violating REST's "URI identifies a resource, not a version of an API" purity) and requires duplicating route definitions.
- **Header versioning** (`Api-Version: 2` or `Accept: application/vnd.company.v2+json`): keeps URIs stable/pure, but less discoverable/debuggable (can't just paste a URL in a browser to see a specific version).
- **Query-string versioning** (`?api-version=2`): a middle ground, easy to test manually, but easy to omit accidentally (silently falling back to a default version).
No universal "correct" choice — the trade-off is discoverability/simplicity (URI) vs. REST purity/cache-friendliness (header) vs. ease-of-testing (query string); most large-scale APIs (Stripe, GitHub) use header-based versioning specifically for its cache-key cleanliness and REST-purity properties.

#### 2.5 Optimistic Concurrency via ETags
`ETag` (a version/hash identifier for a resource's current state) combined with `If-Match`/`If-None-Match` conditional request headers implements optimistic concurrency control over HTTP itself: a client GETs a resource (receiving its `ETag`), later PUTs an update with `If-Match: <etag>` — the server rejects with `412 Precondition Failed` if the resource has changed since the client's GET, preventing a classic lost-update race (two clients concurrently reading, modifying, and blindly overwriting) without any application-level locking.

#### 2.6 HATEOAS — Hypermedia as the Engine of Application State
The often-unimplemented "fourth constraint" — responses include **links** to related/next-available actions (`"actions": {"cancel": {"href": "/orders/123/cancel"}}`), letting clients navigate the API's state machine dynamically rather than hardcoding URL construction logic. Genuinely powerful for long-lived API consumers that must tolerate URL-structure evolution, but adds real payload/complexity overhead most REST APIs in practice skip entirely — a legitimate, common "level 2, not level 3, Richardson Maturity Model" pragmatic choice worth explicitly justifying rather than treating as an oversight.

### 3. Visual Architecture
```
GET /orders/123 -> 200 {... } (ETag: "abc123")
PUT /orders/123 -> 412 Precondition Failed (If-Match: "abc123" doesn't match current "xyz789")
POST /payments -> 201 Created (Idempotency-Key: "client-generated-uuid")
POST /payments (retry, same Idempotency-Key) -> 201 Created (SAME result, no duplicate charge)
```

### 4. Production Example
**Scenario**: A payments API without idempotency-key support experienced duplicate charges during a mobile-network flakiness period — clients retrying a timed-out POST created genuine duplicate payment records, since POST is non-idempotent by HTTP semantics and no application-level deduplication existed. **Fix**: implemented `Idempotency-Key` header support — the server persists (key → result) mappings with a TTL, returning the cached original result for a repeated key instead of re-processing. **Lesson**: idempotency isn't automatic for POST — it must be deliberately engineered for any operation that must tolerate client retries, exactly the retry-safety discipline applied at the API-contract level.

### 11. Coding Exercises

#### Easy — Correct 201 with Location header
```csharp
app.MapPost("/orders", async (CreateOrderRequest request, IOrderService service) =>
    {
        var order = await service.CreateAsync(request);
        return Results.Created($"/orders/{order.Id}", order); // Location header + 201, not a bare 200
});
```

#### Medium — ETag generation and `If-Match` validation
```csharp
app.MapPut("/orders/{id}", async (string id, UpdateOrderRequest request, HttpRequest http, IOrderRepository repo) =>
    {
        var order = await repo.GetByIdAsync(id);
        if (order is null) return Results.NotFound;

        var currentETag = $"\"{order.Version}\"";
        if (http.Headers.IfMatch.Count > 0 && http.Headers.IfMatch[0]!= currentETag)
            return Results.StatusCode(StatusCodes.Status412PreconditionFailed);

        order.ApplyUpdate(request);
        order.Version++;
        await repo.SaveAsync(order);
        return Results.Ok(order);
});
```

#### Hard — Idempotency-key middleware with concurrent-duplicate handling
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
        using var buffer = new MemoryStream;
        context.Response.Body = buffer;

        await _next(context);

        buffer.Seek(0, SeekOrigin.Begin);
        var responseText = await new StreamReader(buffer).ReadToEndAsync;
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

#### Expert — Combined optimistic-concurrency + idempotency-key payment flow
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

### 12. System Design
A payments platform's idempotency middleware (Hard/Expert exercises) is the module's central production pattern — every non-idempotent, side-effect-triggering endpoint routes through it, with per-client-scoped keys and a short-TTL cache backed by Redis for fleet-wide consistency (the distributed-cache reasoning applied here).

### 13. Low-Level Design
A shared `IIdempotencyStore` abstraction (used identically by the Expert exercise) centralizes key-validation, in-progress-tracking, and payload-hash-comparison logic once, reusable across every non-idempotent endpoint in a codebase, rather than each team re-implementing subtly different idempotency logic independently.

### 14. Production Debugging
The signature incident for this module: duplicate payment charges from unhandled POST retries during network flakiness — diagnosed by correlating duplicate charges with client-side retry logs showing a timeout on the original request followed by an identical retry with no idempotency key at all.

### 15. Architecture Decision
Header-based versioning is recommended as the default for new large-scale/long-lived public APIs (cache-key cleanliness, REST purity); URI versioning remains acceptable for simpler, smaller APIs prioritizing discoverability/manual testability over those concerns.

### 16. Enterprise Case Study
Stripe's and GitHub's publicly-documented API versioning approaches (both header/date-based) are directly citable, large-scale precedents for the header-versioning recommendation — both explicitly chose this specifically to avoid URI fragmentation across API versions at massive integration scale.

### 17. Principal Engineer Perspective
Treat idempotency-key support as a mandatory, non-negotiable requirement for any payment/order-creation endpoint from day one — retrofitting it after a duplicate-charge incident is far more disruptive (requiring careful backfill/reconciliation of already-affected records) than building it into the initial design.

### 18. Revision
**Key takeaways**: Idempotent = same request repeated → same end state (GET, PUT, DELETE; not POST by default). Idempotency keys make POST safely retryable. ETags + `If-Match` prevent lost updates. 400 = malformed, 422 = semantically invalid, 409 = conflicts with current state. Versioning strategy is a genuine trade-off, not a solved question.

---

**Next**: Continuing autonomously to Module 16 — API Security & Rate Limiting Patterns (throttling, API gateways, request signing).
