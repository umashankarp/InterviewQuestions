(function (r) {
registerTopic('02-dotnet-aspnetcore', {
related: ['01-csharp', '03-rest-apis', '56-linq-efcore'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['pipeline'],
  q: r`Explain the ASP.NET Core request pipeline and middleware.`,
  a: r`The pipeline is an ordered chain of **middleware**. Each component receives the {{HttpContext}} and a {{next}} delegate; it may act before calling {{next}}, after it returns, or short-circuit by not calling it. The order in {{Program.cs}} is the order of execution on the request, reversed on the response.

~~~mermaid
flowchart LR
  Req[Request] --> EH[Exception handler] --> HTTPS --> Static --> Routing --> Auth[AuthN / AuthZ] --> CORS --> Endpoint[Endpoint]
  Endpoint --> Resp[Response flows back through the same chain]
~~~

Typical order: exception handling → HSTS/HTTPS redirect → static files → routing → CORS → authentication → authorization → rate limiting → endpoints. Putting authorization before routing, or CORS after auth, are classic bugs.

~~~csharp
app.Use(async (ctx, next) => { var sw = Stopwatch.StartNew(); await next(); _log.LogInformation("{Path} {Ms}ms", ctx.Request.Path, sw.ElapsedMilliseconds); });
~~~`,
  pts: [r`Order matters`, r`Short-circuit by not calling next`, r`Exception handler first`, r`Auth after routing, before endpoints`],
  ex: r`A CORS error on 401 responses came from CORS middleware placed after authentication.`,
  fu: [r`Use vs Run vs Map?`, r`How do endpoint filters differ from middleware?`],
  pit: [r`Modifying the response after it has started.`] },

{ id: 'q2', level: 'Basic', tags: ['di'],
  q: r`Explain built-in dependency injection and service lifetimes.`,
  a: r`ASP.NET Core ships a constructor-injection container ({{IServiceCollection}} → {{IServiceProvider}}). Lifetimes: **Transient** (per resolution), **Scoped** (per request), **Singleton** (per app).

Rules: a service may depend only on equal or longer lifetimes; singletons must be thread-safe; never resolve scoped services from the root provider. Use {{IServiceScopeFactory}} in background services. Keyed services (.NET 8) allow multiple implementations by key. For features the built-in container lacks (decorators, assembly scanning) use Scrutor or Autofac.

~~~csharp
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddKeyedSingleton<IPaymentGateway, StripeGateway>("stripe");
~~~`,
  pts: [r`Three lifetimes`, r`No captive dependencies`, r`Scope factory for background work`, r`Keyed services in .NET 8`],
  ex: r`A scoped {{DbContext}} injected into a hosted service threw on resolution; the fix was creating a scope per work item.`,
  fu: [r`How does ValidateScopes help?`],
  pit: [r`Registering stateful services as singleton without synchronisation.`] },

{ id: 'q3', level: 'Basic', tags: ['api'],
  q: r`Minimal APIs versus controllers: how do you choose?`,
  a: r`**Controllers** ({{[ApiController]}}) offer conventions: model binding and validation, filters, content negotiation, attribute routing, mature ecosystem (Swagger, versioning, OData). **Minimal APIs** offer lower ceremony, endpoint-focused code, and slightly less overhead; since .NET 7/8 they support filters, groups, validation via filters, OpenAPI, and AOT.

Choose controllers for large, convention-heavy APIs with many cross-cutting filters and teams used to them; minimal APIs for microservices, small surfaces and AOT scenarios. They can coexist. Organise minimal endpoints with {{MapGroup}} and feature-based files to avoid a giant Program.cs.

~~~csharp
var orders = app.MapGroup("/orders").RequireAuthorization();
orders.MapGet("/{id:guid}", async (Guid id, IOrderService s, CancellationToken ct) =>
    await s.Find(id, ct) is { } o ? Results.Ok(o) : Results.NotFound());
~~~`,
  pts: [r`Both are first-class`, r`Minimal APIs: AOT friendly, less ceremony`, r`Group and organise endpoints`],
  ex: r`A 6-endpoint payments-webhook service used minimal APIs with Native AOT for fast cold starts.`,
  fu: [r`How do you validate input in minimal APIs?`],
  pit: [r`Putting all endpoints and logic in Program.cs.`] },

{ id: 'q4', level: 'Basic', tags: ['errors'],
  q: r`How should errors be handled and returned in an API?`,
  a: r`Centralise: use {{UseExceptionHandler}} / {{IExceptionHandler}} (.NET 8) to log once and map exceptions to **RFC 9457 ProblemDetails** ({{application/problem+json}}) with a stable {{type}}, {{title}}, {{status}}, and a {{traceId}} extension. Never leak stack traces or internal messages in production.

Map domain failures to status codes deliberately (400 validation, 401/403 auth, 404, 409 conflict, 422, 429, 5xx). Expected failures are results, not exceptions. Add {{AddProblemDetails()}} so framework errors (404, 415) use the same shape.

~~~csharp
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
app.UseExceptionHandler();
~~~`,
  pts: [r`One global handler`, r`ProblemDetails everywhere`, r`Correlation id in the response`, r`No internals leaked`],
  ex: r`Support resolved tickets faster after every error response carried a {{traceId}} that mapped to one log query.`,
  fu: [r`How do you handle validation errors from FluentValidation?`],
  pit: [r`try/catch in every action.`] },

{ id: 'q5', level: 'Basic', tags: ['health'],
  code: r`~~~csharp
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
    .AddNpgSql(cs, name: "db", tags: ["ready"])                       // AspNetCore.HealthChecks.NpgSql
    .AddRedis(redisCs, name: "cache", failureStatus: HealthStatus.Degraded, tags: ["ready"]);
app.MapHealthChecks("/health/live", new() { Predicate = r => r.Tags.Contains("live") });   // process alive: no dependencies
app.MapHealthChecks("/health/ready", new() { Predicate = r => r.Tags.Contains("ready") }); // can take traffic
~~~
~~~yaml
livenessProbe:  { httpGet: { path: /health/live, port: 8080 }, periodSeconds: 10, failureThreshold: 3 }
readinessProbe: { httpGet: { path: /health/ready, port: 8080 }, periodSeconds: 5 }
startupProbe:   { httpGet: { path: /health/live, port: 8080 }, failureThreshold: 30, periodSeconds: 2 }
~~~`,
  q: r`What are health checks, and how do liveness and readiness differ?`,
  a: r`ASP.NET Core health checks ({{AddHealthChecks}}, {{MapHealthChecks}}) expose endpoints that report app and dependency status.

- **Liveness**: "is the process alive?" Cheap, no dependencies. A failure triggers a restart.
- **Readiness**: "can it serve traffic now?" Includes dependencies (DB, cache) and startup warm-up. A failure removes the pod from the load balancer without restarting.
- **Startup** probe for slow initialisation.

Never put dependency checks in liveness: a database outage would restart every pod and make recovery worse. Tag checks and map separate endpoints ({{/health/live}}, {{/health/ready}}).`,
  pts: [r`Liveness = restart, readiness = route`, r`No dependency checks in liveness`, r`Startup probe for slow boot`],
  ex: r`A DB check in the liveness probe caused a restart storm during a database failover.`,
  fu: [r`How do Kubernetes probes consume these?`],
  pit: [r`One endpoint for everything.`] },

{ id: 'q6', level: 'Basic', tags: ['httpclient'],
  q: r`How should HttpClient be used?`,
  a: r`Creating {{new HttpClient()}} per request exhausts sockets (TIME_WAIT); a single static client never refreshes DNS. Use **{{IHttpClientFactory}}** (named/typed clients), which pools and rotates {{HttpMessageHandler}} instances (default lifetime 2 minutes) and integrates **Polly**/resilience handlers.

~~~csharp
builder.Services.AddHttpClient<IRatesClient, RatesClient>(c => c.BaseAddress = new("https://rates.example.com"))
    .AddStandardResilienceHandler(); // retry, circuit breaker, timeout (Microsoft.Extensions.Http.Resilience)
~~~

Set timeouts, pass {{CancellationToken}}, dispose {{HttpResponseMessage}}, use {{HttpCompletionOption.ResponseHeadersRead}} for streaming, and never retry non-idempotent calls without an idempotency key.`,
  pts: [r`IHttpClientFactory, typed clients`, r`Handler lifetime rotates DNS`, r`Resilience handler: retry/breaker/timeout`, r`Idempotency before retry`],
  ex: r`A service created a client per call and ran out of ephemeral ports at 2,000 RPS.`,
  fu: [r`What is SocketsHttpHandler.PooledConnectionLifetime?`],
  pit: [r`Retrying POST /payments blindly.`] },

{ id: 'q7', level: 'Intermediate', tags: ['middleware', 'filters'],
  code: r`~~~csharp
app.UseExceptionHandler();            // middleware: every request, outermost
app.UseAuthentication(); app.UseAuthorization();
app.UseOutputCache();

// MVC action filter: only MVC actions, has model-binding context
public sealed class AuditFilter(IAuditLog log) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext ctx, ActionExecutionDelegate next)
    { var result = await next(); await log.WriteAsync(ctx.ActionDescriptor.DisplayName!, result.Exception is null); }
}
// Minimal API endpoint filter: per endpoint or group
app.MapGroup("/orders").AddEndpointFilter(async (ctx, next) =>
{
    if (!ctx.HttpContext.Request.Headers.ContainsKey("Idempotency-Key") && ctx.HttpContext.Request.Method == "POST")
        return Results.Problem(statusCode: 400, title: "Idempotency-Key header required");
    return await next(ctx);
});
~~~`,
  dia: r`flowchart LR
  R[Request] --> EH[Exception handler] --> HS[HSTS / HTTPS] --> RT[Routing] --> AN[AuthN] --> AZ[AuthZ] --> RL[Rate limiter] --> OC[Output cache]
  OC --> EP{Endpoint}
  EP -->|Minimal API| EF[Endpoint filters] --> H[Handler]
  EP -->|MVC| AF[Authorization, resource, action filters] --> A[Action] --> RF[Result filters]`,
  q: r`Middleware versus filters versus endpoint filters: where does each belong?`,
  a: r`| Mechanism | Scope | Knows about | Use for |
|---|---|---|---|
| Middleware | Every request | HttpContext only | Logging, CORS, auth, exception handling, compression |
| MVC filters (authorization, resource, action, exception, result) | Controller actions | Model state, action args, results | Validation, per-action policies, result shaping |
| Endpoint filters (minimal API) | A route or group | Endpoint arguments | Validation, idempotency, per-endpoint concerns |

Rule: put a concern as **early and as general as it is true**. Middleware cannot see model binding results; a filter cannot run for static files or non-MVC endpoints.`,
  pts: [r`Choose the narrowest scope that works`, r`Filters see action context`, r`Middleware order matters`],
  ex: r`An idempotency-key endpoint filter caches responses for POST /payments only, not the whole app.`,
  fu: [r`Which runs first: authorization filter or authorization middleware?`],
  pit: [r`Writing business rules in middleware.`] },

{ id: 'q8', level: 'Intermediate', tags: ['validation'],
  code: r`~~~csharp
public sealed record CreateTransfer(string FromIban, string ToIban, decimal Amount, string Currency);
public sealed class CreateTransferValidator : AbstractValidator<CreateTransfer>   // FluentValidation
{
    public CreateTransferValidator()
    {
        RuleFor(x => x.Amount).GreaterThan(0).LessThanOrEqualTo(1_000_000).PrecisionScale(19, 2, true);
        RuleFor(x => x.Currency).Length(3).Must(c => Iso4217.IsKnown(c));
        RuleFor(x => x.ToIban).NotEqual(x => x.FromIban).Must(Iban.IsValid);
    }
}
app.MapPost("/transfers", (CreateTransfer cmd) => Results.Accepted())
   .AddEndpointFilter<ValidationFilter<CreateTransfer>>();       // cannot be forgotten per endpoint
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 1_000_000);
~~~`,
  q: r`How do you validate input robustly?`,
  a: r`Layered validation:

1. **Syntactic** at the edge: model binding + DataAnnotations or **FluentValidation**; return 400/422 ProblemDetails with field errors.
2. **Semantic/business** in the domain/application layer (stock available, state transition legal), throwing or returning domain results.
3. **Persistence constraints** (unique index, FK, check constraints) as the final safety net, mapping violations to 409.

Never trust client-side validation; bound sizes ({{MaxRequestBodySize}}, string lengths, collection counts); validate enums and ids; use allow-lists. Make validation part of a pipeline (MediatR behaviour or endpoint filter) so it cannot be forgotten.`,
  pts: [r`Edge, domain and DB layers`, r`Bound sizes`, r`Pipeline so nobody forgets`, r`Map DB violations to 409`],
  ex: r`A missing max length on a notes field let a client post 200 MB and exhaust memory.`,
  fu: [r`Where do you put cross-field and cross-aggregate rules?`],
  pit: [r`Relying only on DataAnnotations for business rules.`] },

{ id: 'q9', level: 'Intermediate', tags: ['versioning'],
  code: r`~~~csharp
builder.Services.AddApiVersioning(o =>
{
    o.DefaultApiVersion = new ApiVersion(1); o.AssumeDefaultVersionWhenUnspecified = true;
    o.ReportApiVersions = true;                                        // api-supported-versions header
    o.ApiVersionReader = new UrlSegmentApiVersionReader();
}).AddApiExplorer(o => o.GroupNameFormat = "'v'V");
var orders = app.NewVersionedApi("Orders");
var v1 = orders.MapGroup("/v{version:apiVersion}/orders").HasApiVersion(1);
var v2 = orders.MapGroup("/v{version:apiVersion}/orders").HasApiVersion(2);
v1.MapGet("/{id}", (Guid id) => Results.Ok()).HasDeprecatedApiVersion(1);   // Sunset/Deprecation headers via policy
v2.MapGet("/{id}", (Guid id) => Results.Ok());
~~~`,
  q: r`How do you version an API in ASP.NET Core?`,
  a: r`Use {{Asp.Versioning}} with URL segment ({{/v1/orders}}), header ({{api-version}}) or media type. URL versioning is the most visible and cache/gateway friendly; header versioning keeps URLs clean.

Principles: version only on **breaking** changes; prefer additive evolution (new optional fields, tolerant readers); publish a deprecation policy ({{Deprecation}}/{{Sunset}} headers); keep at most 2 active major versions; share domain logic and map per version at the edge; expose a Swagger document per version.

Breaking = removing/renaming a field, changing type or semantics, tightening validation, changing error shape.`,
  pts: [r`Version on breaking changes only`, r`Sunset policy`, r`Per-version OpenAPI docs`, r`Map at the edge`],
  ex: r`A partner integration kept v1 for 18 months under a published sunset date while v2 changed the money representation.`,
  fu: [r`How do you test backward compatibility?`],
  pit: [r`Versioning every minor change and multiplying maintenance.`] },

{ id: 'q10', level: 'Intermediate', tags: ['caching'],
  code: r`~~~csharp
builder.Services.AddOutputCache(o => o.AddPolicy("catalog", p => p.Expire(TimeSpan.FromSeconds(60)).Tag("catalog").SetVaryByQuery("page")));
builder.Services.AddHybridCache();                                        // L1 + L2 with stampede protection
builder.Services.AddStackExchangeRedisCache(o => o.Configuration = redisCs); // L2 for HybridCache

app.MapGet("/catalog", (ICatalog c) => c.ListAsync()).CacheOutput("catalog");             // whole response
app.MapPost("/catalog/refresh", async (IOutputCacheStore store, CancellationToken ct) =>
    { await store.EvictByTagAsync("catalog", ct); return Results.NoContent(); });

app.MapGet("/products/{id}", async (int id, HybridCache cache, ICatalog c, CancellationToken ct) =>
    await cache.GetOrCreateAsync("product:" + id, t => c.GetAsync(id, t), cancellationToken: ct));   // data cache
~~~`,
  q: r`Caching in ASP.NET Core: response caching, output caching, IMemoryCache, distributed cache, HybridCache.`,
  a: r`- **Response caching** (HTTP semantics, {{Cache-Control}}): client/proxy caching; server-side is limited.
- **Output caching** (.NET 7+): server-side caching of responses with policies, tag-based invalidation.
- **{{IMemoryCache}}**: per-process; fastest; not shared across instances; size limits and expiry essential.
- **{{IDistributedCache}}** (Redis, SQL): shared, network cost, serialisation.
- **{{HybridCache}}** (.NET 9): L1 memory + L2 distributed with **stampede protection** and tag invalidation.

Design for: expiry (absolute + sliding), invalidation strategy, **cache stampede** (many requests recompute at once; use single-flight/locks or HybridCache), stale-while-revalidate, and cache poisoning with user-specific data (vary by user/tenant).`,
  pts: [r`Memory vs distributed vs hybrid`, r`Stampede protection`, r`Invalidation is the hard part`, r`Vary by user/tenant`],
  ex: r`A price-list endpoint cached for 30 s in HybridCache dropped DB load by 95% during a promotion.`,
  fu: [r`How do you invalidate across instances?`],
  pit: [r`Caching user-specific responses under a shared key.`] },

{ id: 'q11', level: 'Intermediate', tags: ['background'],
  code: r`~~~csharp
public sealed class InvoiceWorker(Channel<InvoiceJob> queue, IServiceScopeFactory scopes, ILogger<InvoiceWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in queue.Reader.ReadAllAsync(stoppingToken))
        {
            await using var scope = scopes.CreateAsyncScope();
            try { await scope.ServiceProvider.GetRequiredService<InvoiceService>().GenerateAsync(job, stoppingToken); }
            catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "Invoice {Id} failed", job.Id); }
        }
    }
}
builder.Services.AddSingleton(Channel.CreateBounded<InvoiceJob>(new BoundedChannelOptions(500) { FullMode = BoundedChannelFullMode.Wait }));
builder.Services.AddHostedService<InvoiceWorker>();
~~~`,
  q: r`Background processing: BackgroundService, hosted services, Quartz/Hangfire, queues.`,
  a: r`{{BackgroundService}} ({{IHostedService}}) runs long-lived loops inside the host: honour {{stoppingToken}}, catch exceptions (an unhandled one stops the host by default in .NET 6+ unless {{BackgroundServiceExceptionBehavior}} is changed), and create a **scope** per unit of work.

For scheduling and persistence use **Quartz.NET** (cron, clustering) or **Hangfire** (persistent jobs, dashboard). For durable, scalable work use a **message queue** (SQS, Service Bus, RabbitMQ) with competing consumers, retries, and a dead-letter queue.

Considerations: multiple instances (leader election / distributed lock so a cron job runs once), graceful shutdown ({{HostOptions.ShutdownTimeout}}), idempotency, and back-pressure.`,
  pts: [r`Scope per work item`, r`Unhandled exception stops the host`, r`Durable work belongs in a queue`, r`One instance runs the cron`],
  ex: r`A nightly job ran three times because three replicas each had an in-process timer; a database lock fixed it.`,
  fu: [r`How do you drain work on SIGTERM?`],
  pit: [r`In-memory queues for work that must not be lost.`] },

{ id: 'q12', level: 'Intermediate', tags: ['performance'],
  code: r`~~~csharp
builder.Services.AddResponseCompression(o => { o.EnableForHttps = true; o.Providers.Add<BrotliCompressionProvider>(); });
builder.Services.AddDbContextPool<AppDb>(o => o.UseNpgsql(cs));                 // pooled contexts
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJson.Default)); // source-gen JSON

app.MapGet("/orders", async (AppDb db, int page, CancellationToken ct) =>
    await db.Orders.AsNoTracking()                                          // no change tracking for reads
        .OrderByDescending(o => o.CreatedAt).Skip(page * 50).Take(50)
        .Select(o => new OrderDto(o.Id, o.Total))                           // project, do not load entities
        .ToListAsync(ct));
~~~`,
  q: r`What are the main performance levers in an ASP.NET Core API?`,
  a: r`1. **Async I/O end to end**; no sync-over-async.
2. **Data access**: avoid N+1, project only needed columns, index properly, pagination, compiled queries/{{AsNoTracking}}.
3. **Serialisation**: System.Text.Json with source generation; avoid huge object graphs.
4. **Caching** at the right layers; response compression (Brotli) for text.
5. **HttpClient** via factory with connection reuse; HTTP/2.
6. **Allocation**: pooling, {{Span}}, avoid LINQ in hot loops, {{ValueTask}} where proven.
7. **Server settings**: Server GC, tiered PGO (default in .NET 8), ReadyToRun.
8. **Rate limiting and back-pressure** to protect the app.

Process: measure (OpenTelemetry traces, dotnet-counters, profiler) before changing anything; usually the database dominates.`,
  pts: [r`Database first`, r`Async and serialisation`, r`Measure with traces and counters`],
  ex: r`Replacing Newtonsoft with source-generated STJ and adding {{AsNoTracking}} cut a list endpoint from 180 ms to 60 ms.`,
  fu: [r`What is tiered compilation and dynamic PGO?`],
  pit: [r`Micro-optimising code when one query takes 90% of the time.`] },

{ id: 'q13', level: 'Intermediate', tags: ['rate-limiting'],
  q: r`How do you implement rate limiting and protect an API from abuse?`,
  a: r`.NET 7+ includes {{Microsoft.AspNetCore.RateLimiting}} with fixed window, sliding window, token bucket and concurrency limiters, partitioned by user, API key, tenant or IP. Return {{429 Too Many Requests}} with {{Retry-After}}.

~~~csharp
builder.Services.AddRateLimiter(o => o.AddPolicy("per-user", ctx =>
    RateLimitPartition.GetTokenBucketLimiter(ctx.User.Identity?.Name ?? ctx.Connection.RemoteIpAddress!.ToString(),
        _ => new TokenBucketRateLimiterOptions { TokenLimit = 100, TokensPerPeriod = 50, ReplenishmentPeriod = TimeSpan.FromSeconds(10) })));
~~~

The built-in limiters are **per instance**; a global limit across replicas needs a distributed store (Redis) or enforcement at the gateway/WAF. Layer defences: WAF, gateway limits, per-tenant quotas, request size limits, timeouts.`,
  pts: [r`Algorithm choice by burst behaviour`, r`Per-instance caveat`, r`Return 429 with Retry-After`, r`Gateway for global limits`],
  ex: r`Token bucket per API key allowed bursts for partner batch uploads while capping sustained rate.`,
  fu: [r`Why is IP-based limiting weak behind NAT?`],
  pit: [r`Assuming per-instance limits are a global limit.`] },

{ id: 'q14', level: 'Intermediate', tags: ['jwt', 'security'],
  q: r`How do you configure JWT bearer authentication correctly?`,
  a: r`Validate everything: issuer, audience, signature (keys from the identity provider's JWKS, refreshed and cached), lifetime with small {{ClockSkew}}, and algorithm allow-list. Prefer {{AddJwtBearer}} with {{Authority}} so keys and metadata are discovered.

~~~csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.Authority = "https://login.example.com";
    o.Audience = "orders-api";
    o.TokenValidationParameters = new() { ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true, ClockSkew = TimeSpan.FromSeconds(30) };
});
~~~

Keep access tokens short-lived; authorise by scopes/claims via policies; never put secrets in the token; remember a JWT cannot be revoked before expiry without extra mechanisms (short life, introspection, deny-list). See the OAuth2/OIDC topic for the flows.`,
  pts: [r`Validate issuer, audience, lifetime, signature`, r`Use Authority and JWKS`, r`Short-lived tokens`, r`Revocation needs design`],
  ex: r`A service accepted tokens meant for another API because audience validation was off.`,
  fu: [r`What is the alg=none attack?`],
  pit: [r`Disabling validation to "get it working".`] },

{ id: 'q15', level: 'Intermediate', tags: ['testing'],
  code: r`~~~csharp
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder().WithImage("postgres:16").Build();
    protected override void ConfigureWebHost(IWebHostBuilder b) => b.ConfigureTestServices(s =>
    {
        s.RemoveAll<DbContextOptions<AppDb>>();
        s.AddDbContext<AppDb>(o => o.UseNpgsql(_pg.GetConnectionString()));
        s.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
    });
    public async Task InitializeAsync() => await _pg.StartAsync();
    public new async Task DisposeAsync() => await _pg.DisposeAsync();
}
public sealed class OrdersTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact] public async Task Create_returns_201() =>
        (await f.CreateClient().PostAsJsonAsync("/orders", new { sku = "A", qty = 1 })).StatusCode.Should().Be(HttpStatusCode.Created);
}
~~~`,
  q: r`How do you test ASP.NET Core applications?`,
  a: r`Testing pyramid:

- **Unit tests** for domain and application logic (no framework).
- **Integration tests** with {{WebApplicationFactory<Program>}}: host the real pipeline in memory, replace external dependencies (swap DbContext for a real container DB via **Testcontainers**, fake HTTP clients), call via {{HttpClient}}.
- **Contract tests** (Pact / OpenAPI diff) for consumers and providers.
- **End-to-end** sparingly.

Prefer real databases in containers over EF InMemory (different semantics; no constraints or SQL translation). Use {{TimeProvider}} and a fake clock; make {{Program}} accessible with {{public partial class Program}}. Seed per test, isolate with transactions or database-per-test.`,
  pts: [r`WebApplicationFactory`, r`Testcontainers over InMemory`, r`Contract tests`, r`Fake time`],
  ex: r`A unique-index bug only appeared against real SQL Server in Testcontainers, never with the EF InMemory provider.`,
  fu: [r`How do you test authentication in integration tests?`],
  pit: [r`Mocking the DbContext.`] },

{ id: 'q16', level: 'Intermediate', tags: ['serialization'],
  code: r`~~~csharp
var opts = new JsonSerializerOptions(JsonSerializerDefaults.Web)          // camelCase, case-insensitive reads
{
    NumberHandling = JsonNumberHandling.Strict,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,           // .NET 8: reject unknown fields
    Converters = { new JsonStringEnumConverter() }                         // enums as strings (not ints)
};
public sealed record Order(Guid Id, [property: JsonRequired] decimal Total);   // fail when missing
// Differences that bite after migrating from Newtonsoft: no $ref handling by default, case-sensitive by default
// outside Web defaults, stricter number/string coercion, private setters not populated without [JsonInclude]
~~~`,
  q: r`System.Text.Json versus Newtonsoft.Json: what changed and what bites?`,
  a: r`System.Text.Json (STJ) is faster, lower allocation, secure by default (strict, case-sensitive unless configured) and supports **source generation** for AOT/trim. Newtonsoft is more permissive and feature-rich (polymorphism, {{JsonConvert}}, JObject, many converters).

STJ gaps closed over time (polymorphism via {{[JsonDerivedType]}}, {{JsonNode}}, required members, {{JsonSerializerOptions.Web}} defaults). Remaining bites: no automatic private setters/fields without options, enums as strings need a converter, reference cycles need {{ReferenceHandler.IgnoreCycles}}, and numbers in quotes.

Decide per project; for new code use STJ with source-generated contexts; pin serialisation options in one shared place so API and clients agree.`,
  pts: [r`STJ faster and AOT friendly`, r`Polymorphism needs attributes`, r`Centralise options`],
  ex: r`Source-generated context removed reflection warm-up and cut cold-start time of a Lambda API.`,
  fu: [r`How do you handle schema evolution with unknown fields?`],
  pit: [r`Different naming policies between services.`] },

{ id: 'q17', level: 'Intermediate', tags: ['configuration', 'cloud'],
  code: r`~~~dockerfile
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish src/Orders.Api -c Release -o /app /p:UseAppHost=false
FROM mcr.microsoft.com/dotnet/aspnet:9.0-noble-chiseled
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_HTTP_PORTS=8080
USER app
ENTRYPOINT ["dotnet", "Orders.Api.dll"]
~~~
~~~csharp
builder.Configuration.AddEnvironmentVariables();                 // config from the environment (12-factor)
builder.Logging.AddJsonConsole();                                // logs as event streams to stdout
~~~`,
  q: r`How do you structure a .NET service for containers and the 12-factor model?`,
  a: r`- **Config from environment** (no baked secrets); one image for all environments.
- **Stateless processes**: sessions and caches external (Redis); local disk is ephemeral.
- **Logs to stdout** in structured form; the platform collects them.
- **Health endpoints** for probes; graceful shutdown on SIGTERM (finish in-flight requests within {{terminationGracePeriodSeconds}}).
- **Small images**: multi-stage Dockerfile, chiseled/alpine base, non-root user, {{DOTNET_}} env settings; set memory-aware GC ({{DOTNET_GCHeapHardLimit}}) and CPU limits (the runtime reads cgroup limits).
- **Port binding** via {{ASPNETCORE_URLS}}; no HTTPS inside the cluster if the mesh/ingress handles TLS.
- **Dependencies versioned and scanned**; SBOM and vulnerability scan in CI.`,
  pts: [r`Env config, stateless, stdout logs`, r`Graceful SIGTERM`, r`Runtime respects cgroup limits`],
  ex: r`Pods were OOM-killed until memory limits and GC hard limit were set consistently.`,
  fu: [r`How does .NET decide the number of GC heaps in a container?`],
  pit: [r`Storing uploads on the container filesystem.`] },

{ id: 'q18', level: 'Intermediate', tags: ['grpc'],
  code: r`~~~protobuf
syntax = "proto3";
option csharp_namespace = "Pricing.Grpc";
service Pricing { rpc GetQuote (QuoteRequest) returns (QuoteReply); rpc StreamQuotes (QuoteRequest) returns (stream QuoteReply); }
message QuoteRequest { string symbol = 1; }
message QuoteReply { string symbol = 1; int64 price_micros = 2; int64 ts_unix_ms = 3; }
~~~
~~~csharp
builder.Services.AddGrpc();
app.MapGrpcService<PricingService>();
builder.Services.AddGrpcClient<Pricing.PricingClient>(o => o.Address = new Uri("https://pricing:5001"))
    .AddStandardResilienceHandler();
~~~`,
  q: r`When would you choose gRPC over REST in .NET?`,
  a: r`gRPC (HTTP/2, protobuf, generated clients) fits **internal service-to-service** calls: strongly typed contracts, compact binary payloads, streaming (server, client, bidirectional), deadlines propagation, and lower latency. Costs: poor browser support (needs gRPC-Web), harder ad-hoc debugging, load-balancing needs HTTP/2-aware L7 balancers, and contract evolution discipline (never reuse field numbers).

REST/JSON remains better for public APIs, browser clients and caching via HTTP semantics. In .NET: {{Grpc.AspNetCore}}, {{Grpc.Net.ClientFactory}}, interceptors for auth and logging, JSON transcoding to expose both.`,
  pts: [r`Internal, streaming, typed`, r`HTTP/2 load-balancing caveat`, r`Protobuf evolution rules`],
  ex: r`A pricing service exposed gRPC to 15 internal callers with deadlines; a REST gateway served partners.`,
  fu: [r`How do deadlines propagate across calls?`],
  pit: [r`Using a Layer 4 balancer that pins all calls to one pod.`] },

{ id: 'q19', level: 'Senior', tags: ['signalr'],
  code: r`~~~csharp
builder.Services.AddSignalR().AddStackExchangeRedis(redisCs, o => o.Configuration.ChannelPrefix = RedisChannel.Literal("app"));
app.MapHub<PricesHub>("/hubs/prices");
public sealed class PricesHub : Hub
{
    public Task Subscribe(string symbol) => Groups.AddToGroupAsync(Context.ConnectionId, "sym:" + symbol);
}
// push from anywhere in the app
public sealed class PricePusher(IHubContext<PricesHub> hub)
{ public Task PushAsync(string symbol, decimal px) => hub.Clients.Group("sym:" + symbol).SendAsync("price", symbol, px); }
~~~
~~~typescript
const conn = new signalR.HubConnectionBuilder().withUrl('/hubs/prices').withAutomaticReconnect().build();
conn.on('price', (sym: string, px: number) => store.update(sym, px));
await conn.start(); await conn.invoke('Subscribe', 'EURUSD');
~~~`,
  q: r`SignalR: transports, scaling and pitfalls.`,
  a: r`SignalR provides real-time messaging with transport negotiation: WebSockets, then Server-Sent Events, then long polling. Connections are **stateful**, so scale-out needs either **sticky sessions** (for long polling/negotiation) plus a **backplane** (Redis, Azure SignalR Service) so a message sent on one node reaches clients on others.

Pitfalls: connection memory per client, reconnect storms after deploys (use jittered backoff, drain gracefully), authentication via query-string tokens for WebSockets, message size limits, and treating hubs as transient (store durable state elsewhere). Use groups for fan-out; keep hub methods thin.`,
  pts: [r`Backplane for multi-node`, r`Reconnect storms`, r`Auth over WebSockets`],
  ex: r`Azure SignalR Service offloaded 80,000 connections from the app nodes.`,
  fu: [r`SSE vs WebSockets vs polling trade-offs?`],
  pit: [r`Keeping business state in hub instance fields.`] },

{ id: 'q20', level: 'Senior', tags: ['threading'],
  code: r`~~~bash
dotnet-counters monitor -n Orders.Api --counters System.Runtime[threadpool-queue-length,threadpool-thread-count],Microsoft.AspNetCore.Hosting[current-requests]
dotnet-trace collect -n Orders.Api --profile cpu-sampling --duration 00:00:30
dotnet-stack report -n Orders.Api        # many threads blocked in .Result / Monitor.Enter / SqlConnection.Open?
~~~
~~~text
Low CPU + high latency = waiting: thread-pool starvation, connection-pool exhaustion (DB/HTTP),
lock contention, downstream latency. Check pool wait counters before scaling out.
~~~`,
  q: r`A .NET API has low CPU and high latency under load. How do you investigate?`,
  a: r`Low CPU plus high latency means requests are **waiting**, not computing.

1. **Triage dependencies**: distributed traces show where time goes (DB, downstream HTTP, queue).
2. **Thread-pool starvation**: {{dotnet-counters}} for queue length and thread count; a dump showing many threads in {{Task.Wait}}/{{GetResult}}. Fix sync-over-async.
3. **Connection pool exhaustion**: SQL "timeout expired obtaining a connection", HttpClient/port exhaustion; look at pool metrics and long-held connections.
4. **Lock contention**: threads blocked in {{Monitor.Enter}}.
5. **Downstream saturation / retries amplifying load** (retry storms).
6. **GC**: pause time metrics.

Fix the cause, then add **bulkheads, timeouts and concurrency limits** so one slow dependency cannot take the whole service.`,
  pts: [r`Waiting, not working`, r`Traces → counters → dump`, r`Pools: threads, DB connections, sockets`, r`Bulkheads and timeouts`],
  ex: r`Every request awaited a call that internally did {{.Result}}; starvation occurred at 400 RPS. Removing it doubled capacity.`,
  fu: [r`What metrics would you alert on for early detection?`],
  pit: [r`Scaling out instances without finding the contention.`] },

{ id: 'q21', level: 'Senior', tags: ['ef', 'data'],
  code: r`~~~csharp
builder.Services.AddDbContextPool<AppDb>(o => o.UseSqlServer(cs, sql => sql.EnableRetryOnFailure()), poolSize: 256);
// Wrong: singleton capturing a scoped context (shared across threads -> InvalidOperationException)
builder.Services.AddSingleton<ReportCache>();          // ReportCache(AppDb db)  <- captive dependency
// Wrong: parallel queries on one context
await Task.WhenAll(db.Orders.ToListAsync(), db.Customers.ToListAsync());   // "A second operation was started..."
// Right: one context per unit of work, or IDbContextFactory for parallel/background work
public sealed class Exporter(IDbContextFactory<AppDb> factory)
{
    public async Task RunAsync(CancellationToken ct) { await using var db = await factory.CreateDbContextAsync(ct); /* ... */ }
}
~~~`,
  q: r`DbContext lifetime and connection pooling in web apps: what goes wrong?`,
  a: r`{{DbContext}} is a **unit of work, not thread safe, cheap to create**. Register it scoped (per request). Do not share across threads ({{Task.WhenAll}} with one context throws "second operation started"), do not make it a singleton, and do not keep it alive across requests (change-tracker grows).

Connection pooling is by connection string in ADO.NET (default max 100 for SqlClient). Long-running requests holding connections, or opening connections without disposal, exhaust the pool. Use {{AddDbContextPool}} to reuse context instances (state is reset), {{IDbContextFactory<T>}} for background work or Blazor, and keep transactions short.

For read-heavy endpoints use {{AsNoTracking}} and projections. See the EF Core topic for tracking and concurrency details.`,
  pts: [r`Scoped, single-threaded`, r`Pool exhaustion = held connections`, r`Factory for background work`],
  ex: r`Parallel queries on one context threw intermittent exceptions; creating one context per task via the factory fixed it.`,
  fu: [r`What does AddDbContextPool reset between uses?`],
  pit: [r`Registering DbContext as singleton.`] },

{ id: 'q22', level: 'Senior', tags: ['idempotency'],
  q: r`Implement idempotent POST endpoints.`,
  a: r`Clients retry on timeouts, so a POST that creates a payment must be safe to repeat.

1. Client sends an {{Idempotency-Key}} header (UUID).
2. Server stores {{(key, request hash, status, response)}} with a unique constraint in the **same transaction** as the business change.
3. A repeat with the same key and same hash returns the **stored response**; same key with a different body returns 422/409.
4. In-flight duplicates: a concurrent request with the same key waits or gets 409 (a row in {{IN_PROGRESS}} state).
5. Expire keys after a window (for example 24 h).

~~~csharp
public async Task<IResult> Create(Req req, [FromHeader(Name = "Idempotency-Key")] string key, CancellationToken ct)
{
    if (await _store.TryGetAsync(key, ct) is { } saved) return Results.Json(saved.Body, statusCode: saved.Status);
    var result = await _service.CreateAsync(req, ct);          // business change + key insert in one transaction
    return Results.Created($"/payments/{result.Id}", result);
}
~~~`,
  pts: [r`Key + request hash`, r`Atomic with the side effect`, r`Handle in-flight duplicates`, r`Expire keys`],
  ex: r`A mobile client retried over flaky networks; idempotency keys prevented duplicate transfers.`,
  fu: [r`What if the first attempt crashed halfway?`],
  pit: [r`Checking the key in a separate transaction from the write.`] },

{ id: 'q23', level: 'Senior', tags: ['observability'],
  code: r`~~~csharp
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("orders-api", serviceVersion: "1.8.2"))
    .WithTracing(t => t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation()
        .AddEntityFrameworkCoreInstrumentation().AddSource("Orders").AddOtlpExporter())
    .WithMetrics(m => m.AddAspNetCoreInstrumentation().AddRuntimeInstrumentation().AddMeter("Orders").AddOtlpExporter());
builder.Logging.AddOpenTelemetry(l => { l.IncludeScopes = true; l.AddOtlpExporter(); });

static readonly ActivitySource Source = new("Orders");
using var activity = Source.StartActivity("PlaceOrder");
activity?.SetTag("order.items", cmd.Items.Count);
~~~`,
  dia: r`flowchart LR
  A[.NET service: traces, metrics, logs via OTel SDK] -->|OTLP| C[OpenTelemetry Collector]
  C -->|traces| T[Tempo / Jaeger / X-Ray]
  C -->|metrics| P[Prometheus / Azure Monitor]
  C -->|logs| L[Loki / Elastic]
  T & P & L --> G[Grafana dashboards + alerts]`,
  q: r`How do you add observability with OpenTelemetry in .NET?`,
  a: r`OpenTelemetry gives vendor-neutral **traces, metrics and logs**. In .NET, {{System.Diagnostics.Activity}} is the trace primitive and {{System.Diagnostics.Metrics}} ({{Meter}}) the metrics API; the OTel SDK exports via OTLP to a collector (Jaeger/Tempo, Prometheus, Datadog, CloudWatch, App Insights).

Instrument: ASP.NET Core, HttpClient, SqlClient/EF Core, gRPC, Redis, MassTransit (auto), plus **custom spans and business metrics** (orders placed, payment failures). Propagate W3C {{traceparent}} across HTTP and message headers so one trace spans services; add the {{TraceId}} to logs and error responses.

Control cost: sampling (head or tail-based at the collector), cardinality limits on metric labels, and avoid PII in attributes.`,
  pts: [r`Traces + metrics + logs correlated`, r`W3C context propagation incl. messaging`, r`Sample and watch cardinality`],
  ex: r`Trace showed 300 ms in an N+1 loop inside one handler; fixed in an hour.`,
  fu: [r`Head vs tail sampling?`],
  pit: [r`High-cardinality labels (user id) on metrics.`] },

{ id: 'q24', level: 'Senior', tags: ['streaming', 'files'],
  code: r`~~~csharp
// Upload: stream to blob storage, never buffer the whole file
app.MapPost("/files", async (HttpRequest req, BlobContainerClient container, CancellationToken ct) =>
{
    var blob = container.GetBlobClient(Guid.NewGuid().ToString("N"));
    await blob.UploadAsync(req.Body, new BlobUploadOptions { TransferOptions = new() { MaximumConcurrency = 4 } }, ct);
    return Results.Created(blob.Uri, null);
}).WithMetadata(new RequestSizeLimitAttribute(5L * 1024 * 1024 * 1024)).DisableAntiforgery();
// Download: stream with range support, or better, redirect to a short-lived SAS / pre-signed URL
app.MapGet("/files/{id}", (string id, BlobContainerClient c) =>
    Results.Redirect(c.GetBlobClient(id).GenerateSasUri(BlobSasPermissions.Read, DateTimeOffset.UtcNow.AddMinutes(5)).ToString()));
~~~`,
  q: r`How do you handle large uploads and downloads without exhausting memory?`,
  a: r`Never buffer whole files. Stream.

- **Upload**: use {{Request.Body}} / {{MultipartReader}} to stream to storage; avoid {{IFormFile}} for large files (buffers to disk beyond a threshold); set {{RequestSizeLimit}} and {{MultipartBodyLengthLimit}}. Better: issue a **pre-signed URL** so the client uploads directly to S3/Blob and your API only records metadata (then virus-scan asynchronously).
- **Download**: {{Results.File(stream, ...)}} / {{FileStreamResult}} with range support ({{enableRangeProcessing: true}}), or redirect to a pre-signed URL/CDN.
- **Validate**: content type by signature (not extension), size, scan for malware, store outside the web root with random names.
- **Back-pressure**: bounded concurrency on heavy endpoints.`,
  pts: [r`Stream not buffer`, r`Pre-signed URLs offload the API`, r`Validate by signature, scan`, r`Range requests`],
  ex: r`Direct-to-S3 uploads removed multi-GB request bodies from the API and cut node memory by 70%.`,
  fu: [r`How would you resume an interrupted upload?`],
  pit: [r`Trusting the file extension or Content-Type header.`] },

{ id: 'q25', level: 'Senior', tags: ['security'],
  code: r`~~~csharp
builder.Services.AddAuthentication().AddJwtBearer(o => { o.Authority = issuer; o.Audience = "orders-api"; o.MapInboundClaims = false; });
builder.Services.AddAuthorizationBuilder().SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
    .AddPolicy("refunds", p => p.RequireClaim("scope", "refunds:write"));
builder.Services.AddRateLimiter(o => o.AddTokenBucketLimiter("api", l => { l.TokenLimit = 100; l.TokensPerPeriod = 50; l.ReplenishmentPeriod = TimeSpan.FromSeconds(1); }));
app.UseHsts(); app.UseHttpsRedirection();
app.Use(async (ctx, next) => { ctx.Response.Headers.XContentTypeOptions = "nosniff"; ctx.Response.Headers["Referrer-Policy"] = "no-referrer"; await next(); });
builder.WebHost.ConfigureKestrel(k => { k.AddServerHeader = false; k.Limits.MaxRequestBodySize = 1_000_000; });
~~~`,
  q: r`List the main security hardening steps for an ASP.NET Core API.`,
  a: r`- **Transport**: TLS everywhere, HSTS, modern ciphers; mTLS for service-to-service where needed.
- **AuthN/AuthZ**: validated JWTs, policy and resource-based authorisation, deny by default ({{FallbackPolicy}}).
- **Input**: validate, bound sizes, parameterised queries (EF/Dapper parameters), output encoding; avoid mass assignment.
- **CORS**: explicit origins; never {{AllowAnyOrigin}} with credentials.
- **CSRF** for cookie auth (antiforgery); SameSite cookies, HttpOnly, Secure.
- **Headers**: CSP, X-Content-Type-Options, frame protection (for web UIs).
- **Secrets**: vault, managed identities, rotation; Data Protection keys persisted and shared.
- **Dependencies**: SCA scanning, minimal base images, patch cadence.
- **Rate limiting, logging without PII, audit trails**.
- **SSRF** protection on any URL-fetching feature.
- Map findings to OWASP API Top 10.`,
  pts: [r`Deny by default`, r`Validate and parameterise`, r`CORS and CSRF specifics`, r`Secrets and dependency hygiene`],
  ex: r`A webhook-preview feature fetched arbitrary URLs and reached the cloud metadata endpoint (SSRF); an allow-list and IMDSv2 fixed it.`,
  fu: [r`What are Data Protection keys and why share them across instances?`],
  pit: [r`AllowAnyOrigin plus AllowCredentials.`] },

{ id: 'q26', level: 'Senior', tags: ['pipeline'],
  code: r`~~~csharp
// MediatR pipeline behaviour: cross-cutting logic once, for every request type
public sealed class ValidationBehavior<TReq, TRes>(IEnumerable<IValidator<TReq>> validators) : IPipelineBehavior<TReq, TRes> where TReq : notnull
{
    public async Task<TRes> Handle(TReq request, RequestHandlerDelegate<TRes> next, CancellationToken ct)
    {
        var failures = (await Task.WhenAll(validators.Select(v => v.ValidateAsync(request, ct)))).SelectMany(r => r.Errors).ToList();
        if (failures.Count > 0) throw new ValidationException(failures);
        return await next();
    }
}
// Without MediatR: the same with an endpoint filter group and plain handler classes
app.MapGroup("/api").AddEndpointFilterFactory(ValidationFilterFactory.Create);
~~~`,
  q: r`How do you implement cross-cutting concerns with MediatR-style pipelines and decide whether to use MediatR at all?`,
  a: r`A **mediator** decouples endpoints from handlers and gives **pipeline behaviours** for validation, logging, transactions, caching, and authorisation around every command/query.

Benefits: consistent cross-cutting logic, thin controllers, easy handler testing. Costs: indirection (harder navigation), runtime resolution, a new dependency (MediatR is commercial from v13 for larger organisations; check licensing), and the temptation to model everything as a request.

Alternatives: plain application services with decorators (Scrutor), endpoint filters, or source-generated mediators (Mediator by martinothamar, Wolverine). Use a mediator when you have **many** use cases sharing behaviours (CQRS style); skip it for small services where a service class is clearer.

Whichever you choose, keep handlers small, transaction boundaries explicit, and avoid chatty handler-to-handler calls.`,
  pts: [r`Behaviours for cross-cutting concerns`, r`Indirection is a cost`, r`Licensing and alternatives`, r`Use when many handlers share behaviour`],
  ex: r`A {{TransactionBehavior}} wraps every command; a {{ValidationBehavior}} returns problem details before the handler runs.`,
  fu: [r`How would you order behaviours?`],
  pit: [r`Handlers calling other handlers through the mediator.`] },

{ id: 'q27', level: 'Senior', tags: ['gateway', 'yarp'],
  code: r`~~~json
{
  "ReverseProxy": {
    "Routes": {
      "orders": { "ClusterId": "orders", "AuthorizationPolicy": "default", "RateLimiterPolicy": "api", "Match": { "Path": "/api/orders/{**rest}" } }
    },
    "Clusters": {
      "orders": { "LoadBalancingPolicy": "PowerOfTwoChoices",
        "HealthCheck": { "Active": { "Enabled": true, "Path": "/health/ready" } },
        "Destinations": { "a": { "Address": "http://orders-a:8080" }, "b": { "Address": "http://orders-b:8080" } } }
    }
  }
}
~~~
~~~csharp
builder.Services.AddReverseProxy().LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));
app.MapReverseProxy();
~~~`,
  dia: r`flowchart LR
  SPA[Angular / React SPA] -->|cookie session| BFF[YARP BFF: auth, token handling]
  BFF -->|access token| O[Orders API]
  BFF -->|access token| P[Payments API]
  BFF -->|OIDC code flow + PKCE| IDP[Identity provider]`,
  q: r`What is YARP and how does it relate to API gateways and BFFs?`,
  a: r`**YARP** (Yet Another Reverse Proxy) is a .NET library for building reverse proxies/gateways with config-driven routes and clusters, load balancing (round robin, least requests, power of two choices), health checks, session affinity, header/path transforms, and the full ASP.NET Core middleware pipeline for auth and rate limiting.

Use it as a gateway: TLS termination, authentication, rate limits, routing to services, request aggregation, per-client policies. A **BFF** (backend for frontend) is a gateway specialised per client type (web, mobile) that shapes payloads and holds tokens server-side so SPAs never see them.

Compare with managed gateways (AWS API Gateway, Azure APIM, Kong): YARP is code-first and flexible but you operate it; managed services give portals, quotas and monetisation out of the box. See the API Gateway topic.`,
  pts: [r`Config-driven reverse proxy on ASP.NET Core`, r`BFF holds tokens for SPAs`, r`Build vs buy gateway`],
  ex: r`A BFF using YARP and cookie auth kept access tokens server-side for an Angular SPA.`,
  fu: [r`How does YARP do health checks and failover?`],
  pit: [r`Putting business logic in the gateway.`] },

{ id: 'q28', level: 'Senior', tags: ['async', 'streams'],
  code: r`~~~csharp
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(25));   // < terminationGracePeriodSeconds
app.Lifetime.ApplicationStopping.Register(() => readiness.MarkNotReady());                    // stop new traffic first
public sealed class Consumer : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested) await HandleNextAsync(stoppingToken);   // finish in-flight, then exit
    }
}
~~~
~~~yaml
spec:
  terminationGracePeriodSeconds: 30
  containers:
    - name: api
      lifecycle: { preStop: { exec: { command: ["sleep", "5"] } } }   # let endpoints/LB deregister first
~~~`,
  dia: r`sequenceDiagram
  participant K as Kubernetes
  participant LB as Endpoints / LB
  participant App as ASP.NET Core pod
  K->>LB: remove pod from endpoints
  K->>App: preStop sleep 5s
  K->>App: SIGTERM
  App->>App: readiness false, stop accepting
  App->>App: drain in-flight requests and consumers
  App-->>K: exit 0 before grace period
  K->>App: SIGKILL only if still running`,
  q: r`How do you design for graceful shutdown and zero-downtime deployments?`,
  a: r`On SIGTERM the host stops accepting new requests and waits for in-flight work up to {{HostOptions.ShutdownTimeout}} (default 30 s; raise it if needed, and align with Kubernetes {{terminationGracePeriodSeconds}}).

Checklist:

- Readiness fails first so the load balancer stops routing (a {{preStop}} sleep of a few seconds covers endpoint propagation delay).
- Long-running workers observe {{stoppingToken}} and finish or checkpoint; consumers stop pulling messages, finish, then ack.
- Connections (SignalR/WebSocket) get a reconnect hint and jittered client backoff.
- Rolling update with {{maxUnavailable: 0}}, readiness gates, and backward-compatible database migrations (expand/contract) so old and new versions coexist.
- Canary or blue/green with automatic rollback on SLO breach.`,
  pts: [r`Fail readiness, then drain`, r`Align timeouts with orchestrator`, r`Expand/contract migrations`, r`Canary with rollback`],
  ex: r`5xx spikes at every deploy disappeared after adding a 5-second preStop delay and raising the shutdown timeout.`,
  fu: [r`How do you migrate a column rename with zero downtime?`],
  pit: [r`Deploying a schema change incompatible with the previous app version.`] },

{ id: 'q29', level: 'Senior', tags: ['config', 'secrets'],
  code: r`~~~csharp
// Azure: Key Vault provider with managed identity (no secret to bootstrap a secret)
builder.Configuration.AddAzureKeyVault(new Uri("https://orders-kv.vault.azure.net/"), new DefaultAzureCredential());
// AWS: Secrets Manager / Parameter Store via the configuration provider
builder.Configuration.AddSystemsManager("/orders/prod/", reloadAfter: TimeSpan.FromMinutes(5));
// Local development only
// dotnet user-secrets set "Payments:ApiKey" "dev-key"
builder.Services.AddOptions<PaymentOptions>().BindConfiguration("Payments").ValidateDataAnnotations().ValidateOnStart();
~~~`,
  q: r`How do you manage secrets and configuration safely across environments?`,
  a: r`- **No secrets in source or images**. Local: user-secrets / env. Cloud: AWS Secrets Manager / Parameter Store, Azure Key Vault, loaded via configuration providers or referenced as environment variables by the platform.
- **Identity over secrets**: managed identities / IAM roles (IRSA, Workload Identity) so there is no database password to leak.
- **Rotation**: design for it (re-read via {{IOptionsMonitor}}, short-lived credentials, dual-key rotation).
- **Least privilege** per service; separate secrets per environment.
- **Auditability**: access logs on the vault, change management on config.
- **Feature flags** (Azure App Configuration, LaunchDarkly, OpenFeature) separate from secrets, with cleanup of stale flags.
- Validate config at startup; fail fast.`,
  pts: [r`Identity over secrets`, r`Rotation by design`, r`Fail fast on bad config`],
  ex: r`Moving to IAM-role-based database auth removed 40 stored passwords and a quarterly rotation chore.`,
  fu: [r`How do you handle a leaked secret in git history?`],
  pit: [r`Environment variables with secrets visible in container inspect and crash dumps.`] },

{ id: 'q30', level: 'Senior', tags: ['data-protection'],
  code: r`~~~csharp
builder.Services.AddDataProtection()
    .SetApplicationName("orders")                                                  // same name on every instance
    .PersistKeysToAzureBlobStorage(new Uri(blobUri), new DefaultAzureCredential())  // shared key ring
    .ProtectKeysWithAzureKeyVault(new Uri(kvKeyUri), new DefaultAzureCredential()); // keys encrypted at rest
// Symptom without this: cookies/antiforgery tokens issued by pod A fail on pod B ("The key was not found in the key ring")
~~~`,
  q: r`What are ASP.NET Core Data Protection keys and what breaks in a multi-instance deployment?`,
  a: r`Data Protection encrypts cookies, antiforgery tokens, TempData and anything you protect with {{IDataProtector}}. Keys are generated and stored (by default local disk / registry). In a scaled-out or containerised deployment each instance has its own key ring, so **cookies and antiforgery tokens issued by one instance cannot be decrypted by another** and users appear logged out, or POSTs fail with antiforgery errors after a deploy or scale event.

Fix: persist keys to shared storage ({{PersistKeysToStackExchangeRedis}}, blob storage, S3, database) and protect them at rest ({{ProtectKeysWithAzureKeyVault}} / KMS); set a stable {{ApplicationName}}. Keep key rotation and retention in mind.`,
  pts: [r`Shared persisted key ring`, r`Encrypt keys at rest`, r`Stable ApplicationName`],
  ex: r`Users were logged out after each pod restart until the key ring moved to Redis with KMS protection.`,
  fu: [r`Why not use Data Protection for long-term data encryption?`],
  pit: [r`Ephemeral container filesystem for keys.`] },

{ id: 'q31', level: 'Senior', tags: ['minimal-api', 'aot'],
  code: r`~~~csharp
var builder = WebApplication.CreateSlimBuilder(args);
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJson.Default));
var app = builder.Build();
app.MapGet("/orders/{id}", (Guid id) => new OrderDto(id, 10m));   // Request Delegate Generator: no reflection
app.Run();
public sealed record OrderDto(Guid Id, decimal Total);
[JsonSerializable(typeof(OrderDto))] internal partial class AppJson : JsonSerializerContext { }
~~~
~~~xml
<PublishAot>true</PublishAot>   <!-- watch warnings IL2026/IL3050: reflection-based libraries are not AOT-safe -->
~~~`,
  q: r`What does it take to run an ASP.NET Core API under Native AOT?`,
  a: r`Use {{WebApplication.CreateSlimBuilder}} or {{CreateEmptyBuilder}}, minimal APIs (MVC controllers are not AOT-compatible), **source-generated JSON** ({{JsonSerializerContext}} registered in {{ConfigureHttpJsonOptions}}), and request delegate generation (compile-time) instead of runtime reflection.

Constraints: no runtime codegen or unconstrained reflection; DI registrations must be statically analysable (avoid open generics resolved by reflection); some libraries (Newtonsoft, certain ORMs, Reflection.Emit mappers) are incompatible; EF Core support is limited (compiled models, no runtime-compiled queries in all cases) so many AOT APIs use Dapper/ADO or raw SQL.

Benefit: very fast startup, small memory footprint: ideal for Lambda, scale-to-zero containers. Verify with {{PublishAot}} and treat trim/AOT warnings (IL2xxx/IL3xxx) as errors.`,
  pts: [r`Minimal APIs + source generators`, r`Treat AOT warnings as errors`, r`Library compatibility is the blocker`],
  ex: r`A webhook receiver compiled to AOT starts in tens of milliseconds and uses a fraction of the memory.`,
  fu: [r`How would you decide between AOT and JIT for a long-running API?`],
  pit: [r`Adopting AOT before auditing dependencies.`] },

{ id: 'q32', level: 'Senior', tags: ['upgrade'],
  code: r`~~~bash
dotnet new globaljson --sdk-version 9.0.100 --roll-forward latestFeature   # pin the SDK
dotnet build -warnaserror                                                    # surface new analyzers/obsoletions
dotnet test --logger trx                                                     # contract + integration suites before rollout
~~~
~~~csharp
// Examples of behaviour that changed across versions and broke real services:
// - default container port 80 -> 8080 (.NET 8 images), non-root user
// - Kestrel / HttpClient default protocol and header handling tweaks
// - JSON serializer defaults and stricter number handling
builder.WebHost.UseUrls("http://+:8080");
~~~`,
  q: r`What breaking behaviours should you watch when upgrading ASP.NET Core versions?`,
  a: r`Read the **breaking changes** list for each version and test with production-like traffic. Typical categories: default JSON/serialisation behaviours, authentication/authorization defaults and middleware ordering, header and cookie handling, Kestrel limits and HTTP/2/3 defaults, EF Core query translation changes, obsolete APIs removed, container image base changes (user, ports: .NET 8 images default to port 8080 and non-root), trimming/AOT analyzers, and package version alignment.

Process: upgrade in a branch, enable all analyzers, run integration tests (Testcontainers), compare p95/p99 and memory in a canary against the old version, keep rollback ready. Pin the SDK with {{global.json}} and use Dependabot/Renovate for regular small upgrades instead of rare big ones.`,
  pts: [r`Read breaking changes`, r`Canary compare`, r`Small frequent upgrades`],
  ex: r`After upgrading to .NET 8 pods failed health checks because the container now listened on 8080 rather than 80.`,
  fu: [r`How do you automate dependency updates safely?`],
  pit: [r`Skipping releases and accumulating risk.`] },

{ id: 'q33', level: 'Senior', tags: ['outbox', 'ef-core'],
  q: r`Implement the transactional outbox in ASP.NET Core with EF Core and a background relay.`,
  a: r`Write the business change and the outgoing message in **one** {{SaveChanges}}; a hosted service publishes later.

~~~csharp
public sealed class OutboxMessage
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string Type { get; init; } = default!;
    public string Payload { get; init; } = default!;
    public DateTime OccurredUtc { get; init; } = DateTime.UtcNow;
    public DateTime? PublishedUtc { get; set; }
    public int Attempts { get; set; }
}

// in the command handler
order.Confirm();
db.Outbox.Add(new OutboxMessage { Type = nameof(OrderConfirmed), Payload = JsonSerializer.Serialize(new OrderConfirmed(order.Id)) });
await db.SaveChangesAsync(ct);   // one transaction: order + message

// relay
public sealed class OutboxRelay(IServiceScopeFactory scopes, IPublisher bus, ILogger<OutboxRelay> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var batch = await db.Outbox.FromSqlRaw(
                "SELECT TOP (100) * FROM Outbox WITH (UPDLOCK, READPAST, ROWLOCK) WHERE PublishedUtc IS NULL ORDER BY OccurredUtc")
                .ToListAsync(ct);   // runs inside the transaction below in real code
            foreach (var m in batch)
            {
                try { await bus.PublishAsync(m.Type, m.Payload, messageId: m.Id, ct); m.PublishedUtc = DateTime.UtcNow; }
                catch (Exception ex) { m.Attempts++; log.LogWarning(ex, "Publish failed {Id}", m.Id); }
            }
            await db.SaveChangesAsync(ct);
            if (batch.Count == 0) await Task.Delay(TimeSpan.FromMilliseconds(500), ct);
        }
    }
}
~~~

Production details: wrap claim + update in a transaction (or use a lease column); **message id = outbox id** so consumers dedupe; publish in occurrence order per aggregate if ordering matters; dead-letter after N attempts with an alert; delete or archive published rows in batches; alert on **outbox age**. Alternatives: CDC (Debezium) on the outbox table, or library support (MassTransit/NServiceBus/Wolverine outbox).`,
  pts: [r`One SaveChanges for state + message`, r`Relay with UPDLOCK/READPAST or a lease`, r`Message id = outbox id for dedupe`, r`Alert on outbox age`, r`Prefer a library when available`],
  ex: r`Before the outbox, 0.1% of orders never reached the warehouse because the publish failed after commit; the outbox removed the loss and the age alert caught a stalled relay within minutes.`,
  fu: [r`Polling versus CDC relay?`, r`How do you preserve ordering per aggregate with several relay instances?`],
  pit: [r`Publishing inside the transaction before commit.`, r`No cleanup: the outbox table grows forever and slows the claim query.`] },

{ id: 'q34', level: 'Senior', tags: ['openapi', 'full-stack'],
  code: r`~~~bash
# Generate a typed client from the API's OpenAPI document in CI and fail on contract drift
dotnet run --project src/Orders.Api -- --openapi-only > openapi/orders.json   # or the build-time OpenAPI generator
npx @openapitools/openapi-generator-cli@2.13.4 generate -i openapi/orders.json -g typescript-angular -o web/src/app/api
npx oasdiff@1.10.0 breaking openapi/orders.main.json openapi/orders.json --fail-on ERR
~~~
~~~csharp
builder.Services.AddOpenApi();   // .NET 9 Microsoft.AspNetCore.OpenApi
app.MapOpenApi();
~~~`,
  q: r`Full-stack: how do you keep an Angular/React front end and a .NET API in sync (contracts, types, versioning)?`,
  a: r`### Contract as the source of truth
- The API publishes **OpenAPI** (built-in {{Microsoft.AspNetCore.OpenApi}} in .NET 9, or Swashbuckle/NSwag).
- The front end **generates a typed client** (NSwag, openapi-typescript, Orval, Kiota) in CI; hand-written DTOs drift.
- A CI step **diffs the spec** against the last release and fails on breaking changes; the front-end build fails if the generated types no longer compile, which surfaces mismatches before deploy.

### Evolution rules across independent deploys
Front end and API deploy separately, so at any moment old SPA bundles (cached in browsers for hours) talk to new APIs. Therefore the API must be **backward compatible**: additive fields, open enums, tolerant readers in TypeScript (no exhaustive switches that throw on unknown values), and expand/contract for renames. Breaking changes need a versioned endpoint or a feature flag coordinated with a front-end release.

### Shared conventions
Dates as ISO 8601 UTC strings converted at the edge, money as strings or minor units (JavaScript numbers lose precision beyond 2^53), ProblemDetails mapped to a typed error model, and pagination/cursor helpers shared.

### Testing
Consumer-driven contract tests (Pact) for key screens, and an end-to-end smoke suite on the critical journeys per release.`,
  pts: [r`OpenAPI as the contract`, r`Generated typed clients`, r`Spec diff in CI`, r`Old bundles meet new APIs`, r`Money and dates conventions`],
  ex: r`Generating the Angular client from OpenAPI caught a renamed field at build time; previously the same mismatch reached production and broke checkout for cached SPA users.`,
  fu: [r`How do you force-refresh stale SPA bundles?`, r`Monorepo or separate repos for front end and API?`],
  pit: [r`Deploying a breaking API change assuming every browser has the new bundle.`, r`Using JavaScript numbers for int64 ids or money.`] },

{ id: 'q35', level: 'Senior', tags: ['feature-flags', 'delivery'],
  code: r`~~~csharp
builder.Services.AddFeatureManagement().WithTargeting();      // Microsoft.FeatureManagement
app.MapPost("/checkout", async (IVariantFeatureManager fm, CancellationToken ct) =>
    await fm.IsEnabledAsync("NewPaymentFlow", ct) ? await NewFlowAsync(ct) : await OldFlowAsync(ct));
~~~
~~~json
{ "feature_management": { "feature_flags": [ { "id": "NewPaymentFlow", "enabled": true,
  "conditions": { "client_filters": [ { "name": "Microsoft.Targeting", "parameters": { "Audience": { "DefaultRolloutPercentage": 5,
  "Groups": [ { "Name": "staff", "RolloutPercentage": 100 } ] } } } ] } } ] } }
~~~
Every flag gets an owner and an expiry date in the backlog; a CI check lists flags older than 90 days.`,
  q: r`How do you use feature flags and progressive delivery in a .NET platform without creating a mess?`,
  a: r`Feature flags decouple **deploy** from **release**: code ships dark, then is enabled per tenant, percentage or cohort.

Implementation: {{Microsoft.FeatureManagement}} (with Azure App Configuration) or a vendor/OpenFeature SDK; evaluate flags server-side, expose only the needed flag states to the SPA, and log the flag state with each request trace so incidents can be correlated.

Discipline that keeps it sane:

- **Flag types** with different lifetimes: release toggles (remove within weeks), experiment flags, ops kill switches (permanent, documented), permission flags (really entitlements; move to the authorisation model).
- **Ownership and expiry**: every flag has an owner and a removal date; CI or a dashboard reports stale flags.
- **Test both paths** of active flags; limit simultaneous flags on one code path.
- **Progressive rollout**: 1% → 10% → 50% → 100% with automatic halt on SLO regression (canary analysis).
- **Data changes behind flags** must be compatible both ways (expand/contract).
- **Kill switches** for risky dependencies so on-call can degrade gracefully.`,
  pts: [r`Deploy is not release`, r`Typed flags with owners and expiry`, r`Progressive rollout with automatic halt`, r`Kill switches for degradation`],
  ex: r`A new pricing engine went live to 1% of merchants; the error-rate guard halted rollout at 10% after a rounding bug, with zero customer-wide impact.`,
  fu: [r`How do you avoid flag-combination explosions in testing?`, r`Server-side vs client-side flag evaluation for SPAs?`],
  pit: [r`Permanent release flags that nobody removes.`, r`Flags that change database schema assumptions.`] },

{ id: 'q36', level: 'Senior', tags: ['i18n', 'full-stack', 'money'],
  code: r`~~~csharp
public sealed record PriceDto(long AmountMinor, string Currency, DateTimeOffset AsOfUtc);   // integers + ISO currency + UTC
var dto = new PriceDto(12_999, "GBP", DateTimeOffset.UtcNow);
~~~
~~~typescript
// Angular/React: format with the user's locale and time zone at the edge only
const fmt = new Intl.NumberFormat(navigator.language, { style: 'currency', currency: dto.currency });
const amount = fmt.format(dto.amountMinor / 100);           // use the currency's minor-unit count in real code
const when = new Intl.DateTimeFormat(navigator.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(dto.asOfUtc));
~~~`,
  q: r`Full-stack: handle money, time zones and localisation correctly across a .NET API and an Angular/React UI.`,
  a: r`### Money
- Store as {{decimal(19,4)}} (or minor units as {{long}}) with an ISO 4217 currency; never floats.
- Transmit as **string** ({{"1049.50"}}) or integer minor units with currency, because JavaScript numbers are binary doubles.
- Rounding rules are business rules (banker's vs half-up, per currency exponent: JPY has 0 decimals, BHD has 3); apply them server-side and once.
- Format for display in the client with {{Intl.NumberFormat(locale, { style: 'currency', currency })}}.

### Time
- Store and transmit **UTC** instants (ISO 8601 with Z) or {{DateTimeOffset}}; dates without time ({{DateOnly}}) as {{yyyy-MM-dd}} strings so they do not shift across zones.
- Business rules defined in a zone (cut-offs, statement periods) evaluated server-side with zone ids.
- Display in the **user's zone** using {{Intl.DateTimeFormat}}; show the zone when ambiguity matters.

### Localisation
- Server returns codes and data, not translated sentences, except where server-generated documents need it ({{IStringLocalizer}}, resource files, culture from user profile).
- Client uses Angular i18n / ngx-translate or i18next/react-intl; pluralisation and RTL support.
- Parse user input with the user's locale, transmit invariant formats.`,
  pts: [r`Money as decimal server-side, string/minor units on the wire`, r`Currency exponents and rounding rules`, r`UTC instants, DateOnly as plain dates`, r`Intl APIs for display`, r`Invariant formats on the wire`],
  ex: r`A birthday stored as a midnight UTC timestamp displayed as the previous day for US users; storing it as a DateOnly string fixed it.`,
  fu: [r`How do you handle a user changing time zone?`, r`Where should currency conversion happen?`],
  pit: [r`Parsing amounts with the server culture.`, r`Sending dates as local time without an offset.`] },

{ id: 'q37', level: 'Principal', tags: ['resilience'],
  code: r`~~~csharp
builder.Services.AddHttpClient<IFxClient, FxClient>(c => c.BaseAddress = new Uri("https://fx.vendor.com"))
    .AddResilienceHandler("fx", p =>
    {
        p.AddTimeout(TimeSpan.FromSeconds(5));                                  // total budget
        p.AddRetry(new HttpRetryStrategyOptions { MaxRetryAttempts = 2, BackoffType = DelayBackoffType.Exponential, UseJitter = true });
        p.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions { FailureRatio = 0.5, MinimumThroughput = 20, BreakDuration = TimeSpan.FromSeconds(15) });
        p.AddTimeout(TimeSpan.FromSeconds(1));                                  // per attempt
        p.AddConcurrencyLimiter(50);                                            // bulkhead
    });
// Retry only idempotent operations (GET, or POST with an Idempotency-Key)
~~~`,
  q: r`Design resilience for outbound calls: timeouts, retries, circuit breakers, bulkheads.`,
  a: r`Layered, in this order from the outside: **total timeout → retry (with jittered exponential backoff) → circuit breaker → per-attempt timeout → bulkhead/concurrency limit**.

- **Timeouts** everywhere; unbounded waits cause cascading failure.
- **Retry** only transient failures and **idempotent** operations (or with an idempotency key); cap attempts; add jitter to avoid synchronised retries; respect {{Retry-After}}.
- **Circuit breaker** stops hammering a failing dependency and allows recovery (closed, open, half-open).
- **Bulkhead** isolates resources per dependency so one slow service cannot consume all threads/connections.
- **Fallback**: cached/degraded response when acceptable.
- **Hedging** for tail latency on idempotent reads.

In .NET use {{Microsoft.Extensions.Http.Resilience}} (Polly v8 pipelines). Retries multiply load: budget them (retry only a small percentage of traffic).`,
  pts: [r`Order of strategies`, r`Idempotency before retry`, r`Retry budget`, r`Bulkheads isolate failure`],
  ex: r`Three retries across three layers produced 27x load on a recovering service; a retry budget at one layer fixed it.`,
  fu: [r`Where should retries live in a multi-layer call chain?`],
  pit: [r`Retrying at every layer.`] },

{ id: 'q38', level: 'Principal', tags: ['multi-tenancy'],
  code: r`~~~csharp
public interface ITenantContext { string TenantId { get; } }
public sealed class TenantMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext ctx, TenantContext tenant)
    {
        tenant.TenantId = ctx.User.FindFirst("tenant_id")?.Value ?? throw new UnauthorizedAccessException();  // from the token, not a header
        await next(ctx);
    }
}
public sealed class AppDb(DbContextOptions<AppDb> o, ITenantContext tenant) : DbContext(o)
{
    protected override void OnModelCreating(ModelBuilder b) =>
        b.Entity<Invoice>().HasQueryFilter(i => i.TenantId == tenant.TenantId);   // global filter on every query
}
~~~`,
  q: r`How do you design multi-tenancy in an ASP.NET Core application?`,
  a: r`Decisions:

- **Tenant resolution**: subdomain, header, route, or token claim, resolved in middleware into a scoped {{ITenantContext}}.
- **Data isolation models**: database per tenant (strongest isolation, ops cost, easy per-tenant restore), schema per tenant, or shared tables with a {{TenantId}} column (cheapest, highest leak risk).
- **Enforcement**: EF Core **global query filters** on {{TenantId}} plus a {{SaveChanges}} interceptor stamping it; database row-level security as defence in depth; tests asserting cross-tenant reads fail.
- **Noisy neighbour**: per-tenant rate limits, quotas, and cache key prefixes.
- **Config and customisation** per tenant; migration strategy across many databases.

Choose by compliance and scale: regulated clients often require database-per-tenant.`,
  pts: [r`Resolve tenant once, early`, r`Filters + interceptors + RLS`, r`Isolation model driven by compliance`, r`Noisy-neighbour controls`],
  ex: r`A missed {{IgnoreQueryFilters()}} in a report leaked another tenant's rows; an automated test enumerating all queries for the filter prevented recurrence.`,
  fu: [r`How do you run migrations on 2,000 tenant databases?`],
  pit: [r`Cache keys without tenant id.`] },

{ id: 'q39', level: 'Principal', tags: ['architecture'],
  code: r`~~~text
src/
  Modules/
    Orders/
      Orders.Api/          endpoints (vertical slices: PlaceOrder/, CancelOrder/ each with request, handler, validator)
      Orders.Core/         domain + application, internal by default
      Orders.Contracts/    public commands/events other modules may use
    Billing/ ...
  Host/                    composition root wires modules
tests/ArchitectureTests    "Orders must not reference Billing.Core"
~~~`,
  q: r`How would you structure a solution: Clean Architecture, vertical slices, or modular monolith?`,
  a: r`**Layered / Clean**: Domain ← Application ← Infrastructure/Web; dependency rule points inward. Good for enforcing separation, but folders-by-layer scatter one feature across many places.

**Vertical slice**: organise by feature (request, handler, validator, endpoint, data access together). High cohesion, easy to delete or move a feature, pragmatic with minimal abstractions.

**Modular monolith**: bounded-context modules with explicit public contracts, own schema, communicating via in-process interfaces/events; enforce boundaries with architecture tests ({{NetArchTest}}). Delivers most microservice benefits (team autonomy, clear ownership) without distributed-system cost, and leaves a path to extract services.

Recommendation for most teams: **modular monolith with vertical slices inside modules**, Clean-style dependency direction for the core, and microservices only where scaling, team or compliance boundaries demand it.`,
  pts: [r`Dependency rule inward`, r`Slices increase cohesion`, r`Modular monolith as default`, r`Architecture tests enforce boundaries`],
  ex: r`Architecture tests failed the build when the Billing module referenced Inventory internals.`,
  fu: [r`How do modules share data without a shared database?`],
  pit: [r`Early microservices with a distributed monolith result.`] },

{ id: 'q40', level: 'Principal', tags: ['messaging'],
  code: r`~~~csharp
public sealed class OrderPlacedConsumer(IConsumer<string, string> consumer, IServiceScopeFactory scopes, ILogger<OrderPlacedConsumer> log) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken ct) => Task.Run(async () =>
    {
        consumer.Subscribe("orders.placed");
        while (!ct.IsCancellationRequested)
        {
            var msg = consumer.Consume(ct);
            await using var scope = scopes.CreateAsyncScope();
            var inbox = scope.ServiceProvider.GetRequiredService<IInbox>();
            if (await inbox.TryMarkProcessedAsync(msg.Message.Key + ":" + msg.Offset, ct))       // idempotency
                await scope.ServiceProvider.GetRequiredService<IOrderPlacedHandler>().HandleAsync(msg.Message.Value, ct);
            consumer.Commit(msg);                                                              // after processing
        }
    }, ct);
}
~~~`,
  dia: r`flowchart LR
  K[(Kafka / Service Bus)] --> W[BackgroundService consumer]
  W --> S[Scope per message]
  S --> I[(Inbox table: dedupe)]
  S --> H[Handler + DbContext]
  H --> DB[(Database)]
  W -->|commit offset / complete| K
  W -->|poison after N tries| DLQ[(Dead-letter)]`,
  q: r`How do you integrate message consumers into an ASP.NET Core host reliably?`,
  a: r`Run consumers as hosted services (or via MassTransit/Wolverine/NServiceBus) and treat each message as a **unit of work with its own scope**.

- **At-least-once**: ack only after the work and any outbox write are committed; handlers idempotent (inbox table).
- **Retries**: immediate few retries for transient faults, then delayed/exponential, then **dead-letter queue** with alerting and a replay tool.
- **Concurrency**: prefetch and concurrency limits sized to downstream capacity; ordering via partition key/session when required.
- **Poison messages** quarantined, never block the queue.
- **Shutdown**: stop receiving, finish in-flight, ack, exit.
- **Telemetry**: propagate trace context in headers; metrics for queue depth and age (alert on message age, not just depth).`,
  pts: [r`Scope per message`, r`Idempotent handlers + outbox`, r`DLQ + replay`, r`Alert on message age`],
  ex: r`A poison message with an unparseable payload blocked a partition until a DLQ policy was added.`,
  fu: [r`How do you preserve ordering with multiple consumers?`],
  pit: [r`Acking before the database commit.`] },

{ id: 'q41', level: 'Principal', tags: ['architecture', 'decision'],
  code: r`~~~text
Counter-proposal: modular monolith first, extract on evidence
Step 1  Draw module boundaries from the domain (Orders, Billing, Catalog...) inside the monolith
Step 2  Enforce with architecture tests + internal types; one schema per module
Step 3  Measure: which module needs independent scaling, release cadence or team ownership?
Step 4  Extract 1-2 services that meet those criteria (strangler via YARP routes), not 12 at once
Exit criteria per extraction: own data, async integration, own pipeline, SLOs, on-call owner
~~~`,
  q: r`A team wants to split a working ASP.NET Core monolith into 12 microservices. How do you respond?`,
  a: r`Start with the problem, not the solution. Ask: what is not working today (deploy contention, scaling hot spots, team conflicts, compliance isolation)? Are those measured? Can a **modular monolith**, better CI/CD, or extracting one or two services solve it?

Evidence to request: change-coupling analysis, deployment frequency and lead time, incident causes, per-module scaling profile, team topology. Costs to make explicit: distributed transactions (sagas), network failure modes, observability, contract versioning, platform maturity, on-call load, and cost.

Recommendation pattern: (1) enforce module boundaries inside the monolith with architecture tests; (2) extract the module with the strongest independent-scaling or team-ownership case using the strangler approach; (3) measure the outcome; (4) continue only if the benefits materialise. Record the decision and revisit triggers in an ADR.`,
  pts: [r`Problem first, evidence second`, r`Modular monolith as step one`, r`Strangler, one service at a time`, r`ADR with revisit triggers`],
  ex: r`Extracting only the high-volume pricing module delivered the scaling benefit; the other eleven stayed in the monolith.`,
  fu: [r`What would convince you the split is justified?`],
  pit: [r`Treating microservices as the goal.`],
  tip: r`Showing you can say "not yet, and here is what would change my mind" is a Principal signal.` },

{ id: 'q42', level: 'Principal', tags: ['platform'],
  code: r`~~~bash
dotnet new install Company.Templates::3.1.0
dotnet new company-api -n Payments.Api --database postgres --messaging kafka
# generated: Directory.Build.props (analyzers, nullable), OpenTelemetry, health checks, Dockerfile (chiseled, non-root),
# GitHub Actions pipeline (build, test, SBOM, image scan, deploy), Helm chart with probes/PDB/HPA, ADR folder
~~~`,
  q: r`How do you build a paved road for 20 teams building .NET services?`,
  a: r`Provide defaults that make the secure, observable, operable choice the easiest one:

- A **service template** ({{dotnet new}}/Backstage scaffolder): minimal API or controller layout, OpenTelemetry, health checks, structured logging, problem details, resilience handlers, auth, Dockerfile, CI pipeline, Kubernetes manifests.
- **Shared libraries** kept thin and versioned (platform SDK for auth, messaging, logging), with strict compatibility guarantees and a deprecation path; avoid a heavy shared "framework" that couples every team.
- **Golden pipeline**: build, test, analyzers, SCA, container scan, SBOM, deploy with canary.
- **Docs and runbooks**, a service catalogue with owners, SLOs and dashboards.
- **Adoption by value**: measure time to first deploy, not mandate compliance; allow documented deviations.
- **Feedback loop**: office hours, inner-source contributions.`,
  pts: [r`Defaults over mandates`, r`Thin versioned libraries`, r`Golden pipeline`, r`Measure adoption and lead time`],
  ex: r`A template cut new-service setup from three weeks to one day and gave every service the same dashboards.`,
  fu: [r`How do you avoid the platform team becoming a bottleneck?`],
  pit: [r`A giant shared base library that forces lock-step upgrades.`] },

{ id: 'q43', level: 'Principal', tags: ['cost'],
  code: r`~~~bash
# Measure real usage first: requests vs actual
kubectl top pods -n payments --containers
kubectl get hpa -n payments
# Typical wins: right-size requests, Arm64 (Graviton/Ampere) images, scale-to-zero for internal tools, AOT for cold-start-heavy jobs
docker buildx build --platform linux/amd64,linux/arm64 -t registry/orders-api:1.9.0 --push .
~~~
~~~xml
<ServerGarbageCollector>true</ServerGarbageCollector>
<GarbageCollectionAdaptationMode>1</GarbageCollectionAdaptationMode>   <!-- DATAS: smaller heaps in containers -->
~~~`,
  q: r`How do you reduce the hosting cost of a fleet of .NET services without hurting reliability?`,
  a: r`Measure first (cost per service, per request, per tenant), then act in order of return:

1. **Right-size** CPU/memory requests from real usage; .NET 8 containers often need less.
2. **Autoscale** on meaningful signals (RPS, queue age), scale to zero for dev/test and spiky workers.
3. **Runtime**: Server vs workstation GC settings, ReadyToRun/AOT for density, tiered PGO; fewer, larger pods can be cheaper than many tiny ones when per-pod overhead is high.
4. **Architecture**: cache, batch, remove chatty calls, move heavy work to queues, compress.
5. **Data**: usually the biggest bill: index and query tuning, read replicas, tiering cold data.
6. **Commitments**: savings plans/reserved capacity and Spot for fault-tolerant workers.
7. **Governance**: tagging, budgets, showback to teams.

Guardrails: change one thing at a time, watch SLOs, keep headroom for failover (N+1 capacity).`,
  pts: [r`Measure per request/tenant`, r`Right-size, autoscale, then commit`, r`Data tier is often the largest cost`, r`Keep failover headroom`],
  ex: r`Right-sizing and Spot for workers cut a 200-pod fleet's bill by roughly a third with unchanged SLOs.`,
  fu: [r`How do you attribute shared cluster cost to teams?`],
  pit: [r`Cutting headroom and learning about it during an incident.`] },

{ id: 'q44', level: 'Principal', tags: ['incident'],
  code: r`~~~bash
kubectl rollout history deploy/orders-api -n prod
kubectl rollout undo deploy/orders-api -n prod          # mitigate first if the change correlates
dotnet-counters collect -n Orders.Api --format csv -o after-deploy.csv --duration 00:02:00
~~~
~~~text
Diff the release: new EF query (Include of a collection -> cartesian explosion), new sync call in a hot path,
removed cache, changed HttpClient handler lifetime. Compare traces before/after for the slow endpoint.
~~~`,
  q: r`Walk through an incident: p99 latency tripled after a deployment of an ASP.NET Core service.`,
  a: r`**Stabilise**: roll back or shift traffic to the previous version (canary rollback) if the SLO is breached; communicate status.

**Diagnose** with the diff in mind:

1. What changed: code, dependencies, config, runtime version, data volume, traffic mix?
2. Compare dashboards old vs new: latency by endpoint, error rate, CPU, memory, GC pause, thread-pool queue, DB and downstream latency.
3. Traces for slow requests: where is the extra time (new query, new downstream call, serialisation)?
4. Reproduce under load in staging with the same data shape.
5. Targeted tools: {{dotnet-trace}}/profiler for CPU, {{dotnet-counters}} for pool/GC, query plans for DB.

**Fix forward** with a test that reproduces it; add a canary SLO gate and a perf regression test.

**Review (blameless)**: why did the pipeline not catch it; what alert would have caught it sooner?`,
  pts: [r`Rollback first, diagnose second`, r`Diff-driven investigation`, r`Add the missing gate`],
  ex: r`New feature added an unindexed filter; p99 tripled only for tenants with large tables, invisible in staging.`,
  fu: [r`How do you make staging data representative?`],
  pit: [r`Debugging live while customers suffer instead of rolling back.`] },

{ id: 'q45', level: 'Principal', tags: ['compliance'],
  code: r`~~~csharp
// Structured, immutable audit trail of who did what, separate from diagnostic logs
public sealed record AuditEvent(string Actor, string Action, string Resource, string Outcome, DateTimeOffset AtUtc, string CorrelationId);
app.MapPost("/limits/{accountId}", async (string accountId, LimitChange cmd, IAuditSink audit, HttpContext ctx) =>
{
    /* change limit */
    await audit.WriteAsync(new AuditEvent(ctx.User.Identity!.Name!, "limit.change", "account/" + accountId, "success",
        DateTimeOffset.UtcNow, Activity.Current?.TraceId.ToString() ?? ""));
    return Results.NoContent();
}).RequireAuthorization("limits-admin");
// Redaction of sensitive fields in logs (Microsoft.Extensions.Compliance.Redaction)
builder.Services.AddRedaction(r => r.SetRedactor<ErasingRedactor>(new DataClassificationSet(DataTaxonomy.Pii)));
~~~`,
  q: r`What do regulated firms expect of an ASP.NET Core service in terms of audit, change control and data handling?`,
  a: r`- **Audit trail**: who did what, when, from where, on which record: append-only, tamper-evident, time-synchronised, retained per policy; business-level events, not only HTTP logs.
- **Change management**: peer-reviewed PRs, segregation of duties (author cannot approve/deploy alone), traceable pipeline from ticket to deployed artifact, immutable artifacts and signed images, approvals for production, documented rollback.
- **Data handling**: classification, encryption in transit and at rest with managed keys, masking in logs and lower environments, retention/erasure, data residency controls, access reviews.
- **Resilience**: documented RTO/RPO, tested DR, high availability design.
- **Evidence**: automate collection (pipeline logs, access reports) for SOX/PCI/ISO audits.

Build these into the paved road so every team inherits them.`,
  pts: [r`Append-only business audit`, r`Segregation of duties in pipelines`, r`Encrypt and mask`, r`Automate evidence`],
  ex: r`Audit asked who changed a fee configuration; the immutable audit log answered in minutes.`,
  fu: [r`How do you treat PAN data in logs and traces?`],
  pit: [r`Treating audit as an afterthought added before the audit.`] },

{ id: 'q46', level: 'Principal', tags: ['leadership'],
  code: r`~~~text
Library evaluation scorecard (fill before adoption, store as an ADR)
| Criterion                         | Score 1-5 | Evidence                                   |
| Solves a problem we measured      |           | link to incident / benchmark               |
| Maintenance: releases, maintainers|           | last release, bus factor                   |
| Licence (commercial change risk)  |           | e.g. MediatR/AutoMapper moved to commercial|
| Performance & allocations         |           | BenchmarkDotNet results                    |
| AOT / trimming compatible         |           | warnings count                             |
| Exit cost if abandoned            |           | wrapped behind our own interface?          |
~~~`,
  q: r`How do you evaluate a new framework or library (for example a mediator, ORM or messaging library) before adopting it?`,
  a: r`Use a lightweight, written rubric:

- **Fit**: does it solve a real, current problem better than the status quo, measured?
- **Maturity**: maintainers, release cadence, issue backlog, security response, .NET version support.
- **Licensing and sustainability**: licence changes (several popular OSS libraries went commercial), bus factor, fallback if abandoned.
- **Operability**: observability hooks, failure behaviour, upgrade path, debugging experience.
- **Team cost**: learning curve, hiring, documentation.
- **Exit cost**: how isolated is it behind an interface; how hard to remove.
- **Evidence**: a time-boxed spike on the hardest real use case, benchmarks if performance matters.

Decide in an ADR, adopt behind a thin seam, and set a review date.`,
  pts: [r`Written rubric`, r`Spike on the hardest case`, r`Exit cost and licensing`, r`ADR with review date`],
  ex: r`A library's licence change forced a migration; the team that had wrapped it behind an interface did it in two days.`,
  fu: [r`How do you say no to a respected colleague's favourite library?`],
  pit: [r`Adopting by blog post popularity.`] },

{ id: 'q47', level: 'Principal', tags: ['strategy'],
  code: r`~~~text
Quarter 1  Inventory + risks: .NET Framework apps, unsupported packages, CVEs; paved-road template; CI everywhere
Quarter 2  Upgrade libraries (multi-target), first services to .NET 8 LTS; OpenTelemetry baseline; SLOs for top 5 journeys
Quarter 3  Strangler extraction of the most-changed module behind YARP; contract tests; containerise
Quarter 4  Retire legacy hosting; cost and reliability review; .NET 10 LTS plan
Metrics: lead time, change failure rate, % services on supported runtime, incidents per quarter, hosting cost
~~~`,
  q: r`Sketch a 12-month technical strategy for a .NET platform that is 10 years old.`,
  a: r`1. **Baseline** (month 0-2): inventory runtimes, dependencies, hot spots, incident themes, cost, build/deploy times, security findings; agree success metrics (DORA, SLOs, cost, support status).
2. **Foundation** (2-5): upgrade to LTS; golden pipeline; observability standard; secrets and identity cleanup; architecture tests to stop boundary erosion.
3. **Reduce risk and drag** (4-9): carve out the highest-value modules (scaling or change hotspots) via strangler; data ownership clean-up; test pyramid uplift on critical flows; remove unsupported components.
4. **Enable teams** (6-12): templates, docs, service catalogue, on-call and SLO practice.
5. **Governance**: quarterly review of metrics, ADRs, deprecation calendar.

Sequence by risk reduction and unblocking value; protect delivery capacity (reserve ~20% for platform work), and report progress in business terms (incidents avoided, lead time, cost).`,
  pts: [r`Baseline then metrics`, r`LTS and pipeline first`, r`Strangler for hotspots`, r`Reserve capacity, report in business terms`],
  ex: r`Lead time fell from 3 weeks to 3 days after pipeline and test investments; that justified further platform funding.`,
  fu: [r`What would you cut if given half the capacity?`],
  pit: [r`A big-bang rewrite plan.`] },

{ id: 'q48', level: 'Principal', tags: ['synthesis'],
  code: r`~~~csharp
// Senior: "add caching with IMemoryCache"
// Principal: names the consistency budget, the failure mode, the measurement, and the rollout
app.MapGet("/rates/{pair}", async (string pair, HybridCache cache, IRates rates, CancellationToken ct) =>
    await cache.GetOrCreateAsync("rate:" + pair, t => rates.GetAsync(pair, t),
        new HybridCacheEntryOptions { Expiration = TimeSpan.FromSeconds(5) },   // agreed staleness: 5 s
        cancellationToken: ct))
   .WithMetadata(new FeatureGateAttribute("RatesCache"));                     // progressive rollout, instant rollback
// + dashboard: hit ratio, p99, upstream calls/sec before vs after
~~~`,
  q: r`What separates a Principal-level ASP.NET Core answer from a Senior one?`,
  a: r`A senior engineer builds a correct, tested endpoint and can explain middleware, DI and EF.

A principal engineer additionally:

1. **Reasons in failure modes**: starvation, pool exhaustion, retry storms, shutdown, partial failure.
2. **Measures**: traces and counters before opinions; p99, not averages.
3. **Designs the system around the service**: idempotency, outbox, versioning, tenancy, security and audit by default.
4. **Scales practices**: paved road, templates, analyzers, ADRs, migration plans.
5. **Weighs build vs adopt vs defer**, with cost, licensing and exit strategy.
6. **Communicates trade-offs** to non-engineers in terms of risk, cost and customer impact.

Discriminating question: "latency is high but CPU is low". Senior: "scale out". Principal: "find what is waiting: thread pool, DB pool, downstream, lock; prove it with traces, counters and a dump; remove the wait and add bulkheads".`,
  pts: [r`Failure modes, measurement, systems thinking`, r`Scale through platform and policy`],
  ex: r`Use the low-CPU-high-latency scenario to close an interview answer.`,
  fu: [r`Which practice would you institutionalise first?`],
  pit: [r`Feature recitation without causality.`] },

{ id: 'q49', level: 'Principal', tags: ['performance', 'design'],
  code: r`~~~text
Budget: 10,000 rps, p99 < 50 ms
- Per instance (8 vCPU) load test: ~2,500 rps at p99 30 ms  -> 4 instances needed, run 8 (N+1 per zone, failover headroom)
- Hot reads served from L1/L2 cache (>90% hit), DB sees <1,000 qps; pooled DbContext, compiled queries
- No sync I/O, no per-request allocation spikes (source-gen JSON), Server GC
- Timeouts: DB 20 ms p99 budget, downstream 15 ms with hedging/fallback
- Rate limiting + load shedding at 120% capacity to protect p99
~~~
~~~csharp
private static readonly Func<AppDb, Guid, Task<OrderDto?>> GetOrder =
    EF.CompileAsyncQuery((AppDb db, Guid id) => db.Orders.Where(o => o.Id == id).Select(o => new OrderDto(o.Id, o.Total)).FirstOrDefault());
~~~`,
  q: r`Design an ASP.NET Core service that must sustain 10,000 requests per second with p99 under 50 ms. What decisions do you make and in what order?`,
  a: r`### 1. Budget the latency
p99 50 ms end to end means the **critical path** can afford maybe one fast database round trip (2-5 ms) or a cache hit (under 1 ms), serialisation, and network. Anything synchronous and remote beyond that must be removed from the path or parallelised.

### 2. Shape the work
- **Reads**: serve from an in-process L1 cache plus Redis L2 ({{HybridCache}}) with stampede protection; precompute read models.
- **Writes**: accept, validate, persist minimally (or enqueue), and return **202** if downstream work is slow; process the rest asynchronously via outbox + workers.
- **No N+1**, projections only, compiled queries, {{AsNoTracking}}.

### 3. Runtime and framework
- Minimal APIs or lean controllers, **System.Text.Json source generation**, Server GC, HTTP/2 keep-alive between hops, {{IHttpClientFactory}} with tight per-attempt timeouts.
- Avoid allocations on hot paths ({{Span}}, pooled buffers) only where profiles show it.
- Rate limiting and **load shedding** (concurrency limiter returning 503 + {{Retry-After}}) so overload degrades gracefully instead of queueing into timeouts.

### 4. Capacity
Measure per-instance throughput at the target p99 with a load test (k6/NBomber) using production-like data; size instances for peak plus failover headroom (lose one AZ and still meet SLO); autoscale on RPS/concurrency, not CPU alone.

### 5. Verify continuously
SLO (99% under 50 ms) with burn-rate alerts; OpenTelemetry traces with exemplars to find slow outliers; GC pause and thread-pool queue metrics; perf regression test in CI.

The principal point: the architecture (cache, async writes, shedding) decides p99 far more than micro-optimisation.`,
  pts: [r`Latency budget for the critical path`, r`Cache reads, async heavy writes`, r`Load shedding over unbounded queues`, r`Load-test at target p99 with failover headroom`, r`SLO + burn-rate alerts`],
  ex: r`A pricing API met a 30 ms p99 at 12k RPS by serving from L1/L2 cache with 99.5% hit rate; only cache misses touched PostgreSQL, behind a concurrency limiter.`,
  fu: [r`What is your plan if the cache cluster fails?`, r`How do you find the 1% of slow requests?`, r`Why autoscale on concurrency rather than CPU?`],
  pit: [r`Optimising code before measuring where time goes.`, r`Sizing capacity for average load with no failover headroom.`],
  tip: r`Start from the latency budget; it turns a vague "make it fast" into concrete design constraints.` },

{ id: 'q50', level: 'Principal', tags: ['security', 'spa', 'full-stack'],
  code: r`~~~csharp
// BFF: tokens stay on the server; the SPA gets an HttpOnly, SameSite=Strict cookie
builder.Services.AddAuthentication(o => { o.DefaultScheme = "cookie"; o.DefaultChallengeScheme = "oidc"; })
    .AddCookie("cookie", o => { o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Strict; o.Cookie.SecurePolicy = CookieSecurePolicy.Always; })
    .AddOpenIdConnect("oidc", o =>
    {
        o.Authority = "https://login.example.com"; o.ClientId = "spa-bff"; o.ClientSecret = secret;
        o.ResponseType = "code"; o.UsePkce = true; o.SaveTokens = true;              // tokens in the server-side session
        o.Scope.Add("orders.read"); o.Scope.Add("offline_access");
    });
builder.Services.AddReverseProxy().LoadFromConfig(cfg.GetSection("ReverseProxy"))
    .AddTransforms(t => t.AddRequestTransform(async c =>
    {
        var token = await c.HttpContext.GetTokenAsync("access_token");
        c.ProxyRequest.Headers.Authorization = new("Bearer", token);                  // attach on the way to APIs
    }));
~~~`,
  dia: r`sequenceDiagram
  participant SPA as Angular/React SPA
  participant BFF as ASP.NET Core BFF
  participant IdP as Identity provider
  participant API as Orders API
  SPA->>BFF: GET /bff/login
  BFF->>IdP: authorize (code + PKCE)
  IdP-->>BFF: code
  BFF->>IdP: exchange code for tokens
  BFF-->>SPA: Set-Cookie HttpOnly session
  SPA->>BFF: GET /api/orders (cookie + anti-CSRF header)
  BFF->>API: GET /orders (Bearer access token)
  API-->>SPA: data via BFF`,
  q: r`Full-stack: how should an Angular or React SPA authenticate against ASP.NET Core APIs? Tokens in the browser or a BFF?`,
  a: r`### Options
1. **Tokens in the browser** (OIDC Authorization Code + PKCE in the SPA, access token sent as bearer). Simple and stateless for APIs, but tokens are reachable by any XSS in the page; refresh tokens in the browser need rotation and are still exposed; storage choice ({{localStorage}} vs memory) trades XSS exposure against reload UX.
2. **BFF (backend for frontend)**: the ASP.NET Core BFF performs the OIDC flow as a confidential client, keeps tokens **server-side**, and gives the browser an **HttpOnly, Secure, SameSite** session cookie. The BFF proxies API calls (YARP) and attaches tokens.

~~~mermaid
sequenceDiagram
  participant B as Browser (SPA)
  participant F as BFF (ASP.NET Core)
  participant I as Identity Provider
  participant A as API
  B->>F: GET /bff/login
  F->>I: Auth code + PKCE (confidential client)
  I-->>F: tokens (kept server-side)
  F-->>B: HttpOnly session cookie
  B->>F: GET /api/orders (cookie + anti-CSRF header)
  F->>A: GET /orders (Bearer access token)
  A-->>F: 200
  F-->>B: 200
~~~

### Recommendation
For regulated or high-value apps (banking, payments, admin consoles) use the **BFF**: current OAuth for browser-based apps guidance favours keeping tokens out of JavaScript. Mitigate the cookie's CSRF risk with SameSite plus an anti-forgery header. Use tokens-in-browser only for low-risk apps or where a BFF is impractical, with short-lived access tokens, refresh-token rotation, strict CSP, and no {{localStorage}}.

APIs still validate tokens and authorise per object either way.`,
  pts: [r`XSS can steal browser-held tokens`, r`BFF keeps tokens server-side, HttpOnly cookie to SPA`, r`CSRF protection for cookie sessions`, r`APIs authorise regardless`],
  ex: r`A wealth-management portal moved from tokens in localStorage to a BFF after a pentest showed a third-party script could read them.`,
  fu: [r`How does the BFF scale and where is session state stored?`, r`How do you handle token refresh in the BFF?`, r`What changes for a mobile app?`],
  pit: [r`Storing refresh tokens in localStorage.`, r`A cookie-based BFF without CSRF protection.`],
  trade: r`A BFF adds a hop and server-side session state; in exchange the browser never holds a usable token.` }
],
cheat: r`### Pipeline and hosting
- Middleware order: exception → HTTPS/HSTS → static → routing → CORS → authN → authZ → rate limit → endpoint.
- Kestrel behind a proxy; configure ForwardedHeaders. Liveness = no dependencies; readiness = dependencies.
- Graceful shutdown: fail readiness, drain, align timeouts.

### Core services
| Topic | Rule |
|---|---|
| DI | No captive dependencies; scope per background work item; ValidateScopes |
| Options | ValidateOnStart; Monitor for reload |
| HttpClient | IHttpClientFactory + resilience handler |
| DbContext | Scoped, single-threaded, factory for background |
| Errors | ProblemDetails + global handler + traceId |
| Caching | Hybrid/L1+L2, stampede protection, vary by tenant |
| Idempotency | Key + hash, atomic with the write |

### Security
Validate JWT fully; policies + resource checks; CORS explicit; CSRF for cookies; secrets in a vault; shared Data Protection keys; SSRF allow-lists; deny by default.

### Diagnose
Low CPU + high latency → waiting: traces, dotnet-counters (pool queue), dump, DB/HTTP pool metrics. Memory: gcdump diff. Deploy regression: rollback first, diff-driven analysis.

### Architecture
Modular monolith + vertical slices default; microservices only for proven scaling/team/compliance needs; architecture tests enforce boundaries.

### Say this
"Waiting, not working." "Idempotency key in the same transaction." "Retry budgets, not retries everywhere." "Paved road, not mandates."`
});
})(String.raw);
