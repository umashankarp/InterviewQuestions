# Module — ASP.NET Core: gRPC & Service-to-Service Contracts

> Domain: .NET / ASP.NET Core | Level: Beginner → Expert | Prerequisite: [[03-MinimalAPIs-vs-Controllers-ModelBinding]] (endpoint style, serialisation), [[04-Authentication-Authorization-Deep-Dive]] (workload identity, mTLS), [[../03-REST-APIs/03-API-Documentation-Contract-Testing]] (schema compatibility)

---

## 1. Topic Description

### Definition

**gRPC** is a contract-first RPC framework: a `.proto` file defines services and messages in Protocol Buffers IDL, a compiler generates strongly-typed client and server code, and calls travel over **HTTP/2** with a compact binary payload. Its distinguishing properties against REST-over-JSON are a *machine-enforced* contract rather than a documented one, a binary encoding that is substantially smaller and cheaper to parse, HTTP/2 multiplexing that removes head-of-line blocking across concurrent calls on one connection, and first-class **streaming** in both directions. Those properties make it a strong fit for internal service-to-service communication and a poor one for public, browser-facing APIs.

### Core sub-concepts

- **Protocol Buffers** — message definition, scalar and message types, `repeated`, `map`, `oneof`, and the wire format's tag-length-value encoding.
- **Field numbers as the contract** — numbers rather than names identify fields on the wire; reserving removed numbers; why renaming a field is safe and renumbering is catastrophic.
- **Schema evolution rules** — adding optional fields is safe, removing requires reservation, changing a type is breaking; `proto3` default-value semantics and the absence of "field not set" for scalars without `optional`.
- **Service definition and code generation** — `service`/`rpc` declarations, generated base classes and clients, and the build integration that makes the `.proto` the single source of truth.
- **The four call types** — unary, server streaming, client streaming, bidirectional streaming, and what each is actually for.
- **HTTP/2 mechanics** — multiplexing, header compression, flow control, and why a single connection carries many concurrent calls.
- **Channels and clients** — channel as the expensive, long-lived, thread-safe object; `GrpcChannel` reuse and the `gRPC` client factory for lifetime and resilience integration.
- **Deadlines** — a first-class, propagated concept rather than a per-hop timeout, and why every call should set one.
- **Cancellation** — `CancellationToken` propagation across the wire and into the server handler.
- **Status codes and error handling** — the gRPC status model, `RpcException`, rich error details, and mapping domain failures to statuses.
- **Interceptors** — client and server interceptors for logging, tracing, authentication and retries; the analogue of middleware.
- **Security** — TLS as the default expectation, mTLS for workload identity, and token-based auth via call credentials and metadata.
- **Load balancing** — why L4 load balancing breaks gRPC (long-lived connections pin to one backend), and the need for L7 or client-side balancing.
- **Browser support and gRPC-Web** — why browsers cannot speak gRPC directly, and what the proxy or transcoding layer costs.
- **JSON transcoding** — exposing gRPC services as REST endpoints from annotations, and where that is and is not appropriate.
- **Reflection and tooling** — server reflection for `grpcurl`-style tools, and the debuggability gap versus plain HTTP.

### Where it fits

gRPC is an alternative endpoint style to the controllers and minimal APIs covered in `03`, running on the same Kestrel server and the same middleware pipeline, with the same DI and configuration underneath. Its distinguishing architectural property is that the *contract is an artefact* — a `.proto` file that both sides compile against — which places it directly alongside the contract-testing and schema-compatibility concerns of `03-REST-APIs/03`. Downstream it interacts with infrastructure more than REST does: HTTP/2's long-lived connections change how load balancers, service meshes and proxies must be configured, which is where most gRPC adoption problems actually occur.

### Why it matters at scale

The performance case is real — a binary payload is typically several times smaller than the equivalent JSON and much cheaper to parse, and HTTP/2 multiplexing removes the connection-per-concurrent-call pressure — so for chatty internal service-to-service traffic the saving in bandwidth, CPU and latency is material at high volume. The contract case matters more over time: a generated client cannot call a method that does not exist or send a field of the wrong type, so a whole class of integration failure becomes a compile error rather than a production incident. Against that, the operational failure modes are unfamiliar and severe: because gRPC uses long-lived HTTP/2 connections, a naive L4 load balancer pins each client to one backend for the connection's life, so traffic distributes by *connection* rather than by *request* — a new backend receives nothing until clients reconnect, and one backend can be saturated while others idle.

### Common pitfalls / anti-patterns

- **Changing or reusing a field number** — field numbers are the wire identity, so renumbering silently reinterprets data as a different field, and reusing a removed number makes old clients' data land in a new field; removed numbers must be `reserved`.
- **Creating a `GrpcChannel` per call** — the channel owns the HTTP/2 connection and is expensive to establish; per-call creation destroys connection reuse and exhausts sockets, exactly as with `HttpClient`.
- **L4 load balancing in front of gRPC** — connections are long-lived, so requests do not redistribute; scaling out adds capacity that receives no traffic, and load is unbalanced in a way that looks like a capacity problem.
- **Not setting deadlines** — without one a call can hang until a transport-level failure, so a slow dependency propagates as an indefinite wait; deadlines are propagated across hops and are the correct mechanism rather than per-hop timeouts.
- **Treating `proto3` scalar defaults as "not provided"** — an unset `int32` is `0` and an unset `string` is empty, indistinguishable from an explicitly-sent zero, so "clear this field" and "don't change it" cannot be expressed without `optional` or a wrapper.
- **Exposing gRPC directly to browsers** — browsers cannot speak the protocol; gRPC-Web with a proxy or JSON transcoding is required, and choosing gRPC for a browser-facing API without accounting for that is a late and expensive discovery.
- **Streaming used where unary would do** — a stream is a stateful, long-lived call with its own lifecycle, error handling and flow-control concerns; using it for a request that returns a bounded list adds complexity for no benefit.
- **Mapping every failure to `Internal` or `Unknown`** — the status model is how clients decide whether to retry, so collapsing domain failures into a generic status makes correct client behaviour impossible.
- **Assuming the generated client is resilient** — it is not; retries, backoff, circuit breaking and hedging must be configured explicitly, and a naive retry on a non-idempotent method duplicates work.
- **Letting the `.proto` be owned by one side** — a contract that the producer changes unilaterally without compatibility checks reintroduces exactly the breakage that a schema was meant to prevent.

---

## 2. Beginner (10 Q&A)

**Q1. What does gRPC give you that REST-over-JSON does not?**
**A:** A machine-enforced contract with generated clients, so a mismatch is a compile error rather than a runtime surprise; a binary encoding that is substantially smaller and cheaper to serialise than JSON; HTTP/2 multiplexing so many concurrent calls share one connection without head-of-line blocking; and first-class streaming in both directions. The cost is that it is not browser-native, is harder to inspect and debug than plain HTTP, and requires infrastructure that handles HTTP/2 correctly. That trade makes it strong internally and weak as a public API.
*Follow-up: Which of those benefits would you expect to matter most in a service mesh with thousands of internal calls per second?*

**Q2. Why are Protocol Buffers field numbers so important?**
**A:** Because the wire format identifies fields by *number*, not by name — a serialised message is a sequence of tag-length-value entries where the tag encodes the field number and type. That means renaming a field is entirely safe (names exist only in the IDL and generated code) while changing a number is catastrophic, since old and new sides interpret the same bytes as different fields. Removed numbers must be marked `reserved` so they are never reused by a later addition, or old clients' data silently populates a new field.
*Follow-up: A developer removes a field and later adds a new one that reuses the number. What actually happens in production?*

**Q3. What are the four gRPC call types and what is each for?**
**A:** Unary is a single request and single response — the default and the right choice for most calls. Server streaming sends one request and receives a sequence, which suits large result sets, progress updates and subscriptions. Client streaming sends a sequence and receives one response, suiting uploads and batched ingestion. Bidirectional streaming allows independent sequences in both directions, for genuinely conversational interactions. The judgement point is that streaming adds a stateful, long-lived call with its own error and flow-control semantics, so it should be chosen for a real reason.
*Follow-up: You need to return 100,000 records. Server streaming or a paged unary call?*

**Q4. What is a channel and how should it be managed?**
**A:** A channel represents the connection to a server: it is expensive to create, thread-safe, and designed to be long-lived and shared, with many concurrent calls multiplexed over it. Creating one per call is the direct analogue of creating an `HttpClient` per request — it discards connection reuse, pays the handshake repeatedly and exhausts sockets under load. In ASP.NET Core the gRPC client factory handles lifetime, configuration and integration with resilience and logging, which is the standard approach.
*Follow-up: What's the equivalent of DNS-rotation staleness for a long-lived gRPC channel?*

**Q5. What is a deadline and why is it better than a timeout?**
**A:** A deadline is an absolute point in time attached to a call and **propagated across hops**: if service A calls B with a two-second deadline and B calls C, C inherits the remaining time rather than starting a fresh timeout. That means the total time budget is enforced end to end rather than multiplying at each hop, and downstream services can stop work that can no longer be useful. Every call should set one; without a deadline a call waits indefinitely for a transport failure, which is how one slow dependency stalls a whole chain.
*Follow-up: What should a server do when it notices the deadline has already expired?*

**Q6. How does error handling work in gRPC?**
**A:** Calls fail with a status code from a defined set — `NotFound`, `InvalidArgument`, `PermissionDenied`, `Unavailable`, `DeadlineExceeded`, `FailedPrecondition` and others — surfaced client-side as an `RpcException`. The status is the mechanism clients use to decide whether to retry, so mapping failures accurately matters operationally: `Unavailable` signals a retryable transient condition, while `InvalidArgument` and `FailedPrecondition` signal that retrying is pointless. Richer detail can be attached as error details in the trailers for structured, machine-readable context.
*Follow-up: How would you distinguish "the order doesn't exist" from "you're not allowed to see it"?*

**Q7. Why can't a browser call a gRPC service directly?**
**A:** Browsers do not expose the low-level HTTP/2 control the protocol requires — trailers in particular — through the fetch API, so the wire protocol cannot be produced from browser JavaScript. gRPC-Web is the adaptation, requiring a proxy or in-process translation layer, and it does not support all call types (client and bidirectional streaming are limited). The alternative is JSON transcoding, exposing the same service as REST endpoints from annotations. Either way, browser support is an explicit design step rather than something that comes free.
*Follow-up: What does JSON transcoding cost you compared to writing a separate REST API?*

**Q8. What are interceptors and what would you use them for?**
**A:** They are the gRPC equivalent of middleware — components that wrap call execution on the client or the server, able to inspect and modify the call, short-circuit it, or observe its outcome. Typical uses are attaching authentication metadata client-side, logging and tracing on both sides, enforcing authorisation server-side, and implementing retry or fallback behaviour. They are the correct place for cross-cutting concerns, exactly as middleware is for HTTP, and they are how you avoid duplicating that logic in every generated client call site.
*Follow-up: Where would you put trace-context propagation — an interceptor or the transport?*

**Q9. What does `proto3` do about optional fields, and why does it cause bugs?**
**A:** In `proto3` scalar fields have implicit defaults and, without the `optional` keyword, no presence tracking — an unset `int32` deserialises as `0` and an unset `string` as empty, indistinguishable from an explicitly-sent zero or empty value. That means "not provided" and "provided as the default" cannot be told apart, so a partial-update API cannot express "leave this field alone" versus "set it to zero". The remedies are marking fields `optional` for explicit presence, or using wrapper message types, and it is a decision to make when designing the contract rather than discovering later.
*Follow-up: You're designing a partial-update RPC. How do you model it?*

**Q10. How does gRPC authenticate calls?**
**A:** Two complementary mechanisms. Transport-level: TLS by default, and mTLS where each service presents a certificate, which gives strong workload identity and is the common pattern inside a mesh. Call-level: credentials attached as metadata — typically a bearer token — which an interceptor adds client-side and a server-side interceptor or authorisation policy validates. In ASP.NET Core the same authentication and authorisation infrastructure applies, so policies and claims work as they do for HTTP endpoints.
*Follow-up: In a mesh doing mTLS, do you still need per-call tokens?*

---

## 3. Intermediate (10 Q&A)

**Q1. You scale a gRPC service from two to ten instances and the new ones receive no traffic. Explain.**
**A:** Load balancing at L4 distributes *connections*, not requests, and gRPC connections are long-lived with many calls multiplexed over each. Existing clients keep their established connections to the original instances, so the new ones receive nothing until something forces a reconnect. The fixes are an L7 load balancer or proxy that understands HTTP/2 and balances per request, client-side load balancing with service discovery, or a service mesh sidecar doing it. A crude mitigation is periodic connection recycling via max-connection-age on the server, which forces clients to redistribute.
*Follow-up: Max-connection-age causes a reconnect wave every N minutes. How do you avoid a synchronised herd?*

**Q2. How do you evolve a `.proto` contract safely?**
**A:** Additively, and with the rules enforced mechanically. Adding a new field with a new number is safe in both directions; renaming is safe on the wire; removing requires `reserved` on both the number and the name so neither is reused; changing a type or a number is breaking. The essential control is a schema-compatibility check in CI comparing the proposed `.proto` against the deployed one and failing the build on a breaking change — because these rules are easy to state and easy to violate in a diff that looks harmless. I would also version at the *service* level for genuinely incompatible redesigns rather than trying to evolve one contract indefinitely.
*Follow-up: You must change a field's type from `int32` to `string`. How do you do it without breaking anyone?*

**Q3. Where should the `.proto` files live and who owns them?**
**A:** In a location both sides consume as a versioned artefact — a shared repository or a package published from the producer's build — rather than copied into each consumer, because copies diverge and the contract stops being a single source of truth. Ownership sits with the producer, but changes need consumer visibility, which in practice means the compatibility check in CI plus a review path for breaking changes. The failure mode I would design against is a producer changing the `.proto` unilaterally and consumers discovering it at runtime, which reintroduces exactly the class of failure the schema exists to prevent.
*Follow-up: A consumer needs a field the producer won't add. How do you handle that?*

**Q4. When would you choose gRPC over REST for a new internal service?**
**A:** When the call volume is high enough that payload size and serialisation cost matter, when the contract discipline of generated clients is worth more than the ability to curl an endpoint, or when streaming is genuinely needed. When the consumers are internal and you can coordinate their toolchains. I would choose REST when consumers are external or diverse, when browser access matters, when human debuggability during incidents is a high priority, or when the team's operational familiarity is with HTTP — because the infrastructure pitfalls of HTTP/2 are real and unfamiliar, and an unfamiliar failure mode during an incident costs more than the efficiency saved.
*Follow-up: The team wants gRPC for performance but the service handles 50 requests per second. What do you say?*

**Q5. How do you implement resilience for gRPC calls?**
**A:** Explicitly, because the generated client provides none. Deadlines on every call as the primary control, retry policies configured with attention to *which* status codes are retryable (`Unavailable` yes, `InvalidArgument` never), backoff with jitter, and circuit breaking so a failing dependency stops receiving traffic. The critical constraint is idempotency: retrying a non-idempotent RPC duplicates the effect, so retry configuration must be per-method rather than global. gRPC also supports hedging, sending a duplicate request after a delay to cut tail latency, which is powerful and requires idempotency even more strictly.
*Follow-up: Which of your service's methods would you mark as safe to retry, and how would you decide?*

**Q6. How does streaming change error handling and resource management?**
**A:** A stream is a long-lived stateful call, so failures can occur mid-stream after partial data has been consumed — the client must be able to handle a partial result, which a unary call never produces. Cancellation must be propagated so an abandoned stream does not leave the server producing data nobody reads. Resources are held for the stream's duration: a server-side enumerator, a database cursor, a buffer. And backpressure matters, since HTTP/2 flow control will slow a producer whose consumer cannot keep up, which is correct behaviour but means a slow client ties up server resources. All of that is why streaming should be a deliberate choice.
*Follow-up: A server-streaming call holds a database reader open. What's the risk and how do you bound it?*

**Q7. How do you debug gRPC in production, given the payload is binary?**
**A:** Instrumentation has to compensate for the loss of curl-and-read. Server reflection enables tools like `grpcurl` to enumerate and call services interactively, which is worth enabling in non-production and considering carefully in production. Structured logging of method, status, deadline and duration on both sides via interceptors gives the operational picture. Distributed tracing is more valuable here than for REST, because you cannot reconstruct a call by reading a payload. I would also keep JSON transcoding available on non-production environments purely for human inspection.
*Follow-up: What's the risk of enabling server reflection in production?*

**Q8. What are the infrastructure requirements gRPC imposes?**
**A:** End-to-end HTTP/2, which means every hop — load balancer, ingress, proxy, service mesh — must support it and must not downgrade the connection, and TLS termination points must handle ALPN correctly. L7 request-level load balancing rather than L4. Health checking that understands gRPC's own health protocol rather than probing an HTTP path. Timeouts and idle-connection settings on intermediaries that accommodate long-lived connections, since a proxy closing idle connections aggressively produces confusing intermittent failures. Most gRPC adoption problems I have seen are infrastructure misconfiguration rather than application code.
*Follow-up: An ingress terminates HTTP/2 and forwards HTTP/1.1 to your service. What breaks?*

**Q9. How do you handle a service that must serve both gRPC and REST consumers?**
**A:** JSON transcoding lets one service definition serve both from `.proto` annotations, which avoids maintaining two implementations and keeps one contract — the right answer when the REST surface is a convenience over the same operations. Where the REST API is a genuine public product with its own resource design, versioning and error contract, transcoding produces an awkward RPC-shaped REST API and a hand-written façade is better. The decision is whether the REST surface is a *projection* of the internal contract or a designed product in its own right.
*Follow-up: Transcoding gives you `POST /v1/orders:cancel`. Is that acceptable as a public API?*

**Q10. How do you test gRPC services and their contracts?**
**A:** Unit-test the service implementation directly by calling the generated base class with a test `ServerCallContext`, which needs no transport. Integration-test through an in-memory or test-server channel to exercise interceptors, authorisation and serialisation, since those are where the real defects are. For contracts, the compatibility check in CI is the primary control; consumer-driven contract testing adds value where consumers depend on a subset of behaviour. I would specifically test deadline and cancellation propagation, because those are the paths that silently do nothing when misimplemented.
*Follow-up: How would you verify that cancellation actually stops server-side work?*

---

## 4. Expert / Architect (10 Q&A)

**Q1. How do you decide the internal communication standard for an organisation?**
**A:** By weighing consistency against fit. A single standard — usually REST-over-JSON — has real value: one set of tooling, one debugging model, one skill set, and no per-service decision. gRPC earns an exception where the traffic pattern justifies it: high-volume chatty internal calls, streaming requirements, or strict contract enforcement across many teams. What I would avoid is per-team choice without a rationale, which produces an estate where every integration needs its own tooling and every incident needs a different playbook. I would set a default, define the criteria for deviating, and require the infrastructure prerequisites to be in place before the first adoption.
*Follow-up: Two teams already use gRPC and the rest use REST. Do you converge, and in which direction?*

**Q2. What is the real cost of adopting gRPC, beyond the code?**
**A:** Infrastructure and operations. Every hop must handle HTTP/2 correctly, load balancing must move to L7 or client-side, health checks change, and observability tooling must understand the protocol — and the failure modes when any of that is wrong are unfamiliar and hard to diagnose. There is also a debuggability cost: binary payloads mean you cannot read a request from a log or reproduce a call with curl, which lengthens incident response until the team builds equivalent tooling. And there is a skills cost, because the number of engineers fluent in gRPC operational behaviour is far smaller than for HTTP. Those costs are what should be weighed, not the serialisation benchmark.
*Follow-up: How would you de-risk the first production gRPC service?*

**Q3. How do you manage contract governance for gRPC across many teams?**
**A:** Treat the `.proto` as the highest-value artefact: version-controlled in a location all consumers reference, published as a versioned package from the producer's pipeline, with a breaking-change check in CI that compares against the deployed version and fails the build. Add a linter for style and naming so contracts are consistent, and a review path for breaking changes with a deprecation process. The organisational point is that gRPC gives you a machine-checkable contract, which is a large advantage over REST — but only if the checking is actually wired into the pipeline, and without that the schema is just documentation that happens to compile.
*Follow-up: A breaking change is genuinely necessary. What's the process from proposal to removal of the old version?*

**Q4. How does gRPC interact with a service mesh?**
**A:** Well, and it is arguably the natural pairing: the mesh provides mTLS workload identity, L7 load balancing that understands HTTP/2, retries and circuit breaking, and observability — all the things gRPC requires and does not supply. That removes most of the infrastructure burden from application teams. The caution is duplication: retries configured both in the mesh and in the client multiply, deadlines interact with mesh timeouts in ways that can be surprising, and two layers of circuit breaking are hard to reason about. I would decide explicitly which layer owns each concern and configure the other to defer.
*Follow-up: Retries are configured in both the mesh and the client. What actually happens and how do you fix it?*

**Q5. How would you migrate an existing REST service to gRPC without disruption?**
**A:** Run both surfaces simultaneously from one implementation — either by adding gRPC alongside the existing controllers over the same application services, or by using JSON transcoding so one definition serves both. Migrate consumers individually with telemetry showing which surface each is using, and retire REST only when that telemetry shows it is unused. Critically, get the infrastructure prerequisites in place and validated *before* moving any real traffic, since that is where the failures occur. I would also confirm the migration has a concrete justification — measured payload or latency cost, or a contract-discipline problem — because a migration without one is expensive and invisible to users.
*Follow-up: Telemetry shows one consumer still on REST after six months and nobody knows who owns it. What now?*

**Q6. How do deadlines and cancellation shape a distributed system's behaviour?**
**A:** They are the mechanism that stops a slow dependency consuming capacity across the whole call graph. A propagated deadline means every service in a chain knows the remaining budget and can abandon work that can no longer be useful, rather than each hop starting a fresh timeout and the total ballooning. Combined with cancellation reaching the database call, an abandoned request stops holding a connection. Without them, a slow leaf service causes resource accumulation at every level above it, which is the classic cascading failure. I would treat "every call has a deadline derived from the caller's budget" as a firm architectural rule.
*Follow-up: How do you decide the initial deadline at the edge, and how is the budget divided?*

**Q7. What's your position on gRPC for public APIs?**
**A:** Generally against, for reasons that are about consumers rather than technology. Public consumers are diverse, cannot be coordinated onto a toolchain, need browser support, and value the ability to explore an API with ordinary HTTP tools — all of which REST provides and gRPC does not without a translation layer. gRPC-Web and transcoding exist but add moving parts and limitations. The exception is a public API whose consumers are themselves services in a controlled ecosystem, where the contract enforcement and efficiency genuinely pay. Otherwise I would keep gRPC internal and expose REST outward, which is the common and sensible topology.
*Follow-up: A major partner specifically requests gRPC. Does that change your answer?*

**Q8. How do you handle observability for gRPC in a way that matches what you'd have with HTTP?**
**A:** Interceptors on both client and server emitting the standard signals — method, status code, duration, deadline remaining, payload size — with trace context propagated in metadata so calls stitch into a distributed trace. Status codes must map to a meaningful error taxonomy rather than collapsing into `Unknown`, because the status is what dashboards and alerts key on. I would also capture deadline-exceeded separately from other failures, since it indicates a budget problem rather than a fault. The goal is that an engineer can answer "is it us or a dependency" as quickly as they could with HTTP, which requires deliberate work rather than defaults.
*Follow-up: Your error rate is dominated by `Unknown`. What does that tell you about the implementation?*

**Q9. How do you evaluate whether the efficiency gains justify the complexity?**
**A:** Measure the actual cost being addressed: bytes on the wire, serialisation CPU, and latency attributable to those, as a share of total. In a service whose latency is dominated by a database round trip, replacing JSON with protobuf changes almost nothing measurable, and the complexity is unjustified. In a high-frequency internal call path where payload size and parsing are a real share of the budget — or where bandwidth cost across zones is material — the gain is concrete and worth having. I would insist on that measurement before adoption, because gRPC is frequently chosen on reputation and the benefit is workload-dependent.
*Follow-up: The measurement shows a 15% latency improvement on one internal path. Is that enough?*

**Q10. What separates an excellent answer from an adequate one on gRPC?**
**A:** An adequate answer describes protobuf, HTTP/2 and streaming. An excellent one treats the **contract** as the primary benefit and knows the evolution rules that make it safe — field numbers as wire identity, reservation on removal, and a CI compatibility gate without which the schema is just documentation. It recognises that the hard problems are infrastructural: L4 load balancing pinning connections, HTTP/2 requirements at every hop, health checking, and debuggability. It treats deadlines as a propagated end-to-end budget rather than a timeout, and it knows retries require per-method idempotency analysis. The distinguishing quality is reasoning about the operational and organisational consequences rather than the serialisation benchmark.
*Follow-up: Given that, what would you require to be true before approving gRPC for a team's new service?*
