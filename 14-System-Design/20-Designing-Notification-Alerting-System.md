# Module 180 — System Design: Designing a Notification & Alerting System

> Domain: System Design | Level: Beginner → Expert | Prerequisite: [[01-System-Design-Fundamentals]], [[03-Designing-Chat-Messaging-System]] (delivery guarantees and ordering for a *connected* recipient — this module is the same problem when the recipient is unreachable and the transport belongs to Apple, Google, or a carrier), [[15-RateLimiting-Throttling-LoadShedding-Algorithms]] (the per-user caps and load-shedding lanes §12 Step 3 depends on), [[16-Interview-Execution-Playbook-Estimation-Rubric]], [[18-Designing-Payment-Processing-DoubleEntry-Ledger]] (idempotency, settlement-file reconciliation, and the silent-discard defect class — all three recur here in a different costume), [[../37-Outbox/01-OutboxFundamentals-TableDesign-RelayMechanisms-DeliveryGuarantees]], [[../19-Kafka/01-Architecture-Partitioning-Replication-ConsumerGroups]]

---

**Why this module exists.** This folder's own backlog listed *notification & push delivery* as the second-highest-value uncovered question class, behind search (Module 179). It is asked at Stripe, PayPal, Capital One, Visa, JPMorgan, Amex, and every consumer fintech — and it is asked *because it sounds trivial*. "Send the user an email" is a one-line function call. The interviewer is watching for the moment you realise it is not a function call but a **distributed delivery system whose definition of success is owned by infrastructure you do not operate, cannot inspect, and cannot fix.**

The distinguishing property: **you never actually deliver anything.** Apple delivers. Google delivers. A carrier delivers. Gmail's spam filter decides. Every "delivered" your system records is hearsay reported by a third party, asynchronously, sometimes hours later, sometimes never. Almost every hard decision in this design descends from that one constraint — and in a regulated firm it collides with a second one: some of these messages are **legally significant communications** (margin calls, NSF notices, SCA challenges, breach notifications) where non-delivery is a loss event and over-delivery is a consent violation.

**This is also the first module authored under the four-step System Design standard** adopted 2026-08-09 (see `CLAUDE.md`): §12 follows the *System Design Interview* / Pragmatic Engineer payment-chapter spine — scope dialogue → high-level design with real APIs and schemas → deep dive → wrap-up → references — and is deliberately the largest section in this file.

---

## 1. Fundamentals

### What is a notification system?

A notification system accepts an **intent to inform a person** and converts it into one or more **messages** delivered over channels it does not own. It sits between *N* internal producers ("the payment settled", "this login looks fraudulent", "your margin is short $40k") and a handful of external transports (APNs, FCM, SMTP relays, SMS aggregators), and its job is everything in between: who should hear this, on which channel, in what language, are they allowed to receive it, have we already told them, and can we prove we told them.

### The four facts people conflate

The single most common failure in an interview answer — and in production — is treating these as one thing:

| Fact | Who establishes it | When you learn it | Can you trust it? |
|---|---|---|---|
| **Accepted** | You | Immediately | Yes — it is your own record |
| **Dispatched** | You | Immediately | Yes — but only means *handed over* |
| **Delivered** | The provider / OS / carrier | Seconds to hours later, asynchronously, or never | Partially — semantics vary wildly per channel |
| **Seen** | The human | Only for channels with an open/read signal | No — absence of a read is not absence of reading |

A system that stores one `status` column and writes `SENT` into it after an HTTP 202 has silently declared *accepted by our own code* to be *the user was informed*. §4's incident is exactly that mistake costing a firm a regulatory finding.

### Why it matters (and why fintech raises the bar)

In a consumer app, a missed push is an annoyance. In a regulated financial firm the same pipeline carries:

- **Strong Customer Authentication / OTP** — non-delivery blocks the customer from transacting at all; the notification system becomes a **hard dependency of the payment flow**, which is an availability coupling most teams never notice until an SMS aggregator has an outage and card authorisations fail.
- **Margin calls and liquidation notices** — the firm's right to liquidate frequently depends on having *given notice*. Delivery evidence is the legal artefact.
- **Fraud alerts** — value decays with latency; a fraud alert delivered in 30 minutes is worth nearly nothing.
- **Regulatory disclosures and breach notifications** — deadlines are statutory.
- **Marketing** — governed by consent law (GDPR, TCPA, CAN-SPAM, PECR). Sending one message to one user who opted out is a per-message statutory violation, not a bug.

So this system has an unusual shape: it must be **highly available for a subset of traffic, provably auditable for a different subset, and legally suppressible for a third**, and those subsets are distinguished only by a `category` field that some producer team set correctly — or didn't.

### When you need a real system rather than a library

You need this system when any two of these are true: more than one channel; more than one producing service; user-controlled preferences; retention/audit obligations; volume above a few hundred per second; or any message whose non-delivery costs money. Below that, a queue and an SMTP client is the correct, honest answer, and saying so in an interview is a *strength* — over-engineering is scored against you.

### How it works — 30,000 feet

```
event → resolve recipients → resolve consent & preferences → select channels
      → render from template → deduplicate → rate-limit → dispatch to provider
      → record dispatch → ingest receipts (async) → reconcile against provider truth
```

Every arrow after "dispatch" is where the interesting failures live.

---

## 2. Deep Dive

### 2.1 The fan-out amplification chain, and where to expand it

One business event does not equal one message. The chain is:

```
1 event → R recipients → C channels per recipient → D endpoints per channel
```

A "your fund's NAV was restated" event to a fund with 40,000 holders, at 1.4 channels and 2.3 devices per push channel, is roughly 40,000 × 1.4 × ~1.8 ≈ **100,000 dispatches from a single Kafka message**. The design question is *where in the pipeline the row count multiplies*, because everything downstream of the expansion point pays the multiplied cost — storage, queue depth, retries, and audit rows.

Three placements:

- **Expand at the producer.** The producing service emits one message per recipient. Terrible: every producer re-implements audience resolution, and a 100k-row expansion happens inside a service that was designed for one-row transactions.
- **Expand at ingest.** The gateway resolves the audience synchronously and enqueues N messages. Simple, but a 100k expansion blocks an HTTP request and makes the ingest tier's latency a function of audience size.
- **Expand late, in a dedicated resolver, streaming.** The gateway accepts a *notification request* referencing an audience, acknowledges immediately, and a resolver expands it into per-recipient work items in batches. This is the correct answer at scale and is what §12 designs.

The corollary that separates a Staff answer: **late expansion means the per-recipient rows do not exist yet when you acknowledge**, so "did this campaign go out?" cannot be answered by counting rows. You need an explicit expansion-progress record, or you have built a system that cannot tell "not sent yet" from "never will be".

### 2.2 Preferences, consent, and why the check must happen at dispatch time

Preferences look like a lookup: `SELECT allowed FROM preference WHERE user_id=? AND category=? AND channel=?`. The subtlety is *when*.

Consider a campaign expanded at 09:00 into 20 million work items, drained over 40 minutes. A user unsubscribes at 09:12. If consent was evaluated during expansion, that user receives a message after opting out — and "we had already queued it" is not a defence under GDPR Art. 21 or TCPA. Therefore:

**Consent is evaluated at the last possible moment before dispatch, not at enqueue.** The queued work item carries the *intent*; the adapter performs the *authorisation*.

Two further distinctions that candidates routinely miss:

- **Preferences ≠ consent.** A preference is a user's UI toggle. Consent is a legal record with a timestamp, a source, and evidence (who ticked what, where, when, under which privacy notice version). Preferences can be edited; consent records are **append-only** for the same reason ledger entries are (Module 178 §2.1).
- **Mandatory categories exist and cannot be opted out of.** A fraud alert, an SCA challenge, and a regulatory notice are not marketing. Modelling this as "a preference that defaults to on" is a defect waiting to happen — someone will build an admin tool that sets all preferences off. Model it as a property of the **category**: `is_suppressible: false`, enforced in the policy engine, so the bad state is unrepresentable rather than merely discouraged.

### 2.3 Deduplication and the scope trap

Duplicate notifications come from four independent sources, and a design that addresses only one is incomplete:

1. **Producer retry** — the producing service's HTTP call timed out and it retried.
2. **Broker redelivery** — at-least-once consumption after a rebalance or a failed commit.
3. **Business-logic duplication** — two services both decide to notify about the same event (the classic: the payment service and the ledger service both announce a settlement).
4. **Provider-side duplication** — rare, but SMS aggregators and email relays do occasionally double-submit downstream.

Only (1) and (2) are solved by an `Idempotency-Key`. (3) requires a **business dedup key** derived from the *event*, not the *request*: `hash(user_id, category, business_event_id, coalescing_window)`. (4) is not solvable from your side at all and is why receipts and reconciliation exist.

The trap — and it is the same defect class as Module 178 §4's per-processing-centre settlement reference — is **key scope**. Every one of these is a real bug seen in production:

| Wrong key | Failure |
|---|---|
| Includes a timestamp taken at send time | Every retry produces a new key; dedup never fires |
| Includes `attempt_no` | Same |
| Excludes `channel` | User gets the push, then the email is suppressed as a duplicate — the fallback silently disappears |
| Excludes `user_id`, scoped only to the event | A 40,000-recipient event delivers to exactly one person |
| Scoped per consumer instance | Dedup works until you scale out |

**Rule:** over-scoping a dedup key costs an extra message; under-scoping loses messages silently. When in doubt, over-scope — and put a counter on every suppression path so "we deduplicated 4 million messages today" is a graph somebody can see, not an invisible success.

**TTL is part of the key design.** A dedup entry with a 60-second TTL does not protect against a redelivery that happens eight minutes later. The window must exceed the **maximum redelivery horizon**, which is set by your slowest dependency's timeout budget and your broker's rebalance behaviour — not by whatever Redis TTL felt reasonable. §14 is an incident caused precisely by getting this backwards.

### 2.4 Push token lifecycle — the part that quietly rots

Device tokens are not stable identifiers. They rotate on app reinstall, OS restore-from-backup, and occasionally at the vendor's discretion. A registry that only ever inserts becomes a registry where a large fraction of rows are dead, and dead tokens are not free: they consume dispatch capacity, inflate your "sent" counts, and — for APNs — burn quota.

The lifecycle you must handle:

- **Registration/refresh** — the client sends its token on every launch. Upsert keyed by `(user_id, platform, token)`, and critically **also** handle the case where the same token now belongs to a *different* user (a shared or resold device). Failing to reassign is a genuine data-leak vector: user B receives user A's balance alerts.
- **Invalidation signals** — APNs returns `410 Gone` with `Unregistered`; FCM returns `UNREGISTERED` or `INVALID_ARGUMENT`. These are **not retryable errors, they are facts**, and must write back to the registry immediately. A system that treats them as transient failures retries dead tokens forever.
- **Aging** — a token not refreshed in ~90 days is almost certainly dead even without an explicit signal. Age it out on a schedule, but *soft-delete* it, because "we stopped notifying this user" needs to be explicable.

Email has the analogue: **hard bounce vs. soft bounce**. A hard bounce (`550`, mailbox does not exist) must land on a suppression list permanently; a soft bounce (`4xx`, mailbox full, greylisting) must be retried with backoff. Treating them the same either destroys deliverability (retrying hard bounces tanks sender reputation, which is a *shared* resource across every message your domain sends) or loses messages (suppressing on a transient 4xx).

### 2.5 Sender reputation as a shared-fate resource

This has no analogue in most system-design questions and is worth raising unprompted. Email deliverability is governed by the reputation of your sending domain and IP pool. One bad campaign — high bounce rate, high spam-complaint rate — degrades delivery of *every* message from that domain, including your OTPs and fraud alerts.

The architectural consequence: **segregate reputation by traffic class.** Transactional mail goes out on a different subdomain and IP pool from marketing mail (`alerts.bank.example` vs `news.bank.example`), with separate warm-up, separate DKIM keys, and separate monitoring. This is a design decision that costs nothing to make on day one and is very expensive to retrofit, which is exactly the kind of thing a Principal candidate is expected to surface.

SMS has the parallel: short codes, long codes, and alphanumeric sender IDs have different throughput, different per-country legality, and different filtering behaviour. Carriers silently drop traffic that looks like spam, and "silently" means *the aggregator still reports success*.

### 2.6 Storms, coalescing, and priority

Notification load is not Poisson; it is **event-correlated**. A market circuit-breaker, an index rebalance, an outage at a partner bank, or a mass fraud campaign produces a step function: 20 million price alerts in 90 seconds is 15× steady state and will arrive as one burst.

Three mechanisms, and they are complementary rather than alternative:

- **Per-user caps** (token bucket, per category — see Module 175 for the algorithms). Protects the *human* from being spammed. A user with 400 price alerts wants a digest, not 400 pushes; and 400 pushes will get your app's notification permission revoked, which is unrecoverable.
- **Coalescing / digesting** — hold a window (30s–5min by category), collapse N alerts into one. Push platforms support this natively at the client: APNs `apns-collapse-id` and FCM `collapse_key` cause a new message to *replace* an undelivered older one with the same key on the device. This is the correct mechanism for supersedable content (account balance, order status) and the wrong one for accumulative content (three separate payments).
- **Priority lanes as separate topics, not a priority field.** A `priority` column in a single queue does nothing when the queue is 20 million deep — the transactional message is still behind them in the partition. Physical separation (separate Kafka topics, separate consumer groups, separate provider credentials and quota) is what actually guarantees an OTP is not stuck behind a campaign. This is the same "isolation must be structural, not advisory" pattern this course has hit in Kubernetes (Modules 74–76) and multi-tenancy (Module 12).

Under sustained overload, **shed by priority**: drop marketing entirely, degrade digests to lower resolution, and never touch the mandatory lane.

### 2.7 Rendering: where, and with what

A notification request can carry either **rendered text** or **a template ID plus variables**. This looks like a style choice; it is a security and correctness decision.

Carrying rendered text means every queue, log, retry record, and DLQ entry contains the final message — which for "Your balance is $4,182.19" is customer financial data at rest, replicated across a broker, an object store, and every engineer's DLQ-inspection tool. Carrying `template_id + {balance: "4182.19"}` is no better *unless* the variables themselves are tokenised, which is usually impractical.

The workable position, and the one §12 adopts:

- Carry `template_id` + variables; **render at the last hop**, inside the channel worker.
- Classify templates by data sensitivity, and for high-sensitivity templates carry only **references** (`account_ref`), resolving them at render time from the owning service.
- For push specifically, prefer a **content-free or content-light payload** for sensitive categories — "You have a new secure message" — because a push payload renders on a locked screen in public. Rich content lives behind authentication in the app.
- Version templates, and store the **rendered output hash plus template version** on the delivery record rather than the rendered text, so you can prove what was sent without retaining the text itself. For legally significant notices, retain the full rendered artefact deliberately, in the archive tier, with its retention clock — that is a small, classified subset (§12 Step 1 shows the arithmetic that makes this the decisive storage decision).

### 2.8 Delivery receipts and reconciliation

This is Module 178's settlement reconciliation with different nouns, and recognising that out loud is worth real credit.

Providers report outcomes on two paths: **webhooks** (near-real-time, unreliable, at-least-once, out-of-order) and **files/reports** (nightly, complete, authoritative). You need both, for the same reason payments needs both the API response and the settlement file: the fast path tells you quickly, the slow path tells you *truly*.

Break classification:

| Break | Meaning | Handling |
|---|---|---|
| Dispatched, no receipt, aged beyond channel SLA | We think we sent it; the provider has no record | Investigate; likely a lost dispatch or a receipt-ingest gap |
| Receipt with no matching dispatch | Provider delivered something we didn't record | Serious — indicates duplicate submission or a lost write |
| Terminal-state mismatch (we say delivered, file says failed) | Webhook lied or was superseded | File wins; correct the record |
| Counts match, per-segment counts don't | Concentrated failure hidden by an aggregate | The dangerous one — see below |

Two rules carried over from Module 178 and worth stating verbatim in an interview:

1. **Reconcile even when the provider claims to be authoritative.** Providers have bugs, and "their number and our number agree" is the only evidence you actually have.
2. **Detect on *aging*, not on rate.** "5% of dispatches have no receipt" is a ratio that stays flat while a specific carrier, a specific country, or a specific template silently stops working. "1,400 dispatches are older than 4 hours with no terminal state, and 1,380 of them are on one carrier" is a detector. Aggregates cannot see concentrated failures — this folder's own recurring finding, arriving here for the fourth time.

### 2.9 Ordering, supersession, and the OTP problem

Notifications are mostly order-insensitive, which is a relief — but not entirely, and the exceptions are the ones that generate incidents:

- **OTPs supersede.** If a user requests a code twice, receiving the older code second is a support ticket at best. Solution: a per-user-per-category sequence number, with the client and the dispatcher both dropping anything below the high-water mark, plus collapse keys so the device shows only the latest.
- **State updates supersede.** "Order shipped" arriving after "Order delivered" is wrong. Same mechanism.
- **Ledger-style events accumulate and must not be collapsed.** Three payment receipts are three facts.

The design rule: **supersession is a property of the template/category, declared once, not decided per message.** If a category is `supersedable: true`, the pipeline attaches a collapse key and a sequence; otherwise it does not. Leaving this to producers guarantees inconsistency.

### 2.10 Multi-region and data residency

An EU customer's phone number, email address, and message content are personal data. If your notification pipeline is a single global Kafka cluster in `us-east-1`, you have exported EU personal data to the US at the moment of enqueue, regardless of what the delivery endpoint is.

The workable architecture is **regional pipelines with a global control plane**: templates, category definitions, and campaign definitions replicate globally (they are not personal data); recipient resolution, rendering, dispatch, receipt ingest, and the delivery log stay in-region. Cross-region, you replicate **counts and states, not payloads**. This costs an extra deployment unit per region and is far cheaper than retrofitting after a DPIA finds the problem.

### 2.11 What This System Can and Cannot Guarantee

Derive the limit rather than asserting it, because the whole design follows from it.

**The delivery path ends outside your control.** A push goes to APNs or FCM; an SMS goes to an aggregator, then a carrier, then a handset; an email goes to a provider, then a receiving mail server, then a spam filter. Each hop can drop, delay or silently discard, and **none of them is obliged to tell you.** A carrier that drops a message for policy reasons reports success upstream. A mail server that files a message as spam accepted it.

**Therefore: delivery cannot be guaranteed, and any system claiming to guarantee it is claiming something about infrastructure it does not own.**

What *can* be guaranteed, and these are the commitments to make:

1. **Acceptance** — the request was durably recorded. Fully in your control.
2. **Attempt** — at-least-once handoff to the provider, with retries and a dead-letter path. In your control.
3. **Evidence** — the provider's acknowledgement, the receipt where the channel supplies one, and an explicit **indeterminate** state where it does not. In your control.
4. **Reconciliation** — an independently derived comparison between what you sent and what the provider says it handled (§2.8).

**"Exactly-once notification delivery" is therefore the wrong framing twice over.** Exactly-once transport is unachievable in general, and the terminal hop is not yours. What the system provides is `at-least-once attempt` + `idempotency at the provider boundary` + `deduplication at the recipient`, and the honest phrasing — *"we guarantee we attempted, we can evidence what happened, and we can tell you which ones we cannot account for"* — is a stronger commitment than a guarantee nobody can keep.

### 2.12 Failure Modes That Present as Success — the Defining Hazard

Collect them, because this system has more of them than anything else in the folder and they share one shape.

| Failure | Why it looks like success |
|---|---|
| Provider accepted, carrier dropped | The provider's 200 is the only signal you get |
| Email accepted, filed as spam | Delivered, by every definition your system can observe |
| Push sent to a stale token | APNs accepts; the feedback that the token is dead arrives later, on a different channel |
| Message stuck in a non-terminal state | **Counted in the success numerator** — so the more messages get stuck, the better the dashboard looks |
| One app version or OS broken | Aggregate delivery rate barely moves |
| One country's routes failing | The aggregator reports 100%, because *it* succeeded |
| Suppressed by a consent check that was wrong | Correctly suppressed and incorrectly suppressed are the same log line |

**The general rule this establishes — and it is the module's central lesson:** *an acknowledgement from a party who is not the final recipient is evidence of handoff, never of delivery.* Every metric built on such an acknowledgement is measuring your own outbound behaviour and calling it an outcome.

**The three-part remedy, which recurs throughout this folder:**

1. **An independent verifier** — reconcile sent-versus-receipted against the provider's own records, not against your emitter (§2.8).
2. **A counter on every silent path** — every suppression, discard, dedup-drop and timeout increments something. A dropped notification is acceptable; an *uncounted* dropped notification makes the data silently wrong.
3. **Detection by aging, not by rate** — the oldest message in a non-terminal state, not the percentage in terminal states. This is what catches §4's defect, where the success rate *improved* as the failure worsened.

**And never count a non-terminal state as success.** `ACCEPTED`, `SENT` and `PENDING_RECEIPT` are not `DELIVERED`. Getting this one modelling decision right removes an entire class of dashboard lie.

### 2.13 Priority Lanes, Campaigns, and the Single Hot Key

**A marketing campaign must never delay an OTP**, and the mechanism is structural rather than configurational: **separate queues per priority class, with separate consumer pools and separate provider connections.**

Why a shared queue with a priority field is insufficient: 20 million campaign items already enqueued sit *ahead* of the OTP in partition order, and priority within a partition cannot reorder what is already committed. Separate topics — or at minimum separate partitions with dedicated consumers — are what make the guarantee real.

Three classes is usually enough: **critical** (OTP, fraud, security), **transactional** (receipts, status changes), **bulk** (campaigns, digests). Each gets its own rate budget against the provider, so bulk cannot consume the shared sender throughput.

**A 40-million-recipient regulatory notice with a statutory deadline** is the bulk case at its hardest, and the design points are: expand the audience **incrementally into durable work items** rather than materialising 40 million rows in one transaction; **rate-shape the drain** against provider limits and reputation (§2.5), computing backwards from the deadline to confirm the window is achievable *before* starting; make every work item individually retryable and idempotent; track **completion as a burn-down against the deadline**, not as a percentage; and — because it is a statutory obligation — produce **per-recipient evidence** of attempt and outcome, which is the reason the work items must be durable rather than a fan-out loop.

**A single institutional account generating 8 million notifications partitioned to one key** is the hot-partition problem in this domain: one partition serialises, one consumer does all the work, and lag on that partition grows while every other partition is healthy — invisible in aggregate lag. Fixes, in order: **compound the partition key** (`accountId:shardIndex`) to spread across partitions, accepting that per-account ordering is lost — which §2.18 argues you did not need; **coalesce** at the source, since 8 million notifications to one account is almost always a bug or a digest opportunity (§2.6); and **detect per-partition**, because this never shows up in an aggregate.

### 2.14 Consent, Replica Lag, and the Unsubscribe Race

**Consent must be evaluated at dispatch time, not at enqueue time** (§2.2). The 20-million-item campaign expanded at 09:00 and draining until 09:40 contains items for users who unsubscribe at 09:12 — and if consent was checked during expansion, those users receive a message after opting out, which is a regulatory violation in most jurisdictions, not a UX blemish.

So: work items carry *who* and *what*, and the **consent check happens in the worker immediately before handoff**, with the suppression counted (§2.12).

**The replica-lag case is the subtle one.** The preference store has 200 ms replica lag; a user unsubscribes and a message is dispatched 150 ms later against a lagging replica, which still shows them subscribed. The message goes out.

Three honest observations:

1. **This is unavoidable in general** — there is always *some* window between a consent change and its visibility, and claiming zero is claiming synchronous global consistency on every dispatch.
2. **The window can be bounded and stated**, which is what compliance actually requires: "opt-outs take effect within N seconds" is defensible; "immediately" is not.
3. **Bound it structurally where the stakes justify it**: read consent from the **primary** for suppression checks (the volume is low relative to reads generally), or maintain a **suppression list as a separate, fast, strongly-consistent store** — a small set of "do not contact" identities, replicated synchronously, checked last. That is cheaper than making the whole preference store strongly consistent and it covers exactly the case that matters.

And note the asymmetry that makes the design tractable: **a false suppression is harmless; a false send is a violation.** So the check fails *closed* — if the consent store is unavailable, suppress non-critical traffic rather than sending it.

### 2.15 The Indeterminate Dispatch

A dispatch times out and you do not know whether the provider accepted it. Retrying may duplicate; not retrying may lose.

**Model `INDETERMINATE` as a first-class state**, resolve it deliberately, and never let the ambiguity be decided by a default:

1. **Retry with the same provider-level idempotency key** where the provider supports one — most major providers do, and this makes the retry safe. This is the primary answer, and the reason to require idempotency-key support during provider selection.
2. **Query the provider** by your own reference where an API exists.
3. **Wait for the receipt** (§2.8) — slower, and authoritative for channels that supply one.
4. **For a channel with neither**, decide by *consequence*: for an OTP, re-send (a duplicate code is an annoyance, a missing one is a failed login); for a marketing message, do not (a duplicate is a complaint and a reputation cost).

**Alert on aged indeterminate items**, because each one individually looks fine and the population is where the real problem hides.

### 2.16 Storage for the Delivery Log, and Retention

At 1.5 billion notifications/day the delivery log is the dominant storage problem, and its access pattern decides the engine: **write-heavy, append-only, immutable, read as recent-lookups by recipient or by message ID, plus analytical scans.** Almost never updated, never randomly read from deep history.

That argues against a single relational store as the primary log — not because PostgreSQL cannot take the writes, but because **seven years of an append-only, high-volume, mostly-cold dataset is the wrong shape for it**: vacuum and index maintenance on a table nobody updates, partition management at that scale, and cost per terabyte that a columnar or object-store tier beats by an order of magnitude.

**A tiered design fits the access pattern:**

| Tier | Store | Holds |
|---|---|---|
| Hot (days) | Cassandra/DynamoDB or a fast KV | Live state machine, receipt matching, recent lookups |
| Warm (months) | Columnar analytical store | Aggregations, per-channel and per-tenant reporting |
| Cold (years) | Object storage, immutable, partitioned by date | The evidentiary archive |

**Retention is not uniform, and that is the design point.** Most of the 1.5 billion are marketing and can expire in 90 days. A small subset — regulatory notices, statements, anything that constitutes legal notice — carries a **seven-year obligation**. So retention class must be an **attribute of the message, set at send time by the producing service**, not a global policy applied later. Tag it at the source, and make the tag mandatory, because reclassifying years of history retrospectively is not possible.

### 2.17 Multi-Tenancy for Internal Teams

Forty internal teams share this platform, and the requirement is that one team's mistake cannot affect the others.

- **Per-tenant rate budgets**, enforced, with a hard ceiling — so a bug that enqueues ten million messages throttles that tenant rather than the platform.
- **Separate queues or partitions per priority class** (§2.13), not per tenant, with per-tenant quotas *within* a class — otherwise forty queues each need capacity provisioned.
- **Per-tenant sender identity where the channel allows it** (separate sending domains or subdomains for email, separate sender IDs for SMS), so one team's content problem does not poison the **shared reputation** that §2.5 identifies as a shared-fate resource. This is the single highest-value isolation in the system, because reputation damage is slow to detect and slow to repair.
- **Per-tenant metrics and their own error budget**, so a tenant's failures are visible to that tenant and do not disappear into the aggregate.
- **A required template-approval step** for anything at bulk volume, because content is where reputation is lost.

### 2.18 Ordering — a Position Worth Taking

**Most notifications do not need ordering, and claiming they do is expensive.** Independent notifications are independent; a receipt and a shipping update have no required relative order, and the recipient reads them by timestamp anyway.

Where ordering genuinely matters, it is narrow and specific:

- **Supersession** — a later message invalidates an earlier one. "Your code is 123456" followed by "your code is 789012" must not arrive reversed. But the correct mechanism is **not** ordered delivery; it is **carrying a version and having the recipient discard stale ones**, because the final hop reorders regardless of what you do.
- **State transitions the user reads as a narrative** — "payment received" then "order shipped."

So the position: **do not buy global ordering; buy supersession semantics where they matter.** Partition by recipient where per-recipient order is useful, accept that cross-recipient order is meaningless, and note the direct trade-off with §2.13 — partitioning by recipient for ordering is exactly what creates the hot-partition problem for a heavy account. Choosing ordering you do not need costs you throughput you do.

### 2.19 Diagnosing Growing Consumer Lag

Lag growing steadily on the notification topic has a small set of causes, and the diagnosis is a sequence:

1. **Is lag uniform across partitions or concentrated?** Concentrated means a hot key (§2.13) or a poison message blocking one partition. Uniform means capacity or a downstream problem.
2. **Is production rate up, or consumption rate down?** They look identical in the lag metric and have opposite fixes.
3. **If consumption is down: where is the time going?** Provider latency (check per-provider dispatch duration), consumer CPU, or a dependency — the consent check (§2.14) and template rendering (§2.7) are both on the per-message path and both can regress.
4. **Are we being rate-limited by a provider?** A 429 from the provider slows every consumer simultaneously and looks exactly like insufficient capacity.
5. **Has a retry storm started?** Retries re-enter the topic and inflate production rate — a feedback loop where the symptom amplifies the cause, bounded only by a retry budget.

**The signal that matters most is per-partition lag alongside per-provider dispatch latency**, together. Either alone leaves you guessing between structurally different incidents.

### 2.20 When Notification Is on the Critical Path

SMS OTP for card authorisation makes this system a dependency of payments, which changes its risk profile entirely. §2.11's honest conclusion — delivery cannot be guaranteed — is uncomfortable here and must be confronted rather than papered over.

**Assess it plainly:** a channel you do not control is now a hard dependency of a revenue-critical, regulated flow. Carrier issues become authorisation failures.

**The fixes, in order of value:**

1. **Multiple providers with automatic failover**, and — the part usually missed — **routing diversity per destination country**, because aggregators often share the same underlying carrier routes, so two providers can fail together.
2. **A fallback channel** — push, voice call, or an in-app authenticator — so the flow is not single-channel.
3. **Strict latency budget with a timeout**, because an OTP arriving after the user's session expires is a failure even though it was delivered.
4. **Push the strategic fix**: move away from SMS OTP toward app-based authentication or passkeys. SMS is the weakest channel on both delivery evidence and security (SIM swap), and an architect's job here includes saying that the dependency is the problem, not just hardening it.
5. **Monitor OTP delivery separately from everything else**, by country and by carrier, with its own alerting — because it will never move the aggregate.

### 2.21 Evidentiary Strength — Proving Notice Was Given

When the requirement is to *prove* a customer was notified, the channels are not equivalent, and the ranking is not the one people expect:

| Channel | Evidence available | Strength |
|---|---|---|
| **Email** | Provider acceptance, SMTP transaction log, DKIM signature, and — for regulated notices — a retained copy of exactly what was sent | **Strongest.** The receiving server's acceptance is a logged transaction between identified parties |
| **SMS** | Aggregator acceptance, sometimes a carrier delivery receipt | **Middle.** The receipt is real where supplied and frequently unavailable |
| **Push** | Provider acceptance only; APNs/FCM explicitly do not confirm device delivery | **Weakest.** Acceptance says the message was queued, nothing more |
| **In-app / secure message centre** | **A read event from your own system** | **Strongest for proof of receipt** — the only channel where you observe the recipient, not an intermediary |

**For proving notice, use email plus a secure message centre**, and retain the rendered content, not just the template ID — because "we sent template 47 with these variables" requires reconstructing what the customer saw, and template 47 has changed since. This is the one place where §2.7's template-plus-variables storage rule is overridden deliberately: for evidentiary messages, store the rendered artefact.

### 2.22 CAP Posture — One Answer Is Not Enough

Different components take different sides, deliberately:

| Component | Posture | Reason |
|---|---|---|
| **Ingestion API** | **AP** — accept and queue | Refusing to accept a notification request loses it entirely; the queue absorbs downstream trouble |
| **Consent / suppression store** | **CP** | Sending after an opt-out is a violation; suppressing wrongly is harmless (§2.14) |
| **Delivery state machine** | **CP within a message** | Two workers must not both transition the same message |
| **Delivery log / reporting** | **AP** | Eventually consistent reporting is fine |
| **Rate limiting against providers** | **AP with bounded overshoot** | Brief over-admission costs reputation, not correctness |

**Stating one CAP answer for "the notification system" is the error**, and the interviewer is checking whether you decompose. The consent store being CP while ingestion is AP is what lets the system be both highly available and compliant.

### 2.23 Would You Event-Source It?

*For:* the delivery lifecycle genuinely is a sequence of events (accepted → dispatched → receipted → bounced), the audit trail is a requirement rather than a nicety, and reconstructing "what happened to this message" is a real and frequent operational need.

*Against, and decisive at this volume:* 1.5 billion messages/day means **billions of events per day**, and the projection-rebuild cost becomes the system's dominant operational risk — a rebuild that takes days is not a recovery procedure. The aggregate is also trivially small (one message, a handful of transitions), so event sourcing's strength in modelling rich aggregate behaviour buys nothing here.

**Decision: no, not as a framework — but keep the property.** Store the state machine's **transitions as an append-only log alongside the current state**, which gives the audit trail and the reconstruction without a generic event-sourcing runtime, a projection-rebuild problem, or an aggregate abstraction the domain does not need. Take the property, not the pattern.

### 2.24 Migrating Forty Teams Off Their Own Integrations

Forty teams each with their own SMTP or Twilio integration, migrating to one platform. The technical work is the easy half.

**Sequence:**

1. **Build the platform and make it obviously better** — templating, retries, receipts, preference handling, per-tenant dashboards. Migration is voluntary until adoption proves the platform; mandating first produces resentment and workarounds.
2. **Migrate one team fully**, including a real campaign, and use their result as the reference.
3. **Provide a compatibility shim** — an SDK whose call signature approximates what teams already use — so the port is hours rather than a project.
4. **Dual-run per team**: send through both paths with the new platform in shadow, compare, then cut over.
5. **Only then centralise the credentials.** The forcing function is **provider account consolidation** — once the platform owns the sending domains and provider accounts, individual integrations stop working by construction rather than by policy.

**The organisational obstacles matter more than the code**: teams lose control of their own sending and will fear becoming blocked on a platform team's backlog, so **self-service template management and per-tenant quotas are adoption requirements**, not features. And forty integrations carry forty sets of undocumented behaviour — one team's "unsubscribe" may mean something different from another's. Reconciling **consent semantics across forty sources** is the genuinely hard part of the data migration, and getting it wrong is a compliance incident rather than a bug.

### 2.25 Monitoring, SLIs, and What Remains Undetectable

**SLIs, with the emphasis on what they are computed over:**

- **Acceptance success rate** — your API's own availability. Fully attributable.
- **Time-to-dispatch, p50/p95/p99, by priority class** — the thing you actually control end to end.
- **Dispatch success rate by provider, channel and country** — the cut matters more than the number; an aggregate hides §2.12's entire table.
- **Receipt-confirmed rate by channel**, understood as evidence rather than truth.
- **Oldest message age in a non-terminal state**, by class — the aging signal that catches silent non-progress.
- **Reconciliation break count and age** (§2.8).
- **Suppression and discard counters**, by reason.

**Alert on aging and on divergence, not on rate**, because rates stay healthy through exactly the failures that matter.

**What remains structurally undetectable, stated honestly:**

- **Whether a human being read it.** Only the in-app channel observes this.
- **Silent carrier drops** where no receipt mechanism exists — you can bound the population via reconciliation, not identify the individuals.
- **Spam filing** — delivered by every observable definition.
- **A correct-looking suppression that was wrong** — a consent bug suppresses messages and the suppression counter increments exactly as designed.

The honest posture: this system produces **evidence of attempt and best-available evidence of outcome**, and the gap between that and "the user was notified" is real, quantifiable via reconciliation, and must be stated to the business rather than smoothed over in a dashboard.

### 2.26 AI-Generated Notification Content

The request will come. The architect's position should be settled in advance rather than improvised.

**Not on the critical path, and not for regulated content.** A generated OTP message, payment confirmation or regulatory notice introduces latency, non-determinism and hallucination risk into a flow whose entire value is that it is exact and evidenced. Templates are correct here *because* they are boring.

**Where it is genuinely useful:** subject-line and copy variants for marketing campaigns; summarisation of digest content; localisation assistance; send-time optimisation. All of these are bulk-class, all are reviewable before send, and none is legally operative text.

**The controls that make it acceptable:** generate **offline, at template-authoring time**, never per message at dispatch — which removes the latency and availability dependency entirely; require **human approval** before any generated variant goes to volume; keep the generated text **versioned and stored as the rendered artefact** (§2.21) so what was sent is reconstructable; and **never generate anything that carries a legal or financial commitment.**

The one-line position: **generated content is authored content that happened to be drafted by a model — it goes through the same approval, versioning and evidence path as any other template, and it never enters the dispatch path at runtime.**

### 2.27 Testing Safely, and the Most Discriminating Question

**Testing this system is unusually dangerous**, because the failure mode is sending real messages to real people. The controls:

- **A hard environment guard**: non-production environments route to a sink provider by default, with the real provider requiring an explicit, audited configuration — and no shared credentials between environments, so a misconfiguration cannot reach a real provider at all.
- **Allow-listed recipients** in non-production: only internal, verified addresses and numbers.
- **Provider sandbox modes** for integration tests, which most providers offer.
- **Load-test against a mock provider** with realistic latency and error injection — the real one will rate-limit you, and testing against it risks reputation damage.
- **Synthetic canaries in production**, sending to internal recipients across every channel and several countries, asserting receipt — which is the only way to detect §2.12's country-specific and version-specific failures.

**The most discriminating question to ask about this system:**

> **"Your dashboard says 99.9% delivered. What does that number actually mean, and what could be badly wrong?"**

It discriminates because a weak answer accepts the number, a middling answer notes that provider acceptance is not delivery, and a strong answer decomposes it completely: which state is being counted as success (§2.12's non-terminal-state trap); what the denominator excludes (suppressed, deduplicated, discarded — all invisible); that the aggregate hides per-country, per-carrier and per-app-version failures; that a *provider's* success is a handoff, not an outcome; and that the correct instruments are **aging, per-segment breakdowns, and independent reconciliation** rather than a single rate.

That single question reaches the system's defining property — **that its failures present as success** — and everything else in this module follows from taking it seriously.

---


---

## 3. Visual Architecture

### Component architecture

```mermaid
flowchart TB
  subgraph Producers
    P1[Payments Service]
    P2[Fraud Engine]
    P3[Risk / Margin Engine]
    P4[Marketing / Campaign Tool]
  end

  P1 & P2 & P3 --> GW[Notification Gateway<br/>REST + idempotency claim]
  P4 --> CAMP[Campaign Service<br/>audience definition + schedule]

  GW --> TOPIC{{Kafka: notif.requests<br/>lane per priority}}
  CAMP --> EXP[Audience Expander<br/>streaming, checkpointed]
  EXP --> TOPIC

  TOPIC --> POL[Policy Engine<br/>consent · caps · quiet hours · dedup]
  POL -->|suppressed| LOG[(Delivery Log<br/>append-only)]
  POL --> ROUTE[Channel Router<br/>channel selection + fallback plan]

  ROUTE --> WPUSH[Push Worker]
  ROUTE --> WMAIL[Email Worker]
  ROUTE --> WSMS[SMS Worker]
  ROUTE --> WINAPP[In-App Worker]

  WPUSH --> APNS[(APNs / FCM)]
  WMAIL --> SES[(SES / SendGrid)]
  WSMS --> TW[(Twilio / aggregators)]
  WINAPP --> INBOX[(Inbox Store)]

  WPUSH & WMAIL & WSMS --> LOG
  APNS & SES & TW -.webhooks.-> RCPT[Receipt Ingest]
  SES & TW -.nightly files.-> RECON[Reconciliation Engine]
  RCPT --> LOG
  RECON --> LOG
  RECON --> BREAKS[[Break Queue<br/>auto · manual · investigate]]

  PREF[(Preference &<br/>Consent Store)] --> POL
  DEV[(Device Registry)] --> ROUTE
  TPL[(Template Service<br/>versioned)] --> WPUSH & WMAIL & WSMS
  SUP[(Suppression List)] --> POL
  WPUSH & WMAIL --> SUP
```

### Sequence — a fraud alert, happy path and the indeterminate path

```mermaid
sequenceDiagram
  participant F as Fraud Engine
  participant G as Gateway
  participant K as Kafka (lane: critical)
  participant P as Policy Engine
  participant W as Push Worker
  participant A as APNs
  participant L as Delivery Log

  F->>G: POST /v1/notifications<br/>Idempotency-Key: fraud-9f3c…
  G->>G: claim key (INSERT … ON CONFLICT)
  G->>L: ACCEPTED (notification_id)
  G-->>F: 202 {notification_id}
  G->>K: publish
  K->>P: consume
  P->>P: category=FRAUD_ALERT → is_suppressible=false<br/>skip preference gate, still apply dedup
  P->>W: dispatch intent (2 devices)
  W->>W: render (content-light)
  W->>A: POST /3/device/{token}  apns-collapse-id, priority 10
  alt provider responds
    A-->>W: 200
    W->>L: DISPATCHED (provider_message_id)
    A-->>W: (async) delivery receipt
    W->>L: DELIVERED
  else timeout — the indeterminate case
    A--xW: no response
    W->>L: INDETERMINATE (attempt 1)
    Note over W,L: retry with the SAME apns-id;<br/>APNs deduplicates on it.<br/>Never a fresh id — that is how you double-send.
  end
```

### Delivery state machine

```mermaid
stateDiagram-v2
  [*] --> ACCEPTED
  ACCEPTED --> RESOLVED: recipients + channels chosen
  RESOLVED --> SUPPRESSED: consent / cap / dedup / suppression list
  RESOLVED --> QUEUED
  QUEUED --> DISPATCHED: provider accepted
  QUEUED --> INDETERMINATE: timeout / no response
  INDETERMINATE --> DISPATCHED: resolved by lookup or receipt
  INDETERMINATE --> FAILED: exhausted, no evidence of acceptance
  DISPATCHED --> DELIVERED: receipt
  DISPATCHED --> BOUNCED: hard bounce / unregistered
  DISPATCHED --> EXPIRED: TTL passed with no terminal state
  QUEUED --> FAILED: non-retryable error
  DELIVERED --> READ: open/click signal (optional)
  SUPPRESSED --> [*]
  BOUNCED --> [*]
  EXPIRED --> [*]
  FAILED --> [*]
  READ --> [*]
  DELIVERED --> [*]
```

Note the two states most designs omit and both incidents in this module turn on: **`INDETERMINATE`** (we do not know whether the provider took it) and **`EXPIRED`** (we dispatched and never learned anything, ever). A schema without them forces every unknown into either `SENT` or `FAILED`, and both are lies.

---

## 4. Production Example — "100% delivered" margin calls that nobody received

**Context.** A retail brokerage. Margin calls are issued intraday; the client has until 15:00 the following business day to meet the call or positions are liquidated. The firm's client agreement and the regulator both require that notice be *given*. Notice goes out by email and push simultaneously; email is the artefact the compliance team relies on.

**Problem.** Over eleven weeks, a subset of clients — eventually established at 3.1% of called accounts — never received the email notice. The internal dashboard showed **99.97% delivery success** throughout. The issue surfaced only when a client whose positions were liquidated disputed it, and the firm went to produce the notice.

**Investigation.**

1. The delivery record for the disputed client said `SENT`, timestamped correctly, with the provider's message ID. The provider's API had returned `202 Accepted`.
2. The provider's own dashboard, queried by message ID, said **`dropped — recipient on account suppression list`**.
3. The suppression list had been populated automatically by the provider from hard bounces — including bounces generated **two years earlier**, during a migration in which a batch of addresses had been sent with a malformed local part. The addresses were valid; the *messages* had been malformed. The provider had, correctly by its own rules, added the recipients to a permanent account-level suppression list.
4. The firm's system had never subscribed to the provider's `dropped` webhook event. It subscribed to `delivered`, `bounce`, and `open`. A `dropped` message produced **no webhook at all** in its configuration, so the record stayed at `SENT` forever.
5. `SENT` was counted as success by the dashboard. The metric was `count(status IN ('SENT','DELIVERED')) / count(*)`.

**Root cause — three failures, each individually survivable:**

- The provider's `202 Accepted` was recorded as a delivery outcome rather than as *receipt of the request*.
- The terminal-state webhook set was incomplete, and nothing detected that a record had sat in a non-terminal state for eleven weeks.
- The success metric aggregated a non-terminal state into the numerator, which meant **the more messages got stuck, the better the dashboard looked**.

**Fix.**

- Split the schema: `dispatch_state` (ours) and `delivery_state` (theirs), with no value of the first permitted to imply the second.
- Reconcile nightly against the provider's full event export — not the webhook stream — and treat the export as authoritative.
- Add an **aging detector**: any dispatch without a terminal delivery state after 4× the channel's p99 receipt latency raises a break. This is what would have caught it on day one.
- Redefine the SLI as `delivered / dispatched`, with `SENT`-but-not-terminal counted explicitly as **unknown** and graphed as its own series. A metric must never let an unknown default into the success bucket.
- For mandatory-notice categories, require **at least one channel with a confirmed terminal delivery** or escalate to a human workflow within the notice window.

**Trade-offs accepted.** The aging detector produces genuine false positives — some carriers legitimately take hours. The team set per-channel thresholds rather than one global one, and accepted a break queue with real volume, because a break queue somebody triages is strictly better than a dashboard nobody can disbelieve.

**Lessons.**

1. **A provider's acknowledgement is a receipt for your request, not a report on your user.** Model them as separate columns or you will conflate them within a year.
2. **Every non-terminal state needs a clock.** A state with no maximum age is a state records go to disappear in.
3. **Never let "unknown" fall into the success bucket of an SLI.** This is the same structural blindness as Module 178 §4's silent discard and Module 177 §14's aggregate p50 — third instance in this folder, arriving by a different route each time.
## 11. Coding Exercises

### Easy — Quiet-hours evaluation in the user's local time

**Problem.** Given a user's IANA timezone, a quiet window (which may wrap midnight, e.g. 21:00–08:00), and a UTC instant, decide whether a suppressible notification may be sent. Must be correct across DST transitions.

```csharp
public sealed record QuietHours(TimeOnly Start, TimeOnly End);

public static class QuietHoursPolicy
{
    public static bool IsQuiet(DateTimeOffset utcNow, string ianaTimeZone, QuietHours window)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(ianaTimeZone);
        // Convert the instant; never construct a local wall-clock time and assume it exists.
        var local = TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(utcNow, tz).DateTime);

        return window.Start <= window.End
            ? local >= window.Start && local < window.End          // same-day window
            : local >= window.Start || local < window.End;         // wraps midnight
    }
}
```

**Time complexity.** O(1) per call; timezone lookup is a dictionary hit after the first load.
**Space complexity.** O(1) per call, O(T) for the cached timezone database.

**Why the naive version is wrong.** The common implementation computes a *local DateTime* for the window boundaries — `localDate.Date + window.Start` — and compares. On a spring-forward day, 02:30 local does not exist, and on fall-back it exists twice; constructing it throws or silently picks an offset. Converting the *instant* to a local time-of-day and comparing time-of-day values avoids ever materialising a possibly-nonexistent local timestamp. This is the same DST-boundary defect Module 178 §14 built its incident on, in a smaller costume.

**Optimised / hardened.**

```csharp
private static readonly ConcurrentDictionary<string, TimeZoneInfo> Cache = new();

public static bool IsQuiet(DateTimeOffset utcNow, string ianaTimeZone, QuietHours window, bool suppressible)
{
    if (!suppressible) return false;                      // mandatory categories bypass entirely
    var tz = Cache.GetOrAdd(ianaTimeZone, ResolveOrUtc);  // unknown zone must not throw at dispatch time
    var local = TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(utcNow, tz).DateTime);
    return window.Start <= window.End
        ? local >= window.Start && local < window.End
        : local >= window.Start || local < window.End;
}

private static TimeZoneInfo ResolveOrUtc(string id)
{
    try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
    catch (TimeZoneNotFoundException) { return TimeZoneInfo.Utc; }   // and increment a counter
}
```

Two production hardenings that matter more than the algorithm: the `suppressible` short-circuit makes it structurally impossible for quiet hours to hold a fraud alert, and the unknown-timezone fallback prevents a bad profile record from throwing on the dispatch path — with a counter, because a silent fallback is exactly the silent-success pattern of §2.12.

---

### Medium — Per-user rate limiting with coalescing

**Problem.** Cap a user at *N* notifications per category per window. Instead of dropping excess, coalesce them into a digest emitted at window end.

```csharp
public sealed class CoalescingLimiter
{
    private readonly int _capacity;
    private readonly TimeSpan _window;
    private readonly Dictionary<(long UserId, string Category), Bucket> _state = new();
    private readonly object _gate = new();

    private sealed class Bucket
    {
        public int Sent;
        public DateTimeOffset WindowStart;
        public readonly List<PendingItem> Held = new();
    }

    public CoalescingLimiter(int capacity, TimeSpan window)
        => (_capacity, _window) = (capacity, window);

    public Decision Admit(long userId, string category, PendingItem item, DateTimeOffset now)
    {
        lock (_gate)
        {
            var key = (userId, category);
            if (!_state.TryGetValue(key, out var b) || now - b.WindowStart >= _window)
            {
                b = new Bucket { WindowStart = now };
                _state[key] = b;
            }

            if (b.Sent < _capacity) { b.Sent++; return Decision.SendNow; }

            b.Held.Add(item);
            return Decision.Held;                 // NOT "dropped" — the distinction is the point
        }
    }

    public IEnumerable<Digest> Drain(DateTimeOffset now)
    {
        lock (_gate)
        {
            foreach (var (key, b) in _state.ToList())
            {
                if (now - b.WindowStart < _window || b.Held.Count == 0) continue;
                yield return new Digest(key.UserId, key.Category, b.Held.ToArray());
                _state.Remove(key);               // bounded memory: buckets do not outlive their window
            }
        }
    }
}

public enum Decision { SendNow, Held }
public sealed record PendingItem(string TemplateId, IReadOnlyDictionary<string, string> Vars);
public sealed record Digest(long UserId, string Category, PendingItem[] Items);
```

**Time complexity.** O(1) amortised per admit; O(K) per drain over active buckets.
**Space complexity.** O(active users × categories + held items).

**The bug this design avoids.** A limiter that returns `Dropped` for over-cap traffic silently destroys information, and — critically — produces no distinguishable signal from "the user had no notifications". `Held` plus a digest preserves the information and makes the suppression countable (§2.12's remedy).

**Optimised for distribution.** Single-node `Dictionary` state does not survive scale-out or restart. In production this is a Redis Lua script performing the check-and-increment atomically, keyed `rl:{user}:{category}:{windowBucket}` with a TTL of one window, and held items appended to a Redis list under the same key prefix. The Lua script matters: a `GET`/`INCR` round-trip is a read-modify-write race that lets two workers each believe they are under the cap — the same lost-update shape as Module 178 §2.25's hot fee account. Cap memory with a bounded held-list length, dropping *and counting* beyond it, because an unbounded hold list is a memory leak with a market-crash trigger.

---

### Hard — Idempotent dispatch with an explicit indeterminate state

**Problem.** Dispatch a notification exactly once from the caller's perspective, given an at-least-once queue and a provider that may time out after having accepted the message.

```csharp
public sealed class Dispatcher
{
    private readonly IDedupStore _dedup;      // atomic claim with TTL
    private readonly IDeliveryLog _log;       // append-only
    private readonly IProviderAdapter _provider;

    public async Task<DispatchOutcome> DispatchAsync(WorkItem item, CancellationToken ct)
    {
        // 1. Claim. The key is derived from the business event, never from this attempt.
        var key = DedupKey.For(item.UserId, item.Category, item.BusinessEventId,
                               item.Channel, item.CoalesceBucket);

        var claim = await _dedup.TryClaimAsync(key, item.NotificationId, Ttl.MaxRedeliveryHorizon, ct);
        if (!claim.Acquired)
        {
            // Distinguish the three duplicate outcomes — most implementations collapse them.
            return claim.ExistingState switch
            {
                ClaimState.InFlight  => DispatchOutcome.DuplicateInFlight(claim.OwnerId),
                ClaimState.Completed => DispatchOutcome.DuplicateCompleted(claim.OwnerId),
                _                    => DispatchOutcome.DuplicateUnknown(claim.OwnerId)
            };
        }

        // 2. The provider-side idempotency handle is stable across ALL retries of this item.
        var providerRef = ProviderRef.Deterministic(item.NotificationId, item.Channel);

        await _log.AppendAsync(item.DeliveryId, DeliveryEvent.Queued(providerRef), ct);

        try
        {
            var res = await _provider.SendAsync(item, providerRef, ct);
            await _log.AppendAsync(item.DeliveryId,
                DeliveryEvent.Dispatched(res.ProviderMessageId), ct);
            await _dedup.CompleteAsync(key, ct);
            return DispatchOutcome.Dispatched(res.ProviderMessageId);
        }
        catch (ProviderPermanentException ex)          // 400, invalid token, suppressed
        {
            await _log.AppendAsync(item.DeliveryId, DeliveryEvent.Failed(ex.Code), ct);
            await _dedup.CompleteAsync(key, ct);        // do NOT release: a retry would re-fail
            if (ex.InvalidatesEndpoint) await _provider.InvalidateEndpointAsync(item, ct);
            return DispatchOutcome.Failed(ex.Code);
        }
        catch (Exception ex) when (ex is TimeoutException or ProviderTransientException)
        {
            // The critical case: we do not know whether the provider accepted it.
            await _log.AppendAsync(item.DeliveryId, DeliveryEvent.Indeterminate(providerRef), ct);
            // Keep the claim. A retry reuses providerRef, so the provider deduplicates.
            return DispatchOutcome.Indeterminate(providerRef);
        }
    }
}
```

**Time complexity.** O(1) plus one provider round-trip. **Space complexity.** O(1) per dispatch; O(active keys) in the dedup store.

**Why each decision is what it is.**

- The claim TTL is `MaxRedeliveryHorizon`, not an arbitrary value — §14 is an incident caused by getting this wrong.
- `providerRef` is *deterministic* from `notification_id`, so every retry presents the same handle and the provider's own dedup closes the at-most-once half.
- Permanent failures **complete** the claim rather than releasing it; releasing would let a redelivery retry a request that can only fail again, burning quota and reputation.
- `Indeterminate` keeps the claim and records the handle, so resolution can come from a retry, a status lookup, or reconciliation — three independent paths to the same truth.

**Optimised.** The claim and the log append should share a transaction where the stores allow it; where they don't (Redis + Cassandra), order them so the *durable* record precedes the provider call and accept that a crash between them yields a `QUEUED` record with no outcome — which the aging detector will surface as a break rather than as a lost message. That is the honest trade: you cannot make two stores atomic, so make the failure *visible* instead of *impossible*.

---

### Expert — Receipt reconciliation with aging-based break detection

**Problem.** Given the day's internal dispatch records and a provider's export file, produce classified breaks. Detect concentrated failures that a global ratio would hide.

```csharp
public sealed record Dispatch(string DeliveryId, string ProviderMessageId, string Channel,
                              string Provider, string Country, string Template,
                              DeliveryState State, DateTimeOffset DispatchedAt);

public sealed record ProviderRecord(string ProviderMessageId, DeliveryState TerminalState,
                                    DateTimeOffset EventAt);

public enum BreakKind { MissingReceipt, OrphanReceipt, StateMismatch, SegmentAnomaly }
public sealed record Break(BreakKind Kind, string Reference, string Detail);

public static class Reconciler
{
    public static IReadOnlyList<Break> Reconcile(
        IReadOnlyList<Dispatch> ours,
        IReadOnlyList<ProviderRecord> theirs,
        DateTimeOffset asOf,
        IReadOnlyDictionary<string, TimeSpan> receiptSlaByChannel,
        IReadOnlyDictionary<string, double> segmentBaseline)
    {
        var breaks = new List<Break>();
        var byId = theirs.ToDictionary(t => t.ProviderMessageId);
        var seen = new HashSet<string>();

        foreach (var d in ours)
        {
            if (d.ProviderMessageId is not null && byId.TryGetValue(d.ProviderMessageId, out var t))
            {
                seen.Add(d.ProviderMessageId);
                if (d.State.IsTerminal() && d.State != t.TerminalState)
                    breaks.Add(new Break(BreakKind.StateMismatch, d.DeliveryId,
                        $"ours={d.State} theirs={t.TerminalState} (theirs wins)"));
                continue;
            }

            // AGING, not rate: a dispatch older than the channel's receipt SLA with no
            // terminal state is a break even if the overall ratio looks perfect.
            var sla = receiptSlaByChannel.GetValueOrDefault(d.Channel, TimeSpan.FromHours(4));
            if (!d.State.IsTerminal() && asOf - d.DispatchedAt > sla)
                breaks.Add(new Break(BreakKind.MissingReceipt, d.DeliveryId,
                    $"no terminal state after {(asOf - d.DispatchedAt).TotalHours:F1}h on {d.Provider}"));
        }

        foreach (var t in theirs.Where(t => !seen.Contains(t.ProviderMessageId)))
            breaks.Add(new Break(BreakKind.OrphanReceipt, t.ProviderMessageId,
                "provider delivered something we have no dispatch record for"));

        // Concentrated-failure detection: an aggregate cannot see this, so compute per segment.
        var bySegment = ours
            .GroupBy(d => $"{d.Channel}|{d.Provider}|{d.Country}|{d.Template}")
            .Where(g => g.Count() >= 50);                       // avoid noise on tiny segments

        foreach (var g in bySegment)
        {
            var delivered = g.Count(d => d.State == DeliveryState.Delivered);
            var rate = (double)delivered / g.Count();
            var baseline = segmentBaseline.GetValueOrDefault(g.Key, 0.95);
            if (rate < baseline * 0.5)
                breaks.Add(new Break(BreakKind.SegmentAnomaly, g.Key,
                    $"delivery {rate:P1} vs baseline {baseline:P1} over {g.Count()} dispatches"));
        }

        return breaks;
    }
}
```

**Time complexity.** O(N + M) for matching plus O(N) for grouping. **Space complexity.** O(M) for the index plus O(S) for segment aggregates.

**What makes this the Expert exercise rather than a join.** Three things, each of which corresponds to a real incident in this course:

1. **Aging, not rate.** §4's eleven-week failure had a perfect ratio throughout. Only elapsed time in a non-terminal state exposes it.
2. **Orphan receipts are checked.** Most implementations only iterate their own records and would never notice that the provider delivered something they have no record of — which is the signature of a duplicate submission or a lost write.
3. **Per-segment baselines.** A global rate is structurally blind to one country or one app version going to zero. The segment floor (`>= 50`) is a deliberate trade: it suppresses noise and, in exchange, accepts blindness to very small segments — which must be *stated* rather than discovered later.

**Hardening for production.** The job needs a **dead-man's switch**: a reconciliation that silently stops running removes the only external verifier in the system, and its absence generates no alert by construction. Emit a heartbeat with the run's input counts, and alert on heartbeat absence and on implausible inputs (zero provider records is not "a clean day"). This is the same requirement Module 178 §11 arrived at for the ledger verifier, and for the identical reason: **the verifier is the one component whose failure the system cannot detect by itself.**

---

## 12. System Design — Designing a Notification & Alerting System

*Authored to the four-step standard (`CLAUDE.md`, 2026-08-09). This is the centre of the module.*

---

### Step 1 — Understand the Problem and Establish Design Scope

The prompt as given is one sentence: *"Design a notification system."* It is deliberately underspecified. The first five minutes are spent making it specific, out loud.

#### The dialogue

> **C:** What kinds of notification are in scope? There are at least three classes with very different requirements — transactional, operational alerts, and marketing.
> **I:** All three. Assume a consumer fintech: payment receipts, OTPs, fraud alerts, margin calls, statement-ready notices, and product marketing.
>
> **C:** Which channels?
> **I:** iOS push, Android push, SMS, email, and an in-app inbox. Assume WhatsApp and RCS may be added later.
>
> **C:** Do we operate any delivery infrastructure ourselves, or are we integrating third parties?
> **I:** Third parties throughout — APNs and FCM for push, an ESP for email, an SMS aggregator. You own everything up to the provider call.
>
> **C:** Who produces notifications?
> **I:** About 40 internal services, plus a marketing tool that runs scheduled campaigns.
>
> **C:** Scale?
> **I:** 100 million registered users, 1.5 billion notifications per day, with event-correlated bursts — a market event can produce tens of millions of alerts in a couple of minutes.
>
> **C:** Latency targets — are they uniform?
> **I:** No. Fraud alerts and OTPs: 99th percentile under 5 seconds from event to provider-accepted. Marketing: minutes are fine.
>
> **C:** Delivery guarantee? Is a duplicate worse than a miss?
> **I:** For alerts, a miss is much worse than a duplicate. For marketing, sending to someone who opted out is the unacceptable failure.
>
> **C:** Do we need to *prove* delivery for any of it?
> **I:** Yes. Regulated notices — margin calls, statutory disclosures — need seven-year retention with evidence of delivery. That's roughly 2% of volume.
>
> **C:** Preferences and consent?
> **I:** Per user, per category, per channel. Some categories can't be opted out of.
>
> **C:** Ordering?
> **I:** No global ordering. But an older OTP must never arrive after a newer one.
>
> **C:** Geography and data residency?
> **I:** Global. EU personal data must stay in the EU. 20 locales.
>
> **C:** And explicitly out of scope?
> **I:** The in-app inbox UI, the campaign-authoring tool, and ML-driven send-time optimisation. Assume the audience for a campaign is handed to you as a queryable segment.

#### Functional requirements

1. Accept notification requests from authenticated internal producers, idempotently.
2. Accept campaign requests referencing an audience segment; expand asynchronously.
3. Resolve recipients to channels and endpoints (devices, addresses, numbers).
4. Enforce consent, preferences, quiet hours, per-user caps, and a global suppression list — at dispatch time.
5. Render localised content from versioned templates.
6. Deduplicate across producer retries, broker redelivery, and duplicate business logic.
7. Dispatch to per-channel providers with retry, backoff, and DLQ.
8. Ingest delivery receipts by webhook and by nightly file; reconcile.
9. Maintain a queryable delivery history; retain regulated notices for seven years with evidence.
10. Expose per-user preference read/write and per-notification status.

#### Non-functional requirements

| Requirement | Target |
|---|---|
| Throughput | 15k notifications/s average, 75k/s peak, 220k/s burst absorbed by queue |
| Latency (critical lane) | p99 < 5 s, event → provider-accepted |
| Latency (bulk lane) | p99 < 15 min |
| Availability — ingest | 99.99% (it gates OTP, which gates payments) |
| Availability — consent gate | 99.9%, and **fails closed** for suppressible traffic |
| Durability | Zero loss of *accepted* intent; every accepted request reaches a terminal state or a break |
| Consistency | Consent: read-your-writes for the acting user. Delivery log: eventual, reconciled |
| Retention | 30 days hot (all), 7 years archive (regulated ~2%) |
| Compliance | GDPR, TCPA/CAN-SPAM, PCI-adjacent (no PAN in messages), data residency |

#### Back-of-the-envelope estimation

**Rate.** Using the standard `10^5 seconds ≈ 1 day` shortcut:

```
1.5 × 10^9 notifications/day ÷ 10^5 s = 15,000 /s  average
Peak (diurnal, ×5)                    = 75,000 /s
Burst (market event: 20M in 90 s)     = 222,000 /s   ← 15× steady state
```

**Channel mix and dispatch amplification.**

```
push  60%  = 900M/day, × ~1.8 live endpoints per user = 1.62B dispatches
email 25%  = 375M/day
SMS    5%  =  75M/day  → 870/s sustained  (a real provider-quota problem)
in-app10%  = 150M/day
Total dispatches ≈ 2.2B/day ≈ 22,000/s average
```

**Storage — the decisive calculation.**

```
Delivery record  ≈ 400 B ;  delivery events ≈ 3 × 120 B
Per dispatch     ≈ 760 B
2.2 × 10^9 × 760 B          ≈ 1.7 TB/day raw
30-day hot window           ≈ 50 TB      (feasible in a wide-column store)
7-year retention of ALL     ≈ 4.3 PB     (not feasible; also unlawful for marketing data)

Regulated subset ≈ 2% of notifications = 30M/day
With full rendered artefact (~4 KB)     ≈ 120 GB/day
7 years                                 ≈ 300 TB in object storage — entirely tractable
```

**SMS cost.** 75M/day × $0.007 ≈ **$525k/day**. This single line reframes the design: SMS is not a channel choice, it is a **budget line**, and channel-fallback policy is a cost decision as much as a reliability one.

#### What the numbers tell us

Three conclusions, and stating them explicitly is the point of Step 1:

1. **22k dispatches/s is not a hard throughput problem** — it is a few hundred cores of well-written workers. Throughput is *not* the design driver.
2. **The burst is the design driver.** 15× steady state arriving in 90 seconds means the architecture is defined by buffering, lane isolation, and shedding policy — not by steady-state capacity.
3. **Classification at ingest is the decisive storage and compliance decision.** 4.3 PB versus 300 TB is a factor of 14,000, and it turns entirely on whether the `category` field is right. That elevates category definition from metadata to a **first-class architectural concern with an owner and a review process** — which is the non-obvious conclusion this estimation exists to produce.

---

### Step 2 — Propose High-Level Design and Get Buy-In

#### The two core flows

Like pay-in and pay-out in a payment system, this system has two flows that share components but must not share fate:

- **Triggered flow** — an event about one user, latency-sensitive, small fan-out, must never be delayed. Enters via the REST gateway, goes to a priority lane.
- **Campaign flow** — a scheduled send to a large audience, latency-tolerant, enormous fan-out, must never be able to starve the triggered flow. Enters via the campaign service, goes to the bulk lane, expanded asynchronously.

Everything downstream of expansion is shared *code* but separated *infrastructure*: distinct topics, consumer groups, worker pools, and provider credentials.

#### Components

**Notification Gateway.** The REST entry point. Authenticates producers by workload identity, authorises them per **category**, validates the request against the template's declared variable schema, claims the idempotency key, writes an `ACCEPTED` record, and publishes to the correct lane. It does no resolution and no rendering — it must stay fast and its latency must not depend on audience size.

**Campaign Service.** Owns campaign definitions, schedules, and audience references. Emits an expansion job; does not itself expand.

**Audience Expander.** Streams a segment query into per-recipient work items in batches, checkpointing progress (expected count, produced count, cursor) so the job is resumable and observable. This is the component whose absence makes "did the campaign go out?" unanswerable.

**Policy Engine.** The authorisation layer for sending. In order: category suppressibility → global suppression list → consent/preferences → quiet hours → per-user cap and coalescing → deduplication. Every rejection increments a labelled counter. This is where consent is evaluated — at dispatch time, not at enqueue.

**Channel Router.** Selects channels and endpoints from the device registry and address book, and builds a **fallback plan** (e.g. push → if no terminal delivery in 30s → SMS) rather than a single channel. The plan is data, so it can be reasoned about and audited.

**Channel Workers** (push / email / SMS / in-app). Render from the template service, call the provider adapter, and append to the delivery log. Rendering happens here — the last hop — so message bodies never enter the broker.

**Provider Adapters.** One per provider, behind a common interface. Own connection pooling, provider auth, the retryable/non-retryable classification, per-provider concurrency limiting, and circuit breaking. This is the only place provider-specific semantics live.

**Device Registry.** Tokens, platforms, app versions, locales, timezones, with reassignment-on-conflict and invalidation write-back.

**Preference & Consent Store.** Preferences (mutable) plus consent records (append-only, with source and evidence).

**Suppression List.** Global do-not-contact per channel address, from hard bounces, STOP replies, and explicit requests. Small, hot, strongly consistent — checked last, in the adapter.

**Template Service.** Versioned, localised templates with declared variable schemas and a `sensitivity` classification.

**Delivery Log.** Append-only event log per delivery; current state derived. The system of record for what happened.

**Receipt Ingest.** Signature-verified webhook endpoints per provider; idempotent, order-tolerant.

**Reconciliation Engine.** Nightly provider exports versus the delivery log; produces classified breaks (§11 Expert).

#### End-to-end walkthrough — a fraud alert

1. The fraud engine `POST`s to `/v1/notifications` with `Idempotency-Key: fraud-9f3c…`, `category: FRAUD_ALERT`, `template_id`, and variables.
2. The gateway authenticates the caller and checks it is authorised for `FRAUD_ALERT`.
3. The gateway claims the idempotency key via `INSERT … ON CONFLICT DO NOTHING`. On conflict it returns the original `notification_id` with `202` — no second notification is created.
4. It writes `ACCEPTED` to the delivery log, generates a ULID `notification_id`, and returns `202 {notification_id}` — target under 30 ms.
5. It publishes to `notif.requests.critical` (partitioned by `user_id`).
6. The policy engine consumes. `FRAUD_ALERT.is_suppressible = false`, so consent, preference, and quiet-hour gates are skipped by construction; the suppression list is still consulted for the *channel address* (a number that replied STOP legally cannot be texted), and deduplication still applies.
7. The router loads endpoints: 2 iOS devices, 1 email. Fallback plan: push now; if no terminal delivery within 30 s, add SMS.
8. Push worker renders a **content-light** payload ("Unusual activity on your card — open the app"), because it will display on a locked screen.
9. The APNs adapter sends over a pooled HTTP/2 connection with a deterministic `apns-id`, `apns-priority: 10`, `apns-collapse-id` set to the alert's business key.
10. Response `200` → append `DISPATCHED` with the provider message ID. Timeout → append `INDETERMINATE` and retry **with the same `apns-id`**.
11. Minutes later APNs reports delivery status; receipt ingest verifies the signature and appends `DELIVERED`.
12. The fallback timer finds no terminal delivery on push within 30 s for one device and triggers the SMS leg — which re-enters the policy engine, because a fallback is a new dispatch and must be authorised as one.
13. That night, reconciliation matches the provider's export against the log and raises breaks for anything non-terminal beyond the channel SLA.

#### API design

**`POST /v1/notifications`** — send to one user.

| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | string | yes | Recipient's internal ID |
| `category` | string | yes | e.g. `FRAUD_ALERT`, `PAYMENT_RECEIPT`, `MARKETING_OFFER`. Determines suppressibility, lane, retention, and provider pool |
| `template_id` | string | yes | Versioned template key |
| `template_version` | string | no | Pin a version; defaults to current-active |
| `variables` | object | yes | Must match the template's declared schema; validated at ingest |
| `channels` | string[] | no | Requested channels. **A hint, not a command** — policy may override |
| `fallback` | object | no | `{ after_seconds, channels[] }` |
| `business_event_id` | string | yes | Source event identity; the dedup key derives from this |
| `expires_at` | string (RFC3339) | no | After this, do not dispatch — a late fraud alert has negative value |
| `locale` | string | no | Overrides the user's profile locale |

Headers: `Idempotency-Key` (required for all non-campaign sends), `X-Producer-Id` (from workload identity, not caller-supplied).

Response `202`:

| Field | Type | Description |
|---|---|---|
| `notification_id` | string (ULID) | Server-generated, time-sortable |
| `status` | string | Always `ACCEPTED` at this point — never a delivery claim |
| `deduplicated` | bool | True if this was a repeat idempotency claim |

**Design decisions worth stating unprompted:**

- **`channels` is a hint.** A producer cannot force an SMS to a number on the suppression list. Making the field advisory in the contract prevents forty teams from each inventing a bypass.
- **`variables`, not rendered text** (§2.7) — data minimisation plus fixable typos.
- **`notification_id` is a ULID**, not a UUIDv4: time-sortable, so range scans over the delivery log by time are efficient and index locality is preserved on a write-heavy table.
- **`expires_at` is first-class.** Notifications have *negative* value when stale; without a TTL, a queue drained after an outage delivers yesterday's fraud alerts, which is worse than delivering nothing.
- **`business_event_id` is required.** It is what makes cross-producer deduplication possible at all; making it optional means it will be omitted.

**`GET /v1/notifications/{id}`** returns the request plus a per-delivery breakdown: `channel`, `provider`, `dispatch_state`, `delivery_state`, `attempts`, `last_error`, `provider_message_id`. Two separate state fields — never one (§4).

**`POST /v1/campaigns`** — `{ campaign_id, segment_ref, template_id, category, schedule, throttle: { max_per_second }, expires_at }`. Returns `202` with an expansion job ID; `GET /v1/campaigns/{id}/progress` returns `{ expected, produced, dispatched, terminal, breaks }`.

**`PUT /v1/users/{id}/preferences`** — `{ category, channel, allowed, consent_source, consent_evidence_ref }`. Rejects `allowed=false` for non-suppressible categories with `409`, rather than accepting and silently ignoring it — a rejected write is honest; an ignored one is a lie the UI will render as success.

**`POST /v1/devices`** — `{ user_id, platform, token, app_version, locale, timezone }`. Reassigns on token conflict.

**`POST /v1/receipts/{provider}`** — provider webhook; signature-verified; idempotent by `(provider, provider_message_id, event_type, provider_ts)`.

#### Data model

**`device`** — PostgreSQL.

| Column | Type | Description |
|---|---|---|
| `device_id` | uuid PK | |
| `user_id` | bigint | Indexed |
| `platform` | enum | `IOS`, `ANDROID`, `WEB` |
| `token` | text | **Unique** — reassignment on conflict is the leak prevention (§2.4) |
| `token_updated_at` | timestamptz | Aging input |
| `app_version`, `locale`, `timezone` | text | Segmentation and quiet hours |
| `status` | enum | `ACTIVE`, `UNREGISTERED`, `AGED_OUT` |

**`notification_request`** — PostgreSQL (hot, 30 days), archived thereafter.

| Column | Type | Description |
|---|---|---|
| `notification_id` | ulid PK | |
| `idempotency_key` | text UNIQUE | Claim + result cache |
| `producer_id`, `category`, `template_id`, `template_version` | text | |
| `user_id` | bigint | |
| `variables` | jsonb | Encrypted at rest for high-sensitivity templates |
| `business_event_id` | text | Dedup input |
| `requested_at`, `expires_at` | timestamptz | |
| `status` | enum | `ACCEPTED`, `RESOLVED`, `SUPPRESSED`, `COMPLETED`, `EXPIRED` |

**`delivery`** — Cassandra/DynamoDB, partition `user_id`, clustering `notification_id, delivery_id`.

| Column | Type | Description |
|---|---|---|
| `delivery_id` | ulid | |
| `channel`, `provider` | text | |
| `address_hash` | text | **Hashed** — the plaintext lives only in the owning store |
| `provider_message_id` | text | Reconciliation join key |
| `dispatch_state` | enum | `QUEUED`, `DISPATCHED`, `INDETERMINATE`, `FAILED` — **ours** |
| `delivery_state` | enum | `UNKNOWN`, `DELIVERED`, `BOUNCED`, `DROPPED`, `EXPIRED` — **theirs** |
| `attempt_no`, `last_error_code` | int/text | |
| `content_hash`, `template_version` | text | Evidence without retaining the body |
| `dispatched_at`, `state_at` | timestamp | Aging detection input |

**`delivery_event`** — append-only, TTL 30 days (regulated categories exempt, archived).

| Column | Type |
|---|---|
| `delivery_id`, `seq` | Clustering key |
| `event_type` | `QUEUED`/`DISPATCHED`/`INDETERMINATE`/`DELIVERED`/`BOUNCED`/`DROPPED`/`OPENED` |
| `source` | `SELF`, `WEBHOOK`, `RECONCILIATION` |
| `provider_ts`, `received_ts` | Both — out-of-order webhooks need the provider's clock |
| `raw_ref` | Pointer to the raw payload in object storage |

**`preference`** (mutable) and **`consent_event`** (append-only: `user_id, category, channel, granted, source, evidence_ref, occurred_at`) are deliberately two tables — the first is state, the second is evidence.

**`suppression`** — `(channel, address_hash) PK, reason, created_at, expires_at`. Small, hot, strongly consistent, replicated to every region.

**Status lifecycle:** `ACCEPTED → RESOLVED → {SUPPRESSED | QUEUED} → {DISPATCHED | INDETERMINATE | FAILED} → {DELIVERED | BOUNCED | DROPPED | EXPIRED} → [READ]`.

#### Database selection, and why

| Store | Choice | Reason |
|---|---|---|
| Preferences, consent, devices, idempotency | **PostgreSQL** | Small (~100 GB), relational, correctness-critical, needs ACID for the idempotency claim and unique constraints for token reassignment. Boring is correct here |
| Delivery log + events | **Cassandra / DynamoDB** | 1.7 TB/day, append-only, read by partition key, natural TTL. No relational features needed; write throughput is everything |
| Dedup + rate limits | **Redis** | Sub-millisecond atomic ops via Lua; loss window is tolerable *and stated* (duplicates possible) |
| Archive | **S3 + Parquet, Object Lock** | 300 TB over 7 years, queried rarely via Athena, immutability satisfies the evidentiary requirement |
| Transport | **Kafka** | Replay, multi-consumer (analytics and billing consume the same stream), partition-level ordering per user |
| Templates | **Git + object storage, versioned** | Templates are code: review, version, roll back |

The decision worth defending: **not** using one store for everything. The delivery log's volume would destroy PostgreSQL; the consent data's correctness requirements are not met by a wide-column store. Splitting by access pattern costs an extra store to operate and buys the right guarantee in each place.

#### Provider integration boundary

The payment chapter's hosted-page decision has a direct analogue: **direct provider integration versus an aggregator platform** (SNS, OneSignal, Braze).

| | Direct (APNs/FCM/ESP) | Aggregator |
|---|---|---|
| Receipts | Raw, complete, per-message | Normalised, sometimes lossy |
| Retry/backoff control | Yours | Theirs |
| Rate limits | Provider's own | Aggregator's, shared with other tenants |
| Cost at scale | Lower | Markup per message |
| Time to first send | Weeks | Days |
| Long-tail country coverage (SMS) | You integrate each aggregator | Included |

**Decision:** direct for push and email — at 1.5B/day the markup is material and raw receipts are required for the evidentiary obligation; aggregators for SMS outside core markets, where per-country carrier registration is the real work and not worth owning. This is deliberately a *split* decision rather than a uniform one, and the split follows the volume-and-evidence line.

---

### Step 3 — Design Deep Dive

#### 3.1 Push integration in detail

APNs is HTTP/2, authenticated by a JWT provider token (ES256, `iss`+`iat`, refreshed roughly hourly — refreshing too often is itself rejected), addressed as `POST /3/device/{token}`. Headers that matter:

- `apns-id` — your idempotency handle. **Deterministic from `notification_id`**, reused on every retry. A fresh one per attempt is how you double-send.
- `apns-expiration` — the TTL. Set it from `expires_at`, so a device offline past the alert's usefulness never receives a stale one.
- `apns-priority` — `10` for immediate (alerts), `5` for power-efficient (marketing). Using 10 for everything is an abuse Apple throttles.
- `apns-collapse-id` — supersession (§2.9).

Response handling is where designs fail: `200` = accepted; `410` + `Unregistered` = **the token is dead, write back to the registry now**; `429` = back off, do not add concurrency; `503` = retry with backoff; `400` with `BadDeviceToken` = permanent, invalidate. FCM mirrors this with `UNREGISTERED` / `INVALID_ARGUMENT` / `QUOTA_EXCEEDED` / `UNAVAILABLE`.

**Numbered flow, including the failure path:**

1. Worker pulls a work item, renders, and constructs the payload.
2. Selects a pooled HTTP/2 connection for the correct environment and app bundle.
3. Sends with the deterministic `apns-id`.
4. `200` → append `DISPATCHED` with `apns-unique-id`.
5. `410`/`400 BadDeviceToken` → append `FAILED(endpoint_invalid)`, invalidate the device row, and **if this was the only endpoint, trigger the fallback plan** — a dead token must escalate, not silently end the notification.
6. `429`/`503` → append attempt, requeue with exponential backoff and jitter, reduce the adapter's concurrency limit.
7. Timeout → append `INDETERMINATE`, retry with the same `apns-id`.
8. Provider status arrives later by feedback/receipt → append terminal state.

#### 3.2 Reconciliation

Nightly, each provider's full event export is ingested to object storage (raw, immutable — it is evidence), parsed, and matched against the delivery log on `provider_message_id`. Breaks are classified into the four kinds of §11's exercise and routed three ways, exactly as the payment chapter routes settlement mismatches:

- **Classifiable and automatable** — e.g. a webhook was lost but the file has the terminal state. The engine applies it, recording `source = RECONCILIATION` so the correction is distinguishable from a primary observation.
- **Classifiable, not automatable** — e.g. an orphan receipt implying a duplicate submission. Goes to an engineering queue with the correlation already done.
- **Unclassifiable** — investigation queue.

Two standing rules: reconcile **even though the provider is authoritative** (their exports have bugs, and agreement between two independently-derived numbers is the only evidence you have); and the engine needs a **dead-man's switch** (§11), since a reconciler that quietly stops running removes the system's only external verifier and produces no signal by doing so.

#### 3.3 Processing delays and pending states

Delivery is not synchronous on any channel. SMS can take minutes; email can be deferred for hours by greylisting; push to an offline device waits for the TTL. Consequences for the design:

- `DISPATCHED` is not terminal, and every non-terminal state carries a clock with a **per-channel** SLA (push 15 min, SMS 4 h, email 24 h).
- Fallback timers are driven off *confirmed* delivery, not dispatch: "no terminal delivery in 30 s → escalate channel."
- Webhooks handle the common case; the reconciliation file handles the rest; nothing waits synchronously for either.

#### 3.4 Internal communication

Synchronous calls between these components would couple ingest availability to provider latency and make a provider brownout an ingest outage. So: **Kafka as the spine**, with a specific choice at each hop.

- **Multi-receiver (Kafka topic)** where several consumers need the same event: `notif.dispatched` feeds analytics, billing/cost attribution, and the in-app inbox writer. Kafka retains, so a new consumer can be added without touching producers.
- **Single-receiver (work queue semantics)** for dispatch work items, where exactly one worker should act. Implemented as a Kafka topic with a consumer group, keyed by `user_id` for per-user ordering and rate-limit locality.
- **Retry topics with delay tiers** (`retry.30s`, `retry.5m`, `retry.1h`) rather than in-process sleeping, which would hold a consumer slot and trigger the rebalance loop of §14.
- **Synchronous only** where the answer is needed to proceed and is fast: the suppression-list check and the consent read in the policy engine — both sub-millisecond cache lookups with a strict timeout and a **fail-closed** policy for suppressible traffic.

#### 3.5 Failed dispatches: classification, retry, DLQ

| Error class | Examples | Action |
|---|---|---|
| Transient | timeout, `503`, connection reset | Retry, exponential backoff + jitter |
| Throttled | `429`, `QUOTA_EXCEEDED` | Retry with longer backoff **and reduce concurrency** |
| Endpoint-invalid | `410 Unregistered`, `BadDeviceToken`, hard bounce | Do not retry; invalidate endpoint; escalate to fallback |
| Request-invalid | `400` schema error, missing variable | Do not retry; DLQ; alert the producer team |
| Suppressed | on suppression list | Do not retry; terminal; counted |

Unknown 4xx defaults to **non-retryable**; unknown 5xx to retryable. Getting this default backwards is what produces a retry storm against a provider that is already unhappy.

The retry budget is per notification (max attempts *and* a wall-clock cap bounded by `expires_at`), not per attempt. Exhaustion → DLQ with full context. The DLQ is monitored by **age of oldest message**, because a DLQ nobody drains is just a slower way of losing data. Per-provider and per-producer circuit breakers isolate poison sources so one broken template cannot fill shared retry capacity.

#### 3.6 Exactly-once delivery

`exactly-once = at-least-once ∧ at-most-once`.

**At-least-once** comes from durable acceptance before acknowledgement, at-least-once consumption, and retries. Strategies: immediate retry (only for a single fast attempt), fixed interval (predictable, can synchronise into a thundering herd), incremental, **exponential backoff with jitter** (the default), and cancel (for permanent failures). Jitter is not optional — without it, 200,000 dispatches that failed together retry together.

**At-most-once** comes from three layers:

1. **Idempotency claim at ingest** — `INSERT … ON CONFLICT DO NOTHING` on `idempotency_key`, in the same transaction as the `ACCEPTED` record. Three duplicate outcomes are distinguished (§11 Hard): in-flight (`409` or return the in-progress ID), completed (return the original result), unknown.
2. **Business dedup at policy** — keyed on `(user_id, category, business_event_id, channel, coalesce_bucket)`, TTL ≥ max redelivery horizon (§2.3, §14).
3. **Provider-side handle on retry** — the same `apns-id` / provider idempotency key on every attempt, so the far end deduplicates what your retry duplicates.

**Scenario A — the double submit.** The fraud engine's call times out; it retries with the same `Idempotency-Key`. The claim conflicts; the gateway returns the original `notification_id` and `deduplicated: true`. One notification.

**Scenario B — the lost response.** The worker sends to APNs; APNs accepts; the response is lost. The worker records `INDETERMINATE` and retries with the same `apns-id`. APNs recognises it and does not re-deliver. If the channel has *no* idempotency support (some SMS aggregators), the honest answer is that you choose: retry and accept a possible duplicate SMS, or do not retry and accept a possible miss — and that choice is made **per category**, with fraud alerts retrying and marketing not.

What remains unclosable: if the dispatch record itself is lost after the provider accepted, only reconciliation reveals it — after the fact. Hence "effectively-once with a stated residual window", not "exactly-once".

#### 3.7 Consistency

Stateful participants: preferences/consent, device registry, delivery log, dedup store, suppression list, and the provider's own state.

**Internal consistency** rests on the exactly-once machinery above plus the append-only delivery log, whose events are commutative enough to tolerate out-of-order webhook arrival (apply by `provider_ts`, never overwrite a terminal state with an earlier-timestamped one).

**External consistency** rests on reconciliation. Even where a provider offers idempotent APIs, reconcile — for the same reason the payment chapter gives: do not assume the external system is always correct.

**Replication lag** is the sharpest consistency problem here, because it has legal consequences (§2.14). Options: primary-only reads (simple, doesn't scale), consensus stores (YugabyteDB/CockroachDB — real, expensive), or the chosen approach: **make only the small critical part strongly consistent.** The suppression list is a few hundred million rows of `(channel, address_hash)` — cheap to replicate synchronously and check last. The large preference dataset stays on replicas, with the unsubscribe write path invalidating the cache synchronously before returning success, so a user's own action is causally ordered ahead of any subsequent send.

#### 3.8 Storm control and load shedding

On burst: the queue absorbs (that is its job), lanes ensure the critical traffic drains first, per-provider concurrency limiters hold at the provider's actual ceiling rather than generating 429s, per-user caps and coalescing collapse the human-facing volume, and — past a threshold — the shedding policy drops marketing entirely, then downgrades digests, and never touches the mandatory lane. Every shed decision is counted and labelled, because shedding is a silent success path (§2.12).

#### 3.9 Security

Covered fully in §8. The three decisions that belong in the design itself rather than in a security review: **category-level producer authorisation** (so the highest-trust message type is not callable by the lowest-trust service), **content-light push payloads for sensitive categories**, and **signature verification on every receipt webhook** — an unverified receipt endpoint lets an attacker mark undelivered regulatory notices as delivered, which corrupts the evidence the system exists to produce.

---

### Step 4 — Wrap-Up

**What we did not cover, and would be the next questions:**

- **Monitoring and alerting** — the full SLI set is §2.25. The two that matter most: segmented `delivered/dispatched`, and non-terminal records by age.
- **Debugging tooling** — a per-user timeline view joining requests, deliveries, events, and provider raw payloads; and a "why was this suppressed?" explainer that replays the policy chain, because "the system decided not to send" is otherwise unanswerable by support.
- **Cost attribution** — SMS at ~$525k/day needs per-team chargeback, or no team will optimise.
- **Additional channels** — WhatsApp, RCS, voice; each is a new adapter and a new set of delivery semantics, which the adapter interface must not assume away.
- **Send-time optimisation and A/B testing** — including holdout groups, which interact awkwardly with mandatory categories.
- **Multi-region active-active** with residency (§2.10) — regional data planes, global control plane.
- **Localisation QA** — 20 locales × N templates is a testing problem, and a mis-rendered financial notice in one locale is a compliance event.
- **Accessibility and channel of last resort** — postal mail for customers with no working digital channel, which regulated firms genuinely need.

**Summary.** The system is an **evidence-producing dispatcher**: it accepts intent durably, authorises at the last moment, dispatches through infrastructure it does not own, and spends most of its complexity establishing what actually happened. Three properties define it — burst absorption with structural lane isolation, dispatch-time consent enforcement, and reconciled delivery evidence — and each maps to a failure that is otherwise silent.

---

### References

1. Apple — *Sending Notification Requests to APNs*, HTTP/2 interface, headers, and status codes. developer.apple.com
2. Apple — *Handling Notification Responses from APNs* (`410 Unregistered`, `BadDeviceToken`).
3. Google — *Firebase Cloud Messaging HTTP v1 API* and error-code semantics (`UNREGISTERED`, `QUOTA_EXCEEDED`).
4. Twilio — *Delivery Status and Status Callbacks*; the distinction between `sent`, `delivered`, and `undelivered`.
5. Twilio — *10DLC / A2P registration requirements* (US carrier filtering).
6. Amazon — *SES Sending Statistics, Suppression Lists, and Reputation Dashboard*.
7. Amazon — *SNS Message Delivery Status and Retry Policies*.
8. SendGrid — *Event Webhook*: `processed`, `dropped`, `deferred`, `bounce`, `delivered` — and why `processed` is not delivery.
9. Stripe — *Idempotent Requests* (the canonical `Idempotency-Key` contract).
10. M3AAWG — *Sender Best Common Practices* (reputation, IP warm-up, list hygiene).
11. RFC 3463 — *Enhanced Mail System Status Codes* (hard vs. soft bounce classification).
12. RFC 8058 — *One-Click Unsubscribe* (`List-Unsubscribe-Post`).
13. Uber Engineering — *Reliable Reprocessing and Dead Letter Queues with Apache Kafka*.
14. LinkedIn Engineering — *Air Traffic Controller: member-first notification relevance and volume control*.
15. Slack Engineering — *Flannel / notification delivery at scale*.
16. Netflix Technology Blog — *Delivering messages at scale with the Netflix notification platform*.
17. Alex Xu — *System Design Interview Vol. 2*, ch. "Design a Notification System" and ch. "Design a Payment System" (the four-step method this section follows).
18. Google SRE Book — ch. 6 *Monitoring Distributed Systems* (symptom-based SLIs; why aggregates mislead).
19. GDPR Arts. 6, 7, 21 — lawful basis, consent evidence, and the right to object.
20. 47 CFR §64.1200 (TCPA) — time-of-day restrictions and prior express consent for marketing messages.

---

## 13. Low-Level Design — The Channel Dispatcher

**Requirements.** Given a work item, select a provider, apply per-provider concurrency and rate limits, render, dispatch with a deterministic idempotency handle, classify the outcome, write back endpoint invalidations, append to the delivery log, and remain correct under high concurrency across many providers with independent health.

**Class diagram.**

```mermaid
classDiagram
  class IChannelDispatcher {
    <<interface>>
    +DispatchAsync(WorkItem, CancellationToken) Task~DispatchOutcome~
  }
  class ChannelDispatcher {
    -IProviderSelector selector
    -ITemplateRenderer renderer
    -IDeliveryLog log
    -IDedupStore dedup
    +DispatchAsync(...)
  }
  class IProviderAdapter {
    <<interface>>
    +Channel : string
    +SendAsync(RenderedMessage, ProviderRef, CancellationToken) Task~ProviderResult~
    +Classify(Exception) ErrorClass
    +InvalidateEndpointAsync(Endpoint) Task
  }
  class ApnsAdapter
  class FcmAdapter
  class SesAdapter
  class TwilioAdapter
  class ResilientAdapterDecorator {
    -IProviderAdapter inner
    -ICircuitBreaker breaker
    -IConcurrencyLimiter limiter
    -IRateLimiter quota
  }
  class IProviderSelector {
    <<interface>>
    +Select(Channel, Country, TrafficClass) IProviderAdapter
  }
  class HealthAwareSelector

  IChannelDispatcher <|.. ChannelDispatcher
  IProviderAdapter <|.. ApnsAdapter
  IProviderAdapter <|.. FcmAdapter
  IProviderAdapter <|.. SesAdapter
  IProviderAdapter <|.. TwilioAdapter
  IProviderAdapter <|.. ResilientAdapterDecorator
  ResilientAdapterDecorator o-- IProviderAdapter : wraps
  IProviderSelector <|.. HealthAwareSelector
  ChannelDispatcher --> IProviderSelector
  ChannelDispatcher --> ITemplateRenderer
  ChannelDispatcher --> IDeliveryLog
  ChannelDispatcher --> IDedupStore
```

**Sequence — dispatch with throttling and failover.**

```mermaid
sequenceDiagram
  participant W as Worker
  participant D as ChannelDispatcher
  participant S as HealthAwareSelector
  participant R as ResilientDecorator
  participant A as TwilioAdapter
  participant L as DeliveryLog

  W->>D: DispatchAsync(item)
  D->>S: Select(SMS, "IN", Transactional)
  S-->>D: adapter (primary healthy)
  D->>R: SendAsync(rendered, providerRef)
  R->>R: acquire concurrency slot + quota token
  R->>A: HTTP POST
  A-->>R: 429 Too Many Requests
  R->>R: record failure, shrink limit, open breaker if threshold
  R-->>D: ThrottledException
  D->>L: append Attempt(throttled)
  D->>S: Select(SMS, "IN", Transactional) — exclude primary
  S-->>D: secondary adapter
  D->>R: SendAsync(rendered, SAME providerRef)
  R-->>D: accepted
  D->>L: append Dispatched(providerMessageId)
```

Note the detail that matters: the **same `providerRef` is presented to the secondary provider**. Failing over with a fresh handle is how a failover turns into a duplicate.

**Design patterns used.**

- **Strategy** — `IProviderAdapter` per provider; the dispatcher is provider-agnostic.
- **Decorator** — `ResilientAdapterDecorator` layers circuit breaking, concurrency limiting, and quota without touching adapter code, so resilience policy is uniform and independently testable.
- **Chain of responsibility** — the policy engine's gate sequence (suppressibility → suppression → consent → quiet hours → cap → dedup), each gate returning a labelled decision.
- **Template Method** — a base adapter fixes the invariant sequence (limit → render-check → send → classify → log) while subclasses fill provider specifics.
- **Factory** — `HealthAwareSelector` produces the adapter for `(channel, country, traffic class)`.

**SOLID mapping.**

- **SRP** — the dispatcher orchestrates; the adapter speaks a protocol; the decorator owns resilience; the log persists. Adding a provider touches one class.
- **OCP** — a new channel is a new adapter registration, no changes to the dispatcher.
- **LSP** — the decorator is substitutable for any adapter, which is what makes resilience policy uniform.
- **ISP** — `IProviderAdapter` is deliberately narrow; providers that lack an invalidation concept implement a no-op rather than being forced into a fat interface.
- **DIP** — every dependency is an abstraction, which is what makes the provider simulator (§2.27) possible at all.

**Extensibility.** WhatsApp is a new adapter plus a template type. A new resilience policy (adaptive concurrency, hedged requests) is a new decorator. A new routing rule (cost-based provider selection) is a change confined to the selector.

**Concurrency and thread safety.** Adapters are stateless and shared; all mutable state lives in the decorator (breaker state, limiter counters) behind lock-free primitives (`Interlocked`, `SemaphoreSlim`). HTTP/2 connection pools are shared and thread-safe by construction. The dedup claim is atomic in Redis via Lua — never a `GET`-then-`SET`. Log appends are per-`delivery_id` and therefore contention-free by partition. The one genuine hazard is **the breaker and the selector disagreeing**: a breaker opening while the selector still routes to it produces a burst of fast failures. Resolved by having the selector read breaker state directly rather than maintaining its own health view — one source of truth, as elsewhere in this course.

---

## 14. Production Debugging — "Every user got the same alert four times, but only for six minutes"

**Symptom.** At 14:06 on a Tuesday, support reported customers receiving duplicate push notifications. By 14:12 it had stopped on its own. Post-hoc analysis showed **2.8 million duplicate pushes**, most delivered 3–5 times, all within a six-minute window. No deployment had occurred. No alert had fired — duplicates are not an error condition, so nothing in the system considered this a failure.

**Investigation.**

1. **Establish the blast radius.** The delivery log showed multiple `DISPATCHED` events per `notification_id`, with **different** `provider_message_id`s and `apns-id`s — so these were genuinely separate submissions, not APNs re-delivering.
2. **Check the dedup store.** Redis hit rate on dedup keys was normal. The suppression counter for `reason=duplicate` showed a **dip**, not a spike, during the window — deduplication had *stopped firing*, not started misfiring.
3. **Check the consumer group.** Kafka metrics showed the push consumer group rebalancing **repeatedly** between 14:02 and 14:11 — nine rebalances in nine minutes, against a normal rate of roughly one a week.
4. **Find what triggered the rebalances.** APNs p99 latency had risen from 40 ms to 3.2 s starting at 14:01 (later confirmed as an Apple-side incident). Workers processed a batch of 500 records per poll; at 3.2 s each with the configured concurrency, a batch took longer than `max.poll.interval.ms` (5 min). The broker evicted the consumer as dead, rebalanced, and the partition's uncommitted offsets were reprocessed by a new owner — which then also exceeded the interval, and so on.
5. **Explain why dedup did not catch the reprocessing.** The dedup key was correct. Its **TTL was 60 seconds**, chosen years earlier to bound Redis memory. The reprocessing gap between a message's first attempt and its redelivery after two rebalances was **4–8 minutes**. Every dedup entry had already expired by the time the duplicate arrived.
6. **Explain why it stopped.** Apple's latency recovered at 14:11; batches completed inside the poll interval; rebalancing stopped; duplicates stopped. **The system healed without anyone acting, which is why nobody learned anything from it the first time it happened** — and log analysis found two earlier, smaller instances that had been closed as "customer error."

**Root cause.** A **dedup TTL shorter than the maximum redelivery horizon.** The horizon is not a configuration value — it is an emergent property of the slowest dependency's latency multiplied by the batch size, compared against the consumer's poll interval. A third-party latency increase silently pushed the horizon from seconds to minutes, past a 60-second TTL that had been correct under every condition anyone had tested.

**Tools.** Kafka consumer-group metrics (`rebalance-rate-per-hour`, `commit-latency`, `records-lag`); provider latency histograms segmented by provider; the delivery-event log grouped by `notification_id` to count distinct dispatches; Redis `INFO keyspace` and TTL sampling; the suppression counter by reason — **which was the single most diagnostic signal, and existed only because §2.12's "count every silent path" rule had been applied**.

**Fix.**

*Immediate (that day):* raised the dedup TTL to 30 minutes, sized against the worst observed redelivery gap plus a large margin; measured the Redis memory impact as acceptable (~14 GB).

*Structural (the following sprint):*

1. **Decouple polling from processing.** Poll, hand to a bounded internal queue, commit on completion — so provider latency no longer determines whether the consumer looks alive. This removes the entire failure mode rather than widening the window.
2. **Adaptive concurrency per provider**, so rising latency reduces in-flight requests instead of extending batch duration.
3. **A retry-topic tier** so slow work leaves the main consumer rather than blocking it.
4. **Alert on duplicate dispatches** — `count(distinct provider_message_id) per notification_id > 1` — because the system previously had no concept of "duplicate" as a failure and therefore could not alert on its own most visible symptom.
5. **Assert the invariant in code:** `dedupTtl >= maxRedeliveryHorizon`, where the horizon is computed from `maxPollInterval × maxExpectedRebalances`, validated at startup, failing to boot if violated. A relationship between two configuration values that nobody can see is a relationship that will drift.

**Prevention — and the generalisable lesson.**

The narrow lesson is a TTL. The general one, worth stating in an interview: **a deduplication window is not a memory-management parameter; it is a correctness parameter whose required value is set by a system property nobody controls.** Anywhere a TTL, a timeout, or a retention window must exceed something else, encode the *relationship* — assert it at startup, alert on it at runtime — rather than encoding two independent numbers and hoping.

The second lesson is about self-healing incidents. This failure resolved on its own, twice before, and each time the absence of a lasting symptom prevented investigation. **A transient failure that leaves no residue is more dangerous than a persistent one**, because the system's recovery destroys the evidence. Duplicate-dispatch counting exists now precisely so the residue outlives the incident.

---

## 15. Architecture Decision — How Should Delivery State Be Tracked?

The question that determines whether §4's incident is possible.

**Option A — Fire and forget.** Dispatch, log a line, keep no queryable state.

*Advantages:* trivial; no storage cost; nothing to reconcile.
*Disadvantages:* cannot answer "was this delivered?"; no retry state; no evidence; no reconciliation possible.
*Cost:* near zero. *Complexity:* minimal. *Maintainability:* good until the first dispute. *Performance:* best. *Scalability:* best. *Ops overhead:* none — and no ability to operate.
*Verdict:* acceptable only for genuinely disposable notifications. Disqualified here by the seven-year evidence requirement.

**Option B — A mutable `status` column.** One row per delivery, updated in place.

*Advantages:* simple; obvious queries; one row per delivery keeps volume low.
*Disadvantages:* the fatal one — **it forces one value to represent two facts** (what we did, what they report), which is precisely §4's failure. Out-of-order webhooks overwrite terminal states with earlier ones. History is destroyed, so "what did we know at 14:00?" is unanswerable, and corrections are indistinguishable from primary observations.
*Cost:* low. *Complexity:* low. *Maintainability:* deceptively good. *Performance:* update-heavy on a hot table. *Scalability:* poor at 2.2B/day of updates. *Ops overhead:* low until an audit.
*Verdict:* the most common design in the wild, and the one that produced the incident this module is built around.

**Option C — Append-only delivery-event log with derived current state.** Immutable events; a materialised `delivery` row carrying the two separate state fields.

*Advantages:* out-of-order receipts are trivially handled (apply by `provider_ts`); corrections from reconciliation are marked as such via `source`; full history for audit and debugging; append-only writes suit a wide-column store perfectly; the two-fact problem disappears because dispatch and delivery are separate columns fed by separate event types.
*Disadvantages:* higher storage (3–5 events per delivery); current state must be derived or maintained; requires a compaction/TTL strategy.
*Cost:* moderate — but the numbers in Step 1 show it is affordable, and the regulated subset that needs long retention is small.
*Complexity:* moderate. *Maintainability:* high — new event types are additive. *Performance:* excellent for writes. *Scalability:* excellent. *Ops overhead:* moderate (TTL, archival, reconciliation).

**Option D — Full event sourcing of the notification aggregate.** Every state change as a domain event; state rebuilt by replay; the log as the only store.

*Advantages:* maximum fidelity; temporal queries natural.
*Disadvantages:* schema-evolution burden across billions of events; rebuild cost at this volume is prohibitive; and the aggregate here is small and short-lived, so the pattern's main benefit — complex multi-step aggregate consistency — is not needed.
*Cost:* high. *Complexity:* high. *Maintainability:* poor at this cardinality. *Performance:* read-side requires projections anyway. *Ops overhead:* high.
*Verdict:* the framework's costs without its benefits (§2.23).

**Comparison.**

| | A: Fire & forget | B: Mutable status | C: Append-only log | D: Event sourcing |
|---|---|---|---|---|
| Answers "was it delivered?" | No | Ambiguously | **Yes** | Yes |
| Survives out-of-order receipts | n/a | No | **Yes** | Yes |
| Separates our state from theirs | No | No | **Yes** | Yes |
| Audit / evidence capable | No | Weak | **Yes** | Yes |
| Storage cost | Minimal | Low | Moderate | High |
| Operational complexity | None | Low | Moderate | High |
| Write scalability at 2.2B/day | Best | Poor | **Excellent** | Good |

**Recommendation: Option C.**

The justification is not that it is the richest model — D is — but that it is the **cheapest model that makes §4's incident impossible**. B fails on a single, specific, provable ground: it stores one value where the domain has two independent facts with different owners and different trustworthiness, and no amount of discipline recovers from that at the schema level. C fixes exactly that, keeps the write pattern that the volume demands, and stops short of the framework whose costs the aggregate shape does not justify.

The decision also carries a rule worth generalising: **when two parties independently assert facts about the same object, they get separate fields.** Collapsing them is not a simplification; it is a loss of information that will be discovered by an auditor rather than by a test. This is the same conclusion Module 178 reached for the ledger — derived balances rather than a cached one, because a second source of truth is a future divergence — arriving here from an entirely different direction.

---

## 17. Principal Engineer Perspective

**Business impact, stated in the language the business uses.** This system's failures are not "notification failures". They are: *a customer was liquidated without notice* (legal exposure, regulatory finding, remediation cost); *card authorisations failed because OTPs did not arrive* (direct revenue loss, measurable per minute); *we sent marketing to 40,000 people who opted out* (statutory penalty per message, plus a reportable incident); *fraud losses rose because alerts arrived late* (a number the fraud team already tracks). A Principal Engineer's first move on this system is to build that translation table, because it converts "improve notification reliability" — which will never win a prioritisation argument — into four line items that each have an owner and a number.

**The trade-off that defines the system.** Duplicate versus miss, and the crucial insight is that **the correct answer differs per category and must therefore be a property of the data, not of the code**. Fraud alerts: retry aggressively, duplicates are free. Marketing: never risk sending after opt-out; a miss is free. OTP: duplicates confuse users and enable enumeration, so retry with provider-side idempotency and cap attempts. A design that picks one global answer is wrong for most of its traffic — and the mechanism that makes per-category answers possible is a category registry with real semantics, which is why Step 1's estimation elevated `category` to an architectural concern.

**Technical leadership.** The hardest part of this system is not building it — it is **getting forty producing teams to classify their traffic honestly**. Every team believes their notification is urgent. Left to declaration, everything becomes `CRITICAL` and lanes stop meaning anything. The mechanisms that actually work: make the classification carry a cost the team feels (critical-lane traffic is charged at a higher internal rate; SMS spend is attributed per team), make it carry an obligation (regulated categories require a retention decision and a compliance sign-off), and make misclassification visible (a dashboard of category volume by team, reviewed monthly). Governance that relies on goodwill degrades; governance attached to a cost line does not.

**Cross-team communication.** Two conversations recur. With **compliance**: they will ask for proof of delivery and you must explain, without hedging, that push and SMS cannot provide it and email can — then agree which channel is the evidentiary one. Getting this agreed *in writing, in advance* converts a future incident into a documented, accepted limitation. With **product**: they will want more notifications; the counter-argument is not "the system can't handle it" (it can) but **notification permission is a non-renewable resource** — a user who revokes push permission after being over-messaged is unreachable by that channel forever, including for fraud alerts. Framing volume as consumption of a finite asset changes the conversation from throughput to budget.

**Architecture governance.** Three invariants to defend at review, indefinitely: (1) **no producer bypasses the platform** — every direct SMTP or Twilio integration is a compliance gap that suppression lists do not cover, and the correct response to "we need to send from our service" is to make the platform's path easy, then remove network egress to providers from everything else; (2) **suppressibility lives on the category**, never on the preference row; (3) **dispatch state and delivery state stay separate columns** — this is the one schema decision that, if lost in a "simplification", reopens §4.

**Cost optimisation.** $525k/day of SMS is the largest single lever and it is a *routing* problem, not an infrastructure one: prefer push where a live token exists (free), fall back to SMS only on non-delivery, use per-country aggregator pricing in the selector, and coalesce aggressively. Second lever: the 30-day hot window. Most teams default to keeping everything hot because deciding is harder than storing; the classification work in Step 1 pays for itself in storage within a quarter. Third: dead tokens. A registry that is 30% dead is 30% of push dispatch capacity spent on nothing, and cleaning it is a background job.

**Risk analysis.** The top risks, in order of expected loss: (1) **silent non-delivery of a regulated notice** — the §4 class, mitigated only by aging detection and reconciliation, never by better dashboards; (2) **an unlawful send after opt-out** — mitigated by dispatch-time consent and a strongly-consistent suppression list; (3) **OTP unavailability cascading into payment failure** — mitigated by treating notification as a tier-1 dependency of payments and building a non-SMS path; (4) **reputation collapse from a bad campaign** — mitigated by traffic-class segregation, which must be built before it is needed; (5) **the reconciler silently stopping** — mitigated by a dead-man's switch, because it is the one component whose failure the system cannot otherwise detect.

**Long-term maintainability.** The parts of this system that will still be here in ten years are the category registry, the consent log, and the delivery log's schema. Providers will be replaced — that is what the adapter interface is for. Channels will be added — WhatsApp today, something else later. What must not require a migration is the **semantic model**: what a category means, what consent was given, and what happened to each message. Invest disproportionately there, and treat the adapter layer as deliberately disposable. The clearest sign of a well-built notification platform after five years is that three providers have been swapped out and nobody outside the platform team noticed.

---

> **Cross-module synthesis.** This module is the third consecutive appearance of a single defect class in `14-System-Design`: *the failure that presents as success.* Module 177 §14 had a hot Redis shard invisible behind a flat p50; Module 178 §4 had settlement lines correctly deduplicated and silently discarded; here, §4 has eleven weeks of undelivered margin calls sitting at 99.97% "success" because a non-terminal state was counted in the numerator. Three domains, three mechanisms, one shape — and in all three cases the remedy was the same triple: **an independent verifier, a counter on every silent path, and detection by aging rather than by rate.** When a fourth instance appears, the pattern is no longer a coincidence to note but a checklist to apply before the incident.
