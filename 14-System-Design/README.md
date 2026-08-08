# 14 — System Design

> Index and coverage map for the System Design domain. The authoritative module log is `00-Roadmap/README.md`'s Progress Log; this file maps each module to the **interview question class** it answers, so you can find the right preparation for a specific prompt.

---

## Start here

If you are preparing for a system design round, read **[16 — Interview Execution Playbook](./16-Interview-Execution-Playbook-Estimation-Rubric.md)** first, before any case study. Every other module teaches you *a design*; that one teaches you how to **produce one in 45 minutes, out loud, under a clock**. Those are different skills, and the second is what gets scored. It contains the requirements script, the estimation constants, the Senior/Staff/Principal boundary made explicit, and the rubric interviewers actually fill out.

Then work the case studies by **shape**, not by title. Roughly eight shapes cover most prompts, and recognizing the shape matters far more than memorizing any instance.

---

## Modules

### Foundations

| # | Module | Covers |
|---|---|---|
| 01 | [System Design Fundamentals](./01-System-Design-Fundamentals.md) | Requirements gathering, capacity estimation, load balancing, caching strategies, CAP |
| 16 | [Interview Execution Playbook](./16-Interview-Execution-Playbook-Estimation-Rubric.md) | Clock management, estimation constants, deep-dive technique, the scoring rubric, handling pushback |

### Consumer-scale case studies

| # | Module | Question class / shape |
|---|---|---|
| 02 | [News Feed / Timeline](./02-Designing-News-Feed-System.md) | Read-heavy fan-out; push vs. pull; the celebrity problem |
| 03 | [Chat / Messaging](./03-Designing-Chat-Messaging-System.md) | Stateful connections; delivery guarantees; ordering vs. fan-out |
| 04 | [Rate Limiter & API Gateway](./04-Designing-Rate-Limiter-API-Gateway.md) | Distributed counting; gateway concerns *(algorithms: see 15)* |
| 05 | [YouTube / Video Streaming](./05-Designing-YouTube-Video-Streaming.md) | Large-object pipelines; transcoding; CDN economics |
| 06 | [Instagram](./06-Designing-Instagram.md) | Media + feed combined; ephemeral content and storage-native TTL |
| 07 | [Amazon / E-commerce](./07-Designing-Amazon-Ecommerce.md) | Multi-service transactions; the Saga motivation; inventory contention |
| 08 | [WhatsApp — E2E & Multi-Device](./08-Designing-WhatsApp-E2E-MultiDevice.md) | End-to-end encryption; per-device key management |
| 17 | [URL Shortener & Distributed ID Generation](./17-Designing-URL-Shortener-Distributed-ID-Generation.md) | **The most-asked opener.** Coordination-free unique IDs; extreme read skew; hot keys |

### Financial systems

| # | Module | Question class / shape |
|---|---|---|
| 09 | [Real-Time Portfolio Risk Engine](./09-Designing-RealTime-Portfolio-Risk-Engine.md) | Compute grids; determinism as a regulatory constraint |
| 10 | [Market Data Distribution](./10-Designing-Market-Data-Distribution-Platform.md) | Streaming vs. snapshot vs. history as three incompatible products |
| 11 | [Order Management & Trade Lifecycle](./11-Designing-Order-Management-Trade-Lifecycle.md) | Long-lived state machines with an external authority; FIX; idempotency |
| 12 | [Multi-Tenant Portfolio Analytics](./12-Designing-MultiTenant-Portfolio-Analytics-Platform.md) | Tenant isolation where a leak is existential; noisy neighbours |
| 13 | [Regulatory Reporting Pipeline](./13-Designing-Regulatory-Reporting-Pipeline.md) | Completeness as the hard problem; immovable deadlines |
| 14 | [Capstone — Batch → Intraday Migration](./14-Capstone-Migrating-EndOfDay-Batch-To-Intraday.md) | Changing the foundation under running systems; migration evidence |
| 18 | [Payment Processing & Double-Entry Ledger](./18-Designing-Payment-Processing-DoubleEntry-Ledger.md) | **Money movement.** Conservation invariants; idempotency; settlement & reconciliation |

### Algorithmic deep dives

| # | Module | Covers |
|---|---|---|
| 15 | [Rate Limiting, Throttling & Load Shedding](./15-RateLimiting-Throttling-LoadShedding-Algorithms.md) | Every limiter algorithm derived, including GCRA; distributed correctness; concurrency vs. rate limiting |

---

## Coverage by question shape

| Shape | Covered by | Depth |
|---|---|---|
| Read-heavy fan-out | 02, 06, 17 | Strong |
| Stateful connections / real-time push | 03, 08 | Strong |
| Large-object / media pipelines | 05, 06 | Strong |
| Transactional & multi-service consistency | 07, 11, 18 | Strong |
| **Money, ledgers, conservation invariants** | **18** | Strong |
| Distributed unique ID generation | 17 | Strong |
| Rate limiting & overload | 04, 15 | Exceptional |
| Streaming / market data | 10 | Strong |
| Compute grids & determinism | 09 | Strong |
| Multi-tenancy & isolation | 12 | Strong |
| Regulatory / completeness / deadlines | 13 | Strong |
| Migration & evolution | 14 | Strong |
| **Search & typeahead** | — | **Gap** |
| **Notification / push fan-out** | — | **Gap** |
| **Geospatial proximity & matching** | — | **Gap** |
| **Booking / inventory contention** | — | **Gap** |
| **Job scheduling & workflow orchestration** | — | **Gap** |
| **Real-time counting & stream aggregation** | — | **Gap** |

---

## Known gaps — prioritized backlog

These question classes are asked at the Principal/Staff bar and are not yet covered. Listed in the order they should be written, by how frequently they appear:

1. **Search, typeahead & autocomplete** — inverted index, trie/FST, ranking, index freshness vs. query latency, scatter-gather tail latency.
2. **Notification & push delivery** — multi-channel fan-out, preference/quiet hours, provider failover, poison-endpoint isolation, delivery receipts.
3. **Geospatial proximity & real-time matching** — geohash/S2/quadtree, location ingest, dispatch under contention. *(The Uber/DoorDash class.)*
4. **Booking & inventory contention** — reservation TTLs, oversell as a correctness bug, queue-based admission for onsales. *(Partially touched in 07.)*
5. **Distributed job scheduler & workflow orchestration** — cron at scale, exactly-once triggering, leader election, missed-window semantics, backfill.
6. **Real-time counting & stream aggregation** — windowing, watermarks, late data, exactly-once aggregation, HyperLogLog/count-min.

Adjacent material that partially covers some of this lives outside the folder: `16-Distributed-Systems/` (consensus, CRDTs, tail latency, storage engines), `12-Data-Structures/02-Graphs-Tries-Union-Find.md` (tries), `07-Redis/` (caching, streams), and `36-Saga/` + `37-Outbox/`.

---

## Format note

Modules **01–08** predate the current template: they use a compressed format (~30 short-form Q&A, no dedicated Performance/Security/Scalability sections, and §12–17 collapsed into a pointer). Their *content* is sound and the case studies are complete, but they do not carry the five-part answers (Ideal Answer / Why correct / Common mistakes / Follow-ups) that Modules 09 onward provide. Per this repo's standing no-retrofit precedent they are left as-is. Modules **09–18** use the full 16-section template with 40 complete Q&A.

If you are practising against 01–08, supplement them with Module 16's rubric — the compressed Q&A will not by itself calibrate you to the Staff+ bar.

---

## Recurring findings across this domain

Three patterns surface repeatedly and are worth carrying into any design:

- **Correctness is often unobservable at the point of consumption yet immediately consequential.** Most of the complexity in Modules 09–14 and 18 exists to establish *evidence*, not throughput. The Principal-level question is not "can we compute this fast enough" but **"how would we know if this were wrong?"**
- **A check whose expected set derives from the logic being checked cannot detect that logic's omissions**, and **an aggregate cannot detect a concentrated failure.** Modules 13, 15, 17, and 18 each contain an incident of this shape — green dashboards throughout, because the monitoring was structurally blind in exactly the dimension of the failure.
- **Prefer making the bad state unrepresentable over detecting it.** A protection mechanism with exceptions is one whose exceptions are where the incidents occur. Modules 03, 12, 17, and 18 each arrive at this independently.
