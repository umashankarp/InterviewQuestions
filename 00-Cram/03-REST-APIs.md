# REST APIs — Cram Sheet

> Tier 1 · Source: `03-REST-APIs/` (3 modules, 1,346 lines) · Read: 10 min

---

## 1. HTTP Method Semantics

| Method | Safe | Idempotent | Body | Notes |
|---|---|---|---|---|
| GET | ✔ | ✔ | no | Cacheable |
| HEAD | ✔ | ✔ | no | Headers only |
| POST | ✖ | **✖** | yes | Create / non-idempotent action |
| PUT | ✖ | ✔ | yes | **Full replace** |
| PATCH | ✖ | **✖** | yes | Partial; idempotent *only* if written so |
| DELETE | ✖ | ✔ | no | Second call → 404 or 204, still idempotent |

- **Safe** = no observable state change. **Idempotent** = N identical calls leave the same state as 1.
- **PUT vs PATCH:** PUT replaces the whole resource (omitted field = cleared); PATCH applies a partial change (JSON Patch RFC 6902 / merge patch RFC 7386).

---

## 2. Idempotency — the reliability mechanism

- **Why it matters:** the network cannot tell "request lost" from "response lost." The client *must* retry; the server *must* deduplicate. This is the whole game in payments.
- **`Idempotency-Key` header** (client-generated UUID) + server-side store:
  1. Look up the key. Hit + completed → **replay the stored response**, do not re-execute.
  2. Hit + in-flight → return **409** (or block briefly).
  3. Miss → insert key with a **unique constraint** (this is what makes it race-safe), execute, store the response.
- Store the **request fingerprint** too — same key with a *different* body is a client bug → **422**.
- TTL of 24h–7d is typical. Stripe is the canonical reference implementation.
- **The identity to quote:** `exactly-once = at-least-once (retries) AND at-most-once (idempotency key)`.

---

## 3. Status Codes That Actually Get Asked

| Code | Meaning |
|---|---|
| **201** Created | + **`Location`** header pointing at the new resource |
| **202** Accepted | async accepted, not done — return a status URL |
| **204** No Content | success, deliberately empty body |
| **400** vs **422** | malformed/unparseable vs syntactically fine but semantically invalid |
| **401** vs **403** | not authenticated vs authenticated-but-forbidden |
| **404** vs **403** | deliberately return 404 to avoid leaking resource existence |
| **409** Conflict | concurrent modification / duplicate |
| **412** Precondition Failed | `If-Match` ETag mismatch |
| **428** Precondition Required | force clients to send `If-Match` |
| **429** Too Many Requests | + **`Retry-After`** |
| **503** vs **500** | transient, retryable vs bug |

- Error bodies: **RFC 7807 `application/problem+json`** (`type`, `title`, `status`, `detail`, `instance`).

---

## 4. Versioning

| Strategy | Pros | Cons |
|---|---|---|
| **URI path** `/v1/orders` | obvious, cacheable, easy routing | not truly RESTful, URI churn |
| **Header** `Api-Version: 2` | clean URIs | invisible, hard to test in a browser |
| **Media type** `Accept: application/vnd.x.v2+json` | most correct | poor tooling support |
| **Query string** `?api-version=2` | trivial | clutters, cache-key risk |

- **Practical answer:** URI path for major versions (pragmatism, caching, discoverability); never version for additive changes.
- **Breaking vs non-breaking:** adding an optional field or a new endpoint = non-breaking. Removing/renaming a field, tightening validation, changing a type, or changing an error code = **breaking**.
- **Say this:** the best versioning strategy is the one you need least — design for additive evolution (tolerant reader, never remove a field without a deprecation window + sunset header).

---

## 5. ETags & Optimistic Concurrency

- Server returns `ETag: "v7"`; client sends `If-Match: "v7"` on update → mismatch = **412**.
- `If-None-Match` on GET → **304 Not Modified** (bandwidth saving, different purpose).
- **Strong vs weak** (`W/"..."`) ETag: byte-identical vs semantically equivalent.
- This is how you prevent **lost updates** without pessimistic locking. Pair it with an idempotency key for the full payment-safe flow: ETag stops *conflicting* writes, the idempotency key stops *duplicate* writes.

---

## 6. HATEOAS

- Responses carry links describing available next actions (`_links: { cancel, refund }`), so clients discover transitions instead of hard-coding them.
- **Honest position for an interview:** it is level 3 of the Richardson Maturity Model and is genuinely rare in practice — the cost lands on every client, the benefit only pays off with many uncontrolled consumers. Say you'd use it for a public/partner API with long-lived clients, and skip it for internal service-to-service.

---

## 7. API Security (OWASP API Top 10)

**Why it is distinct from the general OWASP Top 10:** APIs expose object identifiers and business logic directly, so *authorization* flaws dominate rather than injection/XSS.

- **API1 — BOLA / IDOR** (the #1 API vulnerability): `/orders/{id}` without an ownership check. Fix = **resource-based authorization** on every object access, not just "is authenticated."
- **API3 — Excessive data exposure**: returning the entity and letting the client filter. Fix = response DTOs.
- **API6 — Mass assignment**: binding the body to an entity lets a caller set `IsAdmin`. Fix = request DTOs.
- Others to name: broken authentication, lack of rate limiting, broken function-level authorization, SSRF, security misconfiguration.
- **Validate at the boundary** — allow-list, typed, length/range-bounded. Never rely on client validation.

---

## 8. Rate Limiting

| Algorithm | Behaviour | Weakness |
|---|---|---|
| **Fixed window** | counter per interval | **2x burst** at the window edge |
| **Sliding window log** | exact | memory: stores every timestamp |
| **Sliding window counter** | weighted blend of two windows | approximate |
| **Token bucket** | steady refill, allows bursts | needs tuning |
| **Leaky bucket** | smooths output to a constant rate | no bursts allowed |

- **Default recommendation: token bucket** — it permits legitimate bursts while bounding the sustained rate.
- **Distributed enforcement:** per-instance counters multiply the real limit by the replica count. Use a **Redis Lua script** (atomic check-and-decrement) or a centralised limiter at the gateway.
- **Response contract:** `429` + **`Retry-After`** + `X-RateLimit-Limit` / `-Remaining` / `-Reset`.
- Limit per **API key / user / tenant**, not just per IP (NAT and mobile carriers share IPs).

---

## 9. OpenAPI & Contract Testing

- **Code-first** (generated from code) — always in sync, but the spec is an afterthought. **Schema-first** (spec is the source, code generated) — better for a design-review culture and parallel client work.
- **Drift is the real risk:** `[ProducesResponseType]` silently goes stale. `TypedResults` prevents that.
- **Consumer-driven contract testing (Pact):** the consumer publishes expectations; the provider verifies them in CI. Catches breaking changes **before deploy** without full end-to-end environments — the key advantage to state.
- **Governance:** API design review + a spec linter enforcing shared conventions (pagination shape, error format, naming, versioning).

---

## Top traps

1. Calling **PATCH idempotent** — it is not, unless you design it so.
2. **201 without a `Location` header.**
3. **429 without `Retry-After`.**
4. Idempotency without a **unique constraint** → the race still fires.
5. Per-instance rate limiting in a multi-replica fleet.
6. BOLA — authenticated but not authorized for *that object*.
7. Binding request bodies to entities.
8. 404 vs 403 leaking resource existence.
9. Fixed-window limiter allowing a 2x edge burst.
10. Versioning additive changes.

---

## Interview Q&A — Lead / Principal

**Answer frame:** headline → mechanism → trade-off + threshold → failure mode **and how you'd know** → *(Principal)* should it exist / who owns it.

### Q1 · The double charge *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"A customer was charged twice. The client says it sent one request. Design the fix."*

**Answer.** Almost certainly the client retried after a lost *response* — the network can't distinguish "request lost" from "response lost", so the client must retry and the server must deduplicate. Mechanism is an **`Idempotency-Key`** header, client-generated per logical operation, and the critical detail is that the server inserts that key under a **unique constraint before executing**. That's what makes it race-safe: two concurrent duplicates both attempt the insert, one loses on the constraint and replays the stored response instead of charging again. Without the unique constraint a check-then-act still races under concurrency — the mistake I see most. I'd also store a request fingerprint, so the same key with a *different* body is a client bug returning 422 rather than silently replaying the wrong response.

Framing: **exactly-once = at-least-once (the retry) AND at-most-once (the key)**. Honest limits — the dedup store needs a retention window (24h–7d), and a retry after expiry re-executes, so I'd state that window explicitly. Then, because it's money: reconcile against the provider's settlement file daily regardless, because their view is authoritative and our idempotency doesn't cover their side.

**Why it lands.** Unique-constraint-before-execute, the fingerprint, a stated retention limit, and reconciliation-anyway. The highest-frequency fintech API question.
**✗ Weak answer.** "Check if the key exists, if not then process" — that's the race.
**↳ Follow-ups.** What status for an in-flight duplicate? Where does the key live relative to the payment write? What if the provider timed out and you don't know the outcome?

---

### Q2 · Rate limiting across a fleet *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"We set a 1,000 req/min limit per customer. Customers report being throttled early; our metrics say we're letting through 10,000."*

**Answer.** Both are true, same cause: the limiter is per-instance. With 10 replicas each enforcing 1,000, the real aggregate is 10,000 — that's your metric. And customers get throttled "early" because a load balancer doesn't distribute evenly, so one instance sees a disproportionate share of one customer's traffic and hits its local 1,000 long before the aggregate. Fix is centralised enforcement: Redis with a **Lua script** so check-and-decrement is atomic, otherwise you've moved the race rather than removed it. Algorithm: **token bucket** by default, because it bounds sustained rate while permitting the bursts real clients produce; fixed window is simpler but allows a 2× burst across the boundary. If the Redis round trip becomes the bottleneck, **local token leases** — each node leases a slice, refreshes asynchronously — trading exactness for latency, usually the right trade at volume. And the response contract matters: `429` with **`Retry-After`** plus `X-RateLimit-Remaining`, or clients retry immediately and amplify it.

**Why it lands.** Explains two contradictory symptoms with one cause, then gives the escape hatch when the correct fix is too slow.
**✗ Weak answer.** "Use Redis" with no atomicity, or without explaining the uneven-distribution symptom.
**↳ Follow-ups.** Redis down — fail open or closed? How do you limit per-tenant *and* per-endpoint atomically?

---

### Q3 · Versioning with 40 partners *(Principal)* ⭐⭐⭐
**Asked as:** *"We have 40 partner integrations on v1. Product wants a breaking change. How do you handle it?"*

**Answer.** First I'd challenge whether it's actually breaking — adding an optional field or a new endpoint isn't, and a surprising number of "breaking" changes become additive under a tolerant-reader contract. If it genuinely is, then with 40 external partners the cost isn't technical, it's **coordination**, and that drives the approach: URI path versioning for the major version because it's obvious, cacheable and trivially routable; run v1 and v2 in parallel; publish a **deprecation window with `Sunset` headers** so the timeline is machine-readable rather than living in an email. I'd instrument per-partner v1 usage so I know exactly who's left and can chase individually — that telemetry is what turns an open-ended migration into a finishable one. Realistic window for external partners in financial services is 6–12 months, and I'd expect to carry the last two stragglers past it.

Principal framing: **the best versioning strategy is the one you need least.** The durable fix is an additive-only evolution discipline so we're not here again next year.

**Why it lands.** Challenges the premise, treats it as coordination, adds per-partner telemetry, gives a realistic window.
**✗ Weak answer.** Listing the four versioning strategies with no reference to the 40 partners.
**↳ Follow-ups.** What exactly counts as breaking? How do you sunset a partner who refuses to move?

---

### Q4 · Build vs buy *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"The team wants to build our own feature-flag service instead of buying. You have the deciding vote."*

**Answer.** I'd buy, and I'd want the team to understand the arithmetic rather than feel overruled. The question isn't "can we build it" — obviously we can, it's a key-value lookup and a UI. It's the **five-year total cost**: not v1, but SDK maintenance across every language we use, the SLA when the flag service sits in the request path of every service we own, on-call, the audit trail a regulator will ask for, percentage rollouts, and the feature we'll want in eighteen months that the vendor already has. Against that the licence is usually the cheaper number, and it's an **undifferentiated capability** — no customer chooses us for our flag infrastructure.

I'd build only against a specific constraint the market can't meet — data residency, an air-gapped environment, or a latency budget forbidding an external call. If it's the latter, the honest middle is buying and caching locally with a fallback file, which also protects us during a vendor outage. And I'd say the quiet part: engineers want to build this because it's a fun, well-scoped problem, which is a real cost signal, not a design input.

**Why it lands.** Five-year TCO, "undifferentiated", names what would flip the decision, and addresses the human motive directly.
**✗ Weak answer.** "Buy, it's cheaper" (no arithmetic) or "build, we need control" (no cost).
**↳ Follow-ups.** Exit plan if the vendor is acquired? What happens when they're down? Who owns it internally either way?

---

### Quick-fire (30 seconds each)

- **"How do you make a payment API safe to retry?"** → Client sends an `Idempotency-Key`; the server inserts it under a unique constraint before executing, so concurrent duplicates lose the race and replay the stored response instead of re-charging. Retries give at-least-once; the key gives at-most-once; together that's exactly-once. Pair it with an ETag `If-Match` to stop conflicting concurrent updates.
- **"Which rate-limiting algorithm and why?"** → Token bucket, because it bounds sustained rate while allowing the bursts real clients produce. Fixed window is simpler but permits a 2x burst across the boundary. It has to be enforced centrally — Redis with an atomic Lua script — or N replicas each enforce the full limit.
- **"How do you version an API?"** → URI path for major versions, because it's cacheable, routable and obvious. But the real answer is to need it rarely: additive-only changes, tolerant readers, and a deprecation window with sunset headers before anything is removed.

---

**Go deeper:** `03-REST-APIs/01`–`03` · **Related:** [[02-DotNet-AspNetCore]], [[38-APIGateway-ServiceMesh-IAM]], [[28-Security]], [[34-CQRS-EventSourcing-Saga-Outbox]]
