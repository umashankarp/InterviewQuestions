# .NET / ASP.NET Core — Cram Sheet

> Tier 1 · Source: `02-DotNet-AspNetCore/` (8 modules, 3,973 lines) · Read: 15 min

---

## 1. Middleware Pipeline

- **Onion model:** registration order on the way *in*, reverse order on the way *out*. Code before `await next()` runs inbound; code after runs outbound. **Omitting `next` short-circuits.**
- **Canonical order:**
  `UseExceptionHandler` → `UseForwardedHeaders` → `UseHttpsRedirection` → `UseRouting` → *(middleware needing endpoint metadata)* → `UseAuthentication` → `UseAuthorization` → `UseEndpoints`
- **Why `UseRouting` and endpoint execution are separate steps:** so middleware in between (auth) can inspect the **matched endpoint's metadata** before the endpoint runs. Register auth *before* `UseRouting` and there is no endpoint metadata to authorize against.
- **Two ordering principles:** (1) must run after its data dependency exists (auth after routing); (2) should short-circuit before more expensive downstream work.
- **`HttpResponse.HasStarted`** — once true, status code and headers can no longer be changed. This is the #1 cause of "why didn't my exception middleware fix the response." Register exception handling **early**.
- **`HttpContext.RequestServices`** is the per-request DI scope. Never capture a Scoped service into a Singleton field.
- **Reading the body twice:** `Request.EnableBuffering()` then reset `Body.Position = 0` — forget the reset and downstream model binding breaks.
- **Behind any proxy/CDN/LB:** `UseForwardedHeaders` with **explicitly scoped trusted proxies**. Otherwise every client IP logs as the proxy's IP. Never trust forwarded headers unconditionally.
- **Kestrel** sits below middleware, built on `System.IO.Pipelines`.

> **TRAP** — assuming `HttpContext` is safe for unsynchronised concurrent access across fanned-out async work within one request. It is not.

---

## 2. Dependency Injection

| Lifetime | Instance per |
|---|---|
| `Transient` | every resolution |
| `Scoped` | request / scope |
| `Singleton` | application lifetime |

- **Hard rule:** a longer-lived service must **never capture** a shorter-lived one.
- **Captive dependency** — a Singleton injecting a Scoped dependency locks in *one* instance forever, reused across every subsequent request. In multi-tenant systems this is **silent cross-tenant data leakage**. The classic, most-tested DI bug.
- **`ValidateScopes` / `ValidateOnBuild`** catch it at startup — but default to **Development only**. Explicitly enable in every environment.
- **`IServiceScopeFactory`** is the fix when a Singleton genuinely needs Scoped work (e.g. a background refresher): it is safe to hold long-term (it's a factory, not a scope); create a **fresh scope at the point of use**, never capture at construction.
- **Service Locator anti-pattern** — injecting `IServiceProvider` and resolving dynamically hides real dependencies from reviewers *and* from the container's static validation.
- **`IHttpClientFactory`** solves **two** things: socket exhaustion *and* DNS-blindness. Naming only the first is an incomplete answer.
- **Ambiguous multi-constructor resolution is a hard runtime failure**, not a silent fallback — DI resolution differs from normal C# overload resolution. One DI-facing constructor per class.
- Open generics: `services.AddScoped(typeof(IRepo<>), typeof(Repo<>))`. Multiple registrations of one interface resolve as `IEnumerable<TService>`.

---

## 3. Minimal APIs vs Controllers · Model Binding · Filters

- Both compile to the **same `Endpoint`/routing infrastructure**. They differ in filter richness, binding inference, validation convention, and performance.
- **MVC filter pipeline — six ordered stages:**
  `authorization → resource → (model binding) → action → exception → result`
  Minimal API `IEndpointFilter`s are a **single flat chain** — no equivalent stages.
- **`[ApiController]`** automatic 400 is implemented by an ordinary inspectable `IActionFilter` (**`ModelStateInvalidFilter`**) — not magic. **There is no automatic Minimal API equivalent.**
- **Binding-source inference for complex types genuinely differs** between the two models — a real source of silent regressions during migration. Use explicit `[FromBody]`/`[FromQuery]`/`[FromRoute]`.
- **Mass assignment** = binding the request body directly to a persistence entity. **Always use a DTO** — for input (prevents over-posting) and output (prevents leaking internal fields).
- **`TypedResults`** = compile-time-checked results and drift-proof OpenAPI metadata. `[ProducesResponseType]` attributes silently go stale.

---

## 4. Authentication & Authorization

- **Deliberately independent, pluggable systems.** Schemes establish *identity*; policies (requirement + handler) decide *access*.
- **401 vs 403:** 401 = *who are you* (authentication failed / no credentials). 403 = *I know who you are, and no* (authorization failed).
- **Combination rule (frequently missed):** requirements within a policy combine with **AND**; multiple handlers for the **same** requirement combine with **OR**.
- **Resource-based authorization** ("does this user own *this* order") requires the imperative `IAuthorizationService.AuthorizeAsync(user, resource, policy)`. Declarative `[Authorize]` has no access to the resource. Forgetting this is the cross-customer data-access bug.
- **`IClaimsTransformation` runs on every authenticated request, unconditionally, platform-wide.** Anything expensive and uncached inside it has a **platform-wide blast radius**, not a feature-scoped one.
- **Cookie auth needs a shared data-protection key ring** across replicas, or users are logged out after every rolling deploy. JWT is naturally more horizontal-scaling-friendly (self-contained, no server state).
- **Multi-scheme apps must scope `AuthenticationSchemes` explicitly per endpoint** — relying on the default risks **privilege escalation via scheme confusion**.
- `ClaimsPrincipal` → many `ClaimsIdentity` → many `Claim` (type/value pairs).

---

## 5. Configuration & Options

- **Source precedence (last wins):** appsettings.json → appsettings.{Env}.json → User Secrets (dev) → Environment variables → command line.
- | Interface | Lifetime | Reloads? |
  |---|---|---|
  | `IOptions<T>` | Singleton | No — bound once |
  | `IOptionsSnapshot<T>` | Scoped | Per request |
  | `IOptionsMonitor<T>` | Singleton | Yes + `OnChange` callback |
- Singleton needs live config → **`IOptionsMonitor<T>`** (`IOptionsSnapshot` cannot be injected into a Singleton).
- **`ValidateDataAnnotations().ValidateOnStart()`** — fail at startup, not on first request. Cross-field rules → `IValidateOptions<T>`.
- **Named options** for per-tenant / multi-instance configuration (e.g. per-tenant SMTP).

---

## 6. Health Checks & Observability

- **Liveness vs readiness — the frequently-confused distinction:**
  - **Liveness** = "is the process wedged?" Fails → **restart the pod**. Must **not** check dependencies, or a DB blip restarts your whole fleet.
  - **Readiness** = "can I serve traffic now?" Fails → **removed from the load balancer**. *Does* check dependencies.
- Tag checks (`tags: ["ready"]`) and expose two endpoints: `/health/live`, `/health/ready`.
- **`Degraded`** = non-critical dependency down; still return 200 and keep serving.
- **Tracing:** `ActivitySource` → `Activity` (W3C `traceparent` propagation). **Metrics:** `System.Diagnostics.Metrics` (`Meter`, `Counter<T>`, `Histogram<T>`). Both are OpenTelemetry-native.

---

## 7. Real-Time: SignalR · WebSockets · SSE

| | Direction | Transport | Use for |
|---|---|---|---|
| **WebSocket** | full duplex | upgraded TCP | chat, trading UI, collaboration |
| **SSE** | server → client | plain HTTP, auto-reconnect | price ticks, live feeds, progress |
| **Long-polling** | emulated | plain HTTP | fallback where WS is blocked |

- **SignalR** = an abstraction over all three with automatic transport negotiation and fallback.
- **Scale-out requires a backplane** (Redis / Azure SignalR) — without it, a message published on instance A never reaches a client connected to instance B.
- Connections are **sticky**: enable session affinity at the load balancer, and handle **connection draining on deploy**.
- Users map to many connections (tabs/devices) → use **groups** or a user-ID mapping, not raw connection IDs.

---

## 8. gRPC & Service-to-Service Contracts

- HTTP/2 + Protobuf: binary, smaller and faster than JSON, with a **schema-first `.proto` contract** and generated clients.
- Four call types: unary · server streaming · client streaming · bidirectional streaming.
- **Use gRPC** for internal east-west service calls. **Use REST/JSON** for public/browser-facing APIs (browsers cannot speak raw gRPC — needs gRPC-Web or a gateway).
- **Backward compatibility:** never reuse or renumber a field tag; add new fields as optional; use `reserved` for removed tags.
- `deadline`/`CancellationToken` propagates across hops — a real advantage over ad-hoc HTTP timeouts.

---

## Top traps

1. Auth registered **before** `UseRouting` → no endpoint metadata.
2. `HasStarted` → exception middleware silently cannot change the response.
3. Singleton capturing Scoped → cross-tenant leakage.
4. `ValidateScopes` defaults to Development only.
5. `IHttpClientFactory` is about DNS **and** sockets.
6. Minimal APIs have **no** automatic `[ApiController]` 400 validation.
7. Binding the request body straight to an entity (mass assignment).
8. Liveness probe that checks the database → fleet-wide restart loop.
9. Expensive uncached work in `IClaimsTransformation`.
10. No shared data-protection key ring → logged out every deploy.

---

## Interview Q&A — Lead / Principal

**Answer frame:** headline → mechanism → trade-off + threshold → failure mode **and how you'd know** → *(Principal)* should it exist / who owns it.

### Q1 · Captive dependency / cross-tenant leak *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"A multi-tenant SaaS is intermittently showing tenant A's data to tenant B. No code changed recently. Where do you look first?"*

**Answer.** DI lifetimes — specifically a **Singleton that captured a Scoped dependency**. A Singleton resolves its dependencies once, so if it took a `DbContext` or a tenant-context service it pinned the *first request's* instance for the process lifetime; every later request is served with the first tenant's context. It's intermittent because it depends which tenant hit the instance first after a deploy, and it looks like nothing changed because the trigger is usually an innocuous refactor adding a constructor parameter. I'd confirm by enabling **`ValidateScopes` and `ValidateOnBuild`** — which default to Development only, and that default is exactly why this reaches production — and the app fails to start naming the offending registration. Fix is `IServiceScopeFactory`, creating a fresh scope at the point of use rather than capturing at construction.

Beyond the fix, this is a **Sev-1 with regulatory exposure**: containment first — restarting clears it, so I need blast radius from logs *before* restarting — then a data-access audit to scope who saw what, then notification. The structural fix is `ValidateOnBuild` on in every environment, enforced in the shared service template, because this class of bug should fail a build, not a customer.

**Why it lands.** Diagnosis, detection mechanism, *and* incident handling plus structural response. The highest-value question in the .NET set.
**✗ Weak answer.** Jumping to "a caching bug" or "a missing tenant filter" without naming the lifetime mechanism.
**↳ Follow-ups.** Why does restarting "fix" it and why is that dangerous? What else does `ValidateOnBuild` catch? How do you prove blast radius?

---

### Q2 · Resource-based authorization / BOLA *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"A pen test found a user can fetch another customer's order by changing the ID in the URL. The endpoint has `[Authorize]`."*

**Answer.** `[Authorize]` only proves *authenticated* — it says nothing about whether this principal may touch *this object*. That's **BOLA**, the number-one API vulnerability, and it's an authorization design gap, not one endpoint's bug. Mechanically: load the resource, then `IAuthorizationService.AuthorizeAsync(user, resource, policy)` — declarative attributes can't do this because they have no access to the resource. But fixing one endpoint is the Senior answer. The Lead answer is that if one has it, others do: audit every endpoint taking a resource identifier, then add a structural control — a base handler or endpoint filter making ownership checking the default, requiring an explicit opt-out attribute for genuinely public resources. Then a CI test that walks the route table and fails for any resource-scoped endpoint without an ownership assertion. I'd also return **404 rather than 403** for objects the caller doesn't own, so the API doesn't confirm existence.

**Why it lands.** Treats one finding as a class, makes the safe path the default, adds a CI detector. The 404-vs-403 detail is a strong signal.
**✗ Weak answer.** Patching the single endpoint and moving on.
**↳ Follow-ups.** Do requirements combine with AND or OR? Where does this live if authorization needs data from another service?

---

### Q3 · Health checks and a fleet-wide outage *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Your database had a 30-second blip. Every pod restarted and the outage lasted 20 minutes. Explain."*

**Answer.** The liveness probe was checking the database. Liveness answers "is this process wedged?" and failing it **restarts the container** — so a shared dependency failing means every replica fails simultaneously and the whole fleet restarts at once. Then it compounds: all pods come up cold together, hammer the database with connection establishment and cold caches, and recovery far outlasts the original blip. That's a **metastable failure** — the system stays broken after the trigger is gone because the recovery *is* the load. Correct split: **liveness checks only in-process health, never a dependency**; **readiness checks dependencies**, and failing it merely removes the pod from the load balancer, which degrades rather than destroys. I'd add `Degraded` as a distinct state so a reporting database being down doesn't take checkout offline, and stagger probes so they can't all fire on the same tick.

**Why it lands.** Explains the amplification, names metastability, gives a three-state model rather than just swapping the probe.
**✗ Weak answer.** "Increase the liveness timeout." Delays the outage; doesn't prevent it.
**↳ Follow-ups.** What should readiness actually test? How do you avoid removing 100% of the fleet from the LB?

---

### Q4 · Middleware order and the response you can't change *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Your global exception handler returns a clean problem+json 500 — except on streaming endpoints, where clients get a truncated response."*

**Answer.** Once `HttpResponse.HasStarted` is true, status and headers are already on the wire and cannot change — the handler catches the exception but can't rewrite the response. On a streaming endpoint you flushed the first bytes long before the failure. The general rule is two-part: exception handling registered **first** so it wraps the maximum surface, and `UseRouting` before anything needing endpoint metadata — register authentication before routing and there's no matched endpoint to authorize against. For streaming specifically, middleware ordering can't fix it: you either buffer (defeating the point) or design the protocol so the client can detect truncation — a terminator record or trailing checksum. That's the honest answer: some failures have to be handled in the contract, not the pipeline.

**Why it lands.** Answers the specific case, gives the general rule, then admits the case middleware *can't* solve — the Principal move.
**✗ Weak answer.** "Move the exception middleware earlier." It's already as early as possible; that misses `HasStarted`.
**↳ Follow-ups.** Where does `UseForwardedHeaders` go and why does it matter behind a CDN? How do you read the request body twice?

---

### Q5 · Minimal APIs vs Controllers — would you migrate? *(Principal)* ⭐⭐⭐
**Asked as:** *"A team wants to migrate 200 controller actions to Minimal APIs for performance. Approve?"*

**Answer.** Not as a blanket migration. The performance delta is real but small, and won't be the bottleneck on 200 endpoints that talk to a database — so the stated justification doesn't survive a profile. The real risk is a **silent behavioural regression**: complex-type binding-source inference genuinely differs between the models, and `[ApiController]`'s automatic 400-on-invalid-ModelState has **no Minimal API equivalent by default** — so validation that used to reject bad input starts reaching your handlers. That's a security-relevant change, not a refactor. My position: Minimal APIs for *new* endpoints and genuinely hot simple routes, with explicit `[FromBody]`/`[FromQuery]` rather than inference, and a contract-test suite asserting request/response shapes before and after anything migrated. Migrating for its own sake spends a quarter to gain nothing measurable.

**Why it lands.** Rejects the premise with a specific named regression rather than a preference, then gives a conditional path forward.
**✗ Weak answer.** "Minimal APIs are faster/more modern" — the answer the question is testing you *against*.
**↳ Follow-ups.** How would you restore the automatic 400? What's the filter-pipeline difference?

---

### Q6 · gRPC vs REST for internal services *(Lead)* ⭐⭐⭐
**Asked as:** *"Should our internal service-to-service calls use gRPC?"*

**Answer.** For east-west traffic between services you own, usually yes — HTTP/2 with protobuf gives smaller payloads, a schema-first contract with generated clients, and **deadline propagation**, which I'd emphasise because it's genuinely hard to retrofit with ad-hoc HTTP timeouts. Keep REST/JSON at the public edge: browsers can't speak raw gRPC without gRPC-Web or a gateway, and partners will want JSON. Costs to state honestly: debugging is worse (binary on the wire, no curl), naive L4 load balancing pins all traffic to one backend because gRPC multiplexes on one long-lived connection, and schema evolution becomes a discipline — **never reuse or renumber a field tag**, additive-only, `reserved` for removed tags. If the estate is five .NET services and nobody's measured a serialisation bottleneck, REST plus a shared client library is cheaper and I'd say so.

**Why it lands.** Conditional recommendation, names deadline propagation, flags the load-balancing trap that bites in production.
**✗ Weak answer.** "gRPC is faster" with no mention of the LB or debugging cost.
**↳ Follow-ups.** How do you load balance gRPC in Kubernetes? What's your backward-compatibility rule?

---

### Quick-fire (30 seconds each)

- **"Why is middleware order important?"** → It's a nested delegate chain: inbound in registration order, outbound in reverse. Two rules govern it — run after your data dependency exists, and short-circuit before expensive work. The concrete failure is auth before routing (no endpoint metadata) or exception handling registered late (response already started).
- **"Explain the captive dependency problem."** → A Singleton that injects a Scoped service captures one instance for the process lifetime. In a multi-tenant app the first request's tenant DbContext then serves every later request — silent cross-tenant data leakage. Catch it with `ValidateScopes`/`ValidateOnBuild` enabled in all environments; fix it with `IServiceScopeFactory`.
- **"Liveness vs readiness?"** → Liveness answers "is the process wedged" and failing it restarts the pod, so it must never check dependencies. Readiness answers "can I serve now" and failing it just removes me from the load balancer, so it should check dependencies. Getting them backwards turns a database blip into a fleet-wide restart storm.

---

**Go deeper:** `02-DotNet-AspNetCore/01`–`08` · **Related:** [[01-CSharp]], [[03-REST-APIs]], [[41-OAuth2-OIDC-JWT]], [[27-Observability]]
