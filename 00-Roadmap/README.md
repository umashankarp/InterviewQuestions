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
