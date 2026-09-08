# 18. System Design — 25 Questions (Answered)

> **Method:** every design below follows the same spine an interviewer expects — **clarify and scope → requirements and back-of-the-envelope numbers → high-level architecture → data model and core flows → failure handling → explicit trade-offs and wrap-up**. Patterns and mechanics are cross-referenced to the modules that cover them in depth (Microservices **04**, Distributed Systems **05**, EDA **07**, Kafka **08**, AWS **09**, Kubernetes **10**, Performance **11**, Architecture Patterns **12**, Event Sourcing **13**, CQRS/Saga/Outbox **14**, Security **15–17**), so this module is about *composition and judgement*, not re-deriving each pattern. Service behaviour and limits are taken from **AWS documentation**, **Microsoft Learn**, the **Kafka** and **Kubernetes** docs, and the relevant **IETF RFCs**; card-scheme and settlement mechanics reflect **PCI DSS** and scheme/ISO 20022 conventions. Links in **References**.
>
> **How to use this module:** the numbers are illustrative but arithmetically consistent — the point is the *method* of deriving load from business volume, and then letting that number decide the architecture. In an interview, always state the number before you draw the box.

## The interview framework this module follows

Three widely used references converge on essentially the same shape for a system design interview, and each answer below is structured to make that shape explicit rather than leaving it implicit:

| Source | Framework |
|---|---|
| **ByteByteGo** / Alex Xu, *System Design Interview — An Insider's Guide* | **(1) Understand the Problem and Establish Design Scope → (2) Propose High-Level Design and Get Buy-In → (3) Design Deep Dive → (4) Wrap-Up** — the canonical four-step process the book applies to every chapter and recommends using verbatim in a real interview |
| **GeeksforGeeks**, *System Design Tutorial* / *How to Answer a System Design Interview Problem* | A finer-grained seven-part breakdown: understand the goal and gather requirements → estimation and constraints → high-level component design → detailed/low-level design → data model design → API design → identify and resolve bottlenecks |
| **System Design School**, *What Is a System Design Interview* | Requirements gathering (functional + non-functional) → capacity estimation → high-level architecture → deep dive → trade-off analysis — explicitly warning against **"memorisation and buzzword stacking"** in place of reasoning from first principles, and against skipping capacity estimation |

**These are the same framework at different resolutions**, and this module reconciles them into one consistent spine used in every question:

```text
Step 1 — Understand the Problem & Establish Design Scope   (ByteByteGo Step 1 / GFG steps 1–2 / SDS step 1)
   clarifying Q&A · functional & non-functional requirements · back-of-the-envelope estimation
   → an explicit statement of what the numbers imply is the actual hard problem

Step 2 — Propose High-Level Design & Get Buy-In             (ByteByteGo Step 2 / GFG step 3)
   component diagram · end-to-end flow

Step 3 — Design Deep Dive                                   (ByteByteGo Step 3 / GFG steps 4–6)
   data model · API design · the specific mechanism the question is really testing ·
   failure handling and bottleneck resolution

Wrap-Up                                                      (ByteByteGo Step 4 / GFG step 7 / SDS step 5)
   explicit trade-off table · what was deliberately left out of scope ·
   the monitoring signals that would tell you the design is wrong ·
   the natural follow-up question an interviewer would ask next
```

Below, **"Step 1"** and **"Step 2"** headers are labelled with their canonical name so the mapping is unmistakable; the numbered steps that follow constitute the **Design Deep Dive** (their content varies by question, exactly as intended — deep dive means "whichever mechanism this specific system actually turns on"); and every **Trade-offs** table closes with a **Wrap-Up** covering the three GFG/ByteByteGo elements most often skipped under interview time pressure: explicit scope boundaries, monitoring signals, and the next question.

---

## Q1. Design an Order Management System.

### Step 1 (Understand the Problem & Establish Design Scope) — Scope it before you draw anything

**Q:** Retail e-commerce orders, or capital-markets orders?
**A:** Take e-commerce/enterprise fulfilment here; the trading variant is Q14.

**Q:** Do we own payments, inventory and shipping, or integrate?
**A:** We own orchestration and the order lifecycle. Payment is a separate service (Q2), inventory is ours, shipping is a third-party carrier API.

**Q:** Scale?
**A:** 5 million orders/day, with a 10× peak on promotional days.

**Functional:** create/amend/cancel an order, reserve inventory, take payment, split into shipments, track fulfilment, handle returns and refunds, expose order history.
**Non-functional:** no double-charging and no overselling; order state must be auditable; 99.95% availability; order creation p99 < 500 ms; eventual consistency acceptable *between* services, never *within* an order's own state.

**Back of the envelope:**

```text
5,000,000 orders/day ÷ 86,400 s   ≈  58 orders/s average
peak factor 10                    ≈  580 orders/s write
reads (tracking, history) ≈ 20× writes ≈ 12,000 reads/s
each order ~2 KB + 5 events × 1 KB ≈ 7 KB → 5M × 7 KB ≈ 35 GB/day ≈ 12 TB/year
```

**What the numbers imply:** 580 writes/s is *not* a throughput problem — a single well-indexed relational primary handles it. **The hard problem is correctness across services**: money and inventory must not diverge when a step fails. That is the design driver, and saying so is what separates a Staff-level framing from a Senior one.

### Step 2 (Propose High-Level Design & Get Buy-In) — High-level design

| Component | Responsibility |
|---|---|
| **API Gateway / BFF** | AuthN, rate limiting, request shaping for web vs mobile |
| **Order Service** | System of record for the order aggregate and its state machine |
| **Saga Orchestrator** | Drives the multi-service order workflow and compensations |
| **Inventory Service** | Reservations and stock levels |
| **Payment Service** | Authorisation and capture (Q2) |
| **Shipment Service** | Carrier integration, label creation, tracking |
| **Pricing/Promotion Service** | Prices and discounts at capture time |
| **Notification Service** | Customer email/SMS/push (Q7) |
| **Read Model / Search** | Denormalised order views for history and support (CQRS — Q16) |

```text
Client ─▶ API GW ─▶ Order Service ──(outbox)──▶ Kafka
                        │                        │
                        ▼                        ├─▶ Inventory
                 Orders DB (Postgres)            ├─▶ Payment
                        │                        ├─▶ Shipment
                        └─▶ Saga Orchestrator ◀──┤
                                                 └─▶ Read Model / Search
```

**The order state machine — write it down, interviewers look for it:**

```text
CREATED → PENDING_PAYMENT → PAID → ALLOCATED → PICKING → SHIPPED → DELIVERED
   │            │              │        │
   └─▶ CANCELLED ◀─────────────┴────────┘        (compensation paths)
                    REFUNDED ◀── RETURN_REQUESTED ← DELIVERED
```

Transitions are **guarded and persisted**, never inferred. An order is only ever moved by an explicit, idempotent command.

### Step 3 — Data model

```sql
CREATE TABLE orders (
    order_id        UUID PRIMARY KEY,
    customer_id     BIGINT       NOT NULL,
    status          VARCHAR(24)  NOT NULL,      -- state machine above
    currency        CHAR(3)      NOT NULL,
    total_minor     BIGINT       NOT NULL,      -- integer minor units, never float
    idempotency_key VARCHAR(64)  NOT NULL UNIQUE,
    version         INT          NOT NULL,      -- optimistic concurrency
    created_at      TIMESTAMPTZ  NOT NULL,
    updated_at      TIMESTAMPTZ  NOT NULL
);
CREATE TABLE order_lines (
    order_id UUID REFERENCES orders, line_no INT, sku VARCHAR(64),
    qty INT, unit_price_minor BIGINT, PRIMARY KEY (order_id, line_no)
);
CREATE TABLE order_events (      -- append-only history, not the source of truth here
    order_id UUID, seq BIGINT, type VARCHAR(48), payload JSONB,
    occurred_at TIMESTAMPTZ, PRIMARY KEY (order_id, seq)
);
```

**Two modelling choices to justify out loud:** money is stored as **integer minor units** (`total_minor BIGINT`) because binary floating point cannot represent 0.10 exactly and rounding errors in a ledger are unrecoverable; and `idempotency_key` is **unique-constrained in the database**, so duplicate submissions are rejected by the storage engine rather than by application logic that can race.

### Step 4 — The order saga

Order placement spans four services, so there is no distributed transaction — it is an **orchestrated saga** (Module 14):

```text
1. Reserve inventory        compensate: release reservation
2. Authorise payment        compensate: void authorisation
3. Confirm order            compensate: cancel order
4. Capture payment          compensate: refund
5. Create shipment          compensate: cancel shipment
```

**Orchestration over choreography here**, deliberately: the order lifecycle is a genuine business process with an owner, needs a visible current position, and must be queryable by support staff ("where is order 8812 stuck?"). Choreography would scatter that state across five services with no single place to answer the question.

**Reserve-then-confirm is the key inventory pattern.** A reservation is a short-TTL hold (15 minutes), not a decrement:

```sql
UPDATE inventory SET available = available - :qty, reserved = reserved + :qty
 WHERE sku = :sku AND available >= :qty;    -- 0 rows affected = out of stock
```

The conditional `WHERE` makes overselling impossible under concurrency without an explicit lock, and expired reservations are swept back by a background job — so an abandoned checkout does not permanently consume stock.

### Step 5 — Failure handling

| Failure | Handling |
|---|---|
| Payment authorised, order-service crash before commit | Outbox + saga state is durable; on restart the orchestrator resumes from its last persisted step |
| Duplicate client submit | `Idempotency-Key` unique index returns the original order (Module 14) |
| Inventory service down | Circuit breaker → fail fast → order stays `CREATED`, retried by the saga with backoff |
| Carrier API returns 500 after creating a label | Idempotent carrier request keyed on `order_id`; reconcile against the carrier's daily manifest |
| Saga stuck | Timeout per step, alert, and a **manual intervention queue** — a real requirement, not a gap |

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Relational primary for orders | DynamoDB | 580 writes/s does not need NoSQL; ACID, joins, DBA familiarity and mature tooling matter more |
| Orchestrated saga | 2PC | 2PC across HTTP services means distributed locks and cross-service coupling; nobody runs it at scale |
| CQRS read model for history | Query the primary | Read:write is 20:1 and support queries are ad-hoc; isolating them protects the write path |
| Inventory reservations with TTL | Decrement at checkout | Avoids permanently losing stock to abandoned carts |

### Wrap-Up

**Out of scope, and worth saying so explicitly:** the returns/refunds workflow in depth, multi-warehouse allocation logic, and how promotions/pricing interact with the saga — each is a design question in its own right.

**Monitoring that would tell you this design is wrong:** count of orders stuck in `PENDING_PAYMENT` past a threshold; expired-reservation sweep rate (a sustained spike means checkout abandonment is up, not a bug); oversell incidents, which should be structurally zero given the conditional `UPDATE`; saga steps stuck longer than their timeout.

**The natural next question:** "how do you handle a partial shipment when only some order lines are in stock?" — worth having a one-line answer ready (split the order into child shipments, each with its own tracking, while the parent order stays the unit of customer-facing status).

---

## Q2. Design a Payment System.

### Step 1 (Understand the Problem & Establish Design Scope) — Scope

**Q:** Are we the merchant taking card payments, or building a PSP?
**A:** Merchant-side pay-in, with pay-out (refunds, disbursements) treated as a separate flow.

**Q:** Do we store card data?
**A:** **No** — a hosted payment page / client-side tokenisation keeps PANs out of our systems, which cuts PCI DSS scope from the full SAQ D to a far narrower assessment (Module 17 Q12). This is an architectural decision with a seven-figure compliance consequence, so state it first.

**Q:** Single or multi-currency, single or multi-region?
**A:** Multi-currency, single region initially, with multi-region as a known future step (Q12).

**Functional:** authorise, capture, void, refund, handle 3-D Secure, record the ledger, reconcile with the acquirer, support multiple PSPs.
**Non-functional:** **exactly-once money movement** — no double charge, no lost payment; complete auditability; reconciliation to the penny; 99.99% availability on the authorisation path.

**Back of the envelope:**

```text
1,000,000 payments/day ÷ 10^5 s  ≈  10 TPS   (10^5 ≈ 86,400, the standard shortcut)
peak 5×                          ≈  50 TPS
```

**What the number implies — and this is the whole point of the estimation:** **10 TPS is trivially small.** No sharding, no exotic datastore, no cache tier is required. **The hard problem is correctness, not throughput**: every payment must be exactly-once, fully auditable, and reconcilable against a third party you do not control. A candidate who responds to 10 TPS by proposing Cassandra and a Redis cluster has misread the problem.

### Step 2 (Propose High-Level Design & Get Buy-In) — High-level design

| Component | Responsibility |
|---|---|
| **Payment Service** | Owns the payment lifecycle and the idempotency contract |
| **Payment Executor** | Talks to one specific PSP (Stripe/Adyen/Worldpay); one adapter per provider |
| **Ledger Service** | Double-entry book of record — the financial truth |
| **Wallet/Balance Service** | Per-merchant or per-customer balances derived from the ledger |
| **Reconciliation Service** | Ingests the acquirer's settlement file nightly and classifies breaks |
| **Risk/Fraud Service** | Pre-authorisation scoring, called synchronously with a strict timeout |
| **PSP Webhook Receiver** | Receives asynchronous outcome notifications |

```text
                    ┌──────────────┐
 Client ──token──▶  │   Payment    │──▶ Risk (sync, 200 ms budget)
                    │   Service    │
                    └──────┬───────┘
                           │ outbox
                           ▼
                    Kafka payments.events
                     │        │        │
                 Executor  Ledger  Reconciliation
                     │
                     ▼
                 PSP (Stripe/Adyen) ──webhook──▶ Webhook Receiver ──▶ Payment Service
```

**Authorisation vs capture is the domain distinction to get right.** Authorisation reserves the funds and is reversible by a void; capture actually moves them. Separating them lets you authorise at checkout and capture at dispatch — which is both a business requirement and the reason the state machine has more states than people expect:

```text
NOT_STARTED → PENDING → AUTHORISED → CAPTURED → SETTLED
                  │          │           │
                  └─▶ FAILED └─▶ VOIDED   └─▶ REFUNDED / PARTIALLY_REFUNDED
                                            └─▶ CHARGEBACK
```

### Step 3 — API and data model

```http
POST /v1/payments
Idempotency-Key: 5f3a-1c88-...            ← required; the client generates it
{
  "amount":   { "value": "129.99", "currency": "GBP" },   ← string, not double
  "payment_token": "tok_9f3a2c7e",
  "order_id": "ord-8812",
  "capture":  "manual"
}
→ 201 { "payment_id": "pay_77213", "status": "AUTHORISED", "psp_reference": "..." }
```

| Field | Type | Note |
|---|---|---|
| `amount.value` | **string** | Never a JSON number — `129.99` is not representable in IEEE-754 binary64, and different languages round differently. Serialise as a string, store as integer minor units |
| `Idempotency-Key` | header | Client-generated, unique per logical payment attempt, retained 24h+ |
| `payment_token` | string | Vault token, never a PAN |

```sql
CREATE TABLE payments (
    payment_id      UUID PRIMARY KEY,
    idempotency_key VARCHAR(64) NOT NULL,
    order_id        VARCHAR(64) NOT NULL,
    amount_minor    BIGINT      NOT NULL,
    currency        CHAR(3)     NOT NULL,
    status          VARCHAR(24) NOT NULL,
    psp             VARCHAR(24) NOT NULL,
    psp_reference   VARCHAR(64),
    version         INT         NOT NULL,
    CONSTRAINT uq_idem UNIQUE (idempotency_key)
);

-- Double-entry ledger: the financial source of truth. Append-only, never UPDATE.
CREATE TABLE ledger_entries (
    entry_id     BIGSERIAL PRIMARY KEY,
    txn_id       UUID        NOT NULL,       -- groups the balanced legs
    account_id   VARCHAR(64) NOT NULL,
    direction    CHAR(2)     NOT NULL,       -- DR | CR
    amount_minor BIGINT      NOT NULL CHECK (amount_minor > 0),
    currency     CHAR(3)     NOT NULL,
    occurred_at  TIMESTAMPTZ NOT NULL
);
```

**Double-entry is not bookkeeping pedantry — it is an integrity check.** Every transaction writes balanced legs summing to zero, so a corrupted or partial write is detectable by a query rather than discovered by a customer. A balance is `SUM(CR) - SUM(DR)`, and it can always be explained by the entries that produced it.

### Step 4 — Exactly-once, stated precisely

**exactly-once = at-least-once AND at-most-once.**

- **At-least-once** comes from **retries**: the payment is durably recorded before the PSP call, and a retry loop (with exponential backoff and jitter) plus a DLQ guarantees the attempt eventually happens.
- **At-most-once** comes from **idempotency**: the `Idempotency-Key` unique constraint, plus a PSP-side idempotency key on the outbound call, guarantees it happens no more than once.

Two scenarios worth working through, because they are the ones interviewers actually ask:

1. **User double-clicks Pay.** Two requests, same `Idempotency-Key`. The first inserts; the second violates the unique index and returns the **first request's stored response**, not an error — the client sees one successful payment.
2. **The PSP succeeded but the response was lost.** We do not know whether the charge happened. **Never blindly retry.** The outbound call carries our own idempotency key, so a retry is safe at the PSP; and if the state remains ambiguous, the payment sits in `PENDING` until the webhook arrives or reconciliation resolves it. **Ambiguity is a state, not an error.**

### Step 5 — Reconciliation, which is mandatory and always forgotten

Every night the acquirer publishes a settlement file. Ingest it and compare, line by line, against the ledger:

| Break type | Handling |
|---|---|
| In our ledger, not in their file | Automatable: mark pending, re-check next cycle, escalate after N days |
| In their file, not in our ledger | **Serious** — money moved that we did not record. Investigate immediately |
| Amount mismatch | Usually FX or fees — apply a fee-adjustment rule, else manual |
| Duplicate in their file | Automatable de-duplication on PSP reference |

**Reconciliation is required even when the PSP claims idempotency.** Independent verification against externally supplied truth is what turns "we believe the balances match" into "we have proven they match", and it is the control auditors ask about first.

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Boring ACID relational DB | NoSQL for scale | 10 TPS. Stability, transactions, mature tooling and DBA availability beat benchmark numbers |
| Hosted payment page / tokenisation | Store PANs ourselves | Removes most of PCI DSS scope; the single highest-leverage decision in the design |
| Async executor via Kafka | Synchronous call to the PSP | Decouples our availability from theirs; retries and DLQ become infrastructure, not code |
| Double-entry ledger | Balance column with updates | An updated balance loses its explanation; double-entry makes corruption detectable |

### Wrap-Up

**Out of scope:** multi-currency FX conversion, the dispute/chargeback workflow, subscription/recurring billing, and payout to merchants — pay-out is a genuinely separate flow from the pay-in covered here.

**Monitoring that matters:** authorisation success rate by PSP and by card scheme; reconciliation-break count and, more importantly, break *age* (a break open more than 24 hours is an escalation, not a metric); PSP p99 latency; webhook-delivery lag against the async executor.

**The natural next question:** "how do you handle a chargeback?" — the short answer is that it is a new saga triggered by an external event (the scheme's chargeback notification), not a reversal of the original one, because the funds movement and the liability decision are genuinely new facts requiring their own ledger entries.

---

## Q3. Design a Fund / Investment platform.

### Step 1 (Understand the Problem & Establish Design Scope) — Scope

**Q:** What instruments?
**A:** Mutual funds and ETFs — not derivatives; the settlement model is materially different.

**Q:** Who values the fund?
**A:** We consume the **NAV** (net asset value) from the fund administrator once daily; we do not calculate it. This matters enormously, because it means **order execution is not real-time**.

**Functional:** onboarding and KYC/AML, funding the cash account, subscribe/redeem/switch orders, portfolio and holdings valuation, corporate actions, dividends and reinvestment, statements, tax reporting.
**Non-functional:** the ledger must balance to the penny; every order must be traceable end to end for compliance; NAV-day cut-off must be enforced exactly; 7-year record retention (Module 17 Q16).

**The defining domain constraint, and the thing a candidate must know:** mutual-fund orders execute at **forward pricing**. An order placed before the daily cut-off (say 12:00) executes at *that day's* NAV, published in the evening; an order placed after executes at the *next* day's. **The user does not know the price when they place the order.** This single fact shapes the entire architecture — order capture, valuation, confirmation and settlement are separate phases separated by hours.

**Back of the envelope:**

```text
500,000 investors, ~2 orders/investor/month  ≈ 33,000 orders/day ≈ 0.4 TPS
NAV-day batch: 500,000 portfolios × 12 holdings = 6M valuations, nightly
```

**Implication:** the online path is trivially small; **the engineering weight is in the nightly batch, the cut-off correctness and the ledger.**

### Step 2 (Propose High-Level Design & Get Buy-In) — High-level design

```text
 Client ──▶ API GW ──▶ Order Capture ──▶ Order DB (PENDING, priced_nav_date)
                            │
                            ├─▶ Compliance/Suitability checks (sync)
                            └─▶ Cash Ledger (reserve funds)

 ── daily cut-off ─────────────────────────────────────────────────
 Batch Orchestrator (Step Functions):
    1. Freeze orders for the NAV date        4. Allocate units = amount / NAV
    2. Aggregate & place with fund admin     5. Post ledger entries
    3. Await NAV file + execution confirms   6. Update holdings, notify investors
```

| Component | Responsibility |
|---|---|
| **Order Capture** | Validates, checks cut-off, reserves cash, persists `PENDING` |
| **Batch Orchestrator** | The NAV-day pipeline — a durable, restartable workflow |
| **Fund Admin Adapter** | File or API exchange with the administrator/transfer agent |
| **Position/Holdings Service** | Units held per investor per fund |
| **Valuation Service** | Marks portfolios at latest NAV; produces performance figures |
| **Cash Ledger** | Double-entry cash and unit ledger |
| **Corporate Actions** | Dividends, distributions, fund mergers, share-class conversions |
| **Reporting** | Statements, contract notes, tax packs (long retention) |

### Step 3 — Data model

```sql
CREATE TABLE orders (
    order_id      UUID PRIMARY KEY,
    investor_id   BIGINT NOT NULL,
    fund_id       VARCHAR(24) NOT NULL,
    side          VARCHAR(10) NOT NULL,       -- SUBSCRIBE | REDEEM | SWITCH
    amount_minor  BIGINT,                     -- for value-based subscriptions
    units         DECIMAL(28,8),              -- for unit-based redemptions
    nav_date      DATE NOT NULL,              -- WHICH pricing point applies
    status        VARCHAR(20) NOT NULL,       -- PENDING → PRICED → SETTLED | REJECTED
    placed_at     TIMESTAMPTZ NOT NULL
);
CREATE TABLE nav_prices (
    fund_id VARCHAR(24), nav_date DATE, nav DECIMAL(18,6),
    source VARCHAR(24), received_at TIMESTAMPTZ, PRIMARY KEY (fund_id, nav_date)
);
CREATE TABLE holdings (
    investor_id BIGINT, fund_id VARCHAR(24),
    units DECIMAL(28,8) NOT NULL, avg_cost_minor BIGINT,
    PRIMARY KEY (investor_id, fund_id)
);
```

**Units use `DECIMAL(28,8)`, not float** — fractional units are real (a £100 subscription buys 43.28571429 units) and rounding must be exact and reproducible, because the fund administrator will independently compute the same number and the two must agree.

### Step 4 — Failure handling and the batch

| Failure | Handling |
|---|---|
| **NAV file late or missing** | Orders stay `PENDING` for that `nav_date`; **never guess a price**. Alert, and the business decides whether to roll to the next pricing point |
| NAV file arrives twice | Idempotent load keyed on `(fund_id, nav_date)`; a *changed* NAV for an already-priced date is an incident requiring a re-pricing run, not a silent overwrite |
| Batch fails mid-run | Every step is idempotent and checkpointed (Step Functions with a durable execution history); resume, never restart from scratch |
| Cut-off boundary dispute | Server-side timestamp from a trusted clock (NTP-disciplined), recorded on the order, immutable — this ends up in complaints and regulatory queries |
| Fund admin rejects an aggregated order | Unwind at investor level using the recorded allocation, and release reserved cash |

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Batch NAV pipeline | Real-time pricing | The domain is forward-priced; real-time would be fiction |
| Durable orchestration (Step Functions/Temporal) | Cron + scripts | The run must be restartable, observable and auditable — a failed nightly run is a regulatory event |
| Double-entry cash *and* unit ledger | Balance columns | Reconciliation with the transfer agent requires an explainable trail |
| Reserve cash at order time | Check at settlement | Prevents a subscription failing after pricing, which would need an unwind with the administrator |

### Wrap-Up

**Out of scope:** corporate actions (mergers, share-class conversions) in depth, tax-lot accounting, and adviser/discretionary trading on behalf of a client — each is a materially different workflow layered on top of this one.

**Monitoring that matters:** NAV-file lateness against the expected publication time (this is the single most important alert in the whole platform); count of orders still `PENDING` past the cut-off; unit-allocation rounding discrepancies versus the transfer agent's own calculation; cash-ledger-to-unit-ledger reconciliation breaks.

**The natural next question:** "how do you handle a fund merger or a share-class conversion?" — both are bulk corporate-action events that must reprice existing holdings atomically across every affected investor in one batch run, which is why the batch orchestrator (not the online order path) is where that logic belongs.

---

## Q4. Design a high-volume transaction-processing system.

### Step 1 (Understand the Problem & Establish Design Scope) — Scope and the number that decides everything

**Q:** What is "high volume", and what is the durability requirement?
**A:** 500 million transactions/day, every one durable and exactly-once, ordered per account.

```text
500,000,000 / 86,400  ≈  5,800 TPS average
peak 4×               ≈  23,000 TPS
each txn ~500 B       →  250 GB/day  →  ~90 TB/year
```

**Implication:** at 23,000 TPS *this is genuinely a throughput problem* — the opposite conclusion from Q2, and drawing that contrast explicitly is a strong move in an interview. A single relational primary will not absorb 23,000 durable writes/s. **Partitioning, batching and asynchronous processing are now mandatory rather than optional.**

### Step 2 (Propose High-Level Design & Get Buy-In) — Architecture: accept fast, process asynchronously

```text
Clients ─▶ ALB ─▶ Ingest API (stateless, autoscaled)
                      │  validate + assign txn_id + partition key
                      ▼
                 Kafka  transactions.raw   (120 partitions, RF=3, acks=all)
                      │
        ┌─────────────┼──────────────┬────────────────┐
        ▼             ▼              ▼                ▼
   Processor      Fraud/Risk     Ledger Writer    Analytics sink
   (validate,     (async score)  (batched COPY)   (S3 / lake)
    enrich)                            │
                                       ▼
                              Partitioned Postgres / Aurora
```

**The core decision: the synchronous request does the minimum.** Validate, assign an id, append to the log, return `202 Accepted` with a status URL. Everything else — enrichment, risk, ledger posting, notification — happens downstream. This decouples the client-facing SLA from the slowest dependency and lets the write path scale as a stateless tier.

**Partitioning strategy is the crux.** Order matters *per account*, not globally (Module 08), so partition by `account_id`:

```text
partition = hash(account_id) % 120
```

This gives per-account ordering with 120-way parallelism. **120 partitions ⇒ at most 120 useful consumers per group** — adding a 121st leaves it idle, which is the classic Kafka sizing question. Watch for **hot partitions**: one institutional account can dominate a partition, so monitor per-partition lag and use a composite key (`account_id:sub_account`) for known whales.

### Step 3 — Making the write path keep up

| Technique | Effect |
|---|---|
| **Batch inserts** — accumulate 1,000 rows or 50 ms, then one `COPY`/`SqlBulkCopy` | 10–50× throughput vs row-at-a-time; this is usually the single biggest win |
| **Time-partitioned tables** (daily/monthly) | Inserts hit a small hot partition; retention becomes `DROP PARTITION` (Module 17 Q16) |
| **Minimal indexes on the write table** | Every index is a write amplification; push query needs to the read model |
| **Separate read model** (CQRS — Q16) | Reporting never touches the ingest path |
| **Integer minor units, fixed-width columns** | Smaller rows, better cache density |
| **`acks=all` + `min.insync.replicas=2`** | Durability without waiting for all replicas |

### Step 4 — Exactly-once at 23,000 TPS

Full Kafka transactions (`read-process-write` with `isolation.level=read_committed`) give exactly-once *within* Kafka, at a throughput cost. The cheaper and more common production answer: **at-least-once delivery plus an idempotent consumer** —

```sql
INSERT INTO processed_transactions (txn_id, processed_at) VALUES (:id, now())
ON CONFLICT (txn_id) DO NOTHING;      -- 0 rows = already processed, skip
```

— performed **in the same database transaction as the business write**, so the dedupe record and the effect commit or roll back together. That is exactly-once *business* processing without Kafka transactions.

### Step 5 — Failure handling

| Failure | Handling |
|---|---|
| Consumer lag grows | Scale consumers to the partition count; beyond that, increase partitions (only ever upward — it rehashes keys) |
| Poison message | Retry with backoff → after N attempts publish to DLQ with full context → alert; never block the partition |
| Database write slower than ingest | Kafka **is** the buffer — that is the point of accepting into a log first. Alert on lag, not on request failures |
| Broker/AZ loss | RF=3 across 3 AZs, `min.insync.replicas=2` — tolerates one AZ |
| Backpressure | Bounded queues and `max.poll.records`; never unbounded in-memory buffering (Module 11) |

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| `202 Accepted` + async | Synchronous end-to-end | Client SLA decoupled from the slowest downstream; but the client must handle "accepted, not yet final" |
| Kafka as the durable buffer | SQS | Need replay, ordering and multiple independent consumers of the same stream |
| Idempotent consumer | Kafka transactions | Simpler, faster, and works across the Kafka/DB boundary that Kafka transactions do not span |
| Partition by account | Round-robin | Ordering guarantee is per-account; round-robin would destroy it |

### Wrap-Up

**Out of scope:** cross-partition transactions and joins, event-schema evolution at this volume, and GDPR erasure of a record that has been fanned out across 120 partitions and several downstream consumers — each deserves its own design pass.

**Monitoring that matters:** consumer lag **per partition**, not just the aggregate (an aggregate can look healthy while one hot partition is badly behind); DLQ depth and age; batch-insert latency at the database; duplicate-detection hit rate on the idempotency table (a sustained rise usually means a retry storm upstream, not normal behaviour).

**The natural next question:** "how do you rebalance a hot partition without downtime?" — the honest answer is you generally can't rebalance in place; you widen the partition count (which only ever goes up and rehashes keys) or split the offending key with a composite partition key, and both require a planned migration window, not a live fix.

---

## Q5. Design a 10K+ RPS API.

### Step 1 (Understand the Problem & Establish Design Scope) — Establish what 10,000 RPS actually demands

**Ask first: read-heavy or write-heavy, and what is the latency SLO?** Assume 10,000 RPS with a 95:5 read:write split and a p99 < 100 ms target.

**Little's Law is the tool to reach for, and naming it earns credit:**

```text
concurrency = arrival rate × service time
10,000 RPS × 50 ms  = 500 requests in flight
10,000 RPS × 200 ms = 2,000 in flight     ← latency drives capacity, not just load
```

**The insight:** if you reduce service time from 200 ms to 50 ms you need **a quarter of the concurrency** — and therefore a quarter of the threads, connections and instances. **Optimising latency is capacity planning.** Doubling instance count is the expensive way to get what a fixed N+1 query gives for free.

### Step 2 (Propose High-Level Design & Get Buy-In) — Layered architecture, cheapest layer first

```text
                 ┌── CDN (CloudFront) ────────────┐  absorbs 60-80% of reads
Client ──▶ Route53 ──▶ ALB ──▶ API pods (HPA) ──▶ Redis ──▶ Aurora (writer)
                                    │                        └─▶ Aurora (readers ×N)
                                    └──▶ Kafka (async work)
```

| Layer | Handles | Rule |
|---|---|---|
| **CDN / edge cache** | Static and cacheable GETs | The cheapest request is the one that never reaches you |
| **Client cache** | `Cache-Control`, `ETag`, conditional GETs | A 304 costs almost nothing |
| **Distributed cache (Redis)** | Hot entities, computed views | Target 90%+ hit rate on hot keys |
| **In-process cache** | Reference data, config | Nanoseconds, but per-instance and hard to invalidate |
| **Read replicas** | Query-side load | Accept replica lag explicitly, route read-your-writes to the primary |
| **Primary DB** | Writes only | Protect it — it is the one thing you cannot horizontally scale trivially |

**The capacity arithmetic to show:** if the CDN serves 70% and Redis serves 90% of the rest, the database sees `10,000 × 0.30 × 0.10 = 300 RPS`. **That is the whole design in one line** — layered caching turns an impossible database load into a trivial one.

### Step 3 — Make each instance efficient

- **Async all the way down.** Every I/O path `async`/`await`, no `.Result`, no `.Wait()` — one blocked thread-pool thread under load causes starvation and a latency cliff (Module 03).
- **Connection pooling sized deliberately.** `Max Pool Size` × instance count must stay under the database's connection limit; use RDS Proxy/PgBouncer when instance count is elastic.
- **Kill N+1 queries.** The single most common cause of a "we need more servers" conversation (Module 11).
- **Cheap serialisation.** `System.Text.Json` with source generators; consider MessagePack/protobuf for internal hops.
- **Reduce allocations** on the hot path — `Span<T>`, `ArrayPool<T>`, pooled buffers — to keep Gen 0 collections and GC pauses out of p99.
- **HTTP/2 or gRPC internally**, keep-alive everywhere; TLS handshakes at 10,000 RPS are not free.

### Step 4 — Protect the system from itself

| Control | Purpose |
|---|---|
| **Rate limiting** per client/tenant | One bad caller must not consume the budget (Module 16 Q17) |
| **Circuit breakers** on every dependency | Fail fast rather than piling up threads on a dead dependency |
| **Bulkheads** | A slow dependency degrades one feature, not the whole API |
| **Timeouts everywhere**, shorter than the caller's | Without one, a hung dependency exhausts the pool |
| **Load shedding** | Above a threshold, reject cheaply with 429/503 rather than degrading everyone |
| **HPA on the right signal** | Scale on RPS or queue depth, not CPU, for I/O-bound APIs |

### Step 5 — Prove it

Load test at 1.5× peak; measure **p95/p99, not the average** (Module 11 — the average hides the tail that users actually experience); soak test for hours to expose leaks and pool exhaustion; and test the **failure** modes — what happens at 3× peak, and what happens when Redis dies (does the cache miss stampede onto the database? See cache stampede, Q24).

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Cache-first architecture | Scale the database | Orders of magnitude cheaper; cost is staleness and invalidation complexity |
| Read replicas | Single primary | Cheap read scale; cost is replica lag and read-your-writes handling |
| Async writes via Kafka | Synchronous writes | Bounded p99 for clients; cost is eventual consistency the client must understand |
| Horizontal stateless scaling | Bigger instances | Elastic, fault-tolerant; requires no session affinity and externalised state |

### Wrap-Up

**Out of scope:** a multi-region deployment of this same API (that is Q12), streaming/WebSocket variants, and a GraphQL or BFF layer in front of it.

**Monitoring that matters:** p50/p95/**p99** latency broken down per route, not just overall (Module 11 — the average hides exactly the tail users experience); cache hit ratio at each layer (CDN, Redis); connection-pool saturation; error-budget burn rate against the stated SLO, which is what turns "latency crept up" into an actionable page before it becomes an incident.

**The natural next question:** "what changes at 100K RPS?" — the honest answer is that caching stops being sufficient on its own and the database write path itself needs sharding, which is a materially different design (closer to Q4's shape than Q5's).

---

## Q6. Design an event-driven microservices architecture.

### Step 1 (Understand the Problem & Establish Design Scope) — Decide whether EDA is warranted at all

**Start by saying when *not* to use it** — it is the strongest opening because most candidates only argue for it. EDA is the wrong choice when the workflow needs an immediate synchronous answer, when the team is small enough that a modular monolith would ship faster, when strong consistency is required across the operation, or when the organisation lacks the observability maturity to debug an asynchronous system. **Eventual consistency is a business decision, not a technical preference** — someone must accept that the customer may see a stale balance for two seconds.

Where it *is* warranted: many consumers of the same fact, wildly different scaling profiles per consumer, long-running workflows, and a requirement that the producer not know or care who reacts.

### Step 2 (Propose High-Level Design & Get Buy-In) — Event taxonomy, which is where most designs go wrong

| Type | Semantics | Example |
|---|---|---|
| **Command** | "Do this" — one recipient, may be rejected | `CapturePayment` |
| **Event** | "This happened" — immutable fact, past tense, n recipients | `PaymentCaptured` |
| **Query** | "Tell me" — no state change | `GetBalance` |

And within events, the choice that determines coupling:

| Style | Payload | Trade-off |
|---|---|---|
| **Event notification** | Just ids: `{ "payment_id": "p-77213" }` | Small; but every consumer calls back for detail → a hidden synchronous dependency and a load amplifier |
| **Event-carried state transfer** | The full relevant state | Consumers are autonomous; larger events, and stale copies to manage |
| **Event sourcing** | The event stream *is* the state | Full history and replay; a much larger commitment (Q15) |

**Default to event-carried state transfer for cross-service events.** The point of EDA is autonomy, and a notification-only event that forces every consumer to call back synchronously has reintroduced exactly the coupling and the availability dependency you were trying to remove.

### Step 3 — Reference architecture

```text
   Service A ──(local txn)──▶ its DB
        │                       │
        │                    outbox table
        │                       │
        │              ┌────────▼────────┐
        └──────────────│ Outbox Relay /  │──▶ Kafka topic (per aggregate)
                       │      CDC        │       │
                       └─────────────────┘       ├──▶ Service B (own DB)
                                                 ├──▶ Service C (own DB)
                                                 └──▶ Read model / analytics
```

**The outbox is non-negotiable** (Module 14). Writing to your database and publishing to Kafka are two systems with no shared transaction; doing both directly is a **dual write**, and it *will* eventually produce a state change with no event or an event with no state change. The outbox makes the event part of the same local transaction, with a relay (or Debezium CDC) publishing afterwards. This yields at-least-once delivery — which is why every consumer must be idempotent.

**Topic design:** one topic per aggregate type (`payments.events`, `orders.events`), keyed by aggregate id so all events for one entity land in one partition and stay ordered. Not one topic per consumer, and not one giant `events` topic.

### Step 4 — The consumer contract

Every consumer must be:

1. **Idempotent** — a `processed_events(event_id)` table with a unique constraint, checked inside the same transaction as the effect.
2. **Order-tolerant** — partitions guarantee per-key order, but consumers may process a *later* version first after a retry. Carry a version/sequence number and ignore anything not newer.
3. **Failure-classified** — transient (retry with backoff) vs permanent (straight to DLQ). Retrying a validation error 500 times blocks the partition and achieves nothing.
4. **Schema-tolerant** — additive-only changes, consumers ignore unknown fields, breaking changes get a new topic version. A **Schema Registry** with `BACKWARD` compatibility enforces this at publish time rather than discovering it in production.

### Step 5 — Observability, the thing that makes or breaks EDA in production

Asynchronous systems are hard to debug precisely because there is no stack trace spanning the flow. Non-negotiables:

- **Correlation id propagated in every event header**, from the originating request through every hop (Module 05).
- **Distributed tracing** with context propagated across the broker (W3C `traceparent` in Kafka headers), so one trace shows producer → broker → consumer.
- **Consumer lag as a first-class SLO**, alerted per group per partition — lag is the health signal of an event-driven system.
- **DLQ depth alarms** with a defined replay procedure, not an unmonitored queue nobody has looked at in a year.

### Trade-offs

| Gain | Cost |
|---|---|
| Loose coupling, independent deploys | No end-to-end transaction; sagas and compensation |
| Independent scaling per consumer | Eventual consistency the business must accept |
| Easy to add consumers with no producer change | Much harder debugging; observability becomes mandatory, not optional |
| Natural buffering and resilience | Duplicate handling, ordering and schema evolution are now *your* problems |

### Wrap-Up

**Out of scope:** the schema-registry governance process (who approves a breaking change), event replay/backfill tooling for a new consumer joining late, and cross-region event mirroring.

**Monitoring that matters:** consumer lag per group; DLQ depth and, critically, DLQ *age* (a growing backlog nobody is triaging is a silent failure); schema-compatibility rejection rate at the registry; outbox-relay lag, which is the leading indicator that the whole pipeline is falling behind the source of truth.

**The natural next question:** "a projection is found to be wrong three weeks after the fact — how do you fix it?" — replay from the retained event log from `global_seq = 0` (or from the last known-good snapshot) rather than patching the projection table directly, which is exactly the payoff event-driven design is bought for (Q15).

---

## Q7. Design a scalable notification system.

### Step 1 (Understand the Problem & Establish Design Scope) — Scope

**Functional:** send email, SMS, push and in-app messages; support transactional (a payment receipt) and bulk (a marketing campaign); templating and localisation; user preferences and opt-out; delivery tracking; scheduling.
**Non-functional:** transactional notifications delivered within seconds; **no duplicate sends** (a duplicate "you have been charged £500" is a support incident and, for marketing, a regulatory one); vendor failures must not lose messages; 10 million notifications/day with campaign spikes of 5 million in ten minutes.

```text
10,000,000/day ÷ 86,400          ≈  116/s baseline
campaign burst 5M in 600 s       ≈  8,300/s
```

**Implication:** the burst is 70× the baseline. **The architecture must absorb a spike that the downstream vendors will not accept** — SendGrid, Twilio and APNs all rate-limit. So the design centre is a queue with controlled drain, not a bigger fleet.

### Step 2 (Propose High-Level Design & Get Buy-In) — Architecture

```text
Producers (any service) ──▶ Notification API ──▶ Kafka notifications.requested
                                                        │
                                              ┌─────────▼──────────┐
                                              │  Notification Svc  │
                                              │  · preferences     │
                                              │  · dedupe          │
                                              │  · template render │
                                              │  · rate/throttle   │
                                              └─────────┬──────────┘
                              ┌────────────────┬────────┴────────┬───────────────┐
                              ▼                ▼                 ▼               ▼
                        Email worker      SMS worker       Push worker     In-app writer
                         (SES/SendGrid)    (Twilio/SNS)     (APNs/FCM)      (DB + WS)
                              └────────────────┴─────────────────┴──────▶ Delivery events
```

**Separate transactional and bulk into different topics and different consumer groups.** If they share a queue, a five-million-message campaign puts a customer's password-reset email behind it. Priority is expressed structurally — separate topics with separate workers and separate rate budgets — not by a priority field everyone ignores.

### Step 3 — Data model and the dedupe key

```sql
CREATE TABLE notifications (
    notification_id UUID PRIMARY KEY,
    dedupe_key      VARCHAR(128) NOT NULL,      -- e.g. "payment-captured:p-77213:email"
    user_id         BIGINT NOT NULL,
    channel         VARCHAR(10) NOT NULL,
    template_id     VARCHAR(64) NOT NULL,
    status          VARCHAR(16) NOT NULL,       -- QUEUED→SENT→DELIVERED|BOUNCED|FAILED
    provider        VARCHAR(24),
    provider_msg_id VARCHAR(128),
    attempts        SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_dedupe UNIQUE (dedupe_key)
);
CREATE TABLE preferences (
    user_id BIGINT, category VARCHAR(32), channel VARCHAR(10),
    enabled BOOLEAN, quiet_hours_tz VARCHAR(48),
    PRIMARY KEY (user_id, category, channel)
);
```

**The `dedupe_key` unique constraint is the whole duplicate-suppression mechanism**, and it must be **derived from the business event, not generated per attempt**: `"{event_type}:{aggregate_id}:{channel}"`. Kafka is at-least-once, so the same request *will* arrive twice; a database-level unique constraint is the only reliable place to settle it.

### Step 4 — Provider integration and failure handling

| Failure | Handling |
|---|---|
| **Provider rate limit (429)** | Token-bucket throttle per provider, sized below their published limit; respect `Retry-After` |
| **Provider down** | Circuit breaker → **failover to a secondary provider** (SES ⇄ SendGrid). This is why the template and the send are separated from the provider adapter |
| **Transient 5xx** | Exponential backoff with jitter, capped attempts, then DLQ |
| **Hard bounce / invalid number** | **Non-retryable** — mark the address invalid, suppress future sends, do not retry. Repeatedly mailing a bouncing address damages sender reputation and gets you blocklisted |
| **Delivery status arrives via webhook** | Idempotent handler keyed on `provider_msg_id`; update status asynchronously |
| **Campaign floods the workers** | Bulk consumer group has a fixed concurrency and a token bucket — it drains at a controlled rate by design |

**Preferences and compliance are enforced at send time, centrally**, never by the calling service: opt-out state, category preferences, quiet hours in the user's timezone, and per-category frequency caps. Centralising this is the reason the notification service exists at all — the alternative is every service reimplementing consent checks, and getting one of them wrong.

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Async queue with controlled drain | Synchronous send from the caller | Absorbs 70× bursts; vendor latency and outages never touch the caller |
| Separate transactional/bulk pipelines | One queue with priorities | Structural isolation actually works under load; priority fields do not |
| Multi-provider with failover | Single provider | Email/SMS vendors do have outages; the abstraction cost is small |
| DB unique constraint for dedupe | Redis set | Durable, survives restarts, and is transactional with the state change |

### Wrap-Up

**Out of scope:** an in-app notification centre with read receipts, A/B testing of templates, and deliverability/sender-reputation management in depth (bounce handling was covered; IP warm-up and domain reputation were not).

**Monitoring that matters:** send-success rate per channel; bounce and spam-complaint rate (a rising complaint rate is a sender-reputation emergency, not a background metric); queue depth during a campaign, watched against the token-bucket drain rate; time-to-delivery p95 for transactional sends specifically, isolated from bulk.

**The natural next question:** "how do you throttle a runaway campaign that's about to exceed a provider's daily quota?" — the bulk consumer group's fixed concurrency and per-provider token bucket already cap the drain rate; the addition needed is a campaign-level budget the orchestrator checks before queuing the next batch, so the campaign pauses gracefully rather than the provider rate-limiting you mid-send.

---

## Q8. Design an audit logging system.

### Step 1 (Understand the Problem & Establish Design Scope) — Scope and the property that defines it

**Non-functional first, because they are the design:** **immutable** (append-only, tamper-evident), **complete** (a lost record is a control failure, not a dropped metric), **retained for years** (SOX ~7, PCI ≥1 year with 3 months hot), **queryable** ("who accessed customer 914's record in March 2024?" answered in seconds), and **isolated** (an attacker who owns production must not be able to erase the evidence).

```text
5,000 audit events/s peak × 1 KB ≈ 5 MB/s ≈ 430 GB/day ≈ 150 TB over 7 years
```

**Implication:** volume forces tiering — you cannot keep 150 TB hot, and you cannot keep it in the transactional database.

### Step 2 (Propose High-Level Design & Get Buy-In) — Architecture

```text
Services ──write audit row in the SAME DB txn as the business change
              │
           outbox ──▶ Kafka audit.events (RF=3, retention 7d)
                          │
              ┌───────────┼────────────────┬──────────────┐
              ▼           ▼                ▼              ▼
        Hot store    Cold archive     SIEM/alerting   Hash-chain
        (OpenSearch   (S3 + Object     (Splunk /       verifier
         90 days)      Lock, Glacier)   GuardDuty)
              └────────────── separate AWS account ──────────────┘
```

**Two decisions carry the whole design:**

1. **Write the audit record in the same transaction as the business change**, then ship it asynchronously via the outbox. Fire-and-forget over the network loses records precisely when the system is under stress — which is exactly when the audit trail matters. This guarantees you can never have an approved payment with no record of who approved it.
2. **Put the audit store in a different AWS account** with a write-only cross-account role. The production account can append; it cannot delete or alter. This is what makes the log survive a full production compromise (Module 17 Q14).

### Step 3 — The record, and making it tamper-evident

```jsonc
{
  "event_id": "0f4c…", "occurred_at": "2026-09-08T14:22:31.472Z",
  "actor": { "sub": "u-914", "type": "user", "on_behalf_of": null },
  "source": { "ip": "…", "user_agent": "…", "session_id": "…" },
  "action": "payment.approved",
  "resource": { "type": "payment", "id": "p-77213" },
  "outcome": "success",
  "before": { "status": "PENDING_APPROVAL" }, "after": { "status": "APPROVED" },
  "correlation_id": "trace-abc123",
  "reason": "four-eyes approval, ticket CHG-4471",
  "prev_hash": "9a1f…", "hash": "c73b…"        ← hash chain
}
```

**Tamper-evidence:** each record's `hash = SHA-256(canonical(record) || prev_hash)`. Altering or deleting any record breaks the chain from that point onward, and a periodic verifier job detects it. Publish a **daily digest** (the chain head) to write-once storage — **S3 Object Lock in compliance mode**, which cannot be shortened or removed even by the account root — so the chain cannot be silently rebuilt. **SQL Server Ledger** implements this natively if the audit store is SQL Server. Add **CloudTrail log file validation** for the AWS-API layer.

**Record failures and denials, not just successes** — an authorization denial is exactly what an investigation searches for.

### Step 4 — Storage tiering and query

| Tier | Store | Window | Purpose |
|---|---|---|---|
| **Hot** | OpenSearch / partitioned Postgres | 90 days | Investigations, support, dashboards |
| **Warm** | S3 Parquet, partitioned `dt=/actor=` | 1 year | Athena queries, compliance reporting |
| **Cold** | S3 Glacier Deep Archive + Object Lock | 7 years | Legal hold; hours-long retrieval is acceptable |

Partition by date and index by `actor`, `resource.id` and `action` — those three cover essentially every real query. Store as **Parquet** in the archive so Athena scans columns rather than whole objects, which is the difference between a £5 query and a £500 one.

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Same-transaction write + outbox | Async fire-and-forget | Completeness is a hard requirement; dropped records are control failures |
| Separate account + Object Lock | Same-account S3 bucket | Survives full production compromise — the only version that is genuinely a control |
| Hash chain | Trust the storage layer | Provides *proof* of integrity, which is what an auditor asks for |
| Tiered S3/Glacier | Everything in OpenSearch | 150 TB hot is unaffordable and unnecessary |

### Wrap-Up

**Out of scope:** cross-region replication of the audit store itself, the legal-hold workflow for litigation, and the search UI/RBAC model for the investigators who query it.

**Monitoring that matters:** ingestion lag from the outbox to the durable store (should be seconds, alerted in minutes); hash-chain verification failures, which page immediately rather than waiting for the next scheduled check; any DLQ activity on the audit-event path, since a dropped audit record is a control failure, not a retryable error; storage cost per tier, since this is usually the largest line item on a mature platform.

**The natural next question:** "how do you actually prove to an auditor the log wasn't tampered with?" — walk the hash chain from the daily digest published to S3 Object Lock backward to the record in question; any break in the chain is detectable, and the Object Lock digest is what an attacker with full production access still cannot alter.

---

## Q9. Design a distributed payment workflow.

This is Q2's flow viewed as a **coordination problem** — the interviewer wants the saga, the compensations and the failure semantics.

### Step 1 (Understand the Problem & Establish Design Scope) — Why there is no distributed transaction

Payment spans Order, Payment, Ledger, Wallet and an external PSP. **2PC is not available**: the external PSP will not enrol in your transaction coordinator, and a blocking two-phase lock across services with network partitions is an availability disaster. So the workflow is a **saga** — a sequence of local transactions, each with a compensating action (Module 14).

### Step 2 (Propose High-Level Design & Get Buy-In) — The workflow, with compensations

```text
Step                          Compensation                    Retryable?
1. Reserve customer funds     Release reservation             yes
2. Risk/fraud check           (none — read-only)              yes, short timeout
3. Authorise with PSP         Void authorisation              yes, idempotent key
4. Post ledger entries        Post reversing entries          yes
5. Capture with PSP           Refund                          yes, idempotent key
6. Notify + close order       (none — notification only)      yes
```

**Compensation ≠ rollback, and this is the point to make explicitly.** A rollback erases history; a compensation is a **new forward transaction that offsets a previous one**. Step 5's compensation is a *refund*, not an un-capture: the customer's statement shows both the charge and the refund, because that is what actually happened and what the regulator requires. Some steps are **not compensatable at all** — an email cannot be unsent — so **order the saga to put irreversible steps last**.

### Step 3 — Orchestration, and why

```csharp
public async Task Handle(PaymentRequested e, CancellationToken ct)
{
    var saga = await _store.LoadOrCreate(e.PaymentId, ct);   // durable state
    switch (saga.Step)
    {
        case Step.Start:
            await _wallet.Reserve(saga.PaymentId, saga.Amount, ct);
            await saga.Advance(Step.FundsReserved, ct);      // persisted before next step
            goto case Step.FundsReserved;
        case Step.FundsReserved:
            var risk = await _risk.Score(saga, ct);
            if (risk.Decline) { await Compensate(saga, ct); return; }
            await saga.Advance(Step.RiskCleared, ct);
            break;
        // …
    }
}
```

**Every step transition is persisted before the next step runs**, so a crash resumes rather than restarts. That single property is what makes the saga durable, and it is the difference between an orchestrator and a `try/catch`.

**Orchestration over choreography** for payments: there is a definable business process with an owner; support must be able to answer "where is payment 77213?" from one place; compensations must run in reverse order deterministically; and regulators expect the workflow to be documentable. Choreography suits broadcast-style reactions (Q6), not money movement with an audit obligation.

### Step 4 — Failure semantics

| Failure | Behaviour |
|---|---|
| Step times out, outcome unknown | **Do not assume failure.** Query the PSP by our idempotency key; if still ambiguous, park in `PENDING_VERIFICATION` and let reconciliation resolve it (Q2) |
| Orchestrator crashes mid-saga | Durable state + idempotent steps → resume from the last persisted step |
| Compensation itself fails | Retry with backoff; after N attempts raise a **manual intervention** case. Compensations must be idempotent too |
| Saga exceeds its deadline | Per-step and overall timeouts; expiry triggers compensation, not indefinite hanging |
| Duplicate `PaymentRequested` | Saga keyed on `payment_id`; `LoadOrCreate` makes the second a no-op |

**The state to expose:** every saga instance's current step, age and last error, on a dashboard. A saga you cannot see is a saga you cannot operate — and stuck sagas are a normal, expected operational category, so build the intervention queue on day one rather than after the first incident.

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Saga | 2PC | 2PC cannot include external providers and blocks under partition |
| Orchestration | Choreography | Visibility, deterministic compensation order, auditability |
| Durable orchestrator (Temporal/Step Functions/custom + DB) | In-memory state machine | Must survive crashes; the whole value is durability |
| Irreversible steps last | Any order | Minimises the number of failures that need manual repair |

### Wrap-Up

**Out of scope:** a multi-leg FX payment workflow, partial refunds initiated mid-saga, and how a saga's step sequence is versioned safely across a deployment (an in-flight saga instance and a newly deployed orchestrator must agree on what "step 3" means).

**Monitoring that matters:** per-step duration histograms (a step that used to take 200ms and now takes 4s is the earliest signal something downstream degraded); compensation-failure rate, which should be near-zero and paged immediately when it isn't; count and age of sagas sitting in the manual-intervention queue.

**The natural next question:** "what happens if a compensation itself fails permanently?" — it lands in the manual-intervention queue with full context (which step, which compensation, how many attempts) rather than retrying forever, because at that point the correct action is a human decision, not another automated retry.

---

## Q10. Design a secure fintech platform.

The synthesis of Modules 15–17 applied to a whole platform. Answer it as **concentric layers around classified data**, and lead with the decision that removes risk rather than manages it.

### Step 1 (Understand the Problem & Establish Design Scope) — Start by reducing what you must protect

**The highest-leverage security decisions are architectural, and they all take the form "do not hold it":**

| Decision | Effect |
|---|---|
| **Tokenise PANs / use a hosted payment page** | Removes cardholder data from your estate; cuts PCI DSS scope from SAQ D to a fraction |
| **Federate authentication to an IdP** (Entra ID, Okta, Cognito) | You hold no passwords, so you cannot leak them |
| **Store `over_18`, not date of birth** | Every field removed deletes a column of controls, audit obligations and breach exposure |
| **Reference the system of record instead of copying** | Fewer copies means fewer places erasure and retention must reach |

State this first. A candidate who opens with "WAF and TLS" is describing hygiene; a candidate who opens with scope reduction is describing architecture.

### Step 2 (Propose High-Level Design & Get Buy-In) — The layers, each with a distinct threat model

```text
            Internet
               │  WAF (AWS WAF: managed rules, rate-based, Bot Control)
               ▼
          CloudFront ──▶ API Gateway / ALB      [ public subnet only ]
               │            · OAuth2/OIDC token validation
               │            · rate limiting, request validation
               ▼
        ┌──────────────── private subnets ────────────────┐
        │  EKS: service mesh with mTLS between all pods   │
        │  · per-service IAM role (IRSA), no static creds │
        │  · NetworkPolicy: default-deny east-west        │
        └───────────┬─────────────────────────────────────┘
                    │  VPC endpoints (no internet egress for data)
        ┌───────────▼─────────────────────────────────────┐
        │  Aurora (private) · KMS CMKs · Secrets Manager  │
        │  RLS, least-privilege DB users, TDE, audit      │
        └─────────────────────────────────────────────────┘
        Audit + backup vaults live in SEPARATE AWS accounts
```

| Layer | Controls | Defeats |
|---|---|---|
| **Edge** | WAF managed rules, rate limiting, DDoS (Shield), TLS 1.2+ termination | Automated attack traffic, volumetric abuse |
| **Identity** | OAuth2 authorization code + PKCE for users, client credentials for services, short-lived tokens, MFA, no standing production access | Credential theft, session hijack |
| **Application** | Object-level authorization (BOLA), parameterised queries, explicit response DTOs, idempotency, input validation | Injection, BOLA/BOPLA, mass assignment, replay |
| **Service-to-service** | **mTLS** via mesh, per-service identity, JWT with audience checks, default-deny NetworkPolicy | Lateral movement after one compromise |
| **Data** | TLS in transit, KMS at rest, Always Encrypted / app-side envelope for crown jewels, RLS, DDM | Stolen media, malicious DBA, over-broad app credential |
| **Secrets** | Secrets Manager / IRSA / managed identity, automatic rotation, nothing in git or env vars | Credential leakage |
| **Detection** | CloudTrail, GuardDuty, database auditing, immutable audit log in a separate account, Macie | Undetected breach; inability to scope an incident |

### Step 3 — Zero Trust as the organising principle

**Never trust the network.** Every request — including one from another pod in the same cluster — is authenticated, authorised and encrypted. Concretely:

- **mTLS everywhere east-west** (Istio/Linkerd/App Mesh), so a compromised pod cannot simply call the payments service because it happens to be inside the VPC.
- **Per-workload identity** (SPIFFE-style, or IRSA), not shared service accounts.
- **Authorisation at every hop**, not only at the gateway. The gateway authenticates the *user*; each service still checks whether *this* principal may touch *this object*.
- **Default-deny network policy**, with explicit allows — the inverse of the traditional flat VPC.

### Step 4 — Compliance made structural, not procedural

| Requirement | Structural implementation |
|---|---|
| **Segregation of duties** | Decrypt permission on the KMS key is a separate IAM grant a DBA does not hold |
| **Four-eyes approval** on high-value payments | Enforced in the payment state machine, recorded in the audit log with both identities |
| **Immutable audit trail** | Separate account, hash chain, S3 Object Lock compliance mode (Q8) |
| **Change management** | GitOps: every production change is a reviewed, signed, traceable commit; no console changes (deny via SCP) |
| **Data residency** | Region-pinned storage; SCPs denying resource creation outside approved regions |
| **Right to erasure vs 7-year retention** | Crypto-shredding per data subject; regulated records retained under documented legal basis (Module 17 Q17) |

### Step 5 — Assume breach

Design so that **any single compromised component does not yield the whole dataset**:

- The application credential does not defeat **RLS**.
- A DBA does not defeat **Always Encrypted**.
- Production account compromise does not defeat the **backup vault lock** or the **audit account**.
- One compromised pod does not reach the payments service (**NetworkPolicy + mTLS + per-service authz**).

**Then rehearse it.** Tabletop the incident: how do you revoke a service's access in 60 seconds (delete the IAM role / revoke the mesh identity)? How do you scope which records were read (audit log query)? How do you rotate every secret (Secrets Manager rotation, forced)? A control you have never exercised is an assumption.

### Trade-offs

| Control | Cost | When it is worth it |
|---|---|---|
| Application-level encryption | Breaks range queries, sorting, indexing | Crown-jewel columns only, after query-pattern analysis |
| Per-subject data keys | A KMS call per read (cacheable) | When selective erasure or per-tenant revocation is required |
| Service mesh mTLS | Latency, operational complexity, sidecar cost | Multi-team clusters handling regulated data |
| Immutable backups (compliance mode) | Storage cost; cannot undo a mistake for the locked period | Ransomware resilience — effectively always, in a bank |

### Wrap-Up

**Out of scope:** the SOC 2/PCI DSS audit-evidence pipeline in depth, third-party vendor risk assessment, and physical HSM/key-ceremony operations.

**Monitoring that matters:** GuardDuty findings by severity; authorization-denial rate by service (a spike is either a misconfiguration or an attack, and both deserve immediate attention); secret-rotation failure count; anomalous KMS-decrypt volume against a rolling baseline, which is usually the earliest sign of a compromised credential being used to exfiltrate data.

**The natural next question:** "walk me through your incident response for a suspected breach in the first hour" — revoke the suspected identity's IAM role or mesh certificate immediately (this is why short-lived, per-service identity matters, Q20), scope the blast radius from the audit log's query-by-actor capability (Q8), and only then begin root-cause analysis — containment before investigation.

**Close honestly:** applying maximum protection uniformly gets rejected on cost or quietly bypassed in delivery. You buy each control for the data classes that justify it, and you write that justification down.

---

## Q11. Design a highly available AWS application.

### Step 1 (Understand the Problem & Establish Design Scope) — Define the availability target, because it decides the spend

```text
99.9%   =  43.8 min/month downtime   — single region, multi-AZ, standard
99.95%  =  21.9 min/month            — multi-AZ + fast failover + no single-AZ deps
99.99%  =   4.4 min/month            — multi-AZ + automated failover everywhere
99.999% =  26   s/month              — multi-region active-active; very expensive
```

**Ask what the business actually needs before designing.** Each additional nine roughly multiplies cost and operational complexity. And note the compounding trap: **serial dependencies multiply** — a request touching five components each at 99.9% is `0.999^5 = 99.5%`, which is 3.6 hours/month. **Availability is a property of the whole path, not of any one component**, which is why removing dependencies from the critical path is often cheaper than making each one more reliable.

### Step 2 (Propose High-Level Design & Get Buy-In) — Multi-AZ architecture

```text
Route 53 (health-checked)
    │
CloudFront ──▶ WAF
    │
   ALB  (spans AZ-a, AZ-b, AZ-c — the ALB itself is multi-AZ by design)
    │
 ┌──┴───────────┬───────────────┐
 ▼              ▼               ▼
AZ-a           AZ-b            AZ-c
EKS nodes      EKS nodes       EKS nodes      ← ASG min 3, spread across AZs
 │              │               │
 └──────────────┴───────────────┘
                │
        Aurora cluster: writer (AZ-a) + readers (AZ-b, AZ-c)
        ElastiCache Redis: multi-AZ with automatic failover
        S3 / DynamoDB: regionally redundant by default
```

| Component | HA mechanism | Failover time |
|---|---|---|
| **ALB** | Multi-AZ by design, health checks per target | Seconds |
| **EKS / ASG** | Nodes across ≥3 AZs, pod anti-affinity, PDBs | Seconds (pod reschedule) |
| **Aurora** | Automatic failover to a reader | **~30 s**, typically under 60 |
| **RDS Multi-AZ (non-Aurora)** | Synchronous standby, DNS switch | 60–120 s |
| **ElastiCache** | Multi-AZ with auto-failover | Under a minute |
| **NAT Gateway** | **One per AZ** — a single NAT is an AZ-level SPOF *and* a cross-AZ data charge | n/a |
| **S3, DynamoDB, SQS** | Multi-AZ inherently | Transparent |

**The most common real-world mistakes**, worth naming because interviewers look for them: a **single NAT Gateway** shared by all AZs; an **ASG with `min=2` across 3 AZs** (an AZ loss can leave one instance serving everything); **stateful sessions** pinned to an instance; and a **single-AZ dependency** buried in the stack (a self-managed Redis, an EC2-hosted licence server) that silently caps the whole application's availability.

### Step 3 — Application-level requirements

HA infrastructure only works if the application cooperates:

- **Stateless services** — session state in Redis or in the token, never in process memory, so any instance can serve any request.
- **Graceful shutdown** — handle `SIGTERM`, stop accepting new work, drain in-flight requests, deregister from the ALB before exiting. Without this, every deploy and every scale-in drops requests.
- **Health checks that mean something** — separate **liveness** (am I deadlocked? restart me) from **readiness** (can I serve? take me out of rotation), and make readiness check *actual* dependencies. A readiness probe that returns 200 unconditionally is decorative.
- **Retries with exponential backoff and jitter**, plus **circuit breakers** — so a brief failover does not cascade into a retry storm that keeps the recovered dependency down.
- **Idempotency** — because retries during failover *will* duplicate requests.
- **Connection resilience** — Aurora failover changes which endpoint is the writer; the driver and pool must reconnect rather than hold dead connections.

### Step 4 — Degrade rather than fail

Rank features by criticality and shed the non-essential under stress: if the recommendations service is down, render the page without recommendations; if the risk service times out, fall back to a conservative rules-based decision rather than declining every payment. **Graceful degradation converts a total outage into a reduced-functionality window** — which is the difference between a P1 and a P3.

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Multi-AZ single region | Multi-region | Covers the overwhelming majority of real failures at a fraction of the cost and complexity |
| Aurora over RDS Multi-AZ | RDS | Faster failover, readers usable for query load, storage replicated across 3 AZs |
| NAT per AZ | Single NAT | Removes an AZ-level SPOF and avoids cross-AZ data charges |
| Stateless + external session | Sticky sessions | Sticky sessions defeat the point of load balancing and break on instance loss |

### Wrap-Up

**Out of scope:** multi-region deployment (that is Q12), a full cost breakdown of the multi-AZ design, and a chaos-engineering practice for continuously validating it.

**Monitoring that matters:** error rate **per AZ**, not just aggregate — an aggregate can look fine while one AZ is silently degraded and the load balancer just isn't routing much traffic there; actual observed failover time during a real Aurora promotion, not the documented figure; PodDisruptionBudget violations during node drains; connection-pool reconnect rate immediately after a failover, which is where an application that doesn't handle a changed writer endpoint shows itself.

**The natural next question:** "how do you actually test that this fails over correctly?" — a scheduled game day that kills an AZ's worth of capacity for real and measures the actual RTO against the target, because a failover mechanism nobody has triggered on purpose is a hypothesis, not a capability (Q13).

---

## Q12. Design a multi-region application.

### Step 1 (Understand the Problem & Establish Design Scope) — Establish *why*, because the answer changes the design

| Driver | Implication |
|---|---|
| **Disaster recovery** | Passive or warm standby is sufficient (Q13) |
| **Latency for global users** | Read-local, write-home is often enough |
| **Data residency / regulation** | **Partitioned by region — data must not cross the boundary at all** |
| **Regional availability SLA** | Active-active, with all its consistency cost |

**These are different systems.** Answering "multi-region" without asking which driver applies is the mistake.

### Step 2 (Propose High-Level Design & Get Buy-In) — The three topologies

| Topology | Description | RTO/RPO | Cost | Hard part |
|---|---|---|---|---|
| **Active-passive** | Standby region, data replicated, traffic fails over | Minutes / seconds | ~1.3× | Keeping the passive region actually working |
| **Active-active, partitioned** | Each region owns a disjoint set of users/tenants | Near zero for unaffected users | ~2× | Routing users to their home region; cross-region access |
| **Active-active, shared** | Both regions serve all writes for the same data | Near zero | 2×+ | **Write conflicts** — the genuinely hard problem |

**Active-active with a shared write set is the one to be careful about.** Two regions accepting writes to the same record means conflicts, and conflict resolution is a business decision, not a database setting. Last-writer-wins silently discards data — acceptable for a user's display name, catastrophic for a balance.

**The pattern that avoids the problem, and the one to propose first: partition by data ownership.** Give every account a **home region**; all writes for that account go there; other regions hold read-only replicas.

```text
account_id 0…499  → eu-west-1 (home)     writes: eu-west-1 only
account_id 500…999 → us-east-1 (home)    writes: us-east-1 only
both regions hold read replicas of both partitions
```

This gives regional write availability, no conflicts, and local reads — at the cost of cross-region latency for the minority of users whose home region is remote.

### Step 3 — Architecture

```text
                  Route 53  (latency-based / geolocation routing + health checks)
                       │
        ┌──────────────┴────────────────┐
        ▼                               ▼
    eu-west-1                       us-east-1
  ┌────────────────┐              ┌────────────────┐
  │ ALB → EKS      │              │ ALB → EKS      │
  │ Aurora Global  │◀── <1 s ────▶│ Aurora Global  │
  │   (writer)     │   replication │  (reader/      │
  │                │               │   promotable)  │
  │ DynamoDB Global Tables (active-active, LWW)     │
  │ S3 CRR ────────────────────────────────────────▶│
  │ MSK / Kafka MirrorMaker2 ──────────────────────▶│
  └────────────────┘              └────────────────┘
```

| Service | Cross-region mechanism | Note |
|---|---|---|
| **Aurora Global Database** | Physical replication, typically **< 1 s lag**; managed failover ~1 min | One writer; secondary is promotable |
| **DynamoDB Global Tables** | Multi-active, **last-writer-wins** | Great for session/profile data; wrong for balances |
| **S3** | Cross-Region Replication (asynchronous) | Replication is eventual; new objects only unless backfilled |
| **KMS** | **Multi-Region keys** | Essential — a snapshot encrypted with a single-region key is undecryptable in DR |
| **Kafka** | MirrorMaker 2 / MSK Replicator | Offsets differ per cluster; consumers must translate |
| **Route 53** | Latency/geo routing + health checks | DNS TTL bounds how fast clients actually move |

### Step 4 — The consistency reality

**CAP applies at the moment of partition** (Module 05): with regions on opposite sides of an ocean, a partition *will* happen, and you must choose in advance.

- **Balance updates and payments: choose consistency.** Route writes to the home region; if it is unreachable, **reject or queue** rather than accept a write you cannot reconcile. Taking a payment twice because two regions both accepted it is worse than a brief outage.
- **Profiles, preferences, sessions, catalogues: choose availability.** Eventual consistency with LWW is fine.

**Read-your-own-writes across regions** is the subtle failure users notice: a user writes in `eu-west-1`, then a latency-routed read hits `us-east-1` before replication and their change has "disappeared". Fix by pinning a user's session to their home region for a short window after a write, or by version-token reads.

**Also plan the unglamorous parts:** cross-region data transfer is billed and material at volume; deployments must be region-aware and staggered (never both regions at once); and **the DR region must be exercised**, because an untested standby is a hypothesis.

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Home-region partitioning | Shared active-active | Eliminates write conflicts entirely instead of resolving them |
| Aurora Global Database | Self-managed replication | Sub-second lag, managed promotion, far less to get wrong |
| Consistency for money, availability for everything else | One uniform policy | The correct choice differs by data class, and saying so is the answer |
| Route 53 health-check failover | Manual DNS change | Automation bounds RTO; manual steps do not survive a 3 a.m. incident |

### Wrap-Up

**Out of scope:** a detailed multi-region cost model, data-residency/regulatory partitioning where the law (not just latency) dictates the region boundary, and a genuinely shared-write active-active design for a specific hard case like inventory.

**Monitoring that matters:** cross-region replication lag, alerted *before* it becomes an RPO problem rather than discovered during an incident; read-after-write anomaly rate (users hitting a region that hasn't caught up yet); per-region error-rate divergence, which is often the first sign one region's dependency graph is unhealthy while the other looks fine.

**The natural next question:** "a user's home region just went down — what do they experience?" — Route 53 health-check failover routes them to the surviving region, which holds a read replica of their partition; **writes for that user are unavailable until either the partition's primary is promoted in the surviving region or the home region recovers** — say that limitation out loud rather than implying seamless failover for a partitioned design.

---

## Q13. Design a disaster recovery architecture.

### Step 1 (Understand the Problem & Establish Design Scope) — RPO and RTO drive every decision

- **RPO (Recovery Point Objective)** — how much *data* you can afford to lose, measured backwards from the failure. RPO = 15 min means losing up to 15 minutes of transactions.
- **RTO (Recovery Time Objective)** — how long until service is restored.

**These are business decisions with a price tag, and the architect's job is to make the price visible.** Present the four AWS strategies as a menu:

| Strategy | RPO | RTO | Cost | What runs in DR |
|---|---|---|---|---|
| **Backup & Restore** | Hours | **Hours–days** | £ | Nothing; restore from backups |
| **Pilot Light** | Minutes | **Tens of minutes** | ££ | Data replicated, core infra off/minimal |
| **Warm Standby** | Seconds–minutes | **Minutes** | £££ | Scaled-down but *running* full stack |
| **Multi-site Active-Active** | ~Zero | **Near zero** | ££££ | Full production in both regions |

**For a payments platform, RPO is usually near-zero and non-negotiable** — you cannot lose committed money movements — which forces synchronous or sub-second replication and rules out backup-and-restore for the transactional core. It is entirely legitimate to apply **different strategies to different components**: warm standby for the payment path, backup-and-restore for the reporting warehouse. Say so; uniform DR is usually over-spend.

### Step 2 (Propose High-Level Design & Get Buy-In) — Warm standby, concretely

```text
Primary: eu-west-1                      DR: eu-central-1
──────────────────────                  ──────────────────────
EKS: 20 nodes                           EKS: 2 nodes (same manifests, GitOps)
Aurora writer + 2 readers  ──global──▶  Aurora secondary (read-only, promotable)
S3 buckets                 ──CRR────▶   S3 replicas
Secrets Manager            ──replica─▶  Replicated secrets
KMS multi-Region key       ═══════════  Same key ID usable in both regions
Route 53 health check ─────────────────▶ failover routing policy
```

**Failover runbook, automated as far as possible:**

```text
1. Confirm the primary is genuinely down     (avoid flapping on a transient blip)
2. Promote the Aurora global secondary       (~1 min)
3. Scale the DR EKS cluster to production size (Karpenter/ASG)
4. Verify health checks green
5. Shift Route 53 to DR
6. Verify: synthetic transaction end-to-end   ← the step people omit
7. Announce; freeze deploys; plan failback
```

**Failback is harder than failover and is where DR plans fail.** The DR region has accepted writes the old primary never saw, so returning is a controlled data-reconciliation exercise, not a DNS flip. Write the failback plan at the same time as the failover plan.

### Step 3 — The details that decide whether DR actually works

| Trap | Mitigation |
|---|---|
| **KMS key is single-region** | Use **multi-Region keys**, or the replicated snapshot is undecryptable — the single most common DR failure |
| Secrets not replicated | Enable Secrets Manager replication; verify the DR app can read them |
| DR infrastructure drifted | **GitOps/IaC only** — DR is deployed from the same manifests, continuously |
| Quotas too low in DR | Request limit increases *in advance*; you cannot scale to 20 nodes on a 4-node quota |
| DNS TTL too long | Low TTL (60 s) on failover records |
| AMIs / container images not in DR | Replicate ECR repositories cross-region |
| Untested plan | **Scheduled game days** — fail over for real, at least annually |

### Step 4 — Prove it

**A DR plan that has never been executed is a document, not a capability.** Run scheduled failover exercises, measure actual RTO against the target, verify RPO by comparing the last replicated transaction to the last committed one, and treat every gap found as a defect. Include the scenario where the primary account itself is compromised — which is why backups live in a separate account with **Vault Lock in compliance mode** (Module 17 Q18) and why ransomware, not hardware failure, is the modern design case.

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Warm standby for the transaction core | Pilot light | RTO in minutes rather than tens of minutes, for a modest always-on cost |
| Mixed strategies per component | One uniform strategy | Matches spend to business impact instead of over-protecting reporting |
| Automated failover | Manual runbook | Bounds RTO and removes 3 a.m. human error; requires solid health checks to avoid flapping |
| Multi-Region KMS keys | Per-region keys | Without it, DR data is unreadable — a correctness issue, not an optimisation |

### Wrap-Up

**Out of scope:** DR for the CI/CD pipeline and secrets-management plane that would be needed to actually execute the runbook, a full game-day process write-up, and a detailed cost comparison of the four strategies for this specific workload's numbers.

**Monitoring that matters:** replication lag measured continuously against the stated RPO target, not assumed from the vendor's headline figure; days since the last successful DR drill (a number that should never be allowed to grow past the drill cadence); quota headroom in the DR region, checked *before* it's needed.

**The natural next question:** "your primary region is degraded and so is your DR region — what now?" — this is the scenario that exposes whether backups are genuinely independent of both regions (a third, cold copy with Vault Lock in compliance mode) or whether the "DR" region was quietly a second dependency on the same blast radius.

---

## Q14. Design a real-time transaction system.

### Step 1 (Understand the Problem & Establish Design Scope) — Define "real-time", because it is ambiguous

| Meaning | Latency budget | Example |
|---|---|---|
| **Hard real-time** | Microseconds, deterministic | Exchange matching engine, HFT |
| **Soft real-time** | Milliseconds, p99 bounded | Card authorisation, fraud scoring |
| **Near real-time** | Seconds | Streaming analytics, dashboards |

Take **card authorisation**: a hard external SLA of **500 ms end-to-end** imposed by the scheme, above which the transaction times out and is declined at the terminal. That number is the design constraint.

```text
Budget breakdown (p99, 500 ms total):
  network in/out              80 ms
  auth service processing     40 ms
  risk/fraud scoring          80 ms
  balance check + reserve     60 ms
  issuer/scheme hop          200 ms
  headroom                    40 ms
```

**Deriving the budget per hop, before designing anything, is the move that separates a strong answer.** Every component now has a number it must meet, and any design that cannot fit is rejected immediately rather than discovered in load testing.

### Step 2 (Propose High-Level Design & Get Buy-In) — Architecture optimised for tail latency

```text
Terminal ─▶ Edge (NLB, TLS, keep-alive) ─▶ Auth Service ─┬─▶ Redis: balance/limits (1-2 ms)
                                                          ├─▶ Risk model (in-process ONNX, 5-20 ms)
                                                          └─▶ Card/account cache (in-process)
                                             │
                                             ├─ decision returned  ◀── ≤ 500 ms
                                             │
                                             └─▶ Kafka: authorisation.events
                                                        └─▶ Ledger, analytics, notifications (async)
```

**The central principle: the synchronous path does only what is needed to decide.** Everything that does not change the decision — ledger posting, notifications, analytics, enrichment — happens **after** the response, off the critical path. This is the single largest latency win available and it is an architectural choice, not a tuning exercise.

**Techniques for the hot path:**

| Technique | Effect |
|---|---|
| **In-memory state** for balances and limits (Redis, or a partitioned in-process store) | Removes the database from the decision path |
| **Model inference in-process** (ONNX Runtime) rather than an HTTP call | Eliminates a network hop and its tail |
| **Pre-computed features** — risk features updated by the streaming pipeline, read as a lookup | Turns a computation into a fetch |
| **Connection pre-warming, keep-alive, HTTP/2** | Removes handshake cost from p99 |
| **Timeout + fallback on every dependency** | A slow dependency must degrade the decision, never block it |
| **Avoid GC pauses**: reduce allocations, pool buffers, consider Server GC tuning | GC pauses land squarely in p99 (Module 11) |

### Step 3 — Correctness under latency pressure

Balance checking must be atomic even at 5 ms. A Redis Lua script (single-threaded, atomic) does the check-and-reserve in one round trip:

```lua
-- KEYS[1] = balance key, ARGV[1] = amount
local bal = tonumber(redis.call('GET', KEYS[1]))
if bal == nil or bal < tonumber(ARGV[1]) then return 0 end
redis.call('DECRBY', KEYS[1], ARGV[1])
return 1
```

Redis is the **authorisation-time** view; the **durable ledger** is written asynchronously from the Kafka event, and the two are reconciled continuously. That is a deliberate trade: sub-millisecond decisions in exchange for a reconciliation process that must actually exist. If Redis is lost, you rebuild from the ledger — so the rebuild path is part of the design, not an afterthought.

### Step 4 — Failure handling on a hard deadline

| Failure | Behaviour |
|---|---|
| Risk service exceeds its 80 ms budget | **Time out and apply a conservative rules-based decision** — never let it block; a late decline is still a decline |
| Redis unavailable | Circuit-break to the database with a tightened limit policy, and alert; or fail closed for high-value transactions |
| Kafka unavailable | The decision has already been returned; buffer events locally and replay — **the customer path stays up** |
| Overload | **Load shed** deliberately: reject a controlled fraction fast rather than letting everyone breach 500 ms |

**Fail-open vs fail-closed is a business decision** and must be asked, not assumed: for a £5 contactless payment, approving on a degraded check may be cheaper than declining; for a £50,000 transfer it certainly is not. Encode it as a value-banded policy.

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| In-memory balances with async ledger | Synchronous DB write in the auth path | Meets the 500 ms budget; cost is a mandatory reconciliation process |
| In-process model inference | Model-serving microservice | Removes a hop and its tail; cost is deployment coupling of the model to the service |
| Async everything non-decisional | Do it all synchronously | Protects the hard SLA; cost is eventual consistency downstream |
| Load shedding | Queue everything | Under overload, a fast rejection beats a universal timeout |

### Wrap-Up

**Out of scope:** card-network-specific protocol details (ISO 8583 message formats), the 3-D Secure step-up challenge flow, and offline/store-and-forward terminal behaviour when connectivity is lost.

**Monitoring that matters:** p99 against the 500ms budget, broken down **per hop** (network/auth/risk/balance/scheme) so a budget breach is immediately attributable rather than requiring a live investigation; decline rate by reason code, watched for an unexplained shift; risk-model latency specifically, since it carries the largest budget share; rate of falling back to the conservative rules-based decision, which should be rare and is itself a leading indicator of risk-service degradation.

**The natural next question:** "your risk service is healthy but running at 150ms instead of 80ms — walk me through exactly what happens" — the 80ms budget is exceeded, the timeout fires, and the transaction proceeds on the conservative fallback policy rather than waiting; the customer sees a normal-speed decision, and the risk-service degradation is visible only in the fallback-rate metric, not in customer-facing latency.

---

## Q15. Design an event-sourced banking / account system.

### Step 1 (Understand the Problem & Establish Design Scope) — Why event sourcing genuinely fits banking

Most systems do not need event sourcing. Banking is one of the few where it is the **natural** model rather than an imposition: an account balance *is* the fold of its transaction history, regulators require the full history anyway, corrections must be visible rather than silent, and "what was this balance on 3 March at 14:00?" is a routine question. **The domain already thinks in immutable events; event sourcing simply stops fighting that.**

### Step 2 (Propose High-Level Design & Get Buy-In) — The model

```text
Aggregate: Account (the consistency boundary)
Events (immutable, past tense, append-only):
  AccountOpened      { accountId, customerId, currency, openedAt }
  FundsDeposited     { accountId, amountMinor, reference, valueDate }
  FundsWithdrawn     { accountId, amountMinor, reference, valueDate }
  TransferSent       { accountId, toAccount, amountMinor, transferId }
  TransferReceived   { accountId, fromAccount, amountMinor, transferId }
  AccountFrozen      { accountId, reason, byUser }
  InterestAccrued    { accountId, amountMinor, period }
  AccountClosed      { accountId, closedAt }
```

```sql
CREATE TABLE event_store (
    stream_id     VARCHAR(64) NOT NULL,      -- "account-8812"
    version       BIGINT      NOT NULL,      -- 1,2,3… per stream
    event_type    VARCHAR(64) NOT NULL,
    event_data    JSONB       NOT NULL,
    metadata      JSONB       NOT NULL,      -- correlation id, causation id, actor
    occurred_at   TIMESTAMPTZ NOT NULL,
    global_seq    BIGSERIAL,
    PRIMARY KEY (stream_id, version)          -- ← this IS the concurrency control
);
```

**The `PRIMARY KEY (stream_id, version)` is the entire optimistic-concurrency mechanism.** Two concurrent commands both loaded version 47 and both try to append version 48; one succeeds, the other gets a duplicate-key violation and retries against the new state. No locks, no lost updates. Point this out explicitly — it is the single most important line in the schema.

### Step 3 — Command handling

```csharp
public async Task Handle(WithdrawFunds cmd, CancellationToken ct)
{
    var events  = await _store.ReadStream($"account-{cmd.AccountId}", ct);
    var account = Account.Rehydrate(events);          // fold events → current state

    if (account.IsFrozen)               throw new AccountFrozenException();
    if (account.Balance < cmd.Amount)   throw new InsufficientFundsException();

    var e = new FundsWithdrawn(cmd.AccountId, cmd.Amount, cmd.Reference, DateTime.UtcNow);

    // expectedVersion = account.Version → append fails if anyone else wrote meanwhile
    await _store.Append($"account-{cmd.AccountId}", account.Version, e, ct);
}
```

**Business rules are validated against rehydrated state, then a single event is appended.** The event is a *fact*, so it is never rejected after the fact — validation happens before, never after.

**Snapshots** solve the rehydration cost: an account with 500,000 events should not replay them all. Persist a snapshot every N events (say 500) and rehydrate as `snapshot + subsequent events`. **A snapshot is an optimisation and must always be discardable** — if you can no longer rebuild state from events alone, the design has been broken.

### Step 4 — Projections and CQRS

Reads never touch the event store:

| Projection | Purpose |
|---|---|
| `account_balances` | Current balance per account — the common read |
| `transaction_history` | Statement view, paged by date |
| `daily_positions` | Regulatory reporting snapshots |
| `suspicious_activity` | AML/fraud feed |

Projections are **rebuildable by definition**: drop the table, replay from `global_seq = 0`, and it is exactly correct. That property is what makes a projection bug a non-event — fix the code, rebuild, done — and it is worth stating because it is the practical payoff of event sourcing.

**Projection failure handling:** track the last processed `global_seq` per projection; on failure, retry from that position (projections must be idempotent). Alert on **projection lag** the way you alert on consumer lag — a stale balance projection is a visible customer-facing defect even though the event store is perfectly correct.

### Step 5 — The hard parts, answered honestly

| Problem | Answer |
|---|---|
| **Events are wrong / a bug wrote bad data** | **Never edit history.** Append a **correcting event** (`TransactionReversed`, `BalanceAdjusted`) with a reason and an actor. This is exactly how a real ledger works, and regulators require it |
| **Schema evolution** | Additive changes only; **upcasters** transform old event versions into the current shape at read time; never rewrite stored events |
| **GDPR erasure vs immutable events** | **Crypto-shredding** — encrypt personal fields with a per-subject key and delete the key (Module 17 Q17). The event structure survives; the personal data does not |
| **Query complexity** | That is what projections are for; never query the event store for reporting |
| **Eventual consistency of reads** | Read-your-own-writes: after a command, either return the projected state directly or have the client read the aggregate until its version catches up |

### Trade-offs

| Gain | Cost |
|---|---|
| Complete, immutable audit trail for free | Significantly higher conceptual and operational complexity |
| Temporal queries ("balance as at…") are natural | Eventual consistency between write and read models |
| Projections are disposable and rebuildable | Storage grows forever; needs snapshots and archiving |
| Corrections are explicit and visible | Schema evolution and upcasting are permanent obligations |

### Wrap-Up

**Out of scope:** a transfer that touches two account aggregates atomically, event-schema versioning at real scale, and the operational detail of per-subject key management for crypto-shredding under GDPR (Module 17 named the mechanism; the key-rotation runbook for millions of subjects is its own design).

**Monitoring that matters:** projection lag per read model, which is the customer-visible symptom of any problem in this design; snapshot-rebuild duration, which bounds how bad rehydration gets if snapshots are ever disabled or corrupted; event-store write latency; upcaster error rate when reading old-format events.

**The natural next question:** "how do you implement a transfer that touches two account aggregates atomically?" — you don't get one ACID transaction across two aggregates in an event-sourced model; the honest answer is a saga (Q9) with the first account's debit event as step one and the second account's credit event as step two, with a compensating credit if the second write fails.

---

## Q16. Design a CQRS system.

### Step 1 (Understand the Problem & Establish Design Scope) — Be clear what CQRS is, and is not

**CQRS = separating the model that writes from the model that reads.** It does **not** require event sourcing, separate databases, or eventual consistency — those are options along a spectrum:

| Level | Write side | Read side | Consistency |
|---|---|---|---|
| **1. Separate methods/models** | Command handlers | Query handlers with DTOs | Same DB, immediate |
| **2. Separate read schema** | Normalised tables | Denormalised views/materialised views | Same DB, immediate or near |
| **3. Separate read store** | Postgres | OpenSearch / Redis / read replica | **Eventual** |
| **4. Full CQRS + event sourcing** | Event store | Projections | Eventual |

**Start at level 1 and move right only when a specific pressure demands it.** Jumping straight to level 4 for a CRUD application is the classic over-engineering failure, and interviewers ask "when would you *not* use CQRS?" precisely to test this. The answer: simple CRUD, symmetric read/write load, small teams, or anywhere the extra moving parts cost more than the asymmetry they solve.

**The pressures that justify it:** a 20:1 or 100:1 read:write ratio; reads and writes needing genuinely different shapes (normalised for integrity, denormalised for display); different scaling profiles; complex domain logic on writes but simple projections on reads; or a search/reporting requirement the transactional schema serves badly.

### Step 2 (Propose High-Level Design & Get Buy-In) — Architecture at level 3

```text
                    ┌── Commands ──▶ Command Handler ──▶ Write DB (normalised, ACID)
 API ──────────────▶│                       │
                    │                    outbox
                    │                       ▼
                    │                 Kafka domain events
                    │                       │
                    │              Projection Workers (idempotent)
                    │                       ▼
                    └── Queries ───▶ Read Store (denormalised: OpenSearch / Redis / replica)
```

```csharp
// Command: returns nothing meaningful beyond an identifier and acceptance
public record PlaceOrder(Guid OrderId, Guid CustomerId, IReadOnlyList<Line> Lines)
    : IRequest;

// Query: returns a shape built for the screen, not for the domain
public record GetOrderSummary(Guid OrderId) : IRequest<OrderSummaryDto>;

public record OrderSummaryDto(                 // one row, no joins at read time
    Guid OrderId, string CustomerName, string Status,
    decimal Total, string CurrencySymbol,
    IReadOnlyList<LineDto> Lines, string TrackingUrl);
```

**The read model is shaped by the screen, not by the domain.** `OrderSummaryDto` contains the customer's name because the order page shows it — even though the write model would require a join to produce it. Denormalising at projection time is the entire performance argument.

### Step 3 — Handling eventual consistency, which is the real work

The read model lags the write model by milliseconds to seconds. Users notice when they act and then immediately look:

| Technique | How it works | When |
|---|---|---|
| **Return the result from the command** | Command returns the new state directly; the UI renders it without re-querying | Simplest and most effective; use by default |
| **Read-your-writes routing** | After a write, route that user's reads to the primary for N seconds | When the UI must re-query |
| **Version token** | Command returns a version; the client polls the read model until it reaches it | Precise, needs client cooperation |
| **UI acknowledgement** | "Your order is being processed" instead of pretending it is instant | Honest, and often the best product answer |

**The mistake to avoid:** writing then immediately querying the read model and treating an empty result as an error. That is a design bug, not a race to be retried away.

### Step 4 — Projection mechanics

- **Idempotent** — projections consume at-least-once; use upserts keyed on the aggregate id, and track the last processed offset/sequence.
- **Rebuildable** — a projection you cannot rebuild from the source is a second source of truth, which defeats the purpose.
- **Independently deployable and versioned** — build v2 alongside v1, replay, switch reads over, retire v1. This is how you change a read schema with no downtime.
- **Monitored for lag** — projection lag is a customer-visible metric.

### Trade-offs

| Gain | Cost |
|---|---|
| Reads and writes scale and evolve independently | Two models to keep in step; more moving parts |
| Read shapes tuned per screen; no join-heavy queries | Eventual consistency the UI must handle honestly |
| Write model stays clean and domain-focused | Projection code, replay tooling and lag monitoring to own |
| Read store technology chosen per need (search, cache, graph) | Operational surface grows with each store |

### Wrap-Up

**Out of scope:** full event sourcing as the write model (that's Q15's harder commitment), multi-region read replicas of the projection store, and a GraphQL federation layer over the read side.

**Monitoring that matters:** projection lag as a genuine customer-facing SLO, not an internal metric — "the order view is at most 2 seconds behind" is a number the business can reason about; read-model rebuild duration; command-to-query staleness p99, sampled from real user sessions rather than synthetic checks.

**The natural next question:** "a user says the number is wrong immediately after they changed it — walk me through debugging that" — check whether the response returned the new state directly (in which case the UI has a stale-render bug, not a data bug) or re-queried the read model before the projection caught up (in which case it's the classic eventual-consistency UX gap from Q24, and the fix is one of that question's techniques, not a database investigation).

---

## Q17. Design a Kafka-based transaction platform.

### Step 1 (Understand the Problem & Establish Design Scope) — Requirements and topology sizing

**Requirements:** ingest transaction events from many producers; guarantee per-account ordering; support multiple independent consumers (ledger, fraud, analytics, notifications); replayable for 7 days; no message loss; 20,000 events/s peak.

```text
20,000 events/s × 1 KB           = 20 MB/s ingress
× replication factor 3           = 60 MB/s of broker write traffic
7-day retention: 20 MB/s × 604,800 s × 3 ≈ 36 TB across the cluster
```

**Sizing the cluster from that:** brokers sized so no single broker holds more than ~70% disk; a starting point of 6 brokers across 3 AZs, RF=3, `min.insync.replicas=2` — which tolerates one broker (or one AZ) loss while still accepting writes.

### Step 2 (Propose High-Level Design & Get Buy-In) — Topic and partition design

| Topic | Partitions | Key | Retention |
|---|---|---|---|
| `transactions.raw` | 120 | `account_id` | 7 days |
| `transactions.enriched` | 120 | `account_id` | 7 days |
| `transactions.dlq` | 12 | original key | 30 days |
| `accounts.snapshot` | 24 | `account_id` | **compacted** (keeps the latest per key forever) |

**Partition count is the decision to justify.** It sets the maximum consumer parallelism per group — 120 partitions means at most 120 useful consumers, and the 121st sits idle. It can only ever be **increased**, and increasing it **rehashes keys**, so events for an account can land in a different partition and briefly break ordering. Therefore size for future growth from the start: target throughput ÷ per-partition throughput, with headroom.

**Keying by `account_id`** gives per-account ordering, which is what the domain actually needs — global ordering would mean one partition and no parallelism, which is the trade-off to state explicitly. Watch for **hot partitions** from institutional accounts; a composite key or a dedicated topic for whales is the mitigation.

### Step 3 — Producer and consumer configuration, with reasons

```properties
# Producer — durability first
acks=all                      # leader + all in-sync replicas
enable.idempotence=true       # dedupes producer retries; implies acks=all, max.in.flight<=5
max.in.flight.requests.per.connection=5
retries=2147483647
delivery.timeout.ms=120000
compression.type=lz4          # 3-5x reduction; CPU is cheaper than network and disk
linger.ms=10                  # small batching window: large throughput gain, tiny latency cost
batch.size=65536
```

```properties
# Consumer — at-least-once with manual commit
enable.auto.commit=false      # commit AFTER processing, never before
isolation.level=read_committed
max.poll.records=500
max.poll.interval.ms=300000   # must exceed worst-case batch processing time
session.timeout.ms=45000
```

**`enable.auto.commit=false` is the correctness-critical setting.** With auto-commit, an offset can be committed for a record that was fetched but not yet processed; a crash then loses it silently. Commit after the business effect is durable.

**`enable.idempotence=true`** prevents duplicates caused by *producer retries* — worth naming precisely, because it is often mistaken for end-to-end exactly-once, which it is not.

### Step 4 — The dual-write problem and exactly-once

**Kafka transactions do not span Kafka and your database.** A transactional producer can atomically write to Kafka topics and commit consumer offsets (`read-process-write`), but it cannot include a Postgres insert. So:

- **Producing side:** use the **outbox** — write the business row and the outbox row in one database transaction, and let a relay or Debezium publish (Module 14). This is the only correct way to guarantee "state changed ⇔ event published".
- **Consuming side:** **at-least-once + idempotent consumer** — insert `processed_events(event_id)` with a unique constraint **in the same transaction as the effect**. Cheaper and more robust than Kafka transactions, and it works across the broker/database boundary.

### Step 5 — Operations

| Concern | Approach |
|---|---|
| **Consumer lag** | The primary health metric. Alert per group per partition; rising lag on one partition means a hot key or a stuck consumer |
| **Rebalancing storms** | Use **cooperative-sticky** assignment; raise `max.poll.interval.ms` to cover worst-case processing; keep `session.timeout.ms` sensible. Most rebalance pain is slow processing, not membership churn |
| **Poison messages** | Bounded retries with backoff, then DLQ with full context and a documented replay procedure — never block the partition |
| **Schema evolution** | Schema Registry with `BACKWARD` compatibility; additive changes only; new topic version for breaking changes |
| **Security** | TLS in transit, SASL/IAM authentication, ACLs per topic per principal, encryption at rest via KMS (Module 08, Module 17) |
| **Replay** | Reset a consumer group to a timestamp or offset; this is why 7-day retention exists and it must be a rehearsed procedure |

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Kafka | SQS/RabbitMQ | Need replay, retention and multiple independent consumers of the same stream |
| Key by account | Round-robin | Ordering per account is a domain requirement |
| Idempotent consumers | Kafka transactions | Simpler, faster, and spans the DB boundary that Kafka transactions cannot |
| 120 partitions up front | Start at 12 and grow | Increasing partitions rehashes keys and disturbs ordering — size ahead |

### Wrap-Up

**Out of scope:** full Kafka-transaction exactly-once semantics as an alternative to the idempotent-consumer pattern, tiered storage economics at multi-year retention, and cross-cluster disaster recovery for the Kafka layer itself.

**Monitoring that matters:** consumer lag **per partition**, since an aggregate figure hides a single hot or stuck partition; under-replicated-partition count, which is the earliest warning of a broker or AZ problem; rebalance frequency (frequent rebalances usually mean slow processing, not membership churn); DLQ growth rate with an alert on age, not just depth.

**The natural next question:** "how would you migrate this topic from 120 to 240 partitions with zero downtime?" — increasing partitions is safe to do live, but it rehashes keys going forward, so existing per-account ordering briefly spans two partition assignments during the transition; the mitigation is to schedule the change for a low-traffic window and accept a short ordering-guarantee gap rather than promise a seamless one.

---

## Q18. Design an API Gateway architecture.

### Step 1 (Understand the Problem & Establish Design Scope) — What belongs in the gateway, and what emphatically does not

This is the whole question, and the second column is where candidates fail.

| **Belongs in the gateway** | **Does NOT belong** |
|---|---|
| TLS termination | **Business logic of any kind** |
| Authentication — token signature, expiry, issuer, audience | **Fine-grained authorization** (which *object* may this user touch — that is the service's job) |
| Coarse authorization — is this scope allowed on this route | **Data transformation coupled to a domain** |
| Rate limiting and quotas per client/tenant | **Orchestration across many services** (that is a BFF or a saga) |
| Request/response validation against the schema | **Database access** |
| Routing, load balancing, canary/weighted routing | **Stateful session storage** |
| Observability: correlation ids, access logs, metrics, tracing headers | **Service-specific caching policy** the service should own |
| Protocol translation at the edge (REST ⇄ gRPC) | |
| CORS, security headers, WAF integration | |

**The failure mode to name explicitly: the gateway becoming a distributed monolith.** Once teams start adding routing conditionals, response mangling and "just this one" business rule, the gateway becomes a shared component every team must change and nobody may break — the exact coupling microservices were meant to remove. **The rule: the gateway handles cross-cutting concerns that are identical for every service; anything service-specific belongs in the service.**

### Step 2 (Propose High-Level Design & Get Buy-In) — Architecture, including the BFF layer

```text
   Web        Mobile        Partner API
    │           │               │
    ▼           ▼               ▼
 ┌────────┐ ┌────────┐    ┌──────────┐
 │Web BFF │ │Mobile  │    │ Public   │   ← BFFs: per-client aggregation & shaping
 │        │ │ BFF    │    │ API GW   │
 └───┬────┘ └───┬────┘    └────┬─────┘
     └──────────┴──────────────┘
                │   (edge gateway: authN, rate limit, routing, observability)
     ┌──────────┼───────────┬──────────────┐
     ▼          ▼           ▼              ▼
  Orders    Payments    Customers      Inventory      ← mTLS, service mesh east-west
```

**Why a BFF rather than one gateway for everyone:** a mobile client on a poor connection wants one aggregated call with a small payload; a web client wants richer data; a partner wants a stable, versioned contract that never changes when the internal model does. One gateway serving all three either forces a lowest-common-denominator API or accumulates client-specific logic — which is the coupling problem again. **A BFF is owned by the client team**, which is what keeps the shared edge gateway thin.

### Step 3 — Cross-cutting concerns done once

| Concern | Implementation |
|---|---|
| **AuthN** | Validate the JWT signature against the IdP's cached **JWKS**, check `iss`, `aud`, `exp`, `nbf`. Forward the validated claims; **never let the gateway be the only check** — services validate too, because the network is not a trust boundary (Q10) |
| **Rate limiting** | Distributed counters (Redis) keyed by client id and route; return `429` with `Retry-After` and expose `X-RateLimit-*` headers so clients can behave |
| **Correlation** | Generate a correlation/trace id if absent, propagate as W3C `traceparent`, log it on every hop |
| **Timeouts** | The gateway's timeout must be **shorter** than the client's and **longer** than the service's, so failures surface in the right place |
| **Circuit breaking** | Per upstream, so one failing service returns fast rather than consuming gateway connections |
| **Versioning** | URL path (`/v1/…`) at the public edge for clarity; header-based internally |
| **Request validation** | Reject malformed payloads at the edge — services then only handle well-formed input |

### Step 4 — Choosing the technology

| Option | Best for | Caveat |
|---|---|---|
| **AWS API Gateway** | Serverless, low ops, native IAM/Cognito/WAF integration | Per-request cost at high volume; **29 s default integration timeout** (raisable via a service-quota increase for Regional/private REST APIs since 2024, but still the number to design against); limited custom logic |
| **ALB + service** | Simple HTTP routing, high volume, low cost | Not a real gateway — no rate limiting, no auth, no transformation |
| **Kong / APISIX / Ocelot** | Rich plugins, self-hosted control, .NET-native (Ocelot/YARP) | You operate it, including its HA |
| **Envoy / Istio ingress** | Consistent with a service mesh; strong traffic management | Steep operational learning curve |

**The cost point worth raising at scale:** AWS API Gateway is priced per request. At 10,000 RPS, that is roughly 26 billion requests a month — the per-request cost becomes a serious line item, and an ALB plus a self-managed gateway on EKS often wins economically. **The right answer depends on volume, and saying "it depends on the request volume, here is the arithmetic" is the answer.**

### Step 5 — Failure and scale

- **The gateway is a single point of failure by construction** — it must be multi-AZ, autoscaled, and stateless. Any state (rate-limit counters, JWKS cache) lives in Redis or in memory with a short TTL.
- **JWKS caching**: cache the IdP's keys with a bounded TTL and handle key rotation gracefully — if the gateway fetches JWKS on every request, the IdP becomes your availability ceiling.
- **Do not let the gateway do fan-out**: a gateway making ten downstream calls per request has become an orchestrator with no durability. Put that in a BFF or a saga.
- **Zone-aware routing** to avoid unnecessary cross-AZ hops and their data charges.

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Thin edge gateway + per-client BFFs | One fat gateway | Keeps the shared component free of client-specific logic |
| Validate tokens at the gateway *and* the service | Gateway only | Zero Trust — the network is not a boundary; defends against lateral movement |
| Self-hosted gateway at high volume | Managed API Gateway | Per-request pricing dominates above a few thousand RPS |
| Coarse authz at the edge, fine-grained in the service | All authz at the edge | The gateway cannot know object ownership; that check needs domain data |

### Wrap-Up

**Out of scope:** a GraphQL gateway variant, the gateway's own response-caching strategy in depth, and a multi-cluster/multi-region gateway topology.

**Monitoring that matters:** p99 measured **at the gateway** versus **at the origin service** for the same route, which isolates latency the gateway itself is adding from latency the backend is adding; 429/503 rate, which is the rate-limiting and circuit-breaker configuration made visible; JWKS fetch failures, since a JWKS outage silently fails every authentication check behind it.

**The natural next question:** "how do you roll out a breaking change to a public partner API?" — the expand/contract discipline from Q19 applies at the gateway too: publish `/v2` alongside `/v1`, give partners a measured deprecation window with `Sunset` headers (RFC 8594/9745), and retire `/v1` only once telemetry shows zero traffic against it.

---

## Q19. Design microservices for independent deployment.

**Independent deployability is the *only* reason to accept the cost of microservices.** If services must be released together, you have a distributed monolith — all the operational cost of microservices and none of the benefit. So the design question is: what must be true for team A to deploy on Tuesday afternoon without asking anyone?

### Step 1 (Understand the Problem & Establish Design Scope) — The four prerequisites

| Prerequisite | What breaks without it |
|---|---|
| **Own the data** — database per service, no shared tables | A schema change becomes a cross-team release; the database is the coupling |
| **Backward-compatible contracts** | Deploying provider before consumer (or after) breaks the other |
| **No shared runtime state** | Two versions cannot run simultaneously, so rollout must be atomic |
| **Own the pipeline** | A shared release train reintroduces the coordination you removed |

**Database per service is the non-negotiable one.** A shared database means every service's release is gated by every other service's schema expectations, and no amount of API discipline fixes it. Where a service needs another's data, it gets a **replica maintained by events** (Q6), not a foreign key.

### Step 2 (Propose High-Level Design & Get Buy-In) — Contract evolution: expand/contract

The discipline that makes independent deployment possible:

```text
Phase 1 — EXPAND     Add the new field/endpoint alongside the old. Both work.
                     Deploy the provider. Nothing consuming it changes.
Phase 2 — MIGRATE    Consumers move to the new shape, at their own pace, in their own releases.
Phase 3 — CONTRACT   When telemetry shows zero use of the old shape, remove it.
```

**Rules that keep this working:**

- **Additive only** within a version: add optional fields, never remove or rename, never change a type, never tighten validation.
- **Consumers ignore unknown fields** (tolerant reader) — so a provider adding a field never breaks anyone.
- **Never change the meaning of an existing field** — the subtlest and most damaging break, because nothing fails; it just becomes wrong.
- **Measure usage before contracting.** Instrument per-field and per-version usage; "I asked in Slack and nobody objected" is not evidence.
- **Breaking changes get a new version** running in parallel, with a published sunset date (`Deprecation` and `Sunset` headers, RFC 9745/8594).

**Events need the same discipline**, enforced mechanically by a **Schema Registry** with `BACKWARD` compatibility — the registry rejects an incompatible schema at publish time, which is far better than a consumer discovering it at 2 a.m.

### Step 3 — Verifying compatibility before deploying

**Consumer-driven contract testing (Pact) is the mechanism**, and naming it is what distinguishes a concrete answer from an aspirational one:

```text
Consumer team writes:  "when I GET /orders/123 I expect fields id, status, total"
                       → publishes that expectation as a contract to a broker
Provider CI verifies:  runs every published consumer contract against the real provider
                       → provider's build FAILS if any consumer's expectation breaks
```

This gives the guarantee that end-to-end integration environments promise and never deliver: the provider knows, **at build time**, whether a change breaks a real consumer — without a shared environment, without coordinating releases, and without testing every combination.

### Step 4 — Deployment mechanics that allow two versions to coexist

Since deployment is gradual, **N and N−1 always run simultaneously**. That must be safe:

| Technique | Purpose |
|---|---|
| **Rolling / canary / blue-green** | Gradual exposure with a fast rollback path |
| **Feature flags** | Separate *deploy* from *release* — ship dark, enable per cohort, disable without a rollback |
| **Expand/contract migrations** | Add a nullable column → backfill → dual-write → switch reads → drop the old column, **each step a separate release** |
| **Idempotent, backward-compatible consumers** | An old consumer must tolerate a new event shape and vice versa |
| **Automated rollback on SLO breach** | Rollback must be one button and rehearsed, not a decision made under pressure |

**Never write a migration that a running old version cannot survive.** Renaming a column in one release is the canonical outage: the moment the migration lands, every not-yet-upgraded pod starts failing. The expand/contract sequence above is the fix, and it is slower on purpose.

### Step 5 — Organisational alignment

**Conway's Law is the constraint people forget.** Independent deployment requires that a change usually fits inside one team's boundary. If most features need three teams, the service boundaries are wrong — they were probably drawn around technical layers rather than **bounded contexts** (Module 04). The test: *how many services must change for a typical feature?* If the answer is routinely more than one, redraw the boundaries before investing further in deployment tooling.

### Trade-offs

| Gain | Cost |
|---|---|
| Deploy on your own schedule; small, low-risk releases | Contract discipline forever; expand/contract is slower per change |
| Failure is isolated to one service | Two versions must coexist, which constrains every schema change |
| Teams scale independently | Duplicated data via events, and the eventual consistency that follows |
| Fast rollback | Real investment in contract testing, flags and pipeline automation |

### Wrap-Up

**Out of scope:** the monorepo-vs-polyrepo trade-off, choosing a specific feature-flag platform, and a cross-team API-ownership/governance model in depth.

**Monitoring that matters:** contract-test pass rate in CI, which is the *leading* indicator — a break caught here never reaches production; change-failure rate and deploy frequency per service (the DORA metrics this whole design exists to earn); rollback frequency, which should trend down as expand/contract discipline matures, not up.

**The natural next question:** "two teams both need to change the same shared event — how do you sequence that?" — the event's owning team runs expand/contract on the schema (Q19's own pattern, applied recursively): add the new field, let both consuming teams migrate on their own schedule, then remove the old field once telemetry shows zero consumers still reading it.

---

## Q20. Design service-to-service security.

### Step 1 (Understand the Problem & Establish Design Scope) — The premise: the network is not a trust boundary

The traditional model — a hard perimeter and a trusted internal network — fails because one compromised pod, one SSRF, one leaked credential puts an attacker *inside*. **Zero Trust**: every call is authenticated, authorised and encrypted, including calls between two pods in the same namespace.

**Three questions every service-to-service call must answer:**

1. **Who is calling?** (authentication — cryptographic workload identity)
2. **May they do this?** (authorisation — per-service, per-operation)
3. **Is anyone listening?** (encryption in transit)

### Step 2 (Propose High-Level Design & Get Buy-In) — mTLS for identity and encryption

```text
Service A                                Service B
   │  ClientHello                            │
   ├────────────────────────────────────────▶│
   │  ServerHello + B's certificate          │
   │◀────────────────────────────────────────┤
   │  A's certificate  ← the difference from ordinary TLS
   ├────────────────────────────────────────▶│
   │  both verify against the internal CA    │
   │  both now KNOW the peer's identity      │
```

Ordinary TLS authenticates only the server; **mTLS authenticates both ends**, so B knows cryptographically that the caller is A — not merely that something inside the VPC dialled the port.

**A service mesh (Istio, Linkerd, AWS App Mesh) is the practical way to get it**, because the hard part is certificate lifecycle, not the handshake: the mesh issues a short-lived certificate (SPIFFE identity such as `spiffe://cluster/ns/payments/sa/payment-api`) to each workload, rotates it every few hours automatically, and terminates mTLS in the sidecar so application code is unchanged. Certificates measured in hours rather than years mean a stolen key is worthless almost immediately.

### Step 3 — Authorisation, in two distinct layers

**Layer 1 — service-level (may A call B at all?)**

```yaml
# Istio AuthorizationPolicy — default deny, then explicit allow
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata: { name: ledger-access, namespace: ledger }
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            principals: ["cluster.local/ns/payments/sa/payment-api"]
      to:
        - operation: { methods: ["POST"], paths: ["/v1/entries"] }
```

Paired with a **default-deny Kubernetes NetworkPolicy**, so an unlisted service cannot even open the connection. Two independent layers, which is the point.

**Layer 2 — user-context propagation (may this *end user* do this?)**

The service identity says the *payment service* is calling; it says nothing about *which customer's* money is moving. Propagate the user context and **re-validate it at each hop**:

- **Token exchange (RFC 8693)** — the calling service exchanges the user's token for a downstream token with a narrowed audience and reduced scopes. The downstream service validates `aud`, `iss`, `exp` and scopes, then applies **object-level authorization** using its own data (Module 16 Q3). This is the correct pattern.
- **Do not simply forward the original user token** unchanged through five hops: its audience is wrong for each of them, and any service in the chain can replay it anywhere.
- **Never trust a header like `X-User-Id`** unless it arrives inside a signed token — a plain header is attacker-controllable the moment anything upstream is compromised.

**Service-to-service without a user** (a batch job) uses the **OAuth2 client credentials** flow with tightly scoped, short-lived tokens — or, better, the mesh identity itself.

### Step 4 — The supporting controls

| Control | Purpose |
|---|---|
| **No static credentials** — IRSA / managed identity / mesh identity | Nothing durable to steal |
| **Short-lived tokens** (minutes) | Bounds the value of a stolen token |
| **Audience restriction** on every token | A token for the ledger cannot be replayed at the payment service |
| **Egress control** — explicit allow-list of external destinations | Blocks exfiltration and SSRF pivots (Module 16 Q8) |
| **Per-service rate limits** internally | One misbehaving service cannot exhaust another |
| **Audit every cross-service call** with correlation id and both identities | Forensics and non-repudiation (Q8) |
| **Regular identity review** | Remove allow-list entries for integrations that no longer exist |

### Step 5 — Verify the design by assuming compromise

Take one pod as fully compromised and trace what the attacker reaches: they hold a short-lived mesh identity for *that* service only; NetworkPolicy blocks connections to services that identity is not permitted to call; AuthorizationPolicy rejects operations outside its allow-list; the downstream service still applies object-level authorization using the *user* token, which the attacker does not hold for arbitrary customers; and every attempt is logged with its identity. **The blast radius is one service's legitimate capability — which is the design goal.**

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Service mesh mTLS | Application-level TLS | Certificate rotation and policy without touching application code |
| Token exchange per hop | Forward the user token | Correct audiences; limits replay; slightly more complexity per hop |
| Default-deny network + authz policy | Flat network, perimeter security | Stops lateral movement, which is how breaches actually spread |
| Short-lived workload identity | Static service accounts and API keys | Removes the credential-theft class of attack almost entirely |

### Wrap-Up

**Out of scope:** operating the mesh's internal certificate authority at scale, a break-glass emergency-access procedure, and multi-cluster mesh federation.

**Monitoring that matters:** mTLS handshake failure rate; `AuthorizationPolicy` denial rate, which should sit near zero — a spike means either a misconfiguration just shipped or an attack is in progress, and those are indistinguishable without further investigation, which is exactly why the alert exists; token-exchange failure rate; certificate expiry lead time, so rotation failures are caught days before they become an outage.

**The natural next question:** "a service's mesh identity is compromised — walk me through containment in the first five minutes" — revoke that specific SPIFFE identity or delete its IAM role immediately (Q10's incident-response answer, applied here), which the short-lived-certificate design makes both fast and low-blast-radius, since every other service's identity is unaffected.

---

## Q21. Design a Kubernetes-based microservices platform.

### Step 1 (Understand the Problem & Establish Design Scope) — Cluster topology

```text
AWS account (workload)                 Separate accounts: shared services, audit, backup
 ├─ EKS control plane (managed, multi-AZ)
 ├─ Node groups
 │    ├─ system      (CoreDNS, ingress, mesh control plane, observability) — tainted
 │    ├─ general     (stateless services; Karpenter-provisioned, spot + on-demand mix)
 │    └─ sensitive   (payment/ledger workloads; on-demand only, dedicated nodes)
 ├─ Namespaces per bounded context, with ResourceQuota and LimitRange
 └─ Data services OUTSIDE the cluster: Aurora, MSK, ElastiCache, S3
```

**Two decisions to justify up front:**

1. **Stateful data services live outside the cluster.** Running Postgres or Kafka on Kubernetes is possible, but you inherit storage, failover and backup operations that Aurora and MSK already solve. The value of Kubernetes is in orchestrating *stateless* workloads.
2. **Multiple clusters or one?** One cluster per environment (dev/staging/prod), with namespaces per team, is the usual right answer — a cluster per team multiplies operational cost and upgrade burden. Split clusters only for a genuine hard boundary: regulatory isolation, a separate region, or radically different upgrade cadences.

### Step 2 (Propose High-Level Design & Get Buy-In) — Workload configuration that actually matters

```yaml
resources:
  requests: { cpu: "250m", memory: "512Mi" }   # scheduling + HPA baseline
  limits:   { memory: "512Mi" }                # NO cpu limit — see below
readinessProbe: { httpGet: { path: /health/ready }, periodSeconds: 5 }
livenessProbe:  { httpGet: { path: /health/live  }, periodSeconds: 10, failureThreshold: 3 }
startupProbe:   { httpGet: { path: /health/live  }, failureThreshold: 30, periodSeconds: 5 }
lifecycle:
  preStop: { exec: { command: ["sleep", "10"] } }   # let endpoints propagate before dying
terminationGracePeriodSeconds: 45
```

| Setting | Reasoning |
|---|---|
| **Memory limit = memory request** | Guarantees the QoS class and makes OOM behaviour predictable. **Exceeding a memory limit is an instant `OOMKilled`** — memory is incompressible |
| **No CPU limit (usually)** | CPU is compressible; a limit causes **throttling**, which appears as unexplained p99 latency. Requests alone give fair scheduling. Set a limit only for genuinely noisy neighbours |
| **Separate liveness and readiness** | Liveness restarts a broken pod; readiness removes it from the endpoints. Conflating them causes restart loops during a transient dependency blip |
| **Startup probe** | Prevents liveness from killing a slow-starting app before it is ready — the usual cause of `CrashLoopBackOff` on JVM/.NET services with heavy warm-up |
| **`preStop` sleep + grace period** | Endpoint removal is **eventually consistent** across kube-proxy and the mesh; without the pause, traffic still arrives at a terminating pod. This is the fix for "we see 502s on every deploy" |

**Liveness must not check dependencies.** If your liveness probe checks the database, a database blip restarts every pod simultaneously and turns a recoverable incident into an outage. Liveness = "is this process wedged?"; readiness = "can I serve right now?".

### Step 3 — Scaling, availability and disruption

| Mechanism | Use |
|---|---|
| **HPA** | Scale on **RPS or queue depth** for I/O-bound services (via KEDA/custom metrics), not CPU — an async .NET API at 15% CPU can still be saturated |
| **Karpenter / Cluster Autoscaler** | Node-level elasticity; Karpenter provisions right-sized nodes quickly |
| **PodDisruptionBudget** | `minAvailable: 2` — stops a node drain or upgrade taking every replica at once |
| **topologySpreadConstraints** | Spread replicas across AZs and nodes; without it, three replicas can land on one node |
| **Pod anti-affinity** | Keep replicas of the same service off the same node |
| **Spot instances with on-demand base** | Big savings for stateless workloads; keep payment/ledger on on-demand |

### Step 4 — Platform services

| Concern | Choice |
|---|---|
| **Ingress** | ALB Controller (AWS-native, WAF integration) or the mesh ingress gateway |
| **Service mesh** | mTLS, traffic shifting, per-service authz (Q20) — adopt when multi-team and regulated; skip if a small estate |
| **Secrets** | **External Secrets Operator** or Secrets Store CSI driver pulling from Secrets Manager. Kubernetes `Secret` objects are only **base64-encoded**, not encrypted, unless envelope encryption with KMS is enabled — say this, it is a common gap |
| **Identity** | **IRSA / Pod Identity** — per-service IAM role, no static AWS keys in the cluster |
| **GitOps** | Argo CD / Flux — the cluster is a pure function of the repository, giving auditable change management and a trivial DR rebuild |
| **Observability** | Prometheus + Grafana, OpenTelemetry traces, structured logs to CloudWatch/OpenSearch, correlation ids end to end |
| **Policy** | OPA Gatekeeper / Kyverno — enforce non-root, read-only root filesystem, no `latest` tags, required labels, signed images |
| **Supply chain** | Image scanning (ECR/Trivy) in CI, signed images (cosign) verified at admission, minimal distroless base images |

### Step 5 — Debugging, which interviewers always probe

```text
Pod pending      → kubectl describe pod: unschedulable? insufficient CPU/memory,
                   taints, no node matching topology constraints, PVC unbound
CrashLoopBackOff → kubectl logs --previous: config/secret missing, failed
                   startup probe, unhandled startup exception
OOMKilled        → exit code 137: limit too low, or a real leak — check
                   container_memory_working_set_bytes trend before raising the limit
Service has no
endpoints        → selector does not match pod labels, or readiness never passes
Intermittent 502 → terminating pods still receiving traffic (fix: preStop + grace),
                   or readiness flapping
DNS timeouts     → CoreDNS under-scaled, ndots search-domain amplification,
                   conntrack table exhaustion on nodes
```

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Managed data services outside the cluster | StatefulSets for databases | Avoids inheriting storage/failover/backup operations Aurora and MSK already solve |
| One prod cluster, namespace per team | Cluster per team | Far lower operational and upgrade cost; isolation via namespaces, quotas and policy |
| No CPU limits | Limits everywhere | Avoids throttling-induced tail latency; requests already provide fair share |
| Mesh mTLS | Application TLS | Rotation and policy without code changes; cost is sidecar overhead and complexity |

### Wrap-Up

**Out of scope:** multi-cluster/multi-region Kubernetes, cost optimisation in depth (Spot mix, bin-packing), and a full GitOps rollback strategy.

**Monitoring that matters:** `OOMKilled` rate (a rising trend means limits are set too tight or there's a real leak, and the two look identical from this metric alone — `container_memory_working_set_bytes` trend is what disambiguates them); pod restart rate; node-level disk and memory pressure; HPA scaling events correlated against actual load, to catch a scaling policy reacting to the wrong signal; PodDisruptionBudget-blocked drains, which show up as a stuck node upgrade.

**The natural next question:** "walk me through debugging a pod that's `CrashLoopBackOff` in production right now" — `kubectl logs --previous` for the last crash's output, most commonly a missing config/secret, a failed startup probe, or an unhandled exception during startup; that's Module 10's own debugging table, applied live under interview pressure.

---

## Q22. Design a resilient external API integration.

### Step 1 (Understand the Problem & Establish Design Scope) — The premise: the third party *will* fail

Every external dependency — a PSP, a KYC provider, a market-data feed, a carrier — is outside your control. Assume slow responses, 5xx bursts, rate limits, breaking changes shipped without notice, and multi-hour outages. **The design goal is that their bad day is not your bad day.**

### Step 2 (Propose High-Level Design & Get Buy-In) — The layered defence, in the order it applies

```text
Your service
   │
   ├─ Anti-corruption layer   translate their model into yours at the boundary
   ├─ Timeout                 always shorter than your own SLA budget
   ├─ Retry + backoff + jitter  only for retryable, idempotent operations
   ├─ Circuit breaker         stop calling a dependency that is clearly down
   ├─ Bulkhead                cap concurrency so they cannot exhaust your pool
   ├─ Fallback / cache        degrade rather than fail
   └─ Async + DLQ             for anything that need not be synchronous
```

| Control | Configuration that matters |
|---|---|
| **Timeout** | Set explicitly on every call. **The .NET `HttpClient` default is 100 s** — long enough to exhaust your thread pool during their outage. Budget it from your own SLA (Q14) |
| **Retry** | **Exponential backoff with jitter**, capped attempts (3–5). Jitter is essential: synchronised retries from 200 instances are a self-inflicted DDoS the moment they recover |
| **Retry only what is safe** | GET/PUT/DELETE are idempotent; **POST is not** unless it carries an idempotency key. Retrying a non-idempotent POST is how double charges happen |
| **Circuit breaker** | Open after N failures in a window; half-open probes recovery. Prevents piling threads onto a dead dependency and gives them room to recover |
| **Bulkhead** | Bound concurrent calls per dependency, so a slow provider consumes a fixed slice of your resources rather than all of them |
| **Rate limit yourself** | Stay below their published quota — a token bucket sized under their limit, honouring `Retry-After` on 429 |

```csharp
services.AddHttpClient<IPspClient, PspClient>(c =>
{
    c.BaseAddress = new Uri("https://api.psp.example");
    c.Timeout = TimeSpan.FromSeconds(5);            // never the 100 s default
})
.AddStandardResilienceHandler(o =>                  // Microsoft.Extensions.Http.Resilience
{
    o.Retry.MaxRetryAttempts   = 3;
    o.Retry.BackoffType        = DelayBackoffType.Exponential;
    o.Retry.UseJitter          = true;
    o.CircuitBreaker.FailureRatio     = 0.5;
    o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(30);
    o.AttemptTimeout.Timeout          = TimeSpan.FromSeconds(3);
});
```

### Step 3 — Prefer asynchronous integration

**If the call does not have to be synchronous, do not make it synchronous.** Accept the request, persist the intent, return `202`, and let a worker call the provider with retries and a DLQ. Their outage becomes queue depth, not customer-facing errors — the same reasoning as Q4 and Q7. Reserve synchronous calls for genuinely interactive decisions (a card authorisation), and give those the hardest timeout budget.

### Step 4 — Ambiguity, idempotency and reconciliation

**The hardest failure is not an error — it is not knowing.** You sent a request; the connection dropped; did it succeed?

- **Send your own idempotency key** on every mutating call, so a retry is safe at their end.
- **Never blindly retry a payment** without one (Q2).
- **Model ambiguity as a state** (`PENDING_VERIFICATION`), not as an exception.
- **Query-after-timeout**: if they expose a lookup by your reference, use it to resolve the ambiguity.
- **Reconcile against their records** on a schedule — the settlement-file pattern from Q2. This is the only mechanism that ultimately guarantees your view matches theirs, and it is required even when they claim idempotency.

### Step 5 — Contain the coupling, and watch them

- **Anti-corruption layer**: their model never leaks into your domain. When they change a field name or ship v3, exactly one adapter class changes. Without this, a vendor's data model quietly becomes your data model and migrating away becomes impossible.
- **Provider abstraction with a second implementation** where the risk justifies it (a second PSP, a second SMS vendor). Even unused, the interface keeps you honest about coupling; used, it is your outage mitigation.
- **Webhooks in, not just polling out** — verify their signature, respond `200` fast, process asynchronously, and handle out-of-order and duplicate deliveries (Module 16 Q23).
- **Monitor them as a first-class dependency**: success rate, latency percentiles, circuit-breaker state, quota consumption — all on a dashboard, all alerting. When their latency doubles you should know before your customers tell you.
- **Sandbox and contract tests in CI**, plus **fault injection** in staging (inject 500s, 30-second delays, malformed payloads) so the resilience configuration is exercised rather than assumed.

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Async with DLQ | Synchronous call | Their outage becomes queue depth; cost is eventual completion the UX must reflect |
| Circuit breaker | Retry forever | Prevents cascading failure and gives the provider room to recover; cost is fast failures during the open window |
| Multi-provider abstraction | Single provider | Real outage mitigation; cost is an abstraction that must fit two very different APIs |
| Reconciliation process | Trust their idempotency | The only way to *prove* your records match; cost is a batch pipeline to build and run |

### Wrap-Up

**Out of scope:** contract-testing this integration against the vendor's sandbox in CI, negotiating the vendor's SLA, and the live migration procedure for cutting over from one provider to a second.

**Monitoring that matters:** circuit-breaker state transitions (open/half-open/closed), which turn "the provider is degraded" into a graphable signal rather than a support ticket; per-provider success rate and latency, tracked separately so one degraded provider doesn't hide in a blended average; reconciliation-break rate against the provider's own records; idempotency-key collision rate, which is the direct measurement of how often retries are actually happening.

**The natural next question:** "the provider changed their API without notice — how does that surface, and how fast do you know?" — the anti-corruption-layer adapter starts throwing deserialisation or validation errors, the circuit breaker opens on the resulting failure rate, and the alert fires within the breaker's sampling window — typically under a minute, versus discovering it from a customer complaint with no adapter layer at all.

---

## Q23. Design a platform with strict RPO/RTO requirements.

Q13 chose a DR strategy. This question is about **achieving near-zero RPO and single-digit-minute RTO across a whole platform, and being able to evidence it** — which is a different, harder problem, because the weakest component sets the number.

### Step 1 (Understand the Problem & Establish Design Scope) — Decompose the targets per component

**The platform's RPO/RTO is the worst of its components, not the average.** So start by tabulating them, which is also what an auditor will ask for:

| Component | Replication | RPO | RTO | Gap? |
|---|---|---|---|---|
| Aurora Global Database | Physical, < 1 s | ~1 s | ~1 min (managed promotion) | OK |
| DynamoDB Global Tables | Multi-active | ~1 s | ~0 | OK |
| S3 documents | CRR, asynchronous | **minutes** | ~0 | ⚠ under target |
| Kafka (MSK) | MirrorMaker 2 | **seconds–minutes**, offsets differ | minutes | ⚠ consumer position |
| ElastiCache | Not replicated | n/a (rebuildable) | minutes to warm | Acceptable — derived data |
| Secrets Manager | Replica secrets | ~0 | ~0 | OK |
| EKS workloads | GitOps, both regions | n/a | minutes to scale | OK |

**The two typical gaps are worth naming because they are where real designs fail:** S3 cross-region replication is asynchronous, so recently uploaded documents can be lost; and **Kafka offsets are not portable between clusters**, so after failover consumers may re-process or, worse, skip. The mitigations are to store the consumer position in your own database alongside the processed data (making position recovery a business-data problem you control), and to accept and document the S3 replication window for non-critical artefacts while writing critical documents synchronously to both regions.

### Step 2 (Propose High-Level Design & Get Buy-In) — Achieving near-zero RPO on the transactional core

RPO is a **data-replication** property, so it is decided at the storage layer:

| Mechanism | RPO | Cost |
|---|---|---|
| **Synchronous replication** (Aurora within a region, across AZs) | **Zero** | Write latency includes the replica ack |
| **Aurora Global Database** (cross-region, asynchronous) | Typically **< 1 s** | Minimal write impact |
| **Truly zero cross-region RPO** | Zero | Requires synchronous cross-region commit — hundreds of ms per write; almost never acceptable |

**State the physics honestly:** zero RPO across regions means every commit waits for a transatlantic round trip. For a payment platform the usual answer is **zero RPO within the region (multi-AZ synchronous)** and **sub-second RPO across regions**, with the residual sub-second window covered by an **idempotent replay** mechanism: because clients retry with idempotency keys (Q2), an in-flight transaction lost in the last 500 ms is safely re-submitted rather than lost. **Designing the application so that a small RPO window is recoverable is cheaper than engineering the window to zero** — and that insight is the strongest thing you can say on this question.

### Step 3 — Achieving single-digit-minute RTO

RTO is an **automation** property. Every manual step is minutes you cannot get back:

```text
Detection        30 s   automated health checks, multiple signals, no human paging
Decision         30 s   automated policy with a defined confidence threshold
                        (guard against flapping: require N consecutive failures)
DB promotion     60 s   Aurora global failover
Scale DR compute 90 s   pre-warmed baseline + Karpenter; nodes already exist
DNS shift        60 s   Route 53 health-check failover, TTL 60 s
Verification     60 s   automated synthetic transaction end-to-end
────────────────────
Total          ~5.5 min
```

**What makes each step fast:** the DR cluster is **already running** (warm standby, not pilot light); the manifests are identical because they come from the same Git repository; quotas are pre-raised; the KMS key is **multi-Region**; and the failover is a single automated workflow, not a runbook someone reads at 3 a.m.

### Step 4 — Evidence, because in a regulated firm an unproven control does not count

| Evidence | How |
|---|---|
| **RPO measurement** | Continuously compare `max(committed_at)` in the primary against the replica; alert if the gap exceeds target. This is a live metric, not a claim |
| **RTO measurement** | Timed, scheduled failover exercises (game days) at least annually, with the measured number recorded |
| **Failback tested** | Because returning is harder than leaving (Q13) |
| **Compromise scenario** | Exercise the case where the primary account is unavailable/compromised — backups in a separate account with **Vault Lock compliance mode** |
| **Dependency map** | Every third-party dependency's own RTO; your platform cannot beat a provider whose DR is four hours |

**And the constraint people forget: your RTO cannot exceed your slowest external dependency.** If the PSP has a two-hour RTO, your five-minute RTO restores a platform that cannot take payments. The answer is a documented degraded mode — queue authorisations, serve read-only balances — so the platform is *useful* within five minutes even if not fully functional.

### Trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Sub-second RPO + idempotent replay | Zero cross-region RPO | Avoids transatlantic synchronous commits; the application recovers the residual window |
| Automated failover | Human-approved failover | Automation is the only way to hit single-digit minutes; needs strong anti-flapping guards |
| Warm standby always running | Pilot light | Removes cold-start minutes from RTO, at a continuous cost |
| Per-component RPO/RTO table | One platform-wide number | Exposes the weakest link, which is where the real gap always is |

### Wrap-Up

**Out of scope:** RPO/RTO for the CI/CD and secrets-management control plane that the failover automation itself depends on, formal negotiation of third-party dependency RTOs, and the full cost model of the sub-second-RPO design.

**Monitoring that matters:** the live RPO gap, measured continuously as `max(committed_at)` on primary minus the same on the replica — not assumed from a vendor's headline number; days since the last successful, *timed* failover drill; quota headroom in the DR region, verified before it's needed rather than discovered during the incident.

**The natural next question:** "your RPO target for one specific data type is zero seconds — is that achievable, and what does it cost?" — genuinely zero cross-region RPO requires synchronous cross-region commit, which means every write waits on a transatlantic round trip; the honest answer is to instead make that residual sub-second window *recoverable* via idempotent replay (as this question's own design does), because engineering the window itself to zero is usually the wrong trade for the latency it costs.

---

## Q24. Design a system with eventual consistency.

### Step 1 (Understand the Problem & Establish Design Scope) — Decide *where* eventual consistency is acceptable — that is the design

Eventual consistency is not a property you apply uniformly; it is a **per-operation decision**, and the strong answer classifies the operations before designing anything:

| Operation | Consistency needed | Why |
|---|---|---|
| Debit an account balance | **Strong** | Overdraft is unrecoverable; this is money |
| Reserve inventory | **Strong** (within the aggregate) | Overselling has a real cost |
| Order status shown to the customer | Eventual (seconds) | A brief lag is invisible and harmless |
| Search index, recommendations | Eventual (minutes) | Nobody notices |
| Analytics, reporting | Eventual (minutes–hours) | Batch by nature |
| Notification of an event | Eventual | Delivery is inherently asynchronous |

**Rule of thumb: strong consistency inside an aggregate boundary, eventual consistency between aggregates.** A single account's balance is transactionally consistent; the *view* of that balance elsewhere is eventually consistent. Getting that line in the right place is most of the design.

### Step 2 (Propose High-Level Design & Get Buy-In) — Mechanisms

```text
Write (strongly consistent within the aggregate)
   │  local ACID transaction + outbox row
   ▼
Kafka domain events (at-least-once, ordered per key)
   │
   ├─▶ Read model / projection  (eventual, lag measured in ms–s)
   ├─▶ Search index             (eventual)
   ├─▶ Other services' replicas (eventual)
   └─▶ Analytics                (eventual)
```

**The properties every consumer of an eventually consistent flow must have:**

| Property | Implementation |
|---|---|
| **Idempotent** | Upsert keyed on the aggregate id; `processed_events` unique constraint inside the same transaction as the effect |
| **Order-tolerant** | Carry a version/sequence; **ignore anything not newer than what you already hold** — this single rule makes out-of-order delivery harmless |
| **Convergent** | Given the same set of events in any order, the end state is identical |
| **Monotonic where visible** | Never show a user a value that goes backwards |

**Handling out-of-order events, concretely:**

```sql
UPDATE order_read_model
   SET status = :status, version = :version, updated_at = now()
 WHERE order_id = :id AND version < :version;   -- older event → 0 rows → discarded
```

### Step 3 — Making it acceptable to users, which is the real design work

The technical mechanism is easy; the **user experience of staleness** is where systems fail:

| Technique | Use |
|---|---|
| **Return the result from the command** | The user sees their own change instantly, with no read-model round trip. Use this by default |
| **Read-your-own-writes** | Pin that user's reads to the primary/authoritative store for N seconds after a write |
| **Version token / polling** | Command returns a version; the client waits until the read model reaches it |
| **Optimistic UI with reconciliation** | Show the expected state immediately, correct it if the server disagrees |
| **Honest status** | "Processing…" rather than pretending the transfer is complete. Often the best product answer, and it sets correct expectations |

**The anti-pattern to name:** write, then immediately query the read model, then treat the empty result as an error. That is a design bug being papered over with retries.

### Step 4 — Operate it

- **Measure lag as a first-class SLO.** Consumer lag and projection lag are the health signals; a stale projection is a customer-visible defect even when everything is "up".
- **Bound the staleness contractually.** "The balance view is at most 5 seconds behind" is a statement the business can reason about; "eventually consistent" is not.
- **Alert on divergence**, not just lag — periodically compare aggregate counts/checksums between the write store and the projections, because a silently wrong projection is worse than a lagging one.
- **Make projections rebuildable** so any divergence has a cheap remedy (Q16).
- **Cache stampede** is the adjacent failure: when a hot key expires, hundreds of requests miss simultaneously and hit the source at once. Mitigate with a **per-key lock (single-flight)**, **probabilistic early expiry**, or **stale-while-revalidate** — serve the slightly stale value while one request refreshes it, which is eventual consistency used deliberately as a performance tool.

### Trade-offs

| Gain | Cost |
|---|---|
| Availability under partition; independent scaling | The UI must handle staleness honestly |
| No distributed transactions or cross-service locks | Idempotency, ordering and convergence become application concerns |
| Read models tuned per use case | Divergence is possible and must be monitored and repairable |
| Write path stays fast and simple | "When is it consistent?" becomes a question the business must answer per operation |

### Wrap-Up

**Out of scope:** CRDTs as an alternative convergence mechanism to last-writer-wins, the added complexity of eventual consistency layered under multi-region deployment (Q12's problem, on top of this one), and read-repair strategies for the divergence case.

**Monitoring that matters:** projection/replica lag as a first-class SLO with an alerting threshold, not an internal detail; scheduled divergence-detection job results (periodic checksum or count comparisons between the write store and its projections); stale-read rate as *reported by clients*, which is what actually correlates with the user-visible complaint.

**The natural next question:** "how do you explain to a user why their own change disappeared for two seconds?" — it didn't disappear; they wrote to the strongly consistent primary and then read from a read model that hadn't caught up yet, and the fix is one of this question's own techniques — return the result directly from the command, or pin that user's reads to the primary for a short window after a write — rather than a database investigation.

---

## Q25. Explain the trade-offs in your architecture.

This is usually the closing question, and it is the one that most distinguishes a Principal-level candidate. The interviewer is not testing recall — **they are testing whether you know the cost of your own decisions**, and whether you can defend them without either dogmatism or hedging. *(This question is deliberately not walked through the scope→design→deep-dive spine used elsewhere in this module — it **is** the wrap-up step of that framework, asked as a question in its own right, so its steps below are its own structure rather than another pass through Steps 1–4.)*

### Step 1 — The failure modes to avoid

| Weak answer | Why it fails |
|---|---|
| "There are no real trade-offs; this is best practice" | Every decision costs something. Claiming otherwise means you have not looked |
| "It depends" with no decision | Acknowledging a trade-off is not the same as making a call |
| Listing generic pros and cons | Textbook recall, not judgement |
| Defending every choice as optimal | Real architectures contain deliberate compromises and accepted debt; say which |

**The strong form:** *"I chose X over Y. X costs me A and B. I accepted that because of C, which matters more here. If constraint D changed, I would revisit and probably choose Y."* That last clause — naming the condition that would reverse the decision — is what makes it an engineering judgement rather than a preference.

### Step 2 — The axes to reason along

| Axis | The tension |
|---|---|
| **Consistency ↔ availability** | CAP under partition; per-operation, not per-system (Q24) |
| **Latency ↔ durability** | `acks=all` and synchronous replication cost milliseconds and buy safety |
| **Cost ↔ resilience** | Each nine roughly multiplies spend (Q11); multi-region roughly doubles it |
| **Simplicity ↔ flexibility** | Microservices buy independent deployment with operational complexity |
| **Speed now ↔ maintainability later** | Deliberate, documented debt is legitimate; undocumented debt is not |
| **Security ↔ usability/performance** | Application-level encryption removes query capability (Module 17) |
| **Autonomy ↔ consistency of practice** | Team freedom versus a coherent platform |

### Step 3 — A worked example, using the payment platform from Q2

| Decision | Chosen | Rejected | Cost accepted | What would change my mind |
|---|---|---|---|---|
| Datastore | Relational (Aurora) | DynamoDB/Cassandra | Vertical write ceiling | Sustained > 20,000 TPS, or multi-region active-active writes |
| Consistency model | Strong for money, eventual for views | Eventual everywhere | Higher write latency; a regional write dependency | If the domain stopped involving money |
| Coordination | Orchestrated saga | 2PC / choreography | An orchestrator to build and operate | A single-service workflow with no external provider |
| Delivery semantics | At-least-once + idempotent consumers | Kafka transactions | Dedupe table on every consumer | If the whole flow lived inside Kafka |
| PCI scope | Tokenisation / hosted page | Store PANs | Less control over the payment UX | If we became the PSP ourselves |
| Deployment | Microservices | Modular monolith | Distributed debugging, eventual consistency | A team under ~15 engineers — I would start with a modular monolith |

**The last row is worth volunteering unprompted**, because it demonstrates that you are not applying microservices reflexively: for a small team, a **modular monolith with clean bounded contexts** ships faster, is far easier to operate, and can be decomposed later along boundaries you have actually validated. Saying so is a stronger signal than any amount of distributed-systems vocabulary.

### Step 4 — Frame the trade-offs in business terms

Interviewers at this level are assessing whether you can hold the conversation with a CTO or a risk committee, not only with engineers:

- **Cost:** "Multi-region active-active roughly doubles infrastructure spend. At our transaction volume that is £X/month to move from 21 minutes of expected annual downtime to 26 seconds. Given our regulatory commitment is 99.95%, I recommend warm standby and I would revisit if the licence condition tightened."
- **Risk:** "This design accepts up to one second of data loss on regional failover. Client-side idempotency keys make that window recoverable through retry, so the residual risk is a small number of transactions requiring reconciliation rather than lost money."
- **Time to market:** "Full event sourcing adds roughly a quarter to the delivery timeline. I would ship CQRS with a conventional write model first, because the audit requirement is satisfied by the append-only audit log, and event-source the ledger only if temporal queries become a genuine requirement."

### Step 5 — Close with what you would monitor to know you were wrong

The final mark of seniority: **name the signal that would tell you the decision has expired.**

- Write latency p99 approaching the database's ceiling → time to revisit partitioning or the datastore.
- Consumer lag persistently rising at peak → partition count or consumer scaling is now the constraint.
- More than one service changing per typical feature → the service boundaries are wrong (Q19).
- Reconciliation breaks trending upward → an integration assumption has broken.
- Change failure rate rising → the deployment safety net is no longer adequate.

**An architecture is a set of bets under stated constraints.** Naming the bets, the constraints, and the metrics that would falsify them is the answer — not claiming the design has no downside.

---

## References — official documentation and standards

| Topic | Source |
|---|---|
| **ByteByteGo / Alex Xu — *System Design Interview* (the canonical 4-step interview framework this module follows)** | https://bytebytego.com/ |
| **GeeksforGeeks — System Design Tutorial** (the 7-part breakdown reconciled into the spine above) | https://www.geeksforgeeks.org/system-design/system-design-tutorial/ |
| **System Design School — What Is a System Design Interview** (requirements → estimation → architecture → deep dive → trade-offs) | https://systemdesignschool.io/fundamentals/what-is-system-design-interview |
| **AWS Well-Architected Framework (all six pillars)** | https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html |
| AWS Well-Architected — Reliability pillar (availability targets, dependency math) | https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html |
| AWS — Disaster recovery options in the cloud (the four strategies) | https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html |
| AWS Aurora Global Database | https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database.html |
| AWS DynamoDB Global Tables | https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html |
| AWS Route 53 — routing policies and health checks | https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html |
| AWS API Gateway — throttling, quotas and limits | https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html |
| AWS KMS — multi-Region keys | https://docs.aws.amazon.com/kms/latest/developerguide/multi-region-keys-overview.html |
| AWS S3 — Cross-Region Replication | https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html |
| AWS Step Functions — durable workflow orchestration | https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html |
| AWS MSK — replication and MirrorMaker 2 | https://docs.aws.amazon.com/msk/latest/developerguide/what-is-msk.html |
| AWS builders' library — timeouts, retries and backoff with jitter | https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/ |
| AWS builders' library — using load shedding to avoid overload | https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/ |
| **Apache Kafka documentation (producer/consumer configs, transactions)** | https://kafka.apache.org/documentation/ |
| Confluent — Schema Registry compatibility types | https://docs.confluent.io/platform/current/schema-registry/fundamentals/avro.html |
| **Kubernetes — configure liveness, readiness and startup probes** | https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/ |
| Kubernetes — resource requests and limits / QoS classes | https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/ |
| Kubernetes — Pod Disruption Budgets | https://kubernetes.io/docs/concepts/workloads/pods/disruptions/ |
| Kubernetes — pod topology spread constraints | https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/ |
| Amazon EKS — IAM roles for service accounts (IRSA) / Pod Identity | https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html |
| Istio — mutual TLS and AuthorizationPolicy | https://istio.io/latest/docs/concepts/security/ |
| SPIFFE — workload identity specification | https://spiffe.io/docs/latest/spiffe-about/overview/ |
| **Microsoft Learn — Azure Architecture Center, cloud design patterns** | https://learn.microsoft.com/en-us/azure/architecture/patterns/ |
| Microsoft Learn — Saga distributed transactions pattern | https://learn.microsoft.com/en-us/azure/architecture/reference-architectures/saga/saga |
| Microsoft Learn — CQRS pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs |
| Microsoft Learn — Event Sourcing pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing |
| Microsoft Learn — Transactional Outbox / publisher pattern | https://learn.microsoft.com/en-us/azure/architecture/best-practices/transactional-outbox-cosmos |
| Microsoft Learn — Backends for Frontends pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends |
| Microsoft Learn — Circuit Breaker and Retry patterns | https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker |
| Microsoft Learn — `Microsoft.Extensions.Http.Resilience` | https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience |
| Microsoft Learn — .NET resilience with Polly | https://learn.microsoft.com/en-us/dotnet/core/resilience/ |
| Microsoft Learn — ASP.NET Core health checks | https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks |
| Pact — consumer-driven contract testing | https://docs.pact.io/ |
| RFC 8693 — OAuth 2.0 Token Exchange | https://www.rfc-editor.org/rfc/rfc8693 |
| RFC 9110 — HTTP Semantics (idempotency, status codes) | https://www.rfc-editor.org/rfc/rfc9110 |
| RFC 8594 / RFC 9745 — Sunset and Deprecation HTTP headers | https://www.rfc-editor.org/rfc/rfc8594 |
| W3C — Trace Context (`traceparent`) | https://www.w3.org/TR/trace-context/ |
| OpenTelemetry — specification and semantic conventions | https://opentelemetry.io/docs/specs/otel/ |
| PCI DSS document library (scope reduction, tokenisation) | https://www.pcisecuritystandards.org/document_library/ |
| ISO 20022 — financial messaging standard | https://www.iso20022.org/ |

---

**Previous:** [17 — Database / Data Security](./17-Database-Data-Security.md) | **Next:** [19 — AI / RAG](./19-AI-RAG.md)
