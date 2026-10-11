(function (r) {
registerTopic('08-dynamodb', {
related: ['06-mongodb', '21-aws', '07-redis'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['keys', 'partitioning'],
  code: r`~~~csharp
// Composite key: PK = DEVICE#id, SK = ISO timestamp -> one Query returns a time range, ordered
var resp = await ddb.QueryAsync(new QueryRequest
{
    TableName = "telemetry",
    KeyConditionExpression = "PK = :pk AND SK BETWEEN :from AND :to",
    ExpressionAttributeValues = new()
    {
        [":pk"] = new AttributeValue("DEVICE#d-42"),
        [":from"] = new AttributeValue("2026-10-10T00:00:00Z"),
        [":to"] = new AttributeValue("2026-10-10T23:59:59Z")
    },
    ScanIndexForward = false            // newest first
}, ct);
// GetItem needs the full primary key
var item = await ddb.GetItemAsync("telemetry", new() { ["PK"] = new("DEVICE#d-42"), ["SK"] = new("LATEST") }, ct);
~~~`,
  q: r`Explain partition keys, sort keys and how DynamoDB distributes data.`,
  a: r`Every item has a **primary key**: either a **partition key** alone (simple key) or partition key + **sort key** (composite key).

DynamoDB hashes the partition key to choose a **physical partition** (each holds up to ~10 GB and serves up to **3,000 RCU and 1,000 WCU** per second). Items with the same partition key form an **item collection**, stored together and ordered by sort key, which enables efficient range queries ({{begins_with}}, {{between}}, {{<}}, {{>}}).

Access patterns:

- {{GetItem}}: exact primary key, single-digit ms.
- {{Query}}: one partition key, optional sort key condition, ordered results, paginated (1 MB per page).
- {{Scan}}: reads the whole table; avoid in request paths.

Design implications: choose a partition key with **high cardinality and even access**; a "hot" key (a single tenant or a date) concentrates traffic on one partition. Adaptive capacity helps by isolating hot items, but cannot exceed per-partition limits for a single key.`,
  pts: [r`Partition key hashed to physical partition`, r`Sort key orders item collections`, r`Per-partition 3,000 RCU / 1,000 WCU`, r`Get/Query/Scan`, r`High-cardinality, even keys`],
  ex: r`An IoT table keyed by date sent every write for a day to one partition and throttled; switching to deviceId as partition key and timestamp as sort key spread load evenly.`,
  fu: [r`What is adaptive capacity and what can't it fix?`, r`How do you query across many partition keys?`],
  pit: [r`Using a low-cardinality partition key like status or country.`, r`Using Scan with a filter as a query.`],
  tip: r`Quote the per-partition limits (3,000 RCU / 1,000 WCU). It shows you design for physics, not just syntax.` },

{ id: 'q2', level: 'Basic', tags: ['capacity', 'cost'],
  code: r`~~~text
Item 9 KB, 500 reads/s strongly consistent:  ceil(9/4) = 3 RCU x 500 = 1,500 RCU
Same, eventually consistent:                  1,500 / 2 = 750 RCU
Item 2.5 KB, 200 writes/s:                    ceil(2.5/1) = 3 WCU x 200 = 600 WCU
...plus 2 GSIs projecting the item:           +600 WCU each -> 1,800 WCU total
Transactional writes:                         x2 -> 3,600 WCU
~~~
~~~bash
aws dynamodb update-table --table-name orders --billing-mode PAY_PER_REQUEST            # on-demand
aws dynamodb update-table --table-name orders --billing-mode PROVISIONED \
  --provisioned-throughput ReadCapacityUnits=2000,WriteCapacityUnits=800
~~~`,
  q: r`On-demand vs provisioned capacity: how do RCUs and WCUs work and how do you choose?`,
  a: r`- **WCU**: one write per second of an item up to 1 KB (transactional writes cost 2×).
- **RCU**: one strongly consistent read per second of up to 4 KB, or two eventually consistent reads (transactional reads cost 2×).

So reading a 9 KB item strongly consistent costs 3 RCU; eventually consistent costs 1.5.

**On-demand**: pay per request, scales instantly to previously seen peaks (and doubles quickly beyond), no capacity planning. Best for new, spiky or unpredictable workloads. Since late 2024 on-demand prices dropped by about 50%, making it the default for many teams.

**Provisioned** (with auto scaling): cheaper per unit for steady, predictable traffic, especially with **reserved capacity**. Auto scaling reacts in minutes, so sudden spikes can throttle; burst capacity (up to 5 minutes of unused capacity) helps.

You can switch modes (with limits on frequency). Decide with real traffic data: compute monthly cost both ways.`,
  pts: [r`WCU = 1 KB write/s`, r`RCU = 4 KB strong read/s or 2 eventual`, r`Transactions cost 2×`, r`On-demand for spiky/unknown`, r`Provisioned + reserved for steady`],
  ex: r`A steady 2,000 writes/s workload cost about 3× more on on-demand than provisioned with reserved capacity; a spiky marketing API was cheaper on on-demand.`,
  fu: [r`How do item size and indexes change cost?`],
  pit: [r`Forgetting that every GSI consumes its own write capacity.`] },

{ id: 'q3', level: 'Basic', tags: ['indexes'],
  code: r`~~~csharp
// Sparse GSI: only OPEN orders carry GSI1PK, so the index holds just the open set
var open = new Dictionary<string, AttributeValue>
{
    ["PK"] = new("ORDER#981"), ["SK"] = new("META"), ["status"] = new("OPEN"),
    ["GSI1PK"] = new("WH#lon-1#OPEN"), ["GSI1SK"] = new("2026-10-10T09:12:00Z#981")
};
await ddb.PutItemAsync("app", open, ct);
// Closing the order removes it from the index
await ddb.UpdateItemAsync(new UpdateItemRequest
{
    TableName = "app", Key = new() { ["PK"] = new("ORDER#981"), ["SK"] = new("META") },
    UpdateExpression = "SET #s = :closed REMOVE GSI1PK, GSI1SK",
    ExpressionAttributeNames = new() { ["#s"] = "status" },
    ExpressionAttributeValues = new() { [":closed"] = new("CLOSED") }
}, ct);
~~~`,
  q: r`What are GSIs and LSIs, and when do you use each?`,
  a: r`| | Global Secondary Index | Local Secondary Index |
|---|---|---|
| Keys | Any partition + optional sort key | Same partition key, different sort key |
| When created | Any time | Only at table creation |
| Consistency | Eventually consistent only | Strong or eventual |
| Capacity | Own capacity (provisioned) | Shares table's capacity |
| Size limit | None | Item collection limited to 10 GB |
| Count | 20 per table (default) | 5 per table |

GSIs replicate asynchronously from the base table. If a GSI is under-provisioned, **writes to the base table throttle** (back-pressure).

**Projections**: KEYS_ONLY, INCLUDE (selected attributes) or ALL; project only what queries need to save storage and write cost.

**Sparse indexes**: only items with the index key attribute appear in the GSI; great for "all open orders" (set {{GSI1PK}} only while status is OPEN).

Default to GSIs; LSIs only when you need strongly consistent alternate sort orders within a partition and accept the 10 GB collection limit.`,
  pts: [r`GSI: any key, eventual, own capacity`, r`LSI: same PK, strong reads, creation-time only`, r`GSI throttling back-pressures the table`, r`Projections cost`, r`Sparse indexes`],
  ex: r`An orders table used a sparse GSI keyed on {{OpenOrderShard}} to list open orders without scanning millions of closed ones.`,
  fu: [r`Why can GSI writes throttle the base table?`],
  pit: [r`Adding an LSI casually and hitting the 10 GB item collection limit later.`] },

{ id: 'q4', level: 'Basic', tags: ['consistency'],
  code: r`~~~csharp
// Read-after-write on the base table: strongly consistent
var r = await ddb.GetItemAsync(new GetItemRequest { TableName = "app", Key = key, ConsistentRead = true }, ct);

// GSIs are always eventual: ConsistentRead = true on an IndexName query throws a ValidationException
await ddb.QueryAsync(new QueryRequest { TableName = "app", IndexName = "GSI1", /* ConsistentRead = true -> error */
    KeyConditionExpression = "GSI1PK = :c", ExpressionAttributeValues = new() { [":c"] = new("CUST#42") } }, ct);
~~~`,
  q: r`What consistency guarantees does DynamoDB offer?`,
  a: r`- **Eventually consistent reads** (default): may not reflect a write from the last moment (usually within a second). Half the RCU cost.
- **Strongly consistent reads** ({{ConsistentRead = true}}): reflect all successful writes before the read. Only on the base table and LSIs, not GSIs; not on global table replicas across regions.
- **Conditional writes**: atomic check-and-set on a single item ({{ConditionExpression}}).
- **Transactions** ({{TransactWriteItems}}, {{TransactGetItems}}): ACID across up to 100 items/4 MB in one region, serializable isolation among transactions.
- **Global tables**: multi-region replication; by default eventually consistent with **last-writer-wins** conflict resolution. Multi-Region Strong Consistency (MRSC) became available in 2025 for selected regions with higher write latency.

Read-after-write within a region: use strongly consistent reads on the base table when correctness requires it.`,
  pts: [r`Eventual default, strong optional`, r`GSIs are eventual only`, r`Conditional writes per item`, r`Transactions up to 100 items`, r`Global tables LWW by default`],
  ex: r`A checkout flow read from a GSI right after writing and saw stale status; querying the base table with ConsistentRead fixed it.`,
  fu: [r`How would you get read-your-writes through a GSI?`],
  pit: [r`Assuming GSIs can be read strongly consistent.`] },

{ id: 'q5', level: 'Basic', tags: ['single-table', 'modeling'],
  q: r`What is single-table design and why do people use it?`,
  a: r`Instead of one table per entity, store multiple entity types in one table with **generic key names** ({{PK}}, {{SK}}, {{GSI1PK}}, {{GSI1SK}}) and an entity type attribute. Related items share a partition key so one {{Query}} returns a parent and children together, the DynamoDB equivalent of a join.

~~~text
PK              SK                     Attributes
CUSTOMER#42     PROFILE                name, email
CUSTOMER#42     ORDER#2026-10-01#981   total, status
CUSTOMER#42     ORDER#2026-10-03#995   total, status
ORDER#981       ITEM#1                 sku, qty, price
~~~

Query {{PK = CUSTOMER#42 AND begins_with(SK, "ORDER#")}} returns the customer's orders sorted by date.

Benefits: fewer requests per page, predictable performance, fewer tables to manage. Costs: harder to learn and read, all access patterns must be known up front, analytics and evolution are harder, and exports need transformation.

Single-table is a tool, not a religion: separate tables are fine when entities are not queried together or have different capacity/backup needs.`,
  pts: [r`Generic PK/SK, entity type attribute`, r`Pre-joined item collections`, r`Known access patterns required`, r`Harder evolution and analytics`, r`Not mandatory`],
  ex: r`A customer portal page needing profile + last 10 orders + addresses used one Query instead of three requests across tables.`,
  fu: [r`When would you use multiple tables instead?`],
  pit: [r`Forcing single-table design on a team without known access patterns.`] },

{ id: 'q6', level: 'Basic', tags: ['dotnet', 'sdk'],
  q: r`How do you use DynamoDB from .NET (low-level client, document model, object persistence model)?`,
  a: r`AWS SDK for .NET offers three layers:

- **Low-level** {{AmazonDynamoDBClient}}: full control, explicit attribute values ({{new AttributeValue { S = "..." }}}). Most verbose, supports everything (transactions, conditions, PartiQL).
- **Document model** ({{Table}}, {{Document}}): JSON-like documents.
- **Object persistence** {{DynamoDBContext}} with attributes ({{[DynamoDBHashKey]}}, {{[DynamoDBRangeKey]}}, {{[DynamoDBVersion]}} for optimistic locking): convenient for simple tables, awkward for single-table design.

Practices:

- Register {{IAmazonDynamoDB}} as a singleton (it is thread-safe and reuses connections).
- Use async methods with {{CancellationToken}}.
- Use expression attribute names/values; avoid building expressions by string concatenation of user input.
- Configure retry mode (standard/adaptive) and timeouts; DynamoDB returns throttling errors that the SDK retries with backoff.
- For single-table design, a small mapping layer over the low-level client is often clearer than DynamoDBContext.

~~~csharp
var resp = await ddb.QueryAsync(new QueryRequest {
  TableName = "app", KeyConditionExpression = "PK = :pk AND begins_with(SK, :sk)",
  ExpressionAttributeValues = new() { [":pk"] = new("CUSTOMER#42"), [":sk"] = new("ORDER#") },
  ScanIndexForward = false, Limit = 10 }, ct);
~~~`,
  pts: [r`Three SDK layers`, r`Singleton client`, r`Expression attribute values`, r`[DynamoDBVersion] optimistic locking`, r`Custom mapping for single-table`],
  ex: r`A Lambda created the DynamoDB client inside the handler and paid TLS setup on every invocation; moving it to a static field cut p50 by 30 ms.`,
  fu: [r`How do you test DynamoDB code locally?`],
  pit: [r`Creating a client per request.`] },

{ id: 'q7', level: 'Intermediate', tags: ['access-patterns', 'modeling'],
  code: r`~~~csharp
// Key builders keep the access-pattern table and code in sync
public static class Keys
{
    public static string Order(string id) => "ORDER#" + id;
    public static string Customer(string id) => "CUST#" + id;
    public static string OrderByDate(DateTimeOffset at, string id) => at.UtcDateTime.ToString("O") + "#" + id;
    public static string OpenByWarehouse(string wh) => "WH#" + wh + "#OPEN";
}
// Pattern "customer orders newest first" -> GSI1
var page = await ddb.QueryAsync(new QueryRequest
{
    TableName = "app", IndexName = "GSI1",
    KeyConditionExpression = "GSI1PK = :c AND begins_with(GSI1SK, :p)",
    ExpressionAttributeValues = new() { [":c"] = new(Keys.Customer("42")), [":p"] = new("2026-") },
    ScanIndexForward = false, Limit = 20
}, ct);
~~~`,
  q: r`Walk through modelling a DynamoDB table from access patterns.`,
  a: r`Process:

1. **List entities** and relationships (ERD still helps).
2. **List every access pattern** with frequency and latency needs: "get order by id", "list customer's orders newest first", "list open orders per warehouse", "get order with items".
3. **Design the primary key** to satisfy the most important patterns; add **GSIs** for the rest (overloading GSI keys across entity types).
4. **Write an access-pattern table** mapping each pattern to Get/Query on table or index with key conditions.
5. **Check hot partitions** and item size limits (400 KB).
6. **Validate** with real data volumes and a cost estimate.

| Access pattern | Index | Key condition |
|---|---|---|
| Get order | Table | PK = ORDER#id, SK = METADATA |
| Order with items | Table | PK = ORDER#id |
| Customer orders by date | GSI1 | GSI1PK = CUSTOMER#id, GSI1SK begins_with ORDER# |
| Open orders per warehouse | GSI2 (sparse) | GSI2PK = WH#id#OPEN |

If a pattern cannot be served by a key condition, you either add an index, precompute (aggregates), or move that pattern to another store (search, analytics).`,
  pts: [r`Patterns first, keys second`, r`Access-pattern table`, r`Overloaded GSIs`, r`Check hot keys and 400 KB limit`, r`Offload unsupported patterns`],
  ex: r`A team found 3 of 14 access patterns were ad hoc searches; they streamed data to OpenSearch for those instead of adding GSIs.`,
  fu: [r`What happens when a new access pattern appears after launch?`],
  pit: [r`Designing tables like a relational schema then adding Scan-based queries.`] },

{ id: 'q8', level: 'Intermediate', tags: ['conditional-writes', 'concurrency'],
  q: r`How do you implement optimistic locking and uniqueness constraints in DynamoDB?`,
  a: r`**Optimistic locking** with a version attribute and a condition:

~~~csharp
await ddb.UpdateItemAsync(new UpdateItemRequest {
  TableName = "app", Key = Key("ACCOUNT#42", "BALANCE"),
  UpdateExpression = "SET balance = balance - :amt, version = version + :one",
  ConditionExpression = "version = :v AND balance >= :amt",
  ExpressionAttributeValues = new() { [":amt"] = N(amount), [":v"] = N(version), [":one"] = N(1) } }, ct);
// ConditionalCheckFailedException => reload and retry, or reject
~~~

Often you do not even need the version: a condition on the business invariant ({{balance >= :amt}}) is enough and avoids retries.

**Uniqueness** on non-key attributes (unique email): DynamoDB only guarantees uniqueness of the primary key, so write a **guard item** ({{PK = EMAIL#a@b.com}}) in the same **transaction** as the user item, with {{attribute_not_exists(PK)}}:

~~~text
TransactWriteItems:
  Put USER#123 (condition attribute_not_exists(PK))
  Put EMAIL#a@b.com -> userId 123 (condition attribute_not_exists(PK))
~~~

Changing the email = transaction deleting the old guard and creating the new one.`,
  pts: [r`ConditionExpression is atomic per item`, r`Condition on invariants, not only version`, r`ConditionalCheckFailedException`, r`Guard items for uniqueness`, r`Transactions to keep guards consistent`],
  ex: r`A signup race created duplicate accounts for the same email until guard items were added in a transaction.`,
  fu: [r`What does ReturnValuesOnConditionCheckFailure give you?`],
  pit: [r`Checking for existence with a read then writing (race).`] },

{ id: 'q9', level: 'Intermediate', tags: ['transactions'],
  code: r`~~~csharp
var req = new TransactWriteItemsRequest
{
    ClientRequestToken = idempotencyKey,                     // safe retries for 10 minutes
    TransactItems =
    [
        new() { Update = new Update { TableName = "wallets", Key = Wallet(from),
            UpdateExpression = "SET balance = balance - :a",
            ConditionExpression = "balance >= :a",
            ExpressionAttributeValues = new() { [":a"] = new() { N = amount.ToString(CultureInfo.InvariantCulture) } } } },
        new() { Update = new Update { TableName = "wallets", Key = Wallet(to),
            UpdateExpression = "SET balance = balance + :a",
            ExpressionAttributeValues = new() { [":a"] = new() { N = amount.ToString(CultureInfo.InvariantCulture) } } } },
        new() { Put = new Put { TableName = "wallets", Item = TransferRecord(from, to, amount),
            ConditionExpression = "attribute_not_exists(PK)" } }
    ]
};
try { await ddb.TransactWriteItemsAsync(req, ct); }
catch (TransactionCanceledException ex) when (ex.CancellationReasons[0].Code == "ConditionalCheckFailed")
{ return TransferResult.InsufficientFunds; }
~~~`,
  q: r`How do DynamoDB transactions work and what are their limits?`,
  a: r`{{TransactWriteItems}} groups up to **100 actions** (Put, Update, Delete, ConditionCheck) across tables in one region, up to 4 MB; all succeed or none. {{TransactGetItems}} reads up to 100 items atomically.

Mechanics and costs:

- Each item costs **2× capacity** (prepare + commit).
- Transactions conflict with concurrent writes to the same items: {{TransactionCanceledException}} with reasons per item ({{ConditionalCheckFailed}}, {{TransactionConflict}}).
- **Idempotency**: pass {{ClientRequestToken}}; retries within 10 minutes with the same token do not re-apply.
- Not supported across regions in global tables (transactional within the region you write to; replication to other regions is not atomic as a group).
- No interactive transactions: you cannot read inside, then decide. Use conditions.

Use cases: transfers between accounts, uniqueness guard items, writing an entity plus an outbox item, maintaining aggregates. Avoid making every write transactional (cost and contention).`,
  pts: [r`Up to 100 items, 4 MB`, r`2× capacity`, r`ClientRequestToken idempotency`, r`Per-item cancellation reasons`, r`No interactive transactions`],
  ex: r`A wallet transfer used TransactWriteItems with conditions on the source balance and a ClientRequestToken from the API's idempotency key.`,
  fu: [r`How do you handle TransactionConflict under high contention?`],
  pit: [r`Retrying with a new ClientRequestToken (double-applies).`] },

{ id: 'q10', level: 'Intermediate', tags: ['streams', 'cdc'],
  code: r`~~~csharp
// Lambda stream consumer with partial batch failure reporting (Amazon.Lambda.DynamoDBEvents)
public async Task<StreamsEventResponse> Handler(DynamoDBEvent evt, ILambdaContext ctx)
{
    var failures = new List<StreamsEventResponse.BatchItemFailure>();
    foreach (var rec in evt.Records)
    {
        try
        {
            if (rec.EventName == "INSERT" && rec.Dynamodb.NewImage["SK"].S.StartsWith("OUTBOX#"))
                await _publisher.PublishAsync(rec.Dynamodb.NewImage, ctx.RemainingTime);
        }
        catch (Exception)
        {
            failures.Add(new() { ItemIdentifier = rec.Dynamodb.SequenceNumber });   // retry from here only
            break;                                                                  // preserve per-key order
        }
    }
    return new StreamsEventResponse { BatchItemFailures = failures };
}
~~~`,
  q: r`What are DynamoDB Streams and how do you use them?`,
  a: r`DynamoDB Streams capture item-level changes (insert, modify, remove) in order **per partition key**, retained for **24 hours**. View types: KEYS_ONLY, NEW_IMAGE, OLD_IMAGE, NEW_AND_OLD_IMAGES.

Consumers:

- **Lambda event source mapping**: batches records per shard, retries failures; configure {{BisectBatchOnFunctionError}}, {{MaximumRetryAttempts}}, an on-failure destination (SQS/SNS) and {{ReportBatchItemFailures}} so one poison record does not block the shard.
- **Kinesis Data Streams for DynamoDB** (alternative): longer retention (up to 365 days), more consumers, enhanced fan-out.
- **EventBridge Pipes** to route and filter to targets.

Uses: transactional outbox (write the event item, stream publishes it), materialised views and aggregates, search indexing (OpenSearch), cross-region or cross-account propagation, audit.

Delivery is **at-least-once** and ordered per key; consumers must be idempotent. If processing falls behind more than 24 hours, records are lost.`,
  pts: [r`Per-key ordered change log`, r`24-hour retention`, r`Lambda with bisect + failure destination`, r`Kinesis option for longer retention`, r`At-least-once, idempotent consumers`],
  ex: r`An order table streamed changes through Lambda to EventBridge, giving downstream services events without dual writes.`,
  fu: [r`How many Lambda invocations run concurrently per shard?`],
  pit: [r`Letting a poison record block a shard for 24 hours.`] },

{ id: 'q11', level: 'Intermediate', tags: ['ttl'],
  code: r`~~~csharp
long expiresAt = DateTimeOffset.UtcNow.AddMinutes(15).ToUnixTimeSeconds();   // seconds, not milliseconds
await ddb.PutItemAsync("holds", new()
{
    ["PK"] = new("HOLD#seat-12A"), ["SK"] = new("META"),
    ["ttl"] = new() { N = expiresAt.ToString() }
}, ct);
// TTL deletion is lazy (days): filter expired items on read when it matters
var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
var q = new QueryRequest { TableName = "holds", KeyConditionExpression = "PK = :pk",
    FilterExpression = "#t > :now", ExpressionAttributeNames = new() { ["#t"] = "ttl" },
    ExpressionAttributeValues = new() { [":pk"] = new("HOLD#seat-12A"), [":now"] = new() { N = now } } };
~~~`,
  q: r`How does TTL work in DynamoDB, and what are its quirks?`,
  a: r`You enable TTL on an attribute holding a **Unix epoch seconds** number. A background process deletes expired items, **typically within a few days** of expiry (no exact timing guarantee), at no WCU cost.

Quirks:

- Expired items can still be returned by reads until deleted: filter them out ({{FilterExpression ttl > :now}}) when it matters.
- Deletions appear in DynamoDB Streams with a system identity ({{userIdentity.principalId = dynamodb.amazonaws.com}}), so you can archive expired items to S3 via a stream consumer.
- TTL deletes in global tables replicate to other regions (and consume replicated write capacity there).
- Wrong units (milliseconds) mean items never expire for millennia.

Uses: sessions, idempotency records, temporary reservations, data retention policies (with archival to S3 for compliance).`,
  pts: [r`Epoch seconds attribute`, r`Deletion within days, free`, r`Filter expired items on read`, r`TTL deletes in streams`, r`Archive via stream to S3`],
  ex: r`A booking hold set a 15-minute TTL but expired holds lingered for hours; the read path filtered on the expiry attribute so users never saw them.`,
  fu: [r`How do you implement exact-time expiry instead?`],
  pit: [r`Relying on TTL for exact-time business logic.`] },

{ id: 'q12', level: 'Intermediate', tags: ['pagination', 'query'],
  code: r`~~~csharp
public async Task<(List<Order> Items, string? Cursor)> PageAsync(string customerId, string? cursor, CancellationToken ct)
{
    var items = new List<Order>();
    Dictionary<string, AttributeValue>? start = cursor is null ? null : CursorCodec.Decode(cursor); // signed, base64
    do
    {
        var resp = await ddb.QueryAsync(new QueryRequest
        {
            TableName = "app", IndexName = "GSI1", Limit = 50, ExclusiveStartKey = start,
            KeyConditionExpression = "GSI1PK = :c", ExpressionAttributeValues = new() { [":c"] = new("CUST#" + customerId) }
        }, ct);
        items.AddRange(resp.Items.Select(Map));
        start = resp.LastEvaluatedKey is { Count: > 0 } k ? k : null;
    } while (items.Count < 20 && start is not null);               // loop: a page may be short or empty
    return (items, start is null ? null : CursorCodec.Encode(start));
}
~~~`,
  q: r`How do pagination, Limit and FilterExpression interact in Query?`,
  a: r`- A Query reads up to **1 MB** of data per call (before filtering), then returns {{LastEvaluatedKey}} if more remains; pass it as {{ExclusiveStartKey}} for the next page.
- {{Limit}} caps the number of items **evaluated**, not returned after filtering.
- {{FilterExpression}} is applied **after** reading: you pay RCUs for everything read, and a page can return zero items while {{LastEvaluatedKey}} is still present.

So a Query with a selective filter can return empty pages and cost a lot. Push selectivity into the **key condition** (sort key design) or a sparse GSI instead.

API design: return an opaque, encoded and signed cursor to clients (never the raw key which may expose internal ids), and loop server-side until you have a full page or no more data, with a cap to bound latency.`,
  pts: [r`1 MB per call`, r`Limit counts evaluated items`, r`Filters do not save RCUs`, r`Empty pages with LastEvaluatedKey`, r`Opaque signed cursors`],
  ex: r`An API returned empty first pages to the mobile app because of a filter on status; a sparse GSI on open items fixed both UX and cost.`,
  fu: [r`How do you implement "page 5 of 20" in DynamoDB?`],
  pit: [r`Treating FilterExpression like a SQL WHERE with index support.`] },

{ id: 'q13', level: 'Intermediate', tags: ['hot-partitions'],
  code: r`~~~csharp
const int Shards = 10;
// Write: spread a hot logical key over N physical keys
string ShardedPk(string day, string orderId) => "ORDERS#" + day + "#" + (Math.Abs(orderId.GetHashCode()) % Shards);

// Read: query all shards in parallel and merge
var tasks = Enumerable.Range(0, Shards).Select(i => ddb.QueryAsync(new QueryRequest
{
    TableName = "app", KeyConditionExpression = "PK = :pk",
    ExpressionAttributeValues = new() { [":pk"] = new("ORDERS#2026-10-10#" + i) }
}, ct));
var all = (await Task.WhenAll(tasks)).SelectMany(r => r.Items).OrderBy(i => i["SK"].S).ToList();
~~~
Note: use a stable hash (e.g. xxHash of the id), not string.GetHashCode, which is randomised per process in .NET.`,
  q: r`How do you handle hot partitions and write sharding?`,
  a: r`A hot partition happens when one partition key receives more than ~1,000 WCU or 3,000 RCU per second, or a small key set receives most traffic.

Techniques:

- **Better key choice**: add high-cardinality components (tenant + entity id instead of tenant).
- **Write sharding**: append a random or calculated suffix ({{EVENTS#2026-10-10#7}}, N = 10 shards); readers query all N shards in parallel and merge. Calculated suffixes (hash of an attribute) let you read a specific item directly.
- **Caching** hot reads with **DAX** or Redis.
- **Aggregate in memory** and write less often (counters batched every second).
- **Adaptive capacity / split for heat**: DynamoDB automatically isolates frequently accessed items and splits partitions, but one key still has the per-partition ceiling.

Monitor with **CloudWatch Contributor Insights** for DynamoDB to see the most accessed and throttled keys.`,
  pts: [r`Per-key ceiling`, r`Write sharding with suffixes`, r`Parallel scatter-read`, r`DAX for hot reads`, r`Contributor Insights`],
  ex: r`A voting app's "votes for item X" counter throttled at 1,000 writes/s; 20 sharded counters summed on read handled 15,000 writes/s.`,
  fu: [r`How many shards do you choose and how do you change N later?`],
  pit: [r`Raising table capacity to fix a single hot key.`] },

{ id: 'q14', level: 'Intermediate', tags: ['dax', 'caching'],
  code: r`~~~csharp
// DAX client is API-compatible: swap the client, keep the code (AWSSDK.DAX.Client)
var daxConfig = new DaxClientConfig("my-dax.abc123.dax-clusters.eu-west-1.amazonaws.com", 8111) { AwsCredentials = creds };
IAmazonDynamoDB client = new ClusterDaxClient(daxConfig);
var item = await client.GetItemAsync("profiles", new() { ["PK"] = new("USER#42") }, ct);   // microseconds on a hit
// Strongly consistent reads bypass the cache
var fresh = await client.GetItemAsync(new GetItemRequest { TableName = "profiles", Key = key, ConsistentRead = true }, ct);
~~~`,
  q: r`What is DAX and when would you use it versus ElastiCache?`,
  a: r`**DynamoDB Accelerator (DAX)** is a write-through, in-memory cache cluster API-compatible with DynamoDB: swap the client and Get/Query responses come from cache in microseconds.

Characteristics:

- Item cache (Get/BatchGet) and query cache (Query/Scan results) with TTLs.
- Write-through: writes go through DAX to DynamoDB and update the item cache, but the **query cache is not invalidated** by writes (results can be stale until TTL).
- Only eventually consistent reads are cached; strongly consistent reads pass through.
- Runs in your VPC; .NET client available.

Use DAX for read-heavy, latency-sensitive, repeated reads of the same items with no code change. Use **ElastiCache** when you need caching across multiple data sources, computed values, custom data structures, or more control over invalidation. Skip both if DynamoDB's single-digit ms is already enough, which it usually is.`,
  pts: [r`API-compatible write-through cache`, r`Microsecond reads`, r`Query cache not invalidated by writes`, r`Eventual reads only`, r`ElastiCache for general caching`],
  ex: r`A gaming profile service used DAX to serve 200 K reads/s for hot profiles at a fraction of the RCU cost.`,
  fu: [r`What staleness does DAX introduce for queries?`],
  pit: [r`Adding DAX for a workload that is mostly writes.`] },

{ id: 'q15', level: 'Intermediate', tags: ['batch', 'throughput'],
  q: r`How do BatchGetItem and BatchWriteItem behave, and how do you handle partial failures?`,
  a: r`- {{BatchGetItem}}: up to 100 items / 16 MB per call. {{BatchWriteItem}}: up to 25 Put/Delete requests / 16 MB per call (no Update, no conditions).
- Batches are **not atomic**: some items may succeed while others are throttled. The response returns {{UnprocessedKeys}} / {{UnprocessedItems}}, which you must retry with **exponential backoff and jitter**.
- Items are processed in parallel internally, so batches reduce round trips, not capacity cost.

~~~csharp
var request = new BatchWriteItemRequest { RequestItems = items };
for (var attempt = 0; request.RequestItems.Count > 0; attempt++) {
  var resp = await ddb.BatchWriteItemAsync(request, ct);
  request.RequestItems = resp.UnprocessedItems;
  if (resp.UnprocessedItems.Count > 0) await Task.Delay(Backoff(attempt), ct);
}
~~~

For bulk loads of millions of items, prefer **Import from S3** (creates a new table without consuming WCU) or parallel workers with rate control.`,
  pts: [r`25 writes / 100 reads per batch`, r`Not atomic`, r`Retry Unprocessed with backoff`, r`No conditions in BatchWrite`, r`Import from S3 for bulk`],
  ex: r`A migration script ignored UnprocessedItems and silently lost 3% of records under throttling; reconciliation counts caught it.`,
  fu: [r`When must you use TransactWriteItems instead?`],
  pit: [r`Ignoring UnprocessedItems.`] },

{ id: 'q16', level: 'Intermediate', tags: ['security'],
  code: r`~~~json
{
  "Effect": "Allow",
  "Action": ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem"],
  "Resource": ["arn:aws:dynamodb:eu-west-1:123456789012:table/app", "arn:aws:dynamodb:eu-west-1:123456789012:table/app/index/*"],
  "Condition": {
    "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["TENANT#$\{aws:PrincipalTag/tenant}#*"] }
  }
}
~~~
The ABAC condition limits every request to partition keys starting with the caller's tenant tag, so a bug in application code cannot read another tenant's items.`,
  q: r`How do you secure DynamoDB access?`,
  a: r`- **IAM least privilege**: grant specific actions on specific table/index ARNs to each service role (IRSA / EKS Pod Identity on EKS, task roles on ECS, Lambda execution roles). No long-lived access keys.
- **Fine-grained access control**: IAM condition keys like {{dynamodb:LeadingKeys}} restrict a principal to items whose partition key matches (e.g. tenant id from session tags or a Cognito identity) and {{dynamodb:Attributes}} restricts attributes.
- **Network**: VPC gateway endpoint for DynamoDB with endpoint policies so traffic stays private and only allowed tables are reachable.
- **Encryption at rest**: AWS-owned, AWS-managed or customer-managed KMS keys (CMK for control and audit).
- **Client-side encryption** (AWS Database Encryption SDK) for sensitive attributes, with searchable beacons for equality queries.
- **Audit**: CloudTrail data events for item-level API calls (cost consideration), resource-based policies (2024) for cross-account access.
- **Backups**: PITR enabled; AWS Backup with vault lock for immutability.`,
  pts: [r`Per-role, per-table IAM`, r`LeadingKeys for tenant isolation`, r`VPC endpoint policies`, r`KMS CMK`, r`Client-side encryption for sensitive attributes`],
  ex: r`A multi-tenant SaaS used session tags with dynamodb:LeadingKeys so even a bug in a query could not read another tenant's partition.`,
  fu: [r`How do you audit who read a specific item?`],
  pit: [r`Granting dynamodb:* on * to application roles.`] },

{ id: 'q17', level: 'Intermediate', tags: ['backup', 'pitr'],
  code: r`~~~bash
aws dynamodb update-continuous-backups --table-name orders \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true,RecoveryPeriodInDays=35
# Restore creates a NEW table: reapply alarms, streams, auto scaling, IAM afterwards
aws dynamodb restore-table-to-point-in-time --source-table-name orders \
  --target-table-name orders-restore-1402 --restore-date-time 2026-10-10T14:01:59Z
# Export without consuming RCU, then query with Athena
aws dynamodb export-table-to-point-in-time --table-arn arn:aws:dynamodb:eu-west-1:123:table/orders \
  --s3-bucket orders-exports --export-format DYNAMODB_JSON --export-type INCREMENTAL_EXPORT \
  --incremental-export-specification ExportFromTime=2026-10-09T00:00:00Z,ExportToTime=2026-10-10T00:00:00Z
~~~`,
  q: r`How do backups, PITR and exports work in DynamoDB?`,
  a: r`- **Point-in-time recovery (PITR)**: continuous backups with restore to any second in the last 35 days (configurable 1 to 35 since 2025). Restores create a **new table** (settings like auto scaling, IAM, streams, alarms must be reapplied).
- **On-demand backups**: full backups retained until deleted; AWS Backup adds cross-region/cross-account copies, vault lock, lifecycle to cold storage.
- **Export to S3**: full or incremental exports from PITR data in DynamoDB JSON or Ion, without consuming read capacity; query with Athena or load into a warehouse.
- **Import from S3**: create a new table from CSV/JSON/Ion files.

Restore times grow with table size; rehearse and measure. Since restores create a new table, your runbook must cover switching applications to the restored table name (or copying data back).`,
  pts: [r`PITR up to 35 days`, r`Restore creates new table`, r`AWS Backup for cross-account and vault lock`, r`Export to S3 without RCU`, r`Rehearse restore runbook`],
  ex: r`A bad deploy corrupted 2 hours of profile updates; PITR restored to a new table, and a script copied only the affected items back.`,
  fu: [r`How do you restore a single item?`],
  pit: [r`Discovering during an incident that restored tables lack streams and alarms.`] },

{ id: 'q18', level: 'Intermediate', tags: ['comparison'],
  code: r`~~~sql
-- The kind of query that signals DynamoDB is the wrong home: ad hoc, multi-attribute, aggregating
SELECT m.region, date_trunc('week', o.created_at) AS wk, count(*), sum(o.total)
FROM orders o JOIN merchants m ON m.id = o.merchant_id
WHERE o.status IN ('PAID','REFUNDED') AND o.channel = 'mobile'
GROUP BY 1, 2 ORDER BY 2 DESC;
-- In DynamoDB: a new GSI per filter combination plus client-side aggregation, or offload to S3 + Athena
~~~`,
  q: r`When is DynamoDB the wrong choice?`,
  a: r`- **Unknown or ad hoc query patterns**: analysts and product teams need flexible filtering, joins and aggregations.
- **Complex relational integrity** across many entities with frequent multi-entity transactions.
- **Heavy analytics** directly on the operational store.
- **Large items** (over 400 KB) without an S3 offload pattern.
- **Teams new to DynamoDB modelling** under time pressure, with frequently changing requirements.
- **Full-text search** and geospatial queries (need OpenSearch or another service).
- **Multi-cloud portability** requirements.

It shines for: known, high-volume key-based access, serverless architectures, unpredictable scale, single-digit ms latency at any size, and minimal operations.

A pragmatic answer combines: DynamoDB for the operational core, streams to OpenSearch for search, and exports to S3/Athena for analytics.`,
  pts: [r`Ad hoc queries`, r`Relational integrity`, r`Analytics on OLTP`, r`400 KB item limit`, r`Shines for known key access at scale`],
  ex: r`A back-office admin system on DynamoDB required a new GSI for every report request; migrating it to Aurora PostgreSQL removed months of index churn.`,
  fu: [r`How would you add analytics to a DynamoDB system?`],
  pit: [r`Choosing DynamoDB because it is serverless, without access patterns.`] },

{ id: 'q19', level: 'Senior', tags: ['single-table', 'design'],
  dia: r`erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ ORDER_ITEM : contains
  ORDER ||--o{ SHIPMENT : ships_as
  ORDER ||--|| PAYREF : "guard item (unique)"
  CUSTOMER {
    string partitionKey "CUST#c1"
    string sortKey "PROFILE"
  }
  ORDER {
    string partitionKey "ORDER#o1"
    string sortKey "META"
    string gsi1Key "CUST#c1"
    string gsi2Key "STATUS#PAID#day#shard"
  }
  ORDER_ITEM {
    string partitionKey "ORDER#o1"
    string sortKey "ITEM#001"
  }
  SHIPMENT { string partitionKey "ORDER#o1" string sortKey "SHIP#s1" }`,
  q: r`Design the DynamoDB model for an e-commerce order system (customers, orders, items, shipments, status queries).`,
  a: r`Access patterns: get order with items and shipments; list a customer's orders newest first; list orders by status per day for operations; get order by external payment id; get customer profile.

~~~text
Entity     PK                SK                        GSI1PK              GSI1SK                 GSI2PK                      GSI2SK
Customer   CUST#c1           PROFILE
Order      ORDER#o1          META                      CUST#c1             2026-10-10T10:00#o1    STATUS#PAID#2026-10-10#3    o1
OrderItem  ORDER#o1          ITEM#001
Shipment   ORDER#o1          SHIP#s1
PayRef     PAYREF#pi_123     ORDER                     (attribute: orderId)
~~~

- Order with items/shipments: {{Query PK = ORDER#o1}}.
- Customer orders: {{GSI1 PK = CUST#c1}}, {{ScanIndexForward=false}}.
- Ops by status/day: GSI2 with a **shard suffix** (0..9) to spread a busy day's writes; query 10 shards in parallel.
- Payment id lookup: guard item {{PAYREF#}} written in the same transaction as the order (also enforces uniqueness).
- Status changes update {{GSI2PK}} so the item moves between status buckets.

Large or rarely used data (invoice PDFs) in S3 with a pointer. Search ("find orders by product name") via streams into OpenSearch. Analytics via export to S3.`,
  pts: [r`Item collection for order aggregate`, r`GSI1 customer timeline`, r`Sharded status GSI`, r`Guard item for external id`, r`Offload search and analytics`],
  ex: r`This model served order detail in one Query (~6 ms) at 8,000 orders/minute peak.`,
  fu: [r`How do you add "orders by merchant" later?`, r`What if a single order has 10,000 items?`],
  pit: [r`Putting all orders of a customer in one item (400 KB limit).`] },

{ id: 'q20', level: 'Senior', tags: ['global-tables', 'multi-region'],
  code: r`~~~csharp
// Home-region routing: each customer has exactly one writer region
public sealed class RegionRouter(IReadOnlyDictionary<string, IAmazonDynamoDB> clients, string localRegion)
{
    public IAmazonDynamoDB ForWrite(Customer c) => clients[c.HomeRegion];   // avoids LWW conflicts
    public IAmazonDynamoDB ForRead() => clients[localRegion];               // local, eventually consistent
}
// Per-region counter items summed on read instead of one contended item
// PK = POINTS#cust-42, SK = REGION#eu-west-1 | REGION#us-east-1  -> Query PK, sum the values
~~~`,
  dia: r`flowchart LR
  subgraph EU[eu-west-1]
    A1[API] --> T1[(orders replica)]
  end
  subgraph US[us-east-1]
    A2[API] --> T2[(orders replica)]
  end
  T1 <-- "async replication ~1s, last writer wins" --> T2
  U1[EU customer, home EU] -->|writes| A1
  U2[US customer, home US] -->|writes| A2`,
  q: r`How do global tables work and how do you handle conflicts?`,
  a: r`Global tables replicate a table across regions with **multi-active** writes. Default mode (multi-region eventual consistency): replication typically under a second; concurrent writes to the same item in different regions resolve with **last writer wins** by timestamp, so one write silently disappears.

Strategies:

- **Home region per item** (per user/tenant): route writes for an entity to its home region; other regions read locally. Avoids conflicts entirely; failover moves the home.
- **Commutative updates**: counters with {{ADD}} still conflict at item level under LWW (each region's full item version wins), so prefer per-region counter items summed on read.
- **Conditional writes** only protect within a region; cross-region races still exist in eventual mode.
- **Multi-Region Strong Consistency (MRSC)**: three regions, strongly consistent reads and writes with higher write latency; check region availability and feature limits (e.g. transactions) before relying on it.

Also: TTL deletes and streams per region; costs include replicated writes (rWCU) in every region.`,
  pts: [r`Multi-active, ~1 s replication`, r`LWW loses concurrent writes`, r`Home-region routing`, r`Per-region counters`, r`MRSC option with latency cost`],
  ex: r`A loyalty-points system lost points when two regions updated the same balance; switching to per-region ledger items summed on read eliminated losses.`,
  fu: [r`How would you fail over a home region safely?`],
  pit: [r`Assuming conditional writes prevent cross-region conflicts.`] },

{ id: 'q21', level: 'Senior', tags: ['outbox', 'events'],
  code: r`~~~csharp
await ddb.TransactWriteItemsAsync(new TransactWriteItemsRequest
{
    TransactItems =
    [
        new() { Put = new Put { TableName = "app", Item = OrderItem(order), ConditionExpression = "attribute_not_exists(PK)" } },
        new() { Put = new Put { TableName = "app", Item = new()
        {
            ["PK"] = new("ORDER#" + order.Id), ["SK"] = new("OUTBOX#" + evt.EventId),
            ["type"] = new("OrderPlaced"), ["payload"] = new(JsonSerializer.Serialize(evt)),
            ["ttl"] = new() { N = DateTimeOffset.UtcNow.AddDays(2).ToUnixTimeSeconds().ToString() }
        } } }
    ]
}, ct);
~~~`,
  q: r`How do you publish domain events reliably from a DynamoDB-backed service?`,
  a: r`Options:

1. **Streams as the outbox**: the item change itself is the event source; a Lambda transforms stream records into domain events and publishes to EventBridge/SNS/Kafka. Simple, but couples event schema to table schema.
2. **Explicit outbox items**: in the same {{TransactWriteItems}}, write the business item and an {{OUTBOX#}} item containing the domain event (stable contract). A stream consumer filters outbox items, publishes, and deletes them (or lets TTL clean up).
3. **EventBridge Pipes** from the stream with filtering and enrichment, no custom Lambda.

~~~mermaid
flowchart LR
  API[.NET API] -->|TransactWriteItems: Order + OutboxEvent| T[(DynamoDB)]
  T --> S[DynamoDB Stream]
  S --> P[EventBridge Pipe / Lambda filter OUTBOX#]
  P --> EB[EventBridge bus]
  EB --> C1[Billing]
  EB --> C2[Notifications]
~~~

Guarantees: at-least-once, per-key order from the stream; downstream consumers deduplicate by event id. Handle consumer lag beyond 24 h (alarms on IteratorAge).`,
  pts: [r`Stream as outbox`, r`Explicit outbox item in transaction`, r`Pipes for filtering`, r`At-least-once, dedupe`, r`IteratorAge alarms`],
  ex: r`A team moved from publishing to SNS after PutItem (losing events on Lambda timeouts) to outbox items via streams, removing all gaps found by reconciliation.`,
  fu: [r`How do you keep event ordering across aggregates?`],
  pit: [r`Publishing events directly after the write in application code.`] },

{ id: 'q22', level: 'Senior', tags: ['aggregates', 'counters'],
  code: r`~~~csharp
// Exactly-once aggregate update: marker item + increment in one transaction
await ddb.TransactWriteItemsAsync(new TransactWriteItemsRequest
{
    TransactItems =
    [
        new() { Put = new Put { TableName = "aggs", Item = new() { ["PK"] = new("EVT#" + evt.Id), ["SK"] = new("SEEN"),
            ["ttl"] = new() { N = DateTimeOffset.UtcNow.AddDays(7).ToUnixTimeSeconds().ToString() } },
            ConditionExpression = "attribute_not_exists(PK)" } },             // duplicate delivery -> cancelled
        new() { Update = new Update { TableName = "aggs",
            Key = new() { ["PK"] = new("AGG#" + evt.MerchantId + "#" + evt.Day), ["SK"] = new("TOTAL") },
            UpdateExpression = "ADD orderCount :one, amountMinor :amt",
            ExpressionAttributeValues = new() { [":one"] = new() { N = "1" }, [":amt"] = new() { N = evt.AmountMinor.ToString() } } } }
    ]
}, ct);
~~~`,
  q: r`How do you maintain counts and aggregates (e.g. order totals per merchant per day) in DynamoDB?`,
  a: r`DynamoDB has no {{COUNT(*)}} or {{SUM}} over queries without reading everything. Approaches:

- **Atomic counters** with {{UpdateItem ADD}}: simple but not idempotent; a retried request increments twice. Combine with a condition on a processed-event set or use transactions with an idempotency item.
- **Stream-driven aggregation**: a Lambda consumes changes and updates aggregate items ({{AGG#merchant#2026-10-10}}). Make it idempotent by storing the last processed sequence per aggregate or by writing per-event marker items in a transaction.
- **Sharded counters** for hot aggregates, summed on read.
- **Periodic batch** over an export to S3 with Athena for non-real-time reports.

For financial totals, prefer recomputation from source records for reconciliation, with real-time aggregates as approximations displayed in dashboards.`,
  pts: [r`No server-side aggregation`, r`ADD is not idempotent`, r`Stream-driven aggregates`, r`Sharded hot counters`, r`Batch for reports, reconcile money`],
  ex: r`A merchant dashboard's daily totals drifted by retries; adding per-event marker items in a transaction made the aggregate exactly-once.`,
  fu: [r`How would you correct an aggregate after a bug?`],
  pit: [r`Scanning the table on each dashboard load.`] },

{ id: 'q23', level: 'Senior', tags: ['multi-tenancy'],
  code: r`~~~csharp
// Tenant-aware data layer: keys are always built from the authenticated tenant, never from input
public sealed class TenantKeys(ITenantContext tenant)
{
    public string Pk(string entity, string id) => "TENANT#" + tenant.Id + "#" + entity + "#" + id;
}
// Session tags give the role a tenant attribute for IAM dynamodb:LeadingKeys (ABAC)
var creds = await sts.AssumeRoleAsync(new AssumeRoleRequest
{
    RoleArn = "arn:aws:iam::123456789012:role/tenant-data-access", RoleSessionName = "req-" + requestId,
    Tags = [new Tag { Key = "tenant", Value = tenant.Id }]
}, ct);
~~~`,
  q: r`Design multi-tenancy on DynamoDB for a SaaS product.`,
  a: r`Models:

- **Pooled**: one table, tenant id prefixed in partition keys ({{TENANT#t1#ORDER#o1}}). Cheapest, simplest ops, needs strong isolation enforcement.
- **Silo**: table per tenant (or account per tenant for the largest). Strong isolation and per-tenant backup/restore, but thousands of tables and deploys.
- **Hybrid**: pooled for most, silo for enterprise or regulated tenants.

Isolation in pooled mode:

- IAM with {{dynamodb:LeadingKeys}} using a tenant claim via session tags (ABAC), so code cannot cross tenants.
- Data-access layer that always builds keys from the authenticated tenant.
- Tests attempting cross-tenant reads.

Noisy neighbours: large tenants create hot partitions; spread their data (tenant + entity id keys), rate-limit per tenant at the API, and graduate them to silo when needed. Tenant offboarding in pooled mode means deleting all their items (query by tenant GSI and batch delete) or relying on silo tables for fast deletion.`,
  pts: [r`Pool, silo, hybrid`, r`LeadingKeys ABAC isolation`, r`Tenant-aware data layer`, r`Noisy-neighbour controls`, r`Offboarding cost`],
  ex: r`A B2B SaaS pooled 4,000 small tenants and siloed 12 enterprise tenants into dedicated tables with their own KMS keys.`,
  fu: [r`How do you measure per-tenant cost?`],
  pit: [r`Tenant id only as an attribute filtered after reading.`] },

{ id: 'q24', level: 'Senior', tags: ['migration', 'schema-evolution'],
  code: r`~~~csharp
// Throttled, resumable backfill with a parallel Scan segment per worker
async Task BackfillSegmentAsync(int segment, int total, RateLimiter limiter, CancellationToken ct)
{
    Dictionary<string, AttributeValue>? start = await Checkpoints.LoadAsync(segment);
    do
    {
        var page = await ddb.ScanAsync(new ScanRequest { TableName = "app", Segment = segment, TotalSegments = total,
            ExclusiveStartKey = start, Limit = 200, FilterExpression = "attribute_not_exists(merchantKey)" }, ct);
        foreach (var item in page.Items)
        {
            using var lease = await limiter.AcquireAsync(1, ct);                 // capacity budget
            try
            {
                await ddb.UpdateItemAsync(new UpdateItemRequest { TableName = "app", Key = KeyOf(item),
                    UpdateExpression = "SET merchantKey = :m", ConditionExpression = "attribute_not_exists(merchantKey)",
                    ExpressionAttributeValues = new() { [":m"] = new("MERCH#" + item["merchantId"].S) } }, ct);
            }
            catch (ConditionalCheckFailedException) { /* already done: idempotent */ }
        }
        start = page.LastEvaluatedKey is { Count: > 0 } k ? k : null;
        await Checkpoints.SaveAsync(segment, start);
    } while (start is not null);
}
~~~`,
  q: r`How do you evolve a DynamoDB data model or add a new access pattern after launch?`,
  a: r`Options from least to most effort:

1. **New GSI** on existing attributes: create it (online backfill, consumes write capacity on the index); watch {{OnlineIndexPercentageProgress}}.
2. **New attribute + GSI**: deploy code writing the new attribute for new/updated items, then **backfill** existing items with a parallel Scan (segments) + conditional UpdateItem, rate-limited.
3. **Key redesign**: create a new table, dual-write (or stream from old to new), backfill via export/import or Scan, verify, switch reads, then stop writing the old table.

Backfill practices: idempotent updates ({{attribute_not_exists(newAttr)}}), checkpointing segments, throttling to a capacity budget, metrics on progress and errors.

Version items ({{schemaVersion}}) so code can read old and new shapes during the transition.`,
  pts: [r`New GSI is online`, r`Backfill with parallel Scan + conditional updates`, r`New table + stream for key changes`, r`Idempotent, checkpointed, throttled`, r`Schema version attribute`],
  ex: r`Adding "orders by merchant" needed a new attribute; a 3-hour throttled backfill over 400 M items populated it while traffic continued.`,
  fu: [r`How do you verify the backfill is complete?`],
  pit: [r`Running an unthrottled Scan that consumes all table capacity.`] },

{ id: 'q25', level: 'Senior', tags: ['large-items', 's3'],
  code: r`~~~csharp
// S3 first, then the pointer item; an orphaned object is cleaned by a lifecycle rule
var key = "claims/" + claim.Id + "/v" + claim.Version + ".json.gz";
await s3.PutObjectAsync(new PutObjectRequest { BucketName = "claims-docs", Key = key, InputStream = Gzip(doc),
    ChecksumAlgorithm = ChecksumAlgorithm.SHA256 }, ct);
await ddb.PutItemAsync("claims", new()
{
    ["PK"] = new("CLAIM#" + claim.Id), ["SK"] = new("DOC#v" + claim.Version),
    ["s3Key"] = new(key), ["sizeBytes"] = new() { N = size.ToString() }, ["sha256"] = new(hash)
}, ct);
~~~`,
  q: r`How do you handle large items and documents with DynamoDB's 400 KB limit?`,
  a: r`- **S3 offload**: store the large payload in S3 and keep metadata and a pointer (bucket/key, size, hash, version) in DynamoDB. Write order: S3 first, then the DynamoDB item (if DynamoDB fails, an orphaned S3 object can be cleaned by lifecycle rules).
- **Vertical partitioning**: split an entity into multiple items in the same partition (header, details, history) and read only what you need.
- **Compression** (gzip/brotli in a Binary attribute) for moderately large text.
- **Chunking** for items that must stay in DynamoDB: multiple items {{CHUNK#1..n}}; read with a Query.

Also remember capacity is charged per KB: a 100 KB item costs 100 WCU to write and 25 RCU to read strongly. Large items make every access expensive, so splitting hot small attributes from cold large ones saves cost.`,
  pts: [r`S3 pointer pattern`, r`Vertical partitioning`, r`Compression`, r`Chunking`, r`Cost scales with item size`],
  ex: r`A claims system moved 300 KB claim documents to S3 and kept a 2 KB summary item; read costs dropped 90%.`,
  fu: [r`How do you keep S3 and DynamoDB consistent?`],
  pit: [r`Updating a single attribute on a 300 KB item frequently.`] },

{ id: 'q26', level: 'Senior', tags: ['throttling', 'incident'],
  code: r`~~~bash
# Which index is throttling?
aws cloudwatch get-metric-statistics --namespace AWS/DynamoDB --metric-name WriteThrottleEvents \
  --dimensions Name=TableName,Value=orders Name=GlobalSecondaryIndexName,Value=GSI2 \
  --start-time 2026-10-10T09:00:00Z --end-time 2026-10-10T10:00:00Z --period 60 --statistics Sum
# Which keys are hot?
aws dynamodb update-contributor-insights --table-name orders --contributor-insights-action ENABLE
# Pre-warm for a planned event (warm throughput)
aws dynamodb update-table --table-name orders --warm-throughput ReadUnitsPerSecond=40000,WriteUnitsPerSecond=20000
~~~
~~~csharp
var cfg = new AmazonDynamoDBConfig { RetryMode = RequestRetryMode.Adaptive, MaxErrorRetry = 5 };  // client-side rate limiting
~~~`,
  q: r`Your service is getting ProvisionedThroughputExceededException during peak. Diagnose and fix.`,
  a: r`1. **Where**: table or a GSI? CloudWatch {{ThrottledRequests}}, {{ReadThrottleEvents}}, {{WriteThrottleEvents}} per index. A GSI with insufficient capacity throttles base-table writes.
2. **Why**: total capacity too low (consumed vs provisioned), or **hot keys** (Contributor Insights shows top keys). Auto scaling lag (target tracking reacts in minutes) for sudden spikes.
3. **Immediate**: raise capacity or switch to on-demand (instant scaling up to previous peaks), add jitter to client retries (SDK adaptive retry mode).
4. **Structural**: fix hot keys (sharding), cache hot reads (DAX), reduce item sizes, use eventually consistent reads, drop unnecessary GSI projections, smooth batch jobs with rate limiting, pre-warm for planned events (on-demand warm throughput setting).

Also check client behaviour: retries with no backoff amplify throttling, and Lambda concurrency spikes can overwhelm the table.`,
  pts: [r`Table vs GSI throttling`, r`Hot keys via Contributor Insights`, r`Auto scaling lag`, r`On-demand / warm throughput`, r`Fix keys, cache, smooth batches`],
  ex: r`A nightly batch job throttled the customer API's table; capping the job's concurrency and using a token bucket fixed it.`,
  fu: [r`What is warm throughput?`],
  pit: [r`Only increasing capacity while a hot key keeps throttling.`] },

{ id: 'q27', level: 'Senior', tags: ['testing'],
  code: r`~~~csharp
public sealed class DynamoFixture : IAsyncLifetime
{
    private readonly IContainer _ddb = new ContainerBuilder().WithImage("amazon/dynamodb-local:2.5.2")
        .WithPortBinding(8000, true).WithWaitStrategy(Wait.ForUnixContainer().UntilPortIsAvailable(8000)).Build();
    public IAmazonDynamoDB Client { get; private set; } = null!;
    public async Task InitializeAsync()
    {
        await _ddb.StartAsync();
        Client = new AmazonDynamoDBClient(new BasicAWSCredentials("x", "x"),
            new AmazonDynamoDBConfig { ServiceURL = "http://localhost:" + _ddb.GetMappedPublicPort(8000) });
        await TableSetup.CreateAsync(Client);
    }
    public Task DisposeAsync() => _ddb.DisposeAsync().AsTask();
}
[Fact] public async Task Concurrent_debits_cannot_overdraw() { /* run 20 debits in parallel, assert final balance >= 0 */ }
~~~`,
  q: r`How do you test DynamoDB-based .NET code?`,
  a: r`- **DynamoDB Local** (Docker image) or **LocalStack** via Testcontainers for integration tests: real request/response semantics for keys, conditions, transactions, GSIs.
- Caveats: DynamoDB Local does not emulate throttling, capacity, or exact consistency behaviour; GSIs are immediately consistent locally; some newer features lag.
- **Contract tests** for key builders and serialization (entity → item → entity).
- **Condition tests**: concurrent writes asserting ConditionalCheckFailedException paths.
- **Load tests** against a real table in a test account with realistic key distributions to find hot partitions and capacity needs.
- **Infrastructure tests**: CDK/Terraform assertions for PITR, encryption, alarms, deletion protection.

Avoid mocking {{IAmazonDynamoDB}} for repository logic; mocks pass while real conditions fail.`,
  pts: [r`DynamoDB Local / LocalStack`, r`Local does not emulate throttling`, r`Condition and concurrency tests`, r`Load test real tables`, r`IaC assertions`],
  ex: r`A load test in a staging account revealed a hot GSI partition on "status = PENDING" that local tests never could.`,
  fu: [r`How do you seed realistic data volumes for load tests?`],
  pit: [r`Unit tests with mocked SDK calls as the only test.`] },

{ id: 'q28', level: 'Senior', tags: ['observability'],
  code: r`~~~csharp
// OpenTelemetry: trace every DynamoDB call from .NET (OpenTelemetry.Instrumentation.AWS)
builder.Services.AddOpenTelemetry().WithTracing(t => t
    .AddAspNetCoreInstrumentation()
    .AddAWSInstrumentation()             // spans per DynamoDB call: table, operation, consumed capacity
    .AddOtlpExporter());
~~~
~~~yaml
# CloudWatch alarm (CloudFormation excerpt): any sustained GSI write throttling pages on-call
GsiThrottleAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    Namespace: AWS/DynamoDB
    MetricName: WriteThrottleEvents
    Dimensions: [{ Name: TableName, Value: orders }, { Name: GlobalSecondaryIndexName, Value: GSI1 }]
    Statistic: Sum
    Period: 60
    EvaluationPeriods: 3
    Threshold: 1
    ComparisonOperator: GreaterThanOrEqualToThreshold
~~~`,
  q: r`What should you monitor for DynamoDB?`,
  a: r`- **Throttling**: ThrottledRequests and Read/WriteThrottleEvents per table and GSI. Alert on any sustained throttling.
- **Latency**: SuccessfulRequestLatency per operation (server side) plus client-side p99 (SDK metrics, OpenTelemetry AWS instrumentation).
- **Capacity**: Consumed vs provisioned RCU/WCU, AccountMaxReads/Writes utilisation.
- **Errors**: SystemErrors (5xx, retry), UserErrors (4xx, often IAM or validation bugs), ConditionalCheckFailedRequests (contention signal).
- **Streams/Lambda**: IteratorAge (lag), errors, DLQ depth.
- **Global tables**: ReplicationLatency, PendingReplicationCount.
- **Contributor Insights** on hot tables for top keys.
- **Cost**: per-table cost allocation tags, anomaly detection.

Use X-Ray/OpenTelemetry traces to see how many DynamoDB calls a request makes (N+1 patterns exist in NoSQL too).`,
  pts: [r`Throttles per index`, r`Server and client latency`, r`Conditional check failures`, r`IteratorAge`, r`Replication latency`],
  ex: r`Rising ConditionalCheckFailedRequests revealed retry storms on a contended inventory item before customers noticed.`,
  fu: [r`How do you find N+1 DynamoDB calls?`],
  pit: [r`Monitoring only consumed capacity.`] },

{ id: 'q29', level: 'Senior', tags: ['lambda', 'serverless'],
  code: r`~~~csharp
public sealed class Function
{
    // created once per execution environment, reused across warm invocations
    private static readonly IAmazonDynamoDB Ddb = new AmazonDynamoDBClient(new AmazonDynamoDBConfig
    {
        Timeout = TimeSpan.FromSeconds(2), MaxErrorRetry = 2, RetryMode = RequestRetryMode.Standard
    });
    public async Task Handler(SQSEvent evt, ILambdaContext ctx)
    {
        using var cts = new CancellationTokenSource(ctx.RemainingTime - TimeSpan.FromMilliseconds(500));
        foreach (var batch in evt.Records.Chunk(25))
            await BatchWriter.WriteAllAsync(Ddb, "events", batch.Select(ToItem), cts.Token); // retries UnprocessedItems
    }
}
~~~`,
  q: r`What are the pitfalls of DynamoDB with Lambda at scale?`,
  a: r`- **Concurrency bursts**: thousands of Lambdas can overwhelm a provisioned table; on-demand or reserved concurrency limits protect it.
- **Client reuse**: initialise the SDK client outside the handler; enable HTTP keep-alive (default in recent SDKs).
- **Timeouts**: SDK default timeouts may exceed the Lambda timeout; set request timeouts and retries so the function fails cleanly.
- **Stream processing**: batch size, parallelization factor (up to 10 per shard), bisect on error, partial batch responses, idempotent processing.
- **Cold starts** in .NET: Native AOT or SnapStart for .NET to reduce initialisation, which includes SDK setup.
- **Cost**: per-invocation small writes can be more expensive than batching; consider SQS buffering with batch writes for high-volume ingestion.`,
  pts: [r`Concurrency vs table capacity`, r`Client outside handler`, r`Timeout alignment`, r`Stream batch settings`, r`.NET cold starts`],
  ex: r`An ingestion Lambda scaling to 3,000 concurrent executions throttled the table; an SQS buffer with batch writes stabilised throughput at lower cost.`,
  fu: [r`How does SnapStart help .NET Lambdas?`],
  pit: [r`Unlimited Lambda concurrency in front of a provisioned table.`] },

{ id: 'q30', level: 'Senior', tags: ['search', 'analytics'],
  code: r`~~~sql
-- Athena over a DynamoDB export: analysts query without touching table capacity
CREATE EXTERNAL TABLE orders_export (Item struct<PK:struct<S:string>, total:struct<N:string>, status:struct<S:string>, createdAt:struct<S:string>>)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
LOCATION 's3://orders-exports/AWSDynamoDB/01696900000000-abc/data/';

SELECT item.status.s AS status, count(*) AS orders, sum(cast(item.total.n AS decimal(18,2))) AS revenue
FROM orders_export WHERE item.createdAt.s >= '2026-10-01' GROUP BY 1;
~~~`,
  q: r`How do you add search and analytics to a DynamoDB system?`,
  a: r`**Search**: stream changes to **OpenSearch**, either via the zero-ETL integration (OpenSearch Ingestion pipeline from DynamoDB with initial export + stream) or a Lambda consumer. Accept seconds of lag. Index only the fields needed; enforce tenant filters in the search queries.

**Analytics**:

- **Export to S3** (full or incremental) → Athena/Glue tables → BI tools. No impact on table capacity.
- **Zero-ETL integration to Redshift** for near-real-time analytics.
- Stream to Kinesis Firehose → S3 (Parquet) for event-level history.

Design notes: the operational model (single-table with overloaded keys) is not analyst-friendly; transform into entity-specific tables in the analytics layer. Keep PII handling consistent in every copy (masking, retention, erasure).`,
  pts: [r`Zero-ETL or stream to OpenSearch`, r`Export to S3 + Athena`, r`Zero-ETL to Redshift`, r`Transform single-table for analysts`, r`PII in every copy`],
  ex: r`An operations team got ad hoc order queries in Athena over daily incremental exports, ending requests for new GSIs.`,
  fu: [r`How do you handle deletes in the search index?`],
  pit: [r`Running Scans for reporting on the live table.`] },

{ id: 'q31', level: 'Senior', tags: ['cost'],
  code: r`~~~bash
# Storage-heavy table: Standard-IA class (cheaper storage, pricier requests)
aws dynamodb update-table --table-name audit-log --table-class STANDARD_INFREQUENT_ACCESS
~~~
~~~csharp
// Project only what the query needs into the GSI (CDK)
table.AddGlobalSecondaryIndex(new GlobalSecondaryIndexProps
{
    IndexName = "GSI1",
    PartitionKey = new Attribute { Name = "GSI1PK", Type = AttributeType.STRING },
    SortKey = new Attribute { Name = "GSI1SK", Type = AttributeType.STRING },
    ProjectionType = ProjectionType.INCLUDE,
    NonKeyAttributes = ["total", "status"]          // not ALL: every projected byte is written again
});
~~~`,
  q: r`How do you reduce DynamoDB cost?`,
  a: r`- **Choose capacity mode by data**: provisioned + reserved for steady load; on-demand for spiky.
- **Smaller items**: short attribute names (they count toward size), compress large values, move blobs to S3.
- **Eventually consistent reads** where acceptable (half price).
- **GSI hygiene**: remove unused GSIs; project only needed attributes (KEYS_ONLY/INCLUDE); sparse indexes.
- **Avoid Scans** and filters that read-and-discard.
- **TTL** for transient data (free deletes).
- **Table class**: Standard-Infrequent Access for tables where storage dominates cost (~60% cheaper storage, higher request cost).
- **DAX/cache** for hot repeated reads.
- **Batch ingestion** smoothing to allow lower provisioned capacity.

Measure with cost allocation tags per table and calculate cost per business unit (per order).`,
  pts: [r`Right capacity mode`, r`Item size reduction`, r`GSI projections and pruning`, r`Standard-IA table class`, r`TTL and no Scans`],
  ex: r`An audit-log table where storage was 80% of cost moved to Standard-IA, saving about 50% of its bill.`,
  fu: [r`How do GSIs multiply write cost?`],
  pit: [r`Projecting ALL attributes into every GSI.`] },

{ id: 'q32', level: 'Senior', tags: ['idempotency', 'payments'],
  q: r`Implement idempotent payment creation with DynamoDB.`,
  a: r`Use the client's {{Idempotency-Key}} as part of a guard item written atomically with the payment:

~~~text
TransactWriteItems (ClientRequestToken = hash(idempotencyKey)):
  Put PK=IDEMP#merchant#key  SK=REQ  { requestHash, paymentId, status=IN_PROGRESS, ttl=+24h }
      Condition attribute_not_exists(PK)
  Put PK=PAYMENT#p1           SK=META { amount, currency, status=CREATED }
~~~

- If the transaction fails with ConditionalCheckFailed on the IDEMP item: read it; if {{requestHash}} differs, return 422 (key reused with different payload); if a completed response exists, return it; if in progress, return 409 or wait.
- After calling the payment provider, update the IDEMP item with the final response.
- Scope keys per merchant; TTL long enough to cover client retry windows (24 to 72 h).
- The provider call itself must also be idempotent (pass the same idempotency key to Stripe/Adyen), because a crash after the provider charged but before you recorded the result needs a safe retry.

This gives exactly-once effects: at-least-once retries + deduplication.`,
  pts: [r`Guard item in transaction`, r`Request hash check`, r`Store final response`, r`Provider idempotency key too`, r`TTL by retry window`],
  ex: r`A mobile client's retry after a network timeout returned the stored response instead of creating a second charge.`,
  fu: [r`What if the process dies after charging but before updating the record?`],
  pit: [r`Only checking the key without comparing the request payload.`] },

{ id: 'q33', level: 'Senior', tags: ['time-series'],
  q: r`How would you model time-series or event data in DynamoDB?`,
  a: r`Key pattern: partition by entity and time bucket, sort by timestamp.

~~~text
PK = DEVICE#d42#2026-10-10     SK = 2026-10-10T13:45:12.123Z#seq
~~~

- **Time bucketing** (per day/hour) bounds partition size and spreads writes over time.
- Query a range: {{PK = DEVICE#d42#2026-10-10 AND SK BETWEEN t1 AND t2}}; multi-day ranges query several buckets in parallel.
- **Latest value**: a separate {{LATEST}} item per device updated on each write (or a GSI).
- **Retention** with TTL, plus archival via streams/exports to S3 for long-term analytics.
- **Table per period** (monthly tables) for very high volumes: drop old tables instead of TTL deletes, and set older tables to lower capacity or IA class.

For heavy analytical queries over time series (downsampling, aggregations), use Timestream/InfluxDB or S3 + Athena; DynamoDB serves recent, key-based lookups.`,
  pts: [r`Entity + time bucket partition`, r`Timestamp sort key`, r`Latest item pattern`, r`TTL + archive`, r`Analytics elsewhere`],
  ex: r`A fleet-telemetry service stored 7 days hot in DynamoDB with hourly buckets and archived to S3 Parquet for analysis.`,
  fu: [r`How do you choose bucket size?`],
  pit: [r`Partitioning only by date (all devices on one hot key).`] },

{ id: 'q34', level: 'Senior', tags: ['partiql'],
  code: r`~~~csharp
// Key-based PartiQL: fine
await ddb.ExecuteStatementAsync(new ExecuteStatementRequest
{
    Statement = "SELECT * FROM \"app\" WHERE PK = ? AND begins_with(SK, ?)",
    Parameters = [new AttributeValue("ORDER#981"), new AttributeValue("ITEM#")]
}, ct);
// "SELECT * FROM app WHERE status = 'OPEN'"  -> silently a full table Scan
~~~
~~~json
{ "Effect": "Deny", "Action": "dynamodb:PartiQLSelect", "Resource": "*",
  "Condition": { "Bool": { "dynamodb:FullTableScan": "true" } } }
~~~`,
  q: r`Should you use PartiQL with DynamoDB?`,
  a: r`PartiQL gives SQL-like syntax ({{SELECT * FROM "app" WHERE PK = 'ORDER#1'}}) over the same APIs. It is convenient for console exploration and for developers new to DynamoDB.

Risks:

- A {{SELECT}} without a key condition on the partition key becomes a **full Scan**, silently expensive. Use IAM to deny full-table scans via PartiQL ({{dynamodb:FullTableScan}} condition key).
- It hides DynamoDB's access-pattern discipline behind familiar syntax, encouraging relational habits.
- Some features (e.g. certain expressions) are more natural via the native API.

Use PartiQL for tooling and batch statements where the team enforces key-based queries; prefer the native API in application code for clarity and control.`,
  pts: [r`SQL-like syntax over same engine`, r`Can trigger full Scans`, r`Deny FullTableScan via IAM`, r`Native API in app code`],
  ex: r`A developer's PartiQL query without a partition key scanned a 2 TB table repeatedly from a cron job; an IAM deny on full scans prevented recurrence.`,
  fu: [r`How do you audit expensive queries?`],
  pit: [r`Assuming PartiQL adds query capabilities DynamoDB lacks.`] },

{ id: 'q35', level: 'Senior', tags: ['comparison', 'cosmos'],
  code: r`~~~csharp
// Cosmos DB equivalent of a DynamoDB Query on one partition
var q = container.GetItemLinqQueryable<OrderDoc>(requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey("CUST#42") })
    .Where(o => o.Type == "order" && o.CreatedAt >= from)
    .OrderByDescending(o => o.CreatedAt)
    .ToFeedIterator();
while (q.HasMoreResults) { var page = await q.ReadNextAsync(ct); Console.WriteLine(page.RequestCharge); } // RU per page
// DynamoDB: KeyConditionExpression "PK = :c AND SK >= :from" on the table or a GSI
~~~`,
  q: r`Compare DynamoDB with Azure Cosmos DB for a .NET team choosing a cloud NoSQL store.`,
  a: r`| | DynamoDB | Cosmos DB (NoSQL API) |
|---|---|---|
| Model | Key-value / wide column, items up to 400 KB | JSON documents up to 2 MB |
| Querying | Key conditions on table/indexes | SQL-like queries, automatic indexing of all properties by default |
| Capacity | RCU/WCU or on-demand | Request Units (RU/s), provisioned, autoscale or serverless |
| Consistency | Eventual / strong (per region), MRSC | Five levels: strong, bounded staleness, session (default), consistent prefix, eventual |
| Multi-region | Global tables (LWW, MRSC) | Multi-region writes with LWW or custom conflict resolution |
| Change feed | Streams (24 h) | Change feed (retained with data), all-versions mode |
| .NET SDK | AWS SDK | Excellent .NET SDK, LINQ provider |

Decision usually follows the cloud platform. Cosmos offers more query flexibility (cost: RU per query, index tuning); DynamoDB demands stricter modelling but gives very predictable performance and simpler pricing for key-based access.`,
  pts: [r`Cloud alignment drives choice`, r`Cosmos: richer queries, five consistency levels`, r`DynamoDB: strict modelling, predictable`, r`Pricing models RU vs RCU/WCU`],
  ex: r`An Azure-native team chose Cosmos DB with session consistency for a profile service; an AWS-native team used DynamoDB for the same pattern.`,
  fu: [r`How would you port a single-table design to Cosmos DB?`],
  pit: [r`Treating Cosmos automatic indexing as free (RU cost on writes).`] },

{ id: 'q36', level: 'Senior', tags: ['resilience'],
  code: r`~~~csharp
builder.Services.AddSingleton<IAmazonDynamoDB>(_ => new AmazonDynamoDBClient(new AmazonDynamoDBConfig
{
    RetryMode = RequestRetryMode.Adaptive, MaxErrorRetry = 4, Timeout = TimeSpan.FromSeconds(3)
}));
// Circuit breaker for prolonged failures (Polly v8 via Microsoft.Extensions.Resilience)
builder.Services.AddResiliencePipeline("ddb", p => p
    .AddCircuitBreaker(new CircuitBreakerStrategyOptions { FailureRatio = 0.5, MinimumThroughput = 20,
        SamplingDuration = TimeSpan.FromSeconds(30), BreakDuration = TimeSpan.FromSeconds(15) })
    .AddTimeout(TimeSpan.FromSeconds(2)));
// Do not wrap SDK retries in another retry loop: retries multiply (4 x 3 = 12 attempts)
~~~`,
  q: r`How do you design a .NET client for resilience against DynamoDB throttling and errors?`,
  a: r`- **SDK retry mode**: {{Standard}} (exponential backoff with jitter, retry quotas) or {{Adaptive}} (client-side rate limiting when throttled). Configure {{MaxErrorRetry}}.
- **Timeouts**: set {{Timeout}} and {{ReadWriteTimeout}} per client configuration and pass CancellationTokens; align with the caller's SLO.
- **Idempotent writes**: conditions and ClientRequestToken so retries are safe.
- **Bulkheads**: separate clients/limits for background jobs and request paths so batch work does not starve user traffic.
- **Graceful degradation**: cached or partial responses on read failures; queue writes (SQS) for non-critical updates.
- **Circuit breaker** (Polly) for prolonged failures to stop wasted retries.
- **Observability**: retry counts and throttle exceptions as metrics.`,
  pts: [r`Standard/adaptive retry`, r`Timeouts aligned with SLOs`, r`Idempotent retries`, r`Bulkheads`, r`Degrade gracefully`],
  ex: r`Separating the reporting job's DynamoDB client with its own rate limit stopped it from causing API throttling during month-end.`,
  fu: [r`When would you disable SDK retries?`],
  pit: [r`Wrapping the SDK's own retries in another retry loop (retry storms).`] },

{ id: 'q37', level: 'Principal', tags: ['architecture-decision'],
  code: r`~~~csharp
// Orchestration state in DynamoDB, ledger postings in PostgreSQL, joined by an outbox event
public async Task CaptureAsync(PaymentId id, CancellationToken ct)
{
    await _payments.TransitionAsync(id, from: "AUTHORIZED", to: "CAPTURED", ct);   // conditional UpdateItem
    // stream -> PaymentCaptured event -> ledger service posts double-entry in Aurora
}
~~~`,
  dia: r`flowchart LR
  C[Merchant API] --> P[Payments service .NET]
  P -->|intents, idempotency| D[(DynamoDB)]
  D -->|stream / outbox| EB[EventBridge]
  EB --> L[Ledger service]
  L --> A[(Aurora PostgreSQL ledger)]
  D -->|export| S3[(S3 + Athena)]
  A -->|CDC| S3`,
  q: r`DynamoDB or Aurora PostgreSQL for a new payments platform on AWS? Decide and justify.`,
  a: r`Split the platform by sub-domain instead of picking one database for everything:

| Component | Choice | Why |
|---|---|---|
| Payment intents / orchestration state | DynamoDB | Key-based access, high write rate, predictable latency, global tables for multi-region, serverless ops |
| Idempotency records | DynamoDB | Conditional writes, TTL |
| Ledger / double-entry accounting | Aurora PostgreSQL | Invariants, set-based reconciliation, ad hoc audit queries, constraints |
| Merchant configuration, admin back-office | Aurora PostgreSQL | Relational, flexible queries, low volume |
| Reporting | S3 + Athena/Redshift via exports and CDC | Isolate analytics |

Decision criteria: access-pattern stability, invariants spanning entities, query flexibility, scale and multi-region needs, team skills, and operational cost.

If forced to choose one: Aurora PostgreSQL for a mid-scale platform with evolving requirements; DynamoDB for very high-scale, well-understood flows. Document the trade-off and the reversal condition (e.g. "if orchestration exceeds X TPS or needs active-active regions").`,
  pts: [r`Split by sub-domain`, r`DynamoDB for orchestration and idempotency`, r`Relational for ledger`, r`Analytics separated`, r`Reversal condition`],
  ex: r`A card-issuing platform ran authorisation state in DynamoDB global tables and its ledger in Aurora, reconciling via streams.`,
  fu: [r`How do you keep the two stores consistent?`],
  pit: [r`One database for everything because of familiarity.`] },

{ id: 'q38', level: 'Principal', tags: ['incident'],
  code: r`~~~csharp
// The faulty index key: every new order lands on one GSI partition
item["GSI2PK"] = new("STATUS#PENDING");
// The fix: shard the status key, readers fan out over the shards
item["GSI2PK"] = new("STATUS#PENDING#" + (StableHash(orderId) % 20));
~~~
~~~text
Timeline (UTC)  09:00 deploy  09:04 checkout errors  09:09 page  09:16 rollback  09:34 recovered
Detect 9 min | Mitigate 7 min | Resolve 25 min | ~4,100 failed checkouts
~~~`,
  q: r`A deploy introduced a hot partition that throttled checkout for 30 minutes. Lead the response and postmortem.`,
  a: r`**During the incident**:

1. Declare, assign roles, communicate status.
2. Mitigate fastest: roll back the deploy (or disable the feature flag); if not possible, switch the table to on-demand and raise GSI capacity, and shed non-critical writes.
3. Confirm recovery with throttling metrics and checkout success rate.

**Postmortem (blameless)**:

- What changed: e.g. a new GSI keyed by {{STATUS#PENDING}} concentrated all new orders onto one GSI partition; GSI throttling back-pressured base-table writes.
- Why not caught: load tests used uniform random keys, no design review of the new index, no alarm on GSI throttling specifically.
- Actions: sharded GSI key; Contributor Insights on critical tables; alarm on GSI write throttles; access-pattern review checklist for new indexes; load tests with production-like key distributions; canary deploys watching throttle metrics.

Report business impact (failed checkouts, revenue) and time to detect, mitigate and resolve.`,
  pts: [r`Rollback first`, r`Capacity/on-demand as mitigation`, r`GSI back-pressure root cause`, r`Realistic load tests`, r`Index review checklist`],
  ex: r`A real-world variant: a "pending orders" GSI with a constant partition key throttled checkout on launch day; sharding the key into 20 buckets resolved it.`,
  fu: [r`How would you detect this in a canary?`],
  pit: [r`Fixing capacity only and leaving the key design.`] },

{ id: 'q39', level: 'Principal', tags: ['governance'],
  code: r`~~~csharp
// Paved-road CDK construct: correct defaults for every team
public sealed class StandardTable : Construct
{
    public Table Table { get; }
    public StandardTable(Construct scope, string id, string name) : base(scope, id)
    {
        Table = new Table(this, "T", new TableProps
        {
            TableName = name, BillingMode = BillingMode.PAY_PER_REQUEST,
            PartitionKey = new Attribute { Name = "PK", Type = AttributeType.STRING },
            SortKey = new Attribute { Name = "SK", Type = AttributeType.STRING },
            PointInTimeRecovery = true, DeletionProtection = true,
            Encryption = TableEncryption.CUSTOMER_MANAGED, ContributorInsightsEnabled = true,
            Stream = StreamViewType.NEW_AND_OLD_IMAGES
        });
        Table.MetricThrottledRequestsForOperations().CreateAlarm(this, "Throttles", new CreateAlarmOptions { Threshold = 1, EvaluationPeriods = 3 });
    }
}
~~~`,
  q: r`How do you help many teams adopt DynamoDB well?`,
  a: r`- **Modelling playbook**: access-pattern-first worksheets, examples of single-table and multi-table designs, anti-pattern list (hot keys, scans, filters as queries, large items).
- **Design reviews** for new tables and GSIs (lightweight, async, with a checklist), since key mistakes are expensive to undo.
- **Paved road IaC**: CDK/Terraform constructs with PITR, deletion protection, encryption, alarms (throttles, latency, IteratorAge), cost tags, Contributor Insights on critical tables.
- **Shared .NET library**: key builders, pagination cursor encoding, retry settings, idempotency helpers, OpenTelemetry instrumentation.
- **Training and office hours**, community of practice.
- **Guardrails**: IAM denying full-table PartiQL scans in production, SCPs requiring encryption and PITR.
- **Metrics**: throttle incidents, cost per table, number of GSIs per table.`,
  pts: [r`Access-pattern playbook`, r`Review keys and GSIs`, r`Paved-road constructs`, r`Shared library`, r`IAM/SCP guardrails`],
  ex: r`A design review caught a proposed tenant-only partition key for a tenant producing 60% of traffic, before launch.`,
  fu: [r`How do you scale reviews without a bottleneck?`],
  pit: [r`Letting each team learn key design by incident.`] },

{ id: 'q40', level: 'Principal', tags: ['dr', 'multi-region'],
  code: r`~~~bash
# Failover runbook core steps (scripted, rehearsed)
aws route53 change-resource-record-sets --hosted-zone-id Z123 --change-batch file://failover-to-us-east-1.json
aws cloudwatch get-metric-statistics --namespace AWS/DynamoDB --metric-name ReplicationLatency \
  --dimensions Name=TableName,Value=payments Name=ReceivingRegion,Value=us-east-1 --period 60 --statistics Maximum \
  --start-time 2026-10-10T10:00:00Z --end-time 2026-10-10T10:15:00Z
aws ssm put-parameter --name /payments/write-region --value us-east-1 --overwrite   # apps read this flag
~~~`,
  dia: r`flowchart TB
  R53[Route 53 / Global Accelerator] --> A1
  R53 -.failover.-> A2
  subgraph P[Primary eu-west-1]
    A1[API active] --> T1[(payments global table)]
  end
  subgraph S[DR us-east-1]
    A2[API warm, scaled down] --> T2[(payments replica)]
  end
  T1 -- "replication ~1s" --> T2
  T1 --> PITR1[(PITR 35 days)]
  T2 --> PITR2[(PITR 35 days)]`,
  q: r`Design DR for a DynamoDB-backed critical service with RPO 1 minute and RTO 15 minutes.`,
  a: r`Options:

- **Global tables** (multi-region eventual): replica in a second region kept within ~1 s. RPO seconds; RTO is mostly **application failover** (route traffic with Route 53/Global Accelerator, warm compute in the DR region). Watch for writes in flight during failover (LWW conflicts if both regions write).
- **Backups only** (PITR + cross-region copies via AWS Backup): RPO small but RTO hours for large tables (restore creates new tables). Fine for less critical data.

Design for the global table approach:

1. Single active write region by default (home region per entity or global), reads local.
2. Failover runbook: stop writes in the primary (if reachable), switch routing, enable writes in DR, monitor ReplicationLatency/PendingReplicationCount to estimate lost writes.
3. Reconcile after failback: compare items written around the failover window (streams in both regions).
4. Dependencies: secrets, KMS keys (multi-region keys), queues, and config replicated too.
5. Quarterly game days measuring RTO and data divergence.

Also protect against logical corruption (bad deploy replicates everywhere): PITR in each region.`,
  pts: [r`Global tables for RPO seconds`, r`RTO is app failover`, r`Single active writer`, r`Reconcile after failover`, r`PITR against logical corruption`],
  ex: r`A game day measured a 9-minute regional failover with 0.4 s of replication backlog, all reconciled from streams.`,
  fu: [r`Why does global replication not protect against a bad deploy?`],
  pit: [r`Assuming replication equals backup.`] },

{ id: 'q41', level: 'Principal', tags: ['system-design'],
  dia: r`flowchart LR
  U[Browser] --> CF[CloudFront: cache 301/302]
  CF -->|miss| API[Redirect Lambda / .NET API]
  API --> D[(DynamoDB URL#code)]
  API --> K[Kinesis Firehose: click events]
  K --> S3[(S3 Parquet)] --> ATH[Athena dashboards]
  CR[Create API] -->|conditional put attribute_not_exists| D`,
  q: r`Design a URL shortener's storage on DynamoDB for 100 M new URLs per month and 10 B redirects.`,
  a: r`Estimates: 100 M/month ≈ 40 writes/s average (peaks 10×); 10 B redirects/month ≈ 3,900 reads/s average, peaks ~40 K/s.

Model:

~~~text
PK = URL#<code>     attributes: longUrl, ownerId, createdAt, expiresAt (TTL), clicks (optional)
GSI1: PK = OWNER#<ownerId>, SK = createdAt   (list a user's links)
~~~

- **Code generation**: random base62 codes of 7 chars (62^7 ≈ 3.5 T); write with {{attribute_not_exists(PK)}} and retry on collision. No central counter (hot key).
- **Reads**: GetItem by code; eventually consistent reads (half price); put **CloudFront** in front with caching for redirects; DAX optional for hot links.
- **Clicks**: do not increment a counter per redirect on the item (hot key for viral links); send click events to Kinesis/Firehose for analytics, aggregate asynchronously.
- **Expiry** via TTL; custom aliases use the same table with conditional put.
- **Capacity**: on-demand initially; reads mostly served by CDN.

The hard problem is the read path at peak and viral hot keys, solved by CDN caching, not DynamoDB capacity.`,
  pts: [r`Estimates with arithmetic`, r`Random codes + conditional put`, r`CDN absorbs redirects`, r`Clicks via stream, not counters`, r`TTL for expiry`],
  ex: r`A marketing link platform served 95% of redirects from CloudFront, keeping DynamoDB at a few hundred reads per second.`,
  fu: [r`How do you prevent abuse (phishing links)?`],
  pit: [r`An atomic counter for IDs on one item.`] },

{ id: 'q42', level: 'Principal', tags: ['compliance'],
  code: r`~~~csharp
// Erasure: find every item for a subject via a subject GSI, delete, propagate
var items = await ddb.QueryAsync(new QueryRequest { TableName = "app", IndexName = "SubjectIndex",
    KeyConditionExpression = "subjectId = :s", ExpressionAttributeValues = new() { [":s"] = new(subjectId) } }, ct);
foreach (var chunk in items.Items.Chunk(25))
    await BatchWriter.DeleteAllAsync(ddb, "app", chunk.Select(KeyOf), ct);
await keyStore.DestroySubjectKeyAsync(subjectId, ct);   // crypto-shred copies in backups/exports
await audit.RecordErasureAsync(subjectId, DateTimeOffset.UtcNow, ct);   // evidence without the data
~~~`,
  q: r`How do you meet data residency, retention and erasure requirements on DynamoDB?`,
  a: r`- **Residency**: tables in the required region only; global tables only to permitted regions; SCPs restricting regions; KMS keys per region.
- **Classification**: PII attributes identified; sensitive ones encrypted client-side (AWS Database Encryption SDK) with per-tenant or per-subject keys.
- **Retention**: TTL with archival to S3 (Object Lock for records that must be immutable for N years), lifecycle to Glacier.
- **Erasure**: delete items by subject (requires a key or GSI to find all items for a subject: design it up front); propagate via streams to search indexes, caches and analytics; crypto-shred where data persists in backups and exports (destroy the subject's key).
- **Backups**: PITR contains erased data for up to 35 days; document this in the privacy policy and restore procedures that re-apply erasure logs.
- **Audit**: CloudTrail data events for access to sensitive tables.`,
  pts: [r`Region restriction and SCPs`, r`Client-side encryption for PII`, r`TTL + S3 Object Lock retention`, r`Subject-findable keys for erasure`, r`Crypto-shredding for backups`],
  ex: r`A lender could not efficiently erase a customer because items were keyed only by loan id; adding a subject GSI fixed erasure discovery.`,
  fu: [r`How do you prove deletion to an auditor?`],
  pit: [r`Forgetting search indexes and exports during erasure.`] },

{ id: 'q43', level: 'Principal', tags: ['migration'],
  code: r`~~~csharp
// Shadow read: serve from SQL, compare with DynamoDB, log differences
public async Task<Cart?> GetCartAsync(Guid id, CancellationToken ct)
{
    var primary = await _sql.GetCartAsync(id, ct);
    if (_flags.IsEnabled("cart-shadow-read"))
        _ = Task.Run(async () =>
        {
            var shadow = await _dynamo.GetCartAsync(id, CancellationToken.None);
            if (!CartComparer.Equal(primary, shadow)) _log.LogWarning("Cart mismatch {CartId}", id);
        });
    return primary;
}
~~~`,
  q: r`Plan a migration of a high-traffic SQL Server table set to DynamoDB.`,
  a: r`1. **Justify**: what does DynamoDB solve (scale, latency, ops cost)? Which access patterns move? Reports and ad hoc queries need another home.
2. **Model**: access-pattern table from production query logs (Query Store top queries), design keys and GSIs, estimate capacity and cost.
3. **Change the code** behind a repository interface; implement the DynamoDB version.
4. **Data sync**: full load (export → S3 → Import, or DMS) then CDC from SQL Server (DMS or Debezium) to keep DynamoDB in sync.
5. **Shadow reads**: read from both, compare, log mismatches; fix transformation bugs.
6. **Switch reads** gradually (feature flag by percentage/tenant), then **switch writes** (dual-write window or flip with reverse CDC for rollback).
7. **Decommission** after stabilisation; keep reporting via exports/CDC to the warehouse.

Risks: transactional logic that relied on joins or multi-table transactions, uniqueness constraints (guard items), and reporting consumers nobody knew about (inventory all readers first).`,
  pts: [r`Justify and inventory readers`, r`Access patterns from query logs`, r`Full load + CDC`, r`Shadow reads`, r`Gradual flip with rollback`],
  ex: r`A session and cart store moved from SQL Server to DynamoDB over six weeks with shadow reads catching 3 mapping bugs before cutover.`,
  fu: [r`How do you handle uniqueness constraints that existed in SQL?`],
  pit: [r`Migrating without discovering hidden report consumers.`] },

{ id: 'q44', level: 'Principal', tags: ['interview-scenario'],
  code: r`~~~bash
# Consumed write capacity per GSI over 30 days: candidates for removal show ~0 reads but full writes
for idx in GSI1 GSI2 GSI3; do
  aws cloudwatch get-metric-statistics --namespace AWS/DynamoDB --metric-name ConsumedReadCapacityUnits \
    --dimensions Name=TableName,Value=orders Name=GlobalSecondaryIndexName,Value=$idx \
    --start-time 2026-09-10T00:00:00Z --end-time 2026-10-10T00:00:00Z --period 86400 --statistics Sum
done
aws dynamodb update-table --table-name orders --global-secondary-index-updates '[{"Delete":{"IndexName":"GSI3"}}]'
~~~`,
  q: r`A team's DynamoDB bill is high and they have 14 GSIs on one table. What do you do?`,
  a: r`1. **Measure**: per-GSI consumed capacity, storage, and whether each is queried at all (application metrics/X-Ray per index; CloudWatch consumed RCU per index). Each GSI multiplies write cost: a write that touches indexed attributes is written again to each affected GSI.
2. **Typical findings**: unused GSIs from abandoned features; GSIs projecting ALL attributes; multiple GSIs that could be one **overloaded** GSI (different entity types sharing GSI1PK/GSI1SK patterns); GSIs serving ad hoc admin queries better served by OpenSearch or Athena.
3. **Actions**: drop unused indexes (after confirming with access logs); reduce projections; consolidate with overloaded keys (requires backfill); move search/reporting patterns out.
4. **Prevent**: access-pattern documentation per table and review for new GSIs; cost tags and dashboards per table.

Present with numbers: "dropping 6 GSIs and trimming projections reduces write cost by ~45%".`,
  pts: [r`GSIs multiply writes`, r`Find unused and over-projected indexes`, r`Overloaded GSIs`, r`Move ad hoc patterns out`, r`Quantify savings`],
  ex: r`Consolidating 14 GSIs into 5 overloaded ones plus an OpenSearch index cut the table's cost by half.`,
  fu: [r`How do you safely verify an index is unused?`],
  pit: [r`Dropping indexes based on assumptions.`] },

{ id: 'q45', level: 'Principal', tags: ['consistency', 'design'],
  code: r`~~~csharp
// Semantic lock: only a PENDING_PAYMENT booking can be confirmed or compensated
await ddb.UpdateItemAsync(new UpdateItemRequest
{
    TableName = "bookings", Key = new() { ["PK"] = new("BOOKING#" + id), ["SK"] = new("META") },
    UpdateExpression = "SET #s = :confirmed, paymentId = :p",
    ConditionExpression = "#s = :pending",
    ExpressionAttributeNames = new() { ["#s"] = "status" },
    ExpressionAttributeValues = new() { [":confirmed"] = new("CONFIRMED"), [":pending"] = new("PENDING_PAYMENT"), [":p"] = new(paymentId) }
}, ct);
~~~`,
  dia: r`sequenceDiagram
  participant SF as Step Functions saga
  participant B as Booking (DynamoDB)
  participant P as Payments
  participant H as Hotel API
  SF->>B: create PENDING_PAYMENT
  SF->>P: charge (idempotency key)
  P-->>SF: charged
  SF->>H: reserve room
  H-->>SF: failed
  SF->>P: refund (compensation)
  SF->>B: set CANCELLED (conditional)`,
  q: r`How do you maintain consistency across DynamoDB and other services in a microservices architecture?`,
  a: r`DynamoDB transactions stop at the table/region boundary, so cross-service consistency is **eventual** and must be designed:

- **Outbox via streams** for reliable event publishing.
- **Sagas** for multi-service business processes (order → payment → inventory), with compensations; orchestrated with Step Functions (durable state, retries, timeouts) or choreographed via EventBridge.
- **Idempotent consumers** with dedupe items (conditional put on event id with TTL).
- **Read models** built from events for cross-service queries.
- **Reconciliation jobs** comparing systems (e.g. payments vs ledger) and alerting on drift, because no mechanism is perfect.
- **Semantic locks**: status fields like {{PENDING_PAYMENT}} with conditional transitions prevent concurrent conflicting actions.

Explain to stakeholders what "eventually" means in seconds, with SLOs on propagation lag.`,
  pts: [r`Outbox via streams`, r`Sagas with Step Functions`, r`Idempotent consumers`, r`Reconciliation`, r`Semantic locks via conditional status`],
  ex: r`A travel booking saga in Step Functions coordinated flights, hotels and payments with DynamoDB state per booking and compensations on failure.`,
  fu: [r`Orchestration vs choreography here?`],
  pit: [r`Trying to emulate distributed transactions with locks.`] },

{ id: 'q46', level: 'Principal', tags: ['capacity-planning'],
  code: r`~~~text
Forecast peak: 12,000 orders/min = 200 orders/s
Writes per order: order item 3 KB (3 WCU) + 2 GSIs (3 WCU each) + outbox (1 WCU) = 10 WCU
Transactional (x2): 20 WCU x 200/s = 4,000 WCU sustained, plan headroom 1.5x = 6,000 WCU
Hot key check: "deal of the day" counter at 200 writes/s -> under 1,000 WCU per key, but shard anyway (x10)
~~~`,
  q: r`How do you capacity-plan DynamoDB for a major sales event at 10× normal traffic?`,
  a: r`1. **Model traffic** per access pattern at 10× peak, convert to RCU/WCU including GSIs (write amplification) and transactions (2×).
2. **Check per-partition limits**: any key that will exceed 1,000 WCU / 3,000 RCU? Event-specific hot keys (the promoted product, the event's counter) need sharding or caching.
3. **Capacity mode**: on-demand tables scale to 2× previous peak instantly; for 10× jumps, **pre-warm** with the **warm throughput** setting (2024) or temporarily provision high capacity then switch.
4. **Account quotas**: per-table and per-account throughput limits; request increases weeks ahead.
5. **Dependencies**: Lambda concurrency, stream consumers, downstream services.
6. **Load test** at 10× in a staging account with production-like key distribution.
7. **Runbook** and dashboards; rollback flags for non-critical features.`,
  pts: [r`Per-pattern capacity including GSIs`, r`Hot keys for promoted items`, r`Warm throughput pre-warming`, r`Account quotas`, r`Realistic load tests`],
  ex: r`A retailer pre-warmed its orders table and sharded the "deal of the day" counter; the event ran at 12× normal with zero throttling.`,
  fu: [r`What does on-demand do on a sudden 10× jump without pre-warming?`],
  pit: [r`Assuming on-demand is infinitely elastic instantly.`] },

{ id: 'q47', level: 'Principal', tags: ['code-review'],
  q: r`Code review: what is wrong with this DynamoDB code?`,
  a: r`~~~csharp
public async Task<List<Order>> GetPendingOrders(string tenantId)
{
    var client = new AmazonDynamoDBClient();
    var resp = await client.ScanAsync(new ScanRequest {
        TableName = "orders",
        FilterExpression = "tenantId = :t AND #s = :p",
        ExpressionAttributeNames = new() { ["#s"] = "status" },
        ExpressionAttributeValues = new() { [":t"] = new(tenantId), [":p"] = new("PENDING") } });
    return resp.Items.Select(Map).ToList();
}
public async Task MarkPaid(string orderId)
{
    var client = new AmazonDynamoDBClient();
    var o = await client.GetItemAsync("orders", Key(orderId));
    o.Item["status"] = new("PAID");
    await client.PutItemAsync("orders", o.Item);
}
~~~

1. **Scan with filter** for a request path: reads the whole table, costs scale with table size, slow; and only the **first page** is returned (no LastEvaluatedKey loop), so results are silently incomplete. Use a sparse GSI keyed by {{TENANT#t#PENDING}}.
2. **Client per call**: use a singleton {{IAmazonDynamoDB}}.
3. **Read-modify-PutItem race**: concurrent updates are lost and a cancelled order could be marked paid. Use {{UpdateItem}} with {{ConditionExpression #s = :pending}}.
4. No CancellationToken; no handling of ConditionalCheckFailed; no idempotency.
5. Tenant isolation relies on a filter instead of keys (and no IAM LeadingKeys).`,
  pts: [r`Scan + filter + no pagination`, r`Singleton client`, r`Conditional UpdateItem instead of Put`, r`Tenant isolation in keys`, r`Cancellation and errors`],
  ex: r`This code returned only 1 MB of matches in production, so some pending orders were never processed until a reconciliation report found them.`,
  fu: [r`Rewrite MarkPaid correctly.`],
  pit: [r`Only fixing the client creation.`] },

{ id: 'q48', level: 'Principal', tags: ['strategy', 'lock-in'],
  code: r`~~~csharp
// Port owned by the domain; DynamoDB is one adapter behind it
public interface IOrderStore
{
    Task<Order?> GetAsync(OrderId id, CancellationToken ct);
    Task SaveAsync(Order order, long expectedVersion, CancellationToken ct);
    IAsyncEnumerable<OrderSummary> ListByCustomerAsync(CustomerId id, CancellationToken ct);
}
public sealed class DynamoOrderStore(IAmazonDynamoDB ddb) : IOrderStore { /* single-table mapping lives here only */ }
~~~
~~~bash
# Quarterly exit-plan test: export to open formats and load elsewhere
aws dynamodb export-table-to-point-in-time --table-arn arn:aws:dynamodb:eu-west-1:123:table/orders --s3-bucket exit-test --export-format ION
~~~`,
  q: r`How do you address concerns about DynamoDB lock-in?`,
  a: r`Be honest: DynamoDB is AWS-only, and data models designed for it (single-table, overloaded keys) do not port directly. Lock-in is a cost to weigh, not an automatic veto.

Assess:

- **Probability** of leaving AWS in the system's lifetime, and the **cost** of leaving (rewrite of data access, migration).
- **Benefits** captured now: zero ops, scale, latency, serverless integration; the cost of building equivalent portability (running your own Cassandra/ScyllaDB) is often larger than a future migration.

Mitigations:

- Repository/port abstraction around data access (hexagonal), so domain logic is portable.
- Data exportable in open formats (export to S3 in Parquet via Glue).
- Avoid deep coupling to proprietary features where alternatives are equal.
- Document an exit plan (e.g. ScyllaDB Alternator for API compatibility, or Cosmos DB).

Frame it as an ADR with the reversibility assessment.`,
  pts: [r`Lock-in is a cost, not a veto`, r`Probability × cost of exit`, r`Ports and adapters`, r`Open-format exports`, r`Documented exit plan`],
  ex: r`A bank's architecture board accepted DynamoDB with an exit plan and quarterly export tests, satisfying regulators' concentration-risk questions.`,
  fu: [r`How do regulators view cloud concentration risk (e.g. DORA)?`],
  pit: [r`Building a lowest-common-denominator abstraction that loses all benefits.`] },

{ id: 'q49', level: 'Principal', tags: ['leadership'],
  code: r`~~~text
Decision criteria agreed with the team before choosing:
| Criterion                          | Single-table | Table per entity |
| Access patterns known and stable   | required     | tolerant         |
| Entities read together per page    | 3+ -> wins   | 1 -> fine        |
| Team DynamoDB experience           | needs a reviewer | low bar      |
| Analytics / exports                | needs transform | simpler       |
Review after first quarter: count of new GSIs, incidents, onboarding time.
~~~`,
  q: r`A senior engineer insists on single-table design for a new service; the team is new to DynamoDB. How do you handle it?`,
  a: r`Treat it as a risk and capability decision, not a technical argument to win:

- **Understand the motivation**: performance (fewer requests), cost, or best-practice belief?
- **Assess fit**: are access patterns known and stable? How often will new patterns appear? How many entity types are read together?
- **Team capability**: who will debug and evolve the model in two years? Is there a reviewer with experience?
- **Options**: single-table for the core aggregate where co-retrieval matters; separate tables for independent entities; or a relational database if access patterns are not yet known.
- **Make it reversible**: repository abstraction, access-pattern documentation, a spike with real data and query scenarios, and a review after the first quarter.

Facilitate a short design review with the trade-offs written down, and let the team own the decision with clear criteria. Mentor the senior engineer on balancing elegance with team maintainability.`,
  pts: [r`Understand motivation`, r`Fit vs pattern stability`, r`Team capability`, r`Hybrid options`, r`Reversible decision with review`],
  ex: r`A team adopted single-table only for the order aggregate and plain tables elsewhere; onboarding new engineers stayed manageable.`,
  fu: [r`What signals would make you revisit the decision?`],
  pit: [r`Overruling or deferring without criteria.`] },

{ id: 'q50', level: 'Principal', tags: ['summary'],
  code: r`~~~csharp
// Principles in one method: key-based access, condition as constraint, idempotent retry
await ddb.UpdateItemAsync(new UpdateItemRequest
{
    TableName = "app",
    Key = new() { ["PK"] = new("ORDER#" + id), ["SK"] = new("META") },          // Get/Query on a key, never Scan
    UpdateExpression = "SET #s = :paid, paidAt = :t, version = version + :one",
    ConditionExpression = "#s = :pending AND version = :v",                      // the database enforces the rule
    ExpressionAttributeNames = new() { ["#s"] = "status" },
    ExpressionAttributeValues = new() { [":paid"] = new("PAID"), [":pending"] = new("PENDING"),
        [":t"] = new(DateTimeOffset.UtcNow.ToString("O")), [":one"] = new() { N = "1" }, [":v"] = new() { N = version.ToString() } }
}, ct);
~~~`,
  q: r`Summarise the DynamoDB principles you would teach a team.`,
  a: r`1. **Access patterns first**: write them down before keys; every request is a Get or a Query on a key.
2. **Partitions are physics**: high-cardinality keys, per-partition limits, shard hot keys, cache hot reads.
3. **Indexes cost writes**: sparse and overloaded GSIs, minimal projections, review every new GSI.
4. **Conditions are your constraints**: conditional writes, guard items for uniqueness, transactions for multi-item invariants, ClientRequestToken for idempotency.
5. **Streams are your outbox**: at-least-once, idempotent consumers, IteratorAge alarms.
6. **Offload what DynamoDB is bad at**: search, analytics, large objects, ad hoc queries.
7. **Global tables are LWW by default**: design writer ownership.
8. **Backups ≠ replication**: PITR everywhere, rehearse restores.
9. **Cost is design**: item size, consistency, capacity mode, table class.
10. **Pave the road**: IaC constructs, shared library, reviews, metrics.`,
  pts: [r`Access patterns first`, r`Partition physics`, r`Indexes cost writes`, r`Conditions as constraints`, r`Offload and pave the road`],
  ex: r`Teams using this checklist in reviews avoided the classic hot-key and scan incidents entirely in their first year.`,
  fu: [r`Which principle prevents the most incidents?`],
  pit: [r`Listing API names instead of principles.`] }
],
cheat: r`### Keys
PK hashed to partitions (≤10 GB, 3,000 RCU / 1,000 WCU each). SK orders item collections. Get/Query good, Scan bad. High-cardinality, even keys; shard hot keys with suffixes; Contributor Insights.

### Capacity
WCU = 1 KB write; RCU = 4 KB strong (or 2 eventual). Transactions 2×. GSIs consume their own writes. On-demand for spiky, provisioned + reserved for steady. Warm throughput before big events. Standard-IA for storage-heavy tables.

### Indexes
GSI: any key, eventual only, own capacity, back-pressure on throttle. LSI: same PK, strong reads, creation-only, 10 GB collections. Sparse + overloaded GSIs; minimal projections.

### Correctness
ConditionExpression (atomic per item). Guard items for uniqueness. TransactWriteItems ≤100 items with ClientRequestToken. Global tables LWW → single writer per item; MRSC option.

### Patterns
Single-table item collections; access-pattern table; S3 pointer for big items; time buckets; streams as outbox (24 h, IteratorAge); TTL (days, filter on read); PITR restores to new table.

### .NET
Singleton IAmazonDynamoDB, async + CancellationToken, expression attribute values, handle UnprocessedItems and LastEvaluatedKey, standard/adaptive retry, DynamoDB Local via Testcontainers.

### Say this
"Every request is a Get or a Query on a key." "Filters do not save RCUs." "GSIs multiply writes." "Global tables are last-writer-wins." "DynamoDB for orchestration, relational for the ledger."`
});
})(String.raw);
