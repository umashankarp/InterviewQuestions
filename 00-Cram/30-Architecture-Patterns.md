# Architecture Patterns & Decision-Making — Cram Sheet

> Tier 2 · Source: `30-Architecture-Patterns/` (4 modules, 3,353 lines) · Read: 12 min
> This is the **Principal-level** sheet — how you decide, not what you build.

---

## 1. Architectural Styles

| Style | Deploy | Data | Use when | Cost |
|---|---|---|---|---|
| **Monolith** | one unit | one DB | small team, early product, unclear domain | scaling and deploy coupling |
| **Modular Monolith** | one unit, enforced module boundaries | one DB, **schema per module** | you want the boundaries without the distribution | needs real enforcement or it rots |
| **SOA** | services + **ESB** | shared/varied | legacy enterprise integration | the ESB becomes the bottleneck and the coupling point |
| **Microservices** | many | **DB per service** | independent scaling/deploy, multiple teams | distributed-systems tax on everything |
| **Serverless** | functions | managed | spiky, event-driven, low ops appetite | cold starts, vendor lock-in, limits |

- **In-process call ≈ nanoseconds; inter-process ≈ 0.5–1 ms same-DC.** That is a **~10,000× difference** — the single number that justifies the modular monolith. Distribution is not free refactoring.
- **Modular monolith enforcement in .NET:** separate projects with a controlled reference graph, `internal` + `InternalsVisibleTo` discipline, one schema per module, and an **architecture test in CI**. Without enforcement it is just a monolith with folders.
- **The recommended default: start modular monolith, extract when a specific pressure appears** (independent scaling, independent deploy cadence, team autonomy, differing availability requirements). Extracting on a proven boundary is cheap; guessing is not.

---

## 2. Evolutionary Architecture

- **Fitness function** = an automated, executable test of an architectural characteristic, wired into CI. If an architectural rule is not executable, it will decay.
  - Examples: dependency-direction tests (NetArchTest), **cycle detection** in the module graph, p99 latency budget in a load test, bundle-size cap, "no new `catch (Exception)`", coupling-count thresholds, security policy-as-code (OPA).
  - **CI-time** (structure, dependencies, build output) vs **production-time** (latency, error budget, cost) — you need both; the second class is what most teams lack.
- **ADR (Architecture Decision Record)** — one short markdown file per decision: **Context · Decision · Status · Consequences**, numbered, immutable, superseded rather than edited. Stored in the repo next to the code.
  - **The value is the *consequences* section and the record of what you rejected and why** — it is what lets a future team re-open the decision knowingly instead of blindly.
- **Hidden costs:** fitness functions need maintenance and can become flaky gates people bypass; ADRs rot if writing them isn't part of the definition of done.

---

## 3. Migration Patterns

- **Strangler Fig** — a façade routes traffic, capability by capability, from old to new until the old system is dead. Incremental, reversible at each step.
- **Branch by Abstraction** — "branching without a branch": introduce an abstraction over the existing implementation, add the new implementation behind it, switch by flag, remove the old. **Keeps trunk-based development working during a long migration** — no long-lived feature branch.
- **Parallel Run (shadow traffic)** — run old and new simultaneously on real traffic, compare outputs, serve only the old. **The side-effect suppression problem is the hard part**: the shadow path must not send emails, charge cards, or write to shared state. Plus you must decide what an acceptable divergence rate is *before* you start.
- **Anti-Corruption Layer** — **translation depth, not just field renaming.** A real ACL translates *semantics* (different status lifecycles, different identity schemes, different error models), and that is where the work is.
- **Dual write vs CDC:**
  | | Dual write | CDC |
  |---|---|---|
  | Mechanism | app writes both stores | reads the transaction log |
  | Failure | **partial write ⇒ permanent divergence** | lag, but no divergence |
  | Complexity | low to start | more infrastructure |
  - **Prefer CDC.** If you must dual-write, reconcile continuously and treat divergence as expected.
- **Expand–Contract (parallel change)**, generalised to a whole store: **expand** (add the new column/table/store, write to both, read from old) → **migrate** (backfill, then read from new) → **contract** (stop writing the old, drop it). Each step is independently deployable and reversible.
- **Cutover: gradual, percentage-based is cheaper to roll back than any other step.** 1% → 5% → 25% → 100%, with an automated abort on error rate or divergence.
- **"Old systems never die"** — budget and schedule decommissioning explicitly, or you permanently run both.

---

## 4. Trade-off Analysis (the Principal skill)

- **ATAM vocabulary:**
  - **Sensitivity point** — a decision that strongly affects **one** quality attribute.
  - **Trade-off point** — a decision that affects **two or more, in opposite directions**. *These are the only decisions worth a long meeting.*
  - **Risk** — a decision whose consequence you cannot yet predict.
- **The decision matrix is a debate-enabling tool, not an objective verdict.** Weighted scores manufacture false precision; use it to surface *why* people disagree about the weights.
- **Reversibility is the master variable governing how much analysis to do.**
  - **Two-way door** (easily reversed) → decide fast, in the team, move on.
  - **One-way door** (data model, public API contract, vendor lock-in, a security boundary) → deep analysis, written ADR, broad review.
  - Most decisions are two-way doors treated as one-way. That mis-classification is where architecture teams lose months.
- **Cost is a first-class, frequently under-weighted quality attribute** — both cloud spend and **engineering time over years**.
- **Opportunity cost** — the comparison against the road not taken, including "do nothing" and "buy."
- **The recursive risk: verify the analysis's own predictions.** An ADR that predicted "this will scale to 10k TPS" should be revisited against reality. Almost nobody does this; saying you would is a strong Principal signal.

---

## Top traps

1. Microservices as a default instead of a response to a specific pressure.
2. Modular monolith with no enforced boundaries.
3. Architectural rules that aren't executable → decay.
4. ADRs edited in place instead of superseded.
5. Parallel run with unsuppressed side effects.
6. Dual write chosen over CDC without acknowledging divergence.
7. Big-bang cutover instead of percentage-based.
8. Treating a two-way door as a one-way door (and vice versa).
9. A weighted decision matrix presented as objective truth.
10. No decommissioning plan.

---

## Interview Q&A — Lead / Principal

### Q1 · Migrating a legacy monolith *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"You own a 12-year-old .NET Framework monolith. 800k lines. The business wants modernisation. Where do you start?"*

**Answer.** Not with a rewrite — a big-bang rewrite of a 12-year-old revenue system is the most reliably failing project in our industry, because you spend two years reproducing behaviour nobody documented while the original keeps changing underneath you. I'd start by asking what outcome the business actually wants, because "modernisation" is never the goal: it's usually release speed, hiring, cloud cost, or an unsupported dependency. Each implies a different first move, and some don't require touching the monolith at all.

Assuming it's release speed and risk, the approach is **Strangler Fig**: a façade in front, route one capability at a time to new services, delete the old code when traffic reaches zero. Sequencing matters more than the pattern — start with something **high-value, low-coupling and reversible**, usually a read-heavy capability at the edge, not the ledger. The goal of the first extraction is to prove the pattern and build the pipeline, not to capture the biggest prize.

The hard part is always **data**, not code. I'd use expand–contract and prefer **CDC over dual-write**, because a dual write that partially fails diverges permanently with no retry that fixes it. And **branch by abstraction** so this happens on trunk rather than a long-lived branch that never merges.

Two things I'd insist on up front: **budget the decommissioning explicitly**, because old systems never die on their own and running both forever is the actual failure mode of these programmes; and instrument the monolith first, because you can't safely extract what you can't observe.

**Why it lands.** Challenges "modernisation", sequences for proof over prize, names data as the hard part, and budgets decommissioning — which is where these programmes actually fail.
**✗ Weak answer.** "Rewrite it in .NET 9 as microservices."
**↳ Follow-ups.** Which capability would you extract first and why? What if the business wants a date for "done"?

---

### Q2 · How much analysis does a decision deserve? *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"Your architecture review board has a six-week queue. Fix it."*

**Answer.** The queue exists because everything is being treated as though it needs the same scrutiny, and the fix is to route by **reversibility**. Two-way doors — most framework and library choices, internal service design — get decided in the team, same week, with a written record. One-way doors — the data model, a public API contract, a security boundary, vendor lock-in, anything crossing a compliance line — get the deep review. Most decisions in a six-week queue are two-way doors being treated as one-way, and that misclassification is where architecture functions lose their credibility.

So: publish the decision-rights model — what teams decide alone, what needs a consult, what needs the board — and make the default "the team decides." Then replace as much review as possible with **automation**: a policy check in CI beats a human reviewing a diagram, because it runs on every change instead of once, and it can't be charmed. The board's remaining job is the genuinely irreversible set, plus reviewing the *outcomes* of past decisions.

The measure of success is **speed of good decisions**, not number of reviews completed. And I'd add the thing almost nobody does: revisit past ADRs against what actually happened, because a board that never checks its own predictions has no feedback loop and will drift from reality.

**Why it lands.** Reversibility as the routing variable, automation over review, and verifying the board's own predictions.
**✗ Weak answer.** "Add more reviewers" or "meet more often."
**↳ Follow-ups.** Who decides what's a one-way door? What goes in an ADR?

---

### Q3 · Stopping architecture from decaying *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"We agreed on a layered architecture two years ago. It's now spaghetti. Why, and what do you do?"*

**Answer.** Because it was enforced by documentation and review, and both fail predictably: reviewers get tired, deadlines win, and every individual exception is reasonable. **An architectural rule that isn't executable will decay** — that's not a team failure, it's a structural one.

The fix is **fitness functions**: make the rule a test that fails the build. In .NET the strongest version is the **project-reference graph itself**, so Domain literally cannot compile a reference to EF Core — enforced by the compiler, not by a person. On top of that, NetArchTest or ArchUnitNET assertions in CI for the rules the compiler can't express, plus cycle detection in the module graph.

Then the class most teams miss — **production-time** fitness functions, not just CI-time: a p99 latency budget, an error budget, a cost-per-transaction ceiling. Structure is only half of architecture.

For recovery from the current state: don't try to fix it all. Write the test that asserts the rule, let it fail, then **ratchet** — record the current violation count as the baseline and fail the build only if it *increases*. That stops the bleeding immediately without a six-month cleanup nobody will fund, and the number comes down opportunistically as people touch the code.

**Why it lands.** Diagnoses decay as structural, gives compiler-level enforcement, adds production-time functions, and the ratchet makes it actionable today.
**✗ Weak answer.** "More rigorous code review" or "write better documentation."
**↳ Follow-ups.** What if the ratchet never goes down? Which rules can't be automated?

---

### Quick-fire (30 seconds each)

- **"Monolith or microservices?"** → Start with a modular monolith and extract on evidence. An in-process call is nanoseconds and a network call is roughly half a millisecond — four orders of magnitude — so distribution buys independent scaling and deployment at a real, permanent cost in latency, failure modes and operational surface. I'd extract when there's a named pressure: a capability that must scale separately, a team that needs its own cadence, or a different availability requirement. Guessing boundaries up front is the expensive mistake, because unpicking a wrong service is far harder than moving a namespace.
- **"How do you stop architecture decaying?"** → Make the rules executable. Dependency-direction and cycle-detection tests in CI, plus production-time fitness functions for latency, error budget and cost — the second class is what most teams miss. And ADRs as part of the definition of done, capturing consequences and rejected options, so a future team can re-open a decision knowingly. Anything enforced only by review will be violated within a quarter.
- **"How much analysis does a decision deserve?"** → It scales with reversibility. Two-way doors — most framework and library choices — get decided in the team in an afternoon. One-way doors — the data model, a public API contract, a security boundary, vendor lock-in — get an ADR and broad review. The failure I see most is treating reversible decisions as irreversible, which burns months, and occasionally the reverse, which is worse.

---

**Go deeper:** `30-Architecture-Patterns/01`–`04` · **Related:** [[17-Microservices]], [[31-DDD]], [[14-System-Design-Core]], [[51-Engineering-Leadership]]
