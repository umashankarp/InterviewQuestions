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
- ✅ **Module 28**: DynamoDB → Consistency Models, Capacity Planning & DAX — [`08-DynamoDB/02-Consistency-Models-Capacity-Planning.md`](../08-DynamoDB/02-Consistency-Models-Capacity-Planning.md) — **`08-DynamoDB` domain complete (Modules 27–28); full data-layer arc complete (Modules 18–28: SQL Server, PostgreSQL, MongoDB, Redis, DynamoDB)**
- ✅ **Module 29**: OOP → Encapsulation, Inheritance, Polymorphism & Composition — [`09-OOP/01-OOP-Fundamentals-Advanced.md`](../09-OOP/01-OOP-Fundamentals-Advanced.md) — **`09-OOP` domain complete**
- ✅ **Module 30**: SOLID → SOLID Principles Deep Dive — [`10-SOLID/01-SOLID-Principles-Deep-Dive.md`](../10-SOLID/01-SOLID-Principles-Deep-Dive.md) — **`10-SOLID` domain complete**
- ✅ **Module 31**: Design Patterns → Creational & Structural Patterns — [`11-Design-Patterns/01-Creational-Structural-Patterns.md`](../11-Design-Patterns/01-Creational-Structural-Patterns.md)
- ✅ **Module 32**: Design Patterns → Behavioral Patterns — [`11-Design-Patterns/02-Behavioral-Patterns.md`](../11-Design-Patterns/02-Behavioral-Patterns.md) — **`11-Design-Patterns` domain complete (Modules 31–32)**
- ✅ **Module 33**: Data Structures → Arrays, Linked Lists, Trees, Heaps & Hash Tables — [`12-Data-Structures/01-Core-Data-Structures.md`](../12-Data-Structures/01-Core-Data-Structures.md)
- ✅ **Module 34**: Data Structures → Graphs, Tries & Union-Find — [`12-Data-Structures/02-Graphs-Tries-Union-Find.md`](../12-Data-Structures/02-Graphs-Tries-Union-Find.md) — **`12-Data-Structures` domain complete (Modules 33–34)**
- ✅ **Module 35**: Algorithms → Sorting, Searching & Complexity Analysis — [`13-Algorithms/01-Sorting-Searching-Complexity.md`](../13-Algorithms/01-Sorting-Searching-Complexity.md)
- ✅ **Module 36**: Algorithms → Dynamic Programming & Greedy Algorithms — [`13-Algorithms/02-Dynamic-Programming-Greedy.md`](../13-Algorithms/02-Dynamic-Programming-Greedy.md) — **`13-Algorithms` domain complete (Modules 35–36); Phase 1 CS-fundamentals arc complete (Modules 29–36: OOP, SOLID, Design Patterns, Data Structures, Algorithms)**
- ✅ **Module 37**: System Design → Fundamentals, Scalability Building Blocks & Load Balancing — [`14-System-Design/01-System-Design-Fundamentals.md`](../14-System-Design/01-System-Design-Fundamentals.md) (extra-depth Performance/Security/Scalability sections per user request — this domain is treated as high-priority)
- ✅ **Module 38**: System Design → Designing a News Feed / Timeline System — [`14-System-Design/02-Designing-News-Feed-System.md`](../14-System-Design/02-Designing-News-Feed-System.md)
- ✅ **Module 39**: System Design → Designing a Chat/Messaging System — [`14-System-Design/03-Designing-Chat-Messaging-System.md`](../14-System-Design/03-Designing-Chat-Messaging-System.md)
- ✅ **Module 40**: System Design → Designing a Distributed Rate Limiter & API Gateway — [`14-System-Design/04-Designing-Rate-Limiter-API-Gateway.md`](../14-System-Design/04-Designing-Rate-Limiter-API-Gateway.md)
- ✅ **Module 41**: System Design → Designing YouTube / a Video Streaming Platform — [`14-System-Design/05-Designing-YouTube-Video-Streaming.md`](../14-System-Design/05-Designing-YouTube-Video-Streaming.md)
- ✅ **Module 42**: System Design → Designing Instagram (Photo/Video Sharing, Stories & Feed) — [`14-System-Design/06-Designing-Instagram.md`](../14-System-Design/06-Designing-Instagram.md)
- ✅ **Module 43**: System Design → Designing Amazon / an E-commerce Platform — [`14-System-Design/07-Designing-Amazon-Ecommerce.md`](../14-System-Design/07-Designing-Amazon-Ecommerce.md)
- ✅ **Module 44**: System Design → Designing WhatsApp — Multi-Device Sync & End-to-End Encryption — [`14-System-Design/08-Designing-WhatsApp-E2E-MultiDevice.md`](../14-System-Design/08-Designing-WhatsApp-E2E-MultiDevice.md) — **`14-System-Design` domain complete (Modules 37–44): 8 fully-worked case studies (Fundamentals, Twitter-style Feed, Chat, Rate Limiter/Gateway, YouTube, Instagram, Amazon, WhatsApp E2E)**
- ✅ **Module 45**: Low-Level Design → OOD Interviews: Parking Lot & Elevator System — [`15-Low-Level-Design/01-LLD-Fundamentals-Parking-Elevator.md`](../15-Low-Level-Design/01-LLD-Fundamentals-Parking-Elevator.md)
- ✅ **Module 46**: Low-Level Design → Library Management System & Chess Game Engine — [`15-Low-Level-Design/02-LLD-Library-Chess-Game.md`](../15-Low-Level-Design/02-LLD-Library-Chess-Game.md) — **`15-Low-Level-Design` domain complete (Modules 45–46)**
- ✅ **Module 47**: Distributed Systems → Consensus, Consistency Models & Distributed Transactions — [`16-Distributed-Systems/01-Consensus-Consistency-Distributed-Transactions.md`](../16-Distributed-Systems/01-Consensus-Consistency-Distributed-Transactions.md)
- ✅ **Module 48**: Distributed Systems → Failure Detection, Idempotency & the Outbox Pattern — [`16-Distributed-Systems/02-Failure-Detection-Idempotency-Outbox.md`](../16-Distributed-Systems/02-Failure-Detection-Idempotency-Outbox.md) — **`16-Distributed-Systems` domain complete (Modules 47–48)**
- ✅ **Module 49**: Microservices → Decomposition, Communication Patterns & the Strangler Fig Migration — [`17-Microservices/01-Decomposition-Communication-Strangler-Fig.md`](../17-Microservices/01-Decomposition-Communication-Strangler-Fig.md)
- ✅ **Module 50**: Microservices → Resilience Patterns, Distributed Observability & the Sidecar Model — [`17-Microservices/02-Resilience-Observability-Sidecar-Patterns.md`](../17-Microservices/02-Resilience-Observability-Sidecar-Patterns.md)
- ✅ **Module 51**: Microservices → Versioning & Schema Evolution, Testing Strategies, Deployment Patterns & Team Topologies — [`17-Microservices/03-Versioning-Testing-Deployment-TeamTopologies.md`](../17-Microservices/03-Versioning-Testing-Deployment-TeamTopologies.md) — **`17-Microservices` domain complete (Modules 49–51): decomposition/communication, resilience/observability, versioning/testing/deployment/team-topology — full Principal-Engineer-level coverage per explicit user request**
- ✅ **Module 52**: Event-Driven Architecture → Event Notification vs Event-Carried State Transfer, Choreography vs Orchestration & Pub/Sub Foundations — [`18-Event-Driven-Architecture/01-EDA-Fundamentals-Choreography-vs-Orchestration.md`](../18-Event-Driven-Architecture/01-EDA-Fundamentals-Choreography-vs-Orchestration.md)
- ✅ **Module 53**: Event-Driven Architecture → Schema Evolution, Ordering & Partitioning, Delivery Semantics & Dead Letter Queues — [`18-Event-Driven-Architecture/02-Schema-Evolution-Ordering-DeliverySemantics-DLQ.md`](../18-Event-Driven-Architecture/02-Schema-Evolution-Ordering-DeliverySemantics-DLQ.md) — **`18-Event-Driven-Architecture` core conceptual arc complete (Modules 52–53): full Principal-Engineer-level coverage per explicit user request, ahead of the dedicated `19-Kafka`/`20-RabbitMQ` broker-specific modules**
- ✅ **Module 54**: Kafka → Architecture, Partitioning, Replication & Consumer Group Internals — [`19-Kafka/01-Architecture-Partitioning-Replication-ConsumerGroups.md`](../19-Kafka/01-Architecture-Partitioning-Replication-ConsumerGroups.md)
- ✅ **Module 55**: Kafka → Exactly-Once Semantics, Kafka Streams/ksqlDB & Log Compaction — [`19-Kafka/02-ExactlyOnce-Streams-LogCompaction.md`](../19-Kafka/02-ExactlyOnce-Streams-LogCompaction.md) — **`19-Kafka` domain complete (Modules 54–55)**
- ✅ **Module 56**: RabbitMQ → Exchanges, Queues, Routing & Message Acknowledgment Patterns — [`20-RabbitMQ/01-Exchanges-Queues-Routing-Acknowledgment.md`](../20-RabbitMQ/01-Exchanges-Queues-Routing-Acknowledgment.md) — **`20-RabbitMQ` domain complete; full Messaging/EDA arc (Modules 49–56: Microservices, Event-Driven Architecture, Kafka, RabbitMQ) complete at Principal-Engineer depth per explicit user request**
- ✅ **Module 57**: AWS → Compute & Networking Fundamentals — EC2, VPC, Load Balancing & Auto Scaling — [`21-AWS/01-Compute-Networking-VPC-LoadBalancing-AutoScaling.md`](../21-AWS/01-Compute-Networking-VPC-LoadBalancing-AutoScaling.md) (AWS is treated as extra-depth/high-priority per explicit user request, same tier as System Design/Microservices/EDA; confirmed 8-module scope, Modules 57–64: Compute & Networking, IAM & Security, Storage, Databases, Serverless, Messaging/EDA-on-AWS, Containers/Microservices-on-AWS, Observability/Cost/Well-Architected)
- ✅ **Module 58**: AWS → IAM & Security — Roles, Policies, KMS, Secrets Manager & Cross-Account Access — [`21-AWS/02-IAM-Security-KMS-SecretsManager.md`](../21-AWS/02-IAM-Security-KMS-SecretsManager.md)
- ✅ **Module 59**: AWS → Storage — S3 Storage Classes & Consistency, EBS, EFS & Durability Trade-offs — [`21-AWS/03-Storage-S3-EBS-EFS.md`](../21-AWS/03-Storage-S3-EBS-EFS.md)
- ✅ **Module 60**: AWS → Databases — RDS Multi-AZ & Read Replicas, Aurora Internals & DynamoDB Integration — [`21-AWS/04-Databases-RDS-Aurora-DynamoDB.md`](../21-AWS/04-Databases-RDS-Aurora-DynamoDB.md)
- ✅ **Module 61**: AWS → Serverless — Lambda Cold Starts & Concurrency, API Gateway & Step Functions — [`21-AWS/05-Serverless-Lambda-APIGateway-StepFunctions.md`](../21-AWS/05-Serverless-Lambda-APIGateway-StepFunctions.md)
- ✅ **Module 62**: AWS → Messaging & Event-Driven Architecture — SQS, SNS, EventBridge & Kinesis — [`21-AWS/06-Messaging-SQS-SNS-EventBridge-Kinesis.md`](../21-AWS/06-Messaging-SQS-SNS-EventBridge-Kinesis.md) (explicitly maps back to the EDA/Kafka/RabbitMQ modules 52–56 and gives the AWS-native-vs-Kafka decision framework)
- ✅ **Module 63**: AWS → Containers & Microservices — ECS, EKS, Fargate, App Mesh & Service Discovery — [`21-AWS/07-Containers-Microservices-ECS-EKS-Fargate.md`](../21-AWS/07-Containers-Microservices-ECS-EKS-Fargate.md) (explicitly maps back to the Microservices modules 49–51 — App Mesh as the concrete sidecar-pattern implementation)
- ✅ **Module 64**: AWS → Observability, Cost & the Well-Architected Framework — CloudWatch, X-Ray & Multi-Region DR — [`21-AWS/08-Observability-Cost-WellArchitectedFramework.md`](../21-AWS/08-Observability-Cost-WellArchitectedFramework.md) — **`21-AWS` domain complete (Modules 57–64): Compute/Networking, IAM/Security, Storage, Databases, Serverless, Messaging/EDA, Containers/Microservices, Observability/Cost/Well-Architected — 8 modules at Principal-Engineer depth, each explicitly tied back to the Microservices (49–51) and EDA (52–56) arcs, per explicit user request**
- ✅ **Module 65**: Azure → Compute & Networking Fundamentals — VMs, VNet, Load Balancer/App Gateway & VM Scale Sets — [`22-Azure/01-Compute-Networking-VNet-LoadBalancer-VMSS.md`](../22-Azure/01-Compute-Networking-VNet-LoadBalancer-VMSS.md) (Azure mirrors AWS's 8-module extra-depth scope, Modules 65–72; this module is explicitly comparative against Module 57, flagging AWS-vs-Azure divergences rather than re-deriving fundamentals)
- ✅ **Module 66**: Azure → IAM & Security — Entra ID, RBAC, Key Vault & Managed Identities — [`22-Azure/02-IAM-Security-EntraID-RBAC-KeyVault.md`](../22-Azure/02-IAM-Security-EntraID-RBAC-KeyVault.md) (comparative against Module 58 — flags RBAC's hierarchical scope inheritance and Key Vault's combined KMS+Secrets-Manager model as the key divergences)
- ✅ **Module 67**: Azure → Storage — Blob Storage, Managed Disks, Azure Files & Redundancy Tiers (LRS/ZRS/GRS) — [`22-Azure/03-Storage-Blob-ManagedDisks-Files-Redundancy.md`](../22-Azure/03-Storage-Blob-ManagedDisks-Files-Redundancy.md) (comparative against Module 59 — flags Azure's explicit, chosen redundancy tiers vs. S3's automatic Region-spanning durability as the key divergence; third recurrence of this domain's false-familiarity finding, now bundled into a single cross-module governance check)
- ✅ **Module 68**: Azure → Databases — Azure SQL Database, Managed Instance & Cosmos DB Integration — [`22-Azure/04-Databases-AzureSQL-CosmosDB.md`](../22-Azure/04-Databases-AzureSQL-CosmosDB.md) (comparative against Module 60 — flags Cosmos DB's five-level tunable consistency spectrum, and Azure SQL Business Critical's readable synchronous secondaries, as the key divergences)
- ✅ **Module 69**: Azure → Serverless — Azure Functions, Durable Functions, API Management & Logic Apps — [`22-Azure/05-Serverless-Functions-APIManagement-LogicApps.md`](../22-Azure/05-Serverless-Functions-APIManagement-LogicApps.md) (comparative against Module 61 — flags Durable Functions' code-based, replay-driven orchestration and its mandatory determinism requirement as the sharpest divergence in the domain so far, since it has no Step Functions equivalent and orchestrator code looks deceptively like ordinary code)
- ✅ **Module 70**: Azure → Messaging & Event-Driven Architecture — Service Bus, Event Grid & Event Hubs — [`22-Azure/06-Messaging-ServiceBus-EventGrid-EventHubs.md`](../22-Azure/06-Messaging-ServiceBus-EventGrid-EventHubs.md) (comparative against Module 62 — flags Event Grid's push-based, bounded-retry-then-silent-loss default as the highest-severity divergence in the domain to date, with no equivalent risk in SQS's pull-based model; explicitly ties back to Modules 52–56)
- ✅ **Module 71**: Azure → Containers & Microservices — AKS, Container Apps, KEDA & Dapr — [`22-Azure/07-Containers-Microservices-AKS-ContainerApps-Dapr.md`](../22-Azure/07-Containers-Microservices-AKS-ContainerApps-Dapr.md) (comparative against Module 63 — flags Container Apps as a genuine THIRD tier with no AWS equivalent, and Dapr's materially broader application-level scope vs. App Mesh; incident is structurally distinct from Modules 65–70, since it's about an AWS-derived mental model missing an entire option category rather than misapplying a known one; explicitly ties back to Modules 49–51)
- ✅ **Module 72**: Azure → Observability, Cost & the Well-Architected Framework — Azure Monitor, Application Insights & Multi-Region DR — [`22-Azure/08-Observability-Cost-WellArchitectedFramework.md`](../22-Azure/08-Observability-Cost-WellArchitectedFramework.md) (capstone, comparative against Module 64 — flags the Azure WAF's 5-pillar vs. AWS's 6-pillar structure and Paired Regions as the key divergences; synthesizes Modules 65–71) — **`22-Azure` domain complete (Modules 65–72): Compute/Networking, IAM/Security, Storage, Databases, Serverless, Messaging/EDA, Containers/Microservices, Observability/Cost/Well-Architected — 8 modules at Principal-Engineer depth, each explicitly comparative against its AWS counterpart (57–64); full AWS-and-Azure cloud arc (Modules 57–72) complete**
- ✅ **Module 73**: Kubernetes → Architecture — Control Plane, Nodes, Pods, ReplicaSets & Deployments — [`23-Kubernetes/01-Architecture-ControlPlane-Pods-Deployments.md`](../23-Kubernetes/01-Architecture-ControlPlane-Pods-Deployments.md) (Kubernetes mirrors AWS/Azure's 8-module extra-depth scope per explicit user request, Modules 73–80: Architecture, Networking, Storage, Config/Security, Scheduling/Autoscaling, Helm/Operators/CRDs, Service Mesh, Observability/Multi-cluster/GitOps capstone; goes one abstraction level below Modules 63/71's EKS/AKS managed-service coverage, into the CNCF-standard control-plane internals and reconciliation-loop pattern underlying both)
- ✅ **Module 74**: Kubernetes → Networking — Services, Ingress, CNI, DNS & Network Policies — [`23-Kubernetes/02-Networking-Services-Ingress-CNI-DNS-NetworkPolicies.md`](../23-Kubernetes/02-Networking-Services-Ingress-CNI-DNS-NetworkPolicies.md) (ties Service `LoadBalancer` type and Ingress Controllers directly to Modules 57/65's ALB/NLB/Application Gateway resources; flags NetworkPolicy's CNI-dependent, silently-inert-if-unsupported enforcement gap as the highest-severity finding — an unenforced policy produces zero observable symptom short of an actual unauthorized-access attempt succeeding)
- ✅ **Module 75**: Kubernetes → Storage — Volumes, PersistentVolumes/Claims, StorageClasses & StatefulSets — [`23-Kubernetes/03-Storage-Volumes-PersistentVolumes-StorageClasses-StatefulSets.md`](../23-Kubernetes/03-Storage-Volumes-PersistentVolumes-StorageClasses-StatefulSets.md) (ties dynamic provisioning/CSI drivers directly to Modules 59/67's EBS/Azure Managed Disks; flags the `Delete` reclaim-policy default as the domain's second "abstraction masks a real, irreversible operation" finding, structurally paralleling Module 74's NetworkPolicy incident — a namespace-cleanup mistake destroyed a production database with no additional confirmation beyond the original PVC deletion)
- ✅ **Module 76**: Kubernetes → Configuration & Security — ConfigMaps, Secrets, RBAC, Pod Security & Admission Controllers — [`23-Kubernetes/04-Configuration-Security-ConfigMaps-Secrets-RBAC-PodSecurity.md`](../23-Kubernetes/04-Configuration-Security-ConfigMaps-Secrets-RBAC-PodSecurity.md) (establishes K8s RBAC as a genuinely separate authorization system from cloud IAM, Module 58/66; confirms Module 74 §Advanced Q7's predicted recurrence — Pod Security Admission's enforcement-mode gap — via an incident where a sound audit-then-enforce rollout silently stalled for nine months with no forcing function to complete it; third instance of this domain's "object presence ≠ enforced reality" pattern)
- ✅ **Module 77**: Kubernetes → Scheduling & Autoscaling — Scheduler Internals, Affinity/Taints/Tolerations & HPA/VPA/Cluster Autoscaler — [`23-Kubernetes/05-Scheduling-Autoscaling-Affinity-Taints-HPA-VPA-ClusterAutoscaler.md`](../23-Kubernetes/05-Scheduling-Autoscaling-Affinity-Taints-HPA-VPA-ClusterAutoscaler.md) (ties Cluster Autoscaler directly to Modules 57/65's ASG/VMSS; flags the 3-stage sequential (not parallel) HPA→Pending→Cluster-Autoscaler autoscaling chain as the headline finding, via a promotional-event incident where load testing validated HPA's reaction in isolation against pre-provisioned headroom, never exercising the full, capacity-constrained chain)
- ✅ **Module 78**: Kubernetes → Helm, Operators & CRDs — Package Management, the Operator Pattern & Custom Resources — [`23-Kubernetes/06-Helm-Operators-CRDs.md`](../23-Kubernetes/06-Helm-Operators-CRDs.md) (fourth instance of the domain's "object/action presence ≠ durable reality" pattern, in a new guise — Helm's one-shot, non-reconciling nature means a manual `kubectl edit` mitigation on a Helm-managed resource is silently reverted by any future, even unrelated, `helm upgrade`, unlike an Operator-managed Custom Resource which auto-reverts drift on its own continuous reconciliation pass; generalizes Module 75 §2.5's Strimzi/Kafka StatefulSet preview into the full Operator pattern)
- ✅ **Module 79**: Kubernetes → Service Mesh & Advanced Networking — Istio, Linkerd & mTLS — [`23-Kubernetes/07-ServiceMesh-Istio-Linkerd-AdvancedNetworking.md`](../23-Kubernetes/07-ServiceMesh-Istio-Linkerd-AdvancedNetworking.md) (**first module written to the full, corrected 18-section template** — 40 interview questions/5 parts each, fully-authored §§12–17, per `CLAUDE.md`'s resolved template-gap decision; confirms Module 76 §2.6's predicted sidecar-injection mechanism and delivers the domain's fifth "object presence ≠ enforced reality" instance via mTLS PERMISSIVE-mode drift; ties to Module 63's App Mesh and Module 71's Dapr)
- ✅ **Module 80**: Kubernetes → Observability, Multi-cluster & GitOps — [`23-Kubernetes/08-Observability-Multicluster-GitOps.md`](../23-Kubernetes/08-Observability-Multicluster-GitOps.md) (capstone; delivers the GitOps fix Module 78 §Advanced Q1 predicted, then generalizes this domain's entire recurring "object presence ≠ enforced reality" pattern — found independently in Modules 74/75/76/78/79 — into its fully-stated form: GitOps solves *drift*, but a clean sync-status dashboard can produce **more** false confidence than raw object presence ever did, since a wrong declaration is enforced just as faithfully as a correct one) — **`23-Kubernetes` domain complete (Modules 73–80): Architecture, Networking, Storage, Config/Security, Scheduling/Autoscaling, Helm/Operators/CRDs, Service Mesh, Observability/Multi-cluster/GitOps — 8 modules at Principal-Engineer depth, completing the full cloud-and-orchestration arc (Modules 57–80) begun with AWS**
- ✅ **Module 81**: Docker → Images, Layers & the Union Filesystem — [`24-Docker/01-Images-Layers-UnionFilesystem.md`](../24-Docker/01-Images-Layers-UnionFilesystem.md) (standard-depth domain, Modules 81–84, per explicit user request; central finding is the whiteout-marker gotcha — deleting a file in a later layer only hides it, the bytes remain permanently recoverable in the earlier layer — via a leaked npm token incident; establishes BuildKit's `--mount=type=secret` as the structural fix)
- ✅ **Module 82**: Docker → Dockerfile Optimization & Multi-stage Builds — [`24-Docker/02-Dockerfile-Optimization-MultiStageBuilds.md`](../24-Docker/02-Dockerfile-Optimization-MultiStageBuilds.md) (headline finding: `ARG` values are absent from a running container's environment but permanently recorded in image build history — a genuinely distinct exposure mechanism from Module 81's filesystem-layer finding; incident shows a team correctly fixing Module 81's specific issue while reintroducing the same underlying risk via a different mechanism, since their verification only generalized partially)
- ✅ **Module 83**: Docker → Container Runtime Internals & Isolation — Namespaces, cgroups & seccomp — [`24-Docker/03-Runtime-Internals-Namespaces-Cgroups-Seccomp.md`](../24-Docker/03-Runtime-Internals-Namespaces-Cgroups-Seccomp.md) (goes one level below the Kubernetes domain, explaining the exact kernel mechanisms those modules configured — Module 79 §14's CPU-throttling incident was `cpu.max`/CFS bandwidth control; Module 76 §2.5's Pod Security Admission levels are literally capabilities+seccomp restrictions; central finding: `--privileged` simultaneously removes multiple independent defense-in-depth layers, via an incident where a privileged sidecar's RCE escalated to full host compromise)
- ✅ **Module 84**: Docker → Compose, Networking, Volumes & Production Patterns — [`24-Docker/04-Compose-Networking-Volumes-ProductionPatterns.md`](../24-Docker/04-Compose-Networking-Volumes-ProductionPatterns.md) (capstone; headline finding — `depends_on` guarantees only process start, not readiness, mirroring Module 74 §2.2's Kubernetes Running-vs-Ready finding independently in a simpler tool — then generalizes this into the fully cross-domain lesson spanning both the Kubernetes and Docker domains: declared configuration ≠ verified actual behavior, validated across 8 distinct mechanisms in 2 technology domains, Modules 74/75/76/78/79/81/82/84) — **`24-Docker` domain complete (Modules 81–84): Images/Layers, Dockerfile Optimization/Multi-stage Builds, Runtime Internals/Isolation, Compose/Networking/Volumes/Production Patterns — standard-depth scope per explicit user request, completing the container-and-orchestration arc (Modules 73–84) alongside Kubernetes**
- ✅ **Module 85**: DevOps → Infrastructure as Code — Terraform, State Management & Drift — [`25-DevOps/01-InfrastructureAsCode-Terraform-State-Drift.md`](../25-DevOps/01-InfrastructureAsCode-Terraform-State-Drift.md) (`25-DevOps` scoped standard depth, Modules 85–88: IaC/Terraform, Configuration Management/Secrets/Environment Promotion, Release/Deployment Strategies, DevSecOps/Policy-as-Code/Platform Engineering capstone — mirroring Docker's standard-depth scoping since DevOps has no explicit extra-depth flag; headline finding is a genuine, stronger divergence from this course's recurring Kubernetes/Docker "declared ≠ enforced" theme — Terraform provides **no continuous reconciliation at all**, only plan-time diffing, meaning out-of-band drift (an emergency console change) can persist silently and indefinitely until an unrelated routine `apply` reverts it at the worst possible moment; explicitly contrasts Module 73 §2.2's controller reconciliation loop and Module 80 §2.2/§2.6's GitOps continuous sync, and ties Crossplane, in §15, back to the Kubernetes Operator/CRD pattern (Module 78) as the one architecture that closes this specific gap)
