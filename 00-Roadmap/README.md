# Principal / Staff / Architect Engineering Mastery Program
### For a 14+ YOE C#/.NET/SQL Server/AWS/Azure/Microservices Engineer

This is the master index for the full course. Each domain gets its own folder with topic-wise `.md` files so content stays clean, searchable, and revisable. Every topic file follows the fixed 18-section template (Fundamentals → Revision) defined in our working agreement.

**Rule:** We move one topic at a time. Type **"Next"** to proceed to the next topic. Type **"Interview Mode"**, **"Mock Interview"**, **"Architecture Review"**, or **"Code Review"** any time to switch modes on the current topic.

---

## How files are organized

```
E:\Interview Questions\
 ├─ 00-Roadmap\README.md                 ← this file (master index, updated as we go)
 ├─ 01-CSharp\
 │   ├─ 01-CLR-JIT-GC-Memory-Management.md   ← Module 1 (current)
 │   ├─ 02-...
 ├─ 02-DotNet-AspNetCore\
 ├─ 03-REST-APIs\
 ├─ 04-SQL-Server\
 ├─ 05-PostgreSQL\
 ├─ 06-MongoDB\
 ├─ 07-Redis\
 ├─ 08-DynamoDB\
 ├─ 09-OOP\
 ├─ 10-SOLID\
 ├─ 11-Design-Patterns\
 ├─ 12-Data-Structures\
 ├─ 13-Algorithms\
 ├─ 14-System-Design\
 ├─ 15-Low-Level-Design\
 ├─ 16-Distributed-Systems\
 ├─ 17-Microservices\
 ├─ 18-Event-Driven-Architecture\
 ├─ 19-Kafka\
 ├─ 20-RabbitMQ\
 ├─ 21-AWS\
 ├─ 22-Azure\
 ├─ 23-Kubernetes\
 ├─ 24-Docker\
 ├─ 25-DevOps\
 ├─ 26-CICD\
 ├─ 27-Observability\
 ├─ 28-Security\
 ├─ 29-Performance-Engineering\
 ├─ 30-Architecture-Patterns\
 ├─ 31-Domain-Driven-Design\
 ├─ 32-Clean-Architecture\
 ├─ 33-Hexagonal-Architecture\
 ├─ 34-CQRS\
 ├─ 35-Event-Sourcing\
 ├─ 36-Saga\
 ├─ 37-Outbox\
 ├─ 38-API-Gateway\
 ├─ 39-Service-Mesh\
 ├─ 40-IAM\
 ├─ 41-OAuth2-OIDC-JWT-PKCE\
 ├─ 42-Angular\
 ├─ 43-React\
 ├─ 44-AI-Systems\
 ├─ 45-RAG\
 ├─ 46-MCP\
 ├─ 47-AI-Agents\
 ├─ 48-Vector-Databases\
 ├─ 49-LLM-Integration\
 ├─ 50-Prompt-Engineering\
 ├─ 51-Technical-Leadership\
 ├─ 52-Staff-Plus-Engineering\
 ├─ 53-Principal-Engineering\
 ├─ 54-Software-Architecture\
 └─ 55-Engineering-Management\
```

Each folder will fill up with one `.md` file per sub-topic as we cover it (e.g., `01-CSharp` will eventually contain CLR/GC, async/await internals, delegates/events, generics & variance, spans/memory, records/pattern matching, source generators, etc.).

---

## Estimated Study Plan (self-paced, adjust freely)

Assuming ~1.5–2 hrs/topic including interview Qs and coding exercises:

| Phase | Domains | Topics (approx.) | Est. Hours |
|---|---|---|---|
| **Phase 1 — Language & Core** | C#, .NET/ASP.NET Core, OOP, SOLID, Design Patterns, Data Structures, Algorithms | ~35 | 60–70 |
| **Phase 2 — Data Layer** | SQL Server, PostgreSQL, MongoDB, Redis, DynamoDB | ~20 | 35–40 |
| **Phase 3 — Architecture & Distributed Systems** | System Design, LLD, Distributed Systems, Microservices, EDA, Kafka, RabbitMQ, CQRS, Event Sourcing, Saga, Outbox, API Gateway, Service Mesh, DDD, Clean/Hexagonal Architecture | ~30 | 55–65 |
| **Phase 4 — Cloud & Platform** | AWS, Azure, Kubernetes, Docker, DevOps, CI/CD, Observability | ~20 | 35–40 |
| **Phase 5 — Security & Identity** | Security, IAM, OAuth2/OIDC/JWT/PKCE | ~8 | 15 |
| **Phase 6 — Performance** | Performance Engineering, Architecture Patterns | ~10 | 20 |
| **Phase 7 — Frontend Literacy** | Angular, React | ~8 | 15 |
| **Phase 8 — AI Engineering** | AI Systems, RAG, MCP, AI Agents, Vector DBs, LLM Integration, Prompt Engineering | ~12 | 20–25 |
| **Phase 9 — Leadership & Career** | Technical Leadership, Staff+/Principal Engineering, Software Architecture, Engineering Management | ~10 | 20 |

**Total:** ~180–210 hours of deep, interview-grade study. Given your 14 YOE, many "Fundamentals" sections will move fast — the value is concentrated in Deep Dive, Production Examples, Anti-patterns, Performance, and the Expert-tier interview questions.

## Prerequisites
None formally — you already have the professional baseline (C#, .NET, SQL Server, AWS, Azure, Microservices). This course assumes that baseline and pushes straight into Staff/Principal-depth material and interview calibration.

## Milestones
- **M1 (Phase 1 complete):** Can explain CLR/GC internals, async internals, and design pattern trade-offs without notes; solve medium/hard DS/Algo problems in <25 min.
- **M2 (Phase 2 complete):** Can justify SQL vs NoSQL choice per workload; design indexing/sharding/caching strategy from first principles.
- **M3 (Phase 3 complete):** Can run a 45-minute system design interview end-to-end (requirements → HLD → LLD → failure modes) unaided.
- **M4 (Phase 4 complete):** Can design a full CI/CD + K8s + observability stack for a multi-service system and defend cost/complexity trade-offs.
- **M5 (Phase 5–7 complete):** Can pass a security/IAM deep-dive and hold a frontend architecture conversation credibly.
- **M6 (Phase 8 complete):** Can design a production RAG/agentic system with vector DB, guardrails, and cost controls.
- **M7 (Phase 9 complete):** Ready for Principal Engineer / Staff Engineer / Architect / EM loop — behavioral, architecture review, and mock interview all pass at "strong hire" bar.

---

## Progress Log
- ✅ **Module 1**: C# → CLR, JIT, Garbage Collector, and Memory Management — [`01-CSharp/01-CLR-JIT-GC-Memory-Management.md`](../01-CSharp/01-CLR-JIT-GC-Memory-Management.md)
- ✅ **Module 2**: C# → Async/Await, Task, and Threading Internals — [`01-CSharp/02-Async-Await-Internals.md`](../01-CSharp/02-Async-Await-Internals.md)
- ✅ **Module 3**: C# → `Span<T>`, `Memory<T>` & Low-Allocation Code Patterns — [`01-CSharp/03-Span-Memory-Low-Allocation.md`](../01-CSharp/03-Span-Memory-Low-Allocation.md)
- ✅ **Module 4**: C# → Delegates, Events, Closures & Multicast Internals — [`01-CSharp/04-Delegates-Events-Closures.md`](../01-CSharp/04-Delegates-Events-Closures.md)
- ✅ **Module 5**: C# → LINQ Internals (`IEnumerable` vs `IQueryable`, Deferred Execution, Iterator State Machines) — [`01-CSharp/05-LINQ-Internals.md`](../01-CSharp/05-LINQ-Internals.md)
- ✅ **Module 6**: C# → Generics, Variance & Generic Constraints — [`01-CSharp/06-Generics-Variance.md`](../01-CSharp/06-Generics-Variance.md)
- ✅ **Module 7**: C# → Records, Pattern Matching & Immutability — [`01-CSharp/07-Records-Pattern-Matching-Immutability.md`](../01-CSharp/07-Records-Pattern-Matching-Immutability.md)
- ✅ **Module 8**: C# → Exception Handling, SEH Internals & Custom Exception Design — [`01-CSharp/08-Exception-Handling-Custom-Exceptions.md`](../01-CSharp/08-Exception-Handling-Custom-Exceptions.md) — **`01-CSharp` domain complete (Modules 1–8)**
- ✅ **Module 9**: .NET/ASP.NET Core → Middleware Pipeline & Request Processing Internals — [`02-DotNet-AspNetCore/01-Middleware-Pipeline-Request-Internals.md`](../02-DotNet-AspNetCore/01-Middleware-Pipeline-Request-Internals.md)
- ✅ **Module 10**: .NET/ASP.NET Core → Dependency Injection Container Internals — [`02-DotNet-AspNetCore/02-DI-Container-Internals.md`](../02-DotNet-AspNetCore/02-DI-Container-Internals.md)
- ✅ **Module 11**: .NET/ASP.NET Core → Minimal APIs vs Controllers, MVC Filters & Model Binding Internals — [`02-DotNet-AspNetCore/03-MinimalAPIs-vs-Controllers-ModelBinding.md`](../02-DotNet-AspNetCore/03-MinimalAPIs-vs-Controllers-ModelBinding.md)
- ✅ **Module 12**: .NET/ASP.NET Core → Authentication & Authorization Deep Dive — [`02-DotNet-AspNetCore/04-Authentication-Authorization-Deep-Dive.md`](../02-DotNet-AspNetCore/04-Authentication-Authorization-Deep-Dive.md)
- ✅ **Module 13**: .NET/ASP.NET Core → Configuration & Options Pattern Internals — [`02-DotNet-AspNetCore/05-Configuration-Options-Pattern.md`](../02-DotNet-AspNetCore/05-Configuration-Options-Pattern.md)
- ✅ **Module 14**: .NET/ASP.NET Core → Health Checks & Observability Integration — [`02-DotNet-AspNetCore/06-HealthChecks-Observability.md`](../02-DotNet-AspNetCore/06-HealthChecks-Observability.md) — **`02-DotNet-AspNetCore` core complete (Modules 9–14)**
- ✅ **Module 15**: REST APIs → Design Fundamentals, HTTP Semantics & Versioning — [`03-REST-APIs/01-REST-Design-Fundamentals.md`](../03-REST-APIs/01-REST-Design-Fundamentals.md)
- ✅ **Module 16**: REST APIs → API Security & Rate Limiting Patterns — [`03-REST-APIs/02-API-Security-Rate-Limiting.md`](../03-REST-APIs/02-API-Security-Rate-Limiting.md)
- ✅ **Module 17**: REST APIs → API Documentation, Contract Testing & OpenAPI — [`03-REST-APIs/03-API-Documentation-Contract-Testing.md`](../03-REST-APIs/03-API-Documentation-Contract-Testing.md) — **`03-REST-APIs` domain complete (Modules 15–17)**
- ✅ **Module 18**: SQL Server → Indexing & Query Execution Plans — [`04-SQL-Server/01-Indexing-Query-Execution-Plans.md`](../04-SQL-Server/01-Indexing-Query-Execution-Plans.md)
- ✅ **Module 19**: SQL Server → Transactions, Isolation Levels & Locking — [`04-SQL-Server/02-Transactions-Isolation-Locking.md`](../04-SQL-Server/02-Transactions-Isolation-Locking.md)
- ✅ **Module 20**: SQL Server → Query Optimization Patterns & Anti-patterns — [`04-SQL-Server/03-Query-Optimization-Patterns.md`](../04-SQL-Server/03-Query-Optimization-Patterns.md) — **`04-SQL-Server` domain complete (Modules 18–20)**
- ✅ **Module 21**: PostgreSQL → Fundamentals, MVCC & Comparison with SQL Server — [`05-PostgreSQL/01-PostgreSQL-Fundamentals-vs-SQLServer.md`](../05-PostgreSQL/01-PostgreSQL-Fundamentals-vs-SQLServer.md)
- ✅ **Module 22**: PostgreSQL → Partitioning, Replication & Logical Decoding — [`05-PostgreSQL/02-Partitioning-Replication-Logical-Decoding.md`](../05-PostgreSQL/02-Partitioning-Replication-Logical-Decoding.md) — **`05-PostgreSQL` domain complete (Modules 21–22)**
- ✅ **Module 23**: MongoDB → Data Modeling, Aggregation & Sharding — [`06-MongoDB/01-Data-Modeling-Query-Patterns.md`](../06-MongoDB/01-Data-Modeling-Query-Patterns.md)
- ✅ **Module 24**: MongoDB → Consistency, Replica Sets & Multi-Document Transactions — [`06-MongoDB/02-Consistency-ReplicaSets-Transactions.md`](../06-MongoDB/02-Consistency-ReplicaSets-Transactions.md) — **`06-MongoDB` domain complete (Modules 23–24)**
- ✅ **Module 25**: Redis → Data Structures, Caching Patterns & Persistence — [`07-Redis/01-Data-Structures-Caching-Patterns.md`](../07-Redis/01-Data-Structures-Caching-Patterns.md)
- ✅ **Module 26**: Redis → Pub/Sub, Streams & High Availability — [`07-Redis/02-PubSub-Streams-HighAvailability.md`](../07-Redis/02-PubSub-Streams-HighAvailability.md) — **`07-Redis` domain complete (Modules 25–26)**
- ✅ **Module 27**: DynamoDB → Data Modeling, Partition Keys & Single-Table Design — [`08-DynamoDB/01-Data-Modeling-Partition-Key-Design.md`](../08-DynamoDB/01-Data-Modeling-Partition-Key-Design.md)
