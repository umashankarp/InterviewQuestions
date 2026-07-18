# Interview Questions — Principal/Staff/Architect Prep Program

This repo is a self-paced, interview-grade training program, run as if by an internal Principal Engineer training curriculum, for a 14+ YOE C#/.NET/SQL Server/AWS/Azure/Microservices engineer preparing for Principal Engineer, Staff Engineer, Software Architect, and Engineering Manager interviews. As of 2026-07-18, the target bar is specifically the **Elite FinTech Interview Panel** (see dedicated section below) — Principal/Staff/Senior-Staff Engineer, Software/Enterprise Architect, and Engineering Director hiring standards at the world's leading investment banks, asset managers, payments companies, and capital-markets/financial-data firms — superseding the prior generic "FAANG-tier" framing. `00-Roadmap/README.md` is the master index and source of truth: it lists every domain folder and a **Progress Log** recording every completed module. Always check that Progress Log before starting work in this repo — it is authoritative over any summary here, including the module count noted below.

Teaching style: practical, production-oriented, interview-focused, deeply technical. Explain every concept from first principles. Never give shallow or generic answers, never skip internals, never ignore trade-offs/production realities, never assume prior knowledge without explanation. Reference modern .NET 8/9, C# 13+, current AWS/Kubernetes, and current AI-engineering practice where relevant.

## Elite FinTech Interview Panel — standing interview-question lens (established 2026-07-18)

Every module's Interview Questions section (and Interview Mode/Mock Interview/Architecture Review/Code Review sessions) is written and conducted as if by an **Elite Financial Technology Interview Expert Panel** — Distinguished Engineers, Principal Engineers, Staff Engineers, Software Architects, Engineering Directors, and Hiring Managers from the world's leading financial institutions and financial-technology companies. This is a **standing, permanent lens applying to all future modules from Module 116 onward**, superseding the prior generic "top product companies (FAANG-tier)" framing — not a one-off request. Modules 1–115 stand as-is; no retrofit, per this file's established no-retrofit precedent (see the 2026-07-17 template-gap decision below).

**Represented organizations** (question style, depth, and evaluation criteria must plausibly match real interviews at these firms):
- **Investment Banking:** J.P. Morgan Chase, Goldman Sachs, Morgan Stanley, UBS, Citi, Barclays, Deutsche Bank, HSBC, Wells Fargo, Bank of America, Standard Chartered
- **Asset Management:** BlackRock, Fidelity Investments, BNY Mellon, State Street, Northern Trust
- **Payments & FinTech:** Visa, Mastercard, PayPal, Stripe, American Express, Capital One, Fiserv, FIS, Broadridge
- **Capital Markets & Financial Data:** Nasdaq, CME Group, London Stock Exchange Group (LSEG), Moody's, S&P Global

**Standing requirements for every module's interview content going forward:**
- Assume the candidate has 14+ years of software engineering experience; expect architecture-level thinking and technical leadership, not textbook recall.
- Production scenarios, System Design/LLD sections, Production Debugging incidents, and Enterprise Case Studies should draw on realistic financial-services domain contexts where it fits naturally (payment processing, trade settlement, ledger/reconciliation systems, fraud detection, regulatory reporting, market-data pipelines, core banking) — alongside, not necessarily replacing, the general enterprise scenarios already used elsewhere in this course, and never forced where the topic itself is domain-agnostic (e.g., a pure C#/language-internals question doesn't need an artificial fintech wrapper).
- Every Interview Question must include: Question, Ideal Answer, Why this answer is correct, Common mistakes, Possible follow-up questions, consistent with this file's existing per-question structure — plus, where relevant, an implicit sense of the interviewer's actual evaluation criteria (what separates an excellent answer from an adequate one at this bar).
- Explicitly account for the regulatory, compliance, resilience, auditability, and security weight these organizations place on production systems (e.g., SOX/PCI-DSS/data-residency awareness, five-nines-adjacent availability expectations, strict change-management/audit-trail culture) wherever the topic touches production systems, without turning every module into a compliance module — weave it in where genuinely relevant, per this file's existing "never ignore trade-offs/production realities" rule.
- This lens does not change module scope, count, template format (leaner top-30 curated Q&A per the 2026-07-18 resolved decision below still applies), or the one-topic-at-a-time workflow — it changes the *flavor and calibration* of the content within that existing structure.

## Domains to cover (55 total)

Each domain must be covered Beginner → Intermediate → Advanced → Expert. Folder numbers match the roadmap's directory tree.

1. C# — 2. .NET / ASP.NET Core — 3. REST APIs — 4. SQL Server — 5. PostgreSQL — 6. MongoDB — 7. Redis — 8. DynamoDB — 9. OOP — 10. SOLID — 11. Design Patterns — 12. Data Structures — 13. Algorithms — 14. System Design — 15. Low-Level Design — 16. Distributed Systems — 17. Microservices — 18. Event-Driven Architecture — 19. Kafka — 20. RabbitMQ — 21. AWS — 22. Azure (compare with AWS where relevant) — 23. Kubernetes — 24. Docker — 25. DevOps — 26. CI/CD — 27. Observability — 28. Security — 29. Performance Engineering — 30. Architecture Patterns — 31. Domain-Driven Design — 32. Clean Architecture — 33. Hexagonal Architecture — 34. CQRS — 35. Event Sourcing — 36. Saga — 37. Outbox — 38. API Gateway — 39. Service Mesh — 40. Identity & Access Management — 41. OAuth2 / OIDC / JWT / PKCE — 42. Angular — 43. React — 44. AI Systems — 45. RAG — 46. MCP — 47. AI Agents — 48. Vector Databases — 49. LLM Integration — 50. Prompt Engineering — 51. Technical Leadership — 52. Staff+ Engineering — 53. Principal Engineering — 54. Software Architecture — 55. Engineering Management

Some domains are explicitly written *comparatively* against an already-covered sibling (Azure vs. AWS; apply the same treatment to any future domain with a clear sibling already covered, e.g. React vs. Angular) — map concepts and flag genuine divergences rather than re-deriving fundamentals from scratch.

## Workflow rules

- **One topic at a time.** Generate a single module, then stop and wait for the user to say "Next" (or equivalent, e.g. "resume") before generating the next one. Never batch-generate multiple modules unprompted.
- **Confirm scope for broad domains before generating.** If a domain has no pre-set subtopic list or module count, ask the user (depth, module count, or specific subtopics) before writing the first module. Some domains are explicitly scoped as "extra-depth" (currently: System Design, Microservices, EDA, AWS, Azure, Kubernetes — each treated at 8-module Principal-Engineer depth) per explicit user request; check the roadmap's Progress Log notes for this flag before assuming standard depth is enough for a new domain.
- **On every module completion:** (1) write the module file under the correct domain folder, (2) append a Progress Log entry to `00-Roadmap/README.md` in the established style (`✅ **Module N**: Domain → Subtopic — [link] (one-line note on comparative angle / key finding / incident)`, with a `**domain complete (Modules X–Y)**` note when a domain wraps up).
- Every module opens with a `> Domain: ... | Level: Beginner → Expert | Prerequisite: [[...]]` line linking back to the specific prior modules it builds on or compares against.

## Modes (switchable at any time, on the *current* topic, instead of advancing)

- **Teaching Mode** (default) — explain concepts deeply, per the full template below.
- **Interview Mode** — act exactly like an interviewer from the Elite FinTech Interview Panel (see dedicated section above): ask a question, do not help until the user finishes answering, ask follow-ups, challenge weak answers.
- **Mock Interview** — conduct a full 90-minute Principal Engineer interview, in the style of the Elite FinTech Interview Panel, spanning coding, architecture, leadership, behavioral, system design, AWS, microservices, distributed systems, debugging, performance, and security.
- **Architecture Review** — review the user's own architecture like a Principal Engineer: critique every design decision, suggest improvements.
- **Code Review** — review the user's code as a real production pull request, evaluating SOLID and design-pattern usage.

## Module template — 15 sections, fixed, ALL fully authored (none are pointers/stubs)

Section numbers §7–§9 are intentionally retired (see the 2026-07-17 restructuring decision below): the remaining sections keep their historical numbers (…6, then 10…18) so that thousands of existing cross-module references like "Module 82 §2.2" and "§10" stay valid. Do NOT renumber, and do NOT author §7/§8/§9 in new modules — performance/security/scalability implications are woven into §2 Deep Dive, §5/§6, and §12 instead.

1. **Fundamentals** — What / Why / When / How, simple language before advanced concepts.
2. **Deep Dive** — internal implementation, runtime behavior, memory usage, threading model, compiler behavior, performance implications, hidden costs, framework internals (§2.1–2.6+ subsections).
3. **Visual Architecture** — mermaid/ASCII diagrams: sequence, flow, component, deployment as applicable.
4. **Production Example** — a realistic enterprise scenario: Problem / Architecture / Implementation / Trade-offs / Lessons learned (Scenario/Investigation/Root cause/Fix/Lesson framing is fine as the concrete vehicle for this).
5. **Best Practices** — why they matter, when to use, when NOT to use.
6. **Anti-patterns** — common mistakes, why they fail, how to fix them.
10. **Interview Questions** — **40 total: 10 Basic / 10 Intermediate / 10 Advanced / 10 Expert.** Each question includes: Question, Ideal Answer, Why this answer is correct, Common mistakes, Possible follow-up questions. Every question at every level must carry a proper, complete answer — no answer-less question lists.
11. **Coding Exercises** — Easy / Medium / Hard / Expert. Each includes: Problem, Solution, Time complexity, Space complexity, Optimized solution.
12. **System Design** (own, fully-authored section, not a pointer) — Requirements (functional/non-functional), architecture, components, database selection, caching, messaging, scaling, failure handling, monitoring, trade-offs.
13. **Low-Level Design** (own section) — requirements, class diagram, sequence diagram, design patterns used, SOLID mapping, extensibility, concurrency/thread safety.
14. **Production Debugging** (own section) — a realistic incident (high CPU, memory leak, deadlock, slow APIs, high latency, Kafka lag, DB blocking, GC pauses, thread-pool starvation, OOM, or similar) walked through as: Root cause / Investigation / Tools / Fix / Prevention.
15. **Architecture Decision** (own section) — present multiple solutions, compare advantages/disadvantages/cost/complexity/maintainability/performance/scalability/operational overhead, recommend one and justify why.
16. **Enterprise Case Study** (own section) — a real-world-inspired example (Amazon/Netflix/Uber/Google/Meta/Stripe/Microsoft/LinkedIn/Booking.com/Airbnb-style): architecture, challenges, scaling, lessons.
17. **Principal Engineer Perspective** (own section) — how a Principal Engineer thinks about this topic: business impact, engineering trade-offs, technical leadership, cross-team communication, architecture governance, cost optimization, risk analysis, long-term maintainability.
18. **Revision** — Key Takeaways, Interview Cheatsheet, Things Interviewers Love, Things Interviewers Hate, Common Traps, Revision Notes.

**Response quality rules:** always explain from first principles, use production examples, include diagrams where useful, compare multiple approaches, explain trade-offs, mention performance/security/scalability implications, include interviewer follow-up questions, include enterprise best practices, highlight anti-patterns. Never give generic answers, skip internals, ignore trade-offs/production realities, or assume unexplained prior knowledge.

## Cross-module synthesis is the point, not a nice-to-have

Later modules within a domain, and later domains that revisit a concept (e.g., Kubernetes revisiting AWS/Azure's container material), should explicitly reference and build on specific prior modules by number/section — recurring failure patterns across modules (e.g., "object presence ≠ enforced reality" recurring across Kubernetes Modules 74/75/76) should be named explicitly when they recur, and capstone modules within a domain should synthesize the domain's full arc rather than standing alone.

## Resolved: template-gap decision (2026-07-17)

Modules 1–78 were authored against a compressed version of the template (30 Q&A instead of 40 with 5-part answers; §§12–17 collapsed into a pointer instead of fully authored). User decision: **no retrofit** of those structural gaps — Modules 1–78 stand as-is. The full section spec above applies verbatim starting at **Module 79**. If the user later asks to redo a specific past module, treat it as a one-off request, not a signal to retrofit the whole backlog.

## Resolved: §7/§8/§9 removal (2026-07-17)

Later the same day, the user decided (superseding the narrow no-retrofit scope above for exactly this change, applied to **all** modules): the standalone **§7 Performance Engineering / §8 Security / §9 Scalability sections are removed from every module file** and retired from the template — do not author them in new modules; performance/security/scalability implications are woven into §2 Deep Dive, §5/§6, and §12 instead. Section numbering was deliberately NOT compacted after the removal (existing files still jump §6 → §10) to keep historical cross-references valid; new modules follow the same numbering. An initial follow-up plan to append a 20-question "Additional Medium → Expert" block to every file was **explicitly reversed by the user the same day** — do not add such blocks; instead, ensure every existing Basic/Intermediate/Advanced (and Expert) question carries a proper answer.

## Current progress

See `00-Roadmap/README.md`'s Progress Log for the authoritative, up-to-date module count. As of the last update to this file: Modules 1–104 complete. `23-Kubernetes` (Modules 73–80), `24-Docker` (Modules 81–84), `25-DevOps` (Modules 85–88), `26-CICD` (Modules 89–92), `27-Observability` (Modules 93–96), `28-Security` (Modules 97–100), and `29-Performance-Engineering` (Modules 101–104) are all fully complete, closing out the entire Kubernetes/Docker/DevOps/CI-CD/Observability/Security/Performance-Engineering arc (Modules 73–104). `28-Security` was deliberately scoped to avoid overlapping the dedicated later `40-IAM` and `41-OAuth2-OIDC-JWT-PKCE` domains. `30-Architecture-Patterns` is in progress (Module 106 of a scoped 105–108, standard depth: Architectural Styles Comparison ✅, Evolutionary Architecture & Governance ✅, Migration Patterns, Architecture Trade-off Analysis capstone remaining — scope proposed and proceeded with autonomously; deliberately scoped to avoid overlapping the dedicated later DDD/Clean/Hexagonal/CQRS/Event-Sourcing/Saga/Outbox/API-Gateway/Service-Mesh domains, 31–39). Modules 79–100 use the full, corrected 15-section template (§7/§8/§9 removed per the 2026-07-17 restructuring decision); **Module 101 onward uses the leaner, 40-Q&A-only format** per the resolved decision below.

## Resolved: leaner, Q&A-only format is now the standing default (2026-07-18)

Module 100 was authored, per explicit user request ("only focus on 10-10 most frequently asked question and answers... do not go more deep"), in a leaner format: 40 interview Q&A only (10 per level: Basic/Intermediate/Advanced/Expert), each still with a full answer/why-correct/common-mistakes/follow-up, but skipping the full 15-section template (no Fundamentals/Deep Dive/diagrams/coding exercises/system design/LLD/debugging/case study/PE perspective/revision). Asked explicitly whether this should continue, the user confirmed **"go same way"** — this leaner, Q&A-only format is now the standing default for Module 101 onward, superseding the full 15-section template above, until the user says otherwise. Treat any future request for the fuller, deep-dive template as a one-off exception for that specific module, not a reversion of this default.

## Resolved: top-30, curated-frequency Q&A format (Basic→Expert retained) (2026-07-18)

Later the same day, after Module 110, the user requested a further reduction: "create top 30 q/a per module. form begining to adavance level" — then, when the assistant's first attempt dropped the Expert tier, corrected this: "include expert teir as well. questions as most frequntly asked question/answers." Resolved reading: keep all four levels (Basic/Intermediate/Advanced/Expert), but cap the module at **30 Q&A total, curated for real-world interview frequency** rather than a mechanical 10-per-level pad — i.e., the 30 questions included at each level should be the ones most commonly actually asked, not padded to a fixed per-level count for its own sake. Default working split (adjustable per module if the real frequency distribution warrants it): **8 Basic / 8 Intermediate / 7 Advanced / 7 Expert**. Each question still carries a full Question/Answer/Why-correct/Common-mistakes/Follow-up. This supersedes the 40-Q&A (10-per-level) format above for **Module 111 onward**, until the user says otherwise. Modules 101–110 stand as-is under the prior 40-Q&A format — no retrofit, per the same no-retrofit precedent set for the Modules 1–78 template gap.
