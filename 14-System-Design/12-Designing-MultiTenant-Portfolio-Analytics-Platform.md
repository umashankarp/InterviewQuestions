# Module 132 — System Design: Designing a Multi-Tenant Portfolio Analytics Platform

> Domain: System Design | Level: Beginner → Expert | Prerequisite: [[09-Designing-RealTime-Portfolio-Risk-Engine]] (the compute-grid and reproducibility disciplines this platform exposes to external clients), [[../37-Outbox/02-Capstone-SharedMultiTenantOutboxRelayPlatform]] (per-tenant isolation, dedicated capacity, and the noisy-neighbour finding, which this module escalates from internal teams to paying external clients), [[../38-API-Gateway/01-APIGatewayFundamentals-Routing-RateLimiting-AuthEnforcement-Transformation.md]] (tiered rate limiting and defence-in-depth authorization)
>
> **Scenario-module note:** Fourth of six buy-side/capital-markets system-design scenarios (Modules 129–134). Full 16-section template; Elite FinTech Interview Panel lens.

---

## 1. Fundamentals

**What:** A platform that runs portfolio analytics — performance attribution, exposure decomposition, scenario analysis, factor risk — on behalf of many independent institutional clients, each of whom sees only their own data, on shared infrastructure. This is the shape of Aladdin, Charles River, and similar buy-side platforms: one codebase and one operational estate serving competing asset managers simultaneously.

**Why:** The alternative — a separate deployment per client — multiplies operational cost by client count and makes a platform improvement a per-client rollout project. Multi-tenancy is what makes a platform business viable. But the tenants here are frequently **direct competitors**, and the data is their positions and strategies, so isolation is not a hygiene property but the product's core promise. A cross-tenant leak is not an incident; it is an existential event for the platform's business.

**When:** From the first external client. Retrofitting tenancy onto a single-tenant system is among the most dangerous migrations in this course, because the isolation boundary must be enforced everywhere and the failure of any single enforcement point is sufficient — works this decision.

**How (30,000-ft view):**
```
Tenant A ──┐
Tenant B ──┼──► API (tenant-scoped auth) ──► Analytics Engine ──► Tenant-partitioned stores
Tenant C ──┘ │
 Shared compute, isolated capacity
 Shared code, isolated data
```

---

## 2. Deep Dive

### 2.1 The Isolation Spectrum and Where to Sit on It
Multi-tenancy is not binary. The realistic options, in increasing isolation and cost:

- **Shared everything, row-level tenant discriminator.** One database, a `TenantId` column, every query filtered. Cheapest, densest — and one missing `WHERE TenantId = @t` is a cross-tenant leak.
- **Shared infrastructure, separate schemas/databases per tenant.** Isolation enforced at the connection level rather than in every query. More operational overhead; a leak requires connecting to the wrong database, which is a much rarer and more visible bug class.
- **Separate infrastructure per tenant.** Strongest isolation, highest cost, loses most multi-tenancy benefit.

The critical insight is that these differ in **what kind of mistake causes a leak**. Row-level requires every query to be correct forever; connection-level requires the connection routing to be correct once per request. Reducing the number of places a mistake is possible is worth more than it appears, because the cost of the mistake here is unbounded.

### 2.2 Defence in Depth for Tenant Isolation
No single mechanism should be load-bearing. A robust design layers:

1. **Authentication/authorization** establishing tenant identity at the edge.
2. **Ambient tenant context** propagated through the call stack, never passed as an optional parameter a caller can forget.
3. **Data-layer enforcement** — connection routing or a query interceptor that *fails closed* if tenant context is absent, rather than returning unfiltered results.
4. **Storage-level enforcement** — database row-level security or per-tenant credentials, so even a compromised application layer cannot read across tenants.

The design principle throughout: an unset tenant context must produce an error, never an unscoped query. The default must be *deny*, because the failure mode of defaulting to *allow* is silent and catastrophic.

### 2.3 Noisy Neighbours in an Analytics Workload
Earlier analysis established the noisy-neighbour risk for a shared relay pool. Analytics escalates it, because the workload is far heavier and more variable: one tenant running a large scenario analysis can consume enormous compute, and unlike the relay case, this is *legitimate use* — the tenant is doing exactly what they pay for.

This makes the problem harder than the case, where the offending tenant was in a degraded state. Here the mitigation cannot be "prevent the abnormal condition" but must be structural: per-tenant compute quotas, fair-share scheduling, and priority tiers matched to commercial tiers — the platform must degrade gracefully and *predictably per tenant* under contention rather than letting whoever submits the largest job win.

### 2.4 Tenant-Specific Configuration Without Forking the Code
Institutional clients want their own factor models, their own accounting conventions (multiple valid ways to compute performance attribution), their own reporting formats. The failure mode is per-tenant code branches, which eventually make every change a per-tenant regression risk.

The discipline, directly the genuine-commonality triage: configuration and well-defined extension points for genuine variation; shared core for everything else; a triage process determining which a given request is. A tenant-specific request that cannot be expressed as configuration or a plugin should be pushed back on, not accommodated in the core.

### 2.5 The "Whose Bug Is It" Problem
When a tenant reports wrong analytics output, the cause is roughly equally likely to be a platform defect, the tenant's own input data, or a tenant-specific configuration choice. Unlike a single-tenant system, the platform team cannot simply inspect the data — it belongs to the client, may be commercially sensitive, and support staff should not have blanket access to it.

This shapes the design: the platform needs **tenant-scoped diagnostic tooling** that lets support reason about a calculation without reading raw positions — intermediate-value inspection, calculation-step traces, and input *summaries* rather than raw data. Building this late, after a support burden has already accumulated, is a common and expensive mistake.

### 2.6 Onboarding, Data Migration, and the Long Tail
Each new institutional client arrives with historical data in their own format, their own instrument identifiers, and their own expectations about what history must be available on day one. Onboarding is therefore a data-migration project per client, not a provisioning step — and it is where most of the platform's per-client cost actually lives.

The scalable answer is investment in **canonical ingestion**: well-specified formats, validation with actionable errors, and automated reconciliation confirming migrated history reproduces the client's own reported figures. That last check is what converts onboarding from a trust exercise into a verified one, and its absence is why onboarding disputes are common.

---

## 3. Visual Architecture

```mermaid
graph TB
 TA[Tenant A] --> GW[API Gateway<br/>tenant-scoped auth]
 TB[Tenant B] --> GW
 TC[Tenant C] --> GW
 GW --> CTX[Tenant Context<br/>ambient, fail-closed]
 CTX --> API[Analytics API]
 API --> SCHED[Fair-Share Scheduler<br/>per-tenant quotas]
 SCHED --> POOL_A[Compute: Tenant A quota]
 SCHED --> POOL_B[Compute: Tenant B quota]
 SCHED --> POOL_C[Compute: Tenant C quota]
 POOL_A --> DA[(Tenant A store)]
 POOL_B --> DB[(Tenant B store)]
 POOL_C --> DC[(Tenant C store)]
 CTX -.tenant context required.-> DA
 CTX -.tenant context required.-> DB
 CTX -.tenant context required.-> DC
```

```mermaid
sequenceDiagram
 participant C as Client
 participant GW as Gateway
 participant S as Service
 participant D as Data Layer

 C->>GW: Request + credentials
 GW->>GW: Resolve tenant from credentials (not from request body)
 GW->>S: Forward with tenant context
 S->>D: Query (tenant context ambient)
 alt Tenant context absent
 D-->>S: THROW — never an unscoped query
 else Present
 D-->>S: Rows scoped to tenant
 end
```

```mermaid
graph LR
 subgraph "Contention: fair-share, not first-come"
 BIG[Tenant A: huge scenario job] --> Q{Scheduler}
 SMALL[Tenant B: small report] --> Q
 Q -->|A's quota| RA[A's share]
 Q -->|B's quota| RB[B's share — unaffected by A]
 end
```

---

## 4. Production Example

**Problem:** A platform serving 40 asset managers ran analytics on a shared compute pool with row-level tenant isolation, defended by a query interceptor injecting the tenant filter automatically.

**Architecture:** the design, with the interceptor as the primary data-isolation mechanism — a deliberate choice, since automatic injection removes the burden of every developer remembering the filter.

**Implementation:** The interceptor injected `TenantId` into queries built through the ORM. A performance-critical attribution query, hand-written as raw SQL for speed, bypassed the ORM — and therefore the interceptor — but included its own explicit tenant filter, correctly, written by a developer who knew the interceptor did not apply.

**Trade-offs:** Automatic injection is genuinely safer than manual filtering for the common path. Its weakness is that it creates an assumption ("queries are filtered") that raw-SQL paths silently violate.

**Lessons learned:** A later optimization added a `UNION ALL` branch to that raw query to include a secondary data source. The new branch's tenant filter was omitted — an ordinary copy-paste omission. The query returned the requesting tenant's data plus, from the secondary source, **all tenants' data** for that dimension. It reached a production report seen by one client before being noticed, because the report's totals were implausibly large.

The isolation model had been sound; what failed was that it was *not uniformly applicable*, and the exception was invisible at the point where the mistake was made — a developer editing that query saw no signal that they were outside the interceptor's protection.

The fix had three parts: (1) storage-level row-level security as a backstop, so the database itself refuses cross-tenant reads regardless of query construction — the defence-in-depth layer prescribes and this system lacked; (2) a test that runs every registered query, under a tenant context, against a database seeded with two tenants' data, asserting no foreign rows are returned — mechanically catching exactly this class of omission; (3) a lint rule flagging raw SQL in the data layer for mandatory review. The generalizable lesson: **a protection mechanism with exceptions is a protection mechanism whose exceptions are where incidents occur**, and the exceptions must be made visible at the point of editing rather than known only to whoever originally wrote them.
## 10. Interview Questions

### Basic (10)

1. **Q: Why is tenant isolation the core product promise rather than a hygiene property here?**
 **A:** Tenants are frequently direct competitors and the data is their positions and strategies; a cross-tenant leak is existential for the platform's business, not merely an incident.
 **Why correct:** Identifies the commercial reality that determines the engineering priority.
 **Common mistakes:** Treating isolation as standard access control of ordinary severity.
 **Follow-ups:** "How does that change the design?" (No single isolation mechanism may be load-bearing,.)

2. **Q: Name the three points on the isolation spectrum and what distinguishes them.**
 **A:** Shared-everything with a row-level tenant discriminator; shared infrastructure with separate schemas/databases; fully separate infrastructure — differing chiefly in *what kind of mistake* causes a leak.
 **Why correct:** Frames the choice by failure mode rather than only by cost.
 **Common mistakes:** Comparing purely on cost and density.
 **Follow-ups:** "What mistake causes a leak at each level?" (A missing query filter; connecting to the wrong database; a network/infrastructure misconfiguration — decreasingly likely and increasingly visible.)

3. **Q: What must happen when tenant context is absent at the data layer?**
 **A:** An error — never an unscoped query. Default deny, because defaulting to allow fails silently and catastrophically.
 **Why correct:** States the specific fail-closed requirement and its rationale.
 **Common mistakes:** Returning unfiltered results when context is missing, which is the exact leak condition.
 **Follow-ups:** "Where should this be enforced?" (At multiple layers — data access and storage — so no single omission is sufficient,.)

4. **Q: Why must tenant identity come from credentials rather than a request parameter?**
 **A:** A request-supplied tenant identifier can be altered by the caller, making cross-tenant access a matter of changing a value — a direct IDOR/BOLA.
 **Why correct:** Names the specific attack the design choice prevents.
 **Common mistakes:** Accepting a tenant ID in the request body for convenience in multi-tenant admin tooling.
 **Follow-ups:** "What about legitimate cross-tenant admin access?" (A separate, heavily-audited path with its own authorization, never the ordinary request path.)

5. **Q: How does the noisy-neighbour problem here differ from the relay case?**
 **A:** There the offending tenant was degraded; here the heavy consumer is doing exactly what they pay for, so the mitigation cannot be preventing an abnormal condition and must be structural — quotas and fair-share scheduling.
 **Why correct:** Identifies why the prior module's framing does not fully transfer.
 **Common mistakes:** Treating heavy usage as abuse to be throttled rather than legitimate load to be scheduled fairly.
 **Follow-ups:** "What does 'degrade predictably per tenant' mean?" (Under contention each tenant gets their share rather than whoever submitted the largest job winning,.)

6. **Q: What is the risk of per-tenant code branches?**
 **A:** Every change becomes a per-tenant regression risk, eventually making the platform unchangeable; configuration and extension points express genuine variation instead.
 **Why correct:** States the specific compounding consequence.
 **Common mistakes:** Accommodating each client request in the core to be responsive, accumulating branches.
 **Follow-ups:** "What determines config versus core?" (the genuine-commonality triage — is this needed by others, or genuinely idiosyncratic?)

7. **Q: Why can't support simply inspect tenant data when investigating a reported issue?**
 **A:** The data belongs to the client and is commercially sensitive; blanket support access is itself a breach of the isolation promise, so diagnostics must work without reading raw positions.
 **Why correct:** Identifies the constraint that shapes the diagnostic tooling requirement.
 **Common mistakes:** Building support workflows around direct data access, then discovering it is contractually unacceptable.
 **Follow-ups:** "What does tenant-scoped diagnostic tooling provide instead?" (Intermediate values, calculation traces, and input summaries rather than raw data,.)

8. **Q: Why is onboarding a data-migration project rather than a provisioning step?**
 **A:** Each client arrives with historical data in their own format and identifiers, with expectations about available history — making it a per-client migration where most per-client cost lives.
 **Why correct:** Reframes onboarding correctly and identifies where the cost actually is.
 **Common mistakes:** Planning onboarding capacity as account setup, then being overwhelmed by migration work.
 **Follow-ups:** "What converts it from trust to verification?" (Reconciliation reproducing the client's own reported figures from migrated data,.)

9. **Q: Why must cache keys include tenant identity?**
 **A:** A cache is another place the isolation boundary can be crossed; a cross-tenant cache hit is a leak with the same consequence as a query leak.
 **Why correct:** Identifies caching as an isolation surface, not merely a performance concern.
 **Common mistakes:** Keying caches on the logical query only, which is correct single-tenant and a leak multi-tenant.
 **Follow-ups:** "Which prior module warned about this?" (§Intermediate Q5, with lower stakes than here.)

10. **Q: What do per-tenant encryption keys enable at offboarding?**
 **A:** Cryptographic erasure — deleting the key renders that tenant's data unrecoverable, cleanly satisfying deletion obligations without locating every copy.
 **Why correct:** Names the specific operational benefit beyond breach containment.
 **Common mistakes:** Planning deletion as a data-scrubbing exercise across backups, which is slow and hard to prove complete.
 **Follow-ups:** "What must be true for this to work?" (Backups must be encrypted under the same per-tenant key, or they survive the erasure.)

### Intermediate (10)

1. **Q: Walk through the incident and identify the design property that made it possible.**
 **A:** Isolation relied primarily on a query interceptor that applied only to ORM-built queries. A raw-SQL path bypassed it, correctly compensating with a manual filter — but when that query was later edited to add a `UNION ALL` branch, the manual filter was not replicated. The enabling property was that the protection had **exceptions invisible at the point of editing**: a developer modifying that query saw nothing indicating they were outside the interceptor's coverage.
 **Why correct:** Locates the root property (invisible exceptions) rather than the proximate omission.
 **Common mistakes:** Attributing it to developer error, which does not explain why this error was possible here and impossible on the ORM path.
 **Follow-ups:** "What made the storage-level backstop the most important fix?" (It is the only layer with no exceptions — it applies regardless of how the query was constructed.)

2. **Q: Design the automated test that catches the class of bug.**
 **A:** Seed a test database with two tenants' data, execute every registered query path under tenant A's context, and assert zero rows belonging to tenant B are returned. This is mechanical, covers query paths regardless of construction method, and — critically — catches new query paths automatically if the test enumerates registered queries rather than listing them manually.
 **Why correct:** Specifies a test whose coverage grows with the codebase rather than requiring per-query maintenance.
 **Common mistakes:** Writing per-query isolation tests, which cover today's queries and miss tomorrow's.
 **Follow-ups:** "Why does enumeration matter more than assertion strength?" (An unenumerated query is untested regardless of how strong the assertions are on the tested ones.)

3. **Q: How would you allocate compute under contention across commercial tiers?**
 **A:** Weighted fair-share: each tenant has a guaranteed minimum reflecting their tier, with unused capacity redistributed to active tenants proportionally. This satisfies both requirements — a paying tenant always gets at least their entitlement regardless of others' activity, and idle capacity is not wasted.
 **Why correct:** Meets the guarantee and efficiency requirements simultaneously rather than trading one away.
 **Common mistakes:** Hard partitioning (guarantees met, capacity wasted) or pure first-come (efficient, guarantees violated).
 **Follow-ups:** "What must be true for redistribution to be safe?" (Reclaimable work — a tenant's borrowed capacity must be surrenderable when the owner becomes active, which requires preemptible or short-lived tasks.)

4. **Q: Critique building peer-benchmarking (comparing a tenant against anonymized peers) as a product feature.**
 **A:** Genuinely valuable and a real inference risk: with few peers in a category, or with a tenant able to query repeatedly across slices, individual contributions can be reverse-engineered — reconstructing a competitor's holdings from aggregates. Mitigations are minimum-cohort-size thresholds, suppression of small cells, and limiting query granularity; these constrain the feature's usefulness, which is the honest trade rather than a solved problem.
 **Why correct:** Recognizes the feature's value, names the specific attack, and acknowledges mitigations cost utility.
 **Common mistakes:** Treating anonymization as sufficient, when repeated differenced queries defeat naive anonymization.
 **Follow-ups:** "What is the differencing attack?" (Query an aggregate with and without a known member; the difference reveals that member's contribution — which is why per-query suppression is insufficient without cross-query controls.)

5. **Q: Why does tenant size heterogeneity complicate capacity planning?**
 **A:** The largest tenant may be 1000× the smallest, so uniform per-tenant provisioning either starves the large or massively over-provisions the small; capacity must be tiered and, for the largest tenants, individually planned.
 **Why correct:** Identifies the specific ratio problem that defeats uniform provisioning.
 **Common mistakes:** Planning per-tenant averages, which describes no actual tenant.
 **Follow-ups:** "What operational consequence follows?" (The largest tenants may warrant dedicated partitions, blurring toward the isolation spectrum's higher end for them specifically,.)

6. **Q: Design diagnostic tooling that lets support investigate without reading raw positions.**
 **A:** Expose the calculation as an inspectable pipeline: input summaries (counts, aggregates, date ranges — not holdings), intermediate values at each stage, the configuration and model versions used (the provenance), and the specific step where a value diverges from expectation. Most support investigations resolve to a configuration difference or an input-completeness issue, both diagnosable from summaries.
 **Why correct:** Provides what actually resolves the common cases without requiring raw-data access.
 **Common mistakes:** Building only raw-data inspection, then needing contractual exceptions to use it.
 **Follow-ups:** "When is raw access unavoidable?" (Genuinely rare — and should then be an audited, time-boxed, client-approved escalation rather than a standing capability.)

7. **Q: Why does the entitlement store take the consistent side while analytics reads take the available side?**
 **A:** A stale analytics result is a slightly outdated report; a stale entitlement could grant access that has been revoked — a security failure. Consequence-of-staleness differs sharply, so the CAP posture differs.
 **Why correct:** Applies the established per-consumer CAP reasoning with the security-relevant path correctly identified.
 **Common mistakes:** One uniform posture, typically available, which quietly makes revocation eventually-consistent.
 **Follow-ups:** "How quickly must revocation take effect?" (Immediately for the security case — which is precisely why that path cannot tolerate the staleness the analytics path can.)

8. **Q: What makes retrofitting multi-tenancy onto a single-tenant system dangerous?**
 **A:** The isolation boundary must be enforced at every data access, and the failure of any single one is sufficient for a leak — so the migration's risk is proportional to the number of existing access paths, all of which were written without tenant awareness.
 **Why correct:** Identifies why risk scales with existing code rather than with the new work.
 **Common mistakes:** Estimating the retrofit by the tenancy feature's size rather than by the audit surface it creates.
 **Follow-ups:** "What reduces the risk most?" (Storage-level enforcement, which is a single chokepoint independent of how many application paths exist, the fix.)

9. **Q: How should per-tenant restore work, and why is it a requirement rather than a nice-to-have?**
 **A:** A single tenant's corruption or erroneous bulk update must be recoverable without affecting others — which requires backup granularity at the tenant level, ruling out designs where restore is only possible platform-wide. Without it, one tenant's mistake makes every tenant choose between their data and that tenant's recovery.
 **Why correct:** States the requirement and the unacceptable alternative that makes it non-optional.
 **Common mistakes:** Platform-wide snapshot backups, adequate until the first per-tenant restore request.
 **Follow-ups:** "What does this imply about partitioning?" (Tenant must be the primary partition key so a tenant's data is contained rather than interleaved,.)

10. **Q: Synthesize how this module's isolation problem relates to's.**
 **A:** isolated internal teams sharing an Outbox relay; the failure was performance interference and the fix was dedicated capacity. Here tenants are external competitors and the dominant failure is *data* leakage, not performance — so capacity isolation (which this module also needs) is the lesser concern, and the defining requirement is that no code path can read across the boundary. Same structural pattern, materially higher stakes, and a different dominant failure mode.
 **Why correct:** Identifies both the shared structure and the specific escalation.
 **Common mistakes:** Treating this as with more tenants, missing that data leakage rather than interference is now the dominant risk.
 **Follow-ups:** "Which of the controls transfer directly?" (Per-tenant capacity and configuration; what must be added is the layered data-isolation enforcement describes.)

### Advanced (10)

1. **Q: Diagnose the incident and design the complete structural fix.**
 **A:** Root cause: a single isolation mechanism with exceptions that were invisible at the point of editing (Intermediate Q1). Fix: (1) storage-level row-level security as a backstop applying regardless of query construction — the layer with no exceptions; (2) an enumerating isolation test seeding two tenants and asserting no foreign rows across every registered query path (Intermediate Q2); (3) a lint rule flagging raw SQL in the data layer for mandatory review, making the exception visible where edits occur; (4) per-tenant database credentials so the application's connection cannot read other tenants' rows even if a query is malformed — moving from "the query is filtered" to "the connection cannot see it."
 **Why correct:** Addresses the proximate omission, the invisible-exception property, and adds two independent layers so no single mechanism is load-bearing.
 **Common mistakes:** Fixing only the specific query, leaving the invisible-exception property to produce the next incident on a different raw path.
 **Follow-ups:** "Why is (4) stronger than (1)?" (Row-level security still depends on correct policy configuration; per-tenant credentials make cross-tenant reads impossible at the connection level, a simpler and more auditable guarantee.)

2. **Q: A large prospective client demands their data be physically separate. Evaluate.**
 **A:** Legitimate and common. The honest response is to offer it as a distinct deployment tier at a price reflecting its cost, rather than either refusing (losing the client) or accommodating it invisibly (absorbing an unfunded operational burden that grows with each such client). The engineering consequence is that the platform must support both models from one codebase — which is achievable if isolation is already enforced at the connection level, since a dedicated database is then a configuration difference rather than an architectural fork.
 **Why correct:** Treats it as a commercial-tier decision with a specific engineering precondition rather than a binary yes/no.
 **Common mistakes:** Accommodating ad hoc, creating a bespoke deployment nobody budgeted to maintain.
 **Follow-ups:** "What if isolation is currently row-level?" (Then this request is an architectural change, not a configuration one — which is the strongest practical argument for connection-level isolation from the start,.)

3. **Q: Critique using a tenant-supplied identifier for cache keys as a shortcut.**
 **A:** It moves an isolation-critical value into caller control — the same flaw as the request-parameter tenancy, now at the cache layer where it is less visible. A caller supplying another tenant's key retrieves their cached results, bypassing every query-layer control entirely, because the data never reaches the query layer at all. Cache keys must derive from authenticated context.
 **Why correct:** Identifies that the cache bypasses the layer where other controls live, making this leak path independent of query correctness.
 **Common mistakes:** Considering the cache an internal implementation detail outside the isolation boundary.
 **Follow-ups:** "How would an isolation test catch this?" (Intermediate Q2's test must exercise the cached path with a warm cache, not only cold — a cold-cache-only test never touches the cache-key logic.)

4. **Q: Design the onboarding reconciliation that verifies a migration.**
 **A:** Compute, from migrated data, the figures the client already reports themselves — historical performance, period returns, holdings as of known dates — and compare against the client's own published or supplied values within tolerance. Differences are then triaged as data mapping (most common), convention differences (the client computes attribution differently — the configuration variation), or genuine migration error. This converts onboarding sign-off from "the load completed" into "we reproduce your numbers," which is the only assurance that actually matters to the client.
 **Why correct:** Specifies an independent, client-meaningful check and its triage categories.
 **Common mistakes:** Validating row counts and referential integrity, which confirms the load ran but not that it is right.
 **Follow-ups:** "What is the most common cause of a break?" (Convention differences rather than errors — which is why the triage step matters and why an unexplained break is not automatically a defect.)

5. **Q: How should the platform handle a tenant requesting a feature that would require core changes?**
 **A:** Apply the triage: has this or similar been requested by others (suggesting genuine commonality worth building into the core), or is it idiosyncratic (suggesting an extension point)? If neither fits and the request cannot be expressed through configuration, the honest answer is to decline or to price it as bespoke work with an owner — because the alternative, a per-tenant core branch, imposes a permanent tax on every future change for every tenant.
 **Why correct:** Applies the established triage and names the real cost of accommodating without it.
 **Common mistakes:** Accommodating to preserve the relationship, then discovering the platform has become unchangeable.
 **Follow-ups:** "How do you decline without damaging the relationship?" (By making the shared-platform trade explicit: the same property that keeps their costs low and their upgrades free is what constrains bespoke changes.)

6. **Q: A client asks how the platform guarantees their data is never visible to competitors. Answer honestly.**
 **A:** Describe the layers concretely — authentication-derived tenant context that fails closed, per-tenant database credentials making cross-tenant reads impossible at the connection level, storage-level row policies as a backstop, per-tenant encryption keys limiting the blast radius of a storage compromise, and continuous automated isolation testing (Advanced Q1). Then state the residual honestly: no architecture eliminates the possibility of a defect, which is why the design assumes any single layer may fail and requires multiple simultaneous failures for a leak — and why the isolation test runs continuously rather than at release only.
 **Why correct:** Gives specific layered mechanisms and frames the guarantee as defence-in-depth with a stated residual, rather than claiming impossibility.
 **Common mistakes:** Claiming leaks are impossible, which no informed client believes and which collapses badly if an incident later occurs.
 **Follow-ups:** "What would you offer a client who wants more assurance?" (Independent penetration testing scoped to tenant isolation, and Advanced Q2's dedicated-infrastructure tier if their risk appetite genuinely requires it.)

7. **Q: Design the control preventing a support engineer's legitimate access from becoming a standing leak.**
 **A:** Time-boxed, purpose-bound, client-approved elevation: access granted for a specific ticket, expiring automatically, logged immutably with the accessing identity and justification, and — where the client's contract requires it — notified to the client. The key property is that it is *exceptional and expiring* rather than a role someone holds; a standing support role with tenant-data access is functionally a permanent cross-tenant read capability held by a group whose membership drifts over time.
 **Why correct:** Identifies that the danger is standing access and membership drift, not the access itself.
 **Common mistakes:** A "support" role with broad read access, which is convenient and becomes an unbounded liability as the team changes.
 **Follow-ups:** "Why does client notification matter?" (It converts the platform's access from something the client trusts blindly into something they can audit — which is the only basis on which it is genuinely acceptable.)

8. **Q: Apply this course's "declared ≠ actual" theme to this platform.**
 **A:** The claim is "each tenant sees only their own data." Its declared basis is typically that the code filters by tenant. Earlier analysis showed that basis is insufficient: filtering can be bypassed on exception paths, cached across boundaries (Advanced Q3), or leaked through aggregates (Intermediate Q4). What distinguishes this module is that the failure is **silent to both parties** — the leaking platform sees a successful query and the receiving tenant sees data they cannot tell is foreign. Unlike the external reconciliation or the recomputation, there is no external party holding the truth against which to check; the only verification is adversarial testing the platform performs against itself (Intermediate Q2).
 **Why correct:** Identifies the specific insufficiency and the distinguishing property — no external check exists, so self-testing is the only verification.
 **Common mistakes:** Assuming a client would notice receiving foreign data; shows it was noticed only because totals were implausible, which is luck rather than control.
 **Follow-ups:** "What follows from having no external checker?" (The isolation test must be treated as the platform's most important test, not one test among many — it is the sole verification of the core product promise.)

9. **Q: Design the monitoring that would detect a leak in progress.**
 **A:** Hard, because a leak looks like a successful query. The available signals are indirect: result-set sizes anomalous for a tenant's known data volume (was noticed this way, by a human); queries returning rows whose tenant attribution differs from the request context, checked at the data layer as an assertion rather than a filter; and access-pattern anomalies. The honest assessment is that detection is weak and prevention must therefore carry the load — which is itself the argument for the layering, since a class of failure you cannot reliably detect must be one you make structurally difficult.
 **Why correct:** Honestly assesses detection as weak and derives the correct implication rather than proposing monitoring that would not work.
 **Common mistakes:** Proposing detection as the primary control, when the failure produces no reliable signal.
 **Follow-ups:** "What is the single most valuable runtime check?" (A data-layer assertion that every returned row's tenant matches the request context — it converts a silent leak into a loud error at the moment it occurs.)

10. **Q: Synthesize the governance program required before onboarding the first external tenant.**
 **A:** (1) Layered isolation — authenticated tenant context failing closed, per-tenant credentials, storage-level policies (Advanced Q1). (2) Continuously-run enumerating isolation test across all query paths including cached ones (Intermediate Q2, Advanced Q3). (3) Data-layer row-attribution assertions converting silent leaks into errors (Advanced Q9). (4) Time-boxed, audited, client-visible support access (Advanced Q7). (5) Per-tenant quotas and fair-share scheduling before contention arises, not after. (6) Onboarding reconciliation reproducing client-reported figures (Advanced Q4). (7) Per-tenant restore and cryptographic erasure, proven by rehearsal rather than assumed. (8) A triage process for tenant-specific requests preventing core forking (Advanced Q5).
 **Why correct:** Assembles a program covering isolation, verification, operations, and the commercial-pressure control that protects the codebase long-term.
 **Common mistakes:** Presenting isolation architecture without the continuous verification and support-access controls, which are where isolation actually erodes over time.
 **Follow-ups:** "Which item is most often deferred and most regretted?" (Per-tenant quotas — contention seems hypothetical until the platform has enough tenants that it is constant, by which point retrofitting scheduling into a saturated system is far harder.)

### Expert (10)

1. **Q: Evaluate the build-versus-buy decision for a firm considering this platform rather than building analytics in-house.**
 **A:** The buy case is strong for the same reason the was: the non-differentiating surface is enormous — instrument coverage across asset classes, pricing models, corporate-action handling, data vendor integrations, regulatory reporting — and each requires perpetual maintenance as markets change. The build case is narrow: a firm whose *investment process itself* depends on proprietary analytics no vendor offers. The mature pattern is buy the platform, build the proprietary layer against its extension points — which is precisely why the extension-point design matters commercially, not merely architecturally: it is what makes the platform viable for clients who need some proprietary logic.
 **Why correct:** Identifies the non-differentiating surface as decisive and connects extension-point design to the platform's own commercial viability.
 **Common mistakes:** Building in-house for control, then carrying instrument-coverage and corporate-action maintenance permanently.
 **Follow-ups:** "What does this imply about the platform's extension points?" (They are a first-class product feature, since clients with proprietary needs cannot adopt a platform that cannot accommodate them.)

2. **Q: How should the platform handle a tenant whose usage grows to threaten the shared infrastructure?**
 **A:** This is a commercial conversation with an engineering deadline, and delaying it is the error. Options: move them to dedicated infrastructure at appropriate pricing (Advanced Q2); enforce their contractual quota (which requires the quota to have been set at contracting, not retrofitted); or invest in capacity funded by their growth. What fails is absorbing the growth silently until other tenants degrade — which converts a commercial issue into an incident affecting clients who did nothing wrong.
 **Why correct:** Frames it as a commercial decision with engineering constraints and names the specific failure of inaction.
 **Common mistakes:** Absorbing growth to preserve the relationship, degrading other tenants who then have a legitimate complaint.
 **Follow-ups:** "What should have happened earlier?" (Quotas defined at contracting so growth beyond them is a priced conversation rather than a surprise,.)

3. **Q: Design cross-tenant analytics for the platform's own product development without violating isolation.**
 **A:** Genuinely useful (understanding feature usage, performance characteristics) and genuinely dangerous. The workable form is strictly aggregated, k-anonymous metrics computed by a separate pipeline with no path back to individual tenant data, with cohort-size minimums (Intermediate Q4), and — critically — governed by explicit contractual permission rather than assumed. Many client agreements prohibit it outright, so the legal position must be established before the engineering, which is the reverse of the usual order and frequently overlooked.
 **Why correct:** Identifies both the value and the contractual precondition that usually decides feasibility.
 **Common mistakes:** Building usage analytics as ordinary product telemetry without checking whether client agreements permit it.
 **Follow-ups:** "Why is aggregation alone insufficient?" (Intermediate Q4's differencing attacks, plus the contractual question which aggregation does not address.)

4. **Q: How does per-tenant configuration interact with platform upgrades?**
 **A:** Every configuration dimension multiplies the upgrade test matrix, and combinations that no single tenant uses but two tenants collectively exercise are the ones that break. The disciplines that keep this tractable: constrain configuration to a bounded, well-specified set (not free-form); test the actual combinations in use rather than the theoretical space; and stage upgrades by tenant cohort (the canary staging), so a configuration-specific regression affects one cohort rather than all.
 **Why correct:** Identifies combinatorial growth as the mechanism and gives three concrete containment disciplines.
 **Common mistakes:** Testing configuration dimensions independently, missing interaction effects that only appear in real combinations.
 **Follow-ups:** "Which cohort should upgrade first?" (Smaller, lower-risk tenants with configurations representative of common cases — never the largest client, whose configuration is usually the most unusual.)

5. **Q: A tenant's analytics disagree with their custodian's figures. Walk through the investigation.**
 **A:** Establish which layer disagrees before assuming a platform defect: are the *inputs* the same (positions and prices as of the same instant — often not, and often the whole explanation); is the *convention* the same (multiple valid attribution and accounting treatments exist); or is the *calculation* genuinely different? Use the diagnostic tooling's intermediate values (Intermediate Q6) to locate the first divergent step. As with Modules 129 and 131, most disputes resolve to inputs or conventions, and the reproducibility metadata is what makes the investigation possible at all.
 **Why correct:** Sequences from most to least likely cause and reuses the established provenance-as-diagnostic-instrument pattern.
 **Common mistakes:** Auditing the calculation engine first — least likely, most expensive.
 **Follow-ups:** "Why are convention differences so common?" (There is no single correct performance-attribution methodology; the client and custodian may both be right under different, equally valid conventions.)

6. **Q: Evaluate running this platform across multiple cloud regions for global clients.**
 **A:** Driven primarily by data residency rather than latency. Many jurisdictions require client data to remain in-region, which makes regional deployment a compliance requirement rather than a performance optimization — and it interacts sharply with tenancy: a tenant's data must be pinned to their required region, so tenant-to-region assignment becomes part of the isolation model. The failure mode to design against is a global service inadvertently reading cross-region and violating residency, which is a compliance breach even without any cross-*tenant* leak.
 **Why correct:** Identifies residency as the driver and the specific compliance failure distinct from tenant leakage.
 **Common mistakes:** Treating multi-region as a latency optimization, then discovering residency constraints require it anyway with different design implications.
 **Follow-ups:** "How does this constrain shared services?" (Any global service — a shared cache, a central scheduler — must be region-aware or it becomes the residency violation path.)

7. **Q: Design the platform's approach to a tenant offboarding.**
 **A:** Contractually specified data return in an agreed format (often extensive — clients want their full history), followed by verified deletion. Cryptographic erasure makes deletion provable where per-tenant keys exist. The commonly-missed elements: backups and derived stores (caches, read models, analytics extracts) must be covered, since deletion from the primary store alone leaves copies; and the deletion must be *evidenced*, since the client will require attestation. Offboarding is a designed capability, not an operational improvisation.
 **Why correct:** Covers return, deletion, the derived-copy problem, and the evidence requirement.
 **Common mistakes:** Deleting the primary store only, leaving data in backups and derived stores that the attestation implicitly and wrongly covers.
 **Follow-ups:** "Why does per-tenant partitioning matter here?" (it makes locating every copy tractable; interleaved data makes complete deletion difficult to perform and harder to prove.)

8. **Q: How would you migrate the platform from row-level to connection-level isolation?**
 **A:** Incrementally and additively: introduce per-tenant credentials and route connections by tenant while *retaining* existing row-level filters, so the two mechanisms overlap rather than switch. Verify with the isolation test (Intermediate Q2) under the new routing, then optionally retire the row filters — or, better, keep them as the defence-in-depth layer prescribes. The additive sequencing means no window exists where isolation depends on the new, unproven mechanism alone, which is exactly the Parallel Run discipline Modules 107, 122, and 126 established.
 **Why correct:** Sequences additively so isolation is never weakened during migration, applying the established migration pattern.
 **Common mistakes:** Switching mechanisms, creating a window where the new path's correctness is untested and the old protection is gone.
 **Follow-ups:** "Why keep both permanently?" (no single mechanism should be load-bearing, and the row filter costs almost nothing once written.)

9. **Q: A prospective client asks for a contractual guarantee of zero cross-tenant data access. How do you advise?**
 **A:** Advise against an absolute guarantee and toward specific, verifiable commitments: the layered controls (Advanced Q6), independent testing, incident notification obligations, and defined remedies. An absolute guarantee is both undeliverable and, if breached, worse than a well-specified commitment — because it forecloses the honest conversation about defence-in-depth that a sophisticated client will actually find more credible. This is the same posture as §Expert Q7 and §Advanced Q6: a bounded, evidenced claim outperforms an unqualified one.
 **Why correct:** Recommends the commercially and technically honest position with a consistent rationale.
 **Common mistakes:** Accepting the absolute guarantee to win the deal, creating an obligation no engineering practice can satisfy.
 **Follow-ups:** "What convinces a sophisticated client?" (Evidence of layered controls and continuous testing — a specific description of what would have to fail simultaneously is more persuasive than an assertion that nothing will.)

10. **Q: Deliver the closing synthesis: what makes multi-tenant analytics distinctively hard?**
 **A:** Not the analytics — computationally it is with different outputs. Two properties define it. First, **the dominant failure has no natural detector**: a cross-tenant leak produces a successful query, satisfied logs, and a recipient who cannot tell the data is foreign (Advanced Q8, Q9) — and unlike Modules 129–131, no external party holds the truth to reconcile against, so the only verification is the platform adversarially testing itself. Second, **commercial pressure acts directly on the architecture**: every client wants bespoke behaviour, dedicated resources, and absolute guarantees, and each accommodation individually seems reasonable while collectively making the platform unchangeable, unprofitable, or over-promised. The engineering difficulty is therefore inseparable from the commercial discipline — which is why the triage, the quotas, and Expert Q9's guarantee posture are architectural decisions as much as business ones, and why a Principal Engineer here spends as much effort defending the shared platform's integrity against reasonable-sounding requests as on the system itself.
 **Why correct:** Identifies both distinguishing properties, including the unusual one — commercial pressure as a direct architectural force — and explains why they are inseparable.
 **Common mistakes:** Designing the isolation architecture well while treating tenant-specific requests, quotas, and guarantees as someone else's problem, which is how a technically sound platform becomes commercially unmaintainable.
 **Follow-ups:** "How does the next module differ?" (the regulatory reporting shares the no-natural-detector property but replaces commercial pressure with an immovable external deadline — correctness under time constraint rather than under commercial constraint.)

---

## 11. Coding Exercises

### Easy — Fail-Closed Tenant Context
**Problem:** Ensure an absent tenant context can never produce an unscoped query.
**Solution:**
```csharp
public sealed class TenantContext
{
    private static readonly AsyncLocal<TenantId?> Current = new;

    public static TenantId Require =>
        Current.Value?? throw new MissingTenantContextException(
        "No tenant context — refusing to execute an unscoped query.");

    public static IDisposable Enter(TenantId tenant)
    {
        Current.Value = tenant;
        return new Scope(=> Current.Value = null);
    }
}
```
**Time complexity:** O(1).
**Space complexity:** O(1) per async flow.
**Optimized solution:** Combine with per-tenant connection resolution (Advanced Q1) so `Require` selects the tenant's credentials rather than merely supplying a filter value — moving from "the query is filtered" to "the connection cannot see other tenants."

### Medium — Enumerating Isolation Test (Intermediate Q2)
**Problem:** Assert no query path returns foreign-tenant rows, covering paths added in future.
**Solution:**
```csharp
[Theory]
[MemberData(nameof(AllRegisteredQueries))] // enumerated, not hand-listed
public async Task Query_ReturnsNoForeignTenantRows(IQueryDescriptor query)
{
    await _seed.TwoTenantsAsync(TenantA, TenantB);

    using (TenantContext.Enter(TenantA))
    {
        var rows = await query.ExecuteAsync(_db);
        Assert.All(rows, r => Assert.Equal(TenantA, r.TenantId));
        Assert.NotEmpty(rows); // guard: a query returning nothing proves nothing
    }
}
```
**Time complexity:** O(q × r) for q queries returning r rows.
**Space complexity:** O(r).
**Optimized solution:** Run the same suite twice with the cache warm and cold, since Advanced Q3's cache-key leak is invisible to a cold-cache-only run.

### Hard — Weighted Fair-Share Scheduler (Intermediate Q3)
**Problem:** Guarantee each tenant their entitlement while redistributing idle capacity.
**Solution:**
```csharp
public TenantId? SelectNext(IReadOnlyDictionary<TenantId, TenantQueue> queues)
{
    // Deficit round-robin: each tenant accrues credit proportional to weight
    // spends it when scheduled — guaranteeing share without wasting idle capacity.
    TenantId? best = null;
    double bestDeficit = double.NegativeInfinity;

    foreach (var (tenant, q) in queues.Where(kv => kv.Value.HasWork))
    {
        var deficit = _credit[tenant] / _weight[tenant];
        if (deficit > bestDeficit) { bestDeficit = deficit; best = tenant; }
    }

    if (best is not null) _credit[best] -= queues[best].PeekCost;
    foreach (var t in queues.Keys) _credit[t] += _weight[t] * _replenishRate;
    return best;
}
```
**Time complexity:** O(t) per scheduling decision for t tenants.
**Space complexity:** O(t).
**Optimized solution:** Use a priority queue keyed on normalized deficit to make selection O(log t), which matters once tenant count is large enough that per-decision linear scanning appears in profiles.

### Expert — Onboarding Reconciliation (Advanced Q4)
**Problem:** Verify migrated data reproduces the client's own reported figures.
**Solution:**
```csharp
public async Task<OnboardingReport> VerifyAsync(TenantId tenant, IReadOnlyList<ClientReportedFigure> expected)
{
    var breaks = new List<Break>;
    foreach (var fig in expected)
    {
        var computed = await _analytics.ComputeAsync(tenant, fig.Metric, fig.AsOf, fig.PortfolioId);
        var relative = Math.Abs(computed - fig.Value) / Math.Max(Math.Abs(fig.Value), 1m);

        if (relative > _tolerance)
            breaks.Add(new Break(fig, computed, relative, Classify(fig, computed)));
    }
    return new OnboardingReport(tenant, breaks, expected.Count);
}

private BreakCause Classify(ClientReportedFigure fig, decimal computed) =>
    _conventionDiffDetector.IsExplainedByConvention(fig, computed)
? BreakCause.ConventionDifference // not a defect — expected and explainable
: BreakCause.RequiresInvestigation;
```
**Time complexity:** O(n) client-reported figures, each an analytics computation.
**Space complexity:** O(b) for breaks found.
**Optimized solution:** Classify breaks automatically against known convention variants, so onboarding staff triage only genuinely unexplained differences rather than every numerical mismatch — most of which are legitimate convention differences.

---

## 12. System Design — Designing a Multi-Tenant Portfolio Analytics Platform

*Authored to the four-step standard (see Module 01 §12 for the method).*

---

### Step 1 — Understand the Problem and Establish Design Scope

#### The dialogue

> **C:** Who are the tenants, and what happens if one sees another's data?
> **I:** Institutional asset managers. A cross-tenant leak would likely end the business — several are direct competitors.
>
> **C:** So isolation is existential rather than a feature. Are tenants uniform in size?
> **I:** Not remotely. The largest has about 1,000× the portfolios of the smallest.
>
> **C:** That rules out uniform per-tenant provisioning. Do tenants need their own models and conventions?
> **I:** Yes — different attribution methodologies, different day-count conventions, different report formats.
>
> **C:** Without forking the codebase, I assume.
> **I:** Correct. One codebase, forty tenants.
>
> **C:** What's the workload shape? Interactive dashboards and heavy batch analytics are very different.
> **I:** Both. Interactive exposure and attribution views, plus scenario jobs that can run for hours.
>
> **C:** When do tenants use it? If everyone reports at month-end, "average load" is a fiction.
> **I:** Month-end, almost all of them, within the same few days.
>
> **C:** Do we need per-tenant restore and provable deletion?
> **I:** Yes — contractual, and for some tenants a regulatory requirement.
>
> **C:** How do we support them? Debugging a tenant's numbers usually means looking at their data.
> **I:** That's a real problem for us today. Support can't casually read client holdings.
>
> **C:** Out of scope?
> **I:** The analytics models themselves, the client-facing UI, and billing.

Two answers dominate. **1,000× size skew** means fair-share scheduling is not optional — the largest tenant can trivially consume the platform. And **"support can't read client holdings"** turns diagnostics into a design requirement rather than an operational habit, which is §3.5.

#### Functional requirements

1. Serve performance attribution, exposure decomposition, scenario analysis, and factor risk per tenant.
2. Enforce strict tenant isolation across data access, caching, compute, and logs.
3. Support per-tenant configuration (models, conventions, formats) without forking core code.
4. Onboard new tenants with verified historical migration.
5. Provide tenant-scoped diagnostics usable **without raw-data access**.
6. Per-tenant backup, restore, and provable deletion.

#### Non-functional requirements

| Requirement | Target |
|---|---|
| Cross-tenant data exposure | **Zero.** The platform's existential requirement |
| Interactive query latency | p95 < 3 s for common views |
| Per-tenant performance predictability | A tenant's latency must not depend on another tenant's activity |
| Scenario job completion | Within the tenant's contracted window, even at month-end |
| Availability | 99.9% per tenant, measured **per tenant** — a platform-wide average hides a single tenant being down |
| Deletion | Provable, within contractual window, including backups and caches |

#### Back-of-the-envelope estimation

```
Tenants                  = 40
Size skew                = largest ≈ 1,000× smallest
Aggregate portfolios     ≈ 120,000
Aggregate positions      ≈ 25,000,000
Interactive queries      ≈ 50/s aggregate, bursty
Scenario jobs            ≈ 200/day, each 10^4–10^6 pricing calls
```

The month-end concentration, which is the number that governs the design:

```
If 35 of 40 tenants report in the same 3-day window:
  Effective demand multiplier over a normal day     ≈ 8–10×
  And it is SIMULTANEOUS — not staggered — because every
  tenant's reporting cycle is driven by the same calendar.

Sizing for average load:      fails 3 days a month, for everyone, together
Sizing for the peak:          8–10× the infrastructure, idle 90% of the time
```

Skew:

```
Largest tenant   ≈ 40% of aggregate positions
Smallest 20 tenants combined ≈ 3%
A single scenario job from the largest tenant can exceed the
TOTAL daily compute of the smallest thirty tenants.
```

#### What the numbers tell us

1. **Demand is not smooth and never will be**, because it is calendar-driven, not user-driven. That eliminates statistical multiplexing as a capacity strategy — the usual assumption that tenants' peaks are uncorrelated is *false here*, and saying so is the estimation's most valuable output.
2. **With 1,000× skew, "fair" cannot mean "equal."** Fair-share scheduling must be weighted by contracted entitlement, or the smallest tenant gets 1/40th of a platform it pays little for while the largest is throttled below what it pays a great deal for.
3. **The peak is when per-tenant guarantees matter most and are hardest to honour** — precisely at month-end, when every tenant is producing client-facing numbers under their own deadlines. So the scheduler's behaviour under saturation is the design's core, not an edge case.

The hard problem is **isolation that holds under contention**, not isolation in the abstract.

---

### Step 2 — Propose High-Level Design and Get Buy-In

#### The isolation spectrum, and where to sit

| Model | Isolation | Cost | Operability |
|---|---|---|---|
| Shared everything, `tenant_id` column | Weakest — one missing `WHERE` clause is a breach | Lowest | Simple |
| Shared DB, **schema per tenant** | Strong at the connection level | Low | Good |
| Database per tenant | Very strong | Moderate | 40 databases to patch |
| Full stack per tenant | Strongest | Highest | 40 deployments |

**Chosen: schema-per-tenant on shared infrastructure, with connection-level credentials scoped to one schema.** The decisive property is that isolation stops depending on application code being correct. A missing predicate becomes a *permission error* rather than a leak — the difference between a bug and a breach. This is the same "make the bad state unrepresentable" principle this course applies to append-only ledgers and non-suppressible notification categories.

#### Components

**Gateway.** Terminates authentication and establishes **tenant context** from the verified token — never from a request parameter, header, or path segment a client can set.

**Tenant Context Propagation.** Ambient, **fail-closed**: any code path reaching data access without a resolved tenant context throws rather than defaults. A default tenant is a breach waiting for a bug.

**Credentialed Data Access.** Per-tenant database credentials scoped to that tenant's schema. The application cannot query another tenant's data even if it tries.

**Fair-Share Scheduler.** Weighted, entitlement-based admission and preemption for analytics jobs.

**Analytics Engine.** The compute grid (Module 09's disciplines), with per-tenant resource pools.

**Tenant Configuration Store.** Bitemporal, versioned — because a result must record the configuration that produced it.

**Onboarding Pipeline.** Historical migration with reconciliation gates.

**Tenant-Scoped Diagnostics.** Structured, redacted diagnostic surfaces (§3.5).

#### End-to-end walkthrough — an interactive query

1. Request arrives with a bearer token; the gateway verifies it and extracts `tenant_id` **from the token's verified claims**.
2. Tenant context is established in an ambient scope for the request's lifetime.
3. The service resolves the tenant's configuration version as-of now.
4. Cache lookup uses a key **derived from the authenticated context**, not from request parameters: `t:{tenant_id}:v:{config_version}:{query_hash}`. A cache key a caller can influence is a cross-tenant read waiting to happen (§3.4).
5. On miss, a connection is obtained **from the tenant's own credentialed pool**; the query carries no `tenant_id` predicate because it cannot see anything else.
6. Results computed with the tenant's configuration; the response records `config_version` so the number is explicable later.
7. Response written to the tenant-namespaced cache; audit log entry written with tenant, principal, and query shape — **never query values**, which would put holdings in the log.

#### End-to-end walkthrough — a scenario job at month-end

1. Tenant submits a scenario job; it is admitted to the tenant's queue with an entitlement weight.
2. Scheduler computes each tenant's current share versus entitlement and admits work accordingly.
3. Large jobs are **decomposed into bounded tasks** so the scheduler can interleave — an indivisible six-hour job cannot be fair-shared, so fair-share depends on decomposition being enforced at submission.
4. Under saturation the scheduler **preempts tasks** from tenants over their share, requeueing them; because tasks are pure functions of pinned inputs (Module 09 §3.6), preemption costs only the work in flight.
5. Progress and an honest completion estimate are published to the tenant — under contention, an accurate "this will take 40 minutes" is worth more than an optimistic one.

#### API design

**All endpoints are tenant-scoped implicitly.** There is no `tenant_id` path or query parameter anywhere in the API — this is deliberate. If the tenant were addressable in the URL, then authorisation becomes a check that can be forgotten; when it is derived from the token, there is nothing to forget.

**`POST /v1/analytics/attribution`**

| Field | Type | Description |
|---|---|---|
| `portfolio_ids` | string[] | Validated against the tenant's own portfolios |
| `period` | object | `{ from, to }` |
| `methodology` | string | Optional override; defaults to the tenant's configured method |
| `benchmark_id` | string | |

Response: `{ results, config_version, computed_at, cache_hit }`. **`config_version` on every response** is what makes "why is this number different from last month" answerable.

**`POST /v1/jobs/scenarios`** → `202 { job_id, queue_position, estimated_start, estimated_duration }`. Returning queue position and an estimate is a fair-share affordance: a tenant that can see it is queued behind its own entitlement complains less than one that just sees slowness.

**`GET /v1/jobs/{id}`** → `{ status, progress, tasks_completed, tasks_total, estimated_completion, share_state }`.

**`GET /v1/diagnostics/queries/{query_id}`** → §3.5's redacted diagnostic bundle.

**`POST /v1/admin/tenants/{id}/deletion`** (platform-admin only) → initiates provable deletion across primary stores, caches, search indexes, backups, and logs, returning a certificate enumerating what was purged and when.

#### Data model

**Per-tenant schema** — `tenant_{id}.portfolio`, `.position`, `.transaction`, `.benchmark`, `.result`. Identical DDL across tenants, applied by migration tooling; **schema drift between tenants is the operational failure mode to guard against**, and a startup check comparing each tenant's schema hash against the expected version is the cheap defence.

**Shared control-plane schema** (no tenant business data):

| Table | Columns |
|---|---|
| `tenant` | `tenant_id`, `name`, `status`, `entitlement_weight`, `contracted_windows`, `onboarded_at` |
| `tenant_config` | `tenant_id`, `key`, `value`, `valid_from`, `valid_to`, `knowledge_from`, `knowledge_to`, `version` — **bitemporal**, because a result computed last quarter must be explicable under last quarter's configuration |
| `tenant_credential` | `tenant_id`, `db_role`, `rotated_at` |
| `job` | `job_id`, `tenant_id`, `type`, `status`, `weight`, `submitted_at`, `admitted_at`, `completed_at`, `tasks_total`, `tasks_done` |
| `audit_log` | `at`, `tenant_id`, `principal`, `action`, `resource_type`, `resource_count` — **counts and shapes, never values** |

**Results** — columnar store partitioned by `(tenant_id, as_of)`, and physically separated per tenant where the store supports it. Partitioning alone is not isolation; it is an optimisation that looks like isolation, which is worse than neither.

#### Store selection, and why

| Store | Choice | Reason |
|---|---|---|
| Tenant business data | **Schema-per-tenant, shared PostgreSQL clusters**, credentials scoped per schema | Isolation enforced by the database's own permission system rather than by application predicates. Shared infrastructure keeps 40 tenants operable |
| Analytics results | **Columnar, tenant-partitioned** | Large scans over `(tenant, date, measure)` |
| Configuration | **Bitemporal relational** | Provenance — a result records the config that produced it |
| Cache | **Redis with per-tenant logical DBs or key prefixes derived from verified context** | See §3.4 for why the key derivation matters more than the mechanism |
| Job/scheduler state | **PostgreSQL** | Small, transactional |

The decision worth defending: **shared infrastructure with per-tenant credentials**, rather than 40 isolated stacks. Forty stacks would be marginally safer and operationally ruinous — patching, upgrading, and monitoring 40 estates means the *fleet* becomes inconsistent, and an unpatched tenant is its own security problem. Isolation that degrades operability eventually degrades security.

---

### Step 3 — Design Deep Dive

#### 3.1 Defence in depth — five independent layers

No single mechanism is trusted, because the requirement is existential and every single mechanism has a plausible failure:

| Layer | Mechanism | Fails when |
|---|---|---|
| Authentication | Tenant from verified token claims only | Token forgery — mitigated by standard JWT/mTLS discipline |
| Context | Ambient, fail-closed; no default tenant | A code path bypasses the accessor — caught by layer 3 |
| **Data access** | **Per-tenant DB credentials scoped to one schema** | Credential mix-up — caught by layer 4 |
| Query-time assertion | Results carry `tenant_id`; a mismatch **throws and alerts** rather than filtering | Both the credential and the assertion are wrong simultaneously |
| Continuous verification | A scheduled probe authenticates as tenant A and attempts to read tenant B's known resource IDs, expecting failure | Never — this is the layer that detects the others having silently regressed |

The fifth layer is the one most designs omit and the one that matters most over time. **Isolation regresses silently**: a new endpoint, a new cache, a new report export, a new admin tool. Nothing alerts, because a leak looks like a successful response. A continuous negative-test probe is the only mechanism that notices — the same "independent verifier" conclusion this course reaches for ledgers (Module 18 §11) and notification delivery (Module 20 §E2), arriving here from the security direction.

#### 3.2 Fair-share scheduling under correlated peaks

The estimation showed peaks are simultaneous, so the scheduler's saturation behaviour *is* the platform's quality of service.

- **Weighted fair share by entitlement**, not equal share. Weight comes from the contract.
- **Decomposition enforced at submission.** A job is admitted only if it can be expressed as bounded tasks; otherwise it cannot be interleaved and one tenant monopolises workers for hours.
- **Preemption over queueing** for tenants over their share. Cheap because tasks are pure functions of pinned inputs.
- **Reserved floor per tenant.** Every tenant gets a guaranteed minimum, even at peak, so a small tenant is never fully starved by a large one's legitimate work.
- **Burst credits.** A tenant idle for weeks may exceed its share temporarily — which is what makes weighted fair share feel generous rather than restrictive, and costs nothing when peaks are correlated because there is no idle capacity to lend at month-end anyway.

And an honest admission worth making in an interview: **at a truly correlated peak, someone waits.** The design's job is to make *who waits* a stated, contractual, explicable outcome rather than an emergent property of submission order.

#### 3.3 Per-tenant configuration without forking

Forty tenants each wanting a different attribution methodology is how a codebase becomes forty codebases.

- **Configuration, not code**, for anything expressible as parameters: conventions, calendars, rounding, formats.
- **A registry of named strategies** for genuinely different algorithms — a tenant selects `attribution_method = "brinson_fachler"`, it does not ship its own code. New methods are added to the registry, available to all, selected by none until configured.
- **Config is versioned and bitemporal**, and every result records the version that produced it. Without this, "our numbers changed and nothing changed" is unanswerable — and it is the single most common tenant escalation on a platform like this.
- **Where a tenant needs genuine custom code**, it goes in a sandboxed extension point with a declared interface, resource limits, and no ambient tenant context of its own. That boundary is what keeps a bespoke request from becoming a fork.

#### 3.4 Caching — the most common leak vector

A cache is where tenant isolation quietly dies, because caches sit outside the database whose permissions were doing the work.

- **Cache keys derive from the verified tenant context**, never from request parameters. A key like `attribution:{portfolio_id}:{period}` is a cross-tenant read the moment two tenants share a portfolio identifier — and portfolio IDs are exactly the kind of thing that collides.
- **Namespace physically** where possible (separate logical databases or separate instances for the largest tenants) so a key-construction bug cannot reach across.
- **Invalidate per tenant.** A global flush at month-end is a thundering herd concentrated on the busiest day of the quarter.
- **Deletion must include caches**, or "provable deletion" is provably false. This is a real gap in most implementations, because caches are thought of as ephemeral and TTLs are longer than people remember.

#### 3.5 "Whose bug is it" — diagnostics without raw data

A tenant reports a wrong number. Support cannot open their holdings. Without a designed answer, the practical outcome is that someone gets production data access, and the isolation model is over.

The designed answer is a **structured diagnostic bundle**, generated on request and scoped to one query:

- The **computation graph**: which inputs, which configuration version, which model version, which intermediate steps — by identifier and shape, not by value.
- **Aggregate statistics** rather than values: position counts, null counts, date ranges, min/max/mean of the inputs — enough to spot "this portfolio has 300 positions and 12 have no price" without reading a single holding.
- **Deterministic replay**: re-run the same computation with the same pinned inputs and confirm the same output, which distinguishes a data problem from a code problem immediately.
- **Tenant-side self-service**: the tenant, who *is* entitled to their data, can view the full bundle unredacted. Much of what support would have done, the tenant can do faster.

When raw access is genuinely unavoidable: a **break-glass** flow with tenant notification, dual approval, a time-boxed credential, and a full audit record. Not an exception to the model — a documented, logged, rare, and *visible* operation.

#### 3.6 Onboarding and provable deletion

**Onboarding** is a migration with a reconciliation gate, not a data load. Historical data is loaded, then recomputed, then compared against the tenant's existing numbers from their prior system, and **the tenant signs off on the reconciliation before go-live.** Skipping the gate means every subsequent discrepancy becomes an argument about whether the platform or the migration was wrong.

**Deletion** must cover primary store, replicas, results, caches, search indexes, logs, and **backups** — and backups are the hard one, because a backup that includes tenant data cannot be selectively purged without either per-tenant backups (chosen here, and a further argument for schema-per-tenant) or crypto-shredding: encrypt each tenant's data with a tenant-specific key and destroy the key. Crypto-shredding is the pragmatic answer for archives and is worth naming, along with its caveat — it is deletion under a cryptographic assumption, not physical erasure, and some regulators care about the difference.

---

### Step 4 — Wrap-Up

**What we left out:** the analytics methodologies themselves; the client-facing UI; billing and usage metering, which interacts closely with fair-share and should probably share its accounting; multi-region for data residency, where a tenant's jurisdiction constrains where its schema may live; tenant-managed encryption keys (BYOK), which is a common institutional requirement and changes the deletion design; and disaster recovery with per-tenant RPO/RTO commitments.

**What we would measure:** the **isolation probe's** pass rate and last-run time, with a dead-man's switch — because the probe stopping is indistinguishable from the probe passing; per-tenant latency and job-completion **against entitlement**, since a platform-wide average is exactly the aggregate blindness this folder keeps finding; scheduler share deviation per tenant at peak; **cache key-namespace violations**, which should be structurally impossible and therefore alert loudly if ever counted; config-version distribution across results (a tenant whose results span three config versions in one report is a bug); schema-hash drift across tenants; and break-glass access frequency, which should trend toward zero as the diagnostic bundle improves.

**Summary.** Isolation is enforced by the database's own permission system rather than by application predicates, backed by five independent layers of which the last is a continuous negative-test probe — because isolation regresses silently and a leak looks like a successful response. Fair share is weighted by entitlement and depends on jobs being decomposable, because the estimation shows tenant peaks are calendar-correlated and therefore cannot be statistically multiplexed. And diagnostics are designed as a product surface, because the alternative — support with production data access — quietly ends the isolation model that everything else was built to protect.

---

### References

1. Microsoft — *Multi-tenant SaaS database tenancy patterns*, the canonical comparison behind §2's isolation-spectrum table.
2. AWS — *SaaS Tenant Isolation Strategies* whitepaper, including credential-scoped and policy-scoped isolation.
3. PostgreSQL docs — schemas, roles, `SET ROLE`, and Row-Level Security (the weaker alternative rejected in §2).
4. Google — *Borg* and *Omega* papers, for weighted fair-share scheduling and preemption of decomposable work.
5. Dominant Resource Fairness (Ghodsi et al., NSDI '11) — fair sharing across multiple resource types, relevant when tenants differ in CPU-versus-memory profile.
6. NIST SP 800-88 — media sanitisation, and the standing of cryptographic erasure referenced in §3.6.
7. GDPR Art. 17 and 28 — erasure, and processor obligations that make provable deletion contractual.
8. Modules 09 and 13 of this folder — the grid disciplines this platform's compute inherits, and the completeness-as-evidence pattern its probe mirrors.

---
## 13. Low-Level Design

**Requirements:** Tenant context cannot be absent; data access is credentialed per tenant; scheduling honours weighted shares; configuration is versioned and recorded with results.

**Class diagram:**
```mermaid
classDiagram
 class TenantContext {
 +Require$ TenantId
 +Enter(tenant)$ IDisposable
 }
 class ITenantConnectionFactory {
 <<interface>>
 +OpenAsync(tenant) Task~IDbConnection~
 }
 class IAnalyticsQuery {
 <<interface>>
 +ExecuteAsync(conn) Task~Result~
 }
 class FairShareScheduler {
 +SelectNext(queues) TenantId
 }
 class TenantConfiguration {
 +TenantId Tenant
 +Version ConfigVersion
 +AttributionConvention Convention
 +FactorModelId Model
 }
 class OnboardingVerifier {
 +VerifyAsync(tenant, expected) Task~OnboardingReport~
 }

 IAnalyticsQuery --> ITenantConnectionFactory
 ITenantConnectionFactory --> TenantContext
 FairShareScheduler --> TenantContext
```

**Sequence diagram:** the second diagram — the fail-closed data-access path.

**Design patterns used:** Ambient Context (tenant propagation); Abstract Factory (per-tenant connection resolution); Strategy (attribution conventions per tenant configuration); Bulkhead (per-tenant compute quotas); Interceptor (query-layer tenant enforcement, with the caveat that interceptors must not have invisible exceptions).

**SOLID mapping:** Single Responsibility (context propagation, connection resolution, and scheduling are separate); Open/Closed (a new attribution convention adds a Strategy; a new tenant adds configuration — neither touches the core); Liskov (every convention implementation must satisfy the same reproducibility and provenance contract, contract-tested); Interface Segregation (query and configuration interfaces separate); Dependency Inversion (queries depend on `ITenantConnectionFactory`, which structurally cannot produce an unscoped connection — the optimization).

**Extensibility:** A new tenant is configuration plus onboarding migration; a new analytic is a query registered into the enumerated set (which automatically brings it under the isolation test, — the extensibility and the safety mechanism are deliberately coupled).

**Concurrency/thread safety:** Tenant context uses `AsyncLocal` so it flows correctly across async boundaries without being passed explicitly — the mechanism that makes "forgetting to pass tenant" unrepresentable. The scheduler's credit accounting is the one shared mutable structure and requires synchronization; everything else is per-request or per-tenant isolated.

---

## 14. Production Debugging

**Incident:** During month-end, several tenants reported analytics requests timing out. Aggregate CPU utilization across the compute pool was ~55% — apparently ample headroom — yet requests were queuing.

**Root cause:** The fair-share scheduler allocated *task slots* per tenant, but tasks were wildly heterogeneous in memory footprint. One tenant's month-end scenario jobs each held a large in-memory position set. Their slot allocation was correctly within share, but their memory consumption exhausted the pool's memory long before CPU saturated. Workers on memory-pressured nodes began GC-thrashing, so tasks ran far slower without failing — and because CPU was the monitored saturation signal, the pool appeared healthy.

**Investigation:** The CPU-versus-queueing contradiction was the entry point. Per-node memory metrics showed pressure concentrated on nodes running that tenant's tasks; correlating task-to-node placement identified the tenant; examining task memory profiles showed the position-set footprint. The scheduler was working exactly as designed — against the wrong resource.

**Tools:** Per-node memory and GC metrics (which existed but were not part of the saturation dashboard); task-to-node placement correlation; per-tenant task memory profiling.

**Fix:** Multi-dimensional scheduling — tasks declare estimated memory alongside CPU cost, and the scheduler enforces share against both, refusing placement where memory would be exceeded even if CPU slots are free.

**Prevention:** (1) Saturation monitoring covering every constrained resource, not only CPU — the incident's core lesson is that a fair-share guarantee is only as good as the completeness of the resources it accounts for. (2) Require memory-cost declaration for new job types, mechanically coupled to job registration (the same registration-coupling discipline as §Advanced Q9 and). (3) Month-end load testing with realistic per-tenant job mixes, since the incident was only reachable under simultaneous heavy month-end usage — the exact condition the capacity estimate flagged as the platform's defining load characteristic.

---

## 15. Architecture Decision

**Context:** Choosing the tenant isolation model — the platform's foundational decision, expensive to change and determining the shape of every subsequent data-access decision.

**Option A — Shared everything, row-level discriminator:**
*Advantages:* Highest density and lowest cost; simplest operations (one database to back up, patch, monitor); trivial to add tenants.
*Disadvantages:* Every query must be correct forever, and the failure mode is a silent leak. Per-tenant restore is difficult since data is interleaved. Per-tenant encryption is impractical.
*Cost:* Lowest. *Complexity:* Lowest operationally, highest in required per-query discipline. *Risk:* Highest — the number of places a leak-causing mistake is possible equals the number of queries.

**Option B — Shared infrastructure, database or schema per tenant (recommended):**
*Advantages:* Isolation enforced at connection level, so a leak requires connecting to the wrong database — a rarer and more visible bug class than a missing filter. Per-tenant restore, encryption, and offboarding become natural. Supports Advanced Q2's dedicated-tier request as configuration rather than architecture.
*Disadvantages:* Operational overhead scaling with tenant count (migrations must run per tenant, connection pools multiply); cross-tenant platform analytics become harder (Expert Q3), which is arguably a feature.
*Cost:* Moderate. *Complexity:* Moderate operationally. *Risk:* Substantially lower — one chokepoint rather than N queries.

**Option C — Fully separate infrastructure per tenant:**
*Advantages:* Strongest isolation; per-tenant availability and performance guarantees trivially satisfied.
*Disadvantages:* Loses most multi-tenancy economics; every upgrade is a per-tenant rollout, which is the specific cost multi-tenancy exists to avoid.
*Cost:* Highest. *Complexity:* High. *Risk:* Lowest technically, highest commercially.

**Recommendation: Option B, with Option C available as a priced tier.** The decisive argument is not cost but the framing: these options differ in *how many places a mistake can cause a leak*, and Option A's answer is "every query, forever" — a standard that demonstrates real teams do not meet indefinitely, not through carelessness but because protections acquire exceptions. Option B reduces that to connection resolution, a single chokepoint that can be made structurally correct (the optimization) and tested exhaustively. Option C is the right answer only for tenants whose contractual requirements demand it, and Option B's design makes offering that tier a configuration change rather than a second architecture — which is why B is chosen not merely for its own properties but because it keeps C available cheaply.

---

## 17. Principal Engineer Perspective

**Business impact:** Multi-tenancy is what makes the platform economically viable, and isolation is what makes it sellable. These are in permanent tension — every density improvement pushes toward shared resources and every isolation improvement pushes away — so a Principal Engineer here is continuously arbitrating between the platform's economics and its core promise, rather than optimizing either alone.

**Engineering trade-offs:** the decision is the defining one, and its right framing — how many places can a mistake cause a leak — is more useful than the usual cost-versus-isolation framing, because it makes the risk comparable rather than abstract. A candidate who evaluates isolation models purely on cost and density has missed what actually differs between them.

**Technical leadership:** The isolation test (Intermediate Q2) is the single most important test in the codebase, and it will not be treated that way by default because it tests something that has never failed. Establishing that it gates every release, that new queries automatically join it, and that a failure is a stop-the-line event is a leadership act, not a technical one.

**Cross-team communication:** Sales will promise bespoke behaviour, dedicated resources, and absolute guarantees, because those close deals. Each promise is individually reasonable and collectively fatal (Expert Q10). A Principal Engineer must be in the room *before* commitments are made, and must make the shared-platform trade legible to commercial colleagues: the same property that keeps every client's costs low and upgrades free is what constrains bespoke accommodation.

**Architecture governance:** The isolation model, tenant-configuration surface, and quota policy should be ADRs with explicit change control, because each will face pressure from individual client requests that are locally reasonable and globally corrosive — and the ADR's purpose is to make that pressure visible rather than absorbed silently.

**Cost optimization:** Per-tenant resource attribution is the prerequisite for everything else — without it, the platform cannot know which tenants are profitable, cannot price growth (Expert Q2), and cannot make informed density decisions. Building attribution early is the highest-leverage cost investment, and retrofitting it is difficult.

**Risk analysis:** The dominant risk is a cross-tenant leak, which is existential rather than merely severe, has no natural detector (Advanced Q9), and cannot be reconciled against an external party as Modules 129–131 could. Risk registers must weight it accordingly, and specifically must resist the ordinary instinct to rank risks by likelihood — this one's consequence is severe enough that likelihood is nearly irrelevant to its priority.

**Long-term maintainability:** What erodes here is the isolation boundary's *uniformity* — new access paths, new caches, new integrations, each of which may not inherit the protections the original design established (exactly). The durable investment is making protections structural and automatic (per-tenant connections, enumerated tests) rather than conventional, since conventions do not survive team turnover and codebase growth.

---

**Next in this run:** Module 133 — Designing a Regulatory Reporting Pipeline: which shares this module's no-natural-detector property but replaces commercial pressure with an immovable external deadline, making completeness under time constraint the defining problem.
