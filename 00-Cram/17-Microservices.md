# Microservices — Cram Sheet

> Tier 1 · Source: `17-Microservices/` (10 files, 8,533 lines) · Read: 20 min

---

## 1. Decomposition

- **Split by business capability, never by technical layer.** A "UI service / logic service / data service" split is a **distributed monolith** — every feature touches all three.
- **Database-per-service is the non-negotiable rule.** Shared database ⇒ no independent deployment, no schema evolution without cross-team negotiation, no failure isolation, no independent scaling. If you share a database you have a monolith with network latency.
- **Right-sizing: the team is the unit, not the domain.** A service should be ownable by one team; two teams in one service, or one team across twelve, are both wrong.
- **Nano-services** — decomposition past the point of benefit: the coordination cost exceeds the isolation benefit. Symptom: no service can be changed alone anyway.
- **Measure coupling instead of debating it:** count **services co-changed per commit/PR**. If A and B always change together, they are one service.
- **Merging services is a legitimate, under-considered correction.** Say this — most candidates only ever propose splitting.
- **Boundaries drift even when initially correct** — treat them as reviewable, not permanent.

**Strangler Fig migration:** put a façade/proxy in front of the monolith, route one capability at a time to the new service, delete the old code once traffic is zero. Incremental, reversible at each step, no big-bang. The hard part is **data** — dual-write, then CDC-sync, then cut over.

---

## 2. Communication

- **Synchronous (REST/gRPC)** — use when the caller genuinely needs the answer to continue. **Cost: availability couples multiplicatively** and latency adds up across hops.
- **Asynchronous (events/queues)** — decouples *availability*, not just code. Cost: eventual consistency, ordering, duplicates, and a much harder debugging story.
- **Default posture:** commands sync where a user is waiting; everything else async.
- **gRPC** for internal east-west (HTTP/2, protobuf, generated clients, deadline propagation); **REST/JSON** at the public edge.

---

## 3. Resilience Patterns

| Pattern | Purpose |
|---|---|
| **Timeout** | the **foundational, non-negotiable** primitive — an unbounded call leaks a thread forever |
| **Retry + backoff + jitter** | transient failures **only** |
| **Circuit breaker** | fail fast instead of piling up doomed calls |
| **Bulkhead** | isolate a resource pool per dependency so one slow dependency can't drain the whole pool |
| **Fallback** | degraded but useful (cached/default response) |
| **Rate limit / shed** | protect yourself and them |

- **Circuit breaker states:** *closed* (normal) → **open** (fail immediately after N failures in a window) → **half-open** (let one trial through) → closed or open again.
- **Classify errors before retrying.** Retrying a 400 forever is an outage of your own making.
- **Retry amplification:** three layers each retrying 3× = **27× load** on the failing service at exactly the wrong moment. Fix with a **retry budget** (e.g. retries capped at 10% of requests) and **retry only at one layer**.
- **Deadline propagation** — pass the remaining time budget with the call; a downstream service should not start work that its caller has already given up on. Absent in most designs; naming it is a strong signal.
- **Backpressure is the missing half of resilience.** Retries and circuit breakers protect the *caller*; backpressure (bounded queues, rejecting early, `429`) protects the *callee*. Without it, an overloaded service accepts work it can never complete and dies from memory pressure.

---

## 4. Observability

- **Three pillars:** logs (what happened) · metrics (how much/how often) · traces (where the time went). Add **correlation ID** on every request, propagated across every hop — without it, distributed debugging is impossible.
- **W3C `traceparent`** propagation; OpenTelemetry is the vendor-neutral standard.
- **RED** for services (Rate, Errors, Duration) · **USE** for resources (Utilisation, Saturation, Errors).
- **Sidecar pattern** — extract cross-cutting concerns (mTLS, retries, telemetry, routing) out of application code into a co-deployed proxy. Benefit: polyglot, no library upgrades across 200 services. Cost: an extra hop, extra resource per pod, and a new failure domain.

---

## 5. Versioning, Testing, Deployment

- **Backward-compatible by default.** Additive changes only; never remove or rename a field without a deprecation window. Consumers must be **tolerant readers** (ignore unknown fields).
- **Testing pyramid for microservices:** many unit tests → **contract tests (the key layer)** → few integration → **very few end-to-end**. E2E across N services is slow, flaky, and gives a false sense of safety.
- **Consumer-driven contract testing (Pact):** the consumer publishes expectations, the provider verifies them in CI. This is what lets services deploy independently without a shared integration environment.
- **Blue-green:** two full environments, instant cutover, instant rollback. Cost: 2× infrastructure; database migrations must be compatible with both.
- **Canary:** route 1% → 5% → 25% → 100%, watching error rate and latency. Bounded blast radius; needs good metrics and an automated abort.
- **Feature flags decouple deployment from release** — deploy dark, enable per cohort, kill instantly. Cost: flag debt; flags need an expiry policy.
- **Conway's Law:** your architecture will mirror your communication structure. **Inverse Conway manoeuvre** — reorganise teams to get the architecture you want. Team Topologies: stream-aligned · enabling · complicated-subsystem · **platform**.

---

## 6. Data & Query Across Boundaries

- **API composition:** the gateway/BFF fans out and joins in memory. Works for small result sets. **Breaks on filtering, sorting and pagination** — you cannot paginate a join you haven't done. That failure is the most common real-world driver toward a read model.
- **Read models / CQRS across services:** a service subscribes to others' events and maintains its own denormalised query store. Cost: eventual consistency and a second copy to operate.
- **Deliberate data duplication is correct**, not a smell — each service keeps the subset it needs, kept fresh by events. The rule: **one service owns the write; everyone else holds a read replica of the fields they need.**
- **Consistency boundaries:** decide what genuinely must be transactional. Usually far less than people assume — an aggregate, not a workflow.
- **The shared-database escape hatch recurs** because reporting and ad-hoc queries have no good answer. The honest solution is a dedicated analytics store fed by events/CDC, not a shared OLTP schema.

---

## 7. Service Discovery & Load Balancing

- **Client-side discovery** (client queries a registry, picks an instance) — fewer hops, smarter balancing, but a library in every language. **Server-side** (LB/proxy does it) — language-agnostic, one more hop.
- **Round-robin underperforms** whenever request cost or instance capacity is uneven — **least-outstanding-requests** is the better default; **power-of-two-choices** gets most of the benefit at far lower cost.
- **Liveness vs readiness** (again, because it matters): liveness failing → restart; readiness failing → remove from LB. **Liveness must not check dependencies.**
- **The LB↔target boundary is a contract between two independently configured lifecycles** — deregistration delay, health-check interval × threshold, and connection draining must add up, or you drop requests on every deploy.
- **AWS:** ALB = L7 (path/header routing, HTTP) · NLB = L4 (TCP, ultra-low latency, static IP) · Route 53 = DNS (**not a failover mechanism you can bound in time** — TTLs and resolver caching make failover minutes, not seconds) · **Global Accelerator** = anycast IP, sub-minute failover.
- **gRPC and WebSockets break naive setups** — they multiplex on one long-lived connection, so **connection-level** balancing pins all traffic to one backend. You need request-level (L7) balancing or client-side LB.
- **Cross-zone load balancing off** → traffic skew when zones have unequal instance counts.

---

## 8. Multi-Region & Cell-Based Architecture

- **A cell is a complete, independent instance of the stack** serving a subset of users — its own compute, data and dependencies. Failure is contained to one cell.
- **Cell routing** needs an **assignment key** (tenant, account, user) and a thin, extremely reliable routing layer.
- **Cell sizing is the trade nobody gets right first:** too big = large blast radius; too small = operational overhead multiplied by cell count.
- **Control plane / data plane split** — the data plane must keep serving when the control plane is down. Violating this is how a config-service outage takes down everything.
- **Cell migration/rebalancing** is the hard operational problem; design the data move up front.
- Multi-region: active-passive (simple) · active-active read (common) · active-active write (needs conflict resolution). **What your data allows determines which is possible** — not the other way round.

---

## 9. Platform Engineering (capstone)

- **Paved path, not mandated path.** A golden path teams *want* to use beats a standard they're forced onto — adoption is the metric.
- **On the path:** service template/scaffolding, CI/CD, observability defaults, secrets, deployment, on-call wiring.
- **Golden path drift** — the template is updated, the 200 services created from it are not. Solve with automated upgrade PRs, not documentation.
- **Measure the platform as a product:** adoption %, time-to-first-deploy for a new service, and how many teams bypass it.
- **Most service catalogues are useless** because they're manually maintained and instantly stale — generate from what's actually deployed.
- **Governance that scales is automated, not reviewed** — a policy check in CI beats an architecture review board.

---

## Top traps

1. Splitting by technical layer → distributed monolith.
2. Shared database.
3. No timeout on an outbound call.
4. Retry at every layer → 27× amplification.
5. Retrying non-retryable errors.
6. No backpressure — only caller-side resilience.
7. E2E tests instead of contract tests.
8. Liveness probe that checks the database.
9. Round-robin with uneven request costs; connection-level LB for gRPC.
10. Never proposing to *merge* services.

---

## Interview Q&A — Lead / Principal

### Q1 · You inherit a distributed monolith *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"You join a team with 30 microservices. Nothing can be deployed independently — every release is a coordinated train. What do you do?"*

**Answer.** They have a **distributed monolith**: the operational cost of microservices with none of the benefit. First I'd measure rather than opine, because this argument is usually had on instinct. Two numbers: **services co-changed per pull request** — if A and B are in most PRs together, they're one service — and the shape of the synchronous call graph, because a request touching twelve services in a chain has multiplicative availability and can never be deployed independently. That data turns "I think the boundaries are wrong" into something the team can't argue with.

Then remediation in order of cheapness. **Merging services is usually the right first move and it's the one nobody proposes** — if two services always change together, collapsing them removes a network hop, a failure mode and a deployment dependency at once. Next, break synchronous chains where the caller doesn't actually need the answer now, converting them to events. Then fix the shared database if there is one — separate schemas with per-service permissions first, because that surfaces every illicit cross-boundary access as a permission error while remaining reversible.

The organisational half matters as much: per Conway, if the release train exists because teams are organised around layers rather than capabilities, the architecture will keep reverting. I'd expect this to be a multi-quarter programme, and I'd pick **one** service to make genuinely independently deployable as a proof, because an abstract migration plan gets deprioritised and a working example changes the conversation.

**Why it lands.** Measures instead of asserting, proposes merging (rare and correct), sequences by cost, addresses Conway, and lands a proof point.
**✗ Weak answer.** "Rewrite with proper boundaries" or "add more automation to the release train."
**↳ Follow-ups.** Which service would you merge first? How do you get the co-change data?

---

### Q2 · Retry amplification *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"A downstream service had a brief slowdown and the whole platform went down for 40 minutes. The slowdown lasted 30 seconds. Explain."*

**Answer.** Retry amplification into a metastable failure. Three layers each retrying three times is **27× load** on a service that was already struggling, delivered at exactly the wrong moment. The original 30-second slowdown becomes sustained overload, and critically **the system stays down after the trigger is gone, because the retries are now the load** — that's why recovery took 40 minutes rather than 30 seconds.

Fixes, and they're all structural rather than tuning. **Retry at one layer only**, usually the outermost that can meaningfully recover. **Retry budgets** — cap retries at a percentage of live traffic, typically around 10%, so retries can never dominate. **Exponential backoff with jitter**, because backoff alone just synchronises everyone into the same retry wave. **Circuit breakers** so a struggling dependency gets fewer calls, not more. And **deadline propagation**, so a downstream doesn't start work its caller has already abandoned.

Recovery also needs designing: on the way out, everything reconnects at once, so I'd want the equivalent of a slow start rather than instantaneous full load. And the detection point — this looks like "the platform is down" on every dashboard, so I'd want a signal that distinguishes *originating* failure from *amplified* failure, otherwise every incident review blames the wrong service.

**Why it lands.** The 27× arithmetic, metastability named, structural fixes over tuning, and the attribution problem in the postmortem.
**✗ Weak answer.** "Add a circuit breaker" alone — necessary, not sufficient.
**↳ Follow-ups.** What retry budget and why? How do you recover without a thundering herd?

---

### Q3 · Should we split this service? *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"A team wants to split their service because 'it's getting too big.' Approve?"*

**Answer.** Not on size — size isn't a reason, it's an observation. I'd ask what pressure they're actually feeling, because there are only a few that justify a split: a part needs to **scale independently**, a part needs a **different deployment cadence**, a part has a **different availability or compliance requirement**, or two teams are contending in the same codebase. Any of those is a real argument. "It's 40,000 lines" is not, and splitting on it converts a manageable code-organisation problem into a permanent distributed-systems problem — network failure, eventual consistency, distributed tracing, two pipelines.

If none of those pressures exist, the right answer is usually **modules with enforced boundaries inside the one deployable**: separate projects, a controlled reference graph, an architecture test in CI. That gets most of the benefit at a fraction of the cost, and it's reversible — moving a namespace is cheap, unpicking a wrongly-split service is not.

If a pressure does exist, split *that* seam only, and I'd want the data question answered first: what happens to the queries that currently work as a join? API composition, a read model fed by events, or deliberate duplication — decided **before** the split, because discovering it during cutover is how these stall.

**Why it lands.** Rejects the stated reason, enumerates the four legitimate pressures, offers the reversible alternative, and demands the query story up front.
**✗ Weak answer.** Approving because smaller services are "best practice."
**↳ Follow-ups.** How would you enforce module boundaries in .NET? What if they split anyway and it's wrong?

---

### Q4 · Who owns the shared library? *(Principal)* ⭐⭐⭐
**Asked as:** *"Twelve services each hand-roll retry, logging and auth. Should we build a shared library?"*

**Answer.** Probably, but the failure mode of shared libraries is worse than the duplication, so I'd design for it up front. The trap is a library that becomes a coupling point: every service must upgrade in lockstep, a breaking change requires twelve coordinated releases, and the library team becomes a bottleneck on everyone's roadmap. That's how a well-intentioned platform effort turns into the thing teams route around.

So: keep it strictly **additive and backward-compatible**, versioned independently, with services free to upgrade on their own schedule — and that means supporting more than one version concurrently, which is a real cost I'd name. Automate the upgrade with dependency-bump PRs rather than documentation, because **golden-path drift** is the certainty here: the template improves, the twelve services created from it don't. And measure adoption, not compliance — if teams aren't upgrading, the library isn't good enough, and mandating it just hides the signal.

The alternative worth mentioning: a **sidecar or service mesh** moves retry, mTLS and telemetry out of the library entirely, which is decisive if the estate is polyglot. For twelve .NET services, a library is cheaper and I'd say so — but I'd want an owner named, because an unowned shared library rots faster than the duplication it replaced.

**Why it lands.** Names the coupling failure, designs against it, prefers adoption over mandate, and offers the mesh alternative with a condition.
**✗ Weak answer.** "Yes, DRY" — with no version or ownership story.
**↳ Follow-ups.** How many versions do you support? What if one team refuses to upgrade?

---

### Quick-fire (30 seconds each)

- **"When should you NOT use microservices?"** → Small team, unclear domain boundaries, or no operational maturity. Microservices trade a code-complexity problem for a distributed-systems problem — you now own network failure, eventual consistency, distributed tracing and N deployment pipelines. If you can't name which capability needs to scale or deploy independently, a modular monolith gets you most of the benefit at a fraction of the cost.
- **"How do you decide service boundaries?"** → Business capability aligned to a DDD bounded context, sized so one team owns it. Then stop debating and measure: if two services are co-changed in most commits, they're one service. And boundaries drift — merging is as valid a correction as splitting.
- **"How do you query data spread across services?"** → API composition first if the result set is small, but it breaks the moment you need filtering, sorting or pagination across services. Then you build a read model: subscribe to the owning services' events, maintain a denormalised store, and accept a named staleness bound. Duplication is correct here — one writer, many read replicas of just the fields each service needs.

---

**Go deeper:** `17-Microservices/00`–`09` · **Related:** [[16-Distributed-Systems]], [[18-Event-Driven-Architecture]], [[31-DDD]], [[34-CQRS-EventSourcing-Saga-Outbox]]
