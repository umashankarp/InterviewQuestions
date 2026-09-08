# 4. Microservices — 30 Questions (Answered)

> **Method:** every answer opens with the definition as stated in the official source (Microsoft Learn — *.NET Microservices: Architecture for Containerized .NET Applications* and the **Azure Architecture Center**; **AWS Prescriptive Guidance** / **AWS Well-Architected Framework**), then adds the architect-level trade-off analysis. Source is named per question; full links in **References** at the end.

---

## Q1. What are microservices?

**Per Microsoft Learn (.NET Microservices architecture e-book, "What are microservices?"):** *"Microservices architecture is an approach to building a server application as a set of small services. Each service runs in its own process and communicates with other processes using protocols such as HTTP/HTTPS, WebSockets, or AMQP. Each microservice implements a specific end-to-end domain or business capability within a certain context boundary, and each must be developed autonomously and be deployable independently. Finally, each microservice should own its related domain data model and domain logic."*

**Per AWS ("What are microservices?"):** *"Microservices are an architectural and organizational approach to software development where software is composed of small independent services that communicate over well-defined APIs. These services are owned by small, self-contained teams."*

**Unpacking the definition into the properties that actually matter:**

| Property | What it means in practice | What breaks if you skip it |
|---|---|---|
| **Independently deployable** | Ship service A without coordinating a release of B | You have a distributed monolith — all the cost, none of the benefit |
| **Owns its data** | Private datastore; no other service reads its tables | Shared DB = shared schema = coupled deployments |
| **Bounded by a business capability** | "Payments", "Settlement", not "DataAccessService" | Every change touches every service |
| **Autonomous team ownership** | One team owns build → run → on-call | Conway's Law works against you |
| **Independently scalable** | Scale the fraud engine without scaling the profile API | You pay for peak on everything |
| **Failure-isolated** | One service degrading doesn't take the system down | A distributed single point of failure |

**Architect's framing:** microservices are primarily an **organisational and deployment-independence** strategy that happens to be implemented technically. Microsoft's own guidance is explicit that the payoff is *"long-term agility... enabling independent deployment"* — not raw performance. If you cannot articulate which team ships which service without asking permission, you do not have microservices.

---

## Q2. When should you use microservices?

**Per Microsoft Learn ("When to use microservices"):** the architecture is recommended for *"large, complex, and highly-scalable systems"* built by multiple teams, where you need *"long-term agility"* — the ability to release features independently and evolve subsystems at different rates.

**Per AWS Well-Architected (Reliability & Performance pillars):** decompose when you need independent scaling, independent fault isolation, and independent technology choices per workload.

**Use microservices when several of these are true:**

1. **Multiple teams** (Microsoft's guidance: teams of ~5–9, "two-pizza teams" in AWS terminology) are stepping on each other in one codebase/release train.
2. **Different scaling profiles** — fraud scoring needs 40 instances at peak, the customer-profile API needs 3.
3. **Different availability/compliance requirements** — a PCI-scoped card-vault service you want to keep small and separately audited.
4. **Different change rates** — a pricing engine changing daily against a core ledger changing quarterly.
5. **Different technology needs** — an ML scoring service in Python beside a .NET transaction service.
6. **Fault isolation is a hard requirement** — "reporting must never be able to take down payments."
7. **You already have** CI/CD, IaC, containers/orchestration, centralised logging, distributed tracing and on-call maturity. Microsoft lists this operational prerequisite explicitly; AWS frames it as operational excellence readiness.

**Architect's litmus test:** *"Can I name the team, the deployment cadence, the datastore and the on-call rotation for each proposed service?"* If not, you're proposing packaging, not architecture.

---

## Q3. When should you NOT use microservices?

**Per Microsoft Learn:** the monolith (and specifically the **modular monolith**) is recommended for *"small or simple applications"*, for teams that are small, and where the domain is not yet understood. The e-book and the Azure Architecture Center both warn that microservices add *"complexity in deployment, versioning, distributed transactions, testing, and monitoring."*

**Don't use them when:**

1. **The domain boundaries aren't known yet.** Microsoft's guidance and DDD practice both say: get the boundaries wrong and you pay for them in distributed refactoring, which is an order of magnitude more expensive than moving a folder. Start with a modular monolith and extract when a seam proves stable.
2. **One small team.** The coordination benefit is zero and the operational tax is 100 %.
3. **A simple CRUD application** with uniform load.
4. **Strong transactional consistency across most operations is required.** Losing ACID across a boundary means Sagas, compensation and eventual consistency — accept that only when you need the independence badly enough.
5. **No platform maturity.** No CI/CD, no container platform, no centralised observability → you have converted a debugging problem into a distributed debugging problem.
6. **Latency-critical tight coupling** — splitting two components that must talk 20 times per request converts in-process calls into network calls and destroys p99.
7. **Cost sensitivity at small scale** — per-service infrastructure, gateways, meshes and pipelines have a fixed floor.

**The strongest answer:** *"Default to a modular monolith with strict internal boundaries and its own module-per-schema data separation. That preserves the option to extract later at low cost, and most systems never need to."* This mirrors Microsoft's published guidance on starting with a monolith and evolving.

---

## Q4. How do you identify microservice boundaries?

**Per Microsoft Learn (Azure Architecture Center — "Using domain analysis to model microservices"):** the recommended method is **Domain-Driven Design**: (1) analyse the domain, (2) define **bounded contexts**, (3) use **tactical DDD** to identify **aggregates**, entities and domain services within each context, then (4) *"identify microservices from the aggregates"* — with the guidance that **a microservice should be no smaller than an aggregate, and a bounded context typically maps to one or a few services.**

**The practical sequence I use:**

1. **Event storming / domain analysis** with domain experts — map business events, commands and actors end-to-end.
2. **Identify bounded contexts** — places where the *same word means a different thing* ("Account" in Customer Onboarding vs "Account" in the Ledger). That linguistic seam is the single best boundary signal.
3. **Find aggregates** — consistency boundaries where invariants must hold transactionally. Microsoft's rule: an aggregate is the unit of transactional consistency, so **never split an aggregate across services**.
4. **Apply candidate-service criteria** (Azure Architecture Center lists these explicitly): a service should be **loosely coupled**, **highly cohesive** functionally, **independently deployable**, **owned by one team**, and **not chatty** with its neighbours.
5. **Validate against change history** — which files change together in git? Things that always change together belong together.
6. **Validate against data ownership** — if two candidate services need the same table with write access, the boundary is wrong.
7. **Validate against non-functional needs** — different scaling, availability or compliance profiles justify a split; identical profiles rarely do.

**Anti-signals that the boundary is wrong:** a synchronous call chain of 4+ services per request; distributed transactions needed for a routine operation; every feature requiring changes in three services; a service with no data of its own.

---

## Q5. What is a bounded context?

**Per Microsoft Learn (Azure Architecture Center / .NET microservices e-book):** a **bounded context** is a DDD strategic-design pattern — *"an explicit boundary within which a domain model applies. Each bounded context has its own ubiquitous language and its own model."* Microsoft's guidance: *"each microservice should be designed around a bounded context"* and *"the same entity can be modelled differently in different bounded contexts."*

**The canonical example, straight from the e-book's eShop domain:**

| Context | Model of "Product" |
|---|---|
| Catalog | Name, description, images, category, price |
| Ordering | Product ID, quantity, unit price at time of order |
| Inventory | SKU, warehouse location, quantity on hand, reorder level |

There is no single "Product" class shared across all three. Trying to build one is the **canonical modelling mistake** — you get a god-entity that every team must agree on, which reinstates the coupling microservices were supposed to remove.

**Why it matters architecturally:**
- It defines **model ownership** — inside the boundary, one team decides the model; outside, the model is not visible.
- It defines the **contract surface** — what crosses the boundary is a published DTO/event, not the internal model. Microsoft calls the mapping between contexts the **Anti-Corruption Layer**, and the map of relationships the **Context Map** (shared kernel, customer/supplier, conformist, ACL).
- It is the **unit of consistency and of language**, which is why it lines up so well with a service boundary and a team boundary.

---

## Q6. Why shouldn't services be split by technical layers?

**Per Microsoft Learn / Azure Architecture Center:** services should be decomposed by **business capability or subdomain**, not by technical function. The published anti-pattern is splitting into "UI service / business-logic service / data-access service" — horizontal slicing.

**Why it fails, concretely:**

1. **Every feature crosses every service.** "Add a field to a payment" now needs three coordinated deployments across three teams. You have maximised, not minimised, coordination — the exact opposite of the goal.
2. **No independent deployability**, therefore no microservices by definition (Q1).
3. **Chatty network calls replace in-process calls.** A layer boundary is called many times per request; a network boundary called many times per request is a latency and reliability disaster.
4. **No clear ownership.** Nobody owns "payments"; three teams each own a third of it.
5. **Shared data model.** The "data service" ends up owning everyone's tables — a shared database with extra HTTP hops.
6. **Failure amplification.** All requests traverse all layers, so any layer's outage is total.

**The correct decomposition is vertical:** each service contains its own API, business logic and data for one capability.

```
WRONG (horizontal)                     RIGHT (vertical)
┌──────────────┐                       ┌─────────┐┌──────────┐┌──────────┐
│  API layer   │                       │Payments ││Settlement││  Fraud   │
├──────────────┤                       │ API     ││ API      ││  API     │
│ Logic layer  │                       │ Logic   ││ Logic    ││  Logic   │
├──────────────┤                       │ Data    ││ Data     ││  Data    │
│  Data layer  │                       └─────────┘└──────────┘└──────────┘
└──────────────┘                        one team    one team    one team
```

*Layers still exist — inside each service.* That is Clean/Onion architecture within a vertical slice, which Microsoft's e-book recommends explicitly for complex microservices.

---

## Q7. What is database-per-service?

**Per Microsoft Learn (.NET microservices e-book):** *"Each microservice's persisted data must be private to that microservice and should only be accessed by that microservice's API. If the microservice's persisted data has to be updated by another microservice, that update must be done through the API."* Azure Architecture Center lists this as the **Database per Service** pattern; AWS Prescriptive Guidance publishes the same pattern under "Database per service".

**What it means:**
- Each service owns its schema, and **no other service issues queries against it** — not even read-only.
- The datastore *technology* can differ per service (polyglot persistence): the ledger on PostgreSQL/SQL Server for ACID, the product catalog on MongoDB, the session store on Redis, a high-volume event log on DynamoDB.
- Physical separation can be a separate database instance, a separate database on a shared instance, or (weakest but sometimes acceptable) a separate schema with per-service credentials enforcing access — AWS Prescriptive Guidance describes exactly this spectrum.

**What it costs, and how the docs say to handle it:**
- **No cross-service joins** → data composition happens in the API/BFF layer, or via **CQRS read models** built from events.
- **No distributed ACID transactions** → the documented answer is the **Saga pattern** (Azure Architecture Center; AWS Prescriptive Guidance) with compensating transactions.
- **Data duplication is expected and correct** — services keep local read-only copies of what they need, kept current by events. This is a deliberate trade of storage for autonomy.
- **Reporting/analytics** must not query service databases; publish to a data lake/warehouse (AWS: S3 + Glue + Athena/Redshift; Azure: Synapse) or maintain a dedicated read model.

---

## Q8. Why is a shared database problematic?

**Per Microsoft Learn:** a shared database creates *"tight coupling between microservices"* and defeats independent deployability; the e-book explicitly states the data must be private to each service.
**Per AWS Prescriptive Guidance:** the shared-database pattern is documented as an anti-pattern for microservices (allowed only as a transitional step in a strangler-fig migration).

**The five concrete failures:**

1. **Schema coupling = deployment coupling.** Any `ALTER TABLE` becomes a cross-team release event. You now have a distributed monolith with worse latency.
2. **Hidden write paths break invariants.** Service A enforces "balance cannot go negative" in code; Service B writes the table directly and bypasses it. The invariant is not enforced by the boundary, so it isn't enforced.
3. **Contention and blast radius.** One service's runaway query locks tables/consumes connections and degrades everyone. A single database is a single point of failure for all services sharing it.
4. **No independent scaling or technology choice.** Everyone is stuck with one engine, one instance size, one HA strategy.
5. **Ownership and accountability collapse.** When a data-integrity bug appears, no team owns the table.

**Legitimate transitional uses (be pragmatic, the docs are):** during a strangler-fig migration you may share temporarily, but with **explicit, enforced boundaries** — separate schemas, separate DB users with grants only on their own objects, no cross-schema foreign keys, and a dated plan to split. AWS's strangler-fig guidance describes exactly this staging.

---

## Q9. How do services communicate?

**Per Microsoft Learn (.NET microservices e-book, "Communication in a microservice architecture"):** communication is classified on two axes — **synchronous vs asynchronous protocol**, and **single receiver vs multiple receivers**:

| | Single receiver | Multiple receivers |
|---|---|---|
| **Synchronous** | HTTP/REST, gRPC request/response | (rare; anti-pattern) |
| **Asynchronous** | Command over a queue (AMQP/SQS) | Events over a topic/log (Kafka, SNS, Event Grid) |

The e-book's central guidance: *"a microservice-based application will often use a combination of these communication styles"* and — critically — *"you should try to minimize the communication between the internal microservices... asynchronous communication is preferred for inter-service communication."*

**In practice:**

- **Synchronous HTTP/REST** — external APIs, client→gateway, and internal queries where the caller genuinely needs the answer now. Cost: temporal coupling (both must be up), latency accumulation, cascading failure risk.
- **gRPC (HTTP/2 + Protobuf)** — internal service-to-service where you want strong contracts, low latency, streaming, and code generation. Microsoft recommends gRPC for internal inter-service communication in .NET.
- **Asynchronous messaging** — commands to a queue (one consumer), events to a topic/log (many consumers). Gives temporal decoupling, natural buffering/backpressure, retries and independent scaling. Cost: eventual consistency and operational complexity.
- **Never**: one service reading another's database (Q8), or a synchronous chain deeper than 2–3 hops.

**Architect's rule:** *queries synchronous, state changes and notifications asynchronous.* And every synchronous call needs a timeout, a retry policy (idempotent only), and a circuit breaker (§4 Q29).

---

## Q10. REST vs gRPC vs Kafka?

These are not three options for the same job — they occupy different points on the axes above.

| | REST/HTTP+JSON | gRPC | Kafka |
|---|---|---|---|
| Interaction | Request/response | Request/response + streaming | Publish/subscribe, durable log |
| Transport | HTTP/1.1 or 2 | **HTTP/2** | Custom TCP protocol |
| Payload | JSON (text) | **Protobuf** (binary, schema-first) | Any (Avro/Protobuf/JSON, usually with Schema Registry) |
| Contract | OpenAPI (optional, often drifts) | `.proto` — compiled, enforced | Schema Registry with compatibility rules |
| Coupling | Temporal (both up) | Temporal | **Temporally decoupled** |
| Latency | Highest of the three | Lowest (binary, multiplexed, no per-call handshake) | Producer-side low; end-to-end depends on consumer |
| Best for | Public/partner APIs, browsers | Internal service-to-service, high-volume, polyglot | Event distribution, replay, stream processing, buffering |
| Weakness | Verbose, no streaming semantics | Poor browser support (needs grpc-web), harder debugging | Not request/response; eventual consistency |

**Per Microsoft Learn:** gRPC is recommended for *"internal, high-performance service-to-service communication"*; REST for external-facing and browser-facing APIs.
**Per Apache Kafka documentation:** Kafka is *"a distributed event streaming platform"* providing *"publish and subscribe to streams of events, store streams durably and reliably for as long as you want, and process streams as they occur"* — note **durable storage and replay**, which is what separates it from an RPC mechanism entirely.

**How I choose:**
- Public/partner or browser → **REST** (+ OpenAPI, versioned).
- Internal synchronous, latency-sensitive, high volume → **gRPC**.
- State-change notification, fan-out, replay, buffering, stream processing → **Kafka**.
- Work distribution to a single consumer with per-message retry/DLQ → a **queue** (SQS/RabbitMQ), not Kafka.

Real systems use all three: REST at the edge, gRPC internally for queries, Kafka for events.

---

## Q11. Synchronous vs asynchronous communication?

**Per Microsoft Learn:** *"Asynchronous communication... is the preferred approach for communicating between microservices"* because it removes temporal coupling; synchronous HTTP chains between microservices are called out as something to minimise, since *"the availability of the whole chain is the product of the availability of each service."*

**Synchronous (HTTP/gRPC request-response):**
- ✅ Simple mental model, immediate consistency, easy debugging, natural for queries.
- ❌ **Temporal coupling** — the callee must be up *now*.
- ❌ **Availability multiplies down:** a chain of 4 services at 99.9 % each yields 99.6 % — roughly 3.5 hours/month of downtime created purely by the topology.
- ❌ **Latency accumulates**, and slow callees consume caller threads/connections (cascading failure).

**Asynchronous (queue/topic):**
- ✅ **Temporal decoupling** — the consumer can be down; messages wait durably.
- ✅ Natural **buffering and backpressure**, load levelling of spikes (Azure Architecture Center: **Queue-Based Load Levelling** pattern).
- ✅ Independent scaling of consumers, built-in retry/DLQ, fan-out to new consumers with no producer change.
- ❌ **Eventual consistency** — the caller cannot know the outcome immediately.
- ❌ Harder debugging (needs correlation IDs + distributed tracing through the broker), duplicate delivery, ordering concerns, operational overhead.

**Practical rule:** the caller needs the answer to complete *its own* response → synchronous. The caller only needs the work to *happen reliably* → asynchronous. In payments this is very concrete: authorisation is synchronous (the customer is waiting); settlement, notification, ledger posting and analytics are asynchronous.

---

## Q12. What is service discovery?

**Per Microsoft Learn / Azure Architecture Center:** service discovery is the mechanism by which a service locates the network addresses of instances of another service, given that in a dynamic, containerised environment *"instances are assigned dynamic IP addresses and the set of instances changes as instances scale, fail, and are replaced."*

**Two documented models:**

- **Client-side discovery** — the client queries a **service registry** (Consul, Eureka, etcd) and does its own load-balancing. More control, more client complexity, registry becomes a dependency.
- **Server-side discovery** — the client calls a stable address (a load balancer / DNS name) and the infrastructure routes. Simpler clients; the router must be highly available.

**How it's actually solved on the platforms you'll be asked about:**

- **Kubernetes (per Kubernetes docs):** a **Service** provides *"a stable IP address and DNS name"* for a dynamic set of Pods selected by label; kube-proxy programmes the routing, and CoreDNS resolves `my-svc.my-namespace.svc.cluster.local`. **This is server-side discovery built into the platform — no separate registry needed.** Headless services (`clusterIP: None`) return Pod IPs directly for client-side load balancing.
- **AWS:** **AWS Cloud Map** for service registry/discovery; **ECS Service Connect / Service Discovery** integrates Cloud Map with ECS; ALB/NLB target groups provide server-side discovery via health-checked registration.
- **Service mesh (Istio/Linkerd/App Mesh):** the sidecar proxy handles discovery, load balancing, retries and mTLS transparently (§12 Q21).

**Architect's answer:** on Kubernetes or ECS you should not build service discovery — the platform provides it. Where discovery matters architecturally is in **client-side load-balancing quality** (gRPC over a ClusterIP Service load-balances *connections*, not *requests*, so long-lived HTTP/2 connections pin to one Pod — the fix is a headless service with client-side LB, or a mesh).

---

## Q13. API Gateway vs service mesh?

**Per Azure Architecture Center (Gateway Routing / Gateway Aggregation / Gateway Offloading patterns) and AWS:** an **API Gateway** sits at the **edge**, handling **north-south** traffic (client → system): routing, aggregation, authentication, rate limiting, TLS termination, protocol translation.

**Per Istio / Linkerd / AWS App Mesh documentation:** a **service mesh** is *"a dedicated infrastructure layer for handling service-to-service communication"*, implemented with **sidecar proxies**, handling **east-west** traffic: mTLS, retries, timeouts, circuit breaking, traffic splitting (canary), and telemetry — **without application code changes**.

| | API Gateway | Service Mesh |
|---|---|---|
| Traffic | North-south (external → internal) | East-west (internal → internal) |
| Deployment | Centralised edge component | Sidecar per Pod (or ambient/node-level) |
| Concerns | AuthN/Z of end users, rate limits, aggregation, versioning, protocol translation, WAF | mTLS identity, retries, timeouts, circuit breaking, traffic shifting, observability |
| Awareness | Business/API contract level | Network/transport level, business-agnostic |
| Examples | AWS API Gateway, Azure API Management, Kong, YARP, Ocelot | Istio, Linkerd, AWS App Mesh, Consul Connect |

**They are complementary, not alternatives.** A typical production topology: client → CloudFront/WAF → API Gateway/ALB → (mesh ingress gateway) → services with sidecars communicating over mTLS.

**Architect's caution:** a mesh is a significant operational commitment (control plane, sidecar resource cost, upgrade choreography, added latency per hop). Adopt one when you have enough services that per-service resilience/mTLS/telemetry code duplication is genuinely painful — typically double-digit service counts. Below that, resilience libraries (Polly / `Microsoft.Extensions.Http.Resilience`) and TLS at the ALB are simpler and sufficient.

---

## Q14. What belongs in an API Gateway?

**Per Azure Architecture Center, the three gateway patterns define the legitimate responsibilities:**
- **Gateway Routing** — route requests to multiple backend services through a single endpoint.
- **Gateway Aggregation** — aggregate multiple backend requests into one, reducing chattiness for the client.
- **Gateway Offloading** — offload shared, cross-cutting functionality from individual services to the gateway.

**Per AWS API Gateway documentation**, the service provides: request routing, authorization (IAM, Lambda authorizers, Cognito/JWT), throttling and usage plans, request/response transformation, caching, API keys, WAF integration, and access logging.

**So, what belongs there:**

1. **Routing** to backend services by path/host/version.
2. **TLS termination** and certificate management.
3. **Authentication** — validating tokens once at the edge (JWT signature/issuer/audience/expiry).
4. **Coarse-grained authorization** — "does this client have the `payments` scope at all?"
5. **Rate limiting / throttling / quotas** per client or plan.
6. **Request/response transformation** and protocol translation (REST ↔ gRPC/SOAP), for legacy or partner integration.
7. **Caching** of cacheable GETs.
8. **Aggregation** — for a small, well-defined set of client-facing composites (or delegate this to a BFF, Q16).
9. **Cross-cutting observability** — access logs, correlation ID injection, metrics.
10. **Security controls** — WAF, IP allow/deny, payload size limits, header sanitisation.

---

## Q15. What should NOT be placed in an API Gateway?

**Per Azure Architecture Center's own warnings on the gateway patterns** (and universal field experience), the gateway must not become a shared bottleneck or a place where business logic accumulates.

**Do not put in the gateway:**

1. **Business logic or domain rules.** The moment "if amount > 10,000 then require dual approval" lives in the gateway, every team must change a shared component to ship a feature. This is the **"smart pipes, dumb endpoints"** anti-pattern and it recreates the ESB.
2. **Fine-grained, resource-level authorization.** "Can *this user* view *this account*?" needs domain data the gateway doesn't have. This must be enforced in the owning service (also the OWASP API #1 BOLA mitigation — §16 Q3).
3. **Data transformation that encodes domain semantics** (currency conversion, fee calculation, enrichment from a database).
4. **Orchestration of long-running workflows / sagas.** Use a dedicated orchestrator or choreography; a gateway is a stateless request router.
5. **Stateful session data.** Gateways must scale horizontally.
6. **Direct database access.**
7. **Per-service custom code that only one team needs.** That belongs in a BFF owned by that team, not in the shared gateway.
8. **Anything that makes the gateway a single point of failure without HA** — and even with HA, keep its logic thin so its failure modes stay simple.

**The governance rule I enforce:** *a change to the gateway should almost never be required to ship a feature in one service.* If gateway changes appear in most feature PRs, the gateway has absorbed responsibilities that belong in services.

---

## Q16. What is BFF?

**Per Azure Architecture Center ("Backends for Frontends" pattern):** *"Create separate backend services to be consumed by specific frontend applications or interfaces... this pattern can be useful when you want to avoid customizing a single backend for multiple interfaces."* The documented problem it solves: a single general-purpose backend accumulating conflicting requirements from web, mobile and third-party clients, becoming a bottleneck for all of them.

**Structure:**

```
   Mobile app ──▶ Mobile BFF ─┐
   Web SPA    ──▶ Web BFF    ─┼──▶ Payments │ Accounts │ Fraud │ Notifications
   Partner    ──▶ Partner BFF ┘         (microservices)
```

**Why it works:**
- **Client-optimised payloads.** Mobile gets a lean, aggregated response over a slow network; the web app gets a richer one. No over-fetching, no `?fields=` complexity.
- **Ownership alignment.** The frontend team owns its BFF, so UI-driven changes don't queue behind another team's backlog.
- **Aggregation lives somewhere sane** — one round trip for the client instead of six, without polluting the shared gateway or the domain services.
- **Security boundary.** A web BFF can hold the OAuth tokens server-side (the **BFF pattern for SPAs**, now the recommended OAuth practice — see §15 Q13), using an HttpOnly cookie to the browser so tokens never touch JavaScript.

**Costs and cautions (also documented):** code duplication across BFFs (accept it — a little duplication beats a shared, contested layer); more deployables; and the real risk of a BFF drifting into business logic. Keep BFFs **thin**: aggregation, transformation, client-specific concerns. Domain rules stay in the services.

---

## Q17. How do you handle distributed transactions?

**Per Microsoft Learn (.NET microservices e-book) and Azure Architecture Center:** with database-per-service you cannot use ACID transactions across services; two-phase commit (2PC/XA) is *not recommended* for microservices because it requires distributed locking, blocks on coordinator failure, and couples availability of all participants. The documented alternative is the **Saga pattern** with **compensating transactions**.
**AWS Prescriptive Guidance** publishes the same recommendation (Saga pattern, with Step Functions as an orchestrator implementation).

**The toolkit, in order of preference:**

1. **Redesign to avoid the distributed transaction.** The best answer. If two things must be atomic, they probably belong in the same aggregate and therefore the same service. Ask this first — interviewers reward it.
2. **Saga with compensations** (Q18–Q21) — a sequence of local ACID transactions, each publishing an event/command that triggers the next; failures trigger compensating transactions that semantically undo prior steps.
3. **Outbox pattern** for atomicity between a local DB write and a message publish (Q22–Q23) — this is the piece that makes sagas reliable.
4. **Idempotency + retries** so partial failures can be re-driven safely (Q24–Q26).
5. **Reconciliation** — a scheduled process comparing state across services and flagging/repairing breaks. In financial systems this is **mandatory** regardless of how good your saga is; it is the audit control that proves correctness.
6. **Try-Confirm/Cancel (TCC)** — reserve resources, then confirm or cancel. Useful for inventory/limits (e.g. reserve a credit limit, then confirm on settlement).

**What to say about 2PC:** know it (prepare phase → all vote → commit/abort), know it gives ACID across resources, and know why it's rejected here: synchronous blocking, coordinator single point of failure, locks held across network calls, and unavailability of all participants during a partition — precisely the properties microservices exist to avoid.

---

## Q18. Explain Saga pattern.

**Per Azure Architecture Center ("Saga design pattern"):** *"A saga is a sequence of local transactions. Each local transaction updates the database and publishes a message or event that triggers the next local transaction in the saga. If a local transaction fails because it violates a business rule, the saga executes a series of compensating transactions that undo the changes made by the preceding local transactions."*

**Worked example — an order/payment saga:**

| Step | Local transaction | Compensation |
|---|---|---|
| 1 | Order service: create order (`PENDING`) | Cancel order |
| 2 | Payment service: authorise card | Void/refund authorisation |
| 3 | Inventory service: reserve stock | Release reservation |
| 4 | Shipping service: create shipment | Cancel shipment |
| 5 | Order service: mark `CONFIRMED` | — |

If step 3 fails, the saga runs compensations for steps 2 and 1, in reverse order.

**The properties you must state:**
- Each local transaction is **ACID within its own service**; the saga overall is **ACD but not I** — there is **no isolation**. Intermediate states are visible to other transactions, which is why you need semantic locks/status fields (`PENDING`, `RESERVED`) so other operations behave correctly on in-flight data. Azure's documentation calls out this lack of isolation explicitly, along with countermeasures (semantic lock, commutative updates, pessimistic view, re-read value, version file, by-value).
- **Compensations must be idempotent and must not fail** (retry until they succeed, then escalate to a human queue — never silently drop).
- The saga must be **durable**: its state survives a crash. Persist saga state, don't hold it in memory.
- **Observability is mandatory**: a saga ID correlating every step, plus a dashboard of stuck sagas.

---

## Q19. Saga orchestration vs choreography?

**Per Azure Architecture Center**, the two implementation approaches:

**Choreography** — *"each service produces and listens to other services' events and decides if an action should be taken."* No central coordinator; the workflow is emergent.

```
Order ──OrderCreated──▶ Payment ──PaymentAuthorized──▶ Inventory ──StockReserved──▶ Shipping
```

| ✅ | ❌ |
|---|---|
| No single point of failure/coordination | **The workflow exists nowhere explicitly** — you must read N services to understand it |
| Loose coupling; add a consumer without touching producers | Cyclic dependencies creep in |
| Simple for short flows (2–4 steps) | Hard to debug and to reason about compensation ordering |
| Naturally scalable | Risk of "event spaghetti" as it grows |

**Orchestration** — *"a centralized orchestrator (object) tells the participants what local transactions to execute."*

```
                 ┌──────────────┐
                 │ Saga         │──1. AuthorizePayment──▶ Payment
                 │ Orchestrator │──2. ReserveStock──────▶ Inventory
                 │ (state m/c)  │──3. CreateShipment────▶ Shipping
                 └──────────────┘
```

| ✅ | ❌ |
|---|---|
| The workflow is **explicit, versioned and testable in one place** | The orchestrator is a component to build, deploy, scale and make HA |
| Straightforward compensation logic and timeout handling | Risk of it becoming a "god service" holding business logic |
| Excellent observability — one place shows saga state | Slightly more coupling (orchestrator knows the participants) |
| Easy to add steps, reorder, or branch | |

**My default recommendation:** **choreography for short, stable, 2–3-step flows; orchestration for anything business-critical, multi-step, or requiring visibility and manual intervention** — which describes essentially every payment/settlement/onboarding flow in financial services. Regulators and operations teams need to answer "where is this transaction?" in one query, and orchestration gives you that. Implementations: MassTransit state machines / NServiceBus sagas / Dapr Workflow in .NET; **AWS Step Functions** or **Azure Durable Functions** as managed orchestrators.

---

## Q20. What happens if a Saga step fails?

**Distinguish failure classes first — this is the answer that shows seniority:**

| Failure type | Example | Correct handling |
|---|---|---|
| **Transient** (retryable) | Timeout, 503, deadlock, throttling | Retry with exponential backoff + jitter, bounded attempts, idempotency key |
| **Business/validation** (non-retryable) | Insufficient funds, limit exceeded, card declined | Do **not** retry — start compensation immediately |
| **Poison/unprocessable** | Malformed message, unknown schema version | DLQ + alert; never block the stream |
| **Compensation failure** | Refund API down | Retry indefinitely with backoff; escalate to a manual-intervention queue after N attempts — **never drop** |
| **Timeout/no response** | Step neither succeeded nor failed | Query the participant for status (idempotent status endpoint), then decide; reconcile |

**The flow on a genuine business failure:**
1. Orchestrator (or the reacting service) records the failure against the saga state.
2. Compensating transactions run **in reverse order** for all completed steps.
3. Saga is marked `COMPENSATED`/`FAILED`; a domain event announces the outcome so downstream systems and the customer are informed.
4. Metrics/alerts fire on compensation rate — a spike is an incident signal.

**The hard case to mention:** a step that is **not compensable** (an email sent, a payment settled to the scheme). This is why saga step ordering matters — **put irreversible steps last**, and use *pivot transaction* terminology: steps before the pivot are compensable, steps after are retryable-until-success. If you cannot order it that way, you need TCC (reserve first, commit later) instead.

---

## Q21. What is compensation?

**Per Azure Architecture Center ("Compensating Transaction pattern"):** *"Undo the work performed by a series of steps, which together define an eventually consistent operation, if one or more of the steps fail."* The documentation is explicit that *"a compensating transaction might not be able to simply replace the current state with the state the system was in at the start of the operation"* — it must apply a **semantic** undo appropriate to the business.

**Why "compensation ≠ rollback":**

| Database rollback | Compensation |
|---|---|
| Removes all trace — as if it never happened | A **new transaction** that semantically offsets the first; both are visible in history |
| Guaranteed by the engine | Business logic you must write and test |
| Atomic and isolated | Runs later; others may have observed the intermediate state |
| Always possible before commit | May be impossible (email sent) or partial (cancellation fee retained) |

**Concrete examples:**
- Authorised a card → compensation is a **void or refund**, which appears on the customer's statement. It is not invisible.
- Reserved inventory → compensation releases the reservation, but another customer may have been told "out of stock" in the meantime.
- Debited an account → compensation is a **credit adjustment posting**, and in a ledger both entries remain permanently for audit — which is *exactly what a financial regulator requires*.
- Sent a confirmation email → compensation is a *second* email ("your order was cancelled"). You cannot unsend.

**Engineering requirements:** compensations must be **idempotent** (they will be retried), **commutative where possible**, **always eventually successful** (with escalation), and **auditable**. In a ledger system, compensation is naturally expressed as a reversing journal entry — which is why double-entry accounting and sagas fit together so well.

---

## Q22. What is the Outbox pattern?

**Per Azure Architecture Center / AWS Prescriptive Guidance ("Transactional outbox pattern"):** the pattern *"ensures that messages are published reliably by storing them in an outbox table in the same database transaction as the business data, and then publishing them to the message broker asynchronously."*

**Mechanism:**

```sql
BEGIN TRANSACTION;                                  -- ONE local ACID transaction
  INSERT INTO Payments (Id, Amount, Status) VALUES (@id, @amt, 'AUTHORIZED');
  INSERT INTO Outbox (Id, AggregateId, Type, Payload, OccurredAt, ProcessedAt)
       VALUES (@msgId, @id, 'PaymentAuthorized', @json, SYSUTCDATETIME(), NULL);
COMMIT;
```

Then a separate **message relay** (a background worker polling the table, or **CDC** reading the transaction log — Debezium/DMS) reads unprocessed rows and publishes them to Kafka/SNS/Service Bus, marking them processed (or deleting them) after a successful publish.

```
┌──────────┐   1. one tx    ┌────────────┐   2. poll/CDC   ┌────────┐  3. publish  ┌───────┐
│ Service  │───────────────▶│ DB: data + │────────────────▶│ Relay  │─────────────▶│ Kafka │
└──────────┘                │   outbox   │                 └────────┘              └───────┘
                            └────────────┘
```

**Delivery semantics:** the relay publishes then marks — so a crash between the two causes a **re-publish**. The outbox therefore gives **at-least-once** delivery, which is why **consumers must be idempotent** (Q25). Combined with Kafka's idempotent producer you can de-duplicate at the broker level too, but consumer idempotency remains the durable guarantee.

**Implementation notes:** index the outbox on `(ProcessedAt, OccurredAt)`; purge/archive processed rows (the table becomes hot); publish in `OccurredAt`/sequence order per aggregate if ordering matters; use `SELECT ... FOR UPDATE SKIP LOCKED` (PostgreSQL) or `READPAST` (SQL Server) to run multiple relay instances safely.

---

## Q23. Why do you need Outbox?

**Because of the dual-write problem**, which AWS Prescriptive Guidance and Azure both name explicitly: *you cannot atomically write to a database and publish to a message broker*, because they are two separate systems with no shared transaction.

**The two failure orders, and why both are broken:**

```
(a) Commit DB, then publish:
    DB: payment AUTHORIZED  ✔
    → process crashes / broker unavailable ✘
    Result: money moved, but no PaymentAuthorized event.
            Downstream (ledger, notifications, settlement) never learn. SILENT DATA LOSS.

(b) Publish, then commit DB:
    Kafka: PaymentAuthorized ✔
    → DB commit fails ✘
    Result: the world believes a payment happened that does not exist. PHANTOM EVENT.
```

Both are unacceptable in a financial system — (a) causes reconciliation breaks and customer complaints; (b) causes downstream systems to act on a transaction that never occurred.

**Why not just use a distributed transaction (XA)?** It requires 2PC across the DB and the broker, most modern brokers (Kafka, SQS, most cloud buses) don't support XA, and even where supported it reintroduces blocking, coordinator failure and availability coupling (Q17).

**Why not "publish in a `finally`" or "retry the publish in memory"?** A process crash, pod eviction or node failure loses the in-memory retry. Durability must be in the same transactional store as the business data — which is precisely what the outbox table is.

**The one-sentence version for an interview:** *"Outbox turns an unsafe dual-write into a single local ACID write plus an idempotent, retryable relay — trading immediate publication for guaranteed publication."*

---

## Q24. What is idempotency?

**Per the HTTP specification (RFC 9110, referenced by Microsoft's API guidance):** *"A request method is considered idempotent if the intended effect on the server of multiple identical requests with that method is the same as the effect for a single such request."* `GET`, `PUT`, `DELETE`, `HEAD`, `OPTIONS` are idempotent by definition; **`POST` is not**.

**In distributed systems terms:** an operation is idempotent if applying it N times produces the same system state as applying it once. This is what makes **retries safe**, and since retries are unavoidable in a network (a timeout tells you nothing about whether the other side succeeded), **idempotency is the foundation of reliable distributed processing**.

**Note the distinction interviewers probe:** idempotency is about **state**, not about the **response**. `DELETE /payments/1` twice leaves the same state; the second may return 404. That is still idempotent. Ideally you return the *same* response for a repeated idempotent request — which is what an idempotency-key store gives you.

**Natural vs enforced idempotency:**
- **Naturally idempotent:** `SET status = 'SETTLED'` (absolute assignment), `PUT` of a full resource, an upsert keyed by a business ID.
- **Not naturally idempotent:** `balance = balance + 100` (relative), "create a new order", "send an email", "publish an event".

For the second class you must *enforce* idempotency with a key and a de-duplication store (Q25).

---

## Q25. How do you make a consumer idempotent?

**Per Azure Architecture Center ("Idempotent message processing") and AWS guidance (Lambda Powertools idempotency, SQS/EventBridge at-least-once semantics):** because virtually every broker guarantees **at-least-once** delivery, *"consumers must be idempotent"* — the duplicate handling is the consumer's responsibility.

**Technique 1 — de-duplication store (the general answer):**

```csharp
public async Task HandleAsync(PaymentAuthorized evt, CancellationToken ct)
{
    await using var tx = await _db.Database.BeginTransactionAsync(ct);

    // atomic insert of the message id; PK violation ⇒ already processed
    var inserted = await _db.ProcessedMessages
        .TryInsertAsync(new ProcessedMessage(evt.MessageId, DateTime.UtcNow), ct);
    if (!inserted) { await tx.RollbackAsync(ct); return; }      // duplicate — drop silently

    await _ledger.PostAsync(evt, ct);                            // business work
    await _db.SaveChangesAsync(ct);
    await tx.CommitAsync(ct);                                    // dedup record + work commit together
}
```

The essential property: **the de-duplication record and the business effect commit in the same local transaction.** If they are separate, a crash between them re-opens the duplicate window.

**Technique 2 — natural idempotency by design.** Make the operation absolute rather than relative: `UPDATE Payment SET Status='SETTLED', SettledAt=@t WHERE Id=@id AND Status='AUTHORIZED'` — running it twice changes nothing the second time. Prefer this whenever the domain allows; it needs no extra store.

**Technique 3 — versioning / optimistic concurrency.** Include an expected version; reject or ignore out-of-date or already-applied updates (`WHERE Version = @expected`). Also solves out-of-order events (Q5 §5 Q13).

**Technique 4 — idempotency key at the API edge** for `POST` (Q26).

**Operational details:** the dedup table needs a **TTL/retention** (e.g. 7 days, longer than the maximum possible redelivery window) and an index/partition strategy so it doesn't become the hottest table in the system. Redis with TTL is a common alternative, but note it is not transactional with your database — use it as a fast pre-filter, keep the durable check in the DB.

---

## Q26. How do you handle duplicate events?

**Layered defence — the answer should list all four layers:**

**1. Prevent what you can at the producer.**
- Kafka: **`enable.idempotence=true`** (per Kafka docs, this makes the producer assign a producer ID and sequence numbers so the broker deduplicates retries within a session — exactly-once *per partition per producer session*). It does **not** deduplicate an application that publishes the same logical event twice.
- Outbox with a stable, deterministic `MessageId` per business event, so a relay re-publish carries the *same* ID.

**2. Deduplicate at the consumer (the durable guarantee).** As Q25 — a processed-message table keyed on `MessageId`, committed with the work.

**3. Make the effect naturally idempotent.** Absolute state transitions, upserts, `INSERT ... ON CONFLICT DO NOTHING`, conditional updates guarded by current status. This is the cheapest and most robust layer — no extra state.

**4. Detect and reconcile.** Metrics on duplicate rate; a reconciliation job comparing your state against the source of truth (settlement files, the counterparty's report). In payments this is a regulatory control, not an optimisation.

**Choosing the deduplication key** — get this right or the whole scheme fails:
- Use a **business-meaningful, producer-generated ID** (`paymentId + eventType + version`), not the broker's offset (which changes on re-partitioning/replay) and not a hash of the payload (which changes when a non-semantic field changes).
- The key must be **stable across retries and across producer restarts**.

**Window management:** dedup state cannot be infinite. Size the retention to exceed the broker's maximum redelivery window and your longest possible outage (7–30 days is typical), and document the residual risk beyond it.

---

## Q27. How do you handle retries?

**Per Azure Architecture Center ("Retry pattern") and AWS Well-Architected / AWS SDK guidance:** retries must be applied only to **transient** faults, with **exponential backoff and jitter**, a **bounded** number of attempts, and combined with the **Circuit Breaker** pattern to avoid retrying against a persistently failing dependency.

**The rules, each with its reason:**

1. **Only retry transient failures.** Timeouts, 429, 502/503/504, connection resets, deadlocks, throttling. **Never** retry 400/401/403/404/422 — the answer will not change and you are wasting capacity.
2. **Only retry idempotent operations** — or make the operation idempotent first with an idempotency key (Q26). Retrying a non-idempotent payment authorisation is how you double-charge a customer.
3. **Exponential backoff with jitter.** AWS's published guidance ("Exponential Backoff and Jitter") shows that backoff *without* jitter still synchronises clients into waves; full/equal jitter is what actually spreads them.
4. **Bounded attempts and a bounded total budget.** 3–5 attempts, with a total-request timeout that accounts for all attempts — otherwise a 5× retry on a 10 s timeout is a 50 s user-visible hang.
5. **Circuit breaker in front of retries** so a dead dependency isn't hammered (Q29).
6. **Retry at one layer only.** Retries nested at the SDK, the HTTP handler, the service and the client multiply: 3×3×3 = 27 calls from one user action. Pick a layer and disable the others.

```csharp
builder.Services.AddHttpClient<ISchemeClient, VisaClient>()
    .AddStandardResilienceHandler(o =>
    {
        o.Retry.MaxRetryAttempts = 3;
        o.Retry.BackoffType      = DelayBackoffType.Exponential;
        o.Retry.UseJitter        = true;
        o.AttemptTimeout.Timeout      = TimeSpan.FromSeconds(2);
        o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(10);
        o.CircuitBreaker.FailureRatio = 0.5;
    });
```

**For message consumers:** retry in place a few times, then move to a **retry topic/queue** with a longer delay, then to a **DLQ** — never block the partition/queue indefinitely on one poison message (§7 Q13–Q15, §8 Q28–Q29).

---

## Q28. How do you prevent retry storms?

**A retry storm (a "metastable failure"):** a dependency slows → callers time out → callers retry → offered load multiplies → the dependency degrades further → *even after the original trigger is gone, the retry load keeps it down.* AWS's Builders' Library documents this class of failure and its mitigations directly.

**The controls, in the order I would apply them:**

1. **Jittered exponential backoff** (AWS: "Exponential Backoff and Jitter") — prevents clients from synchronising into retry waves.
2. **Circuit breakers** — stop sending traffic to a failing dependency entirely; this is the single most effective brake (Q29).
3. **Retry budgets / token buckets** — allow retries only up to a percentage of the base request rate (e.g. 10 %). AWS SDKs and Envoy implement exactly this. Once the budget is exhausted, fail fast instead of retrying. This is the most robust mechanism and worth naming explicitly.
4. **Retry at one layer only** (Q27, rule 6) — multiplicative retries are the most common self-inflicted cause.
5. **Bounded concurrency / bulkheads** so retries cannot consume all threads or connections (Q30).
6. **Load shedding at the server** — return 429/503 with `Retry-After` *quickly*. Fast rejection is far better than slow queuing; it lets clients back off and keeps the server's queue short.
7. **Client-side rate limiting and `Retry-After` compliance.**
8. **Idempotency**, so aggressive retries at least remain *safe* while you contain them.

**Detection:** a graph where downstream request rate is far above upstream user request rate, and does not fall when user traffic falls. Alert on the ratio `downstream_calls / inbound_requests` — it is the cleanest storm signal.

---

## Q29. What is a circuit breaker?

**Per Azure Architecture Center ("Circuit Breaker pattern"):** *"Handle faults that might take a variable amount of time to recover from, when connecting to a remote service or resource. This can improve the stability and resiliency of an application."* The pattern acts as a proxy that monitors failures and, past a threshold, *"prevents an application from repeatedly trying to execute an operation that's likely to fail."*

**The three states (as documented):**

```
        failure threshold exceeded
 CLOSED ──────────────────────────▶ OPEN ──── break duration elapsed ───▶ HALF-OPEN
   ▲                                  ▲                                       │
   │        trial call succeeds       │       trial call fails                │
   └──────────────────────────────────┴───────────────────────────────────────┘
```

- **Closed** — calls flow through; failures are counted (typically as a ratio over a sampling window).
- **Open** — calls **fail immediately** without contacting the dependency (fail fast). This protects *both* sides: the caller stops burning threads and time; the dependency gets breathing room to recover.
- **Half-open** — after the break duration, a limited number of trial calls are allowed. Success closes the circuit; failure re-opens it (often with a longer break).

```csharp
o.CircuitBreaker.FailureRatio      = 0.5;                        // 50% of sampled calls failing
o.CircuitBreaker.MinimumThroughput = 20;                         // ignore small samples (statistical validity)
o.CircuitBreaker.SamplingDuration  = TimeSpan.FromSeconds(30);
o.CircuitBreaker.BreakDuration     = TimeSpan.FromSeconds(15);
```

**Design points that earn credit:**
- **Ratio-based, not count-based**, with a **minimum throughput** — otherwise 2 failures out of 2 calls trips the breaker on noise.
- **One breaker per dependency (and often per endpoint/partition)** — a global breaker means a failure in a non-critical dependency blocks a critical one.
- **Pair with a fallback**: cached/stale data, a default value, a queued "we'll process this later", or a clear degraded response — this is what turns fail-fast into **graceful degradation**.
- **Alert on state transitions.** A breaker opening is a first-class incident signal.
- Circuit breaker and retry compose in a specific order: retry *inside*, breaker *outside*, so exhausted retries feed the breaker's failure count.

---

## Q30. What is bulkhead isolation?

**Per Azure Architecture Center ("Bulkhead pattern"):** *"Isolate elements of an application into pools so that if one fails, the others will continue to function."* The name comes from ship hull compartments — a breach floods one compartment, not the vessel.

**Failure it prevents:** one slow dependency consuming a *shared* resource (thread pool, connection pool, memory) and thereby taking down functionality that doesn't even use it. Classic incident: a slow third-party FX-rate API holds every request thread; the login endpoint, which never calls FX, starts timing out. The whole service is down because of a non-critical dependency.

**Implementation levels:**

| Level | Mechanism |
|---|---|
| **In-process** | A `SemaphoreSlim` / rate-limiter policy **per dependency**, capping concurrent calls; separate `HttpClient` instances with their own `MaxConnectionsPerServer`; separate connection pools per datastore |
| **Thread/queue** | Separate `Channel<T>` + worker pool per workload class (critical vs batch) |
| **Process/container** | Separate deployments for critical vs non-critical endpoints; Kubernetes resource requests/limits per Pod |
| **Infrastructure** | Separate node pools, separate clusters, separate databases/partitions per tenant; AWS **cell-based architecture** and **shuffle sharding** (documented in the AWS Builders' Library) to bound blast radius per customer |

```csharp
// per-dependency concurrency cap — one dependency cannot consume the whole app
builder.Services.AddHttpClient<IFxClient, FxClient>()
    .AddResilienceHandler("fx", b => b
        .AddConcurrencyLimiter(permitLimit: 20, queueLimit: 0)   // fail fast beyond 20 in flight
        .AddTimeout(TimeSpan.FromSeconds(2))
        .AddCircuitBreaker(new() { FailureRatio = 0.5, MinimumThroughput = 20 }));
```

**Architect's framing:** bulkheads, circuit breakers and timeouts are three parts of one strategy — **timeouts bound how long a failure lasts, bulkheads bound how much of the system it can consume, and circuit breakers stop you feeding it.** Any one alone is insufficient. AWS's shuffle sharding is the same idea applied to tenants: it reduces the probability that any two customers share the *same* set of resources, so a single bad actor degrades a tiny fraction of the fleet.

---

## References — official documentation

| Topic | Source |
|---|---|
| .NET Microservices: Architecture for Containerized .NET Applications (full e-book) | https://learn.microsoft.com/dotnet/architecture/microservices/ |
| What are microservices? (Microsoft) | https://learn.microsoft.com/dotnet/architecture/microservices/architect-microservice-container-applications/microservices-architecture |
| What are microservices? (AWS) | https://aws.amazon.com/microservices/ |
| Microservices architecture design (Azure Architecture Center) | https://learn.microsoft.com/azure/architecture/guide/architecture-styles/microservices |
| Using domain analysis to model microservices | https://learn.microsoft.com/azure/architecture/microservices/model/domain-analysis |
| Identifying microservice boundaries | https://learn.microsoft.com/azure/architecture/microservices/model/microservice-boundaries |
| Data in microservices / database per service | https://learn.microsoft.com/dotnet/architecture/microservices/architect-microservice-container-applications/data-sovereignty-per-microservice |
| Enabling database per service (AWS Prescriptive Guidance) | https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/database-per-service.html |
| Communication in a microservice architecture | https://learn.microsoft.com/dotnet/architecture/microservices/architect-microservice-container-applications/communication-in-microservice-architecture |
| gRPC on .NET / comparison with HTTP APIs | https://learn.microsoft.com/aspnet/core/grpc/comparison |
| Apache Kafka — Introduction | https://kafka.apache.org/documentation/#gettingStarted |
| Service discovery / Kubernetes Service | https://kubernetes.io/docs/concepts/services-networking/service/ |
| AWS Cloud Map | https://docs.aws.amazon.com/cloud-map/latest/dg/what-is-cloud-map.html |
| Gateway Routing / Aggregation / Offloading patterns | https://learn.microsoft.com/azure/architecture/patterns/gateway-routing |
| API Gateway pattern (microservices) | https://learn.microsoft.com/azure/architecture/microservices/design/gateway |
| Amazon API Gateway developer guide | https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html |
| Backends for Frontends pattern | https://learn.microsoft.com/azure/architecture/patterns/backends-for-frontends |
| Saga design pattern | https://learn.microsoft.com/azure/architecture/patterns/saga |
| Saga pattern (AWS Prescriptive Guidance) | https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/saga-pattern.html |
| Compensating Transaction pattern | https://learn.microsoft.com/azure/architecture/patterns/compensating-transaction |
| Transactional outbox pattern (AWS) | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html |
| Idempotent message processing / consumer | https://learn.microsoft.com/azure/architecture/reference-architectures/containers/aks-mission-critical/mission-critical-data-platform |
| HTTP semantics — idempotent methods (RFC 9110 §9.2.2) | https://www.rfc-editor.org/rfc/rfc9110#name-idempotent-methods |
| Retry pattern | https://learn.microsoft.com/azure/architecture/patterns/retry |
| Timeouts, retries and backoff with jitter (AWS Builders' Library) | https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/ |
| Exponential backoff and jitter (AWS) | https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ |
| Circuit Breaker pattern | https://learn.microsoft.com/azure/architecture/patterns/circuit-breaker |
| Bulkhead pattern | https://learn.microsoft.com/azure/architecture/patterns/bulkhead |
| Workload isolation / shuffle sharding (AWS Builders' Library) | https://aws.amazon.com/builders-library/workload-isolation-using-shuffle-sharding/ |
| Building resilient services (.NET resilience) | https://learn.microsoft.com/dotnet/core/resilience/ |

---

**Previous:** [03 — Async/Await & Performance](./03-Async-Await-Performance.md) | **Next:** [05 — Distributed Systems](./05-Distributed-Systems.md)
