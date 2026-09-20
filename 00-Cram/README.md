# 00-Cram — One-Week Interview Preparation

**34 sheets · ~4,200 lines · 108 scenario Q&A · distilled from 168,141 lines across 47 domain folders.**

The deep modules in the numbered folders are untouched — they remain your reference when a sheet isn't enough. **These sheets are what you memorise.** Everything is calibrated to the Elite FinTech panel bar for **Lead / Principal Engineer and Software-Solutions-Enterprise Architect**.

---

## How every sheet is built

| Section | What it's for |
|---|---|
| **Numbers / tables** | pure memorisation — cover the right column and recite |
| **Mechanism bullets** | 1–3 lines each: what it is, why it's chosen, what it costs |
| **> TRAP** | the specific wrong answer that loses the interview |
| **Top traps** | consolidated drill list — 10 per sheet |
| **Interview Q&A** | **the main event.** Scenario-framed questions at the Lead/Principal bar, each with the full answer, *why it lands*, the ✗ weak answer, and ↳ follow-ups. ⭐ marks frequency |
| **Quick-fire** | 30-second mechanism answers — the warm-up questions |
| **Go deeper** | the source file when a sheet isn't enough |

### The answer frame — five beats, every time

1. **Headline** the decision in one sentence, first.
2. **Mechanism** — what actually happens underneath. *(Senior stops here.)*
3. **Trade-off** — what it costs, and the threshold where the answer flips.
4. **Failure mode + detection** — how it breaks, **and how you'd know**. Name what has *no* detector.
5. **Ownership** *(Principal)* — should this exist, who maintains it, what it costs over years.

> **The level tell:** Senior answers the question. Lead/Staff answers how it fails and how you'd know. Principal asks whether the thing should exist.

---

## The 20 most-asked — drill these first

If you only have one day, these are the questions most likely to decide the outcome.

| # | Question | Sheet |
|---|---|---|
| 1 | Multi-tenant cross-tenant data leak (captive dependency) | [[02-DotNet-AspNetCore]] Q1 |
| 2 | Customer was charged twice — design the fix | [[03-REST-APIs]] Q1 |
| 3 | Design a ledger / account balance system | [[04-SQL-Server]] Q9 |
| 4 | Fast in SSMS, slow from the app | [[04-SQL-Server]] Q3 |
| 5 | Parameter sniffing — fast for A, slow for B | [[04-SQL-Server]] Q2 |
| 6 | API timing out, CPU 15%, threads climbing | [[01-CSharp]] Q1 |
| 7 | Cache consistency — worked at all three levels | [[14-System-Design-Core]] Q3 |
| 8 | Opening a deliberately vague design prompt | [[14-System-Design-Core]] Q1 |
| 9 | "What breaks first at 10×?" | [[14-System-Design-Core]] Q4 |
| 10 | Messages published but not saved (dual write) | [[16-Distributed-Systems]] Q1 |
| 11 | Consumer lag growing at 2am | [[18-Event-Driven-Architecture]] Q1 |
| 12 | Retry amplification — 30s blip, 40min outage | [[17-Microservices]] Q2 |
| 13 | You inherit a distributed monolith | [[17-Microservices]] Q1 |
| 14 | Saga step that can't be compensated | [[34-CQRS-EventSourcing-Saga-Outbox]] Q2 |
| 15 | N+1 — endpoint takes 8 seconds | [[56-EFCore]] Q2 |
| 16 | Zero-downtime schema change on 400M rows | [[56-EFCore]] Q3 |
| 17 | BOLA — user fetches another customer's order | [[02-DotNet-AspNetCore]] Q2 |
| 18 | A technical decision you got wrong | [[51-Engineering-Leadership]] Q1 |
| 19 | Influencing teams you don't own | [[51-Engineering-Leadership]] Q2 |
| 20 | Build vs buy — you have the deciding vote | [[03-REST-APIs]] Q4 |

---

## The 7-day plan

Each day: **read (30–45 min) → drill the traps (10 min) → say the 30-second answers out loud (15 min).** The speaking is not optional — recognition is not recall.

### Day 1 — .NET Core Stack · ~610 lines
[[01-CSharp]] · [[02-DotNet-AspNetCore]] · [[56-EFCore]] · [[03-REST-APIs]]
> **Must know cold:** LOH 85,000 bytes · deadlock vs thread-pool starvation · captive dependency · `with` is a shallow copy · `throw ex;` · idempotency key + unique constraint · DbContext lifetime.

### Day 2 — Data · ~440 lines
[[04-SQL-Server]] · [[05-PostgreSQL-MongoDB-DynamoDB]] · [[07-Redis]]
> **Must know cold:** clustered vs non-clustered · SARGability · parameter sniffing · "fast in SSMS, slow in app" = ARITHABORT · isolation-level table · `NOT IN` with NULL · ROWS vs RANGE · the 6 query patterns · hot partition.

### Day 3 — System Design · ~455 lines
[[14-System-Design-Core]] · [[14-System-Design-Problems]]
> **Must know cold:** the estimation constants block · the four-step spine · the Senior/Staff/Principal ladder · 20 problem cards. **Re-read Core every morning for the rest of the week.**

### Day 4 — Distributed Systems & Messaging · ~655 lines
[[16-Distributed-Systems]] · [[17-Microservices]] · [[18-Event-Driven-Architecture]] · [[19-Kafka-RabbitMQ]] · [[34-CQRS-EventSourcing-Saga-Outbox]]
> **Must know cold:** at-least-once delivery + idempotent, atomic handling = effectively-once business effect (within a retention window) · outbox vs dual write · 2PC vs saga · fencing tokens · `W+R>N` · `acks=all` + `min.insync.replicas` · consumers ≤ partitions · compensate, don't undo.

### Day 5 — Cloud & Infrastructure · ~730 lines
[[21-AWS]] · [[22-Azure]] · [[23-Kubernetes]] · [[24-Docker]] · [[25-DevOps-CICD]] · [[27-Observability]]
> **Must know cold:** the master request journey · compute decision framework · IRSA · Lambda+RDS Proxy · object presence ≠ enforced reality · liveness vs readiness · expand–contract · error budgets and burn-rate alerting.

### Day 6 — Design & Architecture · ~635 lines
[[11-Design-Patterns]] · [[09-OOP-SOLID]] · [[15-Low-Level-Design]] · [[31-DDD]] · [[32-Clean-Hexagonal-Architecture]] · [[30-Architecture-Patterns]] · [[12-DataStructures-Algorithms]]
> **Must know cold:** the pattern confusion matrix · when you'd violate SOLID · aggregate boundary = the invariant · the dependency rule as a compile-time fact · reversibility as the master variable · the DS&A pattern table.

### Day 7 — Security, Specialist & Leadership · ~740 lines
[[28-Security]] · [[41-OAuth2-OIDC-JWT]] · [[38-APIGateway-ServiceMesh-IAM]] · [[29-Performance-Engineering]] · [[44-AI-Systems]] · [[51-Engineering-Leadership]] · [[42-Angular-React]]
> **Must know cold:** BOLA · parameterisation not sanitisation · Argon2id · PKCE · `aud` validation · algorithm confusion · coordinated omission · RAG hybrid search · the Staff/Principal distinction · your six behavioural stories.

---

## Daily drill protocol (the part that makes it stick)

1. **Cover-and-recite** every table. If you can't produce the right column from the left, you don't know it.
2. **Read the "Top traps" list aloud** and say *why* each is wrong in one sentence.
3. **Answer the ⭐⭐⭐⭐⭐ Q&A standing up, out loud, timed** — 90 seconds each, no notes. Then check yourself against the *✗ weak answer* line: if what you said was closer to that than to the model answer, do it again.
4. **Say the follow-ups back to yourself.** Half of these questions are really the follow-up; getting the first answer right and stalling on "and how would you know?" is the common failure.
5. **Spaced repetition:** re-read the previous day's traps each morning (10 min). By Day 7 you'll have hit Day 1 six times.

---

## The evening before the interview — 45 minutes

1. The **20 most-asked** table above — read the question, answer it in your head, open the sheet only if you stall.
2. [[14-System-Design-Core]] — the estimation constants block and the Senior/Staff/Principal ladder (Q3).
3. Every sheet's **"Top traps"** section only (~20 min for all 34).
4. Your **eight behavioural stories** from [[51-Engineering-Leadership]] Q1–Q8, each with a number attached.
5. The three questions you'll ask them.

---

## The five things that transfer to every answer

1. **Estimate to eliminate.** A number that retires an architecture earns its place; one that doesn't was wasted.
2. **At-least-once delivery + idempotent, atomic handling yields an effectively-once business effect within a retention window.** Never claim exactly-once delivery on the wire.
3. **Reconcile against external truth** — even when the other side claims correctness.
4. **Append-only, always forward** for anything financial or audited.
5. **Name what has no detector.** Then propose the detector. This single move reads as Principal-level more reliably than anything else.

---

## Level calibration — say the Staff/Principal layer

> **Senior** answers the question. **Staff** answers how it fails and how you'd know. **Principal** questions whether the thing should exist, who maintains it, and what it costs the organisation over years.

Whatever the question, add the second and third layers unprompted.

---

## Also in this repo

- **`Architect-Role-Cheat-Sheet/`** — 21 Q&A files (21,566 lines) already in cheat-sheet form for Solution/Technical/Enterprise Architect interviews, plus `SQL-Query-Interview-Questions-Top30.md`. Use it for **extra question drilling** once you've memorised these sheets; it covers the same ground in Q&A format.
- **`00-Roadmap/README.md`** — the authoritative progress log for the full 198-module programme.
- **The numbered domain folders** — full depth, unchanged. Every sheet's footer points at the exact files.

---

*Built 2026-09-20. Platform defaults, limits and pricing evolve: verify them against current vendor documentation before making a production commitment. Sheets are the map; the domain folders are the territory.*
