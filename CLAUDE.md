# Interview Questions — Principal/Staff/Architect Prep Program

## How to read this file
This file has two parts:
- **§A Current Standing Spec** — the authoritative rules in effect *right now*. If you only read one section, read this one.
- **§B Decision History** — a chronological changelog of how §A got here, kept for audit trail and to preserve no-retrofit boundaries (i.e., which past modules are exempt from a later rule change). It is not itself a source of current rules — if history and §A ever conflict, §A wins and this file has a bug that should be fixed.

**Always check `00-Roadmap/README.md`'s Progress Log before starting work** — it is authoritative over any module count or "current progress" note anywhere in this file.

---

# §A. Current Standing Spec

## A1. Program identity
A self-paced, interview-grade training program for an engineer with 14+ years of experience in C#/.NET/SQL Server/AWS/Azure/Microservices preparing for interviews. **Primary target roles: Principal Engineer and Software/Solutions/Enterprise Architect.** Staff Engineer and Engineering Manager material is covered as an adjacent, related track (Domain 45 on the map below, which lives in the `51-Engineering-Leadership` folder — see A3), not the program's main focus.

**Target bar:** the Elite FinTech Interview Panel (§A2) — Principal/Staff/Senior-Staff Engineer, Software/Enterprise Architect, and Engineering Director hiring standards at the world's leading investment banks, asset managers, payments companies, and capital-markets/financial-data firms.

**Teaching style:** practical, production-oriented, interview-focused, deeply technical.
- Explain every concept from first principles; never give shallow or generic answers, never skip internals, never ignore trade-offs/production realities, never assume prior knowledge without explanation.
- Use production examples, diagrams where useful, and multi-approach trade-off comparisons; mention performance/security/scalability implications even though they no longer get standalone sections (see A6); include interviewer follow-up questions, enterprise best practices, and anti-patterns.
- Reference modern .NET 8/9, C# 13+, current AWS/Kubernetes, and current AI-engineering practice where relevant.

## A2. Elite FinTech Interview Panel — standing interview-question lens
Every module's Interview Questions section (and every Interview Mode / Mock Interview / Architecture Review / Code Review session) is written and conducted as if by an Elite Financial Technology Interview Expert Panel — Distinguished Engineers, Principal Engineers, Staff Engineers, Software Architects, Engineering Directors, and Hiring Managers from the world's leading financial institutions and fintech companies. Standing since Module 116; **Modules 1–115 are not retrofitted.**

**Represented organizations** (question style, depth, and evaluation criteria must plausibly match real interviews at these firms):
- **Investment Banking:** J.P. Morgan Chase, Goldman Sachs, Morgan Stanley, UBS, Citi, Barclays, Deutsche Bank, HSBC, Wells Fargo, Bank of America, Standard Chartered
- **Asset Management:** BlackRock, Fidelity Investments, BNY Mellon, State Street, Northern Trust
- **Payments & FinTech:** Visa, Mastercard, PayPal, Stripe, American Express, Capital One, Fiserv, FIS, Broadridge
- **Capital Markets & Financial Data:** Nasdaq, CME Group, LSEG, Moody's, S&P Global

**Standing requirements for every module's interview content:**
- Assume the candidate has 14+ years of experience; expect architecture-level thinking and technical leadership, not textbook recall.
- Production scenarios, System Design/LLD sections, Production Debugging incidents, and Architecture Decisions should draw on realistic financial-services domain contexts where it fits naturally (payment processing, trade settlement, ledger/reconciliation, fraud detection, regulatory reporting, market-data pipelines, core banking) — alongside, not replacing, general enterprise scenarios, and never forced where a topic is domain-agnostic (e.g., pure C#/language-internals questions don't need an artificial fintech wrapper).
- Every Interview Question includes: Question, Ideal Answer, Why this answer is correct, Common mistakes, Possible follow-up questions — plus, where relevant, an implicit sense of what separates an excellent answer from an adequate one at this bar.
- Account for the regulatory/compliance/resilience/auditability/security weight these firms place on production systems (SOX/PCI-DSS/data-residency awareness, five-nines-adjacent availability, strict change-management/audit-trail culture) wherever a topic touches production systems — woven in where genuinely relevant, not forced into every module.
- This lens does not change module scope, count, or the one-topic-at-a-time workflow — only the flavor/calibration of content within whatever template is currently in effect (A5).

## A3. Domain coverage map (current, post-merge)
Each domain is covered Beginner → Intermediate → Advanced → Expert. Folder numbers match the roadmap's directory tree. This list reflects the **current** structure after the two 2026-07-19 domain mergers (A3a) — it is the live map, not the original 55-item list.

1. C# — 2. .NET/ASP.NET Core — 3. REST APIs — 4. SQL Server — 5. PostgreSQL — 6. MongoDB — 7. Redis — 8. DynamoDB — 9. OOP — 10. SOLID — 11. Design Patterns — 12. Data Structures — 13. Algorithms — 14. System Design — 15. Low-Level Design — 16. Distributed Systems — 17. Microservices — 18. Event-Driven Architecture — 19. Kafka — 20. RabbitMQ — 21. AWS — 22. Azure (comparative vs. AWS) — 23. Kubernetes — 24. Docker — 25. DevOps — 26. CI/CD — 27. Observability — 28. Security — 29. Performance Engineering — 30. Architecture Patterns — 31. Domain-Driven Design — 32. Clean Architecture — 33. Hexagonal Architecture — 34. CQRS — 35. Event Sourcing — 36. Saga — 37. Outbox — 38. API Gateway — 39. Service Mesh — 40. Identity & Access Management — 41. OAuth2/OIDC/JWT/PKCE — 42. Angular (comparative vs. React) — 43. React (comparative vs. Angular) — **44. AI Systems** *(consolidated: Fundamentals, Prompt Engineering, RAG, LLM Integration, AI Agents, MCP — vector-database mechanics folded into RAG rather than a standalone module — plus a Capstone; originally scoped at 7 modules, re-scoped to 12 by the gap-fill pass — see A8/A9)* — **45. Engineering Leadership** *(consolidated: Technical Leadership, Staff+ Engineering, Principal Engineering, Software Architecture, Engineering Management; lives in the `51-Engineering-Leadership` folder — the folder keeps the original pre-merge number 51, so the map number and the folder number differ here and only here. Scoped autonomously per A4 at 6 modules: a combined overview plus one module per merged thread — Modules 169–172 and 187–188)*.

Some domains are explicitly comparative against an already-covered sibling (Azure↔AWS, Angular↔React established this pattern) — apply the same treatment to any future domain with a clear sibling already covered: map concepts and flag genuine divergences rather than re-deriving fundamentals from scratch.

**Ad hoc additions (outside the original 55-item list):**
- **56. LINQ & EF Core** — added 2026-07-29 on explicit request, full depth, own folder (`56-LINQ-EFCore`). Not a merge or a split of an existing domain — a genuinely new addition to the map. Scoped at 3 modules: 174 (LINQ deep dive) and 189 (EF Core internals) are written; **190 (EF Core in practice — performance, concurrency, transactions, bulk work, testing, migrations) is still open** and is forward-referenced by both.

Treat any future explicit request for a topic outside the original 55-domain list the same way: add it to this map with its own next-available folder number and a one-line "added [date] on explicit request" note, rather than folding it into an existing domain or silently omitting it from this file.

### A3a. Domain merge rationale (context, not actionable)
Original folders 44–50 (AI Systems, RAG, MCP, AI Agents, Vector Databases, LLM Integration, Prompt Engineering) were merged into one `44-AI-Systems` folder on 2026-07-19; folders 45–50 will not be created separately. Original folders 51–55 (Technical Leadership, Staff+ Engineering, Principal Engineering, Software Architecture, Engineering Management) were merged the same day into one `51-Engineering-Leadership` folder; folders 52–55 will not be created separately. See §B for the full history of these decisions.

## A4. Workflow rules
- **No stop-and-wait.** From Module 119 onward: complete the bookkeeping for one module (write file, update Progress Log) and proceed directly into the next module in the same turn, continuing across turns without needing the literal word "Next." Still generate one module at a time as a discrete unit (don't interleave two modules' content). Still stop to report if genuinely blocked (missing information, a real ambiguity only the user can resolve) — never pause as a mere courtesy checkpoint.
- **Autonomous scoping.** For a brand-new domain with no pre-set module count, pick a sensible default scope autonomously (match the pattern of similar already-scoped domains — e.g., 2 modules where substantial groundwork already exists via previews, 3–4 for a genuinely fresh domain) and proceed. Only ask if scope is genuinely, materially ambiguous in a way no reasonable default can resolve. This extends to structural decisions like domain merges/splits, not just per-domain module counts — prefer direct action over `AskUserQuestion`-style clarification for this class of decision.
- **On every module completion:** (1) write the module file under the correct domain folder; (2) append a Progress Log entry to `00-Roadmap/README.md` in the established style: `✅ **Module N**: Domain → Subtopic — [link] (one-line note on comparative angle / key finding / incident)`, with a **domain complete (Modules X–Y)** note when a domain wraps up.
- **Every module opens with:** `> Domain: ... | Level: Beginner → Expert | Prerequisite: [[...]]` linking back to the specific prior modules it builds on or compares against.
- **Cross-module synthesis is the point, not a nice-to-have.** Later modules within a domain, and later domains that revisit a concept (e.g., Kubernetes revisiting AWS/Azure container material), should explicitly reference specific prior modules by number/section. Recurring failure patterns across modules (e.g., "object presence ≠ enforced reality" recurring across K8s Modules 74/75/76) should be named explicitly when they recur. Capstone modules should synthesize a domain's full arc rather than standing alone.
- **No-retrofit is the default posture.** When a template/format/scope rule changes, it applies forward from a named module number; prior modules stand as-is unless the user explicitly asks to rework a *specific* past module (treat that as a one-off, not a signal to retrofit the backlog). The one exception to date is the 2026-08-31 §5/§6/§7/§8/§9 removal, which was an explicit repo-wide retrofit (see §B) — treat any future "for all files" instruction the same way: as an explicit, scoped exception to this default, not a new default.

## A5. Interaction modes
Switchable at any time, on the current topic, instead of advancing:
- **Teaching Mode (default)** — explain concepts deeply, per the module template (A6).
- **Interview Mode** — act exactly like an Elite FinTech Interview Panel interviewer (A2): ask a question, don't help until the user finishes answering, ask follow-ups, challenge weak answers.
- **Mock Interview** — a full 90-minute Principal Engineer interview in the Elite FinTech Panel style, spanning coding, architecture, leadership, behavioral, system design, AWS, microservices, distributed systems, debugging, performance, and security.
- **Architecture Review** — review the user's own architecture like a Principal Engineer: critique every design decision, suggest improvements.
- **Code Review** — review the user's code as a real production pull request, evaluating SOLID and design-pattern usage.

## A6. Current module template
This is the live template as of the 2026-08-31 retrofit. It supersedes every earlier version stated in §B.

| § | Section | Content |
|---|---------|---------|
| 1 | Fundamentals | What / Why / When / How — simple language before advanced concepts |
| 2 | Deep Dive | Internal implementation, runtime behavior, memory usage, threading model, compiler behavior, performance implications, hidden costs, framework internals (§2.1–2.6+ subsections) |
| 3 | Visual Architecture | Mermaid/ASCII diagrams: sequence, flow, component, deployment as applicable |
| 4 | Production Example | Problem / Architecture / Implementation / Trade-offs / Lessons learned (Scenario/Investigation/Root cause/Fix/Lesson framing is fine as the concrete vehicle) |
| 10 | Interview Questions | 40 total: 10 Basic / 10 Intermediate / 10 Advanced / 10 Expert. Each: Question, Ideal Answer, Why this answer is correct, Common mistakes, Possible follow-up questions. No answer-less question lists. |
| 11 | Coding Exercises | Easy / Medium / Hard / Expert. Each: Problem, Solution, Time complexity, Space complexity, Optimized solution |
| 12 | System Design | Own, fully-authored section — governed by the four-step spine in A7 |
| 13 | Low-Level Design | Requirements, class diagram, sequence diagram, design patterns used, SOLID mapping, extensibility, concurrency/thread safety |
| 14 | Production Debugging | A realistic incident (high CPU, memory leak, deadlock, slow APIs, high latency, Kafka lag, DB blocking, GC pauses, thread-pool starvation, OOM, or similar): Root cause / Investigation / Tools / Fix / Prevention |
| 15 | Architecture Decision | Multiple solutions compared on advantages/disadvantages/cost/complexity/maintainability/performance/scalability/operational overhead; recommend one and justify why |
| 17 | Principal Engineer Perspective | Business impact, engineering trade-offs, technical leadership, cross-team communication, architecture governance, cost optimization, risk analysis, long-term maintainability |

**Retired sections — do not author in new modules:** §5 Best Practices, §6 Anti-patterns, §7 Performance Engineering, §8 Security, §9 Scalability, §16 Enterprise Case Study, §18 Revision.

**Numbering is deliberately non-contiguous** (jumps at §4→§10 and §15→§17) so that thousands of existing cross-module references (e.g., "Module 82 §2.2," "per §12") stay valid across every historical renumbering event. Do not compact the numbering.

**Where retired-section content still belongs:** performance, security, and scalability material is not banned from the course — weave it into §2 Deep Dive, §12 System Design, §14 Production Debugging, and §15 Architecture Decision wherever the topic genuinely calls for it. §13/§14's relationship to §7/§8/§9 is "cross-reference the design decision, don't repeat it" (see A7's note on this).

**Per-module template history (no-retrofit boundaries — see §B for full narrative):**
- Modules 1–78: compressed template (30 Q&A, §12–17 collapsed to a pointer) — not retrofitted.
- Modules 79–100: full 15-section template with §7/8/9 present (as originally specified) — later stripped of §7/8/9 only by the 2026-08-31 retrofit.
- Modules 101–110: leaner 40-Q&A-only format (no Fundamentals/Deep Dive/diagrams/exercises/System Design/LLD/debugging/case study/PE perspective/revision).
- Modules 111–117: top-30 curated-frequency Q&A format (8 Basic/8 Intermediate/7 Advanced/7 Expert default split), full 4/5-part answers retained.
- Modules 118–179: current 16-section template (this table, minus the four-step System Design standard, which starts at 180).
- Modules 180+: current 16-section template **with** the four-step System Design standard (A7) applied to §12.
- **Variant-2 gap-fill files (A9) are not modules and do not use this template at all.** They run a shorter §1–§4/§5 form and are logged as unnumbered blocks. To date: the 5 `01-CSharp` files and the 2 `02-DotNet-AspNetCore` files, all added 2026-09-03.
- **As of the 2026-08-31 repo-wide retrofit, no module anywhere in the repo — regardless of which era above it was written in — retains standalone §5/6/7/8/9 sections.** That retrofit is the one exception to the no-retrofit default and applies uniformly across all eras. All *other* per-era differences (Q&A count/format, presence of Fundamentals/Deep Dive/etc.) remain un-retrofitted and should be left alone.

## A7. System Design authoring standard ("Pragmatic Engineer payment-system" depth)
Every System Design treatment in this repo — both §12 of any module and every module in `14-System-Design/` — follows the four-step structure and depth of the *Pragmatic Engineer* "Designing a Payment System" chapter (System Design Interview Vol. 2). Standing format requirement, not a one-off. **Applies to Module 180 onward, plus every future `14-System-Design/` module regardless of number. Modules 1–179 are not retrofitted** (a request to rework a specific past module is a one-off, not a backlog signal).

**Mandatory four-step spine (use these exact step headings):**

1. **Understand the Problem and Establish Design Scope.** Open with a real candidate↔interviewer Q:/A: dialogue that narrows an intentionally vague prompt — users, in-scope flows, explicit out-of-scope, single- vs. multi-region, single- vs. multi-currency, what's delegated to third parties. Then: Functional requirements (list), Non-functional requirements (list), Back-of-the-envelope estimation with arithmetic shown (e.g., 1,000,000/10^5 = 10 TPS), ending in an explicit statement of what the numbers imply is the *actual* hard problem (e.g., 10 TPS ⇒ correctness, not throughput, is the design driver). Never skip that concluding implication — it's what separates Staff-level framing from Senior-level.
2. **Propose High-Level Design and Get Buy-In.** Name the core flows and treat them separately (e.g., pay-in/pay-out). Then, in order: a component-by-component glossary defining every box in plain language before any diagram; the architecture diagram; a numbered end-to-end operational walkthrough tracing one request through every box; REST API design with concrete endpoints and request/response parameter tables (field/type/description); the data model as real table schemas (column/type/description) with status lifecycles spelled out (e.g., `NOT_STARTED → EXECUTING → SUCCESS | FAILED`). Every non-obvious modelling choice states its rationale inline (e.g., "store amount as a string, not a double"; "prefer a boring ACID relational database over NoSQL — stability, tooling, DBA availability beat benchmark numbers here"). Third-party/vendor integration boundaries (e.g., hosted-payment-page/PCI-scope decisions) belong here, not deferred.
3. **Design Deep Dive** (the bulk of the section). Happy path → failure, in this order where applicable: external-provider integration (direct-API and delegated-hosting variants, full numbered flow including token/nonce/redirect-URL vs. webhook-URL); reconciliation against externally-supplied truth (nightly settlement files, break classification into automatable/manual/investigate — reconciliation is still required even when the external party claims idempotency); handling processing delays (pending states, webhook vs. polling); internal service communication (synchronous cost, single-receiver queue vs. multi-receiver log); handling failed operations (retryable vs. non-retryable classification, retry queue, DLQ, append-only state); exactly-once delivery stated as the identity **exactly-once = at-least-once AND at-most-once**, with retry strategies (immediate/fixed/incremental/exponential backoff/cancel) for the first half and idempotency keys for the second, worked through ≥2 concrete scenarios (double submit; response lost after external side succeeded); consistency (stateful services, internal vs. external consistency, replication lag, primary-only vs. consensus-store); security. Each deep-dive topic carries a diagram or worked trace, not just prose.
4. **Wrap-Up.** Explicitly list what wasn't covered and would be the natural next questions — monitoring metrics that matter, alerting, debugging tooling, multi-currency/multi-region, regional variation, additional integrations — plus a closing summary diagram of the whole system.

**References.** Close every System Design section with a numbered reference list (vendor docs, engineering blogs, papers, standards).

**Depth calibration:** concrete over abstract everywhere — real endpoint paths, real field names/types, real table columns, real status enums, real header names (e.g., `Idempotency-Key`), real numbers with arithmetic shown, real third-party names (Stripe, Adyen, Twilio, APNs), and a stated reason for each choice. Six paragraphs of prose naming components does not meet this bar. In a `14-System-Design/` module, §12 is the file's centre of gravity and should be its largest section.

**Interaction with A6:** the four-step spine governs §12 only; §1–4 and §13–15/17 stay exactly as specified in A6. Where §12's four-step treatment would duplicate §13 (LLD) or §14 (Production Debugging), §12 states the decision and cross-references rather than repeating.

## A8. Current progress snapshot (context only — README Progress Log is authoritative)
**All 45 effective domains plus the ad hoc `56-LINQ-EFCore` are complete or near-complete; 188 numbered modules are logged (1–187, 189), plus two unnumbered gap-fill blocks.** The arc, in order:

- **Modules 1–104** — core fundamentals: language, framework, data layer, OOP/SOLID/patterns, DS&A, system design, distributed systems, microservices, EDA, messaging, cloud, containers, delivery, observability, security, performance.
- **Modules 105–128** — `30-Architecture-Patterns` through `38-API-Gateway`.
- **Modules 129–134** — buy-side System Design extension.
- **Modules 135–149** — Distributed Systems / Microservices / EDA depth extensions.
- **Modules 150–161** — `39-Service-Mesh` through `43-React` (42/43 written as an explicit comparative pair).
- **Modules 162–168, 181–185** — `44-AI-Systems`, **12 modules total**, re-scoped up from the original 7-module plan as audit gaps surfaced (A9). *(Earlier revisions of this file said "14 modules"; that was an arithmetic error — 7 + 1 + 4 = 12, and the folder holds 12 files.)*
- **Modules 169–172 and 187–188** — `51-Engineering-Leadership`, scoped at 6 modules: 169 combined overview, 170 Technical Leadership, 171 Staff+, 172 Principal, 187 Software Architecture as a role, **188 Engineering Management — still open**.
- **Modules 173–180, 186** — assorted: 173 Microservices/AWS load balancing; 174 + 189 LINQ & EF Core (**190 still open**); 175–180 System Design (180 is the first module under the A7 four-step standard); 186 Design Patterns GoF completion.
- **Unnumbered gap-fill blocks (2026-09-03)** — 5 files added to `01-CSharp` (folder now 13 files) and 2 files added to `02-DotNet-AspNetCore` (folder now 8 files), both under A9 variant 2.

**Two modules are named-but-unwritten** and are forward-referenced by already-published files, so they are the natural next work: **188** (Engineering Management) and **190** (EF Core in practice). Both are listed under "Open items" at the end of the README.

**Non-module files in the repo:** `14-System-Design/README.md` is a domain-local index mapping each System Design module to the interview question class it answers; `agent.md` at the repo root holds the FinTech Interview Reviewer persona used for audit/improvement passes, and is separate from the authoring rules in this file.

## A9. Coverage-audit / gap-fill content track
A second content-production pattern has emerged alongside the main numbered-module sequence: periodically auditing an **already-complete** domain against real interview-frequency terms and adding modules or files to close what the audit finds missing. This is additive to a finished domain, not a rewrite of it — it does not conflict with the no-retrofit default in A4, since nothing already-written is touched.

Two variants have appeared so far, and both are legitimate — use whichever fits the situation:

1. **Full-depth gap-fill, numbered as ordinary Modules.** Used for `14-System-Design/` (Modules 179–180) and `44-AI-Systems/` (Modules 181–185, which also triggered re-scoping the domain from 7 to 14 modules — see A4's autonomous-scoping rule). These get a normal `✅ **Module N**` Progress Log entry, follow the full current module template (A6, including the A7 four-step System Design standard where applicable), and are indistinguishable in the log from the main sequence except for a parenthetical note explaining what gap they close and why.
2. **Lighter-weight gap-fill, logged as an unnumbered block.** Used twice, both on 2026-09-03: the `01-CSharp` extension (5 new files — threading/memory-model, collections/BCL internals, resource management/nullability, reflection/source generators, strings/encoding/globalization) and the `02-DotNet-AspNetCore` extension (2 new files — real-time/SignalR/WebSockets/SSE, gRPC/service-to-service contracts). These use a shorter §1–§5 template — §1 Topic Description (Definition / Core sub-concepts / Where it fits / Why it matters at scale / Common pitfalls), §2/§3/§4 Beginner/Intermediate/Expert-Architect Q&A (10 each, `**Q<N>.**`/`**A:**`/`*Follow-up:*` form), §5 Reference Material (omitted on new files) — not the A6 template, and are logged as a single dated `### Coverage-gap closure: ...` heading in the README rather than individual Module-N entries.

**When to use which:** default to variant 1 (full A6 template, numbered Module) unless the user explicitly asks for a lighter/quicker fill of a narrow, well-scoped gap in an existing folder — in which case variant 2's shorter template and block-logging convention are the established precedent, not a one-off deviation. Either way, open a gap-fill effort by naming the specific audit method (e.g., a term-frequency probe against the folder, or a review against the target interview panel) and the specific terms/topics found missing, the same way the 2026-09-03 C# entry and the AI-Systems/System-Design audits did — this is what distinguishes a deliberate gap-fill from scope creep.

---

# §B. Decision History (changelog — not a source of current rules)

Entries are dated and terse; see A-sections for the rules they produced. Each entry's no-retrofit boundary (which modules are exempt) is the operative part if you're ever asked to touch old modules.

- **2026-07-17 (a) — Template-gap decision.** Modules 1–78 used a compressed template (30 Q&A instead of 40; §12–17 collapsed to a pointer). Not retrofitted; full spec applies verbatim from Module 79.
- **2026-07-17 (b) — §7/§8/§9 removed (first time).** Standalone Performance Engineering/Security/Scalability sections retired from the template; folded into §2/§5/§6/§12. Numbering not compacted (kept §6→§10 gap) to preserve cross-references. A planned "Additional Q&A block" append was proposed and then explicitly reversed the same day — never implemented.
- **2026-07-18 (a) — No more waiting for "Next."** User: "why keep asking next. please go ahead." → produced A4's no-stop-and-wait rule, standing from Module 119.
- **2026-07-18 (b) — Elite FinTech Interview Panel lens established.** Produced A2, standing from Module 116; Modules 1–115 not retrofitted.
- **2026-07-18 (c) — Leaner Q&A-only format (temporary default).** Module 100 authored per explicit request as 40 Q&A only, no full template. Confirmed as the new default for Module 101+ — later superseded by (e) below.
- **2026-07-18 (d) — Top-30 curated-frequency format (temporary default).** After Module 110: capped at 30 Q&A (curated for real-world frequency, not padded), default split 8/8/7/7 across Basic/Intermediate/Advanced/Expert. Applied Modules 111–117; not retrofitted. Superseded same day by (e).
- **2026-07-18 (e) — Reversion to 16-section template — became A6.** After Module 117, user pasted a trimmed §1–§18 template (dropping §16 Enterprise Case Study and §18 Revision) twice, then said "next." Read as a deliberate reversion to the fuller template in this trimmed 16-section form. Current from Module 118. Modules 111–117 not retrofitted.
- **2026-07-19 — Domain 39–50 sequencing, and the two consolidation mergers — became A3/A3a.** Sequenced through 39-Service-Mesh → 43-React (Modules 150–161). Two direct-instruction mergers followed, each after the assistant's clarification attempts via `AskUserQuestion` were declined: (i) folders 44–50 → single `44-AI-Systems` folder, scoped and grouped autonomously; (ii) folders 51–55 → single `51-Engineering-Leadership` folder (name illustrative), same treatment, not yet started. Mid-Module-164, a further instruction dropped Vector Databases as a standalone module, re-scoping 44-AI-Systems to 7 modules (vector-search mechanics folded into RAG). Modules 162–163 not retrofitted by the re-scope.
- **2026-08-09 — Four-step System Design standard — became A7.** Direct instruction to use the *Pragmatic Engineer* payment-system chapter as the reference depth/structure for all System Design content. Applies Module 180+ and all future `14-System-Design/` modules; Modules 1–179 not retrofitted.
- **2026-07-29 — 56-LINQ-EFCore added ad hoc — became A3's "ad hoc additions" note.** Explicit request for LINQ + EF Core at full depth, outside the original 55-domain list. Given its own folder and next-available number rather than folded into an existing domain.
- **2026-09-03 (and preceding gap-fill modules) — coverage-audit/gap-fill track emerged — became A9.** Starting with System Design Modules 179–180 and continuing through the AI-Systems 181–185 gap-fill (which re-scoped that domain from 7 to 14 modules) and the Design Patterns GoF-completion module (186), a pattern of auditing already-complete domains and adding modules to close discovered gaps became a recurring, legitimate second track. On 2026-09-03 this pattern appeared in a new, lighter form: 5 files added to the already-complete `01-CSharp` folder using a shorter §1–§5 template and logged as a single unnumbered block rather than individual Modules. Both variants are additive to finished work, not a retrofit, so neither conflicts with the no-retrofit default.
- **2026-08-31 — §5/§6/§7/§8/§9 removed repo-wide — became A6's current table.** Direct instruction: "remove Best Practices, Anti-Patterns, Performance Engineering, Security, Scalability for all files in each folder." Explicit exception to the no-retrofit default, because the instruction named all files, not just future ones. Executed as a scripted pass over every `*.md` under domain folders (excluding `00-Roadmap/` and this file), deleting each matching top-level section through to the next `## <n>.` heading, plus orphaned `---` separators. 185 files changed, ~10,800 lines removed; CRLF preserved; zero matching headings remained after. Numbering again left non-contiguous (now jumps §4→§10) for the same cross-reference-stability reason as 2026-07-17(b).

- **2026-09-03 — consistency audit of `CLAUDE.md` + `00-Roadmap/README.md` against the repo on disk.** Direct instruction to review both files and fix any gap. No rule changed; this was a bookkeeping-and-integrity pass, so nothing here is a new standing rule. What it found and fixed:
  - **Two duplicate module numbers.** `51-Engineering-Leadership/05` (authored 2026-07-26) and `56-LINQ-EFCore/02` (2026-07-29) were written but never logged, and Modules 173 and 175 were later assigned to different files. Because the README Progress Log is authoritative, the *logged* files kept 173/175 and the two orphans were renumbered to **187** and **189**, with their internal forward references (to a planned 174/176) rebased to **188** and **190**. Cross-references elsewhere in the repo were checked first and all pointed at the logged modules, so nothing else needed rewriting.
  - **14 Progress Log entries had lost their file links** (Modules 67, 88, 92, 96, 100, 104, 108, 112, 147, 157, 159, 160, 167, 175) and 6 of those had truncated titles — damage consistent with an earlier scripted pass. Restored from each file's own H1.
  - **~24 broken wiki-style prerequisite links** across 16 files: prerequisite pointers naming files that never existed under that name, plus several carrying a `.md` suffix the convention omits. Repaired to real targets. Bare folder links (e.g. `[[../40-IAM]]`) were left as deliberate domain-level pointers.
  - **Stale claims corrected:** `51-Engineering-Leadership` was described as "not yet started" in three places despite being 5 files deep; `44-AI-Systems` was recorded as "14 modules" in three places when it is 12 (7 + 1 + 4); Module 168's log entry claimed the domain closed there and Module 169's claimed the leadership domain closed there, both contradicted by later entries.
  - **Two never-logged files surfaced:** `02-DotNet-AspNetCore/07` and `/08` are A9 variant-2 gap-fill files with no Module number and no log entry. Logged as a dated unnumbered block, matching the `01-CSharp` precedent.
  - **Two named-but-unwritten modules surfaced:** 188 (Engineering Management) and 190 (EF Core in practice), each already forward-referenced by a published file. Recorded under "Open items" in the README rather than left as dangling pointers.
  - **Precedent set:** when a file's H1 module number and the README Progress Log disagree, the Progress Log wins and the *unlogged* file is renumbered — never the logged one, because cross-module references throughout the repo are written against logged numbers.

**Precedent this history establishes for future changes:** default to no-retrofit (apply forward from a named module); treat "for all files"/"repo-wide" phrasing as the explicit signal needed to retrofit; record any future format reversal or retrofit as a new dated §B entry rather than a silent assumption, and update the relevant A-section in the same edit so §A never goes stale again.
