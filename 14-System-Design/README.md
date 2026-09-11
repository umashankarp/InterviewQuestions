# 14 — System Design

> Index and coverage map for the System Design domain. The authoritative module log is `00-Roadmap/README.md`'s Progress Log; this file maps each module to the **interview question class** it answers, so you can find the right preparation for a specific prompt.

---

## Start here

If you are preparing for a system design round, read **[16 — Interview Execution Playbook](./16-Interview-Execution-Playbook-Estimation-Rubric.md)** first, before any case study. Every other module teaches you *a design*; that one teaches you how to **produce one in 45 minutes, out loud, under a clock**. Those are different skills, and the second is what gets scored. It contains the requirements script, the estimation constants, the Senior/Staff/Principal boundary made explicit, and the rubric interviewers actually fill out.

If the vocabulary in the case studies is not yet second nature — replica lag, cache-aside, shard key, stateless tier — read **[21 — Scaling Foundations](./21-Scaling-Foundations-SingleServer-To-Millions-BuildingBlocks.md)** next. It derives the building blocks that Modules 02–20 assume, and it answers the most common *opening* prompt in the round: `start with one server, now give me a million users.`

Then work the case studies by **shape**, not by title. Roughly eight shapes cover most prompts, and recognizing the shape matters far more than memorizing any instance.

---

## Modules

### Foundations

| # | Module | Covers |
|---|---|---|
| 01 | [System Design Fundamentals](./01-System-Design-Fundamentals.md) | Requirements gathering, capacity estimation, load balancing, caching strategies, CAP |
| 21 | [Scaling Foundations — Single Server to Millions](./21-Scaling-Foundations-SingleServer-To-Millions-BuildingBlocks.md) | **The building-block layer.** The eleven-rung scaling ladder and what each rung costs; replication, caching, CDN, statelessness, multi-DC, queues, sharding; proxies, polling/SSE/WebSocket, storage classes, consistency models, estimation constants, availability arithmetic |
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
| 19 | [Search, Typeahead & Autocomplete](./19-Designing-Search-Typeahead-Autocomplete.md) | Inverted indexes and FSTs; freshness vs. latency; scatter-gather tails; relevance as an *unverifiable* correctness definition |
| 20 | [Notification & Alerting System](./20-Designing-Notification-Alerting-System.md) | Multi-channel fan-out through infrastructure you don't own; consent at dispatch time; delivery evidence and reconciliation |

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
| Search & typeahead | 19 | Strong |
| Notification / push fan-out | 20 | Strong |
| **Delivery evidence via a third party you don't control** | **20** | Strong |
| **Scaling evolution / building blocks** | 21 | Strong |
| **Geospatial proximity & matching** | — | **Gap** |
| **Booking / inventory contention** | — | **Gap** |
| **Job scheduling & workflow orchestration** | — | **Gap** |
| **Real-time counting & stream aggregation** | — | **Gap** |

---

## Known gaps — prioritized backlog

These question classes are asked at the Principal/Staff bar and are not yet covered. Listed in the order they should be written, by how frequently they appear:

1. **Geospatial proximity & real-time matching** — geohash/S2/quadtree, location ingest, dispatch under contention. *(The Uber/DoorDash class.)*
2. **Booking & inventory contention** — reservation TTLs, oversell as a correctness bug, queue-based admission for onsales. *(Partially touched in 07.)*
3. **Distributed job scheduler & workflow orchestration** — cron at scale, exactly-once triggering, leader election, missed-window semantics, backfill.
4. **Real-time counting & stream aggregation** — windowing, watermarks, late data, exactly-once aggregation, HyperLogLog/count-min.

*Closed since this backlog was written:* search & typeahead (Module 19), notification & push delivery (Module 20), and the scaling-foundations/building-block layer (Module 21 — a gap found by term-frequency audit rather than by question class).

Adjacent material that partially covers some of this lives outside the folder: `16-Distributed-Systems/` (consensus, CRDTs, tail latency, storage engines), `12-Data-Structures/02-Graphs-Tries-Union-Find.md` (tries), `07-Redis/` (caching, streams), and `36-Saga/` + `37-Outbox/`.

---

## Format note

**§10 Interview Questions has been removed from every file in this folder (2026-09-11).** The Q&A format — 40 questions per module, each with an ideal answer, common mistakes and follow-ups — was retired on the principle that *the explanation should carry everything*, so that no question can be failed for want of material the prose did not cover. Nothing was discarded: the substance of every question and answer was absorbed into the explanatory sections, predominantly §2 Deep Dive, which is now the centre of gravity of every file in this folder.

What that means in practice:

- **§2 is now long and complete by design.** Where a topic previously appeared only as an Expert question — an isolation-level trace, a build-versus-buy judgement, a migration procedure, a "what would you refuse to do" evaluation — it is now a named subsection with the reasoning written out.
- **Interviewer push-backs are answered inline.** The challenges that used to live in "Common mistakes" and "Follow-ups" are folded into the prose at the point where the claim is made, so the objection and its answer sit together.
- **Each module names its own discriminating question** — the one that most reliably separates a Staff answer from a Senior one in that domain — and works through both answers.
- **Cross-references were rehomed.** Roughly 570 pointers of the form §A5 / §E7 / "Advanced Q2" across the folder now resolve to the §2 subsection that carries the material.

Modules **01–08** still differ from the rest in other respects: they predate the fuller template and their §12–17 sections are thinner than Modules 09 onward. Their content is sound and the case studies are complete.

Modules **20 and 21** additionally follow the **four-step System Design standard** (`CLAUDE.md`, 2026-08-09): §12 is written to the structure and depth of the *System Design Interview Vol. 2* payment chapter — a candidate↔interviewer scope dialogue, functional/non-functional requirements, back-of-envelope estimation that concludes what the numbers say the *hard problem* is, then high-level design with a component glossary, a numbered end-to-end walkthrough, real API parameter tables and real table schemas with a status lifecycle, then a failure-oriented deep dive, a wrap-up of what was left out, and a numbered reference list. In these modules §12 is the largest section in the file, not a summary. Modules 01–19 keep their existing §12 treatment — no retrofit.

Module **21 supersedes Module 01's §2** in practice: 01 covers requirements, estimation, load balancing, caching and CAP in five paragraphs, and 21 gives the same ground the full building-block treatment. Module 01 is left as-is per the no-retrofit default, so where the two overlap, prefer 21.

If you are practising against 01–08, supplement them with Module 16's rubric — their §12–§17 depth will not by itself calibrate you to the Staff+ bar.

---

## Recurring findings across this domain

Three patterns surface repeatedly and are worth carrying into any design:

- **Correctness is often unobservable at the point of consumption yet immediately consequential.** Most of the complexity in Modules 09–14 and 18 exists to establish *evidence*, not throughput. The Principal-level question is not "can we compute this fast enough" but **"how would we know if this were wrong?"**
- **A check whose expected set derives from the logic being checked cannot detect that logic's omissions**, and **an aggregate cannot detect a concentrated failure.** Modules 13, 15, 17, 18, 19, and 20 each contain an incident of this shape — green dashboards throughout, because the monitoring was structurally blind in exactly the dimension of the failure. Module 19 adds a *directional* variant (a metric that detects under-matching is blind to over-matching), and Module 20 adds the sharpest form: a non-terminal state counted in the success numerator, so **the more messages got stuck, the better the dashboard looked**. The remedy is the same triple every time — an independent verifier, a counter on every silent path, and detection by **aging rather than rate**.
- **Prefer making the bad state unrepresentable over detecting it.** A protection mechanism with exceptions is one whose exceptions are where the incidents occur. Modules 03, 12, 17, and 18 each arrive at this independently.
- **Every scaling step converts a capacity problem into a consistency problem** (Module 21). Replicas buy read throughput with stale reads; a cache buys latency with staleness, a stampede risk and a new SPOF; a queue buys availability with at-least-once delivery and a silent backlog. The corollary is the one that separates Staff from Senior framing: **a rung climbed without a measured bottleneck buys its failure modes for free and its benefits not at all.** Modules 04, 14 and 21 each contain an incident where every step taken was individually correct and the system got worse.
- **A protection mechanism with a feedback path into the thing it protects can amplify the failure it exists to contain.** Autoscalers, retries, circuit breakers and deep health checks all have this shape; each needs a bound — a maximum, a budget, a floor, a cooldown. Named in Module 21 §14, and visible in retrospect in Modules 15 and 20.
