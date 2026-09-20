# Observability — Cram Sheet

> Tier 2 · Source: `27-Observability/` (4 modules, 2,788 lines) · Read: 12 min

---

## 1. The three pillars — distinct data shapes, distinct query models

| | Shape | Answers | Cost driver |
|---|---|---|---|
| **Metrics** | numeric time series | *how much / how often* | **cardinality** |
| **Logs** | discrete events, high detail | *what exactly happened* | volume × retention |
| **Traces** | causally linked spans | *where did the time go* | sampling rate |

- **Monitoring vs observability:** monitoring answers questions you predicted; observability lets you answer ones you didn't — which requires **high-cardinality, high-dimension** data.
- **OpenTelemetry architecture:** **API** (what you instrument against, stable) → **SDK** (implementation) → **Collector** (receive, process, batch, export). The Collector is what **decouples instrumentation from backend** — you can change vendors without touching application code. Instrument once, export anywhere.

---

## 2. Metrics

- **Instrument types:** **Counter** (monotonic — request count) · **Gauge** (point-in-time — queue depth, memory) · **Histogram** (distribution — latency, sizes). **Use a histogram for latency; never an average.**
- **Cardinality is the central cost driver.** Every unique combination of label values is a separate time series. `userId` or a raw URL with IDs as a label = a **cardinality explosion** that will take down your metrics backend and your budget. Rule: **labels must be bounded and low-cardinality** (route template, status class, region, tenant tier). High-cardinality identifiers belong in logs and traces, not metric labels.
- **RED** for services (Rate · Errors · Duration) · **USE** for resources (Utilisation · Saturation · Errors) · **Four Golden Signals** (latency, traffic, errors, saturation).

---

## 3. Logs & Traces

- **Structured logging** — log an event with typed fields, never an interpolated string. `logger.LogInformation("Order {OrderId} failed {Reason}", id, reason)` so you can query on `OrderId`.
- **PII redaction at the point of emission**, not in the pipeline — once it's shipped, it's in someone's index and their backups.
- **Trace–log correlation:** include `TraceId`/`SpanId` in every log line. That's what turns "find the logs for this slow request" from grep into a click.
- **Distributed tracing internals:** a trace is a tree of spans; context propagates via the **W3C `traceparent`** header. **The silent-fragmentation risk:** any hop that doesn't propagate context (a legacy service, a queue without header support, a thread not flowing `ExecutionContext`) **breaks the trace into two disconnected traces** — and nothing errors. You just quietly lose the end-to-end picture.
- **Sampling:**
  - **Head-based** — decide at the start. Cheap, but you often discard the rare error you needed.
  - **Tail-based** — buffer the whole trace, decide after seeing the outcome, so you can **keep all errors and slow traces**. More expensive, needs the Collector.
  - **Exemplars** link a metric data point to a representative trace — the bridge from "p99 is bad" to "here is a p99 request."

---

## 4. SLI · SLO · Error Budget

- **SLI** = the measurement. **SLO** = the target. **SLA** = the contractual promise (with penalties) — always **looser** than the SLO.
- **SLI selection — the danger is measuring the wrong proxy.** CPU utilisation is not an SLI; it doesn't describe user experience. Good SLIs: availability (successful requests ÷ valid requests), latency (proportion faster than a threshold), correctness, freshness.
- **The 100% trap:** a 100% target is neither achievable nor desirable — it forbids all change. **The error budget is the point**: `budget = 1 − SLO`. 99.9% over 30 days = **43 minutes**.
- **Error budget policy** — pre-agreed consequences: budget healthy → ship features; budget exhausted → **freeze features and spend on reliability.** The value is that the argument is had *before* the incident.
- **Burn-rate alerting** beats threshold alerting: alert on how fast you are consuming the budget. **Multi-window, multi-burn-rate** — a fast window (e.g. 14.4× over 1h) pages, a slow window (e.g. 3× over 6h) raises a ticket. This gives fast detection of severe events without paging on slow ones.
- **Symptom-based, not cause-based alerting.** Page on "users cannot check out," not on "CPU > 80%." Cause-based alerts are noisy and miss the failures you didn't predict.
- **The alert-liveness gap — "no alert fired" is ambiguous:** it means either nothing is wrong, **or the alert is broken**. Verify alerts fire (synthetic failure injection, heartbeat/dead-man's-switch alerts). **This is a Principal-level point — most teams never test that an alert still works.**
- **Composite SLOs** across dependent services: series dependencies **multiply** (five 99.9% services in a chain = 99.5%).

---

## 5. Incident Response

- **Severity levels** defined by user impact, not by component. **Incident Commander** owns coordination (not fixing); separate roles for comms and ops.
- **Communication discipline** — regular updates on a fixed cadence even when there's nothing new, because silence generates escalation.
- **Blameless postmortem** — the purpose is converting one incident into a **systemic fix**. Human error is a symptom of a system that permitted it. Output: a timeline, contributing factors, and **action items with owners and dates** — an action-item list nobody owns is a postmortem that changed nothing.
- **Runbook staleness — "declared procedure ≠ verified procedure."** A runbook nobody has executed since it was written is a hypothesis. Verify by using it in game days, or by having the on-call follow it literally during real incidents and fix it in the moment.

---

## 6. Platform Architecture at Scale

- **Cardinality and cost governance** — without limits, one team's `userId` label bankrupts the platform. Enforce with metric-name/label allow-lists, per-team quotas and cost attribution.
- **Tiered storage economics:** hot (expensive, fast, days) → warm (weeks) → cold/object storage (compliance retention, slow). Retention is a cost decision, and in finance also a compliance one.
- **Self-service golden-path provisioning** — a new service gets dashboards, alerts and SLOs from a template, or it gets none.
- **"Verify the verifier"** — three layers: is the system healthy? is the *monitoring* healthy? is the *alerting* healthy? Each needs its own signal.
- **The platform's own governance drift** — the golden path is updated, the 200 existing services are not.

---

## Top traps

1. Averages for latency instead of histograms/percentiles.
2. **High-cardinality labels** (`userId`, raw URL) on metrics.
3. Cause-based paging (CPU > 80%) instead of symptom-based.
4. A 100% SLO target.
5. No error-budget policy → the reliability argument happens during the outage.
6. Assuming "no alert fired" means "nothing is wrong."
7. Broken trace context propagation (silent, no error).
8. Head-based sampling discarding the errors you needed.
9. Unstructured/interpolated log messages.
10. Postmortem action items with no owner or date.

---

## Interview Q&A — Lead / Principal

### Q1 · Alert fatigue *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"On-call gets 40 pages a week. Most are acknowledged and ignored. Fix it."*

**Answer.** Forty pages a week means the alerts carry no information — the team has correctly learned to ignore them, and the real risk is that a genuine incident is now indistinguishable from noise. I'd start by classifying a month of pages: which were **actionable** (someone did something), which were **self-resolving**, which were duplicates of one cause. Usually 80% fall into the last two.

Then the structural change: move from **cause-based to symptom-based** alerting. "CPU > 80%" is a cause and may be entirely fine; "checkout success rate is below SLO" is a symptom and is always worth waking someone for. Define SLIs from the user's perspective, set an SLO leaving a real error budget, and alert on **burn rate with multiple windows** — a fast burn pages, a slow burn raises a ticket. That single change typically removes most of the volume, because the alerts that vanish are the ones that never mapped to user impact.

The rule I'd enforce: **every page must have a documented action.** If the runbook says "check if it resolves itself," it's not a page. And anything not actionable becomes a dashboard or a ticket.

Then the inverse risk, which nobody raises and which I'd flag: after cutting 40 to 4, **"no alert fired" is ambiguous** — it means either nothing is wrong or the alerting is broken. So I'd add heartbeat/dead-man's-switch alerts and periodically inject synthetic failures to prove the alerts still fire. Otherwise you've traded noise for false confidence.

**Why it lands.** Data-driven triage, symptom-over-cause with burn rates, an enforceable rule, and the alert-liveness gap that follows the fix.
**✗ Weak answer.** "Tune the thresholds" or "add more filtering."
**↳ Follow-ups.** What's your SLI for checkout? How do you test that an alert still works?

---

### Q2 · The trace that stops halfway *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Traces show the request entering the gateway and the order service, then nothing — but the payment service definitely ran."*

**Answer.** Context propagation broke at that hop, and the important property is that it fails **silently**: nothing errors, you simply get two disconnected traces instead of one and lose the end-to-end picture. Usual causes: a hop that doesn't forward the **W3C `traceparent`** header — often a legacy service, a third-party SDK, or a hand-rolled HTTP client that doesn't use the instrumented handler; a message queue where headers aren't carried through the broker, which is the most common one; or a thread or background task where `ExecutionContext` didn't flow, so the ambient `Activity` was lost.

Diagnosis is to check whether the payment service *received* a `traceparent` at all — if not, it's the caller; if yes but it started a new root, it's the receiving instrumentation.

Prevention is what I'd push: propagation should come from a shared, instrumented client rather than being each service's responsibility, and I'd add a **synthetic end-to-end probe that asserts a single trace id spans all hops**. Because this is exactly the class of failure that has no detector — everything looks healthy, and you only discover it during an incident when you need the trace most.

**Why it lands.** Names the silent-failure property, three concrete causes including the queue case, and builds the detector for a gap discovered at the worst time.
**✗ Weak answer.** "Check if tracing is enabled on that service."
**↳ Follow-ups.** How do you propagate through Kafka? What sampling strategy keeps the errors?

---

### Q3 · Observability costs more than the platform *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"Our Datadog bill is now 15% of infrastructure spend. Cut it without going blind."*

**Answer.** The driver is almost always **cardinality** on metrics and raw volume on logs, and both are usually one or two teams. Every unique label combination is a separate time series, so a `userId` or a raw URL with ids in a metric label doesn't cost a bit more — it multiplies. So: find the top cardinality contributors, replace unbounded labels with bounded ones (route template, status class, tenant tier), and push the high-cardinality identifiers into traces and logs where they belong.

Logs: sample aggressively at INFO, keep all errors, and use **dynamic log levels** so you can raise verbosity on one service during an incident rather than paying for DEBUG everywhere permanently. Traces: **tail-based sampling** so you keep all errors and slow traces and discard the boring successful ones — that's usually a large cut with almost no loss of diagnostic value. Then **tiered retention**: hot for days, warm for weeks, cold object storage for the compliance window, because retention is where the long tail of cost hides.

The governance half, or it regresses within two quarters: per-team cost attribution and quotas, so the team generating the cardinality sees the bill. And I'd draw a line — I'm not cutting the signals that back our SLOs or the audit-retention we're legally required to keep, and I'd say that explicitly so the target is agreed rather than assumed.

**Why it lands.** Diagnoses cardinality specifically, gives per-signal levers, adds attribution so it sticks, and refuses the cuts that shouldn't happen.
**✗ Weak answer.** "Reduce retention" alone, or "switch vendors."
**↳ Follow-ups.** What cardinality limit would you enforce? What do you keep at any price?

---

### Quick-fire (30 seconds each)

- **"What's the difference between monitoring and observability?"** → Monitoring answers questions you thought of in advance — dashboards and thresholds for known failure modes. Observability is being able to answer questions you didn't anticipate, which in practice means high-cardinality, high-dimension data you can slice after the fact. The tell is whether you can ask "which tenants on which build in which region saw this?" without shipping new instrumentation first.
- **"How would you design alerting?"** → Symptom-based and budget-based. I'd define SLIs from the user's view — successful requests over valid requests, and latency under a threshold — set an SLO that leaves a real error budget, then alert on burn rate with multiple windows: a fast burn pages, a slow burn raises a ticket. That gives fast detection without paging on slow degradation. And I'd verify the alerts actually fire, because "no alert fired" otherwise just means "we don't know."
- **"Why do you care about metric cardinality?"** → Because every unique label combination is a separate time series, so putting a user ID or a raw URL in a label doesn't cost a little more — it multiplies. I've seen that take down the metrics backend and the budget at once. The rule is labels must be bounded: route template, status class, region, tenant tier. Anything unbounded belongs in logs or traces, and you bridge from a bad p99 to a specific request with exemplars.

---

**Go deeper:** `27-Observability/01`–`04` · **Related:** [[29-Performance-Engineering]], [[17-Microservices]], [[25-DevOps-CICD]]
