# Module — ASP.NET Core: Real-Time Communication — SignalR, WebSockets & Server-Sent Events

> Domain: .NET / ASP.NET Core | Level: Beginner → Expert | Prerequisite: [[01-Middleware-Pipeline-Request-Internals]] (connection lifecycle, graceful shutdown), [[04-Authentication-Authorization-Deep-Dive]] (authenticating a persistent connection), [[../01-CSharp/02-Async-Await-Internals]] (backpressure, channels)

---

## 1. Topic Description

### Definition

Real-time communication is the family of techniques for pushing data from server to client without the client polling. **WebSockets** provide a full-duplex, long-lived TCP connection after an HTTP upgrade handshake. **Server-Sent Events (SSE)** provide a one-way server-to-client stream over a normal HTTP response that is never closed. **Long polling** simulates push by holding a request open until data is available. **SignalR** is ASP.NET Core's abstraction over all three: it negotiates the best available transport, adds an RPC-style hub programming model with automatic serialisation, and supplies connection management, groups and reconnection. The defining architectural property of all of them is **stateful connections**, which is what makes them fundamentally different from request/response to operate.

### Core sub-concepts

- **Transport mechanics** — the WebSocket upgrade handshake, SSE's `text/event-stream` framing and automatic browser reconnect, long polling as the universal fallback.
- **SignalR transport negotiation** — the `/negotiate` request, transport fallback order, and `SkipNegotiation` when forcing WebSockets.
- **Hubs and the RPC model** — hub methods, strongly-typed hubs (`Hub<T>`), client-to-server and server-to-client invocation, and hub lifetime (transient per invocation).
- **Connection identity and lifetime** — `ConnectionId`, its instability across reconnects, and why it must never be used as a durable user identifier.
- **Groups and users** — `Groups.AddToGroupAsync`, `IHubContext` for sending from outside a hub, and group membership as connection-scoped rather than user-scoped state.
- **Scale-out and the backplane** — why a stateful connection breaks horizontal scaling, Redis backplane fan-out cost, and Azure SignalR Service as the offload alternative.
- **Sticky sessions** — required for long polling and for the negotiate-then-connect sequence unless the backplane handles it.
- **Backpressure and buffering** — a slow client causing server-side buffer growth, client and server buffer limits, and `Channel<T>`-based flow control.
- **Streaming** — `IAsyncEnumerable<T>` hub streaming in both directions, and cancellation propagation.
- **Reconnection and message loss** — automatic reconnect, what is lost during the gap, and why the transport gives no delivery guarantee.
- **Authentication on persistent connections** — token transmission via query string for WebSockets, token expiry mid-connection, and re-authorisation.
- **Serialisation protocols** — JSON versus MessagePack, payload size and CPU trade-offs.
- **Resource cost per connection** — memory, file descriptors, and why connection count rather than request rate is the capacity metric.
- **Graceful shutdown and deployment** — draining persistent connections during a rolling deploy and the reconnect storm that follows.
- **Choosing the mechanism** — SSE versus WebSockets versus SignalR versus polling, judged on directionality, client support and operational cost.

### Where it fits

Real-time sits on the same Kestrel connection layer as ordinary requests but inverts the pipeline's core assumption: a request no longer arrives, get handled and complete. That single change propagates outward — authentication must survive token expiry on a connection that outlives the token, DI scopes no longer align with a unit of work, load balancing needs affinity or a backplane, graceful shutdown must drain connections rather than requests, and capacity planning is driven by concurrent connections rather than throughput. Downstream it interacts with messaging: a backplane is a pub/sub system, and the delivery guarantees of the transport (none) usually need to be supplemented by durable messaging for anything that matters.

### Why it matters at scale

Persistent connections change the cost and failure model completely. Each connection consumes memory and a file descriptor for its entire lifetime, so a service holding 100,000 connections is constrained by connection count long before request throughput becomes relevant — and the OS-level limits (ephemeral ports, descriptor limits, proxy connection caps) bite in ways that are unfamiliar to teams used to stateless services. Scale-out is the harder problem: because a client is connected to one instance, sending a message to a user requires either affinity or a backplane that fans every message out to every instance, so backplane traffic grows with instance count and becomes the bottleneck. And every deployment disconnects every client simultaneously, producing a reconnect storm that can exceed the capacity of the instances that just came up — which is how a routine rolling deploy becomes an outage.

### Common pitfalls / anti-patterns

- **Treating `ConnectionId` as a user identity** — it changes on every reconnect, so any state keyed by it is orphaned the moment a client's network blips, producing "the user stopped receiving updates" with no error anywhere.
- **Storing per-connection state in memory on the server** — with scale-out the client may reconnect to a different instance, so the state is on the wrong node; group membership is also connection-scoped and must be re-established after every reconnect.
- **Assuming SignalR delivers messages reliably** — there is no acknowledgement or replay; anything sent while a client is disconnected is simply lost, so real-time must not be the only delivery path for anything that matters.
- **A backplane fan-out design that scales with instance count** — every message is published to every instance regardless of whether it has interested clients, so adding instances increases backplane load rather than distributing it.
- **Long-running or blocking work inside a hub method** — hub invocations run on the connection's processing path, so a slow method blocks that connection's other messages and consumes pool threads; the work belongs in a queue.
- **Ignoring slow clients** — the server buffers outbound messages for a client that cannot keep up, so one slow consumer grows memory until limits are hit or the connection is dropped, and without limits configured that is unbounded.
- **Deploying without draining or staggering** — all clients reconnect at once, and with automatic reconnect's default backoff the resulting thundering herd can exceed the new instances' capacity.
- **Sending large payloads over the real-time channel** — it is optimised for small frequent messages, and a large payload blocks the connection and inflates buffers; send a notification with a reference and let the client fetch.
- **Not handling token expiry on a long-lived connection** — the connection was authenticated once and remains open past the token's lifetime, so authorisation decisions are being made on an expired credential.
- **Choosing WebSockets when SSE would do** — one-directional server-push over SSE is simpler, works over plain HTTP with automatic browser reconnect, and traverses proxies more reliably.

---

## 2. Beginner (10 Q&A)

**Q1. Compare WebSockets, SSE and long polling on the properties that actually matter.**
**A:** WebSockets are full-duplex over a single upgraded TCP connection — lowest latency and overhead, but require an upgrade that some proxies mishandle, and reconnection logic is yours to write. SSE is one-way server-to-client over ordinary HTTP, so it traverses proxies cleanly, has automatic browser reconnection with a last-event-ID for resumption, and is much simpler — but it cannot carry client-to-server messages, and browsers limit connections per domain over HTTP/1.1. Long polling works everywhere and costs a request cycle per message plus latency. The decision is usually directionality: if you only push, SSE is the simpler correct answer.
*Follow-up: What does HTTP/2 change about SSE's connection-limit problem?*

**Q2. What does SignalR add over using WebSockets directly?**
**A:** Transport negotiation with fallback, an RPC-style programming model with automatic serialisation and strongly-typed hubs, connection lifetime management, groups and user-targeting, automatic reconnection on the client, and a backplane abstraction for scale-out. That is a substantial amount of infrastructure you would otherwise write. The cost is a framework dependency, a protocol only its clients speak, and an abstraction that hides transport details you sometimes need — so a public API intended for arbitrary clients is often better served by raw WebSockets or SSE with a documented protocol.
*Follow-up: When would you deliberately use raw WebSockets instead of SignalR?*

**Q3. What is the negotiate request and why does it matter operationally?**
**A:** Before connecting, a SignalR client makes an HTTP POST to `/negotiate` and receives a connection token and the list of supported transports. It matters because it creates a two-request sequence: the negotiate and the subsequent connection must reach the *same* server unless a backplane or service handles it, which is why sticky sessions are required in a load-balanced deployment. You can skip it with `SkipNegotiation` when forcing WebSockets, which removes the affinity requirement for that case.
*Follow-up: You have no sticky sessions and clients fail to connect intermittently. Is that the cause?*

**Q4. Why must `ConnectionId` never be used as a user identifier?**
**A:** Because it identifies a *connection*, not a person, and a new one is issued on every reconnect — a network blip, a laptop sleeping, a Wi-Fi handover all produce a new ID. Any server-side state keyed by it becomes orphaned, so a user silently stops receiving messages while the application believes it is still sending them. The correct identity is the authenticated user, and SignalR's user-targeting maps a user to their current connections. A user may also legitimately have several connections at once, across tabs and devices.
*Follow-up: How would you send a message to every device a user has open?*

**Q5. What are groups and what is the catch?**
**A:** Groups are named collections of connections used for fan-out — a chat room, a document's viewers, a dashboard subscription. The catch is that membership is **connection-scoped and not persisted**: when a client reconnects it has a new connection that belongs to no groups, so the application must re-add it, and the natural place for that is the connection-established handler using state the client sends or the server derives from the user. Teams routinely miss this and see users silently stop receiving room messages after a brief disconnect.
*Follow-up: Where would you store the information needed to restore group membership?*

**Q6. How do you send a real-time message from outside a hub — say, from a background job?**
**A:** Inject `IHubContext<THub>` (or the strongly-typed `IHubContext<THub, TClient>`) and use it to target clients, groups or users. You must not instantiate a hub yourself: hubs are transient, created per invocation, and their `Context` and `Clients` are only valid during an invocation. This is the standard route for pushing from a controller, a hosted service or a message consumer, and it is the mechanism that lets domain events reach connected clients.
*Follow-up: Why can't you hold a reference to a hub instance between invocations?*

**Q7. Does SignalR guarantee delivery?**
**A:** No. There is no acknowledgement, no persistence and no replay — a message sent while a client is momentarily disconnected is lost, and the client will not know. That is a deliberate design choice for a real-time transport, and it means real-time must be treated as an *optimisation* over a reliable path rather than as the path itself. The correct pattern for anything that matters is that the authoritative state is fetchable, and the real-time message is a hint to fetch or a redundant fast path.
*Follow-up: How would you design a notification feature so a message is never actually lost?*

**Q8. What is a backplane and why is one needed?**
**A:** With more than one server instance, a client is connected to exactly one of them, so a message published on another instance never reaches it. A backplane — typically Redis — carries every message to every instance, which then forwards to its own connected clients. It is what makes scale-out work at all. Its limitation is that it is a fan-out to *all* instances regardless of interest, so backplane traffic scales with instance count and it eventually becomes the bottleneck.
*Follow-up: At roughly what point does the backplane become the constraint, and what do you do then?*

**Q9. How do you authenticate a WebSocket connection?**
**A:** Browsers cannot set custom headers on a WebSocket handshake, so the token is conventionally passed in the query string, with the server configured to read it from there for hub paths. That has consequences: query strings are logged by proxies and servers, so the token can leak into logs, which argues for short-lived tokens issued specifically for the connection. The subtler issue is expiry — the connection outlives the token, so unless you implement re-authentication the connection continues under a credential that is no longer valid.
*Follow-up: How would you handle token expiry on a connection that's been open for eight hours?*

**Q10. What is the capacity metric for a real-time service?**
**A:** Concurrent connections, not requests per second. Each connection holds memory for its buffers and state plus a file descriptor for its lifetime, so the limits you hit are OS and process limits rather than CPU — descriptor limits, ephemeral ports on any intermediary, and proxy or load-balancer connection caps. That inverts the usual capacity conversation: a service can be nearly idle in CPU terms and unable to accept another connection. Planning has to start from expected concurrent connections and the per-connection memory measured under realistic message rates.
*Follow-up: How would you measure per-connection memory cost for your own application?*

---

## 3. Intermediate (10 Q&A)

**Q1. Users report that updates stop arriving after their laptop wakes from sleep. Diagnose it.**
**A:** The connection dropped and the client reconnected with a new `ConnectionId`, but server-side state tied to the old connection was not re-established — most commonly group membership, which is connection-scoped and does not survive a reconnect. The client is connected and healthy, so nothing errors; it simply belongs to no groups. The fix is to re-establish subscriptions in the connection-established handler, deriving them from the authenticated user or from state the client sends on connect. I would also add telemetry on reconnect counts and post-reconnect subscription restoration, since this failure is otherwise entirely silent.
*Follow-up: The client re-sends its subscriptions on connect, but there's a race with messages sent in between. How do you close that gap?*

**Q2. How do you handle a slow client?**
**A:** The server buffers outbound messages for a client that cannot consume them, so an unbounded buffer means one slow client grows server memory until something breaks. SignalR exposes client and server buffer limits, and the design decision is what to do when they are hit: disconnect the client (protecting the server, and the client will reconnect and re-sync), or drop messages (preserving the connection at the cost of gaps). I would choose disconnect for most applications, because a client that cannot keep up needs a full re-sync anyway, and I would make the limit explicit rather than relying on defaults.
*Follow-up: You choose to drop messages instead. What does the client need to do to stay correct?*

**Q3. How would you design scale-out beyond what a Redis backplane can handle?**
**A:** The backplane's problem is undifferentiated fan-out — every message to every instance. The escalations are: partition connections so a message only needs to reach the instances holding relevant clients, typically by sharding on the group or tenant and routing publishes accordingly; move to a managed service that handles connection management and routing outside your instances; or restructure the messaging so clients subscribe to fewer, coarser channels. I would first check whether the message volume is genuinely necessary, since a very common finding is per-entity messages where a coalesced periodic update would satisfy the requirement at a fraction of the cost.
*Follow-up: How would you shard connections by tenant without breaking cross-tenant broadcasts?*

**Q4. What happens to real-time connections during a rolling deploy, and how do you manage it?**
**A:** Every connection on a draining instance is closed, and all those clients reconnect simultaneously — a thundering herd that lands on the remaining or new instances at once, and can exceed their capacity while they are also cold. The mitigations are staggering the rollout so the herd is split, ensuring the client's reconnect policy uses backoff with jitter rather than immediate retry, draining connections with a grace period rather than killing them, and having enough headroom to absorb a reconnect wave. I would load-test the reconnect scenario specifically, because it is the highest-load moment the system routinely experiences.
*Follow-up: Your reconnect storm is causing the new instances to fail their readiness checks. What's happening and what do you change?*

**Q5. When would you choose SSE over SignalR?**
**A:** When the communication is genuinely one-way server-to-client, the clients are browsers or simple HTTP consumers, and you value simplicity and infrastructure compatibility over an RPC model. SSE is plain HTTP, so proxies, CDNs and corporate networks handle it without special configuration; browsers reconnect automatically and resume using a last-event-ID, which gives a gap-recovery mechanism SignalR does not provide out of the box. You give up client-to-server messaging on the same channel, but a normal HTTP POST covers that perfectly well for most applications.
*Follow-up: How does the last-event-ID mechanism work, and what does the server need to support it?*

**Q6. How do you handle authentication and authorisation on a long-lived connection?**
**A:** Authenticate at connection time, then decide explicitly what happens as the credential ages. Options are: short connection lifetimes so re-authentication is natural; a client-driven re-authentication message that supplies a fresh token; or periodic server-side re-validation that disconnects when authorisation is revoked. Authorisation also needs to be per-invocation rather than only at connect, because a user's permissions can change while connected — a hub method that was allowed at connect time may not be allowed now. Relying solely on connect-time authorisation is the common and consequential mistake.
*Follow-up: A user's access to a group is revoked mid-session. What has to happen for them to stop receiving messages?*

**Q7. How do you decide between JSON and MessagePack for the hub protocol?**
**A:** MessagePack produces substantially smaller payloads and is faster to serialise, which matters when message rate or bandwidth is the constraint — mobile clients, high-frequency updates, large fan-out where bytes multiply by connection count. JSON is human-readable, trivially debuggable, and universally supported, which matters more than people expect during an incident. I would default to JSON and switch to MessagePack when measurement shows payload size or serialisation cost is material, and I would keep the ability to switch back, because losing readability on a real-time channel makes production diagnosis considerably harder.
*Follow-up: You switch to MessagePack and one client type starts failing. What's the likely cause?*

**Q8. How should hub methods be written?**
**A:** Short, non-blocking, and free of long-running work. A hub invocation runs on the connection's processing path, so anything slow delays that connection's other messages and occupies a pool thread; a hub method that calls a database, an external API or a queue synchronously is the usual cause of degraded real-time responsiveness under load. The correct shape is to validate, enqueue and return, with the actual work done by a background consumer that pushes the result back via `IHubContext`. Hub methods should be treated like an event handler with a strict latency budget.
*Follow-up: A hub method must return a result to the caller after work that takes two seconds. How do you structure that?*

**Q9. How do you make real-time features testable?**
**A:** Separate the decision from the delivery: put the logic that decides what to send behind an abstraction, so it can be unit-tested without any connection, and test the hub itself thinly. For end-to-end behaviour, `WebApplicationFactory` with a real SignalR client works and is worth having for the connection lifecycle paths — connect, reconnect, group restoration, authorisation — because those are exactly where the bugs are and they cannot be unit-tested. I would specifically test the reconnect path, since it is the one that fails silently in production and the one nobody writes a test for.
*Follow-up: How would you deterministically simulate a reconnect in a test?*

**Q10. What do you monitor for a real-time service?**
**A:** Concurrent connections (the capacity metric), connection duration distribution, reconnect rate, messages sent per second and per connection, backplane publish latency and volume, and buffer-limit hits or forced disconnects. Reconnect rate is the leading indicator most often missing: a rise means clients are churning, which precedes the user-visible "I stopped getting updates" reports and correlates with deploys, network issues or a bug. I would also track messages that could not be delivered, since the transport's silence about undelivered messages is exactly what makes those failures invisible.
*Follow-up: Reconnect rate doubles with no deploy and no error-rate change. Where do you look?*

---

## 4. Expert / Architect (10 Q&A)

**Q1. How do you decide whether a feature genuinely needs real-time delivery?**
**A:** By interrogating the latency requirement, because "real time" is almost always shorthand for "faster than the current refresh" rather than a sub-second need. If the requirement is satisfied by a five-second poll, polling is dramatically simpler operationally — stateless, load-balanced, no backplane, no reconnect storms, no connection capacity limits — and that simplicity is worth a great deal over the system's life. Real-time earns its cost when the interaction is genuinely conversational (collaborative editing, chat, live trading) or when polling frequency would exceed the push cost. I would put those numbers side by side rather than debating the technology.
*Follow-up: The product owner insists on "instant". How do you turn that into a decision?*

**Q2. Design the architecture for a service holding a million concurrent connections.**
**A:** Separate connection handling from business logic: a connection tier whose only job is holding connections and routing messages, and a stateless application tier that publishes to it — because scaling connection count and scaling request processing are different problems with different constraints. Route messages so a publish reaches only the instances holding relevant connections, which means partitioning by tenant or topic rather than broadcasting to all. Use a managed connection service if one fits, since operating a connection tier at that scale is a substantial commitment. And plan capacity in connections and file descriptors, with the reconnect storm as the sizing case rather than steady state.
*Follow-up: What's the first thing that breaks as you scale that design, and how do you detect it early?*

**Q3. How do you make real-time delivery reliable enough to build a business process on?**
**A:** You do not make the transport reliable; you make the *system* reliable and use the transport as an accelerator. The pattern is that state changes are persisted and separately queryable, the real-time message carries a hint or a version rather than being the only copy, and the client reconciles on connect and periodically thereafter — which makes any lost message self-healing. Where ordering matters, a monotonic sequence number lets the client detect a gap and re-fetch. That design tolerates the transport's complete absence, which is exactly the property you want, since the transport *will* be absent for some clients at some point.
*Follow-up: How would you design the client-side reconciliation so it isn't expensive on every reconnect?*

**Q4. What are the operational risks of adopting SignalR across an estate?**
**A:** You are introducing stateful connections into an infrastructure built for stateless requests, and the implications reach further than the feature: load balancers need affinity or a backplane, deployments become disruptive events, autoscaling behaves differently because connections do not drain when you remove capacity, and capacity planning uses a metric nobody is currently watching. Also, a backplane is now a shared critical dependency whose failure degrades every real-time feature at once. I would treat the first adoption as a platform decision with those consequences made explicit, rather than as a feature-level library choice.
*Follow-up: How would you pilot it so those consequences surface before broad adoption?*

**Q5. How do you handle multi-region real-time?**
**A:** Connect clients to their nearest region for latency, and then decide deliberately how messages cross regions — because a naive global backplane means every message traverses every region and latency plus cost both scale badly. The usual shape is regional backplanes with cross-region forwarding only for messages whose audience genuinely spans regions, which requires knowing where a message's recipients are connected. Where the data is naturally partitioned by region, most traffic stays local and only a small share crosses. I would also be explicit that cross-region delivery has higher and more variable latency, so any ordering or timing assumption must tolerate it.
*Follow-up: A collaborative editing feature has users in three regions on one document. How do you handle it?*

**Q6. How does real-time interact with your authentication and session model?**
**A:** It stresses it, because the connection outlives the credential. A short-lived access token that would normally be refreshed per request is now attached to a connection open for hours, so you need an explicit re-authentication mechanism or a policy of bounded connection lifetime. Revocation is harder still: a user whose access is revoked keeps their connection and its group memberships until something acts, so revocation must actively disconnect or re-authorise rather than relying on the next request failing. In a regulated context this is a control question — "access was revoked at 14:00" must mean the connection stopped too.
*Follow-up: How would you implement immediate revocation across a fleet with a backplane?*

**Q7. How do you evaluate a managed real-time service against self-hosting?**
**A:** Managed offloads the connection tier entirely — the connections terminate there, so your instances scale on request load rather than connection count, deployments no longer disconnect everyone, and the reconnect-storm problem largely disappears. That removes the operational burden that makes real-time expensive. Against that: cost that scales with connections and messages, a dependency on the provider's availability and regional coverage, and limits on message size and rate you must design within. For most organisations the managed option is right precisely because the self-hosted failure modes are unfamiliar ones that show up during incidents.
*Follow-up: Cost modelling shows the managed service is three times self-hosting. How do you frame that decision?*

**Q8. How would you migrate an existing polling-based feature to real-time without regression?**
**A:** Run both in parallel: keep polling as the correctness baseline at a reduced frequency while adding push, so a lost or missed message is corrected within one poll interval and the feature cannot regress. Instrument which mechanism actually delivered each update, then reduce polling frequency as confidence grows — and keep a low-frequency reconciliation poll permanently, because it is what makes the design tolerant of the transport's unreliability. That approach also gives a trivial rollback: disable push, restore the polling interval. I would resist a straight cutover, since the failure modes are silent.
*Follow-up: How long would you run both, and what evidence would let you stop?*

**Q9. What's your position on real-time as a public API surface?**
**A:** Cautious. A real-time API creates a long-term commitment to a protocol, a connection model and a message contract, and it is much harder to version than request/response — you cannot easily run two protocol versions over one connection, and clients that reconnect must be compatible immediately. SignalR specifically ties consumers to its client libraries and protocol. For a public surface I would prefer SSE or plain WebSockets with a documented, versioned message schema, treat message shapes with the same compatibility discipline as an event schema, and provide a polling alternative so consumers are not forced into a persistent connection.
*Follow-up: You need to make a breaking change to the message schema. How do you sequence it?*

**Q10. What separates an excellent answer from an adequate one on real-time design?**
**A:** An adequate answer picks SignalR and mentions a Redis backplane. An excellent one first questions whether push is needed at all against a polling baseline; treats the connection as *stateful infrastructure* and reasons about load balancing, deployment, capacity and reconnect storms as consequences; designs for the transport being unreliable by making real-time an accelerator over a reconcilable authoritative state; handles connection identity, group restoration and credential expiry explicitly; and names concurrent connections as the capacity metric rather than throughput. The distinguishing quality is recognising that the hard parts of real-time are operational and architectural, not the messaging API.
*Follow-up: Given that, what would you ask before agreeing to add a real-time feature to an existing stateless service?*
