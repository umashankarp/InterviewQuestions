(function (r) {
registerTopic('36-saga', {
related: ['37-outbox', '18-event-driven-architecture', '17-microservices'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['fundamentals'],
  code: r`~~~csharp
// A saga = sequence of local transactions, each with a compensation, driven by messages
public sealed record SagaStep(string Name, Func<OrderSaga, Task> Execute, Func<OrderSaga, Task>? Compensate);
var steps = new[]
{
    new SagaStep("ReserveStock",  s => inventory.ReserveAsync(s.OrderId, s.Lines), s => inventory.ReleaseAsync(s.OrderId)),
    new SagaStep("ChargeCard",    s => payments.ChargeAsync(s.OrderId, s.Total),   s => payments.RefundAsync(s.OrderId)),
    new SagaStep("ConfirmOrder",  s => orders.ConfirmAsync(s.OrderId),             null)   // last step: no compensation
};
~~~`,
  q: r`What is the Saga pattern and what problem does it solve?`,
  a: r`A saga is a sequence of **local transactions**, one per service, where each step commits on its own and publishes an event or command that triggers the next step. If a step fails, the saga runs **compensating transactions** for the steps that already committed.

It exists because in a microservices system each service owns its database, so a single ACID transaction cannot span "create order, reserve stock, charge card". Two-phase commit across services is possible in theory but couples availability, holds locks across network calls, and is unsupported by most cloud databases and brokers.

The price: a saga gives **atomicity by compensation, not isolation**. Between step 1 and step 3, other requests can see the intermediate state.`,
  pts: [r`Local ACID transactions per service, coordinated by messages`, r`Failure is handled by compensation, not rollback`, r`Trades isolation (the I in ACID) for availability and autonomy`, r`Result is eventual consistency`],
  ex: r`An e-commerce checkout: Order service creates the order as {{PENDING}}, Inventory reserves stock, Payment charges the card, then Order moves to {{CONFIRMED}}. If Payment declines, Inventory releases the reservation and Order moves to {{CANCELLED}}.`,
  fu: [r`Why not just use 2PC / distributed transactions (MSDTC)?`, r`What does a saga give up compared with an ACID transaction?`],
  pit: [r`Calling it "distributed rollback". There is no rollback; committed work is semantically undone by new transactions.`],
  tip: r`Lead with "atomicity by compensation, no isolation". That sentence shows you know the real cost.` },

{ id: 'q2', level: 'Basic', tags: ['fundamentals'],
  code: r`~~~csharp
// 2PC across services would look like this, and it is exactly what you cannot rely on:
using var scope = new TransactionScope(TransactionScopeAsyncFlowOption.Enabled);   // escalates to a distributed transaction
await ordersDb.SaveAsync(order);      // SQL Server
await paymentsApi.ChargeAsync(...);   // HTTP call: cannot enlist in the transaction at all
await kafka.ProduceAsync(...);        // Kafka: no XA participation
scope.Complete();
// Locks held across network calls, a coordinator that can block everyone, and most cloud services/brokers do not support XA
~~~`,
  q: r`Why can you not simply use a distributed transaction (2PC) across microservices?`,
  a: r`Two-phase commit needs every participant to support a prepare/commit protocol and to **hold locks while waiting for the coordinator**. In practice:

- **Availability**: the transaction is available only if all participants and the coordinator are. Availability multiplies down (three 99.9% services give about 99.7%).
- **Locks across network hops**: a slow or crashed coordinator leaves participants in doubt, holding row locks and blocking unrelated work.
- **Heterogeneity**: Kafka, DynamoDB, most SaaS APIs (Stripe, a card network) do not take part in XA at all.
- **Autonomy**: it re-couples deployment and scaling of services you split to decouple.

Sagas accept temporary inconsistency in exchange for each service staying independently available.`,
  pts: [r`2PC blocks while in doubt`, r`Third-party APIs cannot join an XA transaction`, r`Availability is the product of all participants`, r`Saga trades locks for compensation logic`],
  ex: r`A payments platform must debit a ledger it owns and call an external card processor. The processor cannot enlist in 2PC, so the only option is a saga: record intent, call the processor with an idempotency key, then confirm or compensate.`,
  fu: [r`Where is 2PC still reasonable?`, r`What is the "in-doubt" state and how long can it last?`],
  pit: [r`Saying 2PC is "slow". The deeper problems are blocking and lack of support.`],
  trade: r`2PC gives isolation and simple reasoning inside one trust and ops boundary (for example two SQL Server databases in one team). Across independently owned services, sagas win.` },

{ id: 'q3', level: 'Basic', tags: ['fundamentals', 'compensation'],
  code: r`~~~csharp
// Compensation is a new, forward business action, not an undo of history
public async Task CompensateChargeAsync(Guid orderId, CancellationToken ct)
{
    var charge = await _db.Charges.SingleAsync(c => c.OrderId == orderId, ct);
    if (charge.Status == ChargeStatus.Refunded) return;                              // idempotent
    await _psp.RefundAsync(charge.PspChargeId, charge.Amount, idempotencyKey: "refund-" + orderId, ct);
    charge.MarkRefunded();                                                          // the original charge stays in the ledger
    _db.Outbox.Add(OutboxMessage.From(new PaymentRefunded(orderId, charge.Amount)));
    await _db.SaveChangesAsync(ct);
}
~~~`,
  q: r`What is a compensating transaction? Is it the same as a rollback?`,
  a: r`A compensating transaction is a **new, forward-moving business operation** that semantically reverses an earlier committed one: refund a charge, release a reservation, cancel an order.

It is not a rollback. A rollback erases the effect as if it never happened; a compensation leaves history in place (the charge and the refund both exist on the statement) and may not restore the exact prior state (a refund does not un-send the "payment received" email).

Rules for good compensations:

- **Idempotent**: it may be delivered more than once.
- **Commutative-tolerant**: it may arrive before the action it compensates (out-of-order delivery), so it must record "cancelled" and make the late action a no-op.
- **Retried until it succeeds**: compensations must not fail permanently; if they can, you need a human-handled path.`,
  pts: [r`Forward operation, not undo`, r`Must be idempotent and retryable`, r`Must tolerate arriving before the original action`, r`Some effects cannot be compensated (email sent, goods shipped)`],
  ex: r`Payment captured then shipping fails: compensation is a refund through the processor with the same business key, not deleting the payment row. Finance sees both entries and reconciles.`,
  fu: [r`What do you do when a compensation itself keeps failing?`, r`Give an action that cannot be compensated.`],
  pit: [r`Writing compensations that delete data and so destroy the audit trail.`],
  tip: r`Mention the "compensation arrives before the action" race. It is the detail most candidates miss.` },

{ id: 'q4', level: 'Basic', tags: ['choreography', 'orchestration'],
  code: r`~~~csharp
// Choreography: each service reacts to events and emits its own
public sealed class StockReservedConsumer(IPaymentService payments) : IConsumer<StockReserved>
{ public Task Consume(ConsumeContext<StockReserved> ctx) => payments.ChargeAsync(ctx.Message.OrderId, ctx.Message.Total); }

// Orchestration: one state machine sends commands and decides the next step
public sealed class OrderStateMachine : MassTransitStateMachine<OrderState>
{
    public State Reserving { get; private set; } = null!; public State Charging { get; private set; } = null!;
    public Event<OrderSubmitted> Submitted { get; private set; } = null!; public Event<StockReserved> Reserved { get; private set; } = null!;
    public OrderStateMachine()
    {
        InstanceState(x => x.CurrentState);
        Initially(When(Submitted).Send(c => new ReserveStock(c.Saga.CorrelationId, c.Message.Lines)).TransitionTo(Reserving));
        During(Reserving, When(Reserved).Send(c => new ChargeCard(c.Saga.CorrelationId, c.Saga.Total)).TransitionTo(Charging));
    }
}
~~~`,
  q: r`Explain choreography versus orchestration in sagas.`,
  a: r`**Choreography**: no central coordinator. Each service reacts to events and emits its own. Order emits {{OrderCreated}}, Inventory reacts and emits {{StockReserved}}, Payment reacts, and so on.

**Orchestration**: a dedicated orchestrator (a state machine) tells each participant what to do with commands and reacts to their replies. The flow is written down in one place.

~~~mermaid
flowchart LR
  subgraph Choreography
    O1[Order] -- OrderCreated --> I1[Inventory]
    I1 -- StockReserved --> P1[Payment]
    P1 -- PaymentTaken --> O1
  end
  subgraph Orchestration
    Orc[Orchestrator] -- ReserveStock --> I2[Inventory]
    Orc -- TakePayment --> P2[Payment]
    Orc -- ConfirmOrder --> O2[Order]
    I2 -. reply .-> Orc
    P2 -. reply .-> Orc
  end
~~~

| | Choreography | Orchestration |
|---|---|---|
| Coupling | Low, via events | Participants coupled to the orchestrator's commands |
| Visibility | Flow is implicit, hard to see | Flow is explicit, one place |
| Cyclic dependencies | Easy to create | Avoided |
| Best for | 2-4 steps, stable flow | 5+ steps, branching, timeouts |`,
  pts: [r`Choreography = events, orchestration = commands`, r`Choreography hides the workflow`, r`Orchestrator must itself be highly available and persistent`, r`Choose per saga, not per company`],
  ex: r`Checkout (reserve, charge, ship, notify, loyalty points) starts as choreography. At step 5 nobody can say what happens when loyalty fails after shipping, so the team moves to an orchestrator.`,
  fu: [r`Is the orchestrator a single point of failure?`, r`Which is easier to test and to debug in production?`],
  pit: [r`Letting the orchestrator become a god service holding business rules that belong to participants.`],
  trade: r`Choreography maximises autonomy but makes the end-to-end flow emergent. Orchestration makes it explicit at the cost of a central component to build, run and version.` },

{ id: 'q5', level: 'Basic', tags: ['consistency'],
  code: r`~~~text
Time   Orders          Inventory        Payments        What a reader sees
t0     PENDING         -                -               "order received"
t1     PENDING         RESERVED         -               stock shows 1 fewer
t2     PENDING         RESERVED         CHARGE FAILED   intermediate state visible to others (no isolation)
t3     CANCELLED       RELEASED         -               eventually consistent again
~~~`,
  q: r`What consistency model does a saga provide?`,
  a: r`**Eventual consistency**, with ACD but not I. Atomicity is achieved by compensation (all steps eventually complete or are compensated), consistency by each local transaction preserving its own invariants, and durability by local commits. **Isolation is missing**: concurrent transactions can read the saga's intermediate data.

This matters because a saga can take seconds to hours. Readers may see an order that is {{PENDING}}, stock that is reserved but may be released, or money that is held but not captured. The design must make those states explicit and safe to observe.`,
  pts: [r`ACD, not ACID`, r`Intermediate states are visible`, r`Model them as explicit statuses (PENDING, RESERVED)`, r`Time-bounded: a saga must reach a terminal state`],
  ex: r`A customer sees "Order placed, awaiting payment confirmation" for a few seconds. That status is the honest representation of the saga's intermediate state.`,
  fu: [r`What anomalies does the lack of isolation cause?`, r`How do you tell users about in-flight state?`],
  pit: [r`Pretending the intermediate state does not exist and exposing a half-finished order as CONFIRMED.`] },

{ id: 'q6', level: 'Basic', tags: ['fundamentals'],
  code: r`~~~csharp
public sealed class OrderState : SagaStateMachineInstance
{
    public Guid CorrelationId { get; set; }
    public string CurrentState { get; set; } = "";
    public decimal Total { get; set; }
    public string? PaymentId { get; set; }
    public int Version { get; set; }                 // optimistic concurrency on the saga row
}
// failure path in the state machine
During(Charging,
    When(PaymentFailed).Send(c => new ReleaseStock(c.Saga.CorrelationId)).TransitionTo(Releasing),
    When(PaymentSucceeded).Send(c => new ConfirmOrder(c.Saga.CorrelationId)).TransitionTo(Completed));
During(Releasing, When(StockReleased).Publish(c => new OrderCancelled(c.Saga.CorrelationId, "payment failed")).Finalize());
~~~`,
  q: r`Walk through a simple order saga, including the failure path.`,
  a: r`Happy path: Order created (PENDING) → Inventory reserves → Payment captures → Order CONFIRMED.

Failure path: Payment is declined → orchestrator sends {{ReleaseStock}} → Inventory releases → Order set to CANCELLED with a reason.

~~~mermaid
sequenceDiagram
  participant O as Orchestrator
  participant I as Inventory
  participant P as Payment
  participant S as Order
  O->>S: CreateOrder (PENDING)
  O->>I: ReserveStock
  I-->>O: StockReserved
  O->>P: ChargeCard
  P-->>O: PaymentDeclined
  O->>I: ReleaseStock (compensation)
  I-->>O: StockReleased
  O->>S: CancelOrder
~~~

Note the order of steps: put the step most likely to fail or hardest to undo **last** (or reorder so cheap, reversible steps go first).`,
  pts: [r`Compensations run in reverse order of completed steps`, r`Failed step itself does not need compensation (if it was atomic)`, r`Order steps so reversible ones go first`],
  ex: r`Reserving stock is cheap to undo; charging a card creates a bank-visible side effect. Reserve first, charge second.`,
  fu: [r`What if ReleaseStock fails?`, r`What if the Payment reply is lost but the charge succeeded?`],
  pit: [r`Compensating the failed step as if it had succeeded, which can refund money never taken.`] },

{ id: 'q7', level: 'Intermediate', tags: ['reliability'],
  code: r`~~~csharp
public sealed class ReserveStockConsumer(InventoryDb db) : IConsumer<ReserveStock>
{
    public async Task Consume(ConsumeContext<ReserveStock> ctx)
    {
        if (await db.Processed.AnyAsync(p => p.MessageId == ctx.MessageId)) return;       // duplicate delivery
        await using var tx = await db.Database.BeginTransactionAsync();
        db.Processed.Add(new ProcessedMessage(ctx.MessageId!.Value));                    // unique key = inbox
        await db.Reservations.AddAsync(new Reservation(ctx.Message.OrderId, ctx.Message.Lines));
        await db.SaveChangesAsync(); await tx.CommitAsync();
        await ctx.Publish(new StockReserved(ctx.Message.OrderId));                         // with outbox enabled
    }
}
~~~`,
  q: r`Why must every saga participant be idempotent?`,
  a: r`Messaging is at-least-once: brokers redeliver, consumers crash after doing the work but before acknowledging, and orchestrators retry on timeout. So every command and event **will** be delivered more than once eventually.

Without idempotency a redelivered {{ChargeCard}} double-charges. The standard fixes:

- A **natural idempotency key** (saga id plus step name) stored with a unique constraint; a duplicate insert means "already done, return the previous result".
- An **inbox table**: record the message id and the business change in the same local transaction.
- Pass the key to downstream providers (for example the {{Idempotency-Key}} header on Stripe).`,
  pts: [r`At-least-once delivery is the baseline`, r`Dedupe in the same transaction as the side effect`, r`Return the original result for duplicates, do not error`, r`Propagate keys to external providers`],
  ex: r`~~~csharp
public async Task Handle(ChargeCard cmd, CancellationToken ct)
{
    await using var tx = await _db.Database.BeginTransactionAsync(ct);
    if (await _db.Processed.AnyAsync(p => p.MessageId == cmd.MessageId, ct))
        return; // duplicate: already handled
    var charge = await _gateway.ChargeAsync(cmd.Amount, idempotencyKey: cmd.SagaId + ":charge", ct);
    _db.Payments.Add(new Payment(cmd.SagaId, charge.Id));
    _db.Processed.Add(new ProcessedMessage(cmd.MessageId));
    await _db.SaveChangesAsync(ct);
    await tx.CommitAsync(ct);
}
~~~`,
  fu: [r`What if the crash happens after the gateway call but before the commit?`, r`How long do you keep processed ids?`],
  pit: [r`Checking for duplicates in a separate transaction from the side effect, which leaves a race window.`] },

{ id: 'q8', level: 'Intermediate', tags: ['fundamentals'],
  code: r`~~~text
Step               Type          Why
ValidateOrder      compensable   cheap to undo (cancel draft)
ReserveStock       compensable   release reservation
AuthorizePayment   compensable   void the authorisation
-- CapturePayment  PIVOT         after this, the saga only moves forward
ScheduleShipment   retriable     must eventually succeed (retry, alert, manual queue)
SendConfirmation   retriable
~~~`,
  q: r`What are the typical saga step types: compensable, pivot and retriable?`,
  a: r`This classification (Richardson, *Microservices Patterns*) tells you where a saga can still go back and where it must go forward.

- **Compensable transactions**: can be undone by a compensation (reserve stock, create pending order).
- **Pivot transaction**: the go/no-go point. If it commits, the saga will run to completion; if it fails, the saga compensates. Often the card capture or the commitment that cannot be reversed.
- **Retriable transactions**: steps after the pivot. They must eventually succeed, so they are retried indefinitely (send confirmation, update loyalty points).

Design implication: after the pivot you do not compensate, you retry.`,
  pts: [r`Compensable → pivot → retriable`, r`Nothing irreversible before the pivot`, r`Retriable steps must be idempotent and eventually succeed`],
  ex: r`Booking: hold seat (compensable), capture payment (pivot), issue ticket and send email (retriable). If email fails after payment, retry the email; never refund because of an email outage.`,
  fu: [r`What if the pivot step has an unknown outcome (timeout)?`],
  pit: [r`Putting an irreversible step before the pivot, which forces an ugly manual compensation.`] },

{ id: 'q9', level: 'Intermediate', tags: ['tools'],
  code: r`~~~csharp
// MassTransit saga with EF Core persistence and the transactional outbox
builder.Services.AddMassTransit(x =>
{
    x.AddSagaStateMachine<OrderStateMachine, OrderState>()
     .EntityFrameworkRepository(r => { r.ConcurrencyMode = ConcurrencyMode.Optimistic; r.ExistingDbContext<OrdersDb>(); });
    x.AddEntityFrameworkOutbox<OrdersDb>(o => { o.UseSqlServer(); o.UseBusOutbox(); });
    x.UsingAzureServiceBus((ctx, cfg) => { cfg.Host(cs); cfg.ConfigureEndpoints(ctx); });
});
~~~
~~~json
{ "Comment": "AWS Step Functions alternative: Catch routes failures to compensation states",
  "StartAt": "ReserveStock",
  "States": {
    "ReserveStock": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke", "Parameters": { "FunctionName": "reserve" }, "Next": "Charge",
      "Catch": [ { "ErrorEquals": ["States.ALL"], "Next": "Fail" } ] },
    "Charge": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke", "Parameters": { "FunctionName": "charge" }, "Next": "Done",
      "Catch": [ { "ErrorEquals": ["States.ALL"], "Next": "ReleaseStock" } ] },
    "ReleaseStock": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke", "Parameters": { "FunctionName": "release" }, "Next": "Fail" },
    "Done": { "Type": "Succeed" }, "Fail": { "Type": "Fail" } } }
~~~`,
  q: r`What tools and libraries implement sagas in the .NET and AWS ecosystems?`,
  a: r`- **MassTransit** state machines (Automatonymous): orchestrated sagas with a persisted instance (EF Core, MongoDB, Redis), correlation by id, timeouts via scheduling.
- **NServiceBus** sagas: mature, commercial, with timeouts and saga persistence.
- **Wolverine / Rebus**: lighter alternatives with saga support.
- **Dapr Workflow** and **Temporal / Durable Task Framework (Azure Durable Functions)**: code-first durable workflows where the framework persists progress and replays.
- **AWS Step Functions**: managed state machine; use {{Catch}} and {{Retry}} to build compensation branches.

Choose on persistence guarantees, observability, team skill and operational cost, not on logo.`,
  pts: [r`Persisted saga state is the common denominator`, r`Durable-execution engines replay code, so code must be deterministic`, r`Managed (Step Functions) reduces ops, increases lock-in`],
  ex: r`A team on AWS with mostly Lambda services models checkout in Step Functions with a Catch on the payment task that routes to a ReleaseStock task.`,
  fu: [r`What does "deterministic workflow code" mean in Temporal / Durable Functions?`],
  pit: [r`Building a home-grown saga engine without persistence or timeouts.`] },

{ id: 'q10', level: 'Intermediate', tags: ['fundamentals'],
  q: r`What is a saga log or saga state, and why persist it?`,
  a: r`The saga **instance** records which step the saga is at, the data collected so far (reservation id, payment id), and the outcome of each step. It is persisted so that after a crash the saga **resumes** instead of vanishing.

A minimal record:

~~~csharp
public class CheckoutSaga : SagaStateMachineInstance
{
    public Guid CorrelationId { get; set; }
    public string CurrentState { get; set; } = default!;
    public Guid OrderId { get; set; }
    public string? ReservationId { get; set; }
    public string? PaymentId { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public int Version { get; set; } // optimistic concurrency
}
~~~

It also drives compensation (what to undo) and observability (where is order 123 stuck?).`,
  pts: [r`Persist state transitions atomically with outgoing messages`, r`Use optimistic concurrency on the instance`, r`Keep ids of created resources for compensation`],
  ex: r`Support asks "why is order 123 not confirmed?" The saga table shows state {{AwaitingPayment}} for 14 minutes and an expiry, which immediately explains and lets you act.`,
  fu: [r`What happens when two replies for the same saga arrive concurrently?`],
  pit: [r`Keeping saga state in memory only.`] },

{ id: 'q11', level: 'Intermediate', tags: ['timeouts'],
  code: r`~~~csharp
// MassTransit: schedule a timeout when entering a waiting state
Schedule(() => PaymentTimeout, x => x.PaymentTimeoutToken, s => s.Delay = TimeSpan.FromMinutes(15));
During(Charging,
    When(PaymentSucceeded).Unschedule(PaymentTimeout).TransitionTo(Confirming),
    When(PaymentTimeout.Received)
        .Send(c => new QueryPaymentStatus(c.Saga.CorrelationId))      // do not assume failure: ask
        .TransitionTo(VerifyingPayment));
~~~`,
  q: r`Why do sagas need timeouts?`,
  a: r`A participant may never reply: it crashed, the message was dead-lettered, or a downstream is down. Without a timeout the saga waits forever, holding reservations and leaving customers in limbo.

On timeout the saga must pick a defined action: retry the command, query the participant for status, or compensate. Timeouts are scheduled messages (MassTransit scheduler, NServiceBus timeouts, Step Functions {{TimeoutSeconds}}, Durable Functions timers) persisted with the saga.

Choose values from the latency percentiles of the step plus a business deadline, and **always** have the saga reach a terminal state.`,
  pts: [r`Timeouts are first-class saga events`, r`Query before compensating when the outcome is unknown`, r`Every saga ends in a terminal state`],
  ex: r`Payment reply missing after 30 s: the saga asks Payment "status of charge for saga X". Charged → continue. Not found → mark failed and compensate. Unknown → retry the query with backoff.`,
  fu: [r`Why not compensate immediately on timeout?`],
  pit: [r`Compensating on timeout while the original action later succeeds, leaving money taken and the order cancelled.`] },

{ id: 'q12', level: 'Intermediate', tags: ['orchestration', 'mass-transit'],
  q: r`Show a MassTransit state machine for an order saga with a compensation path.`,
  a: r`MassTransit correlates messages to a saga instance by {{CorrelationId}}, persists the instance (EF Core with optimistic concurrency), and publishes messages via the outbox.

~~~csharp
public class OrderStateMachine : MassTransitStateMachine<OrderState>
{
    public State Reserving { get; private set; } = default!;
    public State Charging  { get; private set; } = default!;
    public State Confirmed { get; private set; } = default!;
    public State Cancelled { get; private set; } = default!;

    public Event<OrderSubmitted> Submitted { get; private set; } = default!;
    public Event<StockReserved>  Reserved  { get; private set; } = default!;
    public Event<StockRejected>  Rejected  { get; private set; } = default!;
    public Event<PaymentTaken>   Paid      { get; private set; } = default!;
    public Event<PaymentDeclined> Declined { get; private set; } = default!;

    public OrderStateMachine()
    {
        InstanceState(x => x.CurrentState);
        Event(() => Submitted, e => e.CorrelateById(m => m.Message.OrderId));

        Initially(When(Submitted)
            .Then(c => c.Saga.OrderId = c.Message.OrderId)
            .Publish(c => new ReserveStock(c.Saga.CorrelationId, c.Message.Items))
            .TransitionTo(Reserving));

        During(Reserving,
            When(Reserved).Publish(c => new ChargeCard(c.Saga.CorrelationId, c.Saga.Amount)).TransitionTo(Charging),
            When(Rejected).TransitionTo(Cancelled));

        During(Charging,
            When(Paid).Publish(c => new ConfirmOrder(c.Saga.CorrelationId)).TransitionTo(Confirmed).Finalize(),
            When(Declined)
                .Publish(c => new ReleaseStock(c.Saga.CorrelationId))   // compensation
                .TransitionTo(Cancelled).Finalize());

        SetCompletedWhenFinalized();
    }
}
~~~`,
  pts: [r`Correlate by id`, r`Use the EF outbox so state and publish are atomic`, r`Compensation is a published command on the failure branch`, r`Finalize and clean up completed instances`],
  ex: r`In production, add {{Schedule}} for payment timeouts and a saga repository with {{ConcurrencyMode.Optimistic}} plus retry on {{DbUpdateConcurrencyException}}.`,
  fu: [r`What happens when Declined and a timeout fire together?`, r`How do you version a state machine with in-flight instances?`],
  pit: [r`Forgetting events that arrive in a state where they are not handled (they are silently dropped by default; configure {{DuringAny}} / fault handling).`] },

{ id: 'q13', level: 'Intermediate', tags: ['outbox', 'reliability'],
  code: r`~~~csharp
// Without the outbox: state saved, crash, command never sent -> saga stuck forever
await db.SaveChangesAsync(); await bus.Send(new ChargeCard(...));      // two separate writes: unsafe
// With the outbox: state change and outgoing message commit atomically, a relay delivers later
x.AddEntityFrameworkOutbox<OrdersDb>(o => { o.QueryDelay = TimeSpan.FromSeconds(1); o.UseBusOutbox(); });
~~~`,
  q: r`How does the transactional outbox relate to sagas, and why is it essential?`,
  a: r`Every saga step does two things: **change local state** and **send a message**. These are two systems (database and broker), so without care you get either a state change with no message (saga stalls) or a message with no state change (phantom step).

The outbox pattern writes the outgoing message to an {{Outbox}} table **in the same local transaction** as the state change. A relay (polling publisher or CDC such as Debezium) then publishes it at-least-once. Consumers dedupe with an inbox (see the idempotency question above).

Together: outbox gives reliable *sending*, inbox gives idempotent *receiving*, and the saga gives the *business flow*. See the Outbox topic for relay designs.`,
  pts: [r`Dual-write is the root problem`, r`Outbox + relay = at-least-once publish`, r`Inbox/idempotency = effectively-once processing`, r`MassTransit and NServiceBus ship outbox support`],
  ex: r`Payment service commits "payment row + PaymentTaken outbox row". The relay publishes later even if the service crashed right after commit.`,
  fu: [r`Polling publisher versus CDC: trade-offs?`, r`How do you keep the outbox table from growing without bound?`],
  pit: [r`Publishing to the broker inside the DB transaction and hoping the commit succeeds.`] },

{ id: 'q14', level: 'Intermediate', tags: ['isolation', 'anomalies'],
  code: r`~~~text
Anomaly            Saga example
Lost update        Saga A reserves item; saga B overwrites the same stock row with an older value
Dirty read         Credit check reads a limit already "spent" by a saga that later compensates
Fuzzy read         Report sums reservations, some of which are released a second later
Write skew         Two sagas each see 1 seat left, both reserve, both pass their local checks
~~~`,
  q: r`What anomalies appear because sagas lack isolation?`,
  a: r`Three classic ones:

- **Lost updates**: saga A overwrites a change made by saga B without reading it. Example: A cancels an order after B already modified its delivery address; the cancel uses a stale copy.
- **Dirty reads**: a saga reads data that another saga will later compensate. Example: a credit-limit check sees a reservation that is then rolled back, so it wrongly rejects (or wrongly accepts).
- **Non-repeatable (fuzzy) reads**: two reads in the same saga return different values because another saga changed it between them.

These are the same anomalies as weak database isolation, but they last for the duration of the saga rather than milliseconds, so they actually happen.`,
  pts: [r`Lost update, dirty read, fuzzy read`, r`Window is as long as the saga`, r`Countermeasures exist (see next question)`],
  ex: r`Two checkouts for the last unit of an item: both read "1 in stock" unless the reservation step atomically decrements with a condition.`,
  fu: [r`Which anomaly is most dangerous in payments?`],
  pit: [r`Assuming the broker ordering gives isolation. It does not.`] },

{ id: 'q15', level: 'Intermediate', tags: ['isolation', 'countermeasures'],
  code: r`~~~csharp
// Semantic lock: a status flag that other sagas respect
public void Reserve(Guid sagaId)
{
    if (Status == SeatStatus.PendingReservation && HeldBy != sagaId) throw new SeatBusyException();   // others wait/fail
    Status = SeatStatus.PendingReservation; HeldBy = sagaId; HeldUntil = DateTimeOffset.UtcNow.AddMinutes(10);
}
// Commutative update: increments/decrements instead of setting absolute values
await db.Database.ExecuteSqlInterpolatedAsync(
    FormattableStringFactory.Create("UPDATE Stock SET Reserved = Reserved + {0} WHERE Sku = {1} AND Available - Reserved >= {0}", qty, sku));
~~~`,
  q: r`List the countermeasures for the lack of isolation.`,
  a: r`From Richardson / the original saga literature:

| Countermeasure | Idea |
|---|---|
| **Semantic lock** | App-level flag on a record (e.g. {{PENDING}}) that blocks or warns other transactions until the saga ends |
| **Commutative updates** | Design operations so order does not matter (debit/credit rather than set balance) |
| **Pessimistic view** | Reorder steps so dangerous dirty reads cannot occur (do increases of risk last) |
| **Reread value** | Re-read and compare before overwriting (optimistic locking with a version) |
| **Version file** | Record operations and apply them in the correct order when they arrive out of order |
| **By value** | Choose concurrency mechanism by business risk: low risk → saga, high risk → distributed transaction or single store |

The most common in practice: **semantic locks** (statuses) and **versioned reads** (optimistic concurrency).`,
  pts: [r`Semantic lock = status field that other flows respect`, r`Commutative operations remove ordering problems`, r`Optimistic version checks stop lost updates`, r`Pick by business risk`],
  ex: r`An {{Account.Status = AwaitingFunds}} semantic lock stops a second withdrawal saga from starting until the first completes or expires.`,
  fu: [r`What happens if the semantic lock holder crashes? (Expiry and a sweeper.)`],
  pit: [r`Semantic locks without expiry cause permanent stuck records.`] },

{ id: 'q16', level: 'Intermediate', tags: ['failure-handling'],
  code: r`~~~csharp
// Compensations retry with backoff, then park for humans; they must never be silently dropped
cfg.ReceiveEndpoint("refund-payment", e =>
{
    e.UseMessageRetry(r => r.Exponential(10, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(10), TimeSpan.FromSeconds(5)));
    e.UseDelayedRedelivery(r => r.Intervals(TimeSpan.FromMinutes(30), TimeSpan.FromHours(2), TimeSpan.FromHours(12)));
    e.ConfigureConsumer<RefundPaymentConsumer>(ctx);   // after all retries: _error queue -> alert -> ops runbook
});
~~~`,
  q: r`What happens when a compensation itself fails?`,
  a: r`Compensations must be built to **eventually succeed**, so the answer is layered:

1. **Retry** with exponential backoff and jitter (the compensation is idempotent, so retries are safe).
2. **Dead-letter** after N attempts, with an alert, keeping the saga in a {{CompensationFailed}} state (not silently dropped).
3. **Manual intervention queue**: an operator tool shows the saga, its data, and a "retry / force complete / escalate" action. Regulated businesses (banks) require this audit trail.
4. **Reconciliation**: a periodic job compares saga states with downstream truth (for example processor settlement files) and flags breaks.

Never let a failed compensation disappear.`,
  pts: [r`Compensations are retried, not abandoned`, r`DLQ + alert + operator tooling`, r`Reconciliation as the safety net`],
  ex: r`Refund call to the processor times out for 3 hours during their outage. Retries with backoff succeed afterward; the saga stays visible as "compensating" in the support console meanwhile.`,
  fu: [r`How would you test the stuck-compensation path?`],
  pit: [r`Treating the DLQ as a trash can nobody reads.`] },

{ id: 'q17', level: 'Intermediate', tags: ['choreography'],
  code: r`~~~text
Choreography failure modes and what reveals them
- Cyclic events (A -> B -> A)                     trace graph shows a loop; add correlation + hop count
- Nobody owns "is order 981 done?"                no single state store; build a saga-status projection
- Event renamed by one team breaks a consumer     schema registry compatibility check in CI
- Lost event (no outbox)                          reconciliation job finds orders stuck > 15 min
~~~`,
  q: r`What are the failure modes of a choreographed saga?`,
  a: r`- **Hidden flow / cyclic dependencies**: services subscribe to each other's events and nobody owns the end-to-end process.
- **No place for timeouts**: no component notices that "PaymentTaken never arrived".
- **Hard to change**: adding a step means touching several services' subscriptions.
- **Poor observability**: reconstructing one order needs correlating logs across services.
- **Compensation sprawl**: each service must know which events mean "undo".

Mitigations: a mandatory {{correlationId}}, an event catalogue (AsyncAPI), distributed tracing, a **process monitor** that listens to all events and flags overdue sagas, and a rule that choreography is limited to short flows.`,
  pts: [r`Add a passive process monitor`, r`Cap choreography at a few steps`, r`Correlation id everywhere`],
  ex: r`A passive "Order Timeline" service consumes all order events and raises an alert when an order has no terminal event after 10 minutes.`,
  fu: [r`Is a process monitor an orchestrator?`],
  pit: [r`Letting event names encode the next step ("PleaseChargeCard"), which turns events into hidden commands.`] },

{ id: 'q18', level: 'Intermediate', tags: ['orchestration'],
  code: r`~~~csharp
// Keep the orchestrator thin: it decides the next step, services own the business rules
During(Reserving, When(Reserved).Send(c => new ChargeCard(c.Saga.CorrelationId, c.Saga.Total)).TransitionTo(Charging));
// Not this: pricing, tax, or fraud rules inside the orchestrator (it becomes a god service)
// Run it HA: persisted state + optimistic concurrency + multiple instances; version the state machine explicitly
~~~`,
  q: r`What are the risks of orchestration and how do you contain them?`,
  a: r`- **Orchestrator becomes a god service** that absorbs business rules. Keep it to sequencing, state and timeouts; participants own decisions about their data.
- **Single point of failure / bottleneck**: run it stateless over a durable store, scale horizontally, partition by saga id.
- **Coupling**: participants know orchestrator command contracts. Version commands and replies.
- **Persistence is mandatory**: lose saga state and in-flight work is lost. Use replicated storage.
- **Ownership**: assign one team; avoid a "central workflow team" bottleneck by letting domain teams own their sagas.

Orchestrator per business process (checkout saga, refund saga), not one global orchestrator.`,
  pts: [r`Orchestrator coordinates, does not decide domain rules`, r`Stateless workers + durable store`, r`One orchestrator per process`],
  ex: r`Checkout orchestrator is owned by the Order team; it knows only the commands to Inventory, Payment and Shipping.`,
  fu: [r`How would you handle a very long-running (days) saga?`],
  pit: [r`A shared generic "workflow service" for the whole company.`] },

{ id: 'q19', level: 'Senior', tags: ['fundamentals'],
  code: r`~~~sql
-- Wrong tool #1: both "steps" live in one database owned by one team -> one local transaction
BEGIN TRAN;
  UPDATE inventory SET reserved = reserved + 1 WHERE sku = 'A';
  INSERT INTO orders (id, sku, status) VALUES (981, 'A', 'CONFIRMED');
COMMIT;
~~~`,
  q: r`Give three real situations where a saga is the wrong tool.`,
  a: r`1. **Everything fits in one database.** If the data lives in one service's database, use a normal ACID transaction. Splitting services to then need a saga is self-inflicted.
2. **Strong, immediate consistency is a hard requirement**, for example a ledger posting that must debit and credit atomically. Keep that inside one service (a double-entry ledger) and use sagas around it.
3. **The business cannot tolerate visible intermediate states or cannot define compensations**, for example irreversible actions with no semantic undo.

Often the better move is to **change the service boundary** so the consistent operation sits in one place.`,
  pts: [r`Fix the boundary before adding a saga`, r`Ledger postings stay atomic in one store`, r`No possible compensation means redesign`],
  ex: r`Debit account A / credit account B in the same bank ledger service is one SQL transaction. The saga is the transfer request flowing between channels and the ledger.`,
  fu: [r`How do you decide a service boundary to avoid a saga?`],
  pit: [r`Using sagas to paper over a wrong decomposition.`],
  tip: r`Saying "I would first question whether this needs a saga" signals seniority.` },

{ id: 'q20', level: 'Senior', tags: ['api', 'ux'],
  code: r`~~~http
POST /orders                    -> 202 Accepted
Location: /orders/o-981
{ "id": "o-981", "status": "PENDING", "next": "poll /orders/o-981 or wait for the order.confirmed webhook" }

GET /orders/o-981               -> 200 { "status": "CONFIRMED" }   or   { "status": "CANCELLED", "reason": "payment_declined" }
~~~`,
  q: r`How should the API respond when the operation is a saga that has not finished?`,
  a: r`Do not hold the HTTP request open. Return **202 Accepted** with a status resource, then let clients poll, subscribe, or be called back.

~~~
POST /orders            -> 202 Accepted
Location: /orders/9f1c/status
Retry-After: 2

GET /orders/9f1c/status -> 200 { "state": "AWAITING_PAYMENT", "failureReason": null }
~~~

Options: polling with {{Retry-After}}, server-sent events or WebSocket push, or a webhook for B2B callers. Require an {{Idempotency-Key}} header on the POST so client retries do not create duplicate sagas. The status model should expose business states (not internal ones) and a clear terminal outcome.`,
  pts: [r`202 + status resource`, r`Idempotency-Key on creation`, r`Expose terminal states and reasons`],
  ex: r`Mobile app shows "Processing payment…" then flips to success via a push notification while the status endpoint remains the source of truth.`,
  fu: [r`Why not return 200 with PENDING?`, r`How long do you keep status resources?`],
  pit: [r`Synchronously waiting for the saga inside the request, which ties request timeouts to business flow.`] },

{ id: 'q21', level: 'Senior', tags: ['aws', 'step-functions'],
  q: r`Model a compensating saga in AWS Step Functions.`,
  a: r`Use a state machine where each forward {{Task}} has a {{Catch}} that routes to a compensation chain.

~~~json
{
  "StartAt": "ReserveStock",
  "States": {
    "ReserveStock": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": { "FunctionName": "reserve-stock", "Payload.$": "$" },
      "Retry": [{ "ErrorEquals": ["States.TaskFailed"], "IntervalSeconds": 2, "MaxAttempts": 3, "BackoffRate": 2 }],
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "Failed" }],
      "Next": "ChargeCard" },
    "ChargeCard": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": { "FunctionName": "charge-card", "Payload.$": "$" },
      "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "ReleaseStock" }],
      "Next": "Confirm" },
    "ReleaseStock": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": { "FunctionName": "release-stock", "Payload.$": "$" }, "Next": "Failed" },
    "Confirm": { "Type": "Succeed" },
    "Failed":  { "Type": "Fail" }
  }
}
~~~

Standard workflows give exactly-once state transitions and up to a year of duration; task side effects are still at-least-once, so Lambdas must be idempotent. Express workflows are cheaper but at-least-once overall.`,
  pts: [r`Retry for transient, Catch for business failure`, r`Standard vs Express semantics`, r`Lambdas still need idempotency`],
  ex: r`Use {{.waitForTaskToken}} for a step that needs a human or a slow external callback.`,
  fu: [r`Cost model of Standard vs Express?`],
  pit: [r`Assuming "exactly-once" in Standard covers the side effects inside the Lambdas.`] },

{ id: 'q22', level: 'Senior', tags: ['observability'],
  code: r`~~~csharp
// One trace across every saga step: propagate W3C trace context through message headers (MassTransit does this)
builder.Services.AddOpenTelemetry().WithTracing(t => t.AddSource("MassTransit").AddAspNetCoreInstrumentation().AddOtlpExporter());
// Saga metrics: started, completed, compensated, age of oldest in-flight saga per state
var inFlight = meter.CreateObservableGauge("saga.inflight.oldest_seconds",
    () => db.OrderStates.Where(s => s.CurrentState != "Final").Min(s => (double?)(DateTime.UtcNow - s.CreatedUtc).TotalSeconds) ?? 0);
~~~`,
  q: r`How do you make sagas observable in production?`,
  a: r`- **Correlation id** (saga id) in every message header and log line; propagate W3C {{traceparent}} so one trace spans the whole flow.
- **State metrics**: count of sagas per state, time in state (histogram), and age of the oldest non-terminal saga. Alert on "stuck > SLA".
- **Business events** for terminal outcomes (completed, compensated, failed) feeding dashboards.
- **Saga search UI**: look up by order id and see the timeline and payload ids.
- **Dead-letter and retry-queue depth** alerts.

The single most useful alert: *"number of sagas older than X in a non-terminal state"*.`,
  pts: [r`Trace + correlation id`, r`Time-in-state histograms`, r`Alert on stuck sagas`],
  ex: r`Grafana panel "Checkout sagas by state" shows a growing {{AwaitingPayment}} bar when the processor degrades, before customers complain.`,
  fu: [r`How do you trace across an async broker hop?`],
  pit: [r`Only monitoring technical errors and not business-level stuck states.`] },

{ id: 'q23', level: 'Senior', tags: ['testing'],
  code: r`~~~csharp
[Fact]
public async Task Payment_failure_releases_stock_and_cancels()
{
    await using var provider = new ServiceCollection()
        .AddMassTransitTestHarness(x => x.AddSagaStateMachine<OrderStateMachine, OrderState>()).BuildServiceProvider(true);
    var harness = provider.GetRequiredService<ITestHarness>(); await harness.Start();
    var id = NewId.NextGuid();
    await harness.Bus.Publish(new OrderSubmitted(id, 100m));
    await harness.Bus.Publish(new StockReserved(id));
    await harness.Bus.Publish(new PaymentFailed(id, "declined"));
    (await harness.Sent.Any<ReleaseStock>(m => m.Context.Message.OrderId == id)).Should().BeTrue();
}
~~~`,
  q: r`How do you test a saga?`,
  a: r`- **Unit-test the state machine** with an in-memory harness (MassTransit test harness): send events, assert state and published commands.
- **Failure-path tests**: every step failing, every compensation failing once then succeeding, duplicates, reordering, and timeouts.
- **Contract tests** (Pact / schema registry) for command and event shapes between orchestrator and participants.
- **Property / model tests**: "for any interleaving of events the saga ends in a terminal state and total money is conserved".
- **Chaos / fault injection in staging**: kill participants mid-saga, drop and duplicate messages.
- **Time**: use a virtual clock for timeout tests.`,
  pts: [r`Test the unhappy paths first`, r`Duplicate and out-of-order delivery`, r`Invariants: terminal state reached, money conserved`],
  ex: r`~~~csharp
await harness.Bus.Publish(new OrderSubmitted(id, items));
Assert.True(await sagaHarness.Exists(id, x => x.Charging));
await harness.Bus.Publish(new PaymentDeclined(id));
Assert.True(await harness.Published.Any<ReleaseStock>());
~~~`,
  fu: [r`How do you test a saga version upgrade?`],
  pit: [r`Only testing the happy path.`] },

{ id: 'q24', level: 'Senior', tags: ['ordering'],
  code: r`~~~csharp
// Out-of-order: PaymentSucceeded arrives before StockReserved -> keep it, do not drop it
During(Reserving,
    When(PaymentSucceeded).Then(c => c.Saga.PaymentArrivedEarly = true),            // remember the fact
    When(Reserved).IfElse(c => c.Saga.PaymentArrivedEarly,
        x => x.Send(c => new ConfirmOrder(c.Saga.CorrelationId)).TransitionTo(Confirming),
        x => x.Send(c => new ChargeCard(c.Saga.CorrelationId, c.Saga.Total)).TransitionTo(Charging)));
// Duplicates: ignored by the state machine in states where the event is no longer expected
DuringAny(Ignore(Reserved));
~~~`,
  q: r`How do you handle out-of-order and duplicate messages in a saga?`,
  a: r`- **Duplicates**: idempotent handlers, inbox dedupe by message id (see the idempotency question). The saga ignores an event that is invalid for its current state, and logs it.
- **Reordering**: use per-saga ordering where the broker supports it (Kafka key = saga id; SQS FIFO message group id; Service Bus sessions). Where it is not guaranteed, make the state machine tolerant: handle {{Cancelled}} arriving before {{Reserved}} by recording "cancelled" and making the late event trigger the compensation.
- **Stale events**: carry a version or sequence number and discard older ones.

The principle: **the handler decides based on saga state plus event, never on arrival order alone**.`,
  pts: [r`Partition by saga id`, r`State-aware handlers`, r`Sequence numbers for stale data`],
  ex: r`ReleaseStock arrives before ReserveStock was processed. Inventory stores a tombstone for the saga id, so the later reserve becomes a no-op.`,
  fu: [r`What is the cost of using a single-partition key?`],
  pit: [r`Relying on a queue being FIFO "most of the time".`] },

{ id: 'q25', level: 'Senior', tags: ['data'],
  code: r`~~~csharp
// A read model built from saga events answers cross-service questions without distributed queries
public sealed class OrderStatusProjection(ReadDb db) : IConsumer<OrderSubmitted>, IConsumer<OrderConfirmed>, IConsumer<OrderCancelled>
{
    public Task Consume(ConsumeContext<OrderSubmitted> c) => db.Upsert(c.Message.OrderId, "PENDING", c.SentTime);
    public Task Consume(ConsumeContext<OrderConfirmed> c) => db.Upsert(c.Message.OrderId, "CONFIRMED", c.SentTime);
    public Task Consume(ConsumeContext<OrderCancelled> c) => db.Upsert(c.Message.OrderId, "CANCELLED", c.SentTime);
}   // Upsert ignores events older than the stored timestamp (out-of-order safety)
~~~`,
  q: r`How do sagas interact with reads and reporting (queries across services)?`,
  a: r`Sagas solve cross-service **writes**. Cross-service **reads** are a separate problem, usually solved with **API composition** (query several services and join in memory) or **CQRS read models** built from events.

Readers will observe saga intermediate states, so read models should carry the status (PENDING, CONFIRMED, CANCELLED) and screens should render it deliberately. Reports that need consistent totals should read from a read model updated by terminal events only, or filter to terminal states.

Keep sagas out of the query path: no saga should be needed to answer a read.`,
  pts: [r`Sagas = writes, CQRS/composition = reads`, r`Expose status in read models`, r`Reports use terminal states`],
  ex: r`The "My Orders" screen reads a read model fed by OrderConfirmed / OrderCancelled events and shows PENDING orders with a spinner.`,
  fu: [r`How would you avoid showing a cancelled order as confirmed for a moment?`],
  pit: [r`Calling the orchestrator to answer UI queries.`] },

{ id: 'q26', level: 'Senior', tags: ['payments', 'design'],
  code: r`~~~csharp
// Authorise -> (pivot) capture; idempotency key is stable per saga step; unknown outcomes are queried, never re-charged
var auth = await psp.AuthorizeAsync(new AuthRequest(orderId, amount), idempotencyKey: "auth-" + orderId, ct);
if (auth.Outcome == Outcome.Timeout)
    auth = await psp.GetAuthorizationAsync(reference: orderId, ct);                 // resolve, do not retry blindly
if (auth.Outcome == Outcome.Approved) await bus.Send(new ReserveStock(orderId), ct);
// compensation for a failed later step: void the authorisation (free) rather than refund a capture (fees)
~~~`,
  q: r`Design a card-payment saga that never double-charges and never loses money, with an external processor you cannot enlist in a transaction.`,
  a: r`### Principle
Record intent first, call the processor with an idempotency key derived from the saga, and treat the processor response as one of three outcomes: success, definite failure, **unknown**. Reconcile against the processor's settlement file as the final truth.

### Flow
1. Persist {{Payment(status=INITIATED, key=sagaId:charge)}} and an outbox row in one transaction.
2. Worker calls the processor with {{Idempotency-Key: sagaId:charge}}.
3. On success → {{CAPTURED}}, publish {{PaymentTaken}}. On definite decline → {{DECLINED}}. On timeout/5xx → stay {{UNKNOWN}} and **query the processor by the same key** with backoff.
4. Nightly: reconcile ledger vs. the processor file; classify breaks (auto-fixable, manual, investigate).

~~~mermaid
stateDiagram-v2
  [*] --> INITIATED
  INITIATED --> CAPTURED: processor OK
  INITIATED --> DECLINED: processor declined
  INITIATED --> UNKNOWN: timeout / 5xx
  UNKNOWN --> CAPTURED: status query says captured
  UNKNOWN --> DECLINED: status query says none
  CAPTURED --> REFUNDED: compensation
~~~

### What it cannot do
It cannot make the processor atomic with your ledger; the unknown state and reconciliation are the honest answer to that.`,
  pts: [r`Idempotency key derived from the saga, sent to the processor`, r`Explicit UNKNOWN state, resolved by status query`, r`Reconciliation against settlement files is mandatory`, r`Never compensate while outcome is unknown`],
  ex: r`Stripe-style integration: a timeout after the charge was created. The retry with the same {{Idempotency-Key}} returns the original charge instead of creating a second one.`,
  fu: [r`What if the processor does not support idempotency keys?`, r`How do you refund a captured payment when the refund call times out?`],
  pit: [r`Retrying a charge without a key.`, r`Treating a timeout as a failure and cancelling the order.`],
  trade: r`Querying status adds latency and complexity, but it is the only safe resolution for the unknown state.` },

{ id: 'q27', level: 'Senior', tags: ['timeouts', 'failure-handling'],
  code: r`~~~csharp
public enum StepOutcome { Succeeded, Failed, Unknown }
public async Task<StepOutcome> ResolveAsync(Guid orderId, CancellationToken ct)
{
    for (var attempt = 0; attempt < 5; attempt++)
    {
        var status = await _psp.QueryAsync(orderId.ToString(), ct);                 // provider is the source of truth
        if (status is not null) return status.Approved ? StepOutcome.Succeeded : StepOutcome.Failed;
        await Task.Delay(TimeSpan.FromSeconds(Math.Pow(2, attempt)), ct);
    }
    return StepOutcome.Unknown;                                                       // park: manual review + settlement-file reconciliation
}
~~~`,
  q: r`A step times out. Is the action done or not? How do you decide safely?`,
  a: r`You cannot know from the timeout alone: the request may have been lost, processed, or still in flight. The safe options all depend on **idempotency and a way to ask**:

- **Retry the same request with the same key**: safe if the participant is idempotent; it returns the original outcome.
- **Query status** by business key: if the participant exposes it.
- **Fence with a deadline**: tell the participant "this request is void after T"; after T you know no late execution will happen, then compensate.
- **Compensate defensively** only when the compensation is itself safe whether or not the action happened (for example "release reservation X if it exists").

Never take an irreversible decision based on silence.`,
  pts: [r`Timeout = unknown, not failure`, r`Retry with key, query, or fence with a deadline`, r`Compensations that are safe in both worlds`],
  ex: r`Inventory reserve times out. The orchestrator sends {{ReleaseStock(sagaId)}}; Inventory releases if a reservation exists, else records a tombstone so a late reserve is ignored.`,
  fu: [r`What is a tombstone and how long do you keep it?`],
  pit: [r`Starting the compensation while the original is still running and may complete after it.`] },

{ id: 'q28', level: 'Senior', tags: ['isolation', 'design'],
  q: r`Implement a semantic lock properly. What about expiry and deadlocks?`,
  a: r`A semantic lock is an application-level state on the aggregate that says "a saga owns this".

~~~sql
UPDATE Accounts
SET Status = 'LOCKED', LockedBySaga = @sagaId, LockExpiresAt = DATEADD(minute, 15, SYSUTCDATETIME())
WHERE Id = @id
  AND (Status = 'ACTIVE' OR LockExpiresAt < SYSUTCDATETIME());
-- rows affected = 0 => someone else holds it
~~~

Design points:

- Acquire with a **conditional update** so check-and-set is atomic.
- **Expiry** so a crashed saga cannot lock forever; a sweeper or the next acquirer reclaims it.
- **Release** in the completion and in the compensation path, checking {{LockedBySaga}} so a late release by an expired saga does not free someone else's lock.
- **Deadlock avoidance**: acquire locks in a global order, or fail fast and retry the whole saga, never wait indefinitely.
- Other flows decide per case: *reject*, *queue*, or *read allowed but write blocked*.`,
  pts: [r`Conditional update = atomic acquire`, r`Expiry + owner check on release`, r`Ordered acquisition or fail-fast`, r`Define behaviour for blocked readers`],
  ex: r`Two simultaneous transfers from one account: the second sees LOCKED and is queued or returns a "try again" business error.`,
  fu: [r`How is this different from a database row lock?`],
  pit: [r`Releasing without checking the owner (fencing token problem).`] },

{ id: 'q29', level: 'Senior', tags: ['orchestration', 'durable'],
  code: r`~~~csharp
// Durable execution (Temporal .NET SDK): the saga is ordinary code; the engine persists every step
[Workflow]
public class OrderWorkflow
{
    [WorkflowRun]
    public async Task RunAsync(Order o)
    {
        var compensations = new Stack<Func<Task>>();
        try
        {
            await Workflow.ExecuteActivityAsync((Activities a) => a.ReserveAsync(o), Opts); compensations.Push(() => Workflow.ExecuteActivityAsync((Activities a) => a.ReleaseAsync(o), Opts));
            await Workflow.ExecuteActivityAsync((Activities a) => a.ChargeAsync(o), Opts);  compensations.Push(() => Workflow.ExecuteActivityAsync((Activities a) => a.RefundAsync(o), Opts));
            await Workflow.ExecuteActivityAsync((Activities a) => a.ShipAsync(o), Opts);
        }
        catch { while (compensations.Count > 0) await compensations.Pop()(); throw; }
    }
    static readonly ActivityOptions Opts = new() { StartToCloseTimeout = TimeSpan.FromMinutes(1) };
}
~~~`,
  q: r`Compare MassTransit/NServiceBus state-machine sagas with durable-execution engines (Temporal, Durable Functions).`,
  a: r`| | State-machine sagas | Durable execution (Temporal / Durable Functions) |
|---|---|---|
| Model | Events and states, explicit transitions | Plain code (async/await); the engine records history and **replays** it |
| Persistence | Saga instance row | Event history per workflow |
| Timers / retries | Scheduler messages | Built in (timers, retry policies) |
| Determinism | Not required | Workflow code **must be deterministic** (no random, no wall clock, no direct I/O) |
| Readability for long flows | Gets tangled as branches grow | Reads like a procedure |
| Versioning | Migrate instance schema | Workflow versioning/patching APIs needed |
| Ops | Your broker + DB | Temporal cluster or Azure storage/Netherite |

State machines suit event-heavy, short-to-medium flows already on a broker. Durable engines suit complex, long-running, branching workflows (days, human steps, many compensations).

The sharp edge for durable engines is **replay**: changing workflow code while instances are in flight can corrupt them unless you version carefully.`,
  pts: [r`Replay needs determinism`, r`Versioning in-flight workflows is the hard part`, r`Pick by flow complexity and operational capacity`],
  ex: r`A KYC onboarding flow (documents, human review, 3 external checks, days of waiting) fits Temporal. A 4-step checkout fits a MassTransit state machine.`,
  fu: [r`How would you migrate in-flight sagas to a new version?`],
  pit: [r`Calling HTTP or reading DateTime.UtcNow directly inside replayed workflow code.`] },

{ id: 'q30', level: 'Senior', tags: ['concurrency'],
  code: r`~~~csharp
// Optimistic concurrency on the saga instance: the second writer fails and the message is retried
r.ConcurrencyMode = ConcurrencyMode.Optimistic;           // EF rowversion / Version column
modelBuilder.Entity<OrderState>().Property(s => s.RowVersion).IsRowVersion();
// Or partition the transport by correlation id so one saga's messages are processed sequentially
cfg.ReceiveEndpoint("order-saga", e => e.UsePartitioner(8, ctx => ctx.CorrelationId ?? Guid.Empty));
~~~`,
  q: r`Two events for the same saga arrive at the same time on different nodes. What goes wrong and how do you prevent it?`,
  a: r`Both nodes load the saga instance, apply a transition, and save. Without protection the second save overwrites the first (lost update), possibly publishing contradictory commands.

Fixes:

- **Optimistic concurrency**: a {{Version}}/rowversion column; the loser gets a concurrency exception, reloads the new state and re-handles its event (MassTransit retries this automatically).
- **Pessimistic row lock** (read-with-lock) on the saga row for short handlers; simpler, lower throughput.
- **Single-writer per saga**: route by saga id to one partition/consumer (Kafka key, Service Bus sessions), removing the race at the source.

Combine routing with optimistic concurrency as the safety net; do not rely on routing alone because rebalances create overlaps.`,
  pts: [r`Optimistic version + retry`, r`Partition by saga id`, r`Safety net even with partitioning`],
  ex: r`PaymentTaken and OrderCancelledByUser race. Version check makes one handle the other's result: the cancel after payment triggers a refund rather than overwriting CONFIRMED.`,
  fu: [r`What happens to the messages published by the losing handler?`],
  pit: [r`Publishing messages before the version check succeeds. Use the outbox so they are discarded with the failed transaction.`] },

{ id: 'q31', level: 'Senior', tags: ['kafka', 'messaging'],
  code: r`~~~csharp
// Kafka: key every saga message by the saga id so its events stay ordered in one partition
await producer.ProduceAsync("orders.saga", new Message<string, string> { Key = orderId.ToString(), Value = json });
// Awkward parts: no per-message delay/redelivery (build retry topics), no request/reply, offset commit only after the
// saga state change commits (or use an inbox), and DLQ is a topic you build yourself
~~~`,
  dia: r`flowchart LR
  O[Orchestrator] -->|commands key=orderId| CT[(saga.commands topic)]
  CT --> INV[Inventory]
  CT --> PAY[Payments]
  INV & PAY -->|replies key=orderId| RT[(saga.replies topic)]
  RT --> O
  PAY -->|failure| R1[(retry-1m topic)] --> PAY
  R1 -->|exhausted| DLQ[(dead-letter topic)]`,
  q: r`How do you run a saga over Kafka? What is awkward about it?`,
  a: r`Kafka gives durable, ordered-per-partition logs, which suit choreography and orchestrator event streams:

- Key all saga messages by **saga id** for per-saga ordering.
- Use the **outbox + CDC** (Debezium) to publish atomically with the state change.
- Consumers are idempotent (inbox table) because delivery is at-least-once; Kafka transactions give exactly-once only within Kafka (read-process-write to Kafka topics), not across your database.
- Failure handling: a **retry topic** with delays and a **DLQ topic**; Kafka has no per-message delay or visibility timeout, so delayed retries need a topic ladder or a scheduler.

Awkward parts: no native request/reply or timers, partition rebalances can reorder in-flight work, and a poison message blocks its partition unless you route it aside.`,
  pts: [r`Key by saga id`, r`Exactly-once is not end-to-end`, r`Timers and delays need extra design`, r`Poison message handling per partition`],
  ex: r`Retry ladder: {{orders.retry.5s}}, {{orders.retry.1m}}, {{orders.retry.15m}}, then {{orders.dlq}}.`,
  fu: [r`Why is the consumer offset commit a duplicate-delivery source?`],
  pit: [r`Believing {{enable.idempotence}} or transactions make your database writes exactly-once.`] },

{ id: 'q32', level: 'Senior', tags: ['schema', 'evolution'],
  code: r`~~~csharp
// Contracts: additive changes only; new required data goes in a new message version
public sealed record ChargeCard(Guid OrderId, decimal Amount);                         // v1
public sealed record ChargeCardV2(Guid OrderId, decimal Amount, string Currency = "GBP"); // v2, consumers accept both
// In-flight state: add nullable columns, default in code; never rename states that running instances sit in
public sealed class OrderState { public string? Currency { get; set; } /* new, nullable */ }
~~~`,
  q: r`How do you evolve saga message contracts and in-flight saga state without breaking running sagas?`,
  a: r`Sagas outlive deployments, so both messages and persisted state must be backward compatible.

- **Messages**: additive changes only (new optional fields), tolerant readers, schema registry with compatibility checks (backward for consumers). Breaking change → new message type/version published alongside the old one, then retire the old after in-flight sagas drain.
- **Saga state**: expand/contract migrations. Add nullable columns, deploy code that handles both, backfill, then tighten.
- **Flow changes**: new steps apply to **new** sagas by version tag; running ones finish on the old path (durable engines: use their patch/version API).
- **Rollback safety**: new code must read data written by the new version after a rollback.

Treat the saga definition like a public API with a deprecation window.`,
  pts: [r`Additive, tolerant contracts`, r`Expand/contract for state`, r`Version the flow, drain old instances`],
  ex: r`Adding a fraud-check step: sagas started before the deploy carry {{Version=1}} and skip it; new ones carry {{Version=2}}.`,
  fu: [r`How would you know old versions have drained?`],
  pit: [r`Renaming an event type and breaking every saga waiting for it.`] },

{ id: 'q33', level: 'Senior', tags: ['design'],
  code: r`~~~text
Order steps by (cost of compensating, chance of failure):
1. ValidateCart          fails often, free to undo       -> first
2. ReserveStock          fails sometimes, cheap to undo
3. AuthorizePayment      fails sometimes, free void
4. CapturePayment        PIVOT: refund costs fees and trust
5. CreateShipment        retriable only
Put high-failure, cheap-to-undo steps before the pivot; after the pivot only retriable steps.
~~~`,
  q: r`How do you decide saga step order, and where do you place the pivot?`,
  a: r`Order steps to minimise the cost of failure:

1. **Cheap, reversible, likely-to-fail steps first** (validation, stock hold, fraud scoring).
2. **Pivot**: the step after which you commit to finishing; place it as late as the business allows.
3. **Retriable, idempotent steps after the pivot** (issue invoice, send email, award points).

Consider also **who can reject**: put the party with veto power early. And consider external cost: do not call a metered or slow third party before the cheap internal checks pass.

A good test: for every step before the pivot, write its compensation; for every step after it, write its retry policy. If you cannot do either, the order is wrong.`,
  pts: [r`Reversible early, irreversible late`, r`Pivot as late as possible`, r`Retry policy for post-pivot steps`],
  ex: r`Travel booking: hold seat, hold hotel (compensable), capture payment (pivot), issue tickets and vouchers (retriable).`,
  fu: [r`What if two steps are both irreversible?`],
  pit: [r`Sending the confirmation email before the pivot.`] },

{ id: 'q34', level: 'Senior', tags: ['pitfalls'],
  code: r`~~~csharp
// Bug 1: publishing before saving state (crash = event sent, state lost)
await bus.Publish(new StockReserved(id)); await db.SaveChangesAsync();
// Bug 2: compensation that is not idempotent (double refund on redelivery)
await psp.RefundAsync(chargeId, amount);                                   // missing idempotency key
// Bug 3: no timeout in a waiting state -> sagas stuck forever
// Bug 4: correlation by business key that is not unique (two sagas for the same order)
// Bug 5: swallowing exceptions in a consumer -> message acked, saga never moves
~~~`,
  q: r`List the most common production bugs in saga implementations.`,
  a: r`1. Missing idempotency, producing double charges or duplicate shipments.
2. Dual-write (DB then publish) with no outbox, producing stalled sagas.
3. No timeouts, so sagas hang indefinitely.
4. Compensation assumes the action ran (refund of a charge that never happened).
5. Compensation arrives before action and is lost.
6. Unhandled event in a state silently dropped (state machine ignores it).
7. Lost updates from concurrent events (no optimistic concurrency).
8. Retry storms: unbounded immediate retries overload a recovering dependency.
9. Poison messages blocking a partition or queue.
10. No operator tooling, so stuck sagas are fixed with SQL updates in production.
11. Orchestrator accumulating business rules.
12. Saga state containing secrets or PII.`,
  pts: [r`Idempotency, outbox, timeouts, concurrency control are the big four`, r`Plan operator tooling up front`],
  ex: r`Post-incident review for a double refund: root cause was a consumer that acked before committing and had no inbox dedupe.`,
  fu: [r`Which of these would your code review checklist catch?`],
  pit: [r`Treating these as edge cases. They are the normal operating conditions of distributed systems.`] },

{ id: 'q35', level: 'Senior', tags: ['alternatives'],
  code: r`~~~csharp
// TCC: Try reserves resources with an expiry, Confirm makes it final, Cancel releases
public interface ITccParticipant
{
    Task<ReservationId> TryAsync(Guid txId, Money amount, TimeSpan holdFor, CancellationToken ct);  // e.g. card authorisation hold
    Task ConfirmAsync(Guid txId, CancellationToken ct);                                             // capture
    Task CancelAsync(Guid txId, CancellationToken ct);                                              // void
}
~~~`,
  q: r`Compare sagas, TCC (Try-Confirm/Cancel) and 2PC.`,
  a: r`| | Saga | TCC | 2PC |
|---|---|---|---|
| Phases | Local commits + compensation | Try (reserve), then Confirm or Cancel | Prepare, then Commit |
| Isolation | None, visible intermediates | Reserved resources, not final | Locks until commit |
| Participant requirement | Compensation operations | Reserve/confirm/cancel API per service | XA support |
| Failure handling | Compensate | Cancel reservations (timeouts auto-cancel) | Coordinator recovery, in-doubt blocking |
| Fit | General business workflows | Resources that can be "held" (seats, stock, funds) | Same trust boundary, few participants |

TCC is a disciplined saga where every step is a *reservation* that auto-expires, giving cleaner semantics for resources like inventory, funds holds or card authorisations. Card **authorise then capture** is TCC in the wild.`,
  pts: [r`TCC = reserve + confirm/cancel with expiry`, r`Auth/capture is TCC`, r`Saga is the general case`],
  ex: r`Hotel room hold for 10 minutes (Try), booking completes (Confirm), or hold expires (Cancel).`,
  fu: [r`What does TCC cost in API surface?`],
  pit: [r`Forgetting that Confirm and Cancel must also be idempotent.`] },

{ id: 'q36', level: 'Senior', tags: ['human-in-loop'],
  code: r`~~~csharp
// Human approval as a durable wait with escalation and an absolute deadline
During(AwaitingApproval,
    When(ApprovalGranted).Send(c => new ExecutePayment(c.Saga.CorrelationId)).TransitionTo(Executing),
    When(ApprovalRejected).Publish(c => new PaymentRejected(c.Saga.CorrelationId)).Finalize(),
    When(ApprovalReminder.Received).Publish(c => new EscalateApproval(c.Saga.CorrelationId, c.Saga.ApproverManager)),
    When(ApprovalDeadline.Received).Publish(c => new PaymentExpired(c.Saga.CorrelationId)).Finalize());
~~~`,
  q: r`How do you model human approval steps and very long-running sagas?`,
  a: r`Treat the human as a participant with unbounded latency:

- Persist the saga in {{AwaitingApproval}} with a deadline and an escalation timer.
- Create a task (work queue / case management), store its id in the saga, and complete the step when a signed approval event arrives.
- On deadline, **escalate or auto-decide per policy** (reject, route to a manager).
- Long durations need durable timers, state that survives deployments, and versioned flow definitions (see the contract-evolution question).
- Use a durable engine (Temporal, Durable Functions, Step Functions {{waitForTaskToken}}) so waiting costs almost nothing.

Maker-checker rules and audit apply to the approval itself.`,
  pts: [r`Human = slow participant with timeout`, r`Durable timers`, r`Escalation policy`, r`Audit the decision`],
  ex: r`High-value payment above a threshold waits for a second approver for up to 24 h before auto-reject.`,
  fu: [r`What happens to the saga when the approver leaves the company?`],
  pit: [r`Holding a resource lock for the whole approval period.`] },

{ id: 'q37', level: 'Principal', tags: ['multi-region', 'resilience'],
  code: r`~~~csharp
// Home region per saga: only one region may advance a given saga
public string OwnerRegion(Guid sagaId) => _regions[(int)(BitConverter.ToUInt32(sagaId.ToByteArray(), 0) % (uint)_regions.Length)];
if (OwnerRegion(msg.OrderId) != _currentRegion) { await _forwarder.ForwardAsync(msg, OwnerRegion(msg.OrderId)); return; }
~~~`,
  dia: r`flowchart LR
  subgraph EU[Region EU]
    OEU[Saga orchestrator EU] --> SEU[(Saga state EU)]
  end
  subgraph US[Region US]
    OUS[Saga orchestrator US] --> SUS[(Saga state US)]
  end
  M[Incoming message for saga X] --> R{Owner region of X?}
  R -->|EU| OEU
  R -->|US| OUS
  SEU -. async replication for failover .-> SUS`,
  q: r`What changes about sagas in a multi-region active/active deployment?`,
  a: r`New failure modes appear:

- **Where does saga state live?** Single-region ownership per saga (home region by customer/order id) is simplest: all steps for that saga route to the home region. Multi-writer state needs conflict resolution (CRDTs, last-writer-wins), which sagas rarely tolerate.
- **Replication lag**: a participant in another region may not yet see the data a prior step created. Carry the needed data in the message instead of letting the receiver re-read.
- **Failover**: promoting a replica can lose the last few committed steps; the saga may re-issue a step the old region already performed, which again demands idempotency and reconciliation.
- **Data residency**: some steps and data must stay in region (GDPR, local banking rules), so the saga needs region-aware routing.

Design rule: **pin a saga to one region, make steps idempotent, and reconcile after failover**.`,
  pts: [r`Home region per saga`, r`Carry data in messages`, r`Assume failover replays or loses steps`, r`Residency-aware routing`],
  ex: r`A EU customer's payment saga runs entirely in eu-west; a regional outage fails over to eu-central with reconciliation against processor records.`,
  fu: [r`RPO and RTO impact on in-flight sagas?`],
  pit: [r`Letting two regions both drive the same saga after a partition.`] },

{ id: 'q38', level: 'Principal', tags: ['security', 'audit'],
  code: r`~~~csharp
// Every command carries who initiated the saga, checked again by the participant (no confused deputy)
public sealed record ChargeCard(Guid OrderId, decimal Amount, string InitiatedBy, string OnBehalfOfCustomer);
public async Task Consume(ConsumeContext<ChargeCard> ctx)
{
    if (!await _authz.CanChargeAsync(ctx.Message.OnBehalfOfCustomer, ctx.Message.Amount)) throw new UnauthorizedAccessException();
    await _audit.WriteAsync(new AuditEvent(ctx.Message.InitiatedBy, "charge", ctx.Message.OrderId.ToString(), ctx.MessageId?.ToString()));
}
~~~`,
  q: r`What security and audit concerns arise in sagas, especially in regulated financial systems?`,
  a: r`- **Authorisation propagation**: the saga runs asynchronously, so the user's token may have expired. Carry a validated, minimal **identity and entitlement snapshot** in the saga (or use a service identity with a recorded {{initiatedBy}}), and re-authorise sensitive steps.
- **Audit trail**: an append-only record of every transition, command, reply and compensation with timestamps and actor; required for SOX / regulator queries. Do not overwrite or delete.
- **Sensitive data**: keep PAN and secrets out of saga state and logs (PCI-DSS); store tokens/references only.
- **Message integrity**: authenticate producers, sign or protect messages in untrusted segments, validate on receipt (a forged "PaymentTaken" must not confirm an order).
- **Segregation of duties** for manual intervention tooling (maker-checker for forced completions).
- **Retention and erasure**: balance audit retention with privacy requirements (crypto-shredding of personal data).`,
  pts: [r`Do not rely on a live user token`, r`Immutable audit trail`, r`No PAN in saga state`, r`Maker-checker for overrides`],
  ex: r`A forced "mark as refunded" operator action requires a second approver and writes an immutable audit record.`,
  fu: [r`How do you prove to an auditor what happened to one order?`],
  pit: [r`Trusting any message on the bus because it is "internal".`] },

{ id: 'q39', level: 'Principal', tags: ['cost', 'operations'],
  code: r`~~~text
Cost of one saga vs one local transaction
- Messages: 2 per step (command + reply) x 5 steps = 10 broker messages (+ outbox rows, + inbox rows)
- Storage: saga state rows, outbox/inbox retention, traces
- People: state-machine design, compensation testing, stuck-saga runbook, on-call
Use only where the business requires cross-service atomicity of outcome.
~~~`,
  q: r`How do you reason about the cost and operational overhead of a saga?`,
  a: r`Count both build and run costs:

- **Build**: states, commands, compensations, idempotency, timeouts, tests; typically 3-5x a naive happy-path implementation.
- **Run**: persistence for saga state, broker throughput, timer storage, on-call for stuck sagas, support tooling.
- **Failure cost**: money lost or manual reconciliation effort when compensation is wrong.
- **Managed vs self-run**: Step Functions bills per transition (Standard) so a chatty saga with many steps and high volume gets expensive; Express is cheaper per execution but at-least-once. Temporal/Durable add cluster ops or storage costs.

Decision heuristic: spend design effort proportional to the **money and reputation at risk per saga**, and keep low-value flows simpler (for example accept occasional manual cleanup).`,
  pts: [r`3-5x happy-path effort`, r`On-call and support tooling are real costs`, r`Match rigour to risk`],
  ex: r`A newsletter signup flow uses a simple retry job; payments use a persisted, audited saga with reconciliation.`,
  fu: [r`At what volume does Step Functions Standard stop being economical?`],
  pit: [r`Applying the heavyweight pattern uniformly.`] },

{ id: 'q40', level: 'Principal', tags: ['migration'],
  code: r`~~~csharp
// Strangler step 1: same database transaction, but code split into saga-shaped steps behind interfaces
public async Task PlaceOrderAsync(Order o, CancellationToken ct)
{
    await using var tx = await _db.Database.BeginTransactionAsync(ct);
    await _inventoryStep.ExecuteAsync(o, ct);      // later: becomes a message to the Inventory service
    await _paymentStep.ExecuteAsync(o, ct);        // later: becomes a message to the Payments service
    _db.Outbox.Add(OutboxMessage.From(new OrderPlaced(o.Id)));
    await _db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
}
// Step 2: move one step out at a time, adding its compensation and reconciliation before switching traffic
~~~`,
  q: r`You have a monolith with one big DB transaction. How do you migrate it to a saga safely?`,
  a: r`1. **Find the real invariants.** Which must hold atomically and which tolerate delay? Often fewer than assumed.
2. **Draw the service boundary** so that atomic invariants stay inside one service.
3. **Introduce the saga inside the monolith first** (in-process, same database) with explicit states, idempotent steps and compensations. This proves the logic without distribution.
4. **Add the outbox** to the monolith and publish events; run old and new in parallel (shadow mode), comparing outcomes.
5. **Extract one participant** at a time (strangler), switching its step from a local call to a message with a feature flag and a rollback path.
6. **Reconcile continuously** during migration to catch divergence.
7. Retire the transactional code path once metrics are clean.

Never big-bang a transaction into a saga.`,
  pts: [r`Saga in-process first`, r`Strangler per participant`, r`Shadow + reconcile`, r`Keep rollback via flags`],
  ex: r`Order placement becomes a saga inside the monolith with Inventory still a local call; later Inventory is extracted and the call becomes a command over the broker.`,
  fu: [r`How do you handle in-flight transactions at cutover?`],
  pit: [r`Splitting the database before the saga logic is proven.`] },

{ id: 'q41', level: 'Principal', tags: ['decision', 'architecture'],
  code: r`~~~text
Proposal review for a 9-step, 7-service checkout
- Draw the event flow: who knows the overall status? who triggers compensation for step 6 failing?
- Count consumers per event and failure paths: 9 steps x compensations = 17+ reactions spread over 7 teams
- Recommendation: orchestrate checkout (explicit state machine, one owner); keep choreography for
  side effects that do not affect the outcome (emails, loyalty, analytics)
~~~`,
  q: r`Your team proposes choreography for a 9-step checkout across 7 services. What do you do?`,
  a: r`I would not veto it by preference; I would test it against the evidence:

- **Can anyone draw the failure paths?** Ask the team to produce a diagram of what happens if step 6 fails after step 4 committed. If they cannot do it from the code, the flow is emergent and unmaintainable.
- **Who owns the end-to-end outcome and its SLO?** In choreography nobody does by construction.
- **Where do timeouts live?** If the answer is "nowhere", that is a defect.

Recommendation: an **orchestrator owned by the Order team**, with participants exposing narrow commands, plus events still published for other consumers (analytics, notifications). Keep choreography where the reaction is independent (send email on OrderConfirmed).

Then I make the decision durable: an ADR recording the options, the decision, and the **trigger to revisit** (e.g. steps drop below 4).`,
  pts: [r`Ask for the failure-path diagram`, r`Assign end-to-end ownership`, r`Hybrid: orchestrate the core, choreograph the side effects`, r`Write the ADR with revisit triggers`],
  ex: r`The team's own failure-path exercise exposes three unowned scenarios; the proposal moves to orchestration within a day.`,
  fu: [r`How do you disagree with a respected tech lead without a standoff?`, r`What would make you accept choreography?`],
  pit: [r`Winning by authority instead of evidence.`],
  tip: r`The discriminating answer: make the team demonstrate the failure paths. It turns taste into data.` },

{ id: 'q42', level: 'Principal', tags: ['governance'],
  code: r`~~~text
Saga paved road (template repo + checklist, no central approval)
[ ] State machine diagram committed (generated from code)
[ ] Every step: idempotent handler + inbox, compensation or "retriable" label
[ ] Timeouts on every waiting state, stuck-saga alert (oldest in-flight > SLO)
[ ] Outbox enabled; messages versioned in the schema registry
[ ] Test harness tests for happy path and each failure branch
[ ] Reconciliation job and runbook linked
~~~`,
  q: r`How would you set up governance so teams build sagas consistently without a central bottleneck?`,
  a: r`Provide a **paved road**, not a gate:

- A shared library/template (outbox, inbox, correlation, metrics, timeouts, standard states) so the safe defaults are the easy path.
- A **checklist in the PR template**: idempotency, timeout, compensation, terminal state, audit event, runbook link.
- **Architecture review only for high-risk flows** (money movement, regulated data); others self-certify with the checklist.
- A **saga registry**: owner team, SLO, diagram, runbook, dashboards; reviewed quarterly.
- Shared operator tooling and common alerts ("stuck sagas") so each team does not rebuild them.
- Game days that kill participants mid-saga.

Measure outcomes: stuck-saga count, mean time to resolve, reconciliation breaks per month.`,
  pts: [r`Paved road beats gatekeeping`, r`Risk-tiered review`, r`Registry with ownership`, r`Outcome metrics`],
  ex: r`A platform team ships a {{Company.Sagas}} NuGet package; adoption is driven by it saving two weeks per project.`,
  fu: [r`How do you handle a team that refuses the paved road?`],
  pit: [r`A central architecture board approving every workflow.`] },

{ id: 'q43', level: 'Principal', tags: ['incident'],
  code: r`~~~sql
-- Scope: stuck sagas and whether money moved
SELECT s.CurrentState, COUNT(*) AS sagas, MIN(s.CreatedUtc) AS oldest
FROM saga.OrderState s WHERE s.CurrentState = 'AwaitingPayment' GROUP BY s.CurrentState;
-- Cross-check against the processor's settlement data loaded into a staging table
SELECT s.CorrelationId FROM saga.OrderState s
JOIN recon.PspSettlement p ON p.MerchantReference = CAST(s.CorrelationId AS varchar(36))
WHERE s.CurrentState = 'AwaitingPayment' AND p.Status = 'CAPTURED';      -- charged but stuck: replay PaymentSucceeded
~~~`,
  dia: r`flowchart TB
  D[Detect: oldest AwaitingPayment > 15 min alert] --> T[Triage: was money taken?]
  T --> Q[Query PSP / settlement file per saga]
  Q -->|captured| RP[Replay PaymentSucceeded -> sagas complete]
  Q -->|not captured| CX[Cancel and release stock]
  Q -->|unknown| MAN[Manual review queue]
  RP & CX & MAN --> PM[Postmortem: why did the event not arrive?]`,
  q: r`Production incident: 4,000 orders are stuck in AwaitingPayment and customers were charged. Walk through your response.`,
  a: r`### Stabilise
- Declare the incident; stop the bleeding: pause new checkout intake or switch to a degraded mode if charges may be duplicated. Do **not** bulk-retry or bulk-cancel yet.

### Diagnose (in this order)
1. Is the Payment reply flowing? Check consumer lag, DLQ, and errors on the PaymentTaken publisher (outbox relay stalled?).
2. Are the stuck sagas waiting on an event that was published? Compare processor records with the ledger for a sample.
3. Recent deploys, schema changes, broker incidents.

### Remediate
- Fix the cause (restart relay, redeploy consumer).
- Replay the missed events through the normal idempotent path; sagas resume themselves.
- For orders where state and processor disagree, **reconcile from the processor** (source of truth) rather than guessing.

### Afterwards
- Customer comms for affected orders; verify no duplicate captures; finance sign-off.
- Blameless review: why no "stuck saga" alert? Add one. Add outbox lag alert and a replay tool.

The principle: **replay through idempotent paths, never hand-edit saga rows**.`,
  pts: [r`Stop new damage first`, r`Processor records are the truth`, r`Replay idempotently`, r`Fix the missing alert`],
  ex: r`Root cause: the outbox relay crashed on a malformed row and stopped publishing; the lag alert did not exist.`,
  fu: [r`How do you decide between compensating and completing the stuck orders?`],
  pit: [r`Updating states directly in the database to unblock customers.`] },

{ id: 'q44', level: 'Principal', tags: ['build-vs-buy'],
  code: r`~~~text
Build vs adopt
                         Own framework     MassTransit/NServiceBus     Temporal / Durable Functions
Time to production       months            weeks                       weeks
Correctness edge cases   yours to find     battle-tested               battle-tested
Fit                      exact             message-driven .NET         code-as-workflow, long-running
Ops cost                 you               broker + DB                 engine cluster or managed service
Licence                  none              check current terms         OSS server / cloud pricing
Decision: adopt; only build when a hard constraint rules out all options (document it in an ADR)
~~~`,
  q: r`Build your own saga framework, adopt MassTransit/NServiceBus, or a durable-execution platform? How do you decide?`,
  a: r`Decide on **what you would have to own forever**:

- **Own framework**: only if you have unusual needs and a team to maintain persistence, timers, concurrency, versioning, observability. Usually it grows into a worse MassTransit. Reject by default.
- **Library on your broker (MassTransit, NServiceBus, Wolverine)**: good when you are .NET, already run a broker, and flows are modest. Cost: licence (NServiceBus) or community-support risk, plus you run the infra.
- **Durable-execution platform (Temporal, Durable Functions, Step Functions)**: good for long, branching, human-in-the-loop flows; cost is a new operational dependency, determinism rules and lock-in.

Evaluation criteria: persistence guarantees and concurrency model, timers, versioning story, observability, local test experience, hiring pool, exit cost, total cost at projected volume. Run a **time-boxed spike** on the hardest real flow (not a demo) before committing, and write the exit strategy into the ADR.`,
  pts: [r`Default: never build your own`, r`Spike with the hardest flow`, r`Count exit cost`, r`Total cost including operations`],
  ex: r`Spike: implement refund-with-partial-failure in two candidates; compare lines of code, test effort, and time to diagnose an injected stuck state.`,
  fu: [r`What would trigger a re-evaluation in two years?`],
  pit: [r`Choosing by conference-talk popularity.`] },

{ id: 'q45', level: 'Principal', tags: ['business'],
  code: r`~~~text
For the executive: "When you order, we hold your item and ask your bank to approve the payment.
Most orders confirm in under 2 seconds. About 1 in 500 cannot be confirmed (card declined, stock gone),
so we cancel and release the hold automatically and tell the customer within a minute.
We never charge without an order, and we check every payment against the bank's report every night."
~~~`,
  q: r`How do you explain to a product executive why an order can be "pending" and sometimes reversed?`,
  a: r`Lead with the customer and the money, not the pattern:

"Our checkout touches four independent systems, and none of them can promise 'all or nothing' with the others without making the whole site slower and more fragile. So we confirm each step, and if one fails we undo the earlier ones, which takes a few seconds. For that moment the customer sees 'processing'. In return, one team's outage no longer stops all orders."

Then quantify: the expected rate of compensations (for example 1.5% of orders), the cost per manual fix, the time to resolution targets, and what we need invested (stuck-order alerts, support tooling). Offer choices with prices: faster certainty costs latency or money; accepting rare manual fixes saves engineering time.

Executives decide well when the trade-off is framed as customer experience, risk and cost, with a recommendation.`,
  pts: [r`Plain language, customer outcome first`, r`Quantify rates and costs`, r`Offer options with a recommendation`],
  ex: r`Presenting "1.5% of orders need a reversal; 99.9% resolve in under 10 s; two engineers' worth of tooling cuts manual cases by 80%".`,
  fu: [r`What do you say when they ask for zero pending states?`],
  pit: [r`Explaining sagas instead of outcomes.`] },

{ id: 'q46', level: 'Principal', tags: ['reconciliation'],
  code: r`~~~sql
-- Nightly reconciliation: our ledger vs the processor's settlement file
SELECT COALESCE(l.Reference, p.Reference) AS Ref, l.Amount AS OurAmount, p.Amount AS PspAmount,
  CASE WHEN l.Reference IS NULL THEN 'MISSING_IN_LEDGER'
       WHEN p.Reference IS NULL THEN 'MISSING_AT_PSP'
       WHEN l.Amount <> p.Amount THEN 'AMOUNT_MISMATCH' END AS Break
FROM ledger.Captures l FULL OUTER JOIN recon.PspSettlement p ON p.Reference = l.Reference AND p.SettlementDate = @d
WHERE l.Reference IS NULL OR p.Reference IS NULL OR l.Amount <> p.Amount;
~~~`,
  q: r`Why is reconciliation still needed if every step is idempotent and every compensation retried?`,
  a: r`Because guarantees compose imperfectly. Reconciliation catches what the in-line mechanisms cannot see:

- A participant acknowledged but did not actually persist (bug, replication loss after failover).
- An external party's records differ from yours (processor captured though your call looked failed; their idempotency window expired).
- Human or operational errors (manual DB changes, replays gone wrong).
- Bugs in the compensation logic itself.

A reconciliation job compares your records with the external source of truth (settlement files, partner reports) and **classifies breaks**: auto-correctable (known pattern → fix via normal saga commands), manual (queue with owner), investigate (unknown). It is the only control that does not share the failure modes of the system it checks.

It also converts "we think it is right" into evidence for auditors.`,
  pts: [r`Independent control, different failure modes`, r`Classify breaks`, r`Fix through the normal command path`, r`Audit evidence`],
  ex: r`Daily job finds 3 captures at the processor with no matching order; two are late replies handled automatically, one is a genuine bug and gets an incident.`,
  fu: [r`What is your acceptable break rate and who owns it?`],
  pit: [r`Treating reconciliation as an accounting problem outside engineering.`] },

{ id: 'q47', level: 'Principal', tags: ['limits'],
  code: r`~~~text
What a saga cannot guarantee
- Isolation: intermediate states are visible (mitigate with semantic locks, not eliminate)
- Atomic external side effects: an email sent cannot be compensated; only followed by another email
- Detection of a "silent" external success (provider charged, never told us): only reconciliation finds it
- Bounded completion time when a dependency is down for days
~~~`,
  q: r`What can a saga-based design fundamentally not guarantee? Which failures have no detector?`,
  a: r`Honest limits:

- **No isolation**: you can only reduce anomalies with countermeasures, not eliminate them.
- **No instantaneous atomicity**: there is always a window where the system is inconsistent; you can bound it with timeouts, not remove it.
- **Compensation is not time travel**: external effects (an email, a shipped parcel, funds already withdrawn from an ATM) cannot be undone, only offset.
- **Silent corruption** has no detector within the saga: a participant that acknowledges and loses data, or a wrong-but-successful step (charging the wrong amount) looks like success. Only reconciliation, invariants checks and business monitoring (amount mismatches, unusual refund rate) can surface it.
- **Clock and trust assumptions**: timeouts assume clocks and latency distributions that may not hold in an incident.

State these limits when proposing a design; trust is built by naming them.`,
  pts: [r`Isolation cannot be fully restored`, r`Irreversible effects need business offsets`, r`Silent wrong-but-successful steps need independent checks`],
  ex: r`Invariant monitor: sum of captured payments per day equals sum of ledger credits; a mismatch pages the on-call finance engineer.`,
  fu: [r`Which invariants would you monitor for payments?`],
  pit: [r`Promising "guaranteed consistency".`] },

{ id: 'q48', level: 'Principal', tags: ['team'],
  code: r`~~~text
Ownership model
Saga (process) owner: the team owning the business outcome (Checkout) runs the orchestrator, its dashboards and on-call
Step owners: each service team owns its handler, idempotency and compensation, with a published contract
Shared: message contracts in a schema registry with compatibility checks; a cross-team incident runbook
~~~`,
  q: r`How do you organise teams and ownership around cross-service sagas?`,
  a: r`Conway's law applies: a saga crossing four teams is an organisational problem as much as a technical one.

- **One owning team per business process** (Checkout owns the checkout saga end-to-end SLO), even though participants belong to others.
- **Participants own their commands, compensations and idempotency**, and publish them as versioned contracts with their own SLOs.
- **Shared on-call rules**: the owning team triages; participant teams are paged when the stuck step is theirs, via runbook-linked alerts.
- **Contract testing in CI** so a participant cannot break the saga unnoticed.
- **Regular cross-team failure drills** and a joint incident review habit.
- Avoid a "workflow team" that everyone queues behind; offer tooling, not tickets.`,
  pts: [r`End-to-end owner per process`, r`Participants own compensations`, r`Contract tests`, r`Joint drills and reviews`],
  ex: r`Refund saga owned by Payments; Order and Inventory publish compensation contracts tested in Payments' pipeline.`,
  fu: [r`What if a participant team will not provide a compensation endpoint?`],
  pit: [r`Nobody owning the whole flow.`] },

{ id: 'q49', level: 'Principal', tags: ['evolution'],
  code: r`~~~text
Signals to re-merge services (and replace the saga with one transaction)
- The same team owns both services and they always deploy together
- >30% of production incidents are saga coordination failures between them
- The steps are always called together and need strong consistency
Re-merge: one service, one database, local ACID transaction; delete the compensations
~~~`,
  q: r`When would you stop using sagas and re-merge services?`,
  a: r`Signals that the boundary is wrong rather than the pattern:

- Most sagas span the same two or three services and almost never fail independently.
- Compensation logic is bigger than the business logic, or compensations cannot be defined.
- The business needs strict immediate consistency (users see wrong data and support cost rises).
- Two teams change in lock-step for every feature (high change coupling).
- Operational cost of the saga infrastructure exceeds the benefit of independent deployability.

Then merge the services (or their data) into one transactional boundary, accept the reduced autonomy, and keep async messaging for the genuinely independent edges. Use data: change-coupling analysis from version control, incident counts from stuck sagas, and compensation rates.

Re-merging is not a failure; it is the correct response to evidence.`,
  pts: [r`Boundary smells: same services together, lock-step change`, r`Use data (change coupling, incident counts)`, r`Merging is a legitimate decision`],
  ex: r`Billing and Invoicing always changed together and ran a saga on every request; merging them removed two failure classes and 30% of the code.`,
  fu: [r`How do you convince a team that invested heavily in the split?`],
  pit: [r`Sunk-cost defence of the architecture.`] },

{ id: 'q50', level: 'Principal', tags: ['synthesis'],
  code: r`~~~text
Senior design: happy path + compensations.
Staff design adds: pivot placement, idempotency keys per step, timeouts with "unknown" outcomes resolved by
querying the source of truth, semantic locks for isolation, outbox/inbox, versioned contracts and in-flight
state migration, stuck-saga SLO + alert, nightly reconciliation, and a clear statement of what it cannot guarantee.
~~~`,
  q: r`In one answer: what separates a Staff-level from a Senior-level saga design?`,
  a: r`A senior engineer designs the happy path and the obvious compensations with idempotent handlers and an outbox.

A Staff/Principal engineer additionally:

1. **Frames the problem first**: questions whether a saga is needed, and where the service boundary should move instead.
2. **Designs for the unknown outcome**: timeouts, status queries, fencing, tombstones, rather than treating a timeout as failure.
3. **Names the isolation anomalies** that will occur and chooses countermeasures by business risk.
4. **Adds independent controls**: reconciliation, invariants monitors, stuck-saga alerts, because in-line guarantees share failure modes.
5. **Plans operations**: operator tooling, runbooks, ownership, versioning of in-flight sagas.
6. **States what it cannot guarantee** and prices the trade-offs for the business.
7. **Leaves a decision record** with the trigger for revisiting it.

The discriminating question is "what happens when the step times out and you do not know whether it happened?" The senior answer is "retry". The staff answer is "ask, fence, or compensate safely, and reconcile afterwards, because retry alone can double-act".`,
  pts: [r`Unknown outcome handling`, r`Independent controls`, r`Operations and ownership`, r`Honest limits and ADR`],
  ex: r`Use this as the closing summary in an interview: it shows you design the failure modes, not only the flow.`,
  fu: [r`Which of these would you do first on a new project?`],
  pit: [r`Reciting the pattern definition without the failure analysis.`] }
],
cheat: r`### Core
- Saga = local transactions + compensations. **ACD, no I**. Eventual consistency.
- Orchestration (commands, central state machine) vs choreography (events, no owner). Choreography for 2-4 steps; orchestrate beyond that.
- Step types: **compensable → pivot → retriable**. Reversible first, irreversible last.

### Reliability checklist
| Concern | Answer |
|---|---|
| Duplicate delivery | Idempotent handlers + inbox dedupe in the same transaction |
| Lost publish | Transactional outbox + relay (polling or CDC) |
| Unknown outcome | Retry with same key, query status, fence with deadline |
| Hang | Timeout on every wait, terminal state always reached |
| Concurrent events | Optimistic version + partition by saga id |
| Failed compensation | Retry, DLQ + alert, operator tool, reconciliation |

### Isolation countermeasures
Semantic lock · commutative updates · pessimistic view · reread value · version file · by value.

### Must-have in production
Correlation id · trace propagation · time-in-state metrics · stuck-saga alert · audit trail · runbook · reconciliation job · versioned contracts.

### Phrases that score
- "Atomicity by compensation, not isolation."
- "Timeout means unknown, not failed."
- "Replay through idempotent paths; never hand-edit saga rows."
- "Reconciliation is the control that does not share the system's failure modes."

### Avoid
Dual writes · unbounded retries · compensating on timeout · PAN or secrets in saga state · a global orchestrator · big-bang migration.`
});
})(String.raw);
