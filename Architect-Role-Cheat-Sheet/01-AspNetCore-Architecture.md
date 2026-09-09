# 1. ASP.NET Core Architecture — 20 Questions (Answered)

> Role lens: **Solution / Technical Architect**. Every answer is written the way you would answer it to a hiring panel at a bank or payments firm: mechanism first, then trade-offs, then what you would actually do in production.
>
> **Version baseline:** answers target **.NET 10 (LTS, November 2025)** and **C# 14**, while naming the release a feature actually arrived in (`.NET 8+`, `C# 12`…) so the history stays clear. Support dates you should have at hand, because they are governance facts rather than trivia: **.NET 9 (STS) ends May 2026**, **.NET 8 (LTS) ends November 2026**, **.NET 10 (LTS) runs to November 2028**. In a regulated shop, knowing which LTS you are on and when you move off it is itself an architect-level answer.

---

## Q1. Explain ASP.NET Core architecture.

**Short answer:** ASP.NET Core is a modular, cross-platform web stack built around three ideas — a *host* that owns the application lifetime and DI container, a *server* that turns bytes on a socket into an `HttpContext`, and a *middleware pipeline* that processes that `HttpContext` as a chain of composable functions.

**The layers, bottom-up:**

| Layer | Responsibility | Concrete type |
|---|---|---|
| Host | Config, DI container, logging, lifetime, hosted services | `WebApplication` / `IHost` |
| Server | Socket I/O, HTTP/1.1, HTTP/2, HTTP/3, TLS | Kestrel (`IServer`) |
| Feature layer | Abstraction over server capabilities | `IFeatureCollection` (`IHttpRequestFeature`, `IHttpResponseBodyFeature`, …) |
| `HttpContext` | Facade over features for app code | `HttpContext` |
| Middleware pipeline | Cross-cutting request processing | `RequestDelegate` chain |
| Endpoint layer | Routing → MVC / Minimal API / gRPC / SignalR | `EndpointMiddleware` |
| Application | Controllers, handlers, domain services | Your code |

**Why it is built this way:**

- **No `System.Web`.** Classic ASP.NET was fused to IIS and `HttpContext` was a static, ambient, untestable god-object. ASP.NET Core inverted that: the server is a pluggable component, `HttpContext` is injected, and everything is testable in-process via `WebApplicationFactory`.
- **DI is first-class, not bolted on.** The container (`IServiceProvider`) is created by the host before the server starts. Every framework subsystem — routing, MVC, auth, logging, options — is registered into the same container your code uses. There is no separate "framework" resolution path.
- **Composition over inheritance.** Middleware is `Func<RequestDelegate, RequestDelegate>`. Filters, model binders, formatters, auth handlers are all interfaces registered in DI. You extend by adding a component, not by subclassing a framework base class.
- **Feature collection as the seam.** Kestrel, IIS in-process, HTTP.sys and `TestServer` all implement the same features. That is why the identical app runs unchanged under all four.

**Startup sequence (production `Program.cs`, .NET 8–10):**

```csharp
var builder = WebApplication.CreateBuilder(args);   // 1. config + logging + DI container builder
builder.Services.AddDbContext<LedgerDb>(...);       // 2. registration phase
builder.Services.AddAuthentication().AddJwtBearer();

var app = builder.Build();                          // 3. container is BUILT — no more registration

app.UseExceptionHandler();                          // 4. pipeline composition phase
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

await app.RunAsync();                               // 5. server starts, sockets bind
```

The hard boundary is step 3: after `Build()` the service collection is frozen. Architecturally this matters because it forces all wiring decisions to be declared up front and makes the graph statically analyzable (`ValidateOnBuild` / `ValidateScopes`).

**Interview follow-up you should pre-empt:** *"Where does IIS fit?"* — In .NET Core, IIS is a reverse proxy (out-of-process) or a native module hosting CoreCLR in the w3wp process (in-process). Kestrel is always the HTTP server in out-of-process mode; in-process, `IISHttpServer` replaces Kestrel. Either way the app code is identical.

---

## Q2. What happens internally when an HTTP request reaches ASP.NET Core?

Walk it end-to-end — this is the question that separates people who *use* the framework from people who *understand* it.

1. **Socket accept.** Kestrel's transport layer (`SocketTransport`, built on `System.Net.Sockets` + `System.IO.Pipelines`) accepts the TCP connection on an accept loop. Connections are dispatched to a small number of I/O queues bound to thread-pool threads — not one thread per connection.
2. **Connection middleware.** TLS handshake (`HttpsConnectionMiddleware`), then ALPN negotiates HTTP/1.1 vs HTTP/2.
3. **Protocol parsing.** `Http1Connection` (or `Http2Connection`) reads from the `PipeReader`, parses the request line and headers *without allocating strings for most of them* — headers use a generated lookup over `ReadOnlySpan<byte>` and are stored in a struct-backed `HttpRequestHeaders` with known headers as fields, not dictionary entries.
4. **`HttpContext` creation.** Kestrel pools `HttpContext`, `HttpRequest`, `HttpResponse` and the feature collection per connection (`DefaultHttpContextFactory` + `IHttpContextAccessor` if enabled). This is why **you must never capture `HttpContext` past the end of the request** — it gets reset and reused.
5. **Request scope creation.** The host creates an `IServiceScope`. Every `Scoped` service resolved during this request comes from this scope; `IAsyncDisposable`/`IDisposable` scoped services are disposed when the scope is disposed at request end.
6. **Pipeline invocation.** The composed `RequestDelegate` is invoked. Each middleware runs its "before" logic, `await _next(context)`, then its "after" logic on the way out.
7. **Routing.** `EndpointRoutingMiddleware` matches the path against the route table (a DFA-based `DfaMatcher`, not a regex loop) and sets `Endpoint` on the context. Note it **matches** early, but **executes** later at `UseEndpoints`/`MapControllers` — everything between the two sees the selected endpoint and its metadata (`[Authorize]`, CORS policy, rate-limit policy).
8. **Auth.** `AuthenticationMiddleware` runs the default scheme's handler → sets `context.User`. `AuthorizationMiddleware` reads endpoint metadata and evaluates policies.
9. **Endpoint execution.** For MVC: action selection → model binding → validation → filter pipeline → action method → result execution → output formatter. For Minimal APIs: a compiled `RequestDelegate` generated from the lambda's signature, with far fewer layers.
10. **Response write.** Result is serialized into the response `PipeWriter`; headers are flushed on first write, so **after the first byte you can no longer change the status code** — this is the root cause of "Headers are read-only, response has already started".
11. **Scope disposal, context reset, connection kept alive** for the next request.

**Architect-level point to make:** steps 3–4 and 10 are where the throughput comes from — `Span<T>`, `Pipelines`, pooled contexts, and zero-copy header handling. That is why raw Kestrel benchmarks in the millions of RPS while your app does 3K: the framework is rarely the bottleneck, *your* I/O and allocations are.

---

## Q3. Explain the ASP.NET Core middleware pipeline.

**Mechanism.** A middleware is a function `RequestDelegate -> RequestDelegate`. `IApplicationBuilder.Build()` folds the registered components **in reverse registration order**, each closing over the next, producing one nested delegate. Calling it runs the chain.

```csharp
app.Use(async (ctx, next) =>
{
    var sw = Stopwatch.StartNew();       // before: runs in registration order
    await next(ctx);                     // hand off to the rest of the pipeline
    sw.Stop();                           // after: runs in REVERSE order (unwinding)
    logger.LogInformation("{Path} {Status} {Ms}", ctx.Request.Path, ctx.Response.StatusCode, sw.ElapsedMilliseconds);
});
```

**Three shapes:**
- `Use` — passes through, can short-circuit by not calling `next`.
- `Run` — terminal, never calls `next`.
- `Map` / `MapWhen` / `UseWhen` — branches. `Map` **truncates `PathBase`/`Path`** and the branch does not rejoin; `UseWhen` branches and *rejoins* the main pipeline.

**Ordering is a correctness concern, not a style concern.** The canonical production order:

```
ExceptionHandler / DeveloperExceptionPage   ← outermost: must wrap everything below
HSTS + HttpsRedirection
ResponseCompression
StaticFiles                                  ← short-circuits before auth (deliberate: static assets are public)
Routing            (UseRouting)
CORS                                         ← must be after routing, before auth
Authentication                               ← sets ctx.User
Authorization                                ← consumes ctx.User + endpoint metadata
RateLimiter                                  ← after auth if limits are per-user
Endpoints          (MapControllers)
```

**Classic ordering bugs I probe for in interviews:**
- `UseAuthorization()` before `UseAuthentication()` → `User` is always anonymous → blanket 401s.
- `UseCors()` after `UseAuthorization()` → the preflight `OPTIONS` gets 401 because it carries no auth header, and the browser reports an opaque CORS failure.
- Exception handler registered late → exceptions in earlier middleware escape to Kestrel and return a bare 500 with no correlation ID.
- Custom middleware that writes to the response **and then** calls `next` → "response already started".

**Registration styles.** Inline lambda for trivia; a convention-based class (`public Task InvokeAsync(HttpContext, ...)`) for real logic; or `IMiddleware` when you need **scoped** dependencies — convention-based middleware is a **singleton**, constructed once, so injecting a `DbContext` into its constructor is a captive-dependency bug. Inject scoped services as *method* parameters of `InvokeAsync` instead, or implement `IMiddleware` and register it scoped.

```csharp
public sealed class TenantMiddleware               // singleton instance
{
    private readonly RequestDelegate _next;
    public TenantMiddleware(RequestDelegate next) => _next = next;

    // scoped services are injected per-invocation, not per-instance
    public async Task InvokeAsync(HttpContext ctx, ITenantResolver resolver)
    {
        ctx.Items["TenantId"] = await resolver.ResolveAsync(ctx);
        await _next(ctx);
    }
}
```

---

## Q4. What is dependency injection and how does it work?

**Definition.** DI is the technique of supplying a component's collaborators from outside rather than letting it construct them. It is the *mechanical* enabler of the Dependency Inversion Principle: high-level policy depends on abstractions; a composition root binds abstractions to implementations.

**How the built-in container works:**

1. **Registration** — `IServiceCollection` is a `List<ServiceDescriptor>`; each descriptor is `(ServiceType, ImplementationType | Factory | Instance, Lifetime)`.
2. **Build** — `BuildServiceProvider()` produces an `IServiceProvider` that compiles resolution strategies. For each service it picks a *call site* (constructor call site, factory call site, enumerable call site, …), builds an expression tree, and after a threshold of resolutions **compiles it to IL** so subsequent resolutions are near-direct construction rather than reflection.
3. **Resolution** — constructor injection is the only automatic form. The container picks the constructor with the most parameters it can satisfy; ambiguity throws at resolve time (or at build time with `ValidateOnBuild`).
4. **Disposal** — the container tracks `IDisposable`/`IAsyncDisposable` instances *it created* and disposes them when the owning scope ends. Instances you register via `AddSingleton(instance)` are **not** disposed by the container — you own them.

```csharp
builder.Services.AddScoped<IPaymentRepository, SqlPaymentRepository>();
builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddHttpClient<ISchemeClient, VisaClient>();   // typed client; handler pooled, client transient

// fail fast: catch captive dependencies and unresolvable graphs at startup, not at 3 a.m.
builder.Host.UseDefaultServiceProvider(o =>
{
    o.ValidateScopes = true;
    o.ValidateOnBuild = true;
});
```

**What the built-in container deliberately does *not* do:** property injection, named/keyed registrations before .NET 8 (`AddKeyedSingleton` added in 8), interception/decoration (you hand-roll or use Scrutor), auto-registration by convention, child containers. If you need those, swap in Autofac via `IServiceProviderFactory<T>` — but at architect level the right advice is usually "you don't need them; you need fewer abstractions."

**Anti-patterns to name:**
- **Service Locator** — injecting `IServiceProvider` and calling `GetService` inside methods. Hides the dependency graph, defeats compile-time reasoning, and makes lifetime bugs invisible.
- **Registering concrete types everywhere "just in case"** — every abstraction has a cost; introduce an interface when you have a second implementation, a test seam you actually need, or a stability boundary you are defending.
- **Constructor doing work** — constructors should assign fields only. A constructor that opens a connection or calls an API turns resolution into I/O.

---

## Q5. Explain Singleton, Scoped and Transient lifetimes.

| Lifetime | Instances | Backing store | Disposed when |
|---|---|---|---|
| **Singleton** | One per container (per app) | Root provider | App shutdown |
| **Scoped** | One per `IServiceScope` — in a web app, one per HTTP request | The scope | Scope ends (end of request) |
| **Transient** | A new one every single resolution, including every injection site | The scope that resolved it (if disposable) | That scope ends |

**Nuances that get asked as follow-ups:**

- **Transient + `IDisposable` is a leak trap.** A transient disposable resolved from the *root* provider (e.g. injected into a singleton) is tracked by the root and never released until shutdown. This is a genuine, slow memory leak — I have seen it as an OOM in a long-running worker.
- **Scoped in a non-request context.** Background services (`IHostedService`) are singletons. To use a scoped `DbContext` you must create a scope per unit of work:

```csharp
public sealed class SettlementWorker(IServiceScopeFactory scopeFactory) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();
            await ProcessBatchAsync(db, ct);
            await Task.Delay(TimeSpan.FromSeconds(5), ct);
        }
    }
}
```

- **Scope ≠ request, strictly.** A scope is whatever `CreateScope()` says it is. Request scope is just the one ASP.NET Core creates for you. gRPC streaming, SignalR hubs and message consumers each need their own deliberate scope boundary.
- **Singletons must be thread-safe.** They are shared across all concurrent requests. Mutable state in a singleton without synchronisation is a race condition waiting for load.

---

## Q6. When would you use each DI lifetime?

**Singleton — stateless, expensive to build, or intentionally shared state.**
- Configuration snapshots (`IOptions<T>` is singleton).
- `HttpClient` message handlers (via `IHttpClientFactory` — the *handler* is pooled, the client is cheap).
- Caches (`IMemoryCache`, Redis multiplexer — `IConnectionMultiplexer` **must** be a singleton; creating one per request exhausts sockets).
- Clocks, ID generators, metric collectors, compiled mappers, JSON serializer options.
- Kafka producers (thread-safe, batching, expensive to build).

**Scoped — anything that carries per-request identity or a unit of work.**
- `DbContext` (this is why `AddDbContext` is scoped by default — it is a unit of work and it is *not* thread-safe).
- Current user / tenant context resolved from the request.
- Repositories and application services that use the `DbContext`.
- Correlation-ID holders.

**Transient — cheap, stateless, short-lived; or deliberately non-shared mutable state.**
- Small pure services, validators, strategy objects, factories.
- Anything you want a fresh instance of per injection because it holds per-operation state.

**My default heuristic as an architect:** *scoped by default for application services, singleton for infrastructure that is genuinely shared and thread-safe, transient only when you can articulate why a fresh instance matters.* Defaulting everything to transient is a common mistake — it multiplies allocations and hides lifetime thinking.

**Kafka consumer nuance:** `IConsumer<TKey,TValue>` is **not** thread-safe and is long-lived → own it inside a hosted service, not the DI container, and create a scope per message for handlers.

---

## Q7. What problems can incorrect DI lifetimes cause?

Five failure modes, each with a real production signature:

**1. Captive dependency (the big one).** A longer-lived service captures a shorter-lived one. Singleton holds Scoped `DbContext` → that context lives forever, its change tracker grows unbounded, its connection is held, and concurrent requests use the *same* non-thread-safe context. Symptoms: `A second operation was started on this context before a previous operation completed`, stale reads, and a memory graph that only grows.
*Detection:* `ValidateScopes = true` (on by default in Development) throws `Cannot consume scoped service X from singleton Y`. **Turn it on in all environments** via `ValidateOnBuild` so it fails at startup.

**2. Transient-disposable leak.** As above — root-tracked disposables never freed.

**3. Accidental shared state.** Registering a stateful service as singleton because "it's faster". Under 1 RPS it works; under load, request A sees request B's tenant. This class of bug is a *security* incident in a bank, not a performance bug.

**4. Per-request expensive construction.** Registering `IConnectionMultiplexer`, a Kafka producer, or an `HttpClient` (with `new`) as transient/scoped → socket exhaustion (`SocketException: Only one usage of each socket address`), TIME_WAIT pile-up, connection storms on Redis.

**5. Lifetime mismatch across a scope boundary.** Resolving scoped services in a `BackgroundService` constructor. Fails at startup with `ValidateScopes`, or silently keeps one `DbContext` alive for the app's lifetime without it.

**Architect's control:** make lifetime a reviewed decision. In the repos I own, `Program.cs` registration blocks are grouped and commented by lifetime, `ValidateOnBuild`/`ValidateScopes` are enabled in every environment, and an architecture test (NetArchTest/ArchUnitNET) asserts that no singleton constructor parameter type is registered as scoped.

---

## Q8. How do you implement global exception handling?

**Modern approach (.NET 8+): `IExceptionHandler` + `UseExceptionHandler` + `ProblemDetails`.**

```csharp
public sealed class DomainExceptionHandler(IProblemDetailsService problemDetails, ILogger<DomainExceptionHandler> log)
    : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        (int status, string title) = ex switch
        {
            ValidationException            => (StatusCodes.Status400BadRequest, "Validation failed"),
            InsufficientFundsException     => (StatusCodes.Status422UnprocessableEntity, "Insufficient funds"),
            ConcurrencyException           => (StatusCodes.Status409Conflict, "Concurrent modification"),
            OperationCanceledException when ctx.RequestAborted.IsCancellationRequested
                                           => (499, "Client closed request"),
            _                              => (StatusCodes.Status500InternalServerError, "Unexpected error")
        };

        // log ONCE, here, with full detail and correlation
        log.LogError(ex, "Unhandled {ExceptionType} on {Method} {Path} trace={TraceId}",
            ex.GetType().Name, ctx.Request.Method, ctx.Request.Path, Activity.Current?.TraceId.ToString());

        ctx.Response.StatusCode = status;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = ctx,
            ProblemDetails = new ProblemDetails
            {
                Status = status,
                Title  = title,
                Type   = $"https://errors.acme.com/{ex.GetType().Name}",
                // NEVER ex.ToString() in the response for a 500
                Detail = status == 500 ? "An unexpected error occurred." : ex.Message,
                Extensions = { ["traceId"] = Activity.Current?.Id ?? ctx.TraceIdentifier }
            }
        });
    }
}

builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<DomainExceptionHandler>();   // order matters; first handler that returns true wins
app.UseExceptionHandler();
```

**Design rules I enforce:**
- **One place logs the exception.** Catch-and-log-and-rethrow at every layer produces five copies of the same stack trace and makes incident triage miserable.
- **Never leak internals.** Stack traces, SQL, connection strings, and inner exception chains do not go on the wire in production. RFC 7807 `ProblemDetails` with a `traceId` gives support everything they need to find the log line.
- **Distinguish expected from unexpected.** Business rule violations (insufficient funds) are *not* exceptions in a hot path — prefer a result type. Use exceptions for genuinely exceptional conditions; the 500 rate then becomes a real SLO signal.
- **Client cancellation is not an error.** `OperationCanceledException` where `RequestAborted` fired should not page anyone. Map to 499 and log at Information.
- **`UseExceptionHandler` must be first**, before HTTPS redirection and everything else, or exceptions thrown upstream escape it.

**Legacy/alternative:** a custom middleware with `try/catch` around `await _next(ctx)` does the same job and is fine; `IExceptionHandler` just gives you an ordered, testable, DI-friendly chain. MVC `IExceptionFilter` only covers MVC — it will not catch middleware or model-binding failures — which is exactly why the middleware-level handler is the *global* one.

---

## Q9. Middleware vs filters — when do you use each?

|  | Middleware | Filters |
|---|---|---|
| Scope | Every request through the pipeline, including static files, health checks, 404s | Only requests that reach an MVC/Razor endpoint |
| Knows about | `HttpContext` | MVC context: action, arguments, `ModelState`, action result |
| Runs relative to | Before/after routing depending on placement | Inside endpoint execution, after model binding |
| DI | Singleton (convention) or scoped (`IMiddleware`) | Full DI via `[ServiceFilter]`/`[TypeFilter]`/`IFilterFactory` |
| Selective application | `MapWhen`/`UseWhen`/endpoint metadata | Attribute on action/controller, or global |

**Use middleware for infrastructure concerns that are true of *all* traffic:** exception handling, correlation IDs, request logging, compression, HTTPS redirection, tenant resolution, rate limiting, static files, health-check short-circuits, security headers.

**Use filters for MVC concerns that need model-level knowledge:** validating `ModelState`, transforming action results, resource-level caching (`IResourceFilter`), per-action authorization requirements, wrapping an action in a transaction where you need the bound arguments.

**Filter types and order:** Authorization → Resource → *(model binding)* → Action → *(action executes)* → Exception → Result. That ordering is the reason `IActionFilter` can see bound arguments but `IAuthorizationFilter` cannot.

**Architect's rule of thumb:** if the concern is meaningful without MVC — do it in middleware. If removing MVC would make the concern meaningless — do it in a filter. And with Minimal APIs there are no filters in the MVC sense; you use **endpoint filters** (`AddEndpointFilter`), which are the direct analogue and compose per-endpoint.

```csharp
app.MapPost("/payments", CreatePayment)
   .AddEndpointFilter<IdempotencyFilter>()      // minimal-API equivalent of a filter
   .RequireAuthorization("payments:write");
```

---

## Q10. How do you implement authentication and authorization?

**Authentication = who you are (schemes + handlers). Authorization = what you may do (policies + requirements).**

**Authentication wiring (JWT bearer, the standard for APIs):**

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.Authority = "https://login.acme.com";       // discovery + JWKS; keys are cached and auto-rotated
        o.Audience  = "payments-api";
        o.TokenValidationParameters = new()
        {
            ValidateIssuer = true, ValidateAudience = true,
            ValidateLifetime = true, ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromSeconds(30)      // default is 5 MINUTES — far too generous for finance
        };
        o.MapInboundClaims = false;                   // keep raw JWT claim names ("sub", not the SOAP-era URI)
    });
```

Multiple schemes are normal (JWT for machine clients, cookies for a BFF, `mTLS` for internal): register several and select per endpoint with `[Authorize(AuthenticationSchemes = "...")]` or a policy scheme that forwards based on the request.

**Authorization — always policy-based in a serious system:**

```csharp
builder.Services.AddAuthorization(o =>
{
    o.AddPolicy("payments:write", p => p.RequireAuthenticatedUser().RequireClaim("scope", "payments.write"));
    o.AddPolicy("large-transfer",  p => p.Requirements.Add(new TransferLimitRequirement(50_000m)));
    o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build(); // secure by default
});
builder.Services.AddSingleton<IAuthorizationHandler, TransferLimitHandler>();
```

`FallbackPolicy` is the architect's move: it makes every endpoint authenticated **unless** explicitly marked `[AllowAnonymous]`. Deny-by-default beats remembering an attribute on 400 controllers.

**Resource-based authorization** for the case policies cannot express statically — "can this user approve *this* payment?":

```csharp
var result = await authorizationService.AuthorizeAsync(User, payment, "can-approve");
if (!result.Succeeded) return Forbid();
```

This is the mitigation for OWASP API #1 (Broken Object Level Authorization) — see §16.

**Production details that get probed:** 401 vs 403 (unauthenticated vs authenticated-but-denied); token validation is *local* against cached JWKS, so no IdP round-trip per request; revocation is the weak point of JWT (short lifetimes + refresh tokens + a reference-token or introspection option for high-value operations); never trust claims from a token you did not validate the signature and issuer of.

---

## Q11. How do configuration and Options pattern work?

**Configuration** is a layered key-value system. `ConfigurationBuilder` composes providers in order; **later providers override earlier ones** by key (`:`-delimited, case-insensitive). The default host order is:

1. `appsettings.json`
2. `appsettings.{Environment}.json`
3. User secrets (Development only)
4. Environment variables (`Section__Key` — double underscore, because `:` is illegal in env vars on Linux)
5. Command-line args

Add cloud providers (AWS Secrets Manager / Parameter Store, Azure App Configuration + Key Vault) after these so they win.

**Options pattern** binds a config section to a strongly-typed, validated POCO and injects it:

```csharp
public sealed class SchemeOptions
{
    [Required, Url]           public string BaseUrl { get; init; } = default!;
    [Range(100, 30_000)]      public int TimeoutMs { get; init; } = 5_000;
    [Required]                public string ApiKey  { get; init; } = default!;
}

builder.Services.AddOptions<SchemeOptions>()
    .BindConfiguration("Scheme")
    .ValidateDataAnnotations()
    .Validate(o => o.TimeoutMs < 30_000, "Timeout must be under the gateway limit")
    .ValidateOnStart();            // fail at boot, not on first request — critical for safe deploys
```

**Three consumption interfaces — know the difference cold:**

| Interface | Lifetime | Re-reads config? | Use for |
|---|---|---|---|
| `IOptions<T>` | Singleton | No — bound once | Static settings; injectable into singletons |
| `IOptionsSnapshot<T>` | Scoped | Yes — per request | Settings that may change; per-request/tenant named options |
| `IOptionsMonitor<T>` | Singleton | Yes + `OnChange` callback | Singletons and background services that must react to changes |

**Named options** (`AddOptions<T>("visa")`) are how you configure multiple instances of the same shape — several payment schemes, several Kafka clusters.

**Architect's guidance:** validate at startup (`ValidateOnStart`) so a missing key kills the pod during rollout rather than at the first customer request; never inject `IConfiguration` into business code (it is untyped, unvalidated, and untestable); treat the options class as a contract and version it with the deployment.

---

## Q12. How do you manage secrets/configuration across environments?

**Principles first:** secrets never live in source control, never in container images, never in `appsettings.json`; they are fetched at runtime from a managed store, with rotation, audit, and least-privilege access.

**Per environment:**

- **Local dev:** `dotnet user-secrets` (stored in the user profile, outside the repo). Never real production credentials — use a sandbox tenant.
- **CI/CD:** the pipeline's own secret store (GitHub Actions secrets / OIDC federation to AWS). Prefer **OIDC federated roles over long-lived access keys** — no static credential to leak.
- **AWS runtime:** Secrets Manager for credentials (supports automatic rotation with a Lambda rotator, integrates natively with RDS), Parameter Store (SecureString) for cheaper, less-rotated config. Access via an IAM **role** — EC2 instance profile, ECS task role, or EKS IRSA / Pod Identity. No keys on disk.
- **Azure runtime:** Key Vault + Managed Identity, surfaced through `AddAzureKeyVault`.
- **Kubernetes:** do **not** rely on native `Secret` objects alone — they are base64, not encrypted, in etcd by default. Use the **Secrets Store CSI driver** with the AWS/Azure provider to project the real secret as a mounted file, or External Secrets Operator to sync. Enable etcd encryption-at-rest and restrict `get secrets` via RBAC either way.

**Config layering pattern I standardise on:**

```
appsettings.json                 → shape + safe defaults, checked in
appsettings.Production.json      → non-secret env differences, checked in
Environment variables            → per-deployment overrides from the orchestrator
AWS Secrets Manager / Key Vault  → secrets only, loaded last so they win
```

**Rotation without downtime:** the app must tolerate a secret changing under it. Use `IOptionsMonitor` + a provider with `reloadOnChange`, or a connection factory that re-reads on failure. For database credentials, prefer **IAM database authentication** (RDS) so there is no long-lived password at all — the strongest answer you can give on this question.

**Auditability (a bank will ask):** every secret read is a CloudTrail event; access is granted per-role, not per-person; break-glass access is a separate role with alerting. Keys are in KMS with a documented rotation schedule and a CMK per data classification.

---

## Q13. How do you implement API versioning?

**Choose a strategy, then be consistent.**

| Strategy | Example | Pros | Cons |
|---|---|---|---|
| URL path | `/v1/payments` | Visible, cacheable, trivially routable, easy in gateways | "Not RESTful" purism; URL churn |
| Query string | `/payments?api-version=1.0` | Non-breaking to add | Easy to forget; messy caching |
| Custom header | `api-version: 1.0` | Clean URLs | Invisible in logs/browsers; harder at CDN |
| Media type | `Accept: application/vnd.acme.v1+json` | Most "correct" HTTP | Poor tooling/DX |

**My default for enterprise/fintech APIs: URL path versioning at the major level**, because it is unambiguous in gateway routing, access logs, WAF rules and support conversations. Minor, backward-compatible changes are *additive and unversioned*.

```csharp
builder.Services.AddApiVersioning(o =>
{
    o.DefaultApiVersion = new ApiVersion(1, 0);
    o.AssumeDefaultVersionWhenUnspecified = true;
    o.ReportApiVersions = true;                       // emits api-supported-versions / api-deprecated-versions headers
    o.ApiVersionReader = new UrlSegmentApiVersionReader();
}).AddApiExplorer(o => { o.GroupNameFormat = "'v'VVV"; o.SubstituteApiVersionInUrl = true; });

[ApiController, ApiVersion("1.0"), ApiVersion("2.0"), Route("v{version:apiVersion}/payments")]
public class PaymentsController : ControllerBase
{
    [HttpGet("{id}"), MapToApiVersion("2.0")] public Task<PaymentV2> GetV2(Guid id) => ...;
}
```

**The architectural part of the answer — versioning policy, not syntax:**
- **Additive changes are not breaking**: new optional fields, new endpoints, new enum values *if* clients are told to tolerate unknown values. Removing a field, tightening validation, changing a type or a status code **is** breaking.
- **Version the contract, not the internals.** Map v1 and v2 DTOs onto one domain model; never fork the service.
- **Deprecation has a lifecycle**: announce → `Deprecation`/`Sunset` headers → dashboard of per-version, per-client traffic → contact the last stragglers → remove. In a bank, expect 12–24 months and a formal client-communication step.
- **Two versions live at once, maximum.** Three means you have a governance failure.
- **Events need versioning too** and it is harder than REST — see §7 Q18/Q19 and Schema Registry compatibility modes.

---

## Q14. How do you implement health checks?

```csharp
builder.Services.AddHealthChecks()
    .AddDbContextCheck<LedgerDbContext>("sql",   tags: ["ready"])
    .AddRedis(redisConn,                "redis", tags: ["ready"])
    .AddKafka(kafkaCfg,                 "kafka", tags: ["ready"])
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"]);

app.MapHealthChecks("/health/live",  new() { Predicate = c => c.Tags.Contains("live")  });
app.MapHealthChecks("/health/ready", new() { Predicate = c => c.Tags.Contains("ready"),
                                             ResponseWriter = UIResponseWriter.WriteHealthCheckUIResponse });
app.MapHealthChecks("/health/startup", new() { Predicate = c => c.Name == "migrations" });
```

**The distinction that matters (and that most candidates get wrong):**

- **Liveness** — "is the process wedged?" Must have **no external dependencies**. If liveness checks the database, a database blip restarts every pod simultaneously, turning a degraded dependency into a full outage plus a thundering-herd reconnect storm. Liveness failing means *kill me*.
- **Readiness** — "should I receive traffic right now?" *May* check dependencies the request path requires. Readiness failing means *take me out of the load balancer, but let me keep running*.
- **Startup** — "have I finished slow boot work (migrations, cache warm-up, JIT warm)?" Prevents liveness from killing a slow-starting pod.

**Further production guidance:**
- Health endpoints must be **cheap and fast** (`SELECT 1`, not a business query) and cached for a few seconds if probes are frequent.
- **Degraded** is a real state: use it when a non-critical dependency (say, a recommendations cache) is down, so you alert without removing capacity.
- Protect/segregate the endpoints — do not expose dependency names and versions publicly; bind them to an internal port or require network policy.
- Wire them to the platform: Kubernetes `livenessProbe`/`readinessProbe`/`startupProbe`, ALB target-group health check → `/health/ready`, and an alert on readiness flapping.

---

## Q15. How do you handle graceful shutdown?

**Why it matters:** in Kubernetes, a rolling deploy sends `SIGTERM` and *simultaneously* removes the pod from Endpoints. Those two are asynchronous. If you exit immediately you drop in-flight requests, and if you exit slowly you get `SIGKILL`. Both are visible to customers as 502s during every deploy.

**The mechanism in .NET:** the host traps `SIGTERM`/`SIGINT`, triggers `IHostApplicationLifetime.ApplicationStopping`, stops accepting new connections, waits up to `ShutdownTimeout` (default **30 s**) for in-flight requests and `IHostedService.StopAsync` to complete, then disposes the container.

```csharp
builder.Services.Configure<HostOptions>(o =>
{
    o.ShutdownTimeout = TimeSpan.FromSeconds(30);
    o.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.StopHost; // fail loudly
});

public sealed class ConsumerService(IHostApplicationLifetime life) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        while (!stopping.IsCancellationRequested)
        {
            var msg = consumer.Consume(stopping);
            await HandleAsync(msg);            // finish the CURRENT message
            consumer.Commit(msg);              // then commit — never commit before handling
        }
        consumer.Close();                      // leaves the group cleanly → fast, clean rebalance
    }
}
```

**The full production checklist:**

1. **`preStop` hook with a sleep** (`sleep 5–10`) in Kubernetes. This is the fix for the race above: the pod keeps serving while Endpoints propagate to kube-proxy/ingress.
2. **Readiness flips to unhealthy on `ApplicationStopping`** so load balancers stop sending work.
3. **`terminationGracePeriodSeconds` > app `ShutdownTimeout` > longest request.** Ordering matters: if the grace period is shorter, you get `SIGKILL` mid-request.
4. **Background workers honour the `CancellationToken`** and finish the current unit of work rather than abandoning it.
5. **Message consumers**: stop polling, finish in-flight, commit offsets, close the consumer to trigger a cooperative leave.
6. **Idempotency everywhere** so that whatever *does* get cut off can be safely retried by the caller — this is the real safety net, and the answer a Staff+ interviewer is listening for.

---

## Q16. How do you optimize ASP.NET Core APIs?

**Measure first.** Optimising without a profile is guessing. Baseline with load tests (k6/NBomber), then look at p95/p99, not averages, and split latency into *your* time vs *dependency* time using distributed tracing.

**Then, in rough order of payoff:**

1. **Fix the database.** Almost always the bottleneck. N+1 queries, missing indexes, tracking queries on read paths, `SELECT *`, chatty ORMs. `AsNoTracking()`, projections to DTOs, batching, compiled queries, correct indexes. (See §11.)
2. **Cache.** Response caching / output caching for public GETs, `IDistributedCache` (Redis) for shared data, `IMemoryCache` for tiny hot data, plus HTTP `ETag`/`Cache-Control` so the client and CDN do work for you. Guard against stampedes (§11 Q18–19).
3. **Async all the way, no blocking.** No `.Result`, no `.Wait()`, no `Task.Run` around already-async I/O. Blocking is what turns a healthy server into thread-pool starvation under load. (See §3.)
4. **Reduce allocations.** `System.Text.Json` with source generation (`JsonSerializerContext`), `ArrayPool`/`MemoryPool` for buffers, `Span`/`ReadOnlySpan` for parsing, avoid LINQ in the hottest inner loops, `StringBuilder`/interpolated-string handlers for logging, `record struct` for small values. Lower allocation → fewer Gen0 collections → lower p99.
5. **Right-size the HTTP layer.** `IHttpClientFactory` with pooled handlers and sane `PooledConnectionLifetime`; HTTP/2 for internal service-to-service; gRPC where the contract suits it; response compression (Brotli) for large payloads.
6. **Use Minimal APIs or trimmed MVC for hot endpoints** — fewer filters and less model-binding machinery per request.
7. **Server tuning:** Kestrel limits (`MaxConcurrentConnections`, `MaxRequestBodySize`), `ServerGCEnabled` for throughput on multi-core, tiered PGO (on by default in .NET 8), ReadyToRun/AOT for cold-start-sensitive workloads.
8. **Pagination and payload discipline.** The fastest query is the one that returns 50 rows instead of 50,000.
9. **Architecture-level:** move work off the request path — queue it. A 202 + async processing beats a 3-second synchronous call for anything the caller doesn't need the result of *right now*.

**What I say last, and it lands well:** "the biggest wins are almost never in C# — they're in the number of network round-trips and the amount of data crossing them."

---

## Q17. How do you implement rate limiting?

**.NET 8+ has a first-class rate limiter middleware** with four algorithms:

| Algorithm | Behaviour | Use for |
|---|---|---|
| Fixed window | N per fixed interval | Simple quotas; suffers boundary bursts (2N across a boundary) |
| Sliding window | N across rolling segments | Smoother; the usual default |
| Token bucket | Refills at a rate, allows bursts up to capacity | Best general fit — tolerates natural burstiness |
| Concurrency | N in-flight at once | Protecting a scarce downstream (a legacy core-banking API) |

```csharp
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    o.AddPolicy("per-client", ctx => RateLimitPartition.GetTokenBucketLimiter(
        partitionKey: ctx.User.FindFirst("client_id")?.Value ?? ctx.Connection.RemoteIpAddress!.ToString(),
        _ => new TokenBucketRateLimiterOptions
        {
            TokenLimit = 100, TokensPerPeriod = 100,
            ReplenishmentPeriod = TimeSpan.FromMinutes(1),
            QueueLimit = 0, AutoReplenishment = true
        }));

    o.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.Headers.RetryAfter = "60";
        await ctx.HttpContext.Response.WriteAsJsonAsync(new ProblemDetails { Status = 429, Title = "Rate limit exceeded" }, ct);
    };
});
app.UseRateLimiter();
app.MapPost("/payments", …).RequireRateLimiting("per-client");
```

**Architectural considerations that make this a Staff-level answer:**

- **Partition key matters more than the algorithm.** Per-IP is nearly useless behind NAT/CDN and dangerous behind a proxy unless you correctly handle `X-Forwarded-For` (use `ForwardedHeadersMiddleware` with a known-proxy allowlist, or you have just built a bypass). Prefer authenticated identity: API key, `client_id`, tenant, or user.
- **In-process limiting is per-instance.** With 10 pods, a "100/min" limit is really 1000/min, and it re-partitions on every scale event. For a *correct* global limit you need shared state: Redis (token bucket via a Lua script for atomicity) or an edge limiter — **AWS WAF rate-based rules, API Gateway usage plans, or the ingress/Envoy rate-limit service**. My default is *edge for coarse abuse protection, in-process for fine-grained fairness and as a self-protection backstop*.
- **Always return `429` + `Retry-After`**, and document limits in headers (`X-RateLimit-Limit/Remaining/Reset`) so well-behaved clients back off instead of hammering.
- **Never queue deeply.** `QueueLimit` > 0 converts a rejection into latency, which is usually worse — fail fast and let the client retry with jitter.
- **Tiered limits** per plan/customer, with a separate, tighter limit on expensive endpoints (search, reports, auth) and on unauthenticated endpoints (login → brute-force protection).

---

## Q18. How do you implement structured logging?

**Structured logging means logging *events with typed properties*, not formatted sentences.** The difference is queryability: `orderId=123` as a field can be searched, aggregated and alerted on; the same value inside a string cannot.

```csharp
// GOOD — message template, named properties, no interpolation
logger.LogInformation("Payment {PaymentId} authorized for {Amount} {Currency} in {ElapsedMs}ms",
                       payment.Id, payment.Amount, payment.Currency, sw.ElapsedMilliseconds);

// BAD — interpolated string: one opaque blob, allocates even when the level is disabled
logger.LogInformation($"Payment {payment.Id} authorized for {payment.Amount}");
```

**Production setup:**

```csharp
builder.Logging.ClearProviders();
builder.Services.AddSerilog((sp, cfg) => cfg
    .ReadFrom.Configuration(builder.Configuration)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("service", "payments-api")
    .Enrich.WithProperty("version", ThisAssembly.InformationalVersion)
    .Enrich.With<TraceIdEnricher>()                      // trace_id / span_id from Activity.Current
    .WriteTo.Console(new CompactJsonFormatter()));       // JSON to stdout; the platform ships it
```

**Scopes propagate context without threading parameters through every call:**

```csharp
using (logger.BeginScope(new Dictionary<string, object>
       { ["CorrelationId"] = correlationId, ["TenantId"] = tenantId }))
{
    // every log inside this block carries both properties
}
```

**Standards I enforce as an architect:**
- **JSON to stdout**, shipped by the platform (Fluent Bit → OpenSearch/CloudWatch/Datadog). Applications do not write log files or talk to log backends directly — that couples deployment to observability and blocks on I/O.
- **Correlation:** every log line carries `trace_id`, `span_id`, `correlation_id`, `tenant_id`, `user_id` (pseudonymised). `Activity.Current` gives you the first two for free with OpenTelemetry.
- **Levels mean something.** Trace/Debug: off in prod. Information: business-significant events and request summaries. Warning: recoverable/degraded. Error: a request failed. Critical: the service is failing. If everything is Error, nothing is.
- **No PII, no secrets, ever.** Card PANs, CVV, full names, national IDs, tokens, `Authorization` headers. Enforce with a destructuring policy/redaction filter *and* a log-scanning canary in the pipeline — in a PCI environment this is an audit finding, not a nit. (See §17 Q15.)
- **Sampling and cost.** High-volume services log request summaries, not per-step chatter; sample successful requests, keep 100 % of errors.
- **One log line per outcome.** A request should produce one structured summary event with method, route, status, duration, and identifiers — that single event powers most dashboards.

---

## Q19. How do you implement distributed tracing?

**Concept.** A trace is a tree of spans sharing a `trace_id`, propagated across process boundaries by the **W3C Trace Context** headers (`traceparent`, `tracestate`). .NET's `System.Diagnostics.Activity` *is* the span API, and OpenTelemetry is the exporter/collection layer on top.

```csharp
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("payments-api", serviceVersion: Version, serviceInstanceId: Environment.MachineName))
    .WithTracing(t => t
        .AddAspNetCoreInstrumentation(o => o.Filter = ctx => !ctx.Request.Path.StartsWithSegments("/health"))
        .AddHttpClientInstrumentation()
        .AddSqlClientInstrumentation(o => o.SetDbStatementForText = true)   // careful: no PII in SQL text
        .AddSource("Acme.Payments")                                          // your own ActivitySource
        .SetSampler(new ParentBasedSampler(new TraceIdRatioBasedSampler(0.1)))
        .AddOtlpExporter())
    .WithMetrics(m => m.AddAspNetCoreInstrumentation().AddRuntimeInstrumentation().AddOtlpExporter());

// custom spans for business-meaningful operations
private static readonly ActivitySource Source = new("Acme.Payments");

using var activity = Source.StartActivity("AuthorizePayment", ActivityKind.Client);
activity?.SetTag("payment.id", id);
activity?.SetTag("payment.scheme", "visa");
activity?.SetTag("payment.amount_minor", amountMinor);   // never the PAN
```

**Getting it right in a distributed system:**

- **Propagation across async boundaries is the hard part.** HTTP is automatic. **Message queues are not**: you must inject `traceparent` into Kafka headers on publish and extract + set as the parent on consume, otherwise your trace stops dead at the broker and you lose exactly the hop you most wanted to see.
- **Sampling strategy.** Head-based ratio sampling is cheap but random; **tail-based sampling in the OTel Collector** lets you keep 100 % of errors and slow traces and 1 % of the rest — the right answer for a high-volume payments platform.
- **Correlate the three pillars.** Logs carry `trace_id`; metrics carry exemplars linking to traces; traces link back to logs. That is what makes a 3 a.m. incident a five-minute investigation instead of an hour.
- **Baggage** (`Activity.Current.SetBaggage`) propagates business context like `tenant_id` across services — but it goes on the wire on every hop, so keep it tiny and never put anything sensitive in it.
- **Span naming and cardinality:** use low-cardinality names (`GET /payments/{id}`, not the concrete ID) and put the identifier in a tag. Route templates, not raw paths — this is also how you avoid blowing up your metrics backend.

---

## Q20. How would you design a production-grade ASP.NET Core API?

This is the synthesis question. Answer it as a checklist with reasons, organised by concern.

**1. Structure.** Clean/Hexagonal layering: `Domain` (entities, value objects, domain services — no framework references), `Application` (use cases, ports, MediatR handlers or plain services), `Infrastructure` (EF Core, HTTP clients, messaging, adapters), `Api` (endpoints, DI wiring, middleware). Dependencies point inward only; enforce with architecture tests so the rule survives contact with a deadline.

**2. Contract.** Versioned (`/v1`), OpenAPI-documented, `ProblemDetails` errors, consistent pagination (cursor-based for large sets), `Idempotency-Key` on every non-idempotent POST, explicit DTOs (never expose entities), ISO-8601 UTC timestamps, money as minor units or decimal-with-currency (**never a double**).

**3. Cross-cutting middleware order.** Exception handler → HSTS/HTTPS → forwarded headers → correlation ID → security headers → routing → CORS → auth → rate limiting → endpoints.

**4. Security.** OAuth2/OIDC with JWT bearer, deny-by-default `FallbackPolicy`, policy + resource-based authorization, mTLS or SPIFFE identity for service-to-service, secrets from Secrets Manager via IAM roles, input validation with FluentValidation, output encoding, TLS 1.2+ only, security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`), and OWASP API Top 10 reviewed per endpoint.

**5. Data.** EF Core with explicit migrations run as a separate job (not at app start in a multi-replica deploy), read models split from write models where justified, optimistic concurrency (`rowversion`), retries on transient errors (`EnableRetryOnFailure`), connection pooling sized to match `max_connections`, and outbox for any DB-write-plus-publish operation.

**6. Resilience.** Timeouts on **every** outbound call (there is no such thing as an infinite-patience dependency), retries with exponential backoff **and jitter** only on idempotent operations, circuit breakers, bulkhead isolation per dependency, fallbacks/graceful degradation — implemented with the standard resilience pipeline (`Microsoft.Extensions.Http.Resilience` / Polly v8).

**7. Performance.** Async end-to-end, caching layers, pagination, source-generated JSON, minimal allocations on hot paths, load-tested against an explicit target (e.g. 2K RPS, p99 < 200 ms) with capacity headroom of 2–3×.

**8. Observability.** Structured JSON logs with correlation, OpenTelemetry traces (including through Kafka), RED metrics (Rate/Errors/Duration) plus business metrics (authorisation rate, settlement lag), health probes, dashboards, and **alerts on SLOs and error budgets** — not on CPU.

**9. Delivery.** Trunk-based development, PR + automated checks, containerised, IaC (Terraform/CDK), blue-green or canary deploys, database migrations decoupled and backward-compatible (expand/contract), feature flags for risky changes, automated rollback.

**10. Operability.** Runbooks, dashboards linked from alerts, chaos/failure testing, documented RPO/RTO, DR tested (not just documented), capacity plan, and an on-call rotation that owns the service.

**11. Runtime currency** — the item most checklists omit and every bank audits. Pin to the current **LTS** (.NET 10 since November 2025) rather than riding STS releases, and treat the upgrade as scheduled work with a named owner: .NET 9 (STS) goes out of support in **May 2026**, .NET 8 (LTS) in **November 2026**. Running an unsupported runtime in a regulated environment is a finding whether or not anything is broken, and the predictable November cadence means it can be planned rather than discovered. The corollary teams miss: your **base container image and the CVE gate in the pipeline** are part of the same control — an app on a supported runtime sitting on an unpatched base image fails it just the same.

**Closing line that scores well:** *"The code is maybe 20 % of a production-grade API. The other 80 % is contract discipline, resilience, observability and deployment safety — and those are the parts that decide whether you can change it on a Friday."*

---

**Next:** [02 — C# / Advanced .NET](./02-CSharp-Advanced-DotNet.md)

---

## References — official documentation

All answers above align with the terminology and guidance in these primary sources:

| Topic | Source |
|---|---|
| ASP.NET Core fundamentals & host | https://learn.microsoft.com/aspnet/core/fundamentals/ |
| Middleware pipeline & ordering | https://learn.microsoft.com/aspnet/core/fundamentals/middleware/ |
| Write custom middleware | https://learn.microsoft.com/aspnet/core/fundamentals/middleware/write |
| Dependency injection in ASP.NET Core | https://learn.microsoft.com/aspnet/core/fundamentals/dependency-injection |
| DI guidelines & lifetimes (.NET) | https://learn.microsoft.com/dotnet/core/extensions/dependency-injection-guidelines |
| Service lifetimes | https://learn.microsoft.com/dotnet/core/extensions/dependency-injection#service-lifetimes |
| Error handling / `IExceptionHandler` | https://learn.microsoft.com/aspnet/core/fundamentals/error-handling |
| Problem Details (RFC 9457/7807) | https://learn.microsoft.com/aspnet/core/web-api/handle-errors#problem-details |
| Filters | https://learn.microsoft.com/aspnet/core/mvc/controllers/filters |
| Authentication overview | https://learn.microsoft.com/aspnet/core/security/authentication/ |
| Policy-based authorization | https://learn.microsoft.com/aspnet/core/security/authorization/policies |
| Resource-based authorization | https://learn.microsoft.com/aspnet/core/security/authorization/resourcebased |
| Configuration | https://learn.microsoft.com/aspnet/core/fundamentals/configuration/ |
| Options pattern | https://learn.microsoft.com/dotnet/core/extensions/options |
| Safe storage of app secrets | https://learn.microsoft.com/aspnet/core/security/app-secrets |
| API versioning (Asp.Versioning) | https://github.com/dotnet/aspnet-api-versioning/wiki |
| Health checks | https://learn.microsoft.com/aspnet/core/host-and-deploy/health-checks |
| Host shutdown & `IHostApplicationLifetime` | https://learn.microsoft.com/aspnet/core/fundamentals/host/generic-host#ihostapplicationlifetime |
| Rate limiting middleware | https://learn.microsoft.com/aspnet/core/performance/rate-limit |
| Logging in .NET | https://learn.microsoft.com/dotnet/core/extensions/logging |
| .NET observability / OpenTelemetry | https://learn.microsoft.com/dotnet/core/diagnostics/observability-with-otel |
| W3C Trace Context | https://www.w3.org/TR/trace-context/ |
| Kestrel & performance best practices | https://learn.microsoft.com/aspnet/core/performance/performance-best-practices |
