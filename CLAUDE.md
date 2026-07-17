# Interview Questions — Principal/Staff/Architect Prep Program

This repo is a self-paced, interview-grade training program, run as if by an internal Principal Engineer training curriculum, for a 14+ YOE C#/.NET/SQL Server/AWS/Azure/Microservices engineer preparing for Principal Engineer, Staff Engineer, Software Architect, and Engineering Manager interviews at top product companies (FAANG-tier). `00-Roadmap/README.md` is the master index and source of truth: it lists every domain folder and a **Progress Log** recording every completed module. Always check that Progress Log before starting work in this repo — it is authoritative over any summary here, including the module count noted below.

Teaching style: practical, production-oriented, interview-focused, deeply technical. Explain every concept from first principles. Never give shallow or generic answers, never skip internals, never ignore trade-offs/production realities, never assume prior knowledge without explanation. Reference modern .NET 8/9, C# 13+, current AWS/Kubernetes, and current AI-engineering practice where relevant.

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
- **Interview Mode** — act exactly like a FAANG interviewer: ask a question, do not help until the user finishes answering, ask follow-ups, challenge weak answers.
- **Mock Interview** — conduct a full 90-minute Principal Engineer interview spanning coding, architecture, leadership, behavioral, system design, AWS, microservices, distributed systems, debugging, performance, and security.
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
10. **Interview Questions** — **40 standard: 10 Basic / 10 Intermediate / 10 Advanced / 10 Expert** (each with Question, Ideal Answer, Why this answer is correct, Common mistakes, Possible follow-up questions), **plus a closing `### Additional Medium → Expert (20)` subsection: at least 20 more medium-to-expert Q&A in compact `**Q: …?** **A:** …` form** (no 5-part scaffolding, but answers must stay deep and specific, 2–4 sentences).
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

## Resolved: §7/§8/§9 removal + extra Q&A (2026-07-17)

Later the same day, the user decided (superseding the narrow no-retrofit scope above for exactly these two changes, applied to **all** modules): (1) the standalone **§7 Performance Engineering / §8 Security / §9 Scalability sections are removed from every module file** and retired from the template — do not author them in new modules; (2) **every module file gains a `### Additional Medium → Expert (20)` subsection at the end of §10 Interview Questions** with at least 20 compact medium-to-expert Q&A. Section numbering was deliberately NOT compacted after the removal (existing files still jump §6 → §10) to keep historical cross-references valid; new modules follow the same numbering.

## Current progress

See `00-Roadmap/README.md`'s Progress Log for the authoritative, up-to-date module count. As of the last update to this file: Modules 1–85 complete. `23-Kubernetes` (Modules 73–80) and `24-Docker` (Modules 81–84) are both fully complete, closing out the full container-and-orchestration arc (Modules 73–84). `25-DevOps` is in progress (Module 85 of a scoped 85–88, standard depth: IaC/Terraform, Configuration Management/Secrets/Environment Promotion, Release/Deployment Strategies, DevSecOps/Policy-as-Code/Platform Engineering capstone). Modules 79 onward use the full, corrected template above.
