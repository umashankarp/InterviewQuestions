(function (r) {
registerTopic('17-microservices', {
related: ['16-distributed-systems', '36-saga', '38-api-gateway'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['fundamentals', 'trade-offs'],
  q: r`What problem do microservices actually solve, and what do they cost?`,
  a: r`Microservices are primarily an **organisational scaling** tool: they let many teams build, deploy and scale parts of a system **independently**. Each service owns one business capability and its data, communicates through contracts, and can be released on its own cadence.

What you gain:

- Independent deployment and release cadence per team.
- Independent scaling of hot components.
- Fault isolation (one service failing need not take everything down).
- Technology freedom where it genuinely helps.

What you pay:

- **Distributed-systems complexity**: partial failure, network latency, eventual consistency, distributed transactions (sagas), debugging across services.
- **Operational overhead**: CI/CD per service, observability, service discovery, security between services, on-call.
- **Data duplication and consistency** work.
- **Contract management** and versioning.

Rule of thumb: with one or two teams, a **modular monolith** usually delivers most benefits at a fraction of the cost. Extract services when team autonomy, scaling or isolation needs are real and measured.`,
  code: r`~~~text
Decision quick-check
Teams > ~3 working on one codebase and blocking each other?        -> pressure towards services
Parts with very different scaling/availability/compliance needs?  -> extract those parts
Mature CI/CD, observability, on-call per team?                    -> prerequisite, not a consequence
Domain boundaries understood and stable?                          -> otherwise start modular monolith
~~~`,
  pts: [r`Microservices mainly scale organisations: independent teams and deployments.`, r`Benefits: independent release, scaling and fault isolation.`, r`Costs: distributed complexity, operations, consistency and contracts.`, r`A modular monolith often gives most benefits cheaply.`, r`Extract services when measured forces justify it.`],
  ex: r`A 6-engineer startup that began with 14 services spent most of its time on pipelines and incidents; consolidating into a modular monolith doubled feature throughput.`,
  fu: [r`What prerequisites must exist before adopting microservices?`, r`How do you know your boundaries are wrong?`],
  pit: [r`Adopting microservices for technical fashion with one team.`],
  tip: r`Opening with "microservices are an organisational scaling tool" frames the answer at Principal level.` },

{ id: 'q2', level: 'Basic', tags: ['boundaries', 'ddd'],
  q: r`How do you identify service boundaries?`,
  a: r`Use **business capabilities and bounded contexts** (DDD), not entities or technical layers.

Techniques:

- **Event storming** with domain experts to find domain events, commands, aggregates and natural seams where language changes ("order" means different things to sales and fulfilment).
- **Capability mapping**: what the business does (pricing, payments, fulfilment, customer support).
- **Change and ownership analysis**: what changes together, which team owns it.
- **Data ownership**: each piece of data has one authoritative owner.
- **Transactional boundaries**: invariants that must hold atomically belong in one service.

Heuristics:

- High cohesion inside, low coupling across (few synchronous calls per user request).
- A service should be ownable by one team.
- Avoid entity services (CustomerService, ProductService) that every flow depends on.
- Start coarser; splitting later is easier than merging chatty services.`,
  code: r`~~~text
Event storming output (excerpt) -> candidate contexts
[Catalog]     ProductListed, PriceChanged
[Ordering]    OrderPlaced, OrderCancelled        (invariant: order lines + total consistent)
[Payments]    PaymentAuthorised, PaymentCaptured (PCI scope: isolate)
[Fulfilment]  ShipmentCreated, ParcelDelivered
[Customer]    CustomerRegistered, AddressChanged
Language shift: "Order" in Ordering = basket commitment; in Fulfilment = parcels to pick -> separate models
~~~`,
  pts: [r`Boundaries follow business capabilities and bounded contexts.`, r`Event storming reveals events, aggregates and language shifts.`, r`Things that change together and share invariants stay together.`, r`One owner per data, one team per service.`, r`Start coarse; avoid entity services.`],
  ex: r`Event storming revealed that "Product" meant different things to catalogue and pricing; separate contexts ended a constant stream of schema conflicts.`,
  fu: [r`What signals that two services should merge?`],
  pit: [r`Splitting by technical layer (API service, data service).`] },

{ id: 'q3', level: 'Basic', tags: ['data', 'database-per-service'],
  q: r`Why "database per service", and how do services share data without sharing databases?`,
  a: r`Each service owns its data and schema so it can change, scale and fail independently. A shared database couples deployments (schema changes break others), hides dependencies, and creates a single failure domain and performance bottleneck.

Ways to share data:

- **APIs**: synchronous queries to the owner for current data.
- **Events**: the owner publishes changes; consumers keep **local read models / copies** of what they need (event-carried state transfer).
- **CDC**: stream changes from the owner's database (prefer an outbox table as the public contract, not internal tables).
- **Reporting**: a data platform (lake/warehouse) fed by CDC/events for cross-service analytics.

"Database per service" means **logical ownership**: several services can share a database server/cluster for cost, as long as each has its own schema/database and credentials and never reads another's tables.`,
  code: r`~~~csharp
// Shipping keeps its own copy of the order data it needs, built from events
public sealed class OrderPlacedHandler(ShippingDb db) : IConsumer<OrderPlaced>
{
    public async Task Consume(ConsumeContext<OrderPlaced> ctx)
    {
        var m = ctx.Message;
        if (await db.Orders.AnyAsync(o => o.OrderId == m.OrderId)) return;            // idempotent
        db.Orders.Add(new ShippingOrder(m.OrderId, m.ShippingAddress, m.Lines.Sum(l => l.Qty)));
        await db.SaveChangesAsync();
    }
}
~~~`,
  pts: [r`Data ownership enables independent change and deployment.`, r`Shared databases couple schemas and failure domains.`, r`Share via APIs, events with local copies, CDC on outbox, or a data platform.`, r`Logical separation is required; physical servers can be shared.`, r`Never read another service's tables.`],
  ex: r`Four services reading the orders table blocked a schema change for months; moving them to OrderPlaced events freed the orders team.`,
  fu: [r`How do you handle reporting across services?`],
  pit: [r`Shared database with "just one more join" from another service.`] },

{ id: 'q4', level: 'Basic', tags: ['communication'],
  q: r`Synchronous vs asynchronous communication between microservices: how do you choose?`,
  a: r`**Synchronous (HTTP/gRPC)**: request/response when the caller needs an answer now (queries, validations). Downsides: temporal coupling, latency adds up, cascading failures.

**Asynchronous (events/commands over a broker)**: the producer does not wait. Better for side effects, workflows, fan-out, load levelling and availability. Downsides: eventual consistency, harder debugging, message ordering and duplication concerns.

Guidelines:

- Keep **synchronous chains short** (ideally one hop from the edge for user requests).
- Prefer **events for state changes** others care about.
- Use **commands** to a single owner for work requests (queues).
- For long operations, **202 Accepted** plus status polling or notifications.
- gRPC for internal high-throughput, typed calls; REST for external/public APIs.`,
  code: r`~~~csharp
// Query: synchronous gRPC with a deadline
var price = await pricingClient.GetPriceAsync(new PriceRequest { Sku = sku }, deadline: DateTime.UtcNow.AddMilliseconds(300));
// State change: asynchronous event via outbox
db.Outbox.Add(OutboxMessage.From(new OrderPlaced(order.Id, order.CustomerId, order.Total)));
await db.SaveChangesAsync(ct);
// Work request to a single owner: command on a queue
await sendEndpoint.Send(new GenerateInvoice(order.Id), ct);
~~~`,
  dia: r`flowchart LR
  U[Client] -->|sync| GW[Gateway]
  GW -->|sync query| O[Orders]
  O -->|sync gRPC, deadline| P[Pricing]
  O -->|event OrderPlaced| B[(Broker)]
  B --> S[Shipping]
  B --> N[Notifications]
  O -->|command GenerateInvoice| Q[(Queue)] --> I[Invoicing]`,
  pts: [r`Synchronous when the caller needs the answer now.`, r`Asynchronous for state changes, workflows and fan-out.`, r`Keep synchronous chains short.`, r`Commands to one owner; events to many.`, r`202 Accepted for long-running operations.`],
  ex: r`Replacing a 5-hop synchronous checkout chain with one synchronous call plus events cut p99 latency by 70% and made checkout survive email-service outages.`,
  fu: [r`When is gRPC better than REST internally?`],
  pit: [r`Synchronous chains of five or more services per request.`] },

{ id: 'q5', level: 'Basic', tags: ['api-gateway'],
  q: r`What does an API gateway do in a microservices architecture, and what should it not do?`,
  a: r`An API gateway is the single entry point for external clients:

- **Routing** to services, request aggregation (sometimes via BFFs).
- **Cross-cutting edge concerns**: TLS termination, authentication (validate tokens), coarse authorisation (scopes), rate limiting/quotas, request size limits, CORS, caching, request ids.
- **Protocol translation** (REST to gRPC) and API versioning at the edge.
- Shielding internal topology from clients.

It should **not** contain business logic, domain orchestration or data transformations that belong to services; otherwise it becomes a bottleneck team and a distributed monolith's choke point.

Options: Azure API Management, AWS API Gateway, Kong, Apigee, YARP (in .NET), Envoy/ingress controllers. Use **BFFs** for client-specific shaping.`,
  code: r`~~~json
{
  "ReverseProxy": {
    "Routes": {
      "orders": { "ClusterId": "orders", "AuthorizationPolicy": "orders.read", "RateLimiterPolicy": "per-client",
                  "Match": { "Path": "/api/orders/{**rest}" }, "Transforms": [ { "PathRemovePrefix": "/api" } ] },
      "payments": { "ClusterId": "payments", "AuthorizationPolicy": "payments.write", "Match": { "Path": "/api/payments/{**rest}" } }
    },
    "Clusters": {
      "orders": { "Destinations": { "d1": { "Address": "http://orders.svc:8080" } } },
      "payments": { "Destinations": { "d1": { "Address": "http://payments.svc:8080" } } }
    }
  }
}
~~~`,
  pts: [r`Single entry point for routing and edge concerns.`, r`Authentication, quotas, TLS, limits, request ids.`, r`No business logic in the gateway.`, r`Use BFFs for client-specific aggregation.`, r`YARP, APIM, Kong, Envoy are common choices.`],
  ex: r`Moving pricing rules out of gateway plugins back into the pricing service ended weekly gateway release freezes.`,
  fu: [r`Gateway vs service mesh: who does what?`],
  pit: [r`Business logic in gateway scripts.`] },

{ id: 'q6', level: 'Basic', tags: ['modular-monolith'],
  q: r`What is a modular monolith, and why is it often the right starting point?`,
  a: r`A **modular monolith** is one deployable application internally divided into modules with strong boundaries: each module owns its domain, data (separate schema), and exposes a small public API; modules communicate through those APIs or in-process events, never through each other's internals.

Why start there:

- Most of the design benefits (clear boundaries, ownership, testability) without distributed-systems costs.
- One deployment, one process: simple transactions, debugging and operations.
- Boundaries can be refined cheaply while the domain is still being learned.
- Modules can be **extracted** into services later when a real force appears (scaling, team autonomy, compliance isolation).

Enforce boundaries with project structure, {{internal}} visibility, architecture tests and separate database schemas.`,
  code: r`~~~csharp
// Module registration and in-process integration
builder.Services.AddOrdersModule(builder.Configuration);     // Orders.Infrastructure, schema "orders"
builder.Services.AddBillingModule(builder.Configuration);    // Billing.Infrastructure, schema "billing"

// Architecture test: Orders may only use Billing's contracts
[Fact] public void Orders_does_not_reference_billing_internals() =>
    Types.InAssembly(typeof(Orders.Module).Assembly).ShouldNot().HaveDependencyOnAny("Billing.Domain", "Billing.Infrastructure")
         .GetResult().IsSuccessful.Should().BeTrue();
~~~`,
  dia: r`flowchart TB
  subgraph App[One deployable]
    O[Orders module] -->|public contract| B[Billing module]
    O -->|in-process event| S[Shipping module]
  end
  O --- OS[(orders schema)]
  B --- BS[(billing schema)]
  S --- SS[(shipping schema)]
  S -. extract later .-> SVC[Shipping service]`,
  pts: [r`One deployable with strongly bounded modules.`, r`Each module owns its schema and exposes a small API.`, r`Avoids distributed costs while boundaries are learned.`, r`Extract modules when a real force appears.`, r`Enforce with internal visibility and architecture tests.`],
  ex: r`A fintech ran a modular monolith for three years and extracted only Payments (PCI) and Notifications (scale) as services.`,
  fu: [r`How do you extract a module into a service?`],
  pit: [r`A "modular" monolith whose modules share tables.`] },

{ id: 'q7', level: 'Intermediate', tags: ['saga', 'consistency'],
  q: r`How do you implement a business transaction that spans several services?`,
  a: r`Use a **saga**: a sequence of local transactions, each in one service, with **compensating actions** to undo completed steps if a later step fails.

- **Choreography**: each service reacts to events and emits its own. Good for short flows; the overall process is implicit.
- **Orchestration**: a coordinator (state machine: MassTransit, NServiceBus, Temporal, Step Functions, Durable Functions) sends commands and tracks state. Better for complex flows, timeouts and visibility.

Requirements:

- Each step and compensation is **idempotent**.
- Messages published via **outbox**.
- **Timeouts** for steps waiting on external events.
- **Semantic locks** (PENDING states) to handle lack of isolation.
- **Reconciliation** as the backstop.

Order the steps so that operations most likely to fail and easiest to compensate come first; place the irreversible step (pivot) last.`,
  code: r`~~~csharp
public sealed class CheckoutSaga : MassTransitStateMachine<CheckoutState>
{
    public State Reserving { get; private set; } = null!; public State Charging { get; private set; } = null!;
    public Event<CheckoutStarted> Started { get; private set; } = null!;
    public Event<StockReserved> Reserved { get; private set; } = null!; public Event<StockUnavailable> NoStock { get; private set; } = null!;
    public Event<PaymentCaptured> Paid { get; private set; } = null!; public Event<PaymentFailed> PayFailed { get; private set; } = null!;
    public CheckoutSaga()
    {
        InstanceState(s => s.CurrentState);
        Initially(When(Started).Send(c => new ReserveStock(c.Saga.CorrelationId, c.Message.Lines)).TransitionTo(Reserving));
        During(Reserving,
            When(Reserved).Send(c => new CapturePayment(c.Saga.CorrelationId, c.Saga.Total)).TransitionTo(Charging),
            When(NoStock).Publish(c => new CheckoutRejected(c.Saga.CorrelationId, "out of stock")).Finalize());
        During(Charging,
            When(Paid).Publish(c => new OrderConfirmed(c.Saga.CorrelationId)).Finalize(),
            When(PayFailed).Send(c => new ReleaseStock(c.Saga.CorrelationId)).Publish(c => new CheckoutRejected(c.Saga.CorrelationId, "payment failed")).Finalize());
    }
}
~~~`,
  dia: r`sequenceDiagram
  participant O as Checkout orchestrator
  participant I as Inventory
  participant P as Payments
  O->>I: ReserveStock
  I-->>O: StockReserved
  O->>P: CapturePayment
  P-->>O: PaymentFailed
  O->>I: ReleaseStock (compensation)
  O-->>O: CheckoutRejected`,
  pts: [r`Sagas: local transactions plus compensations.`, r`Choreography for short flows; orchestration for complex ones.`, r`Idempotent steps, outbox, timeouts.`, r`Semantic locks mitigate the lack of isolation.`, r`Order steps: risky and reversible first, pivot last.`],
  ex: r`An orchestrated checkout saga reduced "paid but no stock" incidents to zero by reserving stock before capturing payment.`,
  fu: [r`What happens when a compensation fails?`],
  pit: [r`Distributed transactions (2PC) across services.`] },

{ id: 'q8', level: 'Intermediate', tags: ['outbox', 'messaging'],
  q: r`Why do microservices need the transactional outbox and inbox patterns?`,
  a: r`**Outbox**: a service must update its database **and** publish an event. Doing both separately (dual write) loses or invents events when one side fails. The outbox writes the event into an outbox table **in the same local transaction** as the business change; a relay (polling or CDC) publishes it afterwards. Delivery becomes at-least-once.

**Inbox**: because delivery is at-least-once, consumers may receive duplicates. The inbox records processed message ids in the same transaction as the consumer's changes; duplicates are skipped.

Together they give **exactly-once effects** without distributed transactions. Libraries: MassTransit (EF Core outbox/inbox), NServiceBus outbox, Wolverine, Debezium for CDC-based relays.`,
  code: r`~~~csharp
builder.Services.AddMassTransit(x =>
{
    x.AddConsumer<PaymentCapturedConsumer>();
    x.AddEntityFrameworkOutbox<OrdersDb>(o =>
    {
        o.UseSqlServer();
        o.UseBusOutbox();                                  // publishes from the outbox after commit
        o.DuplicateDetectionWindow = TimeSpan.FromDays(3); // inbox de-duplication for consumers
    });
    x.UsingAzureServiceBus((ctx, cfg) => { cfg.Host(cs); cfg.ConfigureEndpoints(ctx); });
});
// In a handler, publish inside the same DbContext transaction
await publishEndpoint.Publish(new OrderPlaced(order.Id), ct);   // written to outbox, sent after SaveChanges commits
await db.SaveChangesAsync(ct);
~~~`,
  dia: r`flowchart LR
  A[Orders service] -->|one transaction| DB[(orders + outbox)]
  DB --> R[Relay] --> BR[(Broker)]
  BR --> C[Shipping consumer]
  C -->|one transaction: inbox id + changes| SDB[(shipping + inbox)]`,
  pts: [r`Dual writes lose or invent events.`, r`Outbox: event stored in the same transaction as the change.`, r`A relay publishes at-least-once.`, r`Inbox de-duplicates consumers in their transaction.`, r`Together they give exactly-once effects.`],
  ex: r`Reconciliation found 0.2% missing OrderPlaced events before adopting the outbox; afterwards zero.`,
  fu: [r`Polling relay vs CDC?`],
  pit: [r`Publishing before the database commit.`] },

{ id: 'q9', level: 'Intermediate', tags: ['resilience'],
  q: r`Which resilience patterns does every microservice need, and how do you configure them in .NET?`,
  a: r`- **Timeouts** on every outbound call (per attempt and total), derived from latency budgets.
- **Retries** with exponential backoff and jitter for transient failures, only on idempotent operations, at one layer.
- **Circuit breakers** to fail fast when a dependency is unhealthy.
- **Bulkheads** (concurrency limits) per dependency.
- **Fallbacks / graceful degradation** for optional features.
- **Rate limiting and load shedding** at the service boundary.
- **Health checks** (liveness, readiness) and graceful shutdown.

In .NET 8+, {{Microsoft.Extensions.Http.Resilience}} provides {{AddStandardResilienceHandler}} (rate limiter, total timeout, retry, circuit breaker, attempt timeout) built on Polly v8; customise per dependency.`,
  code: r`~~~csharp
builder.Services.AddHttpClient<IInventoryClient, InventoryClient>(c => c.BaseAddress = new Uri("https://inventory"))
    .AddStandardResilienceHandler(o =>
    {
        o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(2);
        o.AttemptTimeout.Timeout = TimeSpan.FromMilliseconds(500);
        o.Retry.MaxRetryAttempts = 2;
        o.CircuitBreaker.FailureRatio = 0.5;
        o.CircuitBreaker.BreakDuration = TimeSpan.FromSeconds(15);
    });
builder.Services.AddHealthChecks().AddDbContextCheck<OrdersDb>(tags: ["ready"]);
app.MapHealthChecks("/health/ready", new() { Predicate = c => c.Tags.Contains("ready") });
~~~`,
  pts: [r`Timeouts everywhere from latency budgets.`, r`Retries with jitter, idempotent only, one layer.`, r`Circuit breakers and bulkheads per dependency.`, r`Fallbacks for optional features; shed load at the boundary.`, r`Standard resilience handler in .NET 8+.`],
  ex: r`Adding a 500 ms attempt timeout and breaker to an inventory client prevented a slow inventory deploy from taking down checkout.`,
  fu: [r`How do you choose breaker thresholds?`],
  pit: [r`Default 100-second HttpClient timeouts.`] },

{ id: 'q10', level: 'Intermediate', tags: ['observability'],
  q: r`How do you make a microservices system observable?`,
  a: r`- **Distributed tracing** with OpenTelemetry: W3C trace context propagated across HTTP, gRPC and messaging, so one user request is visible across services.
- **Metrics**: RED per service and endpoint, saturation (thread pool, connection pools), queue lag, business metrics.
- **Structured logs** with trace ids and business identifiers, centrally aggregated; no PII.
- **SLOs** per service and per user journey with burn-rate alerts.
- **Service maps** derived from traces to understand dependencies.
- **Health endpoints** and synthetic checks.
- **Correlation of deployments** with metrics (deployment markers) to spot regressions.

Standardise via a shared service-defaults package (similar to .NET Aspire's ServiceDefaults) so every service emits the same signals.`,
  code: r`~~~csharp
public static IHostApplicationBuilder AddServiceDefaults(this IHostApplicationBuilder b)
{
    b.Logging.AddOpenTelemetry(l => { l.IncludeFormattedMessage = true; l.IncludeScopes = true; });
    b.Services.AddOpenTelemetry()
        .ConfigureResource(r => r.AddService(b.Environment.ApplicationName))
        .WithMetrics(m => m.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddRuntimeInstrumentation())
        .WithTracing(t => t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddSource("MassTransit"))
        .UseOtlpExporter();
    b.Services.AddHealthChecks();
    return b;
}
~~~`,
  pts: [r`Trace across HTTP, gRPC and messaging with W3C context.`, r`RED, saturation, queue lag and business metrics.`, r`Structured logs with trace ids; no PII.`, r`SLOs per journey with burn-rate alerts.`, r`Standardise through a shared defaults package.`],
  ex: r`A shared ServiceDefaults package gave 40 services consistent traces; the median time to locate a failing dependency dropped from 45 to 5 minutes.`,
  fu: [r`How do you trace across a Kafka consumer?`],
  pit: [r`Each team choosing its own logging format.`] },

{ id: 'q11', level: 'Intermediate', tags: ['api-versioning', 'contracts'],
  q: r`How do you evolve service contracts (APIs and events) without breaking consumers?`,
  a: r`- **Backward-compatible changes by default**: add optional fields, new endpoints, new event types; never remove, rename or change the meaning or type of existing fields in place.
- **Tolerant readers**: consumers ignore unknown fields and handle unknown enum values.
- **Versioning** for breaking changes: new API version (URL or header), new event version/topic; run old and new in parallel with deprecation timelines (Sunset headers).
- **Schema registry** for events (Avro/Protobuf/JSON Schema) with compatibility rules enforced in CI.
- **Consumer-driven contract tests** (Pact) to know what consumers rely on.
- **Telemetry on old versions** to know when it is safe to remove them.`,
  code: r`~~~csharp
// v1 stays valid; v2 adds fields without changing v1 semantics
public sealed record OrderPlacedV1(Guid OrderId, decimal Total);
public sealed record OrderPlacedV2(Guid OrderId, decimal Total, string Currency, string Channel);
// Publish both during migration; consumers move at their own pace
await publish.Publish(new OrderPlacedV2(o.Id, o.Total, o.Currency, o.Channel), ct);
await publish.Publish(new OrderPlacedV1(o.Id, o.Total), ct);   // removed after telemetry shows no consumers
~~~
~~~bash
npx oasdiff@1.10.0 breaking openapi/published.json openapi/pr.json --fail-on ERR   # block breaking API changes in CI
~~~`,
  pts: [r`Additive, backward-compatible changes by default.`, r`Tolerant readers ignore unknown fields.`, r`New versions for breaking changes, run in parallel.`, r`Schema registry and contract tests in CI.`, r`Remove old versions when telemetry shows no usage.`],
  ex: r`Contract tests caught a field rename that would have broken the mobile app's checkout before deployment.`,
  fu: [r`How long do you support an old version?`],
  pit: [r`Renaming fields "because nobody uses them".`] },

{ id: 'q12', level: 'Intermediate', tags: ['service-discovery', 'kubernetes'],
  q: r`How do services find and call each other in Kubernetes, and what changes with a service mesh?`,
  a: r`Without a mesh:

- **Kubernetes Services** give a stable DNS name ({{orders.prod.svc.cluster.local}}) and virtual IP; kube-proxy load-balances connections to ready pods.
- Readiness probes control which pods receive traffic.
- Clients configure timeouts/retries themselves (HttpClient resilience), and TLS between services must be added.
- Long-lived HTTP/2/gRPC connections may concentrate on a few pods: use headless services with client-side balancing.

With a **service mesh** (Istio, Linkerd):

- Sidecar or ambient proxies handle mTLS, retries, timeouts, circuit breaking, traffic splitting (canaries), and telemetry uniformly.
- Policies (who may call whom) defined centrally.
- Costs: extra latency and resources per hop, operational complexity, need to avoid double retries (app + mesh).`,
  code: r`~~~yaml
apiVersion: v1
kind: Service
metadata: { name: orders, namespace: prod }
spec:
  selector: { app: orders }
  ports: [ { name: http, port: 80, targetPort: 8080 } ]
---
# Istio: canary 10% to v2 and a per-try timeout at the mesh
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata: { name: orders, namespace: prod }
spec:
  hosts: [orders]
  http:
    - route:
        - { destination: { host: orders, subset: v1 }, weight: 90 }
        - { destination: { host: orders, subset: v2 }, weight: 10 }
      timeout: 2s
      retries: { attempts: 2, perTryTimeout: 500ms, retryOn: "5xx,reset,connect-failure" }
~~~`,
  pts: [r`Kubernetes Services provide DNS names and connection balancing.`, r`Readiness probes gate traffic.`, r`HTTP/2 needs client-side or L7 balancing.`, r`Meshes add mTLS, traffic policy and telemetry uniformly.`, r`Avoid double retries between app and mesh.`],
  ex: r`Istio traffic splitting let a team canary a new pricing version to 5% of traffic and roll back in seconds when error rates rose.`,
  fu: [r`Sidecar vs ambient mesh?`],
  pit: [r`Retries configured in both app and mesh.`] },

{ id: 'q13', level: 'Intermediate', tags: ['security'],
  q: r`How do you secure microservices end to end?`,
  a: r`- **Edge**: gateway with WAF, TLS, token validation (OAuth2/OIDC), rate limits.
- **User identity propagation**: pass the user's access token (or exchange it for a downstream token with narrower audience: token exchange / on-behalf-of) so downstream services can authorise per user.
- **Service identity**: workload identity and **mTLS** between services; service-to-service authorisation policies.
- **Object-level authorisation** in each service (do not trust the caller to filter).
- **Secrets** in vaults with managed identities; no secrets in images.
- **Least privilege** for databases and cloud resources per service.
- **Network policies** deny by default.
- **Supply chain**: SBOMs, image scanning and signing.
- **Audit logging** of sensitive operations.`,
  code: r`~~~csharp
// Each service validates tokens itself and authorises at the object level
builder.Services.AddAuthentication().AddJwtBearer(o =>
{
    o.Authority = "https://login.example.com";
    o.Audience = "orders-api";
    o.TokenValidationParameters.ValidateLifetime = true;
});
app.MapGet("/orders/{id:guid}", async (Guid id, ClaimsPrincipal user, OrdersDb db) =>
    await db.Orders.SingleOrDefaultAsync(o => o.Id == id && o.CustomerId == user.CustomerId()) is { } o
        ? Results.Ok(o.ToDto()) : Results.NotFound())
   .RequireAuthorization("orders.read");
~~~`,
  pts: [r`Gateway for edge security, but every service validates and authorises.`, r`Propagate or exchange user tokens for downstream authorisation.`, r`Workload identity plus mTLS between services.`, r`Least privilege, vault-managed secrets, deny-by-default networks.`, r`Supply chain security and audit logs.`],
  ex: r`A penetration test found an internal service trusting a userId header; switching to token validation plus object checks closed it.`,
  fu: [r`What is token exchange and when do you need it?`],
  pit: [r`Trusting internal network traffic without authentication.`] },

{ id: 'q14', level: 'Intermediate', tags: ['deployment'],
  q: r`How do you deploy microservices safely and independently?`,
  a: r`- **One pipeline per service**: build, test, scan, package (container image), deploy; immutable artefacts promoted across environments.
- **Backward-compatible changes** (APIs, events, database migrations with expand/contract) so services can deploy in any order.
- **Progressive delivery**: canary or blue-green with automated analysis (error rate, latency, business metrics) and automatic rollback.
- **Feature flags** to decouple deployment from release.
- **Health checks and graceful shutdown** for zero-downtime rollouts.
- **GitOps** (Argo CD/Flux) for declarative, auditable deployments.
- **Deployment independence check**: if two services must deploy together, the boundary or contract is wrong.`,
  code: r`~~~yaml
# Argo Rollouts canary with automated analysis and rollback
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: orders }
spec:
  strategy:
    canary:
      steps:
        - setWeight: 10
        - pause: { duration: 10m }
        - analysis: { templates: [ { templateName: error-rate-and-latency } ] }
        - setWeight: 50
        - pause: { duration: 10m }
        - setWeight: 100
~~~`,
  pts: [r`One pipeline and immutable artefact per service.`, r`Backward-compatible changes allow any deploy order.`, r`Canary or blue-green with automated analysis and rollback.`, r`Feature flags separate deploy from release.`, r`Needing lock-step deploys signals a boundary problem.`],
  ex: r`Automated canary analysis rolled back a bad orders release in 4 minutes, affecting 10% of traffic instead of all users.`,
  fu: [r`How do you coordinate a breaking change across services?`],
  pit: [r`Release trains that deploy all services together.`] },

{ id: 'q15', level: 'Intermediate', tags: ['testing'],
  q: r`How do you test microservices without relying on a huge end-to-end environment?`,
  a: r`Test pyramid adapted for services:

- **Unit tests** for domain logic.
- **Component/service tests**: the service running in-process ({{WebApplicationFactory}}) with real infrastructure in containers (Testcontainers for database, broker) and fakes/stubs for other services (WireMock).
- **Contract tests**: consumer-driven (Pact) for APIs; schema compatibility for events.
- **A thin layer of end-to-end tests** for critical journeys in a shared environment.
- **Testing in production** safely: canaries, synthetic monitoring, feature flags.

Benefits: fast feedback, independent pipelines, fewer flaky environment-dependent tests.`,
  code: r`~~~csharp
public sealed class OrdersApiTests(OrdersApiFactory factory) : IClassFixture<OrdersApiFactory>
{
    [Fact]
    public async Task Place_order_publishes_OrderPlaced()
    {
        factory.Pricing.Given(Request.Create().WithPath("/prices/SKU-1")).RespondWith(Response.Create().WithBodyAsJson(new { price = 10m }));
        var res = await factory.CreateClient().PostAsJsonAsync("/orders", new { sku = "SKU-1", qty = 2 });
        res.StatusCode.Should().Be(HttpStatusCode.Created);
        (await factory.Harness.Published.Any<OrderPlaced>()).Should().BeTrue();   // MassTransit test harness
    }
}
// OrdersApiFactory: Testcontainers SQL Server + WireMock for pricing + MassTransit in-memory harness
~~~`,
  pts: [r`Unit tests for domain logic.`, r`Component tests with real infrastructure in containers.`, r`Stub other services; verify contracts with Pact and schema checks.`, r`Few end-to-end tests for critical journeys.`, r`Canaries and synthetic monitoring in production.`],
  ex: r`Replacing a shared integration environment with component and contract tests cut pipeline time from 90 to 12 minutes and eliminated most flaky failures.`,
  fu: [r`What do consumer-driven contracts catch that schemas do not?`],
  pit: [r`Depending on a shared environment with all services for every test.`] },

{ id: 'q16', level: 'Intermediate', tags: ['configuration'],
  q: r`How do you manage configuration and secrets across many services and environments?`,
  a: r`- **Twelve-factor**: configuration from the environment, not baked into images; same image promoted across environments.
- **Typed options** with validation at startup ({{ValidateOnStart}}).
- **Central configuration services** (Azure App Configuration, AWS AppConfig/Parameter Store, Consul) for shared or dynamic settings with versioning and audit.
- **Secrets** in Key Vault/Secrets Manager accessed with managed identities; rotate automatically; never in source control or environment files committed to git.
- **Feature flags** separate from configuration with ownership and expiry.
- **Configuration as code** for infrastructure (Terraform/Bicep) and Kubernetes manifests (Helm/Kustomize) in GitOps repositories.`,
  code: r`~~~csharp
builder.Configuration
    .AddAzureAppConfiguration(o => o.Connect(new Uri(appConfigEndpoint), new DefaultAzureCredential())
        .Select("Orders:*", builder.Environment.EnvironmentName)
        .ConfigureRefresh(r => r.Register("Orders:Sentinel", refreshAll: true).SetRefreshInterval(TimeSpan.FromSeconds(30))))
    .AddAzureKeyVault(new Uri(keyVaultUri), new DefaultAzureCredential());
builder.Services.AddOptions<OrdersOptions>().BindConfiguration("Orders").ValidateDataAnnotations().ValidateOnStart();
~~~`,
  pts: [r`Configuration from the environment; one image across environments.`, r`Typed options validated at startup.`, r`Central configuration with versioning and audit.`, r`Secrets in vaults with managed identities and rotation.`, r`Infrastructure and manifests as code via GitOps.`],
  ex: r`ValidateOnStart caught a missing connection string in a canary pod before it took traffic.`,
  fu: [r`How do you roll out a configuration change safely?`],
  pit: [r`Secrets in appsettings.json committed to git.`] },

{ id: 'q17', level: 'Intermediate', tags: ['caching', 'data'],
  q: r`How do you handle data that many services need (reference data, customer data) without coupling?`,
  a: r`Options:

- **Owner API with caching**: consumers call the owner and cache with TTL; simple, runtime dependency.
- **Event-carried state transfer**: the owner publishes changes; consumers maintain local copies of only the fields they need. No runtime dependency; eventual consistency; consumers must handle missed events (snapshots or periodic resync).
- **Reference data service** with versioned datasets (currencies, countries) distributed as packages or snapshots loaded at startup.
- **Shared read replicas are not an option** for cross-service access (coupling to internal schema).

Rules: one owner; consumers never modify copies; copies carry version/timestamp; PII copies minimised and governed (erasure must propagate).`,
  code: r`~~~csharp
// Consumer keeps only what it needs, version-checked
public sealed class CustomerChangedConsumer(BillingDb db) : IConsumer<CustomerChanged>
{
    public async Task Consume(ConsumeContext<CustomerChanged> ctx)
    {
        var m = ctx.Message;
        var local = await db.Customers.FindAsync(m.CustomerId) ?? db.Customers.Add(new BillingCustomer(m.CustomerId)).Entity;
        if (m.Version <= local.Version) return;                           // stale or duplicate
        local.Update(m.LegalName, m.BillingAddress, m.VatNumber, m.Version);   // no marketing preferences, no phone
        await db.SaveChangesAsync();
    }
}
~~~`,
  pts: [r`Owner API plus caching keeps one source with a runtime dependency.`, r`Events with local copies remove runtime coupling.`, r`Copy only the fields you need, with versions.`, r`Never read another service's replica tables.`, r`Govern PII copies; propagate erasure.`],
  ex: r`Billing kept a version-checked copy of 4 customer fields and stayed available during customer-service outages.`,
  fu: [r`How do you bootstrap a new consumer's copy?`],
  pit: [r`Copying entire customer records with PII to every service.`] },

{ id: 'q18', level: 'Intermediate', tags: ['granularity'],
  q: r`How big should a microservice be? What are the signs of services that are too small or too large?`,
  a: r`Size is about **cohesion and ownership**, not lines of code.

Too small (nano-services):

- Most requests require many synchronous calls between services.
- Services always change and deploy together.
- Shared data or chatty CRUD APIs between them.
- One team owns many tiny services and spends time on pipelines and on-call.

Too large:

- Multiple teams constantly coordinate changes and releases.
- Unrelated capabilities with different scaling or availability needs are bundled.
- Long build/test times and frequent merge conflicts.

Right-sized: one bounded context (or a cohesive part of one), owned by one team, deployable independently, with mostly asynchronous or few synchronous dependencies.`,
  code: r`~~~bash
# Change coupling across repos: services that are always deployed together in the same day are candidates to merge
gh api repos/org/deployments --paginate --jq '.[] | [.created_at[0:10], .environment, .payload.service] | @tsv' \
  | awk '$2=="prod"{print $1, $3}' | sort | uniq | awk '{d[$1]=d[$1]" "$2} END {for (k in d) print d[k]}' | sort | uniq -c | sort -rn | head
~~~`,
  pts: [r`Size by cohesion and ownership, not lines of code.`, r`Too small: chatty calls and lock-step deploys.`, r`Too large: many teams coordinating constantly.`, r`One bounded context, one team, independent deployment.`, r`Use change and deploy coupling data to adjust.`],
  ex: r`Merging three nano-services that always deployed together removed 40% of the team's pipeline and on-call load.`,
  fu: [r`How do you merge services safely?`],
  pit: [r`"One service per entity" or "one per database table".`] },

{ id: 'q19', level: 'Senior', tags: ['migration', 'strangler'],
  q: r`How do you migrate a monolith to microservices without a big-bang rewrite?`,
  a: r`1. **Modularise first**: create module boundaries inside the monolith (separate schemas, internal APIs); this alone delivers value and reveals real seams.
2. **Pick the first extraction** by value and feasibility: a capability with clear boundaries, high change frequency or distinct scaling/compliance needs, and few dependencies.
3. **Strangler fig**: put a routing layer (gateway/YARP) in front; route the extracted capability's endpoints to the new service.
4. **Data migration**: move the capability's data with CDC/backfill; the monolith accesses that data only through the new service's API or events (anti-corruption layer).
5. **Events** from the monolith (outbox) for data the new service needs.
6. **Parallel run / shadow traffic** for critical logic; feature flags for cutover.
7. **Repeat**; stop when remaining parts are better left in a smaller monolith.

Measure progress by outcomes (lead time, incidents), not number of services.`,
  code: r`~~~json
{ "ReverseProxy": {
    "Routes": {
      "invoices-new": { "ClusterId": "invoicing-service", "Match": { "Path": "/api/invoices/{**rest}" } },
      "legacy":       { "ClusterId": "monolith",          "Match": { "Path": "{**catch-all}" } } },
    "Clusters": {
      "invoicing-service": { "Destinations": { "a": { "Address": "http://invoicing:8080" } } },
      "monolith":          { "Destinations": { "a": { "Address": "http://legacy-app:80" } } } } } }
~~~`,
  dia: r`flowchart LR
  C[Clients] --> GW[YARP / gateway]
  GW -->|/api/invoices| INV[Invoicing service]
  GW -->|everything else| MONO[Monolith]
  MONO -->|outbox events| BR[(Broker)] --> INV
  MONO -->|ACL API calls| INV
  INV --> IDB[(Invoicing DB)]
  MONO --> MDB[(Monolith DB)]`,
  pts: [r`Modularise inside the monolith first.`, r`Extract by value and feasibility, one capability at a time.`, r`Strangler routing at the edge.`, r`Move data with CDC; access it only via the new service.`, r`Shadow runs and flags for cutover; measure outcomes.`],
  ex: r`An insurer extracted billing first (highest change rate); lead time for billing changes fell from 6 weeks to 3 days while the rest stayed in the monolith.`,
  fu: [r`How do you handle shared tables during extraction?`],
  pit: [r`Rewriting everything in parallel for a year.`] },

{ id: 'q20', level: 'Senior', tags: ['distributed-monolith'],
  q: r`What is a distributed monolith, how do you recognise one, and how do you get out?`,
  a: r`A distributed monolith has the **costs of microservices** (network, operations) with the **coupling of a monolith**.

Symptoms:

- Services must be deployed together or in a specific order.
- Shared databases or shared domain libraries.
- Long synchronous call chains for every request; one service down breaks everything.
- Changes regularly touch many services and teams.
- "Integration environment" needed for any meaningful test.

Ways out:

- **Merge** services that always change together.
- **Re-draw boundaries** around business capabilities.
- **Replace synchronous chains** with events and local read models.
- **Remove shared databases and domain libraries**; introduce contracts.
- **Contract testing** and backward compatibility so deployments decouple.
- Accept that sometimes a well-structured monolith is the right destination.`,
  code: r`~~~text
Coupling scorecard (per service pair, last quarter)
Pair                    Co-deploys  Sync calls/request  Shared tables  Shared libs  -> Action
Orders <-> Pricing      38/40       4                   0              Domain.Core  merge or async price snapshots
Orders <-> Customers    12/40       2                   2              Domain.Core  replace table reads with events
Shipping <-> Labels     40/40       6                   1              -            merge
~~~`,
  pts: [r`Distributed costs plus monolith coupling.`, r`Symptoms: lock-step deploys, shared DBs, long sync chains.`, r`Merge what always changes together.`, r`Replace sync chains with events and read models.`, r`Remove shared databases and domain libraries.`],
  ex: r`Merging two services and replacing four synchronous calls with events let a team ship independently for the first time in a year.`,
  fu: [r`How do you convince leadership that merging services is progress?`],
  pit: [r`Adding more services to fix coupling.`] },

{ id: 'q21', level: 'Senior', tags: ['cqrs', 'queries'],
  q: r`How do you implement queries that need data from several services (for example, an order history page with product names and shipment status)?`,
  a: r`Options:

- **API composition** in a BFF/aggregator: call orders, catalogue and shipping in parallel and join. Simple; latency is the slowest call; partial failures need fallbacks; pagination across services is awkward.
- **CQRS read model**: a dedicated query service consumes events from orders, catalogue and shipping, maintaining a denormalised "order history" view. Fast, resilient reads; eventual consistency; projection maintenance.
- **Enriching events**: producers include display data (product name at the time of order), reducing lookups.

Choose composition for low-volume or rarely used views, read models for high-traffic screens and complex filtering/sorting. Show freshness ("updated 5 s ago") when relevant.`,
  code: r`~~~csharp
// API composition in a BFF with parallel calls and graceful degradation
app.MapGet("/bff/orders/{id:guid}", async (Guid id, IOrders orders, ICatalog catalog, IShipping shipping, CancellationToken ct) =>
{
    var order = await orders.GetAsync(id, ct);
    var namesTask = catalog.NamesAsync(order.Lines.Select(l => l.Sku), ct);
    var shipTask = shipping.StatusAsync(id, ct).WaitAsync(TimeSpan.FromMilliseconds(300), ct);
    await Task.WhenAll(namesTask, shipTask.ContinueWith(_ => { }, ct));
    return Results.Ok(new
    {
        order.Id, order.Total,
        Lines = order.Lines.Select(l => new { l.Sku, Name = namesTask.Result.GetValueOrDefault(l.Sku, l.Sku), l.Qty }),
        Shipment = shipTask.IsCompletedSuccessfully ? shipTask.Result : null           // partial response if shipping is slow
    });
});
~~~`,
  pts: [r`API composition: simple, latency-bound, partial failures.`, r`CQRS read models: fast, resilient, eventually consistent.`, r`Enrich events with display data to avoid lookups.`, r`Composition for low traffic; read models for hot screens.`, r`Show freshness where it matters.`],
  ex: r`A high-traffic order history moved from composing three APIs to a read model, cutting p99 from 1.1 s to 60 ms.`,
  fu: [r`How do you paginate across composed services?`],
  pit: [r`N+1 calls from the BFF to the catalogue per line.`] },

{ id: 'q22', level: 'Senior', tags: ['event-driven'],
  q: r`Events vs commands vs queries in microservices: how do you design each?`,
  a: r`- **Command**: a request to do something, sent to **one** owner, imperative name ({{CapturePayment}}). The receiver may reject it. Usually via a queue or synchronous API.
- **Event**: a fact that already happened, past tense ({{PaymentCaptured}}), published to **any** interested subscribers; the publisher does not know or care who listens.
- **Query**: request for data, no side effects, typically synchronous.

Event design:

- **Domain events** (internal, rich) vs **integration events** (public contracts, stable, versioned).
- Notification (thin, id only) vs event-carried state transfer (includes data).
- Include ids, timestamps, versions, correlation ids; avoid leaking internal models.

Misuse to avoid: "events" that are really commands to a specific service ({{SendEmailToCustomer}}), which couples the publisher to the consumer's behaviour.`,
  code: r`~~~csharp
// Command: to one owner, may be rejected
public sealed record CapturePayment(Guid PaymentId, decimal Amount, string Currency, Guid CommandId);
// Integration event: public, versioned fact
public sealed record PaymentCaptured(Guid PaymentId, Guid OrderId, decimal Amount, string Currency, DateTimeOffset CapturedAt, int SchemaVersion = 1);
// Anti-pattern: a disguised command published as an event
public sealed record SendPaymentReceiptEmail(Guid CustomerId);   // the payments service should not decide notification behaviour
~~~`,
  pts: [r`Commands: imperative, one owner, may be rejected.`, r`Events: past-tense facts, many subscribers.`, r`Queries: side-effect free, usually synchronous.`, r`Separate internal domain events from public integration events.`, r`Avoid commands disguised as events.`],
  ex: r`Replacing SendReceiptEmail "events" with PaymentCaptured let the notifications team change channels without touching payments.`,
  fu: [r`How do you version integration events?`],
  pit: [r`Publishing internal entity snapshots as public events.`] },

{ id: 'q23', level: 'Senior', tags: ['idempotency'],
  q: r`Design idempotency end to end across an API and its asynchronous consumers.`,
  a: r`- **API edge**: clients send {{Idempotency-Key}}; the service stores key + request hash + response in the same transaction as the business change; duplicates replay the stored response; concurrent duplicates resolved by a unique constraint.
- **Outbox**: events written in that same transaction with deterministic message ids (derived from the business operation).
- **Consumers**: inbox table keyed by message id in the same transaction as their effects; or naturally idempotent upserts with version checks.
- **External calls**: pass idempotency keys to providers (PSPs, email providers with dedupe ids).
- **Sagas**: correlation ids and per-step command ids; compensations idempotent.
- **Retention**: keys kept longer than any retry or replay window.`,
  code: r`~~~csharp
public async Task<IResult> CreatePayment(string key, CreatePayment req, PaymentsDb db, CancellationToken ct)
{
    var hash = Hashing.Sha256(req);
    if (await db.Idempotency.FindAsync([key], ct) is { } prior)
        return prior.Hash == hash ? Results.Json(prior.Response, statusCode: prior.Status) : Results.Problem(statusCode: 422);
    var p = Payment.Create(req);
    db.Payments.Add(p);
    db.Outbox.Add(new OutboxMessage(MessageId: DeterministicId("payment-created", p.Id), Topic: "payments", Payload: Serialize(new PaymentCreated(p.Id))));
    db.Idempotency.Add(new IdempotencyRecord(key, hash, 201, p.ToDto()));
    await db.SaveChangesAsync(ct);                       // unique key: concurrent duplicates fail and retry into the replay path
    return Results.Created("/payments/" + p.Id, p.ToDto());
}
~~~`,
  pts: [r`API keys with request hash and stored response.`, r`Outbox messages with deterministic ids.`, r`Consumer inbox in the same transaction.`, r`Idempotency keys to external providers.`, r`Retain keys beyond retry and replay windows.`],
  ex: r`End-to-end idempotency let an operations team replay a day of Kafka events after a bug fix without duplicating a single ledger entry.`,
  fu: [r`How do you handle the same key with a different payload?`],
  pit: [r`Idempotency only at the API, not in consumers.`] },

{ id: 'q24', level: 'Senior', tags: ['performance', 'latency'],
  q: r`A request crosses 6 services and p99 latency is too high. How do you analyse and fix it?`,
  a: r`1. **Trace it**: distributed traces show the critical path, sequential vs parallel calls, retries, and time spent queueing.
2. **Remove hops**: are all calls necessary on the synchronous path? Move side effects to async events; cache stable data; replace call chains with a read model.
3. **Parallelise** independent calls.
4. **Batch** N+1 calls (get prices for 20 SKUs in one call).
5. **Fix slow components**: database queries, cold caches, thread-pool starvation, GC pauses.
6. **Tail latency**: hedged requests for idempotent reads, outlier ejection, tighter timeouts with fallbacks.
7. **Protocol**: HTTP/2 or gRPC, connection reuse, compression for large payloads.

Set a **latency budget** per hop so teams know their share.`,
  code: r`~~~text
Trace analysis (p99 request 1,450 ms)
gateway 12 -> orders 40 -> customer 180 (sequential) -> pricing x20 calls 610 (N+1) -> inventory 230 -> promotions 310 (sequential)
Fixes: pricing batch endpoint (610 -> 45), customer + inventory + promotions in parallel (720 -> 310),
       promotions cached 30 s (310 -> 8 on hit)
Result: p99 1,450 -> 380 ms; budget per hop documented
~~~`,
  pts: [r`Use traces to find the critical path.`, r`Remove hops; move side effects async; cache or read models.`, r`Parallelise independent calls; batch N+1 calls.`, r`Fix slow components and tails.`, r`Set latency budgets per hop.`],
  ex: r`Batching price lookups and parallelising three calls cut a checkout p99 from 1.45 s to 380 ms.`,
  fu: [r`How do you allocate a latency budget across teams?`],
  pit: [r`Scaling pods to fix a sequential call chain.`] },

{ id: 'q25', level: 'Senior', tags: ['ownership', 'team-topologies'],
  q: r`How should teams be organised around microservices?`,
  a: r`- **Stream-aligned teams** own business capabilities end to end: services, data, deployments, on-call. "You build it, you run it."
- **Platform team(s)** provide self-service infrastructure: Kubernetes, CI/CD templates, observability, databases-as-a-service, service defaults.
- **Enabling teams** help others adopt practices (security, testing, performance).
- **Complicated-subsystem teams** own specialised components (pricing engine, risk models).

Principles:

- Service boundaries align with team boundaries (Conway's law); avoid services owned by several teams.
- Limit each team's cognitive load (number of services and technologies).
- Clear interfaces between teams (APIs, events, platform as a product).
- Shared standards via paved roads rather than central approvals.`,
  code: r`~~~yaml
# Service catalogue entry (Backstage) makes ownership and dependencies explicit
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: payments-api
  annotations: { pagerduty.com/service-id: P12345, github.com/project-slug: org/payments-api }
spec:
  type: service
  lifecycle: production
  owner: team-payments
  system: checkout
  providesApis: [payments-v2]
  consumesApis: [ledger-v1, fraud-v3]
~~~`,
  pts: [r`Stream-aligned teams own capabilities end to end.`, r`Platform teams provide self-service infrastructure.`, r`Enabling and complicated-subsystem teams fill gaps.`, r`Align service and team boundaries; limit cognitive load.`, r`Make ownership explicit in a service catalogue.`],
  ex: r`A service catalogue revealed 23 services with no clear owner; assigning owners cut incident time-to-acknowledge by half.`,
  fu: [r`How many services can a team own?`],
  pit: [r`Shared ownership where nobody is on call.`] },

{ id: 'q26', level: 'Senior', tags: ['data-consistency', 'reporting'],
  q: r`How do you provide reporting and analytics across microservices that each own their data?`,
  a: r`- **Do not query service databases directly** for reports; it couples analytics to internal schemas and loads OLTP systems.
- **Stream data out**: services publish integration events (outbox) and/or CDC streams into a data platform (Kafka -> lake/warehouse).
- **Model in the data platform**: bronze/silver/gold layers; conformed dimensions (customer, product) joining data from several services.
- **Data contracts**: producers commit to schemas and semantics of what they publish for analytics, with versioning.
- **Operational reporting** (near real time) via dedicated read models or streaming analytics.
- **Governance**: lineage, PII classification, access control, retention, erasure propagation.`,
  code: r`~~~sql
-- Gold-layer model joining data from three services in the warehouse (dbt)
SELECT o.order_id, o.placed_at, c.segment, p.captured_amount, s.delivered_at
FROM silver.orders o
JOIN silver.customers c ON c.customer_id = o.customer_id
LEFT JOIN silver.payments p ON p.order_id = o.order_id AND p.status = 'CAPTURED'
LEFT JOIN silver.shipments s ON s.order_id = o.order_id;
~~~`,
  dia: r`flowchart LR
  O[Orders service] -->|outbox events| K[(Kafka)]
  P[Payments service] -->|CDC| K
  S[Shipping service] -->|outbox events| K
  K --> L[(Data lake bronze)]
  L --> SV[(Silver: cleaned)]
  SV --> G[(Gold: business models)]
  G --> BI[BI dashboards]`,
  pts: [r`Never report straight from service databases.`, r`Stream events/CDC into a data platform.`, r`Join across services in curated layers.`, r`Data contracts define what producers commit to.`, r`Govern PII, lineage and retention.`],
  ex: r`Moving finance reports off service read replicas onto a CDC-fed warehouse ended nightly slowdowns and gave finance hourly data.`,
  fu: [r`What is a data contract?`],
  pit: [r`Analysts with credentials to every service database.`] },

{ id: 'q27', level: 'Senior', tags: ['failure-handling', 'dlq'],
  q: r`How do you handle poison messages and failed processing in microservice messaging?`,
  a: r`- **Classify errors**: transient (timeouts, dependency down) -> retry with backoff; permanent (validation, unknown schema, business rule violation) -> do not retry endlessly.
- **Immediate retries** (a few) for very short glitches, then **delayed redelivery** (minutes to hours) for longer outages.
- **Dead-letter queue** after retries are exhausted, with the error, stack trace, original headers and metadata.
- **Alert** on DLQ growth; give operators **replay tooling** (inspect, fix, requeue) with audit.
- **Ordered streams** (Kafka partitions): a poison message blocks the partition; move it to a DLQ topic quickly and continue, recording the gap.
- **Idempotent consumers** so replays are safe.
- **Root-cause analysis** for recurring DLQ patterns (bad producers, schema drift).`,
  code: r`~~~csharp
x.AddConsumer<InvoiceRequestedConsumer>(c =>
{
    c.UseMessageRetry(r =>
    {
        r.Intervals(TimeSpan.FromMilliseconds(200), TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(5));
        r.Ignore<ValidationException>();                    // permanent: straight to error queue
    });
    c.UseDelayedRedelivery(r => r.Intervals(TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(30), TimeSpan.FromHours(2)));
});
// After all attempts, MassTransit moves the message to invoice-requested_error with fault headers; an alert fires on depth > 0
~~~`,
  pts: [r`Separate transient from permanent errors.`, r`Immediate retries, then delayed redelivery.`, r`DLQ with full error context after exhaustion.`, r`Alerts and audited replay tooling.`, r`Do not let a poison message block ordered partitions.`],
  ex: r`A schema change by a producer sent 12,000 messages to a DLQ; replay tooling reprocessed them after a consumer fix with no data loss.`,
  fu: [r`How do you replay safely in order?`],
  pit: [r`Infinite retries of permanently invalid messages.`] },

{ id: 'q28', level: 'Senior', tags: ['multi-tenancy'],
  q: r`How do you design multi-tenancy across a microservices platform?`,
  a: r`- **Tenant context** from the authenticated token, propagated across HTTP and messages (headers), never trusted from client input.
- **Data isolation per service**: shared tables with tenant id and enforced filters (EF Core query filters, PostgreSQL RLS), schema per tenant, or database per tenant for large/regulated tenants.
- **Tenant-aware routing**: a tenant directory maps tenants to cells/regions/shards for isolation and residency.
- **Noisy-neighbour controls**: per-tenant rate limits, queues and quotas.
- **Observability per tenant**: metrics and traces tagged by tenant (careful with cardinality).
- **Onboarding/offboarding automation**: provisioning and deletion across all services (events like TenantCreated/TenantDeleted).
- **Cost attribution** per tenant.`,
  code: r`~~~csharp
// Propagate tenant id on outgoing messages and HTTP calls
public sealed class TenantHeaderFilter<T>(ITenantContext tenant) : IFilter<PublishContext<T>> where T : class
{
    public Task Send(PublishContext<T> ctx, IPipe<PublishContext<T>> next) { ctx.Headers.Set("x-tenant-id", tenant.Id); return next.Send(ctx); }
    public void Probe(ProbeContext ctx) { }
}
public sealed class TenantHandler(ITenantContext tenant) : DelegatingHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct) { r.Headers.Add("x-tenant-id", tenant.Id); return base.SendAsync(r, ct); }
}
// Downstream services still verify the tenant claim in the token; the header is for messages and logging
~~~`,
  pts: [r`Tenant context from tokens, propagated across calls and messages.`, r`Per-service isolation: filters, RLS, schemas or databases.`, r`Tenant directory for routing to cells, regions or shards.`, r`Per-tenant quotas against noisy neighbours.`, r`Automated onboarding/offboarding and cost attribution.`],
  ex: r`A TenantDeleted event with per-service handlers and a completion checklist made tenant offboarding provable for GDPR audits.`,
  fu: [r`How do you test that tenants cannot see each other's data?`],
  pit: [r`Trusting a tenant header from the client.`] },

{ id: 'q29', level: 'Senior', tags: ['bff'],
  q: r`When do you use Backend-for-Frontend services in a microservices architecture?`,
  a: r`A **BFF** is a backend dedicated to one client experience (web SPA, mobile app, partner portal):

- **Aggregates** calls to several services into the shapes the client needs.
- **Handles client-specific concerns**: authentication flows (cookie sessions and token handling for SPAs), payload size and versioning for mobile, partner-specific formats.
- **Owned by the client team**, so UI changes do not require backend teams to change their APIs.

Use when clients have different needs or the UI requires many calls per screen. Avoid: one BFF shared by all clients (becomes a gateway), BFFs containing domain logic (it belongs in services), and BFFs that duplicate each other heavily (extract shared composition into a service).`,
  code: r`~~~csharp
// Web BFF: cookie session for the SPA, tokens kept server-side, composition for the dashboard
builder.Services.AddAuthentication(o => { o.DefaultScheme = "cookie"; o.DefaultChallengeScheme = "oidc"; })
    .AddCookie("cookie", o => { o.Cookie.SameSite = SameSiteMode.Strict; o.Cookie.HttpOnly = true; })
    .AddOpenIdConnect("oidc", o => { o.Authority = authority; o.ClientId = "web-bff"; o.ResponseType = "code"; o.SaveTokens = true; });
app.MapGet("/bff/dashboard", async (IAccounts accounts, IPayments payments, ClaimsPrincipal u, CancellationToken ct) =>
{
    var a = accounts.SummaryAsync(u.CustomerId(), ct); var p = payments.RecentAsync(u.CustomerId(), 5, ct);
    await Task.WhenAll(a, p);
    return Results.Ok(new { balance = a.Result.Balance, recent = p.Result });
}).RequireAuthorization();
~~~`,
  dia: r`flowchart LR
  SPA[Angular / React SPA] -->|cookie| WBFF[Web BFF]
  APP[Mobile app] -->|token| MBFF[Mobile BFF]
  WBFF --> ACC[Accounts]
  WBFF --> PAY[Payments]
  MBFF --> ACC
  MBFF --> PAY
  MBFF --> NOT[Notifications]`,
  pts: [r`One backend per client experience, owned by the client team.`, r`Aggregates and shapes data for the UI.`, r`Handles client-specific auth and payload needs.`, r`No domain logic in BFFs.`, r`Avoid a single shared BFF for all clients.`],
  ex: r`A mobile BFF reduced the home screen from 9 calls to 1 and handled older app versions without changing core services.`,
  fu: [r`How do you avoid duplicated logic across BFFs?`],
  pit: [r`Putting pricing rules in the BFF.`] },

{ id: 'q30', level: 'Senior', tags: ['incident', 'cascading'],
  q: r`One microservice is slow and the whole platform is degrading. Walk through the incident.`,
  a: r`### Mitigate first
1. Identify the slow service from dashboards and traces (latency spike, saturation).
2. Check recent changes (deploys, config, traffic); roll back if correlated.
3. Contain the blast radius: open circuit breakers or enable degradation flags in callers; shed non-critical traffic; scale the slow service if it is capacity-bound (and not, for example, database-bound).
4. Stop retry storms (reduce retries via config/flags).

### Diagnose
Dependency of the slow service (database locks, slow queries, external API), resource exhaustion (thread pool, connection pool), GC pressure, noisy neighbour.

### Prevent
Timeouts and bulkheads in all callers so one slow service cannot consume their resources; load tests of dependency slowness; SLOs and alerts on dependency latency; postmortem actions owned.`,
  code: r`~~~bash
# Find the slow dependency fast
kubectl top pods -n prod --sort-by=cpu | head
kubectl rollout history deploy/inventory -n prod
dotnet-counters monitor -n Inventory.Api --counters System.Runtime[threadpool-queue-length],Microsoft.EntityFrameworkCore
# Containment: flip degradation flag so checkout stops waiting on inventory (uses cached availability)
az appconfig feature enable --name prod-config --feature checkout-cached-availability --yes
~~~`,
  pts: [r`Mitigate before diagnosing: roll back, break circuits, shed load.`, r`Stop retry storms.`, r`Find the slow dependency via traces and saturation metrics.`, r`Diagnose databases, pools, GC, external APIs.`, r`Prevent with timeouts, bulkheads and failure testing.`],
  ex: r`A slow inventory query cascaded into checkout until a degradation flag switched to cached availability; the postmortem added bulkheads to all callers.`,
  fu: [r`What is the role of an incident commander?`],
  pit: [r`Scaling every service at once without understanding the bottleneck.`] },

{ id: 'q31', level: 'Senior', tags: ['caching', 'performance'],
  q: r`How do you use caching across microservices without creating consistency problems?`,
  a: r`- **Cache in the consumer** for data owned by others (prices, product names) with TTLs matching the agreed staleness.
- **Invalidate via events**: the owner publishes changes (PriceChanged); consumers evict or update their cache.
- **Owner-side caching** for its own hot reads (Redis) with delete-on-write.
- **HTTP caching** (ETags, Cache-Control) between services for GET endpoints.
- **Do not cache authoritative decisions** (stock for checkout, balances for authorisation): check with the owner at commit.
- **Key design**: namespaced and versioned keys; tenant in keys.
- **Protect against stampedes** and cache outages (DB capacity, bulkheads).`,
  code: r`~~~csharp
// Consumer-side cache with event-based invalidation
public sealed class PriceCache(HybridCache cache, IPricingClient pricing)
{
    public ValueTask<decimal> GetAsync(string sku, CancellationToken ct) =>
        cache.GetOrCreateAsync("price:v1:" + sku, t => new ValueTask<decimal>(pricing.GetAsync(sku, t)),
            new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(5) }, tags: ["sku:" + sku], cancellationToken: ct);
}
public sealed class PriceChangedConsumer(HybridCache cache) : IConsumer<PriceChanged>
{ public Task Consume(ConsumeContext<PriceChanged> c) => cache.RemoveByTagAsync("sku:" + c.Message.Sku).AsTask(); }
~~~`,
  pts: [r`Consumers cache others' data with agreed TTLs.`, r`Owners publish change events for invalidation.`, r`Use HTTP caching semantics between services.`, r`Never cache authoritative decision data.`, r`Versioned, tenant-aware keys; stampede and outage protection.`],
  ex: r`Event-driven price cache invalidation reduced pricing-service load by 90% while keeping prices fresh within a second of changes.`,
  fu: [r`What happens if an invalidation event is lost?`],
  pit: [r`Selling at a cached price without a final check.`] },

{ id: 'q32', level: 'Senior', tags: ['grpc', 'communication'],
  q: r`When should internal service communication use gRPC instead of REST?`,
  a: r`gRPC strengths:

- **Performance**: HTTP/2 multiplexing, binary Protobuf (smaller, faster serialisation).
- **Strong contracts and codegen** in many languages from {{.proto}} files.
- **Streaming**: server, client and bidirectional streams.
- **Deadlines and cancellation** built in.

Choose gRPC for high-throughput internal calls, polyglot environments needing typed clients, and streaming. Choose REST/JSON for public APIs, browser clients (gRPC-Web or JSON transcoding otherwise), easy debugging, and HTTP caching.

Operational notes: L7 or client-side load balancing for long-lived HTTP/2 connections; Protobuf evolution rules (never reuse field numbers; add optional fields); observability through interceptors; health checking protocol.`,
  code: r`~~~protobuf
syntax = "proto3";
package pricing.v1;
service Pricing {
  rpc GetPrices (GetPricesRequest) returns (GetPricesResponse);          // batch to avoid N+1
  rpc WatchPrices (WatchRequest) returns (stream PriceUpdate);            // server streaming
}
message GetPricesRequest { repeated string skus = 1; string currency = 2; }
message GetPricesResponse { map<string, int64> price_minor = 1; }
~~~
~~~csharp
builder.Services.AddGrpcClient<Pricing.PricingClient>(o => o.Address = new Uri("https://pricing"))
    .ConfigureChannel(c => c.ServiceConfig = new ServiceConfig { LoadBalancingConfigs = { new RoundRobinConfig() } })
    .AddStandardResilienceHandler();
var prices = await client.GetPricesAsync(new GetPricesRequest { Skus = { skus }, Currency = "GBP" }, deadline: DateTime.UtcNow.AddMilliseconds(300));
~~~`,
  pts: [r`gRPC: HTTP/2, Protobuf, codegen, streaming, deadlines.`, r`Best for high-throughput, typed internal calls and streaming.`, r`REST for public, browser and cache-friendly APIs.`, r`Balance HTTP/2 at L7 or client-side.`, r`Follow Protobuf evolution rules.`],
  ex: r`Moving a pricing hot path from REST/JSON to batched gRPC cut CPU per request by 40% and p99 by half.`,
  fu: [r`How does JSON transcoding expose gRPC services as REST?`],
  pit: [r`Reusing Protobuf field numbers after deleting fields.`] },

{ id: 'q33', level: 'Senior', tags: ['platform', 'aspire'],
  q: r`What should a microservices platform (internal developer platform) provide to product teams?`,
  a: r`A paved road so teams focus on business logic:

- **Service templates** with defaults: OpenTelemetry, health checks, resilience, authentication, structured logging, Dockerfile, Helm chart/manifests.
- **CI/CD pipelines** as reusable workflows with security scanning, SBOM, signing, progressive delivery.
- **Runtime**: Kubernetes or managed containers, ingress/gateway, service mesh (optional), autoscaling.
- **Data services**: provisioned databases, caches, brokers via self-service with backups and monitoring.
- **Observability stack** with dashboards and SLO tooling.
- **Secrets and identity** integration.
- **Service catalogue** (Backstage) for ownership, docs, dependencies, scorecards.
- **Local development experience** (.NET Aspire, docker-compose, dev containers).

Treat the platform as a product: user research with teams, roadmaps, SLAs, adoption metrics.`,
  code: r`~~~csharp
// .NET Aspire AppHost: local orchestration of a service, its database, cache and broker
var builder = DistributedApplication.CreateBuilder(args);
var sql = builder.AddSqlServer("sql").AddDatabase("orders");
var redis = builder.AddRedis("cache");
var bus = builder.AddRabbitMQ("bus");
builder.AddProject<Projects.Orders_Api>("orders").WithReference(sql).WithReference(redis).WithReference(bus);
builder.AddProject<Projects.Shipping_Api>("shipping").WithReference(bus);
builder.Build().Run();
~~~`,
  pts: [r`Templates with telemetry, health, resilience and security defaults.`, r`Reusable CI/CD with scanning and progressive delivery.`, r`Self-service data services and runtime.`, r`Observability, secrets, identity and a service catalogue.`, r`Run the platform as a product with adoption metrics.`],
  ex: r`A platform template took new service setup from three weeks to one day and made telemetry consistent across 60 services.`,
  fu: [r`How do you measure platform success?`],
  pit: [r`A platform team that builds what it finds interesting rather than what teams need.`] },

{ id: 'q34', level: 'Senior', tags: ['data-migration', 'schema'],
  q: r`How do you change a service's database schema without breaking running versions or consumers?`,
  a: r`Use **expand/contract** (parallel change):

1. **Expand**: add new columns/tables in a backward-compatible way (nullable, defaults); deploy code that writes both old and new (or new with a trigger/backfill).
2. **Migrate**: backfill existing data in batches.
3. **Switch reads** to the new structure (feature flag), verify.
4. **Contract**: stop writing the old structure; later drop it.

Rules:

- Every migration must work with **both the old and new application versions** running simultaneously (rolling deploys).
- Avoid long locks: online index builds, batched updates, lock timeouts.
- Integration contracts (events/APIs) are versioned separately from the internal schema; schema changes should not leak.
- Migrations run in the pipeline, not at application startup across all pods simultaneously.`,
  code: r`~~~sql
-- 1 Expand (release N)
ALTER TABLE orders ADD COLUMN delivery_type varchar(20) NULL;
-- 2 Backfill in batches (job)
UPDATE orders SET delivery_type = CASE WHEN express THEN 'EXPRESS' ELSE 'STANDARD' END
WHERE delivery_type IS NULL AND id BETWEEN $from AND $to;
-- 3 Release N+1 reads delivery_type (flag), still writes both columns
-- 4 Contract (release N+3, after verification)
ALTER TABLE orders DROP COLUMN express;
~~~`,
  pts: [r`Expand, migrate, switch reads, contract.`, r`Migrations must support old and new versions together.`, r`Batch backfills; avoid long locks.`, r`Internal schema changes must not leak into contracts.`, r`Run migrations in the pipeline, not on every pod's startup.`],
  ex: r`An expand/contract migration of a 400-million-row table ran over a week with zero downtime and no consumer impact.`,
  fu: [r`How do you roll back a migration?`],
  pit: [r`Renaming a column in one release while old pods still run.`] },

{ id: 'q35', level: 'Senior', tags: ['workflow-engines'],
  q: r`When would you use a workflow engine (Temporal, Durable Functions, Step Functions, Camunda) in a microservices system?`,
  a: r`Use a workflow engine when a business process:

- Spans many steps and services with **long durations** (minutes to months): onboarding, loan origination, claims.
- Needs **timers, retries, human approvals and compensation** with full visibility of state.
- Must **survive crashes and deploys** reliably (durable execution).

Benefits: workflows written as code (Temporal, Durable Functions) or state machines (Step Functions, BPMN in Camunda), automatic persistence of state, retries with backoff, history for audit, tooling for visibility and operations.

Trade-offs: a new critical platform component, determinism constraints in workflow code (no random/time directly), versioning of long-running workflows, vendor/runtime lock-in. For simple flows, a saga state machine in MassTransit/NServiceBus may suffice.`,
  code: r`~~~csharp
// Durable Functions orchestrator: loan origination with a human approval and timeout
[Function(nameof(LoanOrigination))]
public static async Task<string> LoanOrigination([OrchestrationTrigger] TaskOrchestrationContext ctx)
{
    var app = ctx.GetInput<LoanApplication>()!;
    var kyc = await ctx.CallActivityAsync<KycResult>(nameof(RunKyc), app);
    if (!kyc.Passed) return "REJECTED_KYC";
    var score = await ctx.CallActivityAsync<int>(nameof(ScoreCredit), app);
    if (score < 600)
    {
        using var cts = new CancellationTokenSource();
        var approval = ctx.WaitForExternalEvent<bool>("UnderwriterDecision");
        var timeout = ctx.CreateTimer(ctx.CurrentUtcDateTime.AddDays(3), cts.Token);
        if (await Task.WhenAny(approval, timeout) == timeout || !approval.Result) return "DECLINED";
        cts.Cancel();
    }
    await ctx.CallActivityAsync(nameof(DisburseFunds), app);   // idempotent activity
    return "DISBURSED";
}
~~~`,
  pts: [r`Use for long, multi-step processes with timers and humans.`, r`Durable execution survives crashes and deploys.`, r`Gives retries, history, visibility and compensation.`, r`Costs: new platform, determinism rules, workflow versioning.`, r`Simple flows may only need a saga state machine.`],
  ex: r`A lender moved origination from cron-polled status tables to Durable Functions; stuck applications became visible and timed out automatically.`,
  fu: [r`How do you version a workflow with running instances?`],
  pit: [r`Calling DateTime.UtcNow or random in workflow code.`] },

{ id: 'q36', level: 'Senior', tags: ['frontend', 'micro-frontends'],
  q: r`Micro-frontends: when do they make sense with Angular or React, and how do you implement them?`,
  a: r`Micro-frontends extend service ownership to the UI: each team owns a slice of the front end (e.g. checkout, account) and deploys it independently.

Make sense when: several teams work on one large web app and release coordination is the bottleneck; domains map clearly to UI areas.

Implementations:

- **Build-time composition** (packages): simple but couples releases.
- **Runtime composition**: Module Federation (Webpack/Rspack, Native Federation for Angular), single-spa, or route-based composition (different apps per path behind a shell).
- **Web components** as framework-neutral boundaries.

Concerns: shared design system, consistent auth/session, shared dependency versions (avoid shipping three Angular copies), performance budgets, routing, cross-app communication (events, URL), testing. Avoid micro-frontends for small teams; a well-modularised SPA is simpler.`,
  code: r`~~~typescript
// Angular shell with Native Federation: load the checkout remote at runtime
export const routes: Routes = [
  { path: 'checkout', loadChildren: () => loadRemoteModule('checkout', './routes').then(m => m.CHECKOUT_ROUTES) },
  { path: 'account', loadChildren: () => loadRemoteModule('account', './routes').then(m => m.ACCOUNT_ROUTES) },
];
// federation.manifest.json (deployed per environment, so remotes deploy independently)
// { "checkout": "https://cdn.example.com/checkout/remoteEntry.json", "account": "https://cdn.example.com/account/remoteEntry.json" }
~~~`,
  pts: [r`Micro-frontends give teams independent UI deployment.`, r`Worth it for many teams on one large app.`, r`Runtime composition via federation, single-spa or route splits.`, r`Shared design system, auth and dependency versions matter.`, r`Small teams should prefer a modular SPA.`],
  ex: r`A bank's web platform with 9 teams moved to federated Angular remotes; release coordination meetings ended, and bundle budgets kept performance in check.`,
  fu: [r`How do micro-frontends share state?`],
  pit: [r`Each remote bundling its own framework copy.`] },

{ id: 'q37', level: 'Principal', tags: ['architecture-decision'],
  q: r`Your CTO wants to move a successful monolith to 50 microservices this year. How do you respond?`,
  a: r`Respond with questions and data, not opposition:

1. **What problem are we solving?** Slow delivery? Scaling? Reliability? Team growth? Get measurable goals (lead time, deployment frequency, incident rate, cost).
2. **Diagnose the current state**: where is delivery slow (build times, coupling hotspots, release process, testing)? Many problems are solvable in the monolith (modularisation, CI/CD, test automation).
3. **Assess readiness**: platform (CI/CD, observability, Kubernetes), skills, on-call maturity, domain boundary clarity.
4. **Propose an incremental plan**: modularise; extract the 2 to 3 capabilities where a force is strongest; build the platform alongside; measure outcomes each quarter.
5. **Define success metrics and stop criteria**: continue extracting only if outcomes improve.
6. **Communicate costs honestly**: infrastructure, people, temporary slowdown, new failure modes.

The target number of services is an output, not a goal.`,
  code: r`~~~text
Proposal to CTO (one page)
Goal: halve lead time (21 -> 10 days) and support 4 more teams by Q4
Diagnosis: 70% of lead time in a weekly release train + 2 h CI; coupling hotspots in billing and pricing modules
Plan: Q1 CI to 20 min + modularise; Q2 extract billing (PCI + change rate); Q3 platform templates + extract pricing
Metrics: lead time, deploy frequency, change failure rate, cost per service
Stop rule: if lead time does not improve after two extractions, re-evaluate
~~~`,
  pts: [r`Start from the problem and measurable goals.`, r`Diagnose; many problems are solvable in the monolith.`, r`Assess platform and team readiness.`, r`Incremental extraction where forces are strongest.`, r`Service count is an output, not a goal.`],
  ex: r`A plan reframed from "50 services" to "halve lead time" achieved the goal with 6 extractions and a faster CI pipeline.`,
  fu: [r`What would make you accelerate the migration?`],
  pit: [r`Agreeing to a service count target.`] },

{ id: 'q38', level: 'Principal', tags: ['governance'],
  q: r`How do you govern a landscape of 100+ microservices without becoming a bottleneck?`,
  a: r`- **Paved roads instead of gates**: templates and platform defaults make the right thing easy.
- **Automated guardrails**: policy-as-code (OPA/Gatekeeper/Kyverno) for Kubernetes, CI checks for contracts, security scanning, dependency rules.
- **Service scorecards** (Backstage): ownership, SLOs defined, on-call, runbooks, dependency freshness, test coverage of contracts.
- **Lightweight architecture review** only for new services, new data stores, cross-team contracts, or significant risk; ADRs in repos.
- **Communities of practice / guilds** for standards evolution.
- **Lifecycle management**: deprecate and retire unused services; track orphans.
- **Measure outcomes**: DORA metrics, incident trends, cost per service.`,
  code: r`~~~yaml
# Kyverno policy: every Deployment must declare an owner and resource limits
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata: { name: require-owner-and-limits }
spec:
  validationFailureAction: Enforce
  rules:
    - name: owner-label
      match: { any: [ { resources: { kinds: [Deployment] } } ] }
      validate: { message: "metadata.labels.owner is required", pattern: { metadata: { labels: { owner: "?*" } } } }
    - name: limits
      match: { any: [ { resources: { kinds: [Deployment] } } ] }
      validate: { message: "CPU and memory limits required", pattern: { spec: { template: { spec: { containers: [ { resources: { limits: { memory: "?*", cpu: "?*" } } } ] } } } } }
~~~`,
  pts: [r`Paved roads instead of approval gates.`, r`Policy-as-code and CI guardrails.`, r`Scorecards for ownership, SLOs and hygiene.`, r`Reviews only for significant changes; ADRs in repos.`, r`Retire unused services; measure outcomes.`],
  ex: r`Scorecards surfaced 31 services without SLOs; within two quarters every production service had SLOs and on-call.`,
  fu: [r`How do you retire a service with unknown consumers?`],
  pit: [r`A central architecture board approving every change.`] },

{ id: 'q39', level: 'Principal', tags: ['cost'],
  q: r`How do you control the cost of a microservices platform?`,
  a: r`Cost drivers: per-service baseline resources (replicas x requests), sidecars, observability (logs, traces, metrics cardinality), data stores per service, cross-AZ traffic, idle environments, and people (operations).

Levers:

- **Right-size** requests/limits from actual usage; autoscale (HPA/KEDA), scale to zero for low-traffic services.
- **Consolidate** tiny services or share clusters/databases (with logical separation).
- **Observability budgets**: sampling, log levels, retention tiers, cardinality limits.
- **Topology-aware routing** to cut cross-AZ traffic.
- **Spot/preemptible** nodes for stateless workloads.
- **Ephemeral environments** with TTLs.
- **Cost attribution** per service/team (labels, showback) and unit costs (cost per order).
- **Architecture review** of chatty patterns that multiply compute and network.`,
  code: r`~~~yaml
# KEDA: scale a queue consumer from 0 to 30 replicas based on Service Bus queue length
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: invoice-worker }
spec:
  scaleTargetRef: { name: invoice-worker }
  minReplicaCount: 0
  maxReplicaCount: 30
  triggers:
    - type: azure-servicebus
      metadata: { queueName: invoice-requested, messageCount: "50" }
      authenticationRef: { name: servicebus-auth }
~~~`,
  pts: [r`Baselines, sidecars, observability and data stores drive cost.`, r`Right-size, autoscale and scale to zero.`, r`Consolidate tiny services; share infrastructure logically separated.`, r`Budget observability and cut cross-AZ traffic.`, r`Attribute cost per service and track unit costs.`],
  ex: r`Scaling 40 low-traffic workers to zero with KEDA and cutting trace sampling to 10% reduced the platform bill by 35%.`,
  fu: [r`How do you attribute shared cluster costs?`],
  pit: [r`Every service running 3 always-on replicas regardless of traffic.`] },

{ id: 'q40', level: 'Principal', tags: ['interview-scenario', 'design'],
  q: r`Design the microservice architecture for an e-commerce platform (catalogue, cart, checkout, payments, inventory, fulfilment, notifications).`,
  a: r`### Services and ownership
- **Catalogue** (products, search index via CDC), **Pricing/Promotions**, **Cart** (session-like, Redis + persisted), **Checkout/Ordering** (order aggregate, saga orchestrator), **Payments** (PSP integration, PCI-isolated), **Inventory** (reservations), **Fulfilment** (shipments, carriers), **Customer/Identity**, **Notifications**.

### Communication
- Synchronous: client -> gateway/BFF -> catalogue/cart/checkout reads.
- Checkout saga (orchestrated): reserve inventory -> authorise payment -> confirm order -> publish OrderConfirmed.
- Events (Kafka/Service Bus via outbox): OrderConfirmed -> fulfilment, notifications, analytics; PriceChanged -> caches, search.

### Data
Database per service (PostgreSQL/SQL Server), Redis for carts and caches, OpenSearch for search, warehouse fed by CDC.

### Cross-cutting
Gateway + BFFs, OAuth2/OIDC, mTLS, OpenTelemetry, idempotency everywhere, reconciliation for payments and inventory.`,
  code: r`~~~text
Checkout critical path latency budget (p99 600 ms)
BFF 20 -> Checkout API 30 -> Inventory reserve 80 -> Payments authorise (PSP) 350 -> Order confirm 40 -> response 20
Everything else (email, loyalty, analytics, search updates) asynchronous via events
~~~`,
  dia: r`flowchart LR
  WEB[Web/Mobile] --> GW[Gateway + BFFs]
  GW --> CAT[Catalogue] --> SRCH[(Search)]
  GW --> CART[Cart] --> RED[(Redis)]
  GW --> CHK[Checkout / Ordering: saga]
  CHK --> INV[Inventory]
  CHK --> PAY[Payments: PCI zone] --> PSP[PSP]
  CHK -->|OrderConfirmed via outbox| BUS[(Event bus)]
  BUS --> FUL[Fulfilment] --> CARR[Carriers]
  BUS --> NOTI[Notifications]
  BUS --> DATA[Data platform]
  PRC[Pricing] -->|PriceChanged| BUS`,
  pts: [r`Services by capability with clear data ownership.`, r`Short synchronous path; orchestrated checkout saga.`, r`Events via outbox for fulfilment, notifications and analytics.`, r`Payments isolated for PCI scope.`, r`Idempotency, reconciliation, observability and latency budgets.`],
  ex: r`A retailer using this shape survived a notification-provider outage during Black Friday with zero checkout impact because notifications were asynchronous.`,
  fu: [r`How do you prevent overselling during flash sales?`],
  pit: [r`Synchronous calls to notifications and fulfilment in checkout.`] },

{ id: 'q41', level: 'Principal', tags: ['regulated', 'fintech'],
  q: r`What changes when building microservices for a regulated bank (audit, change control, resilience, data residency)?`,
  a: r`- **Audit trails**: immutable logs of business actions and access, correlated across services; who changed what and when, retained per regulation.
- **Change management**: traceability from requirement to commit to deployment; four-eyes approvals; segregation of duties in pipelines; evidence generated automatically (SOX).
- **Operational resilience** (DORA, UK PRA/FCA): important business services mapped to their services and dependencies; impact tolerances; tested recovery; third-party risk management for cloud and SaaS.
- **Data residency and classification**: services processing regulated data deployed in approved regions; PII minimised in events and logs.
- **Security**: strong identity, encryption, key management (HSM), vulnerability SLAs, penetration testing.
- **Model and decision governance** for automated decisions.
- **Vendor and cloud concentration risk**: exit plans.

Build these into the platform so each service inherits compliance rather than re-implementing it.`,
  code: r`~~~yaml
# Pipeline evidence for change control: generated automatically on every production deploy
deploy-prod:
  needs: [build, security-scan, contract-tests]
  environment: { name: production }        # requires approval by a member of change-approvers (not the author)
  steps:
    - run: ./deploy.sh
    - run: |
        ./evidence publish --change-id "$CHANGE_ID" --commit "$GITHUB_SHA" --approver "$APPROVER" \
          --tests "contract,unit,integration" --sbom sbom.json --scan scan-report.json
~~~`,
  pts: [r`Immutable, correlated audit trails.`, r`Automated change evidence with segregation of duties.`, r`Map important business services; test recovery against tolerances.`, r`Residency and PII minimisation in events and logs.`, r`Make compliance a platform capability.`],
  ex: r`Automated deployment evidence reduced audit preparation from weeks to days while increasing deployment frequency.`,
  fu: [r`How do you handle emergency changes under change control?`],
  pit: [r`Manual change tickets that slow deployments without improving control.`] },

{ id: 'q42', level: 'Principal', tags: ['interview-scenario', 'incident'],
  q: r`After a microservices migration, incidents doubled. What do you do?`,
  a: r`1. **Analyse incidents** by category: dependency failures, deployment issues, data inconsistencies, configuration, capacity, contract breaks.
2. **Typical root causes**: missing timeouts/retries discipline, no idempotency, synchronous chains, immature observability, unclear ownership, shared databases, insufficient contract testing, on-call skills.
3. **Targeted fixes**:
   - Platform defaults (resilience, telemetry) rolled out to all services.
   - Contract tests and backward-compatibility gates.
   - Progressive delivery with automated rollback.
   - Reduce synchronous coupling on critical paths.
   - Merge services that are overly chatty.
4. **Operational maturity**: SLOs, runbooks, game days, on-call training.
5. **Report progress** with incident trends and MTTR monthly; adjust.`,
  code: r`~~~text
Incident analysis (last 90 days, 46 incidents)
Category                         Count  Fix
Dependency slowness cascades     14     resilience defaults (timeouts, bulkheads) in ServiceDefaults 2.0
Breaking contract changes        9      Pact + schema registry gates in CI
Bad deploys                      8      Argo Rollouts canary + auto rollback
Duplicate processing             6      inbox library mandatory for consumers
Config errors                    5      ValidateOnStart + config schema checks
Capacity                         4      load tests in pipeline for tier-0 services
~~~`,
  pts: [r`Categorise incidents to find the dominant causes.`, r`Usual culprits: resilience, idempotency, contracts, deploy safety.`, r`Roll out platform defaults and CI gates.`, r`Reduce coupling on critical paths; merge chatty services.`, r`Build operational maturity and report trends.`],
  ex: r`A post-migration incident spike halved within two quarters after resilience defaults, contract gates and canary rollouts.`,
  fu: [r`How do you prioritise which category to fix first?`],
  pit: [r`Blaming microservices without analysing incident data.`] },

{ id: 'q43', level: 'Principal', tags: ['data-ownership', 'conflicts'],
  q: r`Two teams both claim ownership of "customer data". How do you resolve it?`,
  a: r`Usually both are right about different things: "customer" means different concepts in different bounded contexts.

1. **Clarify the concepts**: identity and contact details (Customer/Identity context), credit profile (Risk), marketing preferences (Marketing), billing account (Billing).
2. **Assign ownership per concept/attribute**: one authoritative owner per attribute; others consume via events/APIs and keep local projections.
3. **Define the shared identifier** (customer id) and how it is created (Identity context issues it).
4. **Publish contracts** (CustomerRegistered, AddressChanged) with clear semantics.
5. **Agree processes** for corrections, erasure and data quality.
6. **Record the decision** in an ADR and the service catalogue.

As facilitator: use event storming or a context mapping workshop with both teams and the business data owner, focusing on who is accountable for correctness of each attribute.`,
  code: r`~~~text
Context map: "Customer"
Identity context (owner):      CustomerId, legal name, date of birth, verified email/phone, addresses
Risk context (owner):          credit score, risk band, KYC status      (consumes identity events)
Marketing context (owner):     consents, preferences, segments          (consumes identity events)
Billing context (owner):       billing account, payment terms           (consumes identity events)
Rule: only the owner writes an attribute; others subscribe and keep projections
~~~`,
  pts: [r`Different contexts mean different "customers".`, r`Assign one owner per concept or attribute.`, r`Define the shared identifier and who issues it.`, r`Publish contracts; others keep projections.`, r`Facilitate with context mapping; record in an ADR.`],
  ex: r`A context-mapping workshop split "customer" into four owned concepts, ending a year-long dispute and duplicate update bugs.`,
  fu: [r`How do you handle a correction to data owned by another context?`],
  pit: [r`Creating a shared "customer service" both teams write to.`] },

{ id: 'q44', level: 'Principal', tags: ['dr', 'resilience'],
  q: r`How do you design disaster recovery for a microservices platform?`,
  a: r`- **Tier services** by business criticality with RPO/RTO per tier.
- **Data first**: databases with replication/backups per tier (sync standby for tier 0, cross-region replicas or backups), brokers with replication or replay capability, object storage replication.
- **Infrastructure as code** so the platform (clusters, networking, policies) can be recreated in another region quickly; GitOps to redeploy all services.
- **Dependency ordering**: identity, secrets, configuration, data stores, then services; document and automate.
- **Global traffic management** with health-based failover.
- **Consistency after failover**: reconciliation jobs, idempotent consumers to replay events, handling of in-flight sagas.
- **Regular drills** (region evacuation), measuring RTO/RPO; chaos experiments for dependencies.`,
  code: r`~~~bash
# DR runbook core automation (excerpt)
terraform -chdir=infra/regions/dr apply -auto-approve          # cluster, networking, identity, secrets replicas
az sql failover-group set-primary --name ledger-fog --resource-group rg-dr --server ledger-dr   # tier-0 data
argocd app sync platform-dr --prune                             # GitOps redeploys all services in DR
az network front-door endpoint update --enabled-state Enabled --name dr-endpoint ...   # shift traffic
./reconcile --since "$(date -u -d '-2 hours' +%FT%TZ)"          # payments + orders reconciliation after failover
~~~`,
  pts: [r`Tier services with RPO/RTO targets.`, r`Replicate data per tier; brokers replayable.`, r`IaC and GitOps to rebuild the platform.`, r`Automate dependency ordering and traffic failover.`, r`Reconcile after failover; drill regularly.`],
  ex: r`A region-evacuation drill found that the secrets vault was not replicated; fixing it cut the measured RTO from 3 hours to 40 minutes.`,
  fu: [r`How do in-flight sagas behave during a region failover?`],
  pit: [r`DR plans that were never executed end to end.`] },

{ id: 'q45', level: 'Principal', tags: ['code-review'],
  q: r`Code review: what is wrong with this inter-service call in an order service?`,
  a: r`~~~csharp
public async Task<OrderDto> CreateOrder(CreateOrder cmd)
{
    var client = new HttpClient { BaseAddress = new Uri("http://10.0.4.17:5000") };
    var customer = await client.GetFromJsonAsync<CustomerDto>("/customers/" + cmd.CustomerId);
    var stock = await client.GetFromJsonAsync<int>("/inventory/" + cmd.Sku);
    if (stock < cmd.Qty) throw new Exception("No stock");
    var order = new Order(cmd, customer!.Name, customer.Email);
    _db.Orders.Add(order);
    await _db.SaveChangesAsync();
    await client.PostAsJsonAsync("/inventory/decrement", new { cmd.Sku, cmd.Qty });
    await client.PostAsJsonAsync("/emails/send", new { customer.Email, Subject = "Order placed" });
    return order.ToDto();
}
~~~

1. **new HttpClient per call** and a **hard-coded IP**: socket exhaustion, no discovery, no TLS.
2. **No timeouts, retries, breakers or cancellation**.
3. **Race**: check stock, then decrement later; concurrent orders oversell. Use an atomic reservation in the inventory service (or saga step).
4. **Dual writes**: order saved, then inventory decrement and email calls can fail: inconsistent state. Use outbox/events or a saga.
5. **Synchronous email** in the request path: email outage fails order creation; make it async.
6. **Copying customer email** into the order (PII duplication) without need.
7. **Generic Exception** for a business outcome; no idempotency key for retries.
8. Calls to three different services through one client base address (wrong service boundaries in code).`,
  code: r`~~~csharp
public async Task<IResult> CreateOrder(CreateOrder cmd, string idempotencyKey, CancellationToken ct)
{
    if (await _db.Orders.AnyAsync(o => o.IdempotencyKey == idempotencyKey, ct)) return Results.Accepted();
    var order = Order.Start(cmd, idempotencyKey);                          // status PendingReservation
    _db.Orders.Add(order);
    _db.Outbox.Add(OutboxMessage.From(new OrderStarted(order.Id, cmd.Sku, cmd.Qty, cmd.CustomerId)));
    await _db.SaveChangesAsync(ct);
    return Results.Accepted("/orders/" + order.Id, order.ToDto());      // saga: reserve stock -> confirm -> OrderConfirmed -> email
}
~~~`,
  pts: [r`HttpClient per call and hard-coded IPs.`, r`No resilience, timeouts or cancellation.`, r`Check-then-act stock race.`, r`Dual writes and synchronous email in the request path.`, r`Fix with idempotency, outbox and a saga with atomic reservation.`],
  ex: r`Code like this oversold limited stock and failed orders whenever the email provider was slow.`,
  fu: [r`How would you implement the reservation step?`],
  pit: [r`Fixing only the HttpClient issue.`] },

{ id: 'q46', level: 'Principal', tags: ['technology-choices'],
  q: r`How much technology diversity should you allow across microservices?`,
  a: r`Microservices allow polyglot choices, but each additional language, database or broker multiplies costs: hiring, libraries for security/observability, platform support, on-call knowledge, upgrades and vulnerability management.

Approach:

- **Default stack** (e.g. .NET + PostgreSQL/SQL Server + Redis + Kafka/Service Bus) fully supported by the platform with templates and expertise.
- **Approved alternatives** with clear use cases (Python for ML, Go for some infrastructure tools, OpenSearch for search).
- **Exceptions via ADR**: the team justifies the benefit, owns the operational cost, and plans for support.
- **Lifecycle**: technology radar (adopt, trial, assess, hold); retire technologies with few users.
- **Avoid resume-driven choices**; evaluate total cost over years.`,
  code: r`~~~text
Technology radar (excerpt)
ADOPT:  .NET 8/9 LTS, PostgreSQL, Azure SQL, Redis, Kafka (Event Hubs), OpenTelemetry, YARP
TRIAL:  .NET Aspire for local dev, Dapr for state abstraction (2 teams)
ASSESS: Native AOT for edge services
HOLD:   new MongoDB clusters (operational skills concentrated in one team), self-hosted RabbitMQ
Exception process: ADR + platform review + named on-call owner
~~~`,
  pts: [r`Each extra technology multiplies operational and skills cost.`, r`Define a fully supported default stack.`, r`Allow approved alternatives with clear use cases.`, r`Exceptions via ADR with owned costs.`, r`Maintain a technology radar and retire stragglers.`],
  ex: r`A company with 7 languages across 80 services consolidated to 3; security patching time dropped from weeks to days.`,
  fu: [r`How do you handle a team that wants a new database?`],
  pit: [r`Unlimited freedom leading to unsupported stacks.`] },

{ id: 'q47', level: 'Principal', tags: ['metrics', 'success'],
  q: r`How do you measure whether a microservices architecture is succeeding?`,
  a: r`Measure the outcomes microservices were supposed to deliver:

- **Delivery**: DORA metrics per team (deployment frequency, lead time for changes, change failure rate, time to restore). Independent deployability: share of deployments needing coordination with other teams.
- **Reliability**: SLO attainment per service and journey, incident counts and blast radius (how many services/customers affected).
- **Scalability and efficiency**: cost per transaction, utilisation, ability to scale hot components independently.
- **Team health**: cognitive load surveys, on-call load (pages per week), onboarding time.
- **Architecture health**: coupling metrics (sync calls per request, co-deployments), contract break incidents, orphaned services.

Report trends quarterly; if outcomes do not improve, revisit boundaries or consolidate.`,
  code: r`~~~text
Quarterly architecture health
Metric                                   Q1     Q2     Q3
Median lead time (days)                  9.5    6.0    3.2
Deploys needing cross-team coordination  41%    22%    9%
Change failure rate                      19%    13%    8%
Sync calls per checkout request          11     7      4
Pages per on-call week (median)          9      6      3
Cost per 1,000 orders                    $4.10  $3.70  $3.20
~~~`,
  pts: [r`Measure outcomes, not service counts.`, r`DORA metrics and independent deployability.`, r`SLOs, incidents and blast radius.`, r`Cost per transaction and team health.`, r`Coupling metrics; consolidate if outcomes stall.`],
  ex: r`Tracking co-deployments revealed two services always released together; merging them improved lead time more than any new extraction.`,
  fu: [r`How do you measure cognitive load?`],
  pit: [r`Celebrating the number of services as progress.`] },

{ id: 'q48', level: 'Principal', tags: ['ai', 'microservices'],
  q: r`How do you integrate AI/LLM capabilities into a microservices architecture responsibly?`,
  a: r`- **Dedicated AI services** (or a platform "AI gateway") owning model access: provider abstraction, prompt management, caching, rate limiting, cost tracking, content safety, and PII redaction.
- **Domain services call the AI service through contracts**, not provider SDKs directly.
- **Asynchronous patterns** for slow or batch AI tasks (document summarisation, classification) via queues; synchronous only with strict timeouts and fallbacks.
- **Retrieval services** (search/vector indexes) fed by events from owning services, with access control metadata.
- **Evaluation and monitoring**: quality metrics, drift, cost per request, latency; human review for high-risk outputs.
- **Governance**: approved models, data residency, logging policies, audit of prompts and outputs where required.`,
  code: r`~~~csharp
// Domain service depends on a contract, not on a model provider SDK
public interface IComplaintClassifier { Task<Classification> ClassifyAsync(string text, CancellationToken ct); }
public sealed class AiGatewayClassifier(HttpClient http) : IComplaintClassifier
{
    public async Task<Classification> ClassifyAsync(string text, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct); cts.CancelAfter(TimeSpan.FromSeconds(3));
        try
        {
            using var res = await http.PostAsJsonAsync("/v1/classify/complaints", new { text }, cts.Token);
            return (await res.Content.ReadFromJsonAsync<Classification>(cts.Token))!;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return Classification.NeedsHumanTriage; }   // fallback
    }
}
~~~`,
  dia: r`flowchart LR
  D1[Complaints service] --> AIG[AI gateway: prompts, routing, safety, cost, redaction]
  D2[Support service] --> AIG
  AIG --> M1[Model provider A]
  AIG --> M2[Model provider B]
  AIG --> RET[Retrieval service: vector + ACLs]
  SRC[Owning services] -->|events| RET
  AIG --> EVAL[Evaluation + monitoring]`,
  pts: [r`Centralise model access in an AI gateway or service.`, r`Domain services depend on contracts, not provider SDKs.`, r`Async for slow tasks; timeouts and fallbacks for sync.`, r`Retrieval indexes fed by events with access control.`, r`Evaluate quality, cost and safety; govern models and data.`],
  ex: r`An AI gateway let a bank switch model providers for a classification feature without changing the 6 services that used it.`,
  fu: [r`How do you test AI-backed services?`],
  pit: [r`Each service calling LLM providers directly with its own keys.`] },

{ id: 'q49', level: 'Principal', tags: ['leadership'],
  q: r`How do you lead the cultural and organisational changes microservices require?`,
  a: r`- **Ownership culture**: "you build it, you run it" with real authority and support (on-call training, error budgets, time for reliability work).
- **Product thinking for platforms and APIs**: internal consumers as customers.
- **Decision-making close to teams**: guardrails and principles instead of central approvals; ADRs for transparency.
- **Shared standards evolved by communities of practice**, not imposed.
- **Blameless learning**: postmortems shared across teams.
- **Leadership alignment**: product managers understand eventual consistency and incremental migration; budgets include platform and reliability work.
- **Communication**: clear narrative of why, measurable goals, regular progress reviews.

Expect a temporary productivity dip; plan for it and communicate it.`,
  code: r`~~~text
Engineering principles (published, one page)
1. Teams own services end to end, including on-call.
2. Contracts are products: versioned, documented, backward compatible.
3. Every service ships with telemetry, health checks and resilience defaults.
4. No shared databases; integrate through APIs and events.
5. Decisions are recorded as ADRs in the repo; disagreements escalate to the guild, not to a board.
~~~`,
  pts: [r`Build ownership with authority and support.`, r`Treat platforms and APIs as products.`, r`Guardrails and principles instead of central approvals.`, r`Blameless learning shared across teams.`, r`Align leadership on costs, timelines and a temporary dip.`],
  ex: r`Publishing five engineering principles and an error-budget policy aligned 15 teams faster than a hundred-page standard.`,
  fu: [r`How do you handle a team that resists on-call ownership?`],
  pit: [r`Changing architecture without changing ownership and incentives.`] },

{ id: 'q50', level: 'Principal', tags: ['summary'],
  q: r`Summarise your microservices philosophy as a Principal Engineer.`,
  a: r`"Microservices are a tool for scaling organisations, and I adopt them only where the benefits outweigh the distributed-systems tax:

- I start with a modular monolith and extract services along business capabilities when a measured force (team autonomy, scaling, isolation, compliance) requires it.
- Each service owns its data and contracts; integration is asynchronous by default, with short synchronous paths for queries.
- I make correctness the default: idempotency, outbox/inbox, sagas with compensations, reconciliation.
- I make operations the default: resilience, telemetry, SLOs, progressive delivery, through a paved-road platform.
- I align services with teams and measure success with DORA metrics, reliability and cost, merging services when coupling shows the boundary is wrong."`,
  code: r`~~~csharp
// A well-behaved service in one screen: defaults, owned data, outbox, idempotent consumer, resilient client
var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();                                            // telemetry, health, resilience
builder.Services.AddDbContext<OrdersDb>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("orders")));
builder.Services.AddMassTransit(x => { x.AddConsumer<PaymentCapturedConsumer>(); x.AddEntityFrameworkOutbox<OrdersDb>(o => { o.UsePostgres(); o.UseBusOutbox(); }); x.UsingRabbitMq((c, cfg) => cfg.ConfigureEndpoints(c)); });
builder.Services.AddHttpClient<IPricing, PricingClient>().AddStandardResilienceHandler();
var app = builder.Build();
app.MapDefaultEndpoints();
app.Run();
~~~`,
  pts: [r`Microservices scale organisations; adopt them deliberately.`, r`Modular monolith first; extract on measured forces.`, r`Owned data, contracts, async by default.`, r`Correctness and operations built in by default.`, r`Measure outcomes and fix boundaries, including merging.`],
  ex: r`This philosophy, illustrated with one migration you led and its metrics, is the strongest close in a microservices interview.`,
  fu: [r`What is the biggest microservices mistake you have seen?`],
  pit: [r`Treating microservices as the goal rather than a means.`] }
],
cheat: r`### When and why
Organisational scaling tool: independent teams, deploys, scaling, isolation. Costs: distributed failures, consistency, ops, contracts. Default: modular monolith, extract on measured forces.

### Boundaries
Business capabilities / bounded contexts (event storming) · one owner per data · one team per service · avoid entity services and technical-layer splits · merge what always changes together.

### Integration
| Need | Pattern |
|---|---|
| Answer now | Sync REST/gRPC, short chains, deadlines |
| State change for others | Event via outbox |
| Work for one owner | Command on a queue |
| Multi-service transaction | Saga (choreography or orchestration) + compensations |
| Cross-service query | API composition (BFF) or CQRS read model |
| Exactly-once effects | Outbox + inbox + idempotency keys |

### Operations
Resilience defaults (timeouts, retries with jitter, breakers, bulkheads) · OpenTelemetry tracing across messaging · SLOs and burn-rate alerts · canary + auto rollback · expand/contract migrations · contract tests + schema registry · DLQ + replay · service catalogue and scorecards · cost attribution.

### Anti-patterns
Distributed monolith · shared databases or domain libraries · long sync chains · dual writes · nano-services · business logic in gateways/BFFs · lock-step releases · unlimited tech diversity.

### Say this
"Microservices are an organisational scaling tool." "Modular monolith first." "One owner per data." "Async by default, sync for answers." "I measure lead time and blast radius, not service count."`
});
})(String.raw);
